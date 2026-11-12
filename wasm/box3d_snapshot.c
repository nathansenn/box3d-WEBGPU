// Exact checkpoints of a Box3D world, for the browser bridge (box3d_web.c).
//
// Box3D v0.1.0 already carries a complete world snapshot: the image its recording player restores
// in place when it seeks backwards (src/world_snapshot.c). The player checks the StateHash of every
// frame after such a seek, so the image holds everything the next step reads: the solver sets and
// their body sims and states, the contact array with every manifold and its warm-start impulses,
// the constraint graph colouring, islands and sleep timers, joints with their accumulated impulses,
// sensors, the broad-phase trees, move buffer and pair set, and the id pools with their free lists.
//
// This file is the only one that reaches into Box3D's internal headers. It wraps the two internal
// calls in a self-contained image: [magic, version, snapshot bytes, the geometry registry that the
// snapshot names hulls, meshes, height fields and compounds by]. The bridge stores that image
// inside its own checkpoint (with its body table) and hands it back to b3w_snapshot_restore.
//
// Restoring overwrites a live world in place, as the player does; the world must have been created
// with the same definition (the bridge creates every world the same way). Meshes and height fields
// are used by reference, so the restored shapes borrow geometry blobs that the returned holder owns;
// release the holder after the world is destroyed or restored again.
#include "box3d_snapshot.h"

#include "body.h"
#include "container.h"
#include "id_pool.h"
#include "island.h"
#include "joint.h"
#include "shape.h"
#include "solver_set.h"
#include "core.h"
#include "physics_world.h"
#include "recording.h"
#include "recording_replay.h"
#include "world_snapshot.h"

#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define B3W_SNAP_MAGIC 0x53573342u // 'B3WS'
#define B3W_SNAP_VERSION 1u

typedef struct B3WSnapshotHolder
{
	b3RegistrySlot* slots;
	int count;
} B3WSnapshotHolder;

static void b3w_put_u32(uint8_t* out, uint32_t value) { memcpy(out, &value, 4); }
static uint32_t b3w_get_u32(const uint8_t* in) { uint32_t value; memcpy(&value, in, 4); return value; }

// The snapshot writes each live shape as its raw struct before its geometry record, so the struct still holds the
// address of its hull, mesh, height field or compound. The restore ignores that address (it resolves the geometry
// through the registry), but it differs between worlds. Zero it, so that equal states give equal bytes. Walks the
// image in the order b3SerializeWorld writes it; returns false if the image is not laid out as expected.
typedef struct B3WImageCursor { uint8_t* p; uint8_t* end; bool ok; } B3WImageCursor;
static int32_t b3w_take_i32(B3WImageCursor* c)
{
	int32_t v = 0;
	if (c->ok == false || c->end - c->p < 4) { c->ok = false; return 0; }
	memcpy(&v, c->p, 4); c->p += 4;
	return v;
}
static void b3w_skip(B3WImageCursor* c, int64_t bytes)
{
	if (c->ok == false || bytes < 0 || (int64_t)(c->end - c->p) < bytes) { c->ok = false; return; }
	c->p += bytes;
}
static void b3w_skip_array(B3WImageCursor* c, int element)
{
	const int32_t count = b3w_take_i32(c);
	if (count < 0) { c->ok = false; return; }
	b3w_skip(c, (int64_t)count * element);
}
#define B3W_ELEMENT(type, member) ((int)sizeof(*((type*)0)->member.data))

static bool b3w_canonicalize(uint8_t* image, int size)
{
	B3WImageCursor c = { image, image + size, true };
	b3w_skip(&c, 16); // header
	b3w_skip(&c, (int64_t)sizeof(b3Vec3) + 7 * 4 + 8 + 4 + 4 + 4 + 4 + (int64_t)sizeof(b3Capacity) + 1); // world scalars
	for (int pool = 0; pool < 6; ++pool) { b3w_take_i32(&c); b3w_skip_array(&c, B3W_ELEMENT(b3IdPool, freeArray)); }
	const int32_t sets = b3w_take_i32(&c);
	for (int32_t i = 0; i < sets && c.ok; ++i)
	{
		b3w_take_i32(&c);
		b3w_skip_array(&c, B3W_ELEMENT(b3SolverSet, bodySims));
		b3w_skip_array(&c, B3W_ELEMENT(b3SolverSet, bodyStates));
		b3w_skip_array(&c, B3W_ELEMENT(b3SolverSet, jointSims));
		b3w_skip_array(&c, B3W_ELEMENT(b3SolverSet, contactIndices));
		b3w_skip_array(&c, B3W_ELEMENT(b3SolverSet, islandSims));
	}
	b3w_skip_array(&c, (int)sizeof(b3Body));
	const int32_t shapes = b3w_take_i32(&c);
	for (int32_t i = 0; i < shapes && c.ok; ++i)
	{
		uint8_t* raw = c.p;
		b3w_skip(&c, (int64_t)sizeof(b3Shape));
		b3w_skip_array(&c, (int)sizeof(b3SurfaceMaterial));
		const int32_t kind = b3w_take_i32(&c);
		if (c.ok == false) break;
		if (kind == (int32_t)b3_sphereShape) b3w_skip(&c, (int64_t)sizeof(b3Sphere));
		else if (kind == (int32_t)b3_capsuleShape) b3w_skip(&c, (int64_t)sizeof(b3Capsule));
		else if (kind == (int32_t)b3_hullShape || kind == (int32_t)b3_heightShape || kind == (int32_t)b3_compoundShape || kind == (int32_t)b3_meshShape)
		{
			b3w_skip(&c, kind == (int32_t)b3_meshShape ? 4 + (int64_t)sizeof(b3Vec3) : 4);
			if (c.ok) memset(raw + offsetof(b3Shape, hull), 0, sizeof(void*));
		}
		else if (kind != -1) c.ok = false;
	}
	return c.ok;
}

uint8_t* b3w_snapshot_capture(b3WorldId worldId, int* outSize)
{
	*outSize = 0;
	b3World* world = b3GetWorldFromId(worldId);
	if (world == NULL || world->locked) return NULL;
	b3Recording* rec = b3CreateRecording(0);
	if (rec == NULL) return NULL;
	b3RecBuffer image = { 0 };
	const int imageSize = b3SerializeWorld(world, &image, rec);
	if (b3w_canonicalize(image.data, imageSize) == false)
	{
		b3RecBufFree(&image);
		b3DestroyRecording(rec);
		return NULL;
	}
	const b3GeometryRegistry* registry = &rec->registry;
	size_t total = 16u + (size_t)imageSize;
	for (int i = 0; i < registry->count; ++i) total += 8u + (size_t)registry->entries[i].byteCount;
	uint8_t* out = (uint8_t*)malloc(total);
	if (out != NULL && total <= 0x7FFFFFFFu)
	{
		uint8_t* p = out;
		b3w_put_u32(p, B3W_SNAP_MAGIC); b3w_put_u32(p + 4, B3W_SNAP_VERSION);
		b3w_put_u32(p + 8, (uint32_t)imageSize); p += 12;
		memcpy(p, image.data, (size_t)imageSize); p += imageSize;
		b3w_put_u32(p, (uint32_t)registry->count); p += 4;
		for (int i = 0; i < registry->count; ++i)
		{
			const b3GeometryEntry* entry = registry->entries + i;
			b3w_put_u32(p, (uint32_t)entry->kind); b3w_put_u32(p + 4, (uint32_t)entry->byteCount); p += 8;
			if (entry->byteCount > 0) memcpy(p, entry->bytes, (size_t)entry->byteCount);
			p += entry->byteCount;
		}
		*outSize = (int)total;
	}
	else if (out != NULL)
	{
		free(out);
		out = NULL;
	}
	b3RecBufFree(&image);
	b3DestroyRecording(rec);
	return out;
}

void b3w_snapshot_release(void* holderPointer)
{
	B3WSnapshotHolder* holder = (B3WSnapshotHolder*)holderPointer;
	if (holder == NULL) return;
	for (int i = 0; i < holder->count; ++i)
	{
		b3RegistrySlot* slot = holder->slots + i;
		if (slot->live != NULL && slot->kind == b3_geometryCompound) b3Free(slot->live, (size_t)slot->byteCount);
		if (slot->bytes != NULL) b3Free(slot->bytes, slot->byteCount > 0 ? (size_t)slot->byteCount : 1u);
	}
	if (holder->slots != NULL) b3Free(holder->slots, (size_t)holder->count * sizeof(b3RegistrySlot));
	free(holder);
}

// Events are outputs of the step that made them. Those of the world that is overwritten must not be
// reported after the restore; the next step fills the buffers afresh.
static void b3w_clear_events(b3World* world)
{
	b3Array_Clear(world->bodyMoveEvents);
	b3Array_Clear(world->sensorBeginEvents);
	b3Array_Clear(world->contactBeginEvents);
	b3Array_Clear(world->sensorEndEvents[0]);
	b3Array_Clear(world->sensorEndEvents[1]);
	b3Array_Clear(world->contactEndEvents[0]);
	b3Array_Clear(world->contactEndEvents[1]);
	b3Array_Clear(world->contactHitEvents);
	b3Array_Clear(world->jointEvents);
}

int b3w_snapshot_check(const uint8_t* data, int size)
{
	if (data == NULL || size < 16) return 0;
	if (b3w_get_u32(data) != B3W_SNAP_MAGIC || b3w_get_u32(data + 4) != B3W_SNAP_VERSION) return 0;
	const uint32_t imageSize = b3w_get_u32(data + 8);
	if ((uint64_t)imageSize + 16u > (uint64_t)size) return 0;
	const uint8_t* p = data + 12 + imageSize;
	const uint8_t* end = data + size;
	const uint32_t count = b3w_get_u32(p); p += 4;
	if (count > 1000000u) return 0;
	for (uint32_t i = 0; i < count; ++i)
	{
		if (end - p < 8) return 0;
		const uint32_t kind = b3w_get_u32(p), bytes = b3w_get_u32(p + 4);
		p += 8;
		if (kind > (uint32_t)b3_geometryCompound || (uint64_t)bytes > (uint64_t)(end - p)) return 0;
		p += bytes;
	}
	return p == end;
}

void* b3w_snapshot_restore(b3WorldId worldId, const uint8_t* data, int size)
{
	if (b3w_snapshot_check(data, size) == 0) return NULL;
	b3World* world = b3GetWorldFromId(worldId);
	if (world == NULL || world->locked) return NULL;
	const uint32_t imageSize = b3w_get_u32(data + 8);
	const uint8_t* image = data + 12;
	const uint8_t* p = image + imageSize;
	const int count = (int)b3w_get_u32(p); p += 4;

	B3WSnapshotHolder* holder = (B3WSnapshotHolder*)calloc(1u, sizeof(B3WSnapshotHolder));
	if (holder == NULL) return NULL;
	holder->count = count;
	if (count > 0)
	{
		holder->slots = (b3RegistrySlot*)b3Alloc((size_t)count * sizeof(b3RegistrySlot));
		memset(holder->slots, 0, (size_t)count * sizeof(b3RegistrySlot));
	}
	for (int i = 0; i < count; ++i)
	{
		b3RegistrySlot* slot = holder->slots + i;
		const uint32_t kind = b3w_get_u32(p), bytes = b3w_get_u32(p + 4);
		p += 8;
		slot->kind = (b3GeometryKind)kind;
		slot->byteCount = (int)bytes;
		// b3Alloc aligns to 64 bytes, as the geometry blobs expect.
		slot->bytes = (uint8_t*)b3Alloc(bytes > 0 ? (size_t)bytes : 1u);
		if (bytes > 0) memcpy(slot->bytes, p, bytes);
		p += bytes;
	}

	b3RecReader reader;
	memset(&reader, 0, sizeof(reader));
	reader.replayWorldId = worldId;
	reader.ok = true;
	reader.slots = holder->slots;
	reader.slotCount = count;
	if (b3DeserializeIntoShell(image, (int)imageSize, world, &reader) == false)
	{
		// A failed restore leaves the world half overwritten; the caller resets it.
		b3w_snapshot_release(holder);
		return NULL;
	}
	b3w_clear_events(world);
	return holder;
}
