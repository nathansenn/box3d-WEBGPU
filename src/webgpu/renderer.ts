import type { Mat4 } from '../math';
import type { DebugLine, InstanceBufferSource, SceneUniformState } from '../types';

const CUBE_VERTEX_COUNT = 36;
const MAX_DEBUG_LINE_VERTICES = 131072;
const SCENE_UNIFORM_FLOATS = 48;
const SCENE_UNIFORM_BYTES = SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const SHADOW_MAP_SIZE = 2048;
const MSAA_SAMPLE_COUNT = 4;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';

const sceneUniformStruct = /* wgsl */ `
struct SceneUniforms {
  viewProj : mat4x4<f32>,
  lightViewProj : mat4x4<f32>,
  cameraPosTime : vec4<f32>,
  lightDirExposure : vec4<f32>,
  fogColorDensity : vec4<f32>,
  viewportBloomShadow : vec4<f32>,
};
`;

const solidShader = /* wgsl */ `
${sceneUniformStruct}

@group(0) @binding(0)
var<uniform> scene : SceneUniforms;

@group(0) @binding(1)
var shadowMap : texture_depth_2d;

@group(0) @binding(2)
var shadowSampler : sampler_comparison;

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
};

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
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
  return out;
}

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

fn sampleShadow(shadowPosition : vec4<f32>, normal : vec3<f32>, lightDirection : vec3<f32>) -> f32 {
  let projected = shadowPosition.xyz / max(shadowPosition.w, 0.0001);
  let uv = vec2<f32>(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || projected.z <= 0.0 || projected.z >= 1.0) {
    return 1.0;
  }

  let dimensions = vec2<f32>(textureDimensions(shadowMap));
  let texel = vec2<f32>(1.0) / dimensions;
  let nDotL = max(dot(normal, -lightDirection), 0.0);
  let bias = max(0.00016, 0.0012 * (1.0 - nDotL));
  var visibility = 0.0;

  for (var x : i32 = -1; x <= 1; x = x + 1) {
    for (var y : i32 = -1; y <= 1; y = y + 1) {
      let offset = vec2<f32>(f32(x), f32(y)) * texel * 1.25;
      visibility = visibility + textureSampleCompare(shadowMap, shadowSampler, uv + offset, projected.z - bias);
    }
  }
  return visibility / 9.0;
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  let normal = normalize(input.worldNormal);
  let viewDirection = normalize(scene.cameraPosTime.xyz - input.worldPos);
  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let toLight = -lightDirection;
  let halfVector = normalize(viewDirection + toLight);

  let encodedColor = clamp(input.color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let baseColor = pow(encodedColor, vec3<f32>(2.2));
  let maxChannel = max(baseColor.r, max(baseColor.g, baseColor.b));
  let minChannel = min(baseColor.r, min(baseColor.g, baseColor.b));
  let saturation = (maxChannel - minChannel) / max(maxChannel, 0.001);
  let luminance = dot(baseColor, vec3<f32>(0.2126, 0.7152, 0.0722));
  let metallic = clamp((1.0 - saturation) * 0.48 + smoothstep(0.45, 0.9, luminance) * 0.12, 0.03, 0.62);
  let microVariation = fract(sin(dot(floor(input.worldPos * 2.0), vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
  let roughness = clamp(0.28 + (1.0 - saturation) * 0.28 + microVariation * 0.08, 0.2, 0.78);

  let nDotL = max(dot(normal, toLight), 0.0);
  let nDotV = max(dot(normal, viewDirection), 0.0);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let vDotH = max(dot(viewDirection, halfVector), 0.0);

  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(vDotH, f0);
  let distribution = distributionGGX(nDotH, roughness);
  let geometry = geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness);
  let specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * nDotL, 0.001);
  let kD = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);

  let shadowVisibility = mix(1.0, sampleShadow(input.shadowPosition, normal, lightDirection), scene.viewportBloomShadow.w);
  let sunRadiance = vec3<f32>(5.8, 5.15, 4.55);
  let direct = (kD * baseColor / 3.14159265 + specular) * sunRadiance * nDotL * shadowVisibility;

  let skyAmbient = vec3<f32>(0.22, 0.34, 0.58) * (normal.y * 0.5 + 0.5);
  let groundAmbient = vec3<f32>(0.08, 0.065, 0.055) * (1.0 - max(normal.y, 0.0));
  let ambientOcclusionProxy = 0.58 + 0.42 * smoothstep(-0.5, 4.0, input.worldPos.y);
  let ambient = (skyAmbient + groundAmbient + vec3<f32>(0.035)) * baseColor * ambientOcclusionProxy;

  let rim = pow(1.0 - nDotV, 3.5) * vec3<f32>(0.08, 0.18, 0.34);
  let emissiveStrength = max(input.color.a - 1.0, 0.0);
  let emissive = baseColor * emissiveStrength * 2.2;
  var color = ambient + direct + rim + emissive;

  let distanceToCamera = length(scene.cameraPosTime.xyz - input.worldPos);
  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceToCamera * distanceToCamera * 0.018);
  color = mix(color, scene.fogColorDensity.xyz, clamp(fogAmount, 0.0, 0.92));
  return vec4<f32>(color, 1.0);
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

@vertex
fn vsMain(input : VertexIn) -> @builtin(position) vec4<f32> {
  let model = mat4x4<f32>(input.m0, input.m1, input.m2, input.m3);
  return scene.lightViewProj * model * vec4<f32>(input.position, 1.0);
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
  let top = vec3<f32>(0.006, 0.014, 0.035);
  let middle = vec3<f32>(0.035, 0.10, 0.19);
  let horizonColor = vec3<f32>(0.19, 0.25, 0.31);
  let vertical = clamp(uv.y, 0.0, 1.0);
  var color = mix(horizonColor, middle, smoothstep(0.0, 0.44, vertical));
  color = mix(color, top, smoothstep(0.42, 1.0, vertical));

  let lightDirection = normalize(scene.lightDirExposure.xyz);
  let sunPosition = vec2<f32>(0.68 - lightDirection.x * 0.22, 0.72 + lightDirection.y * 0.08);
  let sunDistance = distance(uv, sunPosition);
  let sunCore = exp(-sunDistance * sunDistance * 1400.0);
  let sunGlow = exp(-sunDistance * sunDistance * 42.0);
  color = color + vec3<f32>(8.0, 5.2, 2.6) * sunCore + vec3<f32>(0.55, 0.28, 0.12) * sunGlow;

  let starCell = floor(uv * vec2<f32>(1100.0, 620.0));
  let star = step(0.9978, hash21(starCell)) * smoothstep(0.5, 0.9, vertical);
  color = color + vec3<f32>(star * 1.8);

  let haze = pow(max(0.0, 1.0 - abs(vertical - 0.31) * 3.2), 4.0);
  color = color + vec3<f32>(0.12, 0.11, 0.09) * haze;
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

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let texel = vec2<f32>(1.0) / max(scene.viewportBloomShadow.xy, vec2<f32>(1.0));
  var color = textureSample(hdrTexture, hdrSampler, uv).rgb;

  let directions = array<vec2<f32>, 8>(
    vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0),
    vec2<f32>(0.707, 0.707), vec2<f32>(-0.707, 0.707),
    vec2<f32>(0.707, -0.707), vec2<f32>(-0.707, -0.707)
  );

  var bloom = vec3<f32>(0.0);
  for (var i : i32 = 0; i < 8; i = i + 1) {
    let sampleColor = textureSample(hdrTexture, hdrSampler, uv + directions[i] * texel * 4.0).rgb;
    bloom = bloom + max(sampleColor - vec3<f32>(1.0), vec3<f32>(0.0));
  }
  bloom = bloom / 8.0;
  color = color + bloom * scene.viewportBloomShadow.z;
  color = color * scene.lightDirExposure.w;
  color = acesFilm(color);

  let centered = uv - vec2<f32>(0.5);
  let vignette = 1.0 - smoothstep(0.32, 0.78, length(centered)) * 0.34;
  color = color * vignette;

  let grain = (hash21(uv * scene.viewportBloomShadow.xy + scene.cameraPosTime.ww) - 0.5) * 0.018;
  color = clamp(color + vec3<f32>(grain), vec3<f32>(0.0), vec3<f32>(1.0));
  color = pow(color, vec3<f32>(1.0 / 2.2));
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

function writeFloatBuffer(queue: GPUQueue, buffer: GPUBuffer, offset: number, data: Float32Array): void {
  if (data.byteLength === 0) return;
  queue.writeBuffer(buffer, offset, data as unknown as BufferSource);
}

function createLineVertexData(lines: readonly DebugLine[], maxVertices: number): Float32Array {
  const vertexCount = Math.min(maxVertices, lines.length * 2);
  const out = new Float32Array(vertexCount * 7);
  let cursor = 0;
  for (let i = 0; i < lines.length && cursor + 14 <= out.length; i++) {
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
  return out.subarray(0, cursor);
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

export class WebGPURenderer {
  readonly canvas: HTMLCanvasElement;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly maxInstances: number;

  private shadowPipeline: GPURenderPipeline;
  private skyPipeline: GPURenderPipeline;
  private solidPipeline: GPURenderPipeline;
  private linePipeline: GPURenderPipeline;
  private postPipeline: GPURenderPipeline;
  private sceneBindGroup: GPUBindGroup;
  private postBindGroup: GPUBindGroup | null = null;
  private postBindGroupLayout: GPUBindGroupLayout;
  private uniformBuffer: GPUBuffer;
  private vertexBuffer: GPUBuffer;
  private matrixBuffer: GPUBuffer;
  private colorBuffer: GPUBuffer;
  private lineBuffer: GPUBuffer;
  private shadowTexture: GPUTexture;
  private shadowView: GPUTextureView;
  private shadowSampler: GPUSampler;
  private linearSampler: GPUSampler;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private msaaTexture: GPUTexture | null = null;
  private msaaView: GPUTextureView | null = null;
  private hdrTexture: GPUTexture | null = null;
  private hdrView: GPUTextureView | null = null;
  private width = 0;
  private height = 0;
  private resolutionScale = 1;
  private lastUploadedBytes = 0;
  private uniformScratch = new Float32Array(SCENE_UNIFORM_FLOATS);

  private constructor(args: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    maxInstances: number;
    shadowPipeline: GPURenderPipeline;
    skyPipeline: GPURenderPipeline;
    solidPipeline: GPURenderPipeline;
    linePipeline: GPURenderPipeline;
    postPipeline: GPURenderPipeline;
    sceneBindGroup: GPUBindGroup;
    postBindGroupLayout: GPUBindGroupLayout;
    uniformBuffer: GPUBuffer;
    vertexBuffer: GPUBuffer;
    matrixBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    lineBuffer: GPUBuffer;
    shadowTexture: GPUTexture;
    shadowView: GPUTextureView;
    shadowSampler: GPUSampler;
    linearSampler: GPUSampler;
  }) {
    this.canvas = args.canvas;
    this.device = args.device;
    this.context = args.context;
    this.format = args.format;
    this.maxInstances = args.maxInstances;
    this.shadowPipeline = args.shadowPipeline;
    this.skyPipeline = args.skyPipeline;
    this.solidPipeline = args.solidPipeline;
    this.linePipeline = args.linePipeline;
    this.postPipeline = args.postPipeline;
    this.sceneBindGroup = args.sceneBindGroup;
    this.postBindGroupLayout = args.postBindGroupLayout;
    this.uniformBuffer = args.uniformBuffer;
    this.vertexBuffer = args.vertexBuffer;
    this.matrixBuffer = args.matrixBuffer;
    this.colorBuffer = args.colorBuffer;
    this.lineBuffer = args.lineBuffer;
    this.shadowTexture = args.shadowTexture;
    this.shadowView = args.shadowView;
    this.shadowSampler = args.shadowSampler;
    this.linearSampler = args.linearSampler;
  }

  static async create(canvas: HTMLCanvasElement, maxInstances: number): Promise<WebGPURenderer> {
    if (!navigator.gpu) {
      throw new Error('navigator.gpu is unavailable. Open this over localhost/HTTPS in a WebGPU-capable browser.');
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was returned by the browser.');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a webgpu canvas context.');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const cube = cubeVertexData();
    const vertexBuffer = device.createBuffer({ label: 'AAA cube vertices', size: cube.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    writeFloatBuffer(device.queue, vertexBuffer, 0, cube);

    const matrixBuffer = device.createBuffer({ label: 'AAA model matrices', size: maxInstances * 16 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const colorBuffer = device.createBuffer({ label: 'AAA instance colors/material tags', size: maxInstances * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const uniformBuffer = device.createBuffer({ label: 'AAA scene uniforms', size: SCENE_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const lineBuffer = device.createBuffer({ label: 'AAA debug/effect lines', size: MAX_DEBUG_LINE_VERTICES * 7 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    const shadowTexture = device.createTexture({
      label: 'AAA 2048 shadow map',
      size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const shadowView = shadowTexture.createView();
    const shadowSampler = device.createSampler({
      label: 'AAA comparison sampler',
      compare: 'less',
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

    const sceneBindGroupLayout = device.createBindGroupLayout({
      label: 'AAA scene layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    const sceneBindGroup = device.createBindGroup({
      label: 'AAA scene bind group',
      layout: sceneBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: shadowView },
        { binding: 2, resource: shadowSampler },
      ],
    });
    const sceneLayout = device.createPipelineLayout({ label: 'AAA scene pipeline layout', bindGroupLayouts: [sceneBindGroupLayout] });

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
    await validateShaderModule(shadowModule, 'Shadow shader');
    const shadowPipeline = device.createRenderPipeline({
      label: 'AAA shadow map pipeline',
      layout: sceneLayout,
      vertex: { module: shadowModule, entryPoint: 'vsMain', buffers: instanceVertexBuffers() },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const skyModule = device.createShaderModule({ label: 'AAA atmospheric sky shader', code: skyShader });
    await validateShaderModule(skyModule, 'Atmospheric sky shader');
    const skyPipeline = device.createRenderPipeline({
      label: 'AAA atmospheric sky pipeline',
      layout: sceneLayout,
      vertex: { module: skyModule, entryPoint: 'vsMain' },
      fragment: { module: skyModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list' },
      multisample: { count: MSAA_SAMPLE_COUNT },
    });

    const solidModule = device.createShaderModule({ label: 'AAA PBR solid shader', code: solidShader });
    await validateShaderModule(solidModule, 'PBR solid shader');
    const solidPipeline = device.createRenderPipeline({
      label: 'AAA instanced PBR cube pipeline',
      layout: sceneLayout,
      vertex: { module: solidModule, entryPoint: 'vsMain', buffers: instanceVertexBuffers() },
      fragment: { module: solidModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: MSAA_SAMPLE_COUNT },
    });

    const lineModule = device.createShaderModule({ label: 'AAA line shader', code: lineShader });
    await validateShaderModule(lineModule, 'Line shader');
    const linePipeline = device.createRenderPipeline({
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
      multisample: { count: MSAA_SAMPLE_COUNT },
    });

    const postModule = device.createShaderModule({ label: 'AAA bloom and tone map shader', code: postShader });
    await validateShaderModule(postModule, 'Post-processing shader');
    const postPipeline = device.createRenderPipeline({
      label: 'AAA post-processing pipeline',
      layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsMain' },
      fragment: { module: postModule, entryPoint: 'fsMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    const renderer = new WebGPURenderer({
      canvas,
      device,
      context,
      format,
      maxInstances,
      shadowPipeline,
      skyPipeline,
      solidPipeline,
      linePipeline,
      postPipeline,
      sceneBindGroup,
      postBindGroupLayout,
      uniformBuffer,
      vertexBuffer,
      matrixBuffer,
      colorBuffer,
      lineBuffer,
      shadowTexture,
      shadowView,
      shadowSampler,
      linearSampler,
    });
    renderer.resize();
    return renderer;
  }

  resize(): void {
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * this.resolutionScale);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
    this.hdrTexture?.destroy();

    this.depthTexture = this.device.createTexture({
      label: 'AAA multisampled depth',
      size: [width, height],
      sampleCount: MSAA_SAMPLE_COUNT,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();

    this.msaaTexture = this.device.createTexture({
      label: 'AAA multisampled HDR color',
      size: [width, height],
      sampleCount: MSAA_SAMPLE_COUNT,
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaView = this.msaaTexture.createView();

    this.hdrTexture = this.device.createTexture({
      label: 'AAA resolved HDR color',
      size: [width, height],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.hdrView = this.hdrTexture.createView();

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
    writeFloatBuffer(this.device.queue, this.uniformBuffer, 0, data);
  }

  uploadInstances(source: InstanceBufferSource, count: number): number {
    const safeCount = Math.max(0, Math.min(count, this.maxInstances));
    const matrixStart = ptrToNumber(source._b3w_matrices_ptr()) / 4;
    const colorStart = ptrToNumber(source._b3w_colors_ptr()) / 4;
    const matrices = source.HEAPF32.subarray(matrixStart, matrixStart + safeCount * 16);
    const colors = source.HEAPF32.subarray(colorStart, colorStart + safeCount * 4);
    writeFloatBuffer(this.device.queue, this.matrixBuffer, 0, matrices);
    writeFloatBuffer(this.device.queue, this.colorBuffer, 0, colors);
    const bytes = matrices.byteLength + colors.byteLength;
    this.lastUploadedBytes = bytes;
    return bytes;
  }

  uploadEffects(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number): number {
    const safeBase = Math.max(0, Math.min(baseInstance, this.maxInstances));
    const safeCount = Math.max(0, Math.min(count, this.maxInstances - safeBase));
    const matrixSlice = matrices.subarray(0, safeCount * 16);
    const colorSlice = colors.subarray(0, safeCount * 4);
    writeFloatBuffer(this.device.queue, this.matrixBuffer, safeBase * 16 * 4, matrixSlice);
    writeFloatBuffer(this.device.queue, this.colorBuffer, safeBase * 4 * 4, colorSlice);
    const bytes = matrixSlice.byteLength + colorSlice.byteLength;
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  render(instanceCount: number, debugLines: readonly DebugLine[]): number {
    this.resize();
    if (!this.depthView || !this.msaaView || !this.hdrView || !this.postBindGroup) return 0;

    const safeCount = Math.max(0, Math.min(instanceCount, this.maxInstances));
    const lineData = createLineVertexData(debugLines, MAX_DEBUG_LINE_VERTICES);
    if (lineData.byteLength > 0) writeFloatBuffer(this.device.queue, this.lineBuffer, 0, lineData);

    const start = performance.now();
    const encoder = this.device.createCommandEncoder({ label: 'AAA frame encoder' });

    if (this.uniformScratch[47] > 0.001 && safeCount > 0) {
      const shadowPass = encoder.beginRenderPass({
        label: 'AAA shadow pass',
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      shadowPass.setPipeline(this.shadowPipeline);
      shadowPass.setBindGroup(0, this.sceneBindGroup);
      shadowPass.setVertexBuffer(0, this.vertexBuffer);
      shadowPass.setVertexBuffer(1, this.matrixBuffer);
      shadowPass.setVertexBuffer(2, this.colorBuffer);
      shadowPass.draw(CUBE_VERTEX_COUNT, safeCount);
      shadowPass.end();
    }

    const mainPass = encoder.beginRenderPass({
      label: 'AAA HDR main pass',
      colorAttachments: [{
        view: this.msaaView,
        resolveTarget: this.hdrView,
        clearValue: { r: 0.003, g: 0.006, b: 0.015, a: 1 },
        loadOp: 'clear',
        storeOp: 'discard',
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    mainPass.setPipeline(this.skyPipeline);
    mainPass.setBindGroup(0, this.sceneBindGroup);
    mainPass.draw(3, 1);

    mainPass.setPipeline(this.solidPipeline);
    mainPass.setBindGroup(0, this.sceneBindGroup);
    mainPass.setVertexBuffer(0, this.vertexBuffer);
    mainPass.setVertexBuffer(1, this.matrixBuffer);
    mainPass.setVertexBuffer(2, this.colorBuffer);
    mainPass.draw(CUBE_VERTEX_COUNT, safeCount);

    if (lineData.length > 0) {
      mainPass.setPipeline(this.linePipeline);
      mainPass.setBindGroup(0, this.sceneBindGroup);
      mainPass.setVertexBuffer(0, this.lineBuffer);
      mainPass.draw(lineData.length / 7, 1);
    }
    mainPass.end();

    const postPass = encoder.beginRenderPass({
      label: 'AAA tone mapping and bloom pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    postPass.setPipeline(this.postPipeline);
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3, 1);
    postPass.end();

    this.device.queue.submit([encoder.finish()]);
    return performance.now() - start;
  }

  uploadedMegabytes(): number {
    return this.lastUploadedBytes / (1024 * 1024);
  }

  viewport(): readonly [number, number] {
    return [this.width, this.height];
  }
}
