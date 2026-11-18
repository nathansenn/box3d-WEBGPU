// Step times of the rigid core at scale, on one thread and on several: the piles of
// packages/box3d-kit/test/v22-rigid-scale.test.mjs, timed while they fall and settle.
//
//   npm --prefix packages/box3d-kit run build
//   node scripts/rigid-scale-benchmark.mjs [--threads=1,2,4] [--seconds=5] [--repeat=3] [--out=file.json]
//
// Each run is a child process (packages/box3d-kit/test/rigid-scale-child.mjs) so that every measurement starts from a
// fresh module and the pthread workers of one run cannot disturb the next. Runs of the thread counts are interleaved.
// It prints the median step and the worst step in milliseconds, the machine's load average at the start and the end,
// and whether every thread count ended in the same state (it must). It is not in a gate: wall-clock numbers depend on
// the machine and on what else runs on it, and the load average is printed so that a reader can judge them.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value]; }));
const threadList = String(args.threads ?? '1,2,4').split(',').map(Number), seconds = Number(args.seconds ?? 5), repeat = Number(args.repeat ?? 3);
const child = path.join(root, 'packages/box3d-kit/test/rigid-scale-child.mjs');
if (!fs.existsSync(path.join(root, 'packages/box3d-kit/dist/index.js'))) throw new Error('Build the kit first: npm --prefix packages/box3d-kit run build');
const SCENES = [{name: '5,000 mixed bodies', count: 5000, kind: 'mixed'}, {name: '1,000 convex hulls', count: 1000, kind: 'hull'}, {name: '1,500 mixed bodies', count: 1500, kind: 'mixed'}];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const one = spec => {
  const run = spawnSync(process.execPath, [child, JSON.stringify(spec)], {encoding: 'utf8', timeout: 600000, killSignal: 'SIGKILL'});
  const line = run.stdout.split('\n').find(text => text.startsWith('RESULT '));
  if (!line) throw new Error(`no result for ${JSON.stringify(spec)}: ${run.stderr.slice(-400)}`);
  return JSON.parse(line.slice(7));
};
const report = {date: new Date().toISOString(), node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0]?.model ?? 'unknown', loadStart: os.loadavg(), seconds, repeat, step: '1/60 s, 4 sub-steps', scenes: []};
for (const scene of SCENES) {
  const runs = Object.fromEntries(threadList.map(threads => [threads, []]));
  for (let r = 0; r < repeat; r++) for (const threads of threadList) runs[threads].push(one({count: scene.count, kind: scene.kind, seconds, threads, time: true}));
  const rows = threadList.map(threads => ({threads, medianStepMs: median(runs[threads].map(run => run.medianStepMs)), meanStepMs: median(runs[threads].map(run => run.meanStepMs)), worstStepMs: Math.max(...runs[threads].map(run => run.worstStepMs)),
    spread: [Math.min(...runs[threads].map(run => run.medianStepMs)), Math.max(...runs[threads].map(run => run.medianStepMs))], mostThreads: Math.max(...runs[threads].map(run => run.mostThreads)), hash: runs[threads][0].hash,
    sameEveryRun: runs[threads].every(run => run.hash === runs[threads][0].hash)}));
  const same = rows.every(row => row.hash === rows[0].hash && row.sameEveryRun);
  report.scenes.push({...scene, steps: Math.round(seconds * 60), sameStateOnEveryThreadCount: same, rows});
  console.log(`${scene.name}, ${Math.round(seconds * 60)} steps, ${repeat} runs each:`);
  for (const row of rows) console.log(`  ${row.threads} thread${row.threads > 1 ? 's' : ' '}: median step ${row.medianStepMs.toFixed(2)} ms (runs ${row.spread[0].toFixed(2)} to ${row.spread[1].toFixed(2)}), mean ${row.meanStepMs.toFixed(2)} ms, worst ${row.worstStepMs.toFixed(1)} ms, ${(rows[0].meanStepMs / row.meanStepMs).toFixed(2)}x the one-thread mean, used ${row.mostThreads}`);
  console.log(`  same final state on every thread count and run: ${same}`);
  if (!same) process.exitCode = 1;
}
report.loadEnd = os.loadavg();
console.log(`load average at the start ${report.loadStart.map(v => v.toFixed(1)).join(' ')}, at the end ${report.loadEnd.map(v => v.toFixed(1)).join(' ')}, on ${report.cpus} logical processors (${report.cpu})`);
if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), {recursive: true}); fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(report, null, 2)}\n`); console.log(`wrote ${args.out}`); }
