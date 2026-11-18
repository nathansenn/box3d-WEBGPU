// Rapier 3D, the official JS bindings (@dimforge/rapier3d-compat; adapters/rapier-simd.mjs is the WASM SIMD build).
// Setup follows https://rapier.rs/docs/user_guides/javascript/getting_started_js and
// https://rapier.rs/docs/user_guides/javascript/integration_parameters (default: 4 solver iterations, dt 1/60).
// The -compat packages carry the same WASM as @dimforge/rapier3d, inlined as base64 so that they load without a bundler.
import {packageInfo} from '../lib/util.mjs';

const describe = (id, name, pkg, simd) => ({
  id, name, label: `Rapier 3D (${simd ? 'WASM SIMD build' : 'scalar WASM build'})`, package: pkg, license: 'Apache-2.0', precision: 'float32',
  files: ['dist/rapier_wasm3d_bg.wasm', 'dist/rapier_wasm3d.js'],
  docs: ['https://rapier.rs/docs/user_guides/javascript/getting_started_js', 'https://rapier.rs/docs/user_guides/javascript/integration_parameters',
    'https://rapier.rs/docs/user_guides/javascript/rigid_bodies'],
  defaults: 'numSolverIterations 4, numInternalPgsIterations 1 (world defaults)',
  budget: 'numSolverIterations = N',
});
export const meta = describe('rapier', 'Rapier', '@dimforge/rapier3d-compat', false);
export const simdMeta = describe('rapier-simd', 'Rapier (SIMD)', '@dimforge/rapier3d-simd-compat', true);

const loaded = new Map();
export async function load(pkg = meta.package) {
  if (!loaded.has(pkg)) { const module = (await import(pkg)).default; await module.init(); loaded.set(pkg, module); }
  const RAPIER = loaded.get(pkg);
  return {version: packageInfo(pkg).version, createWorld: options => createWorld(RAPIER, options)};
}

function createWorld(RAPIER, {gravity, solver, sleep}) {
  const world = new RAPIER.World({x: gravity[0], y: gravity[1], z: gravity[2]});
  world.timestep = 1 / 60;
  if (solver !== 'default') world.numSolverIterations = solver;
  const bodies = [], canSleep = sleep !== 'off';
  const v = a => ({x: a[0], y: a[1], z: a[2]});
  let anchorBody = null;
  const fixedBody = () => anchorBody ??= world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collider = shape => {
    switch (shape.kind) {
      case 'box': return RAPIER.ColliderDesc.cuboid(shape.half[0], shape.half[1], shape.half[2]);
      case 'sphere': return RAPIER.ColliderDesc.ball(shape.radius);
      case 'capsule': return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
      case 'hull': { const desc = RAPIER.ColliderDesc.convexHull(shape.points); if (!desc) throw new Error('convexHull() failed'); return desc; }
      case 'mesh': return RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices);
      case 'heightfield': {
        // Rapier's matrix is column-major with rows along z and columns along x, and the field is centred on the collider.
        const {nx, nz, heights} = shape, data = new Float32Array(nx * nz);
        for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) data[z + x * nz] = heights[x + z * nx];
        return RAPIER.ColliderDesc.heightfield(nz - 1, nx - 1, data, {x: (nx - 1) * shape.dx, y: 1, z: (nz - 1) * shape.dz})
          .setTranslation((nx - 1) * shape.dx / 2, 0, (nz - 1) * shape.dz / 2);
      }
      default: throw new Error(`unsupported shape ${shape.kind}`);
    }
  };
  const ray = new RAPIER.Ray({x: 0, y: 0, z: 0}, {x: 0, y: 1, z: 0});
  return {
    settings: {numSolverIterations: world.numSolverIterations, numInternalPgsIterations: world.numInternalPgsIterations, sleeping: canSleep ? 'engine default' : 'off (canSleep false)',
      ccd: 'ccdEnabled on bullets', spherical: 'no cone or twist limits (not in the JS bindings)', threads: 1},
    addBody(desc) {
      const rb = desc.type === 'static' ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
      rb.setTranslation(desc.position[0], desc.position[1], desc.position[2]).setRotation({x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3]});
      if (desc.type === 'dynamic') {
        rb.setCanSleep(canSleep).setLinearDamping(0).setAngularDamping(0);
        if (desc.linearVelocity) rb.setLinvel(desc.linearVelocity[0], desc.linearVelocity[1], desc.linearVelocity[2]);
        if (desc.ccd) rb.setCcdEnabled(true);
      }
      const handle = world.createRigidBody(rb);
      world.createCollider(collider(desc.shape).setDensity(desc.density).setFriction(desc.friction).setRestitution(desc.restitution), handle);
      bodies.push(handle);
    },
    addJoint(joint) {
      const a = joint.a < 0 ? fixedBody() : bodies[joint.a], b = bodies[joint.b];
      if (joint.type === 'spherical') {
        world.createImpulseJoint(RAPIER.JointData.spherical(v(joint.anchorA), v(joint.anchorB)), a, b, true).setContactsEnabled(false);
      } else {
        const created = world.createImpulseJoint(RAPIER.JointData.revoluteWithAxes(v(joint.anchorA), v(joint.anchorB), v(joint.axisA), v(joint.axisB)), a, b, true);
        created.setContactsEnabled(false);
        if (joint.limits) created.setLimits(joint.limits[0], joint.limits[1]);
      }
    },
    finalize() {},
    step() { world.step(); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const t = bodies[i].translation(), r = bodies[i].rotation(), o = i * 7;
        out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z; out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w;
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const l = bodies[i].linvel(), w = bodies[i].angvel(), o = i * 6;
        out[o] = l.x; out[o + 1] = l.y; out[o + 2] = l.z; out[o + 3] = w.x; out[o + 4] = w.y; out[o + 5] = w.z;
      }
    },
    awakeCount() { let awake = 0; for (const rb of bodies) if (rb.isDynamic() && !rb.isSleeping()) awake++; return awake; },
    raycastMany(origins, directions, maxDistance, out) {
      for (let i = 0; i < out.length; i++) {
        ray.origin.x = origins[i * 3]; ray.origin.y = origins[i * 3 + 1]; ray.origin.z = origins[i * 3 + 2];
        ray.dir.x = directions[i * 3]; ray.dir.y = directions[i * 3 + 1]; ray.dir.z = directions[i * 3 + 2];
        const hit = world.castRay(ray, maxDistance, true);
        out[i] = hit ? hit.timeOfImpact : -1;
      }
    },
    memoryBytes() { return null; },
    destroy() { world.free(); },
  };
}
