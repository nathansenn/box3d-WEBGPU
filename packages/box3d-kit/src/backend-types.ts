/**
 * Minimal backend contract shared with the Box3D WebGPU app (src/types.ts).
 * Kept structurally identical so worlds created by this package can be handed
 * to the app's renderer, but without the app's demo-scene catalog.
 */
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

/** Only the numeric preset ID reaches the native bridge (0..799). */
export type ScenePreset = { readonly id: number };

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
