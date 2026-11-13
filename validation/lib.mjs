// Helpers shared by the validation cases. Nothing here knows about a particular solver.
//
// A case is a plain object:
//   {id, domain, title, quantity, unit,
//    reference: {formula, value},     the closed-form expression as text, and its number
//    tolerance: {kind, value},        'relative' | 'absolute' | 'upper' | 'lower'
//    measure(),                       runs the real solver; returns a number, or {value, reference}
//                                     when the reference needs a number read from the solver
//                                     (for example the float32 mass the rigid world reports)
//    note?,                           one sentence on what limits the accuracy
//    source: {file, test}}            the test file and test name that assert the same thing
//
// Tolerance kinds. e = measured - reference.
//   relative  |e| <= value * |reference|
//   absolute  |e| <= value
//   upper      e  <= value      (the measured number must not exceed reference + value)
//   lower     -e  <= value      (the measured number must not fall below reference - value)
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIT_DIST = path.join(ROOT, 'packages/box3d-kit/dist');

/** A module of the built kit (packages/box3d-kit/dist), by subpath name: 'index', 'coupling', 'structure', ... */
export const kit = name => import(pathToFileURL(path.join(KIT_DIST, `${name}.js`)).href);
/** A canonical engine source (src/engine/<name>.ts). Needs scripts/register-typescript.mjs or Node's type stripping. */
export const engine = name => import(pathToFileURL(path.join(ROOT, 'src/engine', `${name}.ts`)).href);
/** A repository script used as an independent oracle (scripts/<name>.mjs). */
export const oracle = name => import(pathToFileURL(path.join(ROOT, 'scripts', `${name}.mjs`)).href);

/** Runs `make` once per key and hands every caller the same promise, so cases that read one simulation share it. */
const cache = new Map();
export function memo(key, make) {
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(make));
  return cache.get(key);
}
export const clearMemo = () => cache.clear();

export const relative = value => ({kind: 'relative', value});
export const absolute = value => ({kind: 'absolute', value});
export const upper = (value = 0) => ({kind: 'upper', value});
export const lower = (value = 0) => ({kind: 'lower', value});

/** Observed convergence order from two errors whose resolution differs by `ratio`. */
export const order = (coarse, fine, ratio = 2) => Math.log(Math.abs(coarse) / Math.abs(fine)) / Math.log(ratio);

/** Mean period between downward zero crossings, given their (interpolated) times. */
export const meanPeriod = crossings => (crossings.at(-1) - crossings[0]) / (crossings.length - 1);

/** Frequency of a signal from its upward crossings of its own mean, with linear interpolation. */
export function frequency(samples, dt) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < mean && samples[i] >= mean) crossings.push(i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]));
  return (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt);
}

/** erf to about 1e-15: Maclaurin series below 3, continued fraction of erfc above. */
export function erf(x) {
  const ax = Math.abs(x);
  let value;
  if (ax < 3) {
    let sum = ax, term = ax;
    for (let n = 1; n < 200; n++) { term *= -ax * ax / n; const add = term / (2 * n + 1); sum += add; if (Math.abs(add) < 1e-17 * Math.abs(sum)) break; }
    value = 2 / Math.sqrt(Math.PI) * sum;
  } else {
    let f = 0;
    for (let n = 60; n >= 1; n--) f = n / 2 / (ax + f);
    value = 1 - Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  }
  return x < 0 ? -value : value;
}

/** Adds the domain and the shared source file to a list of cases. */
export function defineCases(domain, file, cases) {
  // A case may name its own test file (`file`) when it is asserted in another one than the domain's.
  return cases.map(({test, file: own, ...one}) => ({domain, ...one, source: {file: own ?? file, test}}));
}
