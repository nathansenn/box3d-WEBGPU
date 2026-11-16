// Deterministic random numbers for the fuzzers. Every fuzz case is named by (suite, seed): rerun one with
// FUZZ_SEED=<seed> and it replays the same inputs on any machine. No Math.random anywhere under tests/fuzz.
export function rng(seed) {
  // mulberry32: 32 bits of state, full period, good enough to drive test-case generation.
  let state = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const api = {
    seed,
    /** Uniform in [0, 1). */
    next,
    /** Uniform real in [lo, hi). */
    real: (lo = 0, hi = 1) => lo + (hi - lo) * next(),
    /** Uniform integer in [lo, hi], both included. */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    bool: (p = 0.5) => next() < p,
    pick: list => list[Math.floor(next() * list.length)],
    /** Log-uniform real in [lo, hi): scale-free parameters such as stiffness or density. */
    log: (lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * next()),
    vec3: (lo = -1, hi = 1) => [api.real(lo, hi), api.real(lo, hi), api.real(lo, hi)],
    /** Uniform unit quaternion [x, y, z, w] (Shoemake). */
    quat: () => {
      const u = next(), v = next() * 2 * Math.PI, w = next() * 2 * Math.PI, a = Math.sqrt(1 - u), b = Math.sqrt(u);
      return [a * Math.sin(v), a * Math.cos(v), b * Math.sin(w), b * Math.cos(w)];
    },
    shuffle: list => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; },
    /** An independent stream, so adding draws to one part of a generator does not shift another. */
    fork: label => rng(hashSeed(seed, label)),
  };
  return api;
}

/** FNV-1a of a label mixed with a seed: stable sub-seeds for named parts of a case. */
export function hashSeed(seed, label) {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const ch of String(label)) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return hash >>> 0;
}

/** FNV-1a over bytes: a short name for a state, printed in failure messages. */
export function hashBytes(bytes, hash = 0x811c9dc5) {
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  return hash >>> 0;
}

/**
 * How long a suite runs. The gate (`npm run test:fuzz`) uses 'short'; `npm run fuzz:long` uses 'long'. FUZZ_SEED pins
 * one seed, FUZZ_SEEDS sets how many, for bisecting a failure.
 */
export const MODE = process.env.FUZZ_MODE === 'long' ? 'long' : 'short';
export function seeds(short, long) {
  if (process.env.FUZZ_SEED !== undefined) return [Number(process.env.FUZZ_SEED) >>> 0];
  const count = process.env.FUZZ_SEEDS !== undefined ? Number(process.env.FUZZ_SEEDS) : MODE === 'long' ? long : short;
  const base = (Number(process.env.FUZZ_BASE ?? 20261116)) >>> 0;
  return Array.from({length: count}, (_, i) => (base + i * 7919) >>> 0);
}
export const scale = (short, long) => MODE === 'long' ? long : short;
