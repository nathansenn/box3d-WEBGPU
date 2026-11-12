// Volumetric incompressible flow (box3d-webgpu-kit/fluid): the projection, the Taylor-Green vortex, channel and duct
// flows, open sides, the lid-driven cavity against Ghia et al., water at rest, Stokes drag against Hasimoto, two-way
// coupling with the rigid world, and the free surface against Martin & Moyce and the linear sloshing frequency. The
// set-ups are the ones the test file asserts on: packages/box3d-kit/test/fluid-scenarios.mjs, run here through the built
// kit. SI units.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v18-fluid.test.mjs';
const T = {
  projection: 'projection: the divergence left is at the solver tolerance, with walls, an outflow and obstacles',
  taylor: 'Taylor-Green vortex: decay rate and velocity against the exact solution, second order, energy ledger',
  channels: 'channels: plane Poiseuille and Couette flow, and a square duct against its series solution',
  open: 'inflow and outflow: a parabolic inflow stays parabolic, loses 8 mu U / H^2 of pressure per metre, and what enters leaves',
  cavity: 'lid-driven cavity at Re 100 and 400 against Ghia, Ghia & Shin (1982)',
  rest: 'water at rest in a closed tank: no spurious currents, hydrostatic pressure, buoyancy on an immersed sphere',
  stokes: 'Stokes drag on a sphere in a periodic cube against Hasimoto (1959), and the force on a control surface',
  settling: 'coupling: a sphere of the rigid world settles at the terminal velocity Hasimoto drag gives',
  third: 'coupling: the fluid and a rigid body exchange equal and opposite momentum',
  determinism: 'determinism: repeat runs are bit-identical, and the Simulation loop adds nothing',
  dam: 'free surface: a water column collapses as Martin & Moyce (1952) measured',
  slosh: 'free surface: the first sloshing mode has the frequency of the linear dispersion relation; a tank at rest stays at rest',
};

const modules = () => memo('fluid/modules', async () => {
  const [S, fluid, index, simulation] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/fluid-scenarios.mjs')).href), kit('fluid'), kit('index'), kit('simulation')]);
  return {S, K: {...fluid, createWorld: index.createWorld, createSimulation: simulation.createSimulation}};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`fluid/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const taylor = n => run(`taylor/${n}`, (S, K) => S.taylorGreen(K, {n}));
const poiseuille = n => run(`poiseuille/${n}`, (S, K) => S.poiseuille(K, {n}));
const duct = n => run(`duct/${n}`, (S, K) => S.squareDuct(K, {n}));
const channel = () => run('channel', (S, K) => S.channel(K));
const cavity100 = () => run('cavity/100', (S, K) => S.cavity(K, {n: 32, re: 100}));
const cavity400 = () => run('cavity/400', (S, K) => S.cavity(K, {n: 48, re: 400, courant: 1, tolerance: 2e-6}));
const rest = () => run('hydrostatic', (S, K) => S.hydrostatic(K));
const stokes = n => run(`stokes/${n}`, (S, K) => S.stokesDrag(K, {n}));
const dam = () => run('dam', (S, K) => S.damBreak(K));
const slosh = () => run('slosh', (S, K) => S.sloshing(K));
const order = (coarse, fine, ratio = 2) => Math.log(Math.abs(coarse) / Math.abs(fine)) / Math.log(ratio);

export default defineCases('fluid', FILE, [
  {id: 'fluid.projection.divergence', title: 'Projection: divergence left', quantity: 'max |div u| h / max |u| after projecting a random field and after three steps, with walls, periodic sides, an outflow and a tilted capsule', unit: '1', test: T.projection,
    reference: {formula: 'div u = 0 to the solver tolerance 1e-10', value: 0}, tolerance: upper(1.5e-10),
    measure: async () => { const r = await run('projection', (S, K) => S.projection(K)); return Math.max(r.projected, r.stepped); }},
  {id: 'fluid.taylor-green.rate', title: 'Taylor-Green vortex: decay rate', quantity: 'decay rate of the kinetic energy, 32 x 32 cells on a 2 pi square, U = 1 m/s, nu = 0.01 m^2/s, t = 1 s', unit: '1/s', test: T.taylor,
    reference: {formula: 'E ~ exp(-4 nu k^2 t)', value: 0.04}, tolerance: relative(5e-3), note: 'The discrete Laplacian of the mode is 4 sin^2(h/2) / h^2 instead of 1: the rate is 0.28% low at 32 cells and falls at second order.',
    measure: async () => (await taylor(32)).rate},
  {id: 'fluid.taylor-green.order', title: 'Taylor-Green vortex: spatial convergence', quantity: 'order of the L2 velocity error between 32 and 64 cells (Courant number 0.4 at both, so dt halves with h)', unit: '1', test: T.taylor,
    reference: {formula: 'second order', value: 2}, tolerance: absolute(0.3), measure: async () => order((await taylor(32)).velocityError, (await taylor(64)).velocityError)},
  {id: 'fluid.taylor-green.error', title: 'Taylor-Green vortex: velocity error', quantity: 'L2 error of the velocity over its norm at t = 1 s, 32 cells', unit: '1', test: T.taylor,
    reference: {formula: 'u = sin x cos y exp(-2 nu t), v = -cos x sin y exp(-2 nu t)', value: 0}, tolerance: upper(1e-4), measure: async () => (await taylor(32)).velocityError},
  {id: 'fluid.taylor-green.ledger', title: 'Taylor-Green vortex: energy ledger', quantity: 'kinetic energy + viscous dissipation, change over the dissipated energy, 32 cells', unit: '1', test: T.taylor,
    reference: {formula: 'E + D = const', value: 0}, tolerance: absolute(1e-3), note: 'The dissipation is the discrete mu |grad u|^2 integrated by the trapezoidal rule; the remainder halves with the cell size.',
    measure: async () => (await taylor(32)).ledger},
  {id: 'fluid.poiseuille.profile', title: 'Plane Poiseuille flow', quantity: 'largest error of the steady profile over the centre-line speed, 16 cells across a 20 mm channel of oil', unit: '1', test: T.channels,
    reference: {formula: 'the discrete solution is the parabola G y (H - y) / (2 nu) shifted by G h^2 / (8 nu): error (h / H)^2', value: null}, tolerance: relative(1e-6),
    measure: async () => { const r = await poiseuille(16); return {value: r.error, reference: r.closedForm}; }},
  {id: 'fluid.couette.profile', title: 'Plane Couette flow', quantity: 'largest error of the steady profile over the wall speed, 16 cells', unit: '1', test: T.channels,
    reference: {formula: 'u = U y / H (exact on this grid)', value: 0}, tolerance: upper(1e-7), note: 'What is left is the steady-state stopping rule.', measure: async () => (await run('couette', (S, K) => S.couette(K))).error},
  {id: 'fluid.duct.flow-rate', title: 'Square duct: flow rate', quantity: 'volume flow through a square duct of side 20 mm, 16 x 16 cells, against the series solution', unit: 'm^3/s', test: T.channels,
    reference: {formula: 'Q = (4 b a^3 G / (3 nu)) [1 - (192 a / (pi^5 b)) sum tanh(n pi b / 2a) / n^5]', value: null}, tolerance: relative(0.02), note: 'Second order: 5.9% at 8 cells, 1.5% at 16.',
    measure: async () => { const r = await duct(16); return {value: r.flowRate, reference: r.exactFlowRate}; }},
  {id: 'fluid.duct.order', title: 'Square duct: convergence of the profile', quantity: 'order of the largest profile error between 8 and 16 cells', unit: '1', test: T.channels,
    reference: {formula: 'second order', value: 2}, tolerance: absolute(0.3), measure: async () => order((await duct(8)).error, (await duct(16)).error)},
  {id: 'fluid.channel.gradient', title: 'Inflow and outflow: pressure gradient', quantity: 'pressure gradient in the middle half of a 2D channel 4 H long with a parabolic inflow (peak 10 mm/s) and an outflow, 12 cells across', unit: 'Pa/m', test: T.open,
    reference: {formula: 'dp/dx = -8 mu U_max / H^2', value: null}, tolerance: relative(0.02), note: 'The discrete parabola carries an (h / H)^2 error, 0.7% at 12 cells.',
    measure: async () => { const r = await channel(); return {value: r.gradient, reference: r.exactGradient}; }},
  {id: 'fluid.channel.profile', title: 'Inflow and outflow: outlet profile', quantity: 'largest difference between the outflow profile and the inflow parabola over the peak', unit: '1', test: T.open,
    reference: {formula: 'fully developed: unchanged', value: 0}, tolerance: upper(0.01), measure: async () => (await channel()).profile},
  {id: 'fluid.channel.mass', title: 'Inflow and outflow: mass', quantity: 'flow out minus flow in, over flow in, at the steady state', unit: '1', test: T.open,
    reference: {formula: 'conservation of volume', value: 0}, tolerance: absolute(1e-8), measure: async () => (await channel()).massError},
  {id: 'fluid.cavity.re100-u', title: 'Lid-driven cavity, Re = 100: u on the vertical centre line', quantity: 'largest |u - u_Ghia| over the lid speed at the 15 tabulated points, 32 x 32 cells', unit: '1', test: T.cavity,
    reference: {formula: 'Ghia, Ghia & Shin 1982, table I (transcribed copies, see docs/FLUID.md)', value: 0}, tolerance: upper(0.005), note: 'Ghia et al. used a 129 x 129 grid; their own error is of the same order as the band.',
    measure: async () => (await cavity100()).uError},
  {id: 'fluid.cavity.re100-v', title: 'Lid-driven cavity, Re = 100: v on the horizontal centre line', quantity: 'largest |v - v_Ghia| over the lid speed at the 15 tabulated points, 32 x 32 cells', unit: '1', test: T.cavity,
    reference: {formula: 'Ghia, Ghia & Shin 1982, table II', value: 0}, tolerance: upper(0.012), measure: async () => (await cavity100()).vError},
  {id: 'fluid.cavity.re400-u', title: 'Lid-driven cavity, Re = 400: u on the vertical centre line', quantity: 'largest |u - u_Ghia| over the lid speed, 48 x 48 cells', unit: '1', test: T.cavity,
    reference: {formula: 'Ghia, Ghia & Shin 1982, table I', value: 0}, tolerance: upper(0.025), note: 'The steady state is taken when the velocity changes by less than 2e-6 of the lid speed per unit time.',
    measure: async () => (await cavity400()).uError},
  {id: 'fluid.cavity.re400-v', title: 'Lid-driven cavity, Re = 400: v on the horizontal centre line', quantity: 'largest |v - v_Ghia| over the lid speed, 48 x 48 cells, the point x = 0.9063 left out', unit: '1', test: T.cavity,
    reference: {formula: 'Ghia, Ghia & Shin 1982, table II', value: 0}, tolerance: upper(0.025), measure: async () => (await cavity400()).vError},
  {id: 'fluid.rest.speed', title: 'Water at rest: spurious currents', quantity: 'largest velocity after 40 steps of 10 ms in a 0.2 m tank with a fixed sphere, over g dt', unit: '1', test: T.rest,
    reference: {formula: 'u = 0', value: 0}, tolerance: upper(1e-12), note: 'Started from the hydrostatic pressure; gravity is a gradient on the staggered grid, so the projection removes it exactly.',
    measure: async () => { const r = await rest(); return r.speed / r.scale; }},
  {id: 'fluid.rest.head', title: 'Water at rest: pressure', quantity: 'mean pressure of the bottom cell layer minus that of the top layer', unit: 'Pa', test: T.rest,
    reference: {formula: 'rho g (L - h)', value: null}, tolerance: relative(1e-9), measure: async () => { const r = await rest(); return {value: r.head, reference: r.exactHead}; }},
  {id: 'fluid.rest.buoyancy', title: 'Water at rest: buoyancy of an immersed sphere', quantity: 'upward force on a fixed sphere of radius 30 mm (2.4 cells)', unit: 'N', test: T.rest,
    reference: {formula: 'rho g (4/3) pi a^3', value: null}, tolerance: relative(0.06), note: 'Equal to rho g times the displaced grid volume to 1e-9; that volume is 5% above the sphere\'s because the solid fraction is a linear ramp over one cell.',
    measure: async () => { const r = await rest(); return {value: r.lift, reference: r.buoyancy}; }},
  {id: 'fluid.stokes.drag-16', title: 'Stokes drag on a sphere, 2.4 cells per radius', quantity: 'K = F / (6 pi mu a U) for a sphere of radius 0.15 L in a periodic cube of 16^3 cells, Re 0.05, U the mean velocity over the cube', unit: '1', test: T.stokes,
    reference: {formula: 'Hasimoto (1959): 1 / K = 1 - 1.7601 c^(1/3) + c - 1.5593 c^2 (as given by Ladd 1994, eq. 3.5)', value: null}, tolerance: relative(0.1), note: 'The obstacle is immersed in the grid; its surface is placed by linear extrapolation along one grid line, which leaves an error of order h^2.',
    measure: async () => { const r = await stokes(16); return {value: r.measured, reference: r.hasimoto}; }},
  {id: 'fluid.stokes.drag-24', title: 'Stokes drag on a sphere, 3.6 cells per radius', quantity: 'the same with 24^3 cells', unit: '1', test: T.stokes,
    reference: {formula: 'Hasimoto (1959)', value: null}, tolerance: relative(0.05), note: 'The error falls from 7.5% to 3.3% between 16 and 24 cells, at second order.',
    measure: async () => { const r = await stokes(24); return {value: r.measured, reference: r.hasimoto}; }},
  {id: 'fluid.stokes.control-surface', title: 'Stokes drag: force on a control surface', quantity: 'momentum flux, pressure and viscous stress on a box of faces around the sphere (plus the body force on the fluid in it), 16 cells', unit: 'N', test: T.stokes,
    reference: {formula: 'the force the obstacle constraint takes from the fluid', value: null}, tolerance: relative(0.01),
    measure: async () => { const r = await stokes(16); return {value: r.surface, reference: r.force}; }},
  {id: 'fluid.coupling.terminal-velocity', title: 'Coupling: terminal velocity of a settling sphere', quantity: 'velocity of a rigid-world sphere (1.5 times the fluid density) after 0.1 s in the periodic cube, 16 cells, Re 0.03', unit: 'm/s', test: T.settling,
    reference: {formula: 'U = -m g V^2 / (6 pi mu a K (V - V_b) (m / rho + V - V_b)), K from Hasimoto', value: null}, tolerance: relative(0.12), note: 'The fixed sphere\'s drag is 7.5% low at this resolution; the moving sphere\'s varies by a few percent with its position in the cells.',
    measure: async () => { const r = await run('settling', (S, K) => S.settling(K)); return {value: r.velocity, reference: r.expected}; }},
  {id: 'fluid.coupling.third-law', title: 'Coupling: impulse handed over', quantity: 'momentum change of the fluid plus the impulse the coupling gave a sphere thrown through it, over the momentum exchanged (periodic cube, no gravity)', unit: '1', test: T.third,
    reference: {formula: 'equal and opposite', value: 0}, tolerance: upper(1e-12), measure: async () => (await run('third', (S, K) => S.momentumExchange(K))).fluidSide},
  {id: 'fluid.coupling.momentum', title: 'Coupling: total momentum', quantity: 'change of the fluid momentum plus the sphere\'s (from the world), over the momentum exchanged', unit: '1', test: T.third,
    reference: {formula: 'p = const', value: 0}, tolerance: upper(1e-6), note: 'The sphere\'s velocity is a float32 of the rigid world.', measure: async () => (await run('third', (S, K) => S.momentumExchange(K))).total},
  {id: 'fluid.determinism.repeat', title: 'Repeatability', quantity: 'runs whose final bits differ from the first, of three more (a coupled run, the same through the Simulation loop, a free-surface tank twice)', unit: 'runs', test: T.determinism,
    reference: {formula: 'bit-identical state', value: 0}, tolerance: upper(0), note: 'One machine, one build.',
    measure: async () => { const {S, K} = await modules(), a = await S.fingerprint(K), b = await S.fingerprint(K), c = await S.fingerprint(K, {simulation: true}), x = S.freeSurfaceRest(K, {seconds: 0.2}), y = S.freeSurfaceRest(K, {seconds: 0.2}); return (a.hash !== b.hash) + (a.hash !== c.hash) + (x.hash !== y.hash); }},
  {id: 'fluid.dam-break.front', title: 'Free surface: dam break front', quantity: 'largest relative difference of the time T = n t sqrt(g / a) at which the front reaches Z = x / a, 13 points from Z = 1.44 to 6.76, column a = 1 1/8 in, 2a high (16 cells per a)', unit: '1', test: T.dam,
    reference: {formula: 'Martin & Moyce 1952, table 2, mean of the a = 1 1/8 in records; both normalised to T = 1.19 at Z = 1.44, as in the paper', value: 0}, tolerance: upper(0.1), note: 'Inviscid, no surface tension: the computed front is 7% early at Z = 6.76 and, before the normalisation, 0.26 in T ahead at Z = 1.44.',
    measure: async () => (await dam()).worst},
  {id: 'fluid.dam-break.volume', title: 'Free surface: dam break volume', quantity: 'change of the volume of the cells holding particles when the front reaches Z = 6.76', unit: '1', test: T.dam,
    reference: {formula: 'conserved (the particle count is constant)', value: 0}, tolerance: absolute(0.06), note: 'A thin fast sheet at the front occupies fewer cells than its particles fill.',
    measure: async () => (await dam()).volumeChange},
  {id: 'fluid.sloshing.frequency', title: 'Free surface: sloshing frequency', quantity: 'first-mode frequency of water 0.2 m deep in a 0.4 m tank, amplitude 10 mm, 32 cells along, from the centre of mass over three periods', unit: 'Hz', test: T.slosh,
    reference: {formula: 'omega^2 = g k tanh(k H), k = pi / L', value: null}, tolerance: relative(0.02), note: 'The amplitude falls to 0.85 of its start over three periods (the transfer between particles and grid damps).',
    measure: async () => { const r = await slosh(); return {value: r.frequency, reference: r.expected}; }},
  {id: 'fluid.sloshing.volume', title: 'Free surface: sloshing volume', quantity: 'change of the volume of the cells holding particles after three periods', unit: '1', test: T.slosh,
    reference: {formula: 'conserved', value: 0}, tolerance: absolute(0.01), measure: async () => (await slosh()).volumeChange},
  {id: 'fluid.free-surface.rest', title: 'Free surface: still water', quantity: 'largest particle speed after 1 s in a tank of still water, over sqrt(g h)', unit: '1', test: T.slosh,
    reference: {formula: 'u = 0', value: 0}, tolerance: upper(1e-9), measure: async () => { const r = await run('still', (S, K) => S.freeSurfaceRest(K)); return r.speed / r.scale; }},
]);
