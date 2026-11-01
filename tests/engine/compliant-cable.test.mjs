import test from 'node:test';
import assert from 'node:assert/strict';
import {CompliantCableRuntime,hangingCableDefinition,COMPLIANT_CABLE_BACKEND} from '../../src/engine/compliant-cable.ts';

const base={dt:1/120,substeps:1,maxIterations:16,residualTolerance:1e-12,drag:0,gravity:[0,-9.81,0]};
const spring=(overrides={})=>({config:{...base,...overrides},positions:[0,0,0,0,-1.4,0],masses:[1,2],pinned:[1,0],constraints:[{a:0,b:1,restLength:1,compliance:1/60}]});
function advance(r,ticks){let s;while(ticks){const n=Math.min(ticks,120);s=r.step({ticks:n});ticks-=n;}return s;}
function close(a,b,tolerance=1e-10){assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b} within ${tolerance}`);}

test('free particles reproduce the implicit-drag recurrence without projection work',()=>{
  const r=new CompliantCableRuntime({config:{...base,drag:2,substeps:4},positions:[1,2,3],velocities:[.4,-.2,.1],masses:[2],forces:[.2,1,-.4],constraints:[]});
  const p=[1,2,3],v=[.4,-.2,.1],a=[.1,-9.31,-.2],h=base.dt/4;
  for(let n=0;n<4000;n++)for(let k=0;k<3;k++){v[k]=(v[k]+h*a[k])/(1+2*h);p[k]+=h*v[k];}
  const s=advance(r,1000);for(let k=0;k<3;k++){close(s.positions[k],p[k],2e-9);close(s.velocities[k],v[k],2e-9);}
  assert.equal(s.diagnostics.constraintProjections,0);r.destroy();
});

test('taut one-link motion matches an independent implicit spring solve across timestep, drag and iteration settings',()=>{
  for(const dt of [1/30,1/120,1/480])for(const drag of [0,2])for(const iterations of [1,4,16]) {
    const r=new CompliantCableRuntime(spring({dt,drag,maxIterations:iterations}));
    const equilibrium=2*9.81/60;let extension=.4,velocity=0;
    for(let n=0;n<Math.round(2/dt);n++) {
      // Solve m(v'-v)/h = mg - k e' - m r v', e'=e+h v'.
      velocity=(velocity+dt*(9.81-30*extension))/(1+drag*dt+30*dt*dt);extension+=dt*velocity;
    }
    const s=advance(r,Math.round(2/dt));close(-s.positions[4]-1,extension,2e-11);close(-s.velocities[4],velocity,2e-11);
    close(s.tensions[0],60*extension,2e-8);assert.equal(s.diagnostics.unconvergedSubsteps,0);
    assert.ok(s.diagnostics.maxImplicitForceResidual<2e-8);assert.ok(extension>0&&equilibrium>0);r.destroy();
  }
});

test('continuum oscillator error converges with the actual substep, not solver iteration count',()=>{
  const omega=Math.sqrt(30),amplitude=.4-2*9.81/60,errors=[];
  for(const dt of [1/120,1/240,1/480,1/960]) {
    const r=new CompliantCableRuntime(spring({dt})),s=advance(r,Math.round(1/dt));
    const q=-s.positions[4]-1-2*9.81/60,v=-s.velocities[4];
    errors.push(Math.hypot(q/amplitude-Math.cos(omega),v/(amplitude*omega)+Math.sin(omega)));r.destroy();
  }
  for(let i=1;i<errors.length;i++)assert.ok(errors[i-1]/errors[i]>1.8&&errors[i-1]/errors[i]<2.2,JSON.stringify(errors));
});

test('distributed hanging mass preserves mesh-independent extension, total mass and support reaction',()=>{
  for(const segments of [1,4,16,32]) {
    const config={...base,dt:1/60,substeps:8,maxIterations:256,residualTolerance:1e-9,drag:4};
    const r=new CompliantCableRuntime(hangingCableDefinition({segments,length:2,linearDensity:.25,tipMass:1,axialRigidity:1000,config}));
    const s=advance(r,1200),expected=9.81/1000*(1*2+.25*2*2/2);
    close(s.diagnostics.mass,1.5);close(-s.positions.at(-2)-2,expected,2e-7);close(s.supportReactions[1],1.5*9.81,2e-5);
    close(s.tensions[0],(1+.5-.25*2/(2*segments))*9.81,2e-5);assert.equal(s.diagnostics.unconvergedSubsteps,0);
    assert.ok(s.diagnostics.maxResidual<=config.residualTolerance);r.destroy();
  }
});

test('slack and coincident cable segments carry no compression, including after unloading',()=>{
  const input=spring({gravity:[0,0,0]});input.positions=[0,0,0,0,-.5,0];
  const slack=new CompliantCableRuntime(input);const initial=slack.inspect();const s=slack.step({ticks:60});
  assert.deepEqual(s.positions,initial.positions);assert.equal(s.tensions[0],0);assert.equal(s.diagnostics.elasticEnergy,0);assert.equal(s.diagnostics.constraintProjections,0);slack.destroy();
  input.positions.fill(0);const coincident=new CompliantCableRuntime(input);assert.ok(coincident.step({ticks:60}).positions.every(v=>v===0));coincident.destroy();
  const moving=new CompliantCableRuntime({...input,positions:[0,0,0,0,-1.2,0],velocities:[0,0,0,0,3,0]});
  let reachedSlack=false;for(let n=0;n<120;n++){const f=moving.step({ticks:1});if(Math.abs(f.positions[4])<1){reachedSlack=true;assert.equal(f.tensions[0],0);}}
  assert.ok(reachedSlack);moving.destroy();
});

test('internal cable impulses conserve linear momentum and cannot create elastic plus kinetic energy in an axial relaxation',()=>{
  const r=new CompliantCableRuntime({config:{...base,gravity:[0,0,0]},positions:[-1,0,0,1,0,0],masses:[2,3],velocities:[.1,.2,.3,.1,.2,.3],constraints:[{a:0,b:1,restLength:1,compliance:.01}]});
  let previous=r.inspect();for(let n=0;n<1200;n++) {
    const s=r.step({ticks:1});for(let k=0;k<3;k++)close(s.diagnostics.momentum[k],[.5,1,1.5][k],2e-10);
    assert.ok(s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy<=previous.diagnostics.kineticEnergy+previous.diagnostics.elasticEnergy+1e-9);previous=s;
  }r.destroy();
});

test('finite solve budgets expose under-convergence and early exit counts actual projection work',()=>{
  const d=hangingCableDefinition({segments:32,length:2,linearDensity:.25,tipMass:1,axialRigidity:1000,config:{...base,dt:1/30,maxIterations:1,residualTolerance:1e-12}});
  const r=new CompliantCableRuntime(d),s=r.step({ticks:1});assert.equal(s.diagnostics.unconvergedSubsteps,1);assert.ok(s.diagnostics.maxResidual>1e-12);assert.equal(s.diagnostics.constraintProjections,32);r.destroy();
  const simple=new CompliantCableRuntime(spring({maxIterations:256})),one=simple.step({ticks:1});assert.equal(one.diagnostics.maxIterationsUsed,1);assert.equal(one.diagnostics.constraintProjections,1);simple.destroy();
});

test('damped axial motion closes the implicit-Euler energy and work budget',()=>{
  const d=spring({drag:2});d.forces=[0,0,0,0,-1,0];const r=new CompliantCableRuntime(d);
  const energy=s=>s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy+s.diagnostics.gravitationalEnergy;
  let previous=r.inspect();
  for(let n=0;n<240;n++) {
    const s=r.step({ticks:1}),dv=s.velocities[4]-previous.velocities[4],de=s.positions[4]-previous.positions[4];
    const defect=energy(s)-energy(previous)-(s.diagnostics.externalWork-previous.diagnostics.externalWork)+(s.diagnostics.dragDissipation-previous.diagnostics.dragDissipation);
    close(defect,-.5*2*dv*dv-.5*60*de*de,2e-11);previous=s;
  }r.destroy();
});

test('complete JSON checkpoints retain force commands, multipliers, work and exact continuation',()=>{
  const r=new CompliantCableRuntime(spring({substeps:4,drag:2}));r.step({ticks:20,commands:[{tick:1,type:'force',node:1,value:[.5,-1,0]},{tick:10,type:'impulse',node:1,value:[.1,0,0]}]});
  const checkpoint=JSON.parse(JSON.stringify(r.checkpoint())),restored=CompliantCableRuntime.fromCheckpoint(checkpoint);
  assert.deepEqual(restored.inspect(),r.inspect());assert.deepEqual(restored.step({ticks:120}),r.step({ticks:120}));assert.equal(restored.inspect().backend,COMPLIANT_CABLE_BACKEND);
  checkpoint.state.positions.fill(999);assert.notDeepEqual(restored.inspect().positions,Float64Array.from(checkpoint.state.positions));
  const snapshot=r.inspect();snapshot.positions.fill(999);assert.notDeepEqual(r.inspect().positions,snapshot.positions);r.destroy();restored.destroy();
});

test('signed zero inputs remain canonical through complete JSON replay',()=>{
  const d=hangingCableDefinition({segments:1,length:2,linearDensity:.25,tipMass:1,axialRigidity:1000,config:{...base,drag:-0,gravity:[-0,-9.81,-0]}});
  d.constraints[0].a=-0;
  const r=new CompliantCableRuntime(d);r.step({ticks:120});const checkpoint=JSON.parse(JSON.stringify(r.checkpoint()));
  const restored=CompliantCableRuntime.fromCheckpoint(checkpoint);assert.deepEqual(r.checkpoint(),checkpoint);assert.deepEqual(r.inspect(),restored.inspect());assert.deepEqual(r.step({ticks:120}),restored.step({ticks:120}));r.destroy();restored.destroy();
});

test('invalid batches and checkpoints do not mutate a live model, and disposal releases retained buffers',()=>{
  const r=new CompliantCableRuntime(spring());const before=r.checkpoint();
  for(const commands of [[{tick:1,type:'force',node:1,value:[0,1,0]},{tick:2,type:'force',node:1,value:[NaN,0,0]}],[{tick:1,type:'impulse',node:0,value:[1,0,0]}],[{tick:3,type:'force',node:1,value:[1,0,0]}]])assert.throws(()=>r.step({ticks:2,commands}));
  assert.deepEqual(r.checkpoint(),before);
  for(const mutate of [c=>c.backend='studio-pbd-js-v1',c=>c.state.positions[0]=1,c=>c.state.velocities[0]=1,c=>c.state.multipliers[0]=1,c=>c.state.tick=-1,c=>c.definition.constraints[0].compliance=1e-300,c=>c.state.forces.pop(),c=>c.state.maxIterationsUsed=1000]) {
    const c=structuredClone(before);mutate(c);assert.throws(()=>CompliantCableRuntime.fromCheckpoint(c));
  }
  r.destroy();r.destroy();assert.equal(r.p.byteLength,0);assert.equal(r.initial.byteLength,0);assert.equal(r.edges.length,0);assert.throws(()=>r.inspect(),/destroyed/);assert.throws(()=>r.step({ticks:1}),/destroyed/);
});
