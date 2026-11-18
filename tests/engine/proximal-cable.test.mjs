import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../src/engine/compliant-cable.ts';
import {proximalConfig,spanDefinition,discreteSpanReference,continuumSpanReference,symmetricDefinition,symmetricTrajectory,independentForceResidual,impulseDefect} from '../../scripts/cable-proximal-oracle.mjs';

const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} within ${tolerance}`);
function advance(r,ticks){while(ticks){const n=Math.min(ticks,60);r.step({ticks:n});ticks-=n;}return r.inspect();}

test('curved motion agrees with an independent nonlinear scalar solve, including hard constraints',()=>{
  for(const dt of [1/30,1/120,1/480])for(const hard of [false,true]){
    const d=symmetricDefinition({dt,hard}),ticks=Math.round(1/dt),reference=symmetricTrajectory(d,ticks),r=new core.CompliantCableRuntime(d);let previous=r.inspect();
    for(let tick=1;tick<=ticks;tick++){
      const s=r.step({ticks:1});close(s.positions[3],0,1e-8);close(-s.positions[4],reference[tick].y,1e-8);close(-s.velocities[4],reference[tick].v,2e-7);
      assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.ok(independentForceResidual(d,previous,s)<2e-7);assert.ok(impulseDefect(previous,s)<1e-10);previous=s;
    }r.destroy();
  }
});

test('curved spans match force-polygon shooting and converge toward the extensible catenary',()=>{
  for(const rigidity of [500,1000,5000]){
    const errors=[],continuum=continuumSpanReference(rigidity);
    for(const segments of [8,16,32]){
      const d=spanDefinition(core,{segments,rigidity,substeps:16}),expected=discreteSpanReference(d),r=new core.CompliantCableRuntime(d),s=advance(r,1200);
      for(let j=0;j<s.positions.length;j++)close(s.positions[j],expected.positions[j],2e-7);
      for(let j=0;j<s.tensions.length;j++)close(s.tensions[j],expected.tensions[j],2e-5);
      close(s.supportReactions[1]+s.supportReactions.at(-2),expected.reaction,3e-6);close(s.supportReactions[0],-expected.horizontal,2e-5);
      assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.ok(s.diagnostics.maxImplicitForceResidual<=d.config.forceTolerance);
      errors.push(Math.abs(-s.positions[3*segments/2+1]-continuum.sag));r.destroy();
    }
    for(let i=1;i<errors.length;i++)assert.ok(errors[i-1]/errors[i]>3.7&&errors[i-1]/errors[i]<4.3,JSON.stringify({rigidity,errors}));
  }
});

test('inextensible spans satisfy curved equilibrium without elastic stretch',()=>{
  const d=spanDefinition(core,{segments:8,hard:true,substeps:8}),expected=discreteSpanReference(d),r=new core.CompliantCableRuntime(d),s=advance(r,1200);
  s.positions.forEach((v,j)=>close(v,expected.positions[j],2e-7));s.tensions.forEach((v,j)=>close(v,expected.tensions[j],2e-5));
  close(s.supportReactions[1]+s.supportReactions.at(-2),expected.reaction,2e-5);assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.equal(s.diagnostics.elasticEnergy,0);r.destroy();
});

test('three-dimensional force and impulse commands close momentum for each complete tick and preserve checkpoint replay',()=>{
  const d=spanDefinition(core,{segments:16,substeps:8}),r=new core.CompliantCableRuntime(d);let previous=r.inspect();
  for(let tick=1;tick<=300;tick++){
    const commands=tick===1?[{tick,type:'force',node:8,value:[.2,-1,.1]},{tick,type:'force',node:0,value:[3,2,1]}]:tick===80?[{tick,type:'impulse',node:8,value:[.35,0,.15]}]:[];
    const s=r.step({ticks:1,commands});assert.ok(impulseDefect(previous,s)<2e-9);assert.equal(s.diagnostics.unconvergedSubsteps,0);previous=s;
  }
  const checkpoint=JSON.parse(JSON.stringify(r.checkpoint())),restored=core.CompliantCableRuntime.fromCheckpoint(checkpoint);
  assert.equal(checkpoint.backend,core.PROXIMAL_CABLE_BACKEND);assert.equal(checkpoint.version,2);assert.deepEqual(restored.inspect(),r.inspect());assert.deepEqual(restored.step({ticks:30}),r.step({ticks:30}));
  checkpoint.state.impulses.support.fill(999);const s=r.inspect();s.impulses.support.fill(888);assert.notDeepEqual(r.inspect().impulses.support,s.impulses.support);r.destroy();restored.destroy();
});

test('off-axis elastic networks conserve linear momentum and obey the backward-Euler energy inequality',()=>{
  const d={config:{...proximalConfig,substeps:1,dt:1/120,drag:0,gravity:[0,0,0],forceTolerance:1e-7,residualTolerance:1e-11},positions:[-1,0,.2,.8,.3,-.1,.2,1,.8],masses:[2,3,1],velocities:[.4,.2,.1,-.3,.1,-.2,.2,-.3,.4],constraints:[{a:0,b:1,restLength:1.5,compliance:.01},{a:1,b:2,restLength:1,compliance:.02},{a:2,b:0,restLength:1.1,compliance:.015}]};
  const r=new core.CompliantCableRuntime(d);let previous=r.inspect();
  for(let tick=1;tick<=600;tick++){
    const s=r.step({ticks:1});assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.ok(independentForceResidual(d,previous,s)<2e-7);assert.ok(impulseDefect(previous,s)<1e-10);
    const kineticDefect=d.masses.reduce((sum,m,i)=>sum+.5*m*[0,1,2].reduce((v,k)=>v+(s.velocities[3*i+k]-previous.velocities[3*i+k])**2,0),0);
    assert.ok(s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy+kineticDefect<=previous.diagnostics.kineticEnergy+previous.diagnostics.elasticEnergy+1e-8);previous=s;
  }r.destroy();
});

test('mixed hard and elastic links preserve three-dimensional force balance without hard-link stretch',()=>{
  const d={config:{...proximalConfig,substeps:1,dt:1/120,drag:2,gravity:[0,0,0],maxIterations:4096,residualTolerance:1e-12,forceTolerance:1e-8},positions:[-1,0,.2,.8,.3,-.1,.2,1,.8],masses:[2,3,1],velocities:[-1,.2,.1,1,.1,-.2,.2,-.3,.4],constraints:[{a:0,b:1,restLength:1.9,compliance:0},{a:1,b:2,restLength:1,compliance:.02},{a:2,b:0,restLength:1.1,compliance:.015}]};
  const r=new core.CompliantCableRuntime(d);let previous=r.inspect(),becameTaut=false;
  for(let tick=1;tick<=300;tick++){
    const s=r.step({ticks:1});assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.ok(independentForceResidual(d,previous,s)<3e-8);assert.ok(impulseDefect(previous,s)<1e-10);
    const length=Math.hypot(...[0,1,2].map(k=>s.positions[3+k]-s.positions[k]));assert.ok(length<=1.9+1e-11);if(s.tensions[0]>1)becameTaut=true;previous=s;
  }assert.ok(becameTaut);r.destroy();
});

test('a rotated and translated nonlinear problem gives the same physical trajectory',()=>{
  const d=symmetricDefinition(),transform=(values,translate=false)=>Array.from({length:values.length/3},(_,i)=>[values[3*i+1]+(translate?.4:0),values[3*i+2]-(translate?.7:0),values[3*i]+(translate?.2:0)]).flat();
  const rotated={...d,positions:transform(d.positions,true),velocities:transform(d.velocities),config:{...d.config,gravity:transform(d.config.gravity)}};
  const a=new core.CompliantCableRuntime(d),b=new core.CompliantCableRuntime(rotated);
  for(let i=0;i<120;i++){const x=a.step({ticks:1}),y=b.step({ticks:1});transform(x.positions,true).forEach((v,j)=>close(v,y.positions[j],1e-8));x.tensions.forEach((v,j)=>close(v,y.tensions[j],1e-7));}
  a.destroy();b.destroy();
});

test('force balance is an independent stopping gate and finite caps remain visible',()=>{
  const d=spanDefinition(core,{segments:16});d.config={...d.config,substeps:1,maxIterations:1,residualTolerance:1e-2};
  d.positions[25]=-.8;const r=new core.CompliantCableRuntime(d),s=r.step({ticks:1});
  assert.ok(s.diagnostics.maxImplicitForceResidual>d.config.forceTolerance);assert.equal(s.diagnostics.unconvergedSubsteps,1);assert.equal(s.diagnostics.maxIterationsUsed,1);assert.equal(s.diagnostics.constraintProjections,16);r.destroy();
});

test('a small positional error on a hard cable still triggers the force-correction gate',()=>{
  const r=new core.CompliantCableRuntime({config:{...proximalConfig,substeps:1,residualTolerance:.01,gravity:[0,0,0],drag:0},positions:[0,0,0,1,0,0],velocities:[0,0,0,.001,0,0],masses:[1,1],pinned:[1,0],constraints:[{a:0,b:1,restLength:1,compliance:0}]});
  const s=r.step({ticks:1});close(s.positions[3],1,1e-14);assert.equal(s.diagnostics.maxIterationsUsed,1);assert.equal(s.diagnostics.unconvergedSubsteps,0);assert.ok(s.diagnostics.maxConstraintForceResidual<1e-6);r.destroy();
});

test('proximal solver handles slack, coincident and fully pinned elastic links',()=>{
  for(const positions of [[0,0,0,0,0,0],[0,0,0,.5,0,0]]){
    const r=new core.CompliantCableRuntime({config:{...proximalConfig,gravity:[0,0,0]},positions,masses:[1,1],constraints:[{a:0,b:1,restLength:1,compliance:0}]});const s=r.step({ticks:10});assert.deepEqual(Array.from(s.positions),positions);assert.equal(s.diagnostics.constraintProjections,0);r.destroy();
  }
  const r=new core.CompliantCableRuntime({config:proximalConfig,positions:[0,0,0,1.2,0,0],masses:[1,1],pinned:[1,1],constraints:[{a:0,b:1,restLength:1,compliance:.01}]});const s=r.step({ticks:1});close(s.tensions[0],20);assert.equal(s.diagnostics.unconvergedSubsteps,0);close(s.supportReactions[0],-20);r.destroy();
});

test('backend identity, tolerance and impulse checkpoint contracts reject incompatible or malformed payloads',()=>{
  const d=symmetricDefinition(),r=new core.CompliantCableRuntime(d),before=r.checkpoint();
  for(const config of [{...d.config,forceTolerance:undefined},{...d.config,solver:'fake'},{...d.config,forceTolerance:-1},{...d.config,solver:undefined}])assert.throws(()=>new core.CompliantCableRuntime({...d,config}));
  for(const mutate of [c=>c.backend=core.COMPLIANT_CABLE_BACKEND,c=>c.version=1,c=>delete c.definition.config.solver,c=>delete c.state.impulses,c=>c.state.impulses.support[3]=1,c=>c.state.impulses.applied=[0,NaN,0]]){const c=structuredClone(before);mutate(c);assert.throws(()=>core.CompliantCableRuntime.fromCheckpoint(c));}
  assert.deepEqual(r.checkpoint(),before);r.destroy();assert.equal(r.vectorMultipliers.byteLength,0);assert.equal(r.supportImpulse.byteLength,0);
});
