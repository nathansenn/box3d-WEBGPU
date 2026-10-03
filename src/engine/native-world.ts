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
}

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
  clear(): void { this.assertAlive();this.accepted(this.mod._b3w_world_clear(this.handle)); }
  destroy(): void {
    if(this.disposed)return;
    this.disposed=true;
    try{if(this.mod._b3w_world_valid(this.handle)===1)this.mod._b3w_world_destroy(this.handle);}
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
