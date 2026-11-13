// Validation of fracture in tetrahedral solids (src/engine/solid-fracture.ts) against closed-form
// fracture mechanics, SI units. Every tolerance is stated beside the check with its reason, and the
// measured values are printed as diagnostics (`node --test --test-reporter=tap`);
// docs/SOLID_FRACTURE.md quotes them. No check depends on wall-clock time. The scenarios live in
// validation/domains/fracture.mjs so that the validation report prints the same runs.
// Set FRACTURE_SLOW=1 to also run the refined mesh studies the document quotes (about two minutes).
import test from 'node:test';
import assert from 'node:assert/strict';
import {FractureBody,SOLID_FRACTURE_SOLVER_ID,FRACTURE_SUBSYSTEM_ORDER,gradedBoxMesh,fractureSubsystem,quenchedPlate} from '../../src/engine/solid-fracture.ts';
import {SolidBody,boxMesh,boxNode} from '../../src/engine/solid.ts';
import {Simulation,SUBSYSTEM_ORDER,solidSubsystem} from '../../src/engine/simulation.ts';
import {convexHull,meshVolume} from '../../src/engine/geometry.ts';
import {EngineError} from '../../src/engine/contracts.ts';
import {CONCRETE,SIGMA_C,G_C,L_CH,DELTA_C,C_F,BAR,barBody,cohesiveBar,crackBandBar,griffithStrength,notchedBeam,freeFlight,inclinedCrack,quench} from '../../validation/domains/fracture.mjs';

const SLOW=process.env.FRACTURE_SLOW==='1';
const close=(actual,expected,relative,absolute=0,label='')=>assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),`${label} ${actual} != ${expected}: error ${Math.abs(actual-expected)}, allowed ${absolute+relative*Math.abs(expected)}`);
const invalid=(fn,code='INVALID_PAYLOAD')=>assert.throws(fn,error=>error instanceof EngineError&&error.code===code);
const near=(a,b)=>Math.abs(a-b)<1e-9;
const bits=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('hex');
const sum=values=>{let s=0;for(const v of values)s+=v;return s;};
const COHESIVE={model:'cohesive',strength:SIGMA_C,toughness:G_C};
const AREA=BAR.width**2;
// Runs that several tests read are made once. A test that changes a body afterwards makes its own.
const shared=new Map(),once=(key,make)=>{if(!shared.has(key))shared.set(key,make());return shared.get(key);};
const brokenBeam=()=>once('beam',()=>notchedBeam({depth:.6,cells:8,stop:.002}));
const flightAt=share=>once(`flight${share}`,()=>freeFlight({stepShare:share}));
const inclined=()=>once('inclined',()=>inclinedCrack({pattern:'alternating5'}));
const quenched=()=>once('quench',()=>quench());

test('without cracks the body is the linear solid of solid.ts; inputs are validated',t=>{
  const note=message=>t.diagnostic(message);
  // Same element, same lumped mass, same loads: statics and midpoint dynamics agree to the solver tolerance.
  const cells=[4,2,2],size=[.4,.1,.1],material={...CONCRETE,thermalExpansion:1e-5};
  const make=Type=>{
    const body=Type===SolidBody?new SolidBody({mesh:boxMesh({size,cells}),material,config:{model:'linear',integrator:'midpoint',dt:2e-5,tolerance:1e-12,gravity:[0,-9.81,0]}}):new FractureBody({mesh:boxMesh({size,cells}),material,fracture:{...COHESIVE,strength:1e12},config:{integrator:'midpoint',dt:2e-5,tolerance:1e-12,gravity:[0,-9.81,0]}});
    body.constrain(body.selectNodes(x=>near(x,0)),[0,0,0]);
    body.addTraction(body.selectFaces((cx,cy,cz,nx)=>nx>.999),[2e4,-1e4,5e3]);body.addPressure(body.selectFaces((cx,cy,cz,nx,ny)=>ny>.999),3e3);
    body.setNodalForce(boxNode(cells,4,2,2),[10,20,-30]);body.setTemperatureChange(Array.from({length:body.nodeCount},(_,n)=>5+40*body.referencePositions[3*n]));
    return body;
  };
  const solid=make(SolidBody),cracked=make(FractureBody);
  assert.equal(cracked.solver,SOLID_FRACTURE_SOLVER_ID);
  assert.deepEqual([...cracked.faces],[...solid.faces],'the boundary faces and their order are those of solid.ts');
  assert.equal(bits(cracked.nodalMass),bits(solid.nodalMass),'identical lumped masses');
  const a=solid.solveStatic(),b=cracked.solveStatic(),scale=Math.max(...a.displacements.map(Math.abs));
  let worst=0;for(let j=0;j<a.displacements.length;j++)worst=Math.max(worst,Math.abs(a.displacements[j]-b.displacements[j]));
  assert.ok(worst<=1e-9*scale,`static displacements differ by ${worst/scale}`);
  close(cracked.strainEnergy(),solid.strainEnergy(),1e-9,0,'strain energy');
  for(let j=0;j<a.reactions.length;j++)close(b.reactions[j],a.reactions[j],1e-8,1e-8*Math.abs(sum(a.reactions)),'reaction');
  const stressA=solid.stresses(),stressB=cracked.stresses();for(let j=0;j<stressA.length;j++)close(stressB[j],stressA[j],1e-8,1,'stress');
  solid.clearSurfaceLoads();cracked.clearSurfaceLoads();solid.step(20);cracked.step(20);worst=0;
  for(let j=0;j<a.displacements.length;j++)worst=Math.max(worst,Math.abs(solid.displacements[j]-cracked.displacements[j]));
  assert.ok(worst<=1e-8*scale,`displacements after 20 midpoint steps differ by ${worst/scale}`);
  note(`statics and 20 midpoint steps agree with SolidBody('linear') to ${(worst/scale).toExponential(1)} of the largest displacement`);

  const mesh=boxMesh({size:[1,1,1],cells:[1,1,1]}),graded=gradedBoxMesh({x:[0,.5,2],y:[0,1],z:[-1,0,3]});
  assert.deepEqual([...gradedBoxMesh({x:[0,1],y:[0,1],z:[0,1]}).positions],[...mesh.positions]);
  assert.equal(graded.positions.length,3*3*2*3);close(new FractureBody({mesh:graded,material:CONCRETE,fracture:COHESIVE}).referenceVolume,2*1*4,1e-12);
  invalid(()=>gradedBoxMesh({x:[0,0],y:[0,1],z:[0,1]}));
  for(const patch of [{model:'plastic'},{strength:0},{toughness:-1},{shearWeight:0},{initialOpeningRatio:.9},{insertion:'always'},{insertionThreshold:2},{tipInsertionThreshold:0},{tipInsertionThreshold:1.5},{regularisation:'nonlocal'},{extra:1}])invalid(()=>new FractureBody({mesh,material:CONCRETE,fracture:{...COHESIVE,...patch}}));
  invalid(()=>new FractureBody({mesh,material:CONCRETE,fracture:{model:'crack-band',strength:SIGMA_C,toughness:G_C,regularisation:'none'}}),'INVALID_PAYLOAD');
  invalid(()=>new FractureBody({mesh,material:CONCRETE,fracture:COHESIVE,config:{integrator:'rk4'}}));
  const body=new FractureBody({mesh:boxMesh({size:[1,1,1],cells:[2,1,1]}),material:CONCRETE,fracture:COHESIVE});
  invalid(()=>body.insertCohesive([body.interiorFaceCount]));invalid(()=>body.setInterfaceProperties([0],{strength:-1}));
  body.insertCohesive([0]);invalid(()=>body.setInterfaceProperties([0],{strength:1e6}),'INVALID_STATE');
  invalid(()=>new FractureBody({mesh,material:CONCRETE,fracture:{model:'none',strength:1,toughness:1}}).insertCohesive([0]),'INVALID_STATE');
});

test('the traction-separation law: bilinear, mixed-mode by an effective opening, irreversible, with a contact penalty',t=>{
  const note=message=>t.diagnostic(message);
  // Two cells with every node prescribed: the interface between them is driven directly, so the
  // reaction on the moved half is the law itself. Tolerance 1e-10: no solve is involved.
  const beta=.6,ratio=.05,dc=DELTA_C,d0=ratio*dc,size=.1,area=size*size;
  const body=new FractureBody({mesh:boxMesh({size:[2*size,size,size],cells:[2,1,1]}),material:CONCRETE,fracture:{...COHESIVE,shearWeight:beta,initialOpeningRatio:ratio,insertion:'manual'}});
  const faces=body.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,size)&&Math.abs(nx)>.999);
  assert.equal(body.insertCohesive(faces),faces.length);assert.equal(body.insertCohesive(faces),0,'inserting twice changes nothing');
  const left=body.selectNodes(x=>x<size+1e-9),right=[];
  // After the insertion the nodes of the plane exist twice: the right half is every node of an element right of the plane.
  for(const e of body.selectElements(cx=>cx>size))for(let q=0;q<4;q++)if(!right.includes(body.tets[4*e+q]))right.push(body.tets[4*e+q]);
  const leftOnly=[...left].filter(n=>!right.includes(n));
  assert.equal(leftOnly.length+right.length,body.nodeCount);assert.equal(body.nodeCount,12+4,'the four nodes of the plane were duplicated');
  body.constrain(leftOnly,[0,0,0]);
  const drive=(normal,slide)=>{body.constrain(right,[normal,slide,0]);const r=body.solveStatic();let fx=0,fy=0;for(const n of right){fx+=r.reactions[3*n];fy+=r.reactions[3*n+1];}return {tn:fx/area,ts:fy/area};};
  const envelope=d=>d<=d0?SIGMA_C*d/d0:d<dc?SIGMA_C*(dc-d)/(dc-d0):0;
  // Mode I: rising branch, peak sigma_c at delta_0, linear softening.
  for(const d of [.5*d0,d0,.25*dc,.5*dc]){const t=drive(d,0);close(t.tn,envelope(d),1e-10,1e-10*SIGMA_C,`mode I traction at ${d/dc} delta_c`);close(t.ts,0,0,1e-9*SIGMA_C);}
  close(drive(d0,0).tn,envelope(.5*dc)/(.5*dc)*d0,1e-10,0,'unloading follows the damaged secant through the origin');
  close(drive(.25*dc,0).tn,envelope(.5*dc)/2,1e-10,0,'reloading follows the same secant');
  const damaged=body.interfaceState(faces[0]).damage[0];close(damaged,1-envelope(.5*dc)*d0/(SIGMA_C*.5*dc),1e-12);
  // Compression: the penalty is the undamaged stiffness sigma_c / delta_0, whatever the damage.
  close(drive(-.3*d0,0).tn,-.3*SIGMA_C,1e-10,0,'contact penalty');
  assert.equal(body.interfaceState(faces[0]).damage[0],damaged,'closing does not heal');
  // Sliding at the same damage: effective opening beta |delta_s|, shear traction beta^2 times the secant.
  const slide=.2*dc/beta,shear=drive(0,slide);close(shear.ts,envelope(.5*dc)/(.5*dc)*beta*beta*slide,1e-10,0,'shear on the damaged secant');
  // Mixed mode beyond the history: effective opening sqrt(dn^2 + beta^2 ds^2).
  const dn=.5*dc,ds=.5*dc/beta,eff=Math.hypot(dn,beta*ds),mixed=drive(dn,ds);
  close(mixed.tn,envelope(eff)/eff*dn,1e-10,0,'mixed-mode normal traction');close(mixed.ts,envelope(eff)/eff*beta*beta*ds,1e-10,0,'mixed-mode shear traction');
  close(body.dissipatedEnergy(),area*.5*(SIGMA_C*eff-envelope(eff)*d0),1e-10,0,'dissipation is a function of the largest effective opening');
  // Pure sliding on a fresh interface: peak shear beta sigma_c, energy G_c, critical sliding delta_c / beta.
  const fresh=new FractureBody({mesh:boxMesh({size:[2*size,size,size],cells:[2,1,1]}),material:CONCRETE,fracture:{...COHESIVE,shearWeight:beta,initialOpeningRatio:ratio,insertion:'manual'}});
  fresh.insertCohesive(faces);fresh.constrain(leftOnly,[0,0,0]);
  const slip=s=>{fresh.constrain(right,[0,s,0]);const r=fresh.solveStatic();let fy=0;for(const n of right)fy+=r.reactions[3*n+1];return fy/area;};
  close(slip(d0/beta),beta*SIGMA_C,1e-10,0,'shear strength beta sigma_c');close(slip(.999*dc/beta),beta*envelope(.999*dc),1e-9,0);
  assert.ok(Math.abs(slip(1.001*dc/beta))<=1e-12*SIGMA_C,'no traction beyond delta_c / beta');close(fresh.dissipatedEnergy(),G_C*area,1e-12,0,'mode II fracture energy G_c');
  const opened=fresh.takeEvents().filter(event=>event.kind==='opened');
  assert.equal(opened.length,faces.length);assert.ok(opened.every(event=>event.mode==='II'&&event.modeMix===0&&Math.abs(event.energy-G_C*event.area)<1e-12*G_C*event.area));
  close(fresh.energy().externalWork,G_C*area,2e-3,0,'work of the prescribed sliding (trapezoid over five steps)');
});

test('uniaxial bar with a weak interface: peak sigma_c A, linear softening, G_c A dissipated, damaged secant, zero traction when broken',async t=>{
  const note=message=>t.diagnostic(message);
  const run=await cohesiveBar({cells:[4,1,1],insertion:'manual'}),{body,pull,weak}=run;
  // Uniform stress: the discretisation is exact, so every tolerance here is the solver's (1e-11 relative residual).
  close(run.peak,SIGMA_C,1e-9,0,'peak stress');close(run.rows[9].stress,SIGMA_C,1e-9,0,'the peak is reached at U = sigma_c L / E + delta_0');
  assert.ok(run.worstLaw<=1e-8,`the load-displacement curve follows the softening law: worst ${run.worstLaw} sigma_c`);
  close(run.dissipated,G_C*AREA,1e-9,0,'dissipated energy');
  // Work by the trapezoid rule over 40 steps: exact on the two linear branches, off only in the steps that hold a kink.
  close(run.work,G_C*AREA,1e-3,0,'area under the load-displacement curve');
  assert.ok(run.worstBalance<=1e-3,`ledger imbalance ${run.worstBalance} G_c A`);assert.equal(run.relaxation,0);
  assert.ok(run.irreversible,'damage never decreased');assert.ok(run.rows.every(row=>row.converged));
  assert.ok(Math.abs(run.finalStress)<=1e-9*SIGMA_C,`broken halves carry no traction: ${run.finalStress} Pa`);
  assert.equal(run.fragments,2);assert.deepEqual(body.interfaceState(weak[0]).damage,[1,1,1]);
  // The broken halves: pushed back together they meet the penalty (and nothing passes through); pulled apart again, nothing.
  const pushed=pull(-1e-6),state=body.interfaceState(weak[0]),stiffness=SIGMA_C/run.d0;
  assert.ok(pushed.force<0&&state.normal.every(d=>d<0&&d>=pushed.force/AREA/stiffness*(1+1e-6)),`overlap ${state.normal[0]} m is the contact stress over the penalty stiffness`);
  close(pushed.force/AREA,-1e-6/(BAR.length/CONCRETE.youngModulus+1/stiffness),1e-8,0,'two bars and a penalty spring in series');
  assert.ok(Math.abs(pull(2*DELTA_C).force)<=1e-9*SIGMA_C*AREA);
  note(`bar 4x1x1: peak/sigma_c ${run.peak/SIGMA_C}, D/(G_c A) ${run.dissipated/(G_C*AREA)}, W/(G_c A) ${run.work/(G_C*AREA)}, law error ${run.worstLaw.toExponential(1)}, ledger ${run.worstBalance.toExponential(1)}`);

  // Unloading and reloading in the softening branch.
  const cycle=await cohesiveBar({cells:[4,1,1],insertion:'manual',steps:12}),half=cycle.rows[16];
  const again=await barBody([4,1,1],{...COHESIVE,strength:2*SIGMA_C,insertion:'manual'}),faces=again.body.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,BAR.length/2)&&Math.abs(nx)>.999);
  again.body.setInterfaceProperties(faces,{strength:SIGMA_C});again.body.insertCohesive(faces);
  for(let i=0;i<=16;i++)again.pull(cycle.rows[i].U);
  const top=again.pull(half.U),damage=again.body.interfaceState(faces[0]).damage[0],secant=half.stress/half.opening;
  close(top.force/AREA,half.stress,1e-9,0);
  for(const share of [.75,.4,.1]){
    const r=again.pull(share*half.U),opening=again.body.interfaceState(faces[0]).normal[0];
    close(r.force/AREA,secant*opening,1e-8,0,`unloading to ${share} U follows the damaged secant`);
    // The whole bar is then linear: stress = U / (L / E + 1 / secant).
    close(r.force/AREA,share*half.U/(BAR.length/CONCRETE.youngModulus+1/secant),1e-8,0);
    assert.equal(again.body.interfaceState(faces[0]).damage[0],damage,'no damage while unloading');
  }
  close(again.pull(half.U).force/AREA,half.stress,1e-8,0,'reloading returns to the point it left');
  close(again.pull(cycle.rows[20].U).force/AREA,cycle.rows[20].stress,1e-8,0,'and continues on the softening curve');
});

test('mesh objectivity: a through-crack dissipates G_c A on three meshes; the crack band needs its regularisation for that',async t=>{
  const note=message=>t.diagnostic(message);
  // Cohesive interface: the energy is G_c times the face area whatever the mesh (1e-9: solver tolerance).
  for(const cells of [[4,1,1],[8,2,2],[12,3,3]]){
    const run=await cohesiveBar({cells,insertion:'manual',steps:20});
    close(run.dissipated,G_C*AREA,1e-9,0,`cohesive ${cells}`);close(run.peak,SIGMA_C,1e-9,0);close(run.work,G_C*AREA,2e-3,0);
    note(`cohesive ${cells.join('x')}: D/(G_c A) ${run.dissipated/(G_C*AREA)}, W/(G_c A) ${(run.work/(G_C*AREA)).toFixed(6)}`);
  }
  // Inserted on demand at sigma_c, the interface adds its compliance to a loaded face. The energy that lets go is
  // at most delta_0 / delta_c = 2 % of G_c A, the same on every mesh, and the ledger books it as relaxation.
  for(const cells of [[4,1,1],[8,2,2]]){
    const run=await cohesiveBar({cells});
    close(run.dissipated,G_C*AREA,1e-9,0);close(run.peak,SIGMA_C,1e-9,0,'on-demand peak');
    assert.ok(run.work/(G_C*AREA)-1>0&&run.work/(G_C*AREA)-1<=.025,`work ${run.work/(G_C*AREA)} G_c A`);
    close(run.relaxation,run.work-run.dissipated,1e-2,0,'the extra work is the booked relaxation');
    // Exactly T_before T_after / (2 K) per unit area: the traction just before the insertion, sigma_c + E delta_0 / L, times sigma_c.
    close(run.relaxation/(G_C*AREA),.02*(1+CONCRETE.youngModulus*.02*DELTA_C/(SIGMA_C*BAR.length)),1e-6,0,'relaxation');assert.ok(run.worstBalance<=1e-3);
    note(`on demand ${cells.join('x')}: W/(G_c A) ${(run.work/(G_C*AREA)).toFixed(6)}, relaxation/(G_c A) ${(run.relaxation/(G_C*AREA)).toFixed(6)}`);
  }
  // Crack band, nu = 0 (uniaxial stress in the band): G_c A on cells of 50, 25 and 12.5 mm within 1 %
  // (the work is a trapezoid sum over 45 steps of a curve with two kinks).
  const works={};
  for(const regularisation of ['crack-band','none'])for(const nx of [4,8,16]){
    const run=await crackBandBar({nx,regularisation});works[`${regularisation}${nx}`]=run.work/(G_C*AREA);
    close(run.peak,SIGMA_C,1e-9,0,`crack band peak ${nx}`);assert.ok(run.monotone,'damage never decreased');
    assert.equal(run.failed,run.layer,'every element of the weak layer failed, and only those');assert.equal(run.body.clampedElements,0);
    assert.ok(Math.abs(run.finalStress)<=1e-6*SIGMA_C,`residual stress ${run.finalStress} Pa`);
    if(regularisation==='crack-band'){close(run.work,G_C*AREA,.01,0,`regularised work on ${nx} cells`);close(run.dissipated,run.work,.02,0,'the running sum of psi d(omega)');}
  }
  // Without the regularisation the softening strain is fixed, so the energy is proportional to the cell size.
  close(works.none4/works.none16,4,.02,0,'unregularised energy scales with h');close(works.none4/works.none8,2,.02,0);
  assert.ok(Math.abs(works['crack-band4']/works['crack-band16']-1)<=.01);
  note(`crack band W/(G_c A) at h = 50, 25, 12.5 mm: regularised ${[4,8,16].map(n=>works[`crack-band${n}`].toFixed(4)).join(', ')}; unregularised ${[4,8,16].map(n=>works[`none${n}`].toFixed(4)).join(', ')}`);
  // With nu = 0.2 the band is held sideways by its neighbours and the Rankine measure reads (lambda + 2 mu) eps:
  // the energy falls towards E / (lambda + 2 mu) = 0.9 of G_c A. Reported, and objective all the same.
  const confined=[4,8].map(nx=>crackBandBar({nx,poissonRatio:.2}));
  const [coarse,fine]=await Promise.all(confined);
  assert.ok(coarse.work/(G_C*AREA)>.89&&coarse.work/(G_C*AREA)<.93&&Math.abs(coarse.work/fine.work-1)<.01,`confined band ${coarse.work/(G_C*AREA)} and ${fine.work/(G_C*AREA)}`);
  note(`crack band, nu = 0.2: W/(G_c A) ${(coarse.work/(G_C*AREA)).toFixed(4)} and ${(fine.work/(G_C*AREA)).toFixed(4)}`);
});

test('energy balance: external work = strain + interface + kinetic + dissipated energy, quasi-static and dynamic',async t=>{
  const note=message=>t.diagnostic(message);
  // Quasi-static, at every load step of the bar (asserted there too) and of a notched beam, where the crack
  // grows through a stress gradient. The work is a trapezoid sum, so the imbalance is that of the load step:
  // 2e-3 of G_c times the ligament with 8 steps per elastic deflection.
  const beam=await brokenBeam();
  assert.ok(beam.worstBalance<=2e-3,`beam ledger ${beam.worstBalance}`);assert.equal(beam.unconverged,0);
  const ledger=beam.body.energy();close(ledger.externalWork,ledger.strain+ledger.interface+ledger.dissipated,2e-3,0);assert.equal(ledger.kinetic,0);
  // Dynamic: a bar that breaks in free flight. Explicit: second order in the time step.
  const runs=[];for(const share of [.8,.4])runs.push(await flightAt(share));
  assert.ok(runs[0].balance<=5e-4&&runs[1].balance<=1.5e-4,`explicit imbalance ${runs.map(run=>run.balance)}`);
  const order=Math.log2(runs[0].balance/runs[1].balance);assert.ok(order>1.5&&order<2.5,`order ${order}`);
  for(const run of runs){close(run.dissipated,G_C*run.area,1e-9,0,'the flight breaks the bar completely');assert.equal(run.fragments.length,2);}
  // Midpoint rule at 20 and 10 times the explicit limit: the interface force is taken at the half step.
  const implicit=[];for(const share of [1,.5])implicit.push(await freeFlight({integrator:'midpoint',stepShare:share}));
  assert.ok(implicit[0].balance<=4e-2&&implicit[1].balance<=1.5e-2&&implicit[1].balance<implicit[0].balance,`midpoint imbalance ${implicit.map(run=>run.balance)}`);
  assert.ok(implicit.every(run=>run.body.unconvergedSteps===0));
  // Backward Euler only loses energy: the imbalance is its numerical damping and is never negative.
  const damped=await freeFlight({integrator:'backward-euler',stepShare:1});
  assert.ok(damped.body.energy().balance>0);
  // Mass damping is booked.
  const body=new FractureBody({mesh:boxMesh({size:[.2,.05,.05],cells:[4,1,1]}),material:CONCRETE,fracture:COHESIVE,config:{integrator:'midpoint',dt:1e-5,massDamping:2000,tolerance:1e-12}});
  body.setState(undefined,Array.from({length:3*body.nodeCount},(_,j)=>j%3===0?.05*Math.sin(20*body.referencePositions[j]):0));
  const start=body.kineticEnergy();body.step(50);const e=body.energy();
  assert.ok(e.damping>.2*start,'damping removed energy');assert.ok(Math.abs(e.balance)<=1e-10*start,`midpoint with damping, no cracks: imbalance ${e.balance/start}`);
  note(`beam ledger ${beam.worstBalance.toExponential(1)}; flight imbalance / KE0: explicit ${runs.map(run=>run.balance.toExponential(1)).join(', ')} (order ${order.toFixed(2)}), midpoint ${implicit.map(run=>run.balance.toExponential(1)).join(', ')}, backward Euler ${(damped.body.energy().balance/damped.before.mass).toExponential(1)}`);
});

test('Griffith: a centre-cracked plate fails at K_Ic / (Y sqrt(pi a)) with K_Ic = sqrt(E G_c), within the stated band',async t=>{
  const note=message=>t.diagnostic(message);
  // Crack half-length a = 5 l_ch in a strip of half-width 4 a; Y = sqrt(sec(pi a / (2 b))) = 1.040 (Feddersen).
  // The load rises in steps of 1 % of the LEFM stress, so the strength is known to +-0.5 %.
  // Two errors of opposite sign. A cohesive crack of this size is about 4 % weaker than LEFM: its process zone
  // (c_f = 0.42 l_ch) makes the crack look longer. And cells too coarse for the process zone make it stronger.
  // Cells of l_ch (0.4 cells per c_f): band 15 %. Cells of l_ch / 2: band 5 %, and 3 % against LEFM for a + c_f.
  const coarse=await griffithStrength({cell:1}),fine=await griffithStrength({cell:.5});
  for(const [run,band] of [[coarse,.15],[fine,.05]]){
    assert.ok(run.stable>=.9&&run.unstable>0,`the plate held ${run.stable} and failed at ${run.unstable} of the LEFM stress`);
    close(run.Y,1.0404,1e-4);close(run.lefm,Math.sqrt(CONCRETE.youngModulus*G_C)/(run.Y*Math.sqrt(Math.PI*5*L_CH)),1e-12);
    close(run.strength,run.lefm,band,0,'strength against LEFM');
    assert.ok(run.growthBeforeFailure<=2*C_F,`stable growth before failure ${run.growthBeforeFailure/L_CH} l_ch`);
    note(`Griffith h = ${run.h/L_CH} l_ch (${run.tets} elements, ${run.zoneCells.toFixed(2)} cells per c_f, ${run.solves} solves): sigma_f / LEFM in (${run.stable.toFixed(2)}, ${run.unstable.toFixed(2)}], error ${(100*(run.ratio-1)).toFixed(1)} %; against the effective crack ${(100*(run.strength/run.effective-1)).toFixed(1)} %`);
  }
  // On-demand insertion: nothing is inserted beforehand and the solver has to find the ligament. A face that touches
  // a crack front (cut, open or softening) gets its interface at tipInsertionThreshold = 0.4 of its strength, because
  // the mean stress of its two elements under-reads the peak there. The failure load must be that of the pre-inserted
  // path within one load step (1 %): measured 0 on cells of l_ch / 2 and +0.9 % on cells of l_ch.
  for(const [cell,manual] of [[1,coarse],[.5,fine]]){
    const run=await griffithStrength({cell,insertion:'on-demand'});
    assert.ok(run.unstable>0,'the plate fails');
    assert.ok(Math.abs(run.ratio-manual.ratio)<=.0101,`on-demand at h = ${cell} l_ch: ${run.ratio} against ${manual.ratio} for the pre-inserted path`);
    // The cost: interfaces beside the path. Nodes after splitting against the pre-inserted mesh.
    assert.ok(run.body.nodeCount<=1.03*manual.body.nodeCount,`node count ${run.body.nodeCount} against ${manual.body.nodeCount}`);
    note(`on-demand insertion, h = ${cell} l_ch: sigma_f / LEFM in (${run.stable.toFixed(2)}, ${run.unstable.toFixed(2)}] against (${manual.stable.toFixed(2)}, ${manual.unstable.toFixed(2)}] pre-inserted; ${run.body.interfaces.length} interfaces and ${run.body.nodeCount} nodes against ${manual.body.interfaces.length} and ${manual.body.nodeCount}`);
  }
  // With the rule off (insertion at the strength everywhere) no interface appears ahead of the tip and the plate holds
  // far more than it should: still intact at 1.3 times LEFM (it fails at 1.59 with cells of l_ch / 2, not below 1.8 with l_ch).
  for(const cell of [1,.5]){const run=await griffithStrength({cell,insertion:'on-demand',tip:1},{limit:1.3});assert.ok(run.unstable===0&&run.stable>1.29,`insertion at sigma_c only, h = ${cell} l_ch: held ${run.stable}`);}
  assert.ok(Math.abs(fine.ratio-1)<Math.abs(coarse.ratio-1),'the error against LEFM falls with refinement');
  close(fine.strength,fine.effective,.03,0,'strength against the effective-crack estimate');
  if(SLOW){
    // The study docs/SOLID_FRACTURE.md quotes: a far field graded by 1.25 instead of 1.5 and twice the refined zone.
    const study={grading:1.25,back:12,ahead:16,rows:6};
    for(const [cell,a] of [[.5,5],[.25,5],[.125,5],[.25,10]]){const run=await griffithStrength({cell,a,...study});note(`refined Griffith a = ${a} l_ch, h = ${cell} l_ch (${run.tets} elements): sigma_f / LEFM in (${run.stable.toFixed(2)}, ${run.unstable.toFixed(2)}], effective-crack ${(run.effective/run.lefm).toFixed(4)}`);assert.ok(Math.abs(run.strength/run.effective-1)<=.015);}
    // On-demand insertion reads the mean stress of two elements, which misses the peak at the tip.
    // The threshold study of docs/SOLID_FRACTURE.md: the crack-front rule at several values, and one threshold for every face.
    for(const cell of [1,.5])for(const tip of [1,.7,.6,.5,.4,.3,.25]){const run=await griffithStrength({cell,insertion:'on-demand',tip},{start:.5,limit:1.8});note(`crack-front threshold ${tip}, h = ${cell} l_ch: stable to ${run.stable.toFixed(2)}, failed at ${run.unstable.toFixed(2)}, ${run.body.nodeCount} nodes`);}
    for(const cell of [1,.5])for(const threshold of [.7,.6,.5,.4,.3,.25]){const run=await griffithStrength({cell,insertion:'on-demand',threshold},{start:.5,limit:1.8});note(`one threshold ${threshold} for every face, h = ${cell} l_ch: stable to ${run.stable.toFixed(2)}, failed at ${run.unstable.toFixed(2)}, ${run.body.nodeCount} nodes`);}
  }
});

test('notched three-point bending: peak load against LEFM and the size-effect law, and the work of fracture against G_c times the ligament',async t=>{
  const note=message=>t.diagnostic(message);
  // Work of fracture, depth 0.6 l_ch (a ductile size, no snap-back), loaded until the load is below 0.2 % of the peak.
  // The row of nodes under the load is the hinge and never opens, so with n cells in the ligament the crack area is
  // (1 - 1 / (2 n)) of the ligament: the work is G_c times that within 1 %, and within 1 / (2 n) of G_c times the ligament.
  const works=[];
  for(const cells of [8,12]){
    const run=cells===8?await brokenBeam():await notchedBeam({depth:.6,cells,stop:.002});works.push(run);
    close(run.hinge,1-1/(2*run.ligamentCells),1e-12);
    close(run.work,G_C*run.ligament*run.hinge,.01,0,`work of fracture with ${cells} cells`);close(run.dissipated,G_C*run.ligament*run.hinge,.01,0);
    assert.ok(run.finalLoad<=.002*run.peak&&run.stored<=.01*run.work,'the beam is broken and unloaded');assert.equal(run.unconverged,0);
    note(`beam D = 0.6 l_ch, ${run.ligamentCells} ligament cells, ${run.steps} steps: W / (G_c ligament) ${(run.work/(G_C*run.ligament)).toFixed(4)} (hinge ${run.hinge.toFixed(4)}), ledger ${run.worstBalance.toExponential(1)}`);
  }
  const errors=works.map(run=>1-run.work/(G_C*run.ligament));
  assert.ok(errors[0]<=.13&&errors[1]<=.09&&errors[1]<errors[0],`the shortfall against G_c times the full ligament falls with refinement: ${errors}`);
  // Peak load, depth 2.4 l_ch. LEFM, P = sqrt(E G_c) t sqrt(D) / k(a0 / D), is an upper bound for a cohesive crack;
  // Bazant's size-effect law with c_f = 0.419 l_ch is the estimate. It is an asymptote for large D: band 12 %.
  const big=await notchedBeam({depth:2.4,cells:8,stop:.5});
  assert.ok(big.peak<big.lefm,'below the LEFM load');close(big.peak,big.sizeEffect,.12,0,'peak load against the size-effect law');
  assert.ok(works[0].peak/works[0].lefm<big.peak/big.lefm,'the smaller beam is further below LEFM: the size effect');
  note(`beam D = 2.4 l_ch: peak / LEFM ${(big.peak/big.lefm).toFixed(4)}, peak / size-effect law ${(big.peak/big.sizeEffect).toFixed(4)}; D = 0.6 l_ch: ${(works[0].peak/works[0].lefm).toFixed(4)}, ${(works[0].peak/works[0].sizeEffect).toFixed(4)}`);
  if(SLOW)for(const [depth,cells] of [[2.4,12],[4.8,12],[4.8,16]]){const run=await notchedBeam({depth,cells,stop:.5});note(`refined beam D = ${depth} l_ch, ${cells} cells: peak / LEFM ${(run.peak/run.lefm).toFixed(4)}, peak / size-effect law ${(run.peak/run.sizeEffect).toFixed(4)}, ledger ${run.worstBalance.toExponential(1)}`);}
});

test('mass and momentum: node splitting and the fragment hand-off conserve them; a bar broken in free flight keeps its momentum',async t=>{
  const note=message=>t.diagnostic(message);
  // Splitting: the element masses do not change; each node's mass is re-summed from its elements.
  const body=new FractureBody({mesh:boxMesh({size:[.3,.1,.1],cells:[3,2,2]}),material:CONCRETE,fracture:{...COHESIVE,insertion:'manual'}});
  const elementMass=()=>{let s=0;for(const v of body.elementVolume)s+=CONCRETE.density*v;return s;};
  const massBefore=sum(body.nodalMass),elements=elementMass(),v=Float64Array.from({length:3*body.nodeCount},(_,j)=>Math.sin(1+j));
  body.setState(undefined,v);const p0=body.momentum();
  const cut=body.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,.1)&&Math.abs(nx)>.999);
  body.insertCohesive(cut);body.precrack(body.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,.2)&&Math.abs(nx)>.999));
  assert.equal(body.nodeCount,36+9+9,'each node of the two planes was duplicated once');
  assert.equal(elementMass(),elements,'element masses are untouched, bit for bit');close(body.mass,elements,1e-14);
  close(sum(body.nodalMass),massBefore,4e-15,0,'nodal masses sum to the same total (round-off of the re-summation)');
  const p1=body.momentum();for(let k=0;k<3;k++){close(p1.linear[k],p0.linear[k],0,1e-14*body.mass,'linear momentum through the split');close(p1.angular[k],p0.angular[k],0,1e-14*body.mass,'angular momentum through the split');}
  for(let n=36;n<body.nodeCount;n++){const from=body.nodeOrigin[n];for(let k=0;k<3;k++){assert.equal(body.referencePositions[3*n+k],body.referencePositions[3*from+k]);assert.equal(body.velocities[3*n+k],body.velocities[3*from+k]);}}
  // A crack front: a face in the middle of the body is cut on its own. No element group is separated, so no node is duplicated.
  const inner=new FractureBody({mesh:boxMesh({size:[.4,.4,.4],cells:[4,4,4]}),material:CONCRETE,fracture:{...COHESIVE,insertion:'manual'}});
  const one=[...inner.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,.2)&&Math.abs(nx)>.999&&Math.abs(cy-.2)<.1&&Math.abs(cz-.2)<.1)];
  inner.precrack(one.slice(0,1));assert.equal(inner.nodeCount,125,'a single interior face separates nothing');
  inner.precrack(inner.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,.2)&&Math.abs(nx)>.999));assert.equal(inner.nodeCount,150,'the whole plane does');
  assert.equal(inner.fragments().length,2);

  // Free flight.
  const flight=await freeFlight({}),spinning=await freeFlight({spin:40});
  // Linear momentum: internal and interface forces cancel in pairs. 1e-12 of m V over 358 steps is round-off.
  assert.ok(flight.linear<=1e-12&&spinning.linear<=1e-12,`linear momentum drift ${flight.linear}, ${spinning.linear}`);
  // Angular momentum: exact for the interface forces of beta = 1 (they act along the opening); the small-strain
  // elements keep it to the order of rotation times strain. No spin: round-off. 40 rad/s: 1e-3 of m V L.
  assert.ok(flight.angular<=1e-12,`angular momentum drift without spin ${flight.angular}`);assert.ok(spinning.angular<=1e-3,`with spin ${spinning.angular}`);
  assert.ok(flight.nodalMassError<=4e-15&&flight.body.nodeCount===flight.nodesBefore+9);
  note(`free flight: dp / (m V) ${flight.linear.toExponential(1)}, dL / (m V L) ${flight.angular.toExponential(1)} (no spin) and ${spinning.angular.toExponential(1)} (40 rad/s); nodal mass sum off by ${flight.nodalMassError.toExponential(1)}`);

  // Fragments: counts, masses, order.
  const pieces=flight.fragments,total=flight.body.momentum();
  assert.equal(pieces.length,2);assert.ok(pieces[0].tets[0]===0&&pieces[0].tets[0]<pieces[1].tets[0],'ordered by lowest element');
  for(const piece of pieces){assert.ok(piece.tets.every((e,i)=>i===0||e>piece.tets[i-1]));assert.ok(piece.nodes.every((n,i)=>i===0||n>piece.nodes[i-1]));}
  close(pieces[0].mass+pieces[1].mass,flight.body.mass,1e-14,0,'fragment masses sum to the body');close(pieces[0].mass,pieces[1].mass,1e-12,0,'equal halves');
  close(pieces[0].volume+pieces[1].volume,flight.body.referenceVolume,1e-14);
  for(let k=0;k<3;k++)close(pieces[0].linearMomentum[k]+pieces[1].linearMomentum[k],total.linear[k],0,1e-13*flight.pScale,'fragment momenta sum to the body');
  assert.ok(pieces[0].linearMomentum[0]<0&&pieces[1].linearMomentum[0]>0,'the halves fly apart');
  assert.deepEqual(flight.body.fragments(),pieces,'the same call gives the same list');
  // Inertia of the lumped masses: positive, and that of a box of the half bar's size within the lumping error.
  const [ixx,iyy,izz]=pieces[0].inertia,m=pieces[0].mass,w=BAR.width,l=BAR.length/2;
  assert.ok(ixx>0&&iyy>0&&izz>0);close(ixx,m*(w*w+w*w)/12,.6,0,'I_xx of the lumped masses against the box');close(iyy,m*(l*l+w*w)/12,.4,0);
  // Hand-off: one way, with the fragment's mass and momentum.
  const moving=flight.body,rigid=moving.fragmentRigidBody(pieces[1]);
  assert.equal(rigid.type,'dynamic');assert.equal(rigid.shape.kind,'hull');assert.ok(rigid.shape.points instanceof Float32Array&&rigid.shape.points.length>=12&&rigid.shape.points.length<=3*64);
  close(rigid.hullVolume,meshVolume(convexHull(rigid.shape.points)),1e-12);close(rigid.hullVolume,pieces[1].volume,5e-3,0,'the hull of a deformed box is the box');
  close(rigid.density*rigid.hullVolume,pieces[1].mass,1e-15,0,'mass of the hull at the given density');
  for(let k=0;k<3;k++){close(rigid.linearMomentum[k],pieces[1].linearMomentum[k],4e-16,1e-16*flight.pScale,'hand-off momentum');close(rigid.position[k],pieces[1].centerOfMass[k],0,0);}
  const handed=moving.handOff(pieces[1]),after=moving.momentum();
  assert.deepEqual(handed,rigid);close(after.mass,pieces[0].mass,1e-14);close(after.handedOffMass,pieces[1].mass,0,0);
  for(let k=0;k<3;k++)close(after.linear[k]+after.handedOffLinear[k],total.linear[k],0,1e-13*flight.pScale,'momentum of what stays plus what left');
  invalid(()=>moving.handOff(pieces[1]),'INVALID_STATE');assert.ok(moving.fragments()[1].handedOff&&!moving.fragments()[0].handedOff);
  // What is left keeps flying and the piece that left stays frozen here.
  const frozen=moving.positions().slice();moving.step(20);const later=moving.positions();
  for(const n of pieces[1].nodes)for(let k=0;k<3;k++)assert.equal(later[3*n+k],frozen[3*n+k]);
  for(let k=0;k<3;k++)close(moving.momentum().linear[k],after.linear[k],0,1e-12*flight.pScale,'the remaining half keeps its momentum');
  assert.ok(Math.abs(moving.energy().balance)<=5e-4*flight.before.mass*1.2*1.2,'the ledger closes across the hand-off');
});

test('thermal shock: the heat solver cracks the quenched plate at its cooled face when the heat module says the surface stress reaches the strength',async t=>{
  const note=message=>t.diagnostic(message);
  const run=await quenched(),{plate}=run;
  assert.deepEqual(run.order.filter(id=>['heat','thermal-solid','fracture'].includes(id)),['heat','thermal-solid','fracture'],'heat, then the link, then the solid');
  assert.ok(run.events.length>0&&run.events.every(event=>event.type==='crack'&&event.source==='fracture'&&event.data.kind==='initiated'));
  // Where: every face of the first event batch lies in the first cell layer under the cooled face, and opens in mode I.
  assert.ok(run.depths.every(depth=>depth<1),`depths ${run.depths} cells`);assert.deepEqual(run.modes,['I']);
  // When: the heat module's estimate uses the temperature of the surface cell; at that moment the cell has cooled by
  // sigma_c (1 - nu) / (E alpha) = 79.05 K. The solid reads element temperatures (means of nodal values that average
  // in the second cell layer), so it lags: never earlier, and at most 5 % later for this film coefficient.
  close(plate.reference-run.surfaceAtEstimate,plate.criticalDrop,.01,0,'surface cooling at the estimate');close(plate.criticalDrop,79.054,1e-4);
  assert.ok(run.onset>=run.estimate&&run.onset<=1.05*run.estimate,`first crack at ${run.onset} s, estimate ${run.estimate} s`);
  // The link feeds the cracked body: its node count has grown, the heat grid has not changed.
  assert.ok(plate.body.nodeCount>plate.body.thermalNodeCount);
  assert.equal(plate.body.unconvergedSteps,0);
  note(`quench: heat-module estimate ${run.estimate} s, first crack ${run.onset} s (+${(100*(run.onset/run.estimate-1)).toFixed(1)} %), ${run.events.length} faces at depths below ${Math.max(...run.depths).toFixed(2)} cells`);
});

test('crack paths follow element faces: the area and energy of a crack inclined to the mesh depend on the mesh',async t=>{
  const note=message=>t.diagnostic(message);
  // The limit of the method, measured. The ideal crack is a plane inclined 30 degrees to the cross-section.
  const five=await inclined(),fiveFine=await inclinedCrack({pattern:'alternating5',nx:16}),six=await inclinedCrack({pattern:'kuhn6'});
  for(const run of [five,fiveFine,six]){assert.equal(run.fragments,2);assert.equal(run.unconverged,0);assert.ok(run.areaRatio>1,'a faceted crack is larger than the plane');}
  // The excess does not go away with refinement and depends on the pattern. Measured area / plane: 1.025 (five
  // tetrahedra per cell), 1.212 (the same with half the cell), 1.299 (six per cell); energy / (G_c plane): 1.375,
  // 1.486, 1.537, because faces beside the path soften without opening; peak / (sigma_c A): 1.022, 1.146, 1.072.
  assert.ok(fiveFine.areaRatio>five.areaRatio+.1,`halving the cell does not bring the area to the plane: ${five.areaRatio} and ${fiveFine.areaRatio}`);
  assert.ok(six.areaRatio-five.areaRatio>.1,`five- and six-tetrahedron cells give different cracks: ${five.areaRatio} and ${six.areaRatio}`);
  assert.ok(five.energyRatio>1.3&&fiveFine.energyRatio>1.3&&six.energyRatio>1.3&&five.roughness<.75);
  for(const run of [five,fiveFine,six])assert.ok(run.areaRatio<1.35&&run.energyRatio<1.6&&run.peak<1.2,'bounds on what was measured');
  // With insertion at the strength only (the crack-front rule off) the same strips give 1.241, 1.241 and 1.478 for
  // the area and 1.123, 1.435 and 1.109 for the peak: the rule lowers the peak error from 11-44 % to 2-15 %.
  const plain=await inclinedCrack({tip:1});
  close(plain.areaRatio,1.241,2e-3,0,'area ratio with the crack-front rule off');assert.ok(plain.peak>five.peak+.05);
  note(`inclined crack, area / plane, energy / (G_c plane), peak / (sigma_c A), rms distance / h: five-tet h ${[five.areaRatio,five.energyRatio,five.peak,five.roughness].map(v=>v.toFixed(3)).join(', ')}; five-tet h/2 ${[fiveFine.areaRatio,fiveFine.energyRatio,fiveFine.peak,fiveFine.roughness].map(v=>v.toFixed(3)).join(', ')}; six-tet h ${[six.areaRatio,six.energyRatio,six.peak,six.roughness].map(v=>v.toFixed(3)).join(', ')}`);
});

test('determinism: repeated runs are bit-identical, topology changes included; damage never decreases',async t=>{
  const note=message=>t.diagnostic(message);
  const signature=body=>[bits(body.displacements),bits(body.velocities),bits(body.tets),bits(body.nodeOrigin),bits(body.interfaces),bits(body.nodalMass)].join('|');
  // Statics with on-demand insertion along a path the mesh chooses.
  const a=await inclined(),b=await inclinedCrack({});
  assert.equal(signature(a.body),signature(b.body));assert.deepEqual(a.faces,b.faces);
  // Explicit dynamics with insertion and splitting.
  const c=await flightAt(.8),d=await freeFlight({});
  assert.equal(signature(c.body),signature(d.body));assert.deepEqual(c.events,d.events);assert.deepEqual(c.fragments,d.fragments);
  assert.ok(c.events.length>0&&c.events.some(event=>event.kind==='initiated')&&c.events.some(event=>event.kind==='opened'));
  for(let i=1;i<c.events.length;i++)assert.ok(c.events[i].time>=c.events[i-1].time,'events are in time order');
  // The thermal example through the Simulation.
  const e=await quenched(),f=await quench();
  assert.equal(signature(e.plate.body),signature(f.plate.body));assert.deepEqual(e.events,f.events);
  // ... and on through the steps in which the first cracks open.
  for(const run of [e,f])for(let i=0;i<5;i++)run.sim.step();
  assert.equal(signature(e.plate.body),signature(f.plate.body));assert.equal(e.plate.body.unconvergedSteps,0);
  // Irreversibility under a load history that reverses: pull into softening, push back into contact, pull further.
  const {body,pull}=await barBody([4,1,1],{...COHESIVE,strength:2*SIGMA_C});
  const weak=body.selectInteriorFaces((cx,cy,cz,nx)=>near(cx,BAR.length/2)&&Math.abs(nx)>.999);body.setInterfaceProperties(weak,{strength:SIGMA_C});
  const peak=SIGMA_C*BAR.length/CONCRETE.youngModulus;let last=[0,0,0],dissipated=0;
  for(const U of [.5*peak,1.2*peak,1.6*peak,.3*peak,-.5*peak,1.6*peak,2.5*peak,-.2*peak,3*peak,1.3*DELTA_C,-1e-6,2*DELTA_C]){
    pull(U);const state=body.interfaceState(weak[0]),now=body.dissipatedEnergy();
    assert.ok(state.damage.every((value,i)=>value>=last[i]),`damage fell at U = ${U}`);assert.ok(now>=dissipated,'dissipated energy never decreases');
    assert.ok(state.history.every((value,i)=>!state.inserted||value>=Math.min(state.effective[i],state.criticalOpening)*(1-1e-12)),'the history is the largest effective opening, up to delta_c');
    last=state.damage;dissipated=now;
  }
  assert.deepEqual(last,[1,1,1]);close(dissipated,G_C*AREA,1e-9);
});

test('the Subsystem adapter: stage and order of solids, the time-step rule, crack events and the energy entry',async t=>{
  const note=message=>t.diagnostic(message);
  assert.equal(FRACTURE_SUBSYSTEM_ORDER,SUBSYSTEM_ORDER.solid);
  const world={loop:{step:1e-5},step(){},gravity:()=>[0,0,0],getState:()=>null};
  const mesh=()=>boxMesh({size:[BAR.length,BAR.width,BAR.width],cells:[4,1,1]});
  const law={...COHESIVE,initialOpeningRatio:.1};
  const limit=new FractureBody({mesh:mesh(),material:CONCRETE,fracture:law}).explicitLimit();
  const reference=solidSubsystem(new SolidBody({mesh:mesh(),material:CONCRETE,config:{dt:1e-5}}));
  const implicit=new FractureBody({mesh:mesh(),material:CONCRETE,fracture:law,config:{dt:1e-5,integrator:'midpoint',tolerance:1e-12}}),adapter=fractureSubsystem(implicit);
  assert.equal(adapter.stage,reference.stage);assert.equal(adapter.order,reference.order);assert.deepEqual(adapter.timeStep,{dt:1e-5,rule:'commensurate'});assert.equal(adapter.kind,'solid-fracture');
  // The same rule as solidSubsystem: an incommensurate step is refused, an explicit body must be within its limit and may sub-cycle.
  const sim=new Simulation(world);
  assert.throws(()=>sim.add(fractureSubsystem(new FractureBody({mesh:mesh(),material:CONCRETE,fracture:law,config:{dt:.7e-5}}),{id:'odd'})),error=>error instanceof EngineError&&error.code==='INVALID_STATE');
  invalid(()=>new FractureBody({mesh:mesh(),material:CONCRETE,fracture:law,config:{dt:1e-5,integrator:'explicit'}}),'UNSTABLE_TIME_STEP');
  const substeps=Math.ceil(1e-5/(.9*limit)),explicit=new FractureBody({mesh:mesh(),material:CONCRETE,fracture:law,config:{dt:1e-5/substeps,integrator:'explicit'}});
  sim.add(adapter).add(fractureSubsystem(explicit,{id:'explicit'}));
  assert.equal(sim.order().find(row=>row.id==='explicit').timing.substeps,substeps);
  // The limit holds for any crack pattern: it does not move when interfaces are inserted, and a run at 0.9 of it stays bounded.
  const pulse=body=>body.setState(undefined,Array.from({length:3*body.nodeCount},(_,j)=>j%3===0?3*Math.sign(body.referencePositions[j]-BAR.length/2):0));
  pulse(implicit);pulse(explicit);
  const events=[];sim.onEvent(event=>events.push(event));
  const start=sim.energy().entries.find(entry=>entry.id==='fracture'),kinetic=implicit.kineticEnergy();
  for(let i=0;i<40;i++)sim.step();
  assert.equal(explicit.explicitLimit(),limit);assert.ok(explicit.kineticEnergy()+explicit.strainEnergy()<=1.001*kinetic,'the explicit run is bounded');
  assert.ok(events.length>0&&events.every(event=>event.type==='crack'&&['fracture','explicit'].includes(event.source)));
  const own=events.filter(event=>event.source==='fracture');
  assert.ok(own.some(event=>event.data.kind==='initiated')&&own.some(event=>event.data.kind==='opened'),'crack events reach the event stream');
  for(const event of own){assert.ok(Number.isInteger(event.data.face)&&event.data.face>=0&&['I','II','mixed'].includes(event.data.mode)&&event.data.energy>=0);close(event.data.time,event.tick*1e-5,1e-9,1e-12,'event time is the body time of its step');}
  close(sum(own.filter(event=>event.data.kind==='opened').map(event=>event.data.energy)),G_C*implicit.crackArea().open,1e-12,0,'the opened events carry G_c times the open area');assert.ok(implicit.dissipatedEnergy()>=G_C*implicit.crackArea().open);
  assert.equal(implicit.takeEvents().length,0,'the adapter drained the events');
  const entry=sim.energy().entries.find(item=>item.id==='fracture'),diagnostics=sim.diagnostics().subsystems.fracture;
  assert.equal(entry.domain,'mechanical');assert.ok(entry.parts.dissipated>0&&Math.abs(entry.balance-start.balance)<=5e-2*kinetic,`total - exchanged moved by ${(entry.balance-start.balance)/kinetic}`);
  assert.equal(diagnostics.solver,SOLID_FRACTURE_SOLVER_ID);assert.ok(diagnostics.interfaces>0&&diagnostics.crackArea>0);
  // The example builder validates its options.
  invalid(()=>quenchedPlate({cells:[4,4]}));invalid(()=>quenchedPlate({coefficient:-1}));
});
