import type { PhysicsBackend } from '../types.ts';
import type { ScenePreset } from '../scenes.ts';
import { EngineError, finite as finiteNumber, integer, onlyKeys, record } from './contracts.ts';

export const NATIVE_WORLD_API_VERSION = 1;
const BODY_OWNER: unique symbol = Symbol('Box3D native body owner');
/** World-owned opaque reference. Not JSON checkpoint data or a dense row index. */
export interface NativeBodyHandle {
  readonly token: bigint;
  readonly [BODY_OWNER]: object;
}

export type NativeQueryVector = readonly [number, number, number];
export interface NativeQueryFilter {
  readonly bodies?: 'all' | 'static' | 'dynamic' | 'none';
  readonly categoryBits?: bigint;
  readonly maskBits?: bigint;
  readonly ignoreBody?: NativeBodyHandle;
}
interface NativeQueryBase {
  readonly origin: NativeQueryVector;
  /** Maximum returned hits, 1..256; default 32. Total matches are still counted. */
  readonly limit?: number;
  readonly filter?: NativeQueryFilter;
}
/** Cast translations are complete displacements, not normalized directions.
 * Query boxes are axis aligned. Shape overlaps include the pinned SDK's 0.0005
 * distance slop at its default length scale. AABB candidates are broad-phase bounds only.
 */
export type NativeSpatialQuery = NativeQueryBase & (
  { readonly kind: 'ray'; readonly translation: NativeQueryVector } |
  { readonly kind: 'sphere-cast'; readonly translation: NativeQueryVector; readonly radius: number } |
  { readonly kind: 'box-cast'; readonly translation: NativeQueryVector; readonly halfExtents: NativeQueryVector } |
  { readonly kind: 'sphere-overlap'; readonly radius: number } |
  { readonly kind: 'box-overlap' | 'aabb-candidates'; readonly halfExtents: NativeQueryVector }
);
export interface NativeQueryBodyHit { readonly body: NativeBodyHandle }
export interface NativeQueryCastHit extends NativeQueryBodyHit {
  readonly point: NativeQueryVector;
  /** The pinned SDK reports a zero normal and fraction 0 for initial overlap. */
  readonly normal: NativeQueryVector;
  readonly fraction: number;
  readonly material: bigint;
  readonly triangleIndex: number;
  readonly childIndex: number;
}
/** Owned copies survive subsequent queries, heap growth, resets and destruction.
 * A body reference can become stale after removal/reset; resolve with bodyIndex.
 */
export type NativeQueryResult = {
  readonly totalHits: number;
  readonly overflow: boolean;
} & (
  { readonly kind: 'ray' | 'sphere-cast' | 'box-cast'; readonly hits: readonly NativeQueryCastHit[] } |
  { readonly kind: 'sphere-overlap' | 'box-overlap' | 'aabb-candidates'; readonly hits: readonly NativeQueryBodyHit[] }
);

const QUERY_KINDS = ['ray','sphere-cast','box-cast','sphere-overlap','box-overlap','aabb-candidates'] as const;
const QUERY_BODY_TYPES = {all:3, static:1, dynamic:2, none:0} as const;
const QUERY_INPUT_BYTES=80, QUERY_STATUS_BYTES=16, QUERY_HIT_BYTES=56;
const QUERY_MAX_BYTES=128*96+32768*56;
interface ValidatedQuery {
  kind: number; origin: number[]; translation: number[]; extent: number[];
  bodyTypes: number; categoryBits: bigint; maskBits: bigint; ignoreBody: bigint; limit: number;
}

function queryVector(value: unknown,label: string,positive=false): number[] {
  if(!Array.isArray(value)||value.length!==3)throw new EngineError('INVALID_PAYLOAD',`${label} must contain exactly three numbers.`);
  // Array.from visits sparse entries as undefined; holes must never become NaN in WASM.
  return Array.from(value,(n,i)=>finite(n,`${label}[${i}]`,positive?Number.MIN_VALUE:-1e6,1e6));
}
function queryBits(value: unknown,label: string): bigint {
  if(typeof value!=='bigint'||value<0n||value>0xFFFFFFFFFFFFFFFFn)throw new EngineError('INVALID_PAYLOAD',`${label} must be an unsigned 64-bit bigint.`);
  return value;
}

function finite(value: unknown, label: string, min=-Infinity, max=Infinity): number {
  const number=finiteNumber(value,label,min,max),converted=Math.fround(number);
  if(!Number.isFinite(converted)||(number!==0&&converted===0))throw new EngineError('INVALID_PAYLOAD',`${label} must fit a nonzero float32 value or be zero.`);
  return number;
}

/** One Emscripten module can own independent worlds in the same growing heap. */
export interface NativeWorldModule {
  readonly HEAPF32: Float32Array;
  _b3w_world_api_version(): number;
  _b3w_world_capacity(): number;
  _b3w_world_last_create_error(): number;
  _b3w_world_create(): number;
  _b3w_world_destroy(handle: number): number;
  _b3w_world_valid(handle: number): number;
  _b3w_world_clear(handle: number): number;
  _b3w_world_create_scene(handle: number, scene: number, stress: number, seed: number): number;
  _b3w_world_max_bodies(handle: number): number;
  _b3w_world_body_count(handle: number): number;
  _b3w_world_dynamic_count(handle: number): number;
  _b3w_world_matrices_ptr(handle: number): number | bigint;
  _b3w_world_colors_ptr(handle: number): number | bigint;
  _b3w_world_transform_version(handle: number): number;
  _b3w_world_color_version(handle: number): number;
  _b3w_world_awake_count(handle: number): number;
  _b3w_world_replay_hash(handle: number): number;
  _b3w_world_step(handle: number, dt: number, subSteps: number): number;
  _b3w_world_sync_transforms(handle: number): number;
  _b3w_world_apply_impulse(handle: number, index: number, ix: number, iy: number, iz: number): number;
  _b3w_world_kick_stack(handle: number, strength: number): number;
  _b3w_world_explode(handle: number, x: number, y: number, z: number, strength: number, radius: number): number;
  _b3w_world_launch_projectile(handle: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number;
  _b3w_world_spawn_rain(handle: number, count: number, spread: number, height: number): number;
  /** Optional capacity extension; all three exports must be present together. */
  _b3w_world_reserve?(handle: number, requested: number): number;
  _b3w_world_buffer_version?(handle: number): number;
  _b3w_world_storage_bytes?(handle: number): number;
  _b3w_world_contact_count?(handle: number): number;
  /** Optional lifecycle extension; all five exports must be present together. */
  _b3w_world_body_handle?(world: number, index: number): bigint;
  _b3w_world_body_index?(world: number, body: bigint): number;
  _b3w_world_destroy_body?(world: number, body: bigint): number;
  _b3w_world_apply_body_impulse?(world: number, body: bigint, x: number, y: number, z: number): number;
  _b3w_world_launch_projectile_handle?(world: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): bigint;
  /** Optional batched spatial-query extension; all seven exports require lifecycle support. */
  _b3w_world_query_reserve?(world: number, inputs: number, hits: number): number;
  _b3w_world_query_inputs_ptr?(world: number): number | bigint;
  _b3w_world_query_status_ptr?(world: number): number | bigint;
  _b3w_world_query_hits_ptr?(world: number): number | bigint;
  _b3w_world_query_version?(world: number): number;
  _b3w_world_query_storage_bytes?(world: number): number;
  _b3w_world_query_batch?(world: number, count: number, version: number): number;
  /** Optional general rigid-body extension (shapes, setters, joints, events); all exports must be present together. */
  _malloc?(bytes: number): number | bigint;
  _free?(pointer: number | bigint): void;
  _b3w_world_reset?(world: number, seed: number, flags: number, gx: number, gy: number, gz: number): number;
  _b3w_world_set_gravity?(world: number, x: number, y: number, z: number): number;
  _b3w_world_get_gravity?(world: number, out: number | bigint): number;
  _b3w_world_create_body?(world: number, descriptor: number | bigint): bigint;
  _b3w_world_copy_body_kinds?(world: number, out: number | bigint, capacity: number): number;
  _b3w_world_get_body_state?(world: number, body: bigint, out: number | bigint): number;
  _b3w_world_set_body_transform?(world: number, body: bigint, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): number;
  _b3w_world_set_body_velocity?(world: number, body: bigint, vx: number, vy: number, vz: number, wx: number, wy: number, wz: number): number;
  _b3w_world_set_body_target?(world: number, body: bigint, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, dt: number): number;
  _b3w_world_set_body_type?(world: number, body: bigint, type: number): number;
  _b3w_world_set_body_awake?(world: number, body: bigint, awake: number): number;
  _b3w_world_set_body_gravity_scale?(world: number, body: bigint, scale: number): number;
  _b3w_world_set_body_damping?(world: number, body: bigint, linear: number, angular: number): number;
  _b3w_world_set_body_filter?(world: number, body: bigint, categoryBits: bigint, maskBits: bigint, groupIndex: number): number;
  _b3w_world_apply_body?(world: number, body: bigint, mode: number, x: number, y: number, z: number): number;
  _b3w_world_apply_body_at?(world: number, body: bigint, mode: number, x: number, y: number, z: number, px: number, py: number, pz: number): number;
  _b3w_world_create_joint?(world: number, descriptor: number | bigint): bigint;
  _b3w_world_joint_valid?(world: number, joint: bigint): number;
  _b3w_world_destroy_joint?(world: number, joint: bigint): number;
  _b3w_world_joint_set_motor?(world: number, joint: bigint, enable: number, speed: number, maxForce: number): number;
  _b3w_world_joint_set_limits?(world: number, joint: bigint, enable: number, lower: number, upper: number): number;
  _b3w_world_joint_set_spring?(world: number, joint: bigint, enable: number, hertz: number, dampingRatio: number, target: number): number;
  _b3w_world_joint_set_steering?(world: number, joint: bigint, enable: number, angle: number, hertz: number, dampingRatio: number, maxTorque: number): number;
  _b3w_world_get_joint_state?(world: number, joint: bigint, out: number | bigint): number;
  _b3w_world_collect_events?(world: number): number;
  _b3w_world_events_ptr?(world: number): number | bigint;
  _b3w_world_event_total?(world: number): number;
}

const GENERAL_EXPORTS = ['reset','set_gravity','get_gravity','create_body','copy_body_kinds','get_body_state','set_body_transform',
  'set_body_velocity','set_body_target','set_body_type','set_body_awake','set_body_gravity_scale','set_body_damping','set_body_filter',
  'apply_body','apply_body_at','create_joint','joint_valid','destroy_joint','joint_set_motor','joint_set_limits','joint_set_spring',
  'joint_set_steering','get_joint_state','collect_events','events_ptr','event_total'] as const;

const JOINT_OWNER: unique symbol = Symbol('Box3D native joint owner');
/** World-owned opaque joint reference. A joint dies with either of its bodies. */
export interface NativeJointHandle {
  readonly token: bigint;
  readonly [JOINT_OWNER]: object;
}
export type NativeQuaternion = readonly [number, number, number, number];
export type NativeBodyShape =
  { readonly kind: 'box'; readonly halfExtents: NativeQueryVector } |
  { readonly kind: 'sphere'; readonly radius: number } |
  /** The capsule axis is the body's local Y; halfLength excludes the round caps. */
  { readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number };
export type NativeBodyType = 'static' | 'kinematic' | 'dynamic';
export interface NativeBodyDescriptor {
  readonly shape: NativeBodyShape;
  /** Default 'dynamic'. */
  readonly type?: NativeBodyType;
  readonly position: NativeQueryVector;
  /** Unit quaternion [x, y, z, w]; default identity. */
  readonly rotation?: NativeQuaternion;
  readonly linearVelocity?: NativeQueryVector;
  readonly angularVelocity?: NativeQueryVector;
  /** kg/m^3 in a metre-scaled world. Default 1000. */
  readonly density?: number;
  /** Default 0.6. */
  readonly friction?: number;
  /** Default 0. */
  readonly restitution?: number;
  /** 0xRRGGBB. Default 0xB8C0CC. */
  readonly color?: number;
  /** Continuous collision against other dynamic bodies, for small fast objects. */
  readonly bullet?: boolean;
  /** Detects overlaps (sensor events) without colliding. */
  readonly sensor?: boolean;
  /** Report 'hit' events with point, normal and approach speed. */
  readonly hitEvents?: boolean;
  readonly neverSleeps?: boolean;
  readonly lockRotation?: boolean;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  /** Multiplier on world gravity; default 1. */
  readonly gravityScale?: number;
  readonly filter?: { readonly categoryBits?: bigint; readonly maskBits?: bigint; readonly groupIndex?: number };
}
export interface NativeBodyState {
  position: [number, number, number];
  rotation: [number, number, number, number];
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  mass: number;
  awake: boolean;
  type: NativeBodyType;
}
export type NativeJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel';
export interface NativeJointFrame { readonly position?: NativeQueryVector; readonly rotation?: NativeQuaternion }
/** Frames are local to each body. Revolute and wheel joints turn about the frame's z axis;
 * prismatic and wheel-suspension travel is along frame A's x axis. A null body is the fixed world.
 */
export interface NativeJointDescriptor {
  readonly type: NativeJointType;
  readonly bodyA: NativeBodyHandle | null;
  readonly bodyB: NativeBodyHandle | null;
  readonly frameA?: NativeJointFrame;
  readonly frameB?: NativeJointFrame;
  readonly collideConnected?: boolean;
  /** Angle (rad), translation (m) or length (m) limits; spherical: twist limits. */
  readonly limits?: { readonly lower: number; readonly upper: number };
  /** speed in rad/s or m/s; maxForce is a torque (N·m) for angular motors. */
  readonly motor?: { readonly speed: number; readonly maxForce: number };
  /** Spring towards `target` (angle or translation). On a weld joint it softens the weld. */
  readonly spring?: { readonly hertz: number; readonly dampingRatio: number; readonly target?: number };
  /** Distance joints: rest length in metres (required). */
  readonly length?: number;
  /** Spherical joints: cone limit half-angle in radians. */
  readonly coneAngle?: number;
}
export interface NativeJointState {
  type: NativeJointType;
  /** Revolute angle, prismatic translation or distance length; 0 for the others. */
  value: number;
  force: [number, number, number];
  torque: [number, number, number];
}
export interface NativeWorldEvent {
  readonly kind: 'contact-begin' | 'contact-end' | 'hit' | 'sensor-begin' | 'sensor-end';
  /** Null when the body no longer exists. For sensor events A is the sensor and B the visitor. */
  readonly bodyA: NativeBodyHandle | null;
  readonly bodyB: NativeBodyHandle | null;
  /** Hits only. */
  readonly point?: NativeQueryVector;
  readonly normal?: NativeQueryVector;
  readonly approachSpeed?: number;
}
const BODY_KINDS = ['box','sphere','capsule'] as const;
const BODY_TYPES = ['static','kinematic','dynamic'] as const;
const JOINT_TYPES = ['weld','revolute','spherical','prismatic','distance','wheel'] as const;
const EVENT_KINDS = ['contact-begin','contact-end','hit','sensor-begin','sensor-end'] as const;

export interface NativeBodyCapacityInfo {
  capacity: number;
  maxCapacity: number;
  growable: boolean;
  bufferVersion: number | null;
  /** Bridge-owned body/index/matrix/color buffers, excluding Box3D internals. */
  bridgeBufferBytes: number | null;
}

const REQUIRED_EXPORTS = ['api_version','capacity','last_create_error','create','destroy','valid','clear',
  'create_scene','max_bodies','body_count','dynamic_count','matrices_ptr','colors_ptr','transform_version',
  'color_version','awake_count','replay_hash','step','sync_transforms','apply_impulse','kick_stack','explode',
  'launch_projectile','spawn_rain'] as const;

export function assertNativeWorldModule(value: unknown): asserts value is NativeWorldModule {
  const mod=value as NativeWorldModule;
  if(!mod||typeof mod!=='object'||!(mod.HEAPF32 instanceof Float32Array))throw new EngineError('INVALID_BACKEND','Expected an Emscripten module with a live Float32 heap.');
  for(const name of REQUIRED_EXPORTS)if(typeof mod[`_b3w_world_${name}`]!=='function') {
    throw new EngineError('UNSUPPORTED_BACKEND',`Native world export b3w_world_${name} is missing; rebuild the native artifact.`);
  }
  if(mod._b3w_world_api_version()!==NATIVE_WORLD_API_VERSION)throw new EngineError('UNSUPPORTED_BACKEND','Native world ABI version does not match this adapter.');
  integer(mod._b3w_world_capacity(),'native world capacity',1,128);
  const bodyExports=[mod._b3w_world_body_handle,mod._b3w_world_body_index,mod._b3w_world_destroy_body,mod._b3w_world_apply_body_impulse,mod._b3w_world_launch_projectile_handle];
  if(bodyExports.some(value=>value!==undefined)&&!bodyExports.every(value=>typeof value==='function'))throw new EngineError('UNSUPPORTED_BACKEND','The native body lifecycle extension is incomplete.');
  const capacityExports=[mod._b3w_world_reserve,mod._b3w_world_buffer_version,mod._b3w_world_storage_bytes];
  if(capacityExports.some(value=>value!==undefined)&&!capacityExports.every(value=>typeof value==='function')) {
    throw new EngineError('UNSUPPORTED_BACKEND','The native capacity extension is incomplete.');
  }
  const queryExports=[mod._b3w_world_query_reserve,mod._b3w_world_query_inputs_ptr,mod._b3w_world_query_status_ptr,
    mod._b3w_world_query_hits_ptr,mod._b3w_world_query_version,mod._b3w_world_query_storage_bytes,mod._b3w_world_query_batch];
  const generalExports=GENERAL_EXPORTS.map(name=>mod[`_b3w_world_${name}`]);
  if(generalExports.some(value=>value!==undefined)&&(!generalExports.every(value=>typeof value==='function')||
    typeof mod._malloc!=='function'||typeof mod._free!=='function'||!bodyExports.every(value=>typeof value==='function'))) {
    throw new EngineError('UNSUPPORTED_BACKEND','The native general-body extension requires all of its exports, malloc/free and body lifecycle support.');
  }
  if(queryExports.some(value=>value!==undefined)&&(!queryExports.every(value=>typeof value==='function')||!bodyExports.every(value=>typeof value==='function'))) {
    throw new EngineError('UNSUPPORTED_BACKEND','The native spatial-query extension requires all query and body lifecycle exports.');
  }
}

/** Owns one generation-checked C context. Destroying it cannot reset another world.
 * Borrowed heap data is valid only while this context lives; read HEAPF32 again after
 * calls that can grow module memory. Capacity reservation may also relocate stream
 * offsets; ask the pointer getters again after reservation. Checkpoints are not
 * implemented by this adapter.
 */
export class NativeWorldBackend implements PhysicsBackend {
  readonly name='Box3D WASM · isolated world';
  readonly isWasm=true;
  readonly handle: number;
  private readonly mod: NativeWorldModule;
  private readonly onDispose?: () => void;
  private matricesPtr: number | bigint=0;
  private colorsPtr: number | bigint=0;
  private bodyCapacity=0;
  private bufferVersion: number | null=null;
  private disposed=false;
  // References retain this tiny identity marker, never the world/module itself.
  private readonly bodyOwner={};
  // Replaced whenever the world is rebuilt, so joints of an earlier scene can never alias new ones.
  private jointOwner={};
  // One 128-byte scratch block for descriptors and small outputs, allocated on first use.
  private scratch=0;

  constructor(module: unknown, onDispose?: () => void) {
    assertNativeWorldModule(module);this.mod=module;this.onDispose=onDispose;
    const handle=module._b3w_world_create()>>>0;
    if(handle===0) {
      const reason=module._b3w_world_last_create_error();
      throw new EngineError(reason===2?'ALLOCATION_FAILED':'WORLD_CAPACITY',reason===2?
        'Native world buffer allocation failed.':`The module has reached its ${module._b3w_world_capacity()} independent-world limit.`);
    }
    this.handle=handle;
    try {
      this.refreshStreams(true);
    }catch(error){module._b3w_world_destroy(handle);throw error;}
  }

  private validateStream(pointer: number | bigint, words: number): void {
    const offset=Number(pointer);
    if(!Number.isSafeInteger(offset)||offset<=0||offset%4!==0||offset+words*4>this.mod.HEAPF32.byteLength) {
      throw new EngineError('INVALID_BACKEND','Native world stream is outside the module heap.');
    }
  }
  private refreshStreams(force=false): void {
    const version=this.mod._b3w_world_buffer_version?.(this.handle)??null;
    if(version!==null)integer(version,'native buffer version',1,0xFFFFFFFF);
    if(!force&&version===this.bufferVersion)return;
    const capacity=integer(this.mod._b3w_world_max_bodies(this.handle),'native body capacity',1,65536);
    const matrices=this.mod._b3w_world_matrices_ptr(this.handle),colors=this.mod._b3w_world_colors_ptr(this.handle);
    this.validateStream(matrices,capacity*16);this.validateStream(colors,capacity*4);
    // Commit only a completely validated layout. Raw native callers may reserve
    // capacity too, so pointer getters observe the native buffer generation.
    this.bodyCapacity=capacity;this.matricesPtr=matrices;this.colorsPtr=colors;this.bufferVersion=version;
  }
  private assertAlive(): void {
    if(this.disposed||this.mod._b3w_world_valid(this.handle)!==1) {
      if(!this.disposed){this.disposed=true;this.onDispose?.();}
      throw new EngineError('DISPOSED','This native world has been destroyed or its handle is stale.');
    }
  }
  private accepted(status: number): void {
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected this operation.');
  }

  get HEAPF32(): Float32Array { this.assertAlive();return this.mod.HEAPF32; }
  get maxBodies(): number { this.assertAlive();this.refreshStreams();return this.bodyCapacity; }
  _b3w_matrices_ptr(): number | bigint { this.assertAlive();this.refreshStreams();return this.matricesPtr; }
  _b3w_colors_ptr(): number | bigint { this.assertAlive();this.refreshStreams();return this.colorsPtr; }
  _b3w_body_count(): number { return this.bodyCount(); }
  _b3w_max_bodies(): number { this.assertAlive();return this.maxBodies; }
  frameVersion(): number { this.assertAlive();return this.mod._b3w_world_transform_version(this.handle)>>>0; }
  colorVersion(): number { this.assertAlive();return this.mod._b3w_world_color_version(this.handle)>>>0; }
  awakeCount(): number { this.assertAlive();return this.mod._b3w_world_awake_count(this.handle); }
  /** Public SDK contact-pair count, including broad-phase non-touching pairs. */
  contactCount(): number | null { this.assertAlive();return this.mod._b3w_world_contact_count?.(this.handle)??null; }
  bodyCount(): number { this.assertAlive();return this.mod._b3w_world_body_count(this.handle); }
  dynamicCount(): number { this.assertAlive();return this.mod._b3w_world_dynamic_count(this.handle); }
  replayHash(): number { this.assertAlive();return this.mod._b3w_world_replay_hash(this.handle)>>>0; }

  capacityInfo(): NativeBodyCapacityInfo {
    this.assertAlive();this.refreshStreams();
    const growable=typeof this.mod._b3w_world_reserve==='function';
    const bytes=this.mod._b3w_world_storage_bytes?.(this.handle)??null;
    if(bytes!==null)integer(bytes,'native bridge buffer bytes',this.bodyCapacity*80,65536*256);
    return {capacity:this.bodyCapacity,maxCapacity:growable?65536:this.bodyCapacity,growable,
      bufferVersion:this.bufferVersion,bridgeBufferBytes:bytes};
  }

  /** Explicitly grow through 4K / 16K / 64K tiers; never shrink or insert bodies.
   * Requires the optional capacity extension when current storage is insufficient.
   */
  reserveBodyCapacity(requested: number): number {
    this.assertAlive();integer(requested,'requested body capacity',1,65536);this.refreshStreams();
    if(requested<=this.bodyCapacity)return this.bodyCapacity;
    if(!this.mod._b3w_world_reserve)throw new EngineError('UNSUPPORTED_BACKEND','This native artifact has fixed body capacity.');
    const result=this.mod._b3w_world_reserve(this.handle,requested);
    if(result===-3)throw new EngineError('ALLOCATION_FAILED','Native buffer growth failed; the existing world remains intact.');
    if(result===-1)throw new EngineError('DISPOSED','The native context rejected buffer growth.');
    if(![4096,16384,65536].includes(result)||result<requested)throw new EngineError('INVALID_BACKEND','Native capacity growth returned an invalid result.');
    this.refreshStreams(true);
    if(this.bodyCapacity!==result)throw new EngineError('INVALID_BACKEND','Native capacity and stream layout disagree.');
    return result;
  }

  get supportsBodyLifecycle(): boolean { this.assertAlive();return typeof this.mod._b3w_world_body_handle==='function'; }
  private requireBodyLifecycle(): void {
    this.assertAlive();
    if(!this.supportsBodyLifecycle)throw new EngineError('UNSUPPORTED_BACKEND','This native artifact does not support body recycling.');
  }
  private wrapBody(token: bigint): NativeBodyHandle {
    if(typeof token!=='bigint'||token< -0x8000000000000000n||token>0xFFFFFFFFFFFFFFFFn)throw new EngineError('INVALID_BACKEND','Native body creation returned an invalid token.');
    // WebAssembly i64 results are signed JavaScript BigInts, even for C uint64_t.
    const normalized=BigInt.asUintN(64,token);
    if(normalized===0n)throw new EngineError('INVALID_BACKEND','Native body creation returned an invalid token.');
    return Object.freeze({token:normalized,[BODY_OWNER]:this.bodyOwner});
  }
  private bodyToken(body: NativeBodyHandle): bigint {
    this.requireBodyLifecycle();
    if(!body||typeof body!=='object'||body[BODY_OWNER]!==this.bodyOwner||typeof body.token!=='bigint'||body.token<1n||body.token>0xFFFFFFFFFFFFFFFFn) {
      throw new EngineError('INVALID_PAYLOAD','Body reference must belong to this exact world instance.');
    }
    return body.token;
  }
  /** Obtain a stable reference before a later removal can compact dense rows. */
  bodyHandle(index: number): NativeBodyHandle {
    this.requireBodyLifecycle();integer(index,'body index',0,this.bodyCount()-1);
    return this.wrapBody(this.mod._b3w_world_body_handle!(this.handle,index));
  }
  /** Current render row, or null for a destroyed body. Never persist this row. */
  bodyIndex(body: NativeBodyHandle): number | null {
    const token=this.bodyToken(body),index=this.mod._b3w_world_body_index!(this.handle,token);
    if(index===-1)return null;
    if(index===undefined||!Number.isSafeInteger(index)||index<0||index>=this.bodyCount())throw new EngineError('INVALID_BACKEND','Native body lookup returned an invalid row.');
    return index;
  }
  destroyBody(body: NativeBodyHandle): boolean {
    const token=this.bodyToken(body),status=this.mod._b3w_world_destroy_body!(this.handle,token);
    if(status===0)return false;
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected body destruction.');
    return true;
  }
  applyBodyImpulse(body: NativeBodyHandle,x: number,y: number,z: number): void {
    const token=this.bodyToken(body);finite(x,'impulse x');finite(y,'impulse y');finite(z,'impulse z');
    const status=this.mod._b3w_world_apply_body_impulse!(this.handle,token,x,y,z);
    if(status===0)throw new EngineError('STALE_BODY','This native body has been destroyed or belongs to a previous scene.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected the body impulse.');
  }
  launchProjectileBody(x: number,y: number,z: number,vx: number,vy: number,vz: number,size: number): NativeBodyHandle | null {
    this.requireBodyLifecycle();finite(x,'position x');finite(y,'position y');finite(z,'position z');
    finite(vx,'impulse x');finite(vy,'impulse y');finite(vz,'impulse z');finite(size,'half-size',Number.MIN_VALUE);
    const token=this.mod._b3w_world_launch_projectile_handle!(this.handle,x,y,z,vx,vy,vz,size);
    return token===0n?null:this.wrapBody(token);
  }

  /** True when the artifact has the general-body extension: shapes, setters, joints and events. */
  get supportsGeneralBodies(): boolean { this.assertAlive();return typeof this.mod._b3w_world_create_body==='function'; }
  private general(): DataView {
    this.assertAlive();
    if(!this.supportsGeneralBodies)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks the general-body extension; rebuild with npm run build:wasm.');
    if(this.scratch===0) {
      const pointer=Number(this.mod._malloc!(128));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%8!==0)throw new EngineError('ALLOCATION_FAILED','Native scratch allocation failed.');
      this.scratch=pointer;
    }
    // Memory growth replaces the buffer, so build the view per call.
    return new DataView(this.mod.HEAPF32.buffer,this.scratch,128);
  }
  private wrapJoint(token: bigint): NativeJointHandle {
    return Object.freeze({token:BigInt.asUintN(64,token),[JOINT_OWNER]:this.jointOwner});
  }
  private jointToken(joint: NativeJointHandle): bigint {
    if(!joint||typeof joint!=='object'||joint[JOINT_OWNER]!==this.jointOwner||typeof joint.token!=='bigint'||joint.token<1n) {
      throw new EngineError('INVALID_PAYLOAD','Joint reference must belong to this exact world instance.');
    }
    return joint.token;
  }
  private bodyStatus(status: number | undefined): void {
    if(status===0)throw new EngineError('STALE_BODY','This native body has been destroyed or belongs to a previous scene.');
    if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the values.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected this operation.');
  }
  private jointStatus(status: number | undefined): void {
    if(status===0)throw new EngineError('STALE_JOINT','This joint has been destroyed, or one of its bodies has.');
    if(status===-2)throw new EngineError('UNSUPPORTED_JOINT','This joint type does not support that setting.');
    if(status===-3)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the values.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected this operation.');
  }

  /** Replace the world with an empty one. `ground` adds the static 88 m slab whose top is y = 0. */
  resetWorld(options: {seed?: number; ground?: boolean; gravity?: NativeQueryVector}={}): void {
    this.general();
    const seed=integer(options.seed??1,'seed',0,0xFFFFFFFF),g=options.gravity??[0,-9.81,0];
    finite(g[0],'gravity x');finite(g[1],'gravity y');finite(g[2],'gravity z');
    this.accepted(this.mod._b3w_world_reset!(this.handle,seed,options.ground===false?0:1,g[0],g[1],g[2]));
    this.jointOwner={};
  }
  setGravity(x: number,y: number,z: number): void {
    this.general();finite(x,'gravity x');finite(y,'gravity y');finite(z,'gravity z');
    this.accepted(this.mod._b3w_world_set_gravity!(this.handle,x,y,z));
  }
  gravity(): [number, number, number] {
    const view=this.general();
    this.accepted(this.mod._b3w_world_get_gravity!(this.handle,this.scratch));
    return [view.getFloat32(0,true),view.getFloat32(4,true),view.getFloat32(8,true)];
  }

  /** Create a body. Returns null when the world is at body capacity. */
  createBody(descriptor: NativeBodyDescriptor): NativeBodyHandle | null {
    const view=this.general(),shape=descriptor.shape,kind=BODY_KINDS.indexOf(shape?.kind),type=BODY_TYPES.indexOf(descriptor.type??'dynamic');
    if(kind<0)throw new EngineError('INVALID_PAYLOAD',"shape.kind must be 'box', 'sphere' or 'capsule'.");
    if(type<0)throw new EngineError('INVALID_PAYLOAD',"type must be 'static', 'kinematic' or 'dynamic'.");
    const vector=(value: NativeQueryVector | undefined,label: string,fallback: NativeQueryVector): NativeQueryVector=>{
      const v=value??fallback;finite(v[0],`${label} x`);finite(v[1],`${label} y`);finite(v[2],`${label} z`);return v;
    };
    const size: [number, number, number]=shape.kind==='box'?[finite(shape.halfExtents[0],'half extent x',1e-4),finite(shape.halfExtents[1],'half extent y',1e-4),finite(shape.halfExtents[2],'half extent z',1e-4)]:
      shape.kind==='sphere'?[finite(shape.radius,'radius',1e-4),0,0]:[finite(shape.radius,'radius',1e-4),finite(shape.halfLength,'capsule half length',0.0025),0];
    const position=vector(descriptor.position,'position',[0,0,0]),rotation=descriptor.rotation??[0,0,0,1];
    for(let i=0;i<4;i++)finite(rotation[i],'rotation');
    const linear=vector(descriptor.linearVelocity,'linear velocity',[0,0,0]),angular=vector(descriptor.angularVelocity,'angular velocity',[0,0,0]);
    const filter=descriptor.filter;
    if(filter&&(filter.categoryBits===undefined)!==(filter.maskBits===undefined))throw new EngineError('INVALID_PAYLOAD','filter needs both categoryBits and maskBits, or neither.');
    for(let i=0;i<128;i+=4)view.setUint32(i,0,true);
    view.setUint32(0,kind,true);view.setUint32(4,type,true);
    for(let i=0;i<3;i++){view.setFloat32(8+i*4,position[i],true);view.setFloat32(36+i*4,linear[i],true);view.setFloat32(48+i*4,angular[i],true);view.setFloat32(60+i*4,size[i],true);}
    for(let i=0;i<4;i++)view.setFloat32(20+i*4,rotation[i],true);
    view.setFloat32(72,finite(descriptor.density??1000,'density',0),true);
    view.setFloat32(76,finite(descriptor.friction??0.6,'friction',0),true);
    view.setFloat32(80,finite(descriptor.restitution??0,'restitution',0),true);
    view.setUint32(84,integer(descriptor.color??0xB8C0CC,'color',0,0xFFFFFFFF),true);
    view.setUint32(88,(descriptor.bullet?1:0)|(descriptor.sensor?2:0)|(descriptor.hitEvents?4:0)|(descriptor.neverSleeps?8:0)|(descriptor.lockRotation?16:0),true);
    view.setFloat32(92,finite(descriptor.linearDamping??0,'linear damping',0),true);
    view.setFloat32(96,finite(descriptor.angularDamping??0,'angular damping',0),true);
    const gravityScale=finite(descriptor.gravityScale??1,'gravity scale');
    view.setFloat32(100,gravityScale===0?0:gravityScale,true);
    view.setBigUint64(104,BigInt.asUintN(64,filter?.categoryBits??0n),true);view.setBigUint64(112,BigInt.asUintN(64,filter?.maskBits??0n),true);
    view.setInt32(120,integer(filter?.groupIndex??0,'filter group',-0x80000000,0x7FFFFFFF),true);
    const full=this.bodyCount()>=this.maxBodies;
    const token=this.mod._b3w_world_create_body!(this.handle,this.scratch);
    if(token===0n) {
      if(full)return null;
      throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the body descriptor.');
    }
    const body=this.wrapBody(token);
    // The descriptor cannot carry a zero gravity scale (zero means "default"), so apply it afterwards.
    if(gravityScale===0)this.bodyStatus(this.mod._b3w_world_set_body_gravity_scale!(this.handle,body.token,0));
    return body;
  }
  /** Shape kind of every render row, in row order. Rows move when a body is destroyed. */
  bodyKinds(): ('box' | 'sphere' | 'capsule')[] {
    this.general();
    const count=this.bodyCount();
    if(count===0)return [];
    const pointer=Number(this.mod._malloc!(count));
    if(!Number.isSafeInteger(pointer)||pointer<=0)throw new EngineError('ALLOCATION_FAILED','Native scratch allocation failed.');
    try {
      const written=this.mod._b3w_world_copy_body_kinds!(this.handle,pointer,count);
      if(written!==count)throw new EngineError('INVALID_BACKEND','Native body kinds are out of step with the body count.');
      return Array.from(new Uint8Array(this.mod.HEAPF32.buffer,pointer,count),kind=>BODY_KINDS[kind]??'box');
    }finally{this.mod._free!(pointer);}
  }
  bodyState(body: NativeBodyHandle): NativeBodyState {
    const token=this.bodyToken(body),view=this.general();
    this.bodyStatus(this.mod._b3w_world_get_body_state!(this.handle,token,this.scratch));
    const f=(i: number)=>view.getFloat32(i*4,true);
    return {position:[f(0),f(1),f(2)],rotation:[f(3),f(4),f(5),f(6)],linearVelocity:[f(7),f(8),f(9)],angularVelocity:[f(10),f(11),f(12)],
      mass:f(13),awake:f(14)!==0,type:BODY_TYPES[f(15)]??'dynamic'};
  }
  /** Teleport. For a moving kinematic body prefer setBodyTarget, which keeps contacts stable. */
  setBodyTransform(body: NativeBodyHandle,position: NativeQueryVector,rotation: NativeQuaternion=[0,0,0,1]): void {
    const token=this.bodyToken(body);this.general();
    for(let i=0;i<3;i++)finite(position[i],'position');for(let i=0;i<4;i++)finite(rotation[i],'rotation');
    this.bodyStatus(this.mod._b3w_world_set_body_transform!(this.handle,token,position[0],position[1],position[2],rotation[0],rotation[1],rotation[2],rotation[3]));
  }
  setBodyVelocity(body: NativeBodyHandle,linear: NativeQueryVector,angular: NativeQueryVector=[0,0,0]): void {
    const token=this.bodyToken(body);this.general();
    for(let i=0;i<3;i++){finite(linear[i],'linear velocity');finite(angular[i],'angular velocity');}
    this.bodyStatus(this.mod._b3w_world_set_body_velocity!(this.handle,token,linear[0],linear[1],linear[2],angular[0],angular[1],angular[2]));
  }
  /** Set a kinematic body's velocity so that it reaches the pose after `seconds`. */
  setBodyTarget(body: NativeBodyHandle,position: NativeQueryVector,rotation: NativeQuaternion,seconds: number): void {
    const token=this.bodyToken(body);this.general();
    for(let i=0;i<3;i++)finite(position[i],'position');for(let i=0;i<4;i++)finite(rotation[i],'rotation');finite(seconds,'seconds',Number.MIN_VALUE);
    this.bodyStatus(this.mod._b3w_world_set_body_target!(this.handle,token,position[0],position[1],position[2],rotation[0],rotation[1],rotation[2],rotation[3],seconds));
  }
  setBodyType(body: NativeBodyHandle,type: NativeBodyType): void {
    const token=this.bodyToken(body),code=BODY_TYPES.indexOf(type);this.general();
    if(code<0)throw new EngineError('INVALID_PAYLOAD',"type must be 'static', 'kinematic' or 'dynamic'.");
    this.bodyStatus(this.mod._b3w_world_set_body_type!(this.handle,token,code));
  }
  setBodyAwake(body: NativeBodyHandle,awake: boolean): void {
    const token=this.bodyToken(body);this.general();
    this.bodyStatus(this.mod._b3w_world_set_body_awake!(this.handle,token,awake?1:0));
  }
  setBodyGravityScale(body: NativeBodyHandle,scale: number): void {
    const token=this.bodyToken(body);this.general();finite(scale,'gravity scale');
    this.bodyStatus(this.mod._b3w_world_set_body_gravity_scale!(this.handle,token,scale));
  }
  setBodyDamping(body: NativeBodyHandle,linear: number,angular: number): void {
    const token=this.bodyToken(body);this.general();finite(linear,'linear damping',0);finite(angular,'angular damping',0);
    this.bodyStatus(this.mod._b3w_world_set_body_damping!(this.handle,token,linear,angular));
  }
  /** A body collides with another when each one's categoryBits intersects the other's maskBits. */
  setBodyFilter(body: NativeBodyHandle,categoryBits: bigint,maskBits: bigint,groupIndex=0): void {
    const token=this.bodyToken(body);this.general();integer(groupIndex,'filter group',-0x80000000,0x7FFFFFFF);
    this.bodyStatus(this.mod._b3w_world_set_body_filter!(this.handle,token,BigInt.asUintN(64,categoryBits),BigInt.asUintN(64,maskBits),groupIndex));
  }
  /** Forces and torques act over the next step; impulses change velocity at once. `point` is in world space. */
  applyToBody(body: NativeBodyHandle,mode: 'force' | 'torque' | 'impulse' | 'angular-impulse',value: NativeQueryVector,point?: NativeQueryVector): void {
    const token=this.bodyToken(body),code=(['force','torque','impulse','angular-impulse'] as const).indexOf(mode);this.general();
    if(code<0)throw new EngineError('INVALID_PAYLOAD','Unknown apply mode.');
    for(let i=0;i<3;i++)finite(value[i],mode);
    if(point===undefined){this.bodyStatus(this.mod._b3w_world_apply_body!(this.handle,token,code,value[0],value[1],value[2]));return;}
    if(mode!=='force'&&mode!=='impulse')throw new EngineError('INVALID_PAYLOAD','Only a force or an impulse can be applied at a point.');
    for(let i=0;i<3;i++)finite(point[i],'point');
    this.bodyStatus(this.mod._b3w_world_apply_body_at!(this.handle,token,mode==='force'?0:1,value[0],value[1],value[2],point[0],point[1],point[2]));
  }

  createJoint(descriptor: NativeJointDescriptor): NativeJointHandle {
    const view=this.general(),type=JOINT_TYPES.indexOf(descriptor.type);
    if(type<0)throw new EngineError('INVALID_PAYLOAD','Unknown joint type.');
    const a=descriptor.bodyA===null?0n:this.bodyToken(descriptor.bodyA),b=descriptor.bodyB===null?0n:this.bodyToken(descriptor.bodyB);
    if(a===b)throw new EngineError('INVALID_PAYLOAD','A joint needs two different bodies.');
    const {limits,motor,spring}=descriptor;
    if(limits){finite(limits.lower,'lower limit');finite(limits.upper,'upper limit',limits.lower);}
    if(motor){finite(motor.speed,'motor speed');finite(motor.maxForce,'motor max force',0);}
    if(spring){finite(spring.hertz,'spring hertz',0);finite(spring.dampingRatio,'spring damping ratio',0);finite(spring.target??0,'spring target');}
    if(descriptor.type==='distance')finite(descriptor.length,'distance joint length',Number.MIN_VALUE);
    if(descriptor.coneAngle!==undefined)finite(descriptor.coneAngle,'cone angle',0,Math.PI);
    for(let i=0;i<128;i+=4)view.setUint32(i,0,true);
    view.setUint32(0,type,true);
    view.setUint32(4,(descriptor.collideConnected?1:0)|(limits?2:0)|(motor?4:0)|(spring?8:0)|(descriptor.coneAngle!==undefined?16:0),true);
    view.setBigUint64(8,a,true);view.setBigUint64(16,b,true);
    [descriptor.frameA,descriptor.frameB].forEach((frame,side)=>{
      const p=frame?.position??[0,0,0],q=frame?.rotation??[0,0,0,1],base=24+side*28;
      for(let i=0;i<3;i++)view.setFloat32(base+i*4,finite(p[i],'frame position'),true);
      for(let i=0;i<4;i++)view.setFloat32(base+12+i*4,finite(q[i],'frame rotation'),true);
    });
    view.setFloat32(80,limits?.lower??0,true);view.setFloat32(84,limits?.upper??0,true);
    view.setFloat32(88,motor?.speed??0,true);view.setFloat32(92,motor?.maxForce??0,true);
    view.setFloat32(96,spring?.hertz??0,true);view.setFloat32(100,spring?.dampingRatio??0,true);
    view.setFloat32(104,descriptor.type==='distance'?descriptor.length!:spring?.target??0,true);
    view.setFloat32(108,descriptor.coneAngle??0,true);
    const token=this.mod._b3w_world_create_joint!(this.handle,this.scratch);
    if(token===0n)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the joint: check that both bodies are alive.');
    return this.wrapJoint(token);
  }
  /** False once the joint, or either of its bodies, has been destroyed. */
  jointAlive(joint: NativeJointHandle): boolean {
    const token=this.jointToken(joint);this.general();
    return this.mod._b3w_world_joint_valid!(this.handle,token)===1;
  }
  destroyJoint(joint: NativeJointHandle): boolean {
    const token=this.jointToken(joint);this.general();
    const status=this.mod._b3w_world_destroy_joint!(this.handle,token);
    if(status===0)return false;
    this.jointStatus(status);return true;
  }
  /** Pass null to switch the motor off. Revolute, prismatic, distance and wheel (spin) joints. */
  setJointMotor(joint: NativeJointHandle,motor: {speed: number; maxForce: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(motor){finite(motor.speed,'motor speed');finite(motor.maxForce,'motor max force',0);}
    this.jointStatus(this.mod._b3w_world_joint_set_motor!(this.handle,token,motor?1:0,motor?.speed??0,motor?.maxForce??0));
  }
  /** Pass null to remove the limits. Not available on weld joints. */
  setJointLimits(joint: NativeJointHandle,limits: {lower: number; upper: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(limits){finite(limits.lower,'lower limit');finite(limits.upper,'upper limit',limits.lower);}
    this.jointStatus(this.mod._b3w_world_joint_set_limits!(this.handle,token,limits?1:0,limits?.lower??0,limits?.upper??0));
  }
  /** Pass null to switch the spring off. */
  setJointSpring(joint: NativeJointHandle,spring: {hertz: number; dampingRatio: number; target?: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(spring){finite(spring.hertz,'spring hertz',0);finite(spring.dampingRatio,'spring damping ratio',0);finite(spring.target??0,'spring target');}
    this.jointStatus(this.mod._b3w_world_joint_set_spring!(this.handle,token,spring?1:0,spring?.hertz??0,spring?.dampingRatio??0,spring?.target??0));
  }
  /** Wheel joints only. Pass null to switch steering off. */
  setJointSteering(joint: NativeJointHandle,steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(steering){finite(steering.angle,'steering angle');finite(steering.hertz,'steering hertz',0);finite(steering.dampingRatio,'steering damping ratio',0);finite(steering.maxTorque,'steering max torque',0);}
    this.jointStatus(this.mod._b3w_world_joint_set_steering!(this.handle,token,steering?1:0,steering?.angle??0,steering?.hertz??0,steering?.dampingRatio??0,steering?.maxTorque??0));
  }
  jointState(joint: NativeJointHandle): NativeJointState {
    const token=this.jointToken(joint),view=this.general();
    this.jointStatus(this.mod._b3w_world_get_joint_state!(this.handle,token,this.scratch));
    const f=(i: number)=>view.getFloat32(i*4,true);
    return {type:JOINT_TYPES[f(1)]??'weld',value:f(0),force:[f(2),f(3),f(4)],torque:[f(5),f(6),f(7)]};
  }

  /** Contact and sensor events of the most recent step. Call once after each step.
   * `dropped` counts events that did not fit the 65,536-event buffer.
   */
  collectEvents(): {events: NativeWorldEvent[]; dropped: number} {
    this.general();
    const count=this.mod._b3w_world_collect_events!(this.handle);
    if(count<0)throw new EngineError('DISPOSED','The native context rejected event collection.');
    const total=this.mod._b3w_world_event_total!(this.handle),events: NativeWorldEvent[]=[];
    if(count===0)return {events,dropped:Math.max(0,total)};
    const pointer=Number(this.mod._b3w_world_events_ptr!(this.handle));
    if(!Number.isSafeInteger(pointer)||pointer<=0||pointer+count*56>this.mod.HEAPF32.byteLength)throw new EngineError('INVALID_BACKEND','Native event buffer is outside the module heap.');
    const view=new DataView(this.mod.HEAPF32.buffer,pointer,count*56);
    const body=(offset: number)=>{const token=view.getBigUint64(offset,true);return token===0n?null:this.wrapBody(token);};
    for(let i=0;i<count;i++) {
      const o=i*56,kind=EVENT_KINDS[view.getUint32(o,true)];
      if(kind===undefined)throw new EngineError('INVALID_BACKEND','Native event kind is unknown.');
      const bodyA=body(o+8),bodyB=body(o+16);
      events.push(kind==='hit'?{kind,bodyA,bodyB,point:[view.getFloat32(o+24,true),view.getFloat32(o+28,true),view.getFloat32(o+32,true)],
        normal:[view.getFloat32(o+36,true),view.getFloat32(o+40,true),view.getFloat32(o+44,true)],approachSpeed:view.getFloat32(o+48,true)}:{kind,bodyA,bodyB});
    }
    return {events,dropped:Math.max(0,total-count)};
  }

  get supportsSpatialQueries(): boolean { this.assertAlive();return typeof this.mod._b3w_world_query_batch==='function'; }

  spatialQueryInfo(): {supported: boolean; maxBatch: number; maxHitsPerQuery: number; bridgeBufferBytes: number; version: number} {
    this.assertAlive();
    const supported=this.supportsSpatialQueries;
    const bytes=this.mod._b3w_world_query_storage_bytes?.(this.handle)??0;
    const version=(this.mod._b3w_world_query_version?.(this.handle)??0)>>>0;
    if(!Number.isSafeInteger(bytes)||bytes<0||bytes>QUERY_MAX_BYTES)throw new EngineError('INVALID_BACKEND','Native query storage size is invalid.');
    return {supported,maxBatch:supported?128:0,maxHitsPerQuery:supported?256:0,bridgeBufferBytes:bytes,version};
  }

  private validateQuery(value: unknown,index: number): ValidatedQuery {
    const label=`queries[${index}]`,q=record(value,label),kind=QUERY_KINDS.indexOf(q.kind as typeof QUERY_KINDS[number]);
    if(kind<0)throw new EngineError('INVALID_PAYLOAD',`${label}.kind is not supported.`);
    const keys=['kind','origin','limit','filter'];
    if(kind<=2)keys.push('translation');
    if(kind===1||kind===3)keys.push('radius');
    if(kind===2||kind===4||kind===5)keys.push('halfExtents');
    onlyKeys(q,keys,label);
    const origin=queryVector(q.origin,`${label}.origin`),translation=kind<=2?queryVector(q.translation,`${label}.translation`):[0,0,0];
    const extent=kind===1||kind===3?[finite(q.radius,`${label}.radius`,Number.MIN_VALUE,1e6),0,0]:
      kind===2||kind===4||kind===5?queryVector(q.halfExtents,`${label}.halfExtents`,true):[0,0,0];
    const limit=integer(q.limit===undefined?32:q.limit,`${label}.limit`,1,256);
    const filter=q.filter===undefined?{}:record(q.filter,`${label}.filter`);
    onlyKeys(filter,['bodies','categoryBits','maskBits','ignoreBody'],`${label}.filter`);
    const bodies=filter.bodies===undefined?'all':filter.bodies;
    if(typeof bodies!=='string'||!Object.hasOwn(QUERY_BODY_TYPES,bodies))throw new EngineError('INVALID_PAYLOAD',`${label}.filter.bodies is not supported.`);
    const ignoreBody=filter.ignoreBody===undefined?0n:this.bodyToken(filter.ignoreBody as NativeBodyHandle);
    return {kind,origin,translation,extent,limit,bodyTypes:QUERY_BODY_TYPES[bodies as keyof typeof QUERY_BODY_TYPES],ignoreBody,
      categoryBits:queryBits(filter.categoryBits===undefined?0xFFFFFFFFFFFFFFFFn:filter.categoryBits,`${label}.filter.categoryBits`),
      maskBits:queryBits(filter.maskBits===undefined?0xFFFFFFFFFFFFFFFFn:filter.maskBits,`${label}.filter.maskBits`)};
  }

  private queryStatus(status: number): void {
    const errors: Record<number,[string,string]>={
      [-1]:['DISPOSED','This native world has been destroyed.'],
      [-2]:['INVALID_PAYLOAD','The native query batch has an invalid layout or capacity.'],
      [-3]:['ALLOCATION_FAILED','Native query buffer allocation failed; the previous results and world remain intact.'],
      [-4]:['STALE_QUERY','Native query storage changed before execution.'],
      [-5]:['STALE_BODY','An ignored query body has been destroyed or belongs to a previous scene.'],
      [-6]:['QUERY_VERSION_EXHAUSTED','The native query revision is exhausted; create a new world to run queries.'],
    };
    if(status<0){const [code,message]=errors[status]??['INVALID_BACKEND','The native query batch returned an unknown failure.'];throw new EngineError(code,message);}
  }

  /** Validate all inputs before allocation; execute once and return owned results.
   * Casts keep nearest hits, breaking ties by body token, triangle and child.
   * Overlaps sort by body token. Queries do not step or alter the physics state.
   */
  queryBatch(queries: readonly NativeSpatialQuery[]): NativeQueryResult[] {
    this.assertAlive();
    if(!this.supportsSpatialQueries)throw new EngineError('UNSUPPORTED_BACKEND','This native artifact does not support spatial queries.');
    if(!Array.isArray(queries)||queries.length>128)throw new EngineError('INVALID_PAYLOAD','A native query batch must contain at most 128 inputs.');
    const inputs=Array.from(queries,(q,i)=>this.validateQuery(q,i));
    for(const token of new Set(inputs.map(q=>q.ignoreBody)))if(token!==0n&&this.mod._b3w_world_body_index!(this.handle,token)<0) {
      throw new EngineError('STALE_BODY','An ignored query body has been destroyed or belongs to a previous scene.');
    }
    if(inputs.length===0)return [];
    const required=inputs.reduce((n,q)=>n+q.limit,0),reserved=this.mod._b3w_world_query_reserve!(this.handle,inputs.length,required);
    this.queryStatus(reserved);
    if(reserved!==0)throw new EngineError('INVALID_BACKEND','Native query allocation returned an invalid status.');
    const version=this.mod._b3w_world_query_version!(this.handle)>>>0;
    const inputPtr=Number(this.mod._b3w_world_query_inputs_ptr!(this.handle));
    const statusPtr=Number(this.mod._b3w_world_query_status_ptr!(this.handle));
    const hitsPtr=Number(this.mod._b3w_world_query_hits_ptr!(this.handle));
    const ranges=[[inputPtr,inputs.length*QUERY_INPUT_BYTES],[statusPtr,inputs.length*QUERY_STATUS_BYTES],[hitsPtr,required*QUERY_HIT_BYTES]];
    const heap=this.mod.HEAPF32.buffer;
    if(version===0||ranges.some(([p,n])=>!Number.isSafeInteger(p)||p<=0||p%8!==0||p+n>heap.byteLength)||
      ranges.some(([p,n],i)=>ranges.some(([p2,n2],j)=>i<j&&p<p2+n2&&p2<p+n))) {
      throw new EngineError('INVALID_BACKEND','Native query streams overlap or lie outside the module heap.');
    }
    let view=new DataView(heap);
    for(let i=0;i<inputs.length;i++){
      const q=inputs[i],p=inputPtr+i*QUERY_INPUT_BYTES;
      view.setUint32(p,q.kind,true);view.setUint32(p+4,q.bodyTypes,true);
      for(let k=0;k<3;k++){view.setFloat32(p+8+k*4,q.origin[k],true);view.setFloat32(p+20+k*4,q.translation[k],true);view.setFloat32(p+32+k*4,q.extent[k],true);}
      view.setUint32(p+44,0,true);view.setBigUint64(p+48,q.categoryBits,true);view.setBigUint64(p+56,q.maskBits,true);
      view.setBigUint64(p+64,q.ignoreBody,true);view.setUint32(p+72,q.limit,true);view.setUint32(p+76,0,true);
    }
    const status=this.mod._b3w_world_query_batch!(this.handle,inputs.length,version);this.queryStatus(status);
    if(status!==inputs.length||(this.mod._b3w_world_query_version!(this.handle)>>>0)!==version+1)throw new EngineError('INVALID_BACKEND','Native query execution returned an invalid revision or count.');
    // Reacquire after the SDK: query traversal may grow the module heap.
    view=new DataView(this.mod.HEAPF32.buffer);
    let offset=0;
    const output:NativeQueryResult[]=[];
    for(let i=0;i<inputs.length;i++){
      const q=inputs[i],p=statusPtr+i*QUERY_STATUS_BYTES,count=view.getUint32(p+4,true),total=view.getUint32(p+8,true),overflow=view.getUint32(p+12,true);
      if(view.getUint32(p,true)!==offset||count!==Math.min(total,q.limit)||total>65536||overflow!==Number(total>count))throw new EngineError('INVALID_BACKEND','Native query output counts are inconsistent.');
      const hits:NativeQueryCastHit[]=[];
      for(let j=0;j<count;j++){
        const h=hitsPtr+(offset+j)*QUERY_HIT_BYTES,token=view.getBigUint64(h,true),fraction=view.getFloat32(h+40,true);
        const flags=view.getUint32(h+52,true),triangleIndex=view.getInt32(h+44,true),childIndex=view.getInt32(h+48,true);
        const point=[view.getFloat32(h+16,true),view.getFloat32(h+20,true),view.getFloat32(h+24,true)] as const;
        const normal=[view.getFloat32(h+28,true),view.getFloat32(h+32,true),view.getFloat32(h+36,true)] as const;
        const previous=hits[j-1];
        if(flags!==Number(q.kind<=2)||!Number.isFinite(fraction)||fraction<0||fraction>1||!point.every(Number.isFinite)||!normal.every(Number.isFinite)||
          triangleIndex< -1||childIndex< -1||token===0n||(token&0x1FFFFn)===0n||(token&0x1FFFFn)>65536n||(token>>17n)===0n||
          (previous&&(previous.fraction>fraction||(previous.fraction===fraction&&(previous.body.token>token||
            (previous.body.token===token&&(previous.triangleIndex>triangleIndex||(previous.triangleIndex===triangleIndex&&previous.childIndex>=childIndex)))))))) {
          throw new EngineError('INVALID_BACKEND','Native query returned an invalid or unordered hit.');
        }
        hits.push({body:this.wrapBody(token),point,normal,fraction,material:view.getBigUint64(h+8,true),triangleIndex,childIndex});
      }
      const common={totalHits:total,overflow:Boolean(overflow)},kind=QUERY_KINDS[q.kind];
      if(kind==='ray'||kind==='sphere-cast'||kind==='box-cast')output.push({...common,kind,hits});
      else output.push({...common,kind,hits:hits.map(hit=>({body:hit.body}))});
      offset+=q.limit;
    }
    return output;
  }

  createScene(scene: Pick<ScenePreset,'id'>, stressScale: number, seed: number): number {
    this.assertAlive();integer(scene?.id,'scene ID',0,799);finite(stressScale,'stress scale',1,5);integer(seed,'seed',0,0xFFFFFFFF);
    const count=this.mod._b3w_world_create_scene(this.handle,scene.id,stressScale,seed);
    if(count<0)throw new EngineError('DISPOSED','Native scene creation rejected this context.');
    this.jointOwner={};
    return count;
  }
  step(dt: number, subSteps: number): void {
    this.assertAlive();finite(dt,'fixed timestep',Number.MIN_VALUE,1/30);integer(subSteps,'substeps',1,16);
    this.accepted(this.mod._b3w_world_step(this.handle,dt,subSteps));
  }
  syncTransforms(): void { this.assertAlive();this.accepted(this.mod._b3w_world_sync_transforms(this.handle)); }
  applyImpulse(index: number, ix: number, iy: number, iz: number): void {
    this.assertAlive();integer(index,'body index',0,this.bodyCount()-1);
    finite(ix,'impulse x');finite(iy,'impulse y');finite(iz,'impulse z');
    this.accepted(this.mod._b3w_world_apply_impulse(this.handle,index,ix,iy,iz));
  }
  kick(strength: number): void {
    this.assertAlive();finite(strength,'kick strength',0);
    this.accepted(this.mod._b3w_world_kick_stack(this.handle,strength));
  }
  explode(x: number, y: number, z: number, strength: number, radius: number): void {
    this.assertAlive();finite(x,'center x');finite(y,'center y');finite(z,'center z');finite(strength,'strength',0);finite(radius,'radius',0);
    this.accepted(this.mod._b3w_world_explode(this.handle,x,y,z,strength,radius));
  }
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number {
    this.assertAlive();finite(x,'position x');finite(y,'position y');finite(z,'position z');
    finite(vx,'impulse x');finite(vy,'impulse y');finite(vz,'impulse z');finite(size,'half-size',Number.MIN_VALUE);
    return this.mod._b3w_world_launch_projectile(this.handle,x,y,z,vx,vy,vz,size);
  }
  spawnRain(count: number, spread: number, height: number): number {
    this.assertAlive();integer(count,'rain count',0,this.maxBodies);finite(spread,'spread',0);finite(height,'height');
    return count===0?0:this.mod._b3w_world_spawn_rain(this.handle,count,spread,height);
  }
  /** Empty this specimen while retaining its context, buffers and generation. */
  clear(): void { this.assertAlive();this.accepted(this.mod._b3w_world_clear(this.handle));this.jointOwner={}; }
  destroy(): void {
    if(this.disposed)return;
    this.disposed=true;
    try {
      if(this.scratch!==0){this.mod._free?.(this.scratch);this.scratch=0;}
      if(this.mod._b3w_world_valid(this.handle)===1)this.mod._b3w_world_destroy(this.handle);
    }
    finally{this.onDispose?.();}
  }
}

/** Owns only contexts it creates; the module's compatibility world and other pools survive. */
export class NativeWorldPool {
  readonly capacity: number;
  private readonly mod: NativeWorldModule;
  private readonly worlds=new Set<NativeWorldBackend>();
  private disposed=false;
  constructor(module: unknown) {
    assertNativeWorldModule(module);this.mod=module;this.capacity=module._b3w_world_capacity();
  }
  get size(): number { return this.worlds.size; }
  createWorld(): NativeWorldBackend {
    if(this.disposed)throw new EngineError('DISPOSED','This native world pool has been destroyed.');
    const world=new NativeWorldBackend(this.mod,()=>this.worlds.delete(world));this.worlds.add(world);return world;
  }
  destroy(): void {
    if(this.disposed)return;this.disposed=true;
    let failure:unknown;
    for(const world of this.worlds)try{world.destroy();}catch(error){failure??=error;}
    if(failure)throw failure;
  }
}
