// Box3D WebGPU AAA Physics Lab bridge
// Keeps upstream Box3D intact and exposes a compact C ABI for browser/WebGPU demos.
// The browser renderer supplies HDR lighting, shadows, post processing, and effects;
// this bridge supplies Box3D-native rigid-body simulation and deterministic transforms.

#include <box3d/box3d.h>

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define B3W_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define B3W_EXPORT
#endif

#define B3W_MAX_BODIES 4096

typedef struct B3WBody
{
    b3BodyId id;
    float hx;
    float hy;
    float hz;
    uint32_t color;
    int dynamic;
} B3WBody;

static b3WorldId g_world = { 0 };
static B3WBody g_bodies[B3W_MAX_BODIES];
// Dynamic bodies are appended in the same order as the public body stream.
// Keeping their indices separately lets dynamic-only work skip static scene
// dressing without changing transform slots, impulse order, or the ABI.
static int g_dynamicIndices[B3W_MAX_BODIES];
static int g_bodyCount = 0;
static int g_dynamicCount = 0;
static float g_matrices[B3W_MAX_BODIES * 16];
static float g_colors[B3W_MAX_BODIES * 4];
static uint32_t g_rng = 0xC0FFEEu;
static uint32_t g_hash = 0u;
static int g_hashDirty = 1;
// Independent monotonically increasing stream revisions let the renderer skip
// immutable material uploads while still observing every transform change.
// They intentionally survive world recreation so a new scene can never alias
// the cache key of a prior scene.
static uint32_t g_transformVersion = 1u;
static uint32_t g_colorVersion = 1u;

#define B3W_HULL_CACHE_CAPACITY 8

typedef struct B3WHullCacheEntry
{
    b3BoxHull hull;
    float hx;
    float hy;
    float hz;
    uint32_t stamp;
    int valid;
} B3WHullCacheEntry;

static B3WHullCacheEntry g_hullCache[B3W_HULL_CACHE_CAPACITY];
static int g_cachedHullLast = -1;
static uint32_t g_hullCacheStamp = 0u;

// Forward declarations used by scene recipes. C17 does not permit implicit declarations.
B3W_EXPORT void b3w_explode(float cx, float cy, float cz, float strength, float radius);
B3W_EXPORT int b3w_launch_projectile(float x, float y, float z, float vx, float vy, float vz, float size);

static float b3w_rand01(void)
{
    g_rng = 1664525u * g_rng + 1013904223u;
    return (float)((g_rng >> 8) & 0x00FFFFFFu) / 16777215.0f;
}

static float b3w_rand_range(float lo, float hi)
{
    return lo + (hi - lo) * b3w_rand01();
}

static int b3w_clamp_int(int v, int lo, int hi)
{
    return v < lo ? lo : (v > hi ? hi : v);
}

static void b3w_unpack_rgb(uint32_t rgb, float* out4)
{
    out4[0] = (float)((rgb >> 16) & 0xFFu) / 255.0f;
    out4[1] = (float)((rgb >> 8) & 0xFFu) / 255.0f;
    out4[2] = (float)(rgb & 0xFFu) / 255.0f;
    out4[3] = 1.0f;
}

static void b3w_write_model_matrix(int index, b3Pos p, b3Quat q, float hx, float hy, float hz)
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

    float* m = g_matrices + index * 16;
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
static void b3w_write_axis_aligned_matrix(int index, float x, float y, float z, float hx, float hy, float hz)
{
    float* m = g_matrices + index * 16;
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
static const b3BoxHull* b3w_get_box_hull(float hx, float hy, float hz)
{
    g_hullCacheStamp += 1u;
    if (g_cachedHullLast >= 0)
    {
        B3WHullCacheEntry* last = g_hullCache + g_cachedHullLast;
        if (last->hx == hx && last->hy == hy && last->hz == hz)
        {
            last->stamp = g_hullCacheStamp;
            return &last->hull;
        }
    }

    int replacement = 0;
    uint32_t oldestStamp = UINT32_MAX;
    for (int i = 0; i < B3W_HULL_CACHE_CAPACITY; ++i)
    {
        B3WHullCacheEntry* entry = g_hullCache + i;
        if (i != g_cachedHullLast && entry->valid != 0 && entry->hx == hx && entry->hy == hy && entry->hz == hz)
        {
            entry->stamp = g_hullCacheStamp;
            g_cachedHullLast = i;
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

    B3WHullCacheEntry* entry = g_hullCache + replacement;
    entry->hull = b3MakeBoxHull(hx, hy, hz);
    entry->hx = hx;
    entry->hy = hy;
    entry->hz = hz;
    entry->stamp = g_hullCacheStamp;
    entry->valid = 1;
    g_cachedHullLast = replacement;
    return &entry->hull;
}

static int b3w_add_box_ex(b3BodyType type, float x, float y, float z, float hx, float hy, float hz, uint32_t color, float density, float friction, float restitution)
{
    if (g_bodyCount >= B3W_MAX_BODIES)
    {
        return -1;
    }

    b3BodyDef bodyDef = b3DefaultBodyDef();
    bodyDef.type = type;
    bodyDef.position = (b3Pos){ x, y, z };
    if (type == b3_dynamicBody)
    {
        bodyDef.angularVelocity = (b3Vec3){ b3w_rand_range(-0.20f, 0.20f), b3w_rand_range(-0.15f, 0.15f), b3w_rand_range(-0.20f, 0.20f) };
    }

    b3BodyId body = b3CreateBody(g_world, &bodyDef);

    const b3BoxHull* hull = b3w_get_box_hull(hx, hy, hz);
    b3ShapeDef shapeDef = b3DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.baseMaterial.friction = friction;
    shapeDef.baseMaterial.restitution = restitution;
    shapeDef.baseMaterial.customColor = color;
    b3CreateHullShape(body, &shapeDef, &hull->base);

    int index = g_bodyCount++;
    g_bodies[index].id = body;
    g_bodies[index].hx = hx;
    g_bodies[index].hy = hy;
    g_bodies[index].hz = hz;
    g_bodies[index].color = color;
    g_bodies[index].dynamic = type == b3_dynamicBody ? 1 : 0;
    if (g_bodies[index].dynamic)
    {
        g_dynamicIndices[g_dynamicCount] = index;
        g_dynamicCount += 1;
    }

    b3w_unpack_rgb(color, g_colors + index * 4);
    b3w_write_axis_aligned_matrix(index, x, y, z, hx, hy, hz);
    g_transformVersion += 1u;
    g_colorVersion += 1u;
    g_hashDirty = 1;
    return index;
}

static void b3w_destroy_world(void)
{
    const int hadBodies = g_bodyCount != 0;
    if (B3_IS_NON_NULL(g_world))
    {
        b3DestroyWorld(g_world);
        g_world = b3_nullWorldId;
    }

    g_bodyCount = 0;
    g_dynamicCount = 0;
    g_hash = 0u;
    g_hashDirty = 1;
    // The active stream length is zero now, and every slot in a subsequent
    // scene is overwritten by b3w_add_box_ex before it becomes visible. Do not
    // clear the unused 320 KiB capacity on every scene switch.
    if (hadBodies)
    {
        g_transformVersion += 1u;
        g_colorVersion += 1u;
    }
}

static void b3w_create_world(uint32_t seed)
{
    b3w_destroy_world();
    g_rng = seed == 0u ? 0xC0FFEEu : seed;

    b3WorldDef worldDef = b3DefaultWorldDef();
    worldDef.gravity = (b3Vec3){ 0.0f, -10.0f, 0.0f };
    worldDef.workerCount = 1;
    worldDef.enableSleep = true;
    worldDef.enableContinuous = true;
    g_world = b3CreateWorld(&worldDef);

    b3w_add_box_ex(b3_staticBody, 0.0f, -1.0f, 0.0f, 44.0f, 1.0f, 44.0f, 0x162033u, 0.0f, 0.86f, 0.02f);
}

static void b3w_scene_stack(int stress)
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
                float px = startX + (float)x * sx + b3w_rand_range(-0.014f, 0.014f);
                float py = h + (float)y * sy + b3w_rand_range(-0.005f, 0.005f);
                float pz = startZ + (float)layer * sz + b3w_rand_range(-0.014f, 0.014f);
                b3w_add_box_ex(b3_dynamicBody, px, py, pz, h, h, h, palette[(x + y + layer) % paletteCount], 1.0f, 0.68f, 0.04f);
            }
        }
    }
}

static void b3w_scene_domino(int stress)
{
    const int count = 48 + stress * 34;
    const float radius = 7.0f + (float)stress * 2.6f;
    for (int i = 0; i < count; ++i)
    {
        float t = ((float)i / (float)count) * 6.28318530718f;
        float ring = (i & 1) == 0 ? radius : radius * 0.62f;
        uint32_t color = i % 3 == 0 ? 0x30AEBFu : (i % 3 == 1 ? 0xFFEE8Cu : 0xDC3132u);
        b3w_add_box_ex(b3_dynamicBody, cosf(t) * ring, 1.25f, sinf(t) * ring, 0.07f, 1.25f, 0.42f, color, 0.8f, 0.74f, 0.02f);
    }
}

static void b3w_scene_skyscraper(int stress)
{
    const int levels = 7 + stress * 4;
    const int grid = 3 + stress / 2;
    const float spacing = 1.65f;
    const float halfSpan = ((float)(grid - 1) * spacing) * 0.5f;
    for (int y = 0; y < levels; ++y)
    {
        float levelY = 0.35f + (float)y * 1.05f;
        b3w_add_box_ex(b3_dynamicBody, 0.0f, levelY, 0.0f, halfSpan + 0.85f, 0.08f, halfSpan + 0.85f, y % 2 ? 0x214160u : 0x263B59u, 1.2f, 0.62f, 0.02f);
        for (int x = 0; x < grid; ++x)
        {
            for (int z = 0; z < grid; ++z)
            {
                if (x != 0 && x != grid - 1 && z != 0 && z != grid - 1)
                {
                    continue;
                }
                b3w_add_box_ex(b3_dynamicBody, -halfSpan + (float)x * spacing, levelY + 0.5f, -halfSpan + (float)z * spacing, 0.14f, 0.5f, 0.14f, 0xD8DEE9u, 2.5f, 0.66f, 0.02f);
            }
        }
    }
    int projectile = b3w_add_box_ex(b3_dynamicBody, -22.0f, 4.6f + (float)stress, 0.0f, 0.82f, 0.82f, 0.82f, 0xFFD166u, 8.0f, 0.45f, 0.12f);
    if (projectile >= 0)
    {
        b3Body_ApplyLinearImpulseToCenter(g_bodies[projectile].id, (b3Vec3){ 60.0f + stress * 8.0f, 8.0f, 0.0f }, true);
    }
}

static void b3w_scene_bridge(int stress)
{
    b3w_add_box_ex(b3_staticBody, -10.0f, 1.1f, 0.0f, 1.2f, 1.1f, 3.2f, 0x394150u, 0.0f, 0.8f, 0.02f);
    b3w_add_box_ex(b3_staticBody, 10.0f, 1.1f, 0.0f, 1.2f, 1.1f, 3.2f, 0x394150u, 0.0f, 0.8f, 0.02f);
    const int segments = 12 + stress * 5;
    const float spacing = 20.0f / (float)segments;
    for (int i = 0; i < segments; ++i)
    {
        float x = -10.0f + spacing * ((float)i + 0.5f);
        b3w_add_box_ex(b3_dynamicBody, x, 2.45f + b3w_rand_range(-0.015f, 0.015f), 0.0f, spacing * 0.52f, 0.13f, 1.55f, i % 2 ? 0x30AEBFu : 0x0D8EA7u, 1.5f, 0.78f, 0.02f);
    }
    for (int y = 0; y < 2 + stress; ++y)
    {
        for (int i = 0; i < 6 + stress * 2; ++i)
        {
            b3w_add_box_ex(b3_dynamicBody, -4.0f + (float)i * 0.9f, 3.1f + (float)y * 0.85f, b3w_rand_range(-0.9f, 0.9f), 0.36f, 0.36f, 0.36f, y % 2 ? 0xF97316u : 0xFFEE8Cu, 4.0f, 0.65f, 0.01f);
        }
    }
}

static void b3w_scene_material(int stress)
{
    const uint32_t colors[] = { 0x30AEBFu, 0xDC3132u, 0x8CC924u, 0xFFEE8Cu, 0x7C3AEDu };
    for (int lane = 0; lane < 5; ++lane)
    {
        float z = ((float)lane - 2.0f) * 3.2f;
        float restitution = (float)lane / 5.0f;
        float friction = 0.15f + (float)lane * 0.16f;
        b3w_add_box_ex(b3_staticBody, -10.0f, 2.2f, z, 4.8f, 0.12f, 1.1f, 0x243247u, 0.0f, friction, restitution);
        for (int i = 0; i < 7 + stress * 3; ++i)
        {
            int body = b3w_add_box_ex(b3_dynamicBody, -13.0f + (float)i * 0.8f, 5.2f + (float)i * 0.07f, z + b3w_rand_range(-0.22f, 0.22f), 0.3f, 0.3f, 0.3f, colors[lane], 1.0f, friction, restitution);
            if (body >= 0)
            {
                b3Body_ApplyLinearImpulseToCenter(g_bodies[body].id, (b3Vec3){ 2.0f + (float)lane * 0.8f, 0.0f, 0.0f }, true);
            }
        }
    }
}



static void b3w_scene_cloth_stage(int stress, int variant)
{
    float span = 11.0f + (float)(variant % 3) * 1.4f;
    float top = 10.5f + (float)stress * 0.8f + (variant == 2 ? 4.5f : 0.0f);
    uint32_t postColor = (variant & 1) ? 0x334155u : 0x475569u;
    uint32_t railColor = (variant & 1) ? 0xFFD166u : 0x30AEBFu;
    b3w_add_box_ex(b3_staticBody, -span, top * 0.5f, 0.0f, 0.22f, top * 0.5f, 0.22f, postColor, 0.0f, 0.82f, 0.01f);
    b3w_add_box_ex(b3_staticBody, span, top * 0.5f, 0.0f, 0.22f, top * 0.5f, 0.22f, postColor, 0.0f, 0.82f, 0.01f);
    b3w_add_box_ex(b3_staticBody, 0.0f, top, 0.0f, span, 0.20f, 0.20f, railColor, 0.0f, 0.82f, 0.01f);
    b3w_add_box_ex(b3_staticBody, 0.0f, 0.12f, 0.0f, span + 2.5f, 0.12f, 7.0f, 0x132033u, 0.0f, 0.88f, 0.01f);
    if (variant == 3 || variant == 7)
    {
        float radius = variant == 7 ? 3.1f : 1.7f;
        b3w_add_box_ex(b3_staticBody, 0.0f, 4.4f, 0.0f, radius, radius, radius, 0x15243Bu, 0.0f, 0.45f, 0.05f);
    }
    if (variant == 2)
    {
        b3w_add_box_ex(b3_staticBody, 0.0f, top + 2.1f, 0.0f, 1.6f, 0.42f, 1.6f, 0xFFD166u, 0.0f, 0.70f, 0.02f);
    }
}

static void b3w_scene_rope_stage(int stress, int variant)
{
    float towerHeight = 12.5f + (float)stress * 0.75f;
    float span = (variant == 1 || variant == 6 || variant == 9) ? 16.0f : 9.0f;
    uint32_t towerColor = (variant & 1) ? 0xF97316u : 0x30AEBFu;
    for (int sideIndex = 0; sideIndex < 2; ++sideIndex)
    {
        float side = sideIndex == 0 ? -1.0f : 1.0f;
        b3w_add_box_ex(b3_staticBody, side * span, towerHeight * 0.5f, -2.2f, 0.28f, towerHeight * 0.5f, 0.28f, towerColor, 0.0f, 0.85f, 0.01f);
        b3w_add_box_ex(b3_staticBody, side * span, towerHeight * 0.5f, 2.2f, 0.28f, towerHeight * 0.5f, 0.28f, towerColor, 0.0f, 0.85f, 0.01f);
        b3w_add_box_ex(b3_staticBody, side * span, towerHeight, 0.0f, 0.24f, 0.24f, 2.2f, towerColor, 0.0f, 0.85f, 0.01f);
    }
    b3w_add_box_ex(b3_staticBody, 0.0f, 0.16f, 0.0f, span + 3.0f, 0.16f, 7.5f, 0x111D30u, 0.0f, 0.88f, 0.01f);
    if (variant == 1 || variant == 6)
    {
        const int segments = 11;
        float segmentHalf = span / (float)segments * 0.52f;
        for (int i = 0; i < segments; ++i)
        {
            float x = -span + ((float)i + 0.5f) * (span * 2.0f / (float)segments);
            b3w_add_box_ex(b3_staticBody, x, 3.4f, 0.0f, segmentHalf, 0.14f, 1.7f, (i & 1) ? 0x243A55u : 0x2F4D69u, 0.0f, 0.82f, 0.01f);
        }
    }
    else if (variant == 0 || variant == 2 || variant == 8)
    {
        b3w_add_box_ex(b3_staticBody, 0.0f, towerHeight - 0.3f, 0.0f, span, 0.17f, 0.17f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
        b3w_add_box_ex(b3_staticBody, 0.0f, 2.0f, 0.0f, 3.5f, 0.18f, 3.0f, 0x18263Bu, 0.0f, 0.85f, 0.01f);
    }
}

static void b3w_scene_water_stage(int stress, int variant)
{
    float halfWidth = 16.0f + (float)(variant % 3) * 1.5f;
    float halfDepth = 10.0f + (float)(variant % 2) * 1.5f;
    float wallHeight = (variant == 1 || variant == 5) ? 4.2f : 2.4f;
    b3w_add_box_ex(b3_staticBody, 0.0f, -0.15f, 0.0f, halfWidth, 0.15f, halfDepth, 0x0B1F33u, 0.0f, 0.92f, 0.01f);
    b3w_add_box_ex(b3_staticBody, -halfWidth - 0.25f, wallHeight * 0.5f, 0.0f, 0.25f, wallHeight * 0.5f, halfDepth + 0.5f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_add_box_ex(b3_staticBody, halfWidth + 0.25f, wallHeight * 0.5f, 0.0f, 0.25f, wallHeight * 0.5f, halfDepth + 0.5f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_add_box_ex(b3_staticBody, 0.0f, wallHeight * 0.5f, -halfDepth - 0.25f, halfWidth + 0.5f, wallHeight * 0.5f, 0.25f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    b3w_add_box_ex(b3_staticBody, 0.0f, wallHeight * 0.5f, halfDepth + 0.25f, halfWidth + 0.5f, wallHeight * 0.5f, 0.25f, 0x20344Cu, 0.0f, 0.80f, 0.01f);
    if (variant == 1 || variant == 5)
    {
        b3w_add_box_ex(b3_staticBody, -halfWidth + 2.1f, 2.3f, 0.0f, 0.5f, 2.3f, halfDepth * 0.82f, 0x314861u, 0.0f, 0.80f, 0.01f);
    }
    const uint32_t colors[] = { 0x30AEBFu, 0xF97316u, 0xFFD166u, 0x8B5CF6u, 0x22C55Eu };
    for (int i = 0; i < 2 + stress; ++i)
    {
        float size = 0.45f + (float)(i % 3) * 0.16f;
        b3w_add_box_ex(
            b3_dynamicBody,
            -5.0f + (float)i * 2.4f,
            2.4f + (float)i * 0.3f,
            b3w_rand_range(-3.5f, 3.5f),
            size * 1.4f,
            size * 0.55f,
            size,
            colors[(variant + i + 2) % 5],
            0.45f,
            0.40f,
            0.08f);
    }
}

static void b3w_add_aaa_set_dressing(int family, int stress, int variant)
{
    // Arena beacons and floor edge markers give every native scene a readable scale.
    const float arena = 24.0f;
    const uint32_t beaconColors[4] = { 0x59D8FFu, 0xFFC96Bu, 0xB796FFu, 0x68F1B3u };
    for (int i = 0; i < 4; ++i)
    {
        float x = (i & 1) ? arena : -arena;
        float z = (i & 2) ? arena : -arena;
        b3w_add_box_ex(b3_staticBody, x, 2.2f, z, 0.16f, 2.2f, 0.16f, 0x40516Au, 0.0f, 0.82f, 0.01f);
        b3w_add_box_ex(b3_staticBody, x, 4.55f, z, 0.34f, 0.12f, 0.34f, beaconColors[i], 0.0f, 0.82f, 0.01f);
    }

    switch (family)
    {
        case 0: // foundry gantries around stack tests
            for (int x = -15; x <= 15; x += 6)
            {
                b3w_add_box_ex(b3_staticBody, (float)x, 4.5f + stress * 0.25f, -10.0f, 0.16f, 4.5f + stress * 0.25f, 0.16f, 0x64748Bu, 0.0f, 0.8f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 4.5f + stress * 0.25f, 10.0f, 0.16f, 4.5f + stress * 0.25f, 0.16f, 0x64748Bu, 0.0f, 0.8f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 9.0f + stress * 0.5f, 0.0f, 0.14f, 0.14f, 10.0f, 0x0D8EA7u, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 1: // radial stage and illuminated perimeter
            b3w_add_box_ex(b3_staticBody, 0.0f, 0.12f, 0.0f, 10.5f, 0.12f, 10.5f, 0x111C31u, 0.0f, 0.9f, 0.01f);
            for (int i = 0; i < 16; ++i)
            {
                float t = ((float)i / 16.0f) * 6.28318530718f;
                float r = 17.5f;
                float x = cosf(t) * r;
                float z = sinf(t) * r;
                b3w_add_box_ex(b3_staticBody, x, 2.4f, z, 0.22f, 2.4f, 0.22f, 0x45566Fu, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, x, 4.95f, z, 0.42f, 0.11f, 0.42f, i % 2 ? 0x59D8FFu : 0xFFC96Bu, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 2: // tower podium, skyline massing, rooftop spire
            b3w_add_box_ex(b3_staticBody, 0.0f, 0.25f, 0.0f, 8.5f, 0.25f, 8.5f, 0x18253Bu, 0.0f, 0.88f, 0.01f);
            for (int i = 0; i < 14; ++i)
            {
                float x = -24.0f + (float)i * 3.7f;
                float h = 2.0f + (float)((i * 7 + variant * 3) % 8) * 0.75f;
                float z = (i & 1) ? 17.0f : -17.0f;
                b3w_add_box_ex(b3_staticBody, x, h, z, 1.15f, h, 1.15f, i % 3 ? 0x1B2A43u : 0x263B59u, 0.0f, 0.82f, 0.01f);
            }
            b3w_add_box_ex(b3_staticBody, 0.0f, 19.0f + stress, 0.0f, 0.12f, 5.0f, 0.12f, 0xFFC96Bu, 0.0f, 0.82f, 0.01f);
            break;

        case 3: // bridge pylons and visual cable bands
            for (int side = -1; side <= 1; side += 2)
            {
                float x = (float)side * 8.3f;
                b3w_add_box_ex(b3_staticBody, x, 5.0f, -2.25f, 0.2f, 5.0f, 0.2f, 0x64748Bu, 0.0f, 0.85f, 0.01f);
                b3w_add_box_ex(b3_staticBody, x, 5.0f, 2.25f, 0.2f, 5.0f, 0.2f, 0x64748Bu, 0.0f, 0.85f, 0.01f);
                b3w_add_box_ex(b3_staticBody, x, 9.7f, 0.0f, 0.22f, 0.14f, 2.4f, 0x59D8FFu, 0.0f, 0.85f, 0.01f);
            }
            for (int x = -18; x <= 18; x += 3)
            {
                b3w_add_box_ex(b3_staticBody, (float)x, 2.65f, -2.05f, 0.045f, 0.6f + 0.035f * (float)(18 - abs(x)), 0.045f, 0xFFC96Bu, 0.0f, 0.8f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 2.65f, 2.05f, 0.045f, 0.6f + 0.035f * (float)(18 - abs(x)), 0.045f, 0xFFC96Bu, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 4: // synchronized material lane markers
            for (int lane = -2; lane <= 2; ++lane)
            {
                float z = (float)lane * 3.2f;
                b3w_add_box_ex(b3_staticBody, 0.0f, 0.025f, z - 1.22f, 14.0f, 0.025f, 0.035f, lane % 2 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.9f, 0.01f);
                b3w_add_box_ex(b3_staticBody, 0.0f, 0.025f, z + 1.22f, 14.0f, 0.025f, 0.035f, lane % 2 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.9f, 0.01f);
            }
            break;

        case 5: // storm containment towers
            for (int x = -18; x <= 18; x += 6)
            {
                b3w_add_box_ex(b3_staticBody, (float)x, 5.0f, -18.0f, 0.13f, 5.0f, 0.13f, 0x40516Au, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 5.0f, 18.0f, 0.13f, 5.0f, 0.13f, 0x40516Au, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 10.0f, 0.0f, 0.1f, 0.1f, 18.0f, 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 6: // demolition safety perimeter
            for (int i = -8; i <= 8; ++i)
            {
                uint32_t c = (i & 1) ? 0xF97316u : 0xFDE68Au;
                b3w_add_box_ex(b3_staticBody, (float)i * 2.1f, 0.65f, -13.0f, 0.8f, 0.65f, 0.18f, c, 0.0f, 0.8f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)i * 2.1f, 0.65f, 13.0f, 0.8f, 0.65f, 0.18f, c, 0.0f, 0.8f, 0.01f);
            }
            break;

        case 7: // vehicle lanes and overhead timing gantry
            for (int lane = -2; lane <= 2; ++lane)
            {
                float z = (float)lane * 3.9f;
                for (int x = -20; x <= 20; x += 4)
                {
                    b3w_add_box_ex(b3_staticBody, (float)x, 0.035f, z, 1.3f, 0.035f, 0.035f, 0xFFF2A8u, 0.0f, 0.9f, 0.01f);
                }
            }
            b3w_add_box_ex(b3_staticBody, 8.0f, 3.0f, -11.0f, 0.15f, 3.0f, 0.15f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_staticBody, 8.0f, 3.0f, 11.0f, 0.15f, 3.0f, 0.15f, 0x64748Bu, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_staticBody, 8.0f, 6.0f, 0.0f, 0.15f, 0.15f, 11.0f, 0x0D8EA7u, 0.0f, 0.82f, 0.01f);
            break;

        case 8: // marble arena frames and collection bins
            for (int x = -15; x <= 15; x += 6)
            {
                b3w_add_box_ex(b3_staticBody, (float)x, 4.2f, -9.0f, 0.12f, 4.2f, 0.12f, 0x475569u, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 4.2f, 9.0f, 0.12f, 4.2f, 0.12f, 0x475569u, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)x, 8.4f, 0.0f, 0.1f, 0.1f, 9.0f, 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            for (int bin = -3; bin <= 3; ++bin)
            {
                b3w_add_box_ex(b3_staticBody, 14.0f, 0.45f, (float)bin * 2.5f, 1.4f, 0.45f, 1.0f, bin & 1 ? 0x7C3AEDu : 0x0D8EA7u, 0.0f, 0.74f, 0.18f);
            }
            break;

        case 9: // construction crane silhouette and suspended load
            for (int y = 0; y < 13; ++y)
            {
                b3w_add_box_ex(b3_staticBody, -14.0f, 0.5f + (float)y, -8.0f, 0.18f, 0.5f, 0.18f, y & 1 ? 0xF97316u : 0xFFD166u, 0.0f, 0.82f, 0.01f);
            }
            b3w_add_box_ex(b3_staticBody, -2.5f, 13.2f, -8.0f, 11.5f, 0.16f, 0.16f, 0xF97316u, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_staticBody, 5.0f, 10.2f, -8.0f, 0.055f, 3.0f, 0.055f, 0xD8DEE9u, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_dynamicBody, 5.0f, 6.6f, -8.0f, 1.4f, 0.4f, 0.8f, 0xFFD166u, 4.5f, 0.7f, 0.02f);
            break;

        case 10: // warehouse dock wall and overhead rails
            b3w_add_box_ex(b3_staticBody, 18.0f, 2.5f, 0.0f, 0.45f, 2.5f, 18.0f, 0x172235u, 0.0f, 0.84f, 0.01f);
            for (int dock = -4; dock <= 4; ++dock)
            {
                float z = (float)dock * 3.7f;
                b3w_add_box_ex(b3_staticBody, 17.45f, 1.0f, z, 0.58f, 1.0f, 1.45f, dock & 1 ? 0x263B59u : 0x334155u, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, 16.85f, 2.3f, z, 0.1f, 0.1f, 0.82f, dock & 1 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.82f, 0.01f);
            }
            b3w_add_box_ex(b3_staticBody, -1.5f, 7.5f, -10.0f, 16.5f, 0.1f, 0.1f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_staticBody, -1.5f, 7.5f, 10.0f, 16.5f, 0.1f, 0.1f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            break;

        case 11: // architectural colonnade and central presentation plinth
            b3w_add_box_ex(b3_staticBody, 0.0f, 0.14f, 0.0f, 9.0f, 0.14f, 9.0f, 0x17243Au, 0.0f, 0.88f, 0.01f);
            for (int i = 0; i < 18; ++i)
            {
                float t = ((float)i / 18.0f) * 6.28318530718f;
                float x = cosf(t) * 17.5f;
                float z = sinf(t) * 17.5f;
                b3w_add_box_ex(b3_staticBody, x, 2.8f, z, 0.32f, 2.8f, 0.32f, i & 1 ? 0xD8DEE9u : 0xB8C2D3u, 0.0f, 0.84f, 0.01f);
                b3w_add_box_ex(b3_staticBody, x, 5.8f, z, 0.58f, 0.18f, 0.58f, i % 3 ? 0xFFC96Bu : 0x59D8FFu, 0.0f, 0.84f, 0.01f);
            }
            break;

        case 12: // cloth wind-tunnel rails and observation markers
            b3w_add_box_ex(b3_staticBody, -16.0f, 7.5f, 0.0f, 0.10f, 0.10f, 8.0f, 0x30AEBFu, 0.0f, 0.82f, 0.01f);
            b3w_add_box_ex(b3_staticBody, 16.0f, 7.5f, 0.0f, 0.10f, 0.10f, 8.0f, 0xFFD166u, 0.0f, 0.82f, 0.01f);
            for (int i = -4; i <= 4; ++i)
            {
                b3w_add_box_ex(b3_staticBody, (float)i * 3.6f, 0.12f, 9.5f, 1.2f, 0.12f, 0.22f, (i & 1) ? 0x8B5CF6u : 0x50D8FFu, 0.0f, 0.84f, 0.01f);
            }
            break;

        case 13: // rope/cable load-test towers
            for (int sideIndex = 0; sideIndex < 2; ++sideIndex)
            {
                float side = sideIndex == 0 ? -1.0f : 1.0f;
                b3w_add_box_ex(b3_staticBody, side * 19.0f, 5.0f, -7.0f, 0.12f, 5.0f, 0.12f, 0xF97316u, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, side * 19.0f, 5.0f, 7.0f, 0.12f, 5.0f, 0.12f, 0xF97316u, 0.0f, 0.82f, 0.01f);
                b3w_add_box_ex(b3_staticBody, side * 19.0f, 10.0f, 0.0f, 0.10f, 0.10f, 7.0f, 0xFFD166u, 0.0f, 0.82f, 0.01f);
            }
            break;

        case 14: // hydrodynamics observation wall and luminous datum rail
            for (int i = -5; i <= 5; ++i)
            {
                b3w_add_box_ex(b3_staticBody, (float)i * 3.2f, 0.42f, -14.0f, 1.1f, 0.42f, 0.26f, (i & 1) ? 0x1D4E6Du : 0x2C6F8Fu, 0.0f, 0.85f, 0.01f);
                b3w_add_box_ex(b3_staticBody, (float)i * 3.2f, 0.42f, 14.0f, 1.1f, 0.42f, 0.26f, (i & 1) ? 0x1D4E6Du : 0x2C6F8Fu, 0.0f, 0.85f, 0.01f);
            }
            b3w_add_box_ex(b3_staticBody, 0.0f, 6.5f, -13.0f, 18.0f, 0.08f, 0.08f, 0x50D8FFu, 0.0f, 0.82f, 0.01f);
            break;
    }
}

B3W_EXPORT int b3w_spawn_rain(int count, float spread, float height)
{
    if (B3_IS_NULL(g_world)) return 0;
    if (count < 1) count = 1;
    if (spread < 1.0f) spread = 1.0f;
    int added = 0;
    const uint32_t palette[] = { 0x30AEBFu, 0xDC3132u, 0x8CC924u, 0xFFEE8Cu, 0x7C3AEDu, 0xF97316u };
    for (int i = 0; i < count && g_bodyCount < B3W_MAX_BODIES; ++i)
    {
        float size = b3w_rand_range(0.22f, 0.55f);
        int body = b3w_add_box_ex(b3_dynamicBody, b3w_rand_range(-spread, spread), height + b3w_rand_range(0.0f, 18.0f), b3w_rand_range(-spread, spread), size, size, size, palette[i % 6], 1.0f, 0.62f, 0.05f);
        if (body >= 0)
        {
            b3Body_ApplyLinearImpulseToCenter(g_bodies[body].id, (b3Vec3){ b3w_rand_range(-1.2f, 1.2f), b3w_rand_range(-2.0f, 1.0f), b3w_rand_range(-1.2f, 1.2f) }, true);
            added += 1;
        }
    }
    return added;
}

static void b3w_scene_rain(int stress)
{
    b3w_spawn_rain(180 + stress * 420, 16.0f + stress * 3.0f, 12.0f + stress * 4.0f);
}

B3W_EXPORT int b3w_create_scene(int sceneId, int stressScale, uint32_t seed)
{
    int stress = b3w_clamp_int(stressScale, 1, 5);
    int family = sceneId / 50;
    int mode = (sceneId % 50) / 10;
    int variant = sceneId % 10;
    b3w_create_world(seed);

    // The browser catalog has 750 scenes: 15 families x 5 modes x 10 variants.
    // This C bridge maps each family to a Box3D-native recipe and layers
    // lightweight variant actions on top until the full native catalog is expanded.
    switch (family)
    {
        default:
        case 0: b3w_scene_stack(stress + variant % 2); break;
        case 1: b3w_scene_domino(stress); break;
        case 2: b3w_scene_skyscraper(stress + variant % 2); break;
        case 3: b3w_scene_bridge(stress); break;
        case 4: b3w_scene_material(stress); break;
        case 5: b3w_scene_rain(stress); break;
        case 6:
            b3w_scene_stack(stress);
            b3w_launch_projectile(-22.0f, 4.0f + (float)stress, 0.0f, 24.0f + (float)stress * 2.0f, 2.0f, 0.0f, 0.9f);
            if (variant % 3 == 1) b3w_explode(0.0f, 2.4f, 0.0f, 14.0f, 7.0f);
            break;
        case 7:
            b3w_scene_material(stress);
            for (int i = 0; i < 4 + stress; ++i)
            {
                int body = b3w_add_box_ex(b3_dynamicBody, -18.0f - (float)i * 2.4f, 0.65f, b3w_rand_range(-5.0f, 5.0f), 1.0f, 0.45f, 0.65f, 0xF97316u, 5.0f, 0.72f, 0.05f);
                if (body >= 0) b3Body_ApplyLinearImpulseToCenter(g_bodies[body].id, (b3Vec3){ 8.0f + (float)stress, 0.0f, 0.0f }, true);
            }
            break;
        case 8:
            b3w_scene_material(stress);
            b3w_spawn_rain(40 + stress * 45 + variant * 8, 8.0f, 12.0f);
            break;
        case 9:
            b3w_scene_skyscraper(stress);
            b3w_spawn_rain(35 + stress * 35, 9.0f, 14.0f);
            break;
        case 10:
            b3w_scene_bridge(stress);
            b3w_spawn_rain(65 + stress * 30, 14.0f, 10.0f);
            if (variant % 2 == 1) b3w_explode(0.0f, 2.5f, 0.0f, 9.0f, 8.0f);
            break;
        case 11:
            b3w_scene_skyscraper(stress);
            if (variant % 3 == 0) b3w_launch_projectile(-23.0f, 5.5f, 0.0f, 24.0f, 1.0f, 0.0f, 1.0f);
            break;
        case 12:
            b3w_scene_cloth_stage(stress, variant);
            break;
        case 13:
            b3w_scene_rope_stage(stress, variant);
            break;
        case 14:
            b3w_scene_water_stage(stress, variant);
            break;
    }

    // Cinematic and Maximum catalog modes receive authored native set dressing.
    // It is intentionally made from ordinary Box3D bodies so the same transform
    // stream is rendered by the WebGPU instancing path without special cases.
    if (mode >= 3)
    {
        b3w_add_aaa_set_dressing(family, stress, variant);
    }

    return g_bodyCount;
}

B3W_EXPORT int b3w_create_demo(int columns, int rows, int layers)
{
    b3w_create_world(0xC0FFEEu);
    int stress = b3w_clamp_int((columns + rows + layers) / 16, 1, 5);
    b3w_scene_stack(stress);
    return g_bodyCount;
}

B3W_EXPORT void b3w_destroy(void)
{
    b3w_destroy_world();
}

B3W_EXPORT int b3w_body_count(void)
{
    return g_bodyCount;
}

B3W_EXPORT int b3w_dynamic_count(void)
{
    return g_dynamicCount;
}

B3W_EXPORT uintptr_t b3w_matrices_ptr(void)
{
    return (uintptr_t)g_matrices;
}

B3W_EXPORT uintptr_t b3w_colors_ptr(void)
{
    return (uintptr_t)g_colors;
}

B3W_EXPORT int b3w_max_bodies(void)
{
    return B3W_MAX_BODIES;
}

B3W_EXPORT uint32_t b3w_transform_version(void)
{
    return g_transformVersion;
}

B3W_EXPORT uint32_t b3w_color_version(void)
{
    return g_colorVersion;
}

B3W_EXPORT int b3w_awake_count(void)
{
    return B3_IS_NON_NULL(g_world) ? b3World_GetAwakeBodyCount(g_world) : 0;
}

B3W_EXPORT void b3w_sync_transforms(void)
{
    // The compact index wins when static dressing dominates, but its extra
    // load/indirection is measurable when almost every body is dynamic. Use a
    // sequential scan for dense-dynamic worlds and retain the compact stream
    // for the static-heavy case it was designed to accelerate.
    if (g_dynamicCount * 4 >= g_bodyCount * 3)
    {
        for (int i = 0; i < g_bodyCount; ++i)
        {
            if (g_bodies[i].dynamic == 0) continue;
            b3WorldTransform xf = b3Body_GetTransform(g_bodies[i].id);
            b3w_write_model_matrix(i, xf.p, xf.q, g_bodies[i].hx, g_bodies[i].hy, g_bodies[i].hz);
        }
    }
    else
    {
        for (int dynamicIndex = 0; dynamicIndex < g_dynamicCount; ++dynamicIndex)
        {
            const int i = g_dynamicIndices[dynamicIndex];
            b3WorldTransform xf = b3Body_GetTransform(g_bodies[i].id);
            b3w_write_model_matrix(i, xf.p, xf.q, g_bodies[i].hx, g_bodies[i].hy, g_bodies[i].hz);
        }
    }
    g_hashDirty = 1;
    g_transformVersion += 1u;
}

B3W_EXPORT void b3w_step(float dt, int subSteps)
{
    if (B3_IS_NULL(g_world) || !isfinite(dt) || dt <= 0.0f)
    {
        return;
    }

    subSteps = b3w_clamp_int(subSteps, 1, 16);
    const int awakeBefore = b3World_GetAwakeBodyCount(g_world);
    // This bridge creates no kinematic bodies and every exported mutation uses
    // wake=true. With zero awake bodies, Box3D has no state that can advance;
    // skip the solver as well as the transform scan. A later impulse or newly
    // created dynamic body wakes the world before the next call reaches here.
    if (awakeBefore == 0)
    {
        return;
    }
    b3World_Step(g_world, dt, subSteps);

    // If the step began awake, perform the same full synchronization used by
    // the baseline. This deliberately includes the step where the last bodies
    // fall asleep, so their terminal pose is captured exactly. Once a step
    // begins with zero awake bodies, no transform can change and both the scan
    // and transform revision are safely skipped.
    if (awakeBefore != 0)
    {
        b3w_sync_transforms();
    }
}

B3W_EXPORT void b3w_apply_impulse(int index, float ix, float iy, float iz)
{
    if (index < 0 || index >= g_bodyCount || g_bodies[index].dynamic == 0)
    {
        return;
    }

    b3Body_ApplyLinearImpulseToCenter(g_bodies[index].id, (b3Vec3){ ix, iy, iz }, true);
}

B3W_EXPORT void b3w_kick_stack(float strength)
{
    if (strength <= 0.0f) strength = 6.0f;
    for (int i = 0; i < g_bodyCount; ++i)
    {
        if (g_bodies[i].dynamic == 0) continue;
        // The synchronized stream already contains the authoritative body
        // translation. Kick needs only the X sign, so avoid one native body
        // lookup per dynamic body without changing RNG or impulse order.
        float side = g_matrices[i * 16 + 12] >= 0.0f ? 1.0f : -1.0f;
        float lift = 0.35f + 0.7f * b3w_rand01();
        float spin = b3w_rand_range(-1.0f, 1.0f);
        b3Body_ApplyLinearImpulseToCenter(g_bodies[i].id, (b3Vec3){ side * strength * (0.25f + 0.75f * b3w_rand01()), strength * lift, spin * strength * 0.22f }, true);
    }
}

B3W_EXPORT void b3w_explode(float cx, float cy, float cz, float strength, float radius)
{
    if (radius <= 0.1f) radius = 8.0f;
    const float radiusSquared = radius * radius;
    for (int i = 0; i < g_bodyCount; ++i)
    {
        if (g_bodies[i].dynamic == 0) continue;
        // The transform stream is synchronized after every step and body
        // creation. Use its translation for a conservative exact miss test so
        // distant bodies avoid both a Box3D API lookup and sqrtf. Near the
        // boundary, retain the original native position and distance path.
        const float* m = g_matrices + i * 16;
        const float cachedDx = m[12] - cx;
        const float cachedDy = m[13] - cy;
        const float cachedDz = m[14] - cz;
        const float cachedDistanceSquared = cachedDx * cachedDx + cachedDy * cachedDy + cachedDz * cachedDz;
        if (cachedDistanceSquared > radiusSquared * 1.000001f) continue;
        b3Pos p = b3Body_GetPosition(g_bodies[i].id);
        float dx = (float)p.x - cx;
        float dy = (float)p.y - cy;
        float dz = (float)p.z - cz;
        float dist = sqrtf(dx * dx + dy * dy + dz * dz);
        if (dist > radius) continue;
        float invDist = dist > 0.001f ? 1.0f / dist : 1.0f;
        float falloff = 1.0f - dist / radius;
        b3Vec3 impulse = { dx * invDist * strength * falloff, (dy * invDist + 0.55f) * strength * falloff, dz * invDist * strength * falloff };
        b3Body_ApplyLinearImpulseToCenter(g_bodies[i].id, impulse, true);
    }
}

B3W_EXPORT int b3w_launch_projectile(float x, float y, float z, float vx, float vy, float vz, float size)
{
    if (B3_IS_NULL(g_world)) return -1;
    if (size <= 0.05f) size = 0.8f;
    int index = b3w_add_box_ex(b3_dynamicBody, x, y, z, size, size, size, 0xFFD166u, 8.0f, 0.45f, 0.12f);
    if (index >= 0)
    {
        b3Body_ApplyLinearImpulseToCenter(g_bodies[index].id, (b3Vec3){ vx, vy, vz }, true);
    }
    return index;
}

B3W_EXPORT uint32_t b3w_replay_hash(void)
{
    if (g_hashDirty != 0)
    {
        uint32_t hash = 2166136261u;
        for (int i = 0; i < g_bodyCount; ++i)
        {
            const float* m = g_matrices + i * 16;
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
        g_hash = hash;
        g_hashDirty = 0;
    }
    return g_hash;
}
