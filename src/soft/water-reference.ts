/**
 * Reference for Box3D's existing fixed-grid, linear shallow-water update.
 * Preserves destination boundary history, phase order and clipping. This is
 * not a new boundary condition, a CFL policy or a coupled particle solver.
 * `javascript` models Number arithmetic; `f32` rounds elementary operations
 * like the native kernel. GPU contraction can still require error tolerances.
 */
export interface WaterGrid { readonly cols: number; readonly rows: number; }
export interface WaterFields {
  readonly eta: Float32Array;
  readonly u: Float32Array;
  readonly v: Float32Array;
}
export interface WaterStepParams {
  readonly dt: number;
  readonly gravity: number;
  readonly meanDepth: number;
  readonly drag: number;
  readonly invTwoDx: number;
  readonly invTwoDz: number;
}
export interface WaterReferenceState extends WaterGrid {
  readonly count: number;
  current: WaterFields;
  destination: WaterFields;
  steps: number;
}
export interface WaterSnapshot {
  readonly current: WaterFields;
  /** Destination history must also be restored for a faithful restart. */
  readonly destination: WaterFields;
  readonly steps: number;
}
export type WaterReferenceArithmetic = 'javascript' | 'f32';

export function validateWaterGrid(grid: WaterGrid): number {
  if (!Number.isSafeInteger(grid.cols) || !Number.isSafeInteger(grid.rows) || grid.cols < 3 || grid.rows < 3) {
    throw new RangeError('Water requires integer cols and rows of at least 3.');
  }
  const count = grid.cols * grid.rows;
  if (!Number.isSafeInteger(count) || count > 0xffff_ffff) {
    throw new RangeError('Water grid indices exceed the u32 addressable range.');
  }
  return count;
}

export function validateWaterStepParams(params: WaterStepParams): void {
  const names = ['dt', 'gravity', 'meanDepth', 'drag', 'invTwoDx', 'invTwoDz'] as const;
  for (const name of names) {
    if (!Number.isFinite(params[name]) || !Number.isFinite(Math.fround(params[name]))) {
      throw new RangeError(`Water ${name} must be finite and representable as f32.`);
    }
  }
  if (Math.fround(params.dt) <= 0 || Math.fround(params.meanDepth) <= 0 ||
      Math.fround(params.invTwoDx) <= 0 || Math.fround(params.invTwoDz) <= 0 ||
      params.gravity < 0 || params.drag < 0) {
    throw new RangeError('Water dt, depth and inverse spacing must be positive; gravity and drag must be nonnegative.');
  }
  const f = Math.fround;
  const dt = f(params.dt);
  const pressure = f(f(params.gravity) * dt);
  const continuity = f(f(params.meanDepth) * dt);
  const coefficients = [
    f(1 - f(f(params.drag) * dt)),
    f(pressure * f(params.invTwoDx)), f(pressure * f(params.invTwoDz)),
    f(continuity * f(params.invTwoDx)), f(continuity * f(params.invTwoDz)),
  ];
  if (coefficients.some(value => !Number.isFinite(value))) throw new RangeError('Water timestep coefficients overflow f32.');
}

export function validateWaterFields(fields: WaterFields, count: number, label = 'water'): void {
  for (const name of ['eta', 'u', 'v'] as const) {
    const values = fields[name];
    if (!(values instanceof Float32Array) || values.length !== count) {
      throw new RangeError(`${label}.${name} must be a Float32Array of exactly ${count} values.`);
    }
    for (let i = 0; i < count; i++) {
      if (!Number.isFinite(values[i])) throw new RangeError(`${label}.${name}[${i}] is not finite.`);
    }
  }
}

function copyFields(fields: WaterFields | undefined, count: number, label: string): WaterFields {
  if (!fields) return { eta: new Float32Array(count), u: new Float32Array(count), v: new Float32Array(count) };
  validateWaterFields(fields, count, label);
  return { eta: fields.eta.slice(), u: fields.u.slice(), v: fields.v.slice() };
}

/** Copies both fields; omitted history reproduces a fresh production solver. */
export function createWaterReference(grid: WaterGrid, initial?: WaterFields, history?: WaterFields): WaterReferenceState {
  const count = validateWaterGrid(grid);
  return {
    cols: grid.cols, rows: grid.rows, count,
    current: copyFields(initial, count, 'initial'),
    destination: copyFields(history, count, 'history'), steps: 0,
  };
}

/** Deep copy prevents later steps from changing already collected evidence. */
export function snapshotWaterReference(state: WaterReferenceState): WaterSnapshot {
  return { current: copyFields(state.current, state.count, 'current'),
    destination: copyFields(state.destination, state.count, 'destination'), steps: state.steps };
}

/** One substep; the caller owns the physical clock and substep selection. */
export function stepWaterReference(
  state: WaterReferenceState, params: WaterStepParams, arithmetic: WaterReferenceArithmetic = 'javascript',
): void {
  validateWaterStepParams(params);
  if (arithmetic !== 'javascript' && arithmetic !== 'f32') throw new RangeError('Unknown water reference arithmetic.');
  const { cols, rows, current, destination } = state;
  const { eta, u, v } = current;
  const { eta: nextEta, u: nextU, v: nextV } = destination;
  const floatMode = arithmetic === 'f32';
  if (floatMode) {
    const f = Math.fround;
    const dt = f(params.dt);
    const decay = f(1 - f(f(params.drag) * dt));
    const pressure = f(f(params.gravity) * dt);
    const continuity = f(f(params.meanDepth) * dt);
    const px = f(pressure * f(params.invTwoDx));
    const pz = f(pressure * f(params.invTwoDz));
    const cx = f(continuity * f(params.invTwoDx));
    const cz = f(continuity * f(params.invTwoDz));
    for (let z = 1; z < rows - 1; z++) {
      const end = z * cols + cols - 1;
      for (let i = z * cols + 1; i < end; i++) {
        nextU[i] = f(f(u[i] * decay) - f(f(eta[i + 1] - eta[i - 1]) * px));
        nextV[i] = f(f(v[i] * decay) - f(f(eta[i + cols] - eta[i - cols]) * pz));
      }
    }
    for (let z = 1; z < rows - 1; z++) {
      const end = z * cols + cols - 1;
      for (let i = z * cols + 1; i < end; i++) {
        const afterX = f(eta[i] - f(f(nextU[i + 1] - nextU[i - 1]) * cx));
        const value = f(afterX - f(f(nextV[i + cols] - nextV[i - cols]) * cz));
        nextEta[i] = Math.max(f(-1.65), Math.min(f(1.65), value));
      }
    }
  } else {
    const decay = 1 - params.drag * params.dt;
    const px = params.gravity * params.dt * params.invTwoDx;
    const pz = params.gravity * params.dt * params.invTwoDz;
    const cx = params.meanDepth * params.dt * params.invTwoDx;
    const cz = params.meanDepth * params.dt * params.invTwoDz;
    for (let z = 1; z < rows - 1; z++) {
      const end = z * cols + cols - 1;
      for (let i = z * cols + 1; i < end; i++) {
        nextU[i] = u[i] * decay - (eta[i + 1] - eta[i - 1]) * px;
        nextV[i] = v[i] * decay - (eta[i + cols] - eta[i - cols]) * pz;
      }
    }
    for (let z = 1; z < rows - 1; z++) {
      const end = z * cols + cols - 1;
      for (let i = z * cols + 1; i < end; i++) {
        const value = eta[i] - (nextU[i + 1] - nextU[i - 1]) * cx - (nextV[i + cols] - nextV[i - cols]) * cz;
        nextEta[i] = value < -1.65 ? -1.65 : value > 1.65 ? 1.65 : value;
      }
    }
  }
  const heightDamping = floatMode ? Math.fround(0.92) : 0.92;
  const tangentDamping = floatMode ? Math.fround(0.78) : 0.78;
  const normalDamping = floatMode ? Math.fround(0.18) : 0.18;
  const bottomRow = (rows - 1) * cols;
  const innerBottom = (rows - 2) * cols;
  for (let x = 0; x < cols; x++) {
    nextEta[x] = nextEta[cols + x] * heightDamping;
    nextU[x] = nextU[cols + x] * tangentDamping;
    nextV[x] = -nextV[cols + x] * normalDamping;
    const bottom = bottomRow + x;
    const inner = innerBottom + x;
    nextEta[bottom] = nextEta[inner] * heightDamping;
    nextU[bottom] = nextU[inner] * tangentDamping;
    nextV[bottom] = -nextV[inner] * normalDamping;
  }
  for (let z = 0; z < rows; z++) {
    const left = z * cols;
    const right = left + cols - 1;
    nextEta[left] = nextEta[left + 1] * heightDamping;
    nextU[left] = -nextU[left + 1] * normalDamping;
    nextV[left] = nextV[left + 1] * tangentDamping;
    nextEta[right] = nextEta[right - 1] * heightDamping;
    nextU[right] = -nextU[right - 1] * normalDamping;
    nextV[right] = nextV[right - 1] * tangentDamping;
  }
  state.current = destination;
  state.destination = current;
  state.steps++;
}
