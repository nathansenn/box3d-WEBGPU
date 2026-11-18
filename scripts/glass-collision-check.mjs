import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=path=>JSON.parse(readFileSync(path));
/** Recompute retained-result gates without changing or rerunning the experiment.
 * Geometry was independently sampled during the run; hashes alone do not replay it.
 */
export async function checkGlassCollision(directory){
  const root=resolve(directory),manifest=read(join(root,'manifest.json')),result=read(join(root,'result.json'));
  assert.equal(manifest.schema,'box3d.glass-contact-qualification/2');
  assert.equal(manifest.dt,1/120);assert.equal(manifest.duration,12);assert.equal(manifest.sampleEveryTicks,60);assert.equal(manifest.maximumAcceptedPenetration,.0005);
  assert.ok(Object.keys(manifest.hashes).length>=14);
  for(const [path,expected] of Object.entries(manifest.hashes)){
    assert.ok(!path.startsWith('/')&&!path.split('/').includes('..'),'unsafe source path');
    assert.equal(hash(readFileSync(join(root,'frozen',path))),expected,`source hash: ${path}`);
  }
  assert.equal(hash(JSON.stringify(manifest.hashes)),manifest.sourceHash);assert.equal(result.sourceHash,manifest.sourceHash);
  assert.equal(result.schema,manifest.schema);assert.equal(result.performanceQualified,false);
  const {LABS,normalizeSettings}=await import(pathToFileURL(join(root,'frozen/src/studio/material-labs/catalog.ts')));
  const expected=LABS.glass.experiments.map(p=>p.id);assert.equal(expected.length,8);
  assert.deepEqual([...manifest.evaluationOrder].sort(),[...expected].sort());
  assert.deepEqual(result.programs.map(p=>p.id),expected);
  const programs=[];
  for(const summary of result.programs){
    const program=read(join(root,summary.id+'.json')),{samples,...retainedSummary}=program;
    assert.deepEqual(retainedSummary,summary);assert.equal(samples.length,24);
    const preset=LABS.glass.experiments.find(p=>p.id===program.id);
    assert.deepEqual(program.settings,normalizeSettings('glass',{...LABS.glass.defaults,...preset.settings}));
    assert.equal(program.shards,program.settings.material==='tempered'?1058:364);
    assert.ok(Number.isFinite(program.maxAcceptedPenetration)&&program.maxAcceptedPenetration>=0);
    assert.ok(Number.isSafeInteger(program.unresolvedSweeps)&&program.unresolvedSweeps>=0);
    samples.forEach((s,i)=>{
      assert.equal(s.tick,(i+1)*60);assert.ok(Math.abs(s.time-s.tick/120)<1e-9);
      assert.match(s.stateHash,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(s.reference.maximum)&&s.reference.maximum>=0);
      assert.ok(Number.isFinite(s.sphereReference.maximum)&&s.sphereReference.maximum>=0);
      assert.equal(s.metrics.length,3);assert.ok(s.metrics.every(Number.isFinite));
    });
    assert.equal(program.maxReferencePenetration,Math.max(...samples.flatMap(s=>[s.reference.maximum,s.sphereReference.maximum])));
    const penetrationPassed=program.finite===true&&program.clampsStable===true&&program.ticks===1440&&Number.isFinite(program.maxAcceptedPenetration)&&Math.max(program.maxAcceptedPenetration,program.maxReferencePenetration)<=.0005;
    const sweepsPassed=program.unresolvedSweeps===0;
    assert.equal(program.penetrationAccuracyPassed,penetrationPassed);assert.equal(program.sweepQueriesFullyResolved,sweepsPassed);assert.equal(program.accuracyPassed,penetrationPassed&&sweepsPassed);
    programs.push({id:program.id,accuracyPassed:program.accuracyPassed,maxAcceptedPenetration:program.maxAcceptedPenetration,maxReferencePenetration:program.maxReferencePenetration,unresolvedSweeps:program.unresolvedSweeps,cpuMs:program.cpu.totalMs});
  }
  assert.equal(result.accuracyPassed,programs.every(p=>p.accuracyPassed));
  return {schema:'box3d.glass-contact-audit/1',sourceHash:manifest.sourceHash,integrityPassed:true,accuracyPassed:result.accuracyPassed,performanceQualified:false,checkedSources:Object.keys(manifest.hashes).length,checkedPrograms:programs.length,checkedSampleHashes:programs.length*24,geometryReplayed:false,programs};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/glass-collision-check.mjs RUN-DIRECTORY');
  const result=await checkGlassCollision(process.argv[2]);console.log(JSON.stringify(result,null,2));if(!result.accuracyPassed)process.exitCode=1;
}
