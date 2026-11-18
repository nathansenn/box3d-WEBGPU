import './study-navigation.css';
export const STUDIO_STUDIES=[
  ['liquid','Liquid dynamics'],['glass','Glass impact'],['concrete','Concrete crush'],['rubber','Elastomer lab'],['granular','Granular flow'],
  ['plate','Metal press'],['canopy','Canopy'],['bridge','Suspension bridge'],
] as const;
const observers=new WeakMap<HTMLElement,MutationObserver>();
export function installStudyNavigation(root:HTMLElement,id:string):void {
  const nav=root.querySelector('nav[aria-label="Studies"]');if(!nav)return;
  id=nav.querySelector<HTMLElement>('[aria-current="page"]')?.dataset.study??id;
  nav.innerHTML=`<label class="unified-study-picker"><span class="sr-only">Study</span><select aria-label="Study">${STUDIO_STUDIES.map(([value,title])=>`<option value="${value}" ${value===id?'selected':''}>${title}</option>`).join('')}</select><i class="ph ph-caret-down" aria-hidden="true"></i></label>`;
  nav.querySelector('select')!.addEventListener('change',event=>{const next=(event.target as HTMLSelectElement).value;if(STUDIO_STUDIES.some(([value])=>value===next))location.assign('?studio='+next);});
  const brand=root.querySelector<HTMLAnchorElement>('a.brand');if(brand)brand.href='?studio=liquid';
  root.querySelectorAll<HTMLAnchorElement>('a[href*="workbench=1"]').forEach(link=>{link.href='?studio=liquid';link.textContent=link.classList.contains('library-link')?'All studies':'Explore material studies';});
  // Classic preset changes can replace the header along with the study shell.
  if(!observers.has(root)){
    const observer=new MutationObserver(()=>{const current=root.querySelector('nav[aria-label="Studies"]');if(current&&!current.querySelector('.unified-study-picker'))installStudyNavigation(root,new URLSearchParams(location.search).get('studio')??id);});
    observer.observe(root,{childList:true});observers.set(root,observer);window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  }
}
