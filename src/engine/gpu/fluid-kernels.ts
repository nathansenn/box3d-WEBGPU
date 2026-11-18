/**
 * The compute kernels of the GPU fluid backend (fluid-gpu.ts), written twice: in WGSL, and in TypeScript in float32
 * (every operation rounded with Math.fround) for the CPU reference (fluid-f32.ts). Both read the same parameter block
 * and the same three arrays:
 *   F  float32 data: the face velocities and every work array, in regions (fluid-program.ts)
 *   I  uint32 indices: the face lists, ghost pairs, gradient faces, cell neighbours (an i32 stored as its bits)
 *   S  float32 scalars of the solves (dot products, step lengths, tolerances, flags, iteration counts)
 * One kernel invocation writes only its own elements. Sums are reduced in a fixed tree (256 per workgroup, halving)
 * and the workgroups' partial sums are added in order by one invocation, so a result does not depend on scheduling.
 */
import {defineStruct} from './layout.ts';

/** u0 is the number of invocations; the other fields' meaning is per kernel (see each kernel). */
export const FLUID_PASS=defineStruct('Pass',{
  u0:'u32',u1:'u32',u2:'u32',u3:'u32',u4:'u32',u5:'u32',u6:'u32',u7:'u32',u8:'u32',u9:'u32',u10:'u32',u11:'u32',u12:'u32',u13:'u32',u14:'u32',u15:'u32',
  f0:'f32',f1:'f32',f2:'f32',f3:'f32',f4:'f32',f5:'f32',f6:'f32',f7:'f32',
},{usage:'uniform'});

export const KERNELS=['copyPairs','ghosts','setFixed','advect','gradient','predict','listCopy','scatter','divergence','partial','finish','shift','mulConst','mulArray','copyRegion','applyA','scalar','cgUpdate','cgDirection','vUpdate','vDirection','viscB','viscR','viscQ','correct','addRegion','oConstrain','oScatter','oZero','oImpulse','oMomentum','segSum'] as const;
export type KernelName=typeof KERNELS[number];
/** Invocations per workgroup: 256 for the reductions, 64 for the rest. */
export const groupSize=(k:KernelName):number=>k==='partial'||k==='segSum'?256:64;
/** scalar ops. */
export const SCALAR_PSTART=0,SCALAR_VSTART=1,SCALAR_ALPHA=2,SCALAR_PCHECK=3,SCALAR_VCHECK=4,SCALAR_BETA=5,SCALAR_PEND=6;
/** Slots of a solve, from its base: rz, the dot of the direction with the operator, alpha, beta, max |r|, tolerance, done
 * (0 running, 1 converged, 2 iteration limit, 3 breakdown), iterations, max |b|, the new rz. */
export const SLOT_RZ=0,SLOT_DOT=1,SLOT_ALPHA=2,SLOT_BETA=3,SLOT_RMAX=4,SLOT_TOL=5,SLOT_DONE=6,SLOT_IT=7,SLOT_BMAX=8,SLOT_RZNEW=9,SOLVE_SLOTS=12;

export const FLUID_WGSL=/* wgsl */`
${FLUID_PASS.wgsl}
@group(0) @binding(0) var<uniform> P: Pass;
@group(0) @binding(1) var<storage, read_write> F: array<f32>;
@group(0) @binding(2) var<storage, read> I: array<u32>;
@group(0) @binding(3) var<storage, read_write> S: array<f32>;
var<workgroup> red: array<f32, 256>;

fn at(g: vec3u, n: vec3u) -> u32 { return g.x + g.y * n.x * 64u; }
fn es(k: u32) -> u32 { if (k == 0u) { return P.u5; } if (k == 1u) { return P.u6; } return P.u7; }
// The six neighbours of padded index f in region b along the stencil strides e0, e1, e2, summed in a fixed order.
fn six(b: u32, f: u32, e0: u32, e1: u32, e2: u32) -> f32 {
  return F[b + f + e0] + F[b + f - e0] + F[b + f + e1] + F[b + f - e1] + F[b + f + e2] + F[b + f - e2];
}

// u1 dst base, u2 src base, u3 pairs: F[dst + I[2i]] = F[src + I[2i + 1]].
@compute @workgroup_size(64) fn copyPairs(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + I[P.u3 + 2u * i]] = F[P.u2 + I[P.u3 + 2u * i + 1u]];
}
// u1 region, u2 pairs, u3 a, u4 b, u5 homogeneous: x[dst] = a x[src] (+ b).
@compute @workgroup_size(64) fn ghosts(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  var v = F[P.u3 + i] * F[P.u1 + I[P.u2 + 2u * i + 1u]];
  if (P.u5 == 0u) { v = v + F[P.u4 + i]; }
  F[P.u1 + I[P.u2 + 2u * i]] = v;
}
// u1 region, u2 list, u3 values.
@compute @workgroup_size(64) fn setFixed(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + I[P.u2 + i]] = F[P.u3 + i];
}
// u1 list, u2 component, u3 velocity base, u4 out, u5 padded size, u6..u8 strides, u9 upwind; f0 1/h.
@compute @workgroup_size(64) fn advect(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let c = P.u2;
  var e = array<u32, 3>(P.u6, P.u7, P.u8);
  let X = P.u3 + c * P.u5; let sc = e[c]; let ih = P.f0;
  let xf = F[X + f]; let xp = F[X + f + sc]; let xm = F[X + f - sc];
  let up = 0.5 * (xf + xp); let dn = 0.5 * (xm + xf);
  var a: f32;
  if (P.u9 != 0u) { a = (up * select(xp, xf, up > 0.0) - dn * select(xf, xm, dn > 0.0)) * ih; }
  else { a = (up * up - dn * dn) * ih; }
  for (var d = 0u; d < 3u; d++) {
    if (d == c || e[d] == 0u) { continue; }
    let sd = e[d]; let Y = P.u3 + d * P.u5;
    let vt = 0.5 * (F[Y + f + sd] + F[Y + f + sd - sc]); let vb = 0.5 * (F[Y + f] + F[Y + f - sc]);
    let xs = F[X + f + sd]; let xn = F[X + f - sd];
    if (P.u9 != 0u) { a = a + (vt * select(xs, xf, vt > 0.0) - vb * select(xf, xn, vb > 0.0)) * ih; }
    else { a = a + (vt * 0.5 * (xf + xs) - vb * 0.5 * (xn + xf)) * ih; }
  }
  F[P.u4 + f] = a;
}
// u1 triples (face, low cell, high cell), u2 out base, u3 pressure, u4 low weights, u5 high weights.
@compute @workgroup_size(64) fn gradient(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let t = P.u1 + 3u * i;
  F[P.u2 + I[t]] = F[P.u5 + i] * F[P.u3 + I[t + 2u]] - F[P.u4 + i] * F[P.u3 + I[t + 1u]];
}
// u1 list, u2 x, u3 adv, u4 prev, u5 grad p, u6 rhs, u7 flags (1 advect, 2 Adams-Bashforth, 4 explicit viscosity), u8..u10 strides;
// f0 dt, f1 acceleration, f2 1/rho, f3 dt (1 - theta) nu, f4 1/h^2.
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let x = F[P.u2 + f];
  var r = x + P.f0 * (P.f1 - F[P.u5 + f] * P.f2);
  if ((P.u7 & 1u) != 0u) {
    let a = F[P.u3 + f];
    var t = a;
    if ((P.u7 & 2u) != 0u) { t = 1.5 * a - 0.5 * F[P.u4 + f]; }
    r = r - P.f0 * t;
    F[P.u4 + f] = a;
  }
  if ((P.u7 & 4u) != 0u) {
    let lap = (F[P.u2 + f + P.u8] + F[P.u2 + f - P.u8] + F[P.u2 + f + P.u9] + F[P.u2 + f - P.u9] + F[P.u2 + f + P.u10] + F[P.u2 + f - P.u10] - 6.0 * x) * P.f4;
    r = r + P.f3 * lap;
  }
  F[P.u6 + f] = r;
}
// u1 list, u2 dst base, u3 src base: F[dst + f] = F[src + f].
@compute @workgroup_size(64) fn listCopy(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; F[P.u2 + f] = F[P.u3 + f];
}
// u1 list, u2 dst base, u3 src: F[dst + I[i]] = F[src + i].
@compute @workgroup_size(64) fn scatter(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u2 + I[P.u1 + i]] = F[P.u3 + i];
}
// u1 cell pads, u2 velocity base, u3 padded size, u4 y stride, u5 z stride, u6 out; f0 scale, f1 1/h.
@compute @workgroup_size(64) fn divergence(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let U = P.u2; let V = P.u2 + P.u3; let W = P.u2 + 2u * P.u3;
  let s = F[U + f + 1u] - F[U + f] + F[V + f + P.u4] - F[V + f] + F[W + f + P.u5] - F[W + f];
  F[P.u6 + i] = (P.f0 * s) * P.f1;
}
// Per workgroup of 256: u1 mode (0 sum x, 1 sum x y, 2 max |x|, 3 sum x[list] y, 4 max |x[list]|), u2 x, u3 y, u4 list, u5 out.
@compute @workgroup_size(256) fn partial(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) w: vec3u, @builtin(num_workgroups) n: vec3u) {
  let group = w.x + w.y * n.x; let i = group * 256u + l; let m = P.u1;
  var v = 0.0;
  if (i < P.u0) {
    if (m == 0u) { v = F[P.u2 + i]; }
    else if (m == 1u) { v = F[P.u2 + i] * F[P.u3 + i]; }
    else if (m == 2u) { v = abs(F[P.u2 + i]); }
    else if (m == 3u) { v = F[P.u2 + I[P.u4 + i]] * F[P.u3 + i]; }
    else { v = abs(F[P.u2 + I[P.u4 + i]]); }
  }
  red[l] = v;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (l < s) { if (m == 2u || m == 4u) { red[l] = max(red[l], red[l + s]); } else { red[l] = red[l] + red[l + s]; } }
    workgroupBarrier();
  }
  if (l == 0u && group * 256u < P.u0) { F[P.u5 + group] = red[0]; }
}
// One invocation: u0 partial count, u1 partials, u2 slot, u3 op (0 sum, 1 max).
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) g: vec3u) {
  if (g.x != 0u || g.y != 0u) { return; }
  var a = 0.0;
  for (var w = 0u; w < P.u0; w++) { let v = F[P.u1 + w]; if (P.u3 == 1u) { a = max(a, v); } else { a = a + v; } }
  S[P.u2] = a;
}
// u1 x, u2 slot: x -= S[slot] / n.
@compute @workgroup_size(64) fn shift(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let m = S[P.u2] / f32(P.u0); F[P.u1 + i] = F[P.u1 + i] - m;
}
// u1 dst, u2 src; f0: dst = src f0.
@compute @workgroup_size(64) fn mulConst(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + i] = F[P.u2 + i] * P.f0;
}
// u1 dst, u2 src, u3 factors: dst = src factor.
@compute @workgroup_size(64) fn mulArray(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + i] = F[P.u2 + i] * F[P.u3 + i];
}
// u1 dst, u2 src.
@compute @workgroup_size(64) fn copyRegion(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + i] = F[P.u2 + i];
}
// u1 x, u2 out, u3 diagonal, u4 neighbours (six per cell, -1 none).
@compute @workgroup_size(64) fn applyA(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  var s = F[P.u3 + i] * F[P.u1 + i];
  for (var q = 0u; q < 6u; q++) { let nb = bitcast<i32>(I[P.u4 + 6u * i + q]); if (nb >= 0) { s = s - F[P.u1 + u32(nb)]; } }
  F[P.u2 + i] = s;
}
// One invocation: u0 op, u1 solve base, u2..u5 other slots; f0, f1 constants.
@compute @workgroup_size(64) fn scalar(@builtin(global_invocation_id) g: vec3u) {
  if (g.x != 0u || g.y != 0u) { return; }
  let B = P.u1; let op = P.u0;
  if (op == ${SCALAR_PSTART}u) {
    let v = max(max(max(S[P.u2], S[P.u3]), S[P.u4]), P.f0);
    S[P.u5] = v;
    let tol = P.f1 * max(v, 1e-30);
    S[B + ${SLOT_TOL}u] = tol;
    S[B + ${SLOT_DONE}u] = select(1.0, 0.0, S[B + ${SLOT_RMAX}u] > tol);
    S[B + ${SLOT_IT}u] = 0.0;
  } else if (op == ${SCALAR_VSTART}u) {
    S[B + ${SLOT_TOL}u] = max(P.f0 * S[B + ${SLOT_RMAX}u], P.f1 * S[B + ${SLOT_BMAX}u]); S[B + ${SLOT_DONE}u] = 0.0; S[B + ${SLOT_IT}u] = 0.0;
  } else if (op == ${SCALAR_ALPHA}u) {
    if (S[B + ${SLOT_DONE}u] == 0.0) {
      let d = S[B + ${SLOT_DOT}u];
      if (!(d > 0.0)) { S[B + ${SLOT_DONE}u] = 3.0; S[B + ${SLOT_ALPHA}u] = 0.0; } else { S[B + ${SLOT_ALPHA}u] = S[B + ${SLOT_RZ}u] / d; }
    } else { S[B + ${SLOT_ALPHA}u] = 0.0; }
  } else if (op == ${SCALAR_PCHECK}u) {
    if (S[B + ${SLOT_DONE}u] == 0.0 && S[B + ${SLOT_RMAX}u] <= S[B + ${SLOT_TOL}u]) { S[B + ${SLOT_DONE}u] = 1.0; S[B + ${SLOT_IT}u] = S[B + ${SLOT_IT}u] + 1.0; }
  } else if (op == ${SCALAR_VCHECK}u) {
    if (S[B + ${SLOT_DONE}u] == 0.0 && S[B + ${SLOT_RMAX}u] <= S[B + ${SLOT_TOL}u]) { S[B + ${SLOT_DONE}u] = 1.0; }
  } else if (op == ${SCALAR_BETA}u) {
    if (S[B + ${SLOT_DONE}u] == 0.0) {
      S[B + ${SLOT_BETA}u] = S[B + ${SLOT_RZNEW}u] / S[B + ${SLOT_RZ}u]; S[B + ${SLOT_RZ}u] = S[B + ${SLOT_RZNEW}u];
      S[B + ${SLOT_IT}u] = S[B + ${SLOT_IT}u] + 1.0;
      if (S[B + ${SLOT_IT}u] >= P.f0) { S[B + ${SLOT_DONE}u] = 2.0; }
    } else { S[B + ${SLOT_BETA}u] = 0.0; }
  } else if (op == ${SCALAR_PEND}u) {
    S[P.u2] = select(0.0, 1.0, S[B + ${SLOT_RMAX}u] > S[B + ${SLOT_TOL}u]);
  }
}
// u1 phi, u2 d, u3 r, u4 Ad, u5 alpha slot.
@compute @workgroup_size(64) fn cgUpdate(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let a = S[P.u5];
  F[P.u1 + i] = F[P.u1 + i] + a * F[P.u2 + i]; F[P.u3 + i] = F[P.u3 + i] - a * F[P.u4 + i];
}
// u1 d, u2 z, u3 beta slot: d = z + beta d.
@compute @workgroup_size(64) fn cgDirection(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + i] = F[P.u2 + i] + S[P.u3] * F[P.u1 + i];
}
// u1 list, u2 X, u3 D, u4 r, u5 q, u6 z, u7 step slot; f0 1 / diagonal.
@compute @workgroup_size(64) fn vUpdate(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let a = S[P.u7];
  F[P.u2 + f] = F[P.u2 + f] + a * F[P.u3 + f];
  let r = F[P.u4 + i] - a * F[P.u5 + i];
  F[P.u4 + i] = r; F[P.u6 + i] = r * P.f0;
}
// u1 list, u2 D, u3 z, u4 beta slot: D[f] = z + beta D[f].
@compute @workgroup_size(64) fn vDirection(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; F[P.u2 + f] = F[P.u3 + i] + S[P.u4] * F[P.u2 + f];
}
// u1 list, u2 X, u3 rhs, u4 out, u5..u7 strides; f0 k: b = rhs + k (six(X) - 6 X).
@compute @workgroup_size(64) fn viscB(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i];
  F[P.u4 + i] = F[P.u3 + f] + P.f0 * (six(P.u2, f, P.u5, P.u6, P.u7) - 6.0 * F[P.u2 + f]);
}
// u1 list, u2 X, u3 b, u4 out, u5..u7 strides; f0 k: r = b - (X - k (six(X) - 6 X)).
@compute @workgroup_size(64) fn viscR(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let x = F[P.u2 + f];
  F[P.u4 + i] = F[P.u3 + i] - (x - P.f0 * (six(P.u2, f, P.u5, P.u6, P.u7) - 6.0 * x));
}
// u1 list, u2 D, u3 out, u5..u7 strides; f0 k: q = D - k (six(D) - 6 D).
@compute @workgroup_size(64) fn viscQ(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let f = I[P.u1 + i]; let x = F[P.u2 + f];
  F[P.u3 + i] = x - P.f0 * (six(P.u2, f, P.u5, P.u6, P.u7) - 6.0 * x);
}
// u1 triples, u2 velocity component base, u3 phi, u4 low weights, u5 high weights; f0 dt / rho.
@compute @workgroup_size(64) fn correct(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  let t = P.u1 + 3u * i; let f = I[t];
  F[P.u2 + f] = F[P.u2 + f] - P.f0 * (F[P.u5 + i] * F[P.u3 + I[t + 2u]] - F[P.u4 + i] * F[P.u3 + I[t + 1u]]);
}
// u1 x, u2 y: x += y.
@compute @workgroup_size(64) fn addRegion(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let i = at(g, n); if (i >= P.u0) { return; }
  F[P.u1 + i] = F[P.u1 + i] + F[P.u2 + i];
}
// ---- obstacles. A band entry e (fluid-program.ts) has four words at u3 + 4e (face, out face, position in the component's
// unknown list, mode) and six floats at obf + 6e (target, weight, mass rho alpha dV, arm r x e_c). The entries of
// component c are I[u1 + 2c + 1] from I[u1 + 2c]; the dispatches cover the capacity and the rest return.
fn entry(g: vec3u, n: vec3u) -> i32 {
  let i = at(g, n); let c = P.u2;
  if (i >= I[P.u1 + 2u * c + 1u]) { return -1; }
  return i32(I[P.u1 + 2u * c] + i);
}
// u4 source (component region), u5 predictor (component region), u6 obf, u7 constrained values, u8 free values.
@compute @workgroup_size(64) fn oConstrain(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = entry(g, n); if (k < 0) { return; }
  let e = u32(k); let w = P.u3 + 4u * e;
  if (I[w + 3u] == 0u) { return; }
  let t = F[P.u6 + 6u * e];
  F[P.u7 + e] = t + F[P.u6 + 6u * e + 1u] * (F[P.u4 + I[w + 1u]] - t);
  F[P.u8 + e] = F[P.u5 + I[w]];
}
// u4 destination (component region), u5 constrained values.
@compute @workgroup_size(64) fn oScatter(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = entry(g, n); if (k < 0) { return; }
  let e = u32(k); let w = P.u3 + 4u * e;
  if (I[w + 3u] != 0u) { F[P.u4 + I[w]] = F[P.u5 + e]; }
}
// u4 base, u5 1: at the face, 0: at the position in the unknown list.
@compute @workgroup_size(64) fn oZero(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = entry(g, n); if (k < 0) { return; }
  let e = u32(k); let w = P.u3 + 4u * e;
  if (I[w + 3u] != 0u) { F[P.u4 + I[w + select(2u, 0u, P.u5 == 1u)]] = 0.0; }
}
// u4 velocity (component region), u5 free values, u6 out, u7 implicit, u8..u10 strides; f0 rho dV, f1 theta dt nu, f2 1/h^2.
// The constraint impulse rho dV (u - u_free) of a constrained face, 0 for a free one.
@compute @workgroup_size(64) fn oImpulse(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = entry(g, n); if (k < 0) { return; }
  let e = u32(k); let w = P.u3 + 4u * e;
  if (I[w + 3u] == 0u) { F[P.u6 + e] = 0.0; return; }
  let f = I[w]; let x = F[P.u4 + f];
  var free = F[P.u5 + e];
  if (P.u7 != 0u) { free = free + P.f1 * ((six(P.u4, f, P.u8, P.u9, P.u10) - 6.0 * x) * P.f2); }
  F[P.u6 + e] = P.f0 * (x - free);
}
// u4 velocity (component region), u5 obf, u6 out: the momentum rho alpha dV u of the face.
@compute @workgroup_size(64) fn oMomentum(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = entry(g, n); if (k < 0) { return; }
  let e = u32(k);
  F[P.u6 + e] = F[P.u5 + 6u * e + 2u] * F[P.u4 + I[P.u3 + 4u * e]];
}
// One workgroup per (segment, q): u1 segments (start, count), u2 values, u3 obf, u4 first slot. q 0 sums the values, q 1..3
// the values times arm q - 1. Lane l adds entries l, l + 256, ... in order, then the lanes in a fixed tree.
@compute @workgroup_size(256) fn segSum(@builtin(local_invocation_index) l: u32, @builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) n: vec3u) {
  let group = wg.x + wg.y * n.x; let seg = group / 4u; let q = group % 4u;
  var a = 0.0;
  if (group < P.u0) {
    let start = I[P.u1 + 2u * seg]; let count = I[P.u1 + 2u * seg + 1u];
    for (var i = l; i < count; i = i + 256u) {
      let e = start + i; let v = F[P.u2 + e];
      if (q == 0u) { a = a + v; } else { a = a + v * F[P.u3 + 6u * e + 2u + q]; }
    }
  }
  red[l] = a;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (l < s) { red[l] = red[l] + red[l + s]; }
    workgroupBarrier();
  }
  if (l == 0u && group < P.u0) { S[P.u4 + group] = red[0]; }
}
`;

export interface PassValues {u:Uint32Array;f:Float32Array}
const fr=Math.fround;
/** The same kernels on the CPU in float32. `p` holds the block exactly as the GPU reads it. */
export function runKernelF32(k:KernelName,p:PassValues,F:Float32Array,I:Uint32Array,S:Float32Array):void {
  const u=p.u,fv=p.f,n=u[0];
  const six=(b:number,f:number,e0:number,e1:number,e2:number):number=>fr(fr(fr(fr(fr(F[b+f+e0]+F[b+f-e0])+F[b+f+e1])+F[b+f-e1])+F[b+f+e2])+F[b+f-e2]);
  switch(k){
    case 'copyPairs':for(let i=0;i<n;i++)F[u[1]+I[u[3]+2*i]]=F[u[2]+I[u[3]+2*i+1]];return;
    case 'ghosts':for(let i=0;i<n;i++){let v=fr(F[u[3]+i]*F[u[1]+I[u[2]+2*i+1]]);if(u[5]===0)v=fr(v+F[u[4]+i]);F[u[1]+I[u[2]+2*i]]=v;}return;
    case 'setFixed':for(let i=0;i<n;i++)F[u[1]+I[u[2]+i]]=F[u[3]+i];return;
    case 'advect':{
      const c=u[2],e=[u[6],u[7],u[8]],X=u[3]+c*u[5],sc=e[c],ih=fv[0],upwind=u[9]!==0;
      for(let i=0;i<n;i++){
        const f=I[u[1]+i],xf=F[X+f],xp=F[X+f+sc],xm=F[X+f-sc],up=fr(.5*fr(xf+xp)),dn=fr(.5*fr(xm+xf));
        let a=upwind?fr(fr(fr(up*(up>0?xf:xp))-fr(dn*(dn>0?xm:xf)))*ih):fr(fr(fr(up*up)-fr(dn*dn))*ih);
        for(let d=0;d<3;d++){
          if(d===c||e[d]===0)continue;
          const sd=e[d],Y=u[3]+d*u[5],vt=fr(.5*fr(F[Y+f+sd]+F[Y+f+sd-sc])),vb=fr(.5*fr(F[Y+f]+F[Y+f-sc])),xs=F[X+f+sd],xn=F[X+f-sd];
          if(upwind)a=fr(a+fr(fr(fr(vt*(vt>0?xf:xs))-fr(vb*(vb>0?xn:xf)))*ih));
          else a=fr(a+fr(fr(fr(fr(vt*.5)*fr(xf+xs))-fr(fr(vb*.5)*fr(xn+xf)))*ih));
        }
        F[u[4]+f]=a;
      }
      return;
    }
    case 'gradient':for(let i=0;i<n;i++){const t=u[1]+3*i;F[u[2]+I[t]]=fr(fr(F[u[5]+i]*F[u[3]+I[t+2]])-fr(F[u[4]+i]*F[u[3]+I[t+1]]));}return;
    case 'predict':
      for(let i=0;i<n;i++){
        const f=I[u[1]+i],x=F[u[2]+f];
        let r=fr(x+fr(fv[0]*fr(fv[1]-fr(F[u[5]+f]*fv[2]))));
        if(u[7]&1){const a=F[u[3]+f];let t=a;if(u[7]&2)t=fr(fr(1.5*a)-fr(.5*F[u[4]+f]));r=fr(r-fr(fv[0]*t));F[u[4]+f]=a;}
        if(u[7]&4){const lap=fr(fr(six(u[2],f,u[8],u[9],u[10])-fr(6*x))*fv[4]);r=fr(r+fr(fv[3]*lap));}
        F[u[6]+f]=r;
      }
      return;
    case 'listCopy':for(let i=0;i<n;i++){const f=I[u[1]+i];F[u[2]+f]=F[u[3]+f];}return;
    case 'scatter':for(let i=0;i<n;i++)F[u[2]+I[u[1]+i]]=F[u[3]+i];return;
    case 'divergence':{
      const U=u[2],V=u[2]+u[3],W=u[2]+2*u[3];
      for(let i=0;i<n;i++){const f=I[u[1]+i];const s=fr(fr(fr(fr(fr(F[U+f+1]-F[U+f])+F[V+f+u[4]])-F[V+f])+F[W+f+u[5]])-F[W+f]);F[u[6]+i]=fr(fr(fv[0]*s)*fv[1]);}
      return;
    }
    case 'partial':{
      const m=u[1],groups=Math.ceil(n/256),red=new Float32Array(256),isMax=m===2||m===4;
      for(let w=0;w<groups;w++){
        for(let l=0;l<256;l++){
          const i=w*256+l;let v=0;
          if(i<n){if(m===0)v=F[u[2]+i];else if(m===1)v=fr(F[u[2]+i]*F[u[3]+i]);else if(m===2)v=Math.abs(F[u[2]+i]);else if(m===3)v=fr(F[u[2]+I[u[4]+i]]*F[u[3]+i]);else v=Math.abs(F[u[2]+I[u[4]+i]]);}
          red[l]=v;
        }
        for(let s=128;s>0;s>>=1)for(let l=0;l<s;l++)red[l]=isMax?(red[l]>red[l+s]||red[l+s]!==red[l+s]?red[l]:red[l+s]):fr(red[l]+red[l+s]);
        F[u[5]+w]=red[0];
      }
      return;
    }
    case 'finish':{let a=0;for(let w=0;w<n;w++){const v=F[u[1]+w];a=u[3]===1?(a>v||v!==v?a:v):fr(a+v);}S[u[2]]=a;return;}
    case 'shift':{const m=fr(S[u[2]]/n);for(let i=0;i<n;i++)F[u[1]+i]=fr(F[u[1]+i]-m);return;}
    case 'mulConst':for(let i=0;i<n;i++)F[u[1]+i]=fr(F[u[2]+i]*fv[0]);return;
    case 'mulArray':for(let i=0;i<n;i++)F[u[1]+i]=fr(F[u[2]+i]*F[u[3]+i]);return;
    case 'copyRegion':F.copyWithin(u[1],u[2],u[2]+n);return;
    case 'applyA':{
      const N=new Int32Array(I.buffer,I.byteOffset,I.length);
      for(let i=0;i<n;i++){let s=fr(F[u[3]+i]*F[u[1]+i]);for(let q=0;q<6;q++){const nb=N[u[4]+6*i+q];if(nb>=0)s=fr(s-F[u[1]+nb]);}F[u[2]+i]=s;}
      return;
    }
    case 'scalar':{
      const B=u[1],op=u[0];
      if(op===SCALAR_PSTART){const a=S[u[2]],b=S[u[3]],c=S[u[4]];let v=a>b?a:b;v=v>c?v:c;v=v>fv[0]?v:fv[0];S[u[5]]=v;const tol=fr(fv[1]*(v>1e-30?v:fr(1e-30)));S[B+SLOT_TOL]=tol;S[B+SLOT_DONE]=S[B+SLOT_RMAX]>tol?0:1;S[B+SLOT_IT]=0;}
      else if(op===SCALAR_VSTART){const a=fr(fv[0]*S[B+SLOT_RMAX]),b=fr(fv[1]*S[B+SLOT_BMAX]);S[B+SLOT_TOL]=a>b?a:b;S[B+SLOT_DONE]=0;S[B+SLOT_IT]=0;}
      else if(op===SCALAR_ALPHA){if(S[B+SLOT_DONE]===0){const d=S[B+SLOT_DOT];if(!(d>0)){S[B+SLOT_DONE]=3;S[B+SLOT_ALPHA]=0;}else S[B+SLOT_ALPHA]=fr(S[B+SLOT_RZ]/d);}else S[B+SLOT_ALPHA]=0;}
      else if(op===SCALAR_PCHECK){if(S[B+SLOT_DONE]===0&&S[B+SLOT_RMAX]<=S[B+SLOT_TOL]){S[B+SLOT_DONE]=1;S[B+SLOT_IT]+=1;}}
      else if(op===SCALAR_VCHECK){if(S[B+SLOT_DONE]===0&&S[B+SLOT_RMAX]<=S[B+SLOT_TOL])S[B+SLOT_DONE]=1;}
      else if(op===SCALAR_BETA){if(S[B+SLOT_DONE]===0){S[B+SLOT_BETA]=fr(S[B+SLOT_RZNEW]/S[B+SLOT_RZ]);S[B+SLOT_RZ]=S[B+SLOT_RZNEW];S[B+SLOT_IT]+=1;if(S[B+SLOT_IT]>=fv[0])S[B+SLOT_DONE]=2;}else S[B+SLOT_BETA]=0;}
      else if(op===SCALAR_PEND)S[u[2]]=S[B+SLOT_RMAX]>S[B+SLOT_TOL]?1:0;
      return;
    }
    case 'cgUpdate':{const a=S[u[5]];for(let i=0;i<n;i++){F[u[1]+i]=fr(F[u[1]+i]+fr(a*F[u[2]+i]));F[u[3]+i]=fr(F[u[3]+i]-fr(a*F[u[4]+i]));}return;}
    case 'cgDirection':{const b=S[u[3]];for(let i=0;i<n;i++)F[u[1]+i]=fr(F[u[2]+i]+fr(b*F[u[1]+i]));return;}
    case 'vUpdate':{const a=S[u[7]];for(let i=0;i<n;i++){const f=I[u[1]+i];F[u[2]+f]=fr(F[u[2]+f]+fr(a*F[u[3]+f]));const r=fr(F[u[4]+i]-fr(a*F[u[5]+i]));F[u[4]+i]=r;F[u[6]+i]=fr(r*fv[0]);}return;}
    case 'vDirection':{const b=S[u[4]];for(let i=0;i<n;i++){const f=I[u[1]+i];F[u[2]+f]=fr(F[u[3]+i]+fr(b*F[u[2]+f]));}return;}
    case 'viscB':for(let i=0;i<n;i++){const f=I[u[1]+i];F[u[4]+i]=fr(F[u[3]+f]+fr(fv[0]*fr(six(u[2],f,u[5],u[6],u[7])-fr(6*F[u[2]+f]))));}return;
    case 'viscR':for(let i=0;i<n;i++){const f=I[u[1]+i],x=F[u[2]+f];F[u[4]+i]=fr(F[u[3]+i]-fr(x-fr(fv[0]*fr(six(u[2],f,u[5],u[6],u[7])-fr(6*x)))));}return;
    case 'viscQ':for(let i=0;i<n;i++){const f=I[u[1]+i],x=F[u[2]+f];F[u[3]+i]=fr(x-fr(fv[0]*fr(six(u[2],f,u[5],u[6],u[7])-fr(6*x))));}return;
    case 'correct':for(let i=0;i<n;i++){const t=u[1]+3*i,f=I[t];F[u[2]+f]=fr(F[u[2]+f]-fr(fv[0]*fr(fr(F[u[5]+i]*F[u[3]+I[t+2]])-fr(F[u[4]+i]*F[u[3]+I[t+1]]))));}return;
    case 'addRegion':for(let i=0;i<n;i++)F[u[1]+i]=fr(F[u[1]+i]+F[u[2]+i]);return;
    case 'oConstrain':case 'oScatter':case 'oZero':case 'oImpulse':case 'oMomentum':{
      const c=u[2],start=I[u[1]+2*c],count=Math.min(I[u[1]+2*c+1],n);
      for(let i=0;i<count;i++){
        const e=start+i,w=u[3]+4*e,mode=I[w+3],f=I[w];
        if(k==='oConstrain'){if(mode===0)continue;const t=F[u[6]+6*e];F[u[7]+e]=fr(t+fr(F[u[6]+6*e+1]*fr(F[u[4]+I[w+1]]-t)));F[u[8]+e]=F[u[5]+f];}
        else if(k==='oScatter'){if(mode!==0)F[u[4]+f]=F[u[5]+e];}
        else if(k==='oZero'){if(mode!==0)F[u[4]+I[w+(u[5]===1?0:2)]]=0;}
        else if(k==='oImpulse'){
          if(mode===0){F[u[6]+e]=0;continue;}
          const x=F[u[4]+f];let free=F[u[5]+e];
          if(u[7]!==0)free=fr(free+fr(fv[1]*fr(fr(six(u[4],f,u[8],u[9],u[10])-fr(6*x))*fv[2])));
          F[u[6]+e]=fr(fv[0]*fr(x-free));
        }else F[u[6]+e]=fr(F[u[5]+6*e+2]*F[u[4]+f]);
      }
      return;
    }
    case 'segSum':{
      const red=new Float32Array(256);
      for(let group=0;group<n;group++){
        const seg=group>>2,q=group&3,start=I[u[1]+2*seg],count=I[u[1]+2*seg+1];
        for(let l=0;l<256;l++){let a=0;for(let i=l;i<count;i+=256){const e=start+i,v=F[u[2]+e];a=q===0?fr(a+v):fr(a+fr(v*F[u[3]+6*e+2+q]));}red[l]=a;}
        for(let s=128;s>0;s>>=1)for(let l=0;l<s;l++)red[l]=fr(red[l]+red[l+s]);
        S[u[4]+group]=red[0];
      }
      return;
    }
  }
}
