import {CompliantCableRuntime,hangingCableDefinition,type CableCheckpoint,type CableDefinition,type CableSnapshot,type CableConfig} from './compliant-cable.ts';
import {FixedFrameClock} from '../perf/frame-clock';

const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=element<HTMLCanvasElement>('cable'),context=canvas.getContext('2d')!;
const scene=element<HTMLSelectElement>('scene'),segments=element<HTMLSelectElement>('segments'),substeps=element<HTMLSelectElement>('substeps'),iterations=element<HTMLSelectElement>('iterations'),rigidity=element<HTMLSelectElement>('rigidity');
const solver=element<HTMLSelectElement>('solver');
const status=element('status'),metrics=element('metrics'),play=element<HTMLButtonElement>('play'),restore=element<HTMLButtonElement>('restore');
const clock=new FixedFrameClock(1/60,8);
let runtime:CompliantCableRuntime,definition:CableDefinition,snapshot:CableSnapshot,running=false,disposed=false,raf=0,lastMetrics=0,yaw=.18,pitch=.08;
let saved:{checkpoint:CableCheckpoint;settings:string[]}|null=null;
const selects=[scene,segments,substeps,iterations,rigidity,solver];

function settings():string[]{return selects.map(s=>s.value);}
function replace():void {
  const n=Number(segments.value),config:CableConfig={dt:1/60,substeps:Number(substeps.value),maxIterations:Number(iterations.value),residualTolerance:1e-9,drag:4,gravity:[0,-9.81,0],...(solver.value==='proximal'?{solver:'proximal',forceTolerance:1e-6}:{})};
  definition=hangingCableDefinition({segments:n,length:scene.value==='span'?4.2:2,linearDensity:.25,tipMass:scene.value==='span'?0:1,axialRigidity:Number(rigidity.value),config});
  if(scene.value==='span') {
    const positions=definition.positions as Float64Array,masses=definition.masses as Float64Array,pinned=definition.pinned as Uint8Array;
    for(let i=0;i<=n;i++){positions[3*i]=-2+4*i/n;positions[3*i+1]=0;}
    masses[Math.floor(n/2)]+=1;pinned[n]=1;
  }
  const next=new CompliantCableRuntime(definition);runtime?.destroy();runtime=next;snapshot=runtime.inspect();running=false;clock.reset(true);play.textContent='Run';status.textContent='Ready. Settings reset the model.';lastMetrics=0;
}
function failure(error:unknown):void {running=false;play.textContent='Run';status.textContent=error instanceof Error?error.message:String(error);}
for(const select of selects)select.onchange=()=>{try{replace();}catch(error){failure(error);}};
element('reset').onclick=()=>{try{replace();}catch(error){failure(error);}};
play.onclick=()=>{running=!running;clock.reset();play.textContent=running?'Pause':'Run';status.textContent=running?'Simulating.':'Paused.';};
element('kick').onclick=()=>{
  try {const n=Number(segments.value),node=scene.value==='span'?Math.floor(n/2):n;snapshot=runtime.step({ticks:1,commands:[{tick:runtime.tick+1,type:'impulse',node,value:[.35,0,.15]}]});status.textContent='Applied a 0.35 N·s horizontal and 0.15 N·s depth impulse.';lastMetrics=0;}catch(error){failure(error);}
};
element('save').onclick=()=>{running=false;play.textContent='Run';saved={checkpoint:runtime.checkpoint(),settings:settings()};restore.disabled=false;status.textContent=`Checkpoint saved at ${snapshot.diagnostics.time.toFixed(3)} s.`;};
restore.onclick=()=>{
  if(!saved)return;
  try {const next=CompliantCableRuntime.fromCheckpoint(saved.checkpoint);runtime.destroy();runtime=next;definition=saved.checkpoint.definition;selects.forEach((s,i)=>{s.value=saved!.settings[i];});snapshot=runtime.inspect();running=false;clock.reset(true);play.textContent='Run';status.textContent=`Restored at ${snapshot.diagnostics.time.toFixed(3)} s. Paused.`;lastMetrics=0;}catch(error){failure(error);}
};
element('angle').onclick=()=>{yaw+=.7;};
let pointer:{id:number;x:number;y:number}|null=null;
canvas.onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(pointer?.id!==e.pointerId)return;yaw+=(e.clientX-pointer.x)*.007;pitch=Math.max(-.5,Math.min(.5,pitch+(e.clientY-pointer.y)*.003));pointer.x=e.clientX;pointer.y=e.clientY;};
canvas.onpointerup=canvas.onpointercancel=()=>{pointer=null;};
canvas.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft'||e.key==='ArrowRight')yaw+=e.key==='ArrowLeft'?-.2:.2;else pitch=Math.max(-.5,Math.min(.5,pitch+(e.key==='ArrowUp'?.1:-.1)));};

function draw():void {
  const width=canvas.clientWidth,height=canvas.clientHeight,ratio=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  context.setTransform(ratio,0,0,ratio,0,0);context.fillStyle='#0e1c29';context.fillRect(0,0,width,height);
  const scale=Math.min(width/5.5,height/3.5),project=(x:number,y:number,z:number):[number,number]=>[width/2+(Math.cos(yaw)*x+Math.sin(yaw)*z)*scale,height*.2-(y*Math.cos(pitch)+(z*Math.cos(yaw)-x*Math.sin(yaw))*Math.sin(pitch))*scale];
  context.strokeStyle='#213744';context.lineWidth=1;
  for(let x=-3;x<=3;x++){const a=project(x,.2,0),b=project(x,-2.6,0);context.beginPath();context.moveTo(...a);context.lineTo(...b);context.stroke();}
  for(let y=0;y>=-2.5;y-=.5){const a=project(-3,y,0),b=project(3,y,0);context.beginPath();context.moveTo(...a);context.lineTo(...b);context.stroke();}
  const points=Array.from({length:definition.masses.length},(_,i)=>project(snapshot.positions[i*3],snapshot.positions[i*3+1],snapshot.positions[i*3+2]));
  definition.constraints.forEach((edge,i)=>{context.strokeStyle=`hsl(${170-Math.min(snapshot.tensions[i]/30,1)*140} 65% 63%)`;context.lineWidth=3;context.beginPath();context.moveTo(...points[edge.a]);context.lineTo(...points[edge.b]);context.stroke();});
  points.forEach(([x,y],i)=>{context.fillStyle=definition.pinned?.[i]?'#f0b56d':'#d2e6ee';context.beginPath();context.arc(x,y,definition.pinned?.[i]?7:3+Math.min(definition.masses[i],1)*7,0,Math.PI*2);context.fill();});
  context.fillStyle='#94aebf';context.font='13px system-ui';context.fillText('Grid: 1 m horizontally · 0.5 m vertically',16,height-18);
}
function frame(now:number):void {
  if(disposed)return;raf=requestAnimationFrame(frame);
  try {
    clock.advance(now,1,running);const ticks=running?clock.takeSteps():0;if(ticks)snapshot=runtime.step({ticks});draw();
    if(now-lastMetrics<200)return;lastMetrics=now;
    const d=snapshot.diagnostics,extension=-snapshot.positions.at(-2)!-2,target=9.81/Number(rigidity.value)*(2+.25*2*2/2);
    metrics.textContent=`Time: ${d.time.toFixed(3)} s · Tick: ${snapshot.tick} · Mass: ${d.mass.toFixed(3)} kg\nPeak tension: ${d.maxTension.toFixed(5)} N · Support vertical reaction: ${(snapshot.supportReactions[1]+(scene.value==='span'?snapshot.supportReactions.at(-2)!:0)).toFixed(5)} N\n${scene.value==='hanging'?`Vertical extension: ${(extension*1000).toFixed(5)} mm · Analytic resting extension: ${(target*1000).toFixed(5)} mm\n`:''}Constitutive residual / rest length: ${d.maxResidual.toExponential(3)} · Substeps over tolerance: ${d.unconvergedSubsteps}/${runtime.config.substeps}\nImplicit force-balance residual: ${d.maxImplicitForceResidual.toExponential(3)} N\nLast tick: ${d.constraintProjections.toLocaleString()} projections · ${d.residualEvaluations.toLocaleString()} residual evaluations · ${d.maxIterationsUsed} maximum iterations\nEnergy: ${d.kineticEnergy.toFixed(6)} J kinetic · ${d.elasticEnergy.toFixed(6)} J elastic · ${d.gravitationalEnergy.toFixed(6)} J gravitational\nApplied work: ${d.externalWork.toFixed(6)} J · Drag loss: ${d.dragDissipation.toFixed(6)} J · Backend: ${snapshot.backend}`;
    if(snapshot.impulses){
      const support=snapshot.impulses.support;let vertical=0;for(let j=1;j<support.length;j+=3)vertical+=support[j];
      metrics.textContent+=`\nConstraint correction residual: ${d.maxConstraintForceResidual!.toExponential(3)} N · Force tolerance: ${runtime.config.forceTolerance!.toExponential(1)} N\nLast tick support impulse: ${vertical.toExponential(6)} N·s vertically`;
    }
    canvas.dataset.tick=String(snapshot.tick);canvas.dataset.model=snapshot.backend;
  }catch(error){failure(error);}
}
window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;cancelAnimationFrame(raf);runtime?.destroy();},{once:true});
try{replace();raf=requestAnimationFrame(frame);}catch(error){failure(error);}
