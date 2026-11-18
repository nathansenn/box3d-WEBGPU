import type { PhysicsBackend } from '../types.ts';
import type { ScenePreset } from '../scenes.ts';
import { EngineError, finite as finiteNumber, integer, onlyKeys, record, showValue, RIGID_LIMITS } from './contracts.ts';

/** The version of the interface between this adapter and box3d.wasm. A module of another version is refused with UNSUPPORTED_BACKEND. */
export const NATIVE_WORLD_API_VERSION = 1;
const BODY_OWNER: unique symbol = Symbol('Box3D native body owner');
/** World-owned opaque reference. Not JSON checkpoint data or a dense row index. */
export interface NativeBodyHandle {
  readonly token: bigint;
  readonly [BODY_OWNER]: object;
}

export type NativeQueryVector = readonly [number, number, number];
/** Which bodies a spatial query considers: by type, by collision category and mask, and one body to ignore. */
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
  { readonly kind: 'box-overlap' | 'aabb-candidates'; readonly halfExtents: NativeQueryVector } |
  /** An upright capsule (axis along world Y; halfLength is half the distance between the cap centres), swept. Needs the rigid-core extension. */
  { readonly kind: 'capsule-cast'; readonly translation: NativeQueryVector; readonly radius: number; readonly halfLength: number } |
  { readonly kind: 'capsule-overlap'; readonly radius: number; readonly halfLength: number }
);
/** One body found by an overlap query. */
export interface NativeQueryBodyHit { readonly body: NativeBodyHandle }
/** One hit of a ray, sphere or box cast: the body, the point and normal in world space, the fraction of the translation at which it was hit, and for meshes and compounds the triangle and child shape. */
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
  { readonly kind: 'ray' | 'sphere-cast' | 'box-cast' | 'capsule-cast'; readonly hits: readonly NativeQueryCastHit[] } |
  { readonly kind: 'sphere-overlap' | 'box-overlap' | 'aabb-candidates' | 'capsule-overlap'; readonly hits: readonly NativeQueryBodyHit[] }
);

const QUERY_KINDS = ['ray','sphere-cast','box-cast','sphere-overlap','box-overlap','aabb-candidates','capsule-cast','capsule-overlap'] as const;
const QUERY_IS_CAST = [true,true,true,false,false,false,true,false] as const;
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

// The ten floats the bridge reads: mass, centre, Ixx, Iyy, Izz, Ixy, Ixz, Iyz.
function massDataValues(data: NativeMassData): number[] {
  if(!data||typeof data!=='object')throw new EngineError('INVALID_PAYLOAD','massData must be {mass, center?, inertia}.');
  const center=data.center??[0,0,0],inertia=data.inertia;
  if(!Array.isArray(inertia)||inertia.length!==6)throw new EngineError('INVALID_PAYLOAD','massData.inertia must be [Ixx, Iyy, Izz, Ixy, Ixz, Iyz].');
  if(!Array.isArray(center)||center.length!==3)throw new EngineError('INVALID_PAYLOAD','massData.center must be [x, y, z].');
  // The radius of gyration sqrt(I / m) must lie between 10 micrometres and the world extent: outside that the tensor
  // describes no body that fits the world, and the solver's products of inertia and angular velocity overflow.
  const mass=finite(data.mass,'mass',L.massMin,L.massMax),low=mass*1e-10,high=mass*L.extent*L.extent;
  const values=[mass,within(center[0],'centre of mass x',L.extent),within(center[1],'centre of mass y',L.extent),within(center[2],'centre of mass z',L.extent),
    finite(inertia[0],'Ixx',low,high),finite(inertia[1],'Iyy',low,high),finite(inertia[2],'Izz',low,high),within(inertia[3],'Ixy',high),within(inertia[4],'Ixz',high),within(inertia[5],'Iyz',high)];
  // The bridge's own test, on the float32 values it will hold, so that nothing is created and then refused.
  const [xx,yy,zz,xy,xz,yz]=values.slice(4).map(Math.fround) as [number,number,number,number,number,number],det=xx*(yy*zz-yz*yz)-xy*(xy*zz-yz*xz)+xz*(xy*yz-yy*xz);
  if(!(xx*yy-xy*xy>0)||!(det>0)||!(Math.fround(det)>0))throw new EngineError('INVALID_PAYLOAD','massData.inertia must be a positive-definite tensor that float32 can hold.');
  return values;
}

// The 14 floats of a motor joint's drive, in the bridge's order.
function driveList(drive: NativeJointDrive): number[] {
  plain(drive,'drive','{linearVelocity?, angularVelocity?, maxForce?, maxTorque?, linearSpring?, angularSpring?}');
  const lv=triple(drive.linearVelocity??[0,0,0],'drive.linearVelocity',-L.speed,L.speed),av=triple(drive.angularVelocity??[0,0,0],'drive.angularVelocity',-L.speed,L.speed);
  const spring=(value: unknown,label: string,cap: 'maxForce' | 'maxTorque'): number[]=>{
    if(value===undefined||value===null)return [0,0,0];
    const sp=plain(value as Record<string, unknown>,label,`{hertz, dampingRatio, ${cap}}`);
    return [finite(sp.hertz,`${label}.hertz`,0,L.hertz),finite(sp.dampingRatio,`${label}.dampingRatio`,0,L.hertz),finite(sp[cap],`${label}.${cap}`,0,L.force)];
  };
  return [...lv,...av,finite(drive.maxForce??0,'drive.maxForce',0,L.force),finite(drive.maxTorque??0,'drive.maxTorque',0,L.force),
    ...spring(drive.linearSpring,'drive.linearSpring','maxForce'),...spring(drive.angularSpring,'drive.angularSpring','maxTorque')];
}
function steeringList(steering: NativeJointSteering): number[] {
  plain(steering,'steering','{angle, hertz, dampingRatio, maxTorque, limits?}');
  const values=[finite(steering.angle,'steering.angle',-1e6,1e6),finite(steering.hertz,'steering.hertz',0,L.hertz),finite(steering.dampingRatio,'steering.dampingRatio',0,L.hertz),finite(steering.maxTorque,'steering.maxTorque',0,L.force)];
  steeringLimits(steering.limits,'steering.limits');
  return values;
}
function steeringLimits(limits: unknown,label: string): {lower: number; upper: number} | null {
  if(limits===undefined||limits===null)return null;
  const l=plain(limits as {lower: number; upper: number},label,'{lower, upper}');
  finite(l.lower,`${label}.lower`,-1e6,1e6);finite(l.upper,`${label}.upper`,l.lower,1e6);
  return l;
}
/** [force, torque, breakable] of a thresholds object; a breakable joint needs one of the two. */
function thresholdList(thresholds: NativeJointThresholds | null | undefined): [number, number, boolean] {
  if(thresholds!==undefined&&thresholds!==null)plain(thresholds,'thresholds','{force?, torque?, breakable?}');
  const force=finite(thresholds?.force??0,'thresholds.force',0,L.force),torque=finite(thresholds?.torque??0,'thresholds.torque',0,L.force),breakable=flag(thresholds?.breakable,'thresholds.breakable');
  if(breakable&&force===0&&torque===0)throw new EngineError('INVALID_PAYLOAD','A breakable joint needs a force or a torque threshold.',{path:'thresholds',value:showValue(thresholds),expected:'force or torque above 0'});
  return [force,torque,breakable];
}

/** A short key for checkpoint bytes: length and FNV-1a over every byte. */
function checkpointKey(bytes: Uint8Array): string {
  let h=0x811c9dc5;
  for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193);}
  return `${bytes.length}:${(h>>>0).toString(16)}`;
}
function finite(value: unknown, label: string, min=-Infinity, max=Infinity): number {
  const number=finiteNumber(value,label,min,max),converted=Math.fround(number);
  if(!Number.isFinite(converted)||(number!==0&&converted===0))throw new EngineError('INVALID_PAYLOAD',`${label} must fit a nonzero float32 value or be zero; got ${showValue(value)}. The rigid world holds single-precision numbers: use a magnitude between 1.2e-38 and 3.4e38, or 0.`,{path:label,value:showValue(value),expected:'a float32 value'});
  return number;
}

/**
 * Box3D's own sanity limit (B3_HUGE in box3d/constants.h): 100 km. Single-precision positions lose millimetres beyond
 * about 16 km, and Box3D treats a bounding box that reaches past 100 km as invalid; a shape that large makes the broad
 * phase loop without end. Positions, shape sizes and geometry are therefore refused beyond this distance from the origin.
 */
export const NATIVE_WORLD_EXTENT=RIGID_LIMITS.extent;
/** The largest magnitudes the rigid world takes: the same table as RIGID_LIMITS in contracts.ts, where each entry is explained. */
export const NATIVE_LIMITS=RIGID_LIMITS;
const L=NATIVE_LIMITS;
const within=(value: unknown,label: string,limit: number): number=>finite(value,label,-limit,limit);
/** A density in kg/m^3: zero, or large enough that the smallest shape still has a mass float32 can invert. */
function densityOf(value: unknown,label: string): number {
  const density=finite(value,label,0,L.density);
  if(density!==0&&density<L.densityMin)throw new EngineError('INVALID_PAYLOAD',`${label} must be 0 or within [${L.densityMin}, ${L.density}] kg/m^3; got ${showValue(value)}. Use 0 for a massless shape.`,{path:label,value:showValue(value),expected:`0 or a value within [${L.densityMin}, ${L.density}]`});
  return density;
}
const bad=(label: string,value: unknown,expected: string): never=>{throw new EngineError('INVALID_PAYLOAD',`${label} must be ${expected}; got ${showValue(value)}.`,{path:label,value:showValue(value),expected});};
const listOf=(value: unknown,length: number): value is ArrayLike<unknown>=>value!==null&&typeof value==='object'&&(Array.isArray(value)||ArrayBuffer.isView(value))&&(value as ArrayLike<unknown>).length===length;
/** Three finite float32 numbers, each within [min, max]. */
function triple(value: unknown,label: string,min=-Infinity,max=Infinity): [number, number, number] {
  if(!listOf(value,3))return bad(label,value,'[x, y, z]');
  return [finite(value[0],`${label} x`,min,max),finite(value[1],`${label} y`,min,max),finite(value[2],`${label} z`,min,max)];
}
/** A point in the world: three finite numbers within the world extent. */
const point3=(value: unknown,label: string): [number, number, number]=>triple(value,label,-NATIVE_WORLD_EXTENT,NATIVE_WORLD_EXTENT);
/** Four finite float32 numbers that are not all zero. The bridge normalizes them. */
function quaternion(value: unknown,label: string): [number, number, number, number] {
  if(!listOf(value,4))return bad(label,value,'a quaternion [x, y, z, w]');
  const q: [number, number, number, number]=[finite(value[0],`${label} x`,-1e6,1e6),finite(value[1],`${label} y`,-1e6,1e6),finite(value[2],`${label} z`,-1e6,1e6),finite(value[3],`${label} w`,-1e6,1e6)];
  if(!(Math.hypot(q[0],q[1],q[2],q[3])>1e-6))return bad(label,value,'a non-zero quaternion ([0, 0, 0, 1] is no rotation)');
  return q;
}
const plain=<T>(value: T,label: string,expected: string): NonNullable<T>=>value===null||value===undefined||typeof value!=='object'||Array.isArray(value)?bad(label,value,expected):value as NonNullable<T>;
const bits64=(value: unknown,label: string): bigint=>typeof value!=='bigint'||value<0n||value>0xFFFFFFFFFFFFFFFFn?bad(label,value,'an unsigned 64-bit bigint such as 0x1n'):value;
const flag=(value: unknown,label: string): boolean=>value===undefined||value===null?false:typeof value!=='boolean'?bad(label,value,'true or false'):value;

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
  /** Optional geometry shapes; all three exports must be present together, with the general-body extension. */
  _b3w_world_create_hull_body?(world: number, descriptor: number | bigint, points: number | bigint, count: number): bigint;
  _b3w_world_create_mesh_body?(world: number, descriptor: number | bigint, vertices: number | bigint, vertexCount: number, indices: number | bigint, triangleCount: number): bigint;
  _b3w_world_create_heightfield_body?(world: number, descriptor: number | bigint, heights: number | bigint, countX: number, countZ: number, sx: number, sy: number, sz: number): bigint;
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
  /** Optional: joint stiffness. Absent in artifacts built before it was added. */
  _b3w_world_joint_set_tuning?(world: number, joint: bigint, hertz: number, dampingRatio: number): number;
  _b3w_world_get_joint_state?(world: number, joint: bigint, out: number | bigint): number;
  _b3w_world_collect_events?(world: number): number;
  _b3w_world_events_ptr?(world: number): number | bigint;
  _b3w_world_event_total?(world: number): number;
  /** Optional compound shapes and explicit mass data; all four exports must be present together, with the general-body extension. */
  _b3w_world_create_compound_body?(world: number, descriptor: number | bigint, shapes: number | bigint, count: number, points: number | bigint, pointCount: number): bigint;
  _b3w_world_set_body_mass_data?(world: number, body: bigint, values: number | bigint): number;
  _b3w_world_get_body_mass_data?(world: number, body: bigint, out: number | bigint): number;
  _b3w_world_reset_body_mass_data?(world: number, body: bigint): number;
  /** Optional rigid-core extension (joint values and events, batched rays, the capsule mover, world and body
   * controls, Box3D's explosion, step profile, contact statistics, debug-draw lines); all fourteen exports must be present together,
   * with the general-body extension. */
  _b3w_world_joint_set_values?(world: number, joint: bigint, what: number, values: number | bigint, count: number): number;
  _b3w_world_joint_get_values?(world: number, joint: bigint, out: number | bigint): number;
  _b3w_world_cast_rays?(world: number, rays: number | bigint, count: number, categoryBits: bigint, maskBits: bigint, bodyTypes: number, ignoreBody: bigint, outHits: number | bigint, outBodies: number | bigint): number;
  _b3w_world_mover_move?(world: number, input: number | bigint, output: number | bigint): number;
  _b3w_world_set_param?(world: number, id: number, a: number, b: number, c: number): number;
  _b3w_world_get_params?(world: number, out: number | bigint): number;
  _b3w_world_set_body_flag?(world: number, body: bigint, what: number, value: number): number;
  _b3w_world_get_body_flags?(world: number, body: bigint, out: number | bigint): number;
  _b3w_world_explode_area?(world: number, x: number, y: number, z: number, radius: number, falloff: number, impulsePerArea: number, maskBits: bigint): number;
  _b3w_world_profile?(world: number, outProfile: number | bigint, outCounters: number | bigint): number;
  _b3w_world_contact_stats?(world: number, out: number | bigint): number;
  _b3w_world_debug_draw?(world: number, flags: number, jointScale: number, forceScale: number, bounds: number | bigint): number;
  _b3w_world_debug_ptr?(world: number): number | bigint;
  _b3w_world_debug_total?(world: number): number;
  /** Optional: bodies the bridge has contained after a diverged step since the context was made (ND-2). */
  _b3w_world_contained_total?(world: number): number;
  /** Optional exact checkpoints; all four exports must be present together. */
  _b3w_world_checkpoint?(world: number): number;
  _b3w_world_checkpoint_ptr?(world: number): number | bigint;
  _b3w_world_checkpoint_free?(world: number): number;
  _b3w_world_restore?(world: number, data: number | bigint, size: number): number;
  /** Optional: restore taking the checkpoint's own handle table (ND-3). */
  _b3w_world_restore_ex?(world: number, data: number | bigint, size: number, takeHandles: number): number;
}

const GENERAL_EXPORTS = ['reset','set_gravity','get_gravity','create_body','copy_body_kinds','get_body_state','set_body_transform',
  'set_body_velocity','set_body_target','set_body_type','set_body_awake','set_body_gravity_scale','set_body_damping','set_body_filter',
  'apply_body','apply_body_at','create_joint','joint_valid','destroy_joint','joint_set_motor','joint_set_limits','joint_set_spring',
  'joint_set_steering','get_joint_state','collect_events','events_ptr','event_total'] as const;

const RIGID_EXPORTS = ['joint_set_values','joint_get_values','cast_rays','mover_move','set_param','get_params','set_body_flag','get_body_flags',
  'explode_area','profile','contact_stats','debug_draw','debug_ptr','debug_total'] as const;

const JOINT_OWNER: unique symbol = Symbol('Box3D native joint owner');
/** World-owned opaque joint reference. A joint dies with either of its bodies. */
export interface NativeJointHandle {
  readonly token: bigint;
  readonly [JOINT_OWNER]: object;
}
/** A rotation as a quaternion [x, y, z, w]; the bridge normalizes it. */
export type NativeQuaternion = readonly [number, number, number, number];
/** The shapes a compound body may hold: the convex ones. */
export type NativeConvexShape =
  { readonly kind: 'box'; readonly halfExtents: NativeQueryVector } |
  { readonly kind: 'sphere'; readonly radius: number } |
  { readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number } |
  { readonly kind: 'hull'; readonly points: ArrayLike<number> };
/** One shape of a compound body, placed in the body's frame. */
export interface NativeCompoundChild {
  readonly shape: NativeConvexShape;
  /** The shape's origin in the body frame. Default [0, 0, 0]. */
  readonly position?: NativeQueryVector;
  /** The shape's orientation in the body frame, [x, y, z, w]. Default identity. A capsule's axis is the shape's local Y. */
  readonly rotation?: NativeQuaternion;
  /** kg/m^3. Default: the body's. Zero gives a shape that collides and adds no mass. */
  readonly density?: number;
  /** Default: the body's. */
  readonly friction?: number;
  /** Default: the body's. */
  readonly restitution?: number;
}
/** Most shapes one compound body may hold. */
export const NATIVE_COMPOUND_LIMIT = 64;
/**
 * Mass, centre of mass and inertia of a body. `center` is in the body frame. `inertia` is the
 * tensor about the centre of mass in body axes, as [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2 (the
 * matrix entries, so a product of inertia is minus the integral of x y dm).
 */
export interface NativeMassData {
  readonly mass: number;
  readonly center?: NativeQueryVector;
  readonly inertia: readonly [number, number, number, number, number, number];
}
/** Mass, centre of mass (body frame) and inertia tensor about it, as the solver holds them. */
export interface NativeBodyMassState {
  mass: number;
  center: [number, number, number];
  inertia: [number, number, number, number, number, number];
  /** True when the values were set with setBodyMassData (or `massData`), false when they come from the shapes. */
  explicit: boolean;
  /** Shapes on the body: 1, or the number of children of a compound. */
  shapeCount: number;
}
/** A body's shape as the native world takes it: boxes, spheres, capsules, hulls, compounds, triangle meshes and height fields, with flat number arrays. */
export type NativeBodyShape =
  { readonly kind: 'box'; readonly halfExtents: NativeQueryVector } |
  { readonly kind: 'sphere'; readonly radius: number } |
  /** The capsule axis is the body's local Y; halfLength excludes the round caps. */
  { readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number } |
  /** Convex hull of 4..4096 body-local points (x, y, z, x, y, z, ...). Box3D keeps at most 64 hull vertices. */
  { readonly kind: 'hull'; readonly points: ArrayLike<number> } |
  /**
   * 1..64 convex shapes on one body, each at its own pose in the body frame with its own density,
   * friction and restitution. The body's mass, centre of mass and inertia are the sum over the
   * shapes (parallel-axis theorem); overlapping shapes count twice. The body's position is the
   * origin of that frame, which need not be the centre of mass.
   */
  { readonly kind: 'compound'; readonly shapes: readonly NativeCompoundChild[] } |
  /** Static triangle mesh, body-local: vertices (x, y, z, ...) and counter-clockwise index triples. Always a static body. */
  { readonly kind: 'mesh'; readonly vertices: ArrayLike<number>; readonly indices: ArrayLike<number> } |
  /** Static terrain: countX by countZ heights (index x + z * countX) on a grid of spacing[0] by spacing[1]
   * metres, starting at the body position and extending along +x and +z. Always a static body.
   */
  { readonly kind: 'heightfield'; readonly heights: ArrayLike<number>; readonly countX: number; readonly countZ: number; readonly spacing: readonly [number, number] };
/** The shape kind of a body: 'box', 'sphere', 'capsule', 'hull', 'mesh', 'heightfield' or 'compound'. */
export type NativeBodyKind = 'box' | 'sphere' | 'capsule' | 'hull' | 'mesh' | 'heightfield' | 'compound';
/** 'static', 'kinematic' or 'dynamic'. */
export type NativeBodyType = 'static' | 'kinematic' | 'dynamic';
/** Everything createBody() takes, with vectors as plain tuples: the shape, type, pose, velocities, material, flags, damping, gravity scale, collision filter and optional mass data. Values must lie within RIGID_LIMITS. */
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
  /**
   * Mass, centre of mass and inertia tensor to use instead of the ones the shape and density give
   * (setBodyMassData). They act while the body is dynamic.
   */
  readonly massData?: NativeMassData;
}
/** A body's pose, velocities, mass, sleep state and type, read from the solver. */
export interface NativeBodyState {
  position: [number, number, number];
  rotation: [number, number, number, number];
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  mass: number;
  awake: boolean;
  type: NativeBodyType;
}
/** 'weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel', 'motor', 'parallel' or 'filter'. */
export type NativeJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel' | 'motor' | 'parallel' | 'filter';
/** What a motor joint does: hold a relative velocity with a bounded force, and/or pull frame B onto frame A with bounded springs. */
export interface NativeJointDrive {
  /** Wanted velocity of body B relative to body A, in frame A (m/s). Default [0, 0, 0]. */
  readonly linearVelocity?: NativeQueryVector;
  /** Wanted angular velocity of body B relative to body A (rad/s). Default [0, 0, 0]. */
  readonly angularVelocity?: NativeQueryVector;
  /** Largest force the velocity drive may use (N). Default 0: no linear velocity drive. */
  readonly maxForce?: number;
  /** Largest torque the velocity drive may use (N m). Default 0: no angular velocity drive. */
  readonly maxTorque?: number;
  /** Spring that pulls frame B's origin onto frame A's. */
  readonly linearSpring?: { readonly hertz: number; readonly dampingRatio: number; readonly maxForce: number };
  /** Spring that turns frame B onto frame A. */
  readonly angularSpring?: { readonly hertz: number; readonly dampingRatio: number; readonly maxTorque: number };
}
/** A joint reports a 'joint-overload' event in every step in which its constraint force or torque is at or above a
 * threshold; with `breakable` it is destroyed at the end of that step and reports 'joint-break' instead.
 */
export interface NativeJointThresholds {
  /** Constraint force in newtons. Omit or 0 for none. */
  readonly force?: number;
  /** Constraint torque in newton metres. Omit or 0 for none. */
  readonly torque?: number;
  readonly breakable?: boolean;
}
/** Wheel steering: a spring that turns frame A about its x axis towards `angle` (rad) with at most `maxTorque` (N m), optionally limited. */
export interface NativeJointSteering { readonly angle: number; readonly hertz: number; readonly dampingRatio: number; readonly maxTorque: number; readonly limits?: { readonly lower: number; readonly upper: number } }
/** A joint frame in a body's own coordinates: position and rotation, both optional. */
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
  /** How stiffly the joint holds its bodies together. Default 60 Hz with damping ratio 2. */
  readonly stiffness?: { readonly hertz: number; readonly dampingRatio?: number };
  /** Force and torque thresholds for joint events, and breaking. Needs the rigid-core extension. */
  readonly thresholds?: NativeJointThresholds;
  /** Motor joints: the drive. Without it the joint does nothing until setJointDrive. */
  readonly drive?: NativeJointDrive;
  /** Parallel joints: the largest torque the spring may use (N m). */
  readonly maxTorque?: number;
  /** Wheel joints: steer about frame A's x axis. */
  readonly steering?: NativeJointSteering;
}
/** Everything the solver holds about one joint. Fields that do not apply to the joint's type are absent. */
export interface NativeJointDetails {
  type: NativeJointType;
  /** How far the joint is from holding its bodies together: metres and radians. */
  linearSeparation: number;
  angularSeparation: number;
  /** 0 when there is none. */
  forceThreshold: number;
  torqueThreshold: number;
  breakable: boolean;
  stiffness: { hertz: number; dampingRatio: number };
  /** Revolute: angle (rad). Spherical: twist angle. */
  angle?: number;
  /** Revolute, prismatic, distance: the motor's torque or force in the last step. Spherical: its torque vector. */
  motorForce?: number;
  motorTorque?: [number, number, number];
  motorSpeed?: number;
  lowerLimit?: number;
  upperLimit?: number;
  /** Prismatic: travel (m) and its rate (m/s). */
  translation?: number;
  speed?: number;
  /** Distance: current and rest length (m). */
  length?: number;
  restLength?: number;
  /** Spherical: the swing angle now and its limit (rad). */
  coneAngle?: number;
  coneLimit?: number;
  /** Wheel. */
  spinSpeed?: number;
  spinTorque?: number;
  steeringAngle?: number;
  steeringTorque?: number;
  targetSteeringAngle?: number;
  /** Wheel: suspension travel along frame A's x axis (m). */
  suspension?: number;
  /** Motor. */
  linearVelocity?: [number, number, number];
  angularVelocity?: [number, number, number];
  /** Parallel. */
  springHertz?: number;
  springDampingRatio?: number;
  maxTorque?: number;
}
/** A joint's type, its angle, travel or length, and the force and torque it carries. */
export interface NativeJointState {
  type: NativeJointType;
  /** Revolute angle, prismatic translation or distance length; 0 for the others. */
  value: number;
  force: [number, number, number];
  torque: [number, number, number];
}
/** A contact or sensor event of the most recent step. `point`, `normal` and `approachSpeed` are present on 'hit' events. */
export interface NativeWorldEvent {
  readonly kind: 'contact-begin' | 'contact-end' | 'hit' | 'sensor-begin' | 'sensor-end' | 'joint-overload' | 'joint-break' | 'body-contained';
  /** Null when the body no longer exists. For sensor events A is the sensor and B the visitor; for joint events they
   * are the joint's bodies, null for the fixed world. */
  readonly bodyA: NativeBodyHandle | null;
  readonly bodyB: NativeBodyHandle | null;
  /** Joint events only: the joint (already destroyed for 'joint-break'), and the force (N) and torque (N m) it carried. */
  readonly joint?: NativeJointHandle;
  readonly force?: NativeQueryVector;
  readonly torque?: NativeQueryVector;
  /** Hits only. */
  readonly point?: NativeQueryVector;
  readonly normal?: NativeQueryVector;
  readonly approachSpeed?: number;
  /**
   * 'body-contained' only: the speed (m/s or rad/s, the larger) the body had reached, NaN when its state was not finite.
   * The step diverged for this body (joints that contradict each other can do that inside Box3D), so the bridge put it
   * back at its pose of the step before, at rest, and the next step runs without warm starting. bodyA is the body.
   */
  readonly speed?: number;
}
const BODY_KINDS = ['box','sphere','capsule','hull','mesh','heightfield','compound'] as const;
const SHAPE_DESC_BYTES=80;
const BODY_TYPES = ['static','kinematic','dynamic'] as const;
const JOINT_TYPES = ['weld','revolute','spherical','prismatic','distance','wheel','motor','parallel','filter'] as const;
/** Two 32-bit FNV-style hashes and the length of a checkpoint: enough to recognise one this world wrote. */
function checkpointDigest(bytes: Uint8Array): string {
  let a=0x811c9dc5,b=0x01000193^0x5bd1e995;
  for(let i=0;i<bytes.length;i++){const v=bytes[i]!;a=Math.imul(a^v,0x01000193);b=Math.imul(b^v,0x5bd1e995)^(b>>>15);}
  return `${bytes.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}
const EVENT_KINDS = ['contact-begin','contact-end','hit','sensor-begin','sensor-end','joint-overload','joint-break','body-contained'] as const;

/** One batch of closest-hit rays. Arrays are indexed by ray; a miss has fraction -1 and a null body. */
export interface NativeRayBatch {
  readonly count: number;
  readonly hitCount: number;
  /** Fraction of the translation at the hit, or -1. */
  readonly fractions: Float32Array;
  /** x, y, z per ray. */
  readonly points: Float32Array;
  readonly normals: Float32Array;
  /** Triangle index for mesh and height-field hits, else -1. */
  readonly triangles: Int32Array;
  readonly bodies: (NativeBodyHandle | null)[];
}
/** An upright capsule to move with Box3D's character mover, and which bodies it collides with. */
export interface NativeMoverInput {
  /** Centre of the upright capsule. */
  readonly position: NativeQueryVector;
  readonly radius: number;
  /** Half the distance between the cap centres. */
  readonly halfLength: number;
  /** Wanted translation. */
  readonly translation: NativeQueryVector;
  /** Planes steeper than this slope act as vertical walls: pass cos(maxSlope). Omit to slide on every plane. */
  readonly wallBelowNormalY?: number;
  /** Rounds of collide, solve and cast, 1..16. Default 5. */
  readonly iterations?: number;
  /** Stop when a round moves less than this (m). Default 0.01. */
  readonly tolerance?: number;
  readonly bodies?: { readonly static?: boolean; readonly kinematic?: boolean; readonly dynamic?: boolean };
  readonly categoryBits?: bigint;
  readonly maskBits?: bigint;
  readonly ignoreBody?: NativeBodyHandle;
}
/** A collision plane the character mover found around the capsule. */
export interface NativeMoverPlane {
  /** Unit normal pointing from the shape towards the capsule. */
  readonly normal: NativeQueryVector;
  /** Closest point on the shape, world space. */
  readonly point: NativeQueryVector;
  /** How far the solver pushed the capsule along the normal (m); 0 when the plane did not constrain the move. */
  readonly push: number;
  readonly body: NativeBodyHandle;
  readonly bodyType: NativeBodyType;
  /** True when the plane was treated as a vertical wall (wallBelowNormalY). */
  readonly wall: boolean;
}
/** The capsule's final position, the planes around it and the number of rounds the mover ran. */
export interface NativeMoverResult {
  readonly position: [number, number, number];
  /** Collision planes around the capsule at the start of the last round. At most 16. */
  readonly planes: NativeMoverPlane[];
  readonly iterations: number;
}
/** World-wide solver settings. Every one is part of a checkpoint. */
export interface NativeWorldSettings {
  /** Bodies at rest stop being simulated. Default true. */
  sleeping: boolean;
  /** Continuous collision of dynamic bodies against static ones (and of bullets against everything). Default true. */
  continuous: boolean;
  /** Contacts are created a margin before shapes touch. Default true. Box3D marks switching it off as a test feature. */
  speculative: boolean;
  /** Start each solve from the previous step's impulses. Default true; off costs stability. */
  warmStarting: boolean;
  /** Approach speed below which restitution is ignored (m/s). Default 1. */
  restitutionThreshold: number;
  /** Approach speed above which a 'hit' event is reported (m/s). Default 1. */
  hitEventThreshold: number;
  /** Contact stiffness (Hz; capped at one eighth of the sub-step rate), damping ratio, and the largest speed at
   * which overlap is pushed out (m/s). Defaults 30, 10, 3. */
  contactHertz: number;
  contactDampingRatio: number;
  contactPushSpeed: number;
  /** Speed limit of every body (m/s). Default 400. */
  maximumLinearSpeed: number;
  /** Contact points closer than this to their place in the previous step keep their impulses (m). */
  contactRecycleDistance: number;
}
/** A body's bullet flag, sleep settings and motion locks (the rigid-core extension). */
export interface NativeBodyFlags {
  bullet: boolean;
  sleepEnabled: boolean;
  /** Speed below which the body may fall asleep (m/s). */
  sleepThreshold: number;
  locks: { linearX: boolean; linearY: boolean; linearZ: boolean; angularX: boolean; angularY: boolean; angularZ: boolean };
}
const PROFILE_STAGES = ['step','pairs','collide','solve','solverSetup','constraints','prepareConstraints','integrateVelocities','warmStart','solveImpulses',
  'integratePositions','relaxImpulses','applyRestitution','storeImpulses','splitIslands','transforms','sensorHits','jointEvents','hitEvents','refit',
  'bullets','sleepIslands','sensors'] as const;
const PROFILE_COUNTERS = ['bodies','shapes','contacts','joints','islands','stackBytes','arenaBytes','staticTreeHeight','treeHeight','satCalls','satCacheHits',
  'allocatedBytes','tasks','awakeContacts','recycledContacts','awakeBodies'] as const;
/** A stage of Box3D's step that profile() times, in milliseconds. */
export type NativeProfileStage = typeof PROFILE_STAGES[number];
/** A size profile() reports for the most recent step: counts of bodies, contacts and the like, and memory in bytes. */
export type NativeProfileCounter = typeof PROFILE_COUNTERS[number];
/** Box3D's own timing of the most recent step, by stage (milliseconds), and the sizes it worked on. */
export interface NativeStepProfile {
  readonly milliseconds: Readonly<Record<NativeProfileStage, number>>;
  readonly counters: Readonly<Record<NativeProfileCounter, number>>;
}
/** What the solver's contact manifolds hold right now. */
export interface NativeContactStats {
  /** Pairs of shapes that touch. */
  pairs: number;
  /** Contact points in their manifolds. */
  points: number;
  /** Deepest overlap of any contact point (m); 0 when nothing overlaps. Resting contacts sit near Box3D's linear slop (5 mm). */
  deepestPenetration: number;
  /** Mean overlap of the overlapping points (m). */
  meanPenetration: number;
  /** Largest normal impulse one contact point applied in the last sub-step (N s). */
  largestImpulse: number;
  /** Sum of the normal impulses of the last sub-step (N s). Divided by the sub-step length it is the total normal force. */
  totalImpulse: number;
}
/** Layers and scales for Box3D's debug drawing; every switch defaults to off. */
export interface NativeDebugDrawOptions {
  readonly joints?: boolean;
  /** Joint frames and limits. */
  readonly jointExtras?: boolean;
  /** Axis-aligned bounds of every shape. */
  readonly bounds?: boolean;
  /** Centres of mass, with body axes. */
  readonly mass?: boolean;
  readonly contacts?: boolean;
  readonly contactNormals?: boolean;
  readonly contactForces?: boolean;
  readonly frictionForces?: boolean;
  readonly islands?: boolean;
  /** Colour contact points by the solver colour of their constraint. */
  readonly graphColors?: boolean;
  /** Length scale of joint drawings (m). Default 1. */
  readonly jointScale?: number;
  /** Metres drawn per newton for force arrows. */
  readonly forceScale?: number;
  /** Draw only what lies in this box. */
  readonly region?: { readonly min: NativeQueryVector; readonly max: NativeQueryVector };
}
/** Line segments: vertex pairs. `positions` holds x, y, z per vertex and `colors` r, g, b in 0..1. */
export interface NativeDebugLines {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly vertexCount: number;
  /** True when the world had more than 1,048,576 vertices to draw and the rest were dropped. */
  readonly truncated: boolean;
}
const DEBUG_FLAGS: readonly (keyof NativeDebugDrawOptions)[] = ['joints','jointExtras','bounds','mass','contacts','contactNormals','contactForces','frictionForces','islands','graphColors'];

/** How many bodies a world's buffers hold now, how far they can grow, and the generation of the buffers (views must be re-read when it changes). */
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
  const compoundExports=[mod._b3w_world_create_compound_body,mod._b3w_world_set_body_mass_data,mod._b3w_world_get_body_mass_data,mod._b3w_world_reset_body_mass_data];
  if(compoundExports.some(value=>value!==undefined)&&(!compoundExports.every(value=>typeof value==='function')||!generalExports.every(value=>typeof value==='function'))) {
    throw new EngineError('UNSUPPORTED_BACKEND','The native compound-shape and mass-data extension requires all four of its exports and the general-body extension.');
  }
  const rigidExports=RIGID_EXPORTS.map(name=>mod[`_b3w_world_${name}`]);
  if(rigidExports.some(value=>value!==undefined)&&(!rigidExports.every(value=>typeof value==='function')||!generalExports.every(value=>typeof value==='function'))) {
    throw new EngineError('UNSUPPORTED_BACKEND','The native rigid-core extension requires all fourteen of its exports and the general-body extension.');
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
  // Content digests of the checkpoints this world wrote since it was last reset, at most 256, the one written or restored
  // most recently last. Restoring one of them takes its own handle table, so that every handle means what it meant when it
  // was written (ND-3).
  private ownCheckpoints: string[]=[];
  private rememberCheckpoint(digest: string): void {
    const at=this.ownCheckpoints.indexOf(digest);
    if(at>=0)this.ownCheckpoints.splice(at,1);
    this.ownCheckpoints.push(digest);
    if(this.ownCheckpoints.length>256)this.ownCheckpoints.shift();
  }
  // One 128-byte scratch block for descriptors and small outputs, allocated on first use.
  private scratch=0;
  // One 1024-byte block for the mover and the step profile, allocated on first use.
  private wideScratch=0;
  // Shape kinds last read from the bridge, keyed by shapeVersion() and the body count.
  private kindRows: Uint8Array | null=null;
  private kindRowsVersion=-1;
  private kindRowsCount=-1;
  // Geometry of hull, mesh and height-field bodies by token, kept only after retainBodyShapes(true).
  private retainedShapes: Map<bigint, NativeBodyShape> | null=null;
  // Bodies whose convex shapes reach beyond RIGID_LIMITS.shape (static or kinematic only): setBodyType refuses to make
  // them dynamic. Checkpoints made here remember them by row, keyed by a hash of the bytes (largeRowsByCheckpoint).
  private readonly largeConvex=new Set<bigint>();
  private readonly largeRowsByCheckpoint=new Map<string, number[]>();

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
    this.retainedShapes?.delete(token);this.largeConvex.delete(token);
    return true;
  }
  applyBodyImpulse(body: NativeBodyHandle,x: number,y: number,z: number): void {
    const token=this.bodyToken(body);within(x,'impulse x',L.force);within(y,'impulse y',L.force);within(z,'impulse z',L.force);
    const status=this.mod._b3w_world_apply_body_impulse!(this.handle,token,x,y,z);
    if(status===0)throw new EngineError('STALE_BODY','This native body has been destroyed or belongs to a previous scene.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected the body impulse.');
  }
  launchProjectileBody(x: number,y: number,z: number,vx: number,vy: number,vz: number,size: number): NativeBodyHandle | null {
    this.requireBodyLifecycle();point3([x,y,z],'position');
    within(vx,'impulse x',L.force);within(vy,'impulse y',L.force);within(vz,'impulse z',L.force);finite(size,'half-size',Number.MIN_VALUE,L.shape);
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
    plain(options,'reset options','{seed?, ground?, gravity?}');
    const seed=integer(options.seed??1,'seed',0,0xFFFFFFFF),g=triple(options.gravity??[0,-9.81,0],'gravity',-L.gravity,L.gravity),ground=flag(options.ground??true,'ground');
    this.accepted(this.mod._b3w_world_reset!(this.handle,seed,ground?1:0,g[0],g[1],g[2]));
    this.jointOwner={};this.retainedShapes?.clear();this.largeConvex.clear();this.ownCheckpoints=[];
  }
  setGravity(x: number,y: number,z: number): void {
    this.general();within(x,'gravity x',L.gravity);within(y,'gravity y',L.gravity);within(z,'gravity z',L.gravity);
    this.accepted(this.mod._b3w_world_set_gravity!(this.handle,x,y,z));
  }
  gravity(): [number, number, number] {
    const view=this.general();
    this.accepted(this.mod._b3w_world_get_gravity!(this.handle,this.scratch));
    return [view.getFloat32(0,true),view.getFloat32(4,true),view.getFloat32(8,true)];
  }

  /** Create a body. Returns null when the world is at body capacity. */
  createBody(descriptor: NativeBodyDescriptor): NativeBodyHandle | null {
    const view=this.general();
    plain(descriptor,'body options','{shape, position, ...}');
    const shape=descriptor.shape,kind=shape!==null&&typeof shape==='object'?BODY_KINDS.indexOf(shape.kind):-1,type=BODY_TYPES.indexOf(descriptor.type??'dynamic');
    if(kind<0)throw new EngineError('INVALID_PAYLOAD',`shape.kind must be 'box', 'sphere', 'capsule', 'hull', 'mesh', 'heightfield' or 'compound'; got ${showValue((shape as {kind?: unknown} | null | undefined)?.kind??shape)}.`);
    if(kind>=3&&typeof this.mod._b3w_world_create_hull_body!=='function')throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks hull, mesh and height-field shapes; rebuild with npm run build:wasm.');
    if((shape.kind==='compound'||descriptor.massData!==undefined)&&!this.supportsCompoundBodies)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks compound shapes and explicit mass data; rebuild with npm run build:wasm.');
    if(type<0)throw new EngineError('INVALID_PAYLOAD',`type must be 'static', 'kinematic' or 'dynamic'; got ${showValue(descriptor.type)}.`);
    const E=NATIVE_WORLD_EXTENT;
    // A dynamic body's convex shapes stop at RIGID_LIMITS.shape (native defect ND-1: Box3D's step does not return for a
    // dynamic box of about 1.5 km resting on something); static and kinematic bodies step normally up to the extent.
    const reach=BODY_TYPES[type]==='dynamic'?L.shape:E;
    const size: [number, number, number]=shape.kind==='box'?triple(shape.halfExtents,'half extent',1e-4,reach):
      shape.kind==='sphere'?[finite(shape.radius,'radius',1e-4,reach),0,0]:shape.kind==='capsule'?[finite(shape.radius,'radius',1e-4,reach),finite(shape.halfLength,'capsule half length',0.0025,reach),0]:[1,1,1];
    // Validate caller geometry completely before anything is written to the heap.
    let floats: Float32Array | null=null,ints: Int32Array | null=null;
    const density=densityOf(descriptor.density??1000,'density'),friction=finite(descriptor.friction??0.6,'friction',0,1e6),restitution=finite(descriptor.restitution??0,'restitution',0,1e6);
    const children=shape.kind==='compound'?this.compoundChildren(shape.shapes,density,friction,restitution,reach):null;
    const massValues=descriptor.massData===undefined?null:massDataValues(descriptor.massData);
    if(shape.kind==='hull') {
      integer(shape.points?.length,'hull point values',12,4096*3);
      if(shape.points.length%3!==0)throw new EngineError('INVALID_PAYLOAD','hull points must be x, y, z triples.');
      floats=Float32Array.from(shape.points,(v,i)=>finite(v,`hull point value ${i}`,-reach,reach));
    }else if(shape.kind==='mesh') {
      integer(shape.vertices?.length,'mesh vertex values',9,1048576*3);integer(shape.indices?.length,'mesh index count',3,2097152*3);
      if(shape.vertices.length%3!==0||shape.indices.length%3!==0)throw new EngineError('INVALID_PAYLOAD','mesh vertices and indices must come in triples.');
      floats=Float32Array.from(shape.vertices,(v,i)=>finite(v,`mesh vertex value ${i}`,-E,E));
      const vertexCount=floats.length/3;
      ints=Int32Array.from(shape.indices,(v,i)=>integer(v,`mesh index ${i}`,0,vertexCount-1));
    }else if(shape.kind==='heightfield') {
      integer(shape.countX,'height-field countX',2,4096);integer(shape.countZ,'height-field countZ',2,4096);
      if(shape.heights===null||typeof shape.heights!=='object'||shape.heights.length!==shape.countX*shape.countZ)throw new EngineError('INVALID_PAYLOAD',`heights must hold countX * countZ = ${shape.countX*shape.countZ} values; got ${showValue(shape.heights)}.`);
      if(!listOf(shape.spacing,2))bad('height-field spacing',shape.spacing,'[dx, dz]');
      finite(shape.spacing[0],'height-field x spacing',1e-4,E/shape.countX);finite(shape.spacing[1],'height-field z spacing',1e-4,E/shape.countZ);
      floats=Float32Array.from(shape.heights,(v,i)=>finite(v,`height ${i}`,-E,E));
    }
    const position=point3(descriptor.position??[0,0,0],'position'),rotation=quaternion(descriptor.rotation??[0,0,0,1],'rotation');
    const linear=triple(descriptor.linearVelocity??[0,0,0],'linear velocity',-L.speed,L.speed),angular=triple(descriptor.angularVelocity??[0,0,0],'angular velocity',-L.speed,L.speed);
    const filter=descriptor.filter===undefined||descriptor.filter===null?undefined:plain(descriptor.filter,'filter','{categoryBits?, maskBits?, groupIndex?}');
    if(filter&&(filter.categoryBits===undefined)!==(filter.maskBits===undefined))throw new EngineError('INVALID_PAYLOAD','filter needs both categoryBits and maskBits, or neither.');
    if(filter?.categoryBits!==undefined){bits64(filter.categoryBits,'filter.categoryBits');bits64(filter.maskBits,'filter.maskBits');}
    const flags=(flag(descriptor.bullet,'bullet')?1:0)|(flag(descriptor.sensor,'sensor')?2:0)|(flag(descriptor.hitEvents,'hitEvents')?4:0)|(flag(descriptor.neverSleeps,'neverSleeps')?8:0)|(flag(descriptor.lockRotation,'lockRotation')?16:0);
    const color=integer(descriptor.color??0xB8C0CC,'color',0,0xFFFFFFFF),linearDamping=finite(descriptor.linearDamping??0,'linear damping',0,L.hertz),angularDamping=finite(descriptor.angularDamping??0,'angular damping',0,L.hertz);
    const gravityScale=within(descriptor.gravityScale??1,'gravity scale',L.gravity),groupIndex=integer(filter?.groupIndex??0,'filter group',-0x80000000,0x7FFFFFFF);
    for(let i=0;i<128;i+=4)view.setUint32(i,0,true);
    view.setUint32(0,kind,true);view.setUint32(4,type,true);
    for(let i=0;i<3;i++){view.setFloat32(8+i*4,position[i],true);view.setFloat32(36+i*4,linear[i],true);view.setFloat32(48+i*4,angular[i],true);view.setFloat32(60+i*4,size[i],true);}
    for(let i=0;i<4;i++)view.setFloat32(20+i*4,rotation[i],true);
    view.setFloat32(72,density,true);
    view.setFloat32(76,friction,true);
    view.setFloat32(80,restitution,true);
    view.setUint32(84,color,true);
    view.setUint32(88,flags,true);
    view.setFloat32(92,linearDamping,true);
    view.setFloat32(96,angularDamping,true);
    view.setFloat32(100,gravityScale===0?0:gravityScale,true);
    view.setBigUint64(104,BigInt.asUintN(64,filter?.categoryBits??0n),true);view.setBigUint64(112,BigInt.asUintN(64,filter?.maskBits??0n),true);
    view.setInt32(120,groupIndex,true);
    const full=this.bodyCount()>=this.maxBodies;
    let token: bigint;
    if(children!==null) {
      // One block holds the child descriptors, then every hull child's points. malloc may grow the heap, so views are taken after it.
      const pointFloats=children.reduce((sum,child)=>sum+(child.points?.length??0),0),bytes=children.length*SHAPE_DESC_BYTES+pointFloats*4,pointer=Number(this.mod._malloc!(bytes));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%4!==0)throw new EngineError('ALLOCATION_FAILED','Native geometry allocation failed.');
      try {
        const block=new DataView(this.mod.HEAPF32.buffer,pointer,bytes),points=new Float32Array(this.mod.HEAPF32.buffer,pointer+children.length*SHAPE_DESC_BYTES,pointFloats);
        let offset=0;
        children.forEach((child,index)=>{
          const at=index*SHAPE_DESC_BYTES;
          for(let i=0;i<SHAPE_DESC_BYTES;i+=4)block.setUint32(at+i,0,true);
          block.setUint32(at,child.kind,true);
          for(let i=0;i<3;i++){block.setFloat32(at+8+i*4,child.position[i],true);block.setFloat32(at+36+i*4,child.size[i],true);}
          for(let i=0;i<4;i++)block.setFloat32(at+20+i*4,child.rotation[i],true);
          block.setFloat32(at+48,child.density,true);block.setFloat32(at+52,child.friction,true);block.setFloat32(at+56,child.restitution,true);
          if(child.points){block.setInt32(at+60,offset/3,true);block.setInt32(at+64,child.points.length/3,true);points.set(child.points,offset);offset+=child.points.length;}
        });
        token=this.mod._b3w_world_create_compound_body!(this.handle,this.scratch,pointer,children.length,pointer+children.length*SHAPE_DESC_BYTES,pointFloats/3);
      }finally{this.mod._free!(pointer);}
    }
    else if(floats===null)token=this.mod._b3w_world_create_body!(this.handle,this.scratch);
    else {
      // One block holds the floats, then the indices. malloc may grow the heap, so views are taken after it.
      const bytes=floats.byteLength+(ints?.byteLength??0),pointer=Number(this.mod._malloc!(bytes));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%4!==0)throw new EngineError('ALLOCATION_FAILED','Native geometry allocation failed.');
      try {
        new Float32Array(this.mod.HEAPF32.buffer,pointer,floats.length).set(floats);
        if(ints)new Int32Array(this.mod.HEAPF32.buffer,pointer+floats.byteLength,ints.length).set(ints);
        token=shape.kind==='hull'?this.mod._b3w_world_create_hull_body!(this.handle,this.scratch,pointer,floats.length/3):
          shape.kind==='mesh'?this.mod._b3w_world_create_mesh_body!(this.handle,this.scratch,pointer,floats.length/3,pointer+floats.byteLength,ints!.length/3):
          shape.kind==='heightfield'?this.mod._b3w_world_create_heightfield_body!(this.handle,this.scratch,pointer,shape.countX,shape.countZ,shape.spacing[0],1,shape.spacing[1]):0n;
      }finally{this.mod._free!(pointer);}
    }
    if(token===0n) {
      if(full)return null;
      // Every value was checked above, so what Box3D refuses here is the geometry itself.
      throw new EngineError('INVALID_PAYLOAD',shape.kind==='mesh'?'Box3D could not build this triangle mesh: its triangles have no area, or it has none it can use. Check the vertices and the winding.':
        shape.kind==='hull'||shape.kind==='compound'?'Box3D could not build a convex hull from these points: they lie in a plane or on a line. A hull needs four or more points with volume.':
        shape.kind==='heightfield'?'Box3D could not build this height field from the heights given.':'Box3D refused this body although every value is in range. This is unexpected: please report it with the options you passed.');
    }
    const body=this.wrapBody(token);
    if(reach>L.shape) {
      const largest=Math.max(...size.map(v=>Math.abs(v)),shape.kind==='capsule'?size[0]+size[1]:0,...(shape.kind==='hull'&&floats?Array.from(floats,Math.abs):[0]),
        ...(children??[]).map(child=>Math.max(...child.position.map(Math.abs))+Math.max(...child.size,child.shape.kind==='capsule'?child.size[0]+child.size[1]:0,...(child.points?Array.from(child.points,Math.abs):[0]))));
      if(largest>L.shape)this.largeConvex.add(token);
    }
    if(type===2&&massValues===null&&shape.kind!=='mesh'&&shape.kind!=='heightfield') {
      // A dynamic body whose shape and density give a mass that single precision cannot work with (its inverse
      // overflows, or the mass does) would turn the next step into NaN. A zero density is allowed: such a body is massless by request.
      // The density range and the size limits keep the mass of boxes, spheres and capsules well inside float32; a hull can
      // still be so thin that its volume, and so its mass, rounds to zero.
      const mass=this.bodyState(body).mass,massless=children===null?density===0:children.every(child=>child.density===0);
      if(!massless&&!(mass>0&&mass<=L.massMax)) {
        this.mod._b3w_world_destroy_body!(this.handle,body.token);
        throw new EngineError('INVALID_PAYLOAD',`The shape and its density give a mass of ${mass} kg; a dynamic body needs a mass above 0 and at most ${L.massMax} kg. The shape is probably flat or far too small: change its size or density, or pass massData.`,{path:'density',value:String(mass),expected:`a mass within (0, ${L.massMax}] kg`});
      }
    }
    // The descriptor cannot carry a zero gravity scale (zero means "default"), so apply it afterwards.
    if(gravityScale===0)this.bodyStatus(this.mod._b3w_world_set_body_gravity_scale!(this.handle,body.token,0));
    if(massValues!==null) {
      // The values were checked before the body was made; if the bridge still refuses them, the body does not stay.
      try{this.writeMassData(body.token,massValues);}catch(error){this.mod._b3w_world_destroy_body!(this.handle,body.token);throw error;}
    }
    if(this.retainedShapes&&children) {
      // Validated copies, so later changes to the caller's arrays do not show.
      this.retainedShapes.set(body.token,Object.freeze({kind:'compound' as const,shapes:Object.freeze(children.map(child=>Object.freeze({shape:child.shape,position:child.position,rotation:child.rotation,
        density:child.density,friction:child.friction,restitution:child.restitution})))}));
    }
    if(this.retainedShapes&&floats) {
      // `floats` and `ints` are this call's own validated copies, so later changes to the caller's arrays do not show.
      const kept: NativeBodyShape=shape.kind==='hull'?{kind:'hull',points:floats}:
        shape.kind==='mesh'?{kind:'mesh',vertices:floats,indices:ints!}:
        shape.kind==='heightfield'?{kind:'heightfield',heights:floats,countX:shape.countX,countZ:shape.countZ,spacing:[shape.spacing[0],shape.spacing[1]]}:shape;
      this.retainedShapes.set(body.token,Object.freeze(kept));
    }
    return body;
  }
  /** True when the artifact has compound shapes and explicit mass data. */
  get supportsCompoundBodies(): boolean { this.assertAlive();return typeof this.mod._b3w_world_create_compound_body==='function'; }
  // Checks every child of a compound and returns plain copies: the kind code, the pose, the size
  // triple the bridge reads, the material with the body's values filled in, and hull points.
  private compoundChildren(list: readonly NativeCompoundChild[],density: number,friction: number,restitution: number,reach: number=L.shape) {
    if(!Array.isArray(list))throw new EngineError('INVALID_PAYLOAD','A compound shape needs a `shapes` array.');
    integer(list.length,'compound shape count',1,NATIVE_COMPOUND_LIMIT);
    let pointValues=0;
    return list.map((child,index)=>{
      const label=`compound shape ${index}`,shape=child!==null&&typeof child==='object'?child.shape:undefined,kind=shape!==null&&typeof shape==='object'?(['box','sphere','capsule','hull'] as const).indexOf(shape.kind):-1;
      if(kind<0)throw new EngineError('INVALID_PAYLOAD',`${label}: shape.kind must be 'box', 'sphere', 'capsule' or 'hull'.`);
      const position=triple(child.position??[0,0,0],`${label} position`,-reach,reach);
      const raw=quaternion(child.rotation??[0,0,0,1],`${label} rotation`),length=Math.hypot(raw[0],raw[1],raw[2],raw[3]);
      const rotation: [number, number, number, number]=[raw[0]/length,raw[1]/length,raw[2]/length,raw[3]/length];
      let size: [number, number, number],points: Float32Array | null=null,kept: NativeConvexShape;
      if(shape.kind==='box'){size=triple(shape.halfExtents,`${label} half extent`,1e-4,reach);kept={kind:'box',halfExtents:[size[0],size[1],size[2]]};}
      else if(shape.kind==='sphere'){size=[finite(shape.radius,`${label} radius`,1e-4,reach),0,0];kept={kind:'sphere',radius:size[0]};}
      else if(shape.kind==='capsule'){size=[finite(shape.radius,`${label} radius`,1e-4,reach),finite(shape.halfLength,`${label} capsule half length`,0.0025,reach),0];kept={kind:'capsule',radius:size[0],halfLength:size[1]};}
      else {
        integer(shape.points?.length,`${label} hull point values`,12,4096*3);
        if(shape.points.length%3!==0)throw new EngineError('INVALID_PAYLOAD',`${label}: hull points must be x, y, z triples.`);
        points=Float32Array.from(shape.points,(v,i)=>finite(v,`${label} hull point value ${i}`,-reach,reach));
        pointValues+=points.length;
        if(pointValues>4096*3*NATIVE_COMPOUND_LIMIT)throw new EngineError('INVALID_PAYLOAD','A compound body holds too many hull points.');
        size=[1,1,1];kept={kind:'hull',points};
      }
      return {kind,shape:Object.freeze(kept),position,rotation,size,points,density:densityOf(child.density??density,`${label} density`),
        friction:finite(child.friction??friction,`${label} friction`,0,1e6),restitution:finite(child.restitution??restitution,`${label} restitution`,0,1e6)};
    });
  }
  private writeMassData(token: bigint,values: readonly number[]): void {
    const view=this.general();
    for(let i=0;i<10;i++)view.setFloat32(i*4,values[i]!,true);
    const status=this.mod._b3w_world_set_body_mass_data!(this.handle,token,this.scratch);
    if(status===-2)throw new EngineError('INVALID_PAYLOAD','Mass data needs a positive mass and a symmetric positive-definite inertia tensor that float32 can hold.');
    this.bodyStatus(status);
  }
  /**
   * Replace the mass, centre of mass and inertia tensor the body's shapes and densities give. The
   * body's velocity at its origin and its pose are unchanged. The values stay, also across
   * setBodyType, until resetBodyMassData; they act while the body is dynamic. A body created with
   * `lockRotation` keeps no inertia. The shapes still decide how the body collides.
   */
  setBodyMassData(body: NativeBodyHandle,data: NativeMassData): void {
    const token=this.bodyToken(body);this.general();
    if(!this.supportsCompoundBodies)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks explicit mass data; rebuild with npm run build:wasm.');
    this.writeMassData(token,massDataValues(data));
  }
  /** Back to the mass, centre of mass and inertia of the body's shapes. */
  resetBodyMassData(body: NativeBodyHandle): void {
    const token=this.bodyToken(body);this.general();
    if(!this.supportsCompoundBodies)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks explicit mass data; rebuild with npm run build:wasm.');
    this.bodyStatus(this.mod._b3w_world_reset_body_mass_data!(this.handle,token));
  }
  /** Mass, centre of mass (body frame) and inertia tensor (about that centre, body axes) as the solver holds them. A static or kinematic body reports zeros. */
  bodyMassData(body: NativeBodyHandle): NativeBodyMassState {
    const token=this.bodyToken(body),view=this.general();
    if(!this.supportsCompoundBodies)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks explicit mass data; rebuild with npm run build:wasm.');
    this.bodyStatus(this.mod._b3w_world_get_body_mass_data!(this.handle,token,this.scratch));
    const f=(i: number)=>view.getFloat32(i*4,true);
    return {mass:f(0),center:[f(1),f(2),f(3)],inertia:[f(4),f(5),f(6),f(7),f(8),f(9)],explicit:f(10)!==0,shapeCount:f(11)};
  }
  /**
   * Keep the geometry of every hull, mesh, height-field and compound body created from now on, so that a
   * renderer can draw it (`bodyShape`). Off by default: a world that is not drawn this way holds
   * no copies. Turning it off drops what was kept.
   */
  retainBodyShapes(enabled=true): void {
    this.assertAlive();
    if(enabled)this.retainedShapes??=new Map();else this.retainedShapes=null;
  }
  /**
   * The geometry the body at render row `row` was created with, when it is a hull, mesh, height
   * field or compound created after retainBodyShapes(true); null otherwise. The same object is returned for
   * the same body until it is destroyed, whatever row it moves to. Its arrays must not be changed.
   */
  bodyShape(row: number): NativeBodyShape | null {
    this.assertAlive();
    if(!this.retainedShapes||this.retainedShapes.size===0||!this.supportsBodyLifecycle)return null;
    integer(row,'body index',0,this.bodyCount()-1);
    return this.retainedShapes.get(BigInt.asUintN(64,this.mod._b3w_world_body_handle!(this.handle,row)))??null;
  }
  /** Shape kind of every render row, in row order. Rows move when a body is destroyed. */
  bodyKinds(): NativeBodyKind[] {
    this.general();
    return Array.from(this.readKinds(),kind=>BODY_KINDS[kind]??'box');
  }
  private readKinds(): Uint8Array {
    const count=this.bodyCount();
    if(count===0)return new Uint8Array(0);
    const pointer=Number(this.mod._malloc!(count));
    if(!Number.isSafeInteger(pointer)||pointer<=0)throw new EngineError('ALLOCATION_FAILED','Native scratch allocation failed.');
    try {
      const written=this.mod._b3w_world_copy_body_kinds!(this.handle,pointer,count);
      if(written!==count)throw new EngineError('INVALID_BACKEND','Native body kinds are out of step with the body count.');
      return new Uint8Array(this.mod.HEAPF32.buffer,pointer,count).slice();
    }finally{this.mod._free!(pointer);}
  }
  /** Version of the shape-kind rows for renderers. The bridge raises its colour version on every
   * body creation, destruction and scene replacement, which are the only events that change a kind.
   */
  shapeVersion(): number { return this.colorVersion(); }
  /** One byte per render row (0 box, 1 sphere, 2 capsule, 3 hull, 4 mesh, 5 height field, 6 compound), or null when every row is a box.
   * Read from the bridge once per shapeVersion(); the same array is returned until it changes.
   */
  shapeKinds(): Uint8Array | null {
    this.assertAlive();
    if(!this.supportsGeneralBodies)return null;
    const version=this.shapeVersion(),count=this.bodyCount();
    if(version!==this.kindRowsVersion||count!==this.kindRowsCount) {
      const rows=this.readKinds();
      this.kindRows=rows.some(kind=>kind!==0)?rows:null;this.kindRowsVersion=version;this.kindRowsCount=count;
    }
    return this.kindRows;
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
    position=point3(position,'position');rotation=quaternion(rotation,'rotation');
    this.bodyStatus(this.mod._b3w_world_set_body_transform!(this.handle,token,position[0],position[1],position[2],rotation[0],rotation[1],rotation[2],rotation[3]));
  }
  setBodyVelocity(body: NativeBodyHandle,linear: NativeQueryVector,angular: NativeQueryVector=[0,0,0]): void {
    const token=this.bodyToken(body);this.general();
    linear=triple(linear,'linear velocity',-L.speed,L.speed);angular=triple(angular,'angular velocity',-L.speed,L.speed);
    this.bodyStatus(this.mod._b3w_world_set_body_velocity!(this.handle,token,linear[0],linear[1],linear[2],angular[0],angular[1],angular[2]));
  }
  /** Set a kinematic body's velocity so that it reaches the pose after `seconds`. */
  setBodyTarget(body: NativeBodyHandle,position: NativeQueryVector,rotation: NativeQuaternion,seconds: number): void {
    const token=this.bodyToken(body);this.general();
    position=point3(position,'position');rotation=quaternion(rotation,'rotation');finite(seconds,'seconds',1e-6,1e6);
    this.bodyStatus(this.mod._b3w_world_set_body_target!(this.handle,token,position[0],position[1],position[2],rotation[0],rotation[1],rotation[2],rotation[3],seconds));
  }
  setBodyType(body: NativeBodyHandle,type: NativeBodyType): void {
    const token=this.bodyToken(body),code=BODY_TYPES.indexOf(type);this.general();
    if(code<0)throw new EngineError('INVALID_PAYLOAD',`type must be 'static', 'kinematic' or 'dynamic'; got ${showValue(type)}.`);
    if(type==='dynamic'&&this.largeConvex.has(token))throw new EngineError('INVALID_STATE',`This body has a convex shape reaching beyond ${L.shape} m, which only a static or kinematic body may have (Box3D's step can hang on such a dynamic body). Build it from smaller shapes, or keep it static or kinematic.`,{path:'type',value:showValue(type),expected:"'static' or 'kinematic' for this body"});
    this.bodyStatus(this.mod._b3w_world_set_body_type!(this.handle,token,code));
  }
  setBodyAwake(body: NativeBodyHandle,awake: boolean): void {
    const token=this.bodyToken(body);this.general();
    if(typeof awake!=='boolean')bad('awake',awake,'true or false');
    this.bodyStatus(this.mod._b3w_world_set_body_awake!(this.handle,token,awake?1:0));
  }
  setBodyGravityScale(body: NativeBodyHandle,scale: number): void {
    const token=this.bodyToken(body);this.general();within(scale,'gravity scale',L.gravity);
    this.bodyStatus(this.mod._b3w_world_set_body_gravity_scale!(this.handle,token,scale));
  }
  setBodyDamping(body: NativeBodyHandle,linear: number,angular: number): void {
    const token=this.bodyToken(body);this.general();finite(linear,'linear damping',0,L.hertz);finite(angular,'angular damping',0,L.hertz);
    this.bodyStatus(this.mod._b3w_world_set_body_damping!(this.handle,token,linear,angular));
  }
  /** A body collides with another when each one's categoryBits intersects the other's maskBits. */
  setBodyFilter(body: NativeBodyHandle,categoryBits: bigint,maskBits: bigint,groupIndex=0): void {
    const token=this.bodyToken(body);this.general();integer(groupIndex,'filter group',-0x80000000,0x7FFFFFFF);
    this.bodyStatus(this.mod._b3w_world_set_body_filter!(this.handle,token,bits64(categoryBits,'categoryBits'),bits64(maskBits,'maskBits'),groupIndex));
  }
  /** Forces and torques act over the next step; impulses change velocity at once. `point` is in world space. */
  applyToBody(body: NativeBodyHandle,mode: 'force' | 'torque' | 'impulse' | 'angular-impulse',value: NativeQueryVector,point?: NativeQueryVector): void {
    const token=this.bodyToken(body),code=(['force','torque','impulse','angular-impulse'] as const).indexOf(mode);this.general();
    if(code<0)throw new EngineError('INVALID_PAYLOAD',`Apply mode must be 'force', 'torque', 'impulse' or 'angular-impulse'; got ${showValue(mode)}.`);
    value=triple(value,mode,-L.force,L.force);
    if(point===undefined){this.bodyStatus(this.mod._b3w_world_apply_body!(this.handle,token,code,value[0],value[1],value[2]));return;}
    if(mode!=='force'&&mode!=='impulse')throw new EngineError('INVALID_PAYLOAD','Only a force or an impulse can be applied at a point.');
    point=point3(point,'point');
    this.bodyStatus(this.mod._b3w_world_apply_body_at!(this.handle,token,mode==='force'?0:1,value[0],value[1],value[2],point[0],point[1],point[2]));
  }

  createJoint(descriptor: NativeJointDescriptor): NativeJointHandle {
    const view=this.general();
    plain(descriptor,'joint options','{type, bodyA, bodyB, ...}');
    const type=JOINT_TYPES.indexOf(descriptor.type);
    if(type<0)throw new EngineError('INVALID_PAYLOAD',`Joint type must be one of ${JOINT_TYPES.join(', ')}; got ${showValue(descriptor.type)}.`);
    const a=descriptor.bodyA===null?0n:this.bodyToken(descriptor.bodyA),b=descriptor.bodyB===null?0n:this.bodyToken(descriptor.bodyB);
    if(a===b)throw new EngineError('INVALID_PAYLOAD','A joint needs two different bodies (null stands for the fixed world, on one side only).');
    // A handle of a destroyed body is refused here, by name, before anything is written.
    for(const [side,token] of [['bodyA',a],['bodyB',b]] as const)if(token!==0n&&this.mod._b3w_world_body_index!(this.handle,token)===-1)throw new EngineError('STALE_BODY',`Joint ${side} has been destroyed or belongs to a previous scene.`);
    const opt=<T>(value: T | null | undefined,label: string,shape: string): T | undefined=>value===undefined||value===null?undefined:plain(value,label,shape);
    const limits=opt(descriptor.limits,'limits','{lower, upper}'),motor=opt(descriptor.motor,'motor','{speed, maxForce}'),spring=opt(descriptor.spring,'spring','{hertz, dampingRatio, target?}'),stiffness=opt(descriptor.stiffness,'stiffness','{hertz, dampingRatio?}');
    if(limits){finite(limits.lower,'lower limit',-1e6,1e6);finite(limits.upper,'upper limit',limits.lower,1e6);}
    if(motor){within(motor.speed,'motor speed',L.speed);finite(motor.maxForce,'motor max force',0,L.force);}
    if(spring){finite(spring.hertz,'spring hertz',0,L.hertz);finite(spring.dampingRatio,'spring damping ratio',0,L.hertz);within(spring.target??0,'spring target',1e6);}
    if(descriptor.type==='distance')finite(descriptor.length,'distance joint length',1e-6,NATIVE_WORLD_EXTENT);
    if(descriptor.coneAngle!==undefined)finite(descriptor.coneAngle,'cone angle',0,Math.PI);
    if(stiffness){finite(stiffness.hertz,'joint stiffness hertz',1e-6,L.hertz);finite(stiffness.dampingRatio??2,'joint stiffness damping ratio',0,L.hertz);}
    const collide=flag(descriptor.collideConnected,'collideConnected');
    const thresholds=opt(descriptor.thresholds,'thresholds','{force?, torque?, breakable?}');
    if(descriptor.maxTorque!==undefined&&descriptor.type!=='parallel')throw new EngineError('INVALID_PAYLOAD','Only a parallel joint takes maxTorque.',{path:'maxTorque',value:showValue(descriptor.maxTorque),expected:'no maxTorque for this joint type'});
    const parallelTorque=descriptor.type==='parallel'&&descriptor.maxTorque!==undefined?finite(descriptor.maxTorque,'parallel joint max torque',0,L.force):undefined;
    const extended=type>=6||thresholds!==undefined||descriptor.drive!==undefined||descriptor.steering!==undefined;
    if(extended&&!this.supportsRigidCore)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks motor, parallel and filter joints, joint thresholds and steering limits; rebuild with npm run build:wasm.');
    if(descriptor.drive!==undefined&&descriptor.type!=='motor')throw new EngineError('INVALID_PAYLOAD','Only a motor joint takes a drive.',{path:'drive',value:showValue(descriptor.drive),expected:"type 'motor'"});
    if(descriptor.steering!==undefined&&descriptor.type!=='wheel')throw new EngineError('INVALID_PAYLOAD','Only a wheel joint steers.',{path:'steering',value:showValue(descriptor.steering),expected:"type 'wheel'"});
    const [forceThreshold,torqueThreshold,breakable]=thresholdList(thresholds);
    const driveValues=descriptor.drive===undefined?null:driveList(descriptor.drive),steeringValues=descriptor.steering===undefined?null:steeringList(descriptor.steering);
    // A frame is in its body's own coordinates, so its origin lies within a shape's reach of the body; on the fixed
    // world (null) it is a world point.
    const frames=[descriptor.frameA,descriptor.frameB].map((frame,side)=>{
      const label=side===0?'frameA':'frameB',f=opt(frame,label,'{position?, rotation?}'),reach=(side===0?a:b)===0n?L.extent:L.shape;
      return {position:triple(f?.position??[0,0,0],`${label}.position`,-reach,reach),rotation:quaternion(f?.rotation??[0,0,0,1],`${label}.rotation`)};
    });
    for(let i=0;i<128;i+=4)view.setUint32(i,0,true);
    view.setUint32(0,type,true);
    view.setUint32(4,(collide?1:0)|(limits?2:0)|(motor||parallelTorque!==undefined?4:0)|(spring?8:0)|(descriptor.coneAngle!==undefined?16:0)|(breakable?32:0),true);
    view.setBigUint64(8,a,true);view.setBigUint64(16,b,true);
    frames.forEach((frame,side)=>{
      const base=24+side*28;
      for(let i=0;i<3;i++)view.setFloat32(base+i*4,frame.position[i],true);
      for(let i=0;i<4;i++)view.setFloat32(base+12+i*4,frame.rotation[i],true);
    });
    view.setFloat32(80,limits?.lower??0,true);view.setFloat32(84,limits?.upper??0,true);
    view.setFloat32(88,motor?.speed??0,true);view.setFloat32(92,parallelTorque??motor?.maxForce??0,true);
    view.setFloat32(96,spring?.hertz??0,true);view.setFloat32(100,spring?.dampingRatio??0,true);
    view.setFloat32(104,descriptor.type==='distance'?descriptor.length!:spring?.target??0,true);
    view.setFloat32(108,descriptor.coneAngle??0,true);
    view.setFloat32(112,stiffness?.hertz??0,true);view.setFloat32(116,stiffness?stiffness.dampingRatio??2:0,true);
    view.setFloat32(120,forceThreshold,true);view.setFloat32(124,torqueThreshold,true);
    const token=this.mod._b3w_world_create_joint!(this.handle,this.scratch);
    if(token===0n)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the joint: check that both bodies are alive.');
    const joint=this.wrapJoint(token);
    // Checked before the joint was made; if the bridge still refuses them, the joint does not stay.
    try {
      if(driveValues!==null)this.writeJointValues(joint.token,0,driveValues);
      if(steeringValues!==null)this.applySteering(joint.token,descriptor.steering!);
    }catch(error){this.mod._b3w_world_destroy_joint!(this.handle,joint.token);throw error;}
    return joint;
  }
  /** True when the artifact has the rigid-core extension: motor, parallel and filter joints, joint events and breaking,
   * batched rays, capsule queries, the character mover, world and body controls, the step profile and debug lines. */
  get supportsRigidCore(): boolean { this.assertAlive();return typeof this.mod._b3w_world_mover_move==='function'; }
  private rigid(): DataView {
    const view=this.general();
    if(!this.supportsRigidCore)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks the rigid-core extension; rebuild with npm run build:wasm.');
    return view;
  }
  private wide(): number {
    this.rigid();
    if(this.wideScratch===0) {
      const pointer=Number(this.mod._malloc!(1024));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%8!==0)throw new EngineError('ALLOCATION_FAILED','Native scratch allocation failed.');
      this.wideScratch=pointer;
    }
    return this.wideScratch;
  }
  private writeJointValues(token: bigint,what: number,values: readonly number[]): void {
    const view=this.rigid();
    values.forEach((value,i)=>view.setFloat32(i*4,value,true));
    this.jointStatus(this.mod._b3w_world_joint_set_values!(this.handle,token,what,this.scratch,values.length));
  }
  private applySteering(token: bigint,steering: NativeJointSteering): void {
    this.jointStatus(this.mod._b3w_world_joint_set_steering!(this.handle,token,1,steering.angle,steering.hertz,steering.dampingRatio,steering.maxTorque));
    if(steering.limits)this.writeJointValues(token,2,[1,steering.limits.lower,steering.limits.upper]);
  }
  /** Motor joints: replace the drive. */
  setJointDrive(joint: NativeJointHandle,drive: NativeJointDrive): void { const token=this.jointToken(joint);this.writeJointValues(token,0,driveList(drive)); }
  /** Force and torque thresholds for joint events, and whether the joint breaks at them. Pass null to remove them. */
  setJointThresholds(joint: NativeJointHandle,thresholds: NativeJointThresholds | null): void {
    const token=this.jointToken(joint),[force,torque,breakable]=thresholdList(thresholds);
    this.writeJointValues(token,1,[force,torque,breakable?1:0]);
  }
  /** Wheel joints: limit the steering angle. Pass null to remove the limit. */
  setJointSteeringLimits(joint: NativeJointHandle,limits: {lower: number; upper: number} | null): void {
    const token=this.jointToken(joint),l=steeringLimits(limits,'steering limits');
    this.writeJointValues(token,2,[l?1:0,l?.lower??0,l?.upper??0]);
  }
  /** Spherical joints: the orientation of frame B in frame A that the spring pulls towards. */
  setJointTargetRotation(joint: NativeJointHandle,rotation: NativeQuaternion): void {
    const token=this.jointToken(joint);
    this.writeJointValues(token,3,quaternion(rotation,'target rotation'));
  }
  /** Spherical joints: turn body B relative to body A at an angular velocity (rad/s) with a bounded torque. Pass null to switch it off. */
  setJointAngularMotor(joint: NativeJointHandle,motor: {velocity: NativeQueryVector; maxTorque: number} | null): void {
    const token=this.jointToken(joint);
    if(motor!==null)plain(motor,'angular motor','{velocity, maxTorque} or null');
    const v=motor===null?[0,0,0]:triple(motor.velocity,'angular motor velocity',-L.speed,L.speed);
    this.writeJointValues(token,4,[motor?1:0,...v,motor===null?0:finite(motor.maxTorque,'angular motor maxTorque',0,L.force)]);
  }
  /** Parallel joints: the spring that keeps the two z axes aligned, and the largest torque it may use. */
  setJointParallelSpring(joint: NativeJointHandle,spring: {hertz: number; dampingRatio: number; maxTorque: number}): void {
    const token=this.jointToken(joint);plain(spring,'parallel spring','{hertz, dampingRatio, maxTorque}');
    this.writeJointValues(token,5,[finite(spring.hertz,'parallel spring hertz',0,L.hertz),finite(spring.dampingRatio,'parallel spring dampingRatio',0,L.hertz),finite(spring.maxTorque,'parallel spring maxTorque',0,L.force)]);
  }
  /** Spherical joints: limit the swing to a cone of this half angle (rad). Pass null to remove the limit. */
  setJointConeLimit(joint: NativeJointHandle,angle: number | null): void {
    const token=this.jointToken(joint);
    this.writeJointValues(token,6,[angle===null?0:1,angle===null?0:finite(angle,'cone angle',0,Math.PI)]);
  }
  /** Whether the two bodies of the joint collide with each other. */
  setJointCollideConnected(joint: NativeJointHandle,collide: boolean): void {
    const token=this.jointToken(joint);
    if(typeof collide!=='boolean')bad('collideConnected',collide,'true or false');
    this.writeJointValues(token,7,[collide?1:0]);
  }
  /** Everything the solver holds about one joint: separation errors, thresholds, and the values of its type. */
  jointDetails(joint: NativeJointHandle): NativeJointDetails {
    const token=this.jointToken(joint),view=this.rigid();
    this.jointStatus(this.mod._b3w_world_joint_get_values!(this.handle,token,this.scratch));
    const f=(i: number)=>view.getFloat32(i*4,true),type=JOINT_TYPES[f(0)]??'weld';
    const out: NativeJointDetails={type,linearSeparation:f(1),angularSeparation:f(2),forceThreshold:f(3),torqueThreshold:f(4),breakable:f(5)!==0,stiffness:{hertz:f(6),dampingRatio:f(7)}};
    if(type==='revolute')Object.assign(out,{angle:f(8),motorForce:f(9),lowerLimit:f(10),upperLimit:f(11),motorSpeed:f(12)});
    else if(type==='prismatic')Object.assign(out,{translation:f(8),speed:f(9),motorForce:f(10),lowerLimit:f(11),upperLimit:f(12)});
    else if(type==='distance')Object.assign(out,{length:f(8),motorForce:f(9),restLength:f(10),lowerLimit:f(11),upperLimit:f(12)});
    else if(type==='spherical')Object.assign(out,{angle:f(8),motorTorque:[f(9),f(10),f(11)],coneAngle:f(12),coneLimit:f(13)});
    else if(type==='wheel')Object.assign(out,{spinSpeed:f(8),spinTorque:f(9),steeringAngle:f(10),steeringTorque:f(11),targetSteeringAngle:f(12),suspension:f(13),lowerLimit:f(14),upperLimit:f(15)});
    else if(type==='motor')Object.assign(out,{linearVelocity:[f(8),f(9),f(10)],angularVelocity:[f(11),f(12),f(13)]});
    else if(type==='parallel')Object.assign(out,{springHertz:f(8),springDampingRatio:f(9),maxTorque:f(10)});
    return out;
  }

  /**
   * Closest hit of each of up to 65,536 rays in one call. `rays` holds origin x, y, z and translation x, y, z per
   * ray (the translation is the whole displacement, not a direction). Each ray's hit is the one `queryBatch` with
   * limit 1 reports, bit for bit: ties at the same fraction go to the smaller body handle, then the smaller triangle
   * and compound child. Each ray stops at its nearest hit. Reads the world only.
   */
  castRayBatch(rays: ArrayLike<number>,filter: NativeQueryFilter={}): NativeRayBatch {
    this.rigid();
    if(!rays||!Number.isSafeInteger(rays.length)||rays.length%6!==0||rays.length>65536*6)throw new EngineError('INVALID_PAYLOAD','rays must hold 6 numbers per ray, for at most 65,536 rays.');
    const count=rays.length/6;
    onlyKeys(filter as Record<string, unknown>,['bodies','categoryBits','maskBits','ignoreBody'],'filter');
    const bodies=filter.bodies??'all';
    if(typeof bodies!=='string'||!Object.hasOwn(QUERY_BODY_TYPES,bodies))throw new EngineError('INVALID_PAYLOAD','filter.bodies is not supported.');
    const category=queryBits(filter.categoryBits??0xFFFFFFFFFFFFFFFFn,'filter.categoryBits'),mask=queryBits(filter.maskBits??0xFFFFFFFFFFFFFFFFn,'filter.maskBits');
    const ignore=filter.ignoreBody===undefined?0n:this.bodyToken(filter.ignoreBody);
    const empty: NativeRayBatch={count,hitCount:0,fractions:new Float32Array(count).fill(-1),points:new Float32Array(count*3),normals:new Float32Array(count*3),triangles:new Int32Array(count).fill(-1),bodies:new Array<NativeBodyHandle | null>(count).fill(null)};
    if(count===0)return empty;
    const input=new Float32Array(count*6);
    for(let i=0;i<input.length;i++)input[i]=finite(rays[i],`rays[${i}]`,-1e6,1e6);
    // Layout: body handles (8 bytes each), then the rays, then the hit records.
    const bytes=count*(8+24+32),pointer=Number(this.mod._malloc!(bytes));
    if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%8!==0)throw new EngineError('ALLOCATION_FAILED','Native ray buffer allocation failed.');
    try {
      const raysAt=pointer+count*8,hitsAt=raysAt+count*24;
      new Float32Array(this.mod.HEAPF32.buffer,raysAt,count*6).set(input);
      const status=this.mod._b3w_world_cast_rays!(this.handle,raysAt,count,category,mask,QUERY_BODY_TYPES[bodies as keyof typeof QUERY_BODY_TYPES],ignore,hitsAt,pointer);
      if(status===-5)throw new EngineError('STALE_BODY','The ignored body has been destroyed or belongs to a previous scene.');
      if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the rays.');
      if(status<0)throw new EngineError('DISPOSED','The native context rejected the ray batch.');
      // The query may have grown the heap: take the views after it.
      const hits=new Float32Array(this.mod.HEAPF32.buffer,hitsAt,count*8),tokens=new BigUint64Array(this.mod.HEAPF32.buffer,pointer,count);
      for(let i=0;i<count;i++) {
        const o=i*8,token=tokens[i];
        if(token===0n)continue;
        empty.fractions[i]=hits[o];
        empty.points[i*3]=hits[o+1];empty.points[i*3+1]=hits[o+2];empty.points[i*3+2]=hits[o+3];
        empty.normals[i*3]=hits[o+4];empty.normals[i*3+1]=hits[o+5];empty.normals[i*3+2]=hits[o+6];
        empty.triangles[i]=hits[o+7];
        empty.bodies[i]=this.wrapBody(token);
      }
      return {...empty,hitCount:status};
    }finally{this.mod._free!(pointer);}
  }

  /**
   * Move an upright capsule by `translation`, sliding along what it meets, without passing through thin geometry:
   * Box3D's character mover (collision planes, plane solver, mover cast). Reads the world only; a controller applies
   * the result and pushes bodies itself.
   */
  moverMove(input: NativeMoverInput): NativeMoverResult {
    const pointer=this.wide();
    plain(input,'capsule move','{position, radius, halfLength, translation, ...}');
    if(input.bodies!==undefined)plain(input.bodies,'capsule move bodies','{static?, kinematic?, dynamic?}');
    const position=queryVector(input.position,'mover position'),translation=queryVector(input.translation,'mover translation');
    const radius=finite(input.radius,'mover radius',1e-4,L.shape),halfLength=finite(input.halfLength,'mover half length',0.0025,L.shape);
    const wall=input.wallBelowNormalY===undefined?null:finite(input.wallBelowNormalY,'wallBelowNormalY',0,1);
    const iterations=integer(input.iterations??5,'mover iterations',1,16),tolerance=finite(input.tolerance??0.01,'mover tolerance',0,1e6);
    const kinds=input.bodies??{},bodyTypes=(kinds.static===false?0:1)|(kinds.kinematic===false?0:2)|(kinds.dynamic===false?0:4);
    const category=queryBits(input.categoryBits??0xFFFFFFFFFFFFFFFFn,'mover categoryBits'),mask=queryBits(input.maskBits??0xFFFFFFFFFFFFFFFFn,'mover maskBits');
    const ignore=input.ignoreBody===undefined?0n:this.bodyToken(input.ignoreBody);
    let view=new DataView(this.mod.HEAPF32.buffer,pointer,1024);
    for(let i=0;i<80;i+=4)view.setUint32(i,0,true);
    for(let i=0;i<3;i++){view.setFloat32(i*4,position[i],true);view.setFloat32(20+i*4,translation[i],true);}
    view.setFloat32(12,radius,true);view.setFloat32(16,halfLength,true);
    view.setFloat32(32,wall??0,true);view.setFloat32(36,tolerance,true);
    view.setUint32(40,wall===null?0:1,true);view.setUint32(44,iterations,true);view.setUint32(48,bodyTypes,true);
    view.setBigUint64(56,category,true);view.setBigUint64(64,mask,true);view.setBigUint64(72,ignore,true);
    const status=this.mod._b3w_world_mover_move!(this.handle,pointer,pointer+80);
    if(status===-5)throw new EngineError('STALE_BODY','The ignored body has been destroyed or belongs to a previous scene.');
    if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the mover input.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected the mover.');
    view=new DataView(this.mod.HEAPF32.buffer,pointer+80,800);
    const planeCount=view.getUint32(20,true),planes: NativeMoverPlane[]=[];
    if(planeCount>16)throw new EngineError('INVALID_BACKEND','Native mover returned an invalid plane count.');
    for(let i=0;i<planeCount;i++) {
      const o=32+i*48,f=(k: number)=>view.getFloat32(o+k*4,true);
      planes.push({normal:[f(0),f(1),f(2)],point:[f(4),f(5),f(6)],push:f(7),body:this.wrapBody(view.getBigUint64(o+32,true)),
        bodyType:BODY_TYPES[view.getUint32(o+40,true)]??'static',wall:view.getUint32(o+44,true)!==0});
    }
    return {position:[view.getFloat32(0,true),view.getFloat32(4,true),view.getFloat32(8,true)],planes,iterations:view.getUint32(16,true)};
  }

  /** The world-wide solver settings. A new or reset world has Box3D's defaults. */
  worldSettings(): NativeWorldSettings {
    const view=this.rigid();
    this.accepted(this.mod._b3w_world_get_params!(this.handle,this.scratch));
    const f=(i: number)=>view.getFloat32(i*4,true);
    return {sleeping:f(0)!==0,continuous:f(1)!==0,speculative:f(2)!==0,warmStarting:f(3)!==0,restitutionThreshold:f(4),hitEventThreshold:f(5),
      contactHertz:f(6),contactDampingRatio:f(7),contactPushSpeed:f(8),maximumLinearSpeed:f(9),contactRecycleDistance:f(10)};
  }
  /** Change some world-wide solver settings. Every dynamic body is woken, so that the new rule applies from the next step. */
  setWorldSettings(settings: Partial<NativeWorldSettings>): void {
    this.rigid();
    plain(settings,'settings','an object of world settings');
    onlyKeys(settings as Record<string, unknown>,['sleeping','continuous','speculative','warmStarting','restitutionThreshold','hitEventThreshold',
      'contactHertz','contactDampingRatio','contactPushSpeed','maximumLinearSpeed','contactRecycleDistance'],'settings');
    const calls: [number,number,number,number][]=[];
    (['sleeping','continuous','speculative','warmStarting'] as const).forEach((key,id)=>{
      const value=settings[key];
      if(value===undefined)return;
      if(typeof value!=='boolean')throw new EngineError('INVALID_PAYLOAD',`settings.${key} must be a boolean.`);
      calls.push([id,value?1:0,0,0]);
    });
    if(settings.restitutionThreshold!==undefined)calls.push([4,finite(settings.restitutionThreshold,'settings.restitutionThreshold',0,L.speed),0,0]);
    if(settings.hitEventThreshold!==undefined)calls.push([5,finite(settings.hitEventThreshold,'settings.hitEventThreshold',0,L.speed),0,0]);
    if(settings.contactHertz!==undefined||settings.contactDampingRatio!==undefined||settings.contactPushSpeed!==undefined) {
      const now=this.worldSettings();
      calls.push([6,finite(settings.contactHertz??now.contactHertz,'settings.contactHertz',0,L.hertz),finite(settings.contactDampingRatio??now.contactDampingRatio,'settings.contactDampingRatio',0,L.hertz),
        finite(settings.contactPushSpeed??now.contactPushSpeed,'settings.contactPushSpeed',0,L.speed)]);
    }
    if(settings.maximumLinearSpeed!==undefined)calls.push([7,finite(settings.maximumLinearSpeed,'settings.maximumLinearSpeed',1e-6,L.speed),0,0]);
    if(settings.contactRecycleDistance!==undefined)calls.push([8,finite(settings.contactRecycleDistance,'settings.contactRecycleDistance',0,L.shape),0,0]);
    for(const [id,a,b,c] of calls) {
      const status=this.mod._b3w_world_set_param!(this.handle,id,a,b,c);
      if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the world setting.');
      this.accepted(status);
    }
  }
  private setBodyFlag(body: NativeBodyHandle,what: number,value: number): void {
    const token=this.bodyToken(body);this.rigid();
    this.bodyStatus(this.mod._b3w_world_set_body_flag!(this.handle,token,what,value));
  }
  /** Continuous collision against other moving bodies, for a small fast body. Costs more than the default. */
  setBodyBullet(body: NativeBodyHandle,bullet: boolean): void { this.bodyToken(body);if(typeof bullet!=='boolean')bad('bullet',bullet,'true or false');this.setBodyFlag(body,0,bullet?1:0); }
  /** Whether the body may fall asleep, and below what speed (m/s). */
  setBodySleep(body: NativeBodyHandle,options: {enabled?: boolean; threshold?: number}): void {
    this.bodyToken(body);
    plain(options,'sleep options','{enabled?, threshold?}');onlyKeys(options as Record<string, unknown>,['enabled','threshold'],'sleep options');
    const threshold=options.threshold===undefined?undefined:finite(options.threshold,'sleep threshold',0,L.speed);
    if(options.enabled!==undefined&&typeof options.enabled!=='boolean')bad('sleep options.enabled',options.enabled,'true or false');
    if(threshold!==undefined)this.setBodyFlag(body,2,threshold);
    if(options.enabled!==undefined)this.setBodyFlag(body,1,options.enabled?1:0);
  }
  /** Stop the body from translating along, or turning about, chosen world axes. */
  setBodyMotionLocks(body: NativeBodyHandle,locks: Partial<NativeBodyFlags['locks']>): void {
    this.bodyToken(body);
    const names=['linearX','linearY','linearZ','angularX','angularY','angularZ'];
    plain(locks,'motion locks','{linearX?, linearY?, linearZ?, angularX?, angularY?, angularZ?}');onlyKeys(locks as Record<string, unknown>,names,'motion locks');
    for(const name of names)flag((locks as Record<string, unknown>)[name],`motion locks.${name}`);
    this.setBodyFlag(body,3,(locks.linearX?1:0)|(locks.linearY?2:0)|(locks.linearZ?4:0)|(locks.angularX?8:0)|(locks.angularY?16:0)|(locks.angularZ?32:0));
  }
  bodyFlags(body: NativeBodyHandle): NativeBodyFlags {
    const token=this.bodyToken(body),view=this.rigid();
    this.bodyStatus(this.mod._b3w_world_get_body_flags!(this.handle,token,this.scratch));
    const bits=view.getFloat32(12,true);
    return {bullet:view.getFloat32(0,true)!==0,sleepEnabled:view.getFloat32(4,true)!==0,sleepThreshold:view.getFloat32(8,true),
      locks:{linearX:(bits&1)!==0,linearY:(bits&2)!==0,linearZ:(bits&4)!==0,angularX:(bits&8)!==0,angularY:(bits&16)!==0,angularZ:(bits&32)!==0}};
  }
  /**
   * Box3D's explosion: an impulse on every sphere, capsule and hull within `radius + falloff` of the centre,
   * proportional to the shape area that faces it (`impulsePerArea`, N s per m^2; negative pulls inwards) and fading
   * linearly to zero across `falloff`. Meshes and height fields are not affected.
   */
  explodeArea(options: {center: NativeQueryVector; radius: number; falloff?: number; impulsePerArea: number; maskBits?: bigint}): void {
    this.rigid();
    plain(options,'explosion','{center, radius, falloff?, impulsePerArea, maskBits?}');
    const c=point3(options.center,'explosion center'),radius=finite(options.radius,'explosion radius',0,L.extent),falloff=finite(options.falloff??0,'explosion falloff',0,L.extent);
    const impulse=within(options.impulsePerArea,'explosion impulsePerArea',L.force),mask=queryBits(options.maskBits??0xFFFFFFFFFFFFFFFFn,'explosion maskBits');
    const status=this.mod._b3w_world_explode_area!(this.handle,c[0],c[1],c[2],radius,falloff,impulse,mask);
    if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the explosion.');
    this.accepted(status);
  }
  /** Box3D's timing of the most recent step by stage, and the sizes it worked on. Wall-clock, so not reproducible. */
  profile(): NativeStepProfile {
    const pointer=this.wide();
    this.accepted(this.mod._b3w_world_profile!(this.handle,pointer,pointer+96));
    const floats=new Float32Array(this.mod.HEAPF32.buffer,pointer,23),ints=new Int32Array(this.mod.HEAPF32.buffer,pointer+96,16);
    const milliseconds={} as Record<NativeProfileStage, number>,counters={} as Record<NativeProfileCounter, number>;
    PROFILE_STAGES.forEach((name,i)=>{milliseconds[name]=floats[i];});
    PROFILE_COUNTERS.forEach((name,i)=>{counters[name]=ints[i];});
    return {milliseconds,counters};
  }
  /** Contact pairs, points, overlap and impulses from the solver's manifolds. Reads the world only. */
  contactStats(): NativeContactStats {
    const view=this.rigid();
    const status=this.mod._b3w_world_contact_stats!(this.handle,this.scratch);
    if(status===-3)throw new EngineError('ALLOCATION_FAILED','Native contact statistics could not be allocated.');
    this.accepted(status);
    const f=(i: number)=>view.getFloat32(i*4,true);
    return {pairs:f(0),points:f(1),deepestPenetration:f(2),meanPenetration:f(3),largestImpulse:f(4),totalImpulse:f(5)};
  }
  /**
   * Box3D's own debug drawing as line segments: joints, shape bounds, centres of mass, contact points with their
   * normals and forces, and islands. Returns owned copies. Reads the world only.
   */
  debugLines(options: NativeDebugDrawOptions={}): NativeDebugLines {
    this.rigid();
    plain(options,'debug-draw options','an object of debug-draw switches');onlyKeys(options as Record<string, unknown>,[...DEBUG_FLAGS,'jointScale','forceScale','region'],'debug-draw options');
    let flags=0;
    DEBUG_FLAGS.forEach((key,bit)=>{if(flag(options[key],`debug-draw options.${key}`))flags|=1<<bit;});
    const jointScale=finite(options.jointScale??0,'joint scale',0,L.extent),forceScale=finite(options.forceScale??0,'force scale',0,L.extent);
    if(options.region!==undefined)plain(options.region,'region','{min, max}');
    let bounds=0;
    if(options.region) {
      const min=queryVector(options.region.min,'region.min'),max=queryVector(options.region.max,'region.max'),view=this.general();
      for(let i=0;i<3;i++){if(min[i]>max[i])throw new EngineError('INVALID_PAYLOAD','region.min must not exceed region.max.');view.setFloat32(i*4,min[i],true);view.setFloat32(12+i*4,max[i],true);}
      bounds=this.scratch;
    }
    const count=this.mod._b3w_world_debug_draw!(this.handle,flags,jointScale,forceScale,bounds);
    if(count===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the debug-draw options.');
    if(count<0)throw new EngineError('DISPOSED','The native context rejected debug drawing.');
    const total=this.mod._b3w_world_debug_total!(this.handle),positions=new Float32Array(count*3),colors=new Float32Array(count*3);
    if(count>0) {
      const pointer=Number(this.mod._b3w_world_debug_ptr!(this.handle));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%4!==0||pointer+count*16>this.mod.HEAPF32.byteLength)throw new EngineError('INVALID_BACKEND','Native debug-draw buffer is outside the module heap.');
      const source=new Float32Array(this.mod.HEAPF32.buffer,pointer,count*4);
      for(let i=0;i<count;i++) {
        const rgb=source[i*4+3];
        positions[i*3]=source[i*4];positions[i*3+1]=source[i*4+1];positions[i*3+2]=source[i*4+2];
        colors[i*3]=((rgb>>16)&255)/255;colors[i*3+1]=((rgb>>8)&255)/255;colors[i*3+2]=(rgb&255)/255;
      }
    }
    return {positions,colors,vertexCount:count,truncated:total>count};
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
    if(motor!==null){plain(motor,'motor','{speed, maxForce} or null');within(motor.speed,'motor speed',L.speed);finite(motor.maxForce,'motor max force',0,L.force);}
    this.jointStatus(this.mod._b3w_world_joint_set_motor!(this.handle,token,motor?1:0,motor?.speed??0,motor?.maxForce??0));
  }
  /** Pass null to remove the limits. Not available on weld joints. */
  setJointLimits(joint: NativeJointHandle,limits: {lower: number; upper: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(limits!==null){plain(limits,'limits','{lower, upper} or null');finite(limits.lower,'lower limit',-1e6,1e6);finite(limits.upper,'upper limit',limits.lower,1e6);}
    this.jointStatus(this.mod._b3w_world_joint_set_limits!(this.handle,token,limits?1:0,limits?.lower??0,limits?.upper??0));
  }
  /** Pass null to switch the spring off. */
  setJointSpring(joint: NativeJointHandle,spring: {hertz: number; dampingRatio: number; target?: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(spring!==null){plain(spring,'spring','{hertz, dampingRatio, target?} or null');finite(spring.hertz,'spring hertz',0,L.hertz);finite(spring.dampingRatio,'spring damping ratio',0,L.hertz);within(spring.target??0,'spring target',1e6);}
    this.jointStatus(this.mod._b3w_world_joint_set_spring!(this.handle,token,spring?1:0,spring?.hertz??0,spring?.dampingRatio??0,spring?.target??0));
  }
  /** How stiffly the joint holds its bodies together (Box3D's default: 60 Hz, damping ratio 2).
   * A higher frequency sags less under load; keep it well below the sub-step rate.
   */
  setJointStiffness(joint: NativeJointHandle,hertz: number,dampingRatio=2): void {
    const token=this.jointToken(joint);this.general();
    finite(hertz,'joint stiffness hertz',1e-6,L.hertz);finite(dampingRatio,'joint stiffness damping ratio',0,L.hertz);
    if(typeof this.mod._b3w_world_joint_set_tuning!=='function')throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks joint stiffness; rebuild with npm run build:wasm.');
    this.jointStatus(this.mod._b3w_world_joint_set_tuning(this.handle,token,hertz,dampingRatio));
  }
  /** Wheel joints only. Pass null to switch steering off. */
  setJointSteering(joint: NativeJointHandle,steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null): void {
    const token=this.jointToken(joint);this.general();
    if(steering!==null){plain(steering,'steering','{angle, hertz, dampingRatio, maxTorque} or null');within(steering.angle,'steering angle',1e6);finite(steering.hertz,'steering hertz',0,L.hertz);finite(steering.dampingRatio,'steering damping ratio',0,L.hertz);finite(steering.maxTorque,'steering max torque',0,L.force);}
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
      if(kind==='joint-overload'||kind==='joint-break') {
        const token=(BigInt(view.getUint32(o+52,true))<<32n)|BigInt(view.getUint32(o+4,true));
        events.push({kind,bodyA,bodyB,joint:this.wrapJoint(token),force:[view.getFloat32(o+24,true),view.getFloat32(o+28,true),view.getFloat32(o+32,true)],
          torque:[view.getFloat32(o+36,true),view.getFloat32(o+40,true),view.getFloat32(o+44,true)]});
        continue;
      }
      if(kind==='body-contained'){events.push({kind,bodyA,bodyB:null,speed:view.getFloat32(o+48,true)});continue;}
      events.push(kind==='hit'?{kind,bodyA,bodyB,point:[view.getFloat32(o+24,true),view.getFloat32(o+28,true),view.getFloat32(o+32,true)],
        normal:[view.getFloat32(o+36,true),view.getFloat32(o+40,true),view.getFloat32(o+44,true)],approachSpeed:view.getFloat32(o+48,true)}:{kind,bodyA,bodyB});
    }
    return {events,dropped:Math.max(0,total-count)};
  }

  /**
   * How many times a step has diverged for a body and the bridge contained it (put it back at its previous pose, at
   * rest; each is also a 'body-contained' event), since this native world was made. 0 for an artifact without
   * containment. Not reset by resetWorld.
   */
  containedTotal(): number { this.assertAlive();const n=this.mod._b3w_world_contained_total?.(this.handle)??0;return n<0?0:n; }

  /** True when the artifact can write and restore exact checkpoints of a world (docs/CHECKPOINTS.md). */
  get supportsCheckpoints(): boolean { this.assertAlive();return typeof this.mod._b3w_world_restore==='function'&&typeof this.mod._b3w_world_checkpoint==='function'; }
  /**
   * The complete state of this world: its body table (handles, render rows and streams, shape kinds, mass data set by
   * hand) and Box3D's own snapshot of everything a step reads (contacts with their manifolds and warm-start impulses,
   * the constraint graph, islands and sleep timers, joints and their impulses, the broad phase). `restoreCheckpoint`
   * of these bytes in a world of the same artifact makes every later step bit-identical to this world's.
   */
  checkpoint(): Uint8Array {
    this.assertAlive();
    if(!this.supportsCheckpoints)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks exact checkpoints; rebuild with npm run build:wasm.');
    const size=this.mod._b3w_world_checkpoint!(this.handle);
    if(size===-1)throw new EngineError('INVALID_STATE','The native world has no simulation to checkpoint.');
    if(size<0)throw new EngineError('ALLOCATION_FAILED','The native checkpoint could not be allocated.');
    try {
      const pointer=Number(this.mod._b3w_world_checkpoint_ptr!(this.handle));
      if(!Number.isSafeInteger(pointer)||pointer<=0||pointer+size>this.mod.HEAPF32.buffer.byteLength)throw new EngineError('INVALID_BACKEND','Native checkpoint is outside the module heap.');
      const bytes=new Uint8Array(this.mod.HEAPF32.buffer,pointer,size).slice();
      if(this.largeConvex.size>0) {
        const rows=[...this.largeConvex].map(token=>this.mod._b3w_world_body_index!(this.handle,token)).filter(row=>row>=0);
        if(this.largeRowsByCheckpoint.size>=256)this.largeRowsByCheckpoint.delete(this.largeRowsByCheckpoint.keys().next().value!);
        this.largeRowsByCheckpoint.set(checkpointKey(bytes),rows);
      }
      this.rememberCheckpoint(checkpointDigest(bytes));
      return bytes;
    }finally{this.mod._b3w_world_checkpoint_free!(this.handle);}
  }
  /**
   * Replace this world's state with a checkpoint from `checkpoint()`. A checkpoint this world wrote since it was last
   * reset (one of the 256 it wrote or restored most recently) brings back its own handles: every handle means what it meant then, a body destroyed since is alive again
   * under its handle, and a body created since is gone (its handle stays dead, also once its slot is used again). A
   * checkpoint from elsewhere (another world built the same way, another page) keeps the handles of this world's
   * bodies, row by row. Bytes that are not a checkpoint of this artifact's format are refused and change nothing.
   */
  restoreCheckpoint(bytes: Uint8Array): void {
    this.assertAlive();
    if(!this.supportsCheckpoints)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks exact checkpoints; rebuild with npm run build:wasm.');
    if(!(bytes instanceof Uint8Array)||bytes.length===0)throw new EngineError('INVALID_PAYLOAD','A native checkpoint is a non-empty Uint8Array.');
    const pointer=Number(this.mod._malloc!(bytes.length));
    if(!Number.isSafeInteger(pointer)||pointer<=0)throw new EngineError('ALLOCATION_FAILED','Native scratch allocation failed.');
    let status: number,digest='',own=false;
    try {
      new Uint8Array(this.mod.HEAPF32.buffer,pointer,bytes.length).set(bytes);
      digest=checkpointDigest(bytes);own=typeof this.mod._b3w_world_restore_ex==='function'&&this.ownCheckpoints.includes(digest);
      status=own?this.mod._b3w_world_restore_ex!(this.handle,pointer,bytes.length,1):this.mod._b3w_world_restore!(this.handle,pointer,bytes.length);
    }finally{this.mod._free!(pointer);}
    if(status===-2)throw new EngineError('INVALID_PAYLOAD','These bytes are not a native world checkpoint of this build.');
    if(status===-3)throw new EngineError('ALLOCATION_FAILED','The native checkpoint could not be restored: out of memory. The world is unchanged.');
    if(status===-4)throw new EngineError('INVALID_PAYLOAD','Box3D refused the world snapshot; the world was reset to an empty one.');
    if(status!==1)throw new EngineError('DISPOSED','The native context rejected the restore.');
    if(own)this.rememberCheckpoint(digest);
    this.refreshStreams(true);
    this.relearnLargeConvex(bytes);
  }
  // After a restore: boxes, spheres and capsules show their size in their render rows; hulls and compounds are known
  // from the record this world kept when it made the checkpoint. A hull or compound beyond 1 km restored from bytes
  // made elsewhere is not known here (docs/ROBUSTNESS.md, known gaps).
  private relearnLargeConvex(bytes: Uint8Array): void {
    this.largeConvex.clear();
    const n=this.bodyCount(),handle=(row: number)=>BigInt.asUintN(64,this.mod._b3w_world_body_handle!(this.handle,row));
    if(this.largeRowsByCheckpoint.size>0)for(const row of this.largeRowsByCheckpoint.get(checkpointKey(bytes))??[])if(row<n)this.largeConvex.add(handle(row));
    const kinds=this.readKinds(),m=this.mod.HEAPF32,base=Number(this.matricesPtr)/4;
    for(let row=0;row<n;row++) {
      if(kinds.length>row&&kinds[row]>2)continue;
      const o=base+row*16;
      if(Math.max(Math.hypot(m[o],m[o+1],m[o+2]),Math.hypot(m[o+4],m[o+5],m[o+6]),Math.hypot(m[o+8],m[o+9],m[o+10]))>L.shape*(1+1e-6))this.largeConvex.add(handle(row));
    }
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
    const keys=['kind','origin','limit','filter'],isCast=QUERY_IS_CAST[kind];
    if(kind>=6&&!this.supportsRigidCore)throw new EngineError('UNSUPPORTED_BACKEND','box3d.wasm lacks capsule queries; rebuild with npm run build:wasm.');
    if(isCast)keys.push('translation');
    if(kind===1||kind===3||kind>=6)keys.push('radius');
    if(kind>=6)keys.push('halfLength');
    if(kind===2||kind===4||kind===5)keys.push('halfExtents');
    onlyKeys(q,keys,label);
    const origin=queryVector(q.origin,`${label}.origin`),translation=isCast?queryVector(q.translation,`${label}.translation`):[0,0,0];
    const extent=kind===1||kind===3?[finite(q.radius,`${label}.radius`,Number.MIN_VALUE,1e6),0,0]:
      kind>=6?[finite(q.radius,`${label}.radius`,Number.MIN_VALUE,1e6),finite(q.halfLength,`${label}.halfLength`,0.0025,1e6),0]:
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
      let repeats=0;
      for(let j=0;j<count;j++){
        const h=hitsPtr+(offset+j)*QUERY_HIT_BYTES,token=view.getBigUint64(h,true),fraction=view.getFloat32(h+40,true);
        const flags=view.getUint32(h+52,true),triangleIndex=view.getInt32(h+44,true),childIndex=view.getInt32(h+48,true);
        const point=[view.getFloat32(h+16,true),view.getFloat32(h+20,true),view.getFloat32(h+24,true)] as const;
        const normal=[view.getFloat32(h+28,true),view.getFloat32(h+32,true),view.getFloat32(h+36,true)] as const;
        const previous=hits[hits.length-1];
        // The bridge reports an overlap once per shape, so a body made of several shapes (a compound) appears several
        // times in a row with the same token. That is one overlapping body: keep the first and move on.
        if(!QUERY_IS_CAST[q.kind]&&previous&&previous.body.token===token&&flags===0&&triangleIndex===-1&&childIndex===-1){repeats++;continue;}
        if(flags!==Number(QUERY_IS_CAST[q.kind])||!Number.isFinite(fraction)||fraction<0||fraction>1||!point.every(Number.isFinite)||!normal.every(Number.isFinite)||
          triangleIndex< -1||childIndex< -1||token===0n||(token&0x1FFFFn)===0n||(token&0x1FFFFn)>65536n||(token>>17n)===0n||
          (previous&&(previous.fraction>fraction||(previous.fraction===fraction&&(previous.body.token>token||
            (previous.body.token===token&&(previous.triangleIndex>triangleIndex||(previous.triangleIndex===triangleIndex&&previous.childIndex>=childIndex)))))))) {
          throw new EngineError('INVALID_BACKEND','Native query returned an invalid or unordered hit.');
        }
        hits.push({body:this.wrapBody(token),point,normal,fraction,material:view.getBigUint64(h+8,true),triangleIndex,childIndex});
      }
      // Without overflow every shape hit was seen, so the count of distinct bodies is exact. With overflow the bridge's
      // total counts shapes, an upper bound on the bodies.
      const common={totalHits:overflow?total:total-repeats,overflow:Boolean(overflow)},kind=QUERY_KINDS[q.kind];
      if(kind==='ray'||kind==='sphere-cast'||kind==='box-cast'||kind==='capsule-cast')output.push({...common,kind,hits});
      else output.push({...common,kind,hits:hits.map(hit=>({body:hit.body}))});
      offset+=q.limit;
    }
    return output;
  }

  /**
   * Nearest hit of many rays, from flat arrays and into flat arrays: no object is built per ray or per hit.
   * `origins` and `translations` hold x, y, z per ray (a translation is the complete displacement, as in
   * `queryBatch`). `fractions[i]` receives the hit fraction 0..1 of ray i, or -1 when it hits nothing; the optional
   * `points` and `normals` (x, y, z per ray) and `bodies` (one body token per ray, 0 for a miss; resolve a token
   * with `bodyFromToken`) are filled for the rays that hit. Returns the number of rays that hit.
   * Each ray gives exactly the first hit of `queryBatch([{kind: 'ray', origin, translation, limit: 1, filter}])`
   * for the same float32 inputs, ties included (fraction, then body, triangle and child). With the rigid-core bridge
   * (`b3w_world_cast_rays`) each ray stops at its nearest hit instead of testing every shape along its length, which
   * is several times faster in a crowded world; an older artifact goes through the query arena, 128 rays at a time.
   * Any number of rays.
   */
  castRays(origins: Float32Array,translations: Float32Array,fractions: Float32Array,
    options: {filter?: NativeQueryFilter; points?: Float32Array; normals?: Float32Array; bodies?: BigUint64Array}={}): number {
    this.assertAlive();
    if(!this.supportsSpatialQueries)throw new EngineError('UNSUPPORTED_BACKEND','This native artifact does not support spatial queries.');
    if(!(origins instanceof Float32Array)||!(translations instanceof Float32Array)||!(fractions instanceof Float32Array))throw new EngineError('INVALID_PAYLOAD','castRays takes Float32Array origins, translations and fractions.');
    const count=fractions.length,{points,normals,bodies}=options;
    if(origins.length!==count*3||translations.length!==count*3)throw new EngineError('INVALID_PAYLOAD','origins and translations must hold three values per ray, and fractions one.');
    if((points!==undefined&&(!(points instanceof Float32Array)||points.length!==count*3))||(normals!==undefined&&(!(normals instanceof Float32Array)||normals.length!==count*3))||
      (bodies!==undefined&&(!(bodies instanceof BigUint64Array)||bodies.length!==count)))throw new EngineError('INVALID_PAYLOAD','points and normals must hold three values per ray, and bodies one.');
    // The same range the object form accepts, checked before anything is written to the heap.
    for(let i=0;i<count*3;i++)if(!(Math.abs(origins[i])<=1e6)||!(Math.abs(translations[i])<=1e6))throw new EngineError('INVALID_PAYLOAD',`ray ${Math.floor(i/3)} must have finite coordinates within 1e6.`);
    const filter=options.filter===undefined?{}:record(options.filter,'filter');
    onlyKeys(filter,['bodies','categoryBits','maskBits','ignoreBody'],'filter');
    const which=filter.bodies===undefined?'all':filter.bodies;
    if(typeof which!=='string'||!Object.hasOwn(QUERY_BODY_TYPES,which))throw new EngineError('INVALID_PAYLOAD','filter.bodies is not supported.');
    const bodyTypes=QUERY_BODY_TYPES[which as keyof typeof QUERY_BODY_TYPES],ignoreBody=filter.ignoreBody===undefined?0n:this.bodyToken(filter.ignoreBody as NativeBodyHandle);
    const categoryBits=queryBits(filter.categoryBits===undefined?0xFFFFFFFFFFFFFFFFn:filter.categoryBits,'filter.categoryBits'),maskBits=queryBits(filter.maskBits===undefined?0xFFFFFFFFFFFFFFFFn:filter.maskBits,'filter.maskBits');
    if(ignoreBody!==0n&&this.mod._b3w_world_body_index!(this.handle,ignoreBody)<0)throw new EngineError('STALE_BODY','An ignored query body has been destroyed or belongs to a previous scene.');
    // The rigid-core bridge has a closest-hit call that stops each ray at its nearest hit and orders ties as the query
    // sort does (fraction, body, triangle, child): the same hits, without testing what lies beyond them.
    if(this.mod._b3w_world_cast_rays&&this.mod._malloc&&this.mod._free)return this.castRaysClosest(origins,translations,fractions,points,normals,bodies,categoryBits,maskBits,bodyTypes,ignoreBody);
    let hitCount=0;
    for(let start=0;start<count;start+=128) {
      const n=Math.min(128,count-start),reserved=this.mod._b3w_world_query_reserve!(this.handle,n,n);
      this.queryStatus(reserved);
      if(reserved!==0)throw new EngineError('INVALID_BACKEND','Native query allocation returned an invalid status.');
      const version=this.mod._b3w_world_query_version!(this.handle)>>>0;
      const inputPtr=Number(this.mod._b3w_world_query_inputs_ptr!(this.handle)),statusPtr=Number(this.mod._b3w_world_query_status_ptr!(this.handle)),hitsPtr=Number(this.mod._b3w_world_query_hits_ptr!(this.handle));
      const ranges=[[inputPtr,n*QUERY_INPUT_BYTES],[statusPtr,n*QUERY_STATUS_BYTES],[hitsPtr,n*QUERY_HIT_BYTES]];
      let heap=this.mod.HEAPF32.buffer;
      if(version===0||ranges.some(([p,bytes])=>!Number.isSafeInteger(p)||p<=0||p%8!==0||p+bytes>heap.byteLength)||
        ranges.some(([p,bytes],i)=>ranges.some(([p2,bytes2],j)=>i<j&&p<p2+bytes2&&p2<p+bytes))) {
        throw new EngineError('INVALID_BACKEND','Native query streams overlap or lie outside the module heap.');
      }
      // The 80-byte input record, as 20 words: kind, body types, origin, translation, extent, reserved, the two masks, the ignored body, limit, padding.
      const f=new Float32Array(heap,inputPtr,n*20),u=new Uint32Array(heap,inputPtr,n*20),wide=new BigUint64Array(heap,inputPtr,n*10);
      for(let i=0;i<n;i++) {
        const w=i*20,r=(start+i)*3;
        u[w]=0;u[w+1]=bodyTypes;
        f[w+2]=origins[r];f[w+3]=origins[r+1];f[w+4]=origins[r+2];f[w+5]=translations[r];f[w+6]=translations[r+1];f[w+7]=translations[r+2];
        u[w+8]=0;u[w+9]=0;u[w+10]=0;u[w+11]=0;
        wide[i*10+6]=categoryBits;wide[i*10+7]=maskBits;wide[i*10+8]=ignoreBody;
        u[w+18]=1;u[w+19]=0;
      }
      const status=this.mod._b3w_world_query_batch!(this.handle,n,version);this.queryStatus(status);
      if(status!==n||(this.mod._b3w_world_query_version!(this.handle)>>>0)!==version+1)throw new EngineError('INVALID_BACKEND','Native query execution returned an invalid revision or count.');
      // Reacquire after the SDK: query traversal may grow the module heap.
      heap=this.mod.HEAPF32.buffer;
      const state=new Uint32Array(heap,statusPtr,n*4),hitFloats=new Float32Array(heap,hitsPtr,n*14),hitWide=new BigUint64Array(heap,hitsPtr,n*7);
      for(let i=0;i<n;i++) {
        const ray=start+i,found=state[i*4+1],total=state[i*4+2];
        // Each query was given one hit slot, so its hits start at slot i.
        if(state[i*4]!==i||found!==Math.min(total,1)||total>65536||state[i*4+3]!==Number(total>found))throw new EngineError('INVALID_BACKEND','Native query output counts are inconsistent.');
        if(found===0){fractions[ray]=-1;if(bodies)bodies[ray]=0n;continue;}
        const h=i*14,fraction=hitFloats[h+10],token=hitWide[i*7];
        if(!(fraction>=0&&fraction<=1)||token===0n)throw new EngineError('INVALID_BACKEND','Native query returned an invalid hit.');
        fractions[ray]=fraction;hitCount++;
        if(points){points[ray*3]=hitFloats[h+4];points[ray*3+1]=hitFloats[h+5];points[ray*3+2]=hitFloats[h+6];}
        if(normals){normals[ray*3]=hitFloats[h+7];normals[ray*3+1]=hitFloats[h+8];normals[ray*3+2]=hitFloats[h+9];}
        if(bodies)bodies[ray]=token;
      }
    }
    return hitCount;
  }
  private castRaysClosest(origins: Float32Array,translations: Float32Array,fractions: Float32Array,points: Float32Array|undefined,normals: Float32Array|undefined,bodies: BigUint64Array|undefined,
    categoryBits: bigint,maskBits: bigint,bodyTypes: number,ignoreBody: bigint): number {
    const count=fractions.length;
    if(count===0)return 0;
    // One buffer for up to 65,536 rays at a time: body tokens (8 bytes each), the rays (24), the hit records (32).
    const chunk=Math.min(count,65536),pointer=Number(this.mod._malloc!(chunk*(8+24+32)));
    if(!Number.isSafeInteger(pointer)||pointer<=0||pointer%8!==0)throw new EngineError('ALLOCATION_FAILED','Native ray buffer allocation failed.');
    let hitCount=0;
    try {
      for(let start=0;start<count;start+=chunk) {
        const n=Math.min(chunk,count-start),raysAt=pointer+chunk*8,hitsAt=raysAt+chunk*24;
        const rays=new Float32Array(this.mod.HEAPF32.buffer,raysAt,n*6);
        for(let i=0;i<n;i++){const r=(start+i)*3,w=i*6;rays[w]=origins[r];rays[w+1]=origins[r+1];rays[w+2]=origins[r+2];rays[w+3]=translations[r];rays[w+4]=translations[r+1];rays[w+5]=translations[r+2];}
        const status=this.mod._b3w_world_cast_rays!(this.handle,raysAt,n,categoryBits,maskBits,bodyTypes,ignoreBody,hitsAt,pointer);
        if(status===-5)throw new EngineError('STALE_BODY','An ignored query body has been destroyed or belongs to a previous scene.');
        if(status===-2)throw new EngineError('INVALID_PAYLOAD','The native bridge rejected the rays.');
        if(status<0||status>n)throw new EngineError('INVALID_BACKEND','The native ray batch returned an invalid status.');
        // Reacquire after the call: the query may grow the module heap.
        const heap=this.mod.HEAPF32.buffer,hits=new Float32Array(heap,hitsAt,n*8),tokens=new BigUint64Array(heap,pointer,n);
        for(let i=0;i<n;i++) {
          const ray=start+i,token=tokens[i],h=i*8;
          if(token===0n){fractions[ray]=-1;if(bodies)bodies[ray]=0n;continue;}
          const fraction=hits[h];
          if(!(fraction>=0&&fraction<=1))throw new EngineError('INVALID_BACKEND','Native query returned an invalid hit.');
          fractions[ray]=fraction;
          if(points){points[ray*3]=hits[h+1];points[ray*3+1]=hits[h+2];points[ray*3+2]=hits[h+3];}
          if(normals){normals[ray*3]=hits[h+4];normals[ray*3+1]=hits[h+5];normals[ray*3+2]=hits[h+6];}
          if(bodies)bodies[ray]=token;
        }
        hitCount+=status;
      }
    } finally { this.mod._free!(pointer); }
    return hitCount;
  }
  /** The body a token from `castRays` names. The reference can be stale after removal or reset; resolve it with `bodyIndex`. */
  bodyFromToken(token: bigint): NativeBodyHandle {
    this.requireBodyLifecycle();
    return this.wrapBody(token);
  }

  createScene(scene: Pick<ScenePreset,'id'>, stressScale: number, seed: number): number {
    this.assertAlive();integer(scene?.id,'scene ID',0,799);finite(stressScale,'stress scale',1,5);integer(seed,'seed',0,0xFFFFFFFF);
    const count=this.mod._b3w_world_create_scene(this.handle,scene.id,stressScale,seed);
    if(count<0)throw new EngineError('DISPOSED','Native scene creation rejected this context.');
    this.jointOwner={};this.retainedShapes?.clear();this.largeConvex.clear();this.ownCheckpoints=[];
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
    this.assertAlive();point3([x,y,z],'center');finite(strength,'strength',0,L.force);finite(radius,'radius',0,NATIVE_WORLD_EXTENT);
    this.accepted(this.mod._b3w_world_explode(this.handle,x,y,z,strength,radius));
  }
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number {
    this.assertAlive();point3([x,y,z],'position');
    within(vx,'impulse x',L.force);within(vy,'impulse y',L.force);within(vz,'impulse z',L.force);finite(size,'half-size',Number.MIN_VALUE,L.shape);
    return this.mod._b3w_world_launch_projectile(this.handle,x,y,z,vx,vy,vz,size);
  }
  spawnRain(count: number, spread: number, height: number): number {
    this.assertAlive();integer(count,'rain count',0,this.maxBodies);finite(spread,'spread',0);finite(height,'height');
    return count===0?0:this.mod._b3w_world_spawn_rain(this.handle,count,spread,height);
  }
  /** Empty this specimen while retaining its context, buffers and generation. */
  clear(): void { this.assertAlive();this.accepted(this.mod._b3w_world_clear(this.handle));this.jointOwner={};this.retainedShapes?.clear();this.largeConvex.clear();this.ownCheckpoints=[]; }
  destroy(): void {
    if(this.disposed)return;
    this.disposed=true;
    try {
      if(this.scratch!==0){this.mod._free?.(this.scratch);this.scratch=0;}
      if(this.wideScratch!==0){this.mod._free?.(this.wideScratch);this.wideScratch=0;}
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
