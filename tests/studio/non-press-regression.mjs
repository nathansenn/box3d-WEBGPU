import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FailureSimulation} from '../../src/studio/physics.ts';
/** Frozen before the press enhancement: protect actual trajectories instead of a whole-file hash. */
export function verifyNonPress(){
  const cases=JSON.parse(readFileSync(new URL('./fixtures/non-press-baseline.json',import.meta.url)));
  for(const c of cases){const s=new FailureSimulation(c.id);s.targetLoad=c.load;for(let i=0;i<c.steps;i++)s.step();const f=s.snapshot();
    assert.equal(createHash('sha256').update(f.positions).digest('hex'),c.positions,c.id+' trajectory');
    assert.equal(createHash('sha256').update(f.broken).digest('hex'),c.broken,c.id+' topology');assert.deepEqual(f.response,c.response);
  }
}
