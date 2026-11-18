// Jolt Physics through JoltPhysics.js (npm jolt-physics): the single-threaded WASM build that the package exports by
// default. Its readme says SIMD is on only in the multi-threaded builds, so this build is scalar WASM.
// Setup follows the package readme, JoltJS.h (the JoltInterface this build exposes) and
// https://jrouwe.github.io/JoltPhysics/struct_physics_settings.html : two object layers (static / moving), shared shapes, 1 collision step,
// 10 velocity and 2 position solver steps (PhysicsSettings defaults), OptimizeBroadPhase() after bulk insertion,
// EMotionQuality_LinearCast for bullets, a GroupFilterTable to keep jointed ragdoll parts from colliding.
import {packageInfo, perpendicular} from '../lib/util.mjs';

export const meta = {
  id: 'jolt', name: 'Jolt', label: 'Jolt Physics (JoltPhysics.js, single-threaded build)', package: 'jolt-physics', license: 'MIT', precision: 'float32',
  files: ['dist/jolt-physics.wasm.wasm', 'dist/jolt-physics.wasm.js'],
  docs: ['https://github.com/jrouwe/JoltPhysics.js', 'https://raw.githubusercontent.com/jrouwe/JoltPhysics.js/main/JoltJS.h', 'https://jrouwe.github.io/JoltPhysics/struct_physics_settings.html'],
  defaults: '1 collision step, mNumVelocitySteps 10, mNumPositionSteps 2',
  budget: 'mNumVelocitySteps = N (position steps stay 2)',
};

const STATIC = 0, MOVING = 1, MAX_CONTACTS = 16384;

let cached = null;
export async function load() {
  cached ??= await (await import('jolt-physics/wasm')).default();
  const Jolt = cached;
  return {version: packageInfo('jolt-physics').version, createWorld: options => createWorld(Jolt, options)};
}

function createWorld(Jolt, {gravity, solver, sleep, counts}) {
  const settings = new Jolt.JoltSettings();
  settings.mMaxBodies = Math.max(10240, counts.bodies + 64);
  // Contact constraints are taken from the temp allocator every step, about 496 bytes each. JoltJS.h gives that
  // allocator 10 MiB and npm 1.1.1 has no setting for it (mTempAllocatorSize exists only on the main branch), so more
  // than about 20,000 constraints abort the module ("TempAllocator: Out of memory"). MAX_CONTACTS leaves room for the
  // step's other temporary data. A scene that needs more contacts than this loses them: the report says where.
  settings.mMaxBodyPairs = Math.max(65536, counts.bodies * 8);
  settings.mMaxContactConstraints = Math.min(MAX_CONTACTS, Math.max(10240, counts.bodies * 5));
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
  objectFilter.EnableCollision(STATIC, MOVING); objectFilter.EnableCollision(MOVING, MOVING);
  const bpStatic = new Jolt.BroadPhaseLayer(0), bpMoving = new Jolt.BroadPhaseLayer(1), bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(STATIC, bpStatic); bpInterface.MapObjectToBroadPhaseLayer(MOVING, bpMoving);
  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(settings.mBroadPhaseLayerInterface, 2, settings.mObjectLayerPairFilter, 2);
  const jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const system = jolt.GetPhysicsSystem(), bodyInterface = system.GetBodyInterface();
  const g = new Jolt.Vec3(gravity[0], gravity[1], gravity[2]);
  system.SetGravity(g); Jolt.destroy(g);
  const physicsSettings = system.GetPhysicsSettings();
  if (solver !== 'default') { physicsSettings.mNumVelocitySteps = solver; system.SetPhysicsSettings(physicsSettings); }
  const velocitySteps = physicsSettings.mNumVelocitySteps, positionSteps = physicsSettings.mNumPositionSteps;

  const bodies = [], shapes = new Map(), allowSleeping = sleep !== 'off';
  const v3 = a => new Jolt.Vec3(a[0], a[1], a[2]), rv3 = a => new Jolt.RVec3(a[0], a[1], a[2]);
  const created = settingsObject => { const result = settingsObject.Create(); if (result.HasError()) throw new Error(`Jolt shape: ${result.GetError().c_str()}`); const shape = result.Get(); shape.AddRef(); Jolt.destroy(settingsObject); return shape; };
  const shapeOf = shape => {
    const key = shape.key ?? (shape.kind === 'box' ? `b${shape.half}` : shape.kind === 'sphere' ? `s${shape.radius}` : shape.kind === 'capsule' ? `c${shape.radius},${shape.halfHeight}` : null);
    if (key && shapes.has(key)) return shapes.get(key);
    let made;
    switch (shape.kind) {
      case 'box': {
        // The default convex radius is 0.05 m and must be smaller than every half extent.
        const half = v3(shape.half);
        made = new Jolt.BoxShape(half, Math.min(0.05, Math.min(...shape.half) * 0.5), null); made.AddRef(); Jolt.destroy(half);
        break;
      }
      case 'sphere': made = new Jolt.SphereShape(shape.radius, null); made.AddRef(); break;
      case 'capsule': made = new Jolt.CapsuleShape(shape.halfHeight, shape.radius, null); made.AddRef(); break;
      case 'hull': {
        const hull = new Jolt.ConvexHullShapeSettings();
        for (let i = 0; i < shape.points.length; i += 3) { const p = new Jolt.Vec3(shape.points[i], shape.points[i + 1], shape.points[i + 2]); hull.mPoints.push_back(p); Jolt.destroy(p); }
        made = created(hull);
        break;
      }
      case 'mesh': {
        const vertices = new Jolt.VertexList(), triangles = new Jolt.IndexedTriangleList(), materials = new Jolt.PhysicsMaterialList();
        vertices.resize(shape.vertices.length / 3);
        new Float32Array(Jolt.HEAPF32.buffer, Jolt.getPointer(vertices.at(0)), shape.vertices.length).set(shape.vertices);
        triangles.resize(shape.indices.length / 3);
        for (let t = 0; t < shape.indices.length / 3; t++) { const tri = triangles.at(t); tri.set_mIdx(0, shape.indices[t * 3]); tri.set_mIdx(1, shape.indices[t * 3 + 1]); tri.set_mIdx(2, shape.indices[t * 3 + 2]); tri.mMaterialIndex = 0; }
        made = created(new Jolt.MeshShapeSettings(vertices, triangles, materials));
        Jolt.destroy(vertices); Jolt.destroy(triangles); Jolt.destroy(materials);
        break;
      }
      case 'heightfield': {
        if (shape.nx !== shape.nz) throw new Error('Jolt height fields are square');
        const field = new Jolt.HeightFieldShapeSettings();
        field.mSampleCount = shape.nx;
        // The block size must divide the sample count into a power of two of blocks: 64 samples / 4 = 16.
        field.mBlockSize = 4;
        const offset = new Jolt.Vec3(0, 0, 0), scale = new Jolt.Vec3(shape.dx, 1, shape.dz);
        field.mOffset = offset; field.mScale = scale; Jolt.destroy(offset); Jolt.destroy(scale);
        field.mHeightSamples.resize(shape.nx * shape.nz);
        new Float32Array(Jolt.HEAPF32.buffer, Jolt.getPointer(field.mHeightSamples.data()), shape.nx * shape.nz).set(shape.heights);
        made = created(field);
        break;
      }
      default: throw new Error(`unsupported shape ${shape.kind}`);
    }
    if (key) shapes.set(key, made);
    return made;
  };
  // Every ragdoll gets its own group; inside a group, jointed parts (sub-groups) do not collide.
  const groupFilter = new Jolt.GroupFilterTable(16); groupFilter.AddRef();
  const subGroup = new Map(), groupSize = new Map();
  const ray = new Jolt.RRayCast(), raySettings = new Jolt.RayCastSettings(), collector = new Jolt.CastRayClosestHitCollisionCollector();
  const bpFilter = new Jolt.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), MOVING), objFilter = new Jolt.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), MOVING);
  const bodyFilter = new Jolt.BodyFilter(), shapeFilter = new Jolt.ShapeFilter();

  return {
    settings: {maxContactConstraints: Math.min(MAX_CONTACTS, Math.max(10240, counts.bodies * 5)), collisionSteps: 1, mNumVelocitySteps: velocitySteps, mNumPositionSteps: positionSteps, sleeping: allowSleeping ? 'engine default' : 'off (mAllowSleeping false)',
      ccd: 'EMotionQuality_LinearCast on bullets', simd: 'off (single-threaded npm build)', threads: 1},
    addBody(desc) {
      const dynamic = desc.type === 'dynamic', position = rv3(desc.position), rotation = new Jolt.Quat(desc.rotation[0], desc.rotation[1], desc.rotation[2], desc.rotation[3]);
      const creation = new Jolt.BodyCreationSettings(shapeOf(desc.shape), position, rotation, dynamic ? Jolt.EMotionType_Dynamic : Jolt.EMotionType_Static, dynamic ? MOVING : STATIC);
      creation.mFriction = desc.friction; creation.mRestitution = desc.restitution;
      if (dynamic) {
        creation.mLinearDamping = 0; creation.mAngularDamping = 0; creation.mAllowSleeping = allowSleeping;
        creation.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia; creation.mMassPropertiesOverride.mMass = desc.mass;
        if (desc.ccd) creation.mMotionQuality = Jolt.EMotionQuality_LinearCast;
        if (desc.linearVelocity) { const lv = v3(desc.linearVelocity); creation.mLinearVelocity = lv; Jolt.destroy(lv); }
        if (desc.group >= 0) {
          const index = groupSize.get(desc.group) ?? 0;
          groupSize.set(desc.group, index + 1); subGroup.set(bodies.length, index);
          creation.mCollisionGroup.SetGroupFilter(groupFilter); creation.mCollisionGroup.SetGroupID(desc.group); creation.mCollisionGroup.SetSubGroupID(index);
        }
      }
      const body = bodyInterface.CreateBody(creation);
      bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
      Jolt.destroy(creation); Jolt.destroy(position); Jolt.destroy(rotation);
      bodies.push(body);
    },
    addJoint(joint) {
      const a = joint.a < 0 ? Jolt.JoltInterface.prototype.sGetFixedToWorldBody() : bodies[joint.a], b = bodies[joint.b];
      let constraintSettings;
      const p1 = rv3(joint.anchorA), p2 = rv3(joint.anchorB), temp = [p1, p2];
      const set = (target, name, array) => { const value = v3(array); target[name] = value; temp.push(value); };
      if (joint.type === 'spherical' && joint.cone === undefined) {
        constraintSettings = new Jolt.PointConstraintSettings();
        constraintSettings.mSpace = Jolt.EConstraintSpace_LocalToBodyCOM; constraintSettings.mPoint1 = p1; constraintSettings.mPoint2 = p2;
      } else if (joint.type === 'spherical') {
        constraintSettings = new Jolt.SwingTwistConstraintSettings();
        constraintSettings.mSpace = Jolt.EConstraintSpace_LocalToBodyCOM; constraintSettings.mPosition1 = p1; constraintSettings.mPosition2 = p2;
        set(constraintSettings, 'mTwistAxis1', joint.twistAxisA); set(constraintSettings, 'mPlaneAxis1', perpendicular(joint.twistAxisA));
        set(constraintSettings, 'mTwistAxis2', joint.twistAxisB); set(constraintSettings, 'mPlaneAxis2', perpendicular(joint.twistAxisB));
        constraintSettings.mNormalHalfConeAngle = joint.cone; constraintSettings.mPlaneHalfConeAngle = joint.cone;
        constraintSettings.mTwistMinAngle = joint.twist[0]; constraintSettings.mTwistMaxAngle = joint.twist[1];
      } else {
        constraintSettings = new Jolt.HingeConstraintSettings();
        constraintSettings.mSpace = Jolt.EConstraintSpace_LocalToBodyCOM; constraintSettings.mPoint1 = p1; constraintSettings.mPoint2 = p2;
        set(constraintSettings, 'mHingeAxis1', joint.axisA); set(constraintSettings, 'mNormalAxis1', perpendicular(joint.axisA));
        set(constraintSettings, 'mHingeAxis2', joint.axisB); set(constraintSettings, 'mNormalAxis2', perpendicular(joint.axisB));
        if (joint.limits) { constraintSettings.mLimitsMin = joint.limits[0]; constraintSettings.mLimitsMax = joint.limits[1]; }
      }
      system.AddConstraint(constraintSettings.Create(a, b));
      Jolt.destroy(constraintSettings); for (const value of temp) Jolt.destroy(value);
      if (joint.a >= 0 && subGroup.has(joint.a) && subGroup.has(joint.b)) groupFilter.DisableCollision(subGroup.get(joint.a), subGroup.get(joint.b));
    },
    finalize() { system.OptimizeBroadPhase(); },
    step(dt) { jolt.Step(dt, 1); },
    readState(out) {
      for (let i = 0; i < bodies.length; i++) {
        const p = bodies[i].GetPosition(), o = i * 7;
        out[o] = p.GetX(); out[o + 1] = p.GetY(); out[o + 2] = p.GetZ();
        const q = bodies[i].GetRotation();
        out[o + 3] = q.GetX(); out[o + 4] = q.GetY(); out[o + 5] = q.GetZ(); out[o + 6] = q.GetW();
      }
    },
    readVelocity(out) {
      for (let i = 0; i < bodies.length; i++) {
        const l = bodies[i].GetLinearVelocity(), o = i * 6;
        out[o] = l.GetX(); out[o + 1] = l.GetY(); out[o + 2] = l.GetZ();
        const w = bodies[i].GetAngularVelocity();
        out[o + 3] = w.GetX(); out[o + 4] = w.GetY(); out[o + 5] = w.GetZ();
      }
    },
    awakeCount() { return system.GetNumActiveBodies(Jolt.EBodyType_RigidBody); },
    raycastMany(origins, directions, maxDistance, out) {
      const query = system.GetNarrowPhaseQuery(), origin = ray.mOrigin, direction = ray.mDirection;
      for (let i = 0; i < out.length; i++) {
        origin.Set(origins[i * 3], origins[i * 3 + 1], origins[i * 3 + 2]);
        direction.Set(directions[i * 3] * maxDistance, directions[i * 3 + 1] * maxDistance, directions[i * 3 + 2] * maxDistance);
        collector.Reset();
        query.CastRay(ray, raySettings, collector, bpFilter, objFilter, bodyFilter, shapeFilter);
        out[i] = collector.HadHit() ? collector.mHit.mFraction * maxDistance : -1;
      }
    },
    memoryBytes() { return Jolt.HEAPF32.buffer.byteLength; },
    destroy() {
      for (const item of [ray, raySettings, collector, bpFilter, objFilter, bodyFilter, shapeFilter]) Jolt.destroy(item);
      Jolt.destroy(jolt);
      for (const shape of shapes.values()) shape.Release();
      groupFilter.Release();
    },
  };
}
