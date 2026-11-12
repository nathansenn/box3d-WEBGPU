// Granular media by the discrete element method (box3d-webgpu-kit/granular): two-body impacts, a grain on an incline,
// the energy ledger, a column at rest, Janssen's silo law, Beverloo's discharge law, the angle of repose and two-way
// coupling to rigid bodies. The set-ups are the ones the test file asserts on:
// packages/box3d-kit/test/granular-scenarios.mjs, run here through the built kit. SI units.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, lower, order, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v17-granular.test.mjs';
const T = {
  elastic: 'two grains, elastic: the Hertz contact duration matches the closed form and the scheme is second order',
  damped: 'two grains, damped: the restitution is the one asked for, at any speed, for both laws',
  oblique: 'oblique impact: sliding and sticking rebounds match their closed forms',
  incline: 'a grain on an incline slides at g (sin - mu cos) and rolls at (5/7) g sin',
  ledger: 'energy ledger: kinetic + gravitational + elastic + dissipated stays constant, converging at second order',
  column: 'a column at rest: the floor carries the weight',
  janssen: 'Janssen: the load on a silo floor saturates with fill height',
  beverloo: 'Beverloo: the discharge through an orifice follows (D - k d)^(5/2) and does not depend on the fill height',
  repose: 'angle of repose: steeper with friction and with rolling resistance (a trend check)',
  beads: 'glass beads: the library beads with one fitted rolling resistance pile at 22 degrees and collapse as Lajeunesse et al. (2005) measured',
  block: 'coupling: a block resting on a bed is carried by a force equal to its weight, and the floor reads both',
  third: 'coupling: the third law, grains and body exchange equal and opposite momentum',
  scale: 'coupling: a box of beads on a spring scale reads their weight',
  determinism: 'determinism: repeat runs are bit-identical, and the Simulation loop adds nothing',
};

const modules = () => memo('granular/modules', async () => {
  const [S, granular, index, simulation] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/granular-scenarios.mjs')).href), kit('granular'), kit('index'), kit('simulation')]);
  return {S, K: {...granular, createWorld: index.createWorld, axisRotation: index.axisRotation, createSimulation: simulation.createSimulation}};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`granular/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const headOn = (options = {}) => run(`head/${JSON.stringify(options)}`, (S, K) => S.headOn(K, options));
const oblique = (options = {}) => run(`oblique/${JSON.stringify(options)}`, (S, K) => S.oblique(K, options));
const incline = (options = {}) => run(`incline/${JSON.stringify(options)}`, (S, K) => S.incline(K, options));
const ledger = (options = {}) => run(`ledger/${JSON.stringify(options)}`, (S, K) => S.ledger(K, options));
const janssen = () => run('janssen', (S, K) => S.janssen(K));
const beverloo = () => run('beverloo', (S, K) => S.beverloo(K));
const collapse = aspect => run(`collapse/${aspect}`, (S, K) => S.columnCollapse(K, {aspect}));
const repose = (friction, rollingFriction) => run(`repose/${friction}/${rollingFriction}`, (S, K) => S.repose(K, {friction, rollingFriction}));
const REPOSE = [[0.2, 0], [0.5, 0], [0.5, 0.1], [0.5, 0.3]];
const block = () => run('block', (S, K) => S.blockOnBed(K));
const collision = () => run('collision', (S, K) => S.freeCollision(K));
const error = (measured, reference) => measured / reference - 1;

export default defineCases('granular', FILE, [
  {id: 'granular.hertz.duration', title: 'Two grains head on: Hertz contact duration', quantity: 'time the overlap of two 10 mm beads (E = 1e8 Pa, nu = 0.3) meeting at 0.1 m/s stays positive, step = 2% of the Rayleigh time', unit: 's', test: T.elastic,
    reference: {formula: 't = 2.943 (15 m* v^2 / (16 E* sqrt(R*)))^(2/5) / v', value: null}, tolerance: relative(5e-5), note: 'The crossings are interpolated inside a step; what is left is the time-stepping error.',
    measure: async () => { const r = await headOn({fraction: 0.02}); return {value: r.duration, reference: r.hertzDuration}; }},
  {id: 'granular.hertz.duration-order', title: 'Two grains head on: convergence of the duration', quantity: 'order of the duration error between steps of 8% and 4% of the Rayleigh time', unit: '1', test: T.elastic,
    reference: {formula: 'velocity Verlet is second order', value: 2}, tolerance: absolute(0.3),
    measure: async () => { const a = await headOn({fraction: 0.08}), b = await headOn({fraction: 0.04}); return order(error(a.duration, a.hertzDuration), error(b.duration, b.hertzDuration)); }},
  {id: 'granular.hertz.energy-order', title: 'Two grains head on: convergence of the energy', quantity: 'order of the largest energy error during an elastic impact between steps of 4% and 2% of the Rayleigh time', unit: '1', test: T.elastic,
    reference: {formula: 'velocity Verlet is second order', value: 2}, tolerance: absolute(0.2),
    measure: async () => { const a = await headOn({fraction: 0.04}), b = await headOn({fraction: 0.02}); return order(a.energyDrift, b.energyDrift); }},
  {id: 'granular.linear.duration', title: 'Two grains head on: linear-spring contact duration', quantity: 'duration of the same impact with a linear spring of 1e5 N/m, step = 1% of the duration', unit: 's', test: T.elastic,
    reference: {formula: 't = pi sqrt(m* / k_n)', value: null}, tolerance: relative(2e-4),
    measure: async () => { const r = await headOn({law: 'linear', fraction: 0.01}); return {value: r.duration, reference: r.linearDuration}; }},
  {id: 'granular.momentum.impact', title: 'Two grains head on: momentum', quantity: 'change of total momentum over m v in a damped Hertz impact (e = 0.5)', unit: '1', test: T.damped,
    reference: {formula: 'p = const', value: 0}, tolerance: upper(1e-13), measure: async () => (await headOn({law: 'hertz', restitution: 0.5, speed: 0.1, fraction: 0.01})).momentum},
  {id: 'granular.restitution.hertz-09', title: 'Restitution, Hertz law, e = 0.9', quantity: 'rebound speed over impact speed at 0.1 m/s, step = 1% of the Rayleigh time', unit: '1', test: T.damped,
    reference: {formula: 'e as set', value: 0.9}, tolerance: absolute(1e-3), measure: async () => (await headOn({law: 'hertz', restitution: 0.9, speed: 0.1, fraction: 0.01})).restitution},
  {id: 'granular.restitution.hertz-05', title: 'Restitution, Hertz law, e = 0.5', quantity: 'rebound speed over impact speed at 0.1 m/s', unit: '1', test: T.damped,
    reference: {formula: 'e as set', value: 0.5}, tolerance: absolute(1e-3), note: 'The damping coefficient is solved for numerically with the force clamped at zero; the textbook coefficient would give a larger rebound.',
    measure: async () => (await headOn({law: 'hertz', restitution: 0.5, speed: 0.1, fraction: 0.01})).restitution},
  {id: 'granular.restitution.hertz-02-fast', title: 'Restitution, Hertz law, e = 0.2, ten times faster', quantity: 'rebound speed over impact speed at 1 m/s', unit: '1', test: T.damped,
    reference: {formula: 'e as set, at any speed', value: 0.2}, tolerance: absolute(1e-3), measure: async () => (await headOn({law: 'hertz', restitution: 0.2, speed: 1, fraction: 0.01})).restitution},
  {id: 'granular.restitution.linear-05', title: 'Restitution, linear law, e = 0.5', quantity: 'rebound speed over impact speed at 0.1 m/s, step = 0.2% of the contact duration', unit: '1', test: T.damped,
    reference: {formula: 'e as set', value: 0.5}, tolerance: absolute(2e-3), note: 'The linear dashpot switches on at first touch: a first-order error in the step.',
    measure: async () => (await headOn({law: 'linear', restitution: 0.5, speed: 0.1, fraction: 0.002})).restitution},
  {id: 'granular.oblique.sliding', title: 'Oblique impact on a plane: sliding regime (Hertz)', quantity: 'tangential velocity of the contact point after the impact over the normal speed before, psi1 = 5, mu = 0.3, e = 0.7', unit: '1', test: T.oblique,
    reference: {formula: 'psi2 = psi1 - (7/2) mu (1 + e)', value: null}, tolerance: absolute(5e-3), note: 'Rigid-sphere result; the overlap is 7e-4 of the radius.',
    measure: async () => { const r = await oblique({psi: 5, restitution: 0.7}); return {value: r.psi2, reference: r.sliding}; }},
  {id: 'granular.oblique.sliding-linear', title: 'Oblique impact on a plane: sliding regime (linear)', quantity: 'the same with linear springs, psi1 = 6, mu = 0.4, e = 0.6', unit: '1', test: T.oblique,
    reference: {formula: 'psi2 = psi1 - (7/2) mu (1 + e)', value: null}, tolerance: absolute(5e-3),
    measure: async () => { const r = await oblique({law: 'linear', psi: 6, restitution: 0.6, friction: 0.4}); return {value: r.psi2, reference: r.sliding}; }},
  {id: 'granular.oblique.sticking', title: 'Oblique impact on a plane: sticking, k_t = 2/7 k_n', quantity: 'psi2 for psi1 = 1 with linear springs, no damping and no slip', unit: '1', test: T.oblique,
    reference: {formula: 'psi2 = psi1 cos(pi sqrt(7 k_t / (2 k_n))) = -psi1', value: -1}, tolerance: absolute(2e-3),
    measure: async () => (await oblique({law: 'linear', psi: 1, friction: 10, tangentialDamping: 0, fraction: 0.005})).psi2},
  {id: 'granular.oblique.sticking-half', title: 'Oblique impact on a plane: sticking, k_t = 1/7 k_n', quantity: 'psi2 for psi1 = 1 with linear springs, no damping', unit: '1', test: T.oblique,
    reference: {formula: 'psi2 = psi1 cos(pi sqrt(1/2))', value: null}, tolerance: absolute(5e-3), note: 'The normal force reaches zero before the tangential one at the end of the impact, so the contact slips a little there.',
    measure: async () => { const r = await oblique({law: 'linear', psi: 1, friction: 10, ratio: 1 / 7, tangentialDamping: 0, fraction: 0.005}); return {value: r.psi2, reference: r.sticking}; }},
  {id: 'granular.incline.sliding', title: 'Grain sliding down an incline', quantity: 'acceleration of a bead on a 30 degree plane with mu = 0.1 (Hertz)', unit: 'm/s^2', test: T.incline,
    reference: {formula: 'a = g (sin theta - mu cos theta)', value: null}, tolerance: relative(1e-9),
    measure: async () => { const r = await incline({law: 'hertz', friction: 0.1}); return {value: r.acceleration, reference: r.sliding}; }},
  {id: 'granular.incline.rolling', title: 'Grain rolling down an incline', quantity: 'acceleration of a bead on a 30 degree plane with mu = 0.5 (Hertz), from rest', unit: 'm/s^2', test: T.incline,
    reference: {formula: 'a = (5/7) g sin theta', value: null}, tolerance: relative(1e-3), note: 'The lever arm is the radius less the overlap, and the tangential spring rings a little after the start.',
    measure: async () => { const r = await incline({law: 'hertz', friction: 0.5}); return {value: r.acceleration, reference: r.rolling}; }},
  {id: 'granular.incline.rolling-linear', title: 'Grain rolling down an incline (linear law)', quantity: 'the same with linear springs', unit: 'm/s^2', test: T.incline,
    reference: {formula: 'a = (5/7) g sin theta', value: null}, tolerance: relative(1e-3),
    measure: async () => { const r = await incline({law: 'linear', friction: 0.5}); return {value: r.acceleration, reference: r.rolling}; }},
  {id: 'granular.energy.ledger', title: 'Energy ledger of 288 beads dropped in a box', quantity: 'largest change of kinetic + gravitational + elastic + dissipated over the energy dissipated, Hertz, friction 0.5, rolling 0.1, e = 0.6, step = 10% of the Rayleigh time', unit: '1', test: T.ledger,
    reference: {formula: 'K + U + E + D = const', value: 0}, tolerance: upper(2.5e-3), note: 'Dissipation is integrated from the forces (dashpot force times closing speed, friction force times slip), not taken as the remainder.',
    measure: async () => (await ledger({fraction: 0.1})).drift},
  {id: 'granular.energy.ledger-order', title: 'Energy ledger: convergence', quantity: 'order of the ledger drift between steps of 20% and 10% of the Rayleigh time', unit: '1', test: T.ledger,
    reference: {formula: 'second order', value: 2}, tolerance: absolute(0.6), note: 'Many bodies: the two runs are not the same trajectory.',
    measure: async () => { const a = await ledger({fraction: 0.2}), b = await ledger({fraction: 0.1}); return order(a.drift, b.drift); }},
  {id: 'granular.column.floor', title: 'Column of 300 beads at rest', quantity: 'force on the floor of a box with frictionless sides, mean over 0.1 s (Hertz, E = 5e6 Pa)', unit: 'N', test: T.column,
    reference: {formula: 'F = M g', value: null}, tolerance: relative(1e-3), measure: async () => { const r = await run('column', (S, K) => S.column(K)); return {value: -r.floor, reference: r.weight}; }},
  {id: 'granular.janssen.share', title: 'Janssen: floor load of a full silo', quantity: 'floor load over the weight of 989 beads in a silo 6 bead diameters wide, read while the floor descends', unit: '1', test: T.janssen,
    reference: {formula: 'a fluid gives 1; Janssen W_s / W for a tall fill', value: 0}, tolerance: upper(0.2), measure: async () => (await janssen()).hydrostatic},
  {id: 'granular.janssen.fit', title: 'Janssen: floor load against weight poured, eight fills', quantity: 'rms misfit of F = W_s (1 - exp(-W / W_s)) over W_s; W_s is the one fitted number', unit: '1', test: T.janssen,
    reference: {formula: 'F = W_s (1 - exp(-W / W_s)), W_s = rho_b g A D / (4 mu K)', value: 0}, tolerance: upper(0.1), note: 'Each load is a mean over 3 mm of descent of a column six beads wide and wanders by about a tenth.',
    measure: async () => (await janssen()).residual},
  {id: 'granular.janssen.plateau', title: 'Janssen: saturation', quantity: 'mean floor load of the last four fills (which double the weight)', unit: 'N', test: T.janssen,
    reference: {formula: 'the fitted W_s', value: null}, tolerance: relative(0.1), measure: async () => { const r = await janssen(); return {value: r.plateau, reference: r.saturation}; }},
  {id: 'granular.janssen.stress-ratio', title: 'Janssen: stress ratio K', quantity: 'K = D / (4 mu lambda) from the fitted W_s and the measured mobilised wall friction', unit: '1', test: T.janssen,
    reference: {formula: 'mean wall pressure over floor pressure of the full silo, read from the solver', value: null}, tolerance: relative(0.25), note: 'Nothing is fitted in the reference. The mobilised friction is about half the coefficient because beads at the wall roll.',
    measure: async () => { const r = await janssen(); return {value: r.stressRatio, reference: r.stressRatioDirect}; }},
  {id: 'granular.beverloo.fit', title: 'Beverloo: discharge through four orifices', quantity: 'worst misfit of W = C rho_b sqrt(g) (D - k d)^(5/2) over the rates at D = 5, 6, 7, 8 d; C and k are fitted', unit: '1', test: T.beverloo,
    reference: {formula: 'W = C rho_b sqrt(g) (D - k d)^(5/2)', value: 0}, tolerance: upper(0.15), note: 'Each rate is read from 200 beads leaving a silo of 2600; a run of 12000 beads and six orifices fits to 2% (docs/GRANULAR.md).',
    measure: async () => (await beverloo()).misfit},
  {id: 'granular.beverloo.c', title: 'Beverloo: coefficient C', quantity: 'fitted C with the bulk density of the fill at rest', unit: '1', test: T.beverloo,
    reference: {formula: 'typical literature values 0.55 to 0.65, from memory; the middle', value: 0.6}, tolerance: absolute(0.25), note: 'The measured value sits below the usual range; the larger run gives 0.49. The band is wide because two numbers are fitted to four noisy rates.',
    measure: async () => (await beverloo()).C},
  {id: 'granular.beverloo.k', title: 'Beverloo: empty-annulus factor k', quantity: 'fitted k', unit: '1', test: T.beverloo,
    reference: {formula: 'typical literature values 1 to 2, from memory; the middle', value: 1.5}, tolerance: absolute(1), measure: async () => (await beverloo()).k},
  {id: 'granular.beverloo.height', title: 'Beverloo: independence of the fill height', quantity: 'rate over the last third over rate over the first third of 700 beads through D = 8 d, the level falling from 13.8 d to 11.3 d', unit: '1', test: T.beverloo,
    reference: {formula: '1 (a liquid would give sqrt(11.3 / 13.8) = 0.90)', value: 1}, tolerance: absolute(0.12), measure: async () => (await beverloo()).heightRatio},
  {id: 'granular.repose.trend', title: 'Angle of repose: trend with friction and rolling resistance', quantity: 'slope of the pile left on a ledge with mu = 0.5, mu_r = 0.3 less the slope with mu = 0.2, mu_r = 0', unit: 'deg', test: T.repose,
    reference: {formula: 'steeper by at least 6 degrees (a trend check, no closed form)', value: 6}, tolerance: lower(0), note: 'The slopes are 22, 26, 27 and 35 degrees for (0.2, 0), (0.5, 0), (0.5, 0.1), (0.5, 0.3); each carries about 2 degrees of noise.',
    measure: async () => (await repose(0.5, 0.3)).angle - (await repose(0.2, 0)).angle},
  {id: 'granular.repose.retained', title: 'Angle of repose: mass left on the ledge', quantity: 'pairs of consecutive cases (mu, mu_r) = (0.2, 0), (0.5, 0), (0.5, 0.1), (0.5, 0.3) in which more resistance left less mass', unit: 'pairs', test: T.repose,
    reference: {formula: 'monotonic', value: 0}, tolerance: upper(0),
    measure: async () => { const kept = []; for (const [mu, mur] of REPOSE) kept.push((await repose(mu, mur)).retained); return kept.slice(1).filter((m, i) => m <= kept[i]).length; }},
  {id: 'granular.coupling.block', title: 'Rigid block resting on a bed of 384 beads', quantity: 'mean force of the bed on a 0.125 kg block over 0.2 s', unit: 'N', test: T.block,
    reference: {formula: 'F = m g', value: null}, tolerance: relative(1e-5), note: 'The block is a float32 body of the rigid world; the beads take 37 steps inside each rigid step.',
    measure: async () => { const r = await block(); return {value: r.force, reference: r.weight}; }},
  {id: 'granular.coupling.floor', title: 'Rigid block on a bed: floor load', quantity: 'mean load on the floor under bed and block', unit: 'N', test: T.block,
    reference: {formula: 'F = (M_beads + m_block) g', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await block(); return {value: r.base, reference: r.total}; }},
  {id: 'granular.coupling.momentum', title: 'Beads striking a free rigid sphere: total momentum', quantity: 'change of the momentum of 27 beads plus the sphere over the momentum exchanged, no gravity', unit: '1', test: T.third,
    reference: {formula: 'p = const', value: 0}, tolerance: upper(2e-6), note: 'The sphere\'s velocity is a float32 of the rigid world.', measure: async () => (await collision()).change},
  {id: 'granular.coupling.third-law', title: 'Beads striking a free rigid sphere: impulse handed over', quantity: 'momentum change of the beads plus the impulse the coupling gave the sphere, over the momentum exchanged', unit: '1', test: T.third,
    reference: {formula: 'equal and opposite', value: 0}, tolerance: upper(1e-12), measure: async () => (await collision()).grainSide},
  {id: 'granular.coupling.scale', title: 'Box of 256 beads on a spring scale', quantity: 'extra load read from the extra sag (42 mm) of a tray on a spring joint under the beads', unit: 'N', test: T.scale,
    reference: {formula: 'dF = M g', value: null}, tolerance: relative(1e-5), note: 'The sag is a float32 position of the rigid world.',
    measure: async () => { const r = await run('scale', (S, K) => S.scale(K)); return {value: r.reading, reference: r.weight}; }},
  {id: 'granular.determinism.repeat', title: 'Repeatability', quantity: 'runs whose final bits differ from the first, of three more (a coupled run, the same through the Simulation loop, the solver alone twice)', unit: 'runs', test: T.determinism,
    reference: {formula: 'bit-identical state', value: 0}, tolerance: upper(0), note: 'One machine, one build. The grains are float64 JavaScript; the rigid world is the WASM.',
    measure: async () => { const {S, K} = await modules(), a = await S.fingerprint(K), b = await S.fingerprint(K), c = await S.fingerprint(K, {simulation: true}), x = S.solverFingerprint(K), y = S.solverFingerprint(K); return (a.hash !== b.hash) + (a.hash !== c.hash) + (x.hash !== y.hash); }},
  {id: 'granular.glass-beads.repose', title: 'Glass beads: angle of repose (fitted)', quantity: 'pile angle on a 12 d ledge, mean of three packings, library glass beads (mu 0.12, e 0.926) with rolling resistance 0.06; the rolling resistance is fitted to this row', unit: 'deg', test: T.beads,
    reference: {formula: 'Lajeunesse, Monnier & Homsy 2005, Table I: 22 +/- 0.5 deg', value: 22}, tolerance: absolute(2.5), note: 'One number fitted (the rolling resistance); one packing scatters by about 2 degrees. Makse et al. (1998) measured 26 +/- 1 deg for spherical beads in a Hele-Shaw cell, where the walls add friction.',
    measure: async () => (await run('bead-repose', (S, K) => S.glassBeadRepose(K))).angle},
  {id: 'granular.collapse.runout-05', title: 'Column collapse: runout at a = 0.5', quantity: 'Delta L / L_i of a column of library glass beads (10 mm, L_i = 8 d) released at once in a channel 6 d wide, rough floor', unit: '1', test: T.beads,
    reference: {formula: 'Delta L / L_i = 1.8 a for a < 3 (Lajeunesse et al. 2005; the proportionality from the text, the prefactor read from Fig. 6a)', value: null}, tolerance: relative(0.3),
    measure: async () => { const r = await collapse(0.5); return {value: r.runout, reference: r.expectedRunout}; }},
  {id: 'granular.collapse.runout-1', title: 'Column collapse: runout at a = 1', quantity: 'Delta L / L_i of a column of library glass beads (10 mm, L_i = 8 d) released at once in a channel 6 d wide, rough floor', unit: '1', test: T.beads,
    reference: {formula: 'Delta L / L_i = 1.8 a for a < 3 (Lajeunesse et al. 2005; the proportionality from the text, the prefactor read from Fig. 6a)', value: null}, tolerance: relative(0.3),
    measure: async () => { const r = await collapse(1); return {value: r.runout, reference: r.expectedRunout}; }},
  {id: 'granular.collapse.runout-2', title: 'Column collapse: runout at a = 2', quantity: 'Delta L / L_i of a column of library glass beads (10 mm, L_i = 8 d) released at once in a channel 6 d wide, rough floor', unit: '1', test: T.beads,
    reference: {formula: 'Delta L / L_i = 1.8 a for a < 3 (Lajeunesse et al. 2005; the proportionality from the text, the prefactor read from Fig. 6a)', value: null}, tolerance: relative(0.3),
    measure: async () => { const r = await collapse(2); return {value: r.runout, reference: r.expectedRunout}; }},
  {id: 'granular.collapse.height', title: 'Column collapse: a low column keeps its height', quantity: 'H_f / L_i of the deposit at a = 0.5', unit: '1', test: T.beads,
    reference: {formula: 'H_f / L_i = a for a < 0.7 (Lajeunesse et al. 2005)', value: null}, tolerance: relative(0.1),
    measure: async () => { const r = await collapse(0.5); return {value: r.height, reference: r.expectedHeight}; }},
]);
