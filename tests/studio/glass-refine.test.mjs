// The glass lab on the grid refined around the impact (GlassModel `refine`, PlateBody `lines`): the tiles still cover the
// pane, the first crack comes when it does on the 0.1 m grid, the cracks are finer, and with the fine cells' bending implicit
// (PlateBody `implicitCells`) the refined lab steps as the 0.1 m lab does. The plate's own checks on graded
// grids (Navier, Kirchhoff, first crack, Levy) are in tests/engine/plate.test.mjs.
// Run: node --import ./scripts/register-typescript.mjs --test tests/studio/glass-refine.test.mjs
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {GlassModel,GLASS_REFINEMENT,glassLines}=await import('../../src/studio/material-labs/glass-si.ts');
const {LABS,normalizeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const DT=1/120,preset=id=>normalizeSettings('glass',{...LABS.glass.defaults,...LABS.glass.experiments.find(e=>e.id===id).settings});

test('refined grid: 0.05 m cells within 0.3 m of the impact, the tiles cover the pane, the nodes share its mass',()=>{
  const lines=glassLines(GLASS_REFINEMENT,1.3,1);
  assert.equal(lines.x.length,33);assert.equal(lines.y.length,27);
  const cells=l=>l.slice(1).map((v,i)=>+(v-l[i]).toFixed(12));
  assert.deepEqual([...new Set(cells(lines.x))].sort(),[.05,.1]);assert.equal(cells(lines.x).filter(h=>h===.05).length,12);
  for(const fill of [0,60]){
    const m=new GlassModel({...preset('radial-impact'),fill},{refine:GLASS_REFINEMENT});let area=0,mass=0;
    for(const piece of m.pieces){const v=piece.vertices.map(p=>p.map((x,i)=>x+piece.center[i]));for(let k=0;k<v.length;k++){const a=v[k],b=v[(k+1)%v.length];area+=(a[0]*b[1]-b[0]*a[1])/2;}}
    for(let n=0;n<m.plate.nodeCount;n++)mass+=m.plate.mass[n];
    assert.ok(Math.abs(area-5.2)<1e-10,`tiles cover the pane: ${area}`);
    assert.ok(Math.abs(mass/(2500*.008*5.2)-1)<1e-12,'mass of the pane');
    // The cross of fine cells sits on the impact: x = fill / 100 m from the centre.
    const fine=m.plate.dx.findIndex(h=>h<.075);assert.ok(Math.abs(m.plate.origin[0]+m.plate.xs[fine]-(fill/100-.3))<1e-9);
  }
});

test('refined grid: the first crack comes when it does on the 0.1 m grid, and the cracks and pieces are finer, at the 0.1 m grid\'s step',()=>{
  const plain=new GlassModel(preset('radial-impact')),fine=new GlassModel(preset('radial-impact'),{refine:GLASS_REFINEMENT});
  for(let i=0;i<Math.round(1.2/DT);i++){plain.step(DT);fine.step(DT);}
  console.log(`# sub-steps in 1.2 s: ${plain.substeps} (0.1 m) and ${fine.substeps} (refined, fine cells implicit); implicit factors formed ${fine.plate.factorizations}`);
  assert.ok(fine.plate.implicitCells>0&&fine.substeps<1.1*plain.substeps,'the fine cells do not set the step');
  const area=m=>m.fragments.reduce((a,f)=>a+[...f.nodes].reduce((s,n)=>s+m.plate.area[n],0),0)/Math.max(1,m.fragments.length);
  console.log(`# radial impact, 1.2 s: first crack ${plain.plate.breakTime.toFixed(5)} s (0.1 m) and ${fine.plate.breakTime.toFixed(5)} s (refined); pieces ${plain.fragmentCount} and ${fine.fragmentCount}; mean falling piece ${(area(plain)*1e4).toFixed(0)} and ${(area(fine)*1e4).toFixed(0)} cm^2; peak contact force ${(plain.peakForce/1e3).toFixed(2)} and ${(fine.peakForce/1e3).toFixed(2)} kN, peak stress ${(plain.peakStress/1e6).toFixed(1)} and ${(fine.peakStress/1e6).toFixed(1)} MPa`);
  assert.ok(plain.plate.breakTime>0&&fine.plate.breakTime>0);
  assert.ok(Math.abs(fine.plate.breakTime-plain.plate.breakTime)<1e-3,'first crack within 1 ms');
  assert.ok(fine.fragmentCount>2*plain.fragmentCount,'more, smaller pieces');assert.ok(area(fine)<.5*area(plain));
  assert.ok(fine.retained>.9&&fine.retained<1,'most of the pane stays clamped');
});
