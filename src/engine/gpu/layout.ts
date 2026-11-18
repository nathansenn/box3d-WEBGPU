/**
 * Struct layouts shared between TypeScript and WGSL.
 *
 * `defineStruct` takes field names and WGSL types and returns the WGSL declaration together with the byte offsets WGSL
 * gives those fields (alignment and size rules of the WGSL specification, section "Alignment and Size"), and functions
 * that write and read a struct in an ArrayBuffer. The TypeScript side never repeats an offset by hand: both sides come
 * from the one definition. tests/engine/gpu-compute.test.mjs checks the offsets against hand-computed tables and the
 * sizes against the shader compiler (a buffer of exactly `size` bytes binds; one four bytes shorter is refused).
 */
import {EngineError} from '../contracts.ts';

export type GpuScalar='f32'|'u32'|'i32';
export type GpuVector='vec2f'|'vec3f'|'vec4f'|'vec2u'|'vec3u'|'vec4u'|'vec2i'|'vec3i'|'vec4i';
export type GpuMatrix='mat3x3f'|'mat4x4f';
export type GpuArray={readonly array:GpuScalar|GpuVector|GpuMatrix;readonly count:number};
export type GpuFieldType=GpuScalar|GpuVector|GpuMatrix|GpuArray;
export interface GpuField {readonly name:string;readonly type:GpuFieldType;readonly offset:number;readonly size:number;readonly align:number;
  /** Scalar kind of the components and how many there are (padding inside matrices and arrays not counted). */
  readonly scalar:GpuScalar;readonly components:number}
export type GpuStructValues=Record<string,number|ArrayLike<number>>;
export interface GpuStruct {
  readonly name:string;readonly size:number;readonly align:number;readonly fields:readonly GpuField[];
  /** Size of one element of array<Name>: the size rounded up to the alignment. */
  readonly stride:number;
  /** The WGSL declaration. */
  readonly wgsl:string;
  field(name:string):GpuField;
  /** Write the named fields of element `index` (0 by default); fields not named keep their bytes. */
  write(target:ArrayBuffer|DataView,values:GpuStructValues,index?:number):void;
  read(source:ArrayBuffer|DataView,index?:number):Record<string,number|number[]>;
  /** A zeroed buffer of `count` elements. */
  create(count?:number):ArrayBuffer;
}

const bad=(message:string):never=>{throw new EngineError('GPU_LAYOUT',message);};
const roundUp=(align:number,value:number):number=>Math.ceil(value/align)*align;
const SCALAR_OF:Record<string,GpuScalar>={f:'f32',u:'u32',i:'i32'};

interface Shape {size:number;align:number;scalar:GpuScalar;
  /** Byte offsets of the scalar components from the field's offset. */
  offsets:number[];wgsl:string}
function shape(type:GpuFieldType):Shape {
  if(typeof type==='object'){
    if(!type||!Number.isInteger(type.count)||type.count<1)bad('An array field needs a whole count of at least 1.');
    const e=shape(type.array),stride=roundUp(e.align,e.size),offsets:number[]=[];
    for(let k=0;k<type.count;k++)for(const o of e.offsets)offsets.push(k*stride+o);
    return {size:type.count*stride,align:e.align,scalar:e.scalar,offsets,wgsl:`array<${e.wgsl}, ${type.count}>`};
  }
  if(type==='f32'||type==='u32'||type==='i32')return {size:4,align:4,scalar:type,offsets:[0],wgsl:type};
  const vector=/^vec([234])([fui])$/.exec(type);
  if(vector){const n=Number(vector[1]);return {size:4*n,align:n===2?8:16,scalar:SCALAR_OF[vector[2]],offsets:Array.from({length:n},(_,k)=>4*k),wgsl:type};}
  // Matrices are arrays of column vectors: mat3x3f has three vec3f columns of stride 16.
  if(type==='mat3x3f')return {size:48,align:16,scalar:'f32',offsets:[0,4,8,16,20,24,32,36,40],wgsl:type};
  if(type==='mat4x4f')return {size:64,align:16,scalar:'f32',offsets:Array.from({length:16},(_,k)=>4*k),wgsl:type};
  return bad(`Unknown WGSL type "${String(type)}".`);
}

/**
 * A WGSL struct of the given fields, in order. `usage: 'uniform'` also checks the extra rule of uniform buffers (an
 * array's element stride must be a multiple of 16).
 */
export function defineStruct(name:string,fields:Readonly<Record<string,GpuFieldType>>,options:{readonly usage?:'uniform'|'storage'}={}):GpuStruct {
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))bad(`"${name}" is not a WGSL identifier.`);
  const list:(GpuField&{offsets:number[]})[]=[],lines:string[]=[];let offset=0,align=1;
  for(const [field,type] of Object.entries(fields)){
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))bad(`"${field}" is not a WGSL identifier.`);
    const s=shape(type);
    if(options.usage==='uniform'&&typeof type==='object'&&roundUp(s.align,shape(type.array).size)%16!==0)bad(`${name}.${field}: in a uniform buffer the elements of an array must be 16 bytes apart (use vec4 elements).`);
    offset=roundUp(s.align,offset);
    list.push({name:field,type,offset,size:s.size,align:s.align,scalar:s.scalar,components:s.offsets.length,offsets:s.offsets});
    lines.push(`  ${field}: ${s.wgsl},`);
    offset+=s.size;if(s.align>align)align=s.align;
  }
  if(list.length===0)bad(`Struct ${name} needs at least one field.`);
  const size=roundUp(align,offset),stride=size,byName=new Map(list.map(f=>[f.name,f]));
  const view=(target:ArrayBuffer|DataView):DataView=>target instanceof DataView?target:new DataView(target);
  const get=(field:string)=>byName.get(field)??bad(`Struct ${name} has no field "${field}".`);
  return {
    name,size,align,stride,fields:list,wgsl:`struct ${name} {\n${lines.join('\n')}\n}`,
    field:get,
    write(target,values,index=0){
      const v=view(target),base=index*stride;
      if(base+size>v.byteLength)bad(`Element ${index} of ${name} lies outside the buffer.`);
      for(const key of Object.keys(values)){
        const f=get(key),value=values[key],n=f.offsets.length;
        if(typeof value==='number'){if(n!==1)bad(`${name}.${key} holds ${n} numbers.`);}
        else if(value.length!==n)bad(`${name}.${key} holds ${n} numbers (got ${value.length}).`);
        for(let k=0;k<n;k++){
          const x=typeof value==='number'?value:value[k],at=base+f.offset+f.offsets[k];
          if(f.scalar==='f32')v.setFloat32(at,x,true);else if(f.scalar==='u32')v.setUint32(at,x,true);else v.setInt32(at,x,true);
        }
      }
    },
    read(source,index=0){
      const v=view(source),base=index*stride,out:Record<string,number|number[]>={};
      for(const f of list){
        const values=f.offsets.map(o=>f.scalar==='f32'?v.getFloat32(base+f.offset+o,true):f.scalar==='u32'?v.getUint32(base+f.offset+o,true):v.getInt32(base+f.offset+o,true));
        out[f.name]=values.length===1?values[0]:values;
      }
      return out;
    },
    create(count=1){return new ArrayBuffer(count*stride);},
  };
}
