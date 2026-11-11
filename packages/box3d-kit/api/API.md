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

```ts
export type Body = NativeBodyHandle;
```

### BodyKind · type

```ts
export type BodyKind = NativeBodyKind;
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
}
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

### BodyState · type

```ts
export type BodyState = NativeBodyState;
```

### BodyType · type

```ts
export type BodyType = NativeBodyType;
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
export declare function createWorld(options?: WorldOptions & LoadBox3DOptions & {
    readonly gravity?: readonly [number, number, number];
    readonly ground?: boolean;
}): Promise<PhysicsWorld>;
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
export type EngineErrorCode = 'INVALID_PAYLOAD' | 'INVALID_BACKEND' | 'UNSUPPORTED_BACKEND' | 'DISPOSED' | 'STALE_BODY' | 'WORLD_CAPACITY' | 'ALLOCATION_FAILED' | 'STALE_QUERY' | 'QUERY_VERSION_EXHAUSTED' | 'INVALID_STATE' | 'INTERNAL' | 'WASM_UNAVAILABLE' | 'INTEGRITY_MISMATCH' | 'INCOMPATIBLE_SAVE' | 'STALE_JOINT' | 'UNSUPPORTED_JOINT' | 'NUMERICAL_FAILURE' | 'WORK_LIMIT' | 'UNSTABLE_TIME_STEP';
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
    bodyKinds?(): readonly string[];
}
```

### Joint · type

```ts
export type Joint = NativeJointHandle;
```

### JointFrame · interface

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
}
```

### JointState · type

```ts
export type JointState = NativeJointState;
```

### JointType · type

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

### NativeBodyDescriptor · interface

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

```ts
export type NativeBodyKind = 'box' | 'sphere' | 'capsule' | 'hull' | 'mesh' | 'heightfield';
```

### NativeBodyShape · type

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

```ts
export type NativeBodyType = 'static' | 'kinematic' | 'dynamic';
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
}
```

### NativeJointFrame · interface

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

```ts
export interface NativeJointState {
    type: NativeJointType;
    value: number;
    force: [number, number, number];
    torque: [number, number, number];
}
```

### NativeJointType · type

```ts
export type NativeJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel';
```

### NativeQuaternion · type

```ts
export type NativeQuaternion = readonly [number, number, number, number];
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
  get supportsGeneralBodies(): boolean;
  resetWorld(options?: { seed?: number; ground?: boolean; gravity?: NativeQueryVector; }): void;
  setGravity(x: number, y: number, z: number): void;
  gravity(): [number, number, number];
  createBody(descriptor: NativeBodyDescriptor): NativeBodyHandle | null;
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
  jointAlive(joint: NativeJointHandle): boolean;
  destroyJoint(joint: NativeJointHandle): boolean;
  setJointMotor(joint: NativeJointHandle, motor: { speed: number; maxForce: number; } | null): void;
  setJointLimits(joint: NativeJointHandle, limits: { lower: number; upper: number; } | null): void;
  setJointSpring(joint: NativeJointHandle, spring: { hertz: number; dampingRatio: number; target?: number; } | null): void;
  setJointStiffness(joint: NativeJointHandle, hertz: number, dampingRatio?: number): void;
  setJointSteering(joint: NativeJointHandle, steering: { angle: number; hertz: number; dampingRatio: number; maxTorque: number; } | null): void;
  jointState(joint: NativeJointHandle): NativeJointState;
  collectEvents(): { events: NativeWorldEvent[]; dropped: number; };
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

### NativeWorldEvent · interface

```ts
export interface NativeWorldEvent {
    readonly kind: 'contact-begin' | 'contact-end' | 'hit' | 'sensor-begin' | 'sensor-end';
    readonly bodyA: NativeBodyHandle | null;
    readonly bodyB: NativeBodyHandle | null;
    readonly point?: NativeQueryVector;
    readonly normal?: NativeQueryVector;
    readonly approachSpeed?: number;
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
  reset(options?: ResetOptions): this;
  setGravity(gravity: Vec3Like): void;
  gravity(): [number, number, number];
  createBody(options: BodyOptions): Body | null;
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
    readonly world?: {
        readonly ground?: boolean;
        readonly gravity?: Vec3Like;
    };
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

```ts
export interface ResetOptions {
    readonly ground?: boolean;
    readonly gravity?: Vec3Like;
    readonly seed?: number;
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

### ShapeOptions · type

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

```ts
export type WorldEvent = NativeWorldEvent;
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
  takeEvents(): Promise<{ events: RemoteWorldEvent[]; dropped: number; }>;
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

### RemoteWorldEvent · type

A WorldEvent with the bodies as remote handles.

```ts
export type RemoteWorldEvent = Omit<WorldEvent, 'bodyA' | 'bodyB'> & {
    readonly bodyA: RemoteBody | null;
    readonly bodyB: RemoteBody | null;
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
  advance(): void;
  couplingViews(): { positions: Float64Array; velocities: Float64Array; masses: Float64Array; pinned: Uint8Array; };
  driveNode(node: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, mass: number, fx: number, fy: number, fz: number): void;
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
  couplingViews(): { rest: Float64Array; displacements: Float64Array; velocities: Float64Array; fixed: Uint8Array; };
  solveCoupledOperator(dof: number, out: Float64Array): boolean;
  beginCoupledTick(): Float64Array;
  finishCoupledTick(extra: Float64Array): void;
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

### SOLID_MAX_NODES · const

```ts
export declare const SOLID_MAX_NODES = 200000, SOLID_MAX_TETS = 1000000;
```

### SOLID_MAX_TETS · const

```ts
export declare const SOLID_MAX_NODES = 200000, SOLID_MAX_TETS = 1000000;
```

### SOLID_SOLVER_ID · const

```ts
export declare const SOLID_SOLVER_ID = "solid-tet-corot-js-f64-v1";
```

### SolidBody · class

A deformable solid of four-node tetrahedra with a lumped mass matrix. SI units, float64.

Statics and the implicit integrators minimise one incremental potential by Newton's method
with a Jacobi-preconditioned conjugate-gradient inner solve; products with the tangent
stiffness are formed element by element, so no global matrix is stored. Loads are dead
loads: tractions, pressure and gravity keep their reference direction and area.
No contact, no plasticity and no crack growth. See docs/SOLID_MECHANICS.md.

```ts
export declare class SolidBody {
  readonly solver = "solid-tet-corot-js-f64-v1";
  readonly model: SolidModel;
  readonly integrator: SolidIntegrator;
  readonly dt: number;
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
  readonly material: Readonly<Required<SolidMaterial>>;
  readonly stats: SolidSolveStats;
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
  strainEnergy(): number;
  kineticEnergy(): number;
  loadPotential(): number;
  volume(): number;
  reactions(out?: Float64Array<ArrayBuffer>): Float64Array;
  stresses(out?: Float64Array<ArrayBuffer>): Float64Array;
  strains(out?: Float64Array<ArrayBuffer>): Float64Array;
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
}
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

### SolidMaterial · interface

```ts
export interface SolidMaterial {
    youngModulus: number;
    poissonRatio: number;
    density: number;
    thermalExpansion?: number;
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
element's rotation. `neo-hookean`: compressible Neo-Hookean rubber.

```ts
export type SolidModel = 'linear' | 'corotational' | 'neo-hookean';
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
  addCable(cable: CompliantCableRuntime): this;
  addFrame(frame: FrameRuntime): this;
  attachCableToBody(cable: CompliantCableRuntime, node: number, body: B, options: BodyAttachOptions): StructureAttachment;
  attachCableToFrame(cable: CompliantCableRuntime, node: number, frame: FrameRuntime, frameNode: number): StructureAttachment;
  attachFrameToBody(frame: FrameRuntime, frameNode: number, body: B, options: FrameBodyAttachOptions): StructureAttachment;
  detach(attachment: StructureAttachment): void;
  prime(attachment: StructureAttachment, force: StructureVec3, moment?: StructureVec3): void;
  get reports(): readonly StructureAttachment[];
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

### COUPLED_EXAMPLE_SCENES · const

The coupled examples by name, each called with its defaults. Load them with a Simulation (`loadSimulationScene`, the kit's `loadScene`).

```ts
export declare const COUPLED_EXAMPLE_SCENES: {
    readonly [name: string]: () => Scene;
};
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

The scene's `water`, `cables` and `frames` sections are built after the
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

### ragdollScene · function

A ragdoll: a capsule torso, a sphere head and eight capsule limb segments on
nine spherical joints with cone and twist limits, dropped from `height`
metres above the ground with a slight forward tumble.

```ts
export declare function ragdollScene(options?: {
    height?: number;
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
    readonly version: 1;
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

```ts
export declare const SCENE_VERSION = 1;
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

### SceneCoupledSections · interface

The optional coupled sections of a scene.

```ts
export interface SceneCoupledSections {
    readonly water?: readonly SceneWater[];
    readonly cables?: readonly SceneCable[];
    readonly frames?: readonly SceneFrameSection[];
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

### sceneHasCoupling · function

True when a scene has a water basin, a cable or a frame: it then needs a Simulation, not just a rigid world.

```ts
export declare function sceneHasCoupling(scene: SceneCoupledSections): boolean;
```

### sceneHash · function

SHA-256 of the compact canonical text (UTF-8), as 64 lowercase hex digits. Equal scenes have equal hashes.

```ts
export declare function sceneHash(scene: unknown): string;
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
export type SceneJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel';
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

### validateScene · function

Check a scene completely, before anything is built. Returns every problem
found (at most SCENE_LIMITS.problems), each with a JSON-pointer path; an
empty list means the scene is valid. Never throws, whatever it is given.

```ts
export declare function validateScene(scene: unknown): SceneProblem[];
```

## `box3d-webgpu-kit/simulation`

### buildSceneSimulation · function

Build the water, cable and frame sections of a scene whose bodies and joints `builder` has already
built, and return the Simulation that steps them. Build order: frames, then cables (file order),
one StructureCoupling with the cables' attachments (cable by cable, in file order) and then the
frames' attachments; then the basins and their bodies. A rigid-only scene gives a Simulation with
no subsystems, whose step is `world.step()`. On a failure the world is reset and the error names the id.

```ts
export declare function buildSceneSimulation<W extends SimulationSceneWorld>(world: W, builder: SceneBuilder<W>, scene: Scene): LoadedSimulationScene<W>;
```

### cellTemperaturesToNodes · function

Temperature rise at the nodes of a box mesh from the cell temperatures of a co-located heat grid.
Heat cell (i, j, k) is at index i + nx (j + ny k) and node (i, j, k) at i + (nx + 1) (j + (ny + 1) k).
A node takes the mean of the cells that touch it (one at a corner, eight inside), minus `reference`.

```ts
export declare function cellTemperaturesToNodes(temperature: ArrayLike<number>, cells: readonly [number, number, number], reference: number, out: number[] | Float64Array): number[] | Float64Array;
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
export declare function loadSimulationScene(world: PhysicsWorld, scene: unknown): LoadedSimulationScene;
```

### resolveTiming · function

Decide how a subsystem with the given requirement runs on a simulation step of `dt`, or throw the stated error.

```ts
export declare function resolveTiming(id: string, kind: string, timeStep: SubsystemTimeStep, dt: number): SubsystemTiming;
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
  add(subsystem: Subsystem<W, B>): this;
  remove(id: string): boolean;
  get(id: string): Subsystem<W, B> | undefined;
  subsystems(): Subsystem<W, B>[];
  order(): SimulationDiagnostics['order'];
  step(): void;
  update(frameSeconds: number): { steps: number; alpha: number; droppedSeconds: number; };
  onStep(listener: (tick: number) => void): () => void;
  onEvent(listener: (event: SimulationEvent) => void): () => void;
  trackBody(body: B, inertia: StructureInertia, options?: { readonly gravityScale?: number; }): this;
  untrackBody(body: B): boolean;
  energy(): SimulationEnergy;
  diagnostics(): SimulationDiagnostics;
  dispose(): void;
}
```

### SIMULATION_STAGES · const

The order of one step. `rigid` and `events` belong to the Simulation; subsystems choose one of the other three.

```ts
export declare const SIMULATION_STAGES: readonly ["pre-couple", "couple", "rigid", "post", "events"];
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
    finish?(ctx: StepContext<W>): void;
    energy?(): SubsystemEnergy;
    diagnostics?(): unknown;
    dispose?(): void;
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
The solid does not act on the temperature. Co-located grids only: the solid must be a `boxMesh` whose cells are the heat
grid's cells (same counts, same cell size, every heat cell solid). Mapping: `cellTemperaturesToNodes`, then the solid takes
the mean of an element's four nodes. Post stage, between the heat solver and the solid, after every heat step.
`reference` is the stress-free temperature. The solid module allocates one array per update.

```ts
export declare function thermalSolidLink<W, B>(heat: HeatSolver, solid: SolidBody, options: {
    readonly id?: string;
    readonly reference: number;
}): Subsystem<W, B>;
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

- Each link becomes one body per collision shape, placed by forward
  kinematics. Several shapes are welded, each to the nearest one before it.
  A body's origin is its shape's centre of mass.
- Density is mass / collision volume, so the link's mass is the file's. The
  inertia is whatever the shapes then have: read `robotReport` for the gap.
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
