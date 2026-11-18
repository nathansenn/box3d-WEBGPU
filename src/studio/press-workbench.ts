import {METALS,PRESS_TOOLS,PRESS_ATTACHMENTS,THICKNESSES,STRIKE_SPEEDS,PRESS_EXPERIMENTS,metalFor,toolFor,toolDimensions,type PressSettings} from './press-settings';
import type {Snapshot,FailureSimulation} from './physics';
import {PressInspectionView} from './press-inspection-view';
import type {SectionAxis} from './press-inspection';
import './press-workbench.css';
import './press-inspection.css';
import './press-runs.css';
import {PressRunsView,type PressRunActions} from './press-runs-view';
import {PressDriveView} from './press-drive-view';
import type {PressDriveId} from './press-program';

type Step='metal'|'tool'|'stroke'|'runs';
function attachmentPreview(p:PressSettings):string {
  const faces:Record<PressSettings['tool'],string>={hex:'<path d="M92 0L46 79.674H-46L-92 0L-46 -79.674H46Z"/>',capsule:'<rect x="-42" y="-107" width="84" height="214" rx="42"/>',round:'<circle r="86"/>',wide:'<rect x="-142" y="-112" width="284" height="224"/>',ball:'<circle r="88"/>',cone:'<circle r="90"/><circle r="4" class="tool-tip"/>',square:'<rect x="-80" y="-80" width="160" height="160"/>',wedge:'<rect x="-58" y="-165" width="116" height="330"/><path d="M0 -165V165"/>',bead:'<rect x="-36" y="-155" width="72" height="310"/>',ring:'<path fill-rule="evenodd" d="M95 0a95 95 0 1 0 -190 0a95 95 0 1 0 190 0M51 0a51 51 0 1 1 -102 0a51 51 0 1 1 102 0"/>',cross:'<path d="M-27 -125H27V-27H125V27H27V125H-27V27H-125V-27H-27Z"/>','four-point':[-68,68].flatMap(x=>[-68,68].map(z=>`<circle cx="${x}" cy="${z}" r="30"/>`)).join('')};
  return `<svg viewBox="-235 -235 470 470" role="img" aria-label="${toolFor(p.tool).name} contact envelope, ${p.angle} degrees"><path class="tool-grid" d="M-210 0H210 M0 -210V210 M-200 -200H200V200H-200Z"/><g transform="rotate(${-p.angle}) scale(${p.toolScale})">${faces[p.tool]}</g></svg><div><span>CONTACT ENVELOPE</span><strong>${toolDimensions(p)}</strong><small>${p.angle}° rotation · ${p.toolScale.toFixed(2)}× size</small></div>`;
}
export class PressWorkbench {
  private step:Step='stroke';
  private host:HTMLElement;
  private busy=false;
  private viewingHistory=false;
  private settings:PressSettings;
  private inspection:PressInspectionView;
  private runs:PressRunsView;
  private driveView:PressDriveView;
  constructor(private root:HTMLElement,p:PressSettings,private change:(p:PressSettings,steady?:boolean)=>Promise<void>,private refresh:()=>void,private pressure:(value:number)=>boolean,onSection:(axis:SectionAxis,offset:number,visible:boolean)=>void,actions:PressRunActions&{drive:PressDriveId;chooseDrive:(id:PressDriveId)=>boolean}){
    this.settings={...p};this.host=document.createElement('div');this.host.className='press-workbench';
    root.querySelector('#desk-page-test')!.prepend(this.host);
    root.querySelector('.desk-heading h2')!.textContent='Press workbench';
    root.querySelector('.desk-kicker')!.textContent='MATERIAL FORGE / PRESS LAB';
    this.host.innerHTML=`<div class="press-ready-card"><span class="press-id">P–01 · FOUR COLUMN PRESS</span><strong>Shape. Yield. Break.</strong><p>Build a specimen. Choose a tool. Control the stroke.</p></div>
      <div class="press-steps" role="tablist" aria-label="Press configuration">${(['metal','tool','stroke','runs'] as const).map((k,i)=>`<button role="tab" id="press-step-${k}" data-press-step="${k}" aria-controls="press-page-${k}"><small>0${i+1}</small><span>${['Metal','Tooling','Stroke','Runs'][i]}</span></button>`).join('')}</div>
      <div class="press-selection" aria-live="polite"></div>
      <section id="press-page-metal" role="tabpanel" aria-labelledby="press-step-metal" hidden><div class="press-section"><h3>Specimen</h3><span>${METALS.length} metals</span></div><label for="press-metal">Metal profile</label><select id="press-metal">${[...new Set(METALS.map(m=>m.family))].map(f=>`<optgroup label="${f}">${METALS.filter(m=>m.family===f).map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</optgroup>`).join('')}</select><p class="press-description" id="press-metal-description"></p><div class="press-properties"></div>
      <div class="press-section"><h3>Sheet thickness</h3><output id="press-thickness-value"></output></div>${this.slider('thickness','Thickness',.5,20,.1,'mm')}<div class="press-gauges" role="group" aria-label="Sheet thickness presets">${THICKNESSES.map(t=>`<button data-press-thickness="${t}" aria-label="Thickness ${t} millimeters">${t}<small>mm</small></button>`).join('')}</div><p class="press-footnote">520 × 440 mm specimen. Thickness changes the visible edge, mass and resistance to bending.</p></section>
      <section id="press-page-tool" role="tabpanel" aria-labelledby="press-step-tool" hidden><div class="press-section"><h3>Quick change attachments</h3><span>${PRESS_TOOLS.length} contact shapes</span></div><label for="press-cartridge">Attachment configuration · ${PRESS_ATTACHMENTS.length} setups</label><select id="press-cartridge"><option value="">Custom attachment</option>${PRESS_TOOLS.map(t=>`<optgroup label="${t.name}">${PRESS_ATTACHMENTS.filter(a=>a.tool===t.id).map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</optgroup>`).join('')}</select><div class="press-tool-preview" aria-label="Attachment footprint"></div><div class="press-tools">${PRESS_TOOLS.map(t=>`<button data-press-tool="${t.id}" aria-label="Attachment: ${t.name}"><span aria-hidden="true">${t.symbol}</span><strong>${t.name}</strong></button>`).join('')}</div><p class="press-description" id="press-tool-description"></p>${this.slider('toolScale','Tool size',.65,1.3,.05,'×')}${this.slider('angle','Tool rotation',0,90,5,'°')}<p class="press-footnote">The contact face follows the selected shape, size and rotation.</p></section>
      <section id="press-page-stroke" role="tabpanel" aria-labelledby="press-step-stroke"><div class="press-section"><h3>Drive pressure</h3><span>Model capacity</span></div><div class="press-live-control"><span id="press-pressure-mode">NEXT STROKE</span><button id="press-program-toggle" type="button">Steady ↗</button><small id="press-pressure-help" class="press-visually-hidden">Pressure keeps this specimen.</small></div>${this.slider('pressure','Applied pressure',0,100,1,'%')}<div class="press-pressure-quick">${[15,40,65,100].map(v=>`<button data-press-pressure="${v}">${v}%</button>`).join('')}</div><div class="press-section"><h3>Strike speed</h3><span>Ram approach</span></div>${this.slider('strikeSpeed','Strike speed',2,250,1,'mm/s')}<div class="press-speed-quick">${STRIKE_SPEEDS.map(v=>`<button data-press-speed="${v}">${v}</button>`).join('')}</div>${this.slider('stroke','Stroke depth',5,140,5,'mm')}${this.slider('hold','Hold at depth',0,10,.5,'s')}<p class="press-footnote">A single stroke holds at depth, then retracts. Resistance can stall the ram before the depth limit. Playback speed is separate.</p></section>
      <section id="press-page-runs" role="tabpanel" aria-labelledby="press-step-runs" hidden></section><details class="press-model-note"><summary>About the material model</summary><p>Alloy profiles use authored relative stiffness, yield and rupture coefficients. Pressure is a percentage of this model’s drive capacity, not a calibrated hydraulic pressure or force. Dimensions use a 100 mm per scene unit display scale.</p><p>Pressure changes preserve the current specimen and recording. Set pressure to zero to retract. During retraction or after completion, pressure applies to the next stroke. Changing the metal, thickness, attachment, speed, depth or hold starts a fresh run. Export the recorded run before changing a setup you want to keep.</p></details>`;
    const setup=root.querySelector<HTMLElement>('#desk-page-setup')!;setup.classList.add('press-experiment-page');
    const catalogue=document.createElement('div');catalogue.className='press-experiments';catalogue.innerHTML=`<div class="press-section"><h3>Press experiments</h3><span>${PRESS_EXPERIMENTS.length} experiments</span></div><p class="press-description">Complete material, thickness, tooling and stroke combinations.</p><label for="press-experiment-filter">Find an experiment</label><input type="search" id="press-experiment-filter" placeholder="Try copper, thin or impact"><div class="press-intent-filter" role="group" aria-label="Experiment type">${['All','Form','Fracture','Compare'].map(i=>`<button data-press-intent="${i}" aria-pressed="${i==='All'}">${i}</button>`).join('')}</div><p class="press-filter-count" role="status">${PRESS_EXPERIMENTS.length} experiments</p><div class="press-experiment-list">${PRESS_EXPERIMENTS.map(e=>`<button data-press-experiment="${e.id}"><span>${e.intent}</span><strong>${e.name}</strong><small>${e.note}</small></button>`).join('')}</div>`;setup.prepend(catalogue);
    this.host.querySelectorAll<HTMLButtonElement>('[data-press-step]').forEach(b=>{
      b.onclick=()=>this.open(b.dataset.pressStep as Step);
      b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const steps:Step[]=['metal','tool','stroke','runs'],i=steps.indexOf(this.step);this.open(steps[e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4]);this.host.querySelector<HTMLButtonElement>(`#press-step-${this.step}`)!.focus();};
    });
    this.host.querySelector<HTMLSelectElement>('#press-metal')!.onchange=e=>void this.apply({metal:(e.target as HTMLSelectElement).value});
    for(const [attr,key] of [['thickness','thickness'],['tool','tool'],['pressure','pressure'],['speed','strikeSpeed']] as const)this.host.querySelectorAll<HTMLButtonElement>(`[data-press-${attr}]`).forEach(b=>b.onclick=()=>void this.apply({[key]:key==='tool'?b.dataset.pressTool:Number(b.getAttribute(`data-press-${attr}`))}));
    this.host.querySelectorAll<HTMLInputElement>('[data-press-input]').forEach(input=>{
      input.oninput=()=>{const key=input.dataset.pressInput!;this.host.querySelectorAll<HTMLInputElement>(`[data-press-input="${key}"]`).forEach(other=>{if(other!==input)other.value=input.value;});};
      input.onchange=()=>void this.apply({[input.dataset.pressInput!]:Number(input.value)});
      if(input.type==='number')input.onblur=()=>{const key=input.dataset.pressInput as keyof PressSettings;if(input.value!==''&&Number(input.value)!==this.settings[key])void this.apply({[key]:Number(input.value)});};
    });
    catalogue.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>b.onclick=()=>void this.apply(PRESS_EXPERIMENTS.find(e=>e.id===b.dataset.pressExperiment)!.settings,true));
    let intent='All';
    const filter=()=>{
      const query=catalogue.querySelector<HTMLInputElement>('input')!.value.trim().toLowerCase();let count=0;
      catalogue.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>{const e=PRESS_EXPERIMENTS.find(e=>e.id===b.dataset.pressExperiment)!;
        const haystack=[e.name,e.note,e.intent,metalFor(e.settings.metal).name,toolFor(e.settings.tool).name].join(' ').toLowerCase();
        b.hidden=(intent!=='All'&&e.intent!==intent)||!haystack.includes(query);if(!b.hidden)count++;
      });
      catalogue.querySelector('.press-filter-count')!.textContent=count?`${count} experiments`:'No matching experiments. Try a metal or another type.';
    };
    catalogue.querySelector<HTMLInputElement>('input')!.oninput=filter;
    catalogue.querySelectorAll<HTMLButtonElement>('[data-press-intent]').forEach(b=>b.onclick=()=>{intent=b.dataset.pressIntent!;catalogue.querySelectorAll('[data-press-intent]').forEach(e=>e.setAttribute('aria-pressed',String((e as HTMLElement).dataset.pressIntent===intent)));filter();});
    this.host.querySelector<HTMLSelectElement>('#press-cartridge')!.onchange=e=>{const a=PRESS_ATTACHMENTS.find(v=>v.id===(e.target as HTMLSelectElement).value);if(a)void this.apply({tool:a.tool,toolScale:a.toolScale,angle:a.angle});};
    root.querySelector('.viewport-wrap')!.insertAdjacentHTML('beforeend','<div class="press-telemetry" aria-label="Press telemetry"><div><span>RAM TRAVEL</span><strong id="press-live-travel">0.0 <small>mm</small></strong></div><div><span>DRIVE LEVEL</span><strong id="press-live-pressure">0 <small>%</small></strong></div><div><span>CYCLE</span><strong id="press-live-cycle">Ready</strong></div></div>');
    const top=root.querySelector<HTMLButtonElement>('[data-desk-camera=plan]');if(top){top.setAttribute('aria-label','Top cutaway');top.title='Top view · crown and ram hidden';}
    const detail=root.querySelector<HTMLButtonElement>('[data-desk-camera=connection]');if(detail){detail.dataset.deskCamera='detail';detail.setAttribute('aria-label','Tool contact');detail.querySelector('span')!.textContent='Contact';}
    this.inspection=new PressInspectionView(root,onSection);
    this.runs=new PressRunsView(root,this.host.querySelector<HTMLElement>('#press-page-runs')!,actions);
    this.driveView=new PressDriveView(root,actions.drive,actions.chooseDrive);
    this.open(this.step);this.sync(p);
  }
  private slider(key:keyof PressSettings,label:string,min:number,max:number,step:number,unit:string):string {
    return `<div class="press-control"><label for="press-${key}">${label}</label><div><input type="number" id="press-${key}-number" aria-label="${label} value" data-press-input="${key}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></div><input type="range" id="press-${key}" data-press-input="${key}" min="${min}" max="${max}" step="${step}"></div>`;
  }
  private open(step:Step):void {this.step=step;this.root.dataset.pressStep=step;for(const k of ['metal','tool','stroke','runs']){const b=this.host.querySelector<HTMLButtonElement>(`#press-step-${k}`)!;b.setAttribute('aria-selected',String(step===k));b.tabIndex=step===k?0:-1;(this.host.querySelector(`#press-page-${k}`) as HTMLElement).hidden=step!==k;}}
  syncDrive(id:PressDriveId):void {this.driveView.sync(id);}
  private async apply(p:Partial<PressSettings>,steady=false):Promise<void>{
    if(this.busy||this.root.dataset.deskBusy==='true'||this.root.dataset.renderReady!=='true')return;
    if(Object.keys(p).length===1&&p.pressure!==undefined){
      if(this.pressure(p.pressure)){this.refresh();this.root.querySelector('.desk-feedback')!.textContent=p.pressure===0?'Pressure released · deformation retained.':'Pressure updated · specimen and recording preserved.';}
      else{this.sync(this.settings);this.root.querySelector('.desk-feedback')!.textContent='Return to Live before adjusting pressure.';}
      return;
    }
    this.busy=true;this.root.dataset.deskBusy='true';this.disable(true);
    try{await this.change({...this.settings,...p},steady);this.root.querySelector('.desk-feedback')!.textContent='Setup applied · fresh specimen ready.';}
    catch{this.root.querySelector('.desk-feedback')!.textContent='Could not apply this setup. The previous run is intact.';this.sync(this.settings);}
    finally{this.busy=false;this.root.dataset.deskBusy='false';this.refresh();this.disable(false);}
  }
  disable(disabled:boolean):void {for(const e of this.root.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('.press-workbench input,.press-workbench select,.press-workbench button:not([data-press-step]),[data-press-experiment]'))e.disabled=disabled;}
  sync(p:PressSettings):void {
    this.settings={...p};const m=metalFor(p.metal),t=toolFor(p.tool);
    this.host.querySelector<HTMLSelectElement>('#press-metal')!.value=p.metal;
    this.host.querySelector('.press-selection')!.innerHTML=`<i style="background:${m.color}"></i><span><strong>${m.name} · ${p.thickness} mm</strong><small>${t.name} · ${p.strikeSpeed} mm/s · ${p.pressure}% pressure</small></span>`;
    this.host.querySelector('#press-metal-description')!.textContent=m.description;
    this.host.querySelector('#press-tool-description')!.textContent=t.description;
    this.host.querySelector<HTMLSelectElement>('#press-cartridge')!.value=PRESS_ATTACHMENTS.find(a=>a.tool===p.tool&&a.toolScale===p.toolScale&&a.angle===p.angle)?.id??'';
    this.host.querySelector('.press-tool-preview')!.innerHTML=attachmentPreview(p);
    this.host.querySelector('#press-thickness-value')!.textContent=`${p.thickness} mm`;
    this.host.querySelector('.press-properties')!.innerHTML=[['Rigidity',m.stiffness/1.85],['Yield resistance',m.yield/.082],['Ductility',m.rupture/.44]].map(([name,value])=>`<div><span>${name}</span><meter min="0" max="1" value="${value}"></meter></div>`).join('');
    this.host.querySelectorAll<HTMLInputElement>('[data-press-input]').forEach(i=>i.value=String(p[i.dataset.pressInput as keyof PressSettings]));
    for(const [attr,value] of [['tool',p.tool],['thickness',p.thickness],['speed',p.strikeSpeed],['pressure',p.pressure]])this.host.querySelectorAll<HTMLButtonElement>(`[data-press-${attr}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute(`data-press-${attr}`)===String(value))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>b.setAttribute('aria-pressed',String(JSON.stringify(PRESS_EXPERIMENTS.find(e=>e.id===b.dataset.pressExperiment)!.settings)===JSON.stringify(p))));
    this.root.dataset.pressSettings=JSON.stringify(p);
  }
  telemetry(snapshot:Snapshot,sim:FailureSimulation,history=false,recordedPressure?:number,displayedDrive:PressDriveId='steady'):void {const t=snapshot.press;if(!t)return;this.inspection.update(snapshot,sim,history);
    if(history){
      const pressure=recordedPressure??t.settings.pressure;
      this.host.querySelectorAll<HTMLInputElement>('[data-press-input=pressure]').forEach(e=>e.value=String(pressure));
      this.host.querySelectorAll<HTMLButtonElement>('[data-press-pressure]').forEach(e=>e.setAttribute('aria-pressed',String(Number(e.dataset.pressPressure)===pressure)));
      this.host.querySelector('.press-selection small')!.textContent=`${toolFor(this.settings.tool).name} · ${this.settings.strikeSpeed} mm/s · ${pressure.toFixed(1)}% recorded pressure`;
    }else if(this.viewingHistory)this.sync(this.settings);
    this.viewingHistory=history;
    const active=!['Ready','Retracting','Complete'].includes(t.cycle);
    this.host.querySelector('#press-pressure-mode')!.textContent=history?'REPLAY':active?'LIVE PRESSURE':'NEXT STROKE';
    this.host.querySelector('.press-live-control')!.classList.toggle('active',active&&!history);
    this.host.querySelector('#press-pressure-help')!.textContent=history?'Return to Live to change pressure.':active?'Adjust without resetting the metal.':'Pressure keeps this specimen.';
    this.host.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-press-input=pressure],[data-press-pressure]').forEach(e=>e.disabled=history||this.busy||this.root.dataset.deskBusy==='true');this.root.querySelector('#press-live-travel')!.innerHTML=`${t.travel.toFixed(1)} <small>mm</small>`;this.root.querySelector('#press-live-pressure')!.innerHTML=`${t.pressure.toFixed(0)} <small>%</small>`;this.root.querySelector('#press-live-cycle')!.textContent=t.cycle;this.root.dataset.pressCycle=t.cycle;this.root.dataset.ramTravel=t.travel.toFixed(3);
    this.driveView.sync(displayedDrive);this.driveView.update(history||this.busy||this.root.dataset.deskBusy==='true',recordedPressure??this.settings.pressure);
    this.runs.update(snapshot,history,this.step==='runs');
  }
}
