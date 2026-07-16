import type { Mat4, Vec3 } from './math';
import type { ScenePreset } from './scenes';

export type InstanceBufferSource = {
  readonly HEAPF32: Float32Array;
  /** Monotonically increasing version of the transform stream. */
  frameVersion(): number;
  /** Monotonically increasing version of the material/color stream. */
  colorVersion(): number;
  _b3w_matrices_ptr(): number | bigint;
  _b3w_colors_ptr(): number | bigint;
  _b3w_body_count(): number;
  _b3w_max_bodies(): number;
};

export type PhysicsBackend = InstanceBufferSource & {
  readonly name: string;
  readonly isWasm: boolean;
  readonly maxBodies: number;
  createScene(scene: ScenePreset, stressScale: number, seed: number): number;
  step(dt: number, subSteps: number): void;
  syncTransforms(): void;
  kick(strength: number): void;
  explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void;
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number;
  spawnRain(count: number, spread: number, height: number): number;
  bodyCount(): number;
  dynamicCount(): number;
  replayHash(): number;
  destroy(): void;
};


/** CPU fallback: position3/f32, normal2/snorm16, color4/unorm8, uv2/unorm16. */
export type PackedSurfaceFrame = {
  path: 'packed';
  /** Water is always represented by GpuWaterSurfaceFrame. The packed path is
   * retained exclusively for topology-changing (tearing) cloth. */
  material: 'cloth';
  vertices: Uint8Array;
  indices: Uint16Array;
  vertexStride: number;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
};

/** Intact cloth stays in solver-native arrays; WebGPU reconstructs its render surface. */
export type GpuClothSurfaceFrame = {
  path: 'gpu-cloth';
  material: 'cloth';
  positions: Float32Array;
  /** Immutable rest-pose positions. WebGPU can derive visual strain from the
   * current/rest distance field instead of requiring a per-frame CPU stream. */
  restPositions: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
  cols: number;
  rows: number;
  baseColorA: readonly [number, number, number, number];
  baseColorB: readonly [number, number, number, number];
};

/** GPU-resident rope/cable render stream. Dynamic node positions are paired
 * with compact segment metadata; a renderer can expand this into shared
 * instance matrices and materials without rebuilding every segment on CPU. */
export type RopeGridFrame = {
  positions: Float32Array;
  /** Eight float32 words per active render segment:
   * [nodeA, nodeB, inverseRestLength, radius, colorR, colorG, colorB, colorA]. */
  segments: Float32Array;
  nodeCount: number;
  segmentCount: number;
  topologyVersion: number;
  frameVersion: number;
};

/** Shallow-water state stays as eta/u/v fields; WebGPU reconstructs geometry and foam. */
export type GpuWaterSurfaceFrame = {
  path: 'gpu-water';
  material: 'water';
  eta: Float32Array;
  u: Float32Array;
  v: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  baseY: number;
};

export type DynamicSurfaceFrame = PackedSurfaceFrame | GpuClothSurfaceFrame | GpuWaterSurfaceFrame;

export type DebugLine = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

export type CameraRig = {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
};

export type FrameMetrics = {
  fps: number;
  simMs: number;
  renderSubmitMs: number;
  uploadMb: number;
  steps: number;
  hash: number;
};

export type RenderQualityId = 'performance' | 'balanced' | 'cinematic' | 'ultra';

export type RenderQuality = {
  id: RenderQualityId;
  label: string;
  exposure: number;
  bloomStrength: number;
  fogDensity: number;
  shadowStrength: number;
  effectBudget: number;
  resolutionScale: number;
  /** WebGPU core guarantees 1x; this renderer also validates the optional 4x path. */
  sampleCount: 1 | 4;
  shadowMapSize: 1024 | 2048;
  shadowTapCount: 1 | 9;
};

export type SceneUniformState = {
  viewProjection: Mat4;
  lightViewProjection: Mat4;
  cameraPosition: Vec3;
  timeSeconds: number;
  lightDirection: Vec3;
  quality: RenderQuality;
  fogColor: Vec3;
};

export type EffectFrame = {
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
  frameVersion: number;
  debugLines: readonly DebugLine[];
};

export type RendererFrameResult = {
  uploadedBytes: number;
  renderSubmitMs: number;
};
