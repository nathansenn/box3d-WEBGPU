// The SI cable-stayed bridge (src/engine/si-bridge.ts): the time-stepped model against its statics, a hand
// solution, symmetry, influence lines, its frequencies and a stay failure.
// Set-ups are those of tests/physics/si-bridge.test.mjs; the world and the hand solution come from its fixtures.
import {memo, defineCases, relative, absolute, upper, lower} from '../lib.mjs';
import {cableStayedLayout, proppedSpanLayout, SiBridgeStatics, SI_BRIDGE_DEFAULTS, SI_BRIDGE_DECK, SI_BRIDGE_TOWER, SI_BRIDGE_STAY} from '../../src/engine/si-bridge.ts';
import {crossingFrequency, proppedSpanHand, settledMeans, withBridge} from '../../tests/physics/si-bridge-fixtures.mjs';

const FILE = 'tests/physics/si-bridge.test.mjs', HZ = 120;
const T = {
  dead: 'dead load: the pretension levels the deck, and the supports carry deck + stays + towers + vehicle',
  hand: 'hand case: a span propped by one stay matches the flexibility-method solution at every mesh, from rest',
  mesh: 'hand case, mesh convergence: a vehicle between nodes is shared by the lever rule, an error of second order in the element',
  symmetry: 'symmetry: a symmetric bridge answers symmetrically, and mirrored vehicles give mirrored results',
  influence: 'influence lines: a slow crossing traces the static solution at every position',
  dynamics: 'dynamics: the fundamental vertical frequency against the eigenvalue solve and a hand Rayleigh estimate, and the dynamic amplification of a fast crossing',
  failure: 'stay failure: the load moves to the neighbours as the damaged statics say, the reactions stay, the energy never grows',
  wind: 'wind: a static lateral load bends the deck sideways and reaches the abutments',
  determinism: 'determinism: two runs with a crossing vehicle, wind and a failing stay are bit-identical',
};
const sections = {deck: SI_BRIDGE_DECK, tower: SI_BRIDGE_TOWER, stay: SI_BRIDGE_STAY}, SPAN = 30, COLUMN = 10;
const layout = () => cableStayedLayout();
const statics = () => memo('si-bridge/statics', () => { const s = new SiBridgeStatics(layout()), dead = s.solve(); return {s, dead, modes: s.modes(4, dead)}; });

const dead = () => memo('si-bridge/dead', async () => {
  const {s, dead: state} = await statics();
  let anchorage = 0;
  for (const stay of s.layout.stays) anchorage = Math.max(anchorage, Math.abs(state.displacements[6 * stay.deckNode + 1]));
  return withBridge(s.layout, {hz: HZ, damping: 8, stayDamping: 2, vehicle: {mass: 20000, speed: 0, start: 37.3}}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), total = bridge.totalWeight();
    let tension = 0;
    for (let i = 0; i < mean.tension.length; i++) tension = Math.max(tension, Math.abs(mean.tension[i] / bridge.initial.tensions[i] - 1));
    return {anchorage, vertical: mean.reaction[1] / total, horizontal: mean.reaction[0] / total, tension};
  });
});

const propped = (elements, vehicle) => memo(`si-bridge/propped/${elements}/${vehicle}`, () => {
  const span = SPAN, towerHeight = COLUMN, loadX = 7 * span / 16;
  return withBridge(proppedSpanLayout({span, elements, towerHeight, ...sections}), {hz: HZ, damping: 40, stayDamping: 5, start: 'undeformed', vehicle: vehicle ? {mass: 20000, speed: 0, start: loadX} : null}, bridge => {
    const mean = settledMeans(bridge, 3 * HZ, HZ / 2), gravity = bridge.gravity, load = bridge.vehicle ? bridge.vehicle.mass * gravity : 0;
    return {tension: mean.tension[0], deflection: -mean.midspan,
      linear: proppedSpanHand({span, towerHeight, ...sections, gravity, load, loadX}), exact: proppedSpanHand({span, towerHeight, ...sections, gravity, load, loadX, exact: true})};
  });
});

const mirror = () => memo('si-bridge/mirror', async () => {
  const one = layout(), x = 37.3, stays = one.stays.length, nodes = one.deckNodes.length;
  const run = start => withBridge(one, {hz: HZ, damping: 8, stayDamping: 2, vehicle: {mass: 20000, speed: 0, start}}, bridge => settledMeans(bridge, 2 * HZ, HZ / 2));
  const a = await run(x), b = await run(one.length - x);
  let tension = 0, deflection = 0;
  for (let i = 0; i < stays; i++) tension = Math.max(tension, Math.abs(a.tension[i] - b.tension[stays - 1 - i]) / a.tension[i]);
  for (let j = 0; j < nodes; j++) deflection = Math.max(deflection, Math.abs(a.deflection[j] - b.deflection[nodes - 1 - j]));
  return {tension, deflection};
});

const crossing = () => memo('si-bridge/crossing', () => {
  const one = layout(), hz = 60, speed = 3, stay = 4;
  return withBridge(one, {hz, damping: 6, vehicle: {mass: 20000, speed}}, bridge => {
    const s = bridge.statics, weight = bridge.vehicle.mass * bridge.gravity, mid = 6 * one.midNode + 1, rest = s.solve();
    let guess = rest.displacements, deflection = 0, tension = 0, peakDeflection = 0, peakTension = 0;
    for (let i = 0; i < Math.ceil(one.length / speed * hz) + hz; i++) {
      bridge.step();
      if (i % (hz / 2) !== 0) continue;
      const reference = s.solve({vehicle: {x: bridge.out.vehicleX, weight}}, guess); guess = reference.displacements;
      deflection = Math.max(deflection, Math.abs(bridge.out.midspanDeflection - reference.displacements[mid]));
      tension = Math.max(tension, Math.abs(bridge.out.stayTension[stay] - reference.tensions[stay]));
      peakDeflection = Math.max(peakDeflection, Math.abs(reference.displacements[mid] - rest.displacements[mid]));
      peakTension = Math.max(peakTension, reference.tensions[stay] - rest.tensions[stay]);
    }
    return {deflection: deflection / peakDeflection, tension: tension / peakTension, peakDeflection, peakTension};
  });
});

const vertical = async () => { const {modes} = await statics(), index = modes.character.findIndex(share => share.y > 0.5); return {index, frequency: modes.frequencies[index], shape: modes.shapes[index]}; };
const released = () => memo('si-bridge/released', async () => {
  const {s} = await statics(), mode = await vertical(), release = new Float64Array(s.size);
  release[6 * s.layout.midNode + 1] = -200e3;
  return withBridge(s.layout, {hz: HZ, damping: 0, stayDamping: 0, releaseLoad: release}, bridge => {
    const u = bridge.frame.couplingViews().displacements, weights = s.modalWeights(mode.shape), q = [];
    const coordinate = field => { let sum = 0; for (let j = 0; j < weights.length; j++) sum += weights[j] * field[j]; return sum; }, rest = coordinate(bridge.initial.displacements);
    for (let i = 0; i < 8 * HZ; i++) { bridge.step(); q.push(coordinate(u) - rest); }
    return {measured: crossingFrequency(q, bridge.dt).hertz, reference: mode.frequency};
  });
});
const amplification = speed => memo(`si-bridge/amplification/${speed}`, async () => {
  const {s, dead: rest} = await statics(), mode = await vertical(), mid = 6 * s.layout.midNode + 1;
  return withBridge(s.layout, {hz: HZ, damping: 0.1, vehicle: {mass: 20000, speed}}, bridge => {
    const still = s.solve({vehicle: {x: s.layout.length / 2, weight: bridge.vehicle.mass * bridge.gravity}}, rest.displacements);
    let peak = 0;
    for (let i = 0; i < Math.ceil(s.layout.length / speed * HZ); i++) { bridge.step(); peak = Math.max(peak, rest.displacements[mid] - bridge.out.midspanDeflection); }
    return {factor: peak / (rest.displacements[mid] - still.displacements[mid]), envelope: 1 / (1 - speed / (2 * mode.frequency * SI_BRIDGE_DEFAULTS.span))};
  });
});

const failure = () => memo('si-bridge/failure', () => {
  const one = layout(), stay = 7, seconds = 10;
  return withBridge(one, {hz: HZ, damping: 2, stayDamping: 0.5, failure: {stay, time: 0.5}}, bridge => {
    const weight = bridge.totalWeight(), intact = bridge.initial, damaged = bridge.statics.solve({failed: [stay]}, intact.displacements);
    let previous = bridge.energy(), rise = 0, failed = false;
    const start = previous;
    for (let i = 0; i < seconds * HZ - HZ; i++) {
      bridge.step();
      const energy = bridge.energy();
      if (bridge.failed.length > 0 && !failed) failed = true; else rise = Math.max(rise, energy - previous);
      previous = energy;
    }
    const mean = settledMeans(bridge, 0, HZ);
    let worst = 0;
    for (let i = 0; i < mean.tension.length; i++) if (i !== stay) worst = Math.max(worst, Math.abs(mean.tension[i] / damaged.tensions[i] - 1));
    return {worst, neighbour: mean.tension[stay - 1], neighbourStatic: damaged.tensions[stay - 1], neighbourBefore: intact.tensions[stay - 1], reaction: mean.reaction[1] / weight, rise: rise / start,
      midspan: mean.midspan, midspanStatic: damaged.displacements[6 * one.midNode + 1]};
  });
});

const wind = () => memo('si-bridge/wind', () => {
  const one = layout(), q = 2000;
  return withBridge(one, {hz: HZ, damping: 8, stayDamping: 2, windLoad: q}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), mid = one.deckNodes.indexOf(one.midNode);
    return {lateral: mean.lateral[mid], still: bridge.initial.displacements[6 * one.midNode + 2], reaction: mean.reaction[2] / (-q * one.length),
      hand: 5 * q * one.length ** 4 / (384 * SI_BRIDGE_DECK.youngModulus * SI_BRIDGE_DECK.iy)};
  });
});

const repeat = () => memo('si-bridge/repeat', async () => {
  const one = layout();
  const run = () => withBridge(one, {hz: HZ, vehicle: {mass: 20000, speed: 15, loop: true}, windLoad: 1500, failure: {stay: 7, time: 1}}, bridge => { for (let i = 0; i < 2 * HZ; i++) bridge.step(); return bridge.stateBytes(); });
  const a = await run(), b = await run();
  let different = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) different++;
  return different;
});

export default defineCases('si-bridge', FILE, [
  {id: 'si-bridge.dead.level', test: T.dead, title: 'Dead load: the pretension levels the deck', quantity: 'largest deflection at a stay anchorage (statics)', unit: 'm',
    reference: {formula: '0 (zero-displacement method)', value: 0}, tolerance: upper(1e-6), measure: async () => (await dead()).anchorage,
    note: 'The pretension iteration stops at 1e-7 m. Between anchorages the deck sags 0.185 mm on its three 12 m gaps.'},
  {id: 'si-bridge.dead.vertical', test: T.dead, title: 'Dead load with a parked 20 t vehicle: vertical reactions', quantity: 'sum of vertical reactions / total weight', unit: '1',
    reference: {formula: 'sum R_y = (m_deck + m_stays + m_towers + m_vehicle) g', value: 1}, tolerance: relative(1e-6), measure: async () => (await dead()).vertical,
    note: 'Half-second mean after a 2 s damped settle; the weight uses the float32 vehicle mass the rigid world reports.'},
  {id: 'si-bridge.dead.horizontal', test: T.dead, title: 'Dead load: horizontal reactions balance', quantity: 'sum of horizontal reactions / total weight', unit: '1',
    reference: {formula: 'sum R_x = 0', value: 0}, tolerance: absolute(1e-6), measure: async () => (await dead()).horizontal,
    note: 'The single reactions are not zero: each tower base carries 101 kN and each abutment 417 kN along the deck.'},
  {id: 'si-bridge.dead.statics', test: T.dead, title: 'Time-stepped model against its statics, vehicle parked', quantity: 'largest stay tension error (fraction)', unit: '1',
    reference: {formula: 'dense Newton statics of the same structure', value: 0}, tolerance: upper(3e-4), measure: async () => (await dead()).tension,
    note: 'The coupling has a steady-state bias that falls with the step: about 1e-4 of a stay tension at 120 Hz.'},

  {id: 'si-bridge.hand.tension', test: T.hand, title: 'Propped span, 8 elements: stay tension', quantity: 'stay tension', unit: 'N',
    reference: {formula: 'flexibility method, one redundant, true stay chord', value: null}, tolerance: relative(5e-5), measure: async () => { const r = await propped(8, false); return {value: r.tension, reference: r.exact.tension}; },
    note: 'Starts undeformed and settles. The reference uses the gravity the rigid world reports (float32).'},
  {id: 'si-bridge.hand.deflection', test: T.hand, title: 'Propped span, 8 elements: midspan deflection', quantity: 'midspan deflection', unit: 'm',
    reference: {formula: '5 w L^4 / (384 E I) + (W_e - T sin) L^3 / (48 E I)', value: null}, tolerance: relative(5e-5), measure: async () => { const r = await propped(8, false); return {value: r.deflection, reference: r.exact.deflection}; }},
  {id: 'si-bridge.hand.linear', test: T.hand, title: 'Propped span: stay tension against the linearised hand solution', quantity: 'stay tension', unit: 'N',
    reference: {formula: 'the same with the stay geometry linearised', value: null}, tolerance: relative(1e-3), measure: async () => { const r = await propped(8, false); return {value: r.tension, reference: r.linear.tension}; },
    note: 'The 19 mm sag turns and lengthens the 18 m stay at second order: (delta cos)^2 / (2 L_s) is 7.5e-4 of its stretch.'},
  {id: 'si-bridge.hand.mesh', test: T.hand, title: 'Propped span: the answer does not depend on the mesh', quantity: 'stay tension with 2 elements / with 16 elements', unit: '1',
    reference: {formula: '1 (cubic elements are exact at the nodes for these loads)', value: 1}, tolerance: relative(2e-6), measure: async () => (await propped(2, false)).tension / (await propped(16, false)).tension},
  {id: 'si-bridge.lever.coarse', test: T.mesh, title: 'Vehicle between nodes, 2 elements: lever-rule error', quantity: 'midspan deflection error (fraction, magnitude)', unit: '1',
    reference: {formula: 'hand solution with the load at its place; bound 0.2 % x h^2 xi (1 - xi) / m^2 + 1e-4', value: 0}, tolerance: upper(2e-3 * 15 * 15 * 0.875 * 0.125 + 1e-4),
    measure: async () => { const r = await propped(2, true); return Math.abs(r.deflection / r.exact.deflection - 1); },
    note: 'Two pins share the weight by the lever rule; the cubic element also needs nodal moments. The error is second order in the element length.'},
  {id: 'si-bridge.lever.fine', test: T.mesh, title: 'Vehicle between nodes, 8 elements: lever-rule error', quantity: 'midspan deflection error (fraction, magnitude)', unit: '1',
    reference: {formula: 'the same, h = 3.75 m, xi = 0.5', value: 0}, tolerance: upper(2e-3 * 3.75 * 3.75 * 0.25 + 1e-4),
    measure: async () => { const r = await propped(8, true); return Math.abs(r.deflection / r.exact.deflection - 1); }},
  {id: 'si-bridge.lever.node', test: T.mesh, title: 'Vehicle on a node, 16 elements', quantity: 'midspan deflection error (fraction, magnitude)', unit: '1',
    reference: {formula: 'the same, xi = 0: no lever-rule error', value: 0}, tolerance: upper(1e-4),
    measure: async () => { const r = await propped(16, true); return Math.abs(r.deflection / r.exact.deflection - 1); }},

  {id: 'si-bridge.symmetry.tension', test: T.symmetry, title: 'Mirrored vehicles give mirrored stay tensions', quantity: 'largest difference between mirror-image stays (fraction)', unit: '1',
    reference: {formula: 'T_i(x) = T_(N-1-i)(L - x)', value: 0}, tolerance: upper(1e-6), measure: async () => (await mirror()).tension,
    note: 'Two runs with a 20 t vehicle at 37.3 m and at 82.7 m. What is left is residual motion after a 2 s settle.'},
  {id: 'si-bridge.symmetry.deflection', test: T.symmetry, title: 'Mirrored vehicles give mirrored deflections', quantity: 'largest difference between mirror-image deck nodes', unit: 'm',
    reference: {formula: 'y_j(x) = y_(N-1-j)(L - x)', value: 0}, tolerance: upper(1e-7), measure: async () => (await mirror()).deflection},

  {id: 'si-bridge.influence.deflection', test: T.influence, title: 'Slow crossing: midspan deflection follows its influence line', quantity: 'worst error / peak of the influence line', unit: '1',
    reference: {formula: 'static solve with the vehicle at each of 82 positions', value: 0}, tolerance: upper(0.02), measure: async () => (await crossing()).deflection,
    note: '20 t at 3 m/s, frame damped at 6 /s. The error is the lag of a damped structure behind the load (about 0.14 m of travel) and the ripple of the motion.'},
  {id: 'si-bridge.influence.tension', test: T.influence, title: 'Slow crossing: a stay tension follows its influence line', quantity: 'worst error / peak of the influence line', unit: '1',
    reference: {formula: 'static solve with the vehicle at each of 82 positions', value: 0}, tolerance: upper(0.02), measure: async () => (await crossing()).tension},

  {id: 'si-bridge.frequency.vertical', test: T.dynamics, title: 'First vertical mode: time-stepped against the eigenvalue solve', quantity: 'frequency', unit: 'Hz',
    reference: {formula: 'lowest vertical root of K_t x = w^2 M x', value: null}, tolerance: relative(5e-3), measure: async () => { const r = await released(); return {value: r.measured, reference: r.reference}; },
    note: 'Released from 200 kN at midspan, 8 s, modal coordinate. The midpoint rule runs slow by (w dt)^2 / 12 and the stays add as much.'},
  {id: 'si-bridge.frequency.rayleigh', test: T.dynamics, title: 'First vertical mode: Rayleigh by hand with the dead-load shape', quantity: 'Rayleigh estimate / eigenvalue frequency', unit: '1',
    reference: {formula: 'f = sqrt(g sum(m delta) / sum(m delta^2)) / (2 pi), an upper bound', value: 1}, tolerance: upper(0.25),
    measure: async () => { const {s, dead: rest} = await statics(); return s.rayleigh(rest, 0).frequency / (await vertical()).frequency; },
    note: 'A coarse shape: the weight puts the side spans down with the main span, the mode lifts them.'},
  {id: 'si-bridge.frequency.stodola', test: T.dynamics, title: 'First vertical mode: Rayleigh with two Stodola refinements', quantity: 'frequency', unit: 'Hz',
    reference: {formula: 'the same with the inertia loads of the previous shape, twice', value: null}, tolerance: relative(0.03),
    measure: async () => { const {s, dead: rest} = await statics(); return {value: s.rayleigh(rest, 2).frequency, reference: (await vertical()).frequency}; },
    note: 'What is left is the lumping of the deck mass and the tower mass the hand method leaves out.'},
  {id: 'si-bridge.frequency.lateral', test: T.dynamics, title: 'Lowest mode: lateral sway of the deck', quantity: 'frequency', unit: 'Hz',
    reference: {formula: '(pi / 2) sqrt(E I_y / (m L^4)), simply supported over 120 m', value: Math.PI / 2 * Math.sqrt(SI_BRIDGE_DECK.youngModulus * SI_BRIDGE_DECK.iy / (SI_BRIDGE_DECK.massPerMetre * 120 ** 4))}, tolerance: relative(0.03),
    measure: async () => (await statics()).modes.frequencies[0], note: 'The stays add a little pendulum stiffness and their mass.'},
  {id: 'si-bridge.amplification.low', test: T.dynamics, title: 'Crossing at 20 m/s: dynamic amplification is at least 1', quantity: 'peak midspan deflection / static peak', unit: '1',
    reference: {formula: '1 (the static influence line)', value: 1}, tolerance: lower(0.02), measure: async () => (await amplification(20)).factor,
    note: '0.02 is allowed for the lag of the model\'s own damping (about 1 % of critical at 120 Hz).'},
  {id: 'si-bridge.amplification.envelope20', test: T.dynamics, title: 'Crossing at 20 m/s: amplification stays under the envelope', quantity: 'peak midspan deflection / static peak', unit: '1',
    reference: {formula: '1 / (1 - a), a = v / (2 f_1 L)', value: null}, tolerance: upper(0), measure: async () => { const r = await amplification(20); return {value: r.factor, reference: r.envelope}; }},
  {id: 'si-bridge.amplification.envelope40', test: T.dynamics, title: 'Crossing at 40 m/s: amplification stays under the envelope', quantity: 'peak midspan deflection / static peak', unit: '1',
    reference: {formula: '1 / (1 - a), a = v / (2 f_1 L)', value: null}, tolerance: upper(0), measure: async () => { const r = await amplification(40); return {value: r.factor, reference: r.envelope}; },
    note: 'The envelope is that of a force crossing a simple span; this deck is continuous over three spans, so the load comes on smoothly.'},

  {id: 'si-bridge.failure.tensions', test: T.failure, title: 'A stay fails: the others reach the damaged static solution', quantity: 'largest stay tension error (fraction)', unit: '1',
    reference: {formula: 'static re-solve without the stay', value: 0}, tolerance: upper(5e-4), measure: async () => (await failure()).worst,
    note: 'Stay 8 of 16 (502 kN) lets go at 0.5 s; mean over the tenth second.'},
  {id: 'si-bridge.failure.neighbour', test: T.failure, title: 'A stay fails: its neighbour takes the load the statics say', quantity: 'tension of the neighbouring stay', unit: 'N',
    reference: {formula: 'static re-solve without the stay', value: null}, tolerance: relative(5e-4), measure: async () => { const r = await failure(); return {value: r.neighbour, reference: r.neighbourStatic}; },
    note: 'From 197 kN before to 333 kN after: 69 % more.'},
  {id: 'si-bridge.failure.reaction', test: T.failure, title: 'A stay fails: the supports carry the same weight', quantity: 'sum of vertical reactions / total weight', unit: '1',
    reference: {formula: '1 (the failed stay hangs from the tower)', value: 1}, tolerance: relative(1e-4), measure: async () => (await failure()).reaction},
  {id: 'si-bridge.failure.energy', test: T.failure, title: 'A stay fails: the energy never grows', quantity: 'largest rise between steps / total energy', unit: '1',
    reference: {formula: '0 (damped, no source)', value: 0}, tolerance: upper(1e-5), measure: async () => (await failure()).rise,
    note: 'The released strain energy is lost in the cable solver\'s implicit step; after that the total only falls.'},

  {id: 'si-bridge.wind.statics', test: T.wind, title: 'Wind 2 kN/m: lateral deflection, time-stepped against statics', quantity: 'lateral deflection at midspan', unit: 'm',
    reference: {formula: 'dense Newton statics of the same structure', value: null}, tolerance: relative(1e-4), measure: async () => { const r = await wind(); return {value: r.lateral, reference: r.still}; }},
  {id: 'si-bridge.wind.beam', test: T.wind, title: 'Wind 2 kN/m: lateral deflection against a bare beam', quantity: 'lateral deflection at midspan', unit: 'm',
    reference: {formula: '5 q L^4 / (384 E I_y)', value: null}, tolerance: relative(0.1), measure: async () => { const r = await wind(); return {value: r.lateral, reference: r.hand}; },
    note: 'The stays hold the deck back like pendulums of stiffness T / length, so the model is below the bare beam.'},
  {id: 'si-bridge.wind.reaction', test: T.wind, title: 'Wind 2 kN/m: the supports take the whole load', quantity: 'sum of lateral reactions / (q L)', unit: '1',
    reference: {formula: 'sum R_z = -q L', value: 1}, tolerance: relative(1e-6), measure: async () => (await wind()).reaction},

  {id: 'si-bridge.determinism', test: T.determinism, title: 'Two runs with a vehicle, wind and a failing stay', quantity: 'differing bytes of the final state', unit: 'bytes',
    reference: {formula: '0 (bit-identical)', value: 0}, tolerance: absolute(0), measure: repeat},
]);
