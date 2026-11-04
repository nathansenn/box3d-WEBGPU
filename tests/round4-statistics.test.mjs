import test from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile, balancedOrders, summarizePairs, qualifyCases } from '../benchmarks/round4/statistics.mjs';

const pairs = (baselineMs = 10, candidateMs = 8, n = 24) =>
  Array.from({ length: n }, () => ({ baselineMs, candidateMs }));
const family = (makePairs = () => pairs()) => Array.from({ length: 100 }, (_, i) => ({
  id: `R4-${i + 1}`, sets: [{ pairs: makePairs(i, 0) }, { pairs: makePairs(i, 1) }],
}));
const approximately = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('standard medians and nearest-rank tails preserve unsorted inputs', () => {
  const values = Object.freeze([8, 1, 6, 3]);
  assert.equal(median(values), 4.5);
  assert.equal(median([9, 2, 4]), 4);
  assert.equal(median([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE);
  assert.equal(median([-Number.MAX_VALUE, Number.MAX_VALUE]), 0);
  const twentyFour = Array.from({ length: 24 }, (_, i) => i + 1);
  assert.equal(percentile(twentyFour, 0.95), 23);
  assert.equal(percentile(values, 0), 1);
  assert.equal(percentile(values, 1), 8);
  assert.deepEqual(values, [8, 1, 6, 3]);
});

test('empty or nonfinite statistics and out-of-range percentiles are rejected', () => {
  for (const values of [null, [], new Array(2), [NaN], [Infinity], ['1']]) {
    assert.throws(() => median(values));
    assert.throws(() => percentile(values, 0.95));
  }
  for (const p of [-0.1, 1.1, NaN, Infinity, '0.95']) assert.throws(() => percentile([1, 2], p));
});

test('seeded AB/BA orders are balanced, reproducible and shuffled rather than alternating', () => {
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const orders = balancedOrders(24, seed);
    assert.deepEqual(orders, balancedOrders(24, seed));
    assert.equal(orders.filter(Boolean).length, 12);
    assert.equal(orders.filter(value => !value).length, 12);
    assert.ok(orders.every(value => typeof value === 'boolean'));
    assert.ok(orders.some((value, i) => i > 0 && value === orders[i - 1]));
  }
  assert.notDeepEqual(balancedOrders(24, 0), balancedOrders(24, 1));
  for (const n of [0, 1, 23, -2, 2.5, NaN, Infinity]) assert.throws(() => balancedOrders(n, 1));
  for (const seed of [NaN, Infinity, 1.5, '1']) assert.throws(() => balancedOrders(24, seed));
});

test('paired summary reports exact sign tails and retains the raw reference', () => {
  const input = Object.freeze(pairs().map(pair => Object.freeze(pair)));
  const result = summarizePairs(input);
  assert.equal(result.pairs, input);
  assert.equal(result.pairCount, 24);
  assert.equal(result.nonTiedPairs, 24);
  assert.equal(result.medianSpeedup, 1.25);
  assert.equal(result.baselineMedianMs, 10);
  assert.equal(result.candidateMedianMs, 8);
  assert.equal(result.baselineP95Ms, 10);
  assert.equal(result.candidateP95Ms, 8);
  assert.equal(result.p95Ratio, 0.8);
  assert.equal(result.gainP, 1 / 2 ** 24);
  assert.equal(result.regressionP, 1);
});

test('exact ties do not artificially increase sign-test evidence', () => {
  const result = summarizePairs([...pairs(10, 10, 20), ...pairs(10, 8, 4)]);
  assert.equal(result.pairCount, 24);
  assert.equal(result.nonTiedPairs, 4);
  assert.equal(result.tiedPairs, 20);
  assert.equal(result.gainP, 1 / 16);
  assert.equal(result.regressionP, 1);
  assert.equal(result.medianSpeedup, 1);
  const ties = summarizePairs(pairs(10, 10));
  assert.equal(ties.gainP, 1);
  assert.equal(ties.regressionP, 1);
});

test('sign test remains finite and accurate for large balanced samples', () => {
  const result = summarizePairs([...pairs(2, 1, 600), ...pairs(1, 2, 600)]);
  assert.ok(result.gainP > 0.5 && result.gainP < 0.52);
  approximately(result.gainP, result.regressionP);
});

test('invalid, missing, zero and unrepresentable timing samples are rejected', () => {
  for (const input of [null, [], [{}], [{ baselineMs: 1 }], [null]]) assert.throws(() => summarizePairs(input));
  for (const value of [0, -1, NaN, Infinity, '1', null]) {
    assert.throws(() => summarizePairs([{ baselineMs: value, candidateMs: 1 }]));
    assert.throws(() => summarizePairs([{ baselineMs: 1, candidateMs: value }]));
  }
  assert.throws(() => summarizePairs([{ baselineMs: Number.MAX_VALUE, candidateMs: Number.MIN_VALUE }]));
  assert.throws(() => summarizePairs([{ baselineMs: Number.MIN_VALUE, candidateMs: Number.MAX_VALUE }]));
});

test('all 400 directional tests share one Holm correction and inputs are unchanged', () => {
  const input = family();
  input[0].sourceHash = 'collector-evidence';
  for (const item of input) {
    item.sets.forEach(set => {
      set.pairs.forEach(Object.freeze);
      Object.freeze(set.pairs); Object.freeze(set);
    });
    Object.freeze(item.sets); Object.freeze(item);
  }
  Object.freeze(input);
  const output = qualifyCases(input);
  assert.equal(output.length, 100);
  assert.ok(output.every(row => row.status === 'qualified' && row.directionalTests === 400));
  assert.equal(output[0].sourceHash, 'collector-evidence');
  assert.equal(output[0].sets[0].pairs, input[0].sets[0].pairs);
  assert.notEqual(output[0], input[0]);
  assert.equal(output[0].sets[0].gainAdjustedP, 400 / 2 ** 24);
  assert.equal(output[0].sets[0].regressionAdjustedP, 1);
  assert.equal(input[0].status, undefined);
});

test('an uncorrected sign-test result cannot pass the complete family gate', () => {
  const input = family(() => pairs(10, 10));
  input[0].sets = [0, 1].map(() => ({ pairs: [...pairs(10, 8, 17), ...pairs(10, 12, 7)] }));
  const output = qualifyCases(input);
  assert.ok(output[0].sets[0].gainP < 0.05);
  assert.ok(output[0].sets[0].gainAdjustedP > 0.05);
  assert.equal(output[0].status, 'unresolved');
});

test('gain, regression, mixed and tail rejection require both independent sets', () => {
  const input = family(() => pairs(10, 10));
  input[0].sets = [{ pairs: pairs() }, { pairs: pairs() }];
  input[1].sets = [{ pairs: pairs(10, 12) }, { pairs: pairs(10, 12) }];
  input[2].sets = [{ pairs: pairs() }, { pairs: pairs(10, 12) }];
  input[3].sets = [0, 1].map(() => ({ pairs: [...pairs(10, 8, 22), ...pairs(10, 12, 2)] }));
  input[4].sets = [{ pairs: pairs() }, { pairs: pairs(10, 10) }];
  input[5].sets = [0, 1].map(() => ({ pairs: [...pairs(10, 8, 22), ...pairs(10, 11, 2)] }));
  const result = qualifyCases(input);
  assert.deepEqual(result.slice(0, 6).map(row => row.status),
    ['qualified', 'regression', 'mixed', 'tail-rejected', 'unresolved', 'qualified']);
  assert.equal(result[3].sets[0].p95Ratio, 1.2);
  assert.equal(result[5].sets[0].p95Ratio, 1.1);
});

test('three-percent effect thresholds are strict in both directions', () => {
  const input = family(() => pairs(10, 10));
  input[0].sets = [{ pairs: pairs(1.03, 1) }, { pairs: pairs(1.03, 1) }];
  input[1].sets = [{ pairs: pairs(1, 1.03) }, { pairs: pairs(1, 1.03) }];
  const output = qualifyCases(input);
  assert.equal(output[0].status, 'unresolved');
  assert.equal(output[1].status, 'unresolved');
});

test('missing cases, sets, pairs and duplicate IDs cannot shrink the planned family', () => {
  assert.throws(() => qualifyCases(family().slice(1)), /exactly 100/);
  assert.throws(() => qualifyCases([...family(), { id: 'extra', sets: [] }]), /exactly 100/);
  for (const sets of [undefined, [], [{ pairs: pairs() }], [{ pairs: pairs() }, { pairs: pairs() }, { pairs: pairs() }]]) {
    const input = family(); input[0].sets = sets;
    assert.throws(() => qualifyCases(input), /exactly two/);
  }
  for (const n of [0, 23, 25]) {
    const input = family(); input[0].sets[1].pairs = pairs(10, 8, n);
    assert.throws(() => qualifyCases(input), /exactly 24/);
  }
  const duplicate = family(); duplicate[1].id = duplicate[0].id;
  assert.throws(() => qualifyCases(duplicate), /unique/);
  const holes = family(); holes[0].sets = [{ pairs: pairs() }, , ];
  assert.throws(() => qualifyCases(holes), /exactly 24/);
  const reused = family(); reused[0].sets[1].pairs = reused[0].sets[0].pairs;
  assert.throws(() => qualifyCases(reused), /must not reuse/);
  const invalid = family(); invalid[0].sets[0].pairs[0].candidateMs = 0;
  assert.throws(() => qualifyCases(invalid), /positive timing/);
});

test('explicit small-family sizes work while invalid gate settings are rejected', () => {
  const input = family().slice(0, 2);
  assert.ok(qualifyCases(input, { expectedCases: 2 }).every(row => row.directionalTests === 8));
  for (const options of [{ expectedCases: 0 }, { pairsPerSet: 0 }, { alpha: 0 }, { alpha: 1 },
    { alpha: NaN }, { minRatio: 1 }, { minRatio: Infinity }, { maxP95Ratio: 0.9 }]) {
    assert.throws(() => qualifyCases(input, options));
  }
});
