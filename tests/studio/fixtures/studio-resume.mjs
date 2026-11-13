import assert from 'node:assert/strict';
import {createStudioRuntime} from '../../../src/engine/studio-runtime.ts';
/** Export, write to a file (gzip-packed SI state) and read back, resume in a fresh runtime: the next ticks and the next
 * checkpoint are identical to the uninterrupted run's. A checkpoint missing one solver field is refused. */
export async function assertExactResume(runtime,options,ticks){
  const {packStudioCheckpoint,readStudioCheckpointFile}=await import('../../../src/studio/checkpoint-file.ts');
  const checkpoint=runtime.exportCheckpoint(),file=JSON.stringify({schema:'box3d.failure-studio.v2',checkpoint:await packStudioCheckpoint(checkpoint)});
  const candidate=await readStudioCheckpointFile(file);assert.equal(candidate.backend,checkpoint.backend);
  const resumed=createStudioRuntime({...options,initialCheckpoint:candidate.exportCheckpoint()});
  try{
    const a=runtime.step({ticks}),b=resumed.step({ticks});
    assert.deepEqual(b.liveSnapshot,a.liveSnapshot);assert.deepEqual(b.recordingSamples,a.recordingSamples);assert.deepEqual(b.eventDelta,a.eventDelta);a.release();b.release();
    assert.deepEqual(resumed.exportCheckpoint(),runtime.exportCheckpoint());
  }finally{resumed.destroy();}
  const {readCheckpoint,writeCheckpoint}=await import('../../../src/engine/checkpoint.ts');
  const raw=atob(checkpoint.si),bin=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bin[i]=raw.charCodeAt(i);
  const tree=readCheckpoint(bin,'box3d-studio-si'),inner=Object.values(tree.state).find(v=>v&&typeof v==='object'&&!ArrayBuffer.isView(v)&&!Array.isArray(v));
  delete inner[Object.keys(inner)[0]];
  const bytes=writeCheckpoint('box3d-studio-si',tree);let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const damaged={...checkpoint,si:btoa(text)};
  assert.throws(()=>createStudioRuntime({...options,initialCheckpoint:damaged}),error=>error.code==='CHECKPOINT_MISMATCH'||/checkpoint/i.test(error.message));
}
