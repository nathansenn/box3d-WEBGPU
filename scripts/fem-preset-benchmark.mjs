// Real-time factors of the Studio's tetrahedral-solid presets (metal press, elastomer lab, concrete crush) in Node.
// Usage: node scripts/fem-preset-benchmark.mjs [press|rubber|concrete ...] [--preset id] [--json out.json]
// Real-time factor = model seconds / CPU seconds of the model's own stepping (single thread).
import './register-typescript.mjs';
import {writeFileSync} from 'node:fs';
const args=process.argv.slice(2),pick=args.filter(a=>!a.startsWith('--')&&!/\.json$/.test(a)&&args[args.indexOf(a)-1]!=='--preset');
const only=args.includes('--preset')?args[args.indexOf('--preset')+1]:null,jsonOut=args.includes('--json')?args[args.indexOf('--json')+1]:null;
const want=k=>pick.length===0||pick.includes(k);
const results=[];
const cpu=()=>{const u=process.cpuUsage();return (u.user+u.system)/1e6;};
function report(r){results.push(r);console.log(JSON.stringify(r));}

if(want('press')){
  const {FailureSimulation,STUDIO_PRESS_SI_BACKEND}=await import('../src/studio/physics.ts');
  const {siPress,SI_PRESS_EXPERIMENTS}=await import('../src/studio/press-si.ts');
  for(const e of SI_PRESS_EXPERIMENTS){
    if(only&&e.id!==only)continue;
    const sim=new FailureSimulation('plate',siPress(e.settings),STUDIO_PRESS_SI_BACKEND);sim.targetLoad=sim.press.pressure/20;
    const t=cpu();let ticks=0;for(;ticks<120*120&&sim.pressCycle!=='Complete';ticks++)sim.step();
    const si=sim.pressSI;
    report({study:'press',preset:e.id,model:+si.modelSeconds.toFixed(3),cpu:+(cpu()-t).toFixed(2),realTime:+si.realTimeFactor.toFixed(4),peakForceKN:+(si.peakForce/1e3).toFixed(4),angle:+si.brake.bendAngle.toFixed(3),eroded:si.brake.body.erodedCount,unconverged:si.brake.contact.stats.unconvergedSteps});
  }
}
async function labs(id,Model,metric){
  const {LABS,normalizeSettings}=await import('../src/studio/material-labs/catalog.ts');
  for(const e of LABS[id].experiments){
    if(only&&e.id!==only)continue;
    const p=normalizeSettings(id,{...LABS[id].defaults,...e.settings}),m=new Model(p),seconds=LABS[id].duration;
    let worst=0;const t=cpu();
    for(let i=0;i<Math.round(seconds*120);i++){const s=performance.now();m.step(1/120);worst=Math.max(worst,performance.now()-s);}
    const used=cpu()-t;
    report({study:id,preset:e.id,model:seconds,cpu:+used.toFixed(2),realTime:+(seconds/used).toFixed(3),worstTickMs:Math.round(worst),...metric(m)});
  }
}
if(want('rubber')){const {RubberModel}=await import('../src/studio/material-labs/rubber-si.ts');await labs('rubber',RubberModel,m=>({peakForceMN:+(m.peakForce/1e6).toFixed(4),residual:+(m.residual*100).toFixed(2),unconverged:m.unconverged}));}
if(want('concrete')){const {ConcreteModel}=await import('../src/studio/material-labs/concrete-si.ts');await labs('concrete',ConcreteModel,m=>({peakMPa:+(m.peakForce/m.area/1e6).toFixed(3),peakStrain:+(m.peakStrain*1e3).toFixed(3),stopped:m.stopped,eroded:m.solid.erodedCount,unconverged:m.unconverged}));}
if(jsonOut)writeFileSync(jsonOut,JSON.stringify(results,null,1));
