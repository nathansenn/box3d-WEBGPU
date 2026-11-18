/**
 * The WGSL of the GPU shallow-water backend (shallow-water-gpu.ts) and the layout of its parameter block.
 *
 * One cell is one invocation. A cell's residual is gathered from its own four faces (each face's flux is evaluated by
 * both cells that share it, from the same inputs, so the two see the same number): nothing is scattered, no two
 * invocations write the same element, and the result does not depend on the order in which invocations run.
 * shallow-water-f32.ts is the same algorithm, operation for operation, in float32 on the CPU.
 */
import {defineStruct} from './layout.ts';
import {preprocessWgsl} from './wgsl.ts';

/** flags of SW_PARAMS. */
export const SW_MANNING=1,SW_SOIL=2,SW_SKIP_Z=4,SW_SOLID=8,SW_COUNT_WET=16,SW_RAIN=32;
/** Slots of the meter (atomic u32): the largest face speeds of the substeps along x and z (float bits), wet cells, flags
 * (1: a depth that is not a number), the face speeds of the measuring pass, the face speeds of the second stages. The first
 * stage's speeds are the ones the float64 solver reports as its Courant number. */
export const SW_METER_RATE_X=0,SW_METER_RATE_Z=1,SW_METER_WET=2,SW_METER_FLAGS=3,SW_METER_MEASURE_X=4,SW_METER_MEASURE_Z=5,SW_METER_SECOND_X=6,SW_METER_SECOND_Z=7,SW_METER_SLOTS=8;
/** In place of an unbounded inflow span (WGSL leaves comparisons with infinity open). */
export const SW_FAR=3e38;

export const SW_PARAMS=defineStruct('Params',{
  nx:'u32',nz:'u32',order:'u32',flags:'u32',
  dx:'f32',dz:'f32',dt:'f32',g:'f32',
  dry:'f32',
  /** Rain depth of this substep, m, and that depth times the rain's horizontal velocity. */
  rain:'f32',rainU:'f32',rainV:'f32',
  /** Friction time of the leading and of the trailing half step, s. */
  leadDt:'f32',trailDt:'f32',viscosity:'f32',pad0:'f32',
  ox:'f32',oz:'f32',pad1:'f32',pad2:'f32',
  /** Per side (xMin, xMax, zMin, zMax): (kind, discharge, depth, level), (span from, span to, width, 0). */
  sides:{array:'vec4f',count:8},
},{usage:'uniform'});

const SOURCE=/* wgsl */`
${'${PARAMS}'}
@group(0) @binding(0) var<uniform> P: Params;
// (h, hu, hv, carry of the depth) per cell: the depth is h + carry, h alone is what the fluxes see; src is the state the residual is taken of. The first stage keeps its
// side flux times dt in the fourth component of what it writes.
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4f>;
// (bed, Manning n, Green-Ampt K or -1 for a solid cell, psi * eta).
@group(0) @binding(3) var<storage, read> fixed: array<vec4f>;
// (infiltrated depth, the first stage's depth increment, volume through the sides, the carry of that sum).
@group(0) @binding(4) var<storage, read_write> aux: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> meter: array<atomic<u32>, 8>;

struct Cell { h: f32, e: f32, u: f32, v: f32 }
struct Face { f0: f32, f1: f32, f2: f32, pl: f32, pr: f32, s: f32 }
struct Res { rh: f32, rn: f32, rt: f32, bf: f32, speed: f32 }
struct Total { rh: f32, rx: f32, rz: f32, bf: f32 }

fn isSolid(c: u32) -> bool { return fixed[c].z < 0.0; }
fn minmod(a: f32, b: f32) -> f32 {
  if (a * b <= 0.0) { return 0.0; }
  if (a > 0.0) { return min(a, b); }
  return max(a, b);
}
// A cell as an axis sees it: depth, level, normal velocity, transverse velocity.
fn cellAt(c: u32, axis: u32) -> Cell {
  let s = src[c];
  var o: Cell;
  o.h = s.x; o.e = s.x + fixed[c].x; o.u = 0.0; o.v = 0.0;
  if (s.x > P.dry) {
    if (axis == 0u) { o.u = s.y / s.x; o.v = s.z / s.x; } else { o.u = s.z / s.x; o.v = s.y / s.x; }
  }
  return o;
}
fn edgeSlope(c: u32, j: u32, count: u32, step: u32, side: u32) -> f32 {
  if (count < 2u) { return 0.0; }
  let solids = (P.flags & ${'${SW_SOLID}'}u) != 0u;
  if (j == 0u && u32(P.sides[2u * side].x) == 1u) {
    let b = c + step;
    if (solids && (isSolid(c) || isSolid(b))) { return 0.0; }
    return minmod(fixed[b].x - fixed[c].x, (src[b].x + fixed[b].x) - (src[c].x + fixed[c].x));
  }
  if (j == count - 1u && u32(P.sides[2u * (side + 1u)].x) == 1u) {
    let a = c - step;
    if (solids && (isSolid(c) || isSolid(a))) { return 0.0; }
    return minmod((src[c].x + fixed[c].x) - (src[a].x + fixed[a].x), fixed[c].x - fixed[a].x);
  }
  return 0.0;
}
// Limited slopes (depth, level, normal velocity, transverse velocity) of a cell along an axis.
fn slopeAt(c: u32, j: u32, count: u32, step: u32, axis: u32) -> vec4f {
  if (P.order < 2u) { return vec4f(0.0); }
  var edge = j == 0u || j == count - 1u;
  if (!edge && (P.flags & ${'${SW_SOLID}'}u) != 0u) { edge = isSolid(c) || isSolid(c - step) || isSolid(c + step); }
  if (edge) { return vec4f(0.0, edgeSlope(c, j, count, step, 2u * axis), 0.0, 0.0); }
  let a = cellAt(c - step, axis); let m = cellAt(c, axis); let b = cellAt(c + step, axis);
  return vec4f(minmod(m.h - a.h, b.h - m.h), minmod(m.e - a.e, b.e - m.e), minmod(m.u - a.u, b.u - m.u), minmod(m.v - a.v, b.v - m.v));
}
// Hydrostatic reconstruction and the HLL flux: mass, normal momentum, transverse momentum, the pressure corrections of
// the two sides, and the largest wave speed.
fn hll(hL: f32, eL: f32, uL: f32, vL: f32, hR: f32, eR: f32, uR: f32, vR: f32) -> Face {
  let g = P.g;
  let bs = max(eL - hL, eR - hR);
  let hl = max(eL - bs, 0.0); let hr = max(eR - bs, 0.0);
  var F: Face;
  F.pl = 0.5 * g * (hL * hL - hl * hl); F.pr = 0.5 * g * (hR * hR - hr * hr);
  F.f0 = 0.0; F.f1 = 0.0; F.f2 = 0.0; F.s = 0.0;
  if (hl <= 0.0 && hr <= 0.0) { return F; }
  let cl = sqrt(g * hl); let cr = sqrt(g * hr);
  var sL: f32; var sR: f32;
  if (hl <= 0.0) { sL = uR - 2.0 * cr; sR = uR + cr; }
  else if (hr <= 0.0) { sL = uL - cl; sR = uL + 2.0 * cl; }
  else { sL = min(uL - cl, uR - cr); sR = max(uL + cl, uR + cr); }
  let qL = hl * uL; let qR = hr * uR;
  let fL = qL * uL + 0.5 * g * hl * hl; let fR = qR * uR + 0.5 * g * hr * hr;
  if (sL >= 0.0) { F.f0 = qL; F.f1 = fL; }
  else if (sR <= 0.0) { F.f0 = qR; F.f1 = fR; }
  else {
    let k = 1.0 / (sR - sL);
    F.f0 = (sR * qL - sL * qR + sL * sR * (hr - hl)) * k;
    F.f1 = (sR * fL - sL * fR + sL * sR * (qR - qL)) * k;
  }
  if (F.f0 >= 0.0) { F.f2 = F.f0 * vL; } else { F.f2 = F.f0 * vR; }
  F.s = max(-sL, sR);
  return F;
}
fn interior(a: Cell, sa: vec4f, b: Cell, sb: vec4f) -> Face {
  let hL = a.h + 0.5 * sa.x; let hR = b.h - 0.5 * sb.x;
  var uL = 0.0; var vL = 0.0; var uR = 0.0; var vR = 0.0;
  if (hL > P.dry) { uL = a.u + 0.5 * sa.z; vL = a.v + 0.5 * sa.w; }
  if (hR > P.dry) { uR = b.u - 0.5 * sb.z; vR = b.v - 0.5 * sb.w; }
  return hll(hL, a.e + 0.5 * sa.y, uL, vL, hR, b.e - 0.5 * sb.y, uR, vR);
}
// The face between cell m and the outside: a side of the domain (side 0..3) or a solid cell (side -1). sgn -1: the
// outside lies at the lower coordinate.
fn boundaryFace(R: ptr<function, Res>, m: Cell, sm: vec4f, sgn: f32, side: i32, c: u32, axis: u32, k: f32) {
  let hi = m.h + sgn * 0.5 * sm.x; let ei = m.e + sgn * 0.5 * sm.y;
  var ui = 0.0; var vi = 0.0;
  if (hi > P.dry) { ui = sgn * (m.u + sgn * 0.5 * sm.z); vi = m.v + sgn * 0.5 * sm.w; }
  var kind = 0u; var A = vec4f(0.0); var B = vec4f(0.0);
  if (side >= 0) { A = P.sides[2 * side]; B = P.sides[2 * side + 1]; kind = u32(A.x); }
  if (kind == 2u) {
    var t: f32;
    if (axis == 0u) { t = P.oz + (f32(c / P.nx) + 0.5) * P.dz; } else { t = P.ox + (f32(c % P.nx) + 0.5) * P.dx; }
    if (t < B.x || t > B.y) { kind = 0u; }
  }
  var width: f32;
  if (kind == 2u) { width = B.z; } else if (axis == 0u) { width = P.dz * f32(P.nz); } else { width = P.dx * f32(P.nx); }
  var gh = hi; var ge = ei; var gu = ui; var gv = vi;
  let bed = ei - hi;
  if (kind == 0u) { gu = -ui; }
  else if (kind == 2u) {
    let q = A.y / width;
    if (A.z > 0.0) { gh = A.z; ge = bed + A.z; gu = -q / A.z; gv = 0.0; }
    else if (q <= 0.0) { gu = 0.0; gv = 0.0; }
    else {
      // The outgoing Riemann invariant fixes the depth outside: q / hg - 2 sqrt(g hg) = -u - 2 sqrt(g h), by bisection.
      let goal = -ui - 2.0 * sqrt(P.g * max(hi, 0.0));
      var lo = 1e-12; var up = max(hi, 1e-6);
      for (var it = 0; it < 64; it++) {
        if (q / up - 2.0 * sqrt(P.g * up) - goal > 0.0 && up < 1e6) { up = up * 2.0; } else { break; }
      }
      for (var it = 0; it < 48; it++) {
        let mid = 0.5 * (lo + up);
        if (q / mid - 2.0 * sqrt(P.g * mid) - goal > 0.0) { lo = mid; } else { up = mid; }
      }
      let hg = 0.5 * (lo + up);
      gh = hg; ge = bed + hg; gu = -q / hg; gv = 0.0;
    }
  } else if (kind == 3u) {
    let cc = sqrt(P.g * max(hi, 0.0));
    if (!(hi > P.dry && ui >= cc)) {
      let hg = max(0.0, A.w - bed); let cg = sqrt(P.g * hg);
      gh = hg; ge = bed + hg; gv = vi;
      if (hg > 0.0) { gu = ui + 2.0 * (cc - cg); } else { gu = 0.0; }
    }
  }
  var F = hll(hi, ei, ui, vi, gh, ge, gu, gv);
  if (kind == 2u) { F.f0 = -A.y / width; F.f2 = 0.0; }
  (*R).rh -= F.f0 * k; (*R).rn -= sgn * (F.f1 + F.pl) * k; (*R).rt -= F.f2 * k;
  if (side >= 0) { if (axis == 0u) { (*R).bf -= F.f0 * P.dz; } else { (*R).bf -= F.f0 * P.dx; } }
  (*R).speed = max((*R).speed, F.s);
}
fn axisResidual(c: u32, j: u32, count: u32, step: u32, axis: u32, d: f32) -> Res {
  var R: Res;
  R.rh = 0.0; R.rn = 0.0; R.rt = 0.0; R.bf = 0.0; R.speed = 0.0;
  let solids = (P.flags & ${'${SW_SOLID}'}u) != 0u;
  let k = 1.0 / d;
  let m = cellAt(c, axis); let sm = slopeAt(c, j, count, step, axis);
  // The centred bed term that keeps the second-order scheme well-balanced.
  if (P.order >= 2u && m.h > 0.0) { R.rn += (P.g / d) * m.h * (sm.x - sm.y); }
  if (j == 0u) { boundaryFace(&R, m, sm, -1.0, i32(2u * axis), c, axis, k); }
  else if (solids && isSolid(c - step)) { boundaryFace(&R, m, sm, -1.0, -1, c, axis, k); }
  else {
    let F = interior(cellAt(c - step, axis), slopeAt(c - step, j - 1u, count, step, axis), m, sm);
    R.rh += F.f0 * k; R.rn += (F.f1 + F.pr) * k; R.rt += F.f2 * k; R.speed = max(R.speed, F.s);
  }
  if (j == count - 1u) { boundaryFace(&R, m, sm, 1.0, i32(2u * axis + 1u), c, axis, k); }
  else if (solids && isSolid(c + step)) { boundaryFace(&R, m, sm, 1.0, -1, c, axis, k); }
  else {
    let F = interior(m, sm, cellAt(c + step, axis), slopeAt(c + step, j + 1u, count, step, axis));
    R.rh -= F.f0 * k; R.rn -= (F.f1 + F.pl) * k; R.rt -= F.f2 * k; R.speed = max(R.speed, F.s);
  }
  return R;
}
// dU/dt of cell (i, k) of src; the face speeds go to the meter slots base (x) and base + 1 (z).
fn residual(i: u32, k: u32, c: u32, base: u32) -> Total {
  var T: Total;
  let X = axisResidual(c, i, P.nx, 1u, 0u, P.dx);
  T.rh = X.rh; T.rx = X.rn; T.rz = X.rt; T.bf = X.bf;
  if (X.speed > 0.0) { atomicMax(&meter[base], bitcast<u32>(X.speed)); }
  if ((P.flags & ${'${SW_SKIP_Z}'}u) == 0u) {
    let Z = axisResidual(c, k, P.nz, P.nx, 1u, P.dz);
    T.rh += Z.rh; T.rz += Z.rn; T.rx += Z.rt; T.bf += Z.bf;
    if (Z.speed > 0.0) { atomicMax(&meter[base + 1u], bitcast<u32>(Z.speed)); }
  }
  return T;
}
// Bed friction over dt by backward Euler on |q| (Manning and the laminar film).
fn friction(q: vec2f, d: f32, m: f32, dt: f32) -> vec2f {
  let laminar = 3.0 * P.viscosity * dt;
  if (d <= P.dry || !(m > 0.0 || laminar > 0.0)) { return q; }
  let mag = sqrt(q.x * q.x + q.y * q.y);
  if (mag == 0.0) { return q; }
  let a = 1.0 + laminar / (d * d);
  let b = dt * P.g * m * m / (d * d * pow(d, 1.0 / 3.0));
  return q * (2.0 / (a + sqrt(a * a + 4.0 * b * mag)));
}
// ln(1 + t), by its series where float32 would lose the small t.
fn log1p(t: f32) -> f32 {
  if (abs(t) < 0.03) { return t * (1.0 - t * (0.5 - t * (1.0 / 3.0 - t * (0.25 - t * 0.2)))); }
  return log(1.0 + t);
}
// Depth infiltrated over dt by Green-Ampt from the cumulative depth F with water standing: the root x of
// x - S ln(1 + x / (F + S)) = K dt, capped by the water there is.
fn greenAmpt(F: f32, available: f32, K: f32, S: f32, dt: f32) -> f32 {
  let kdt = K * dt;
  if (available <= kdt) { return available; }
  if (!(S > 0.0)) { return min(available, kdt); }
  let fs = F + S;
  if (available - S * log1p(available / fs) - kdt <= 0.0) { return available; }
  var lo = kdt; var up = available; var x = up;
  for (var it = 0; it < 40; it++) {
    let gx = x - S * log1p(x / fs) - kdt;
    if (gx > 0.0) { up = x; } else { lo = x; }
    let dg = (F + x) / (fs + x);
    var next = x - gx / max(dg, 1e-30);
    if (!(next > lo && next < up)) { next = 0.5 * (lo + up); }
    let done = abs(next - x) <= 1e-7 * abs(x);
    x = next;
    if (done) { break; }
  }
  return clamp(x, 0.0, available);
}

// h + inc with the carry: (the new depth, the new carry). What the rounding of the sum drops goes to the carry and is
// added later, so the volume sum(h + carry) changes only by the rounding of the increments themselves. A depth that
// would go below zero is zero and the shortfall stays in the carry (a debt the next water to arrive pays).
fn settle(h0: f32, carry: f32, inc: f32) -> vec2f {
  let y = inc + carry; let t = h0 + y;
  var c = y - (t - h0); var h = t;
  if (h < 0.0) { c = c + h; h = 0.0; }
  return vec2f(h, c);
}

// The largest face speeds of src, for choosing the substep.
@compute @workgroup_size(8, 8)
fn measure(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.nx || id.y >= P.nz) { return; }
  let c = id.x + P.nx * id.y;
  if (isSolid(c)) { return; }
  let T = residual(id.x, id.y, c, ${'${SW_METER_MEASURE_X}'}u);
}
// Half a step of friction on dst, in place.
@compute @workgroup_size(8, 8)
fn lead(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.nx || id.y >= P.nz) { return; }
  let c = id.x + P.nx * id.y;
  if (isSolid(c)) { return; }
  let s = dst[c];
  let q = friction(s.yz, s.x, fixed[c].y, P.leadDt);
  dst[c] = vec4f(s.x, q.x, q.y, s.w);
}
// First stage: dst = src + dt R(src).
@compute @workgroup_size(8, 8)
fn stage(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.nx || id.y >= P.nz) { return; }
  let c = id.x + P.nx * id.y;
  let s = src[c];
  if (isSolid(c)) { dst[c] = s; return; }
  let T = residual(id.x, id.y, c, ${'${SW_METER_RATE_X}'}u);
  let d1 = P.dt * T.rh;
  var h = s.x + d1; var qx = s.y + P.dt * T.rx; var qz = s.z + P.dt * T.rz;
  if (h <= P.dry) { h = max(h, 0.0); qx = 0.0; qz = 0.0; }
  var a = aux[c]; a.y = d1; aux[c] = a;
  dst[c] = vec4f(h, qx, qz, T.bf * P.dt);
}
// Second stage (dst holds the state before the step, src the first stage), then rain, infiltration and friction.
@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.nx || id.y >= P.nz) { return; }
  let c = id.x + P.nx * id.y;
  if (isSolid(c)) { return; }
  let s0 = dst[c]; let s1 = src[c];
  var a = aux[c];
  var qx = s1.y; var qz = s1.z; var through = s1.w; var grow = a.y;
  if (P.order >= 2u) {
    let T = residual(id.x, id.y, c, ${'${SW_METER_SECOND_X}'}u);
    grow = 0.5 * (a.y + P.dt * T.rh); qx = 0.5 * (s0.y + s1.y + P.dt * T.rx); qz = 0.5 * (s0.z + s1.z + P.dt * T.rz);
    through = 0.5 * s1.w + 0.5 * (T.bf * P.dt);
  }
  var hc = settle(s0.x, s0.w, grow);
  if (hc.x <= P.dry) { qx = 0.0; qz = 0.0; }
  // The volume through the sides, summed with a carry (many small terms into a large sum).
  if (through != 0.0 || a.w != 0.0) { let y = through + a.w; let t = a.z + y; a.w = y - (t - a.z); a.z = t; }
  if ((P.flags & ${'${SW_RAIN}'}u) != 0u) { hc = settle(hc.x, hc.y, P.rain); qx += P.rainU; qz += P.rainV; }
  if ((P.flags & ${'${SW_SOIL}'}u) != 0u) {
    let K = fixed[c].z;
    if (K > 0.0 && hc.x > 0.0) {
      let before = hc.x;
      let taken = greenAmpt(a.x, before, K, fixed[c].w, P.dt);
      if (taken > 0.0) {
        hc = settle(before, hc.y, -taken);
        if (hc.x > P.dry) { let r = hc.x / before; qx *= r; qz *= r; } else { qx = 0.0; qz = 0.0; }
        a.x += taken;
      }
    }
  }
  let h = hc.x;
  if ((P.flags & ${'${SW_MANNING}'}u) != 0u) { let q = friction(vec2f(qx, qz), h, fixed[c].y, P.trailDt); qx = q.x; qz = q.y; }
  dst[c] = vec4f(h, qx, qz, hc.y);
  aux[c] = a;
  if ((P.flags & ${'${SW_COUNT_WET}'}u) != 0u && h > P.dry) { atomicAdd(&meter[${'${SW_METER_WET}'}u], 1u); }
  if (!(h >= 0.0)) { atomicOr(&meter[${'${SW_METER_FLAGS}'}u], 1u); }
}
`;

/** The shader, with the parameter struct and the constants written in. */
export const SHALLOW_WATER_WGSL=preprocessWgsl(SOURCE,{defines:{PARAMS:SW_PARAMS.wgsl,SW_SOLID,SW_SKIP_Z,SW_SOIL,SW_RAIN,SW_MANNING,SW_COUNT_WET,SW_METER_RATE_X,SW_METER_MEASURE_X,SW_METER_SECOND_X,SW_METER_WET,SW_METER_FLAGS}});
export const SHALLOW_WATER_ENTRY_POINTS=['measure','lead','stage','finish'] as const;
