import assert from 'node:assert/strict';
import test from 'node:test';
import {FailureSimulation} from '../../src/studio/physics.ts';
import {parseStudioCheckpointFile,MAX_CHECKPOINT_FILE_BYTES} from '../../src/studio/checkpoint-file.ts';

test('direct checkpoints, evidence exports and sweep files all resume the exact trajectory',()=>{
  const source=new FailureSimulation('bridge');source.targetLoad=4;source.strength=.4;
  for(let i=0;i<480;i++)source.step();
  const checkpoint=source.exportCheckpoint();
  const candidates=[checkpoint,{schema:'box3d.failure-studio.v2',checkpoint},{id:'sweep-case',status:'completed',checkpoint}].map(value=>parseStudioCheckpointFile(JSON.stringify(value)));
  for(let i=0;i<120;i++){source.step();for(const candidate of candidates)candidate.step();}
  for(const candidate of candidates)assert.deepEqual(candidate.exportCheckpoint(),source.exportCheckpoint());
});
test('truncated, incompatible and presentation-only files are rejected before creating a replacement run',()=>{
  for(const text of ['{','null','[]','{}',JSON.stringify({schema:'box3d.failure-studio.v1',finalPositions:[1,2,3]})])assert.throws(()=>parseStudioCheckpointFile(text));
  const source=new FailureSimulation('plate').exportCheckpoint();source.links.at(-1).rest=0;
  assert.throws(()=>parseStudioCheckpointFile(JSON.stringify({checkpoint:source})),/checkpoint/i);
  assert.throws(()=>parseStudioCheckpointFile(' '.repeat(MAX_CHECKPOINT_FILE_BYTES+1)),/16 MiB/);
});
