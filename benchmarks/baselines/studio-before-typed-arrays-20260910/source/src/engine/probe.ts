import {WebGPURenderer} from '../webgpu/renderer';
import {GpuLinearWater,type GpuWaterCheckpoint} from '../webgpu/linear-water.ts';
import {createLinearWaterArrays} from './linear-water.ts';
import {CameraMatrixCache} from '../camera';
import {FixedFrameClock} from '../perf/frame-clock';
import type {CameraRig,RenderQuality} from '../types';
import type {WaterTelemetry} from '../webgpu/water-telemetry.ts';

const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=element<HTMLCanvasElement>('water'),grid=element<HTMLSelectElement>('grid'),status=element('status'),metrics=element('metrics');
const play=element<HTMLButtonElement>('play'),reset=element<HTMLButtonElement>('reset'),capture=element<HTMLButtonElement>('capture'),restore=element<HTMLButtonElement>('restore');
const camera=new CameraMatrixCache(),rig:CameraRig={yaw:1.1,pitch:.65,distance:44,target:[0,0,0]};
const clock=new FixedFrameClock(1/240,8),light:[number,number,number]=[.42,-.84,.34];
const noShake={yaw:0,pitch:0,targetOffset:[0,0,0] as [number,number,number]};
const quality:RenderQuality={id:'balanced',label:'Balanced',sampleCount:1,shadowMapSize:1024,shadowTapCount:1,shadowStrength:0,exposure:1.2,bloomStrength:.12,fogDensity:.004,effectBudget:0,resolutionScale:1};
let renderer:WebGPURenderer,solver:GpuLinearWater|null=null,saved:GpuWaterCheckpoint|null=null,telemetry:WaterTelemetry|null=null;
let running=false,busy=true,disposed=false,pendingTelemetry=false,lastSample=0,lastMetrics=0,raf=0;
const lifetime=new AbortController();
const startupOptions={signal:lifetime.signal,onStartupProgress:(stage:string)=>{if(!disposed)status.textContent=stage;}};
const stride=(n:number)=>n<=128?1:Math.ceil((n-1)/126);
function controls():void {grid.disabled=busy;play.disabled=reset.disabled=capture.disabled=busy||!solver;restore.disabled=busy||!saved;play.textContent=running?'Pause':'Run';}
function fail(error:unknown):void {if(disposed)return;running=false;status.textContent=error instanceof Error?error.message:String(error);status.style.color='#ffa992';controls();}
async function replace(checkpoint?:GpuWaterCheckpoint):Promise<void> {
  if(busy||disposed)return;busy=true;running=false;controls();status.textContent='Preparing numerical field…';
  let next:GpuLinearWater|null=null;
  try {
    if(checkpoint)next=await GpuLinearWater.fromCheckpoint(renderer.device,checkpoint,startupOptions);
    else {
      const n=Number(grid.value),config={cols:n,rows:n,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:40/(n-1),dz:24/(n-1)},initial=createLinearWaterArrays(config);
      for(let z=0;z<n;z++)for(let x=0;x<n;x++){
        const wx=x*config.dx-20,wz=z*config.dz-12;
        initial.eta[z*n+x]=.7*Math.exp(-((wx+7)**2+wz*wz)/5)-.32*Math.exp(-((wx-5)**2+(wz-3)**2)/8);
      }
      next=await GpuLinearWater.create(renderer.device,config,initial,startupOptions);
    }
    if(disposed){next.destroy();return;}
    renderer.useGpuWater(next,{renderStride:stride(next.config.cols)});solver?.destroy();solver=next;next=null;
    grid.value=String(solver.config.cols);telemetry=null;clock.reset(true);lastSample=lastMetrics=0;
    status.style.color='';status.textContent=checkpoint?`Restored at ${(solver.tick*solver.config.dt).toFixed(3)} s. Paused.`:'Ready. Press Run to simulate.';
  }catch(error){next?.destroy();fail(error);}finally{busy=false;controls();}
}
play.onclick=()=>{running=!running;clock.reset();status.textContent=running?'Simulating on GPU.':'Paused.';controls();};
reset.onclick=()=>void replace();grid.onchange=()=>void replace();restore.onclick=()=>{if(saved)void replace(saved);};
capture.onclick=async()=>{
  if(!solver||busy)return;busy=true;running=false;controls();status.textContent='Saving the complete GPU checkpoint…';
  try{saved=await solver.checkpoint();status.textContent=`Checkpoint saved at ${(saved.tick*saved.config.dt).toFixed(3)} s. Paused.`;}catch(error){fail(error);}finally{busy=false;controls();}
};
let drag:{id:number;x:number;y:number}|null=null;
canvas.addEventListener('pointerdown',event=>{drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;rig.yaw+=(event.clientX-drag.x)*.006;rig.pitch=Math.max(.12,Math.min(1.25,rig.pitch+(event.clientY-drag.y)*.004));drag.x=event.clientX;drag.y=event.clientY;});
canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('wheel',event=>{event.preventDefault();rig.distance=Math.max(15,Math.min(90,rig.distance*Math.exp(event.deltaY*.001)));},{passive:false});
canvas.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='ArrowLeft'||event.key==='ArrowRight')rig.yaw+=event.key==='ArrowLeft'?-.2:.2;
  if(event.key==='ArrowUp'||event.key==='ArrowDown')rig.pitch=Math.max(.12,Math.min(1.25,rig.pitch+(event.key==='ArrowUp'?.12:-.12)));
  if(event.key==='+'||event.key==='-')rig.distance=Math.max(15,Math.min(90,rig.distance*(event.key==='+'?.85:1.15)));
});
function draw(now:number):void {
  if(disposed)return;raf=requestAnimationFrame(draw);
  if(!solver||busy)return;
  try {
    clock.advance(now,1,running);const steps=running?clock.takeSteps():0;if(steps)solver.step(steps);
    const matrices=camera.resolve(rig,noShake,canvas.clientWidth/canvas.clientHeight,light);
    renderer.writeSceneUniforms({viewProjection:matrices.viewProjection,lightViewProjection:matrices.lightViewProjection,cameraPosition:matrices.eye,lightDirection:light,fogColor:[.055,.085,.14],timeSeconds:solver.tick*solver.config.dt,quality});
    renderer.render(0,[]);
    if(!pendingTelemetry&&now-lastSample>500){
      lastSample=now;pendingTelemetry=true;const source=solver;
      void source.telemetry().then(value=>{if(source===solver)telemetry=value;},error=>{if(source===solver&&!disposed)fail(error);}).finally(()=>{pendingTelemetry=false;});
    }
    if(now-lastMetrics<200)return;lastMetrics=now;
    const surface=renderer.gpuWaterInfo(),gpu=renderer.gpuTimingInfo(),currentTime=solver.tick*solver.config.dt;
    metrics.textContent=`Model: ${solver.backend}\nNumerical cells: ${surface.solverCells.toLocaleString()} · Display mesh: ${surface.meshVertices.toLocaleString()} points · Stride: ${surface.renderStride}\nSimulation: ${currentTime.toFixed(3)} s · Tick: ${solver.tick} · Wall-time lag: ${clock.lagSeconds.toFixed(3)} s\nGPU render passes: ${gpu.status==='ready'&&gpu.latest?gpu.latest.totalPassMs.toFixed(3)+' ms':gpu.status} (numerical step submitted separately)\n${telemetry?`Peak speed: ${telemetry.maxSpeed.toFixed(4)} · Height RMS: ${telemetry.heightRms.toFixed(4)} · Elevation: ${telemetry.minElevation.toFixed(4)} to ${telemetry.maxElevation.toFixed(4)}\nTelemetry: 32 bytes · sample tick ${telemetry.tick} · age ${(currentTime-telemetry.time).toFixed(3)} s`:'Telemetry pending…'}`;
    canvas.dataset.tick=String(solver.tick);canvas.dataset.cells=String(surface.solverCells);
  }catch(error){cancelAnimationFrame(raf);fail(error);}
}
window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;lifetime.abort();cancelAnimationFrame(raf);solver?.destroy();renderer?.dispose();},{once:true});
controls();
try {
  renderer=await WebGPURenderer.create(canvas,1,startupOptions);
  renderer.onDeviceLost(info=>{cancelAnimationFrame(raf);fail(new Error(`Graphics device lost: ${info.message}. Reload this validation page to recreate resources.`));});
  busy=false;await replace();raf=requestAnimationFrame(draw);
}catch(error){busy=false;fail(error);}
