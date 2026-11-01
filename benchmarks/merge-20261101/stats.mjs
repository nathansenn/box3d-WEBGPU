// Shared statistics and provenance helpers for the merge benchmarks.
// Percentiles use linear interpolation between closest ranks (Hyndman-Fan type 7).
// Bootstrap intervals use a fixed-seed generator so a rerun on the same samples gives the same interval.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export const median = (values) => quantile(values, 0.5);

export function describe(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  return {
    n, min, p05: quantile(values, 0.05), p25: quantile(values, 0.25), median: med,
    p75: quantile(values, 0.75), p95: quantile(values, 0.95), p99: quantile(values, 0.99), max,
    mean, sd, cv: mean ? sd / mean : 0, mad, iqr: quantile(values, 0.75) - quantile(values, 0.25),
  };
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Ratio of medians baseline/candidate with a percentile bootstrap 95% interval.
 *  paired=true resamples round indices together (rounds ran back to back in ABBA order). */
export function ratioOfMedians(baseline, candidate, { paired = true, iterations = 20000, seed = 0x5eed1 } = {}) {
  const point = median(baseline) / median(candidate);
  if (baseline.length < 2 || candidate.length < 2) return { point, low95: NaN, high95: NaN, iterations: 0, paired };
  const next = rng(seed);
  const ratios = new Float64Array(iterations);
  const a = new Array(baseline.length);
  const b = new Array(candidate.length);
  const usePairs = paired && baseline.length === candidate.length;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < a.length; i++) {
      const k = Math.floor(next() * baseline.length);
      a[i] = baseline[k];
      if (usePairs) b[i] = candidate[k];
    }
    if (!usePairs) for (let i = 0; i < b.length; i++) b[i] = candidate[Math.floor(next() * candidate.length)];
    ratios[it] = median(a) / median(b);
  }
  ratios.sort();
  return {
    point,
    low95: ratios[Math.floor(iterations * 0.025)],
    high95: ratios[Math.floor(iterations * 0.975)],
    iterations,
    paired: usePairs,
  };
}

/** Two-sided Mann-Whitney U test (normal approximation with tie correction). */
export function mannWhitney(a, b) {
  const all = [...a.map((v) => [v, 0]), ...b.map((v) => [v, 1])].sort((x, y) => x[0] - y[0]);
  const ranks = new Float64Array(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = rank;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  let rankSumA = 0;
  for (let i = 0; i < all.length; i++) if (all[i][1] === 0) rankSumA += ranks[i];
  const n1 = a.length;
  const n2 = b.length;
  const u = rankSumA - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * ((n + 1) - tieTerm / (n * (n - 1))));
  if (!sigma) return { u, z: 0, p: 1 };
  const z = (u - mu - Math.sign(u - mu) * 0.5) / sigma;
  return { u, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

function normalCdf(x) {
  // Abramowitz-Stegun 7.1.26 erf approximation (absolute error below 1.5e-7).
  const t = 1 / (1 + 0.3275911 * (x / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + y);
}

/** Verdict text for a baseline/candidate time ratio interval (ratio > 1 means the candidate is faster). */
export function verdict(ratio) {
  if (!Number.isFinite(ratio.low95)) return 'insufficient samples';
  if (ratio.low95 > 1) return 'candidate faster';
  if (ratio.high95 < 1) return 'candidate slower';
  return 'no significant difference';
}

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tryRun(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

export function environment(extra = {}) {
  const cpus = os.cpus();
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    platform: `${process.platform}-${process.arch}`,
    kernel: os.release(),
    cpuModel: cpus[0]?.model,
    logicalCpus: cpus.length,
    totalMemoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    loadAverageAtCapture: os.loadavg(),
    affinity: tryRun('taskset', ['-pc', String(process.pid)]),
    ...extra,
  };
}

export function gitInfo(dir) {
  return {
    commit: tryRun('git', ['-C', dir, 'rev-parse', 'HEAD']),
    describe: tryRun('git', ['-C', dir, 'log', '-1', '--format=%h %ad %s', '--date=iso']),
    dirty: (tryRun('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no']) ?? '').length > 0,
  };
}

export function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
