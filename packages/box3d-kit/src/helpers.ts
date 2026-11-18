/**
 * Gameplay helpers built on PhysicsWorld: batched spawns and impulses, a
 * recycling ring for projectiles and debris, runtime capability detection,
 * and the license notice apps should ship.
 */
import type {Body, PhysicsWorld, Vec3Like} from './world.js';
import {BUILD_INFO, type BuildInfo} from './core/build-info.js';
import {NATIVE_WORLD_API_VERSION} from './core/native-world.js';

/**
 * Spawn one cube per xyz triple in `positions`. Returns the handles (null
 * where capacity ran out). Validation and the WASM boundary are still crossed
 * per body; a native batched export is ENGINE item #46's remaining work.
 */
export function spawnBoxes(world: PhysicsWorld, positions: ArrayLike<number>, options: {halfSize?: number; impulses?: ArrayLike<number>} = {}): (Body | null)[] {
  if (positions.length % 3 !== 0) throw new RangeError('positions must hold xyz triples.');
  const out: (Body | null)[] = [], imp = options.impulses;
  for (let i = 0; i < positions.length; i += 3) {
    out.push(world.spawnBox({
      position: [positions[i], positions[i + 1], positions[i + 2]],
      halfSize: options.halfSize,
      impulse: imp ? [imp[i], imp[i + 1], imp[i + 2]] : undefined,
    }));
  }
  return out;
}

/** Apply impulses[i*3..i*3+2] to bodies[i]. Destroyed bodies are skipped; returns how many were applied. */
export function applyImpulses(world: PhysicsWorld, bodies: readonly (Body | null)[], impulses: ArrayLike<number>): number {
  if (impulses.length !== bodies.length * 3) throw new RangeError('impulses must hold one xyz triple per body.');
  let applied = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (!body || !world.isAlive(body)) continue;
    world.applyImpulse(body, [impulses[i * 3], impulses[i * 3 + 1], impulses[i * 3 + 2]]);
    applied++;
  }
  return applied;
}

/**
 * Keeps at most `limit` bodies alive: spawning past the limit destroys the
 * oldest one it spawned. Use it for projectiles, shell casings or debris so a
 * long session never exhausts body capacity.
 */
export class BodyRing {
  private readonly bodies: Body[] = [];
  constructor(private readonly world: PhysicsWorld, readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer.');
  }
  spawn(options: {position: Vec3Like; halfSize?: number; impulse?: Vec3Like}): Body | null {
    // Forget bodies the game already destroyed elsewhere.
    for (let i = this.bodies.length - 1; i >= 0; i--) if (!this.world.isAlive(this.bodies[i])) this.bodies.splice(i, 1);
    while (this.bodies.length >= this.limit) this.world.destroyBody(this.bodies.shift()!);
    const body = this.world.spawnBox(options);
    if (body) this.bodies.push(body);
    return body;
  }
  get size(): number { return this.bodies.length; }
  /** Destroy every body this ring spawned. */
  clear(): void { for (const body of this.bodies.splice(0)) this.world.destroyBody(body); }
}

export interface EnvironmentReport {
  readonly runtime: 'browser' | 'worker' | 'node' | 'other';
  readonly webAssembly: boolean;
  /** Fixed-width WASM SIMD; the shipped box3d.wasm is built with it. */
  readonly wasmSimd: boolean;
  readonly webgpu: boolean;
  readonly sharedArrayBuffer: boolean;
  /** COOP/COEP isolation, required by future threaded or shared-memory variants. */
  readonly crossOriginIsolated: boolean;
  readonly workers: boolean;
}

// (module (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt))
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** What this runtime supports. Call before loading to choose a path or explain a failure to the player. */
export function detectEnvironment(): EnvironmentReport {
  const g = globalThis as Record<string, any>;
  const runtime = g.process?.versions?.node ? 'node' : typeof g.window === 'object' && typeof g.document === 'object' ? 'browser' : typeof g.WorkerGlobalScope === 'function' ? 'worker' : 'other';
  const webAssembly = typeof g.WebAssembly === 'object';
  return {
    runtime,
    webAssembly,
    wasmSimd: webAssembly && WebAssembly.validate(SIMD_PROBE),
    webgpu: !!g.navigator?.gpu,
    sharedArrayBuffer: typeof g.SharedArrayBuffer === 'function',
    crossOriginIsolated: g.crossOriginIsolated === true,
    workers: typeof g.Worker === 'function' || runtime === 'node',
  };
}

/** Attribution text to include in your app's credits or third-party notices. */
export const LICENSE_NOTICE = `Physics: Box3D by Erin Catto (https://github.com/erincatto/box3d), MIT License, Copyright (c) 2026 Erin Catto.
Integration: box3d-webgpu-kit, MIT License.`;

export interface Capabilities {
  readonly build: BuildInfo;
  readonly nativeApiVersion: number;
  readonly environment: EnvironmentReport;
  /** Subpath modules shipped in this package. */
  readonly modules: readonly string[];
  readonly limits: {
    readonly worldsPerModule: number;
    readonly bodiesPerWorld: {readonly default: number; readonly max: number};
    /** Shapes the native bridge can create today. */
    readonly shapes: readonly string[];
    readonly joints: boolean;
    readonly contactEvents: boolean;
    readonly setPoseOrVelocity: boolean;
    readonly gravityControl: boolean;
    readonly threads: number;
    /** Most bodies one overlap or cast query reports (trigger volumes flag overflow beyond it). */
    readonly queryHitsMax: number;
  };
}

/**
 * One report of what this build and runtime can do, for feature gating, bug
 * reports and support pages. Limits describe the native bridge shipped with
 * this version; they grow when the WASM is rebuilt with more exports.
 */
export function capabilities(): Capabilities {
  return {
    build: BUILD_INFO,
    nativeApiVersion: NATIVE_WORLD_API_VERSION,
    environment: detectEnvironment(),
    modules: ['rigid', 'three', 'babylon', 'worker', 'cable', 'water', 'frame', 'webgpu-writer', 'snapshots', 'single-file', 'gameplay'],
    limits: {
      worldsPerModule: 16,
      bodiesPerWorld: {default: 4096, max: 65536},
      shapes: ['box'],
      joints: false,
      contactEvents: false,
      setPoseOrVelocity: false,
      gravityControl: false,
      threads: 1,
      queryHitsMax: 256,
    },
  };
}
