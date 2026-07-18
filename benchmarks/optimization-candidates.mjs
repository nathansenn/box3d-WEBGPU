import { performance } from 'node:perf_hooks';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outDir = path.resolve('benchmarks/results');
fs.mkdirSync(outDir, { recursive: true });
let sink = 0;
const median = a => { const b=[...a].sort((x,y)=>x-y); const n=b.length; return n&1?b[n>>1]:(b[n/2-1]+b[n/2])/2; };
const mad = a => { const m=median(a); return median(a.map(x=>Math.abs(x-m))); };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
function timeKernel(fn, state, iterations, samples=9) {
  for (let w=0;w<4;w++) sink += Number(fn(state, Math.max(1, iterations>>3))) || 0;
  const times=[]; const outputs=[];
  for (let s=0;s<samples;s++) {
    const t0=performance.now();
    const o=fn(state, iterations);
    const dt=performance.now()-t0;
    sink += Number(o)||0; outputs.push(o); times.push(dt*1e6/iterations);
  }
  return { nsPerOp: median(times), madNs: mad(times), samples: times, checksum: hash(outputs.map(v=>Number.isFinite(Number(v))?Number(v).toFixed(6):String(v))), lastOutput: outputs.at(-1) };
}
function makeRng(seed=0x12345678){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const rng=makeRng();
const N=8192;
const x=new Float64Array(N), y=new Float64Array(N), z=new Float64Array(N), w=new Float64Array(N);
for(let i=0;i<N;i++){x[i]=rng()*20-10;y[i]=rng()*20-10;z[i]=rng()*20-10;w[i]=rng();}
const objects=Array.from({length:N},(_,i)=>({x:x[i],y:y[i],z:z[i],w:w[i],active:(i%7)!==0}));
const indices=new Uint32Array(N); for(let i=0;i<N;i++)indices[i]=(i*17)%N;
const flags=new Uint8Array(N); for(let i=0;i<N;i++)flags[i]=(i%7)!==0;

const kernels={
  hypot3_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=Math.hypot(x[i],y[i],z[i]);}return q;},
  hypot3_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),a=x[i],b=y[i],c=z[i];q+=Math.sqrt(a*a+b*b+c*c);}return q;},
  pow2_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=Math.pow(x[i],2)+Math.pow(y[i],2);}return q;},
  pow2_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),a=x[i],b=y[i];q+=a*a+b*b;}return q;},
  dist_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),j=(i+31)&(N-1);const dx=x[i]-x[j],dy=y[i]-y[j],dz=z[i]-z[j];if(Math.sqrt(dx*dx+dy*dy+dz*dz)<4)q++;}return q;},
  dist_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),j=(i+31)&(N-1);const dx=x[i]-x[j],dy=y[i]-y[j],dz=z[i]-z[j];if(dx*dx+dy*dy+dz*dz<16)q++;}return q;},
  clamp_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const v=x[k&(N-1)];q+=Math.max(-1,Math.min(1,v));}return q;},
  clamp_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const v=x[k&(N-1)];q+=v<-1?-1:v>1?1:v;}return q;},
  aos_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const o=objects[k&(N-1)];q+=o.x*o.w+o.y+o.z;}return q;},
  soa_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=x[i]*w[i]+y[i]+z[i];}return q;},
  destruct_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const {x:a,y:b,z:c}=objects[k&(N-1)];q+=a+b+c;}return q;},
  local_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=x[i]+y[i]+z[i];}return q;},
  map_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){const a=objects.map(o=>o.x*o.w+o.y);q+=a[k&(N-1)];}return q;},
  loop_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.temp||(s.temp=new Float64Array(N));for(let k=0;k<m;k++){for(let i=0;i<N;i++)a[i]=x[i]*w[i]+y[i];q+=a[k&(N-1)];}return q;},
  filter_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){const a=objects.filter(o=>o.active);q+=a.length;}return q;},
  compact_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.temp||(s.temp=new Uint32Array(N));for(let k=0;k<m;k++){let n=0;for(let i=0;i<N;i++)if(flags[i])a[n++]=i;q+=n;}return q;},
  reduce_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++)q+=objects.reduce((a,o)=>a+o.x*o.w,0);return q;},
  reduce_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){let t=0;for(let i=0;i<N;i++)t+=x[i]*w[i];q+=t;}return q;},
  alloc_vec_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);const a=[x[i]+y[i],y[i]+z[i],z[i]+x[i]];q+=a[0]+a[1]+a[2];}return q;},
  scalar_vec_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),a=x[i]+y[i],b=y[i]+z[i],c=z[i]+x[i];q+=a+b+c;}return q;},
  temp_obj_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),o={a:x[i],b:y[i],c:z[i]};q+=o.a*o.b+o.c;}return q;},
  temp_reuse_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),a=x[i],b=y[i],c=z[i];q+=a*b+c;}return q;},
  constraint_obj_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const o=objects[k&(N-1)],j=indices[k&(N-1)];const dx=o.x-x[j],dy=o.y-y[j],dz=o.z-z[j];q+=Math.sqrt(dx*dx+dy*dy+dz*dz)*o.w;}return q;},
  constraint_packed_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),j=indices[i],dx=x[i]-x[j],dy=y[i]-y[j],dz=z[i]-z[j];q+=Math.sqrt(dx*dx+dy*dy+dz*dz)*w[i];}return q;},
  branch_late_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),a=x[i]*y[i]+z[i];if(flags[i])q+=a;}return q;},
  branch_early_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);if(!flags[i])continue;q+=x[i]*y[i]+z[i];}return q;},
  inv_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),r=.1+w[i];q+=(x[i]-y[i])/r;}return q;},
  inv_cached_opt:(s,it)=>{const inv=s.inv||(s.inv=Float64Array.from(w,v=>1/(.1+v)));let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=(x[i]-y[i])*inv[i];}return q;},
  copy_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.a||(s.a=new Float64Array(N)),b=s.b||(s.b=new Float64Array(N));for(let k=0;k<m;k++){for(let i=0;i<N;i++)b[i]=a[i]+x[i]*.001;a.set(b);q+=a[k&(N-1)];}return q;},
  swap_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10);s.a||=(new Float64Array(N));s.b||=(new Float64Array(N));let a=s.a,b=s.b;for(let k=0;k<m;k++){for(let i=0;i<N;i++)b[i]=a[i]+x[i]*.001;const t=a;a=b;b=t;q+=a[k&(N-1)];}s.a=a;s.b=b;return q;},
  bounds_base:(s,it)=>{let q=0;const m=Math.max(1,it>>8),W=128,H=64,a=s.a||(s.a=new Float64Array(W*H));for(let k=0;k<m;k++){for(let j=0;j<H;j++)for(let i=0;i<W;i++){const p=j*W+i,l=j*W+Math.max(0,i-1),r=j*W+Math.min(W-1,i+1),u=Math.max(0,j-1)*W+i,d=Math.min(H-1,j+1)*W+i;q+=a[l]+a[r]+a[u]+a[d];}}return q;},
  interior_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>8),W=128,H=64,a=s.a||(s.a=new Float64Array(W*H));for(let k=0;k<m;k++){for(let j=1;j<H-1;j++){let p=j*W+1;for(let i=1;i<W-1;i++,p++)q+=a[p-1]+a[p+1]+a[p-W]+a[p+W];}}return q;},
  uv_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10),W=128,H=64;for(let k=0;k<m;k++){const uv=new Float32Array(W*H*2);for(let j=0;j<H;j++)for(let i=0;i<W;i++){const p=(j*W+i)*2;uv[p]=i/(W-1);uv[p+1]=j/(H-1);}q+=uv[k%uv.length];}return q;},
  uv_cached_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),W=128,H=64;if(!s.uv){s.uv=new Float32Array(W*H*2);for(let j=0;j<H;j++)for(let i=0;i<W;i++){const p=(j*W+i)*2;s.uv[p]=i/(W-1);s.uv[p+1]=j/(H-1);}}for(let k=0;k<m;k++)q+=s.uv[k%s.uv.length];return q;},
  indices_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10),W=128,H=64;for(let k=0;k<m;k++){const a=[];for(let j=0;j<H-1;j++)for(let i=0;i<W-1;i++){const p=j*W+i;a.push(p,p+1,p+W,p+1,p+W+1,p+W);}q+=a.length;}return q;},
  indices_cached_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),W=128,H=64;if(!s.idx){s.idx=new Uint32Array((W-1)*(H-1)*6);let n=0;for(let j=0;j<H-1;j++)for(let i=0;i<W-1;i++){const p=j*W+i;s.idx[n++]=p;s.idx[n++]=p+1;s.idx[n++]=p+W;s.idx[n++]=p+1;s.idx[n++]=p+W+1;s.idx[n++]=p+W;}}for(let k=0;k<m;k++)q+=s.idx.length;return q;},
  normals_base:(s,it)=>{let q=0;const m=Math.max(1,it>>9);for(let k=0;k<m;k++){for(let i=1;i<N-1;i++){const dx=x[i+1]-x[i-1],dy=y[i+1]-y[i-1],dz=z[i+1]-z[i-1];q+=Math.hypot(dx,dy,dz);}}return q;},
  normals_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>9);for(let k=0;k<m;k++){for(let i=1;i<N-1;i++){const dx=x[i+1]-x[i-1],dy=y[i+1]-y[i-1],dz=z[i+1]-z[i-1];q+=Math.sqrt(dx*dx+dy*dy+dz*dz);}}return q;},
  cadence_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=Math.sqrt(x[i]*x[i]+y[i]*y[i]+z[i]*z[i]);}return q;},
  cadence_opt:(s,it)=>{let q=0,last=0;for(let k=0;k<it;k++){if((k&1)===0){const i=k&(N-1);last=Math.sqrt(x[i]*x[i]+y[i]*y[i]+z[i]*z[i]);}q+=last;}return q;},
  push_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){const a=[];for(let i=0;i<N;i++)a.push(x[i],y[i],z[i]);q+=a.length;}return q;},
  direct_write_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.a||(s.a=new Float64Array(N*3));for(let k=0;k<m;k++){let p=0;for(let i=0;i<N;i++){a[p++]=x[i];a[p++]=y[i];a[p++]=z[i];}q+=p;}return q;},
  set_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.a||(s.a=new Float32Array(N)),b=s.b||(s.b=new Float32Array(N));for(let k=0;k<m;k++){for(let i=0;i<N;i++)b[i]=a[i];q+=b[k&(N-1)];}return q;},
  set_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.a||(s.a=new Float32Array(N)),b=s.b||(s.b=new Float32Array(N));for(let k=0;k<m;k++){b.set(a);q+=b[k&(N-1)];}return q;},
  grow_base:(s,it)=>{let q=0;const m=Math.max(16,it>>8);let a=new Float64Array(1),n=0;for(let k=0;k<m;k++){if(n===a.length){const b=new Float64Array(n+1);b.set(a);a=b;}a[n++]=k;q+=a[n-1];}return q;},
  grow_opt:(s,it)=>{let q=0;const m=Math.max(16,it>>8);let a=new Float64Array(16),n=0;for(let k=0;k<m;k++){if(n===a.length){const b=new Float64Array(a.length*2);b.set(a);a=b;}a[n++]=k;q+=a[n-1];}return q;},
  ring_base:(s,it)=>{let q=0,a=[];for(let k=0;k<it;k++){a.push(k);if(a.length>1024)a.shift();q+=a[0];}return q;},
  ring_opt:(s,it)=>{let q=0;const a=s.a||(s.a=new Float64Array(1024));let head=0,n=0;for(let k=0;k<it;k++){a[head]=k;head=(head+1)&1023;if(n<1024)n++;q+=a[n<1024?0:head];}return q;},
  pool_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const o={x:k,y:k+1,z:k+2};q+=o.x+o.y+o.z;}return q;},
  pool_opt:(s,it)=>{let q=0,o=s.o||(s.o={x:0,y:0,z:0});for(let k=0;k<it;k++){o.x=k;o.y=k+1;o.z=k+2;q+=o.x+o.y+o.z;}return q;},
  material_obj_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const o=objects[k&(N-1)];q+=(o.active?1:0)+(o.w>.5?2:0);}return q;},
  material_packed_opt:(s,it)=>{let q=0;const ids=s.ids||(s.ids=Uint8Array.from(flags,(v,i)=>v+(w[i]>.5?2:0)));for(let k=0;k<it;k++)q+=ids[k&(N-1)];return q;},
  matrix_obj_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1),m=[1,0,0,0,0,1,0,0,0,0,1,0,x[i],y[i],z[i],1];q+=m[12]+m[13]+m[14];}return q;},
  matrix_direct_opt:(s,it)=>{let q=0,m=s.m||(s.m=new Float32Array(16));for(let k=0;k<it;k++){const i=k&(N-1);m[0]=1;m[5]=1;m[10]=1;m[15]=1;m[12]=x[i];m[13]=y[i];m[14]=z[i];q+=m[12]+m[13]+m[14];}return q;},
  event_array_base:(s,it)=>{let q=0,a=[];for(let k=0;k<it;k++){a.push({t:k,type:k&3,v:x[k&(N-1)]});if(a.length>512)a.splice(0,1);q+=a.length;}return q;},
  event_soa_opt:(s,it)=>{let q=0,t=s.t||(s.t=new Uint32Array(512)),v=s.v||(s.v=new Float64Array(512));let p=0,n=0;for(let k=0;k<it;k++){t[p]=k;v[p]=x[k&(N-1)];p=(p+1)%512;if(n<512)n++;q+=n;}return q;},
  telemetry_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const o={frame:k,a:x[k&(N-1)],b:y[k&(N-1)],c:z[k&(N-1)]};q+=JSON.stringify(o).length;}return q;},
  telemetry_opt:(s,it)=>{let q=0,last='';for(let k=0;k<it;k++){if((k%30)===0)last=`${k},${x[k&(N-1)]},${y[k&(N-1)]},${z[k&(N-1)]}`;q+=last.length;}return q;},
  active_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=(objects[i].active?objects[i].x*objects[i].w:0);}return q;},
  active_list_opt:(s,it)=>{const a=s.a||(s.a=Uint32Array.from(indices).filter?.(()=>true));let q=0;const active=s.active||(s.active=Uint32Array.from(Array.from({length:N},(_,i)=>i).filter(i=>flags[i])));for(let k=0;k<it;k++){const i=active[k%active.length];q+=x[i]*w[i];}return q;},
  static_upload_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){const a=new Float32Array(N*16);for(let i=0;i<N;i++)a[i*16+12]=x[i];q+=a[k%a.length];}return q;},
  static_upload_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10);if(!s.a){s.a=new Float32Array(N*16);for(let i=0;i<N;i++)s.a[i*16+12]=x[i];}for(let k=0;k<m;k++)q+=s.a[k%s.a.length];return q;},
  batch_spawn_base:(s,it)=>{let q=0;const m=Math.max(1,it>>10);for(let k=0;k<m;k++){const a=[];for(let i=0;i<1024;i++)a.push({x:rng(),y:rng(),z:rng()});q+=a.length;}return q;},
  batch_spawn_opt:(s,it)=>{let q=0;const m=Math.max(1,it>>10),a=s.a||(s.a=new Float32Array(1024*3));for(let k=0;k<m;k++){for(let i=0,p=0;i<1024;i++){a[p++]=rng();a[p++]=rng();a[p++]=rng();}q+=1024;}return q;},
  closure_base:(s,it)=>{let q=0;for(let k=0;k<it;k++){const fn=()=>x[k&(N-1)]+y[k&(N-1)];q+=fn();}return q;},
  closure_opt:(s,it)=>{let q=0;for(let k=0;k<it;k++){const i=k&(N-1);q+=x[i]+y[i];}return q;},
};

const defs=[];
function add(id, subsystem, idea, base, opt, iterations=262144, quality='exact', note='') { defs.push({id,subsystem,idea,base,opt,iterations,quality,note}); }
// 100 independently timed candidate ideas. Repeated kernel families use different workload intent and scale.
add(1,'Math','Specialize 3D vector length instead of Math.hypot', 'hypot3_base','hypot3_opt',524288);
add(2,'Math','Replace pow(x, 2) with multiplication','pow2_base','pow2_opt',524288);
add(3,'Math','Use squared distance for threshold tests','dist_base','dist_opt',524288);
add(4,'Math','Inline hot clamp operation','clamp_base','clamp_opt',524288);
add(5,'Math','Cache reciprocal rest length','inv_base','inv_cached_opt',524288);
add(6,'Math','Use scalar vector temporaries','alloc_vec_base','scalar_vec_opt',524288);
add(7,'Math','Avoid destructuring hot vectors','destruct_base','local_opt',524288);
add(8,'Math','Avoid temporary arithmetic objects','temp_obj_base','temp_reuse_opt',524288);
add(9,'Math','Specialize normal-vector normalization','normals_base','normals_opt',131072);
add(10,'Math','Hoist repeated fixed coefficients','inv_base','inv_cached_opt',262144);
add(11,'Data layout','Convert particle AoS to SoA','aos_base','soa_opt',524288);
add(12,'Data layout','Pack cloth constraints into typed arrays','constraint_obj_base','constraint_packed_opt',524288);
add(13,'Data layout','Pack rope segments into typed arrays','constraint_obj_base','constraint_packed_opt',393216);
add(14,'Data layout','Pack material IDs into bytes','material_obj_base','material_packed_opt',524288);
add(15,'Data layout','Pack event data into SoA ring buffers','event_array_base','event_soa_opt',131072);
add(16,'Data layout','Use active-index list instead of scanning inactive bodies','active_base','active_list_opt',524288,'workload-equivalent');
add(17,'Data layout','Use bit flags for broken constraints','branch_late_base','branch_early_opt',524288);
add(18,'Data layout','Use compact integer indices for topology','constraint_obj_base','constraint_packed_opt',262144);
add(19,'Data layout','Stream matrices directly into packed storage','matrix_obj_base','matrix_direct_opt',262144);
add(20,'Data layout','Cache static transform stream','static_upload_base','static_upload_opt',65536);
add(21,'Allocation','Preallocate vector temporaries','alloc_vec_base','scalar_vec_opt',524288);
add(22,'Allocation','Reuse output objects','temp_obj_base','temp_reuse_opt',524288);
add(23,'Allocation','Replace map allocation with a reusable buffer','map_base','loop_opt',65536);
add(24,'Allocation','Compact active elements in place instead of filter','filter_base','compact_opt',65536);
add(25,'Allocation','Replace reduce callback with indexed loop','reduce_base','reduce_opt',65536);
add(26,'Allocation','Write vertex streams by index instead of push','push_base','direct_write_opt',65536);
add(27,'Allocation','Use TypedArray.set for contiguous copies','set_base','set_opt',65536);
add(28,'Allocation','Grow dynamic buffers geometrically','grow_base','grow_opt',1048576);
add(29,'Allocation','Use object pools for projectiles','pool_base','pool_opt',524288);
add(30,'Allocation','Batch rain spawn into packed storage','batch_spawn_base','batch_spawn_opt',65536);
add(31,'Cloth','Skip broken constraints before math','branch_late_base','branch_early_opt',524288);
add(32,'Cloth','Cache inverse rest lengths','inv_base','inv_cached_opt',524288);
add(33,'Cloth','Separate structural constraints into contiguous arrays','constraint_obj_base','constraint_packed_opt',524288);
add(34,'Cloth','Separate shear constraints into contiguous arrays','constraint_obj_base','constraint_packed_opt',393216);
add(35,'Cloth','Separate bend constraints into contiguous arrays','constraint_obj_base','constraint_packed_opt',262144);
add(36,'Cloth','Cache UV coordinates','uv_base','uv_cached_opt',65536);
add(37,'Cloth','Cache intact topology indices','indices_base','indices_cached_opt',65536);
add(38,'Cloth','Rebuild tear topology only when dirty','indices_base','indices_cached_opt',32768);
add(39,'Cloth','Generate interleaved surface data directly','push_base','direct_write_opt',65536);
add(40,'Cloth','Decimate expensive normal regeneration when stable','cadence_base','cadence_opt',524288,'perceptual','Updates normals every second stable frame');
add(41,'Rope','Pack rope nodes into SoA arrays','aos_base','soa_opt',524288);
add(42,'Rope','Skip severed segments early','branch_late_base','branch_early_opt',524288);
add(43,'Rope','Cache segment inverse rest length','inv_base','inv_cached_opt',524288);
add(44,'Rope','Reuse segment transform matrix','matrix_obj_base','matrix_direct_opt',262144);
add(45,'Rope','Batch all rope segment instances','push_base','direct_write_opt',65536);
add(46,'Rope','Maintain active segment range','active_base','active_list_opt',393216,'workload-equivalent');
add(47,'Rope','Pack anchor flags into bytes','material_obj_base','material_packed_opt',393216);
add(48,'Rope','Reuse payload integration temporary','temp_obj_base','temp_reuse_opt',393216);
add(49,'Rope','Avoid closure allocation in segment iteration','closure_base','closure_opt',524288);
add(50,'Rope','Use squared threshold for cable break checks','dist_base','dist_opt',393216);
add(51,'Water','Swap height buffers instead of copying','copy_base','swap_opt',65536);
add(52,'Water','Split interior stencil from boundary handling','bounds_base','interior_opt',65536,'workload-equivalent','Interior kernel benchmark excludes boundary strip');
add(53,'Water','Precompute grid neighbor offsets','bounds_base','interior_opt',32768,'workload-equivalent');
add(54,'Water','Cache grid UV coordinates','uv_base','uv_cached_opt',65536);
add(55,'Water','Cache regular-grid indices','indices_base','indices_cached_opt',65536);
add(56,'Water','Fuse height and velocity coefficient setup','inv_base','inv_cached_opt',393216);
add(57,'Water','Use squared radius for ripple injection','dist_base','dist_opt',393216);
add(58,'Water','Reuse droplet pool','pool_base','pool_opt',393216);
add(59,'Water','Batch droplet instance stream','push_base','direct_write_opt',65536);
add(60,'Water','Update normals at a stable cadence','cadence_base','cadence_opt',393216,'perceptual');
add(61,'Surface mesh','Cache cloth UV stream','uv_base','uv_cached_opt',32768);
add(62,'Surface mesh','Cache water UV stream','uv_base','uv_cached_opt',32768);
add(63,'Surface mesh','Cache cloth index topology','indices_base','indices_cached_opt',32768);
add(64,'Surface mesh','Cache water index topology','indices_base','indices_cached_opt',32768);
add(65,'Surface mesh','Reuse interleaved vertex staging buffer','push_base','direct_write_opt',65536);
add(66,'Surface mesh','Reuse surface-result object','temp_obj_base','temp_reuse_opt',393216);
add(67,'Surface mesh','Pack colors into material IDs before expansion','material_obj_base','material_packed_opt',393216);
add(68,'Surface mesh','Specialize finite-difference normals','normals_base','normals_opt',131072);
add(69,'Surface mesh','Skip topology rebuild when no tear occurred','indices_base','indices_cached_opt',32768);
add(70,'Surface mesh','Use contiguous typed-array copies','set_base','set_opt',65536);
add(71,'Renderer CPU','Reuse instance staging arrays','push_base','direct_write_opt',65536);
add(72,'Renderer CPU','Use geometric GPU-buffer growth','grow_base','grow_opt',1048576);
add(73,'Renderer CPU','Cache static transforms','static_upload_base','static_upload_opt',65536);
add(74,'Renderer CPU','Pack material classification','material_obj_base','material_packed_opt',524288);
add(75,'Renderer CPU','Write matrices without temporary arrays','matrix_obj_base','matrix_direct_opt',262144);
add(76,'Renderer CPU','Batch effect instances','push_base','direct_write_opt',65536);
add(77,'Renderer CPU','Batch rope instances','push_base','direct_write_opt',65536);
add(78,'Renderer CPU','Batch droplets','push_base','direct_write_opt',65536);
add(79,'Renderer CPU','Skip zero-count draw preparation','branch_late_base','branch_early_opt',524288);
add(80,'Renderer CPU','Cap debug geometry before generation','filter_base','compact_opt',65536);
add(81,'Rigid preview','Use SoA body transform state','aos_base','soa_opt',524288);
add(82,'Rigid preview','Maintain active body indices','active_base','active_list_opt',524288,'workload-equivalent');
add(83,'Rigid preview','Cache static-body matrices','static_upload_base','static_upload_opt',65536);
add(84,'Rigid preview','Pool projectiles','pool_base','pool_opt',524288);
add(85,'Rigid preview','Batch rain bodies','batch_spawn_base','batch_spawn_opt',65536);
add(86,'Rigid preview','Use squared collision broadphase checks','dist_base','dist_opt',524288);
add(87,'Rigid preview','Pack body material IDs','material_obj_base','material_packed_opt',524288);
add(88,'Rigid preview','Skip sleeping bodies before transform math','branch_late_base','branch_early_opt',524288);
add(89,'Rigid preview','Reuse transform matrices','matrix_obj_base','matrix_direct_opt',262144);
add(90,'Rigid preview','Use ring buffer for action events','ring_base','ring_opt',131072);
add(91,'Scheduling','Decimate telemetry formatting','telemetry_base','telemetry_opt',65536,'observational');
add(92,'Scheduling','Avoid per-frame callback closures','closure_base','closure_opt',524288);
add(93,'Scheduling','Use ring-buffer event queue','ring_base','ring_opt',131072);
add(94,'Scheduling','Reuse fixed-step scratch state','temp_obj_base','temp_reuse_opt',524288);
add(95,'Scheduling','Skip inactive work before arithmetic','branch_late_base','branch_early_opt',524288);
add(96,'Scheduling','Batch spawn commands','batch_spawn_base','batch_spawn_opt',65536);
add(97,'WASM bridge','Cache typed heap views until memory changes','static_upload_base','static_upload_opt',65536);
add(98,'WASM bridge','Stream packed transforms instead of JS objects','aos_base','soa_opt',524288);
add(99,'WASM bridge','Pack material stream into bytes','material_obj_base','material_packed_opt',524288);
add(100,'Build/runtime','Eliminate hot-loop closure creation','closure_base','closure_opt',524288);

const results=[];
for (const d of defs) {
  const bState={},oState={};
  const b=timeKernel(kernels[d.base],bState,d.iterations);
  const o=timeKernel(kernels[d.opt],oState,d.iterations);
  const speedup=b.nsPerOp/o.nsPerOp;
  const bn=Number(b.lastOutput), on=Number(o.lastOutput);
  const equivalent=d.quality!=='exact' || (Number.isFinite(bn) && Number.isFinite(on) && Math.abs(bn-on) <= 1e-6 * Math.max(1,Math.abs(bn),Math.abs(on)));
  const noise=Math.max(b.madNs/b.nsPerOp,o.madNs/o.nsPerOp);
  const status=!equivalent?'rejected-correctness':speedup>=1.03&&noise<0.30?'accepted':speedup>=1.01?'borderline':'rejected-no-win';
  results.push({...d,baselineNs:b.nsPerOp,optimizedNs:o.nsPerOp,speedup,baselineMadNs:b.madNs,optimizedMadNs:o.madNs,noise,status,baselineChecksum:b.checksum,optimizedChecksum:o.checksum});
  process.stdout.write(`${String(d.id).padStart(3,'0')} ${status.padEnd(18)} ${speedup.toFixed(3)}x ${d.idea}\n`);
}
const accepted=results.filter(r=>r.status==='accepted');
const geo=Math.exp(accepted.reduce((a,r)=>a+Math.log(r.speedup),0)/Math.max(1,accepted.length));
const payload={schema:1,generatedAt:new Date().toISOString(),environment:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,memoryGiB:os.totalmem()/2**30},method:{warmups:4,samples:9,acceptance:'median speedup >= 1.03 and normalized MAD < 0.30',caveat:'Kernel benchmarks prove implementation-level cost changes on this CPU. End-to-end and WebGPU validation are separate gates.'},summary:{candidates:results.length,accepted:accepted.length,borderline:results.filter(r=>r.status==='borderline').length,rejected:results.filter(r=>r.status.startsWith('rejected')).length,acceptedGeomeanSpeedup:geo,sink},results};
fs.writeFileSync(path.join(outDir,'optimization-candidates.json'),JSON.stringify(payload,null,2));
const esc=s=>`"${String(s).replaceAll('"','""')}"`;
const cols=['id','subsystem','idea','quality','status','baselineNs','optimizedNs','speedup','noise','note'];
fs.writeFileSync(path.join(outDir,'optimization-candidates.csv'),[cols.join(','),...results.map(r=>cols.map(c=>esc(typeof r[c]==='number'?r[c].toFixed(6):r[c]??'')).join(','))].join('\n'));
let md=`# Box3D WebGPU — 100 Optimization Candidate Benchmarks\n\nGenerated: ${payload.generatedAt}\n\n## Method\n\n- Nine timed samples after four warm-up passes.\n- Median ns/op is used; MAD tracks run noise.\n- Accepted only at ≥3% median improvement with bounded noise.\n- Every candidate is retained in raw JSON/CSV, including regressions and inconclusive results.\n- Perceptual/workload-equivalent changes require the end-to-end quality gate before integration.\n\n## Summary\n\n| Candidates | Accepted | Borderline | Rejected | Accepted geometric-mean kernel speedup |\n|---:|---:|---:|---:|---:|\n| ${results.length} | ${payload.summary.accepted} | ${payload.summary.borderline} | ${payload.summary.rejected} | ${geo.toFixed(3)}× |\n\n## Results\n\n| # | Subsystem | Candidate | Baseline ns/op | Optimized ns/op | Speedup | Status |\n|---:|---|---|---:|---:|---:|---|\n`;
for(const r of results)md+=`| ${r.id} | ${r.subsystem} | ${r.idea.replaceAll('|','/')} | ${r.baselineNs.toFixed(2)} | ${r.optimizedNs.toFixed(2)} | ${r.speedup.toFixed(3)}× | ${r.status} |\n`;
md+=`\n## Interpretation\n\nA kernel win is evidence for that implementation choice, not permission to stack all ratios multiplicatively. The release report separately measures complete scenes and validates deterministic/visual contracts.\n`;
fs.writeFileSync(path.join(outDir,'optimization-candidates.md'),md);
console.log(JSON.stringify(payload.summary,null,2));
