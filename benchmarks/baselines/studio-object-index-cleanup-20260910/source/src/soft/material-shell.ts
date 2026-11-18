import { clamp } from '../math';

/**
 * Discrete-shell and contact kernels for the reduced-order lattice.
 *
 * Angle energy follows a 3-vertex discrete hinge (Grinspun et al., Discrete
 * Shells, 2003; Müller, Position Based Dynamics, 2006). XPBD compliance is
 * α̃ = α / Δt² = 1 / (k Δt²) after Macklin & Müller, XPBD (2016). The
 * projector scales k, floors α̃, and adds Rayleigh damping so metal hinges
 * dent and set instead of sloshing.
 *
 * These are normalized comparative coefficients, not calibrated plate moduli.
 */

const ANGLE_EPS = 1e-8;
const CONTACT_EPS = 1e-8;

/** Multiplier on authored hinge k. Applied as α̃_eff = max(α_min, α̃ / scale). */
export const SHELL_BEND_K_SCALE = 64;
/** Floor on α̃ after the k scale so the hinge cannot lock into a rigid board. */
export const SHELL_XPBD_ALPHA_MIN = 0.35;
/** Base XPBD Rayleigh damping γ in Δλ = (−C − α̃ λ) / (w(1+γ) + α̃). */
export const SHELL_XPBD_DAMPING = 0.46;
/** Extra γ near C ≈ 0 to kill membrane ripple; fades as a plastic dent forms. */
export const SHELL_RIPPLE_DAMPING = 0.72;
/** Safety bound on Δλ (radians) after the stiff/damped solve. */
export const SHELL_ANGLE_DLAMBDA_LIMIT = 0.48;
/** Kinematic contact copies this fraction of the push into `previous`. */
export const SHELL_CONTACT_PREVIOUS_COUPLING = 0.91;
/** Fraction of approaching normal velocity absorbed at contact. */
export const SHELL_CONTACT_NORMAL_DAMPING = 0.74;
/** Dynamic projectile restitution cap. Panels should not drum. */
export const SHELL_DYNAMIC_RESTITUTION_MAX = 0.22;

/** Raw XPBD `α̃ = 1/(k Δt²)`. The projector then applies `SHELL_BEND_K_SCALE`. */
export function xpbdAngleAlphaTilde(k: number, dt: number): number {
  return 1 / Math.max(1e-8, k * dt * dt);
}

function effectiveAngleAlpha(alphaTilde: number): number {
  return Math.max(SHELL_XPBD_ALPHA_MIN, alphaTilde / SHELL_BEND_K_SCALE);
}

function applyInelasticPush(
  positions: Float32Array,
  previous: Float32Array,
  o: number,
  nx: number,
  ny: number,
  nz: number,
  push: number,
  previousCoupling: number,
): void {
  positions[o] += nx * push;
  positions[o + 1] += ny * push;
  positions[o + 2] += nz * push;
  previous[o] += nx * push * previousCoupling;
  previous[o + 1] += ny * push * previousCoupling;
  previous[o + 2] += nz * push * previousCoupling;
  const vn = (positions[o] - previous[o]) * nx
    + (positions[o + 1] - previous[o + 1]) * ny
    + (positions[o + 2] - previous[o + 2]) * nz;
  if (vn >= 0) return;
  const absorb = vn * SHELL_CONTACT_NORMAL_DAMPING;
  previous[o] += nx * absorb;
  previous[o + 1] += ny * absorb;
  previous[o + 2] += nz * absorb;
}

/** Unsigned bend angle at b for points a-b-c, in [0, π]. Flat opposite rays return π. */
export function polylineBendAngle(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const d0x = ax - bx;
  const d0y = ay - by;
  const d0z = az - bz;
  const d2x = cx - bx;
  const d2y = cy - by;
  const d2z = cz - bz;
  const l0 = Math.hypot(d0x, d0y, d0z);
  const l2 = Math.hypot(d2x, d2y, d2z);
  if (l0 < ANGLE_EPS || l2 < ANGLE_EPS) return Math.PI;
  const inv0 = 1 / l0;
  const inv2 = 1 / l2;
  const n0x = d0x * inv0;
  const n0y = d0y * inv0;
  const n0z = d0z * inv0;
  const n2x = d2x * inv2;
  const n2y = d2y * inv2;
  const n2z = d2z * inv2;
  const cos = clamp(n0x * n2x + n0y * n2y + n0z * n2z, -1, 1);
  const crx = n0y * n2z - n0z * n2y;
  const cry = n0z * n2x - n0x * n2z;
  const crz = n0x * n2y - n0y * n2x;
  return Math.atan2(Math.hypot(crx, cry, crz), cos);
}

/** Rest binormal for a 3-vertex hinge. Degenerate polylines fall back to `fallback`. */
export function hingeBinormal(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  fallbackX: number, fallbackY: number, fallbackZ: number,
): readonly [number, number, number] {
  const d0x = ax - bx;
  const d0y = ay - by;
  const d0z = az - bz;
  const d2x = cx - bx;
  const d2y = cy - by;
  const d2z = cz - bz;
  const crx = d0y * d2z - d0z * d2y;
  const cry = d0z * d2x - d0x * d2z;
  const crz = d0x * d2y - d0y * d2x;
  const length = Math.hypot(crx, cry, crz);
  if (length < ANGLE_EPS) return [fallbackX, fallbackY, fallbackZ];
  return [crx / length, cry / length, crz / length];
}

/**
 * XPBD 3-vertex angle projection. Updates `positions` in place and returns the
 * new Lagrange multiplier. `alphaTilde` is the authored α / Δt² = 1 / (k Δt²);
 * the kernel applies `SHELL_BEND_K_SCALE` and damping. `restAngle` is the
 * plastic set. Gradients are ∇θ so C = θ−θ_rest restores instead of rippling.
 */
export function projectXpbdAngle(
  positions: Float32Array,
  invMass: Float32Array,
  a: number,
  b: number,
  c: number,
  restAngle: number,
  lambda: number,
  alphaTilde: number,
): number {
  const ao = a * 3;
  const bo = b * 3;
  const co = c * 3;
  const d0x = positions[ao] - positions[bo];
  const d0y = positions[ao + 1] - positions[bo + 1];
  const d0z = positions[ao + 2] - positions[bo + 2];
  const d2x = positions[co] - positions[bo];
  const d2y = positions[co + 1] - positions[bo + 1];
  const d2z = positions[co + 2] - positions[bo + 2];
  const l0 = Math.hypot(d0x, d0y, d0z);
  const l2 = Math.hypot(d2x, d2y, d2z);
  if (l0 < ANGLE_EPS || l2 < ANGLE_EPS) return lambda;
  const inv0 = 1 / l0;
  const inv2 = 1 / l2;
  const n0x = d0x * inv0;
  const n0y = d0y * inv0;
  const n0z = d0z * inv0;
  const n2x = d2x * inv2;
  const n2y = d2y * inv2;
  const n2z = d2z * inv2;
  const crx = n0y * n2z - n0z * n2y;
  const cry = n0z * n2x - n0x * n2z;
  const crz = n0x * n2y - n0y * n2x;
  const cLen = Math.hypot(crx, cry, crz);
  const cos = clamp(n0x * n2x + n0y * n2y + n0z * n2z, -1, 1);
  const theta = Math.atan2(cLen, cos);
  const C = theta - restAngle;
  const absC = Math.abs(C);
  if (!(absC > 1e-9)) return lambda;
  let axisX = crx;
  let axisY = cry;
  let axisZ = crz;
  if (cLen < ANGLE_EPS) {
    // Near-colinear with a real angle error: restore toward restAngle. Tiny
    // residuals are skipped so the unsigned-flat singularity cannot chatter.
    if (absC < 1e-4) return lambda;
    axisX = Math.abs(n0x) < 0.9 ? 0 : 1;
    axisY = Math.abs(n0x) < 0.9 ? 1 : 0;
    axisZ = 0;
    const px = n0y * axisZ - n0z * axisY;
    const py = n0z * axisX - n0x * axisZ;
    const pz = n0x * axisY - n0y * axisX;
    const pLen = Math.hypot(px, py, pz);
    if (pLen < ANGLE_EPS) return lambda;
    axisX = px / pLen;
    axisY = py / pLen;
    axisZ = pz / pLen;
  } else {
    axisX /= cLen;
    axisY /= cLen;
    axisZ /= cLen;
  }

  const g0x = (axisZ * n0y - axisY * n0z) * inv0;
  const g0y = (axisX * n0z - axisZ * n0x) * inv0;
  const g0z = (axisY * n0x - axisX * n0y) * inv0;
  const g2x = (axisY * n2z - axisZ * n2y) * inv2;
  const g2y = (axisZ * n2x - axisX * n2z) * inv2;
  const g2z = (axisX * n2y - axisY * n2x) * inv2;
  const g1x = -g0x - g2x;
  const g1y = -g0y - g2y;
  const g1z = -g0z - g2z;
  const w0 = invMass[a];
  const w1 = invMass[b];
  const w2 = invMass[c];
  const wSum = w0 * (g0x * g0x + g0y * g0y + g0z * g0z)
    + w1 * (g1x * g1x + g1y * g1y + g1z * g1z)
    + w2 * (g2x * g2x + g2y * g2y + g2z * g2z);
  if (wSum < 1e-12) return lambda;
  const alpha = effectiveAngleAlpha(alphaTilde);
  const gamma = SHELL_XPBD_DAMPING + SHELL_RIPPLE_DAMPING / (1 + absC * absC * 40);
  const dlambda = (-C - alpha * lambda) / (wSum * (1 + gamma) + alpha);
  const limited = clamp(dlambda, -SHELL_ANGLE_DLAMBDA_LIMIT, SHELL_ANGLE_DLAMBDA_LIMIT);
  positions[ao] += w0 * g0x * limited;
  positions[ao + 1] += w0 * g0y * limited;
  positions[ao + 2] += w0 * g0z * limited;
  positions[bo] += w1 * g1x * limited;
  positions[bo + 1] += w1 * g1y * limited;
  positions[bo + 2] += w1 * g1z * limited;
  positions[co] += w2 * g2x * limited;
  positions[co + 1] += w2 * g2y * limited;
  positions[co + 2] += w2 * g2z * limited;
  return lambda + limited;
}

export type SphereContactAccum = {
  work: number;
  hits: number;
};

/**
 * Kinematic sphere vs lattice nodes. Nodes are pushed along the contact
 * normal; previous positions keep a fraction of the incoming velocity so the
 * contact does not inject energy. Returns accumulated |C| as a work proxy.
 */
export function projectKinematicSphere(
  positions: Float32Array,
  previous: Float32Array,
  invMass: Float32Array,
  pinned: Uint8Array,
  nodeCount: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  stiffness: number,
  accum: SphereContactAccum,
): void {
  const safeRadius = Math.max(1e-4, radius);
  const k = clamp(stiffness, 0.05, 1);
  for (let i = 0; i < nodeCount; i++) {
    if (pinned[i] !== 0 || invMass[i] <= 0) continue;
    const o = i * 3;
    const dx = positions[o] - cx;
    const dy = positions[o + 1] - cy;
    const dz = positions[o + 2] - cz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= safeRadius || dist < CONTACT_EPS) continue;
    const inv = 1 / dist;
    const nx = dx * inv;
    const ny = dy * inv;
    const nz = dz * inv;
    const C = safeRadius - dist;
    const push = C * k;
    applyInelasticPush(positions, previous, o, nx, ny, nz, push, SHELL_CONTACT_PREVIOUS_COUPLING);
    accum.work += C * C * k;
    accum.hits++;
  }
}

/** Capsule (segment + radius) vs lattice nodes. Used for press-brake line punches. */
export function projectKinematicCapsule(
  positions: Float32Array,
  previous: Float32Array,
  invMass: Float32Array,
  pinned: Uint8Array,
  nodeCount: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  radius: number,
  stiffness: number,
  accum: SphereContactAccum,
): void {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < CONTACT_EPS) {
    projectKinematicSphere(positions, previous, invMass, pinned, nodeCount, ax, ay, az, radius, stiffness, accum);
    return;
  }
  const invAb2 = 1 / ab2;
  const safeRadius = Math.max(1e-4, radius);
  const k = clamp(stiffness, 0.05, 1);
  for (let i = 0; i < nodeCount; i++) {
    if (pinned[i] !== 0 || invMass[i] <= 0) continue;
    const o = i * 3;
    const px = positions[o] - ax;
    const py = positions[o + 1] - ay;
    const pz = positions[o + 2] - az;
    const t = clamp((px * abx + py * aby + pz * abz) * invAb2, 0, 1);
    const qx = ax + abx * t;
    const qy = ay + aby * t;
    const qz = az + abz * t;
    const dx = positions[o] - qx;
    const dy = positions[o + 1] - qy;
    const dz = positions[o + 2] - qz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= safeRadius || dist < CONTACT_EPS) continue;
    const inv = 1 / dist;
    const nx = dx * inv;
    const ny = dy * inv;
    const nz = dz * inv;
    const C = safeRadius - dist;
    const push = C * k;
    applyInelasticPush(positions, previous, o, nx, ny, nz, push, SHELL_CONTACT_PREVIOUS_COUPLING);
    accum.work += C * C * k;
    accum.hits++;
  }
}

/**
 * Dynamic sphere vs lattice with two-way momentum. Used for live projectiles.
 * The sphere is kinematic in position this substep; velocity is updated from
 * the total impulse so the projectile can rebound without exploding the mesh.
 */
export function collideDynamicSphere(
  positions: Float32Array,
  previous: Float32Array,
  invMass: Float32Array,
  pinned: Uint8Array,
  nodeCount: number,
  sphere: { position: [number, number, number]; velocity: [number, number, number]; radius: number },
  restitution: number,
  dt: number,
): number {
  const cx = sphere.position[0];
  const cy = sphere.position[1];
  const cz = sphere.position[2];
  const radius = Math.max(1e-4, sphere.radius);
  const bounce = clamp(restitution, 0, SHELL_DYNAMIC_RESTITUTION_MAX);
  let impulseX = 0;
  let impulseY = 0;
  let impulseZ = 0;
  let work = 0;
  let hits = 0;
  for (let i = 0; i < nodeCount; i++) {
    if (pinned[i] !== 0 || invMass[i] <= 0) continue;
    const o = i * 3;
    const dx = positions[o] - cx;
    const dy = positions[o + 1] - cy;
    const dz = positions[o + 2] - cz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= radius || dist < CONTACT_EPS) continue;
    const inv = 1 / dist;
    const nx = dx * inv;
    const ny = dy * inv;
    const nz = dz * inv;
    const C = radius - dist;
    const push = C * 0.72;
    applyInelasticPush(positions, previous, o, nx, ny, nz, push, 0.86);
    const vx = (positions[o] - previous[o]);
    const vy = (positions[o + 1] - previous[o + 1]);
    const vz = (positions[o + 2] - previous[o + 2]);
    const rel = vx * nx + vy * ny + vz * nz
      - (sphere.velocity[0] * nx + sphere.velocity[1] * ny + sphere.velocity[2] * nz) * dt;
    if (rel < 0) {
      const j = rel * (1 + bounce) * 0.45;
      previous[o] += nx * j;
      previous[o + 1] += ny * j;
      previous[o + 2] += nz * j;
      const nodeMass = 1 / Math.max(1e-6, invMass[i]);
      impulseX -= nx * j * nodeMass / Math.max(1e-6, dt);
      impulseY -= ny * j * nodeMass / Math.max(1e-6, dt);
      impulseZ -= nz * j * nodeMass / Math.max(1e-6, dt);
    }
    work += C * C;
    hits++;
  }
  if (hits > 0) {
    const sphereMass = Math.max(0.35, radius * radius * radius * 8);
    sphere.velocity[0] += impulseX / sphereMass;
    sphere.velocity[1] += impulseY / sphereMass;
    sphere.velocity[2] += impulseZ / sphereMass;
    const speed = Math.hypot(sphere.velocity[0], sphere.velocity[1], sphere.velocity[2]);
    if (speed > 48) {
      const scale = 48 / speed;
      sphere.velocity[0] *= scale;
      sphere.velocity[1] *= scale;
      sphere.velocity[2] *= scale;
    }
  }
  return work;
}

/** Same-station node repulsion for hat-section self-contact (crash rail). */
export function projectStationSelfContact(
  positions: Float32Array,
  previous: Float32Array,
  invMass: Float32Array,
  pinned: Uint8Array,
  stations: number,
  lanes: number,
  radius: number,
  accum: SphereContactAccum,
): void {
  const r2 = radius * 2;
  const r2sq = r2 * r2;
  const k = 0.55;
  for (let station = 0; station < stations; station++) {
    const base = station * lanes;
    for (let i = 0; i < lanes; i++) {
      const a = base + i;
      if (pinned[a] !== 0 || invMass[a] <= 0) continue;
      const ao = a * 3;
      for (let j = i + 1; j < lanes; j++) {
        const b = base + j;
        if (pinned[b] !== 0 || invMass[b] <= 0) continue;
        const bo = b * 3;
        const dx = positions[bo] - positions[ao];
        const dy = positions[bo + 1] - positions[ao + 1];
        const dz = positions[bo + 2] - positions[ao + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= r2sq || distSq < CONTACT_EPS) continue;
        const dist = Math.sqrt(distSq);
        const C = r2 - dist;
        const inv = 1 / dist;
        const nx = dx * inv;
        const ny = dy * inv;
        const nz = dz * inv;
        const wa = invMass[a];
        const wb = invMass[b];
        const total = wa + wb;
        if (total <= 0) continue;
        const push = C * k;
        const sa = push * wa / total;
        const sb = push * wb / total;
        applyInelasticPush(positions, previous, ao, -nx, -ny, -nz, sa, 0.78);
        applyInelasticPush(positions, previous, bo, nx, ny, nz, sb, 0.78);
        accum.work += C * C * k;
        accum.hits++;
      }
    }
  }
}

/** Area-weighted node mass. Thickness is a scale relative to the preset gauge. */
export function areaWeightedMass(
  area: number,
  thicknessScale: number,
  densityScale: number,
): number {
  return Math.max(0.04, densityScale * Math.max(0.05, thicknessScale) * Math.max(1e-4, area));
}
