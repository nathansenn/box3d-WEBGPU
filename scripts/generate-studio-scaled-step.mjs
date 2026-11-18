import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args=process.argv.slice(2),sourceIndex=args.indexOf('--source');
const path=resolve(sourceIndex<0?'src/studio/physics.ts':args[sourceIndex+1]);
const source=readFileSync(path,'utf8');
const start='  // BEGIN GENERATED SCALED STEP\n';
const end='  // END GENERATED SCALED STEP\n';
const a=source.indexOf(start),b=source.indexOf(end,a);
assert.ok(a>0&&b>a,'Missing generated scaled-step markers');
const stepStart=source.indexOf('  step(dt = FIXED_DT): void {');
const legacy=source.slice(stepStart,a).trimEnd();
assert.equal(legacy.split('Math.hypot(dx,dy,dz)').length,2,'Expected exactly one constraint norm');
assert.ok(!legacy.includes('scaledNorm3'),'Legacy step must retain its original arithmetic');
const specialized=legacy.replace('  step(dt = FIXED_DT): void {','  private stepScaledNorm3(dt = FIXED_DT): void {')
  .replace('Math.hypot(dx,dy,dz)','scaledNorm3(dx,dy,dz)');
const generated=start+specialized+'\n'+end;
const next=source.slice(0,a)+generated+source.slice(b+end.length);
if(args.includes('--check'))assert.equal(source,next,'Regenerate the specialized step after changing the legacy step');
else if(source!==next)writeFileSync(path,next);
console.log(JSON.stringify({source:path,generatedStepMatches:true,checkOnly:args.includes('--check')}));
