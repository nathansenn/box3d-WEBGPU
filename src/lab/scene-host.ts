/**
 * How the Physics Lab loads a scene file: the scene format's own builder
 * (src/engine/scene-format.ts, published by the kit as box3d-webgpu-kit/scene)
 * driving a NativeWorldBackend through the `SceneHost` contract.
 *
 * The kit's PhysicsWorld is the other SceneHost. Both forward the same calls
 * with the same values to the same native world, so a scene loaded here has
 * the same exactHash and replay hash, step for step, as the kit's loadScene
 * (tests/physics/lab-scenes.test.mjs checks this for every example scene).
 */
import type {
  NativeBodyDescriptor, NativeBodyHandle, NativeBodyState, NativeJointDescriptor, NativeJointHandle, NativeWorldBackend,
} from '../engine/native-world.ts';
import { loadScene, normalizeScene, sceneWorldOptions, type LoadedScene, type Scene, type SceneHost, type SceneVec3 } from '../engine/scene-format.ts';

export class LabSceneHost implements SceneHost {
  readonly native: NativeWorldBackend;
  readonly loop: { readonly step: number };
  readonly subSteps: number;
  readonly seed: number;
  /** Fixed steps taken since the scene was loaded. */
  tick = 0;

  constructor(native: NativeWorldBackend, settings: { readonly step: number; readonly subSteps: number; readonly seed: number }) {
    this.native = native;
    this.loop = { step: settings.step };
    this.subSteps = settings.subSteps;
    this.seed = settings.seed >>> 0;
  }

  reset(options: { readonly ground?: boolean; readonly gravity?: SceneVec3; readonly seed?: number }): void {
    const g = options.gravity;
    this.native.resetWorld({ seed: (options.seed ?? this.seed) >>> 0, ground: options.ground, gravity: g ? [g[0], g[1], g[2]] : undefined });
    this.tick = 0;
  }
  createBody(options: NativeBodyDescriptor): NativeBodyHandle | null { return this.native.createBody(options); }
  createJoint(options: NativeJointDescriptor): NativeJointHandle { return this.native.createJoint(options); }
  isAlive(body: NativeBodyHandle): boolean { return this.native.bodyIndex(body) !== null; }
  destroyBody(body: NativeBodyHandle): boolean {
    if (this.native.bodyIndex(body) === null) return false;
    return this.native.destroyBody(body);
  }
  isJointAlive(joint: NativeJointHandle): boolean { return this.native.jointAlive(joint); }
  destroyJoint(joint: NativeJointHandle): boolean { return this.native.destroyJoint(joint); }
  getState(body: NativeBodyHandle): NativeBodyState { return this.native.bodyState(body); }
  getMassData(body: NativeBodyHandle): { readonly center: readonly number[] } | null { return this.native.supportsCompoundBodies ? this.native.bodyMassData(body) : null; }
  gravity(): [number, number, number] { return this.native.gravity(); }
  bodyCount(): number { return this.native.bodyCount(); }

  /** Advance by exactly one of the scene's fixed steps. */
  step(): void { this.native.step(this.loop.step, this.subSteps); this.tick++; }
  /** FNV-1a over the exact float32 bits of every transform: the kit's PhysicsWorld.exactHash(). */
  exactHash(): number { return exactTransformHash(this.native); }
  replayHash(): number { return this.native.replayHash(); }
}

/** FNV-1a over the exact float32 bits of every row matrix of a native world. */
export function exactTransformHash(native: NativeWorldBackend): number {
  const start = Number(native._b3w_matrices_ptr()) / 4;
  const m = native.HEAPF32.subarray(start, start + native.bodyCount() * 16);
  const bits = new Uint32Array(m.buffer, m.byteOffset, m.length);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i]!;
    hash = Math.imul(hash ^ (v & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((v >>> 8) & 0xff), 0x01000193);
    hash = Math.imul(hash ^ ((v >>> 16) & 0xff), 0x01000193);
    hash = Math.imul(hash ^ (v >>> 24), 0x01000193);
  }
  return hash >>> 0;
}

/** The Lab's own tick: its frame loop advances the simulation in steps of this many seconds. */
export const LAB_TICK_SECONDS = 1 / 60;

/**
 * Fixed steps of a scene the Lab takes in one of its 1/60 s ticks, so the scene
 * plays at real speed: 1 for a 1/60 s scene, 4 for a 1/240 s one. A step that
 * does not divide 1/60 s is rounded to the nearest count (a 1/100 s scene takes
 * 2 steps a tick and so plays 1.2 times too fast); the steps themselves are
 * always exactly the scene's.
 */
export function sceneStepsPerLabTick(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError('A scene step must be a positive number of seconds.');
  return Math.max(1, Math.round(LAB_TICK_SECONDS / step));
}

export type LabLoadedScene = LoadedScene<LabSceneHost>;

/**
 * Validate a scene and build it in `native`, which is reset first. An invalid
 * scene throws SceneValidationError before the world is touched. If the engine
 * refuses a body or joint, the world is left reset and empty and the error
 * names the id.
 */
export function loadLabScene(native: NativeWorldBackend, scene: unknown): LabLoadedScene {
  const normal: Scene = normalizeScene(scene);
  return loadScene(new LabSceneHost(native, sceneWorldOptions(normal)), normal);
}
