import {loadBox3D, type LoadBox3DOptions} from './loader.js';
import {PhysicsWorld, type WorldOptions} from './world.js';

export {loadBox3D, type LoadBox3DOptions, type Box3DModuleFactory} from './loader.js';
export {BUILD_INFO, type BuildInfo} from './core/build-info.js';
export {
  PhysicsWorld, toVec3, leakReporting, type Body, type BodyPose, type Vec3, type Vec3Like, type WorldOptions, type SpawnBoxOptions,
  type QueryOptions, type RaycastOptions, type WorldStats, type ReplayLog, type ReplayCommand,
  type RecordingOptions, type ReplayReport,
} from './world.js';
export {convertMatrices, convertVector, toBox3DFrame, type UpAxis} from './axes.js';
export {writeInstances, lastUploadRange, INSTANCE_WGSL, type GpuQueueLike, type GpuBufferLike, type WriteInstancesOptions, type UploadRange} from './gpu.js';
export {spawnBoxes, applyImpulses, BodyRing, detectEnvironment, capabilities, LICENSE_NOTICE, type EnvironmentReport, type Capabilities} from './helpers.js';
export {readPoses, packPoses, readBodyPoses, type PoseArrays} from './ecs.js';
export {boxOutlines, rayLine, DEBUG_FLOATS_PER_BOX, type DebugLines, type DebugLineOptions} from './debug.js';
export {SnapshotEncoder, SnapshotDecoder} from './net.js';
export {saveSession, loadSession, type SavedSession} from './session.js';
export {mountInspector, formatStats, type Inspector, type InspectorOptions, type InspectorSource} from './inspector.js';
export {SharedFrameReader, SharedFrameWriter, sharedMemoryAvailable} from './shared-frames.js';
export {WorldScheduler, type SchedulableWorld, type SchedulerOptions, type SchedulerFrame} from './scheduler.js';
export type {InstanceSource} from './three.js';
export {FixedStepLoop, pauseOnHidden, type FixedStepOptions, type FixedStepResult} from './loop.js';
export {EngineError} from './core/contracts.js';
export {
  NativeWorldPool, NativeWorldBackend, NATIVE_WORLD_API_VERSION,
  type NativeBodyHandle, type NativeSpatialQuery, type NativeQueryResult, type NativeQueryCastHit,
  type NativeQueryBodyHit, type NativeQueryFilter, type NativeBodyCapacityInfo,
} from './core/native-world.js';
export type {InstanceBufferSource, PhysicsBackend} from './backend-types.js';

/** Every `code` an EngineError from this package can carry. */
export type EngineErrorCode =
  | 'INVALID_PAYLOAD' | 'INVALID_BACKEND' | 'UNSUPPORTED_BACKEND' | 'DISPOSED' | 'STALE_BODY'
  | 'WORLD_CAPACITY' | 'ALLOCATION_FAILED' | 'STALE_QUERY' | 'QUERY_VERSION_EXHAUSTED' | 'INVALID_STATE' | 'INTERNAL'
  | 'WASM_UNAVAILABLE' | 'INTEGRITY_MISMATCH' | 'INCOMPATIBLE_SAVE';

/**
 * One-call setup: load the WASM module and return an empty arena world.
 * The world owns its module; `world.dispose()` releases both.
 * For several worlds sharing one module, use `loadBox3D()` + `new PhysicsWorld(pool)`.
 */
export async function createWorld(options: WorldOptions & LoadBox3DOptions = {}): Promise<PhysicsWorld> {
  const world = new PhysicsWorld(await loadBox3D(options), options, true);
  return world.resetArena();
}
