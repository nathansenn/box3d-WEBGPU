# box3d-webgpu-kit API reference

Generated from the published type declarations by `scripts/api-docs.mjs`. See the README for guides.

## `box3d-webgpu-kit`

### applyImpulses · function

Apply impulses[i*3..i*3+2] to bodies[i]. Destroyed bodies are skipped; returns how many were applied.

```ts
export declare function applyImpulses(world: PhysicsWorld, bodies: readonly (Body | null)[], impulses: ArrayLike<number>): number;
```

### Body · type

```ts
export type Body = NativeBodyHandle;
```

### BodyPose · interface

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

### Box3DModuleFactory · type

Emscripten MODULARIZE/EXPORT_ES6 factory exported by box3d.js.

```ts
export type Box3DModuleFactory = (options?: {
    locateFile?: (path: string, prefix: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
}) => Promise<unknown>;
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

### createWorld · function

One-call setup: load the WASM module and return an empty arena world.
The world owns its module; `world.dispose()` releases both.
For several worlds sharing one module, use `loadBox3D()` + `new PhysicsWorld(pool)`.

```ts
export declare function createWorld(options?: WorldOptions & LoadBox3DOptions): Promise<PhysicsWorld>;
```

### DEBUG_FLOATS_PER_BOX · const

```ts
export declare const DEBUG_FLOATS_PER_BOX: number;
```

### DebugLineOptions · interface

```ts
export interface DebugLineOptions {
    readonly alpha?: number;
    readonly up?: UpAxis;
    readonly out?: Float32Array;
    readonly skipGround?: boolean;
}
```

### DebugLines · interface

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

### EngineError · class

```ts
export declare class EngineError extends Error {
  readonly code: string;
}
```

### EngineErrorCode · type

Every `code` an EngineError from this package can carry.

```ts
export type EngineErrorCode = 'INVALID_PAYLOAD' | 'INVALID_BACKEND' | 'UNSUPPORTED_BACKEND' | 'DISPOSED' | 'STALE_BODY' | 'WORLD_CAPACITY' | 'ALLOCATION_FAILED' | 'STALE_QUERY' | 'QUERY_VERSION_EXHAUSTED' | 'INVALID_STATE' | 'INTERNAL' | 'WASM_UNAVAILABLE' | 'INTEGRITY_MISMATCH' | 'INCOMPATIBLE_SAVE';
```

### EnvironmentReport · interface

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
}
```

### FixedStepOptions · interface

```ts
export interface FixedStepOptions {
    readonly step?: number;
    readonly maxSteps?: number;
}
```

### FixedStepResult · interface

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

```ts
export interface Inspector {
    readonly element: ElementLike;
    refresh(): Promise<void>;
    unmount(): void;
}
```

### InspectorOptions · interface

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
}
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

```ts
export interface LoadBox3DOptions {
    readonly moduleUrl?: string | URL;
    readonly wasmUrl?: string | URL;
    readonly wasmBinary?: ArrayBuffer | Uint8Array;
    readonly factory?: Box3DModuleFactory;
    readonly integrity?: boolean | string;
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

### mountInspector · function

```ts
export declare function mountInspector(source: InspectorSource, options?: InspectorOptions): Inspector;
```

### NATIVE_WORLD_API_VERSION · const

```ts
export declare const NATIVE_WORLD_API_VERSION = 1;
```

### NativeBodyCapacityInfo · interface

```ts
export interface NativeBodyCapacityInfo {
    capacity: number;
    maxCapacity: number;
    growable: boolean;
    bufferVersion: number | null;
    bridgeBufferBytes: number | null;
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

### NativeQueryBodyHit · interface

```ts
export interface NativeQueryBodyHit {
    readonly body: NativeBodyHandle;
}
```

### NativeQueryCastHit · interface

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
    readonly kind: 'ray' | 'sphere-cast' | 'box-cast';
    readonly hits: readonly NativeQueryCastHit[];
} | {
    readonly kind: 'sphere-overlap' | 'box-overlap' | 'aabb-candidates';
    readonly hits: readonly NativeQueryBodyHit[];
});
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
});
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
  get supportsSpatialQueries(): boolean;
  spatialQueryInfo(): { supported: boolean; maxBatch: number; maxHitsPerQuery: number; bridgeBufferBytes: number; version: number; };
  queryBatch(queries: readonly NativeSpatialQuery[]): NativeQueryResult[];
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
  sphereCast(origin: Vec3Like, radius: number, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  boxCast(origin: Vec3Like, halfExtents: Vec3Like, translation: Vec3Like, options?: QueryOptions): NativeQueryCastHit | null;
  overlapSphere(center: Vec3Like, radius: number, options?: QueryOptions | number): Body[];
  overlapBox(center: Vec3Like, halfExtents: Vec3Like, options?: QueryOptions): Body[];
  getPose(body: Body, out?: BodyPose): BodyPose | null;
  matrices(): Float32Array;
  colors(): Float32Array;
  bodyCount(): number;
  awakeCount(): number;
  get tick(): number;
  replayHash(): number;
  exactHash(): number;
  transformVersion(): number;
  colorVersion(): number;
  stats(): WorldStats;
  startRecording(options?: RecordingOptions): void;
  stopRecording(): ReplayLog;
  get isRecording(): boolean;
  replay(log: ReplayLog): boolean;
  replayDetailed(log: ReplayLog): ReplayReport;
  dispose(): void;
}
```

### PoseArrays · interface

```ts
export interface PoseArrays {
    readonly positions: Float32Array;
    readonly rotations: Float32Array;
    readonly halfExtents?: Float32Array;
}
```

### QueryOptions · interface

```ts
export interface QueryOptions {
    readonly filter?: NativeQueryFilter;
    readonly limit?: number;
}
```

### RaycastOptions · type

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

```ts
export interface RecordingOptions {
    readonly checkpointEvery?: number;
}
```

### ReplayCommand · type

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
};
```

### ReplayLog · interface

Everything needed to reproduce a session bit-for-bit on the same WASM build. JSON-serializable.

```ts
export interface ReplayLog {
    readonly version: 1;
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

### SavedSession · interface

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

```ts
export interface SchedulableWorld {
    update(frameSeconds: number): FixedStepResult;
}
```

### SchedulerFrame · interface

```ts
export interface SchedulerFrame {
    readonly updated: number;
    readonly deferred: number;
    readonly steps: number;
    readonly elapsedMs: number;
}
```

### SchedulerOptions · interface

```ts
export interface SchedulerOptions {
    readonly budgetMs?: number;
    readonly now?: () => number;
}
```

### SharedFrameReader · class

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

```ts
export declare class SharedFrameWriter {
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  publish(matrices: Float32Array, count: number, colors: Float32Array, colorVersion: number): void;
}
```

### sharedMemoryAvailable · function

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

```ts
export interface SpawnBoxOptions {
    readonly position: Vec3Like;
    readonly halfSize?: number;
    readonly impulse?: Vec3Like;
}
```

### toBox3DFrame · function

Convert one point or direction from the target frame back to Box3D's Y-up frame.

```ts
export declare function toBox3DFrame(v: readonly [number, number, number], up?: UpAxis): [number, number, number];
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

### WorldOptions · interface

```ts
export interface WorldOptions extends FixedStepOptions {
    readonly subSteps?: number;
    readonly seed?: number;
    readonly capacity?: number;
    readonly interpolate?: boolean;
}
```

### WorldScheduler · class

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

### WorldStats · interface

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
  loadPreset(id: number, stress?: number, seed?: number): Promise<number>;
  stats(): Promise<WorldStats>;
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

### RemoteWorldOptions · type

```ts
export type RemoteWorldOptions = WorldOptions & Omit<LoadBox3DOptions, 'factory' | 'wasmBinary'> & {
    readonly interpolateFrames?: boolean;
    readonly sharedMemory?: boolean | 'auto';
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
    gravity: readonly [number, number, number]; solver?: 'proximal'; forceTolerance?: number;
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

SI, tension-only axial cables. Fixed anchors exchange reactions with an external support.
XPBD multipliers reset per substep and accumulate only across that substep's iterations.
Constitutive compliance is independent of solve settings; finite solve/integration error is reported.

```ts
export declare class CompliantCableRuntime implements EngineRuntime<CableStepRequest, CableSnapshot> {
  readonly capabilities: EngineCapabilities;
  readonly config: CableConfig;
  readonly backend: CableBackend;
  get tick(): number;
  step(request: CableStepRequest): CableSnapshot;
  inspect(): CableSnapshot;
  checkpoint(): CableCheckpoint;
  static fromCheckpoint(value: unknown): CompliantCableRuntime;
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

Linear 3D prismatic frames with consistent mass and implicit midpoint dynamics.
Small-strain/small-rotation elasticity; no buckling, yielding, contact or shear.
Element matrix products avoid allocating a dense global system.

```ts
export declare class FrameRuntime implements EngineRuntime<FrameStepRequest, FrameSnapshot> {
  readonly capabilities: EngineCapabilities;
  readonly config: FrameConfig;
  get tick(): number;
  step(request: FrameStepRequest): FrameSnapshot;
  solveStatic(forces?: ArrayLike<number>): FrameStaticSolution;
  inspect(): FrameSnapshot;
  checkpoint(): FrameCheckpoint;
  static fromCheckpoint(value: unknown): FrameRuntime;
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

## `box3d-webgpu-kit/gameplay`

### CharacterController · class

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
