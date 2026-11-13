// The SI cable-stayed bridge (src/engine/si-bridge.ts) against statics, hand solutions and itself.
// Every tolerance says where it comes from; measured values are printed as diagnostics and recorded in
// docs/SI_BRIDGE.md. Nothing here asserts on wall-clock time.
//
// Four facts set most tolerances:
//  - The time-stepped model and the static solver in the same file share the frame element matrices and
//    the stay law, but nothing else: the first is conjugate gradients, a proximal cable solve and an
//    interface solve per step, the second a dense Newton iteration. They agree at rest to the coupling's
//    steady-state bias, which falls with the step: on the default bridge with a parked vehicle 2.9e-4,
//    9.6e-5, 3.1e-5 and 9.8e-6 of a stay tension and 0.027, 0.0096, 0.0031 and 0.0010 mm of deck
//    deflection at 60, 120, 240 and 480 Hz (measured: a factor of three per halving of the step).
//  - Readings are means over a window after a damped settle: the frame's midpoint rule does not damp its
//    stiffest modes (docs/STRUCTURE_COUPLING.md).
//  - The vehicle's weight reaches the deck through two pins, which share it by the lever rule. The exact
//    load for a cubic beam element also has nodal moments. The difference is second order in the element
//    length and vanishes when the vehicle stands on a node.
//  - The rigid world is float32: the vehicle's mass is read back from it and used for every reference.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cableStayedLayout, proppedSpanLayout, SiBridge, SiBridgeStatics, SI_BRIDGE_DEFAULTS, SI_BRIDGE_DECK, SI_BRIDGE_TOWER, SI_BRIDGE_STAY,
} from '../../src/engine/si-bridge.ts';
import {crossingFrequency, freshWorld, proppedSpanHand, settledMeans, withBridge} from './si-bridge-fixtures.mjs';

const HZ = 120;
const sci = value => value.toExponential(2);
const rel = (actual, expected) => (actual - expected) / expected;
const within = (actual, expected, fraction, label) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * fraction, `${label}: got ${actual}, expected ${expected} within ${fraction}`);
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const sumReactions = reactions => { const sum = [0, 0, 0]; for (let j = 0; j < reactions.length; j += 6) for (let k = 0; k < 3; k++) sum[k] += reactions[j + k]; return sum; };

test('layout and hand numbers: spans, panels, stays and sections are what the document says', () => {
  const layout = cableStayedLayout(), p = layout.positions;
  assert.equal(layout.length, 120, 'side span 30 m, main span 60 m, side span 30 m');
  assert.equal(layout.deckNodes.length, 21, 'twenty 6 m deck elements');
  assert.equal(layout.stays.length, 16);
  assert.deepEqual(layout.towers.map(t => t.x), [30, 90]);
  assert.equal(p[3 * layout.midNode], 60);
  assert.deepEqual(layout.stays.slice(0, 8).map(s => p[3 * s.deckNode]), [6, 12, 18, 24, 36, 42, 48, 54], 'anchorages every 6 m, none at the tower');
  assert.deepEqual(layout.stays.slice(0, 4).map(s => p[3 * s.towerNode + 1]), [15, 13.5, 12, 10.5], 'the outermost stay goes to the tower top');
  // Section numbers derived by hand in docs/SI_BRIDGE.md.
  const d = SI_BRIDGE_DECK, t = SI_BRIDGE_TOWER, s = SI_BRIDGE_STAY;
  within(d.area, 2 * (4 + 1.2) * 0.016 * 1.2, 0.01, 'deck area');
  within(d.iz, (2 * 4 * 0.016 * 0.6 ** 2 + 2 * 0.016 * 1.2 ** 3 / 12) * 1.2, 0.02, 'deck vertical second moment');
  within(d.torsionConstant, 4 * (4 * 1.2) ** 2 / (2 * (4 + 1.2) / 0.016), 0.02, 'deck Bredt torsion constant');
  within(d.massPerMetre, 7850 * 0.2 + 2300 * 0.07 * 5 + 225, 0.001, 'deck mass per metre');
  within(d.sectionModulus, d.iz / 0.6, 1e-12, 'deck section modulus');
  within(t.area, 4 * 1.5 * 0.03, 1e-12, 'tower area');
  within(t.iz, 2 * 1.5 * 0.03 * 0.75 ** 2 + 2 * 0.03 * 1.5 ** 3 / 12, 1e-12, 'tower second moment');
  within(t.massPerMetre, 7850 * t.area, 1e-12, 'tower mass per metre');
  within(s.area, 6 * 150e-6, 1e-12, 'six 150 mm^2 strands');
  within(s.massPerMetre, 7850 * s.area * 1.15, 0.005, 'stay mass per metre');
  // Mirror-image nodes have mirror-image coordinates to the last bit.
  layout.deckNodes.forEach((node, j) => assert.equal(p[3 * node] + p[3 * layout.deckNodes[20 - j]], 120));
  assert.throws(() => cableStayedLayout({span: -1}), RangeError);
  assert.throws(() => cableStayedLayout({staysPerSide: 0}), RangeError);
  assert.throws(() => cableStayedLayout({towerHeight: 3, anchorSpacing: 1.5}), /lowest stay anchorage/);
  assert.throws(() => proppedSpanLayout({span: 30, elements: 3, towerHeight: 10, deck: d, tower: t, stay: s}), /even/);
  assert.equal(SI_BRIDGE_DEFAULTS.elementsPerPanel, 1);
});

test('dead load: the pretension levels the deck, and the supports carry deck + stays + towers + vehicle', async t => {
  // Statics. The pretension solve asks for zero deflection at every stay anchorage and iterates on the true
  // (nonlinear) equilibrium until what is left is below 1e-7 m: tolerance 1e-6 m. Between anchorages the deck sags as
  // a continuous beam on level supports: 0.185 mm on the three 12 m gaps (at the towers, which do not carry the deck,
  // and at midspan); tolerance 0.5 mm. Reactions: a Newton solve ends at round-off, 1e-9 of the weight.
  const layout = cableStayedLayout(), statics = new SiBridgeStatics(layout), dead = statics.solve();
  const weight = statics.structureMass() * statics.gravity, sum = sumReactions(dead.reactions);
  let anchorage = 0, sag = 0;
  for (const s of layout.stays) anchorage = Math.max(anchorage, Math.abs(dead.displacements[6 * s.deckNode + 1]));
  for (const node of layout.deckNodes) sag = Math.max(sag, Math.abs(dead.displacements[6 * node + 1]));
  t.diagnostic(`statics: weight ${(weight / 1e3).toFixed(1)} kN, sum Ry / weight - 1 = ${sci(rel(sum[1], weight))}, sum Rx ${sci(sum[0])} N; largest deflection at an anchorage ${sci(anchorage)} m, anywhere on the deck ${sci(sag)} m`);
  t.diagnostic(`stay tensions (kN, left half): ${Array.from(dead.tensions.slice(0, 8), v => (v / 1e3).toFixed(1)).join(' ')}; tower base Fx ${(dead.reactions[6 * layout.towers[0].nodes[0]] / 1e3).toFixed(1)} kN, Fy ${(dead.reactions[6 * layout.towers[0].nodes[0] + 1] / 1e3).toFixed(1)} kN, Mz ${(dead.reactions[6 * layout.towers[0].nodes[0] + 5] / 1e3).toFixed(1)} kN m`);
  within(sum[1], weight, 1e-9, 'static vertical reactions carry the weight');
  near(sum[0], 0, 1e-9 * weight, 'static horizontal reactions balance');
  near(sum[2], 0, 1e-9 * weight, 'no lateral reaction without wind');
  assert.ok(anchorage < 1e-6, `the stay anchorages are level (${anchorage} m)`);
  assert.ok(sag < 5e-4, `the deck is level (${sag} m)`);
  assert.ok(dead.tensions.every(T => T > 1e5 && T < 6e5), 'every stay pulls between 100 and 600 kN');
  // Horizontal reactions are not zero one by one: the towers lean towards the main span and the abutments hold the deck.
  assert.ok(Math.abs(dead.reactions[0]) > 1e5 && Math.abs(dead.reactions[6 * layout.towers[0].nodes[0]]) > 5e4, 'the horizontal balance is between non-zero reactions');

  // The time-stepped model with a 20 t vehicle parked between two nodes of the main span. Settled 2 s with the frame
  // damped at 8 /s, read as a half-second mean. Tolerance 1e-6 of the weight: what is left of the motion (measured
  // 1e-8). The vehicle's mass is the float32 value the rigid world reports.
  await withBridge(layout, {hz: HZ, damping: 8, stayDamping: 2, vehicle: {mass: 20000, speed: 0, start: 37.3}}, bridge => {
    const total = bridge.totalWeight(), mean = settledMeans(bridge, 2 * HZ, HZ / 2);
    t.diagnostic(`time-stepped, vehicle ${bridge.vehicle.mass} kg at 37.3 m: total weight ${(total / 1e3).toFixed(2)} kN; mean sum Ry / weight - 1 = ${sci(rel(mean.reaction[1], total))} (elastic), ${sci(rel(mean.frameReaction[1], total))} (frame solver); sum Rx / weight = ${sci(mean.reaction[0] / total)}`);
    within(total, weight + bridge.vehicle.mass * bridge.gravity, 1e-6, 'the total weight is deck + stays + towers + vehicle');
    within(mean.reaction[1], total, 1e-6, 'vertical reactions carry the total weight');
    within(mean.frameReaction[1], total, 1e-6, "the frame solver's own reactions carry it too");
    near(mean.reaction[0], 0, 1e-6 * total, 'horizontal reactions balance');
    near(mean.reaction[2], 0, 1e-6 * total, 'no lateral reaction');
    // The model started in the static solution with the vehicle and stays there: tension within 3e-4, deflection
    // within 5e-5 m (the coupling's steady-state bias at 120 Hz, measured 1e-4 and 1e-5 m).
    let worstTension = 0, worstDeflection = 0;
    for (let i = 0; i < mean.tension.length; i++) worstTension = Math.max(worstTension, Math.abs(rel(mean.tension[i], bridge.initial.tensions[i])));
    layout.deckNodes.forEach((node, j) => { worstDeflection = Math.max(worstDeflection, Math.abs(mean.deflection[j] - bridge.initial.displacements[6 * node + 1])); });
    t.diagnostic(`time-stepped against statics with the vehicle: worst stay tension error ${sci(worstTension)}, worst deck deflection error ${sci(worstDeflection)} m`);
    assert.ok(worstTension < 3e-4, `stay tensions stay at the static solution (${worstTension})`);
    assert.ok(worstDeflection < 5e-5, `deck deflections stay at the static solution (${worstDeflection} m)`);
  });
});

test('hand case: a span propped by one stay matches the flexibility-method solution at every mesh, from rest', async t => {
  // A 30 m simply supported deck, one stay from a 10 m column to midspan, no pretension: one redundant.
  // The model starts UNDEFORMED and settles under heavy damping, so this is the time-stepped model finding its own
  // equilibrium. Cubic beam elements are exact at the nodes for nodal loads and for their own uniform weight, so the
  // answer does not depend on the mesh (asserted to 2e-6: the settle and the solver tolerances).
  //  - Against the hand solution with the stay geometry linearised: 1e-3. The deck drops 19 mm under an 18 m stay,
  //    which turns the stay and lengthens it at second order by (delta cos)^2 / (2 L_s) = 7e-6 m of a 9e-3 m
  //    stretch: 7.5e-4 (measured 6.0e-4 in tension, 2.3e-4 in deflection).
  //  - Against the same hand solution iterated with the stay's true chord: 5e-5 (measured 1.5e-6 and 4.7e-6).
  //  - Reactions. The undeformed start is a blow: it excites the frame's stiffest (axial) modes, for which w dt is
  //    10 to 30, and mass-proportional damping takes a fraction 4 c dt / (w dt)^2 per step off those, so they still
  //    ripple after 3 s (node speeds near 1e-3 m/s). The frame solver's reactions, which include inertia, average to
  //    the weight within 5e-5 (measured up to 1.1e-5); the elastic reactions K u - f within 1e-4 (measured up to
  //    3.6e-5). The 1e-6 reaction check is in the dead-load test above, which starts in equilibrium.
  const span = 30, towerHeight = 10, sections = {deck: SI_BRIDGE_DECK, tower: SI_BRIDGE_TOWER, stay: SI_BRIDGE_STAY}, rows = [];
  for (const elements of [2, 4, 8, 16]) {
    const layout = proppedSpanLayout({span, elements, towerHeight, ...sections});
    await withBridge(layout, {hz: HZ, damping: 40, stayDamping: 5, start: 'undeformed'}, bridge => {
      const mean = settledMeans(bridge, 3 * HZ, HZ / 2), g = bridge.gravity;
      const linear = proppedSpanHand({span, towerHeight, ...sections, gravity: g}), exact = proppedSpanHand({span, towerHeight, ...sections, gravity: g, exact: true});
      rows.push({elements, tension: mean.tension[0], deflection: -mean.midspan, linear, exact, reaction: mean.reaction[1] / bridge.totalWeight() - 1, frameReaction: mean.frameReaction[1] / bridge.totalWeight() - 1});
    });
  }
  for (const row of rows) {
    t.diagnostic(`${row.elements} elements: stay ${row.tension.toFixed(2)} N (hand ${row.linear.tension.toFixed(2)}, error ${sci(rel(row.tension, row.linear.tension))}; true chord ${row.exact.tension.toFixed(2)}, error ${sci(rel(row.tension, row.exact.tension))}); midspan ${(row.deflection * 1e3).toFixed(5)} mm (hand ${(row.linear.deflection * 1e3).toFixed(5)}, error ${sci(rel(row.deflection, row.linear.deflection))}; true chord error ${sci(rel(row.deflection, row.exact.deflection))}); reactions / weight - 1 = ${sci(row.frameReaction)} (frame solver), ${sci(row.reaction)} (elastic)`);
    within(row.tension, row.linear.tension, 1e-3, `${row.elements} elements: stay tension against the linearised hand solution`);
    within(row.deflection, row.linear.deflection, 1e-3, `${row.elements} elements: midspan deflection against the linearised hand solution`);
    within(row.tension, row.exact.tension, 5e-5, `${row.elements} elements: stay tension against the hand solution with the true chord`);
    within(row.deflection, row.exact.deflection, 5e-5, `${row.elements} elements: midspan deflection against the hand solution with the true chord`);
    within(row.tension, rows[0].tension, 2e-6, `${row.elements} elements: the stay tension does not depend on the mesh`);
    within(row.deflection, rows[0].deflection, 2e-6, `${row.elements} elements: the deflection does not depend on the mesh`);
    near(row.frameReaction, 0, 5e-5, `${row.elements} elements: the supports carry the weight (frame solver reactions)`);
    near(row.reaction, 0, 1e-4, `${row.elements} elements: the supports carry the weight (elastic reactions)`);
  }
  // The stay takes a real share: without it the deck would sag 21.4 mm.
  assert.ok(rows[0].linear.freeDeflection > 1.1 * rows[0].linear.deflection);
});

test('hand case, mesh convergence: a vehicle between nodes is shared by the lever rule, an error of second order in the element', async t => {
  // The same propped span with a 20 t vehicle parked at x = 7 L / 16, which is a node only of the 16-element mesh.
  // Against the hand solution with the true chord and the load at its exact place:
  //  - the static solver with the cubic element's consistent load (forces and moments) is exact at every mesh: 1e-6;
  //  - the time-stepped model, whose two pins share the weight by the lever rule, converges. The lever rule drops
  //    the nodal moments, an error proportional to h^2 xi (1 - xi) for an element of length h loaded at fraction
  //    xi: 24.6, 10.5, 3.5 and 0 m^2 for 2, 4, 8 and 16 elements. Asserted: the error falls at every refinement and
  //    stays below 0.2 % x h^2 xi (1 - xi) / m^2 (measured 0.12 to 0.18 %) plus a floor.
  //  - The floor. The vehicle's body is rigid between its two pins, so it is also a strut along the element it stands
  //    on. The deck here is in compression between the pin and the stay, the strut carries part of it, the deck
  //    shortens less and the stay stretches more: the time-stepped stay tension is above the lever-rule statics by
  //    7.9e-4, 7.8e-4, 4.5e-4 and 2.3e-4 for 2, 4, 8 and 16 elements (asserted below 1e-3; the 2-element vehicle
  //    spans the whole compressed half). Deflections are not affected: floor 1e-4 there.
  const span = 30, towerHeight = 10, loadX = 7 * span / 16, sections = {deck: SI_BRIDGE_DECK, tower: SI_BRIDGE_TOWER, stay: SI_BRIDGE_STAY}, rows = [];
  for (const elements of [2, 4, 8, 16]) {
    const layout = proppedSpanLayout({span, elements, towerHeight, ...sections});
    await withBridge(layout, {hz: HZ, damping: 40, stayDamping: 5, start: 'undeformed', vehicle: {mass: 20000, speed: 0, start: loadX}}, bridge => {
      const mean = settledMeans(bridge, 3 * HZ, HZ / 2), g = bridge.gravity, load = bridge.vehicle.mass * g;
      const hand = proppedSpanHand({span, towerHeight, ...sections, gravity: g, load, loadX, exact: true});
      const consistent = bridge.statics.solve({vehicle: {x: loadX, weight: load, model: 'consistent'}});
      const {xi, length} = bridge.statics.locate(loadX);
      const lever = bridge.initial.tensions[0];
      rows.push({elements, hand, measure: length * length * xi * (1 - xi), tension: rel(mean.tension[0], hand.tension), deflection: rel(-mean.midspan, hand.deflection), strut: rel(mean.tension[0], lever),
        frameReaction: mean.frameReaction[1] / bridge.totalWeight() - 1,
        consistentTension: rel(consistent.tensions[0], hand.tension), consistentDeflection: rel(-consistent.displacements[6 * layout.midNode + 1], hand.deflection), reaction: mean.reaction[1] / bridge.totalWeight() - 1});
    });
  }
  for (const row of rows) t.diagnostic(`${row.elements} elements (h^2 xi (1 - xi) = ${row.measure.toFixed(2)} m^2): time-stepped error in stay tension ${sci(row.tension)}, in midspan deflection ${sci(row.deflection)}; stay tension above the lever-rule statics by ${sci(row.strut)}; consistent-load statics ${sci(row.consistentTension)} and ${sci(row.consistentDeflection)}; hand tension ${row.hand.tension.toFixed(1)} N, deflection ${(row.hand.deflection * 1e3).toFixed(4)} mm`);
  for (const [index, row] of rows.entries()) {
    near(row.consistentTension, 0, 1e-6, `${row.elements} elements: consistent-load statics give the hand stay tension`);
    near(row.consistentDeflection, 0, 1e-6, `${row.elements} elements: consistent-load statics give the hand deflection`);
    near(row.frameReaction, 0, 5e-5, `${row.elements} elements: the supports carry deck, stay, column and vehicle (frame solver reactions)`);
    near(row.reaction, 0, 1e-4, `${row.elements} elements: the supports carry deck, stay, column and vehicle (elastic reactions)`);
    const bound = 2e-3 * row.measure;
    assert.ok(Math.abs(row.tension) <= bound + 1e-3, `${row.elements} elements: tension error ${row.tension} within ${bound + 1e-3}`);
    assert.ok(Math.abs(row.deflection) <= bound + 1e-4, `${row.elements} elements: deflection error ${row.deflection} within ${bound + 1e-4}`);
    assert.ok(row.strut > 0 && row.strut < 1e-3, `${row.elements} elements: the rigid vehicle stiffens the deck axially by a little (${row.strut})`);
    if (index > 0) {
      assert.ok(Math.abs(row.tension) < Math.abs(rows[index - 1].tension), `${row.elements} elements: the tension error falls with the mesh`);
      assert.ok(Math.abs(row.deflection) < Math.abs(rows[index - 1].deflection), `${row.elements} elements: the deflection error falls with the mesh`);
    }
  }
  assert.ok(Math.abs(rows[0].tension) > 1e-2, 'the coarsest mesh shows the lever-rule error (so the convergence is real)');
});

test('symmetry: a symmetric bridge answers symmetrically, and mirrored vehicles give mirrored results', async t => {
  // Statics: 1e-9 relative in tension, 1e-12 m in deflection (round-off of a dense solve; measured 6e-12 and 3e-15 m).
  // Time-stepped: 1e-6 and 1e-7 m. Each stay is solved in turn within a step, so the two halves are not treated
  // alike during motion; at rest that order no longer matters and what is left is the residual motion after a 2 s
  // damped settle and the solvers' 1e-4 N stopping tolerances (measured 8e-11 and 5e-13 m without a vehicle,
  // 3e-8 and 3e-9 m with the mirrored vehicles).
  const layout = cableStayedLayout(), statics = new SiBridgeStatics(layout), dead = statics.solve(), stays = layout.stays.length, nodes = layout.deckNodes.length;
  const asymmetry = (tensionA, tensionB, deflectionA, deflectionB) => {
    let tension = 0, deflection = 0;
    for (let i = 0; i < stays; i++) tension = Math.max(tension, Math.abs(tensionA[i] - tensionB[stays - 1 - i]) / tensionA[i]);
    for (let j = 0; j < nodes; j++) deflection = Math.max(deflection, Math.abs(deflectionA[j] - deflectionB[nodes - 1 - j]));
    return {tension, deflection};
  };
  const deckY = state => Float64Array.from(layout.deckNodes, node => state.displacements[6 * node + 1]);
  const own = asymmetry(dead.tensions, dead.tensions, deckY(dead), deckY(dead));
  const x = 37.3, weight = 20000 * statics.gravity;
  const left = statics.solve({vehicle: {x, weight}}), right = statics.solve({vehicle: {x: layout.length - x, weight}});
  const mirrored = asymmetry(left.tensions, right.tensions, deckY(left), deckY(right));
  t.diagnostic(`statics: dead load asymmetry ${sci(own.tension)} in tension, ${sci(own.deflection)} m in deflection; vehicle at ${x} m against ${layout.length - x} m: ${sci(mirrored.tension)}, ${sci(mirrored.deflection)} m`);
  assert.ok(own.tension < 1e-9 && own.deflection < 1e-12, 'static dead load is symmetric');
  assert.ok(mirrored.tension < 1e-9 && mirrored.deflection < 1e-12, 'static mirrored vehicles give mirrored results');
  // The vehicle makes the answer lopsided: the mirror test would pass trivially otherwise.
  assert.ok(asymmetry(left.tensions, left.tensions, deckY(left), deckY(left)).tension > 0.02, 'one vehicle off centre breaks the symmetry');

  const run = start => withBridge(layout, {hz: HZ, damping: 8, stayDamping: 2, vehicle: start === null ? null : {mass: 20000, speed: 0, start}}, bridge => settledMeans(bridge, 2 * HZ, HZ / 2));
  const none = await run(null), a = await run(x), b = await run(layout.length - x);
  const stepped = asymmetry(none.tension, none.tension, none.deflection, none.deflection), steppedMirror = asymmetry(a.tension, b.tension, a.deflection, b.deflection);
  t.diagnostic(`time-stepped: dead load asymmetry ${sci(stepped.tension)}, ${sci(stepped.deflection)} m; mirrored vehicles ${sci(steppedMirror.tension)}, ${sci(steppedMirror.deflection)} m; tower base moments ${(none.towerBase[5] / 1e3).toFixed(3)} and ${(none.towerBase[11] / 1e3).toFixed(3)} kN m`);
  assert.ok(stepped.tension < 1e-6 && stepped.deflection < 1e-7, 'time-stepped dead load is symmetric');
  assert.ok(steppedMirror.tension < 1e-6 && steppedMirror.deflection < 1e-7, 'time-stepped mirrored vehicles give mirrored results');
  within(none.towerBase[5], -none.towerBase[11], 1e-6, 'the tower base moments are equal and opposite');
  within(a.towerBase[5], -b.towerBase[11], 1e-6, 'mirrored vehicles swap the tower base moments');
});

test('influence lines: a slow crossing traces the static solution at every position', async t => {
  // The 20 t vehicle crosses the default bridge at 3 m/s (40 s) with the frame damped at 6 /s, 60 Hz. Every half
  // second the midspan deflection and the tension of the first main-span stay beyond the left tower are compared with
  // a static solve of the same structure with the vehicle (lever rule) at that position.
  // Tolerance 2 % of the largest change over the crossing. It is the lag of a damped structure behind a moving load:
  // a mode of angular frequency w damped at rate c answers a slow ramp c / w^2 late, here 6 / 11.3^2 = 0.047 s or
  // 0.14 m of travel, on an influence line that changes by its whole height in about 30 m (0.5 %); plus the ripple
  // the motion leaves and the vehicle's small strut effect (see the mesh test). Measured: 0.58 % and 0.35 %.
  const layout = cableStayedLayout(), hz = 60, speed = 3, stay = 4;
  await withBridge(layout, {hz, damping: 6, vehicle: {mass: 20000, speed}}, bridge => {
    const statics = bridge.statics, weight = bridge.vehicle.mass * bridge.gravity, mid = 6 * layout.midNode + 1, dead = statics.solve();
    let guess = dead.displacements, worstDeflection = 0, worstTension = 0, peakDeflection = 0, peakTension = 0, lowTension = 0, worstReaction = 0, samples = 0;
    const steps = Math.ceil(layout.length / speed * hz) + hz;
    for (let i = 0; i < steps; i++) {
      bridge.step();
      if (i % (hz / 2) !== 0) continue;
      const reference = statics.solve({vehicle: {x: bridge.out.vehicleX, weight}}, guess); guess = reference.displacements; samples++;
      worstDeflection = Math.max(worstDeflection, Math.abs(bridge.out.midspanDeflection - reference.displacements[mid]));
      worstTension = Math.max(worstTension, Math.abs(bridge.out.stayTension[stay] - reference.tensions[stay]));
      peakDeflection = Math.max(peakDeflection, Math.abs(reference.displacements[mid] - dead.displacements[mid]));
      peakTension = Math.max(peakTension, reference.tensions[stay] - dead.tensions[stay]); lowTension = Math.min(lowTension, reference.tensions[stay] - dead.tensions[stay]);
      worstReaction = Math.max(worstReaction, Math.abs(bridge.out.totalReaction[1] / bridge.totalWeight() - 1));
    }
    t.diagnostic(`${samples} positions: midspan influence line peaks at ${(peakDeflection * 1e3).toFixed(2)} mm, worst error ${(worstDeflection * 1e3).toFixed(3)} mm (${(100 * worstDeflection / peakDeflection).toFixed(2)} %); stay ${stay} changes by ${(lowTension / 1e3).toFixed(1)} to +${(peakTension / 1e3).toFixed(1)} kN, worst error ${(worstTension / 1e3).toFixed(3)} kN (${(100 * worstTension / peakTension).toFixed(2)} %); worst instantaneous sum of reactions / weight - 1 = ${sci(worstReaction)}`);
    assert.equal(bridge.out.vehicleX, layout.length, 'the vehicle reached the far abutment and stopped there');
    assert.ok(peakDeflection > 0.015 && peakTension > 5e4, 'the crossing loads the structure (20 mm and 80 kN expected)');
    assert.ok(lowTension < -1e3, 'the stay slackens a little while the vehicle is in the far side span (the influence line changes sign)');
    assert.ok(worstDeflection <= 0.02 * peakDeflection, `midspan deflection follows its influence line (${worstDeflection} m of ${peakDeflection} m)`);
    assert.ok(worstTension <= 0.02 * peakTension, `the stay tension follows its influence line (${worstTension} N of ${peakTension} N)`);
    // Instantaneous elastic reactions during motion: within 0.5 % of the weight (measured 6e-4).
    assert.ok(worstReaction < 5e-3, `the supports carry the weight throughout (${worstReaction})`);
  });
});

test('dynamics: the fundamental vertical frequency against the eigenvalue solve and a hand Rayleigh estimate, and the dynamic amplification of a fast crossing', async t => {
  const layout = cableStayedLayout(), statics = new SiBridgeStatics(layout), dead = statics.solve(), modes = statics.modes(4, dead);
  const vertical = modes.character.findIndex(share => share.y > 0.5), f1 = modes.frequencies[vertical];
  t.diagnostic(`modes (Hz): ${modes.frequencies.map((f, i) => `${f.toFixed(4)} (${modes.character[i].z > 0.5 ? 'lateral' : modes.character[i].y > 0.5 ? 'vertical' : 'towers'})`).join(', ')}`);
  assert.ok(vertical >= 0 && modes.character[0].z > 0.9, 'the lowest mode is lateral sway of the deck, the next a vertical mode');
  // The lateral mode by hand: the deck as a simply supported beam of 120 m bending sideways, f = (pi / 2) sqrt(E I_y / (m L^4)).
  // The stays add a little pendulum stiffness and their mass: 3 %.
  const lateral = Math.PI / 2 * Math.sqrt(SI_BRIDGE_DECK.youngModulus * SI_BRIDGE_DECK.iy / (SI_BRIDGE_DECK.massPerMetre * layout.length ** 4));
  t.diagnostic(`lateral mode ${modes.frequencies[0].toFixed(4)} Hz; simply supported beam by hand ${lateral.toFixed(4)} Hz (${sci(rel(modes.frequencies[0], lateral))})`);
  within(modes.frequencies[0], lateral, 0.03, 'lateral frequency against the simply supported beam');

  // Rayleigh by hand, with the deck's deflection under its own weight as the shape. An upper bound; that shape puts
  // the side spans down with the main span, where the mode lifts them, so it is a coarse one: within 25 % (measured
  // 17.7 %). One and two Stodola refinements bring it within 6 % and 3 % (measured 3.1 % and 1.5 %; the lumped
  // deck masses and the neglected tower mass are what is left).
  const rayleigh = [0, 1, 2].map(refinements => statics.rayleigh(dead, refinements).frequency);
  t.diagnostic(`first vertical mode ${f1.toFixed(4)} Hz; Rayleigh with the dead-load shape ${rayleigh[0].toFixed(4)} Hz (+${(100 * rel(rayleigh[0], f1)).toFixed(1)} %), refined once ${rayleigh[1].toFixed(4)} Hz (+${(100 * rel(rayleigh[1], f1)).toFixed(1)} %), twice ${rayleigh[2].toFixed(4)} Hz (+${(100 * rel(rayleigh[2], f1)).toFixed(1)} %)`);
  assert.ok(rayleigh[0] >= f1 && rayleigh[0] <= 1.25 * f1, 'Rayleigh with the dead-load shape is an upper bound within 25 %');
  assert.ok(rayleigh[1] < rayleigh[0] && rayleigh[2] < rayleigh[1], 'each refinement lowers the estimate');
  within(rayleigh[1], f1, 0.06, 'one Stodola refinement');
  within(rayleigh[2], f1, 0.03, 'two Stodola refinements');

  // Measured: start at rest in equilibrium with 200 kN hanging at midspan, release it, and follow the modal coordinate
  // of the first vertical mode (phi^T M u) for 8 s without added damping. Tolerance 0.5 %: the midpoint rule runs slow
  // by (w dt)^2 / 12 = 7e-4 at 120 Hz and the stays' implicit step adds as much (measured -0.14 %).
  const release = new Float64Array(statics.size); release[6 * layout.midNode + 1] = -200e3;
  await withBridge(layout, {hz: HZ, damping: 0, stayDamping: 0, releaseLoad: release}, bridge => {
    const u = bridge.frame.couplingViews().displacements, weights = statics.modalWeights(modes.shapes[vertical]), q = [];
    const coordinate = field => { let sum = 0; for (let j = 0; j < weights.length; j++) sum += weights[j] * field[j]; return sum; }, rest = coordinate(bridge.initial.displacements);
    const startDeflection = bridge.out.midspanDeflection - bridge.initial.displacements[6 * layout.midNode + 1], energy = [bridge.energy()];
    for (let i = 0; i < 8 * HZ; i++) { bridge.step(); q.push(coordinate(u) - rest); if (i % HZ === HZ - 1) energy.push(bridge.energy()); }
    const measured = crossingFrequency(q, bridge.dt), first = Math.max(...q.slice(0, HZ).map(Math.abs)), last = Math.max(...q.slice(-HZ).map(Math.abs));
    const ratio = Math.log(first / last) / (7 * 2 * Math.PI * f1);
    t.diagnostic(`released from ${(startDeflection * 1e3).toFixed(2)} mm: ${measured.hertz.toFixed(4)} Hz over ${measured.periods} periods (${sci(rel(measured.hertz, f1))}); amplitude falls ${first.toExponential(3)} to ${last.toExponential(3)}: numerical damping ratio ${(100 * ratio).toFixed(2)} % at ${HZ} Hz; energy ${energy[0].toFixed(0)} J to ${energy.at(-1).toFixed(0)} J`);
    within(measured.hertz, f1, 5e-3, 'the time-stepped fundamental vertical frequency');
    // The stays' implicit step damps: about 1 % of critical in this mode at 120 Hz. It must damp, never feed.
    assert.ok(ratio > 0 && ratio < 0.03, `the model's own damping of the first vertical mode is between 0 and 3 % (${ratio})`);
    for (let i = 1; i < energy.length; i++) assert.ok(energy[i] <= energy[i - 1], 'free vibration never gains energy');
  });

  // Dynamic amplification: the largest midspan deflection of a crossing at speed over the largest of the static
  // influence line. For a force crossing a simple span the classical envelope is 1 / (1 - a) with
  // a = (half the fundamental period) / (time on the span) = v / (2 f1 L) while a is small. Here L is the main span,
  // the deck is continuous over three spans (the load comes on smoothly) and the mode is damped about 1 %, so the
  // factor must lie between 1 (0.98 allowed for the lag of that damping) and the envelope.
  let staticPeak = 0, guess = dead.displacements;
  const mid = 6 * layout.midNode + 1;
  const probe = await freshWorld();
  let mass;
  try { const sized = new SiBridge(probe, layout, {vehicle: {mass: 20000, speed: 0}}); mass = sized.vehicle.mass; sized.dispose(); } finally { probe.destroy(); }
  // The static influence line of the midspan deflection, every 2 m and every 0.25 m around its top (at midspan).
  const positions = [];
  for (let x = 0; x <= layout.length; x += 2) positions.push(x);
  for (let x = layout.length / 2 - 2; x <= layout.length / 2 + 2; x += 0.25) positions.push(x);
  for (const x of positions) { const s = statics.solve({vehicle: {x, weight: mass * statics.gravity}}, guess); staticPeak = Math.max(staticPeak, dead.displacements[mid] - s.displacements[mid]); }
  assert.equal(staticPeak, dead.displacements[mid] - statics.solve({vehicle: {x: layout.length / 2, weight: mass * statics.gravity}}, guess).displacements[mid], 'the static peak is with the vehicle at midspan');
  for (const speed of [20, 40]) {
    await withBridge(layout, {hz: HZ, damping: 0.1, vehicle: {mass: 20000, speed}}, bridge => {
      let peak = 0;
      for (let i = 0; i < Math.ceil(layout.length / speed * HZ); i++) { bridge.step(); peak = Math.max(peak, dead.displacements[mid] - bridge.out.midspanDeflection); }
      const a = speed / (2 * f1 * SI_BRIDGE_DEFAULTS.span), factor = peak / staticPeak;
      t.diagnostic(`${speed} m/s: a = ${a.toFixed(3)}, static peak ${(staticPeak * 1e3).toFixed(2)} mm, dynamic ${(peak * 1e3).toFixed(2)} mm, amplification ${factor.toFixed(4)} (envelope ${(1 / (1 - a)).toFixed(4)})`);
      assert.ok(factor >= 0.98 && factor <= 1 / (1 - a), `amplification at ${speed} m/s is between 0.98 and 1 / (1 - a) (${factor})`);
    });
  }
});

test('stay failure: the load moves to the neighbours as the damaged statics say, the reactions stay, the energy never grows', async t => {
  // The fourth main-span stay of the left tower (the most loaded one, 502 kN) lets go of the deck at 0.5 s.
  // Frame damped at 2 /s, stays at 0.5 /s, 10 s. Compared with a static re-solve without that stay (it hangs from the tower).
  //  - Tensions of the others within 5e-4, midspan deflection within 0.05 mm: the motion left after 9.5 s (the first
  //    vertical mode decays as exp(-t)) and the coupling's bias (measured 7.8e-5 and 0.005 mm).
  //  - Mean vertical reaction over the last second within 1e-4 of the unchanged weight (the hanging stay still swings).
  //  - Energy: the released stay's strain energy is lost at once in the cable solver's implicit step, and after that
  //    the total may only fall. A rise of 1e-5 of the total between steps is allowed for the solvers' tolerances
  //    (measured: at most 0.5 J in 2e5 J).
  const layout = cableStayedLayout(), stay = 7, seconds = 10;
  await withBridge(layout, {hz: HZ, damping: 2, stayDamping: 0.5, failure: {stay, time: 0.5}}, bridge => {
    const statics = bridge.statics, weight = bridge.totalWeight(), intact = bridge.initial, damaged = statics.solve({failed: [stay]}, intact.displacements);
    let previous = bridge.energy(), worstRise = 0, atFailure = 0, peak = 0;
    const start = previous, neighbour = stay - 1;
    for (let i = 0; i < seconds * HZ - HZ; i++) {
      bridge.step();
      const energy = bridge.energy();
      if (bridge.failed.length > 0 && atFailure === 0) atFailure = energy; else worstRise = Math.max(worstRise, energy - previous);
      previous = energy; peak = Math.max(peak, bridge.out.stayTension[neighbour]);
      if (i === Math.round(0.5 * HZ) - 2) assert.deepEqual(bridge.failed, [], 'the stay holds until 0.5 s');
    }
    assert.deepEqual(bridge.failed, [stay]);
    assert.equal(bridge.failStay(stay), false, 'a stay fails once');
    const mean = settledMeans(bridge, 0, HZ), end = bridge.energy();
    let worst = 0;
    for (let i = 0; i < mean.tension.length; i++) if (i !== stay) worst = Math.max(worst, Math.abs(rel(mean.tension[i], damaged.tensions[i])));
    const midError = mean.midspan - damaged.displacements[6 * layout.midNode + 1];
    t.diagnostic(`stay ${stay} fails: neighbours ${(intact.tensions[neighbour] / 1e3).toFixed(1)} -> ${(mean.tension[neighbour] / 1e3).toFixed(1)} kN (static ${(damaged.tensions[neighbour] / 1e3).toFixed(1)}, dynamic peak ${(peak / 1e3).toFixed(1)}) and ${(intact.tensions[stay + 1] / 1e3).toFixed(1)} -> ${(mean.tension[stay + 1] / 1e3).toFixed(1)} kN (static ${(damaged.tensions[stay + 1] / 1e3).toFixed(1)}); worst tension error ${sci(worst)}; midspan ${(mean.midspan * 1e3).toFixed(3)} mm (static ${(damaged.displacements[6 * layout.midNode + 1] * 1e3).toFixed(3)}, error ${sci(midError)} m)`);
    t.diagnostic(`reactions / weight - 1 = ${sci(rel(mean.reaction[1], weight))}; energy ${start.toFixed(0)} J before, ${atFailure.toFixed(0)} J just after the failure, ${end.toFixed(0)} J at ${seconds} s; largest rise between steps ${worstRise.toFixed(3)} J; hanging stay tension ${mean.tension[stay].toFixed(0)} N`);
    assert.ok(worst < 5e-4, `the remaining stays reach the damaged static solution (${worst})`);
    near(midError, 0, 5e-5, 'the deck reaches the damaged static shape');
    // Where the load goes (static ratios damaged / intact, stays 0 to 15):
    //   0.77 0.75 0.64 0.92 | 1.39 1.79 1.69 lost | 1.04 1.11 1.13 1.06 | 1.03 1.08 1.06 1.06
    // The three main-span stays left on that tower take 39 to 79 % more; its back stays lose 8 to 36 %, because the
    // tower top, pulled 30 mm towards the main span before, comes back to 14 mm; the other tower's stays gain 3 to 13 %.
    const ratio = Array.from(mean.tension, (T, i) => T / intact.tensions[i]);
    t.diagnostic(`tension ratios after / before: ${ratio.map(v => v.toFixed(2)).join(' ')}`);
    for (const i of [4, 5, 6]) assert.ok(ratio[i] > 1.3, `main-span stay ${i} of the same tower takes at least 30 % more (${ratio[i]})`);
    assert.ok(ratio[6] > ratio[4] && ratio[5] > ratio[4], 'the nearer neighbours take more than the one by the tower');
    for (const i of [0, 1, 2, 3]) assert.ok(ratio[i] < 1, `back stay ${i} of the same tower loses load (${ratio[i]})`);
    for (let i = 8; i < 16; i++) assert.ok(ratio[i] > 1 && ratio[i] < 1.15, `stay ${i} of the other tower gains a little (${ratio[i]})`);
    assert.ok(peak > mean.tension[neighbour], 'the sudden loss overshoots the static value');
    assert.ok(mean.tension[stay] < 0.01 * intact.tensions[stay], 'the failed stay only carries its own swinging weight');
    within(mean.reaction[1], weight, 1e-4, 'the supports still carry the same weight');
    within(mean.frameReaction[1], weight, 1e-4, "by the frame solver's reactions too");
    near(mean.reaction[0], 0, 1e-4 * weight, 'horizontal reactions balance again');
    assert.ok(atFailure < start && end < atFailure, 'energy falls at the failure and afterwards');
    assert.ok(worstRise <= 1e-5 * start, `energy never grows (largest rise ${worstRise} J of ${start} J)`);
    assert.ok(bridge.out.deckUtilisation > 0 && bridge.out.deckUtilisation < 1 && bridge.out.maxStayUtilisation < 1, 'utilisation indicators stay below 1 for one lost stay');
  });
});

test('wind: a static lateral load bends the deck sideways and reaches the abutments', async t => {
  // 2 kN/m on the deck. By hand the deck is a simply supported beam of 120 m bending about its strong axis:
  // 5 q L^4 / (384 E I_y) = 67.67 mm. The stays hold it back a little, each like a pendulum of stiffness T / length,
  // so the model must be below the hand value and within 10 % of it (measured 64.21 mm, 5.1 % less). The time-stepped model against
  // its statics: 1e-4 relative. Lateral reactions: the whole load, 1e-6.
  const layout = cableStayedLayout(), q = 2000, hand = 5 * q * layout.length ** 4 / (384 * SI_BRIDGE_DECK.youngModulus * SI_BRIDGE_DECK.iy);
  await withBridge(layout, {hz: HZ, damping: 8, stayDamping: 2, windLoad: q}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), mid = layout.deckNodes.indexOf(layout.midNode), still = bridge.initial.displacements[6 * layout.midNode + 2];
    t.diagnostic(`lateral deflection at midspan ${(mean.lateral[mid] * 1e3).toFixed(3)} mm (statics ${(still * 1e3).toFixed(3)}, bare beam by hand ${(hand * 1e3).toFixed(3)}); sum Rz / (q L) + 1 = ${sci(mean.reaction[2] / (q * layout.length) + 1)}; vertical ${sci(rel(mean.reaction[1], bridge.totalWeight()))}`);
    assert.ok(mean.lateral[mid] < hand && mean.lateral[mid] > 0.9 * hand, 'the deck sways a little less than a bare beam would');
    within(mean.lateral[mid], still, 1e-4, 'time-stepped lateral deflection against statics');
    within(mean.reaction[2], -q * layout.length, 1e-6, 'the abutments and tower bases take the wind');
    within(mean.reaction[1], bridge.totalWeight(), 1e-6, 'and still the weight');
  });
});

test('determinism: two runs with a crossing vehicle, wind and a failing stay are bit-identical', async t => {
  const layout = cableStayedLayout();
  const run = () => withBridge(layout, {hz: HZ, vehicle: {mass: 20000, speed: 15, loop: true}, windLoad: 1500, failure: {stay: 7, time: 1}}, bridge => {
    for (let i = 0; i < 2 * HZ; i++) bridge.step();
    return {bytes: bridge.stateBytes(), out: JSON.stringify({midspan: bridge.out.midspanDeflection, tension: Array.from(bridge.out.stayTension), energy: bridge.energy(), x: bridge.out.vehicleX, towerBase: Array.from(bridge.out.towerBase)})};
  });
  const a = await run(), b = await run();
  t.diagnostic(`${a.bytes.length} bytes of frame, stay and vehicle state after 2 s`);
  assert.ok(a.bytes.length > 4000);
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.out, b.out);
  // Preparing the deck nodes for the vehicle ahead of time (the Lab does) changes no number.
  const warm = await withBridge(layout, {hz: HZ, vehicle: {mass: 20000, speed: 15, loop: true}, windLoad: 1500, failure: {stay: 7, time: 1}, warm: true}, bridge => { for (let i = 0; i < 2 * HZ; i++) bridge.step(); return bridge.stateBytes(); });
  assert.deepEqual(warm, a.bytes, 'warm changes when the work is done, not the result');
});

test('the vehicle: looping, parking and the model it is', async () => {
  const layout = cableStayedLayout({staysPerSide: 2});
  await withBridge(layout, {hz: HZ, vehicle: {mass: 12000, speed: 40, loop: true}}, (bridge, world) => {
    assert.ok(Math.abs(bridge.vehicle.mass - 12000) < 0.01, 'the body has the mass asked for, to float32');
    for (let i = 0; i < 4 * HZ; i++) bridge.step();
    assert.equal(bridge.vehicle.laps, 1, '160 m at 40 m/s is one lap of 120 m and a third');
    near(bridge.out.vehicleX, 40, 1e-6, 'and 40 m into the next');
    // The body rides on the chord of its element: its centre is on the line between the two nodes it is pinned to.
    const state = world.bodyState(bridge.vehicle.body), {index, xi} = bridge.statics.locate(bridge.out.vehicleX), u = bridge.frame.couplingViews().displacements;
    const a = layout.deckNodes[index], b = layout.deckNodes[index + 1], chordY = (1 - xi) * u[6 * a + 1] + xi * u[6 * b + 1];
    const chordX = (1 - xi) * (layout.positions[3 * a] + u[6 * a]) + xi * (layout.positions[3 * b] + u[6 * b]);
    near(state.position[0], chordX, 2e-5, 'body x is its deck coordinate on the deformed chord (float32 near 40 m)');
    near(state.position[0], bridge.out.vehicleX, 1e-3, 'which is the deck coordinate to within the deck\'s axial shortening');
    near(state.position[1], chordY, 2e-5, 'body y is on the chord');
    assert.ok(Math.abs(state.linearVelocity[0]) < 0.01, 'the body has no velocity along the deck: it is moved by re-attachment');
  });
  await assert.rejects(withBridge(layout, {vehicle: {mass: 20000, speed: 1, start: 500}}, () => {}), /off the deck/);
  await assert.rejects(withBridge(layout, {hz: 5}, () => {}), RangeError);
  await assert.rejects(withBridge(layout, {failure: {stay: 99, time: 1}}, () => {}), RangeError);
});

test('the Lab scene draws the model: scenery, a box per element, the stays as a rope stream, the exaggeration and the hidden body', async t => {
  const {SiBridgeScene, SI_BRIDGE_SCENE_STEP} = await import('../../src/lab/si-bridge-scene.ts');
  const world = await freshWorld(), plain = await freshWorld();
  let scene = null, reference = null;
  try {
    scene = new SiBridgeScene(world, {vehicleMass: 20000, vehicleSpeed: 10, windLoad: 0});
    const layout = scene.layout, model = scene.model;
    // 6 scenery boxes (river bed, water, two banks, two footings), 32 elements, the drawn vehicle, and the model's body last.
    assert.equal(world.bodyCount(), 6 + layout.elements.length + 2);
    assert.equal(layout.elements.length, 32);
    assert.ok(world.bodyKinds().every(kind => kind === 'box'));
    assert.equal(world.bodyIndex(model.vehicle.body), world.bodyCount() - 1, "the model's vehicle body is the last row");
    assert.equal(scene.drawnRows(world.bodyCount()), world.bodyCount() - 1, 'and is left out of the draw');
    assert.equal(scene.ropeGrid.segmentCount, 16);
    assert.equal(scene.ropeGrid.nodeCount, 32);
    // The scene steps the model exactly as the model steps itself: same numbers as a bridge alone in an empty world.
    reference = new SiBridge(plain, layout, {hz: SI_BRIDGE_SCENE_STEP.hz, subSteps: SI_BRIDGE_SCENE_STEP.subSteps, vehicle: {mass: 20000, speed: 10, loop: true}});
    for (let i = 0; i < 5 * SI_BRIDGE_SCENE_STEP.hz; i++) { scene.beforeStep(); world.step(model.dt, model.subSteps); scene.afterStep(); reference.step(); }
    assert.equal(model.out.midspanDeflection, reference.out.midspanDeflection, 'the scenery and the drawn boxes do not touch the physics');
    assert.deepEqual(Array.from(model.out.stayTension), Array.from(reference.out.stayTension));
    assert.ok(Number.isFinite(scene.takeStepCost()) && Number.isNaN(scene.takeStepCost()), 'the step cost is a mean since the last reading');
    // Drawn positions: a deck element's box hangs half its depth below the chord of its nodes; at x50 it moves 50 times as far.
    const version = scene.ropeGrid.frameVersion;
    assert.equal(scene.sync(), true); assert.equal(scene.sync(), false, 'nothing moved since');
    assert.notEqual(scene.ropeGrid.frameVersion, version);
    world.syncTransforms();
    const element = layout.deckElements[9], a = layout.elements[element].a, b = layout.elements[element].b, u = model.frame.couplingViews().displacements;
    const chordY = (u[6 * a + 1] + u[6 * b + 1]) / 2, row = 6 + element, matrices = () => world.HEAPF32.subarray(Number(world._b3w_matrices_ptr()) / 4 + 16 * row, Number(world._b3w_matrices_ptr()) / 4 + 16 * row + 16);
    const trueY = matrices()[13];
    near(trueY, chordY - 0.6, 1e-4, 'deck box centre is 0.6 m below the chord (float32 matrices)');
    assert.ok(chordY < -0.005, 'the vehicle is on the main span: the deck is down by millimetres');
    scene.exaggeration = 50;
    assert.equal(scene.sync(), true); world.syncTransforms();
    near(matrices()[13], 50 * chordY - 0.6, 2e-3, 'at x50 the drawn deflection is 50 times the true one');
    const stay = 7, top = layout.stays[stay].towerNode, bottom = layout.stays[stay].deckNode, positions = scene.ropeGrid.positions;
    near(positions[6 * stay + 4], 50 * u[6 * bottom + 1], 1e-4, 'the stay ends on the drawn deck node');
    near(positions[6 * stay], layout.positions[3 * top] + 50 * u[6 * top], 1e-4, 'and on the drawn tower node');
    assert.equal(model.out.midspanDeflection, reference.out.midspanDeflection, 'drawing does not change the model');
    // A failed stay keeps its true length below its drawn top.
    assert.equal(scene.failStay(stay), true); assert.equal(scene.failStay(stay), false);
    for (let i = 0; i < 60; i++) { scene.beforeStep(); world.step(model.dt, model.subSteps); scene.afterStep(); }
    scene.sync();
    const drawnLength = Math.hypot(positions[6 * stay + 3] - positions[6 * stay], positions[6 * stay + 4] - positions[6 * stay + 1], positions[6 * stay + 5] - positions[6 * stay + 2]);
    const cable = model.cables[stay].couplingViews().positions, trueLength = Math.hypot(cable[3] - cable[0], cable[4] - cable[1], cable[5] - cable[2]);
    near(drawnLength, trueLength, 1e-4, 'the hanging stay is drawn at its true size, not exaggerated');
    assert.ok(trueLength <= model.statics.restLengths[stay] * 1.001, 'it is slack or just taut while it swings (tension-only)');
    assert.throws(() => { scene.exaggeration = 0; }, RangeError);
    t.diagnostic(`${world.bodyCount()} bodies, ${scene.drawnRows(world.bodyCount())} drawn, ${scene.ropeGrid.segmentCount} stay segments; deck box at ${trueY.toFixed(4)} m true scale`);
  } finally { scene?.dispose(); reference?.dispose(); world.destroy(); plain.destroy(); }
  // Without a vehicle there is no hidden row.
  const empty = await freshWorld();
  try { const bare = new SiBridgeScene(empty, {vehicleMass: 0, vehicleSpeed: 0, windLoad: 0}); assert.equal(bare.drawnRows(empty.bodyCount()), empty.bodyCount()); assert.equal(empty.bodyCount(), 6 + 32); bare.dispose(); } finally { empty.destroy(); }
});

test('starting loaded: the first steps are already at rest (the coupling is primed with the static forces)', async t => {
  // The model starts in its static solution with every stay pulling hundreds of kilonewtons. StructureCoupling.prime()
  // hands the coupling those pulls and the vehicle's pin forces, and the vehicle body gets the velocity it has when it
  // rests. Without that the first step treats every attachment as new: measured 0.125 m/s node speeds, 3 kN of
  // tension error and a 5 kJ jump on this bridge, which then ring for seconds. With it: node speeds below 1e-3 m/s
  // (measured 1e-4), tensions within 1e-4 of static (measured 3e-5 after three steps) and pin forces at the lever rule
  // within 1e-3 from the first step (measured 2e-4).
  const layout = cableStayedLayout({staysPerSide: 2});
  await withBridge(layout, {hz: HZ, vehicle: {mass: 20000, speed: 0, start: 63}}, bridge => {
    const v = bridge.frame.couplingViews().velocities, start = bridge.energy(), weight = bridge.vehicle.mass * bridge.gravity, xi = bridge.statics.locate(63).xi;
    let speed = 0, tension = 0, pin = 0;
    for (let i = 0; i < 3; i++) {
      bridge.step();
      for (let j = 0; j < v.length; j++) speed = Math.max(speed, Math.abs(v[j]));
      for (let k = 0; k < bridge.out.stayTension.length; k++) tension = Math.max(tension, Math.abs(rel(bridge.out.stayTension[k], bridge.initial.tensions[k])));
      const pins = bridge.coupling.reports.filter(report => report.kind === 'frame-body');
      pin = Math.max(pin, Math.abs(rel(pins[0].force[1], weight * (1 - xi))), Math.abs(rel(pins[1].force[1], weight * xi)));
    }
    t.diagnostic(`first three steps: largest node speed ${sci(speed)} m/s, stay tension change ${sci(tension)}, pin force error ${sci(pin)}, energy change ${(bridge.energy() - start).toFixed(2)} J of ${start.toFixed(0)} J`);
    assert.ok(speed < 1e-3, `the frame starts at rest (${speed} m/s)`);
    assert.ok(tension < 1e-4, `the stays start at their static tensions (${tension})`);
    assert.ok(pin < 1e-3, `the pins start at the lever-rule forces (${pin})`);
    assert.ok(Math.abs(bridge.energy() - start) < 1e-4 * start, 'no energy is put in at the start');
    // prime() refuses what it cannot mean.
    const cableReport = bridge.coupling.reports.find(report => report.kind === 'cable-frame'), pinReport = bridge.coupling.reports.find(report => report.kind === 'frame-body');
    assert.throws(() => bridge.coupling.prime(cableReport, [0, 1, 0], [0, 0, 1]), /no moment/);
    assert.throws(() => bridge.coupling.prime(pinReport, [0, 1, 0], [0, 0, 1]), /clamped/);
    assert.throws(() => bridge.coupling.prime({...pinReport}, [0, 1, 0]), /not part of this coupling/);
    assert.throws(() => bridge.coupling.prime(pinReport, [0, NaN, 0]), /finite/);
  });
});
