// The elastomer lab in SI units (src/studio/material-labs/rubber-si.ts): a viscoelastic Neo-Hookean cylinder between
// bonded platens through SolidContact. Run: node --test tests/studio/rubber-si.test.mjs (npm run test:studio:materials)
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {RubberModel,rubberSpec,cylinderMesh,RUBBER_BASE,FILLED_SPECTRUM}=await import('../../src/studio/material-labs/rubber-si.ts');
const {SolidBody}=await import('../../src/engine/solid.ts');
const {materialProperty}=await import('../../src/engine/materials.ts');
const {LABS,normalizeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const preset=(id,extra={})=>normalizeSettings('rubber',{...LABS.rubber.defaults,...LABS.rubber.experiments.find(e=>e.id===id).settings,...extra});
const run=(m,seconds)=>{for(let i=0;i<Math.round(seconds*120);i++)m.step(1/120);return m;};

test('SI values: natural rubber from the library; the filled spectrum from Andena et al. (2023), long-term weight 0.45',()=>{
  const nr=rubberSpec('natural');assert.equal(nr.youngModulus,materialProperty('natural-rubber','youngModulus'));assert.equal(nr.density,materialProperty('natural-rubber','density'));
  assert.ok(Math.abs(1-FILLED_SPECTRUM.weights.reduce((a,b)=>a+b,0)-.45)<1e-12);
  assert.deepEqual(nr.branches.map(b=>b.time),[.3,3,30,300]);assert.ok(Math.abs(nr.branches[0].ratio-.2/.45)<1e-12);
  for(const id of ['foam','memory-foam'])assert.equal(rubberSpec(id).poissonRatio,0);
});

test('bonded compression at small strain: the lab mesh against the bonded-block closed form and the converged 3-D solution, tet4-nodal and tet4',()=>{
  // Closed form (Gent and Lindley, with bulk compliance; quoted as Eq. (2) in Koblar, Škofic, Boltežar, Strojniški vestnik 60
  // (2014) 506-511): 1 / E_c = 1 / (E (1 + 2 S^2)) + 1 / K, S = R / (2 H) = 0.34. It assumes parabolic bulging; for this tall
  // specimen the converged 3-D linear solution is 1.12 times it (Richardson extrapolation of both elements, 16 and 24 cells across:
  // docs/STUDIO_MATERIAL_LABS.md).
  const R=.58,H=.86,E=1.5e6,nu=.49,S=R/(2*H),K=E/(3*(1-2*nu)),theory=1/(1/(E*(1+2*S*S))+1/K);
  const apparent=element=>{
    const b=new SolidBody({mesh:cylinderMesh(R,H,5,5),material:{youngModulus:E,poissonRatio:nu,density:1000},config:{model:'linear',tolerance:1e-9,element,linearSolver:'ldl'}});
    b.constrain(b.selectNodes((x,y)=>y<RUBBER_BASE+1e-9));const top=b.selectNodes((x,y)=>y>RUBBER_BASE+H-1e-9);b.constrain(top,[0,-.01*H,0]);
    const r=b.solveStatic();let F=0;for(const n of top)F+=r.reactions[3*n+1];return -F/(Math.PI*R*R)/.01;
  };
  const nodal=apparent('tet4-nodal')/theory,standard=apparent('tet4')/theory;
  console.log('# bonded compression / closed form',JSON.stringify({nodal,standard,nodalOverConverged:nodal/1.12,standardOverConverged:standard/1.12}));
  // Measured 1.286 (tet4-nodal, the lab's element) and 1.516 (tet4): 15 % and 35 % above the converged solution.
  assert.ok(nodal>1.12&&nodal<1.31,`${nodal}`);assert.ok(standard>nodal+.2,`${standard}`);
});

test('silicone cycle: the force relaxes during the hold; unloaded, the bonded specimen recovers; volume is nearly kept',()=>{
  const p=preset('silicone-cycle'),m=new RubberModel(p),ramp=p.load/p.rate;
  run(m,ramp);const atRamp=m.platenForce;run(m,p.damping);const atHold=m.platenForce;
  assert.ok(atRamp>0&&atHold<atRamp,`relaxation ${atRamp} -> ${atHold}`);
  assert.ok(m.frame.metrics[2]>90,'nearly incompressible (nu = 0.49)');
  run(m,ramp+3);assert.ok(Math.abs(m.platenForce)<.02*m.peakForce,'the platen follows with no load');assert.equal(m.unconverged,0,'every step converged');assert.ok(m.frame.metrics[0]<5,`recovered to ${m.frame.metrics[0]} %`);
  assert.ok(m.frame.metrics.every(Number.isFinite));
});

test('foam: a compressible law loses volume under compression; rubber does not',()=>{
  const foam=run(new RubberModel(preset('foam-collapse')),3),rubber=run(new RubberModel(preset('silicone-cycle')),2.4);
  assert.ok(foam.frame.metrics[2]<rubber.frame.metrics[2]-10,`${foam.frame.metrics[2]} vs ${rubber.frame.metrics[2]}`);
});

test('determinism: the same settings repeat bit for bit',()=>{
  const a=run(new RubberModel(preset('rubber-rebound')),1),b=run(new RubberModel(preset('rubber-rebound')),1);assert.deepEqual(a.snapshot(),b.snapshot());
});
