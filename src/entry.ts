// One studio entry. Historical workbench URLs resolve into the current study workflow.
const query = new URLSearchParams(location.search);
const studyLabs: Record<string, string> = {
  'canopy-load-capture': 'canopy',
  'titan-bend-dent': 'plate',
  'suspension-cable-resonance': 'bridge',
};
const requested = query.get('studio') || studyLabs[query.get('lab') || ''] || 'liquid';
const classic=['canopy','plate','bridge'];
const material=['liquid','glass','concrete','rubber','granular'];
const study=[...classic,...material].includes(requested)?requested:'liquid';
document.body.innerHTML = '<div id="studio"><div class="boot-message">Opening Engineering Studio…</div></div>';
const boot=material.includes(study)
  ?import('./studio/material-labs/main').then(({bootMaterialLab})=>bootMaterialLab(study as import('./studio/material-labs/catalog').LabId))
  :import('./studio/main').then(async({bootStudio})=>{await bootStudio(study);const {installStudyNavigation}=await import('./studio/study-navigation');installStudyNavigation(document.getElementById('studio')!,study);});
boot.catch(error => {
    console.error(error);
    const root = document.getElementById('studio')!;
    root.innerHTML = '<main style="padding:48px;font:16px system-ui;color:#26312b;background:#faf9f4;min-height:100vh"><h1>Studio could not start</h1><p id="boot-error"></p><a href="?studio=liquid">Open Liquid Dynamics</a></main>';
    document.getElementById('boot-error')!.textContent = String(error);
  });
