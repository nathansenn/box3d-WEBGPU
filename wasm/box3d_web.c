// Box3D WebGPU AAA Physics Lab bridge
// Keeps upstream Box3D intact and exposes a compact C ABI for browser/WebGPU demos.
// The browser renderer supplies HDR lighting, shadows, post processing, and effects;
// this bridge supplies Box3D-native rigid-body simulation and deterministic transforms.

#include <box3d/box3d.h>

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
    float extent[3]; // sphere radius in x; box half extents
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
        if (q->kind > 5u || q->bodyTypes > 3u || q->reserved != 0u || q->padding != 0u ||
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
        const int zeroCast = q->kind <= 2u && translation.x == 0.0f && translation.y == 0.0f && translation.z == 0.0f;
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
            if (q->kind == 0u) b3World_CastRay(ctx->world, origin, translation, filter, b3w_query_cast_callback, &visit);
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

// Constant-time removal: compact dense rendering rows and repair both lookup
// tables. A body's public generation token does not encode its dense index.
static int b3w_ctx_destroy_body(B3WContext* ctx, uint64_t handle)
{
    int index = b3w_ctx_body_index(ctx, handle);
    if (index < 0) return 0;
    const B3WBody removed = ctx->bodies[index];
    b3DestroyBody(removed.id);
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
    }
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

static void b3w_ctx_step(B3WContext* ctx, float dt, int subSteps)
{
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
