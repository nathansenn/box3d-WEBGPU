import {PRESS_DRIVES,pressDriveFor,pressDrivePressure,type PressDriveId} from './press-program';

/** A pressure recipe is chosen before a fresh run; a manual adjustment returns to steady drive. */
export class PressDriveView {
  private dialog:HTMLDialogElement;
  private toggle:HTMLButtonElement;
  private badge:HTMLButtonElement;
  private selected:PressDriveId;
  constructor(private root:HTMLElement,initial:PressDriveId,choose:(id:PressDriveId)=>boolean){
    this.selected=initial;
    this.toggle=root.querySelector<HTMLButtonElement>('#press-program-toggle')!;
    this.dialog=document.createElement('dialog');this.dialog.className='press-drive-dialog';this.dialog.setAttribute('aria-labelledby','press-drive-title');
    const graph=(id:PressDriveId)=>Array.from({length:61},(_,i)=>`${i?'L':'M'}${12+i*3},${64-pressDrivePressure(id,i/5,100)*.48}`).join(' ');
    this.dialog.innerHTML=`<header><div><span>CONTROL THE LOAD PATH</span><h2 id="press-drive-title">Pressure program</h2></div><button aria-label="Close pressure program">×</button></header><p>Choose how pressure builds during the stroke. The program uses simulation seconds; playback speed changes only how quickly you watch it.</p><div class="press-drive-options">${PRESS_DRIVES.map(d=>`<button data-press-drive="${d.id}"><strong>${d.name}</strong><svg viewBox="0 0 204 83" role="img" aria-label="${d.name} pressure request over 12 simulation seconds"><path class="drive-grid" d="M12 16H192M12 64H192"/><path class="drive-curve" d="${graph(d.id)}"/><text x="12" y="80">0 s</text><text x="192" y="80" text-anchor="end">12 s</text></svg><span>${d.description}</span></button>`).join('')}</div><footer>Charts show the percentage of your chosen pressure limit. Selecting a program starts a fresh specimen. Adjusting pressure manually preserves the specimen and switches to Steady.</footer>`;
    root.append(this.dialog);
    this.badge=document.createElement('button');this.badge.className='press-drive-badge';root.querySelector('.viewport-wrap')!.append(this.badge);
    for(const b of [this.toggle,this.badge]){b.setAttribute('aria-haspopup','dialog');b.onclick=()=>this.dialog.showModal();}
    this.dialog.querySelector('header button')!.addEventListener('click',()=>this.dialog.close());
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-press-drive]').forEach(b=>b.onclick=()=>{
      const next=b.dataset.pressDrive as PressDriveId;if(!choose(next))return;this.sync(next);this.dialog.close();
      root.querySelector('.desk-feedback')!.textContent=`${pressDriveFor(next).name} program · fresh specimen ready.`;
    });
    this.sync(initial);
  }
  sync(id:PressDriveId):void {
    this.selected=id;const d=pressDriveFor(id);this.root.dataset.pressDrive=id;
    this.toggle.textContent=`${d.name} ↗`;this.toggle.setAttribute('aria-label',`Pressure program: ${d.name}`);
    this.badge.textContent=`${d.name} pressure ↗`;this.badge.hidden=id==='steady';this.badge.setAttribute('aria-label',`Pressure program: ${d.name}`);
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-press-drive]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pressDrive===id)));
  }
  update(disabled:boolean,requested:number):void {
    this.toggle.disabled=disabled;this.badge.disabled=disabled;
    this.badge.title=`Requested ${requested.toFixed(1)}% of model drive capacity`;
    this.root.dataset.pressRequested=String(requested);
    this.root.querySelector('label[for=press-pressure]')!.textContent=disabled?'Recorded pressure':this.selected==='steady'?'Applied pressure':'Pressure limit';
  }
}
