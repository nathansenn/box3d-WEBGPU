import {FrameRuntime,FRAME_BACKEND,type FrameDefinition,type FrameSnapshot,type FrameStaticSolution} from './frame-runtime.ts';
import type {FrameElement} from './frame-element.ts';

type Scene='cantilever'|'supported'|'bending'|'torsion';
type Settings={scene:Scene;segments:number;load:number;drag:number;substeps:number;gain:number};
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const field=(id:string)=>byId<HTMLInputElement|HTMLSelectElement>(id);
const L=2,section:Omit<FrameElement,'a'|'b'>={youngModulus:2e9,shearModulus:8e8,area:.002,iy:1e-6,iz:3e-6,torsionConstant:2e-6,density:1000,up:[0,1,0]};
const beta=1.875104068711961,ratio=(Math.cosh(beta)+Math.cos(beta))/(Math.sinh(beta)+Math.sin(beta)),tip=Math.cosh(beta)-Math.cos(beta)-ratio*(Math.sinh(beta)-Math.sin(beta));
const omega=beta*beta/(L*L)*Math.sqrt(section.youngModulus*section.iz/(section.density*section.area));
const mode=(x:number)=>{const s=beta*x/L;return {u:(Math.cosh(s)-Math.cos(s)-ratio*(Math.sinh(s)-Math.sin(s)))/tip,r:beta/L*(Math.sinh(s)+Math.sin(s)-ratio*(Math.cosh(s)-Math.cos(s)))/tip};};
let settings:Settings,runtime:FrameRuntime,definition:FrameDefinition,snapshot:FrameSnapshot,staticView:FrameStaticSolution|undefined,saved:{settings:Settings;initialEnergy:number;checkpoint:ReturnType<FrameRuntime['checkpoint']>}|undefined;
let running=false,raf=0,last=0,accumulator=0,initialEnergy=0,history:{time:number;actual:number;reference:number}[]=[];
const total=(s:FrameSnapshot)=>s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy+s.diagnostics.gravitationalEnergy;
function readSettings():Settings{return {scene:field('scene').value as Scene,segments:+field('segments').value,load:+field('load').value,drag:+field('drag').value,substeps:+field('substeps').value,gain:+field('gain').value};}
function writeSettings(s:Settings):void{for(const [key,value] of Object.entries(s))field(key).value=String(value);}
function makeDefinition(s:Settings):FrameDefinition{
  const n=s.segments,positions=new Float64Array((n+1)*3),fixed=new Uint8Array((n+1)*6),displacements=new Float64Array((n+1)*6),forces=new Float64Array((n+1)*6),elements:FrameElement[]=[];
  for(let i=0;i<=n;i++){positions[3*i]=L*i/n;if(i)elements.push({...section,a:i-1,b:i});}
  fixed.fill(1,0,6);
  if(s.scene==='supported'){fixed.fill(0);for(const i of [0,1,2,3,6*n+1,6*n+2])fixed[i]=1;}
  if(s.scene==='cantilever')forces[6*n+1]=s.load;
  if(s.scene==='bending')for(let i=1;i<=n;i++){const m=mode(L*i/n);displacements[6*i+1]=.001*m.u;displacements[6*i+5]=.001*m.r;}
  if(s.scene==='torsion')for(let i=1;i<=n;i++)displacements[6*i+3]=.001*i/n;
  return {config:{dt:1/240,substeps:s.substeps,maxIterations:512,drag:s.drag,gravity:s.scene==='supported'?[0,-9.81,0]:[0,0,0],forceTolerance:1e-9,momentTolerance:1e-9,impulseTolerance:1e-11,angularImpulseTolerance:1e-11},positions,fixed,elements,displacements,forces};
}
function stop():void{running=false;cancelAnimationFrame(raf);raf=0;byId('run').textContent='Run';}
function reference(x:number,time:number):number{
  if(settings.scene==='cantilever')return settings.load*x*x*(3*L-x)/(6*section.youngModulus*section.iz);
  if(settings.scene==='supported'){const q=-section.density*section.area*9.81;return q*x*(L**3-2*L*x*x+x**3)/(24*section.youngModulus*section.iz);}
  if(settings.scene==='bending')return .001*mode(x).u*Math.cos(omega*time);
  const w=Math.sqrt(3*section.shearModulus*section.torsionConstant/(section.density*(section.iy+section.iz)*L*L)),h=runtime.config.dt/runtime.config.substeps;
  return .001*x/L*Math.cos(2*Math.atan(w*h/2)*time/h);
}
function transverse(u:Float64Array,x:number):number{const h=L/settings.segments,i=Math.min(settings.segments-1,Math.floor(x/h)),s=x/h-i;return (1-3*s*s+2*s**3)*u[6*i+1]+h*(s-2*s*s+s**3)*u[6*i+5]+(3*s*s-2*s**3)*u[6*(i+1)+1]+h*(-s*s+s**3)*u[6*(i+1)+5];}
function monitored(u:Float64Array):number{return settings.scene==='supported'?transverse(u,L/2):u[6*settings.segments+(settings.scene==='torsion'?3:1)];}
function record():void{const time=snapshot.diagnostics.time,x=settings.scene==='supported'?L/2:L;history.push({time,actual:monitored(snapshot.displacements),reference:reference(x,time)});if(history.length>600)history.shift();}
function reset():void{
  const nextSettings=readSettings(),nextDefinition=makeDefinition(nextSettings),nextRuntime=new FrameRuntime(nextDefinition);
  stop();runtime?.destroy();settings=nextSettings;definition=nextDefinition;runtime=nextRuntime;snapshot=runtime.inspect();staticView=undefined;history=[];initialEnergy=total(snapshot);accumulator=0;record();byId('error').textContent='';draw();
}
function step():void{staticView=undefined;snapshot=runtime.step({ticks:1});record();}
function frame(now:number):void{
  if(!running)return;accumulator+=Math.min(.1,(now-last)/1000);last=now;
  try{let steps=0;while(accumulator>=runtime.config.dt&&steps<8){step();accumulator-=runtime.config.dt;steps++;}accumulator=Math.min(accumulator,.1);draw();raf=requestAnimationFrame(frame);}catch(error){stop();fail(error);}
}
function fail(error:unknown):void{byId('error').textContent=error instanceof Error?error.message:String(error);}
function canvas(id:string):{ctx:CanvasRenderingContext2D;width:number;height:number}{
  const c=byId<HTMLCanvasElement>(id),width=c.clientWidth,height=c.clientHeight,dpr=Math.min(devicePixelRatio,2);if(c.width!==Math.round(width*dpr)||c.height!==Math.round(height*dpr)){c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);}const ctx=c.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);return {ctx,width,height};
}
function draw():void{
  const {ctx,width,height}=canvas('beam'),u=staticView?.displacements??snapshot.displacements,time=staticView?0:snapshot.diagnostics.time,px=(x:number)=>42+x/L*(width-84),py=(y:number)=>height*.53-y*(width-84)/L;
  ctx.strokeStyle='#384e5b';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px(0),py(0));ctx.lineTo(px(L),py(0));ctx.stroke();ctx.fillStyle='#aebfc8';ctx.font='12px system-ui';ctx.fillText('0 m',px(0)-10,height-18);ctx.fillText('2 m',px(L)-16,height-18);
  ctx.fillStyle='#6c8190';ctx.fillRect(px(0)-8,py(0)-28,8,56);if(settings.scene==='supported')ctx.fillRect(px(L),py(0),8,28);
  const referenceVisible=(settings.scene==='cantilever'||settings.scene==='supported'||settings.drag===0&&(settings.scene==='bending'||settings.segments===1));
  if(settings.scene!=='torsion'){
    if(referenceVisible){ctx.strokeStyle='#eaba85';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();for(let i=0;i<=120;i++){const x=L*i/120,y=reference(x,time)*settings.gain;i?ctx.lineTo(px(x),py(y)):ctx.moveTo(px(x),py(y));}ctx.stroke();ctx.setLineDash([]);}
    ctx.strokeStyle='#75d9c2';ctx.lineWidth=3;ctx.beginPath();
    for(let i=0;i<settings.segments;i++)for(let j=0;j<=20;j++){const s=j/20,h=L/settings.segments,H=[1-3*s*s+2*s**3,h*(s-2*s*s+s**3),3*s*s-2*s**3,h*(-s*s+s**3)],v=H[0]*u[6*i+1]+H[1]*u[6*i+5]+H[2]*u[6*(i+1)+1]+H[3]*u[6*(i+1)+5],x=h*(i+s)+settings.gain*((1-s)*u[6*i]+s*u[6*(i+1)]);if(i===0&&j===0)ctx.moveTo(px(x),py(v*settings.gain));else ctx.lineTo(px(x),py(v*settings.gain));}ctx.stroke();
  }else{
    for(let i=0;i<=settings.segments;i++){const x=L*i/settings.segments,theta=u[6*i+3]*settings.gain,drawSection=(angle:number,color:string,dashed:boolean)=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dashed?[4,4]:[]);ctx.beginPath();for(let j=0;j<=4;j++){const a=angle+Math.PI/4+j*Math.PI/2,X=px(x)+12*Math.cos(a),Y=py(0)+30*Math.sin(a);j?ctx.lineTo(X,Y):ctx.moveTo(X,Y);}ctx.stroke();};if(referenceVisible)drawSection(reference(x,time)*settings.gain,'#eaba85',true);drawSection(theta,'#75d9c2',false);}ctx.setLineDash([]);
  }
  byId('scale').textContent=`${settings.gain}× ${settings.scene==='torsion'?'angular':'displacement'} magnification · 2 m beam · ${settings.scene==='torsion'?'rotation (rad)':'vertical displacement (m)'}${referenceVisible?'':' · analytical overlay unavailable for this configuration'}`;
  const d=snapshot.diagnostics,screen=staticView??d,energyDefect=total(snapshot)-initialEnergy-d.externalWork+d.dragDissipation,fmt=(v:number)=>Math.abs(v)<1e-4&&v!==0?v.toExponential(3):v.toFixed(6),support=staticView?.supportReactions??snapshot.supportReactions;
  const entries=[['Tick',String(snapshot.tick)],['Model time',`${d.time.toFixed(5)} s`],['Monitored response',`${fmt(monitored(u)*(settings.scene==='torsion'?1:1000))} ${settings.scene==='torsion'?'rad':'mm'}`],['Mass',`${d.mass.toFixed(3)} kg`],['Total vertical support',`${fmt(support.reduce((sum,v,i)=>sum+(i%6===1?v:0),0))} N`],['Force residual',`${fmt(staticView?.forceResidual??d.maxForceResidual)} N`],['Moment residual',`${fmt(staticView?.momentResidual??d.maxMomentResidual)} N m`],['Iterations used',String(staticView?.iterations??d.maxIterationsUsed)],['Unconverged solves',String(staticView?(staticView.converged?0:1):d.unconvergedSolves)],['Energy balance defect',`${fmt(energyDefect)} J`],['Maximum slope',fmt(screen.maxTransverseSlope)]];
  byId('metrics').replaceChildren(...entries.flatMap(([key,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;return [dt,dd];}));
  byId('status').textContent=screen.linearKinematicsExceeded?'Outside the declared small-kinematics screen.':(staticView?`Static solution ${staticView.converged?'converged':'did not converge'} · dynamic run unchanged.`:`${running?'Running':'Paused'} · ${d.unconvergedSolves?'iteration budget exhausted':'linear solves converged'}.`);
  byId('backend').textContent=FRAME_BACKEND;byId('section').textContent='E 2 GPa · G 0.8 GPa · A 0.002 m² · Iy 10⁻⁶ m⁴ · Iz 3×10⁻⁶ m⁴ · J 2×10⁻⁶ m⁴ · ρ 1000 kg/m³';
  byId<HTMLButtonElement>('static').disabled=settings.scene==='bending'||settings.scene==='torsion';field('load').disabled=settings.scene!=='cantilever';
  const plot=canvas('trace'),values=history.flatMap(p=>referenceVisible?[p.actual,p.reference]:[p.actual]),max=Math.max(1e-6,...values.map(Math.abs)),start=history[0]?.time??0,end=Math.max(start+runtime.config.dt,history.at(-1)?.time??0),X=(t:number)=>35+(t-start)/(end-start)*(plot.width-55),Y=(v:number)=>plot.height/2-v/max*(plot.height*.34);
  plot.ctx.strokeStyle='#384e5b';plot.ctx.beginPath();plot.ctx.moveTo(35,Y(0));plot.ctx.lineTo(plot.width-20,Y(0));plot.ctx.stroke();
  for(const [key,color] of [['actual','#75d9c2'],['reference','#eaba85']] as const){if(key==='reference'&&!referenceVisible)continue;plot.ctx.strokeStyle=color;plot.ctx.setLineDash(key==='reference'?[4,4]:[]);plot.ctx.beginPath();history.forEach((p,i)=>i?plot.ctx.lineTo(X(p.time),Y(p[key])):plot.ctx.moveTo(X(p.time),Y(p[key])));plot.ctx.stroke();}plot.ctx.setLineDash([]);plot.ctx.fillStyle='#aebfc8';plot.ctx.font='11px system-ui';plot.ctx.fillText(`${start.toFixed(2)} s`,35,plot.height-10);plot.ctx.fillText(`${end.toFixed(2)} s`,plot.width-65,plot.height-10);
}
function action(fn:()=>void):()=>void{return ()=>{try{fn();}catch(error){stop();fail(error);}};}
byId('run').onclick=action(()=>{if(running){stop();draw();}else{running=true;staticView=undefined;last=performance.now();byId('run').textContent='Pause';raf=requestAnimationFrame(frame);}});
byId('step').onclick=action(()=>{stop();step();draw();});byId('reset').onclick=action(reset);
byId('static').onclick=action(()=>{stop();staticView=runtime.solveStatic();draw();});
byId('save').onclick=action(()=>{saved={settings:{...settings},initialEnergy,checkpoint:runtime.checkpoint()};byId<HTMLButtonElement>('restore').disabled=false;byId('status').textContent=`Checkpoint saved at tick ${snapshot.tick}.`;});
byId('restore').onclick=action(()=>{if(!saved)return;stop();const restored=FrameRuntime.fromCheckpoint(saved.checkpoint);runtime.destroy();runtime=restored;settings={...saved.settings};writeSettings(settings);definition=makeDefinition(settings);snapshot=runtime.inspect();staticView=undefined;initialEnergy=saved.initialEnergy;history=[];accumulator=0;record();draw();});
for(const id of ['scene','segments','load','drag','substeps'])field(id).onchange=action(()=>{if(id==='scene'&&(field('scene').value==='bending'||field('scene').value==='torsion'))field('drag').value='0';if(id==='scene'&&field('scene').value==='torsion')field('segments').value='1';reset();});
field('gain').onchange=action(()=>{settings.gain=+field('gain').value;draw();});new ResizeObserver(()=>{if(runtime)draw();}).observe(byId('beam'));
window.addEventListener('pagehide',()=>{stop();runtime?.destroy();});action(reset)();
