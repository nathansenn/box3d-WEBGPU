'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const resultsDir = path.join(root, 'benchmarks/results');
const ranges = [[1,25],[26,50],[51,75],[76,100]];
const shards = ranges.map(([start,end]) => JSON.parse(fs.readFileSync(path.join(resultsDir, `v1.9-fifth-breakthrough-shard-${start}-${end}.json`), 'utf8')));
const records = shards.flatMap((shard) => shard.records);
if (records.length !== 100 || new Set(records.map((record) => record.id)).size !== 100) throw new Error(`expected 100 unique experiment records, got ${records.length}`);
records.sort((a,b)=>a.id-b.id);
const median=(values)=>{const sorted=[...values].sort((a,b)=>a-b),middle=sorted.length>>1;return sorted.length&1?sorted[middle]:(sorted[middle-1]+sorted[middle])*0.5;};
const geometricMean=(values)=>Math.exp(values.reduce((sum,value)=>sum+Math.log(value),0)/values.length);
const changed=records.filter((record)=>!record.category.endsWith('control'));
const summary={
  version:'1.9.0', baseline:'1.8.0', range:[1,100], experiments:100,
  samples:shards[0].samples, scale:shards[0].scale,
  execution:'four sequential isolated 25-experiment shards; alternating baseline/current order within every experiment',
  elapsedSeconds:shards.reduce((sum,shard)=>sum+(shard.elapsedSeconds||0),0),
  accepted:records.filter((record)=>record.decision==='accepted').length,
  borderline:records.filter((record)=>record.decision==='borderline').length,
  rejectedNoWin:records.filter((record)=>record.decision==='rejected-no-win').length,
  rejectedCorrectness:records.filter((record)=>record.decision==='rejected-correctness').length,
  controls:records.filter((record)=>record.decision==='control').length,
  changedGeometricMean:geometricMean(changed.map((record)=>record.speedup)),
  changedMedian:median(changed.map((record)=>record.speedup),),
  maxStateError:Math.max(...records.map((record)=>record.stateError)),
  maxMatrixError:Math.max(...records.map((record)=>record.matrixError)),
  maxColorError:Math.max(...records.map((record)=>record.colorError)),
  records,
};
fs.writeFileSync(path.join(resultsDir,'v1.9-fifth-breakthrough-100.json'),JSON.stringify(summary,null,2));
const csv=['id,category,sceneId,title,baselineMedianMs,optimizedMedianMs,speedup,stateError,matrixError,colorError,baselineDynamicBytes,optimizedDynamicBytes,dynamicByteReduction,decision'];
for(const record of records) csv.push([record.id,record.category,record.sceneId,JSON.stringify(record.title),record.baselineMedianMs,record.optimizedMedianMs,record.speedup,record.stateError,record.matrixError,record.colorError,record.baselineDynamicBytes,record.optimizedDynamicBytes,record.dynamicByteReduction,record.decision].join(','));
fs.writeFileSync(path.join(resultsDir,'v1.9-fifth-breakthrough-100.csv'),csv.join('\n')+'\n');
console.log(JSON.stringify({...summary,records:undefined},null,2));
if(summary.rejectedCorrectness>0)process.exitCode=1;
