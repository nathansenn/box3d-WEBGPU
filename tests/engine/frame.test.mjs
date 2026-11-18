import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameRuntime,FRAME_BACKEND} from '../../src/engine/frame-runtime.ts';
import {frameElementMatrices,frameTransverseSlope} from '../../src/engine/frame-element.ts';
import {frameConfig,frameSection,cantileverDefinition,frameElementEnergy,frameImpulseDefect,continuumCantileverMode,cantileverFrequency,independentFrameTrajectory,independentFrameImpulseDefect,rotatedFrameDefinition} from '../../scripts/frame-oracle.mjs';

const close=(a,b,atol=1e-8,rtol=0)=>assert.ok(Math.abs(a-b)<=atol+rtol*Math.abs(b),`${a} != ${b}, error ${Math.abs(a-b)}`);
const energy=s=>s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy+s.diagnostics.gravitationalEnergy;
const quadratic=(A,x)=>x.reduce((sum,v,i)=>sum+.5*v*x.reduce((r,w,j)=>r+A[12*i+j]*w,0),0);

test('frame stiffness and consistent mass match independent Hermite energy integration',()=>{
  for(const length of [.125,2,7]){
    const e=frameElementMatrices({...frameSection,a:0,b:1},[0,0,0,length,0,0]);
    for(let sample=0;sample<20;sample++){
      const u=Array.from({length:12},(_,j)=>.001*Math.sin(j*1.7+sample*.4)),reference=frameElementEnergy(u,length,frameSection);
      close(quadratic(e.stiffness,u),reference.potential,1e-9,2e-13);close(quadratic(e.massMatrix,u),reference.kinetic,1e-15,1e-13);
      assert.ok(quadratic(e.massMatrix,u)>0);
    }
    for(let i=0;i<12;i++)for(let j=0;j<12;j++){assert.equal(e.stiffness[12*i+j],e.stiffness[12*j+i]);assert.equal(e.massMatrix[12*i+j],e.massMatrix[12*j+i]);}
  }
});

test('all six rigid modes have zero elastic force and consistent translational mass',()=>{
  const positions=[.3,.2,-.4,1.7,1.1,.8],e=frameElementMatrices({...frameSection,a:0,b:1},positions);
  for(let mode=0;mode<6;mode++){
    const u=Array(12).fill(0);for(let i=0;i<2;i++){
      if(mode<3)u[6*i+mode]=1;else{const w=[0,0,0];w[mode-3]=1;const p=positions.slice(3*i,3*i+3);u[6*i]=w[1]*p[2]-w[2]*p[1];u[6*i+1]=w[2]*p[0]-w[0]*p[2];u[6*i+2]=w[0]*p[1]-w[1]*p[0];u.splice(6*i+3,3,...w);}
    }
    for(let j=0;j<12;j++)close(u.reduce((s,v,i)=>s+e.stiffness[12*j+i]*v,0),0,3e-9);
    if(mode<3)close(quadratic(e.massMatrix,u),e.mass/2,1e-12);
  }
});

test('cantilevers reproduce axial, two-plane bending and torsion compliance and all reactions',()=>{
  for(const segments of [1,4,16,32])for(const component of [0,1,2,3,4,5]){
    const d=cantileverDefinition({segments}),r=new FrameRuntime(d),load=new Float64Array((segments+1)*6),L=2,P=component<3?10:2;load[6*segments+component]=P;
    const before=r.checkpoint(),s=r.solveStatic(load);assert.ok(s.converged,JSON.stringify(s));assert.deepEqual(r.checkpoint(),before);
    const {youngModulus:E,shearModulus:G,area:A,iy:Iy,iz:Iz,torsionConstant:J}=frameSection;
    const expected=[P*L/(E*A),P*L**3/(3*E*Iz),P*L**3/(3*E*Iy),P*L/(G*J),P*L/(E*Iy),P*L/(E*Iz)][component];
    close(s.displacements[6*segments+component],expected,1e-10,1e-8);close(s.supportReactions[component],-P,2e-7);
    if(component===1){close(s.displacements[6*segments+5],P*L*L/(2*E*Iz),1e-10);close(s.supportReactions[5],-P*L,2e-7);}
    if(component===2){close(s.displacements[6*segments+4],-P*L*L/(2*E*Iy),1e-10);close(s.supportReactions[4],P*L,2e-7);}
    if(component===4)close(s.displacements[6*segments+2],-P*L*L/(2*E*Iy),1e-10);
    if(component===5)close(s.displacements[6*segments+1],P*L*L/(2*E*Iz),1e-10);r.destroy();
  }
});

test('consistent gravity loading reproduces cantilever and simply-supported distributed deflection',()=>{
  for(const simplySupported of [false,true])for(const segments of [2,8,16]){
    const d=cantileverDefinition({segments,config:{gravity:[0,-9.81,0]}}),L=2,q=-frameSection.density*frameSection.area*9.81,EI=frameSection.youngModulus*frameSection.iz;
    if(simplySupported){d.fixed.fill(0);d.fixed[0]=d.fixed[1]=d.fixed[2]=d.fixed[3]=1;d.fixed[segments*6+1]=d.fixed[segments*6+2]=1;}
    const r=new FrameRuntime(d),s=r.solveStatic();assert.ok(s.converged,JSON.stringify({segments,simplySupported,...s}));
    for(let i=0;i<=segments;i++){
      const x=L*i/segments,expected=simplySupported?q*x*(L**3-2*L*x*x+x**3)/(24*EI):q*x*x*(6*L*L-4*L*x+x*x)/(24*EI);close(s.displacements[6*i+1],expected,1e-10);
    }
    close(s.supportReactions[1]+s.supportReactions.at(-5),-q*L,1e-7);
    if(simplySupported){close(s.supportReactions[1],-q*L/2,1e-7);close(s.supportReactions[5],0);}else close(s.supportReactions[5],-q*L*L/2,1e-7);r.destroy();
  }
});

test('midpoint motion matches a closed-form semidiscrete oscillator and preserves energy',()=>{
  const L=2,omega=Math.sqrt(3*frameSection.youngModulus/(frameSection.density*L*L)),period=2*Math.PI/omega;
  for(const stepsPerPeriod of [16,32,64,128]){
    const d=cantileverDefinition({segments:1,config:{dt:period/stepsPerPeriod}});d.displacements=new Float64Array(12);d.displacements[6]=.0001;
    const r=new FrameRuntime(d),initial=r.inspect(),phase=2*Math.atan(omega*d.config.dt/2);
    for(let tick=1;tick<=stepsPerPeriod*20;tick++){
      const s=r.step({ticks:1});close(s.displacements[6],.0001*Math.cos(phase*tick),1e-11);close(s.velocities[6],-.0001*omega*Math.sin(phase*tick),1e-8);close(energy(s),energy(initial),1e-11);assert.equal(s.diagnostics.unconvergedSolves,0);
    }r.destroy();
  }
});

test('gravity-loaded members have equilibrated end actions, including free ends and point weights',()=>{
  for(const segments of [1,2,8,16])for(const rotated of [false,true]){
    const original=cantileverDefinition({segments,config:{gravity:[0,-9.81,0]}}),d=rotated?rotatedFrameDefinition(original).definition:original,r=new FrameRuntime(d),s=r.solveStatic();assert.ok(s.converged);
    for(const value of s.elementEndForces.slice(-6))close(value,0,5e-8);
    for(let i=1;i<segments;i++)for(let k=0;k<6;k++)close(s.elementEndForces[12*(i-1)+6+k]+s.elementEndForces[12*i+k],0,5e-8);r.destroy();
  }
  const d=cantileverDefinition({segments:4,config:{gravity:[0,-9.81,0]}});d.pointMasses=new Float64Array(5);d.pointMasses[4]=2;
  const r=new FrameRuntime(d),s=r.solveStatic();close(s.elementEndForces.at(-5),-19.62,1e-8);close(s.supportReactions[1],58.86,1e-8);r.destroy();
});

test('cantilever bending motion converges toward the continuum mode under mesh refinement',()=>{
  const errors=[],L=2,omega=cantileverFrequency(L),duration=2*Math.PI/omega;
  for(const segments of [2,4,8,16]){
    const d=cantileverDefinition({segments,config:{dt:duration/1024,maxIterations:512,forceTolerance:1e-7,momentTolerance:1e-8}});d.displacements=new Float64Array(6*(segments+1));
    for(let i=1;i<=segments;i++){const mode=continuumCantileverMode(L*i/segments,L);d.displacements[6*i+1]=.001*mode.value;d.displacements[6*i+5]=.001*mode.slope;}
    const r=new FrameRuntime(d);let error=0;
    for(let tick=1;tick<=1024;tick++){const s=r.step({ticks:1});assert.equal(s.diagnostics.unconvergedSolves,0);error=Math.max(error,Math.abs(s.displacements[6*segments+1]/.001-Math.cos(omega*tick*d.config.dt)));}
    errors.push(error);r.destroy();
  }
  assert.ok(errors.at(-1)<2e-5,JSON.stringify(errors));assert.ok(errors[0]/errors[1]>8&&errors[1]/errors[2]>5,JSON.stringify(errors));
});

test('axial and torsional temporal errors decrease fourfold while discrete phase remains exact',()=>{
  for(const component of [0,3]){
    const omega=component===0?Math.sqrt(3*frameSection.youngModulus/(frameSection.density*4)):Math.sqrt(3*frameSection.shearModulus*frameSection.torsionConstant/(frameSection.density*(frameSection.iy+frameSection.iz)*4)),period=2*Math.PI/omega,errors=[];
    for(const steps of [32,64,128,256]){
      const d=cantileverDefinition({segments:1,config:{dt:period/steps}});d.displacements=new Float64Array(12);d.displacements[6+component]=.0001;
      const r=new FrameRuntime(d);let error=0;
      for(let tick=1;tick<=steps;tick++){const s=r.step({ticks:1});error=Math.max(error,Math.abs(s.displacements[6+component]/.0001-Math.cos(omega*tick*d.config.dt)));close(s.displacements[6+component],.0001*Math.cos(tick*2*Math.atan(omega*d.config.dt/2)),1e-12);}
      errors.push(error);r.destroy();
    }
    assert.ok(errors.slice(1).every((v,i)=>errors[i]/v>3.9&&errors[i]/v<4.1),JSON.stringify(errors));
  }
});

test('an oblique spatial frame follows independent quadrature and dense Cholesky dynamics',()=>{
  for(const free of [false,true]){
    const d=cantileverDefinition({segments:4,free,config:{gravity:[0,-1,.3],drag:2,substeps:2,forceTolerance:1e-10,momentTolerance:1e-10,maxIterations:512}});
    for(let i=0;i<=4;i++){d.positions[3*i+1]=.13*Math.sin(i);d.positions[3*i+2]=.07*i*i;}
    d.pointMasses=Float64Array.from({length:5},(_,i)=>.1*(i+1));d.pointInertias=Float64Array.from({length:15},(_,i)=>.001*(i+1));
    const r=new FrameRuntime(d),reference=independentFrameTrajectory(d);let previous=r.inspect();
    for(let tick=1;tick<=240;tick++){
      const commands=tick===1?[{tick,type:'force',node:4,value:[.2,-1,.3,.01,.02,.03]}]:tick===80?[{tick,type:'impulse',node:4,value:[.003,-.002,.001,.0001,.0002,.0001]}]:[];
      const s=r.step({ticks:1,commands}),expected=reference.step(commands),defect=independentFrameImpulseDefect(reference.matrices,previous,s,d.positions);
      assert.equal(s.diagnostics.unconvergedSolves,0);
      for(let j=0;j<s.velocities.length;j++){close(s.displacements[j],expected.displacements[j],2e-10);close(s.velocities[j],expected.velocities[j],3e-9);}
      assert.ok(defect.linear<1e-9&&defect.angular<1e-9,JSON.stringify(defect));previous=s;
    }r.destroy();
  }
});

test('frame response and reactions rotate with the reference geometry',()=>{
  const d=cantileverDefinition({segments:4,config:{gravity:[0,-1,.3],drag:1,forceTolerance:1e-10,momentTolerance:1e-10,maxIterations:512}});d.forces=new Float64Array(30);d.forces.set([.2,-1,.3,.01,.02,.03],24);
  const {definition,rotate}=rotatedFrameDefinition(d),original=new FrameRuntime(d),rotated=new FrameRuntime(definition);
  for(let tick=1;tick<=120;tick++){
    const a=original.step({ticks:1}),b=rotated.step({ticks:1});assert.equal(a.diagnostics.unconvergedSolves+b.diagnostics.unconvergedSolves,0);
    for(const key of ['displacements','velocities','supportReactions'])for(let i=0;i<a[key].length;i+=3){const expected=rotate(Array.from(a[key]).slice(i,i+3));for(let j=0;j<3;j++)close(b[key][i+j],expected[j],key==='supportReactions'?1e-7:2e-9);}
    close(energy(a),energy(b),1e-10);
  }original.destroy();rotated.destroy();
});

test('small-kinematics screening includes interior Hermite slopes and static solutions',()=>{
  const d=cantileverDefinition({segments:1});d.displacements=new Float64Array(12);d.displacements[7]=.16;
  const r=new FrameRuntime(d),s=r.inspect();close(s.diagnostics.maxTransverseSlope,.12,1e-14);assert.equal(s.diagnostics.linearKinematicsExceeded,true);r.destroy();
  for(let sample=0;sample<40;sample++){
    const u=Array.from({length:12},(_,j)=>.1*Math.sin(j*2.1+sample)),L=2,maximum=frameTransverseSlope(u,L);let sampled=0;
    for(let j=0;j<=1000;j++){const x=j/1000,H=[(-6*x+6*x*x)/L,1-4*x+3*x*x,(6*x-6*x*x)/L,-2*x+3*x*x],v=[u[1],u[5],u[7],u[11]],w=[u[2],-u[4],u[8],-u[10]],dot=v=>H.reduce((sum,h,k)=>sum+h*v[k],0);sampled=Math.max(sampled,Math.hypot(dot(v),dot(w)));}
    assert.ok(maximum>=sampled-1e-13&&maximum-sampled<2e-6,`${maximum}, ${sampled}`);
  }
  const staticRuntime=new FrameRuntime(cantileverDefinition({segments:2})),load=new Float64Array(18);load[13]=1000;assert.equal(staticRuntime.solveStatic(load).linearKinematicsExceeded,true);staticRuntime.destroy();
});

test('signed zero checkpoint metadata has a canonical JSON roundtrip',()=>{
  const r=new FrameRuntime(cantileverDefinition({segments:1})),c=r.checkpoint();
  for(const [key,value] of Object.entries(c.state))if(value===0)c.state[key]=-0;
  const restored=FrameRuntime.fromCheckpoint(c);assert.deepEqual(restored.checkpoint(),JSON.parse(JSON.stringify(restored.checkpoint())));assert.deepEqual(restored.inspect(),r.inspect());r.destroy();restored.destroy();
});

test('forces, moments, impulses and damping close energy and both momentum budgets',()=>{
  for(const free of [false,true]){
    const d=cantileverDefinition({segments:4,free,config:{gravity:[0,-1,.3],drag:2,substeps:2}}),r=new FrameRuntime(d);let previous=r.inspect();
    for(let tick=1;tick<=240;tick++){
      const commands=tick===1?[{tick,type:'force',node:4,value:[.2,1,-.3,.01,.02,-.01]}]:tick===80?[{tick,type:'impulse',node:4,value:[.003,.004,-.002,.0001,.0002,.0003]}]:[];
      const s=r.step({ticks:1,commands}),defect=frameImpulseDefect(previous,s,d.positions);
      assert.equal(s.diagnostics.unconvergedSolves,0);close(energy(s)-energy(previous)-(s.diagnostics.externalWork-previous.diagnostics.externalWork)+(s.diagnostics.dragDissipation-previous.diagnostics.dragDissipation),0,3e-9);
      assert.ok(defect.linear<1e-9&&defect.angular<1e-9,JSON.stringify(defect));previous=s;
    }r.destroy();
  }
});

test('complete JSON checkpoints and owned snapshots retain exact deterministic continuation',()=>{
  const d=cantileverDefinition({segments:4,config:{drag:2}}),r=new FrameRuntime(d);r.step({ticks:20,commands:[{tick:1,type:'force',node:4,value:[.1,-2,.3,.01,.01,.01]},{tick:10,type:'impulse',node:4,value:[.002,0,0,0,0,0]}]});
  const checkpoint=JSON.parse(JSON.stringify(r.checkpoint())),restored=FrameRuntime.fromCheckpoint(checkpoint);assert.deepEqual(r.inspect(),restored.inspect());assert.deepEqual(r.step({ticks:40}),restored.step({ticks:40}));assert.equal(restored.inspect().backend,FRAME_BACKEND);
  checkpoint.state.displacements.fill(999);const s=r.inspect();s.displacements.fill(999);assert.notDeepEqual(s.displacements,r.inspect().displacements);r.destroy();restored.destroy();
});

test('invalid commands, unsupported geometry and incompatible checkpoints are rejected before mutation',()=>{
  const d=cantileverDefinition({segments:2}),r=new FrameRuntime(d),before=r.checkpoint();
  for(const commands of [[{tick:1,type:'force',node:1,value:[1,0,0,0,0,0]},{tick:2,type:'force',node:1,value:[NaN,0,0,0,0,0]}],[{tick:1,type:'impulse',node:0,value:[1,0,0,0,0,0]}]])assert.throws(()=>r.step({ticks:2,commands}));assert.deepEqual(before,r.checkpoint());
  for(const mutate of [d=>d.elements[0].up=[1,0,0],d=>d.elements[0].a=d.elements[0].b,d=>d.elements[0].iy=0,d=>d.fixed[7]=.5,d=>d.elements=[],d=>d.config.forceTolerance=NaN]){const copy=structuredClone(d);if(mutate.toString().includes('fixed'))copy.fixed=Array.from(copy.fixed);mutate(copy);assert.throws(()=>new FrameRuntime(copy));}
  for(const mutate of [c=>c.backend='studio-pbd-js-v1',c=>c.state.displacements[0]=1,c=>c.state.supportImpulse[6]=1,c=>c.state.reactions[6]=1,c=>c.state.forces[0]=Infinity,c=>c.state.reactionTime=1]){const copy=structuredClone(before);mutate(copy);assert.throws(()=>FrameRuntime.fromCheckpoint(copy));}
  r.destroy();r.destroy();assert.equal(r.u.byteLength,0);assert.equal(r.elements.length,0);assert.throws(()=>r.inspect(),/destroyed/);
});

test('iteration caps, static mechanisms and the small-rotation domain remain explicit',()=>{
  const d=cantileverDefinition({segments:8,config:{maxIterations:1}});d.forces=new Float64Array(54);d.forces[49]=-10;const r=new FrameRuntime(d),s=r.step({ticks:1});assert.ok(s.diagnostics.unconvergedSolves>0);assert.equal(s.diagnostics.maxIterationsUsed,1);assert.equal(r.solveStatic().converged,false);r.destroy();
  const free=new FrameRuntime(cantileverDefinition({segments:1,free:true})),force=new Float64Array(12);force[6]=1;assert.equal(free.solveStatic(force).converged,false);free.destroy();
  const rotated=cantileverDefinition({segments:1});rotated.displacements=new Float64Array(12);rotated.displacements[11]=.2;const domain=new FrameRuntime(rotated);assert.equal(domain.inspect().diagnostics.linearKinematicsExceeded,true);domain.destroy();
});
