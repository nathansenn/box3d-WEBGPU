import type { ScenePreset } from '../scenes';
import type { PhysicsBackend } from '../types';
import { FallbackPhysicsBackend } from './fallback';

type EmscriptenModuleBase = {
  HEAPF32: Float32Array;
  _b3w_create_demo?: (columns: number, rows: number, layers: number) => number;
  _b3w_create_scene?: (sceneId: number, stressScale: number, seed: number) => number;
  _b3w_destroy?: () => void;
  _b3w_step?: (dt: number, subSteps: number) => void;
  _b3w_sync_transforms?: () => void;
  _b3w_kick_stack?: (strength: number) => void;
  _b3w_explode?: (x: number, y: number, z: number, strength: number, radius: number) => void;
  _b3w_launch_projectile?: (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) => number;
  _b3w_spawn_rain?: (count: number, spread: number, height: number) => number;
  _b3w_apply_impulse?: (index: number, ix: number, iy: number, iz: number) => void;
  _b3w_body_count?: () => number;
  _b3w_dynamic_count?: () => number;
  _b3w_matrices_ptr?: () => number | bigint;
  _b3w_colors_ptr?: () => number | bigint;
  _b3w_max_bodies?: () => number;
  _b3w_replay_hash?: () => number;
};

type EmscriptenFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<EmscriptenModuleBase>;

class WasmPhysicsBackend implements PhysicsBackend {
  readonly name = 'Box3D WASM';
  readonly isWasm = true;
  readonly maxBodies: number;

  constructor(private readonly mod: EmscriptenModuleBase) {
    if (!mod._b3w_body_count || !mod._b3w_matrices_ptr || !mod._b3w_colors_ptr || !mod._b3w_max_bodies || !mod._b3w_step) {
      throw new Error('Box3D WASM module is missing required b3w_* exports. Rebuild with npm run build:wasm.');
    }
    this.maxBodies = mod._b3w_max_bodies();
  }


  // Emscripten replaces heap views when ALLOW_MEMORY_GROWTH expands memory.
  // A getter prevents the renderer from retaining a detached/stale Float32Array.
  get HEAPF32(): Float32Array { return this.mod.HEAPF32; }

  _b3w_matrices_ptr(): number | bigint { return this.mod._b3w_matrices_ptr?.() ?? 0; }
  _b3w_colors_ptr(): number | bigint { return this.mod._b3w_colors_ptr?.() ?? 0; }
  _b3w_body_count(): number { return this.bodyCount(); }
  _b3w_max_bodies(): number { return this.maxBodies; }

  createScene(scene: ScenePreset, stressScale: number, seed: number): number {
    if (this.mod._b3w_create_scene) {
      return this.mod._b3w_create_scene(scene.id, stressScale, seed >>> 0);
    }
    const fallbackDims = scene.family === 'rain'
      ? [18, 26, 5]
      : scene.family === 'stack'
        ? [12, 18, 2]
        : [10 + stressScale * 2, 12 + stressScale * 3, Math.max(1, Math.floor(stressScale / 2))];
    return this.mod._b3w_create_demo?.(fallbackDims[0], fallbackDims[1], fallbackDims[2]) ?? 0;
  }

  step(dt: number, subSteps: number): void { this.mod._b3w_step?.(dt, subSteps); }
  syncTransforms(): void { this.mod._b3w_sync_transforms?.(); }
  kick(strength: number): void { this.mod._b3w_kick_stack?.(strength); }
  explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void { this.mod._b3w_explode?.(centerX, centerY, centerZ, strength, radius); }
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number { return this.mod._b3w_launch_projectile?.(x, y, z, vx, vy, vz, size) ?? -1; }
  spawnRain(count: number, spread: number, height: number): number { return this.mod._b3w_spawn_rain?.(count, spread, height) ?? 0; }
  bodyCount(): number { return this.mod._b3w_body_count?.() ?? 0; }
  dynamicCount(): number { return this.mod._b3w_dynamic_count?.() ?? Math.max(0, this.bodyCount() - 1); }
  replayHash(): number { return this.mod._b3w_replay_hash?.() ?? 0; }
  destroy(): void { this.mod._b3w_destroy?.(); }
}

function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

export async function loadWasmPhysicsBackend(): Promise<PhysicsBackend> {
  const wasmModulePath = publicAsset('box3d/box3d.js');
  const imported = (await import(/* @vite-ignore */ wasmModulePath)) as { default?: EmscriptenFactory } | EmscriptenFactory;
  const factory = typeof imported === 'function' ? imported : imported.default;
  if (!factory) throw new Error('box3d.js did not expose an Emscripten factory.');
  const mod = await factory({ locateFile: (path: string) => publicAsset(`box3d/${path}`) });
  return new WasmPhysicsBackend(mod);
}

export async function loadBestPhysicsBackend(): Promise<{ backend: PhysicsBackend; warning?: string }> {
  try {
    return { backend: await loadWasmPhysicsBackend() };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    return { backend: new FallbackPhysicsBackend(), warning };
  }
}
