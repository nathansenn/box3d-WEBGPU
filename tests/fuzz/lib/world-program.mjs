// Random valid programs for the rigid world, and the invariants every step must keep (docs/ROBUSTNESS.md).
//
// "Valid" includes the stability rules world.diagnose() states: the programs keep the masses of jointed bodies within
// 10 to 1 and joint frequencies at most a quarter of the sub-step rate, and the fuzzers assert that diagnose() has no
// warning for what they built. A set-up that breaks those rules may diverge; that is what the rules are for.
//
// A program is a list of operations drawn from a seeded stream. Operations name bodies by render row at the moment they
// run, never by a kept handle, so the same program replays against a restored or a second world. The generator stays
// inside the documented ranges (docs/ERRORS.md, "Accepted ranges") and builds joints as a forest: each body is the
// child of at most one joint and frames start where the bodies are. Mechanisms whose joints contradict each other are a
// known Box3D defect (ND-2 in native-defects.test.mjs) and are not generated here.
import {hashBytes} from './rng.mjs';

const HULLS = [
  // tetrahedron, wedge, cube with a chipped corner: all convex, all with volume
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  [-0.5, -0.3, -0.4, 0.5, -0.3, -0.4, 0.5, -0.3, 0.4, -0.5, -0.3, 0.4, -0.5, 0.3, -0.4, -0.5, 0.3, 0.4],
  [-0.4, -0.4, -0.4, 0.4, -0.4, -0.4, 0.4, 0.4, -0.4, -0.4, 0.4, -0.4, -0.4, -0.4, 0.4, 0.4, -0.4, 0.4, 0.4, 0.4, 0.2, -0.4, 0.4, 0.4, 0.2, 0.4, 0.4],
];
// The rigid core's motor, parallel and filter joints with the six older types; thresholds, breaking, drives, steering
// and the newer setters are drawn below.
const JOINT_TYPES = ['weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel', 'motor', 'parallel', 'filter'];
const LIMITED = ['revolute', 'spherical', 'prismatic', 'distance', 'wheel'], MOTORED = ['revolute', 'prismatic', 'wheel'], SPRUNG = ['weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel', 'parallel'];

export function randomConvex(r, scale = 1) {
  const kind = r.pick(['box', 'sphere', 'capsule', 'hull']);
  if (kind === 'box') return {kind, halfExtents: [r.real(0.1, 0.6) * scale, r.real(0.1, 0.6) * scale, r.real(0.1, 0.6) * scale]};
  if (kind === 'sphere') return {kind, radius: r.real(0.1, 0.5) * scale};
  if (kind === 'capsule') return {kind, radius: r.real(0.08, 0.3) * scale, halfLength: r.real(0.1, 0.5) * scale};
  const s = r.real(0.5, 1.2) * scale;
  return {kind, points: r.pick(HULLS).map(v => v * s)};
}

export function randomShape(r) {
  const roll = r.next();
  if (roll < 0.72) return randomConvex(r);
  if (roll < 0.9) {
    const count = r.int(1, 4);
    return {kind: 'compound', shapes: Array.from({length: count}, () => ({
      shape: randomConvex(r, 0.6), position: r.vec3(-0.5, 0.5), ...(r.bool() ? {rotation: r.quat()} : {}),
      ...(r.bool(0.3) ? {density: r.log(50, 8000)} : {}), ...(r.bool(0.3) ? {friction: r.real(0, 1)} : {}), ...(r.bool(0.3) ? {restitution: r.real(0, 0.8)} : {}),
    }))};
  }
  if (roll < 0.95) {
    // A small pyramid with a square base: static scenery.
    const w = r.real(0.5, 2), h = r.real(0.2, 1);
    return {kind: 'mesh', vertices: [-w, 0, -w, w, 0, -w, w, 0, w, -w, 0, w, 0, h, 0], indices: [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0, 0, 1, 2, 0, 2, 3]};
  }
  const nx = r.int(2, 6), nz = r.int(2, 6);
  return {kind: 'heightfield', countX: nx, countZ: nz, spacing: [r.real(0.3, 1), r.real(0.3, 1)], heights: Array.from({length: nx * nz}, () => r.real(0, 0.4))};
}

export function randomBody(r) {
  const shape = randomShape(r), scenery = shape.kind === 'mesh' || shape.kind === 'heightfield';
  const type = scenery ? 'static' : r.pick(['dynamic', 'dynamic', 'dynamic', 'dynamic', 'kinematic', 'static']);
  const options = {shape, type, position: [r.real(-6, 6), scenery ? r.real(0, 0.5) : r.real(0.6, 9), r.real(-6, 6)]};
  if (r.bool(0.6)) options.rotation = r.quat();
  if (type !== 'static') {
    if (r.bool(0.4)) options.linearVelocity = r.vec3(-6, 6);
    if (r.bool(0.4)) options.angularVelocity = r.vec3(-6, 6);
  }
  if (r.bool(0.5)) options.density = r.log(20, 20000);
  if (r.bool(0.5)) options.friction = r.real(0, 1.2);
  if (r.bool(0.5)) options.restitution = r.real(0, 0.9);
  if (r.bool(0.2)) options.color = r.int(0, 0xffffff);
  for (const flag of ['bullet', 'hitEvents', 'neverSleeps', 'lockRotation']) if (r.bool(0.12)) options[flag] = true;
  if (r.bool(0.05) && !scenery) options.sensor = true;
  if (r.bool(0.2)) options.linearDamping = r.real(0, 2);
  if (r.bool(0.2)) options.angularDamping = r.real(0, 2);
  if (r.bool(0.15)) options.gravityScale = r.real(-1, 2);
  if (r.bool(0.25)) options.filter = {categoryBits: 1n << BigInt(r.int(0, 5)), maskBits: BigInt(r.int(1, 63)), groupIndex: r.int(-2, 2)};
  if (type === 'dynamic' && !scenery && r.bool(0.12)) options.massData = randomMassData(r);
  return options;
}

export function randomMassData(r) {
  const mass = r.log(0.05, 500), k = r.real(0.05, 0.6), a = mass * k * k * r.real(0.6, 1.4), b = mass * k * k * r.real(0.6, 1.4), c = mass * k * k * r.real(0.6, 1.4);
  // Small products of inertia keep the tensor positive definite and its diagonal a triangle (a + b > c).
  const p = Math.min(a, b, c) * 0.1;
  return {mass, center: r.vec3(-0.1, 0.1), inertia: [a, b, c, r.real(-p, p), r.real(-p, p), r.real(-p, p)]};
}

const rotate = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
const conj = q => [-q[0], -q[1], -q[2], q[3]];
const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
/** A world point and orientation expressed in a body's frame (identity for the fixed world). */
function localFrame(state, point, rotation) {
  if (!state) return {position: point, rotation};
  const d = [point[0] - state.position[0], point[1] - state.position[1], point[2] - state.position[2]], inv = conj(state.rotation);
  return {position: rotate(inv, d), rotation: mul(inv, rotation)};
}

/**
 * One fuzzing session over a PhysicsWorld. `world` must be an SI world (reset()); the session keeps no body handles of
 * its own between operations, only the joints it made and which rows are already a joint's child.
 */
export class WorldSession {
  constructor(world, r, options = {}) {
    this.world = world; this.r = r;
    this.maxBodies = options.maxBodies ?? 60;
    // Bookkeeping is by render row, not by handle: rows are part of a checkpoint, so it stays right across a restore.
    this.joints = [];           // {joint, type, child: row of bodyB, parent: row of bodyA or -1 for the fixed world}
    this.graveyard = [];        // handles of destroyed bodies: must stay dead
    this.ops = 0; this.steps = 0;
    this.counts = {};
  }
  bodyRow() { const n = this.world.bodyCount(); return n > 1 ? this.r.int(1, n - 1) : -1; } // row 0 is the ground
  /** A row whose body has the wanted type, or -1. */
  rowOfType(...types) {
    const n = this.world.bodyCount(), start = n > 1 ? this.r.int(1, n - 1) : 1;
    for (let k = 0; k < n - 1; k++) { const row = 1 + ((start - 1 + k) % (n - 1)); if (types.includes(this.world.getState(this.world.bodyAt(row)).type)) return row; }
    return -1;
  }
  count(name) { this.counts[name] = (this.counts[name] ?? 0) + 1; }
  liveJoints() { return this.joints.filter(j => this.world.isJointAlive(j.joint)); }
  isChild(row) { return this.liveJoints().some(j => j.child === row); }
  isJointed(row) { return this.liveJoints().some(j => j.child === row || j.parent === row); }
  /** The bookkeeping at this moment, to put back with restore() after world.restoreCheckpoint(). */
  snapshot() { return {joints: this.joints.map(j => ({...j})), graveyard: [...this.graveyard]}; }
  restore(book) { this.joints = book.joints.map(j => ({...j})); this.graveyard = [...book.graveyard]; return this; }
  /** Draw the next operations from another stream (the same fork twice replays the same operations). */
  withStream(r) { this.r = r; return this; }

  op() {
    const {world, r} = this;
    this.ops++;
    const roll = r.next(), n = world.bodyCount();
    if (roll < 0.30 || n < 4) {
      if (n >= this.maxBodies) return this.destroy();
      const body = r.bool(0.15) ? world.spawnBox({position: [r.real(-5, 5), r.real(1, 8), r.real(-5, 5)], halfSize: r.real(0.1, 0.6), ...(r.bool() ? {impulse: r.vec3(-20, 20)} : {})}) : world.createBody(randomBody(r));
      if (body === null) throw new Error('createBody returned null below capacity');
      return this.count('create');
    }
    if (roll < 0.38) return this.destroy();
    if (roll < 0.47) return this.joint();
    if (roll < 0.50) { const alive = this.liveJoints(); if (alive.length) { const j = r.pick(alive); world.destroyJoint(j.joint); this.joints = this.joints.filter(other => other !== j); this.count('destroyJoint'); } return; }
    if (roll < 0.56) return this.tuneJoint();
    if (roll < 0.74) {
      const row = this.rowOfType('dynamic'); if (row < 0) return;
      const body = world.bodyAt(row), kind = r.int(0, 7), at = world.getState(body).position;
      if (kind === 0) world.setVelocity(body, r.vec3(-15, 15), r.vec3(-10, 10));
      else if (kind === 1) world.applyForce(body, r.vec3(-2000, 2000), r.bool() ? [at[0] + r.real(-0.3, 0.3), at[1], at[2]] : undefined);
      else if (kind === 2) world.applyTorque(body, r.vec3(-500, 500));
      else if (kind === 3) world.applyImpulse(body, r.vec3(-50, 50));
      else if (kind === 4) world.applyImpulseAt(body, r.vec3(-50, 50), [at[0], at[1] + r.real(-0.3, 0.3), at[2]]);
      else if (kind === 5) world.applyAngularImpulse(body, r.vec3(-20, 20));
      else if (kind === 6) world.setAwake(body, r.bool());
      else world.setDamping(body, r.real(0, 3), r.real(0, 3));
      return this.count('drive');
    }
    if (roll < 0.79) {
      // Teleports move bodies that no joint holds. Moving one end of a joint metres away from the other leaves the joint
      // with an error no step can absorb; with limits or a spring on it Box3D can then diverge (native defect ND-5).
      const row = this.bodyRow(); if (row < 0 || (this.isJointed(row) && !process.env.FUZZ_TELEPORT_JOINTED)) return;
      world.setTransform(world.bodyAt(row), [r.real(-6, 6), r.real(0.5, 9), r.real(-6, 6)], r.quat()); return this.count('teleport');
    }
    if (roll < 0.83) {
      const row = this.rowOfType('kinematic'); if (row < 0) return;
      const body = world.bodyAt(row), at = world.getState(body).position;
      // A small turn from where it is: a random orientation reached in one step would spin the body at up to 190 rad/s
      // and whip whatever is jointed to it.
      const q = world.getState(body).rotation, d = [r.real(-0.05, 0.05), r.real(-0.05, 0.05), r.real(-0.05, 0.05), 1], n = Math.hypot(...d);
      const turned = [(q[3] * d[0] + q[0] * d[3] + q[1] * d[2] - q[2] * d[1]) / n, (q[3] * d[1] - q[0] * d[2] + q[1] * d[3] + q[2] * d[0]) / n, (q[3] * d[2] + q[0] * d[1] - q[1] * d[0] + q[2] * d[3]) / n, (q[3] * d[3] - q[0] * d[0] - q[1] * d[1] - q[2] * d[2]) / n];
      world.moveKinematic(body, [at[0] + r.real(-0.2, 0.2), Math.max(0.5, at[1] + r.real(-0.2, 0.2)), at[2] + r.real(-0.2, 0.2)], turned, r.pick([undefined, 1 / 60, 0.1]));
      return this.count('kinematic');
    }
    if (roll < 0.86) {
      const row = this.bodyRow(); if (row < 0) return;
      const body = world.bodyAt(row), kind = world.bodyKinds()[row];
      // A jointed body keeps its type: turning one end of a joint static changes the mass ratio the joint was made for.
      if (kind === 'mesh' || kind === 'heightfield' || this.isJointed(row)) return;
      world.setBodyType(body, r.pick(['static', 'kinematic', 'dynamic', 'dynamic']));
      return this.count('retype');
    }
    if (roll < 0.90) {
      const row = this.rowOfType('dynamic'); if (row < 0) return;
      const body = world.bodyAt(row), kind = r.int(0, 3);
      if (kind === 0) world.setGravityScale(body, r.real(-1, 2));
      else if (kind === 1) world.setCollisionFilter(body, 1n << BigInt(r.int(0, 5)), BigInt(r.int(1, 63)), r.int(-2, 2));
      else if (this.isJointed(row)) return;
      else if (kind === 2) world.setMassData(body, randomMassData(r));
      else world.resetMassData(body);
      return this.count('tune');
    }
    if (roll < 0.915) {
      // The rigid core's body settings: bullets, sleep, motion locks.
      const row = this.rowOfType('dynamic'); if (row < 0) return;
      const body = world.bodyAt(row), kind = r.int(0, 2);
      if (kind === 0) world.setBullet(body, r.bool());
      else if (kind === 1) world.setSleep(body, {enabled: r.bool(0.8), threshold: r.real(0.01, 0.2)});
      else if (!this.isJointed(row)) world.setMotionLocks(body, {linearX: r.bool(0.2), linearY: r.bool(0.1), linearZ: r.bool(0.2), angularX: r.bool(0.2), angularY: r.bool(0.2), angularZ: r.bool(0.2)});
      return this.count('flags');
    }
    if (roll < 0.925) { world.explodeArea({center: [r.real(-4, 4), r.real(0, 4), r.real(-4, 4)], radius: r.real(0.5, 4), falloff: r.real(0, 2), impulsePerArea: r.real(-20, 60)}); return this.count('explodeArea'); }
    if (roll < 0.93) { world.explode([r.real(-4, 4), r.real(0, 4), r.real(-4, 4)], r.real(0, 300), r.real(0.5, 6)); return this.count('explode'); }
    if (roll < 0.95) { world.setGravity([r.real(-3, 3), r.real(-20, 2), r.real(-3, 3)]); return this.count('gravity'); }
    return this.query();
  }

  destroy() {
    const row = this.bodyRow(); if (row < 0) return;
    const body = this.world.bodyAt(row), last = this.world.bodyCount() - 1;
    if (!this.world.destroyBody(body)) throw new Error('destroyBody returned false for a live row');
    // The joints of the body went with it; the last row moved into the freed one.
    this.joints = this.joints.filter(j => j.child !== row && j.parent !== row);
    for (const j of this.joints) { if (j.child === last) j.child = row; if (j.parent === last) j.parent = row; }
    if (this.graveyard.length < 24) this.graveyard.push(body);
    this.count('destroy');
  }

  joint() {
    const {world, r} = this, n = world.bodyCount();
    // The child must be a dynamic body that no joint holds yet; the parent is another body or the fixed world.
    let childRow = -1;
    for (let tries = 0; tries < 6 && childRow < 0; tries++) { const row = this.rowOfType('dynamic'); if (row > 0 && !this.isChild(row)) childRow = row; }
    if (childRow < 0) return;
    const child = world.bodyAt(childRow), childState = world.getState(child);
    let parent = null, parentState = null, parentRow = -1;
    if (r.bool(0.7) && n > 2) { const row = this.bodyRow(); if (row > 0 && row !== childRow && !this.isDescendant(row, childRow)) { parentRow = row; parent = world.bodyAt(row); parentState = world.getState(parent); } }
    // The stability rules of diagnose(): the joint's anchor (the child's position) within 40 radii of gyration of the
    // parent's centre of mass (the rule warns at 50), and the masses across the joint within 10 to 1.
    // FUZZ_LEVER=<ratio> loosens the first rule, to reproduce native defect ND-5 (docs/ROBUSTNESS.md).
    // A parent that is not dynamic (a kinematic mover, static scenery) holds its joints within 3 m, and nothing joins a body that has flown off.
    if (Math.max(...childState.position.map(Math.abs)) > 100) return;
    if (parentState && parentState.type !== 'dynamic' && Math.hypot(parentState.position[0] - childState.position[0], parentState.position[1] - childState.position[1], parentState.position[2] - childState.position[2]) > 3) return;
    if (parentState && parentState.type === 'dynamic') {
      const data = world.getMassData(parent), k = Math.sqrt(Math.min(data.inertia[0], data.inertia[1], data.inertia[2]) / data.mass), q = parentState.rotation, c = data.center;
      const tx = 2 * (q[1] * c[2] - q[2] * c[1]), ty = 2 * (q[2] * c[0] - q[0] * c[2]), tz = 2 * (q[0] * c[1] - q[1] * c[0]);
      const com = [parentState.position[0] + c[0] + q[3] * tx + q[1] * tz - q[2] * ty, parentState.position[1] + c[1] + q[3] * ty + q[2] * tx - q[0] * tz, parentState.position[2] + c[2] + q[3] * tz + q[0] * ty - q[1] * tx];
      const lever = Math.hypot(childState.position[0] - com[0], childState.position[1] - com[1], childState.position[2] - com[2]);
      if (!(lever <= Number(process.env.FUZZ_LEVER ?? 40) * k)) return;
    }
    if (parentState && parentState.type === 'dynamic' && Math.max(parentState.mass, childState.mass) > 10 * Math.min(parentState.mass, childState.mass)) return;
    const type = r.pick(JOINT_TYPES), anchor = childState.position, orientation = r.quat();
    const options = {type, bodyA: parent, bodyB: child, frameA: localFrame(parentState, type === 'distance' && parentState ? parentState.position : anchor, orientation), frameB: localFrame(childState, anchor, orientation)};
    if (type === 'distance') {
      const from = parentState ? parentState.position : anchor, d = Math.hypot(anchor[0] - from[0], anchor[1] - from[1], anchor[2] - from[2]);
      options.length = Math.max(0.05, d);
      if (r.bool(0.4)) options.limits = {lower: Math.max(0.01, options.length * 0.5), upper: options.length * 1.5};
    } else if (LIMITED.includes(type) && r.bool(0.4)) options.limits = {lower: -r.real(0.05, 1), upper: r.real(0.05, 1)};
    if (MOTORED.includes(type) && r.bool(0.35)) options.motor = {speed: r.real(-4, 4), maxForce: r.real(0, 200)};
    if (SPRUNG.includes(type) && r.bool(type === 'parallel' ? 0.8 : 0.3)) options.spring = {hertz: r.real(0.5, 12), dampingRatio: r.real(0, 2), ...(!['weld', 'distance', 'parallel'].includes(type) && r.bool() ? {target: r.real(-0.3, 0.3)} : {})};
    if (type === 'spherical' && r.bool(0.4)) options.coneAngle = r.real(0.1, 1.2);
    if (type === 'parallel' && r.bool(0.6)) options.maxTorque = r.real(0, 200);
    if (type === 'motor') options.drive = randomDrive(r);
    if (type === 'wheel' && r.bool(0.4)) options.steering = randomSteering(r);
    // Joint events, and joints that break: a breaking joint is removed by the step, and the bookkeeping follows it.
    if (r.bool(0.25)) options.thresholds = {force: r.real(50, 5e4), ...(r.bool() ? {torque: r.real(20, 2e4)} : {}), breakable: r.bool(0.5)};
    // A quarter of the sub-step rate (4 sub-steps at 60 Hz: 60 Hz) is where Box3D caps a joint's stiffness; the programs
    // stay at half of it.
    if (type !== 'filter' && r.bool(0.2)) options.stiffness = {hertz: r.real(10, 30), dampingRatio: r.real(0.5, 3)};
    if (r.bool(0.2)) options.collideConnected = true;
    const joint = world.createJoint(options);
    this.joints.push({joint, type, child: childRow, parent: parentRow});
    this.count('joint');
  }
  /** True when `candidate` already hangs below `root` through live joints (so a joint root <- candidate would close a loop). */
  isDescendant(candidate, root) {
    const live = this.liveJoints();
    let row = candidate;
    for (let depth = 0; depth < 256; depth++) {
      if (row === root) return true;
      const up = live.find(j => j.child === row);
      if (!up || up.parent < 0) return false;
      row = up.parent;
    }
    return true;
  }

  tuneJoint() {
    const {world, r} = this, alive = this.liveJoints();
    if (!alive.length) return;
    const {joint, type} = r.pick(alive), kind = r.int(0, 7);
    if (kind === 0 && ['revolute', 'prismatic', 'wheel', 'distance'].includes(type)) world.setJointMotor(joint, r.bool(0.3) ? null : {speed: r.real(-4, 4), maxForce: r.real(0, 200)});
    else if (kind === 1 && LIMITED.includes(type)) world.setJointLimits(joint, r.bool(0.3) ? null : type === 'distance' ? {lower: r.real(0.05, 1), upper: r.real(1, 4)} : {lower: -r.real(0.05, 1), upper: r.real(0.05, 1)});
    else if (kind === 2 && SPRUNG.includes(type) && type !== 'parallel') world.setJointSpring(joint, r.bool(0.3) ? null : {hertz: r.real(0.5, 12), dampingRatio: r.real(0, 2)});
    else if (kind === 3 && type === 'motor') world.setJointDrive(joint, randomDrive(r));
    else if (kind === 3 && type === 'parallel') world.setJointParallelSpring(joint, {hertz: r.real(0.5, 12), dampingRatio: r.real(0, 2), maxTorque: r.real(0, 200)});
    else if (kind === 3 && type === 'wheel') { if (r.bool()) world.setJointSteering(joint, r.bool(0.3) ? null : randomSteering(r)); else world.setJointSteeringLimits(joint, r.bool(0.3) ? null : {lower: -r.real(0.05, 0.6), upper: r.real(0.05, 0.6)}); }
    else if (kind === 3 && type === 'spherical') { const pick = r.int(0, 2); if (pick === 0) world.setJointConeLimit(joint, r.bool(0.3) ? null : r.real(0.1, 1.2)); else if (pick === 1) world.setJointAngularMotor(joint, r.bool(0.3) ? null : {velocity: r.vec3(-2, 2), maxTorque: r.real(0, 50)}); else world.setJointTargetRotation(joint, r.quat()); }
    else if (kind === 4) world.setJointThresholds(joint, r.bool(0.3) ? null : {force: r.real(50, 5e4), torque: r.real(20, 2e4), breakable: r.bool(0.4)});
    else if (kind === 5) world.setJointCollideConnected(joint, r.bool());
    else if (kind === 6) { const details = world.getJointDetails(joint); for (const [key, value] of Object.entries(details)) for (const n of [value].flat()) if (typeof n === 'number' && !Number.isFinite(n)) throw new Error(`joint details ${key} is not finite: ${JSON.stringify(details)}`); }
    else if (type !== 'filter') world.setJointStiffness(joint, r.real(10, 30), r.real(0.5, 3));
    const state = world.getJointState(joint);
    for (const value of [state.value, ...state.force, ...state.torque]) if (!Number.isFinite(value)) throw new Error(`joint state is not finite: ${JSON.stringify(state)}`);
    this.count('tuneJoint');
  }

  query() {
    const {world, r} = this, origin = [r.real(-6, 6), r.real(4, 12), r.real(-6, 6)];
    const alive = body => { if (!world.isAlive(body)) throw new Error('a query returned a dead body'); };
    const hit = r.pick([() => world.raycast(origin, [r.real(-2, 2), -20, r.real(-2, 2)]), () => world.sphereCast(origin, r.real(0.1, 1), [0, -20, 0]), () => world.boxCast(origin, [0.3, 0.3, 0.3], [0, -20, 0])])();
    if (hit) {
      alive(hit.body);
      if (!(hit.fraction >= 0 && hit.fraction <= 1) || !hit.point.every(Number.isFinite) || !hit.normal.every(Number.isFinite)) throw new Error(`a cast hit is malformed: ${JSON.stringify({fraction: hit.fraction, point: hit.point, normal: hit.normal})}`);
    }
    for (const body of world.overlapSphere([r.real(-5, 5), r.real(0, 5), r.real(-5, 5)], r.real(0.5, 4), {limit: r.int(1, 64)})) alive(body);
    for (const body of world.overlapBox([r.real(-5, 5), r.real(0, 5), r.real(-5, 5)], [r.real(0.5, 3), r.real(0.5, 3), r.real(0.5, 3)])) alive(body);
    // The rigid core's queries: capsules, every hit along a ray, and batches, which must agree with single rays.
    const capsule = world.capsuleCast(origin, r.real(0.1, 0.5), r.real(0.05, 0.6), [0, -20, 0]);
    if (capsule) alive(capsule.body);
    for (const body of world.overlapCapsule([r.real(-5, 5), r.real(0, 5), r.real(-5, 5)], r.real(0.2, 2), r.real(0.05, 1))) alive(body);
    let last = -1;
    for (const hit of world.raycastAll(origin, [r.real(-2, 2), -20, r.real(-2, 2)], {limit: r.int(1, 16)})) { alive(hit.body); if (!(hit.fraction >= last)) throw new Error('raycastAll hits are not nearest first'); last = hit.fraction; }
    const rays = r.int(1, 8), origins = new Float32Array(rays * 3), translations = new Float32Array(rays * 3), fractions = new Float32Array(rays), bodies = [];
    for (let i = 0; i < rays; i++) { origins.set([r.real(-6, 6), r.real(4, 12), r.real(-6, 6)], i * 3); translations.set([r.real(-2, 2), -20, r.real(-2, 2)], i * 3); }
    world.castRays(origins, translations, fractions, {bodies});
    for (let i = 0; i < rays; i++) {
      const single = world.raycast(Array.from(origins.subarray(i * 3, i * 3 + 3)), Array.from(translations.subarray(i * 3, i * 3 + 3)));
      if ((single === null) !== (fractions[i] < 0) || (single && (single.fraction !== fractions[i] || single.body.token !== bodies[i]?.token))) throw new Error(`castRays ray ${i} (${fractions[i]}) differs from raycast (${single?.fraction ?? 'miss'})`);
    }
    this.count('query');
  }

  step(count = 1) {
    for (let i = 0; i < count; i++) { this.world.step(); this.steps++; checkInvariants(this.world, this.graveyard); }
  }
}

/** A motor joint's drive: small target velocities, bounded forces, and sometimes springs. */
export function randomDrive(r) {
  return {linearVelocity: r.vec3(-1, 1), angularVelocity: r.vec3(-1, 1), maxForce: r.real(0, 100), maxTorque: r.real(0, 50),
    ...(r.bool(0.4) ? {linearSpring: {hertz: r.real(0.5, 12), dampingRatio: r.real(0, 2), maxForce: r.real(0, 200)}} : {}),
    ...(r.bool(0.4) ? {angularSpring: {hertz: r.real(0.5, 12), dampingRatio: r.real(0, 2), maxTorque: r.real(0, 100)}} : {})};
}
/** A wheel joint's steering, sometimes limited. */
export function randomSteering(r) {
  return {angle: r.real(-0.5, 0.5), hertz: r.real(1, 12), dampingRatio: r.real(0.2, 2), maxTorque: r.real(0, 200), ...(r.bool() ? {limits: {lower: -r.real(0.1, 0.6), upper: r.real(0.1, 0.6)}} : {})};
}

/** What must hold after every step. Throws with the row and the value at fault. */
export function checkInvariants(world, graveyard = []) {
  const n = world.bodyCount(), stats = world.stats(), m = world.matrices(), colors = world.colors();
  if (stats.nonFiniteSince !== null) throw new Error(`the world reports a non-finite transform since tick ${stats.nonFiniteSince}`);
  if (n > stats.capacity || stats.awake > n || stats.awake < 0) throw new Error(`counts are inconsistent: ${JSON.stringify(stats)}`);
  if (m.length !== n * 16 || colors.length !== n * 4) throw new Error('the instance streams do not match the body count');
  for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i])) throw new Error(`matrix value ${i} (row ${i >> 4}) is ${m[i]}`);
  for (let i = 0; i < colors.length; i++) if (!Number.isFinite(colors[i])) throw new Error(`color value ${i} is ${colors[i]}`);
  const kinds = world.bodyKinds();
  if (kinds.length !== n) throw new Error('bodyKinds() does not match the body count');
  for (let row = 0; row < n; row++) {
    const body = world.bodyAt(row);
    if (!world.isAlive(body)) throw new Error(`the handle of row ${row} is not alive`);
    const state = world.getState(body);
    for (const key of ['position', 'rotation', 'linearVelocity', 'angularVelocity']) if (!state[key].every(Number.isFinite)) throw new Error(`row ${row} ${key} is ${JSON.stringify(state[key])}`);
    if (!Number.isFinite(state.mass) || state.mass < 0) throw new Error(`row ${row} mass is ${state.mass}`);
    const q = Math.hypot(...state.rotation);
    if (Math.abs(q - 1) > 1e-3) throw new Error(`row ${row} rotation has length ${q}`);
    if (state.type === 'dynamic') {
      // Box3D clamps the speed it integrates at 400 m/s (b3WorldDef.maximumLinearSpeed), but the contact and joint
      // impulses of the same step can leave a body faster until the next step: a jointed body teleported 10 m away
      // is pulled back at several km/s by its joint (measured here: up to about 5.5 km/s). So the invariant is a bound
      // that only a runaway breaks: the speed limit the API itself accepts, RIGID_LIMITS.speed.
      const speed = Math.hypot(...state.linearVelocity), spin = Math.hypot(...state.angularVelocity);
      checkInvariants.fastest = Math.max(checkInvariants.fastest ?? 0, speed); checkInvariants.fastestSpin = Math.max(checkInvariants.fastestSpin ?? 0, spin);
      if (speed > 1e6) throw new Error(`row ${row} moves at ${speed} m/s, beyond the 1e6 m/s the API accepts`);
      // A 50 g body with a 5 cm radius of gyration takes 1e5 rad/s from one of the angular impulses these programs apply, and several can land before a step; 1e8 rad/s is out of their reach.
      if (spin > 1e8) throw new Error(`row ${row} spins at ${spin} rad/s`);
    }
    const pose = world.getPose(body);
    if (!pose || !pose.position.every(Number.isFinite) || !pose.rotation.every(Number.isFinite)) throw new Error(`row ${row} pose is not finite`);
  }
  for (const body of graveyard) if (world.isAlive(body)) throw new Error('a destroyed handle came back to life');
}

/** Bits of everything a step computes for the bodies: transforms and body states. Equal digests mean equal states. */
export function worldDigest(world) {
  const m = world.matrices();
  let hash = hashBytes(new Uint8Array(m.buffer, m.byteOffset, m.byteLength));
  const f = new Float32Array(15), bytes = new Uint8Array(f.buffer);
  for (let row = 0; row < world.bodyCount(); row++) {
    const s = world.getState(world.bodyAt(row));
    f.set(s.position, 0); f.set(s.rotation, 3); f.set(s.linearVelocity, 7); f.set(s.angularVelocity, 10); f[13] = s.mass; f[14] = (s.awake ? 1 : 0) + ['static', 'kinematic', 'dynamic'].indexOf(s.type) * 2;
    hash = hashBytes(bytes, hash);
  }
  return `${world.bodyCount()}:${world.tick}:${hash}`;
}
