/**
 * Statistics for a new, preregistered paired GPU experiment.
 * These numerical gates do not attest hardware identity or output correctness.
 * The collector must establish both, and assess temporal dependence, separately.
 */

function finiteValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('A nonempty array of finite numbers is required');
  }
  const copy = [...values]; // Materialize holes so incomplete arrays are rejected.
  if (!copy.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('A nonempty array of finite numbers is required');
  }
  return copy.sort((a, b) => a - b);
}

/** Standard sample median; the caller's array is never sorted in place. */
export function median(values) {
  const sorted = finiteValues(values), middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  const lower = sorted[middle - 1], upper = sorted[middle];
  // Avoid overflowing the sum of large, finite values.
  return Math.sign(lower) === Math.sign(upper)
    ? lower + (upper - lower) / 2
    : lower / 2 + upper / 2;
}

/** Nearest-rank percentile, with p=0 explicitly defined as the minimum. */
export function percentile(values, p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError('Percentile must be a finite fraction in [0, 1]');
  }
  const sorted = finiteValues(values);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Seeded Fisher-Yates shuffle of exactly balanced AB/BA orders.
 * true means candidate first. The uint32 PRNG is for reproducibility, not secrets.
 */
export function balancedOrders(n, seed) {
  if (!Number.isSafeInteger(n) || n < 2 || n % 2 !== 0 || n > 0xfffffffe) {
    throw new RangeError('An even positive order count of at least two is required');
  }
  if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be a safe integer');
  let state = seed >>> 0;
  const nextUint32 = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  const orders = Array.from({ length: n }, (_, i) => i < n / 2);
  for (let i = orders.length - 1; i > 0; i--) {
    const bound = i + 1, limit = Math.floor(0x100000000 / bound) * bound;
    // Rejection avoids modulo bias when the range does not divide 2^32.
    let random;
    do { random = nextUint32(); } while (random >= limit);
    const j = random % bound;
    [orders[i], orders[j]] = [orders[j], orders[i]];
  }
  return orders;
}

/** Binomial P[X >= wins], X~Binomial(n, 1/2); no normal approximation. */
function signTail(wins, n) {
  if (n === 0 || wins === 0) return 1;
  // All coefficients and intermediate products are exact integers at n <= 48.
  // This includes the preregistered 24-pair experiment.
  if (n <= 48) {
    let coefficient = 1, sum = 0;
    for (let k = 0; k <= n; k++) {
      if (k >= wins) sum += coefficient;
      coefficient = coefficient * (n - k) / (k + 1);
    }
    return Math.min(1, sum / 2 ** n);
  }
  // Summing the shorter upper tail from its largest term avoids the underflow
  // that starting at 2^-n would cause for large, nearly balanced samples.
  if (wins <= n / 2) return Math.max(0, 1 - signTail(n - wins + 1, n));
  let logTerm = -n * Math.LN2;
  for (let j = 1; j <= n - wins; j++) logTerm += Math.log(n - j + 1) - Math.log(j);
  let term = Math.exp(logTerm), sum = term;
  for (let k = wins; k < n; k++) {
    term *= (n - k) / (k + 1);
    sum += term;
  }
  return Math.max(0, Math.min(1, sum));
}

/**
 * Summarize positive complete-window timings. Exact timing ties are excluded
 * from both sign tests, but retained in the ratios, percentiles and raw pairs.
 * The returned `pairs` is the original array reference; no input is mutated.
 */
export function summarizePairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new TypeError('Timing pairs are required');
  const baseline = [], candidate = [], ratios = [];
  let gains = 0, regressions = 0;
  for (const pair of pairs) {
    for (const key of ['baselineMs', 'candidateMs']) {
      if (typeof pair?.[key] !== 'number' || !Number.isFinite(pair[key]) || pair[key] <= 0) {
        throw new TypeError(`${key} must be a finite positive timing`);
      }
    }
    const ratio = pair.baselineMs / pair.candidateMs;
    if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError('Timing ratio is outside the finite positive range');
    baseline.push(pair.baselineMs); candidate.push(pair.candidateMs); ratios.push(ratio);
    if (pair.baselineMs > pair.candidateMs) gains++;
    if (pair.baselineMs < pair.candidateMs) regressions++;
  }
  const baselineP95Ms = percentile(baseline, 0.95), candidateP95Ms = percentile(candidate, 0.95);
  const p95Ratio = candidateP95Ms / baselineP95Ms;
  if (!Number.isFinite(p95Ratio) || p95Ratio <= 0) throw new RangeError('Tail ratio is outside the finite positive range');
  const nonTiedPairs = gains + regressions;
  return {
    pairs, pairCount: pairs.length, nonTiedPairs, tiedPairs: pairs.length - nonTiedPairs,
    ratios, medianSpeedup: median(ratios),
    baselineMedianMs: median(baseline), candidateMedianMs: median(candidate),
    baselineP95Ms, candidateP95Ms, p95Ratio,
    gainP: signTail(gains, nonTiedPairs), regressionP: signTail(regressions, nonTiedPairs),
  };
}

function adjustedHolmPValues(tests) {
  const sorted = tests.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p || a.index - b.index);
  const adjusted = new Array(tests.length);
  let previous = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    previous = Math.min(1, Math.max(previous, sorted[rank].p * (sorted.length - rank)));
    adjusted[sorted[rank].index] = previous;
  }
  return adjusted;
}

/**
 * Require a complete preregistered family: by default 100 cases, two independent
 * sets per case and exactly 24 pairs per set. Both directional tests participate
 * in one Holm family (100 * 2 * 2 = 400); neither direction gets a fresh alpha.
 *
 * Optional sizes are explicit for independent smaller studies/unit fixtures;
 * changing them after viewing results is not a valid preregistered experiment.
 * Returned case/set objects retain extra collector fields and raw pair references.
 */
export function qualifyCases(cases, {
  expectedCases = 100, pairsPerSet = 24, alpha = 0.05,
  minRatio = 1.03, maxP95Ratio = 1.10,
} = {}) {
  if (!Number.isSafeInteger(expectedCases) || expectedCases < 1 ||
      !Number.isSafeInteger(pairsPerSet) || pairsPerSet < 1) {
    throw new RangeError('Planned case and pair counts must be positive safe integers');
  }
  if (![alpha, minRatio, maxP95Ratio].every(value => typeof value === 'number' && Number.isFinite(value)) ||
      alpha <= 0 || alpha >= 1 || minRatio <= 1 || maxP95Ratio < 1) {
    throw new RangeError('Invalid qualification thresholds');
  }
  if (!Array.isArray(cases) || cases.length !== expectedCases) {
    throw new RangeError(`Incomplete or mismatched family: expected exactly ${expectedCases} cases`);
  }
  const ids = new Set(), tests = [], rows = [];
  for (const item of cases) {
    if (typeof item?.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      throw new TypeError('Every case needs a unique nonempty string id');
    }
    ids.add(item.id);
    if (!Array.isArray(item.sets) || item.sets.length !== 2) {
      throw new TypeError(`Case ${item.id} requires exactly two independent sets`);
    }
    if (item.sets[0] === item.sets[1] ||
        (item.sets[0]?.pairs && item.sets[0].pairs === item.sets[1]?.pairs)) {
      throw new TypeError(`Case ${item.id} must not reuse the same set or timing array twice`);
    }
    const sets = Array.from(item.sets, set => {
      if (!Array.isArray(set?.pairs) || set.pairs.length !== pairsPerSet) {
        throw new TypeError(`Case ${item.id} requires exactly ${pairsPerSet} pairs in each set`);
      }
      const summary = summarizePairs(set.pairs);
      tests.push(summary.gainP, summary.regressionP);
      return { ...set, ...summary };
    });
    rows.push({ ...item, sets });
  }
  const adjusted = adjustedHolmPValues(tests);
  return rows.map((row, caseIndex) => {
    const sets = row.sets.map((set, setIndex) => {
      const offset = caseIndex * 4 + setIndex * 2;
      const gainAdjustedP = adjusted[offset], regressionAdjustedP = adjusted[offset + 1];
      return {
        ...set, gainAdjustedP, regressionAdjustedP,
        significantGain: gainAdjustedP <= alpha,
        significantRegression: regressionAdjustedP <= alpha,
        gainPass: gainAdjustedP <= alpha && set.medianSpeedup > minRatio,
        regressionPass: regressionAdjustedP <= alpha && set.medianSpeedup < 1 / minRatio,
        tailPass: set.p95Ratio <= maxP95Ratio,
      };
    });
    let status = 'unresolved';
    if (sets.every(set => set.gainPass)) {
      status = sets.every(set => set.tailPass) ? 'qualified' : 'tail-rejected';
    } else if (sets.every(set => set.regressionPass)) {
      status = 'regression';
    } else if (sets.some(set => set.gainPass) && sets.some(set => set.regressionPass)) {
      status = 'mixed';
    }
    return { ...row, sets, directionalTests: tests.length, status };
  });
}
