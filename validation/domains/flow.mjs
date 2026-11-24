// Flow around and through geometry (box3d-webgpu-kit/flow, docs/FLOW.md): laminar ducts and pipes, a pipe through its
// openings, the cylinder at Re 20 to 200, a sphere at Re 100, sharp-edged bodies at Re 1e5, a building on the ground
// through the study runner, the backward-facing step, the sudden expansion, a tee, a tank with three inlets, Stokes
// drag, conservation, determinism, the voxeliser and the streamline tracer. The set-ups are the ones the test file
// asserts on: packages/box3d-kit/test/flow-scenarios.mjs, run here through the built kit. SI units.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, lower, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v24-flow.test.mjs';
const T = {
  ducts: 'ducts and pipes driven by a pressure gradient: plane Poiseuille, a square duct and a round pipe drawn as meshes and primitives, a finer pipe, the force on the walls',
  pipe: 'a pipe drawn as a fluid cylinder, through its openings: Hagen-Poiseuille pressure drop, the developed profile, the mass balance',
  sparse: 'sparse storage: the same bits as dense storage on an L of pipes, and a long L whose box is three times the dense limit',
  laminar: 'a laminar round pipe at Re 500 to 1500, periodic, started from the exact parabola: the flow rate against Hagen-Poiseuille, and the warning below the resolution that holds it',
  cylinder: 'the circular cylinder: drag and recirculation at Re 20 and 40, drag and Strouhal number at Re 100 and 200',
  bodies: 'bluff bodies: a sphere at Re 100, a cube and a square plate at Re 1e5',
  building: 'a rectangular building on fixed ground through the study runner: drag coefficient and the largest surface pressure coefficient',
  stagnation: 'the stagnation pressure coefficient of a cube and a sphere in a free stream through the study runner is 1 within 0.1',
  step: 'the backward-facing step at Re 100: reattachment length against Armaly et al. (1983)',
  internal: 'internal flows through the study runner: the sudden expansion against Borda-Carnot, a symmetric tee, a tank with three inlets',
  stokes: 'Stokes drag on a sphere in a periodic cube against Hasimoto (1959), and the force on the sphere against the body force on the fluid',
  conservation: 'conservation: mass through openings and walls, a closed box',
  determinism: 'determinism: repeat runs are bit-identical, and a run resumed from a checkpoint continues with the same bits',
  geometry: 'geometry: meshes against primitives, imperfect meshes, thin walls that do not leak',
  tracer: 'streamlines: straight in a uniform flow, a closed circle in a solid-body rotation',
};

const modules = () => memo('flow/modules', async () => {
  const [S, K] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/flow-scenarios.mjs')).href), kit('flow')]);
  return {S, K};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`flow/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const pipe = (n, source = 'cylinder') => run(`pipe/${n}/${source}`, (S, K) => S.pipe(K, {n, source}));
const laminar = (re, n, viscousTimes = 3) => run(`laminar/${re}/${n}/${viscousTimes}`, (S, K) => S.laminarPipe(K, {re, n, viscousTimes}));
const sparse = () => run('sparse', (S, K) => S.sparseStorage(K));
const pipeStudy = () => run('pipe-study', (S, K) => S.pipeStudy(K, {re: 100}));
const steady = re => run(`cylinder/${re}`, (S, K) => S.cylinderSteady(K, {re}));
const shedding = re => run(`shedding/${re}`, (S, K) => S.cylinderShedding(K, {re}));
const sphere = () => run('sphere/100', (S, K) => S.sphere(K, {re: 100}));
const sharp = shape => run(`sharp/${shape}`, (S, K) => S.sharpBody(K, {shape}));
const stagnation = shape => run(`stagnation/${shape}`, (S, K) => S.stagnation(K, {shape}));
const building = () => run('building', (S, K) => S.building(K));
const step = () => run('step', (S, K) => S.backwardStep(K, {re: 100}));
const expansion = () => run('expansion', (S, K) => S.suddenExpansion(K));
const tee = () => run('tee', (S, K) => S.teeSplit(K));
const tank = () => run('tank', (S, K) => S.tank(K));
const stokes = () => run('stokes', (S, K) => S.stokesSphere(K, {n: 16}));
const ledger = () => run('ledger', (S, K) => S.massLedger(K));
const determinism = () => run('determinism', (S, K) => S.determinism(K));
const meshes = () => run('meshes', (S, K) => S.meshAgainstPrimitive(K));
const imperfect = () => run('imperfect', (S, K) => S.imperfectMesh(K));
const thin = () => run('thin', (S, K) => S.thinWallLeak(K));
const tracer = () => run('tracer', (S, K) => S.tracer(K));
const WILLIAMSON = re => -3.3265 / re + 0.1816 + 1.6e-4 * re;

export default defineCases('flow', FILE, [
  // ---- ducts and pipes ----
  {id: 'flow.poiseuille.plane', title: 'Plane Poiseuille flow between mesh walls', quantity: 'flow rate between two walls 8 cells apart that lie off the grid lines (a slot drawn as a mesh), driven by a body force', unit: 'm^3/s', test: T.ducts,
    reference: {formula: 'q = G H^3 / (12 nu) per unit depth', value: null}, tolerance: relative(0.05), measure: async () => { const r = await run('plane', (S, K) => S.poiseuillePlane(K)); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.duct.flow-rate', title: 'Square duct drawn as a mesh', quantity: 'flow rate through a square duct 8 cells across whose walls lie off the grid lines', unit: 'm^3/s', test: T.ducts,
    reference: {formula: 'Q = (a^4 G / mu) [1/12 - (16 / pi^5) sum_odd tanh(n pi / 2) / n^5]', value: null}, tolerance: relative(0.05),
    measure: async () => { const r = await run('duct', (S, K) => S.squareDuct(K)); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.pipe.flow-rate', title: 'Round pipe drawn as a cylinder', quantity: 'flow rate through a pipe 12 cells across, a fluid cylinder (role cavity), driven by a body force', unit: 'm^3/s', test: T.ducts,
    reference: {formula: 'Q = pi R^4 G / (8 mu) (Hagen-Poiseuille)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await pipe(12); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.pipe.mesh-flow-rate', title: 'Round pipe drawn as a mesh', quantity: 'the same pipe as a swept tube of 48 sides, a closed mesh', unit: 'm^3/s', test: T.ducts,
    reference: {formula: 'Q = pi R^4 G / (8 mu)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await pipe(12, 'mesh'); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.pipe.fine', title: 'Round pipe at 24 cells across', quantity: 'flow rate through the pipe drawn as a cylinder, 24 cells across, the relaxation time held at 0.6', unit: 'm^3/s', test: T.ducts,
    reference: {formula: 'Q = pi R^4 G / (8 mu)', value: null}, tolerance: relative(0.02),
    note: 'At the relaxation time 0.6 the error is 2.2% at 12 and at 16 cells and 1.0% at 24: the staircase of a circle does not converge evenly. With the lattice speed fixed instead, the relaxation time falls with the cell size and the wall of bounce-back moves with it: 12% low at 8 cells (relaxation time 0.53).',
    measure: async () => { const r = await run('pipe/24/fine', (S, K) => S.pipe(K, {n: 24, tau: 0.6})); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.pipe.force-balance', title: 'Round pipe: force on the wall', quantity: 'force the wall takes, over the body force on the fluid, minus one', unit: '1', test: T.ducts,
    reference: {formula: 'a steady duct: the wall takes all the driving force', value: 0}, tolerance: absolute(1e-6), measure: async () => (await pipe(12)).forceBalance},
  {id: 'flow.laminar-pipe.re500', title: 'Laminar round pipe, Re 500, 20 cells across', quantity: 'flow rate through a periodic pipe 20 cells across (cell Reynolds number 50, peak speed) after 8 viscous times R^2 / (5.78 nu), started from the exact parabola', unit: 'm^3/s', test: T.laminar,
    reference: {formula: 'Q = pi R^4 G / (8 mu) (Hagen-Poiseuille)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await laminar(500, 20, 8); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.laminar-pipe.re1000', title: 'Laminar round pipe, Re 1000, 48 cells across', quantity: 'flow rate through a periodic pipe 48 cells across (cell Reynolds number 41.7, peak speed) after 3 viscous times R^2 / (5.78 nu), started from the exact parabola', unit: 'm^3/s', test: T.laminar,
    reference: {formula: 'Q = pi R^4 G / (8 mu) (Hagen-Poiseuille)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await laminar(1000, 48, 3); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.laminar-pipe.re1500', title: 'Laminar round pipe, Re 1500, 64 cells across', quantity: 'flow rate through a periodic pipe 64 cells across (cell Reynolds number 46.9, peak speed) after 2 viscous times R^2 / (5.78 nu), started from the exact parabola', unit: 'm^3/s', test: T.laminar,
    reference: {formula: 'Q = pi R^4 G / (8 mu) (Hagen-Poiseuille)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await laminar(1500, 64, 2); return {value: r.flowRate, reference: r.exact}; }},
  {id: 'flow.laminar-pipe.coarse-warning', title: 'Laminar round pipe, Re 1000, 16 cells across: the warning', quantity: 'whether the Flow warns about the cell Reynolds number (125) at which the pipe loses a quarter of its flow rate', unit: '1', test: T.laminar,
    reference: {formula: 'the warning is given above FLOW_LAMINAR_CELL_REYNOLDS = 50', value: 1}, tolerance: absolute(0), measure: async () => ((await laminar(1000, 16, 3)).warned ? 1 : 0)},
  {id: 'flow.sparse.populations', title: 'Sparse storage against dense: populations', quantity: 'populations that differ in bits after 300 steps of an L of two pipes (a sphere at the corner, a baffle, a parabolic inlet, a pressure outlet, Smagorinsky), stored as 8^3 tiles and as a dense box', unit: 'values', test: T.sparse,
    reference: {formula: 'the same lattice, numbered in the order of the cell index', value: 0}, tolerance: absolute(0), measure: async () => (await sparse()).small.populations},
  {id: 'flow.sparse.fields', title: 'Sparse storage against dense: fields', quantity: 'cells of the box whose fluid flag, velocity, pressure or distance differ in bits', unit: 'cells', test: T.sparse,
    reference: {formula: 'identical fields', value: 0}, tolerance: absolute(0), measure: async () => (await sparse()).small.fields},
  {id: 'flow.sparse.large-box', title: 'Sparse storage: a box three times the dense limit', quantity: 'box cells of a long thin L of pipes (legs 3000 cells, radius 2.6 cells) over the dense limit 2^25', unit: '1', test: T.sparse,
    reference: {formula: 'more than the dense limit', value: 1}, tolerance: lower(0), measure: async () => (await sparse()).big.overDenseLimit},
  {id: 'flow.sparse.large-box-mass', title: 'Sparse storage, long L: mass ledger', quantity: 'volume the box gained over 400 steps minus the volume through the openings and walls', unit: 'm^3', test: T.sparse,
    reference: {formula: 'conservation of mass', value: 0}, tolerance: absolute(1e-6), measure: async () => (await sparse()).big.massError},
  {id: 'flow.pipe-study.pressure-drop', title: 'Pipe through its openings, Re 100: pressure drop', quantity: 'pressure drop between sections 2 D and 4 D from the inlet of a pipe 6 D long drawn as a fluid cylinder, inlet by flow rate with the developed profile, outlet by pressure, about 12.6 cells across', unit: 'Pa', test: T.pipe,
    reference: {formula: 'dp = 128 mu L Q / (pi D^4)', value: null}, tolerance: relative(0.05),
    note: 'At Re 1107 with the same cells the drop is 63% high and the peak over the mean speed 1.90 (docs/FLOW.md): the relaxation time is 0.501, where the regularised collision moves a bounce-back wall on a staircase.',
    measure: async () => { const r = await pipeStudy(); return {value: r.drop, reference: r.exact}; }},
  {id: 'flow.pipe-study.peak', title: 'Pipe through its openings, Re 100: peak over mean', quantity: 'largest speed normal to the middle section over its mean speed', unit: '1', test: T.pipe,
    reference: {formula: 'developed laminar profile: 2', value: 2}, tolerance: relative(0.03), measure: async () => (await pipeStudy()).peakOverMean},
  {id: 'flow.pipe-study.mass', title: 'Pipe through its openings, Re 100: mass balance', quantity: '(inflow - outflow) / inflow over the averaging window', unit: '1', test: T.pipe,
    reference: {formula: 'conservation of mass', value: 0}, tolerance: absolute(1e-4), measure: async () => (await pipeStudy()).massBalance},
  // ---- the cylinder ----
  {id: 'flow.cylinder.re20-drag', title: 'Cylinder, Re 20: drag coefficient', quantity: 'Cd of a cylinder 8 cells across in a 2D tunnel 24 D high (blockage 4.2%), inlet 9.5 D ahead, laminar', unit: '1', test: T.cylinder,
    reference: {formula: 'computed in unbounded domains: 2.091 (Wu & Shu), 2.11 (Cui et al.), 2.144 (Niu et al.), as tabulated by Cui et al. 2019', value: 2.091}, tolerance: relative(0.08),
    note: 'The blockage of the tunnel raises the drag a few percent; it is not corrected. In a tunnel 12 D high with the inlet 4.5 D ahead the drag was 2.39 (14% high).', measure: async () => (await steady(20)).cd},
  {id: 'flow.cylinder.re20-length', title: 'Cylinder, Re 20: recirculation length', quantity: 'length of the recirculation behind the cylinder over D, from its rear', unit: '1', test: T.cylinder,
    reference: {formula: 'Wu & Shu, Cui et al.: 0.93', value: 0.93}, tolerance: relative(0.08), measure: async () => (await steady(20)).recirculation},
  {id: 'flow.cylinder.re40-drag', title: 'Cylinder, Re 40: drag coefficient', quantity: 'Cd, the same tunnel', unit: '1', test: T.cylinder,
    reference: {formula: 'Wu & Shu: 1.539 (Cui et al. 1.56, Niu et al. 1.589)', value: 1.539}, tolerance: relative(0.1), measure: async () => (await steady(40)).cd},
  {id: 'flow.cylinder.re40-length', title: 'Cylinder, Re 40: recirculation length', quantity: 'length of the recirculation over D', unit: '1', test: T.cylinder,
    reference: {formula: 'Wu & Shu: 2.23 (Cui et al. 2.20, Niu et al. 2.26)', value: 2.23}, tolerance: relative(0.1), measure: async () => (await steady(40)).recirculation},
  {id: 'flow.cylinder.re100-drag', title: 'Cylinder, Re 100: mean drag coefficient', quantity: 'mean Cd over 50 D/U after 100 D/U, 10 cells across, tunnel 16 D high (blockage 6.3%)', unit: '1', test: T.cylinder,
    reference: {formula: 'Wu & Shu: 1.334 (Ding et al. 1.325)', value: 1.334}, tolerance: relative(0.15), note: 'The drag is high by about the blockage effect; it is not corrected.',
    measure: async () => (await shedding(100)).cd},
  {id: 'flow.cylinder.re100-strouhal', title: 'Cylinder, Re 100: Strouhal number', quantity: 'frequency of the lift over U / D', unit: '1', test: T.cylinder,
    reference: {formula: 'Williamson (1988): St = -3.3265 / Re + 0.1816 + 1.6e-4 Re', value: WILLIAMSON(100)}, tolerance: relative(0.08), measure: async () => (await shedding(100)).strouhal},
  {id: 'flow.cylinder.re200-strouhal', title: 'Cylinder, Re 200: Strouhal number', quantity: 'frequency of the lift over U / D, two-dimensional', unit: '1', test: T.cylinder,
    reference: {formula: 'two-dimensional computations: 0.196 (Ding et al.), 0.195 (Wu & Shu); experiments are three-dimensional above Re 180', value: 0.196}, tolerance: relative(0.08), measure: async () => (await shedding(200)).strouhal},
  // ---- bodies ----
  {id: 'flow.sphere.re100', title: 'Sphere, Re 100: drag coefficient', quantity: 'mean Cd of a sphere 8 cells across in a tunnel 5 D square (blockage 3.1%), laminar', unit: '1', test: T.bodies,
    reference: {formula: 'Schiller-Naumann: 24 / Re (1 + 0.15 Re^0.687)', value: 24 / 100 * (1 + 0.15 * 100 ** 0.687)}, tolerance: relative(0.2), note: 'Eight cells across a sphere are few; the drag is high.',
    measure: async () => (await sphere()).cd},
  {id: 'flow.cube.re1e5', title: 'Cube face-on, Re 1e5: drag coefficient', quantity: 'mean Cd of a cube 8 cells across in a tunnel 5 D square (blockage 4%), sub-grid model and wall function', unit: '1', test: T.bodies,
    reference: {formula: 'Hoerner (Fluid-Dynamic Drag), from memory: 1.05', value: 1.05}, tolerance: relative(0.15), measure: async () => (await sharp('cube')).cd},
  {id: 'flow.plate.re1e5', title: 'Square plate normal to the stream, Re 1e5: drag coefficient', quantity: 'mean Cd of a square plate D x D, 0.05 D thick (grown to 1.44 cells), 8 cells across', unit: '1', test: T.bodies,
    reference: {formula: 'Hoerner, from memory: 1.17', value: 1.17}, tolerance: relative(0.15), measure: async () => (await sharp('plate')).cd},
  {id: 'flow.building.drag', title: 'Building on fixed ground: drag coefficient', quantity: 'Cd of a block 12 x 30 x 20 m (30 m high) in a 20 m/s wind normal to its 20 m face, study runner with its default margins, about 8 cells across', unit: '1', test: T.building,
    reference: {formula: 'the band of the apex building studies: 1.0 to 1.7 (sharp-edged rectangular buildings)', value: 1.35}, tolerance: absolute(0.35), measure: async () => (await building()).cd},
  {id: 'flow.building.cp-max', title: 'Building on fixed ground: largest surface Cp', quantity: 'largest pressure coefficient over the surface, pressure gauge to the free stream (the mean on the inlet)', unit: '1', test: T.building,
    reference: {formula: 'stagnation: Cp = 1', value: 1}, tolerance: absolute(0.2), measure: async () => (await building()).cpMax},
  {id: 'flow.building.cp-max-resolved', title: 'Building on fixed ground: largest resolved surface Cp', quantity: 'largest pressure coefficient over the surface samples not flagged as on a sharp edge or in a gap under three cells', unit: '1', test: T.building,
    reference: {formula: 'stagnation: Cp = 1', value: 1}, tolerance: absolute(0.2), measure: async () => (await building()).cpMaxResolved},
  {id: 'flow.stagnation.cube', title: 'Cube in a free stream: stagnation Cp', quantity: 'largest resolved surface pressure coefficient of a cube face-on, Re 1e4, about 6.7 cells across, study runner (free-stream inlet, reference the mean inlet pressure)', unit: '1', test: T.stagnation,
    reference: {formula: 'incompressible stagnation point: Cp = 1', value: 1}, tolerance: absolute(0.1), measure: async () => (await stagnation('cube')).cpMaxResolved},
  {id: 'flow.stagnation.sphere', title: 'Sphere in a free stream: stagnation Cp', quantity: 'largest resolved surface pressure coefficient of a sphere, Re 1e4, about 6.7 cells across, study runner', unit: '1', test: T.stagnation,
    reference: {formula: 'incompressible stagnation point: Cp = 1', value: 1}, tolerance: absolute(0.1), measure: async () => (await stagnation('sphere')).cpMaxResolved},
  // ---- internal flows ----
  {id: 'flow.step.reattachment', title: 'Backward-facing step, Re 100: reattachment', quantity: 'reattachment length over the step height S, expansion ratio 1.94, Re = U_mean 2 h / nu, 16 cells over the inlet channel', unit: '1', test: T.step,
    reference: {formula: 'Armaly et al. (1983): about 3.0, from memory (two-dimensional computations agree with the experiment to Re 400)', value: 3.0}, tolerance: relative(0.12), measure: async () => (await step()).reattachment},
  {id: 'flow.expansion.pressure-rise', title: 'Sudden expansion D2 = 2 D1, Re 5e4: pressure rise', quantity: 'rise of the mean pressure from 0.5 D1 before the step to 8 D2 after it, about 7.6 cells across D1, sub-grid model', unit: 'Pa', test: T.internal,
    reference: {formula: 'Borda-Carnot: rho U1^2 s (1 - s), s = A1 / A2', value: null}, tolerance: relative(0.15), measure: async () => { const r = await expansion(); return {value: r.rise, reference: r.exact}; }},
  {id: 'flow.tee.split', title: 'Symmetric tee: flow split', quantity: 'fraction of the outflow through one arm of a tee whose arms are equal and open at the same pressure', unit: '1', test: T.internal,
    reference: {formula: 'symmetry: 1/2', value: 0.5}, tolerance: absolute(0.03), note: 'The flow in the tee is unsteady (sub-grid model on); the split is a mean over one window.', measure: async () => (await tee()).left},
  {id: 'flow.tee.mass', title: 'Symmetric tee: mass balance', quantity: '(inflow - outflow) / inflow', unit: '1', test: T.internal,
    reference: {formula: 'conservation of mass', value: 0}, tolerance: absolute(1e-3), measure: async () => (await tee()).massBalance},
  {id: 'flow.tank.mass', title: 'Tank with three inlets: mass balance', quantity: '(inflow - outflow) / inflow, three inlets by flow rate, one outlet by pressure', unit: '1', test: T.internal,
    reference: {formula: 'conservation of mass', value: 0}, tolerance: absolute(1e-3), measure: async () => (await tank()).massBalance},
  {id: 'flow.tank.inlets', title: 'Tank with three inlets: flow at the inlets', quantity: 'largest relative difference between the flow through an inlet and the flow rate given', unit: '1', test: T.internal,
    reference: {formula: 'the flow rate given', value: 0}, tolerance: upper(1e-3), measure: async () => (await tank()).inletError},
  // ---- Stokes drag and conservation ----
  {id: 'flow.stokes.drag', title: 'Stokes drag on a sphere, 2.4 cells per radius', quantity: 'drag of a sphere of radius 0.15 L in a periodic cube of 16^3 cells, Re about 0.1', unit: 'N', test: T.stokes,
    reference: {formula: 'Hasimoto (1959): F = 6 pi mu a U / (1 - 1.7601 c^(1/3) + c - 1.5593 c^2) (as given by Ladd 1994)', value: null}, tolerance: relative(0.1),
    measure: async () => { const r = await stokes(); return {value: r.drag, reference: r.exact}; }},
  {id: 'flow.stokes.force-balance', title: 'Stokes drag: force on the body against the body force', quantity: 'drag over the body force on the fluid, minus one, at the steady state', unit: '1', test: T.stokes,
    reference: {formula: 'momentum balance of the periodic box (a control volume)', value: 0}, tolerance: absolute(1e-6), measure: async () => (await stokes()).forceBalance},
  {id: 'flow.mass.openings', title: 'Mass through openings and walls', quantity: 'change of the mass in a tunnel with two bodies over 200 steps, minus what entered through the openings and the walls, over the throughput', unit: '1', test: T.conservation,
    reference: {formula: 'conservation of mass on the lattice', value: 0}, tolerance: absolute(1e-12), measure: async () => (await ledger()).interpolated.error},
  {id: 'flow.mass.closed', title: 'Mass in a closed periodic box', quantity: 'change of the mass over 300 steps per fluid cell, body force and a sphere', unit: '1', test: T.conservation,
    reference: {formula: 'conservation of mass', value: 0}, tolerance: absolute(1e-12), measure: async () => (await ledger()).closed},
  // ---- determinism ----
  {id: 'flow.determinism.repeat', title: 'Repeatability', quantity: 'runs whose populations differ from the first in any bit, of two runs of a turbulent tunnel', unit: 'runs', test: T.determinism,
    reference: {formula: 'bit-identical state', value: 0}, tolerance: upper(0), measure: async () => (await determinism()).same ? 0 : 1},
  {id: 'flow.determinism.resume', title: 'Resume from a checkpoint', quantity: 'runs resumed from saveState / restoreState whose state, sums or time differ from the uninterrupted run', unit: 'runs', test: T.determinism,
    reference: {formula: 'bit-identical continuation', value: 0}, tolerance: upper(0), measure: async () => { const r = await determinism(); return r.resumed && r.sumsEqual && r.time ? 0 : 1; }},
  // ---- geometry ----
  {id: 'flow.geometry.mesh-sphere', title: 'Mesh against primitive: sphere', quantity: 'cells whose solid / fluid state differs between a sphere and its 96 x 48 mesh, 24^3 grid, of about 1570 solid cells', unit: 'cells', test: T.geometry,
    reference: {formula: 'the same shape', value: 0}, tolerance: upper(12), note: 'The mesh is inscribed in the sphere: cells within its sagitta (0.06 cells) of the surface may change side.', measure: async () => (await meshes()).sphere.differ},
  {id: 'flow.geometry.mesh-box', title: 'Mesh against primitive: box', quantity: 'cells whose state differs between a box and its 12-triangle mesh', unit: 'cells', test: T.geometry,
    reference: {formula: 'the same shape', value: 0}, tolerance: upper(0), measure: async () => (await meshes()).box.differ},
  {id: 'flow.geometry.soup', title: 'Imperfect mesh: triangle soup with flipped triangles', quantity: 'cells whose state differs from the clean sphere when no vertex is shared and every third triangle is flipped', unit: 'cells', test: T.geometry,
    reference: {formula: 'welding and parity ignore indexing and winding', value: 0}, tolerance: upper(0), measure: async () => (await imperfect()).soupDiffers},
  {id: 'flow.geometry.hole', title: 'Imperfect mesh: a hole', quantity: 'cells whose state differs from the clean sphere when three triangles are missing (a hole about a cell wide)', unit: 'cells', test: T.geometry,
    reference: {formula: 'the majority vote of three ray directions outvotes the hole', value: 0}, tolerance: upper(0), measure: async () => (await imperfect()).holedDiffers},
  {id: 'flow.geometry.thin-wall', title: 'Thin walls do not leak', quantity: 'closed boxes whose walls are 0.18 cells thick (as meshes, rotated meshes, boxes, rotated boxes, open quads): ones whose inside the lattice links reach from outside', unit: 'boxes', test: T.geometry,
    reference: {formula: 'walls grown to 1.44 cells, closed meshes sealed', value: 0}, tolerance: upper(0), measure: async () => (await thin()).leaking},
  // ---- streamlines ----
  {id: 'flow.streamline.straight', title: 'Streamline in a uniform flow', quantity: 'largest distance of the traced points from the straight line through the seed, in cells', unit: 'cells', test: T.tracer,
    reference: {formula: 'a straight line', value: 0}, tolerance: upper(1e-4), measure: async () => (await tracer()).straight},
  {id: 'flow.streamline.circle', title: 'Streamline in a solid-body rotation', quantity: 'largest radial error over the radius, one turn of RK4 with steps of half a cell', unit: '1', test: T.tracer,
    reference: {formula: 'a circle', value: 0}, tolerance: upper(1e-4), measure: async () => (await tracer()).radial},
]);
