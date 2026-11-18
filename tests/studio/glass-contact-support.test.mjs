import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {GlassModel}=await import('../../src/studio/material-labs/models.ts');
const {LABS}=await import('../../src/studio/material-labs/catalog.ts');

test('radial breakup retains nearby supports through every accepted correction interval',()=>{
  const preset=LABS.glass.experiments.find(p=>p.id==='radial-impact');
  const model=new GlassModel({...LABS.glass.defaults,...preset.settings});
  for(let tick=1;tick<=180;tick++){
    model.step();const stats=model.collisionWorld.stats;
    // This maximum includes accepted adaptive subintervals: checking only the
    // final outer-step geometry misses the former 0.639 mm overlap at tick 174.
    assert.ok(stats.maxPenetration<=.0005,`tick ${tick}: accepted overlap ${stats.maxPenetration}`);
    assert.equal(stats.ccdUnresolved,0);
  }
});
