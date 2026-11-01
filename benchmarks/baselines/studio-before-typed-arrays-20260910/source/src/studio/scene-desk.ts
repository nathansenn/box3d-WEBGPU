import { FINISH_PRESETS, LIGHTING_PRESETS, LOAD_PRESETS, SCENE_SETUPS, PACKS, finishFor, loadFor } from './presets';
import type { PresetActions } from './preset-browser';
import { RIVER_PROFILES, riverProfile, type RiverSettings } from './river-settings';
import './scene-desk.css';

type Panel = 'setup' | 'surface' | 'environment' | 'test';
interface DeskOptions {
  water: () => RiverSettings;
  setWater: (settings: RiverSettings) => void;
  undo: () => Promise<void>;
  canUndo: () => boolean;
  rotate: () => boolean;
  setRotate: (enabled: boolean) => void;
  resized: () => void;
  browse: (kind: 'setups' | 'finishes' | 'lighting' | 'loads') => void;
}
const icon = (name: string) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const tabs = [['setup','Set up','cube'],['surface','Surface','swatches'],['environment','World','sun-horizon'],['test','Test','waveform']] as const;

/** A live, non-modal proving panel adapted from the Material Forge river workflow. */
export class SceneDesk {
  private panel: Panel = 'setup';
  private query = '';
  private intent = 'all';
  private busy = false;
  private inspector: HTMLElement;
  constructor(private root: HTMLElement, private actions: PresetActions, private options: DeskOptions) {
    root.classList.add('scene-workflow');
    root.classList.toggle('desk-collapsed', matchMedia('(max-width:800px)').matches);
    this.inspector = root.querySelector('.load-inspector')!;
    this.inspector.setAttribute('aria-label','Experiment desk');
    const test = this.inspector.querySelector<HTMLElement>('.inspector-scroll')!;
    const presentation = test.querySelector('.presentation-controls')!;
    const treatment = test.querySelector('.mobile-workspace')!;
    const stats = this.inspector.querySelector('.result-stats')!;
    const run = this.inspector.querySelector('[data-action="run"]')!;
    const release = this.inspector.querySelector('[data-action="unload"]')!;
    const runNumber = this.inspector.querySelector('#run-number')!;
    test.classList.add('test-controls');
    const header = this.inspector.querySelector('.inspector-heading')!;
    header.innerHTML = `<div><span class="desk-kicker">LIVE PROVING GROUND</span><h2>Experiment desk</h2></div><button class="icon-button" data-desk-hide aria-label="Hide experiment desk">${icon('sidebar-simple')}</button>`;
    header.classList.add('desk-heading');
    this.inspector.append(header);
    this.inspector.insertAdjacentHTML('beforeend', `<nav class="desk-tabs" role="tablist" aria-label="Experiment workflow">${tabs.map(([key,label,glyph]) => `<button role="tab" id="desk-tab-${key}" data-desk-tab="${key}" aria-controls="desk-page-${key}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>
      <div class="desk-scroll">
        <section class="desk-page" id="desk-page-setup" role="tabpanel" aria-labelledby="desk-tab-setup">
          <div class="desk-section-title"><h3>Choose a starting point</h3><button data-desk-browse="setups" class="desk-text-button">Full library ${icon('arrow-up-right')}</button></div>
          <p class="desk-note">A complete scene, material and load case. Apply one, inspect it, then run.</p>
          <label class="desk-search">${icon('magnifying-glass')}<input type="search" aria-label="Search scene setups" placeholder="Search these experiments"><button data-desk-clear aria-label="Clear scene search" hidden>${icon('x')}</button></label>
          <div class="desk-chips" aria-label="Experiment intent">${['all','explore','inspect','failure'].map(i=>`<button data-desk-intent="${i}" aria-pressed="${i==='all'}">${i==='all'?'All setups':i[0].toUpperCase()+i.slice(1)}</button>`).join('')}</div>
          <div class="desk-count" aria-live="polite"></div><div class="desk-setups"></div>
        </section>
        <section class="desk-page" id="desk-page-surface" role="tabpanel" aria-labelledby="desk-tab-surface" hidden>
          <div class="desk-section-title"><h3>Specimen finish</h3><button data-desk-browse="finishes" class="desk-text-button">Browse ${icon('arrow-up-right')}</button></div>
          <p class="desk-note">Compare the same specimen in a different material finish. The recorded run stays intact.</p>
          <div class="desk-finishes"></div><p class="desk-note desk-boundary">${actions.state().study==='plate'?'Finish changes appearance. Metal and thickness are controlled in Test.':'Finish changes appearance. Connection strength is controlled in Test.'}</p>
        </section>
        <section class="desk-page" id="desk-page-environment" role="tabpanel" aria-labelledby="desk-tab-environment" hidden>
          <div class="desk-section-title"><h3>Lighting & atmosphere</h3><button data-desk-browse="lighting" class="desk-text-button">All lights ${icon('arrow-up-right')}</button></div>
          <div class="desk-lights">${['neutral','daylight','raking','amber-room','mist','golden'].map(id=>{const p=LIGHTING_PRESETS.find(p=>p.id===id)!;return `<button data-desk-light="${id}" aria-label="Lighting: ${escape(p.name)}" aria-pressed="false"><i style="background:linear-gradient(145deg,${p.sky},${p.horizon})"></i>${escape(p.name)}</button>`;}).join('')}</div>
          <div class="desk-presentation"></div>
          ${actions.state().study==='bridge'?`<section class="desk-river"><div class="desk-section-title"><h3>Lessons Bridge water</h3>${icon('waves')}</div><p class="desk-note">Flow profiles adapted from the Material Forge river.</p><div class="desk-river-views"><button data-desk-camera="stream">${icon('waves')} River corridor</button><button data-desk-camera="bank">${icon('mountains')} Bank detail</button></div><div class="desk-water-profiles">${RIVER_PROFILES.map(p=>`<button data-water-profile="${p.id}" aria-label="Water: ${p.name}" aria-pressed="false"><strong>${p.name}</strong><span>${p.description}</span></button>`).join('')}</div><div class="desk-water-status" aria-live="polite"></div>${(['flow','wave','foam'] as const).map((key,i)=>`<label class="slider-label" for="river-${key}"><span>${['Flow speed','Wave energy','Foam amount'][i]}</span><output id="river-${key}-value"></output></label><input id="river-${key}" aria-label="${['Flow speed','Wave energy','Foam amount'][i]}" type="range" min="${key==='flow'?.15:0}" max="${key==='wave'?1.8:2}" step="0.01" value="1">`).join('')}<label class="desk-toggle"><span>Animate flow</span><input type="checkbox" id="river-animate" checked></label><p class="desk-note desk-boundary">Visual current only. Water does not apply forces to the bridge.</p></section>`:''}
          <label class="desk-toggle"><span>Orbit automatically</span><input type="checkbox" id="desk-rotate"></label><div class="desk-treatment"></div>
        </section>
        <section class="desk-page" id="desk-page-test" role="tabpanel" aria-labelledby="desk-tab-test" hidden><div class="desk-section-title"><h3>Load & failure</h3><span class="desk-run-id">RUN </span></div><label class="field-label" for="desk-load-recipe">Prepared load case</label><select id="desk-load-recipe"><option value="" disabled>Custom load case</option>${LOAD_PRESETS.filter(p=>p.study===actions.state().study).map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></section>
      </div>
      <div class="desk-feedback" role="status" aria-live="polite">The scene stays live while you explore.</div><footer class="desk-footer"><div class="desk-footer-actions"><button data-desk-undo title="Undo the last appearance change without resetting the run">${icon('arrow-u-up-left')} Undo look</button></div></footer>`);
    this.inspector.querySelector('.desk-presentation')!.append(presentation);
    this.inspector.querySelector('.desk-treatment')!.append(treatment);
    this.inspector.querySelector('.desk-run-id')!.append(runNumber);
    this.inspector.querySelector('#desk-page-test')!.append(test,release);
    this.inspector.querySelector('.desk-footer')!.prepend(stats);
    this.inspector.querySelector('.desk-footer-actions')!.append(run);
    root.querySelector('.viewport-wrap')!.insertAdjacentHTML('beforeend', `<div class="desk-scene-label"><span>${actions.state().study==='bridge'?'RIVER / STRUCTURAL STUDY':actions.state().study==='plate'?'WORKSHOP / MATERIAL STUDY':'LABORATORY / MEMBRANE STUDY'}</span><strong id="desk-scene-title"></strong><small id="desk-scene-subtitle"></small></div><button class="desk-reopen" aria-label="Show experiment desk">${icon('sliders-horizontal')}<span>Experiment desk</span></button><div class="desk-view-dock" role="group" aria-label="Quick inspection views">${(['hero','oblique','plan','connection'] as const).map((id,i)=>`<button data-desk-camera="${id}" aria-label="${['Overview','Three quarter','Top','Connection'][i]}" aria-pressed="false">${icon(['cube','perspective','grid-four','anchor-simple'][i])}<span>${['Overview','Three quarter','Top','Connection'][i]}</span></button>`).join('')}<button data-desk-review aria-label="Results" aria-pressed="false">${icon('chart-line')}<span>Results</span></button></div>`);
    this.inspector.querySelector<HTMLButtonElement>('[data-desk-hide]')!.onclick=()=>this.toggle(false);
    root.querySelector<HTMLButtonElement>('.desk-reopen')!.onclick=()=>this.toggle(true);
    root.querySelector<HTMLButtonElement>('.mobile-inspector-button')!.onclick=()=>this.toggle(true);
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-tab]').forEach(b=>{
      b.onclick=()=>this.open(b.dataset.deskTab as Panel);
      b.onkeydown=e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const all=[...this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-tab]')],i=all.indexOf(b),next=all[e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4];next.click();next.focus();};
    });
    this.inspector.onkeydown=e=>{if(e.key==='Escape')this.toggle(false);};
    this.inspector.querySelector<HTMLInputElement>('.desk-search input')!.oninput=e=>{this.query=(e.target as HTMLInputElement).value.trim().toLowerCase();this.drawSetups();};
    this.inspector.querySelector<HTMLButtonElement>('[data-desk-clear]')!.onclick=()=>{this.query='';const input=this.inspector.querySelector<HTMLInputElement>('.desk-search input')!;input.value='';this.drawSetups();input.focus();};
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-intent]').forEach(b=>b.onclick=()=>{this.intent=b.dataset.deskIntent!;this.drawSetups();});
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-browse]').forEach(b=>b.onclick=()=>options.browse(b.dataset.deskBrowse as 'setups'));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-light]').forEach(b=>b.onclick=()=>void this.apply(()=>actions.lighting(LIGHTING_PRESETS.find(p=>p.id===b.dataset.deskLight)!),'Lighting applied.'));
    root.querySelectorAll<HTMLButtonElement>('[data-desk-camera]').forEach(b=>b.onclick=()=>void this.apply(()=>actions.camera(b.dataset.deskCamera as 'hero'),'Inspection view applied.'));
    root.querySelector<HTMLButtonElement>('[data-desk-review]')!.onclick=e=>{const on=root.classList.toggle('response-open');(e.currentTarget as HTMLElement).setAttribute('aria-pressed',String(on));options.resized();};
    this.inspector.querySelector<HTMLSelectElement>('#desk-load-recipe')!.onchange=e=>{const p=loadFor(actions.state().study,(e.target as HTMLSelectElement).value);void this.apply(()=>actions.load(p),'New load case prepared. Press Run simulation.');};
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-water-profile]').forEach(b=>b.onclick=()=>{const p=RIVER_PROFILES.find(p=>p.id===b.dataset.waterProfile)!;options.setWater({...options.water(),flow:p.flow,wave:p.wave,foam:p.foam});this.refresh();this.feedback('Water profile applied. Structural load is unchanged.');});
    for(const key of ['flow','wave','foam'] as const){const input=this.inspector.querySelector<HTMLInputElement>(`#river-${key}`);if(input)input.oninput=()=>{options.setWater({...options.water(),[key]:Number(input.value)});this.refresh();};}
    const motion=this.inspector.querySelector<HTMLInputElement>('#river-animate');if(motion)motion.onchange=()=>{options.setWater({...options.water(),animate:motion.checked});this.refresh();};
    const rotate=this.inspector.querySelector<HTMLInputElement>('#desk-rotate')!;rotate.onchange=()=>options.setRotate(rotate.checked);
    this.inspector.querySelector<HTMLButtonElement>('[data-desk-undo]')!.onclick=()=>void this.apply(()=>options.undo(),'Previous appearance restored.');
    this.drawSetups();this.drawFinishes();this.open('setup');
  }
  open(panel:Panel):void {
    this.panel=panel;this.root.dataset.deskPanel=panel;
    this.inspector.querySelectorAll<HTMLElement>('.desk-page').forEach(p=>p.hidden=p.id!==`desk-page-${panel}`);
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-tab]').forEach(b=>{const selected=b.dataset.deskTab===panel;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    this.inspector.querySelector('.desk-scroll')!.scrollTop=0;this.refresh();
  }
  toggle(show:boolean):void {
    this.root.classList.toggle('desk-collapsed',!show);this.root.classList.remove('inspector-open');
    this.root.querySelector('.desk-reopen')!.setAttribute('aria-expanded',String(show));
    requestAnimationFrame(()=>this.options.resized());
    if(show)this.inspector.querySelector<HTMLButtonElement>(`[data-desk-tab="${this.panel}"]`)!.focus();else this.root.querySelector<HTMLButtonElement>('.desk-reopen')!.focus();
  }
  refresh():void {
    const s=this.actions.state(),water=this.options.water();
    this.root.querySelector('.desk-reopen')!.setAttribute('aria-expanded',String(!this.root.classList.contains('desk-collapsed')));
    this.root.querySelector('#desk-scene-title')!.textContent=SCENE_SETUPS.find(p=>p.id===s.setup)?.name??(s.study==='bridge'?'Suspension bridge':s.study==='plate'?'Plate forming study':'Canopy load study');
    this.root.querySelector('#desk-scene-subtitle')!.textContent=`${finishFor(s.study,s.finish).name} · ${LIGHTING_PRESETS.find(p=>p.id===s.lighting)?.name}`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-desk-setup],[data-desk-finish],[data-desk-light],[data-desk-camera]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.deskSetup??b.dataset.deskFinish??b.dataset.deskLight??b.dataset.deskCamera)===(b.dataset.deskSetup?s.setup:b.dataset.deskFinish?s.finish:b.dataset.deskLight?s.lighting:s.camera))));
    this.inspector.querySelector<HTMLSelectElement>('#desk-load-recipe')!.value=s.load;
    const ready=this.root.dataset.renderReady==='true'&&!this.busy;
    this.inspector.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('.desk-page button,.desk-page input,.desk-page select,[data-desk-undo]').forEach(b=>b.disabled=!ready);
    this.inspector.querySelector<HTMLButtonElement>('[data-desk-undo]')!.disabled=!ready||!this.options.canUndo();
    this.inspector.querySelector<HTMLInputElement>('#desk-rotate')!.checked=this.options.rotate();
    if(s.study==='bridge'){
      const profile=riverProfile(water);
      this.inspector.querySelectorAll<HTMLButtonElement>('[data-water-profile]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.waterProfile===profile)));
      this.inspector.querySelector('.desk-water-status')!.textContent=`${RIVER_PROFILES.find(p=>p.id===profile)?.name??'Custom tuning'} · ${water.animate?'Flowing':'Frozen for inspection'}`;
      for(const key of ['flow','wave','foam'] as const){this.inspector.querySelector<HTMLInputElement>(`#river-${key}`)!.value=String(water[key]);this.inspector.querySelector(`#river-${key}-value`)!.textContent=water[key].toFixed(2)+'×';}
      this.inspector.querySelector<HTMLInputElement>('#river-animate')!.checked=water.animate;
    }
  }
  private feedback(message:string):void {this.inspector.querySelector('.desk-feedback')!.textContent=message;}
  private async apply(action:()=>void|Promise<void>,message:string):Promise<void> {
    if(this.busy||this.root.dataset.deskBusy==='true'||this.root.dataset.renderReady!=='true')return;this.busy=true;this.root.dataset.deskBusy='true';this.refresh();this.feedback('Applying to the live scene…');
    try{await action();this.feedback(message);}catch{this.feedback('This choice could not load. Your previous selection is retained.');}
    finally{this.busy=false;this.root.dataset.deskBusy='false';this.refresh();}
  }
  private drawSetups():void {
    const setups=SCENE_SETUPS.filter(p=>p.study===this.actions.state().study),shown=setups.filter(p=>(this.intent==='all'||p.intent.toLowerCase()===this.intent)&&`${p.name} ${p.description} ${p.source}`.toLowerCase().includes(this.query));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-intent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.deskIntent===this.intent)));
    this.inspector.querySelector<HTMLButtonElement>('[data-desk-clear]')!.hidden=!this.query;
    this.inspector.querySelector('.desk-count')!.textContent=`${shown.length} of ${setups.length} complete setups`;
    this.inspector.querySelector('.desk-setups')!.innerHTML=shown.length?shown.map(p=>{const f=finishFor(p.study,p.finish),r=loadFor(p.study,p.load);return `<button class="desk-setup-card" data-desk-setup="${p.id}" aria-label="Apply ${escape(p.name)}" aria-pressed="false"><span class="desk-swatch" style="${this.swatch(f.id)}"></span><span class="desk-setup-copy"><strong>${escape(p.name)}</strong><span>${escape(p.description)}</span><small>${p.intent} <b>·</b> Load ${r.target.toFixed(2)} <b>·</b> ${r.speed}×</small></span>${icon('arrow-up-right')}</button>`;}).join(''):'<p class="desk-empty">No setups match. Clear your search or choose All setups.</p>';
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-setup]').forEach(b=>b.onclick=()=>void this.apply(()=>this.actions.setup(SCENE_SETUPS.find(p=>p.id===b.dataset.deskSetup)!),'Setup ready. Inspect the scene, then press Run simulation.'));
    this.refresh();
  }
  private swatch(id:string):string {const f=finishFor(this.actions.state().study,id);return `background-color:${f.color};background-image:url('${new URL(`${import.meta.env.BASE_URL}studio/materials/${PACKS[f.pack].base}`,document.baseURI).href}')`;}
  private drawFinishes():void {
    this.inspector.querySelector('.desk-finishes')!.innerHTML=FINISH_PRESETS.filter(p=>p.study===this.actions.state().study).map(p=>`<button data-desk-finish="${p.id}" aria-label="Finish: ${escape(p.name)}" aria-pressed="false"><span class="desk-swatch" style="${this.swatch(p.id)}"></span><strong>${escape(p.name)}</strong></button>`).join('');
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-desk-finish]').forEach(b=>b.onclick=()=>void this.apply(()=>this.actions.finish(finishFor(this.actions.state().study,b.dataset.deskFinish)),'Finish applied. Load history is unchanged.'));
  }
}
