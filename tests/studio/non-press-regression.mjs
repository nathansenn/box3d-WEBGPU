import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FailureSimulation} from '../../src/studio/physics.ts';

const FIXTURE=new URL('./fixtures/non-press-baseline.json',import.meta.url);
// Compare trajectories within a tolerance instead of exact hashes. The same code
// differs in the last float bits between platforms and Node versions (observed:
// 6e-13 relative on canopy strain, author's Mac vs Linux/Node 22); a real
// behaviour change moves nodes by orders of magnitude more. Topology is exact.
export const POSITION_TOLERANCE=1e-6;
export const RESPONSE_RELATIVE_TOLERANCE=1e-9;
const CASES=[['canopy',.8],['canopy',4],['bridge',.8],['bridge',4]];
const STEPS=960;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function simulate(id,load,steps){const s=new FailureSimulation(id);s.targetLoad=load;for(let i=0;i<steps;i++)s.step();return s.snapshot();}

/** Frozen non-press trajectories: protect canopy and bridge behaviour while press work changes. */
export function verifyNonPress(){
  const baseline=JSON.parse(readFileSync(FIXTURE,'utf8'));
  for(const c of baseline.cases){
    const f=simulate(c.id,c.load,c.steps),label=`${c.id} at load ${c.load}`;
    assert.equal(f.positions.length,c.positions.length,label+' node count');
    let worst=0;
    for(let i=0;i<c.positions.length;i++)worst=Math.max(worst,Math.abs(f.positions[i]-c.positions[i]));
    assert.ok(worst<=POSITION_TOLERANCE,`${label} trajectory: max position difference ${worst}`);
    assert.equal(sha(f.broken),c.broken,label+' topology');
    assert.deepEqual(Object.keys(f.response).sort(),Object.keys(c.response).sort(),label+' response fields');
    for(const [key,expected] of Object.entries(c.response)){
      const actual=f.response[key];
      if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<=RESPONSE_RELATIVE_TOLERANCE*Math.max(1,Math.abs(expected)),`${label} ${key}: ${actual} vs ${expected}`);
      else assert.equal(actual,expected,`${label} ${key}`);
    }
  }
}

/** Re-record only after an intended behaviour change:
 *  node tests/studio/non-press-regression.mjs --record "<reason>" */
export function recordNonPress(reason){
  const cases=CASES.map(([id,load])=>{const f=simulate(id,load,STEPS);return {id,load,steps:STEPS,positions:Array.from(f.positions),broken:sha(f.broken),response:f.response};});
  const meta={schema:'box3d.studio-non-press-baseline/2',recorded:{node:process.version,platform:`${process.platform}-${process.arch}`,reason},
    positionTolerance:POSITION_TOLERANCE,responseRelativeTolerance:RESPONSE_RELATIVE_TOLERANCE};
  const head=JSON.stringify(meta,null,2).replace(/\n}$/,',\n  "cases": [\n');
  writeFileSync(FIXTURE,head+cases.map(c=>'    '+JSON.stringify(c)).join(',\n')+'\n  ]\n}\n');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv.includes('--record')){
  const reason=process.argv[process.argv.indexOf('--record')+1];
  if(!reason)throw new Error('Give a reason for re-recording the frozen trajectories.');
  recordNonPress(reason);
  console.log('Recorded',fileURLToPath(FIXTURE));
}
