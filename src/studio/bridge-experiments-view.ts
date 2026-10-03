import { bridgeModelKey, type BridgeBaseline, type BridgeControls, type BridgeModel } from './bridge-review';
import { BRIDGE_EXPERIMENTS_KEY, EXPERIMENT_CASE_COUNTS, EXPERIMENT_DURATIONS, EXPERIMENT_METRICS, EXPERIMENT_PLANS, EXPERIMENT_PRESETS, experimentBaseline, experimentCaseLabel, experimentComparison, experimentCSV, experimentExport, experimentFollowUp, experimentOverview, experimentPeak, experimentPlan, experimentProbeTargets, experimentRange, experimentSample, experimentSamplesCSV, experimentSummary, experimentTransitions, experimentValue, interruptedExperiments, makeExperimentBatch, parseBridgeExperiments, runBridgeExperiments, type BridgeExperimentBatch, type BridgeExperimentCase, type ExperimentDuration, type ExperimentMetric, type ExperimentPlanId } from './bridge-experiments';
import './bridge-experiments.css';

interface Actions {
  state: () => { model:BridgeModel; settings:BridgeControls; ready:boolean; running:boolean };
  load: (settings:BridgeControls) => void;
  baseline: (baseline:BridgeBaseline) => boolean;
  download: (name:string,blob:Blob) => void;
  notify: (message:string) => void;
}
const colors=['#70a5ee','#62c8b9','#d6ca79','#efa66c','#e58082','#b39bf2','#8ec478','#e39bc5','#81cde2'];
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const f=(n:number)=>n.toFixed(3);

export class BridgeExperimentsView {
  private batch?:BridgeExperimentBatch;
  private plan:ExperimentPlanId='load';
  private duration:ExperimentDuration=30;
  private preset='load-overview';
  private rangeStart='0.2';
  private rangeEnd='5';
  private caseCount=5;
  private fixed?:BridgeControls;
  private selected=-1;
  private reference=-1;
  private presentation:'table'|'chart'=matchMedia('(max-width:800px), (max-height:830px)').matches?'table':'chart';
  private isolate=false;
  private metric:ExperimentMetric='drop';
  private probe:number|null=null;
  private probeOpen=false;
  private controller?:AbortController;
  private disposed=false;
  private lastRender=0;
  private completedCount=-1;
  private availability='';
  private fixedMarkup='';
  private updateStamp='';
  private modelKey:string;

  constructor(private host:HTMLElement, private actions:Actions) {
    this.modelKey=bridgeModelKey(actions.state().model);
    let storage='One scan stays in this browser. Export results before replacing it.';
    try {
      const raw=localStorage.getItem(BRIDGE_EXPERIMENTS_KEY);
      this.batch=parseBridgeExperiments(raw,this.modelKey);
      if (raw && !this.batch) storage='An incompatible or damaged scan was ignored.';
      if (this.batch) {
        this.plan=this.batch.plan; this.duration=this.batch.duration;
        this.preset=this.batch.version===1?`${this.plan}-overview`:this.batch.design!.preset??'custom';
        const axis=experimentPlan(this.plan).axis;
        this.rangeStart=String(this.batch.cases[0].settings[axis]);this.rangeEnd=String(this.batch.cases.at(-1)!.settings[axis]);this.caseCount=this.batch.cases.length;
        this.fixed={...this.batch.base};storage='Saved scan restored with its fixed settings. Export before replacing it.';
      }
    } catch { storage='Browser storage is unavailable. Export results to keep them.'; }
    host.classList.add('bridge-experiments');
    host.innerHTML=`<header class="bx-heading"><span class="bx-eyebrow">CONTROLLED EXPERIMENTS</span><h3>Design the next experiment.</h3><p>Choose a question. Control the conditions. Compare the response.</p></header>
      <details class="bx-config" ${this.batch?'':'open'}><summary><span><i class="ph ph-sliders-horizontal" aria-hidden="true"></i><b>Scan setup</b><small class="bx-config-summary"></small></span><span class="bx-config-hint">Edit <i class="ph ph-caret-down" aria-hidden="true"></i></span></summary><div class="bx-config-body">
      <div class="bx-plans" role="group" aria-label="Experiment scan">${EXPERIMENT_PLANS.map(p=>`<button data-bx-plan="${p.id}" aria-pressed="false"><i class="ph ph-${p.id==='load'?'list-numbers':p.id==='strength'?'chart-bar':'wind'}" aria-hidden="true"></i>${p.label}</button>`).join('')}</div>
      <label class="bx-preset-label" for="bx-preset">Study preset <span>10 starting points</span></label><select id="bx-preset">${EXPERIMENT_PLANS.map(plan=>`<optgroup label="${plan.label}">${EXPERIMENT_PRESETS.filter(p=>p.plan===plan.id).map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`).join('')}<option value="custom">Custom range</option></select><p class="bx-preset-note"></p>
      <div class="bx-range" role="group" aria-label="Experiment range"><label for="bx-range-start">From<input id="bx-range-start" type="number" inputmode="decimal" step="0.0001" aria-describedby="bx-range-note bx-setup-error"></label><label for="bx-range-end">To<input id="bx-range-end" type="number" inputmode="decimal" step="0.0001" aria-describedby="bx-range-note bx-setup-error"></label><label for="bx-case-count">Cases<select id="bx-case-count">${EXPERIMENT_CASE_COUNTS.map(n=>`<option value="${n}">${n} cases</option>`).join('')}</select></label></div><p class="bx-range-note" id="bx-range-note"></p>
      <div class="bx-setup"><fieldset><legend>Duration / model seconds</legend><div class="bx-durations">${EXPERIMENT_DURATIONS.map(d=>`<button data-bx-duration="${d}" aria-pressed="false">${d} s</button>`).join('')}</div></fieldset><p class="bx-fixed"></p></div>
      <details class="bx-held"><summary>Edit held settings <span class="bx-held-source"></span></summary><div class="bx-held-controls">${EXPERIMENT_PLANS.map(p=>`<label data-bx-fixed-label="${p.axis}" for="bx-fixed-${p.axis}">${p.id==='load'?'Load':p.id==='strength'?'Strength ×':'Crosswind'}<input id="bx-fixed-${p.axis}" data-bx-fixed="${p.axis}" type="number" inputmode="decimal" min="${p.min}" max="${p.max}" step="0.0001" aria-describedby="bx-setup-error"></label>`).join('')}</div><button data-bx-live-settings>Use live scene settings</button><p>These settings are held constant across every case. Editing them here leaves the live scene unchanged.</p></details>
      <p id="bx-setup-error" class="bx-setup-error" role="alert" hidden></p>
      <p class="bx-values"></p></div></details>
      <div class="bx-run-row"><button data-bx-run><i class="ph ph-play" aria-hidden="true"></i><span>Run 5 experiments</span></button><button data-bx-cancel hidden><i class="ph ph-stop" aria-hidden="true"></i>Cancel scan</button></div>
      <div class="bx-progress" hidden><progress max="100" value="0" aria-label="Experiment progress"></progress></div><p class="bx-status" role="status" aria-live="polite"></p>
      <div class="bx-overview" hidden></div>
      <section class="bx-results" aria-label="Experiment results"><div class="bx-results-heading"><h4 class="bx-sr">Compare responses</h4><div class="bx-display-modes" role="group" aria-label="Results presentation"><button data-bx-display="table" aria-pressed="false"><i class="ph ph-table" aria-hidden="true"></i>Table</button><button data-bx-display="chart" aria-pressed="false"><i class="ph ph-chart-line" aria-hidden="true"></i>Chart</button></div><div class="bx-chart-tools"><button data-bx-probe-toggle aria-expanded="false" aria-controls="bx-time-probe">Time probe</button><button data-bx-isolate aria-pressed="false" title="Rescale the chart to only the selected case">Selected only</button></div></div><p class="bx-result-meta"></p>
      <div class="bx-chart-modes" role="group" aria-label="Response measurement">${EXPERIMENT_METRICS.map(m=>`<button data-bx-metric="${m.id}" aria-pressed="${m.id===this.metric}">${m.label}</button>`).join('')}</div>
      <div class="bx-plot"></div>
      <div class="bx-probe" id="bx-time-probe" hidden><div class="bx-probe-caption"><div class="bx-exact-time"><label for="bx-probe-value">Compare at</label><input id="bx-probe-value" type="number" min="0" max="30" step="0.1" inputmode="decimal" placeholder="—" aria-label="Exact probe time in model seconds"><span>s</span><output class="bx-sr" for="bx-probe-time bx-probe-value">0.0 s</output></div><button data-bx-peaks aria-pressed="true">Show peaks</button></div><input id="bx-probe-time" type="range" min="0" max="30" step="0.1" value="0" aria-label="Compare experiments at model time"><span class="bx-probe-note">Move the probe to read all cases at one instant.</span></div>
      <p class="bx-table-intro"></p><div class="bx-case-heading" hidden><span>Case / full-record outcome</span><span class="bx-value-heading">Peak drop</span></div><div class="bx-cases"></div><div class="bx-selection" id="bx-selection"></div><section class="bx-followups" aria-label="Follow-up experiments" hidden></section></section>
      <div class="bx-export"><button data-bx-csv title="One summary row per case">Summary CSV</button><button data-bx-samples title="Every recorded 0.1 second sample">Samples CSV</button><button data-bx-json>JSON</button><button data-bx-clear>Clear scan</button></div>
      <p class="bx-storage" role="status">${storage}</p>
      <details class="bx-method"><summary>How these experiments work</summary><p>Every case starts with an intact bridge. Only the selected variable changes; the remaining loads are frozen when you start. Target load follows the existing solver ramp. Playback speed does not change these runs.</p><p>Results use a 120 Hz fixed step and samples every 0.10 model seconds. Peak values are the largest recorded samples; first rupture uses the solver event time. The probe reads actual samples with no interpolation. A partial record has no readings after its last sample.</p><p>Sideways movement is the largest absolute deck displacement across the span. Lost links are cumulative. Loading a case restores its settings so you can run and inspect the geometry.</p><p>Authored comparative model · uncalibrated units and failure thresholds. River appearance does not apply forces. “No rupture observed” describes only the recorded interval.</p></details>`;
    host.querySelectorAll<HTMLButtonElement>('[data-bx-plan]').forEach(b=>b.onclick=()=>{if(this.controller)return;this.choosePreset(`${b.dataset.bxPlan}-overview`);});
    host.querySelector<HTMLSelectElement>('#bx-preset')!.onchange=event=>{if(this.controller)return;this.choosePreset((event.target as HTMLSelectElement).value);};
    const editRange=()=>{if(this.controller)return;this.preset='custom';this.rangeStart=host.querySelector<HTMLInputElement>('#bx-range-start')!.value;this.rangeEnd=host.querySelector<HTMLInputElement>('#bx-range-end')!.value;this.caseCount=Number(host.querySelector<HTMLSelectElement>('#bx-case-count')!.value);this.update();};
    host.querySelector<HTMLInputElement>('#bx-range-start')!.oninput=editRange;
    host.querySelector<HTMLInputElement>('#bx-range-end')!.oninput=editRange;
    host.querySelector<HTMLSelectElement>('#bx-case-count')!.onchange=editRange;
    host.querySelectorAll<HTMLInputElement>('[data-bx-fixed]').forEach(input=>input.oninput=()=>{if(this.controller)return;this.fixed={...(this.fixed??this.actions.state().settings),[input.dataset.bxFixed!]:input.valueAsNumber};this.update();});
    host.querySelector<HTMLButtonElement>('[data-bx-live-settings]')!.onclick=()=>{if(this.controller)return;this.fixed=undefined;this.update();};
    host.querySelectorAll<HTMLButtonElement>('[data-bx-duration]').forEach(b=>b.onclick=()=>{if(this.controller)return;this.duration=Number(b.dataset.bxDuration) as ExperimentDuration;this.update();if(!this.batch)this.drawResults();});
    host.querySelector<HTMLButtonElement>('[data-bx-run]')!.onclick=()=>void this.run();
    host.querySelector<HTMLButtonElement>('[data-bx-cancel]')!.onclick=()=>{this.controller?.abort();this.status('Cancelling scan… recorded samples will be retained.');};
    host.querySelector<HTMLButtonElement>('[data-bx-isolate]')!.onclick=()=>{this.isolate=!this.isolate;if(this.selected<0)this.selected=this.batch?.cases.find(c=>c.points.length>1)?.index??0;this.drawResults();};
    host.querySelectorAll<HTMLButtonElement>('[data-bx-display]').forEach(button=>button.onclick=()=>{this.presentation=button.dataset.bxDisplay as 'table'|'chart';if(this.presentation==='table')this.isolate=false;this.drawResults();});
    host.querySelectorAll<HTMLButtonElement>('[data-bx-metric]').forEach(b=>b.onclick=()=>{this.metric=b.dataset.bxMetric as ExperimentMetric;this.drawResults();});
    host.querySelector<HTMLButtonElement>('[data-bx-probe-toggle]')!.onclick=()=>{this.probeOpen=!this.probeOpen;this.probe=this.probeOpen?0:null;this.drawResults();};
    host.querySelector<HTMLInputElement>('#bx-probe-time')!.oninput=event=>this.setProbe(Number((event.target as HTMLInputElement).value));
    const exactTime=host.querySelector<HTMLInputElement>('#bx-probe-value')!;
    exactTime.onchange=()=>this.setProbe(exactTime.valueAsNumber);
    exactTime.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();this.setProbe(exactTime.valueAsNumber);}else if(event.key==='Escape')this.drawResults();};
    host.querySelector<HTMLButtonElement>('[data-bx-peaks]')!.onclick=()=>{this.probe=null;this.drawResults();};
    host.querySelector<HTMLButtonElement>('[data-bx-clear]')!.onclick=()=>{
      if(this.controller)return;this.batch=undefined;this.selected=-1;this.reference=-1;this.probe=null;this.probeOpen=false;this.isolate=false;
      this.host.querySelector<HTMLDetailsElement>('.bx-config')!.open=true;
      try{localStorage.removeItem(BRIDGE_EXPERIMENTS_KEY);this.message('Scan cleared. Your baseline and live recording are unchanged.');}
      catch{this.message('Scan cleared for this session; browser storage could not be updated.');}
      this.drawResults();this.update();
    };
    for(const type of ['csv','samples','json'] as const)host.querySelector<HTMLButtonElement>(`[data-bx-${type}]`)!.onclick=()=>{
      if(!this.batch||this.controller)return;
      const name=`box3d-bridge-${this.batch.plan}-${this.batch.duration}s`;
      const body=type==='csv'?experimentCSV(this.batch):type==='samples'?experimentSamplesCSV(this.batch):JSON.stringify(experimentExport(this.batch),null,2);
      this.actions.download(`${name}${type==='samples'?'-samples.csv':'.'+type}`,new Blob([body],{type:type==='json'?'application/json':'text/csv;charset=utf-8'}));
      this.message(type==='csv'?'Summary CSV download requested: one row per case.':type==='samples'?'Samples CSV download requested: every recorded reading, settings and units. Unrun samples are omitted.':'JSON download requested: settings, response samples and model details.');
    };
    this.drawResults();this.update();
  }
  private status(text:string):void {const e=this.host.querySelector('.bx-status')!;if(e.textContent!==text)e.textContent=text;}
  private message(text:string):void {this.host.querySelector('.bx-storage')!.textContent=text;}
  private choosePreset(id:string):void {
    const preset=EXPERIMENT_PRESETS.find(p=>p.id===id);
    this.preset=preset?.id??'custom';
    if(preset){this.plan=preset.plan;this.duration=preset.duration;this.rangeStart=String(preset.values[0]);this.rangeEnd=String(preset.values.at(-1));this.caseCount=preset.values.length;}
    this.update();if(!this.batch)this.drawResults();
  }
  private configuration() {
    try {
      const fixed=this.fixed??this.actions.state().settings;
      for(const p of EXPERIMENT_PLANS)if(!Number.isFinite(fixed[p.axis])||fixed[p.axis]<p.min||fixed[p.axis]>p.max)throw new Error(`Set ${p.id==='load'?'load':p.id==='wind'?'crosswind':'strength'} from ${p.min} to ${p.max}.`);
      const values=this.preset==='custom'?experimentRange(this.plan,this.rangeStart.trim()?Number(this.rangeStart):NaN,this.rangeEnd.trim()?Number(this.rangeEnd):NaN,this.caseCount):[...EXPERIMENT_PRESETS.find(p=>p.id===this.preset)!.values];
      return {values,error:''};
    } catch(error) {return {values:[],error:error instanceof Error?error.message:'Check the experiment settings.'};}
  }
  private setProbe(time:number,focus=false):void {
    const max=this.batch?.duration??this.duration;
    if(!Number.isFinite(time)){this.drawResults();this.actions.notify(`Enter a time from 0 to ${max} model seconds.`);return;}
    this.probeOpen=true;this.probe=Math.round(Math.min(max,Math.max(0,time))*10)/10;this.drawResults();
    if(focus)this.host.querySelector<HTMLInputElement>('#bx-probe-time')!.focus();
  }
  private persist():void {
    if(!this.batch?.cases.some(c=>c.points.length>1))return;
    const saved=interruptedExperiments(this.batch),raw=JSON.stringify(saved);
    if(!parseBridgeExperiments(raw,this.modelKey)){this.message('This scan could not be saved. Export it to retain the results; the previous saved scan is kept.');return;}
    try{localStorage.setItem(BRIDGE_EXPERIMENTS_KEY,raw);this.message(this.batch.status==='running'?'Completed cases are being saved locally.':'Scan saved in this browser. Export before running another scan.');}
    catch{this.message('Browser storage is unavailable. Results remain in this session; export to keep them.');}
  }
  private async run():Promise<void> {
    const s=this.actions.state();if(this.controller||!s.ready||s.running||this.disposed)return;
    const setup=this.configuration();if(setup.error){this.update();return;}
    const batch=makeExperimentBatch(s.model,this.plan,this.duration,{...(this.fixed??s.settings)},{values:setup.values,preset:this.preset==='custom'?null:this.preset});
    this.controller=new AbortController();this.selected=-1;this.reference=-1;this.isolate=false;this.probe=null;this.probeOpen=false;this.completedCount=-1;
    this.batch=batch;
    this.host.querySelector<HTMLDetailsElement>('.bx-config')!.open=false;
    this.message(`${batch.cases.length} fresh bridges. The live scene keeps its current state.`);
    this.drawResults();this.update();
    try {
      await runBridgeExperiments(this.batch,s.model,{signal:this.controller.signal,progress:batch=>{
        if(this.disposed)return;
        this.batch=batch;
        const completed=batch.cases.filter(c=>c.status==='completed').length;
        const checkpoint=completed!==this.completedCount;
        if(checkpoint){this.completedCount=completed;if(completed>0)this.persist();}
        if(checkpoint||batch.status!=='running'||performance.now()-this.lastRender>160){this.lastRender=performance.now();this.drawResults();this.update();}
      }});
    } catch { if(this.batch)this.batch=interruptedExperiments(this.batch); }
    finally {
      this.controller=undefined;
      if(!this.disposed){this.persist();this.drawResults();this.update();}
    }
  }
  update():void {
    if(this.disposed)return;
    const s=this.actions.state(),busy=!!this.controller,b=this.batch,p=experimentPlan(this.plan);
    const fixed=busy&&b?b.base:this.fixed??s.settings,setup=this.configuration();
    const updateStamp=[busy,s.ready,s.running,this.plan,this.duration,this.preset,this.rangeStart,this.rangeEnd,this.caseCount,!!this.fixed,fixed.target,fixed.strength,fixed.wind,b?.createdAt,b?.status,this.controller?.signal.aborted,b?.cases.map(c=>`${c.status}:${c.points.at(-1)?.time??0}`).join(',')].join(':');
    if(updateStamp===this.updateStamp)return;
    this.updateStamp=updateStamp;
    this.host.classList.toggle('has-scan',!!b);
    this.host.classList.toggle('is-scanning',busy);
    this.host.querySelector('.bx-config-summary')!.textContent=`${p.label} · ${this.caseCount} cases · ${this.duration} s${b&&!busy?' · next scan':''}`;
    const preset=this.host.querySelector<HTMLSelectElement>('#bx-preset')!;preset.value=this.preset;preset.disabled=busy;
    this.host.querySelector('.bx-preset-note')!.textContent=EXPERIMENT_PRESETS.find(p=>p.id===this.preset)?.description??'Evenly spaced settings. All other conditions stay fixed.';
    for(const [id,value] of [['start',this.rangeStart],['end',this.rangeEnd]] as const){
      const input=this.host.querySelector<HTMLInputElement>(`#bx-range-${id}`)!;
      input.min=String(p.min);input.max=String(p.max);input.disabled=busy;
      if(document.activeElement!==input)input.value=value;
      input.setAttribute('aria-invalid',String(!!setup.error));
    }
    const count=this.host.querySelector<HTMLSelectElement>('#bx-case-count')!;count.value=String(this.caseCount);count.disabled=busy;
    this.host.querySelector('.bx-range-note')!.textContent=`${p.id==='strength'?'Strength multiplier':'Normalized '+(p.id==='load'?'load':'crosswind')} · ${p.min}–${p.max}${p.unit} · up to 4 decimal places`;
    this.host.querySelectorAll<HTMLInputElement>('[data-bx-fixed]').forEach(input=>{
      const axis=input.dataset.bxFixed as 'target'|'strength'|'wind',value=fixed[axis];
      input.closest<HTMLElement>('label')!.hidden=axis===p.axis;input.disabled=busy;
      if(document.activeElement!==input)input.value=Number.isFinite(value)?String(value):'';
      const limits=EXPERIMENT_PLANS.find(p=>p.axis===axis)!;input.setAttribute('aria-invalid',String(!Number.isFinite(value)||value<limits.min||value>limits.max));
    });
    this.host.querySelector<HTMLButtonElement>('[data-bx-live-settings]')!.disabled=busy;
    this.host.querySelector('.bx-held-source')!.textContent=this.fixed?'Custom / retained':'From live scene';
    const error=this.host.querySelector<HTMLElement>('#bx-setup-error')!;error.hidden=!setup.error;error.textContent=setup.error;
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-plan]').forEach(button=>{button.disabled=busy;button.setAttribute('aria-pressed',String(button.dataset.bxPlan===this.plan));});
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-duration]').forEach(button=>{button.disabled=busy;button.setAttribute('aria-pressed',String(Number(button.dataset.bxDuration)===this.duration));});
    const display=(n:number)=>Number.isFinite(n)?experimentValue(n):'—';
    const markup=`<i class="ph ph-lock-key" aria-hidden="true"></i><span>${p.axis!=='target'?`Load <b>${display(fixed.target)}</b> · `:''}${p.axis!=='strength'?`Strength <b>${display(fixed.strength)}×</b>${p.axis!=='wind'?' · ':''}`:''}${p.axis!=='wind'?`Wind <b>${display(fixed.wind)}</b>`:''}<small>${busy?'Fixed for these runs':'Held constant in the next scan'}</small></span>`;
    if(markup!==this.fixedMarkup){this.fixedMarkup=markup;this.host.querySelector('.bx-fixed')!.innerHTML=markup;}
    this.host.querySelector('.bx-values')!.textContent=setup.error?'':`${setup.values.map(v=>experimentValue(v)+p.unit).join(' / ')} · ${setup.values.length*this.duration} total model seconds · fresh bridge per case`;
    const run=this.host.querySelector<HTMLButtonElement>('[data-bx-run]')!;run.hidden=busy;run.disabled=!s.ready||s.running||!!setup.error;
    run.querySelector('span')!.textContent=`Run ${this.caseCount} cases`;
    this.host.querySelector<HTMLElement>('[data-bx-cancel]')!.hidden=!busy;
    const progress=this.host.querySelector<HTMLProgressElement>('progress')!;
    progress.parentElement!.hidden=!busy;
    this.host.querySelector('.bx-status')!.classList.toggle('is-summary',!busy&&s.ready&&!s.running&&b?.status==='completed');
    if(busy&&b){
      progress.value=b.cases.reduce((sum,c)=>sum+(c.points.at(-1)?.time??0),0)/(b.cases.length*b.duration)*100;
      const active=b.cases.find(c=>c.status==='running');
      this.status(this.controller!.signal.aborted?'Cancelling scan… recorded samples will be retained.':active?`Case ${active.index+1} of ${b.cases.length} · ${experimentCaseLabel(b,active)} · ${(active.points.at(-1)?.time??0).toFixed(0)} / ${b.duration} s`:'Preparing the next case…');
    }else if(s.running)this.status('Pause the live simulation to start a scan.');
    else if(!s.ready)this.status('Waiting for the bridge to be ready…');
    else if(b)this.status(b.status==='completed'?`${b.cases.length} of ${b.cases.length} complete · ${b.duration} s per case`:b.status==='failed'?'Engine error · recorded results retained.':'Cancelled · partial results retained.');
    else this.status('');
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-csv],[data-bx-samples],[data-bx-json]').forEach(button=>button.disabled=busy||!b?.cases.some(c=>c.points.length>1));
    this.host.querySelector<HTMLButtonElement>('[data-bx-clear]')!.disabled=busy||!b;
    const stamp=[busy,s.ready,s.running].join(':');
    if(stamp!==this.availability){this.availability=stamp;this.drawResults();}
  }
  private drawResults():void {
    const b=this.batch,cases=b?.cases??[],s=this.actions.state(),canAct=!this.controller&&s.ready&&!s.running;
    const selected=cases[this.selected],series=this.isolate&&selected?[selected]:cases;
    this.host.dataset.presentation=this.presentation;
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-display]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.bxDisplay===this.presentation)));
    const metric=EXPERIMENT_METRICS.find(m=>m.id===this.metric)!;
    const numeric=(n:number|undefined)=>n===undefined?'—':this.metric==='broken'?String(n):f(n);
    const hasSamples=cases.some(c=>c.points.length>1),seriesHasSamples=series.some(c=>c.points.length>1);
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-metric]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.bxMetric===this.metric)));
    const isolate=this.host.querySelector<HTMLButtonElement>('[data-bx-isolate]')!;isolate.hidden=this.presentation==='table';isolate.disabled=!hasSamples;isolate.setAttribute('aria-pressed',String(this.isolate));
    const meta=this.host.querySelector('.bx-result-meta')!;
    const fixed=b?experimentPlan(b.plan).axis:undefined;
    meta.textContent=b?`${experimentPlan(b.plan).label} · ${b.duration} s · ${fixed!=='target'?`Load ${experimentValue(b.base.target)} · `:''}${fixed!=='strength'?`Strength ${experimentValue(b.base.strength)}×${fixed!=='wind'?' · ':''}`:''}${fixed!=='wind'?`Wind ${experimentValue(b.base.wind)}`:''}`:'NO RUNS YET';
    const overview=this.host.querySelector<HTMLElement>('.bx-overview')!;overview.hidden=!b;
    if(b){const o=experimentOverview(b);overview.innerHTML=`<div><b>${o.completed}<small> / ${b.cases.length}</small></b><span>Complete</span></div><div><b>${o.recorded?`${o.ruptured}<small> / ${o.recorded}</small>`:'—'}</b><span title="Recorded cases with an observed rupture">With rupture</span></div><div><b>${o.earliest?.firstRupture?.toFixed(2)??'—'}${o.earliest?'<small> s</small>':''}</b><span>${o.earliest?`Earliest · ${experimentCaseLabel(b,o.earliest)}`:'No rupture recorded'}</span></div>`;}
    const xmax=b?.duration??this.duration;
    const rawMax=Math.max(this.metric==='broken'?1:.1,...series.flatMap(c=>c.points.map(p=>p[this.metric])));
    const ymax=this.metric==='broken'?Math.ceil(rawMax):rawMax*1.08;
    const x=(t:number)=>32+t/xmax*276,y=(v:number)=>92-v/ymax*68;
    // Connection counts are discrete: draw steps, never fractional losses between samples.
    const paths=series.map(c=>`<path d="${c.points.map((p,i)=>!i?`M${x(p.time).toFixed(2)},${y(p[this.metric]).toFixed(2)}`:this.metric==='broken'?`H${x(p.time).toFixed(2)}V${y(p[this.metric]).toFixed(2)}`:`L${x(p.time).toFixed(2)},${y(p[this.metric]).toFixed(2)}`).join('')}" stroke="${colors[c.index]}" stroke-width="${c.index===this.selected?2.4:1.6}" opacity="${this.selected<0||c.index===this.selected?1:.5}"/>`).join('');
    const first=selected?.firstRupture,probe=this.probe;
    const probeDots=probe===null?'':series.map(c=>{const point=experimentSample(c,probe);return point?`<circle cx="${x(point.time)}" cy="${y(point[this.metric])}" r="2.8" fill="${colors[c.index]}"/>`:'';}).join('');
    this.host.querySelector('.bx-plot')!.innerHTML=`<svg viewBox="0 0 322 118" role="img" aria-label="${metric.title} over model time, in ${metric.unit}. ${b?'Select a case or use the time probe for exact measurements.':'No experiments have been recorded.'}"><path class="bx-grid" d="M32,24H308M32,58H308M32,92H308M32,24V92M170,24V92M308,24V92"/>${paths}${first!==undefined&&first!==null?`<path class="bx-rupture" d="M${x(first)},23V92"/><text x="308" y="12" text-anchor="end">first rupture ${first.toFixed(2)} s</text>`:''}${probe!==null?`<path class="bx-probe-line" d="M${x(probe)},23V92"/>${probeDots}`:''}<text x="32" y="12">${metric.unit}</text><text x="27" y="27" text-anchor="end">${ymax.toFixed(this.metric==='broken'?0:1)}</text><text x="27" y="95" text-anchor="end">0</text><text x="32" y="108">0</text><text x="170" y="108" text-anchor="middle">${xmax/2} model seconds</text><text x="308" y="108" text-anchor="end">${xmax}</text>${seriesHasSamples?'':`<text class="bx-chart-empty" x="170" y="59" text-anchor="middle">${hasSamples?'No samples for this case':'Run a scan to compare responses'}</text>`}</svg>`;
    this.host.querySelector<HTMLElement>('.bx-probe')!.hidden=!hasSamples||!this.probeOpen;
    const probeToggle=this.host.querySelector<HTMLButtonElement>('[data-bx-probe-toggle]')!;probeToggle.disabled=!hasSamples;probeToggle.setAttribute('aria-expanded',String(this.probeOpen));
    this.host.querySelector<HTMLElement>('.bx-case-heading')!.hidden=!b||this.presentation==='table';
    this.host.querySelector<HTMLElement>('.bx-table-intro')!.hidden=!b||this.presentation!=='table';
    this.host.querySelector('.bx-table-intro')!.textContent=probe===null?'Recorded peaks · displacement in model units':'At '+probe.toFixed(1)+' s · displacement in model units';
    const input=this.host.querySelector<HTMLInputElement>('#bx-probe-time')!;input.max=String(xmax);input.value=String(probe??0);
    const exactTime=this.host.querySelector<HTMLInputElement>('#bx-probe-value')!;exactTime.max=String(xmax);exactTime.value=probe===null?'':probe.toFixed(1);
    input.setAttribute('aria-valuetext',`${(probe??0).toFixed(1)} model seconds${probe===null?' · move to probe samples':''}`);
    this.host.querySelector('.bx-probe output')!.textContent=probe===null?'any instant':`${probe.toFixed(1)} s`;
    this.host.querySelector('[data-bx-peaks]')!.setAttribute('aria-pressed',String(probe===null));
    this.host.querySelector('.bx-probe-note')!.textContent=probe===null?'Rows show recorded peaks. Move the probe to compare one instant.':'Actual 0.1 s samples · “No sample” means outside the recorded interval.';
    this.host.querySelector('.bx-value-heading')!.textContent=probe===null?this.metric==='broken'?'Final lost links':this.metric==='drop'?'Peak drop':'Peak sideways':`At ${probe.toFixed(1)} s`;
    const focus=(document.activeElement as HTMLElement|null)?.closest<HTMLButtonElement>('[data-bx-case]')?.dataset.bxCase;
    const maxPeak=Math.max(1e-9,...cases.map(c=>experimentPeak(c,this.metric)??0));
    const rows=b?cases.map(c=>{
      const result=experimentSummary(c),open=c.index===this.selected,partial=c.status==='cancelled'||c.status==='failed';
      const outcome=c.status==='pending'?'Not run':c.status==='running'?'Running…':partial?'Partial · '+(result?.outcome??'no samples'):result?.outcome??'No samples';
      const point=probe===null?undefined:experimentSample(c,probe),value=probe===null?experimentPeak(c,this.metric):point?.[this.metric];
      if(this.presentation==='table'){
        const values=EXPERIMENT_METRICS.map(m=>probe===null?experimentPeak(c,m.id):point?.[m.id]);
        const valueText=(n:number|undefined,index:number)=>n===undefined?'—':index===2?String(n):n>=1000?n.toExponential(1):f(n);
        const spoken=values.every(v=>v===undefined)?'No samples at this time.':values.map((v,i)=>`${EXPERIMENT_METRICS[i].label} ${valueText(v,i)} ${EXPERIMENT_METRICS[i].unit}`).join(', ');
        return `<tr class="${open?'is-selected':''}" style="--case-color:${colors[c.index]}"><th scope="row"><button data-bx-case="${c.index}" aria-expanded="${open}" aria-controls="bx-selection" aria-label="${experimentCaseLabel(b,c)}. ${c.index===this.reference?'Comparison reference. ':''}${outcome}. ${spoken}"><span class="bx-table-number">0${c.index+1}</span><span class="bx-case-label"><strong>${experimentCaseLabel(b,c)}${c.index===this.reference?'<span class="bx-ref-mark" title="Comparison reference">REF</span>':''}</strong><span class="bx-outcome ${result?.broken?'has-break':''}">${outcome}</span></span><span class="bx-table-chevron" aria-hidden="true">${open?'−':'+'}</span></button></th>${values.map((v,i)=>`<td title="${v===undefined?'No recorded sample':v+' '+EXPERIMENT_METRICS[i].unit}">${valueText(v,i)}</td>`).join('')}</tr>`;
      }
      return `<article class="bx-case ${open?'is-selected':''}" style="--case-color:${colors[c.index]}"><button class="bx-case-toggle" data-bx-case="${c.index}" aria-expanded="${open}" aria-controls="bx-selection"><span class="bx-case-number">0${c.index+1}</span><i aria-hidden="true"></i><span class="bx-case-label"><strong>${experimentCaseLabel(b,c)}${c.index===this.reference?'<span class="bx-ref-mark" title="Comparison reference">REF</span>':''}</strong><span class="bx-outcome ${result?.broken?'has-break':''}">${outcome}</span></span><span class="bx-case-reading"><b>${numeric(value)}</b><span class="bx-mini-bar" aria-hidden="true"><i style="width:${Math.min(100,(value??0)/maxPeak*100)}%"></i></span>${probe!==null&&!point?'<small>No sample</small>':''}</span><span aria-hidden="true">${open?'−':'+'}</span></button></article>`;
    }).join(''):'';
    this.host.querySelector('.bx-cases')!.innerHTML=b?this.presentation==='table'?`<table class="bx-table"><caption class="bx-sr">${probe===null?'Recorded peaks and final lost links':'Response samples at '+probe.toFixed(1)+' model seconds'}. Outcomes cover the full recording.</caption><colgroup><col class="bx-table-case-col"><col><col><col></colgroup><thead><tr><th scope="col">Case<small>Full-record outcome</small></th><th scope="col">${probe===null?'Peak ':''}drop</th><th scope="col">${probe===null?'Peak ':''}sideways</th><th scope="col">Lost links</th></tr></thead><tbody>${rows}</tbody></table>`:rows:'<p class="bx-empty">Start with a preset or define a range. Every case begins with an intact bridge and records its own response.</p>';
    this.drawFollowUps();
    const detail=this.host.querySelector<HTMLElement>('.bx-selection')!;
    if(b&&selected){
      const result=experimentSummary(selected),targets=experimentProbeTargets(selected);
      detail.style.setProperty('--case-color',colors[selected.index]);
      detail.innerHTML=`<div class="bx-detail"><div class="bx-detail-heading"><span>CASE 0${selected.index+1}</span><strong>${experimentCaseLabel(b,selected)}</strong></div>${result?`<div class="bx-metrics"><div><span>First rupture</span><b>${selected.firstRupture===null?'—':selected.firstRupture.toFixed(2)+' s'}</b></div><div><span>Peak recorded drop</span><b>${f(result.peak)}</b></div><div><span>Lost links</span><b>${result.broken}<small> / 327</small></b></div></div><p class="bx-case-note">${result.time.toFixed(1)} s recorded · peak at ${result.peakTime.toFixed(2)} s<br>Lateral peak ${f(result.lateral)} · ${esc(selected.phase)}</p>`:'<p class="bx-case-note">No response samples yet. This case has not completed.</p>'}<p class="bx-case-settings">Load ${experimentValue(selected.settings.target)} · Strength ${experimentValue(selected.settings.strength)}× · Wind ${experimentValue(selected.settings.wind)}</p><div class="bx-event-shortcuts" role="group" aria-label="Probe case milestones"><button data-bx-jump="first" ${targets.first?'':'disabled'} title="First recorded sample with a broken connection">First rupture</button><button data-bx-jump="peak" ${targets.peak?'':'disabled'}>Peak drop</button><button data-bx-jump="end" ${targets.end?'':'disabled'}>Record end</button></div><section class="bx-comparison" aria-label="Case comparison"></section><div class="bx-case-actions"><button data-bx-load ${canAct?'':'disabled'}>Load case</button><button data-bx-baseline ${canAct&&selected.points.length>1&&selected.status!=='running'?'':'disabled'}>Use as baseline</button></div></div>`;
      detail.querySelectorAll<HTMLButtonElement>('[data-bx-jump]').forEach(button=>button.onclick=()=>{
        const key=button.dataset.bxJump as keyof typeof targets,point=targets[key];if(!point)return;
        this.setProbe(point.time,true);
        this.actions.notify(`${experimentCaseLabel(b,selected)} · ${key==='first'?'first recorded rupture sample':key==='peak'?'sampled peak drop':'last recorded sample'} at ${point.time.toFixed(1)} s.`);
      });
      this.drawComparison(detail.querySelector<HTMLElement>('.bx-comparison')!,b,selected);
      detail.querySelector<HTMLButtonElement>('[data-bx-load]')!.onclick=()=>{if(!canAct)return;this.actions.load({...selected.settings});this.actions.notify('Case settings loaded. Run the live simulation to inspect its geometry.');};
      detail.querySelector<HTMLButtonElement>('[data-bx-baseline]')!.onclick=()=>{
        if(!canAct)return;const baseline=experimentBaseline(b,selected);
        if(baseline&&this.actions.baseline(baseline)){this.message(`Baseline set to ${baseline.name}. Compare it in Inspect.`);this.actions.notify('Experiment saved as baseline. Open Inspect to compare your live run.');}
      };
    }else detail.innerHTML='';
    detail.hidden=!selected;
    const select=(index:number,toggle=false)=>{this.selected=toggle&&this.selected===index?-1:index;if(this.selected<0)this.isolate=false;this.drawResults();this.host.querySelector<HTMLButtonElement>(`[data-bx-case="${index}"]`)?.focus({preventScroll:toggle});};
    this.host.querySelectorAll<HTMLButtonElement>('[data-bx-case]').forEach(button=>{
      button.onclick=()=>select(Number(button.dataset.bxCase),true);
      button.onkeydown=event=>{const index=Number(button.dataset.bxCase),next=event.key==='ArrowDown'?Math.min(cases.length-1,index+1):event.key==='ArrowUp'?Math.max(0,index-1):event.key==='Home'?0:event.key==='End'?cases.length-1:undefined;if(next!==undefined){event.preventDefault();select(next);}};
    });
    if(focus!==undefined)this.host.querySelector<HTMLButtonElement>(`[data-bx-case="${focus}"]`)?.focus({preventScroll:true});
  }
  private drawFollowUps():void {
    const host=this.host.querySelector<HTMLElement>('.bx-followups')!,b=this.batch;
    const transitions=b?experimentTransitions(b):[];host.hidden=!transitions.length;
    if(!b||!transitions.length){host.innerHTML='';return;}
    const p=experimentPlan(b.plan);
    host.innerHTML=`<div class="bx-followup-heading"><i class="ph ph-magnifying-glass-plus" aria-hidden="true"></i><h4>Refine an observed transition</h4></div><p>Adjacent completed cases had different rupture outcomes. Look closer under the same conditions.</p><div class="bx-followup-options">${transitions.map(t=>{
      let reason='';try{experimentFollowUp(b,t.lower.index);}catch{reason='This interval is already too narrow for five distinct settings.';}
      return `<button data-bx-refine="${t.lower.index}" ${this.controller||reason?'disabled':''} title="${reason||'Prepare five cases without replacing this recording'}"><span>${experimentValue(t.lower.settings[p.axis])} → ${experimentValue(t.upper.settings[p.axis])}${p.unit}</span><small>${t.lowerRuptured?'Rupture → no rupture':'No rupture → rupture'}</small><i class="ph ph-arrow-up-right" aria-hidden="true"></i></button>`;
    }).join('')}</div><p class="bx-followup-note">Observed for ${b.duration} s. This interval is not a safe-load rating or a proven failure threshold.</p>`;
    host.querySelectorAll<HTMLButtonElement>('[data-bx-refine]').forEach(button=>button.onclick=()=>{
      if(this.controller)return;
      const next=experimentFollowUp(b,Number(button.dataset.bxRefine));
      this.plan=next.plan;this.duration=next.duration;this.fixed=next.base;this.preset='custom';
      this.rangeStart=String(next.design.values[0]);this.rangeEnd=String(next.design.values.at(-1));this.caseCount=next.design.values.length;
      this.host.querySelector<HTMLDetailsElement>('.bx-config')!.open=true;this.update();
      this.host.querySelector<HTMLInputElement>('#bx-range-start')!.focus();
      this.message('Follow-up prepared with the original fixed settings and duration. Current results remain available; export them before starting the new scan.');
      this.actions.notify('Five-case follow-up prepared. Review the range, then run it.');
    });
  }
  private drawComparison(host:HTMLElement,batch:BridgeExperimentBatch,selected:BridgeExperimentCase):void {
    const reference=batch.cases[this.reference],busy=!!this.controller,pinned=this.reference===selected.index;
    const eligible=(c:BridgeExperimentCase)=>c.points.length>1&&c.status!=='running';
    const comparison=reference?experimentComparison(selected,reference,this.probe):undefined;
    const value=(n:number,metric:ExperimentMetric)=>metric==='broken'?String(n):Math.abs(n)>=1000?n.toExponential(1):f(n);
    const difference=(n:number,metric:ExperimentMetric)=>{
      const rounded=metric==='broken'?n:Number(n.toFixed(3));
      return `${rounded>0?'+':rounded<0?'−':''}${value(Math.abs(rounded),metric)}`;
    };
    let content='<p class="bx-compare-note">Pin a reference, then select another case to see the difference.</p>';
    if(reference&&pinned)content='<p class="bx-compare-note">This is the reference. Select another case above to compare it.</p>';
    else if(comparison){
      if(comparison.status==='ready'){
        const basis=this.probe===null?`Peaks & final lost links · 0–${comparison.currentEnd.toFixed(1)} s`:`Both cases at ${this.probe.toFixed(1)} s`;
        content=`<table class="bx-compare-table"><caption><strong>${experimentCaseLabel(batch,selected)} vs ${experimentCaseLabel(batch,reference!)}</strong><span>${basis}</span></caption><thead><tr><th scope="col">Measurement</th><th scope="col" title="${experimentCaseLabel(batch,selected)}">Selected</th><th scope="col" title="${experimentCaseLabel(batch,reference!)}">Reference</th><th scope="col">Difference</th></tr></thead><tbody>${comparison.readings.map((reading,i)=>{
          const n=reading.delta!,signed=difference(n,reading.metric),direction=signed.startsWith('+')?'increase':signed.startsWith('−')?'decrease':'equal';
          return `<tr><th scope="row">${EXPERIMENT_METRICS[i].label}</th><td title="${reading.current} ${EXPERIMENT_METRICS[i].unit}">${value(reading.current!,reading.metric)}</td><td title="${reading.reference} ${EXPERIMENT_METRICS[i].unit}">${value(reading.reference!,reading.metric)}</td><td class="is-${direction}" title="${n} ${EXPERIMENT_METRICS[i].unit}">${signed}</td></tr>`;
        }).join('')}</tbody></table><p class="bx-compare-note">Selected − reference, calculated before rounding. Displacement in model units; lost links in connections.${this.probe===null?' Each displacement peak may occur at a different time.':''}</p>`;
      }else{
        const reason=comparison.status==='running'?'Finish the scan to compare recordings.':comparison.status==='duration-mismatch'?`Different recording lengths: ${comparison.currentEnd.toFixed(1)} s selected, ${comparison.referenceEnd.toFixed(1)} s reference. Compare at a shared time.`:'Both cases need a recorded sample at this time.';
        content=`<p class="bx-compare-note">${reason}</p>${comparison.sharedEnd===undefined||busy?'':`<button data-bx-common>Compare at ${comparison.sharedEnd.toFixed(1)} s · last shared sample</button>`}`;
      }
    }
    host.innerHTML=`<div class="bx-compare-controls"><label for="bx-reference-case">Compare with<select id="bx-reference-case" aria-label="Comparison reference case" ${busy?'disabled':''}><option value="-1">Choose a reference</option>${batch.cases.map(c=>`<option value="${c.index}" ${c.index===this.reference?'selected':''} ${eligible(c)?'':'disabled'}>${experimentCaseLabel(batch,c)}${c.status==='cancelled'||c.status==='failed'?' · partial':''}</option>`).join('')}</select></label><button data-bx-pin aria-pressed="${pinned}" ${busy||!eligible(selected)?'disabled':''}><i class="ph ph-push-pin" aria-hidden="true"></i>${pinned?'Unpin case':'Pin this case'}</button></div>${content}`;
    host.querySelector<HTMLSelectElement>('#bx-reference-case')!.onchange=event=>{
      this.reference=Number((event.target as HTMLSelectElement).value);this.drawResults();
      this.host.querySelector<HTMLSelectElement>('#bx-reference-case')!.focus({preventScroll:true});
    };
    host.querySelector<HTMLButtonElement>('[data-bx-pin]')!.onclick=()=>{
      this.reference=pinned?-1:selected.index;this.drawResults();
      this.host.querySelector<HTMLButtonElement>('[data-bx-pin]')!.focus({preventScroll:true});
      this.actions.notify(pinned?'Comparison reference cleared.':`${experimentCaseLabel(batch,selected)} pinned as reference. Select another case to compare.`);
    };
    const common=host.querySelector<HTMLButtonElement>('[data-bx-common]');
    if(common&&comparison?.sharedEnd!==undefined)common.onclick=()=>this.setProbe(comparison.sharedEnd!,true);
  }
  cancel():void {if(this.controller){this.controller.abort();this.persist();}}
  dispose():void {this.disposed=true;this.cancel();}
}
