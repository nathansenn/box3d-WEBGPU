import {metalFor,toolFor} from './press-settings';
import {pressDriveFor} from './press-program';
import {addPressRun,decodePressRuns,encodePressRuns,PRESS_RUN_STORAGE_KEY,type PressRun} from './press-runs';
import type {Snapshot} from './physics';

export interface PressRunActions {report:()=>PressRun;seek:(time:number)=>void}
const specimen=(r:PressRun)=>`${metalFor(r.settings.metal).name} · ${r.settings.thickness} mm`;
export class PressRunsView {
  private saved:PressRun[]=[];
  private selected='';
  private history=false;
  private markers:HTMLElement;
  constructor(private root:HTMLElement,private host:HTMLElement,private actions:PressRunActions){
    try{this.saved=decodePressRuns(localStorage.getItem(PRESS_RUN_STORAGE_KEY));}catch{/* Private browsing may disable storage. */}
    this.selected=this.saved[0]?.id??'';
    host.innerHTML=`<div class="press-run-heading"><h3>Run response</h3><span id="press-run-state">Ready</span></div>
      <div class="press-run-legend"><span>Current</span><span>Reference</span><small>Deflection · mm</small></div>
      <svg class="press-run-chart" viewBox="0 0 300 156" role="img" aria-label="Current and reference deflection over simulation time"><path class="run-grid" d="M32 14H288M32 72H288M32 130H288"/><text id="press-run-ymax" x="0" y="18">0</text><text x="18" y="134">0</text><text x="32" y="151">0 s</text><text id="press-run-end" x="288" y="151" text-anchor="end">0 s</text><path id="press-reference-curve" class="reference-curve"/><path id="press-current-curve" class="current-curve"/><path id="press-run-cursor" class="run-cursor"/></svg>
      <label for="press-reference-run">Compare with a saved run</label><select id="press-reference-run"></select>
      <div class="press-run-specimens"><div><span>CURRENT</span><strong id="press-run-current-name"></strong><small id="press-run-current-tool"></small></div><div><span>REFERENCE</span><strong id="press-run-reference-name">Save a run first</strong><small id="press-run-reference-tool"></small></div></div>
      <table class="press-run-table"><thead><tr><th>Response</th><th>Current</th><th>Reference</th></tr></thead><tbody>${[['peakBend','Peak bend','mm'],['finalBend','Last bend','mm'],['recovery','Recovered','mm'],['plastic','Plastic stretch','%'],['broken','Broken links','']].map(([key,label,unit])=>`<tr><th>${label}</th><td data-current-metric="${key}" data-unit="${unit}">—</td><td data-reference-metric="${key}" data-unit="${unit}">—</td></tr>`).join('')}</tbody></table>
      <p class="press-run-differences" id="press-run-differences">Save this specimen, change one setting, then compare the next run.</p>
      <div class="press-run-milestones"><button data-press-milestone="firstYield"><span>First recorded yield</span><strong>—</strong></button><button data-press-milestone="firstCrack"><span>First recorded crack</span><strong>—</strong></button></div>
      <p class="press-run-history" id="press-run-history"></p>
      <div class="press-run-actions"><button id="press-save-run">Save comparison</button><button id="press-remove-run">Remove reference</button></div><p class="press-run-storage" role="status">Up to four runs, saved in this browser. Newest replaces oldest.</p>`;
    const dock=document.createElement('div');dock.className='press-runs-dock';
    dock.append(host.querySelector('.press-run-actions')!,host.querySelector('.press-run-storage')!);
    root.querySelector('.load-inspector')!.append(dock);
    this.markers=document.createElement('div');this.markers.className='press-run-markers';
    this.markers.innerHTML='<button data-press-marker="firstYield" hidden>Y</button><button data-press-marker="firstCrack" hidden>C</button>';
    root.querySelector('.timeline-track')!.append(this.markers);
    for(const container of [host,this.markers])container.querySelectorAll<HTMLButtonElement>('[data-press-milestone],[data-press-marker]').forEach(b=>b.onclick=()=>{
      const key=(b.dataset.pressMilestone??b.dataset.pressMarker) as 'firstYield'|'firstCrack',time=this.actions.report().metrics[key];if(time!==null)this.actions.seek(time);
    });
    host.querySelector<HTMLSelectElement>('#press-reference-run')!.onchange=e=>{this.selected=(e.target as HTMLSelectElement).value;this.render(this.actions.report());};
    root.querySelector<HTMLButtonElement>('#press-save-run')!.onclick=()=>{
      const current=this.actions.report();if(this.history||current.points.at(-1)!.time<=0||this.root.dataset.deskBusy==='true'||this.root.dataset.renderReady!=='true')return;
      const run={...current,id:crypto.randomUUID(),createdAt:new Date().toISOString()};this.saved=addPressRun(this.saved,run);this.selected=run.id;this.persist('Comparison saved');
    };
    root.querySelector<HTMLButtonElement>('#press-remove-run')!.onclick=()=>{this.saved=this.saved.filter(r=>r.id!==this.selected);this.selected=this.saved[0]?.id??'';this.persist('Reference removed');};
    this.options();
  }
  private options():void {
    const select=this.host.querySelector<HTMLSelectElement>('#press-reference-run')!;
    select.replaceChildren(new Option('No reference selected',''),...this.saved.map(r=>new Option(`${specimen(r)} · ${r.settings.strikeSpeed} mm/s · ${new Date(r.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`,r.id)));
    select.value=this.selected;
  }
  private persist(message:string):void {
    let stored=true;try{localStorage.setItem(PRESS_RUN_STORAGE_KEY,encodePressRuns(this.saved));}catch{stored=false;}
    this.options();this.render(this.actions.report());
    this.root.querySelector('.press-run-storage')!.textContent=stored?`${message} · ${this.saved.length}/4 saved in this browser.`:`${message} for this page only; browser storage is unavailable.`;
  }
  update(snapshot:Snapshot,history:boolean,visible:boolean):void {
    this.history=history;const report=this.actions.report(),duration=report.points.at(-1)?.time??0;
    this.markers.querySelectorAll<HTMLButtonElement>('button').forEach(b=>{
      const key=b.dataset.pressMarker as 'firstYield'|'firstCrack',time=report.metrics[key];b.hidden=time===null||duration===0;
      if(time!==null){b.style.left=`${time/Math.max(duration,.01)*100}%`;b.title=`First recorded ${key==='firstYield'?'yield':'crack'} · ${time.toFixed(2)} s`;b.setAttribute('aria-label',b.title);}
    });
    if(visible)this.render(report,snapshot.response.time);
  }
  private render(current:PressRun,cursor=current.points.at(-1)?.time??0):void {
    const reference=this.saved.find(r=>r.id===this.selected),text=(id:string,value:string)=>{this.host.querySelector(id)!.textContent=value;};
    const duration=Math.max(10,current.points.at(-1)?.time??0,reference?.points.at(-1)?.time??0),height=Math.max(20,Math.ceil(Math.max(current.metrics.peakBend,reference?.metrics.peakBend??0)/20)*20);
    const curve=(r:PressRun)=>r.points.map((p,i)=>`${i===0||(!r.historyComplete&&p.time-r.points[i-1].time>.2)?'M':'L'}${(32+p.time/duration*256).toFixed(2)},${(130-p.bend/height*116).toFixed(2)}`).join(' ');
    this.host.querySelector('#press-current-curve')!.setAttribute('d',curve(current));this.host.querySelector('#press-reference-curve')!.setAttribute('d',reference?curve(reference):'');
    this.host.querySelector('#press-run-cursor')!.setAttribute('d',`M${32+cursor/duration*256} 14V130`);
    text('#press-run-ymax',String(height));text('#press-run-end',`${duration.toFixed(1)} s`);
    text('#press-run-state',this.history?'Replay cursor':current.complete?'Cycle complete':current.points.at(-1)!.time>0?'Partial run':'Ready');
    text('#press-run-current-name',specimen(current));text('#press-run-reference-name',reference?specimen(reference):'Save a run first');
    const describe=(r:PressRun)=>`${toolFor(r.settings.tool).name} · ${r.settings.strikeSpeed} mm/s · ${r.drives.map(d=>pressDriveFor(d).name).join(' → ')}`;
    text('#press-run-current-tool',describe(current));text('#press-run-reference-tool',reference?describe(reference):'Then change a setting and run again.');
    for(const [prefix,run] of [['current',current],['reference',reference]] as const)this.host.querySelectorAll<HTMLElement>(`[data-${prefix}-metric]`).forEach(e=>{
      const key=e.dataset[prefix==='current'?'currentMetric':'referenceMetric'] as keyof PressRun['metrics'],value=run?.metrics[key];
      e.textContent=value===undefined||value===null?'—':`${key==='broken'?value:value.toFixed(1)}${e.dataset.unit?' '+e.dataset.unit:''}`;
    });
    const labels={metal:'Metal',thickness:'Thickness',tool:'Tool',toolScale:'Tool size',angle:'Rotation',pressure:'Pressure limit',strikeSpeed:'Strike speed',stroke:'Depth',hold:'Hold'};
    if(reference){const changed=Object.entries(labels).filter(([key])=>current.settings[key as keyof typeof labels]!==reference.settings[key as keyof typeof labels]).map(([,label])=>label);if(current.drives.join()!==reference.drives.join())changed.push('Pressure program');if(current.backend!==reference.backend)changed.push('Numerical backend');text('#press-run-differences',changed.length?`Changed: ${changed.join(', ')}.`:'Matching setup. Compare repeatability and pressure changes within each run.');}
    else text('#press-run-differences','Save this specimen, change one setting, then compare the next run.');
    this.host.querySelectorAll<HTMLButtonElement>('[data-press-milestone]').forEach(b=>{const time=current.metrics[b.dataset.pressMilestone as 'firstYield'|'firstCrack'];b.disabled=time===null;b.querySelector('strong')!.textContent=time===null?'Not recorded':`${time.toFixed(2)} s ↗`;});
    text('#press-run-history',!current.historyComplete?'Earlier geometry history is unavailable. Onset shortcuts are disabled.':this.history?`Viewing ${cursor.toFixed(2)} s. The table summarizes the entire recorded run. Return to Live to save.`:'Recorded at 0.1 s intervals. Click a milestone to inspect its shape; final bend requires a complete cycle.');
    this.host.querySelector('[data-current-metric="finalBend"]')!.closest('tr')!.querySelector('th')!.textContent=current.complete&&(!reference||reference.complete)?'Final bend':'Last bend';
    this.root.querySelector<HTMLButtonElement>('#press-save-run')!.disabled=this.history||current.points.at(-1)!.time<=0||this.root.dataset.deskBusy==='true'||this.root.dataset.renderReady!=='true';
    this.root.querySelector<HTMLButtonElement>('#press-remove-run')!.disabled=!reference;
    this.root.dataset.pressRunReport=JSON.stringify({current:current.metrics,reference:reference?.metrics??null,saved:this.saved.length,historyComplete:current.historyComplete,complete:current.complete,history:this.history});
  }
}
