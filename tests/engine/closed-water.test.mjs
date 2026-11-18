import assert from 'node:assert/strict';
import test from 'node:test';
import {createClosedWaterArrays,copyClosedWaterArrays,stepClosedWaterCpu,closedWaterCoefficients} from '../../src/engine/closed-water.ts';
import {standingWave,compareFields,integrals,waveErrorScales} from '../../scripts/closed-water-oracle.mjs';

const base={cols:32,rows:24,dt:1/120,gravity:9.81,meanDepth:1.5,drag:0,dx:12/32,dz:9/24};
const mode={m:2,n:1,amplitude:.03,offset:.02};
function initial(c,m=mode) {
  const analytic=standingWave(c,m,0);
  return createClosedWaterArrays(c,{eta:Float32Array.from(analytic.eta)});
}

test('closed basin preserves uniform rest, including walls, without a height clamp',()=>{
  for(const [cols,rows] of [[3,3],[5,17],[32,24]])for(const height of [.01,2,-.1]) {
    const c={...base,cols,rows,drag:.28},eta=new Float32Array(cols*rows).fill(height),s=createClosedWaterArrays(c,{eta});
    for(let i=0;i<1200;i++)stepClosedWaterCpu(s,c);
    assert.deepEqual(s.eta,eta);assert.ok(s.u.every(u=>u===0));assert.ok(s.v.every(v=>v===0));
  }
});

test('closed C-grid follows independent discrete standing waves, including centered drag',()=>{
  for(const drag of [0,.28,1.2])for(const [m,n] of [[1,0],[0,1],[2,1]]) {
    const c={...base,drag},wave={...mode,m,n},s=initial(c,wave);
    for(let tick=1;tick<=2400;tick++) {
      stepClosedWaterCpu(s,c);
      if(tick%240===0)assert.ok(compareFields(s,standingWave(c,wave,tick,true)).maxAbsolute<5e-6,`${drag}/${m}/${n}/${tick}`);
    }
  }
});

test('continuum wave error converges at second order when space and timestep refine together',()=>{
  for(const drag of [0,.28]) {
    const errors=[];
    for(const scale of [1,2,4,8]) {
      const c={...base,cols:16*scale,rows:12*scale,dx:12/(16*scale),dz:9/(12*scale),dt:1/(60*scale),drag};
      const s=initial(c),ticks=600*scale;
      for(let tick=0;tick<ticks;tick++)stepClosedWaterCpu(s,c);
      errors.push(compareFields(s,standingWave(c,mode,ticks),waveErrorScales(c,mode)).normalizedRms);
    }
    assert.ok(errors.at(-1)<.003,`Fine-grid continuum error ${errors}`);
    for(let i=1;i<errors.length;i++)assert.ok(errors[i-1]/errors[i]>3.5&&errors[i-1]/errors[i]<4.5,`Second-order ratios ${errors}`);
  }
});

test('unforced closed basin conserves mass and bounded modified energy over 24000 ticks',()=>{
  const c={...base,cols:17,rows:13,dx:.4,dz:.6},eta=new Float32Array(c.cols*c.rows);
  for(let i=0;i<eta.length;i++)eta[i]=.02+.005*Math.sin(i*1.723)+.004*Math.cos(i*.634);
  const s=createClosedWaterArrays(c,{eta}),start=integrals(s,c,.02);
  for(let tick=1;tick<=24000;tick++) {
    stepClosedWaterCpu(s,c);
    if(tick%1200===0) {
      const end=integrals(s,c,.02);
      assert.ok(Math.abs(end.volume-start.volume)/start.l1Volume<1e-4,'Mass conservation');
      assert.ok(Math.abs(end.modifiedEnergyPerDensity/start.modifiedEnergyPerDensity-1)<5e-4,'Modified energy');
      assert.equal(end.maxWall,0);
    }
  }
});

test('destination histories are scratch and initialization owns caller arrays',()=>{
  const analytic=standingWave(base,mode,0),eta=Float32Array.from(analytic.eta),before=eta.slice();
  const a=createClosedWaterArrays(base,{eta}),b=copyClosedWaterArrays(base,a);
  assert.deepEqual(eta,before);
  for(const key of ['nextEta','nextU','nextV'])b[key].fill(123);
  for(let tick=0;tick<5;tick++){stepClosedWaterCpu(a,base);stepClosedWaterCpu(b,base);}
  assert.deepEqual(a,b);eta.fill(0);assert.notDeepEqual(a.eta,eta);
});

test('closed water rejects invalid wall fluxes, ambiguous histories and coefficient underflow',()=>{
  const u=new Float32Array(base.cols*base.rows);u[base.cols-1]=1;
  assert.throws(()=>createClosedWaterArrays(base,{u}),/wall/);
  assert.throws(()=>createClosedWaterArrays(base,{nextEta:u}),/synchronized/);
  assert.throws(()=>closedWaterCoefficients({...base,gravity:1e-300}),/float32/);
  assert.throws(()=>closedWaterCoefficients({...base,dt:1/30,dx:1e-3}),/Courant/);
  const s=initial(base);s.v[(base.rows-1)*base.cols]=1;
  assert.throws(()=>copyClosedWaterArrays(base,s),/wall/);
});
