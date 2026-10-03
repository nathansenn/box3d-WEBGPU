import { FINISH_PRESETS, LIGHTING_PRESETS, LOAD_PRESETS, CAMERA_PRESETS, PACKS, PRESET_COUNT, type FinishPreset, type LightingPreset, type LoadPreset, type CameraPreset } from './presets';
import type { StudyId } from './physics';

type Category='finishes'|'lighting'|'loads'|'cameras';
interface Selection {study:StudyId;finish:string;lighting:string;load:string;camera:CameraPreset}
interface Actions {
  state:()=>Selection;
  finish:(preset:FinishPreset)=>Promise<void>;
  lighting:(preset:LightingPreset)=>void;
  load:(preset:LoadPreset)=>void;
  camera:(preset:CameraPreset)=>void;
}
const icon=(s:string)=>`<i class="ph ph-${s}" aria-hidden="true"></i>`;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export class PresetBrowser {
  private dialog:HTMLDialogElement;
  private category:Category='finishes';
  private query='';
  private busy=false;
  constructor(root:HTMLElement,private actions:Actions) {
    this.dialog=document.createElement('dialog');this.dialog.className='preset-dialog';this.dialog.setAttribute('aria-labelledby','preset-title');
    this.dialog.innerHTML=`<div class="preset-heading"><div><span class="preset-eyebrow">THE STUDIO COLLECTION</span><h2 id="preset-title">Make the study yours.</h2><p>${PRESET_COUNT} curated presets across three experiments.</p></div><button class="icon-button" data-preset-close aria-label="Close preset library">${icon('x')}</button></div>
      <div class="preset-toolbar"><nav role="tablist" aria-label="Preset categories">${([['finishes','Finishes','swatches'],['lighting','Lighting','sun'],['loads','Load cases','waveform'],['cameras','Cameras','camera']] as const).map(([id,label,glyph])=>`<button role="tab" id="preset-tab-${id}" aria-controls="preset-results" data-category="${id}" aria-selected="${id==='finishes'}">${icon(glyph)}${label}</button>`).join('')}</nav><label class="preset-search">${icon('magnifying-glass')}<input type="search" placeholder="Find a preset…" aria-label="Search presets" autocomplete="off"></label></div>
      <div class="preset-context"><span id="preset-context"></span><span id="preset-count" class="mono"></span></div>
      <div id="preset-results" role="tabpanel" aria-labelledby="preset-tab-finishes"></div>
      <div class="preset-footer"><p id="preset-note"></p><span class="preset-feedback" role="status" aria-live="polite"></span></div>
      <details class="preset-sources"><summary>From four creative workspaces ${icon('arrow-up-right')}</summary><p>StudiCraft: cinematic camera and ambient light palettes. HouseBuilder: architectural finishes and compatible surface choices. Commander Academy: workshop PBR materials and failure study patterns. Material Forge: textured finishes and studio illumination.</p><p>Adapted for these three reduced models. Finish variants are visual treatments; load cases use this studio’s authored solver coefficients.</p></details>`;
    root.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('[data-preset-close]')!.onclick=()=>this.dialog.close();
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>{
      b.onclick=()=>{this.category=b.dataset.category as Category;this.draw();};
      b.onkeydown=e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();const tabs=[...this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]')],i=tabs.indexOf(b),next=tabs[(i+(e.key==='ArrowRight'?1:3))%4];next.click();next.focus();};
    });
    this.dialog.querySelector<HTMLInputElement>('input')!.oninput=e=>{this.query=(e.target as HTMLInputElement).value.trim().toLowerCase();this.draw();};
    this.dialog.addEventListener('click',e=>{if(e.target!==this.dialog)return;const r=this.dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.dialog.close();});
  }
  open(category:Category='finishes'):void {this.category=category;this.draw();this.dialog.showModal();}
  private draw():void {
    const state=this.actions.state(),kind=this.category;
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b=>{const active=b.dataset.category===kind;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
    const results=this.dialog.querySelector<HTMLElement>('#preset-results')!;results.setAttribute('aria-labelledby',`preset-tab-${kind}`);
    const entries=kind==='finishes'?FINISH_PRESETS.filter(p=>p.study===state.study):kind==='lighting'?LIGHTING_PRESETS:kind==='loads'?LOAD_PRESETS.filter(p=>p.study===state.study):CAMERA_PRESETS;
    const shown=entries.filter(p=>`${p.name} ${p.description} ${'source' in p?p.source:'StudiCraft'}`.toLowerCase().includes(this.query));
    this.dialog.querySelector('#preset-count')!.textContent=`${shown.length} / ${entries.length}`;
    this.dialog.querySelector('#preset-context')!.textContent=kind==='finishes'?`Compatible with ${state.study==='canopy'?'woven membranes':state.study==='plate'?'sheet metal':'timber decks'}`:kind==='loads'?'A new experiment, ready to run':kind==='lighting'?'Light shapes how you see the response':'Find your point of view';
    this.dialog.querySelector('#preset-note')!.textContent=kind==='finishes'?'Appearance only. Connection strength stays in the load inspector.':kind==='loads'?'Applying a load case resets the current run. Press Run simulation to begin.':kind==='lighting'?'Lighting is a visual treatment. Wind is controlled independently.':'Camera positions follow the scale of the active experiment.';
    results.innerHTML=shown.length?`<div class="preset-grid">${shown.map(p=>{
      const selected=p.id===(kind==='finishes'?state.finish:kind==='lighting'?state.lighting:kind==='loads'?state.load:state.camera);
      let visual='';
      if(kind==='finishes'){
        const f=p as FinishPreset;visual=`<div class="preset-art finish-art" style="--finish-color:${f.color};background-image:url('${import.meta.env.BASE_URL}studio/materials/${PACKS[f.pack].base}')"><span class="finish-chip" style="background:${f.color}"></span><span>${f.study==='canopy'?'TEXTILE':f.study==='plate'?'METAL':'TIMBER'}</span></div>`;
      } else if(kind==='lighting'){
        const l=p as LightingPreset;visual=`<div class="preset-art light-art" style="--sky:${l.sky};--horizon:${l.horizon};--sun:${l.key};--sun-x:${50+l.sun[0]}%"><div class="light-orb"></div><div class="light-horizon"></div></div>`;
      } else if(kind==='loads'){
        const l=p as LoadPreset;visual=`<div class="preset-art load-art"><svg viewBox="0 0 240 90" aria-hidden="true"><path class="load-grid" d="M15 18H225M15 43H225M15 68H225M50 10V80M100 10V80M150 10V80M200 10V80"/><path class="load-line" d="M15 73L${15+l.target/.55/30*210} ${73-l.target*12}H225"/></svg><span>${l.target.toFixed(2)} load <b>·</b> ${l.strength.toFixed(2)}× strength</span></div>`;
      } else visual=`<div class="preset-art camera-art camera-${p.id}">${icon(p.id==='plan'?'grid-four':p.id==='detail'?'magnifying-glass-plus':p.id==='elevation'?'align-bottom':p.id==='reverse'?'arrows-clockwise':'cube')}<span>${state.study.toUpperCase()}</span></div>`;
      return `<button class="preset-card ${selected?'selected':''}" data-preset="${p.id}" aria-label="Apply ${escape(p.name)}" aria-pressed="${selected}" ${this.busy?'disabled':''}>${visual}<div class="preset-card-copy"><div><strong>${escape(p.name)}</strong>${icon(selected?'check-circle':'plus')}</div><p>${escape(p.description)}</p><span>Inspired by ${'source' in p?p.source:'StudiCraft'}</span></div></button>`;
    }).join('')}</div>`:'<div class="preset-empty">No matching presets.<span>Try a material, mood, or workspace name.</span></div>';
    results.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b=>b.onclick=()=>{void this.apply(b.dataset.preset!);});
  }
  private async apply(id:string):Promise<void> {
    if(this.busy)return;this.busy=true;
    const category=this.category,feedback=this.dialog.querySelector<HTMLElement>('.preset-feedback')!;
    feedback.textContent=category==='finishes'?'Loading local material…':'Applying preset…';this.draw();
    try {
      if(category==='finishes')await this.actions.finish(FINISH_PRESETS.find(p=>p.id===id)!);
      if(category==='lighting')this.actions.lighting(LIGHTING_PRESETS.find(p=>p.id===id)!);
      if(category==='loads')this.actions.load(LOAD_PRESETS.find(p=>p.id===id)!);
      if(category==='cameras')this.actions.camera(id as CameraPreset);
      feedback.textContent=category==='loads'?'New run prepared.':'Applied to the live scene.';
    } catch {feedback.textContent='This preset could not load. Your previous selection is preserved.';}
    finally {this.busy=false;this.draw();}
  }
}
