import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@phosphor-icons/web/regular';
import './studio.css';
import './reference-workspace.css';
import { FailureSimulation, FIXED_DT, STUDIES, STUDIO_SCALED_CHECKPOINT_BACKEND, STUDIO_CANOPY_CONTACT_BACKEND, type StudyId, type Snapshot } from './physics';
import { StudioWorld } from './world';
import { createStudioClient, type StudioClient } from '../engine/studio-client';
import type { StudioStepResult } from '../engine/studio-runtime';
import { FixedFrameClock, StageTimings } from '../perf/frame-clock';
import { RecordingRing } from '../perf/recording-ring';
import { copySnapshotInto, interpolateSnapshotInto } from './presentation-state';
import { MAX_CHECKPOINT_FILE_BYTES, parseStudioCheckpointFile } from './checkpoint-file';
import { PresetBrowser, type PresetActions } from './preset-browser';
import { SceneDesk } from './scene-desk';
import { BridgeReviewView, type BridgeReviewState } from './bridge-review-view';
import { bridgePoint, bridgeZoneTarget, shouldPauseBridge, type BridgeControls, type BridgePoint } from './bridge-review';
import { PressWorkbench } from './press-workbench';
import { pressPressureAt,pressDriveAt } from './press-inspection';
import { pressDriveFor,pressDriveCommands,readPressDriveEnvelope,type PressDriveId } from './press-program';
import { makePressRun,pressRunPoint,type PressRun } from './press-runs';
import { DEFAULT_PRESS,readPress,writePress,normalizePress,metalFor,type PressSettings } from './press-settings';
import { readRiver, writeRiver, riverProfile, normalizeRiver, type RiverSettings } from './river-settings';
import { finishFor, lightingFor, loadFor, setupFor, surroundingsFor, SURROUNDING_PRESETS, PACKS, camerasFor, type CameraPreset } from './presets';

const icon=(name:string)=>`<i class="ph ph-${name}" aria-hidden="true"></i>`;
const base=import.meta.env.BASE_URL;
const pressReference=new URL('../../docs/design/press-lab-v4-20260911/mockup.png',import.meta.url).href;
const details={
  canopy:{family:'Membrane studies',specimen:'Woven membrane',material:'Ivory · plain weave',mechanism:'Strain → tear propagation',supports:'4 corner anchors',load:'Uniform pressure',icon:'grid-four',label:'Membrane response',dimension:'10.0 × 8.0',program:'Pressure ramp',description:'Distributed pressure and crosswind tension the woven surface. Connections tear when their accumulated strain damage reaches the rupture limit.'},
  plate:{family:'Material studies',specimen:'Metal sheet',material:'Selectable alloy · solid sheet',mechanism:'Yield → dent → perforation',supports:'Pinned perimeter · 4 edges',load:'Pressure limited ram',icon:'square-half',label:'Plate response',dimension:'5.2 × 4.4',program:'Controlled press stroke',description:'A pressure limited ram drives the selected tool into a sheet. Metal, thickness, contact shape and speed affect the response. Plastic extension leaves a permanent dent; excessive strain opens a fracture.'},
  bridge:{family:'Cable studies',specimen:'Suspension footbridge',material:'Steel cable · timber deck',mechanism:'Rupture → support loss → collapse',supports:'2 towers · 4 cable saddles',load:'Asymmetric deck load',icon:'bridge',label:'Cable response',dimension:'42.0 × 3.8',program:'Deck overload',description:'The deck transfers gravity and applied load through hangers to paired main cables. Broken connections stop carrying load and unsupported deck sections fall.'},
};

export async function bootStudio(requested:string):Promise<void> {
  let id:StudyId=requested in STUDIES?requested as StudyId:'canopy';
  const initialQuery=new URLSearchParams(location.search);
  let activeSetup=setupFor(id,initialQuery.get('setup'));
  let finish=finishFor(id,initialQuery.get('finish')??activeSetup?.finish),lighting=lightingFor(initialQuery.get('light')??activeSetup?.lighting??(id==='plate'?'softbox':'daylight')),recipe=loadFor(id,initialQuery.get('recipe')??activeSetup?.load);
  let surroundings=surroundingsFor(id,initialQuery.get('surroundings')??activeSetup?.surroundings);
  let cameraPreset:CameraPreset=camerasFor(id).find(p=>p.id===(initialQuery.get('camera')??activeSetup?.camera))?.id??'hero';
  let referenceWorkspace=initialQuery.get('layout')!=='explore';
  let quality:'ultra'|'balanced'=initialQuery.get('quality')==='balanced'?'balanced':'ultra';
  let riverSettings=readRiver(initialQuery,activeSetup?.water),autoRotate=initialQuery.get('orbit')==='1';
  let sceneDesk:SceneDesk|undefined;
  let bridgeReview:BridgeReviewView|undefined,pauseOnBridgeBreak=initialQuery.get('pauseBreak')==='1';
  let reviewMode:'inspect'|'experiments'=initialQuery.get('analysis')==='inspect'?'inspect':'experiments';
  let bridgePointsCache:{key:string;points:BridgePoint[]}|undefined;
  let pressSettings=readPress(initialQuery,{...DEFAULT_PRESS,pressure:recipe.target*20}),pressWorkbench:PressWorkbench|undefined;
  let pressDrive:PressDriveId=pressDriveFor(initialQuery.get('drive')).id;
  type Look={finish:string;lighting:string;surroundings:string;camera:CameraPreset;river:RiverSettings};
  const lookHistory:Look[]=[];
  function rememberLook():void {lookHistory.push({finish:finish.id,lighting:lighting.id,surroundings:surroundings.id,camera:cameraPreset,river:{...riverSettings}});if(lookHistory.length>24)lookHistory.shift();}
  async function undoLook():Promise<void> {
    const previous=lookHistory.at(-1);if(!previous)return;
    const f=finishFor(id,previous.finish);await world.applyFinish(f);
    finish=f;lighting=lightingFor(previous.lighting);surroundings=surroundingsFor(id,previous.surroundings);cameraPreset=previous.camera;riverSettings={...previous.river};activeSetup=undefined;
    world.setLighting(lighting);world.setSurroundings(surroundings);world.setRiver(riverSettings);world.setCamera(cameraPreset);lookHistory.pop();syncPresentation();updateUrl();
  }
  function setRiver(settings:RiverSettings):void {rememberLook();riverSettings=normalizeRiver(settings);activeSetup=undefined;world.setRiver(riverSettings);syncPresentation();updateUrl();}
  let presetBrowser:PresetBrowser;
  let sim=new FailureSimulation(id,pressSettings,id==='canopy'?STUDIO_CANOPY_CONTACT_BACKEND:STUDIO_SCALED_CHECKPOINT_BACKEND);
  function collisionLabel():string {return sim.backend===STUDIO_CANOPY_CONTACT_BACKEND?'Fabric + supports + floor':id==='plate'?'Punch + bed':'Ground contact';}
  let replaying=false,replayTime=0,runEnd=30;
  let running=false,loading=true,frames=new RecordingRing(sim.snapshot()),playback=-1;
  let liveSnapshot=sim.createSnapshotTarget(),previousSnapshot=sim.createSnapshotTarget(),presentationSnapshot=sim.createSnapshotTarget();
  let client:StudioClient|undefined,clientReady=false,pending=false,generation=0,receivedAt=0,disposed=false,animationId=0;
  let pendingTask:Promise<void>|undefined;
  let exporting=false;
  let importing=false,historyStartTime=0;
  let graphicsRecovering=false,graphicsFailed=false;
  const clock=new FixedFrameClock(FIXED_DT,12),timings=new StageTimings(['step','transport','snapshot','geometry','renderCpu','frame']);
  let speed=recipe.speed,accumulator=0,lastTime=0,lastUi=0,nextSample=.1,runNumber=1;
  let responseMode=false,program=recipe.target<=.8?'service':'failure',target=recipe.target,strength=recipe.strength,wind=recipe.wind;
  let customLoad=initialQuery.get('custom')==='1';
  if(customLoad){
    const bounded=(key:string,fallback:number,min:number,max:number)=>{const raw=initialQuery.get(key),n=raw===null?NaN:Number(raw);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
    target=bounded('target',target,0,5);strength=bounded('strength',strength,.4,2);wind=id==='plate'?0:bounded('wind',wind,0,2);speed=bounded('speed',speed,.25,2);if(![.25,.5,1,2].includes(speed))speed=1;program=target<=.8?'service':'failure';
  }
  if(id==='plate'){target=pressSettings.pressure/20;if(!initialQuery.has('finish')&&!activeSetup)finish=finishFor(id,metalFor(pressSettings.metal).finish);}
  if(activeSetup&&(customLoad||activeSetup.finish!==finish.id||activeSetup.lighting!==lighting.id||activeSetup.load!==recipe.id||activeSetup.camera!==cameraPreset||activeSetup.surroundings!==surroundings.id))activeSetup=undefined;
  if(activeSetup?.water&&(riverProfile(riverSettings)!==activeSetup.water||!riverSettings.animate))activeSetup=undefined;
  let settingsHistory:{time:number;target:number;strength:number;wind:number;program:string;press?:PressSettings;pressDrive?:PressDriveId}[]=[];
  function recordSettings():void {settingsHistory.push({time:sim.time,target,strength,wind,program,...(id==='plate'?{press:{...pressSettings},pressDrive}:{})});}
  recordSettings();
  let reportCache:{key:string;run:PressRun}|undefined;
  function pressReport():PressRun {
    const key=[runNumber,frames.at(-1)!.response.time,frames.length,settingsHistory.length,pressDrive,pressSettings.pressure].join(':');
    if(reportCache?.key===key)return reportCache.run;
    const initial=settingsHistory.find(s=>s.press)?.press?.pressure??frames.at(0)!.press?.settings.pressure??pressSettings.pressure;
    // Use the owned 10 Hz recording samples, so each onset has matching replay geometry.
    const points=frames.map(s=>pressRunPoint(s,pressPressureAt(s.response.time,initial,settingsHistory,pressDrive)));
    const drives=[...new Set(settingsHistory.flatMap(s=>s.pressDrive?[s.pressDrive]:[]).concat(pressDrive))];
    const run=makePressRun({id:`run-${runNumber}`,createdAt:new Date().toISOString(),backend:sim.backend,settings:{...pressSettings,pressure:Math.max(initial,...settingsHistory.flatMap(s=>s.press?[s.press.pressure]:[]))},drives,
      points,complete:frames.at(-1)?.press?.cycle==='Complete',historyComplete:frames.evicted===0&&historyStartTime===0});
    reportCache={key,run};return run;
  }
  function seekPressMilestone(time:number):void {
    if(loading||exporting||importing||graphicsFailed||root.dataset.deskBusy==='true')return;
    const index=frames.map(s=>s.response.time).findIndex(t=>Math.abs(t-time)<FIXED_DT/2);
    if(index<0)return;
    running=false;replaying=false;playback=index;clock.reset();world.update(displayed(),responseMode);updateUi();
  }
  function bridgeReviewState():BridgeReviewState {
    const key=[runNumber,frames.length,frames.at(-1)?.response.time].join(':');
    if(bridgePointsCache?.key!==key)bridgePointsCache={key,points:frames.map(f=>bridgePoint(sim,f))};
    return {model:sim,snapshot:displayed(),points:bridgePointsCache.points,events:sim.events,settings:{target,strength,wind,program,speed},changes:settingsHistory,
      run:runNumber,historyComplete:!frames.evicted&&historyStartTime===0,replay:playback>=0,running:running||replaying,
      ready:!loading&&!exporting&&!importing&&!graphicsFailed&&clientReady&&root.dataset.deskBusy!=='true',pauseOnBreak:pauseOnBridgeBreak};
  }
  function seekBridgeSample(index:number):void {
    if(!bridgeReviewState().ready||!Number.isInteger(index)||index<0||!frames.at(index))return;
    running=false;replaying=false;playback=index;clock.reset();world.update(displayed(),responseMode);updateUi();
  }
  function loadBridgeBaseline(s:BridgeControls):void {
    if(!bridgeReviewState().ready)return;
    target=s.target;strength=s.strength;wind=s.wind;program=s.program;speed=s.speed;customLoad=true;activeSetup=undefined;
    reset();syncControls();updateUrl();
  }
  function changePressDrive(next:PressDriveId):boolean {
    if(id!=='plate'||playback>=0||loading||exporting||importing||graphicsFailed||root.dataset.deskBusy==='true')return false;
    pressDrive=next;markCustomLoad();reset();syncControls();updateUrl();return true;
  }
  async function applyPress(p:PressSettings,steady=false):Promise<void> {
    const next=normalizePress(p);
    if(next.metal!==pressSettings.metal){const f=finishFor('plate',metalFor(next.metal).finish);await world.applyFinish(f);finish=f;}
    pressSettings=next;if(steady)pressDrive='steady';target=next.pressure/20;strength=1;program='failure';customLoad=true;activeSetup=undefined;
    reset();syncControls();updateUrl();
  }
  function changePressPressure(pressure:number):boolean {
    if(id!=='plate'||playback>=0||loading||exporting||importing||graphicsFailed)return false;
    pressDrive='steady';pressSettings=normalizePress({...pressSettings,pressure});target=pressSettings.pressure/20;
    sim.targetLoad=target;markCustomLoad();recordSettings();syncControls();updateUrl();updateUi();
    return true;
  }
  function markCustomLoad():void {customLoad=true;activeSetup=undefined;setText('#recipe-label','Custom load case');syncPresentation();}
  let world:StudioWorld;
  let queuedCapture=false,queuedComparison=false;
  const root=document.getElementById('studio')!;
  document.title='BOX3D — Engineering Studio';
  const themeQuery=new URLSearchParams(location.search).get('theme');
  let theme=themeQuery&&['precision','atelier','observatory'].includes(themeQuery)?themeQuery:STUDIES[id].theme;

  function markup():void {
    bridgeReview?.dispose();sceneDesk=undefined;bridgeReview=undefined;bridgePointsCache=undefined;
    root.classList.toggle('reference-workflow',referenceWorkspace);root.classList.toggle('response-open',referenceWorkspace&&innerWidth>1000);
    const d=details[id];root.dataset.theme=theme;root.dataset.study=id;root.dataset.renderReady='false';
    root.innerHTML=`
      <header class="studio-header">
        <a class="brand" href="?studio=canopy" aria-label="BOX3D Engineering Studio">${icon('cube')}<strong>BOX<span>3D</span></strong><span class="brand-caption">Engineering Studio</span></a>
        <nav class="study-tabs" aria-label="Studies">
          ${(['canopy','plate','bridge'] as StudyId[]).map((s,i)=>`<button data-study="${s}" class="${id===s?'active':''}" aria-current="${id===s?'page':'false'}"><span class="tab-number">0${i+1}</span>${s==='canopy'?'Canopy':s==='plate'?'Plate press':'Suspension bridge'}</button>`).join('')}
        </nav>
        <div class="header-actions"><button class="reference-toggle" data-action="workspace" aria-label="Reference workspace" aria-pressed="${referenceWorkspace}" title="Toggle reference workspace">${icon('layout')}<span>Reference</span></button><button class="preset-launch" data-action="presets" aria-label="Open preset library">${icon('swatches')}<span>Presets</span></button><button class="icon-button" data-action="compare" aria-label="Compare reference" title="Compare reference">${icon('squares-four')}</button><button class="icon-button" data-action="export" aria-label="Export run data" title="Export run data">${icon('export')}</button><button class="primary run-button" data-action="run" disabled>${icon('play')}<span>Run simulation</span></button></div>
      </header>
      <div class="studio-breadcrumb"><div><a href="?workbench=1" class="library-link">${icon('caret-left')}<span>All experiments</span></a><span class="slash">/</span><span>${d.family}</span><span class="slash">/</span><strong>${STUDIES[id].title}</strong></div><span class="model-badge"><b></b>Reduced model<span class="badge-extra"> · PBD</span></span></div>
      <main class="studio-layout">
        <nav class="reference-rail" aria-label="Studio workflow"><button data-action="presets" aria-label="Browse experiments">${icon('flask')}<span>Labs</span></button><button data-reference-tab="environment" aria-label="Edit the scene">${icon('sliders-horizontal')}<span>Scene</span></button><button data-reference-tab="test" aria-label="Edit the load">${icon('waveform')}<span>Test</span></button><button data-action="compare" aria-label="Compare with the image">${icon('squares-four')}<span>Compare</span></button></nav>
        <aside class="reference-outline" aria-label="Specimen inspection"><div><strong>${id==='bridge'?'Suspension cable study':id==='canopy'?'Canopy load study':'Plate forming study'}</strong><span>STUDY 0${['canopy','plate','bridge'].indexOf(id)+1}</span></div><button data-reference-camera="${id==='bridge'?'river-hero':'reference'}">${icon('frame-corners')}<span>${id==='bridge'?'River crossing':'Reference view'}</span>${icon('caret-right')}</button>${id==='bridge'?`<button data-reference-camera="approach">${icon('path')}<span>Road & open portals</span>${icon('caret-right')}</button><button data-reference-camera="bearing">${icon('nut')}<span>Abutment & steelwork</span>${icon('caret-right')}</button>`:''}<button data-reference-camera="connection">${icon('link')}<span>${id==='bridge'?'Cable connections':'Support connections'}</span>${icon('caret-right')}</button><button data-reference-tab="test">${icon('arrow-down')}<span>Load & failure</span>${icon('caret-right')}</button></aside>
        <aside class="study-outline" aria-label="Study setup">
          <div class="outline-heading"><span>STUDY 0${(['canopy','plate','bridge'] as string[]).indexOf(id)+1}</span><button class="icon-button" data-action="fit" aria-label="Fit study">${icon('crosshair')}</button></div>
          <div class="outline-title">${STUDIES[id].title}</div><p class="outline-subtitle">${id==='plate'?'24 metals · 36 attachment setups · controlled forming':STUDIES[id].subtitle}</p>
          <button class="setup-shortcut" data-action="presets">${icon('cube')}<span id="setup-label">${activeSetup?.name??'Choose a scene setup'}</span>${icon('caret-right')}</button><section class="tree-section"><h2>SPECIMEN</h2><div class="tree-row selected">${icon(d.icon)}<span>${d.specimen}</span><span class="tree-dot"></span></div><div class="tree-detail">${d.dimension}<span>model units</span></div></section>
          <section class="tree-section"><h2>SUPPORTS</h2>${(id==='canopy'?['Corner A','Corner B','Corner C','Corner D']:id==='plate'?['Left edge','Right edge','Front edge','Back edge']:['West tower','East tower','Cable anchors','Deck hangers']).map(x=>`<div class="tree-row">${icon('anchor-simple')}<span>${x}</span><span class="tree-status">${x==='Deck hangers'?'Linked':'Fixed'}</span></div>`).join('')}</section>
          <section class="tree-section"><h2>LOAD CASE</h2><div class="tree-row accented">${icon('arrow-down')}<span>${d.load}</span></div>${id!=='plate'?`<div class="tree-row">${icon('wind')}<span>Crosswind</span><span class="tree-status" id="wind-summary">0.25</span></div>`:''}</section>
          <section class="tree-section response-tree"><h2>RESPONSE</h2><div class="tree-row">${icon('waveform')}<span>${d.label}</span><span class="tree-dot cyan"></span></div><div class="tree-row">${icon('git-branch')}<span>Broken connections</span><span class="mono" id="tree-broken">0</span></div></section>
          <div class="outline-bottom"><label for="theme">Workspace</label><select id="theme" aria-label="Workspace treatment"><option value="precision" ${theme==='precision'?'selected':''}>Precision Studio</option><option value="atelier" ${theme==='atelier'?'selected':''}>Research Atelier</option><option value="observatory" ${theme==='observatory'?'selected':''}>Field Observatory</option></select><a href="?workbench=1">${icon('flask')} Open full workbench ${icon('arrow-up-right')}</a></div>
        </aside>
        <section class="viewport-wrap" aria-label="Simulation viewport">
          <div id="scene-host"></div>
          <div class="viewport-top"><div class="view-segment" role="group" aria-label="Surface display"><button data-action="material" class="active" aria-pressed="true">Material</button><button data-action="response" aria-pressed="false">Response</button></div><div class="viewport-tools"><button data-action="focus" class="round-button" aria-label="Focus on scene" title="Focus on scene">${icon('frame-corners')}</button><button data-action="second" class="round-button" aria-label="Second camera angle" title="Second angle">${icon('arrows-clockwise')}</button><button data-action="fit" class="round-button" aria-label="Fit camera" title="Fit camera">${icon('crosshair')}</button><button data-action="fullscreen" class="round-button" aria-label="Expand viewport" title="Expand viewport">${icon('corners-out')}</button></div></div>
          <div class="look-strip"><button data-action="finishes">${icon('swatches')}<span id="finish-label">${finish.name}</span></button><span>·</span><button data-action="lighting">${icon('sun')}<span id="lighting-label">${lighting.name}</span></button></div>
          <div class="viewport-caption"><span class="micro-label">${id==='bridge'?'FIELD OBSERVATORY':id==='plate'?'MATERIAL FORGE / PRESS LAB':'PRECISION STUDIO'}</span><h1>${id==='canopy'?'The shape of tension.':id==='plate'?'Beyond the elastic limit.':'Every connection matters.'}</h1><span>Explore the load. Understand the failure.</span></div>
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
          <dl class="material-properties"><div><dt>Failure mode</dt><dd>${id==='canopy'?'Tensile tearing':id==='plate'?'Ductile fracture':'Connection rupture'}</dd></div><div><dt>Integration</dt><dd>120 Hz · 12 iterations</dd></div><div><dt>Collision</dt><dd id="collision-label">${collisionLabel()}</dd></div></dl>
          <div class="mobile-workspace"><label class="field-label" for="theme-mobile">Workspace treatment</label><select id="theme-mobile"><option value="precision" ${theme==='precision'?'selected':''}>Precision Studio</option><option value="atelier" ${theme==='atelier'?'selected':''}>Research Atelier</option><option value="observatory" ${theme==='observatory'?'selected':''}>Field Observatory</option></select></div><details class="model-details"><summary>How this study works ${icon('info')}</summary><p>${d.description}</p><p>Dimensions, stiffness and failure thresholds are authored model values. Results are comparative and not calibrated to a physical specimen.</p></details>
          <div class="presentation-controls"><h3>Presentation</h3><div><label for="surroundings">Surroundings</label><select id="surroundings">${SURROUNDING_PRESETS.filter(p=>p.habitat===(id==='bridge'?'valley':'hall')).map(p=>`<option value="${p.id}" ${surroundings.id===p.id?'selected':''}>${p.name}</option>`).join('')}</select></div><div><label for="camera-preset">Camera</label><select id="camera-preset">${camerasFor(id).map(p=>`<option value="${p.id}" ${cameraPreset===p.id?'selected':''}>${p.name}</option>`).join('')}</select></div><div><label for="render-quality">Quality</label><select id="render-quality"><option value="ultra" ${quality==='ultra'?'selected':''}>Ultra · full resolution</option><option value="balanced" ${quality==='balanced'?'selected':''}>Balanced</option></select></div></div>
          </div><div class="result-stats"><div><span>Deflection</span><strong id="stat-deflection">0.000</strong><small>model units</small></div><div><span>Connections lost</span><strong id="stat-broken">0</strong><small id="stat-total">of ${sim.links.length}</small></div></div>
          <button data-action="unload" class="secondary full-width">${icon('arrow-up')} Release load</button><button data-action="run" class="primary full-width inspector-run" disabled>${icon('play')}<span>Run simulation</span></button>
        </aside>
        <section class="timeline-bar" aria-label="Simulation playback"><button class="play-control" data-action="run" aria-label="Run or pause simulation" disabled>${icon('play')}</button><button class="icon-button" data-action="reset" disabled aria-label="Reset simulation" title="Reset simulation">${icon('arrow-counter-clockwise')}</button><span class="mono" id="clock">0.00 s</span><div class="timeline-track"><input type="range" id="scrub" aria-label="Replay recorded history" min="0" max="0" step="1" value="0"><div class="timeline-labels"><span>0 s</span><span id="history-state">LIVE HISTORY</span><span id="recorded-duration">0.0 s recorded</span></div></div><button class="live-button" data-action="live" title="Return to the latest simulation state">Live</button><select id="speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1.0×</option><option value="2">2.0×</option></select><button class="icon-button" data-action="capture" aria-label="Capture viewport" title="Capture viewport">${icon('camera')}</button></section>
        <section class="response-panel" aria-label="Response history"><div class="chart-area"><div class="chart-heading"><h2>Response history</h2><div class="chart-legend"><span><b class="teal"></b>Deflection</span><span><b class="orange"></b>Applied load</span></div><span class="chart-units">model units / normalized load</span></div><canvas id="response-chart" aria-label="Recorded deflection and applied load over model time" role="img"></canvas></div><div class="event-area"><div class="chart-heading"><h2>Failure events</h2><span class="event-count" id="event-count">0</span></div><ol id="event-list"><li class="empty-events">Run a study to trace how failure develops.<span>Every event comes from the solver.</span></li></ol></div></section>
      </main>
      <footer class="studio-footer"><span><b class="footer-dot"></b><span id="engine-label">Initializing renderer</span><span class="footer-extra" id="render-metrics"> · Local session</span></span><span>Comparative model · not calibrated</span><button data-action="export">Export evidence ${icon('arrow-up-right')}</button></footer>
      <div class="toast" role="status" hidden></div>
      <dialog class="comparison-dialog"><div class="dialog-heading"><div><strong>Design reference</strong><span>Selected visual direction · generated concept</span></div><button data-action="close-compare" class="icon-button" aria-label="Close reference">${icon('x')}</button></div><div class="reference-picker">${id==='bridge'?`<label for="reference-image">Visual target</label><select id="reference-image"><option value="experiments">Experiment scans · new concept</option><option value="review">Failure inspection · previous concept</option><option value="corrected-hero">Corrected crossing · critic revision</option><option value="corrected-approach">Open portals · critic revision</option><option value="hero">Earlier crossing concept</option><option value="detail">Abutment & steelwork · new concept</option><option value="original">Original studio concept</option></select><button data-action="align-reference">Match camera</button>`:''}</div><div class="reference-comparison-grid"><figure><figcaption id="reference-caption">${id==='bridge'?'Experiment scans · generated visual target':id==='plate'?'Press lab V4 · generated visual target':'Original image · visual direction'}</figcaption><img id="reference-target" src="${id==='plate'?pressReference:`${base}studio/references/${id==='bridge'?'bridge-v5-experiments':id}.png`}" alt="Selected ${STUDIES[id].theme} generated interface and scene reference"></figure><figure><figcaption id="comparison-live-caption">Current geometry · preparing capture</figcaption><img id="comparison-live" alt="Current live simulation geometry from the selected camera"></figure></div><p>The live scene is rebuilt as geometry. This image is a visual reference; its example values are not simulation results.</p></dialog>`;
    bind();
    const presetActions:PresetActions={
      state:()=>({study:id,finish:finish.id,lighting:lighting.id,load:customLoad?'':recipe.id,camera:cameraPreset,surroundings:surroundings.id,setup:activeSetup?.id}),
      finish:async p=>{await world.applyFinish(p);rememberLook();finish=p;activeSetup=undefined;syncPresentation();updateUrl();},
      lighting:p=>{rememberLook();world.setLighting(p);lighting=p;activeSetup=undefined;syncPresentation();updateUrl();},
      load:p=>{recipe=p;customLoad=false;activeSetup=undefined;target=p.target;strength=p.strength;wind=p.wind;speed=p.speed;program=target<=.8?'service':'failure';if(id==='plate'){pressDrive='steady';pressSettings=normalizePress({...pressSettings,pressure:target*20});}reset();syncControls();updateUrl();},
      camera:p=>{rememberLook();cameraPreset=p;world.setCamera(p);activeSetup=undefined;syncPresentation();updateUrl();},
      surroundings:p=>{rememberLook();surroundings=p;world.setSurroundings(p);activeSetup=undefined;syncPresentation();updateUrl();},
      setup:async p=>{
        const f=finishFor(id,p.finish),l=lightingFor(p.lighting),r=loadFor(id,p.load),e=surroundingsFor(id,p.surroundings);
        // Load the only asynchronous dependency first. A missing map leaves the previous run intact.
        await world.applyFinish(f);
        lookHistory.length=0;
        finish=f;lighting=l;recipe=r;surroundings=e;cameraPreset=p.camera;activeSetup=p;customLoad=false;
        if(p.water){riverSettings=readRiver(new URLSearchParams(),p.water);world.setRiver(riverSettings);}
        target=r.target;strength=r.strength;wind=r.wind;speed=r.speed;program=target<=.8?'service':'failure';
        if(id==='plate'){pressDrive='steady';pressSettings=normalizePress({...pressSettings,pressure:target*20});}world.setLighting(l);world.setSurroundings(e);world.setCamera(cameraPreset);reset();syncControls();updateUrl();
      },
    };
    presetBrowser=new PresetBrowser(root,presetActions);
    sceneDesk=new SceneDesk(root,presetActions,{water:()=>riverSettings,setWater:setRiver,undo:undoLook,canUndo:()=>lookHistory.length>0,rotate:()=>autoRotate,setRotate:on=>{autoRotate=on;world.setAutoRotate(on);updateUrl();},resized:()=>world?.resize(),browse:kind=>presetBrowser.open(kind),panelChanged:()=>updateUrl()});
    bridgeReview=id==='bridge'?new BridgeReviewView(root.querySelector('#desk-page-review')!,{state:bridgeReviewState,seek:seekBridgeSample,load:loadBridgeBaseline,download,notify:toast,initialMode:reviewMode,
      modeChanged:mode=>{reviewMode=mode;root.dataset.reviewMode=mode;updateUrl();requestAnimationFrame(()=>world?.resize());},
      pauseOnBreak:on=>{pauseOnBridgeBreak=on;updateUrl();},focus:zone=>{
        if(!bridgeReviewState().ready)return;
        autoRotate=false;world.setAutoRotate(false);cameraPreset=zone===null?'river-hero':'detail';
        if(zone===null)world.setCamera(cameraPreset);else world.focusBridgePoint(bridgeZoneTarget(sim,displayed(),zone));
        if(zone!==null&&innerWidth<=800){sceneDesk?.toggle(false);requestAnimationFrame(()=>world.focusBridgePoint(bridgeZoneTarget(sim,displayed(),zone)));}
        activeSetup=undefined;syncPresentation();updateUrl();
      }}):undefined;
    root.querySelectorAll<HTMLButtonElement>('[data-reference-tab]').forEach(b=>b.onclick=()=>{sceneDesk!.toggle(true);sceneDesk!.open(b.dataset.referenceTab as 'test'|'environment');});
    root.querySelectorAll<HTMLButtonElement>('[data-reference-camera]').forEach(b=>b.onclick=()=>{if(!loading){presetActions.camera(b.dataset.referenceCamera as CameraPreset);}});
    pressWorkbench=id==='plate'?new PressWorkbench(root,pressSettings,applyPress,()=>sceneDesk?.refresh(),changePressPressure,(axis,offset,visible)=>world?.setPressSection(axis,offset,visible),{drive:pressDrive,chooseDrive:changePressDrive,report:pressReport,seek:seekPressMilestone}):undefined;
    if(id==='bridge'){
      const panel=initialQuery.get('panel');sceneDesk.open(panel&&['setup','surface','environment','test'].includes(panel)?panel as 'setup'|'surface'|'environment'|'test':'review');
    }else if(referenceWorkspace)sceneDesk.open('test');
    if(id==='plate')root.classList.remove('response-open');
    syncControls();
  }

  function toast(message:string):void {const t=root.querySelector<HTMLElement>('.toast')!;t.textContent=message;t.hidden=false;setTimeout(()=>{t.hidden=true;},3600);}
  function displayed():Snapshot {return playback>=0?frames.at(playback)!:liveSnapshot;}
  function updateUrl():void {const q=new URLSearchParams({studio:id,theme,finish:finish.id,light:lighting.id,recipe:recipe.id,camera:cameraPreset,quality,surroundings:surroundings.id});q.set('layout',referenceWorkspace?'reference':'explore');if(id==='bridge'){writeRiver(q,riverSettings);q.set('analysis',reviewMode);q.set('panel',root.dataset.deskPanel==='review'?'analyze':root.dataset.deskPanel??'test');if(pauseOnBridgeBreak)q.set('pauseBreak','1');}if(id==='plate'){writePress(q,pressSettings);q.set('drive',pressDrive);}if(autoRotate)q.set('orbit','1');if(activeSetup)q.set('setup',activeSetup.id);if(customLoad){q.set('custom','1');for(const [key,value] of Object.entries({target,strength,wind,speed}))q.set(key,String(value));}history.replaceState(null,'',`${location.pathname}?${q}`);}
  function setText(selector:string,text:string):void {const e=root.querySelector(selector);if(e)e.textContent=text;}
  function syncPresentation():void {
    setText('#setup-label',activeSetup?.name??'Choose a scene setup');
    const environment=root.querySelector<HTMLSelectElement>('#surroundings');if(environment)environment.value=surroundings.id;
    root.dataset.setup=activeSetup?.id??'custom';root.dataset.surroundings=surroundings.id;root.dataset.recipe=customLoad?'custom':recipe.id;
    setText('#finish-label',finish.name);setText('#lighting-label',lighting.name);setText('#finish-description',finish.name);
    const swatch=root.querySelector<HTMLElement>('#finish-swatch');if(swatch){swatch.style.backgroundImage=`url('${base}studio/materials/${PACKS[finish.pack].base}')`;swatch.style.backgroundColor=finish.color;}
    const camera=root.querySelector<HTMLSelectElement>('#camera-preset');if(camera)camera.value=cameraPreset;
    root.dataset.finish=finish.id;root.dataset.lighting=lighting.id;root.dataset.camera=cameraPreset;root.dataset.quality=quality;
    root.dataset.riverFlow=String(riverSettings.flow);root.dataset.riverWave=String(riverSettings.wave);root.dataset.riverFoam=String(riverSettings.foam);root.dataset.riverAnimate=String(riverSettings.animate);sceneDesk?.refresh();
  }
  function syncControls():void {
    for(const [selector,value] of [['#load',target],['#strength',strength],['#wind',wind],['#speed',speed],['#program',program]] as const){const input=root.querySelector<HTMLInputElement>(selector);if(input)input.value=String(value);}
    pressWorkbench?.sync(pressSettings);pressWorkbench?.syncDrive(pressDrive);setText('#target-output',target.toFixed(2));setText('#strength-output',strength.toFixed(2)+'×');setText('#wind-output',wind.toFixed(2));setText('#wind-summary',wind.toFixed(2));setText('#recipe-label',customLoad?'Custom load case':recipe.name);syncPresentation();
  }
  function reset():void {
    if(loading||importing||graphicsFailed)return;
    delete root.dataset.bridgeAutoPause;
    historyStartTime=0;running=false;replaying=false;runEnd=id==='plate'?Math.max(30,(70+pressSettings.stroke)/pressSettings.strikeSpeed+pressSettings.hold+12):30;settingsHistory=[];sim=new FailureSimulation(id,pressSettings,id==='canopy'?STUDIO_CANOPY_CONTACT_BACKEND:STUDIO_SCALED_CHECKPOINT_BACKEND);sim.targetLoad=0;sim.strength=strength;sim.wind=wind;
    frames=new RecordingRing(sim.snapshot());liveSnapshot=sim.createSnapshotTarget();previousSnapshot=sim.createSnapshotTarget();presentationSnapshot=sim.createSnapshotTarget();playback=-1;nextSample=.1;accumulator=0;runNumber++;
    recordSettings();reportCache=undefined;
    world.resetModel(sim);restartRuntime();setText('#run-number',String(runNumber));updateUi();
  }
  function toggleRun():void {
    if(loading||exporting||importing||graphicsFailed||root.dataset.deskBusy==='true')return;
    if(id==='plate'&&sim.pressCycle==='Complete'&&playback<0)reset();
    if(playback>=0) {replaying=!replaying;running=false;replayTime=frames.at(playback)!.response.time;updateUi();return;}
    running=!running;if(running){sim.targetLoad=target;recordSettings();if(sim.time>=runEnd)runEnd=sim.time+10;}
    accumulator=0;clock.reset();if(!running&&playback<0)world.update(liveSnapshot,responseMode);updateUi();
  }
  async function switchStudy(next:StudyId):Promise<void> {
    if(next===id||loading||importing||root.dataset.deskBusy==='true')return;
    historyStartTime=0;
    customLoad=false;activeSetup=undefined;lookHistory.length=0;root.classList.remove('scene-focus','inspector-open','response-open');
    running=false;replaying=false;loading=true;runEnd=30;settingsHistory=[];id=next;theme=STUDIES[id].theme;finish=finishFor(id);lighting=lightingFor(id==='plate'?'softbox':'daylight');recipe=loadFor(id);surroundings=surroundingsFor(id);cameraPreset='hero';sim=new FailureSimulation(id,pressSettings,id==='canopy'?STUDIO_CANOPY_CONTACT_BACKEND:STUDIO_SCALED_CHECKPOINT_BACKEND);sim.targetLoad=0;
    frames=new RecordingRing(sim.snapshot());liveSnapshot=sim.createSnapshotTarget();previousSnapshot=sim.createSnapshotTarget();presentationSnapshot=sim.createSnapshotTarget();playback=-1;target=recipe.target;strength=recipe.strength;wind=recipe.wind;program='failure';speed=recipe.speed;responseMode=false;nextSample=.1;accumulator=0;
    if(id==='plate'){target=pressSettings.pressure/20;strength=1;runEnd=Math.max(30,(70+pressSettings.stroke)/pressSettings.strikeSpeed+pressSettings.hold+12);}
    recordSettings();reportCache=undefined;
    // Preserve the one initialized GPU renderer across navigation.
    const canvas=world.renderer.domElement;markup();root.querySelector('#scene-host')!.append(canvas);
    world.attach(root.querySelector<HTMLElement>('#scene-host')!);sim.strength=strength;sim.wind=wind;restartRuntime();await world.changeStudy(sim);world.setLighting(lighting);world.setSurroundings(surroundings);world.setRiver(riverSettings);world.setAutoRotate(autoRotate);world.setQuality(quality);world.resize();updateUrl();ready();
  }
  function download(filename:string,blob:Blob):void {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function exportRun():Promise<void> {
    if(exporting||importing)return;exporting=true;
    const exportGeneration=generation,wasRunning=running;running=false;
    try{await pendingTask;const checkpoint=await client?.exportCheckpoint();if(exportGeneration!==generation||disposed)return;
    const payload={checkpoint,schema:'box3d.failure-studio.v2',study:id,createdAt:new Date().toISOString(),model:'Reduced position-based dynamics; authored normalized coefficients; not calibrated',
      source:'src/studio/physics.ts',settings:{target,strength,wind,program,fixedStep:FIXED_DT,...(id==='plate'?{press:pressSettings,pressureProgram:{schema:'press-drive-v1',id:pressDrive,limit:pressSettings.pressure}}:{})},camera:world.cameraState(),presentation:world.presentationState(),preset:{setup:activeSetup?.id??null,load:recipe.id,modified:customLoad,playbackSpeed:speed,appearanceAffectsPhysics:false},
      topology:{nodes:sim.nodes.map(n=>({rest:n.rest,fixed:n.inverseMass===0})),links:sim.links.map(e=>({a:e.a,b:e.b,kind:e.kind,rest:e.original,threshold:e.threshold}))},
      settingsHistory,events:sim.events,samples:frames.map(f=>({...f.response,...(f.press?{press:f.press,punchY:f.punchY}:{})})),finalPositions:Array.from(liveSnapshot.positions),brokenLinks:Array.from(liveSnapshot.broken).flatMap((broken,i)=>broken?[i]:[]),capabilities:client?.capabilities,transport:{mode:client?.mode,fallbackReason:client?.fallbackReason??null},timings:timings.inspect(),clock:{lagSeconds:clock.lagSeconds,overloads:clock.overloads},recording:{capacity:frames.capacity,evicted:frames.evicted,startTime:historyStartTime,completeGeometryHistory:frames.evicted===0&&historyStartTime===0}};
    download(`box3d-${id}-R${runNumber}.json`,new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));toast('Run data and failure topology exported.');
    }finally{exporting=false;if(exportGeneration===generation&&!disposed)running=wasRunning;}
  }

  async function importRun(file:File):Promise<void> {
    if(importing||exporting||loading)return;
    if(file.size>MAX_CHECKPOINT_FILE_BYTES)throw new RangeError('Saved run exceeds the 16 MiB import limit.');
    const fileText=await file.text(),candidate=parseStudioCheckpointFile(fileText);
    const envelope=JSON.parse(fileText) as {settings?:{pressureProgram?:unknown}},savedProgram=envelope.settings?.pressureProgram;
    const driveEnvelope=readPressDriveEnvelope(savedProgram);
    if(savedProgram!==undefined&&!driveEnvelope)throw new RangeError('Saved pressure program is invalid or unsupported.');
    if(importing||exporting||loading||disposed)return;
    importing=true;loading=true;root.inert=true;
    const wasRunning=running;running=false;replaying=false;clock.reset();
    let replacement:StudioClient|undefined,previousClient:StudioClient|undefined,committed=false;
    try{
      await pendingTask;
      replacement=await createStudioClient({study:candidate.id,initialCheckpoint:candidate.exportCheckpoint()},{mode:initialQuery.get('simulation')==='sync'?'sync':'auto'});
      if(disposed)return;
      await world.changeStudy(candidate);
      if(disposed)return;
      previousClient=client;generation++;pending=false;client=replacement;replacement=undefined;clientReady=true;committed=true;
      id=candidate.id;sim=candidate;pressDrive=driveEnvelope?.id??'steady';pressSettings=normalizePress({...candidate.press,pressure:driveEnvelope?.limit??candidate.targetLoad*20});theme=STUDIES[id].theme;
      target=id==='plate'?pressSettings.pressure/20:sim.targetLoad;strength=sim.strength;wind=sim.wind;customLoad=true;activeSetup=undefined;lookHistory.length=0;settingsHistory=[];
      recipe=loadFor(id);finish=finishFor(id);lighting=lightingFor(id==='plate'?'softbox':'daylight');surroundings=surroundingsFor(id);cameraPreset='hero';program=target<=.8?'service':'failure';
      liveSnapshot=sim.createSnapshotTarget();previousSnapshot=sim.createSnapshotTarget();presentationSnapshot=sim.createSnapshotTarget();
      frames=new RecordingRing(sim.snapshot());historyStartTime=sim.time;playback=-1;runEnd=Math.max(30,sim.time+30);runNumber++;
      recordSettings();reportCache=undefined;
      clock.reset(true);timings.reset();receivedAt=0;delete root.dataset.simulationError;
      const canvas=world.renderer.domElement;markup();root.querySelector('#scene-host')!.append(canvas);world.attach(root.querySelector<HTMLElement>('#scene-host')!);
      world.setLighting(lighting);world.setSurroundings(surroundings);world.setRiver(riverSettings);world.setAutoRotate(autoRotate);world.setQuality(quality);world.setCamera(cameraPreset);world.update(liveSnapshot,responseMode);
      setText('.timeline-labels>span:first-child',historyStartTime.toFixed(1)+' s');
      updateUrl();ready();
      toast(`Saved run restored at ${sim.time.toFixed(2)} s. Run to continue; new history begins here.`);
    }catch(error){
      if(!committed&&!disposed){
        await world.changeStudy(sim);await world.applyFinish(finish);world.setLighting(lighting);world.setSurroundings(surroundings);world.update(liveSnapshot,responseMode);
        running=wasRunning;
      }
      throw error;
    }finally{await replacement?.destroy();await previousClient?.destroy();importing=false;loading=false;root.inert=false;if(!disposed)updateUi();}
  }

  function alignReference():void {
    if(id!=='bridge'||loading)return;
    const value=root.querySelector<HTMLSelectElement>('#reference-image')?.value;
    rememberLook();cameraPreset=value==='corrected-approach'?'approach':value==='detail'?'bearing':value==='original'?'reference':'river-hero';world.setCamera(cameraPreset);activeSetup=undefined;syncPresentation();updateUrl();queuedComparison=true;
  }
  function bind():void {
    const resumeButton=document.createElement('button');resumeButton.className='icon-button resume-run';resumeButton.type='button';resumeButton.title='Resume saved run';resumeButton.setAttribute('aria-label','Resume saved run');resumeButton.innerHTML=icon('folder-open');
    const checkpointInput=document.createElement('input');checkpointInput.type='file';checkpointInput.accept='.json,application/json';checkpointInput.hidden=true;checkpointInput.setAttribute('aria-label','Saved run checkpoint');
    resumeButton.onclick=()=>{if(!loading&&!exporting&&!importing)checkpointInput.click();};
    checkpointInput.onchange=()=>{const file=checkpointInput.files?.[0];checkpointInput.value='';if(file)void importRun(file).catch(error=>toast(`Import failed: ${error instanceof Error?error.message:String(error)}`));};
    root.querySelector('.header-actions')!.append(resumeButton,checkpointInput);
    const referencePicker=root.querySelector<HTMLSelectElement>('#reference-image');
    if(referencePicker)referencePicker.onchange=()=>{
      const value=referencePicker.value,img=root.querySelector<HTMLImageElement>('#reference-target')!;
      img.src=`${base}studio/references/${value==='experiments'?'bridge-v5-experiments':value==='review'?'bridge-v4-review':value==='original'?'bridge':value.startsWith('corrected-')?`bridge-v3-${value.replace('corrected-','')}`:`bridge-v2-${value}`}.png`;
      img.alt=value==='experiments'?'Generated bridge experiment scans with response comparisons':value==='review'?'Generated bridge Analyze workflow with failure map and saved baseline':value==='corrected-approach'?'Corrected approach with continuous rails and open tower portals':value==='corrected-hero'?'Corrected woodland crossing with open portals and explicit anchorages':value==='detail'?'Generated close view of the bridge abutment and steelwork':value==='hero'?'Generated woodland river crossing reference':'Original bridge studio concept';
      setText('#reference-caption',value==='experiments'?'Experiment scans · generated visual target':value==='review'?'Analyze workflow · generated visual target':value==='corrected-approach'?'Open portals · corrected visual target':value==='corrected-hero'?'Corrected crossing · generated visual target':value==='detail'?'Abutment & steelwork · generated visual target':value==='hero'?'River crossing · generated visual target':'Original image · visual direction');
    };

    root.querySelectorAll<HTMLButtonElement>('[data-study]').forEach(b=>b.onclick=()=>{void switchStudy(b.dataset.study as StudyId);});
    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>{
      if(loading||graphicsFailed)return;
      const a=b.dataset.action;
      if(a==='run')toggleRun();
      if(a==='reset')reset();
      if(a==='live'){running=false;replaying=false;playback=-1;world.update(liveSnapshot,responseMode);updateUi();}
      if(a==='fit'||a==='second'){if(loading)return;rememberLook();cameraPreset=a==='second'?'reverse':'hero';world?.setCamera(cameraPreset);activeSetup=undefined;syncPresentation();updateUrl();}
      if(a==='focus'){root.classList.toggle('scene-focus');b.setAttribute('aria-label',root.classList.contains('scene-focus')?'Return to studio':'Focus on scene');requestAnimationFrame(()=>world.resize());}
      if(!loading&&a==='presets')presetBrowser.open();
      if(!loading&&a==='finishes')presetBrowser.open('finishes');
      if(!loading&&a==='lighting')presetBrowser.open('lighting');
      if(!loading&&a==='loads')presetBrowser.open('loads');
      if(a==='material'||a==='response') {responseMode=a==='response';world.update(displayed(),responseMode);root.querySelectorAll('.view-segment button').forEach(x=>{x.classList.toggle('active',(x as HTMLElement).dataset.action===a);x.setAttribute('aria-pressed',String((x as HTMLElement).dataset.action===a));});root.querySelector<HTMLElement>('.strain-legend')!.hidden=!responseMode;}
      if(a==='unload') {markCustomLoad();playback=-1;replaying=false;sim.targetLoad=0;target=0;if(id==='plate'){pressDrive='steady';pressSettings={...pressSettings,pressure:0};pressWorkbench?.sync(pressSettings);pressWorkbench?.syncDrive(pressDrive);}recordSettings();running=true;runEnd=sim.time+Math.max(10,sim.load/.55+2);root.querySelector<HTMLInputElement>('#load')!.value='0';setText('#target-output','0.00');toast('Load released. Permanent damage remains until reset.');updateUrl();updateUi();}
      if(a==='inspector')root.classList.toggle('inspector-open');
      if(a==='export'&&!loading)void exportRun().catch(e=>toast(`Export failed: ${e instanceof Error?e.message:String(e)}`));
      if(a==='capture')queuedCapture=true;
      if(a==='align-reference'){alignReference();}
      if(a==='compare'){queuedComparison=true;root.querySelector<HTMLDialogElement>('.comparison-dialog')!.showModal();}
      if(a==='workspace'){referenceWorkspace=!referenceWorkspace;root.classList.toggle('reference-workflow',referenceWorkspace);root.classList.toggle('response-open',referenceWorkspace&&innerWidth>1000);b.setAttribute('aria-pressed',String(referenceWorkspace));if(referenceWorkspace)sceneDesk?.open('test');updateUrl();requestAnimationFrame(()=>{world.resize();drawChart(displayed().response.time);});}
      if(a==='close-compare')root.querySelector<HTMLDialogElement>('.comparison-dialog')!.close();
      if(a==='fullscreen') {if(document.fullscreenElement)void document.exitFullscreen();else void root.querySelector<HTMLElement>('.viewport-wrap')!.requestFullscreen().catch(()=>toast('Fullscreen is unavailable in this browser.'));}
    });
    root.querySelectorAll<HTMLSelectElement>('#theme,#theme-mobile').forEach(select=>select.onchange=()=>{theme=select.value;root.dataset.theme=theme;root.querySelectorAll<HTMLSelectElement>('#theme,#theme-mobile').forEach(s=>s.value=theme);updateUrl();requestAnimationFrame(()=>world.resize());});
    root.querySelector<HTMLSelectElement>('#program')!.onchange=e=>{markCustomLoad();program=(e.target as HTMLSelectElement).value;target=program==='service'?.8:4;root.querySelector<HTMLInputElement>('#load')!.value=String(target);setText('#target-output',target.toFixed(2));if(running)sim.targetLoad=target;recordSettings();updateUrl();};
    root.querySelector<HTMLInputElement>('#load')!.oninput=e=>{markCustomLoad();target=Number((e.target as HTMLInputElement).value);setText('#target-output',target.toFixed(2));if(running)sim.targetLoad=target;recordSettings();updateUrl();};
    root.querySelector<HTMLInputElement>('#strength')!.oninput=e=>{markCustomLoad();strength=Number((e.target as HTMLInputElement).value);sim.strength=strength;setText('#strength-output',strength.toFixed(2)+'×');recordSettings();updateUrl();};
    const w=root.querySelector<HTMLInputElement>('#wind');if(w)w.oninput=()=>{markCustomLoad();wind=Number(w.value);sim.wind=wind;setText('#wind-output',wind.toFixed(2));setText('#wind-summary',wind.toFixed(2));recordSettings();updateUrl();};
    root.querySelector<HTMLSelectElement>('#camera-preset')!.onchange=e=>{rememberLook();cameraPreset=(e.target as HTMLSelectElement).value as CameraPreset;world.setCamera(cameraPreset);activeSetup=undefined;syncPresentation();updateUrl();};
    root.querySelector<HTMLSelectElement>('#surroundings')!.onchange=e=>{rememberLook();surroundings=surroundingsFor(id,(e.target as HTMLSelectElement).value);world.setSurroundings(surroundings);activeSetup=undefined;syncPresentation();updateUrl();};
    root.querySelector<HTMLSelectElement>('#render-quality')!.onchange=e=>{quality=(e.target as HTMLSelectElement).value as 'ultra'|'balanced';world.setQuality(quality);syncPresentation();updateUrl();};
    root.querySelector<HTMLSelectElement>('#speed')!.onchange=e=>{speed=Number((e.target as HTMLSelectElement).value);markCustomLoad();updateUrl();};
    root.querySelector<HTMLInputElement>('#scrub')!.oninput=e=>{running=false;replaying=false;playback=Number((e.target as HTMLInputElement).value);world.update(displayed(),responseMode);updateUi();};
  }

  function ready():void {
    loading=false;root.inert=false;root.dataset.renderReady='true';root.querySelector('.scene-loading')?.remove();
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>b.disabled=false);
    const backend=(world.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL 2';
    setText('#engine-label',backend+' renderer'+(client?.mode==='worker'?' · worker':''));sceneDesk?.refresh();pressWorkbench?.disable(false);updateUi();
  }
  function updateUi():void {
    const visible=displayed(),r=visible.response;pressWorkbench?.telemetry(visible,sim,playback>=0,visible.press?pressPressureAt(r.time,visible.press.settings.pressure,settingsHistory,pressDrive):undefined,playback>=0?pressDriveAt(r.time,settingsHistory,pressDrive):pressDrive);
    bridgeReview?.update();
    setText('#phase-label',playback>=0?(replaying?'Replaying history':'Recorded history'):running?r.phase:sim.time===0?'Ready to simulate':'Paused · '+r.phase);
    setText('#viewport-time',r.time.toFixed(2)+' s');setText('#clock',r.time.toFixed(2)+' s');
    setText('#stat-deflection',id==='plate'?(r.deflection*100).toFixed(1)+' mm':r.deflection.toFixed(3));setText('#stat-broken',String(r.broken));setText('#tree-broken',String(r.broken));
    root.dataset.phase=r.phase.toLowerCase().replaceAll(' ','-');root.dataset.running=String(running||replaying);
    setText('#collision-label',collisionLabel());root.dataset.numericalBackend=client?.capabilities.models[0]?.id??sim.backend;
    root.dataset.simulationMode=client?.mode??'initializing';root.dataset.simulationLag=clock.lagSeconds.toFixed(3);root.dataset.simulationOverloads=String(clock.overloads);root.dataset.engineTimings=JSON.stringify(timings.inspect());
    if(clock.lagSeconds>.25)setText('#engine-label',`${client?.mode==='worker'?'Worker':'Simulation'} · ${clock.lagSeconds.toFixed(1)} s behind wall time`);
    else if(!loading&&!graphicsFailed&&world){const backend=(world.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL 2';setText('#engine-label',backend+' renderer'+(client?.mode==='worker'?' · worker':''));}
    root.querySelectorAll<HTMLButtonElement>('[data-action="run"]').forEach(b=>{
      b.disabled=loading||exporting||importing||graphicsFailed||root.dataset.deskBusy==='true';
      b.innerHTML=icon(running||replaying?'pause':'play')+(b.classList.contains('play-control')?'':`<span>${playback>=0?(replaying?'Pause replay':'Play history'):running?'Pause simulation':'Run simulation'}</span>`);
      if(b.classList.contains('play-control'))b.setAttribute('aria-label',playback>=0?(replaying?'Pause replay':'Play history'):running?'Pause simulation':'Run simulation');
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="reset"]').forEach(b=>{b.disabled=loading||importing||graphicsFailed;});
    const scrub=root.querySelector<HTMLInputElement>('#scrub')!;scrub.max=String(frames.length-1);scrub.value=String(playback>=0?playback:frames.length-1);
    setText('#recorded-duration',(frames.at(-1)?.response.time??0).toFixed(1)+' s recorded'+(frames.evicted?' · recent history':''));setText('#history-state',playback>=0?'REPLAY · '+(playback+1)+' / '+frames.length:'LIVE HISTORY');
    const events=sim.events.filter(e=>e.time<=r.time);setText('#event-count',String(events.length));
    if(events.length)root.querySelector('#event-list')!.replaceChildren(...events.slice(-3).reverse().map(e=>{const item=document.createElement('li'),time=document.createElement('time'),message=document.createElement('span');time.textContent=e.time.toFixed(2)+' s';message.textContent=e.message;item.append(time,message);return item;}));
    else root.querySelector('#event-list')!.innerHTML='<li class="empty-events">'+(running?'Recording the load path…':'Run a study to trace how failure develops.')+'<span>Every event comes from the solver.</span></li>';
    const metrics=world?.metrics();if(metrics){setText('#render-metrics',` · ${metrics.fps} fps · ${metrics.drawCalls} draws`);root.dataset.renderFrames=String(world.renderer.info.frame);root.dataset.drawCalls=String(metrics.drawCalls);root.dataset.triangles=String(metrics.triangles);root.dataset.sceneObjects=String(metrics.objects);root.dataset.fps=String(metrics.fps);root.dataset.riverTime=world.riverTime().toFixed(3);root.dataset.cameraPose=JSON.stringify(world.cameraState());}
    drawChart(r.time);
  }
  function drawChart(cursor:number):void {
    const canvas=root.querySelector<HTMLCanvasElement>('#response-chart')!,rect=canvas.getBoundingClientRect();
    const dpr=Math.min(devicePixelRatio,2),w=rect.width,h=rect.height;
    if(w<1||h<1)return;
    // An unchanged paused chart needs no repaint. Avoid clearing its canvas on
    // every telemetry update while the 3D renderer is presenting another frame.
    const stamp=[w,h,dpr,theme,frames.length,frames.at(-1)?.response.time,cursor].join(':');
    if(canvas.dataset.chartStamp===stamp)return;
    canvas.dataset.chartStamp=stamp;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const c=canvas.getContext('2d')!;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
    const light=theme==='atelier',muted=light?'#7b817e':'#8b9594',line=light?'#e1e4df':'#303b3c';
    const left=36,right=w-12,top=10,bottom=h-25;
    const maxT=Math.max(10,frames.at(-1)?.response.time??0),maxY=Math.max(1,...frames.map(f=>Math.max(f.response.deflection,f.response.load)))*1.12;
    c.font='10px "IBM Plex Mono", monospace';c.lineWidth=1;c.textAlign='right';
    const ticks=h<80?2:4;
    for(let i=0;i<ticks;i++){const y=bottom-(bottom-top)*i/(ticks-1);c.strokeStyle=line;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.fillStyle=muted;c.fillText((maxY*i/(ticks-1)).toFixed(1),left-9,y+3);}
    c.textAlign='center';for(let i=0;i<=4;i++){const x=left+(right-left)*i/4;c.fillStyle=muted;c.fillText((maxT*i/4).toFixed(1)+' s',x,h-7);}
    for(const [key,color] of [['load','#f7893a'],['deflection','#48c4c4']] as const){c.beginPath();c.strokeStyle=color;c.lineWidth=1.7;frames.forEach((f,i)=>{const x=left+(right-left)*f.response.time/maxT,y=bottom-(bottom-top)*f.response[key]/maxY;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();}
    if(cursor>0){const x=left+(right-left)*cursor/maxT;c.setLineDash([3,4]);c.strokeStyle=muted;c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke();c.setLineDash([]);}
  }

  markup();root.inert=true;updateUrl();
  sim.targetLoad=0;sim.strength=strength;sim.wind=wind;if(id==='plate')runEnd=Math.max(30,(70+pressSettings.stroke)/pressSettings.strikeSpeed+pressSettings.hold+12);
  try{
    client=await createStudioClient({study:id,press:pressSettings,backend:sim.backend,controls:{targetLoad:sim.targetLoad,strength,wind}},{mode:initialQuery.get('simulation')==='sync'?'sync':'auto'});clientReady=true;
    world=new StudioWorld(root.querySelector<HTMLElement>('#scene-host')!,sim);
    await world.init(message=>setText('.scene-loading>span:last-child',message));await world.applyFinish(finish);world.setLighting(lighting);world.setSurroundings(surroundings);world.setRiver(riverSettings);world.setAutoRotate(autoRotate);world.setQuality(quality);world.setCamera(cameraPreset);world.onGraphicsLost(message=>{void recoverGraphics(message);});ready();
  }catch(error){root.inert=false;throw error;}
  async function recoverGraphics(message:string):Promise<void> {
    if(graphicsRecovering||disposed)return;
    graphicsRecovering=true;loading=true;const resume=running;running=false;clock.reset();
    root.dataset.graphicsRecovery='recovering';setText('#engine-label','Recovering graphics');toast('Graphics device lost. Restoring the current experiment.');
    const position=world.camera.position.clone(),targetPosition=world.controls.target.clone(),fov=world.camera.fov;
    try{
      await pendingTask;if(disposed)return;
      world.dispose();world=new StudioWorld(root.querySelector<HTMLElement>('#scene-host')!,sim);
      await world.init();await world.applyFinish(finish);
      if(disposed){world.dispose();return;}
      world.setLighting(lighting);world.setSurroundings(surroundings);world.setRiver(riverSettings);world.setAutoRotate(autoRotate);world.setQuality(quality);world.setCamera(cameraPreset);
      world.camera.position.copy(position);world.controls.target.copy(targetPosition);world.camera.fov=fov;world.camera.updateProjectionMatrix();world.controls.update();world.update(displayed(),responseMode);
      world.onGraphicsLost(reason=>{void recoverGraphics(reason);});graphicsFailed=false;root.dataset.graphicsRecovery='recovered';
      running=resume&&sim.time<runEnd&&liveSnapshot.press?.cycle!=='Complete';ready();toast('Graphics restored. Simulation state and recordings were preserved.');
    }catch(error){graphicsFailed=true;loading=false;root.dataset.graphicsRecovery='failed';setText('#engine-label','Graphics unavailable · reload to recover');toast(`Graphics recovery failed: ${error instanceof Error?error.message:message}. Reload to retry.`);}
    finally{graphicsRecovering=false;clock.reset();}
  }
  function restartRuntime():void {
    const epoch=++generation;pending=false;clientReady=false;clock.reset(true);timings.reset();receivedAt=0;
    if(!client)return;
    const options={study:id,press:pressSettings,backend:sim.backend,controls:{targetLoad:sim.targetLoad,strength,wind}};
    const resetOperation=client.diagnostics().failed?client.destroy().then(()=>createStudioClient(options,{mode:initialQuery.get('simulation')==='sync'?'sync':'auto'})).then(async replacement=>{if(epoch!==generation||disposed){await replacement.destroy();throw new Error('Reset superseded');}client=replacement;return replacement.inspect();}):client.reset(options);
    void resetOperation.then(result=>{
      try{if(epoch!==generation||disposed)return;copySnapshotInto(liveSnapshot,result.liveSnapshot);copySnapshotInto(previousSnapshot,liveSnapshot);clientReady=true;delete root.dataset.simulationError;}
      finally{result.release();}
    }).catch(error=>{if(epoch===generation&&!disposed)simulationError(error);});
  }
  function simulationError(error:unknown):void {
    running=false;clientReady=false;root.dataset.simulationError=error instanceof Error?error.message:String(error);
    toast('Simulation paused: '+root.dataset.simulationError+'. Reset to recover.');updateUi();
  }
  function acceptStep(result:StudioStepResult,sentAt:number,epoch:number):void {
    try{
      if(epoch!==generation||disposed)return;
      const start=performance.now();copySnapshotInto(previousSnapshot,liveSnapshot);copySnapshotInto(liveSnapshot,result.liveSnapshot);
      sim.time=liveSnapshot.response.time;sim.load=liveSnapshot.response.load;sim.punchY=liveSnapshot.punchY;
      if(liveSnapshot.press)sim.pressCycle=liveSnapshot.press.cycle;
      sim.events.push(...result.eventDelta);receivedAt=performance.now();
      timings.sample('snapshot',receivedAt-start);timings.sample('step',result.simMs);timings.sample('transport',Math.max(0,receivedAt-sentAt-result.simMs));
      for(const sample of result.recordingSamples)frames.push(sample.snapshot);
      if(id==='bridge'&&shouldPauseBridge(pauseOnBridgeBreak,previousSnapshot,liveSnapshot)){
        if(frames.at(-1)?.response.time!==sim.time){const sample=sim.createSnapshotTarget();copySnapshotInto(sample,liveSnapshot);frames.push(sample);}
        running=false;clock.reset();root.dataset.bridgeAutoPause='first-rupture';
        toast(`First rupture detected. Paused at ${sim.time.toFixed(2)} s; select a milestone to inspect the recorded geometry.`);updateUi();
      }else if(result.completed||sim.time>=runEnd){
        if(frames.at(-1)?.response.time!==sim.time){const final=sim.createSnapshotTarget();copySnapshotInto(final,liveSnapshot);frames.push(final);}
        running=false;clock.reset();if(!graphicsRecovering)world.update(liveSnapshot,responseMode);toast('Run recorded. Scrub the timeline to replay the failure.');updateUi();
      }
    }finally{result.release();if(epoch===generation){pending=false;if(!running&&playback<0&&!disposed&&!graphicsRecovering)world.update(liveSnapshot,responseMode);}}
  }
  function animate(now:number):void {
    if(disposed)return;
    if(graphicsRecovering||graphicsFailed){clock.advance(now,speed,false);animationId=requestAnimationFrame(animate);return;}
    const frameStart=performance.now(),elapsed=Math.min(.05,clock.advance(now,speed,running));
    if(running&&!exporting&&clientReady&&client&&!pending){
      const ticks=clock.takeSteps();
      if(ticks>0){
        pending=true;const epoch=generation,sentAt=performance.now();
        const commands=id==='plate'&&pressDrive!=='steady'?pressDriveCommands(pressDrive,client.tick,ticks,pressSettings.pressure,{strength,wind}):[{tick:client.tick+1,type:'controls' as const,values:{targetLoad:sim.targetLoad,strength,wind}}];
        pendingTask=client.step({ticks,commands,stopAtTime:runEnd})
          .then(result=>acceptStep(result,sentAt,epoch)).catch(error=>{if(epoch===generation&&!disposed){pending=false;simulationError(error);}});
      }
    }
    if(running&&receivedAt>0){
      const geometryStart=performance.now(),interval=Math.max(FIXED_DT,liveSnapshot.response.time-previousSnapshot.response.time);
      interpolateSnapshotInto(presentationSnapshot,previousSnapshot,liveSnapshot,(now-receivedAt)/(interval*1000));world.update(presentationSnapshot,responseMode);timings.sample('geometry',performance.now()-geometryStart);
    }
    if(replaying){replayTime+=elapsed*speed;while(playback<frames.length-1&&frames.at(playback+1)!.response.time<=replayTime)playback++;world.update(frames.at(playback)!,responseMode);if(playback===frames.length-1){replaying=false;updateUi();}}
    // The full collection obscures the scene. Keep its last frame while browsing;
    // the compact drawer continues rendering the visible experiment.
    const collection=root.querySelector<HTMLDialogElement>('.collection-dialog');
    const renderStart=performance.now();if(!collection?.open||collection.classList.contains('collection-peek'))world.render(now/1000);timings.sample('renderCpu',performance.now()-renderStart);
    if(queuedComparison){queuedComparison=false;root.querySelector<HTMLImageElement>('#comparison-live')!.src=world.renderer.domElement.toDataURL('image/png');setText('#comparison-live-caption',`${STUDIES[id].title} · ${cameraPreset} · ${displayed().response.time.toFixed(2)} s`);}
    if(queuedCapture){queuedCapture=false;world.renderer.domElement.toBlob(blob=>{if(blob)download(`box3d-${id}-${displayed().response.time.toFixed(2)}s.png`,blob);});toast('Viewport image captured.');}
    if(now-lastUi>120) {updateUi();lastUi=now;}
    timings.sample('frame',performance.now()-frameStart);animationId=requestAnimationFrame(animate);
  }
  animationId=requestAnimationFrame(animate);
  window.addEventListener('pagehide',event=>{if(event.persisted){bridgeReview?.cancelExperiments();return;}bridgeReview?.dispose();disposed=true;generation++;cancelAnimationFrame(animationId);client?.destroy();world.dispose();},{once:true});
}
