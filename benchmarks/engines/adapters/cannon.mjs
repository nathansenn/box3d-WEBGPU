// cannon-es: a pure JavaScript engine (no WASM), double precision.
// Setup follows https://pmndrs.github.io/cannon-es/docs/ and the package readme: World with gravity, SAPBroadphase for
// many bodies, GSSolver with 10 iterations (the default), world.step(1/60).
// Limits that matter here, all stated in the report: no capsule shape (emulated here by a compound of one 12-sided
// cylinder and two spheres), a Trimesh collides only with spheres and planes, hinge
// constraints have no angle limits (elbows and knees use ConeTwistConstraint), and there is no continuous collision.
import {packageInfo} from '../lib/util.mjs';

export const meta = {
  id: 'cannon', name: 'cannon-es', label: 'cannon-es (JavaScript)', package: 'cannon-es', license: 'MIT', precision: 'float64',
  files: ['dist/cannon-es.js'],
  docs: ['https://pmndrs.github.io/cannon-es/docs/classes/World.html', 'https://pmndrs.github.io/cannon-es/docs/classes/GSSolver.html', 'https://pmndrs.github.io/cannon-es/docs/classes/SAPBroadphase.html'],
  defaults: 'GSSolver, 10 iterations, SAPBroadphase',
  budget: 'solver.iterations = N',
};

export async function load() {
  const CANNON = await import('cannon-es');
  return {version: packageInfo('cannon-es').version, createWorld: options => createWorld(CANNON, options)};
}

function createWorld(CANNON, {gravity, solver, sleep}) {
  const world = new CANNON.World({gravity: new CANNON.Vec3(gravity[0], gravity[1], gravity[2])});
  world.broadphase = new CANNON.SAPBroadphase(world);
  if (solver !== 'default') world.solver.iterations = solver;
  // cannon-es ships with sleeping off; the 'default' sleep policy turns it on with its own thresholds so that the
  // sleep measurements have something to report.
  world.allowSleep = sleep === 'default';
  const bodies = [], cache = new Map(), vec = a => new CANNON.Vec3(a[0], a[1], a[2]);
  let materialSet = false, staticAnchor = null;
  const shapesOf = shape => {
    switch (shape.kind) {
      case 'box': return [[new CANNON.Box(vec(shape.half))]];
      case 'sphere': return [[new CANNON.Sphere(shape.radius)]];
      case 'capsule': {
        // A cylinder along y capped by two spheres.
        const cylinder = new CANNON.Cylinder(shape.radius, shape.radius, 2 * shape.halfHeight, 12);
        return [[cylinder], [new CANNON.Sphere(shape.radius), new CANNON.Vec3(0, shape.halfHeight, 0)], [new CANNON.Sphere(shape.radius), new CANNON.Vec3(0, -shape.halfHeight, 0)]];
      }
      case 'hull': {
        const vertices = [];
        for (let i = 0; i < shape.points.length; i += 3) vertices.push(new CANNON.Vec3(shape.points[i], shape.points[i + 1], shape.points[i + 2]));
        return [[new CANNON.ConvexPolyhedron({vertices, faces: shape.faces.map(face => [...face])})]];
      }
      case 'mesh': return [[new CANNON.Trimesh(Array.from(shape.vertices), Array.from(shape.indices))]];
      case 'heightfield': {
        // cannon-es height fields are data[x][y] with height along local z; the body is turned so that local z is world y.
        const data = [];
        for (let x = 0; x < shape.nx; x++) { const column = []; for (let z = 0; z < shape.nz; z++) column.push(shape.heights[x + (shape.nz - 1 - z) * shape.nx]); data.push(column); }
        return [[new CANNON.Heightfield(data, {elementSize: shape.dx})]];
      }
      default: throw new Error(`unsupported shape ${shape.kind}`);
    }
  };
  const result = new CANNON.RaycastResult(), from = new CANNON.Vec3(), to = new CANNON.Vec3();
  return {
    settings: {solver: 'GSSolver', iterations: world.solver.iterations, broadphase: 'SAPBroadphase', sleeping: world.allowSleep ? 'allowSleep on (off by default)' : 'off',
      ccd: 'none', capsule: 'cylinder + two spheres', hingeLimits: 'ConeTwistConstraint instead', threads: 1},
    addBody(desc) {
      if (!materialSet) { world.defaultContactMaterial.friction = desc.friction; world.defaultContactMaterial.restitution = desc.restitution; materialSet = true; }
      const key = desc.shape.key ?? (desc.shape.kind === 'box' ? `b${desc.shape.half}` : desc.shape.kind === 'sphere' ? `s${desc.shape.radius}` : desc.shape.kind === 'capsule' ? `c${desc.shape.radius},${desc.shape.halfHeight}` : null);
      let parts = key ? cache.get(key) : null;
      if (!parts) { parts = shapesOf(desc.shape); if (key) cache.set(key, parts); }
      const body = new CANNON.Body({mass: desc.type === 'static' ? 0 : desc.mass, type: desc.type === 'static' ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC, linearDamping: 0, angularDamping: 0,
        position: vec(desc.position), quaternion: new CANNON.Quaternion(desc.rotation[0], desc.rotation[1], desc.rotation[2], desc.rotation[3])});
      for (const [shape, offset] of parts) body.addShape(shape, offset);
      if (desc.shape.kind === 'heightfield') {
        body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        body.position.set(desc.position[0], desc.position[1], desc.position[2] + (desc.shape.nz - 1) * desc.shape.dz);
      }
      if (desc.linearVelocity) body.velocity.set(desc.linearVelocity[0], desc.linearVelocity[1], desc.linearVelocity[2]);
      // A restitution that differs from the scene's default (the bouncing sphere) needs its own material pair.
      if (desc.restitution !== world.defaultContactMaterial.restitution || desc.friction !== world.defaultContactMaterial.friction) {
        body.material = new CANNON.Material();
        for (const other of bodies) if (other.material) world.addContactMaterial(new CANNON.ContactMaterial(body.material, other.material, {friction: desc.friction, restitution: desc.restitution}));
      } else body.material = world.defaultMaterial;
      world.addBody(body);
      bodies.push(body);
    },
    addJoint(joint) {
      let a;
      if (joint.a < 0) {
        // The fixed world: a static body at the origin, so the world anchor is its local anchor.
        staticAnchor ??= (() => { const b = new CANNON.Body({mass: 0, type: CANNON.Body.STATIC}); world.addBody(b); return b; })();
        a = staticAnchor;
      } else a = bodies[joint.a];
      const b = bodies[joint.b], pivotA = vec(joint.anchorA), pivotB = vec(joint.anchorB);
      let constraint;
      if (joint.type === 'spherical' && joint.cone === undefined) constraint = new CANNON.PointToPointConstraint(a, pivotA, b, pivotB);
      else if (joint.type === 'spherical') constraint = new CANNON.ConeTwistConstraint(a, b, {pivotA, pivotB, axisA: vec(joint.twistAxisA), axisB: vec(joint.twistAxisB), angle: joint.cone, twistAngle: joint.twist[1], collideConnected: false});
      else if (joint.limits) {
        // No hinge limits in cannon-es: a cone about the limb direction with the hinge range as its half-angle.
        const limb = [joint.anchorB[0], joint.anchorB[1], joint.anchorB[2]], n = Math.hypot(...limb) || 1, axis = new CANNON.Vec3(limb[0] / n, limb[1] / n, limb[2] / n);
        constraint = new CANNON.ConeTwistConstraint(a, b, {pivotA, pivotB, axisA: axis, axisB: axis, angle: joint.limits[1], twistAngle: 0.1, collideConnected: false});
      } else constraint = new CANNON.HingeConstraint(a, b, {pivotA, pivotB, axisA: vec(joint.axisA), axisB: vec(joint.axisB), collideConnected: false});
      constraint.collideConnected = false;
      world.addConstraint(constraint);
    },
    finalize() {},
    step(dt) { world.step(dt); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const p = bodies[i].position, q = bodies[i].quaternion, o = i * 7;
        out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z; out[o + 3] = q.x; out[o + 4] = q.y; out[o + 5] = q.z; out[o + 6] = q.w;
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const l = bodies[i].velocity, w = bodies[i].angularVelocity, o = i * 6;
        out[o] = l.x; out[o + 1] = l.y; out[o + 2] = l.z; out[o + 3] = w.x; out[o + 4] = w.y; out[o + 5] = w.z;
      }
    },
    awakeCount() { if (!world.allowSleep) return null; let awake = 0; for (const body of bodies) if (body.type === CANNON.Body.DYNAMIC && body.sleepState !== CANNON.Body.SLEEPING) awake++; return awake; },
    raycastMany(origins, directions, maxDistance, out) {
      for (let i = 0; i < out.length; i++) {
        from.set(origins[i * 3], origins[i * 3 + 1], origins[i * 3 + 2]);
        to.set(from.x + directions[i * 3] * maxDistance, from.y + directions[i * 3 + 1] * maxDistance, from.z + directions[i * 3 + 2] * maxDistance);
        result.reset();
        out[i] = world.raycastClosest(from, to, {}, result) ? result.distance : -1;
      }
    },
    memoryBytes() { return null; },
    destroy() {},
  };
}
