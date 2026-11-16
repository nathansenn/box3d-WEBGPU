// This engine: the kit's PhysicsWorld on public/box3d/box3d.wasm (Box3D v0.1.0, single-threaded, WASM SIMD).
// Setup follows packages/box3d-kit/README.md: reset() for an SI world, createBody()/createJoint(), step().
// `interpolate: false` because nothing is rendered here (the default keeps a copy of the previous transforms).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// BOX3D_KIT_DIST points at another built copy of the kit (a long run measures a snapshot, so the tree can be rebuilt meanwhile).
const kitDist = process.env.BOX3D_KIT_DIST ? path.resolve(process.env.BOX3D_KIT_DIST, 'index.js') : path.join(root, 'packages/box3d-kit/dist/index.js');

export const meta = {
  id: 'box3d', name: 'This engine', label: 'box3d-webgpu-kit (Box3D v0.1.0 WASM)', package: 'box3d-webgpu-kit', license: 'MIT',
  files: ['public/box3d/box3d.wasm', 'public/box3d/box3d.js'], precision: 'float32',
  docs: ['packages/box3d-kit/README.md', 'docs/NATIVE_WORLDS.md'],
  defaults: '4 sub-steps per step (soft-step solver: one velocity pass and one relax pass per sub-step)',
  budget: 'sub-steps = N',
};

let cached = null;
export async function load() {
  if (!fs.existsSync(kitDist)) throw new Error('packages/box3d-kit/dist is missing: run `npm --prefix packages/box3d-kit run build` (benchmarks/engines/run.mjs does it for you).');
  if (!cached) { const kit = await import(pathToFileURL(kitDist).href); cached = {kit, pool: await kit.loadBox3D()}; }
  const {kit, pool} = cached;
  const version = `${JSON.parse(fs.readFileSync(path.join(root, 'packages/box3d-kit/package.json'), 'utf8')).version} (Box3D ${JSON.parse(fs.readFileSync(path.join(root, 'public/box3d/BUILD_PROVENANCE.json'), 'utf8')).box3d.ref})`;
  return {version, createWorld: options => createWorld(kit, pool, options)};
}

function createWorld(kit, pool, {gravity, solver, sleep, counts}) {
  const subSteps = solver === 'default' ? 4 : solver;
  const world = new kit.PhysicsWorld(pool, {subSteps, step: 1 / 60, interpolate: false, capacity: Math.max(4096, counts.bodies)});
  world.reset({ground: false, gravity});
  const native = world.native, bodies = [], neverSleeps = sleep === 'off';
  const shapeOf = shape => {
    switch (shape.kind) {
      case 'box': return {kind: 'box', halfExtents: shape.half};
      case 'sphere': return {kind: 'sphere', radius: shape.radius};
      case 'capsule': return {kind: 'capsule', radius: shape.radius, halfLength: shape.halfHeight};
      case 'hull': return {kind: 'hull', points: shape.points};
      case 'mesh': return {kind: 'mesh', vertices: shape.vertices, indices: shape.indices};
      case 'heightfield': return {kind: 'heightfield', heights: shape.heights, countX: shape.nx, countZ: shape.nz, spacing: [shape.dx, shape.dz]};
      default: throw new Error(`unsupported shape ${shape.kind}`);
    }
  };
  return {
    settings: {subSteps, sleeping: sleep === 'off' ? 'off (neverSleeps on every body)' : 'engine default (0.5 s at rest)', ccd: 'continuous against static shapes always on; `bullet: true` for bullets',
      contact: 'contactHertz 30, damping ratio 10, push-out 3 m/s (b3DefaultWorldDef)', threads: 1},
    addBody(desc) {
      const handle = world.createBody({shape: shapeOf(desc.shape), type: desc.type, position: desc.position, rotation: desc.rotation, density: desc.density, friction: desc.friction,
        restitution: desc.restitution, linearVelocity: desc.linearVelocity ?? undefined, bullet: desc.ccd, neverSleeps: neverSleeps && desc.type === 'dynamic'});
      if (!handle) throw new Error('the world is at body capacity');
      bodies.push(handle);
    },
    addJoint(joint) {
      const bodyA = joint.a < 0 ? null : bodies[joint.a], bodyB = bodies[joint.b];
      if (joint.type === 'spherical') {
        const limited = joint.cone !== undefined;
        world.createJoint({type: 'spherical', bodyA, bodyB,
          frameA: {position: joint.anchorA, rotation: limited ? kit.axisRotation(joint.twistAxisA) : undefined}, frameB: {position: joint.anchorB, rotation: limited ? kit.axisRotation(joint.twistAxisB) : undefined},
          ...(limited ? {coneAngle: joint.cone, limits: {lower: joint.twist[0], upper: joint.twist[1]}} : {})});
      } else {
        world.createJoint({type: 'revolute', bodyA, bodyB, frameA: {position: joint.anchorA, rotation: kit.axisRotation(joint.axisA)}, frameB: {position: joint.anchorB, rotation: kit.axisRotation(joint.axisB)},
          ...(joint.limits ? {limits: {lower: joint.limits[0], upper: joint.limits[1]}} : {})});
      }
    },
    finalize() {},
    step() { world.step(); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const s = native.bodyState(bodies[i]), o = i * 7;
        out[o] = s.position[0]; out[o + 1] = s.position[1]; out[o + 2] = s.position[2];
        out[o + 3] = s.rotation[0]; out[o + 4] = s.rotation[1]; out[o + 5] = s.rotation[2]; out[o + 6] = s.rotation[3];
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const s = native.bodyState(bodies[i]), o = i * 6;
        out[o] = s.linearVelocity[0]; out[o + 1] = s.linearVelocity[1]; out[o + 2] = s.linearVelocity[2];
        out[o + 3] = s.angularVelocity[0]; out[o + 4] = s.angularVelocity[1]; out[o + 5] = s.angularVelocity[2];
      }
    },
    awakeCount() { return world.awakeCount(); },
    // castRays(): flat arrays in, flat arrays out. BOX3D_RAYS=objects selects the older path, a queryBatch() of ray
    // objects in chunks of 128, to measure the difference; both give the same hits.
    raycastMany(origins, directions, maxDistance, out) {
      const count = out.length;
      if (process.env.BOX3D_RAYS !== 'objects' && typeof world.castRays === 'function') {
        const translations = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) translations[i] = directions[i] * maxDistance;
        world.castRays(origins, translations, out);
        for (let i = 0; i < count; i++) if (out[i] >= 0) out[i] *= maxDistance;
        return;
      }
      const batch = [];
      for (let start = 0; start < count; start += 128) {
        const end = Math.min(count, start + 128);
        batch.length = 0;
        for (let i = start; i < end; i++) {
          batch.push({kind: 'ray', origin: [origins[i * 3], origins[i * 3 + 1], origins[i * 3 + 2]],
            translation: [directions[i * 3] * maxDistance, directions[i * 3 + 1] * maxDistance, directions[i * 3 + 2] * maxDistance], limit: 1});
        }
        const results = native.queryBatch(batch);
        for (let i = start; i < end; i++) { const hits = results[i - start].hits; out[i] = hits.length ? hits[0].fraction * maxDistance : -1; }
      }
    },
    memoryBytes() { return native.HEAPF32.buffer.byteLength; },
    destroy() { world.dispose(); },
  };
}
