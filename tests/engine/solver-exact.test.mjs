import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FailureSimulation} from '../../src/studio/physics.ts';
import {PackedFailureSimulation} from '../../src/studio/packed-physics.ts';
import {PRESS_EXPERIMENTS} from '../../src/studio/press-settings.ts';

const temporary=mkdtempSync(join(tmpdir(),'box3d-solver-exact-'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
const archive=resolve('benchmarks/baselines/engine-100x-20260910-source.tar.gz');
for(const name of ['physics.ts','press-settings.ts'])writeFileSync(join(temporary,name),execFileSync('tar',['-xOf',archive,`src/studio/${name}`]));
const {FailureSimulation:Reference}=await import(pathToFileURL(join(temporary,'physics.ts')).href);

const cases=[{id:'canopy',study:'canopy',ticks:1560},{id:'bridge',study:'bridge',ticks:1560},...PRESS_EXPERIMENTS.map(experiment=>({id:experiment.id,study:'plate',press:experiment.settings,ticks:720}))];
for(const scenario of cases)test(`${scenario.id}: default and experimental packed solvers retain every full precision particle, link and event`,()=>{
  const actuals=[new FailureSimulation(scenario.study,scenario.press),new PackedFailureSimulation(scenario.study,scenario.press)];
  const reference=new Reference(scenario.study,scenario.press);
  for(const sim of [...actuals,reference]){sim.targetLoad=scenario.press?scenario.press.pressure/20:4;sim.wind=.35;}
  for(let tick=0;tick<scenario.ticks;tick++){
    if(tick===scenario.ticks-120){for(const actual of actuals)actual.targetLoad=0;reference.targetLoad=0;}
    for(const actual of actuals)actual.step();reference.step();
    if(tick%120===119){
      const b=reference.snapshot();
      for(const actual of actuals){
        const label=`${actual.constructor.name} tick ${tick+1}`;
        assert.deepEqual(actual.nodes,reference.nodes,`${label} particle state`);
        assert.deepEqual(actual.links,reference.links,`${label} constraint state`);
        assert.deepEqual(actual.events,reference.events,`${label} events`);
        const a=actual.snapshot();
        for(const key of ['positions','strains','broken','punchY','response','press'])assert.deepEqual(a[key],b[key],`${label} ${key}`);
      }
    }
  }
});
