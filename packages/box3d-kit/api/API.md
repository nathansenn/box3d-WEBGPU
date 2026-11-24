# box3d-webgpu-kit API reference

Generated from the published type declarations by `scripts/api-docs.mjs`. See the README for guides.

## `box3d-webgpu-kit`

### applyImpulses · function

Apply impulses[i*3..i*3+2] to bodies[i]. Destroyed bodies are skipped; returns how many were applied.

```ts
export declare function applyImpulses(world: PhysicsWorld, bodies: readonly (Body | null)[], impulses: ArrayLike<number>): number;
```

### axisRotation · function

Rotation that turns the +z axis onto `axis`: a joint frame built from it
hinges about `axis`. For a prismatic joint, which slides along +x, pass
`from: 'x'`.

```ts
export declare function axisRotation(axisLike: Vec3Like, from?: 'x' | 'z'): [number, number, number, number];
```

### Body · type

An opaque handle to a body of one world. It never names another body, even after this one is destroyed; test it with isAlive().

```ts
export type Body = NativeBodyHandle;
```

### BodyFlags · type

A body's bullet flag, sleep settings and motion locks; see PhysicsWorld.getBodyFlags().

```ts
export type BodyFlags = NativeBodyFlags;
```

### BodyKind · type

The shape kind of a render row: 'box', 'sphere', 'capsule', 'hull', 'mesh', 'heightfield' or 'compound'.

```ts
export type BodyKind = NativeBodyKind;
```

### BodyMassData · type

Mass (kg), centre of mass in the body frame (m) and inertia tensor about it [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2, as getMassData() reports them.

```ts
export type BodyMassData = NativeBodyMassState;
```

### BodyOptions · interface

Lengths in metres, masses from density in kg/m^3, angles in radians.

```ts
export interface BodyOptions {
    readonly shape: ShapeOptions;
    readonly type?: BodyType;
    readonly position: Vec3Like;
    readonly rotation?: QuatLike;
    readonly linearVelocity?: Vec3Like;
    readonly angularVelocity?: Vec3Like;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly color?: number;
    readonly bullet?: boolean;
    readonly sensor?: boolean;
    readonly hitEvents?: boolean;
    readonly neverSleeps?: boolean;
    readonly lockRotation?: boolean;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly filter?: {
        readonly categoryBits?: bigint;
        readonly maskBits?: bigint;
        readonly groupIndex?: number;
    };
    readonly massData?: MassDataOptions;
}
```

### BodyPose · interface

A body's pose as getPose() reads it from the render transforms.

```ts
export interface BodyPose {
    position: [number, number, number];
    rotation: [number, number, number, number];
    halfExtents: [number, number, number];
}
```

### BodyRing · class

Keeps at most `limit` bodies alive: spawning past the limit destroys the
oldest one it spawned. Use it for projectiles, shell casings or debris so a
long session never exhausts body capacity.

```ts
export declare class BodyRing {
  readonly limit: number;
  spawn(options: { position: Vec3Like; halfSize?: number; impulse?: Vec3Like; }): Body | null;
  get size(): number;
  clear(): void;
}
```

### BodyState · type

A body as the solver holds it: position (m), rotation [x, y, z, w], linear (m/s) and angular (rad/s) velocity, mass (kg), whether it is awake, and its type.

```ts
export type BodyState = NativeBodyState;
```

### BodyType · type

'dynamic' is simulated, 'kinematic' is moved by you and pushes dynamic bodies, 'static' never moves.

```ts
export type BodyType = NativeBodyType;
```

### Box3DModuleFactory · type

Emscripten MODULARIZE/EXPORT_ES6 factory exported by box3d.js.

```ts
export type Box3DModuleFactory = (options?: {
    locateFile?: (path: string, prefix: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
    b3wPoolSize?: number;
}) => Promise<unknown>;
```

### box3dThreading · function

How the worlds of a pool from `loadBox3D` are stepped: on how many threads, and from how many awake bodies.

```ts
export declare function box3dThreading(pool: NativeWorldPool): Box3DThreading;
```

### Box3DThreading · interface

How a pool's worlds are stepped.

```ts
export interface Box3DThreading {
    readonly threads: number;
    readonly threshold: number;
    lastStepThreads(): number;
}
```

### boxOutlines · function

Outline every body's box.

```ts
export declare function boxOutlines(source: InstanceSource, options?: DebugLineOptions): DebugLines;
```

### BUILD_INFO · const

Identity of the WASM this package ships. Compare against bug reports and replay logs.

```ts
export declare const BUILD_INFO: BuildInfo;
```

### BuildInfo · interface

The identity of the build this package ships: its version, the Box3D source it was compiled from, the compiler, and the SHA-256 of the WebAssembly and its glue.

```ts
export interface BuildInfo {
    readonly kitVersion: string;
    readonly box3dRef: string | null;
    readonly box3dCommit: string | null;
    readonly emscripten: string | null;
    readonly bridgeSha256: string | null;
    readonly wasmSha256: string;
    readonly wasmBytes: number;
    readonly glueSha256: string;
    readonly threadedWasmSha256: string;
    readonly threadedWasmBytes: number;
}
```

### capabilities · function

One report of what this build and runtime can do, for feature gating, bug
reports and support pages. Limits describe the native bridge shipped with
this version; they grow when the WASM is rebuilt with more exports.

```ts
export declare function capabilities(): Capabilities;
```

### Capabilities · interface

What this package build and this runtime support, from capabilities(): the build identity, the native interface version, the environment and the shipped modules.

```ts
export interface Capabilities {
    readonly build: BuildInfo;
    readonly nativeApiVersion: number;
    readonly environment: EnvironmentReport;
    readonly modules: readonly string[];
    readonly limits: {
        readonly worldsPerModule: number;
        readonly bodiesPerWorld: {
            readonly default: number;
            readonly max: number;
        };
        readonly shapes: readonly string[];
        readonly joints: boolean;
        readonly contactEvents: boolean;
        readonly setPoseOrVelocity: boolean;
        readonly gravityControl: boolean;
        readonly threads: number;
        readonly queryHitsMax: number;
    };
}
```

### CapsuleMoveOptions · interface

An upright capsule to move through the world; see PhysicsWorld.moveCapsule().

```ts
export interface CapsuleMoveOptions {
    readonly position: Vec3Like;
    readonly radius: number;
    readonly halfLength: number;
    readonly translation: Vec3Like;
    readonly maxSlopeDegrees?: number;
    readonly iterations?: number;
    readonly tolerance?: number;
    readonly bodies?: {
        readonly static?: boolean;
        readonly kinematic?: boolean;
        readonly dynamic?: boolean;
    };
    readonly categoryBits?: bigint;
    readonly maskBits?: bigint;
    readonly ignoreBody?: Body;
}
```

### CapsuleMoveResult · interface

Where PhysicsWorld.moveCapsule() left the capsule, the planes around it, and the rounds it took.

```ts
export interface CapsuleMoveResult {
    readonly position: [number, number, number];
    readonly planes: MoverPlane[];
    readonly iterations: number;
}
```

### CompoundShapeOptions · interface

One shape of a compound body, placed in the body's frame.

```ts
export interface CompoundShapeOptions {
    readonly shape: ConvexShapeOptions;
    readonly position?: Vec3Like;
    readonly rotation?: QuatLike;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
}
```

### ContactStats · type

Contact statistics, with the impulses of the last sub-step also given as forces.

```ts
export type ContactStats = NativeContactStats & {
    readonly totalNormalForce: number;
    readonly largestNormalForce: number;
};
```

### convertMatrices · function

Copy `count` column-major 4x4 matrices from `source` into `out`, converting
from Box3D's Y-up frame when `up` is 'z': (x, y, z) -> (x, -z, y), which
keeps the frame right-handed. `out` may alias `source`.

```ts
export declare function convertMatrices(source: Float32Array, out: Float32Array, count: number, up?: UpAxis): Float32Array;
```

### convertVector · function

Convert one Box3D (Y-up) point or direction to the target frame.

```ts
export declare function convertVector(v: readonly [number, number, number], up?: UpAxis): [number, number, number];
```

### ConvexShapeOptions · type

The shapes a compound body may hold.

```ts
export type ConvexShapeOptions = {
    readonly kind: 'box';
    readonly halfExtents: Vec3Like;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: ArrayLike<number>;
};
```

### createWorld · function

One-call setup: load the WASM module and return an empty arena world.
The world owns its module; `world.dispose()` releases both.
For several worlds sharing one module, use `loadBox3D()` + `new PhysicsWorld(pool)`.

```ts
export declare function createWorld(options?: WorldOptions & LoadBox3DOptions & {
    readonly gravity?: readonly [number, number, number];
    readonly ground?: boolean;
}): Promise<PhysicsWorld>;
```

### DEBUG_FLOATS_PER_BOX · const

Floats boxOutlines() writes per body: 12 edges of 2 vertices of 3 floats.

```ts
export declare const DEBUG_FLOATS_PER_BOX: number;
```

### DebugDrawLines · type

Line segments from PhysicsWorld.debugLines(): vertex pairs, x y z and r g b (0..1) per vertex.

```ts
export type DebugDrawLines = NativeDebugLines;
```

### DebugDrawOptions · type

What PhysicsWorld.debugLines() draws: switches per layer, scales, and an optional box to draw in.

```ts
export type DebugDrawOptions = Omit<NativeDebugDrawOptions, 'region'> & {
    readonly region?: {
        readonly min: Vec3Like;
        readonly max: Vec3Like;
    };
};
```

### DebugLineOptions · interface

Options of the debug line builders: interpolation, the up axis, a buffer to reuse and whether to skip the ground.

```ts
export interface DebugLineOptions {
    readonly alpha?: number;
    readonly up?: UpAxis;
    readonly out?: Float32Array;
    readonly skipGround?: boolean;
}
```

### DebugLines · interface

Line segments for a debug overlay: xyz triples, two vertices per segment.

```ts
export interface DebugLines {
    readonly positions: Float32Array;
    readonly vertexCount: number;
}
```

### detectEnvironment · function

What this runtime supports. Call before loading to choose a path or explain a failure to the player.

```ts
export declare function detectEnvironment(): EnvironmentReport;
```

### DiagnosticFinding · interface

One thing `world.diagnose()` or `simulation.diagnose()` found in a set-up: which rule it breaks, with the numbers.
'error': the state is already wrong (a non-finite value). 'warning': the set-up is outside what the method resolves
and will likely misbehave. 'note': inside the limits, but close, or costly.

```ts
export interface DiagnosticFinding {
    readonly severity: 'error' | 'warning' | 'note';
    readonly rule: string;
    readonly subject: string;
    readonly message: string;
    readonly numbers: {
        readonly [name: string]: number;
    };
}
```

### ENGINE_ERRORS · const

The error taxonomy (docs/ERRORS.md). Every error this engine throws on purpose is an `EngineError` whose `code` is a
key of this table. `meaning` says what the code stands for; `fix` is what the caller does about it. A test
(tests/fuzz/error-taxonomy.test.mjs) fails when a code is thrown that is not listed here.

```ts
export declare const ENGINE_ERRORS: {
    readonly INVALID_PAYLOAD: {
        readonly meaning: "An argument, option, file or message holds a value the engine cannot use.";
        readonly fix: "Read the message: it names the field, the value it got and the values it takes. Correct the input and call again; nothing was changed.";
    };
    readonly INVALID_STATE: {
        readonly meaning: "The call is valid, but not in the state the object is in now.";
        readonly fix: "Do the step the message names first (for example stop recording before reset, or step before reading results).";
    };
    readonly DISPOSED: {
        readonly meaning: "The world, pool, solver or runtime was destroyed, or its native handle is no longer valid.";
        readonly fix: "Create a new one; do not keep references past dispose() or destroy().";
    };
    readonly STALE_BODY: {
        readonly meaning: "The body handle names a body that was destroyed, or one from before a reset.";
        readonly fix: "Check world.isAlive(body) before using a kept handle, and drop handles when you destroy or reset.";
    };
    readonly STALE_JOINT: {
        readonly meaning: "The joint handle names a joint that was destroyed, or one of its bodies was.";
        readonly fix: "Check world.isJointAlive(joint) before using a kept handle.";
    };
    readonly STALE_QUERY: {
        readonly meaning: "Body storage changed between validating a spatial query and running it.";
        readonly fix: "Run the query again.";
    };
    readonly STALE_GENERATION: {
        readonly meaning: "A reply or command belongs to a runtime generation that was reset.";
        readonly fix: "Discard it and issue the request again against the current runtime.";
    };
    readonly STALE_REQUEST: {
        readonly meaning: "A request was superseded by a newer one before it ran.";
        readonly fix: "Use the result of the newer request.";
    };
    readonly STALE_SNAPSHOT: {
        readonly meaning: "A snapshot was read after the buffer it lives in was reused.";
        readonly fix: "Copy what you need from a snapshot before the next step, or request a new one.";
    };
    readonly WORLD_CAPACITY: {
        readonly meaning: "The world, the module or a scene is at a fixed limit (16 worlds per module, 65,536 bodies per world).";
        readonly fix: "Destroy what you no longer need, reserve capacity up front with `capacity`, or split the scene.";
    };
    readonly ALLOCATION_FAILED: {
        readonly meaning: "The WebAssembly heap could not grow, or a native allocation failed.";
        readonly fix: "Free worlds you no longer use; the existing world is intact. On 32-bit WebAssembly the heap is at most 2 GiB.";
    };
    readonly WORK_LIMIT: {
        readonly meaning: "A solver reached its iteration or work budget before it met its tolerance.";
        readonly fix: "Raise the budget the message names, use a smaller time step, or coarsen the model.";
    };
    readonly QUERY_VERSION_EXHAUSTED: {
        readonly meaning: "A world ran more than 2^32 query batches.";
        readonly fix: "Create a new world.";
    };
    readonly SEQUENCE_EXHAUSTED: {
        readonly meaning: "A shared snapshot ring used all of its sequence numbers.";
        readonly fix: "Reset the runtime with a new ring.";
    };
    readonly BACKPRESSURE: {
        readonly meaning: "More work was queued than the worker accepts at once.";
        readonly fix: "Wait for earlier requests to settle before sending more.";
    };
    readonly BUSY: {
        readonly meaning: "The runtime is in the middle of another request.";
        readonly fix: "Await the pending request first.";
    };
    readonly UNSUPPORTED_BACKEND: {
        readonly meaning: "This build, WASM artifact or file version does not have the feature the call needs.";
        readonly fix: "Use the artifact shipped with this version (npm run build:wasm in the repository), or the feature the message names.";
    };
    readonly UNSUPPORTED_JOINT: {
        readonly meaning: "That joint type does not take that setting.";
        readonly fix: "See the joint feature table in the kit README: for example only revolute, prismatic, distance and wheel joints have motors.";
    };
    readonly INVALID_BACKEND: {
        readonly meaning: "The WASM module answered with something outside its contract.";
        readonly fix: "The artifact and the JavaScript do not match: rebuild or reinstall so that both come from the same version, and report it if they already do.";
    };
    readonly WASM_UNAVAILABLE: {
        readonly meaning: "WebAssembly could not be loaded or instantiated here.";
        readonly fix: "Check that box3d.wasm is served (the message has the URL and reason) and that the runtime supports WebAssembly.";
    };
    readonly INTEGRITY_MISMATCH: {
        readonly meaning: "The loaded box3d.wasm is not the file this package was built with.";
        readonly fix: "Serve the box3d.wasm from the same package version, without rewriting proxies.";
    };
    readonly GPU_UNAVAILABLE: {
        readonly meaning: "No WebGPU adapter or device for compute, or this device is too small for the job (the message names the limit).";
        readonly fix: "Use the CPU solver (the GPU backends are optional), a smaller grid or fewer grains, or a device with larger buffer and dispatch limits.";
    };
    readonly GPU_DEVICE_LOST: {
        readonly meaning: "The WebGPU device was lost, or the GPU backend was destroyed, while it held the state.";
        readonly fix: "The backends fall back to the CPU solver where they can; otherwise build the backend again from the CPU solver.";
    };
    readonly GPU_OUT_OF_MEMORY: {
        readonly meaning: "The WebGPU device ran out of memory for a buffer or a dispatch (the message has the label).";
        readonly fix: "Use fewer cells or grains, or the CPU solver.";
    };
    readonly GPU_VALIDATION: {
        readonly meaning: "WebGPU rejected a buffer, pipeline or dispatch the backend made (the message has the label and the reason).";
        readonly fix: "This is a bug in the backend or the browser: report it with the message.";
    };
    readonly GPU_SHADER: {
        readonly meaning: "A compute shader did not compile or name a snippet that exists (the message has the line).";
        readonly fix: "This is a bug in the backend: report it with the message.";
    };
    readonly GPU_LAYOUT: {
        readonly meaning: "A GPU buffer layout does not fit the data it was asked to hold.";
        readonly fix: "This is a bug in the backend: report it with the message.";
    };
    readonly GPU_CAPACITY: {
        readonly meaning: "A fixed-size GPU table overflowed during a step (for grains: a hash bucket was full), so contacts were missed.";
        readonly fix: "Build the backend with more slots (the message names the setting), or use the CPU solver.";
    };
    readonly SHARED_UNAVAILABLE: {
        readonly meaning: "SharedArrayBuffer is not available (the page is not cross-origin isolated).";
        readonly fix: "Send COOP and COEP headers, or use the copying transport.";
    };
    readonly INCOMPATIBLE_SAVE: {
        readonly meaning: "A saved session came from another WASM build or native interface version.";
        readonly fix: "Replay it with the build recorded in the file; replays are exact only on the build that made them.";
    };
    readonly CHECKPOINT_MISMATCH: {
        readonly meaning: "A checkpoint is damaged, of another format version, or from another scene or set-up.";
        readonly fix: "Restore it into a world and solvers built the same way by the same version; nothing was changed by the refused restore.";
    };
    readonly MODEL_MISMATCH: {
        readonly meaning: "Saved or transferred state names a model other than the one receiving it.";
        readonly fix: "Create the runtime with the model the state was produced by.";
    };
    readonly UNSTABLE_TIME_STEP: {
        readonly meaning: "The time step is above the stability limit of the method for these inputs.";
        readonly fix: "Use the step the message gives (it states the limit and the rule), or the solver's stableTimeStep() helper.";
    };
    readonly NUMERICAL_FAILURE: {
        readonly meaning: "A solve produced a non-finite number or failed to converge.";
        readonly fix: "Reduce the time step or the load increment; check world.diagnose() or simulation.diagnose() for ill-conditioned inputs.";
    };
    readonly SOLVER_NOT_CONVERGED: {
        readonly meaning: "An iterative linear solve stopped at its iteration limit.";
        readonly fix: "Raise maxIterations or loosen the tolerance; the message has the residual reached.";
    };
    readonly SOLVER_BREAKDOWN: {
        readonly meaning: "A matrix that must be positive definite is not.";
        readonly fix: "Check material values and constraints: a negative conductivity, capacity or stiffness, or an unconstrained body, causes this.";
    };
    readonly SINGULAR_STEADY: {
        readonly meaning: "A steady problem has no unique answer.";
        readonly fix: "Fix a temperature or add a convective or radiating face on every separate solid.";
    };
    readonly NOT_RUNNING: {
        readonly meaning: "The worker or runtime is not running.";
        readonly fix: "Start it, or create a new one after a failure.";
    };
    readonly NOT_CREATED: {
        readonly meaning: "A worker was asked to use a runtime before one was created.";
        readonly fix: "Send the create request first.";
    };
    readonly RESET: {
        readonly meaning: "The request was dropped because the runtime was reset or destroyed while it waited.";
        readonly fix: "Issue it again if it still applies.";
    };
    readonly INVALID_RESPONSE: {
        readonly meaning: "A worker replied with a message outside the protocol.";
        readonly fix: "Host and worker scripts must come from the same version.";
    };
    readonly INVALID_LOAN: {
        readonly meaning: "A loaned buffer was returned twice, or is not the buffer that was lent.";
        readonly fix: "Return each loaned snapshot exactly once.";
    };
    readonly WORKER_ERROR: {
        readonly meaning: "The worker script threw outside a request.";
        readonly fix: "See the message; create a new worker to continue.";
    };
    readonly WORKER_MESSAGE_ERROR: {
        readonly meaning: "A message to or from the worker could not be deserialized.";
        readonly fix: "Send only structured-cloneable values.";
    };
    readonly WORKER_SEND_ERROR: {
        readonly meaning: "A message could not be posted to the worker.";
        readonly fix: "Check that transferred buffers are not already detached.";
    };
    readonly WORKER_TIMEOUT: {
        readonly meaning: "The worker did not answer within the time limit.";
        readonly fix: "The worker was recycled; reduce the work per request or raise the limit.";
    };
    readonly WORKER_RECYCLE_ERROR: {
        readonly meaning: "A worker could not be replaced after a failure.";
        readonly fix: "Create a new client.";
    };
    readonly RUNTIME_ERROR: {
        readonly meaning: "A runtime inside a worker failed with an error that is not an EngineError.";
        readonly fix: "See the message; it is the original error text.";
    };
    readonly INTERNAL: {
        readonly meaning: "The engine reached a state it believes impossible.";
        readonly fix: "This is a bug: report it with the message and, if you can, a checkpoint or replay log.";
    };
};
```

### EngineError · class

Every error this engine throws on purpose. `code` is a key of ENGINE_ERRORS; `details`, when present, names the field at fault, the value and what is accepted; `fix` says what to do. See docs/ERRORS.md.

```ts
export declare class EngineError extends Error {
  readonly code: string;
  readonly details?: EngineErrorDetails;
  get fix(): string;
}
```

### EngineErrorCode · type

Every `code` an EngineError can carry.

```ts
export type EngineErrorCode = keyof typeof ENGINE_ERRORS;
```

### EngineErrorDetails · interface

Where the problem is and what was found there. All optional; each is also in the message.

```ts
export interface EngineErrorDetails {
    readonly path?: string;
    readonly value?: string;
    readonly expected?: string;
}
```

### EnvironmentReport · interface

What the current runtime offers, from detectEnvironment(): the kind of runtime, WebAssembly and its SIMD, WebGPU, workers and shared memory.

```ts
export interface EnvironmentReport {
    readonly runtime: 'browser' | 'worker' | 'node' | 'other';
    readonly webAssembly: boolean;
    readonly wasmSimd: boolean;
    readonly webgpu: boolean;
    readonly sharedArrayBuffer: boolean;
    readonly crossOriginIsolated: boolean;
    readonly workers: boolean;
}
```

### explainError · function

A caught value as the parts a user interface shows: a code, what happened and what to do. Never throws.

```ts
export declare function explainError(error: unknown): {
    code: string;
    meaning: string;
    message: string;
    fix: string;
    path: string | null;
};
```

### FixedStepLoop · class

Fixed-timestep accumulator. Frame times vary; physics must not. Feed it the
real frame delta and it runs a whole number of identical steps, which keeps
simulations deterministic and stable regardless of display refresh rate.

```ts
export declare class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  advance(frameSeconds: number, tick: (step: number) => void): FixedStepResult;
  reset(): void;
  get pending(): number;
  setPending(seconds: number): void;
}
```

### FixedStepOptions · interface

The fixed time step and how many steps one update may take.

```ts
export interface FixedStepOptions {
    readonly step?: number;
    readonly maxSteps?: number;
}
```

### FixedStepResult · interface

What an update did: the steps taken, the blend factor towards the next step for rendering, and the seconds dropped because maxSteps was reached.

```ts
export interface FixedStepResult {
    readonly steps: number;
    readonly alpha: number;
    readonly droppedSeconds: number;
}
```

### formatStats · function

Render one stats snapshot as the overlay's text. Exposed for custom HUDs and logging.

```ts
export declare function formatStats(stats: WorldStats, heapBytes?: number, title?: string): string;
```

### GpuBufferLike · interface

Structural subset of GPUBuffer.

```ts
export interface GpuBufferLike {
    readonly size: number;
}
```

### GpuQueueLike · interface

Structural subset of GPUQueue.

```ts
export interface GpuQueueLike {
    writeBuffer(buffer: unknown, bufferOffset: number, data: ArrayBufferView, dataOffset?: number, size?: number): void;
}
```

### Inspector · interface

A mounted debug overlay: its element, a manual refresh and unmount().

```ts
export interface Inspector {
    readonly element: ElementLike;
    refresh(): Promise<void>;
    unmount(): void;
}
```

### InspectorOptions · interface

Where the overlay mounts and how often it refreshes.

```ts
export interface InspectorOptions {
    readonly parent?: {
        appendChild(node: any): unknown;
    };
    readonly document?: DocumentLike;
    readonly intervalMs?: number;
    readonly title?: string;
}
```

### InspectorSource · interface

What the overlay reads: anything with stats(), such as a PhysicsWorld or a RemoteWorld.

```ts
export interface InspectorSource {
    stats(): WorldStats | Promise<WorldStats>;
    readonly native?: {
        readonly HEAPF32: Float32Array;
    };
}
```

### INSTANCE_WGSL · const

WGSL snippet matching the layout written by writeInstances (bind as read-only storage).

```ts
export declare const INSTANCE_WGSL = "\nstruct Instances { m: array<mat4x4<f32>> };\n@group(0) @binding(0) var<storage, read> instances: Instances;\n// Box3D matrices are scaled by half extents: draw a unit cube spanning -1..1.\nfn instanceMatrix(i: u32) -> mat4x4<f32> { return instances.m[i]; }\n";
```

### InstanceBufferSource · type

Minimal backend contract shared with the Box3D WebGPU app (src/types.ts).
Kept structurally identical so worlds created by this package can be handed
to the app's renderer, but without the app's demo-scene catalog.

```ts
export type InstanceBufferSource = {
    readonly HEAPF32: Float32Array;
    frameVersion(): number;
    colorVersion(): number;
    _b3w_matrices_ptr(): number | bigint;
    _b3w_colors_ptr(): number | bigint;
    _b3w_body_count(): number;
    _b3w_max_bodies(): number;
};
```

### InstanceSource · interface

Anything that streams box instances: PhysicsWorld, or RemoteWorld from ./worker.

```ts
export interface InstanceSource {
    bodyCount(): number;
    transformVersion(): number;
    colorVersion(): number;
    matrices(): Float32Array;
    colors(): Float32Array;
    interpolatedMatrices?(alpha: number): Float32Array;
    readonly capacity?: number;
    readonly native?: {
        readonly maxBodies: number;
    };
    bodyKinds?(): readonly string[];
}
```

### isEngineError · function

True for an EngineError from any copy of this module: the page and a worker, or the app and the kit, each have
their own class, so `instanceof` is not enough across those boundaries.

```ts
export declare function isEngineError(value: unknown): value is EngineError;
```

### Joint · type

An opaque handle to a joint of one world; test it with isJointAlive().

```ts
export type Joint = NativeJointHandle;
```

### JointDetails · type

Everything the solver holds about one joint: separation errors, thresholds, stiffness and the values of its type; see PhysicsWorld.getJointDetails().

```ts
export type JointDetails = NativeJointDetails;
```

### JointDrive · type

What a motor joint does; see JointOptions.drive.

```ts
export type JointDrive = Omit<NativeJointDrive, 'linearVelocity' | 'angularVelocity'> & {
    readonly linearVelocity?: Vec3Like;
    readonly angularVelocity?: Vec3Like;
};
```

### JointFrame · interface

Where a joint attaches to a body: a position (m) and rotation in that body's own frame. Both default to the body's origin and axes.

```ts
export interface JointFrame {
    readonly position?: Vec3Like;
    readonly rotation?: QuatLike;
}
```

### JointOptions · interface

Connects two bodies; pass null for a body to attach to the fixed world.
Frames are local to each body. Revolute and wheel joints turn about the
frame's z axis; prismatic travel and wheel suspension run along frame A's x
axis. Use `axisRotation()` to aim a frame at another axis.

```ts
export interface JointOptions {
    readonly type: JointType;
    readonly bodyA: Body | null;
    readonly bodyB: Body | null;
    readonly frameA?: JointFrame;
    readonly frameB?: JointFrame;
    readonly collideConnected?: boolean;
    readonly limits?: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly motor?: {
        readonly speed: number;
        readonly maxForce: number;
    };
    readonly spring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly target?: number;
    };
    readonly length?: number;
    readonly coneAngle?: number;
    readonly stiffness?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly thresholds?: JointThresholds;
    readonly drive?: JointDrive;
    readonly maxTorque?: number;
    readonly steering?: {
        readonly angle: number;
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly maxTorque: number;
        readonly limits?: {
            readonly lower: number;
            readonly upper: number;
        };
    };
}
```

### JointState · type

What a joint reports: its angle (rad), travel (m) or length (m) in `value`, and the force (N) and torque (N m) it carries.

```ts
export type JointState = NativeJointState;
```

### JointThresholds · type

Force and torque at which a joint reports 'joint-overload', and whether it then breaks; see JointOptions.thresholds.

```ts
export type JointThresholds = NativeJointThresholds;
```

### JointType · type

The six joint types: 'weld', 'revolute', 'spherical', 'prismatic', 'distance' and 'wheel'. JointOptions says what each constrains.

```ts
export type JointType = NativeJointType;
```

### lastUploadRange · function

The row range the most recent writeInstances call uploaded.

```ts
export declare function lastUploadRange(): UploadRange;
```

### leakReporting · const

Called when a leaked world is reclaimed; replace to route the warning elsewhere (or silence it).

```ts
export declare const leakReporting: {
    warn: (message: string) => void;
};
```

### LICENSE_NOTICE · const

Attribution text to include in your app's credits or third-party notices.

```ts
export declare const LICENSE_NOTICE = "Physics: Box3D by Erin Catto (https://github.com/erincatto/box3d), MIT License, Copyright (c) 2026 Erin Catto.\nIntegration: box3d-webgpu-kit, MIT License.";
```

### loadBox3D · function

Instantiate the Box3D WebAssembly module and return a pool that can create
up to `pool.capacity` isolated worlds sharing that module's memory.
Call once per page/worker and reuse the pool.

```ts
export declare function loadBox3D(options?: LoadBox3DOptions): Promise<NativeWorldPool>;
```

### LoadBox3DOptions · interface

Where the WebAssembly comes from and how it is checked: URLs or bytes for box3d.js and box3d.wasm, an already imported factory, and integrity verification against the build's SHA-256.

```ts
export interface LoadBox3DOptions {
    readonly moduleUrl?: string | URL;
    readonly wasmUrl?: string | URL;
    readonly wasmBinary?: ArrayBuffer | Uint8Array;
    readonly factory?: Box3DModuleFactory;
    readonly integrity?: boolean | string;
    readonly threads?: number;
    readonly threadThreshold?: number;
}
```

### loadSession · function

Restore a saved session into `world` by replaying it. Throws
INCOMPATIBLE_SAVE when the file came from another WASM build or native ABI
(pass {allowOtherBuild: true} to try anyway; `matches` then tells you whether it held).

```ts
export declare function loadSession(world: PhysicsWorld, saved: unknown, options?: {
    allowOtherBuild?: boolean;
}): ReplayReport;
```

### MassDataOptions · interface

Mass in kg, centre of mass in the body frame (default the origin), and the inertia tensor about
the centre of mass in body axes as [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2.

```ts
export interface MassDataOptions {
    readonly mass: number;
    readonly center?: Vec3Like;
    readonly inertia: readonly [number, number, number, number, number, number];
}
```

### mountInspector · function

Mount a small text overlay that shows a world's counts and timings and refreshes on an interval. Needs a DOM document; returns the handle to remove it.

```ts
export declare function mountInspector(source: InspectorSource, options?: InspectorOptions): Inspector;
```

### MoverPlane · type

A surface around a moved capsule: normal, closest point, push and whether it acted as a wall.

```ts
export type MoverPlane = NativeMoverPlane;
```

### NATIVE_WORLD_API_VERSION · const

The version of the interface between this adapter and box3d.wasm. A module of another version is refused with UNSUPPORTED_BACKEND.

```ts
export declare const NATIVE_WORLD_API_VERSION = 1;
```

### NativeBodyCapacityInfo · interface

How many bodies a world's buffers hold now, how far they can grow, and the generation of the buffers (views must be re-read when it changes).

```ts
export interface NativeBodyCapacityInfo {
    capacity: number;
    maxCapacity: number;
    growable: boolean;
    bufferVersion: number | null;
    bridgeBufferBytes: number | null;
}
```

### NativeBodyDescriptor · interface

Everything createBody() takes, with vectors as plain tuples: the shape, type, pose, velocities, material, flags, damping, gravity scale, collision filter and optional mass data. Values must lie within RIGID_LIMITS.

```ts
export interface NativeBodyDescriptor {
    readonly shape: NativeBodyShape;
    readonly type?: NativeBodyType;
    readonly position: NativeQueryVector;
    readonly rotation?: NativeQuaternion;
    readonly linearVelocity?: NativeQueryVector;
    readonly angularVelocity?: NativeQueryVector;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly color?: number;
    readonly bullet?: boolean;
    readonly sensor?: boolean;
    readonly hitEvents?: boolean;
    readonly neverSleeps?: boolean;
    readonly lockRotation?: boolean;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly filter?: {
        readonly categoryBits?: bigint;
        readonly maskBits?: bigint;
        readonly groupIndex?: number;
    };
    readonly massData?: NativeMassData;
}
```

### NativeBodyFlags · interface

A body's bullet flag, sleep settings and motion locks (the rigid-core extension).

```ts
export interface NativeBodyFlags {
    bullet: boolean;
    sleepEnabled: boolean;
    sleepThreshold: number;
    locks: {
        linearX: boolean;
        linearY: boolean;
        linearZ: boolean;
        angularX: boolean;
        angularY: boolean;
        angularZ: boolean;
    };
}
```

### NativeBodyHandle · interface

World-owned opaque reference. Not JSON checkpoint data or a dense row index.

```ts
export interface NativeBodyHandle {
    readonly token: bigint;
    readonly [BODY_OWNER]: object;
}
```

### NativeBodyKind · type

The shape kind of a body: 'box', 'sphere', 'capsule', 'hull', 'mesh', 'heightfield' or 'compound'.

```ts
export type NativeBodyKind = 'box' | 'sphere' | 'capsule' | 'hull' | 'mesh' | 'heightfield' | 'compound';
```

### NativeBodyMassState · interface

Mass, centre of mass (body frame) and inertia tensor about it, as the solver holds them.

```ts
export interface NativeBodyMassState {
    mass: number;
    center: [number, number, number];
    inertia: [number, number, number, number, number, number];
    explicit: boolean;
    shapeCount: number;
}
```

### NativeBodyShape · type

A body's shape as the native world takes it: boxes, spheres, capsules, hulls, compounds, triangle meshes and height fields, with flat number arrays.

```ts
export type NativeBodyShape = {
    readonly kind: 'box';
    readonly halfExtents: NativeQueryVector;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | 
{
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | 
{
    readonly kind: 'hull';
    readonly points: ArrayLike<number>;
} | 
{
    readonly kind: 'compound';
    readonly shapes: readonly NativeCompoundChild[];
} | 
{
    readonly kind: 'mesh';
    readonly vertices: ArrayLike<number>;
    readonly indices: ArrayLike<number>;
} | 
{
    readonly kind: 'heightfield';
    readonly heights: ArrayLike<number>;
    readonly countX: number;
    readonly countZ: number;
    readonly spacing: readonly [number, number];
};
```

### NativeBodyState · interface

A body's pose, velocities, mass, sleep state and type, read from the solver.

```ts
export interface NativeBodyState {
    position: [number, number, number];
    rotation: [number, number, number, number];
    linearVelocity: [number, number, number];
    angularVelocity: [number, number, number];
    mass: number;
    awake: boolean;
    type: NativeBodyType;
}
```

### NativeBodyType · type

'static', 'kinematic' or 'dynamic'.

```ts
export type NativeBodyType = 'static' | 'kinematic' | 'dynamic';
```

### NativeCompoundChild · interface

One shape of a compound body, placed in the body's frame.

```ts
export interface NativeCompoundChild {
    readonly shape: NativeConvexShape;
    readonly position?: NativeQueryVector;
    readonly rotation?: NativeQuaternion;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
}
```

### NativeContactStats · interface

What the solver's contact manifolds hold right now.

```ts
export interface NativeContactStats {
    pairs: number;
    points: number;
    deepestPenetration: number;
    meanPenetration: number;
    largestImpulse: number;
    totalImpulse: number;
}
```

### NativeConvexShape · type

The shapes a compound body may hold: the convex ones.

```ts
export type NativeConvexShape = {
    readonly kind: 'box';
    readonly halfExtents: NativeQueryVector;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: ArrayLike<number>;
};
```

### NativeDebugDrawOptions · interface

Layers and scales for Box3D's debug drawing; every switch defaults to off.

```ts
export interface NativeDebugDrawOptions {
    readonly joints?: boolean;
    readonly jointExtras?: boolean;
    readonly bounds?: boolean;
    readonly mass?: boolean;
    readonly contacts?: boolean;
    readonly contactNormals?: boolean;
    readonly contactForces?: boolean;
    readonly frictionForces?: boolean;
    readonly islands?: boolean;
    readonly graphColors?: boolean;
    readonly jointScale?: number;
    readonly forceScale?: number;
    readonly region?: {
        readonly min: NativeQueryVector;
        readonly max: NativeQueryVector;
    };
}
```

### NativeDebugLines · interface

Line segments: vertex pairs. `positions` holds x, y, z per vertex and `colors` r, g, b in 0..1.

```ts
export interface NativeDebugLines {
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly vertexCount: number;
    readonly truncated: boolean;
}
```

### NativeJointDescriptor · interface

Frames are local to each body. Revolute and wheel joints turn about the frame's z axis;
prismatic and wheel-suspension travel is along frame A's x axis. A null body is the fixed world.

```ts
export interface NativeJointDescriptor {
    readonly type: NativeJointType;
    readonly bodyA: NativeBodyHandle | null;
    readonly bodyB: NativeBodyHandle | null;
    readonly frameA?: NativeJointFrame;
    readonly frameB?: NativeJointFrame;
    readonly collideConnected?: boolean;
    readonly limits?: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly motor?: {
        readonly speed: number;
        readonly maxForce: number;
    };
    readonly spring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly target?: number;
    };
    readonly length?: number;
    readonly coneAngle?: number;
    readonly stiffness?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly thresholds?: NativeJointThresholds;
    readonly drive?: NativeJointDrive;
    readonly maxTorque?: number;
    readonly steering?: NativeJointSteering;
}
```

### NativeJointDetails · interface

Everything the solver holds about one joint. Fields that do not apply to the joint's type are absent.

```ts
export interface NativeJointDetails {
    type: NativeJointType;
    linearSeparation: number;
    angularSeparation: number;
    forceThreshold: number;
    torqueThreshold: number;
    breakable: boolean;
    stiffness: {
        hertz: number;
        dampingRatio: number;
    };
    angle?: number;
    motorForce?: number;
    motorTorque?: [number, number, number];
    motorSpeed?: number;
    lowerLimit?: number;
    upperLimit?: number;
    translation?: number;
    speed?: number;
    length?: number;
    restLength?: number;
    coneAngle?: number;
    coneLimit?: number;
    spinSpeed?: number;
    spinTorque?: number;
    steeringAngle?: number;
    steeringTorque?: number;
    targetSteeringAngle?: number;
    suspension?: number;
    linearVelocity?: [number, number, number];
    angularVelocity?: [number, number, number];
    springHertz?: number;
    springDampingRatio?: number;
    maxTorque?: number;
}
```

### NativeJointDrive · interface

What a motor joint does: hold a relative velocity with a bounded force, and/or pull frame B onto frame A with bounded springs.

```ts
export interface NativeJointDrive {
    readonly linearVelocity?: NativeQueryVector;
    readonly angularVelocity?: NativeQueryVector;
    readonly maxForce?: number;
    readonly maxTorque?: number;
    readonly linearSpring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly maxForce: number;
    };
    readonly angularSpring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly maxTorque: number;
    };
}
```

### NativeJointFrame · interface

A joint frame in a body's own coordinates: position and rotation, both optional.

```ts
export interface NativeJointFrame {
    readonly position?: NativeQueryVector;
    readonly rotation?: NativeQuaternion;
}
```

### NativeJointHandle · interface

World-owned opaque joint reference. A joint dies with either of its bodies.

```ts
export interface NativeJointHandle {
    readonly token: bigint;
    readonly [JOINT_OWNER]: object;
}
```

### NativeJointState · interface

A joint's type, its angle, travel or length, and the force and torque it carries.

```ts
export interface NativeJointState {
    type: NativeJointType;
    value: number;
    force: [number, number, number];
    torque: [number, number, number];
}
```

### NativeJointSteering · interface

Wheel steering: a spring that turns frame A about its x axis towards `angle` (rad) with at most `maxTorque` (N m), optionally limited.

```ts
export interface NativeJointSteering {
    readonly angle: number;
    readonly hertz: number;
    readonly dampingRatio: number;
    readonly maxTorque: number;
    readonly limits?: {
        readonly lower: number;
        readonly upper: number;
    };
}
```

### NativeJointThresholds · interface

A joint reports a 'joint-overload' event in every step in which its constraint force or torque is at or above a
threshold; with `breakable` it is destroyed at the end of that step and reports 'joint-break' instead.

```ts
export interface NativeJointThresholds {
    readonly force?: number;
    readonly torque?: number;
    readonly breakable?: boolean;
}
```

### NativeJointType · type

'weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel', 'motor', 'parallel' or 'filter'.

```ts
export type NativeJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel' | 'motor' | 'parallel' | 'filter';
```

### NativeMassData · interface

Mass, centre of mass and inertia of a body. `center` is in the body frame. `inertia` is the
tensor about the centre of mass in body axes, as [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2 (the
matrix entries, so a product of inertia is minus the integral of x y dm).

```ts
export interface NativeMassData {
    readonly mass: number;
    readonly center?: NativeQueryVector;
    readonly inertia: readonly [number, number, number, number, number, number];
}
```

### NativeMoverInput · interface

An upright capsule to move with Box3D's character mover, and which bodies it collides with.

```ts
export interface NativeMoverInput {
    readonly position: NativeQueryVector;
    readonly radius: number;
    readonly halfLength: number;
    readonly translation: NativeQueryVector;
    readonly wallBelowNormalY?: number;
    readonly iterations?: number;
    readonly tolerance?: number;
    readonly bodies?: {
        readonly static?: boolean;
        readonly kinematic?: boolean;
        readonly dynamic?: boolean;
    };
    readonly categoryBits?: bigint;
    readonly maskBits?: bigint;
    readonly ignoreBody?: NativeBodyHandle;
}
```

### NativeMoverPlane · interface

A collision plane the character mover found around the capsule.

```ts
export interface NativeMoverPlane {
    readonly normal: NativeQueryVector;
    readonly point: NativeQueryVector;
    readonly push: number;
    readonly body: NativeBodyHandle;
    readonly bodyType: NativeBodyType;
    readonly wall: boolean;
}
```

### NativeMoverResult · interface

The capsule's final position, the planes around it and the number of rounds the mover ran.

```ts
export interface NativeMoverResult {
    readonly position: [number, number, number];
    readonly planes: NativeMoverPlane[];
    readonly iterations: number;
}
```

### NativeProfileCounter · type

A size profile() reports for the most recent step: counts of bodies, contacts and the like, and memory in bytes.

```ts
export type NativeProfileCounter = typeof PROFILE_COUNTERS[number];
```

### NativeProfileStage · type

A stage of Box3D's step that profile() times, in milliseconds.

```ts
export type NativeProfileStage = typeof PROFILE_STAGES[number];
```

### NativeQuaternion · type

A rotation as a quaternion [x, y, z, w]; the bridge normalizes it.

```ts
export type NativeQuaternion = readonly [number, number, number, number];
```

### NativeQueryBodyHit · interface

One body found by an overlap query.

```ts
export interface NativeQueryBodyHit {
    readonly body: NativeBodyHandle;
}
```

### NativeQueryCastHit · interface

One hit of a ray, sphere or box cast: the body, the point and normal in world space, the fraction of the translation at which it was hit, and for meshes and compounds the triangle and child shape.

```ts
export interface NativeQueryCastHit extends NativeQueryBodyHit {
    readonly point: NativeQueryVector;
    readonly normal: NativeQueryVector;
    readonly fraction: number;
    readonly material: bigint;
    readonly triangleIndex: number;
    readonly childIndex: number;
}
```

### NativeQueryFilter · interface

Which bodies a spatial query considers: by type, by collision category and mask, and one body to ignore.

```ts
export interface NativeQueryFilter {
    readonly bodies?: 'all' | 'static' | 'dynamic' | 'none';
    readonly categoryBits?: bigint;
    readonly maskBits?: bigint;
    readonly ignoreBody?: NativeBodyHandle;
}
```

### NativeQueryResult · type

Owned copies survive subsequent queries, heap growth, resets and destruction.
A body reference can become stale after removal/reset; resolve with bodyIndex.

```ts
export type NativeQueryResult = {
    readonly totalHits: number;
    readonly overflow: boolean;
} & ({
    readonly kind: 'ray' | 'sphere-cast' | 'box-cast' | 'capsule-cast';
    readonly hits: readonly NativeQueryCastHit[];
} | {
    readonly kind: 'sphere-overlap' | 'box-overlap' | 'aabb-candidates' | 'capsule-overlap';
    readonly hits: readonly NativeQueryBodyHit[];
});
```

### NativeRayBatch · interface

One batch of closest-hit rays. Arrays are indexed by ray; a miss has fraction -1 and a null body.

```ts
export interface NativeRayBatch {
    readonly count: number;
    readonly hitCount: number;
    readonly fractions: Float32Array;
    readonly points: Float32Array;
    readonly normals: Float32Array;
    readonly triangles: Int32Array;
    readonly bodies: (NativeBodyHandle | null)[];
}
```

### NativeSpatialQuery · type

Cast translations are complete displacements, not normalized directions.
Query boxes are axis aligned. Shape overlaps include the pinned SDK's 0.0005
distance slop at its default length scale. AABB candidates are broad-phase bounds only.

```ts
export type NativeSpatialQuery = NativeQueryBase & ({
    readonly kind: 'ray';
    readonly translation: NativeQueryVector;
} | {
    readonly kind: 'sphere-cast';
    readonly translation: NativeQueryVector;
    readonly radius: number;
} | {
    readonly kind: 'box-cast';
    readonly translation: NativeQueryVector;
    readonly halfExtents: NativeQueryVector;
} | {
    readonly kind: 'sphere-overlap';
    readonly radius: number;
} | {
    readonly kind: 'box-overlap' | 'aabb-candidates';
    readonly halfExtents: NativeQueryVector;
} | 
{
    readonly kind: 'capsule-cast';
    readonly translation: NativeQueryVector;
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'capsule-overlap';
    readonly radius: number;
    readonly halfLength: number;
});
```

### NativeStepProfile · interface

Box3D's own timing of the most recent step, by stage (milliseconds), and the sizes it worked on.

```ts
export interface NativeStepProfile {
    readonly milliseconds: Readonly<Record<NativeProfileStage, number>>;
    readonly counters: Readonly<Record<NativeProfileCounter, number>>;
}
```

### NativeWorldBackend · class

Owns one generation-checked C context. Destroying it cannot reset another world.
Borrowed heap data is valid only while this context lives; read HEAPF32 again after
calls that can grow module memory. Capacity reservation may also relocate stream
offsets; ask the pointer getters again after reservation. Checkpoints are not
implemented by this adapter.

```ts
export declare class NativeWorldBackend implements PhysicsBackend {
  readonly name = "Box3D WASM \u00B7 isolated world";
  readonly isWasm = true;
  readonly handle: number;
  get HEAPF32(): Float32Array;
  get maxBodies(): number;
  _b3w_matrices_ptr(): number | bigint;
  _b3w_colors_ptr(): number | bigint;
  _b3w_body_count(): number;
  _b3w_max_bodies(): number;
  frameVersion(): number;
  colorVersion(): number;
  awakeCount(): number;
  contactCount(): number | null;
  bodyCount(): number;
  dynamicCount(): number;
  replayHash(): number;
  capacityInfo(): NativeBodyCapacityInfo;
  reserveBodyCapacity(requested: number): number;
  get supportsBodyLifecycle(): boolean;
  bodyHandle(index: number): NativeBodyHandle;
  bodyIndex(body: NativeBodyHandle): number | null;
  destroyBody(body: NativeBodyHandle): boolean;
  applyBodyImpulse(body: NativeBodyHandle, x: number, y: number, z: number): void;
  launchProjectileBody(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): NativeBodyHandle | null;
  get supportsGeneralBodies(): boolean;
  resetWorld(options?: { seed?: number; ground?: boolean; gravity?: NativeQueryVector; }): void;
  setGravity(x: number, y: number, z: number): void;
  gravity(): [number, number, number];
  createBody(descriptor: NativeBodyDescriptor): NativeBodyHandle | null;
  get supportsCompoundBodies(): boolean;
  setBodyMassData(body: NativeBodyHandle, data: NativeMassData): void;
  resetBodyMassData(body: NativeBodyHandle): void;
  bodyMassData(body: NativeBodyHandle): NativeBodyMassState;
  retainBodyShapes(enabled?: boolean): void;
  bodyShape(row: number): NativeBodyShape | null;
  bodyKinds(): NativeBodyKind[];
  shapeVersion(): number;
  shapeKinds(): Uint8Array | null;
  bodyState(body: NativeBodyHandle): NativeBodyState;
  setBodyTransform(body: NativeBodyHandle, position: NativeQueryVector, rotation?: NativeQuaternion): void;
  setBodyVelocity(body: NativeBodyHandle, linear: NativeQueryVector, angular?: NativeQueryVector): void;
  setBodyTarget(body: NativeBodyHandle, position: NativeQueryVector, rotation: NativeQuaternion, seconds: number): void;
  setBodyType(body: NativeBodyHandle, type: NativeBodyType): void;
  setBodyAwake(body: NativeBodyHandle, awake: boolean): void;
  setBodyGravityScale(body: NativeBodyHandle, scale: number): void;
  setBodyDamping(body: NativeBodyHandle, linear: number, angular: number): void;
  setBodyFilter(body: NativeBodyHandle, categoryBits: bigint, maskBits: bigint, groupIndex?: number): void;
  applyToBody(body: NativeBodyHandle, mode: 'force' | 'torque' | 'impulse' | 'angular-impulse', value: NativeQueryVector, point?: NativeQueryVector): void;
  createJoint(descriptor: NativeJointDescriptor): NativeJointHandle;
  get supportsRigidCore(): boolean;
  setJointDrive(joint: NativeJointHandle, drive: NativeJointDrive): void;
  setJointThresholds(joint: NativeJointHandle, thresholds: NativeJointThresholds | null): void;
  setJointSteeringLimits(joint: NativeJointHandle, limits: { lower: number; upper: number; } | null): void;
  setJointTargetRotation(joint: NativeJointHandle, rotation: NativeQuaternion): void;
  setJointAngularMotor(joint: NativeJointHandle, motor: { velocity: NativeQueryVector; maxTorque: number; } | null): void;
  setJointParallelSpring(joint: NativeJointHandle, spring: { hertz: number; dampingRatio: number; maxTorque: number; }): void;
  setJointConeLimit(joint: NativeJointHandle, angle: number | null): void;
  setJointCollideConnected(joint: NativeJointHandle, collide: boolean): void;
  jointDetails(joint: NativeJointHandle): NativeJointDetails;
  castRayBatch(rays: ArrayLike<number>, filter?: NativeQueryFilter): NativeRayBatch;
  moverMove(input: NativeMoverInput): NativeMoverResult;
  worldSettings(): NativeWorldSettings;
  setWorldSettings(settings: Partial<NativeWorldSettings>): void;
  setBodyBullet(body: NativeBodyHandle, bullet: boolean): void;
  setBodySleep(body: NativeBodyHandle, options: { enabled?: boolean; threshold?: number; }): void;
  setBodyMotionLocks(body: NativeBodyHandle, locks: Partial<NativeBodyFlags['locks']>): void;
  bodyFlags(body: NativeBodyHandle): NativeBodyFlags;
  explodeArea(options: { center: NativeQueryVector; radius: number; falloff?: number; impulsePerArea: number; maskBits?: bigint; }): void;
  profile(): NativeStepProfile;
  contactStats(): NativeContactStats;
  debugLines(options?: NativeDebugDrawOptions): NativeDebugLines;
  jointAlive(joint: NativeJointHandle): boolean;
  destroyJoint(joint: NativeJointHandle): boolean;
  setJointMotor(joint: NativeJointHandle, motor: { speed: number; maxForce: number; } | null): void;
  setJointLimits(joint: NativeJointHandle, limits: { lower: number; upper: number; } | null): void;
  setJointSpring(joint: NativeJointHandle, spring: { hertz: number; dampingRatio: number; target?: number; } | null): void;
  setJointStiffness(joint: NativeJointHandle, hertz: number, dampingRatio?: number): void;
  setJointSteering(joint: NativeJointHandle, steering: { angle: number; hertz: number; dampingRatio: number; maxTorque: number; } | null): void;
  jointState(joint: NativeJointHandle): NativeJointState;
  collectEvents(): { events: NativeWorldEvent[]; dropped: number; };
  containedTotal(): number;
  get supportsCheckpoints(): boolean;
  checkpoint(): Uint8Array;
  restoreCheckpoint(bytes: Uint8Array): void;
  get supportsSpatialQueries(): boolean;
  spatialQueryInfo(): { supported: boolean; maxBatch: number; maxHitsPerQuery: number; bridgeBufferBytes: number; version: number; };
  queryBatch(queries: readonly NativeSpatialQuery[]): NativeQueryResult[];
  castRays(origins: Float32Array, translations: Float32Array, fractions: Float32Array, options?: { filter?: NativeQueryFilter; points?: Float32Array; normals?: Float32Array; bodies?: BigUint64Array; }): number;
  bodyFromToken(token: bigint): NativeBodyHandle;
  createScene(scene: Pick<ScenePreset, 'id'>, stressScale: number, seed: number): number;
  step(dt: number, subSteps: number): void;
  syncTransforms(): void;
  applyImpulse(index: number, ix: number, iy: number, iz: number): void;
  kick(strength: number): void;
  explode(x: number, y: number, z: number, strength: number, radius: number): void;
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number;
  spawnRain(count: number, spread: number, height: number): number;
  clear(): void;
  destroy(): void;
}
```

### NativeWorldEvent · interface

A contact or sensor event of the most recent step. `point`, `normal` and `approachSpeed` are present on 'hit' events.

```ts
export interface NativeWorldEvent {
    readonly kind: 'contact-begin' | 'contact-end' | 'hit' | 'sensor-begin' | 'sensor-end' | 'joint-overload' | 'joint-break' | 'body-contained';
    readonly bodyA: NativeBodyHandle | null;
    readonly bodyB: NativeBodyHandle | null;
    readonly joint?: NativeJointHandle;
    readonly force?: NativeQueryVector;
    readonly torque?: NativeQueryVector;
    readonly point?: NativeQueryVector;
    readonly normal?: NativeQueryVector;
    readonly approachSpeed?: number;
    readonly speed?: number;
}
```

### NativeWorldPool · class

Owns only contexts it creates; the module's compatibility world and other pools survive.

```ts
export declare class NativeWorldPool {
  readonly capacity: number;
  get size(): number;
  createWorld(): NativeWorldBackend;
  destroy(): void;
}
```

### NativeWorldSettings · interface

World-wide solver settings. Every one is part of a checkpoint.

```ts
export interface NativeWorldSettings {
    sleeping: boolean;
    continuous: boolean;
    speculative: boolean;
    warmStarting: boolean;
    restitutionThreshold: number;
    hitEventThreshold: number;
    contactHertz: number;
    contactDampingRatio: number;
    contactPushSpeed: number;
    maximumLinearSpeed: number;
    contactRecycleDistance: number;
}
```

### packPoses · function

Pack px, py, pz, qx, qy, qz, qw per row (28 bytes instead of 64): for
transport, compact GPU layouts or engines that compose their own matrices.

```ts
export declare function packPoses(source: InstanceSource, out: Float32Array): number;
```

### pauseOnHidden · function

Reset a loop's accumulator whenever the page is hidden or shown again, so a
returning tab resumes smoothly instead of dropping a burst of catch-up time.
Accepts a PhysicsWorld (anything with `.loop`) or a FixedStepLoop. Returns an
unsubscribe function; a no-op outside the browser.

```ts
export declare function pauseOnHidden(target: FixedStepLoop | {
    readonly loop: FixedStepLoop;
}, doc?: {
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
} | undefined): () => void;
```

### PhysicsBackend · type

The minimal native backend the renderer adapters read: the instance buffers plus the stepping and scene calls of the classic arena.

```ts
export type PhysicsBackend = InstanceBufferSource & {
    readonly name: string;
    readonly isWasm: boolean;
    readonly maxBodies: number;
    createScene(scene: ScenePreset, stressScale: number, seed: number): number;
    step(dt: number, subSteps: number): void;
    syncTransforms(): void;
    kick(strength: number): void;
    explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void;
    launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number;
    spawnRain(count: number, spread: number, height: number): number;
    bodyCount(): number;
    dynamicCount(): number;
    replayHash(): number;
    destroy(): void;
};
```

### PhysicsWorld · class

Game-facing wrapper around one isolated native Box3D world.

- `update(frameSeconds)` runs a fixed-timestep loop for you.
- Bodies are opaque, generation-checked handles; a destroyed body can never
  alias a newer one. Attach your own entity with setUserData().
- `matrices()` returns column-major 4x4 float32 transforms (scaled by each
  box's half extents), ready for GPU instancing with a 2x2x2 unit box.
  `interpolatedMatrices(alpha)` blends the last two steps for smooth rendering.

```ts
export declare class PhysicsWorld {
  readonly native: NativeWorldBackend;
  readonly loop: FixedStepLoop;
  readonly subSteps: number;
  readonly seed: number;
  resetArena(seed?: number): this;
  loadPreset(id: number, stress?: number, seed?: number): number;
  reset(options?: ResetOptions): this;
  setGravity(gravity: Vec3Like): void;
  gravity(): [number, number, number];
  createBody(options: BodyOptions): Body | null;
  setMassData(body: Body, data: MassDataOptions): void;
  resetMassData(body: Body): void;
  getMassData(body: Body): BodyMassData;
  getState(body: Body): BodyState;
  setTransform(body: Body, position: Vec3Like, rotation?: QuatLike): void;
  setVelocity(body: Body, linear: Vec3Like, angular?: Vec3Like): void;
  moveKinematic(body: Body, position: Vec3Like, rotation?: QuatLike, seconds?: number): void;
  setBodyType(body: Body, type: BodyType): void;
  setAwake(body: Body, awake: boolean): void;
  setGravityScale(body: Body, scale: number): void;
  setDamping(body: Body, linear: number, angular: number): void;
  setCollisionFilter(body: Body, categoryBits: bigint, maskBits: bigint, groupIndex?: number): void;
  applyForce(body: Body, force: Vec3Like, point?: Vec3Like): void;
  applyTorque(body: Body, torque: Vec3Like): void;
  applyImpulseAt(body: Body, impulse: Vec3Like, point: Vec3Like): void;
  applyAngularImpulse(body: Body, impulse: Vec3Like): void;
  createJoint(options: JointOptions): Joint;
  isJointAlive(joint: Joint): boolean;
  destroyJoint(joint: Joint): boolean;
  setJointMotor(joint: Joint, motor: { speed: number; maxForce: number; } | null): void;
  setJointLimits(joint: Joint, limits: { lower: number; upper: number; } | null): void;
  setJointSpring(joint: Joint, spring: { hertz: number; dampingRatio: number; target?: number; } | null): void;
  setJointStiffness(joint: Joint, hertz: number, dampingRatio?: number): void;
  setJointSteering(joint: Joint, steering: { angle: number; hertz: number; dampingRatio: number; maxTorque: number; } | null): void;
  getJointState(joint: Joint): JointState;
  getJointDetails(joint: Joint): JointDetails;
  setJointDrive(joint: Joint, options: JointDrive): void;
  setJointThresholds(joint: Joint, thresholds: JointThresholds | null): void;
  setJointSteeringLimits(joint: Joint, limits: { lower: number; upper: number; } | null): void;
  setJointTargetRotation(joint: Joint, rotation: QuatLike): void;
  setJointAngularMotor(joint: Joint, motor: { velocity: Vec3Like; maxTorque: number; } | null): void;
  setJointParallelSpring(joint: Joint, spring: { hertz: number; dampingRatio: number; maxTorque: number; }): void;
  setJointConeLimit(joint: Joint, angle: number | null): void;
  setJointCollideConnected(joint: Joint, collide: boolean): void;
  settings(): WorldSettings;
  configure(settings: Partial<WorldSettings>): void;
  setBullet(body: Body, bullet: boolean): void;
  setSleep(body: Body, options: { enabled?: boolean; threshold?: number; }): void;
  setMotionLocks(body: Body, locks: Partial<BodyFlags['locks']>): void;
  getBodyFlags(body: Body): BodyFlags;
  explodeArea(options: { center: Vec3Like; radius: number; falloff?: number; impulsePerArea: number; maskBits?: bigint; }): void;
  profile(): StepProfile;
  contactStats(): ContactStats;
  debugLines(options?: DebugDrawOptions): DebugDrawLines;
  onEvent(listener: (event: WorldEvent) => void): () => void;
  get droppedEvents(): number;
  bodyKinds(): BodyKind[];
  spawnBox(options: SpawnBoxOptions): Body | null;
  isAlive(body: Body): boolean;
  destroyBody(body: Body): boolean;
  applyImpulse(body: Body, impulseLike: Vec3Like): void;
  explode(centerLike: Vec3Like, strength: number, radius: number): void;
  setUserData(body: Body, value: unknown): void;
  getUserData<T = unknown>(body: Body): T | undefined;
  bodyAt(row: number): Body;
  step(): void;
  update(frameSeconds: number): FixedStepResult;
  onStep(listener: (tick: number) => void): () => void;
  interpolatedMatrices(alpha: number): Float32Array;
  raycast(origin: Vec3Like, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  castRays(origins: Float32Array, translations: Float32Array, fractions: Float32Array, options?: { readonly filter?: NativeQueryFilter; readonly points?: Float32Array; readonly normals?: Float32Array; readonly bodies?: (Body | null)[]; }): number;
  sphereCast(origin: Vec3Like, radius: number, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  boxCast(origin: Vec3Like, halfExtents: Vec3Like, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  capsuleCast(origin: Vec3Like, radius: number, halfLength: number, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  raycastAll(origin: Vec3Like, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit[];
  raycastBatch(rays: ArrayLike<number>, filter?: NativeQueryFilter): RayBatch;
  overlapCapsule(center: Vec3Like, radius: number, halfLength: number, options?: QueryOptions): Body[];
  moveCapsule(options: CapsuleMoveOptions): CapsuleMoveResult;
  overlapSphere(center: Vec3Like, radius: number, options?: QueryOptions | number): Body[];
  overlapBox(center: Vec3Like, halfExtents: Vec3Like, options?: QueryOptions): Body[];
  getPose(body: Body, out?: BodyPose): BodyPose | null;
  matrices(): Float32Array;
  colors(): Float32Array;
  bodyCount(): number;
  awakeCount(): number;
  get threading(): Box3DThreading;
  get tick(): number;
  replayHash(): number;
  exactHash(): number;
  transformVersion(): number;
  colorVersion(): number;
  stats(): WorldStats;
  diagnose(): DiagnosticFinding[];
  startRecording(options?: RecordingOptions): void;
  jointDefaults(): { hertz: number; dampingRatio: number; } | null;
  contactDefaults(): { contactHertz: number; contactDampingRatio: number; contactPushSpeed: number; } | null;
  stopRecording(): ReplayLog;
  get isRecording(): boolean;
  checkpoint(): Uint8Array;
  restoreCheckpoint(bytes: Uint8Array): void;
  replay(log: ReplayLog): boolean;
  replayDetailed(log: ReplayLog): ReplayReport;
  dispose(): void;
}
```

### PoseArrays · interface

Structure-of-arrays poses for entity-component systems: positions, rotations and optionally half extents, one row per body.

```ts
export interface PoseArrays {
    readonly positions: Float32Array;
    readonly rotations: Float32Array;
    readonly halfExtents?: Float32Array;
}
```

### QuatLike · type

Unit quaternion as [x, y, z, w] or {x, y, z, w} (a three.js Quaternion works).

```ts
export type QuatLike = readonly [number, number, number, number] | {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
};
```

### QueryOptions · interface

Options of the casts and overlaps: which bodies to consider and how many hits to return.

```ts
export interface QueryOptions {
    readonly filter?: NativeQueryFilter;
    readonly limit?: number;
}
```

### RayBatch · type

Results of PhysicsWorld.raycastBatch(): flat arrays indexed by ray; a miss has fraction -1 and a null body.

```ts
export type RayBatch = NativeRayBatch;
```

### RaycastOptions · type

The old name of QueryOptions.

```ts
export type RaycastOptions = QueryOptions;
```

### rayLine · function

A query ray as one segment, ending at the hit point when there was a hit
(pass the result of raycast/sphereCast/boxCast).

```ts
export declare function rayLine(origin: readonly [number, number, number], translation: readonly [number, number, number], hit?: {
    readonly fraction: number;
} | null): DebugLines;
```

### readBodyPoses · function

ECS style: poses for a list of entities' bodies, in the list's order, into
component arrays indexed like `bodies`. Destroyed bodies are skipped and
reported in the returned count of live bodies; their slots are left as is.

```ts
export declare function readBodyPoses(world: PhysicsWorld, bodies: readonly (Body | null)[], out: PoseArrays): number;
```

### readPoses · function

Fill structure-of-arrays pose buffers for every instance row. Returns the row count written.

```ts
export declare function readPoses(source: InstanceSource, out: PoseArrays): number;
```

### RecordingOptions · interface

Options of startRecording(): how often to record a state hash, and whether to start from an SI world.

```ts
export interface RecordingOptions {
    readonly checkpointEvery?: number;
    readonly world?: {
        readonly ground?: boolean;
        readonly gravity?: Vec3Like;
    };
}
```

### ReplayCommand · type

One recorded action of a ReplayLog, with the tick it happened at. Bodies are named by render row and joints by creation order, so that a log replays in any world.

```ts
export type ReplayCommand = {
    readonly t: number;
    readonly op: 'spawnBox';
    readonly position: Vec3;
    readonly halfSize: number;
    readonly impulse: Vec3;
} | {
    readonly t: number;
    readonly op: 'destroyBody';
    readonly row: number;
} | {
    readonly t: number;
    readonly op: 'applyImpulse';
    readonly row: number;
    readonly impulse: Vec3;
} | {
    readonly t: number;
    readonly op: 'explode';
    readonly center: Vec3;
    readonly strength: number;
    readonly radius: number;
}
| {
    readonly t: number;
    readonly op: 'call';
    readonly method: string;
    readonly args: readonly unknown[];
};
```

### ReplayLog · interface

Everything needed to reproduce a session bit-for-bit on the same WASM build. JSON-serializable.

```ts
export interface ReplayLog {
    readonly version: 1 | 2;
    readonly world?: {
        readonly ground: boolean;
        readonly gravity: Vec3;
    };
    readonly seed: number;
    readonly step: number;
    readonly subSteps: number;
    readonly ticks: number;
    readonly commands: readonly ReplayCommand[];
    readonly finalHash: number;
    readonly checkpoints?: readonly (readonly [number, number])[];
}
```

### ReplayReport · interface

The result of replayDetailed(): whether the replay matched the recording and, if not, between which ticks it first differed.

```ts
export interface ReplayReport {
    readonly matches: boolean;
    readonly divergence: {
        readonly from: number;
        readonly to: number;
    } | null;
    readonly finalHash: number;
    readonly checkpointsCompared: number;
}
```

### ResetOptions · interface

What reset() starts the empty world with: the ground slab, gravity and the seed.

```ts
export interface ResetOptions {
    readonly ground?: boolean;
    readonly gravity?: Vec3Like;
    readonly seed?: number;
}
```

### RIGID_LIMITS · const

The largest magnitudes the rigid world takes (the scene format checks the same table). The solver holds single-precision numbers, and products of these
(speed squared times mass, force over mass times a time step) must stay below 3.4e38, or a step yields infinities
and then NaN in every body they touch. Each limit is far beyond physical use in a world 100 km wide; a value above
one is refused with INVALID_PAYLOAD and the world is unchanged (docs/ERRORS.md, "Accepted ranges").

```ts
export declare const RIGID_LIMITS: Readonly<{
    extent: 100000;
    shape: 1000;
    speed: 1000000;
    gravity: 1000000;
    force: 1000000000000;
    density: 1000000;
    densityMin: 0.001;
    massMin: 1e-12;
    massMax: 10000000000000000;
    hertz: 1000000;
}>;
```

### SavedSession · interface

A replay log together with the identity of the build that recorded it, as saveSession() writes it. loadSession() refuses one from another build.

```ts
export interface SavedSession {
    readonly format: 'box3d-kit-session';
    readonly version: 1;
    readonly kitVersion: string;
    readonly nativeApiVersion: number;
    readonly wasmSha256: string;
    readonly savedAt: string;
    readonly log: ReplayLog;
}
```

### saveSession · function

Wrap a finished recording (world.stopRecording()) in a versioned, self-describing envelope. JSON-safe.

```ts
export declare function saveSession(log: ReplayLog, savedAt?: string): SavedSession;
```

### SchedulableWorld · interface

Anything a WorldScheduler can drive: an object with update(frameSeconds).

```ts
export interface SchedulableWorld {
    update(frameSeconds: number): FixedStepResult;
}
```

### SchedulerFrame · interface

What one scheduler frame did: worlds updated, worlds deferred to the next frame, steps taken and milliseconds spent.

```ts
export interface SchedulerFrame {
    readonly updated: number;
    readonly deferred: number;
    readonly steps: number;
    readonly elapsedMs: number;
}
```

### SchedulerOptions · interface

The time budget of one scheduler frame and its clock.

```ts
export interface SchedulerOptions {
    readonly budgetMs?: number;
    readonly now?: () => number;
}
```

### ShapeOptions · type

The shape of a body: a box, sphere, capsule or convex hull, a compound of those, or static scenery (a triangle mesh or a height field). Sizes in metres.

```ts
export type ShapeOptions = {
    readonly kind: 'box';
    readonly halfExtents: Vec3Like;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'hull';
    readonly points: ArrayLike<number>;
}
| {
    readonly kind: 'compound';
    readonly shapes: readonly CompoundShapeOptions[];
}
| {
    readonly kind: 'mesh';
    readonly vertices: ArrayLike<number>;
    readonly indices: ArrayLike<number>;
}
| {
    readonly kind: 'heightfield';
    readonly heights: ArrayLike<number>;
    readonly countX: number;
    readonly countZ: number;
    readonly spacing: readonly [number, number];
};
```

### SharedFrameReader · class

The reading side of a shared frame buffer: update() takes the newest complete frame and reports whether anything changed.

```ts
export declare class SharedFrameReader {
  readonly capacity: number;
  count: number;
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  revision: number;
  colorRevision: number;
  poll(): boolean;
}
```

### SharedFrameWriter · class

The writing side of a SharedArrayBuffer that carries a world's instance transforms and colours from a worker to the page without copying through messages.

```ts
export declare class SharedFrameWriter {
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  publish(matrices: Float32Array, count: number, colors: Float32Array, colorVersion: number): void;
}
```

### sharedMemoryAvailable · function

True when SharedArrayBuffer can be used here (in a browser, when the page is cross-origin isolated).

```ts
export declare function sharedMemoryAvailable(): boolean;
```

### SnapshotDecoder · class

Client side. Apply snapshots in order; it is an InstanceSource for the three.js adapter and writeInstances.

```ts
export declare class SnapshotDecoder implements InstanceSource {
  color: readonly [number, number, number, number];
  apply(bytes: Uint8Array): void;
  bodyCount(): number;
  transformVersion(): number;
  colorVersion(): number;
  matrices(): Float32Array;
  colors(): Float32Array;
}
```

### SnapshotEncoder · class

Server side. One encoder per client connection (each tracks what that client has).

```ts
export declare class SnapshotEncoder {
  encode(source: InstanceSource, options?: { keyframe?: boolean; }): Uint8Array;
}
```

### spawnBoxes · function

Spawn one cube per xyz triple in `positions`. Returns the handles (null
where capacity ran out). Validation and the WASM boundary are still crossed
per body; a native batched export is ENGINE item #46's remaining work.

```ts
export declare function spawnBoxes(world: PhysicsWorld, positions: ArrayLike<number>, options?: {
    halfSize?: number;
    impulses?: ArrayLike<number>;
}): (Body | null)[];
```

### SpawnBoxOptions · interface

What spawnBox() takes: where the cube appears, its half size and an initial impulse.

```ts
export interface SpawnBoxOptions {
    readonly position: Vec3Like;
    readonly halfSize?: number;
    readonly impulse?: Vec3Like;
}
```

### StepProfile · type

Box3D's timing of the most recent step by stage (ms) and the sizes it worked on; see PhysicsWorld.profile().

```ts
export type StepProfile = NativeStepProfile;
```

### toBox3DFrame · function

Convert one point or direction from the target frame back to Box3D's Y-up frame.

```ts
export declare function toBox3DFrame(v: readonly [number, number, number], up?: UpAxis): [number, number, number];
```

### toQuat · function

Normalize any QuatLike to a fresh tuple.

```ts
export declare function toQuat(value: QuatLike): [number, number, number, number];
```

### toVec3 · function

Normalize any Vec3Like to a fresh tuple.

```ts
export declare function toVec3(value: Vec3Like): [number, number, number];
```

### UpAxis · type

Units and axes contract: Box3D works in metres, kilograms and seconds in a
right-handed, Y-up frame (gravity is -10 m/s² along Y). Engines such as
Blender, Unreal-style pipelines and many CAD tools are Z-up; convert at the
render boundary instead of changing the simulation.

```ts
export type UpAxis = 'y' | 'z';
```

### UploadRange · interface

Rows written by the most recent writeInstances call (for profiling).

```ts
export interface UploadRange {
    readonly firstRow: number;
    readonly rows: number;
}
```

### Vec3 · type

Three numbers [x, y, z]: a position or displacement in metres, a velocity in m/s, a force in newtons, as the method says.

```ts
export type Vec3 = readonly [number, number, number];
```

### Vec3Like · type

A tuple, a plain {x, y, z} object or a three.js Vector3: all accepted wherever a vector is taken.

```ts
export type Vec3Like = Vec3 | {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### WorldEvent · type

A contact or sensor event of one step: kind ('contact-begin', 'contact-end', 'hit', 'sensor-begin', 'sensor-end'), the two bodies and, for a hit, the point, normal and approach speed.

```ts
export type WorldEvent = NativeWorldEvent;
```

### WorldOptions · interface

How a world steps: the fixed step and the most steps per update() (FixedStepOptions), the sub-steps, the seed, the body capacity, interpolation and strict mode.

```ts
export interface WorldOptions extends FixedStepOptions {
    readonly subSteps?: number;
    readonly seed?: number;
    readonly capacity?: number;
    readonly interpolate?: boolean;
    readonly strict?: boolean;
    readonly jointStiffness?: 'match-substeps' | {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly contactStiffness?: 'match-substeps' | {
        readonly hertz?: number;
        readonly dampingRatio?: number;
        readonly pushSpeed?: number;
    };
}
```

### WorldScheduler · class

Steps many worlds within a time budget per frame. Worlds that did not fit are deferred, keep the time they are owed and go first in the next frame, so none starves.

```ts
export declare class WorldScheduler<W extends SchedulableWorld = SchedulableWorld> {
  readonly budgetMs: number;
  add(world: W): this;
  remove(world: W): boolean;
  get size(): number;
  owedSeconds(world: W): number;
  update(frameSeconds: number): SchedulerFrame;
}
```

### WorldSettings · type

World-wide solver settings; see PhysicsWorld.configure().

```ts
export type WorldSettings = NativeWorldSettings;
```

### WorldStats · interface

Counts and timings of a world, from stats(): cheap enough to read every frame.

```ts
export interface WorldStats {
    readonly bodies: number;
    readonly awake: number;
    readonly contacts: number | null;
    readonly capacity: number;
    readonly tick: number;
    readonly lastStepMs: number;
    readonly lastUpdateMs: number;
    readonly droppedSeconds: number;
    readonly nonFiniteSince: number | null;
    readonly contained: number;
}
```

### writeInstances · function

Write `bodyCount()` column-major mat4x4<f32> (64 bytes each) into `buffer`.
Skips the upload when nothing moved since the last call for this buffer.
Returns the instance count to draw; instances beyond the buffer are dropped.

  const count = writeInstances(world, device.queue, instanceBuffer, {alpha});
  pass.draw(36, count);

```ts
export declare function writeInstances(source: InstanceSource, queue: GpuQueueLike, buffer: GpuBufferLike, options?: WriteInstancesOptions): number;
```

### WriteInstancesOptions · interface

Options of writeInstances(): the byte offset in the GPU buffer, interpolation, and whether to upload only when the transforms changed.

```ts
export interface WriteInstancesOptions {
    readonly offset?: number;
    readonly alpha?: number;
    readonly up?: UpAxis;
    readonly colorBuffer?: GpuBufferLike;
    readonly colorOffset?: number;
    readonly changedRowsOnly?: boolean;
}
```

## `box3d-webgpu-kit/three`

### createBodyMesh · function

Create an InstancedMesh sized to the world's body capacity. Box3D writes
matrices scaled by half extents, so the geometry is a 2x2x2 unit box.

```ts
export declare function createBodyMesh<M extends InstancedMeshLike = InstancedMeshLike>(THREE: ThreeLike, source: InstanceSource, material?: unknown, capacity?: number): M;
```

### createShapeMeshes · function

Meshes for a world that mixes boxes, spheres and capsules (createBody).
A capsule is drawn exactly, as an open cylinder plus two spheres, so any
radius and length renders correctly from the same three instanced meshes.
Call syncShapeMeshes() every frame. For a boxes-only world createBodyMesh()
is cheaper.

```ts
export declare function createShapeMeshes<G = unknown>(THREE: ShapeThreeLike, source: InstanceSource, material?: unknown, capacity?: number): ShapeMeshes<G>;
```

### InstancedMeshLike · interface

```ts
export interface InstancedMeshLike {
    count: number;
    instanceMatrix: BufferAttributeLike;
    instanceColor: BufferAttributeLike | null;
}
```

### InstanceSource · interface

Anything that streams box instances: PhysicsWorld, or RemoteWorld from ./worker.

```ts
export interface InstanceSource {
    bodyCount(): number;
    transformVersion(): number;
    colorVersion(): number;
    matrices(): Float32Array;
    colors(): Float32Array;
    interpolatedMatrices?(alpha: number): Float32Array;
    readonly capacity?: number;
    readonly native?: {
        readonly maxBodies: number;
    };
    bodyKinds?(): readonly string[];
}
```

### ShapeMeshes · interface

One InstancedMesh per primitive; add `group` to your scene.

```ts
export interface ShapeMeshes<G = unknown> {
    readonly group: G;
    readonly boxes: InstancedMeshLike;
    readonly spheres: InstancedMeshLike;
    readonly cylinders: InstancedMeshLike;
}
```

### syncInstancedMesh · function

Copy transforms (and colors when they changed) into the mesh. Cheap to call
every frame: it skips the copy when nothing moved and alpha is unchanged.
Returns the number of instances drawn.

```ts
export declare function syncInstancedMesh(source: InstanceSource, mesh: InstancedMeshLike, options?: SyncOptions): number;
```

### SyncOptions · interface

```ts
export interface SyncOptions {
    readonly alpha?: number;
}
```

### syncShapeMeshes · function

Copy transforms and colors into the three meshes. Skips the work when nothing changed. Returns the body count drawn.

```ts
export declare function syncShapeMeshes(source: InstanceSource, meshes: ShapeMeshes, options?: SyncOptions): number;
```

## `box3d-webgpu-kit/babylon`

### BabylonSyncOptions · interface

```ts
export interface BabylonSyncOptions {
    readonly alpha?: number;
    readonly rightHanded?: boolean;
}
```

### bindThinInstances · function

Bind a mesh (a 2x2x2 box, e.g. MeshBuilder.CreateBox('b', {size: 2})) to a
source and allocate its thin-instance buffers for `capacity` bodies.

```ts
export declare function bindThinInstances(source: InstanceSource, mesh: ThinInstanceMeshLike, capacity?: number): void;
```

### syncThinInstances · function

Copy the latest (or interpolated) transforms into the mesh's thin instances. Returns the drawn count.

```ts
export declare function syncThinInstances(source: InstanceSource, mesh: ThinInstanceMeshLike, options?: BabylonSyncOptions): number;
```

### ThinInstanceMeshLike · interface

Structural subset of a Babylon Mesh used for thin instances.

```ts
export interface ThinInstanceMeshLike {
    thinInstanceSetBuffer(kind: string, buffer: Float32Array | null, stride?: number, staticBuffer?: boolean): void;
    thinInstanceBufferUpdated(kind: string): void;
    thinInstanceCount: number;
}
```

## `box3d-webgpu-kit/worker`

### connectWorld · function

Connect to a worker running serveWorld() and create its world.

```ts
export declare function connectWorld(endpoint: MessageEndpoint, options?: RemoteWorldOptions): Promise<RemoteWorld>;
```

### MessageEndpoint · interface

Worker, DedicatedWorkerGlobalScope, MessagePort, or Node worker_threads Worker/parentPort.

```ts
export interface MessageEndpoint {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    addEventListener?(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
    on?(type: 'message', listener: (data: unknown) => void): void;
    terminate?(): unknown;
}
```

### RemoteBody · interface

```ts
export interface RemoteBody {
    readonly token: bigint;
}
```

### RemoteCapsuleMoveOptions · type

PhysicsWorld.moveCapsule() options for a RemoteWorld: the ignored body is a RemoteBody.

```ts
export type RemoteCapsuleMoveOptions = Omit<CapsuleMoveOptions, 'ignoreBody'> & {
    readonly ignoreBody?: RemoteBody;
};
```

### RemoteCapsuleMoveResult · interface

What RemoteWorld.moveCapsule() resolves to: as CapsuleMoveResult, with remote bodies.

```ts
export interface RemoteCapsuleMoveResult {
    readonly position: [number, number, number];
    readonly iterations: number;
    readonly planes: {
        readonly normal: Vec3;
        readonly point: Vec3;
        readonly push: number;
        readonly body: RemoteBody;
        readonly bodyType: BodyType;
        readonly wall: boolean;
    }[];
}
```

### RemoteCastHit · interface

```ts
export interface RemoteCastHit {
    readonly body: RemoteBody;
    readonly point: Vec3;
    readonly normal: Vec3;
    readonly fraction: number;
}
```

### RemoteFrame · interface

```ts
export interface RemoteFrame {
    readonly steps: number;
    readonly alpha: number;
    readonly droppedSeconds: number;
    readonly bodies: number;
}
```

### RemoteJoint · interface

```ts
export interface RemoteJoint {
    readonly token: bigint;
}
```

### RemoteJointOptions · type

JointOptions with the bodies as remote handles.

```ts
export type RemoteJointOptions = Omit<JointOptions, 'bodyA' | 'bodyB'> & {
    readonly bodyA: RemoteBody | null;
    readonly bodyB: RemoteBody | null;
};
```

### RemoteQueryFilter · type

A query filter with the ignored body as a remote handle.

```ts
export type RemoteQueryFilter = Omit<NativeQueryFilter, 'ignoreBody'> & {
    readonly ignoreBody?: RemoteBody;
};
```

### RemoteRayBatch · interface

raycastBatch() results with the bodies as remote handles.

```ts
export interface RemoteRayBatch {
    readonly count: number;
    readonly hitCount: number;
    readonly fractions: Float32Array;
    readonly points: Float32Array;
    readonly normals: Float32Array;
    readonly triangles: Int32Array;
    readonly bodies: (RemoteBody | null)[];
}
```

### RemoteWorld · class

Main-thread proxy for a worker-hosted world. Every call is async; transforms are cached per frame.

```ts
export declare class RemoteWorld implements InstanceSource {
  capacity: number;
  step: number;
  get usesSharedMemory(): boolean;
  init(options: RemoteWorldOptions): Promise<this>;
  bodyCount(): number;
  transformVersion(): number;
  colorVersion(): number;
  matrices(): Float32Array;
  colors(): Float32Array;
  bodyKinds(): readonly BodyKind[];
  start(hz?: number): Promise<void>;
  stop(): Promise<void>;
  update(frameSeconds: number): Promise<RemoteFrame>;
  stepOnce(): Promise<void>;
  spawnBox(options: SpawnBoxOptions): Promise<RemoteBody | null>;
  destroyBody(body: RemoteBody): Promise<boolean>;
  isAlive(body: RemoteBody): Promise<boolean>;
  applyImpulse(body: RemoteBody, impulse: Vec3Like): Promise<void>;
  explode(center: Vec3Like, strength: number, radius: number): Promise<void>;
  getPose(body: RemoteBody): Promise<BodyPose | null>;
  bodyAt(row: number): Promise<RemoteBody>;
  raycast(origin: Vec3Like, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null>;
  sphereCast(origin: Vec3Like, radius: number, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null>;
  boxCast(origin: Vec3Like, halfExtents: Vec3Like, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null>;
  overlapSphere(center: Vec3Like, radius: number, options?: QueryOptions): Promise<RemoteBody[]>;
  overlapBox(center: Vec3Like, halfExtents: Vec3Like, options?: QueryOptions): Promise<RemoteBody[]>;
  resetArena(seed?: number): Promise<void>;
  reset(options?: ResetOptions): Promise<void>;
  setGravity(gravity: Vec3Like): Promise<void>;
  gravity(): Promise<[number, number, number]>;
  createBody(options: BodyOptions): Promise<RemoteBody | null>;
  getState(body: RemoteBody): Promise<BodyState>;
  setMassData(body: RemoteBody, data: MassDataOptions): Promise<void>;
  resetMassData(body: RemoteBody): Promise<void>;
  getMassData(body: RemoteBody): Promise<BodyMassData>;
  setTransform(body: RemoteBody, position: Vec3Like, rotation?: QuatLike): Promise<void>;
  setVelocity(body: RemoteBody, linear: Vec3Like, angular?: Vec3Like): Promise<void>;
  moveKinematic(body: RemoteBody, position: Vec3Like, rotation?: QuatLike, seconds?: number): Promise<void>;
  setBodyType(body: RemoteBody, type: BodyType): Promise<void>;
  setAwake(body: RemoteBody, awake: boolean): Promise<void>;
  setGravityScale(body: RemoteBody, scale: number): Promise<void>;
  setDamping(body: RemoteBody, linear: number, angular: number): Promise<void>;
  setCollisionFilter(body: RemoteBody, categoryBits: bigint, maskBits: bigint, groupIndex?: number): Promise<void>;
  applyForce(body: RemoteBody, force: Vec3Like, point?: Vec3Like): Promise<void>;
  applyTorque(body: RemoteBody, torque: Vec3Like): Promise<void>;
  applyImpulseAt(body: RemoteBody, impulse: Vec3Like, point: Vec3Like): Promise<void>;
  applyAngularImpulse(body: RemoteBody, impulse: Vec3Like): Promise<void>;
  createJoint(options: RemoteJointOptions): Promise<RemoteJoint>;
  destroyJoint(joint: RemoteJoint): Promise<boolean>;
  isJointAlive(joint: RemoteJoint): Promise<boolean>;
  setJointMotor(joint: RemoteJoint, motor: { speed: number; maxForce: number; } | null): Promise<void>;
  setJointLimits(joint: RemoteJoint, limits: { lower: number; upper: number; } | null): Promise<void>;
  setJointSpring(joint: RemoteJoint, spring: { hertz: number; dampingRatio: number; target?: number; } | null): Promise<void>;
  setJointStiffness(joint: RemoteJoint, hertz: number, dampingRatio?: number): Promise<void>;
  setJointSteering(joint: RemoteJoint, steering: { angle: number; hertz: number; dampingRatio: number; maxTorque: number; } | null): Promise<void>;
  getJointState(joint: RemoteJoint): Promise<JointState>;
  getJointDetails(joint: RemoteJoint): Promise<JointDetails>;
  setJointDrive(joint: RemoteJoint, drive: JointDrive): Promise<void>;
  setJointThresholds(joint: RemoteJoint, thresholds: JointThresholds | null): Promise<void>;
  setJointSteeringLimits(joint: RemoteJoint, limits: { lower: number; upper: number; } | null): Promise<void>;
  setJointTargetRotation(joint: RemoteJoint, rotation: QuatLike): Promise<void>;
  setJointAngularMotor(joint: RemoteJoint, motor: { velocity: Vec3Like; maxTorque: number; } | null): Promise<void>;
  setJointParallelSpring(joint: RemoteJoint, spring: { hertz: number; dampingRatio: number; maxTorque: number; }): Promise<void>;
  setJointConeLimit(joint: RemoteJoint, angle: number | null): Promise<void>;
  setJointCollideConnected(joint: RemoteJoint, collide: boolean): Promise<void>;
  settings(): Promise<WorldSettings>;
  configure(settings: Partial<WorldSettings>): Promise<void>;
  setBullet(body: RemoteBody, bullet: boolean): Promise<void>;
  setSleep(body: RemoteBody, options: { enabled?: boolean; threshold?: number; }): Promise<void>;
  setMotionLocks(body: RemoteBody, locks: Partial<BodyFlags['locks']>): Promise<void>;
  getBodyFlags(body: RemoteBody): Promise<BodyFlags>;
  explodeArea(options: { center: Vec3Like; radius: number; falloff?: number; impulsePerArea: number; maskBits?: bigint; }): Promise<void>;
  profile(): Promise<StepProfile>;
  contactStats(): Promise<ContactStats>;
  debugLines(options?: DebugDrawOptions): Promise<DebugDrawLines>;
  capsuleCast(origin: Vec3Like, radius: number, halfLength: number, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null>;
  raycastAll(origin: Vec3Like, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit[]>;
  overlapCapsule(center: Vec3Like, radius: number, halfLength: number, options?: QueryOptions): Promise<RemoteBody[]>;
  raycastBatch(rays: ArrayLike<number>, filter?: RemoteQueryFilter): Promise<RemoteRayBatch>;
  moveCapsule(options: RemoteCapsuleMoveOptions): Promise<RemoteCapsuleMoveResult>;
  takeEvents(): Promise<{ events: RemoteWorldEvent[]; dropped: number; }>;
  loadPreset(id: number, stress?: number, seed?: number): Promise<number>;
  stats(): Promise<WorldStats>;
  checkpoint(): Promise<Uint8Array>;
  restoreCheckpoint(bytes: Uint8Array): Promise<void>;
  exactHash(): Promise<number>;
  replayHash(): Promise<number>;
  startRecording(options?: RecordingOptions): Promise<void>;
  stopRecording(): Promise<ReplayLog>;
  replay(log: ReplayLog): Promise<boolean>;
  replayDetailed(log: ReplayLog): Promise<ReplayReport>;
  setUserData(body: RemoteBody, value: unknown): void;
  getUserData<T = unknown>(body: RemoteBody): T | undefined;
  dispose(): Promise<void>;
}
```

### RemoteWorldEvent · type

A WorldEvent with the bodies and the joint as remote handles.

```ts
export type RemoteWorldEvent = Omit<WorldEvent, 'bodyA' | 'bodyB' | 'joint'> & {
    readonly bodyA: RemoteBody | null;
    readonly bodyB: RemoteBody | null;
    readonly joint?: RemoteJoint;
};
```

### RemoteWorldOptions · type

```ts
export type RemoteWorldOptions = WorldOptions & Omit<LoadBox3DOptions, 'factory' | 'wasmBinary'> & {
    readonly interpolateFrames?: boolean;
    readonly sharedMemory?: boolean | 'auto';
    readonly gravity?: readonly [number, number, number];
    readonly ground?: boolean;
};
```

### serveWorld · function

Host one world inside a worker. Call once in the worker's module scope.

```ts
export declare function serveWorld(endpoint: MessageEndpoint): void;
```

## `box3d-webgpu-kit/cable`

### CableCheckpoint · interface

```ts
export interface CableCheckpoint {
    format: 'box3d-compliant-cable';
    version: 1 | 2;
    backend: CableBackend;
    definition: {
        config: CableConfig;
        positions: number[];
        masses: number[];
        pinned: number[];
        constraints: CableConstraint[];
    };
    state: {
        tick: number;
        positions: number[];
        velocities: number[];
        forces: number[];
        multipliers: number[];
        externalWork: number;
        dragDissipation: number;
        maxResidual: number;
        maxImplicitForceResidual: number;
        unconvergedSubsteps: number;
        maxIterationsUsed: number;
        constraintProjections: number;
        residualEvaluations: number;
        maxConstraintForceResidual?: number;
        vectorMultipliers?: number[];
        impulses?: {
            support: number[];
            applied: [number, number, number];
            drag: [number, number, number];
        };
    };
}
```

### CableCommand · interface

```ts
export interface CableCommand extends FixedTickCommand {
    type: 'force' | 'impulse';
    node: number;
    value: readonly [number, number, number];
}
```

### CableConfig · interface

```ts
export interface CableConfig {
    dt: number;
    substeps: number;
    maxIterations: number;
    residualTolerance: number; drag: number;
    gravity: readonly [number, number, number]; solver?: 'proximal' | 'newton'; forceTolerance?: number;
}
```

### CableConstraint · interface

```ts
export interface CableConstraint {
    a: number;
    b: number;
    restLength: number; compliance: number;
}
```

### CableDefinition · interface

```ts
export interface CableDefinition {
    config: CableConfig;
    positions: ArrayLike<number>;
    masses: ArrayLike<number>;
    pinned?: ArrayLike<number>;
    velocities?: ArrayLike<number>;
    forces?: ArrayLike<number>;
    constraints: readonly CableConstraint[];
}
```

### CableDiagnostics · interface

```ts
export interface CableDiagnostics {
    time: number;
    mass: number;
    kineticEnergy: number;
    elasticEnergy: number;
    gravitationalEnergy: number;
    externalWork: number;
    dragDissipation: number;
    momentum: [number, number, number];
    maxStrain: number;
    maxTension: number;
    maxResidual: number;
    maxImplicitForceResidual: number;
    unconvergedSubsteps: number;
    maxIterationsUsed: number;
    constraintProjections: number;
    residualEvaluations: number;
    maxConstraintForceResidual?: number;
}
```

### CableSnapshot · interface

```ts
export interface CableSnapshot {
    backend: CableBackend;
    tick: number;
    positions: Float64Array;
    velocities: Float64Array;
    tensions: Float64Array;
    supportReactions: Float64Array;
    diagnostics: CableDiagnostics;
    impulses?: {
        support: Float64Array;
        applied: [number, number, number];
        drag: [number, number, number];
    };
}
```

### CableStepRequest · type

```ts
export type CableStepRequest = FixedTickStep<CableCommand>;
```

### COMPLIANT_CABLE_BACKEND · const

```ts
export declare const COMPLIANT_CABLE_BACKEND = "cable-xpbd-js-f64-v1";
```

### CompliantCableRuntime · class

```ts
export declare class CompliantCableRuntime implements EngineRuntime<CableStepRequest, CableSnapshot> {
  readonly capabilities: EngineCapabilities;
  readonly config: CableConfig;
  readonly backend: CableBackend;
  get tick(): number;
  step(request: CableStepRequest): CableSnapshot;
  releaseLink(index: number): void;
  isReleased(index: number): boolean;
  coupleNodes(nodes: Int32Array, stiffness: Float64Array, targets: Float64Array, positions: Float64Array, velocities: Float64Array, version: number): void;
  coupledForce: Float64Array<ArrayBuffer>;
  advance(): void;
  couplingViews(): { positions: Float64Array; velocities: Float64Array; masses: Float64Array; pinned: Uint8Array; };
  driveNode(node: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, mass: number, fx: number, fy: number, fz: number): void;
  inspect(): CableSnapshot;
  checkpoint(): CableCheckpoint;
  static fromCheckpoint(value: unknown): CompliantCableRuntime;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  destroy(): void;
}
```

### hangingCableDefinition · function

Lumped masses and segment compliance preserve total mass and EA as resolution changes.

```ts
export declare function hangingCableDefinition(input: {
    segments: number;
    length: number;
    linearDensity: number;
    tipMass: number;
    axialRigidity: number;
    config: CableConfig;
}): CableDefinition;
```

### NEWTON_CABLE_BACKEND · const

```ts
export declare const NEWTON_CABLE_BACKEND = "cable-newton-js-f64-v1";
```

### PROXIMAL_CABLE_BACKEND · const

```ts
export declare const PROXIMAL_CABLE_BACKEND = "cable-proximal-js-f64-v2";
```

## `box3d-webgpu-kit/water`

### CLOSED_WATER_CPU_BACKEND · const

Linear shallow water on a closed, rectangular, flat-bottom basin.
eta is at cell centers at t; u/v are east/north face velocities at t - dt/2.
The west/south exterior faces are implicit zero; stored east/north walls are zero.
With SI inputs: eta, meanDepth, dx, dz are m; u/v are m/s; drag is 1/s.
This is a small-amplitude model, without advection, breaking or wetting/drying.

```ts
export declare const CLOSED_WATER_CPU_BACKEND = "linear-water-closed-cgrid-js-f32-v1";
```

### closedWaterCoefficients · function

```ts
export declare function closedWaterCoefficients(input: LinearWaterConfig): Readonly<{
    decay: number;
    px: number;
    pz: number;
    cx: number;
    cz: number;
}>;
```

### copyClosedWaterArrays · function

Validate/copy already staggered state, including checkpoint scratch histories.

```ts
export declare function copyClosedWaterArrays(input: LinearWaterConfig, initial?: Partial<LinearWaterArrays>): LinearWaterArrays;
```

### createClosedWaterArrays · function

Start from eta and face velocities all specified at t=0. Copies caller data.
Converts velocities to the required negative half-time level using the centered
momentum equation. Use copyClosedWaterArrays for an existing staggered state.

```ts
export declare function createClosedWaterArrays(input: LinearWaterConfig, initial?: Partial<Pick<LinearWaterArrays, 'eta' | 'u' | 'v'>>): LinearWaterArrays;
```

### createLinearWaterArrays · function

```ts
export declare function createLinearWaterArrays(config: LinearWaterConfig, initial?: Partial<LinearWaterArrays>): LinearWaterArrays;
```

### LINEAR_WATER_MAX_CELLS · const

```ts
export declare const LINEAR_WATER_MAX_CELLS = 1048576;
```

### LinearWaterArrays · interface

```ts
export interface LinearWaterArrays {
    eta: Float32Array;
    u: Float32Array;
    v: Float32Array;
    nextEta: Float32Array;
    nextU: Float32Array;
    nextV: Float32Array;
}
```

### LinearWaterConfig · interface

Reference equations from WaterSimulation.solveShallowWater, without forcing or visual proxies.

```ts
export interface LinearWaterConfig {
    cols: number;
    rows: number;
    dt: number;
    gravity: number;
    meanDepth: number;
    drag: number;
    dx: number;
    dz: number;
}
```

### stepClosedWaterCpu · function

Two ordered, allocation-free updates. Every destination cell is overwritten.
Shared face fluxes telescope in the volume sum; only float32 roundoff remains.
Drag uses a centered Crank-Nicolson update and never alters elevation directly.
Config must first pass closedWaterCoefficients; dt remains fixed for the run.

```ts
export declare function stepClosedWaterCpu(s: LinearWaterArrays, c: Readonly<LinearWaterConfig>): void;
```

### stepLinearWaterCpu · function

Mutates and swaps reusable fields, preserving the original boundary update order.

```ts
export declare function stepLinearWaterCpu(s: LinearWaterArrays, c: Readonly<LinearWaterConfig>): void;
```

### validateLinearWaterConfig · function

```ts
export declare function validateLinearWaterConfig(input: LinearWaterConfig): Readonly<LinearWaterConfig>;
```

## `box3d-webgpu-kit/coupling`

### CoupledBodyReport · interface

Live per-body results of the most recent step(). Do not write to it.

```ts
export interface CoupledBodyReport {
    readonly volume: number;
    readonly submergedVolume: number;
    readonly submergedFraction: number;
    readonly centre: Float64Array;
    readonly buoyancy: Float64Array;
    readonly drag: Float64Array;
    readonly dragTorque: Float64Array;
}
```

### CouplingBodyOptions · interface

```ts
export interface CouplingBodyOptions {
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
    readonly linearDrag?: number;
    readonly angularDrag?: number;
}
```

### CouplingBodyState · interface

```ts
export interface CouplingBodyState {
    readonly position: CouplingVec3;
    readonly rotation: readonly [number, number, number, number];
    readonly linearVelocity: CouplingVec3;
    readonly angularVelocity: CouplingVec3;
    readonly mass: number;
    readonly type: string;
}
```

### CouplingShape · type

```ts
export type CouplingShape = {
    readonly kind: 'box';
    readonly halfExtents: CouplingVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
};
```

### CouplingVec3 · type

```ts
export type CouplingVec3 = readonly [number, number, number];
```

### CouplingWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface CouplingWorld<B> {
    gravity(): readonly number[];
    getState(body: B): CouplingBodyState;
    applyForce(body: B, force: CouplingVec3, point?: CouplingVec3): void;
    applyTorque(body: B, torque: CouplingVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
}
```

### WATER_COUPLING_BACKEND · const

Two-way coupling of rigid bodies with one closed, flat-bottom, linear shallow-water basin.

Water -> body: Archimedes buoyancy from the exact volume of the shape below the local
water plane, applied at the centre of buoyancy, plus a drag MODEL (linear + quadratic in the
velocity relative to the water, scaled by the submerged fraction). This is not CFD.
Body -> water: the displaced volume is a volume source for the free surface, and the reaction
of every horizontal force the water puts on a body is a momentum source for the water.

SI units, float64 state, world Y is up, grid x/z are world x/z. The water scheme is the one in
closed-water.ts (C-grid, eta at t, face velocities at t - dt/2) with the two source terms added.
See docs/WATER_COUPLING.md for the equations, what is conserved, and the validation.

```ts
export declare const WATER_COUPLING_BACKEND = "rigid-water-coupling-closed-cgrid-js-f64-v1";
```

### WaterCoupling · class

```ts
export declare class WaterCoupling<B> {
  readonly backend = "rigid-water-coupling-closed-cgrid-js-f64-v1";
  readonly cols: number;
  readonly rows: number;
  readonly dx: number;
  readonly dz: number;
  readonly dt: number;
  readonly restDepth: number;
  readonly density: number;
  readonly waterDrag: number;
  readonly origin: CouplingVec3;
  readonly eta: Float64Array;
  readonly u: Float64Array;
  readonly v: Float64Array;
  readonly stepImpulseOnWater: Float64Array<ArrayBuffer>;
  readonly stepImpulseOnBodies: Float64Array<ArrayBuffer>;
  waterConfig(gravity?: number): LinearWaterConfig;
  attach(body: B, shape: CouplingShape, options?: CouplingBodyOptions): CoupledBodyReport;
  detach(body: B): boolean;
  report(body: B): CoupledBodyReport | null;
  attachedCount(): number;
  tick(): number;
  gravity(): number;
  predictLoad(body: B, out: Float64Array): boolean;
  step(): void;
  surfaceVolume(): number;
  displacedVolume(): number;
  waterVolume(): number;
  meanElevation(): number;
  elevationAt(x: number, z: number): number;
  floorLoad(): number;
  buoyancyTotal(): number;
  verticalDragTotal(): number;
  waterKineticEnergy(): number;
  waterPotentialEnergy(): number;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  copyTo(arrays: Pick<LinearWaterArrays, 'eta' | 'u' | 'v'>): void;
}
```

### WaterCouplingOptions · interface

```ts
export interface WaterCouplingOptions {
    readonly cols: number;
    readonly rows: number;
    readonly dx: number;
    readonly dz: number;
    readonly restDepth: number;
    readonly origin: CouplingVec3;
    readonly dt?: number;
    readonly density?: number;
    readonly waterDrag?: number;
    readonly eta?: ArrayLike<number>;
}
```

## `box3d-webgpu-kit/frame`

### FRAME_BACKEND · const

```ts
export declare const FRAME_BACKEND = "frame-eb-midpoint-js-f64-v1";
```

### FrameCheckpoint · interface

```ts
export interface FrameCheckpoint {
    format: 'box3d-frame-checkpoint';
    version: 1;
    backend: typeof FRAME_BACKEND;
    definition: {
        config: FrameConfig;
        positions: number[];
        elements: FrameElement[];
        fixed: number[];
        pointMasses: number[];
        pointInertias: number[];
    };
    state: {
        tick: number;
        displacements: number[];
        velocities: number[];
        forces: number[];
        reactions: number[];
        reactionTime: number;
        supportImpulse: number[];
        appliedImpulse: number[];
        dragImpulse: number[];
        externalWork: number;
        dragDissipation: number;
        maxForceResidual: number;
        maxMomentResidual: number;
        maxImpulseResidual: number;
        maxAngularImpulseResidual: number;
        maxIterationsUsed: number;
        unconvergedSolves: number;
        matrixProducts: number;
        elementVisits: number;
    };
}
```

### FrameCommand · interface

```ts
export interface FrameCommand extends FixedTickCommand {
    type: 'force' | 'impulse';
    node: number;
    value: readonly [number, number, number, number, number, number];
}
```

### FrameConfig · interface

```ts
export interface FrameConfig {
    dt: number;
    substeps: number;
    maxIterations: number;
    drag: number;
    gravity: readonly [number, number, number];
    forceTolerance: number;
    momentTolerance: number;
    impulseTolerance: number;
    angularImpulseTolerance: number;
    solver?: 'cg' | 'direct';
}
```

### FrameDefinition · interface

```ts
export interface FrameDefinition {
    config: FrameConfig;
    positions: ArrayLike<number>;
    elements: readonly FrameElement[];
    fixed?: ArrayLike<number>;
    displacements?: ArrayLike<number>;
    velocities?: ArrayLike<number>;
    forces?: ArrayLike<number>;
    pointMasses?: ArrayLike<number>;
    pointInertias?: ArrayLike<number>;
}
```

### FrameDiagnostics · interface

```ts
export interface FrameDiagnostics extends Work, FrameKinematics {
    time: number;
    mass: number;
    kineticEnergy: number;
    elasticEnergy: number;
    gravitationalEnergy: number;
    externalWork: number;
    dragDissipation: number;
    linearMomentum: [number, number, number];
    linearizedAngularMomentum: [number, number, number];
    maxForceResidual: number;
    maxMomentResidual: number;
    maxImpulseResidual: number;
    maxAngularImpulseResidual: number;
    maxIterationsUsed: number;
    unconvergedSolves: number;
}
```

### FrameElement · interface

Prismatic Euler-Bernoulli frame. SI; iy/iz are area moments, not mass inertia.

```ts
export interface FrameElement {
    a: number;
    b: number;
    youngModulus: number;
    shearModulus: number;
    area: number;
    iy: number;
    iz: number;
    torsionConstant: number;
    density: number;
    up: readonly [number, number, number];
}
```

### frameElementMatrices · function

Cubic Hermite bending, linear axial/torsion interpolation, consistent mass.
Local DOFs at each end: ux, uy, uz, rx, ry, rz. Thus uz' = -ry.
No transverse shear, geometric stiffness or bending rotary inertia is included.

```ts
export declare function frameElementMatrices(value: unknown, positions: ArrayLike<number>): FrameElementMatrices;
```

### FrameElementMatrices · interface

```ts
export interface FrameElementMatrices {
    definition: FrameElement;
    length: number;
    mass: number;
    dofs: Uint32Array;
    basis: Float64Array;
    localStiffness: Float64Array;
    stiffness: Float64Array;
    massMatrix: Float64Array;
}
```

### FrameKinematics · interface

```ts
export interface FrameKinematics {
    maxRotation: number;
    maxAxialStrain: number;
    maxTransverseSlope: number;
    linearKinematicsExceeded: boolean;
}
```

### FrameRuntime · class

```ts
export declare class FrameRuntime implements EngineRuntime<FrameStepRequest, FrameSnapshot> {
  readonly capabilities: EngineCapabilities;
  readonly config: FrameConfig;
  get tick(): number;
  step(request: FrameStepRequest): FrameSnapshot;
  couplingViews(): { rest: Float64Array; displacements: Float64Array; velocities: Float64Array; fixed: Uint8Array; };
  solveCoupledOperator(dof: number, out: Float64Array): boolean;
  beginCoupledTick(): Float64Array;
  finishCoupledTick(extra: Float64Array): void;
  setLoads(forces: ArrayLike<number>): void;
  solveStatic(forces?: ArrayLike<number>): FrameStaticSolution;
  inspect(): FrameSnapshot;
  checkpoint(): FrameCheckpoint;
  static fromCheckpoint(value: unknown): FrameRuntime;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  destroy(): void;
}
```

### FrameSnapshot · interface

```ts
export interface FrameSnapshot {
    backend: typeof FRAME_BACKEND;
    tick: number;
    positions: Float64Array;
    displacements: Float64Array;
    velocities: Float64Array;
    supportReactions: Float64Array;
    reactionTime: number;
    elementElasticForces: Float64Array;
    impulses: {
        support: Float64Array;
        applied: Float64Array;
        drag: Float64Array;
    };
    diagnostics: FrameDiagnostics;
}
```

### FrameStaticSolution · interface

```ts
export interface FrameStaticSolution extends SolveStats, Work, FrameKinematics {
    displacements: Float64Array;
    positions: Float64Array;
    supportReactions: Float64Array;
    elasticEnergy: number;
    elementEndForces: Float64Array;
}
```

### FrameStepRequest · type

```ts
export type FrameStepRequest = FixedTickStep<FrameCommand>;
```

### frameTransverseSlope · function

Maximum transverse slope of the cubic Hermite centreline, including its
interior. The squared slope is quartic; isolate all stationary points using
the quadratic derivative of its cubic derivative, then bisect each bracket.
Scaling the coefficients avoids squaring large displacements during restore.

```ts
export declare function frameTransverseSlope(local: ArrayLike<number>, length: number): number;
```

## `box3d-webgpu-kit/heat`

### HEAT_MAX_CELLS · const

```ts
export declare const HEAT_MAX_CELLS = 2097152;
```

### HEAT_SOLVER_ID · const

Transient and steady heat conduction in solids on a structured grid of cells.

 rho c dT/dt = div(k grad T) + q

Finite volume, cell-centred, float64, SI units: metres, seconds, kelvin (or degrees Celsius when
no radiation boundary is used), W/(m K), kg/m^3, J/(kg K), W/m^3, W/m^2. The face conductivity
between unlike cells is the harmonic mean, so layered walls are exact at steady state. Boundary
conditions act on exposed faces of solid cells: fixed temperature, prescribed flux, convection
and grey-body radiation. Time integration is backward Euler or Crank-Nicolson (both solved with
Jacobi-preconditioned conjugate gradients, matrix-free, no allocation in the step), or explicit
Euler, which refuses a time step above its stability limit. A direct steady solve is included.

The thermal strain and stress helpers at the end are a ONE-WAY estimate from a temperature field.
They are not a thermo-mechanical solver: nothing here computes displacements or feeds stress back.
See docs/HEAT_TRANSFER.md for the equations, the validation and the limits.

```ts
export declare const HEAT_SOLVER_ID = "heat-fv-implicit-js-f64-v1";
```

### HeatBoundary · type

```ts
export type HeatBoundary = HeatBoundaryPlace & (
{
    readonly type: 'temperature';
    readonly temperature: number;
}
| {
    readonly type: 'flux';
    readonly flux: number;
}
| {
    readonly type: 'convection';
    readonly coefficient: number;
    readonly ambient: number;
}
| {
    readonly type: 'radiation';
    readonly emissivity: number;
    readonly environment: number;
});
```

### HeatBoundaryUpdate · interface

New values for an existing boundary condition (its type, face and region stay).

```ts
export interface HeatBoundaryUpdate {
    temperature?: number;
    flux?: number;
    coefficient?: number;
    ambient?: number;
    emissivity?: number;
    environment?: number;
}
```

### HeatConfig · interface

```ts
export interface HeatConfig {
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
    readonly dx: number;
    readonly dy: number;
    readonly dz: number;
    readonly materials: readonly HeatMaterial[];
    readonly material?: ArrayLike<number>;
    readonly solid?: ArrayLike<number>;
    readonly temperature: number | ArrayLike<number>;
    readonly dt?: number;
    readonly scheme?: HeatScheme;
    readonly boundaries?: readonly HeatBoundary[];
    readonly heatGeneration?: number | ArrayLike<number>;
    readonly sources?: readonly HeatSource[];
    readonly tolerance?: number;
    readonly maxIterations?: number;
}
```

### HeatDiagnostics · interface

```ts
export interface HeatDiagnostics {
    id: string;
    scheme: HeatScheme;
    time: number;
    steps: number;
    cells: number;
    solidCells: number;
    storedEnergy: number;
    boundaryEnergy: number[];
    sourceEnergy: number;
    boundaryHeatRates: number[];
    sourcePower: number;
    iterations: number;
    residual: number;
    explicitStabilityLimit: number;
}
```

### heatExplicitLimit · function

Largest stable explicit time step of a uniform grid: h^2 / (2 d alpha), with alpha = k/(rho c)
and d the number of conducting axes. In 3-D this is h^2 / (6 alpha).

```ts
export declare function heatExplicitLimit(spacing: number, diffusivity: number, dimensions?: number): number;
```

### HeatFace · type

```ts
export type HeatFace = 'x-' | 'x+' | 'y-' | 'y+' | 'z-' | 'z+';
```

### HeatIndex3 · type

```ts
export type HeatIndex3 = readonly [number, number, number];
```

### HeatMaterial · interface

```ts
export interface HeatMaterial {
    readonly conductivity?: number;
    readonly density: number;
    readonly specificHeat: number;
    readonly conductivityTable?: {
        readonly temperatures: ArrayLike<number>;
        readonly conductivities: ArrayLike<number>;
    };
}
```

### HeatRegion · interface

An inclusive box of cell indices.

```ts
export interface HeatRegion {
    readonly min: HeatIndex3;
    readonly max: HeatIndex3;
}
```

### HeatScheme · type

```ts
export type HeatScheme = 'backward-euler' | 'crank-nicolson' | 'explicit';
```

### HeatSolver · class

```ts
export declare class HeatSolver {
  readonly id = "heat-fv-implicit-js-f64-v1";
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly cells: number;
  readonly solidCells: number;
  readonly scheme: HeatScheme;
  readonly tolerance: number;
  readonly maxIterations: number;
  readonly temperature: Float64Array;
  readonly solid: Uint8Array;
  readonly heatGeneration: Float64Array;
  readonly boundaryEnergy: Float64Array;
  readonly boundaryStepRates: Float64Array;
  readonly boundaryCount: number;
  get dt(): number;
  get time(): number;
  get steps(): number;
  get sourceEnergy(): number;
  get iterations(): number;
  get residual(): number;
  get components(): number;
  index(i: number, j?: number, k?: number): number;
  setTimeStep(dt: number): void;
  setTemperature(value: number | ArrayLike<number>): void;
  setHeatGeneration(value: number | ArrayLike<number>): void;
  addSource(value: HeatSource): void;
  updateBoundary(index: number, values: HeatBoundaryUpdate): void;
  explicitStabilityLimit(): number;
  step(count?: number): number;
  solveSteady(options?: HeatSteadyOptions): HeatSteadyResult;
  storedEnergy(reference?: number): number;
  sourcePower(): number;
  boundaryHeatRate(index: number): number;
  boundaryHeatRates(out?: Float64Array): Float64Array;
  boundaryArea(index: number): number;
  faceHeatFlux(out?: { x: Float64Array; y: Float64Array; z: Float64Array; }): { x: Float64Array; y: Float64Array; z: Float64Array; };
  cellFaceFlux(i: number, j: number, k: number, face: HeatFace): number;
  faceTemperature(i: number, j: number, k: number, face: HeatFace): number;
  saveState(): StateObject;
  restoreState(value: StateValue): void;
  diagnostics(): HeatDiagnostics;
}
```

### HeatSource · interface

A heat source in one cell (max omitted) or spread over the solid cells of a box. Give exactly
one of power (W in total, spread by volume) or density (W/m^3 in every solid cell of the box).

```ts
export interface HeatSource {
    readonly min: HeatIndex3;
    readonly max?: HeatIndex3;
    readonly power?: number;
    readonly density?: number;
}
```

### HeatSteadyOptions · interface

```ts
export interface HeatSteadyOptions {
    readonly maxOuterIterations?: number;
    readonly nonlinearTolerance?: number;
}
```

### HeatSteadyResult · interface

```ts
export interface HeatSteadyResult {
    converged: boolean;
    outerIterations: number;
    iterations: number;
    residual: number;
    maxChange: number;
}
```

### restrainedThermalStress · function

Stress in a body whose thermal strain is fully prevented, per cell in Pa, tension positive:
-E alpha_T (T - T_ref) for a bar, divided by (1 - nu) for a plate and (1 - 2 nu) for a volume.
A one-way estimate: the temperature field is given, nothing is fed back.

```ts
export declare function restrainedThermalStress(temperature: ArrayLike<number>, options: ThermalStressOptions, out?: Float64Array): Float64Array;
```

### STEFAN_BOLTZMANN · const

Stefan-Boltzmann constant in W/(m^2 K^4) (CODATA 2018, exact).

```ts
export declare const STEFAN_BOLTZMANN = 5.670374419e-8;
```

### ThermalConstraint · type

```ts
export type ThermalConstraint = 'bar' | 'plate' | 'volume';
```

### thermalShock · function

A simple thermal-shock criterion: a cell cracks when its restrained thermal stress is tensile and
reaches the tensile strength. It is a screening estimate; it does not model crack growth, stress
relief after cracking, or the real restraint of the part.

```ts
export declare function thermalShock(temperature: ArrayLike<number>, options: ThermalShockOptions): ThermalShockResult;
```

### ThermalShockOptions · interface

```ts
export interface ThermalShockOptions extends ThermalStressOptions {
    readonly tensileStrength: number | ArrayLike<number>;
}
```

### ThermalShockResult · interface

```ts
export interface ThermalShockResult {
    stress: Float64Array;
    cracked: Uint8Array;
    crackedCells: Int32Array;
    count: number;
    maxTension: number;
    maxUtilisation: number;
}
```

### thermalStrain · function

Free thermal strain alpha_T (T - T_ref) per cell (dimensionless).

```ts
export declare function thermalStrain(temperature: ArrayLike<number>, expansion: number | ArrayLike<number>, reference: number | ArrayLike<number>, out?: Float64Array): Float64Array;
```

### ThermalStressOptions · interface

```ts
export interface ThermalStressOptions {
    readonly expansion: number | ArrayLike<number>;
    readonly youngsModulus: number | ArrayLike<number>;
    readonly poissonRatio?: number;
    readonly reference: number | ArrayLike<number> | 'mean';
    readonly constraint?: ThermalConstraint;
    readonly solid?: ArrayLike<number>;
}
```

## `box3d-webgpu-kit/solid`

### boundaryFaces · function

Triangles that belong to exactly one tetrahedron, three node indices each, wound so the
normal (b - a) x (c - a) points out of the solid. The order follows the element order.

```ts
export declare function boundaryFaces(mesh: TetMesh): Uint32Array;
```

### boxMesh · function

A box split into tetrahedra. The split is conforming (neighbouring cells share whole
triangles). `alternating5` gives every cell the symmetry of a regular tetrahedron and
mirrors the split between neighbours, so the mesh is mirror-symmetric about each mid-plane
whose cell count is even, and is unchanged by swapping two axes with equal counts and sizes.
`kuhn6` uses congruent elements but favours one diagonal. Every element has positive volume.

```ts
export declare function boxMesh(options: BoxMeshOptions): TetMesh;
```

### BoxMeshOptions · interface

```ts
export interface BoxMeshOptions {
    size: readonly [number, number, number];
    cells: readonly [number, number, number];
    origin?: readonly [number, number, number];
    pattern?: 'alternating5' | 'kuhn6';
}
```

### boxNode · function

Index of the node at grid position (i, j, k) of a `boxMesh` with the given cell counts.

```ts
export declare function boxNode(cells: readonly [number, number, number], i: number, j: number, k: number): number;
```

### buildConcreteLaw · function

Tabulates the law for a solid of Young's modulus E (the secant E_cm), Poisson's ratio nu and mean element volume.

```ts
export declare function buildConcreteLaw(input: unknown, youngModulus: number, poissonRatio: number, meanVolume: number): ConcreteLaw;
```

### ConcreteLaw · interface

The law with its curves tabulated for one solid (its E, nu and band width): frozen, a constant of the solid.

```ts
export interface ConcreteLaw {
    readonly input: Readonly<Required<Omit<ConcreteLawInput, 'tensionSoftening' | 'bandWidth' | 'friction' | 'meridian' | 'nonlocalLength' | 'postPeak'>> & {
        tensionSoftening: readonly number[];
        meridian: readonly number[];
    }>;
    readonly youngModulus: number;
    readonly poissonRatio: number;
    readonly friction: number;
    readonly dilatancy: number;
    readonly eccentricity: number;
    readonly softeningDilatancy: number;
    readonly postPeak: 'band' | 'lagged';
    readonly mx: Float64Array;
    readonly my: Float64Array;
    readonly bandWidth: number;
    readonly nonlocalLength: number;
    readonly compressionBand: number;
    readonly referenceLength: number;
    readonly compressionEnergyFactor: number;
    readonly tensionEnergyFactor: number;
    readonly kx: Float64Array;
    readonly ky: Float64Array;
    readonly kint: Float64Array;
    readonly sx: Float64Array;
    readonly sy: Float64Array;
    readonly sint: Float64Array;
    readonly peakIndex: number;
    readonly snapBackLength: Readonly<{
        tension: number;
        compression: number;
    }>;
    readonly stretchLength: Readonly<{
        tension: number;
        compression: number;
        compressionLagged: number;
    }>;
    readonly erosionGiven: boolean;
    readonly tx: Float64Array;
    readonly ty: Float64Array;
    readonly tint: Float64Array;
    readonly kappaPeak: number;
    readonly kappaCrushed: number;
    readonly kappaErode: number;
    readonly axialFlow: number;
    readonly softeningFlow: number;
    readonly kappaCrushedSoftening: number;
    readonly crushedStrain: number;
    readonly uniaxialStrain: Float64Array;
    readonly uniaxialStress: Float64Array;
}
```

### ConcreteLawInput · interface

Inputs of the law. SI units. Strains as fractions (0.0022, not 2.2 per mille).

```ts
export interface ConcreteLawInput {
    readonly compressiveStrength: number;
    readonly tensileStrength: number;
    readonly peakStrain: number;
    readonly ultimateStrain: number;
    readonly fractureEnergy: number;
    readonly crushingEnergy?: number;
    readonly meridian?: readonly number[];
    readonly friction?: number;
    readonly dilatancy?: number;
    readonly softeningDilatancy?: number;
    readonly postPeak?: 'band' | 'lagged';
    readonly biaxialRatio?: number;
    readonly elasticLimit?: number;
    readonly bandWidth?: number;
    readonly tensionSoftening?: readonly number[];
    readonly nonlocalLength?: number;
    readonly erosionOpening?: number;
}
```

### ec2CompressionStress · function

Ascending (and descending) branch of EN 1992-1-1 (3.14): sigma / f_cm = (k eta - eta^2) / (1 + (k - 2) eta).

```ts
export declare function ec2CompressionStress(strain: number, fcm: number, peakStrain: number, secantModulus: number): number;
```

### LDL_INDEFINITE_SKIP · const

Newton iterations that use the diagonal preconditioner after a factorization met an indefinite tangent.

```ts
export declare const LDL_INDEFINITE_SKIP = 3;
```

### LDL_REFACTOR_ITERATIONS · const

Inner iterations above which the next Newton iteration forms a new factorization (`linearSolver: 'ldl'`).

```ts
export declare const LDL_REFACTOR_ITERATIONS = 8;
```

### ReinforcementBarInput · interface

One reinforcing bar embedded in a solid (perfect bond). SI units.

```ts
export interface ReinforcementBarInput {
    readonly points: readonly number[];
    readonly area: number;
    readonly youngModulus: number;
    readonly yieldStress: number;
    readonly hardeningModulus?: number;
}
```

### ReinforcementInput · interface

The reinforcing bars to embed in a solid; see the steel and bar inputs above.

```ts
export interface ReinforcementInput {
    readonly bars: readonly ReinforcementBarInput[];
}
```

### SOLID_CONCRETE_SOLVER_ID · const

Solver id of a body with a concrete law: Drucker-Prager and Rankine composite plasticity with crack-band softening.

```ts
export declare const SOLID_CONCRETE_SOLVER_ID = "solid-tet-dp-rankine-js-f64-v1";
```

### SOLID_MAX_NODES · const

```ts
export declare const SOLID_MAX_NODES = 200000, SOLID_MAX_TETS = 1000000;
```

### SOLID_MAX_TETS · const

```ts
export declare const SOLID_MAX_NODES = 200000, SOLID_MAX_TETS = 1000000;
```

### SOLID_PLASTIC_SOLVER_ID · const

Solver id of a body with a yield stress: J2 plasticity on the same element.

```ts
export declare const SOLID_PLASTIC_SOLVER_ID = "solid-tet-j2-js-f64-v1";
```

### SOLID_SOLVER_ID · const

```ts
export declare const SOLID_SOLVER_ID = "solid-tet-corot-js-f64-v1";
```

### SolidBody · class

```ts
export declare class SolidBody {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver: string;
  readonly model: SolidModel;
  readonly integrator: SolidIntegrator;
  readonly dt: number;
  readonly element: SolidElement;
  readonly linearSolver: SolidLinearSolver;
  readonly nodeCount: number;
  readonly tetCount: number;
  readonly referencePositions: Float64Array;
  readonly tets: Uint32Array;
  readonly faces: Uint32Array;
  readonly nodalMass: Float64Array;
  readonly elementVolume: Float64Array;
  readonly referenceVolume: number;
  readonly mass: number;
  readonly lambda: number;
  readonly mu: number;
  readonly material: Readonly<Required<Omit<SolidMaterial, 'concrete'>> & { concrete?: ConcreteLawInput; }>;
  readonly plastic: boolean;
  readonly stats: SolidSolveStats;
  readonly viscoelasticScale: number;
  readonly concreteLaw: ConcreteLaw | null;
  readonly rebar: ConcreteReinforcement | null;
  selectNodes(predicate: (x: number, y: number, z: number) => boolean): Uint32Array;
  selectFaces(predicate: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => boolean): Uint32Array;
  constrain(nodes: ArrayLike<number>, value?: readonly [number | null, number | null, number | null]): void;
  release(nodes: ArrayLike<number>): void;
  setNodalForce(node: number, force: readonly [number, number, number]): void;
  addTraction(faces: ArrayLike<number>, traction: readonly [number, number, number]): void;
  addPressure(faces: ArrayLike<number>, pressure: number): void;
  clearSurfaceLoads(): void;
  setTemperatureChange(rise: number | ArrayLike<number>): void;
  get displacements(): Float64Array;
  get velocities(): Float64Array;
  get time(): number;
  get unconvergedSteps(): number;
  setState(displacements?: ArrayLike<number>, velocities?: ArrayLike<number>): void;
  reset(): void;
  positions(out?: Float64Array<ArrayBuffer>): Float64Array;
  solveStatic(options?: { loadSteps?: number; }): SolidStaticResult;
  step(count?: number): void;
  explicitLimit(): SolidExplicitLimit;
  fundamentalMode(options?: { maxIterations?: number; tolerance?: number; }): SolidMode;
  kernel(): SolidKernel;
  strainEnergy(): number;
  kineticEnergy(): number;
  loadPotential(): number;
  volume(): number;
  reactions(out?: Float64Array<ArrayBuffer>): Float64Array;
  stresses(out?: Float64Array<ArrayBuffer>): Float64Array;
  strains(out?: Float64Array<ArrayBuffer>): Float64Array;
  erode(elements: ArrayLike<number>): void;
  equivalentPlasticStrain(out?: Float64Array<ArrayBuffer>): Float64Array;
  plasticStrains(out?: Float64Array<ArrayBuffer>): Float64Array;
  get plasticWork(): number;
  reinforcementForces(): { force: Float64Array; strain: Float64Array; };
  damage(out?: Float64Array<ArrayBuffer>): Float64Array;
  setStrengthFactors(factors: ArrayLike<number>): void;
  crackOpening(out?: Float64Array<ArrayBuffer>): Float64Array;
  compressiveStrengthLeft(e: number): number;
  crackBandFindings(subject?: string): DiagnosticFinding[];
  bandWidths(): { compression: Float64Array; tension: Float64Array; };
  get erodedCount(): number;
  get erodedMask(): Uint8Array;
  vonMises(out?: Float64Array<ArrayBuffer>): Float64Array;
  principalStresses(out?: Float64Array<ArrayBuffer>): Float64Array;
  failedElements(options: { criterion: SolidFailureCriterion; strength: number; }): Uint32Array;
}
```

### SolidConfig · interface

```ts
export interface SolidConfig {
    model?: SolidModel;
    dt?: number;
    integrator?: SolidIntegrator;
    massDamping?: number;
    stiffnessDamping?: number;
    gravity?: readonly [number, number, number];
    tolerance?: number;
    forceTolerance?: number;
    maxNewtonIterations?: number;
    maxLinearIterations?: number;
    explicitSafety?: number;
    viscoelastic?: {
        readonly branches: readonly {
            readonly ratio: number;
            readonly time: number;
        }[];
    };
    element?: SolidElement;
    linearSolver?: SolidLinearSolver;
}
```

### SolidDefinition · interface

```ts
export interface SolidDefinition {
    mesh: TetMesh | {
        positions: ArrayLike<number>;
        tets: ArrayLike<number>;
    };
    material: SolidMaterial;
    config?: SolidConfig;
    reinforcement?: ReinforcementInput;
}
```

### SolidElement · type

`tet4`: the four-node tetrahedron, everything per element (locks when the material is nearly incompressible, elastically or
plastically). `tet4-nodal`: the same nodes and shape functions with the volumetric strain averaged over the elements around each
node: for every law that splits into a deviatoric and a volumetric energy the volumetric energy is evaluated at the nodes from
the nodal volume change (averaged nodal pressure, Bonet and Burton 1998); for the pressure-dependent concrete law the element's
volumetric strain is replaced by the average of its nodes' (nodally averaged B-bar). See docs/SOLID_MECHANICS.md.

```ts
export type SolidElement = 'tet4' | 'tet4-nodal';
```

### SolidExplicitLimit · interface

```ts
export interface SolidExplicitLimit {
    criticalTimeStep: number;
    waveSpeed: number;
    minAltitude: number;
    courant: number;
}
```

### SolidFailureCriterion · type

```ts
export type SolidFailureCriterion = 'max-principal' | 'von-mises';
```

### SolidIntegrator · type

```ts
export type SolidIntegrator = 'backward-euler' | 'midpoint' | 'explicit';
```

### SolidKernel · interface

What `SolidBody.kernel()` hands to a coupled solver. Arrays are the body's own, live.

```ts
export interface SolidKernel {
    readonly fixed: Uint8Array;
    readonly prescribed: Float64Array;
    readonly stiffnessDiagonal: Float64Array;
    readonly massDamping: number;
    readonly stiffnessDamping: number;
    readonly tolerance: number;
    readonly forceTolerance: number;
    readonly maxNewtonIterations: number;
    readonly maxLinearIterations: number;
    readonly gravity: Float64Array;
    loads(): Float64Array;
    applyConstraints(): void;
    energy(u: Float64Array, fint: Float64Array | null, store: boolean): number;
    tangentProduct(x: Float64Array, out: Float64Array): void;
    holdDampingTangent(): void;
    dampingProduct(x: Float64Array, out: Float64Array): void;
    advance(converged: boolean): void;
    commit(): void;
    readonly linearSolver: SolidLinearSolver;
    assembleTangent(kScale: number, mScale: number): SparseLDL;
    factorDue(kScale: number, mScale: number): boolean;
    innerDone(iterations: number): void;
    factorize(kScale: number, mScale: number): void;
    factorization(): SparseLDL | null;
}
```

### SolidLinearSolver · type

Inner solver of each Newton step: conjugate gradients preconditioned by the stiffness diagonal (`cg`), or by a sparse LDLᵀ
factorization of the assembled tangent (`ldl`, sparse-ldl.ts), kept across Newton iterations and steps and formed again when an
inner solve needed more than LDL_REFACTOR_ITERATIONS. Both multiply by the exact tangent and stop at the same tolerance; `ldl`
takes far fewer iterations on stiff or nearly incompressible problems. Meant for meshes of up to a few thousand nodes.

```ts
export type SolidLinearSolver = 'cg' | 'ldl';
```

### SolidMaterial · interface

```ts
export interface SolidMaterial {
    youngModulus: number;
    poissonRatio: number;
    density: number;
    thermalExpansion?: number;
    yieldStress?: number;
    hardeningModulus?: number;
    failureStrain?: number;
    concrete?: ConcreteLawInput;
}
```

### SolidMode · interface

```ts
export interface SolidMode {
    angularFrequency: number;
    frequency: number;
    shape: Float64Array;
    iterations: number;
    converged: boolean;
}
```

### SolidModel · type

`linear`: small-strain Hooke. `corotational`: Hooke on the stretch left after removing each
element's rotation. `neo-hookean`: compressible Neo-Hookean rubber. `green-lagrange`: Hooke on the
Green-Lagrange strain (St Venant-Kirchhoff): exact under rotation, for small elastic strain; the model
that carries J2 plasticity through large rotations.

```ts
export type SolidModel = 'linear' | 'corotational' | 'neo-hookean' | 'green-lagrange';
```

### SolidSolveStats · interface

```ts
export interface SolidSolveStats {
    converged: boolean;
    reason: 'converged' | 'iteration-limit' | 'line-search' | 'singular-or-indefinite';
    newtonIterations: number;
    linearIterations: number;
    residual: number;
    reference: number;
}
```

### SolidStaticResult · interface

```ts
export interface SolidStaticResult extends SolidSolveStats {
    loadSteps: number;
    displacements: Float64Array;
    reactions: Float64Array;
    strainEnergy: number;
}
```

### symmetricEigenvalues · function

Eigenvalues of a symmetric 3x3 tensor [xx, yy, zz, yz, xz, xy], largest first, by cyclic Jacobi rotations.

```ts
export declare function symmetricEigenvalues(t: ArrayLike<number>, offset: number, out: Float64Array | number[], outOffset: number): void;
```

### TetMesh · interface

A tetrahedral mesh. `positions` holds x, y, z per node in metres; `tets` holds four node indices per element.

```ts
export interface TetMesh {
    positions: Float64Array;
    tets: Uint32Array;
}
```

### tetVolume · function

Signed volume of the tetrahedron (a, b, c, d): positive when d lies on the side of the normal of a→b→c.

```ts
export declare function tetVolume(p: ArrayLike<number>, a: number, b: number, c: number, d: number): number;
```

### vonMisesStress · function

Von Mises equivalent stress of a symmetric tensor [xx, yy, zz, yz, xz, xy].

```ts
export declare function vonMisesStress(t: ArrayLike<number>, offset?: number): number;
```

## `box3d-webgpu-kit/structure`

### BodyAttachOptions · interface

```ts
export interface BodyAttachOptions {
    readonly inertia: StructureInertia;
    readonly localPoint?: StructureVec3;
    readonly gravityScale?: number;
}
```

### FrameBodyAttachOptions · interface

```ts
export interface FrameBodyAttachOptions extends BodyAttachOptions {
    readonly mode?: 'pinned' | 'clamped';
}
```

### principalMoments · function

Principal moments of inertia (body axes, kg m^2) of a body of the given mass, or null for a locked body.

```ts
export declare function principalMoments(inertia: StructureInertia, mass: number): [number, number, number] | null;
```

### STRUCTURE_COUPLING_BACKEND · const

Two-way coupling of rigid bodies with cables (compliant-cable.ts) and frames (frame-runtime.ts).

Every attachment is solved with the effective mass of BOTH sides, so a light body on a stiff
structure is stable at any step:

- Cable <-> body or frame node ("proxy"): the attached cable node is driven to the attachment
  point each step and given that point's effective mass along the cable, 1 / (d^T G d), with G the
  carrier's impulse response. The cable's own implicit solve then finds the tension; the impulse
  the carrier needs to follow the node is applied to it, equal and opposite to what the cable felt.
- Frame <-> body ("Schur"): pinned (3 equations) or clamped (6) velocity constraints between a body
  point and a frame node, solved exactly for the interface impulses with the dense interface
  matrix S = G_body + A^-1, A = M (1 + c h/2) + (h^2/4) K being the frame's midpoint operator. The
  impulse reaches the body as two half kicks around world.step(), which makes the body's share of
  the interface work a midpoint rule like the frame's: no first-order energy loss.

Attachments that share a body or a frame are coupled by one Gauss-Seidel sweep per step (cables in
the order they were added, then all frame <-> body constraints together), with last step's impulses
standing in for the ones not yet computed. SI units, float64 (the rigid solver's own state is
float32). See docs/STRUCTURE_COUPLING.md for the equations, measured stability limits and validation.

```ts
export declare const STRUCTURE_COUPLING_BACKEND = "rigid-structure-coupling-schur-proxy-js-f64-v1";
```

### StructureAttachment · interface

Live report of one attachment, updated in place by every step().

```ts
export interface StructureAttachment {
    readonly id: number;
    readonly kind: 'cable-body' | 'cable-frame' | 'frame-body';
    readonly mode: 'cable' | 'pinned' | 'clamped';
    readonly force: [number, number, number];
    readonly moment: [number, number, number];
    tension: number;
    gap: number;
    effectiveMass: number;
    attached: boolean;
}
```

### StructureBodyState · interface

```ts
export interface StructureBodyState {
    readonly position: StructureVec3;
    readonly rotation: readonly [number, number, number, number];
    readonly linearVelocity: StructureVec3;
    readonly angularVelocity: StructureVec3;
    readonly mass: number;
    readonly type: string;
}
```

### StructureCoupling · class

```ts
export declare class StructureCoupling<B> {
  readonly backend = "rigid-structure-coupling-schur-proxy-js-f64-v1";
  readonly dt: number;
  readonly baumgarte: number;
  readonly scheme: 'implicit' | 'naive-staggered';
  tick: number;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  addCable(cable: CompliantCableRuntime): this;
  addFrame(frame: FrameRuntime): this;
  attachCableToBody(cable: CompliantCableRuntime, node: number, body: B, options: BodyAttachOptions): StructureAttachment;
  attachCableToFrame(cable: CompliantCableRuntime, node: number, frame: FrameRuntime, frameNode: number): StructureAttachment;
  attachFrameToBody(frame: FrameRuntime, frameNode: number, body: B, options: FrameBodyAttachOptions): StructureAttachment;
  detach(attachment: StructureAttachment): void;
  prime(attachment: StructureAttachment, force: StructureVec3, moment?: StructureVec3): void;
  get reports(): readonly StructureAttachment[];
  addLoadProvider(provider: StructureLoadProvider<B>): () => void;
  step(): void;
  diagnostics(): StructureDiagnostics;
}
```

### StructureCouplingOptions · interface

```ts
export interface StructureCouplingOptions {
    readonly dt?: number;
    readonly baumgarte?: number;
    readonly scheme?: 'implicit' | 'naive-staggered';
}
```

### StructureDiagnostics · interface

```ts
export interface StructureDiagnostics {
    bodyKinetic: number;
    bodyPotential: number;
    cableKinetic: number;
    cableElastic: number;
    cablePotential: number;
    frameKinetic: number;
    frameElastic: number;
    framePotential: number;
    total: number;
    momentum: [number, number, number];
    mass: number;
}
```

### StructureInertia · type

Rotational inertia of a body about its centre of mass, in its own axes. The world reports mass but
not inertia, so say what the body is. `locked` is a body that cannot rotate (lockRotation).

```ts
export type StructureInertia = {
    readonly kind: 'box';
    readonly halfExtents: StructureVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'principal';
    readonly moments: StructureVec3;
} | {
    readonly kind: 'locked';
};
```

### StructureLoadProvider · type

Adds to `out` the force (out[0..2], N) and the torque about the centre of mass (out[3..5], N m) that another solver
will put on `body` over the coming step. Called once per attached dynamic body and step, after the body was read.

```ts
export type StructureLoadProvider<B> = (body: B, out: Float64Array) => void;
```

### StructureVec3 · type

```ts
export type StructureVec3 = readonly [number, number, number];
```

### StructureWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface StructureWorld<B> {
    gravity(): readonly number[];
    getState(body: B): StructureBodyState;
    applyForce(body: B, force: StructureVec3, point?: StructureVec3): void;
    applyTorque(body: B, torque: StructureVec3): void;
    applyImpulse(body: B, impulse: StructureVec3): void;
    applyAngularImpulse(body: B, impulse: StructureVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
    readonly subSteps?: number;
}
```

## `box3d-webgpu-kit/gameplay`

### attachSceneRoles · function

Attach the roles of a loaded scene and register them with its Simulation: from then on `loaded.simulation.step()`
plays the scene (and `simulation.checkpoint()` holds the roles' state). Returns the roles; when the scene has none,
nothing is registered and `roles.active` is false.

```ts
export declare function attachSceneRoles<W extends SceneRolesHost>(loaded: SceneRolesSource & {
    readonly builder: {
        readonly world: W;
    };
    readonly simulation: {
        add(subsystem: Subsystem<W, Body>): unknown;
    };
}, options?: {
    readonly input?: () => SceneRolesInput | null;
}): SceneRoles;
```

### CapsuleCharacterController · class

A capsule character: `move(input, dt)` once per fixed step, before or after `world.step()`.

- Walks at the wanted speed along walkable ground, and stays on it down slopes and stairs.
- Slopes steeper than `maxSlopeDegrees` are walls from below and slides from above.
- Ledges up to `stepHeight` are stepped onto. The round bottom also rides over bumps lower than
  radius * (1 - cos(maxSlope)) whatever `stepHeight` is.
- Rides kinematic and dynamic bodies it stands on (it takes their velocity at its feet) and keeps their
  horizontal velocity when it leaves them.
- Pushes dynamic bodies with at most `maxPushForce`; heavier ones block it.
- Never passes through thin geometry, at any speed: every translation is cast.

```ts
export declare class CapsuleCharacterController {
  readonly radius: number;
  readonly halfLength: number;
  readonly stepHeight: number;
  readonly snapDistance: number;
  readonly gravity: number;
  readonly maxPushForce: number;
  readonly maxSlopeDegrees: number;
  get state(): CapsuleCharacterState;
  teleport(position: CharacterVec3): void;
  move(input: CapsuleCharacterInput, dt: number): CapsuleCharacterState;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
}
```

### CapsuleCharacterInput · interface

One step's commands: the wanted horizontal velocity and an optional jump speed.

```ts
export interface CapsuleCharacterInput {
    readonly velocity: CharacterVec3;
    readonly jump?: number;
}
```

### CapsuleCharacterOptions · interface

The character's capsule, speeds, slope and step limits, jump and the bodies it collides with.

```ts
export interface CapsuleCharacterOptions {
    readonly position: CharacterVec3;
    readonly radius?: number;
    readonly height?: number;
    readonly maxSlopeDegrees?: number;
    readonly stepHeight?: number;
    readonly snapDistance?: number;
    readonly gravity?: number;
    readonly maxPushForce?: number;
    readonly ignoreBody?: Body;
    readonly filter?: {
        readonly categoryBits?: bigint;
        readonly maskBits?: bigint;
    };
}
```

### CapsuleCharacterState · interface

The character after a step: position and feet, velocity, the ground it stands on, what it pushed, and whether it stepped up or stands on a steep slope.

```ts
export interface CapsuleCharacterState {
    readonly position: readonly [number, number, number];
    readonly feet: number;
    readonly velocity: readonly [number, number, number];
    readonly grounded: boolean;
    readonly groundNormal: readonly [number, number, number] | null;
    readonly groundBody: Body | null;
    readonly pushed: readonly Body[];
    readonly stepped: boolean;
    readonly onSteepSlope: boolean;
}
```

### CharacterController · class

The first character controller of this package, on box casts. CapsuleCharacterController (same module) is
the one to use with a current WASM build: a capsule on Box3D's character mover, with moving platforms and
force-limited pushing. This one is kept for callers that have it.

A kinematic box character that walks, slides along walls, climbs steps,
respects a slope limit and sticks to the ground on the way down, using
box casts against the world.

It is not a physics body: the shipped WASM cannot create kinematic bodies,
so falling boxes pass through the character and only the character's own
pushes (applyImpulse) affect them. Dynamic bodies that end up overlapping
it are ignored for that move rather than trapping it. Character input is
not part of a ReplayLog; to replay a session, re-drive move() with the same
inputs (its pushes are recorded as impulses).

```ts
export declare class CharacterController {
  readonly halfExtents: readonly [number, number, number];
  readonly skin: number;
  readonly stepHeight: number;
  readonly gravity: number;
  readonly pushStrength: number;
  readonly maxIterations: number;
  get state(): CharacterState;
  teleport(position: Vec3Like): void;
  move(input: CharacterMoveInput, dt: number): CharacterState;
}
```

### CharacterHost · interface

What a character needs from a world. The kit's PhysicsWorld has exactly these members; the Physics Lab's scene
host has them too.

```ts
export interface CharacterHost {
    readonly native: {
        moverMove(input: NativeMoverInput): NativeMoverResult;
        queryBatch(queries: readonly NativeSpatialQuery[]): NativeQueryResult[];
        bodyIndex(body: Body): number | null;
        bodyHandle(index: number): Body;
        bodyCount(): number;
    };
    getState(body: Body): NativeBodyState;
    isAlive(body: Body): boolean;
    applyImpulseAt(body: Body, impulse: Vec3, point: Vec3): void;
    gravity(): [number, number, number];
}
```

### CharacterMoveInput · interface

```ts
export interface CharacterMoveInput {
    readonly velocity: Vec3Like;
    readonly jump?: number;
}
```

### CharacterOptions · interface

```ts
export interface CharacterOptions {
    readonly position: Vec3Like;
    readonly halfExtents?: Vec3Like;
    readonly skin?: number;
    readonly maxSlopeDegrees?: number;
    readonly stepHeight?: number;
    readonly gravity?: number;
    readonly pushStrength?: number;
    readonly maxIterations?: number;
}
```

### CharacterState · interface

```ts
export interface CharacterState {
    readonly position: readonly [number, number, number];
    readonly verticalSpeed: number;
    readonly grounded: boolean;
    readonly groundNormal: readonly [number, number, number] | null;
    readonly groundBody: Body | null;
    readonly pushed: readonly Body[];
    readonly stuck: boolean;
}
```

### CharacterVec3 · type

A tuple or an {x, y, z} object (a three.js Vector3 works).

```ts
export type CharacterVec3 = Vec3 | {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### MAX_QUERY_HITS · const

Most bodies one query can report; triggers holding more report `overflow`.

```ts
export declare const MAX_QUERY_HITS = 256;
```

### NATIVE_GRAVITY · const

Gravity of the native world, fixed by the shipped bridge (the cable and water modules default to -9.81).

```ts
export declare const NATIVE_GRAVITY: readonly [number, number, number];
```

### sceneHasRoles · function

True when a scene has a body or a joint with one of the roles this module plays.

```ts
export declare function sceneHasRoles(scene: SceneRolesSource['scene']): boolean;
```

### SceneLaserBeam · interface

One laser role's beam this step: where it starts and ends, and the body it hit.

```ts
export interface SceneLaserBeam {
    readonly from: V3;
    readonly to: V3;
    readonly body: Body | null;
}
```

### SceneRoles · class

Makes a loaded scene playable from the roles in its bodies' and joints' `userData.role`: a character, moving platforms, a vehicle, lasers.

```ts
export declare class SceneRoles {
  get active(): boolean;
  get character(): CapsuleCharacterController | null;
  get characterBody(): Body | null;
  get vehicle(): Vehicle | null;
  get time(): number;
  update(input?: SceneRolesInput | null): void;
  beams(): readonly SceneLaserBeam[];
  get state(): SceneRolesState;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
}
```

### SceneRolesHost · interface

What the roles need from a world: the kit's PhysicsWorld and the Lab's scene host both have it.

```ts
export interface SceneRolesHost extends VehicleHost {
    readonly native: CharacterHost['native'] & {
        castRayBatch(rays: ArrayLike<number>, filter?: NativeQueryFilter): NativeRayBatch;
    };
    isAlive(body: Body): boolean;
    applyImpulseAt(body: Body, impulse: readonly [number, number, number], point: readonly [number, number, number]): void;
    gravity(): [number, number, number];
    moveKinematic(body: Body, position: readonly [number, number, number], rotation?: readonly [number, number, number, number], seconds?: number): void;
}
```

### SceneRolesInput · interface

What a player asks for in one step. Every field is optional; absent ones are zero.

```ts
export interface SceneRolesInput {
    readonly move?: readonly [number, number];
    readonly jump?: boolean;
    readonly throttle?: number;
    readonly steer?: number;
    readonly brake?: number;
}
```

### SceneRolesSource · interface

The part of a loaded scene the roles read.

```ts
export interface SceneRolesSource {
    readonly scene: {
        readonly bodies: readonly {
            readonly id: string;
            readonly userData?: {
                readonly [key: string]: unknown;
            };
        }[];
        readonly joints?: readonly {
            readonly id: string;
            readonly bodyA: string | null;
            readonly bodyB: string | null;
            readonly userData?: {
                readonly [key: string]: unknown;
            };
        }[];
    };
    readonly bodies: ReadonlyMap<string, Body>;
    readonly joints: ReadonlyMap<string, Joint>;
}
```

### SceneRolesState · interface

The playable roles after a step: time played, the character and its laps, the vehicle, how many platforms move, and the lasers' rays and hits.

```ts
export interface SceneRolesState {
    readonly time: number;
    readonly character: (CapsuleCharacterState & {
        readonly waypoint: number;
        readonly laps: number;
    }) | null;
    readonly vehicle: VehicleState | null;
    readonly platforms: number;
    readonly lasers: {
        readonly rays: number;
        readonly hits: number;
    }[];
}
```

### sceneRolesSubsystem · function

The roles as a Simulation subsystem (simulation.ts): they act in the pre-couple stage of every step, before any
coupling and before the rigid step, and their state is part of `simulation.checkpoint()`. `input` is asked once per
step; `null` lets the scene play itself.

```ts
export declare function sceneRolesSubsystem<W, B>(roles: SceneRoles, input?: () => SceneRolesInput | null, dt?: number): Subsystem<W, B>;
```

### suspensionJointSpring · function

The spring setting of a wheel joint that gives a physical suspension. Box3D states a joint spring as a frequency
of the joint's own effective mass, not of the chassis: along the suspension axis `a` (the chassis' up axis) at a
wheel at `r` from the chassis' centre of mass, that mass is 1 / (1/M + 1/m + (r x a) . I^-1 (r x a)). The returned
frequency and damping ratio make the joint a spring of `stiffness` N/m with a damper of `damping` N s/m.
`chassisInertia` is [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] about the centre of mass, in chassis axes.

```ts
export declare function suspensionJointSpring(options: {
    readonly stiffness: number;
    readonly damping: number;
    readonly chassisMass: number;
    readonly chassisInertia: readonly number[];
    readonly centerOfMass?: readonly number[];
    readonly wheelMass: number;
    readonly wheelPosition: readonly number[];
}): {
    hertz: number;
    dampingRatio: number;
};
```

### Trigger · interface

```ts
export interface Trigger<T = unknown> {
    readonly id: number;
    shape: TriggerShape;
    readonly filter: NativeQueryFilter;
    readonly data: T | undefined;
    readonly limit: number;
    readonly overflow: boolean;
}
```

### TriggerEvent · interface

```ts
export interface TriggerEvent<T = unknown> {
    readonly type: 'enter' | 'exit';
    readonly trigger: Trigger<T>;
    readonly body: Body;
    readonly alive: boolean;
}
```

### TriggerOptions · interface

```ts
export interface TriggerOptions<T = unknown> {
    readonly shape: TriggerShape;
    readonly filter?: NativeQueryFilter;
    readonly data?: T;
    readonly limit?: number;
}
```

### TriggerSet · class

Trigger volumes: axis-aligned boxes or spheres that report which bodies
enter and leave them. All volumes are tested in one batched native query
per update (chunks of 128). Call update() after each fixed step, or pass
`{attach: true}` to have the world do it through onStep().

Detection is by overlap at step boundaries, so a body fast enough to cross
a thin volume within one step is missed; make volumes at least one step of
travel deep, or use a sweep.

```ts
export declare class TriggerSet<T = unknown> {
  add(options: TriggerOptions<T>): Trigger<T>;
  remove(trigger: Trigger<T>): boolean;
  setShape(trigger: Trigger<T>, shape: TriggerShape): void;
  bodiesIn(trigger: Trigger<T>): Body[];
  on(listener: (event: TriggerEvent<T>) => void): () => void;
  get size(): number;
  update(): TriggerEvent<T>[];
  dispose(): void;
}
```

### TriggerShape · type

```ts
export type TriggerShape = {
    readonly kind: 'box';
    readonly center: Vec3Like;
    readonly halfExtents: Vec3Like;
} | {
    readonly kind: 'sphere';
    readonly center: Vec3Like;
    readonly radius: number;
};
```

### Vehicle · class

A chassis on Box3D wheel joints: suspension springs, Ackermann steering, throttle and brakes.

```ts
export declare class Vehicle {
  readonly chassis: Body;
  readonly wheels: readonly Body[];
  readonly joints: readonly Joint[];
  readonly wheelbase: number;
  readonly track: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly maxSteerAngle: number;
  readonly maxDriveTorque: number;
  readonly maxWheelSpeed: number;
  readonly maxBrakeTorque: number;
  readonly dragArea: number;
  readonly airDensity: number;
  static adopt(world: VehicleHost, parts: { readonly chassis: Body; readonly wheels: readonly { readonly body: Body; readonly joint: Joint; readonly position: VehicleVec3; readonly radius: number; readonly steered?: boolean; readonly driven?: boolean; readonly braked?: boolean; }[]; readonly maxSteerAngle?: number; readonly steeringHertz?: number; readonly maxDriveTorque?: number; readonly maxWheelSpeed?: number; readonly maxBrakeTorque?: number; readonly dragArea?: number; readonly airDensity?: number; readonly stiffness?: number; readonly damping?: number; }): Vehicle;
  ackermann(delta: number): number[];
  update(controls: VehicleControls, dt?: number): void;
  get state(): VehicleState;
  destroy(): void;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
}
```

### VehicleControls · interface

One step's commands: throttle (-1 full reverse .. 1 full forward), steer (-1 full right .. 1 full left) and brake.

```ts
export interface VehicleControls {
    readonly throttle?: number;
    readonly steer?: number;
    readonly brake?: number;
}
```

### VehicleHost · interface

What a vehicle needs from a world. The kit's PhysicsWorld has exactly these members; the Physics Lab's scene host has them too.

```ts
export interface VehicleHost {
    readonly loop: {
        readonly step: number;
    };
    createBody(options: NativeBodyDescriptor): Body | null;
    createJoint(options: NativeJointDescriptor): Joint;
    destroyBody(body: Body): boolean;
    getState(body: Body): NativeBodyState;
    getMassData(body: Body): NativeBodyMassState | {
        readonly mass: number;
        readonly center: readonly number[];
        readonly inertia: readonly number[];
    } | null;
    setMassData(body: Body, data: NativeMassData): void;
    applyForce(body: Body, force: Vec3, point?: Vec3): void;
    setJointMotor(joint: Joint, motor: {
        speed: number;
        maxForce: number;
    } | null): void;
    setJointSteering(joint: Joint, steering: {
        angle: number;
        hertz: number;
        dampingRatio: number;
        maxTorque: number;
    } | null): void;
    getJointDetails(joint: Joint): NativeJointDetails;
}
```

### VehicleOptions · interface

A chassis and its wheels, the suspension, steering, engine and brakes, and air drag.

```ts
export interface VehicleOptions {
    readonly position: VehicleVec3;
    readonly rotation?: VehicleQuat;
    readonly chassisHalfExtents: VehicleVec3;
    readonly chassisMass: number;
    readonly centerOfMass?: VehicleVec3;
    readonly wheels: readonly VehicleWheelOptions[];
    readonly wheelRadius?: number;
    readonly wheelMass?: number;
    readonly wheelFriction?: number;
    readonly suspension: ({
        readonly stiffness: number;
        readonly damping: number;
    } | {
        readonly frequency: number;
        readonly dampingRatio: number;
    }) & {
        readonly travel?: number;
    };
    readonly maxSteerAngle?: number;
    readonly steeringHertz?: number;
    readonly maxDriveTorque?: number;
    readonly maxWheelSpeed?: number;
    readonly maxBrakeTorque?: number;
    readonly dragArea?: number;
    readonly airDensity?: number;
    readonly color?: number;
    readonly wheelColor?: number;
}
```

### VehicleQuat · type

A quaternion as [x, y, z, w] or an {x, y, z, w} object (a three.js Quaternion works).

```ts
export type VehicleQuat = Quat | {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
};
```

### VehicleState · interface

The vehicle after a step: the chassis pose, its speeds and yaw rate, and each wheel.

```ts
export interface VehicleState {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly forwardSpeed: number;
    readonly speed: number;
    readonly yawRate: number;
    readonly wheels: readonly VehicleWheelState[];
}
```

### VehicleVec3 · type

A tuple or an {x, y, z} object (a three.js Vector3 works).

```ts
export type VehicleVec3 = Vec3 | {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### VehicleWheelOptions · interface

One wheel: where it sits on the chassis, its radius, and whether it steers, takes engine torque and brakes.

```ts
export interface VehicleWheelOptions {
    readonly position: VehicleVec3;
    readonly radius?: number;
    readonly steered?: boolean;
    readonly driven?: boolean;
    readonly braked?: boolean;
}
```

### VehicleWheelState · interface

One wheel after a step: suspension travel, spin and steering angle.

```ts
export interface VehicleWheelState {
    readonly suspension: number;
    readonly spinSpeed: number;
    readonly steeringAngle: number;
}
```

## `box3d-webgpu-kit/geometry`

### BinaryLike · type

```ts
export type BinaryLike = ArrayBuffer | Uint8Array;
```

### BodyFactory · interface

The part of `PhysicsWorld` this module uses.

```ts
export interface BodyFactory {
    createBody(options: BodyOptions): Body | null;
    createJoint(options: JointOptions): Joint;
    destroyBody?(body: Body): boolean;
}
```

### convexDecompose · function

Approximate convex decomposition of a closed, outward-wound mesh, for
turning a concave solid into a set of convex hulls.

The method is greedy recursive plane splitting. Each piece's concavity is
the volume of its convex hull minus its own volume. The piece with the
largest concavity is cut in two by one plane, chosen among the planes of its
own faces (the largest `maxCandidates` by area) and nine axis-aligned planes
at the quarter points of its bounds: the plane that leaves the fewest
concave halves, then the least concavity plus a penalty for uneven halves.
This repeats until the summed concavity is at most `maxConcavity` of the
mesh volume or `maxHulls` pieces exist. The result is the hull of each piece.

Limits, stated plainly:
- It is not V-HACD or CoACD. Cuts are single planes chosen greedily, so a
  polyhedral solid with flat inner faces (an L, a U, a bracket, steps) splits
  exactly, while a curved concavity (a bowl, a torus) is only approached as
  the hull count grows; check `volumeError`.
- The mesh must be closed and must not self-intersect; an open or inside-out
  mesh is rejected.
- Hulls of neighbouring pieces can overlap, and each hull is limited to
  `maxHullPoints` points, so `hullVolume` can be above or (rarely) below the
  mesh volume. `partVolume` is each piece's exact volume.
- Cost grows with triangles x candidates x hulls: fine for thousands of
  triangles, slow for hundreds of thousands. Simplify big meshes first.
- Pieces thinner than about 1e-6 of the mesh size are dropped.

```ts
export declare function convexDecompose(mesh: MeshLike, options?: ConvexDecomposeOptions): ConvexDecomposition;
```

### ConvexDecomposeOptions · interface

```ts
export interface ConvexDecomposeOptions {
    readonly maxHulls?: number;
    readonly maxConcavity?: number;
    readonly maxHullPoints?: number;
    readonly maxCandidates?: number;
}
```

### ConvexDecomposition · interface

```ts
export interface ConvexDecomposition {
    hulls: ConvexPart[];
    meshVolume: number;
    hullVolume: number;
    volumeError: number;
    partVolumeError: number;
}
```

### convexHull · function

Convex hull of a flat [x, y, z, ...] point list (or of a mesh's vertices) as
a closed, outward-wound triangle mesh. With `maxVertices` the result is an
inscribed approximation: its volume never exceeds the true hull's. Points
within 1e-7 of the bounding-box diagonal of a face are treated as on it.

```ts
export declare function convexHull(points: ArrayLike<number> | MeshLike, options?: ConvexHullOptions): TriangleMesh;
```

### ConvexHullOptions · interface

```ts
export interface ConvexHullOptions {
    readonly maxVertices?: number;
}
```

### ConvexPart · interface

```ts
export interface ConvexPart {
    points: Float32Array;
    volume: number;
    partVolume: number;
    centroid: [number, number, number];
}
```

### createBodiesFromMesh · function

Put a mesh into a world.

- `as: 'mesh'`: one static triangle-mesh body.
- `as: 'hull'`: one body shaped as the mesh's convex hull (see `toHullShape`
  for how many points are kept). For a closed mesh the density is scaled so
  the body's mass is density x mesh volume, whether the hull is larger than
  the mesh (a concave solid) or smaller (a rounded solid cut to 44 points);
  for an open mesh the mass is density x hull volume.
- `as: 'decomposed'`: the kit has no compound shapes yet, so a concave solid
  becomes one hull body per convex piece, all created at the same pose and
  held together by weld joints to the largest piece. The pieces share a
  negative collision group (pass `filter.groupIndex` to choose it), so they
  do not push each other apart. Each piece's density is scaled by its exact
  volume over its hull volume, so the set's total mass is density x mesh
  volume even where hulls overlap. Welds are solved iteratively: under hard
  impacts the set flexes slightly, unlike a true compound body.

```ts
export declare function createBodiesFromMesh(world: BodyFactory, mesh: MeshLike, options?: MeshBodiesOptions): MeshBodies;
```

### flipWinding · function

A copy with every triangle reversed (turns an inside-out mesh the right way round).

```ts
export declare function flipWinding(mesh: MeshLike): TriangleMesh;
```

### GEOMETRY_LIMITS · const

Hard caps. Input beyond them is rejected before anything large is allocated.

```ts
export declare const GEOMETRY_LIMITS: Readonly<{
    maxVertices: 4000000;
    maxTriangles: 8000000;
    maxDecomposeTriangles: 200000;
    maxHulls: 64;
    maxHullPoints: 64;
    maxHullHalfEdges: 255;
    maxHeightfieldCells: number;
    maxConvexityTests: 200000000;
}>;
```

### GLTFBuffers · type

External glTF buffers by the `uri` the file names them with.

```ts
export type GLTFBuffers = Readonly<Record<string, BinaryLike>> | ReadonlyMap<string, BinaryLike>;
```

### HeightfieldOptions · interface

```ts
export interface HeightfieldOptions {
    readonly countX: number;
    readonly countZ: number;
    readonly spacing?: readonly [number, number];
    readonly origin?: readonly [number, number];
    readonly missing?: number;
}
```

### HeightfieldShape · interface

```ts
export interface HeightfieldShape {
    readonly kind: 'heightfield';
    readonly heights: Float32Array;
    readonly countX: number;
    readonly countZ: number;
    readonly spacing: readonly [number, number];
    readonly origin: [number, number, number];
}
```

### HullShape · interface

```ts
export interface HullShape {
    readonly kind: 'hull';
    readonly points: Float32Array;
}
```

### HullShapeOptions · interface

```ts
export interface HullShapeOptions {
    readonly maxPoints?: number;
}
```

### isClosed · function

True when the surface has no boundary: after merging vertices within
`tolerance`, every triangle edge is matched by exactly one edge running the
other way. A closed mesh with consistent winding is what `meshVolume`,
`meshCenterOfMass`, `isConvex` and `convexDecompose` need.

```ts
export declare function isClosed(mesh: MeshLike, tolerance?: number): boolean;
```

### isConvex · function

True when the mesh is closed, outward-wound (positive volume) and no vertex
lies more than `tolerance` outside the plane of any triangle. The default
tolerance is 1e-6 of the bounding-box diagonal. Costs vertices x triangles
tests and refuses meshes beyond `GEOMETRY_LIMITS.maxConvexityTests`.

```ts
export declare function isConvex(mesh: MeshLike, tolerance?: number): boolean;
```

### MeshBodies · interface

```ts
export interface MeshBodies {
    bodies: Body[];
    joints: Joint[];
    decomposition?: ConvexDecomposition;
}
```

### MeshBodiesOptions · interface

```ts
export interface MeshBodiesOptions extends Omit<BodyOptions, 'shape' | 'position' | 'type'> {
    readonly as?: 'mesh' | 'hull' | 'decomposed';
    readonly position?: Vec3Like;
    readonly type?: BodyType;
    readonly maxPoints?: number;
    readonly decomposition?: ConvexDecomposeOptions;
}
```

### meshBounds · function

Axis-aligned bounds of every vertex.

```ts
export declare function meshBounds(mesh: MeshLike): MeshBounds;
```

### MeshBounds · interface

```ts
export interface MeshBounds {
    min: [number, number, number];
    max: [number, number, number];
}
```

### meshCenterOfMass · function

Centre of mass of the uniform solid a closed mesh encloses.

```ts
export declare function meshCenterOfMass(mesh: MeshLike): [number, number, number];
```

### MeshLike · interface

Anything mesh-shaped is accepted as input; outputs are always typed arrays.

```ts
export interface MeshLike {
    readonly vertices: ArrayLike<number>;
    readonly indices: ArrayLike<number>;
    readonly name?: string;
}
```

### MeshShape · interface

```ts
export interface MeshShape {
    readonly kind: 'mesh';
    readonly vertices: Float32Array;
    readonly indices: Uint32Array;
}
```

### MeshTransform · interface

```ts
export interface MeshTransform {
    readonly position?: Vec3Like;
    readonly rotation?: QuatLike;
    readonly scale?: number | Vec3Like;
}
```

### meshVolume · function

Enclosed volume by summing signed tetrahedra. Exact (to float64 roundoff)
for a closed, consistently wound mesh; positive when triangles are
counter-clockwise seen from outside, negative when the mesh is inside out.
For an open mesh the number has no meaning: check `isClosed` first.

```ts
export declare function meshVolume(mesh: MeshLike): number;
```

### parseGLB · function

Binary glTF (.glb): the JSON chunk and the embedded BIN chunk. See `parseGLTF` for what is read.

```ts
export declare function parseGLB(data: BinaryLike, buffers?: GLTFBuffers): TriangleMesh[];
```

### parseGLTF · function

glTF 2.0 from its JSON (text or parsed) and its buffers. Returns one mesh
per node of the default scene that carries a mesh, in world space: each
node's transform (matrix, or translation, rotation and scale) and those of
its ancestors are applied to the positions, and a mirroring transform also
reverses the winding. Primitives of one mesh are merged.

Supported: TRIANGLES, TRIANGLE_STRIP and TRIANGLE_FAN primitives (points and
lines are skipped); POSITION as VEC3 FLOAT; indices as UNSIGNED_BYTE, SHORT
or INT, or none; byteStride; `data:` base64 buffers; external buffers found
in `buffers` by their uri (nothing is fetched).

Rejected with a clear error: sparse accessors, quantised or compressed
geometry (KHR_mesh_quantization, KHR_draco_mesh_compression,
EXT_meshopt_compression when required), versions other than 2.x, a node
graph that is not a tree, and any accessor that reads outside its buffer.
Ignored: normals, UVs, materials, skins, morph targets, animations, cameras
and instancing extensions.

```ts
export declare function parseGLTF(json: string | object, buffers?: GLTFBuffers): TriangleMesh[];
```

### parseOBJ · function

Wavefront OBJ. Reads `v` (x y z; a fourth value or colours are ignored) and
`f` with the index forms `v`, `v/vt`, `v//vn` and `v/vt/vn`, 1-based or
negative (relative to the vertices read so far). Polygons are triangulated
as fans from their first corner, which is right for convex polygons only.
Each `o` or `g` name starts a mesh (faces under the same name are merged);
every mesh gets only the vertices it uses. Normals, texture coordinates,
materials, smoothing groups, lines, points, curves and surfaces are ignored.
Returns one mesh per object with faces.

```ts
export declare function parseOBJ(text: string): TriangleMesh[];
```

### parseSTL · function

STL, binary or ASCII. Bytes are read as binary exactly when the length is
84 + 50 x the triangle count stored at byte 80, whatever the header says (a
binary header may begin with "solid"); otherwise they must be ASCII text
starting with `solid`. A string is always ASCII. Corners at identical
positions are welded to one vertex, and winding follows the corner order
(stored normals are ignored). ASCII files must end each solid with
`endsolid`; several solids in one file are merged. Triangles with two
identical corners are dropped.

```ts
export declare function parseSTL(data: BinaryLike | string): TriangleMesh;
```

### toHeightfieldShape · function

Sample a surface onto the regular grid a height field needs. Pass a function
`(x, z) => y`, or a mesh: each grid point then takes the highest point of
the mesh on its vertical line (vertical faces are skipped). Heights are
absolute, so use the returned `origin` as the body position. Between grid
points the terrain is piecewise linear, so features narrower than the
spacing are lost.

```ts
export declare function toHeightfieldShape(source: MeshLike | ((x: number, z: number) => number), options: HeightfieldOptions): HeightfieldShape;
```

### toHullShape · function

The convex hull of a mesh (or point list) as a `{kind: 'hull'}` shape. Only
true hull vertices are returned. When the hull has more than `maxPoints`
vertices the farthest-first subset is kept, which makes the shape slightly
smaller than the true hull, never larger.

Box3D stores at most 64 hull vertices and 255 half-edges, and rejects a
hull beyond the second limit. A hull whose faces are all triangles (any
rounded shape) reaches it at 44 vertices, so such a hull is cut to 44 points
even when `maxPoints` is higher; a hull with polygonal faces (a prism, a
bevelled box) can keep all 64. Passing a raw point cloud of a rounded shape
straight to `createBody` fails for the same reason; this function is the fix.

```ts
export declare function toHullShape(mesh: MeshLike | ArrayLike<number>, options?: HullShapeOptions): HullShape;
```

### toMeshShape · function

A validated `{kind: 'mesh'}` shape for static scenery. Zero-area triangles are dropped; winding is kept.

```ts
export declare function toMeshShape(mesh: MeshLike): MeshShape;
```

### transformMesh · function

A copy scaled, then rotated, then translated.

```ts
export declare function transformMesh(mesh: MeshLike, transform: MeshTransform): TriangleMesh;
```

### TriangleMesh · interface

A triangle mesh: flat [x, y, z, ...] vertices and index triples, counter-clockwise seen from outside.

```ts
export interface TriangleMesh {
    vertices: Float32Array;
    indices: Uint32Array;
    name?: string;
}
```

### weldVertices · function

Merge vertices closer than `tolerance` (0, the default, merges only identical
positions) and drop triangles that collapse. Each vertex joins the first
earlier vertex within the tolerance, so chains of near points are not all
merged into one.

```ts
export declare function weldVertices(mesh: MeshLike, tolerance?: number): TriangleMesh;
```

## `box3d-webgpu-kit/scene`

### breakableBridgeScene · function

A plank bridge whose welds break: eight 135 kg planks welded end to end between two abutments, a 300 kg block
dropped onto the middle from 2 m. Scene version 3 (joint thresholds).

At rest the bridge is a beam built in at both ends, made of n rigid links on n + 1 soft welds. The shear at a
support is half the weight, w L / 2. The moments follow from the welds' rotations adding up to zero; a Box3D
joint spring acts on the joint's own effective inertia, so the two end welds (plank to abutment) are twice as stiff
as the others (plank to plank), which gives a support moment of w l^2 (n^2 - 1) / 12 (the continuous beam's
w L^2 / 12 as n grows). Here: 5,297 N and 6,953 N m; packages/box3d-kit/test/v22-rigid-examples.test.mjs measures both. Every weld breaks
at six times that shear or three times that moment, so the bridge carries itself with a margin and not the block.

```ts
export declare function breakableBridgeScene(options?: {
    blockMass?: number;
    drop?: number;
}): Scene;
```

### bulletPlatesScene · function

Continuous collision in three lanes, at 60 Hz: steel balls at 150 m/s (2.5 m per step) against rows of thin plates.
Lane 1: free plates and an ordinary ball, which passes through all of them (two moving bodies are not swept).
Lane 2: the same with `bullet: true` on the ball, which hits the first plate. Lane 3: a thin static wall, which
stops an ordinary ball (moving bodies are swept against static ones).

```ts
export declare function bulletPlatesScene(options?: {
    speed?: number;
}): Scene;
```

### buoyAndCratesScene · function

The moored buoy released 0.4 m to the side, with `crates` wooden boxes dropped into the same basin: the buoy
swings back on its cable while the crates make waves, bob and drift. Water, a cable and floating bodies in one scene.

```ts
export declare function buoyAndCratesScene(options?: {
    offset?: number;
    crates?: number;
}): Scene;
```

### cableStayedDeckScene · function

A small cable-stayed deck: an 8 m steel beam of 8 elements on a pin and a
roller, two stays from a fixed tower top 3 m above midspan to the deck at
2 m and 6 m, and a ball pinned to deck node `loadNode` (1 to 7). It is the
span of the structure-coupling validation, so its stay tensions and its
deflection have a hand solution (docs/STRUCTURE_COUPLING.md).

```ts
export declare function cableStayedDeckScene(options?: {
    loadNode?: number;
    ballRadius?: number;
    ballDensity?: number;
    stayRigidity?: number;
    drag?: number;
}): Scene;
```

### canonicalize · function

The canonical text of a scene: its normal form (see normalizeScene) as JSON
with sorted keys, no whitespace, and numbers in their shortest round-trip
form. Two scenes that describe the same thing give the same text, whatever
their key order. `pretty: true` gives the same content on several lines
(one key per line, arrays of numbers on one line) for reading and diffing;
hashes and links always use the compact text.

```ts
export declare function canonicalize(scene: unknown, options?: {
    readonly pretty?: boolean;
}): string;
```

### cavityFlowScene · function

The lid-driven cavity: a cube of oil 0.1 m on a side (rho = 900 kg/m^3, mu = 0.09 Pa s) whose top wall slides at
0.1 m/s, Re = 100. The flow turns into one large vortex with small ones in the lower corners (the 2D case is checked
against Ghia, Ghia & Shin 1982 in docs/FLUID.md; this one is 3D, with side walls). 16^3 cells.

```ts
export declare function cavityFlowScene(options?: {
    cells?: number;
    lidSpeed?: number;
}): Scene;
```

### COUPLED_EXAMPLE_SCENES · const

```ts
export declare const COUPLED_EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### damBreakScene · function

A dam break in three dimensions: a column of water 0.18 m by 0.09 m and 0.3 m tall stands in one corner of a tank
0.6 x 0.36 x 0.18 m and is let go at t = 0. It spreads over the floor, runs to the far wall, climbs it and falls back.
Free surface by particles (APIC), eight per cell; inviscid; closed free-slip tank. 20 x 12 x 6 cells of 30 mm,
1,440 particles, two fluid steps per world step.

```ts
export declare function damBreakScene(options?: {
    width?: number;
    depth?: number;
    height?: number;
}): Scene;
```

### damBreakValleyScene · function

A dam break down a valley (shallow water, docs/SHALLOW_WATER.md): a reservoir 2 m deep behind a dam at x = 6 m lets go
into a dry valley 30 m long that falls 1 in 100 and has 1 in 4 sides; Manning n 0.03 (Chow 1959, earth channel), an
open outlet at the far end, and three crates afloat in the reservoir that ride the flood. The terrain is also a height
field of the rigid world, so the crates ground where the water leaves them.

```ts
export declare function damBreakValleyScene(options?: {
    depth?: number;
    crates?: number;
}): Scene;
```

### decodeSceneLink · function

Unpack a share link into a validated scene. Accepts the bare string or any
text that contains it, such as a whole URL. Synchronous and self-contained:
the DEFLATE decoder is built in, so a compressed link opens on platforms
without DecompressionStream. Throws EngineError('INVALID_PAYLOAD') for a link
that is too long, cut off, altered (CRC or length mismatch), of an unknown
version, or that would decompress to more than it declares
(SCENE_LIMITS.linkSceneBytes at most), and SceneValidationError when the
JSON inside is not a valid scene.

```ts
export declare function decodeSceneLink(text: string): Scene;
```

### dominoRunScene · function

A straight run of `count` dominoes on the ground; the first leans past its tipping point and starts the run.

```ts
export declare function dominoRunScene(options?: {
    count?: number;
    spacing?: number;
}): Scene;
```

### encodeSceneLink · function

Pack a scene into a URL-safe string:

    b3s1 <mode> . <length> . <crc> . <data>

- `mode`: `d` when `data` is raw DEFLATE (RFC 1951), `r` when it is stored as is;
- `length`: UTF-8 byte length of the canonical JSON, in lowercase base 36;
- `crc`: CRC-32 (IEEE 802.3, as in zip and PNG) of those bytes, 8 lowercase hex digits;
- `data`: base64url (RFC 4648 section 5) without padding.

Only `A-Z a-z 0-9 - _ .` appear, so the string needs no escaping in a query
or fragment. Compression uses the platform's `CompressionStream('deflate-raw')`;
where that is missing, or when the result is not smaller, or with
`compress: false`, the link stores the JSON uncompressed (mode `r`).

```ts
export declare function encodeSceneLink(scene: unknown, options?: {
    readonly compress?: boolean;
}): Promise<string>;
```

### encodeSceneLinkSync · function

The synchronous form of encodeSceneLink: always mode `r` (stored, not compressed). Works everywhere.

```ts
export declare function encodeSceneLinkSync(scene: unknown): string;
```

### eulerToQuaternion · function

Degrees about X, Y, Z to a quaternion, q = qx qy qz (a vector is turned about Z first, then Y, then X: the three.js 'XYZ' order).

```ts
export declare function eulerToQuaternion(degrees: SceneVec3): [number, number, number, number];
```

### EXAMPLE_SCENES · const

Every example by name, each called with its defaults.

```ts
export declare const EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### flowPastCylinderScene · function

Flow past a cylinder at Re = 20, in two dimensions: a slab one cell thick (periodic in z) of a liquid with
nu = 4e-5 m^2/s enters at 40 mm/s on the left and leaves on the right (p = 0), with free-slip top and bottom. The
cylinder (20 mm across, 6 cells) is a static capsule of the rigid world lying across the slab. Behind it a pair of
standing vortices forms; the flow does not shed at this Reynolds number. The channel is 5.3 diameters tall (19%
blockage). Gravity is off in the fluid: the flow is horizontal and an outflow side cannot hold a hydrostatic pressure.

```ts
export declare function flowPastCylinderScene(options?: {
    speed?: number;
    reynolds?: number;
}): Scene;
```

### heatedBarScene · function

A heated bar: an aluminium bar (k = 237 W/(m K), alpha_T = 23e-6 /K, E = 70 GPa) clamped at both ends between
a hot block at 500 K and a cold one at 300 K. Its temperature rises from the hot end and settles to a linear
ramp in about 20 s; the restrained expansion puts it in compression.

```ts
export declare function heatedBarScene(options?: {
    hot?: number;
    cold?: number;
    cells?: number;
}): Scene;
```

### hopperSeesawScene · function

A hopper over a see-saw: `count` beads fill a conical hopper and run out of its orifice into a tray on one end of a
plank that turns on a hinge; a counterweight sits on the other end. When enough beads have landed the plank tips.
The beads are soft spheres by the discrete element method (docs/GRANULAR.md), linear contact law; the hopper is a
fixed wall that only the beads feel, the plank, the tray walls and the counterweight are rigid bodies.

```ts
export declare function hopperSeesawScene(options?: {
    count?: number;
    radius?: number;
    orifice?: number;
    counterweight?: number;
}): Scene;
```

### laserScannerScene · function

A ray-cast scanner among assorted bodies: the 'scanner' body's userData asks the Lab for a fan of rays, turning
slowly, cast in one batched call per step and drawn as beams to their hit points. A swinging pendulum and a ball
cross the beams.

```ts
export declare function laserScannerScene(options?: {
    rays?: number;
    range?: number;
}): Scene;
```

### LoadedScene · interface

```ts
export interface LoadedScene {
    readonly bodies: Map<string, Body>;
    readonly joints: Map<string, Joint>;
    readonly builder: SceneBuilder;
    readonly scene: Scene;
    readonly simulation: Simulation<PhysicsWorld, Body>;
    readonly water: Map<string, WaterCoupling<Body>>;
    readonly cables: Map<string, CompliantCableRuntime>;
    readonly frames: Map<string, FrameRuntime>;
    readonly structure: StructureCoupling<Body> | null;
    readonly attachments: Map<string, StructureAttachment>;
    readonly cloths: Map<string, ClothCoupling<Body>>;
    readonly grains: Map<string, GranularCoupling<Body>>;
    readonly solids: Map<string, SceneSolidRuntime<Body>>;
    readonly heat: Map<string, HeatSolver>;
    readonly fluids: Map<string, SceneFluidRuntime<Body>>;
    readonly shallowWater: Map<string, SceneShallowWaterRuntime<Body>>;
}
```

### loadScene · function

Validate a scene, reset the world to its settings and build every body, then
every joint, in file order. The world's body capacity is raised first when
the scene needs more than it has.

- An invalid scene throws SceneValidationError (code 'INVALID_PAYLOAD',
  `problems` holds the full list) and the world is NOT touched.
- A world created with another step or sub-step count throws
  EngineError('INVALID_STATE') and is not touched: create it with
  `createWorld(sceneWorldOptions(scene))`.
- If the engine refuses a body or joint part-way, the world is left reset to
  the scene's settings with none of the scene's bodies in it, and the error
  names the offending id.

The scene's `water`, `cables`, `frames`, `cloths`, `grains`, `solids`, `heat`, `fluids` and `shallowWater` sections are built after the
joints, and the result carries a ready `simulation` that steps the world
and all of them. A rigid-only scene builds exactly what it always did.

```ts
export declare function loadScene(world: PhysicsWorld, scene: unknown): LoadedScene;
```

### mooredBuoyScene · function

A buoy moored to the bed: a sphere of radius `radius` and density `density`
floats in an 8 m x 8 m basin `depth` deep and is held under its free
waterline by one compliant cable (rest length `cableLength`, axial rigidity
`axialRigidity` in newtons) from a fixed anchor on the bed to its centre.
`offset` moves the buoy sideways at the start. At rest the cable tension is
the buoyancy minus the weight of the buoy and of the cable's upper node.

```ts
export declare function mooredBuoyScene(options?: {
    radius?: number;
    density?: number;
    depth?: number;
    cableLength?: number;
    axialRigidity?: number;
    offset?: number;
    linearDrag?: number;
    waterDrag?: number;
    lineDensity?: number;
}): Scene;
```

### newtonsCradleScene · function

Newton's cradle: `count` steel balls hanging on rigid hinges in a row with a
small gap, the first one raised by `angle`. Perfectly elastic and
frictionless, so the last ball leaves at the first ball's speed (measured:
99.5% of it with the defaults). Keep the impact above about 1 m/s: the
engine applies no restitution to slow contacts (a 0.44 m/s impact passed on
only 23%), and the balls must not touch at rest (`gap` > 0).

```ts
export declare function newtonsCradleScene(options?: {
    count?: number;
    radius?: number;
    length?: number;
    angle?: number;
    gap?: number;
}): Scene;
```

### normalizeScene · function

The normal form of a valid scene, as a new object: every world setting
present, `rotationEuler` turned into `rotation`, values equal to the engine
defaults dropped, -0 written as 0, `units`, `materials` and `joints` always
present; `water`, `cables` and `frames` present only when they hold something.
Body and joint order is kept, because it is the build order. Throws
SceneValidationError for an invalid scene. Normalising twice changes nothing.

```ts
export declare function normalizeScene(scene: unknown): Scene;
```

### notchedBeamScene · function

A notched concrete beam loaded by a falling weight (a 200 kg drop hammer from 1.5 m, on a guide). The beam (E = 30 GPa, sigma_c = 3 MPa, G_c = 100 J/m^2)
is pinned along both ends of its base, cut by a notch at mid-span and given cohesive interfaces on the
section above it. The weight falls on a steel platen over mid-span; the force that holds the weight up is put
on the beam's top under the platen (one-way, `reactionLoadLink`). The impact cracks the section from the notch.

```ts
export declare function notchedBeamScene(options?: {
    mass?: number;
    drop?: number;
    cells?: number;
}): Scene;
```

### obstacleCourseScene · function

An obstacle course for the capsule character: four stairs up to a deck, a 25 degree ramp back down, a crate to push,
a ledge onto a slab, a platform that drifts sideways under the walker, and a 60 degree slope and a wall it cannot
climb. The body 'hero' is the character: a kinematic capsule that collides with nothing (the controller moves it and
does the colliding), with the controller's settings and a walking route in its userData.

```ts
export declare function obstacleCourseScene(options?: {
    speed?: number;
}): Scene;
```

### pendulumWaveScene · function

A pendulum wave: `count` spheres on revolute joints whose lengths are chosen
so that pendulum k swings `swings + k` times in `cycle` seconds; they drift
out of phase and realign after one cycle. Each bob's `userData` holds its
`length` (pivot to centre), small-angle `period` and release `angle`.
The lengths include the sphere's own inertia: T = 2 pi sqrt((L^2 + 2 r^2 / 5) / (g L)).

```ts
export declare function pendulumWaveScene(options?: {
    count?: number;
    cycle?: number;
    swings?: number;
    radius?: number;
    angle?: number;
}): Scene;
```

### quenchedPlateScene · function

Thermal shock: an alumina plate at 600 K (E = 370 GPa, nu = 0.22, alpha_T = 8e-6 /K, sigma_c = 300 MPa,
G_c = 40 J/m^2, k = 30 W/(m K)) whose face x = 0 is quenched by a film coefficient of 20,000 W/(m^2 K) to
300 K. As quenchedPlate() in solid-fracture.ts, with 6 mm cells instead of 0.25 mm: held in its plane
(rollers on the y and z faces and the back face), the cooled layer cracks in tension from about 1.2 s.

```ts
export declare function quenchedPlateScene(options?: {
    cells?: readonly [number, number, number];
    cellSize?: number;
    coefficient?: number;
}): Scene;
```

### ragdollScene · function

A ragdoll: a capsule torso, a sphere head and eight capsule limb segments on
nine spherical joints with cone and twist limits, dropped from `height`
metres above the ground with a slight forward tumble.

```ts
export declare function ragdollScene(options?: {
    height?: number;
}): Scene;
```

### RIGID_CORE_EXAMPLE_SCENES · const

The rigid-core examples by name, each called with its defaults.

```ts
export declare const RIGID_CORE_EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### riverBendScene · function

A river bend (shallow water): a channel that meanders down a 1 in 200 floodplain, fed 1.2 m^3/s at the upstream end,
with banks 0.5 m high, grass on the floodplain (n 0.035) and a clean channel (n 0.03) (Chow 1959, natural streams and
floodplains, normal values), an open outlet, and a log floating down it.

```ts
export declare function riverBendScene(options?: {
    discharge?: number;
}): Scene;
```

### rubberPadScene · function

A rubber pad under a dropped box: a neo-Hookean pad (E = 1.5 MPa, nu = 0.45) welded along its base to a
steel plate, and a box that falls on it, bounces on it and comes to rest pressed into it. Solid contact,
two-way, with friction (docs/SOLID_CONTACT.md).

```ts
export declare function rubberPadScene(options?: {
    cells?: number;
    drop?: number;
    mass?: number;
}): Scene;
```

### saveScene · function

The scene a builder (or the result of loadScene) describes, with each body's
current state: see SceneBuilder.toJSON for exactly what is and is not saved.

```ts
export declare function saveScene(world: PhysicsWorld, handles: SceneBuilder | {
    readonly builder: SceneBuilder;
}, options?: SaveSceneOptions): Scene;
```

### SaveSceneOptions · interface

```ts
export interface SaveSceneOptions {
    readonly state?: boolean;
    readonly meta?: SceneMeta;
}
```

### Scene · interface

```ts
export interface Scene {
    readonly format: 'box3d-scene';
    readonly version: 1 | 2 | 3;
    readonly units?: 'SI';
    readonly world?: SceneWorld;
    readonly materials?: {
        readonly [name: string]: SceneMaterial;
    };
    readonly bodies: readonly SceneBody[];
    readonly joints?: readonly SceneJoint[];
    readonly water?: readonly SceneWater[];
    readonly cables?: readonly SceneCable[];
    readonly frames?: readonly SceneFrameSection[];
    readonly cloths?: readonly SceneCloth[];
    readonly grains?: readonly SceneGrains[];
    readonly solids?: readonly SceneSolid[];
    readonly heat?: readonly SceneHeat[];
    readonly fluids?: readonly SceneFluid[];
    readonly shallowWater?: readonly SceneShallowWater[];
    readonly meta?: SceneMeta;
    readonly extensions?: {
        readonly [key: string]: unknown;
    };
}
```

### SCENE_FORMAT · const

```ts
export declare const SCENE_FORMAT = "box3d-scene";
```

### SCENE_LIMITS · const

Hard limits a scene file must respect. `validateScene` reports each one by path.

```ts
export declare const SCENE_LIMITS: Readonly<{
    bodies: 65536;
    joints: 65536;
    materials: 1024;
    idLength: 64;
    hullPoints: 4096;
    compoundShapes: 64;
    meshVertices: 1048576;
    meshTriangles: 2097152;
    heightfieldSide: 4096;
    geometryValues: 8000000;
    userDataChars: 65536;
    depth: 32;
    metaChars: 4096;
    waterBasins: 8;
    waterCells: 65536;
    cables: 1024;
    cableNodes: 16384;
    frames: 64;
    frameNodes: 4096;
    frameElements: 8192;
    frameBodyEquations: 96;
    cloths: 16;
    clothNodes: 16384;
    clothTriangles: 32768;
    grainSets: 8;
    grains: 65536;
    grainWalls: 256;
    grainSubsteps: 4096;
    solids: 8;
    solidNodes: 20000;
    solidTets: 60000;
    solidSubsteps: 64;
    heat: 8;
    heatSubsteps: 256;
    fluids: 4;
    fluidCells: 262144;
    fluidParticles: 262144;
    fluidSubsteps: 64;
    fluidLiquid: 16;
    shallowWater: 4;
    shallowWaterCells: 262144;
    shallowWaterSubsteps: 64;
    solidRegions: 64;
    solidCracks: 60000;
    problems: 100;
    linkChars: 1048576;
    linkSceneBytes: 4194304;
}>;
```

### SCENE_LINK_PREFIX · const

Every share link of this version starts with this, followed by 'd' (raw DEFLATE) or 'r' (stored).

```ts
export declare const SCENE_LINK_PREFIX = "b3s1";
```

### SCENE_VERSION · const

The newest scene version this build reads and writes. A scene that needs nothing newer than version 1 is written as version 1.

```ts
export declare const SCENE_VERSION = 3;
```

### SCENE_VERSIONS · const

Every scene version this build reads. Version 2 adds compound shapes and `massData`; version 3 adds the joint
types 'motor', 'parallel' and 'filter' and the joint settings `thresholds`, `drive`, `maxTorque` and `steering`.
Nothing else differs.

```ts
export declare const SCENE_VERSIONS: readonly number[];
```

### SceneBody · interface

```ts
export interface SceneBody {
    readonly id: string;
    readonly shape: SceneShape;
    readonly type?: SceneBodyType;
    readonly position: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
    readonly linearVelocity?: SceneVec3;
    readonly angularVelocity?: SceneVec3;
    readonly material?: string;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly color?: number;
    readonly bullet?: boolean;
    readonly sensor?: boolean;
    readonly hitEvents?: boolean;
    readonly neverSleeps?: boolean;
    readonly lockRotation?: boolean;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly filter?: SceneFilter;
    readonly massData?: SceneMassData;
    readonly userData?: {
        readonly [key: string]: unknown;
    };
}
```

### SceneBodyInput · type

A body description for SceneBuilder.addBody: a scene body without its id, or the kit's BodyOptions (bigint filter bits, typed arrays, {x, y, z} vectors).

```ts
export type SceneBodyInput = Omit<SceneBody, 'id'> | BodyOptions;
```

### SceneBodyType · type

```ts
export type SceneBodyType = 'static' | 'kinematic' | 'dynamic';
```

### SceneBuilder · class

A PhysicsWorld plus the description of everything put into it. The world
cannot report shapes or joint definitions, so the builder remembers them as
it creates each body and joint, and `toJSON()` writes them back out with the
bodies' current poses and velocities.

Constructing a builder RESETS the world to the given settings. Create and
remove bodies and joints through the builder; what you change on the world
directly (setJointMotor, setDamping, setCollisionFilter, ...) is not seen,
except pose, velocity, body type and gravity, which are read back on save.

```ts
export declare class SceneBuilder extends CoreSceneBuilder<PhysicsWorld> {
  readonly world: PhysicsWorld;
  meta: SceneMeta | undefined;
  extensions: { readonly [key: string]: unknown; } | undefined;
  defineMaterial(name: string, material: SceneMaterial): void;
  addBody(id: string, body: SceneBodyInput): Body;
  addJoint(id: string, joint: SceneJointInput): Joint;
  remove(id: string): boolean;
  has(id: string): boolean;
  body(id: string): Body | undefined;
  joint(id: string): Joint | undefined;
  idOf(handle: Body | Joint): string | undefined;
  bodies(): Map<string, Body>;
  joints(): Map<string, Joint>;
  describe(id: string): SceneBody | SceneJoint | undefined;
  toJSON(options?: SaveSceneOptions): Scene;
  static build(world: PhysicsWorld, scene: Scene): SceneBuilder;
}
```

### SceneCable · interface

A tension-only cable (docs/COMPLIANT_CABLE.md, docs/NONLINEAR_CABLE.md). It steps with the world's step and gravity. Numbers are float64.

```ts
export interface SceneCable {
    readonly id: string;
    readonly solver?: 'proximal' | 'xpbd';
    readonly nodes: readonly number[];
    readonly masses: readonly number[];
    readonly pinned?: readonly number[];
    readonly velocities?: readonly number[];
    readonly segments: readonly SceneCableSegment[];
    readonly substeps?: number;
    readonly maxIterations?: number;
    readonly residualTolerance?: number;
    readonly forceTolerance?: number;
    readonly drag?: number;
    readonly attachments?: readonly SceneCableAttachment[];
}
```

### SceneCableAttachment · interface

A free cable node attached to a point on a body (`body`), or to a frame node (`frame` and `frameNode`).

```ts
export interface SceneCableAttachment {
    readonly node: number;
    readonly body?: string;
    readonly frame?: string;
    readonly frameNode?: number;
    readonly inertia?: SceneInertia;
    readonly localPoint?: SceneVec3;
}
```

### SceneCableSegment · interface

```ts
export interface SceneCableSegment {
    readonly a: number;
    readonly b: number;
    readonly restLength: number;
    readonly compliance: number;
}
```

### SceneCloth · interface

A cloth coupled two-way to rigid bodies (docs/CLOTH.md). It steps with the world's step and gravity, backward Euler. Numbers are float64.

```ts
export interface SceneCloth {
    readonly id: string;
    readonly nodes: readonly number[];
    readonly restNodes?: readonly number[];
    readonly triangles: readonly number[];
    readonly velocities?: readonly number[];
    readonly material: SceneClothMaterial;
    readonly pinned?: readonly number[];
    readonly extraMass?: readonly number[];
    readonly drag?: number;
    readonly maxNewtonIterations?: number;
    readonly residualTolerance?: number;
    readonly forceTolerance?: number;
    readonly maxCgIterations?: number;
    readonly cgTolerance?: number;
    readonly contact?: {
        readonly offset?: number;
        readonly stiffness?: number;
        readonly skin?: number;
    };
    readonly selfCollision?: {
        readonly thickness: number;
        readonly stiffness?: number;
        readonly capacity?: number;
    };
    readonly bodies?: readonly SceneClothBody[];
    readonly planes?: readonly SceneClothPlane[];
    readonly attachments?: readonly SceneClothAttachment[];
}
```

### SceneClothAttachment · interface

A cloth node fixed to a point of one of the cloth's `bodies`.

```ts
export interface SceneClothAttachment {
    readonly node: number;
    readonly body: string;
    readonly localPoint?: SceneVec3;
}
```

### SceneClothBody · interface

A box, sphere or capsule body the cloth collides with and, when it is dynamic, pushes.

```ts
export interface SceneClothBody {
    readonly body: string;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneClothMaterial · interface

Material of a cloth (docs/CLOTH.md).

```ts
export interface SceneClothMaterial {
    readonly arealDensity: number;
    readonly youngModulus: number;
    readonly thickness: number;
    readonly poissonRatio: number;
    readonly membrane?: 'stvk' | 'spring';
    readonly bending?: 'koiter' | 'hinge' | 'none';
    readonly bendingStiffness?: number;
}
```

### SceneClothPlane · interface

A fixed half space the cloth cannot enter: everything behind `normal` through `point` (default the origin).

```ts
export interface SceneClothPlane {
    readonly normal: SceneVec3;
    readonly point?: SceneVec3;
    readonly friction?: number;
}
```

### SceneCompoundChild · interface

One shape of a compound body (scene version 2).

```ts
export interface SceneCompoundChild {
    readonly shape: SceneConvexShape;
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
}
```

### SceneConvexShape · type

The shapes a compound may hold.

```ts
export type SceneConvexShape = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: readonly number[];
};
```

### SceneCoupledSections · interface

The optional coupled sections of a scene.

```ts
export interface SceneCoupledSections {
    readonly water?: readonly SceneWater[];
    readonly cables?: readonly SceneCable[];
    readonly frames?: readonly SceneFrameSection[];
    readonly cloths?: readonly SceneCloth[];
    readonly grains?: readonly SceneGrains[];
    readonly solids?: readonly SceneSolid[];
    readonly heat?: readonly SceneHeat[];
    readonly fluids?: readonly SceneFluid[];
    readonly shallowWater?: readonly SceneShallowWater[];
}
```

### SceneFilter · interface

```ts
export interface SceneFilter {
    readonly categoryBits?: string;
    readonly maskBits?: string;
    readonly groupIndex?: number;
}
```

### SceneFluid · interface

A volumetric fluid (docs/FLUID.md): a box of `cells` cubic cells of side `spacing` from `origin`. Numbers are float64.
- kind 'flow' (the default): incompressible Navier-Stokes with walls, inflows, outflows or periodic sides, and the
  listed bodies as moving obstacles (FluidCoupling). Saved state: the face velocities and the cell pressures.
- kind 'free-surface': an inviscid liquid carried by particles in a closed tank of free-slip walls, started from the
  `liquid` boxes. No bodies. Saved state: the particles.

```ts
export interface SceneFluid {
    readonly id: string;
    readonly kind?: 'flow' | 'free-surface';
    readonly cells: readonly [number, number, number];
    readonly spacing: number;
    readonly origin?: SceneVec3;
    readonly density: number;
    readonly substeps?: number;
    readonly viscosity?: number;
    readonly gravity?: boolean;
    readonly boundaries?: SceneFluidBoundaries;
    readonly advection?: 'central' | 'upwind';
    readonly diffusion?: 'explicit' | 'crank-nicolson' | 'backward-euler';
    readonly velocity?: SceneVec3;
    readonly bodies?: readonly SceneFluidBody[];
    readonly backend?: 'cpu' | 'gpu';
    readonly u?: readonly number[];
    readonly v?: readonly number[];
    readonly w?: readonly number[];
    readonly pressure?: readonly number[];
    readonly particlesPerAxis?: number;
    readonly liquid?: readonly SceneFluidLiquid[];
    readonly positions?: readonly number[];
    readonly velocities?: readonly number[];
    readonly affine?: readonly number[];
}
```

### SceneFluidBody · interface

A box, sphere or capsule body that is a moving obstacle in a flow and, when it is dynamic, feels its force.

```ts
export interface SceneFluidBody {
    readonly body: string;
    readonly twoWay?: boolean;
}
```

### SceneFluidBoundaries · interface

```ts
export interface SceneFluidBoundaries {
    readonly xMin?: SceneFluidSide;
    readonly xMax?: SceneFluidSide;
    readonly yMin?: SceneFluidSide;
    readonly yMax?: SceneFluidSide;
    readonly zMin?: SceneFluidSide;
    readonly zMax?: SceneFluidSide;
}
```

### SceneFluidLiquid · interface

A box of liquid a free-surface tank starts with, m.

```ts
export interface SceneFluidLiquid {
    readonly min: SceneVec3;
    readonly max: SceneVec3;
    readonly velocity?: SceneVec3;
}
```

### SceneFluidSide · type

A side of a fluid box (docs/FLUID.md, Boundaries): a type, or a no-slip wall that slides or an inflow, with its velocity.

```ts
export type SceneFluidSide = 'no-slip' | 'free-slip' | 'outflow' | 'periodic' | {
    readonly type: 'no-slip' | 'inflow';
    readonly velocity: SceneVec3;
};
```

### SceneFrame · interface

```ts
export interface SceneFrame {
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
}
```

### SceneFrameAttachment · interface

A frame node attached to a point on a body: 'pinned' (forces) or 'clamped' (forces and moments).

```ts
export interface SceneFrameAttachment {
    readonly node: number;
    readonly body: string;
    readonly mode?: 'pinned' | 'clamped';
    readonly inertia?: SceneInertia;
    readonly localPoint?: SceneVec3;
}
```

### SceneFrameElement · interface

```ts
export interface SceneFrameElement {
    readonly a: number;
    readonly b: number;
    readonly youngModulus: number;
    readonly shearModulus: number;
    readonly area: number;
    readonly iy: number;
    readonly iz: number;
    readonly torsionConstant: number;
    readonly density: number;
    readonly up: SceneVec3;
}
```

### SceneFrameSection · interface

A linear beam frame (docs/FRAME_MECHANICS.md). It steps with the world's step and gravity, one sub-step. Numbers are float64.

```ts
export interface SceneFrameSection {
    readonly id: string;
    readonly nodes: readonly number[];
    readonly elements: readonly SceneFrameElement[];
    readonly fixed?: readonly number[];
    readonly pointMasses?: readonly number[];
    readonly pointInertias?: readonly number[];
    readonly displacements?: readonly number[];
    readonly velocities?: readonly number[];
    readonly drag?: number;
    readonly maxIterations?: number;
    readonly forceTolerance?: number;
    readonly momentTolerance?: number;
    readonly impulseTolerance?: number;
    readonly angularImpulseTolerance?: number;
    readonly attachments?: readonly SceneFrameAttachment[];
}
```

### SceneGrainBody · interface

A box, sphere or capsule body the grains collide with and, when it is dynamic, push.

```ts
export interface SceneGrainBody {
    readonly body: string;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneGrainMaterial · interface

Material of a set of grains (docs/GRANULAR.md).

```ts
export interface SceneGrainMaterial {
    readonly density: number;
    readonly youngModulus?: number;
    readonly poissonRatio?: number;
    readonly restitution: number;
    readonly friction: number;
    readonly rollingFriction?: number;
}
```

### SceneGrains · interface

A set of spherical grains by the discrete element method, coupled two-way to rigid bodies (docs/GRANULAR.md). Numbers are float64.

```ts
export interface SceneGrains {
    readonly id: string;
    readonly material: SceneGrainMaterial;
    readonly law?: 'hertz' | 'linear';
    readonly normalStiffness?: number;
    readonly tangentialStiffnessRatio?: number;
    readonly tangentialDamping?: number;
    readonly skin?: number;
    readonly substeps: number;
    readonly backend?: 'cpu' | 'gpu';
    readonly bounds?: {
        readonly min: SceneVec3;
        readonly max: SceneVec3;
    };
    readonly positions: readonly number[];
    readonly radii: readonly number[];
    readonly velocities?: readonly number[];
    readonly angularVelocities?: readonly number[];
    readonly walls?: readonly SceneGrainWall[];
    readonly bodies?: readonly SceneGrainBody[];
}
```

### SceneGrainWall · interface

A fixed wall that only the grains feel. It is not a rigid body: nothing else collides with it.

```ts
export interface SceneGrainWall {
    readonly shape: SceneGrainWallShape;
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
}
```

### SceneGrainWallShape · type

The shape of a fixed wall of a grain set: the shapes of `Granular.addWall`.

```ts
export type SceneGrainWallShape = {
    readonly kind: 'plane';
    readonly normal: SceneVec3;
} | {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'cylinder';
    readonly radius: number;
    readonly from: number;
    readonly to: number;
    readonly axis?: SceneVec3;
} | {
    readonly kind: 'annulus';
    readonly innerRadius: number;
    readonly outerRadius: number;
    readonly offset?: number;
    readonly axis?: SceneVec3;
} | {
    readonly kind: 'frustum';
    readonly r0: number;
    readonly z0: number;
    readonly r1: number;
    readonly z1: number;
    readonly axis?: SceneVec3;
};
```

### sceneHasCoupling · function

True when a scene has a water basin, a cable, a frame, a cloth, a set of grains, a solid, a heat grid, a fluid or shallow water: it then needs a Simulation, not just a rigid world.

```ts
export declare function sceneHasCoupling(scene: SceneCoupledSections): boolean;
```

### sceneHash · function

SHA-256 of the compact canonical text (UTF-8), as 64 lowercase hex digits. Equal scenes have equal hashes.

```ts
export declare function sceneHash(scene: unknown): string;
```

### SceneHeat · interface

Heat conduction in a solid with a box mesh (docs/HEAT_TRANSFER.md): one cell per cell of the box. Its temperature is the solid's thermal load.

```ts
export interface SceneHeat {
    readonly id: string;
    readonly solid: string;
    readonly material: {
        readonly conductivity: number;
        readonly density: number;
        readonly specificHeat: number;
    };
    readonly temperature: number | readonly number[];
    readonly reference?: number;
    readonly scheme?: 'backward-euler' | 'crank-nicolson' | 'explicit';
    readonly substeps?: number;
    readonly boundaries?: readonly SceneHeatBoundary[];
}
```

### SceneHeatBoundary · type

A boundary condition of a heat grid (`HeatBoundary` of heat.ts), on the exposed faces of the cells in `region` (cell indices, inclusive; default all).

```ts
export type SceneHeatBoundary = {
    readonly face: 'x-' | 'x+' | 'y-' | 'y+' | 'z-' | 'z+';
    readonly region?: {
        readonly min: readonly [number, number, number];
        readonly max: readonly [number, number, number];
    };
} & ({
    readonly type: 'temperature';
    readonly temperature: number;
} | {
    readonly type: 'flux';
    readonly flux: number;
} | {
    readonly type: 'convection';
    readonly coefficient: number;
    readonly ambient: number;
} | {
    readonly type: 'radiation';
    readonly emissivity: number;
    readonly environment: number;
});
```

### SceneHost · interface

What a SceneBuilder needs from a world. The kit's PhysicsWorld has exactly
these members; the Lab wraps a NativeWorldBackend (src/lab/scene-host.ts).

```ts
export interface SceneHost {
    readonly loop: {
        readonly step: number;
    };
    readonly subSteps: number;
    readonly seed: number;
    readonly native: {
        readonly maxBodies: number;
        reserveBodyCapacity(bodies: number): unknown;
    };
    reset(options: {
        readonly ground?: boolean;
        readonly gravity?: SceneVec3;
        readonly seed?: number;
    }): unknown;
    createBody(options: NativeBodyDescriptor): NativeBodyHandle | null;
    createJoint(options: NativeJointDescriptor): NativeJointHandle;
    destroyBody(body: NativeBodyHandle): boolean;
    destroyJoint(joint: NativeJointHandle): boolean;
    isAlive(body: NativeBodyHandle): boolean;
    isJointAlive(joint: NativeJointHandle): boolean;
    getState(body: NativeBodyHandle): NativeBodyState;
    getMassData?(body: NativeBodyHandle): {
        readonly center: readonly number[];
    } | null;
    gravity(): [number, number, number];
    bodyCount(): number;
}
```

### SceneInertia · type

Rotational inertia of an attached body: the world reports mass only. Default: from the body's box, sphere or capsule shape.

```ts
export type SceneInertia = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'principal';
    readonly moments: SceneVec3;
} | {
    readonly kind: 'locked';
};
```

### SceneJoint · interface

```ts
export interface SceneJoint {
    readonly id: string;
    readonly type: SceneJointType;
    readonly bodyA: string | null;
    readonly bodyB: string | null;
    readonly frameA?: SceneFrame;
    readonly frameB?: SceneFrame;
    readonly collideConnected?: boolean;
    readonly limits?: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly motor?: {
        readonly speed: number;
        readonly maxForce: number;
    };
    readonly spring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly target?: number;
    };
    readonly length?: number;
    readonly coneAngle?: number;
    readonly stiffness?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly thresholds?: {
        readonly force?: number;
        readonly torque?: number;
        readonly breakable?: boolean;
    };
    readonly drive?: {
        readonly linearVelocity?: SceneVec3;
        readonly angularVelocity?: SceneVec3;
        readonly maxForce?: number;
        readonly maxTorque?: number;
        readonly linearSpring?: {
            readonly hertz: number;
            readonly dampingRatio: number;
            readonly maxForce: number;
        };
        readonly angularSpring?: {
            readonly hertz: number;
            readonly dampingRatio: number;
            readonly maxTorque: number;
        };
    };
    readonly maxTorque?: number;
    readonly steering?: {
        readonly angle: number;
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly maxTorque: number;
        readonly limits?: {
            readonly lower: number;
            readonly upper: number;
        };
    };
    readonly userData?: {
        readonly [key: string]: unknown;
    };
}
```

### SceneJointInput · type

A joint description for SceneBuilder.addJoint: a scene joint without its id; bodies are named by id.

```ts
export type SceneJointInput = Omit<SceneJoint, 'id'>;
```

### SceneJointType · type

```ts
export type SceneJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel' | 'motor' | 'parallel' | 'filter';
```

### SceneMassData · interface

Explicit mass data of a body (scene version 2).

```ts
export interface SceneMassData {
    readonly mass: number;
    readonly center?: SceneVec3;
    readonly inertia: readonly [number, number, number, number, number, number];
}
```

### SceneMaterial · interface

```ts
export interface SceneMaterial {
    readonly density: number;
    readonly friction: number;
    readonly restitution: number;
    readonly color?: number;
}
```

### SceneMeta · interface

```ts
export interface SceneMeta {
    readonly title?: string;
    readonly description?: string;
    readonly author?: string;
    readonly created?: string;
}
```

### SceneProblem · interface

One validation finding. `path` is a JSON pointer (RFC 6901) into the scene; '' is the scene itself.

```ts
export interface SceneProblem {
    readonly path: string;
    readonly message: string;
}
```

### SceneQuat · type

```ts
export type SceneQuat = readonly [number, number, number, number];
```

### SceneShallowWater · interface

Shallow water on terrain (docs/SHALLOW_WATER.md): the Saint-Venant equations on `cells` = [nx, nz] cells of `spacing`
metres in plan, from `origin` = [x, z]; world y is up, so gravity must point down. Numbers are float64.
The bed is `bed` (nx * nz heights at cell centres, x fastest; default 0). The water starts from `depth` (nx * nz
values), or from a flat `level` filled over the bed, or dry. Friction is Manning's n, infiltration Green-Ampt.
Saved state: `depth`, `qx`, `qz` (discharge per width, m^2/s) and `infiltrated` (m) per cell.

```ts
export interface SceneShallowWater {
    readonly id: string;
    readonly cells: readonly [number, number];
    readonly spacing: number | readonly [number, number];
    readonly origin?: readonly [number, number];
    readonly bed?: readonly number[];
    readonly level?: number;
    readonly depth?: readonly number[];
    readonly qx?: readonly number[];
    readonly qz?: readonly number[];
    readonly infiltrated?: readonly number[];
    readonly manning?: number | readonly number[];
    readonly soil?: {
        readonly conductivity: number;
        readonly suction: number;
        readonly moistureDeficit: number;
    };
    readonly rain?: number;
    readonly boundaries?: {
        readonly xMin?: SceneShallowWaterSide;
        readonly xMax?: SceneShallowWaterSide;
        readonly zMin?: SceneShallowWaterSide;
        readonly zMax?: SceneShallowWaterSide;
    };
    readonly density?: number;
    readonly substeps?: number;
    readonly order?: 1 | 2;
    readonly bodies?: readonly SceneShallowWaterBody[];
    readonly backend?: 'cpu' | 'gpu';
}
```

### SceneShallowWaterBody · interface

A body floating in shallow water (a dynamic box or sphere).

```ts
export interface SceneShallowWaterBody {
    readonly body: string;
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
}
```

### SceneShallowWaterSide · type

A side of a shallow-water grid. An inflow brings `discharge` m^3/s, spread by width over the side or over the cells whose centres lie in `span` (world z for an x side, world x for a z side).

```ts
export type SceneShallowWaterSide = 'wall' | 'open' | {
    readonly type: 'inflow';
    readonly discharge: number;
    readonly depth?: number;
    readonly span?: readonly [number, number];
} | {
    readonly type: 'stage';
    readonly level: number;
};
```

### SceneShape · type

```ts
export type SceneShape = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: readonly number[];
}
| {
    readonly kind: 'compound';
    readonly shapes: readonly SceneCompoundChild[];
} | {
    readonly kind: 'mesh';
    readonly vertices: readonly number[];
    readonly indices: readonly number[];
} | {
    readonly kind: 'heightfield';
    readonly heights: readonly number[];
    readonly countX: number;
    readonly countZ: number;
    readonly spacing: readonly [number, number];
};
```

### SceneSolid · interface

A deformable tetrahedral solid (docs/SOLID_MECHANICS.md), optionally in contact with rigid bodies or cracking. Numbers are float64.

```ts
export interface SceneSolid {
    readonly id: string;
    readonly mesh: SceneSolidMesh;
    readonly material: {
        readonly youngModulus: number;
        readonly poissonRatio: number;
        readonly density: number;
        readonly thermalExpansion?: number;
    };
    readonly model?: 'linear' | 'corotational' | 'neo-hookean';
    readonly integrator?: 'backward-euler' | 'midpoint' | 'explicit';
    readonly substeps?: number;
    readonly massDamping?: number;
    readonly stiffnessDamping?: number;
    readonly tolerance?: number;
    readonly maxNewtonIterations?: number;
    readonly gravity?: boolean;
    readonly supports?: readonly SceneSolidSupport[];
    readonly contact?: SceneSolidContact;
    readonly welds?: readonly SceneSolidWeld[];
    readonly loads?: readonly SceneSolidLoad[];
    readonly fracture?: SceneSolidFracture;
    readonly displacements?: readonly number[];
    readonly velocities?: readonly number[];
    readonly cracks?: readonly SceneSolidCrack[];
}
```

### SceneSolidBody · interface

A box, sphere or capsule body the solid touches (docs/SOLID_CONTACT.md).

```ts
export interface SceneSolidBody {
    readonly body: string;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneSolidContact · interface

Contact of a solid with rigid bodies and fixed planes, two-way (`SolidCoupling`), or with other solids and itself
(`SolidSolidContact`, docs/SOLID_CONTACT.md): solids joined by `solids` form a group that is advanced in one solve. A
solid of a group collides with the group's solids and planes only: no `bodies`, welds, loads or fracture.

```ts
export interface SceneSolidContact {
    readonly bodies?: readonly SceneSolidBody[];
    readonly planes?: readonly SceneClothPlane[];
    readonly solids?: readonly string[];
    readonly self?: boolean;
    readonly friction?: number;
    readonly stiffnessScale?: number;
    readonly skin?: number;
    readonly frictionPasses?: number;
    readonly frictionTolerance?: number;
}
```

### SceneSolidCrack · interface

A saved interface of a cracked solid (`FractureBody.crackState`).

```ts
export interface SceneSolidCrack {
    readonly face: number;
    readonly history: readonly [number, number, number];
    readonly mix?: number;
    readonly open?: boolean;
}
```

### SceneSolidFracture · interface

Cohesive fracture of a solid (docs/SOLID_FRACTURE.md). The solid is then a `FractureBody`: linear elements.

```ts
export interface SceneSolidFracture {
    readonly strength: number;
    readonly toughness: number;
    readonly shearWeight?: number;
    readonly initialOpeningRatio?: number;
    readonly insertion?: 'on-demand' | 'manual';
    readonly insertionThreshold?: number;
    readonly tipInsertionThreshold?: number;
    readonly notches?: readonly SceneSolidRegion[];
    readonly interfaces?: readonly SceneSolidRegion[];
}
```

### sceneSolidGroups · function

The solids of a scene that collide with each other, as groups in the scene's order: each group is advanced by one
`SolidSolidContact`. A solid with `contact.self` alone is a group of one.

```ts
export declare function sceneSolidGroups(solids: readonly SceneSolid[]): string[][];
```

### SceneSolidLoad · interface

The force that holds `body` up (measured from its motion: m (dv / dt - g)) is put, reversed, on the solid's boundary faces in the box as a uniform traction.

```ts
export interface SceneSolidLoad extends SceneSolidRegion {
    readonly body: string;
}
```

### SceneSolidMesh · type

The tetrahedral mesh of a solid: a box split into tetrahedra (`boxMesh` of solid.ts), or the nodes and tetrahedra themselves.

```ts
export type SceneSolidMesh = {
    readonly box: {
        readonly size: SceneVec3;
        readonly cells: readonly [number, number, number];
        readonly origin?: SceneVec3;
        readonly pattern?: 'alternating5' | 'kuhn6';
    };
} | {
    readonly positions: readonly number[];
    readonly tets: readonly number[];
};
```

### SceneSolidRegion · interface

A box of reference positions, m: a node, face or face centroid is in it when min <= x <= max on every axis.

```ts
export interface SceneSolidRegion {
    readonly min: SceneVec3;
    readonly max: SceneVec3;
}
```

### SceneSolidSupport · interface

Nodes in the box are held where they are. `axes` says which components; default all three.

```ts
export interface SceneSolidSupport extends SceneSolidRegion {
    readonly axes?: readonly [boolean, boolean, boolean];
}
```

### SceneSolidWeld · interface

Nodes of the solid in the box are welded to the body where they are when the scene is built. The body must be in `contact.bodies`.

```ts
export interface SceneSolidWeld extends SceneSolidRegion {
    readonly body: string;
}
```

### SceneValidationError · class

Thrown by loadScene, canonicalize, the builder and the link functions for an invalid scene. `code` is 'INVALID_PAYLOAD'.

```ts
export declare class SceneValidationError extends EngineError {
  readonly problems: readonly SceneProblem[];
}
```

### SceneVec3 · type

```ts
export type SceneVec3 = readonly [number, number, number];
```

### SceneWater · interface

One closed, flat-bottom shallow-water basin (docs/WATER_COUPLING.md). Numbers here are float64.

```ts
export interface SceneWater {
    readonly id: string;
    readonly cols: number;
    readonly rows: number;
    readonly dx: number;
    readonly dz: number;
    readonly restDepth: number;
    readonly origin: SceneVec3;
    readonly density?: number;
    readonly waterDrag?: number;
    readonly eta?: readonly number[];
    readonly u?: readonly number[];
    readonly v?: readonly number[];
    readonly bodies?: readonly SceneWaterBody[];
}
```

### SceneWaterBody · interface

Per-body drag settings of a body in a water basin. Omitted values take the coupling's defaults.

```ts
export interface SceneWaterBody {
    readonly body: string;
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
    readonly linearDrag?: number;
    readonly angularDrag?: number;
}
```

### SceneWorld · interface

```ts
export interface SceneWorld {
    readonly gravity?: SceneVec3;
    readonly ground?: boolean;
    readonly seed?: number;
    readonly step?: number;
    readonly subSteps?: number;
}
```

### sceneWorldOptions · function

The options to create a world that can load this scene: `createWorld(sceneWorldOptions(scene))`.

```ts
export declare function sceneWorldOptions(scene: Scene): {
    step: number;
    subSteps: number;
    seed: number;
    gravity: [number, number, number];
    ground: boolean;
};
```

### softBlocksScene · function

Soft blocks: two rubber-like cubes (E = 0.3 and 0.15 MPa, nu = 0.4) stacked on the ground plane and a stiffer third
(E = 1 MPa) dropped on them off centre. Deformable against deformable contact with friction, the three solids in one
solve (`contact.solids`, docs/SOLID_CONTACT.md); no rigid body takes part.

```ts
export declare function softBlocksScene(options?: {
    cells?: number;
    drop?: number;
}): Scene;
```

### sphereSettlingScene · function

A PTFE ball (2200 kg/m^3) settling through a syrup (rho = 1380 kg/m^3, mu = 2.5 Pa s, a corn-syrup-like liquid) in
a square column 0.12 m wide: the ball is a body of the rigid world and a moving obstacle in the flow (FluidCoupling),
which hands it the drag and the buoyancy. It reaches a terminal velocity within a few centimetres, far below Stokes's
2 (rho_s - rho) g a^2 / (9 mu) because the walls are 1.2 diameters from it, and lands on the floor. 12 x 30 x 12
cells of 10 mm (2.5 cells per radius). The world steps at 1/120 s: the coupling is explicit and must step below the
ball's response time in the column (about 0.03 s).

```ts
export declare function sphereSettlingScene(options?: {
    radius?: number;
    density?: number;
    viscosity?: number;
}): Scene;
```

### suspendedPlatformScene · function

A platform hung on four cables from fixed anchors, loaded by `boxes` boxes that fall on it one after another.
The cables are tension-only and compliant (docs/COMPLIANT_CABLE.md), coupled two-way to the platform, and hang from
the tops of four posts; the boxes are
ordinary rigid bodies, so the platform swings, tilts and stretches its cables under them.

```ts
export declare function suspendedPlatformScene(options?: {
    boxes?: number;
    axialRigidity?: number;
    drop?: number;
}): Scene;
```

### terrainCarScene · function

A four-wheel car on wheel joints (suspension spring, travel limits, spin
motor) driving over a rolling height-field terrain. There is no ground slab:
the terrain is the floor.

```ts
export declare function terrainCarScene(options?: {
    speed?: number;
    bump?: number;
}): Scene;
```

### trampolineScene · function

A trampoline: a square cloth of `cells` x `cells` cells and side `side`, held along its four edges at height
`height` between four posts, with a ball and a box dropped on it. The cloth and the two bodies are solved together
(docs/CLOTH.md), so the bodies bounce, settle into the sag and are carried by it.

```ts
export declare function trampolineScene(options?: {
    cells?: number;
    side?: number;
    height?: number;
    ballRadius?: number;
    ballDensity?: number;
}): Scene;
```

### validateScene · function

Check a scene completely, before anything is built. Returns every problem
found (at most SCENE_LIMITS.problems), each with a JSON-pointer path; an
empty list means the scene is valid. Never throws, whatever it is given.

```ts
export declare function validateScene(scene: unknown): SceneProblem[];
```

### vehicleTerrainScene · function

A car to drive on rolling terrain: a 1,200 kg chassis on four wheel joints with a physical suspension (60 kN/m and
5 kN s/m per wheel, turned into each joint's own frequency by suspensionJointSpring), steering on the front wheels,
on a 128 m square of terrain. The chassis' userData says how to drive it and the joints' userData which wheel each
is; SceneRoles adopts them as a Vehicle. Left alone it holds 6 m/s on half lock: a circle of about
wheelbase / tan(0.25 rad) = 10 m radius. Scene version 3 (wheel steering).

```ts
export declare function vehicleTerrainScene(options?: {
    bump?: number;
}): Scene;
```

## `box3d-webgpu-kit/scene-format`

### breakableBridgeScene · function

A plank bridge whose welds break: eight 135 kg planks welded end to end between two abutments, a 300 kg block
dropped onto the middle from 2 m. Scene version 3 (joint thresholds).

At rest the bridge is a beam built in at both ends, made of n rigid links on n + 1 soft welds. The shear at a
support is half the weight, w L / 2. The moments follow from the welds' rotations adding up to zero; a Box3D
joint spring acts on the joint's own effective inertia, so the two end welds (plank to abutment) are twice as stiff
as the others (plank to plank), which gives a support moment of w l^2 (n^2 - 1) / 12 (the continuous beam's
w L^2 / 12 as n grows). Here: 5,297 N and 6,953 N m; packages/box3d-kit/test/v22-rigid-examples.test.mjs measures both. Every weld breaks
at six times that shear or three times that moment, so the bridge carries itself with a margin and not the block.

```ts
export declare function breakableBridgeScene(options?: {
    blockMass?: number;
    drop?: number;
}): Scene;
```

### bulletPlatesScene · function

Continuous collision in three lanes, at 60 Hz: steel balls at 150 m/s (2.5 m per step) against rows of thin plates.
Lane 1: free plates and an ordinary ball, which passes through all of them (two moving bodies are not swept).
Lane 2: the same with `bullet: true` on the ball, which hits the first plate. Lane 3: a thin static wall, which
stops an ordinary ball (moving bodies are swept against static ones).

```ts
export declare function bulletPlatesScene(options?: {
    speed?: number;
}): Scene;
```

### buoyAndCratesScene · function

The moored buoy released 0.4 m to the side, with `crates` wooden boxes dropped into the same basin: the buoy
swings back on its cable while the crates make waves, bob and drift. Water, a cable and floating bodies in one scene.

```ts
export declare function buoyAndCratesScene(options?: {
    offset?: number;
    crates?: number;
}): Scene;
```

### cableStayedDeckScene · function

A small cable-stayed deck: an 8 m steel beam of 8 elements on a pin and a
roller, two stays from a fixed tower top 3 m above midspan to the deck at
2 m and 6 m, and a ball pinned to deck node `loadNode` (1 to 7). It is the
span of the structure-coupling validation, so its stay tensions and its
deflection have a hand solution (docs/STRUCTURE_COUPLING.md).

```ts
export declare function cableStayedDeckScene(options?: {
    loadNode?: number;
    ballRadius?: number;
    ballDensity?: number;
    stayRigidity?: number;
    drag?: number;
}): Scene;
```

### canonicalize · function

The canonical text of a scene: its normal form (see normalizeScene) as JSON
with sorted keys, no whitespace, and numbers in their shortest round-trip
form. Two scenes that describe the same thing give the same text, whatever
their key order. `pretty: true` gives the same content on several lines
(one key per line, arrays of numbers on one line) for reading and diffing;
hashes and links always use the compact text.

```ts
export declare function canonicalize(scene: unknown, options?: {
    readonly pretty?: boolean;
}): string;
```

### cavityFlowScene · function

The lid-driven cavity: a cube of oil 0.1 m on a side (rho = 900 kg/m^3, mu = 0.09 Pa s) whose top wall slides at
0.1 m/s, Re = 100. The flow turns into one large vortex with small ones in the lower corners (the 2D case is checked
against Ghia, Ghia & Shin 1982 in docs/FLUID.md; this one is 3D, with side walls). 16^3 cells.

```ts
export declare function cavityFlowScene(options?: {
    cells?: number;
    lidSpeed?: number;
}): Scene;
```

### COUPLED_EXAMPLE_SCENES · const

```ts
export declare const COUPLED_EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### damBreakScene · function

A dam break in three dimensions: a column of water 0.18 m by 0.09 m and 0.3 m tall stands in one corner of a tank
0.6 x 0.36 x 0.18 m and is let go at t = 0. It spreads over the floor, runs to the far wall, climbs it and falls back.
Free surface by particles (APIC), eight per cell; inviscid; closed free-slip tank. 20 x 12 x 6 cells of 30 mm,
1,440 particles, two fluid steps per world step.

```ts
export declare function damBreakScene(options?: {
    width?: number;
    depth?: number;
    height?: number;
}): Scene;
```

### damBreakValleyScene · function

A dam break down a valley (shallow water, docs/SHALLOW_WATER.md): a reservoir 2 m deep behind a dam at x = 6 m lets go
into a dry valley 30 m long that falls 1 in 100 and has 1 in 4 sides; Manning n 0.03 (Chow 1959, earth channel), an
open outlet at the far end, and three crates afloat in the reservoir that ride the flood. The terrain is also a height
field of the rigid world, so the crates ground where the water leaves them.

```ts
export declare function damBreakValleyScene(options?: {
    depth?: number;
    crates?: number;
}): Scene;
```

### decodeSceneLink · function

Unpack a share link into a validated scene. Accepts the bare string or any
text that contains it, such as a whole URL. Synchronous and self-contained:
the DEFLATE decoder is built in, so a compressed link opens on platforms
without DecompressionStream. Throws EngineError('INVALID_PAYLOAD') for a link
that is too long, cut off, altered (CRC or length mismatch), of an unknown
version, or that would decompress to more than it declares
(SCENE_LIMITS.linkSceneBytes at most), and SceneValidationError when the
JSON inside is not a valid scene.

```ts
export declare function decodeSceneLink(text: string): Scene;
```

### dominoRunScene · function

A straight run of `count` dominoes on the ground; the first leans past its tipping point and starts the run.

```ts
export declare function dominoRunScene(options?: {
    count?: number;
    spacing?: number;
}): Scene;
```

### encodeSceneLink · function

Pack a scene into a URL-safe string:

    b3s1 <mode> . <length> . <crc> . <data>

- `mode`: `d` when `data` is raw DEFLATE (RFC 1951), `r` when it is stored as is;
- `length`: UTF-8 byte length of the canonical JSON, in lowercase base 36;
- `crc`: CRC-32 (IEEE 802.3, as in zip and PNG) of those bytes, 8 lowercase hex digits;
- `data`: base64url (RFC 4648 section 5) without padding.

Only `A-Z a-z 0-9 - _ .` appear, so the string needs no escaping in a query
or fragment. Compression uses the platform's `CompressionStream('deflate-raw')`;
where that is missing, or when the result is not smaller, or with
`compress: false`, the link stores the JSON uncompressed (mode `r`).

```ts
export declare function encodeSceneLink(scene: unknown, options?: {
    readonly compress?: boolean;
}): Promise<string>;
```

### encodeSceneLinkSync · function

The synchronous form of encodeSceneLink: always mode `r` (stored, not compressed). Works everywhere.

```ts
export declare function encodeSceneLinkSync(scene: unknown): string;
```

### eulerToQuaternion · function

Degrees about X, Y, Z to a quaternion, q = qx qy qz (a vector is turned about Z first, then Y, then X: the three.js 'XYZ' order).

```ts
export declare function eulerToQuaternion(degrees: SceneVec3): [number, number, number, number];
```

### EXAMPLE_SCENES · const

Every example by name, each called with its defaults.

```ts
export declare const EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### flowPastCylinderScene · function

Flow past a cylinder at Re = 20, in two dimensions: a slab one cell thick (periodic in z) of a liquid with
nu = 4e-5 m^2/s enters at 40 mm/s on the left and leaves on the right (p = 0), with free-slip top and bottom. The
cylinder (20 mm across, 6 cells) is a static capsule of the rigid world lying across the slab. Behind it a pair of
standing vortices forms; the flow does not shed at this Reynolds number. The channel is 5.3 diameters tall (19%
blockage). Gravity is off in the fluid: the flow is horizontal and an outflow side cannot hold a hydrostatic pressure.

```ts
export declare function flowPastCylinderScene(options?: {
    speed?: number;
    reynolds?: number;
}): Scene;
```

### heatedBarScene · function

A heated bar: an aluminium bar (k = 237 W/(m K), alpha_T = 23e-6 /K, E = 70 GPa) clamped at both ends between
a hot block at 500 K and a cold one at 300 K. Its temperature rises from the hot end and settles to a linear
ramp in about 20 s; the restrained expansion puts it in compression.

```ts
export declare function heatedBarScene(options?: {
    hot?: number;
    cold?: number;
    cells?: number;
}): Scene;
```

### hopperSeesawScene · function

A hopper over a see-saw: `count` beads fill a conical hopper and run out of its orifice into a tray on one end of a
plank that turns on a hinge; a counterweight sits on the other end. When enough beads have landed the plank tips.
The beads are soft spheres by the discrete element method (docs/GRANULAR.md), linear contact law; the hopper is a
fixed wall that only the beads feel, the plank, the tray walls and the counterweight are rigid bodies.

```ts
export declare function hopperSeesawScene(options?: {
    count?: number;
    radius?: number;
    orifice?: number;
    counterweight?: number;
}): Scene;
```

### laserScannerScene · function

A ray-cast scanner among assorted bodies: the 'scanner' body's userData asks the Lab for a fan of rays, turning
slowly, cast in one batched call per step and drawn as beams to their hit points. A swinging pendulum and a ball
cross the beams.

```ts
export declare function laserScannerScene(options?: {
    rays?: number;
    range?: number;
}): Scene;
```

### LoadedScene · interface

```ts
export interface LoadedScene<W extends SceneHost = SceneHost> {
    readonly bodies: Map<string, Body>;
    readonly joints: Map<string, Joint>;
    readonly builder: SceneBuilder<W>;
    readonly scene: Scene;
}
```

### loadScene · function

Validate a scene, reset the world to its settings and build every body, then
every joint, in file order. The world's body capacity is raised first when
the scene needs more than it has.

- An invalid scene throws SceneValidationError (code 'INVALID_PAYLOAD',
  `problems` holds the full list) and the world is NOT touched.
- A world created with another step or sub-step count throws
  EngineError('INVALID_STATE') and is not touched: create it with
  `createWorld(sceneWorldOptions(scene))`.
- If the engine refuses a body or joint part-way, the world is left reset to
  the scene's settings with none of the scene's bodies in it, and the error
  names the offending id.
- A scene with `water`, `cables`, `frames`, `cloths` or `grains` throws EngineError('INVALID_STATE')
  and the world is not touched: this loader has no solvers for them.

```ts
export declare function loadScene<W extends SceneHost>(world: W, scene: unknown): LoadedScene<W>;
```

### mooredBuoyScene · function

A buoy moored to the bed: a sphere of radius `radius` and density `density`
floats in an 8 m x 8 m basin `depth` deep and is held under its free
waterline by one compliant cable (rest length `cableLength`, axial rigidity
`axialRigidity` in newtons) from a fixed anchor on the bed to its centre.
`offset` moves the buoy sideways at the start. At rest the cable tension is
the buoyancy minus the weight of the buoy and of the cable's upper node.

```ts
export declare function mooredBuoyScene(options?: {
    radius?: number;
    density?: number;
    depth?: number;
    cableLength?: number;
    axialRigidity?: number;
    offset?: number;
    linearDrag?: number;
    waterDrag?: number;
    lineDensity?: number;
}): Scene;
```

### newtonsCradleScene · function

Newton's cradle: `count` steel balls hanging on rigid hinges in a row with a
small gap, the first one raised by `angle`. Perfectly elastic and
frictionless, so the last ball leaves at the first ball's speed (measured:
99.5% of it with the defaults). Keep the impact above about 1 m/s: the
engine applies no restitution to slow contacts (a 0.44 m/s impact passed on
only 23%), and the balls must not touch at rest (`gap` > 0).

```ts
export declare function newtonsCradleScene(options?: {
    count?: number;
    radius?: number;
    length?: number;
    angle?: number;
    gap?: number;
}): Scene;
```

### normalizeScene · function

The normal form of a valid scene, as a new object: every world setting
present, `rotationEuler` turned into `rotation`, values equal to the engine
defaults dropped, -0 written as 0, `units`, `materials` and `joints` always
present; `water`, `cables` and `frames` present only when they hold something.
Body and joint order is kept, because it is the build order. Throws
SceneValidationError for an invalid scene. Normalising twice changes nothing.

```ts
export declare function normalizeScene(scene: unknown): Scene;
```

### notchedBeamScene · function

A notched concrete beam loaded by a falling weight (a 200 kg drop hammer from 1.5 m, on a guide). The beam (E = 30 GPa, sigma_c = 3 MPa, G_c = 100 J/m^2)
is pinned along both ends of its base, cut by a notch at mid-span and given cohesive interfaces on the
section above it. The weight falls on a steel platen over mid-span; the force that holds the weight up is put
on the beam's top under the platen (one-way, `reactionLoadLink`). The impact cracks the section from the notch.

```ts
export declare function notchedBeamScene(options?: {
    mass?: number;
    drop?: number;
    cells?: number;
}): Scene;
```

### obstacleCourseScene · function

An obstacle course for the capsule character: four stairs up to a deck, a 25 degree ramp back down, a crate to push,
a ledge onto a slab, a platform that drifts sideways under the walker, and a 60 degree slope and a wall it cannot
climb. The body 'hero' is the character: a kinematic capsule that collides with nothing (the controller moves it and
does the colliding), with the controller's settings and a walking route in its userData.

```ts
export declare function obstacleCourseScene(options?: {
    speed?: number;
}): Scene;
```

### pendulumWaveScene · function

A pendulum wave: `count` spheres on revolute joints whose lengths are chosen
so that pendulum k swings `swings + k` times in `cycle` seconds; they drift
out of phase and realign after one cycle. Each bob's `userData` holds its
`length` (pivot to centre), small-angle `period` and release `angle`.
The lengths include the sphere's own inertia: T = 2 pi sqrt((L^2 + 2 r^2 / 5) / (g L)).

```ts
export declare function pendulumWaveScene(options?: {
    count?: number;
    cycle?: number;
    swings?: number;
    radius?: number;
    angle?: number;
}): Scene;
```

### quenchedPlateScene · function

Thermal shock: an alumina plate at 600 K (E = 370 GPa, nu = 0.22, alpha_T = 8e-6 /K, sigma_c = 300 MPa,
G_c = 40 J/m^2, k = 30 W/(m K)) whose face x = 0 is quenched by a film coefficient of 20,000 W/(m^2 K) to
300 K. As quenchedPlate() in solid-fracture.ts, with 6 mm cells instead of 0.25 mm: held in its plane
(rollers on the y and z faces and the back face), the cooled layer cracks in tension from about 1.2 s.

```ts
export declare function quenchedPlateScene(options?: {
    cells?: readonly [number, number, number];
    cellSize?: number;
    coefficient?: number;
}): Scene;
```

### ragdollScene · function

A ragdoll: a capsule torso, a sphere head and eight capsule limb segments on
nine spherical joints with cone and twist limits, dropped from `height`
metres above the ground with a slight forward tumble.

```ts
export declare function ragdollScene(options?: {
    height?: number;
}): Scene;
```

### RIGID_CORE_EXAMPLE_SCENES · const

The rigid-core examples by name, each called with its defaults.

```ts
export declare const RIGID_CORE_EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
```

### riverBendScene · function

A river bend (shallow water): a channel that meanders down a 1 in 200 floodplain, fed 1.2 m^3/s at the upstream end,
with banks 0.5 m high, grass on the floodplain (n 0.035) and a clean channel (n 0.03) (Chow 1959, natural streams and
floodplains, normal values), an open outlet, and a log floating down it.

```ts
export declare function riverBendScene(options?: {
    discharge?: number;
}): Scene;
```

### rubberPadScene · function

A rubber pad under a dropped box: a neo-Hookean pad (E = 1.5 MPa, nu = 0.45) welded along its base to a
steel plate, and a box that falls on it, bounces on it and comes to rest pressed into it. Solid contact,
two-way, with friction (docs/SOLID_CONTACT.md).

```ts
export declare function rubberPadScene(options?: {
    cells?: number;
    drop?: number;
    mass?: number;
}): Scene;
```

### saveScene · function

The scene a builder (or the result of loadScene) describes, with each body's
current state: see SceneBuilder.toJSON for exactly what is and is not saved.

```ts
export declare function saveScene<W extends SceneHost>(world: W, handles: SceneBuilder<W> | {
    readonly builder: SceneBuilder<W>;
}, options?: SaveSceneOptions): Scene;
```

### SaveSceneOptions · interface

```ts
export interface SaveSceneOptions {
    readonly state?: boolean;
    readonly meta?: SceneMeta;
}
```

### Scene · interface

```ts
export interface Scene {
    readonly format: 'box3d-scene';
    readonly version: 1 | 2 | 3;
    readonly units?: 'SI';
    readonly world?: SceneWorld;
    readonly materials?: {
        readonly [name: string]: SceneMaterial;
    };
    readonly bodies: readonly SceneBody[];
    readonly joints?: readonly SceneJoint[];
    readonly water?: readonly SceneWater[];
    readonly cables?: readonly SceneCable[];
    readonly frames?: readonly SceneFrameSection[];
    readonly cloths?: readonly SceneCloth[];
    readonly grains?: readonly SceneGrains[];
    readonly solids?: readonly SceneSolid[];
    readonly heat?: readonly SceneHeat[];
    readonly fluids?: readonly SceneFluid[];
    readonly shallowWater?: readonly SceneShallowWater[];
    readonly meta?: SceneMeta;
    readonly extensions?: {
        readonly [key: string]: unknown;
    };
}
```

### SCENE_FORMAT · const

```ts
export declare const SCENE_FORMAT = "box3d-scene";
```

### SCENE_LIMITS · const

Hard limits a scene file must respect. `validateScene` reports each one by path.

```ts
export declare const SCENE_LIMITS: Readonly<{
    bodies: 65536;
    joints: 65536;
    materials: 1024;
    idLength: 64;
    hullPoints: 4096;
    compoundShapes: 64;
    meshVertices: 1048576;
    meshTriangles: 2097152;
    heightfieldSide: 4096;
    geometryValues: 8000000;
    userDataChars: 65536;
    depth: 32;
    metaChars: 4096;
    waterBasins: 8;
    waterCells: 65536;
    cables: 1024;
    cableNodes: 16384;
    frames: 64;
    frameNodes: 4096;
    frameElements: 8192;
    frameBodyEquations: 96;
    cloths: 16;
    clothNodes: 16384;
    clothTriangles: 32768;
    grainSets: 8;
    grains: 65536;
    grainWalls: 256;
    grainSubsteps: 4096;
    solids: 8;
    solidNodes: 20000;
    solidTets: 60000;
    solidSubsteps: 64;
    heat: 8;
    heatSubsteps: 256;
    fluids: 4;
    fluidCells: 262144;
    fluidParticles: 262144;
    fluidSubsteps: 64;
    fluidLiquid: 16;
    shallowWater: 4;
    shallowWaterCells: 262144;
    shallowWaterSubsteps: 64;
    solidRegions: 64;
    solidCracks: 60000;
    problems: 100;
    linkChars: 1048576;
    linkSceneBytes: 4194304;
}>;
```

### SCENE_LINK_PREFIX · const

Every share link of this version starts with this, followed by 'd' (raw DEFLATE) or 'r' (stored).

```ts
export declare const SCENE_LINK_PREFIX = "b3s1";
```

### SCENE_VERSION · const

The newest scene version this build reads and writes. A scene that needs nothing newer than version 1 is written as version 1.

```ts
export declare const SCENE_VERSION = 3;
```

### SCENE_VERSIONS · const

Every scene version this build reads. Version 2 adds compound shapes and `massData`; version 3 adds the joint
types 'motor', 'parallel' and 'filter' and the joint settings `thresholds`, `drive`, `maxTorque` and `steering`.
Nothing else differs.

```ts
export declare const SCENE_VERSIONS: readonly number[];
```

### SceneBody · interface

```ts
export interface SceneBody {
    readonly id: string;
    readonly shape: SceneShape;
    readonly type?: SceneBodyType;
    readonly position: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
    readonly linearVelocity?: SceneVec3;
    readonly angularVelocity?: SceneVec3;
    readonly material?: string;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly color?: number;
    readonly bullet?: boolean;
    readonly sensor?: boolean;
    readonly hitEvents?: boolean;
    readonly neverSleeps?: boolean;
    readonly lockRotation?: boolean;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly filter?: SceneFilter;
    readonly massData?: SceneMassData;
    readonly userData?: {
        readonly [key: string]: unknown;
    };
}
```

### SceneBodyInput · type

A body description for SceneBuilder.addBody: a scene body without its id, or a native body descriptor (bigint filter bits, typed arrays).

```ts
export type SceneBodyInput = Omit<SceneBody, 'id'> | NativeBodyDescriptor;
```

### SceneBodyType · type

```ts
export type SceneBodyType = 'static' | 'kinematic' | 'dynamic';
```

### SceneBuilder · class

A world plus the description of everything put into it. The world
cannot report shapes or joint definitions, so the builder remembers them as
it creates each body and joint, and `toJSON()` writes them back out with the
bodies' current poses and velocities.

Constructing a builder RESETS the world to the given settings. Create and
remove bodies and joints through the builder; what you change on the world
directly (setJointMotor, setDamping, setCollisionFilter, ...) is not seen,
except pose, velocity, body type and gravity, which are read back on save.

```ts
export declare class SceneBuilder<W extends SceneHost = SceneHost> {
  readonly world: W;
  meta: SceneMeta | undefined;
  extensions: { readonly [key: string]: unknown; } | undefined;
  coupledSections: SceneCoupledSections;
  coupledCapture: (() => SceneCoupledSections) | null;
  resetWorld(): void;
  defineMaterial(name: string, material: SceneMaterial): void;
  addBody(id: string, body: SceneBodyInput): Body;
  place(description: SceneBody): Body;
  addJoint(id: string, joint: SceneJointInput): Joint;
  connect(description: SceneJoint): Joint;
  remove(id: string): boolean;
  has(id: string): boolean;
  body(id: string): Body | undefined;
  joint(id: string): Joint | undefined;
  idOf(handle: Body | Joint): string | undefined;
  bodies(): Map<string, Body>;
  joints(): Map<string, Joint>;
  describe(id: string): SceneBody | SceneJoint | undefined;
  toJSON(options?: SaveSceneOptions): Scene;
  populate(scene: Scene): this;
}
```

### SceneCable · interface

A tension-only cable (docs/COMPLIANT_CABLE.md, docs/NONLINEAR_CABLE.md). It steps with the world's step and gravity. Numbers are float64.

```ts
export interface SceneCable {
    readonly id: string;
    readonly solver?: 'proximal' | 'xpbd';
    readonly nodes: readonly number[];
    readonly masses: readonly number[];
    readonly pinned?: readonly number[];
    readonly velocities?: readonly number[];
    readonly segments: readonly SceneCableSegment[];
    readonly substeps?: number;
    readonly maxIterations?: number;
    readonly residualTolerance?: number;
    readonly forceTolerance?: number;
    readonly drag?: number;
    readonly attachments?: readonly SceneCableAttachment[];
}
```

### SceneCableAttachment · interface

A free cable node attached to a point on a body (`body`), or to a frame node (`frame` and `frameNode`).

```ts
export interface SceneCableAttachment {
    readonly node: number;
    readonly body?: string;
    readonly frame?: string;
    readonly frameNode?: number;
    readonly inertia?: SceneInertia;
    readonly localPoint?: SceneVec3;
}
```

### SceneCableSegment · interface

```ts
export interface SceneCableSegment {
    readonly a: number;
    readonly b: number;
    readonly restLength: number;
    readonly compliance: number;
}
```

### SceneCloth · interface

A cloth coupled two-way to rigid bodies (docs/CLOTH.md). It steps with the world's step and gravity, backward Euler. Numbers are float64.

```ts
export interface SceneCloth {
    readonly id: string;
    readonly nodes: readonly number[];
    readonly restNodes?: readonly number[];
    readonly triangles: readonly number[];
    readonly velocities?: readonly number[];
    readonly material: SceneClothMaterial;
    readonly pinned?: readonly number[];
    readonly extraMass?: readonly number[];
    readonly drag?: number;
    readonly maxNewtonIterations?: number;
    readonly residualTolerance?: number;
    readonly forceTolerance?: number;
    readonly maxCgIterations?: number;
    readonly cgTolerance?: number;
    readonly contact?: {
        readonly offset?: number;
        readonly stiffness?: number;
        readonly skin?: number;
    };
    readonly selfCollision?: {
        readonly thickness: number;
        readonly stiffness?: number;
        readonly capacity?: number;
    };
    readonly bodies?: readonly SceneClothBody[];
    readonly planes?: readonly SceneClothPlane[];
    readonly attachments?: readonly SceneClothAttachment[];
}
```

### SceneClothAttachment · interface

A cloth node fixed to a point of one of the cloth's `bodies`.

```ts
export interface SceneClothAttachment {
    readonly node: number;
    readonly body: string;
    readonly localPoint?: SceneVec3;
}
```

### SceneClothBody · interface

A box, sphere or capsule body the cloth collides with and, when it is dynamic, pushes.

```ts
export interface SceneClothBody {
    readonly body: string;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneClothMaterial · interface

Material of a cloth (docs/CLOTH.md).

```ts
export interface SceneClothMaterial {
    readonly arealDensity: number;
    readonly youngModulus: number;
    readonly thickness: number;
    readonly poissonRatio: number;
    readonly membrane?: 'stvk' | 'spring';
    readonly bending?: 'koiter' | 'hinge' | 'none';
    readonly bendingStiffness?: number;
}
```

### SceneClothPlane · interface

A fixed half space the cloth cannot enter: everything behind `normal` through `point` (default the origin).

```ts
export interface SceneClothPlane {
    readonly normal: SceneVec3;
    readonly point?: SceneVec3;
    readonly friction?: number;
}
```

### SceneCompoundChild · interface

One shape of a compound body (scene version 2).

```ts
export interface SceneCompoundChild {
    readonly shape: SceneConvexShape;
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
    readonly density?: number;
    readonly friction?: number;
    readonly restitution?: number;
}
```

### SceneConvexShape · type

The shapes a compound may hold.

```ts
export type SceneConvexShape = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: readonly number[];
};
```

### SceneCoupledSections · interface

The optional coupled sections of a scene.

```ts
export interface SceneCoupledSections {
    readonly water?: readonly SceneWater[];
    readonly cables?: readonly SceneCable[];
    readonly frames?: readonly SceneFrameSection[];
    readonly cloths?: readonly SceneCloth[];
    readonly grains?: readonly SceneGrains[];
    readonly solids?: readonly SceneSolid[];
    readonly heat?: readonly SceneHeat[];
    readonly fluids?: readonly SceneFluid[];
    readonly shallowWater?: readonly SceneShallowWater[];
}
```

### SceneFilter · interface

```ts
export interface SceneFilter {
    readonly categoryBits?: string;
    readonly maskBits?: string;
    readonly groupIndex?: number;
}
```

### SceneFluid · interface

A volumetric fluid (docs/FLUID.md): a box of `cells` cubic cells of side `spacing` from `origin`. Numbers are float64.
- kind 'flow' (the default): incompressible Navier-Stokes with walls, inflows, outflows or periodic sides, and the
  listed bodies as moving obstacles (FluidCoupling). Saved state: the face velocities and the cell pressures.
- kind 'free-surface': an inviscid liquid carried by particles in a closed tank of free-slip walls, started from the
  `liquid` boxes. No bodies. Saved state: the particles.

```ts
export interface SceneFluid {
    readonly id: string;
    readonly kind?: 'flow' | 'free-surface';
    readonly cells: readonly [number, number, number];
    readonly spacing: number;
    readonly origin?: SceneVec3;
    readonly density: number;
    readonly substeps?: number;
    readonly viscosity?: number;
    readonly gravity?: boolean;
    readonly boundaries?: SceneFluidBoundaries;
    readonly advection?: 'central' | 'upwind';
    readonly diffusion?: 'explicit' | 'crank-nicolson' | 'backward-euler';
    readonly velocity?: SceneVec3;
    readonly bodies?: readonly SceneFluidBody[];
    readonly backend?: 'cpu' | 'gpu';
    readonly u?: readonly number[];
    readonly v?: readonly number[];
    readonly w?: readonly number[];
    readonly pressure?: readonly number[];
    readonly particlesPerAxis?: number;
    readonly liquid?: readonly SceneFluidLiquid[];
    readonly positions?: readonly number[];
    readonly velocities?: readonly number[];
    readonly affine?: readonly number[];
}
```

### SceneFluidBody · interface

A box, sphere or capsule body that is a moving obstacle in a flow and, when it is dynamic, feels its force.

```ts
export interface SceneFluidBody {
    readonly body: string;
    readonly twoWay?: boolean;
}
```

### SceneFluidBoundaries · interface

```ts
export interface SceneFluidBoundaries {
    readonly xMin?: SceneFluidSide;
    readonly xMax?: SceneFluidSide;
    readonly yMin?: SceneFluidSide;
    readonly yMax?: SceneFluidSide;
    readonly zMin?: SceneFluidSide;
    readonly zMax?: SceneFluidSide;
}
```

### SceneFluidLiquid · interface

A box of liquid a free-surface tank starts with, m.

```ts
export interface SceneFluidLiquid {
    readonly min: SceneVec3;
    readonly max: SceneVec3;
    readonly velocity?: SceneVec3;
}
```

### SceneFluidSide · type

A side of a fluid box (docs/FLUID.md, Boundaries): a type, or a no-slip wall that slides or an inflow, with its velocity.

```ts
export type SceneFluidSide = 'no-slip' | 'free-slip' | 'outflow' | 'periodic' | {
    readonly type: 'no-slip' | 'inflow';
    readonly velocity: SceneVec3;
};
```

### SceneFrame · interface

```ts
export interface SceneFrame {
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly rotationEuler?: SceneVec3;
}
```

### SceneFrameAttachment · interface

A frame node attached to a point on a body: 'pinned' (forces) or 'clamped' (forces and moments).

```ts
export interface SceneFrameAttachment {
    readonly node: number;
    readonly body: string;
    readonly mode?: 'pinned' | 'clamped';
    readonly inertia?: SceneInertia;
    readonly localPoint?: SceneVec3;
}
```

### SceneFrameElement · interface

```ts
export interface SceneFrameElement {
    readonly a: number;
    readonly b: number;
    readonly youngModulus: number;
    readonly shearModulus: number;
    readonly area: number;
    readonly iy: number;
    readonly iz: number;
    readonly torsionConstant: number;
    readonly density: number;
    readonly up: SceneVec3;
}
```

### SceneFrameSection · interface

A linear beam frame (docs/FRAME_MECHANICS.md). It steps with the world's step and gravity, one sub-step. Numbers are float64.

```ts
export interface SceneFrameSection {
    readonly id: string;
    readonly nodes: readonly number[];
    readonly elements: readonly SceneFrameElement[];
    readonly fixed?: readonly number[];
    readonly pointMasses?: readonly number[];
    readonly pointInertias?: readonly number[];
    readonly displacements?: readonly number[];
    readonly velocities?: readonly number[];
    readonly drag?: number;
    readonly maxIterations?: number;
    readonly forceTolerance?: number;
    readonly momentTolerance?: number;
    readonly impulseTolerance?: number;
    readonly angularImpulseTolerance?: number;
    readonly attachments?: readonly SceneFrameAttachment[];
}
```

### SceneGrainBody · interface

A box, sphere or capsule body the grains collide with and, when it is dynamic, push.

```ts
export interface SceneGrainBody {
    readonly body: string;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneGrainMaterial · interface

Material of a set of grains (docs/GRANULAR.md).

```ts
export interface SceneGrainMaterial {
    readonly density: number;
    readonly youngModulus?: number;
    readonly poissonRatio?: number;
    readonly restitution: number;
    readonly friction: number;
    readonly rollingFriction?: number;
}
```

### SceneGrains · interface

A set of spherical grains by the discrete element method, coupled two-way to rigid bodies (docs/GRANULAR.md). Numbers are float64.

```ts
export interface SceneGrains {
    readonly id: string;
    readonly material: SceneGrainMaterial;
    readonly law?: 'hertz' | 'linear';
    readonly normalStiffness?: number;
    readonly tangentialStiffnessRatio?: number;
    readonly tangentialDamping?: number;
    readonly skin?: number;
    readonly substeps: number;
    readonly backend?: 'cpu' | 'gpu';
    readonly bounds?: {
        readonly min: SceneVec3;
        readonly max: SceneVec3;
    };
    readonly positions: readonly number[];
    readonly radii: readonly number[];
    readonly velocities?: readonly number[];
    readonly angularVelocities?: readonly number[];
    readonly walls?: readonly SceneGrainWall[];
    readonly bodies?: readonly SceneGrainBody[];
}
```

### SceneGrainWall · interface

A fixed wall that only the grains feel. It is not a rigid body: nothing else collides with it.

```ts
export interface SceneGrainWall {
    readonly shape: SceneGrainWallShape;
    readonly position?: SceneVec3;
    readonly rotation?: SceneQuat;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
}
```

### SceneGrainWallShape · type

The shape of a fixed wall of a grain set: the shapes of `Granular.addWall`.

```ts
export type SceneGrainWallShape = {
    readonly kind: 'plane';
    readonly normal: SceneVec3;
} | {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'cylinder';
    readonly radius: number;
    readonly from: number;
    readonly to: number;
    readonly axis?: SceneVec3;
} | {
    readonly kind: 'annulus';
    readonly innerRadius: number;
    readonly outerRadius: number;
    readonly offset?: number;
    readonly axis?: SceneVec3;
} | {
    readonly kind: 'frustum';
    readonly r0: number;
    readonly z0: number;
    readonly r1: number;
    readonly z1: number;
    readonly axis?: SceneVec3;
};
```

### sceneHasCoupling · function

True when a scene has a water basin, a cable, a frame, a cloth, a set of grains, a solid, a heat grid, a fluid or shallow water: it then needs a Simulation, not just a rigid world.

```ts
export declare function sceneHasCoupling(scene: SceneCoupledSections): boolean;
```

### sceneHash · function

SHA-256 of the compact canonical text (UTF-8), as 64 lowercase hex digits. Equal scenes have equal hashes.

```ts
export declare function sceneHash(scene: unknown): string;
```

### SceneHeat · interface

Heat conduction in a solid with a box mesh (docs/HEAT_TRANSFER.md): one cell per cell of the box. Its temperature is the solid's thermal load.

```ts
export interface SceneHeat {
    readonly id: string;
    readonly solid: string;
    readonly material: {
        readonly conductivity: number;
        readonly density: number;
        readonly specificHeat: number;
    };
    readonly temperature: number | readonly number[];
    readonly reference?: number;
    readonly scheme?: 'backward-euler' | 'crank-nicolson' | 'explicit';
    readonly substeps?: number;
    readonly boundaries?: readonly SceneHeatBoundary[];
}
```

### SceneHeatBoundary · type

A boundary condition of a heat grid (`HeatBoundary` of heat.ts), on the exposed faces of the cells in `region` (cell indices, inclusive; default all).

```ts
export type SceneHeatBoundary = {
    readonly face: 'x-' | 'x+' | 'y-' | 'y+' | 'z-' | 'z+';
    readonly region?: {
        readonly min: readonly [number, number, number];
        readonly max: readonly [number, number, number];
    };
} & ({
    readonly type: 'temperature';
    readonly temperature: number;
} | {
    readonly type: 'flux';
    readonly flux: number;
} | {
    readonly type: 'convection';
    readonly coefficient: number;
    readonly ambient: number;
} | {
    readonly type: 'radiation';
    readonly emissivity: number;
    readonly environment: number;
});
```

### SceneHost · interface

What a SceneBuilder needs from a world. The kit's PhysicsWorld has exactly
these members; the Lab wraps a NativeWorldBackend (src/lab/scene-host.ts).

```ts
export interface SceneHost {
    readonly loop: {
        readonly step: number;
    };
    readonly subSteps: number;
    readonly seed: number;
    readonly native: {
        readonly maxBodies: number;
        reserveBodyCapacity(bodies: number): unknown;
    };
    reset(options: {
        readonly ground?: boolean;
        readonly gravity?: SceneVec3;
        readonly seed?: number;
    }): unknown;
    createBody(options: NativeBodyDescriptor): NativeBodyHandle | null;
    createJoint(options: NativeJointDescriptor): NativeJointHandle;
    destroyBody(body: NativeBodyHandle): boolean;
    destroyJoint(joint: NativeJointHandle): boolean;
    isAlive(body: NativeBodyHandle): boolean;
    isJointAlive(joint: NativeJointHandle): boolean;
    getState(body: NativeBodyHandle): NativeBodyState;
    getMassData?(body: NativeBodyHandle): {
        readonly center: readonly number[];
    } | null;
    gravity(): [number, number, number];
    bodyCount(): number;
}
```

### SceneInertia · type

Rotational inertia of an attached body: the world reports mass only. Default: from the body's box, sphere or capsule shape.

```ts
export type SceneInertia = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'principal';
    readonly moments: SceneVec3;
} | {
    readonly kind: 'locked';
};
```

### SceneJoint · interface

```ts
export interface SceneJoint {
    readonly id: string;
    readonly type: SceneJointType;
    readonly bodyA: string | null;
    readonly bodyB: string | null;
    readonly frameA?: SceneFrame;
    readonly frameB?: SceneFrame;
    readonly collideConnected?: boolean;
    readonly limits?: {
        readonly lower: number;
        readonly upper: number;
    };
    readonly motor?: {
        readonly speed: number;
        readonly maxForce: number;
    };
    readonly spring?: {
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly target?: number;
    };
    readonly length?: number;
    readonly coneAngle?: number;
    readonly stiffness?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly thresholds?: {
        readonly force?: number;
        readonly torque?: number;
        readonly breakable?: boolean;
    };
    readonly drive?: {
        readonly linearVelocity?: SceneVec3;
        readonly angularVelocity?: SceneVec3;
        readonly maxForce?: number;
        readonly maxTorque?: number;
        readonly linearSpring?: {
            readonly hertz: number;
            readonly dampingRatio: number;
            readonly maxForce: number;
        };
        readonly angularSpring?: {
            readonly hertz: number;
            readonly dampingRatio: number;
            readonly maxTorque: number;
        };
    };
    readonly maxTorque?: number;
    readonly steering?: {
        readonly angle: number;
        readonly hertz: number;
        readonly dampingRatio: number;
        readonly maxTorque: number;
        readonly limits?: {
            readonly lower: number;
            readonly upper: number;
        };
    };
    readonly userData?: {
        readonly [key: string]: unknown;
    };
}
```

### SceneJointInput · type

A joint description for SceneBuilder.addJoint: a scene joint without its id; bodies are named by id.

```ts
export type SceneJointInput = Omit<SceneJoint, 'id'>;
```

### SceneJointType · type

```ts
export type SceneJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel' | 'motor' | 'parallel' | 'filter';
```

### SceneMassData · interface

Explicit mass data of a body (scene version 2).

```ts
export interface SceneMassData {
    readonly mass: number;
    readonly center?: SceneVec3;
    readonly inertia: readonly [number, number, number, number, number, number];
}
```

### SceneMaterial · interface

```ts
export interface SceneMaterial {
    readonly density: number;
    readonly friction: number;
    readonly restitution: number;
    readonly color?: number;
}
```

### SceneMeta · interface

```ts
export interface SceneMeta {
    readonly title?: string;
    readonly description?: string;
    readonly author?: string;
    readonly created?: string;
}
```

### SceneProblem · interface

One validation finding. `path` is a JSON pointer (RFC 6901) into the scene; '' is the scene itself.

```ts
export interface SceneProblem {
    readonly path: string;
    readonly message: string;
}
```

### SceneQuat · type

```ts
export type SceneQuat = readonly [number, number, number, number];
```

### SceneShallowWater · interface

Shallow water on terrain (docs/SHALLOW_WATER.md): the Saint-Venant equations on `cells` = [nx, nz] cells of `spacing`
metres in plan, from `origin` = [x, z]; world y is up, so gravity must point down. Numbers are float64.
The bed is `bed` (nx * nz heights at cell centres, x fastest; default 0). The water starts from `depth` (nx * nz
values), or from a flat `level` filled over the bed, or dry. Friction is Manning's n, infiltration Green-Ampt.
Saved state: `depth`, `qx`, `qz` (discharge per width, m^2/s) and `infiltrated` (m) per cell.

```ts
export interface SceneShallowWater {
    readonly id: string;
    readonly cells: readonly [number, number];
    readonly spacing: number | readonly [number, number];
    readonly origin?: readonly [number, number];
    readonly bed?: readonly number[];
    readonly level?: number;
    readonly depth?: readonly number[];
    readonly qx?: readonly number[];
    readonly qz?: readonly number[];
    readonly infiltrated?: readonly number[];
    readonly manning?: number | readonly number[];
    readonly soil?: {
        readonly conductivity: number;
        readonly suction: number;
        readonly moistureDeficit: number;
    };
    readonly rain?: number;
    readonly boundaries?: {
        readonly xMin?: SceneShallowWaterSide;
        readonly xMax?: SceneShallowWaterSide;
        readonly zMin?: SceneShallowWaterSide;
        readonly zMax?: SceneShallowWaterSide;
    };
    readonly density?: number;
    readonly substeps?: number;
    readonly order?: 1 | 2;
    readonly bodies?: readonly SceneShallowWaterBody[];
    readonly backend?: 'cpu' | 'gpu';
}
```

### SceneShallowWaterBody · interface

A body floating in shallow water (a dynamic box or sphere).

```ts
export interface SceneShallowWaterBody {
    readonly body: string;
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
}
```

### SceneShallowWaterSide · type

A side of a shallow-water grid. An inflow brings `discharge` m^3/s, spread by width over the side or over the cells whose centres lie in `span` (world z for an x side, world x for a z side).

```ts
export type SceneShallowWaterSide = 'wall' | 'open' | {
    readonly type: 'inflow';
    readonly discharge: number;
    readonly depth?: number;
    readonly span?: readonly [number, number];
} | {
    readonly type: 'stage';
    readonly level: number;
};
```

### SceneShape · type

```ts
export type SceneShape = {
    readonly kind: 'box';
    readonly halfExtents: SceneVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
} | {
    readonly kind: 'hull';
    readonly points: readonly number[];
}
| {
    readonly kind: 'compound';
    readonly shapes: readonly SceneCompoundChild[];
} | {
    readonly kind: 'mesh';
    readonly vertices: readonly number[];
    readonly indices: readonly number[];
} | {
    readonly kind: 'heightfield';
    readonly heights: readonly number[];
    readonly countX: number;
    readonly countZ: number;
    readonly spacing: readonly [number, number];
};
```

### SceneSolid · interface

A deformable tetrahedral solid (docs/SOLID_MECHANICS.md), optionally in contact with rigid bodies or cracking. Numbers are float64.

```ts
export interface SceneSolid {
    readonly id: string;
    readonly mesh: SceneSolidMesh;
    readonly material: {
        readonly youngModulus: number;
        readonly poissonRatio: number;
        readonly density: number;
        readonly thermalExpansion?: number;
    };
    readonly model?: 'linear' | 'corotational' | 'neo-hookean';
    readonly integrator?: 'backward-euler' | 'midpoint' | 'explicit';
    readonly substeps?: number;
    readonly massDamping?: number;
    readonly stiffnessDamping?: number;
    readonly tolerance?: number;
    readonly maxNewtonIterations?: number;
    readonly gravity?: boolean;
    readonly supports?: readonly SceneSolidSupport[];
    readonly contact?: SceneSolidContact;
    readonly welds?: readonly SceneSolidWeld[];
    readonly loads?: readonly SceneSolidLoad[];
    readonly fracture?: SceneSolidFracture;
    readonly displacements?: readonly number[];
    readonly velocities?: readonly number[];
    readonly cracks?: readonly SceneSolidCrack[];
}
```

### SceneSolidBody · interface

A box, sphere or capsule body the solid touches (docs/SOLID_CONTACT.md).

```ts
export interface SceneSolidBody {
    readonly body: string;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly inertia?: SceneInertia;
}
```

### SceneSolidContact · interface

Contact of a solid with rigid bodies and fixed planes, two-way (`SolidCoupling`), or with other solids and itself
(`SolidSolidContact`, docs/SOLID_CONTACT.md): solids joined by `solids` form a group that is advanced in one solve. A
solid of a group collides with the group's solids and planes only: no `bodies`, welds, loads or fracture.

```ts
export interface SceneSolidContact {
    readonly bodies?: readonly SceneSolidBody[];
    readonly planes?: readonly SceneClothPlane[];
    readonly solids?: readonly string[];
    readonly self?: boolean;
    readonly friction?: number;
    readonly stiffnessScale?: number;
    readonly skin?: number;
    readonly frictionPasses?: number;
    readonly frictionTolerance?: number;
}
```

### SceneSolidCrack · interface

A saved interface of a cracked solid (`FractureBody.crackState`).

```ts
export interface SceneSolidCrack {
    readonly face: number;
    readonly history: readonly [number, number, number];
    readonly mix?: number;
    readonly open?: boolean;
}
```

### SceneSolidFracture · interface

Cohesive fracture of a solid (docs/SOLID_FRACTURE.md). The solid is then a `FractureBody`: linear elements.

```ts
export interface SceneSolidFracture {
    readonly strength: number;
    readonly toughness: number;
    readonly shearWeight?: number;
    readonly initialOpeningRatio?: number;
    readonly insertion?: 'on-demand' | 'manual';
    readonly insertionThreshold?: number;
    readonly tipInsertionThreshold?: number;
    readonly notches?: readonly SceneSolidRegion[];
    readonly interfaces?: readonly SceneSolidRegion[];
}
```

### sceneSolidGroups · function

The solids of a scene that collide with each other, as groups in the scene's order: each group is advanced by one
`SolidSolidContact`. A solid with `contact.self` alone is a group of one.

```ts
export declare function sceneSolidGroups(solids: readonly SceneSolid[]): string[][];
```

### SceneSolidLoad · interface

The force that holds `body` up (measured from its motion: m (dv / dt - g)) is put, reversed, on the solid's boundary faces in the box as a uniform traction.

```ts
export interface SceneSolidLoad extends SceneSolidRegion {
    readonly body: string;
}
```

### SceneSolidMesh · type

The tetrahedral mesh of a solid: a box split into tetrahedra (`boxMesh` of solid.ts), or the nodes and tetrahedra themselves.

```ts
export type SceneSolidMesh = {
    readonly box: {
        readonly size: SceneVec3;
        readonly cells: readonly [number, number, number];
        readonly origin?: SceneVec3;
        readonly pattern?: 'alternating5' | 'kuhn6';
    };
} | {
    readonly positions: readonly number[];
    readonly tets: readonly number[];
};
```

### SceneSolidRegion · interface

A box of reference positions, m: a node, face or face centroid is in it when min <= x <= max on every axis.

```ts
export interface SceneSolidRegion {
    readonly min: SceneVec3;
    readonly max: SceneVec3;
}
```

### SceneSolidSupport · interface

Nodes in the box are held where they are. `axes` says which components; default all three.

```ts
export interface SceneSolidSupport extends SceneSolidRegion {
    readonly axes?: readonly [boolean, boolean, boolean];
}
```

### SceneSolidWeld · interface

Nodes of the solid in the box are welded to the body where they are when the scene is built. The body must be in `contact.bodies`.

```ts
export interface SceneSolidWeld extends SceneSolidRegion {
    readonly body: string;
}
```

### SceneValidationError · class

Thrown by loadScene, canonicalize, the builder and the link functions for an invalid scene. `code` is 'INVALID_PAYLOAD'.

```ts
export declare class SceneValidationError extends EngineError {
  readonly problems: readonly SceneProblem[];
}
```

### SceneVec3 · type

```ts
export type SceneVec3 = readonly [number, number, number];
```

### SceneWater · interface

One closed, flat-bottom shallow-water basin (docs/WATER_COUPLING.md). Numbers here are float64.

```ts
export interface SceneWater {
    readonly id: string;
    readonly cols: number;
    readonly rows: number;
    readonly dx: number;
    readonly dz: number;
    readonly restDepth: number;
    readonly origin: SceneVec3;
    readonly density?: number;
    readonly waterDrag?: number;
    readonly eta?: readonly number[];
    readonly u?: readonly number[];
    readonly v?: readonly number[];
    readonly bodies?: readonly SceneWaterBody[];
}
```

### SceneWaterBody · interface

Per-body drag settings of a body in a water basin. Omitted values take the coupling's defaults.

```ts
export interface SceneWaterBody {
    readonly body: string;
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
    readonly linearDrag?: number;
    readonly angularDrag?: number;
}
```

### SceneWorld · interface

```ts
export interface SceneWorld {
    readonly gravity?: SceneVec3;
    readonly ground?: boolean;
    readonly seed?: number;
    readonly step?: number;
    readonly subSteps?: number;
}
```

### sceneWorldOptions · function

The options to create a world that can load this scene: `createWorld(sceneWorldOptions(scene))`.

```ts
export declare function sceneWorldOptions(scene: Scene): {
    step: number;
    subSteps: number;
    seed: number;
    gravity: [number, number, number];
    ground: boolean;
};
```

### softBlocksScene · function

Soft blocks: two rubber-like cubes (E = 0.3 and 0.15 MPa, nu = 0.4) stacked on the ground plane and a stiffer third
(E = 1 MPa) dropped on them off centre. Deformable against deformable contact with friction, the three solids in one
solve (`contact.solids`, docs/SOLID_CONTACT.md); no rigid body takes part.

```ts
export declare function softBlocksScene(options?: {
    cells?: number;
    drop?: number;
}): Scene;
```

### sphereSettlingScene · function

A PTFE ball (2200 kg/m^3) settling through a syrup (rho = 1380 kg/m^3, mu = 2.5 Pa s, a corn-syrup-like liquid) in
a square column 0.12 m wide: the ball is a body of the rigid world and a moving obstacle in the flow (FluidCoupling),
which hands it the drag and the buoyancy. It reaches a terminal velocity within a few centimetres, far below Stokes's
2 (rho_s - rho) g a^2 / (9 mu) because the walls are 1.2 diameters from it, and lands on the floor. 12 x 30 x 12
cells of 10 mm (2.5 cells per radius). The world steps at 1/120 s: the coupling is explicit and must step below the
ball's response time in the column (about 0.03 s).

```ts
export declare function sphereSettlingScene(options?: {
    radius?: number;
    density?: number;
    viscosity?: number;
}): Scene;
```

### suspendedPlatformScene · function

A platform hung on four cables from fixed anchors, loaded by `boxes` boxes that fall on it one after another.
The cables are tension-only and compliant (docs/COMPLIANT_CABLE.md), coupled two-way to the platform, and hang from
the tops of four posts; the boxes are
ordinary rigid bodies, so the platform swings, tilts and stretches its cables under them.

```ts
export declare function suspendedPlatformScene(options?: {
    boxes?: number;
    axialRigidity?: number;
    drop?: number;
}): Scene;
```

### terrainCarScene · function

A four-wheel car on wheel joints (suspension spring, travel limits, spin
motor) driving over a rolling height-field terrain. There is no ground slab:
the terrain is the floor.

```ts
export declare function terrainCarScene(options?: {
    speed?: number;
    bump?: number;
}): Scene;
```

### trampolineScene · function

A trampoline: a square cloth of `cells` x `cells` cells and side `side`, held along its four edges at height
`height` between four posts, with a ball and a box dropped on it. The cloth and the two bodies are solved together
(docs/CLOTH.md), so the bodies bounce, settle into the sag and are carried by it.

```ts
export declare function trampolineScene(options?: {
    cells?: number;
    side?: number;
    height?: number;
    ballRadius?: number;
    ballDensity?: number;
}): Scene;
```

### validateScene · function

Check a scene completely, before anything is built. Returns every problem
found (at most SCENE_LIMITS.problems), each with a JSON-pointer path; an
empty list means the scene is valid. Never throws, whatever it is given.

```ts
export declare function validateScene(scene: unknown): SceneProblem[];
```

### vehicleTerrainScene · function

A car to drive on rolling terrain: a 1,200 kg chassis on four wheel joints with a physical suspension (60 kN/m and
5 kN s/m per wheel, turned into each joint's own frequency by suspensionJointSpring), steering on the front wheels,
on a 128 m square of terrain. The chassis' userData says how to drive it and the joints' userData which wheel each
is; SceneRoles adopts them as a Vehicle. Left alone it holds 6 m/s on half lock: a circle of about
wheelbase / tan(0.25 rad) = 10 m radius. Scene version 3 (wheel steering).

```ts
export declare function vehicleTerrainScene(options?: {
    bump?: number;
}): Scene;
```

## `box3d-webgpu-kit/simulation`

### buildSceneSimulation · function

Build the coupled sections of a scene whose bodies and joints `builder` has already built, and
return the Simulation that steps them. Build order: frames, then cables (file order), one
StructureCoupling with the cables' attachments (cable by cable, in file order) and then the
frames' attachments; then the cloths, then the grain sets, then the solids (supports, saved state,
contact, welds, loads), then the heat grids and their links to the solids, then the fluids (flows and their bodies, tanks), then the shallow water (and its floating bodies), then the basins and their bodies. A
rigid-only scene gives a Simulation with no subsystems, whose step is `world.step()`. On a
failure the world is reset and the error names the id.

```ts
export declare function buildSceneSimulation<W extends SimulationSceneWorld>(world: W, builder: SceneBuilder<W>, scene: Scene, options?: SceneSimulationOptions): LoadedSimulationScene<W>;
```

### cellTemperaturesToNodes · function

Temperature rise at the nodes of a box mesh from the cell temperatures of a co-located heat grid.
Heat cell (i, j, k) is at index i + nx (j + ny k) and node (i, j, k) at i + (nx + 1) (j + (ny + 1) k).
A node takes the mean of the cells that touch it (one at a corner, eight inside), minus `reference`.

```ts
export declare function cellTemperaturesToNodes(temperature: ArrayLike<number>, cells: readonly [number, number, number], reference: number, out: number[] | Float64Array): number[] | Float64Array;
```

### CHECKPOINT_ERROR · const

The error every refused checkpoint throws: wrong format or version, a damaged file, or one taken from something else.

```ts
export declare const CHECKPOINT_ERROR = "CHECKPOINT_MISMATCH";
```

### CHECKPOINT_VERSION · const

Version of the container and of every state tree in it. A checkpoint of another version is refused.

```ts
export declare const CHECKPOINT_VERSION = 1;
```

### checkpointInfo · function

Kind, version, hash and size, from the header alone (the hash is not checked).

```ts
export declare function checkpointInfo(bytes: Uint8Array): CheckpointInfo;
```

### CheckpointInfo · interface

```ts
export interface CheckpointInfo {
    readonly kind: string;
    readonly version: number;
    readonly hash: string;
    readonly bytes: number;
}
```

### createSimulation · function

A Simulation that owns the stepping of `world`. Register subsystems with `add`, then call `step()` instead of `world.step()`.

```ts
export declare function createSimulation(world: PhysicsWorld, options?: SimulationOptions): WorldSimulation;
```

### deadLoadLink · function

ONE-WAY rigid -> solid: the weight of a rigid body, m g, is put on solid nodes as a dead load. The solid's deflection
does not move the body, and nothing here holds the body up: support it in the rigid world. There is no contact.
With `faces` the weight is spread as a uniform traction over those boundary faces (each node of a face takes a third of
the face's share by area); with `nodes` it is shared equally. The link owns the point forces of those nodes: it replaces
them. The mass and gravity are read from the world each step; a destroyed body takes its weight away. Post stage, before the solid.

```ts
export declare function deadLoadLink<W extends SimulationWorld<B>, B>(body: B, solid: SolidBody, options: {
    readonly id?: string;
    readonly faces?: ArrayLike<number>;
    readonly nodes?: ArrayLike<number>;
}): Subsystem<W, B>;
```

### heatSubsystem · function

Heat conduction (heat.ts). Post stage: it does not act on the rigid step. Requirement: the solver's dt is the simulation
step, a whole fraction of it or a whole multiple of it; with the explicit scheme the dt must also be within the solver's
stability limit. Energy (thermal): stored energy, with the heat that crossed the boundaries and came from sources as `exchanged`.

```ts
export declare function heatSubsystem<W, B>(heat: HeatSolver, options?: {
    readonly id?: string;
}): Subsystem<W, B>;
```

### linkWaterToStructure · function

Water -> structure, for bodies that float and are attached to a cable or a frame. The structure coupling's interface
solve uses each body's free motion; with this link that motion contains the buoyancy and drag the water coupling is
about to apply in the same step (`water.predictLoad`, evaluated for the state the structure coupling reads, with no
side effects). Without it the cable's end is placed where the body would go under gravity alone, B dt^2 / m away.
It is not a subsystem and changes no order: the structure still steps first and the water still applies its own force.
`loadSimulationScene` makes this link for every basin of a scene that has cables or frames. Returns a function that removes it.

```ts
export declare function linkWaterToStructure<B>(water: WaterCoupling<B>, structure: StructureCoupling<B>): () => void;
```

### LoadedSimulationScene · type

What `loadSimulationScene` returns for a PhysicsWorld.

```ts
export type LoadedSimulationScene = CoreLoadedSimulationScene<PhysicsWorld>;
```

### loadSimulationScene · function

Validate a scene, build its bodies, joints, water basins, cables and frames
in `world`, and return them with a ready Simulation. `loadScene` of
`box3d-webgpu-kit/scene` does the same and returns the kit's SceneBuilder.

```ts
export declare function loadSimulationScene(world: PhysicsWorld, scene: unknown, options?: SceneSimulationOptions): LoadedSimulationScene;
```

### ReactionLoad · interface

One body whose support force a `reactionLoadLink` hands to a solid: boundary faces (indices into the solid's `faces`).

```ts
export interface ReactionLoad<B> {
    readonly body: B;
    readonly faces: ArrayLike<number>;
    readonly gravityScale?: number;
}
```

### reactionLoadLink · function

ONE-WAY rigid -> solid: the force that holds a body up is put, reversed, on boundary faces of a solid. The force is
measured from the body's motion in the rigid step just taken, m (dv / dt - g), so it is the body's weight while the
body rests and the impact force, spread over one rigid step, when it lands. It is meant for a body that rests on a
fixed carrier over the solid (a platen) and touches nothing else: every force the rigid world puts on the body is
counted. The solid's deflection does not move the body. Each entry is a uniform traction over its faces (the force
divided by their reference area). The link owns the surface loads of the solid: it clears them every step. Post stage,
before the solid; for a solid in contact (couple stage) the load acts from the next step.

```ts
export declare function reactionLoadLink<W extends SimulationWorld<B>, B>(solid: ReactionLoadTarget, loads: readonly ReactionLoad<B>[], options?: {
    readonly id?: string;
}): Subsystem<W, B>;
```

### ReactionLoadTarget · interface

What `reactionLoadLink` needs from a solid: a `SolidBody` or a `FractureBody`.

```ts
export interface ReactionLoadTarget {
    readonly referencePositions: Float64Array;
    readonly faces: Uint32Array;
    clearSurfaceLoads(): void;
    addTraction(faces: ArrayLike<number>, traction: readonly [number, number, number]): void;
}
```

### resolveTiming · function

Decide how a subsystem with the given requirement runs on a simulation step of `dt`, or throw the stated error.

```ts
export declare function resolveTiming(id: string, kind: string, timeStep: SubsystemTimeStep, dt: number): SubsystemTiming;
```

### resumeSimulation · function

Resume a simulation checkpoint (`simulation.checkpoint()`) in `world`, in this page or a fresh one: the scene it
carries is loaded (the world is reset to it) and the checkpoint restored, so the run continues bit-identically.

```ts
export declare function resumeSimulation(world: PhysicsWorld, bytes: Uint8Array, options?: SceneSimulationOptions): LoadedSimulationScene;
```

### resumeSimulationScene · function

Resume a checkpoint that carries its scene (`checkpoint()` does by default) in `world`, in this page or a fresh one:
load the scene it was taken from (the world is reset to it), then restore the checkpoint. The run continues
bit-identically to the one the checkpoint was taken from. The world must be of the same build.

```ts
export declare function resumeSimulationScene<W extends SimulationSceneWorld>(world: W, bytes: Uint8Array, options?: SceneSimulationOptions): LoadedSimulationScene<W>;
```

### SceneFluidRuntime · type

A fluid of a scene as built: a flow (with its coupling to the bodies, or null when it has none) or a free-surface tank.

```ts
export type SceneFluidRuntime<B> = {
    readonly kind: 'flow';
    readonly flow: Fluid;
    readonly coupling: FluidCoupling<B> | null;
} | {
    readonly kind: 'free-surface';
    readonly surface: FreeSurfaceFluid;
};
```

### SceneGpuBackends · interface

The subsystems of the scene sections that say `backend: 'gpu'` (shallow water, grains, flows). The GPU backends live in
src/engine/gpu (scene-backends.ts `gpuSceneBackends(compute)`); this module only calls them, so it does not depend on
WebGPU. A scene with such a section loaded without them is refused.

```ts
export interface SceneGpuBackends<W = any, B = any> {
    shallowWater(water: ShallowWater, info: {
        readonly id: string;
    }): Subsystem<W, B> & {
        stale(): boolean;
    };
    grains(coupling: GranularCoupling<B>, info: {
        readonly id: string;
    }): Subsystem<W, B> & {
        stale(): boolean;
    };
    fluid?(target: Fluid | FluidCoupling<B>, info: {
        readonly id: string;
    }): Subsystem<W, B> & {
        stale(): boolean;
    };
}
```

### SceneShallowWaterRuntime · interface

Shallow water of a scene as built: the grid and its coupling to the bodies, or null when it has none.

```ts
export interface SceneShallowWaterRuntime<B> {
    readonly water: ShallowWater;
    readonly coupling: ShallowWaterCoupling<B> | null;
}
```

### SceneSimulationOptions · interface

Options of the scene loaders (buildSceneSimulation, loadSimulationScene, resumeSimulationScene).

```ts
export interface SceneSimulationOptions {
    readonly gpu?: SceneGpuBackends;
}
```

### SceneSolidRuntime · interface

`group`: the solver of the solids this one collides with (`contact.solids`, `contact.self`), shared by its members; such a solid has no `coupling`.

```ts
export interface SceneSolidRuntime<B> {
    readonly body: SolidBody | FractureBody;
    readonly coupling: SolidCoupling<B> | null;
    readonly heat: HeatSolver | null;
    readonly group?: SolidSolidContact | null;
}
```

### Simulation · class

One clock, one step, one energy ledger and one event stream for a rigid world and the solvers registered with it.

```ts
export declare class Simulation<W extends SimulationWorld<B>, B = unknown> {
  readonly world: W;
  readonly dt: number;
  readonly subSteps: number | undefined;
  readonly maxSteps: number;
  get tick(): number;
  get time(): number;
  get isAsync(): boolean;
  add(subsystem: Subsystem<W, B>): this;
  remove(id: string): boolean;
  get(id: string): Subsystem<W, B> | undefined;
  subsystems(): Subsystem<W, B>[];
  order(): SimulationDiagnostics['order'];
  step(): void;
  update(frameSeconds: number): { steps: number; alpha: number; droppedSeconds: number; };
  stepAsync(): Promise<void>;
  pullAsync(): Promise<void>;
  onStep(listener: (tick: number) => void): () => void;
  onEvent(listener: (event: SimulationEvent) => void): () => void;
  trackBody(body: B, inertia: StructureInertia, options?: { readonly gravityScale?: number; }): this;
  untrackBody(body: B): boolean;
  energy(): SimulationEnergy;
  diagnostics(): SimulationDiagnostics;
  diagnose(): DiagnosticFinding[];
  get sceneSource(): SimulationSource | null;
  setSceneSource(source: SimulationSource | (() => SimulationSource) | null): void;
  checkpoint(options?: SimulationCheckpointOptions): Uint8Array;
  checkpointAsync(options?: SimulationCheckpointOptions): Promise<Uint8Array>;
  restore(bytes: Uint8Array): void;
  dispose(): void;
}
```

### SIMULATION_STAGES · const

The order of one step. `rigid` and `events` belong to the Simulation; subsystems choose one of the other three.

```ts
export declare const SIMULATION_STAGES: readonly ["pre-couple", "couple", "rigid", "post", "events"];
```

### simulationCheckpointInfo · function

What a simulation checkpoint says about itself: its clock, the scene it was taken from (and the scene, when it carries
it), its subsystems, size and SHA-256. The hash, version and format are checked; nothing is restored.

```ts
export declare function simulationCheckpointInfo(bytes: Uint8Array): SimulationCheckpointInfo;
```

### SimulationCheckpointInfo · interface

What a simulation checkpoint says about itself (`simulationCheckpointInfo`).

```ts
export interface SimulationCheckpointInfo {
    readonly version: number;
    readonly hash: string;
    readonly bytes: number;
    readonly tick: number;
    readonly time: number;
    readonly dt: number;
    readonly sceneHash: string | null;
    readonly scene: string | null;
    readonly subsystems: readonly {
        readonly id: string;
        readonly kind: string;
    }[];
}
```

### SimulationCheckpointOptions · interface

```ts
export interface SimulationCheckpointOptions {
    readonly scene?: boolean;
}
```

### SimulationDiagnostics · interface

```ts
export interface SimulationDiagnostics {
    readonly tick: number;
    readonly time: number;
    readonly dt: number;
    readonly order: readonly {
        readonly stage: SimulationStage;
        readonly id: string;
        readonly kind: string;
        readonly order: number;
        readonly timing: SubsystemTiming | null;
    }[];
    readonly energy: SimulationEnergy;
    readonly subsystems: {
        readonly [id: string]: unknown;
    };
}
```

### SimulationEnergy · interface

```ts
export interface SimulationEnergy {
    readonly entries: readonly SimulationEnergyEntry[];
    readonly mechanical: number;
    readonly thermal: number;
    readonly total: number;
    readonly exchanged: number;
    readonly balance: number;
}
```

### SimulationEnergyEntry · interface

```ts
export interface SimulationEnergyEntry extends SubsystemEnergy {
    readonly id: string;
    readonly kind: string;
    readonly balance: number;
}
```

### SimulationEvent · interface

```ts
export interface SimulationEvent {
    readonly tick: number;
    readonly source: string;
    readonly type: string;
    readonly data: unknown;
}
```

### SimulationOptions · interface

```ts
export interface SimulationOptions {
    readonly maxSteps?: number;
}
```

### SimulationSceneWorld · type

What building a coupled scene needs from the world: a SceneHost that can also take forces and impulses. The kit's PhysicsWorld is one.

```ts
export type SimulationSceneWorld = SceneHost & SimulationWorld<Body> & CouplingWorld<Body> & StructureWorld<Body>;
```

### SimulationSource · interface

Where a Simulation came from, for its checkpoints: `buildSceneSimulation` records the scene it built.

```ts
export interface SimulationSource {
    readonly sceneHash: string;
    readonly scene: string;
}
```

### SimulationStage · type

```ts
export type SimulationStage = typeof SIMULATION_STAGES[number];
```

### SimulationWorld · interface

What a Simulation needs from the rigid world. The kit's PhysicsWorld has these members.

```ts
export interface SimulationWorld<B = unknown> {
    readonly loop: {
        readonly step: number;
    };
    readonly subSteps?: number;
    readonly tick?: number;
    checkpoint?(): Uint8Array;
    restoreCheckpoint?(bytes: Uint8Array): void;
    step(): void;
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    isAlive?(body: B): boolean;
    onEvent?(listener: (event: any) => void): () => void;
}
```

### solidSubsystem · function

A deformable solid (solid.ts). Post stage, after heat and the links. Requirement: the body's dt is the simulation step, a
whole fraction of it or a whole multiple of it; an explicit body must be within its stability limit.
Energy: kinetic + strain + load potential. It is not conserved while a link changes the loads or the temperature.

```ts
export declare function solidSubsystem<W, B>(solid: SolidBody, options?: {
    readonly id?: string;
}): Subsystem<W, B>;
```

### StateValue · type

```ts
export type StateValue = null | undefined | boolean | number | string | bigint | TypedArray | readonly StateValue[] | StateObject;
```

### StepContext · interface

Handed to every hook. One object, reused: do not keep it.

```ts
export interface StepContext<W = unknown> {
    readonly world: W;
    readonly tick: number;
    readonly time: number;
    readonly dt: number;
    readonly substeps: number;
    emit(type: string, data?: unknown): void;
}
```

### structureSubsystem · function

Cables and frames <-> rigid bodies (structure-coupling.ts). Couple stage, before the water: `coupling.step()` steps the
cables and frames it holds and must run immediately before the rigid step. Requirement: `coupling.dt` equals the simulation
step (the coupling itself requires every cable's and frame's dt to equal its own, and frames to use one sub-step).
Energy: `coupling.diagnostics()`, which counts the attached bodies; pass them as `bodies` so they are not tracked twice.

```ts
export declare function structureSubsystem<W, B>(coupling: StructureCoupling<B>, options?: {
    readonly id?: string;
    readonly bodies?: Iterable<B>;
}): Subsystem<W, B>;
```

### Subsystem · interface

The contract every solver plugs in with.

Per simulation step the Simulation calls, in this order: `prepare` on every subsystem (the
world and all fields are at time t; read, do not advance), `step` stage by stage on the
subsystems that are due, `world.step()` between the couple and post stages, then `finish` on
every subsystem (everything is at t + dt; emit events here).

```ts
export interface Subsystem<W = unknown, B = unknown> {
    readonly id: string;
    readonly kind: string;
    readonly stage: SubsystemStage;
    readonly order?: number;
    readonly timeStep: SubsystemTimeStep | null;
    readonly bodies?: Iterable<B>;
    validate?(info: {
        readonly dt: number;
        readonly subSteps: number | undefined;
        readonly timing: SubsystemTiming;
    }): void;
    prepare?(ctx: StepContext<W>): void;
    step(ctx: StepContext<W>): void;
    stepAsync?(ctx: StepContext<W>): Promise<void>;
    finish?(ctx: StepContext<W>): void;
    energy?(): SubsystemEnergy;
    diagnostics?(): unknown;
    diagnose?(): readonly DiagnosticFinding[];
    dispose?(): void;
    checkpoint?(): StateValue;
    checkpointAsync?(): Promise<StateValue>;
    pullAsync?(): Promise<void>;
    restore?(state: StateValue): void;
}
```

### SUBSYSTEM_ORDER · const

The default `order` of the adapters inside their stage. Lower runs first.

```ts
export declare const SUBSYSTEM_ORDER: Readonly<{
    structure: 100;
    water: 200;
    heat: 100;
    link: 200;
    solid: 300;
}>;
```

### SubsystemEnergy · interface

```ts
export interface SubsystemEnergy {
    readonly domain: 'mechanical' | 'thermal';
    readonly total: number;
    readonly exchanged: number;
    readonly parts: {
        readonly [name: string]: number;
    };
}
```

### SubsystemStage · type

```ts
export type SubsystemStage = 'pre-couple' | 'couple' | 'post';
```

### SubsystemTimeStep · interface

A subsystem's own time step and how it must relate to the simulation's fixed step.
- 'equal': it exchanges forces with the rigid step, so its dt must be the simulation step.
- 'commensurate': an independent field. Its dt may be the step, a whole fraction of it (N of its
  steps per simulation step) or a whole multiple of it (one of its steps every N simulation steps).

```ts
export interface SubsystemTimeStep {
    readonly dt: number;
    readonly rule: 'equal' | 'commensurate';
}
```

### SubsystemTiming · interface

How the Simulation runs a subsystem: `substeps` of its own steps on every `every`-th simulation step. One of the two is 1.

```ts
export interface SubsystemTiming {
    readonly dt: number;
    readonly substeps: number;
    readonly every: number;
}
```

### thermalSolidLink · function

ONE-WAY thermal -> solid: the heat solver's temperature becomes the solid's thermal load (eigenstrain alpha_T dT).
With a `FractureBody` as the solid, that strain can crack it (docs/SOLID_FRACTURE.md).
The solid does not act on the temperature. Co-located grids only: the solid must be a `boxMesh` whose cells are the heat
grid's cells (same counts, same cell size, every heat cell solid). Mapping: `cellTemperaturesToNodes`, then the solid takes
the mean of an element's four nodes. Post stage, between the heat solver and the solid, after every heat step.
`reference` is the stress-free temperature. The solid module allocates one array per update.

```ts
export declare function thermalSolidLink<W, B>(heat: HeatSolver, solid: ThermalSolidTarget, options: {
    readonly id?: string;
    readonly reference: number;
}): Subsystem<W, B>;
```

### ThermalSolidTarget · interface

What `thermalSolidLink` needs from a solid: a `SolidBody`, or a `FractureBody` (solid-fracture.ts), whose node count
grows when it cracks and which therefore states the node count of its mesh as given in `thermalNodeCount`.

```ts
export interface ThermalSolidTarget {
    readonly nodeCount: number;
    readonly thermalNodeCount?: number;
    readonly referencePositions: Float64Array;
    setTemperatureChange(rise: number | ArrayLike<number>): void;
}
```

### waterSubsystem · function

Rigid bodies <-> water (water-coupling.ts). Couple stage: `water.step()` immediately before the rigid step.
Requirement: `water.dt` equals the simulation step. Energy: the water's kinetic and potential energy; track the floating bodies with `trackBody`.

```ts
export declare function waterSubsystem<W, B>(water: WaterCoupling<B>, options?: {
    readonly id?: string;
}): Subsystem<W, B>;
```

### WorldSimulation · type

A Simulation of a PhysicsWorld.

```ts
export type WorldSimulation = Simulation<PhysicsWorld, Body>;
```

## `box3d-webgpu-kit/robot`

### cartPoleURDF · function

A pendulum on a cart as URDF: a box cart on a prismatic rail along x, 1.5 m up, and a box pole hanging from it on a free hinge about y.

```ts
export declare function cartPoleURDF(options?: {
    cartMass?: number;
    poleMass?: number;
    poleLength?: number;
}): string;
```

### doublePendulumMJCF · function

The same double pendulum as MJCF. `robotToScene` gives the same scene for both (the ground plane and the friction of 0.6 are written out because MJCF's defaults differ from URDF's).

```ts
export declare function doublePendulumMJCF(options?: DoublePendulumOptions): string;
```

### DoublePendulumOptions · interface

```ts
export interface DoublePendulumOptions {
    length1?: number;
    length2?: number;
    mass1?: number;
    mass2?: number;
    width?: number;
    height?: number;
}
```

### doublePendulumURDF · function

A double pendulum as URDF: two box rods on hinges about y, hanging from the world at `height`. Each rod's inertial is that of its box, so the import reproduces it exactly.

```ts
export declare function doublePendulumURDF(options?: DoublePendulumOptions): string;
```

### EXAMPLE_ROBOTS · const

Every example robot by name: its format and a function that returns the file text with the defaults.

```ts
export declare const EXAMPLE_ROBOTS: {
    readonly [name: string]: {
        readonly format: 'urdf' | 'mjcf';
        readonly text: () => string;
    };
};
```

### hangingChainURDF · function

A chain of `links` capsule links (0.2 m each) on free hinges about y, hanging from the world: a long serial chain for measuring joint drift.

```ts
export declare function hangingChainURDF(links?: number): string;
```

### normalizeMeshPath · function

How mesh names are compared: backslashes become '/', a URI scheme
(`package://`, `file://`, `model://`) is removed, and empty, '.' and '..'
segments are resolved. `package://arm/meshes/hand.stl` -> `arm/meshes/hand.stl`.

```ts
export declare function normalizeMeshPath(name: string): string;
```

### parseMJCF · function

Read a MuJoCo MJCF model: the common subset.

Read: `<compiler>` (angle, eulerseq, meshdir, autolimits, inertiafromgeom),
`<option>` (gravity, timestep), nested `<default>` classes with `class` and
`childclass`, `<asset>` meshes and material colours, the `<worldbody>` tree
(body pose by pos with quat, euler, axisangle, xyaxes or zaxis; `<inertial>`;
`<geom>` box, sphere, capsule, cylinder, ellipsoid and mesh, by size or
`fromto`, and a plane on the world; `<joint>` hinge, slide, ball and free with
axis, range, damping, stiffness, springref, ref and frictionloss) and
`<actuator>` motor, position and velocity on a joint. A body without
`<inertial>` gets its mass and inertia from its geoms, as MuJoCo does.

The world body becomes the root link "world"; a body without a joint is
fixed to its parent. Everything else is reported in `warnings` with the
element named, and has no effect: `<equality>`, `<tendon>`, `<contact>`
pairs and exclusions between bodies that are not joined, `<include>`,
composites, height fields, armature, solver settings, and any attribute this
import does not use. A body with several joints keeps one (three hinges at a
point become a ball joint). Sites, cameras, lights and visual settings are
skipped without a warning: they do not change the motion.

```ts
export declare function parseMJCF(xml: string, options?: RobotParseOptions): RobotDescription;
```

### parseURDF · function

Read a URDF robot.

Read: links (inertial, collision boxes, cylinders, spheres and meshes, the
first visual colour), joints (fixed, revolute, continuous, prismatic,
floating; origin, axis, limit, dynamics) and the tree, which must have one
root and no loops. Visual geometry is not read. Reported in `warnings` and
otherwise without effect: planar joints (the child is left free), `<mimic>`,
`<calibration>`, `<safety_controller>`, `<transmission>`, `<gazebo>` and
any unknown element. Xacro must be expanded first.

Throws `XMLParseError` for malformed XML and
`EngineError('INVALID_PAYLOAD')`, with the line and column, for an invalid
robot: a missing or dangling name, a broken tree, a bad number, a mesh that
was not supplied.

```ts
export declare function parseURDF(xml: string, options?: RobotParseOptions): RobotDescription;
```

### parseXML · function

A small XML parser for robot files: elements, attributes, text, comments,
CDATA, the five predefined entities and numeric character references.

It is deliberately not a full XML processor. A DOCTYPE with an internal
subset (where entities are declared) is refused, an undeclared entity is an
error, and nothing is ever expanded or fetched, so entity-expansion and
external-entity attacks cannot work. A bare `<!DOCTYPE name>` and processing
instructions are skipped. Namespaces are not interpreted: `xacro:macro` is
just a name. Errors are `XMLParseError` with the line and column.

```ts
export declare function parseXML(text: string, limits?: XMLLimits): XMLElement;
```

### ROBOT_LIMITS · const

Hard caps on a robot description.

```ts
export declare const ROBOT_LIMITS: Readonly<{
    links: 4096;
    joints: 4096;
    collisionsPerLink: 64;
    meshHullPoints: 32;
}>;
```

### RobotCollision · interface

```ts
export interface RobotCollision {
    name?: string;
    origin: RobotPose;
    geometry: RobotGeometry;
    mass?: number;
    friction?: number;
    color?: number;
}
```

### RobotDescription · interface

```ts
export interface RobotDescription {
    name: string;
    source: 'urdf' | 'mjcf';
    links: RobotLink[];
    joints: RobotJoint[];
    root: string;
    world: {
        gravity?: [number, number, number];
        timestep?: number;
        ground?: boolean;
    };
    warnings: RobotWarning[];
}
```

### RobotGeometry · type

A collision shape, in the file's terms. Cylinders, capsules and ellipsoids have their axis along the shape's local z.

```ts
export type RobotGeometry = {
    type: 'box';
    size: [number, number, number];
} | {
    type: 'sphere';
    radius: number;
} | {
    type: 'cylinder';
    radius: number;
    length: number;
}
| {
    type: 'capsule';
    radius: number;
    length: number;
} | {
    type: 'ellipsoid';
    radii: [number, number, number];
}
| {
    type: 'mesh';
    filename: string;
    scale: [number, number, number];
    points: number[];
}
| {
    type: 'missing-mesh';
    filename: string;
    scale: [number, number, number];
}
| {
    type: 'plane';
};
```

### RobotHost · interface

The part of `PhysicsWorld` this module uses.

```ts
export interface RobotHost {
    createBody(options: BodyOptions): Body | null;
    createJoint(options: JointOptions): Joint;
    destroyBody?(body: Body): boolean;
}
```

### RobotInertial · interface

```ts
export interface RobotInertial {
    mass: number;
    origin: RobotPose;
    inertia: [number, number, number, number, number, number];
    derived?: boolean;
}
```

### RobotJoint · interface

```ts
export interface RobotJoint {
    name: string;
    type: RobotJointType;
    parent: string;
    child: string;
    origin: RobotPose;
    anchor: [number, number, number];
    axis: [number, number, number];
    limits?: {
        lower: number;
        upper: number;
    };
    effort?: number;
    velocity?: number;
    damping?: number;
    friction?: number;
    stiffness?: number;
    springRef?: number;
    ref?: number;
    armature?: number;
    servo?: {
        kp: number;
        kv: number;
    };
    supported: boolean;
}
```

### RobotJointReport · interface

```ts
export interface RobotJointReport {
    joint: string;
    type: RobotJointType;
    id: string | null;
    as: 'weld' | 'revolute' | 'prismatic' | 'spherical' | 'none';
    limits?: {
        lower: number;
        upper: number;
    };
    motor?: {
        speed: number;
        maxForce: number;
    };
    spring?: {
        hertz: number;
        dampingRatio: number;
        target: number;
        stiffness: number;
        damping: number;
        effectiveMass: number;
    };
    effort?: number;
}
```

### RobotJointType · type

```ts
export type RobotJointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic' | 'spherical' | 'floating' | 'planar';
```

### robotKinematics · function

Pose of every link frame in the robot's own axes (the root link frame is the
origin), for the given joint positions: radians for revolute and continuous
joints, metres for prismatic ones, in the file's values. A joint that is not
named sits at its reference position (0, or MJCF `ref`). Each child frame is
parent x joint origin x joint motion, where the motion turns about, or slides
along, the joint axis through the joint's anchor.

```ts
export declare function robotKinematics(description: RobotDescription, positions?: {
    readonly [joint: string]: number;
}): Map<string, RobotPose>;
```

### RobotLink · interface

```ts
export interface RobotLink {
    name: string;
    inertial?: RobotInertial;
    collisions: RobotCollision[];
    color?: number;
    isWorld?: boolean;
}
```

### RobotLinkHandle · interface

```ts
export interface RobotLinkHandle<B = NativeBodyHandle> {
    body: B | null;
    bodies: B[];
    frame: {
        position: [number, number, number];
        rotation: [number, number, number, number];
    };
}
```

### robotLinkPose · function

World pose of a link frame from the state of the body that carries it:
`robotLinkPose(world.getState(link.body), link.frame)`. With `body` null the
frame already is the world pose.

```ts
export declare function robotLinkPose(body: {
    readonly position: readonly number[];
    readonly rotation: readonly number[];
} | null, frame: {
    readonly position: readonly number[];
    readonly rotation: readonly number[];
}): {
    position: [number, number, number];
    rotation: [number, number, number, number];
};
```

### RobotLinkReport · interface

```ts
export interface RobotLinkReport {
    link: string;
    bodies: string[];
    kind: 'collision' | 'inertia-box' | 'default-density' | 'static' | 'frame';
    mass: number;
    massActual: number;
    volume: number;
    comSpecified?: [number, number, number];
    comActual?: [number, number, number];
    comOffset?: number;
    principalSpecified?: [number, number, number];
    principalActual?: [number, number, number];
    principalError?: [number, number, number];
    maxPrincipalError?: number;
    tensorError?: number;
    inertiaSource?: 'file' | 'shapes';
    shapesPrincipalError?: number;
    shapesTensorError?: number;
    shapesComOffset?: number;
}
```

### RobotMeshData · type

```ts
export type RobotMeshData = BinaryLike | string;
```

### RobotParseOptions · interface

```ts
export interface RobotParseOptions {
    readonly meshes?: Readonly<Record<string, RobotMeshData>> | ReadonlyMap<string, RobotMeshData>;
    readonly missingMeshes?: 'error' | 'box';
    readonly strict?: boolean;
}
```

### RobotPose · interface

A position and a unit quaternion [x, y, z, w].

```ts
export interface RobotPose {
    xyz: [number, number, number];
    quat: [number, number, number, number];
}
```

### robotReport · function

What `robotToScene` does to the robot, in numbers: per-link mass and inertia against the file, shape stand-ins with their errors, the joint mapping and every warning.

```ts
export declare function robotReport(description: RobotDescription, options?: RobotSceneOptions): RobotReport;
```

### RobotReport · interface

```ts
export interface RobotReport {
    name: string;
    totalMass: number;
    totalMassActual: number;
    links: RobotLinkReport[];
    shapes: RobotShapeReport[];
    joints: RobotJointReport[];
    maxPrincipalError: number;
    worstLink: string | null;
    warnings: RobotWarning[];
}
```

### RobotSceneOptions · interface

```ts
export interface RobotSceneOptions {
    readonly positions?: {
        readonly [joint: string]: number;
    };
    readonly floatingBase?: boolean;
    readonly selfCollision?: boolean;
    readonly jointStiffness?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
    };
    readonly position?: readonly [number, number, number];
    readonly rotation?: readonly [number, number, number, number];
    readonly up?: 'z' | 'y';
    readonly cylinders?: 'hull' | 'capsule';
    readonly cylinderSides?: number;
    readonly motors?: {
        readonly [joint: string]: number | {
            readonly speed: number;
            readonly maxForce?: number;
        };
    };
    readonly hold?: {
        readonly hertz: number;
        readonly dampingRatio?: number;
        readonly joints?: readonly string[];
    };
    readonly dampingHertz?: number;
    readonly defaultDensity?: number;
    readonly friction?: number;
    readonly restitution?: number;
    readonly world?: SceneWorld;
    readonly neverSleeps?: boolean;
    readonly prefix?: string;
    readonly collisionGroup?: number;
    readonly links?: 'compound' | 'welded';
    readonly inertia?: 'file' | 'shapes';
}
```

### RobotShapeReport · interface

```ts
export interface RobotShapeReport {
    link: string;
    body: string;
    shape: string;
    as: string;
    volumeError: number;
    inertiaError: number;
}
```

### robotToScene · function

A robot description as a scene (docs/SCENE_FORMAT.md), ready for
`validateScene`, `loadScene` and share links.

- Each link becomes one body, placed by forward kinematics. A link with
  several collision shapes is one compound body (`links: 'welded'` gives one
  body per shape, welded). A body's origin is the centre of mass of its
  first (heaviest) shape.
- Density is mass / collision volume. Where the shapes then do not have the
  file's mass, centre of mass and inertia tensor, the body is given them
  explicitly (`massData`; `inertia: 'shapes'` turns that off). `robotReport`
  says which links, and what the shapes alone would have given.
  A link with mass and no shape becomes a box with the file's exact mass and
  inertia that collides with nothing.
- fixed -> weld; revolute and continuous -> revolute about the joint axis;
  prismatic -> prismatic; ball -> spherical; floating -> no joint.
- Body ids are link names and joint ids are joint names (characters outside
  letters, digits and `_ . : -` become `_`). `extensions.robot` maps every
  link to its body and the link frame in that body's coordinates.

```ts
export declare function robotToScene(description: RobotDescription, options?: RobotSceneOptions): Scene;
```

### robotTree · function

The tree of a description: parent joint and child joints of every link, and the links in an order that visits parents first. Throws on a broken tree.

```ts
export declare function robotTree(description: Pick<RobotDescription, 'links' | 'joints' | 'root'>): {
    order: string[];
    parentJoint: Map<string, RobotJoint>;
    childJoints: Map<string, RobotJoint[]>;
};
```

### RobotWarning · interface

`unsupported`: dropped. `approximated`: represented by something close. `ignored`: has no effect on the physics here. `note`: worth knowing.

```ts
export interface RobotWarning {
    code: 'unsupported' | 'approximated' | 'ignored' | 'note';
    element: string;
    message: string;
    line?: number;
    column?: number;
}
```

### sixDofArmURDF · function

A serial six-joint arm as URDF, from boxes, cylinders and a sphere: yaw,
shoulder, elbow, forearm roll, wrist pitch, tool roll. Joint origins carry
roll, pitch and yaw offsets and the tool has two collision shapes, so the
file exercises the conventions. Its inertia tensors are deliberately not
those of the collision shapes (they are scaled as a CAD export's would
differ), which shows up in `robotReport`.

```ts
export declare function sixDofArmURDF(): string;
```

### SpawnedRobot · type

```ts
export type SpawnedRobot = CoreSpawnedRobot<Body, Joint>;
```

### spawnRobot · function

Add a robot to a world that already exists, without resetting it, and return
handles by link and joint name:

    const robot = spawnRobot(world, parseURDF(text), {position: [0, 0, 0]});
    world.setJointMotor(robot.joints.get('elbow'), {speed: 1, maxForce: 20});
    const pose = robotLinkPose(world.getState(robot.links.get('hand').body), robot.links.get('hand').frame);

The bodies and joints are those of `robotToScene`, created in the same
order, so the world steps exactly like one loaded from that scene. The
scene's world settings (gravity, ground, step) are NOT applied: the world
keeps its own. If the world fills up part-way, the bodies made so far are
destroyed and the error names the body.

```ts
export declare function spawnRobot(world: RobotHost, description: RobotDescription, options?: RobotSceneOptions): SpawnedRobot;
```

### twoLinkArmURDF · function

A planar two-link arm as URDF: a base post and two cylinder links along x, on limited hinges about y. Link lengths 0.4 m and 0.3 m.

```ts
export declare function twoLinkArmURDF(options?: {
    length1?: number;
    length2?: number;
}): string;
```

### wheeledCartURDF · function

A four-wheeled cart as URDF: a box chassis and four cylinder wheels on
continuous joints about y. The robot's origin is on the ground under the
chassis centre. Build it with `floatingBase: true`, or it is welded down.

```ts
export declare function wheeledCartURDF(options?: {
    wheelRadius?: number;
    wheelMass?: number;
    chassisMass?: number;
}): string;
```

### XML_LIMITS · const

Hard caps of `parseXML`. Input beyond them is refused, with the position.

```ts
export declare const XML_LIMITS: Readonly<{
    maxChars: number;
    maxDepth: 64;
    maxNodes: 200000;
    maxAttributes: 256;
    maxNameChars: 256;
}>;
```

### XMLElement · interface

```ts
export interface XMLElement {
    name: string;
    attributes: {
        [name: string]: string;
    };
    children: XMLElement[];
    text: string;
    line: number;
    column: number;
}
```

### XMLLimits · type

```ts
export type XMLLimits = {
    readonly [K in keyof typeof XML_LIMITS]?: number;
};
```

### XMLParseError · class

Thrown by `parseXML`. `code` is 'INVALID_PAYLOAD'; `line` and `column` are 1-based.

```ts
export declare class XMLParseError extends EngineError {
  readonly line: number;
  readonly column: number;
}
```

## `box3d-webgpu-kit/fracture`

### CrackEvent · interface

```ts
export interface CrackEvent {
    time: number;
    step: number;
    kind: 'initiated' | 'opened' | 'element-failed';
    face: number;
    element: number;
    mode: 'I' | 'II' | 'mixed';
    modeMix: number;
    energy: number;
    area: number;
}
```

### FRACTURE_SUBSYSTEM_ORDER · const

The stage order of solids in a Simulation (`SUBSYSTEM_ORDER.solid` of simulation.ts).

```ts
export declare const FRACTURE_SUBSYSTEM_ORDER = 300;
```

### FractureBody · class

```ts
export declare class FractureBody {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "solid-fracture-czm-js-f64-v1";
  readonly model: FractureModel;
  readonly integrator: FractureIntegrator;
  readonly dt: number;
  readonly tetCount: number;
  readonly thermalNodeCount: number;
  readonly tets: Uint32Array;
  readonly elementVolume: Float64Array;
  readonly referenceVolume: number;
  readonly mass: number;
  readonly lambda: number;
  readonly mu: number;
  readonly material: Readonly<Required<Pick<SolidMaterial, 'youngModulus' | 'poissonRatio' | 'density' | 'thermalExpansion'>>>;
  readonly law: Readonly<Required<FractureLaw>>;
  readonly interiorFaceCount: number;
  readonly boundaryFaceCount: number;
  readonly stats: FractureSolveStats;
  get nodeCount(): number;
  get referencePositions(): Float64Array;
  get nodalMass(): Float64Array;
  get nodeOrigin(): Uint32Array;
  get faces(): Uint32Array;
  selectNodes(predicate: (x: number, y: number, z: number) => boolean): Uint32Array;
  selectFaces(predicate: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => boolean): Uint32Array;
  selectInteriorFaces(predicate: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => boolean): Uint32Array;
  selectElements(predicate: (cx: number, cy: number, cz: number) => boolean): Uint32Array;
  interiorFace(face: number): { elements: [number, number]; nodes: [number, number, number, number, number, number]; normal: [number, number, number]; centroid: [number, number, number]; area: number; state: 'intact' | 'cohesive' | 'open' | 'precrack'; strength: number; toughness: number; };
  constrain(nodes: ArrayLike<number>, value?: readonly [number | null, number | null, number | null]): void;
  release(nodes: ArrayLike<number>): void;
  setNodalForce(node: number, force: readonly [number, number, number]): void;
  addTraction(faces: ArrayLike<number>, traction: readonly [number, number, number]): void;
  addPressure(faces: ArrayLike<number>, pressure: number): void;
  clearSurfaceLoads(): void;
  setTemperatureChange(rise: number | ArrayLike<number>): void;
  setInterfaceProperties(faces: ArrayLike<number>, properties: { strength?: number; toughness?: number; }): void;
  setElementProperties(elements: ArrayLike<number>, properties: { strength?: number; toughness?: number; }): void;
  insertCohesive(faces: ArrayLike<number>): number;
  precrack(faces: ArrayLike<number>): number;
  crackState(): { face: number; history: [number, number, number]; mix: number; open: boolean; }[];
  restoreCracks(entries: readonly { readonly face: number; readonly history: readonly number[]; readonly mix?: number; readonly open?: boolean; }[]): number;
  get displacements(): Float64Array;
  get velocities(): Float64Array;
  get time(): number;
  get unconvergedSteps(): number;
  setState(displacements?: ArrayLike<number>, velocities?: ArrayLike<number>): void;
  positions(out?: Float64Array<ArrayBuffer>): Float64Array;
  solveStatic(options?: { predictor?: number; }): FractureSolveStats & { displacements: Float64Array; reactions: Float64Array; };
  step(count?: number): void;
  explicitLimit(): number;
  strainEnergy(): number;
  interfaceEnergy(): number;
  kineticEnergy(): number;
  dissipatedEnergy(): number;
  energy(): FractureEnergy;
  reactions(out?: Float64Array<ArrayBuffer>): Float64Array;
  stresses(out?: Float64Array<ArrayBuffer>, u?: Float64Array): Float64Array;
  get elementDamage(): Float64Array;
  interfaceState(face: number): { inserted: boolean; normal: number[]; sliding: number[]; effective: number[]; history: number[]; damage: number[]; criticalOpening: number; peakOpening: number; };
  crackArea(): { open: number; cohesive: number; precrack: number; };
  get interfaces(): Uint32Array;
  takeEvents(): CrackEvent[];
  momentum(): { linear: [number, number, number]; angular: [number, number, number]; mass: number; handedOffMass: number; handedOffLinear: [number, number, number]; };
  get clampedElements(): number;
  fragments(): Fragment[];
  fragmentRigidBody(fragment: Fragment, options?: { maxPoints?: number; }): FragmentRigidBody;
  handOff(fragment: Fragment, options?: { maxPoints?: number; }): FragmentRigidBody;
}
```

### FractureConfig · interface

```ts
export interface FractureConfig {
    dt?: number;
    integrator?: FractureIntegrator;
    massDamping?: number;
    gravity?: readonly [number, number, number];
    tolerance?: number;
    forceTolerance?: number;
    maxNewtonIterations?: number;
    maxLinearIterations?: number;
    explicitSafety?: number;
    maxInsertionSweeps?: number;
    maxDamageIterations?: number;
}
```

### FractureDefinition · interface

```ts
export interface FractureDefinition {
    mesh: TetMesh | {
        positions: ArrayLike<number>;
        tets: ArrayLike<number>;
    };
    material: SolidMaterial;
    fracture: FractureLaw;
    config?: FractureConfig;
}
```

### FractureEnergy · interface

```ts
export interface FractureEnergy {
    strain: number;
    interface: number;
    kinetic: number;
    dissipated: number;
    damping: number;
    relaxation: number;
    externalWork: number;
    balance: number;
}
```

### FractureIntegrator · type

```ts
export type FractureIntegrator = 'backward-euler' | 'midpoint' | 'explicit';
```

### FractureLaw · interface

```ts
export interface FractureLaw {
    model: FractureModel;
    strength: number;
    toughness: number;
    shearWeight?: number;
    initialOpeningRatio?: number;
    insertion?: 'on-demand' | 'manual';
    insertionThreshold?: number;
    tipInsertionThreshold?: number;
    regularisation?: 'crack-band' | 'none';
    failureStrain?: number;
    residualStiffness?: number;
}
```

### FractureModel · type

```ts
export type FractureModel = 'cohesive' | 'crack-band' | 'none';
```

### FractureSolveStats · interface

```ts
export interface FractureSolveStats {
    converged: boolean;
    reason: 'converged' | 'iteration-limit' | 'line-search' | 'singular-or-indefinite' | 'diverged';
    newtonIterations: number;
    linearIterations: number;
    residual: number;
    reference: number;
    sweeps: number;
    insertedFaces: number;
    damageIterations: number;
}
```

### fractureSubsystem · function

A fracturing solid in the shared stepping loop. Post stage, where `solidSubsystem` runs, after heat
and the links, so `thermalSolidLink(heat, body, ...)` drives its thermal strain. Requirement: the
body's dt is the simulation step, a whole fraction of it or a whole multiple of it; an explicit body
must be within `explicitLimit()`. Crack events of a step are emitted in the events stage with the
type 'crack' (data: a `CrackEvent`). Energy: kinetic + strain + interface, with minus the dissipated
and damped energy as `exchanged`, so `total - exchanged` stays constant when no load does work.

```ts
export declare function fractureSubsystem<W = unknown, B = unknown>(body: FractureBody, options?: {
    readonly id?: string;
}): Subsystem<W, B>;
```

### Fragment · interface

```ts
export interface Fragment {
    index: number;
    tets: Uint32Array;
    nodes: Uint32Array;
    mass: number;
    volume: number;
    centerOfMass: [number, number, number];
    linearMomentum: [number, number, number];
    angularMomentum: [number, number, number];
    inertia: [number, number, number, number, number, number];
    handedOff: boolean;
}
```

### FragmentRigidBody · interface

```ts
export interface FragmentRigidBody {
    shape: {
        kind: 'hull';
        points: Float32Array;
    };
    position: [number, number, number];
    linearVelocity: [number, number, number];
    angularVelocity: [number, number, number];
    density: number;
    mass: number;
    hullVolume: number;
    linearMomentum: [number, number, number];
    type: 'dynamic';
}
```

### gradedBoxMesh · function

A box split into tetrahedra with the cell planes at the given coordinates, for meshes that are
fine where a crack runs and coarse elsewhere. Each list is strictly increasing, in metres.

```ts
export declare function gradedBoxMesh(options: {
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
    pattern?: 'alternating5' | 'kuhn6';
}): TetMesh;
```

### quenchedPlate · function

The thermal-shock example: a hot ceramic plate (alumina-like: E = 370 GPa, nu = 0.22, alpha_T = 8e-6 /K,
k = 30 W/(m K), rho = 3900 kg/m^3, c = 880 J/(kg K), strength 300 MPa, G_c = 40 J/m^2) whose face x = 0 is
suddenly cooled by a film coefficient. The strip modelled is held in its plane (rollers on the y and z
faces) and free through its depth, so a cooled layer carries the biaxial tension E alpha dT / (1 - nu).
Register `heatSubsystem(heat)`, `thermalSolidLink(heat, body, {reference})` and `fractureSubsystem(body)`
with a Simulation whose step is `dt`; the heat solver's temperature then cracks the solid. One-way: the
cracks do not change the heat flow. The elements are larger than E G_c / sigma_c^2 (0.16 mm), so the
onset of cracking is meaningful and the crack pattern after it is not resolved.

```ts
export declare function quenchedPlate(options?: QuenchedPlateOptions): QuenchedPlate;
```

### QuenchedPlate · interface

```ts
export interface QuenchedPlate {
    heat: HeatSolver;
    body: FractureBody;
    reference: number;
    cells: [number, number, number];
    cellSize: number;
    shock: ThermalShockOptions;
    criticalDrop: number;
}
```

### QuenchedPlateOptions · interface

```ts
export interface QuenchedPlateOptions {
    cells?: readonly [number, number, number];
    cellSize?: number;
    initialTemperature?: number;
    ambient?: number;
    coefficient?: number;
    dt?: number;
}
```

### SOLID_FRACTURE_SOLVER_ID · const

```ts
export declare const SOLID_FRACTURE_SOLVER_ID = "solid-fracture-czm-js-f64-v1";
```

### TIP_INSERTION_THRESHOLD · const

Default share of the strength at which on-demand insertion acts on a face that touches a crack front. Measured on the
centre-cracked plate: with 0.4 the failure load is that of a pre-inserted crack path within the 1 % load step on cells of
l_ch and of l_ch / 2 (docs/SOLID_FRACTURE.md).

```ts
export declare const TIP_INSERTION_THRESHOLD = 0.4;
```

## `box3d-webgpu-kit/cloth`

### Cloth · class

```ts
export declare class Cloth {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "cloth-stvk-koiter-newton-pcg-js-f64-v1";
  readonly nodeCount: number;
  readonly triangleCount: number;
  readonly edgeCount: number;
  readonly hingeCount: number;
  readonly dt: number;
  readonly integrator: 'backward-euler' | 'midpoint';
  readonly gravity: Float64Array;
  readonly membraneStiffness: number;
  readonly bendingStiffness: number;
  readonly poissonRatio: number;
  readonly membraneModel: 'stvk' | 'spring';
  readonly bendingModel: 'koiter' | 'hinge' | 'none';
  readonly positions: Float64Array;
  readonly velocities: Float64Array;
  readonly masses: Float64Array;
  readonly triangles: Uint32Array;
  readonly edges: Uint32Array;
  readonly reactions: Float64Array;
  readonly stats: ClothStats;
  externalWork: number;
  time: number;
  drag: number;
  scheme: 'implicit' | 'naive-staggered';
  bodyStepFactor: number;
  mass(): number;
  pin(node: number, position?: ArrayLike<number>): void;
  release(node: number): void;
  isPinned(node: number): boolean;
  setNodalForce(node: number, force: ArrayLike<number>): void;
  setPressure(pascal: number): void;
  setWind(wind: { readonly velocity: ArrayLike<number>; readonly airDensity?: number; readonly coefficient?: number; } | null): void;
  addBody(options: ClothBodyOptions): number;
  get bodyCount(): number;
  setBodyState(index: number, state: ClothBodyState): void;
  setBodyExternalLoad(index: number, force: ArrayLike<number>, torque: ArrayLike<number>, torqueOffset?: number): void;
  setBodyMass(index: number, mass: number): void;
  bodyForce(index: number): Float64Array;
  bodyTorque(index: number): Float64Array;
  bodyTwoWay(index: number): boolean;
  bodyGravityScale(index: number): number;
  bodyAngularMomentumChange(index: number, dx: number, dy: number, dz: number, out: Float64Array): void;
  bodyContacts(index: number): number;
  attach(node: number, bodyIndex: number, localPoint?: ArrayLike<number>): void;
  kineticEnergy(): number;
  gravitationalEnergy(): number;
  membraneEnergy(): number;
  bendingEnergy(): number;
  contactEnergy(): number;
  totalEnergy(): number;
  linearMomentum(out?: number[] | Float64Array): number[] | Float64Array;
  totalReaction(out?: number[] | Float64Array): number[] | Float64Array;
  triangleStress(triangle: number, out?: number[] | Float64Array): number[] | Float64Array;
  minimumSelfDistance(): number;
  cableTensions(out?: Float64Array<ArrayBuffer>): Float64Array;
  yarnStress(triangle: number, out?: number[] | Float64Array): number[] | Float64Array;
  setStrength(strength: { readonly warp: number; readonly weft?: number; }): void;
  get tornCount(): number;
  get tornMask(): Uint8Array;
  step(count?: number): void;
  solveStatic(options?: { readonly pseudoStep?: number; readonly maxIterations?: number; }): ClothStaticResult;
  bodyPosition(index: number): Float64Array;
}
```

### CLOTH_COUPLING_BACKEND · const

```ts
export declare const CLOTH_COUPLING_BACKEND = "rigid-cloth-coupling-monolithic-js-f64-v1";
```

### CLOTH_MAX_NODES · const

```ts
export declare const CLOTH_MAX_NODES = 65536;
```

### CLOTH_SOLVER_ID · const

```ts
export declare const CLOTH_SOLVER_ID = "cloth-stvk-koiter-newton-pcg-js-f64-v1";
```

### CLOTH_SUBSYSTEM_ORDER · const

Where the cloth runs inside its stage of a Simulation: after the structure coupling (100), before the water (200).

```ts
export declare const CLOTH_SUBSYSTEM_ORDER = 150;
```

### ClothBodyOptions · interface

```ts
export interface ClothBodyOptions extends ClothBodyState {
    readonly shape: ClothShape;
    readonly type: 'static' | 'kinematic' | 'dynamic';
    readonly mass?: number;
    readonly inertia?: StructureInertia;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly gravityScale?: number;
}
```

### ClothBodyState · interface

```ts
export interface ClothBodyState {
    readonly position: ArrayLike<number>;
    readonly rotation: ArrayLike<number>;
    readonly linearVelocity?: ArrayLike<number>;
    readonly angularVelocity?: ArrayLike<number>;
}
```

### ClothCable · interface

Edge cables and ropes: chains of nodes joined by tension-only bars.

```ts
export interface ClothCable {
    readonly nodes: ArrayLike<number>;
    readonly axialStiffness: number;
    readonly restLengthFactor?: number;
}
```

### ClothColliderOptions · interface

```ts
export interface ClothColliderOptions {
    readonly shape: ClothShape;
    readonly friction?: number;
    readonly inertia?: StructureInertia;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly gravityScale?: number;
}
```

### ClothConfig · interface

```ts
export interface ClothConfig {
    readonly dt: number;
    readonly gravity?: ClothVec3;
    readonly integrator?: 'backward-euler' | 'midpoint';
    readonly drag?: number;
    readonly maxNewtonIterations?: number;
    readonly residualTolerance?: number;
    readonly forceTolerance?: number;
    readonly maxCgIterations?: number;
    readonly cgTolerance?: number;
}
```

### ClothContactOptions · interface

```ts
export interface ClothContactOptions {
    readonly offset?: number;
    readonly stiffness?: number;
    readonly skin?: number;
}
```

### ClothCoupling · class

Two-way coupling of a Cloth with a rigid world. Call `step()` immediately before `world.step()`: it reads the bodies,
advances the cloth by one step with the dynamic bodies as unknowns of the same solve, and gives each body the force and
torque the cloth put on it, to act through the rigid step. What the cloth feels and what the bodies get are the same
numbers with opposite signs.

```ts
export declare class ClothCoupling<B> {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly backend = "rigid-cloth-coupling-monolithic-js-f64-v1";
  readonly world: ClothWorld<B>;
  readonly cloth: Cloth;
  readonly dt: number;
  readonly scheme: 'implicit' | 'naive-staggered';
  readonly estimateSupports: boolean;
  steps: number;
  addBody(body: B, options: ClothColliderOptions): number;
  addPlane(options: { readonly normal: ClothVec3; readonly point?: ClothVec3; readonly friction?: number; }): number;
  indexOf(body: B): number;
  attach(node: number, body: B, localPoint?: ArrayLike<number>): void;
  detach(node: number): void;
  force(body: B): Float64Array;
  torque(body: B): Float64Array;
  step(): void;
  contactChanges(each: (body: B | null, index: number, touching: boolean) => void): void;
  diagnostics(): ClothCouplingDiagnostics;
}
```

### ClothCouplingDiagnostics · interface

```ts
export interface ClothCouplingDiagnostics {
    clothKinetic: number;
    clothMembrane: number;
    clothBending: number;
    clothPotential: number;
    bodyKinetic: number;
    bodyPotential: number;
    total: number;
    momentum: [number, number, number];
    mass: number;
}
```

### ClothCouplingOptions · interface

```ts
export interface ClothCouplingOptions {
    readonly scheme?: 'implicit' | 'naive-staggered';
    readonly estimateSupports?: boolean;
}
```

### ClothDefinition · interface

```ts
export interface ClothDefinition {
    readonly positions: ArrayLike<number>;
    readonly triangles: ArrayLike<number>;
    readonly restPositions?: ArrayLike<number>;
    readonly velocities?: ArrayLike<number>;
    readonly material: ClothMaterial;
    readonly config: ClothConfig;
    readonly pinned?: ArrayLike<number>;
    readonly extraMass?: ArrayLike<number>;
    readonly contact?: ClothContactOptions;
    readonly selfCollision?: ClothSelfCollisionOptions;
    readonly cables?: readonly ClothCable[];
}
```

### clothGrid · function

A rectangle of (nx + 1) x (ny + 1) nodes spanned by `u` and `v` from `origin` (default: the x-y plane), node (i, j) at
index i + (nx + 1) j. `diagonal`: 'uniform' cuts every cell the same way, 'alternate' in a union-jack pattern.
`jitter` moves interior nodes by up to that fraction of a cell (a seeded generator, so the mesh is repeatable).

```ts
export declare function clothGrid(options: {
    readonly nx: number;
    readonly ny: number;
    readonly u: ClothVec3;
    readonly v: ClothVec3;
    readonly origin?: ClothVec3;
    readonly diagonal?: 'uniform' | 'alternate';
    readonly jitter?: number;
    readonly seed?: number;
}): ClothGrid;
```

### ClothGrid · interface

```ts
export interface ClothGrid {
    positions: Float64Array;
    triangles: Uint32Array;
    nx: number;
    ny: number;
    node(i: number, j: number): number;
}
```

### ClothMaterial · interface

```ts
export interface ClothMaterial {
    readonly arealDensity: number;
    readonly youngModulus: number;
    readonly thickness: number;
    readonly poissonRatio: number;
    readonly membrane?: 'stvk' | 'spring';
    readonly bending?: 'koiter' | 'hinge' | 'none';
    readonly bendingStiffness?: number;
    readonly orthotropic?: {
        readonly warp: number;
        readonly weft: number;
        readonly shear: number;
        readonly poissonRatio: number;
        readonly warpDirection: ClothVec3;
    };
    readonly strength?: {
        readonly warp: number;
        readonly weft?: number;
    };
}
```

### ClothSelfCollisionOptions · interface

```ts
export interface ClothSelfCollisionOptions {
    readonly thickness: number;
    readonly stiffness?: number;
    readonly capacity?: number;
}
```

### ClothShape · type

```ts
export type ClothShape = {
    readonly kind: 'box';
    readonly halfExtents: ClothVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'plane';
    readonly normal: ClothVec3;
};
```

### ClothStaticResult · interface

```ts
export interface ClothStaticResult {
    converged: boolean;
    iterations: number;
    residual: number;
    tolerance: number;
}
```

### ClothStats · interface

```ts
export interface ClothStats {
    steps: number;
    newtonIterations: number;
    cgIterations: number;
    lineSearchHalvings: number;
    unconvergedSteps: number;
    residual: number;
    tolerance: number;
    contacts: number;
    selfPairs: number;
    droppedPairs: number;
}
```

### clothSubsystem · function

A cloth as a subsystem of the one stepping loop (simulation.ts).
 - A `ClothCoupling`: couple stage, order 150. It exchanges forces with the rigid step, so its dt must equal the
   simulation step.
 - A bare `Cloth` (no world): post stage; its dt may be the step, a whole fraction of it or a whole multiple.
Energy: kinetic + membrane + bending + gravitational + contact-spring energy of the cloth, with the work of loads, moving supports and
bodies as `exchanged`; the bodies themselves are not counted (track them with `simulation.trackBody`). Numerical
damping, drag and friction make `total - exchanged` fall.
Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a body starts or stops
pressing on the cloth, and 'unconverged' with {residual, tolerance} when a step stopped at its iteration limit.
Tearing (`strength`) emits no event of its own here: read `tornCount` and `tornMask` after a step.

```ts
export declare function clothSubsystem<W, B>(target: Cloth | ClothCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### ClothVec3 · type

```ts
export type ClothVec3 = readonly [number, number, number];
```

### ClothWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface ClothWorld<B> {
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    applyForce(body: B, force: ClothVec3, point?: ClothVec3): void;
    applyTorque(body: B, torque: ClothVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
    readonly subSteps?: number;
}
```

## `box3d-webgpu-kit/granular`

### DemExecutor · interface

Something that runs a kernel over ranges of grains on several threads and returns when all are done (granular-parallel.ts).

```ts
export interface DemExecutor {
    readonly threads: number;
    share<T extends Float64Array | Int32Array | Uint8Array>(array: T): T;
    run(task: 'contacts' | 'gather', context: DemContext, n: number): void;
    dispose(): void;
}
```

### Granular · class

```ts
export declare class Granular {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "granular-dem-soft-sphere-verlet-js-f64-v1";
  readonly dt: number;
  readonly capacity: number;
  readonly law: 'hertz' | 'linear';
  readonly gravity: Float64Array;
  readonly material: Required<GranularMaterial>;
  readonly positions: Float64Array;
  readonly velocities: Float64Array;
  readonly angularVelocities: Float64Array;
  readonly radii: Float64Array;
  readonly masses: Float64Array;
  readonly alive: Uint8Array;
  readonly forces: Float64Array;
  readonly torques: Float64Array;
  readonly stats: GranularStats;
  time: number;
  dissipatedDamping: number;
  dissipatedFriction: number;
  externalWork: number;
  timeStepFraction: number;
  criticalTime: number;
  get grainCount(): number;
  get liveCount(): number;
  criticalTimeFor(radius: number): number;
  maxTimeStepFor(radius: number): number;
  addGrain(position: ArrayLike<number>, radius: number, velocity?: ArrayLike<number>, angularVelocity?: ArrayLike<number>): number;
  addGrains(positions: ArrayLike<number>, radii: ArrayLike<number> | number, velocities?: ArrayLike<number>): number;
  removeGrain(index: number): void;
  touch(): void;
  get wallCount(): number;
  addWall(options: GranularWallOptions): number;
  setWallState(index: number, state: GranularWallState): void;
  setWallVelocity(index: number, linearVelocity: ArrayLike<number>, angularVelocity?: ArrayLike<number>): void;
  setWallEnabled(index: number, enabled: boolean): void;
  setWallMass(index: number, mass: number): void;
  setWallExternalLoad(index: number, load: ArrayLike<number>, offset?: number): void;
  wallPosition(index: number): Float64Array;
  wallRotation(index: number): Float64Array;
  wallLinearVelocity(index: number): Float64Array;
  wallAngularVelocity(index: number): Float64Array;
  wallMass(index: number): number;
  wallForce(index: number): Float64Array;
  wallTorque(index: number): Float64Array;
  wallImpulse(index: number): Float64Array;
  wallAngularImpulse(index: number): Float64Array;
  wallNormalLoad(index: number): number;
  wallContacts(index: number): number;
  setWallLoads(index: number, loads: { readonly force: ArrayLike<number>; readonly torque: ArrayLike<number>; readonly impulse: ArrayLike<number>; readonly angularImpulse: ArrayLike<number>; readonly normalLoad: number; readonly contacts: number; }): void;
  resetWallImpulses(index?: number): void;
  backendDescription(): GranularBackendDescription;
  mass(): number;
  kineticEnergy(): number;
  gravitationalEnergy(): number;
  normalElasticEnergy(): number;
  tangentialElasticEnergy(): number;
  elasticEnergy(): number;
  mechanicalEnergy(): number;
  energyBalance(): number;
  linearMomentum(out?: number[] | Float64Array): number[] | Float64Array;
  angularMomentum(out?: number[] | Float64Array): number[] | Float64Array;
  coordination(): number;
  useExecutor(executor: DemExecutor | null): void;
  get threads(): number;
  step(count?: number): void;
}
```

### GRANULAR_COUPLING_BACKEND · const

```ts
export declare const GRANULAR_COUPLING_BACKEND = "rigid-granular-coupling-subcycled-js-f64-v1";
```

### GRANULAR_MAX_GRAINS · const

```ts
export declare const GRANULAR_MAX_GRAINS: number;
```

### GRANULAR_SOLVER_ID · const

```ts
export declare const GRANULAR_SOLVER_ID = "granular-dem-soft-sphere-verlet-js-f64-v1";
```

### GRANULAR_SUBSYSTEM_ORDER · const

Where the grains run inside the couple stage of a Simulation: after the structure coupling (100) and the cloth (150), before the water (200).

```ts
export declare const GRANULAR_SUBSYSTEM_ORDER = 160;
```

### GRANULAR_TIME_STEP_LIMIT · const

Largest dt / critical time the solver accepts without `allowUnstable`: of the Rayleigh time for 'hertz', of the contact duration for 'linear'.

```ts
export declare const GRANULAR_TIME_STEP_LIMIT: Readonly<{
    hertz: 0.4;
    linear: 0.2;
}>;
```

### GranularBackendDescription · interface

What `Granular.backendDescription()` returns: the contact law's constants as the solver derived them, the bounds, the radius range and every wall.

```ts
export interface GranularBackendDescription {
    hertz: boolean;
    kHertz: number;
    kMindlin: number;
    kn: number;
    kt: number;
    alpha: number;
    tangentialDamping: number;
    friction: number;
    rollingFriction: number;
    bounds: number[] | null;
    rMin: number;
    rMax: number;
    walls: GranularBackendWall[];
}
```

### GranularBackendWall · interface

What `Granular.backendDescription()` returns. Wall shape: 0 plane, 1 box, 2 sphere, 3 capsule, 4 shell of revolution; type: 0 static, 1 kinematic, 2 dynamic; `dim` as in the solver (plane: normal; box: half extents; sphere: radius; capsule: radius, half length; shell: axis, r0, z0, r1, z1).

```ts
export interface GranularBackendWall {
    shape: number;
    type: number;
    enabled: boolean;
    dim: number[];
    position: number[];
    rotation: number[];
    linearVelocity: number[];
    angularVelocity: number[];
    mass: number;
    invInertia: number[];
    gravityScale: number;
    external: number[];
    alpha: number;
    friction: number;
    rollingFriction: number;
    curved: number;
    force: number[];
    torque: number[];
    impulse: number[];
    angularImpulse: number[];
}
```

### GranularColliderOptions · interface

```ts
export interface GranularColliderOptions {
    readonly shape: GranularShape;
    readonly inertia?: StructureInertia;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
    readonly twoWay?: boolean;
    readonly gravityScale?: number;
}
```

### GranularConfig · interface

```ts
export interface GranularConfig {
    readonly dt: number;
    readonly capacity: number;
    readonly gravity?: GranularVec3;
    readonly law?: 'hertz' | 'linear';
    readonly normalStiffness?: number;
    readonly tangentialStiffnessRatio?: number;
    readonly tangentialDamping?: number;
    readonly skin?: number;
    readonly allowUnstable?: boolean;
    readonly bounds?: {
        readonly min: GranularVec3;
        readonly max: GranularVec3;
    };
}
```

### GranularCoupling · class

Two-way coupling of a Granular with a rigid world. Call `step()` immediately before `world.step()`. It copies every
coupled body in as a wall (dynamic bodies as dynamic walls with the body's mass), advances the grains by
`substeps` = rigid step / grain step of their own steps, the dynamic bodies moving with them under gravity, the grain
forces and the estimated support load, and gives each body the mean force and torque of those steps to act through
the rigid step. The impulse the grains receive and the impulse the bodies are handed are the same numbers with
opposite signs.

```ts
export declare class GranularCoupling<B> {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly backend = "rigid-granular-coupling-subcycled-js-f64-v1";
  readonly world: GranularWorld<B>;
  readonly granular: Granular;
  readonly dt: number;
  readonly substeps: number;
  readonly estimateSupports: boolean;
  steps: number;
  addBody(body: B, options: GranularColliderOptions): number;
  indexOf(body: B): number;
  force(body: B): Float64Array;
  torque(body: B): Float64Array;
  step(): void;
  begin(): void;
  finish(): void;
  contactChanges(each: (body: B, index: number, touching: boolean) => void): void;
  diagnostics(): GranularCouplingDiagnostics;
}
```

### GranularCouplingDiagnostics · interface

```ts
export interface GranularCouplingDiagnostics {
    grainKinetic: number;
    grainPotential: number;
    grainElastic: number;
    dissipatedDamping: number;
    dissipatedFriction: number;
    bodyKinetic: number;
    bodyPotential: number;
    momentum: [number, number, number];
    mass: number;
}
```

### GranularCouplingOptions · interface

```ts
export interface GranularCouplingOptions {
    readonly step?: number;
    readonly estimateSupports?: boolean;
}
```

### granularDampingCoefficient · function

The damping coefficient alpha of the normal law that gives the restitution `e` in a two-body impact, found by
bisection on the integrated impact. The force is clamped at zero, so the textbook formulas, which let the contact pull
at the end of the impact, do not apply: the same restitution needs more damping here (for e = 0.5, 0.511 against
2 zeta = 0.431 for the linear law). 'hertz': F_d = alpha sqrt(m* k_H) delta^(1/4) v; 'linear': F_d = alpha sqrt(m* k_n) v.

```ts
export declare function granularDampingCoefficient(restitution: number, law?: 'hertz' | 'linear'): number;
```

### granularEffectiveModulus · const

Effective modulus E* of two bodies of the same material: E / (2 (1 - nu^2)).

```ts
export declare const granularEffectiveModulus: (youngModulus: number, poissonRatio: number) => number;
```

### granularEffectiveShearModulus · const

Effective shear modulus G* of two bodies of the same material: G / (2 (2 - nu)), G = E / (2 (1 + nu)).

```ts
export declare const granularEffectiveShearModulus: (youngModulus: number, poissonRatio: number) => number;
```

### granularLattice · function

Grains on a cubic lattice filling the box [min, max]: spacing 2 * radius[1] * (1 + gap), radii drawn uniformly from
[radius[0], radius[1]] and centres moved by up to `jitter` of the free play, from a seeded generator (repeatable).

```ts
export declare function granularLattice(options: {
    readonly min: GranularVec3;
    readonly max: GranularVec3;
    readonly radius: number | readonly [number, number];
    readonly gap?: number;
    readonly jitter?: number;
    readonly seed?: number;
    readonly inside?: (x: number, y: number, z: number, r: number) => boolean;
}): GranularLattice;
```

### GranularLattice · interface

```ts
export interface GranularLattice {
    positions: Float64Array;
    radii: Float64Array;
    count: number;
}
```

### GranularMaterial · interface

```ts
export interface GranularMaterial {
    readonly density: number;
    readonly youngModulus?: number;
    readonly poissonRatio?: number;
    readonly restitution: number;
    readonly friction: number;
    readonly rollingFriction?: number;
}
```

### GranularShape · type

```ts
export type GranularShape = 
{
    readonly kind: 'plane';
    readonly normal: GranularVec3;
} | {
    readonly kind: 'box';
    readonly halfExtents: GranularVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'cylinder';
    readonly radius: number;
    readonly from: number;
    readonly to: number;
    readonly axis?: GranularVec3;
}
| {
    readonly kind: 'annulus';
    readonly innerRadius: number;
    readonly outerRadius: number;
    readonly offset?: number;
    readonly axis?: GranularVec3;
}
| {
    readonly kind: 'frustum';
    readonly r0: number;
    readonly z0: number;
    readonly r1: number;
    readonly z1: number;
    readonly axis?: GranularVec3;
};
```

### GranularStats · interface

```ts
export interface GranularStats {
    steps: number;
    rebuilds: number;
    contacts: number;
    wallContacts: number;
    pairs: number;
    overlap: number;
    maxOverlap: number;
    removed: number;
    removedMass: number;
    unstable: boolean;
}
```

### granularSubsystem · function

Grains as a subsystem of the one stepping loop (simulation.ts).
 - A `GranularCoupling`: couple stage, order 160. Its time step is the rigid step (it takes `substeps` grain steps
   inside), so it must equal the simulation step.
 - A bare `Granular` (no world): post stage; its dt may be the step, a whole fraction of it or a whole multiple.
Registration fails when the grain step exceeds the stability limit (unless the Granular was built with
`allowUnstable`, which emits one 'unstable-step' event instead).
Energy: kinetic (translation and spin) + gravitational + elastic (normal, tangential and rolling springs) of the
grains, with the work of moving walls and coupled bodies, less the energy of removed grains, as `exchanged`. The parts
also list `dissipatedDamping` and `dissipatedFriction`: total - exchanged + the two is constant up to the
time-stepping error. Coupled bodies are not counted (track them with `simulation.trackBody`).
Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a coupled body starts
or stops touching grains, 'grains-removed' with {count, mass} when grains left the bounds, 'overlap' with {ratio} when
the largest overlap first exceeds a quarter of a radius, and 'unstable-step' once (see above).

```ts
export declare function granularSubsystem<W, B>(target: Granular | GranularCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### GranularVec3 · type

```ts
export type GranularVec3 = readonly [number, number, number];
```

### GranularWallOptions · interface

```ts
export interface GranularWallOptions {
    readonly shape: GranularShape;
    readonly type?: 'static' | 'kinematic' | 'dynamic';
    readonly position?: ArrayLike<number>;
    readonly rotation?: ArrayLike<number>;
    readonly linearVelocity?: ArrayLike<number>;
    readonly angularVelocity?: ArrayLike<number>;
    readonly mass?: number;
    readonly inertia?: StructureInertia;
    readonly gravityScale?: number;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly restitution?: number;
}
```

### GranularWallState · interface

```ts
export interface GranularWallState {
    readonly position: ArrayLike<number>;
    readonly rotation?: ArrayLike<number>;
    readonly linearVelocity?: ArrayLike<number>;
    readonly angularVelocity?: ArrayLike<number>;
}
```

### GranularWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface GranularWorld<B> {
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    applyForce(body: B, force: GranularVec3): void;
    applyTorque(body: B, torque: GranularVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
}
```

### HERTZ_DURATION_FACTOR · const

2 * integral from 0 to 1 of dx / sqrt(1 - x^(5/2)) = (4/5) B(2/5, 1/2): Hertz contact duration over delta_max / v.

```ts
export declare const HERTZ_DURATION_FACTOR = 2.94327518432;
```

### hertzContactDuration · function

Duration of an elastic Hertz impact: 2.943 delta_max / v with delta_max = (15 m* v^2 / (16 E* sqrt(R*)))^(2/5).

```ts
export declare function hertzContactDuration(effectiveMass: number, effectiveRadius: number, effectiveModulus: number, speed: number): number;
```

### rayleighTime · function

Time a Rayleigh surface wave takes around half a grain: pi r sqrt(rho / G) / (0.1631 nu + 0.8766).

```ts
export declare function rayleighTime(radius: number, density: number, youngModulus: number, poissonRatio: number): number;
```

## `box3d-webgpu-kit/fluid`

### ductFlowRate · function

Volume flow of the same duct: Q = (4 b a^3 G / (3 nu)) [1 - (192 a / (pi^5 b)) sum_{n odd} tanh(n pi b / 2a) / n^5].

```ts
export declare function ductFlowRate(a: number, b: number, acceleration: number, nu: number, terms?: number): number;
```

### ductVelocity · function

Fully developed flow in a rectangular duct |y| < a, |z| < b driven by a body acceleration G (pressure gradient over
density), kinematic viscosity nu (series solution, e.g. White, Viscous Fluid Flow, sec. 3-3; written from memory and
checked against the solver and against the limit b >> a, where it tends to plane Poiseuille flow):
  u = (16 a^2 G / (nu pi^3)) sum_{n odd} (-1)^((n-1)/2) [1 - cosh(n pi z / 2a) / cosh(n pi b / 2a)] cos(n pi y / 2a) / n^3

```ts
export declare function ductVelocity(y: number, z: number, a: number, b: number, acceleration: number, nu: number, terms?: number): number;
```

### Fluid · class

```ts
export declare class Fluid {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "fluid-mac-projection-mic-pcg-js-f64-v1";
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly h: number;
  readonly origin: FluidVec3;
  readonly density: number;
  readonly viscosity: number;
  readonly nu: number;
  readonly dt: number;
  readonly gravity: Float64Array;
  readonly bodyForce: Float64Array;
  readonly advection: 'central' | 'upwind' | 'none';
  readonly diffusion: 'explicit' | 'crank-nicolson' | 'backward-euler';
  readonly theta: number;
  readonly pressureTolerance: number;
  readonly viscousTolerance: number;
  readonly maxIterations: number;
  readonly cflLimit: number;
  readonly sides: readonly Side[];
  readonly NX: number;
  readonly NY: number;
  readonly NZ: number;
  readonly size: number;
  readonly stride: readonly [number, number, number];
  readonly u: Float64Array;
  readonly v: Float64Array;
  readonly w: Float64Array;
  readonly vel: readonly [Float64Array, Float64Array, Float64Array];
  readonly p: Float64Array;
  readonly cells: number;
  readonly stats: FluidStats;
  time: number;
  dissipated: number;
  workByBodies: number;
  workByBoundaries: number;
  workByForces: number;
  readonly pressureSolver: 'mic' | 'multigrid';
  backendDescription(): FluidBackendDescription;
  backendObstacleBand(): FluidObstacleBand;
  finishBackendObstacles(J: ArrayLike<number>, M: ArrayLike<number>, Mstart: ArrayLike<number> | null): void;
  faceIndex(f: number): [number, number, number];
  facePosition(c: number, f: number): [number, number, number];
  index(i: number, j: number, k: number): number;
  maxTimeStep(): FluidTimeStepLimits;
  checkTimeStep(allowUnstable?: boolean): void;
  setVelocity(field: (x: number, y: number, z: number) => ArrayLike<number>): void;
  project(): void;
  setPressure(field: (x: number, y: number, z: number) => number): void;
  cellCentre(c: number): [number, number, number];
  faceCount(c: 0 | 1 | 2): number;
  getState(): { u: Float64Array; v: Float64Array; w: Float64Array; pressure: Float64Array; };
  setState(state: { readonly u: ArrayLike<number>; readonly v: ArrayLike<number>; readonly w: ArrayLike<number>; readonly pressure?: ArrayLike<number>; }): void;
  obstacleDistance(x: number, y: number, z: number): number;
  addObstacle(options: FluidObstacleOptions): number;
  get obstacleCount(): number;
  setObstacleState(index: number, state: FluidObstacleState): void;
  setObstacleEnabled(index: number, enabled: boolean): void;
  obstacleForce(index: number): Float64Array;
  obstacleTorque(index: number): Float64Array;
  obstacleImpulse(index: number): Float64Array;
  resetObstacleImpulses(index?: number): void;
  obstacleVolume(index: number): number;
  step(count?: number): void;
  divergenceAt(c: number): number;
  maxDivergence(): number;
  kineticEnergy(): number;
  momentum(): [number, number, number];
  viscousPower(): number;
  boundaryPower(): number;
  energyBalance(): number;
  velocityAt(x: number, y: number, z: number, out?: number[] | Float64Array): number[] | Float64Array;
  pressureAt(x: number, y: number, z: number): number;
  flowRate(axis: 0 | 1 | 2, index: number): number;
  controlVolumeForce(min: FluidVec3, max: FluidVec3): [number, number, number];
}
```

### FLUID_COUPLING_BACKEND · const

```ts
export declare const FLUID_COUPLING_BACKEND = "rigid-fluid-coupling-fictitious-domain-js-f64-v1";
```

### FLUID_MAX_CELLS · const

```ts
export declare const FLUID_MAX_CELLS: number;
```

### FLUID_SOLVER_ID · const

```ts
export declare const FLUID_SOLVER_ID = "fluid-mac-projection-mic-pcg-js-f64-v1";
```

### FLUID_SUBSYSTEM_ORDER · const

Where the fluid runs inside the couple stage of a Simulation: after the grains (160) and solid contact (170), before the water (200).

```ts
export declare const FLUID_SUBSYSTEM_ORDER = 180;
```

### FluidBackendComponent · interface

One velocity component in `Fluid.backendDescription()`. Indices are padded; ghost entries are x[dst] = a x[src] + b.

```ts
export interface FluidBackendComponent {
    unknown: Int32Array;
    copies: Int32Array;
    outflows: Int32Array;
    fixedFaces: Int32Array;
    fixedValues: Float64Array;
    ghostDst: Int32Array;
    ghostSrc: Int32Array;
    ghostA: Float64Array;
    ghostB: Float64Array;
    ghostPasses: number[];
    gradFace: Int32Array;
    gradLow: Int32Array;
    gradHigh: Int32Array;
    gradWL: Float64Array;
    gradWH: Float64Array;
    wallSpeed: number;
}
```

### FluidBackendDescription · interface

The fluid grid flattened for another backend (the GPU fluid): sizes, padded strides, the solve components with their boundary tables, and the pressure matrix's neighbours and diagonal.

```ts
export interface FluidBackendDescription {
    cells: [number, number, number];
    padded: [number, number, number];
    size: number;
    stride: [number, number, number];
    es: [number, number, number];
    activeAxes: number;
    singular: boolean;
    components: FluidBackendComponent[];
    cellPad: Int32Array;
    nbr: Int32Array;
    diag: Float64Array;
}
```

### FluidBodyOptions · interface

```ts
export interface FluidBodyOptions {
    readonly shape: FluidShape;
    readonly twoWay?: boolean;
}
```

### FluidBoundaries · interface

```ts
export interface FluidBoundaries {
    readonly xMin?: FluidBoundaryType | FluidBoundary;
    readonly xMax?: FluidBoundaryType | FluidBoundary;
    readonly yMin?: FluidBoundaryType | FluidBoundary;
    readonly yMax?: FluidBoundaryType | FluidBoundary;
    readonly zMin?: FluidBoundaryType | FluidBoundary;
    readonly zMax?: FluidBoundaryType | FluidBoundary;
}
```

### FluidBoundary · interface

```ts
export interface FluidBoundary {
    readonly type: FluidBoundaryType;
    readonly velocity?: FluidVec3 | ((x: number, y: number, z: number) => FluidVec3);
}
```

### FluidBoundaryType · type

```ts
export type FluidBoundaryType = 'no-slip' | 'free-slip' | 'inflow' | 'outflow' | 'periodic';
```

### FluidCoupling · class

Two-way coupling of a Fluid with a rigid world. Call `step()` immediately before `world.step()`. Every coupled body is
a moving obstacle at the pose and velocity the world reports; the fluid takes `substeps` = rigid step / fluid step of
its own steps (the body moving at that velocity), and each dynamic body receives the mean hydrodynamic force and torque
of those steps (buoyancy included) to act through the rigid step. The impulse the fluid receives and the impulse the
body is handed are the same numbers with opposite signs. The body's response comes one rigid step later (explicit
coupling): a body lighter than about the fluid it displaces can be unstable.

```ts
export declare class FluidCoupling<B> {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly backend = "rigid-fluid-coupling-fictitious-domain-js-f64-v1";
  readonly world: FluidWorld<B>;
  readonly fluid: Fluid;
  readonly dt: number;
  readonly substeps: number;
  steps: number;
  addBody(body: B, options: FluidBodyOptions): number;
  indexOf(body: B): number;
  force(body: B): Float64Array;
  torque(body: B): Float64Array;
  step(): void;
  stepAsync(advance: (count: number) => Promise<void>): Promise<void>;
  diagnostics(): FluidCouplingDiagnostics;
}
```

### FluidCouplingDiagnostics · interface

```ts
export interface FluidCouplingDiagnostics {
    fluidKinetic: number;
    bodyKinetic: number;
    momentum: [number, number, number];
    dissipated: number;
    workByBodies: number;
}
```

### FluidCouplingOptions · interface

```ts
export interface FluidCouplingOptions {
    readonly step?: number;
}
```

### FluidObstacleBand · interface

The obstacles of a Fluid as a backend that takes its steps needs them (src/engine/gpu/fluid-program.ts), for the
present poses and velocities: per velocity component, the faces within 1.5 cells of an enabled obstacle's surface,
grouped by obstacle (in index order) and by face within one. `mode` 0 is a fluid face (free), 1 an inside face that
takes `target` (the rigid velocity), 2 an inside face next to the fluid that takes target + weight (u[outFace] - target);
`alpha` is the solid fraction, `arm` (three per face) r x e_c with r from the obstacle's position to the face.

```ts
export interface FluidObstacleBand {
    readonly obstacles: number;
    readonly fresh: Uint8Array;
    readonly components: readonly {
        readonly face: Int32Array;
        readonly owner: Int32Array;
        readonly mode: Uint8Array;
        readonly outFace: Int32Array;
        readonly weight: Float64Array;
        readonly target: Float64Array;
        readonly alpha: Float64Array;
        readonly arm: Float64Array;
    }[];
}
```

### FluidObstacleOptions · interface

```ts
export interface FluidObstacleOptions extends Partial<FluidObstacleState> {
    readonly shape: FluidShape;
}
```

### FluidObstacleState · interface

```ts
export interface FluidObstacleState {
    readonly position: ArrayLike<number>;
    readonly rotation?: ArrayLike<number>;
    readonly linearVelocity?: ArrayLike<number>;
    readonly angularVelocity?: ArrayLike<number>;
}
```

### FluidOptions · interface

```ts
export interface FluidOptions {
    readonly cells: FluidVec3;
    readonly spacing: number;
    readonly origin?: FluidVec3;
    readonly density: number;
    readonly viscosity: number;
    readonly dt: number;
    readonly gravity?: FluidVec3;
    readonly bodyForce?: FluidVec3;
    readonly boundaries?: FluidBoundaries;
    readonly advection?: 'central' | 'upwind' | 'none';
    readonly diffusion?: 'explicit' | 'crank-nicolson' | 'backward-euler';
    readonly pressureTolerance?: number;
    readonly viscousTolerance?: number;
    readonly maxIterations?: number;
    readonly cflLimit?: number;
    readonly allowUnstable?: boolean;
    readonly pressureSolver?: 'mic' | 'multigrid';
}
```

### FluidShape · type

```ts
export type FluidShape = {
    readonly kind: 'sphere';
    readonly radius: number;
} | {
    readonly kind: 'box';
    readonly halfExtents: FluidVec3;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'cylinder';
    readonly radius: number;
    readonly halfLength: number;
};
```

### fluidShapeVolume · function

Volume of a shape, m^3.

```ts
export declare function fluidShapeVolume(s: FluidShape): number;
```

### FluidStats · interface

```ts
export interface FluidStats {
    steps: number;
    pressureIterations: number;
    divergence: number;
    viscousIterations: number;
    cfl: number;
    maxCfl: number;
    cflExceeded: number;
    unconverged: number;
    unstable: boolean;
}
```

### fluidSubsystem · function

A fluid as a subsystem of the one stepping loop (simulation.ts).
 - A `FluidCoupling`: couple stage, order 180. Its time step is the rigid step (it takes `substeps` fluid steps inside).
 - A bare `Fluid`: post stage; its dt may be the step, a whole fraction of it or a whole multiple.
Registration fails with UNSTABLE_TIME_STEP when the step is above the explicit viscous limit or the starting Courant
number is above `cflLimit` (unless the Fluid was built with allowUnstable).
Energy: kinetic energy of the fluid; `exchanged` is the work of the bodies, moving walls, open sides and body forces;
the parts list `dissipated` (viscous): total - exchanged + dissipated is constant up to the discretisation error.
Events, at the end of a step: 'cfl-exceeded' {cfl} when the Courant number first rises above the limit,
'unconverged' {iterations} when a projection stopped at maxIterations, 'unstable-step' once when accepted above a limit.

```ts
export declare function fluidSubsystem<W, B>(target: Fluid | FluidCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### FluidTimeStepLimits · interface

```ts
export interface FluidTimeStepLimits {
    readonly viscous: number;
    readonly advective: number;
}
```

### FluidVec3 · type

```ts
export type FluidVec3 = readonly [number, number, number];
```

### FluidWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface FluidWorld<B> {
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    applyForce(body: B, force: FluidVec3): void;
    applyTorque(body: B, torque: FluidVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
}
```

### FREE_SURFACE_SOLVER_ID · const

```ts
export declare const FREE_SURFACE_SOLVER_ID = "fluid-free-surface-apic-mac-js-f64-v1";
```

### FREE_SURFACE_SUBSYSTEM_ORDER · const

Where a free-surface tank runs in the post stage of a Simulation: after a bare Fluid (510).

```ts
export declare const FREE_SURFACE_SUBSYSTEM_ORDER = 520;
```

### FreeSurfaceFluid · class

```ts
export declare class FreeSurfaceFluid {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "fluid-free-surface-apic-mac-js-f64-v1";
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly h: number;
  readonly origin: FluidVec3;
  readonly density: number;
  dt: number;
  readonly viscosity: number;
  readonly noSlip: boolean;
  readonly gravity: Float64Array;
  readonly flat: boolean;
  readonly perAxis: number;
  readonly pressureTolerance: number;
  readonly viscousTolerance: number;
  readonly maxIterations: number;
  readonly cflLimit: number;
  readonly capacity: number;
  readonly vel: [Float64Array, Float64Array, Float64Array];
  readonly p: Float64Array;
  readonly liquid: Uint8Array;
  readonly solid: Uint8Array;
  readonly stats: FreeSurfaceStats;
  time: number;
  positions: Float64Array;
  velocities: Float64Array;
  affine: Float64Array;
  count: number;
  particleMass: number;
  setTimeStep(dt: number): void;
  addObstacle(options: FreeSurfaceObstacleOptions): number;
  moveObstacle(index: number, position: FluidVec3, velocity?: FluidVec3): void;
  obstacleForce(index: number): [number, number, number];
  addLiquid(inside: (x: number, y: number, z: number) => boolean, velocity?: FluidVec3): number;
  setParticles(positions: ArrayLike<number>, velocities?: ArrayLike<number>, affine?: ArrayLike<number>): void;
  maxDivergence(): number;
  step(count?: number): void;
  liquidVolume(): number;
  particleVolume(): number;
  kineticEnergy(): number;
  potentialEnergy(): number;
  front(axis?: 0 | 1 | 2): number;
  surfaceHeight(x0: number, x1: number): number;
  maxSpeed(): number;
  meanVelocity(c: 0 | 1 | 2, lo: FluidVec3, hi: FluidVec3): number;
}
```

### FreeSurfaceObstacleOptions · interface

A fixed or moving solid in the tank: axis-aligned (no rotation), voxelised (a cell is solid when its centre is inside).

```ts
export interface FreeSurfaceObstacleOptions {
    readonly shape: FluidShape;
    readonly position: FluidVec3;
    readonly velocity?: FluidVec3;
}
```

### FreeSurfaceOptions · interface

```ts
export interface FreeSurfaceOptions {
    readonly cells: FluidVec3;
    readonly spacing: number;
    readonly origin?: FluidVec3;
    readonly density: number;
    readonly dt: number;
    readonly gravity?: FluidVec3;
    readonly viscosity?: number;
    readonly walls?: 'free-slip' | 'no-slip';
    readonly particlesPerAxis?: number;
    readonly pressureTolerance?: number;
    readonly viscousTolerance?: number;
    readonly maxIterations?: number;
    readonly cflLimit?: number;
    readonly capacity?: number;
}
```

### FreeSurfaceStats · interface

```ts
export interface FreeSurfaceStats {
    steps: number;
    pressureIterations: number;
    viscousIterations: number;
    liquidCells: number;
    solidCells: number;
    cfl: number;
    maxCfl: number;
    cflExceeded: number;
    unconverged: number;
    divergence: number;
}
```

### freeSurfaceSubsystem · function

A free-surface tank as a subsystem of the one stepping loop (simulation.ts). Post stage (it does not act on the rigid
world); its dt may be the step, a whole fraction of it or a whole multiple. Energy: kinetic plus gravitational
potential energy of the particles (zero at the origin); nothing is exchanged with the outside, so the balance falls by
what the transfers and the walls dissipate. Events: 'cfl-exceeded' {cfl} when the Courant number first rises above the
limit, 'unconverged' {iterations} when a projection stopped at maxIterations.

```ts
export declare function freeSurfaceSubsystem<W, B>(fluid: FreeSurfaceFluid, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### hasimotoDragFactor · const

Drag of a simple cubic array of spheres in Stokes flow over that of one sphere alone, K = F / (6 pi mu a U), with U the
mean velocity over the whole periodic cell and c the solid fraction (Hasimoto 1959, as given by Ladd 1994, eq. 3.5):
  1 / K = 1 - 1.7601 c^(1/3) + c - 1.5593 c^2

```ts
export declare const hasimotoDragFactor: (solidFraction: number) => number;
```

### poiseuilleVelocity · const

Plane Poiseuille flow between walls at 0 and H driven by a body acceleration G: u = G y (H - y) / (2 nu).

```ts
export declare const poiseuilleVelocity: (y: number, height: number, acceleration: number, nu: number) => number;
```

### setFluidPressureSolverDefault · function

The pressure preconditioner of fluids built without `pressureSolver` from now on (validation runs use it to run every case with multigrid). Returns the previous default.

```ts
export declare function setFluidPressureSolverDefault(solver: 'mic' | 'multigrid'): 'mic' | 'multigrid';
```

### sloshingFrequency · const

Linear standing wave in a tank of length L and depth H, mode n: omega^2 = g k tanh(k H), k = n pi / L. Returns the frequency, Hz.

```ts
export declare const sloshingFrequency: (length: number, depth: number, gravity?: number, mode?: number) => number;
```

### taylorGreenVelocity · function

Taylor-Green vortex in a periodic square of side 2 pi / k: u = U sin kx cos ky e^(-2 nu k^2 t), v = -U cos kx sin ky e^(-2 nu k^2 t).

```ts
export declare function taylorGreenVelocity(x: number, y: number, t: number, { speed, wavenumber, nu }: {
    speed?: number;
    wavenumber?: number;
    nu: number;
}): [number, number, number];
```

## `box3d-webgpu-kit/shallow-water`

### bernoulliDepth · function

Depth of steady 1D frictionless flow of discharge q (m^2/s) over a bed z from Bernoulli, h^3 + (z - C) h^2 + q^2 / (2g) = 0
with C = q^2/(2 g h_ref^2) + h_ref + z_ref (SWASHES eq. 8 and sec. 3.1.3-3.1.5). `branch` 'sub' takes the root above the
critical depth, 'super' the one below. Returns NaN when the energy is too low for a root.

```ts
export declare function bernoulliDepth(z: number, q: number, energy: number, branch: 'sub' | 'super', gravity?: number): number;
```

### bumpBed · const

The bed of the Goutal and Maurel (1997) bump cases as given in SWASHES (sec. 3.1): 0.2 - 0.05 (x - 10)^2 on 8 < x < 12 m.

```ts
export declare const bumpBed: (x: number) => number;
```

### bumpShockPosition · function

Position of the hydraulic jump in the 'shock' bump case: q^2 (1/h1 - 1/h2) + g/2 (h1^2 - h2^2) = 0 (SWASHES eq. 10).

```ts
export declare function bumpShockPosition(gravity?: number): number;
```

### bumpSteadyDepth · function

Steady depth over the bump for the three SWASHES flowing cases: 'subcritical' (q 4.42, h_L 2), 'transcritical' (q 1.53),
'shock' (q 0.18, h_L 0.33, hydraulic jump located by Rankine-Hugoniot). Domain 0 to 25 m.

```ts
export declare function bumpSteadyDepth(x: number, kind: 'subcritical' | 'transcritical' | 'shock', gravity?: number): number;
```

### greenAmptCumulative · function

Cumulative Green-Ampt infiltration under a constant rain r (m/s) on a soil (K, psi, eta) with no runoff: before ponding all
the rain enters (F = r t) until F_p = K S / (r - K), S = psi eta, which follows from setting the rate of Rawls et al. eq. 1,
f = K (1 + S / F), equal to r; after it F solves eq. 2 between F_p and F: F - F_p - S ln((F + S)/(F_p + S)) = K (t - t_p).
When r <= K the soil never ponds and F = r t. Returns F, m.

```ts
export declare function greenAmptCumulative(t: number, rain: number, soil: GreenAmptSoil): number;
```

### greenAmptPondingTime · const

Ponding time of Green-Ampt under constant rain r > K: t_p = K S / (r (r - K)).

```ts
export declare const greenAmptPondingTime: (rain: number, soil: GreenAmptSoil) => number;
```

### GreenAmptSoil · interface

Green-Ampt infiltration parameters (Rawls, Brakensiek and Miller 1983, eqs. 1 and 2). SI units.

```ts
export interface GreenAmptSoil {
    readonly conductivity: number;
    readonly suction: number;
    readonly moistureDeficit: number;
}
```

### greenAmptStep · function

Depth infiltrated over dt by Green-Ampt from a cumulative depth F with `available` water on the surface (m): the
ponded-capacity integral F2 - F - S ln((F2 + S) / (F + S)) = K dt (Rawls et al. 1983, eq. 2, between F and F2), solved by
safeguarded Newton, capped by the water there is. S = psi * eta, m; K, m/s.

```ts
export declare function greenAmptStep(F: number, available: number, K: number, S: number, dt: number): number;
```

### kinematicEquilibriumTime · const

```ts
export declare const kinematicEquilibriumTime: ({ length, rain, slope, manning }: {
    length: number;
    rain: number;
    slope: number;
    manning: number;
}) => number;
```

### kinematicWaveOutflow · function

Kinematic wave on a plane under constant rainfall excess r from t = 0 (WEPP technical documentation, ch. 4, eqs. 4.4.1-
4.4.10, with Manning: alpha = sqrt(S) / n, m = 5/3): outflow per unit width at the foot of a plane of length L, m^2/s.
Rising limb q = alpha (r t)^m until t_e = (L / (alpha r^(m-1)))^(1/m), then r L.

```ts
export declare function kinematicWaveOutflow(t: number, { length, rain, slope, manning }: {
    length: number;
    rain: number;
    slope: number;
    manning: number;
}): number;
```

### laminarFilmDepth · const

Depth of a steady laminar film on an incline of slope S carrying q per width: q = g S h^3 / (3 nu) (Poiseuille film; the
standard result, written from memory).

```ts
export declare const laminarFilmDepth: (q: number, nu: number, slope: number, gravity?: number) => number;
```

### manningNormalDepth · const

Manning normal depth of a wide channel (unit width): q = (1/n) h^(5/3) sqrt(S)  =>  h = (n q / sqrt(S))^(3/5).

```ts
export declare const manningNormalDepth: (q: number, n: number, slope: number) => number;
```

### ritterDamBreak · function

Ritter's dry dam break on a flat frictionless bed (SWASHES, Delestre et al. 2013, sec. 4.1.2): [h, u] at x, t.

```ts
export declare function ritterDamBreak(x: number, t: number, { depth, dam, gravity }: {
    depth: number;
    dam: number;
    gravity?: number;
}): [number, number];
```

### SHALLOW_WATER_COUPLING_BACKEND · const

```ts
export declare const SHALLOW_WATER_COUPLING_BACKEND = "rigid-shallow-water-coupling-js-f64-v1";
```

### SHALLOW_WATER_GRAVITY · const

Standard gravity used when none is given, m/s^2.

```ts
export declare const SHALLOW_WATER_GRAVITY = 9.81;
```

### SHALLOW_WATER_SOLVER_ID · const

```ts
export declare const SHALLOW_WATER_SOLVER_ID = "shallow-water-hr-muscl-hll-js-f64-v1";
```

### SHALLOW_WATER_SUBSYSTEM_ORDER · const

Where shallow water runs: coupled, in the couple stage after the fluid (180) and before the water basin (200); bare, in the post stage after the free-surface tank (520).

```ts
export declare const SHALLOW_WATER_SUBSYSTEM_ORDER = 190;
```

### ShallowWater · class

```ts
export declare class ShallowWater {
  readonly solver = "shallow-water-hr-muscl-hll-js-f64-v1";
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  readonly dz: number;
  readonly origin: readonly [number, number];
  readonly gravity: number;
  readonly density: number;
  readonly cfl: number;
  readonly order: 1 | 2;
  readonly dryDepth: number;
  readonly maxSubsteps: number;
  readonly bed: Float64Array;
  readonly h: Float64Array;
  readonly qx: Float64Array;
  readonly qz: Float64Array;
  readonly manning: Float64Array;
  readonly infiltrated: Float64Array;
  readonly soilK: Float64Array;
  readonly soilS: Float64Array;
  readonly solid: Uint8Array;
  readonly ledger: ShallowWaterLedger;
  readonly viscosity: number;
  readonly rainVelocity: Float64Array<ArrayBuffer>;
  readonly stats: ShallowWaterStats;
  readonly initialVolume: number;
  dt: number;
  time: number;
  steps: number;
  readonly sourceMomentum: Float64Array<ArrayBuffer>;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  get cells(): number;
  rainAt(time?: number): number;
  setRain(rain: number | ((time: number) => number)): void;
  setBoundary(key: keyof ShallowWaterBoundaries, value: ShallowWaterSide): void;
  setTimeStep(dt: number): void;
  sideStates(): { kind: 0 | 1 | 2 | 3; discharge: number; depth: number; level: number; lo: number; hi: number; width: number; }[];
  volume(): number;
  volumeError(): number;
  addVolume(c: number, volume: number, u?: number, v?: number): void;
  removeVolume(c: number, volume: number): number;
  cellAt(x: number, z: number): number;
  level(c: number): number;
  velocity(c: number): [number, number];
  froude(c: number): number;
  levelAt(x: number, z: number): number;
  depthAt(x: number, z: number): number;
  dischargeX(x: number): number;
  kineticEnergy(): number;
  potentialEnergy(): number;
  maxDepth(): number;
  maxSpeed(minimum?: number): number;
  momentum(): [number, number];
  stableTimeStep(): number;
  bedChanged(): void;
  step(count?: number): void;
  advance(duration: number): void;
}
```

### ShallowWaterBodyOptions · interface

```ts
export interface ShallowWaterBodyOptions {
    readonly shape: ShallowWaterShape;
    readonly dragCoefficient?: number;
    readonly referenceArea?: number;
    readonly angularDrag?: number;
}
```

### ShallowWaterBodyReport · interface

Live per-body results of the last step.

```ts
export interface ShallowWaterBodyReport {
    readonly volume: number;
    submergedVolume: number;
    submergedFraction: number;
    readonly centre: Float64Array;
    readonly buoyancy: Float64Array;
    readonly drag: Float64Array;
}
```

### ShallowWaterBoundaries · interface

```ts
export interface ShallowWaterBoundaries {
    readonly xMin?: ShallowWaterSide;
    readonly xMax?: ShallowWaterSide;
    readonly zMin?: ShallowWaterSide;
    readonly zMax?: ShallowWaterSide;
}
```

### ShallowWaterCoupling · class

Two-way coupling of rigid bodies with a ShallowWater. Call `step()` immediately before `world.step()`; it advances the
water by the rigid step. For each body: the local water plane (level and slope, bilinear between cell centres, read one
cell outside the body's footprint), the exact volume of the shape below it and its centroid, the buoyant force rho g V along the
plane's normal at the centre of buoyancy, and a drag C_d A rho |w| w / 2 on the velocity w of the body relative to the
depth-averaged water, scaled by the submerged fraction. The reaction of the horizontal force goes into the water's
momentum over the footprint; the change of the displaced volume per cell goes in (or out) as a volume source, so
that a body floating in a lake raises its level; what a body displaces when it is first seen is part of the starting
water. Explicit: the water feels the body's forces of the same step.

```ts
export declare class ShallowWaterCoupling<B> {
  readonly backend = "rigid-shallow-water-coupling-js-f64-v1";
  readonly world: ShallowWaterWorld<B>;
  readonly water: ShallowWater;
  readonly dt: number;
  readonly impulseOnBodies: Float64Array<ArrayBuffer>;
  readonly impulseOnWater: Float64Array<ArrayBuffer>;
  steps: number;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  addBody(body: B, options: ShallowWaterBodyOptions): ShallowWaterBodyReport;
  report(body: B): ShallowWaterBodyReport | null;
  get bodyCount(): number;
  step(): void;
}
```

### ShallowWaterLedger · interface

Signed volume budget since construction, m^3. volume() - initialVolume = inflow + rain - infiltrated + clipped, to round-off.

```ts
export interface ShallowWaterLedger {
    inflow: number;
    rain: number;
    infiltrated: number;
    sources: number;
    clipped: number;
    displaced: number;
}
```

### ShallowWaterOptions · interface

```ts
export interface ShallowWaterOptions {
    readonly cells: readonly [number, number];
    readonly spacing: number | readonly [number, number];
    readonly origin?: readonly [number, number];
    readonly bed?: ArrayLike<number> | ((x: number, z: number) => number);
    readonly depth?: ArrayLike<number> | ((x: number, z: number, bed: number) => number);
    readonly level?: number | ((x: number, z: number) => number);
    readonly velocity?: readonly [number, number] | ((x: number, z: number) => readonly [number, number]);
    readonly manning?: number | ArrayLike<number>;
    readonly viscosity?: number;
    readonly soil?: GreenAmptSoil | readonly (GreenAmptSoil | null)[];
    readonly rain?: number | ((time: number) => number);
    readonly solid?: ArrayLike<number>;
    readonly boundaries?: ShallowWaterBoundaries;
    readonly gravity?: number;
    readonly density?: number;
    readonly dt?: number;
    readonly cfl?: number;
    readonly order?: 1 | 2;
    readonly dryDepth?: number;
    readonly maxSubsteps?: number;
}
```

### ShallowWaterShape · type

```ts
export type ShallowWaterShape = {
    readonly kind: 'box';
    readonly halfExtents: readonly [number, number, number];
} | {
    readonly kind: 'sphere';
    readonly radius: number;
};
```

### ShallowWaterSide · type

A side of the domain.

```ts
export type ShallowWaterSide = 'wall'
| 'open'
| {
    readonly type: 'inflow';
    readonly discharge: number;
    readonly depth?: number;
    readonly span?: readonly [number, number];
}
| {
    readonly type: 'stage';
    readonly level: number;
};
```

### ShallowWaterStats · interface

What a step did, for diagnostics and events.

```ts
export interface ShallowWaterStats {
    substeps: number;
    totalSubsteps: number;
    courant: number;
    maxWaveSpeed: number;
    wetCells: number;
}
```

### shallowWaterSubsystem · function

Shallow water as a subsystem of the one stepping loop (simulation.ts).
 - A `ShallowWaterCoupling`: couple stage, order 190; its step is the rigid step.
 - A bare `ShallowWater`: post stage, order 530; its dt may be the step, a whole fraction of it or a whole multiple.
Every step is split into CFL-limited substeps; a step that would need more than `maxSubsteps` throws
UNSTABLE_TIME_STEP. Energy: kinetic plus potential energy of the water (rho g (h^2/2 + h b) per area); `exchanged` is 0:
the energy carried by inflows, rain and infiltration is not booked, so the balance moves with them as well as falling
with friction and shocks. Events at the end of a step: 'wet-cells' {wet, before} when the number of wet cells changes by
more than 10%, 'substeps' {substeps} when a step first needs more than 100 substeps.

```ts
export declare function shallowWaterSubsystem<W, B>(target: ShallowWater | ShallowWaterCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### ShallowWaterWorld · interface

The part of a rigid world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface ShallowWaterWorld<B> {
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    applyForce(body: B, force: readonly [number, number, number], point?: readonly [number, number, number]): void;
    applyTorque(body: B, torque: readonly [number, number, number]): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
}
```

### stokerDamBreak · function

Stoker's wet dam break on a flat frictionless bed (SWASHES, sec. 4.1.1): [h, u] at x, t.

```ts
export declare function stokerDamBreak(x: number, t: number, { left, right, dam, gravity }: {
    left: number;
    right: number;
    dam: number;
    gravity?: number;
}): [number, number];
```

### stokerMiddleCelerity · function

cm of Stoker's wet dam break: the root of -8 g hr cm^2 (sqrt(g hl) - cm)^2 + (cm^2 - g hr)^2 (cm^2 + g hr) = 0 between sqrt(g hr) and sqrt(g hl).

```ts
export declare function stokerMiddleCelerity(left: number, right: number, gravity?: number): number;
```

### thackerBed · const

Thacker's radially symmetric oscillating paraboloid (SWASHES, sec. 4.2.2): the bed z(r) = -h0 (1 - r^2/a^2), measured from the centre (cx, cz).

```ts
export declare const thackerBed: (x: number, z: number, { h0, a, centre }: {
    h0: number;
    a: number;
    centre: readonly [number, number];
}) => number;
```

### thackerDepth · function

The depth of Thacker's paraboloid at (x, z, t); A = (a^2 - r0^2) / (a^2 + r0^2), omega = sqrt(8 g h0) / a.

```ts
export declare function thackerDepth(x: number, z: number, t: number, { h0, a, r0, centre, gravity }: {
    h0: number;
    a: number;
    r0: number;
    centre: readonly [number, number];
    gravity?: number;
}): number;
```

### thackerFrequency · const

Thacker's angular frequency sqrt(8 g h0) / a, rad/s.

```ts
export declare const thackerFrequency: (h0: number, a: number, gravity?: number) => number;
```

## `box3d-webgpu-kit/flow`

### createFlowStudy · function

```ts
export declare function createFlowStudy(study: unknown, options?: FlowStudyOptions): FlowStudyRun;
```

### Flow · class

```ts
export declare class Flow {
  readonly grid: FlowGrid;
  readonly lattice: FlowLattice;
  readonly fluid: FlowFluid;
  readonly dt: number;
  readonly cell: number;
  readonly latticeSpeed: number;
  readonly referenceSpeed: number;
  readonly turbulence: 'none' | 'smagorinsky' | 'wale';
  readonly smagorinsky: number;
  readonly wale: number;
  readonly cellReynolds: number;
  readonly relaxationTime: number;
  readonly parts: readonly string[];
  readonly geometryParts: number;
  readonly thickening: { readonly items: number; readonly largest: number; readonly closedCells: number; readonly slender: number; };
  readonly patches: readonly FlowPatchInfo[];
  readonly actuators: readonly FlowActuatorInfo[];
  readonly actuatorCells: readonly Int32Array[];
  readonly surfaces: readonly FlowSurface[];
  readonly items: readonly FlowItemReport[];
  readonly warnings: readonly string[];
  readonly solidCells: number;
  readonly fluidCells: number;
  readonly enclosedCells: number;
  time: number;
  meanSamples: number;
  get stepCount(): number;
  get distance(): Float32Array;
  step(steps?: number): void;
  setViscosityScale(k: number): void;
  pressureArea(about?: FlowVec3): { name: string; force: [number, number, number]; moment: [number, number, number]; }[];
  forces(about?: FlowVec3): { name: string; force: [number, number, number]; moment: [number, number, number]; }[];
  takeSums(about?: FlowVec3): { steps: number; parts: { name: string; force: [number, number, number]; moment: [number, number, number]; }[]; flowRates: number[]; wallFlowRate: number; };
  excessVolume(): number;
  maxSpeed(): number;
  healthy(): boolean;
  accumulate(): void;
  resetMean(): void;
  field(mean?: boolean): FlowField;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
}
```

### FLOW_AUTO_MODEL · const

The sub-grid model `turbulence: 'auto'` picks above its thresholds.

```ts
export declare const FLOW_AUTO_MODEL: 'smagorinsky' | 'wale';
```

### FLOW_CX · const

D3Q19 velocities, opposite directions and weights.

```ts
export declare const FLOW_CX: readonly number[];
```

### FLOW_CY · const

```ts
export declare const FLOW_CY: readonly number[];
```

### FLOW_CZ · const

```ts
export declare const FLOW_CZ: readonly number[];
```

### FLOW_FLUID · const

Cell kinds of the lattice.

```ts
export declare const FLOW_FLUID = 0, FLOW_WALL = 1, FLOW_VELOCITY = 2, FLOW_PRESSURE = 3, FLOW_SLIP = 4;
```

### FLOW_FLUIDS · const

Air and water at 20 C and 1 atm: the density and dynamic viscosity of the material library (docs/MATERIALS.md).

```ts
export declare const FLOW_FLUIDS: Readonly<Record<'air' | 'water', FlowFluid>>;
```

### FLOW_LATTICE_ID · const

```ts
export declare const FLOW_LATTICE_ID = "flow-lbm-d3q19-regularized-les-js-f64-v1";
```

### FLOW_LIMITS · const

```ts
export declare const FLOW_LIMITS: readonly string[];
```

### FLOW_MARGINS · const

Default margins of an external study, in multiples of `margins.length`.

```ts
export declare const FLOW_MARGINS: Readonly<{
    upstream: 3;
    downstream: 6;
    side: 2.5;
    top: 2.5;
}>;
```

### FLOW_MAX_CELLS · const

Most cells of the box (fluid or not). The box costs about 15 bytes per cell, the fluid about 420 bytes per fluid cell.

```ts
export declare const FLOW_MAX_CELLS: number;
```

### FLOW_OPPOSITE · const

```ts
export declare const FLOW_OPPOSITE: readonly number[];
```

### FLOW_PRESSURE · const

```ts
export declare const FLOW_FLUID = 0, FLOW_WALL = 1, FLOW_VELOCITY = 2, FLOW_PRESSURE = 3, FLOW_SLIP = 4;
```

### FLOW_RESULT_FORMAT · const

```ts
export declare const FLOW_RESULT_FORMAT = "box3d-flow-result/1";
```

### FLOW_SIDES · const

```ts
export declare const FLOW_SIDES: readonly FlowSideName[];
```

### FLOW_SLIP · const

```ts
export declare const FLOW_FLUID = 0, FLOW_WALL = 1, FLOW_VELOCITY = 2, FLOW_PRESSURE = 3, FLOW_SLIP = 4;
```

### FLOW_SOLVER_ID · const

```ts
export declare const FLOW_SOLVER_ID = "flow-lbm-d3q19-regularized-les-js-f64-v1";
```

### FLOW_SOLVER_VERSION · const

```ts
export declare const FLOW_SOLVER_VERSION = "1.0.0";
```

### FLOW_STATEMENT · const

```ts
export declare const FLOW_STATEMENT = "Weakly compressible lattice-Boltzmann (D3Q19, regularised collision) with a Smagorinsky sub-grid model and a power-law wall function on smooth walls, on a uniform grid of cubic cells, float64, deterministic. Above a cell Reynolds number of about 10 it is an under-resolved large-eddy simulation: an engineering estimate, not certified CFD.";
```

### FLOW_STUDY_FORMAT · const

```ts
export declare const FLOW_STUDY_FORMAT = "box3d-flow-study/1";
```

### FLOW_THIN_CELLS · const

The thinnest wall the lattice is certain to see, in cells (see the header).

```ts
export declare const FLOW_THIN_CELLS = 1.44;
```

### FLOW_VELOCITY · const

```ts
export declare const FLOW_FLUID = 0, FLOW_WALL = 1, FLOW_VELOCITY = 2, FLOW_PRESSURE = 3, FLOW_SLIP = 4;
```

### FLOW_WALL · const

```ts
export declare const FLOW_FLUID = 0, FLOW_WALL = 1, FLOW_VELOCITY = 2, FLOW_PRESSURE = 3, FLOW_SLIP = 4;
```

### FLOW_WEIGHT · const

```ts
export declare const FLOW_WEIGHT: readonly number[];
```

### FlowActuator · interface

An actuator disc: a momentum source spread over the fluid cells of a disc (a fan, a propeller, a turbine as drag).

```ts
export interface FlowActuator {
    readonly name: string;
    readonly center: FlowVec3;
    readonly axis: FlowVec3;
    readonly radius: number;
    readonly thickness?: number;
    readonly force?: number;
    readonly pressureJump?: number;
}
```

### FlowActuatorInfo · interface

```ts
export interface FlowActuatorInfo {
    readonly name: string;
    readonly cells: number;
    readonly force: number;
    readonly axis: FlowVec3;
    readonly area: number;
}
```

### FlowApexOptions · interface

Options of `flowItemsFromApexGeometry`.

```ts
export interface FlowApexOptions {
    readonly role?: 'solid' | 'cavity';
    readonly partName?: 'id' | 'name';
    readonly parts?: readonly number[];
}
```

### FlowBeam · interface

A straight member from `from` to `to`. `depth` is measured along `up`, `width` across. An I section has two flanges
of thickness `flange` and a web of thickness `web`.

```ts
export interface FlowBeam extends ItemBase {
    readonly kind: 'beam';
    readonly from: FlowVec3;
    readonly to: FlowVec3;
    readonly up?: FlowVec3;
    readonly section?: 'rect' | 'i';
    readonly width: number;
    readonly depth: number;
    readonly flange?: number;
    readonly web?: number;
}
```

### FlowBox · interface

A box: `halfExtents`, or the full `size`, along its local x, y, z.

```ts
export interface FlowBox extends ItemBase {
    readonly kind: 'box';
    readonly center: FlowVec3;
    readonly halfExtents?: FlowVec3;
    readonly size?: FlowVec3;
    readonly rotation?: FlowQuat;
}
```

### FlowCapsule · interface

```ts
export interface FlowCapsule extends ItemBase, AxisPlacement {
    readonly kind: 'capsule';
    readonly radius: number;
}
```

### FlowCone · interface

A cone frustum: `radius` at `from` (the -Y end), `radiusTop` at `to`.

```ts
export interface FlowCone extends ItemBase, AxisPlacement {
    readonly kind: 'cone';
    readonly radius: number;
    readonly radiusTop: number;
}
```

### FlowCylinder · interface

```ts
export interface FlowCylinder extends ItemBase, AxisPlacement {
    readonly kind: 'cylinder';
    readonly radius: number;
}
```

### FlowField · interface

Fields of the flow in SI units on the lattice (the fluid box plus its boundary layers).

```ts
export interface FlowField {
    readonly grid: FlowGrid;
    readonly fluid: Uint8Array;
    readonly ux: Float32Array;
    readonly uy: Float32Array;
    readonly uz: Float32Array;
    readonly pressure: Float32Array;
    readonly distance: Float32Array;
    readonly opening?: Int16Array;
}
```

### FlowFluid · interface

```ts
export interface FlowFluid {
    readonly density: number;
    readonly viscosity: number;
}
```

### flowFrequency · function

Frequency of an oscillating history sampled every `dt`: from the upward crossings of its mean, with linear
interpolation. Returns null when there are fewer than three crossings. `amplitude` is the root mean square about the mean.

```ts
export declare function flowFrequency(samples: ArrayLike<number>, dt: number): {
    frequency: number;
    amplitude: number;
    mean: number;
    periods: number;
} | null;
```

### flowGeometryBounds · function

Bounds of a list of items: [min, max]. Cavities and solids alike.

```ts
export declare function flowGeometryBounds(items: readonly FlowItem[]): {
    min: [number, number, number];
    max: [number, number, number];
};
```

### FlowGrid · interface

```ts
export interface FlowGrid {
    readonly origin: FlowVec3;
    readonly cell: number;
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
}
```

### FlowItem · type

```ts
export type FlowItem = FlowPrimitive | FlowMesh;
```

### FlowItemReport · interface

```ts
export interface FlowItemReport {
    readonly index: number;
    readonly id?: string | number;
    readonly kind: string;
    readonly part: string;
    readonly role: 'solid' | 'cavity';
    readonly thickened: number;
    readonly thickenedCells?: number;
    readonly smallestDimension: number | null;
    readonly triangles?: number;
    readonly components?: number;
    readonly closedComponents?: number;
    readonly surfaceArea: number;
    readonly unresolvedFraction: number;
}
```

### flowItemsFromApexGeometry · function

The items of an `apex-flow-geometry/1` document (metres, +y up, right-handed, quaternions x, y, z, w, not recentred):
a box has its FULL extents in `size` along its local axes; a cylinder (flat ends) and a capsule lie along their local
+y with the full `length` (for a capsule, the segment between the centres of its end spheres); a mesh keeps its
per-element closed / open flags and thicknesses. Every item carries its element id as `id` and its layer as `part`.
The units and axes are those of this solver: nothing is converted.

```ts
export declare function flowItemsFromApexGeometry(document: unknown, options?: FlowApexOptions): FlowItem[];
```

### FlowLattice · class

```ts
export declare class FlowLattice {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cells: number;
  readonly periodic: readonly [boolean, boolean, boolean];
  readonly kind: Uint8Array;
  readonly owner: Int16Array | Int32Array;
  readonly walls: 'interpolated' | 'halfway';
  readonly viscosity: number;
  readonly smagorinsky: number;
  readonly wale: number;
  readonly bulkRelaxation: number;
  readonly collision: 'regularized' | 'trt';
  readonly partCount: number;
  readonly patchCount: number;
  readonly fluidCells: number;
  readonly cellOf: Int32Array;
  readonly activeOf: Int32Array;
  f: Float64Array;
  readonly density: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  readonly uz: Float64Array;
  force: [number, number, number];
  ramp: number;
  viscosityScale: number;
  stepCount: number;
  readonly partForce: Float64Array;
  readonly partMoment: Float64Array;
  readonly patchMass: Float64Array;
  wallMass: number;
  readonly wallFunction: boolean;
  get eddyViscosity(): Float64Array | null;
  wettedArea(): { force: Float64Array; moment: Float64Array; };
  program(): { fluidCells: number; source: Int32Array; linkIndex: Int32Array; linkStart: Int32Array; linkDir: Uint8Array; linkKind: Uint8Array; linkQ: Float64Array; linkAdd: Float64Array; linkOwner: Int32Array; linkAux: Int32Array; linkArm: Float32Array; viscosity: number; smagorinsky: number; bulkRelaxation: number; features: string[]; };
  get linkCount(): number;
  step(): void;
  excessMass(): number;
  momentum(): [number, number, number];
  healthy(): boolean;
  saveState(): StateObject;
  restoreState(state: StateValue): void;
}
```

### FlowLatticeOptions · interface

```ts
export interface FlowLatticeOptions {
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
    readonly periodic?: readonly [boolean, boolean, boolean];
    readonly kind: Uint8Array;
    readonly owner?: Int16Array | Int32Array;
    readonly distance?: Float32Array;
    readonly walls?: 'interpolated' | 'halfway';
    readonly parts?: readonly FlowLatticePart[];
    readonly patches?: readonly FlowLatticePatch[];
    readonly viscosity: number;
    readonly smagorinsky?: number;
    readonly wale?: number;
    readonly wallFunction?: boolean;
    readonly wallFunctionMask?: Uint8Array;
    readonly collision?: 'regularized' | 'trt';
    readonly bulkRelaxation?: number;
    readonly force?: readonly [number, number, number];
    readonly initialVelocity?: readonly [number, number, number];
    readonly extraViscosity?: Float32Array;
    readonly absorbSteps?: number;
    readonly forceCells?: Int32Array;
    readonly forceValues?: Float64Array;
    readonly cellVelocity?: ReadonlyMap<number, readonly [number, number, number]>;
}
```

### FlowLatticePart · interface

```ts
export interface FlowLatticePart {
    readonly velocity?: readonly [number, number, number];
    readonly angularVelocity?: readonly [number, number, number];
    readonly centre?: readonly [number, number, number];
}
```

### FlowLatticePatch · interface

```ts
export interface FlowLatticePatch {
    readonly velocity?: readonly [number, number, number];
    readonly density?: number;
}
```

### flowLine · function

The fields along a straight line.

```ts
export declare function flowLine(field: FlowField, from: FlowVec3, to: FlowVec3, samples?: number, along?: FlowVec3): FlowLine;
```

### FlowLine · interface

```ts
export interface FlowLine {
    readonly from: FlowVec3;
    readonly to: FlowVec3;
    readonly s: Float32Array;
    readonly ux: Float32Array;
    readonly uy: Float32Array;
    readonly uz: Float32Array;
    readonly speed: Float32Array;
    readonly pressure: Float32Array;
    readonly distance: Float32Array;
    readonly zeroCrossings: number[];
}
```

### FlowMesh · interface

```ts
export interface FlowMesh extends ItemBase {
    readonly kind: 'mesh';
    readonly positions: ArrayLike<number>;
    readonly indices?: ArrayLike<number>;
    readonly thickness?: number;
    readonly position?: FlowVec3;
    readonly rotation?: FlowQuat;
    readonly scale?: number | FlowVec3;
    readonly elements?: readonly FlowMeshElement[];
}
```

### FlowMeshElement · interface

```ts
export interface FlowMeshElement {
    readonly element?: string | number;
    readonly triStart: number;
    readonly triCount: number;
    readonly closed: boolean;
    readonly thickness?: number;
}
```

### FlowOptions · interface

```ts
export interface FlowOptions {
    readonly grid: FlowGrid;
    readonly geometry?: readonly FlowItem[];
    readonly fluid: FlowFluid;
    readonly sides?: Partial<Record<FlowSideName, FlowSide>>;
    readonly patches?: readonly FlowPatch[];
    readonly motion?: Readonly<Record<string, FlowPartMotion>>;
    readonly actuators?: readonly FlowActuator[];
    readonly referenceSpeed: number;
    readonly latticeSpeed?: number;
    readonly turbulence?: 'auto' | 'none' | 'smagorinsky' | 'wale';
    readonly absorbSteps?: number;
    readonly collision?: 'auto' | 'regularized' | 'trt';
    readonly wale?: number;
    readonly reynolds?: number;
    readonly smagorinsky?: number;
    readonly wallFunction?: boolean;
    readonly wallFunctionCurvature?: number;
    readonly walls?: 'interpolated' | 'halfway';
    readonly acceleration?: FlowVec3;
    readonly initialVelocity?: FlowVec3;
    readonly rampSteps?: number;
    readonly spongeCells?: number;
    readonly band?: number;
    readonly surfaces?: boolean;
    readonly thicken?: boolean;
}
```

### FlowPartMotion · interface

A wall velocity for a part of the geometry: the solid stays where it is (a "frozen" rotor, a belt, a rolling wheel)
and its surface moves.

```ts
export interface FlowPartMotion {
    readonly velocity?: FlowVec3;
    readonly angularVelocity?: FlowVec3;
    readonly center?: FlowVec3;
}
```

### FlowPatch · interface

```ts
export interface FlowPatch {
    readonly name: string;
    readonly kind: 'inlet' | 'outlet';
    readonly shape: FlowPatchShape;
    readonly flowRate?: number;
    readonly speed?: number;
    readonly velocity?: FlowVec3;
    readonly profile?: 'uniform' | 'parabolic';
    readonly pressure?: number;
}
```

### FlowPatchInfo · interface

```ts
export interface FlowPatchInfo {
    readonly name: string;
    readonly kind: 'inlet' | 'outlet';
    readonly area: number;
    readonly normal: FlowVec3;
    readonly velocity: FlowVec3 | null;
    readonly pressure: number | null;
    readonly cells: number;
}
```

### FlowPatchShape · type

```ts
export type FlowPatchShape = 
{
    readonly kind: 'disc';
    readonly center: FlowVec3;
    readonly normal: FlowVec3;
    readonly radius: number;
} | {
    readonly kind: 'rect';
    readonly center: FlowVec3;
    readonly normal: FlowVec3;
    readonly up?: FlowVec3;
    readonly halfWidth: number;
    readonly halfHeight: number;
};
```

### FlowPrimitive · type

```ts
export type FlowPrimitive = FlowBox | FlowSphere | FlowCylinder | FlowCapsule | FlowCone | FlowTube | FlowBeam;
```

### flowPrimitiveSurface · function

Triangles of the surface of a primitive, with edges of about `size`.

```ts
export declare function flowPrimitiveSurface(item: FlowPrimitive, size: number): {
    positions: number[];
    indices: number[];
};
```

### FlowProgress · interface

```ts
export interface FlowProgress {
    readonly step: number;
    readonly maxSteps: number;
    readonly time: number;
    readonly fraction: number;
    readonly residual: number;
    readonly coefficients: {
        cd: number;
        cl: number;
        cs: number;
    } | null;
    readonly massBalance: number | null;
    readonly window: number;
    readonly phase: 'startup' | 'averaging';
}
```

### flowProjectedArea · function

Area of the shadow the solid cells cast along `direction`, m^2: every solid cell is eight sub-cells whose centres are
dropped onto a plane grid of half the cell size; the area is the number of grid squares hit times (h/2)^2. Along an
axis this counts the columns of cells that hold a solid cell. `solid(c)` says whether cell c counts.

```ts
export declare function flowProjectedArea(grid: {
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
    readonly cell: number;
}, solid: (cell: number) => boolean, direction: FlowVec3): number;
```

### FlowQuat · type

Quaternion x, y, z, w.

```ts
export type FlowQuat = readonly [number, number, number, number];
```

### flowRake · function

`count` points evenly spaced from `from` to `to` (a rake of seeds).

```ts
export declare function flowRake(from: FlowVec3, to: FlowVec3, count: number): FlowVec3[];
```

### flowSample · function

Trilinear sample of the velocity, pressure and wall distance at a point. Returns false outside the lattice. `out` is
[ux, uy, uz, pressure, distance]. The pressure is weighted over fluid cells only.

```ts
export declare function flowSample(field: FlowField, x: number, y: number, z: number, out: Float64Array | number[]): boolean;
```

### flowSection · function

Integrals over the cell layer of the lattice that holds the plane `axis = position`, optionally inside a box.

```ts
export declare function flowSection(field: FlowField, density: number, axis: 'x' | 'y' | 'z', position: number, bounds?: {
    readonly min: FlowVec3;
    readonly max: FlowVec3;
}): FlowSection;
```

### FlowSection · interface

```ts
export interface FlowSection {
    readonly axis: 'x' | 'y' | 'z';
    readonly position: number;
    readonly area: number;
    readonly flowRate: number;
    readonly meanSpeed: number;
    readonly maxSpeed: number;
    readonly maxNormalSpeed: number;
    readonly meanPressure: number;
    readonly meanTotalPressure: number;
    readonly momentumFactor: number;
}
```

### flowSeedPlane · function

A grid of nu x nv points on the parallelogram origin + s u + t v, at the centres of its cells.

```ts
export declare function flowSeedPlane(origin: FlowVec3, u: FlowVec3, v: FlowVec3, nu: number, nv: number): FlowVec3[];
```

### FlowSide · type

```ts
export type FlowSide = 'wall' | 'slip' | 'periodic'
| {
    readonly kind: 'wall';
    readonly velocity?: FlowVec3;
    readonly part?: string;
}
| {
    readonly kind: 'velocity';
    readonly velocity: FlowVec3 | ((x: number, y: number, z: number) => FlowVec3);
    readonly name?: string;
}
| {
    readonly kind: 'pressure';
    readonly pressure?: number;
    readonly name?: string;
};
```

### FlowSideName · type

```ts
export type FlowSideName = 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'zMin' | 'zMax';
```

### flowSlice · function

The fields on a plane normal to an axis, sampled at the cell centres of the lattice.

```ts
export declare function flowSlice(field: FlowField, axis: 'x' | 'y' | 'z', position: number): FlowSlice;
```

### FlowSlice · interface

```ts
export interface FlowSlice {
    readonly axis: 'x' | 'y' | 'z';
    readonly position: number;
    readonly axes: readonly ['x' | 'y' | 'z', 'x' | 'y' | 'z'];
    readonly nu: number;
    readonly nv: number;
    readonly origin: readonly [number, number];
    readonly cell: number;
    readonly speed: Float32Array;
    readonly pressure: Float32Array;
    readonly u: Float32Array;
    readonly v: Float32Array;
    readonly fluid: Uint8Array;
}
```

### FlowSphere · interface

```ts
export interface FlowSphere extends ItemBase {
    readonly kind: 'sphere';
    readonly center: FlowVec3;
    readonly radius: number;
}
```

### FlowStreamline · interface

```ts
export interface FlowStreamline {
    readonly seed: FlowVec3;
    readonly points: Float32Array;
    readonly speed: Float32Array;
    readonly pressure: Float32Array;
    readonly termination: 'opening' | 'wall' | 'outside' | 'stagnation' | 'length';
}
```

### FlowStreamlineOptions · interface

```ts
export interface FlowStreamlineOptions {
    readonly step?: number;
    readonly stride?: number;
    readonly maxPoints?: number;
    readonly direction?: 'forward' | 'backward' | 'both';
    readonly minSpeed?: number;
}
```

### flowStreamlines · function

Streamlines by classical Runge-Kutta (RK4) with a fixed arc-length step through the trilinear field.

```ts
export declare function flowStreamlines(field: FlowField, seeds: readonly FlowVec3[], options?: FlowStreamlineOptions): FlowStreamline[];
```

### FlowStudyOptions · interface

```ts
export interface FlowStudyOptions {
    readonly onProgress?: (progress: FlowProgress) => void;
    readonly loadMesh?: (file: string) => {
        positions: ArrayLike<number>;
        indices?: ArrayLike<number>;
    };
    readonly loadDocument?: (file: string) => unknown;
    readonly now?: () => number;
    readonly provenance?: Readonly<Record<string, string | number | boolean | null>>;
}
```

### FlowStudyRun · interface

A study in progress.

```ts
export interface FlowStudyRun {
    readonly setup: FlowStudySetup;
    readonly flow: Flow;
    readonly done: boolean;
    advance(): FlowProgress | null;
    result(): Json;
}
```

### flowStudySetup · function

Check a study and work out the set-up: the box, the cell size, the time step, the sides, the run lengths.

```ts
export declare function flowStudySetup(study: unknown, options?: FlowStudyOptions): FlowStudySetup;
```

### FlowStudySetup · interface

What `flowStudySetup` works out from a study: the options of the solver and the numbers of the set-up.

```ts
export interface FlowStudySetup {
    readonly name: string;
    readonly mode: 'external' | 'internal';
    readonly options: FlowOptions;
    readonly fluid: FlowFluid;
    readonly grid: FlowGrid;
    readonly referenceSpeed: number;
    readonly referenceLength: number;
    readonly referenceLengthSource: string;
    readonly reynolds: number;
    readonly transitTime: number;
    readonly external: null | {
        direction: [number, number, number];
        up: [number, number, number];
        side: [number, number, number];
        speed: number;
        ground: null | {
            height: number;
            type: 'fixed' | 'moving' | 'slip';
        };
        bodySize: number;
        bodyBounds: {
            min: [number, number, number];
            max: [number, number, number];
        };
        margins: {
            upstream: number;
            downstream: number;
            side: number;
            top: number;
            bottom: number;
            length: number;
        };
        momentCenter: [number, number, number];
        referenceArea: number | null;
    };
    readonly internal: null | {
        inlets: string[];
        outlets: string[];
        fluidFraction: number;
    };
    readonly run: {
        maxSteps: number;
        startupSteps: number;
        windowSteps: number;
        monitorEvery: number;
        sampleEvery: number;
        tolerance: number;
        viscosityBoost: null | {
            scale: number;
            fullUntil: number;
            rampUntil: number;
        };
    };
    readonly outputs: Json;
    readonly warnings: string[];
}
```

### FlowSurface · interface

Triangles of the surface of one part, for sampling and drawing.

```ts
export interface FlowSurface {
    readonly part: string;
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
}
```

### FlowSurfaceField · interface

```ts
export interface FlowSurfaceField {
    readonly part: string;
    readonly positions: Float32Array;
    readonly indices: Uint32Array;
    readonly pressure: Float32Array;
}
```

### flowSurfacePressure · function

Pressure on the surfaces of the parts.

```ts
export declare function flowSurfacePressure(field: FlowField, surfaces: readonly FlowSurface[]): FlowSurfaceField[];
```

### FlowTube · interface

A pipe wall: the solid between `innerRadius` and `radius`, open at both ends.

```ts
export interface FlowTube extends ItemBase, AxisPlacement {
    readonly kind: 'tube';
    readonly radius: number;
    readonly innerRadius: number;
}
```

### flowTubeMesh · function

A tube swept along a polyline, as a closed triangle mesh (caps at both ends): a pipe bore, a bent duct.

```ts
export declare function flowTubeMesh(path: readonly FlowVec3[], radius: number, segments?: number): {
    positions: number[];
    indices: number[];
};
```

### FlowVec3 · type

```ts
export type FlowVec3 = readonly [number, number, number];
```

### FlowVoxelization · interface

```ts
export interface FlowVoxelization extends FlowVoxels {
    readonly surfaces: readonly FlowSurface[];
    readonly thickenedItems: number;
    readonly largestThickening: number;
    readonly closedCells: number;
    readonly slenderItems: number;
}
```

### flowVoxelize · function

The signed distance of a list of items on a grid, the part of every cell, the surfaces and the report. The work is
proportional to the cells near each item (its bounding box plus the band), not to cells times items.

```ts
export declare function flowVoxelize(items: readonly FlowItem[], grid: FlowGrid, options?: FlowVoxelizeOptions): FlowVoxelization;
```

### FlowVoxelizeOptions · interface

```ts
export interface FlowVoxelizeOptions {
    readonly band?: number;
    readonly surfaceSize?: number;
    readonly surfaces?: boolean;
    readonly thicken?: boolean;
}
```

### FlowVoxels · interface

```ts
export interface FlowVoxels {
    readonly grid: FlowGrid;
    readonly distance: Float32Array;
    readonly part: Int16Array;
    readonly parts: readonly string[];
    readonly band: number;
    readonly items: readonly FlowItemReport[];
    readonly warnings: readonly string[];
    readonly solidCells: number;
}
```

### runFlowStudy · function

Run a study to its end and return the result document.

```ts
export declare function runFlowStudy(study: unknown, options?: FlowStudyOptions): Json;
```

## `box3d-webgpu-kit/flow-three`

### createFlowView · function

Build the three.js objects of a flow result.

```ts
export declare function createFlowView(THREE: FlowThreeLike, result: FlowResultLike, options?: FlowViewOptions): FlowView;
```

### flowColormap · function

A colour map: `t` in [0, 1] to [r, g, b] in [0, 1].

```ts
export declare function flowColormap(name?: FlowColormap): (t: number) => [number, number, number];
```

### FlowColormap · type

```ts
export type FlowColormap = 'rainbow' | 'turbo' | 'viridis' | 'coolwarm';
```

### flowLegend · function

Draw a vertical colour scale with labelled values (largest at the top) on a 2D canvas context.

```ts
export declare function flowLegend(context: FlowLegendContext, options: FlowLegendOptions): void;
```

### FlowLegendContext · interface

The part of a 2D canvas context the legend draws with.

```ts
export interface FlowLegendContext {
    fillStyle: unknown;
    strokeStyle: unknown;
    font: string;
    textAlign: string;
    textBaseline: string;
    lineWidth: number;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
}
```

### FlowLegendOptions · interface

```ts
export interface FlowLegendOptions {
    readonly min: number;
    readonly max: number;
    readonly title?: string;
    readonly unit?: string;
    readonly colormap?: FlowColormap;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
    readonly ticks?: number;
    readonly color?: string;
    readonly font?: string;
}
```

### FlowResultLike · interface

The members of a result this module reads (any `box3d-flow-result/1` document fits).

```ts
export interface FlowResultLike {
    readonly setup: {
        readonly lattice: {
            readonly cell: number;
        };
        readonly referenceSpeed: number;
    };
    readonly streamlines?: {
        readonly speedRange: readonly number[];
        readonly lines: readonly {
            readonly points: ArrayLike<number>;
            readonly speed: ArrayLike<number>;
            readonly pressure: ArrayLike<number>;
        }[];
    };
    readonly surface?: readonly {
        readonly part: string;
        readonly positions: ArrayLike<number>;
        readonly indices: ArrayLike<number>;
        readonly pressure: ArrayLike<number>;
        readonly cp: ArrayLike<number>;
    }[];
    readonly slices?: readonly {
        readonly axis: string;
        readonly position: number;
        readonly axes: readonly string[];
        readonly nu: number;
        readonly nv: number;
        readonly origin: readonly number[];
        readonly cell: number;
        readonly speed: ArrayLike<number>;
        readonly pressure: ArrayLike<number>;
        readonly fluid: ArrayLike<number>;
    }[];
}
```

### FlowThreeLike · interface

The parts of the THREE namespace this module uses.

```ts
export interface FlowThreeLike {
    Group: new () => any;
    BufferGeometry: new () => any;
    BufferAttribute: new (array: Float32Array | Uint32Array, itemSize: number) => any;
    Mesh: new (geometry: any, material: any) => any;
    MeshStandardMaterial: new (options?: object) => any;
    MeshBasicMaterial: new (options?: object) => any;
    LineSegments: new (geometry: any, material: any) => any;
    LineBasicMaterial: new (options?: object) => any;
    DoubleSide: unknown;
}
```

### FlowView · interface

```ts
export interface FlowView {
    readonly group: any;
    readonly streamlines: any | null;
    readonly surfaces: any[];
    readonly slices: any[];
    readonly range: [number, number];
    readonly colorBy: 'speed' | 'pressure';
    dispose(): void;
}
```

### FlowViewOptions · interface

```ts
export interface FlowViewOptions {
    readonly streamlines?: boolean;
    readonly streamlineStyle?: 'tubes' | 'lines';
    readonly tubeRadius?: number;
    readonly tubeSides?: number;
    readonly colorBy?: 'speed' | 'pressure';
    readonly range?: readonly [number, number];
    readonly colormap?: FlowColormap;
    readonly surface?: 'plain' | 'cp' | false;
    readonly surfaceColor?: number;
    readonly surfaceOpacity?: number;
    readonly cpRange?: readonly [number, number];
    readonly slices?: boolean;
    readonly sliceOpacity?: number;
}
```

## `box3d-webgpu-kit/solid-contact`

### SOLID_CONTACT_SOLVER_ID · const

```ts
export declare const SOLID_CONTACT_SOLVER_ID = "solid-contact-penalty-newton-pcg-js-f64-v1";
```

### SOLID_CONTACT_SUBSYSTEM_ORDER · const

Where the solid coupling runs inside the couple stage of a Simulation: after the cloth (150), before the water (200).

```ts
export declare const SOLID_CONTACT_SUBSYSTEM_ORDER = 170;
```

### SOLID_COUPLING_BACKEND · const

```ts
export declare const SOLID_COUPLING_BACKEND = "rigid-solid-coupling-monolithic-js-f64-v1";
```

### SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID · const

The solver id of `method: 'node-face'`: node-to-face penalty contact (the first version).

```ts
export declare const SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID = "solid-solid-contact-node-face-penalty-newton-pcg-js-f64-v1";
```

### SOLID_SOLID_CONTACT_SOLVER_ID · const

The solver id of the default (mortar) method recorded in results and checkpoints: segment-to-segment mortar penalty
contact with edge-to-edge contact, solved with the solids in one Newton solve (PCG), float64.

```ts
export declare const SOLID_SOLID_CONTACT_SOLVER_ID = "solid-solid-contact-mortar-penalty-newton-pcg-js-f64-v2";
```

### SOLID_SOLID_CONTACT_SUBSYSTEM_ORDER · const

Where the solid–solid contact subsystem runs in a Simulation step, among the other subsystems' orders.

```ts
export declare const SOLID_SOLID_CONTACT_SUBSYSTEM_ORDER = 300;
```

### SolidColliderOptions · interface

```ts
export interface SolidColliderOptions {
    readonly shape: SolidContactShape;
    readonly friction?: number;
    readonly inertia?: StructureInertia;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly gravityScale?: number;
}
```

### SolidContact · class

```ts
export declare class SolidContact {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver = "solid-contact-penalty-newton-pcg-js-f64-v1";
  readonly solid: SolidBody;
  readonly dt: number;
  readonly stiffnessScale: number;
  readonly skin: number;
  readonly predictor: 'previous' | 'velocity';
  readonly frictionPasses: number;
  readonly frictionTolerance: number;
  scheme: 'implicit' | 'naive-staggered';
  bodyStepFactor: number;
  integrateBodies: boolean;
  readonly bodyGravity: Float64Array<ArrayBuffer>;
  readonly stats: SolidContactStats;
  externalWork: number;
  readonly surfaceNodes: Uint32Array;
  readonly surfaceArea: Float64Array;
  readonly elementSize: number;
  readonly nodeForce: Float64Array;
  addBody(options: SolidContactBodyOptions): number;
  get bodyCount(): number;
  setBodyState(index: number, state: SolidContactBodyState): void;
  setBodyExternalLoad(index: number, force: ArrayLike<number>, torque: ArrayLike<number>, torqueOffset?: number): void;
  setBodyMass(index: number, mass: number): void;
  bodyForce(index: number): Float64Array;
  bodyTorque(index: number): Float64Array;
  bodyTwoWay(index: number): boolean;
  bodyGravityScale(index: number): number;
  bodyMass(index: number): number;
  bodyMotion(index: number): Float64Array;
  bodyContacts(index: number): number;
  bodyPosition(index: number): Float64Array;
  bodyRotation(index: number): Float64Array;
  bodyVelocity(index: number): Float64Array;
  bodyAngularVelocity(index: number): Float64Array;
  bodyAngularMomentumChange(index: number, dx: number, dy: number, dz: number, out: Float64Array): void;
  weld(nodes: ArrayLike<number>, bodyIndex: number): void;
  unweld(nodes: ArrayLike<number>): void;
  get weldCount(): number;
  step(count?: number): void;
  solveStatic(options?: { readonly pseudoStep?: number; readonly maxPasses?: number; readonly tolerance?: number; }): SolidStaticContactResult;
  contactEnergy(): number;
  maxPenetration(): number;
  linearMomentum(out?: number[] | Float64Array): number[] | Float64Array;
}
```

### SolidContactBodyOptions · interface

```ts
export interface SolidContactBodyOptions extends SolidContactBodyState {
    readonly shape: SolidContactShape;
    readonly type: 'static' | 'kinematic' | 'dynamic';
    readonly mass?: number;
    readonly inertia?: StructureInertia;
    readonly friction?: number;
    readonly collide?: boolean;
    readonly twoWay?: boolean;
    readonly gravityScale?: number;
}
```

### SolidContactBodyState · interface

```ts
export interface SolidContactBodyState {
    readonly position: ArrayLike<number>;
    readonly rotation: ArrayLike<number>;
    readonly linearVelocity?: ArrayLike<number>;
    readonly angularVelocity?: ArrayLike<number>;
}
```

### SolidContactOptions · interface

```ts
export interface SolidContactOptions {
    readonly stiffnessScale?: number;
    readonly skin?: number;
    readonly frictionPasses?: number;
    readonly frictionTolerance?: number;
    readonly scheme?: 'implicit' | 'naive-staggered';
    readonly gravity?: SolidContactVec3;
    readonly predictor?: 'previous' | 'velocity';
}
```

### SolidContactShape · type

```ts
export type SolidContactShape = {
    readonly kind: 'box';
    readonly halfExtents: SolidContactVec3;
} | {
    readonly kind: 'sphere';
    readonly radius: number;
}
| {
    readonly kind: 'capsule';
    readonly radius: number;
    readonly halfLength: number;
}
| {
    readonly kind: 'plane';
    readonly normal: SolidContactVec3;
};
```

### SolidContactStats · interface

```ts
export interface SolidContactStats {
    converged: boolean;
    newtonIterations: number;
    linearIterations: number;
    residual: number;
    reference: number;
    frictionPasses: number;
    unconvergedSteps: number;
    contacts: number;
}
```

### solidContactSubsystem · function

A solid in contact as a subsystem of the one stepping loop (simulation.ts).
 - A `SolidCoupling`: couple stage, order 170. It exchanges forces with the rigid step, so its dt must equal the
   simulation step.
 - A bare `SolidContact` (its own bodies, no world): post stage; its dt may be the step or a whole fraction of it.
Do not also register the same SolidBody with `solidSubsystem`: it would be stepped twice.
Energy: kinetic + strain + load potential of the solid plus the energy in the contact springs, with the work the
bodies did on the solid as `exchanged`; the bodies themselves are not counted (track them with
`simulation.trackBody`). Backward Euler and friction make `total - exchanged` fall.
Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a body starts or
stops pressing on the solid (SolidCoupling only), and 'unconverged' with {residual, reference}.

```ts
export declare function solidContactSubsystem<W, B>(target: SolidContact | SolidCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### SolidContactVec3 · type

```ts
export type SolidContactVec3 = readonly [number, number, number];
```

### SolidCoupling · class

Two-way coupling of a deformable solid with a rigid world. Call `step()` immediately before `world.step()`: it reads
the bodies, advances the solid by one step with the dynamic bodies as unknowns of the same solve, and gives each
body the force and torque the solid put on it, to act through the rigid step.

```ts
export declare class SolidCoupling<B> {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly backend = "rigid-solid-coupling-monolithic-js-f64-v1";
  readonly world: SolidWorld<B>;
  readonly contact: SolidContact;
  readonly solid: SolidBody;
  readonly dt: number;
  readonly estimateSupports: boolean;
  steps: number;
  addBody(body: B, options: SolidColliderOptions): number;
  addPlane(options: { readonly normal: SolidContactVec3; readonly point?: SolidContactVec3; readonly friction?: number; }): number;
  indexOf(body: B): number;
  weld(nodes: ArrayLike<number>, body: B): void;
  unweld(nodes: ArrayLike<number>): void;
  force(body: B): Float64Array;
  torque(body: B): Float64Array;
  step(): void;
  contactChanges(each: (body: B | null, index: number, touching: boolean) => void): void;
  diagnostics(): SolidCouplingDiagnostics;
}
```

### SolidCouplingDiagnostics · interface

```ts
export interface SolidCouplingDiagnostics {
    solidKinetic: number;
    solidStrain: number;
    solidPotential: number;
    contact: number;
    bodyKinetic: number;
    bodyPotential: number;
    total: number;
    momentum: [number, number, number];
    mass: number;
}
```

### SolidCouplingOptions · interface

```ts
export interface SolidCouplingOptions extends SolidContactOptions {
    readonly estimateSupports?: boolean;
}
```

### SolidSolidContact · class

Contact between deformable solids, of a solid with itself and with planes: mortar (or node-face) contact both ways and
edge-to-edge contact, with Coulomb friction, solved together with the solids in one Newton solve. See docs/SOLID_CONTACT.md.

```ts
export declare class SolidSolidContact {
  saveState(): StateObject;
  restoreState(state: StateValue): void;
  readonly solver: string;
  readonly method: SolidSolidContactMethod;
  readonly edges: boolean;
  readonly solids: SolidBody[];
  readonly dt: number;
  readonly stiffnessScale: number;
  readonly skin: number;
  readonly frictionPasses: number;
  readonly frictionTolerance: number;
  readonly stats: SolidSolidContactStats;
  contactWork: number;
  readonly nodeForce: Float64Array;
  addPlane(options: { readonly normal: readonly [number, number, number]; readonly point?: readonly [number, number, number]; readonly friction?: number; }): number;
  get planeCount(): number;
  setFriction(a: number, b: number, friction: number): void;
  step(count?: number): void;
  solveStatic(options?: { readonly maxPasses?: number; readonly tolerance?: number; }): SolidSolidStaticResult;
  contactForce(a: number, b?: number, out?: number[]): number[];
  maxPenetration(): number;
  contactEnergy(): number;
  linearMomentum(out?: number[]): number[];
  angularMomentum(out?: number[]): number[];
  energy(): { kinetic: number; strain: number; };
}
```

### SolidSolidContactMethod · type

How a contact between two surfaces is discretised: `mortar` (segment to segment) or `node-face` (node against face).

```ts
export type SolidSolidContactMethod = 'mortar' | 'node-face';
```

### SolidSolidContactOptions · interface

Settings of a SolidSolidContact: method, contact stiffness, skin, friction, which bodies collide with themselves, and the friction passes.

```ts
export interface SolidSolidContactOptions {
    readonly method?: SolidSolidContactMethod;
    readonly edges?: boolean;
    readonly stiffnessScale?: number;
    readonly skin?: number;
    readonly friction?: number;
    readonly selfContact?: boolean | readonly number[];
    readonly frictionPasses?: number;
    readonly frictionTolerance?: number;
}
```

### SolidSolidContactStats · interface

What the last step of a SolidSolidContact did: convergence, Newton and linear iterations, the residual against its reference, friction passes and the number of contacts.

```ts
export interface SolidSolidContactStats {
    converged: boolean;
    newtonIterations: number;
    linearIterations: number;
    residual: number;
    reference: number;
    frictionPasses: number;
    unconvergedSteps: number;
    contacts: number;
    edgeContacts: number;
}
```

### solidSolidContactSubsystem · function

Solids in contact with each other as one subsystem of the stepping loop (simulation.ts): post stage, where a lone
`solidSubsystem` runs; its dt may be the step or a whole fraction of it. Do not also register its solids with
`solidSubsystem` or `solidContactSubsystem`: they would be stepped twice. Energy: kinetic + strain + load potential of
every solid plus the energy in the contact springs. Event: 'unconverged' with {residual, reference}.

```ts
export declare function solidSolidContactSubsystem<W, B>(target: SolidSolidContact, options?: {
    readonly id?: string;
    readonly order?: number;
}): Subsystem<W, B>;
```

### SolidSolidStaticResult · interface

The result of SolidSolidContact.solveStatic: whether it converged, the passes it took, the final residual and the last change of the friction limits.

```ts
export interface SolidSolidStaticResult {
    converged: boolean;
    passes: number;
    residual: number;
    change: number;
}
```

### SolidStaticContactResult · interface

```ts
export interface SolidStaticContactResult {
    converged: boolean;
    passes: number;
    residual: number;
    change: number;
}
```

### SolidWorld · interface

The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it.

```ts
export interface SolidWorld<B> {
    gravity(): readonly number[];
    getState(body: B): {
        readonly position: readonly number[];
        readonly rotation: readonly number[];
        readonly linearVelocity: readonly number[];
        readonly angularVelocity: readonly number[];
        readonly mass: number;
        readonly type: string;
    };
    applyForce(body: B, force: SolidContactVec3, point?: SolidContactVec3): void;
    applyTorque(body: B, torque: SolidContactVec3): void;
    isAlive?(body: B): boolean;
    readonly loop?: {
        readonly step: number;
    };
    readonly subSteps?: number;
}
```

## `box3d-webgpu-kit/materials`

### concreteMaterial · function

The input of a `SolidBody` with the concrete law (concrete-law.ts): E, nu, rho as `solidMaterial`, and `concrete` from
the library's f_cm (compressiveStrength), f_ctm (tensileStrength), eps_c1 (peakStrain), eps_cu1 (ultimateStrain) and
G_f (fractureEnergy). Without a peak strain (a ceramic) the material is elastic up to f_cm (elasticLimit 1, eps_c1 =
f_cm / E); without a fracture energy G_f comes from K_IC by Irwin's relation in plane strain. The law's other inputs
(friction, crushing energy, band width) keep their defaults unless the caller adds them.

```ts
export declare function concreteMaterial(id: string, options?: ConcreteMaterialOptions): SolidMaterial;
```

### ConcreteMaterialOptions · interface

```ts
export interface ConcreteMaterialOptions extends SolidMaterialOptions {
    readonly compressiveStrength?: number;
    readonly tensileStrength?: number;
    readonly peakStrain?: number;
    readonly ultimateStrain?: number;
    readonly fractureEnergy?: number;
}
```

### CONTACT_PAIRS · const

Friction and restitution between pairs of library materials (order of a and b does not matter).

```ts
export declare const CONTACT_PAIRS: readonly ContactPairEntry[];
```

### ContactCondition · type

```ts
export type ContactCondition = 'dry' | 'lubricated' | 'wet';
```

### contactPair · function

Friction and restitution between two library materials, in either order, for a condition ('dry' by default).
The rigid world has one Coulomb coefficient per contact for sticking and sliding alike; `friction` is the static
coefficient by default (what holds still in reality holds still; sliding then dissipates mu_s / mu_k times too
much), or the kinetic one with `use: 'kinetic'`, or the source's unqualified coefficient when it gives neither.
Box3D mixes two bodies' coefficients as sqrt(f_a f_b) for friction and max(e_a, e_b) for restitution, so to get
this pair's value between bodies of different materials, give both bodies these numbers (or set a friction callback).
Throws when the library has no entry for the pair.

```ts
export declare function contactPair(a: string, b: string, condition?: ContactCondition, options?: ContactPairOptions): ContactPairValues;
```

### contactPairEntries · function

Every pair entry for a and b in this condition (either order).

```ts
export declare function contactPairEntries(a: string, b: string, condition?: ContactCondition): ContactPairEntry[];
```

### ContactPairEntry · interface

```ts
export interface ContactPairEntry {
    readonly a: string;
    readonly b: string;
    readonly condition: ContactCondition;
    readonly staticFriction?: MaterialValue;
    readonly kineticFriction?: MaterialValue;
    readonly friction?: MaterialValue;
    readonly restitution?: MaterialValue;
    readonly impactSpeed?: readonly [number, number] | null;
}
```

### ContactPairOptions · interface

```ts
export interface ContactPairOptions extends MaterialOptions {
    readonly use?: 'static' | 'kinetic';
}
```

### ContactPairValues · interface

```ts
export interface ContactPairValues {
    readonly a: string;
    readonly b: string;
    readonly condition: ContactCondition;
    readonly staticFriction: number | null;
    readonly kineticFriction: number | null;
    readonly friction: number | null;
    readonly restitution: number | null;
    readonly impactSpeed: readonly [number, number] | null;
    readonly entries: readonly ContactPairEntry[];
}
```

### fabricMaterial · function

The material of a `Cloth` (cloth.ts) for a woven fabric: areal density, the orthotropic membrane (warp along
`warpDirection`) and the tearing strengths along warp and weft, all from the library. `youngModulus` and `thickness`
only set the cloth's contact stiffness and offset here: E t is the mean of the warp and weft stiffnesses, t 1 mm.
The fabric's shear stiffness is unverified in the library, so this needs `allowUnverified` unless `shear` is given.

```ts
export declare function fabricMaterial(id: string, options: MaterialOptions & {
    readonly warpDirection: readonly [number, number, number];
    readonly shear?: number;
    readonly bendingStiffness?: number;
}): {
    orthotropic: {
        warp: number;
        weft: number;
        shear: number;
        poissonRatio: number;
        warpDirection: readonly [number, number, number];
    };
    strength: {
        warp: number;
        weft: number;
    };
    bending: "none" | "koiter";
    bendingStiffness?: number | undefined;
    arealDensity: number;
    youngModulus: number;
    thickness: number;
    poissonRatio: number;
};
```

### fractureEnergyFromToughness · function

Irwin's relation between the fracture toughness K_IC (Pa m^0.5) and the energy release rate G_c (J/m^2).

```ts
export declare function fractureEnergyFromToughness(toughness: number, youngModulus: number, poissonRatio: number, state?: StressState): number;
```

### fractureLaw · function

The fracture law of `FractureBody` (solid-fracture.ts): `strength` sigma_c and `toughness` G_c.
G_c comes from K_IC: K_IC^2 (1 - nu^2) / E in plane strain (the default, the state K_IC is measured in), or
K_IC^2 / E in plane stress for a thin sheet; the cohesive law then dissipates G_c per unit crack area.
When the library has no K_IC, its fracture energy is used. Throws when either value is missing.

```ts
export declare function fractureLaw(id: string, options?: FractureLawOptions): FractureLaw;
```

### FractureLawOptions · interface

```ts
export interface FractureLawOptions extends MaterialOptions {
    readonly model?: FractureModel;
    readonly strength?: number;
    readonly toughness?: number;
    readonly state?: StressState;
}
```

### grainMaterial · function

The input of `Granular` (granular.ts) for the Hertz law: density, E, nu (capped at SOLVER_POISSON_LIMIT), and
the grain-on-grain friction and restitution of the material on itself. Throws when the library has no friction
or restitution for the material on itself and none is passed.

```ts
export declare function grainMaterial(id: string, options?: GrainMaterialOptions): GranularMaterial;
```

### GrainMaterialOptions · interface

```ts
export interface GrainMaterialOptions extends MaterialOptions {
    readonly restitution?: number;
    readonly friction?: number;
    readonly rollingFriction?: number;
    readonly youngModulus?: number;
    readonly poissonRatio?: number;
    readonly density?: number;
}
```

### greenAmptSoil · function

Green-Ampt inputs of a soil texture class for shallow-water.ts: K (m/s), psi (m) and the available porosity
eta = theta_e (1 - S_e), where S_e is the effective saturation the soil starts at (Rawls et al. 1983: eta is the
effective porosity minus the initial water content). Default S_e = 0.3, an assumption, not a value of the source.

```ts
export declare function greenAmptSoil(id: string, options?: {
    readonly initialSaturation?: number;
}): {
    conductivity: number;
    suction: number;
    moistureDeficit: number;
};
```

### heatMaterial · function

The input of `HeatSolver` (heat.ts): conductivity k, density rho and specific heat c_p.

```ts
export declare function heatMaterial(id: string, options?: HeatMaterialOptions): HeatMaterial;
```

### HeatMaterialOptions · interface

```ts
export interface HeatMaterialOptions extends MaterialOptions {
    readonly conductivity?: number;
    readonly density?: number;
    readonly specificHeat?: number;
}
```

### manningCoefficient · function

Manning's n of a surface of the roughness table, s/m^(1/3). Throws for an unknown id.

```ts
export declare function manningCoefficient(id: string): number;
```

### material · function

The entry of one material. Throws EngineError INVALID_PAYLOAD for an unknown id.

```ts
export declare function material(id: string): MaterialEntry;
```

### MATERIAL_LIBRARY_ID · const

```ts
export declare const MATERIAL_LIBRARY_ID = "box3d-materials";
```

### MATERIAL_LIBRARY_VERSION · const

Semver of the data: a changed value is a minor release, a removed material or property a major one.

```ts
export declare const MATERIAL_LIBRARY_VERSION = "1.8.0";
```

### MATERIAL_PROPERTY_UNITS · const

The SI unit of each property.

```ts
export declare const MATERIAL_PROPERTY_UNITS: Readonly<Record<MaterialPropertyName, string>>;
```

### MATERIAL_SOURCES · const

Every source a value was read from. Each URL was opened on MATERIAL_SOURCES_ACCESSED.

```ts
export declare const MATERIAL_SOURCES: Readonly<Record<string, MaterialSource>>;
```

### MATERIAL_SOURCES_ACCESSED · const

The date the sources were opened and read.

```ts
export declare const MATERIAL_SOURCES_ACCESSED = "2026-11-12";
```

### materialAudit · function

Every value in the library, one row each, in library order.

```ts
export declare function materialAudit(): MaterialAuditRow[];
```

### MaterialAuditRow · interface

```ts
export interface MaterialAuditRow {
    readonly kind: 'property' | 'pair' | 'surface' | 'soil';
    readonly subject: string;
    readonly property: string;
    readonly value: number;
    readonly source: string;
    readonly reason?: string;
}
```

### MaterialCategory · type

```ts
export type MaterialCategory = 'metal' | 'glass' | 'ceramic' | 'stone' | 'concrete' | 'wood' | 'polymer' | 'elastomer' | 'ice' | 'fluid' | 'granular' | 'fabric';
```

### MaterialEntry · interface

```ts
export interface MaterialEntry {
    readonly id: string;
    readonly name: string;
    readonly category: MaterialCategory;
    readonly grade: string;
    readonly isotropic: boolean;
    readonly properties: Readonly<Partial<Record<MaterialPropertyName, MaterialValue>>>;
    readonly flags?: readonly string[];
    readonly notes?: readonly string[];
}
```

### materialIds · function

The ids of the library's materials, in library order.

```ts
export declare function materialIds(): string[];
```

### MaterialOptions · interface

```ts
export interface MaterialOptions {
    readonly allowUnverified?: boolean;
}
```

### materialProperty · function

The SI value of one property. Throws when the library has none, or when it is unverified and not allowed.

```ts
export declare function materialProperty(id: string, property: MaterialPropertyName, options?: MaterialOptions): number;
```

### MaterialPropertyName · type

```ts
export type MaterialPropertyName = 'density' | 'youngModulus' | 'poissonRatio' | 'shearModulus' | 'yieldStrength' | 'tensileStrength' | 'compressiveStrength' | 'flexuralStrength' | 'fractureToughness' | 'fractureEnergy' | 'elongationAtBreak' | 'peakStrain' | 'ultimateStrain' | 'arealDensity' | 'membraneStiffnessWarp' | 'membraneStiffnessWeft' | 'membraneShearStiffness' | 'membranePoissonRatio' | 'tensileStrengthWarp' | 'tensileStrengthWeft' | 'tearStrength' | 'thermalConductivity' | 'specificHeat' | 'thermalExpansion' | 'viscosity' | 'soundSpeed';
```

### MATERIALS · const

The library's materials, by id.

```ts
export declare const MATERIALS: Readonly<Record<string, MaterialEntry>>;
```

### MaterialSource · interface

```ts
export interface MaterialSource {
    readonly id: string;
    readonly title: string;
    readonly author: string;
    readonly kind: MaterialSourceKind;
    readonly url: string;
    readonly note?: string;
}
```

### MaterialSourceKind · type

```ts
export type MaterialSourceKind = 'standard' | 'government' | 'manufacturer' | 'peer-reviewed' | 'textbook' | 'last-resort';
```

### materialValue · function

One property with its source and conditions, or null when the library has none.

```ts
export declare function materialValue(id: string, property: MaterialPropertyName): MaterialValue | null;
```

### MaterialValue · interface

```ts
export interface MaterialValue {
    readonly value: number;
    readonly range?: readonly [number, number];
    readonly uncertainty?: number;
    readonly conditions: string;
    readonly source: string;
    readonly also?: readonly string[];
    readonly read: string;
    readonly derived?: string;
    readonly reason?: string;
}
```

### plasticMaterial · function

The input of an elastic-plastic `SolidBody` (J2 with linear isotropic hardening): E, nu, rho as `solidMaterial`, plus
 - yieldStress = the library's yield strength;
 - hardeningModulus H from a bilinear fit through (f_y / E, f_y) and (A, f_u), A the elongation at break: the tangent
   E_t = (f_u - f_y) / (A - f_y / E) and H = E E_t / (E - E_t). Engineering values, so this is a coarse fit that ignores
   necking and the difference between true and engineering stress;
 - failureStrain = A - f_u / E, the plastic strain at the end of that line (the elements erode there).
Needs yield strength, tensile strength and elongation at break in the library (an unverified one needs allowUnverified).

```ts
export declare function plasticMaterial(id: string, options?: SolidMaterialOptions): SolidMaterial;
```

### rigidMaterial · function

The density, friction and restitution of one rigid body made of a library material (a `SceneMaterial`).

```ts
export declare function rigidMaterial(id: string, options?: RigidMaterialOptions): RigidMaterialValues;
```

### RigidMaterialOptions · interface

```ts
export interface RigidMaterialOptions extends MaterialOptions {
    readonly frictionPair?: readonly [string, string, ContactCondition?];
    readonly restitutionPair?: readonly [string, string, ContactCondition?];
    readonly use?: 'static' | 'kinetic';
}
```

### RigidMaterialValues · interface

```ts
export interface RigidMaterialValues {
    readonly density: number;
    readonly friction: number;
    readonly restitution: number;
    readonly frictionPair: readonly [string, string, ContactCondition];
    readonly restitutionPair: readonly [string, string, ContactCondition];
    readonly unverified: readonly ('density' | 'friction' | 'restitution')[];
}
```

### shearConsistency · function

For an isotropic entry with E, nu and G: how far the stated G is from E / (2 (1 + nu)). Null otherwise.

```ts
export declare function shearConsistency(id: string): ShearConsistency | null;
```

### ShearConsistency · interface

```ts
export interface ShearConsistency {
    readonly id: string;
    readonly stated: number;
    readonly isotropic: number;
    readonly relative: number;
    readonly flagged: boolean;
}
```

### SOIL_INFILTRATION · const

Green-Ampt parameters of the eleven USDA texture classes. Ranges are one standard deviation (Rawls et al. 1983).

```ts
export declare const SOIL_INFILTRATION: Readonly<Record<string, SoilInfiltrationEntry>>;
```

### SoilInfiltrationEntry · interface

Green-Ampt parameters of a soil texture class (Rawls et al. 1983, Table 2, the class rows). SI units.

```ts
export interface SoilInfiltrationEntry {
    readonly id: string;
    readonly name: string;
    readonly totalPorosity: MaterialValue;
    readonly effectivePorosity: MaterialValue;
    readonly suction: MaterialValue;
    readonly conductivity: MaterialValue;
}
```

### solidMaterial · function

The input of `SolidBody` and `FractureBody` (solid.ts): E, nu, rho and, when the library has it, the linear
expansion coefficient. Poisson's ratio is capped at SOLVER_POISSON_LIMIT. Overrides replace library values.

```ts
export declare function solidMaterial(id: string, options?: SolidMaterialOptions): SolidMaterial;
```

### SolidMaterialOptions · interface

```ts
export interface SolidMaterialOptions extends MaterialOptions {
    readonly youngModulus?: number;
    readonly poissonRatio?: number;
    readonly density?: number;
    readonly thermalExpansion?: number | null;
}
```

### SOLVER_POISSON_LIMIT · const

The largest Poisson's ratio the solid and granular solvers accept.

```ts
export declare const SOLVER_POISSON_LIMIT = 0.4999;
```

### StressState · type

Plane strain (a thick body: G_c = K^2 (1 - nu^2) / E) or plane stress (a thin sheet: G_c = K^2 / E).

```ts
export type StressState = 'plane-strain' | 'plane-stress';
```

### SURFACE_ROUGHNESS · const

Manning's n of surfaces and channels, the "normal" value of Chow's (1959) table with its minimum and maximum as the range.

```ts
export declare const SURFACE_ROUGHNESS: Readonly<Record<string, SurfaceRoughnessEntry>>;
```

### SurfaceRoughnessEntry · interface

A surface a shallow flow runs over, with its Manning coefficient n (s/m^(1/3)).

```ts
export interface SurfaceRoughnessEntry {
    readonly id: string;
    readonly name: string;
    readonly manning: MaterialValue;
}
```

### thermalDiffusivity · function

Thermal diffusivity k / (rho c_p), m^2/s.

```ts
export declare function thermalDiffusivity(id: string, options?: MaterialOptions): number;
```

## `box3d-webgpu-kit/gpu`

### acquireGpuCompute · function

An adapter and a device for compute, with the limits `needs` asks for. Throws GPU_UNAVAILABLE with the reason.

```ts
export declare function acquireGpuCompute(options?: GpuAcquireOptions): Promise<GpuCompute>;
```

### demMemory · function

Bytes of each storage buffer a set of `capacity` grains needs, and the largest (what the device must be able to bind).

```ts
export declare function demMemory(capacity: number, options?: {
    readonly historySlots?: number;
    readonly bucketSlots?: number;
    readonly tableSize?: number;
    readonly rolling?: boolean;
    readonly walls?: number;
}): {
    grains: number;
    forces: number;
    history: number;
    grid: number;
    sums: number;
    total: number;
    largest: number;
};
```

### DemOptions · interface

Capacities of a grain backend: contact-history slots per grain, grains per hash bucket, the hash table size (a power of two).

```ts
export interface DemOptions {
    readonly historySlots?: number;
    readonly bucketSlots?: number;
    readonly tableSize?: number;
}
```

### DemStats · interface

Counters of a grain backend after its last step: contacts, the largest overlap, grains removed, and the overflows (history slots, hash buckets).

```ts
export interface DemStats {
    steps: number;
    contacts: number;
    wallContacts: number;
    overlap: number;
    maxOverlap: number;
    removed: number;
    bucketOverflow: number;
    historyOverflow: number;
}
```

### FLOW_GPU_SOLVER_ID · const

```ts
export declare const FLOW_GPU_SOLVER_ID = "flow-lbm-d3q19-regularized-les-webgpu-f32-v1";
```

### FLOW_WGSL · const

```ts
export declare const FLOW_WGSL: string;
```

### flowGpuSums · function

Forces (lattice units, per part and about the origin of the cell coordinates) and the mass per patch of the last
step, from the link fluxes, in float64, as FlowLattice sums them.

```ts
export declare function flowGpuSums(lattice: FlowLattice, linkFlux: Float32Array): FlowGpuSums;
```

### FlowGpuSums · interface

The state and the sums a host reads after steps: forces per part and mass per patch from the link fluxes.

```ts
export interface FlowGpuSums {
    force: Float64Array;
    moment: Float64Array;
    patchMass: Float64Array;
}
```

### flowGpuSupport · function

Whether a lattice can run on this backend, and if not, why.

```ts
export declare function flowGpuSupport(lattice: FlowLattice): {
    ok: boolean;
    unsupported: string[];
};
```

### flowGpuTables · function

```ts
export declare function flowGpuTables(lattice: FlowLattice): FlowGpuTables;
```

### FlowGpuTables · interface

The tables of a lattice in the layout of the shader (float32 and uint32).

```ts
export interface FlowGpuTables {
    readonly fluidCells: number;
    readonly links: number;
    readonly boundaryCells: number;
    readonly source: Uint32Array;
    readonly linkIndex: Uint32Array;
    readonly linkStart: Uint32Array;
    readonly linkCode: Uint32Array;
    readonly linkQ: Float32Array;
    readonly linkAdd: Float32Array;
    readonly linkAux: Uint32Array;
    readonly tau0: number;
    readonly smagorinskyK: number;
    readonly bulk: number;
}
```

### FlowLatticeF32 · class

The float32 program of FLOW_WGSL on the CPU.

```ts
export declare class FlowLatticeF32 {
  readonly tables: FlowGpuTables;
  f: Float32Array;
  readonly moments: Float32Array;
  readonly linkFlux: Float32Array;
  force: [number, number, number];
  ramp: number;
  les: boolean;
  stepCount: number;
  step(): void;
}
```

### FLUID_F32_SOLVER_ID · const

The solver id of the float32 CPU reference of the flow program.

```ts
export declare const FLUID_F32_SOLVER_ID = "fluid-mac-projection-jacobi-pcg-f32-reference-v1";
```

### FLUID_GPU_SOLVER_ID · const

The solver id of the flow on WebGPU compute (float32).

```ts
export declare const FLUID_GPU_SOLVER_ID = "fluid-mac-projection-jacobi-pcg-webgpu-f32-v1";
```

### FLUID_MAX_OBSTACLES · const

At most this many obstacles on the GPU (the per-obstacle sums take 36 scalars each).

```ts
export declare const FLUID_MAX_OBSTACLES = 1024;
```

### FLUID_PROGRAM_CHECKPOINT · const

Checkpoints of the fluid program (GpuFluid and FluidF32 write and read the same bytes): the face velocities with their
ghosts, the previous advection (Adams-Bashforth), the pressure, whether the next step uses Adams-Bashforth, the time
and the statistics. Everything else in F is rewritten by a step before it is read, or constant. A checkpoint of one
restores into the other; the obstacles' poses and forces belong to the Fluid the backend was built from (its own
saveState).

```ts
export declare const FLUID_PROGRAM_CHECKPOINT = "fluid-program-f32-v1";
```

### FluidBackendOptions · interface

Options of a flow backend (GpuFluid, FluidF32): the stopping rules of its solves and the room for obstacle faces.

```ts
export interface FluidBackendOptions {
    readonly pressureTolerance?: number;
    readonly viscousReduction?: number;
    readonly viscousFloor?: number;
    readonly obstacleCapacity?: number;
}
```

### FluidF32 · class

The flow program run on the CPU in float32, kernel by kernel: the GPU's bits where the two agree; synchronous.

```ts
export declare class FluidF32 {
  readonly solver = "fluid-mac-projection-jacobi-pcg-f32-reference-v1";
  readonly program: FluidProgram;
  readonly fluid: Fluid;
  readonly F: Float32Array;
  readonly I: Uint32Array;
  readonly S: Float32Array;
  obstacleSums: { J: Float64Array; M: Float64Array; Mstart: Float64Array | null; } | null;
  readonly stats: { steps: number; pressureIterations: number; viscousIterations: number; divergence: number; unconverged: number; };
  time: number;
  setObstacles(band: FluidObstacleBand): void;
  run(program: Generator<FluidCommand, void, Float32Array>): void;
  step(count?: number): void;
  project(): void;
  checkpoint(): Uint8Array;
  restoreCheckpoint(bytes: Uint8Array): void;
  reload(): void;
  velocity(c: number): Float32Array;
  pressure(): Float32Array;
}
```

### fluidMemory · function

Bytes of the three buffers a fluid of this description needs (the largest must fit one storage binding).

```ts
export declare function fluidMemory(source: Fluid | FluidProgramSource): {
    data: number;
    indices: number;
};
```

### FluidRunner · class

A fluid run that starts on the GPU and carries on with the float64 solver when the device is lost (or was never
there): `fluid` receives a snapshot every `snapshotEvery` steps; on a loss it is stepped from the last snapshot to
where the GPU run had got to (its Adams-Bashforth history restarts, as after any restore).

```ts
export declare class FluidRunner {
  backend: 'gpu' | 'cpu';
  fallback: { reason: string; atTime: number; resumedFrom: number; stepsRerun: number; } | null;
  readonly fluid: Fluid;
  gpu: GpuFluid | null;
  static create(fluid: Fluid, compute: GpuCompute | null, options?: FluidBackendOptions & { readonly snapshotEvery?: number; }): Promise<FluidRunner>;
  get steps(): number;
  get time(): number;
  step(count?: number): Promise<void>;
  destroy(): void;
}
```

### GPU_SCENE_BACKEND · const

The tag of a GPU section's state in a simulation checkpoint.

```ts
export declare const GPU_SCENE_BACKEND = "scene-section-gpu-f32-v1";
```

### GpuAcquireOptions · interface

What `acquireGpuCompute` needs: the limits to check, and the GPU object to ask (default navigator.gpu).

```ts
export interface GpuAcquireOptions extends GpuComputeNeeds {
    readonly gpu?: GPU;
    readonly powerPreference?: GPUPowerPreference;
    readonly label?: string;
}
```

### GpuCompute · class

A WebGPU device for compute: buffers, shader modules and pipelines inside error scopes, readback, and device loss as GPU_DEVICE_LOST.

```ts
export declare class GpuCompute {
  readonly info: GpuComputeInfo;
  readonly device: GPUDevice;
  get lost(): boolean;
  get lossReason(): string | null;
  onLost(listener: (reason: string) => void): void;
  assertAlive(): void;
  buffer(label: string, size: number, usage: GPUBufferUsageFlags, data?: ArrayBufferView | ArrayBuffer): GPUBuffer;
  storage(label: string, size: number, data?: ArrayBufferView | ArrayBuffer): GPUBuffer;
  write(buffer: GPUBuffer, data: ArrayBufferView | ArrayBuffer, offset?: number): void;
  release(buffer: GPUBuffer): void;
  scoped<T>(label: string, work: () => T | Promise<T>): Promise<T>;
  module(label: string, code: string): Promise<GPUShaderModule>;
  pipeline(label: string, module: GPUShaderModule, entryPoint: string, layout?: GPUPipelineLayout | 'auto'): Promise<GPUComputePipeline>;
  layout(label: string, bindings: readonly ('uniform' | 'uniform-dynamic' | 'read' | 'write')[]): GPUBindGroupLayout;
  bind(label: string, layout: GPUBindGroupLayout, buffers: readonly (GPUBuffer | { readonly buffer: GPUBuffer; readonly size: number; })[]): GPUBindGroup;
  read(sources: readonly { readonly buffer: GPUBuffer; readonly offset?: number; readonly size?: number; }[]): Promise<ArrayBuffer[]>;
  readTyped<T extends TypedArray>(buffer: GPUBuffer, Type: { new (buffer: ArrayBuffer): T; }, offset?: number, size?: number): Promise<T>;
  destroy(): void;
}
```

### GpuComputeInfo · interface

The adapter a GpuCompute runs on (vendor, architecture, device, whether it is a software adapter) and its limits.

```ts
export interface GpuComputeInfo {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly software: boolean;
    readonly limits: {
        readonly storageBuffers: number;
        readonly storageBytes: number;
        readonly bufferBytes: number;
        readonly workgroups: number;
        readonly invocations: number;
    };
}
```

### GpuComputeNeeds · interface

Limits a backend needs of a device: storage buffers per stage, the largest storage binding, workgroups per dimension, invocations per workgroup.

```ts
export interface GpuComputeNeeds {
    readonly storageBuffers?: number;
    readonly storageBytes?: number;
    readonly workgroups?: number;
    readonly invocations?: number;
}
```

### gpuComputeSupported · const

True when this JavaScript environment has a WebGPU entry point (a device may still be refused).

```ts
export declare const gpuComputeSupported: () => boolean;
```

### GpuFlowLattice · class

The step on a WebGPU device. Two population buffers swap each step; `read()` brings the populations, the moments
and the link fluxes back.

```ts
export declare class GpuFlowLattice {
  readonly solver = "flow-lbm-d3q19-regularized-les-webgpu-f32-v1";
  readonly compute: GpuCompute;
  readonly tables: FlowGpuTables;
  stepCount: number;
  static create(compute: GpuCompute, lattice: FlowLattice): Promise<GpuFlowLattice>;
  writeParams(lattice: FlowLattice): void;
  step(steps?: number): void;
  read(): Promise<{ f: Float32Array; moments: Float32Array; linkFlux: Float32Array; }>;
  destroy(): void;
}
```

### GpuFluid · class

Incompressible flow on the MAC grid on WebGPU compute, in float32, with fixed and moving obstacles (geometry on the host).

```ts
export declare class GpuFluid {
  readonly solver = "fluid-mac-projection-jacobi-pcg-webgpu-f32-v1";
  readonly compute: GpuCompute;
  readonly program: FluidProgram;
  readonly dataBuffer: GPUBuffer;
  readonly stats: { steps: number; pressureIterations: number; viscousIterations: number; divergence: number; unconverged: number; };
  obstacleSums: { J: Float64Array; M: Float64Array; Mstart: Float64Array | null; } | null;
  time: number;
  readonly dt: number;
  static create(compute: GpuCompute, fluid: Fluid | FluidProgramSource, state?: { velocity: readonly ArrayLike<number>[]; pressure: ArrayLike<number>; time: number; } | null, options?: FluidBackendOptions): Promise<GpuFluid>;
  setObstacles(band: FluidObstacleBand): void;
  get regions(): Readonly<Record<string, number>>;
  get padded(): number;
  step(count?: number): Promise<void>;
  project(): Promise<void>;
  load(velocity: readonly ArrayLike<number>[], pressure: ArrayLike<number>): void;
  read(): Promise<{ u: Float32Array; v: Float32Array; w: Float32Array; p: Float32Array; }>;
  checkpoint(): Promise<Uint8Array>;
  restoreCheckpoint(bytes: Uint8Array): void;
  pull(target: Fluid): Promise<void>;
  destroy(): void;
}
```

### gpuFluidSubsystem · function

A GPU (or float32 reference) flow: a FluidCoupling (couple stage, order 180, the rigid step) whose fluid steps run on
the backend, or a bare Fluid (post stage, commensurate step), as fluidSubsystem. The backend is built from the Fluid,
which keeps the obstacles: before each fluid step the backend takes their band at the poses the coupling set, after it
the coupling reads their forces (Fluid.finishBackendObstacles). The room for obstacle faces is fixed when the section
is built (twice the band at the scene's start plus 64 per obstacle), so a resumed run has the same room as a straight
one; a move that needs more throws GPU_CAPACITY. No energy ledger (the backend sums no dissipation); events:
'unconverged' when a solve stopped at its iteration limit.

```ts
export declare function gpuFluidSubsystem<W, B>(device: GpuCompute | 'reference', target: Fluid | FluidCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
    readonly backend?: FluidBackendOptions;
}): GpuSceneSubsystem<W, B>;
```

### GpuGranular · class

Discrete-element grains on WebGPU compute, in float32: hash-grid neighbours, contact histories, walls of every shape.

```ts
export declare class GpuGranular {
  readonly solver = "granular-dem-hash-grid-webgpu-f32-v1";
  readonly compute: GpuCompute;
  readonly setup: DemSetup;
  readonly positionBuffer: GPUBuffer;
  readonly stats: DemStats;
  time: number;
  static fromGranular(compute: GpuCompute, granular: Granular, options?: DemOptions): Promise<GpuGranular>;
  static create(compute: GpuCompute, setup: DemSetup): Promise<GpuGranular>;
  get count(): number;
  get capacity(): number;
  step(count?: number): Promise<void>;
  upload(what?: { readonly grains?: boolean; readonly walls?: boolean; }): void;
  uploadWalls(): void;
  readWalls(): Promise<Float32Array>;
  sync(): Promise<void>;
  read(): Promise<GpuGranularSnapshot>;
  checkpoint(): Promise<Uint8Array>;
  restoreCheckpoint(bytes: Uint8Array): void;
  pull(target: Granular, snapshot?: GpuGranularSnapshot): Promise<GpuGranularSnapshot>;
  destroy(): void;
}
```

### GpuGranularCoupling · class

Two-way coupling of GPU grains with a rigid world, on the CPU: `coupling` is the float64 solver's GranularCoupling on
the Granular the GPU backend was built from (the "mirror"). Each rigid step: the bodies are copied into the mirror's
walls and uploaded (a few hundred bytes per wall), the GPU takes the grain substeps with the dynamic bodies integrated
alongside as in the float64 solver, the walls' impulses are read back (the per-wall sums are reduced on the GPU) and
the bodies are handed the mean force and torque.

`latency: 0` (default) waits for that readback before `world.step()`: the bodies get the forces of this step, as in the
float64 coupling. `latency: 1` does not wait: the bodies get the forces of the previous rigid step. That is a delayed
feedback on a stiff contact and is stable only for a heavy body: with the contact stiffness k under the body (the sum
over its touching grains) and the rigid step h, the body's mass must be well above k h^2 (a body of 0.06 kg on a bed of
k = 1e5 N/m at 240 Hz, k h^2 = 1.7 kg, is thrown off the bed; one of 6 kg rests as with latency 0). Use latency 0 unless
the frame loop must not wait: the readback is 288 bytes per wall.

```ts
export declare class GpuGranularCoupling<B> {
  readonly coupling: GranularCoupling<B>;
  readonly gpu: Pick<GpuGranular, 'setup' | 'uploadWalls' | 'step' | 'readWalls'>;
  readonly latency: 0 | 1;
  steps: number;
  step(): Promise<void>;
}
```

### gpuGranularSubsystem · function

A GPU (or float32 reference) grain section: the coupling's begin and finish on the CPU, the grain steps on the backend; couple stage, as granularSubsystem of a coupling.

```ts
export declare function gpuGranularSubsystem<W, B>(device: GpuCompute | 'reference', coupling: GranularCoupling<B>, options?: {
    readonly id?: string;
    readonly order?: number;
}): GpuSceneSubsystem<W, B>;
```

### GpuProgram · class

Dispatches that run in list order.

```ts
export declare class GpuProgram {
  readonly dispatches: GpuDispatch[];
  add(dispatch: GpuDispatch): this;
  encode(encoder: GPUCommandEncoder, label?: string): void;
}
```

### gpuSceneBackends · function

The `gpu` option of the scene loaders: GPU subsystems for the sections that say backend: 'gpu'.

```ts
export declare function gpuSceneBackends<W, B>(compute: GpuCompute | 'reference'): SceneGpuBackends<W, B>;
```

### GpuSceneFallback · interface

What a GpuSceneRunner did when the device was lost.

```ts
export interface GpuSceneFallback {
    readonly reason: string;
    readonly atTick: number;
    readonly resumedFrom: number;
    readonly stepsRerun: number;
}
```

### GpuSceneRunner · class

Steps a simulation with GPU sections and carries on with the float32 reference when the device is lost. It takes a
checkpoint of the whole simulation (`checkpointAsync`: the world, every section, the clock) before its first step and
then every `snapshotEvery` steps; on GPU_DEVICE_LOST during a step or a checkpoint every GPU section switches to the
reference (`useReference`), the last checkpoint is restored and the steps since it are taken again, then the step that
failed. The reference runs the GPU's program, so the run goes on with the bits it would have had on the device
wherever the two agree bit for bit (docs/GPU_COMPUTE.md); a fall back costs the steps since the checkpoint.

```ts
export declare class GpuSceneRunner<W extends SimulationWorld<B>, B> {
  readonly simulation: Simulation<W, B>;
  readonly snapshotEvery: number;
  fallback: GpuSceneFallback | null;
  get sections(): GpuSceneSubsystem<W, B>[];
  get backend(): 'gpu' | 'reference';
  get checkpointTick(): number;
  step(): Promise<void>;
}
```

### GpuSceneSubsystem · interface

What `pullAsync` and the scene save need of a GPU section.

```ts
export interface GpuSceneSubsystem<W, B> extends Subsystem<W, B> {
    stale(): boolean;
    readonly backend: 'gpu' | 'reference';
    useReference(): void;
}
```

### GpuShallowWater · class

Shallow water on terrain on WebGPU compute, in float32: the float64 solver's scheme with its sides, rain, soil and friction.

```ts
export declare class GpuShallowWater {
  readonly solver = "shallow-water-hr-muscl-hll-webgpu-f32-v1";
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  readonly dz: number;
  readonly stats: ShallowWaterF32Stats;
  maxCourant: number;
  courantExceeded: number;
  rainVolume: number;
  initialVolume: number;
  dt: number;
  time: number;
  steps: number;
  readonly rateLatency: number;
  readonly safety: number;
  readonly rateWait: boolean;
  readonly compute: GpuCompute;
  readonly water: ShallowWater;
  readonly setup: ShallowWaterSetup;
  readonly stateBuffer: GPUBuffer;
  readonly fixedBuffer: GPUBuffer;
  static create(compute: GpuCompute, water: ShallowWater, options?: GpuShallowWaterOptions): Promise<GpuShallowWater>;
  get cells(): number;
  step(count?: number): Promise<void>;
  advance(duration: number): Promise<void>;
  sync(): Promise<void>;
  checkpoint(): Promise<Uint8Array>;
  restoreCheckpoint(bytes: Uint8Array): void;
  read(): Promise<GpuShallowWaterSnapshot>;
  budget(snapshot: GpuShallowWaterSnapshot): { volume: number; inflow: number; rain: number; infiltrated: number; clipped: number; error: number; };
  pull(target?: ShallowWater, snapshot?: GpuShallowWaterSnapshot): Promise<GpuShallowWaterSnapshot>;
  destroy(): void;
}
```

### GpuShallowWaterOptions · interface

Options of GpuShallowWater: how old the face speeds that set the substeps may be (rateLatency), the margin, and whether to wait for them.

```ts
export interface GpuShallowWaterOptions {
    readonly rateLatency?: number;
    readonly safety?: number;
    readonly rateWait?: boolean;
}
```

### gpuShallowWaterSubsystem · function

A GPU (or float32 reference) shallow-water section: post stage, commensurate step, as shallowWaterSubsystem without bodies.

```ts
export declare function gpuShallowWaterSubsystem<W, B>(device: GpuCompute | 'reference', water: ShallowWater, options?: {
    readonly id?: string;
    readonly order?: number;
}): GpuSceneSubsystem<W, B>;
```

### GRANULAR_CHECKPOINT · const

Checkpoints of the float32 grain program (GpuGranular and GranularF32 write and read the same bytes): per grain the
position and radius, velocity and mass, spin and inverse inertia, force and torque, the contact histories the next
step reads, the walls with their sums, the cumulative counters (bucket and history overflows, removed grains), the
time and the statistics. A checkpoint of one restores into the other.

```ts
export declare const GRANULAR_CHECKPOINT = "granular-f32-v1";
```

### GRANULAR_GPU_SOLVER_ID · const

The solver id of the grains on WebGPU compute (float32).

```ts
export declare const GRANULAR_GPU_SOLVER_ID = "granular-dem-hash-grid-webgpu-f32-v1";
```

### GranularF32 · class

The grain program run on the CPU in float32, pass by pass over the shaders' buffer layouts: the GPU's bits where the two agree.

```ts
export declare class GranularF32 {
  readonly solver = "granular-dem-hash-grid-f32-reference-v1";
  readonly setup: DemSetup;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly spin: Float32Array;
  readonly ft: Float32Array;
  readonly wallF: Float32Array;
  readonly wallU: Uint32Array;
  readonly stats: DemStats;
  time: number;
  get count(): number;
  checkpoint(): Uint8Array;
  restoreCheckpoint(bytes: Uint8Array): void;
  refresh(): void;
  step(count?: number): void;
}
```

### GranularRunner · class

A grain run that starts on the GPU and carries on with the float64 solver when the device is lost (or was never
there). `granular` is the Granular the run was built from; while the GPU runs it only receives the snapshots.

```ts
export declare class GranularRunner {
  backend: 'gpu' | 'cpu';
  fallback: { reason: string; atTime: number; resumedFrom: number; stepsRerun: number; } | null;
  readonly granular: Granular;
  gpu: GpuGranular | null;
  static create(granular: Granular, compute: GpuCompute | null, options?: GranularRunnerOptions): Promise<GranularRunner>;
  get steps(): number;
  get time(): number;
  step(count?: number): Promise<void>;
  snapshot(): Promise<void>;
  destroy(): void;
}
```

### GranularRunnerOptions · interface

Options of GranularRunner: the backend's capacities and how often a snapshot is kept in the float64 solver for a fall back.

```ts
export interface GranularRunnerOptions extends DemOptions {
    readonly snapshotEvery?: number;
}
```

### SHALLOW_WATER_CHECKPOINT · const

Checkpoints of the float32 shallow-water scheme (GpuShallowWater and ShallowWaterF32 write and read the same bytes):
per cell (h, hu, hv, carry) and (infiltrated, scratch, side volume, its carry), the time, the step count, the length of
the last substep (the leading half of the friction uses it), the rain added, the statistics and the volumes the budget
is taken from. A checkpoint of one restores into the other.

```ts
export declare const SHALLOW_WATER_CHECKPOINT = "shallow-water-f32-v1";
```

### SHALLOW_WATER_GPU_SOLVER_ID · const

The solver id of the shallow water on WebGPU compute (float32).

```ts
export declare const SHALLOW_WATER_GPU_SOLVER_ID = "shallow-water-hr-muscl-hll-webgpu-f32-v1";
```

### ShallowWaterF32 · class

The shallow-water program run on the CPU in float32, pass by pass: the GPU's bits where the two agree.

```ts
export declare class ShallowWaterF32 {
  readonly solver = "shallow-water-hr-muscl-hll-f32-reference-v1";
  readonly setup: ShallowWaterSetup;
  readonly water: ShallowWater;
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  readonly dz: number;
  readonly state: Float32Array;
  readonly aux: Float32Array;
  readonly fixed: Float32Array;
  readonly stats: ShallowWaterF32Stats;
  rainVolume: number;
  initialVolume: number;
  dt: number;
  time: number;
  steps: number;
  safety: number;
  secondX: number;
  secondZ: number;
  get cells(): number;
  depth(c: number): number;
  volume(): number;
  ledger(): { inflow: number; rain: number; infiltrated: number; clipped: number; };
  volumeError(): number;
  checkpoint(): Uint8Array;
  restoreCheckpoint(bytes: Uint8Array): void;
  step(count?: number): void;
  measure(): [number, number];
  advance(duration: number): void;
  substep(sub: number, last: boolean, led?: boolean): void;
}
```

### ShallowWaterF32Stats · interface

What a float32 backend reports of a run; the names follow ShallowWater.

```ts
export interface ShallowWaterF32Stats {
    substeps: number;
    totalSubsteps: number;
    courant: number;
    maxWaveSpeed: number;
    wetCells: number;
}
```

### ShallowWaterRunner · class

A shallow-water run that starts on the GPU and carries on with the float64 solver when the device is lost.

`water` is the ShallowWater the run was built from. While the GPU runs it only receives the snapshots (every
`snapshotEvery` steps). When the device is lost, or was never there, `water` is advanced on the CPU from the last
snapshot to the time the run had reached and takes over: `backend` becomes 'cpu' and `fallback` says why, when, and
how much simulated time was run again.

```ts
export declare class ShallowWaterRunner {
  backend: 'gpu' | 'cpu';
  fallback: { reason: string; atTime: number; resumedFrom: number; stepsRerun: number; } | null;
  readonly water: ShallowWater;
  gpu: GpuShallowWater | null;
  static create(water: ShallowWater, compute: GpuCompute | null, options?: ShallowWaterRunnerOptions): Promise<ShallowWaterRunner>;
  get time(): number;
  get steps(): number;
  step(count?: number): Promise<void>;
  snapshot(): Promise<void>;
  destroy(): void;
}
```

### ShallowWaterRunnerOptions · interface

Options of ShallowWaterRunner: those of GpuShallowWater and how often a snapshot is kept in the float64 solver for a fall back.

```ts
export interface ShallowWaterRunnerOptions extends GpuShallowWaterOptions {
    readonly snapshotEvery?: number;
}
```
