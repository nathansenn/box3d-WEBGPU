import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const geometricMean = (values) => Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);

const tournament = read('benchmarks/results/v1.9-fifth-breakthrough-100.json');
assert.equal(tournament.experiments, 100, 'v1.9 tournament must contain exactly 100 experiments');
assert.equal(tournament.records.length, 100, 'v1.9 tournament record array must contain exactly 100 entries');
assert.deepEqual(tournament.records.map((entry) => entry.id), Array.from({ length: 100 }, (_, index) => index + 1), 'experiment IDs must cover 1–100 exactly once');
assert.equal(tournament.rejectedCorrectness, 0, 'no v1.9 production path may fail correctness');
assert.ok(tournament.accepted >= 60, `expected at least 60 accepted wins, received ${tournament.accepted}`);
assert.equal(tournament.accepted + tournament.borderline + tournament.rejectedNoWin + tournament.rejectedCorrectness + tournament.controls, 100, 'all 100 outcomes must be classified exactly once');
assert.ok(tournament.records.every((entry) => entry.correctness), 'every tournament record must pass correctness');
assert.ok(tournament.maxStateError <= 0.002, `maximum state error ${tournament.maxStateError} exceeded 0.2%`);
assert.ok(tournament.maxMatrixError <= 2e-6, `maximum reconstructed rope matrix error ${tournament.maxMatrixError} exceeded bound`);
assert.ok(tournament.maxColorError <= 2e-5, `maximum reconstructed rope color error ${tournament.maxColorError} exceeded bound`);
assert.ok(tournament.changedGeometricMean >= 1.40, 'changed-path geometric mean must retain a material aggregate win');

const byCategory = Object.groupBy(tournament.records, (entry) => entry.category);
const expectedCounts = {
  'cloth-full': 30,
  'cloth-adaptive-long': 10,
  'cloth-adaptive-storm': 5,
  'rope-frame': 20,
  'rope-full': 20,
  'rope-storm': 5,
  'tearing-control': 5,
  'water-control': 5,
};
for (const [category, count] of Object.entries(expectedCounts)) {
  assert.equal(byCategory[category]?.length, count, `${category} must contain ${count} experiments`);
}
const categoryGm = (category) => geometricMean(byCategory[category].map((entry) => entry.speedup));
assert.ok(categoryGm('cloth-full') >= 1.05, 'general cloth workloads must retain at least 1.05× aggregate speedup');
assert.ok(categoryGm('cloth-adaptive-long') >= 1.25, 'adaptive long-horizon cloth workloads must retain at least 1.25× aggregate speedup');
assert.ok(categoryGm('cloth-adaptive-storm') >= 1.15, 'adaptive projectile-storm cloth workloads must retain at least 1.15× aggregate speedup');
assert.ok(categoryGm('rope-frame') >= 3.0, 'compact GPU-rope handoff must retain at least 3× CPU preparation speedup');
for (const entry of byCategory['rope-frame']) {
  assert.ok(entry.dynamicByteReduction >= 0.80, `${entry.id} must retain at least 80% steady rope dynamic-byte reduction`);
  assert.ok(entry.matrixError <= 2e-6 && entry.colorError <= 2e-5, `${entry.id} reconstructed rope stream drifted`);
}

const isolated = read('benchmarks/results/v1.8-v1.9-isolated.json');
assert.equal(isolated.results.length, 10, 'fresh-process comparison must contain ten release workloads');
assert.equal(isolated.summary.correctnessFailures, 0, 'fresh-process comparison must have zero correctness failures');
assert.ok(isolated.results.every((entry) => entry.correctness), 'every fresh-process workload must pass correctness');
assert.ok(isolated.results.every((entry) => entry.baselineDeterministic && entry.optimizedDeterministic), 'every fresh-process workload must be deterministic within each version');
assert.ok(isolated.summary.changedGeometricMeanSpeedup >= 1.50, 'changed-path fresh-process geometric mean must clear 1.50×');
assert.ok(isolated.summary.dynamicGeometricMeanSpeedup >= 1.20, 'dynamic/mixed fresh-process geometric mean must clear 1.20×');
const byId = Object.fromEntries(isolated.results.map((entry) => [entry.id, entry]));
assert.ok(byId['cloth-cargo-full'].speedup >= 1.15, 'adaptive cargo-net workload must clear 1.15×');
assert.ok(byId['cloth-membrane-full'].speedup >= 1.50, 'maximum adaptive membrane workload must clear 1.50×');
assert.ok(byId['cloth-membrane-storm'].speedup >= 1.30, 'maximum cloth projectile storm must clear 1.30×');
assert.ok(byId['rope-maximum-frame'].speedup >= 5.0, 'maximum rope CPU handoff must clear 5×');
assert.ok(byId['rope-maximum-frame'].payload.byteReduction >= 0.85, 'maximum rope dynamic traffic must fall by at least 85%');
assert.ok(byId['mixed-maximum'].speedup >= 1.20, 'mixed maximum cloth/rope/water workload must clear 1.20×');
assert.equal(byId['cloth-tearing-control'].crossVersionHashMatch, true, 'tearing topology control must preserve the cross-version replay hash');
assert.equal(byId['water-maximum-control'].crossVersionHashMatch, true, 'water control must preserve the cross-version replay hash');

console.log(`✅ v1.9 evidence gate passed: 100 experiments, ${tournament.accepted} accepted wins, ${categoryGm('cloth-adaptive-long').toFixed(2)}× adaptive-cloth GM, ${categoryGm('rope-frame').toFixed(2)}× rope-handoff GM, ${isolated.summary.dynamicGeometricMeanSpeedup.toFixed(2)}× isolated dynamic/mixed GM, zero correctness failures`);
