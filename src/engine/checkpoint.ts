/**
 * Exact checkpoints: the state trees solvers hand over, their binary encoding, and the
 * container that carries them (a format name, a version and a SHA-256 of the contents).
 *
 * A solver's `checkpoint()` returns a STATE TREE: numbers, booleans, strings, null, bigints,
 * typed arrays, arrays and plain objects of those. `encodeState` writes a tree to bytes that
 * keep every number bit for bit (float64, or int32 when the value is one), and every typed
 * array with its type; `decodeState` reads them back. Equal trees give equal bytes.
 *
 * `captureFields` / `restoreFields` write and read the state of an object by walking its own
 * fields: every number, boolean, string, typed array, array and plain object it holds is state,
 * frozen objects and functions are constants, and every other object must be named as `skip`
 * (a reference to something that is not this object's state: the world, a body, another
 * solver) or `nested` (an object with its own handler). An object field that is neither is a
 * programming error and throws, so a new field can never be left out of a checkpoint silently.
 * Restoring writes into the live arrays when their type and length match, so other objects that
 * hold the same array keep seeing it; otherwise the field gets a new array.
 *
 * Self-contained apart from contracts.ts. See docs/CHECKPOINTS.md.
 */
import {EngineError} from './contracts.ts';

export type TypedArray = Float64Array|Float32Array|Int32Array|Uint32Array|Int16Array|Uint16Array|Int8Array|Uint8Array|Uint8ClampedArray|BigInt64Array|BigUint64Array;
export type StateValue = null|undefined|boolean|number|string|bigint|TypedArray|readonly StateValue[]|StateObject;
export interface StateObject {readonly [key:string]:StateValue}

/** The error every refused checkpoint throws: wrong format or version, a damaged file, or one taken from something else. */
export const CHECKPOINT_ERROR='CHECKPOINT_MISMATCH';
export const checkpointError=(message:string):EngineError=>new EngineError(CHECKPOINT_ERROR,message);

// ---------------------------------------------------------------------------
// Binary encoding of a state tree.
// ---------------------------------------------------------------------------

const Tag={Undefined:0,Null:1,False:2,True:3,Float:4,Int:5,String:6,BigInt:7,Array:8,Object:9,Typed:10} as const;
const TYPED:readonly (new (buffer:ArrayBuffer)=>TypedArray)[]=[Float64Array,Float32Array,Int32Array,Uint32Array,Int16Array,Uint16Array,Int8Array,Uint8Array,Uint8ClampedArray,BigInt64Array,BigUint64Array];
const LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const text=new TextEncoder(),untext=new TextDecoder('utf-8',{fatal:true});

function isTyped(value:unknown):value is TypedArray {return ArrayBuffer.isView(value)&&!(value instanceof DataView);}
function isPlain(value:object):boolean {const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}

class Writer {
  private bytes=new Uint8Array(1024);private view=new DataView(this.bytes.buffer);length=0;
  private room(n:number):void {
    if(this.length+n<=this.bytes.length)return;
    let size=this.bytes.length*2;while(size<this.length+n)size*=2;
    const next=new Uint8Array(size);next.set(this.bytes.subarray(0,this.length));this.bytes=next;this.view=new DataView(next.buffer);
  }
  u8(v:number):void {this.room(1);this.bytes[this.length++]=v;}
  u32(v:number):void {this.room(4);this.view.setUint32(this.length,v,true);this.length+=4;}
  i32(v:number):void {this.room(4);this.view.setInt32(this.length,v,true);this.length+=4;}
  f64(v:number):void {this.room(8);this.view.setFloat64(this.length,v,true);this.length+=8;}
  raw(b:Uint8Array):void {this.room(b.length);this.bytes.set(b,this.length);this.length+=b.length;}
  str(s:string):void {const b=text.encode(s);this.u32(b.length);this.raw(b);}
  done():Uint8Array {return this.bytes.slice(0,this.length);}
}

function writeValue(w:Writer,value:unknown,path:string):void {
  if(value===undefined){w.u8(Tag.Undefined);return;}
  if(value===null){w.u8(Tag.Null);return;}
  switch(typeof value){
    case 'boolean':w.u8(value?Tag.True:Tag.False);return;
    case 'number':
      if(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff&&!Object.is(value,-0)){w.u8(Tag.Int);w.i32(value);}
      else{w.u8(Tag.Float);w.f64(value);}
      return;
    case 'string':w.u8(Tag.String);w.str(value);return;
    case 'bigint':w.u8(Tag.BigInt);w.str(value.toString());return;
    case 'object':break;
    default:throw new EngineError('INTERNAL',`checkpoint: ${path} is a ${typeof value}, which a state tree cannot hold.`);
  }
  if(isTyped(value)){
    const type=TYPED.findIndex(ctor=>value instanceof ctor);
    if(type<0)throw new EngineError('INTERNAL',`checkpoint: ${path} is a typed array of an unknown type.`);
    w.u8(Tag.Typed);w.u8(type);w.u32(value.length);
    w.raw(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
    return;
  }
  if(Array.isArray(value)){w.u8(Tag.Array);w.u32(value.length);for(let i=0;i<value.length;i++)writeValue(w,value[i],`${path}[${i}]`);return;}
  if(!isPlain(value as object))throw new EngineError('INTERNAL',`checkpoint: ${path} is an instance of ${(value as object).constructor?.name??'a class'}, which a state tree cannot hold.`);
  const keys=Object.keys(value as object).filter(key=>(value as Record<string,unknown>)[key]!==undefined);
  w.u8(Tag.Object);w.u32(keys.length);
  for(const key of keys){w.str(key);writeValue(w,(value as Record<string,unknown>)[key],`${path}.${key}`);}
}

/** Bytes of a state tree. Every number keeps its bits; typed arrays keep their type. Keys holding undefined are left out. */
export function encodeState(value:StateValue):Uint8Array {
  if(!LITTLE_ENDIAN)throw new EngineError('UNSUPPORTED_BACKEND','Checkpoints need a little-endian platform.');
  const w=new Writer();writeValue(w,value,'state');return w.done();
}

class Reader {
  private readonly view:DataView;readonly bytes:Uint8Array;offset=0;
  constructor(bytes:Uint8Array){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
  need(n:number):void {if(n<0||this.offset+n>this.bytes.length)throw checkpointError('The checkpoint is truncated.');}
  u8():number {this.need(1);return this.bytes[this.offset++];}
  u32():number {this.need(4);const v=this.view.getUint32(this.offset,true);this.offset+=4;return v;}
  i32():number {this.need(4);const v=this.view.getInt32(this.offset,true);this.offset+=4;return v;}
  f64():number {this.need(8);const v=this.view.getFloat64(this.offset,true);this.offset+=8;return v;}
  str():string {const n=this.u32();this.need(n);const s=untext.decode(this.bytes.subarray(this.offset,this.offset+n));this.offset+=n;return s;}
}

function readValue(r:Reader,depth:number):StateValue {
  if(depth>64)throw checkpointError('The checkpoint nests too deeply.');
  const tag=r.u8();
  switch(tag){
    case Tag.Undefined:return undefined;
    case Tag.Null:return null;
    case Tag.False:return false;
    case Tag.True:return true;
    case Tag.Float:return r.f64();
    case Tag.Int:return r.i32();
    case Tag.String:return r.str();
    case Tag.BigInt:{const s=r.str();if(!/^-?\d+$/.test(s))throw checkpointError('The checkpoint holds a malformed integer.');return BigInt(s);}
    case Tag.Typed:{
      const type=r.u8(),length=r.u32(),Ctor=TYPED[type];
      if(Ctor===undefined)throw checkpointError('The checkpoint holds a typed array of an unknown type.');
      const size=(Ctor as unknown as {BYTES_PER_ELEMENT:number}).BYTES_PER_ELEMENT*length;r.need(size);
      const copy=r.bytes.slice(r.offset,r.offset+size);r.offset+=size;
      return new Ctor(copy.buffer);
    }
    case Tag.Array:{const n=r.u32();r.need(n);const out:StateValue[]=new Array(n);for(let i=0;i<n;i++)out[i]=readValue(r,depth+1);return out;}
    case Tag.Object:{
      const n=r.u32();r.need(n);const out:Record<string,StateValue>={};
      for(let i=0;i<n;i++){const key=r.str();if(key==='__proto__')throw checkpointError('The checkpoint holds a forbidden key.');out[key]=readValue(r,depth+1);}
      return out;
    }
    default:throw checkpointError(`The checkpoint holds an unknown value tag ${tag}.`);
  }
}

/** The state tree that `encodeState` wrote. Throws CHECKPOINT_MISMATCH for bytes it did not write. */
export function decodeState(bytes:Uint8Array):StateValue {
  if(!LITTLE_ENDIAN)throw new EngineError('UNSUPPORTED_BACKEND','Checkpoints need a little-endian platform.');
  const r=new Reader(bytes),value=readValue(r,0);
  if(r.offset!==bytes.length)throw checkpointError('The checkpoint has bytes after its end.');
  return value;
}

// ---------------------------------------------------------------------------
// The container: magic, format version, SHA-256 of the body, the body.
// ---------------------------------------------------------------------------

const MAGIC=[0x42,0x33,0x43,0x4b];   // 'B3CK'
/** Version of the container and of every state tree in it. A checkpoint of another version is refused. */
export const CHECKPOINT_VERSION=1;
const HEADER=4+4+32+4;

export interface CheckpointInfo {
  /** What wrote it, e.g. 'simulation' or 'world'. */
  readonly kind:string;
  readonly version:number;
  /** SHA-256 of the body, 64 hex digits. */
  readonly hash:string;
  readonly bytes:number;
}

/** A self-checking file: 'B3CK', version, SHA-256 of the body, body length, then the body `encodeState({kind, state})`. */
export function writeCheckpoint(kind:string,state:StateValue):Uint8Array {
  const body=encodeState({kind,state}),out=new Uint8Array(HEADER+body.length),view=new DataView(out.buffer);
  out.set(MAGIC,0);view.setUint32(4,CHECKPOINT_VERSION,true);out.set(sha256(body),8);view.setUint32(40,body.length,true);out.set(body,HEADER);
  return out;
}

function header(bytes:Uint8Array):{version:number;hash:Uint8Array;body:Uint8Array} {
  if(!(bytes instanceof Uint8Array))throw checkpointError('A checkpoint is a Uint8Array.');
  if(bytes.length<HEADER||MAGIC.some((b,i)=>bytes[i]!==b))throw checkpointError('These bytes are not a box3d checkpoint (no B3CK header).');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),version=view.getUint32(4,true);
  if(version!==CHECKPOINT_VERSION)throw checkpointError(`This checkpoint has format version ${version}; this build reads version ${CHECKPOINT_VERSION} only.`);
  const length=view.getUint32(40,true);
  if(HEADER+length!==bytes.length)throw checkpointError(`The checkpoint is ${bytes.length} bytes but says it holds ${HEADER+length}: it is truncated or has bytes appended.`);
  return {version,hash:bytes.subarray(8,40),body:bytes.subarray(HEADER)};
}
const hex=(b:Uint8Array):string=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');

/** Kind, version, hash and size, from the header alone (the hash is not checked). */
export function checkpointInfo(bytes:Uint8Array):CheckpointInfo {
  const h=header(bytes),body=decodeHead(h.body);
  return {kind:body,version:h.version,hash:hex(h.hash),bytes:bytes.length};
}
function decodeHead(body:Uint8Array):string {
  // The body is an object whose first key is 'kind'.
  const r=new Reader(body);
  if(r.u8()!==Tag.Object)throw checkpointError('The checkpoint body is malformed.');
  r.u32();if(r.str()!=='kind'||r.u8()!==Tag.String)throw checkpointError('The checkpoint body is malformed.');
  return r.str();
}

/** Check the header, the version and the hash, and return the state of a checkpoint of `kind`. Throws CHECKPOINT_MISMATCH otherwise. */
export function readCheckpoint(bytes:Uint8Array,kind:string):StateValue {
  const h=header(bytes),actual=sha256(h.body);
  for(let i=0;i<32;i++)if(actual[i]!==h.hash[i])throw checkpointError('The checkpoint is damaged: its SHA-256 does not match its contents.');
  const value=decodeState(h.body) as {kind?:unknown;state?:StateValue}|null;
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.kind!=='string')throw checkpointError('The checkpoint body is malformed.');
  if(value.kind!==kind)throw checkpointError(`This is a checkpoint of a ${value.kind}, not of a ${kind}.`);
  return value.state;
}

// ---------------------------------------------------------------------------
// Reflective capture and restore of an object's fields.
// ---------------------------------------------------------------------------

/** How `captureFields` treats an object-valued field it cannot walk by itself. */
export interface FieldHandler {capture(value:unknown):StateValue;restore(value:unknown,state:StateValue,owner:Record<string,unknown>,key:string):void}
export interface FieldOptions {
  /** For messages: the class or role of the object. */
  readonly label:string;
  /** Fields that are not this object's state: the world, bodies, other solvers it only reads, configuration. */
  readonly skip?:readonly string[];
  /** Fields with their own handler. */
  readonly nested?:{readonly [key:string]:FieldHandler};
}

/** Capture a value that holds only data. Functions and frozen objects (constants) give undefined. */
export function captureValue(value:unknown,path:string):StateValue {
  if(value===null||value===undefined)return value as null|undefined;
  const type=typeof value;
  if(type==='number'||type==='boolean'||type==='string'||type==='bigint')return value as number;
  if(type==='function')return undefined;
  if(type!=='object')throw new EngineError('INTERNAL',`checkpoint: ${path} is a ${type}.`);
  if(isTyped(value))return value.slice();
  if(Object.isFrozen(value))return undefined;
  if(Array.isArray(value))return value.map((item,i)=>captureValue(item,`${path}[${i}]`));
  if(!isPlain(value as object))throw new EngineError('INTERNAL',`checkpoint: ${path} holds a ${(value as object).constructor?.name??'class instance'} that the checkpoint does not know how to save.`);
  const out:Record<string,StateValue>={};
  for(const key of Object.keys(value as object)){const v=captureValue((value as Record<string,unknown>)[key],`${path}.${key}`);if(v!==undefined)out[key]=v;}
  return out;
}

/** The value a live field takes from its saved state: typed arrays, arrays and plain objects are filled in place when their shape allows. */
export function restoreValue(live:unknown,saved:StateValue,path:string):unknown {
  // A constant (a function or a frozen object, such as a body handle) was saved as undefined: the live one stays.
  if(saved===undefined)return live!==null&&(typeof live==='function'||(typeof live==='object'&&Object.isFrozen(live)))?live:undefined;
  if(saved===null||typeof saved!=='object')return saved;
  if(isTyped(saved)){
    if(isTyped(live)&&live.constructor===saved.constructor&&live.length===saved.length){(live as Float64Array).set(saved as Float64Array);return live;}
    return saved.slice();
  }
  if(Array.isArray(saved)){
    const target=Array.isArray(live)&&!Object.isFrozen(live)?live:[];
    target.length=saved.length;
    for(let i=0;i<saved.length;i++)target[i]=restoreValue(target[i],saved[i],`${path}[${i}]`);
    return target;
  }
  if(typeof live==='object'&&live!==null&&!isTyped(live)&&!Array.isArray(live)&&!Object.isFrozen(live)&&isPlain(live)){
    for(const key of Object.keys(saved)){
      if(key==='__proto__')throw checkpointError(`${path} holds a forbidden key.`);
      (live as Record<string,unknown>)[key]=restoreValue((live as Record<string,unknown>)[key],(saved as StateObject)[key],`${path}.${key}`);
    }
    return live;
  }
  const out:Record<string,unknown>={};
  for(const key of Object.keys(saved)){if(key==='__proto__')throw checkpointError(`${path} holds a forbidden key.`);out[key]=restoreValue(undefined,(saved as StateObject)[key],`${path}.${key}`);}
  return out;
}

/** The state of an object, field by field. See the module comment for which fields count. */
export function captureFields(target:object,options:FieldOptions):StateObject {
  const out:Record<string,StateValue>={},skip=new Set(options.skip??[]),nested=options.nested??{};
  for(const key of Object.keys(target)){
    if(skip.has(key))continue;
    const value=(target as Record<string,unknown>)[key];
    if(Object.hasOwn(nested,key)){out[key]=nested[key].capture(value);continue;}
    const v=captureValue(value,`${options.label}.${key}`);
    if(v!==undefined)out[key]=v;
  }
  return out;
}

/** Write a state from `captureFields` back into an object of the same kind. A field the object does not have, or a state
 * that misses one the object has, is refused with CHECKPOINT_MISMATCH before anything is written. */
export function restoreFields(target:object,state:StateValue,options:FieldOptions):void {
  if(!state||typeof state!=='object'||Array.isArray(state)||isTyped(state))throw checkpointError(`${options.label}: the saved state is not an object.`);
  const saved=state as StateObject,live=target as Record<string,unknown>,skip=new Set(options.skip??[]),nested=options.nested??{};
  for(const key of Object.keys(saved))if(!Object.hasOwn(live,key)||skip.has(key))throw checkpointError(`${options.label}: the checkpoint has a field "${key}" that this ${options.label} does not; it was written by another version or for another solver.`);
  for(const key of Object.keys(live)){
    if(skip.has(key)||Object.hasOwn(saved,key))continue;
    const value=live[key];
    if(Object.hasOwn(nested,key)||captureValue(value,`${options.label}.${key}`)!==undefined)throw checkpointError(`${options.label}: the checkpoint has no "${key}"; it was written by another version or for another solver.`);
  }
  for(const key of Object.keys(saved)){
    if(Object.hasOwn(nested,key)){nested[key].restore(live[key],saved[key],live,key);continue;}
    live[key]=restoreValue(live[key],saved[key],`${options.label}.${key}`);
  }
}

/** A handler for a field that holds a list of objects whose length the checkpoint must match (the bodies a coupling
 * holds, the walls of a grain set): class instances by `captureFields` with `options`, plain objects as data. The list
 * keeps its elements (and their identity); a saved list of another length is refused. */
export function eachElement(options:FieldOptions):FieldHandler {
  const one=(item:unknown,path:string):StateValue=>item!==null&&typeof item==='object'&&!isPlain(item)?captureFields(item,options):captureValue(item,path);
  return {
    capture:value=>(value as unknown[]).map((item,i)=>one(item,`${options.label}[${i}]`)),
    restore:(value,state)=>{
      const live=value as unknown[],saved=state as StateValue[];
      if(!Array.isArray(saved)||saved.length!==live.length)throw checkpointError(`${options.label}: the checkpoint has ${Array.isArray(saved)?saved.length:'no'} entries, this simulation ${live.length}.`);
      for(let i=0;i<live.length;i++){
        const item=live[i];
        if(item!==null&&typeof item==='object'&&!isPlain(item))restoreFields(item,saved[i],options);
        else live[i]=restoreValue(item,saved[i],`${options.label}[${i}]`);
      }
    },
  };
}
/** A handler for a field that holds one object of a class, by `captureFields` with `options`. Null stays null. */
export function oneObject(options:FieldOptions):FieldHandler {
  return {
    capture:value=>value===null||value===undefined?null:captureFields(value as object,options),
    restore:(value,state)=>{
      if(state===null||state===undefined){if(value!==null&&value!==undefined)throw checkpointError(`${options.label}: the checkpoint has none, this simulation has one.`);return;}
      if(value===null||value===undefined)throw checkpointError(`${options.label}: the checkpoint has one, this simulation has none.`);
      restoreFields(value as object,state,options);
    },
  };
}
/** Something with its own `saveState()` / `restoreState()`: a solver held by a coupling. */
export interface StateHolder {saveState():StateObject;restoreState(state:StateValue):void}
/** A handler for a field that holds a solver with `saveState()` / `restoreState()`. */
export const holder:FieldHandler={
  capture:value=>(value as StateHolder).saveState(),
  restore:(value,state)=>(value as StateHolder).restoreState(state),
};
/** A field that is not state at all (used where a field must be named but holds nothing to save). */
export const IGNORE:FieldHandler={capture:()=>undefined,restore:()=>{}};

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), synchronous so that checkpoints can be written and checked in one call.
// ---------------------------------------------------------------------------

const SHA_K=(()=>{
  const k=new Uint32Array(64);
  for(let n=2,i=0;i<64;n++){
    let prime=true;
    for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}
    if(prime)k[i++]=(Math.cbrt(n)%1)*0x100000000;
  }
  return k;
})();

/** SHA-256 of `data` as 32 bytes. */
export function sha256(data:Uint8Array):Uint8Array {
  const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64);
  const total=((data.length+9+63)>>6)<<6,tail=new Uint8Array(128),tailView=new DataView(tail.buffer);
  // Whole blocks are read from `data`; only the last one or two are copied, with the padding.
  const full=Math.floor(data.length/64),rest=data.length-full*64,tailLength=total-full*64;
  tail.set(data.subarray(full*64));tail[rest]=0x80;
  tailView.setUint32(tailLength-8,Math.floor(data.length/0x20000000));tailView.setUint32(tailLength-4,(data.length<<3)>>>0);
  const dataView=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
  const block=(view:DataView,o:number)=>{
    for(let i=0;i<16;i++)w[i]=view.getUint32(o+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=w[i-16]+(rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-7]+(rotr(b,17)^rotr(b,19)^(b>>>10));}
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for(let i=0;i<64;i++){
      const t1=(hh+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+SHA_K[i]+w[i])|0;
      const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;
      hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
    }
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
  };
  for(let o=0;o<full*64;o+=64)block(dataView,o);
  for(let o=0;o<tailLength;o+=64)block(tailView,o);
  const out=new Uint8Array(32),view=new DataView(out.buffer);
  for(let i=0;i<8;i++)view.setUint32(4*i,h[i]);
  return out;
}
/** SHA-256 as 64 lowercase hex digits. */
export const sha256Hex=(data:Uint8Array):string=>hex(sha256(data));
