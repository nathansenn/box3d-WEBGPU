// Calibrated cloth (box3d-webgpu-kit/cloth): membrane, bending, dynamics, contact, friction, two-way coupling to
// rigid bodies and self-collision, against closed-form answers. The set-ups are the ones the test file asserts on:
// packages/box3d-kit/test/cloth-scenarios.mjs, run here through the built kit. SI units.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, lower, order, ROOT} from '../lib.mjs';

const FILE = 'packages/box3d-kit/test/v16-cloth.test.mjs';
const T = {
  patch: 'membrane patch test: a uniform strain is reproduced on an irregular mesh',
  uniaxial: 'uniaxial strip: stress = E strain and lateral contraction = -nu strain; edge springs fail it',
  hanging: 'hanging strip: elongation rho g L^2 / (2 E t) and reaction = weight',
  catenary: 'catenary: a stiff strip pinned at both ends sags like the inextensible catenary, converging with the mesh',
  cantilever: 'cantilever strip: tip deflection w L^4 / (8 D), second order on regular meshes, with the error on irregular ones stated',
  strip: 'pre-tensioned strip: first frequency (1 / 2L) sqrt(T / rho), converging with the mesh',
  membrane: 'pressurised square membrane: centre deflection 0.0737 p a^2 / T',
  energy: 'energy: backward Euler loses 1 / (1 + (omega dt)^2) per step, the midpoint rule conserves',
  friction: 'friction on an incline: sticks below tan(theta) = mu, slides at g (sin - mu cos) above',
  sweep: 'no tunnelling: a thin kinematic plate sweeps a cloth at up to 200 m/s',
  trampoline: 'trampoline: momentum balances, reactions carry the weight at rest, rest depth matches statics',
  scale: 'a cloth draped over a box on a spring scale adds exactly its weight',
  hangingBody: 'a body hanging from a strip stretches it by m g L / (E t w)',
  light: 'a light body on a stiff cloth is stable; naive staggering blows up',
  stack: 'self-collision: stacked sheets carry their weight a thickness apart',
  fold: 'self-collision: a folded cloth pressed by a box keeps its layers apart',
  determinism: 'determinism: repeat runs are bit-identical, and the Simulation loop adds nothing',
};

const modules = () => memo('cloth/modules', async () => {
  const [S, cloth, index, simulation] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/cloth-scenarios.mjs')).href), kit('cloth'), kit('index'), kit('simulation')]);
  return {S, K: {...cloth, createWorld: index.createWorld, axisRotation: index.axisRotation, createSimulation: simulation.createSimulation}};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`cloth/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });
const error = (measured, reference) => measured / reference - 1;

const uniaxial = () => run('uniaxial', (S, K) => S.uniaxial(K));
const hanging = () => run('hanging', (S, K) => S.hangingStrip(K, {n: 16}));
const catenary = n => run(`catenary/${n}`, (S, K) => S.catenary(K, n));
const cantilever = (n, options = {}) => run(`cantilever/${n}/${JSON.stringify(options)}`, (S, K) => S.cantilever(K, n, options));
const strip = (options = {}) => run(`strip/${JSON.stringify(options)}`, (S, K) => S.tensionedStrip(K, options));
const membrane = n => run(`membrane/${n}`, (S, K) => S.pressurisedMembrane(K, n));
const incline = (degrees, mu, seconds) => run(`incline/${degrees}/${mu}`, (S, K) => S.incline(K, degrees, mu, seconds));
const trampoline = () => run('trampoline', (S, K) => S.trampoline(K));
const hangingBody = (options = {}) => run(`body/${JSON.stringify(options)}`, (S, K) => S.hangingBody(K, options));
const fold = () => run('fold', (S, K) => S.foldPress(K));
const stack = () => run('stack', (S, K) => S.stack(K));

// Woven fabric (orthotropic membrane, edge cables, tearing): tests/engine/cloth-fabric.test.mjs, through the engine source.
const FABRIC_FILE = 'tests/engine/cloth-fabric.test.mjs';
const FT = {
  uniaxial: 'uniaxial strip along the warp, the weft and at 45 degrees: strain = T / E_dir (orthotropic compliance)',
  arc: 'a long strip under pressure takes a circular arc: T = p R with the weft stiffness in plane strain',
  square: 'a pretensioned square membrane under a small uniform load: Fourier series of T laplacian(w) = -q; reactions equal the load',
  tear: 'tearing: an intact strip fails at its strength times its width; a strip with a slit fails below the net-section load',
};
const FAB = {warp: 1225e3, weft: 1000e3, shear: 30e3, poissonRatio: 0.35};
const fabricOf = (dir, extra = {}) => ({arealDensity: 1.35, youngModulus: 1e9, thickness: 1e-3, poissonRatio: 0.3, bending: 'none', orthotropic: {...FAB, warpDirection: dir}, ...extra});
const clothSrc = () => import(pathToFileURL(path.join(ROOT, 'src/engine/cloth.ts')).href);
const fabricStrip = dir => memo(`cloth/fabric-strip/${dir}`, async () => {
  const {Cloth, clothGrid} = await clothSrc(), T = 1000, nx = 20, nz = 4, W = 0.2;
  const g = clothGrid({nx, ny: nz, u: [1, 0, 0], v: [0, 0, W], origin: [0, 0, 0], diagonal: 'alternate'});
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabricOf(dir.split(',').map(Number)), config: {dt: 1, gravity: [0, 0, 0]}});
  for (let j = 0; j <= nz; j++) cloth.pin(g.node(0, j));
  for (let j = 0; j <= nz; j++) cloth.setNodalForce(g.node(nx, j), [T * W / nz * (j === 0 || j === nz ? 0.5 : 1), 0, 0]);
  cloth.solveStatic();
  const x = cloth.positions, a = g.node(7, 2), b = g.node(13, 2);
  return (x[3 * b] - x[3 * a]) / 0.3 - 1;
});
const fabricArc = () => memo('cloth/fabric-arc', async () => {
  const {Cloth, clothGrid} = await clothSrc(), S = 1, B = 6, nx = 16, nz = 48, p = 2000;
  const g = clothGrid({nx, ny: nz, u: [S, 0, 0], v: [0, 0, B], origin: [0, 0, 0], diagonal: 'alternate'});
  const pinned = []; for (let j = 0; j <= nz; j++) pinned.push(g.node(0, j), g.node(nx, j));
  for (let i = 0; i <= nx; i++) pinned.push(g.node(i, 0), g.node(i, nz));
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabricOf([0, 0, 1]), config: {dt: 1, gravity: [0, 0, 0]}, pinned});
  cloth.setPressure(p); cloth.solveStatic();
  const n21 = FAB.poissonRatio * FAB.weft / FAB.warp, Q = FAB.weft / (1 - FAB.poissonRatio * n21);
  let lo = S / 2 * 1.0000001, hi = 1e6;
  for (let k = 0; k < 200; k++) { const R = Math.sqrt(lo * hi), a = Math.asin(S / (2 * R)); if (2 * R * a > S * (1 + p * R / Q)) lo = R; else hi = R; }
  const R = Math.sqrt(lo * hi), a = Math.asin(S / (2 * R));
  return {value: Math.abs(cloth.positions[3 * g.node(nx / 2, nz / 2) + 1]), reference: R * (1 - Math.cos(a))};
});
const fabricSquare = () => memo('cloth/fabric-square', async () => {
  const {Cloth, clothGrid} = await clothSrc(), a = 2, n = 24, e0 = 2e-3, q = 50, E = 600e3, nu = 0.3;
  const g = clothGrid({nx: n, ny: n, u: [a, 0, 0], v: [0, 0, a], origin: [0, 0, 0], diagonal: 'alternate'});
  const rest = Float64Array.from(g.positions, (v, i) => i % 3 === 1 ? v : (v - a / 2) * (1 - e0) + a / 2);
  const pinned = []; for (let i = 0; i <= n; i++) pinned.push(g.node(i, 0), g.node(i, n), g.node(0, i), g.node(n, i));
  const cloth = new Cloth({positions: g.positions, restPositions: rest, triangles: g.triangles, pinned: [...new Set(pinned)],
    material: {arealDensity: 1, youngModulus: E, thickness: 1, poissonRatio: nu, bending: 'none'}, config: {dt: 1, gravity: [0, 0, 0]}});
  const h = a / n; for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) cloth.setNodalForce(g.node(i, j), [0, -q * h * h, 0]);
  cloth.solveStatic();
  const e = 1 / (1 - e0) - 1, T = E * (e + 0.5 * e * e) / (1 - nu);
  let w = 0; for (let m = 1; m < 200; m += 2) for (let k = 1; k < 200; k += 2) w += 16 * q / (Math.PI ** 2 * m * k * T * ((m * Math.PI / a) ** 2 + (k * Math.PI / a) ** 2)) * Math.sin(m * Math.PI / 2) * Math.sin(k * Math.PI / 2);
  return {centre: -cloth.positions[3 * g.node(n / 2, n / 2) + 1], series: w, reaction: cloth.totalReaction()[1], load: q * h * h * (n - 1) ** 2};
});
const fabricTear = () => memo('cloth/fabric-tear', async () => {
  const {Cloth, clothGrid} = await clothSrc(), W = 0.2, L = 0.6, nx = 24, nz = 16, strength = 120e3;
  const g = clothGrid({nx, ny: nz, u: [L, 0, 0], v: [0, 0, W], origin: [0, 0, 0], diagonal: 'alternate'});
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabricOf([1, 0, 0], {strength: {warp: strength, weft: strength}}), config: {dt: 0.01, gravity: [0, 0, 0], drag: 20}});
  for (let j = 0; j <= nz; j++) cloth.pin(g.node(0, j));
  for (let s = 1; s <= 200; s++) {
    const T = strength * s / 160;
    for (let j = 0; j <= nz; j++) cloth.setNodalForce(g.node(nx, j), [T * W / nz * (j === 0 || j === nz ? 0.5 : 1), 0, 0]);
    cloth.step(); if (cloth.tornCount > 0) return T / strength;
  }
  return Infinity;
});
const E45 = 1 / ((1 / FAB.warp + 1 / FAB.weft + 1 / FAB.shear - 2 * FAB.poissonRatio / FAB.warp) / 4);
const FABRIC_CASES = [
  {id: 'cloth.fabric.warp', title: 'Woven fabric: strain of a strip pulled along the warp', quantity: 'strain of the middle third of a 1 m x 0.2 m strip at 1 kN/m, orthotropic membrane', unit: '1', test: FT.uniaxial, file: FABRIC_FILE,
    reference: {formula: 'eps = T / E_warp', value: 1000 / FAB.warp}, tolerance: relative(0.002), note: 'The Green strain against the engineering strain at 1e-3.', measure: () => fabricStrip('1,0,0')},
  {id: 'cloth.fabric.weft', title: 'Woven fabric: strain of a strip pulled along the weft', quantity: 'the same strip with the warp across it', unit: '1', test: FT.uniaxial, file: FABRIC_FILE,
    reference: {formula: 'eps = T / E_weft', value: 1000 / FAB.weft}, tolerance: relative(0.002), measure: () => fabricStrip('0,0,1')},
  {id: 'cloth.fabric.bias', title: 'Woven fabric: strain of a strip pulled at 45 degrees to the yarns', quantity: 'the same strip with the warp at 45 degrees', unit: '1', test: FT.uniaxial, file: FABRIC_FILE,
    reference: {formula: '1 / E_45 = (1 / E1 + 1 / E2 + 1 / G12 - 2 nu12 / E1) / 4', value: 1000 / E45}, tolerance: relative(0.02), note: 'The clamped end restrains the shear-extension coupling of the bias strip; the middle third is 1.5% stiff.', measure: () => fabricStrip('1,0,1')},
  {id: 'cloth.fabric.pressure-arc', title: 'Woven fabric: long strip under pressure', quantity: 'mid-span rise of a 1 m strip, 6 m long, pinned on its edges, 2 kPa, weft across the span', unit: 'm', test: FT.arc, file: FABRIC_FILE,
    reference: {formula: 'circular arc, T = p R = Q22 eps, 2 R asin(S / 2R) = S (1 + eps)', value: null}, tolerance: relative(0.01), measure: fabricArc},
  {id: 'cloth.membrane.pretensioned-square', title: 'Pretensioned square membrane under uniform load: centre deflection', quantity: '2 m square, 0.2% isotropic prestrain, 50 Pa', unit: 'm', test: FT.square, file: FABRIC_FILE,
    reference: {formula: 'w = sum 16 q / (pi^2 m n T ((m pi / a)^2 + (n pi / a)^2)) sin sin', value: null}, tolerance: relative(0.03), note: 'The load is on interior nodes only and the deflection stiffens the sheet a little: 2% low.',
    measure: async () => { const r = await fabricSquare(); return {value: r.centre, reference: r.series}; }},
  {id: 'cloth.membrane.reactions', title: 'Pretensioned square membrane: support reactions', quantity: 'sum of the vertical reactions of the held edges', unit: 'N', test: FT.square, file: FABRIC_FILE,
    reference: {formula: 'sum R = applied load', value: null}, tolerance: relative(1e-6), measure: async () => { const r = await fabricSquare(); return {value: r.reaction, reference: r.load}; }},
  {id: 'cloth.fabric.tear-onset', title: 'Tearing: load at which an intact strip starts to tear', quantity: 'end load / (strength x width) at the first torn triangle, 0.6% load steps', unit: '1', test: FT.tear, file: FABRIC_FILE,
    reference: {formula: 'T = strength', value: 1}, tolerance: upper(0.12), note: 'The criterion reads the second Piola-Kirchhoff resultant at 10% strain; the nominal end load is up to 1.1 times it.', measure: fabricTear},
];

export default defineCases('cloth', FILE, [
  {id: 'cloth.patch.position', title: 'Membrane patch test on an irregular mesh', quantity: 'largest distance of an interior node from the uniform deformation given to the boundary (49 nodes jittered by 30% of a cell)', unit: 'm', test: T.patch,
    reference: {formula: 'x = F X for every node', value: 0}, tolerance: upper(1e-12), note: 'Constant-strain triangles hold a uniform deformation exactly; what is left is rounding.',
    measure: async () => (await run('patch', (S, K) => S.patch(K))).worst},
  {id: 'cloth.uniaxial.modulus', title: 'Uniaxial tension: stress over strain', quantity: 'traction / axial strain of a free strip pulled at 10 N/m (E = 1e7 Pa, t = 1 mm, nu = 0.3)', unit: 'Pa', test: T.uniaxial,
    reference: {formula: 'sigma = E eps', value: 1e7}, tolerance: relative(2e-3), note: 'The law is St. Venant-Kirchhoff, linear in the Green strain: at a strain of 1e-3 it reads 1.5e-3 high against Hooke.',
    measure: async () => (await uniaxial()).modulus},
  {id: 'cloth.uniaxial.poisson', title: 'Uniaxial tension: lateral contraction', quantity: 'minus lateral strain over axial strain of the same strip', unit: '1', test: T.uniaxial,
    reference: {formula: 'eps_lateral = -nu eps', value: 0.3}, tolerance: absolute(1e-3), measure: async () => (await uniaxial()).poisson},
  {id: 'cloth.uniaxial.exact', title: 'Uniaxial tension: stretch against the exact law', quantity: 'axial strain against the stretch l of l Y (l^2 - 1) / 2 = T', unit: '1', test: T.uniaxial,
    reference: {formula: 'l Y (l^2 - 1) / 2 = T, strain = l - 1', value: null}, tolerance: relative(1e-8), note: 'The state is uniform, so only the solve tolerance is left.',
    measure: async () => { const r = await uniaxial(); return {value: r.axial, reference: r.exactAxial}; }},
  {id: 'cloth.hanging.elongation', title: 'Strip hanging under its own weight', quantity: 'elongation of a 1 m strip (0.5 kg/m^2, E t = 1e4 N/m, nu = 0), 16 elements', unit: 'm', test: T.hanging,
    reference: {formula: 'dL = rho g L^2 / (2 E t)', value: 0.5 * 9.81 / (2 * 1e4)}, tolerance: relative(1e-3), note: 'Lumped weights are exact at the nodes of a bar; the shortfall is the law (the top strain, 4.9e-4).',
    measure: async () => (await hanging()).elongation},
  {id: 'cloth.hanging.reaction', title: 'Strip hanging under its own weight: support reaction', quantity: 'sum of the reactions on the pinned edge', unit: 'N', test: T.hanging,
    reference: {formula: 'R = rho A g', value: null}, tolerance: relative(1e-8), measure: async () => { const r = await hanging(); return {value: r.reaction, reference: r.weight}; }},
  {id: 'cloth.catenary.sag', title: 'Stiff strip pinned at both ends: sag', quantity: 'midspan sag of a 1.2 m strip over a 1 m span (E t = 1e6 N/m), 32 elements', unit: 'm', test: T.catenary,
    reference: {formula: 'inextensible catenary: s = a (cosh(span / 2a) - 1), 2 a sinh(span / 2a) = L', value: null}, tolerance: relative(8e-4), note: 'A chain of straight links with lumped weights against the smooth curve.',
    measure: async () => { const r = await catenary(32); return {value: r.sag, reference: r.reference}; }},
  {id: 'cloth.catenary.order', title: 'Stiff strip pinned at both ends: observed order', quantity: 'convergence order of the sag error from 16 to 32 elements', unit: '1', test: T.catenary,
    reference: {formula: 'log2(e_16 / e_32) = 2', value: 2}, tolerance: lower(0.2),
    measure: async () => { const a = await catenary(16), b = await catenary(32); return order(error(a.sag, a.reference), error(b.sag, b.reference)); }},
  {id: 'cloth.cantilever.tip', title: 'Cantilevered strip under gravity: tip deflection', quantity: 'tip deflection of a 0.2 m strip (D = 0.1667 N m, nu = 0), 32 elements along it, regular mesh', unit: 'm', test: T.cantilever,
    reference: {formula: 'w = rho g L^4 / (8 D)', value: null}, tolerance: relative(1.2e-3), note: 'Small deflection (1.5% of the length). The clamp is a row of held triangles, counted as a mirror image.',
    measure: async () => { const r = await cantilever(32); return {value: r.tip, reference: r.plate}; }},
  {id: 'cloth.cantilever.order', title: 'Cantilevered strip: observed order on regular meshes', quantity: 'convergence order of the tip error from 16 to 32 elements', unit: '1', test: T.cantilever,
    reference: {formula: 'log2(e_16 / e_32) = 2', value: 2}, tolerance: lower(0.2),
    measure: async () => { const a = await cantilever(16), b = await cantilever(32); return order(error(a.tip, a.plate), error(b.tip, b.plate)); }},
  {id: 'cloth.cantilever.irregular', title: 'Cantilevered strip on an irregular mesh', quantity: 'tip deflection with interior nodes jittered by 25% of a cell, 16 elements', unit: 'm', test: T.cantilever,
    reference: {formula: 'w = rho g L^4 / (8 D)', value: null}, tolerance: relative(0.06),
    note: 'A bound on what was measured, not accuracy: the triangle-averaged curvature is not consistent on irregular meshes and this error does not shrink with refinement (11% at 32 elements).',
    measure: async () => { const r = await cantilever(16, {jitter: 0.25}); return {value: r.tip, reference: r.plate}; }},
  {id: 'cloth.strip.frequency', title: 'Pre-tensioned strip: first transverse frequency', quantity: 'frequency of a strip stretched by 1% between pinned ends, 32 elements, midpoint rule at dt = 1/2000 s', unit: 'Hz', test: T.strip,
    reference: {formula: 'f = (1 / 2L) sqrt(T / rho)', value: null}, tolerance: relative(6e-4), note: 'Lumped masses lower it by (pi / n)^2 / 24; the time step by (omega dt)^2 / 12 = 7e-5.',
    measure: async () => { const r = await strip({n: 32}); return {value: r.frequency, reference: r.reference}; }},
  {id: 'cloth.strip.order', title: 'Pre-tensioned strip: observed order', quantity: 'convergence order of the frequency error from 8 to 16 elements', unit: '1', test: T.strip,
    reference: {formula: 'log2(e_8 / e_16) = 2', value: 2}, tolerance: lower(0.2),
    measure: async () => { const a = await strip({n: 8}), b = await strip({n: 16}); return order(error(a.frequency, a.reference), error(b.frequency, b.reference)); }},
  {id: 'cloth.membrane.deflection', title: 'Pre-tensioned square membrane under pressure', quantity: 'centre deflection, 32 cells per side (deflection 1e-3 of the side)', unit: 'm', test: T.membrane,
    reference: {formula: 'w0 = 0.07367 p a^2 / T (Fourier series of T lap(w) = -p)', value: null}, tolerance: relative(1.4e-3), note: 'The membrane also stiffens with deflection, by 1e-4 of the tension here.',
    measure: async () => { const r = await membrane(32); return {value: r.deflection, reference: r.reference}; }},
  {id: 'cloth.membrane.order', title: 'Pre-tensioned square membrane: observed order', quantity: 'convergence order of the deflection error from 8 to 16 cells per side', unit: '1', test: T.membrane,
    reference: {formula: 'log2(e_8 / e_16) = 2', value: 2}, tolerance: lower(0.3),
    measure: async () => { const a = await membrane(8), b = await membrane(16); return order(error(a.deflection, a.reference), error(b.deflection, b.reference)); }},
  {id: 'cloth.energy.backward-euler', title: 'Backward Euler: energy left in a mode', quantity: 'energy of the strip mode after 0.5 s over its start, dt = 1/1000 s', unit: '1', test: T.energy,
    reference: {formula: '(1 + (omega dt)^2)^-steps', value: null}, tolerance: relative(2e-3), note: 'The numerical damping of the default integrator, omega^2 dt per second. It never adds energy.',
    measure: async () => { const r = await strip({integrator: 'backward-euler', dt: 1 / 1000}); return {value: r.end / r.start, reference: r.expectedDecay}; }},
  {id: 'cloth.energy.midpoint', title: 'Midpoint rule: energy drift', quantity: 'largest change of the mode energy over 250 steps at dt = 1/500 s, over that energy', unit: '1', test: T.energy,
    reference: {formula: 'dE = 0 for a quadratic energy', value: 0}, tolerance: upper(1e-6),
    measure: async () => { const r = await strip({integrator: 'midpoint', dt: 1 / 500}); return r.worstDrift / r.start; }},
  {id: 'cloth.friction.slide', title: 'Cloth patch sliding on a 30 degree ramp', quantity: 'speed down the ramp after 0.5 s, mu = 0.3', unit: 'm/s', test: T.friction,
    reference: {formula: 'v = g (sin(theta) - mu cos(theta)) t', value: 9.81 * (Math.sin(Math.PI / 6) - 0.3 * Math.cos(Math.PI / 6)) * 0.5}, tolerance: relative(1e-6),
    measure: async () => (await incline(30, 0.3, 0.5)).speed},
  {id: 'cloth.friction.stick', title: 'Cloth patch on a ramp below the friction angle', quantity: 'speed after 1 s at 26 degrees with mu = 0.5 (tan = 0.488)', unit: 'm/s', test: T.friction,
    reference: {formula: 'v = 0 while tan(theta) < mu', value: 0}, tolerance: absolute(1e-9), measure: async () => (await incline(26, 0.5, 1)).speed},
  {id: 'cloth.friction.threshold', title: 'Cloth patch just above the friction angle', quantity: 'speed after 1 s at 27 degrees with mu = 0.5 (tan = 0.510)', unit: 'm/s', test: T.friction,
    reference: {formula: 'v = g (sin(theta) - mu cos(theta)) t', value: 9.81 * (Math.sin(27 * Math.PI / 180) - 0.5 * Math.cos(27 * Math.PI / 180))}, tolerance: relative(1e-5),
    note: 'The acceleration is the difference of two forces fifty times larger.', measure: async () => (await incline(27, 0.5, 1)).speed},
  {id: 'cloth.tunnelling.plate', title: 'Thin kinematic plate through a cloth at 200 m/s', quantity: 'nodes left behind a 2 mm plate that travels 0.83 m in one step of 1/240 s', unit: 'nodes', test: T.sweep,
    reference: {formula: 'no node passes the plate', value: 0}, tolerance: upper(0), note: 'Nodes against flat faces only. A curved body is safe while it moves less than about its radius per step; body corners between nodes are not seen.',
    measure: async () => (await run('sweep/200', (S, K) => S.sweep(K, 200))).behind},
  {id: 'cloth.trampoline.momentum', title: 'Ball bouncing on a pinned cloth: momentum', quantity: 'momentum change of ball + cloth less the impulse of gravity and the supports over 1.25 s, over the momentum exchanged', unit: '1', test: T.trampoline,
    reference: {formula: 'dp = sum of (R - W) dt', value: 0}, tolerance: absolute(1e-5), note: 'The cloth side is exact in float64; the ball has float32 velocities.',
    measure: async () => { const r = await trampoline(); return (r.momentumChange - r.impulse) / r.exchanged; }},
  {id: 'cloth.trampoline.reaction', title: 'Ball at rest on a pinned cloth: support reactions', quantity: 'sum of the edge reactions with a 2.69 kg ball resting on a 0.3 kg cloth, quarter-second mean', unit: 'N', test: T.trampoline,
    reference: {formula: 'R = (m_ball + m_cloth) g', value: null}, tolerance: relative(1e-4), note: 'The ball still creeps at 4e-5 m/s when it is read.',
    measure: async () => { const r = await trampoline(); return {value: r.reaction, reference: r.weight}; }},
  {id: 'cloth.trampoline.depth', title: 'Ball at rest on a pinned cloth: height against statics', quantity: 'height of the ball centre (the cloth sags 97 mm under it), time-stepped to rest', unit: 'm', test: T.trampoline,
    reference: {formula: 'static solve of the same cloth with the ball as an unknown', value: null}, tolerance: absolute(5e-6), note: 'The reference is the same model solved another way: it checks the coupled time stepping, not the model.',
    measure: async () => { const r = await trampoline(); return {value: r.height, reference: r.staticHeight}; }},
  {id: 'cloth.scale.reading', title: 'Cloth draped over a box on a spring scale', quantity: 'extra load read from the extra sag of the spring joint under the box (0.81 kg cloth overhanging a 14.4 kg box)', unit: 'N', test: T.scale,
    reference: {formula: 'dF = m_cloth g', value: null}, tolerance: relative(1e-4), note: 'The 1.55 mm sag is a float32 position of the rigid world.',
    measure: async () => { const r = await run('scale', (S, K) => S.scale(K)); return {value: r.reading, reference: r.weight}; }},
  {id: 'cloth.attachment.stretch', title: 'Box hanging from a strip', quantity: 'stretch of a 1 m strip (E t = 1e5 N/m, 0.2 m wide) carrying a 4 kg box attached along its lower edge', unit: 'm', test: T.hangingBody,
    reference: {formula: 'dL = m g L / (E t w) + rho g L^2 / (2 E t)', value: null}, tolerance: relative(4e-3), note: 'The 0.3% is the law at a strain of 2e-3; against the exact law the test allows 2.5e-7 m (float32 of the body position).',
    measure: async () => { const r = await hangingBody(); return {value: r.stretch, reference: r.linear}; }},
  {id: 'cloth.attachment.light-body', title: 'Light body on a stiff strip: bounded', quantity: 'fastest speed in 1 s of a 40 g box released on a strip with k dt^2 / m = 868, over the physical bound g dt / sqrt(k dt^2 / m)', unit: '1', test: T.light,
    reference: {formula: 'v <= g / omega', value: 1}, tolerance: upper(0.3), note: 'The naive staggered scheme overflows float32 in the same set-up (from a ratio of about 3).',
    measure: async () => { const r = await hangingBody({youngModulus: 868 / 8.68e-8, density: 20, probe: true}); return r.fastest / (9.81 / 240 / Math.sqrt(r.stiffnessRatio)); }},
  {id: 'cloth.self.stack', title: 'Three sheets stacked on a plane: support force', quantity: 'force on the plane under three separate 0.3 m sheets resting on each other by self-collision', unit: 'N', test: T.stack,
    reference: {formula: 'F = sum of the weights', value: null}, tolerance: relative(1e-6), measure: async () => { const r = await stack(); return {value: -r.support, reference: -r.weight}; }},
  {id: 'cloth.self.stack-gap', title: 'Three sheets stacked on a plane: spacing', quantity: 'smallest node-to-triangle distance between sheets, in collision thicknesses (4 mm)', unit: '1', test: T.stack,
    reference: {formula: 'gap = thickness - force / stiffness', value: 1}, tolerance: lower(0.01), measure: async () => (await stack()).nearest},
  {id: 'cloth.self.fold', title: 'Folded strip pressed by a box: layers stay apart', quantity: 'smallest distance between the two layers during the drop of a 0.34 kg box, in collision thicknesses', unit: '1', test: T.fold,
    reference: {formula: 'gap >= thickness - force per pair / stiffness', value: 1}, tolerance: lower(0.05), note: 'Sampled every sixth step. Without self-collision the same box presses the layers through each other.',
    measure: async () => (await fold()).nearest},
  {id: 'cloth.self.fold-support', title: 'Folded strip pressed by a box: support force', quantity: 'force on the plane under the fold and the box', unit: 'N', test: T.fold,
    reference: {formula: 'F = (m_box + m_cloth) g', value: null}, tolerance: relative(1e-4), measure: async () => { const r = await fold(); return {value: r.support, reference: r.weight}; }},
  {id: 'cloth.determinism.repeat', title: 'Repeatability of a coupled run', quantity: 'runs of 150 coupled steps (contact, friction, attachment, self-collision) whose final bits differ from the first, of two more (one through the Simulation loop)', unit: 'runs', test: T.determinism,
    reference: {formula: 'bit-identical state', value: 0}, tolerance: upper(0), note: 'One machine, one build. The cloth is float64 JavaScript; the rigid world is the WASM.',
    measure: async () => { const {S, K} = await modules(), a = await S.fingerprint(K), b = await S.fingerprint(K), c = await S.fingerprint(K, {simulation: true}); return (a.hash !== b.hash) + (a.hash !== c.hash); }},
  ...FABRIC_CASES,
]);
