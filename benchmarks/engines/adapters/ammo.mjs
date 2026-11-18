// ammo.js (Bullet Physics compiled to WASM by Emscripten), through the ammojs-typed package.
// Setup follows the ammo.js readme (https://github.com/kripken/ammo.js, which names Bullet 2.82 and its hello-world
// example) and Bullet's usual world set-up, written from memory of the Bullet manual and demos: btDbvtBroadphase, btSequentialImpulseConstraintSolver
// with its default 10 iterations, stepSimulation(1/60, 1, 1/60), shared collision shapes, the default 0.04 m collision
// margin, setCcdMotionThreshold / setCcdSweptSphereRadius on bullets as in Bullet's CcdPhysicsDemo.
// Bullet multiplies the two bodies' friction (and restitution), so each body gets the square root of the scene value.
import fs from 'node:fs';
import path from 'node:path';
import {packageInfo, enginesDir, quatFromTo} from '../lib/util.mjs';

export const meta = {
  id: 'ammo', name: 'ammo.js', label: 'ammo.js (Bullet, WASM build from ammojs-typed)', package: 'ammojs-typed', license: 'MIT (typings); ammo.js and Bullet: zlib', precision: 'float32',
  files: ['ammo/ammo.wasm.wasm', 'ammo/ammo.wasm.js'],
  docs: ['https://github.com/kripken/ammo.js'],
  defaults: 'btSequentialImpulseConstraintSolver, 10 iterations, btDbvtBroadphase',
  budget: 'm_numIterations = N',
};

let cached = null;
export async function load() {
  if (!cached) {
    const dir = path.join(enginesDir, 'node_modules/ammojs-typed/ammo');
    const factory = (await import('ammojs-typed/wasm')).default;
    cached = await factory({wasmBinary: fs.readFileSync(path.join(dir, 'ammo.wasm.wasm')), locateFile: file => path.join(dir, file)});
  }
  return {version: packageInfo('ammojs-typed').version, createWorld: options => createWorld(cached, options)};
}

const DISABLE_DEACTIVATION = 4;

function createWorld(Ammo, {gravity, solver, sleep}) {
  const config = new Ammo.btDefaultCollisionConfiguration(), dispatcher = new Ammo.btCollisionDispatcher(config), broadphase = new Ammo.btDbvtBroadphase();
  const constraintSolver = new Ammo.btSequentialImpulseConstraintSolver(), world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, constraintSolver, config);
  const v = new Ammo.btVector3(gravity[0], gravity[1], gravity[2]), v2 = new Ammo.btVector3(0, 0, 0), v3 = new Ammo.btVector3(0, 0, 0), v4 = new Ammo.btVector3(0, 0, 0);
  world.setGravity(v);
  if (solver !== 'default') world.getSolverInfo().set_m_numIterations(solver);
  const iterations = world.getSolverInfo().get_m_numIterations();
  const bodies = [], constraints = [], shapes = new Map(), garbage = [], canSleep = sleep !== 'off';
  const transform = new Ammo.btTransform(), transformB = new Ammo.btTransform(), quaternion = new Ammo.btQuaternion(0, 0, 0, 1);
  let anchor = null;
  const setTransform = (target, position, rotation) => {
    target.setIdentity(); v.setValue(position[0], position[1], position[2]); target.setOrigin(v);
    quaternion.setValue(rotation[0], rotation[1], rotation[2], rotation[3]); target.setRotation(quaternion);
    return target;
  };
  const shapeOf = desc => {
    const s = desc.shape, key = s.key ?? (s.kind === 'box' ? `b${s.half}` : s.kind === 'sphere' ? `s${s.radius}` : s.kind === 'capsule' ? `c${s.radius},${s.halfHeight}` : null);
    if (key && shapes.has(key)) return shapes.get(key);
    let shape, offset = null;
    switch (s.kind) {
      case 'box': v.setValue(s.half[0], s.half[1], s.half[2]); shape = new Ammo.btBoxShape(v); break;
      case 'sphere': shape = new Ammo.btSphereShape(s.radius); break;
      case 'capsule': shape = new Ammo.btCapsuleShape(s.radius, 2 * s.halfHeight); break;
      case 'hull': {
        shape = new Ammo.btConvexHullShape();
        for (let i = 0; i < s.points.length; i += 3) { v.setValue(s.points[i], s.points[i + 1], s.points[i + 2]); shape.addPoint(v, i + 3 >= s.points.length); }
        break;
      }
      case 'mesh': {
        const mesh = new Ammo.btTriangleMesh(true, false), p = s.vertices;
        for (let t = 0; t < s.indices.length; t += 3) {
          const a = s.indices[t] * 3, b = s.indices[t + 1] * 3, c = s.indices[t + 2] * 3;
          v2.setValue(p[a], p[a + 1], p[a + 2]); v3.setValue(p[b], p[b + 1], p[b + 2]); v4.setValue(p[c], p[c + 1], p[c + 2]);
          mesh.addTriangle(v2, v3, v4, false);
        }
        shape = new Ammo.btBvhTriangleMeshShape(mesh, true, true);
        garbage.push(mesh);
        break;
      }
      case 'heightfield': {
        // Samples are row-major along z (index x + z * width); Bullet centres the shape on its bounding box.
        const pointer = Ammo._malloc(s.heights.length * 4);
        new Float32Array(Ammo.HEAPF32.buffer, pointer, s.heights.length).set(s.heights);
        let low = Infinity, high = -Infinity;
        for (const h of s.heights) { low = Math.min(low, h); high = Math.max(high, h); }
        shape = new Ammo.btHeightfieldTerrainShape(s.nx, s.nz, pointer, 1, low, high, 1, 'PHY_FLOAT', false);
        v.setValue(s.dx, 1, s.dz); shape.setLocalScaling(v);
        offset = [(s.nx - 1) * s.dx / 2, (low + high) / 2, (s.nz - 1) * s.dz / 2];
        garbage.push({pointer});
        break;
      }
      default: throw new Error(`unsupported shape ${s.kind}`);
    }
    const entry = {shape, offset};
    if (key) shapes.set(key, entry); else shapes.set(`u${shapes.size}`, entry);
    return entry;
  };
  const from = new Ammo.btVector3(0, 0, 0), to = new Ammo.btVector3(0, 0, 0), rayCallback = new Ammo.ClosestRayResultCallback(from, to);

  return {
    settings: {solver: 'btSequentialImpulseConstraintSolver', m_numIterations: iterations, broadphase: 'btDbvtBroadphase', maxSubSteps: 1, collisionMargin: '0.04 m (default)',
      sleeping: canSleep ? 'engine default (deactivation after 2 s)' : 'off (DISABLE_DEACTIVATION)', ccd: 'setCcdMotionThreshold(r), setCcdSweptSphereRadius(0.9 r) on bullets', threads: 1},
    addBody(desc) {
      const {shape, offset} = shapeOf(desc), dynamic = desc.type === 'dynamic', mass = dynamic ? desc.mass : 0;
      const position = offset ? [desc.position[0] + offset[0], desc.position[1] + offset[1], desc.position[2] + offset[2]] : desc.position;
      const motion = new Ammo.btDefaultMotionState(setTransform(transform, position, desc.rotation));
      v2.setValue(0, 0, 0);
      if (dynamic) shape.calculateLocalInertia(mass, v2);
      const info = new Ammo.btRigidBodyConstructionInfo(mass, motion, shape, v2), body = new Ammo.btRigidBody(info);
      Ammo.destroy(info);
      body.setFriction(Math.sqrt(desc.friction)); body.setRestitution(Math.sqrt(desc.restitution));
      if (dynamic) {
        body.setDamping(0, 0);
        if (!canSleep) body.setActivationState(DISABLE_DEACTIVATION);
        if (desc.linearVelocity) { v.setValue(desc.linearVelocity[0], desc.linearVelocity[1], desc.linearVelocity[2]); body.setLinearVelocity(v); }
        if (desc.ccd && desc.shape.kind === 'sphere') { body.setCcdMotionThreshold(desc.shape.radius); body.setCcdSweptSphereRadius(0.9 * desc.shape.radius); }
      }
      world.addRigidBody(body);
      bodies.push(body);
      garbage.push(motion);
    },
    addJoint(joint) {
      let a;
      if (joint.a < 0) {
        if (!anchor) {
          // The fixed world: a static body at the origin that collides with nothing.
          const shape = new Ammo.btSphereShape(0.01), motion = new Ammo.btDefaultMotionState(setTransform(transform, [0, 0, 0], [0, 0, 0, 1]));
          v2.setValue(0, 0, 0);
          const info = new Ammo.btRigidBodyConstructionInfo(0, motion, shape, v2);
          anchor = new Ammo.btRigidBody(info); Ammo.destroy(info); world.addRigidBody(anchor, 0, 0); garbage.push(motion, shape);
        }
        a = anchor;
      } else a = bodies[joint.a];
      const b = bodies[joint.b];
      let constraint;
      if (joint.type === 'spherical' && joint.cone === undefined) {
        v2.setValue(joint.anchorA[0], joint.anchorA[1], joint.anchorA[2]); v3.setValue(joint.anchorB[0], joint.anchorB[1], joint.anchorB[2]);
        constraint = new Ammo.btPoint2PointConstraint(a, b, v2, v3);
      } else if (joint.type === 'spherical') {
        // The cone-twist frames have their x axis along the twist axis.
        setTransform(transformB, joint.anchorB, quatFromTo([1, 0, 0], joint.twistAxisB));
        constraint = new Ammo.btConeTwistConstraint(a, b, setTransform(transform, joint.anchorA, quatFromTo([1, 0, 0], joint.twistAxisA)), transformB);
        constraint.setLimit(3, joint.twist[1]); constraint.setLimit(4, joint.cone); constraint.setLimit(5, joint.cone);
      } else {
        v2.setValue(joint.anchorA[0], joint.anchorA[1], joint.anchorA[2]); v3.setValue(joint.anchorB[0], joint.anchorB[1], joint.anchorB[2]);
        v.setValue(joint.axisA[0], joint.axisA[1], joint.axisA[2]); v4.setValue(joint.axisB[0], joint.axisB[1], joint.axisB[2]);
        constraint = new Ammo.btHingeConstraint(a, b, v2, v3, v, v4, false);
        if (joint.limits) constraint.setLimit(joint.limits[0], joint.limits[1], 0.9, 0.3, 1);
      }
      world.addConstraint(constraint, true);
      constraints.push(constraint);
    },
    finalize() {},
    step(dt) { world.stepSimulation(dt, 1, dt); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const t = bodies[i].getWorldTransform(), p = t.getOrigin(), o = i * 7;
        out[o] = p.x(); out[o + 1] = p.y(); out[o + 2] = p.z();
        const q = t.getRotation();
        out[o + 3] = q.x(); out[o + 4] = q.y(); out[o + 5] = q.z(); out[o + 6] = q.w();
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const l = bodies[i].getLinearVelocity(), o = i * 6;
        out[o] = l.x(); out[o + 1] = l.y(); out[o + 2] = l.z();
        const w = bodies[i].getAngularVelocity();
        out[o + 3] = w.x(); out[o + 4] = w.y(); out[o + 5] = w.z();
      }
    },
    awakeCount() { let awake = 0; for (const body of bodies) if (!body.isStaticObject() && body.isActive()) awake++; return awake; },
    raycastMany(origins, directions, maxDistance, out) {
      for (let i = 0; i < out.length; i++) {
        const ox = origins[i * 3], oy = origins[i * 3 + 1], oz = origins[i * 3 + 2];
        from.setValue(ox, oy, oz); to.setValue(ox + directions[i * 3] * maxDistance, oy + directions[i * 3 + 1] * maxDistance, oz + directions[i * 3 + 2] * maxDistance);
        // Reuse one callback: reset what rayTest reads and writes.
        rayCallback.set_m_closestHitFraction(1); rayCallback.set_m_collisionObject(null);
        rayCallback.get_m_rayFromWorld().setValue(ox, oy, oz); rayCallback.get_m_rayToWorld().setValue(to.x(), to.y(), to.z());
        world.rayTest(from, to, rayCallback);
        out[i] = rayCallback.hasHit() ? rayCallback.get_m_closestHitFraction() * maxDistance : -1;
      }
    },
    memoryBytes() { return Ammo.HEAP8.buffer.byteLength; },
    destroy() {
      for (const constraint of constraints) { world.removeConstraint(constraint); Ammo.destroy(constraint); }
      if (anchor) { world.removeRigidBody(anchor); Ammo.destroy(anchor); }
      for (const body of bodies) { world.removeRigidBody(body); Ammo.destroy(body); }
      for (const {shape} of shapes.values()) Ammo.destroy(shape);
      for (const item of garbage) { if (item.pointer === undefined) Ammo.destroy(item); else Ammo._free?.(item.pointer); }
      for (const item of [world, constraintSolver, broadphase, dispatcher, config, v, v2, v3, v4, transform, transformB, quaternion, from, to, rayCallback]) Ammo.destroy(item);
    },
  };
}
