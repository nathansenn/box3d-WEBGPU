import {LIQUID_NUMBERS,LIQUID_ENUMS} from './liquid-config';
import './run-library.css';
import {LABS, materialFor, type LabId} from './catalog';
import {RUN_STORAGE_KEY, MAX_SAVED_RUNS, compatibleRuns, comparisonExport, createSavedRun, readRunLibrary, removeRun, storeRun, type RunDraft, type RunStorage, type SavedRun} from './run-library';

interface CurrentRun extends RunDraft {ready:boolean; error:string;}
interface LibraryOptions {study:LabId; current:()=>CurrentRun; pause:()=>void; load:(run:SavedRun)=>void;}
const html=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icon=(name:string)=>`<i class="ph ph-${name}" aria-hidden="true"></i>`;
const number=(n:number)=>n===0?'0.00':Math.abs(n)<.01?n.toPrecision(3):Math.abs(n)>=1000?n.toLocaleString('en',{maximumFractionDigits:1}):n.toFixed(2);
const marker=(index:number)=>`<span class="run-marker run-${index?'b':'a'}">${index?'B':'A'}</span>`;

export class MaterialRunLibrary {
  private root:HTMLElement;
  private panel:HTMLElement;
  private options:LibraryOptions;
  private storage:RunStorage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
  private runs:SavedRun[]=[];
  private selected:string[]=[];
  private metric=1;
  private filter:'current'|'all'='current';
  private deleted:SavedRun|undefined;
  private draftKey='';
  private onStorage=(event:StorageEvent)=>{if(event.key===RUN_STORAGE_KEY||event.key===null) this.read();};

  constructor(root:HTMLElement,options:LibraryOptions) {
    this.root=root;this.options=options;
    this.panel=document.createElement('section');this.panel.className='run-library';this.panel.id='run-library';
    this.panel.setAttribute('aria-label','Run library');this.panel.hidden=true;
    this.panel.innerHTML=`
      <div class="run-library-heading"><div><span class="eyebrow">EXPERIMENT NOTEBOOK</span><h2 tabindex="-1">Keep a result.<br> Change one thing.</h2></div><button data-library="close" aria-label="Close run library">${icon('x')}</button></div>
      <div class="run-library-scroll">
        <form class="run-save-form"><div class="run-current"><span class="material-swatch"></span><div><strong id="run-material"></strong><small id="run-duration">Run an experiment to start</small></div></div><label>Result name<input name="run-name" aria-label="Result name" maxlength="80" autocomplete="off" required></label><button class="primary" type="submit" disabled>${icon('bookmark-simple')}Save result</button></form>
        <div class="run-message" role="status" aria-live="polite"><span></span><button data-library="undo" hidden>Undo removal</button></div>
        <div class="run-section-heading"><h3>Saved runs <span id="run-count">0</span></h3><select aria-label="Filter saved runs"><option value="current">This study</option><option value="all">All studies</option></select></div>
        <div class="saved-run-list"></div>
        <section class="run-comparison" aria-label="Compare results"></section>
        <p class="run-storage-note">${icon('info')}Saved in this browser · up to ${MAX_SAVED_RUNS} results. Export to keep a separate copy.</p>
      </div>`;
    root.querySelector('.material-layout')!.append(this.panel);
    this.panel.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();this.save();});
    this.panel.addEventListener('click',event=>this.click(event));
    this.panel.addEventListener('change',event=>this.change(event));
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();this.close();}});
    window.addEventListener('storage',this.onStorage);
    this.read();this.refresh();
  }
  open():void {
    this.options.pause();this.read();this.panel.hidden=false;this.root.classList.add('run-library-open');
    this.root.querySelector('[data-action="library"]')?.setAttribute('aria-expanded','true');
    this.panel.querySelector<HTMLElement>('h2')!.focus();this.refresh();
  }
  close(restoreFocus=true):void {
    this.panel.hidden=true;this.root.classList.remove('run-library-open');
    const trigger=this.root.querySelector<HTMLButtonElement>('[data-action="library"]');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)trigger?.focus();
  }
  dispose():void {window.removeEventListener('storage',this.onStorage);}
  refresh():void {
    const current=this.options.current(),profile=materialFor(current.study,current.settings.material);
    const key=JSON.stringify([current.settings,current.experiment]);
    if(key!==this.draftKey) {this.draftKey=key;this.panel.querySelector<HTMLInputElement>('[name="run-name"]')!.value=current.name;}
    this.panel.querySelector<HTMLElement>('.run-current .material-swatch')!.style.setProperty('--swatch',profile.color);
    this.panel.querySelector('#run-material')!.textContent=profile.name;
    const time=current.frames.at(-1)?.time??0;
    this.panel.querySelector('#run-duration')!.textContent=time>0?`${time.toFixed(2)} s · ${current.complete?'Completed program':'Partial recording'}`:'Run an experiment to start';
    this.panel.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled=!current.ready||Boolean(current.error)||time<=0;
  }
  private message(text:string,error=false):void {
    this.panel.querySelector('.run-message span')!.textContent=text;
    this.panel.querySelector('.run-message')!.classList.toggle('is-error',error);
    this.panel.querySelector<HTMLButtonElement>('[data-library="undo"]')!.hidden=!this.deleted;
  }
  private read():void {
    const state=readRunLibrary(this.storage);this.runs=state.runs;
    this.selected=this.selected.filter(id=>this.runs.some(r=>r.id===id));
    if(state.warning) this.message(state.warning,true);
    this.renderList();this.renderComparison();
  }
  private save():void {
    const current=this.options.current();if(!current.ready||current.error) return;
    try {
      const run=createSavedRun({...current,name:this.panel.querySelector<HTMLInputElement>('[name="run-name"]')!.value},{id:crypto.randomUUID(),savedAt:new Date().toISOString()});
      const result=storeRun(this.storage,run);
      if(!result.ok){this.message(result.message,true);return;}
      this.runs=result.runs;this.deleted=undefined;
      const a=this.runs.find(r=>r.id===this.selected[0]);this.selected=a&&compatibleRuns(a,run)?[a.id,run.id]:[run.id];
      this.message(`“${run.name}” saved. ${run.complete?'Completed program':'Partial recording'} · ${run.duration.toFixed(2)} s.`);
      this.renderList();this.renderComparison();
    } catch(error) {this.message(error instanceof Error?error.message:'This result could not be saved.',true);}
  }
  private renderList():void {
    const visible=this.runs.filter(run=>this.filter==='all'||run.study===this.options.study);
    this.panel.querySelector('#run-count')!.textContent=String(visible.length);
    this.panel.querySelector('.saved-run-list')!.innerHTML=visible.length?visible.map(run=>{
      const selected=this.selected.indexOf(run.id),profile=materialFor(run.study,run.settings.material);
      return `<article class="saved-run" data-selected="${selected>=0}"><label class="run-select" title="Select result for comparison"><input type="checkbox" data-select-run="${run.id}" aria-label="Compare ${html(run.name)}" ${selected>=0?'checked':''}>${selected>=0?marker(selected):'<span class="run-unselected">+</span>'}</label><div class="saved-run-description"><strong title="${html(run.name)}">${html(run.name)}</strong><small>${html(profile.name)} · ${run.duration.toFixed(2)} s · ${run.complete?'Complete':'Partial'}</small>${this.filter==='all'?`<small>${LABS[run.study].title}</small>`:''}</div><button data-load-run="${run.id}">Load setup</button><button class="run-remove" data-remove-run="${run.id}" aria-label="Remove ${html(run.name)}">${icon('trash')}</button></article>`;
    }).join(''):`<div class="run-empty">${icon('bookmark-simple')}<strong>${this.filter==='current'&&this.runs.length?'No results from this study yet':'Your next discovery belongs here'}</strong><p>Run a preset, save the result, then change a material or setting to compare.</p></div>`;
  }
  private renderComparison():void {
    const runs=this.selected.map(id=>this.runs.find(r=>r.id===id)!).filter(Boolean),a=runs[0],b=runs[1];
    const section=this.panel.querySelector('.run-comparison')!;
    if(!a) {section.innerHTML='<div class="run-section-heading"><h3>Compare results</h3></div><p class="run-compare-hint">Select two saved results from the same study. Their recorded measurements will share a time axis.</p>';return;}
    section.innerHTML=`<div class="run-section-heading"><h3>${b?'Compare results':'Recorded result'}</h3><button data-library="export" class="run-export">${icon('download-simple')}Export ${b?'comparison':'result'}</button></div><div class="run-legends">${runs.map((run,i)=>`<div>${marker(i)}<span><strong>${html(run.name)}</strong><small>${run.duration.toFixed(2)} s · ${run.complete?'Complete':'Partial'}</small></span></div>`).join('')}</div><label class="run-metric-label">Plot<select aria-label="Comparison metric">${a.metricLabels.map((label,i)=>`<option value="${i}" ${i===this.metric?'selected':''}>${html(label)}</option>`).join('')}</select></label><div class="run-chart">${this.chart(runs)}</div>${!b?'<p class="run-compare-hint">Select a second result from this study to compare.</p>':Math.abs(a.duration-b.duration)>.02?'<p class="run-compare-hint">Different recording lengths. Each line ends at its last recorded sample.</p>':''}<div class="run-table-wrap"><table class="run-results-table"><caption>Measurements at each recording’s end</caption><thead><tr><th scope="col">Metric</th><th scope="col">A</th>${b?'<th scope="col">B</th><th scope="col">B − A</th>':''}</tr></thead><tbody>${a.metricLabels.map((label,i)=>`<tr><th scope="row">${html(label)}</th><td>${number(a.final[i])}</td>${b?`<td>${number(b.final[i])}</td><td>${b.final[i]-a.final[i]>=.005?'+':''}${number(b.final[i]-a.final[i])}</td>`:''}</tr>`).join('')}</tbody></table></div>${b?this.settingsComparison(a,b):''}<p class="run-compare-hint">Recorded measurements · comparative models. Loading a setup prepares a fresh specimen.</p>`;
  }
  private chart(runs:SavedRun[]):string {
    const width=540,height=210,left=48,right=12,top=14,bottom=32,metric=this.metric;
    const values=runs.flatMap(r=>r.samples.map(s=>s.metrics[metric]));
    const low=Math.min(0,...values),high=Math.max(...values),span=high-low;
    const ceiling=high+(span||Math.max(1,Math.abs(high)))*.12;
    const duration=Math.max(...runs.map(r=>r.duration));
    const x=(time:number)=>left+time/duration*(width-left-right),y=(v:number)=>height-bottom-(v-low)/(ceiling-low)*(height-top-bottom);
    const grid=Array.from({length:5},(_,i)=>{const value=low+(ceiling-low)*i/4,time=duration*i/4;return `<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-8}" y="${y(value)+3}" text-anchor="end">${number(value)}</text><text x="${x(time)}" y="${height-14}" text-anchor="middle">${time.toFixed(1)}</text>`;}).join('');
    const lines=runs.map((r,i)=>`<path class="run-line run-line-${i?'b':'a'}" d="${r.samples.map((s,j)=>`${j?'L':'M'}${x(s.time).toFixed(2)},${y(s.metrics[metric]).toFixed(2)}`).join(' ')}"/>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${html(runs[0].metricLabels[metric])} over elapsed time for ${runs.map(r=>html(r.name)).join(' and ')}"><title>${html(runs[0].metricLabels[metric])}</title><desc>Teal solid line: A. Orange dashed line: B. Summary values are listed in the table below.</desc><g class="run-grid">${grid}</g>${lines}</svg><span class="run-axis-label">Elapsed time · seconds</span>`;
  }
  private settingsComparison(a:SavedRun,b:SavedRun):string {
    const labels:Record<string,string>={material:'Material',mode:'Program mode',seed:'Specimen seed'};
    for(const control of LABS[a.study].controls) labels[control.key]=`${control.label} · ${control.unit}`;
    if(a.study==='liquid'){Object.assign(labels,{rig:'Apparatus',surface:'Surface material',pipe:'Pipe attachment',storm:'Rain program',terrain:'Surface shape',supply:'Supply program',fill:'Initial fill / film (setup units)'});for(const c of LIQUID_NUMBERS)labels[c.key]=`${c.label} · ${c.unit}`;}
    const keys=Object.keys(labels) as (keyof typeof a.settings)[],different=keys.filter(k=>a.settings[k]!==b.settings[k]);
    const value=(run:SavedRun,key:keyof typeof a.settings)=>key==='material'?materialFor(run.study,run.settings.material).name:run.study==='liquid'&&key in LIQUID_ENUMS?LIQUID_ENUMS[key as keyof typeof LIQUID_ENUMS].find(v=>v.id===run.settings[key])?.name??String(run.settings[key]):String(run.settings[key]);
    const events=(run:SavedRun)=>run.events.length?run.events.map(e=>`Release at ${e.time.toFixed(2)} s`).join(', '):'No manual release';
    const eventDifference=JSON.stringify(a.events)!==JSON.stringify(b.events);
    return `<details class="run-settings"><summary>Compare setup · ${different.length+(eventDifference?1:0)} differences</summary>${different.length||eventDifference?`<div class="run-table-wrap"><table><thead><tr><th scope="col">Setting</th><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody>${different.map(key=>`<tr><th scope="row">${html(labels[key])}</th><td>${html(value(a,key))}</td><td>${html(value(b,key))}</td></tr>`).join('')}${eventDifference?`<tr><th scope="row">Manual actions</th><td>${html(events(a))}</td><td>${html(events(b))}</td></tr>`:''}</tbody></table></div>`:'<p>Matching settings and manual actions. Recording lengths may still differ.</p>'}</details>`;
  }
  private click(event:MouseEvent):void {
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button) return;
    if(button.dataset.loadRun){const run=this.runs.find(r=>r.id===button.dataset.loadRun);if(run){this.close();this.options.load(run);}return;}
    if(button.dataset.removeRun){const run=this.runs.find(r=>r.id===button.dataset.removeRun);if(!run)return;const result=removeRun(this.storage,run.id);if(!result.ok){this.message(result.message,true);return;}this.deleted=run;this.message(`“${run.name}” removed.`);this.read();return;}
    switch(button.dataset.library){
      case 'close':this.close();break;
      case 'undo':if(this.deleted){const result=storeRun(this.storage,this.deleted);if(result.ok){this.deleted=undefined;this.message('Result restored.');this.read();}else this.message(result.message,true);}break;
      case 'export':{
        const runs=this.selected.map(id=>this.runs.find(r=>r.id===id)!).filter(Boolean);if(!runs.length)return;
        const data=runs.length===2?comparisonExport(runs):{format:'box3d-material-result-v1',calibrated:false,run:runs[0]};
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');
        link.href=url;link.download=`box3d-${runs[0].study}-${runs.length===2?'comparison':'result'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message(`${runs.length===2?'Comparison':'Result'} export prepared.`);break;
      }
    }
  }
  private change(event:Event):void {
    const input=event.target as HTMLInputElement;
    if(input.dataset.selectRun){
      const id=input.dataset.selectRun,run=this.runs.find(r=>r.id===id)!;
      if(!input.checked)this.selected=this.selected.filter(key=>key!==id);
      else {const first=this.runs.find(r=>r.id===this.selected[0]);if(first&&!compatibleRuns(first,run)){this.selected=[id];this.message('Comparison switched to this study. Choose another result from the same study.');}else {this.selected=this.selected.length>=2?[this.selected[0],id]:[...this.selected,id];this.message(this.selected.length===2?'A and B are ready to compare.':'Choose a second result from this study.');}}
      this.renderList();this.renderComparison();this.panel.querySelector<HTMLInputElement>(`[data-select-run="${id}"]`)?.focus();
    }else if(input.getAttribute('aria-label')==='Filter saved runs'){this.filter=input.value as typeof this.filter;this.renderList();}
    else if(input.getAttribute('aria-label')==='Comparison metric'){this.metric=Number(input.value);this.renderComparison();this.panel.querySelector<HTMLElement>('[aria-label="Comparison metric"]')?.focus();}
  }
}
