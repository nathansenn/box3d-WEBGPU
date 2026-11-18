import type { ScenePreset } from '../scenes';
import type { PhysicsBackend, PhysicsThreading } from '../types';
import { FallbackPhysicsBackend } from './fallback';
import { planThreading } from './threading';
import { NativeWorldPool } from '../engine/native-world.ts';
import { MAX_WASM_STEP_DT, clampWasmSubSteps, finiteBounded } from './step-bounds.ts';

type EmscriptenModuleBase = {
  HEAPF32: Float32Array;
  // Present only in the pthread artifact box3d-mt.{js,wasm}; see docs/THREADED_ENGINE.md.
  wasmMemory?: { readonly buffer: ArrayBufferLike };
  _b3w_threads_supported?: () => number;
  _b3w_worker_capacity?: () => number;
  _b3w_set_worker_count?: (workers: number) => number;
  _b3w_last_step_workers?: () => number;
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
  _b3w_transform_version?: () => number;
  _b3w_color_version?: () => number;
  _b3w_awake_count?: () => number;
  _b3w_replay_hash?: () => number;
};

type EmscriptenFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
  /** Workers the pthread artifact preloads (its calling thread is not counted). */
  b3wPoolSize?: number;
}) => Promise<EmscriptenModuleBase>;

class WasmPhysicsBackend implements PhysicsBackend {
  readonly name = 'Box3D WASM';
  readonly isWasm = true;
  readonly maxBodies: number;
  private transformFrameVersion = 0;
  private colorFrameVersion = 0;
  private readonly matricesPtr: number | bigint;
  private readonly colorsPtr: number | bigint;

  constructor(
    private readonly mod: EmscriptenModuleBase,
    readonly threading: PhysicsThreading = { mode: 'single', workers: 1 },
  ) {
    if (!mod._b3w_body_count || !mod._b3w_matrices_ptr || !mod._b3w_colors_ptr || !mod._b3w_max_bodies || !mod._b3w_step) {
      throw new Error('Box3D WASM module is missing required b3w_* exports. Rebuild with npm run build:wasm.');
    }
    this.maxBodies = mod._b3w_max_bodies();
    // These bridge arrays are static globals. Memory growth replaces HEAPF32
    // but never relocates their byte offsets, so cache the two WASM calls and
    // let the HEAPF32 getter continue refreshing the backing view.
    this.matricesPtr = mod._b3w_matrices_ptr();
    this.colorsPtr = mod._b3w_colors_ptr();
  }


  // Emscripten replaces heap views when ALLOW_MEMORY_GROWTH expands memory.
  // A getter prevents the renderer from retaining a detached/stale Float32Array.
  get HEAPF32(): Float32Array { return this.mod.HEAPF32; }

  _b3w_matrices_ptr(): number | bigint { return this.matricesPtr; }
  _b3w_colors_ptr(): number | bigint { return this.colorsPtr; }
  _b3w_body_count(): number { return this.bodyCount(); }
  _b3w_max_bodies(): number { return this.maxBodies; }
  frameVersion(): number { return (this.mod._b3w_transform_version?.() ?? this.transformFrameVersion) >>> 0; }
  colorVersion(): number { return (this.mod._b3w_color_version?.() ?? this.colorFrameVersion) >>> 0; }
  awakeCount(): number { return this.mod._b3w_awake_count?.() ?? 0; }
  lastStepWorkers(): number { return this.mod._b3w_last_step_workers?.() ?? 1; }

  private markTransformsChanged(): void {
    this.transformFrameVersion = (this.transformFrameVersion + 1) >>> 0;
  }

  private markColorsChanged(): void {
    this.colorFrameVersion = (this.colorFrameVersion + 1) >>> 0;
  }

  private markStreamsChanged(): void {
    this.markTransformsChanged();
    this.markColorsChanged();
  }

  createScene(scene: ScenePreset, stressScale: number, seed: number): number {
    if (this.mod._b3w_create_scene) {
      const count = this.mod._b3w_create_scene(scene.id, stressScale, seed >>> 0);
      this.markStreamsChanged();
      return count;
    }
    const fallbackDims = scene.family === 'rain'
      ? [18, 26, 5]
      : scene.family === 'stack'
        ? [12, 18, 2]
        : [10 + stressScale * 2, 12 + stressScale * 3, Math.max(1, Math.floor(stressScale / 2))];
    const count = this.mod._b3w_create_demo?.(fallbackDims[0], fallbackDims[1], fallbackDims[2]) ?? 0;
    this.markStreamsChanged();
    return count;
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.mod._b3w_step?.(Math.min(dt, MAX_WASM_STEP_DT), clampWasmSubSteps(subSteps));
    this.markTransformsChanged();
  }
  syncTransforms(): void {
    this.mod._b3w_sync_transforms?.();
    this.markTransformsChanged();
  }
  kick(strength: number): void { if (!finiteBounded(strength)) return; this.mod._b3w_kick_stack?.(strength); }
  explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void { if (!finiteBounded(centerX, centerY, centerZ, strength, radius)) return; this.mod._b3w_explode?.(centerX, centerY, centerZ, strength, radius); }
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number {
    if (!finiteBounded(x, y, z, vx, vy, vz, size)) return -1;
    const index = this.mod._b3w_launch_projectile?.(x, y, z, vx, vy, vz, size) ?? -1;
    if (index >= 0) this.markStreamsChanged();
    return index;
  }
  spawnRain(count: number, spread: number, height: number): number {
    const added = this.mod._b3w_spawn_rain?.(count, spread, height) ?? 0;
    if (added > 0) this.markStreamsChanged();
    return added;
  }
  bodyCount(): number { return this.mod._b3w_body_count?.() ?? 0; }
  dynamicCount(): number { return this.mod._b3w_dynamic_count?.() ?? Math.max(0, this.bodyCount() - 1); }
  replayHash(): number { return this.mod._b3w_replay_hash?.() ?? 0; }
  destroy(): void {
    this.mod._b3w_destroy?.();
    this.markStreamsChanged();
  }
}

function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const relative = `${normalizedBase}${path.replace(/^\//, '')}`;
  // A string-valued dynamic import resolves relative to the bundled module.
  // Pages builds use BASE_URL="./", so resolve against the document to avoid
  // accidentally requesting /assets/box3d/box3d.js.
  return typeof document === 'undefined' ? relative : new URL(relative, document.baseURI).href;
}

async function loadWasmModule(artifact = 'box3d', poolSize?: number): Promise<EmscriptenModuleBase> {
  const wasmModulePath = publicAsset(`box3d/${artifact}.js`);
  const imported = (await import(/* @vite-ignore */ wasmModulePath)) as { default?: EmscriptenFactory } | EmscriptenFactory;
  const factory = typeof imported === 'function' ? imported : imported.default;
  if (!factory) throw new Error(`${artifact}.js did not expose an Emscripten factory.`);
  return factory({
    locateFile: (path: string) => publicAsset(`box3d/${path}`),
    ...(poolSize === undefined ? {} : { b3wPoolSize: poolSize }),
  });
}

// A worker of the pthread artifact can grow the shared memory, and the main thread's HEAP views do not follow.
// Reading the live buffer keeps HEAPF32 current; the renderer notices a replaced buffer through its identity.
function withLiveHeap(mod: EmscriptenModuleBase): EmscriptenModuleBase {
  const memory = mod.wasmMemory;
  if (!memory) throw new Error('box3d-mt.js does not export wasmMemory.');
  let buffer: ArrayBufferLike | undefined;
  let view: Float32Array | undefined;
  return Object.create(mod, {
    HEAPF32: {
      get(): Float32Array {
        if (memory.buffer !== buffer || !view) {
          buffer = memory.buffer;
          view = new Float32Array(buffer);
        }
        return view;
      },
    },
  }) as EmscriptenModuleBase;
}

// Workers that cannot start would leave the factory pending for ever; fall back to one thread instead.
const THREADED_START_TIMEOUT_MS = 15000;

async function loadThreadedModule(workers: number): Promise<EmscriptenModuleBase> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`workers did not start within ${THREADED_START_TIMEOUT_MS} ms`)), THREADED_START_TIMEOUT_MS);
  });
  try {
    const mod = await Promise.race([loadWasmModule('box3d-mt', workers - 1), timeout]);
    if (mod._b3w_threads_supported?.() !== 1 || !mod._b3w_set_worker_count) throw new Error('box3d-mt.js is not the pthread artifact');
    const accepted = mod._b3w_set_worker_count(workers);
    if (accepted !== workers) throw new Error(`the worker pool accepted ${accepted} of ${workers} workers`);
    return withLiveHeap(mod);
  } finally {
    clearTimeout(timer);
  }
}

/** The pthread artifact when the page may use it, the single-threaded artifact otherwise. Results are identical. */
async function loadPhysicsModule(): Promise<{ mod: EmscriptenModuleBase; threading: PhysicsThreading }> {
  const plan = planThreading({
    search: typeof location === 'undefined' ? '' : location.search,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency,
  });
  if (!plan.use) return { mod: await loadWasmModule(), threading: { mode: 'single', workers: 1, reason: plan.reason } };
  try {
    return { mod: await loadThreadedModule(plan.workers), threading: { mode: 'threads', workers: plan.workers } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { mod: await loadWasmModule(), threading: { mode: 'single', workers: 1, reason: `the pthread artifact did not start: ${detail}` } };
  }
}

export async function loadWasmPhysicsBackend(): Promise<PhysicsBackend> {
  const { mod, threading } = await loadPhysicsModule();
  return new WasmPhysicsBackend(mod, threading);
}

/** Load one module for multiple independent native worlds. Requires world ABI v1. */
export async function loadNativeWorldPool(): Promise<NativeWorldPool> {
  return new NativeWorldPool(await loadWasmModule());
}

export async function loadBestPhysicsBackend(): Promise<{ backend: PhysicsBackend; warning?: string }> {
  try {
    return { backend: await loadWasmPhysicsBackend() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const warning = /(?:failed to fetch|dynamically imported module|cannot find module)/i.test(detail)
      ? 'Native Box3D WASM artifact is not built; deterministic preview rigid-body backend loaded.'
      : detail;
    return { backend: new FallbackPhysicsBackend(), warning };
  }
}
