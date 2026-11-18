/**
 * The WGSL of the GPU discrete-element backend (granular-gpu.ts) and its shared layouts.
 *
 * One step is six dispatches, each a gather (no two invocations write the same element, except the grid insert, whose
 * racing order a later pass removes):
 *   wallOpen   per wall: the opening half kick and the drift of moving walls
 *   integrate  per grain: opening half kick, drift, removal at the bounds, insert into the hash grid (atomic counters)
 *   sort       per bucket: sort the bucket's grains by index, so that the order grains were inserted in cannot matter
 *   pairs      per grain: every grain of the 27 cells around it; the contact law; the new contact histories
 *   walls      per block of 64 grains, one after the other: wall contacts, the closing half kick, the block's wall sums
 *   wallClose  per wall: add the block sums in block order; the closing half kick of dynamic walls
 * A pair is evaluated by both its grains from the same numbers, and every operation of the contact law gives the exact
 * negative for the exchanged pair, so the two forces are equal and opposite to the last bit.
 *
 * Contact history lives in K slots per grain, keyed by the neighbour's index (0x80000000 | wall index for a wall).
 * granular-f32.ts is the same algorithm, operation for operation, in float32 on the CPU.
 */
import {defineStruct} from './layout.ts';
import {preprocessWgsl} from './wgsl.ts';

/** Grains per block of the wall pass. */
export const DEM_BLOCK=64;
/** Most walls the backend takes. */
export const DEM_MAX_WALLS=16;
/** An unused history slot. */
export const DEM_EMPTY=0xFFFFFFFF;
/** High bit of a history key: the contact is with a wall. */
export const DEM_WALL_KEY=0x80000000;
/** Meter slots (atomic u32): grains that found their bucket full, pair contacts that found no history slot, grains removed
 * at the bounds (all three since creation), then of the last step: pair contacts counted from both sides, the largest
 * pair overlap ratio (float bits), flags (1: a position that is not a number). */
export const DEM_METER_BUCKET_OVERFLOW=0,DEM_METER_HISTORY_OVERFLOW=1,DEM_METER_REMOVED=2,DEM_METER_CONTACTS=3,DEM_METER_OVERLAP=4,DEM_METER_FLAGS=5,DEM_METER_SLOTS=8;

export const DEM_PARAMS=defineStruct('Params',{
  count:'u32',tableMask:'u32',tableSize:'u32',walls:'u32',
  blocks:'u32',hertz:'u32',flags:'u32',pad0:'u32',
  h:'f32',hh:'f32',invCell:'f32',tdamp:'f32',
  kHertz:'f32',kMindlin:'f32',kn:'f32',kt:'f32',
  alpha:'f32',mu:'f32',mur:'f32',pad1:'f32',
  gravity:'vec4f',boundsMin:'vec4f',boundsMax:'vec4f',
},{usage:'uniform'});

export const DEM_WALL=defineStruct('Wall',{
  /** 0 plane, 1 box, 2 sphere, 3 capsule, 4 shell of revolution; 0 static, 1 kinematic, 2 dynamic. */
  shape:'u32',kind:'u32',enabled:'u32',pad:'u32',
  /** The rows of the rotation matrix. */
  r0:'vec4f',r1:'vec4f',r2:'vec4f',
  /** Position; velocity and the curved radius; spin and the mass. */
  x:'vec4f',v:'vec4f',w:'vec4f',
  /** The seven shape numbers (dimA, then dimB.xyz). */
  dimA:'vec4f',dimB:'vec4f',
  /** alpha, friction, rolling friction, gravity scale. */
  coef:'vec4f',
  q:'vec4f',
  /** Inverse principal moments and the inverse mass. */
  inv:'vec4f',
  extF:'vec4f',extT:'vec4f',
  /** Force on the wall and the normal load; moment about its position and the contacts. */
  force:'vec4f',torque:'vec4f',
  impulse:'vec4f',angularImpulse:'vec4f',
});

const COMMON=/* wgsl */`
${'${PARAMS}'}
const K = ${'${K}'}u;
const M = ${'${M}'}u;
const HS = ${'${HS}'}u;
const EMPTY = 0xFFFFFFFFu;
const WALL_KEY = 0x80000000u;
fn dot3(a: vec3f, b: vec3f) -> f32 { return a.x * b.x + a.y * b.y + a.z * b.z; }
fn cross3(a: vec3f, b: vec3f) -> vec3f { return vec3f(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
`;
const HASH=/* wgsl */`
fn cellOf(p: vec3f) -> vec3i { return vec3i(floor(p * P.invCell)); }
fn bucketOf(c: vec3i) -> u32 {
  let u = vec3u(c);
  return ((u.x * 73856093u) ^ (u.y * 19349663u) ^ (u.z * 83492791u)) & P.tableMask;
}
`;
const CONTACT=/* wgsl */`
struct Contact { f: vec3f, ft: vec3f, mr: vec3f, xi: vec3f, th: vec3f, load: f32 }
// A stored displacement turned into the tangent plane of n, keeping its length.
fn turned(s0: vec3f, n: vec3f) -> vec3f {
  var s = s0;
  let d = dot3(s, n);
  if (d != 0.0) {
    let before = dot3(s, s);
    s = s - d * n;
    let after = dot3(s, s);
    if (after > 0.0) { s = s * sqrt(before / after); }
  }
  return s;
}
// One contact: n from the other body to the grain, v the velocity of the grain's contact point relative to the other's,
// w the relative spin, xi0 and th0 the stored tangential displacement and rolling rotation.
fn contact(n: vec3f, v: vec3f, w: vec3f, xi0: vec3f, th0: vec3f, delta: f32, Rs: f32, ms: f32, alpha: f32, mu: f32, mur: f32) -> Contact {
  var C: Contact;
  let vn = dot3(v, n);
  var Fe: f32; var cn: f32; var kt: f32;
  if (P.hertz == 1u) {
    let sq = sqrt(delta); let kH = P.kHertz * sqrt(Rs);
    Fe = kH * delta * sq; cn = alpha * sqrt(ms * kH * sq); kt = P.kMindlin * sqrt(Rs) * sq;
  } else { Fe = P.kn * delta; cn = alpha * sqrt(ms * P.kn); kt = P.kt; }
  let load = max(Fe - cn * vn, 0.0);
  let vt = v - vn * n;
  var ft = vec3f(0.0); var xi = vec3f(0.0);
  if (mu > 0.0 && load > 0.0) {
    xi = turned(xi0, n) + vt * P.h;
    let ct = P.tdamp * alpha * sqrt(ms * kt);
    ft = -kt * xi - ct * vt;
    let cap = mu * load; let f2 = dot3(ft, ft);
    if (f2 > cap * cap) { ft = ft * (cap / sqrt(f2)); xi = -ft / kt; }
  }
  var mr = vec3f(0.0); var th = vec3f(0.0);
  if (mur > 0.0 && load > 0.0) {
    let wn = dot3(w, n); let wt = w - wn * n;
    th = turned(th0, n) + wt * P.h;
    let kr = kt * Rs * Rs;
    mr = -kr * th;
    let cap = mur * Rs * load; let m2 = dot3(mr, mr);
    if (m2 > cap * cap) { mr = mr * (cap / sqrt(m2)); th = -mr / kr; }
  }
  C.f = load * n + ft; C.ft = ft; C.mr = mr; C.xi = xi; C.th = th; C.load = load;
  return C;
}
`;

const INTEGRATE=/* wgsl */`
#include "common"
@group(0) @binding(0) var<uniform> P: Params;
// (x, y, z, radius; a removed grain keeps its radius negated), (v, mass), (omega, 1 / moment of inertia), force and torque.
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> spin: array<vec4f>;
@group(0) @binding(4) var<storage, read> ft: array<vec4f>;
// Per bucket a count, then M grain indices per bucket.
@group(0) @binding(5) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> meter: array<atomic<u32>, 8>;
#include "hash"
@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.count) { return; }
  var p = pos[i];
  if (p.w <= 0.0) { return; }
  var v = vel[i]; var w = spin[i];
  let im = (1.0 / v.w) * P.hh; let ii = w.w * P.hh;
  let nv = v.xyz + (ft[2u * i].xyz * im + P.gravity.xyz * P.hh);
  let nw = w.xyz + ft[2u * i + 1u].xyz * ii;
  let np = p.xyz + nv * P.h;
  if ((P.flags & 1u) != 0u && (np.x < P.boundsMin.x || np.x > P.boundsMax.x || np.y < P.boundsMin.y || np.y > P.boundsMax.y || np.z < P.boundsMin.z || np.z > P.boundsMax.z)) {
    pos[i] = vec4f(np, -p.w); vel[i] = vec4f(0.0, 0.0, 0.0, v.w); spin[i] = vec4f(0.0, 0.0, 0.0, w.w);
    atomicAdd(&meter[${'${DEM_METER_REMOVED}'}u], 1u);
    return;
  }
  pos[i] = vec4f(np, p.w); vel[i] = vec4f(nv, v.w); spin[i] = vec4f(nw, w.w);
  if (!(abs(np.x) + abs(np.y) + abs(np.z) < 3.0e38)) { atomicOr(&meter[${'${DEM_METER_FLAGS}'}u], 1u); return; }
  let b = bucketOf(cellOf(np));
  let s = atomicAdd(&grid[b], 1u);
  if (s < M) { atomicStore(&grid[P.tableSize + b * M + s], i); } else { atomicAdd(&meter[${'${DEM_METER_BUCKET_OVERFLOW}'}u], 1u); }
}
`;
const SORT=/* wgsl */`
#include "common"
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> grid: array<u32>;
@compute @workgroup_size(64)
fn sort(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let b = id.x + id.y * groups.x * 64u;
  if (b >= P.tableSize) { return; }
  let n = min(grid[b], M);
  grid[b] = n;
  let base = P.tableSize + b * M;
  for (var a = 1u; a < n; a++) {
    let key = grid[base + a];
    var k = a;
    while (k > 0u && grid[base + k - 1u] > key) { grid[base + k] = grid[base + k - 1u]; k--; }
    grid[base + k] = key;
  }
}
`;
const HISTORY=/* wgsl */`
// The stored displacement of the old slot with this key (zero when there is none).
fn oldSlot(i: u32, key: u32) -> u32 {
  for (var s = 0u; s < K; s++) { if (hOld[(i * K + s) * HS].w == key) { return s; } }
  return K;
}
`;
const PAIRS=/* wgsl */`
#include "common"
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> spin: array<vec4f>;
@group(0) @binding(4) var<storage, read> grid: array<u32>;
// K slots per grain: (bits of the tangential displacement, key)${'${ROLLING_NOTE}'}.
@group(0) @binding(5) var<storage, read> hOld: array<vec4u>;
@group(0) @binding(6) var<storage, read_write> hNew: array<vec4u>;
@group(0) @binding(7) var<storage, read_write> ft: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> meter: array<atomic<u32>, 8>;
#include "hash"
#include "contact"
#include "history"
@compute @workgroup_size(64)
fn pairs(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.count) { return; }
  let p = pos[i];
  var used = 0u;
  var f = vec3f(0.0); var t = vec3f(0.0);
  if (p.w > 0.0) {
    let vi = vel[i]; let wi = spin[i].xyz; let c = cellOf(p.xyz);
    var touching = 0u; var deepest = 0.0;
    for (var dz = -1; dz <= 1; dz++) { for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
      let cc = c + vec3i(dx, dy, dz);
      let b = bucketOf(cc);
      let n = grid[b]; let base = P.tableSize + b * M;
      for (var s = 0u; s < n; s++) {
        let j = grid[base + s];
        if (j == i) { continue; }
        let q = pos[j];
        // Another cell can share the bucket: only grains of the cell being visited count (each grain is seen once).
        if (any(cellOf(q.xyz) != cc)) { continue; }
        let d = p.xyz - q.xyz; let sum = p.w + q.w; let d2 = dot3(d, d);
        if (d2 >= sum * sum) { continue; }
        let dist = sqrt(d2); let delta = sum - dist; let nrm = d / dist;
        let la = p.w - 0.5 * delta; let lb = q.w - 0.5 * delta;
        let vj = vel[j]; let wj = spin[j].xyz;
        let sv = la * wi + lb * wj;
        let v = vi.xyz - vj.xyz - cross3(sv, nrm);
        let key = j; let slot = oldSlot(i, key);
        var xi0 = vec3f(0.0); var th0 = vec3f(0.0);
        if (slot < K) {
          xi0 = bitcast<vec3f>(hOld[(i * K + slot) * HS].xyz);
#if ROLLING
          th0 = bitcast<vec3f>(hOld[(i * K + slot) * HS + 1u].xyz);
#endif
        }
        let C = contact(nrm, v, wi - wj, xi0, th0, delta, p.w * q.w / sum, vi.w * vj.w / (vi.w + vj.w), P.alpha, P.mu, P.mur);
        if (used < K) {
          hNew[(i * K + used) * HS] = vec4u(bitcast<vec3u>(C.xi), key);
#if ROLLING
          hNew[(i * K + used) * HS + 1u] = vec4u(bitcast<vec3u>(C.th), 0u);
#endif
          used++;
        } else { atomicAdd(&meter[${'${DEM_METER_HISTORY_OVERFLOW}'}u], 1u); }
        f = f + C.f;
        t = t + (C.mr - la * cross3(nrm, C.ft));
        touching++; deepest = max(deepest, delta / min(p.w, q.w));
      }
    } } }
    if (touching > 0u) { atomicAdd(&meter[${'${DEM_METER_CONTACTS}'}u], touching); atomicMax(&meter[${'${DEM_METER_OVERLAP}'}u], bitcast<u32>(deepest)); }
  }
  for (var s = used; s < K; s++) { hNew[(i * K + s) * HS].w = EMPTY; }
  ft[2u * i] = vec4f(f, 0.0); ft[2u * i + 1u] = vec4f(t, 0.0);
}
`;
const WALL_STORAGE=/* wgsl */`
${'${WALL}'}
`;
const WALL_DISTANCE=/* wgsl */`
struct Hit { dist: f32, n: vec3f, at: vec3f }
// Distance from p to the surface of wall k (negative inside a solid), the outward normal and the nearest surface point.
fn wallDistance(k: u32, p: vec3f) -> Hit {
  let r0 = walls[k].r0.xyz; let r1 = walls[k].r1.xyz; let r2 = walls[k].r2.xyz;
  let e = p - walls[k].x.xyz;
  var l = vec3f(r0.x * e.x + r1.x * e.y + r2.x * e.z, r0.y * e.x + r1.y * e.y + r2.y * e.z, r0.z * e.x + r1.z * e.y + r2.z * e.z);
  let d = walls[k].dimA; let g = walls[k].dimB; let shape = walls[k].shape;
  var n = vec3f(0.0); var dist = 0.0;
  if (shape == 0u) { n = d.xyz; dist = dot3(l, n); }
  else if (shape == 2u || shape == 3u) {
    if (shape == 3u) { l.y = l.y - clamp(l.y, -d.y, d.y); }
    let len = sqrt(dot3(l, l));
    if (len > 1e-30) { n = l / len; } else { n = vec3f(1.0, 0.0, 0.0); }
    dist = len - d.x;
  } else if (shape == 1u) {
    let q = abs(l) - d.xyz;
    if (q.x <= 0.0 && q.y <= 0.0 && q.z <= 0.0) {
      if (q.x >= q.y && q.x >= q.z) { n.x = select(1.0, -1.0, l.x < 0.0); dist = q.x; }
      else if (q.y >= q.z) { n.y = select(1.0, -1.0, l.y < 0.0); dist = q.y; }
      else { n.z = select(1.0, -1.0, l.z < 0.0); dist = q.z; }
    } else {
      let o = max(q, vec3f(0.0));
      dist = sqrt(dot3(o, o));
      n = vec3f(select(o.x, -o.x, l.x < 0.0), select(o.y, -o.y, l.y < 0.0), select(o.z, -o.z, l.z < 0.0)) / dist;
    }
  } else {
    // A shell of revolution: the nearest point of the generating line in the grain's meridian half plane.
    let a = d.xyz; let s = dot3(l, a);
    var r = l - s * a;
    let rho = sqrt(dot3(r, r));
    if (rho > 1e-30) { r = r / rho; }
    else if (abs(a.x) < 0.9) { let len = sqrt(1.0 - a.x * a.x); r = vec3f((1.0 - a.x * a.x) / len, -a.x * a.y / len, -a.x * a.z / len); }
    else { let len = sqrt(1.0 - a.y * a.y); r = vec3f(-a.y * a.x / len, (1.0 - a.y * a.y) / len, -a.y * a.z / len); }
    let ur = g.y - d.w; let uz = g.z - g.x;
    let t = clamp(((rho - d.w) * ur + (s - g.x) * uz) / (ur * ur + uz * uz), 0.0, 1.0);
    let dr = rho - (d.w + t * ur); let ds = s - (g.x + t * uz);
    dist = sqrt(dr * dr + ds * ds);
    if (dist > 1e-30) { n = (dr * r + ds * a) / dist; } else { n = a; }
  }
  var H: Hit;
  H.dist = dist; H.n = vec3f(dot3(r0, n), dot3(r1, n), dot3(r2, n)); H.at = p - dist * H.n;
  return H;
}
`;
const WALLS=/* wgsl */`
#include "common"
#include "wall"
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> spin: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> ft: array<vec4f>;
@group(0) @binding(5) var<storage, read> hOld: array<vec4u>;
@group(0) @binding(6) var<storage, read_write> hNew: array<vec4u>;
@group(0) @binding(7) var<storage, read> walls: array<Wall>;
// Per block: per wall (force on the wall, normal load) and (moment, contacts), then (history overflows, largest overlap ratio, 0, 0).
@group(0) @binding(8) var<storage, read_write> sums: array<vec4f>;
#include "contact"
#include "history"
#include "wallDistance"
const MAX_WALLS = ${'${DEM_MAX_WALLS}'}u;
@compute @workgroup_size(4)
fn wallContacts(@builtin(global_invocation_id) id: vec3u) {
  let block = id.x;
  if (block >= P.blocks) { return; }
  var lf: array<vec3f, MAX_WALLS>; var lt: array<vec3f, MAX_WALLS>; var ll: array<f32, MAX_WALLS>; var lc: array<f32, MAX_WALLS>;
  for (var k = 0u; k < MAX_WALLS; k++) { lf[k] = vec3f(0.0); lt[k] = vec3f(0.0); ll[k] = 0.0; lc[k] = 0.0; }
  var overflow = 0.0; var deepest = 0.0;
  // The grains of a block are taken one after the other, so the block's sums have one order.
  for (var g = 0u; g < ${'${DEM_BLOCK}'}u; g++) {
    let i = block * ${'${DEM_BLOCK}'}u + g;
    if (i >= P.count) { break; }
    let p = pos[i];
    if (p.w <= 0.0) { continue; }
    var v = vel[i]; var w = spin[i];
    var f = ft[2u * i].xyz; var t = ft[2u * i + 1u].xyz;
    var used = K;
    for (var s = 0u; s < K; s++) { if (hNew[(i * K + s) * HS].w == EMPTY) { used = s; break; } }
    for (var k = 0u; k < P.walls; k++) {
      if (walls[k].enabled == 0u) { continue; }
      let H = wallDistance(k, p.xyz);
      if (H.dist >= p.w) { continue; }
      let delta = p.w - H.dist; let la = H.dist;
      let o = H.at - walls[k].x.xyz;
      let ws = walls[k].w.xyz;
      let u = walls[k].v.xyz + cross3(ws, o);
      let vr = v.xyz - la * cross3(w.xyz, H.n) - u;
      let key = WALL_KEY | k; let slot = oldSlot(i, key);
      var xi0 = vec3f(0.0); var th0 = vec3f(0.0);
      if (slot < K) {
        xi0 = bitcast<vec3f>(hOld[(i * K + slot) * HS].xyz);
#if ROLLING
        th0 = bitcast<vec3f>(hOld[(i * K + slot) * HS + 1u].xyz);
#endif
      }
      let curved = walls[k].v.w; let mass = walls[k].w.w;
      var Rs = p.w; if (curved > 0.0) { Rs = p.w * curved / (p.w + curved); }
      var ms = v.w; if (walls[k].kind == 2u) { ms = v.w * mass / (v.w + mass); }
      let C = contact(H.n, vr, w.xyz - ws, xi0, th0, delta, Rs, ms, walls[k].coef.x, walls[k].coef.y, walls[k].coef.z);
      if (used < K) {
        hNew[(i * K + used) * HS] = vec4u(bitcast<vec3u>(C.xi), key);
#if ROLLING
        hNew[(i * K + used) * HS + 1u] = vec4u(bitcast<vec3u>(C.th), 0u);
#endif
        used++;
      } else { overflow += 1.0; }
      f = f + C.f;
      t = t + (C.mr - la * cross3(H.n, C.ft));
      lf[k] = lf[k] - C.f; lt[k] = lt[k] - (C.mr + cross3(o, C.f)); ll[k] = ll[k] + C.load; lc[k] = lc[k] + 1.0;
      deepest = max(deepest, delta / p.w);
    }
    ft[2u * i] = vec4f(f, 0.0); ft[2u * i + 1u] = vec4f(t, 0.0);
    // The closing half kick.
    let im = (1.0 / v.w) * P.hh; let ii = w.w * P.hh;
    vel[i] = vec4f(v.xyz + (f * im + P.gravity.xyz * P.hh), v.w);
    spin[i] = vec4f(w.xyz + t * ii, w.w);
  }
  let base = block * (2u * P.walls + 1u);
  for (var k = 0u; k < P.walls; k++) { sums[base + 2u * k] = vec4f(lf[k], ll[k]); sums[base + 2u * k + 1u] = vec4f(lt[k], lc[k]); }
  sums[base + 2u * P.walls] = vec4f(overflow, deepest, 0.0, 0.0);
}
`;
const WALL_STEP=/* wgsl */`
#include "common"
#include "wall"
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> walls: array<Wall>;
@group(0) @binding(2) var<storage, read> sums: array<vec4f>;
// omega += h I^-1 torque, with the principal moments in the wall's axes.
fn spun(k: u32, h: f32, t: vec3f) -> vec3f {
  let r0 = walls[k].r0.xyz; let r1 = walls[k].r1.xyz; let r2 = walls[k].r2.xyz; let I = walls[k].inv.xyz;
  let l = vec3f((r0.x * t.x + r1.x * t.y + r2.x * t.z) * I.x, (r0.y * t.x + r1.y * t.y + r2.y * t.z) * I.y, (r0.z * t.x + r1.z * t.y + r2.z * t.z) * I.z);
  return walls[k].w.xyz + h * vec3f(dot3(r0, l), dot3(r1, l), dot3(r2, l));
}
fn kick(k: u32) {
  let F = walls[k].force.xyz; let T = walls[k].torque.xyz;
  walls[k].impulse = vec4f(walls[k].impulse.xyz + P.hh * F, 0.0);
  walls[k].angularImpulse = vec4f(walls[k].angularImpulse.xyz + P.hh * T, 0.0);
  if (walls[k].kind != 2u) { return; }
  let im = walls[k].inv.w * P.hh; let s = walls[k].coef.w * P.hh;
  let nv = walls[k].v.xyz + ((F + walls[k].extF.xyz) * im + P.gravity.xyz * s);
  let nw = spun(k, P.hh, T + walls[k].extT.xyz);
  walls[k].v = vec4f(nv, walls[k].v.w); walls[k].w = vec4f(nw, walls[k].w.w);
}
// The opening half kick and the drift of a moving wall.
@compute @workgroup_size(1)
fn wallOpen(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  if (k >= P.walls) { return; }
  kick(k);
  if (walls[k].kind == 0u) { return; }
  walls[k].x = vec4f(walls[k].x.xyz + P.h * walls[k].v.xyz, 0.0);
  let w = walls[k].w.xyz;
  if (w.x == 0.0 && w.y == 0.0 && w.z == 0.0) { return; }
  // q <- q + (h / 2) omega q, normalised; then the rotation matrix.
  let q = walls[k].q; let c = 0.5 * P.h;
  var n = vec4f(q.x + c * (w.x * q.w + w.y * q.z - w.z * q.y), q.y + c * (w.y * q.w + w.z * q.x - w.x * q.z), q.z + c * (w.z * q.w + w.x * q.y - w.y * q.x), q.w - c * (w.x * q.x + w.y * q.y + w.z * q.z));
  n = n / sqrt(n.x * n.x + n.y * n.y + n.z * n.z + n.w * n.w);
  walls[k].q = n;
  walls[k].r0 = vec4f(1.0 - 2.0 * (n.y * n.y + n.z * n.z), 2.0 * (n.x * n.y - n.z * n.w), 2.0 * (n.x * n.z + n.y * n.w), 0.0);
  walls[k].r1 = vec4f(2.0 * (n.x * n.y + n.z * n.w), 1.0 - 2.0 * (n.x * n.x + n.z * n.z), 2.0 * (n.y * n.z - n.x * n.w), 0.0);
  walls[k].r2 = vec4f(2.0 * (n.x * n.z - n.y * n.w), 2.0 * (n.y * n.z + n.x * n.w), 1.0 - 2.0 * (n.x * n.x + n.y * n.y), 0.0);
}
// The wall's force and moment from the block sums, in block order; then the closing half kick. The invocation after the
// last wall adds the blocks' statistics into the element after the last wall.
@compute @workgroup_size(1)
fn wallClose(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  if (k > P.walls) { return; }
  let stride = 2u * P.walls + 1u;
  if (k == P.walls) {
    var overflow = 0.0; var deepest = 0.0;
    var contacts = 0.0;
    for (var b = 0u; b < P.blocks; b++) {
      let s = sums[b * stride + 2u * P.walls]; overflow += s.x; deepest = max(deepest, s.y);
      for (var j = 0u; j < P.walls; j++) { contacts += sums[b * stride + 2u * j + 1u].w; }
    }
    walls[k].force = vec4f(walls[k].force.x + overflow, deepest, contacts, 0.0);
    return;
  }
  var F = vec3f(0.0); var T = vec3f(0.0); var load = 0.0; var count = 0.0;
  for (var b = 0u; b < P.blocks; b++) {
    let a = sums[b * stride + 2u * k]; let m = sums[b * stride + 2u * k + 1u];
    F = F + a.xyz; load = load + a.w; T = T + m.xyz; count = count + m.w;
  }
  walls[k].force = vec4f(F, load); walls[k].torque = vec4f(T, count);
  kick(k);
}
`;

export interface DemShaderOptions {readonly historySlots:number;readonly bucketSlots:number;readonly rolling:boolean}
/** The five shader modules for a history of K slots, buckets of M grains, with or without rolling histories. */
export function demShaders(options:DemShaderOptions):{integrate:string;sort:string;pairs:string;walls:string;wallStep:string} {
  const defines={PARAMS:DEM_PARAMS.wgsl,WALL:DEM_WALL.wgsl,K:options.historySlots,M:options.bucketSlots,HS:options.rolling?2:1,ROLLING:options.rolling,ROLLING_NOTE:options.rolling?', then (bits of the rolling rotation, 0)':'',
    DEM_BLOCK,DEM_MAX_WALLS,DEM_METER_REMOVED,DEM_METER_FLAGS,DEM_METER_BUCKET_OVERFLOW,DEM_METER_HISTORY_OVERFLOW,DEM_METER_CONTACTS,DEM_METER_OVERLAP};
  const includes={common:COMMON,hash:HASH,contact:CONTACT,history:HISTORY,wall:WALL_STORAGE,wallDistance:WALL_DISTANCE};
  const build=(source:string):string=>preprocessWgsl(source,{defines,includes});
  return {integrate:build(INTEGRATE),sort:build(SORT),pairs:build(PAIRS),walls:build(WALLS),wallStep:build(WALL_STEP)};
}
