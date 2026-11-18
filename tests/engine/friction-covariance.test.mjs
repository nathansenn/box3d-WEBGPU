import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../src/engine/convex-contact.ts';
import {freeSlider,sliderReference} from '../fixtures/glass-contact/free-slider.mjs';

const cache=new Map();
const run=(angle,dt,iterations)=>{const key=[angle,dt,iterations].join('/');if(!cache.has(key))cache.set(key,freeSlider(api,{angle,dt,iterations}));return cache.get(key);};

test('a freely sliding box keeps its path under a common global yaw',()=>{
  for(const iterations of [4,64])for(const dt of [1/120,1/480]){
    const reference=run(0,dt,iterations);
    for(const angle of [Math.PI/8,Math.PI/4,Math.PI/2]){
      const actual=run(angle,dt,iterations);
      assert.ok(Math.hypot(...actual.position.map((v,i)=>v-reference.position[i]))<=1e-9,'friction depends on the world tangent basis');
      assert.ok(Math.hypot(...actual.velocity.map((v,i)=>v-reference.velocity[i]))<=1e-9);
      assert.equal(actual.unresolved,0);
    }
  }
});

test('free sliding converges to the Coulomb stopping distance and direction',()=>{
  for(const iterations of [4,64])for(const angle of [0,Math.PI/8]){
    const rows=[1/120,1/240,1/480].map(dt=>run(angle,dt,iterations));
    for(const r of rows){
      assert.ok(r.distanceError<=sliderReference.speed*r.dt,'stopping distance exceeds a first-order step');
      assert.ok(r.maxCrossTrack<=r.dt*r.dt,'unforced transverse drift does not vanish with the step');
      assert.ok(r.maxOverlap<=.0005);assert.equal(r.unresolved,0);
      // Finite iteration residuals persist at four iterations. The 64-iteration
      // reference must also recover stopping time at a strict 1e-8 m/s threshold.
      if(iterations===64){assert.notEqual(r.stoppedAt,null);assert.ok(Math.abs(r.stoppedAt-sliderReference.stopTime)<=2*r.dt);}
    }
    for(let i=1;i<rows.length;i++){const ratio=rows[i-1].distanceError/rows[i].distanceError;assert.ok(ratio>=1.8&&ratio<=2.2,`distance refinement ratio ${ratio}`);}
  }
});

test('free-slider friction balances momentum, stays in the Coulomb disk and dissipates energy',()=>{
  for(const dt of [1/120,1/240,1/480])for(const angle of [0,Math.PI/8]){
    const r=run(angle,dt,64);
    assert.ok(r.maxMomentumResidual<=1e-10,`momentum residual ${r.maxMomentumResidual}`);
    assert.ok(r.maxCoulombViolation<=1e-10,`Coulomb violation ${r.maxCoulombViolation}`);
    assert.ok(r.maxEnergyGain<=1e-10,`kinetic energy gain ${r.maxEnergyGain}`);
    assert.ok(r.maxSlidingDirectionError<=1e-8,`friction/slip direction error ${r.maxSlidingDirectionError}`);
  }
});
