// Shared helpers of the engine comparison: seeded random numbers, quaternions, statistics and hashing.
// Nothing here depends on any physics engine.

/** mulberry32: a small seeded generator, so every engine receives exactly the same scene. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const quatIdentity = () => [0, 0, 0, 1];
export function quatAxisAngle(ax, ay, az, angle) {
  const n = Math.hypot(ax, ay, az) || 1, s = Math.sin(angle / 2) / n;
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function quatRotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
/** Uniform random unit quaternion (Shoemake). */
export function quatRandom(random) {
  const u1 = random(), u2 = random() * 2 * Math.PI, u3 = random() * 2 * Math.PI, a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}
/** Shortest rotation that turns the unit vector `from` onto the unit vector `to`. */
export function quatFromTo(from, to) {
  const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (d < -0.999999) {
    // Opposite: half a turn about any axis perpendicular to `from`.
    const axis = Math.abs(from[0]) < 0.9 ? [0, -from[2], from[1]] : [-from[2], 0, from[0]], n = Math.hypot(...axis);
    return [axis[0] / n, axis[1] / n, axis[2] / n, 0];
  }
  const c = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]], w = 1 + d, n = Math.hypot(c[0], c[1], c[2], w);
  return [c[0] / n, c[1] / n, c[2] / n, w / n];
}
/** A unit vector perpendicular to the unit vector `v`. */
export function perpendicular(v) {
  const a = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const c = [v[1] * a[2] - v[2] * a[1], v[2] * a[0] - v[0] * a[2], v[0] * a[1] - v[1] * a[0]], n = Math.hypot(...c);
  return [c[0] / n, c[1] / n, c[2] / n];
}
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
/** mean / p50 / p95 / max / standard deviation of a list of numbers. */
export function summarize(values) {
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sorted.length ? sum / sorted.length : NaN;
  let sq = 0;
  for (const v of sorted) sq += (v - mean) * (v - mean);
  return {count: sorted.length, mean, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.length ? sorted[sorted.length - 1] : NaN, min: sorted.length ? sorted[0] : NaN,
    sd: sorted.length > 1 ? Math.sqrt(sq / (sorted.length - 1)) : 0, total: sum};
}

/** FNV-1a over the float32 bit patterns of a Float64Array (values are rounded to float32 first, the precision every WASM engine here stores). */
export function hashState(values, count = values.length) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  let h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0;
  for (let i = 0; i < count; i++) {
    f[0] = values[i];
    const w = u[0] | 0;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ w, 0x5bd1e995); h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
/** The same hash over the exact float64 bits, for engines that compute in double precision (cannon-es). */
export function hashState64(values, count = values.length) {
  const u = new Uint32Array(values.buffer, values.byteOffset, count * 2);
  let h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0;
  for (let i = 0; i < u.length; i++) {
    const w = u[i] | 0;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ w, 0x5bd1e995); h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Volume of the body's shape in m^3 (exact for box, sphere, capsule; the signed-tetrahedron sum for a hull with faces). */
export function shapeVolume(shape) {
  switch (shape.kind) {
    case 'box': return 8 * shape.half[0] * shape.half[1] * shape.half[2];
    case 'sphere': return 4 / 3 * Math.PI * shape.radius ** 3;
    case 'capsule': return Math.PI * shape.radius ** 2 * (2 * shape.halfHeight) + 4 / 3 * Math.PI * shape.radius ** 3;
    case 'hull': {
      let v = 0;
      const p = shape.points;
      for (const face of shape.faces) for (let k = 1; k + 1 < face.length; k++) {
        const a = face[0] * 3, b = face[k] * 3, c = face[k + 1] * 3;
        v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
      }
      return Math.abs(v);
    }
    default: return 0;
  }
}

/** Complete elliptic integral of the first kind K(k), by the arithmetic-geometric mean. */
export function ellipticK(k) {
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16; i++) { const t = (a + b) / 2; b = Math.sqrt(a * b); a = t; }
  return Math.PI / (2 * a);
}

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** benchmarks/engines */
export const enginesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** package.json of an installed benchmark dependency (several of them do not export it). */
export function packageInfo(name) {
  return JSON.parse(fs.readFileSync(path.join(enginesDir, 'node_modules', name, 'package.json'), 'utf8'));
}
