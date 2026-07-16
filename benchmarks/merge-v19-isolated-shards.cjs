'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const resultsDir = path.join(root, 'benchmarks/results');
const shardPaths = [
  path.join(resultsDir, 'v1.8-v1.9-isolated-shard-1-5.json'),
  path.join(resultsDir, 'v1.8-v1.9-isolated-shard-6-10.json'),
];
const shards = shardPaths.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const results = shards.flatMap((shard) => shard.results);
if (results.length !== 10 || new Set(results.map((record) => record.id)).size !== 10) {
  throw new Error(`expected 10 unique fresh-process workloads, got ${results.length}`);
}
const median = (values) => { const sorted = [...values].sort((a,b)=>a-b); const middle=sorted.length>>1; return sorted.length&1?sorted[middle]:(sorted[middle-1]+sorted[middle])*0.5; };
const geometricMean = (values) => Math.exp(values.reduce((sum,value)=>sum+Math.log(value),0)/values.length);
const changed = results.filter((entry) => entry.category !== 'control');
const dynamic = results.filter((entry) => entry.category === 'dynamic-breakthrough' || entry.category === 'mixed');
const output = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  environment: shards[0].environment,
  method: {
    ...shards[0].method,
    execution: 'two sequential isolated five-workload shards to avoid process-spawn quota effects; seven fresh processes per variant/workload',
  },
  summary: {
    changedGeometricMeanSpeedup: geometricMean(changed.map((entry) => entry.speedup)),
    dynamicGeometricMeanSpeedup: geometricMean(dynamic.map((entry) => entry.speedup)),
    medianSpeedup: median(results.map((entry) => entry.speedup)),
    correctnessFailures: results.filter((entry) => !entry.correctness).length,
    elapsedMs: shards.reduce((sum, shard) => sum + shard.summary.elapsedMs, 0),
  },
  results,
};
fs.writeFileSync(path.join(resultsDir, 'v1.8-v1.9-isolated.json'), JSON.stringify(output, null, 2));
const markdown = [
  '# v1.8 → v1.9 Isolated Fresh-Process Benchmark', '',
  `- Changed-path geometric mean: **${output.summary.changedGeometricMeanSpeedup.toFixed(3)}×**`,
  `- Dynamic/mixed geometric mean: **${output.summary.dynamicGeometricMeanSpeedup.toFixed(3)}×**`,
  `- Correctness failures: **${output.summary.correctnessFailures}**`,
  `- Method: two sequential shards, seven fresh processes per variant/workload, alternating order, 10,000 paired-bootstrap resamples.`, '',
  '| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |',
  '|---|---:|---:|---:|---:|---:|',
  ...results.map((entry) => `| ${entry.label} | ${entry.baselineMedianMs.toFixed(6)} | ${entry.optimizedMedianMs.toFixed(6)} | **${entry.speedup.toFixed(3)}×** | ${entry.pairedBootstrap95[0].toFixed(3)}–${entry.pairedBootstrap95[1].toFixed(3)}× | ${entry.payload.baselineDynamicBytes} → ${entry.payload.optimizedDynamicBytes} |`),
  '',
];
fs.writeFileSync(path.join(resultsDir, 'V1.8_V1.9_ISOLATED.md'), markdown.join('\n'));
console.log(JSON.stringify(output.summary, null, 2));
if (output.summary.correctnessFailures > 0) process.exitCode = 1;
