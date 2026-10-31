import {
  createWaterReference, snapshotWaterReference, stepWaterReference,
  type WaterFields, type WaterGrid, type WaterReferenceArithmetic, type WaterStepParams,
} from '../src/soft/water-reference.js';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function throws(action: () => void, message: string): void {
  let rejected = false;
  try { action(); } catch (error) { rejected = error instanceof RangeError; }
  assert(rejected, message);
}
const names = ['eta', 'u', 'v'] as const;
const params: WaterStepParams = {
  dt: 1 / 120, gravity: 9.81, meanDepth: 1.8, drag: 0.4, invTwoDx: 0.5, invTwoDz: 0.625,
};
function seeded(grid: WaterGrid, phase: number): WaterFields {
  const count = grid.cols * grid.rows;
  const result: WaterFields = { eta: new Float32Array(count), u: new Float32Array(count), v: new Float32Array(count) };
  for (let z = 0; z < grid.rows; z++) for (let x = 0; x < grid.cols; x++) {
    const i = z * grid.cols + x;
    result.eta[i] = 0.14 * Math.sin(0.31 * x + phase) * Math.cos(0.27 * z - phase);
    result.u[i] = 0.04 * Math.cos(0.23 * x + 0.17 * z + phase);
    result.v[i] = 0.03 * Math.sin(0.19 * x - 0.29 * z + phase);
  }
  return result;
}
function fieldsEqual(actual: WaterFields, expected: WaterFields, tolerance = 0): void {
  for (const name of names) {
    assert(actual[name].length === expected[name].length, name + ' length mismatch');
    for (let i = 0; i < actual[name].length; i++) {
      assert(Number.isFinite(actual[name][i]), name + '[' + i + '] is not finite');
      assert(Math.abs(actual[name][i] - expected[name][i]) <= tolerance, name + '[' + i + '] differs');
    }
  }
}
function transpose(fields: WaterFields, grid: WaterGrid): WaterFields {
  const result: WaterFields = {
    eta: new Float32Array(grid.cols * grid.rows),
    u: new Float32Array(grid.cols * grid.rows),
    v: new Float32Array(grid.cols * grid.rows),
  };
  for (let z = 0; z < grid.rows; z++) for (let x = 0; x < grid.cols; x++) {
    const source = z * grid.cols + x; const target = x * grid.rows + z;
    result.eta[target] = fields.eta[source];
    result.u[target] = fields.v[source];
    result.v[target] = fields.u[source];
  }
  return result;
}

function restState(): void {
  const grid = { cols: 19, rows: 11 };
  for (const arithmetic of ['javascript', 'f32'] as const) {
    const state = createWaterReference(grid);
    for (let step = 0; step < 128; step++) stepWaterReference(state,
      { ...params, dt: step % 2 ? 1 / 120 : 1 / 90 }, arithmetic);
    for (const bank of [state.current, state.destination]) for (const name of names) {
      assert(bank[name].every(value => value === 0), 'Rest water must remain at rest.');
    }
    assert(state.steps === 128, 'Encoded reference step count differs.');
  }
}

function boundaryHistoryFlux(): void {
  const grid = { cols: 3, rows: 3 };
  const history = createWaterReference(grid).current;
  history.u[3] = 1;
  const withHistory = createWaterReference(grid, undefined, history);
  const withoutHistory = createWaterReference(grid);
  const fluxParams = { dt: 0.1, gravity: 0, meanDepth: 1, drag: 0, invTwoDx: 0.5, invTwoDz: 0.5 };
  stepWaterReference(withHistory, fluxParams);
  stepWaterReference(withoutHistory, fluxParams);
  assert(withHistory.current.eta[4] === Math.fround(0.05), 'Retained left-boundary flux must add 0.05 to the center.');
  assert(withoutHistory.current.eta[4] === 0, 'Zero boundary history must leave the center unchanged.');
  assert(history.u[3] === 1, 'Initialization must not alias or mutate supplied history.');
}

function checkpointResume(): void {
  const grid = { cols: 7, rows: 5 };
  for (const arithmetic of ['javascript', 'f32'] as WaterReferenceArithmetic[]) {
    const continuous = createWaterReference(grid, seeded(grid, 0.3), seeded(grid, 1.1));
    for (let step = 0; step < 19; step++) stepWaterReference(continuous, params, arithmetic);
    const checkpoint = snapshotWaterReference(continuous);
    const frozen = createWaterReference(grid, checkpoint.current, checkpoint.destination);
    const resumed = createWaterReference(grid, checkpoint.current, checkpoint.destination);
    resumed.steps = checkpoint.steps;
    for (let step = 0; step < 67; step++) {
      const next = { ...params, dt: step % 3 ? 1 / 120 : 1 / 100 };
      stepWaterReference(continuous, next, arithmetic);
      stepWaterReference(resumed, next, arithmetic);
    }
    fieldsEqual(continuous.current, resumed.current);
    fieldsEqual(continuous.destination, resumed.destination);
    assert(continuous.steps === resumed.steps, 'Restored step count differs.');
    fieldsEqual(checkpoint.current, frozen.current);
    fieldsEqual(checkpoint.destination, frozen.destination);
  }
}

function rejectInvalidInputs(): void {
  throws(() => createWaterReference({ cols: 2, rows: 3 }), 'A grid without an interior must be rejected.');
  throws(() => createWaterReference({ cols: 3.5, rows: 4 }), 'Fractional dimensions must be rejected.');
  throws(() => createWaterReference({ cols: 65536, rows: 65536 }), 'u32 index overflow must be rejected.');
  const grid = { cols: 3, rows: 3 };
  const invalid = createWaterReference(grid).current;
  invalid.eta[4] = Number.NaN;
  throws(() => createWaterReference(grid, invalid), 'Nonfinite initial state must be rejected.');
  throws(() => createWaterReference(grid, { ...invalid, eta: new Float32Array(8) }), 'Wrong field size must be rejected.');
  const state = createWaterReference(grid);
  const before = snapshotWaterReference(state);
  const source = state.current; const destination = state.destination;
  for (const bad of [
    { ...params, dt: Number.NaN }, { ...params, dt: Number.MIN_VALUE },
    { ...params, gravity: -1 }, { ...params, invTwoDx: 0 },
    { ...params, dt: 1e30, meanDepth: 1e30 },
  ]) {
    throws(() => stepWaterReference(state, bad), 'Invalid step parameters must be rejected.');
    assert(state.current === source && state.destination === destination && state.steps === 0,
      'Rejected parameters must not publish a new state or step.');
    fieldsEqual(state.current, before.current);
    fieldsEqual(state.destination, before.destination);
  }
}

function transposeCovariance(): void {
  const grid = { cols: 13, rows: 7 };
  const initial = seeded(grid, 0.2); const history = seeded(grid, 0.8);
  const original = createWaterReference(grid, initial, history);
  const transposed = createWaterReference({ cols: grid.rows, rows: grid.cols },
    transpose(initial, grid), transpose(history, grid));
  const swapped = { ...params, invTwoDx: params.invTwoDz, invTwoDz: params.invTwoDx };
  for (let step = 0; step < 96; step++) {
    stepWaterReference(original, params, 'f32');
    stepWaterReference(transposed, swapped, 'f32');
  }
  fieldsEqual(transposed.current, transpose(original.current, grid), 1e-5);
  fieldsEqual(transposed.destination, transpose(original.destination, grid), 1e-5);
}

for (const test of [restState, boundaryHistoryFlux, checkpointResume, rejectInvalidInputs, transposeCovariance]) test();
console.log('Water numerical reference: 5 invariant tests passed.');
