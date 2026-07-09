import type { Mat4 } from './math';
import type { ScenePreset } from './scenes';

export type InstanceBufferSource = {
  readonly HEAPF32: Float32Array;
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
  target: [number, number, number];
};

export type FrameMetrics = {
  fps: number;
  simMs: number;
  uploadMb: number;
  steps: number;
  hash: number;
};

export type RendererOptions = {
  viewProjection: Mat4;
  debugLines: readonly DebugLine[];
  instanceCount: number;
};
