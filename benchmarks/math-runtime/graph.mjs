import {makeRng,now,distribution,yieldTask,sha256} from './common.mjs';
function boundsOf(p){const o=new Float64Array([Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity,0]);for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++){const v=p[i+k];if(v<o[k])o[k]=v;if(v>o[k+3])o[k+3]=v;o[6]+=v*v;}return o;}
const frameOf=(b,c)=>Float64Array.from(b,(v,i)=>v*c[i%4]+c[(i+1)%4]);
export async function runGraphBench({ExecutionGraph},settings={}){
 const config={vertices:65536,samples:21,warmupBatches:5,evaluationsPerBatch:16,seed:0x91a57,...settings},rng=makeRng(config.seed);
 const a=new Float32Array(config.vertices*3),b=new Float32Array(a.length);
 for(let i=0;i<a.length;i++){a[i]=(rng()-.5)*32;b[i]=a[i]+(i%3===0?.25:-.125);}
 const geometries=[a,b],cameras=[new Float64Array([1,.3,.7,.1]),new Float64Array([.9,.4,.8,.2])];
 const report={status:'COMPLETED',settings:config,settingsSha256:await sha256(JSON.stringify(config)),scope:'Bounds/derived work versus eager reference, not existing renderer performance.',cases:[]};
 for(const scenario of ['unchanged','camera-only','geometry-change']){
  const graph=new ExecutionGraph('bench'),geometry=graph.input('geometry'),camera=graph.input('camera');
  const bounds=graph.node({id:'bounds',dependencies:[geometry],compute:c=>boundsOf(c.read(geometry))});
  const frame=graph.node({id:'frame',dependencies:[bounds,camera],compute:c=>frameOf(c.read(bounds),c.read(camera))});
  graph.setInput(geometry,a,{generation:'bench',version:0});graph.setInput(camera,cameras[0],{generation:'bench',version:0});graph.evaluate(frame);
  let revision=0,checksumGraph=0,checksumEager=0;
  const inputs=i=>({p:geometries[scenario==='geometry-change'?i%2:0],c:cameras[scenario==='camera-only'?i%2:0]});
  const publish=s=>{if(scenario==='camera-only')graph.setInput(camera,s.c,{generation:'bench',version:++revision});if(scenario==='geometry-change')graph.setInput(geometry,s.p,{generation:'bench',version:++revision});};
  const runGraph=()=>{let r;for(let i=0;i<config.evaluationsPerBatch;i++){const s=inputs(i);publish(s);r=graph.evaluate(frame);checksumGraph+=r[6];}return r;};
  const runEager=()=>{let r;for(let i=0;i<config.evaluationsPerBatch;i++){const s=inputs(i);r=frameOf(boundsOf(s.p),s.c);checksumEager+=r[6];}return r;};
  let everyComponentMatches=true;for(let i=0;i<8;i++){const s=inputs(i);publish(s);const actual=graph.evaluate(frame),expected=frameOf(boundsOf(s.p),s.c);everyComponentMatches&&=actual.every((v,j)=>Object.is(v,expected[j]));}
  for(let i=0;i<config.warmupBatches;i++){runGraph();runEager();}
  graph.resetStats();checksumGraph=0;checksumEager=0;
  const graphTimes=[],eagerTimes=[];let finalGraph,finalEager;
  for(let i=0;i<config.samples;i++){for(const method of i%2?['eager','graph']:['graph','eager']){const start=now();if(method==='graph'){finalGraph=runGraph();graphTimes.push(now()-start);}else{finalEager=runEager();eagerTimes.push(now()-start);}}await yieldTask();}
  const finalMatch=finalGraph.every((v,i)=>Object.is(v,finalEager[i])),identical=everyComponentMatches&&finalMatch&&Object.is(checksumGraph,checksumEager);
  report.cases.push({id:scenario,status:identical?'VALIDATED':'FAILED',exactFinalValueMatch:finalMatch,untimedFullVectorValidation:{evaluations:8,exactMatch:everyComponentMatches},graph:{...distribution(graphTimes,config.evaluationsPerBatch),unit:'ms/evaluation'},eager:{...distribution(eagerTimes,config.evaluationsPerBatch),unit:'ms/evaluation'},graphCounters:graph.stats(),checksums:{graph:checksumGraph,eager:checksumEager}});
  if(!identical)report.status='FAILED';
 }
 return report;
}

