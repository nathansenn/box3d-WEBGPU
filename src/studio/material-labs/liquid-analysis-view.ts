import './liquid-analysis.css';
import {materialFor,type LabSettings} from './catalog';
import {liquidSettings,LIQUID_RIGS} from './liquid-config';
import {METRIC_LABELS,LiquidModel,type LabFrame} from './models';
import {createSavedRun,storeRun} from './run-library';
import {LiquidNotebook} from './liquid-notebook-view';
import {createReport,type LiquidReport} from './liquid-report';
import {PROBE_NAMES,measureSection,recordedSamples,measurementCsv,studyParameters,suggestedValues,studyCases,type SectionReading,type StudyParameter,type StudyResult,type StudyMessage} from './liquid-analysis';

interface Context {model:LiquidModel;settings:LabSettings;frame:LabFrame;history:LabFrame[];ready:boolean;}
interface Options {current:()=>Context;pause:()=>void;load:(p:LabSettings)=>void;section:(distance:number,visible:boolean)=>void;}
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const colors=['#087f89','#bd671d','#7860ac'];
const num=(v:number,d=2)=>Number(v.toFixed(d)).toString();
function download(data:string,type:string,name:string):void {const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function sectionChart(s:SectionReading):string {
  const bottom=Math.min(...s.cells.map(c=>c.bed)),top=Math.max(bottom+.02,...s.cells.map(c=>c.bed+c.depth)),range=(top-bottom)*1.12;
  const x=(z:number)=>32+(z+1)/2*276,y=(v:number)=>119-(v-bottom)/range*92,points=s.cells.map(c=>`${x(c.z)},${y(c.bed)}`).join(' ');
  return `<svg viewBox="0 0 330 157" role="img" aria-label="Cross-section bed elevation and water depth, with probes A, B and C"><path d="M32 20V119H312" class="chart-axis"/><text x="2" y="27">${num(bottom+range,2)}</text><text x="2" y="121">${num(bottom,2)}</text><polygon points="${x(s.cells[0].z)},119 ${points} ${x(s.cells.at(-1)!.z)},119" fill="#bbb9a9"/>${s.cells.map(c=>c.blocked?`<rect x="${x(c.z)-4.9}" y="24" width="9.8" height="95" fill="#747d76" opacity=".55"/>`:c.depth>.00005?`<rect x="${x(c.z)-4.9}" y="${y(c.bed+c.depth)}" width="9.9" height="${c.depth/range*92}" fill="#37b9bf" opacity=".45"/><path d="M${x(c.z)-4.9} ${y(c.bed+c.depth)}h9.9" stroke="#08828e"/>`:'').join('')}<polyline points="${points}" fill="none" stroke="#817f6c"/>${s.probes.map((c,i)=>`<path d="M${x(c.z)} 29V${y(c.bed+c.depth)}" stroke="${colors[i]}" stroke-dasharray="2 3"/><circle cx="${x(c.z)}" cy="${y(c.bed+c.depth)}" r="3" fill="${colors[i]}"/><text x="${x(c.z)}" y="20" text-anchor="middle" fill="${colors[i]}">${PROBE_NAMES[i]}</text>`).join('')}<text x="32" y="136">−1 m</text><text x="170" y="136" text-anchor="middle">0</text><text x="309" y="136" text-anchor="end">+1 m</text><text x="170" y="152" text-anchor="middle">Across the bed · elevation in metres</text></svg>`;
}
type Plot='volume'|'flow'|'depth'|'flood';
export class LiquidAnalysisWorkspace {
  private notebook:LiquidNotebook;private report?:LiquidReport;
  private mountLifetime=new AbortController();
  private host?:HTMLElement;private worker?:Worker;private distance=3;private parameter?:StudyParameter;private resultParameter?:StudyParameter;
  private results:StudyResult[]=[];private status='';private active=false;private progress=0;private plot:Plot='volume';private source='';private saved=new Set<number>();
  constructor(private options:Options){this.notebook=new LiquidNotebook({current:()=>this.report,pause:options.pause,load:options.load,restore:r=>{this.worker?.terminate();this.worker=undefined;this.active=false;this.report=r;this.results=[...r.results];this.resultParameter=r.parameter;this.source=r.source;this.saved.clear();this.status='Notebook comparison restored · live scene unchanged';this.renderResults();this.state();}});}
  mount(host:HTMLElement):void {
    this.mountLifetime.abort();this.mountLifetime=new AbortController();this.host=host;const {settings}=this.options.current(),parameters=studyParameters(settings);
    this.parameter=parameters.find(p=>p.key===this.parameter?.key)??parameters[0];
    host.innerHTML=`<div class="analysis-intro"><span class="eyebrow">MEASURE / COMPARE / EXPORT</span><h2>Analyze the flow</h2><p>Inspect a section. Change one input. Compare measured results.</p></div><section class="analysis-card"><div class="section-label"><h2>Measurement section</h2><output data-section-position></output></div><label class="section-position"><span class="sr-only">Distance from inlet</span><input data-analysis-section aria-label="Distance from inlet" type="range" min="0" max="6" step=".01" value="${this.distance}"><span><small>Inlet · 0 m</small><small>Outlet · 6 m</small></span></label><div class="section-probes" data-section-probes></div><div class="section-flow"><span>Through-flow</span><strong data-section-flow></strong></div><div data-section-chart class="analysis-chart"></div><p class="analysis-hint">Cell-centre readings at the cyan section. Negative flow travels upstream. Gray columns mark solid obstacles.</p><button class="analysis-link" data-analysis-export>Export recorded CSV <i class="ph ph-download-simple" aria-hidden="true"></i></button></section><section class="analysis-card"><div class="section-label"><h2>What changes the flow?</h2><span>3 cases</span></div><form data-study-form><label class="liquid-select">Change one input<select aria-label="Comparison parameter" data-study-parameter>${parameters.map(p=>`<option value="${p.key}" ${p.key===this.parameter!.key?'selected':''}>${p.label} (${p.unit})</option>`).join('')}</select></label><div class="study-values" data-study-values></div><p class="analysis-hint" data-study-description></p><div class="study-actions"><button type="submit" class="primary" data-study-start>Compare 3 runs <i class="ph ph-chart-line" aria-hidden="true"></i></button><button type="button" data-study-cancel ${this.active?'':'hidden'}>Cancel</button></div></form><progress class="study-progress" aria-label="Comparison progress" max="1" value="${this.progress}" ${this.active?'':'hidden'}></progress><p class="study-status" data-study-status role="status" aria-live="polite"></p><div data-study-results></div></section><p class="analysis-hint">Each case starts fresh with the same seed and all other inputs held fixed. Uses the same comparative flow model as the live scene.</p>`;
    host.querySelector('.analysis-intro')!.insertAdjacentHTML('afterend','<button class="analysis-notebook-button" data-open-notebook><span><i class="ph ph-notebook" aria-hidden="true"></i> Experiment notebook</span><i class="ph ph-arrow-up-right" aria-hidden="true"></i></button>');
    this.values();this.renderResults();this.state();this.update(this.options.current().frame);
    host.querySelector<HTMLInputElement>('[data-analysis-section]')!.addEventListener('input',e=>{this.distance=Number((e.target as HTMLInputElement).value);this.update(this.options.current().frame);});
    host.querySelector<HTMLSelectElement>('[data-study-parameter]')!.addEventListener('change',e=>{this.parameter=parameters.find(p=>p.key===(e.target as HTMLSelectElement).value)!;this.values();});
    host.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();this.start();});
    host.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
      if(b.hasAttribute('data-study-cancel'))this.cancel();
      if(b.hasAttribute('data-open-notebook'))this.notebook.open();
      if(b.hasAttribute('data-analysis-export'))this.exportRecording();
      if(b.hasAttribute('data-study-csv'))download(measurementCsv(this.results,this.resultParameter),'text/csv','box3d-liquid-comparison.csv');
      if(b.hasAttribute('data-study-json'))download(JSON.stringify({format:'box3d-liquid-comparison-v1',calibrated:false,source:this.source,parameter:this.resultParameter,complete:this.results.length===3,results:this.results},null,2),'application/json','box3d-liquid-comparison.json');
      if(b.dataset.studyLoad!==undefined){const r=this.results.find(r=>r.index===Number(b.dataset.studyLoad));if(r){this.options.load(r.settings);this.status=`Case ${r.index+1} loaded as a fresh experiment.`;this.state();}}
      if(b.dataset.studySave!==undefined)this.save(Number(b.dataset.studySave));
    },{signal:this.mountLifetime.signal});
  }
  unmount():void {this.mountLifetime.abort();this.host=undefined;this.options.section(this.distance,false);}
  private values():void {
    if(!this.host||!this.parameter)return;const p=this.parameter,values=suggestedValues(this.options.current().settings,p),c=liquidSettings(this.options.current().settings);
    this.host.querySelector('[data-study-values]')!.innerHTML=values.map((v,i)=>`<label style="--case-color:${colors[i]}"><span>Case ${i+1} <small>${p.unit}</small></span><input aria-label="Case ${i+1} value" data-study-value type="number" min="${p.min}" max="${p.max}" step="any" value="${v}" required></label>`).join('');
    this.host.querySelector('[data-study-description]')!.textContent=`${c.runSeconds} s per case · ${c.cutoff>0&&c.rig!=='flume'?`supply ends at ${c.cutoff} s`:'full program'} · recorded at the current section. Runs locally in the background.`;
    this.state();
  }
  update(frame:LabFrame):void {
    const host=this.host;if(!host?.isConnected)return;const current=this.options.current(),s=measureSection(current.model,frame,this.distance);
    host.querySelector('[data-section-position]')!.textContent=num(s.distance)+' m from inlet';
    host.querySelector('[data-section-flow]')!.textContent=num(s.flow*1000)+' L/s';
    host.querySelector('[data-section-probes]')!.innerHTML=s.probes.map((p,i)=>`<div style="--case-color:${colors[i]}"><span><b>${PROBE_NAMES[i]}</b><small>z ${num(p.z,3)} m</small></span><strong>${p.blocked?'Solid':num(p.depth*1000,2)+' <em>mm</em>'}</strong><small>${p.blocked?'No flow cell':num(p.speed,3)+' m/s'}${!p.blocked&&p.depth<=.00005?' · Dry':''}</small></div>`).join('');
    host.querySelector('[data-section-chart]')!.innerHTML=sectionChart(s);this.options.section(s.distance,true);
    host.dataset.section=String(s.distance);host.dataset.sectionFlow=String(s.flow);host.dataset.measurementTime=String(frame.time);
    (host.querySelector('[data-analysis-export]') as HTMLButtonElement).disabled=current.history.length<2;
    const start=host.querySelector<HTMLButtonElement>('[data-study-start]');if(start)start.disabled=this.active||!current.ready;
  }
  private state():void {
    const host=this.host;if(!host?.isConnected)return;host.dataset.studyState=this.active?'running':this.results.length===3?'complete':this.status.startsWith('Canceled')?'canceled':'idle';host.dataset.studyCases=String(this.results.length);
    host.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-study-form] input,[data-study-form] select').forEach(e=>e.disabled=this.active);
    host.querySelector<HTMLButtonElement>('[data-study-start]')!.disabled=this.active||!this.options.current().ready;
    host.querySelector<HTMLElement>('[data-study-cancel]')!.hidden=!this.active;
    const progress=host.querySelector<HTMLProgressElement>('progress')!;progress.hidden=!this.active;progress.value=this.progress;
    host.querySelector('[data-study-status]')!.textContent=this.status;
  }
  private start():void {
    if(this.active||!this.host||!this.parameter||!this.options.current().ready)return;
    try {
      const current=this.options.current(),values=Array.from(this.host.querySelectorAll<HTMLInputElement>('[data-study-value]')).map(e=>e.value===''?NaN:Number(e.value)),cases=studyCases(current.settings,this.parameter,values);
      this.options.pause();this.results=[];this.report=undefined;this.saved.clear();this.resultParameter={...this.parameter};this.active=true;this.progress=0;
      const c=liquidSettings(current.settings),section=measureSection(current.model,current.frame,this.distance).distance;
      this.source=`${LIQUID_RIGS.find(r=>r.id===c.rig)!.name} · ${materialFor('liquid',current.settings.material).name} · ${c.runSeconds} s · section ${num(section)} m`;
      this.status='Starting case 1 of 3…';this.renderResults();this.state();
      const worker=new Worker(new URL('./liquid-study-worker.ts',import.meta.url),{type:'module'});this.worker=worker;
      worker.onmessage=(event:MessageEvent<StudyMessage>)=>{if(worker!==this.worker)return;const m=event.data;
        if(m.type==='progress'){this.progress=(m.index+m.time/m.duration)/3;this.status=`Case ${m.index+1} of 3 · ${num(m.time,1)} / ${m.duration} s`;}
        if(m.type==='result'){try{this.results.push(m.result);this.report=createReport(this.results,this.resultParameter!,this.source);this.renderResults();}catch(error){this.fail(error instanceof Error?error.message:'Comparison output could not be validated.');}}
        if(m.type==='complete'){this.active=false;this.progress=1;this.status='Comparison complete · 3 measured runs';worker.terminate();this.worker=undefined;}
        if(m.type==='error')this.fail(m.message);
        this.state();
      };
      worker.onerror=e=>{if(worker===this.worker){e.preventDefault();this.fail(e.message||'The comparison worker could not start.');}};
      worker.postMessage({cases,key:this.parameter.key,section});
    }catch(error){this.fail(error instanceof Error?error.message:'Unable to start comparison.');}
  }
  private fail(message:string):void {this.worker?.terminate();this.worker=undefined;this.active=false;this.status=message;this.state();}
  cancel():void {this.worker?.terminate();this.worker=undefined;this.active=false;this.status=`Canceled · ${this.results.length} completed case${this.results.length===1?'':'s'} retained`;this.state();}
  private renderResults():void {
    if(!this.host)return;const host=this.host.querySelector<HTMLElement>('[data-study-results]')!;
    if(!this.results.length){host.innerHTML='';return;}
    host.innerHTML=`<div class="study-result-heading"><span class="eyebrow">MEASURED COMPARISON</span><p>${esc(this.source)}</p></div><label class="liquid-select">Compare recorded curves<select aria-label="Comparison chart" data-study-plot>${[['volume','Water in the bed · L'],['flow','Section through-flow · L/s'],['depth','Probe B depth · mm'],['flood','Wet floodplain · m²']].filter(([k])=>k!=='flood'||this.results[0].settings.rig==='river').map(([k,n])=>`<option value="${k}" ${k===this.plot?'selected':''}>${n}</option>`).join('')}</select></label><div class="analysis-chart" data-study-chart></div><div class="study-result-list">${this.results.map(r=>`<article style="--case-color:${colors[r.index]}"><div class="study-case-title"><strong>Case ${r.index+1} <span>${num(r.value,4)} ${this.resultParameter!.unit}</span></strong><small>${esc(this.resultParameter!.label)}</small></div><dl><div><dt>Max depth</dt><dd>${num(r.peak.depth*1000,1)} mm</dd></div><div><dt>Collected + overflow</dt><dd>${num(r.samples.at(-1)!.hydraulics.drained*1000,1)} L</dd></div><div><dt>Final coverage</dt><dd>${num(r.samples.at(-1)!.hydraulics.coverage,1)}%</dd></div></dl><div class="study-case-actions"><button data-study-load="${r.index}" aria-label="Load case ${r.index+1} setup">Load setup</button><button data-study-save="${r.index}" aria-label="Save case ${r.index+1} to run library" ${this.saved.has(r.index)?'disabled':''}>${this.saved.has(r.index)?'Saved':'Save to library'}</button></div></article>`).join('')}</div><div class="study-export"><button class="analysis-link" data-study-csv>Export CSV</button><button class="analysis-link" data-study-json>Export report JSON</button></div><p class="analysis-hint">Maxima include every solver tick. Curves sample the run at up to 10 Hz. Loading a setup creates a fresh run; Save keeps its measured trace in the Run library.</p>`;
    const select=host.querySelector<HTMLSelectElement>('[data-study-plot]')!;
    if(!Array.from(select.options).some(o=>o.value===this.plot)){this.plot='volume';select.value=this.plot;}
    select.addEventListener('change',()=>{this.plot=select.value as Plot;this.drawResults();});this.drawResults();
  }
  private drawResults():void {
    if(!this.host||!this.results.length)return;
    const value=(r:StudyResult,s:StudyResult['samples'][number]):number|null=>this.plot==='volume'?s.metrics[2]*1000:this.plot==='flow'?s.flow*1000:this.plot==='flood'?s.hydraulics.floodArea:s.probes[1].blocked?null:s.probes[1].depth*1000;
    const values=this.results.flatMap(r=>r.samples.map(s=>value(r,s))).filter((v):v is number=>v!==null),min=Math.min(0,...values),max=Math.max(min+.001,...values),duration=Math.max(...this.results.map(r=>r.samples.at(-1)!.time)),y=(v:number)=>113-(v-min)/(max-min)*91;
    this.host.querySelector('[data-study-chart]')!.innerHTML=`<svg viewBox="0 0 330 150" role="img" aria-label="Recorded ${this.plot} compared over time"><path d="M36 16V113H311" class="chart-axis"/><path d="M36 ${y(0)}H311" class="chart-grid"/><text x="1" y="22">${num(max,2)}</text><text x="1" y="114">${num(min,2)}</text>${this.results.map(r=>{let drawing=false;const d=r.samples.map(s=>{const v=value(r,s);if(v===null){drawing=false;return '';}const part=`${drawing?'L':'M'}${36+s.time/duration*273},${y(v)}`;drawing=true;return part;}).join(' ');return `<path d="${d}" fill="none" stroke="${colors[r.index]}" stroke-width="2"/>`;}).join('')}<text x="36" y="132">0 s</text><text x="309" y="132" text-anchor="end">${num(duration)} s</text><text x="170" y="146" text-anchor="middle">Elapsed simulation time</text></svg><div class="study-legend">${this.results.map(r=>`<span style="--case-color:${colors[r.index]}">Case ${r.index+1} · ${num(r.value,4)} ${this.resultParameter!.unit}</span>`).join('')}</div>`;
  }
  private exportRecording():void {
    const c=this.options.current(),section=measureSection(c.model,c.frame,this.distance),samples=recordedSamples(c.model,[...c.history,c.model.frame],this.distance);
    if(samples.length<2)return;download(measurementCsv([{index:0,settings:c.settings,section:section.distance,samples}]),'text/csv','box3d-liquid-section.csv');this.status=`Exported ${samples.length} recorded measurements at ${num(section.distance)} m.`;this.state();
  }
  private save(index:number):void {
    const r=this.results.find(v=>v.index===index);if(!r)return;
    try {const name=`${this.resultParameter!.label} ${num(r.value,4)} ${this.resultParameter!.unit} · ${materialFor('liquid',r.settings.material).name}`;
      const run=createSavedRun({study:'liquid',name,experiment:'',settings:r.settings,metricLabels:METRIC_LABELS.liquid,complete:true,phase:r.phase,events:[],frames:r.samples},{id:crypto.randomUUID(),savedAt:new Date().toISOString()});
      const saved=storeRun(localStorage,run);if(!saved.ok)throw new Error(saved.message);this.saved.add(index);this.status=`Case ${index+1} saved to the Run library.`;this.renderResults();this.state();
    }catch(error){this.status=error instanceof Error?error.message:'Could not save this case.';this.state();}
  }
  dispose():void {this.notebook.dispose();this.mountLifetime.abort();this.worker?.terminate();this.worker=undefined;this.host=undefined;}
}
