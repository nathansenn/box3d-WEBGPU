/**
 * GLSL ES 3.00 programs of the Lab's WebGL2 renderer (src/webgl/lab-renderer.ts). They follow the
 * WGSL of src/webgpu/renderer.ts: the same uniform block layout (std140 matches the WGSL struct
 * float for float), the same lighting terms, fog, sky, line and post-processing arithmetic, with
 * these differences:
 *
 *   - Clip depth: the Lab's matrices produce WebGPU depth (0 to 1); `glClip` maps it to GL's -1 to 1,
 *     so the depth written and compared is the same number in both renderers.
 *   - No material textures (the Poliigon atlas and the noise texture are KTX2 GPU uploads of the
 *     WebGPU path): atlas materials use the tile's mean colour, no normal detail, and the noise terms
 *     take their mean (0.5). Galvanized metal uses isotropic GGX rather than the anisotropic lobe.
 *   - Cloth strain looks at fewer neighbours (computed on the CPU, src/webgl/lab-streams.ts).
 *   - The shadow lookup's depth bias is larger (0.00015 + 0.0006 (1 - N.L) instead of 0.00004 + 0.00028 (1 - N.L)):
 *     with the WebGPU bias a flat floor shows acne bands that the WebGPU path's material textures hide.
 *   - Without EXT_color_buffer_float the scene is tone-mapped in each fragment (`INLINE_TONEMAP`)
 *     instead of in the post pass, so blending happens after tone mapping and there is no bloom.
 */

export const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform Scene {
  mat4 viewProj;
  mat4 lightViewProj;
  vec4 cameraPosTime;
  vec4 lightDirExposure;
  vec4 fogColorDensity;
  vec4 viewportBloomShadow;
  vec4 qualityModes;
  vec4 renderOptions;
};
vec4 glClip(vec4 c) { return vec4(c.xy, 2.0 * c.z - c.w, c.w); }
vec3 srgbToLinear(vec3 c) {
  return mix(pow((c + vec3(0.055)) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
}
vec3 linearToSrgb(vec3 c) {
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + vec3(0.03))) / (x * (2.43 * x + vec3(0.59)) + vec3(0.14)), vec3(0.0), vec3(1.0));
}
`;

/** Fragment helpers: shadow lookups and the colour that leaves a scene fragment. */
const FRAGMENT_COMMON = /* glsl */ `
precision highp sampler2DShadow;
uniform sampler2DShadow shadowMap;
out vec4 fragColor;

float sampleShadowMap(vec4 shadowPosition, vec3 normal, vec3 lightDirection, float minBias, float slopeBias, float spread) {
  if (viewportBloomShadow.w <= 0.001) return 1.0;
  vec3 projected = shadowPosition.xyz / max(shadowPosition.w, 0.0001);
  // GL textures start at the bottom row, so v follows NDC y (WebGPU flips it).
  vec2 uvUnclamped = vec2(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
  float inBounds = (uvUnclamped.x > 0.0 && uvUnclamped.x < 1.0 && uvUnclamped.y > 0.0 && uvUnclamped.y < 1.0 &&
    projected.z > 0.0 && projected.z < 1.0) ? 1.0 : 0.0;
  vec2 uv = clamp(uvUnclamped, vec2(0.0015), vec2(0.9985));
  vec2 texel = vec2(1.0) / vec2(textureSize(shadowMap, 0));
  float nDotL = max(dot(normal, -lightDirection), 0.0);
  float referenceDepth = clamp(projected.z - max(minBias, slopeBias * (1.0 - nDotL)), 0.0, 1.0);
  if (qualityModes.x < 1.5) return mix(1.0, texture(shadowMap, vec3(uv, referenceDepth)), inBounds);
  float visibility = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      visibility += weight * texture(shadowMap, vec3(uv + vec2(float(x), float(y)) * texel * spread, referenceDepth));
    }
  }
  return mix(1.0, visibility / 16.0, inBounds);
}

vec4 present(vec3 color, float alpha) {
#ifdef INLINE_TONEMAP
  float studio = qualityModes.w > 0.5 ? 1.0 : 0.0;
  vec3 c = acesFilm(color * lightDirExposure.w * mix(1.0, 1.07, studio));
  vec2 centered = gl_FragCoord.xy / max(viewportBloomShadow.xy, vec2(1.0)) - vec2(0.5);
  c *= 1.0 - smoothstep(0.38, 0.76, length(centered)) * mix(0.13, 0.075, studio);
  return vec4(linearToSrgb(clamp(c, vec3(0.0), vec3(1.0))), alpha);
#else
  return vec4(color, alpha);
#endif
}

vec3 studioEnvironment(vec3 direction) {
  vec3 ray = normalize(direction);
  float vertical = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 radiance = mix(vec3(0.048, 0.042, 0.036), vec3(0.20, 0.185, 0.155), vertical);
  float overhead = pow(max(ray.y, 0.0), 8.0);
  float bayA = pow(max(dot(ray, normalize(vec3(-0.22, 0.96, 0.12))), 0.0), 48.0);
  float bayB = pow(max(dot(ray, normalize(vec3(0.28, 0.94, -0.18))), 0.0), 52.0);
  float bayC = pow(max(dot(ray, normalize(vec3(-0.08, 0.97, -0.32))), 0.0), 44.0);
  float key = pow(max(dot(ray, normalize(vec3(-0.55, 0.72, 0.38))), 0.0), 22.0);
  float fill = pow(max(dot(ray, normalize(vec3(0.62, 0.42, 0.48))), 0.0), 28.0);
  float wall = pow(max(dot(ray, normalize(vec3(0.08, 0.12, 0.99))), 0.0), 6.0);
  return radiance + vec3(1.15, 1.05, 0.88) * overhead + vec3(1.55, 1.38, 1.08) * (bayA + bayB * 0.85 + bayC * 0.70)
    + vec3(1.28, 1.12, 0.92) * key + vec3(0.42, 0.38, 0.32) * fill + vec3(0.16, 0.15, 0.13) * wall;
}
float fogAt(vec3 worldPos, float scale, float limit) {
  float d = length(cameraPosTime.xyz - worldPos);
  return clamp(1.0 - exp(-fogColorDensity.w * d * d * scale), 0.0, limit);
}
`;

export const SOLID_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aM0;
layout(location = 3) in vec4 aM1;
layout(location = 4) in vec4 aM2;
layout(location = 5) in vec4 aM3;
layout(location = 6) in vec4 aColor;
out vec3 vNormal;
out vec4 vColor;
out vec3 vWorld;
out vec4 vShadow;
out vec2 vUv;
vec2 dominantProjectionUv(vec3 p, vec3 n) {
  vec3 a = abs(n);
  if (a.y >= a.x && a.y >= a.z) return p.xz;
  if (a.x >= a.z) return p.zy;
  return p.xy;
}
void main() {
  mat4 model = mat4(aM0, aM1, aM2, aM3);
  vec4 world = model * vec4(aPosition, 1.0);
  gl_Position = glClip(viewProj * world);
  // Columns hold rotation times half extents: light with the rotation only.
  mat3 basis = mat3(normalize(aM0.xyz), normalize(aM1.xyz), normalize(aM2.xyz));
  vNormal = normalize(basis * aNormal);
  vColor = aColor;
  vWorld = world.xyz;
  vShadow = lightViewProj * world;
  vUv = dominantProjectionUv(aPosition * vec3(length(aM0.xyz), length(aM1.xyz), length(aM2.xyz)), aNormal) * 0.22;
}
`;

export const SOLID_FRAGMENT = /* glsl */ `${COMMON}${FRAGMENT_COMMON}
in vec3 vNormal;
in vec4 vColor;
in vec3 vWorld;
in vec4 vShadow;
in vec2 vUv;
const float PI = 3.14159265;
float distributionGGX(float nDotH, float roughness) {
  float a = roughness * roughness, a2 = a * a, d = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 0.0001);
}
float geometrySchlickGGX(float nDotV, float roughness) {
  float r = roughness + 1.0, k = r * r / 8.0;
  return nDotV / max(nDotV * (1.0 - k) + k, 0.0001);
}
vec3 fresnelSchlick(float cosTheta, vec3 f0) { return f0 + (vec3(1.0) - f0) * pow(1.0 - cosTheta, 5.0); }
vec3 fresnelSchlickRoughness(float nDotV, vec3 f0, float roughness) {
  vec3 grazing = max(vec3(1.0 - roughness), f0);
  return f0 + (grazing - f0) * pow(1.0 - nDotV, 5.0);
}
void main() {
  int materialId = int(roundEven(max(-vColor.a, 0.0)));
  if (materialId == 4 || materialId == 6) discard;
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(cameraPosTime.xyz - vWorld);
  vec3 lightDirection = normalize(lightDirExposure.xyz);
  vec3 toLight = -lightDirection;
  vec3 halfVector = normalize(viewDirection + toLight);
  vec3 authoredColor = srgbToLinear(clamp(vColor.rgb, vec3(0.0), vec3(1.0)));
  // The mean linear colour of each atlas tile (public/textures/poliigon-materials-albedo-rgba8.ktx2, level 0)
  // stands in for the texture: concrete, galvanized metal, woven fabric, honed stone.
  vec3 tile = materialId == 1 ? vec3(0.114, 0.100, 0.073) : materialId == 2 ? vec3(0.478, 0.512, 0.500)
    : materialId == 3 ? vec3(0.043, 0.049, 0.067) : vec3(0.290, 0.252, 0.203);
  bool usesAtlas = materialId == 1 || materialId == 2 || materialId == 3 || materialId == 5;
  vec3 baseColor = usesAtlas ? tile * mix(vec3(0.76), authoredColor * 1.45, 0.36) : authoredColor;
  if (materialId == 2) baseColor = clamp(mix(tile, authoredColor, 0.58) * vec3(1.0, 0.99, 0.95), vec3(0.08), vec3(0.78));
  float metallic = 0.0;
  float roughness = 0.46;
  if (materialId == 1) roughness = 0.80;
  if (materialId == 2) { metallic = 0.92; roughness = 0.32; }
  if (materialId == 3) roughness = 0.88;
  if (materialId == 5) roughness = 0.66;
  if (materialId == 7) roughness = 0.32;
  if (materialId == 8) { metallic = 0.24; roughness = 0.40; }

  float nDotL = max(dot(normal, toLight), 0.0);
  float nDotV = max(dot(normal, viewDirection), 0.0);
  float nDotH = max(dot(normal, halfVector), 0.0);
  float vDotH = max(dot(viewDirection, halfVector), 0.0);
  vec3 f0 = mix(vec3(0.04), baseColor, metallic);
  vec3 fresnel = fresnelSchlick(vDotH, f0);
  float distribution = distributionGGX(nDotH, roughness);
  float geometry = geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness);
  vec3 envDirection = reflect(-viewDirection, normal);
  vec3 specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * nDotL, 0.001);
  vec3 kD = (vec3(1.0) - fresnel) * (1.0 - metallic);
  float shadowVisibility = mix(1.0, sampleShadowMap(vShadow, normal, lightDirection, 0.00015, 0.0006, 1.0), viewportBloomShadow.w);
  float studioMix = qualityModes.w > 0.5 ? 1.0 : 0.0;
  vec3 sunRadiance = mix(vec3(5.8, 5.15, 4.55), vec3(4.55, 4.15, 3.45), studioMix);
  vec3 direct = (kD * baseColor / PI + specular) * sunRadiance * nDotL * shadowVisibility;
  vec3 emissive = baseColor * max(vColor.a - 1.0, 0.0) * 2.2;
  vec3 environmentFresnel = fresnelSchlickRoughness(nDotV, f0, roughness);
  vec3 environmentBottom = mix(vec3(0.075, 0.060, 0.052), vec3(0.042, 0.038, 0.032), studioMix);
  vec3 environmentTop = mix(vec3(0.20, 0.34, 0.56), vec3(0.24, 0.22, 0.18), studioMix);
  vec3 diffuseIrradiance = mix(environmentBottom, environmentTop, clamp(normal.y * 0.5 + 0.5, 0.0, 1.0)) + mix(vec3(0.025), vec3(0.048), studioMix);
  diffuseIrradiance += studioMix * vec3(0.14, 0.12, 0.09) * max(dot(normal, normalize(vec3(-0.55, 0.72, 0.38))), 0.0);
  float ambientVisibility = mix(1.0, 0.66 + 0.34 * shadowVisibility, studioMix);
  vec3 ambientDiffuse = diffuseIrradiance * baseColor * (vec3(1.0) - environmentFresnel) * (1.0 - metallic) * ambientVisibility;
  vec3 outdoorEnvironment = mix(environmentBottom, vec3(0.20, 0.38, 0.68), clamp(envDirection.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 roughStudio = mix(studioEnvironment(envDirection), vec3(0.22, 0.205, 0.175), roughness * roughness * 0.82);
  vec3 environment = mix(outdoorEnvironment, roughStudio, studioMix);
  vec3 environmentSpecular = environment * environmentFresnel * mix(0.24, 1.0, metallic) * (1.0 - roughness * 0.52)
    * mix(1.0, 0.82 + 0.18 * shadowVisibility, studioMix);
  vec3 color = ambientDiffuse + direct + emissive + environmentSpecular;
  color = mix(color, fogColorDensity.xyz, fogAt(vWorld, 0.018, 0.92));
  fragColor = present(color, 1.0);
}
`;

export const TRANSPARENT_FRAGMENT = /* glsl */ `${COMMON}${FRAGMENT_COMMON}
in vec3 vNormal;
in vec4 vColor;
in vec3 vWorld;
in vec4 vShadow;
in vec2 vUv;
void main() {
  int materialId = int(roundEven(max(-vColor.a, 0.0)));
  if (materialId != 4 && materialId != 6) discard;
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(cameraPosTime.xyz - vWorld);
  float variation = 0.5;
  float fogAmount = fogAt(vWorld, 0.018, 0.88);
  if (materialId == 4) {
    float facing = abs(dot(normal, viewDirection));
    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
    vec3 reflected = reflect(-viewDirection, normal);
    float studioMix = qualityModes.w > 0.5 ? 1.0 : 0.0;
    vec3 outdoor = mix(vec3(0.055, 0.048, 0.044), vec3(0.22, 0.48, 0.82), clamp(reflected.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 environment = mix(outdoor, studioEnvironment(reflected), studioMix);
    vec3 tint = srgbToLinear(clamp(vColor.rgb, vec3(0.0), vec3(1.0)));
    vec3 color = tint * (0.11 + variation * 0.035) + environment * (0.22 + fresnel * 0.78);
    color = mix(color, fogColorDensity.xyz, fogAmount);
    fragColor = present(color, clamp(0.10 + fresnel * 0.48 + variation * 0.025, 0.10, 0.62));
    return;
  }
  vec3 lightDirection = normalize(lightDirExposure.xyz);
  float diffuse = 0.38 + max(dot(normal, -lightDirection), 0.0) * 0.28;
  vec3 dust = srgbToLinear(clamp(vColor.rgb, vec3(0.0), vec3(1.0))) * (diffuse + variation * 0.16);
  dust = mix(dust, fogColorDensity.xyz, fogAmount);
  fragColor = present(dust, clamp(0.10 + variation * 0.16, 0.10, 0.30));
}
`;

export const SHADOW_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec4 aM0;
layout(location = 3) in vec4 aM1;
layout(location = 4) in vec4 aM2;
layout(location = 5) in vec4 aM3;
layout(location = 6) in vec4 aColor;
out float vAlpha;
void main() {
  gl_Position = glClip(lightViewProj * mat4(aM0, aM1, aM2, aM3) * vec4(aPosition, 1.0));
  vAlpha = aColor.a;
}
`;

export const SHADOW_FRAGMENT = /* glsl */ `${COMMON}
in float vAlpha;
out vec4 fragColor;
void main() {
  int materialId = int(roundEven(max(-vAlpha, 0.0)));
  // Glass and dust do not cast; emitters (alpha above one) do not either.
  if (materialId == 4 || materialId == 6 || vAlpha > 1.001) discard;
  fragColor = vec4(0.0);
}
`;

export const SURFACE_SHADOW_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec3 aPosition;
void main() { gl_Position = glClip(lightViewProj * vec4(aPosition, 1.0)); }
`;

export const SURFACE_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aUv;
out vec3 vNormal;
out vec4 vColor;
out vec3 vWorld;
out vec4 vShadow;
out vec2 vUv;
void main() {
  vec4 world = vec4(aPosition, 1.0);
  gl_Position = glClip(viewProj * world);
  vNormal = aNormal;
  vColor = aColor;
  vWorld = aPosition;
  vShadow = lightViewProj * world;
  vUv = aUv;
}
`;

/** Cloth (0), brushed sheet (1) and water (2), after the WebGPU cloth, sheet and water fragments. */
export const SURFACE_FRAGMENT = /* glsl */ `${COMMON}${FRAGMENT_COMMON}
uniform int uShading;
in vec3 vNormal;
in vec4 vColor;
in vec3 vWorld;
in vec4 vShadow;
in vec2 vUv;
void main() {
  vec3 geometricNormal = normalize(vNormal);
  vec3 normal = gl_FrontFacing ? geometricNormal : -geometricNormal;
  vec3 viewDirection = normalize(cameraPosTime.xyz - vWorld);
  vec3 lightDirection = normalize(lightDirExposure.xyz);
  vec3 toLight = -lightDirection;
  vec3 halfVector = normalize(viewDirection + toLight);
  float studioMix = qualityModes.w > 0.5 ? 1.0 : 0.0;
  if (uShading == 2) {
    normal = normalize(normal + vec3(sin(vWorld.x * 8.7 + cameraPosTime.w * 1.3) * 0.018, 0.0, cos(vWorld.z * 10.3 - cameraPosTime.w * 1.1) * 0.018));
    float nDotV = max(dot(normal, viewDirection), 0.0);
    float nDotL = max(dot(normal, toLight), 0.0);
    float nDotH = max(dot(normal, halfVector), 0.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - nDotV, 5.0);
    float foam = clamp(vColor.a, 0.0, 1.0);
    float visibility = mix(1.0, sampleShadowMap(vShadow, normal, lightDirection, 0.00015, 0.0006, 1.05), viewportBloomShadow.w * 0.7);
    vec3 depthTint = srgbToLinear(clamp(vColor.rgb, vec3(0.0), vec3(1.0)));
    vec3 sky = mix(vec3(0.05, 0.18, 0.34), vec3(0.34, 0.58, 0.92), clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 glint = pow(nDotH, 230.0) * vec3(14.0, 10.5, 7.0) * visibility + pow(nDotH, 42.0) * vec3(1.4, 1.8, 2.4) * visibility;
    vec3 subsurface = depthTint * (0.30 + 0.70 * nDotL) * vec3(0.26, 0.72, 0.86);
    vec3 color = mix(subsurface, sky, fresnel) + glint;
    color = mix(color, vec3(0.82, 0.94, 1.0) * (0.75 + nDotL * 1.4), foam * 0.88);
    color += vec3(0.02, 0.16, 0.24) * (1.0 - nDotV) * 0.8;
    color = mix(color, fogColorDensity.xyz, fogAt(vWorld, 0.014, 0.78));
    fragColor = present(color, clamp(0.56 + fresnel * 0.24 + foam * 0.20, 0.56, 0.96));
    return;
  }
  float nDotL = max(dot(normal, toLight), 0.0);
  float nDotV = max(dot(normal, viewDirection), 0.0);
  float nDotH = max(dot(normal, halfVector), 0.0);
  float visibility = mix(1.0, sampleShadowMap(vShadow, normal, lightDirection, 0.00015, 0.0006, 1.05), viewportBloomShadow.w);
  vec3 authored = srgbToLinear(clamp(vColor.rgb, vec3(0.0), vec3(1.0)));
  if (uShading == 1) {
    float overlay = clamp(vColor.a, 0.0, 1.0);
    vec3 baseColor = mix(clamp(mix(vec3(0.52, 0.55, 0.58), mix(vec3(0.478, 0.512, 0.500), authored, 0.46), 0.42), vec3(0.08), vec3(0.72)), authored, overlay * 0.48);
    float metallic = mix(0.92, 0.24, overlay);
    float roughness = 0.33;
    float a = roughness * roughness, a2 = a * a, d = nDotH * nDotH * (a2 - 1.0) + 1.0;
    vec3 f0 = mix(vec3(0.04), baseColor, metallic);
    vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - max(dot(viewDirection, halfVector), 0.0), 5.0);
    vec3 specular = fresnel * (a2 / max(3.14159265 * d * d, 0.0001)) * 0.25;
    vec3 kD = (vec3(1.0) - fresnel) * (1.0 - metallic);
    vec3 environment = mix(mix(vec3(0.075, 0.060, 0.052), vec3(0.20, 0.38, 0.68), clamp(reflect(-viewDirection, normal).y * 0.5 + 0.5, 0.0, 1.0)),
      studioEnvironment(reflect(-viewDirection, normal)) * 0.5, studioMix);
    vec3 color = (kD * baseColor / 3.14159265 + specular) * vec3(5.8, 5.15, 4.55) * nDotL * visibility
      + baseColor * vec3(0.12, 0.14, 0.18) * (1.0 - metallic) + environment * f0 * 0.6;
    color = mix(color, fogColorDensity.xyz, fogAt(vWorld, 0.018, 0.90));
    fragColor = present(color, 1.0);
    return;
  }
  float warp = 0.5 + 0.5 * sin(vUv.x * 1256.637 + vUv.y * 7.0);
  float weft = 0.5 + 0.5 * sin(vUv.y * 942.478 + vUv.x * 5.0);
  float weave = mix(0.82, 1.12, warp * weft);
  float stress = clamp(vColor.a, 0.0, 1.0);
  vec3 baseColor = srgbToLinear(clamp(vColor.rgb * weave, vec3(0.0), vec3(1.0))) * mix(vec3(1.0), vec3(0.043, 0.049, 0.067) * 1.55, 0.48);
  vec3 studioAmbient = studioEnvironment(normal) * 0.34 * (0.70 + visibility * 0.30);
  vec3 diffuse = baseColor * (mix(vec3(0.16, 0.22, 0.34), studioAmbient, studioMix) + vec3(3.7, 3.35, 3.0) * nDotL * visibility);
  float fiber = pow(nDotH, mix(42.0, 115.0, warp)) * (0.16 + stress * 0.24) * visibility;
  vec3 back = pow(max(dot(-normal, toLight), 0.0), 1.7) * baseColor * mix(vec3(0.95, 0.38, 0.18), vec3(0.62, 0.64, 0.66), studioMix) * 0.42;
  vec3 rim = pow(1.0 - nDotV, 3.0) * mix(mix(vec3(0.08, 0.22, 0.46), vec3(1.0, 0.12, 0.03), stress), vec3(0.16), studioMix) * mix(0.65, 0.28, studioMix);
  vec3 glow = vec3(1.4, 0.05, 0.01) * pow(stress, 3.0) * mix(1.4, 0.34, studioMix);
  vec3 color = diffuse + vec3(fiber) + back + rim + glow;
  color = mix(color, fogColorDensity.xyz, fogAt(vWorld, 0.018, 0.90));
  fragColor = present(color, 1.0);
}
`;

export const SKY_VERTEX = /* glsl */ `${COMMON}
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  // 0.9999 in WebGPU depth; the sky is drawn with depth testing off.
  gl_Position = vec4(p, 0.9998, 1.0);
  vUv = p * 0.5 + vec2(0.5);
}
`;

export const SKY_FRAGMENT = /* glsl */ `${COMMON}${FRAGMENT_COMMON}
in vec2 vUv;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main() {
  vec2 uv = vUv;
  float studioMix = qualityModes.w > 0.5 ? 1.0 : 0.0;
  vec3 top = mix(vec3(0.006, 0.014, 0.035), vec3(0.24, 0.21, 0.16), studioMix);
  vec3 middle = mix(vec3(0.035, 0.10, 0.19), vec3(0.20, 0.175, 0.14), studioMix);
  vec3 horizon = mix(vec3(0.19, 0.25, 0.31), vec3(0.15, 0.13, 0.105), studioMix);
  float vertical = clamp(uv.y, 0.0, 1.0);
  vec3 color = mix(horizon, middle, smoothstep(0.0, 0.44, vertical));
  color = mix(color, top, smoothstep(0.42, 1.0, vertical));
  vec3 lightDirection = normalize(lightDirExposure.xyz);
  vec2 sunPosition = vec2(0.68 - lightDirection.x * 0.22, 0.72 + lightDirection.y * 0.08);
  float sunDistance = distance(uv, sunPosition);
  color += (1.0 - studioMix) * (vec3(8.0, 5.2, 2.6) * exp(-sunDistance * sunDistance * 1400.0) + vec3(0.55, 0.28, 0.12) * exp(-sunDistance * sunDistance * 42.0));
  float star = step(0.9978, hash21(floor(uv * vec2(1100.0, 620.0)))) * smoothstep(0.5, 0.9, vertical);
  color += vec3(star * 1.8 * (1.0 - studioMix));
  float haze = pow(max(0.0, 1.0 - abs(vertical - 0.31) * 3.2), 4.0);
  color += mix(vec3(0.12, 0.11, 0.09), vec3(0.04, 0.034, 0.026), studioMix) * haze;
  float floorFalloff = 1.0 - smoothstep(0.0, 0.30, vertical);
  float wallWash = exp(-pow((uv.x - 0.50) * 1.45, 2.0) - pow((uv.y - 0.43) * 2.4, 2.0));
  color += vec3(0.045, 0.038, 0.028) * wallWash * studioMix;
  float bays = exp(-pow((uv.x - 0.28) * 7.5, 2.0) - pow((uv.y - 0.84) * 11.0, 2.0)) + exp(-pow((uv.x - 0.50) * 7.5, 2.0) - pow((uv.y - 0.86) * 11.0, 2.0))
    + exp(-pow((uv.x - 0.72) * 7.5, 2.0) - pow((uv.y - 0.83) * 11.0, 2.0));
  color += vec3(0.28, 0.24, 0.16) * bays * studioMix;
  color = mix(color, color * vec3(0.72, 0.66, 0.55), floorFalloff * studioMix);
  fragColor = present(color, 1.0);
}
`;

export const LINE_VERTEX = /* glsl */ `${COMMON}
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
out vec4 vColor;
void main() { gl_Position = glClip(viewProj * vec4(aPosition, 1.0)); vColor = aColor; }
`;

export const LINE_FRAGMENT = /* glsl */ `${COMMON}${FRAGMENT_COMMON}
in vec4 vColor;
void main() { fragColor = present(vColor.rgb * 1.8, vColor.a); }
`;

export const POST_VERTEX = /* glsl */ `${COMMON}
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
  vUv = p * 0.5 + vec2(0.5);
}
`;

/** Bloom, exposure, ACES, vignette, sRGB and dither, as the WebGPU post pass. No V flip: GL textures start at the bottom. */
export const POST_FRAGMENT = /* glsl */ `${COMMON}
uniform sampler2D hdrTexture;
uniform int uPassThrough;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 color = texture(hdrTexture, vUv).rgb;
  if (uPassThrough == 1) { fragColor = vec4(color, 1.0); return; }
  vec2 texel = vec2(1.0) / max(viewportBloomShadow.xy, vec2(1.0));
  if (viewportBloomShadow.z > 0.001) {
    vec2 directions[8] = vec2[8](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0),
      vec2(0.707, -0.707), vec2(-0.707, -0.707), vec2(0.707, 0.707), vec2(-0.707, 0.707));
    int count = qualityModes.y > 1.5 ? 8 : 4;
    vec3 bloom = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      if (i >= count) break;
      vec3 s = texture(hdrTexture, vUv + directions[i] * texel * 3.0).rgb;
      float peak = max(s.r, max(s.g, s.b));
      bloom += s * smoothstep(0.95, 1.90, peak) * max(peak - 0.80, 0.0) / max(peak, 0.001);
    }
    color += bloom * (viewportBloomShadow.z * (qualityModes.w > 0.5 ? 0.28 : 1.0) * (0.38 / float(count)));
  }
  float studio = qualityModes.w > 0.5 ? 1.0 : 0.0;
  color = acesFilm(color * lightDirExposure.w * mix(1.0, 1.07, studio));
  color *= 1.0 - smoothstep(0.38, 0.76, length(vUv - vec2(0.5))) * mix(0.13, 0.075, studio);
  color = linearToSrgb(clamp(color, vec3(0.0), vec3(1.0)));
  // GL's window origin is the bottom-left corner; flip y so the dither pattern matches WebGPU's.
  vec2 pixel = floor(vec2(gl_FragCoord.x, viewportBloomShadow.y - gl_FragCoord.y));
  float ign = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(clamp(color + vec3((ign - 0.5) / 255.0), vec3(0.0), vec3(1.0)), 1.0);
}
`;
