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

/**
 * The error taxonomy (docs/ERRORS.md). Every error this engine throws on purpose is an `EngineError` whose `code` is a
 * key of this table. `meaning` says what the code stands for; `fix` is what the caller does about it. A test
 * (tests/fuzz/error-taxonomy.test.mjs) fails when a code is thrown that is not listed here.
 */
export const ENGINE_ERRORS = {
  // What you passed.
  INVALID_PAYLOAD: {meaning: 'An argument, option, file or message holds a value the engine cannot use.', fix: 'Read the message: it names the field, the value it got and the values it takes. Correct the input and call again; nothing was changed.'},
  INVALID_STATE: {meaning: 'The call is valid, but not in the state the object is in now.', fix: 'Do the step the message names first (for example stop recording before reset, or step before reading results).'},
  // What the object you called still is.
  DISPOSED: {meaning: 'The world, pool, solver or runtime was destroyed, or its native handle is no longer valid.', fix: 'Create a new one; do not keep references past dispose() or destroy().'},
  STALE_BODY: {meaning: 'The body handle names a body that was destroyed, or one from before a reset.', fix: 'Check world.isAlive(body) before using a kept handle, and drop handles when you destroy or reset.'},
  STALE_JOINT: {meaning: 'The joint handle names a joint that was destroyed, or one of its bodies was.', fix: 'Check world.isJointAlive(joint) before using a kept handle.'},
  STALE_QUERY: {meaning: 'Body storage changed between validating a spatial query and running it.', fix: 'Run the query again.'},
  STALE_GENERATION: {meaning: 'A reply or command belongs to a runtime generation that was reset.', fix: 'Discard it and issue the request again against the current runtime.'},
  STALE_REQUEST: {meaning: 'A request was superseded by a newer one before it ran.', fix: 'Use the result of the newer request.'},
  STALE_SNAPSHOT: {meaning: 'A snapshot was read after the buffer it lives in was reused.', fix: 'Copy what you need from a snapshot before the next step, or request a new one.'},
  // Limits.
  WORLD_CAPACITY: {meaning: 'The world, the module or a scene is at a fixed limit (16 worlds per module, 65,536 bodies per world).', fix: 'Destroy what you no longer need, reserve capacity up front with `capacity`, or split the scene.'},
  ALLOCATION_FAILED: {meaning: 'The WebAssembly heap could not grow, or a native allocation failed.', fix: 'Free worlds you no longer use; the existing world is intact. On 32-bit WebAssembly the heap is at most 2 GiB.'},
  WORK_LIMIT: {meaning: 'A solver reached its iteration or work budget before it met its tolerance.', fix: 'Raise the budget the message names, use a smaller time step, or coarsen the model.'},
  QUERY_VERSION_EXHAUSTED: {meaning: 'A world ran more than 2^32 query batches.', fix: 'Create a new world.'},
  SEQUENCE_EXHAUSTED: {meaning: 'A shared snapshot ring used all of its sequence numbers.', fix: 'Reset the runtime with a new ring.'},
  BACKPRESSURE: {meaning: 'More work was queued than the worker accepts at once.', fix: 'Wait for earlier requests to settle before sending more.'},
  BUSY: {meaning: 'The runtime is in the middle of another request.', fix: 'Await the pending request first.'},
  // What the platform or the build can do.
  UNSUPPORTED_BACKEND: {meaning: 'This build, WASM artifact or file version does not have the feature the call needs.', fix: 'Use the artifact shipped with this version (npm run build:wasm in the repository), or the feature the message names.'},
  UNSUPPORTED_JOINT: {meaning: 'That joint type does not take that setting.', fix: 'See the joint feature table in the kit README: for example only revolute, prismatic, distance and wheel joints have motors.'},
  INVALID_BACKEND: {meaning: 'The WASM module answered with something outside its contract.', fix: 'The artifact and the JavaScript do not match: rebuild or reinstall so that both come from the same version, and report it if they already do.'},
  WASM_UNAVAILABLE: {meaning: 'WebAssembly could not be loaded or instantiated here.', fix: 'Check that box3d.wasm is served (the message has the URL and reason) and that the runtime supports WebAssembly.'},
  INTEGRITY_MISMATCH: {meaning: 'The loaded box3d.wasm is not the file this package was built with.', fix: 'Serve the box3d.wasm from the same package version, without rewriting proxies.'},
  GPU_UNAVAILABLE: {meaning: 'No WebGPU adapter or device for compute, or this device is too small for the job (the message names the limit).', fix: 'Use the CPU solver (the GPU backends are optional), a smaller grid or fewer grains, or a device with larger buffer and dispatch limits.'},
  GPU_DEVICE_LOST: {meaning: 'The WebGPU device was lost, or the GPU backend was destroyed, while it held the state.', fix: 'The backends fall back to the CPU solver where they can; otherwise build the backend again from the CPU solver.'},
  GPU_OUT_OF_MEMORY: {meaning: 'The WebGPU device ran out of memory for a buffer or a dispatch (the message has the label).', fix: 'Use fewer cells or grains, or the CPU solver.'},
  GPU_VALIDATION: {meaning: 'WebGPU rejected a buffer, pipeline or dispatch the backend made (the message has the label and the reason).', fix: 'This is a bug in the backend or the browser: report it with the message.'},
  GPU_SHADER: {meaning: 'A compute shader did not compile or name a snippet that exists (the message has the line).', fix: 'This is a bug in the backend: report it with the message.'},
  GPU_LAYOUT: {meaning: 'A GPU buffer layout does not fit the data it was asked to hold.', fix: 'This is a bug in the backend: report it with the message.'},
  GPU_CAPACITY: {meaning: 'A fixed-size GPU table overflowed during a step (for grains: a hash bucket was full), so contacts were missed.', fix: 'Build the backend with more slots (the message names the setting), or use the CPU solver.'},
  SHARED_UNAVAILABLE: {meaning: 'SharedArrayBuffer is not available (the page is not cross-origin isolated).', fix: 'Send COOP and COEP headers, or use the copying transport.'},
  // Files and saved state.
  INCOMPATIBLE_SAVE: {meaning: 'A saved session came from another WASM build or native interface version.', fix: 'Replay it with the build recorded in the file; replays are exact only on the build that made them.'},
  CHECKPOINT_MISMATCH: {meaning: 'A checkpoint is damaged, of another format version, or from another scene or set-up.', fix: 'Restore it into a world and solvers built the same way by the same version; nothing was changed by the refused restore.'},
  MODEL_MISMATCH: {meaning: 'Saved or transferred state names a model other than the one receiving it.', fix: 'Create the runtime with the model the state was produced by.'},
  // Numerics.
  UNSTABLE_TIME_STEP: {meaning: 'The time step is above the stability limit of the method for these inputs.', fix: 'Use the step the message gives (it states the limit and the rule), or the solver\'s stableTimeStep() helper.'},
  NUMERICAL_FAILURE: {meaning: 'A solve produced a non-finite number or failed to converge.', fix: 'Reduce the time step or the load increment; check world.diagnose() or simulation.diagnose() for ill-conditioned inputs.'},
  SOLVER_NOT_CONVERGED: {meaning: 'An iterative linear solve stopped at its iteration limit.', fix: 'Raise maxIterations or loosen the tolerance; the message has the residual reached.'},
  SOLVER_BREAKDOWN: {meaning: 'A matrix that must be positive definite is not.', fix: 'Check material values and constraints: a negative conductivity, capacity or stiffness, or an unconstrained body, causes this.'},
  SINGULAR_STEADY: {meaning: 'A steady problem has no unique answer.', fix: 'Fix a temperature or add a convective or radiating face on every separate solid.'},
  // Workers.
  NOT_RUNNING: {meaning: 'The worker or runtime is not running.', fix: 'Start it, or create a new one after a failure.'},
  NOT_CREATED: {meaning: 'A worker was asked to use a runtime before one was created.', fix: 'Send the create request first.'},
  RESET: {meaning: 'The request was dropped because the runtime was reset or destroyed while it waited.', fix: 'Issue it again if it still applies.'},
  INVALID_RESPONSE: {meaning: 'A worker replied with a message outside the protocol.', fix: 'Host and worker scripts must come from the same version.'},
  INVALID_LOAN: {meaning: 'A loaned buffer was returned twice, or is not the buffer that was lent.', fix: 'Return each loaned snapshot exactly once.'},
  WORKER_ERROR: {meaning: 'The worker script threw outside a request.', fix: 'See the message; create a new worker to continue.'},
  WORKER_MESSAGE_ERROR: {meaning: 'A message to or from the worker could not be deserialized.', fix: 'Send only structured-cloneable values.'},
  WORKER_SEND_ERROR: {meaning: 'A message could not be posted to the worker.', fix: 'Check that transferred buffers are not already detached.'},
  WORKER_TIMEOUT: {meaning: 'The worker did not answer within the time limit.', fix: 'The worker was recycled; reduce the work per request or raise the limit.'},
  WORKER_RECYCLE_ERROR: {meaning: 'A worker could not be replaced after a failure.', fix: 'Create a new client.'},
  RUNTIME_ERROR: {meaning: 'A runtime inside a worker failed with an error that is not an EngineError.', fix: 'See the message; it is the original error text.'},
  // Bugs.
  INTERNAL: {meaning: 'The engine reached a state it believes impossible.', fix: 'This is a bug: report it with the message and, if you can, a checkpoint or replay log.'},
} as const;
/** Every `code` an EngineError can carry. */
export type EngineErrorCode = keyof typeof ENGINE_ERRORS;

/** Where the problem is and what was found there. All optional; each is also in the message. */
export interface EngineErrorDetails {
  /** JSON pointer (RFC 6901) or dotted name of the offending field. */
  readonly path?: string;
  /** The offending value, rendered short and safe (never the raw object). */
  readonly value?: string;
  /** What is accepted there. */
  readonly expected?: string;
}

/** Every error this engine throws on purpose. `code` is a key of ENGINE_ERRORS; `details`, when present, names the field at fault, the value and what is accepted; `fix` says what to do. See docs/ERRORS.md. */
export class EngineError extends Error {
  readonly code: string;
  readonly details?: EngineErrorDetails;
  constructor(code: string, message: string, details?: EngineErrorDetails) {
    super(message); this.name = 'EngineError'; this.code = code;
    if (details) this.details = details;
  }
  /** What to do about this error: the taxonomy's advice for its code ('' for a code outside the taxonomy). */
  get fix(): string { return (ENGINE_ERRORS as Record<string, {fix: string}>)[this.code]?.fix ?? ''; }
}

/**
 * True for an EngineError from any copy of this module: the page and a worker, or the app and the kit, each have
 * their own class, so `instanceof` is not enough across those boundaries.
 */
export function isEngineError(value: unknown): value is EngineError {
  return value instanceof Error && value.name === 'EngineError' && typeof (value as {code?: unknown}).code === 'string';
}

/**
 * One thing `world.diagnose()` or `simulation.diagnose()` found in a set-up: which rule it breaks, with the numbers.
 * 'error': the state is already wrong (a non-finite value). 'warning': the set-up is outside what the method resolves
 * and will likely misbehave. 'note': inside the limits, but close, or costly.
 */
export interface DiagnosticFinding {
  readonly severity: 'error' | 'warning' | 'note';
  /** A short stable name, e.g. 'mass-ratio', 'cfl', 'critical-time-step'. docs/ERRORS.md lists them. */
  readonly rule: string;
  /** What it is about: 'body row 12', 'joint 3', a subsystem id. */
  readonly subject: string;
  /** The rule in words, with the numbers in it, and what to change. */
  readonly message: string;
  /** The numbers the rule compared, by name, in SI units. */
  readonly numbers: {readonly [name: string]: number};
}

/** A caught value as the parts a user interface shows: a code, what happened and what to do. Never throws. */
export function explainError(error: unknown): {code: string; meaning: string; message: string; fix: string; path: string | null} {
  if (isEngineError(error)) {
    const entry = (ENGINE_ERRORS as Record<string, {meaning: string; fix: string}>)[error.code];
    return {code: error.code, meaning: entry?.meaning ?? 'An engine error.', message: error.message, fix: entry?.fix ?? '', path: error.details?.path ?? null};
  }
  let message = 'Unknown failure.';
  try { message = error instanceof Error ? error.message : String(error); } catch { /* a value that cannot be printed */ }
  return {code: 'INTERNAL', meaning: ENGINE_ERRORS.INTERNAL.meaning, message, fix: ENGINE_ERRORS.INTERNAL.fix, path: null};
}

/** A value as it appears in an error message: short, on one line, safe for any input (cyclic, huge, hostile toString). */
export function showValue(value: unknown): string {
  try {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
    if (typeof value === 'bigint') return `${String(value).slice(0, 40)}n`;
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
    if (typeof value === 'symbol') return 'a symbol';
    if (typeof value === 'function') return 'a function';
    if (Array.isArray(value)) return `an array of ${value.length}`;
    if (ArrayBuffer.isView(value)) return `a ${Object.prototype.toString.call(value).slice(8, -1)} of ${(value as unknown as {length?: number}).length ?? value.byteLength}`;
    return 'an object';
  } catch { return 'an unprintable value'; }
}

/**
 * The largest magnitudes the rigid world takes (the scene format checks the same table). The solver holds single-precision numbers, and products of these
 * (speed squared times mass, force over mass times a time step) must stay below 3.4e38, or a step yields infinities
 * and then NaN in every body they touch. Each limit is far beyond physical use in a world 100 km wide; a value above
 * one is refused with INVALID_PAYLOAD and the world is unchanged (docs/ERRORS.md, "Accepted ranges").
 */
export const RIGID_LIMITS = Object.freeze({
  /**
   * m: positions, static geometry (meshes and height fields), joint lengths. Box3D's own sanity limit (B3_HUGE in
   * box3d/constants.h) is 100 km: single-precision positions lose millimetres beyond about 16 km, and Box3D treats a
   * bounding box that reaches past 100 km as invalid.
   */
  extent: 1e5,
  /**
   * m: the half extents, radii and hull points of the convex shapes of a dynamic body. Box3D's step does not return
   * when a dynamic box with half extents of about 1.5 km or more (or a dynamic hull cube of about 100 km) rests on
   * another body (native defect ND-1, tests/fuzz/native-defects.test.mjs), so a dynamic body's convex shapes stop at
   * 1 km. Static and kinematic bodies step normally with boxes up to 100 km, so theirs may reach `extent`; a body
   * with such a shape cannot be made dynamic.
   */
  shape:1e3,
  /** m/s and rad/s: body velocities. */
  speed:1e6,
  /** m/s^2: gravity; also the bound of a body's gravity scale. */
  gravity:1e6,
  /** N, N m, N s and N m s: forces, torques and impulses, motor forces and explosion strength. */
  force:1e12,
  /** kg/m^3: a density is 0 (a massless shape) or within [densityMin, density]. */
  density:1e6,densityMin:1e-3,
  /** kg: the range of an explicit mass. */
  massMin:1e-12,massMax:1e16,
  /** Hz, and the bound of damping ratios and damping coefficients (1/s). */
  hertz:1e6,
});

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new EngineError('INVALID_PAYLOAD', `${label} must be a plain object; got ${showValue(value)}.`, {path: label, value: showValue(value), expected: 'a plain object'});
  }
  return value as Record<string, unknown>;
}

export function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) {
    throw new EngineError('INVALID_PAYLOAD', `${label}.${key.length > 40 ? `${key.slice(0, 40)}...` : key} is not supported. ${label} takes: ${keys.join(', ')}.`, {path: `${label}.${key.slice(0, 40)}`, expected: keys.join(', ')});
  }
}

const rangeText = (min: number, max: number): string => min === -Infinity && max === Infinity ? 'a finite number' :
  max === Infinity ? (min === Number.MIN_VALUE ? 'a finite number above 0' : `a finite number of at least ${min}`) :
  min === -Infinity ? `a finite number of at most ${max}` : `a finite number within [${min}, ${max}]`;

export function finite(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    const shown = showValue(value), expected = rangeText(min, max);
    throw new EngineError('INVALID_PAYLOAD', `${label} must be finite and within [${min}, ${max}]; got ${shown}. Pass ${expected}.`, {path: label, value: shown, expected});
  }
  return value;
}

export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, label, min, max);
  if (!Number.isSafeInteger(n)) throw new EngineError('INVALID_PAYLOAD', `${label} must be an integer; got ${showValue(value)}.`, {path: label, value: showValue(value), expected: `a whole number within [${min}, ${max}]`});
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
