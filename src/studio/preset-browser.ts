import { FINISH_PRESETS, LIGHTING_PRESETS, LOAD_PRESETS, CAMERA_PRESETS, SURROUNDING_PRESETS, SCENE_SETUPS, PACKS, PRESET_COUNT, camerasFor, finishFor, lightingFor, loadFor, type FinishPreset, type LightingPreset, type LoadPreset, type CameraPreset, type SurroundingPreset, type SceneSetup } from './presets';
import { COLLECTION_KEY, readCollection, toggleFavorite, rememberPreset, type CollectionState } from './collection-state';
import type { StudyId } from './physics';
import './collection.css';

type Category='setups'|'finishes'|'lighting'|'loads'|'cameras'|'surroundings';
type Entry=FinishPreset|LightingPreset|LoadPreset|SurroundingPreset|SceneSetup|ReturnType<typeof camerasFor>[number];
export interface Selection {study:StudyId;finish:string;lighting:string;load:string;camera:CameraPreset;surroundings:string;setup?:string}
export interface PresetActions {
  state:()=>Selection;
  finish:(preset:FinishPreset)=>Promise<void>;
  lighting:(preset:LightingPreset)=>void;
  load:(preset:LoadPreset)=>void;
  camera:(preset:CameraPreset)=>void;
  surroundings:(preset:SurroundingPreset)=>void;
  setup:(preset:SceneSetup)=>Promise<void>;
}
const categories=[['setups','Scene setups','cube'],['finishes','Finishes','swatches'],['lighting','Lighting','sun'],['loads','Load cases','waveform'],['cameras','Cameras','camera'],['surroundings','Surroundings','tree']] as const;
const sources=['StudiCraft','HouseBuilder','Commander Academy','Material Forge'];
const allEntries=[...SCENE_SETUPS,...FINISH_PRESETS,...LIGHTING_PRESETS,...LOAD_PRESETS,...CAMERA_PRESETS,...SURROUNDING_PRESETS];
const validIds=new Set(allEntries.map(p=>p.id));
const icon=(s:string)=>`<i class="ph ph-${s}" aria-hidden="true"></i>`;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const origin=(p:Entry)=>'source' in p?p.source:'StudiCraft';
// Custom-property URLs resolve at the consuming stylesheet in a bundled build.
// Resolve against the document first so swatches also work below /assets/ and project base paths.
const swatch=(f:FinishPreset)=>`--sample-color:${f.color};--sample-image:url('${new URL(`${import.meta.env.BASE_URL}studio/materials/${PACKS[f.pack].base}`,document.baseURI).href}')`;
const ramp=(p:LoadPreset)=>`<svg viewBox="0 0 240 82" aria-hidden="true"><path class="collection-gridlines" d="M14 16H226M14 40H226M14 66H226M56 10V70M112 10V70M168 10V70"/><path class="collection-ramp" d="M14 66L${14+p.target/.55/12*210} ${66-p.target*10}H226"/></svg>`;

export class PresetBrowser {
  private dialog:HTMLDialogElement;
  private category:Category='setups';
  private query='';
  private source='all';
  private collection='all';
  private busy=false;
  private preferences:CollectionState;
  constructor(root:HTMLElement,private actions:PresetActions) {
    let raw:string|null=null;try{raw=localStorage.getItem(COLLECTION_KEY);}catch{/* Private storage is optional. */}
    this.preferences=readCollection(raw,validIds);
    this.dialog=document.createElement('dialog');this.dialog.className='collection-dialog';this.dialog.setAttribute('aria-labelledby','preset-title');
    this.dialog.innerHTML=`<header class="collection-heading"><div><span class="collection-eyebrow">BOX3D / EXPERIMENT COLLECTION</span><h2 id="preset-title">A place to start exploring.</h2><p>${PRESET_COUNT} presets. Three studies. Your next experiment.</p></div><button class="icon-button" data-close aria-label="Close preset library">${icon('x')}</button></header>
      <div class="collection-toolbar"><label class="collection-search">${icon('magnifying-glass')}<input type="search" placeholder="Find a finish, mood or load case" aria-label="Search presets" autocomplete="off"><button data-clear aria-label="Clear preset search" hidden>${icon('x')}</button></label><button class="collection-preview" data-preview aria-pressed="false">${icon('sidebar-simple')}<span>Keep scene visible</span></button></div>
      <div class="collection-body"><aside class="collection-sidebar"><nav role="tablist" aria-orientation="vertical" aria-label="Preset categories">${categories.map(([id,label,glyph])=>`<button role="tab" id="preset-tab-${id}" aria-controls="preset-results" data-category="${id}" aria-selected="${id==='setups'}">${icon(glyph)}<span>${label}</span><small data-total="${id}"></small></button>`).join('')}</nav><div class="collection-filter-heading">YOUR COLLECTION</div><div class="collection-saved">${[['all','All presets','squares-four'],['favorites','Favorites','star'],['recent','Recently used','clock-counter-clockwise']].map(([id,label,glyph])=>`<button data-collection="${id}" aria-pressed="${id==='all'}">${icon(glyph)}${label}</button>`).join('')}</div><label class="collection-filter-heading" for="preset-source">WORKSPACE INSPIRATION</label><select id="preset-source" aria-label="Filter by workspace"><option value="all">All four workspaces</option>${sources.map(s=>`<option>${s}</option>`).join('')}</select><p class="collection-local">${icon('bookmark-simple')} Favorites stay in this browser.</p></aside>
      <section class="collection-content"><div class="collection-context"><div><span id="preset-context"></span><strong id="preset-count" class="mono" aria-live="polite"></strong></div><label class="collection-sort">Sort <select aria-label="Sort presets"><option value="curated">Curated order</option><option value="name">Name A–Z</option></select></label></div><div id="preset-results" role="tabpanel" aria-labelledby="preset-tab-setups" tabindex="0"></div></section></div>
      <footer class="collection-footer"><div><p id="preset-note"></p><span class="collection-feedback" role="status" aria-live="polite">Choose a setup, then run the experiment.</span></div><button class="secondary" data-view>${icon('arrow-up-right')} View scene</button></footer>
      <details class="collection-sources"><summary>About the four workspaces</summary><p>StudiCraft informs camera composition and ambient palettes. HouseBuilder informs compatible architectural finishes. Commander Academy supplies workshop texture packs and inspection ideas. Material Forge informs studio light and river surroundings.</p><p>These are adaptations for BOX3D’s three reduced models. Finishes and surroundings change appearance. Load cases use authored, normalized solver values.</p></details>`;
    root.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.dialog.close();
    this.dialog.querySelector<HTMLButtonElement>('[data-view]')!.onclick=()=>this.dialog.close();
    this.dialog.querySelector<HTMLButtonElement>('[data-preview]')!.onclick=e=>{const on=this.dialog.classList.toggle('collection-peek');(e.currentTarget as HTMLElement).setAttribute('aria-pressed',String(on));};
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>{
      b.onclick=()=>{this.category=b.dataset.category as Category;this.draw();this.dialog.querySelector('.collection-content')!.scrollTop=0;};
      b.onkeydown=e=>{if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]')],i=tabs.indexOf(b),next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:tabs.length-1))%tabs.length];next.click();next.focus();};
    });
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-collection]').forEach(b=>b.onclick=()=>{this.collection=b.dataset.collection!;this.draw();});
    const search=this.dialog.querySelector<HTMLInputElement>('input[type=search]')!;
    search.oninput=()=>{this.query=search.value.trim().toLowerCase();this.draw();};
    this.dialog.querySelector<HTMLButtonElement>('[data-clear]')!.onclick=()=>{search.value='';this.query='';this.draw();search.focus();};
    this.dialog.querySelector<HTMLSelectElement>('#preset-source')!.onchange=e=>{this.source=(e.target as HTMLSelectElement).value;this.draw();};
    this.dialog.querySelector<HTMLSelectElement>('[aria-label="Sort presets"]')!.onchange=()=>this.draw();
    this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
  }
  open(category:Category='setups'):void {this.category=category;this.draw();this.dialog.showModal();}
  private entries(kind:Category,state:Selection):readonly Entry[] {
    return kind==='setups'?SCENE_SETUPS.filter(p=>p.study===state.study):kind==='finishes'?FINISH_PRESETS.filter(p=>p.study===state.study):kind==='lighting'?LIGHTING_PRESETS:kind==='loads'?LOAD_PRESETS.filter(p=>p.study===state.study):kind==='surroundings'?SURROUNDING_PRESETS.filter(p=>p.habitat===(state.study==='bridge'?'valley':'hall')):camerasFor(state.study);
  }
  private save():boolean {try{localStorage.setItem(COLLECTION_KEY,JSON.stringify(this.preferences));return true;}catch{return false;}}
  private feedback(message:string):void {this.dialog.querySelector('.collection-feedback')!.textContent=message;}
  private draw():void {
    const state=this.actions.state(),kind=this.category;
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>{const active=b.dataset.category===kind;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;b.disabled=this.busy;});
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-collection]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.collection===this.collection)));
    this.dialog.querySelectorAll<HTMLElement>('[data-total]').forEach(e=>e.textContent=String(this.entries(e.dataset.total as Category,state).length));
    this.dialog.querySelector<HTMLButtonElement>('[data-clear]')!.hidden=!this.query;
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-close],[data-view]').forEach(b=>b.disabled=this.busy);
    const entries=this.entries(kind,state),sort=this.dialog.querySelector<HTMLSelectElement>('[aria-label="Sort presets"]')!.value;
    const shown=entries.filter(p=>`${p.name} ${p.description} ${origin(p)} ${'intent' in p?p.intent:''}`.toLowerCase().includes(this.query)&&(this.source==='all'||origin(p)===this.source)&&(this.collection==='all'||this.preferences[this.collection==='favorites'?'favorites':'recent'].includes(p.id)));
    if(sort==='name')shown.sort((a,b)=>a.name.localeCompare(b.name));
    else if(this.collection==='recent')shown.sort((a,b)=>this.preferences.recent.indexOf(a.id)-this.preferences.recent.indexOf(b.id));
    this.dialog.querySelector('#preset-count')!.textContent=`${shown.length} / ${entries.length}`;
    const study=state.study==='canopy'?'Canopy':state.study==='plate'?'Plate press':'Suspension bridge';
    this.dialog.querySelector('#preset-context')!.textContent=`${study} · ${categories.find(c=>c[0]===kind)![1]}`;
    this.dialog.querySelector('#preset-note')!.textContent=kind==='setups'?'Applies finish, light, load, camera and surroundings. Resets the current run.':kind==='loads'?'Resets the current run. Press Run simulation when you are ready.':kind==='finishes'?'Appearance only. Adjust connection strength in the load inspector.':kind==='surroundings'?'Visual surroundings. Wind and mechanical loads stay independent.':kind==='lighting'?'Lighting changes how you see the response.':'Camera positions follow the active experiment.';
    const results=this.dialog.querySelector<HTMLElement>('#preset-results')!;results.setAttribute('aria-labelledby',`preset-tab-${kind}`);results.setAttribute('aria-busy',String(this.busy));
    results.innerHTML=shown.length?`<div class="collection-grid" data-kind="${kind}">${shown.map(p=>this.card(p,state,kind)).join('')}</div>`:`<div class="collection-empty">${icon(this.collection==='favorites'?'star':'magnifying-glass')}<h3>${this.collection==='favorites'?'No saved presets here yet.':'No matching presets.'}</h3><p>${this.collection==='favorites'?'Star a preset to keep it in your collection.':'Try a different workspace, category or search.'}</p><button data-reset-filters class="secondary">Show all ${categories.find(c=>c[0]===kind)![1].toLowerCase()}</button></div>`;
    results.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.onclick=()=>{void this.apply(b.dataset.preset!);});
    results.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach(b=>b.onclick=()=>{const id=b.dataset.favorite!;this.preferences=toggleFavorite(this.preferences,id);const persisted=this.save(),saved=this.preferences.favorites.includes(id);this.draw();this.feedback(persisted?(saved?'Saved to favorites.':'Removed from favorites.'):'Saved for this visit. Browser storage is unavailable.');this.dialog.querySelector<HTMLButtonElement>(`[data-favorite="${id}"]`)?.focus();});
    const reset=results.querySelector<HTMLButtonElement>('[data-reset-filters]');if(reset)reset.onclick=()=>{this.query='';this.source='all';this.collection='all';this.dialog.querySelector<HTMLInputElement>('input')!.value='';this.dialog.querySelector<HTMLSelectElement>('#preset-source')!.value='all';this.draw();};
  }
  private card(p:Entry,state:Selection,kind:Category):string {
    const selected=p.id===(kind==='setups'?state.setup:kind==='finishes'?state.finish:kind==='lighting'?state.lighting:kind==='loads'?state.load:kind==='surroundings'?state.surroundings:state.camera),saved=this.preferences.favorites.includes(p.id);
    let visual='',spec='';
    if(kind==='setups'){
      const s=p as SceneSetup,f=finishFor(s.study,s.finish),l=lightingFor(s.lighting),r=loadFor(s.study,s.load);
      visual=`<div class="collection-art collection-setup" style="${swatch(f)};--mood-sky:${l.sky};--mood-horizon:${l.horizon}"><div class="collection-sample"></div><div class="collection-setup-load">${ramp(r)}<span>${s.intent.toUpperCase()} / ${r.speed}× SPEED</span></div><b class="collection-material-label">${escape(f.name)}</b></div>`;
      spec=`<dl class="collection-spec"><div><dt>Load</dt><dd>${r.target.toFixed(2)}</dd></div><div><dt>Strength</dt><dd>${r.strength.toFixed(2)}×</dd></div><div><dt>Wind</dt><dd>${r.wind.toFixed(2)}</dd></div></dl><div class="collection-combination">${icon('sun')}${escape(l.name)}<span>·</span>${escape(CAMERA_PRESETS.find(c=>c.id===s.camera)!.name)}</div>`;
    }else if(kind==='finishes'){
      const f=p as FinishPreset;visual=`<div class="collection-art collection-finish" style="${swatch(f)}"><span>${f.study==='canopy'?'MEMBRANE':f.study==='plate'?'SHEET METAL':'TIMBER DECK'}</span></div>`;
      spec=`<div class="collection-finish-values"><span>Roughness <b>${f.roughness.toFixed(2)}</b></span><span>${f.study==='plate'?'Metalness':'Relief'} <b>${(f.study==='plate'?f.metalness:f.normal).toFixed(2)}</b></span></div>`;
    }else if(kind==='lighting'){
      const l=p as LightingPreset;visual=`<div class="collection-art collection-light" style="--mood-sky:${l.sky};--mood-horizon:${l.horizon};--key:${l.key};--sun-x:${Math.max(12,Math.min(80,50+l.sun[0]))}%"><div></div><span>${l.exposure.toFixed(2)} EXPOSURE</span></div>`;
    }else if(kind==='loads'){
      const l=p as LoadPreset;visual=`<div class="collection-art collection-load">${ramp(l)}<span>TARGET ${l.target.toFixed(2)} · ${l.speed}× PLAYBACK</span></div>`;spec=`<div class="collection-finish-values"><span>Strength <b>${l.strength.toFixed(2)}×</b></span><span>Wind <b>${l.wind.toFixed(2)}</b></span></div>`;
    }else if(kind==='surroundings'){
      const s=p as SurroundingPreset,colors=s.habitat==='hall'?[s.wall,s.floor,s.steel]:[s.leaf,s.grass,s.rock,s.water];visual=`<div class="collection-art collection-surroundings">${colors.map(c=>`<div style="background:${c}"></div>`).join('')}<span>${s.habitat==='hall'?'WALL / FLOOR / FIXTURE':'FOLIAGE / BANK / STONE / WATER'}</span></div>`;
    }else visual=`<div class="collection-art collection-camera">${icon(p.id==='plan'?'grid-four':p.id==='connection'?'anchor-simple':p.id==='detail'?'magnifying-glass-plus':p.id==='wide'?'arrows-out':p.id==='elevation'?'align-bottom':p.id==='reverse'?'arrows-clockwise':'cube')}<span>${state.study.toUpperCase()} / ${p.id.toUpperCase()}</span></div>`;
    return `<article class="collection-card ${selected?'is-selected':''}"><button class="collection-apply" data-preset="${p.id}" aria-label="Apply ${escape(p.name)}" aria-pressed="${selected}" ${this.busy?'disabled':''}>${visual}<div class="collection-copy"><div class="collection-card-title"><h3>${escape(p.name)}</h3>${selected?icon('check-circle'):''}</div><p>${escape(p.description)}</p>${spec}<span class="collection-origin">${escape(origin(p))}</span><span class="collection-apply-label">${selected?'Applied':kind==='setups'?'Apply setup':'Apply preset'} ${icon(selected?'check':'arrow-up-right')}</span></div></button><button class="collection-star" data-favorite="${p.id}" aria-label="${saved?'Remove':'Save'} ${escape(p.name)} ${saved?'from':'to'} favorites" aria-pressed="${saved}" ${this.busy?'disabled':''}>${icon('star')}</button></article>`;
  }
  private async apply(id:string):Promise<void> {
    if(this.busy)return;this.busy=true;const category=this.category;
    this.feedback(category==='finishes'||category==='setups'?'Loading local material…':'Applying preset…');this.draw();
    try {
      if(category==='setups')await this.actions.setup(SCENE_SETUPS.find(p=>p.id===id)!);
      if(category==='finishes')await this.actions.finish(FINISH_PRESETS.find(p=>p.id===id)!);
      if(category==='lighting')this.actions.lighting(LIGHTING_PRESETS.find(p=>p.id===id)!);
      if(category==='loads')this.actions.load(LOAD_PRESETS.find(p=>p.id===id)!);
      if(category==='cameras')this.actions.camera(id as CameraPreset);
      if(category==='surroundings')this.actions.surroundings(SURROUNDING_PRESETS.find(p=>p.id===id)!);
      this.preferences=rememberPreset(this.preferences,id);this.save();
      this.feedback(category==='loads'||category==='setups'?'New run prepared. View the scene, then press Run simulation.':'Applied to the live scene.');
    }catch{this.feedback('Could not load this preset. Check the local server, then try again.');}
    finally{this.busy=false;this.draw();this.dialog.querySelector<HTMLButtonElement>(`[data-preset="${id}"]`)?.focus({preventScroll:true});}
  }
}
