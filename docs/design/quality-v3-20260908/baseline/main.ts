import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@phosphor-icons/web/regular';
import './studio.css';
import { FailureSimulation, FIXED_DT, STUDIES, type StudyId, type Snapshot } from './physics';
import { StudioWorld } from './world';
import { PresetBrowser } from './preset-browser';
import { finishFor, lightingFor, loadFor, PACKS, CAMERA_PRESETS, type CameraPreset } from './presets';

const icon=(name:string)=>`<i class="ph ph-${name}" aria-hidden="true"></i>`;
const base=import.meta.env.BASE_URL;
const details={
  canopy:{family:'Membrane studies',specimen:'Woven membrane',material:'Ivory · plain weave',mechanism:'Strain → tear propagation',supports:'4 corner anchors',load:'Uniform pressure',icon:'grid-four',label:'Membrane response',dimension:'10.0 × 8.0',program:'Pressure ramp',description:'Distributed pressure and crosswind tension the woven surface. Connections tear when their accumulated strain damage reaches the rupture limit.'},
  plate:{family:'Material studies',specimen:'Metal sheet',material:'Brushed metal · plastic lattice',mechanism:'Yield → dent → perforation',supports:'Pinned perimeter · 4 edges',load:'Actuator travel',icon:'square-half',label:'Plate response',dimension:'5.2 × 4.4',program:'Punch displacement',description:'A circular punch contacts the supported sheet. Plastic extension leaves a permanent dent; excessive strain severs the lattice and opens a fracture.'},
  bridge:{family:'Cable studies',specimen:'Suspension footbridge',material:'Steel cable · timber deck',mechanism:'Rupture → support loss → collapse',supports:'2 towers · 4 cable saddles',load:'Asymmetric deck load',icon:'bridge',label:'Cable response',dimension:'42.0 × 3.8',program:'Deck overload',description:'The deck transfers gravity and applied load through hangers to paired main cables. Broken connections stop carrying load and unsupported deck sections fall.'},
};

export async function bootStudio(requested:string):Promise<void> {
  let id:StudyId=requested in STUDIES?requested as StudyId:'canopy';
  const initialQuery=new URLSearchParams(location.search);
  let finish=finishFor(id,initialQuery.get('finish')),lighting=lightingFor(initialQuery.get('light')??(id==='plate'?'softbox':'daylight')),recipe=loadFor(id,initialQuery.get('recipe'));
  let cameraPreset:CameraPreset=CAMERA_PRESETS.find(p=>p.id===initialQuery.get('camera'))?.id??'hero';
  let quality:'ultra'|'balanced'=initialQuery.get('quality')==='balanced'?'balanced':'ultra';
  let presetBrowser:PresetBrowser;
  let sim=new FailureSimulation(id);
  let replaying=false,replayTime=0,runEnd=30;
  let running=false,loading=true,frames:Snapshot[]=[sim.snapshot()],playback=-1;
  let speed=recipe.speed,accumulator=0,lastTime=0,lastUi=0,nextSample=.1,runNumber=1;
  let responseMode=false,program=recipe.target<=.8?'service':'failure',target=recipe.target,strength=recipe.strength,wind=recipe.wind;
  let customLoad=false;
  let settingsHistory:{time:number;target:number;strength:number;wind:number;program:string}[]=[];
  function recordSettings():void {settingsHistory.push({time:sim.time,target,strength,wind,program});}
  function markCustomLoad():void {customLoad=true;setText('#recipe-label','Custom load case');}
  let world:StudioWorld;
  let queuedCapture=false;
  const root=document.getElementById('studio')!;
  document.title='BOX3D — Engineering Studio';
  const themeQuery=new URLSearchParams(location.search).get('theme');
  let theme=themeQuery&&['precision','atelier','observatory'].includes(themeQuery)?themeQuery:STUDIES[id].theme;

  function markup():void {
    const d=details[id];root.dataset.theme=theme;root.dataset.study=id;root.dataset.renderReady='false';
    root.innerHTML=`
      <header class="studio-header">
        <a class="brand" href="?studio=canopy" aria-label="BOX3D Engineering Studio">${icon('cube')}<strong>BOX<span>3D</span></strong><span class="brand-caption">Engineering Studio</span></a>
        <nav class="study-tabs" aria-label="Studies">
          ${(['canopy','plate','bridge'] as StudyId[]).map((s,i)=>`<button data-study="${s}" class="${id===s?'active':''}" aria-current="${id===s?'page':'false'}"><span class="tab-number">0${i+1}</span>${s==='canopy'?'Canopy':s==='plate'?'Plate press':'Suspension bridge'}</button>`).join('')}
        </nav>
        <div class="header-actions"><button class="preset-launch" data-action="presets" aria-label="Open preset library">${icon('swatches')}<span>Presets</span></button><button class="icon-button" data-action="compare" aria-label="Compare reference" title="Compare reference">${icon('squares-four')}</button><button class="icon-button" data-action="export" aria-label="Export run data" title="Export run data">${icon('export')}</button><button class="primary run-button" data-action="run" disabled>${icon('play')}<span>Run simulation</span></button></div>
      </header>
      <div class="studio-breadcrumb"><div><a href="?workbench=1" class="library-link">${icon('caret-left')}<span>All experiments</span></a><span class="slash">/</span><span>${d.family}</span><span class="slash">/</span><strong>${STUDIES[id].title}</strong></div><span class="model-badge"><b></b>Reduced model<span class="badge-extra"> · PBD</span></span></div>
      <main class="studio-layout">
        <aside class="study-outline" aria-label="Study setup">
          <div class="outline-heading"><span>STUDY 0${(['canopy','plate','bridge'] as string[]).indexOf(id)+1}</span><button class="icon-button" data-action="fit" aria-label="Fit study">${icon('crosshair')}</button></div>
          <div class="outline-title">${STUDIES[id].title}</div><p class="outline-subtitle">${STUDIES[id].subtitle}</p>
          <section class="tree-section"><h2>SPECIMEN</h2><div class="tree-row selected">${icon(d.icon)}<span>${d.specimen}</span><span class="tree-dot"></span></div><div class="tree-detail">${d.dimension}<span>model units</span></div></section>
          <section class="tree-section"><h2>SUPPORTS</h2>${(id==='canopy'?['Corner A','Corner B','Corner C','Corner D']:id==='plate'?['Left edge','Right edge','Front edge','Back edge']:['West tower','East tower','Cable anchors','Deck hangers']).map(x=>`<div class="tree-row">${icon('anchor-simple')}<span>${x}</span><span class="tree-status">${x==='Deck hangers'?'Linked':'Fixed'}</span></div>`).join('')}</section>
          <section class="tree-section"><h2>LOAD CASE</h2><div class="tree-row accented">${icon('arrow-down')}<span>${d.load}</span></div>${id!=='plate'?`<div class="tree-row">${icon('wind')}<span>Crosswind</span><span class="tree-status" id="wind-summary">0.25</span></div>`:''}</section>
          <section class="tree-section response-tree"><h2>RESPONSE</h2><div class="tree-row">${icon('waveform')}<span>${d.label}</span><span class="tree-dot cyan"></span></div><div class="tree-row">${icon('git-branch')}<span>Broken connections</span><span class="mono" id="tree-broken">0</span></div></section>
          <div class="outline-bottom"><label for="theme">Workspace</label><select id="theme" aria-label="Workspace treatment"><option value="precision" ${theme==='precision'?'selected':''}>Precision Studio</option><option value="atelier" ${theme==='atelier'?'selected':''}>Research Atelier</option><option value="observatory" ${theme==='observatory'?'selected':''}>Field Observatory</option></select><a href="?workbench=1">${icon('flask')} Open full workbench ${icon('arrow-up-right')}</a></div>
        </aside>
        <section class="viewport-wrap" aria-label="Simulation viewport">
          <div id="scene-host"></div>
          <div class="viewport-top"><div class="view-segment" role="group" aria-label="Surface display"><button data-action="material" class="active" aria-pressed="true">Material</button><button data-action="response" aria-pressed="false">Response</button></div><div class="viewport-tools"><button data-action="focus" class="round-button" aria-label="Focus on scene" title="Focus on scene">${icon('frame-corners')}</button><button data-action="second" class="round-button" aria-label="Second camera angle" title="Second angle">${icon('arrows-clockwise')}</button><button data-action="fit" class="round-button" aria-label="Fit camera" title="Fit camera">${icon('crosshair')}</button><button data-action="fullscreen" class="round-button" aria-label="Expand viewport" title="Expand viewport">${icon('corners-out')}</button></div></div>
          <div class="look-strip"><button data-action="finishes">${icon('swatches')}<span id="finish-label">${finish.name}</span></button><span>·</span><button data-action="lighting">${icon('sun')}<span id="lighting-label">${lighting.name}</span></button></div>
          <div class="viewport-caption"><span class="micro-label">${id==='bridge'?'FIELD OBSERVATORY':id==='plate'?'RESEARCH ATELIER':'PRECISION STUDIO'}</span><h1>${id==='canopy'?'The shape of tension.':id==='plate'?'Beyond the elastic limit.':'Every connection matters.'}</h1><span>Explore the load. Understand the failure.</span></div>
          <div class="live-status" role="status"><span class="status-dot"></span><span id="phase-label">Preparing scene</span><span class="mono" id="viewport-time">0.00 s</span></div>
          <div class="strain-legend" hidden><span>CONNECTION STRAIN</span><div></div><span>Elastic <b>Rupture limit</b></span></div>
          <div class="scene-loading"><span class="loader"></span><strong>Preparing ${id==='bridge'?'the valley':'the studio'}</strong><span>Building materials & lighting</span></div>
          <button class="mobile-inspector-button" data-action="inspector">${icon('sliders-horizontal')} Load settings</button>
        </section>
        <aside class="load-inspector" aria-label="Load inspector">
          <div class="inspector-heading"><h2>Load case</h2><span class="mono">R<span id="run-number">${runNumber}</span></span><button class="icon-button close-inspector" data-action="inspector" aria-label="Close load settings">${icon('x')}</button></div>
          <div class="inspector-scroll"><label class="field-label" for="program">Load program</label><select id="program"><option value="failure" ${program==='failure'?'selected':''}>Ramp to failure</option><option value="service" ${program==='service'?'selected':''}>Service load</option></select>
          <button class="recipe-shortcut" data-action="loads">${icon('waveform')}<span id="recipe-label">${recipe.name}</span>${icon('caret-right')}</button><div class="load-readout"><div><span class="field-label">Target load</span><output id="target-output">${target.toFixed(2)}</output><span class="unit-label">normalized</span></div><div class="load-symbol">${icon(id==='plate'?'arrows-in-line-vertical':'arrow-down')}</div></div>
          <input type="range" id="load" aria-label="Target load" min="0" max="5" step=".05" value="${target}"><div class="range-labels"><span>0.00</span><span>5.00</span></div>
          <div class="inspector-divider"></div><h3>Material & failure</h3>
          <button class="material-card" data-action="finishes" aria-label="Choose specimen finish"><div class="material-swatch ${id}" id="finish-swatch" style="background-image:url('${base}studio/materials/${PACKS[finish.pack].base}');background-color:${finish.color}"></div><div><strong>${d.specimen}</strong><span id="finish-description">${finish.name}</span></div>${icon('caret-right')}</button>
          <label class="slider-label" for="strength"><span>Connection strength</span><output id="strength-output">${strength.toFixed(2)}×</output></label><input type="range" id="strength" aria-label="Connection strength" min=".4" max="2" step=".05" value="${strength}">
          ${id!=='plate'?'<label class="slider-label" for="wind"><span>Crosswind</span><output id="wind-output">0.25</output></label><input type="range" id="wind" aria-label="Crosswind" min="0" max="2" step=".05" value=".25">':''}
          <dl class="material-properties"><div><dt>Failure mode</dt><dd>${id==='canopy'?'Tensile tearing':id==='plate'?'Ductile fracture':'Connection rupture'}</dd></div><div><dt>Integration</dt><dd>120 Hz · 12 iterations</dd></div><div><dt>Collision</dt><dd>${id==='plate'?'Punch + bed':'Ground contact'}</dd></div></dl>
          <div class="mobile-workspace"><label class="field-label" for="theme-mobile">Workspace treatment</label><select id="theme-mobile"><option value="precision" ${theme==='precision'?'selected':''}>Precision Studio</option><option value="atelier" ${theme==='atelier'?'selected':''}>Research Atelier</option><option value="observatory" ${theme==='observatory'?'selected':''}>Field Observatory</option></select></div><details class="model-details"><summary>How this study works ${icon('info')}</summary><p>${d.description}</p><p>Dimensions, stiffness and failure thresholds are authored model values. Results are comparative and not calibrated to a physical specimen.</p></details>
          <div class="presentation-controls"><h3>Presentation</h3><div><label for="camera-preset">Camera</label><select id="camera-preset">${CAMERA_PRESETS.map(p=>`<option value="${p.id}" ${cameraPreset===p.id?'selected':''}>${p.name}</option>`).join('')}</select></div><div><label for="render-quality">Quality</label><select id="render-quality"><option value="ultra" ${quality==='ultra'?'selected':''}>Ultra · full resolution</option><option value="balanced" ${quality==='balanced'?'selected':''}>Balanced</option></select></div></div>
          </div><div class="result-stats"><div><span>Deflection</span><strong id="stat-deflection">0.000</strong><small>model units</small></div><div><span>Connections lost</span><strong id="stat-broken">0</strong><small id="stat-total">of ${sim.links.length}</small></div></div>
          <button data-action="unload" class="secondary full-width">${icon('arrow-up')} Release load</button><button data-action="run" class="primary full-width inspector-run" disabled>${icon('play')}<span>Run simulation</span></button>
        </aside>
        <section class="timeline-bar" aria-label="Simulation playback"><button class="play-control" data-action="run" aria-label="Run or pause simulation" disabled>${icon('play')}</button><button class="icon-button" data-action="reset" aria-label="Reset simulation" title="Reset simulation">${icon('arrow-counter-clockwise')}</button><span class="mono" id="clock">0.00 s</span><div class="timeline-track"><input type="range" id="scrub" aria-label="Replay recorded history" min="0" max="0" step="1" value="0"><div class="timeline-labels"><span>0 s</span><span id="history-state">LIVE HISTORY</span><span id="recorded-duration">0.0 s recorded</span></div></div><button class="live-button" data-action="live" title="Return to the latest simulation state">Live</button><select id="speed" aria-label="Playback speed"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1.0×</option><option value="2">2.0×</option></select><button class="icon-button" data-action="capture" aria-label="Capture viewport" title="Capture viewport">${icon('camera')}</button></section>
        <section class="response-panel" aria-label="Response history"><div class="chart-area"><div class="chart-heading"><h2>Response history</h2><div class="chart-legend"><span><b class="teal"></b>Deflection</span><span><b class="orange"></b>Applied load</span></div><span class="chart-units">model units / normalized load</span></div><canvas id="response-chart" aria-label="Recorded deflection and applied load over model time" role="img"></canvas></div><div class="event-area"><div class="chart-heading"><h2>Failure events</h2><span class="event-count" id="event-count">0</span></div><ol id="event-list"><li class="empty-events">Run a study to trace how failure develops.<span>Every event comes from the solver.</span></li></ol></div></section>
      </main>
      <footer class="studio-footer"><span><b class="footer-dot"></b><span id="engine-label">Initializing renderer</span><span class="footer-extra" id="render-metrics"> · Local session</span></span><span>Comparative model · not calibrated</span><button data-action="export">Export evidence ${icon('arrow-up-right')}</button></footer>
      <div class="toast" role="status" hidden></div>
      <dialog class="comparison-dialog"><div class="dialog-heading"><div><strong>Design reference</strong><span>Selected visual direction · generated concept</span></div><button data-action="close-compare" class="icon-button" aria-label="Close reference">${icon('x')}</button></div><img src="${base}studio/references/${id}.png" alt="Selected ${STUDIES[id].theme} generated interface and scene reference"><p>The live scene is rebuilt as geometry. This image is a visual reference; its example values are not simulation results.</p></dialog>`;
    bind();
    presetBrowser=new PresetBrowser(root,{
      state:()=>({study:id,finish:finish.id,lighting:lighting.id,load:recipe.id,camera:cameraPreset}),
      finish:async p=>{await world.applyFinish(p);finish=p;syncPresentation();updateUrl();},
      lighting:p=>{world.setLighting(p);lighting=p;syncPresentation();updateUrl();},
      load:p=>{recipe=p;customLoad=false;target=p.target;strength=p.strength;wind=p.wind;speed=p.speed;program=target<=.8?'service':'failure';reset();syncControls();updateUrl();},
      camera:p=>{cameraPreset=p;world.setCamera(p);syncPresentation();updateUrl();},
    });
    syncControls();
  }

  function toast(message:string):void {const t=root.querySelector<HTMLElement>('.toast')!;t.textContent=message;t.hidden=false;setTimeout(()=>{t.hidden=true;},3600);}
  function displayed():Snapshot {return playback>=0?frames[playback]:sim.snapshot();}
  function updateUrl():void {const q=new URLSearchParams({studio:id,theme,finish:finish.id,light:lighting.id,recipe:recipe.id,camera:cameraPreset,quality});history.replaceState(null,'',`${location.pathname}?${q}`);}
  function setText(selector:string,text:string):void {const e=root.querySelector(selector);if(e)e.textContent=text;}
  function syncPresentation():void {
    setText('#finish-label',finish.name);setText('#lighting-label',lighting.name);setText('#finish-description',finish.name);
    const swatch=root.querySelector<HTMLElement>('#finish-swatch');if(swatch){swatch.style.backgroundImage=`url('${base}studio/materials/${PACKS[finish.pack].base}')`;swatch.style.backgroundColor=finish.color;}
    const camera=root.querySelector<HTMLSelectElement>('#camera-preset');if(camera)camera.value=cameraPreset;
    root.dataset.finish=finish.id;root.dataset.lighting=lighting.id;root.dataset.camera=cameraPreset;root.dataset.quality=quality;
  }
  function syncControls():void {
    for(const [selector,value] of [['#load',target],['#strength',strength],['#wind',wind],['#speed',speed],['#program',program]] as const){const input=root.querySelector<HTMLInputElement>(selector);if(input)input.value=String(value);}
    setText('#target-output',target.toFixed(2));setText('#strength-output',strength.toFixed(2)+'×');setText('#wind-output',wind.toFixed(2));setText('#wind-summary',wind.toFixed(2));setText('#recipe-label',customLoad?'Custom load case':recipe.name);syncPresentation();
  }
  function reset():void {
    running=false;replaying=false;runEnd=30;settingsHistory=[];sim=new FailureSimulation(id);sim.targetLoad=0;sim.strength=strength;sim.wind=wind;
    frames=[sim.snapshot()];playback=-1;nextSample=.1;accumulator=0;runNumber++;
    world.resetModel(sim);setText('#run-number',String(runNumber));updateUi();
  }
  function toggleRun():void {
    if(loading)return;
    if(playback>=0) {replaying=!replaying;running=false;replayTime=frames[playback].response.time;updateUi();return;}
    running=!running;if(running){sim.targetLoad=target;recordSettings();if(sim.time>=runEnd)runEnd=sim.time+10;}
    accumulator=0;updateUi();
  }
  async function switchStudy(next:StudyId):Promise<void> {
    if(next===id||loading)return;
    customLoad=false;root.classList.remove('scene-focus','inspector-open');
    running=false;replaying=false;loading=true;runEnd=30;settingsHistory=[];id=next;theme=STUDIES[id].theme;finish=finishFor(id);lighting=lightingFor(id==='plate'?'softbox':'daylight');recipe=loadFor(id);cameraPreset='hero';sim=new FailureSimulation(id);sim.targetLoad=0;
    frames=[sim.snapshot()];playback=-1;target=recipe.target;strength=recipe.strength;wind=recipe.wind;program='failure';speed=recipe.speed;responseMode=false;nextSample=.1;accumulator=0;
    // Preserve the one initialized GPU renderer across navigation.
    const canvas=world.renderer.domElement;markup();root.querySelector('#scene-host')!.append(canvas);
    world.attach(root.querySelector<HTMLElement>('#scene-host')!);await world.changeStudy(sim);world.setLighting(lighting);world.setQuality(quality);world.resize();updateUrl();ready();
  }
  function download(filename:string,blob:Blob):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportRun():void {
    const payload={schema:'box3d.failure-studio.v1',study:id,createdAt:new Date().toISOString(),model:'Reduced position-based dynamics; authored normalized coefficients; not calibrated',
      source:'src/studio/physics.ts',settings:{target,strength,wind,program,fixedStep:FIXED_DT},camera:world.cameraState(),presentation:world.presentationState(),preset:{load:recipe.id,modified:customLoad,appearanceAffectsPhysics:false},
      topology:{nodes:sim.nodes.map(n=>({rest:n.rest,fixed:n.inverseMass===0})),links:sim.links.map(e=>({a:e.a,b:e.b,kind:e.kind,rest:e.original,threshold:e.threshold}))},
      settingsHistory,events:sim.events,samples:frames.map(f=>f.response),finalPositions:Array.from(sim.snapshot().positions),brokenLinks:sim.links.flatMap((e,i)=>e.broken?[i]:[])};
    download(`box3d-${id}-R${runNumber}.json`,new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));toast('Run data and failure topology exported.');
  }

  function bind():void {
    root.querySelectorAll<HTMLButtonElement>('[data-study]').forEach(b=>b.onclick=()=>{void switchStudy(b.dataset.study as StudyId);});
    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>{
      const a=b.dataset.action;
      if(a==='run')toggleRun();
      if(a==='reset')reset();
      if(a==='live'){running=false;replaying=false;playback=-1;world.update(sim.snapshot(),responseMode);updateUi();}
      if(a==='fit'||a==='second'){cameraPreset=a==='second'?'reverse':'hero';world?.setCamera(cameraPreset);syncPresentation();updateUrl();}
      if(a==='focus'){root.classList.toggle('scene-focus');b.setAttribute('aria-label',root.classList.contains('scene-focus')?'Return to studio':'Focus on scene');requestAnimationFrame(()=>world.resize());}
      if(!loading&&a==='presets')presetBrowser.open();
      if(!loading&&a==='finishes')presetBrowser.open('finishes');
      if(!loading&&a==='lighting')presetBrowser.open('lighting');
      if(!loading&&a==='loads')presetBrowser.open('loads');
      if(a==='material'||a==='response') {responseMode=a==='response';world.update(displayed(),responseMode);root.querySelectorAll('.view-segment button').forEach(x=>{x.classList.toggle('active',(x as HTMLElement).dataset.action===a);x.setAttribute('aria-pressed',String((x as HTMLElement).dataset.action===a));});root.querySelector<HTMLElement>('.strain-legend')!.hidden=!responseMode;}
      if(a==='unload') {markCustomLoad();playback=-1;replaying=false;sim.targetLoad=0;target=0;recordSettings();running=true;runEnd=sim.time+Math.max(10,sim.load/.55+2);root.querySelector<HTMLInputElement>('#load')!.value='0';setText('#target-output','0.00');toast('Load released. Permanent damage remains until reset.');updateUi();}
      if(a==='inspector')root.classList.toggle('inspector-open');
      if(a==='export'&&!loading)exportRun();
      if(a==='capture')queuedCapture=true;
      if(a==='compare')root.querySelector<HTMLDialogElement>('.comparison-dialog')!.showModal();
      if(a==='close-compare')root.querySelector<HTMLDialogElement>('.comparison-dialog')!.close();
      if(a==='fullscreen') {if(document.fullscreenElement)void document.exitFullscreen();else void root.querySelector<HTMLElement>('.viewport-wrap')!.requestFullscreen().catch(()=>toast('Fullscreen is unavailable in this browser.'));}
    });
    root.querySelectorAll<HTMLSelectElement>('#theme,#theme-mobile').forEach(select=>select.onchange=()=>{theme=select.value;root.dataset.theme=theme;root.querySelectorAll<HTMLSelectElement>('#theme,#theme-mobile').forEach(s=>s.value=theme);updateUrl();requestAnimationFrame(()=>world.resize());});
    root.querySelector<HTMLSelectElement>('#program')!.onchange=e=>{markCustomLoad();program=(e.target as HTMLSelectElement).value;target=program==='service'?.8:4;root.querySelector<HTMLInputElement>('#load')!.value=String(target);setText('#target-output',target.toFixed(2));if(running)sim.targetLoad=target;recordSettings();};
    root.querySelector<HTMLInputElement>('#load')!.oninput=e=>{markCustomLoad();target=Number((e.target as HTMLInputElement).value);setText('#target-output',target.toFixed(2));if(running)sim.targetLoad=target;recordSettings();};
    root.querySelector<HTMLInputElement>('#strength')!.oninput=e=>{markCustomLoad();strength=Number((e.target as HTMLInputElement).value);sim.strength=strength;setText('#strength-output',strength.toFixed(2)+'×');recordSettings();};
    const w=root.querySelector<HTMLInputElement>('#wind');if(w)w.oninput=()=>{markCustomLoad();wind=Number(w.value);sim.wind=wind;setText('#wind-output',wind.toFixed(2));setText('#wind-summary',wind.toFixed(2));recordSettings();};
    root.querySelector<HTMLSelectElement>('#camera-preset')!.onchange=e=>{cameraPreset=(e.target as HTMLSelectElement).value as CameraPreset;world.setCamera(cameraPreset);syncPresentation();updateUrl();};
    root.querySelector<HTMLSelectElement>('#render-quality')!.onchange=e=>{quality=(e.target as HTMLSelectElement).value as 'ultra'|'balanced';world.setQuality(quality);syncPresentation();updateUrl();};
    root.querySelector<HTMLSelectElement>('#speed')!.onchange=e=>speed=Number((e.target as HTMLSelectElement).value);
    root.querySelector<HTMLInputElement>('#scrub')!.oninput=e=>{running=false;replaying=false;playback=Number((e.target as HTMLInputElement).value);world.update(displayed(),responseMode);updateUi();};
  }

  function ready():void {
    loading=false;root.dataset.renderReady='true';root.querySelector('.scene-loading')?.remove();
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>b.disabled=false);
    const backend=(world.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL 2';
    setText('#engine-label',backend+' renderer');updateUi();
  }
  function updateUi():void {
    const r=displayed().response;
    setText('#phase-label',playback>=0?(replaying?'Replaying history':'Recorded history'):running?r.phase:sim.time===0?'Ready to simulate':'Paused · '+r.phase);
    setText('#viewport-time',r.time.toFixed(2)+' s');setText('#clock',r.time.toFixed(2)+' s');
    setText('#stat-deflection',r.deflection.toFixed(3));setText('#stat-broken',String(r.broken));setText('#tree-broken',String(r.broken));
    root.dataset.phase=r.phase.toLowerCase().replaceAll(' ','-');root.dataset.running=String(running||replaying);
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>{
      b.innerHTML=icon(running||replaying?'pause':'play')+(b.classList.contains('play-control')?'':`<span>${playback>=0?(replaying?'Pause replay':'Play history'):running?'Pause simulation':'Run simulation'}</span>`);
      if(b.classList.contains('play-control'))b.setAttribute('aria-label',playback>=0?(replaying?'Pause replay':'Play history'):running?'Pause simulation':'Run simulation');
    });
    const scrub=root.querySelector<HTMLInputElement>('#scrub')!;scrub.max=String(frames.length-1);scrub.value=String(playback>=0?playback:frames.length-1);
    setText('#recorded-duration',(frames.at(-1)?.response.time??0).toFixed(1)+' s recorded');setText('#history-state',playback>=0?'REPLAY · '+(playback+1)+' / '+frames.length:'LIVE HISTORY');
    const events=sim.events.filter(e=>e.time<=r.time);setText('#event-count',String(events.length));
    if(events.length)root.querySelector('#event-list')!.innerHTML=events.slice(-3).reverse().map(e=>`<li><time>${e.time.toFixed(2)} s</time><span>${e.message}</span></li>`).join('');
    else root.querySelector('#event-list')!.innerHTML='<li class="empty-events">'+(running?'Recording the load path…':'Run a study to trace how failure develops.')+'<span>Every event comes from the solver.</span></li>';
    const metrics=world?.metrics();if(metrics){setText('#render-metrics',` · ${metrics.fps} fps · ${metrics.drawCalls} draws`);root.dataset.renderFrames=String(world.renderer.info.frame);root.dataset.drawCalls=String(metrics.drawCalls);root.dataset.triangles=String(metrics.triangles);root.dataset.sceneObjects=String(metrics.objects);root.dataset.fps=String(metrics.fps);}
    drawChart(r.time);
  }
  function drawChart(cursor:number):void {
    const canvas=root.querySelector<HTMLCanvasElement>('#response-chart')!,rect=canvas.getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio,2),w=rect.width,h=rect.height;
    if(w<1||h<1)return;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const c=canvas.getContext('2d')!;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const light=theme==='atelier',muted=light?'#7b817e':'#8b9594',line=light?'#e1e4df':'#303b3c';
    const left=36,right=w-12,top=10,bottom=h-25;
    const maxT=Math.max(10,frames.at(-1)?.response.time??0),maxY=Math.max(1,...frames.map(f=>Math.max(f.response.deflection,f.response.load)))*1.12;
    c.font='10px "IBM Plex Mono", monospace';c.lineWidth=1;c.textAlign='right';
    for(let i=0;i<4;i++){const y=bottom-(bottom-top)*i/3;c.strokeStyle=line;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.fillStyle=muted;c.fillText((maxY*i/3).toFixed(1),left-9,y+3);}
    c.textAlign='center';for(let i=0;i<=4;i++){const x=left+(right-left)*i/4;c.fillStyle=muted;c.fillText((maxT*i/4).toFixed(1)+' s',x,h-7);}
    for(const [key,color] of [['load','#f7893a'],['deflection','#48c4c4']] as const){c.beginPath();c.strokeStyle=color;c.lineWidth=1.7;frames.forEach((f,i)=>{const x=left+(right-left)*f.response.time/maxT,y=bottom-(bottom-top)*f.response[key]/maxY;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();}
    if(cursor>0){const x=left+(right-left)*cursor/maxT;c.setLineDash([3,4]);c.strokeStyle=muted;c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();c.setLineDash([]);}
  }

  markup();updateUrl();
  sim.targetLoad=0;sim.strength=strength;sim.wind=wind;
  world=new StudioWorld(root.querySelector<HTMLElement>('#scene-host')!,sim);
  await world.init();await world.applyFinish(finish);world.setLighting(lighting);world.setQuality(quality);world.setCamera(cameraPreset);ready();
  function animate(now:number):void {
    const elapsed=Math.min(.05,lastTime?(now-lastTime)/1000:0);lastTime=now;
    if(running) {
      accumulator+=elapsed*speed;
      let steps=0;
      while(accumulator>=FIXED_DT&&steps<12) {
        sim.step();accumulator-=FIXED_DT;steps++;
        if(sim.time>=nextSample) {frames.push(sim.snapshot());nextSample+=.1;if(frames.length>601)frames.splice(1,1);}
      }
      world.update(sim.snapshot(),responseMode);
      if(sim.time>=runEnd) {running=false;toast('Run recorded. Scrub the timeline to replay the failure.');updateUi();}
    }
    if(replaying){replayTime+=elapsed*speed;while(playback<frames.length-1&&frames[playback+1].response.time<=replayTime)playback++;world.update(frames[playback],responseMode);if(playback===frames.length-1){replaying=false;updateUi();}}
    world.render(now/1000);
    if(queuedCapture){queuedCapture=false;world.renderer.domElement.toBlob(blob=>{if(blob)download(`box3d-${id}-${displayed().response.time.toFixed(2)}s.png`,blob);});toast('Viewport image captured.');}
    if(now-lastUi>120) {updateUi();lastUi=now;}
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
