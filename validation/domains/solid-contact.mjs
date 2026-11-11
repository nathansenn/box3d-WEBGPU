// Contact, friction and welds between a tetrahedral solid and rigid bodies (box3d-webgpu-kit/solid-contact), against
// closed-form answers. The set-ups are the ones the test file asserts on:
// packages/box3d-kit/test/solid-contact-scenarios.mjs, run here through the built kit. SI units.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v17-solid-contact.test.mjs';
const T = {
  pad: 'a rigid block on an elastic pad: uniaxial stress with free sides, uniaxial strain with held sides',
  world: 'the same pad under a box of the rigid world, in the stepping loop: compression, force, events, energy, repeat runs',
  hertz: 'Hertz: a rigid sphere pressed into an elastic block, with the mesh study',
  friction: 'Coulomb friction on a deformable incline: sticks below tan(theta) = mu, slides at g (sin - mu cos) above',
  column: 'a mass on an elastic column swings at the frequency of a bar with a tip mass',
  weld: 'welds: a hanging weight stretches its bar by M g L / (E A) + rho g L^2 / (2 E), and a welded end is a clamped end',
  momentum: 'momentum in a free impact: to rounding with float64 bodies, to float32 through the rigid world',
  ratios: 'mass ratios: a light body on a stiff solid and a heavy body on a soft one stay put; naive staggering throws the light one off',
  supported: 'a solid resting on a body that rests on rigid ground weighs what it should',
};

const modules = () => memo('solid-contact/modules', async () => {
  const [S, contact, solid, index, simulation] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/solid-contact-scenarios.mjs')).href), kit('solid-contact'), kit('solid'), kit('index'), kit('simulation')]);
  return {S, K: {...solid, ...contact, createWorld: index.createWorld, createSimulation: simulation.createSimulation}};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`solid-contact/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const pad = mode => run(`pad/${mode}`, (S, K) => S.padStatic(K, {mode}));
const padWorld = () => run('padWorld', (S, K) => S.padWorld(K));
const hertz = (n, m) => run(`hertz/${n}`, (S, K) => S.hertz(K, n, m));
const incline = degrees => run(`incline/${degrees}`, (S, K) => S.incline(K, degrees));
const column = (options = {}) => run(`column/${JSON.stringify(options)}`, (S, K) => S.column(K, options));
const weld = (options = {}) => run(`weld/${JSON.stringify(options)}`, (S, K) => S.hangingWeld(K, options));
const resting = options => run(`resting/${JSON.stringify(options)}`, (S, K) => S.resting(K, options));

export default defineCases('solid-contact', FILE, [
  {id: 'solid-contact.pad.stress', title: 'Rigid block on an elastic pad with free sides', quantity: 'shortening of a 0.2 m x 0.2 m x 0.05 m pad (E = 1 MPa, nu = 0.3) under a 10 kg block, statics', unit: 'm', test: T.pad,
    reference: {formula: 'uniaxial stress: d = m g L / (E A)', value: null}, tolerance: relative(1e-8), note: 'A uniform strain is in the element space and each contact spring is as stiff as the area its node turns to the block, so they sink evenly. Solve tolerance only.',
    measure: async () => { const r = await pad('stress'); return {value: r.shortening, reference: r.exact}; }},
  {id: 'solid-contact.pad.strain', title: 'Rigid block on an elastic pad with held sides', quantity: 'shortening of the same pad with every node held sideways', unit: 'm', test: T.pad,
    reference: {formula: 'uniaxial strain: d = m g L / ((lambda + 2 mu) A)', value: null}, tolerance: relative(1e-8), note: 'The constrained modulus is 1.346 E at nu = 0.3: the two boundary conditions differ by 35%.',
    measure: async () => { const r = await pad('strain'); return {value: r.shortening, reference: r.exact}; }},
  {id: 'solid-contact.pad.depth', title: 'Depth of a contact under pressure', quantity: 'distance between the block and the pad surface', unit: 'm', test: T.pad,
    reference: {formula: 'p l / (stiffnessScale (lambda + 2 mu)), l the mean element size', value: null}, tolerance: relative(5e-3), note: 'The contact is a spring. The force it carries does not depend on its stiffness; this depth does.',
    measure: async () => { const r = await pad('stress'); return {value: r.depth, reference: r.expectedDepth}; }},
  {id: 'solid-contact.world.compression', title: 'Box of the rigid world settling on the pad, in the stepping loop', quantity: 'pad shortening under a 7.2 kg box after 2 s at 240 Hz', unit: 'm', test: T.world,
    reference: {formula: 'd = m g L / (E A), m the mass the world reports', value: null}, tolerance: relative(1e-6), note: 'The box is an unknown of the solid step; the world integrates it with the force of that solve. Float32 mass.',
    measure: async () => { const r = await padWorld(); return {value: r.shortening, reference: r.exact}; }},
  {id: 'solid-contact.world.force', title: 'Force of the pad on the resting box', quantity: 'vertical force handed to the rigid world', unit: 'N', test: T.world,
    reference: {formula: 'F = m g', value: null}, tolerance: relative(1e-6), measure: async () => { const r = await padWorld(); return {value: r.force, reference: r.weight}; }},
  {id: 'solid-contact.world.energy', title: 'Energy ledger of the settling box', quantity: 'largest rise of (total - exchanged) between samples, over the work the box did', unit: '1', test: T.world,
    reference: {formula: 'backward Euler and damping only remove energy', value: 0}, tolerance: upper(1e-9),
    measure: async () => { const r = await padWorld(); return r.worstBalanceRise / r.entry.exchanged; }},
  {id: 'solid-contact.hertz.coarse', title: 'Hertz contact, 2.5 elements per contact radius', quantity: 'force on a rigid sphere (R = 1 m) pressed 0.625 mm into a block, 729 nodes, over Hertz times the bonded-layer factor, minus 1', unit: '1', test: T.hertz,
    reference: {formula: 'F = (4/3) E* sqrt(R) d^1.5 (1 + 0.0460), E* = E / (1 - nu^2); layer factor of Dimitriadis et al. 2002 at a / t = 0.05', value: 0}, tolerance: absolute(0.18),
    note: 'A bound on what was measured (+16.3%), not accuracy. Linear tetrahedra with node-against-sphere contact are too stiff. Against plain Hertz the same run is +21.6%.',
    measure: async () => (await hertz(8, 4)).errorLayer},
  {id: 'solid-contact.hertz.medium', title: 'Hertz contact, 3.75 elements per contact radius', quantity: 'the same, 2197 nodes', unit: '1', test: T.hertz,
    reference: {formula: 'as above', value: 0}, tolerance: absolute(0.11), note: 'Measured +9.4% (+14.4% against plain Hertz).', measure: async () => (await hertz(12, 6)).errorLayer},
  {id: 'solid-contact.hertz.fine', title: 'Hertz contact, 5 elements per contact radius', quantity: 'the same, 4913 nodes', unit: '1', test: T.hertz,
    reference: {formula: 'as above', value: 0}, tolerance: absolute(0.08), note: 'Measured +6.8% (+11.7% against plain Hertz). The error falls with the mesh but slowly; a finer study is outside the gate.', measure: async () => (await hertz(16, 8)).errorLayer},
  {id: 'solid-contact.hertz.exponent', title: 'Hertz contact: exponent of force against indentation', quantity: 'least-squares slope of ln F against ln d over d = 0.2 to 0.625 mm, 2197 nodes', unit: '1', test: T.hertz,
    reference: {formula: 'F ~ d^1.5', value: 1.5}, tolerance: absolute(0.08), note: 'Measured 1.56; 1.54 with the layer factor divided out. The mesh is fixed, so larger indentations see relatively finer elements.',
    measure: async () => (await run('hertz/exponent', (S, K) => S.hertzExponent(K, 12, 7, [0.0002, 0.00033, 0.00045, 0.000625]))).exponent},
  {id: 'solid-contact.friction.stick', title: 'Box on a deformable incline below the friction angle', quantity: 'travel in 0.75 s after settling, 26 degrees, mu = 0.5 (tan = 0.488)', unit: 'm', test: T.friction,
    reference: {formula: 'no motion while tan(theta) < mu', value: 0}, tolerance: absolute(1e-7), note: 'The stick spring holds a fixed point of the box: no creep. Float32 resolves the position to 6e-8 m.',
    measure: async () => (await incline(26)).travelAfterSettling},
  {id: 'solid-contact.friction.ratio', title: 'Box on a deformable incline: friction force when stuck', quantity: 'tangential over normal force at 26 degrees', unit: '1', test: T.friction,
    reference: {formula: 'F_t / N = tan(theta)', value: Math.tan(26 * Math.PI / 180)}, tolerance: relative(1e-5), measure: async () => (await incline(26)).ratio},
  {id: 'solid-contact.friction.slide', title: 'Box sliding on a deformable incline', quantity: 'acceleration at 27.5 degrees with mu = 0.5 (tan = 0.521), least-squares fit over 0.75 s', unit: 'm/s^2', test: T.friction,
    reference: {formula: 'a = -g (sin(theta) - mu cos(theta))', value: -9.81 * (Math.sin(27.5 * Math.PI / 180) - 0.5 * Math.cos(27.5 * Math.PI / 180))}, tolerance: relative(0.02),
    note: 'The acceleration is the difference of two forces 25 times larger. Each node\'s friction limit follows its normal force to 1e-4.', measure: async () => (await incline(27.5)).acceleration},
  {id: 'solid-contact.column.frequency', title: 'Block resting on an elastic column', quantity: 'frequency of a 2 kg block on a 1.25 kg column (k = 1000 N/m), 8 cells, 240 Hz', unit: 'Hz', test: T.column,
    reference: {formula: 'omega = x c / L, x tan(x) = m_column / M (bar with a tip mass)', value: null}, tolerance: relative(4e-3),
    note: 'The column\'s own mass lowers the frequency by 9.3% against sqrt(k / M); the Rayleigh estimate M + m/3 is 0.3% high.',
    measure: async () => { const r = await column(); return {value: r.measured, reference: r.exact}; }},
  {id: 'solid-contact.weld.stretch', title: 'Weight welded under a hanging bar', quantity: 'stretch of a 0.4 m bar (E = 1 MPa, nu = 0) under a 1.536 kg block, settled at 240 Hz', unit: 'm', test: T.weld,
    reference: {formula: 'd = M g L / (E A) + rho g L^2 / (2 E)', value: null}, tolerance: relative(5e-5), note: 'With nu = 0.3 the weld holds the end face\'s width and the bar is 1.4% stiffer: a welded end is a clamped end.',
    measure: async () => { const r = await weld(); return {value: r.stretch, reference: r.exact}; }},
  {id: 'solid-contact.weld.support', title: 'Weight welded under a hanging bar: support reaction', quantity: 'sum of the reactions at the top of the bar', unit: 'N', test: T.weld,
    reference: {formula: 'R = (M + m_bar) g', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await weld(); return {value: r.support, reference: r.totalWeight}; }},
  {id: 'solid-contact.momentum.float64', title: 'Free impact of a ball on an elastic block', quantity: 'largest change of the total linear momentum over 120 steps, over the ball\'s momentum; float64 bodies', unit: '1', test: T.momentum,
    reference: {formula: 'dp = 0', value: 0}, tolerance: upper(2e-11), note: 'What is left is the residual of the nodes\' solve (1e-12 of the force) times the step. With friction 0.4.',
    measure: async () => (await run('impact', (S, K) => S.impact(K, {steps: 120}))).worst},
  {id: 'solid-contact.momentum.float32', title: 'Free impact through the rigid world', quantity: 'the same with the ball in the float32 rigid world', unit: '1', test: T.momentum,
    reference: {formula: 'dp = 0', value: 0}, tolerance: upper(2e-6), measure: async () => (await run('impactWorld', (S, K) => S.impactWorld(K, {steps: 120}))).worst},
  {id: 'solid-contact.ratio.light', title: 'A 4 g body on a steel block', quantity: 'largest speed of the body in 1 s at 240 Hz (contact stiffness h^2 / mass = 7e8)', unit: 'm/s', test: T.ratios,
    reference: {formula: 'at rest', value: 0}, tolerance: upper(1e-5), note: 'The body is an unknown of the solid step, so the stiffness ratio does not matter.',
    measure: async () => (await resting({E: 2e11, density: 1})).largestSpeed},
  {id: 'solid-contact.ratio.naive', title: 'The same with naive staggering', quantity: 'steps until the body is thrown off at more than 20 m/s', unit: 'steps', test: T.ratios,
    reference: {formula: 'unstable when stiffness h^2 / mass is large: thrown off in the first step', value: 1}, tolerance: upper(2), note: 'Kept to show what the implicit coupling avoids. An upper bound on a failure, not accuracy.',
    measure: async () => (await resting({E: 2e11, density: 1, scheme: 'naive-staggered'})).ran},
  {id: 'solid-contact.ratio.heavy', title: 'An 80 kg body on a 2 kg soft pad at 60 Hz', quantity: 'force on the body after 3 s over its weight, minus 1', unit: '1', test: T.ratios,
    reference: {formula: 'F = m g at rest', value: 0}, tolerance: absolute(1e-3), measure: async () => { const r = await resting({E: 2e5, density: 20000, hz: 60, seconds: 3}); return r.force / r.weight - 1; }},
  {id: 'solid-contact.supported.force', title: 'Block resting on a box that rests on rigid ground', quantity: 'force of the 4 kg block on the box', unit: 'N', test: T.supported,
    reference: {formula: 'F = -m g', value: null}, tolerance: relative(1e-5), note: 'The coupling sees the ground under the box only through the estimate of the box\'s supports, which lags a step.',
    measure: async () => { const r = await run('supported', (S, K) => S.supported(K)); return {value: r.force, reference: -r.weight}; }},
]);
