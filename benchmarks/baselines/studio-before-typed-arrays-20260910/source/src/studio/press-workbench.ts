import {METALS,PRESS_TOOLS,THICKNESSES,STRIKE_SPEEDS,PRESS_EXPERIMENTS,metalFor,toolFor,type PressSettings} from './press-settings';
import type {PressTelemetry} from './physics';
import './press-workbench.css';

type Step='metal'|'tool'|'stroke';
export class PressWorkbench {
  private step:Step='stroke';
  private host:HTMLElement;
  private busy=false;
  private settings:PressSettings;
  constructor(private root:HTMLElement,p:PressSettings,private change:(p:PressSettings)=>Promise<void>,private refresh:()=>void){
    this.settings={...p};this.host=document.createElement('div');this.host.className='press-workbench';
    root.querySelector('#desk-page-test')!.prepend(this.host);
    root.querySelector('.desk-heading h2')!.textContent='Press workbench';
    root.querySelector('.desk-kicker')!.textContent='MATERIAL FORGE / PRESS LAB';
    this.host.innerHTML=`<div class="press-ready-card"><span class="press-id">P–01 · FOUR COLUMN PRESS</span><strong>Shape. Yield. Break.</strong><p>Build a specimen. Choose a tool. Control the stroke.</p></div>
      <div class="press-steps" role="tablist" aria-label="Press configuration">${(['metal','tool','stroke'] as const).map((k,i)=>`<button role="tab" id="press-step-${k}" data-press-step="${k}" aria-controls="press-page-${k}"><small>0${i+1}</small><span>${['Metal','Tooling','Stroke'][i]}</span></button>`).join('')}</div>
      <div class="press-selection" aria-live="polite"></div>
      <section id="press-page-metal" role="tabpanel" aria-labelledby="press-step-metal" hidden><div class="press-section"><h3>Specimen</h3><span>16 metals</span></div><label for="press-metal">Metal profile</label><select id="press-metal">${[...new Set(METALS.map(m=>m.family))].map(f=>`<optgroup label="${f}">${METALS.filter(m=>m.family===f).map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</optgroup>`).join('')}</select><p class="press-description" id="press-metal-description"></p><div class="press-properties"></div>
      <div class="press-section"><h3>Sheet thickness</h3><output id="press-thickness-value"></output></div><div class="press-gauges" role="group" aria-label="Sheet thickness presets">${THICKNESSES.map(t=>`<button data-press-thickness="${t}" aria-label="Thickness ${t} millimeters">${t}<small>mm</small></button>`).join('')}</div><p class="press-footnote">520 × 440 mm specimen. Thickness changes the visible edge, mass and resistance to bending.</p></section>
      <section id="press-page-tool" role="tabpanel" aria-labelledby="press-step-tool" hidden><div class="press-section"><h3>Quick change attachments</h3><span>10 tools</span></div><div class="press-tools">${PRESS_TOOLS.map(t=>`<button data-press-tool="${t.id}" aria-label="Attachment: ${t.name}"><span aria-hidden="true">${t.symbol}</span><strong>${t.name}</strong></button>`).join('')}</div><p class="press-description" id="press-tool-description"></p>${this.slider('toolScale','Tool size',.65,1.3,.05,'×')}${this.slider('angle','Tool rotation',0,90,5,'°')}<p class="press-footnote">The contact face follows the selected shape, size and rotation.</p></section>
      <section id="press-page-stroke" role="tabpanel" aria-labelledby="press-step-stroke"><div class="press-section"><h3>Drive pressure</h3><span>Model capacity</span></div>${this.slider('pressure','Applied pressure',0,100,1,'%')}<div class="press-pressure-quick">${[15,40,65,100].map(v=>`<button data-press-pressure="${v}">${v}%</button>`).join('')}</div><div class="press-section"><h3>Strike speed</h3><span>Ram approach</span></div>${this.slider('strikeSpeed','Strike speed',2,250,1,'mm/s')}<div class="press-speed-quick">${STRIKE_SPEEDS.map(v=>`<button data-press-speed="${v}">${v}</button>`).join('')}</div>${this.slider('stroke','Stroke depth',5,140,5,'mm')}${this.slider('hold','Hold at depth',0,10,.5,'s')}<p class="press-footnote">A single stroke holds at depth, then retracts. Resistance can stall the ram before the depth limit. Playback speed is separate.</p></section>
      <details class="press-model-note"><summary>About the material model</summary><p>Alloy profiles use authored relative stiffness, yield and rupture coefficients. Pressure is a percentage of this model’s drive capacity, not a calibrated hydraulic pressure or force. Dimensions use a 100 mm per scene unit display scale.</p><p>Changing a specimen, attachment or stroke setting starts a fresh run. Export the recorded run before changing a setup you want to keep.</p></details>`;
    const setup=root.querySelector<HTMLElement>('#desk-page-setup')!;setup.classList.add('press-experiment-page');
    const catalogue=document.createElement('div');catalogue.className='press-experiments';catalogue.innerHTML=`<div class="press-section"><h3>Press experiments</h3><span>20 starting points</span></div><p class="press-description">Complete material, thickness, tooling and stroke combinations.</p><label for="press-experiment-filter">Find an experiment</label><input type="search" id="press-experiment-filter" placeholder="Try copper, thin or impact"><div class="press-experiment-list">${PRESS_EXPERIMENTS.map(e=>`<button data-press-experiment="${e.id}"><span>${e.intent}</span><strong>${e.name}</strong><small>${e.note}</small></button>`).join('')}</div>`;setup.prepend(catalogue);
    this.host.querySelectorAll<HTMLButtonElement>('[data-press-step]').forEach(b=>{
      b.onclick=()=>this.open(b.dataset.pressStep as Step);
      b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const steps:Step[]=['metal','tool','stroke'],i=steps.indexOf(this.step);this.open(steps[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3]);this.host.querySelector<HTMLButtonElement>(`#press-step-${this.step}`)!.focus();};
    });
    this.host.querySelector<HTMLSelectElement>('#press-metal')!.onchange=e=>void this.apply({metal:(e.target as HTMLSelectElement).value});
    for(const [attr,key] of [['thickness','thickness'],['tool','tool'],['pressure','pressure'],['speed','strikeSpeed']] as const)this.host.querySelectorAll<HTMLButtonElement>(`[data-press-${attr}]`).forEach(b=>b.onclick=()=>void this.apply({[key]:key==='tool'?b.dataset.pressTool:Number(b.getAttribute(`data-press-${attr}`))}));
    this.host.querySelectorAll<HTMLInputElement>('[data-press-input]').forEach(input=>{
      input.oninput=()=>{const key=input.dataset.pressInput!;this.host.querySelectorAll<HTMLInputElement>(`[data-press-input="${key}"]`).forEach(other=>{if(other!==input)other.value=input.value;});};
      input.onchange=()=>void this.apply({[input.dataset.pressInput!]:Number(input.value)});
      if(input.type==='number')input.onblur=()=>{const key=input.dataset.pressInput as keyof PressSettings;if(input.value!==''&&Number(input.value)!==this.settings[key])void this.apply({[key]:Number(input.value)});};
    });
    catalogue.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>b.onclick=()=>void this.apply(PRESS_EXPERIMENTS.find(e=>e.id===b.dataset.pressExperiment)!.settings));
    catalogue.querySelector<HTMLInputElement>('input')!.oninput=e=>{const query=(e.target as HTMLInputElement).value.trim().toLowerCase();catalogue.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>b.hidden=!b.textContent!.toLowerCase().includes(query));};
    root.querySelector('.viewport-wrap')!.insertAdjacentHTML('beforeend','<div class="press-telemetry" aria-label="Press telemetry"><div><span>RAM TRAVEL</span><strong id="press-live-travel">0.0 <small>mm</small></strong></div><div><span>DRIVE</span><strong id="press-live-pressure">0 <small>%</small></strong></div><div><span>CYCLE</span><strong id="press-live-cycle">Ready</strong></div></div>');
    const top=root.querySelector<HTMLButtonElement>('[data-desk-camera=plan]');if(top){top.setAttribute('aria-label','Top cutaway');top.title='Top view · crown and ram hidden';}
    const detail=root.querySelector<HTMLButtonElement>('[data-desk-camera=connection]');if(detail){detail.dataset.deskCamera='detail';detail.setAttribute('aria-label','Tool contact');detail.querySelector('span')!.textContent='Contact';}
    this.open(this.step);this.sync(p);
  }
  private slider(key:keyof PressSettings,label:string,min:number,max:number,step:number,unit:string):string {
    return `<div class="press-control"><label for="press-${key}">${label}</label><div><input type="number" id="press-${key}-number" aria-label="${label} value" data-press-input="${key}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></div><input type="range" id="press-${key}" data-press-input="${key}" min="${min}" max="${max}" step="${step}"></div>`;
  }
  private open(step:Step):void {this.step=step;for(const k of ['metal','tool','stroke']){const b=this.host.querySelector<HTMLButtonElement>(`#press-step-${k}`)!;b.setAttribute('aria-selected',String(step===k));b.tabIndex=step===k?0:-1;(this.host.querySelector(`#press-page-${k}`) as HTMLElement).hidden=step!==k;}}
  private async apply(p:Partial<PressSettings>):Promise<void>{
    if(this.busy||this.root.dataset.deskBusy==='true'||this.root.dataset.renderReady!=='true')return;
    this.busy=true;this.root.dataset.deskBusy='true';this.disable(true);
    try{await this.change({...this.settings,...p});this.root.querySelector('.desk-feedback')!.textContent='Setup applied · fresh specimen ready.';}
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
    this.host.querySelector('#press-thickness-value')!.textContent=`${p.thickness} mm`;
    this.host.querySelector('.press-properties')!.innerHTML=[['Rigidity',m.stiffness/1.7],['Yield resistance',m.yield/.072],['Ductility',m.rupture/.44]].map(([name,value])=>`<div><span>${name}</span><meter min="0" max="1" value="${value}"></meter></div>`).join('');
    this.host.querySelectorAll<HTMLInputElement>('[data-press-input]').forEach(i=>i.value=String(p[i.dataset.pressInput as keyof PressSettings]));
    for(const [attr,value] of [['tool',p.tool],['thickness',p.thickness],['speed',p.strikeSpeed],['pressure',p.pressure]])this.host.querySelectorAll<HTMLButtonElement>(`[data-press-${attr}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute(`data-press-${attr}`)===String(value))));
    this.root.querySelectorAll<HTMLButtonElement>('[data-press-experiment]').forEach(b=>b.setAttribute('aria-pressed',String(JSON.stringify(PRESS_EXPERIMENTS.find(e=>e.id===b.dataset.pressExperiment)!.settings)===JSON.stringify(p))));
    this.root.dataset.pressSettings=JSON.stringify(p);
  }
  telemetry(t?:PressTelemetry):void {if(!t)return;this.root.querySelector('#press-live-travel')!.innerHTML=`${t.travel.toFixed(1)} <small>mm</small>`;this.root.querySelector('#press-live-pressure')!.innerHTML=`${t.pressure.toFixed(0)} <small>%</small>`;this.root.querySelector('#press-live-cycle')!.textContent=t.cycle;this.root.dataset.pressCycle=t.cycle;this.root.dataset.ramTravel=t.travel.toFixed(3);}
}
