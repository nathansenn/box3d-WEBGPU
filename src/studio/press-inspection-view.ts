import {PressSectionSampler,pressInspectionValues,type SectionAxis} from './press-inspection';
import {metalFor} from './press-settings';
import type {FailureSimulation,Snapshot} from './physics';

export class PressInspectionView {
  private element:HTMLElement;
  private axis:SectionAxis='x';
  private offsets:Record<SectionAxis,number>={x:0,z:0};
  private sampler?:PressSectionSampler;
  private simulation?:FailureSimulation;
  private last?:Snapshot;
  private history=false;
  constructor(private root:HTMLElement,private onSection:(axis:SectionAxis,offset:number,visible:boolean)=>void){
    this.element=document.createElement('details');this.element.className='press-inspection';this.element.setAttribute('open','');
    this.element.innerHTML=`<summary><span><i></i>BEND & FRACTURE</span><small id="press-inspect-stage">Ready</small><b aria-hidden="true">⌄</b></summary>
      <div class="press-inspection-body"><div class="press-failure-stages" aria-label="Material response"><span data-stage="Elastic">Elastic</span><span data-stage="Permanent set">Permanent set</span><span data-stage="Cracking">Cracking</span></div>
      <div class="press-inspection-readout"><dl><div><dt>Deflection</dt><dd id="press-inspect-deflection">0.0 <small>mm</small></dd></div><div><dt>Plastic stretch · max</dt><dd id="press-inspect-plastic">0.0 <small>%</small></dd></div><div><dt>Broken connections</dt><dd id="press-inspect-broken">0</dd></div></dl>
      <div class="press-section-chart"><div class="press-section-chart-heading"><span>Sheet section</span><div role="group" aria-label="Section direction"><button data-section-axis="x" aria-pressed="true">X</button><button data-section-axis="z" aria-pressed="false">Z</button></div></div>
      <svg viewBox="0 0 310 108" role="img" aria-label="Sheet section. Dashed line is the original sheet; orange is its current shape."><path class="section-grid" d="M30 18H298 M30 55H298 M30 92H298"/><path class="section-original" d="M30 18H298"/><text x="2" y="21">0</text><text id="press-section-mid" x="0" y="58">−80</text><text id="press-section-bottom" x="0" y="95">−160</text><path class="section-current" id="press-section-path" d="M30 18H298"/></svg>
      <div class="press-section-key"><span><i></i>Original</span><span><i></i>Deformed</span><small id="press-section-gaps">No section gaps</small></div></div></div>
      <div class="press-slice-control"><label for="press-slice-position">Slice position <output id="press-slice-value">Z 0 mm</output></label><input id="press-slice-position" type="range" min="0" max="28" step="1" value="14" aria-valuetext="Z 0 millimeters"><div><span id="press-slice-min">−220 mm</span><button id="press-slice-center">Center</button><span id="press-slice-max">+220 mm</span></div></div>
      <p class="press-inspection-note" id="press-inspect-note">Run a stroke to inspect the sheet. Release the load to inspect recovery.</p>
      <div class="press-inspection-actions"><button id="press-inspect-contact">Inspect contact <span>↗</span></button><button id="press-inspect-release">Release & recover <span>↑</span></button></div></div>`;
    root.querySelector('.viewport-wrap')!.append(this.element);
    if(window.innerWidth<=800)this.element.removeAttribute('open');
    this.element.querySelectorAll<HTMLButtonElement>('[data-section-axis]').forEach(b=>b.onclick=()=>{
      this.axis=b.dataset.sectionAxis as SectionAxis;
      this.element.querySelectorAll('[data-section-axis]').forEach(v=>v.setAttribute('aria-pressed',String((v as HTMLElement).dataset.sectionAxis===this.axis)));
      this.refreshSection();
    });
    this.element.querySelector<HTMLInputElement>('#press-slice-position')!.oninput=e=>{
      if(!this.simulation)return;const {cols,rows,span,depth}=this.simulation.config;
      const slices=this.axis==='x'?rows:cols,limit=(this.axis==='x'?depth:span)*50;
      this.offsets[this.axis]=(2*Number((e.target as HTMLInputElement).value)/(slices-1)-1)*limit;this.refreshSection();
    };
    this.element.querySelector<HTMLButtonElement>('#press-slice-center')!.onclick=()=>{this.offsets[this.axis]=0;this.refreshSection();};
    this.element.ontoggle=()=>this.onSection(this.axis,this.offsets[this.axis],(this.element as HTMLDetailsElement).open);
    this.element.querySelector<HTMLButtonElement>('#press-inspect-contact')!.onclick=()=>root.querySelector<HTMLButtonElement>('[data-desk-camera="detail"]')?.click();
    this.element.querySelector<HTMLButtonElement>('#press-inspect-release')!.onclick=()=>root.querySelector<HTMLButtonElement>('[data-action="unload"]')?.click();
  }
  private refreshSection():void {
    if(this.last&&this.simulation)this.update(this.last,this.simulation,this.history);
    this.onSection(this.axis,this.offsets[this.axis],(this.element as HTMLDetailsElement).open);
  }
  update(s:Snapshot,sim:FailureSimulation,history=false):void {
    if(!s.press)return;this.last=s;this.history=history;
    if(this.simulation!==sim){this.simulation=sim;this.sampler=new PressSectionSampler(sim);this.onSection(this.axis,this.offsets[this.axis],(this.element as HTMLDetailsElement).open);}
    const v=pressInspectionValues(s),section=this.sampler!.sample(s,this.axis,this.offsets[this.axis]),m=metalFor(s.press.settings.metal);
    const text=(id:string,value:string)=>{this.element.querySelector(id)!.textContent=value;};
    text('#press-inspect-stage',history?`Replay · ${v.stage}`:v.stage);this.element.dataset.stage=v.stage;
    text('#press-inspect-deflection',`${v.deflection.toFixed(1)} mm`);text('#press-inspect-plastic',`${v.plastic.toFixed(1)} %`);text('#press-inspect-broken',String(v.broken));
    this.element.querySelectorAll('[data-stage]').forEach(e=>e.classList.toggle('active',(e as HTMLElement).dataset.stage===v.stage));
    const range=Math.max(80,Math.ceil(Math.max(...section.points.map(p=>Math.abs(p.displacement)))/40)*40);
    text('#press-section-mid',`−${range/2}`);text('#press-section-bottom',`−${range}`);
    const path=section.points.map((p,i)=>`${i===0||!p.connected?'M':'L'}${(30+(p.position/section.span+.5)*268).toFixed(2)},${(18-p.displacement*74/range).toFixed(2)}`).join(' ');
    this.element.querySelector('#press-section-path')!.setAttribute('d',path);
    text('#press-section-gaps',section.gaps?`${section.gaps} section gaps`:'No section gaps');
    const position=`${this.axis==='x'?'Z':'X'} ${section.offset>0?'+':''}${section.offset.toFixed(1)} mm`;
    text('#press-slice-value',position);text('#press-slice-min',`−${Math.round(section.limit)} mm`);text('#press-slice-max',`+${Math.round(section.limit)} mm`);
    const slider=this.element.querySelector<HTMLInputElement>('#press-slice-position')!;
    slider.max=String(section.slices-1);slider.value=String(section.index);slider.setAttribute('aria-valuetext',position.replace('mm','millimeters'));
    this.element.querySelector('svg')!.setAttribute('aria-label',`${history?'Recorded':'Live'} ${this.axis.toUpperCase()} sheet section at ${position}. ${section.gaps} gaps. Vertical scale 0 to minus ${range} millimeters.`);
    text('#press-inspect-note',v.broken?'Cracks follow failed connections. Gaps in this section show missing surface.':v.plastic>0?'Permanent stretch has developed. Release the load to observe elastic recovery.':'The sheet can spring back before yielding. Watch the section as the tool makes contact.');
    if(history)text('#press-inspect-note',`Recorded section at ${s.response.time.toFixed(2)} s. Return to Live before releasing the load.`);
    const legend=this.root.querySelector('.strain-legend');
    if(legend){legend.querySelector('span')!.textContent=`${m.name.toUpperCase()} · CONNECTION STRAIN`;legend.querySelector('span:last-child')!.textContent=`Yield ${(m.yield*sim.strength*100).toFixed(1)}% · Nominal rupture ${(m.rupture*sim.strength*100).toFixed(1)}%`;}
    this.root.dataset.pressInspection=JSON.stringify({...v,axis:this.axis,sectionOffset:section.offset,sectionGaps:section.gaps,time:s.response.time,history});
    const release=this.element.querySelector<HTMLButtonElement>('#press-inspect-release')!;
    release.disabled=history||this.root.dataset.renderReady!=='true'||s.response.time===0||this.root.dataset.deskBusy==='true';
    release.title=history?'Return to Live to release the current load.':'Retract the tool and observe remaining deformation.';
  }
}
