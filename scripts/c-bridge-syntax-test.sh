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

typedef struct { uint64_t index; } b3WorldId;
typedef struct { uint64_t index; } b3BodyId;
typedef struct { uint64_t index; } b3ShapeId;
typedef struct { float x, y, z; } b3Vec3;
typedef struct { float x, y, z; } b3Pos;
typedef struct { b3Vec3 v; float s; } b3Quat;
typedef struct { b3Pos p; b3Quat q; } b3WorldTransform;
typedef enum { b3_staticBody = 0, b3_kinematicBody = 1, b3_dynamicBody = 2 } b3BodyType;
typedef struct { b3BodyType type; b3Pos position; b3Vec3 angularVelocity; } b3BodyDef;
typedef struct { float friction; float restitution; uint32_t customColor; } b3SurfaceMaterial;
typedef struct { float density; b3SurfaceMaterial baseMaterial; } b3ShapeDef;
typedef struct { int unused; } b3Hull;
typedef struct { b3Hull base; } b3BoxHull;
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
typedef struct { int bodyCount; int shapeCount; int contactCount; } b3Counters;
typedef struct { uint64_t categoryBits, maskBits; uint64_t id; const char* name; } b3QueryFilter;
typedef struct { b3Vec3 lowerBound, upperBound; } b3AABB;
typedef struct { const b3Vec3* points; int count; float radius; } b3ShapeProxy;
typedef struct { int nodeVisits, leafVisits; } b3TreeStats;
typedef bool b3OverlapResultFcn(b3ShapeId, void*);
typedef float b3CastResultFcn(b3ShapeId, b3Pos, b3Vec3, float, uint64_t, int, int, void*);

#define B3_IS_NULL(id) ((id).index == 0u)
#define B3_IS_NON_NULL(id) ((id).index != 0u)
#define b3_nullWorldId ((b3WorldId){0})
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
void b3CreateHullShape(b3BodyId body, const b3ShapeDef* def, const b3Hull* hull);
void b3Body_ApplyLinearImpulseToCenter(b3BodyId body, b3Vec3 impulse, bool wake);
b3WorldTransform b3Body_GetTransform(b3BodyId body);
b3Pos b3Body_GetPosition(b3BodyId body);
void b3World_Step(b3WorldId world, float dt, int subSteps);
void b3World_SetWorkerCount(b3WorldId world, int count);
int b3World_GetWorkerCount(b3WorldId world);
int b3World_GetAwakeBodyCount(b3WorldId world);
b3Counters b3World_GetCounters(b3WorldId world);
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

echo "✅ C17 bridge syntax test passed with the pinned Box3D API contract stub ($CC_BIN): box3d_web.c, its threaded rename, and box3d_threads.c"
