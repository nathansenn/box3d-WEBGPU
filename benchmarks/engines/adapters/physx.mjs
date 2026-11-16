// NVIDIA PhysX 5 through physx-js-webidl (fabmax).
// The npm build targets browsers only and its JavaScript glue is built with assertions; in Node the adapter hides
// `process` while the module starts so that the same WASM runs here. The glue's assertions cost time on every call
// into the engine (body creation, state read-back, ray casts) but not inside a step, which is two calls.
// Setup follows the PhysX 5 guide (https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/RigidBodyDynamics.html,
// .../AdvancedCollisionDetection.html) and the binding's default filter shader (WebIdlBindings.h): shared shapes, default solver iteration counts (4 position,
// 1 velocity), PGS by default or TGS as the second variant, eENABLE_CCD on the scene and on bullets with
// eDETECT_CCD_CONTACT (word2 of the shape's filter data), D6 joints for limited ball joints (joint set-up from the
// PhysX API as the author knows it; the joints page of the guide was not reopened).
import fs from 'node:fs';
import path from 'node:path';
import {packageInfo, enginesDir, quatFromTo} from '../lib/util.mjs';

export const meta = {
  id: 'physx', name: 'PhysX', label: 'NVIDIA PhysX 5 (physx-js-webidl), PGS solver', package: 'physx-js-webidl', license: 'MIT (bindings); PhysX SDK: BSD-3-Clause', precision: 'float32',
  files: ['physx-js-webidl.wasm', 'physx-js-webidl.mjs'],
  docs: ['https://github.com/fabmax/physx-js-webidl', 'https://raw.githubusercontent.com/fabmax/PhysX/webidl-bindings/physx/source/webidlbindings/src/common/WebIdlBindings.h',
    'https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/RigidBodyDynamics.html', 'https://nvidia-omniverse.github.io/PhysX/physx/5.6.1/docs/AdvancedCollisionDetection.html'],
  defaults: 'PGS solver, 4 position and 1 velocity iteration per body',
  budget: 'position iterations = N (velocity iterations stay 1)',
};
export const SOLVER = 'pgs';

let cached = null;
export async function load(solverType = SOLVER) {
  if (!cached) {
    const dir = path.join(enginesDir, 'node_modules/physx-js-webidl');
    const factory = (await import('physx-js-webidl')).default, realProcess = globalThis.process;
    globalThis.window = globalThis;
    Object.defineProperty(globalThis, 'process', {value: undefined, configurable: true, writable: true});
    try { cached = await factory({wasmBinary: fs.readFileSync(path.join(dir, 'physx-js-webidl.wasm')), locateFile: file => path.join(dir, file)}); }
    finally { Object.defineProperty(globalThis, 'process', {value: realProcess, configurable: true, writable: true}); delete globalThis.window; }
    const px = cached, top = px.PxTopLevelFunctions.prototype;
    px.bench = {version: top.PHYSICS_VERSION};
    px.bench.foundation = top.CreateFoundation(px.bench.version, new px.PxDefaultAllocator(), new px.PxDefaultErrorCallback());
    px.bench.scale = new px.PxTolerancesScale();
    px.bench.physics = top.CreatePhysics(px.bench.version, px.bench.foundation, px.bench.scale);
    top.InitExtensions(px.bench.physics);
    px.bench.dispatcher = top.DefaultCpuDispatcherCreate(0);
  }
  const info = packageInfo('physx-js-webidl');
  return {version: `${info.version} (${info.description.replace(/^.*for Nvidia /, '')})`, createWorld: options => createWorld(cached, solverType, options)};
}

function createWorld(px, solverType, {gravity, solver, sleep}) {
  const {physics, scale, dispatcher} = px.bench, top = px.PxTopLevelFunctions.prototype;
  const sceneDesc = new px.PxSceneDesc(scale), g = new px.PxVec3(gravity[0], gravity[1], gravity[2]);
  sceneDesc.gravity = g;
  sceneDesc.cpuDispatcher = dispatcher;
  sceneDesc.filterShader = top.DefaultFilterShader();
  sceneDesc.flags.raise(px.PxSceneFlagEnum.eENABLE_CCD);
  if (solverType === 'tgs') sceneDesc.solverType = px.PxSolverTypeEnum.eTGS;
  const scene = physics.createScene(sceneDesc);
  px.destroy(sceneDesc); px.destroy(g);
  const positionIterations = solver === 'default' ? 4 : solver, velocityIterations = 1;

  const bodies = [], dynamic = [], shapes = new Map(), materials = new Map(), owned = [], canSleep = sleep !== 'off';
  const shapeFlags = new px.PxShapeFlags(px.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | px.PxShapeFlagEnum.eSIMULATION_SHAPE);
  const filter = new px.PxFilterData(1, 1, 0, 0), ccdFilter = new px.PxFilterData(1, 1, px.PxPairFlagEnum.eDETECT_CCD_CONTACT, 0);
  const pose = new px.PxTransform(px.PxIDENTITYEnum.PxIdentity), vec = new px.PxVec3(0, 0, 0), cooking = new px.PxCookingParams(scale);
  const setPose = (position, rotation) => { pose.p.x = position[0]; pose.p.y = position[1]; pose.p.z = position[2]; pose.q.x = rotation[0]; pose.q.y = rotation[1]; pose.q.z = rotation[2]; pose.q.w = rotation[3]; return pose; };
  const material = (friction, restitution) => {
    const key = `${friction},${restitution}`;
    if (!materials.has(key)) materials.set(key, physics.createMaterial(friction, friction, restitution));
    return materials.get(key);
  };
  const heapCopy = typed => { const pointer = px._webidl_malloc(typed.byteLength); new typed.constructor(px.HEAPU8.buffer, pointer, typed.length).set(typed); return pointer; };
  const geometryOf = shape => {
    switch (shape.kind) {
      case 'box': return {geometry: new px.PxBoxGeometry(shape.half[0], shape.half[1], shape.half[2])};
      case 'sphere': return {geometry: new px.PxSphereGeometry(shape.radius)};
      // PhysX capsules lie along x: the shape is turned a quarter turn about z so that its axis is the body's y.
      case 'capsule': return {geometry: new px.PxCapsuleGeometry(shape.radius, shape.halfHeight), local: [[0, 0, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]]};
      case 'hull': {
        const desc = new px.PxConvexMeshDesc(), pointer = heapCopy(shape.points);
        desc.points.count = shape.points.length / 3; desc.points.stride = 12; desc.points.data = pointer;
        desc.flags = new px.PxConvexFlags(px.PxConvexFlagEnum.eCOMPUTE_CONVEX);
        const mesh = top.CreateConvexMesh(cooking, desc);
        px._webidl_free(pointer); px.destroy(desc);
        if (!mesh) throw new Error('PhysX convex cooking failed');
        return {geometry: new px.PxConvexMeshGeometry(mesh)};
      }
      case 'mesh': {
        const desc = new px.PxTriangleMeshDesc(), points = heapCopy(shape.vertices), triangles = heapCopy(shape.indices);
        desc.points.count = shape.vertices.length / 3; desc.points.stride = 12; desc.points.data = points;
        desc.triangles.count = shape.indices.length / 3; desc.triangles.stride = 12; desc.triangles.data = triangles;
        const mesh = top.CreateTriangleMesh(cooking, desc);
        px._webidl_free(points); px._webidl_free(triangles); px.destroy(desc);
        if (!mesh) throw new Error('PhysX triangle mesh cooking failed');
        return {geometry: new px.PxTriangleMeshGeometry(mesh)};
      }
      case 'heightfield': {
        // Rows run along x and columns along z; samples are 16-bit integers scaled by heightScale.
        const {nx, nz, heights} = shape;
        let peak = 1e-6;
        for (const h of heights) peak = Math.max(peak, Math.abs(h));
        const heightScale = peak / 32000, samples = new Int16Array(nx * nz * 2);
        for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) samples[(x * nz + z) * 2] = Math.round(heights[x + z * nx] / heightScale);
        const desc = new px.PxHeightFieldDesc(), pointer = heapCopy(samples);
        desc.nbRows = nx; desc.nbColumns = nz; desc.format = px.PxHeightFieldFormatEnum.eS16_TM;
        desc.samples.count = nx * nz; desc.samples.stride = 4; desc.samples.data = pointer;
        const field = top.CreateHeightField(desc);
        px._webidl_free(pointer); px.destroy(desc);
        if (!field) throw new Error('PhysX height field creation failed');
        return {geometry: new px.PxHeightFieldGeometry(field, new px.PxMeshGeometryFlags(0), heightScale, shape.dx, shape.dz)};
      }
      default: throw new Error(`unsupported shape ${shape.kind}`);
    }
  };
  const shapeOf = desc => {
    const s = desc.shape, base = s.key ?? (s.kind === 'box' ? `b${s.half}` : s.kind === 'sphere' ? `s${s.radius}` : s.kind === 'capsule' ? `c${s.radius},${s.halfHeight}` : `u${shapes.size}`);
    const key = `${base}|${desc.friction}|${desc.restitution}|${desc.ccd}`;
    if (shapes.has(key)) return shapes.get(key);
    const {geometry, local} = geometryOf(s), shape = physics.createShape(geometry, material(desc.friction, desc.restitution), false, shapeFlags);
    if (local) shape.setLocalPose(setPose(local[0], local[1]));
    shape.setSimulationFilterData(desc.ccd ? ccdFilter : filter);
    px.destroy(geometry);
    shapes.set(key, shape);
    return shape;
  };
  const frame = (anchor, axis) => setPose(anchor, axis ? quatFromTo([1, 0, 0], axis) : [0, 0, 0, 1]);
  const frameB = new px.PxTransform(px.PxIDENTITYEnum.PxIdentity);
  const origin = new px.PxVec3(0, 0, 0), direction = new px.PxVec3(0, 0, 0), hit = new px.PxRaycastResult();

  return {
    settings: {solver: solverType.toUpperCase(), positionIterations, velocityIterations, sleeping: canSleep ? 'engine default' : 'off (sleep threshold 0)', ccd: 'eENABLE_CCD on the scene and on bullets',
      glue: 'JavaScript glue built with assertions (npm release)', rays: 'nearest of all touches (the binding has no closest-hit query)', threads: 1},
    addBody(desc) {
      const transform = setPose(desc.position, desc.rotation);
      let actor;
      if (desc.type === 'static') actor = physics.createRigidStatic(transform);
      else {
        actor = physics.createRigidDynamic(transform);
        dynamic.push(actor);
      }
      actor.attachShape(shapeOf(desc));
      if (desc.type === 'dynamic') {
        px.PxRigidBodyExt.prototype.setMassAndUpdateInertia(actor, desc.mass);
        actor.setLinearDamping(0); actor.setAngularDamping(0);
        actor.setSolverIterationCounts(positionIterations, velocityIterations);
        if (!canSleep) actor.setSleepThreshold(0);
        if (desc.ccd) actor.setRigidBodyFlag(px.PxRigidBodyFlagEnum.eENABLE_CCD, true);
        if (desc.linearVelocity) { vec.x = desc.linearVelocity[0]; vec.y = desc.linearVelocity[1]; vec.z = desc.linearVelocity[2]; actor.setLinearVelocity(vec); }
      }
      scene.addActor(actor);
      bodies.push(actor);
    },
    addJoint(joint) {
      const a = joint.a < 0 ? null : bodies[joint.a], b = bodies[joint.b];
      const copy = (anchor, axis) => { const f = frame(anchor, axis); frameB.p.x = f.p.x; frameB.p.y = f.p.y; frameB.p.z = f.p.z; frameB.q.x = f.q.x; frameB.q.y = f.q.y; frameB.q.z = f.q.z; frameB.q.w = f.q.w; };
      let created;
      if (joint.type === 'spherical' && joint.cone === undefined) {
        copy(joint.anchorB); created = top.SphericalJointCreate(physics, a, frame(joint.anchorA), b, frameB);
      } else if (joint.type === 'spherical') {
        // A D6 joint: translation locked, twist about the frame's x axis and both swings limited.
        copy(joint.anchorB, joint.twistAxisB); created = top.D6JointCreate(physics, a, frame(joint.anchorA, joint.twistAxisA), b, frameB);
        created.setMotion(px.PxD6AxisEnum.eTWIST, px.PxD6MotionEnum.eLIMITED); created.setMotion(px.PxD6AxisEnum.eSWING1, px.PxD6MotionEnum.eLIMITED); created.setMotion(px.PxD6AxisEnum.eSWING2, px.PxD6MotionEnum.eLIMITED);
        const twist = new px.PxJointAngularLimitPair(joint.twist[0], joint.twist[1]), cone = new px.PxJointLimitCone(joint.cone, joint.cone);
        created.setTwistLimit(twist); created.setSwingLimit(cone); px.destroy(twist); px.destroy(cone);
      } else {
        copy(joint.anchorB, joint.axisB); created = top.RevoluteJointCreate(physics, a, frame(joint.anchorA, joint.axisA), b, frameB);
        if (joint.limits) {
          const limit = new px.PxJointAngularLimitPair(joint.limits[0], joint.limits[1]);
          created.setLimit(limit); created.setRevoluteJointFlag(px.PxRevoluteJointFlagEnum.eLIMIT_ENABLED, true); px.destroy(limit);
        }
      }
      owned.push(created);
    },
    finalize() {},
    step(dt) { scene.simulate(dt); scene.fetchResults(true); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const t = bodies[i].getGlobalPose(), p = t.p, q = t.q, o = i * 7;
        out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.z; out[o + 3] = q.x; out[o + 4] = q.y; out[o + 5] = q.z; out[o + 6] = q.w;
      }
    },
    readVelocity(out) {
      out.fill(0);
      for (let i = 0; i < bodies.length; i++) {
        if (!bodies[i].getLinearVelocity) continue;
        const l = bodies[i].getLinearVelocity(), o = i * 6;
        out[o] = l.x; out[o + 1] = l.y; out[o + 2] = l.z;
        const w = bodies[i].getAngularVelocity();
        out[o + 3] = w.x; out[o + 4] = w.y; out[o + 5] = w.z;
      }
    },
    awakeCount() { let awake = 0; for (const actor of dynamic) if (!actor.isSleeping()) awake++; return awake; },
    raycastMany(origins, directions, maxDistance, out) {
      for (let i = 0; i < out.length; i++) {
        origin.x = origins[i * 3]; origin.y = origins[i * 3 + 1]; origin.z = origins[i * 3 + 2];
        direction.x = directions[i * 3]; direction.y = directions[i * 3 + 1]; direction.z = directions[i * 3 + 2];
        // physx-js-webidl exposes scene.raycast only with a touch buffer and without a filter callback, and PhysX then
        // reports every shape on the ray as a touch instead of one blocking hit. The nearest touch is the closest hit.
        hit.clear();
        let nearest = -1;
        if (scene.raycast(origin, direction, maxDistance, hit)) {
          for (let k = hit.getNbAnyHits() - 1; k >= 0; k--) { const d = hit.getAnyHit(k).distance; if (nearest < 0 || d < nearest) nearest = d; }
        }
        out[i] = nearest;
      }
    },
    memoryBytes() { return px.HEAPU8.buffer.byteLength; },
    destroy() {
      for (const joint of owned) joint.release();
      for (const actor of bodies) { scene.removeActor(actor); actor.release(); }
      for (const shape of shapes.values()) shape.release();
      for (const item of materials.values()) item.release();
      scene.release();
      for (const item of [shapeFlags, filter, ccdFilter, pose, vec, cooking, frameB, origin, direction, hit]) px.destroy(item);
    },
  };
}
