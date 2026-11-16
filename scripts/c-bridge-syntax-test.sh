#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CC_BIN="${CC:-}"
if [[ -z "$CC_BIN" ]]; then
  if command -v clang >/dev/null 2>&1; then
    CC_BIN="clang"
  elif command -v cc >/dev/null 2>&1; then
    CC_BIN="cc"
  elif command -v gcc >/dev/null 2>&1; then
    CC_BIN="gcc"
  else
    echo "C bridge syntax test requires clang, cc, or gcc." >&2
    exit 1
  fi
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/box3d"

cat > "$TMP_DIR/box3d/box3d.h" <<'STUB'
#ifndef BOX3D_BOX3D_H
#define BOX3D_BOX3D_H
#include <stdbool.h>
#include <stdint.h>

typedef struct { uint16_t index1; uint16_t generation; } b3WorldId;
typedef struct { int32_t index1; uint16_t world0; uint16_t generation; } b3BodyId;
typedef struct { int32_t index1; uint16_t world0; uint16_t generation; } b3ShapeId;
typedef struct { float x, y, z; } b3Vec3;
typedef struct { float x, y, z; } b3Pos;
typedef struct { b3Vec3 v; float s; } b3Quat;
typedef struct { b3Pos p; b3Quat q; } b3WorldTransform;
typedef enum { b3_staticBody = 0, b3_kinematicBody = 1, b3_dynamicBody = 2 } b3BodyType;
typedef struct { bool linearX, linearY, linearZ, angularX, angularY, angularZ; } b3MotionLocks;
typedef struct {
  b3BodyType type; b3Pos position; b3Quat rotation; b3Vec3 linearVelocity; b3Vec3 angularVelocity;
  float linearDamping, angularDamping, gravityScale; b3MotionLocks motionLocks; bool enableSleep, isBullet;
} b3BodyDef;
typedef struct { uint64_t categoryBits, maskBits; int groupIndex; } b3Filter;
typedef struct { float friction; float restitution; uint32_t customColor; } b3SurfaceMaterial;
typedef struct {
  float density; b3SurfaceMaterial baseMaterial; b3Filter filter;
  bool isSensor, enableSensorEvents, enableContactEvents, enableHitEvents;
} b3ShapeDef;
typedef struct { b3Vec3 center; float radius; } b3Sphere;
typedef struct { b3Vec3 center1, center2; float radius; } b3Capsule;
typedef struct b3MeshData b3MeshData;
typedef struct b3HeightFieldData b3HeightFieldData;
typedef struct { b3Vec3* vertices; int32_t* indices; uint8_t* materialIndices; float weldTolerance; int vertexCount, triangleCount; bool weldVertices, useMedianSplit, identifyEdges; } b3MeshDef;
typedef struct { float* heights; uint8_t* materialIndices; b3Vec3 scale; int countX, countZ; float globalMinimumHeight, globalMaximumHeight; bool clockwiseWinding; } b3HeightFieldDef;
typedef struct { int32_t index1; uint16_t world0; uint16_t generation; } b3JointId;
typedef struct { b3Vec3 p; b3Quat q; } b3Transform;
typedef struct { b3Vec3 cx, cy, cz; } b3Matrix3;
typedef struct { float mass; b3Vec3 center; b3Matrix3 inertia; } b3MassData;
typedef enum { b3_parallelJoint, b3_distanceJoint, b3_filterJoint, b3_motorJoint, b3_prismaticJoint, b3_revoluteJoint, b3_sphericalJoint, b3_weldJoint, b3_wheelJoint } b3JointType;
typedef struct { b3BodyId bodyIdA, bodyIdB; b3Transform localFrameA, localFrameB; float forceThreshold, torqueThreshold, constraintHertz, constraintDampingRatio; bool collideConnected; } b3JointDef;
typedef struct { b3JointDef base; float linearHertz, angularHertz, linearDampingRatio, angularDampingRatio; } b3WeldJointDef;
typedef struct { b3JointDef base; float targetAngle; bool enableSpring; float hertz, dampingRatio; bool enableLimit; float lowerAngle, upperAngle; bool enableMotor; float maxMotorTorque, motorSpeed; } b3RevoluteJointDef;
typedef struct { b3JointDef base; bool enableSpring; float hertz, dampingRatio; bool enableConeLimit; float coneAngle; bool enableTwistLimit; float lowerTwistAngle, upperTwistAngle; bool enableMotor; float maxMotorTorque; } b3SphericalJointDef;
typedef struct { b3JointDef base; bool enableSpring; float hertz, dampingRatio, targetTranslation; bool enableLimit; float lowerTranslation, upperTranslation; bool enableMotor; float maxMotorForce, motorSpeed; } b3PrismaticJointDef;
typedef struct { b3JointDef base; float length; bool enableSpring; float hertz, dampingRatio; bool enableLimit; float minLength, maxLength; bool enableMotor; float maxMotorForce, motorSpeed; } b3DistanceJointDef;
typedef struct { b3JointDef base; bool enableSuspensionSpring; float suspensionHertz, suspensionDampingRatio; bool enableSuspensionLimit; float lowerSuspensionLimit, upperSuspensionLimit; bool enableSpinMotor; float maxSpinTorque, spinSpeed; } b3WheelJointDef;
typedef struct { b3ShapeId shapeIdA, shapeIdB; } b3ContactBeginTouchEvent;
typedef struct { b3ShapeId shapeIdA, shapeIdB; } b3ContactEndTouchEvent;
typedef struct { b3ShapeId shapeIdA, shapeIdB; b3Pos point; b3Vec3 normal; float approachSpeed; } b3ContactHitEvent;
typedef struct { b3ContactBeginTouchEvent* beginEvents; b3ContactEndTouchEvent* endEvents; b3ContactHitEvent* hitEvents; int beginCount, endCount, hitCount; } b3ContactEvents;
typedef struct { b3ShapeId sensorShapeId, visitorShapeId; } b3SensorBeginTouchEvent;
typedef struct { b3ShapeId sensorShapeId, visitorShapeId; } b3SensorEndTouchEvent;
typedef struct { b3SensorBeginTouchEvent* beginEvents; b3SensorEndTouchEvent* endEvents; int beginCount, endCount; } b3SensorEvents;
typedef struct b3HullData { int unused; } b3HullData;
typedef struct { b3HullData base; } b3BoxHull;
typedef void b3TaskCallback(void* taskContext);
typedef void* b3EnqueueTaskCallback(b3TaskCallback* task, void* taskContext, void* userContext, const char* taskName);
typedef void b3FinishTaskCallback(void* userTask, void* userContext);
#define B3_MAX_WORKERS 32
typedef struct {
  b3Vec3 gravity;
  uint32_t workerCount;
  b3EnqueueTaskCallback* enqueueTask;
  b3FinishTaskCallback* finishTask;
  void* userTaskContext;
  bool enableSleep;
  bool enableContinuous;
} b3WorldDef;
typedef struct { int bodyCount, shapeCount, contactCount, jointCount, islandCount, stackUsed, arenaCapacity, staticTreeHeight, treeHeight, satCallCount, satCacheHitCount, byteCount, taskCount, awakeContactCount, recycledContactCount; } b3Counters;
typedef struct { float step, pairs, collide, solve, solverSetup, constraints, prepareConstraints, integrateVelocities, warmStart, solveImpulses, integratePositions, relaxImpulses, applyRestitution, storeImpulses, splitIslands, transforms, sensorHits, jointEvents, hitEvents, refit, bullets, sleepIslands, sensors; } b3Profile;
typedef struct { uint64_t categoryBits, maskBits; uint64_t id; const char* name; } b3QueryFilter;
typedef struct { b3Vec3 lowerBound, upperBound; } b3AABB;
typedef struct { const b3Vec3* points; int count; float radius; } b3ShapeProxy;
typedef struct { int nodeVisits, leafVisits; } b3TreeStats;
typedef bool b3OverlapResultFcn(b3ShapeId, void*);
typedef float b3CastResultFcn(b3ShapeId, b3Pos, b3Vec3, float, uint64_t, int, int, void*);
typedef struct { b3JointDef base; b3Vec3 linearVelocity; float maxVelocityForce; b3Vec3 angularVelocity; float maxVelocityTorque, linearHertz, linearDampingRatio, maxSpringForce, angularHertz, angularDampingRatio, maxSpringTorque; } b3MotorJointDef;
typedef struct { b3JointDef base; float hertz, dampingRatio, maxTorque; } b3ParallelJointDef;
typedef struct { b3JointDef base; } b3FilterJointDef;
typedef struct { b3JointId jointId; void* userData; } b3JointEvent;
typedef struct { b3JointEvent* jointEvents; int count; } b3JointEvents;
typedef struct { uint64_t maskBits; b3Pos position; float radius, falloff, impulsePerArea; } b3ExplosionDef;
typedef struct { b3Vec3 normal; float offset; } b3Plane;
typedef struct { b3Plane plane; b3Vec3 point; } b3PlaneResult;
typedef struct { b3Plane plane; float pushLimit, push; bool clipVelocity; } b3CollisionPlane;
typedef struct { b3Vec3 delta; int iterationCount; } b3PlaneSolverResult;
typedef bool b3PlaneResultFcn(b3ShapeId, const b3PlaneResult*, int, void*);
typedef bool b3MoverFilterFcn(b3ShapeId, void*);
typedef int b3HexColor;
typedef struct {
  bool (*DrawShapeFcn)(void*, b3WorldTransform, b3HexColor, void*);
  void (*DrawSegmentFcn)(b3Pos, b3Pos, b3HexColor, void*);
  void (*DrawTransformFcn)(b3WorldTransform, void*);
  void (*DrawPointFcn)(b3Pos, float, b3HexColor, void*);
  void (*DrawSphereFcn)(b3Pos, float, b3HexColor, float, void*);
  void (*DrawCapsuleFcn)(b3Pos, b3Pos, float, b3HexColor, float, void*);
  void (*DrawBoundsFcn)(b3AABB, b3HexColor, void*);
  void (*DrawBoxFcn)(b3Vec3, b3WorldTransform, b3HexColor, void*);
  void (*DrawStringFcn)(b3Pos, const char*, b3HexColor, void*);
  b3AABB drawingBounds; float forceScale, jointScale;
  bool drawShapes, drawJoints, drawJointExtras, drawBounds, drawMass, drawBodyNames, drawContacts;
  int drawAnchorA;
  bool drawGraphColors, drawContactFeatures, drawContactNormals, drawContactForces, drawFrictionForces, drawIslands;
  void* context;
} b3DebugDraw;

#define B3_IS_NULL(id) ((id).index1 == 0)
#define B3_IS_NON_NULL(id) ((id).index1 != 0)
#define b3_nullWorldId ((b3WorldId){0})
#define b3_nullBodyId ((b3BodyId){0})
#define b3_nullJointId ((b3JointId){0})
#define b3Quat_identity ((b3Quat){{0.0f, 0.0f, 0.0f}, 1.0f})

b3BodyDef b3DefaultBodyDef(void);
b3ShapeDef b3DefaultShapeDef(void);
b3WorldDef b3DefaultWorldDef(void);
b3QueryFilter b3DefaultQueryFilter(void);
b3WorldId b3CreateWorld(const b3WorldDef* def);
void b3DestroyWorld(b3WorldId world);
b3BodyId b3CreateBody(b3WorldId world, const b3BodyDef* def);
void b3DestroyBody(b3BodyId body);
void b3Body_SetUserData(b3BodyId body, void* data);
void* b3Body_GetUserData(b3BodyId body);
uint64_t b3StoreBodyId(b3BodyId body);
b3BodyId b3Shape_GetBody(b3ShapeId shape);
b3TreeStats b3World_CastRay(b3WorldId, b3Pos, b3Vec3, b3QueryFilter, b3CastResultFcn*, void*);
b3TreeStats b3World_CastShape(b3WorldId, b3Pos, const b3ShapeProxy*, b3Vec3, b3QueryFilter, b3CastResultFcn*, void*);
b3TreeStats b3World_OverlapShape(b3WorldId, b3Pos, const b3ShapeProxy*, b3QueryFilter, b3OverlapResultFcn*, void*);
b3TreeStats b3World_OverlapAABB(b3WorldId, b3AABB, b3QueryFilter, b3OverlapResultFcn*, void*);
b3BoxHull b3MakeBoxHull(float hx, float hy, float hz);
b3BoxHull b3MakeTransformedBoxHull(float hx, float hy, float hz, b3Transform transform);
void b3CreateHullShape(b3BodyId body, const b3ShapeDef* def, const b3HullData* hull);
b3HullData* b3CreateHull(const b3Vec3* points, int pointCount, int maxVertexCount);
void b3DestroyHull(b3HullData* hull);
b3MeshData* b3CreateMesh(const b3MeshDef* def, int* degenerateTriangleIndices, int degenerateCapacity);
void b3DestroyMesh(b3MeshData* mesh);
void b3CreateMeshShape(b3BodyId body, const b3ShapeDef* def, const b3MeshData* mesh, b3Vec3 scale);
b3HeightFieldData* b3CreateHeightField(const b3HeightFieldDef* def);
void b3DestroyHeightField(b3HeightFieldData* heightField);
void b3CreateHeightFieldShape(b3BodyId body, const b3ShapeDef* def, const b3HeightFieldData* heightField);
void b3Body_ApplyLinearImpulseToCenter(b3BodyId body, b3Vec3 impulse, bool wake);
b3WorldTransform b3Body_GetTransform(b3BodyId body);
b3Pos b3Body_GetPosition(b3BodyId body);
void b3World_Step(b3WorldId world, float dt, int subSteps);
void b3World_SetWorkerCount(b3WorldId world, int count);
int b3World_GetWorkerCount(b3WorldId world);
int b3World_GetAwakeBodyCount(b3WorldId world);
b3Counters b3World_GetCounters(b3WorldId world);
void b3World_SetGravity(b3WorldId world, b3Vec3 gravity);
b3Vec3 b3World_GetGravity(b3WorldId world);
b3ContactEvents b3World_GetContactEvents(b3WorldId world);
b3SensorEvents b3World_GetSensorEvents(b3WorldId world);
void b3CreateSphereShape(b3BodyId body, const b3ShapeDef* def, const b3Sphere* sphere);
void b3CreateCapsuleShape(b3BodyId body, const b3ShapeDef* def, const b3Capsule* capsule);
bool b3Shape_IsValid(b3ShapeId shape);
b3Filter b3Shape_GetFilter(b3ShapeId shape);
void b3Shape_SetFilter(b3ShapeId shape, b3Filter filter, bool invokeContacts);
int b3Body_GetShapes(b3BodyId body, b3ShapeId* shapes, int capacity);
b3Vec3 b3Body_GetLinearVelocity(b3BodyId body);
b3Vec3 b3Body_GetAngularVelocity(b3BodyId body);
float b3Body_GetMass(b3BodyId body);
bool b3Body_IsAwake(b3BodyId body);
b3BodyType b3Body_GetType(b3BodyId body);
void b3Body_SetType(b3BodyId body, b3BodyType type);
void b3Body_SetTransform(b3BodyId body, b3Pos position, b3Quat rotation);
void b3Body_SetTargetTransform(b3BodyId body, b3WorldTransform target, float timeStep, bool wake);
void b3Body_SetLinearVelocity(b3BodyId body, b3Vec3 velocity);
void b3Body_SetAngularVelocity(b3BodyId body, b3Vec3 velocity);
void b3Body_SetAwake(b3BodyId body, bool awake);
void b3Body_SetGravityScale(b3BodyId body, float scale);
void b3Body_SetLinearDamping(b3BodyId body, float damping);
void b3Body_SetAngularDamping(b3BodyId body, float damping);
void b3Body_SetMassData(b3BodyId body, b3MassData massData);
b3MassData b3Body_GetMassData(b3BodyId body);
void b3Body_ApplyMassFromShapes(b3BodyId body);
b3MotionLocks b3Body_GetMotionLocks(b3BodyId body);
b3Pos b3Body_GetWorldCenterOfMass(b3BodyId body);
int b3Body_GetShapeCount(b3BodyId body);
void b3Body_ApplyForce(b3BodyId body, b3Vec3 force, b3Pos point, bool wake);
void b3Body_ApplyForceToCenter(b3BodyId body, b3Vec3 force, bool wake);
void b3Body_ApplyTorque(b3BodyId body, b3Vec3 torque, bool wake);
void b3Body_ApplyLinearImpulse(b3BodyId body, b3Vec3 impulse, b3Pos point, bool wake);
void b3Body_ApplyAngularImpulse(b3BodyId body, b3Vec3 impulse, bool wake);
uint64_t b3StoreJointId(b3JointId joint);
b3JointId b3LoadJointId(uint64_t value);
bool b3Joint_IsValid(b3JointId joint);
b3JointType b3Joint_GetType(b3JointId joint);
void b3DestroyJoint(b3JointId joint, bool wakeAttached);
void b3Joint_WakeBodies(b3JointId joint);
void b3Joint_SetConstraintTuning(b3JointId joint, float hertz, float dampingRatio);
b3Vec3 b3Joint_GetConstraintForce(b3JointId joint);
b3Vec3 b3Joint_GetConstraintTorque(b3JointId joint);
b3WeldJointDef b3DefaultWeldJointDef(void);
b3RevoluteJointDef b3DefaultRevoluteJointDef(void);
b3SphericalJointDef b3DefaultSphericalJointDef(void);
b3PrismaticJointDef b3DefaultPrismaticJointDef(void);
b3DistanceJointDef b3DefaultDistanceJointDef(void);
b3WheelJointDef b3DefaultWheelJointDef(void);
b3JointId b3CreateWeldJoint(b3WorldId world, const b3WeldJointDef* def);
b3JointId b3CreateRevoluteJoint(b3WorldId world, const b3RevoluteJointDef* def);
b3JointId b3CreateSphericalJoint(b3WorldId world, const b3SphericalJointDef* def);
b3JointId b3CreatePrismaticJoint(b3WorldId world, const b3PrismaticJointDef* def);
b3JointId b3CreateDistanceJoint(b3WorldId world, const b3DistanceJointDef* def);
b3JointId b3CreateWheelJoint(b3WorldId world, const b3WheelJointDef* def);
#define B3W_STUB_ENABLE(name) void name(b3JointId joint, bool flag);
#define B3W_STUB_FLOAT(name) void name(b3JointId joint, float value);
#define B3W_STUB_RANGE(name) void name(b3JointId joint, float lower, float upper);
B3W_STUB_ENABLE(b3RevoluteJoint_EnableMotor) B3W_STUB_ENABLE(b3RevoluteJoint_EnableLimit) B3W_STUB_ENABLE(b3RevoluteJoint_EnableSpring)
B3W_STUB_ENABLE(b3PrismaticJoint_EnableMotor) B3W_STUB_ENABLE(b3PrismaticJoint_EnableLimit) B3W_STUB_ENABLE(b3PrismaticJoint_EnableSpring)
B3W_STUB_ENABLE(b3DistanceJoint_EnableMotor) B3W_STUB_ENABLE(b3DistanceJoint_EnableLimit) B3W_STUB_ENABLE(b3DistanceJoint_EnableSpring)
B3W_STUB_ENABLE(b3SphericalJoint_EnableTwistLimit) B3W_STUB_ENABLE(b3SphericalJoint_EnableSpring)
B3W_STUB_ENABLE(b3WheelJoint_EnableSpinMotor) B3W_STUB_ENABLE(b3WheelJoint_EnableSuspensionLimit) B3W_STUB_ENABLE(b3WheelJoint_EnableSuspension) B3W_STUB_ENABLE(b3WheelJoint_EnableSteering)
B3W_STUB_FLOAT(b3RevoluteJoint_SetMotorSpeed) B3W_STUB_FLOAT(b3RevoluteJoint_SetMaxMotorTorque) B3W_STUB_FLOAT(b3RevoluteJoint_SetSpringHertz) B3W_STUB_FLOAT(b3RevoluteJoint_SetSpringDampingRatio) B3W_STUB_FLOAT(b3RevoluteJoint_SetTargetAngle)
B3W_STUB_FLOAT(b3PrismaticJoint_SetMotorSpeed) B3W_STUB_FLOAT(b3PrismaticJoint_SetMaxMotorForce) B3W_STUB_FLOAT(b3PrismaticJoint_SetSpringHertz) B3W_STUB_FLOAT(b3PrismaticJoint_SetSpringDampingRatio) B3W_STUB_FLOAT(b3PrismaticJoint_SetTargetTranslation)
B3W_STUB_FLOAT(b3DistanceJoint_SetMotorSpeed) B3W_STUB_FLOAT(b3DistanceJoint_SetMaxMotorForce) B3W_STUB_FLOAT(b3DistanceJoint_SetSpringHertz) B3W_STUB_FLOAT(b3DistanceJoint_SetSpringDampingRatio) B3W_STUB_FLOAT(b3DistanceJoint_SetLength)
B3W_STUB_FLOAT(b3SphericalJoint_SetSpringHertz) B3W_STUB_FLOAT(b3SphericalJoint_SetSpringDampingRatio)
B3W_STUB_FLOAT(b3WeldJoint_SetLinearHertz) B3W_STUB_FLOAT(b3WeldJoint_SetAngularHertz) B3W_STUB_FLOAT(b3WeldJoint_SetLinearDampingRatio) B3W_STUB_FLOAT(b3WeldJoint_SetAngularDampingRatio)
B3W_STUB_FLOAT(b3WheelJoint_SetSpinMotorSpeed) B3W_STUB_FLOAT(b3WheelJoint_SetMaxSpinTorque) B3W_STUB_FLOAT(b3WheelJoint_SetSuspensionHertz) B3W_STUB_FLOAT(b3WheelJoint_SetSuspensionDampingRatio)
B3W_STUB_FLOAT(b3WheelJoint_SetSteeringHertz) B3W_STUB_FLOAT(b3WheelJoint_SetSteeringDampingRatio) B3W_STUB_FLOAT(b3WheelJoint_SetMaxSteeringTorque) B3W_STUB_FLOAT(b3WheelJoint_SetTargetSteeringAngle)
B3W_STUB_RANGE(b3RevoluteJoint_SetLimits) B3W_STUB_RANGE(b3PrismaticJoint_SetLimits) B3W_STUB_RANGE(b3DistanceJoint_SetLengthRange) B3W_STUB_RANGE(b3SphericalJoint_SetTwistLimits) B3W_STUB_RANGE(b3WheelJoint_SetSuspensionLimits)
float b3RevoluteJoint_GetAngle(b3JointId joint);
float b3PrismaticJoint_GetTranslation(b3JointId joint);
float b3DistanceJoint_GetCurrentLength(b3JointId joint);
// Rigid-core extension.
b3MotorJointDef b3DefaultMotorJointDef(void);
b3ParallelJointDef b3DefaultParallelJointDef(void);
b3FilterJointDef b3DefaultFilterJointDef(void);
b3ExplosionDef b3DefaultExplosionDef(void);
b3DebugDraw b3DefaultDebugDraw(void);
b3JointId b3CreateMotorJoint(b3WorldId world, const b3MotorJointDef* def);
b3JointId b3CreateParallelJoint(b3WorldId world, const b3ParallelJointDef* def);
b3JointId b3CreateFilterJoint(b3WorldId world, const b3FilterJointDef* def);
b3JointEvents b3World_GetJointEvents(b3WorldId world);
b3BodyId b3Joint_GetBodyA(b3JointId joint);
b3BodyId b3Joint_GetBodyB(b3JointId joint);
b3Transform b3Joint_GetLocalFrameA(b3JointId joint);
b3Transform b3Joint_GetLocalFrameB(b3JointId joint);
void b3Joint_SetCollideConnected(b3JointId joint, bool flag);
float b3Joint_GetLinearSeparation(b3JointId joint);
float b3Joint_GetAngularSeparation(b3JointId joint);
void b3Joint_GetConstraintTuning(b3JointId joint, float* hertz, float* dampingRatio);
B3W_STUB_FLOAT(b3Joint_SetForceThreshold) B3W_STUB_FLOAT(b3Joint_SetTorqueThreshold)
B3W_STUB_FLOAT(b3MotorJoint_SetMaxVelocityForce) B3W_STUB_FLOAT(b3MotorJoint_SetMaxVelocityTorque) B3W_STUB_FLOAT(b3MotorJoint_SetLinearHertz) B3W_STUB_FLOAT(b3MotorJoint_SetLinearDampingRatio)
B3W_STUB_FLOAT(b3MotorJoint_SetMaxSpringForce) B3W_STUB_FLOAT(b3MotorJoint_SetAngularHertz) B3W_STUB_FLOAT(b3MotorJoint_SetAngularDampingRatio) B3W_STUB_FLOAT(b3MotorJoint_SetMaxSpringTorque)
B3W_STUB_FLOAT(b3ParallelJoint_SetSpringHertz) B3W_STUB_FLOAT(b3ParallelJoint_SetSpringDampingRatio) B3W_STUB_FLOAT(b3ParallelJoint_SetMaxTorque)
B3W_STUB_FLOAT(b3SphericalJoint_SetMaxMotorTorque) B3W_STUB_FLOAT(b3SphericalJoint_SetConeLimit)
B3W_STUB_ENABLE(b3SphericalJoint_EnableMotor) B3W_STUB_ENABLE(b3SphericalJoint_EnableConeLimit) B3W_STUB_ENABLE(b3WheelJoint_EnableSteeringLimit)
B3W_STUB_RANGE(b3WheelJoint_SetSteeringLimits)
void b3MotorJoint_SetLinearVelocity(b3JointId joint, b3Vec3 velocity);
void b3MotorJoint_SetAngularVelocity(b3JointId joint, b3Vec3 velocity);
b3Vec3 b3MotorJoint_GetLinearVelocity(b3JointId joint);
b3Vec3 b3MotorJoint_GetAngularVelocity(b3JointId joint);
void b3SphericalJoint_SetTargetRotation(b3JointId joint, b3Quat rotation);
void b3SphericalJoint_SetMotorVelocity(b3JointId joint, b3Vec3 velocity);
b3Vec3 b3SphericalJoint_GetMotorTorque(b3JointId joint);
#define B3W_STUB_GET(name) float name(b3JointId joint);
B3W_STUB_GET(b3Joint_GetForceThreshold) B3W_STUB_GET(b3Joint_GetTorqueThreshold)
B3W_STUB_GET(b3RevoluteJoint_GetMotorTorque) B3W_STUB_GET(b3RevoluteJoint_GetLowerLimit) B3W_STUB_GET(b3RevoluteJoint_GetUpperLimit) B3W_STUB_GET(b3RevoluteJoint_GetMotorSpeed)
B3W_STUB_GET(b3PrismaticJoint_GetSpeed) B3W_STUB_GET(b3PrismaticJoint_GetMotorForce) B3W_STUB_GET(b3PrismaticJoint_GetLowerLimit) B3W_STUB_GET(b3PrismaticJoint_GetUpperLimit)
B3W_STUB_GET(b3DistanceJoint_GetMotorForce) B3W_STUB_GET(b3DistanceJoint_GetLength) B3W_STUB_GET(b3DistanceJoint_GetMinLength) B3W_STUB_GET(b3DistanceJoint_GetMaxLength)
B3W_STUB_GET(b3SphericalJoint_GetTwistAngle) B3W_STUB_GET(b3SphericalJoint_GetConeAngle) B3W_STUB_GET(b3SphericalJoint_GetConeLimit)
B3W_STUB_GET(b3WheelJoint_GetSpinSpeed) B3W_STUB_GET(b3WheelJoint_GetSpinTorque) B3W_STUB_GET(b3WheelJoint_GetSteeringAngle) B3W_STUB_GET(b3WheelJoint_GetSteeringTorque)
B3W_STUB_GET(b3WheelJoint_GetTargetSteeringAngle) B3W_STUB_GET(b3WheelJoint_GetLowerSuspensionLimit) B3W_STUB_GET(b3WheelJoint_GetUpperSuspensionLimit)
B3W_STUB_GET(b3ParallelJoint_GetSpringHertz) B3W_STUB_GET(b3ParallelJoint_GetSpringDampingRatio) B3W_STUB_GET(b3ParallelJoint_GetMaxTorque)
bool b3Body_IsValid(b3BodyId body);
b3Pos b3Body_GetWorldPoint(b3BodyId body, b3Vec3 localPoint);
b3Vec3 b3Body_GetWorldVector(b3BodyId body, b3Vec3 localVector);
void b3Body_SetBullet(b3BodyId body, bool flag);
bool b3Body_IsBullet(b3BodyId body);
void b3Body_EnableSleep(b3BodyId body, bool flag);
bool b3Body_IsSleepEnabled(b3BodyId body);
void b3Body_SetSleepThreshold(b3BodyId body, float threshold);
float b3Body_GetSleepThreshold(b3BodyId body);
void b3Body_SetMotionLocks(b3BodyId body, b3MotionLocks locks);
bool b3Shape_IsSensor(b3ShapeId shape);
void b3World_CollideMover(b3WorldId, b3Pos, const b3Capsule*, b3QueryFilter, b3PlaneResultFcn*, void*);
float b3World_CastMover(b3WorldId, b3Pos, const b3Capsule*, b3Vec3, b3QueryFilter, b3MoverFilterFcn*, void*);
b3PlaneSolverResult b3SolvePlanes(b3Vec3 targetDelta, b3CollisionPlane* planes, int count);
void b3World_EnableSleeping(b3WorldId world, bool flag);
bool b3World_IsSleepingEnabled(b3WorldId world);
void b3World_EnableContinuous(b3WorldId world, bool flag);
bool b3World_IsContinuousEnabled(b3WorldId world);
void b3World_EnableSpeculative(b3WorldId world, bool flag);
void b3World_EnableWarmStarting(b3WorldId world, bool flag);
bool b3World_IsWarmStartingEnabled(b3WorldId world);
void b3World_SetRestitutionThreshold(b3WorldId world, float value);
float b3World_GetRestitutionThreshold(b3WorldId world);
void b3World_SetHitEventThreshold(b3WorldId world, float value);
float b3World_GetHitEventThreshold(b3WorldId world);
void b3World_SetContactTuning(b3WorldId world, float hertz, float dampingRatio, float contactSpeed);
void b3World_SetMaximumLinearSpeed(b3WorldId world, float speed);
float b3World_GetMaximumLinearSpeed(b3WorldId world);
void b3World_SetContactRecycleDistance(b3WorldId world, float distance);
float b3World_GetContactRecycleDistance(b3WorldId world);
void b3World_Explode(b3WorldId world, const b3ExplosionDef* def);
b3Profile b3World_GetProfile(b3WorldId world);
void b3World_Draw(b3WorldId world, b3DebugDraw* draw, uint64_t maskBits);
#endif
STUB

"$CC_BIN" \
  -std=c17 \
  -Wall \
  -Wextra \
  -Werror \
  -I"$TMP_DIR" \
  -fsyntax-only \
  "$ROOT/wasm/box3d_web.c"

# The pthread artifact compiles the same bridge with its two world calls renamed, so the calls land in the
# wrappers of box3d_threads.c (wasm/CMakeLists.txt, B3W_THREADS). Both files must also pass on their own.
"$CC_BIN" \
  -std=c17 \
  -Wall \
  -Wextra \
  -Werror \
  -I"$TMP_DIR" \
  -Db3CreateWorld=b3w_threads_create_world \
  -Db3World_Step=b3w_threads_step \
  -fsyntax-only \
  "$ROOT/wasm/box3d_web.c"

"$CC_BIN" \
  -std=c17 \
  -Wall \
  -Wextra \
  -Werror \
  -I"$TMP_DIR" \
  -fsyntax-only \
  "$ROOT/wasm/box3d_threads.c"

# When the pinned Box3D checkout is present (npm run fetch:box3d), check the bridge against the real
# headers too, so the stub above cannot drift from the API it stands in for.
if [[ -f "$ROOT/third_party/box3d/include/box3d/box3d.h" ]]; then
  "$CC_BIN" -std=c17 -Wall -Wextra -Werror -I"$ROOT/third_party/box3d/include" -fsyntax-only "$ROOT/wasm/box3d_web.c"
  # The checkpoint glue reads Box3D's internal structs (world_snapshot.c), so it is checked against the real sources only.
  "$CC_BIN" -std=c17 -Wall -Wextra -Werror -I"$ROOT/third_party/box3d/include" -I"$ROOT/third_party/box3d/src" -fsyntax-only "$ROOT/wasm/box3d_snapshot.c"
  echo "Bridge and checkpoint glue also compile against the real Box3D headers in third_party/box3d."
fi

echo "✅ C17 bridge syntax test passed with the pinned Box3D API contract stub ($CC_BIN): box3d_web.c (with the box3d_snapshot.h checkpoint calls), its threaded rename, and box3d_threads.c"
