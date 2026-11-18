import { BRIDGE_BASELINE_KEY, bridgeComparison, bridgeInspection, bridgeMilestones, bridgeModelKey, bridgeZone, bridgeZoneLabel, parseBridgeBaseline, type BridgeBaseline, type BridgeControls, type BridgeModel, type BridgePoint } from './bridge-review';
import type { FailureEvent, Snapshot } from './physics';
import { BridgeExperimentsView } from './bridge-experiments-view';
import './bridge-review.css';

export interface BridgeReviewState {
  model:BridgeModel; snapshot:Snapshot; points:BridgePoint[]; events:FailureEvent[];
  settings:BridgeControls; changes:BridgeBaseline['changes']; run:number; historyComplete:boolean;
  replay:boolean; running:boolean; ready:boolean; pauseOnBreak:boolean;
}
interface Actions {
  state:()=>BridgeReviewState; seek:(index:number)=>void; focus:(zone:number|null)=>void;
  pauseOnBreak:(on:boolean)=>void; load:(settings:BridgeControls)=>void;
  download:(name:string,blob:Blob)=>void; notify:(message:string)=>void;
  initialMode?:'inspect'|'experiments'; modeChanged?:(mode:'inspect'|'experiments')=>void;
}
const esc=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(n:number)=>n.toFixed(3);
const delta=(n:number)=>(n>0?'+':'')+fmt(n);

export class BridgeReviewView {
  private baseline?:BridgeBaseline;
  private modelKey:string;
  private zone:number|null=null;
  private stamp='';
  private lastRun=-1;
  private memoryOnly=false;
  private experiments?:BridgeExperimentsView;
  constructor(private host:HTMLElement,private actions:Actions) {
    this.modelKey=bridgeModelKey(actions.state().model);
    let invalid=false;try{const raw=localStorage.getItem(BRIDGE_BASELINE_KEY);this.baseline=parseBridgeBaseline(raw,this.modelKey);invalid=!!raw&&!this.baseline;}catch{this.memoryOnly=true;}
    host.classList.add('bridge-review');
    host.innerHTML=`<div class="br-modes" role="group" aria-label="Analysis mode"><button data-br-mode="inspect" aria-pressed="true" aria-controls="bridge-inspect">Inspect</button><button data-br-mode="experiments" aria-pressed="false" aria-controls="bridge-experiments">Experiments</button></div><div class="br-inspect" id="bridge-inspect"><div class="br-heading"><div><span class="br-eyebrow">BRIDGE / FAILURE REVIEW</span><h3>Read the failure.</h3></div><span class="br-mode"></span></div>
      <p class="br-intro">Follow the load path. Inspect a span, replay a rupture, then compare your next run.</p>
      <section class="br-map-card" aria-label="Connection inspection"><div class="br-section-heading"><h4>Connection map</h4><button data-br-overview>Whole bridge</button></div>
        <div class="br-map"></div><div class="br-map-legend"><span><i></i>Intact</span><span><i class="broken"></i>Ruptured</span><span><i class="rest"></i>Initial shape</span></div>
        <div class="br-zones" role="group" aria-label="Inspect a bridge span">${Array.from({length:6},(_,i)=>`<button data-br-zone="${i}" aria-label="Inspect ${bridgeZoneLabel(i)}" aria-pressed="false"><span>${String(i+1).padStart(2,'0')}</span><b>0</b></button>`).join('')}</div><div class="br-span-axis"><span>West approach</span><span>Midspan</span><span>East approach</span></div>
      </section>
      <div class="br-metrics"><div><span>Deck drop</span><strong data-br-drop>0.000</strong><small>model units</small></div><div><span>Lateral movement</span><strong data-br-lateral>0.000</strong><small>model units</small></div><div><span>Connections lost</span><strong data-br-broken>0</strong><small data-br-total></small></div></div>
      <details class="br-details"><summary>Connection breakdown <span class="br-selection">Whole bridge</span></summary><div class="br-groups"></div><p>Counts include both sides. Zones use each connection’s original midpoint.</p></details>
      <section class="br-milestone-section"><div class="br-section-heading"><h4>Failure milestones</h4><span>RECORDED GEOMETRY</span></div><div class="br-milestones"></div>
        <label class="br-pause"><input type="checkbox" data-br-pause><span>Pause on first rupture<small>Stops at the end of the first batch with a break (≤ 0.10 s later).</small></span></label>
      </section>
      <section class="br-baseline-section"><div class="br-section-heading"><h4>Compare a baseline</h4><span>DECK DROP</span></div>
        <div class="br-chart" role="img" aria-label="Recorded deck drop compared with the saved baseline"></div><p class="br-comparison"></p>
        <div class="br-baseline-meta"></div><label class="br-name">Run label<input maxlength="60" placeholder="e.g. Strong cables / crosswind" aria-label="Baseline run name"></label>
        <div class="br-actions"><button data-br-save>Save baseline</button><button data-br-load>Load starting setup</button><button data-br-export>Export review</button><button data-br-clear>Clear baseline</button></div>
        <p class="br-storage" role="status">${invalid?'An incompatible or damaged saved baseline was ignored.':this.memoryOnly?'Browser storage is unavailable; baselines stay in this session.':'Baselines stay in this browser. Saving again replaces the previous one.'}</p>
      </section><p class="br-boundary">Authored comparative model · units and failure thresholds are not calibrated. Saved baselines contain response samples and load settings; full resumable runs are available from Export evidence.</p></div><div id="bridge-experiments" hidden></div>`;
    const setMode=(mode:'inspect'|'experiments')=>{
      host.querySelector<HTMLElement>('#bridge-inspect')!.hidden=mode!=='inspect';
      host.querySelector<HTMLElement>('#bridge-experiments')!.hidden=mode!=='experiments';
      host.querySelectorAll<HTMLButtonElement>('[data-br-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.brMode===mode)));
      host.closest<HTMLElement>('.desk-scroll')?.scrollTo({top:0});actions.modeChanged?.(mode);
    };
    host.querySelectorAll<HTMLButtonElement>('[data-br-mode]').forEach(b=>{
      b.onclick=()=>setMode(b.dataset.brMode as 'inspect'|'experiments');
      b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const mode=e.key==='Home'?'inspect':e.key==='End'?'experiments':b.dataset.brMode==='inspect'?'experiments':'inspect';setMode(mode);host.querySelector<HTMLButtonElement>(`[data-br-mode="${mode}"]`)!.focus();};
    });
    this.experiments=new BridgeExperimentsView(host.querySelector('#bridge-experiments')!,{state:actions.state,load:actions.load,download:actions.download,notify:actions.notify,baseline:b=>this.storeBaseline(b)});
    setMode(actions.initialMode??'inspect');
    host.querySelectorAll<HTMLButtonElement>('[data-br-zone]').forEach(b=>b.onclick=()=>{this.zone=Number(b.dataset.brZone);this.actions.focus(this.zone);this.refresh();});
    host.querySelector<HTMLButtonElement>('[data-br-overview]')!.onclick=()=>{this.zone=null;this.actions.focus(null);this.refresh();};
    host.querySelector<HTMLInputElement>('[data-br-pause]')!.onchange=e=>{this.actions.pauseOnBreak((e.target as HTMLInputElement).checked);this.refresh();};
    host.querySelector<HTMLButtonElement>('[data-br-save]')!.onclick=()=>this.save();
    host.querySelector<HTMLButtonElement>('[data-br-clear]')!.onclick=()=>{this.baseline=undefined;try{localStorage.removeItem(BRIDGE_BASELINE_KEY);this.message('Baseline cleared. Current recording is unchanged.');}catch{this.message('Baseline cleared for this session. Browser storage could not be updated.');}this.refresh();};
    host.querySelector<HTMLButtonElement>('[data-br-load]')!.onclick=()=>{if(this.baseline){this.actions.load({...this.baseline.settings});this.actions.notify('Baseline starting load settings restored. Run simulation to record a new comparison.');}};
    host.querySelector<HTMLButtonElement>('[data-br-export]')!.onclick=()=>{
      const s=this.actions.state(),payload={format:'box3d-bridge-review',version:1,exportedAt:new Date().toISOString(),model:this.modelKey,units:{drop:'model units',lateral:'model units',load:'normalized',time:'model seconds'},limitations:['Authored comparative model; not calibrated.','Response samples are not resumable solver state.','Failure event messages are coalesced; connection counts use the complete broken mask.'],current:{run:s.run,settings:s.settings,changes:s.changes,historyComplete:s.historyComplete,points:s.points,events:s.events},baseline:this.baseline??null};
      this.actions.download(`box3d-bridge-review-run-${s.run}.json`,new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));this.message('Review exported with settings, samples, events and baseline.');
    };
    this.update();
  }
  private message(text:string):void {this.host.querySelector('.br-storage')!.textContent=text;}
  private refresh():void {this.stamp='';this.update();}
  private save():void {
    const s=this.actions.state();if(!s.ready||s.running||s.points.length<2)return;
    const name=this.host.querySelector<HTMLInputElement>('.br-name input')!.value.trim()||`Bridge / run ${s.run}`;
    const settings={...s.settings,...s.changes[0]};
    const candidate:BridgeBaseline={format:'box3d-bridge-baseline',version:1,name,savedAt:new Date().toISOString(),model:this.modelKey,settings,changes:s.changes.map(c=>({...c})),points:s.points.map(p=>({...p})),historyComplete:s.historyComplete};
    this.storeBaseline(candidate);
  }
  private storeBaseline(candidate:BridgeBaseline):boolean {
    const raw=JSON.stringify(candidate);
    if(!parseBridgeBaseline(raw,this.modelKey)){this.message('This run is too large or incompatible to save as a baseline. Export review instead. Your previous baseline is retained.');return false;}
    this.baseline=candidate;
    try{localStorage.setItem(BRIDGE_BASELINE_KEY,raw);this.memoryOnly=false;this.message('Baseline saved in this browser. Change the Test settings and run again.');}catch{this.memoryOnly=true;this.message('Browser storage is unavailable. Baseline saved for this session only.');}
    this.refresh();
    return true;
  }
  dispose():void {this.experiments?.dispose();}
  cancelExperiments():void {this.experiments?.cancel();}
  update():void {
    this.experiments?.update();
    const s=this.actions.state(),r=s.snapshot.response;
    if(this.lastRun!==s.run){this.lastRun=s.run;this.zone=null;}
    const stamp=[s.run,r.time,r.broken,s.points.at(-1)?.time,s.points.length,s.running,s.ready,s.replay,s.pauseOnBreak,this.zone,s.settings.target,s.settings.strength,s.settings.wind].join(':');
    if(stamp===this.stamp)return;this.stamp=stamp;
    const set=(selector:string,text:string)=>{this.host.querySelector(selector)!.textContent=text;};
    const {groups,zones,point}=bridgeInspection(s.model,s.snapshot,this.zone);
    set('.br-mode',`${s.replay?'REPLAY':s.running?'LIVE':'PAUSED'} · ${r.time.toFixed(2)} s`);
    set('[data-br-drop]',fmt(point.drop));set('[data-br-lateral]',fmt(point.lateral));set('[data-br-broken]',String(point.broken));set('[data-br-total]',`of ${s.model.links.length} links`);
    set('.br-selection',this.zone===null?'Whole bridge':bridgeZoneLabel(this.zone));
    this.host.querySelector('.br-groups')!.innerHTML=`<div class="br-group-head"><span>Component</span><span>Lost / total</span></div>${groups.map(g=>`<div><span>${g.label}</span><b class="${g.broken?'has-break':''}">${g.broken} / ${g.total}</b></div>`).join('')}`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-br-zone]').forEach(b=>{const i=Number(b.dataset.brZone),z=zones[i];b.disabled=!s.ready;b.setAttribute('aria-pressed',String(this.zone===i));b.querySelector('b')!.textContent=String(z.broken);b.classList.toggle('has-break',z.broken>0);b.title=`${bridgeZoneLabel(i)}: ${z.broken} of ${z.total} links lost · ${fmt(z.drop)} drop`;});
    this.drawMap(s);
    const milestones=bridgeMilestones(s.points,s.events,s.historyComplete);
    this.host.querySelector('.br-milestones')!.innerHTML=s.points.length<2?'<p class="br-empty">Run the bridge to record a failure timeline.</p>':`${!s.events.some(e=>e.type==='break')&&s.historyComplete?'<p class="br-empty">No rupture recorded in this run.</p>':''}${milestones.map(m=>`<button data-br-seek="${m.index}" ${!s.ready||m.index<0?'disabled':''} ${s.replay&&m.sampleTime!==undefined&&Math.abs(m.sampleTime-r.time)<.001?'aria-current="true"':''}><i class="ph ph-${m.key==='first'?'lightning':'play-circle'}" aria-hidden="true"></i><span><strong>${m.label}</strong><small>${esc(m.index<0?'Geometry no longer retained':m.detail)}${m.sampleTime!==undefined&&Math.abs(m.sampleTime-m.time)>.005?` · sample ${m.sampleTime.toFixed(2)} s`:''}</small></span><time>${m.time.toFixed(2)} s</time></button>`).join('')}`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-br-seek]').forEach(b=>b.onclick=()=>this.actions.seek(Number(b.dataset.brSeek)));
    const pause=this.host.querySelector<HTMLInputElement>('[data-br-pause]')!;pause.checked=s.pauseOnBreak;pause.disabled=!s.ready;
    this.drawComparison(s,point);
    const controls=[['[data-br-save]',s.ready&&!s.running&&s.points.length>1],['[data-br-load]',s.ready&&!s.running&&!!this.baseline],['[data-br-export]',s.ready&&s.points.length>1],['[data-br-clear]',!!this.baseline],['[data-br-overview]',s.ready]] as const;
    controls.forEach(([selector,enabled])=>this.host.querySelector<HTMLButtonElement>(selector)!.disabled=!enabled);
    set('[data-br-save]',this.baseline?'Replace baseline':'Save baseline');
  }
  private drawMap(s:BridgeReviewState):void {
    const paths:{[key:string]:string}={rest:'',intact:'',broken:'',selected:''};
    const projection=(i:number,initial:boolean)=>{
      const p=initial?s.model.nodes[i].rest:Array.from(s.snapshot.positions.subarray(i*3,i*3+3));
      return [18+(p[0]+21)*6.1,17+(14-p[1])*2.8+(i%4===1||i%4===3?74:0)];
    };
    s.model.links.forEach((l,index)=>{
      // Elevations show the two actual cable/deck planes; crossbeams and diagonal
      // bracing are counted in the breakdown, not drawn as misleading verticals.
      if(!['cable','hanger','deck'].includes(l.kind))return;
      const a=projection(l.a,false),b=projection(l.b,false),ra=projection(l.a,true),rb=projection(l.b,true);
      paths.rest+=`M${ra.join(',')}L${rb.join(',')}`;
      const selected=this.zone!==null&&bridgeZone((s.model.nodes[l.a].rest[0]+s.model.nodes[l.b].rest[0])/2)===this.zone;
      paths[s.snapshot.broken[index]?'broken':selected?'selected':'intact']+=`M${a.join(',')}L${b.join(',')}`;
    });
    this.host.querySelector('.br-map')!.innerHTML=`<svg viewBox="0 0 300 150" preserveAspectRatio="none" role="img" aria-label="Cable sides A and B at ${s.snapshot.response.time.toFixed(2)} seconds; dashed red lines are ruptured connections"><text x="18" y="10">SIDE A</text><text x="18" y="84">SIDE B</text>${Object.entries(paths).map(([kind,d])=>`<path class="br-path-${kind}" d="${d}"/>`).join('')}</svg>`;
  }
  private drawComparison(s:BridgeReviewState,current:BridgePoint):void {
    const baseline=this.baseline,series=[s.points,baseline?.points??[]],maxT=Math.max(1,...series.flatMap(p=>p.map(p=>p.time))),maxY=Math.max(.1,...series.flatMap(p=>p.map(p=>p.drop)))*1.1;
    const x=(time:number)=>24+time/maxT*258,y=(drop:number)=>81-drop/maxY*64;
    this.host.querySelector('.br-chart')!.innerHTML=`<svg viewBox="0 0 300 108"><path class="br-chart-grid" d="M24,17H282M24,49H282M24,81H282"/>${series.map((points,index)=>`<path class="br-chart-${index?'baseline':'current'}" d="${points.map((p,i)=>`${i&&p.time-points[i-1].time<.12?'L':'M'}${x(p.time).toFixed(2)},${y(p.drop).toFixed(2)}`).join('')}"/>`).join('')}<path class="br-chart-cursor" d="M${x(current.time)},12V85"/><text x="3" y="20">${maxY.toFixed(1)}</text><text x="11" y="84">0</text><text x="24" y="100">0 s</text><text x="282" y="100" text-anchor="end">${maxT.toFixed(1)} s</text></svg><div class="br-chart-legend"><span>● Current run</span><span>● ${baseline?'Saved baseline':'No baseline yet'}</span></div>`;
    const match=baseline&&bridgeComparison(baseline.points,current.time);
    this.host.querySelector('.br-comparison')!.textContent=baseline?match?`At ${match.time.toFixed(2)} s: ${delta(current.drop-match.drop)} drop · ${current.broken-match.broken>0?'+':''}${current.broken-match.broken} lost links vs baseline${Math.abs(match.time-current.time)>.005?` (current ${current.time.toFixed(2)} s)`:''}.`:'No matching baseline sample at this time. Replay within the saved time range.':'Pause after a run and save it. Your next run can be compared at the same model time.';
    this.host.querySelector('.br-baseline-meta')!.innerHTML=baseline?`<strong>${esc(baseline.name)}</strong><span>${baseline.points.at(-1)!.time.toFixed(2)} s captured · target ${baseline.settings.target.toFixed(2)} · strength ${baseline.settings.strength.toFixed(2)}× · wind ${baseline.settings.wind.toFixed(2)}</span><span>${baseline.historyComplete?'History from start':'Partial history'} · ${this.memoryOnly?'this session only':'saved locally'}${baseline.changes.some(c=>c.target!==baseline.settings.target||c.strength!==baseline.settings.strength||c.wind!==baseline.settings.wind)?' · controls changed during run':''}</span>`:'';
  }
}
