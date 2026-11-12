// Closed-form validation of J2 (von Mises) plasticity with linear isotropic hardening in the tetrahedral
// solid (src/engine/solid.ts), SI units. Every tolerance is stated beside the check with its reason.
// Measured values are printed as test diagnostics (`node --test --test-reporter=tap`);
// docs/SOLID_MECHANICS.md quotes them. No check depends on wall-clock time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SOLID_PLASTIC_SOLVER_ID,boxMesh} from '../../src/engine/solid.ts';
import {EngineError} from '../../src/engine/contracts.ts';

const E=200e9,NU=.3,SY=250e6;
const near=(a,b)=>Math.abs(a-b)<1e-12;
const close=(actual,expected,relative,absolute=0,label='')=>assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),`${label} ${actual} != ${expected}: relative ${Math.abs(actual/expected-1)}`);
const invalid=fn=>assert.throws(fn,error=>error instanceof EngineError&&error.code==='INVALID_PAYLOAD');

/** Uniaxial stress: bar along x on three symmetry planes, end displacement prescribed. */
export function uniaxialBar(model,material={},cells=[4,1,1]){
  const L=.1,w=.01,body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY,...material},config:{model}});
  body.constrain(body.selectNodes(x=>near(x,0)),[0,null,null]);body.constrain(body.selectNodes((x,y)=>near(y,0)),[null,0,null]);body.constrain(body.selectNodes((x,y,z)=>near(z,0)),[null,null,0]);
  const end=body.selectNodes(x=>near(x,L));
  return {body,stretch(strain){body.constrain(end,[strain*L,null,null]);const r=body.solveStatic();let F=0;for(const n of end)F+=r.reactions[3*n];return {stress:F/(w*w),result:r};}};
}
/** Bilinear uniaxial law with kinematics of isotropic hardening, integrated along a strain path. */
export function bilinearPath(path,H){
  let ep=0,p=0;const out=[];
  for(const strain of path){const trial=E*(strain-ep),sy=SY+H*p,f=Math.abs(trial)-sy;if(f>0){const dp=f/(E+H);ep+=Math.sign(trial)*dp;p+=dp;}out.push({stress:E*(strain-ep),p});}
  return out;
}
const PATH=[5e-4,1e-3,2e-3,4e-3,6e-3,3e-3,0,-2e-3,-6e-3];

test('uniaxial cycle, linear model: hardening branch, elastic unloading and reverse yield match the bilinear law exactly',()=>{
  for(const H of [0,2e9]){
    const bar=uniaxialBar('linear',{hardeningModulus:H}),exact=bilinearPath(PATH,H);let worst=0;
    PATH.forEach((strain,i)=>{
      const {stress,result}=bar.stretch(strain);assert.ok(result.converged);
      close(stress,exact[i].stress,1e-9,0,`H=${H} strain=${strain}`);close(bar.body.equivalentPlasticStrain()[0],exact[i].p,1e-8,1e-15,'p');
      worst=Math.max(worst,Math.abs(stress/exact[i].stress-1));
    });
    console.log(`# uniaxial linear H=${H}: largest relative stress error ${worst.toExponential(2)}`);
  }
});

test('uniaxial, green-lagrange model: agrees with the small-strain law within 2% at strains up to 0.6%, and is exact under a rigid turn',()=>{
  const bar=uniaxialBar('green-lagrange',{hardeningModulus:2e9}),exact=bilinearPath(PATH,2e9);
  PATH.forEach((strain,i)=>{const {stress}=bar.stretch(strain);close(stress,exact[i].stress,.02,0,`strain ${strain}`);});
  // A body yielded in tension then turned rigidly by 90 degrees about z keeps its plastic state and carries no stress change.
  const b=new SolidBody({mesh:boxMesh({size:[.02,.01,.01],cells:[2,1,1]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY},config:{model:'green-lagrange'}});
  const X=b.referencePositions,u=new Float64Array(X.length);for(let j=0;j<X.length;j+=3)u[j]=.01*X[j];
  b.setState(u);b.kernel().commit();const before=b.stresses(),ep=b.equivalentPlasticStrain().slice();
  for(let j=0;j<X.length;j+=3){const x=X[j]+u[j],y=X[j+1];u[j]=-y-X[j];u[j+1]=x-X[j+1];}
  b.setState(u);const after=b.stresses();
  // Cauchy stress turns with the body: sigma_xx before is sigma_yy after.
  for(let e=0;e<b.tetCount;e++){close(after[6*e+1],before[6*e],1e-9,1e-3*SY);close(after[6*e],before[6*e+1],1e-9,1e-3*SY);}
  assert.deepEqual(Array.from(b.equivalentPlasticStrain()),Array.from(ep));
});

test('internal force is the gradient of the incremental potential and the tangent is its derivative, both models',()=>{
  for(const model of ['linear','green-lagrange']){
    const b=new SolidBody({mesh:boxMesh({size:[.02,.01,.01],cells:[2,1,1]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY,hardeningModulus:1e9},config:{model}});
    const n=3*b.nodeCount,X=b.referencePositions;let seed=7;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5;};
    const u0=new Float64Array(n);for(let j=0;j<n;j++)u0[j]=4e-4*rnd()+(j%3===0?.003*X[j]:0);
    const k=b.kernel();b.setState(u0);k.commit();
    const th=.6,c=Math.cos(th),s=Math.sin(th),u=new Float64Array(n);
    for(let j=0;j<n;j+=3){const x=X[j]+u0[j]+3e-4*rnd(),y=X[j+1]+u0[j+1]+3e-4*rnd(),z=X[j+2]+u0[j+2];const turn=model==='green-lagrange';u[j]=(turn?c*x-s*y:x)-X[j];u[j+1]=(turn?s*x+c*y:y)-X[j+1];u[j+2]=z-X[j+2];}
    const f0=new Float64Array(n),f1=new Float64Array(n),f2=new Float64Array(n),out=new Float64Array(n),dir=Float64Array.from({length:n},rnd);
    k.energy(u,f0,true);k.tangentProduct(dir,out);
    const h=1e-9,up=u.map((v,j)=>v+h*dir[j]),um=u.map((v,j)=>v-h*dir[j]);
    const e1=k.energy(up,f1,false),e2=k.energy(um,f2,false);let err=0,ref=0,dot=0;
    for(let j=0;j<n;j++){const fd=(f1[j]-f2[j])/(2*h);err=Math.max(err,Math.abs(fd-out[j]));ref=Math.max(ref,Math.abs(fd));dot+=f0[j]*dir[j];}
    assert.ok(Math.max(...b.equivalentPlasticStrain())>.01,'the state is plastic');
    // 1e-7: central differences with step 1e-9 on displacements of 1e-3 (rounding about 1e-8).
    assert.ok(err/ref<1e-7,`${model} tangent ${err/ref}`);assert.ok(Math.abs((e1-e2)/(2*h)/dot-1)<1e-6,`${model} gradient`);
    console.log(`# ${model}: tangent error ${(err/ref).toExponential(2)}, gradient error ${Math.abs((e1-e2)/(2*h)/dot-1).toExponential(2)}`);
  }
});

test('work balance: work of the end force equals stored elastic energy plus plastic work',()=>{
  const bar=uniaxialBar('linear',{hardeningModulus:2e9});let work=0,previous={stress:0,strain:0};
  for(let i=1;i<=40;i++){const strain=i*1.5e-4,{stress}=bar.stretch(strain);work+=.5*(stress+previous.stress)*(strain-previous.strain)*1e-5;previous={stress,strain};}
  // Trapezoidal work of a bilinear curve sampled at 40 points: the knee costs at most (dsigma deps) / 8 of one interval.
  const stored=bar.body.strainEnergy(),plastic=bar.body.plasticWork;
  close(work,stored+plastic,2e-3,0,'work');console.log(`# work ${work} J, stored ${stored} J, plastic ${plastic} J`);
});

/** Pure bending of a rectangular beam, half width by symmetry: end face turned by k L about z. */
function pureBending(H=0,nx=16,ny=8){
  const h=.01,b=.01,L=.02,body=new SolidBody({mesh:boxMesh({size:[L,h,b/2],cells:[nx,ny,2]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY,hardeningModulus:H},config:{model:'linear'}});
  body.constrain(body.selectNodes(x=>near(x,0)),[0,null,null]);body.constrain(body.selectNodes((x,y,z)=>near(z,0)),[null,null,0]);body.constrain(body.selectNodes((x,y)=>near(x,0)&&near(y,h/2)),[0,0,null]);
  const end=body.selectNodes(x=>near(x,L)),mid=body.selectNodes(x=>near(x,L/2)),X=body.referencePositions;
  const curvature=()=>{let sy=0,sx=0,sxy=0,syy=0,n0=0;const u=body.displacements;for(const n of mid){const y=X[3*n+1]-h/2;sy+=y;sx+=u[3*n];sxy+=y*u[3*n];syy+=y*y;n0++;}return -(n0*sxy-sy*sx)/(n0*syy-sy*sy)/(L/2);};
  return {body,h,b,end,curvature,bend(k){for(const n of end)body.constrain([n],[-k*L*(X[3*n+1]-h/2),null,null]);const r=body.solveStatic();let M=0;for(const n of end)M-=r.reactions[3*n]*(X[3*n+1]-h/2);return {moment:2*M,result:r};}};
}
export function beamMoment(k,H,h=.01,b=.01){
  const Et=E*H/(E+H),ey=SY/E,c=Math.min(h/2,ey/k);let M=E*k*c**3/3;
  if(c<h/2)M+=(SY-Et*ey)*((h/2)**2-c*c)/2+Et*k*((h/2)**3-c**3)/3;
  return 2*b*M;
}

test('pure bending: elastic-plastic moment-curvature of a rectangular section, and springback after release',()=>{
  const beam=pureBending(0),ky=2*SY/E/beam.h,I=beam.b*beam.h**3/12,My=SY*I/(beam.h/2),rows=[];
  for(const r of [.5,2,8]){
    const k=r*ky,{moment,result}=beam.bend(k);assert.ok(result.converged);
    const exact=beamMoment(k,0);rows.push([r,moment/My,exact/My]);
    // Linear tetrahedra are too stiff in bending: 2.9% elastic and 3.2% fully plastic on 16 x 8 x 2 cells (measured; see docs).
    assert.ok(moment>exact&&moment<1.04*exact,`k/ky=${r}: ${moment/My} vs ${exact/My}`);
  }
  console.log(`# moment-curvature (k/ky, M/My measured, exact): ${rows.map(r=>r.map(v=>v.toFixed(4)).join(' ')).join(' | ')}`);
  // Springback: the release is elastic, so the curvature falls by M / (E I), with M of the curvature the section reached.
  const loaded=beam.curvature();beam.body.release(beam.end);const free=beam.body.solveStatic();assert.ok(free.converged);
  const recovered=loaded-beam.curvature(),expected=beamMoment(loaded,0)/(E*I);
  // 1%: the release of a fully plastic section recovers M / (E I); the mesh's bending stiffness and moment are both ~3% high and largely cancel.
  close(recovered,expected,.01,0,'springback');
  console.log(`# springback at k = ${(loaded/ky).toFixed(3)} ky: recovered ${(recovered/ky).toFixed(4)} ky, M/(EI) ${(expected/ky).toFixed(4)} ky`);
});

/** Plane-strain quarter of a thick-walled cylinder, inner radius a, outer b = 2a, pressure on the bore. */
function cylinder(nr=8,nt=8){
  const a=.05,b=.1,mesh=boxMesh({size:[1,1,.005],cells:[nr,nt,1]}),P=mesh.positions;
  for(let i=0;i<P.length;i+=3){const r=a+(b-a)*P[i],t=P[i+1]*Math.PI/2;P[i]=r*Math.cos(t);P[i+1]=r*Math.sin(t);}
  const body=new SolidBody({mesh,material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY},config:{model:'linear',maxNewtonIterations:200}}),n9=(x,y)=>Math.abs(x-y)<1e-9;
  body.constrain(body.selectNodes((x,y)=>n9(y,0)),[null,0,null]);body.constrain(body.selectNodes(x=>n9(x,0)),[0,null,null]);body.constrain(body.selectNodes(()=>true),[null,null,0]);
  const bore=body.selectFaces((cx,cy,cz,nx,ny,nz)=>Math.hypot(cx,cy)<a*1.01&&Math.abs(nz)<.5),outer=body.selectNodes((x,y)=>n9(Math.hypot(x,y),b));
  return {body,a,b,load(p){body.clearSurfaceLoads();body.addPressure(bore,p);const r=body.solveStatic();const u=body.displacements,X=body.referencePositions;let ur=0;for(const n of outer)ur+=(u[3*n]*X[3*n]+u[3*n+1]*X[3*n+1])/b;return {result:r,outer:ur/outer.length,yielded:body.equivalentPlasticStrain().filter(v=>v>0).length};}};
}

test('thick-walled cylinder under internal pressure (plane strain): first yield and the Hill collapse pressure',()=>{
  const c=cylinder(),k2=c.a**2/(c.b**2-c.a**2);
  // Lame stresses at the bore: sigma_r = -p, sigma_theta = p (1 + 2 k2), sigma_z = 2 nu p k2; first yield where their von Mises value is sigma_y.
  const st=1+2*k2,sz=2*NU*k2,vm=Math.sqrt(.5*((-1-st)**2+(st-sz)**2+(sz+1)**2)),py=SY/vm,pL=2/Math.sqrt(3)*SY*Math.log(c.b/c.a);
  const elastic=c.load(.97*py);assert.equal(elastic.yielded,0,'no element yields below first yield');
  // Lame outer displacement (1 + nu) p a^2 / (E (b^2 - a^2)) ((1 - 2 nu) b + b): 1.1% on 8 x 8 cells (the bore is an 8-sided polygon).
  close(elastic.outer,(1+NU)*.97*py*c.a**2/(E*(c.b**2-c.a**2))*((1-2*NU)*c.b+c.b),.015,0,'Lame');
  // Element stresses are read at centroids, a little outside the bore: yield shows within 6% above py.
  assert.ok(c.load(1.06*py).yielded>0);
  const before=c.load(.98*pL),after=c.load(1.02*pL);
  console.log(`# cylinder: py ${(py/1e6).toFixed(2)} MPa, pL ${(pL/1e6).toFixed(2)} MPa; outer displacement at 0.98 pL ${before.outer.toExponential(3)} m, at 1.02 pL ${after.outer.toExponential(3)} m`);
  // Hill: the wall is fully plastic at pL = (2 / sqrt 3) sigma_y ln(b / a). Below it the displacement stays elastic in size; 2% above it the wall flows.
  assert.ok(before.result.converged&&before.outer<5*elastic.outer,'contained flow below pL');
  assert.ok(after.outer>50*before.outer||!after.result.converged,'collapse above pL');
});

test('ductile erosion: an element whose equivalent plastic strain reaches failureStrain stops carrying load',()=>{
  const bar=uniaxialBar('linear',{hardeningModulus:2e9,failureStrain:.01},[4,1,1]);
  const below=bar.stretch(.0105);assert.equal(bar.body.erodedCount,0);assert.ok(below.stress>SY);
  bar.stretch(.0115);
  // Plastic strain at 0.0115 total strain: 0.0115 - sigma / E ~ 0.0102 >= 0.01: every element erodes; the bar carries nothing.
  assert.equal(bar.body.erodedCount,bar.body.tetCount);assert.ok(Math.abs(bar.stretch(.012).stress)<1e-6*SY);
  assert.equal(bar.body.erodedMask.reduce((a,b)=>a+b,0),bar.body.tetCount);
});

test('plastic inputs: validated, solver id, and refused for models and integrators that cannot carry them',()=>{
  const mesh=boxMesh({size:[1,1,1],cells:[1,1,1]}),m={youngModulus:E,poissonRatio:NU,density:7850};
  assert.equal(new SolidBody({mesh,material:{...m,yieldStress:SY},config:{model:'linear'}}).solver,SOLID_PLASTIC_SOLVER_ID);
  assert.equal(new SolidBody({mesh,material:m}).plastic,false);
  invalid(()=>new SolidBody({mesh,material:{...m,yieldStress:SY},config:{model:'corotational'}}));
  invalid(()=>new SolidBody({mesh,material:{...m,yieldStress:SY},config:{model:'neo-hookean'}}));
  invalid(()=>new SolidBody({mesh,material:{...m,yieldStress:SY},config:{model:'linear',integrator:'midpoint'}}));
  invalid(()=>new SolidBody({mesh,material:{...m,hardeningModulus:1e9}}));
  // Plasticity and the Prony viscoelasticity do not combine in this version: refused with a clear error, not mixed silently.
  assert.throws(()=>new SolidBody({mesh,material:{...m,yieldStress:SY},config:{model:'linear',viscoelastic:{branches:[{ratio:1,time:1}]}}}),error=>error instanceof EngineError&&error.code==='INVALID_PAYLOAD'&&/viscoelastic or plastic/.test(error.message));
  invalid(()=>new SolidBody({mesh,material:{...m,yieldStress:-1},config:{model:'linear'}}));
});

test('explicit and backward-Euler dynamics commit the plastic state every step and reset clears it',()=>{
  for(const integrator of ['backward-euler','explicit']){
    const body=new SolidBody({mesh:boxMesh({size:[.1,.01,.01],cells:[8,1,1]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY},config:{model:'linear',integrator,dt:integrator==='explicit'?1e-7:1e-5}});
    body.constrain(body.selectNodes(x=>near(x,0)),[0,0,0]);body.constrain(body.selectNodes(x=>near(x,.1)),[.002,null,null]);
    body.step(integrator==='explicit'?400:20);
    assert.ok(Math.max(...body.equivalentPlasticStrain())>0,integrator);assert.ok(body.plasticWork>0);
    body.reset();assert.equal(Math.max(...body.equivalentPlasticStrain()),0);assert.equal(body.plasticWork,0);
  }
});

test('a plastic solid resumes from a checkpoint bit for bit: plastic strain, hardening, eroded elements and the stepping state',async()=>{
  const {encodeState,decodeState}=await import('../../src/engine/checkpoint.ts');
  const make=()=>{
    const body=new SolidBody({mesh:boxMesh({size:[.1,.01,.01],cells:[8,1,1]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY,hardeningModulus:2e9,failureStrain:.004},config:{model:'green-lagrange',dt:1e-5}});
    body.constrain(body.selectNodes(x=>near(x,0)),[0,0,0]);body.setNodalForce(body.selectNodes(x=>near(x,.1))[0],[3e4,2e3,0]);return body;
  };
  const a=make();a.step(30);
  const saved=encodeState(a.saveState());
  assert.ok(Math.max(...a.equivalentPlasticStrain())>0,'yielded before the checkpoint');
  a.step(40);const expected=encodeState(a.saveState());
  const b=make();b.restoreState(decodeState(saved));b.step(40);
  assert.ok(a.erodedCount>0,'elements eroded after the checkpoint');
  assert.deepEqual(encodeState(b.saveState()),expected);
  assert.deepEqual(encodeState(b.saveState()),encodeState(b.saveState()),'saving twice gives the same bytes');
});
