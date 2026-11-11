// Linear frame finite elements (src/engine/frame-runtime.ts), against beam theory.
// Set-ups are those of tests/engine/frame.test.mjs, built with its oracle helpers (scripts/frame-oracle.mjs).
import {engine, oracle, memo, defineCases, absolute, upper, lower, order} from '../lib.mjs';

const FILE = 'tests/engine/frame.test.mjs';
const T = {
  compliance: 'cantilevers reproduce axial, two-plane bending and torsion compliance and all reactions',
  gravity: 'consistent gravity loading reproduces cantilever and simply-supported distributed deflection',
  oscillator: 'midpoint motion matches a closed-form semidiscrete oscillator and preserves energy',
  mode: 'cantilever bending motion converges toward the continuum mode under mesh refinement',
  temporal: 'axial and torsional temporal errors decrease fourfold while discrete phase remains exact',
};
// The section of scripts/frame-oracle.mjs (frameSection), repeated so the reference values need no import.
const S = {E: 2e9, G: 8e8, A: 0.002, Iy: 1e-6, Iz: 3e-6, J: 2e-6, rho: 1000}, L = 2;
const modules = () => memo('frame/modules', async () => ({...(await engine('frame-runtime')), ...(await oracle('frame-oracle'))}));

const COMPONENTS = [
  ['axial', 'Axial compliance', 'u_x = P L / (E A)', 10, P => P * L / (S.E * S.A), 'm'],
  ['bending-y', 'Bending compliance about z', 'u_y = P L^3 / (3 E I_z)', 10, P => P * L ** 3 / (3 * S.E * S.Iz), 'm'],
  ['bending-z', 'Bending compliance about y', 'u_z = P L^3 / (3 E I_y)', 10, P => P * L ** 3 / (3 * S.E * S.Iy), 'm'],
  ['torsion', 'Torsional compliance', 'phi_x = T L / (G J)', 2, P => P * L / (S.G * S.J), 'rad'],
  ['moment-y', 'End moment about y: rotation', 'phi_y = M L / (E I_y)', 2, P => P * L / (S.E * S.Iy), 'rad'],
  ['moment-z', 'End moment about z: rotation', 'phi_z = M L / (E I_z)', 2, P => P * L / (S.E * S.Iz), 'rad'],
];
const compliance = component => memo(`frame/compliance/${component}`, async () => {
  const {FrameRuntime, cantileverDefinition} = await modules(), segments = 8, P = COMPONENTS[component][3];
  const r = new FrameRuntime(cantileverDefinition({segments})), load = new Float64Array((segments + 1) * 6); load[6 * segments + component] = P;
  const s = r.solveStatic(load), out = {tip: s.displacements[6 * segments + component], reaction: s.supportReactions[component]};
  r.destroy(); return out;
});

const gravity = simplySupported => memo(`frame/gravity/${simplySupported}`, async () => {
  const {FrameRuntime, cantileverDefinition} = await modules(), segments = 8;
  const d = cantileverDefinition({segments, config: {gravity: [0, -9.81, 0]}});
  if (simplySupported) { d.fixed.fill(0); d.fixed[0] = d.fixed[1] = d.fixed[2] = d.fixed[3] = 1; d.fixed[segments * 6 + 1] = d.fixed[segments * 6 + 2] = 1; }
  const r = new FrameRuntime(d), s = r.solveStatic(), out = {tip: s.displacements[6 * segments + 1], middle: s.displacements[6 * (segments / 2) + 1], reaction: s.supportReactions[1] + s.supportReactions.at(-5)};
  r.destroy(); return out;
});
const q = -S.rho * S.A * 9.81, EI = S.E * S.Iz;

const oscillator = () => memo('frame/oscillator', async () => {
  const {FrameRuntime, cantileverDefinition} = await modules(), omega = Math.sqrt(3 * S.E / (S.rho * L * L)), period = 2 * Math.PI / omega, stepsPerPeriod = 64;
  const d = cantileverDefinition({segments: 1, config: {dt: period / stepsPerPeriod}}); d.displacements = new Float64Array(12); d.displacements[6] = 0.0001;
  const energy = s => s.diagnostics.kineticEnergy + s.diagnostics.elasticEnergy + s.diagnostics.gravitationalEnergy;
  const r = new FrameRuntime(d), initial = energy(r.inspect()), phase = 2 * Math.atan(omega * d.config.dt / 2);
  let worst = 0, drift = 0;
  for (let tick = 1; tick <= stepsPerPeriod * 20; tick++) {
    const s = r.step({ticks: 1});
    worst = Math.max(worst, Math.abs(s.displacements[6] - 0.0001 * Math.cos(phase * tick)));
    drift = Math.max(drift, Math.abs(energy(s) - initial));
  }
  r.destroy(); return {worst, drift};
});

const modeError = segments => memo(`frame/mode/${segments}`, async () => {
  const {FrameRuntime, cantileverDefinition, continuumCantileverMode, cantileverFrequency} = await modules(), omega = cantileverFrequency(L), duration = 2 * Math.PI / omega;
  const d = cantileverDefinition({segments, config: {dt: duration / 1024, maxIterations: 512, forceTolerance: 1e-7, momentTolerance: 1e-8}}); d.displacements = new Float64Array(6 * (segments + 1));
  for (let i = 1; i <= segments; i++) { const mode = continuumCantileverMode(L * i / segments, L); d.displacements[6 * i + 1] = 0.001 * mode.value; d.displacements[6 * i + 5] = 0.001 * mode.slope; }
  const r = new FrameRuntime(d); let error = 0;
  for (let tick = 1; tick <= 1024; tick++) { const s = r.step({ticks: 1}); error = Math.max(error, Math.abs(s.displacements[6 * segments + 1] / 0.001 - Math.cos(omega * tick * d.config.dt))); }
  r.destroy(); return error;
});

const temporalError = (component, steps) => memo(`frame/temporal/${component}/${steps}`, async () => {
  const {FrameRuntime, cantileverDefinition} = await modules();
  const omega = component === 0 ? Math.sqrt(3 * S.E / (S.rho * 4)) : Math.sqrt(3 * S.G * S.J / (S.rho * (S.Iy + S.Iz) * 4)), period = 2 * Math.PI / omega;
  const d = cantileverDefinition({segments: 1, config: {dt: period / steps}}); d.displacements = new Float64Array(12); d.displacements[6 + component] = 0.0001;
  const r = new FrameRuntime(d); let error = 0;
  for (let tick = 1; tick <= steps; tick++) { const s = r.step({ticks: 1}); error = Math.max(error, Math.abs(s.displacements[6 + component] / 0.0001 - Math.cos(omega * tick * d.config.dt))); }
  r.destroy(); return error;
});

export default defineCases('frame', FILE, [
  ...COMPONENTS.map(([key, title, formula, P, expected, unit], component) => (
    {id: `frame.cantilever.${key}`, title: `Cantilever: ${title.toLowerCase()}`, quantity: `tip ${unit === 'm' ? 'displacement' : 'rotation'} of a 2 m cantilever of 8 elements under an end ${component < 3 ? `force of ${P} N` : `moment of ${P} N m`}`, unit, test: T.compliance,
      reference: {formula, value: expected(P)}, tolerance: absolute(1e-10 + 1e-8 * Math.abs(expected(P))), note: 'Cubic Hermite elements are exact for end loads; the tolerance (1e-10 + 1e-8 of the value) is the solver\'s.',
      measure: async () => (await compliance(component)).tip})),
  {id: 'frame.cantilever.reaction', title: 'Cantilever: support reaction', quantity: 'vertical reaction at the clamp under a 10 N end force', unit: 'N', test: T.compliance,
    reference: {formula: 'R = -P', value: -10}, tolerance: absolute(2e-7), measure: async () => (await compliance(1)).reaction},
  {id: 'frame.gravity.cantilever', title: 'Cantilever under its own weight: tip deflection', quantity: 'tip deflection under consistent gravity loading (8 elements)', unit: 'm', test: T.gravity,
    reference: {formula: 'u = q L^4 / (8 E I)', value: q * L ** 4 / (8 * EI)}, tolerance: absolute(1e-10), measure: async () => (await gravity(false)).tip},
  {id: 'frame.gravity.simply-supported', title: 'Simply supported beam under its own weight: midspan deflection', quantity: 'midspan deflection under consistent gravity loading (8 elements)', unit: 'm', test: T.gravity,
    reference: {formula: 'u = 5 q L^4 / (384 E I)', value: 5 * q * L ** 4 / (384 * EI)}, tolerance: absolute(1e-10), measure: async () => (await gravity(true)).middle},
  {id: 'frame.gravity.reactions', title: 'Simply supported beam under its own weight: reactions', quantity: 'sum of the two support reactions', unit: 'N', test: T.gravity,
    reference: {formula: 'R_1 + R_2 = -q L', value: -q * L}, tolerance: absolute(1e-7), measure: async () => (await gravity(true)).reaction},
  {id: 'frame.oscillator.phase', title: 'Midpoint rule: axial oscillator over 20 periods', quantity: 'largest displacement error against the closed-form discrete solution, 64 steps per period, amplitude 1e-4 m', unit: 'm', test: T.oscillator,
    reference: {formula: 'u_n = a cos(2 n atan(omega dt / 2))', value: 0}, tolerance: upper(1e-11), measure: async () => (await oscillator()).worst},
  {id: 'frame.oscillator.energy', title: 'Midpoint rule: energy over 20 periods', quantity: 'largest change of kinetic + elastic energy of the same oscillator', unit: 'J', test: T.oscillator,
    reference: {formula: '|E(t) - E(0)| = 0', value: 0}, tolerance: upper(1e-11), measure: async () => (await oscillator()).drift},
  {id: 'frame.mode.error', title: 'Cantilever bending mode: error at 16 elements', quantity: 'largest tip error over one period against the continuum first mode, relative to the amplitude', unit: '1', test: T.mode,
    reference: {formula: 'u_tip(t) / a = cos(omega_1 t), omega_1 = 1.8751^2 sqrt(E I / (rho A)) / L^2', value: 0}, tolerance: upper(2e-5), measure: () => modeError(16)},
  {id: 'frame.mode.order', title: 'Cantilever bending mode: observed order in the mesh', quantity: 'convergence order of that error from 2 to 4 elements', unit: '1', test: T.mode,
    reference: {formula: 'log2(e_2 / e_4) = 4 (cubic Hermite frequency error)', value: 4}, tolerance: lower(1), note: 'The test requires the error to fall by more than 8 (order 3) from 2 to 4 elements; finer meshes meet the time-step floor.',
    measure: async () => order(await modeError(2), await modeError(4))},
  ...[[0, 'axial'], [3, 'torsional']].map(([component, name]) => (
    {id: `frame.temporal-order.${name}`, title: `Midpoint rule: ${name} temporal order`, quantity: `convergence order of the ${name} oscillation error from 128 to 256 steps per period`, unit: '1', test: T.temporal,
      reference: {formula: 'log2(e_128 / e_256) = 2', value: 2}, tolerance: absolute(0.036), note: 'The test accepts an error ratio of 3.9 to 4.1 per halving of the step.',
      measure: async () => order(await temporalError(component, 128), await temporalError(component, 256))})),
]);
