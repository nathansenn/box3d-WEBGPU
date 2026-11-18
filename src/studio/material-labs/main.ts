import './liquid.css';
import {LiquidAnalysisWorkspace} from './liquid-analysis-view';
import {liquidPanel,liquidSwitcher,liquidInspection,updateLiquidTelemetry} from './liquid-panel';
import {LIQUID_RIGS,type LiquidDisplay} from './liquid-config';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@phosphor-icons/web/regular';
import './style.css';
import {installStudyNavigation,STUDIO_STUDIES} from '../study-navigation';
import {LABS,MATERIALS,materialFor,normalizeSettings,readSettings,writeSettings,type LabId,type LabSettings} from './catalog';
import {createModel,copyFrame,DT,METRIC_LABELS,type LiquidModel,type LabFrame} from './models';
import {MaterialLabWorld,type LabView} from './world';
import {MaterialRunLibrary} from './run-library-view';
import {type RunEvent} from './run-library';
import {GlassPresentation} from './glass-presentation';
import {exportRunFrames} from './run-export';

const icon=(name:string)=>`<i class="ph ph-${name}" aria-hidden="true"></i>`;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function bootMaterialLab(id:LabId):Promise<void>{
  const lifetime=new AbortController();
  const lab=LABS[id],root=document.getElementById('studio')!,query=new URLSearchParams(location.search);
  let settings=readSettings(id,query),model=createModel(id,settings),running=false,ready=false,disposed=false,playback=-1,speed=1,previous=0,accumulator=0,lastUi=0,nextSample=0,animation=0;
  const candidate=lab.experiments.find(e=>e.id===(query.get('experiment')??lab.experiments[0].id));
  const candidateSettings=candidate?normalizeSettings(id,{...lab.defaults,...candidate.settings}):undefined;
  let experiment=candidate&&candidateSettings&&Object.keys(settings).every(k=>settings[k as keyof LabSettings]===candidateSettings[k as keyof LabSettings])?candidate.id:'',tab:'setup'|'material'|'test'|'analyze'='setup',history:LabFrame[]=[model.snapshot()],view:LabView='hero';
  let world:MaterialLabWorld;let end=lab.duration;
  const workflow=id==='liquid'?['setup','material','test','analyze'] as const:['setup','material','test'] as const;
  let glassWorker:import('./glass-worker-client').GlassWorkerClient|undefined,physicsError='';
  const glassPresentation=id==='glass'?new GlassPresentation():undefined;
  let manualEvents:RunEvent[]=[];
  root.className='material-studio';root.dataset.study=id;root.dataset.renderReady='false';document.title=`BOX3D — ${lab.title}`;
  root.innerHTML=`
    <header class="material-header"><a class="brand" href="?studio=liquid" aria-label="BOX3D Engineering Studio"><strong>BOX3D</strong><span>Engineering Studio</span></a><nav aria-label="Studies"></nav><div class="material-header-actions"><button data-action="reference" aria-label="Reference">${icon('book-open')}<span>Reference</span></button><button data-action="library" aria-label="Run library" aria-expanded="false" aria-controls="run-library">${icon('chart-line')}<span>Run library</span></button><button data-action="export" aria-label="Export run data">${icon('download-simple')}<span>Export</span></button></div></header>
    <main class="material-layout"><nav class="material-rail" aria-label="Studio tools"><button data-tab="setup" class="active" title="Experiments">${icon('flask')}<span>Labs</span></button><button data-tab="material" title="Materials">${icon('stack')}<span>Material</span></button><button data-tab="test" title="Test controls">${icon('sliders-horizontal')}<span>Test</span></button><button data-action="reference" title="View mockup">${icon('squares-four')}<span>Reference</span></button><div class="rail-bottom"><button data-action="lighting" title="Change lighting">${icon('sun-horizon')}<span>Light</span></button><button data-action="capture" title="Capture viewport">${icon('camera')}<span>Capture</span></button></div></nav>
    <section class="material-viewport" aria-label="Simulation viewport"><div id="lab-canvas"></div><div class="lab-loading" role="status"><span class="lab-spinner"></span><strong>Preparing ${lab.title.toLowerCase()}</strong><small>Loading the specimen, materials and lighting</small></div><div class="viewport-title"><span class="live-dot"></span><span id="phase">Ready</span><span id="scene-time">0.00 s</span></div>${id==='liquid'?'<div class="liquid-telemetry" aria-label="Flow measurements"></div>'+liquidInspection():''}<div class="lab-view-actions"><button data-action="fit" aria-label="Fit apparatus">${icon('crosshair-simple')}</button><button data-action="orbit" aria-label="Orbit camera" aria-pressed="false">${icon('arrows-clockwise')}</button><button data-action="focus" aria-label="Expand viewport" aria-pressed="false">${icon('corners-out')}</button></div><div class="viewport-bottom"><div class="lab-cameras" role="group" aria-label="Inspection views">${(['hero','detail','top'] as LabView[]).map((v,i)=>`<button data-view="${v}" aria-pressed="${i===0}">${icon(['cube','scan','grid-four'][i])}${['Overview','Detail','Top'][i]}</button>`).join('')}</div><div class="lab-metrics">${METRIC_LABELS[id].map((label,i)=>`<div><small>${label}</small><strong id="metric-${i}">—</strong><svg class="metric-spark" viewBox="0 0 100 24" aria-hidden="true"><path id="spark-${i}"/></svg></div>`).join('')}</div></div></section>
    <aside class="material-inspector" aria-label="Experiment inspector"><div class="inspector-heading">${id==='liquid'?liquidSwitcher(settings):''}<div><span class="eyebrow">${lab.code} / MATERIAL STUDIES</span><h1>${lab.title}</h1></div><button data-action="collapse" aria-label="Hide inspector">${icon('sidebar-simple')}</button><p>${lab.subtitle}</p></div><div class="inspector-tabs" role="tablist" aria-label="Experiment workflow">${workflow.map((t,i)=>`<button role="tab" id="lab-tab-${t}" data-tab="${t}" aria-controls="lab-panel" aria-selected="${i===0}">${['Set up','Material','Test','Analyze'][i]}</button>`).join('')}</div><div class="inspector-scroll"><div id="lab-panel" role="tabpanel" aria-labelledby="lab-tab-setup"></div><details class="model-note"><summary>About this model</summary><p>${modelDescription(id)}</p><p>Material coefficients are authored for comparison. These results are not calibrated material-test data.</p></details></div><div class="inspector-footer"><p id="setup-status" role="status">${lab.mechanism}</p><button class="lab-run primary" data-action="run" disabled>${icon('play')}<span>Run experiment</span></button></div></aside></main>
    <div class="material-playback" role="region" aria-label="Simulation playback"><button class="primary play-square" data-action="run" aria-label="Run experiment" disabled>${icon('play')}</button><button data-action="reset" aria-label="Reset experiment">${icon('arrow-counter-clockwise')}<span>Reset</span></button><output id="play-time">0.00 s</output><label class="scrub-wrap"><span class="sr-only">Replay recorded history</span><input id="lab-scrub" aria-label="Replay recorded history" type="range" min="0" max="0" value="0" step="1"><span id="recorded">0.0 s recorded</span></label><button data-action="live" class="live-button">Live</button><select aria-label="Playback speed" id="lab-speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
    <footer class="material-status"><span id="renderer-status">Preparing graphics</span><span>Comparative models · not calibrated</span><span>${Object.values(LABS).length} material labs · ${Object.values(LABS).reduce((n,l)=>n+l.experiments.length,0)} experiments</span></footer>
    <dialog class="reference-dialog"><div class="reference-heading"><div><span class="eyebrow">GENERATED DESIGN REFERENCE</span><h2>${lab.title}</h2></div><button data-action="close-reference" aria-label="Close reference">${icon('x')}</button></div><img src="${import.meta.env.BASE_URL}studio/references/material-labs/${id==='liquid'?'liquid-v5':id}.png" alt="Generated mockup for the ${lab.title.toLowerCase()} apparatus and interface"><p>Design target. The live study reconstructs its apparatus, composition and controls; simulated measurements come from the model.</p></dialog>`;
  installStudyNavigation(root,id);
  const $=<E extends Element=HTMLElement>(selector:string)=>root.querySelector<E>(selector)!;
  function writeUrl():void {const url=writeSettings(id,settings,experiment);historyReplace(url+(id==='liquid'&&tab==='analyze'?'&panel=analyze':''));}
  function duration():number {return id==='liquid'?(settings.runSeconds??18):id==='concrete'?Math.max(lab.duration,settings.load/settings.rate+4):id==='rubber'?Math.max(lab.duration,settings.load/settings.rate+settings.damping+8):lab.duration;}
  const programFinished=(time:number)=>time>=end-DT*1e-6;
  const runLibrary=new MaterialRunLibrary(root,{
    study:id,
    current:()=>({study:id,name:lab.experiments.find(e=>e.id===experiment)?.name??`${materialFor(id,settings.material).name} study`,experiment,settings,metricLabels:METRIC_LABELS[id],complete:programFinished(model.frame.time),phase:model.frame.phase,events:manualEvents,frames:[...history,model.frame],ready,error:physicsError}),
    pause:()=>{running=false;accumulator=0;snapGlass();sync(playback>=0?history[playback]:model.frame);},
    load:run=>{if(run.study===id){apply(run.settings,run.experiment);$('#setup-status').textContent='Saved setup loaded · fresh specimen';}else location.assign(writeSettings(run.study,run.settings,run.experiment));},
  });
  const analysis=id==='liquid'?new LiquidAnalysisWorkspace({current:()=>({model:model as LiquidModel,settings,frame:playback>=0?history[playback]:model.frame,history,ready}),pause:()=>{running=false;accumulator=0;sync(playback>=0?history[playback]:model.frame);},load:p=>apply(p),section:(distance,visible)=>world?.setLiquidSection(distance,visible)}):undefined;
  function setTab(value:typeof tab):void {
    tab=value;root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.getAttribute('role')==='tab'){b.setAttribute('aria-selected',String(b.dataset.tab===tab));b.tabIndex=b.dataset.tab===tab?0:-1;}});
    $('#lab-panel').setAttribute('aria-labelledby','lab-tab-'+tab);renderPanel();if(ready)writeUrl();
  }
  function renderPanel():void {
    const profile=materialFor(id,settings.material);
    const specimen=`<div class="specimen-summary"><span class="material-swatch" style="--swatch:${profile.color}"></span><div><strong>${profile.name}</strong><small>${lab.code} · ${lab.mechanism}</small></div></div>`;
    const panel=$('#lab-panel');
    if(tab==='analyze'&&analysis){analysis.mount(panel);return;}analysis?.unmount();
    if(tab==='setup')panel.innerHTML=`<div class="section-label"><h2>Prepared experiments</h2><span>${lab.experiments.length} presets</span></div><label class="preset-search">${icon('magnifying-glass')}<input type="search" aria-label="Search experiments" placeholder="Find an experiment…"></label><div class="experiment-list">${lab.experiments.map((e,i)=>`<button class="experiment-card" data-experiment="${e.id}" aria-pressed="${e.id===experiment}"><span class="experiment-number">0${i+1}</span><span><strong>${e.name}</strong><small>${e.description}</small></span>${icon('arrow-up-right')}</button>`).join('')}</div><div class="other-studies"><span class="eyebrow">EXPLORE THE STUDIO</span>${STUDIO_STUDIES.filter(([key])=>key!==id).map(([key,title])=>`<a href="?studio=${key}">${title}${icon('arrow-right')}</a>`).join('')}</div>`;
    if(tab==='material')panel.innerHTML=specimen+`<div class="section-label"><h2>Material library</h2><span>${MATERIALS[id].length} profiles</span></div><div class="material-grid">${MATERIALS[id].map(m=>`<button data-material="${m.id}" class="material-choice" aria-pressed="${m.id===settings.material}"><span class="material-swatch" style="--swatch:${m.color}"></span><strong>${m.name}</strong>${m.id===settings.material?icon('check'):''}</button>`).join('')}</div><p class="material-description">${profile.note}</p><div class="property-bars"><label>Resistance<meter min="0" max="4" value="${profile.strength}"></meter></label><label>Damping<meter min="0" max="1" value="${profile.damping}"></meter></label><label>${id==='liquid'?'Viscosity':'Retention'}<meter min="0" max="${id==='liquid'?5:1}" value="${id==='liquid'?profile.viscosity:profile.retention}"></meter></label></div>`;
    if(tab==='test')panel.innerHTML=specimen+`<div class="section-label"><h2>Test program</h2><span>Independent controls</span></div><div class="lab-controls">${lab.controls.map(c=>`<div class="lab-control"><label for="control-${c.key}">${c.label}</label><div><input id="number-${c.key}" aria-label="${c.label} value" type="number" min="${c.min}" max="${c.max}" step="${c.step}" value="${settings[c.key]}"><span>${c.unit}</span></div><input id="control-${c.key}" aria-label="${c.label}" data-setting="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${settings[c.key]}"></div>`).join('')}</div><button class="release-button" data-action="release">${icon('arrow-u-up-left')}${id==='liquid'||id==='granular'?'Open gate fully':id==='glass'?'Release pendulum':'Release load'}</button><label class="seed-control">Specimen seed<input id="lab-seed" aria-label="Specimen seed" type="number" min="1" max="999999" step="1" value="${settings.seed}"></label><p class="control-hint">Changing a material or test setting prepares a fresh specimen. Recorded runs can be replayed below.</p>`;
    if(id==='liquid')panel.innerHTML=liquidPanel(tab,settings,experiment);
    panel.querySelectorAll<HTMLInputElement>('[data-liquid-number]').forEach(input=>{const commit=()=>{const key=input.dataset.liquidNumber! as keyof LabSettings,v=Number(input.value);if(input.value!==''&&Number.isFinite(v)&&v!==settings[key])apply({...settings,[key]:v});};input.addEventListener('change',commit);if(input.type==='number'){input.addEventListener('blur',commit);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit();}});}else input.addEventListener('input',()=>{const paired=panel.querySelector<HTMLInputElement>('#liquid-number-'+input.dataset.liquidNumber);if(paired)paired.value=input.value;});});
    panel.querySelectorAll<HTMLSelectElement>('[data-liquid-enum]').forEach(input=>input.addEventListener('change',()=>apply({...settings,[input.dataset.liquidEnum!]:input.value})));
    panel.querySelector<HTMLInputElement>('input[type="search"]')?.addEventListener('input',event=>{const text=(event.target as HTMLInputElement).value.toLowerCase();panel.querySelectorAll<HTMLElement>('.experiment-card').forEach(card=>card.hidden=!card.textContent?.toLowerCase().includes(text));});
    panel.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input=>input.addEventListener('change',()=>apply({...settings,[input.dataset.setting!]:Number(input.value)})));
    for(const c of lab.controls){const input=panel.querySelector<HTMLInputElement>('#number-'+c.key);if(input){const commit=()=>{const v=Number(input.value);if(Number.isFinite(v)&&v!==settings[c.key])apply({...settings,[c.key]:v});};input.addEventListener('change',commit);input.addEventListener('blur',commit);}}
    panel.querySelector<HTMLInputElement>('#lab-seed')?.addEventListener('change',event=>apply({...settings,seed:Number((event.target as HTMLInputElement).value)}));
  }
  function reset():void {
    running=false;glassWorker?.dispose();glassWorker=undefined;physicsError='';manualEvents=[];model=createModel(id,settings);world.setModel(model);history=[model.snapshot()];playback=-1;accumulator=0;nextSample=0;end=duration();snapGlass();startGlassWorker();$('#setup-status').textContent='Fresh specimen ready';sync(model.frame);
  }
  function snapGlass():void {if(glassPresentation){glassPresentation.reset(model.frame,performance.now());if(playback<0)world.update(model.frame);}}
  function apply(input:Partial<LabSettings>,preset=''):void {if(!ready)return;settings=normalizeSettings(id,input);experiment=preset;reset();renderPanel();if(id==='liquid'){root.querySelectorAll<HTMLElement>('[data-rig]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rig===settings.rig)));}writeUrl();}
  let liquidDisplay:LiquidDisplay='natural';
  function sync(f:LabFrame):void {
    $('#phase').textContent=(running?'':f.time>0?'Paused · ':'')+f.phase;$('#scene-time').textContent=f.time.toFixed(2)+' s';$('#play-time').textContent=f.time.toFixed(2)+' s';
    if(id==='liquid'){updateLiquidTelemetry($('.liquid-telemetry'),f);root.dataset.rig=settings.rig;root.dataset.display=liquidDisplay;root.dataset.floodArea=String(f.hydraulics?.floodArea??0);root.dataset.coverage=String(f.hydraulics?.coverage??0);const legend=$('.liquid-legend');legend.hidden=liquidDisplay==='natural';const max=liquidDisplay==='speed'?2:settings.rig==='flume'?1000:settings.rig==='river'?500:settings.rig==='pipes'?250:50,unit=liquidDisplay==='speed'?'m/s':'mm';$('[data-legend-label]').textContent=liquidDisplay==='speed'?'Flow speed':'Water depth';$('[data-legend-mid]').textContent=String(max/2);$('[data-legend-max]').textContent=`${max}+ ${unit}`;root.dataset.balance=String(f.hydraulics?.residual??0);root.dataset.supply=String(f.hydraulics?.inlet??0);$('#setup-status').textContent=LIQUID_RIGS.find(r=>r.id===settings.rig)!.name+' · '+(f.hydraulics?.supplyOn?'Supply ready':'Supply stopped');}
    if(f.collisions)$('#setup-status').textContent=physicsError|| (f.time===0?'Pendulum ready':`${f.collisions.impacts} pendulum impacts · ${f.collisions.contacts} contact points`);
    for(let i=0;i<3;i++){$('#metric-'+i).textContent=Number.isInteger(f.metrics[i])&&f.metrics[i]>100?String(f.metrics[i]):f.metrics[i].toFixed(id==='liquid'&&Math.abs(f.metrics[i])<.01?4:id==='granular'&&i===2?0:2);const values=history.slice(-100).map(h=>h.metrics[i]),max=Math.max(.01,...values),min=Math.min(0,...values);$('#spark-'+i).setAttribute('d',values.map((v,j)=>`${j?'L':'M'}${j/(Math.max(1,values.length-1))*100},${23-(v-min)/(max-min||1)*21}`).join(' '));}
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>{b.disabled=!ready||Boolean(physicsError);b.innerHTML=icon(running?'pause':'play')+(b.classList.contains('lab-run')?`<span>${running?'Pause experiment':playback>=0?'Play history':'Run experiment'}</span>`:'');b.setAttribute('aria-label',running?'Pause experiment':playback>=0?'Play history':'Run experiment');});
    const scrub=$<HTMLInputElement>('#lab-scrub');scrub.max=String(Math.max(0,history.length-1));scrub.value=String(playback>=0?playback:history.length-1);$('#recorded').textContent=(history.at(-1)?.time??0).toFixed(1)+' s recorded';root.dataset.phase=f.phase;root.dataset.settings=JSON.stringify(settings);
    runLibrary.refresh();analysis?.update(f);
  }
  let warm=false,orbit=false;
  root.addEventListener('click',async event=>{
    const button=(event.target as HTMLElement).closest<HTMLElement>('button');if(!button)return;
    if(id==='liquid'&&button.dataset.rig){const first=lab.experiments.find(e=>(e.settings.rig??'flume')===button.dataset.rig)!;apply({...lab.defaults,...first.settings},first.id);return;}
    if(id==='liquid'&&button.dataset.liquidDisplay){liquidDisplay=button.dataset.liquidDisplay as LiquidDisplay;world.setLiquidDisplay(liquidDisplay);root.querySelectorAll<HTMLElement>('[data-liquid-display]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.liquidDisplay===liquidDisplay)));const frame=playback>=0?history[playback]:model.frame;world.update(frame);sync(frame);return;}
    if(id==='liquid'&&button.dataset.film){apply({...settings,fill:Number(button.dataset.film)});return;}
    if(id==='liquid'&&button.dataset.viscosity){apply({...settings,damping:Number(button.dataset.viscosity)});return;}
    if(button.dataset.tab){runLibrary.close(false);setTab(button.dataset.tab as typeof tab);root.classList.remove('inspector-hidden');return;}
    if(button.dataset.experiment){const p=lab.experiments.find(e=>e.id===button.dataset.experiment)!;apply({...lab.defaults,...p.settings},p.id);return;}
    if(button.dataset.material){apply({...settings,material:button.dataset.material});return;}
    if(button.dataset.view){view=button.dataset.view as LabView;world.fit(view);root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.view===view)));return;}
    switch(button.dataset.action){
      case 'run':if(!ready||physicsError)break;if(!running&&playback<0&&programFinished(model.frame.time))reset();if(!running&&playback===history.length-1)playback=0;running=!running;accumulator=0;snapGlass();sync(playback>=0?history[playback]:model.frame);break;
      case 'reset':if(ready)reset();break;
      case 'release':if(ready&&!physicsError&&!model.released){if(id==='liquid'&&settings.rig!=='flume')end=Math.max(end,model.frame.time+8);manualEvents.push({time:model.frame.time,action:'release'});model.release();glassWorker?.release();playback=-1;running=true;sync(model.frame);}break;
      case 'live':playback=-1;snapGlass();world.update(model.frame);sync(model.frame);break;
      case 'fit':world.fit(view);break;
      case 'orbit':orbit=!orbit;world.setRotate(orbit);button.setAttribute('aria-pressed',String(orbit));break;
      case 'lighting':warm=!warm;world.setLighting(warm);break;
      case 'focus':case 'collapse':if(root.classList.contains('run-library-open')){runLibrary.close(false);root.classList.add('inspector-hidden');}else root.classList.toggle('inspector-hidden');root.querySelector('[data-action="focus"]')?.setAttribute('aria-pressed',String(root.classList.contains('inspector-hidden')));break;
      case 'reference':$<HTMLDialogElement>('.reference-dialog').showModal();break;
      case 'library':runLibrary.open();break;
      case 'close-reference':$<HTMLDialogElement>('.reference-dialog').close();break;
      case 'capture':if(ready){const a=document.createElement('a');a.download=`box3d-${id}-${model.frame.time.toFixed(2)}s.png`;a.href=await world.capture();a.click();}break;
      case 'export':{
        const data={format:'box3d-material-study-v1',study:id,settings,experiment,events:manualEvents,model:modelDescription(id),calibrated:false,frames:exportRunFrames(history,model.frame)};
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.download=`box3d-${id}-run.json`;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break;
      }
    }
  },{signal:lifetime.signal});
  $<HTMLInputElement>('#lab-scrub').addEventListener('input',event=>{running=false;playback=Number((event.target as HTMLInputElement).value);snapGlass();world.update(history[playback]);sync(history[playback]);});
  $<HTMLSelectElement>('#lab-speed').addEventListener('change',event=>speed=Number((event.target as HTMLSelectElement).value));
  root.querySelector('.inspector-tabs')!.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;event.preventDefault();const tabs:readonly (typeof tab)[]=workflow,index=tabs.indexOf(tab);setTab(tabs[key==='Home'?0:key==='End'?tabs.length-1:(index+(key==='ArrowRight'?1:tabs.length-1))%tabs.length]);$('#lab-tab-'+tab).focus();});
  const dispose=()=>{disposed=true;lifetime.abort();cancelAnimationFrame(animation);runLibrary.dispose();analysis?.dispose();glassWorker?.dispose();world?.dispose();window.removeEventListener('pagehide',dispose);};window.addEventListener('pagehide',dispose,{once:true});
  if(import.meta.hot)import.meta.hot.dispose(dispose);
  setTab(id==='liquid'&&query.get('panel')==='analyze'?'analyze':'setup');world=new MaterialLabWorld($('#lab-canvas'),model);await world.init();if(disposed)return;
  const {GlassWorkerClient}=id==='glass'?await import('./glass-worker-client'):{GlassWorkerClient:undefined};if(disposed)return;
  function startGlassWorker():void {
    if(!GlassWorkerClient||disposed)return;
    try{glassWorker=new GlassWorkerClient(settings,frame=>{
      if(disposed)return;model.frame=frame;
      glassPresentation?.receive(frame,performance.now(),running&&playback<0&&!programFinished(frame.time));
      if(frame.time>=nextSample||programFinished(frame.time)){history.push(model.snapshot());nextSample=frame.time+Math.max(.06,end/300);}
      if(programFinished(frame.time))running=false;
      if(playback<0){world.update(glassPresentation?.sample(performance.now())??frame);sync(frame);}
    },message=>{physicsError=`${message}. Reset the experiment to retry.`;running=false;snapGlass();sync(model.frame);});}
    catch{physicsError='Glass collision worker could not start. Reset the experiment to retry.';running=false;}
  }
  startGlassWorker();
  ready=true;end=duration();root.dataset.renderReady='true';$('.lab-loading').remove();$('#renderer-status').textContent=world.backend+' renderer · fixed-step model';writeUrl();sync(model.frame);
  function animate(now:number):void {
    if(disposed)return;animation=requestAnimationFrame(animate);const delta=previous?Math.min(.05,(now-previous)/1000):0;previous=now;
    if(running&&!document.hidden){
      accumulator+=delta*speed;
      if(playback>=0){while(playback<history.length-1&&accumulator>=history[playback+1].time-history[playback].time){accumulator-=history[playback+1].time-history[playback].time;playback++;}if(playback===history.length-1)running=false;world.update(history[playback]);}
      else if(glassWorker){
        accumulator=Math.min(accumulator,.1);
        const ticks=Math.min(glassWorker.maxBatchTicks,Math.floor(accumulator/DT),Math.max(0,Math.ceil((end-model.frame.time)/DT-1e-7)));
        if(ticks>0&&glassWorker.step(ticks))accumulator-=ticks*DT;
      }
      else if(!physicsError){let steps=0;while(accumulator>=DT&&steps++<12){model.step(id==='liquid'?Math.min(DT,end-model.frame.time):DT);accumulator-=DT;if(model.frame.time>=nextSample){history.push(model.snapshot());nextSample=model.frame.time+Math.max(.06,end/300);}if(programFinished(model.frame.time)){running=false;history.push(model.snapshot());break;}}world.update(model.frame);}
    }
    if(running&&playback<0){const display=glassPresentation?.sample(now);if(display)world.update(display);}
    if(now-lastUi>100){sync(playback>=0?history[playback]:model.frame);lastUi=now;}world.render();
  }
  animation=requestAnimationFrame(animate);

}
function historyReplace(url:string):void {window.history.replaceState(null,'',url);}
export function modelDescription(id:LabId):string {
  return {liquid:'A conservative depth-averaged flow model over the same shaped bed you see. Riverbanks can flood, and surface hollows retain water. Pump head, valve resistance and supply timing set delivery; pipe and viscosity coefficients are comparative. Rain, drainage and infiltration enter the recorded volume balance. Surface profiles alter drag and absorption; they do not predict shoe friction or certified slip resistance. Pipe jets and rain streaks illustrate the recorded supply. Overturning, droplet breakup, sediment transport and contact-angle physics are not solved.',glass:'The pendulum and released triangular glass prisms share a swept contact solve with friction and angular response. Pieces collide with each other, the remaining pane, clamps and tray. Fragments can clear the low tray rim and land on the floor. Fracture thresholds and retaining layers remain comparative approximations, not a calibrated crack-tip stress model.',concrete:'A bonded fragment model uses compression, contact, irreversible bond loss and optional retaining ties. Fragment geometry carries the visible cracks and spalls. Aggregate-scale contacts approximate the crushed volume.',rubber:'A damped viscoelastic compression model drives a volume-aware bulging surface. Compressible foam profiles lose volume and retain permanent set. The displayed geometry follows the solved compression state.',granular:'Coarse particles use gravity, non-penetration constraints and frictional contact damping in a closed tray. The material names describe comparative contact profiles; grain shape and capillary forces are simplified.'}[id];
}
