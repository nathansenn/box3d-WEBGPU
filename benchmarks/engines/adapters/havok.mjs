// Havok Physics for the web (@babylonjs/havok), driven through its HP_* interface the way Babylon.js's HavokPlugin
// does (https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Physics/v2/Plugins/havokPlugin.ts).
// Licence: the package ships an MIT LICENSE file, and https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin
// says "It is available free to use under the MIT license."
// The interface has no setting for solver iterations, sub-steps or continuous collision: the engine's own defaults
// are all there is, so the "equal budget" row repeats the default.
import fs from 'node:fs';
import path from 'node:path';
import {packageInfo, enginesDir, perpendicular} from '../lib/util.mjs';

export const meta = {
  id: 'havok', name: 'Havok', label: 'Havok Physics (@babylonjs/havok WASM)', package: '@babylonjs/havok', license: 'MIT', precision: 'float32',
  files: ['lib/esm/HavokPhysics.wasm', 'lib/esm/HavokPhysics_es.js'],
  docs: ['https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin', 'https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Physics/v2/Plugins/havokPlugin.ts'],
  defaults: 'HP_World_Step(1/60); solver settings are not exposed',
  budget: 'not configurable: same as default',
};

let cached = null;
export async function load() {
  if (!cached) {
    const dir = path.join(enginesDir, 'node_modules/@babylonjs/havok/lib/esm');
    cached = await (await import('@babylonjs/havok')).default({wasmBinary: fs.readFileSync(path.join(dir, 'HavokPhysics.wasm'))});
  }
  return {version: packageInfo('@babylonjs/havok').version, createWorld: options => createWorld(cached, options)};
}

function createWorld(HK, {gravity, sleep}) {
  const ok = result => { if (result[0] !== HK.Result.RESULT_OK) throw new Error('Havok call failed'); return result[1]; };
  const check = result => { if (result !== HK.Result.RESULT_OK) throw new Error('Havok call failed'); };
  const world = ok(HK.HP_World_Create());
  check(HK.HP_World_SetGravity(world, gravity));
  check(HK.HP_World_SetIdealStepTime(world, 1 / 60));
  const bodies = [], dynamic = [], shapes = new Map(), constraints = [], canSleep = sleep !== 'off';
  let anchor = null;
  const heapCopy = typed => { const pointer = HK._malloc(typed.byteLength); new typed.constructor(HK.HEAPU8.buffer, pointer, typed.length).set(typed); return pointer; };
  const shapeOf = desc => {
    const s = desc.shape, base = s.key ?? (s.kind === 'box' ? `b${s.half}` : s.kind === 'sphere' ? `s${s.radius}` : s.kind === 'capsule' ? `c${s.radius},${s.halfHeight}` : `u${shapes.size}`);
    const key = `${base}|${desc.friction}|${desc.restitution}`;
    if (shapes.has(key)) return shapes.get(key);
    let shape, offset = null;
    switch (s.kind) {
      case 'box': shape = ok(HK.HP_Shape_CreateBox([0, 0, 0], [0, 0, 0, 1], [2 * s.half[0], 2 * s.half[1], 2 * s.half[2]])); break;
      case 'sphere': shape = ok(HK.HP_Shape_CreateSphere([0, 0, 0], s.radius)); break;
      case 'capsule': shape = ok(HK.HP_Shape_CreateCapsule([0, -s.halfHeight, 0], [0, s.halfHeight, 0], s.radius)); break;
      case 'hull': { const pointer = heapCopy(s.points); shape = ok(HK.HP_Shape_CreateConvexHull(pointer, s.points.length / 3)); HK._free(pointer); break; }
      case 'mesh': {
        const vertices = heapCopy(s.vertices), triangles = heapCopy(Int32Array.from(s.indices));
        shape = ok(HK.HP_Shape_CreateMesh(vertices, s.vertices.length / 3, triangles, s.indices.length / 3));
        HK._free(vertices); HK._free(triangles);
        break;
      }
      case 'heightfield': {
        // Found with the placement check in scenes.mjs (probe-heightfield): the field is centred on the shape origin in
        // x and z, and the samples are stored x-major (index z + x * nz).
        const data = new Float32Array(s.nx * s.nz);
        for (let z = 0; z < s.nz; z++) for (let x = 0; x < s.nx; x++) data[z + x * s.nz] = s.heights[x + z * s.nx];
        const pointer = heapCopy(data);
        shape = ok(HK.HP_Shape_CreateHeightField(s.nx, s.nz, [s.dx, 1, s.dz], pointer));
        HK._free(pointer);
        offset = [(s.nx - 1) * s.dx / 2, 0, (s.nz - 1) * s.dz / 2];
        break;
      }
      default: throw new Error(`unsupported shape ${s.kind}`);
    }
    check(HK.HP_Shape_SetMaterial(shape, [desc.friction, desc.friction, desc.restitution, HK.MaterialCombine.GEOMETRIC_MEAN, HK.MaterialCombine.MAXIMUM]));
    check(HK.HP_Shape_SetDensity(shape, 1000));
    const entry = {shape, offset, unitMass: s.kind === 'mesh' || s.kind === 'heightfield' ? null : ok(HK.HP_Shape_BuildMassProperties(shape))};
    shapes.set(key, entry);
    return entry;
  };
  const collector = ok(HK.HP_QueryCollector_Create(1)), noBody = [BigInt(0)];

  return {
    settings: {step: 'HP_World_Step(1/60)', solver: 'engine default (not exposed)', sleeping: canSleep ? 'engine default' : 'off (ALWAYS_ACTIVE)', ccd: 'engine default (not exposed)', speedLimit: '200 m/s (default)', threads: 1},
    addBody(desc) {
      const {shape, offset, unitMass} = shapeOf(desc), body = ok(HK.HP_Body_Create()), isDynamic = desc.type === 'dynamic';
      check(HK.HP_Body_SetShape(body, shape));
      check(HK.HP_Body_SetMotionType(body, isDynamic ? HK.MotionType.DYNAMIC : HK.MotionType.STATIC));
      const position = offset ? [desc.position[0] + offset[0], desc.position[1] + offset[1], desc.position[2] + offset[2]] : desc.position;
      check(HK.HP_Body_SetQTransform(body, [position, desc.rotation]));
      if (isDynamic) {
        // The shape's centre of mass and unit inertia with this body's own mass.
        check(HK.HP_Body_SetMassProperties(body, [unitMass[0], desc.mass, unitMass[2], unitMass[3]]));
        check(HK.HP_Body_SetLinearDamping(body, 0)); check(HK.HP_Body_SetAngularDamping(body, 0));
        if (!canSleep) check(HK.HP_Body_SetActivationControl(body, HK.ActivationControl.ALWAYS_ACTIVE));
        dynamic.push(body);
      }
      check(HK.HP_World_AddBody(world, body, false));
      if (isDynamic && desc.linearVelocity) check(HK.HP_Body_SetLinearVelocity(body, desc.linearVelocity));
      bodies.push(body);
    },
    addJoint(joint) {
      let a;
      if (joint.a < 0) {
        if (!anchor) {
          // The fixed world: a static body at the origin whose shape collides with nothing.
          const shape = ok(HK.HP_Shape_CreateSphere([0, 0, 0], 0.01));
          check(HK.HP_Shape_SetFilterInfo(shape, [0, 0]));
          anchor = ok(HK.HP_Body_Create());
          check(HK.HP_Body_SetShape(anchor, shape)); check(HK.HP_Body_SetMotionType(anchor, HK.MotionType.STATIC));
          check(HK.HP_Body_SetQTransform(anchor, [[0, 0, 0], [0, 0, 0, 1]])); check(HK.HP_World_AddBody(world, anchor, false));
        }
        a = anchor;
      } else a = bodies[joint.a];
      const constraint = ok(HK.HP_Constraint_Create()), A = HK.ConstraintAxis, M = HK.ConstraintAxisLimitMode;
      check(HK.HP_Constraint_SetParentBody(constraint, a)); check(HK.HP_Constraint_SetChildBody(constraint, bodies[joint.b]));
      // Constraint space x is the hinge axis, or the twist axis of a limited ball joint.
      const xA = joint.type === 'revolute' ? joint.axisA : joint.twistAxisA ?? [1, 0, 0], xB = joint.type === 'revolute' ? joint.axisB : joint.twistAxisB ?? [1, 0, 0];
      check(HK.HP_Constraint_SetAnchorInParent(constraint, joint.anchorA, xA, perpendicular(xA)));
      check(HK.HP_Constraint_SetAnchorInChild(constraint, joint.anchorB, xB, perpendicular(xB)));
      for (const axis of [A.LINEAR_X, A.LINEAR_Y, A.LINEAR_Z]) check(HK.HP_Constraint_SetAxisMode(constraint, axis, M.LOCKED));
      const limit = (axis, low, high) => { check(HK.HP_Constraint_SetAxisMode(constraint, axis, M.LIMITED)); check(HK.HP_Constraint_SetAxisMinLimit(constraint, axis, low)); check(HK.HP_Constraint_SetAxisMaxLimit(constraint, axis, high)); };
      if (joint.type === 'revolute') {
        check(HK.HP_Constraint_SetAxisMode(constraint, A.ANGULAR_Y, M.LOCKED)); check(HK.HP_Constraint_SetAxisMode(constraint, A.ANGULAR_Z, M.LOCKED));
        if (joint.limits) limit(A.ANGULAR_X, joint.limits[0], joint.limits[1]);
      } else if (joint.cone !== undefined) {
        // Twist about x, and each swing axis limited to the cone's half-angle.
        limit(A.ANGULAR_X, joint.twist[0], joint.twist[1]); limit(A.ANGULAR_Y, -joint.cone, joint.cone); limit(A.ANGULAR_Z, -joint.cone, joint.cone);
      }
      check(HK.HP_Constraint_SetCollisionsEnabled(constraint, 0));
      check(HK.HP_Constraint_SetEnabled(constraint, 1));
      constraints.push(constraint);
    },
    finalize() {},
    step(dt) { HK.HP_World_Step(world, dt); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const t = HK.HP_Body_GetQTransform(bodies[i])[1], p = t[0], q = t[1], o = i * 7;
        out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = q[0]; out[o + 4] = q[1]; out[o + 5] = q[2]; out[o + 6] = q[3];
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const l = HK.HP_Body_GetLinearVelocity(bodies[i])[1], w = HK.HP_Body_GetAngularVelocity(bodies[i])[1], o = i * 6;
        out[o] = l[0]; out[o + 1] = l[1]; out[o + 2] = l[2]; out[o + 3] = w[0]; out[o + 4] = w[1]; out[o + 5] = w[2];
      }
    },
    awakeCount() { let awake = 0; for (const body of dynamic) if (HK.HP_Body_GetActivationState(body)[1] === HK.ActivationState.ACTIVE) awake++; return awake; },
    raycastMany(origins, directions, maxDistance, out) {
      const start = [0, 0, 0], end = [0, 0, 0], query = [start, end, [-1, -1], false, noBody];
      for (let i = 0; i < out.length; i++) {
        start[0] = origins[i * 3]; start[1] = origins[i * 3 + 1]; start[2] = origins[i * 3 + 2];
        end[0] = start[0] + directions[i * 3] * maxDistance; end[1] = start[1] + directions[i * 3 + 1] * maxDistance; end[2] = start[2] + directions[i * 3 + 2] * maxDistance;
        HK.HP_World_CastRayWithCollector(world, collector, query);
        out[i] = HK.HP_QueryCollector_GetNumHits(collector)[1] > 0 ? HK.HP_QueryCollector_GetCastRayResult(collector, 0)[1][0] * maxDistance : -1;
      }
    },
    memoryBytes() { return HK.HEAPU8.buffer.byteLength; },
    destroy() {
      for (const constraint of constraints) { HK.HP_Constraint_SetEnabled(constraint, 0); HK.HP_Constraint_Release(constraint); }
      for (const body of anchor ? [...bodies, anchor] : bodies) { HK.HP_World_RemoveBody(world, body); HK.HP_Body_Release(body); }
      for (const {shape} of shapes.values()) HK.HP_Shape_Release(shape);
      HK.HP_QueryCollector_Release(collector);
      HK.HP_World_Release(world);
    },
  };
}
