// The SI suspension footbridge (src/engine/si-suspension.ts), the Studio bridge's validated model: against its statics,
// closed forms and itself. Measured values are printed as diagnostics and recorded in docs/SI_BRIDGE.md; the same
// measurements feed validation/domains/si-suspension.mjs. Nothing here asserts on wall-clock time.
//
// What sets the tolerances:
//  - The time-stepped model (frame runtime, Newton cable solve, StructureCoupling's joint step) and the static solver in the
//    same file share the element matrices and the segment law and nothing else. At rest they agree to the solvers'
//    stopping tolerances (0.05 N on forces of 1e3 to 1e5 N): readings are means over half a second after a damped settle.
//  - The closed forms idealise: the parabola assumes a uniform load (the hangers next to the towers carry 13 % more);
//    the deflection theory assumes a continuous membrane of hangers that do not stretch; the tensioned-beam frequency
//    neglects the towers and the discreteness of the hangers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {CompliantCableRuntime, hangingCableDefinition} from '../../src/engine/compliant-cable.ts';
import {FrameRuntime} from '../../src/engine/frame-runtime.ts';
import {suspensionLayout, SiSuspensionStatics, SI_SUSPENSION_DEFAULTS} from '../../src/engine/si-suspension.ts';
import {freshWorld} from './si-bridge-fixtures.mjs';
import {
  defaultStatics, measureCable, measureCrowd, measureDead, measureFailure, measureForm, measureMirror, measureModes, measurePoint, measureRelease,
  measureRepeat, measureVehicle, measureWind,
} from './si-suspension-fixtures.mjs';

const sci = value => value.toExponential(2);
const within = (actual, expected, fraction, label) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * fraction, `${label}: got ${actual}, expected ${expected} within ${fraction}`);

test('the layout is the Studio footbridge: 42 m span, 36 panels, saddles at 14 m, 6.8 m sag, cables 3.8 m apart', () => {
  const L = suspensionLayout(), p = L.params;
  assert.equal(L.stationX.length, 37); assert.equal(L.stationX[0], -21); assert.equal(L.stationX[36], 21); assert.equal(L.stationX[18], 0);
  for (let j = 0; j <= 36; j++) assert.ok(L.stationX[j] === -L.stationX[36 - j], `station ${j} mirrors`);
  assert.equal(L.segments.filter(s => s.kind === 'hanger').length, 70); assert.equal(L.segments.filter(s => s.kind === 'main').length, 72); assert.equal(L.segments.filter(s => s.kind === 'backstay').length, 4);
  for (const t of L.towers) for (const node of t.saddles) { assert.equal(L.positions[3 * node + 1], 14); assert.equal(Math.abs(L.positions[3 * node]), 21); }
  const mid = L.cablePoints[0][18]; assert.equal(L.points[3 * mid + 1], p.saddleY - p.sag);
  assert.deepEqual([p.halfWidth, p.deckY, p.anchorX, p.anchorZ], [1.9, 4.8, 31, 4.3]);
  assert.throws(() => suspensionLayout({panels: 35}), /even/); assert.throws(() => suspensionLayout({sag: 10}), /above the deck/);
});

test('form-finding: the deck is level at every hanger, the cable passes the drawn midspan height, the hangers hang plumb', async () => {
  const r = await measureForm();
  console.log(`deck level ${sci(r.deckLevel)} m, midspan cable ${r.midHeight} m (target ${r.target}), plumb ${sci(r.plumb)} m, ${r.passes} passes`);
  assert.ok(r.deckLevel < 1e-6, 'deck level within a micrometre');
  assert.ok(Math.abs(r.midHeight - r.target) < 1e-6, 'midspan height within a micrometre');
  // The backstays pull the saddles 0.25 mm outwards; the main cable follows, the deck does not.
  assert.ok(r.plumb < 5e-4, 'hangers plumb within half a millimetre');
});

test('dead load: the supports carry the whole weight and the horizontal forces balance (statics)', async () => {
  const r = await measureDead();
  console.log(`weight ${(r.weight / 1e3).toFixed(1)} kN, vertical ${r.vertical}, horizontal ${sci(r.horizontal)}, residual ${sci(r.residual)} N`);
  within(r.vertical, 1, 1e-9, 'vertical reactions / weight'); assert.ok(r.horizontal < 1e-9);
});

test('main cable under dead load: H against w L^2 / 8 f, tension at the towers, hangers against the continuous deck', async () => {
  const r = await measureCable();
  console.log(`H ${(r.H / 1e3).toFixed(2)} kN against the parabola ${(r.parabola / 1e3).toFixed(2)} kN; tower end ${(r.end / 1e3).toFixed(2)} kN against sqrt(H^2+V^2) ${(r.polygon / 1e3).toFixed(2)} kN and the parabola ${(r.parabolaEnd / 1e3).toFixed(2)} kN; midspan hanger ${r.hanger.toFixed(1)} N against ${r.perPanel.toFixed(1)} N; end hanger ${r.endHanger.toFixed(3)} x`);
  // The parabola takes the load as uniform; the end hangers carry 13 % more (end span of a continuous beam).
  within(r.H, r.parabola, .03, 'H against the parabola');
  within(r.end, r.polygon, 1e-6, 'tower tension against sqrt(H^2 + V^2)');
  within(r.end, r.parabolaEnd, .03, 'tower tension against the parabola');
  within(r.hanger, r.perPanel, 1e-5, 'midspan hanger against one panel of deck');
  assert.ok(r.endHanger > 1.1 && r.endHanger < 1.16, 'end hangers carry the end-span share');
});

test('a 20 kN point load: deck deflection and cable force against the linearised deflection theory', async () => {
  for (const kind of ['mid', 'quarter', 'antisymmetric']) {
    const r = await measurePoint(kind);
    console.log(`${kind}: deflection ${(r.deflection * 1e3).toFixed(3)} mm against ${(r.theory * 1e3).toFixed(3)} mm (${((r.deflection / r.theory - 1) * 100).toFixed(2)} %); cable force +${(r.h / 1e3).toFixed(3)} kN against ${(r.hTheory / 1e3).toFixed(3)} kN`);
    // The theory has inextensible hangers in a continuous membrane and a pinned saddle spring; the model 35 elastic hangers.
    within(r.deflection, r.theory, .05, `${kind} deflection`);
    if (kind !== 'antisymmetric') within(r.h, r.hTheory, .01, `${kind} cable force`);
    else assert.ok(Math.abs(r.h) < 50, 'an antisymmetric load leaves the cable force unchanged (first order)');
  }
});

test('natural frequencies: the first antisymmetric vertical mode against the tensioned-beam closed form', async () => {
  const r = await measureModes();
  console.log(`antisymmetric ${r.antisymmetric.f.toFixed(4)} Hz (mode ${r.antisymmetric.i + 1}) against ${r.closed.toFixed(4)} Hz; first symmetric vertical ${r.symmetric.f.toFixed(4)} Hz; ${r.mass.toFixed(1)} kg/m`);
  within(r.antisymmetric.f, r.closed, .02, 'antisymmetric mode');
  assert.equal(r.antisymmetric.i, 0, 'the lowest mode is the antisymmetric vertical one');
  assert.ok(r.symmetric.f > r.antisymmetric.f, 'the symmetric mode stretches the cable and is stiffer');
});

test('time-stepped, crowd on the west half: equal to the statics, the supports carry structure and crowd', async () => {
  const r = await measureCrowd();
  console.log(`tension ${sci(r.tension)}, deflection ${sci(r.deflection)} m, vertical ${r.vertical}, peak ${(r.peak * 1e3).toFixed(2)} mm`);
  assert.ok(r.tension < 1e-6); assert.ok(r.deflection < 1e-7); within(r.vertical, 1, 1e-6, 'reactions'); assert.ok(r.horizontal < 1e-6);
});

test('time-stepped, released from antisymmetric loads: the frequency of the first antisymmetric mode', async () => {
  const r = await measureRelease();
  console.log(`measured ${r.measured.toFixed(4)} Hz against the eigenvalue solve ${r.reference.toFixed(4)} Hz`);
  // The frame's midpoint rule runs slow by (w h)^2 / 12 = 5e-5; the cables' implicit Euler step adds as much again.
  within(r.measured, r.reference, 2e-3, 'antisymmetric frequency');
});

test('symmetry: crowds on the west and east thirds give mirror-image answers', async () => {
  const r = await measureMirror();
  console.log(`statics ${sci(r.statics.tension)}, ${sci(r.statics.deflection)} m; time-stepped ${sci(r.stepped.tension)}, ${sci(r.stepped.deflection)} m`);
  assert.ok(r.statics.tension < 1e-9 && r.statics.deflection < 1e-12);
  assert.ok(r.stepped.tension < 1e-6 && r.stepped.deflection < 1e-9);
});

test('a hanger fails: the load moves to its neighbours as the damaged statics say', async () => {
  const r = await measureFailure();
  console.log(`against the damaged statics: tension ${sci(r.tension)}, deflection ${sci(r.deflection)} m; neighbours ${r.neighbourGain.map(v => v.toFixed(4))} (statics ${r.neighbourStatic.map(v => v.toFixed(4))}); reactions ${r.reaction}`);
  assert.equal(r.failed.length, 1); assert.ok(r.tension < 1e-4); assert.ok(r.deflection < 1e-6);
  for (const gain of r.neighbourGain) assert.ok(gain > 1.4 && gain < 1.6, 'each neighbour takes about half of the lost hanger');
  within(r.reaction, 1, 1e-5, 'reactions keep the weight');
});

test('wind on the deck: lateral deflection equal to the statics, the bearings carry the whole lateral load', async () => {
  const r = await measureWind();
  console.log(`lateral ${(r.lateral * 1e3).toFixed(4)} mm (statics ${(r.still * 1e3).toFixed(4)} mm), reactions ${r.reaction}`);
  within(r.lateral, r.still, 1e-6, 'lateral'); within(r.reaction, 1, 1e-6, 'lateral reactions');
});

test('a parked service vehicle on the Box3D world: equal to the statics with its weight at its place', async () => {
  const world = await freshWorld();
  try {
    const r = await measureVehicle(world);
    console.log(`tension ${sci(r.tension)}, deflection ${sci(r.deflection)} m, reactions ${r.vertical}`);
    assert.ok(r.tension < 1e-6); assert.ok(r.deflection < 1e-7); within(r.vertical, 1, 1e-6, 'reactions');
  } finally { world.destroy(); }
});

test('determinism: two runs with a changing crowd, wind and a failing hanger are bit-identical', async () => {
  const r = await measureRepeat();
  assert.equal(r.different, 0, `${r.different} of ${r.bytes} bytes differ`);
});

test('the Newton cable backend solves the same implicit step as the proximal one', () => {
  const config = {dt: 1 / 120, substeps: 4, maxIterations: 4096, residualTolerance: 1e-12, forceTolerance: 1e-7, drag: 0, gravity: [0, -9.81, 0]};
  const make = solver => new CompliantCableRuntime(hangingCableDefinition({segments: 8, length: 2, linearDensity: .25, tipMass: 1, axialRigidity: 5e3, config: {...config, solver}}));
  const a = make('proximal'), b = make('newton');
  b.step({ticks: 0}); // no-op check of the API
  for (const runtime of [a, b]) runtime.step({ticks: 60, commands: [{tick: 1, type: 'impulse', node: 8, value: [.4, 0, .1]}]});
  const pa = a.inspect().positions, pb = b.inspect().positions;
  let worst = 0; for (let i = 0; i < pa.length; i++) worst = Math.max(worst, Math.abs(pa[i] - pb[i]));
  console.log(`largest position difference after 60 ticks ${sci(worst)} m`);
  assert.ok(worst < 1e-7);
  assert.throws(() => new CompliantCableRuntime({...hangingCableDefinition({segments: 2, length: 1, linearDensity: 1, tipMass: 0, axialRigidity: 1e3, config: {...config, solver: 'newton'}}), constraints: [{a: 0, b: 1, restLength: .5, compliance: 0}, {a: 1, b: 2, restLength: .5, compliance: 0}]}), /elastic/);
});

test('the frame runtime\'s direct solver gives the conjugate-gradient answer', () => {
  const positions = [0, 0, 0, 2, 0, 0, 4, 0, 0, 6, 0, 0], fixed = new Array(24).fill(0); for (let k = 0; k < 6; k++) fixed[k] = 1;
  const element = (a, b) => ({a, b, youngModulus: 210e9, shearModulus: 81e9, area: 1e-3, iy: 2e-6, iz: 3e-6, torsionConstant: 1e-6, density: 7850, up: [0, 1, 0]});
  const make = solver => new FrameRuntime({config: {dt: 1 / 120, substeps: 1, maxIterations: 1024, drag: .5, gravity: [0, -9.81, 0], forceTolerance: 1e-9, momentTolerance: 1e-9, impulseTolerance: 1e-12, angularImpulseTolerance: 1e-12, ...(solver ? {solver} : {})},
    positions, elements: [element(0, 1), element(1, 2), element(2, 3)], fixed});
  const cg = make(), direct = make('direct');
  const a = cg.solveStatic().displacements, b = direct.solveStatic().displacements;
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= 1e-9 * Math.max(1, Math.abs(a[i])) + 1e-12);
  const sa = cg.step({ticks: 30}).displacements, sb = direct.step({ticks: 30}).displacements;
  for (let i = 0; i < sa.length; i++) assert.ok(Math.abs(sa[i] - sb[i]) <= 1e-9 * Math.max(1e-3, Math.abs(sa[i])));
  direct.setLoads(new Float64Array(24).fill(0).map((_, j) => j === 19 ? -1000 : 0));
  assert.ok(direct.step({ticks: 1}).displacements[19] < sb[19]);
});

test('the statics reject invalid loads and a section change moves the answer the right way', () => {
  const {statics: s} = defaultStatics();
  assert.throws(() => s.crowdLoad(1000, 5, 5), /whole panels/); assert.throws(() => s.locate(30), /off the deck/);
  const stiffer = new SiSuspensionStatics(suspensionLayout({girder: {...SI_SUSPENSION_DEFAULTS.girder, iz: 2 * SI_SUSPENSION_DEFAULTS.girder.iz}}));
  const nodal = new Float64Array(6 * s.frameNodes); for (const side of [0, 1]) nodal[6 * s.layout.girders[side][9] + 1] = -1e4;
  const soft = s.solve({nodal}), stiff = stiffer.solve({nodal}), j = 6 * s.layout.girders[0][9] + 1;
  assert.ok(Math.abs(stiff.displacements[j] - stiffer.dead.displacements[j]) < Math.abs(soft.displacements[j] - s.dead.displacements[j]));
});
