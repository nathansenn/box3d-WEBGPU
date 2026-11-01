/*
 * Standalone, no-libc WebAssembly kernels for the browser soft-simulation
 * layer. The ABI intentionally consists only of offsets into exported linear
 * memory and scalar values, so JavaScript can retain persistent typed views.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#if defined(SOFT_SIMD) && SOFT_SIMD
#include <wasm_simd128.h>
#endif

#define EXPORT(name) __attribute__((export_name(name)))
#define WASM_PAGE_BYTES 65536u
#define SOFT_ABI_VERSION 0x00010100u

extern u8 __heap_base;

static u32 g_heap_offset;

static float soft_sqrt(float value)
{
    return __builtin_sqrtf(value);
}

static float soft_clamp(float value, float low, float high)
{
    return value < low ? low : value > high ? high : value;
}

static u32 align_up(u32 value, u32 alignment)
{
    return (value + alignment - 1u) & ~(alignment - 1u);
}

static u32 heap_start(void)
{
    return align_up((u32)(unsigned long)&__heap_base, 16u);
}

EXPORT("soft_version")
u32 soft_version(void)
{
    return SOFT_ABI_VERSION;
}

EXPORT("soft_variant")
u32 soft_variant(void)
{
#if defined(SOFT_SIMD) && SOFT_SIMD
    return 1u;
#else
    return 0u;
#endif
}

EXPORT("soft_reset")
void soft_reset(void)
{
    g_heap_offset = heap_start();
}

EXPORT("soft_heap_offset")
u32 soft_heap_offset(void)
{
    if (g_heap_offset == 0u) {
        soft_reset();
    }
    return g_heap_offset;
}

EXPORT("soft_alloc")
u32 soft_alloc(u32 byte_count, u32 alignment)
{
    if (g_heap_offset == 0u) {
        soft_reset();
    }

    if (alignment == 0u) {
        alignment = 16u;
    }
    if (alignment > 64u || (alignment & (alignment - 1u)) != 0u) {
        return 0u;
    }

    const u32 start = align_up(g_heap_offset, alignment);
    const u32 end = start + byte_count;
    if (end < start) {
        return 0u;
    }

    const u32 current_pages = (u32)__builtin_wasm_memory_size(0);
    const u32 required_pages = (end + WASM_PAGE_BYTES - 1u) / WASM_PAGE_BYTES;
    if (required_pages > current_pages) {
        const unsigned long previous = __builtin_wasm_memory_grow(0, required_pages - current_pages);
        if (previous == (unsigned long)-1) {
            return 0u;
        }
    }

    g_heap_offset = end;
    return start;
}

/* A small feature probe that guarantees the SIMD binary contains v128 ops. */
EXPORT("soft_vector_add_one")
void soft_vector_add_one(float *output, const float *input)
{
#if defined(SOFT_SIMD) && SOFT_SIMD
    const v128_t values = wasm_v128_load(input);
    const v128_t result = wasm_f32x4_add(values, wasm_f32x4_splat(1.0f));
    wasm_v128_store(output, result);
#else
    output[0] = input[0] + 1.0f;
    output[1] = input[1] + 1.0f;
    output[2] = input[2] + 1.0f;
    output[3] = input[3] + 1.0f;
#endif
}

static u32 project_constraints_intact(
    float *positions,
    const u16 *indices_a,
    const u16 *indices_b,
    const float *rest_lengths,
    const float *scale_a_values,
    const float *scale_b_values,
    u32 constraint_count,
    u32 iterations)
{
    u32 projected = 0u;
    for (u32 iteration = 0u; iteration < iterations; ++iteration) {
        for (u32 ci = 0u; ci < constraint_count; ++ci) {
            const u32 ao = (u32)indices_a[ci] * 3u;
            const u32 bo = (u32)indices_b[ci] * 3u;
            const float dx = positions[bo] - positions[ao];
            const float dy = positions[bo + 1u] - positions[ao + 1u];
            const float dz = positions[bo + 2u] - positions[ao + 2u];
            const float distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared < 1.0e-14f) {
                continue;
            }

            const float distance = soft_sqrt(distance_squared);
            const float correction = (distance - rest_lengths[ci]) / distance;
            const float scale_a = correction * scale_a_values[ci];
            const float scale_b = correction * scale_b_values[ci];
            positions[ao] += dx * scale_a;
            positions[ao + 1u] += dy * scale_a;
            positions[ao + 2u] += dz * scale_a;
            positions[bo] -= dx * scale_b;
            positions[bo + 1u] -= dy * scale_b;
            positions[bo + 2u] -= dz * scale_b;
            ++projected;
        }
    }
    return projected;
}

static u32 project_constraints(
    float *positions,
    const u16 *indices_a,
    const u16 *indices_b,
    const float *rest_lengths,
    const float *scale_a_values,
    const float *scale_b_values,
    const u8 *broken,
    u32 constraint_count,
    u32 iterations)
{
    if (broken == (const u8 *)0) {
        return project_constraints_intact(
            positions,
            indices_a,
            indices_b,
            rest_lengths,
            scale_a_values,
            scale_b_values,
            constraint_count,
            iterations);
    }

    u32 projected = 0u;
    for (u32 iteration = 0u; iteration < iterations; ++iteration) {
        for (u32 ci = 0u; ci < constraint_count; ++ci) {
            if (broken[ci] != 0u) {
                continue;
            }
            const u32 ao = (u32)indices_a[ci] * 3u;
            const u32 bo = (u32)indices_b[ci] * 3u;
            const float dx = positions[bo] - positions[ao];
            const float dy = positions[bo + 1u] - positions[ao + 1u];
            const float dz = positions[bo + 2u] - positions[ao + 2u];
            const float distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared < 1.0e-14f) {
                continue;
            }

            const float distance = soft_sqrt(distance_squared);
            const float correction = (distance - rest_lengths[ci]) / distance;
            const float scale_a = correction * scale_a_values[ci];
            const float scale_b = correction * scale_b_values[ci];
            positions[ao] += dx * scale_a;
            positions[ao + 1u] += dy * scale_a;
            positions[ao + 2u] += dz * scale_a;
            positions[bo] -= dx * scale_b;
            positions[bo + 1u] -= dy * scale_b;
            positions[bo + 2u] -= dz * scale_b;
            ++projected;
        }
    }
    return projected;
}

EXPORT("soft_cloth_project")
u32 soft_cloth_project(
    float *positions,
    const u16 *indices_a,
    const u16 *indices_b,
    const float *rest_lengths,
    const float *scale_a_values,
    const float *scale_b_values,
    const u8 *broken,
    u32 constraint_count,
    u32 iterations)
{
    return project_constraints(
        positions,
        indices_a,
        indices_b,
        rest_lengths,
        scale_a_values,
        scale_b_values,
        broken,
        constraint_count,
        iterations);
}

EXPORT("soft_cloth_integrate")
u32 soft_cloth_integrate(
    float *positions,
    float *previous,
    const float *inverse_mass,
    const float *wind_sin_a,
    const float *wind_cos_a,
    const float *wind_sin_b,
    const float *wind_cos_b,
    const float *wind_sin_z,
    const float *wind_cos_z,
    const float *edge_factors,
    u32 particle_count,
    float dt_squared,
    float drag,
    float gust,
    float sin_a,
    float cos_a,
    float sin_b,
    float cos_b,
    float sin_z,
    float cos_z,
    float z_scale,
    float variant_lift,
    u32 vertical_layout)
{
    u32 integrated = 0u;
    for (u32 i = 0u; i < particle_count; ++i) {
        if (inverse_mass[i] == 0.0f) {
            continue;
        }
        const u32 o = i * 3u;
        const float x = positions[o];
        const float y = positions[o + 1u];
        const float z = positions[o + 2u];
        const float vx = (x - previous[o]) * drag;
        const float vy = (y - previous[o + 1u]) * drag;
        const float vz = (z - previous[o + 2u]) * drag;
        previous[o] = x;
        previous[o + 1u] = y;
        previous[o + 2u] = z;

        const float turbulence_a = sin_a * wind_cos_a[i] + cos_a * wind_sin_a[i];
        const float turbulence_b = sin_b * wind_cos_b[i] + cos_b * wind_sin_b[i];
        const float turbulence = turbulence_a + 0.45f * turbulence_b;
        const float wind_x = gust * edge_factors[i] * (0.78f + turbulence * 0.18f);
        const float wind_oscillation = sin_z * wind_cos_z[i] + cos_z * wind_sin_z[i];
        const float wind_z = gust * z_scale * wind_oscillation;
        const float lift = vertical_layout != 0u
            ? turbulence * 0.25f
            : (turbulence > 0.0f ? turbulence : 0.0f) * 0.55f + variant_lift;

        positions[o] = x + vx + wind_x * dt_squared;
        positions[o + 1u] = y + vy + (-9.81f + lift) * dt_squared;
        positions[o + 2u] = z + vz + wind_z * dt_squared;
        ++integrated;
    }
    return integrated;
}

static void collide_cloth_particles(
    float *positions,
    float *previous,
    const float *inverse_mass,
    u32 particle_count,
    float floor_height,
    float ground_slide,
    float sphere_x,
    float sphere_y,
    float sphere_z,
    float sphere_radius)
{
    const float target = sphere_radius + 0.08f;
    for (u32 i = 0u; i < particle_count; ++i) {
        if (inverse_mass[i] == 0.0f) {
            continue;
        }
        const u32 o = i * 3u;
        if (positions[o + 1u] < floor_height) {
            positions[o + 1u] = floor_height;
            previous[o] = positions[o] - (positions[o] - previous[o]) * ground_slide;
            previous[o + 2u] = positions[o + 2u] - (positions[o + 2u] - previous[o + 2u]) * ground_slide;
        }
        if (sphere_radius > 0.0f) {
            const float dx = positions[o] - sphere_x;
            const float dy = positions[o + 1u] - sphere_y;
            const float dz = positions[o + 2u] - sphere_z;
            const float distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared < target * target && distance_squared > 1.0e-12f) {
                const float scale = target / soft_sqrt(distance_squared);
                positions[o] = sphere_x + dx * scale;
                positions[o + 1u] = sphere_y + dy * scale;
                positions[o + 2u] = sphere_z + dz * scale;
            }
        }
    }
}

EXPORT("soft_cloth_solve")
u32 soft_cloth_solve(
    float *positions,
    float *previous,
    const float *inverse_mass,
    const u16 *indices_a,
    const u16 *indices_b,
    const float *rest_lengths,
    const float *scale_a_values,
    const float *scale_b_values,
    const u8 *broken,
    u32 particle_count,
    u32 constraint_count,
    u32 iterations,
    float floor_height,
    float ground_slide,
    float sphere_x,
    float sphere_y,
    float sphere_z,
    float sphere_radius)
{
    u32 projected = 0u;
    for (u32 iteration = 0u; iteration < iterations; ++iteration) {
        projected += project_constraints(
            positions,
            indices_a,
            indices_b,
            rest_lengths,
            scale_a_values,
            scale_b_values,
            broken,
            constraint_count,
            1u);
        collide_cloth_particles(
            positions,
            previous,
            inverse_mass,
            particle_count,
            floor_height,
            ground_slide,
            sphere_x,
            sphere_y,
            sphere_z,
            sphere_radius);
    }
    return projected;
}

EXPORT("soft_rope_project")
u32 soft_rope_project(
    float *positions,
    const u16 *indices_a,
    const u16 *indices_b,
    const float *rest_lengths,
    const float *inverse_rest_lengths,
    const float *scale_a_values,
    const float *scale_b_values,
    u8 *broken,
    const u8 *render,
    const float *break_thresholds,
    u32 constraint_count,
    u32 iterations,
    u32 break_budget)
{
    u32 newly_broken = 0u;
    for (u32 iteration = 0u; iteration < iterations; ++iteration) {
        for (u32 ci = 0u; ci < constraint_count; ++ci) {
            if (broken[ci] != 0u) {
                continue;
            }
            const u32 ao = (u32)indices_a[ci] * 3u;
            const u32 bo = (u32)indices_b[ci] * 3u;
            const float dx = positions[bo] - positions[ao];
            const float dy = positions[bo + 1u] - positions[ao + 1u];
            const float dz = positions[bo + 2u] - positions[ao + 2u];
            const float distance_squared = dx * dx + dy * dy + dz * dz;
            if (distance_squared < 1.0e-14f) {
                continue;
            }

            const float distance = soft_sqrt(distance_squared);
            if (render[ci] != 0u && newly_broken < break_budget
                && distance * inverse_rest_lengths[ci] > break_thresholds[ci]) {
                broken[ci] = 1u;
                ++newly_broken;
                continue;
            }

            const float correction = (distance - rest_lengths[ci]) / distance;
            const float scale_a = correction * scale_a_values[ci];
            const float scale_b = correction * scale_b_values[ci];
            positions[ao] += dx * scale_a;
            positions[ao + 1u] += dy * scale_a;
            positions[ao + 2u] += dz * scale_a;
            positions[bo] -= dx * scale_b;
            positions[bo + 1u] -= dy * scale_b;
            positions[bo + 2u] -= dz * scale_b;
        }
    }
    return newly_broken;
}

EXPORT("soft_water_step")
u32 soft_water_step(
    const float *eta,
    const float *u,
    const float *v,
    float *next_eta,
    float *next_u,
    float *next_v,
    u32 cols,
    u32 rows,
    float dt,
    float gravity,
    float mean_depth,
    float drag,
    float inverse_two_dx,
    float inverse_two_dz)
{
    if (cols < 3u || rows < 3u || dt <= 0.0f) {
        return 0u;
    }

    const float velocity_decay = 1.0f - drag * dt;
    const float pressure_x = gravity * dt * inverse_two_dx;
    const float pressure_z = gravity * dt * inverse_two_dz;
    const float continuity_x = mean_depth * dt * inverse_two_dx;
    const float continuity_z = mean_depth * dt * inverse_two_dz;

    for (u32 z = 1u; z + 1u < rows; ++z) {
        const u32 row = z * cols;
        const u32 row_end = row + cols - 1u;
        u32 i = row + 1u;
#if defined(SOFT_SIMD) && SOFT_SIMD
        const v128_t decay4 = wasm_f32x4_splat(velocity_decay);
        const v128_t pressure_x4 = wasm_f32x4_splat(pressure_x);
        const v128_t pressure_z4 = wasm_f32x4_splat(pressure_z);
        for (; i + 3u < row_end; i += 4u) {
            const v128_t eta_right = wasm_v128_load(eta + i + 1u);
            const v128_t eta_left = wasm_v128_load(eta + i - 1u);
            const v128_t eta_down = wasm_v128_load(eta + i + cols);
            const v128_t eta_up = wasm_v128_load(eta + i - cols);
            const v128_t next_u4 = wasm_f32x4_sub(
                wasm_f32x4_mul(wasm_v128_load(u + i), decay4),
                wasm_f32x4_mul(wasm_f32x4_sub(eta_right, eta_left), pressure_x4));
            const v128_t next_v4 = wasm_f32x4_sub(
                wasm_f32x4_mul(wasm_v128_load(v + i), decay4),
                wasm_f32x4_mul(wasm_f32x4_sub(eta_down, eta_up), pressure_z4));
            wasm_v128_store(next_u + i, next_u4);
            wasm_v128_store(next_v + i, next_v4);
        }
#endif
        for (; i < row_end; ++i) {
            next_u[i] = u[i] * velocity_decay - (eta[i + 1u] - eta[i - 1u]) * pressure_x;
            next_v[i] = v[i] * velocity_decay - (eta[i + cols] - eta[i - cols]) * pressure_z;
        }
    }

    for (u32 z = 1u; z + 1u < rows; ++z) {
        const u32 row = z * cols;
        const u32 row_end = row + cols - 1u;
        u32 i = row + 1u;
#if defined(SOFT_SIMD) && SOFT_SIMD
        const v128_t continuity_x4 = wasm_f32x4_splat(continuity_x);
        const v128_t continuity_z4 = wasm_f32x4_splat(continuity_z);
        const v128_t low4 = wasm_f32x4_splat(-1.65f);
        const v128_t high4 = wasm_f32x4_splat(1.65f);
        for (; i + 3u < row_end; i += 4u) {
            v128_t next4 = wasm_f32x4_sub(
                wasm_v128_load(eta + i),
                wasm_f32x4_mul(
                    wasm_f32x4_sub(wasm_v128_load(next_u + i + 1u), wasm_v128_load(next_u + i - 1u)),
                    continuity_x4));
            next4 = wasm_f32x4_sub(
                next4,
                wasm_f32x4_mul(
                    wasm_f32x4_sub(wasm_v128_load(next_v + i + cols), wasm_v128_load(next_v + i - cols)),
                    continuity_z4));
            next4 = wasm_f32x4_max(low4, wasm_f32x4_min(high4, next4));
            wasm_v128_store(next_eta + i, next4);
        }
#endif
        for (; i < row_end; ++i) {
            const float next = eta[i]
                - (next_u[i + 1u] - next_u[i - 1u]) * continuity_x
                - (next_v[i + cols] - next_v[i - cols]) * continuity_z;
            next_eta[i] = soft_clamp(next, -1.65f, 1.65f);
        }
    }

    const u32 bottom_row = (rows - 1u) * cols;
    const u32 inner_bottom = (rows - 2u) * cols;
    for (u32 x = 0u; x < cols; ++x) {
        next_eta[x] = next_eta[cols + x] * 0.92f;
        next_u[x] = next_u[cols + x] * 0.78f;
        next_v[x] = -next_v[cols + x] * 0.18f;
        const u32 bottom = bottom_row + x;
        const u32 inner = inner_bottom + x;
        next_eta[bottom] = next_eta[inner] * 0.92f;
        next_u[bottom] = next_u[inner] * 0.78f;
        next_v[bottom] = -next_v[inner] * 0.18f;
    }

    for (u32 z = 0u; z < rows; ++z) {
        const u32 row = z * cols;
        const u32 left_inner = row + 1u;
        const u32 right = row + cols - 1u;
        const u32 right_inner = right - 1u;
        next_eta[row] = next_eta[left_inner] * 0.92f;
        next_u[row] = -next_u[left_inner] * 0.18f;
        next_v[row] = next_v[left_inner] * 0.78f;
        next_eta[right] = next_eta[right_inner] * 0.92f;
        next_u[right] = -next_u[right_inner] * 0.18f;
        next_v[right] = next_v[right_inner] * 0.78f;
    }

    return 1u;
}
