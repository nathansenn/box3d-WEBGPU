// Closed-basin linear shallow water (src/engine/closed-water.ts), against separated-variable standing waves.
// Set-ups are those of tests/engine/closed-water.test.mjs, built with its oracle (scripts/closed-water-oracle.mjs).
import {engine, oracle, memo, defineCases, absolute, upper, order} from '../lib.mjs';

const FILE = 'tests/engine/closed-water.test.mjs';
const T = {
  rest: 'closed basin preserves uniform rest, including walls, without a height clamp',
  discrete: 'closed C-grid follows independent discrete standing waves, including centered drag',
  continuum: 'continuum wave error converges at second order when space and timestep refine together',
  conservation: 'unforced closed basin conserves mass and bounded modified energy over 24000 ticks',
};
const base = {cols: 32, rows: 24, dt: 1 / 120, gravity: 9.81, meanDepth: 1.5, drag: 0, dx: 12 / 32, dz: 9 / 24};
const mode = {m: 2, n: 1, amplitude: 0.03, offset: 0.02};
const modules = () => memo('closed-water/modules', async () => ({...(await engine('closed-water')), ...(await oracle('closed-water-oracle'))}));

const rest = () => memo('closed-water/rest', async () => {
  const {createClosedWaterArrays, stepClosedWaterCpu} = await modules(), c = {...base, drag: 0.28}, eta = new Float32Array(c.cols * c.rows).fill(2), s = createClosedWaterArrays(c, {eta});
  for (let i = 0; i < 1200; i++) stepClosedWaterCpu(s, c);
  let worst = 0;
  for (let i = 0; i < eta.length; i++) worst = Math.max(worst, Math.abs(s.eta[i] - 2), Math.abs(s.u[i]), Math.abs(s.v[i]));
  return worst;
});

const discrete = drag => memo(`closed-water/discrete/${drag}`, async () => {
  const {createClosedWaterArrays, stepClosedWaterCpu, standingWave, compareFields} = await modules(), c = {...base, drag};
  const s = createClosedWaterArrays(c, {eta: Float32Array.from(standingWave(c, mode, 0).eta)});
  let worst = 0;
  for (let tick = 1; tick <= 2400; tick++) {
    stepClosedWaterCpu(s, c);
    if (tick % 240 === 0) worst = Math.max(worst, compareFields(s, standingWave(c, mode, tick, true)).maxAbsolute);
  }
  return worst;
});

const continuum = scale => memo(`closed-water/continuum/${scale}`, async () => {
  const {createClosedWaterArrays, stepClosedWaterCpu, standingWave, compareFields, waveErrorScales} = await modules();
  const c = {...base, cols: 16 * scale, rows: 12 * scale, dx: 12 / (16 * scale), dz: 9 / (12 * scale), dt: 1 / (60 * scale)};
  const s = createClosedWaterArrays(c, {eta: Float32Array.from(standingWave(c, mode, 0).eta)}), ticks = 600 * scale;
  for (let tick = 0; tick < ticks; tick++) stepClosedWaterCpu(s, c);
  return compareFields(s, standingWave(c, mode, ticks), waveErrorScales(c, mode)).normalizedRms;
});

const conservation = () => memo('closed-water/conservation', async () => {
  const {createClosedWaterArrays, stepClosedWaterCpu, integrals} = await modules(), c = {...base, cols: 17, rows: 13, dx: 0.4, dz: 0.6}, eta = new Float32Array(c.cols * c.rows);
  for (let i = 0; i < eta.length; i++) eta[i] = 0.02 + 0.005 * Math.sin(i * 1.723) + 0.004 * Math.cos(i * 0.634);
  const s = createClosedWaterArrays(c, {eta}), start = integrals(s, c, 0.02);
  let volume = 0, energy = 0, wall = 0;
  for (let tick = 1; tick <= 24000; tick++) {
    stepClosedWaterCpu(s, c);
    if (tick % 1200 !== 0) continue;
    const end = integrals(s, c, 0.02);
    volume = Math.max(volume, Math.abs(end.volume - start.volume) / start.l1Volume);
    energy = Math.max(energy, Math.abs(end.modifiedEnergyPerDensity / start.modifiedEnergyPerDensity - 1));
    wall = Math.max(wall, end.maxWall);
  }
  return {volume, energy, wall};
});

export default defineCases('closed-water', FILE, [
  {id: 'closed-water.rest', title: 'A basin at rest stays at rest', quantity: 'largest change of the level or of any face velocity after 1200 steps from a uniform 2 m offset (with drag)', unit: 'm, m/s', test: T.rest,
    reference: {formula: 'eta = const, u = v = 0', value: 0}, tolerance: absolute(0), measure: rest},
  ...[[0, 'no drag'], [0.28, 'drag 0.28 /s']].map(([drag, label]) => (
    {id: `closed-water.discrete-wave.${drag === 0 ? 'undamped' : 'damped'}`, title: `Standing wave against the exact discrete solution (${label})`, quantity: 'largest field error over 2400 steps (20 s) for mode (2, 1) on a 32 x 24 grid, amplitude 0.03 m', unit: 'm', test: T.discrete,
      reference: {formula: 'eta_n = A rho^n (cos(n theta) + b sin(n theta)) cos(k_x x) cos(k_z z)', value: 0}, tolerance: upper(5e-6), note: 'The fields are float32: the error is accumulated rounding at 0.03 m amplitude.',
      measure: () => discrete(drag)})),
  {id: 'closed-water.continuum.error', title: 'Standing wave against the continuum solution, 128 x 96 grid', quantity: 'normalised RMS error of eta, u and v after 10 s for mode (2, 1)', unit: '1', test: T.continuum,
    reference: {formula: 'eta = A cos(omega t) cos(k_x x) cos(k_z z), omega^2 = g H (k_x^2 + k_z^2)', value: 0}, tolerance: upper(0.003), measure: () => continuum(8)},
  {id: 'closed-water.continuum.order', title: 'Standing wave: observed order', quantity: 'convergence order of that error from 64 x 48 to 128 x 96 cells, with the time step halved too', unit: '1', test: T.continuum,
    reference: {formula: 'log2(e_64 / e_128) = 2', value: 2}, tolerance: absolute(0.17), note: 'The test accepts an error ratio of 3.5 to 4.5 per doubling.',
    measure: async () => order(await continuum(4), await continuum(8))},
  {id: 'closed-water.volume', title: 'Volume conservation over 24,000 steps', quantity: 'largest change of the water volume, relative to the L1 volume of the initial surface', unit: '1', test: T.conservation,
    reference: {formula: '|V(t) - V(0)| / V_L1 = 0', value: 0}, tolerance: upper(1e-4), note: 'The update conserves volume exactly in exact arithmetic; float32 storage leaves this.', measure: async () => (await conservation()).volume},
  {id: 'closed-water.energy', title: 'Modified energy over 24,000 steps', quantity: 'largest relative change of the scheme\'s modified energy for a rough random surface', unit: '1', test: T.conservation,
    reference: {formula: '|E~(t) / E~(0) - 1| = 0', value: 0}, tolerance: upper(5e-4), measure: async () => (await conservation()).energy},
  {id: 'closed-water.walls', title: 'No flow through the walls', quantity: 'largest wall-normal face velocity over the same run', unit: 'm/s', test: T.conservation,
    reference: {formula: 'u . n = 0 on the walls', value: 0}, tolerance: absolute(0), measure: async () => (await conservation()).wall},
]);
