// Box3D WebGPU Epic Lab bridge
// Keeps upstream Box3D intact and exposes a compact C ABI for browser/WebGPU demos.

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
static int g_bodyCount = 0;
static int g_dynamicCount = 0;
static float g_matrices[B3W_MAX_BODIES * 16];
static float g_colors[B3W_MAX_BODIES * 4];
static uint32_t g_rng = 0xC0FFEEu;
static uint32_t g_hash = 0u;

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

static int b3w_add_box_ex(b3BodyType type, float x, float y, float z, float hx, float hy, float hz, uint32_t color, float density, float friction, float restitution)
{
    if (g_bodyCount >= B3W_MAX_BODIES)
    {
        return -1;
    }

    b3BodyDef bodyDef = b3DefaultBodyDef();
    bodyDef.type = type;
    bodyDef.position = (b3Vec3){ x, y, z };

    if (type == b3_dynamicBody)
    {
        bodyDef.angularVelocity = (b3Vec3){ b3w_rand_range(-0.20f, 0.20f), b3w_rand_range(-0.15f, 0.15f), b3w_rand_range(-0.20f, 0.20f) };
    }

    b3BodyId body = b3CreateBody(g_world, &bodyDef);

    b3BoxHull hull = b3MakeBoxHull(hx, hy, hz);
    b3ShapeDef shapeDef = b3DefaultShapeDef();
    shapeDef.density = density;
    shapeDef.baseMaterial.friction = friction;
    shapeDef.baseMaterial.restitution = restitution;
    shapeDef.baseMaterial.customColor = color;
    b3CreateHullShape(body, &shapeDef, &hull.base);

    int index = g_bodyCount++;
    g_bodies[index].id = body;
    g_bodies[index].hx = hx;
    g_bodies[index].hy = hy;
    g_bodies[index].hz = hz;
    g_bodies[index].color = color;
    g_bodies[index].dynamic = type == b3_dynamicBody ? 1 : 0;
    if (g_bodies[index].dynamic)
    {
        g_dynamicCount += 1;
    }

    b3w_unpack_rgb(color, g_colors + index * 4);
    b3w_write_model_matrix(index, (b3Vec3){ x, y, z }, b3Quat_identity, hx, hy, hz);
    return index;
}

static int b3w_add_box(b3BodyType type, float x, float y, float z, float hx, float hy, float hz, uint32_t color, float density)
{
    return b3w_add_box_ex(type, x, y, z, hx, hy, hz, color, density, 0.68f, 0.04f);
}

static void b3w_destroy_world(void)
{
    if (B3_IS_NON_NULL(g_world))
    {
        b3DestroyWorld(g_world);
        g_world = b3_nullWorldId;
    }

    g_bodyCount = 0;
    g_dynamicCount = 0;
    g_hash = 0u;
    memset(g_matrices, 0, sizeof(g_matrices));
    memset(g_colors, 0, sizeof(g_colors));
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
    int variant = sceneId % 10;
    b3w_create_world(seed);

    // The browser catalog has 600 scenes: 12 families x 5 modes x 10 variants.
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

B3W_EXPORT void b3w_sync_transforms(void)
{
    uint32_t hash = 2166136261u;
    for (int i = 0; i < g_bodyCount; ++i)
    {
        b3WorldTransform xf = b3Body_GetTransform(g_bodies[i].id);
        b3w_write_model_matrix(i, xf.p, xf.q, g_bodies[i].hx, g_bodies[i].hy, g_bodies[i].hz);
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
}

B3W_EXPORT void b3w_step(float dt, int subSteps)
{
    if (B3_IS_NULL(g_world) || dt <= 0.0f)
    {
        return;
    }

    subSteps = b3w_clamp_int(subSteps, 1, 16);
    b3World_Step(g_world, dt, subSteps);
    b3w_sync_transforms();
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
        b3Pos p = b3Body_GetPosition(g_bodies[i].id);
        float side = p.x >= 0.0f ? 1.0f : -1.0f;
        float lift = 0.35f + 0.7f * b3w_rand01();
        float spin = b3w_rand_range(-1.0f, 1.0f);
        b3Body_ApplyLinearImpulseToCenter(g_bodies[i].id, (b3Vec3){ side * strength * (0.25f + 0.75f * b3w_rand01()), strength * lift, spin * strength * 0.22f }, true);
    }
}

B3W_EXPORT void b3w_explode(float cx, float cy, float cz, float strength, float radius)
{
    if (radius <= 0.1f) radius = 8.0f;
    for (int i = 0; i < g_bodyCount; ++i)
    {
        if (g_bodies[i].dynamic == 0) continue;
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
    return g_hash;
}
