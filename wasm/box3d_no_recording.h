// Force-included before every Box3D source by wasm/CMakeLists.txt (-include). Not part of Box3D and not included by the bridge.
//
// Box3D can record every API call of a world for its replay viewer: each public function ends in
// B3_REC(world, Op, args...) or B3_REC_CREATE(...), which writes a record when world->recording is set. This bridge never
// starts a recording (b3World_StartRecording is neither called nor exported), so that branch is never taken; it still
// costs about 60 KiB of WebAssembly (measured 2026-11-23: 649,196 -> 587,365 bytes), the record writers and the argument
// marshalling at every call site. The two macros are replaced by nothing here, which removes those writers at link time.
//
// What stays: the recording buffer and geometry registry that wasm/box3d_snapshot.c uses for exact checkpoints
// (b3CreateRecording, b3SerializeWorld, b3RecBufFree), and Box3D's own explicit `world->recording != NULL` blocks
// (queries, shape creation), which remain as written and are never entered.
//
// The simulation is unchanged: the macros only ever wrote to the recording. If Box3D renames them, the #undef below
// does nothing, the build still works, and the size gate (packages/box3d-kit/scripts/pack-smoke.mjs) reports the growth.
#pragma once
#include "recording.h"

#undef B3_REC
#undef B3_REC_CREATE
#define B3_REC( world, Name, ... ) ( (void)0 )
#define B3_REC_CREATE( world, Name, id, ... ) ( (void)0 )
