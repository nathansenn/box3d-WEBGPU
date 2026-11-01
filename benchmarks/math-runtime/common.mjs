export const SCHEMA_VERSION='box3d-math-runtime-benchmark/1';
export const DEFAULT_SETTINGS={seed:0x5eeda123,samples:21,warmupBatches:5,transferSamples:7,budgetMs:120000,cases:[
{id:'48x40',cols:48,rows:40,batchSteps:16,checkpoints:[1,2,8,64,256,1024]},
{id:'96x80',cols:96,rows:80,batchSteps:16,checkpoints:[1,2,8,64,256,1024]},
{id:'256x256',cols:256,rows:256,batchSteps:4,checkpoints:[1,2,8,64]},
{id:'512x512',cols:512,rows:512,batchSteps:4,checkpoints:[1,2,8,64]}],tolerance:{absolute:2e-5,relative:2e-4}};
export const FIELD_NAMES=['eta','u','v'];
export const now=()=>performance.now();
export const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
export const message=e=>e instanceof Error?e.name+': '+e.message:String(e);
export function makeRng(seed){let v=seed>>>0;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
export function fixture(grid,seed){
 const random=makeRng(seed),count=grid.cols*grid.rows;
 const initial=Object.fromEntries(FIELD_NAMES.map(n=>[n,new Float32Array(count)])),history=Object.fromEntries(FIELD_NAMES.map(n=>[n,new Float32Array(count)]));
 for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.cols;x++){
  const i=z*grid.cols+x,px=x/(grid.cols-1),pz=z/(grid.rows-1);
  initial.eta[i]=.15*Math.sin(px*Math.PI*2.1+.17)*Math.cos(pz*Math.PI*1.7)+(random()-.5)*.012;
  initial.u[i]=(random()-.5)*.04+.002;initial.v[i]=(random()-.5)*.04-.003;
  history.eta[i]=(random()-.5)*.08+.004;history.u[i]=(random()-.5)*.025+.001;history.v[i]=(random()-.5)*.025-.002;
 }
 const dx=34/(grid.cols-1),dz=24/(grid.rows-1),gravity=9.81,meanDepth=1.55;
 return {initial,history,seed:seed>>>0,physicalExtent:{width:34,depth:24},params:{dt:Math.min(1/120,.2*Math.min(dx,dz)/Math.sqrt(gravity*meanDepth)),gravity,meanDepth,drag:.33,invTwoDx:1/(2*dx),invTwoDz:1/(2*dz)}};
}
export const copyFields=fields=>Object.fromEntries(FIELD_NAMES.map(n=>[n,fields[n].slice()]));
export function copyInto(target,source){for(const n of FIELD_NAMES)target[n].set(source[n]);}
export function distribution(values,divisor=1){
 if(!values.length)return null;const sorted=values.map(v=>v/divisor).sort((a,b)=>a-b);
 const percentile=f=>{const p=(sorted.length-1)*f,lo=Math.floor(p),hi=Math.ceil(p);return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo);};
 return {unit:'ms/step',samples:sorted.length,zeroSamples:sorted.filter(v=>v===0).length,resolutionCaveat:sorted.some(v=>v===0)?'Zero samples are below timer resolution, not zero work.':null,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),min:sorted[0],max:sorted.at(-1),mean:sorted.reduce((s,v)=>s+v,0)/sorted.length,raw:values.map(v=>v/divisor)};
}
export function compareArray(reference,actual,tolerance){
 if(reference.length!==actual.length)return {pass:false,reason:'length mismatch'};
 let maxAbsolute=0,maxNormalized=0,sumSquared=0,failures=0,nonFinite=0,worstIndex=0,exactMatches=0;
 for(let i=0;i<reference.length;i++){
  const expected=reference[i],value=actual[i];if(!Number.isFinite(expected)||!Number.isFinite(value)){nonFinite++;failures++;worstIndex=i;continue;}
  if(Object.is(expected,value))exactMatches++;
  const error=Math.abs(expected-value),allowance=tolerance.absolute+tolerance.relative*Math.abs(expected),normalized=allowance>0?error/allowance:error===0?0:Infinity;
  if(normalized>maxNormalized){maxNormalized=normalized;worstIndex=i;}maxAbsolute=Math.max(maxAbsolute,error);sumSquared+=error*error;if(normalized>1)failures++;
 }
 return {pass:failures===0,count:reference.length,exactMatches,failures,nonFinite,maxAbsolute,rmsAbsolute:Math.sqrt(sumSquared/Math.max(1,reference.length)),maxNormalized,worstIndex,expectedAtWorst:reference[worstIndex],actualAtWorst:actual[worstIndex]};
}
export function compareSnapshots(reference,actual,tolerance){
 const fields={};for(const bank of ['current','destination'])for(const n of FIELD_NAMES)fields[bank+'.'+n]=compareArray(reference[bank][n],actual[bank][n],tolerance);
 return {pass:reference.steps===actual.steps&&Object.values(fields).every(v=>v.pass),expectedSteps:reference.steps,actualSteps:actual.steps,tolerance,fields};
}
export async function sha256(value){const d=await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value);return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function fixtureHash(data){const joined=new Float32Array(data.initial.eta.length*6);let offset=0;for(const bank of [data.initial,data.history])for(const n of FIELD_NAMES){joined.set(bank[n],offset);offset+=data.initial.eta.length;}return sha256(joined.buffer);}
export function hardwareClassification(info={}){const s=[info.vendor,info.architecture,info.device,info.description].filter(Boolean).join(' ');return info.isFallbackAdapter||/swiftshader|llvmpipe|lavapipe|software|\bwarp\b/i.test(s)?'software':'unclassified';}

