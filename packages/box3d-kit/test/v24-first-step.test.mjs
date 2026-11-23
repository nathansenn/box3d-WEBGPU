// Time to the first step in a fresh Node process: import the main entry, instantiate the WebAssembly, build a small
// jointed assembly, step once (test/first-step-child.mjs). An application pays this on every cold start, and it doubled
// unnoticed once: 18 unbundled modules made the import alone 15 to 20 ms.
//
// Measured 2026-11-23 on the 4-vCPU build container (Node 22.23), 25 fresh processes each, other jobs running (load 3 to 4):
//
//                       import   instantiate   build   first step   total     (median ms; total min .. max)
//   0.9.0 as published    21.4      10.1        12.9      7.5        53.1      43.4 .. 83.8
//   this build            10.0       9.0        11.4      7.8        39.8      31.4 .. 59.0
//
// and the import alone over 41 processes at load 3: 18.2 ms (13.7 .. 31.0) before, 8.2 ms (7.5 .. 16.6) now.
// The budgets below are on the median of 21 processes and sit about 1.6 times above the medians measured under load, so
// a busy CI machine passes; a second batch is measured before a failure counts. What they cannot catch on a fast machine
// the two exact checks do: the number of files and bytes the main entry loads, which is what the import time follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const dist = join(pkg, 'dist');
const BUDGET = {
  /** Median ms of the import of dist/index.js. Measured 8.2 to 10.0 (11.4 at load 4); 0.9.0 took 18.2 to 21.4. */
  importMs: 16,
  /** Median ms from the import to the end of the first step. Measured 36 to 43. */
  totalMs: 64,
  /** Modules the main entry loads: index.js, rigid.js and the three shared ones (scripts/bundle-rigid.mjs). It was 18. */
  files: 5,
  /** Bytes of those modules. Measured 210,693; it was 302,742. */
  bytes: 230_000,
};
const PROCESSES = 21;
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[(sorted.length - 1) / 2]; };

function measure() {
  const runs = [];
  for (let i = 0; i < PROCESSES; i++) {
    const child = spawnSync(process.execPath, [join(pkg, 'test/first-step-child.mjs')], {encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
    assert.equal(child.status, 0, child.stderr);
    runs.push(JSON.parse(child.stdout.trim().split('\n').pop()));
  }
  const part = name => median(runs.map(run => run.parts[name]));
  return {importMs: part('importMs'), instantiateMs: part('instantiateMs'), buildMs: part('buildMs'), firstStepMs: part('firstStepMs'),
    totalMs: median(runs.map(run => run.totalMs)), minMs: Math.min(...runs.map(run => run.totalMs)), maxMs: Math.max(...runs.map(run => run.totalMs))};
}

test('the main entry loads at most five modules and 230,000 bytes', () => {
  const seen = new Set(), queue = ['index.js'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(join(dist, file), 'utf8').matchAll(/(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(relative(dist, resolve(dist, dirname(file), specifier)).replace(/\\/g, '/'));
    }
  }
  const files = [...seen].sort(), bytes = files.reduce((sum, file) => sum + readFileSync(join(dist, file)).length, 0);
  assert.deepEqual(files, ['core/checkpoint.js', 'core/contracts.js', 'index.js', 'rigid.js', 'shared-frames.js']);
  assert.ok(files.length <= BUDGET.files);
  assert.ok(bytes <= BUDGET.bytes, `the main entry loads ${bytes} bytes; the budget is ${BUDGET.bytes}`);
});

test('time to the first step in a fresh process stays within its budget', () => {
  const over = m => [m.importMs > BUDGET.importMs && `import ${m.importMs.toFixed(1)} ms > ${BUDGET.importMs}`, m.totalMs > BUDGET.totalMs && `total ${m.totalMs.toFixed(1)} ms > ${BUDGET.totalMs}`].filter(Boolean);
  let measured = measure();
  // Timing on a shared machine: one batch over budget is measured again before it counts.
  if (over(measured).length) measured = measure();
  console.log(`first step, median of ${PROCESSES} fresh processes: import ${measured.importMs.toFixed(1)} ms, instantiate ${measured.instantiateMs.toFixed(1)}, build ${measured.buildMs.toFixed(1)}, first step ${measured.firstStepMs.toFixed(1)}, total ${measured.totalMs.toFixed(1)} (${measured.minMs.toFixed(1)} to ${measured.maxMs.toFixed(1)})`);
  assert.deepEqual(over(measured), []);
});
