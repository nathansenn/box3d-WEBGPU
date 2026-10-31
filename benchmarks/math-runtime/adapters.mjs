import {FIELD_NAMES,copyFields,copyInto} from './common.mjs';
export function javascriptAdapter(api,grid,data,mode='javascript'){
 const state=api.createWaterReference(grid,data.initial,data.history);
 return {name:mode==='javascript'?'javascript-reference':'f32-reference',reset(){copyInto(state.current,data.initial);copyInto(state.destination,data.history);state.steps=0;},step(p){api.stepWaterReference(state,p,mode);},snapshot(){return api.snapshotWaterReference(state);},dispose(){}};
}
export async function wasmAdapter(bytes,variant,grid,data){
 const {instance}=await WebAssembly.instantiate(bytes,{}),exports=instance.exports;
 if(!(exports.memory instanceof WebAssembly.Memory)||exports.soft_version()!==0x00010100||exports.soft_variant()!==(variant==='simd'?1:0))throw new Error('Unexpected WASM ABI or variant');
 exports.soft_reset();const count=grid.cols*grid.rows,pointers=[[],[]];
 for(const bank of pointers)for(const field of FIELD_NAMES){const p=exports.soft_alloc(count*4,16);if(!p)throw new Error('Allocation failed '+field);bank.push(p);}
 // Allocate all buffers before retaining views, because memory.grow detaches them.
 const banks=pointers.map(ps=>Object.fromEntries(FIELD_NAMES.map((n,i)=>[n,new Float32Array(exports.memory.buffer,ps[i],count)])));
 let current=0,steps=0;const reset=()=>{current=0;steps=0;copyInto(banks[0],data.initial);copyInto(banks[1],data.history);};reset();
 return {name:'wasm-'+variant,reset,step(p){if(!exports.soft_water_step(...pointers[current],...pointers[1-current],grid.cols,grid.rows,p.dt,p.gravity,p.meanDepth,p.drag,p.invTwoDx,p.invTwoDz))throw new Error('WASM rejected input');current=1-current;steps++;},snapshot(){return {current:copyFields(banks[current]),destination:copyFields(banks[1-current]),steps};},dispose(){}};
}

