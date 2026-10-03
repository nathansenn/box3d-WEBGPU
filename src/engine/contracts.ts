/** The runtime unifies scheduling and ownership, not the numerical models. */
export interface ModelIdentity {
  readonly id: string;
  readonly name: string;
  readonly implementation: 'javascript' | 'wasm' | 'wasm-simd' | 'webgpu-f32' | 'unknown';
  readonly calibration: 'authored-comparative' | 'uncalibrated-physical';
}

export interface EngineCapabilities {
  readonly adapter: 'studio' | 'workbench' | 'water-field' | 'particle-network' | 'frame-network';
  readonly models: readonly ModelIdentity[];
  readonly fixedDt: number;
  readonly deterministicCommands: true;
  readonly checkpoint: boolean;
  readonly worker: boolean;
  readonly gpuReadback: boolean;
  readonly snapshotOwnership: 'explicit-loan' | 'numeric-copy' | 'gpu-borrow';
}

export interface FixedTickCommand { readonly tick: number; readonly type: string }
export interface FixedTickStep<C extends FixedTickCommand> {
  /** An integer tick count. Wall-clock accumulation belongs to the caller. */
  readonly ticks: number;
  /** Applied in array order, immediately before the named tick (first tick = 1). */
  readonly commands?: readonly C[];
}
export interface EngineRuntime<Request, Result> {
  readonly capabilities: EngineCapabilities;
  readonly tick: number;
  step(request: Request): Result;
  inspect(): Result;
  destroy(): void;
}

export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'EngineError'; this.code = code; }
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new EngineError('INVALID_PAYLOAD', `${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

export function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) {
    throw new EngineError('INVALID_PAYLOAD', `${label}.${key} is not supported.`);
  }
}

export function finite(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new EngineError('INVALID_PAYLOAD', `${label} must be finite and within [${min}, ${max}].`);
  }
  return value;
}

export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, label, min, max);
  if (!Number.isSafeInteger(n)) throw new EngineError('INVALID_PAYLOAD', `${label} must be an integer.`);
  return n;
}

/** Validate the entire batch before applying even its first command. */
export function validateTickBatch<C extends FixedTickCommand>(
  tick: number, ticksValue: unknown, commandsValue: unknown, validateCommand: (value: unknown) => C,
): { ticks: number; commands: C[] } {
  const ticks = integer(ticksValue, 'ticks', 0, 120);
  if (tick > Number.MAX_SAFE_INTEGER - ticks) throw new EngineError('INVALID_PAYLOAD', 'Tick limit exceeded.');
  const values = commandsValue === undefined ? [] : commandsValue;
  if (!Array.isArray(values) || values.length > 64) throw new EngineError('INVALID_PAYLOAD', 'At most 64 commands per batch are supported.');
  let previous = tick;
  const commands = values.map(value => {
    const command = validateCommand(value);
    if (command.tick < previous || command.tick <= tick || command.tick > tick + ticks) {
      throw new EngineError('INVALID_PAYLOAD', 'Commands must be ordered and address a tick in this batch.');
    }
    previous = command.tick;
    return command;
  });
  return { ticks, commands };
}
