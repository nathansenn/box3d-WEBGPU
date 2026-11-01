import {WebGPURenderer as BaselineRenderer} from './baseline-renderer.mjs';
import {distribution,now,sha256,yieldTask} from './common.mjs';
import {gpuIdle} from './timing.mjs';
export async function runUploadOverhead(renderer,fixtureFrame){
 const settings={samples:21,warmupBatches:5,unchangedCallsPerBatch:1024,advancingCallsPerBatch:16};
 const methods={baseline:BaselineRenderer.prototype.uploadSurface,current:Object.getPrototypeOf(renderer).uploadSurface};
 const report={status:'RUNNING',settings,settingsSha256:await sha256(JSON.stringify(settings)),cases:[],scope:'CPU time in actual pinned/current uploadSurface on the same initialized resources.',exclusions:['creation','cache seeding','queue drain','simulation','draw','GPU completion'],accounting:'Only steady-state dynamic bytes are comparable; initial uniform/index accounting differs.'};
 for(const id of ['unchanged-frame','advancing-frame']){
  const advancing=id==='advancing-frame',calls=advancing?settings.advancingCallsPerBatch:settings.unchangedCallsPerBatch,expectedBytesPerCall=advancing?fixtureFrame.vertexCount*12:0;
  const samples={baseline:[],current:[]},byteCounts={baseline:[],current:[]},computedNodes={baseline:[],current:[]};
  const sample=async(name,measured)=>{
   renderer.invalidateDynamicCaches();const frame={...fixtureFrame,frameVersion:0},method=methods[name];
   method.call(renderer,frame);await gpuIdle(renderer.device);const before=renderer.waterPlanningStats();let bytes=0;const begin=now();
   for(let i=0;i<calls;i++){if(advancing)frame.frameVersion=i+1;bytes+=method.call(renderer,frame);}
   const duration=now()-begin,after=renderer.waterPlanningStats();await gpuIdle(renderer.device);
   if(measured){samples[name].push(duration);byteCounts[name].push(bytes);computedNodes[name].push(after.nodesComputed-before.nodesComputed);}
  };
  for(let i=0;i<settings.warmupBatches;i++)for(const name of i%2?['current','baseline']:['baseline','current'])await sample(name,false);
  for(let i=0;i<settings.samples;i++){for(const name of i%2?['current','baseline']:['baseline','current'])await sample(name,true);await yieldTask();}
  const correctBytes=Object.values(byteCounts).every(a=>a.every(v=>v===calls*expectedBytesPerCall)),noRepeatedPlanning=computedNodes.current.every(v=>v===0);
  const baseline={...distribution(samples.baseline,calls),unit:'ms/uploadSurface call'},current={...distribution(samples.current,calls),unit:'ms/uploadSurface call'};
  report.cases.push({id,status:correctBytes&&noRepeatedPlanning?'PASSED':'FAILED',callsPerBatch:calls,expectedBytesPerCall,byteCountParity:correctBytes,measuredBatchReportedBytes:byteCounts,measuredBatchPlanningNodesComputed:computedNodes,noRepeatedPlanning,baseline,current,observedMedianRatioCurrentToBaseline:baseline.p50>0?current.p50/baseline.p50:null});
 }
 report.status=report.cases.every(c=>c.status==='PASSED')?'PASSED':'FAILED';return report;
}

