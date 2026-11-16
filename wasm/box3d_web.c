// Box3D WebGPU AAA Physics Lab bridge
// Keeps upstream Box3D intact and exposes a compact C ABI for browser/WebGPU demos.
// The browser renderer supplies HDR lighting, shadows, post processing, and effects;
// this bridge supplies Box3D-native rigid-body simulation and deterministic transforms.

#include <box3d/box3d.h>

#include "box3d_snapshot.h"

#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define B3W_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define B3W_EXPORT
#endif

#define B3W_MAX_BODIES 4096
#define B3W_BODY_CAPACITY_LIMIT 65536

typedef struct B3WBody
{
    b3BodyId id;
    float hx;
    float hy;
    float hz;
    uint32_t color;
    int dynamic;
    int slot;
    int dynamicPosition;
} B3WBody;

#define B3W_BODY_SLOT_BITS 17u
#define B3W_BODY_SLOT_MASK ((UINT64_C(1) << B3W_BODY_SLOT_BITS) - 1u)
#define B3W_BODY_MAX_GENERATION (UINT64_MAX >> B3W_BODY_SLOT_BITS)
typedef struct B3WBodySlot
{
    uint64_t generation;
    int denseIndex;
    int nextFree;
} B3WBodySlot;

#define B3W_HULL_CACHE_CAPACITY 8

#define B3W_QUERY_LIMIT 128
#define B3W_QUERY_HIT_LIMIT 32768
#define B3W_QUERY_HITS_PER_INPUT 256
// Fixed C/JS ABI layouts, independent of upstream struct alignment.
typedef struct B3WQueryInput
{
    uint32_t kind;
    uint32_t bodyTypes; // bit 0 static, bit 1 dynamic
    float origin[3];
    float translation[3];
    float extent[3]; // sphere radius in x; box half extents; capsule radius in x and half length (along Y) in y
    uint32_t reserved;
    uint64_t categoryBits;
    uint64_t maskBits;
    uint64_t ignoreBody;
    uint32_t limit;
    uint32_t padding;
} B3WQueryInput;
typedef struct B3WQueryHit
{
    uint64_t body;
    uint64_t material;
    float point[3];
    float normal[3];
    float fraction;
    int32_t triangle;
    int32_t child;
    uint32_t flags; // 1 = cast point/normal present; overlap records contain IDs only
} B3WQueryHit;
typedef struct B3WQueryStatus { uint32_t offset, count, total, overflow; } B3WQueryStatus;
_Static_assert(sizeof(B3WQueryInput) == 80, "Query input ABI must be 80 bytes");
_Static_assert(sizeof(B3WQueryHit) == 56, "Query hit ABI must be 56 bytes");
_Static_assert(sizeof(B3WQueryStatus) == 16, "Query status ABI must be 16 bytes");
typedef struct B3WQueryArena
{
    void* block;
    B3WQueryInput* inputs;
    B3WQueryStatus* statuses;
    B3WQueryHit* hits;
    int inputCapacity, hitCapacity;
    uint32_t version;
} B3WQueryArena;

typedef struct B3WHullCacheEntry
{
    b3BoxHull hull;
    float hx;
    float hy;
    float hz;
    uint32_t stamp;
    int valid;
} B3WHullCacheEntry;

// Simulation state is passed explicitly to every stateful helper. The registry
// owns lifetimes only; there is no shared selected/current simulation context.
typedef struct B3WContext
{
    b3WorldId world;
    B3WBody* bodies;
    int* dynamicIndices;
    B3WBodySlot* bodySlots;
    int slotsUsed;
    int freeSlot;
    void* bufferBlock;
    int capacity;
    uint32_t bufferVersion;
    int bodyCount;
    int dynamicCount;
    float* matrices;
    float* colors;
    uint32_t rng;
    uint32_t hash;
    int hashDirty;
    uint32_t transformVersion;
    uint32_t colorVersion;
    B3WHullCacheEntry hullCache[B3W_HULL_CACHE_CAPACITY];
    int cachedHullLast;
    uint32_t hullCacheStamp;
    B3WQueryArena queries;
    // General-body extension. All of it stays zero for worlds
    // that only use the scene recipes, so their streams and hashes are unchanged.
    uint8_t* kinds; // per dense row: 0 box, 1 sphere, 2 capsule, 3 hull, 4 mesh, 5 height field, 6 compound; NULL means all boxes
    b3BodyId anchor; // hidden static body that joints attach to when a body handle is 0
    struct B3WEvent* events;
    int eventCapacity;
    int eventCount;
    int eventTotal;
    // Mesh and height-field data that Box3D references instead of copying.
    struct B3WGeometry* geometry;
    int geometryCount;
    int geometryCapacity;
    // Mass, centre of mass and inertia a caller set in place of the shape-derived ones. Box3D
    // forgets them when a body changes type, so they are kept here by body slot.
    struct B3WMassOverride* massOverrides;
    int massOverrideCount;
    int massOverrideCapacity;
    // Exact checkpoints. The geometry that the shapes of a restored world borrow, and the last
    // checkpoint written (box3d_snapshot.c, b3w_world_checkpoint).
    void* snapshotHolder;
    uint8_t* checkpoint;
    int checkpointSize;
    // Rigid-core extension. All of it stays zero for worlds that do not use it.
    // Per joint index: (generation << 8) | flags; flag bit 0 means the joint is destroyed when its
    // force or torque threshold is exceeded. Saved in checkpoints.
    uint32_t* jointFlags;
    int jointFlagCapacity;
    // Joints that exceeded a threshold in the most recent step (b3w_ctx_after_step).
    struct B3WJointRecord* jointRecords;
    int jointRecordCount;
    int jointRecordCapacity;
    // Line vertices written by the last b3w_world_debug_draw: x, y, z, 0xRRGGBB as a float.
    float* debugVertices;
    int debugCount;
    int debugCapacity;
    int debugTotal;
} B3WContext;

// The compatibility world retains fixed arrays and stable offsets. Explicit
// contexts own a single fallible buffer allocation, grown only on request.
static B3WBody g_defaultBodies[B3W_MAX_BODIES];
static int g_defaultDynamicIndices[B3W_MAX_BODIES];
static float g_defaultMatrices[B3W_MAX_BODIES * 16];
static float g_defaultColors[B3W_MAX_BODIES * 4];
static B3WContext g_defaultContext = {
    .bodies = g_defaultBodies, .dynamicIndices = g_defaultDynamicIndices,
    .matrices = g_defaultMatrices, .colors = g_defaultColors,
    .capacity = B3W_MAX_BODIES, .bufferVersion = 1u, .freeSlot = -1,
    .rng = 0xC0FFEEu, .hashDirty = 1, .transformVersion = 1u,
    .colorVersion = 1u, .cachedHullLast = -1,
};

// One allocation makes growth transactional: allocation failure leaves every
// old pointer, count, native body ID, RNG value and stream revision untouched.
// Capacity only grows through the 4096 / 16384 / 65536 tiers.
#ifdef B3W_CAPACITY_TESTING
static int g_failNextCapacityAllocation = 0;
B3W_EXPORT void b3w_test_fail_next_capacity_allocation(void)
{
    g_failNextCapacityAllocation = 1;
}
#endif

static size_t b3w_capacity_bytes(int capacity)
{
    return (size_t)capacity * (sizeof(B3WBody) + sizeof(int) + sizeof(B3WBodySlot) + 20u * sizeof(float));
}

static int b3w_ctx_reserve(B3WContext* ctx, int requested)
{
    if (requested < 1 || requested > B3W_BODY_CAPACITY_LIMIT) return -2;
    if (requested <= ctx->capacity) return ctx->capacity;
    const int capacity = requested <= 4096 ? 4096 : requested <= 16384 ? 16384 : 65536;
    void* block = NULL;
#ifdef B3W_CAPACITY_TESTING
    if (g_failNextCapacityAllocation != 0) g_failNextCapacityAllocation = 0;
    else
#endif
    block = calloc(1u, b3w_capacity_bytes(capacity));
    if (block == NULL) return -3;
    if (ctx->kinds != NULL)
    {
        uint8_t* kinds = (uint8_t*)realloc(ctx->kinds, (size_t)capacity);
        if (kinds == NULL) { free(block); return -3; }
        memset(kinds + ctx->capacity, 0, (size_t)(capacity - ctx->capacity));
        ctx->kinds = kinds;
    }

    B3WBody* bodies = (B3WBody*)block;
    int* dynamicIndices = (int*)((uint8_t*)block + (size_t)capacity * sizeof(B3WBody));
    B3WBodySlot* bodySlots = (B3WBodySlot*)((uint8_t*)dynamicIndices + (size_t)capacity * sizeof(int));
    float* matrices = (float*)(bodySlots + capacity);
    float* colors = matrices + (size_t)capacity * 16u;
    if (ctx->bodyCount > 0)
    {
        memcpy(bodies, ctx->bodies, (size_t)ctx->bodyCount * sizeof(B3WBody));
        memcpy(matrices, ctx->matrices, (size_t)ctx->bodyCount * 16u * sizeof(float));
        memcpy(colors, ctx->colors, (size_t)ctx->bodyCount * 4u * sizeof(float));
    }
    if (ctx->dynamicCount > 0) memcpy(dynamicIndices, ctx->dynamicIndices, (size_t)ctx->dynamicCount * sizeof(int));
    // Dead-slot generations must survive relocation too; copying only live rows
    // would revive old handles after a later capacity increase.
    if (ctx->slotsUsed > 0) memcpy(bodySlots, ctx->bodySlots, (size_t)ctx->slotsUsed * sizeof(B3WBodySlot));
    free(ctx->bufferBlock);
    ctx->bufferBlock = block;
    ctx->bodies = bodies;
    ctx->dynamicIndices = dynamicIndices;
    ctx->bodySlots = bodySlots;
    ctx->matrices = matrices;
    ctx->colors = colors;
    ctx->capacity = capacity;
    ctx->bufferVersion += 1u;
    return capacity;
}

#define B3W_MAX_CONTEXTS 16
#define B3W_CONTEXT_SLOT_BITS 5u
#define B3W_CONTEXT_SLOT_MASK 31u
#define B3W_CONTEXT_MAX_GENERATION (UINT32_MAX >> B3W_CONTEXT_SLOT_BITS)
typedef struct B3WContextSlot
{
    B3WContext* context;
    uint32_t generation;
    int retired;
} B3WContextSlot;
static B3WContextSlot g_contextSlots[B3W_MAX_CONTEXTS];
// Module creation diagnostics: 0 success, 1 slot limit, 2 allocation failure.
static int g_contextCreateError = 0;

static B3WContext* b3w_lookup_context(uint32_t handle)
{
    uint32_t slot1 = handle & B3W_CONTEXT_SLOT_MASK;
    uint32_t generation = handle >> B3W_CONTEXT_SLOT_BITS;
    if (slot1 == 0u || slot1 > B3W_MAX_CONTEXTS || generation == 0u) return NULL;
    B3WContextSlot* slot = &g_contextSlots[slot1 - 1u];
    return slot->context != NULL && slot->generation == generation ? slot->context : NULL;
}

// Body tokens are scoped to this world: low 17 bits store slot + 1; the
// remaining 47 bits store a generation. Dense renderer rows can move freely.
static int b3w_ctx_allocate_body_slot(B3WContext* ctx, int denseIndex)
{
    if (ctx->bodySlots == NULL) return -1; // Legacy compatibility world.
    int index;
    if (ctx->freeSlot >= 0) { index = ctx->freeSlot; ctx->freeSlot = ctx->bodySlots[index].nextFree; }
    else { index = ctx->slotsUsed++; ctx->bodySlots[index].generation = 1u; }
    ctx->bodySlots[index].denseIndex = denseIndex;
    ctx->bodySlots[index].nextFree = -1;
    return index;
}

static void b3w_ctx_release_body_slot(B3WContext* ctx, int index)
{
    if (ctx->bodySlots == NULL || index < 0) return;
    B3WBodySlot* slot = ctx->bodySlots + index;
    slot->denseIndex = -1;
    slot->nextFree = -1;
    if (slot->generation == B3W_BODY_MAX_GENERATION) return; // Retire, never wrap.
    slot->generation += 1u;
    slot->nextFree = ctx->freeSlot;
    ctx->freeSlot = index;
}

static uint64_t b3w_ctx_body_handle(B3WContext* ctx, int index)
{
    if (ctx->bodySlots == NULL || index < 0 || index >= ctx->bodyCount) return 0u;
    int slot = ctx->bodies[index].slot;
    return (ctx->bodySlots[slot].generation << B3W_BODY_SLOT_BITS) | (uint64_t)(slot + 1);
}

static int b3w_ctx_body_index(B3WContext* ctx, uint64_t handle)
{
    uint64_t slot1 = handle & B3W_BODY_SLOT_MASK;
    if (ctx->bodySlots == NULL || slot1 == 0u || slot1 > (uint64_t)ctx->slotsUsed) return -1;
    const B3WBodySlot* slot = ctx->bodySlots + slot1 - 1u;
    return slot->generation == (handle >> B3W_BODY_SLOT_BITS) && slot->denseIndex >= 0 ? slot->denseIndex : -1;
}

#ifdef B3W_QUERY_TESTING
static int g_failNextQueryAllocation = 0;
B3W_EXPORT void b3w_test_fail_next_query_allocation(void) { g_failNextQueryAllocation = 1; }
B3W_EXPORT int b3w_test_exhaust_query_version(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    ctx->queries.version = UINT32_MAX - 1u;
    return 1;
}
#endif

static size_t b3w_query_bytes(int inputs, int hits)
{
    return (size_t)inputs * (sizeof(B3WQueryInput) + sizeof(B3WQueryStatus)) + (size_t)hits * sizeof(B3WQueryHit);
}

static int b3w_ctx_query_reserve(B3WContext* ctx, int inputs, int hits)
{
    if (inputs < 1 || inputs > B3W_QUERY_LIMIT || hits < 1 || hits > B3W_QUERY_HIT_LIMIT) return -2;
    B3WQueryArena* q = &ctx->queries;
    if (q->version == UINT32_MAX) return -6;
    if (inputs <= q->inputCapacity && hits <= q->hitCapacity) return 0;
    int inputCapacity = inputs <= 16 ? 16 : inputs <= 64 ? 64 : 128;
    int hitCapacity = hits <= 64 ? 64 : hits <= 512 ? 512 : hits <= 4096 ? 4096 : B3W_QUERY_HIT_LIMIT;
    if (inputCapacity < q->inputCapacity) inputCapacity = q->inputCapacity;
    if (hitCapacity < q->hitCapacity) hitCapacity = q->hitCapacity;
    void* block = NULL;
#ifdef B3W_QUERY_TESTING
    if (g_failNextQueryAllocation) g_failNextQueryAllocation = 0;
    else
#endif
    block = calloc(1u, b3w_query_bytes(inputCapacity, hitCapacity));
    if (block == NULL) return -3;
    B3WQueryInput* inputData = (B3WQueryInput*)block;
    B3WQueryStatus* statuses = (B3WQueryStatus*)(inputData + inputCapacity);
    B3WQueryHit* hitData = (B3WQueryHit*)(statuses + inputCapacity);
    free(q->block);
    *q = (B3WQueryArena){ .block = block, .inputs = inputData, .statuses = statuses, .hits = hitData,
        .inputCapacity = inputCapacity, .hitCapacity = hitCapacity, .version = q->version + 1u };
    return 0;
}

typedef struct B3WQueryVisit
{
    B3WContext* ctx;
    const B3WQueryInput* input;
    B3WQueryHit* hits;
    uint32_t count, total;
} B3WQueryVisit;

static int b3w_compare_query_hit(const void* a, const void* b)
{
    const B3WQueryHit* x = (const B3WQueryHit*)a;
    const B3WQueryHit* y = (const B3WQueryHit*)b;
    if (x->fraction != y->fraction) return x->fraction < y->fraction ? -1 : 1;
    if (x->body != y->body) return x->body < y->body ? -1 : 1;
    if (x->triangle != y->triangle) return x->triangle < y->triangle ? -1 : 1;
    if (x->child != y->child) return x->child < y->child ? -1 : 1;
    return 0;
}

// Keep the best K hits in a max heap, then sort them once. Overflow must not
// return an arbitrary tree-traversal prefix or stop before the nearest hit.
static void b3w_query_keep(B3WQueryVisit* visit, B3WQueryHit hit)
{
    visit->total += 1u;
    B3WQueryHit* heap = visit->hits;
    if (visit->count < visit->input->limit)
    {
        uint32_t i = visit->count++;
        while (i > 0)
        {
            uint32_t parent = (i - 1u) / 2u;
            if (b3w_compare_query_hit(&heap[parent], &hit) >= 0) break;
            heap[i] = heap[parent]; i = parent;
        }
        heap[i] = hit;
        return;
    }
    if (b3w_compare_query_hit(&hit, &heap[0]) >= 0) return;
    uint32_t i = 0;
    while (i * 2u + 1u < visit->count)
    {
        uint32_t child = i * 2u + 1u;
        if (child + 1u < visit->count && b3w_compare_query_hit(&heap[child], &heap[child + 1u]) < 0) child += 1u;
        if (b3w_compare_query_hit(&hit, &heap[child]) >= 0) break;
        heap[i] = heap[child]; i = child;
    }
    heap[i] = hit;
}

static uint64_t b3w_query_body(B3WQueryVisit* visit, b3ShapeId shape)
{
    const b3BodyId body = b3Shape_GetBody(shape);
    const uintptr_t slot1 = (uintptr_t)b3Body_GetUserData(body);
    B3WContext* ctx = visit->ctx;
    if (slot1 == 0 || slot1 > (uintptr_t)ctx->slotsUsed) return 0u;
    int index = ctx->bodySlots[slot1 - 1u].denseIndex;
    if (index < 0 || index >= ctx->bodyCount || b3StoreBodyId(body) != b3StoreBodyId(ctx->bodies[index].id)) return 0u;
    const uint64_t token = b3w_ctx_body_handle(ctx, index);
    if (token == visit->input->ignoreBody || (visit->input->bodyTypes & (ctx->bodies[index].dynamic ? 2u : 1u)) == 0u) return 0u;
    return token;
}

static float b3w_query_cast_callback(b3ShapeId shape, b3Pos p, b3Vec3 n, float fraction,
    uint64_t material, int triangle, int child, void* user)
{
    B3WQueryVisit* visit = (B3WQueryVisit*)user;
    uint64_t body = b3w_query_body(visit, shape);
    if (body != 0u) b3w_query_keep(visit, (B3WQueryHit){ .body = body, .material = material,
        .point = {p.x,p.y,p.z}, .normal = {n.x,n.y,n.z}, .fraction = fraction,
        .triangle = triangle, .child = child, .flags = 1u });
    return 1.0f; // Visit all candidates: exact total count and deterministic ties.
}

static bool b3w_query_overlap_callback(b3ShapeId shape, void* user)
{
    B3WQueryVisit* visit = (B3WQueryVisit*)user;
    uint64_t body = b3w_query_body(visit, shape);
    if (body != 0u) b3w_query_keep(visit, (B3WQueryHit){ .body = body, .triangle = -1, .child = -1 });
    return true;
}

static int b3w_ctx_query_batch(B3WContext* ctx, int count, uint32_t version)
{
    B3WQueryArena* arena = &ctx->queries;
    if (count < 1 || count > arena->inputCapacity || count > B3W_QUERY_LIMIT || arena->block == NULL) return -2;
    if (version != arena->version) return -4;
    if (arena->version == UINT32_MAX) return -6;
    uint32_t required = 0;
    // Validate the entire batch before touching output or invoking the SDK.
    for (int i = 0; i < count; ++i)
    {
        const B3WQueryInput* q = arena->inputs + i;
        if (q->kind > 7u || q->bodyTypes > 3u || q->reserved != 0u || q->padding != 0u ||
            q->limit < 1u || q->limit > B3W_QUERY_HITS_PER_INPUT) return -2;
        for (int k = 0; k < 3; ++k)
        {
            if (!isfinite(q->origin[k]) || !isfinite(q->translation[k]) || !isfinite(q->extent[k]) ||
                fabsf(q->origin[k]) > 1000000.0f || fabsf(q->translation[k]) > 1000000.0f ||
                q->extent[k] < 0.0f || q->extent[k] > 1000000.0f) return -2;
        }
        if ((q->kind == 1u || q->kind == 3u) && q->extent[0] <= 0.0f) return -2;
        if ((q->kind == 2u || q->kind == 4u || q->kind == 5u) &&
            (q->extent[0] <= 0.0f || q->extent[1] <= 0.0f || q->extent[2] <= 0.0f)) return -2;
        if ((q->kind == 6u || q->kind == 7u) && (q->extent[0] <= 0.0f || q->extent[2] != 0.0f)) return -2;
        if (q->ignoreBody != 0u && b3w_ctx_body_index(ctx, q->ignoreBody) < 0) return -5;
        required += q->limit;
    }
    if (required > (uint32_t)arena->hitCapacity) return -2;
    uint32_t offset = 0;
    for (int i = 0; i < count; ++i)
    {
        const B3WQueryInput* q = arena->inputs + i;
        B3WQueryVisit visit = { .ctx = ctx, .input = q, .hits = arena->hits + offset };
        b3QueryFilter filter = b3DefaultQueryFilter(); filter.categoryBits = q->categoryBits; filter.maskBits = q->maskBits;
        const b3Pos origin = {q->origin[0],q->origin[1],q->origin[2]};
        const b3Vec3 translation = {q->translation[0],q->translation[1],q->translation[2]};
        const int isCast = q->kind <= 2u || q->kind == 6u;
        const int zeroCast = isCast && translation.x == 0.0f && translation.y == 0.0f && translation.z == 0.0f;
        if (B3_IS_NON_NULL(ctx->world) && q->bodyTypes != 0u && !zeroCast)
        {
            b3Vec3 points[8] = {{0}};
            b3ShapeProxy proxy = { .points = points, .count = 1, .radius = q->extent[0] };
            if (q->kind == 2u || q->kind == 4u)
            {
                proxy.count = 8; proxy.radius = 0.0f;
                for (int j = 0; j < 8; ++j) points[j] = (b3Vec3){ (j & 1) ? q->extent[0] : -q->extent[0],
                    (j & 2) ? q->extent[1] : -q->extent[1], (j & 4) ? q->extent[2] : -q->extent[2] };
            }
            if (q->kind == 6u || q->kind == 7u)
            {
                // Upright capsule: two centres on the Y axis.
                proxy.count = 2;
                points[0] = (b3Vec3){ 0.0f, -q->extent[1], 0.0f };
                points[1] = (b3Vec3){ 0.0f, q->extent[1], 0.0f };
            }
            if (q->kind == 0u) b3World_CastRay(ctx->world, origin, translation, filter, b3w_query_cast_callback, &visit);
            else if (q->kind == 6u) b3World_CastShape(ctx->world, origin, &proxy, translation, filter, b3w_query_cast_callback, &visit);
            else if (q->kind == 7u) b3World_OverlapShape(ctx->world, origin, &proxy, filter, b3w_query_overlap_callback, &visit);
            else if (q->kind <= 2u) b3World_CastShape(ctx->world, origin, &proxy, translation, filter, b3w_query_cast_callback, &visit);
            else if (q->kind <= 4u) b3World_OverlapShape(ctx->world, origin, &proxy, filter, b3w_query_overlap_callback, &visit);
            else
            {
                const b3AABB bounds = { .lowerBound = {origin.x-q->extent[0],origin.y-q->extent[1],origin.z-q->extent[2]},
                    .upperBound = {origin.x+q->extent[0],origin.y+q->extent[1],origin.z+q->extent[2]} };
                b3World_OverlapAABB(ctx->world, bounds, filter, b3w_query_overlap_callback, &visit);
            }
        }
        qsort(visit.hits, visit.count, sizeof(B3WQueryHit), b3w_compare_query_hit);
        arena->statuses[i] = (B3WQueryStatus){offset,visit.count,visit.total,visit.total>visit.count ? 1u : 0u};
        offset += q->limit;
    }
    arena->version += 1u;
    return count;
}

#ifdef B3W_RECYCLING_TESTING
B3W_EXPORT uint64_t b3w_test_exhaust_body_generation(uint32_t worldHandle, uint64_t bodyHandle)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    int index = ctx != NULL ? b3w_ctx_body_index(ctx, bodyHandle) : -1;
    if (index < 0) return 0u;
    ctx->bodySlots[ctx->bodies[index].slot].generation = B3W_BODY_MAX_GENERATION;
    return b3w_ctx_body_handle(ctx, index);
}
#endif

// Forward declarations used by scene recipes. C17 does not permit implicit declarations.
static void b3w_ctx_explode(B3WContext* ctx, float cx, float cy, float cz, float strength, float radius);
static int b3w_ctx_launch_projectile(B3WContext* ctx, float x, float y, float z, float vx, float vy, float vz, float size);

static float b3w_ctx_rand01(B3WContext* ctx)
{
    ctx->rng = 1664525u * ctx->rng + 1013904223u;
    return (float)((ctx->rng >> 8) & 0x00FFFFFFu) / 16777215.0f;
}

static float b3w_ctx_rand_range(B3WContext* ctx, float lo, float hi)
{
    return lo + (hi - lo) * b3w_ctx_rand01(ctx);
}

static int b3w_clamp_int(int v, int lo, int hi)
{
    return v < lo ? lo : (v > hi ? hi : v);
}

// The top byte is renderer-only material metadata; Box3D retains the value as
// customColor while collision and mass properties remain unaffected.
static uint32_t b3w_material_color(uint32_t rgb, uint32_t materialTag)
{
    return ((materialTag & 0xFFu) << 24) | (rgb & 0x00FFFFFFu);
}

static void b3w_unpack_rgb(uint32_t rgb, float* out4)
{
    out4[0] = (float)((rgb >> 16) & 0xFFu) / 255.0f;
    out4[1] = (float)((rgb >> 8) & 0xFFu) / 255.0f;
    out4[2] = (float)(rgb & 0xFFu) / 255.0f;
    uint32_t materialTag = (rgb >> 24) & 0xFFu;
    out4[3] = materialTag == 0u ? 1.0f : -(float)materialTag;
}

static void b3w_ctx_write_model_matrix(B3WContext* ctx, int index, b3Pos p, b3Quat q, float hx, float hy, float hz)
{
    const float x = q.v.x;
    const float y = q.v.y;
    const float z = q.v.z;
    const float w = q.s;

    const float xx = x * x;
    const float yy = y * y;
    const float zz = z * z;
    const float xy = x * y;
    const float xz = x * z;
    const float yz = y * z;
    const float wx = w * x;
    const float wy = w * y;
    const float wz = w * z;

    float* m = ctx->matrices + index * 16;
    m[0] = (1.0f - 2.0f * (yy + zz)) * hx;
    m[1] = (2.0f * (xy + wz)) * hx;
    m[2] = (2.0f * (xz - wy)) * hx;
    m[3] = 0.0f;

    m[4] = (2.0f * (xy - wz)) * hy;
    m[5] = (1.0f - 2.0f * (xx + zz)) * hy;
    m[6] = (2.0f * (yz + wx)) * hy;
    m[7] = 0.0f;

    m[8] = (2.0f * (xz + wy)) * hz;
    m[9] = (2.0f * (yz - wx)) * hz;
    m[10] = (1.0f - 2.0f * (xx + yy)) * hz;
    m[11] = 0.0f;

    m[12] = (float)p.x;
    m[13] = (float)p.y;
    m[14] = (float)p.z;
    m[15] = 1.0f;
}

// Newly created bodies always use the identity rotation. Writing that exact
// affine matrix directly avoids the general quaternion expansion during scene
// construction while retaining the same float32 stream bits (including +0).
static void b3w_ctx_write_axis_aligned_matrix(B3WContext* ctx, int index, float x, float y, float z, float hx, float hy, float hz)
{
    float* m = ctx->matrices + index * 16;
    m[0] = hx;
    m[1] = 0.0f;
    m[2] = 0.0f;
    m[3] = 0.0f;
    m[4] = 0.0f;
    m[5] = hy;
    m[6] = 0.0f;
    m[7] = 0.0f;
    m[8] = 0.0f;
    m[9] = 0.0f;
    m[10] = hz;
    m[11] = 0.0f;
    m[12] = x;
    m[13] = y;
    m[14] = z;
    m[15] = 1.0f;
}

// Box3D clones each supplied hull into its world database. Keep the most recent
// exact half-extents on the first branch for long identical runs, then probe a
// small exact LRU for recurring stage, tower, and arena dimensions. This avoids
// rebuilding vertices, edges, faces, and planes without changing shape bits.
static const b3BoxHull* b3w_ctx_get_box_hull(B3WContext* ctx, float hx, float hy, float hz)
{
    ctx->hullCacheStamp += 1u;
    if (ctx->cachedHullLast >= 0)
    {
        B3WHullCacheEntry* last = ctx->hullCache + ctx->cachedHullLast;
        if (last->hx == hx && last->hy == hy && last->hz == hz)
        {
            last->stamp = ctx->hullCacheStamp;
            return &last->hull;
        }
    }

    int replacement = 0;
    uint32_t oldestStamp = UINT32_MAX;
    for (int i = 0; i < B3W_HULL_CACHE_CAPACITY; ++i)
    {
        B3WHullCacheEntry* entry = ctx->hullCache + i;
        if (i != ctx->cachedHullLast && entry->valid != 0 && entry->hx == hx && entry->hy == hy && entry->hz == hz)
        {
            entry->stamp = ctx->hullCacheStamp;
            ctx->cachedHullLast = i;
            return &entry->hull;
        }
        if (entry->valid == 0)
        {
            replacement = i;
            oldestStamp = 0u;
            break;
        }
        if (entry->stamp < oldestStamp)
        {
            replacement = i;
            oldestStamp = entry->stamp;
        }
    }

    B3WHullCacheEntry* entry = ctx->hullCache + replacement;
    entry->hull = b3MakeBoxHull(hx, hy, hz);
    entry->hx = hx;
    entry->hy = hy;
    entry->hz = hz;
    entry->stamp = ctx->hullCacheStamp;
    entry->valid = 1;
    ctx->cachedHullLast = replacement;
    return &entry->hull;
}

static int b3w_ctx_add_box_ex(B3WContext* ctx, b3BodyType type, float x, float y, float z, float hx, float hy, float hz, uint32_t color, float density, float friction, float restitution)
{
    if (ctx->bodyCount >= ctx->capacity || (ctx->bodySlots != NULL && ctx->freeSlot < 0 && ctx->slotsUsed >= ctx->capacity))
    {
        return -1;
    }

    b3BodyDef bodyDef = b3DefaultBodyDef();
    bodyDef.type = type;
    bodyDef.position = (b3Pos){ x, y, z };
    if (type == b3_dynamicBody)
    {
        bodyDef.angularVelocity = (b3Vec3){ b3w_ctx_rand_range(ctx, -0.20f, 0.20f), b3w_ctx_rand_range(ctx, -0.15f, 0.15f), b3w_ctx_rand_range(ctx, -0.20f, 0.20f) };
    }

    b3BodyId body = b3CreateBody(ctx->world, &bodyDef);

    const b3BoxHull* hull = b3w_ctx_get_box_hull(ctx, hx, hy, hz);
    b3ShapeDef shapeDef = b3DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.baseMaterial.friction = friction;
    shapeDef.baseMaterial.restitution = restitution;
    shapeDef.baseMaterial.customColor = color;
    b3CreateHullShape(body, &shapeDef, &hull->base);

    int index = ctx->bodyCount++;
    ctx->bodies[index].id = body;
    ctx->bodies[index].hx = hx;
    ctx->bodies[index].hy = hy;
    ctx->bodies[index].hz = hz;
    ctx->bodies[index].color = color;
    ctx->bodies[index].dynamic = type == b3_dynamicBody ? 1 : 0;
    ctx->bodies[index].slot = b3w_ctx_allocate_body_slot(ctx, index);
    if (ctx->bodySlots != NULL) b3Body_SetUserData(body, (void*)(uintptr_t)(ctx->bodies[index].slot + 1));
    ctx->bodies[index].dynamicPosition = ctx->bodies[index].dynamic ? ctx->dynamicCount : -1;
    if (ctx->bodies[index].dynamic)
    {
        ctx->dynamicIndices[ctx->dynamicCount] = index;
        ctx->dynamicCount += 1;
    }

    b3w_unpack_rgb(color, ctx->colors + index * 4);
    b3w_ctx_write_axis_aligned_matrix(ctx, index, x, y, z, hx, hy, hz);
    ctx->transformVersion += 1u;
    ctx->colorVersion += 1u;
    ctx->hashDirty = 1;
    return index;
}

static void b3w_ctx_free_geometry(B3WContext* ctx, int slot);
static void b3w_ctx_drop_mass(B3WContext* ctx, int slot);

// Constant-time removal: compact dense rendering rows and repair both lookup
// tables. A body's public generation token does not encode its dense index.
static int b3w_ctx_destroy_body(B3WContext* ctx, uint64_t handle)
{
    int index = b3w_ctx_body_index(ctx, handle);
    if (index < 0) return 0;
    const B3WBody removed = ctx->bodies[index];
    b3DestroyBody(removed.id);
    b3w_ctx_free_geometry(ctx, removed.slot);
    b3w_ctx_drop_mass(ctx, removed.slot);
    if (removed.dynamic != 0)
    {
        int lastDynamic = ctx->dynamicIndices[--ctx->dynamicCount];
        ctx->dynamicIndices[removed.dynamicPosition] = lastDynamic;
        ctx->bodies[lastDynamic].dynamicPosition = removed.dynamicPosition;
        ctx->dynamicIndices[ctx->dynamicCount] = 0;
    }
    int last = --ctx->bodyCount;
    if (index != last)
    {
        ctx->bodies[index] = ctx->bodies[last];
        ctx->bodySlots[ctx->bodies[index].slot].denseIndex = index;
        if (ctx->bodies[index].dynamic != 0) ctx->dynamicIndices[ctx->bodies[index].dynamicPosition] = index;
        memcpy(ctx->matrices + index * 16, ctx->matrices + last * 16, 16u * sizeof(float));
        memcpy(ctx->colors + index * 4, ctx->colors + last * 4, 4u * sizeof(float));
        if (ctx->kinds != NULL) ctx->kinds[index] = ctx->kinds[last];
    }
    if (ctx->kinds != NULL) ctx->kinds[last] = 0u;
    memset(ctx->bodies + last, 0, sizeof(B3WBody));
    memset(ctx->matrices + last * 16, 0, 16u * sizeof(float));
    memset(ctx->colors + last * 4, 0, 4u * sizeof(float));
    b3w_ctx_release_body_slot(ctx, removed.slot);
    ctx->transformVersion += 1u;
    ctx->colorVersion += 1u;
    ctx->hashDirty = 1;
    return 1;
}

static void b3w_ctx_destroy_world(B3WContext* ctx)
{
    if (ctx->queries.version < UINT32_MAX) ctx->queries.version += 1u;
    const int hadBodies = ctx->bodyCount != 0;
    for (int i = 0; i < ctx->bodyCount; ++i) b3w_ctx_release_body_slot(ctx, ctx->bodies[i].slot);
    if (B3_IS_NON_NULL(ctx->world))
    {
        b3DestroyWorld(ctx->world);
        ctx->world = b3_nullWorldId;
    }
    b3w_ctx_free_geometry(ctx, -1);
    b3w_snapshot_release(ctx->snapshotHolder);
    ctx->snapshotHolder = NULL;
    ctx->massOverrideCount = 0;
    if (ctx->jointFlags != NULL) memset(ctx->jointFlags, 0, (size_t)ctx->jointFlagCapacity * sizeof(uint32_t));
    ctx->jointRecordCount = 0;
    ctx->debugCount = 0;
    ctx->debugTotal = 0;

    if (ctx->kinds != NULL) memset(ctx->kinds, 0, (size_t)ctx->bodyCount);
    ctx->anchor = b3_nullBodyId;
    ctx->eventCount = 0;
    ctx->eventTotal = 0;
    ctx->bodyCount = 0;
    ctx->dynamicCount = 0;
    ctx->hash = 0u;
    ctx->hashDirty = 1;
    // The active stream length is zero now, and every slot in a subsequent
    // scene is overwritten by b3w_add_box_ex before it becomes visible. Do not
    // clear the unused 320 KiB capacity on every scene switch.
    if (hadBodies)
    {
        ctx->transformVersion += 1u;
        ctx->colorVersion += 1u;
    }
}

static void b3w_ctx_create_world(B3WContext* ctx, uint32_t seed)
{
    b3w_ctx_destroy_world(ctx);
    ctx->rng = seed == 0u ? 0xC0FFEEu : seed;

    b3WorldDef worldDef = b3DefaultWorldDef();
    worldDef.gravity = (b3Vec3){ 0.0f, -10.0f, 0.0f };
    worldDef.workerCount = 1;
    worldDef.enableSleep = true;
    worldDef.enableContinuous = true;
    ctx->world = b3CreateWorld(&worldDef);

    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, -1.0f, 0.0f, 44.0f, 1.0f, 44.0f, 0x162033u, 0.0f, 0.86f, 0.02f);
}

static void b3w_ctx_scene_stack(B3WContext* ctx, int stress)
{
    const int columns = 8 + stress * 4;
    const int rows = 8 + stress * 5;
    const int layers = 1 + (int)floorf((float)stress * 0.9f);
    const uint32_t palette[] = { 0x30AEBFu, 0xDC3132u, 0x8CC924u, 0xFFEE8Cu, 0x7C3AEDu, 0xF97316u, 0x06B6D4u, 0x22C55Eu };
    const int paletteCount = (int)(sizeof(palette) / sizeof(palette[0]));
    const float h = 0.48f;
    const float gap = 0.055f;
    const float sx = 2.0f * h + gap;
    const float sy = 2.0f * h + gap;
    const float sz = 2.0f * h + gap;
    const float startX = -0.5f * (float)(columns - 1) * sx;
    const float startZ = -0.5f * (float)(layers - 1) * sz;

    for (int layer = 0; layer < layers; ++layer)
    {
        for (int y = 0; y < rows; ++y)
        {
            for (int x = 0; x < columns; ++x)
            {
                float px = startX + (float)x * sx + b3w_ctx_rand_range(ctx, -0.014f, 0.014f);
                float py = h + (float)y * sy + b3w_ctx_rand_range(ctx, -0.005f, 0.005f);
                float pz = startZ + (float)layer * sz + b3w_ctx_rand_range(ctx, -0.014f, 0.014f);
                b3w_ctx_add_box_ex(ctx, b3_dynamicBody, px, py, pz, h, h, h, palette[(x + y + layer) % paletteCount], 1.0f, 0.68f, 0.04f);
            }
        }
    }
}

static void b3w_ctx_scene_domino(B3WContext* ctx, int stress)
{
    const int count = 48 + stress * 34;
    const float radius = 7.0f + (float)stress * 2.6f;
    for (int i = 0; i < count; ++i)
    {
        float t = ((float)i / (float)count) * 6.28318530718f;
        float ring = (i & 1) == 0 ? radius : radius * 0.62f;
        uint32_t color = i % 3 == 0 ? 0x30AEBFu : (i % 3 == 1 ? 0xFFEE8Cu : 0xDC3132u);
        b3w_ctx_add_box_ex(ctx, b3_dynamicBody, cosf(t) * ring, 1.25f, sinf(t) * ring, 0.07f, 1.25f, 0.42f, color, 0.8f, 0.74f, 0.02f);
    }
}

static void b3w_ctx_scene_skyscraper(B3WContext* ctx, int stress)
{
    const int levels = 7 + stress * 4;
    const int grid = 3 + stress / 2;
    const float spacing = 1.65f;
    const float halfSpan = ((float)(grid - 1) * spacing) * 0.5f;
    for (int y = 0; y < levels; ++y)
    {
        float levelY = 0.35f + (float)y * 1.05f;
        b3w_ctx_add_box_ex(ctx, b3_dynamicBody, 0.0f, levelY, 0.0f, halfSpan + 0.85f, 0.08f, halfSpan + 0.85f, y % 2 ? 0x214160u : 0x263B59u, 1.2f, 0.62f, 0.02f);
        for (int x = 0; x < grid; ++x)
        {
            for (int z = 0; z < grid; ++z)
            {
                if (x != 0 && x != grid - 1 && z != 0 && z != grid - 1)
                {
                    continue;
                }
                b3w_ctx_add_box_ex(ctx, b3_dynamicBody, -halfSpan + (float)x * spacing, levelY + 0.5f, -halfSpan + (float)z * spacing, 0.14f, 0.5f, 0.14f, 0xD8DEE9u, 2.5f, 0.66f, 0.02f);
            }
        }
    }
    int projectile = b3w_ctx_add_box_ex(ctx, b3_dynamicBody, -22.0f, 4.6f + (float)stress, 0.0f, 0.82f, 0.82f, 0.82f, 0xFFD166u, 8.0f, 0.45f, 0.12f);
    if (projectile >= 0)
    {
        b3Body_ApplyLinearImpulseToCenter(ctx->bodies[projectile].id, (b3Vec3){ 60.0f + stress * 8.0f, 8.0f, 0.0f }, true);
    }
}

static void b3w_ctx_scene_bridge(B3WContext* ctx, int stress)
{
    b3w_ctx_add_box_ex(ctx, b3_staticBody, -10.0f, 1.1f, 0.0f, 1.2f, 1.1f, 3.2f, 0x394150u, 0.0f, 0.8f, 0.02f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 10.0f, 1.1f, 0.0f, 1.2f, 1.1f, 3.2f, 0x394150u, 0.0f, 0.8f, 0.02f);
    const int segments = 12 + stress * 5;
    const float spacing = 20.0f / (float)segments;
    for (int i = 0; i < segments; ++i)
    {
        float x = -10.0f + spacing * ((float)i + 0.5f);
        b3w_ctx_add_box_ex(ctx, b3_dynamicBody, x, 2.45f + b3w_ctx_rand_range(ctx, -0.015f, 0.015f), 0.0f, spacing * 0.52f, 0.13f, 1.55f, i % 2 ? 0x30AEBFu : 0x0D8EA7u, 1.5f, 0.78f, 0.02f);
    }
    for (int y = 0; y < 2 + stress; ++y)
    {
        for (int i = 0; i < 6 + stress * 2; ++i)
        {
            b3w_ctx_add_box_ex(ctx, b3_dynamicBody, -4.0f + (float)i * 0.9f, 3.1f + (float)y * 0.85f, b3w_ctx_rand_range(ctx, -0.9f, 0.9f), 0.36f, 0.36f, 0.36f, y % 2 ? 0xF97316u : 0xFFEE8Cu, 4.0f, 0.65f, 0.01f);
        }
    }
}

static void b3w_ctx_scene_material(B3WContext* ctx, int stress)
{
    const uint32_t colors[] = { 0x30AEBFu, 0xDC3132u, 0x8CC924u, 0xFFEE8Cu, 0x7C3AEDu };
    for (int lane = 0; lane < 5; ++lane)
    {
        float z = ((float)lane - 2.0f) * 3.2f;
        float restitution = (float)lane / 5.0f;
        float friction = 0.15f + (float)lane * 0.16f;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -10.0f, 2.2f, z, 4.8f, 0.12f, 1.1f, 0x243247u, 0.0f, friction, restitution);
        for (int i = 0; i < 7 + stress * 3; ++i)
        {
            int body = b3w_ctx_add_box_ex(ctx, b3_dynamicBody, -13.0f + (float)i * 0.8f, 5.2f + (float)i * 0.07f, z + b3w_ctx_rand_range(ctx, -0.22f, 0.22f), 0.3f, 0.3f, 0.3f, colors[lane], 1.0f, friction, restitution);
            if (body >= 0)
            {
                b3Body_ApplyLinearImpulseToCenter(ctx->bodies[body].id, (b3Vec3){ 2.0f + (float)lane * 0.8f, 0.0f, 0.0f }, true);
            }
        }
    }
}



static void b3w_ctx_scene_cloth_stage(B3WContext* ctx, int stress, int variant)
{
    float span = 11.0f + (float)(variant % 3) * 1.4f;
    float top = 10.5f + (float)stress * 0.8f + (variant == 2 ? 4.5f : 0.0f);
    // Flag and sail layouts pin their left edge at -0.94 times cloth width.
    // Place the display post just outside that boundary instead of through it.
    float clothWidth = 14.0f + (float)variant * 0.16f;
    float leftPost = (variant == 0 || variant == 5) ? -clothWidth * 0.94f - 0.35f : -span;
    float railCenter = (leftPost + span) * 0.5f;
    float railHalfWidth = (span - leftPost) * 0.5f;
    uint32_t postColor = (variant & 1) ? 0x334155u : 0x475569u;
    uint32_t railColor = (variant & 1) ? 0xFFD166u : 0x30AEBFu;
    b3w_ctx_add_box_ex(ctx, b3_staticBody, leftPost, top * 0.5f, 0.0f, 0.22f, top * 0.5f, 0.22f, postColor, 0.0f, 0.82f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, span, top * 0.5f, 0.0f, 0.22f, top * 0.5f, 0.22f, postColor, 0.0f, 0.82f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, railCenter, top, 0.0f, railHalfWidth, 0.20f, 0.20f, railColor, 0.0f, 0.82f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.12f, 0.0f, span + 2.5f, 0.12f, 7.0f, 0x132033u, 0.0f, 0.88f, 0.01f);
    if (variant == 3 || variant == 7)
    {
        float radius = variant == 7 ? 3.1f : 1.7f;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 4.4f, 0.0f, radius, radius, radius, 0x15243Bu, 0.0f, 0.45f, 0.05f);
    }
    if (variant == 2)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, top + 2.1f, 0.0f, 1.6f, 0.42f, 1.6f, 0xFFD166u, 0.0f, 0.70f, 0.02f);
    }
}

static void b3w_ctx_scene_rope_stage(B3WContext* ctx, int stress, int variant)
{
    float towerHeight = 12.5f + (float)stress * 0.75f;
    float span = (variant == 1 || variant == 6 || variant == 9) ? 16.0f : 9.0f;
    uint32_t towerColor = (variant & 1) ? 0xF97316u : 0x30AEBFu;
    for (int sideIndex = 0; sideIndex < 2; ++sideIndex)
    {
        float side = sideIndex == 0 ? -1.0f : 1.0f;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, side * span, towerHeight * 0.5f, -2.2f, 0.28f, towerHeight * 0.5f, 0.28f, towerColor, 0.0f, 0.85f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, side * span, towerHeight * 0.5f, 2.2f, 0.28f, towerHeight * 0.5f, 0.28f, towerColor, 0.0f, 0.85f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, side * span, towerHeight, 0.0f, 0.24f, 0.24f, 2.2f, towerColor, 0.0f, 0.85f, 0.01f);
    }
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.16f, 0.0f, span + 3.0f, 0.16f, 7.5f, 0x111D30u, 0.0f, 0.88f, 0.01f);
    if (variant == 1 || variant == 6)
    {
        const int segments = 11;
        float segmentHalf = span / (float)segments * 0.52f;
        for (int i = 0; i < segments; ++i)
        {
            float x = -span + ((float)i + 0.5f) * (span * 2.0f / (float)segments);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 3.4f, 0.0f, segmentHalf, 0.14f, 1.7f, (i & 1) ? 0x243A55u : 0x2F4D69u, 0.0f, 0.82f, 0.01f);
        }
    }
    else if (variant == 0 || variant == 2 || variant == 8)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, towerHeight - 0.3f, 0.0f, span, 0.17f, 0.17f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 2.0f, 0.0f, 3.5f, 0.18f, 3.0f, 0x18263Bu, 0.0f, 0.85f, 0.01f);
    }
}

static void b3w_ctx_scene_water_stage(B3WContext* ctx, int stress, int variant)
{
    float halfWidth = 16.0f + (float)(variant % 3) * 1.5f;
    float halfDepth = 10.0f + (float)(variant % 2) * 1.5f;
    float wallHeight = (variant == 1 || variant == 5) ? 4.2f : 2.4f;
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, -0.15f, 0.0f, halfWidth, 0.15f, halfDepth, 0x0B1F33u, 0.0f, 0.92f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, -halfWidth - 0.25f, wallHeight * 0.5f, 0.0f, 0.25f, wallHeight * 0.5f, halfDepth + 0.5f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, halfWidth + 0.25f, wallHeight * 0.5f, 0.0f, 0.25f, wallHeight * 0.5f, halfDepth + 0.5f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, wallHeight * 0.5f, -halfDepth - 0.25f, halfWidth + 0.5f, wallHeight * 0.5f, 0.25f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, wallHeight * 0.5f, halfDepth + 0.25f, halfWidth + 0.5f, wallHeight * 0.5f, 0.25f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    if (variant == 1 || variant == 5)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -halfWidth + 2.1f, 2.3f, 0.0f, 0.5f, 2.3f, halfDepth * 0.82f, 0x314861u, 0.0f, 0.80f, 0.01f);
    }
    const uint32_t colors[] = { 0x30AEBFu, 0xF97316u, 0xFFD166u, 0x8B5CF6u, 0x22C55Eu };
    for (int i = 0; i < 2 + stress; ++i)
    {
        float size = 0.45f + (float)(i % 3) * 0.16f;
        b3w_ctx_add_box_ex(ctx,
            b3_dynamicBody,
            -5.0f + (float)i * 2.4f,
            2.4f + (float)i * 0.3f,
            b3w_ctx_rand_range(ctx, -3.5f, 3.5f),
            size * 1.4f,
            size * 0.55f,
            size,
            colors[(variant + i + 2) % 5],
            0.45f,
            0.40f,
            0.08f);
    }
}

static void b3w_ctx_scene_fracture_stage(B3WContext* ctx, int stress, int variant)
{
    // Box3D owns only the immutable test fixture. The browser soft-material
    // solver remains authoritative for bending, yield, damage, and fracture.
    if (variant == 6)
    {
        const uint32_t metal = b3w_material_color(0x9AA7B5u, 2u);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.14f, 0.0f, 15.5f, 0.14f, 6.5f, 0x080F1Du, 0.0f, 0.90f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -12.3f, 7.2f, 0.0f, 0.34f, 5.0f, 0.34f, metal, 0.0f, 0.80f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 12.3f, 7.2f, 0.0f, 0.34f, 5.0f, 0.34f, metal, 0.0f, 0.80f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 2.7f, 0.0f, 12.3f, 0.22f, 0.34f, metal, 0.0f, 0.80f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 11.7f, 0.0f, 12.3f, 0.22f, 0.34f, metal, 0.0f, 0.80f, 0.01f);
        const float light_x[3] = { -7.5f, 0.0f, 7.5f };
        for (int i = 0; i < 3; ++i) b3w_ctx_add_box_ex(ctx, b3_staticBody, light_x[i], 4.8f, -3.0f, 1.5f, 0.05f, 0.08f, 0x50D8FFu, 0.0f, 0.80f, 0.01f);
        return;
    }
    float support_span = variant == 5 ? 12.0f : 8.5f + (float)(variant % 3) * 0.65f;
    float frame_top = 9.4f + (float)stress * 0.28f;
    uint32_t accent = (variant & 1) ? 0xFFD166u : 0x30AEBFu;
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.14f, 0.0f, support_span + 5.0f, 0.14f, 6.5f, 0x111D30u, 0.0f, 0.90f, 0.01f);
    for (int side = -1; side <= 1; side += 2)
    {
        float x = (float)side * support_span;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 0.9f, 0.0f, 0.62f, 0.9f, 2.35f, 0x334155u, 0.0f, 0.88f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 1.9f, 0.0f, 0.9f, 0.10f, 2.55f, accent, 0.0f, 0.82f, 0.01f);
    }
    for (int side = -1; side <= 1; side += 2)
    {
        float z = (float)side * 5.2f;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, frame_top * 0.5f, z, 0.30f, frame_top * 0.5f, 0.30f, 0x475569u, 0.0f, 0.85f, 0.01f);
    }
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, frame_top, 0.0f, 0.28f, 0.28f, 5.2f, accent, 0.0f, 0.82f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, frame_top - 1.75f, 0.0f, 0.34f, 1.75f, 0.34f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
    b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, frame_top - 3.55f, 0.0f, 0.72f, 0.12f, 1.15f, 0xF97316u, 0.0f, 0.82f, 0.01f);
}

static void b3w_ctx_add_aaa_set_dressing(B3WContext* ctx, int family, int stress, int variant)
{
    // Arena beacons and floor edge markers give every native scene a readable scale.
    const float arena = 24.0f;
    const uint32_t beaconColors[4] = { 0x59D8FFu, 0xFFC96Bu, 0xB796FFu, 0x68F1B3u };
    for (int i = 0; i < 4; ++i)
    {
        float x = (i & 1) ? arena : -arena;
        float z = (i & 2) ? arena : -arena;
        b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 2.2f, z, 0.16f, 2.2f, 0.16f, 0x40516Au, 0.0f, 0.82f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 4.55f, z, 0.34f, 0.12f, 0.34f, beaconColors[i], 0.0f, 0.82f, 0.01f);
    }

    switch (family)
    {
        case 0: // foundry gantries around stack tests
            for (int x = -15; x <= 15; x += 6)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.5f + stress * 0.25f, -10.0f, 0.16f, 4.5f + stress * 0.25f, 0.16f, 0x64748Bu, 0.0f, 0.8f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.5f + stress * 0.25f, 10.0f, 0.16f, 4.5f + stress * 0.25f, 0.16f, 0x64748Bu, 0.0f, 0.8f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 9.0f + stress * 0.5f, 0.0f, 0.14f, 0.14f, 10.0f, 0x0D8EA7u, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 1: // radial stage and illuminated perimeter
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.12f, 0.0f, 10.5f, 0.12f, 10.5f, 0x111C31u, 0.0f, 0.9f, 0.01f);
            for (int i = 0; i < 16; ++i)
            {
                float t = ((float)i / 16.0f) * 6.28318530718f;
                float r = 17.5f;
                float x = cosf(t) * r;
                float z = sinf(t) * r;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 2.4f, z, 0.22f, 2.4f, 0.22f, 0x45566Fu, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 4.95f, z, 0.42f, 0.11f, 0.42f, i % 2 ? 0x59D8FFu : 0xFFC96Bu, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 2: // tower podium, skyline massing, rooftop spire
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.25f, 0.0f, 8.5f, 0.25f, 8.5f, 0x18253Bu, 0.0f, 0.88f, 0.01f);
            for (int i = 0; i < 14; ++i)
            {
                float x = -24.0f + (float)i * 3.7f;
                float h = 2.0f + (float)((i * 7 + variant * 3) % 8) * 0.75f;
                float z = (i & 1) ? 17.0f : -17.0f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, h, z, 1.15f, h, 1.15f, i % 3 ? 0x1B2A43u : 0x263B59u, 0.0f, 0.82f, 0.01f);
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 19.0f + stress, 0.0f, 0.12f, 5.0f, 0.12f, 0xFFC96Bu, 0.0f, 0.82f, 0.01f);
            break;

        case 3: // bridge pylons and visual cable bands
            for (int side = -1; side <= 1; side += 2)
            {
                float x = (float)side * 8.3f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 5.0f, -2.25f, 0.2f, 5.0f, 0.2f, 0x64748Bu, 0.0f, 0.85f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 5.0f, 2.25f, 0.2f, 5.0f, 0.2f, 0x64748Bu, 0.0f, 0.85f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 9.7f, 0.0f, 0.22f, 0.14f, 2.4f, 0x59D8FFu, 0.0f, 0.85f, 0.01f);
            }
            for (int x = -18; x <= 18; x += 3)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 2.65f, -2.05f, 0.045f, 0.6f + 0.035f * (float)(18 - abs(x)), 0.045f, 0xFFC96Bu, 0.0f, 0.8f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 2.65f, 2.05f, 0.045f, 0.6f + 0.035f * (float)(18 - abs(x)), 0.045f, 0xFFC96Bu, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 4: // synchronized material lane markers
            for (int lane = -2; lane <= 2; ++lane)
            {
                float z = (float)lane * 3.2f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.025f, z - 1.22f, 14.0f, 0.025f, 0.035f, lane % 2 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.9f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.025f, z + 1.22f, 14.0f, 0.025f, 0.035f, lane % 2 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.9f, 0.01f);
            }
            break;

        case 5: // storm containment towers
            for (int x = -18; x <= 18; x += 6)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 5.0f, -18.0f, 0.13f, 5.0f, 0.13f, 0x40516Au, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 5.0f, 18.0f, 0.13f, 5.0f, 0.13f, 0x40516Au, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 10.0f, 0.0f, 0.1f, 0.1f, 18.0f, 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 6: // demolition safety perimeter
            for (int i = -8; i <= 8; ++i)
            {
                uint32_t c = (i & 1) ? 0xF97316u : 0xFDE68Au;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)i * 2.1f, 0.65f, -13.0f, 0.8f, 0.65f, 0.18f, c, 0.0f, 0.8f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)i * 2.1f, 0.65f, 13.0f, 0.8f, 0.65f, 0.18f, c, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 7: // vehicle lanes and overhead timing gantry
            for (int lane = -2; lane <= 2; ++lane)
            {
                float z = (float)lane * 3.9f;
                for (int x = -20; x <= 20; x += 4)
                {
                    b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 0.035f, z, 1.3f, 0.035f, 0.035f, 0xFFF2A8u, 0.0f, 0.9f, 0.01f);
                }
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 8.0f, 3.0f, -11.0f, 0.15f, 3.0f, 0.15f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 8.0f, 3.0f, 11.0f, 0.15f, 3.0f, 0.15f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 8.0f, 6.0f, 0.0f, 0.15f, 0.15f, 11.0f, 0x0D8EA7u, 0.0f, 0.82f, 0.01f);
            break;

        case 8: // marble arena frames and collection bins
            for (int x = -15; x <= 15; x += 6)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.2f, -9.0f, 0.12f, 4.2f, 0.12f, 0x475569u, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.2f, 9.0f, 0.12f, 4.2f, 0.12f, 0x475569u, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 8.4f, 0.0f, 0.1f, 0.1f, 9.0f, 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            for (int bin = -3; bin <= 3; ++bin)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, 14.0f, 0.45f, (float)bin * 2.5f, 1.4f, 0.45f, 1.0f, bin & 1 ? 0x7C3AEDu : 0x0D8EA7u, 0.0f, 0.74f, 0.18f);
            }
            break;

        case 9: // construction crane silhouette and suspended load
            for (int y = 0; y < 13; ++y)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, -14.0f, 0.5f + (float)y, -8.0f, 0.18f, 0.5f, 0.18f, y & 1 ? 0xF97316u : 0xFFD166u, 0.0f, 0.82f, 0.01f);
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, -2.5f, 13.2f, -8.0f, 11.5f, 0.16f, 0.16f, 0xF97316u, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 5.0f, 10.2f, -8.0f, 0.055f, 3.0f, 0.055f, 0xD8DEE9u, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_dynamicBody, 5.0f, 6.6f, -8.0f, 1.4f, 0.4f, 0.8f, 0xFFD166u, 4.5f, 0.7f, 0.02f);
            break;

        case 10: // warehouse dock wall and overhead rails
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 18.0f, 2.5f, 0.0f, 0.45f, 2.5f, 18.0f, 0x172235u, 0.0f, 0.84f, 0.01f);
            for (int dock = -4; dock <= 4; ++dock)
            {
                float z = (float)dock * 3.7f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, 17.45f, 1.0f, z, 0.58f, 1.0f, 1.45f, dock & 1 ? 0x263B59u : 0x334155u, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, 16.85f, 2.3f, z, 0.1f, 0.1f, 0.82f, dock & 1 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, -1.5f, 7.5f, -10.0f, 16.5f, 0.1f, 0.1f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, -1.5f, 7.5f, 10.0f, 16.5f, 0.1f, 0.1f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            break;

        case 11: // architectural colonnade and central presentation plinth
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.14f, 0.0f, 9.0f, 0.14f, 9.0f, 0x17243Au, 0.0f, 0.88f, 0.01f);
            for (int i = 0; i < 18; ++i)
            {
                float t = ((float)i / 18.0f) * 6.28318530718f;
                float x = cosf(t) * 17.5f;
                float z = sinf(t) * 17.5f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 2.8f, z, 0.32f, 2.8f, 0.32f, i & 1 ? 0xD8DEE9u : 0xB8C2D3u, 0.0f, 0.84f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 5.8f, z, 0.58f, 0.18f, 0.58f, i % 3 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.84f, 0.01f);
            }
            break;

        case 12: // cloth wind-tunnel rails and observation markers
            b3w_ctx_add_box_ex(ctx, b3_staticBody, -16.0f, 7.5f, 0.0f, 0.10f, 0.10f, 8.0f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 16.0f, 7.5f, 0.0f, 0.10f, 0.10f, 8.0f, 0xFFD166u, 0.0f, 0.82f, 0.01f);
            for (int i = -4; i <= 4; ++i)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)i * 3.6f, 0.12f, 9.5f, 1.2f, 0.12f, 0.22f, (i & 1) ? 0x8B5CF6u : 0x50D8FFu, 0.0f, 0.84f, 0.01f);
            }
            break;

        case 13: // rope/cable load-test towers
            for (int sideIndex = 0; sideIndex < 2; ++sideIndex)
            {
                float side = sideIndex == 0 ? -1.0f : 1.0f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, side * 19.0f, 5.0f, -7.0f, 0.12f, 5.0f, 0.12f, 0xF97316u, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, side * 19.0f, 5.0f, 7.0f, 0.12f, 5.0f, 0.12f, 0xF97316u, 0.0f, 0.82f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, side * 19.0f, 10.0f, 0.0f, 0.10f, 0.10f, 7.0f, 0xFFD166u, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 14: // hydrodynamics observation wall and luminous datum rail
            for (int i = -5; i <= 5; ++i)
            {
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)i * 3.2f, 0.42f, -14.0f, 1.1f, 0.42f, 0.26f, (i & 1) ? 0x1D4E6Du : 0x2C6F8Fu, 0.0f, 0.85f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)i * 3.2f, 0.42f, 14.0f, 1.1f, 0.42f, 0.26f, (i & 1) ? 0x1D4E6Du : 0x2C6F8Fu, 0.0f, 0.85f, 0.01f);
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 6.5f, -13.0f, 18.0f, 0.08f, 0.08f, 0x50D8FFu, 0.0f, 0.82f, 0.01f);
            break;

        case 15: // material fracture observation rails
            for (int i = -5; i <= 5; ++i)
            {
                float x = (float)i * 3.2f;
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 0.08f, -6.1f, 1.25f, 0.08f, 0.08f, (i & 1) ? 0xFFD166u : 0x50D8FFu, 0.0f, 0.86f, 0.01f);
                b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 0.08f, 6.1f, 1.25f, 0.08f, 0.08f, (i & 1) ? 0x50D8FFu : 0xFFD166u, 0.0f, 0.86f, 0.01f);
            }
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 6.8f, -5.8f, 13.0f, 0.07f, 0.07f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 6.8f, 5.8f, 13.0f, 0.07f, 0.07f, 0xFFD166u, 0.0f, 0.82f, 0.01f);
            break;
    }
}

static void b3w_ctx_add_signature_set_dressing(B3WContext* ctx, int family, int stress, int variant)
{
    const uint32_t concrete = b3w_material_color(0x8B8D88u, 1u);
    const uint32_t metal = b3w_material_color(0x9AA7B5u, 2u);
    const uint32_t glass = b3w_material_color(0x8EDDF2u, 4u);
    const uint32_t stone = b3w_material_color(0xA0A09Au, 5u);

    if (family == 2 && (variant == 0 || variant == 7))
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.42f, 0.0f, 9.4f, 0.42f, 9.4f, concrete, 0.0f, 0.82f, 0.015f);
        for (int floor = 0; floor < 9; ++floor)
        {
            float y = 2.2f + (float)floor * 1.75f;
            float width = variant == 7 ? 7.8f : 5.7f;
            b3w_ctx_add_box_ex(ctx, b3_staticBody, -width, y, 0.0f, 0.055f, 0.67f, width * 0.88f, glass, 0.0f, 0.22f, 0.06f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, width, y, 0.0f, 0.055f, 0.67f, width * 0.88f, glass, 0.0f, 0.22f, 0.06f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, y, -width, width * 0.88f, 0.67f, 0.055f, glass, 0.0f, 0.22f, 0.06f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, y, width, width * 0.88f, 0.67f, 0.055f, glass, 0.0f, 0.22f, 0.06f);
        }
        return;
    }

    if (family == 3 && variant == 2)
    {
        const float supports[4] = { -17.0f, -8.5f, 8.5f, 17.0f };
        for (int i = 0; i < 4; ++i) b3w_ctx_add_box_ex(ctx, b3_staticBody, supports[i], 1.15f, 0.0f, 1.15f, 1.15f, 3.7f, concrete, 0.0f, 0.82f, 0.015f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.18f, 0.0f, 22.5f, 0.18f, 3.15f, stone, 0.0f, 0.88f, 0.01f);
        for (int x = -18; x <= 18; x += 3)
        {
            b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.2f + (float)(x & 1) * 0.6f, -2.05f, 0.07f, 1.8f, 0.07f, metal, 0.0f, 0.74f, 0.02f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)x, 4.2f + (float)(x & 1) * 0.6f, 2.05f, 0.07f, 1.8f, 0.07f, metal, 0.0f, 0.74f, 0.02f);
        }
        return;
    }

    if (family == 6 && variant == 0)
    {
        for (int i = 0; i < 28 + stress * 3; ++i)
        {
            float size = b3w_ctx_rand_range(ctx, 0.14f, 0.42f);
            b3w_ctx_add_box_ex(ctx, b3_dynamicBody, b3w_ctx_rand_range(ctx, -6.5f, 6.5f), b3w_ctx_rand_range(ctx, 0.35f, 3.2f), b3w_ctx_rand_range(ctx, -5.2f, -4.2f), size, size * 0.7f, size * 0.85f, concrete, 2.35f, 0.82f, 0.015f);
        }
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 2.2f, -4.35f, 8.0f, 0.065f, 0.065f, metal, 0.0f, 0.74f, 0.02f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 2.2f, -5.05f, 8.0f, 0.065f, 0.065f, metal, 0.0f, 0.74f, 0.02f);
        return;
    }

    if (family == 11 && variant == 9)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.18f, 0.0f, 11.5f, 0.18f, 11.5f, stone, 0.0f, 0.88f, 0.01f);
        for (int i = 0; i < 20; ++i)
        {
            float t = ((float)i / 20.0f) * 6.28318530718f;
            float x = cosf(t) * 12.8f;
            float z = sinf(t) * 12.8f;
            b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 4.8f, z, 0.72f, 3.25f, 0.055f, glass, 0.0f, 0.22f, 0.06f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 8.25f, z, 0.09f, 0.09f, 0.72f, metal, 0.0f, 0.74f, 0.02f);
        }
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 8.9f, 0.0f, 9.2f, 0.18f, 9.2f, concrete, 0.0f, 0.82f, 0.015f);
        return;
    }

    if (family == 12 && variant == 0)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.18f, 3.2f, 15.5f, 0.18f, 4.5f, stone, 0.0f, 0.88f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -15.2f, 5.55f, -5.5f, 0.12f, 5.25f, 0.12f, metal, 0.0f, 0.74f, 0.02f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 15.2f, 5.55f, -5.5f, 0.12f, 5.25f, 0.12f, metal, 0.0f, 0.74f, 0.02f);
        return;
    }

    if (family == 13 && variant == 0)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -9.0f, 0.55f, 0.0f, 1.35f, 0.55f, 3.0f, concrete, 0.0f, 0.82f, 0.015f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 9.0f, 0.55f, 0.0f, 1.35f, 0.55f, 3.0f, concrete, 0.0f, 0.82f, 0.015f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.2f, 0.0f, 7.6f, 0.2f, 4.1f, stone, 0.0f, 0.88f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, -9.0f, 7.35f, -2.8f, 0.14f, 6.15f, 0.14f, metal, 0.0f, 0.74f, 0.02f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 9.0f, 7.35f, -2.8f, 0.14f, 6.15f, 0.14f, metal, 0.0f, 0.74f, 0.02f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 13.5f, -2.8f, 9.0f, 0.14f, 0.14f, metal, 0.0f, 0.74f, 0.02f);
        return;
    }

    if (family == 14 && variant == 1)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.15f, -11.7f, 18.5f, 0.15f, 0.55f, concrete, 0.0f, 0.82f, 0.015f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.15f, 11.7f, 18.5f, 0.15f, 0.55f, concrete, 0.0f, 0.82f, 0.015f);
        for (int i = -5; i <= 5; ++i)
        {
            float x = (float)i * 3.1f;
            b3w_ctx_add_box_ex(ctx, b3_staticBody, x, 2.45f, 11.42f, 1.37f, 1.75f, 0.04f, glass, 0.0f, 0.22f, 0.06f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, x + 1.48f, 2.45f, 11.38f, 0.045f, 1.85f, 0.065f, metal, 0.0f, 0.74f, 0.02f);
        }
        return;
    }

    if (family == 15 && variant == 5)
    {
        // MaterialSimulation is authoritative for reinforcement exposure and
        // generated spall. Keep the native opening state clean and duplicate-free.
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.20f, 0.0f, 11.8f, 0.20f, 2.5f, stone, 0.0f, 0.88f, 0.01f);
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.62f, 2.35f, 11.8f, 0.42f, 0.12f, concrete, 0.0f, 0.82f, 0.015f);
        return;
    }

    if (family == 15 && variant == 6)
    {
        b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, 0.18f, 0.0f, 10.8f, 0.18f, 4.2f, stone, 0.0f, 0.88f, 0.01f);
        for (int side = -1; side <= 1; side += 2)
        {
            b3w_ctx_add_box_ex(ctx, b3_staticBody, (float)side * 10.2f, 4.6f, 0.0f, 0.035f, 3.4f, 2.7f, glass, 0.0f, 0.22f, 0.06f);
        }
        const float light_x[3] = { -7.5f, 0.0f, 7.5f };
        for (int i = 0; i < 3; ++i)
        {
            b3w_ctx_add_box_ex(ctx, b3_staticBody, light_x[i], 0.38f, -2.8f, 1.9f, 0.10f, 0.12f, metal, 0.0f, 0.74f, 0.02f);
            b3w_ctx_add_box_ex(ctx, b3_staticBody, light_x[i], 0.55f, -2.8f, 0.22f, 0.05f, 0.22f, 0x50D8FFu, 0.0f, 0.74f, 0.02f);
        }
    }
}

static int b3w_ctx_spawn_rain(B3WContext* ctx, int count, float spread, float height)
{
    if (B3_IS_NULL(ctx->world)) return 0;
    if (count < 1) count = 1;
    if (spread < 1.0f) spread = 1.0f;
    int added = 0;
    const uint32_t palette[] = { 0x30AEBFu, 0xDC3132u, 0x8CC924u, 0xFFEE8Cu, 0x7C3AEDu, 0xF97316u };
    for (int i = 0; i < count && ctx->bodyCount < ctx->capacity; ++i)
    {
        float size = b3w_ctx_rand_range(ctx, 0.22f, 0.55f);
        int body = b3w_ctx_add_box_ex(ctx, b3_dynamicBody, b3w_ctx_rand_range(ctx, -spread, spread), height + b3w_ctx_rand_range(ctx, 0.0f, 18.0f), b3w_ctx_rand_range(ctx, -spread, spread), size, size, size, palette[i % 6], 1.0f, 0.62f, 0.05f);
        if (body >= 0)
        {
            b3Body_ApplyLinearImpulseToCenter(ctx->bodies[body].id, (b3Vec3){ b3w_ctx_rand_range(ctx, -1.2f, 1.2f), b3w_ctx_rand_range(ctx, -2.0f, 1.0f), b3w_ctx_rand_range(ctx, -1.2f, 1.2f) }, true);
            added += 1;
        }
    }
    return added;
}

static void b3w_ctx_scene_rain(B3WContext* ctx, int stress)
{
    b3w_ctx_spawn_rain(ctx, 180 + stress * 420, 16.0f + stress * 3.0f, 12.0f + stress * 4.0f);
}

static int b3w_ctx_create_scene(B3WContext* ctx, int sceneId, int stressScale, uint32_t seed)
{
    int stress = b3w_clamp_int(stressScale, 1, 5);
    int family = sceneId / 50;
    int mode = (sceneId % 50) / 10;
    int variant = sceneId % 10;
    b3w_ctx_create_world(ctx, seed);

    // The browser catalog has 800 scenes: 16 families x 5 modes x 10 variants.
    // This C bridge maps each family to a Box3D-native recipe and layers
    // lightweight variant actions on top until the full native catalog is expanded.
    switch (family)
    {
        default:
        case 0: b3w_ctx_scene_stack(ctx, stress + variant % 2); break;
        case 1: b3w_ctx_scene_domino(ctx, stress); break;
        case 2: b3w_ctx_scene_skyscraper(ctx, stress + variant % 2); break;
        case 3: b3w_ctx_scene_bridge(ctx, stress); break;
        case 4: b3w_ctx_scene_material(ctx, stress); break;
        case 5: b3w_ctx_scene_rain(ctx, stress); break;
        case 6:
            b3w_ctx_scene_stack(ctx, stress);
            b3w_ctx_launch_projectile(ctx, -22.0f, 4.0f + (float)stress, 0.0f, 24.0f + (float)stress * 2.0f, 2.0f, 0.0f, 0.9f);
            if (variant % 3 == 1) b3w_ctx_explode(ctx, 0.0f, 2.4f, 0.0f, 14.0f, 7.0f);
            break;
        case 7:
            b3w_ctx_scene_material(ctx, stress);
            for (int i = 0; i < 4 + stress; ++i)
            {
                int body = b3w_ctx_add_box_ex(ctx, b3_dynamicBody, -18.0f - (float)i * 2.4f, 0.65f, b3w_ctx_rand_range(ctx, -5.0f, 5.0f), 1.0f, 0.45f, 0.65f, 0xF97316u, 5.0f, 0.72f, 0.05f);
                if (body >= 0) b3Body_ApplyLinearImpulseToCenter(ctx->bodies[body].id, (b3Vec3){ 8.0f + (float)stress, 0.0f, 0.0f }, true);
            }
            break;
        case 8:
            b3w_ctx_scene_material(ctx, stress);
            b3w_ctx_spawn_rain(ctx, 40 + stress * 45 + variant * 8, 8.0f, 12.0f);
            break;
        case 9:
            b3w_ctx_scene_skyscraper(ctx, stress);
            b3w_ctx_spawn_rain(ctx, 35 + stress * 35, 9.0f, 14.0f);
            break;
        case 10:
            b3w_ctx_scene_bridge(ctx, stress);
            b3w_ctx_spawn_rain(ctx, 65 + stress * 30, 14.0f, 10.0f);
            if (variant % 2 == 1) b3w_ctx_explode(ctx, 0.0f, 2.5f, 0.0f, 9.0f, 8.0f);
            break;
        case 11:
            b3w_ctx_scene_skyscraper(ctx, stress);
            if (variant % 3 == 0) b3w_ctx_launch_projectile(ctx, -23.0f, 5.5f, 0.0f, 24.0f, 1.0f, 0.0f, 1.0f);
            break;
        case 12:
            b3w_ctx_scene_cloth_stage(ctx, stress, variant);
            break;
        case 13:
            b3w_ctx_scene_rope_stage(ctx, stress, variant);
            break;
        case 14:
            b3w_ctx_scene_water_stage(ctx, stress, variant);
            break;
        case 15:
            b3w_ctx_scene_fracture_stage(ctx, stress, variant);
            break;
    }

    // Cinematic and Maximum catalog modes receive authored native set dressing.
    // It is intentionally made from ordinary Box3D bodies so the same transform
    // stream is rendered by the WebGPU instancing path without special cases.
    if (mode >= 3)
    {
        b3w_ctx_add_aaa_set_dressing(ctx, family, stress, variant);
    }
    if (mode == 4)
    {
        b3w_ctx_add_signature_set_dressing(ctx, family, stress, variant);
    }

    return ctx->bodyCount;
}

static int b3w_ctx_create_demo(B3WContext* ctx, int columns, int rows, int layers)
{
    b3w_ctx_create_world(ctx, 0xC0FFEEu);
    int stress = b3w_clamp_int((columns + rows + layers) / 16, 1, 5);
    b3w_ctx_scene_stack(ctx, stress);
    return ctx->bodyCount;
}

static void b3w_ctx_destroy(B3WContext* ctx)
{
    b3w_ctx_destroy_world(ctx);
}

static int b3w_ctx_body_count(B3WContext* ctx)
{
    return ctx->bodyCount;
}

static int b3w_ctx_dynamic_count(B3WContext* ctx)
{
    return ctx->dynamicCount;
}

static uintptr_t b3w_ctx_matrices_ptr(B3WContext* ctx)
{
    return (uintptr_t)ctx->matrices;
}

static uintptr_t b3w_ctx_colors_ptr(B3WContext* ctx)
{
    return (uintptr_t)ctx->colors;
}

B3W_EXPORT int b3w_max_bodies(void)
{
    return B3W_MAX_BODIES;
}

static uint32_t b3w_ctx_transform_version(B3WContext* ctx)
{
    return ctx->transformVersion;
}

static uint32_t b3w_ctx_color_version(B3WContext* ctx)
{
    return ctx->colorVersion;
}

static int b3w_ctx_awake_count(B3WContext* ctx)
{
    return B3_IS_NON_NULL(ctx->world) ? b3World_GetAwakeBodyCount(ctx->world) : 0;
}

static void b3w_ctx_sync_transforms(B3WContext* ctx)
{
    // The compact index wins when static dressing dominates, but its extra
    // load/indirection is measurable when almost every body is dynamic. Use a
    // sequential scan for dense-dynamic worlds and retain the compact stream
    // for the static-heavy case it was designed to accelerate.
    if (ctx->dynamicCount * 4 >= ctx->bodyCount * 3)
    {
        for (int i = 0; i < ctx->bodyCount; ++i)
        {
            if (ctx->bodies[i].dynamic == 0) continue;
            b3WorldTransform xf = b3Body_GetTransform(ctx->bodies[i].id);
            b3w_ctx_write_model_matrix(ctx, i, xf.p, xf.q, ctx->bodies[i].hx, ctx->bodies[i].hy, ctx->bodies[i].hz);
        }
    }
    else
    {
        for (int dynamicIndex = 0; dynamicIndex < ctx->dynamicCount; ++dynamicIndex)
        {
            const int i = ctx->dynamicIndices[dynamicIndex];
            b3WorldTransform xf = b3Body_GetTransform(ctx->bodies[i].id);
            b3w_ctx_write_model_matrix(ctx, i, xf.p, xf.q, ctx->bodies[i].hx, ctx->bodies[i].hy, ctx->bodies[i].hz);
        }
    }
    ctx->hashDirty = 1;
    ctx->transformVersion += 1u;
}

static void b3w_ctx_after_step(B3WContext* ctx);

static void b3w_ctx_step(B3WContext* ctx, float dt, int subSteps)
{
    // Joint events describe one step only.
    ctx->jointRecordCount = 0;
    if (B3_IS_NULL(ctx->world) || !isfinite(dt) || dt <= 0.0f)
    {
        return;
    }

    subSteps = b3w_clamp_int(subSteps, 1, 16);
    const int awakeBefore = b3World_GetAwakeBodyCount(ctx->world);
    // This bridge creates no kinematic bodies and every exported mutation uses
    // wake=true. With zero awake bodies, Box3D has no state that can advance;
    // skip the solver as well as the transform scan. A later impulse or newly
    // created dynamic body wakes the world before the next call reaches here.
    if (awakeBefore == 0)
    {
        return;
    }
    b3World_Step(ctx->world, dt, subSteps);
    b3w_ctx_after_step(ctx);

    // If the step began awake, perform the same full synchronization used by
    // the baseline. This deliberately includes the step where the last bodies
    // fall asleep, so their terminal pose is captured exactly. Once a step
    // begins with zero awake bodies, no transform can change and both the scan
    // and transform revision are safely skipped.
    if (awakeBefore != 0)
    {
        b3w_ctx_sync_transforms(ctx);
    }
}

static void b3w_ctx_apply_impulse(B3WContext* ctx, int index, float ix, float iy, float iz)
{
    if (index < 0 || index >= ctx->bodyCount || ctx->bodies[index].dynamic == 0)
    {
        return;
    }

    b3Body_ApplyLinearImpulseToCenter(ctx->bodies[index].id, (b3Vec3){ ix, iy, iz }, true);
}

static void b3w_ctx_kick_stack(B3WContext* ctx, float strength)
{
    if (strength <= 0.0f) strength = 6.0f;
    for (int i = 0; i < ctx->bodyCount; ++i)
    {
        if (ctx->bodies[i].dynamic == 0) continue;
        // The synchronized stream already contains the authoritative body
        // translation. Kick needs only the X sign, so avoid one native body
        // lookup per dynamic body without changing RNG or impulse order.
        float side = ctx->matrices[i * 16 + 12] >= 0.0f ? 1.0f : -1.0f;
        float lift = 0.35f + 0.7f * b3w_ctx_rand01(ctx);
        float spin = b3w_ctx_rand_range(ctx, -1.0f, 1.0f);
        b3Body_ApplyLinearImpulseToCenter(ctx->bodies[i].id, (b3Vec3){ side * strength * (0.25f + 0.75f * b3w_ctx_rand01(ctx)), strength * lift, spin * strength * 0.22f }, true);
    }
}

static void b3w_ctx_explode(B3WContext* ctx, float cx, float cy, float cz, float strength, float radius)
{
    if (radius <= 0.1f) radius = 8.0f;
    const float radiusSquared = radius * radius;
    for (int i = 0; i < ctx->bodyCount; ++i)
    {
        if (ctx->bodies[i].dynamic == 0) continue;
        // The transform stream is synchronized after every step and body
        // creation. Use its translation for a conservative exact miss test so
        // distant bodies avoid both a Box3D API lookup and sqrtf. Near the
        // boundary, retain the original native position and distance path.
        const float* m = ctx->matrices + i * 16;
        const float cachedDx = m[12] - cx;
        const float cachedDy = m[13] - cy;
        const float cachedDz = m[14] - cz;
        const float cachedDistanceSquared = cachedDx * cachedDx + cachedDy * cachedDy + cachedDz * cachedDz;
        if (cachedDistanceSquared > radiusSquared * 1.000001f) continue;
        b3Pos p = b3Body_GetPosition(ctx->bodies[i].id);
        float dx = (float)p.x - cx;
        float dy = (float)p.y - cy;
        float dz = (float)p.z - cz;
        float dist = sqrtf(dx * dx + dy * dy + dz * dz);
        if (dist > radius) continue;
        float invDist = dist > 0.001f ? 1.0f / dist : 1.0f;
        float falloff = 1.0f - dist / radius;
        b3Vec3 impulse = { dx * invDist * strength * falloff, (dy * invDist + 0.55f) * strength * falloff, dz * invDist * strength * falloff };
        b3Body_ApplyLinearImpulseToCenter(ctx->bodies[i].id, impulse, true);
    }
}

static int b3w_ctx_launch_projectile(B3WContext* ctx, float x, float y, float z, float vx, float vy, float vz, float size)
{
    if (B3_IS_NULL(ctx->world)) return -1;
    if (size <= 0.05f) size = 0.8f;
    int index = b3w_ctx_add_box_ex(ctx, b3_dynamicBody, x, y, z, size, size, size, 0xFFD166u, 8.0f, 0.45f, 0.12f);
    if (index >= 0)
    {
        b3Body_ApplyLinearImpulseToCenter(ctx->bodies[index].id, (b3Vec3){ vx, vy, vz }, true);
    }
    return index;
}

static uint32_t b3w_ctx_replay_hash(B3WContext* ctx)
{
    if (ctx->hashDirty != 0)
    {
        uint32_t hash = 2166136261u;
        for (int i = 0; i < ctx->bodyCount; ++i)
        {
            const float* m = ctx->matrices + i * 16;
            for (int k = 0; k < 16; ++k)
            {
                int32_t q = (int32_t)(m[k] * 1000.0f);
                hash ^= (uint32_t)(q & 0xff);
                hash *= 16777619u;
                hash ^= (uint32_t)((q >> 8) & 0xff);
                hash *= 16777619u;
                hash ^= (uint32_t)((q >> 16) & 0xff);
                hash *= 16777619u;
                hash ^= (uint32_t)((q >> 24) & 0xff);
                hash *= 16777619u;
            }
        }
        ctx->hash = hash;
        ctx->hashDirty = 0;
    }
    return ctx->hash;
}

// Original ABI: each call is explicitly routed to the compatibility context.

B3W_EXPORT int b3w_spawn_rain(int count, float spread, float height)
{
    return b3w_ctx_spawn_rain(&g_defaultContext, count, spread, height);
}

B3W_EXPORT int b3w_create_scene(int sceneId, int stressScale, uint32_t seed)
{
    return b3w_ctx_create_scene(&g_defaultContext, sceneId, stressScale, seed);
}

B3W_EXPORT int b3w_create_demo(int columns, int rows, int layers)
{
    return b3w_ctx_create_demo(&g_defaultContext, columns, rows, layers);
}

B3W_EXPORT void b3w_destroy(void)
{
    b3w_ctx_destroy(&g_defaultContext);
}

B3W_EXPORT int b3w_body_count(void)
{
    return b3w_ctx_body_count(&g_defaultContext);
}

B3W_EXPORT int b3w_dynamic_count(void)
{
    return b3w_ctx_dynamic_count(&g_defaultContext);
}

B3W_EXPORT uintptr_t b3w_matrices_ptr(void)
{
    return b3w_ctx_matrices_ptr(&g_defaultContext);
}

B3W_EXPORT uintptr_t b3w_colors_ptr(void)
{
    return b3w_ctx_colors_ptr(&g_defaultContext);
}

B3W_EXPORT uint32_t b3w_transform_version(void)
{
    return b3w_ctx_transform_version(&g_defaultContext);
}

B3W_EXPORT uint32_t b3w_color_version(void)
{
    return b3w_ctx_color_version(&g_defaultContext);
}

B3W_EXPORT int b3w_awake_count(void)
{
    return b3w_ctx_awake_count(&g_defaultContext);
}

B3W_EXPORT void b3w_sync_transforms(void)
{
    b3w_ctx_sync_transforms(&g_defaultContext);
}

B3W_EXPORT void b3w_step(float dt, int subSteps)
{
    b3w_ctx_step(&g_defaultContext, dt, subSteps);
}

B3W_EXPORT void b3w_apply_impulse(int index, float ix, float iy, float iz)
{
    b3w_ctx_apply_impulse(&g_defaultContext, index, ix, iy, iz);
}

B3W_EXPORT void b3w_kick_stack(float strength)
{
    b3w_ctx_kick_stack(&g_defaultContext, strength);
}

B3W_EXPORT void b3w_explode(float cx, float cy, float cz, float strength, float radius)
{
    b3w_ctx_explode(&g_defaultContext, cx, cy, cz, strength, radius);
}

B3W_EXPORT int b3w_launch_projectile(float x, float y, float z, float vx, float vy, float vz, float size)
{
    return b3w_ctx_launch_projectile(&g_defaultContext, x, y, z, vx, vy, vz, size);
}

B3W_EXPORT uint32_t b3w_replay_hash(void)
{
    return b3w_ctx_replay_hash(&g_defaultContext);
}

// Explicit-world ABI: a generation occupies the upper 27 bits and slot+1 the
// lower 5 bits. Exhausted generations retire permanently rather than aliasing.
B3W_EXPORT uint32_t b3w_world_create(void)
{
    g_contextCreateError = 1;
    for (uint32_t i = 0; i < B3W_MAX_CONTEXTS; ++i)
    {
        B3WContextSlot* slot = &g_contextSlots[i];
        if (slot->context != NULL || slot->retired != 0) continue;
        B3WContext* ctx = (B3WContext*)calloc(1u, sizeof(B3WContext));
        if (ctx == NULL) { g_contextCreateError = 2; return 0u; }
        if (b3w_ctx_reserve(ctx, B3W_MAX_BODIES) < 0) { free(ctx); g_contextCreateError = 2; return 0u; }
        ctx->freeSlot = -1;
        ctx->rng = 0xC0FFEEu;
        ctx->hashDirty = 1;
        ctx->transformVersion = 1u;
        ctx->colorVersion = 1u;
        ctx->cachedHullLast = -1;
        if (slot->generation == 0u) slot->generation = 1u;
        slot->context = ctx;
        g_contextCreateError = 0;
        return (slot->generation << B3W_CONTEXT_SLOT_BITS) | (i + 1u);
    }
    return 0u;
}

B3W_EXPORT int b3w_world_destroy(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_destroy(ctx);
    free(ctx->bufferBlock);
    free(ctx->queries.block);
    free(ctx->kinds);
    free(ctx->events);
    free(ctx->geometry);
    free(ctx->massOverrides);
    free(ctx->checkpoint);
    free(ctx->jointFlags);
    free(ctx->jointRecords);
    free(ctx->debugVertices);
    free(ctx);
    B3WContextSlot* slot = &g_contextSlots[(handle & B3W_CONTEXT_SLOT_MASK) - 1u];
    slot->context = NULL;
    if (slot->generation == B3W_CONTEXT_MAX_GENERATION) slot->retired = 1;
    else slot->generation += 1u;
    return 1;
}

B3W_EXPORT int b3w_world_valid(uint32_t handle) { return b3w_lookup_context(handle) != NULL; }
B3W_EXPORT int b3w_world_query_reserve(uint32_t handle, int inputs, int hits)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? b3w_ctx_query_reserve(ctx, inputs, hits) : -1;
}
B3W_EXPORT uintptr_t b3w_world_query_inputs_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->queries.inputs : 0u;
}
B3W_EXPORT uintptr_t b3w_world_query_status_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->queries.statuses : 0u;
}
B3W_EXPORT uintptr_t b3w_world_query_hits_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->queries.hits : 0u;
}
B3W_EXPORT uint32_t b3w_world_query_version(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? ctx->queries.version : 0u;
}
B3W_EXPORT size_t b3w_world_query_storage_bytes(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? b3w_query_bytes(ctx->queries.inputCapacity,ctx->queries.hitCapacity) : 0u;
}
B3W_EXPORT int b3w_world_query_batch(uint32_t handle, int count, uint32_t version)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? b3w_ctx_query_batch(ctx, count, version) : -1;
}
B3W_EXPORT int b3w_world_api_version(void) { return 1; }
B3W_EXPORT int b3w_world_capacity(void) { return B3W_MAX_CONTEXTS; }
B3W_EXPORT int b3w_world_last_create_error(void) { return g_contextCreateError; }
B3W_EXPORT int b3w_world_max_bodies(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? ctx->capacity : -1;
}

// Return capacity on success, -1 for a stale handle, -2 for an invalid request,
// or -3 for buffer allocation failure. No body is inserted by this operation.
B3W_EXPORT int b3w_world_reserve(uint32_t handle, int requested)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? b3w_ctx_reserve(ctx, requested) : -1;
}

B3W_EXPORT uint32_t b3w_world_buffer_version(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? ctx->bufferVersion : 0u;
}

B3W_EXPORT size_t b3w_world_storage_bytes(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? b3w_capacity_bytes(ctx->capacity) : 0u;
}

// Public SDK contact-pair counter (including non-touching broad-phase pairs).
// This is diagnostic state only and never changes stepping or body storage.
B3W_EXPORT int b3w_world_contact_count(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return B3_IS_NULL(ctx->world) ? 0 : b3World_GetCounters(ctx->world).contactCount;
}
B3W_EXPORT int b3w_world_spawn_rain(uint32_t handle, int count, float spread, float height)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_spawn_rain(ctx, count, spread, height);
}

B3W_EXPORT int b3w_world_create_scene(uint32_t handle, int sceneId, int stressScale, uint32_t seed)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_create_scene(ctx, sceneId, stressScale, seed);
}

B3W_EXPORT int b3w_world_create_demo(uint32_t handle, int columns, int rows, int layers)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_create_demo(ctx, columns, rows, layers);
}

B3W_EXPORT int b3w_world_clear(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_destroy(ctx);
    return 1;
}

B3W_EXPORT int b3w_world_body_count(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_body_count(ctx);
}

B3W_EXPORT int b3w_world_dynamic_count(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_dynamic_count(ctx);
}

B3W_EXPORT uintptr_t b3w_world_matrices_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    return b3w_ctx_matrices_ptr(ctx);
}

B3W_EXPORT uintptr_t b3w_world_colors_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    return b3w_ctx_colors_ptr(ctx);
}

B3W_EXPORT uint32_t b3w_world_transform_version(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    return b3w_ctx_transform_version(ctx);
}

B3W_EXPORT uint32_t b3w_world_color_version(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    return b3w_ctx_color_version(ctx);
}

B3W_EXPORT int b3w_world_awake_count(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_awake_count(ctx);
}

B3W_EXPORT int b3w_world_sync_transforms(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_sync_transforms(ctx);
    return 1;
}

B3W_EXPORT int b3w_world_step(uint32_t handle, float dt, int subSteps)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_step(ctx, dt, subSteps);
    return 1;
}

B3W_EXPORT int b3w_world_apply_impulse(uint32_t handle, int index, float ix, float iy, float iz)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_apply_impulse(ctx, index, ix, iy, iz);
    return 1;
}

B3W_EXPORT int b3w_world_kick_stack(uint32_t handle, float strength)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_kick_stack(ctx, strength);
    return 1;
}

B3W_EXPORT int b3w_world_explode(uint32_t handle, float cx, float cy, float cz, float strength, float radius)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    b3w_ctx_explode(ctx, cx, cy, cz, strength, radius);
    return 1;
}

B3W_EXPORT int b3w_world_launch_projectile(uint32_t handle, float x, float y, float z, float vx, float vy, float vz, float size)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    return b3w_ctx_launch_projectile(ctx, x, y, z, vx, vy, vz, size);
}

B3W_EXPORT uint32_t b3w_world_replay_hash(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return 0;
    return b3w_ctx_replay_hash(ctx);
}

// Additive body-lifecycle extension. Handles are uint64/BigInt values scoped to
// the supplied world handle; zero is invalid. Old dense-index exports remain.
B3W_EXPORT uint64_t b3w_world_body_handle(uint32_t worldHandle, int index)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    return ctx != NULL ? b3w_ctx_body_handle(ctx, index) : 0u;
}
B3W_EXPORT int b3w_world_body_index(uint32_t worldHandle, uint64_t bodyHandle)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    return ctx != NULL ? b3w_ctx_body_index(ctx, bodyHandle) : -1;
}
B3W_EXPORT int b3w_world_destroy_body(uint32_t worldHandle, uint64_t bodyHandle)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    return ctx != NULL ? b3w_ctx_destroy_body(ctx, bodyHandle) : -1;
}
B3W_EXPORT int b3w_world_apply_body_impulse(uint32_t worldHandle, uint64_t bodyHandle, float x, float y, float z)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    if (ctx == NULL) return -1;
    int index = b3w_ctx_body_index(ctx, bodyHandle);
    if (index < 0) return 0;
    b3w_ctx_apply_impulse(ctx, index, x, y, z);
    return 1;
}
B3W_EXPORT uint64_t b3w_world_launch_projectile_handle(uint32_t worldHandle, float x, float y, float z, float vx, float vy, float vz, float size)
{
    B3WContext* ctx = b3w_lookup_context(worldHandle);
    if (ctx == NULL) return 0u;
    int index = b3w_ctx_launch_projectile(ctx, x, y, z, vx, vy, vz, size);
    return b3w_ctx_body_handle(ctx, index);
}

// ---------------------------------------------------------------------------
// General rigid-body API (optional extension; the world API version stays 1).
//
// The scene recipes above only ever create boxes. These exports open the rest
// of Box3D to callers: empty worlds, gravity, spheres and capsules, static /
// kinematic / dynamic bodies, pose and velocity access, forces, collision
// filters, joints with limits, motors and springs, and contact / sensor events.
// Descriptors are fixed 128-byte little-endian layouts that the caller writes
// into WASM memory. Nothing here runs for a world that does not call it.

typedef struct B3WBodyDesc
{
    uint32_t kind; // 0 box, 1 sphere, 2 capsule (axis along local Y); ignored by the hull, mesh, height-field and compound calls
    uint32_t type; // 0 static, 1 kinematic, 2 dynamic
    float position[3];
    float rotation[4]; // x, y, z, w
    float linearVelocity[3];
    float angularVelocity[3];
    float size[3]; // box half extents; sphere radius in [0]; capsule radius in [0], half length in [1]
    float density, friction, restitution;
    uint32_t color; // 0xRRGGBB, material tag in the top byte as in the scene recipes
    uint32_t flags; // 1 bullet, 2 sensor, 4 hit events, 8 never sleeps, 16 lock rotation
    float linearDamping, angularDamping, gravityScale;
    uint64_t categoryBits, maskBits; // both zero selects the Box3D defaults
    int32_t groupIndex;
    uint32_t reserved;
} B3WBodyDesc;

typedef struct B3WJointDesc
{
    uint32_t type; // 0 weld, 1 revolute, 2 spherical, 3 prismatic, 4 distance, 5 wheel, 6 motor, 7 parallel, 8 filter
    uint32_t flags; // 1 collide connected, 2 limit, 4 motor, 8 spring, 16 cone limit (spherical), 32 breaks at its thresholds
    uint64_t bodyA, bodyB; // 0 attaches to the fixed world anchor
    float framePositionA[3], frameRotationA[4];
    float framePositionB[3], frameRotationB[4];
    float lower, upper; // angle (rad), translation or length limits
    float motorSpeed, maxMotor; // rad/s or m/s; torque or force
    float hertz, dampingRatio; // spring, or weld softness
    float target; // spring target angle / translation, or distance length
    float coneAngle; // spherical cone limit
    float constraintHertz, constraintDampingRatio; // how stiffly the joint holds its bodies together; 0 hertz keeps Box3D's default (60 Hz, ratio 2)
    float forceThreshold, torqueThreshold; // joint events (and breaking) above this constraint force (N) or torque (N m); 0 means none
} B3WJointDesc;

typedef struct B3WEvent
{
    uint32_t kind; // 0 contact begin, 1 contact end, 2 hit, 3 sensor begin, 4 sensor end, 5 joint over its threshold, 6 joint broke
    uint32_t reserved; // joint events: low 32 bits of the joint handle
    uint64_t bodyA, bodyB; // for sensor events A is the sensor, B the visitor; for joint events the joint's bodies (0 for the world anchor)
    float point[3]; // joint events: the constraint force (N)
    float normal[3]; // joint events: the constraint torque (N m)
    float speed; // approach speed for hits
    uint32_t padding; // joint events: high 32 bits of the joint handle
} B3WEvent;

// One child shape of a compound body (kind 6), in the body's own frame.
typedef struct B3WShapeDesc
{
    uint32_t kind; // 0 box, 1 sphere, 2 capsule (axis along the shape's local Y), 3 convex hull
    uint32_t flags; // reserved, zero
    float position[3]; // shape origin in the body frame
    float rotation[4]; // x, y, z, w
    float size[3]; // as B3WBodyDesc.size
    float density, friction, restitution;
    int32_t pointOffset; // hull: index of its first point in the shared point array
    int32_t pointCount; // hull: 4..4096 points, in the shape's own frame
    uint32_t reserved[3];
} B3WShapeDesc;

#define B3W_COMPOUND_LIMIT 64

_Static_assert(sizeof(B3WBodyDesc) == 128, "Body descriptor ABI must be 128 bytes");
_Static_assert(sizeof(B3WShapeDesc) == 80, "Shape descriptor ABI must be 80 bytes");
_Static_assert(sizeof(B3WJointDesc) == 128, "Joint descriptor ABI must be 128 bytes");
_Static_assert(sizeof(B3WEvent) == 56, "Event ABI must be 56 bytes");

#define B3W_EVENT_LIMIT 65536

static int b3w_finite3(const float* v) { return isfinite(v[0]) && isfinite(v[1]) && isfinite(v[2]); }

// Returns a unit quaternion, or identity when the input is zero or not finite.
static b3Quat b3w_quat(const float* q)
{
    float n = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
    if (!isfinite(n) || n < 1.0e-12f) return (b3Quat){ { 0.0f, 0.0f, 0.0f }, 1.0f };
    float inv = 1.0f / sqrtf(n);
    return (b3Quat){ { q[0] * inv, q[1] * inv, q[2] * inv }, q[3] * inv };
}

static b3Vec3 b3w_rotate(b3Quat q, b3Vec3 v)
{
    // v + 2 s (u x v) + 2 u x (u x v)
    b3Vec3 u = q.v;
    b3Vec3 t = { 2.0f * (u.y * v.z - u.z * v.y), 2.0f * (u.z * v.x - u.x * v.z), 2.0f * (u.x * v.y - u.y * v.x) };
    return (b3Vec3){ v.x + q.s * t.x + (u.y * t.z - u.z * t.y), v.y + q.s * t.y + (u.z * t.x - u.x * t.z), v.z + q.s * t.z + (u.x * t.y - u.y * t.x) };
}

static void b3w_ctx_set_moving(B3WContext* ctx, int index, int moving)
{
    B3WBody* body = ctx->bodies + index;
    if ((body->dynamic != 0) == (moving != 0)) return;
    if (moving != 0)
    {
        body->dynamic = 1;
        body->dynamicPosition = ctx->dynamicCount;
        ctx->dynamicIndices[ctx->dynamicCount++] = index;
    }
    else
    {
        int lastDynamic = ctx->dynamicIndices[--ctx->dynamicCount];
        ctx->dynamicIndices[body->dynamicPosition] = lastDynamic;
        ctx->bodies[lastDynamic].dynamicPosition = body->dynamicPosition;
        ctx->dynamicIndices[ctx->dynamicCount] = 0;
        body->dynamic = 0;
        body->dynamicPosition = -1;
    }
}

static void b3w_ctx_refresh_row(B3WContext* ctx, int index)
{
    const B3WBody* body = ctx->bodies + index;
    b3WorldTransform xf = b3Body_GetTransform(body->id);
    b3w_ctx_write_model_matrix(ctx, index, xf.p, xf.q, body->hx, body->hy, body->hz);
    ctx->transformVersion += 1u;
    ctx->hashDirty = 1;
}

// Replaces the world with an empty one. flags bit 0 adds the 88 m ground slab
// that the scene recipes use.
B3W_EXPORT int b3w_world_reset(uint32_t handle, uint32_t seed, uint32_t flags, float gx, float gy, float gz)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    if (!isfinite(gx) || !isfinite(gy) || !isfinite(gz)) return -2;
    b3w_ctx_destroy_world(ctx);
    ctx->rng = seed == 0u ? 0xC0FFEEu : seed;
    b3WorldDef worldDef = b3DefaultWorldDef();
    worldDef.gravity = (b3Vec3){ gx, gy, gz };
    worldDef.workerCount = 1;
    worldDef.enableSleep = true;
    worldDef.enableContinuous = true;
    ctx->world = b3CreateWorld(&worldDef);
    if ((flags & 1u) != 0u) b3w_ctx_add_box_ex(ctx, b3_staticBody, 0.0f, -1.0f, 0.0f, 44.0f, 1.0f, 44.0f, 0x162033u, 0.0f, 0.86f, 0.02f);
    return 1;
}

B3W_EXPORT int b3w_world_set_gravity(uint32_t handle, float x, float y, float z)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world)) return -1;
    if (!isfinite(x) || !isfinite(y) || !isfinite(z)) return -2;
    b3World_SetGravity(ctx->world, (b3Vec3){ x, y, z });
    // Sleeping bodies must feel the new field.
    for (int i = 0; i < ctx->dynamicCount; ++i) b3Body_SetAwake(ctx->bodies[ctx->dynamicIndices[i]].id, true);
    return 1;
}

B3W_EXPORT int b3w_world_get_gravity(uint32_t handle, float* out3)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || out3 == NULL) return -1;
    b3Vec3 g = b3World_GetGravity(ctx->world);
    out3[0] = g.x; out3[1] = g.y; out3[2] = g.z;
    return 1;
}

// Kinds 3 (convex hull), 4 (triangle mesh) and 5 (height field) take their
// geometry from the caller; `geometry` is then a b3HullData, b3MeshData or
// b3HeightFieldData. Their render rows are unscaled: the caller draws its own geometry.
typedef struct B3WGeometry { int slot; uint32_t kind; void* data; } B3WGeometry;
// Kind 6 (compound): `geometry` is a B3WCompound, whose hulls are already built in the body frame.
typedef struct B3WCompound { const B3WShapeDesc* shapes; int count; b3HullData** hulls; } B3WCompound;

static void b3w_ctx_free_geometry(B3WContext* ctx, int slot)
{
    for (int i = 0; i < ctx->geometryCount;)
    {
        B3WGeometry* entry = ctx->geometry + i;
        if (slot >= 0 && entry->slot != slot) { ++i; continue; }
        if (entry->kind == 4u) b3DestroyMesh((b3MeshData*)entry->data);
        else b3DestroyHeightField((b3HeightFieldData*)entry->data);
        *entry = ctx->geometry[--ctx->geometryCount];
    }
}

static uint64_t b3w_ctx_create_general(B3WContext* ctx, const B3WBodyDesc* desc, uint32_t kind, const void* geometry)
{
    if (desc->type > 2u) return 0u;
    if (!b3w_finite3(desc->position) || !b3w_finite3(desc->linearVelocity) || !b3w_finite3(desc->angularVelocity)) return 0u;
    float hx = desc->size[0], hy = desc->size[1], hz = desc->size[2];
    if (kind >= 3u) { hx = 1.0f; hy = 1.0f; hz = 1.0f; }
    if (kind == 1u) { hy = hx; hz = hx; }
    if (kind == 2u) { hz = hx; if (!(hy >= 0.0025f)) return 0u; } // Box3D's minimum capsule length is 5 mm
    // Every extent scales a render-matrix column, so none may be zero.
    if (!(hx > 0.0f) || !(hy > 0.0f) || !(hz > 0.0f) || !isfinite(hx) || !isfinite(hy) || !isfinite(hz)) return 0u;
    if (!(desc->density >= 0.0f) || !(desc->friction >= 0.0f) || !(desc->restitution >= 0.0f)) return 0u;
    if (!isfinite(desc->density) || !isfinite(desc->friction) || !isfinite(desc->restitution)) return 0u;
    if (ctx->bodyCount >= ctx->capacity || (ctx->freeSlot < 0 && ctx->slotsUsed >= ctx->capacity)) return 0u;
    if (kind != 0u && ctx->kinds == NULL)
    {
        ctx->kinds = (uint8_t*)calloc((size_t)ctx->capacity, 1u);
        if (ctx->kinds == NULL) return 0u;
    }
    if ((kind == 4u || kind == 5u) && ctx->geometryCount >= ctx->geometryCapacity)
    {
        int capacity = ctx->geometryCapacity == 0 ? 16 : ctx->geometryCapacity * 2;
        B3WGeometry* list = (B3WGeometry*)realloc(ctx->geometry, (size_t)capacity * sizeof(B3WGeometry));
        if (list == NULL) return 0u;
        ctx->geometry = list;
        ctx->geometryCapacity = capacity;
    }

    const b3BodyType type = desc->type == 0u ? b3_staticBody : desc->type == 1u ? b3_kinematicBody : b3_dynamicBody;
    b3BodyDef bodyDef = b3DefaultBodyDef();
    bodyDef.type = type;
    bodyDef.position = (b3Pos){ desc->position[0], desc->position[1], desc->position[2] };
    bodyDef.rotation = b3w_quat(desc->rotation);
    bodyDef.linearVelocity = (b3Vec3){ desc->linearVelocity[0], desc->linearVelocity[1], desc->linearVelocity[2] };
    bodyDef.angularVelocity = (b3Vec3){ desc->angularVelocity[0], desc->angularVelocity[1], desc->angularVelocity[2] };
    if (isfinite(desc->linearDamping) && desc->linearDamping > 0.0f) bodyDef.linearDamping = desc->linearDamping;
    if (isfinite(desc->angularDamping) && desc->angularDamping > 0.0f) bodyDef.angularDamping = desc->angularDamping;
    // The descriptor is zero-filled by callers, so zero keeps normal gravity;
    // b3w_world_set_body_gravity_scale can set a true zero afterwards.
    if (isfinite(desc->gravityScale) && desc->gravityScale != 0.0f) bodyDef.gravityScale = desc->gravityScale;
    bodyDef.isBullet = (desc->flags & 1u) != 0u;
    if ((desc->flags & 8u) != 0u) bodyDef.enableSleep = false;
    if ((desc->flags & 16u) != 0u)
    {
        bodyDef.motionLocks.angularX = true;
        bodyDef.motionLocks.angularY = true;
        bodyDef.motionLocks.angularZ = true;
    }
    b3BodyId body = b3CreateBody(ctx->world, &bodyDef);

    b3ShapeDef shapeDef = b3DefaultShapeDef();
    shapeDef.density = desc->density;
    shapeDef.baseMaterial.friction = desc->friction;
    shapeDef.baseMaterial.restitution = desc->restitution;
    shapeDef.baseMaterial.customColor = desc->color;
    shapeDef.isSensor = (desc->flags & 2u) != 0u;
    shapeDef.enableSensorEvents = true;
    shapeDef.enableContactEvents = true; // off by default upstream; one flagged shape per pair is enough
    shapeDef.enableHitEvents = (desc->flags & 4u) != 0u;
    if (desc->categoryBits != 0u || desc->maskBits != 0u)
    {
        shapeDef.filter.categoryBits = desc->categoryBits;
        shapeDef.filter.maskBits = desc->maskBits;
    }
    shapeDef.filter.groupIndex = desc->groupIndex;
    if (kind == 6u)
    {
        const B3WCompound* compound = (const B3WCompound*)geometry;
        for (int i = 0; i < compound->count; ++i)
        {
            const B3WShapeDesc* child = compound->shapes + i;
            b3Transform xf = { { child->position[0], child->position[1], child->position[2] }, b3w_quat(child->rotation) };
            shapeDef.density = child->density;
            shapeDef.baseMaterial.friction = child->friction;
            shapeDef.baseMaterial.restitution = child->restitution;
            if (child->kind == 0u)
            {
                b3BoxHull box = b3MakeTransformedBoxHull(child->size[0], child->size[1], child->size[2], xf);
                b3CreateHullShape(body, &shapeDef, &box.base);
            }
            else if (child->kind == 1u)
            {
                b3Sphere sphere = { xf.p, child->size[0] };
                b3CreateSphereShape(body, &shapeDef, &sphere);
            }
            else if (child->kind == 2u)
            {
                b3Vec3 half = b3w_rotate(xf.q, (b3Vec3){ 0.0f, child->size[1], 0.0f });
                b3Capsule capsule = { { xf.p.x - half.x, xf.p.y - half.y, xf.p.z - half.z }, { xf.p.x + half.x, xf.p.y + half.y, xf.p.z + half.z }, child->size[0] };
                b3CreateCapsuleShape(body, &shapeDef, &capsule);
            }
            else b3CreateHullShape(body, &shapeDef, compound->hulls[i]);
        }
    }
    else if (kind == 0u)
    {
        const b3BoxHull* hull = b3w_ctx_get_box_hull(ctx, hx, hy, hz);
        b3CreateHullShape(body, &shapeDef, &hull->base);
    }
    else if (kind == 1u)
    {
        b3Sphere sphere = { { 0.0f, 0.0f, 0.0f }, hx };
        b3CreateSphereShape(body, &shapeDef, &sphere);
    }
    else if (kind == 2u)
    {
        b3Capsule capsule = { { 0.0f, -hy, 0.0f }, { 0.0f, hy, 0.0f }, hx };
        b3CreateCapsuleShape(body, &shapeDef, &capsule);
    }
    else if (kind == 3u) b3CreateHullShape(body, &shapeDef, (const b3HullData*)geometry);
    else if (kind == 4u) b3CreateMeshShape(body, &shapeDef, (const b3MeshData*)geometry, (b3Vec3){ 1.0f, 1.0f, 1.0f });
    else b3CreateHeightFieldShape(body, &shapeDef, (const b3HeightFieldData*)geometry);

    int index = ctx->bodyCount++;
    B3WBody* row = ctx->bodies + index;
    row->id = body;
    row->hx = hx; row->hy = hy; row->hz = hz;
    row->color = desc->color;
    row->dynamic = 0;
    row->dynamicPosition = -1;
    row->slot = b3w_ctx_allocate_body_slot(ctx, index);
    b3Body_SetUserData(body, (void*)(uintptr_t)(row->slot + 1));
    if (ctx->kinds != NULL) ctx->kinds[index] = (uint8_t)kind;
    if (kind == 4u || kind == 5u) ctx->geometry[ctx->geometryCount++] = (B3WGeometry){ row->slot, kind, (void*)(uintptr_t)geometry };
    if (type != b3_staticBody) b3w_ctx_set_moving(ctx, index, 1);
    b3w_unpack_rgb(desc->color, ctx->colors + index * 4);
    ctx->colorVersion += 1u;
    b3w_ctx_refresh_row(ctx, index);
    return b3w_ctx_body_handle(ctx, index);
}

B3W_EXPORT uint64_t b3w_world_create_body(uint32_t handle, const B3WBodyDesc* desc)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || desc->kind > 2u) return 0u;
    return b3w_ctx_create_general(ctx, desc, desc->kind, NULL);
}

// Convex hull of `count` points (xyz floats, body-local). Box3D keeps at most 64 hull vertices,
// and fewer for rounded shapes; the hull is then an inscribed approximation.
B3W_EXPORT uint64_t b3w_world_create_hull_body(uint32_t handle, const B3WBodyDesc* desc, const float* points, int count)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || points == NULL || count < 4 || count > 4096) return 0u;
    for (int i = 0; i < count * 3; ++i) if (!isfinite(points[i])) return 0u;
    // Box3D refuses a hull with more than 255 half-edges, which an all-triangle hull reaches
    // near 44 vertices. Ask for fewer vertices until it accepts, so a dense rounded cloud works.
    static const int budgets[] = { 64, 44, 32, 24, 16, 8 };
    b3HullData* hull = NULL;
    for (int i = 0; i < 6 && hull == NULL; ++i) hull = b3CreateHull((const b3Vec3*)points, count, budgets[i]);
    if (hull == NULL) return 0u;
    uint64_t body = b3w_ctx_create_general(ctx, desc, 3u, hull);
    b3DestroyHull(hull); // the shape keeps its own copy
    return body;
}

// Static triangle mesh: `vertexCount` xyz floats and `triangleCount` index triples, body-local.
// Only a static body may carry a mesh, so desc->type is ignored.
B3W_EXPORT uint64_t b3w_world_create_mesh_body(uint32_t handle, const B3WBodyDesc* desc, const float* vertices, int vertexCount, const int32_t* indices, int triangleCount)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || vertices == NULL || indices == NULL) return 0u;
    if (vertexCount < 3 || vertexCount > 1048576 || triangleCount < 1 || triangleCount > 2097152) return 0u;
    for (int i = 0; i < vertexCount * 3; ++i) if (!isfinite(vertices[i])) return 0u;
    for (int i = 0; i < triangleCount * 3; ++i) if (indices[i] < 0 || indices[i] >= vertexCount) return 0u;
    b3MeshDef def = { 0 };
    def.vertices = (b3Vec3*)(uintptr_t)vertices;
    def.indices = (int32_t*)(uintptr_t)indices;
    def.vertexCount = vertexCount;
    def.triangleCount = triangleCount;
    def.identifyEdges = true; // lets bodies slide across shared edges without catching
    b3MeshData* mesh = b3CreateMesh(&def, NULL, 0);
    if (mesh == NULL) return 0u;
    B3WBodyDesc fixed = *desc;
    fixed.type = 0u;
    uint64_t body = b3w_ctx_create_general(ctx, &fixed, 4u, mesh);
    if (body == 0u) b3DestroyMesh(mesh);
    return body;
}

// Static height field: countX by countZ heights (index x + z * countX), spaced sx and sz
// apart and multiplied by sy. Its corner (x = 0, z = 0) sits at the body position.
B3W_EXPORT uint64_t b3w_world_create_heightfield_body(uint32_t handle, const B3WBodyDesc* desc, const float* heights, int countX, int countZ, float sx, float sy, float sz)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || heights == NULL) return 0u;
    if (countX < 2 || countZ < 2 || countX > 4096 || countZ > 4096) return 0u;
    if (!(sx > 0.0f) || !(sy > 0.0f) || !(sz > 0.0f) || !isfinite(sx) || !isfinite(sy) || !isfinite(sz)) return 0u;
    float low = heights[0], high = heights[0];
    for (int i = 0; i < countX * countZ; ++i)
    {
        if (!isfinite(heights[i])) return 0u;
        if (heights[i] < low) low = heights[i];
        if (heights[i] > high) high = heights[i];
    }
    if (!(high > low)) high = low + 1.0f; // a flat field still needs a quantisation range
    b3HeightFieldDef def = { 0 };
    def.heights = (float*)(uintptr_t)heights;
    def.scale = (b3Vec3){ sx, sy, sz };
    def.countX = countX;
    def.countZ = countZ;
    def.globalMinimumHeight = low;
    def.globalMaximumHeight = high;
    b3HeightFieldData* field = b3CreateHeightField(&def);
    if (field == NULL) return 0u;
    B3WBodyDesc fixed = *desc;
    fixed.type = 0u;
    uint64_t body = b3w_ctx_create_general(ctx, &fixed, 5u, field);
    if (body == 0u) b3DestroyHeightField(field);
    return body;
}

// Several shapes on one body. `shapes` holds `count` (1..64) child descriptors in the body frame;
// hull children take their points (xyz floats, in the child's own frame) from `points`, which holds
// `pointCount` points. The body descriptor supplies everything except the shape: its kind, size,
// density, friction and restitution are ignored, and every child takes the body's colour, flags and
// filter. Box3D sums the children's mass, centre of mass and inertia (parallel-axis theorem), so the
// body origin is where the caller put it and the centre of mass is wherever the shapes put it.
// The render row is unscaled; the caller draws the children.
B3W_EXPORT uint64_t b3w_world_create_compound_body(uint32_t handle, const B3WBodyDesc* desc, const B3WShapeDesc* shapes, int count, const float* points, int pointCount)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || shapes == NULL || count < 1 || count > B3W_COMPOUND_LIMIT) return 0u;
    if (pointCount < 0 || (pointCount > 0 && points == NULL)) return 0u;
    for (int i = 0; i < count; ++i)
    {
        const B3WShapeDesc* child = shapes + i;
        if (child->kind > 3u || !b3w_finite3(child->position)) return 0u;
        if (!isfinite(child->rotation[0]) || !isfinite(child->rotation[1]) || !isfinite(child->rotation[2]) || !isfinite(child->rotation[3])) return 0u;
        if (!(child->density >= 0.0f) || !(child->friction >= 0.0f) || !(child->restitution >= 0.0f)) return 0u;
        if (!isfinite(child->density) || !isfinite(child->friction) || !isfinite(child->restitution)) return 0u;
        const float* size = child->size;
        if (child->kind == 0u && (!(size[0] > 0.0f) || !(size[1] > 0.0f) || !(size[2] > 0.0f) || !b3w_finite3(size))) return 0u;
        if (child->kind == 1u && (!(size[0] > 0.0f) || !isfinite(size[0]))) return 0u;
        if (child->kind == 2u && (!(size[0] > 0.0f) || !(size[1] >= 0.0025f) || !isfinite(size[0]) || !isfinite(size[1]))) return 0u;
        if (child->kind == 3u)
        {
            if (child->pointCount < 4 || child->pointCount > 4096 || child->pointOffset < 0 || child->pointOffset > pointCount - child->pointCount) return 0u;
            for (int k = 0; k < child->pointCount * 3; ++k) if (!isfinite(points[child->pointOffset * 3 + k])) return 0u;
        }
    }
    // Build every hull in the body frame before the body exists, so a refused hull leaves nothing behind.
    b3HullData* hulls[B3W_COMPOUND_LIMIT] = { 0 };
    int ok = 1;
    for (int i = 0; i < count && ok != 0; ++i)
    {
        const B3WShapeDesc* child = shapes + i;
        if (child->kind != 3u) continue;
        b3Vec3* moved = (b3Vec3*)malloc((size_t)child->pointCount * sizeof(b3Vec3));
        if (moved == NULL) { ok = 0; break; }
        const b3Quat q = b3w_quat(child->rotation);
        const float* source = points + child->pointOffset * 3;
        for (int k = 0; k < child->pointCount; ++k)
        {
            b3Vec3 p = b3w_rotate(q, (b3Vec3){ source[k * 3], source[k * 3 + 1], source[k * 3 + 2] });
            moved[k] = (b3Vec3){ p.x + child->position[0], p.y + child->position[1], p.z + child->position[2] };
        }
        static const int budgets[] = { 64, 44, 32, 24, 16, 8 };
        for (int b = 0; b < 6 && hulls[i] == NULL; ++b) hulls[i] = b3CreateHull(moved, child->pointCount, budgets[b]);
        free(moved);
        if (hulls[i] == NULL) ok = 0;
    }
    uint64_t body = 0u;
    if (ok != 0)
    {
        B3WCompound compound = { shapes, count, hulls };
        B3WBodyDesc fixed = *desc;
        fixed.size[0] = 1.0f; fixed.size[1] = 1.0f; fixed.size[2] = 1.0f;
        fixed.density = 0.0f; fixed.friction = 0.0f; fixed.restitution = 0.0f;
        body = b3w_ctx_create_general(ctx, &fixed, 6u, &compound);
    }
    for (int i = 0; i < count; ++i) if (hulls[i] != NULL) b3DestroyHull(hulls[i]); // each shape keeps its own copy
    return body;
}


// Writes one byte per dense row (0 box, 1 sphere, 2 capsule, 3 hull, 4 mesh, 5 height field, 6 compound); returns the count.
B3W_EXPORT int b3w_world_copy_body_kinds(uint32_t handle, uint8_t* out, int capacity)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || out == NULL || capacity < 0) return -1;
    int count = ctx->bodyCount < capacity ? ctx->bodyCount : capacity;
    if (ctx->kinds != NULL) memcpy(out, ctx->kinds, (size_t)count);
    else memset(out, 0, (size_t)count);
    return count;
}

#define B3W_BODY(ctxName, indexName) \
    B3WContext* ctxName = b3w_lookup_context(worldHandle); \
    if (ctxName == NULL) return -1; \
    int indexName = b3w_ctx_body_index(ctxName, bodyHandle); \
    if (indexName < 0) return 0;

// out16: position 3, rotation xyzw 4, linear velocity 3, angular velocity 3,
// mass, awake (0/1), type (0 static, 1 kinematic, 2 dynamic).
B3W_EXPORT int b3w_world_get_body_state(uint32_t worldHandle, uint64_t bodyHandle, float* out16)
{
    B3W_BODY(ctx, index)
    if (out16 == NULL) return -2;
    b3BodyId id = ctx->bodies[index].id;
    b3WorldTransform xf = b3Body_GetTransform(id);
    b3Vec3 v = b3Body_GetLinearVelocity(id), w = b3Body_GetAngularVelocity(id);
    out16[0] = (float)xf.p.x; out16[1] = (float)xf.p.y; out16[2] = (float)xf.p.z;
    out16[3] = xf.q.v.x; out16[4] = xf.q.v.y; out16[5] = xf.q.v.z; out16[6] = xf.q.s;
    out16[7] = v.x; out16[8] = v.y; out16[9] = v.z;
    out16[10] = w.x; out16[11] = w.y; out16[12] = w.z;
    out16[13] = b3Body_GetMass(id);
    out16[14] = b3Body_IsAwake(id) ? 1.0f : 0.0f;
    b3BodyType type = b3Body_GetType(id);
    out16[15] = type == b3_staticBody ? 0.0f : type == b3_kinematicBody ? 1.0f : 2.0f;
    return 1;
}

// Explicit mass data. values10: mass (kg), centre of mass in the body frame (3), then the inertia
// tensor about that centre in body axes as Ixx, Iyy, Izz, Ixy, Ixz, Iyz (kg m^2).
typedef struct B3WMassOverride { int slot; b3MassData data; } B3WMassOverride;

static void b3w_ctx_drop_mass(B3WContext* ctx, int slot)
{
    for (int i = 0; i < ctx->massOverrideCount; ++i)
    {
        if (ctx->massOverrides[i].slot != slot) continue;
        ctx->massOverrides[i] = ctx->massOverrides[--ctx->massOverrideCount];
        return;
    }
}

static B3WMassOverride* b3w_ctx_find_mass(B3WContext* ctx, int slot)
{
    for (int i = 0; i < ctx->massOverrideCount; ++i) if (ctx->massOverrides[i].slot == slot) return ctx->massOverrides + i;
    return NULL;
}

// Box3D's setter stores the numbers and nothing else. Three things it leaves undone are done here,
// so that the body moves on exactly as it was moving: the origin's velocity is kept when the centre
// of mass moves under a spinning body; a body with locked rotation keeps no inertia; and the
// world-space inverse inertia, which Box3D refreshes only at the end of a step, is refreshed now.
static void b3w_ctx_apply_mass(B3WContext* ctx, int index, const b3MassData* data)
{
    b3BodyId id = ctx->bodies[index].id;
    if (b3Body_GetType(id) != b3_dynamicBody) return;
    b3MassData mass = *data;
    b3MotionLocks locks = b3Body_GetMotionLocks(id);
    if (locks.angularX && locks.angularY && locks.angularZ) mass.inertia = (b3Matrix3){ { 0.0f, 0.0f, 0.0f }, { 0.0f, 0.0f, 0.0f }, { 0.0f, 0.0f, 0.0f } };
    b3Pos before = b3Body_GetWorldCenterOfMass(id);
    b3Body_SetMassData(id, mass);
    b3Pos after = b3Body_GetWorldCenterOfMass(id);
    b3Vec3 w = b3Body_GetAngularVelocity(id), v = b3Body_GetLinearVelocity(id);
    b3Vec3 d = { (float)(after.x - before.x), (float)(after.y - before.y), (float)(after.z - before.z) };
    if (w.x != 0.0f || w.y != 0.0f || w.z != 0.0f)
    {
        b3Body_SetLinearVelocity(id, (b3Vec3){ v.x + (w.y * d.z - w.z * d.y), v.y + (w.z * d.x - w.x * d.z), v.z + (w.x * d.y - w.y * d.x) });
    }
    b3WorldTransform xf = b3Body_GetTransform(id);
    b3Body_SetTransform(id, xf.p, xf.q);
}

// Replaces the shape-derived mass, centre of mass and inertia of a body. The values stay until
// b3w_world_reset_body_mass_data or the body's destruction, also across a change of body type; they
// act while the body is dynamic. Returns -2 unless the mass is positive and the tensor is
// symmetric positive definite.
B3W_EXPORT int b3w_world_set_body_mass_data(uint32_t worldHandle, uint64_t bodyHandle, const float* values10)
{
    B3W_BODY(ctx, index)
    if (values10 == NULL) return -2;
    for (int i = 0; i < 10; ++i) if (!isfinite(values10[i])) return -2;
    const float m = values10[0], xx = values10[4], yy = values10[5], zz = values10[6], xy = values10[7], xz = values10[8], yz = values10[9];
    // Sylvester's criterion, in double so that small tensors (1e-9 kg m^2 cubed) do not underflow.
    const double minor = (double)xx * yy - (double)xy * xy;
    const double det = (double)xx * ((double)yy * zz - (double)yz * yz) - (double)xy * ((double)xy * zz - (double)yz * xz) + (double)xz * ((double)xy * yz - (double)yy * xz);
    if (!(m > 0.0f) || !(xx > 0.0f) || !(minor > 0.0) || !(det > 0.0)) return -2;
    // Box3D inverts the tensor only when its float determinant is positive.
    if (!(xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz) > 0.0f)) return -2;
    const int slot = ctx->bodies[index].slot;
    B3WMassOverride* entry = b3w_ctx_find_mass(ctx, slot);
    if (entry == NULL)
    {
        if (ctx->massOverrideCount >= ctx->massOverrideCapacity)
        {
            int capacity = ctx->massOverrideCapacity == 0 ? 16 : ctx->massOverrideCapacity * 2;
            B3WMassOverride* list = (B3WMassOverride*)realloc(ctx->massOverrides, (size_t)capacity * sizeof(B3WMassOverride));
            if (list == NULL) return -3;
            ctx->massOverrides = list;
            ctx->massOverrideCapacity = capacity;
        }
        entry = ctx->massOverrides + ctx->massOverrideCount++;
        entry->slot = slot;
    }
    entry->data.mass = m;
    entry->data.center = (b3Vec3){ values10[1], values10[2], values10[3] };
    entry->data.inertia = (b3Matrix3){ { xx, xy, xz }, { xy, yy, yz }, { xz, yz, zz } };
    b3w_ctx_apply_mass(ctx, index, &entry->data);
    // A body asleep on a support may no longer balance there.
    b3Body_SetAwake(ctx->bodies[index].id, true);
    return 1;
}

// Back to the mass, centre and inertia of the body's shapes and their densities.
B3W_EXPORT int b3w_world_reset_body_mass_data(uint32_t worldHandle, uint64_t bodyHandle)
{
    B3W_BODY(ctx, index)
    b3w_ctx_drop_mass(ctx, ctx->bodies[index].slot);
    b3Body_ApplyMassFromShapes(ctx->bodies[index].id);
    b3Body_SetAwake(ctx->bodies[index].id, true);
    return 1;
}

// out12: the ten values of b3w_world_set_body_mass_data as the solver holds them, then 1 when
// they were set explicitly and 0 when they come from the shapes, then the number of shapes.
B3W_EXPORT int b3w_world_get_body_mass_data(uint32_t worldHandle, uint64_t bodyHandle, float* out12)
{
    B3W_BODY(ctx, index)
    if (out12 == NULL) return -2;
    b3BodyId id = ctx->bodies[index].id;
    b3MassData mass = b3Body_GetMassData(id);
    out12[0] = mass.mass;
    out12[1] = mass.center.x; out12[2] = mass.center.y; out12[3] = mass.center.z;
    out12[4] = mass.inertia.cx.x; out12[5] = mass.inertia.cy.y; out12[6] = mass.inertia.cz.z;
    out12[7] = mass.inertia.cy.x; out12[8] = mass.inertia.cz.x; out12[9] = mass.inertia.cz.y;
    out12[10] = b3w_ctx_find_mass(ctx, ctx->bodies[index].slot) != NULL ? 1.0f : 0.0f;
    out12[11] = (float)b3Body_GetShapeCount(id);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_transform(uint32_t worldHandle, uint64_t bodyHandle, float x, float y, float z, float qx, float qy, float qz, float qw)
{
    B3W_BODY(ctx, index)
    if (!isfinite(x) || !isfinite(y) || !isfinite(z)) return -2;
    const float q[4] = { qx, qy, qz, qw };
    b3Body_SetTransform(ctx->bodies[index].id, (b3Pos){ x, y, z }, b3w_quat(q));
    b3Body_SetAwake(ctx->bodies[index].id, true);
    b3w_ctx_refresh_row(ctx, index);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_velocity(uint32_t worldHandle, uint64_t bodyHandle, float vx, float vy, float vz, float wx, float wy, float wz)
{
    B3W_BODY(ctx, index)
    if (!isfinite(vx) || !isfinite(vy) || !isfinite(vz) || !isfinite(wx) || !isfinite(wy) || !isfinite(wz)) return -2;
    b3BodyId id = ctx->bodies[index].id;
    b3Body_SetLinearVelocity(id, (b3Vec3){ vx, vy, vz });
    b3Body_SetAngularVelocity(id, (b3Vec3){ wx, wy, wz });
    b3Body_SetAwake(id, true);
    return 1;
}

// Drives a kinematic body so that it reaches the pose after dt seconds.
B3W_EXPORT int b3w_world_set_body_target(uint32_t worldHandle, uint64_t bodyHandle, float x, float y, float z, float qx, float qy, float qz, float qw, float dt)
{
    B3W_BODY(ctx, index)
    if (!isfinite(x) || !isfinite(y) || !isfinite(z) || !isfinite(dt) || dt <= 0.0f) return -2;
    const float q[4] = { qx, qy, qz, qw };
    b3WorldTransform target = { (b3Pos){ x, y, z }, b3w_quat(q) };
    b3Body_SetTargetTransform(ctx->bodies[index].id, target, dt, true);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_type(uint32_t worldHandle, uint64_t bodyHandle, uint32_t type)
{
    B3W_BODY(ctx, index)
    if (type > 2u) return -2;
    b3Body_SetType(ctx->bodies[index].id, type == 0u ? b3_staticBody : type == 1u ? b3_kinematicBody : b3_dynamicBody);
    // Box3D recomputes mass from the shapes on a type change; put an explicit mass back.
    const B3WMassOverride* mass = b3w_ctx_find_mass(ctx, ctx->bodies[index].slot);
    if (mass != NULL) b3w_ctx_apply_mass(ctx, index, &mass->data);
    b3w_ctx_set_moving(ctx, index, type != 0u);
    b3w_ctx_refresh_row(ctx, index);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_awake(uint32_t worldHandle, uint64_t bodyHandle, int awake)
{
    B3W_BODY(ctx, index)
    b3Body_SetAwake(ctx->bodies[index].id, awake != 0);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_gravity_scale(uint32_t worldHandle, uint64_t bodyHandle, float scale)
{
    B3W_BODY(ctx, index)
    if (!isfinite(scale)) return -2;
    b3Body_SetGravityScale(ctx->bodies[index].id, scale);
    b3Body_SetAwake(ctx->bodies[index].id, true);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_damping(uint32_t worldHandle, uint64_t bodyHandle, float linear, float angular)
{
    B3W_BODY(ctx, index)
    if (!(linear >= 0.0f) || !(angular >= 0.0f) || !isfinite(linear) || !isfinite(angular)) return -2;
    b3Body_SetLinearDamping(ctx->bodies[index].id, linear);
    b3Body_SetAngularDamping(ctx->bodies[index].id, angular);
    return 1;
}

B3W_EXPORT int b3w_world_set_body_filter(uint32_t worldHandle, uint64_t bodyHandle, uint64_t categoryBits, uint64_t maskBits, int32_t groupIndex)
{
    B3W_BODY(ctx, index)
    b3ShapeId shapes[B3W_COMPOUND_LIMIT];
    int count = b3Body_GetShapes(ctx->bodies[index].id, shapes, B3W_COMPOUND_LIMIT);
    for (int i = 0; i < count; ++i)
    {
        b3Filter filter = b3Shape_GetFilter(shapes[i]);
        filter.categoryBits = categoryBits;
        filter.maskBits = maskBits;
        filter.groupIndex = groupIndex;
        b3Shape_SetFilter(shapes[i], filter, true);
    }
    return 1;
}

// mode: 0 force at centre, 1 torque, 2 linear impulse at centre, 3 angular impulse.
B3W_EXPORT int b3w_world_apply_body(uint32_t worldHandle, uint64_t bodyHandle, uint32_t mode, float x, float y, float z)
{
    B3W_BODY(ctx, index)
    if (mode > 3u || !isfinite(x) || !isfinite(y) || !isfinite(z)) return -2;
    b3BodyId id = ctx->bodies[index].id;
    b3Vec3 v = { x, y, z };
    if (mode == 0u) b3Body_ApplyForceToCenter(id, v, true);
    else if (mode == 1u) b3Body_ApplyTorque(id, v, true);
    else if (mode == 2u) b3Body_ApplyLinearImpulseToCenter(id, v, true);
    else b3Body_ApplyAngularImpulse(id, v, true);
    return 1;
}

// mode: 0 force, 1 linear impulse, applied at a world-space point.
B3W_EXPORT int b3w_world_apply_body_at(uint32_t worldHandle, uint64_t bodyHandle, uint32_t mode, float x, float y, float z, float px, float py, float pz)
{
    B3W_BODY(ctx, index)
    if (mode > 1u || !isfinite(x) || !isfinite(y) || !isfinite(z) || !isfinite(px) || !isfinite(py) || !isfinite(pz)) return -2;
    b3BodyId id = ctx->bodies[index].id;
    if (mode == 0u) b3Body_ApplyForce(id, (b3Vec3){ x, y, z }, (b3Pos){ px, py, pz }, true);
    else b3Body_ApplyLinearImpulse(id, (b3Vec3){ x, y, z }, (b3Pos){ px, py, pz }, true);
    return 1;
}

static int b3w_ctx_joint(B3WContext* ctx, uint64_t jointHandle, b3JointId* out)
{
    if (jointHandle == 0u || B3_IS_NULL(ctx->world)) return 0;
    b3JointId id = b3LoadJointId(jointHandle);
    if (id.world0 != (uint16_t)(ctx->world.index1 - 1) || !b3Joint_IsValid(id)) return 0;
    *out = id;
    return 1;
}

static int b3w_ctx_joint_body(B3WContext* ctx, uint64_t handle, b3BodyId* out)
{
    if (handle == 0u)
    {
        if (B3_IS_NULL(ctx->anchor))
        {
            b3BodyDef def = b3DefaultBodyDef();
            def.type = b3_staticBody;
            ctx->anchor = b3CreateBody(ctx->world, &def);
        }
        *out = ctx->anchor;
        return 1;
    }
    int index = b3w_ctx_body_index(ctx, handle);
    if (index < 0) return 0;
    *out = ctx->bodies[index].id;
    return 1;
}

// Records a joint's flags by its index, with the generation that owns them. Returns 0 when memory ran out and
// the flags could not be stored (only possible for non-zero flags).
static int b3w_ctx_set_joint_flags(B3WContext* ctx, b3JointId joint, uint32_t flags)
{
    const int index = joint.index1 - 1;
    if (index < 0) return 0;
    if (index >= ctx->jointFlagCapacity)
    {
        if (flags == 0u) return 1;
        int capacity = ctx->jointFlagCapacity == 0 ? 64 : ctx->jointFlagCapacity;
        while (capacity <= index) capacity *= 2;
        uint32_t* list = (uint32_t*)realloc(ctx->jointFlags, (size_t)capacity * sizeof(uint32_t));
        if (list == NULL) return 0;
        memset(list + ctx->jointFlagCapacity, 0, (size_t)(capacity - ctx->jointFlagCapacity) * sizeof(uint32_t));
        ctx->jointFlags = list;
        ctx->jointFlagCapacity = capacity;
    }
    ctx->jointFlags[index] = flags == 0u ? 0u : ((uint32_t)joint.generation << 8) | (flags & 0xFFu);
    return 1;
}

static uint32_t b3w_ctx_get_joint_flags(const B3WContext* ctx, b3JointId joint)
{
    const int index = joint.index1 - 1;
    if (index < 0 || index >= ctx->jointFlagCapacity) return 0u;
    const uint32_t entry = ctx->jointFlags[index];
    return (entry >> 8) == (uint32_t)joint.generation ? (entry & 0xFFu) : 0u;
}

B3W_EXPORT uint64_t b3w_world_create_joint(uint32_t handle, const B3WJointDesc* desc)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || desc == NULL || desc->type > 8u) return 0u;
    if (desc->bodyA == desc->bodyB) return 0u;
    if (!isfinite(desc->forceThreshold) || !isfinite(desc->torqueThreshold) || desc->forceThreshold < 0.0f || desc->torqueThreshold < 0.0f) return 0u;
    if (!b3w_finite3(desc->framePositionA) || !b3w_finite3(desc->framePositionB)) return 0u;
    const float scalars[10] = { desc->lower, desc->upper, desc->motorSpeed, desc->maxMotor, desc->hertz, desc->dampingRatio, desc->target, desc->coneAngle, desc->constraintHertz, desc->constraintDampingRatio };
    for (int i = 0; i < 10; ++i) if (!isfinite(scalars[i])) return 0u;
    if (desc->constraintHertz < 0.0f || desc->constraintDampingRatio < 0.0f) return 0u;
    const int limit = (desc->flags & 2u) != 0u, motor = (desc->flags & 4u) != 0u, spring = (desc->flags & 8u) != 0u;
    if (limit && desc->lower > desc->upper) return 0u;
    b3BodyId a, b;
    if (!b3w_ctx_joint_body(ctx, desc->bodyA, &a) || !b3w_ctx_joint_body(ctx, desc->bodyB, &b)) return 0u;

    b3JointId joint = b3_nullJointId;
#define B3W_JOINT_BASE(def) \
    (def).base.bodyIdA = a; (def).base.bodyIdB = b; \
    (def).base.localFrameA = (b3Transform){ { desc->framePositionA[0], desc->framePositionA[1], desc->framePositionA[2] }, b3w_quat(desc->frameRotationA) }; \
    (def).base.localFrameB = (b3Transform){ { desc->framePositionB[0], desc->framePositionB[1], desc->framePositionB[2] }, b3w_quat(desc->frameRotationB) }; \
    (def).base.collideConnected = (desc->flags & 1u) != 0u; \
    if (desc->forceThreshold > 0.0f) (def).base.forceThreshold = desc->forceThreshold; \
    if (desc->torqueThreshold > 0.0f) (def).base.torqueThreshold = desc->torqueThreshold; \
    if (desc->constraintHertz > 0.0f) { (def).base.constraintHertz = desc->constraintHertz; (def).base.constraintDampingRatio = desc->constraintDampingRatio; }
    switch (desc->type)
    {
        case 0u:
        {
            b3WeldJointDef def = b3DefaultWeldJointDef();
            B3W_JOINT_BASE(def)
            if (desc->hertz > 0.0f)
            {
                def.linearHertz = desc->hertz; def.angularHertz = desc->hertz;
                def.linearDampingRatio = desc->dampingRatio; def.angularDampingRatio = desc->dampingRatio;
            }
            joint = b3CreateWeldJoint(ctx->world, &def);
            break;
        }
        case 1u:
        {
            b3RevoluteJointDef def = b3DefaultRevoluteJointDef();
            B3W_JOINT_BASE(def)
            def.enableLimit = limit; def.lowerAngle = desc->lower; def.upperAngle = desc->upper;
            def.enableMotor = motor; def.motorSpeed = desc->motorSpeed; def.maxMotorTorque = desc->maxMotor;
            def.enableSpring = spring; def.hertz = desc->hertz; def.dampingRatio = desc->dampingRatio; def.targetAngle = desc->target;
            joint = b3CreateRevoluteJoint(ctx->world, &def);
            break;
        }
        case 2u:
        {
            b3SphericalJointDef def = b3DefaultSphericalJointDef();
            B3W_JOINT_BASE(def)
            def.enableTwistLimit = limit; def.lowerTwistAngle = desc->lower; def.upperTwistAngle = desc->upper;
            def.enableConeLimit = (desc->flags & 16u) != 0u; def.coneAngle = desc->coneAngle;
            def.enableMotor = motor; def.maxMotorTorque = desc->maxMotor;
            def.enableSpring = spring; def.hertz = desc->hertz; def.dampingRatio = desc->dampingRatio;
            joint = b3CreateSphericalJoint(ctx->world, &def);
            break;
        }
        case 3u:
        {
            b3PrismaticJointDef def = b3DefaultPrismaticJointDef();
            B3W_JOINT_BASE(def)
            def.enableLimit = limit; def.lowerTranslation = desc->lower; def.upperTranslation = desc->upper;
            def.enableMotor = motor; def.motorSpeed = desc->motorSpeed; def.maxMotorForce = desc->maxMotor;
            def.enableSpring = spring; def.hertz = desc->hertz; def.dampingRatio = desc->dampingRatio; def.targetTranslation = desc->target;
            joint = b3CreatePrismaticJoint(ctx->world, &def);
            break;
        }
        case 4u:
        {
            if (!(desc->target > 0.0f)) return 0u;
            b3DistanceJointDef def = b3DefaultDistanceJointDef();
            B3W_JOINT_BASE(def)
            def.length = desc->target;
            def.enableLimit = limit; def.minLength = desc->lower; def.maxLength = desc->upper;
            def.enableMotor = motor; def.motorSpeed = desc->motorSpeed; def.maxMotorForce = desc->maxMotor;
            def.enableSpring = spring; def.hertz = desc->hertz; def.dampingRatio = desc->dampingRatio;
            joint = b3CreateDistanceJoint(ctx->world, &def);
            break;
        }
        case 5u:
        {
            b3WheelJointDef def = b3DefaultWheelJointDef();
            B3W_JOINT_BASE(def)
            def.enableSuspensionLimit = limit; def.lowerSuspensionLimit = desc->lower; def.upperSuspensionLimit = desc->upper;
            def.enableSpinMotor = motor; def.spinSpeed = desc->motorSpeed; def.maxSpinTorque = desc->maxMotor;
            def.enableSuspensionSpring = spring; def.suspensionHertz = desc->hertz; def.suspensionDampingRatio = desc->dampingRatio;
            joint = b3CreateWheelJoint(ctx->world, &def);
            break;
        }
        case 6u:
        {
            // Created idle (no velocity, no spring, no force); b3w_world_joint_set_values(what 0) gives it its drive.
            b3MotorJointDef def = b3DefaultMotorJointDef();
            B3W_JOINT_BASE(def)
            joint = b3CreateMotorJoint(ctx->world, &def);
            break;
        }
        case 7u:
        {
            b3ParallelJointDef def = b3DefaultParallelJointDef();
            B3W_JOINT_BASE(def)
            if (spring) { def.hertz = desc->hertz; def.dampingRatio = desc->dampingRatio; }
            if (motor) def.maxTorque = desc->maxMotor;
            joint = b3CreateParallelJoint(ctx->world, &def);
            break;
        }
        default:
        {
            b3FilterJointDef def = b3DefaultFilterJointDef();
            B3W_JOINT_BASE(def)
            joint = b3CreateFilterJoint(ctx->world, &def);
            break;
        }
    }
#undef B3W_JOINT_BASE
    if (B3_IS_NULL(joint)) return 0u;
    // A joint index may have belonged to an earlier joint; its flags never carry over.
    b3w_ctx_set_joint_flags(ctx, joint, (desc->flags & 32u) != 0u ? 1u : 0u);
    return b3StoreJointId(joint);
}

#define B3W_JOINT(ctxName, idName) \
    B3WContext* ctxName = b3w_lookup_context(worldHandle); \
    if (ctxName == NULL) return -1; \
    b3JointId idName; \
    if (!b3w_ctx_joint(ctxName, jointHandle, &idName)) return 0;

B3W_EXPORT int b3w_world_joint_valid(uint32_t worldHandle, uint64_t jointHandle)
{
    B3W_JOINT(ctx, id)
    (void)id;
    return 1;
}

B3W_EXPORT int b3w_world_destroy_joint(uint32_t worldHandle, uint64_t jointHandle)
{
    B3W_JOINT(ctx, id)
    b3w_ctx_set_joint_flags(ctx, id, 0u);
    // A filter joint exists only to stop two bodies colliding, so removing it must let them collide again at once.
    // Box3D pairs two shapes anew only when one leaves its bounds margin; re-applying a shape's filter pairs it now.
    // (Other joint types keep Box3D's behaviour: bodies that were overlapping collide once one of them has moved.)
    const int filter = b3Joint_GetType(id) == b3_filterJoint;
    const b3BodyId bodies[2] = { b3Joint_GetBodyA(id), b3Joint_GetBodyB(id) };
    b3DestroyJoint(id, true);
    if (filter)
    {
        for (int k = 0; k < 2; ++k)
        {
            if (b3Body_GetType(bodies[k]) == b3_staticBody) continue;
            b3ShapeId shapes[B3W_COMPOUND_LIMIT];
            const int count = b3Body_GetShapes(bodies[k], shapes, B3W_COMPOUND_LIMIT);
            for (int i = 0; i < count; ++i)
            {
                // Box3D ignores a filter that equals the current one, so step away from it and back.
                const b3Filter own = b3Shape_GetFilter(shapes[i]);
                b3Filter other = own;
                other.groupIndex = own.groupIndex == INT32_MAX ? own.groupIndex - 1 : own.groupIndex + 1;
                b3Shape_SetFilter(shapes[i], other, false);
                b3Shape_SetFilter(shapes[i], own, true);
            }
        }
    }
    return 1;
}

// Returns -2 when the joint type has no motor.
B3W_EXPORT int b3w_world_joint_set_motor(uint32_t worldHandle, uint64_t jointHandle, int enable, float speed, float maxForce)
{
    B3W_JOINT(ctx, id)
    if (!isfinite(speed) || !isfinite(maxForce) || maxForce < 0.0f) return -3;
    switch (b3Joint_GetType(id))
    {
        case b3_revoluteJoint: b3RevoluteJoint_EnableMotor(id, enable != 0); b3RevoluteJoint_SetMotorSpeed(id, speed); b3RevoluteJoint_SetMaxMotorTorque(id, maxForce); break;
        case b3_prismaticJoint: b3PrismaticJoint_EnableMotor(id, enable != 0); b3PrismaticJoint_SetMotorSpeed(id, speed); b3PrismaticJoint_SetMaxMotorForce(id, maxForce); break;
        case b3_distanceJoint: b3DistanceJoint_EnableMotor(id, enable != 0); b3DistanceJoint_SetMotorSpeed(id, speed); b3DistanceJoint_SetMaxMotorForce(id, maxForce); break;
        case b3_wheelJoint: b3WheelJoint_EnableSpinMotor(id, enable != 0); b3WheelJoint_SetSpinMotorSpeed(id, speed); b3WheelJoint_SetMaxSpinTorque(id, maxForce); break;
        default: return -2;
    }
    b3Joint_WakeBodies(id);
    return 1;
}

B3W_EXPORT int b3w_world_joint_set_limits(uint32_t worldHandle, uint64_t jointHandle, int enable, float lower, float upper)
{
    B3W_JOINT(ctx, id)
    if (!isfinite(lower) || !isfinite(upper) || lower > upper) return -3;
    switch (b3Joint_GetType(id))
    {
        case b3_revoluteJoint: b3RevoluteJoint_SetLimits(id, lower, upper); b3RevoluteJoint_EnableLimit(id, enable != 0); break;
        case b3_prismaticJoint: b3PrismaticJoint_SetLimits(id, lower, upper); b3PrismaticJoint_EnableLimit(id, enable != 0); break;
        case b3_distanceJoint: b3DistanceJoint_SetLengthRange(id, lower, upper); b3DistanceJoint_EnableLimit(id, enable != 0); break;
        case b3_sphericalJoint: b3SphericalJoint_SetTwistLimits(id, lower, upper); b3SphericalJoint_EnableTwistLimit(id, enable != 0); break;
        case b3_wheelJoint: b3WheelJoint_SetSuspensionLimits(id, lower, upper); b3WheelJoint_EnableSuspensionLimit(id, enable != 0); break;
        default: return -2;
    }
    b3Joint_WakeBodies(id);
    return 1;
}

B3W_EXPORT int b3w_world_joint_set_spring(uint32_t worldHandle, uint64_t jointHandle, int enable, float hertz, float dampingRatio, float target)
{
    B3W_JOINT(ctx, id)
    if (!isfinite(hertz) || !isfinite(dampingRatio) || !isfinite(target) || hertz < 0.0f || dampingRatio < 0.0f) return -3;
    switch (b3Joint_GetType(id))
    {
        case b3_revoluteJoint: b3RevoluteJoint_EnableSpring(id, enable != 0); b3RevoluteJoint_SetSpringHertz(id, hertz); b3RevoluteJoint_SetSpringDampingRatio(id, dampingRatio); b3RevoluteJoint_SetTargetAngle(id, target); break;
        case b3_prismaticJoint: b3PrismaticJoint_EnableSpring(id, enable != 0); b3PrismaticJoint_SetSpringHertz(id, hertz); b3PrismaticJoint_SetSpringDampingRatio(id, dampingRatio); b3PrismaticJoint_SetTargetTranslation(id, target); break;
        case b3_distanceJoint: b3DistanceJoint_EnableSpring(id, enable != 0); b3DistanceJoint_SetSpringHertz(id, hertz); b3DistanceJoint_SetSpringDampingRatio(id, dampingRatio); if (target > 0.0f) b3DistanceJoint_SetLength(id, target); break;
        case b3_sphericalJoint: b3SphericalJoint_EnableSpring(id, enable != 0); b3SphericalJoint_SetSpringHertz(id, hertz); b3SphericalJoint_SetSpringDampingRatio(id, dampingRatio); break;
        case b3_weldJoint: b3WeldJoint_SetLinearHertz(id, enable != 0 ? hertz : 0.0f); b3WeldJoint_SetAngularHertz(id, enable != 0 ? hertz : 0.0f); b3WeldJoint_SetLinearDampingRatio(id, dampingRatio); b3WeldJoint_SetAngularDampingRatio(id, dampingRatio); break;
        case b3_wheelJoint: b3WheelJoint_EnableSuspension(id, enable != 0); b3WheelJoint_SetSuspensionHertz(id, hertz); b3WheelJoint_SetSuspensionDampingRatio(id, dampingRatio); break;
        default: return -2;
    }
    b3Joint_WakeBodies(id);
    return 1;
}

// How stiffly a joint holds its two bodies together. Box3D's default is 60 Hz with damping
// ratio 2; a higher frequency sags less under load but needs enough solver sub-steps.
B3W_EXPORT int b3w_world_joint_set_tuning(uint32_t worldHandle, uint64_t jointHandle, float hertz, float dampingRatio)
{
    B3W_JOINT(ctx, id)
    if (!isfinite(hertz) || !isfinite(dampingRatio) || !(hertz > 0.0f) || dampingRatio < 0.0f) return -3;
    b3Joint_SetConstraintTuning(id, hertz, dampingRatio);
    b3Joint_WakeBodies(id);
    return 1;
}

// Wheel joints only: steer towards an angle about frame A's x axis.
B3W_EXPORT int b3w_world_joint_set_steering(uint32_t worldHandle, uint64_t jointHandle, int enable, float angle, float hertz, float dampingRatio, float maxTorque)
{
    B3W_JOINT(ctx, id)
    if (!isfinite(angle) || !isfinite(hertz) || !isfinite(dampingRatio) || !isfinite(maxTorque) || hertz < 0.0f || dampingRatio < 0.0f || maxTorque < 0.0f) return -3;
    if (b3Joint_GetType(id) != b3_wheelJoint) return -2;
    b3WheelJoint_EnableSteering(id, enable != 0);
    b3WheelJoint_SetSteeringHertz(id, hertz);
    b3WheelJoint_SetSteeringDampingRatio(id, dampingRatio);
    b3WheelJoint_SetMaxSteeringTorque(id, maxTorque);
    b3WheelJoint_SetTargetSteeringAngle(id, angle);
    b3Joint_WakeBodies(id);
    return 1;
}

// out8: joint value (revolute angle, prismatic translation, distance length;
// 0 otherwise), type, constraint force xyz, constraint torque xyz.
B3W_EXPORT int b3w_world_get_joint_state(uint32_t worldHandle, uint64_t jointHandle, float* out8)
{
    B3W_JOINT(ctx, id)
    if (out8 == NULL) return -3;
    b3JointType type = b3Joint_GetType(id);
    float value = 0.0f, code = -1.0f;
    switch (type)
    {
        case b3_weldJoint: code = 0.0f; break;
        case b3_revoluteJoint: code = 1.0f; value = b3RevoluteJoint_GetAngle(id); break;
        case b3_sphericalJoint: code = 2.0f; break;
        case b3_prismaticJoint: code = 3.0f; value = b3PrismaticJoint_GetTranslation(id); break;
        case b3_distanceJoint: code = 4.0f; value = b3DistanceJoint_GetCurrentLength(id); break;
        case b3_wheelJoint: code = 5.0f; break;
        case b3_motorJoint: code = 6.0f; break;
        case b3_parallelJoint: code = 7.0f; break;
        case b3_filterJoint: code = 8.0f; break;
        default: break;
    }
    b3Vec3 force = b3Joint_GetConstraintForce(id), torque = b3Joint_GetConstraintTorque(id);
    out8[0] = value; out8[1] = code;
    out8[2] = force.x; out8[3] = force.y; out8[4] = force.z;
    out8[5] = torque.x; out8[6] = torque.y; out8[7] = torque.z;
    return 1;
}

static uint64_t b3w_ctx_shape_body_handle(B3WContext* ctx, b3ShapeId shape)
{
    if (!b3Shape_IsValid(shape)) return 0u;
    b3BodyId body = b3Shape_GetBody(shape);
    uintptr_t slot1 = (uintptr_t)b3Body_GetUserData(body);
    if (slot1 == 0u || slot1 > (uintptr_t)ctx->slotsUsed) return 0u;
    const B3WBodySlot* slot = ctx->bodySlots + slot1 - 1u;
    return slot->denseIndex >= 0 ? (slot->generation << B3W_BODY_SLOT_BITS) | (uint64_t)slot1 : 0u;
}

static B3WEvent* b3w_ctx_push_event(B3WContext* ctx)
{
    ctx->eventTotal += 1;
    if (ctx->eventCount >= ctx->eventCapacity)
    {
        if (ctx->eventCapacity >= B3W_EVENT_LIMIT) return NULL;
        int capacity = ctx->eventCapacity == 0 ? 256 : ctx->eventCapacity * 4;
        B3WEvent* events = (B3WEvent*)realloc(ctx->events, (size_t)capacity * sizeof(B3WEvent));
        if (events == NULL) return NULL;
        ctx->events = events;
        ctx->eventCapacity = capacity;
    }
    B3WEvent* event = ctx->events + ctx->eventCount++;
    memset(event, 0, sizeof(B3WEvent));
    return event;
}

// A joint that exceeded its force or torque threshold in the most recent step.
typedef struct B3WJointRecord
{
    uint64_t joint; // b3StoreJointId
    b3BodyId bodyA, bodyB;
    float force[3], torque[3];
    uint32_t broke;
    uint32_t padding;
} B3WJointRecord;

static void b3w_ctx_write_joint_event(B3WContext* ctx, B3WEvent* event, const struct B3WJointRecord* record);

// Copies the contact and sensor events of the most recent step into the
// world's event buffer and returns how many were stored. Call once after each
// step. b3w_world_event_total reports how many occurred, including any that
// did not fit, so a caller can detect overflow.
B3W_EXPORT int b3w_world_collect_events(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world)) return -1;
    ctx->eventCount = 0;
    ctx->eventTotal = 0;
    b3ContactEvents contacts = b3World_GetContactEvents(ctx->world);
    for (int i = 0; i < contacts.beginCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        event->kind = 0u;
        event->bodyA = b3w_ctx_shape_body_handle(ctx, contacts.beginEvents[i].shapeIdA);
        event->bodyB = b3w_ctx_shape_body_handle(ctx, contacts.beginEvents[i].shapeIdB);
    }
    for (int i = 0; i < contacts.endCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        event->kind = 1u;
        event->bodyA = b3w_ctx_shape_body_handle(ctx, contacts.endEvents[i].shapeIdA);
        event->bodyB = b3w_ctx_shape_body_handle(ctx, contacts.endEvents[i].shapeIdB);
    }
    for (int i = 0; i < contacts.hitCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        const b3ContactHitEvent* hit = contacts.hitEvents + i;
        event->kind = 2u;
        event->bodyA = b3w_ctx_shape_body_handle(ctx, hit->shapeIdA);
        event->bodyB = b3w_ctx_shape_body_handle(ctx, hit->shapeIdB);
        event->point[0] = (float)hit->point.x; event->point[1] = (float)hit->point.y; event->point[2] = (float)hit->point.z;
        event->normal[0] = hit->normal.x; event->normal[1] = hit->normal.y; event->normal[2] = hit->normal.z;
        event->speed = hit->approachSpeed;
    }
    b3SensorEvents sensors = b3World_GetSensorEvents(ctx->world);
    for (int i = 0; i < sensors.beginCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        event->kind = 3u;
        event->bodyA = b3w_ctx_shape_body_handle(ctx, sensors.beginEvents[i].sensorShapeId);
        event->bodyB = b3w_ctx_shape_body_handle(ctx, sensors.beginEvents[i].visitorShapeId);
    }
    for (int i = 0; i < sensors.endCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        event->kind = 4u;
        event->bodyA = b3w_ctx_shape_body_handle(ctx, sensors.endEvents[i].sensorShapeId);
        event->bodyB = b3w_ctx_shape_body_handle(ctx, sensors.endEvents[i].visitorShapeId);
    }
    for (int i = 0; i < ctx->jointRecordCount; ++i)
    {
        B3WEvent* event = b3w_ctx_push_event(ctx);
        if (event == NULL) continue;
        const struct B3WJointRecord* record = ctx->jointRecords + i;
        b3w_ctx_write_joint_event(ctx, event, record);
    }
    return ctx->eventCount;
}

B3W_EXPORT uintptr_t b3w_world_events_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->events : 0u;
}

B3W_EXPORT int b3w_world_event_total(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? ctx->eventTotal : -1;
}

// ---------------------------------------------------------------------------
// Rigid-core extension (optional; the world API version stays 1).
//
// Joint events and breakable joints, batched closest-hit rays, the capsule
// character mover, world and body controls, Box3D's radial explosion, step
// profile and counters, and debug-draw lines. Nothing here runs for a world
// that does not call it, except the joint-event check after each step, which
// costs one call when no joint has a threshold.
// ---------------------------------------------------------------------------

#define B3W_JOINT_RECORD_LIMIT 65536

static uint64_t b3w_ctx_native_body_handle(B3WContext* ctx, b3BodyId body)
{
    if (ctx->bodySlots == NULL || !b3Body_IsValid(body)) return 0u;
    uintptr_t slot1 = (uintptr_t)b3Body_GetUserData(body);
    if (slot1 == 0u || slot1 > (uintptr_t)ctx->slotsUsed) return 0u;
    const B3WBodySlot* slot = ctx->bodySlots + slot1 - 1u;
    return slot->denseIndex >= 0 ? (slot->generation << B3W_BODY_SLOT_BITS) | (uint64_t)slot1 : 0u;
}

// Copies the joints Box3D reported over their force or torque threshold in the step just taken, then destroys
// the ones flagged as breakable. Box3D's event array is invalid once a joint is destroyed, hence the copy.
static void b3w_ctx_after_step(B3WContext* ctx)
{
    b3JointEvents events = b3World_GetJointEvents(ctx->world);
    if (events.count <= 0) return;
    int count = events.count > B3W_JOINT_RECORD_LIMIT ? B3W_JOINT_RECORD_LIMIT : events.count;
    if (count > ctx->jointRecordCapacity)
    {
        B3WJointRecord* list = (B3WJointRecord*)realloc(ctx->jointRecords, (size_t)count * sizeof(B3WJointRecord));
        if (list == NULL) count = ctx->jointRecordCapacity;
        else { ctx->jointRecords = list; ctx->jointRecordCapacity = count; }
    }
    // Breaking must not depend on whether the record buffer could grow: every reported joint is examined.
    for (int i = 0; i < events.count; ++i)
    {
        const b3JointId id = events.jointEvents[i].jointId;
        if (i >= count) continue;
        B3WJointRecord* record = ctx->jointRecords + i;
        memset(record, 0, sizeof(*record));
        record->joint = b3StoreJointId(id);
        record->bodyA = b3Joint_GetBodyA(id);
        record->bodyB = b3Joint_GetBodyB(id);
        const b3Vec3 force = b3Joint_GetConstraintForce(id), torque = b3Joint_GetConstraintTorque(id);
        record->force[0] = force.x; record->force[1] = force.y; record->force[2] = force.z;
        record->torque[0] = torque.x; record->torque[1] = torque.y; record->torque[2] = torque.z;
        record->broke = (b3w_ctx_get_joint_flags(ctx, id) & 1u) != 0u ? 1u : 0u;
    }
    ctx->jointRecordCount = count;
    // Second pass over our own copy (and over any events that did not fit, straight from the flags table).
    const int total = events.count;
    b3JointId* overflow = NULL;
    int overflowCount = 0;
    if (total > count)
    {
        overflow = (b3JointId*)malloc((size_t)(total - count) * sizeof(b3JointId));
        if (overflow != NULL) for (int i = count; i < total; ++i) overflow[overflowCount++] = events.jointEvents[i].jointId;
    }
    for (int i = 0; i < count; ++i)
    {
        if (ctx->jointRecords[i].broke == 0u) continue;
        const b3JointId id = b3LoadJointId(ctx->jointRecords[i].joint);
        b3w_ctx_set_joint_flags(ctx, id, 0u);
        if (b3Joint_IsValid(id)) b3DestroyJoint(id, true);
    }
    for (int i = 0; i < overflowCount; ++i)
    {
        if ((b3w_ctx_get_joint_flags(ctx, overflow[i]) & 1u) == 0u) continue;
        b3w_ctx_set_joint_flags(ctx, overflow[i], 0u);
        if (b3Joint_IsValid(overflow[i])) b3DestroyJoint(overflow[i], true);
    }
    free(overflow);
}

static void b3w_ctx_write_joint_event(B3WContext* ctx, B3WEvent* event, const struct B3WJointRecord* record)
{
    event->kind = record->broke != 0u ? 6u : 5u;
    event->reserved = (uint32_t)(record->joint & 0xFFFFFFFFu);
    event->padding = (uint32_t)(record->joint >> 32);
    event->bodyA = b3w_ctx_native_body_handle(ctx, record->bodyA);
    event->bodyB = b3w_ctx_native_body_handle(ctx, record->bodyB);
    for (int k = 0; k < 3; ++k) { event->point[k] = record->force[k]; event->normal[k] = record->torque[k]; }
}

// what 0: motor joint drive, 14 values: linear velocity (3, m/s, in frame A), angular velocity (3, rad/s),
//         max velocity force (N), max velocity torque (N m), linear spring hertz, damping ratio, max spring force (N),
//         angular spring hertz, damping ratio, max spring torque (N m). The springs pull frame B onto frame A.
// what 1: thresholds, 3 values: force (N), torque (N m), breakable (0/1). A threshold of 0 removes it.
// what 2: wheel steering limits, 3 values: enable, lower (rad), upper (rad).
// what 3: spherical joint spring target rotation, 4 values: x, y, z, w.
// what 4: spherical joint motor, 5 values: enable, angular velocity (3, rad/s), max torque (N m).
// what 5: parallel joint, 3 values: spring hertz, damping ratio, max torque (N m).
// what 6: spherical cone limit, 2 values: enable, half angle (rad).
// what 7: collide connected, 1 value: 0/1.
// Returns 1; 0 for a dead joint; -2 when the joint type does not take that setting; -3 for bad values.
B3W_EXPORT int b3w_world_joint_set_values(uint32_t worldHandle, uint64_t jointHandle, uint32_t what, const float* v, int count)
{
    B3W_JOINT(ctx, id)
    static const int counts[8] = { 14, 3, 3, 4, 5, 3, 2, 1 };
    if (what > 7u || v == NULL || count != counts[what]) return -3;
    for (int i = 0; i < count; ++i) if (!isfinite(v[i])) return -3;
    const b3JointType type = b3Joint_GetType(id);
    switch (what)
    {
        case 0u:
            if (type != b3_motorJoint) return -2;
            if (v[6] < 0.0f || v[7] < 0.0f || v[8] < 0.0f || v[9] < 0.0f || v[10] < 0.0f || v[11] < 0.0f || v[12] < 0.0f || v[13] < 0.0f) return -3;
            b3MotorJoint_SetLinearVelocity(id, (b3Vec3){ v[0], v[1], v[2] });
            b3MotorJoint_SetAngularVelocity(id, (b3Vec3){ v[3], v[4], v[5] });
            b3MotorJoint_SetMaxVelocityForce(id, v[6]);
            b3MotorJoint_SetMaxVelocityTorque(id, v[7]);
            b3MotorJoint_SetLinearHertz(id, v[8]);
            b3MotorJoint_SetLinearDampingRatio(id, v[9]);
            b3MotorJoint_SetMaxSpringForce(id, v[10]);
            b3MotorJoint_SetAngularHertz(id, v[11]);
            b3MotorJoint_SetAngularDampingRatio(id, v[12]);
            b3MotorJoint_SetMaxSpringTorque(id, v[13]);
            break;
        case 1u:
            if (v[0] < 0.0f || v[1] < 0.0f) return -3;
            b3Joint_SetForceThreshold(id, v[0] > 0.0f ? v[0] : FLT_MAX);
            b3Joint_SetTorqueThreshold(id, v[1] > 0.0f ? v[1] : FLT_MAX);
            if (b3w_ctx_set_joint_flags(ctx, id, v[2] != 0.0f ? 1u : 0u) == 0) return -3;
            break;
        case 2u:
            if (type != b3_wheelJoint) return -2;
            if (v[1] > v[2]) return -3;
            b3WheelJoint_SetSteeringLimits(id, v[1], v[2]);
            b3WheelJoint_EnableSteeringLimit(id, v[0] != 0.0f);
            break;
        case 3u:
            if (type != b3_sphericalJoint) return -2;
            b3SphericalJoint_SetTargetRotation(id, b3w_quat(v));
            break;
        case 4u:
            if (type != b3_sphericalJoint) return -2;
            if (v[4] < 0.0f) return -3;
            b3SphericalJoint_EnableMotor(id, v[0] != 0.0f);
            b3SphericalJoint_SetMotorVelocity(id, (b3Vec3){ v[1], v[2], v[3] });
            b3SphericalJoint_SetMaxMotorTorque(id, v[4]);
            break;
        case 5u:
            if (type != b3_parallelJoint) return -2;
            if (v[0] < 0.0f || v[1] < 0.0f || v[2] < 0.0f) return -3;
            b3ParallelJoint_SetSpringHertz(id, v[0]);
            b3ParallelJoint_SetSpringDampingRatio(id, v[1]);
            b3ParallelJoint_SetMaxTorque(id, v[2]);
            break;
        case 6u:
            if (type != b3_sphericalJoint) return -2;
            if (v[1] < 0.0f || v[1] > 3.14159274f) return -3;
            b3SphericalJoint_SetConeLimit(id, v[1]);
            b3SphericalJoint_EnableConeLimit(id, v[0] != 0.0f);
            break;
        default:
            b3Joint_SetCollideConnected(id, v[0] != 0.0f);
            break;
    }
    b3Joint_WakeBodies(id);
    return 1;
}

// out24: [0] type code, [1] linear separation error (m), [2] angular separation error (rad),
// [3] force threshold (0 when none), [4] torque threshold (0 when none), [5] breakable (0/1),
// [6] constraint tuning hertz, [7] damping ratio, then by type from [8]:
//   revolute  angle, motor torque, lower limit, upper limit, motor speed
//   prismatic translation, speed, motor force, lower limit, upper limit
//   distance  current length, motor force, rest length, min length, max length
//   spherical twist angle, motor torque x y z, cone angle now, cone limit
//   wheel     spin speed (rad/s), spin torque, steering angle, steering torque, target steering angle,
//             suspension translation (m, along frame A's x axis), lower and upper suspension limits
//   motor     linear velocity x y z, angular velocity x y z
B3W_EXPORT int b3w_world_joint_get_values(uint32_t worldHandle, uint64_t jointHandle, float* out24)
{
    B3W_JOINT(ctx, id)
    if (out24 == NULL) return -3;
    memset(out24, 0, 24u * sizeof(float));
    const b3JointType type = b3Joint_GetType(id);
    float* o = out24 + 8;
    float code = -1.0f;
    switch (type)
    {
        case b3_weldJoint: code = 0.0f; break;
        case b3_revoluteJoint:
            code = 1.0f;
            o[0] = b3RevoluteJoint_GetAngle(id); o[1] = b3RevoluteJoint_GetMotorTorque(id);
            o[2] = b3RevoluteJoint_GetLowerLimit(id); o[3] = b3RevoluteJoint_GetUpperLimit(id); o[4] = b3RevoluteJoint_GetMotorSpeed(id);
            break;
        case b3_sphericalJoint:
        {
            code = 2.0f;
            b3Vec3 t = b3SphericalJoint_GetMotorTorque(id);
            o[0] = b3SphericalJoint_GetTwistAngle(id); o[1] = t.x; o[2] = t.y; o[3] = t.z;
            o[4] = b3SphericalJoint_GetConeAngle(id); o[5] = b3SphericalJoint_GetConeLimit(id);
            break;
        }
        case b3_prismaticJoint:
            code = 3.0f;
            o[0] = b3PrismaticJoint_GetTranslation(id); o[1] = b3PrismaticJoint_GetSpeed(id); o[2] = b3PrismaticJoint_GetMotorForce(id);
            o[3] = b3PrismaticJoint_GetLowerLimit(id); o[4] = b3PrismaticJoint_GetUpperLimit(id);
            break;
        case b3_distanceJoint:
            code = 4.0f;
            o[0] = b3DistanceJoint_GetCurrentLength(id); o[1] = b3DistanceJoint_GetMotorForce(id); o[2] = b3DistanceJoint_GetLength(id);
            o[3] = b3DistanceJoint_GetMinLength(id); o[4] = b3DistanceJoint_GetMaxLength(id);
            break;
        case b3_wheelJoint:
        {
            code = 5.0f;
            o[0] = b3WheelJoint_GetSpinSpeed(id); o[1] = b3WheelJoint_GetSpinTorque(id);
            o[2] = b3WheelJoint_GetSteeringAngle(id); o[3] = b3WheelJoint_GetSteeringTorque(id); o[4] = b3WheelJoint_GetTargetSteeringAngle(id);
            // Suspension travel: frame B's origin measured from frame A's origin along frame A's x axis.
            const b3BodyId a = b3Joint_GetBodyA(id), b = b3Joint_GetBodyB(id);
            const b3Transform fa = b3Joint_GetLocalFrameA(id), fb = b3Joint_GetLocalFrameB(id);
            const b3Pos pa = b3Body_GetWorldPoint(a, fa.p), pb = b3Body_GetWorldPoint(b, fb.p);
            const b3Vec3 axis = b3Body_GetWorldVector(a, b3w_rotate(fa.q, (b3Vec3){ 1.0f, 0.0f, 0.0f }));
            o[5] = (float)(pb.x - pa.x) * axis.x + (float)(pb.y - pa.y) * axis.y + (float)(pb.z - pa.z) * axis.z;
            o[6] = b3WheelJoint_GetLowerSuspensionLimit(id); o[7] = b3WheelJoint_GetUpperSuspensionLimit(id);
            break;
        }
        case b3_motorJoint:
        {
            code = 6.0f;
            b3Vec3 lv = b3MotorJoint_GetLinearVelocity(id), av = b3MotorJoint_GetAngularVelocity(id);
            o[0] = lv.x; o[1] = lv.y; o[2] = lv.z; o[3] = av.x; o[4] = av.y; o[5] = av.z;
            break;
        }
        case b3_parallelJoint: code = 7.0f; o[0] = b3ParallelJoint_GetSpringHertz(id); o[1] = b3ParallelJoint_GetSpringDampingRatio(id); o[2] = b3ParallelJoint_GetMaxTorque(id); break;
        case b3_filterJoint: code = 8.0f; break;
        default: break;
    }
    out24[0] = code;
    out24[1] = b3Joint_GetLinearSeparation(id);
    out24[2] = b3Joint_GetAngularSeparation(id);
    const float forceThreshold = b3Joint_GetForceThreshold(id), torqueThreshold = b3Joint_GetTorqueThreshold(id);
    out24[3] = forceThreshold < FLT_MAX ? forceThreshold : 0.0f;
    out24[4] = torqueThreshold < FLT_MAX ? torqueThreshold : 0.0f;
    out24[5] = (b3w_ctx_get_joint_flags(ctx, id) & 1u) != 0u ? 1.0f : 0.0f;
    b3Joint_GetConstraintTuning(id, out24 + 6, out24 + 7);
    return 1;
}

// --- Batched closest-hit rays: one call for many rays. ---

typedef struct B3WRayVisit
{
    B3WContext* ctx;
    uint32_t bodyTypes;
    uint64_t ignoreBody;
    uint64_t body;
    float fraction;
    // How far beyond the best fraction the ray is clipped: 0.1 mm plus a millionth of the ray's span and distance
    // from the origin, as a fraction of its length, which covers the float rounding of tree bounds and hit points.
    float margin;
    float point[3], normal[3];
    int triangle, child;
} B3WRayVisit;

// The nearest hit, with the order of the query path's sort (b3w_compare_query_hit): fraction, then body token, then
// triangle, then compound child. The ray is clipped just beyond the best fraction so far, never at it: Box3D then
// still reports every shape that reaches the same fraction (its tree keeps a node only when the clipped segment's
// bounds reach it, and stops the cast at a returned 0), so ties are decided here and the answer is the query path's,
// bit for bit, while shapes beyond the nearest hit are no longer tested.
static float b3w_ray_clip(const B3WRayVisit* visit)
{
    if (visit->body == 0u) return 1.0f;
    const float clip = visit->fraction + visit->margin;
    return clip < 1.0f ? clip : 1.0f;
}

static float b3w_ray_closest_callback(b3ShapeId shape, b3Pos p, b3Vec3 n, float fraction, uint64_t material, int triangle, int child, void* user)
{
    (void)material;
    B3WRayVisit* visit = (B3WRayVisit*)user;
    B3WContext* ctx = visit->ctx;
    const b3BodyId body = b3Shape_GetBody(shape);
    const uintptr_t slot1 = (uintptr_t)b3Body_GetUserData(body);
    if (slot1 == 0u || slot1 > (uintptr_t)ctx->slotsUsed) return -1.0f;
    const int index = ctx->bodySlots[slot1 - 1u].denseIndex;
    if (index < 0 || index >= ctx->bodyCount || b3StoreBodyId(body) != b3StoreBodyId(ctx->bodies[index].id)) return -1.0f;
    const uint64_t token = b3w_ctx_body_handle(ctx, index);
    if (token == visit->ignoreBody || (visit->bodyTypes & (ctx->bodies[index].dynamic ? 2u : 1u)) == 0u) return -1.0f;
    const int better = visit->body == 0u || fraction < visit->fraction ||
        (fraction == visit->fraction && (token < visit->body || (token == visit->body &&
            (triangle < visit->triangle || (triangle == visit->triangle && child < visit->child)))));
    if (better)
    {
        visit->body = token;
        visit->fraction = fraction;
        visit->point[0] = (float)p.x; visit->point[1] = (float)p.y; visit->point[2] = (float)p.z;
        visit->normal[0] = n.x; visit->normal[1] = n.y; visit->normal[2] = n.z;
        visit->triangle = triangle; visit->child = child;
    }
    return b3w_ray_clip(visit);
}

// rays: `count` (1..65536) rays of 6 floats (origin xyz, translation xyz). outHits: 8 floats per ray
// (fraction, or -1 for a miss; point xyz; normal xyz; triangle index or -1). outBodies: one body handle per ray
// (0 for a miss). bodyTypes: bit 0 static, bit 1 moving. Returns the number of rays that hit, -1 for an unknown
// or empty world, -2 for bad input, -5 for a stale ignored body. Nothing is written before every ray is checked.
B3W_EXPORT int b3w_world_cast_rays(uint32_t handle, const float* rays, int count, uint64_t categoryBits, uint64_t maskBits,
    uint32_t bodyTypes, uint64_t ignoreBody, float* outHits, uint64_t* outBodies)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || ctx->bodySlots == NULL) return -1;
    if (rays == NULL || outHits == NULL || outBodies == NULL || count < 1 || count > 65536 || bodyTypes > 3u) return -2;
    for (int i = 0; i < count * 6; ++i) if (!isfinite(rays[i]) || fabsf(rays[i]) > 1000000.0f) return -2;
    if (ignoreBody != 0u && b3w_ctx_body_index(ctx, ignoreBody) < 0) return -5;
    b3QueryFilter filter = b3DefaultQueryFilter();
    filter.categoryBits = categoryBits; filter.maskBits = maskBits;
    int hits = 0;
    for (int i = 0; i < count; ++i)
    {
        const float* r = rays + i * 6;
        float* out = outHits + i * 8;
        const float length = sqrtf(r[3] * r[3] + r[4] * r[4] + r[5] * r[5]);
        const float reach = fabsf(r[0]) + fabsf(r[1]) + fabsf(r[2]) + fabsf(r[3]) + fabsf(r[4]) + fabsf(r[5]);
        B3WRayVisit visit = { .ctx = ctx, .bodyTypes = bodyTypes, .ignoreBody = ignoreBody, .fraction = 1.0f, .triangle = -1, .child = -1,
            .margin = length > 0.0f ? (1.0e-4f + 1.0e-6f * reach) / length : 1.0f };
        if (bodyTypes != 0u && (r[3] != 0.0f || r[4] != 0.0f || r[5] != 0.0f))
        {
            b3World_CastRay(ctx->world, (b3Pos){ r[0], r[1], r[2] }, (b3Vec3){ r[3], r[4], r[5] }, filter, b3w_ray_closest_callback, &visit);
        }
        outBodies[i] = visit.body;
        if (visit.body == 0u) { out[0] = -1.0f; for (int k = 1; k < 7; ++k) out[k] = 0.0f; out[7] = -1.0f; continue; }
        out[0] = visit.fraction;
        out[1] = visit.point[0]; out[2] = visit.point[1]; out[3] = visit.point[2];
        out[4] = visit.normal[0]; out[5] = visit.normal[1]; out[6] = visit.normal[2];
        out[7] = (float)visit.triangle;
        hits += 1;
    }
    return hits;
}

// --- Capsule character mover (b3World_CollideMover, b3SolvePlanes, b3World_CastMover). ---

#define B3W_MOVER_PLANES 16
typedef struct B3WMoverInput
{
    float origin[3]; // centre of the upright capsule
    float radius, halfLength; // half the distance between the cap centres
    float delta[3]; // wanted translation
    float minGroundY; // with flag 1: a plane whose normal has 0 < y < minGroundY is treated as a vertical wall
    float tolerance; // stop iterating when a move is shorter than this (m)
    uint32_t flags; // 1 steep planes act as walls
    uint32_t iterations; // 1..16
    uint32_t bodyTypes; // bit 0 static, bit 1 kinematic, bit 2 dynamic
    uint32_t reserved;
    uint64_t categoryBits, maskBits, ignoreBody;
} B3WMoverInput;
typedef struct B3WMoverPlane
{
    float normal[3], offset; // as Box3D returned it (before any wall treatment), relative to the capsule centre at the last iteration
    float point[3]; // closest point on the shape, world space
    float push; // how far the plane solver pushed along the normal (m)
    uint64_t body;
    uint32_t bodyType; // 0 static, 1 kinematic, 2 dynamic
    uint32_t flags; // 1 treated as a wall
} B3WMoverPlane;
typedef struct B3WMoverOutput
{
    float position[3];
    float fraction; // of the last cast
    uint32_t iterations, planeCount, solverIterations, reserved;
    B3WMoverPlane planes[B3W_MOVER_PLANES];
} B3WMoverOutput;
_Static_assert(sizeof(B3WMoverInput) == 80, "Mover input ABI must be 80 bytes");
_Static_assert(sizeof(B3WMoverPlane) == 48, "Mover plane ABI must be 48 bytes");
_Static_assert(sizeof(B3WMoverOutput) == 32 + B3W_MOVER_PLANES * 48, "Mover output ABI must be 800 bytes");

typedef struct B3WMoverVisit
{
    B3WContext* ctx;
    const B3WMoverInput* input;
    b3CollisionPlane planes[B3W_MOVER_PLANES];
    B3WMoverPlane records[B3W_MOVER_PLANES];
    int count;
} B3WMoverVisit;

// 0 when the mover ignores this shape; else the body handle, with its Box3D type in *type.
static uint64_t b3w_mover_body(B3WMoverVisit* visit, b3ShapeId shape, uint32_t* type)
{
    const b3BodyId body = b3Shape_GetBody(shape);
    const uint64_t token = b3w_ctx_native_body_handle(visit->ctx, body);
    if (token == 0u || token == visit->input->ignoreBody || b3Shape_IsSensor(shape)) return 0u;
    const b3BodyType t = b3Body_GetType(body);
    *type = t == b3_staticBody ? 0u : t == b3_kinematicBody ? 1u : 2u;
    return (visit->input->bodyTypes & (1u << *type)) != 0u ? token : 0u;
}

static bool b3w_mover_filter(b3ShapeId shape, void* user)
{
    uint32_t type = 0u;
    return b3w_mover_body((B3WMoverVisit*)user, shape, &type) != 0u;
}

static bool b3w_mover_planes(b3ShapeId shape, const b3PlaneResult* results, int planeCount, void* user)
{
    B3WMoverVisit* visit = (B3WMoverVisit*)user;
    uint32_t type = 0u;
    const uint64_t body = b3w_mover_body(visit, shape, &type);
    if (body == 0u) return true;
    for (int i = 0; i < planeCount && visit->count < B3W_MOVER_PLANES; ++i)
    {
        const b3Plane plane = results[i].plane;
        if (!isfinite(plane.normal.x) || !isfinite(plane.normal.y) || !isfinite(plane.normal.z) || !isfinite(plane.offset)) continue;
        B3WMoverPlane* record = visit->records + visit->count;
        memset(record, 0, sizeof(*record));
        record->normal[0] = plane.normal.x; record->normal[1] = plane.normal.y; record->normal[2] = plane.normal.z;
        record->offset = plane.offset;
        record->point[0] = results[i].point.x; record->point[1] = results[i].point.y; record->point[2] = results[i].point.z;
        record->body = body;
        record->bodyType = type;
        b3CollisionPlane* solver = visit->planes + visit->count;
        *solver = (b3CollisionPlane){ .plane = plane, .pushLimit = FLT_MAX, .push = 0.0f, .clipVelocity = true };
        if ((visit->input->flags & 1u) != 0u && plane.normal.y > 0.0f && plane.normal.y < visit->input->minGroundY)
        {
            const float h = sqrtf(plane.normal.x * plane.normal.x + plane.normal.z * plane.normal.z);
            if (h > 1.0e-6f)
            {
                solver->plane.normal = (b3Vec3){ plane.normal.x / h, 0.0f, plane.normal.z / h };
                record->flags = 1u;
            }
        }
        visit->count += 1;
    }
    return true;
}

// Moves an upright capsule by `delta`, sliding along what it meets: up to `iterations` rounds of gathering the
// collision planes around the capsule, solving for the closest allowed translation, and casting the capsule along it
// so that it cannot pass through thin geometry. Reads the world only. Returns 1; -1 for an unknown or empty world;
// -2 for bad input; -5 for a stale ignored body.
B3W_EXPORT int b3w_world_mover_move(uint32_t handle, const B3WMoverInput* in, B3WMoverOutput* out)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || ctx->bodySlots == NULL) return -1;
    if (in == NULL || out == NULL) return -2;
    if (!b3w_finite3(in->origin) || !b3w_finite3(in->delta) || !isfinite(in->radius) || !isfinite(in->halfLength) ||
        !isfinite(in->minGroundY) || !isfinite(in->tolerance)) return -2;
    if (!(in->radius > 0.0f) || !(in->halfLength >= 0.0025f) || in->tolerance < 0.0f || in->iterations < 1u || in->iterations > 16u ||
        in->bodyTypes > 7u || in->flags > 1u || in->reserved != 0u) return -2;
    for (int k = 0; k < 3; ++k) if (fabsf(in->origin[k]) > 1000000.0f || fabsf(in->delta[k]) > 1000000.0f) return -2;
    if (in->ignoreBody != 0u && b3w_ctx_body_index(ctx, in->ignoreBody) < 0) return -5;

    static B3WMoverVisit visit; // 1.3 kB of planes; the bridge runs one call at a time
    visit.ctx = ctx; visit.input = in; visit.count = 0;
    b3QueryFilter filter = b3DefaultQueryFilter();
    filter.categoryBits = in->categoryBits; filter.maskBits = in->maskBits;
    const b3Capsule capsule = { { 0.0f, -in->halfLength, 0.0f }, { 0.0f, in->halfLength, 0.0f }, in->radius };
    b3Pos p = { in->origin[0], in->origin[1], in->origin[2] };
    const b3Vec3 target = { in->origin[0] + in->delta[0], in->origin[1] + in->delta[1], in->origin[2] + in->delta[2] };
    b3Pos planeOrigin = p;
    float fraction = 1.0f;
    uint32_t iterations = 0u, solverIterations = 0u;
    for (uint32_t i = 0; i < in->iterations; ++i)
    {
        iterations += 1u;
        visit.count = 0;
        planeOrigin = p;
        if (in->bodyTypes != 0u) b3World_CollideMover(ctx->world, p, &capsule, filter, b3w_mover_planes, &visit);
        const b3Vec3 targetDelta = { target.x - (float)p.x, target.y - (float)p.y, target.z - (float)p.z };
        const b3PlaneSolverResult solved = b3SolvePlanes(targetDelta, visit.planes, visit.count);
        solverIterations += (uint32_t)solved.iterationCount;
        b3Vec3 d = solved.delta;
        fraction = 1.0f;
        if (in->bodyTypes != 0u && (d.x != 0.0f || d.y != 0.0f || d.z != 0.0f))
        {
            fraction = b3World_CastMover(ctx->world, p, &capsule, d, filter, b3w_mover_filter, &visit);
        }
        d.x *= fraction; d.y *= fraction; d.z *= fraction;
        p = (b3Pos){ (float)p.x + d.x, (float)p.y + d.y, (float)p.z + d.z };
        if (d.x * d.x + d.y * d.y + d.z * d.z < in->tolerance * in->tolerance) break;
    }
    memset(out, 0, sizeof(*out));
    out->position[0] = (float)p.x; out->position[1] = (float)p.y; out->position[2] = (float)p.z;
    out->fraction = fraction;
    out->iterations = iterations;
    out->solverIterations = solverIterations;
    out->planeCount = (uint32_t)visit.count;
    for (int i = 0; i < visit.count; ++i)
    {
        B3WMoverPlane* record = visit.records + i;
        record->point[0] += (float)planeOrigin.x; record->point[1] += (float)planeOrigin.y; record->point[2] += (float)planeOrigin.z;
        record->push = visit.planes[i].push;
        out->planes[i] = *record;
    }
    return 1;
}

// --- World and body controls. ---

// id 0 sleeping (a: 0/1), 1 continuous collision (a), 2 speculative contact margin (a), 3 warm starting (a),
// 4 restitution threshold (a, m/s), 5 hit-event threshold (a, m/s), 6 contact tuning (a hertz, b damping ratio,
// c push-out speed m/s), 7 maximum linear speed (a, m/s), 8 contact recycle distance (a, m).
// Returns 1; -1 for an unknown or empty world; -2 for an unknown id or a bad value.
B3W_EXPORT int b3w_world_set_param(uint32_t handle, uint32_t id, float a, float b, float c)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world)) return -1;
    if (!isfinite(a) || !isfinite(b) || !isfinite(c)) return -2;
    switch (id)
    {
        case 0u: b3World_EnableSleeping(ctx->world, a != 0.0f); break;
        case 1u: b3World_EnableContinuous(ctx->world, a != 0.0f); break;
        case 2u: b3World_EnableSpeculative(ctx->world, a != 0.0f); break;
        case 3u: b3World_EnableWarmStarting(ctx->world, a != 0.0f); break;
        case 4u: if (a < 0.0f) return -2; b3World_SetRestitutionThreshold(ctx->world, a); break;
        case 5u: if (a < 0.0f) return -2; b3World_SetHitEventThreshold(ctx->world, a); break;
        case 6u: if (a < 0.0f || b < 0.0f || c < 0.0f) return -2; b3World_SetContactTuning(ctx->world, a, b, c); break;
        case 7u: if (!(a > 0.0f)) return -2; b3World_SetMaximumLinearSpeed(ctx->world, a); break;
        case 8u: if (a < 0.0f) return -2; b3World_SetContactRecycleDistance(ctx->world, a); break;
        default: return -2;
    }
    // A sleeping island must meet the new rule on its next step.
    for (int i = 0; i < ctx->dynamicCount; ++i) b3Body_SetAwake(ctx->bodies[ctx->dynamicIndices[i]].id, true);
    return 1;
}

// out12: sleeping, continuous, speculative, warm starting, restitution threshold, hit-event threshold,
// contact hertz, contact damping ratio, contact push-out speed, maximum linear speed, contact recycle distance, 0.
B3W_EXPORT int b3w_world_get_params(uint32_t handle, float* out12)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || out12 == NULL) return -1;
    float tuning[4] = { 0.0f, 0.0f, 0.0f, 1.0f };
    b3w_snapshot_tuning(ctx->world, tuning);
    out12[0] = b3World_IsSleepingEnabled(ctx->world) ? 1.0f : 0.0f;
    out12[1] = b3World_IsContinuousEnabled(ctx->world) ? 1.0f : 0.0f;
    out12[2] = tuning[3];
    out12[3] = b3World_IsWarmStartingEnabled(ctx->world) ? 1.0f : 0.0f;
    out12[4] = b3World_GetRestitutionThreshold(ctx->world);
    out12[5] = b3World_GetHitEventThreshold(ctx->world);
    out12[6] = tuning[0]; out12[7] = tuning[1]; out12[8] = tuning[2];
    out12[9] = b3World_GetMaximumLinearSpeed(ctx->world);
    out12[10] = b3World_GetContactRecycleDistance(ctx->world);
    out12[11] = 0.0f;
    return 1;
}

// what 0 bullet (0/1), 1 may sleep (0/1), 2 sleep threshold (m/s), 3 motion locks (bits: 1 linear x, 2 linear y,
// 4 linear z, 8 angular x, 16 angular y, 32 angular z). Returns 1; 0 for a dead body; -2 for bad input.
B3W_EXPORT int b3w_world_set_body_flag(uint32_t worldHandle, uint64_t bodyHandle, uint32_t what, float value)
{
    B3W_BODY(ctx, index)
    if (!isfinite(value) || what > 3u) return -2;
    b3BodyId id = ctx->bodies[index].id;
    if (what == 0u) b3Body_SetBullet(id, value != 0.0f);
    else if (what == 1u) b3Body_EnableSleep(id, value != 0.0f);
    else if (what == 2u) { if (value < 0.0f) return -2; b3Body_SetSleepThreshold(id, value); }
    else
    {
        if (value < 0.0f || value > 63.0f) return -2;
        const uint32_t bits = (uint32_t)value;
        b3MotionLocks locks = { (bits & 1u) != 0u, (bits & 2u) != 0u, (bits & 4u) != 0u, (bits & 8u) != 0u, (bits & 16u) != 0u, (bits & 32u) != 0u };
        b3Body_SetMotionLocks(id, locks);
        // Box3D derives the inverse inertia of a locked body from its mass data; put an explicit one back.
        const B3WMassOverride* mass = b3w_ctx_find_mass(ctx, ctx->bodies[index].slot);
        if (mass != NULL) b3w_ctx_apply_mass(ctx, index, &mass->data);
    }
    b3Body_SetAwake(id, true);
    return 1;
}

// out4: bullet, may sleep, sleep threshold, motion-lock bits.
B3W_EXPORT int b3w_world_get_body_flags(uint32_t worldHandle, uint64_t bodyHandle, float* out4)
{
    B3W_BODY(ctx, index)
    if (out4 == NULL) return -2;
    b3BodyId id = ctx->bodies[index].id;
    const b3MotionLocks locks = b3Body_GetMotionLocks(id);
    out4[0] = b3Body_IsBullet(id) ? 1.0f : 0.0f;
    out4[1] = b3Body_IsSleepEnabled(id) ? 1.0f : 0.0f;
    out4[2] = b3Body_GetSleepThreshold(id);
    out4[3] = (float)((locks.linearX ? 1 : 0) | (locks.linearY ? 2 : 0) | (locks.linearZ ? 4 : 0) | (locks.angularX ? 8 : 0) | (locks.angularY ? 16 : 0) | (locks.angularZ ? 32 : 0));
    return 1;
}

// Box3D's explosion: an impulse on every sphere, capsule and hull shape within radius + falloff, proportional to
// the shape area facing the centre (impulsePerArea, N s / m^2; negative pulls inwards), fading linearly to zero
// across the falloff distance. Returns 1; -1 for an unknown or empty world; -2 for bad values.
B3W_EXPORT int b3w_world_explode_area(uint32_t handle, float x, float y, float z, float radius, float falloff, float impulsePerArea, uint64_t maskBits)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world)) return -1;
    if (!isfinite(x) || !isfinite(y) || !isfinite(z) || !isfinite(radius) || !isfinite(falloff) || !isfinite(impulsePerArea) || radius < 0.0f || falloff < 0.0f) return -2;
    b3ExplosionDef def = b3DefaultExplosionDef();
    def.maskBits = maskBits;
    def.position = (b3Pos){ x, y, z };
    def.radius = radius;
    def.falloff = falloff;
    def.impulsePerArea = impulsePerArea;
    b3World_Explode(ctx->world, &def);
    return 1;
}

// outProfile: 23 floats, milliseconds of the most recent step by stage, in b3Profile order (step, pairs, collide,
// solve, solverSetup, constraints, prepareConstraints, integrateVelocities, warmStart, solveImpulses,
// integratePositions, relaxImpulses, applyRestitution, storeImpulses, splitIslands, transforms, sensorHits,
// jointEvents, hitEvents, refit, bullets, sleepIslands, sensors).
// outCounters: 16 ints: bodies, shapes, contacts, joints, islands, stack bytes used, arena capacity, static tree
// height, dynamic tree height, SAT calls, SAT cache hits, bytes allocated, tasks, awake contacts, recycled
// contacts, awake bodies. Returns 1, or -1 for an unknown or empty world.
B3W_EXPORT int b3w_world_profile(uint32_t handle, float* outProfile, int32_t* outCounters)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || outProfile == NULL || outCounters == NULL) return -1;
    const b3Profile p = b3World_GetProfile(ctx->world);
    const float values[23] = { p.step, p.pairs, p.collide, p.solve, p.solverSetup, p.constraints, p.prepareConstraints, p.integrateVelocities,
        p.warmStart, p.solveImpulses, p.integratePositions, p.relaxImpulses, p.applyRestitution, p.storeImpulses, p.splitIslands, p.transforms,
        p.sensorHits, p.jointEvents, p.hitEvents, p.refit, p.bullets, p.sleepIslands, p.sensors };
    memcpy(outProfile, values, sizeof(values));
    const b3Counters c = b3World_GetCounters(ctx->world);
    const int32_t counters[16] = { c.bodyCount, c.shapeCount, c.contactCount, c.jointCount, c.islandCount, c.stackUsed, c.arenaCapacity,
        c.staticTreeHeight, c.treeHeight, c.satCallCount, c.satCacheHitCount, c.byteCount, c.taskCount, c.awakeContactCount,
        c.recycledContactCount, b3World_GetAwakeBodyCount(ctx->world) };
    memcpy(outCounters, counters, sizeof(counters));
    return 1;
}

// out8: touching contact pairs, manifold points, deepest penetration (m, 0 when nothing overlaps), mean penetration
// over the overlapping points (m), largest normal impulse of one point in the last sub-step (N s), sum of the normal
// impulses of the last sub-step (N s; divide by the sub-step length for the force), and two zeros. Read from the manifolds of every moving body; a pair of two moving bodies is counted
// once. Reads the world only. Returns 1; -1 for an unknown or empty world; -3 when memory ran out.
B3W_EXPORT int b3w_world_contact_stats(uint32_t handle, float* out8)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || out8 == NULL) return -1;
    memset(out8, 0, 8u * sizeof(float));
    b3ContactData* buffer = NULL;
    int capacity = 0, pairs = 0, points = 0, overlapping = 0;
    double depthSum = 0.0, impulseSum = 0.0;
    float deepest = 0.0f, largest = 0.0f;
    for (int d = 0; d < ctx->dynamicCount; ++d)
    {
        const b3BodyId body = ctx->bodies[ctx->dynamicIndices[d]].id;
        const int needed = b3Body_GetContactCapacity(body);
        if (needed <= 0) continue;
        if (needed > capacity)
        {
            b3ContactData* grown = (b3ContactData*)realloc(buffer, (size_t)needed * sizeof(b3ContactData));
            if (grown == NULL) { free(buffer); return -3; }
            buffer = grown; capacity = needed;
        }
        const int count = b3Body_GetContactData(body, buffer, capacity);
        for (int i = 0; i < count; ++i)
        {
            const b3ContactData* contact = buffer + i;
            const b3BodyId a = b3Shape_GetBody(contact->shapeIdA), b = b3Shape_GetBody(contact->shapeIdB);
            const b3BodyId other = a.index1 == body.index1 ? b : a;
            // A pair of two moving bodies is listed under both: count it under the one with the smaller index.
            if (b3Body_GetType(other) != b3_staticBody && other.index1 < body.index1) continue;
            int touching = 0;
            for (int m = 0; m < contact->manifoldCount; ++m)
            {
                const b3Manifold* manifold = contact->manifolds + m;
                for (int k = 0; k < manifold->pointCount; ++k)
                {
                    const b3ManifoldPoint* point = manifold->points + k;
                    points += 1; touching = 1;
                    if (point->separation < 0.0f) { overlapping += 1; depthSum += (double)-point->separation; if (-point->separation > deepest) deepest = -point->separation; }
                    // normalImpulse is the accumulated impulse of the last sub-step; Box3D's totalNormalImpulse adds
                    // the solve and the relax pass of every sub-step and is not a physical impulse.
                    impulseSum += (double)point->normalImpulse;
                    if (point->normalImpulse > largest) largest = point->normalImpulse;
                }
            }
            pairs += touching;
        }
    }
    free(buffer);
    out8[0] = (float)pairs; out8[1] = (float)points; out8[2] = deepest;
    out8[3] = overlapping > 0 ? (float)(depthSum / (double)overlapping) : 0.0f;
    out8[4] = largest; out8[5] = (float)impulseSum;
    return 1;
}

// --- Debug draw: Box3D's own drawing of joints, contacts, bounds, mass centres and islands, as line vertices. ---

#define B3W_DEBUG_VERTEX_LIMIT 1048576

static void b3w_debug_vertex(B3WContext* ctx, float x, float y, float z, uint32_t color)
{
    ctx->debugTotal += 1;
    if (ctx->debugCount >= ctx->debugCapacity)
    {
        if (ctx->debugCapacity >= B3W_DEBUG_VERTEX_LIMIT) return;
        const int capacity = ctx->debugCapacity == 0 ? 4096 : ctx->debugCapacity * 4;
        float* list = (float*)realloc(ctx->debugVertices, (size_t)capacity * 4u * sizeof(float));
        if (list == NULL) return;
        ctx->debugVertices = list;
        ctx->debugCapacity = capacity;
    }
    float* v = ctx->debugVertices + (size_t)ctx->debugCount * 4u;
    v[0] = x; v[1] = y; v[2] = z; v[3] = (float)(color & 0xFFFFFFu);
    ctx->debugCount += 1;
}

static void b3w_debug_line(B3WContext* ctx, b3Vec3 a, b3Vec3 b, uint32_t color)
{
    // Keep pairs whole: a line is added only when both of its ends fit.
    if (ctx->debugCount + 2 > B3W_DEBUG_VERTEX_LIMIT) { ctx->debugTotal += 2; return; }
    const int before = ctx->debugCount;
    b3w_debug_vertex(ctx, a.x, a.y, a.z, color);
    b3w_debug_vertex(ctx, b.x, b.y, b.z, color);
    if (ctx->debugCount != before + 2) ctx->debugCount = before;
}

static void b3w_debug_circle(B3WContext* ctx, b3Vec3 c, b3Vec3 u, b3Vec3 v, float radius, uint32_t color)
{
    b3Vec3 previous = { c.x + u.x * radius, c.y + u.y * radius, c.z + u.z * radius };
    for (int i = 1; i <= 16; ++i)
    {
        const float angle = (float)i * (6.28318531f / 16.0f), ca = cosf(angle) * radius, sa = sinf(angle) * radius;
        const b3Vec3 next = { c.x + u.x * ca + v.x * sa, c.y + u.y * ca + v.y * sa, c.z + u.z * ca + v.z * sa };
        b3w_debug_line(ctx, previous, next, color);
        previous = next;
    }
}

static bool b3w_debug_shape(void* userShape, b3WorldTransform transform, b3HexColor color, void* context)
{
    (void)userShape; (void)transform; (void)color; (void)context;
    return true;
}
static void b3w_debug_segment(b3Pos p1, b3Pos p2, b3HexColor color, void* context)
{
    b3w_debug_line((B3WContext*)context, (b3Vec3){ (float)p1.x, (float)p1.y, (float)p1.z }, (b3Vec3){ (float)p2.x, (float)p2.y, (float)p2.z }, (uint32_t)color);
}
static void b3w_debug_transform(b3WorldTransform xf, void* context)
{
    B3WContext* ctx = (B3WContext*)context;
    const b3Vec3 o = { (float)xf.p.x, (float)xf.p.y, (float)xf.p.z };
    const float s = 0.15f;
    const b3Vec3 x = b3w_rotate(xf.q, (b3Vec3){ s, 0.0f, 0.0f }), y = b3w_rotate(xf.q, (b3Vec3){ 0.0f, s, 0.0f }), z = b3w_rotate(xf.q, (b3Vec3){ 0.0f, 0.0f, s });
    b3w_debug_line(ctx, o, (b3Vec3){ o.x + x.x, o.y + x.y, o.z + x.z }, 0xFF4040u);
    b3w_debug_line(ctx, o, (b3Vec3){ o.x + y.x, o.y + y.y, o.z + y.z }, 0x40FF40u);
    b3w_debug_line(ctx, o, (b3Vec3){ o.x + z.x, o.y + z.y, o.z + z.z }, 0x4080FFu);
}
static void b3w_debug_point(b3Pos p, float size, b3HexColor color, void* context)
{
    B3WContext* ctx = (B3WContext*)context;
    const float h = 0.004f * (size > 0.0f ? size : 1.0f);
    const b3Vec3 c = { (float)p.x, (float)p.y, (float)p.z };
    b3w_debug_line(ctx, (b3Vec3){ c.x - h, c.y, c.z }, (b3Vec3){ c.x + h, c.y, c.z }, (uint32_t)color);
    b3w_debug_line(ctx, (b3Vec3){ c.x, c.y - h, c.z }, (b3Vec3){ c.x, c.y + h, c.z }, (uint32_t)color);
    b3w_debug_line(ctx, (b3Vec3){ c.x, c.y, c.z - h }, (b3Vec3){ c.x, c.y, c.z + h }, (uint32_t)color);
}
static void b3w_debug_sphere(b3Pos p, float radius, b3HexColor color, float alpha, void* context)
{
    (void)alpha;
    B3WContext* ctx = (B3WContext*)context;
    const b3Vec3 c = { (float)p.x, (float)p.y, (float)p.z };
    const b3Vec3 x = { 1.0f, 0.0f, 0.0f }, y = { 0.0f, 1.0f, 0.0f }, z = { 0.0f, 0.0f, 1.0f };
    b3w_debug_circle(ctx, c, x, y, radius, (uint32_t)color);
    b3w_debug_circle(ctx, c, y, z, radius, (uint32_t)color);
    b3w_debug_circle(ctx, c, z, x, radius, (uint32_t)color);
}
static void b3w_debug_capsule(b3Pos p1, b3Pos p2, float radius, b3HexColor color, float alpha, void* context)
{
    b3w_debug_sphere(p1, radius, color, alpha, context);
    b3w_debug_sphere(p2, radius, color, alpha, context);
    b3w_debug_segment(p1, p2, color, context);
}
static void b3w_debug_box_edges(B3WContext* ctx, const b3Vec3* corners, uint32_t color)
{
    static const int edges[12][2] = { {0,1},{2,3},{4,5},{6,7},{0,2},{1,3},{4,6},{5,7},{0,4},{1,5},{2,6},{3,7} };
    for (int i = 0; i < 12; ++i) b3w_debug_line(ctx, corners[edges[i][0]], corners[edges[i][1]], color);
}
static void b3w_debug_bounds(b3AABB aabb, b3HexColor color, void* context)
{
    b3Vec3 corners[8];
    for (int i = 0; i < 8; ++i) corners[i] = (b3Vec3){ (i & 1) ? aabb.upperBound.x : aabb.lowerBound.x, (i & 2) ? aabb.upperBound.y : aabb.lowerBound.y, (i & 4) ? aabb.upperBound.z : aabb.lowerBound.z };
    b3w_debug_box_edges((B3WContext*)context, corners, (uint32_t)color);
}
static void b3w_debug_box(b3Vec3 extents, b3WorldTransform xf, b3HexColor color, void* context)
{
    b3Vec3 corners[8];
    for (int i = 0; i < 8; ++i)
    {
        const b3Vec3 local = { (i & 1) ? extents.x : -extents.x, (i & 2) ? extents.y : -extents.y, (i & 4) ? extents.z : -extents.z };
        const b3Vec3 r = b3w_rotate(xf.q, local);
        corners[i] = (b3Vec3){ (float)xf.p.x + r.x, (float)xf.p.y + r.y, (float)xf.p.z + r.z };
    }
    b3w_debug_box_edges((B3WContext*)context, corners, (uint32_t)color);
}
static void b3w_debug_string(b3Pos p, const char* s, b3HexColor color, void* context)
{
    (void)p; (void)s; (void)color; (void)context;
}

// flags: 1 joints, 2 joint extras (frames, limits), 4 shape bounds, 8 mass centres, 16 contact points,
// 32 contact normals, 64 contact forces, 128 friction forces, 256 islands, 512 colour contacts by solver colour.
// bounds6 (may be NULL): lower xyz and upper xyz of the region to draw. Writes line vertices (pairs) into a
// buffer the world owns (b3w_world_debug_ptr: x, y, z, 0xRRGGBB as a float) and returns how many it holds;
// b3w_world_debug_total reports how many there were, so a caller can tell when the 1,048,576-vertex limit cut it.
// Reads the world only. -1 for an unknown or empty world, -2 for bad input.
B3W_EXPORT int b3w_world_debug_draw(uint32_t handle, uint32_t flags, float jointScale, float forceScale, const float* bounds6)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world)) return -1;
    if (flags > 1023u || !isfinite(jointScale) || !isfinite(forceScale) || jointScale < 0.0f || forceScale < 0.0f) return -2;
    b3DebugDraw draw = b3DefaultDebugDraw();
    draw.DrawShapeFcn = b3w_debug_shape;
    draw.DrawSegmentFcn = b3w_debug_segment;
    draw.DrawTransformFcn = b3w_debug_transform;
    draw.DrawPointFcn = b3w_debug_point;
    draw.DrawSphereFcn = b3w_debug_sphere;
    draw.DrawCapsuleFcn = b3w_debug_capsule;
    draw.DrawBoundsFcn = b3w_debug_bounds;
    draw.DrawBoxFcn = b3w_debug_box;
    draw.DrawStringFcn = b3w_debug_string;
    draw.context = ctx;
    draw.drawingBounds = (b3AABB){ { -1.0e6f, -1.0e6f, -1.0e6f }, { 1.0e6f, 1.0e6f, 1.0e6f } };
    if (bounds6 != NULL)
    {
        for (int i = 0; i < 6; ++i) if (!isfinite(bounds6[i])) return -2;
        if (bounds6[0] > bounds6[3] || bounds6[1] > bounds6[4] || bounds6[2] > bounds6[5]) return -2;
        draw.drawingBounds = (b3AABB){ { bounds6[0], bounds6[1], bounds6[2] }, { bounds6[3], bounds6[4], bounds6[5] } };
    }
    if (jointScale > 0.0f) draw.jointScale = jointScale;
    if (forceScale > 0.0f) draw.forceScale = forceScale;
    draw.drawShapes = false;
    draw.drawBodyNames = false;
    draw.drawContactFeatures = false;
    draw.drawJoints = (flags & 1u) != 0u;
    draw.drawJointExtras = (flags & 2u) != 0u;
    draw.drawBounds = (flags & 4u) != 0u;
    draw.drawMass = (flags & 8u) != 0u;
    draw.drawContacts = (flags & 16u) != 0u;
    draw.drawContactNormals = (flags & 32u) != 0u;
    draw.drawContactForces = (flags & 64u) != 0u;
    draw.drawFrictionForces = (flags & 128u) != 0u;
    draw.drawIslands = (flags & 256u) != 0u;
    draw.drawGraphColors = (flags & 512u) != 0u;
    ctx->debugCount = 0;
    ctx->debugTotal = 0;
    b3World_Draw(ctx->world, &draw, UINT64_MAX);
    return ctx->debugCount;
}

B3W_EXPORT uintptr_t b3w_world_debug_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->debugVertices : 0u;
}

B3W_EXPORT int b3w_world_debug_total(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? ctx->debugTotal : -1;
}

// ---------------------------------------------------------------------------
// Exact checkpoints. A checkpoint holds this world's body table (handles, rows,
// render streams, kinds, mass overrides, RNG) and Box3D's own complete snapshot
// of the simulation state (box3d_snapshot.c). Restoring it into a world of the
// same build makes every later step bit-identical to the uninterrupted run.
// ---------------------------------------------------------------------------

#define B3W_CHECKPOINT_MAGIC 0x43573342u // 'B3WC'
#define B3W_CHECKPOINT_VERSION 1u
#define B3W_CHECKPOINT_HEADER 48

typedef struct B3WCheckpointHeader
{
    uint32_t magic, version, flags;
    int32_t bodyCount, dynamicCount, slotsUsed, freeSlot, capacity, massOverrideCount;
    uint32_t rng;
    b3BodyId anchor;
} B3WCheckpointHeader;
_Static_assert(sizeof(B3WCheckpointHeader) == B3W_CHECKPOINT_HEADER, "Checkpoint header must be 48 bytes");
_Static_assert(sizeof(B3WBody) == 36 && sizeof(B3WBodySlot) == 16, "Checkpoint body rows must have no padding");

static size_t b3w_checkpoint_table_bytes(const B3WCheckpointHeader* h)
{
    return (size_t)h->bodyCount * (sizeof(B3WBody) + 16u * sizeof(float) + 4u * sizeof(float) + ((h->flags & 1u) != 0u ? 1u : 0u))
        + (size_t)h->dynamicCount * sizeof(int) + (size_t)h->slotsUsed * sizeof(B3WBodySlot)
        + (size_t)h->massOverrideCount * sizeof(struct B3WMassOverride);
}

// Writes a checkpoint of the world into a buffer the world owns and returns its length in bytes:
// read it at b3w_world_checkpoint_ptr before the next call. -1 for an unknown or empty world, -3 when memory ran out.
B3W_EXPORT int b3w_world_checkpoint(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || ctx->bodySlots == NULL) return -1;
    free(ctx->checkpoint);
    ctx->checkpoint = NULL;
    ctx->checkpointSize = 0;
    int snapshotSize = 0;
    uint8_t* snapshot = b3w_snapshot_capture(ctx->world, &snapshotSize);
    if (snapshot == NULL) return -3;
    B3WCheckpointHeader h;
    memset(&h, 0, sizeof(h));
    h.magic = B3W_CHECKPOINT_MAGIC; h.version = B3W_CHECKPOINT_VERSION; h.flags = ctx->kinds != NULL ? 1u : 0u;
    // Joint flags (breakable joints): only the entries of live joints, so that equal states give equal bytes.
    int jointFlagCount = 0;
    {
        const uint16_t world0 = (uint16_t)(ctx->world.index1 - 1);
        for (int i = 0; i < ctx->jointFlagCapacity; ++i)
        {
            const uint32_t entry = ctx->jointFlags[i];
            if (entry == 0u) continue;
            const b3JointId id = { i + 1, world0, (uint16_t)(entry >> 8) };
            if (!b3Joint_IsValid(id)) { ctx->jointFlags[i] = 0u; continue; }
            jointFlagCount = i + 1;
        }
    }
    if (jointFlagCount > 0) h.flags |= 4u;
    const size_t jointBytes = jointFlagCount > 0 ? 4u + (size_t)jointFlagCount * sizeof(uint32_t) : 0u;
    h.bodyCount = ctx->bodyCount; h.dynamicCount = ctx->dynamicCount; h.slotsUsed = ctx->slotsUsed; h.freeSlot = ctx->freeSlot;
    h.capacity = ctx->capacity; h.massOverrideCount = ctx->massOverrideCount; h.rng = ctx->rng; h.anchor = ctx->anchor;
    const size_t table = b3w_checkpoint_table_bytes(&h), total = sizeof(h) + table + jointBytes + 4u + (size_t)snapshotSize;
    uint8_t* out = total <= 0x7FFFFFFFu ? (uint8_t*)malloc(total) : NULL;
    if (out == NULL) { free(snapshot); return -3; }
    uint8_t* p = out;
    memcpy(p, &h, sizeof(h)); p += sizeof(h);
    memcpy(p, ctx->bodies, (size_t)h.bodyCount * sizeof(B3WBody)); p += (size_t)h.bodyCount * sizeof(B3WBody);
    memcpy(p, ctx->dynamicIndices, (size_t)h.dynamicCount * sizeof(int)); p += (size_t)h.dynamicCount * sizeof(int);
    memcpy(p, ctx->bodySlots, (size_t)h.slotsUsed * sizeof(B3WBodySlot)); p += (size_t)h.slotsUsed * sizeof(B3WBodySlot);
    memcpy(p, ctx->matrices, (size_t)h.bodyCount * 16u * sizeof(float)); p += (size_t)h.bodyCount * 16u * sizeof(float);
    memcpy(p, ctx->colors, (size_t)h.bodyCount * 4u * sizeof(float)); p += (size_t)h.bodyCount * 4u * sizeof(float);
    if ((h.flags & 1u) != 0u) { memcpy(p, ctx->kinds, (size_t)h.bodyCount); p += h.bodyCount; }
    memcpy(p, ctx->massOverrides, (size_t)h.massOverrideCount * sizeof(struct B3WMassOverride)); p += (size_t)h.massOverrideCount * sizeof(struct B3WMassOverride);
    if (jointFlagCount > 0)
    {
        const int32_t count32 = jointFlagCount;
        memcpy(p, &count32, 4u); p += 4;
        memcpy(p, ctx->jointFlags, (size_t)jointFlagCount * sizeof(uint32_t)); p += (size_t)jointFlagCount * sizeof(uint32_t);
    }
    const uint32_t size32 = (uint32_t)snapshotSize;
    memcpy(p, &size32, 4u); p += 4;
    memcpy(p, snapshot, (size_t)snapshotSize);
    free(snapshot);
    // The world ids in the body table name this world; a restore rewrites them for the world it lands in.
    ctx->checkpoint = out;
    ctx->checkpointSize = (int)total;
    return ctx->checkpointSize;
}

B3W_EXPORT uintptr_t b3w_world_checkpoint_ptr(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    return ctx != NULL ? (uintptr_t)ctx->checkpoint : 0u;
}

// Frees the buffer of the last checkpoint. Returns 1, or -1 for an unknown world.
B3W_EXPORT int b3w_world_checkpoint_free(uint32_t handle)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL) return -1;
    free(ctx->checkpoint);
    ctx->checkpoint = NULL;
    ctx->checkpointSize = 0;
    return 1;
}

// Replaces the world's state with a checkpoint that b3w_world_checkpoint wrote in a module of the same build.
// Returns 1; -1 for an unknown or empty world; -2 for bytes that are not such a checkpoint (nothing is changed);
// -3 when memory ran out (nothing is changed); -4 when Box3D refused the snapshot after it began to overwrite
// the world, which is then reset to an empty world without bodies.
B3W_EXPORT int b3w_world_restore(uint32_t handle, const uint8_t* data, int size)
{
    B3WContext* ctx = b3w_lookup_context(handle);
    if (ctx == NULL || B3_IS_NULL(ctx->world) || ctx->bodySlots == NULL) return -1;
    if (data == NULL || size < B3W_CHECKPOINT_HEADER + 4) return -2;
    B3WCheckpointHeader h;
    memcpy(&h, data, sizeof(h));
    if (h.magic != B3W_CHECKPOINT_MAGIC || h.version != B3W_CHECKPOINT_VERSION || (h.flags & ~5u) != 0u) return -2;
    if (h.bodyCount < 0 || h.dynamicCount < 0 || h.dynamicCount > h.bodyCount || h.slotsUsed < h.bodyCount || h.massOverrideCount < 0) return -2;
    if (h.capacity < 1 || h.capacity > B3W_BODY_CAPACITY_LIMIT || h.slotsUsed > h.capacity || h.freeSlot < -1 || h.freeSlot >= h.slotsUsed) return -2;
    const size_t table = b3w_checkpoint_table_bytes(&h);
    if ((size_t)size < sizeof(h) + table + 4u) return -2;
    const uint8_t* p = data + sizeof(h);
    const B3WBody* bodies = (const B3WBody*)p; p += (size_t)h.bodyCount * sizeof(B3WBody);
    const uint8_t* dynamicIndices = p; p += (size_t)h.dynamicCount * sizeof(int);
    const uint8_t* bodySlots = p; p += (size_t)h.slotsUsed * sizeof(B3WBodySlot);
    const uint8_t* matrices = p; p += (size_t)h.bodyCount * 16u * sizeof(float);
    const uint8_t* colors = p; p += (size_t)h.bodyCount * 4u * sizeof(float);
    const uint8_t* kinds = NULL;
    if ((h.flags & 1u) != 0u) { kinds = p; p += h.bodyCount; }
    const uint8_t* massOverrides = p; p += (size_t)h.massOverrideCount * sizeof(struct B3WMassOverride);
    const uint8_t* jointFlags = NULL;
    int32_t jointFlagCount = 0;
    if ((h.flags & 4u) != 0u)
    {
        if ((size_t)(data + size - p) < 8u) return -2;
        memcpy(&jointFlagCount, p, 4u); p += 4;
        if (jointFlagCount < 1 || jointFlagCount > 16777216 || (size_t)(data + size - p) < (size_t)jointFlagCount * sizeof(uint32_t) + 4u) return -2;
        jointFlags = p; p += (size_t)jointFlagCount * sizeof(uint32_t);
    }
    uint32_t snapshotSize;
    memcpy(&snapshotSize, p, 4u); p += 4;
    if ((uint64_t)snapshotSize != (uint64_t)(data + size - p)) return -2;
    if (b3w_snapshot_check(p, (int)snapshotSize) == 0) return -2;
    for (int i = 0; i < h.bodyCount; ++i)
    {
        B3WBody row;
        memcpy(&row, bodies + i, sizeof(row));
        if (row.slot < 0 || row.slot >= h.slotsUsed) return -2;
    }

    // Everything that can fail without touching the world comes first.
    if (h.capacity > ctx->capacity && b3w_ctx_reserve(ctx, h.capacity) < 0) return -3;
    if (kinds != NULL && ctx->kinds == NULL)
    {
        ctx->kinds = (uint8_t*)calloc((size_t)ctx->capacity, 1u);
        if (ctx->kinds == NULL) return -3;
    }
    if (h.massOverrideCount > ctx->massOverrideCapacity)
    {
        struct B3WMassOverride* list = (struct B3WMassOverride*)realloc(ctx->massOverrides, (size_t)h.massOverrideCount * sizeof(struct B3WMassOverride));
        if (list == NULL) return -3;
        ctx->massOverrides = list;
        ctx->massOverrideCapacity = h.massOverrideCount;
    }
    if (jointFlagCount > ctx->jointFlagCapacity)
    {
        uint32_t* list = (uint32_t*)realloc(ctx->jointFlags, (size_t)jointFlagCount * sizeof(uint32_t));
        if (list == NULL) return -3;
        memset(list + ctx->jointFlagCapacity, 0, (size_t)(jointFlagCount - ctx->jointFlagCapacity) * sizeof(uint32_t));
        ctx->jointFlags = list;
        ctx->jointFlagCapacity = jointFlagCount;
    }

    void* holder = b3w_snapshot_restore(ctx->world, p, (int)snapshotSize);
    if (holder == NULL)
    {
        b3w_ctx_destroy_world(ctx);
        b3WorldDef worldDef = b3DefaultWorldDef();
        worldDef.gravity = (b3Vec3){ 0.0f, -9.81f, 0.0f };
        worldDef.workerCount = 1;
        worldDef.enableSleep = true;
        worldDef.enableContinuous = true;
        ctx->world = b3CreateWorld(&worldDef);
        return -4;
    }
    // The restored mesh and height-field shapes borrow the holder's geometry; the bridge's own copies are unused now.
    b3w_ctx_free_geometry(ctx, -1);
    b3w_snapshot_release(ctx->snapshotHolder);
    ctx->snapshotHolder = holder;

    const uint16_t world0 = (uint16_t)(ctx->world.index1 - 1);
    // Body handles belong to the world they were made in. When this world's rows are the checkpoint's first rows (it
    // was built the same way, as a scene load does; the checkpoint may have more bodies, added later at the end), every
    // row this world has keeps the handle it has here and each added row gets a new slot here: the rows take the
    // checkpoint's simulation data and this world's slots, so the handles its caller holds stay valid even when the
    // world was used before and its slots carry other generations. Otherwise the checkpoint's whole handle table is
    // taken, and the bodies have the handles they had where the checkpoint was written.
    const int existing = ctx->bodyCount;
    int freeAfter = 0;
    for (int f = ctx->freeSlot; f >= 0 && freeAfter <= h.bodyCount; f = ctx->bodySlots[f].nextFree) ++freeAfter;
    const int keepHandles = existing <= h.bodyCount && (h.bodyCount - existing) <= freeAfter + (ctx->capacity - ctx->slotsUsed);
    if (keepHandles)
    {
        for (int i = 0; i < h.bodyCount; ++i)
        {
            B3WBody row;
            memcpy(&row, bodies + i, sizeof(row));
            row.slot = i < existing ? ctx->bodies[i].slot : b3w_ctx_allocate_body_slot(ctx, i);
            ctx->bodies[i] = row;
        }
        int written = 0;
        for (int k = 0; k < h.massOverrideCount; ++k)
        {
            struct B3WMassOverride entry;
            memcpy(&entry, massOverrides + (size_t)k * sizeof(entry), sizeof(entry));
            if (entry.slot < 0 || entry.slot >= h.slotsUsed) continue;
            B3WBodySlot savedSlot;
            memcpy(&savedSlot, bodySlots + (size_t)entry.slot * sizeof(B3WBodySlot), sizeof(savedSlot));
            if (savedSlot.denseIndex < 0 || savedSlot.denseIndex >= h.bodyCount) continue;
            entry.slot = ctx->bodies[savedSlot.denseIndex].slot;
            ctx->massOverrides[written++] = entry;
        }
        ctx->massOverrideCount = written;
    }
    else
    {
        // Rows the restored table no longer uses are cleared, as a destroy leaves them.
        if (ctx->bodyCount > h.bodyCount)
        {
            memset(ctx->bodies + h.bodyCount, 0, (size_t)(ctx->bodyCount - h.bodyCount) * sizeof(B3WBody));
            memset(ctx->matrices + (size_t)h.bodyCount * 16u, 0, (size_t)(ctx->bodyCount - h.bodyCount) * 16u * sizeof(float));
            memset(ctx->colors + (size_t)h.bodyCount * 4u, 0, (size_t)(ctx->bodyCount - h.bodyCount) * 4u * sizeof(float));
            if (ctx->kinds != NULL) memset(ctx->kinds + h.bodyCount, 0, (size_t)(ctx->bodyCount - h.bodyCount));
        }
        memcpy(ctx->bodies, bodies, (size_t)h.bodyCount * sizeof(B3WBody));
        memcpy(ctx->bodySlots, bodySlots, (size_t)h.slotsUsed * sizeof(B3WBodySlot));
        memcpy(ctx->massOverrides, massOverrides, (size_t)h.massOverrideCount * sizeof(struct B3WMassOverride));
        ctx->massOverrideCount = h.massOverrideCount;
        ctx->slotsUsed = h.slotsUsed;
        ctx->freeSlot = h.freeSlot;
    }
    if (ctx->dynamicCount > h.dynamicCount) memset(ctx->dynamicIndices + h.dynamicCount, 0, (size_t)(ctx->dynamicCount - h.dynamicCount) * sizeof(int));
    memcpy(ctx->dynamicIndices, dynamicIndices, (size_t)h.dynamicCount * sizeof(int));
    memcpy(ctx->matrices, matrices, (size_t)h.bodyCount * 16u * sizeof(float));
    memcpy(ctx->colors, colors, (size_t)h.bodyCount * 4u * sizeof(float));
    if (ctx->kinds != NULL)
    {
        if (kinds != NULL) memcpy(ctx->kinds, kinds, (size_t)h.bodyCount);
        else memset(ctx->kinds, 0, (size_t)h.bodyCount);
    }
    ctx->bodyCount = h.bodyCount;
    ctx->dynamicCount = h.dynamicCount;
    ctx->rng = h.rng;
    ctx->anchor = h.anchor;
    if (B3_IS_NON_NULL(ctx->anchor)) ctx->anchor.world0 = world0;
    // Box3D's snapshot leaves body user data empty; the bridge keeps each body's slot there.
    for (int i = 0; i < ctx->bodyCount; ++i)
    {
        ctx->bodies[i].id.world0 = world0;
        b3Body_SetUserData(ctx->bodies[i].id, (void*)(uintptr_t)(ctx->bodies[i].slot + 1));
    }
    if (ctx->jointFlags != NULL) memset(ctx->jointFlags, 0, (size_t)ctx->jointFlagCapacity * sizeof(uint32_t));
    if (jointFlags != NULL) memcpy(ctx->jointFlags, jointFlags, (size_t)jointFlagCount * sizeof(uint32_t));
    ctx->jointRecordCount = 0;
    ctx->eventCount = 0;
    ctx->eventTotal = 0;
    ctx->hashDirty = 1;
    ctx->transformVersion += 1u;
    ctx->colorVersion += 1u;
    if (ctx->queries.version < UINT32_MAX) ctx->queries.version += 1u;
    return 1;
}
