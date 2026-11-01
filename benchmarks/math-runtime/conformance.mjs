import {DEFAULT_SETTINGS,fixture,fixtureHash,compareSnapshots,message} from './common.mjs';
import {gpuSnapshot,gpuIdle,gpuSetup} from './timing.mjs';
export async function runGpuConformance({referenceApi,gpuApi,gpuContext}){
 if(!gpuContext)return {status:'BLOCKED',reason:'No WebGPU device.'};
 const report={status:'RUNNING',scope:'Narrow/minimum grids, mixed parameters in one encoder, nonzero history, reset/replay.',cases:[]};
 for(const [cols,rows] of [[3,3],[3,9],[9,3]]){
  const grid={cols,rows},data=fixture(grid,DEFAULT_SETTINGS.seed),item={grid,initialStateSha256:await fixtureHash(data),comparisons:[],status:'RUNNING'};report.cases.push(item);let gpu;
  try{
   gpu=await gpuSetup(gpuApi.GpuWaterCompute.create(gpuContext.device,grid,data.initial,data.history));
   const steps=[data.params,{...data.params,dt:data.params.dt*.35,gravity:8.9,meanDepth:1.3,drag:.21},data.params,{...data.params,dt:data.params.dt*.7,gravity:9.2,meanDepth:1.8,drag:.4},data.params];item.parametersInOneEncoder=steps;
   const js=referenceApi.createWaterReference(grid,data.initial,data.history),f32=referenceApi.createWaterReference(grid,data.initial,data.history);
   for(const p of steps){referenceApi.stepWaterReference(js,p,'javascript');referenceApi.stepWaterReference(f32,p,'f32');}
   let first;
   for(const phase of ['mixed-parameters','reset-replay']){
    if(phase==='reset-replay'){gpu.reset(data.initial,data.history);await gpuIdle(gpuContext.device);}
    const encoder=gpuContext.device.createCommandEncoder();for(const p of steps)gpu.encodeStep(encoder,p);gpuContext.device.queue.submit([encoder.finish()]);
    const actual=await gpuSnapshot(gpu);
    for(const [baseline,expected] of [['javascript-reference',referenceApi.snapshotWaterReference(js)],['f32-reference',referenceApi.snapshotWaterReference(f32)]])item.comparisons.push({phase,baseline,...compareSnapshots(expected,actual,DEFAULT_SETTINGS.tolerance)});
    if(first)item.comparisons.push({phase,baseline:'prior-gpu-run',...compareSnapshots(first,actual,{absolute:0,relative:0})});else first=actual;
   }
   item.status=item.comparisons.every(c=>c.pass)?'PASSED':'FAILED';
  }catch(e){item.status='FAILED';item.reason=message(e);}finally{gpu?.destroy();}
 }
 report.status=report.cases.every(c=>c.status==='PASSED')?'PASSED':'FAILED';return report;
}

