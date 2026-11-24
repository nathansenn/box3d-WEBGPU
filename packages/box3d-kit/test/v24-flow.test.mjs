// Flow around and through geometry (box3d-webgpu-kit/flow) against closed forms, published data and its own
// conservation laws, plus the study and result documents. The set-ups live in flow-scenarios.mjs, which the validation
// report (validation/domains/flow.mjs) runs too, with the same bands; docs/FLOW.md records the measured values.
// Nothing here depends on wall-clock time.
//
// Facts that set the bands:
//  - Interpolated bounce-back puts a wall to second order; on a circle the error does not fall evenly with the cell
//    size. Bodies 8 to 10 cells across carry errors of several percent to 15%; tunnels are bounded (blockage 3 to 6%)
//    and nothing is corrected for it.
//  - Above a cell Reynolds number of 10 the solver is an under-resolved large-eddy simulation: sharp-edged bodies are
//    held to 15%, a smooth sphere at high Reynolds number is not held at all (docs/FLOW.md says why).
//  - Mass is conserved on the lattice to round-off; repeat runs give the same bits.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {capabilities, EngineError} from 'box3d-webgpu-kit';
import * as K from 'box3d-webgpu-kit/flow';
import * as S from './flow-scenarios.mjs';
import {checkSchema} from './flow-schema-check.mjs';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const schema = name => JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));

test('the flow module names its solver and formats, and refuses bad studies with a message', () => {
  assert.equal(K.FLOW_SOLVER_ID, 'flow-lbm-d3q19-regularized-les-js-f64-v1');
  assert.equal(K.FLOW_STUDY_FORMAT, 'box3d-flow-study/1');
  assert.equal(K.FLOW_RESULT_FORMAT, 'box3d-flow-result/1');
  assert.ok(Array.isArray(capabilities().modules));
  const base = {format: 'box3d-flow-study/1', fluid: 'air', mode: 'external', geometry: [{kind: 'box', center: [0, 1, 0], size: [2, 2, 2]}], external: {speed: 10}};
  assert.throws(() => K.flowStudySetup({...base, format: 'x'}), EngineError);
  assert.throws(() => K.flowStudySetup({...base, extra: 1}), /unknown field "extra"/);
  assert.throws(() => K.flowStudySetup({...base, geometry: [{kind: 'box', center: [0, 0, 0], size: [1, 1, 1], halfExtents: [1, 1, 1]}]}), EngineError, 'size and halfExtents');
  assert.throws(() => K.flowStudySetup({...base, mode: 'internal', external: undefined, internal: {inlets: [{name: 'a', shape: {kind: 'disc', center: [0, 0, 0], normal: [1, 0, 0], radius: 0.1}, flowRate: 1}],
    outlets: [{name: 'b', shape: {kind: 'disc', center: [1, 0, 0], normal: [1, 0, 0], radius: 0.1}, flowRate: 1}]}}), /at least one outlet given by a pressure/);
  // the default margins and the conventions of apex-flow-geometry/1
  const setup = K.flowStudySetup(base);
  assert.deepEqual(K.FLOW_MARGINS, {upstream: 3, downstream: 6, side: 2.5, top: 2.5});
  assert.equal(setup.external.margins.upstream, 3);
  const items = K.flowItemsFromApexGeometry({schema: 'apex-flow-geometry/1', frame: {units: 'm', up: '+y', quaternion: 'xyzw'}, parts: [{id: 'L1', name: 'Shell'}],
    primitives: [{shape: 'box', part: 0, element: 'e1', center: [0, 1, 0], rotation: [0, 0, 0, 1], size: [2, 2, 4]}, {shape: 'cylinder', part: 0, element: 'e2', center: [0, 1, 3], rotation: [0, 0, 0, 1], radius: 0.5, length: 2}],
    meshes: [{part: 0, positions: [0, 0, 0, 1, 0, 0, 1, 1, 0], indices: [0, 1, 2], elements: [{element: 'p1', triStart: 0, triCount: 1, closed: false, thickness: 0.01}]}]}, {role: 'solid'});
  assert.deepEqual(items.map(i => [i.kind, i.part, i.id ?? null]), [['box', 'L1', 'e1'], ['cylinder', 'L1', 'e2'], ['mesh', 'L1', null]]);
  const box = K.flowGeometryBounds(items.slice(0, 1)), cylinder = K.flowGeometryBounds(items.slice(1, 2));
  near(box.max[2], 2, 1e-12, 'the box has the FULL size 4 along z'); near(box.min[1], 0, 1e-12, 'and 2 along y about y = 1');
  near(cylinder.min[1], 0, 1e-12, 'the cylinder is 2 long along its local +y about y = 1'); near(cylinder.max[1], 2, 1e-12, 'its other end');
  near(cylinder.max[2], 3.5, 1e-9, 'its radius 0.5 across');
});

test('ducts and pipes driven by a pressure gradient: plane Poiseuille, a square duct and a round pipe drawn as meshes and primitives, a finer pipe, the force on the walls', () => {
  const plane = S.poiseuillePlane(K);
  within(plane.flowRate, plane.exact, 0.05, 'plane Poiseuille between mesh walls off the grid lines');
  const duct = S.squareDuct(K);
  within(duct.flowRate, duct.exact, 0.05, 'square duct as a mesh');
  const p12 = S.pipe(K, {n: 12}), fine = S.pipe(K, {n: 24, tau: 0.6}), mesh = S.pipe(K, {n: 12, source: 'mesh'});
  within(p12.flowRate, p12.exact, 0.03, 'pipe drawn as a cylinder');
  within(mesh.flowRate, mesh.exact, 0.03, 'pipe drawn as a swept mesh');
  within(fine.flowRate, fine.exact, 0.02, 'pipe at 24 cells across, relaxation time 0.6');
  near(p12.forceBalance, 0, 1e-6, 'the wall takes the driving force');
  console.log(`  ducts: plane ${plane.error.toFixed(4)}, square ${duct.error.toFixed(4)}, pipe ${p12.error.toFixed(4)}, at 24 cells ${fine.error.toFixed(4)}, mesh pipe ${mesh.error.toFixed(4)}`);
});

test('a pipe drawn as a fluid cylinder, through its openings: Hagen-Poiseuille pressure drop, the developed profile, the mass balance', () => {
  const r = S.pipeStudy(K, {re: 100});
  within(r.drop, r.exact, 0.05, 'pressure drop over 2 D');
  within(r.peakOverMean, 2, 0.03, 'peak over mean speed');
  near(r.massBalance, 0, 1e-4, 'mass balance');
  assert.equal(r.turbulence, 'none');
  console.log(`  pipe at Re 100: drop ${r.error.toFixed(4)}, peak / mean ${r.peakOverMean.toFixed(4)}, ${r.cellsAcross.toFixed(1)} cells across`);
});

test('a laminar round pipe at Re 500 to 1500, periodic, started from the exact parabola: the flow rate against Hagen-Poiseuille, and the warning below the resolution that holds it', () => {
  for (const [re, n, viscousTimes] of [[500, 20, 8], [1000, 48, 3], [1500, 64, 2]]) {
    const r = S.laminarPipe(K, {re, n, viscousTimes});
    within(r.flowRate, r.exact, 0.03, `flow rate at Re ${re}, ${n} cells across`);
    assert.ok(r.secondary < 0.01, `secondary flow at Re ${re}: ${r.secondary}`);
    assert.equal(r.warned, false);
    console.log(`  laminar pipe at Re ${re}, ${n} cells (cell Re ${r.cellReynolds.toFixed(1)}): flow rate ${r.error.toFixed(4)}, secondary ${r.secondary.toExponential(2)}`);
  }
  const coarse = S.laminarPipe(K, {re: 1000, n: 16});
  assert.ok(coarse.error < -0.1, `the coarse pipe is expected to miss: ${coarse.error}`);
  assert.equal(coarse.warned, true);
  console.log(`  laminar pipe at Re 1000, 16 cells (cell Re ${coarse.cellReynolds.toFixed(1)}): flow rate ${coarse.error.toFixed(4)}, warned`);
});

test('sparse storage: the same bits as dense storage on an L of pipes, and a long L whose box is three times the dense limit', () => {
  const r = S.sparseStorage(K);
  assert.equal(r.small.populations, 0, 'populations that differ between dense and sparse storage');
  assert.equal(r.small.fields, 0, 'field cells that differ');
  assert.equal(r.small.sums, true, 'forces and flow rates');
  assert.ok(r.big.overDenseLimit > 2.5, `box over the dense limit: ${r.big.overDenseLimit}`);
  assert.ok(r.big.healthy);
  near(r.big.massError, 0, 1e-6, 'mass gained against mass through the openings');
  assert.ok(r.big.inflow > 0);
  console.log(`  sparse: small box ${r.small.box} cells, ${r.small.stored} stored, identical; long L: box ${r.big.box} cells (${r.big.overDenseLimit.toFixed(2)} x the dense limit), ${r.big.stored} stored, ${r.big.fluidCells} fluid, set-up ${r.big.setupSeconds.toFixed(1)} s, ${(r.big.cellUpdatesPerSecond / 1e6).toFixed(2)} M cell updates/s, box arrays ${(r.big.sparseBytes / 1e6).toFixed(0)} MB against ${(r.big.denseBytes / 1e9).toFixed(2)} GB dense`);
});

test('the circular cylinder: drag and recirculation at Re 20 and 40, drag and Strouhal number at Re 100 and 200', () => {
  const r20 = S.cylinderSteady(K, {re: 20}), r40 = S.cylinderSteady(K, {re: 40});
  within(r20.cd, 2.091, 0.08, 'Cd at Re 20'); within(r20.recirculation, 0.93, 0.08, 'recirculation at Re 20');
  within(r40.cd, 1.539, 0.1, 'Cd at Re 40'); within(r40.recirculation, 2.23, 0.1, 'recirculation at Re 40');
  const r100 = S.cylinderShedding(K, {re: 100}), r200 = S.cylinderShedding(K, {re: 200});
  within(r100.cd, 1.334, 0.15, 'Cd at Re 100');
  within(r100.strouhal, -3.3265 / 100 + 0.1816 + 1.6e-4 * 100, 0.08, 'St at Re 100 (Williamson)');
  within(r200.strouhal, 0.196, 0.08, 'St at Re 200');
  console.log(`  cylinder: Re 20 Cd ${r20.cd.toFixed(3)} L ${r20.recirculation.toFixed(3)}; Re 40 Cd ${r40.cd.toFixed(3)} L ${r40.recirculation.toFixed(3)}; Re 100 Cd ${r100.cd.toFixed(3)} St ${r100.strouhal.toFixed(4)}; Re 200 St ${r200.strouhal.toFixed(4)}`);
});

test('bluff bodies: a sphere at Re 100, a cube and a square plate at Re 1e5', () => {
  const sphere = S.sphere(K, {re: 100}), cube = S.sharpBody(K, {shape: 'cube'}), plate = S.sharpBody(K, {shape: 'plate'});
  within(sphere.cd, 24 / 100 * (1 + 0.15 * 100 ** 0.687), 0.2, 'sphere at Re 100 (Schiller-Naumann)');
  within(cube.cd, 1.05, 0.15, 'cube at Re 1e5 (Hoerner)');
  within(plate.cd, 1.17, 0.15, 'square plate at Re 1e5 (Hoerner)');
  assert.equal(cube.turbulence, 'smagorinsky');
  console.log(`  bodies: sphere ${sphere.cd.toFixed(3)}, cube ${cube.cd.toFixed(3)}, plate ${plate.cd.toFixed(3)}`);
});

test('a rectangular building on fixed ground through the study runner: drag coefficient and the largest surface pressure coefficient', () => {
  const r = S.building(K);
  near(r.cd, 1.35, 0.35, 'Cd in the band 1.0 to 1.7');
  near(r.cpMax, 1, 0.2, 'stagnation Cp');
  near(r.cpMaxResolved, 1, 0.2, 'stagnation Cp, resolved samples');
  console.log(`  building: Cd ${r.cd.toFixed(3)}, Cp max ${r.cpMax.toFixed(3)} (resolved ${r.cpMaxResolved.toFixed(3)}), ${r.bodyCells.toFixed(1)} cells across, blockage ${r.blockage.toFixed(3)}`);
});

test('the stagnation pressure coefficient of a cube and a sphere in a free stream through the study runner is 1 within 0.1', () => {
  for (const shape of ['cube', 'sphere']) {
    const r = S.stagnation(K, {shape});
    near(r.cpMaxResolved, 1, 0.1, `${shape}: largest resolved surface Cp`);
    console.log(`  ${shape}: Cp max ${r.cpMax.toFixed(3)} (resolved ${r.cpMaxResolved.toFixed(3)}, ${r.flagged} of ${r.vertices} samples flagged), largest cell Cp ${r.cellCpMax.toFixed(3)} (resolved ${r.cellCpMaxResolved.toFixed(3)}), ${r.cellsAcross.toFixed(1)} cells across`);
  }
});

test('the backward-facing step at Re 100: reattachment length against Armaly et al. (1983)', () => {
  const r = S.backwardStep(K, {re: 100});
  within(r.reattachment, 3.0, 0.12, 'reattachment over the step height');
  console.log(`  step: x / S ${r.reattachment.toFixed(3)}`);
});

test('internal flows through the study runner: the sudden expansion against Borda-Carnot, a symmetric tee, a tank with three inlets', () => {
  const expansion = S.suddenExpansion(K);
  within(expansion.rise, expansion.exact, 0.15, 'pressure rise behind a sudden expansion');
  const tee = S.teeSplit(K);
  near(tee.left, 0.5, 0.03, 'split of a symmetric tee'); near(tee.massBalance, 0, 1e-3, 'tee mass balance');
  const tank = S.tank(K);
  near(tank.massBalance, 0, 1e-3, 'tank mass balance'); assert.ok(tank.inletError <= 1e-3, `inlet flows: ${tank.inletError}`);
  console.log(`  internal: expansion ${expansion.error.toFixed(4)}, tee ${tee.left.toFixed(4)} / ${tee.right.toFixed(4)}, tank balance ${tank.massBalance.toExponential(2)}`);
});

test('Stokes drag on a sphere in a periodic cube against Hasimoto (1959), and the force on the sphere against the body force on the fluid', () => {
  const r = S.stokesSphere(K, {n: 16});
  within(r.drag, r.exact, 0.1, 'Hasimoto drag');
  near(r.forceBalance, 0, 1e-6, 'drag equals the body force on the fluid');
  console.log(`  Stokes: ${r.error.toFixed(4)}, Re ${r.reynolds.toFixed(3)}`);
});

test('conservation: mass through openings and walls, a closed box', () => {
  const r = S.massLedger(K);
  near(r.interpolated.error, 0, 1e-12, 'mass ledger, interpolated walls');
  near(r.halfway.error, 0, 1e-12, 'mass ledger, half-way walls');
  near(r.closed, 0, 1e-12, 'closed periodic box');
});

test('determinism: repeat runs are bit-identical, and a run resumed from a checkpoint continues with the same bits', () => {
  const r = S.determinism(K);
  assert.ok(r.same, 'two runs'); assert.ok(r.resumed && r.sumsEqual && r.time, 'resumed run'); assert.ok(r.healthy);
  assert.equal(r.turbulence, 'smagorinsky');
});

test('geometry: meshes against primitives, imperfect meshes, thin walls that do not leak', () => {
  const m = S.meshAgainstPrimitive(K);
  assert.ok(m.sphere.differ <= 12, `sphere: ${m.sphere.differ} cells differ`); assert.equal(m.box.differ, 0);
  const i = S.imperfectMesh(K);
  assert.equal(i.soupDiffers, 0); assert.equal(i.holedDiffers, 0); assert.equal(i.holedClosed, 0); assert.ok(i.holedWarnings >= 1);
  const t = S.thinWallLeak(K);
  assert.equal(t.leaking, 0, 'no box leaks');
  assert.ok(t.thickened.boxes > 0 && t.closedCells.meshes > 0, 'the thickening is reported');
  const f = S.thinFeatures(K);
  assert.ok(f.panelWarnings.some(w => /grown/.test(w)) && f.beamWarnings.some(w => /grown/.test(w)));
});

test('streamlines: straight in a uniform flow, a closed circle in a solid-body rotation', () => {
  const r = S.tracer(K);
  assert.ok(r.straight <= 1e-4, `straight: ${r.straight}`);
  assert.ok(r.radial <= 1e-4, `circle: ${r.radial}`);
  assert.equal(r.termination, 'outside');
});

test('the study runner: an internal and an external study fit the result schema, ends of streamlines, mesh elements, provenance', () => {
  const resultSchema = schema('flow-result'), studySchema = schema('flow-study');
  const R = 0.1, internal = {format: 'box3d-flow-study/1', name: 'tee', fluid: 'water', mode: 'internal',
    geometry: [{kind: 'cylinder', center: [0.5, 0, 0], length: 1, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], radius: R, role: 'cavity', part: 'main', id: 'm1'}, {kind: 'cylinder', from: [0.5, 0, 0], to: [0.5, 0.5, 0], radius: R, role: 'cavity', part: 'branch'}],
    internal: {inlets: [{name: 'in', shape: {kind: 'disc', center: [0, 0, 0], normal: [-1, 0, 0], radius: R}, flowRate: 0.002, profile: 'developed'}],
      outlets: [{name: 'run', shape: {kind: 'disc', center: [1, 0, 0], normal: [1, 0, 0], radius: R}}, {name: 'branch', shape: {kind: 'disc', center: [0.5, 0.5, 0], normal: [0, 1, 0], radius: R}, flowRate: 0.0005}]},
    resolution: {cells: 8000}, run: {transits: 1.5, windowTransits: 0.4, startupTransits: 0.5},
    outputs: {streamlines: {count: 8, from: ['in']}, sections: [{name: 'mid', axis: 'x', position: 0.25}], surface: true, slices: [{axis: 'z', fraction: 0.5}], lines: [{from: [0, 0, 0], to: [1, 0, 0], samples: 5}]}};
  assert.deepEqual(checkSchema(studySchema, internal), []);
  const a = K.runFlowStudy(internal, {provenance: {commit: 'test'}});
  assert.deepEqual(checkSchema(resultSchema, a), []);
  assert.equal(a.solver.provenance.commit, 'test');
  assert.ok(a.streamlines.lines.filter(l => l.termination === 'opening').length >= 6, 'streamlines end in the openings');
  // an outlet by flow rate gives way to sound like an inlet: exact once steady, within 3% over this short run
  near(a.flow.patches.find(p => p.name === 'branch').flowRate, -0.0005, 1.5e-5, 'an outlet by flow rate');
  assert.equal(a.setup.patches[0].normal[0], -1, 'normals are outward');
  const external = {format: 'box3d-flow-study/1', name: 'block', fluid: 'air', mode: 'external',
    geometry: [{kind: 'box', center: [0, 10, 0], size: [20, 20, 20], part: 'cube'},
      {kind: 'mesh', positions: [12, 0, -5, 16, 0, -5, 16, 4, -5, 12, 4, -5, 12, 0, 5, 16, 0, 5, 16, 4, 5, 12, 4, 5], indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6], elements: [{element: 'panels', triStart: 0, triCount: 4, closed: false, thickness: 0.05}], part: 'fins'}],
    external: {speed: 20, ground: {height: 0, type: 'fixed'}}, resolution: {cells: 15000}, run: {transits: 1, windowTransits: 0.3, startupTransits: 0.3}, outputs: {surface: true, streamlines: {count: 6}}};
  assert.deepEqual(checkSchema(studySchema, external), []);
  const b = K.runFlowStudy(external);
  assert.deepEqual(checkSchema(resultSchema, b), []);
  assert.equal(b.setup.geometry.thickened, 1, 'the open panels were grown');
  assert.ok(b.warnings.some(w => /grown/.test(w)));
  assert.ok(Math.abs(b.setup.external.referencePressure.value) < 0.5 * b.setup.external.dynamicPressure);
  const again = K.runFlowStudy(external, {now: () => 0});
  assert.deepEqual(again.forces, b.forces, 'a study gives the same forces twice');
});
