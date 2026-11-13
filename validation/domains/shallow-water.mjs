// Shallow water on terrain (box3d-webgpu-kit/shallow-water): the lake at rest, Ritter's and Stoker's dam breaks,
// Thacker's paraboloid, the three flows over the Goutal-Maurel bump, Manning's normal depth, rain on a slope against the
// kinematic wave, Green-Ampt infiltration, the volume budget, repeatability and coupling to rigid bodies. The set-ups
// are the ones the test file asserts on: packages/box3d-kit/test/shallow-water-scenarios.mjs, run here through the built
// kit. SI units. References: SWASHES (Delestre et al. 2013, arXiv:1110.0288), WEPP technical documentation ch. 4, Rawls
// et al. 1983 (see docs/SHALLOW_WATER.md).
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, lower, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v20-shallow-water.test.mjs';
const T = {
  lake: 'a lake at rest over a bumpy bed stays at rest to round-off, immersed and partly emerged (well-balancing)',
  ritter: "Ritter's dry dam break: depth profile, wet front, positivity, convergence",
  stoker: "Stoker's wet dam break: depth profile and shock position",
  thacker: "Thacker's oscillating paraboloid: moving shoreline over one period, convergence, volume",
  bump: 'steady flows over a bump (Goutal and Maurel): subcritical, transcritical, and with a hydraulic jump',
  manning: 'Manning: the normal depth of a uniform channel',
  rain: 'rain on a slope: the outflow hydrograph against the kinematic wave',
  ga: 'Green-Ampt infiltration against its closed form, with the ponding time',
  budget: 'the volume budget closes to round-off with every source and side at once',
  resume: 'determinism and an exact resume from saveState',
  float: 'a floating box: Archimedes draft, and the lake rises by the displaced volume',
  drift: 'a sphere in a current: drag carries it towards the water speed, and the impulses balance exactly',
};

const modules = () => memo('shallow-water/modules', async () => {
  const [S, sw, index, simulation] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/shallow-water-scenarios.mjs')).href), kit('shallow-water'), kit('index'), kit('simulation')]);
  return {S, K: {...sw, createWorld: index.createWorld, createSimulation: simulation.createSimulation}};
});
const run = (key, call) => memo(`shallow-water/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const lake = level => run(`lake/${level}`, (S, K) => S.lakeAtRest(K, {level}));
const ritter = cells => run(`ritter/${cells}`, (S, K) => S.ritter(K, {cells}));
const stoker = cells => run(`stoker/${cells}`, (S, K) => S.stoker(K, {cells}));
const thacker = cells => run(`thacker/${cells}`, (S, K) => S.thacker(K, {cells}));
const bump = (kind, cells = 200) => run(`bump/${kind}/${cells}`, (S, K) => S.bump(K, kind, {cells}));
const manning = slope => run(`manning/${slope}`, (S, K) => S.manning(K, {slope, time: slope === 0.001 ? 6000 : 3000}));
const rain = cells => run(`rain/${cells}`, (S, K) => S.rainOnSlope(K, {cells}));
const ga = dt => run(`ga/${dt}`, (S, K) => S.greenAmpt(K, {dt}));
const ord = (a, b) => Math.log(a / b) / Math.log(2);

export default defineCases('shallow-water', FILE, [
  {id: 'shallow-water.lake.immersed', title: 'Lake at rest over a bumpy bed (immersed)', quantity: 'largest speed after 400 steps of 0.02 s, level 0.25 m over a 60 x 40 bed with a hump, waves and a tilt', unit: 'm/s', test: T.lake,
    reference: {formula: 'u = 0 (hydrostatic reconstruction is well-balanced)', value: 0}, tolerance: upper(1e-12), measure: async () => (await lake(0.25)).speed},
  {id: 'shallow-water.lake.emerged', title: 'Lake at rest over a bumpy bed (partly emerged)', quantity: 'largest speed after 400 steps, level 0.15 m, 489 of 2400 cells dry', unit: 'm/s', test: T.lake,
    reference: {formula: 'u = 0 at dry-wet edges too', value: 0}, tolerance: upper(1e-12), measure: async () => (await lake(0.15)).speed},
  {id: 'shallow-water.lake.level', title: 'Lake at rest: level', quantity: 'largest change of the water level of a wet cell, emerged case', unit: 'm', test: T.lake,
    reference: {formula: 'eta = eta_0', value: 0}, tolerance: upper(1e-14), measure: async () => (await lake(0.15)).drift},
  {id: 'shallow-water.ritter.l1', title: "Ritter's dry dam break", quantity: 'L1 error of h at t = 6 s over the L1 norm of h, 400 cells (h_l = 5 mm, x0 = 5 m, L = 10 m, SWASHES 4.1.2)', unit: '1', test: T.ritter,
    reference: {formula: 'h = (4/9g)(sqrt(g h_l) - (x - x0)/2t)^2', value: 0}, tolerance: upper(4e-3), note: 'The shoreline is resolved to first order: the thin tip of the wave lags.',
    measure: async () => (await ritter(400)).error},
  {id: 'shallow-water.ritter.order', title: "Ritter's dam break: convergence", quantity: 'order of the L1 error between 200 and 400 cells', unit: '1', test: T.ritter,
    reference: {formula: 'first order at the wet-dry front', value: 1}, tolerance: lower(0.2), measure: async () => ord((await ritter(200)).error, (await ritter(400)).error)},
  {id: 'shallow-water.ritter.front', title: "Ritter's dam break: wet front", quantity: 'position of the last cell deeper than 1% of h_l at t = 6 s, 400 cells', unit: 'm', test: T.ritter,
    reference: {formula: 'where the exact depth is 1% of h_l', value: null}, tolerance: absolute(0.15), note: 'Six cells: the front lags by about five cells (0.12 m) at this depth threshold.',
    measure: async () => { const r = await ritter(400); return {value: r.front, reference: r.xFront}; }},
  {id: 'shallow-water.stoker.l1', title: "Stoker's wet dam break", quantity: 'L1 error of h at t = 6 s, 400 cells (h_l = 5 mm, h_r = 1 mm, SWASHES 4.1.1)', unit: '1', test: T.stoker,
    reference: {formula: 'rarefaction, plateau h_m, shock x_C', value: 0}, tolerance: upper(4e-3), measure: async () => (await stoker(400)).error},
  {id: 'shallow-water.stoker.shock', title: "Stoker's dam break: shock position", quantity: 'where h crosses (h_m + h_r)/2 at t = 6 s', unit: 'm', test: T.stoker,
    reference: {formula: 'x_C = x0 + t 2 c_m^2 (sqrt(g h_l) - c_m) / (c_m^2 - g h_r)', value: null}, tolerance: absolute(0.025),
    measure: async () => { const r = await stoker(400); return {value: r.shock, reference: r.xC}; }},
  {id: 'shallow-water.thacker.l1', title: "Thacker's oscillating paraboloid", quantity: 'L1 error of h after one period, 100 x 100 cells (a = 1 m, r0 = 0.8 m, h0 = 0.1 m, SWASHES 4.2.2)', unit: '1', test: T.thacker,
    reference: {formula: "Thacker's exact periodic solution", value: 0}, tolerance: upper(0.025), note: 'The moving shoreline is resolved to first order.',
    measure: async () => (await thacker(100)).error},
  {id: 'shallow-water.thacker.order', title: "Thacker's paraboloid: convergence", quantity: 'order of the L1 error after one period between 50^2 and 100^2 cells', unit: '1', test: T.thacker,
    reference: {formula: 'between first (shoreline) and second order', value: 1}, tolerance: lower(0), measure: async () => ord((await thacker(50)).error, (await thacker(100)).error)},
  {id: 'shallow-water.bump.subcritical', title: 'Flow over a bump: subcritical', quantity: 'L1 error of the steady depth, q = 4.42 m^2/s, h_L = 2 m, 200 cells', unit: '1', test: T.bump,
    reference: {formula: 'Bernoulli: h^3 + (z - q^2/(2 g h_L^2) - h_L) h^2 + q^2/(2g) = 0', value: 0}, tolerance: upper(1e-4), measure: async () => (await bump('subcritical')).error},
  {id: 'shallow-water.bump.subcritical-order', title: 'Flow over a bump: subcritical, convergence', quantity: 'order of the L1 error between 100 and 200 cells', unit: '1', test: T.bump,
    reference: {formula: 'second order for smooth flow', value: 2}, tolerance: absolute(0.2), measure: async () => ord((await bump('subcritical', 100)).error, (await bump('subcritical')).error)},
  {id: 'shallow-water.bump.transcritical', title: 'Flow over a bump: transcritical', quantity: 'L1 error of the steady depth, q = 1.53 m^2/s, 200 cells', unit: '1', test: T.bump,
    reference: {formula: 'Bernoulli through the critical depth at the crest', value: 0}, tolerance: upper(1e-3), measure: async () => (await bump('transcritical')).error},
  {id: 'shallow-water.bump.shock', title: 'Flow over a bump with a hydraulic jump', quantity: 'L1 error of the steady depth, q = 0.18 m^2/s, h_L = 0.33 m, 200 cells', unit: '1', test: T.bump,
    reference: {formula: 'Bernoulli on both branches, joined by Rankine-Hugoniot', value: 0}, tolerance: upper(3e-3), measure: async () => (await bump('shock')).error},
  {id: 'shallow-water.bump.jump', title: 'Flow over a bump: position of the hydraulic jump', quantity: 'face with the largest rise of h downstream of the crest, 200 cells (0.125 m)', unit: 'm', test: T.bump,
    reference: {formula: 'q^2 (1/h1 - 1/h2) + g/2 (h1^2 - h2^2) = 0', value: null}, tolerance: absolute(0.125),
    measure: async () => { const r = await bump('shock'); return {value: r.jump, reference: r.jumpExact}; }},
  {id: 'shallow-water.manning.depth', title: 'Manning normal depth, slope 0.001', quantity: 'depth at mid-channel, q = 0.5 m^2/s, n = 0.03, 100 cells of 1 m', unit: 'm', test: T.manning,
    reference: {formula: 'h = (n q / sqrt(S))^(3/5)', value: null}, tolerance: relative(5e-4), note: 'Friction is split from the transport: an O(dt) error, -2.5e-4 here.',
    measure: async () => { const r = await manning(0.001); return {value: r.depth, reference: r.normal}; }},
  {id: 'shallow-water.manning.steep', title: 'Manning normal depth, slope 0.01 (Froude 0.88)', quantity: 'depth at mid-channel', unit: 'm', test: T.manning,
    reference: {formula: 'h = (n q / sqrt(S))^(3/5)', value: null}, tolerance: relative(2e-3), measure: async () => { const r = await manning(0.01); return {value: r.depth, reference: r.normal}; }},
  {id: 'shallow-water.rain.hydrograph', title: 'Rain on a slope: outflow hydrograph', quantity: 'rms error of the outflow per width over 300 s over the rms outflow, plane 20 m, 5%, n = 0.02, 50 mm/h, 400 cells', unit: '1', test: T.rain,
    reference: {formula: 'kinematic wave: q = (sqrt(S)/n) (r t)^(5/3) until t_e, then r L (WEPP eqs. 4.4.1-4.4.10)', value: 0}, tolerance: upper(0.05), note: 'The full equations against the kinematic approximation; the open foot of the plane draws the water down near the outlet early on.',
    measure: async () => (await rain(400)).rms},
  {id: 'shallow-water.rain.equilibrium', title: 'Rain on a slope: equilibrium outflow', quantity: 'largest relative difference of the outflow from r L after 2 t_e', unit: '1', test: T.rain,
    reference: {formula: 'q = r L', value: 0}, tolerance: upper(1e-4), measure: async () => (await rain(400)).steady},
  {id: 'shallow-water.greenampt.cumulative', title: 'Green-Ampt infiltration under rain', quantity: 'largest |F - F_exact| over 2 h of 20 mm/h on a loam (Rawls et al. 1983 Table 2), dt = 10 s', unit: 'm', test: T.ga,
    reference: {formula: 'F = r t until t_p; then F - F_p - S ln((F+S)/(F_p+S)) = K (t - t_p)', value: 0}, tolerance: upper(1e-6), measure: async () => (await ga(10)).worst},
  {id: 'shallow-water.greenampt.ponding', title: 'Green-Ampt: ponding time', quantity: 'first time water stands on the surface, dt = 1 s', unit: 's', test: T.ga,
    reference: {formula: 't_p = K S / (r (r - K)), S = psi eta', value: null}, tolerance: absolute(2),
    measure: async () => { const r = await ga(1); return {value: r.ponded, reference: r.pondingTime}; }},
  {id: 'shallow-water.volume.budget', title: 'Volume budget', quantity: '|volume - start - inflow - rain + infiltrated| over the volume, 48 x 32 cells with an inflow, an open side, rain, infiltration on half the cells, friction and wetting', unit: '1', test: T.budget,
    reference: {formula: 'conservation of volume', value: 0}, tolerance: upper(1e-12), measure: async () => (await run('budget', (S, K) => S.budget(K))).relative},
  {id: 'shallow-water.determinism.resume', title: 'Repeatability and resume', quantity: 'runs whose final depth and discharge bits differ from a straight run (a resumed one, a repeated one)', unit: 'runs', test: T.resume,
    reference: {formula: 'bit-identical state', value: 0}, tolerance: upper(0), measure: async () => { const r = await run('resume', (S, K) => S.resume(K)); return (r.a !== r.b) + (r.a !== r.repeat); }},
  {id: 'shallow-water.coupling.archimedes', title: 'Floating box: displaced volume', quantity: 'submerged volume of a 500 kg/m^3 box in a lake, mean over the 6th second', unit: 'm^3', test: T.float,
    reference: {formula: 'V = m / rho', value: null}, tolerance: relative(0.03), note: 'The closed lake still sloshes after the drop: the mean wanders by about 1%.',
    measure: async () => { const r = await run('float', (S, K) => S.floatingBox(K)); return {value: r.submerged, reference: r.displacedExact}; }},
  {id: 'shallow-water.coupling.rise', title: 'Floating box: rise of the lake', quantity: 'mean level rise of a 4 m x 4 m lake', unit: 'm', test: T.float,
    reference: {formula: 'm / (rho A_lake)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await run('float', (S, K) => S.floatingBox(K)); return {value: r.rise, reference: r.riseExact}; }},
  {id: 'shallow-water.coupling.third-law', title: 'Sphere in a current: impulses', quantity: 'impulse handed to the body plus impulse handed to the water over 10 s', unit: 'N s', test: T.drift,
    reference: {formula: 'equal and opposite', value: 0}, tolerance: absolute(0), measure: async () => { const r = await run('drift', (S, K) => S.drifting(K)); return r.onBodies + r.onWater; }},
]);
