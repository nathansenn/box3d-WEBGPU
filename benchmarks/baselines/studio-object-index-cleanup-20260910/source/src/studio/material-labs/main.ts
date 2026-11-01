import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@phosphor-icons/web/regular';
import './style.css';
import {installStudyNavigation,STUDIO_STUDIES} from '../study-navigation';
import {LABS,MATERIALS,materialFor,normalizeSettings,readSettings,writeSettings,type LabId,type LabSettings} from './catalog';
import {createModel,copyFrame,DT,METRIC_LABELS,type LabFrame} from './models';
import {MaterialLabWorld,type LabView} from './world';

const icon=(name:string)=>`<i class="ph ph-${name}" aria-hidden="true"></i>`;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function bootMaterialLab(id:LabId):Promise<void>{
  const lab=LABS[id],root=document.getElementById('studio')!,query=new URLSearchParams(location.search);
  let settings=readSettings(id,query),model=createModel(id,settings),running=false,ready=false,disposed=false,playback=-1,speed=1,previous=0,accumulator=0,lastUi=0,nextSample=0,animation=0;
  const candidate=lab.experiments.find(e=>e.id===(query.get('experiment')??lab.experiments[0].id));
  const candidateSettings=candidate?normalizeSettings(id,{...lab.defaults,...candidate.settings}):undefined;
  let experiment=candidate&&candidateSettings&&Object.keys(settings).every(k=>settings[k as keyof LabSettings]===candidateSettings[k as keyof LabSettings])?candidate.id:'',tab:'setup'|'material'|'test'='setup',history:LabFrame[]=[model.snapshot()],view:LabView='hero';
  let world:MaterialLabWorld;let end=lab.duration;
  root.className='material-studio';root.dataset.study=id;root.dataset.renderReady='false';document.title=`BOX3D — ${lab.title}`;
  root.innerHTML=`
    <header class="material-header"><a class="brand" href="?studio=liquid" aria-label="BOX3D Engineering Studio"><strong>BOX3D</strong><span>Engineering Studio</span></a><nav aria-label="Studies"></nav><div class="material-header-actions"><button data-action="reference" aria-label="Reference">${icon('book-open')}<span>Reference</span></button><button data-action="export" aria-label="Export run data">${icon('download-simple')}<span>Export</span></button></div></header>
    <main class="material-layout"><nav class="material-rail" aria-label="Studio tools"><button data-tab="setup" class="active" title="Experiments">${icon('flask')}<span>Labs</span></button><button data-tab="material" title="Materials">${icon('stack')}<span>Material</span></button><button data-tab="test" title="Test controls">${icon('sliders-horizontal')}<span>Test</span></button><button data-action="reference" title="View mockup">${icon('squares-four')}<span>Reference</span></button><div class="rail-bottom"><button data-action="lighting" title="Change lighting">${icon('sun-horizon')}<span>Light</span></button><button data-action="capture" title="Capture viewport">${icon('camera')}<span>Capture</span></button></div></nav>
    <section class="material-viewport" aria-label="Simulation viewport"><div id="lab-canvas"></div><div class="lab-loading" role="status"><span class="lab-spinner"></span><strong>Preparing ${lab.title.toLowerCase()}</strong><small>Loading the specimen, materials and lighting</small></div><div class="viewport-title"><span class="live-dot"></span><span id="phase">Ready</span><span id="scene-time">0.00 s</span></div><div class="lab-view-actions"><button data-action="fit" aria-label="Fit apparatus">${icon('crosshair-simple')}</button><button data-action="orbit" aria-label="Orbit camera" aria-pressed="false">${icon('arrows-clockwise')}</button><button data-action="focus" aria-label="Expand viewport" aria-pressed="false">${icon('corners-out')}</button></div><div class="viewport-bottom"><div class="lab-cameras" role="group" aria-label="Inspection views">${(['hero','detail','top'] as LabView[]).map((v,i)=>`<button data-view="${v}" aria-pressed="${i===0}">${icon(['cube','scan','grid-four'][i])}${['Overview','Detail','Top'][i]}</button>`).join('')}</div><div class="lab-metrics">${METRIC_LABELS[id].map((label,i)=>`<div><small>${label}</small><strong id="metric-${i}">—</strong><svg class="metric-spark" viewBox="0 0 100 24" aria-hidden="true"><path id="spark-${i}"/></svg></div>`).join('')}</div></div></section>
    <aside class="material-inspector" aria-label="Experiment inspector"><div class="inspector-heading"><div><span class="eyebrow">${lab.code} / MATERIAL STUDIES</span><h1>${lab.title}</h1></div><button data-action="collapse" aria-label="Hide inspector">${icon('sidebar-simple')}</button><p>${lab.subtitle}</p></div><div class="inspector-tabs" role="tablist" aria-label="Experiment workflow">${(['setup','material','test'] as const).map((t,i)=>`<button role="tab" id="lab-tab-${t}" data-tab="${t}" aria-controls="lab-panel" aria-selected="${i===0}">${['Set up','Material','Test'][i]}</button>`).join('')}</div><div class="inspector-scroll"><div id="lab-panel" role="tabpanel" aria-labelledby="lab-tab-setup"></div><details class="model-note"><summary>About this model</summary><p>${modelDescription(id)}</p><p>Material coefficients are authored for comparison. These results are not calibrated material-test data.</p></details></div><div class="inspector-footer"><p id="setup-status" role="status">${lab.mechanism}</p><button class="lab-run primary" data-action="run" disabled>${icon('play')}<span>Run experiment</span></button></div></aside></main>
    <div class="material-playback" role="region" aria-label="Simulation playback"><button class="primary play-square" data-action="run" aria-label="Run experiment" disabled>${icon('play')}</button><button data-action="reset" aria-label="Reset experiment">${icon('arrow-counter-clockwise')}<span>Reset</span></button><output id="play-time">0.00 s</output><label class="scrub-wrap"><span class="sr-only">Replay recorded history</span><input id="lab-scrub" aria-label="Replay recorded history" type="range" min="0" max="0" value="0" step="1"><span id="recorded">0.0 s recorded</span></label><button data-action="live" class="live-button">Live</button><select aria-label="Playback speed" id="lab-speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
    <footer class="material-status"><span id="renderer-status">Preparing graphics</span><span>Comparative models · not calibrated</span><span>5 material labs · 40 experiments</span></footer>
    <dialog class="reference-dialog"><div class="reference-heading"><div><span class="eyebrow">GENERATED DESIGN REFERENCE</span><h2>${lab.title}</h2></div><button data-action="close-reference" aria-label="Close reference">${icon('x')}</button></div><img src="${import.meta.env.BASE_URL}studio/references/material-labs/${id}.png" alt="Generated mockup for the ${lab.title.toLowerCase()} apparatus and interface"><p>Design target. The live study reconstructs its apparatus, composition and controls; simulated measurements come from the model.</p></dialog>`;
  installStudyNavigation(root,id);
  const $=<E extends Element=HTMLElement>(selector:string)=>root.querySelector<E>(selector)!;
  function writeUrl():void {historyReplace(writeSettings(id,settings,experiment));}
  function duration():number {return id==='concrete'?Math.max(lab.duration,settings.load/settings.rate+4):id==='rubber'?Math.max(lab.duration,settings.load/settings.rate+settings.damping+8):lab.duration;}
  function setTab(value:typeof tab):void {
    tab=value;root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);if(b.getAttribute('role')==='tab'){b.setAttribute('aria-selected',String(b.dataset.tab===tab));b.tabIndex=b.dataset.tab===tab?0:-1;}});
    $('#lab-panel').setAttribute('aria-labelledby','lab-tab-'+tab);renderPanel();
  }
  function renderPanel():void {
    const profile=materialFor(id,settings.material);
    const specimen=`<div class="specimen-summary"><span class="material-swatch" style="--swatch:${profile.color}"></span><div><strong>${profile.name}</strong><small>${lab.code} · ${lab.mechanism}</small></div></div>`;
    const panel=$('#lab-panel');
    if(tab==='setup')panel.innerHTML=`<div class="section-label"><h2>Prepared experiments</h2><span>${lab.experiments.length} presets</span></div><label class="preset-search">${icon('magnifying-glass')}<input type="search" aria-label="Search experiments" placeholder="Find an experiment…"></label><div class="experiment-list">${lab.experiments.map((e,i)=>`<button class="experiment-card" data-experiment="${e.id}" aria-pressed="${e.id===experiment}"><span class="experiment-number">0${i+1}</span><span><strong>${e.name}</strong><small>${e.description}</small></span>${icon('arrow-up-right')}</button>`).join('')}</div><div class="other-studies"><span class="eyebrow">EXPLORE THE STUDIO</span>${STUDIO_STUDIES.filter(([key])=>key!==id).map(([key,title])=>`<a href="?studio=${key}">${title}${icon('arrow-right')}</a>`).join('')}</div>`;
    if(tab==='material')panel.innerHTML=specimen+`<div class="section-label"><h2>Material library</h2><span>${MATERIALS[id].length} profiles</span></div><div class="material-grid">${MATERIALS[id].map(m=>`<button data-material="${m.id}" class="material-choice" aria-pressed="${m.id===settings.material}"><span class="material-swatch" style="--swatch:${m.color}"></span><strong>${m.name}</strong>${m.id===settings.material?icon('check'):''}</button>`).join('')}</div><p class="material-description">${profile.note}</p><div class="property-bars"><label>Resistance<meter min="0" max="4" value="${profile.strength}"></meter></label><label>Damping<meter min="0" max="1" value="${profile.damping}"></meter></label><label>${id==='liquid'?'Viscosity':'Retention'}<meter min="0" max="${id==='liquid'?5:1}" value="${id==='liquid'?profile.viscosity:profile.retention}"></meter></label></div>`;
    if(tab==='test')panel.innerHTML=specimen+`<div class="section-label"><h2>Test program</h2><span>Independent controls</span></div><div class="lab-controls">${lab.controls.map(c=>`<div class="lab-control"><label for="control-${c.key}">${c.label}</label><div><input id="number-${c.key}" aria-label="${c.label} value" type="number" min="${c.min}" max="${c.max}" step="${c.step}" value="${settings[c.key]}"><span>${c.unit}</span></div><input id="control-${c.key}" aria-label="${c.label}" data-setting="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${settings[c.key]}"></div>`).join('')}</div><button class="release-button" data-action="release">${icon('arrow-u-up-left')}${id==='liquid'||id==='granular'?'Open gate fully':id==='glass'?'Release pendulum':'Release load'}</button><label class="seed-control">Specimen seed<input id="lab-seed" aria-label="Specimen seed" type="number" min="1" max="999999" step="1" value="${settings.seed}"></label><p class="control-hint">Changing a material or test setting prepares a fresh specimen. Recorded runs can be replayed below.</p>`;
    panel.querySelector<HTMLInputElement>('input[type="search"]')?.addEventListener('input',event=>{const text=(event.target as HTMLInputElement).value.toLowerCase();panel.querySelectorAll<HTMLElement>('.experiment-card').forEach(card=>card.hidden=!card.textContent?.toLowerCase().includes(text));});
    panel.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input=>input.addEventListener('change',()=>apply({...settings,[input.dataset.setting!]:Number(input.value)})));
    for(const c of lab.controls){const input=panel.querySelector<HTMLInputElement>('#number-'+c.key);if(input){const commit=()=>{const v=Number(input.value);if(Number.isFinite(v)&&v!==settings[c.key])apply({...settings,[c.key]:v});};input.addEventListener('change',commit);input.addEventListener('blur',commit);}}
    panel.querySelector<HTMLInputElement>('#lab-seed')?.addEventListener('change',event=>apply({...settings,seed:Number((event.target as HTMLInputElement).value)}));
  }
  function reset():void {
    running=false;model=createModel(id,settings);world.setModel(model);history=[model.snapshot()];playback=-1;accumulator=0;nextSample=0;end=duration();$('#setup-status').textContent='Fresh specimen ready';sync(model.frame);
  }
  function apply(input:Partial<LabSettings>,preset=''):void {if(!ready)return;settings=normalizeSettings(id,input);experiment=preset;reset();renderPanel();writeUrl();}
  function sync(f:LabFrame):void {
    $('#phase').textContent=(running?'':f.time>0?'Paused · ':'')+f.phase;$('#scene-time').textContent=f.time.toFixed(2)+' s';$('#play-time').textContent=f.time.toFixed(2)+' s';
    for(let i=0;i<3;i++){$('#metric-'+i).textContent=Number.isInteger(f.metrics[i])&&f.metrics[i]>100?String(f.metrics[i]):f.metrics[i].toFixed(id==='granular'&&i===2?0:2);const values=history.slice(-100).map(h=>h.metrics[i]),max=Math.max(.01,...values),min=Math.min(0,...values);$('#spark-'+i).setAttribute('d',values.map((v,j)=>`${j?'L':'M'}${j/(Math.max(1,values.length-1))*100},${23-(v-min)/(max-min||1)*21}`).join(' '));}
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>{b.disabled=!ready;b.innerHTML=icon(running?'pause':'play')+(b.classList.contains('lab-run')?`<span>${running?'Pause experiment':playback>=0?'Play history':'Run experiment'}</span>`:'');b.setAttribute('aria-label',running?'Pause experiment':playback>=0?'Play history':'Run experiment');});
    const scrub=$<HTMLInputElement>('#lab-scrub');scrub.max=String(Math.max(0,history.length-1));scrub.value=String(playback>=0?playback:history.length-1);$('#recorded').textContent=(history.at(-1)?.time??0).toFixed(1)+' s recorded';root.dataset.phase=f.phase;root.dataset.settings=JSON.stringify(settings);
  }
  let warm=false,orbit=false;
  root.addEventListener('click',async event=>{
    const button=(event.target as HTMLElement).closest<HTMLElement>('button');if(!button)return;
    if(button.dataset.tab){setTab(button.dataset.tab as typeof tab);root.classList.remove('inspector-hidden');return;}
    if(button.dataset.experiment){const p=lab.experiments.find(e=>e.id===button.dataset.experiment)!;apply({...lab.defaults,...p.settings},p.id);return;}
    if(button.dataset.material){apply({...settings,material:button.dataset.material});return;}
    if(button.dataset.view){view=button.dataset.view as LabView;world.fit(view);root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.view===view)));return;}
    switch(button.dataset.action){
      case 'run':if(!ready)break;if(!running&&playback<0&&model.frame.time>=end)reset();if(!running&&playback===history.length-1)playback=0;running=!running;accumulator=0;sync(playback>=0?history[playback]:model.frame);break;
      case 'reset':if(ready)reset();break;
      case 'release':if(ready){model.release();playback=-1;running=true;sync(model.frame);}break;
      case 'live':playback=-1;world.update(model.frame);sync(model.frame);break;
      case 'fit':world.fit(view);break;
      case 'orbit':orbit=!orbit;world.setRotate(orbit);button.setAttribute('aria-pressed',String(orbit));break;
      case 'lighting':warm=!warm;world.setLighting(warm);break;
      case 'focus':case 'collapse':root.classList.toggle('inspector-hidden');root.querySelector('[data-action="focus"]')?.setAttribute('aria-pressed',String(root.classList.contains('inspector-hidden')));break;
      case 'reference':$<HTMLDialogElement>('.reference-dialog').showModal();break;
      case 'close-reference':$<HTMLDialogElement>('.reference-dialog').close();break;
      case 'capture':if(ready){const a=document.createElement('a');a.download=`box3d-${id}-${model.frame.time.toFixed(2)}s.png`;a.href=await world.capture();a.click();}break;
      case 'export':{
        const data={format:'box3d-material-study-v1',study:id,settings,experiment,model:modelDescription(id),calibrated:false,frames:history.map(f=>({...f,positions:Array.from(f.positions),rotations:Array.from(f.rotations),damage:Array.from(f.damage)}))};
        const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.download=`box3d-${id}-run.json`;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);break;
      }
    }
  });
  $<HTMLInputElement>('#lab-scrub').addEventListener('input',event=>{running=false;playback=Number((event.target as HTMLInputElement).value);world.update(history[playback]);sync(history[playback]);});
  $<HTMLSelectElement>('#lab-speed').addEventListener('change',event=>speed=Number((event.target as HTMLSelectElement).value));
  root.querySelector('.inspector-tabs')!.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;event.preventDefault();const tabs=['setup','material','test'] as const,index=tabs.indexOf(tab);setTab(tabs[key==='Home'?0:key==='End'?2:(index+(key==='ArrowRight'?1:2))%3]);$('#lab-tab-'+tab).focus();});
  setTab('setup');world=new MaterialLabWorld($('#lab-canvas'),model);await world.init();if(disposed)return;
  ready=true;end=duration();root.dataset.renderReady='true';$('.lab-loading').remove();$('#renderer-status').textContent=world.backend+' renderer · fixed-step model';writeUrl();sync(model.frame);
  function animate(now:number):void {
    if(disposed)return;animation=requestAnimationFrame(animate);const delta=previous?Math.min(.05,(now-previous)/1000):0;previous=now;
    if(running&&!document.hidden){
      accumulator+=delta*speed;
      if(playback>=0){while(playback<history.length-1&&accumulator>=history[playback+1].time-history[playback].time){accumulator-=history[playback+1].time-history[playback].time;playback++;}if(playback===history.length-1)running=false;world.update(history[playback]);}
      else {let steps=0;while(accumulator>=DT&&steps++<12){model.step(DT);accumulator-=DT;if(model.frame.time>=nextSample){history.push(model.snapshot());nextSample=model.frame.time+Math.max(.06,end/300);}if(model.frame.time>=end){running=false;history.push(model.snapshot());break;}}world.update(model.frame);}
    }
    if(now-lastUi>100){sync(playback>=0?history[playback]:model.frame);lastUi=now;}world.render();
  }
  animation=requestAnimationFrame(animate);
  const dispose=()=>{disposed=true;cancelAnimationFrame(animation);world.dispose();};window.addEventListener('pagehide',dispose,{once:true});
  if(import.meta.hot)import.meta.hot.dispose(dispose);
}
function historyReplace(url:string):void {window.history.replaceState(null,'',url);}
export function modelDescription(id:LabId):string {
  return {liquid:'A conservative, flat-bed shallow-water model with closed tank boundaries, solid obstacles and a gate flux limiter. Viscosity is represented by depth-averaged drag. It does not simulate overturning waves or separated droplets.',glass:'A pendulum transfers energy to a pre-fragmented pane. An expanding fracture front releases rigid shards above an authored threshold. Laminated and wired profiles add retaining springs. It is not a calibrated crack-tip stress solver.',concrete:'A bonded fragment model uses compression, contact, irreversible bond loss and optional retaining ties. Fragment geometry carries the visible cracks and spalls. Aggregate-scale contacts approximate the crushed volume.',rubber:'A damped viscoelastic compression model drives a volume-aware bulging surface. Compressible foam profiles lose volume and retain permanent set. The displayed geometry follows the solved compression state.',granular:'Coarse particles use gravity, non-penetration constraints and frictional contact damping in a closed tray. The material names describe comparative contact profiles; grain shape and capillary forces are simplified.'}[id];
}
