import type { Mat4 } from '../math';
import type { DebugLine, DynamicSurfaceFrame, InstanceBufferSource, RopeGridFrame, SceneUniformState } from '../types';
import { GpuPassTimer, type GpuPassTimestampWrites, type GpuTimingInfo, type GpuTimingOptions } from './gpu-timing.js';
import { ShadowPassCache } from './shadow-cache.js';
import { InstancePartition, partitionVertexBindings, partitionVertexEntry } from './instance-partition.js';
import { ResidentWaterSurface, type ResidentWaterOptions } from './resident-water-surface.js';
import { GpuStartupBudget, type GpuStartupOptions } from './startup-budget.js';
import type { GpuLinearWater } from './linear-water.ts';
import {
  loadMaterialAtlasTexture,
  loadMaterialNoiseTexture,
  type MaterialAtlasTexture,
  type MaterialNoiseTexture,
} from '../assets/ktx2.js';

const CUBE_VERTEX_COUNT = 36;
const MAX_DEBUG_LINE_VERTICES = 131072;
const SCENE_UNIFORM_FLOATS = 52;
const SCENE_UNIFORM_BYTES = SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_SHADOW_MAP_SIZE: 1024 | 2048 = 2048;
const DEFAULT_SAMPLE_COUNT: 1 | 4 = 4;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
// At 4x MSAA the resolved HDR color, multisampled HDR color, and depth target
// consume roughly 56 bytes per rendered pixel. Cap Ultra at a 1440p-class
// framebuffer so high-DPI/5K displays cannot allocate hundreds of MiB per
// attachment set. The 1x profile can retain a native 4K-class target.
const MAX_FRAMEBUFFER_PIXELS_4X = 2560 * 1440;
const MAX_FRAMEBUFFER_PIXELS_1X = 3840 * 2160;
const MAX_DYNAMIC_SURFACE_VERTICES = 16384;
const MAX_DYNAMIC_SURFACE_INDICES = 98304;
const SURFACE_VERTEX_BYTES = 24;
const GPU_CLOTH_VERTEX_BYTES = 12;
const GPU_WATER_CELL_BYTES = 12;
const SURFACE_PARAMS_BYTES = 64;
const ROPE_GRID_UNIFORM_BYTES = 16;
const MAX_ROPE_NODES = 4096;
const MAX_ROPE_SEGMENTS = 4096;

// The checked-in ambient WebGPU declarations predate depth-bias fields even
// though current browsers and Dawn implement them. Keep the compatibility cast
// narrow and local to shadow depth state.
type BiasedDepthStencilState = GPUDepthStencilState & {
  depthBias: number;
  depthBiasSlopeScale: number;
  depthBiasClamp: number;
};

function assertNever(value: never, message: string): never {
  throw new Error(message);
}

const sceneUniformStruct = /* wgsl */ `
struct SceneUniforms {
  viewProj : mat4x4<f32>,
  lightViewProj : mat4x4<f32>,
  cameraPosTime : vec4<f32>,
  lightDirExposure : vec4<f32>,
  fogColorDensity : vec4<f32>,
  viewportBloomShadow : vec4<f32>,
  qualityModes : vec4<f32>,
};
`;

const packedSurfaceDecode = /* wgsl */ `
fn decodeOctNormal(encoded : vec2<f32>) -> vec3<f32> {
  var normal = vec3<f32>(encoded.x, encoded.y, 1.0 - abs(encoded.x) - abs(encoded.y));
  if (normal.z < 0.0) {
    let original = normal.xy;
    normal.x = (1.0 - abs(original.y)) * select(-1.0, 1.0, original.x >= 0.0);
    normal.y = (1.0 - abs(original.x)) * select(-1.0, 1.0, original.y >= 0.0);
  }
  return normalize(normal);
}
`;

// The browser package ships a 2x2 Poliigon-derived material atlas. Tile order:
// weathered concrete, galvanized metal, woven fabric, and honed stone. The
// second texture stores tangent-space normal RGB and roughness in alpha.
const materialAtlasSampling = /* wgsl */ `
fn materialTileUv(tile : u32, uv : vec2<f32>) -> vec2<f32> {
  let cell = vec2<f32>(f32(tile & 1u), f32(tile >> 1u));
  let insetUv = vec2<f32>(0.015) + fract(uv) * 0.97;
  return (cell + insetUv) * 0.5;
}

fn dominantProjectionUv(metricPosition : vec3<f32>, normal : vec3<f32>) -> vec2<f32> {
  let axis = abs(normal);
  if (axis.y >= axis.x && axis.y >= axis.z) { return metricPosition.xz; }
  if (axis.x >= axis.z) { return metricPosition.zy; }
  return metricPosition.xy;
}

// Compact analytic warehouse IBL for the engineering workspaces. High-bay
// LED/sodium luminaires and warm concrete bounce, with no blue/purple studio
// wash. Fixed directions keep paused captures deterministic.
fn studioEnvironment(direction : vec3<f32>) -> vec3<f32> {
  let ray = normalize(direction);
  let vertical = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
  var radiance = mix(vec3<f32>(0.048, 0.042, 0.036), vec3<f32>(0.20, 0.185, 0.155), vertical);
  let overhead = pow(max(ray.y, 0.0), 8.0);
  let bayA = pow(max(dot(ray, normalize(vec3<f32>(-0.22, 0.96, 0.12))), 0.0), 48.0);
  let bayB = pow(max(dot(ray, normalize(vec3<f32>(0.28, 0.94, -0.18))), 0.0), 52.0);
  let bayC = pow(max(dot(ray, normalize(vec3<f32>(-0.08, 0.97, -0.32))), 0.0), 44.0);
  let key = pow(max(dot(ray, normalize(vec3<f32>(-0.55, 0.72, 0.38))), 0.0), 22.0);
  let fill = pow(max(dot(ray, normalize(vec3<f32>(0.62, 0.42, 0.48))), 0.0), 28.0);
  let wall = pow(max(dot(ray, normalize(vec3<f32>(0.08, 0.12, 0.99))), 0.0), 6.0);
  radiance = radiance
    + vec3<f32>(1.15, 1.05, 0.88) * overhead
    + vec3<f32>(1.55, 1.38, 1.08) * (bayA + bayB * 0.85 + bayC * 0.70)
    + vec3<f32>(1.28, 1.12, 0.92) * key
    + vec3<f32>(0.42, 0.38, 0.32) * fill
    + vec3<f32>(0.16, 0.15, 0.13) * wall;
  return radiance;
}

// UV.x is the rolling / mill direction. Reconstruct TBN from screen-space
// derivatives so brushed metal can stretch GGX along the sheet instead of
// using the galvanized atlas's isotropic zinc-spangle normals.
fn surfaceTangentFrame(geometricNormal : vec3<f32>, worldPosition : vec3<f32>, uv : vec2<f32>) -> mat3x3<f32> {
  let positionDx = dpdx(worldPosition);
  let positionDy = dpdy(worldPosition);
  let uvDx = dpdx(uv);
  let uvDy = dpdy(uv);
  let determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
  let inverseDeterminant = select(-1.0, 1.0, determinant >= 0.0) / max(abs(determinant), 0.00001);
  let tangentCandidate = (positionDx * uvDy.y - positionDy * uvDx.y) * inverseDeterminant;
  var tangent = tangentCandidate - geometricNormal * dot(geometricNormal, tangentCandidate);
  tangent = tangent / max(length(tangent), 0.00001);
  let bitangent = normalize(cross(geometricNormal, tangent));
  return mat3x3<f32>(tangent, bitangent, geometricNormal);
}

fn distributionGGXAniso(nDotH : f32, tDotH : f32, bDotH : f32, ax : f32, ay : f32) -> f32 {
  let a2 = ax * ay;
  let denom = (tDotH * tDotH) / max(ax * ax, 0.000001)
    + (bDotH * bDotH) / max(ay * ay, 0.000001)
    + nDotH * nDotH;
  return 1.0 / max(3.14159265 * a2 * denom * denom, 0.0001);
}

fn geometrySmithAniso(nDotW : f32, tDotW : f32, bDotW : f32, ax : f32, ay : f32) -> f32 {
  let stretched = (ax * ax * tDotW * tDotW + ay * ay * bDotW * bDotW) / max(nDotW * nDotW, 0.000001);
  return 2.0 / max(1.0 + sqrt(1.0 + stretched), 0.0001);
}
`;

const gpuSurfaceVertexOut = /* wgsl */ `
struct GpuSurfaceVertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) color : vec4<f32>,
  @location(2) worldPos : vec3<f32>,
  @location(3) shadowPosition : vec4<f32>,
  @location(4) uv : vec2<f32>,
};
`;

const gpuSurfaceShadowSampling = /* wgsl */ `
fn sampleGpuSurfaceShadow(shadowPosition : vec4<f32>, normal : vec3<f32>, lightDirection : vec3<f32>) -> f32 {
  if (scene.viewportBloomShadow.w <= 0.001) {
    return 1.0;
  }
  let projected = shadowPosition.xyz / max(shadowPosition.w, 0.0001);
  let uvUnclamped = vec2<f32>(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);
  let inBounds = select(0.0, 1.0,
    uvUnclamped.x > 0.0 && uvUnclamped.x < 1.0 &&
    uvUnclamped.y > 0.0 && uvUnclamped.y < 1.0 &&
    projected.z > 0.0 && projected.z < 1.0
  );
  let uv = clamp(uvUnclamped, vec2<f32>(0.0015), vec2<f32>(0.9985));
  let texel = vec2<f32>(1.0) / vec2<f32>(textureDimensions(shadowMap));
  let nDotL = max(dot(normal, -lightDirection), 0.0);
  let referenceDepth = clamp(projected.z - max(0.00005, 0.00036 * (1.0 - nDotL)), 0.0, 1.0);
  let centerVisibility = textureSampleCompareLevel(shadowMap, shadowSampler, uv, referenceDepth);
  if (scene.qualityModes.x < 1.5) {
    return mix(1.0, centerVisibility, inBounds);
  }
  var visibility = 0.0;
  for (var x : i32 = -1; x <= 1; x = x + 1) {
    for (var y : i32 = -1; y <= 1; y = y + 1) {
      let weightX = select(1.0, 2.0, x == 0);
      let weightY = select(1.0, 2.0, y == 0);
      visibility = visibility + weightX * weightY * textureSampleCompareLevel(
        shadowMap,
        shadowSampler,
        uv + vec2<f32>(f32(x), f32(y)) * texel * 1.05,
        referenceDepth
      );
    }
  }
  return mix(1.0, visibility / 16.0, inBounds);
}
`;

const solidShader = /* wgsl */ `
${sceneUniformStruct}
${materialAtlasSampling}
${partitionVertexBindings}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

@group(0) @binding(3)
var materialNoise : texture_2d<f32>;

@group(0) @binding(4)
var materialNoiseSampler : sampler;

@group(0) @binding(5)
var materialAlbedoAtlas : texture_2d<f32>;

@group(0) @binding(6)
var materialSurfaceAtlas : texture_2d<f32>;

@group(0) @binding(7)
var materialAtlasSampler : sampler;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) m0 : vec4<f32>,
  @location(3) m1 : vec4<f32>,
  @location(4) m2 : vec4<f32>,
  @location(5) m3 : vec4<f32>,
  @location(6) color : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) color : vec4<f32>,
  @location(2) worldPos : vec3<f32>,
  @location(3) shadowPosition : vec4<f32>,
  @location(4) materialUv : vec2<f32>,
};

fn vertexForInstance(input : VertexIn) -> VertexOut {
  let model = mat4x4<f32>(input.m0, input.m1, input.m2, input.m3);
  let world = model * vec4<f32>(input.position, 1.0);

  var out : VertexOut;
  out.clipPosition = scene.viewProj * world;
  // Model columns contain rotation * non-uniform half-extents. Rebuild a
  // rotation-only basis so thin beams, slabs, and towers receive physically
  // plausible lighting instead of skewed normals.
  let normalBasis = mat3x3<f32>(
    normalize(input.m0.xyz),
    normalize(input.m1.xyz),
    normalize(input.m2.xyz)
  );
  out.worldNormal = normalize(normalBasis * input.normal);
  out.color = input.color;
  out.worldPos = world.xyz;
  out.shadowPosition = scene.lightViewProj * world;
  // Project in object space, but restore the model's physical half-extents.
  // The texture therefore follows a moving/rotating body without stretching
  // every differently-sized box to the same texel density.
  let metricPosition = input.position * vec3<f32>(
    length(input.m0.xyz),
    length(input.m1.xyz),
    length(input.m2.xyz)
  );
  out.materialUv = dominantProjectionUv(metricPosition, input.normal) * 0.22;
  return out;
}

@vertex
fn vsMain(input : VertexIn) -> VertexOut { return vertexForInstance(input); }
${partitionVertexEntry}

fn distributionGGX(nDotH : f32, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let denominator = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * denominator * denominator, 0.0001);
}

fn geometrySchlickGGX(nDotV : f32, roughness : f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return nDotV / max(nDotV * (1.0 - k) + k, 0.0001);
}

fn fresnelSchlick(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - cosTheta, 5.0);
}

fn fresnelSchlickRoughness(nDotV : f32, f0 : vec3<f32>, roughness : f32) -> vec3<f32> {
  let grazingReflectance = max(vec3<f32>(1.0 - roughness), f0);
  return f0 + (grazingReflectance - f0) * pow(1.0 - nDotV, 5.0);
}

fn perturbNormal(
  geometricNormal : vec3<f32>,
  worldPosition : vec3<f32>,
  materialUv : vec2<f32>,
  tangentNormal : vec3<f32>,
  strength : f32
) -> vec3<f32> {
  let positionDx = dpdx(worldPosition);
  let positionDy = dpdy(worldPosition);
  let uvDx = dpdx(materialUv);
  let uvDy = dpdy(materialUv);
  let determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
  let inverseDeterminant = select(-1.0, 1.0, determinant >= 0.0) / max(abs(determinant), 0.00001);
  let tangentCandidate = (positionDx * uvDy.y - positionDy * uvDx.y) * inverseDeterminant;
  let bitangentCandidate = (-positionDx * uvDy.x + positionDy * uvDx.x) * inverseDeterminant;
  var tangent = tangentCandidate - geometricNormal * dot(geometricNormal, tangentCandidate);
  tangent = tangent / max(length(tangent), 0.00001);
  let handedness = select(-1.0, 1.0, dot(cross(tangentCandidate, bitangentCandidate), geometricNormal) >= 0.0);
  let bitangent = normalize(cross(geometricNormal, tangent)) * handedness;
  let mapped = normalize(vec3<f32>(tangentNormal.xy * strength, max(tangentNormal.z, 0.08)));
  return normalize(tangent * mapped.x + bitangent * mapped.y + geometricNormal * mapped.z);
}

fn sampleShadow(shadowPosition : vec4<f32>, normal : vec3<f32>, lightDirection : vec3<f32>) -> f32 {
  if (scene.viewportBloomShadow.w <= 0.001) {
    return 1.0;
  }
  let projected = shadowPosition.xyz / max(shadowPosition.w, 0.0001);
  let uvUnclamped = vec2<f32>(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);

  // Do not early-return before the shadow texture lookup. Some browsers reject
  // textureSampleCompare in per-fragment control flow. textureSampleCompareLevel
  // is explicitly derivative-free, and the out-of-bounds result is masked with
  // select() after sampling so the shader validates across stricter WebGPU
  // implementations.
  let inBounds = select(0.0, 1.0,
    uvUnclamped.x > 0.0 && uvUnclamped.x < 1.0 &&
    uvUnclamped.y > 0.0 && uvUnclamped.y < 1.0 &&
    projected.z > 0.0 && projected.z < 1.0
  );
  let uv = clamp(uvUnclamped, vec2<f32>(0.0015), vec2<f32>(0.9985));

  let dimensions = vec2<f32>(textureDimensions(shadowMap));
  let texel = vec2<f32>(1.0) / dimensions;
  let nDotL = max(dot(normal, -lightDirection), 0.0);
  let bias = max(0.00004, 0.00028 * (1.0 - nDotL));
  let referenceDepth = clamp(projected.z - bias, 0.0, 1.0);
  let centerVisibility = textureSampleCompareLevel(shadowMap, shadowSampler, uv, referenceDepth);
  if (scene.qualityModes.x < 1.5) {
    return mix(1.0, centerVisibility, inBounds);
  }
  var visibility = 0.0;

  for (var x : i32 = -1; x <= 1; x = x + 1) {
    for (var y : i32 = -1; y <= 1; y = y + 1) {
      let weightX = select(1.0, 2.0, x == 0);
      let weightY = select(1.0, 2.0, y == 0);
      let offset = vec2<f32>(f32(x), f32(y)) * texel;
      visibility = visibility + weightX * weightY
        * textureSampleCompareLevel(shadowMap, shadowSampler, uv + offset, referenceDepth);
    }
  }

  let sampledVisibility = visibility / 16.0;
  return mix(1.0, sampledVisibility, inBounds);
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  var normal = normalize(input.worldNormal);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);

  let materialId = u32(round(max(-input.color.a, 0.0)));
  let usesAtlas = materialId == 1u || materialId == 2u || materialId == 3u || materialId == 5u;
  var materialTile = 0u;
  if (materialId == 2u) { materialTile = 1u; }
  if (materialId == 3u) { materialTile = 2u; }
  if (materialId == 5u) { materialTile = 3u; }

  // Fract() keeps each atlas tile repeating, while explicit gradients prevent
  // tile seams from forcing the texture sampler toward the coarsest mip.
  let atlasUv = materialTileUv(materialTile, input.materialUv);
  let atlasGradientX = dpdx(input.materialUv) * 0.485;
  let atlasGradientY = dpdy(input.materialUv) * 0.485;
  let atlasAlbedo = textureSampleGrad(
    materialAlbedoAtlas,
    materialAtlasSampler,
    atlasUv,
    atlasGradientX,
    atlasGradientY
  ).rgb;
  let atlasSurface = textureSampleGrad(
    materialSurfaceAtlas,
    materialAtlasSampler,
    atlasUv,
    atlasGradientX,
    atlasGradientY
  );
  let detailNormal = atlasSurface.rgb * 2.0 - vec3<f32>(1.0);

  let encodedColor = clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let authoredColor = pow(encodedColor, vec3<f32>(2.2));
  var baseColor = select(authoredColor, atlasAlbedo * mix(vec3<f32>(0.76), authoredColor * 1.45, 0.36), usesAtlas);
  // For conductors the atlas texel represents colored specular reflectance,
  // not a diffuse layer to be multiplied down by the authored swatch.
  if (materialId == 2u) {
    // Flatten zinc-spangle albedo so fixtures read as mill steel, not a tiled liquid.
    baseColor = clamp(mix(atlasAlbedo, authoredColor, 0.58) * vec3<f32>(1.0, 0.99, 0.95), vec3<f32>(0.08), vec3<f32>(0.78));
  }
  let noiseUv = input.materialUv * 0.34 + vec2<f32>(f32(materialId) * 0.173, -f32(materialId) * 0.117);
  let millUv = input.materialUv * vec2<f32>(0.62, 22.0) + vec2<f32>(f32(materialId) * 0.173, -f32(materialId) * 0.117);
  let microVariation = textureSample(materialNoise, materialNoiseSampler, noiseUv).r;
  let millGrain = textureSample(materialNoise, materialNoiseSampler, millUv).r;
  // Transparent materials are rendered in a later blended pass. Sampling
  // derivative-dependent textures before discard keeps WGSL uniformity valid.
  if (materialId == 4u || materialId == 6u) {
    discard;
  }

  // Material response is semantic, never inferred from hue or luminance.
  // IDs: 0 authored dielectric, 1 concrete, 2 galvanized metal, 3 fabric,
  // 5 stone, 7 carbon composite, 8 solver diagnostic overlay. IDs 4 and 6
  // are handled by the transparent pass above.
  var metallic = 0.0;
  var roughness = clamp(0.46 + (microVariation - 0.5) * 0.14, 0.34, 0.62);
  var normalStrength = 0.0;
  if (materialId == 1u) {
    roughness = clamp(atlasSurface.a * 0.55 + 0.40 + (microVariation - 0.5) * 0.06, 0.68, 0.94);
    normalStrength = 0.32;
  }
  if (materialId == 2u) {
    metallic = 0.92;
    // Satin mill roughness from 1D grain only. Atlas roughness follows zinc
    // spangles and reads as standing water once it hits a conductor lobe.
    roughness = clamp(0.32 + (millGrain - 0.5) * 0.04, 0.28, 0.42);
    normalStrength = 0.0;
  }
  if (materialId == 3u) {
    roughness = clamp(0.72 + atlasSurface.a * 0.24 + (microVariation - 0.5) * 0.04, 0.80, 0.98);
    normalStrength = 0.38;
  }
  if (materialId == 5u) {
    roughness = clamp(0.38 + atlasSurface.a * 0.48 + (microVariation - 0.5) * 0.05, 0.50, 0.90);
    normalStrength = 0.26;
  }
  if (materialId == 7u) {
    metallic = 0.0;
    roughness = clamp(0.32 + (microVariation - 0.5) * 0.08, 0.24, 0.42);
  }
  if (materialId == 8u) {
    metallic = 0.24;
    roughness = clamp(0.40 + (microVariation - 0.5) * 0.04, 0.34, 0.46);
  }
  let detailVector = perturbNormal(normal, input.worldPos, input.materialUv, detailNormal, normalStrength);
  // Keep atlas normals on dielectrics. Galvanized metal uses mill anisotropy
  // instead of the ocean-like zinc-spangle normal tile.
  normal = select(normal, detailVector, usesAtlas && materialId != 2u);
  let metalFrame = surfaceTangentFrame(normal, input.worldPos, input.materialUv);
  let millBump = select(0.0, (millGrain - 0.5) * 0.035, materialId == 2u);
  normal = normalize(normal + metalFrame[1] * millBump);

  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);

  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(vDotH, f0);
  var distribution = distributionGGX(nDotH, roughness);
  var geometry = geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness);
  var envDirection = reflect(-viewDirection, normal);
  if (materialId == 2u) {
    let tangent = normalize(metalFrame[0] - normal * dot(metalFrame[0], normal));
    let bitangent = normalize(cross(normal, tangent));
    let ax = max(roughness * roughness * 0.36, 0.0004);
    let ay = max(roughness * roughness * 2.35, 0.0016);
    distribution = distributionGGXAniso(nDotH, dot(tangent, halfVector), dot(bitangent, halfVector), ax, ay);
    geometry = geometrySmithAniso(nDotV, dot(tangent, viewDirection), dot(bitangent, viewDirection), ax, ay)
      * geometrySmithAniso(nDotL, dot(tangent, toLight), dot(bitangent, toLight), ax, ay);
    envDirection = normalize(envDirection + tangent * dot(envDirection, tangent) * 0.58);
  }
  let specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * nDotL, 0.001);
  let kD = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);

  let shadowVisibility = mix(1.0, sampleShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w);
  let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);
  let sunRadiance = mix(vec3<f32>(5.8, 5.15, 4.55), vec3<f32>(4.55, 4.15, 3.45), studioMix);
  let direct = (kD * baseColor / 3.14159265 + specular) * sunRadiance * nDotL * shadowVisibility;

  let emissiveStrength = max(input.color.a - 1.0, 0.0);
  let emissive = baseColor * emissiveStrength * 2.2;

  // Analytic hemispheric IBL uses NdotV for ambient Fresnel. Reusing the
  // direct-light VdotH term made reflections change with the sun direction and
  // gave dielectrics a metallic-looking rim.
  let environmentFresnel = fresnelSchlickRoughness(nDotV, f0, roughness);
  let environmentBottom = mix(vec3<f32>(0.075, 0.060, 0.052), vec3<f32>(0.042, 0.038, 0.032), studioMix);
  let environmentTop = mix(vec3<f32>(0.20, 0.34, 0.56), vec3<f32>(0.24, 0.22, 0.18), studioMix);
  var diffuseIrradiance = mix(
    environmentBottom,
    environmentTop,
    clamp(normal.y * 0.5 + 0.5, 0.0, 1.0)
  ) + mix(vec3<f32>(0.025), vec3<f32>(0.048), studioMix);
  let studioKeyWrap = max(dot(normal, normalize(vec3<f32>(-0.55, 0.72, 0.38))), 0.0);
  diffuseIrradiance = diffuseIrradiance + studioMix * vec3<f32>(0.14, 0.12, 0.09) * studioKeyWrap;
  // Shadowed ambient is reduced, not removed. This inexpensive coupling is
  // what visually seats clamps, rails, and coupons on their support surfaces.
  let ambientVisibility = mix(1.0, 0.66 + 0.34 * shadowVisibility, studioMix);
  let ambientDiffuse = diffuseIrradiance * baseColor
    * (vec3<f32>(1.0) - environmentFresnel) * (1.0 - metallic) * ambientVisibility;
  let outdoorEnvironment = mix(
    environmentBottom,
    vec3<f32>(0.20, 0.38, 0.68),
    clamp(envDirection.y * 0.5 + 0.5, 0.0, 1.0)
  );
  let roughStudioEnvironment = mix(studioEnvironment(envDirection), vec3<f32>(0.22, 0.205, 0.175), roughness * roughness * 0.82);
  let environment = mix(outdoorEnvironment, roughStudioEnvironment, studioMix);
  let environmentSpecular = environment * environmentFresnel
    * mix(0.24, 1.0, metallic) * (1.0 - roughness * 0.52)
    * mix(1.0, 0.82 + 0.18 * shadowVisibility, studioMix);
  var color = ambientDiffuse + direct + emissive + environmentSpecular;

  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.92));
  return vec4<f32>(color, 1.0);
}

@fragment
fn fsTransparent(input : VertexOut) -> @location(0) vec4<f32> {
  let materialId = u32(round(max(-input.color.a, 0.0)));
  let normal = normalize(input.worldNormal);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let noiseUv = input.materialUv * 0.34 + vec2<f32>(f32(materialId) * 0.173, -f32(materialId) * 0.117);
  // Sample before the material-dependent discard for derivative uniformity.
  let variation = textureSample(materialNoise, materialNoiseSampler, noiseUv).r;
  if (materialId != 4u && materialId != 6u) {
    discard;
  }

  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = clamp(1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018), 0.0, 0.88);
  if (materialId == 4u) {
    let facing = abs(dot(normal, viewDirection));
    let fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    let reflected = reflect(-viewDirection, normal);
    let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);
    let outdoorEnvironment = mix(
      vec3<f32>(0.055, 0.048, 0.044),
      vec3<f32>(0.22, 0.48, 0.82),
      clamp(reflected.y * 0.5 + 0.5, 0.0, 1.0)
    );
    let environment = mix(outdoorEnvironment, studioEnvironment(reflected), studioMix);
    let tint = pow(clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
    var color = tint * (0.11 + variation * 0.035) + environment * (0.22 + fresnel * 0.78);
    color = mix(color, scene.fogColorDensity.xyz, fogAmount);
    return vec4<f32>(color, clamp(0.10 + fresnel * 0.48 + variation * 0.025, 0.10, 0.62));
  }

  // Concrete dust is a low-opacity participating-media proxy. It reads depth
  // but does not write it, so expanding clouds soften the fracture without
  // hiding the rebar and aggregate behind opaque glowing cubes.
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let diffuse = 0.38 + max(dot(normal, -lightDirection), 0.0) * 0.28;
  let dustBase = pow(clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
  var dustColor = dustBase * (diffuse + variation * 0.16);
  dustColor = mix(dustColor, scene.fogColorDensity.xyz, fogAmount);
  return vec4<f32>(dustColor, clamp(0.10 + variation * 0.16, 0.10, 0.30));
}
`;

const shadowShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) m0 : vec4<f32>,
  @location(3) m1 : vec4<f32>,
  @location(4) m2 : vec4<f32>,
  @location(5) m3 : vec4<f32>,
  @location(6) color : vec4<f32>,
};

struct ShadowVertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vsMain(input : VertexIn) -> ShadowVertexOut {
  let model = mat4x4<f32>(input.m0, input.m1, input.m2, input.m3);
  var out : ShadowVertexOut;
  out.clipPosition = scene.lightViewProj * model * vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : ShadowVertexOut) {
  let materialId = u32(round(max(-input.color.a, 0.0)));
  // Thin glass and low-density dust receive soft lighting in the blended pass;
  // they must not stamp an opaque binary silhouette into the shadow map.
  if (materialId == 4u || materialId == 6u) { discard; }
  // Positive alpha above one is the renderer's emissive-energy convention.
  // Sparks, muzzle flashes, and light strips are emitters rather than occluders.
  if (input.color.a > 1.001) { discard; }
}
`;

const surfaceShadowShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec2<f32>,
  @location(2) color : vec4<f32>,
  @location(3) uv : vec2<f32>,
};

@vertex
fn vsMain(input : VertexIn) -> @builtin(position) vec4<f32> {
  return scene.lightViewProj * vec4<f32>(input.position, 1.0);
}
`;

const clothShader = /* wgsl */ `
${sceneUniformStruct}
${packedSurfaceDecode}
${materialAtlasSampling}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

@group(0) @binding(5)
var materialAlbedoAtlas : texture_2d<f32>;

@group(0) @binding(7)
var materialAtlasSampler : sampler;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec2<f32>,
  @location(2) color : vec4<f32>,
  @location(3) uv : vec2<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) color : vec4<f32>,
  @location(2) worldPos : vec3<f32>,
  @location(3) shadowPosition : vec4<f32>,
  @location(4) uv : vec2<f32>,
};

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
  var out : VertexOut;
  let world = vec4<f32>(input.position, 1.0);
  out.clipPosition = scene.viewProj * world;
  out.worldNormal = decodeOctNormal(input.normal);
  out.color = input.color;
  out.worldPos = input.position;
  out.shadowPosition = scene.lightViewProj * world;
  out.uv = input.uv;
  return out;
}

fn sampleSurfaceShadow(shadowPosition : vec4<f32>, normal : vec3<f32>, lightDirection : vec3<f32>) -> f32 {
  if (scene.viewportBloomShadow.w <= 0.001) {
    return 1.0;
  }
  let projected = shadowPosition.xyz / max(shadowPosition.w, 0.0001);
  let uvUnclamped = vec2<f32>(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);
  let inBounds = select(0.0, 1.0,
    uvUnclamped.x > 0.0 && uvUnclamped.x < 1.0 &&
    uvUnclamped.y > 0.0 && uvUnclamped.y < 1.0 &&
    projected.z > 0.0 && projected.z < 1.0
  );
  let uv = clamp(uvUnclamped, vec2<f32>(0.0015), vec2<f32>(0.9985));
  let dimensions = vec2<f32>(textureDimensions(shadowMap));
  let texel = vec2<f32>(1.0) / dimensions;
  let nDotL = max(dot(normal, -lightDirection), 0.0);
  let bias = max(0.00005, 0.00036 * (1.0 - nDotL));
  let referenceDepth = clamp(projected.z - bias, 0.0, 1.0);
  let centerVisibility = textureSampleCompareLevel(shadowMap, shadowSampler, uv, referenceDepth);
  if (scene.qualityModes.x < 1.5) {
    return mix(1.0, centerVisibility, inBounds);
  }
  var visibility = 0.0;
  for (var x : i32 = -1; x <= 1; x = x + 1) {
    for (var y : i32 = -1; y <= 1; y = y + 1) {
      let weightX = select(1.0, 2.0, x == 0);
      let weightY = select(1.0, 2.0, y == 0);
      let offset = vec2<f32>(f32(x), f32(y)) * texel * 1.05;
      visibility = visibility + weightX * weightY
        * textureSampleCompareLevel(shadowMap, shadowSampler, uv + offset, referenceDepth);
    }
  }
  return mix(1.0, visibility / 16.0, inBounds);
}

@fragment
fn fsMain(input : VertexOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4<f32> {
  let geometricNormal = normalize(input.worldNormal);
  let normal = select(-geometricNormal, geometricNormal, frontFacing);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);

  let warp = 0.5 + 0.5 * sin(input.uv.x * 1256.637 + input.uv.y * 7.0);
  let weft = 0.5 + 0.5 * sin(input.uv.y * 942.478 + input.uv.x * 5.0);
  let weave = mix(0.82, 1.12, warp * weft);
  let stress = clamp(input.color.a, 0.0, 1.0);
  let textile = textureSample(materialAlbedoAtlas, materialAtlasSampler, materialTileUv(2u, input.uv * vec2<f32>(5.0, 4.0))).rgb;
  let tint = pow(clamp(input.color.rgb * weave, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
  let baseColor = tint * mix(vec3<f32>(1.0), textile * 1.55, 0.48);
  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let visibility = mix(1.0, sampleSurfaceShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w);
  let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);

  let studioAmbient = studioEnvironment(normal) * 0.34 * (0.70 + visibility * 0.30);
  let diffuseAmbient = mix(vec3<f32>(0.16, 0.22, 0.34), studioAmbient, studioMix);
  let diffuse = baseColor * (diffuseAmbient + vec3<f32>(3.7, 3.35, 3.0) * nDotL * visibility);
  let fiberSpecular = pow(nDotH, mix(42.0, 115.0, warp)) * (0.16 + stress * 0.24) * visibility;
  let backLight = pow(max(dot(-normal, toLight), 0.0), 1.7) * baseColor
    * mix(vec3<f32>(0.95, 0.38, 0.18), vec3<f32>(0.62, 0.64, 0.66), studioMix) * 0.42;
  let rim = pow(1.0 - nDotV, 3.0)
    * mix(mix(vec3<f32>(0.08, 0.22, 0.46), vec3<f32>(1.0, 0.12, 0.03), stress), vec3<f32>(0.16), studioMix)
    * mix(0.65, 0.28, studioMix);
  let stressGlow = vec3<f32>(1.4, 0.05, 0.01) * pow(stress, 3.0) * mix(1.4, 0.34, studioMix);
  var color = diffuse + vec3<f32>(fiberSpecular) + backLight + rim + stressGlow;

  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.90));
  return vec4<f32>(color, 1.0);
}
`;

const sheetShader = /* wgsl */ `
${sceneUniformStruct}
${packedSurfaceDecode}
${materialAtlasSampling}
${gpuSurfaceShadowSampling}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

@group(0) @binding(3)
var materialNoise : texture_2d<f32>;

@group(0) @binding(4)
var materialNoiseSampler : sampler;

@group(0) @binding(5)
var materialAlbedoAtlas : texture_2d<f32>;

@group(0) @binding(7)
var materialAtlasSampler : sampler;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec2<f32>,
  @location(2) color : vec4<f32>,
  @location(3) uv : vec2<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) color : vec4<f32>,
  @location(2) worldPos : vec3<f32>,
  @location(3) shadowPosition : vec4<f32>,
  @location(4) uv : vec2<f32>,
};

fn fresnelSchlick(cosTheta : f32, f0 : vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - cosTheta, 5.0);
}

fn fresnelSchlickRoughness(nDotV : f32, f0 : vec3<f32>, roughness : f32) -> vec3<f32> {
  let grazingReflectance = max(vec3<f32>(1.0 - roughness), f0);
  return f0 + (grazingReflectance - f0) * pow(1.0 - nDotV, 5.0);
}

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
  var out : VertexOut;
  let world = vec4<f32>(input.position, 1.0);
  out.clipPosition = scene.viewProj * world;
  out.worldNormal = decodeOctNormal(input.normal);
  out.color = input.color;
  out.worldPos = input.position;
  out.shadowPosition = scene.lightViewProj * world;
  out.uv = input.uv;
  return out;
}

@fragment
fn fsMain(input : VertexOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4<f32> {
  let geometricNormal = normalize(input.worldNormal);
  var normal = select(-geometricNormal, geometricNormal, frontFacing);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);

  // Stretch the galvanized albedo into mill lines along U. Equal 16×7 tiling
  // turned zinc spangles into a standing-wave field; the surface atlas normal
  // is never applied on this path.
  let millAlbedoUv = vec2<f32>(input.uv.x * 2.0, input.uv.y * 18.0);
  let atlasUv = materialTileUv(1u, millAlbedoUv);
  let atlasGradientX = dpdx(millAlbedoUv) * 0.485;
  let atlasGradientY = dpdy(millAlbedoUv) * 0.485;
  let atlasAlbedo = textureSampleGrad(
    materialAlbedoAtlas,
    materialAtlasSampler,
    atlasUv,
    atlasGradientX,
    atlasGradientY
  ).rgb;
  let millUv = vec2<f32>(input.uv.x * 2.4, input.uv.y * 56.0);
  let millGrain = textureSample(materialNoise, materialNoiseSampler, millUv).r;
  let authoredColor = pow(clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
  let zinc = mix(vec3<f32>(0.52, 0.55, 0.58), mix(atlasAlbedo, authoredColor, 0.46), 0.42);
  var baseColor = clamp(zinc * mix(0.96, 1.03, millGrain), vec3<f32>(0.08), vec3<f32>(0.72));
  let overlay = clamp(input.color.a, 0.0, 1.0);
  baseColor = mix(baseColor, authoredColor, overlay * 0.48);
  let metallic = mix(0.92, 0.24, overlay);
  let roughness = clamp(0.33 + (millGrain - 0.5) * 0.05, 0.28, 0.44);

  let metalFrame = surfaceTangentFrame(normal, input.worldPos, input.uv);
  let millBump = (millGrain - 0.5) * mix(0.04, 0.0, overlay);
  normal = normalize(normal + metalFrame[1] * millBump);
  let tangent = normalize(metalFrame[0] - normal * dot(metalFrame[0], normal));
  let bitangent = normalize(cross(normal, tangent));
  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);
  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(vDotH, f0);
  let ax = max(roughness * roughness * mix(0.34, 1.0, overlay), 0.0004);
  let ay = max(roughness * roughness * mix(2.45, 1.0, overlay), 0.0016);
  let distribution = distributionGGXAniso(nDotH, dot(tangent, halfVector), dot(bitangent, halfVector), ax, ay);
  let geometry = geometrySmithAniso(nDotV, dot(tangent, viewDirection), dot(bitangent, viewDirection), ax, ay)
    * geometrySmithAniso(nDotL, dot(tangent, toLight), dot(bitangent, toLight), ax, ay);
  let specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * nDotL, 0.001);
  let kD = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);
  let visibility = mix(1.0, sampleGpuSurfaceShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w);
  let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);
  let sunRadiance = mix(vec3<f32>(5.8, 5.15, 4.55), vec3<f32>(4.55, 4.15, 3.45), studioMix);
  let direct = (kD * baseColor / 3.14159265 + specular) * sunRadiance * nDotL * visibility;
  let environmentFresnel = fresnelSchlickRoughness(nDotV, f0, roughness);
  let environmentBottom = mix(vec3<f32>(0.075, 0.060, 0.052), vec3<f32>(0.042, 0.038, 0.032), studioMix);
  let environmentTop = mix(vec3<f32>(0.20, 0.34, 0.56), vec3<f32>(0.24, 0.22, 0.18), studioMix);
  var diffuseIrradiance = mix(environmentBottom, environmentTop, clamp(normal.y * 0.5 + 0.5, 0.0, 1.0))
    + mix(vec3<f32>(0.025), vec3<f32>(0.048), studioMix);
  let studioKeyWrap = max(dot(normal, normalize(vec3<f32>(-0.55, 0.72, 0.38))), 0.0);
  diffuseIrradiance = diffuseIrradiance + studioMix * vec3<f32>(0.14, 0.12, 0.09) * studioKeyWrap;
  let ambientVisibility = mix(1.0, 0.66 + 0.34 * visibility, studioMix);
  let ambientDiffuse = diffuseIrradiance * baseColor
    * (vec3<f32>(1.0) - environmentFresnel) * (1.0 - metallic) * ambientVisibility;
  var envDirection = reflect(-viewDirection, normal);
  envDirection = normalize(envDirection + tangent * dot(envDirection, tangent) * mix(0.58, 0.0, overlay));
  let outdoorEnvironment = mix(environmentBottom, vec3<f32>(0.20, 0.38, 0.68), clamp(envDirection.y * 0.5 + 0.5, 0.0, 1.0));
  let roughStudioEnvironment = mix(studioEnvironment(envDirection), vec3<f32>(0.22, 0.205, 0.175), roughness * roughness * 0.82);
  let environment = mix(outdoorEnvironment, roughStudioEnvironment, studioMix);
  let environmentSpecular = environment * environmentFresnel
    * mix(0.24, 1.0, metallic) * (1.0 - roughness * 0.52)
    * mix(1.0, 0.82 + 0.18 * visibility, studioMix);
  var color = ambientDiffuse + direct + environmentSpecular;
  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.92));
  return vec4<f32>(color, 1.0);
}
`;

const gpuClothShadowShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

struct ClothParams {
  grid : vec4<u32>,
  baseColorA : vec4<f32>,
  baseColorB : vec4<f32>,
};

@group(1) @binding(0)
var<storage, read> clothPositions : array<f32>;

@group(1) @binding(1)
var<storage, read> clothRestPositions : array<f32>;

@group(1) @binding(2)
var<uniform> clothParams : ClothParams;

fn readClothPosition(index : u32) -> vec3<f32> {
  let offset = index * 3u;
  return vec3<f32>(clothPositions[offset], clothPositions[offset + 1u], clothPositions[offset + 2u]);
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4<f32> {
  return scene.lightViewProj * vec4<f32>(readClothPosition(vertexIndex), 1.0);
}
`;

const gpuClothShader = /* wgsl */ `
${sceneUniformStruct}
${gpuSurfaceVertexOut}
${gpuSurfaceShadowSampling}
${materialAtlasSampling}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

@group(0) @binding(5)
var materialAlbedoAtlas : texture_2d<f32>;

@group(0) @binding(7)
var materialAtlasSampler : sampler;

struct ClothParams {
  grid : vec4<u32>,
  baseColorA : vec4<f32>,
  baseColorB : vec4<f32>,
};

@group(1) @binding(0)
var<storage, read> clothPositions : array<f32>;

@group(1) @binding(1)
var<storage, read> clothRestPositions : array<f32>;

@group(1) @binding(2)
var<uniform> clothParams : ClothParams;

fn readClothPosition(index : u32) -> vec3<f32> {
  let offset = index * 3u;
  return vec3<f32>(clothPositions[offset], clothPositions[offset + 1u], clothPositions[offset + 2u]);
}

fn readClothRestPosition(index : u32) -> vec3<f32> {
  let offset = index * 3u;
  return vec3<f32>(clothRestPositions[offset], clothRestPositions[offset + 1u], clothRestPositions[offset + 2u]);
}

fn clothEdgeStrain(index : u32, neighbor : u32) -> f32 {
  let restDelta = readClothRestPosition(neighbor) - readClothRestPosition(index);
  let restLength = max(length(restDelta), 0.000001);
  let currentLength = length(readClothPosition(neighbor) - readClothPosition(index));
  return abs(currentLength / restLength - 1.0);
}

// Reconstruct visual strain from the structural, shear, and bend
// neighborhoods used by the cloth solver. Rest positions are immutable, so
// they upload only when the scene/topology changes instead of every frame.
fn clothStrainAt(index : u32) -> f32 {
  let cols = clothParams.grid.x;
  let rows = clothParams.grid.y;
  let col = index % cols;
  let row = index / cols;
  var strain = 0.0;
  if (col > 0u) { strain = max(strain, clothEdgeStrain(index, index - 1u)); }
  if (col + 1u < cols) { strain = max(strain, clothEdgeStrain(index, index + 1u)); }
  if (row > 0u) { strain = max(strain, clothEdgeStrain(index, index - cols)); }
  if (row + 1u < rows) { strain = max(strain, clothEdgeStrain(index, index + cols)); }
  if (col > 0u && row > 0u) { strain = max(strain, clothEdgeStrain(index, index - cols - 1u)); }
  if (col + 1u < cols && row > 0u) { strain = max(strain, clothEdgeStrain(index, index - cols + 1u)); }
  if (col > 0u && row + 1u < rows) { strain = max(strain, clothEdgeStrain(index, index + cols - 1u)); }
  if (col + 1u < cols && row + 1u < rows) { strain = max(strain, clothEdgeStrain(index, index + cols + 1u)); }
  if (col >= 2u) { strain = max(strain, clothEdgeStrain(index, index - 2u)); }
  if (col + 2u < cols) { strain = max(strain, clothEdgeStrain(index, index + 2u)); }
  if (row >= 2u) { strain = max(strain, clothEdgeStrain(index, index - cols * 2u)); }
  if (row + 2u < rows) { strain = max(strain, clothEdgeStrain(index, index + cols * 2u)); }
  return strain;
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> GpuSurfaceVertexOut {
  let cols = clothParams.grid.x;
  let rows = clothParams.grid.y;
  let col = vertexIndex % cols;
  let row = vertexIndex / cols;
  let leftIndex = select(vertexIndex, vertexIndex - 1u, col > 0u);
  let rightIndex = select(vertexIndex, vertexIndex + 1u, col + 1u < cols);
  let upIndex = select(vertexIndex, vertexIndex - cols, row > 0u);
  let downIndex = select(vertexIndex, vertexIndex + cols, row + 1u < rows);
  let position = readClothPosition(vertexIndex);
  let columnTangent = readClothPosition(rightIndex) - readClothPosition(leftIndex);
  let rowTangent = readClothPosition(downIndex) - readClothPosition(upIndex);
  let normalCross = cross(rowTangent, columnTangent);
  let normalLengthSquared = dot(normalCross, normalCross);
  let normalizedCross = normalCross * inverseSqrt(max(normalLengthSquared, 1e-12));
  let normal = select(vec3<f32>(0.0, 1.0, 0.0), normalizedCross, normalLengthSquared > 1e-12);
  let uv = vec2<f32>(f32(col) / f32(max(cols - 1u, 1u)), f32(row) / f32(max(rows - 1u, 1u)));
  let checker = f32(((col / 2u) + (row / 2u)) & 1u);
  let strain = clamp(clothStrainAt(vertexIndex) * 3.2, 0.0, 1.0);
  let baseColor = mix(clothParams.baseColorA, clothParams.baseColorB, checker);
  let stressColor = vec4<f32>(1.0, 0.035, 0.005, strain);
  let color = mix(baseColor, stressColor, smoothstep(0.35, 1.0, strain) * 0.72);
  let world = vec4<f32>(position, 1.0);

  var out : GpuSurfaceVertexOut;
  out.clipPosition = scene.viewProj * world;
  out.worldNormal = normal;
  out.color = vec4<f32>(color.rgb, strain);
  out.worldPos = position;
  out.shadowPosition = scene.lightViewProj * world;
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(input : GpuSurfaceVertexOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4<f32> {
  let geometricNormal = normalize(input.worldNormal);
  let normal = select(-geometricNormal, geometricNormal, frontFacing);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);
  let warp = 0.5 + 0.5 * sin(input.uv.x * 1256.637 + input.uv.y * 7.0);
  let weft = 0.5 + 0.5 * sin(input.uv.y * 942.478 + input.uv.x * 5.0);
  let weave = mix(0.82, 1.12, warp * weft);
  let stress = clamp(input.color.a, 0.0, 1.0);
  let textile = textureSample(materialAlbedoAtlas, materialAtlasSampler, materialTileUv(2u, input.uv * vec2<f32>(5.0, 4.0))).rgb;
  let tint = pow(clamp(input.color.rgb * weave, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
  let baseColor = tint * mix(vec3<f32>(1.0), textile * 1.55, 0.48);
  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let visibility = mix(1.0, sampleGpuSurfaceShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w);
  let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);
  let studioAmbient = studioEnvironment(normal) * 0.34 * (0.70 + visibility * 0.30);
  let diffuseAmbient = mix(vec3<f32>(0.16, 0.22, 0.34), studioAmbient, studioMix);
  let diffuse = baseColor * (diffuseAmbient + vec3<f32>(3.7, 3.35, 3.0) * nDotL * visibility);
  let fiberSpecular = pow(nDotH, mix(42.0, 115.0, warp)) * (0.16 + stress * 0.24) * visibility;
  let backLight = pow(max(dot(-normal, toLight), 0.0), 1.7) * baseColor
    * mix(vec3<f32>(0.95, 0.38, 0.18), vec3<f32>(0.62, 0.64, 0.66), studioMix) * 0.42;
  let rim = pow(1.0 - nDotV, 3.0)
    * mix(mix(vec3<f32>(0.08, 0.22, 0.46), vec3<f32>(1.0, 0.12, 0.03), stress), vec3<f32>(0.16), studioMix)
    * mix(0.65, 0.28, studioMix);
  let stressGlow = vec3<f32>(1.4, 0.05, 0.01) * pow(stress, 3.0) * mix(1.4, 0.34, studioMix);
  var color = diffuse + vec3<f32>(fiberSpecular) + backLight + rim + stressGlow;
  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.90));
  return vec4<f32>(color, 1.0);
}
`;

const gpuWaterShader = /* wgsl */ `
${sceneUniformStruct}
${gpuSurfaceVertexOut}
${gpuSurfaceShadowSampling}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

struct WaterParams {
  grid : vec4<u32>,
  extent : vec4<f32>,
};

@group(1) @binding(0)
var<storage, read> waterEta : array<f32>;

@group(1) @binding(1)
var<storage, read> waterU : array<f32>;

@group(1) @binding(2)
var<storage, read> waterV : array<f32>;

@group(1) @binding(3)
var<uniform> waterParams : WaterParams;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> GpuSurfaceVertexOut {
  let cols = waterParams.grid.x;
  let rows = waterParams.grid.y;
  let col = vertexIndex % cols;
  let row = vertexIndex / cols;
  let leftIndex = select(vertexIndex, vertexIndex - 1u, col > 0u);
  let rightIndex = select(vertexIndex, vertexIndex + 1u, col + 1u < cols);
  let upIndex = select(vertexIndex, vertexIndex - cols, row > 0u);
  let downIndex = select(vertexIndex, vertexIndex + cols, row + 1u < rows);
  let width = waterParams.extent.x;
  let depth = waterParams.extent.y;
  let cellX = width / f32(max(cols - 1u, 1u));
  let cellZ = depth / f32(max(rows - 1u, 1u));
  let x = -width * 0.5 + f32(col) * cellX;
  let z = -depth * 0.5 + f32(row) * cellZ;
  let position = vec3<f32>(x, waterParams.extent.z + waterEta[vertexIndex], z);
  let slopeX = (waterEta[leftIndex] - waterEta[rightIndex]) / max(cellX * 2.0, 0.0001);
  let slopeZ = (waterEta[upIndex] - waterEta[downIndex]) / max(cellZ * 2.0, 0.0001);
  let normal = normalize(vec3<f32>(slopeX, 1.0, slopeZ));
  let curvature = abs(waterEta[leftIndex] + waterEta[rightIndex] + waterEta[upIndex] + waterEta[downIndex] - waterEta[vertexIndex] * 4.0);
  let current = length(vec2<f32>(waterU[vertexIndex], waterV[vertexIndex]));
  let foam = clamp(curvature * 4.5 + current * 0.12, 0.0, 1.0);
  let uv = vec2<f32>(f32(col) / f32(max(cols - 1u, 1u)), f32(row) / f32(max(rows - 1u, 1u)));
  let depthColor = mix(vec3<f32>(0.006, 0.075, 0.14), vec3<f32>(0.025, 0.32, 0.48), clamp(waterEta[vertexIndex] * 0.18 + 0.5, 0.0, 1.0));
  let world = vec4<f32>(position, 1.0);

  var out : GpuSurfaceVertexOut;
  out.clipPosition = scene.viewProj * world;
  out.worldNormal = normal;
  out.color = vec4<f32>(depthColor, foam);
  out.worldPos = position;
  out.shadowPosition = scene.lightViewProj * world;
  out.uv = uv;
  return out;
}

@fragment
fn fsMain(input : GpuSurfaceVertexOut, @builtin(front_facing) frontFacing : bool) -> @location(0) vec4<f32> {
  let geometricNormal = normalize(input.worldNormal);
  var normal = select(-geometricNormal, geometricNormal, frontFacing);
  let microA = sin(input.worldPos.x * 8.7 + scene.cameraPosTime.w * 1.3) * 0.018;
  let microB = cos(input.worldPos.z * 10.3 - scene.cameraPosTime.w * 1.1) * 0.018;
  normal = normalize(normal + vec3<f32>(microA, 0.0, microB));
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let fresnel = 0.025 + 0.975 * pow(1.0 - nDotV, 5.0);
  let foam = clamp(input.color.a, 0.0, 1.0);
  let visibility = mix(1.0, sampleGpuSurfaceShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w * 0.7);
  let depthTint = pow(clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(2.2));
  let skyReflection = mix(vec3<f32>(0.05, 0.18, 0.34), vec3<f32>(0.34, 0.58, 0.92), clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));
  let sunGlint = pow(nDotH, 230.0) * vec3<f32>(14.0, 10.5, 7.0) * visibility;
  let broadSpecular = pow(nDotH, 42.0) * vec3<f32>(1.4, 1.8, 2.4) * visibility;
  let subsurface = depthTint * (0.30 + 0.70 * nDotL) * vec3<f32>(0.26, 0.72, 0.86);
  let foamColor = vec3<f32>(0.82, 0.94, 1.0) * (0.75 + nDotL * 1.4);
  var color = mix(subsurface, skyReflection, fresnel) + sunGlint + broadSpecular;
  color = mix(color, foamColor, foam * 0.88);
  color = color + vec3<f32>(0.02, 0.16, 0.24) * (1.0 - nDotV) * 0.8;
  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.014);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.78));
  let alpha = clamp(0.56 + fresnel * 0.24 + foam * 0.20, 0.56, 0.96);
  return vec4<f32>(color, alpha);
}
`;

const ropeComputeShader = /* wgsl */ `
struct RopeUniforms {
  baseInstance : u32,
  segmentCount : u32,
  nodeCount : u32,
  presentation : u32,
};

@group(0) @binding(0)
var<uniform> rope : RopeUniforms;

@group(0) @binding(1)
var<storage, read> ropePositions : array<f32>;

// Eight float words per segment:
// nodeA, nodeB, inverseRestLength, radius, baseColor.rgba.
@group(0) @binding(2)
var<storage, read> ropeSegments : array<f32>;

@group(0) @binding(3)
var<storage, read_write> modelMatrices : array<mat4x4<f32>>;

@group(0) @binding(4)
var<storage, read_write> instanceColors : array<vec4<f32>>;

fn ropePositionAt(index : u32) -> vec3<f32> {
  let offset = index * 3u;
  return vec3<f32>(
    ropePositions[offset],
    ropePositions[offset + 1u],
    ropePositions[offset + 2u]
  );
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id : vec3<u32>) {
  let segmentIndex = id.x;
  if (segmentIndex >= rope.segmentCount) { return; }

  let segmentOffset = segmentIndex * 8u;
  let nodeA = u32(ropeSegments[segmentOffset]);
  let nodeB = u32(ropeSegments[segmentOffset + 1u]);
  if (nodeA >= rope.nodeCount || nodeB >= rope.nodeCount) { return; }

  let inverseRestLength = ropeSegments[segmentOffset + 2u];
  let baseRadius = ropeSegments[segmentOffset + 3u];
  let baseColor = vec4<f32>(
    ropeSegments[segmentOffset + 4u],
    ropeSegments[segmentOffset + 5u],
    ropeSegments[segmentOffset + 6u],
    ropeSegments[segmentOffset + 7u]
  );

  let a = ropePositionAt(nodeA);
  let b = ropePositionAt(nodeB);
  let delta = b - a;
  let lengthSquared = dot(delta, delta);
  let rawLength = select(0.0, sqrt(lengthSquared), lengthSquared > 0.0);
  let safeLength = max(rawLength, 0.0001);
  let yAxis = delta / safeLength;

  var xAxis : vec3<f32>;
  if (abs(yAxis.y) < 0.92) {
    xAxis = vec3<f32>(yAxis.z, 0.0, -yAxis.x);
  } else {
    xAxis = vec3<f32>(-yAxis.y, yAxis.x, 0.0);
  }
  let xLength = max(length(xAxis), 0.000001);
  xAxis = xAxis / xLength;
  let zAxis = cross(yAxis, xAxis);

  let signedStrain = rawLength * inverseRestLength - 1.0;
  let materialMode = rope.presentation == 1u;
  let strainScale = select(4.2, 24.0, materialMode);
  let demand = clamp(abs(signedStrain) * strainScale, 0.0, 1.0);
  let tension = clamp(signedStrain * strainScale, 0.0, 1.0);
  let heat = select(tension, demand, materialMode);
  let compression = select(0.0, clamp(-signedStrain * strainScale, 0.0, 1.0), materialMode);
  let radius = baseRadius * (1.0 - tension * 0.2 + compression * 0.08);
  let outputIndex = rope.baseInstance + segmentIndex;
  modelMatrices[outputIndex] = mat4x4<f32>(
    vec4<f32>(xAxis * radius, 0.0),
    vec4<f32>(yAxis * safeLength * 0.5, 0.0),
    vec4<f32>(zAxis * radius, 0.0),
    vec4<f32>((a + b) * 0.5, 1.0)
  );
  let outputAlpha = select(mix(baseColor.a, 2.2, heat), baseColor.a, materialMode && baseColor.a < 0.0);
  instanceColors[outputIndex] = vec4<f32>(
    mix(mix(baseColor.r, 0.05, compression), 1.0, heat - compression * heat),
    mix(mix(baseColor.g, 0.34, compression), 0.06, heat - compression * heat),
    mix(mix(baseColor.b, 1.0, compression), 0.02, heat - compression * heat),
    outputAlpha
  );
}
`;

const skyShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out : VertexOut;
  let p = positions[vertexIndex];
  out.clipPosition = vec4<f32>(p, 0.9999, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let studioMix = select(0.0, 1.0, scene.qualityModes.w > 0.5);
  let top = mix(vec3<f32>(0.006, 0.014, 0.035), vec3<f32>(0.24, 0.21, 0.16), studioMix);
  let middle = mix(vec3<f32>(0.035, 0.10, 0.19), vec3<f32>(0.20, 0.175, 0.14), studioMix);
  let horizonColor = mix(vec3<f32>(0.19, 0.25, 0.31), vec3<f32>(0.15, 0.13, 0.105), studioMix);
  let vertical = clamp(uv.y, 0.0, 1.0);
  var color = mix(horizonColor, middle, smoothstep(0.0, 0.44, vertical));
  color = mix(color, top, smoothstep(0.42, 1.0, vertical));

  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let sunPosition = vec2<f32>(0.68 - lightDirection.x * 0.22, 0.72 + lightDirection.y * 0.08);
  let sunDistance = distance(uv, sunPosition);
  let sunCore = exp(-sunDistance * sunDistance * 1400.0);
  let sunGlow = exp(-sunDistance * sunDistance * 42.0);
  color = color + (1.0 - studioMix) * (vec3<f32>(8.0, 5.2, 2.6) * sunCore + vec3<f32>(0.55, 0.28, 0.12) * sunGlow);

  let starCell = floor(uv * vec2<f32>(1100.0, 620.0));
  let star = step(0.9978, hash21(starCell)) * smoothstep(0.5, 0.9, vertical);
  color = color + vec3<f32>(star * 1.8 * (1.0 - studioMix));

  let haze = pow(max(0.0, 1.0 - abs(vertical - 0.31) * 3.2), 4.0);
  color = color + mix(vec3<f32>(0.12, 0.11, 0.09), vec3<f32>(0.04, 0.034, 0.026), studioMix) * haze;
  // Warehouse cyclorama: warm CMU bounce and high-bay discs. Keep this brighter
  // than a night sky so loading-bay leaks still read as shop ceiling, not dusk.
  let floorFalloff = 1.0 - smoothstep(0.0, 0.30, vertical);
  let wallWash = exp(-pow((uv.x - 0.50) * 1.45, 2.0) - pow((uv.y - 0.43) * 2.4, 2.0));
  color = color + vec3<f32>(0.045, 0.038, 0.028) * wallWash * studioMix;
  let bayA = exp(-pow((uv.x - 0.28) * 7.5, 2.0) - pow((uv.y - 0.84) * 11.0, 2.0));
  let bayB = exp(-pow((uv.x - 0.50) * 7.5, 2.0) - pow((uv.y - 0.86) * 11.0, 2.0));
  let bayC = exp(-pow((uv.x - 0.72) * 7.5, 2.0) - pow((uv.y - 0.83) * 11.0, 2.0));
  color = color + vec3<f32>(0.28, 0.24, 0.16) * (bayA + bayB + bayC) * studioMix;
  color = mix(color, color * vec3<f32>(0.72, 0.66, 0.55), floorFalloff * studioMix);
  return vec4<f32>(color, 1.0);
}
`;

const lineShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) color : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
  var out : VertexOut;
  out.clipPosition = scene.viewProj * vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color.rgb * 1.8, input.color.a);
}
`;

const postShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var hdrTexture : texture_2d<f32>;

@group(0) @binding(1)
var hdrSampler : sampler;

@group(0) @binding(2)
var<uniform> scene : SceneUniforms;

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out : VertexOut;
  let p = positions[vertexIndex];
  out.clipPosition = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn acesFilm(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  // WebGPU render targets use a top-left texture origin while fullscreen
  // triangle UVs are generated from bottom-left NDC. Flip V exactly once
  // when presenting the resolved HDR target to the swapchain.
  let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
  let texel = vec2<f32>(1.0) / max(scene.viewportBloomShadow.xy, vec2<f32>(1.0));
  var color = textureSample(hdrTexture, hdrSampler, uv).rgb;

  let directions = array<vec2<f32>, 8>(
    vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0),
    vec2<f32>(0.707, 0.707), vec2<f32>(-0.707, 0.707),
    vec2<f32>(0.707, -0.707), vec2<f32>(-0.707, -0.707)
  );

  // A uniform branch avoids full-resolution HDR reads when bloom is
  // disabled. Luminance gating preserves highlight hue instead of clipping
  // individual RGB channels into colored halos.
  if (scene.viewportBloomShadow.z > 0.001) {
    var bloom = vec3<f32>(0.0);
    let directionCount : i32 = select(4, 8, scene.qualityModes.y > 1.5);
    for (var i : i32 = 0; i < directionCount; i = i + 1) {
      let sampleColor = textureSample(hdrTexture, hdrSampler, uv + directions[i] * texel * 3.0).rgb;
      let peak = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
      let bloomMask = smoothstep(0.95, 1.90, peak) * max(peak - 0.80, 0.0) / max(peak, 0.001);
      bloom = bloom + sampleColor * bloomMask;
    }
    let studioBloomScale = select(1.0, 0.28, scene.qualityModes.w > 0.5);
    color = color + bloom * (scene.viewportBloomShadow.z * studioBloomScale * (0.38 / f32(directionCount)));
  }
  let studioExposure = select(1.0, 1.07, scene.qualityModes.w > 0.5);
  color = color * scene.lightDirExposure.w * studioExposure;
  color = acesFilm(color);

  let centered = uv - vec2<f32>(0.5);
  let vignetteStrength = select(0.13, 0.075, scene.qualityModes.w > 0.5);
  let vignette = 1.0 - smoothstep(0.38, 0.76, length(centered)) * vignetteStrength;
  color = color * vignette;

  // No time-driven film grain: paused simulations and deterministic captures
  // must resolve to identical pixels.
  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
`;

function cubeVertexData(): Float32Array {
  return new Float32Array([
    1, -1, -1, 1, 0, 0,  1, 1, -1, 1, 0, 0,  1, 1, 1, 1, 0, 0,
    1, -1, -1, 1, 0, 0,  1, 1, 1, 1, 0, 0,  1, -1, 1, 1, 0, 0,
    -1, -1, 1, -1, 0, 0,  -1, 1, 1, -1, 0, 0,  -1, 1, -1, -1, 0, 0,
    -1, -1, 1, -1, 0, 0,  -1, 1, -1, -1, 0, 0,  -1, -1, -1, -1, 0, 0,
    -1, 1, -1, 0, 1, 0,  -1, 1, 1, 0, 1, 0,  1, 1, 1, 0, 1, 0,
    -1, 1, -1, 0, 1, 0,  1, 1, 1, 0, 1, 0,  1, 1, -1, 0, 1, 0,
    -1, -1, 1, 0, -1, 0,  -1, -1, -1, 0, -1, 0,  1, -1, -1, 0, -1, 0,
    -1, -1, 1, 0, -1, 0,  1, -1, -1, 0, -1, 0,  1, -1, 1, 0, -1, 0,
    1, -1, 1, 0, 0, 1,  1, 1, 1, 0, 0, 1,  -1, 1, 1, 0, 0, 1,
    1, -1, 1, 0, 0, 1,  -1, 1, 1, 0, 0, 1,  -1, -1, 1, 0, 0, 1,
    -1, -1, -1, 0, 0, -1,  -1, 1, -1, 0, 0, -1,  1, 1, -1, 0, 0, -1,
    -1, -1, -1, 0, 0, -1,  1, 1, -1, 0, 0, -1,  1, -1, -1, 0, 0, -1,
  ]);
}

function ptrToNumber(ptr: number | bigint): number {
  return typeof ptr === 'bigint' ? Number(ptr) : ptr;
}

function containsTransparentMaterial(values: ArrayLike<number>, start: number, count: number): boolean {
  for (let i = 0; i < count; i++) {
    const materialId = Math.round(Math.max(-values[start + i * 4 + 3], 0));
    if (materialId === 4 || materialId === 6) return true;
  }
  return false;
}

function writeFloatBuffer(
  queue: GPUQueue,
  buffer: GPUBuffer,
  offset: number,
  data: Float32Array,
  floatCount = data.length,
  sourceFloatOffset = 0,
): void {
  const safeCount = Math.max(0, Math.min(floatCount, data.length - sourceFloatOffset));
  if (safeCount === 0) return;
  queue.writeBuffer(
    buffer,
    offset,
    data.buffer as unknown as BufferSource,
    data.byteOffset + sourceFloatOffset * Float32Array.BYTES_PER_ELEMENT,
    safeCount * Float32Array.BYTES_PER_ELEMENT,
  );
}

function writeByteBuffer(
  queue: GPUQueue,
  buffer: GPUBuffer,
  offset: number,
  data: ArrayBufferView,
  byteCount = data.byteLength,
  sourceByteOffset = 0,
): void {
  const safeCount = Math.max(0, Math.min(byteCount, data.byteLength - sourceByteOffset));
  if (safeCount === 0) return;
  queue.writeBuffer(buffer, offset, data.buffer as unknown as BufferSource, data.byteOffset + sourceByteOffset, safeCount);
}

function fillLineVertexData(lines: readonly DebugLine[], maxVertices: number, out: Float32Array): number {
  const maxFloats = Math.min(out.length, Math.min(maxVertices, lines.length * 2) * 7);
  let cursor = 0;
  for (let i = 0; i < lines.length && cursor + 14 <= maxFloats; i++) {
    const line = lines[i];
    out[cursor++] = line.ax;
    out[cursor++] = line.ay;
    out[cursor++] = line.az;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
    out[cursor++] = line.bx;
    out[cursor++] = line.by;
    out[cursor++] = line.bz;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
  }
  return cursor;
}

function instanceVertexBuffers(): GPUVertexBufferLayout[] {
  return [
    {
      arrayStride: 6 * 4,
      stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
      ],
    },
    {
      arrayStride: 16 * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 2, offset: 0, format: 'float32x4' },
        { shaderLocation: 3, offset: 4 * 4, format: 'float32x4' },
        { shaderLocation: 4, offset: 8 * 4, format: 'float32x4' },
        { shaderLocation: 5, offset: 12 * 4, format: 'float32x4' },
      ],
    },
    {
      arrayStride: 4 * 4,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 6, offset: 0, format: 'float32x4' }],
    },
  ];
}


function surfaceVertexBuffers(): GPUVertexBufferLayout[] {
  return [{
    arrayStride: SURFACE_VERTEX_BYTES,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'snorm16x2' },
      { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
      { shaderLocation: 3, offset: 20, format: 'unorm16x2' },
    ],
  }];
}

async function validateShaderModule(module: GPUShaderModule, label: string): Promise<void> {
  if (!module.getCompilationInfo) return;
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  const warnings = info.messages.filter((message) => message.type === 'warning');
  if (warnings.length > 0) {
    console.warn(`[WebGPU] ${label} warnings:
${warnings.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n')}`);
  }
  if (errors.length > 0) {
    throw new Error(`${label} failed WGSL validation:
${errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n')}`);
  }
}

type MainPipelineSet = Readonly<{
  sky: GPURenderPipeline;
  solid: GPURenderPipeline;
  transparentSolid: GPURenderPipeline;
  cloth: GPURenderPipeline;
  sheet: GPURenderPipeline;
  gpuCloth: GPURenderPipeline;
  gpuWater: GPURenderPipeline;
  line: GPURenderPipeline;
}>;

export interface WebGPURendererOptions extends GpuStartupOptions {
  /** Enabled when timestamp-query is supported. Defaults to one sample per 30 frames. */
  gpuTiming?: boolean | GpuTimingOptions;
  /** Opt-in until the complete-frame crossover is qualified on target adapters. */
  instancePartitioning?: boolean;
}

export interface WebGPUDeviceLossInfo {
  readonly reason: string;
  readonly message: string;
}

type TimedRenderPassDescriptor = GPURenderPassDescriptor & { timestampWrites?: GpuPassTimestampWrites };
type TimedComputePassDescriptor = GPUComputePassDescriptor & { timestampWrites?: GpuPassTimestampWrites };

export class WebGPURenderer {
  readonly canvas: HTMLCanvasElement;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly maxInstances: number;

  private readonly gpuTimer: GpuPassTimer;
  private instancePartition: InstancePartition | null;
  private disposed = false;
  private deviceLoss: WebGPUDeviceLossInfo | null = null;
  private readonly deviceLostListeners = new Set<(info: WebGPUDeviceLossInfo) => void>();

  private shadowPipeline: GPURenderPipeline;
  private surfaceShadowPipeline: GPURenderPipeline;
  private gpuClothShadowPipeline: GPURenderPipeline;
  private readonly mainPipelines1x: MainPipelineSet;
  private readonly mainPipelines4x: MainPipelineSet;
  private mainPipelines: MainPipelineSet;
  private postPipeline: GPURenderPipeline;
  private ropeComputePipeline: GPUComputePipeline;
  private shadowBindGroup: GPUBindGroup;
  private sceneBindGroup: GPUBindGroup;
  private sceneBindGroupLayout: GPUBindGroupLayout;
  private gpuClothBindGroup: GPUBindGroup;
  private gpuWaterBindGroup: GPUBindGroup;
  private gpuWaterBindGroupLayout: GPUBindGroupLayout;
  private residentWater: ResidentWaterSurface | null = null;
  private ropeComputeBindGroup: GPUBindGroup;
  private postBindGroup: GPUBindGroup | null = null;
  private postBindGroupLayout: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer;
  private vertexBuffer: GPUBuffer;
  private matrixBuffer: GPUBuffer;
  private colorBuffer: GPUBuffer;
  private ropePositionBuffer: GPUBuffer;
  private ropeSegmentBuffer: GPUBuffer;
  private ropeUniformBuffer: GPUBuffer;
  private lineBuffer: GPUBuffer;
  private surfaceVertexBuffer: GPUBuffer;
  private surfaceIndexBuffer: GPUBuffer;
  private clothPositionBuffer: GPUBuffer;
  private clothRestPositionBuffer: GPUBuffer;
  private clothParamsBuffer: GPUBuffer;
  private waterEtaBuffer: GPUBuffer;
  private waterUBuffer: GPUBuffer;
  private waterVBuffer: GPUBuffer;
  private waterParamsBuffer: GPUBuffer;
  private rigidSourceIdentity: InstanceBufferSource | null = null;
  private rigidHeapIdentity: ArrayBufferLike | null = null;
  private rigidMatrixByteOffset = -1;
  private rigidColorByteOffset = -1;
  private rigidCount = -1;
  private rigidFrameVersion = -1;
  private rigidColorVersion = -1;
  private rigidHasTransparentMaterial = false;
  private readonly shadowCache = new ShadowPassCache();
  private effectMatrixIdentity: ArrayBufferLike | null = null;
  private effectColorIdentity: ArrayBufferLike | null = null;
  private effectMatrixByteOffset = -1;
  private effectColorByteOffset = -1;
  private effectBase = -1;
  private effectCount = -1;
  private effectFrameVersion = -1;
  private effectHasTransparentMaterial = false;
  private lineSourceIdentity: readonly DebugLine[] | null = null;
  private lineSourceCount = -1;
  private lineFrameVersion = -1;
  private lineFloatCount = 0;
  private surfaceVertexCount = 0;
  private surfaceIndexCount = 0;
  private surfaceMaterial: DynamicSurfaceFrame['material'] | null = null;
  private surfacePath: DynamicSurfaceFrame['path'] | null = null;
  private surfaceFrameVersion = -1;
  private surfaceStateViewCount = 0;
  private surfaceStateBufferIdentity0: ArrayBufferLike | null = null;
  private surfaceStateBufferIdentity1: ArrayBufferLike | null = null;
  private surfaceStateBufferIdentity2: ArrayBufferLike | null = null;
  private surfaceStateByteOffset0 = -1;
  private surfaceStateByteOffset1 = -1;
  private surfaceStateByteOffset2 = -1;
  private surfaceStateByteLength0 = -1;
  private surfaceStateByteLength1 = -1;
  private surfaceStateByteLength2 = -1;
  private surfaceCachedVertexCount = 0;
  // Keep the dynamic-surface configuration in one compact numeric block. Besides
  // avoiding per-frame string construction, this preserves the renderer object's
  // hot property shape for unrelated rigid and rope upload paths.
  private readonly surfaceConfig = new Float64Array(11).fill(Number.NaN);
  private clothRestPositionIdentity: ArrayBufferLike | null = null;
  private clothRestPositionByteOffset = -1;
  private clothRestPositionByteLength = -1;
  private clothRestTopologyVersion = -1;
  private softInstanceMatrixIdentity: ArrayBufferLike | null = null;
  private softInstanceColorIdentity: ArrayBufferLike | null = null;
  private softInstanceMatrixByteOffset = -1;
  private softInstanceColorByteOffset = -1;
  private softInstanceMatrixByteLength = -1;
  private softInstanceColorByteLength = -1;
  private softInstanceBase = -1;
  private softInstanceCount = -1;
  private softInstanceFrameVersion = -1;
  private softHasTransparentMaterial = false;
  private ropeGridSegmentCount = 0;
  private ropeGridNodeCount = 0;
  private ropeGridBaseInstance = 0;
  private ropeGridActive = false;
  private ropeGridDispatchPending = false;
  private ropeGridFrameVersion = -1;
  private ropeGridTopologyVersion = -1;
  private ropeGridPresentation = -1;
  private ropeGridPositionIdentity: ArrayBufferLike | null = null;
  private ropeGridPositionByteOffset = -1;
  private ropeGridSegmentIdentity: ArrayBufferLike | null = null;
  private ropeGridSegmentByteOffset = -1;
  private ropeGridHasTransparentMaterial = false;
  private surfaceIndexBufferIdentity: ArrayBufferLike | null = null;
  private surfaceIndexByteOffset = -1;
  private surfaceIndexByteLength = -1;
  private surfaceTopologyVersion = -1;
  private surfaceCachedIndexCount = 0;
  private surfaceCachedMaxIndex = -1;
  private shadowTexture: GPUTexture;
  private shadowView: GPUTextureView;
  private shadowSampler: GPUSampler;
  private linearSampler: GPUSampler;
  private materialNoiseTexture: GPUTexture;
  private materialNoiseView: GPUTextureView;
  private materialNoiseSampler: GPUSampler;
  private materialNoiseInfo: Pick<MaterialNoiseTexture, 'compressed' | 'sourceBytes' | 'source'>;
  private materialAtlasAlbedoTexture: GPUTexture;
  private materialAtlasAlbedoView: GPUTextureView;
  private materialAtlasSurfaceTexture: GPUTexture;
  private materialAtlasSurfaceView: GPUTextureView;
  private materialAtlasSampler: GPUSampler;
  private materialAtlasInfo: Pick<MaterialAtlasTexture, 'compressed' | 'sourceBytes' | 'source'>;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private msaaTexture: GPUTexture | null = null;
  private msaaView: GPUTextureView | null = null;
  private hdrTexture: GPUTexture | null = null;
  private hdrView: GPUTextureView | null = null;
  private width = 0;
  private height = 0;
  private resolutionScale = 1;
  private sampleCount: 1 | 4 = DEFAULT_SAMPLE_COUNT;
  private shadowMapSize: 1024 | 2048 = DEFAULT_SHADOW_MAP_SIZE;
  private lastUploadedBytes = 0;
  private uniformScratch = new Float32Array(SCENE_UNIFORM_FLOATS);
  private readonly lineScratch = new Float32Array(MAX_DEBUG_LINE_VERTICES * 7);
  private readonly surfaceIndexUploadScratch = new Uint8Array(MAX_DYNAMIC_SURFACE_INDICES * Uint16Array.BYTES_PER_ELEMENT + 4);
  private readonly clothParamsScratch = new ArrayBuffer(SURFACE_PARAMS_BYTES);
  private readonly waterParamsScratch = new ArrayBuffer(SURFACE_PARAMS_BYTES);
  private readonly ropeGridUniformScratch = new ArrayBuffer(ROPE_GRID_UNIFORM_BYTES);

  private constructor(args: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    maxInstances: number;
    shadowPipeline: GPURenderPipeline;
    surfaceShadowPipeline: GPURenderPipeline;
    gpuClothShadowPipeline: GPURenderPipeline;
    mainPipelines1x: MainPipelineSet;
    mainPipelines4x: MainPipelineSet;
    postPipeline: GPURenderPipeline;
    ropeComputePipeline: GPUComputePipeline;
    shadowBindGroup: GPUBindGroup;
    sceneBindGroup: GPUBindGroup;
    sceneBindGroupLayout: GPUBindGroupLayout;
    gpuClothBindGroup: GPUBindGroup;
    gpuWaterBindGroup: GPUBindGroup;
    gpuWaterBindGroupLayout: GPUBindGroupLayout;
    ropeComputeBindGroup: GPUBindGroup;
    postBindGroupLayout: GPUBindGroupLayout;
    uniformBuffer: GPUBuffer;
    vertexBuffer: GPUBuffer;
    matrixBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    ropePositionBuffer: GPUBuffer;
    ropeSegmentBuffer: GPUBuffer;
    ropeUniformBuffer: GPUBuffer;
    lineBuffer: GPUBuffer;
    surfaceVertexBuffer: GPUBuffer;
    surfaceIndexBuffer: GPUBuffer;
    clothPositionBuffer: GPUBuffer;
    clothRestPositionBuffer: GPUBuffer;
    clothParamsBuffer: GPUBuffer;
    waterEtaBuffer: GPUBuffer;
    waterUBuffer: GPUBuffer;
    waterVBuffer: GPUBuffer;
    waterParamsBuffer: GPUBuffer;
    shadowTexture: GPUTexture;
    shadowView: GPUTextureView;
    shadowSampler: GPUSampler;
    linearSampler: GPUSampler;
    materialNoise: MaterialNoiseTexture;
    materialAtlas: MaterialAtlasTexture;
    gpuTiming: GpuTimingOptions;
    instancePartition: InstancePartition | null;
  }) {
    this.canvas = args.canvas;
    this.device = args.device;
    this.context = args.context;
    this.format = args.format;
    this.maxInstances = args.maxInstances;
    this.gpuTimer = new GpuPassTimer(args.device, args.gpuTiming);
    this.instancePartition = args.instancePartition;
    this.shadowPipeline = args.shadowPipeline;
    this.surfaceShadowPipeline = args.surfaceShadowPipeline;
    this.gpuClothShadowPipeline = args.gpuClothShadowPipeline;
    this.mainPipelines1x = args.mainPipelines1x;
    this.mainPipelines4x = args.mainPipelines4x;
    this.mainPipelines = args.mainPipelines4x;
    this.postPipeline = args.postPipeline;
    this.ropeComputePipeline = args.ropeComputePipeline;
    this.shadowBindGroup = args.shadowBindGroup;
    this.sceneBindGroup = args.sceneBindGroup;
    this.sceneBindGroupLayout = args.sceneBindGroupLayout;
    this.gpuClothBindGroup = args.gpuClothBindGroup;
    this.gpuWaterBindGroup = args.gpuWaterBindGroup;
    this.gpuWaterBindGroupLayout = args.gpuWaterBindGroupLayout;
    this.ropeComputeBindGroup = args.ropeComputeBindGroup;
    this.postBindGroupLayout = args.postBindGroupLayout;
    this.uniformBuffer = args.uniformBuffer;
    this.vertexBuffer = args.vertexBuffer;
    this.matrixBuffer = args.matrixBuffer;
    this.colorBuffer = args.colorBuffer;
    this.ropePositionBuffer = args.ropePositionBuffer;
    this.ropeSegmentBuffer = args.ropeSegmentBuffer;
    this.ropeUniformBuffer = args.ropeUniformBuffer;
    this.lineBuffer = args.lineBuffer;
    this.surfaceVertexBuffer = args.surfaceVertexBuffer;
    this.surfaceIndexBuffer = args.surfaceIndexBuffer;
    this.clothPositionBuffer = args.clothPositionBuffer;
    this.clothRestPositionBuffer = args.clothRestPositionBuffer;
    this.clothParamsBuffer = args.clothParamsBuffer;
    this.waterEtaBuffer = args.waterEtaBuffer;
    this.waterUBuffer = args.waterUBuffer;
    this.waterVBuffer = args.waterVBuffer;
    this.waterParamsBuffer = args.waterParamsBuffer;
    this.shadowTexture = args.shadowTexture;
    this.shadowView = args.shadowView;
    this.shadowSampler = args.shadowSampler;
    this.linearSampler = args.linearSampler;
    this.materialNoiseTexture = args.materialNoise.texture;
    this.materialNoiseView = args.materialNoise.view;
    this.materialNoiseSampler = args.materialNoise.sampler;
    this.materialNoiseInfo = { compressed: args.materialNoise.compressed, sourceBytes: args.materialNoise.sourceBytes, source: args.materialNoise.source };
    this.materialAtlasAlbedoTexture = args.materialAtlas.albedoTexture;
    this.materialAtlasAlbedoView = args.materialAtlas.albedoView;
    this.materialAtlasSurfaceTexture = args.materialAtlas.surfaceTexture;
    this.materialAtlasSurfaceView = args.materialAtlas.surfaceView;
    this.materialAtlasSampler = args.materialAtlas.sampler;
    this.materialAtlasInfo = { compressed: args.materialAtlas.compressed, sourceBytes: args.materialAtlas.sourceBytes, source: args.materialAtlas.source };
    const lost = (args.device as GPUDevice & { lost?: Promise<WebGPUDeviceLossInfo> }).lost;
    void lost?.then((info) => this.notifyDeviceLost(info), (error: unknown) => this.notifyDeviceLost({
      reason: 'unknown', message: error instanceof Error ? error.message : String(error),
    }));
  }

  static async create(canvas: HTMLCanvasElement, maxInstances: number, options: WebGPURendererOptions = {}): Promise<WebGPURenderer> {
    const gpu = navigator.gpu;
    if (!gpu) {
      throw new Error('navigator.gpu is unavailable. Open this over localhost/HTTPS in a WebGPU-capable browser.');
    }

    const startup = new GpuStartupBudget(options, 'Renderer');
    const adapter = await startup.wait('Selecting graphics adapter', () => gpu.requestAdapter({ powerPreference: 'high-performance' }));
    if (!adapter) throw new Error('No WebGPU adapter was returned by the browser.');
    const supportsBc = adapter.features?.has('texture-compression-bc') ?? false;
    const supportsAstc = adapter.features?.has('texture-compression-astc') ?? false;
    const gpuTiming: GpuTimingOptions = typeof options.gpuTiming === 'object'
      ? options.gpuTiming : { enabled: options.gpuTiming !== false };
    const supportsTimestamps = gpuTiming.enabled !== false && (adapter.features?.has('timestamp-query') ?? false);
    const requiredFeatures = [
      ...(supportsBc ? ['texture-compression-bc'] : []),
      ...(supportsAstc ? ['texture-compression-astc'] : []),
      ...(supportsTimestamps ? ['timestamp-query'] : []),
    ];
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a webgpu canvas context.');
    // Optional instrumentation must not prevent startup if a driver advertises
    // timestamp-query but rejects enabling it. Preserve compression features.
    const device = await startup.wait('Creating graphics device', () => adapter.requestDevice({ requiredFeatures }).catch((error: unknown) => {
      startup.check('Creating graphics device');
      if (!supportsTimestamps) throw error;
      return adapter.requestDevice({ requiredFeatures: requiredFeatures.filter((feature) => feature !== 'timestamp-query') });
    }), lateDevice => (lateDevice as GPUDevice & { destroy?(): void }).destroy?.());
    let renderer: WebGPURenderer | null = null;
    const textureLoading = new AbortController();
    try {
    // Texture fetch/decode/upload is independent of buffer and shader setup.
    // Keep it in flight while the renderer builds its layouts and pipelines.
    const materialTexturesPromise = Promise.all([
      loadMaterialNoiseTexture(device, supportsBc, textureLoading.signal),
      loadMaterialAtlasTexture(device, supportsAstc, textureLoading.signal),
    ]);
    // Attach a handler immediately while independent shader work is awaited.
    void materialTexturesPromise.catch(() => {});

    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const cube = cubeVertexData();
    const vertexBuffer = device.createBuffer({ label: 'AAA cube vertices', size: cube.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    writeFloatBuffer(device.queue, vertexBuffer, 0, cube);

    const matrixBuffer = device.createBuffer({ label: 'AAA model matrices', size: maxInstances * 16 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
    const colorBuffer = device.createBuffer({ label: 'AAA instance colors/material tags', size: maxInstances * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
    const instancePartition = options.instancePartitioning
      ? await startup.wait('Compiling instance partition', () => InstancePartition.create(device, maxInstances, matrixBuffer, colorBuffer), late => late.dispose()) : null;
    const ropePositionBuffer = device.createBuffer({
      label: 'AAA GPU rope node positions',
      size: MAX_ROPE_NODES * 3 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const ropeSegmentBuffer = device.createBuffer({
      label: 'AAA GPU rope segment metadata',
      size: MAX_ROPE_SEGMENTS * 8 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const ropeUniformBuffer = device.createBuffer({
      label: 'AAA GPU rope compute uniforms',
      size: ROPE_GRID_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformBuffer = device.createBuffer({ label: 'AAA scene uniforms', size: SCENE_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const lineBuffer = device.createBuffer({ label: 'AAA debug/effect lines', size: MAX_DEBUG_LINE_VERTICES * 7 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const surfaceVertexBuffer = device.createBuffer({
      label: 'AAA dynamic cloth/water vertices',
      size: MAX_DYNAMIC_SURFACE_VERTICES * SURFACE_VERTEX_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const surfaceIndexBuffer = device.createBuffer({
      label: 'AAA dynamic cloth/water indices',
      size: MAX_DYNAMIC_SURFACE_INDICES * Uint16Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    const clothPositionBuffer = device.createBuffer({
      label: 'AAA GPU cloth positions',
      size: MAX_DYNAMIC_SURFACE_VERTICES * 3 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const clothRestPositionBuffer = device.createBuffer({
      label: 'AAA GPU cloth immutable rest positions',
      size: MAX_DYNAMIC_SURFACE_VERTICES * 3 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const clothParamsBuffer = device.createBuffer({
      label: 'AAA GPU cloth parameters',
      size: SURFACE_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const waterEtaBuffer = device.createBuffer({
      label: 'AAA GPU water elevation',
      size: MAX_DYNAMIC_SURFACE_VERTICES * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const waterUBuffer = device.createBuffer({
      label: 'AAA GPU water X velocity',
      size: MAX_DYNAMIC_SURFACE_VERTICES * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const waterVBuffer = device.createBuffer({
      label: 'AAA GPU water Z velocity',
      size: MAX_DYNAMIC_SURFACE_VERTICES * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const waterParamsBuffer = device.createBuffer({
      label: 'AAA GPU water parameters',
      size: SURFACE_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowTexture = device.createTexture({
      label: 'AAA 2048 shadow map',
      size: [DEFAULT_SHADOW_MAP_SIZE, DEFAULT_SHADOW_MAP_SIZE],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const shadowView = shadowTexture.createView();
    const shadowSampler = device.createSampler({
      label: 'AAA comparison sampler',
      compare: 'less-equal',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    const linearSampler = device.createSampler({
      label: 'AAA HDR linear sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // The depth map cannot be sampled from the same synchronization scope in
    // which it is written. The shadow pass therefore gets a uniform-only bind
    // group instead of reusing the main scene bind group that contains the
    // shadow texture and comparison sampler.
    const shadowBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA shadow uniform layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const shadowBindGroup = device.createBindGroup({
      label: 'AAA shadow uniform bind group',
      layout: shadowBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    const shadowLayout = device.createPipelineLayout({
      label: 'AAA shadow pipeline layout',
      bindGroupLayouts: [shadowBindGroupLayout],
    });

    const sceneBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA scene layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const sceneLayout = device.createPipelineLayout({ label: 'AAA scene pipeline layout', bindGroupLayouts: [sceneBindGroupLayout] });

    const gpuClothBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA GPU cloth storage layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const gpuClothBindGroup = device.createBindGroup({
      label: 'AAA GPU cloth storage bind group',
      layout: gpuClothBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: clothPositionBuffer } },
        { binding: 1, resource: { buffer: clothRestPositionBuffer } },
        { binding: 2, resource: { buffer: clothParamsBuffer } },
      ],
    });
    const gpuClothSceneLayout = device.createPipelineLayout({
      label: 'AAA GPU cloth scene pipeline layout',
      bindGroupLayouts: [sceneBindGroupLayout, gpuClothBindGroupLayout],
    });
    const gpuClothShadowLayout = device.createPipelineLayout({
      label: 'AAA GPU cloth shadow pipeline layout',
      bindGroupLayouts: [shadowBindGroupLayout, gpuClothBindGroupLayout],
    });

    const gpuWaterBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA GPU water storage layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const gpuWaterBindGroup = device.createBindGroup({
      label: 'AAA GPU water storage bind group',
      layout: gpuWaterBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: waterEtaBuffer } },
        { binding: 1, resource: { buffer: waterUBuffer } },
        { binding: 2, resource: { buffer: waterVBuffer } },
        { binding: 3, resource: { buffer: waterParamsBuffer } },
      ],
    });
    const gpuWaterSceneLayout = device.createPipelineLayout({
      label: 'AAA GPU water scene pipeline layout',
      bindGroupLayouts: [sceneBindGroupLayout, gpuWaterBindGroupLayout],
    });

    const ropeComputeBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA GPU rope compute layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const ropeComputeLayout = device.createPipelineLayout({
      label: 'AAA GPU rope compute pipeline layout',
      bindGroupLayouts: [ropeComputeBindGroupLayout],
    });

    const postBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA post layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const postLayout = device.createPipelineLayout({ label: 'AAA post pipeline layout', bindGroupLayouts: [postBindGroupLayout] });

    const shadowModule = device.createShaderModule({ label: 'AAA shadow shader', code: shadowShader });
    const surfaceShadowModule = device.createShaderModule({ label: 'AAA dynamic surface shadow shader', code: surfaceShadowShader });
    const gpuClothShadowModule = device.createShaderModule({ label: 'AAA GPU cloth shadow shader', code: gpuClothShadowShader });
    const clothModule = device.createShaderModule({ label: 'AAA woven cloth shader', code: clothShader });
    const sheetModule = device.createShaderModule({ label: 'AAA interpolated sheet shader', code: sheetShader });
    const gpuClothModule = device.createShaderModule({ label: 'AAA GPU-resident cloth shader', code: gpuClothShader });
    const gpuWaterModule = device.createShaderModule({ label: 'AAA GPU-resident water shader', code: gpuWaterShader });
    const skyModule = device.createShaderModule({ label: 'AAA atmospheric sky shader', code: skyShader });
    const solidModule = device.createShaderModule({ label: 'AAA PBR solid shader', code: solidShader });
    const lineModule = device.createShaderModule({ label: 'AAA line shader', code: lineShader });
    const postModule = device.createShaderModule({ label: 'AAA bloom and tone map shader', code: postShader });
    const ropeComputeModule = device.createShaderModule({ label: 'AAA GPU rope instance compute shader', code: ropeComputeShader });

    // Compilation diagnostics are independent. Resolve them in parallel, then
    // use asynchronous pipeline creation to avoid a first-frame compilation
    // stall. Browsers without the async method retain the validated sync path.
    await startup.wait('Validating graphics shaders', () => Promise.all([
      validateShaderModule(shadowModule, 'Shadow shader'),
      validateShaderModule(surfaceShadowModule, 'Dynamic surface shadow shader'),
      validateShaderModule(gpuClothShadowModule, 'GPU cloth shadow shader'),
      validateShaderModule(clothModule, 'Woven cloth shader'),
      validateShaderModule(sheetModule, 'Interpolated sheet shader'),
      validateShaderModule(gpuClothModule, 'GPU-resident cloth shader'),
      validateShaderModule(gpuWaterModule, 'GPU-resident water shader'),
      validateShaderModule(skyModule, 'Atmospheric sky shader'),
      validateShaderModule(solidModule, 'PBR solid shader'),
      validateShaderModule(lineModule, 'Line shader'),
      validateShaderModule(postModule, 'Post-processing shader'),
      validateShaderModule(ropeComputeModule, 'GPU rope instance compute shader'),
    ]));

    const shadowDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA shadow map pipeline',
      layout: shadowLayout,
      vertex: { module: shadowModule, entryPoint: 'vsMain', buffers: instanceVertexBuffers() },
      fragment: { module: shadowModule, entryPoint: 'fsMain', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 1,
        depthBiasSlopeScale: 1.1,
        depthBiasClamp: 0.00035,
      } as BiasedDepthStencilState,
    };
    const surfaceShadowDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA cloth surface shadow pipeline',
      layout: shadowLayout,
      vertex: { module: surfaceShadowModule, entryPoint: 'vsMain', buffers: surfaceVertexBuffers() },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 1,
        depthBiasSlopeScale: 1.1,
        depthBiasClamp: 0.00035,
      } as BiasedDepthStencilState,
    };
    const gpuClothShadowDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA GPU cloth shadow pipeline',
      layout: gpuClothShadowLayout,
      vertex: { module: gpuClothShadowModule, entryPoint: 'vsMain' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 1,
        depthBiasSlopeScale: 1.1,
        depthBiasClamp: 0.00035,
      } as BiasedDepthStencilState,
    };
    const clothDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA dynamic woven cloth pipeline',
      layout: sceneLayout,
      vertex: { module: clothModule, entryPoint: 'vsMain', buffers: surfaceVertexBuffers() },
      fragment: { module: clothModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const sheetDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA interpolated metal sheet pipeline',
      layout: sceneLayout,
      vertex: { module: sheetModule, entryPoint: 'vsMain', buffers: surfaceVertexBuffers() },
      fragment: { module: sheetModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const gpuClothDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA GPU-resident woven cloth pipeline',
      layout: gpuClothSceneLayout,
      vertex: { module: gpuClothModule, entryPoint: 'vsMain' },
      fragment: { module: gpuClothModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const gpuWaterDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA GPU-resident translucent water pipeline',
      layout: gpuWaterSceneLayout,
      vertex: { module: gpuWaterModule, entryPoint: 'vsMain' },
      fragment: {
        module: gpuWaterModule,
        entryPoint: 'fsMain',
        targets: [{
          format: HDR_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const skyDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA atmospheric sky pipeline',
      layout: sceneLayout,
      vertex: { module: skyModule, entryPoint: 'vsMain' },
      fragment: { module: skyModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list' },
      // The sky is encoded in the same render pass as solid geometry. WebGPU
      // requires every pipeline used by that pass to declare a compatible
      // depth/stencil attachment state, even when the sky does not write depth.
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const solidDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA instanced PBR cube pipeline',
      layout: instancePartition ? device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout, instancePartition.vertexLayout] }) : sceneLayout,
      vertex: { module: solidModule, entryPoint: instancePartition ? 'vsPartitioned' : 'vsMain', buffers: instancePartition ? instanceVertexBuffers().slice(0, 1) : instanceVertexBuffers() },
      fragment: { module: solidModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const transparentSolidDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA translucent glass and material-particle pipeline',
      layout: solidDescriptor.layout,
      vertex: solidDescriptor.vertex,
      fragment: {
        module: solidModule,
        entryPoint: 'fsTransparent',
        targets: [{
          format: HDR_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const lineDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA diagnostic/effect line pipeline',
      layout: sceneLayout,
      vertex: {
        module: lineModule,
        entryPoint: 'vsMain',
        buffers: [{
          arrayStride: 7 * 4,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x4' },
          ],
        }],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fsMain',
        targets: [{
          format: HDR_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: DEFAULT_SAMPLE_COUNT },
    };
    const postDescriptor: GPURenderPipelineDescriptor = {
      label: 'AAA post-processing pipeline',
      layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsMain' },
      fragment: { module: postModule, entryPoint: 'fsMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    };

    const ropeComputeDescriptor: GPUComputePipelineDescriptor = {
      label: 'AAA GPU rope instance compute pipeline',
      layout: ropeComputeLayout,
      compute: { module: ropeComputeModule, entryPoint: 'csMain' },
    };

    const createPipeline = typeof device.createRenderPipelineAsync === 'function'
      ? (descriptor: GPURenderPipelineDescriptor) => device.createRenderPipelineAsync!(descriptor)
      : (descriptor: GPURenderPipelineDescriptor) => Promise.resolve(device.createRenderPipeline(descriptor));
    const createComputePipeline = typeof device.createComputePipelineAsync === 'function'
      ? (descriptor: GPUComputePipelineDescriptor) => device.createComputePipelineAsync!(descriptor)
      : (descriptor: GPUComputePipelineDescriptor) => Promise.resolve(device.createComputePipeline(descriptor));
    const mainDescriptors = [
      skyDescriptor,
      solidDescriptor,
      transparentSolidDescriptor,
      clothDescriptor,
      sheetDescriptor,
      gpuClothDescriptor,
      gpuWaterDescriptor,
      lineDescriptor,
    ] as const;
    const createMainPipelines = (sampleCount: 1 | 4) => Promise.all(mainDescriptors.map((descriptor) => createPipeline({
      ...descriptor,
      label: `${descriptor.label ?? 'AAA main pipeline'} (${sampleCount}x)`,
      multisample: { ...(descriptor.multisample ?? {}), count: sampleCount },
    })));
    startup.check('Compiling graphics pipelines');
    const pipelinePromise = Promise.all([
      createPipeline(shadowDescriptor),
      createPipeline(surfaceShadowDescriptor),
      createPipeline(gpuClothShadowDescriptor),
      createMainPipelines(1),
      createMainPipelines(4),
      createPipeline(postDescriptor),
      createComputePipeline(ropeComputeDescriptor),
    ]);
    const [[materialNoise, materialAtlas], pipelines] = await startup.wait('Compiling graphics pipelines and loading textures', () => Promise.all([materialTexturesPromise, pipelinePromise]));
    const [
      shadowPipeline,
      surfaceShadowPipeline,
      gpuClothShadowPipeline,
      main1x,
      main4x,
      postPipeline,
      ropeComputePipeline,
    ] = pipelines;
    const toMainPipelineSet = (pipelinesForSampleCount: readonly GPURenderPipeline[]): MainPipelineSet => ({
      sky: pipelinesForSampleCount[0]!,
      solid: pipelinesForSampleCount[1]!,
      transparentSolid: pipelinesForSampleCount[2]!,
      cloth: pipelinesForSampleCount[3]!,
      sheet: pipelinesForSampleCount[4]!,
      gpuCloth: pipelinesForSampleCount[5]!,
      gpuWater: pipelinesForSampleCount[6]!,
      line: pipelinesForSampleCount[7]!,
    });
    const mainPipelines1x = toMainPipelineSet(main1x);
    const mainPipelines4x = toMainPipelineSet(main4x);
    const sceneBindGroup = device.createBindGroup({
      label: 'AAA scene bind group',
      layout: sceneBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: shadowView },
        { binding: 2, resource: shadowSampler },
        { binding: 3, resource: materialNoise.view },
        { binding: 4, resource: materialNoise.sampler },
        { binding: 5, resource: materialAtlas.albedoView },
        { binding: 6, resource: materialAtlas.surfaceView },
        { binding: 7, resource: materialAtlas.sampler },
      ],
    });

    const ropeComputeBindGroup = device.createBindGroup({
      label: 'AAA GPU rope instance compute bind group',
      layout: ropeComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: ropeUniformBuffer } },
        { binding: 1, resource: { buffer: ropePositionBuffer } },
        { binding: 2, resource: { buffer: ropeSegmentBuffer } },
        { binding: 3, resource: { buffer: matrixBuffer } },
        { binding: 4, resource: { buffer: colorBuffer } },
      ],
    });

    renderer = new WebGPURenderer({
      canvas,
      device,
      context,
      format,
      maxInstances,
      shadowPipeline,
      surfaceShadowPipeline,
      gpuClothShadowPipeline,
      mainPipelines1x,
      mainPipelines4x,
      postPipeline,
      ropeComputePipeline,
      shadowBindGroup,
      sceneBindGroup,
      sceneBindGroupLayout,
      gpuClothBindGroup,
      gpuWaterBindGroup,
      gpuWaterBindGroupLayout,
      ropeComputeBindGroup,
      postBindGroupLayout,
      uniformBuffer,
      vertexBuffer,
      matrixBuffer,
      colorBuffer,
      ropePositionBuffer,
      ropeSegmentBuffer,
      ropeUniformBuffer,
      lineBuffer,
      surfaceVertexBuffer,
      surfaceIndexBuffer,
      clothPositionBuffer,
      clothRestPositionBuffer,
      clothParamsBuffer,
      waterEtaBuffer,
      waterUBuffer,
      waterVBuffer,
      waterParamsBuffer,
      shadowTexture,
      shadowView,
      shadowSampler,
      linearSampler,
      materialNoise,
      materialAtlas,
      gpuTiming,
      instancePartition,
    });
    renderer.resize();
    options.onStartupProgress?.('Graphics ready');
    return renderer;
    } catch (error) {
      textureLoading.abort();
      if (renderer) renderer.dispose();
      else {
        try { (context as GPUCanvasContext & { unconfigure?(): void }).unconfigure?.(); } catch { /* Device may be lost. */ }
        (device as GPUDevice & { destroy?(): void }).destroy?.();
      }
      throw error;
    }
  }

  private configureQuality(quality: SceneUniformState['quality']): void {
    if (quality.sampleCount !== this.sampleCount) {
      this.sampleCount = quality.sampleCount;
      this.mainPipelines = this.sampleCount === 1 ? this.mainPipelines1x : this.mainPipelines4x;
      // Force attachments to be recreated with a sample count compatible with
      // the newly selected pipelines. Quality switches are infrequent.
      this.width = 0;
      this.height = 0;
    }

    if (quality.shadowMapSize !== this.shadowMapSize) {
      this.shadowCache.invalidate();
      const nextTexture = this.device.createTexture({
        label: `AAA ${quality.shadowMapSize} shadow map`,
        size: [quality.shadowMapSize, quality.shadowMapSize],
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const nextView = nextTexture.createView();
      const nextBindGroup = this.device.createBindGroup({
        label: `AAA ${quality.shadowMapSize} scene bind group`,
        layout: this.sceneBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: nextView },
          { binding: 2, resource: this.shadowSampler },
          { binding: 3, resource: this.materialNoiseView },
          { binding: 4, resource: this.materialNoiseSampler },
          { binding: 5, resource: this.materialAtlasAlbedoView },
          { binding: 6, resource: this.materialAtlasSurfaceView },
          { binding: 7, resource: this.materialAtlasSampler },
        ],
      });
      const previousTexture = this.shadowTexture;
      this.shadowTexture = nextTexture;
      this.shadowView = nextView;
      this.sceneBindGroup = nextBindGroup;
      this.shadowMapSize = quality.shadowMapSize;
      previousTexture.destroy();
    }
  }

  resize(): void {
    this.assertActive();
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * this.resolutionScale);
    const requestedWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const requestedHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const maxFramebufferPixels = this.sampleCount === 4
      ? MAX_FRAMEBUFFER_PIXELS_4X
      : MAX_FRAMEBUFFER_PIXELS_1X;
    const deviceLimits = (this.device as GPUDevice & {
      limits?: { maxTextureDimension2D?: number };
    }).limits;
    const maxTextureDimension = Math.max(1, deviceLimits?.maxTextureDimension2D ?? 8192);
    const fitScale = Math.min(
      1,
      Math.sqrt(maxFramebufferPixels / (requestedWidth * requestedHeight)),
      maxTextureDimension / requestedWidth,
      maxTextureDimension / requestedHeight,
    );
    const width = Math.max(1, Math.floor(requestedWidth * fitScale));
    const height = Math.max(1, Math.floor(requestedHeight * fitScale));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.hdrTexture?.destroy();
    this.msaaTexture = null;
    this.msaaView = null;

    this.depthTexture = this.device.createTexture({
      label: `AAA ${this.sampleCount}x depth`,
      size: [width, height],
      sampleCount: this.sampleCount,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();

    this.hdrTexture = this.device.createTexture({
      label: 'AAA resolved HDR color',
      size: [width, height],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrView = this.hdrTexture.createView();

    if (this.sampleCount === 4) {
      this.msaaTexture = this.device.createTexture({
        label: 'AAA 4x multisampled HDR color',
        size: [width, height],
        sampleCount: 4,
        format: HDR_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.msaaView = this.msaaTexture.createView();
    } else {
      this.msaaView = this.hdrView;
    }

    this.postBindGroup = this.device.createBindGroup({
      label: 'AAA post bind group',
      layout: this.postBindGroupLayout,
      entries: [
        { binding: 0, resource: this.hdrView },
        { binding: 1, resource: this.linearSampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  writeSceneUniforms(state: SceneUniformState): void {
    this.assertActive();
    this.configureQuality(state.quality);
    this.resolutionScale = Math.max(0.5, Math.min(1.35, state.quality.resolutionScale));
    this.resize();
    const data = this.uniformScratch;
    data.set(state.viewProjection, 0);
    data.set(state.lightViewProjection, 16);
    data[32] = state.cameraPosition[0];
    data[33] = state.cameraPosition[1];
    data[34] = state.cameraPosition[2];
    data[35] = state.timeSeconds;
    data[36] = state.lightDirection[0];
    data[37] = state.lightDirection[1];
    data[38] = state.lightDirection[2];
    data[39] = state.quality.exposure;
    data[40] = state.fogColor[0];
    data[41] = state.fogColor[1];
    data[42] = state.fogColor[2];
    data[43] = state.quality.fogDensity;
    data[44] = this.width;
    data[45] = this.height;
    data[46] = state.quality.bloomStrength;
    data[47] = state.quality.shadowStrength;
    data[48] = state.quality.shadowTapCount;
    data[49] = state.quality.sampleCount;
    data[50] = state.quality.shadowMapSize;
    data[51] = state.studioMode ? 1 : 0;
    writeFloatBuffer(this.device.queue, this.uniformBuffer, 0, data);
  }

  uploadInstances(source: InstanceBufferSource, count: number): number {
    this.assertActive();
    const safeCount = Math.max(0, Math.min(count, this.maxInstances));
    const matrixPtr = ptrToNumber(source._b3w_matrices_ptr());
    const colorPtr = ptrToNumber(source._b3w_colors_ptr());
    const frameVersion = source.frameVersion();
    const colorVersion = source.colorVersion();
    const heapIdentity = source.HEAPF32.buffer;
    const layoutMatches =
      this.rigidSourceIdentity === source &&
      this.rigidHeapIdentity === heapIdentity &&
      this.rigidMatrixByteOffset === matrixPtr &&
      this.rigidColorByteOffset === colorPtr &&
      this.rigidCount === safeCount;
    const matricesChanged = !layoutMatches || this.rigidFrameVersion !== frameVersion;
    const colorsChanged = !layoutMatches || this.rigidColorVersion !== colorVersion;
    if (!matricesChanged && !colorsChanged) {
      this.lastUploadedBytes = 0;
      return 0;
    }
    this.shadowCache.invalidate();
    const matrixStart = matrixPtr / 4;
    const colorStart = colorPtr / 4;
    const matrixFloats = safeCount * 16;
    const colorFloats = safeCount * 4;
    if (matricesChanged) writeFloatBuffer(this.device.queue, this.matrixBuffer, 0, source.HEAPF32, matrixFloats, matrixStart);
    if (colorsChanged) writeFloatBuffer(this.device.queue, this.colorBuffer, 0, source.HEAPF32, colorFloats, colorStart);
    if (colorsChanged) {
      this.rigidHasTransparentMaterial = containsTransparentMaterial(source.HEAPF32, colorStart, safeCount);
      this.instancePartition?.invalidate();
    }
    this.rigidSourceIdentity = source;
    this.rigidHeapIdentity = heapIdentity;
    this.rigidMatrixByteOffset = matrixPtr;
    this.rigidColorByteOffset = colorPtr;
    this.rigidCount = safeCount;
    this.rigidFrameVersion = frameVersion;
    this.rigidColorVersion = colorVersion;
    const bytes = ((matricesChanged ? matrixFloats : 0) + (colorsChanged ? colorFloats : 0)) * Float32Array.BYTES_PER_ELEMENT;
    this.lastUploadedBytes = bytes;
    return bytes;
  }

  uploadEffects(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number, frameVersion: number): number {
    this.assertActive();
    const safeBase = Math.max(0, Math.min(baseInstance, this.maxInstances));
    const safeCount = Math.max(0, Math.min(count, this.maxInstances - safeBase));
    if (
      this.effectMatrixIdentity === matrices.buffer &&
      this.effectColorIdentity === colors.buffer &&
      this.effectMatrixByteOffset === matrices.byteOffset &&
      this.effectColorByteOffset === colors.byteOffset &&
      this.effectBase === safeBase &&
      this.effectCount === safeCount &&
      this.effectFrameVersion === frameVersion
    ) {
      return 0;
    }
    const matrixFloats = Math.min(safeCount * 16, matrices.length);
    const colorFloats = Math.min(safeCount * 4, colors.length);
    this.shadowCache.invalidate();
    writeFloatBuffer(this.device.queue, this.matrixBuffer, safeBase * 16 * 4, matrices, matrixFloats);
    writeFloatBuffer(this.device.queue, this.colorBuffer, safeBase * 4 * 4, colors, colorFloats);
    this.effectHasTransparentMaterial = containsTransparentMaterial(colors, 0, Math.min(safeCount, Math.floor(colorFloats / 4)));
    this.instancePartition?.invalidate();
    this.effectMatrixIdentity = matrices.buffer;
    this.effectColorIdentity = colors.buffer;
    this.effectMatrixByteOffset = matrices.byteOffset;
    this.effectColorByteOffset = colors.byteOffset;
    this.effectBase = safeBase;
    this.effectCount = safeCount;
    this.effectFrameVersion = frameVersion;
    const bytes = (matrixFloats + colorFloats) * Float32Array.BYTES_PER_ELEMENT;
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  /**
   * Scene-local frame versions restart when a new soft simulation is created,
   * and persistent WASM arenas deliberately reuse the same memory and offsets.
   * Clear every dynamic-stream identity at that boundary so a paused scene
   * switch cannot be mistaken for an unchanged frame.
   */
  invalidateDynamicCaches(): void {
    this.residentWater?.dispose();
    this.residentWater = null;
    this.shadowCache.invalidate();
    this.instancePartition?.invalidate();
    this.rigidSourceIdentity = null;
    this.rigidHeapIdentity = null;
    this.rigidMatrixByteOffset = -1;
    this.rigidColorByteOffset = -1;
    this.rigidCount = -1;
    this.rigidFrameVersion = -1;
    this.rigidColorVersion = -1;
    this.rigidHasTransparentMaterial = false;
    this.effectMatrixIdentity = null;
    this.effectColorIdentity = null;
    this.effectMatrixByteOffset = -1;
    this.effectColorByteOffset = -1;
    this.effectBase = -1;
    this.effectCount = -1;
    this.effectFrameVersion = -1;
    this.effectHasTransparentMaterial = false;
    this.lineSourceIdentity = null;
    this.lineSourceCount = -1;
    this.lineFrameVersion = -1;
    this.lineFloatCount = 0;
    this.surfaceFrameVersion = -1;
    this.surfaceStateViewCount = 0;
    this.surfaceStateBufferIdentity0 = null;
    this.surfaceStateBufferIdentity1 = null;
    this.surfaceStateBufferIdentity2 = null;
    this.surfaceStateByteOffset0 = -1;
    this.surfaceStateByteOffset1 = -1;
    this.surfaceStateByteOffset2 = -1;
    this.surfaceStateByteLength0 = -1;
    this.surfaceStateByteLength1 = -1;
    this.surfaceStateByteLength2 = -1;
    this.surfaceCachedVertexCount = 0;
    this.surfaceConfig.fill(Number.NaN);
    this.clothRestPositionIdentity = null;
    this.clothRestPositionByteOffset = -1;
    this.clothRestPositionByteLength = -1;
    this.clothRestTopologyVersion = -1;
    this.surfaceIndexBufferIdentity = null;
    this.surfaceIndexByteOffset = -1;
    this.surfaceIndexByteLength = -1;
    this.surfaceTopologyVersion = -1;
    this.surfaceCachedIndexCount = 0;
    this.surfaceCachedMaxIndex = -1;
    this.softInstanceMatrixIdentity = null;
    this.softInstanceColorIdentity = null;
    this.softInstanceMatrixByteOffset = -1;
    this.softInstanceColorByteOffset = -1;
    this.softInstanceMatrixByteLength = -1;
    this.softInstanceColorByteLength = -1;
    this.softInstanceBase = -1;
    this.softInstanceCount = -1;
    this.softInstanceFrameVersion = -1;
    this.softHasTransparentMaterial = false;
    this.ropeGridSegmentCount = 0;
    this.ropeGridNodeCount = 0;
    this.ropeGridBaseInstance = 0;
    this.ropeGridActive = false;
    this.ropeGridDispatchPending = false;
    this.ropeGridFrameVersion = -1;
    this.ropeGridTopologyVersion = -1;
    this.ropeGridPresentation = -1;
    this.ropeGridPositionIdentity = null;
    this.ropeGridPositionByteOffset = -1;
    this.ropeGridSegmentIdentity = null;
    this.ropeGridSegmentByteOffset = -1;
    this.ropeGridHasTransparentMaterial = false;
  }

  uploadSoftInstances(
    matrices: Float32Array,
    colors: Float32Array,
    baseInstance: number,
    count: number,
    frameVersion: number,
  ): number {
    this.assertActive();
    const safeBase = Math.max(0, Math.min(baseInstance, this.maxInstances));
    const safeCount = Math.max(0, Math.min(count, this.maxInstances - safeBase));
    const matrixFloats = Math.min(safeCount * 16, matrices.length);
    const colorFloats = Math.min(safeCount * 4, colors.length);
    const unchanged =
      this.softInstanceMatrixIdentity === matrices.buffer &&
      this.softInstanceColorIdentity === colors.buffer &&
      this.softInstanceMatrixByteOffset === matrices.byteOffset &&
      this.softInstanceColorByteOffset === colors.byteOffset &&
      this.softInstanceMatrixByteLength === matrices.byteLength &&
      this.softInstanceColorByteLength === colors.byteLength &&
      this.softInstanceBase === safeBase &&
      this.softInstanceCount === safeCount &&
      this.softInstanceFrameVersion === frameVersion;
    if (unchanged) return 0;
    this.shadowCache.invalidate();

    writeFloatBuffer(this.device.queue, this.matrixBuffer, safeBase * 16 * 4, matrices, matrixFloats);
    writeFloatBuffer(this.device.queue, this.colorBuffer, safeBase * 4 * 4, colors, colorFloats);
    this.softHasTransparentMaterial = containsTransparentMaterial(colors, 0, Math.min(safeCount, Math.floor(colorFloats / 4)));
    this.instancePartition?.invalidate();
    const bytes = (matrixFloats + colorFloats) * Float32Array.BYTES_PER_ELEMENT;
    this.softInstanceMatrixIdentity = matrices.buffer;
    this.softInstanceColorIdentity = colors.buffer;
    this.softInstanceMatrixByteOffset = matrices.byteOffset;
    this.softInstanceColorByteOffset = colors.byteOffset;
    this.softInstanceMatrixByteLength = matrices.byteLength;
    this.softInstanceColorByteLength = colors.byteLength;
    this.softInstanceBase = safeBase;
    this.softInstanceCount = safeCount;
    this.softInstanceFrameVersion = frameVersion;
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  uploadRopeGrid(grid: RopeGridFrame | null, baseInstance: number): number {
    this.assertActive();
    this.ropeGridActive = false;
    if (!grid || grid.nodeCount <= 0 || grid.segmentCount <= 0) {
      this.ropeGridDispatchPending = false;
      this.ropeGridHasTransparentMaterial = false;
      return 0;
    }

    const safeNodeCount = Math.max(0, Math.min(grid.nodeCount, Math.floor(grid.positions.length / 3), MAX_ROPE_NODES));
    const safeSegmentCount = Math.max(0, Math.min(grid.segmentCount, Math.floor(grid.segments.length / 8), MAX_ROPE_SEGMENTS));
    const safeBaseInstance = Math.max(0, Math.min(Math.floor(baseInstance), this.maxInstances));
    const availableInstances = Math.max(0, this.maxInstances - safeBaseInstance);
    const clampedSegmentCount = Math.min(safeSegmentCount, availableInstances);
    if (safeNodeCount <= 0 || clampedSegmentCount <= 0) {
      this.ropeGridDispatchPending = false;
      return 0;
    }

    let bytes = 0;
    const positionChanged =
      this.ropeGridPositionIdentity !== grid.positions.buffer ||
      this.ropeGridPositionByteOffset !== grid.positions.byteOffset ||
      this.ropeGridFrameVersion !== grid.frameVersion ||
      this.ropeGridNodeCount !== safeNodeCount;
    if (positionChanged) {
      writeFloatBuffer(this.device.queue, this.ropePositionBuffer, 0, grid.positions, safeNodeCount * 3);
      bytes += safeNodeCount * 3 * Float32Array.BYTES_PER_ELEMENT;
      this.ropeGridPositionIdentity = grid.positions.buffer;
      this.ropeGridPositionByteOffset = grid.positions.byteOffset;
      this.ropeGridFrameVersion = grid.frameVersion;
    }

    const topologyChanged =
      this.ropeGridSegmentIdentity !== grid.segments.buffer ||
      this.ropeGridSegmentByteOffset !== grid.segments.byteOffset ||
      this.ropeGridTopologyVersion !== grid.topologyVersion ||
      this.ropeGridSegmentCount !== clampedSegmentCount;
    if (topologyChanged) {
      writeFloatBuffer(this.device.queue, this.ropeSegmentBuffer, 0, grid.segments, clampedSegmentCount * 8);
      this.ropeGridHasTransparentMaterial = false;
      for (let i = 0; i < clampedSegmentCount; i++) {
        const materialId = Math.round(Math.max(-grid.segments[i * 8 + 7], 0));
        if (materialId === 4 || materialId === 6) {
          this.ropeGridHasTransparentMaterial = true;
          break;
        }
      }
      bytes += clampedSegmentCount * 8 * Float32Array.BYTES_PER_ELEMENT;
      this.ropeGridSegmentIdentity = grid.segments.buffer;
      this.ropeGridSegmentByteOffset = grid.segments.byteOffset;
      this.ropeGridTopologyVersion = grid.topologyVersion;
    }

    const uniformChanged =
      this.ropeGridBaseInstance !== safeBaseInstance ||
      this.ropeGridSegmentCount !== clampedSegmentCount ||
      this.ropeGridNodeCount !== safeNodeCount ||
      this.ropeGridPresentation !== (grid.presentation === 'material' ? 1 : 0);
    if (uniformChanged) {
      const view = new DataView(this.ropeGridUniformScratch);
      view.setUint32(0, safeBaseInstance >>> 0, true);
      view.setUint32(4, clampedSegmentCount >>> 0, true);
      view.setUint32(8, safeNodeCount >>> 0, true);
      view.setUint32(12, grid.presentation === 'material' ? 1 : 0, true);
      this.device.queue.writeBuffer(this.ropeUniformBuffer, 0, this.ropeGridUniformScratch);
      bytes += ROPE_GRID_UNIFORM_BYTES;
    }

    this.ropeGridActive = true;
    this.ropeGridBaseInstance = safeBaseInstance;
    this.ropeGridSegmentCount = clampedSegmentCount;
    this.ropeGridNodeCount = safeNodeCount;
    this.ropeGridPresentation = grid.presentation === 'material' ? 1 : 0;
    this.ropeGridDispatchPending ||= positionChanged || topologyChanged || uniformChanged;
    if(this.ropeGridDispatchPending)this.shadowCache.invalidate();
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  uploadSurface(surface: DynamicSurfaceFrame | null): number {
    this.assertActive();
    this.residentWater?.dispose();
    this.residentWater = null;
    const previousSurfacePath = this.surfacePath;
    this.surfaceVertexCount = 0;
    this.surfaceIndexCount = 0;
    this.surfaceMaterial = null;
    this.surfacePath = null;
    if (!surface || surface.vertexCount <= 0 || surface.indexCount <= 0) {
      return 0;
    }

    let availableVertices = 0;
    let stateViewCount = 1;
    let stateView0: ArrayBufferView;
    let stateView1: ArrayBufferView | null = null;
    let stateView2: ArrayBufferView | null = null;
    if (surface.path === 'packed') {
      if (surface.vertexStride !== SURFACE_VERTEX_BYTES) {
        console.warn(`[WebGPU] Ignoring ${surface.material} surface with unsupported ${surface.vertexStride}-byte vertex stride.`);
        return 0;
      }
      availableVertices = Math.floor(surface.vertices.byteLength / surface.vertexStride);
      stateView0 = surface.vertices;
    } else if (surface.path === 'gpu-cloth') {
      availableVertices = Math.min(
        Math.floor(surface.positions.length / 3),
        Math.floor(surface.restPositions.length / 3),
      );
      stateView0 = surface.positions;
      if (surface.cols < 2 || surface.rows < 2 || surface.cols * surface.rows !== surface.vertexCount) {
        console.warn('[WebGPU] Ignoring GPU cloth surface with an invalid grid shape.');
        return 0;
      }
    } else {
      availableVertices = Math.min(surface.eta.length, surface.u.length, surface.v.length);
      stateViewCount = 3;
      stateView0 = surface.eta;
      stateView1 = surface.u;
      stateView2 = surface.v;
      if (surface.cols < 2 || surface.rows < 2 || surface.cols * surface.rows !== surface.vertexCount) {
        console.warn('[WebGPU] Ignoring GPU water surface with an invalid grid shape.');
        return 0;
      }
    }

    const safeVertexCount = Math.max(0, Math.min(surface.vertexCount, availableVertices, MAX_DYNAMIC_SURFACE_VERTICES));
    let safeIndexCount = Math.max(0, Math.min(surface.indexCount, surface.indices.length, MAX_DYNAMIC_SURFACE_INDICES));
    safeIndexCount -= safeIndexCount % 3;
    if (safeVertexCount <= 0 || safeIndexCount <= 0) {
      return 0;
    }

    const topologyByteLength = safeIndexCount * Uint16Array.BYTES_PER_ELEMENT;
    const topologyChanged =
      this.surfaceIndexBufferIdentity !== surface.indices.buffer ||
      this.surfaceIndexByteOffset !== surface.indices.byteOffset ||
      this.surfaceIndexByteLength !== surface.indices.byteLength ||
      this.surfaceTopologyVersion !== surface.topologyVersion ||
      this.surfaceCachedIndexCount !== safeIndexCount;
    let maxIndex = this.surfaceCachedMaxIndex;
    if (topologyChanged) {
      maxIndex = 0;
      for (let i = 0; i < safeIndexCount; i++) {
        const index = surface.indices[i];
        if (index > maxIndex) maxIndex = index;
      }
    }
    if (maxIndex >= safeVertexCount) {
      console.warn(`[WebGPU] Ignoring ${surface.material} surface: index ${maxIndex} exceeds ${safeVertexCount} uploaded vertices.`);
      return 0;
    }

    const sameStateIdentity =
      stateViewCount === this.surfaceStateViewCount &&
      stateView0.buffer === this.surfaceStateBufferIdentity0 &&
      stateView0.byteOffset === this.surfaceStateByteOffset0 &&
      stateView0.byteLength === this.surfaceStateByteLength0 &&
      (stateViewCount < 2 || (
        stateView1!.buffer === this.surfaceStateBufferIdentity1 &&
        stateView1!.byteOffset === this.surfaceStateByteOffset1 &&
        stateView1!.byteLength === this.surfaceStateByteLength1)) &&
      (stateViewCount < 3 || (
        stateView2!.buffer === this.surfaceStateBufferIdentity2 &&
        stateView2!.byteOffset === this.surfaceStateByteOffset2 &&
        stateView2!.byteLength === this.surfaceStateByteLength2));
    const stateUnchanged =
      previousSurfacePath === surface.path &&
      this.surfaceFrameVersion === surface.frameVersion &&
      this.surfaceCachedVertexCount === safeVertexCount &&
      sameStateIdentity;
    let bytes = 0;

    if (!stateUnchanged) {
      if (surface.path === 'packed') {
        const vertexBytes = safeVertexCount * SURFACE_VERTEX_BYTES;
        writeByteBuffer(this.device.queue, this.surfaceVertexBuffer, 0, surface.vertices, vertexBytes);
        bytes += vertexBytes;
      } else if (surface.path === 'gpu-cloth') {
        const positionFloats = safeVertexCount * 3;
        writeFloatBuffer(this.device.queue, this.clothPositionBuffer, 0, surface.positions, positionFloats);
        bytes += safeVertexCount * GPU_CLOTH_VERTEX_BYTES;
      } else {
        writeFloatBuffer(this.device.queue, this.waterEtaBuffer, 0, surface.eta, safeVertexCount);
        writeFloatBuffer(this.device.queue, this.waterUBuffer, 0, surface.u, safeVertexCount);
        writeFloatBuffer(this.device.queue, this.waterVBuffer, 0, surface.v, safeVertexCount);
        bytes += safeVertexCount * GPU_WATER_CELL_BYTES;
      }
    }

    if (surface.path === 'gpu-cloth') {
      const restChanged =
        this.clothRestPositionIdentity !== surface.restPositions.buffer ||
        this.clothRestPositionByteOffset !== surface.restPositions.byteOffset ||
        this.clothRestPositionByteLength !== surface.restPositions.byteLength ||
        this.clothRestTopologyVersion !== surface.topologyVersion;
      if (restChanged) {
        const restFloats = safeVertexCount * 3;
        writeFloatBuffer(this.device.queue, this.clothRestPositionBuffer, 0, surface.restPositions, restFloats);
        bytes += restFloats * Float32Array.BYTES_PER_ELEMENT;
        this.clothRestPositionIdentity = surface.restPositions.buffer;
        this.clothRestPositionByteOffset = surface.restPositions.byteOffset;
        this.clothRestPositionByteLength = surface.restPositions.byteLength;
        this.clothRestTopologyVersion = surface.topologyVersion;
      }
    }

    if (surface.path === 'gpu-cloth') {
      const config = this.surfaceConfig;
      const configChanged =
        config[0] !== 1 ||
        config[1] !== surface.cols ||
        config[2] !== surface.rows ||
        config[3] !== surface.baseColorA[0] ||
        config[4] !== surface.baseColorA[1] ||
        config[5] !== surface.baseColorA[2] ||
        config[6] !== surface.baseColorA[3] ||
        config[7] !== surface.baseColorB[0] ||
        config[8] !== surface.baseColorB[1] ||
        config[9] !== surface.baseColorB[2] ||
        config[10] !== surface.baseColorB[3];
      if (configChanged) {
        const uints = new Uint32Array(this.clothParamsScratch);
        const floats = new Float32Array(this.clothParamsScratch);
        uints.fill(0);
        uints[0] = surface.cols;
        uints[1] = surface.rows;
        uints[2] = safeVertexCount;
        floats.set(surface.baseColorA, 4);
        floats.set(surface.baseColorB, 8);
        writeByteBuffer(this.device.queue, this.clothParamsBuffer, 0, new Uint8Array(this.clothParamsScratch));
        config[0] = 1;
        config[1] = surface.cols;
        config[2] = surface.rows;
        config[3] = surface.baseColorA[0];
        config[4] = surface.baseColorA[1];
        config[5] = surface.baseColorA[2];
        config[6] = surface.baseColorA[3];
        config[7] = surface.baseColorB[0];
        config[8] = surface.baseColorB[1];
        config[9] = surface.baseColorB[2];
        config[10] = surface.baseColorB[3];
      }
    } else if (surface.path === 'gpu-water') {
      const config = this.surfaceConfig;
      const configChanged =
        config[0] !== 2 ||
        config[1] !== surface.cols ||
        config[2] !== surface.rows ||
        config[3] !== surface.width ||
        config[4] !== surface.depth ||
        config[5] !== surface.baseY;
      if (configChanged) {
        const uints = new Uint32Array(this.waterParamsScratch);
        const floats = new Float32Array(this.waterParamsScratch);
        uints.fill(0);
        uints[0] = surface.cols;
        uints[1] = surface.rows;
        uints[2] = safeVertexCount;
        floats[4] = surface.width;
        floats[5] = surface.depth;
        floats[6] = surface.baseY;
        writeByteBuffer(this.device.queue, this.waterParamsBuffer, 0, new Uint8Array(this.waterParamsScratch));
        config[0] = 2;
        config[1] = surface.cols;
        config[2] = surface.rows;
        config[3] = surface.width;
        config[4] = surface.depth;
        config[5] = surface.baseY;
      }
    } else {
      this.surfaceConfig[0] = 0;
    }

    if (topologyChanged) {
      const indexBytes = topologyByteLength;
      const alignedIndexBytes = (indexBytes + 3) & ~3;
      if (alignedIndexBytes === indexBytes) {
        writeByteBuffer(this.device.queue, this.surfaceIndexBuffer, 0, surface.indices, indexBytes);
      } else {
        const scratch = this.surfaceIndexUploadScratch;
        scratch.set(new Uint8Array(surface.indices.buffer, surface.indices.byteOffset, indexBytes), 0);
        scratch.fill(0, indexBytes, alignedIndexBytes);
        writeByteBuffer(this.device.queue, this.surfaceIndexBuffer, 0, scratch, alignedIndexBytes);
      }
      bytes += indexBytes;
      this.surfaceIndexBufferIdentity = surface.indices.buffer;
      this.surfaceIndexByteOffset = surface.indices.byteOffset;
      this.surfaceIndexByteLength = surface.indices.byteLength;
      this.surfaceTopologyVersion = surface.topologyVersion;
      this.surfaceCachedIndexCount = safeIndexCount;
      this.surfaceCachedMaxIndex = maxIndex;
    }

    this.surfaceVertexCount = safeVertexCount;
    this.surfaceIndexCount = safeIndexCount;
    this.surfaceMaterial = surface.material;
    this.surfacePath = surface.path;
    this.surfaceFrameVersion = surface.frameVersion;
    this.surfaceStateViewCount = stateViewCount;
    this.surfaceStateBufferIdentity0 = stateView0.buffer;
    this.surfaceStateBufferIdentity1 = stateView1?.buffer ?? null;
    this.surfaceStateBufferIdentity2 = stateView2?.buffer ?? null;
    this.surfaceStateByteOffset0 = stateView0.byteOffset;
    this.surfaceStateByteOffset1 = stateView1?.byteOffset ?? -1;
    this.surfaceStateByteOffset2 = stateView2?.byteOffset ?? -1;
    this.surfaceStateByteLength0 = stateView0.byteLength;
    this.surfaceStateByteLength1 = stateView1?.byteLength ?? -1;
    this.surfaceStateByteLength2 = stateView2?.byteLength ?? -1;
    this.surfaceCachedVertexCount = safeVertexCount;
    if(bytes>0)this.shadowCache.invalidate();
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  /** Borrow the numerical GPU fields. The caller keeps ownership of the solver. */
  useGpuWater(solver: GpuLinearWater | null, options: ResidentWaterOptions = {}): void {
    this.assertActive();
    const next = solver ? new ResidentWaterSurface(solver, this.device, this.gpuWaterBindGroupLayout, options) : null;
    this.residentWater?.dispose();
    this.residentWater = next;
    this.surfaceMaterial = next ? 'water' : null;
    this.surfacePath = next ? 'gpu-water' : null;
    this.surfaceIndexCount = next?.indexCount ?? 0;
    this.surfaceVertexCount = next ? solver!.config.cols * solver!.config.rows : 0;
    this.surfaceFrameVersion = -1;
    this.shadowCache.invalidate();
  }

  gpuWaterInfo(): { mode: 'gpu-numerical' | 'cpu-fields' | 'none'; model: string | null; solverCells: number; meshVertices: number; renderStride: number | null } {
    const resident = this.residentWater;
    return { mode: resident ? 'gpu-numerical' : this.surfacePath === 'gpu-water' ? 'cpu-fields' : 'none', model: resident?.owner.backend ?? null,
      solverCells: resident ? resident.owner.config.cols * resident.owner.config.rows : 0,
      meshVertices: resident?.renderVertexCount ?? 0, renderStride: resident?.renderStride ?? null };
  }

  render(instanceCount: number, debugLines: readonly DebugLine[], lineFrameVersion?: number): number {
    this.resize();
    if (!this.depthView || !this.msaaView || !this.hdrView || !this.postBindGroup) return 0;

    const safeCount = Math.max(0, Math.min(instanceCount, this.maxInstances));
    const lineStateUnchanged = lineFrameVersion !== undefined &&
      this.lineSourceIdentity === debugLines &&
      this.lineSourceCount === debugLines.length &&
      this.lineFrameVersion === lineFrameVersion;
    if (!lineStateUnchanged) {
      this.lineFloatCount = fillLineVertexData(debugLines, MAX_DEBUG_LINE_VERTICES, this.lineScratch);
      if (this.lineFloatCount > 0) {
        writeFloatBuffer(this.device.queue, this.lineBuffer, 0, this.lineScratch, this.lineFloatCount);
      }
      this.lineSourceIdentity = debugLines;
      this.lineSourceCount = debugLines.length;
      this.lineFrameVersion = lineFrameVersion ?? -1;
    }
    const lineFloatCount = this.lineFloatCount;

    const start = performance.now();
    const encoder = this.device.createCommandEncoder({ label: 'AAA frame encoder' });
    const timingFrame = this.gpuTimer.beginFrame();
    const ropeDispatchPending = this.ropeGridDispatchPending;
    const expandRopes = this.ropeGridActive && ropeDispatchPending && this.ropeGridSegmentCount > 0;
    if (expandRopes) this.instancePartition?.invalidate();
    const partitionChanged = this.instancePartition?.needsUpdate(safeCount) ?? false;
    const surfaceCastsShadow = (this.surfaceMaterial === 'cloth' || this.surfaceMaterial === 'sheet') && this.surfaceIndexCount > 0;
    const shadowSurfaceCount = surfaceCastsShadow ? this.surfaceIndexCount : 0;
    const shadowSurfacePath = surfaceCastsShadow ? this.surfacePath : null;
    const renderShadow = this.uniformScratch[47] > 0.001 && this.shadowCache.needsRender(this.uniformScratch,safeCount,shadowSurfaceCount,shadowSurfacePath);
    try {

    if (expandRopes || partitionChanged) {
      const computePass = encoder.beginComputePass({
        label: 'AAA instance expansion and partition',
        timestampWrites: this.gpuTimer.timestampWrites(timingFrame, 'compute'),
      } as TimedComputePassDescriptor);
      if (expandRopes) {
        computePass.setPipeline(this.ropeComputePipeline);
        computePass.setBindGroup(0, this.ropeComputeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(this.ropeGridSegmentCount / 64));
      }
      if (partitionChanged) this.instancePartition!.encode(computePass, safeCount, CUBE_VERTEX_COUNT);
      computePass.end();
      this.ropeGridDispatchPending = false;
    }

    if (renderShadow) {
      const shadowPass = encoder.beginRenderPass({
        label: 'AAA shadow pass',
        // Dawn/Metal can leave a stale end counter on a clear-only pass. Keep
        // that maintenance cost unmeasured instead of publishing an invalid pair.
        timestampWrites: safeCount > 0 || shadowSurfaceCount > 0 ? this.gpuTimer.timestampWrites(timingFrame, 'shadow') : undefined,
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      } as TimedRenderPassDescriptor);
      shadowPass.setBindGroup(0, this.shadowBindGroup);
      if (safeCount > 0) {
        shadowPass.setPipeline(this.shadowPipeline);
        shadowPass.setVertexBuffer(0, this.vertexBuffer);
        shadowPass.setVertexBuffer(1, this.matrixBuffer);
        shadowPass.setVertexBuffer(2, this.colorBuffer);
        shadowPass.draw(CUBE_VERTEX_COUNT, safeCount);
      }
      if (surfaceCastsShadow) {
        if (this.surfacePath === 'gpu-cloth') {
          shadowPass.setPipeline(this.gpuClothShadowPipeline);
          shadowPass.setBindGroup(1, this.gpuClothBindGroup);
        } else {
          shadowPass.setPipeline(this.surfaceShadowPipeline);
          shadowPass.setVertexBuffer(0, this.surfaceVertexBuffer);
        }
        shadowPass.setIndexBuffer(this.surfaceIndexBuffer, 'uint16');
        shadowPass.drawIndexed(this.surfaceIndexCount, 1);
      }
      shadowPass.end();
    }

    const mainPass = encoder.beginRenderPass({
      label: 'AAA HDR main pass',
      timestampWrites: this.gpuTimer.timestampWrites(timingFrame, 'main'),
      colorAttachments: [{
        view: this.msaaView,
        resolveTarget: this.sampleCount === 4 ? this.hdrView : undefined,
        clearValue: { r: 0.003, g: 0.006, b: 0.015, a: 1 },
        loadOp: 'clear',
        storeOp: this.sampleCount === 4 ? 'discard' : 'store',
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    } as TimedRenderPassDescriptor);

    mainPass.setPipeline(this.mainPipelines.sky);
    mainPass.setBindGroup(0, this.sceneBindGroup);
    mainPass.draw(3, 1);

    if (safeCount > 0) {
      mainPass.setPipeline(this.mainPipelines.solid);
      mainPass.setBindGroup(0, this.sceneBindGroup);
      mainPass.setVertexBuffer(0, this.vertexBuffer);
      if (this.instancePartition) {
        mainPass.setBindGroup(1, this.instancePartition.opaqueBindGroup);
        mainPass.drawIndirect(this.instancePartition.indirectBuffer, 0);
      } else {
        mainPass.setVertexBuffer(1, this.matrixBuffer);
        mainPass.setVertexBuffer(2, this.colorBuffer);
        mainPass.draw(CUBE_VERTEX_COUNT, safeCount);
      }
    }

    if (this.surfaceMaterial && this.surfaceIndexCount > 0) {
      const surfaceMaterial = this.surfaceMaterial;
      mainPass.setBindGroup(0, this.sceneBindGroup);
      const path = this.surfacePath;
      switch (path) {
        case 'gpu-cloth':
          mainPass.setPipeline(this.mainPipelines.gpuCloth);
          mainPass.setBindGroup(1, this.gpuClothBindGroup);
          break;
        case 'gpu-water':
          mainPass.setPipeline(this.mainPipelines.gpuWater);
          mainPass.setBindGroup(1, this.residentWater?.bindGroup() ?? this.gpuWaterBindGroup);
          break;
        case 'packed': {
          switch (surfaceMaterial) {
            case 'sheet':
              mainPass.setPipeline(this.mainPipelines.sheet);
              break;
            case 'cloth':
            case 'water':
              mainPass.setPipeline(this.mainPipelines.cloth);
              break;
            default:
              assertNever(surfaceMaterial, 'Unhandled packed surface material');
          }
          mainPass.setVertexBuffer(0, this.surfaceVertexBuffer);
          break;
        }
        case null:
          break;
        default:
          assertNever(path, 'Unhandled dynamic surface path');
      }
      mainPass.setIndexBuffer(this.residentWater?.indexBuffer ?? this.surfaceIndexBuffer, this.residentWater ? 'uint32' : 'uint16');
      mainPass.drawIndexed(this.surfaceIndexCount, 1);
    }

    if (
      safeCount > 0 &&
      (this.instancePartition || this.rigidHasTransparentMaterial || this.softHasTransparentMaterial ||
        this.effectHasTransparentMaterial || this.ropeGridHasTransparentMaterial)
    ) {
      mainPass.setPipeline(this.mainPipelines.transparentSolid);
      mainPass.setBindGroup(0, this.sceneBindGroup);
      mainPass.setVertexBuffer(0, this.vertexBuffer);
      if (this.instancePartition) {
        mainPass.setBindGroup(1, this.instancePartition.transparentBindGroup);
        mainPass.drawIndirect(this.instancePartition.indirectBuffer, 16);
      } else {
        mainPass.setVertexBuffer(1, this.matrixBuffer);
        mainPass.setVertexBuffer(2, this.colorBuffer);
        mainPass.draw(CUBE_VERTEX_COUNT, safeCount);
      }
    }

    if (lineFloatCount > 0) {
      mainPass.setPipeline(this.mainPipelines.line);
      mainPass.setBindGroup(0, this.sceneBindGroup);
      mainPass.setVertexBuffer(0, this.lineBuffer);
      mainPass.draw(lineFloatCount / 7, 1);
    }
    mainPass.end();

    const postPass = encoder.beginRenderPass({
      label: 'AAA tone mapping and bloom pass',
      timestampWrites: this.gpuTimer.timestampWrites(timingFrame, 'post'),
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    } as TimedRenderPassDescriptor);
    postPass.setPipeline(this.postPipeline);
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3, 1);
    postPass.end();

    this.gpuTimer.resolveFrame(encoder, timingFrame);
    this.device.queue.submit([encoder.finish()]);
    this.instancePartition?.submitted(safeCount, partitionChanged);
    if(renderShadow)this.shadowCache.submitted(this.uniformScratch,safeCount,shadowSurfaceCount,shadowSurfacePath);
    this.gpuTimer.submitFrame(timingFrame);
    return performance.now() - start;
    } catch (error) {
      this.gpuTimer.discardFrame(timingFrame);
      if (ropeDispatchPending) this.ropeGridDispatchPending = true;
      throw error;
    }
  }

  gpuTimingInfo(): GpuTimingInfo {
    return this.gpuTimer.info();
  }

  shadowCacheInfo(): { rendered: number; reused: number } {
    return { rendered:this.shadowCache.rendered,reused:this.shadowCache.reused };
  }

  instancePartitionInfo(): { mode: 'gpu-stable' | 'direct'; builds: number; reuses: number } {
    return { mode: this.instancePartition ? 'gpu-stable' : 'direct', builds: this.instancePartition?.builds ?? 0, reuses: this.instancePartition?.reuses ?? 0 };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** Subscribers registered after loss are notified on a microtask, unless removed. */
  onDeviceLost(callback: (info: WebGPUDeviceLossInfo) => void): () => void {
    if (this.disposed) return () => {};
    const alreadySubscribed = this.deviceLostListeners.has(callback);
    this.deviceLostListeners.add(callback);
    if (this.deviceLoss && !alreadySubscribed) {
      const info = this.deviceLoss;
      queueMicrotask(() => {
        if (!this.disposed && this.deviceLostListeners.has(callback)) this.callDeviceLostListener(callback, info);
      });
    }
    return () => { this.deviceLostListeners.delete(callback); };
  }

  private notifyDeviceLost(info: WebGPUDeviceLossInfo): void {
    if (this.disposed || this.deviceLoss) return;
    this.deviceLoss = Object.freeze({ reason: info.reason, message: info.message });
    for (const callback of [...this.deviceLostListeners]) this.callDeviceLostListener(callback, this.deviceLoss);
  }

  private callDeviceLostListener(callback: (info: WebGPUDeviceLossInfo) => void, info: WebGPUDeviceLossInfo): void {
    if (this.disposed || !this.deviceLostListeners.has(callback)) return;
    try {
      void Promise.resolve(callback(info)).catch((error: unknown) => console.warn('[WebGPU] Device-loss listener failed.', error));
    } catch (error) { console.warn('[WebGPU] Device-loss listener failed.', error); }
  }

  /** This renderer owns its device. Safe during an outstanding timing readback. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deviceLostListeners.clear();
    this.gpuTimer.dispose();
    this.instancePartition?.dispose();
    this.instancePartition = null;
    this.invalidateDynamicCaches();
    const errors: unknown[] = [];
    const buffers = [
      'uniformBuffer', 'vertexBuffer', 'matrixBuffer', 'colorBuffer',
      'ropePositionBuffer', 'ropeSegmentBuffer', 'ropeUniformBuffer', 'lineBuffer',
      'surfaceVertexBuffer', 'surfaceIndexBuffer', 'clothPositionBuffer',
      'clothRestPositionBuffer', 'clothParamsBuffer', 'waterEtaBuffer',
      'waterUBuffer', 'waterVBuffer', 'waterParamsBuffer',
    ] as const;
    const textures = [
      'shadowTexture', 'materialNoiseTexture', 'materialAtlasAlbedoTexture',
      'materialAtlasSurfaceTexture', 'depthTexture', 'msaaTexture', 'hdrTexture',
    ] as const;
    for (const field of [...buffers, ...textures]) {
      try { this[field]?.destroy(); } catch (error) { errors.push(error); }
      // These fields are non-null while live. Public upload/render entry points
      // reject after disposal before touching any released resource.
      (this[field] as GPUBuffer | GPUTexture | null) = null;
    }
    // Pipelines, bind groups, views and samplers have no destroy API. Release
    // their references so they cannot retain the destroyed resource graph.
    const references = [
      'shadowPipeline', 'surfaceShadowPipeline', 'gpuClothShadowPipeline',
      'mainPipelines1x', 'mainPipelines4x', 'mainPipelines', 'postPipeline',
      'ropeComputePipeline', 'shadowBindGroup', 'sceneBindGroup',
      'sceneBindGroupLayout', 'gpuClothBindGroup', 'gpuWaterBindGroup',
      'gpuWaterBindGroupLayout',
      'ropeComputeBindGroup', 'postBindGroup', 'postBindGroupLayout',
      'shadowView', 'shadowSampler', 'linearSampler', 'materialNoiseView',
      'materialNoiseSampler', 'materialAtlasAlbedoView', 'materialAtlasSurfaceView',
      'materialAtlasSampler', 'depthView', 'msaaView', 'hdrView',
    ] as const;
    for (const field of references) (this[field] as unknown) = null;
    this.surfaceMaterial = null;
    this.surfacePath = null;
    this.surfaceVertexCount = 0;
    this.surfaceIndexCount = 0;
    this.width = 0;
    this.height = 0;
    this.lastUploadedBytes = 0;
    this.uniformScratch = new Float32Array(0);
    (this.lineScratch as Float32Array) = new Float32Array(0);
    (this.surfaceIndexUploadScratch as Uint8Array) = new Uint8Array(0);
    try { (this.context as GPUCanvasContext & { unconfigure?(): void }).unconfigure?.(); } catch (error) { errors.push(error); }
    try { (this.device as GPUDevice & { destroy?(): void }).destroy?.(); } catch (error) { errors.push(error); }
    if (errors.length > 0) console.warn('[WebGPU] Renderer disposal encountered resource errors.', errors);
  }

  destroy(): void {
    this.dispose();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('WebGPURenderer has been disposed.');
  }

  uploadedMegabytes(): number {
    return this.lastUploadedBytes / (1024 * 1024);
  }

  viewport(): readonly [number, number] {
    return [this.width, this.height];
  }

  materialTextureInfo(): Readonly<Pick<MaterialNoiseTexture, 'compressed' | 'sourceBytes' | 'source'>> {
    return this.materialNoiseInfo;
  }

  materialAtlasTextureInfo(): Readonly<Pick<MaterialAtlasTexture, 'compressed' | 'sourceBytes' | 'source'>> {
    return this.materialAtlasInfo;
  }

  qualityConfiguration(): Readonly<{ sampleCount: 1 | 4; shadowMapSize: 1024 | 2048; shadowTapCount: 1 | 9 }> {
    return {
      sampleCount: this.sampleCount,
      shadowMapSize: this.shadowMapSize,
      shadowTapCount: this.uniformScratch[48] < 1.5 ? 1 : 9,
    };
  }

}
