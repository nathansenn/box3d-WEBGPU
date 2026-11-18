// Axial cables (src/engine/compliant-cable.ts): the XPBD backend and the proximal nonlinear backend.
// Set-ups are those of tests/engine/compliant-cable.test.mjs and tests/engine/proximal-cable.test.mjs,
// the latter built with its oracle helpers (scripts/cable-proximal-oracle.mjs).
import {engine, oracle, memo, defineCases, absolute, upper, order} from '../lib.mjs';

const XPBD = 'tests/engine/compliant-cable.test.mjs', PROXIMAL = 'tests/engine/proximal-cable.test.mjs';
const T = {
  spring: 'taut one-link motion matches an independent implicit spring solve across timestep, drag and iteration settings',
  oscillator: 'continuum oscillator error converges with the actual substep, not solver iteration count',
  hanging: 'distributed hanging mass preserves mesh-independent extension, total mass and support reaction',
  curved: 'curved motion agrees with an independent nonlinear scalar solve, including hard constraints',
  span: 'curved spans match force-polygon shooting and converge toward the extensible catenary',
};
const core = () => engine('compliant-cable');
const base = {dt: 1 / 120, substeps: 1, maxIterations: 16, residualTolerance: 1e-12, drag: 0, gravity: [0, -9.81, 0]};
const spring = (overrides = {}) => ({config: {...base, ...overrides}, positions: [0, 0, 0, 0, -1.4, 0], masses: [1, 2], pinned: [1, 0], constraints: [{a: 0, b: 1, restLength: 1, compliance: 1 / 60}]});
function advance(r, ticks, chunk = 120) { let s; while (ticks) { const n = Math.min(ticks, chunk); s = r.step({ticks: n}); ticks -= n; } return s; }

const oneLink = () => memo('cable/one-link', async () => {
  const {CompliantCableRuntime} = await core(), dt = 1 / 120;
  const r = new CompliantCableRuntime(spring({dt}));
  // Independent solve of m (v' - v) / h = m g - k e', e' = e + h v' (k / m = 30 1/s^2).
  let extension = 0.4, velocity = 0;
  for (let n = 0; n < Math.round(2 / dt); n++) { velocity = (velocity + dt * (9.81 - 30 * extension)) / (1 + 30 * dt * dt); extension += dt * velocity; }
  const s = advance(r, Math.round(2 / dt)), out = {extension: -s.positions[4] - 1, expected: extension, tension: s.tensions[0], expectedTension: 60 * extension};
  r.destroy(); return out;
});

const oscillatorError = dt => memo(`cable/oscillator/${dt}`, async () => {
  const {CompliantCableRuntime} = await core(), omega = Math.sqrt(30), amplitude = 0.4 - 2 * 9.81 / 60;
  const r = new CompliantCableRuntime(spring({dt})), s = advance(r, Math.round(1 / dt));
  const q = -s.positions[4] - 1 - 2 * 9.81 / 60, v = -s.velocities[4];
  r.destroy(); return Math.hypot(q / amplitude - Math.cos(omega), v / (amplitude * omega) + Math.sin(omega));
});

const hanging = () => memo('cable/hanging', async () => {
  const {CompliantCableRuntime, hangingCableDefinition} = await core(), segments = 4;
  const config = {...base, dt: 1 / 60, substeps: 8, maxIterations: 256, residualTolerance: 1e-9, drag: 4};
  const r = new CompliantCableRuntime(hangingCableDefinition({segments, length: 2, linearDensity: 0.25, tipMass: 1, axialRigidity: 1000, config}));
  const s = advance(r, 1200), out = {extension: -s.positions.at(-2) - 2, reaction: s.supportReactions[1], tension: s.tensions[0]};
  r.destroy(); return out;
});

const curved = () => memo('cable/curved', async () => {
  const {CompliantCableRuntime} = await core(), {symmetricDefinition, symmetricTrajectory} = await oracle('cable-proximal-oracle');
  const dt = 1 / 120, d = symmetricDefinition({dt}), ticks = Math.round(1 / dt), reference = symmetricTrajectory(d, ticks), r = new CompliantCableRuntime(d);
  let worst = 0;
  for (let tick = 1; tick <= ticks; tick++) { const s = r.step({ticks: 1}); worst = Math.max(worst, Math.abs(-s.positions[4] - reference[tick].y)); }
  r.destroy(); return worst;
});

const span = segments => memo(`cable/span/${segments}`, async () => {
  const cable = await core(), {spanDefinition, discreteSpanReference, continuumSpanReference} = await oracle('cable-proximal-oracle'), rigidity = 1000;
  const d = spanDefinition(cable, {segments, rigidity, substeps: 16}), expected = discreteSpanReference(d), r = new cable.CompliantCableRuntime(d), s = advance(r, 1200, 60);
  let position = 0, tension = 0;
  for (let j = 0; j < s.positions.length; j++) position = Math.max(position, Math.abs(s.positions[j] - expected.positions[j]));
  for (let j = 0; j < s.tensions.length; j++) tension = Math.max(tension, Math.abs(s.tensions[j] - expected.tensions[j]));
  const out = {sag: -s.positions[3 * segments / 2 + 1], continuum: continuumSpanReference(rigidity).sag, position, tension, horizontal: -s.supportReactions[0], expectedHorizontal: expected.horizontal};
  r.destroy(); return out;
});

export default [
  ...defineCases('cable', XPBD, [
    {id: 'cable.spring.extension', title: 'One taut link: extension after 2 s', quantity: 'extension of a 60 N/m link carrying 2 kg, released 0.4 m stretched (XPBD backend, dt = 1/120 s)', unit: 'm', test: T.spring,
      reference: {formula: 'backward-Euler recurrence of m e\'\' = m g - k e', value: null}, tolerance: absolute(2e-11), note: 'The reference is the same implicit step solved independently as a scalar recurrence, so this checks the solve, not the time accuracy.',
      measure: async () => { const r = await oneLink(); return {value: r.extension, reference: r.expected}; }},
    {id: 'cable.spring.tension', title: 'One taut link: tension', quantity: 'tension of the same link after 2 s', unit: 'N', test: T.spring,
      reference: {formula: 'T = k e', value: null}, tolerance: absolute(2e-8),
      measure: async () => { const r = await oneLink(); return {value: r.tension, reference: r.expectedTension}; }},
    {id: 'cable.oscillator.order', title: 'Axial oscillator: observed order in the step', quantity: 'convergence order of the phase-space error after 1 s, from dt = 1/480 to 1/960 s', unit: '1', test: T.oscillator,
      reference: {formula: 'log2(e_480 / e_960) = 1 (implicit Euler)', value: 1}, tolerance: absolute(0.13), note: 'The test accepts an error ratio of 1.8 to 2.2 per halving. The cable step is first order and numerically damped.',
      measure: async () => order(await oscillatorError(1 / 480), await oscillatorError(1 / 960))},
    {id: 'cable.hanging.extension', title: 'Hanging cable with a tip mass: extension', quantity: 'tip extension of a 2 m cable (0.25 kg/m, EA = 1000 N, 4 segments) carrying 1 kg', unit: 'm', test: T.hanging,
      reference: {formula: 'dL = g (m L + rho L^2 / 2) / (E A)', value: 9.81 / 1000 * (2 + 0.25 * 2)}, tolerance: absolute(2e-7), note: 'The lumped cable reproduces the continuum stretch on any mesh.',
      measure: async () => (await hanging()).extension},
    {id: 'cable.hanging.reaction', title: 'Hanging cable with a tip mass: support reaction', quantity: 'vertical reaction at the anchor', unit: 'N', test: T.hanging,
      reference: {formula: 'R = (m + rho L) g', value: 1.5 * 9.81}, tolerance: absolute(2e-5), measure: async () => (await hanging()).reaction},
    {id: 'cable.hanging.tension', title: 'Hanging cable with a tip mass: top tension', quantity: 'tension in the top segment (the anchor node carries half a segment itself)', unit: 'N', test: T.hanging,
      reference: {formula: 'T = (m + rho L - rho L / (2 n)) g', value: (1 + 0.5 - 0.25 * 2 / 8) * 9.81}, tolerance: absolute(2e-5), measure: async () => (await hanging()).tension},
  ]),
  ...defineCases('cable', PROXIMAL, [
    {id: 'cable.curved.trajectory', title: 'Curved motion of a two-link cable', quantity: 'largest position error over 1 s against an independent nonlinear scalar solve (proximal backend, dt = 1/120 s)', unit: 'm', test: T.curved,
      reference: {formula: 'bisection solve of the symmetric implicit step', value: 0}, tolerance: upper(1e-8), measure: curved},
    {id: 'cable.span.shape', title: 'Suspended span: node positions', quantity: 'largest node position error of a 32-segment span with a central mass against force-polygon shooting', unit: 'm', test: T.span,
      reference: {formula: 'statics: constant horizontal tension, vertical tension steps by each nodal weight', value: 0}, tolerance: upper(2e-7), measure: async () => (await span(32)).position},
    {id: 'cable.span.tensions', title: 'Suspended span: segment tensions', quantity: 'largest segment tension error of the same span against force-polygon shooting', unit: 'N', test: T.span,
      reference: {formula: 'T_j = hypot(H, V_j)', value: 0}, tolerance: upper(2e-5), measure: async () => (await span(32)).tension},
    {id: 'cable.span.horizontal', title: 'Suspended span: horizontal reaction', quantity: 'horizontal pull at the left anchor', unit: 'N', test: T.span,
      reference: {formula: 'H from the force polygon', value: null}, tolerance: absolute(2e-5),
      measure: async () => { const r = await span(32); return {value: r.horizontal, reference: r.expectedHorizontal}; }},
    {id: 'cable.span.sag', title: 'Suspended span: sag against the extensible catenary', quantity: 'midspan sag of the 32-segment span (4.2 m cable over a 4 m gap, EA = 1000 N, 1 kg at the middle)', unit: 'm', test: T.span,
      reference: {formula: 'extensible catenary with a central point load (closed-form integrals)', value: null}, tolerance: absolute(4.8e-5),
      note: 'The test asserts the order of this error, not its size. The tolerance is the largest finest-mesh sag error docs/NONLINEAR_CABLE.md states (0.04738 mm), rounded up to 0.048 mm.',
      measure: async () => { const r = await span(32); return {value: r.sag, reference: r.continuum}; }},
    {id: 'cable.span.order', title: 'Suspended span: observed order of the sag error', quantity: 'convergence order of the sag error from 16 to 32 segments', unit: '1', test: T.span,
      reference: {formula: 'log2(e_16 / e_32) = 2', value: 2}, tolerance: absolute(0.1), note: 'The test accepts an error ratio of 3.7 to 4.3 per doubling.',
      measure: async () => { const a = await span(16), b = await span(32); return order(a.sag - a.continuum, b.sag - b.continuum); }},
  ]),
];
