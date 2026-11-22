/**
 * Scene sections with `"backend": "gpu"` in the Physics Lab (docs/GPU_COMPUTE.md, "Scene sections in the Lab").
 *
 * The Lab acquires a WebGPU compute device of its own (not the renderer's: a lost compute device then leaves the
 * drawing alone) and builds the GPU sections with `gpuSceneBackends(compute)`. The scene steps with `stepAsync()`
 * through a `GpuSceneRunner`, which keeps a checkpoint every `snapshotEvery` steps and, when the device is lost, carries
 * on with the float32 CPU reference from the last checkpoint (the same program: the same bits where the two agree).
 * After every step the GPU state is pulled into the float64 objects the Lab draws from.
 *
 *   lab.html?example=sphere-settling-gpu      automatic: WebGPU compute when there is a device, the CPU otherwise
 *   lab.html?example=sphere-settling-gpu&gpu=reference   the float32 CPU reference (the GPU's program on the CPU)
 *   lab.html?example=sphere-settling-gpu&gpu=off         the float64 CPU solvers: the backend fields are dropped
 *
 * Without WebGPU compute (no navigator.gpu, no adapter, too small a device) the scene runs on the float64 CPU solvers,
 * and the indicator says why.
 */
import { EngineError } from '../engine/contracts.ts';
import { acquireGpuCompute, type GpuCompute } from '../engine/gpu/compute.ts';
import { gpuSceneBackends, GpuSceneRunner, type GpuSceneFallback } from '../engine/gpu/scene-backends.ts';
import type { Scene } from '../engine/scene-format.ts';
import type { SceneSimulationOptions } from '../engine/simulation.ts';
import type { NativeBodyHandle } from '../engine/native-world.ts';
import type { LabLoadedScene, LabSceneHost } from './scene-host.ts';

type LabSimulation = LabLoadedScene['simulation'];

export type LabGpuRequest = 'auto' | 'off' | 'reference';
/** What `?gpu=` asks for: 'off' (or 'cpu', '0') runs GPU sections on the float64 CPU solvers, 'reference' on the float32 CPU reference. */
export function labGpuRequest(search: string): LabGpuRequest {
  let value: string | null = null;
  try { value = new URLSearchParams(search).get('gpu'); } catch { return 'auto'; }
  if (value === 'off' || value === 'cpu' || value === '0') return 'off';
  if (value === 'reference') return 'reference';
  return 'auto';
}

type Sectioned = { readonly grains?: readonly { readonly backend?: string }[]; readonly shallowWater?: readonly { readonly backend?: string }[]; readonly fluids?: readonly { readonly backend?: string }[] };
/** True when a section of the scene says backend: 'gpu'. */
export function sceneHasGpuSections(scene: Scene): boolean {
  const s = scene as Sectioned;
  return [s.grains, s.shallowWater, s.fluids].some(list => (list ?? []).some(section => section.backend === 'gpu'));
}
/** The scene with every backend field dropped: its sections on the float64 CPU solvers. */
export function withoutGpuSections(scene: Scene): Scene {
  const drop = <T extends { readonly backend?: string }>(list: readonly T[] | undefined): T[] | undefined => list?.map(({ backend: _backend, ...rest }) => rest as T);
  const s = scene as Scene & Sectioned;
  return { ...s, ...(s.grains ? { grains: drop(s.grains) } : {}), ...(s.shallowWater ? { shallowWater: drop(s.shallowWater) } : {}), ...(s.fluids ? { fluids: drop(s.fluids) } : {}) } as Scene;
}

/**
 * Loader options for a scratch build that only checks a scene (it never steps): GPU sections are built on the float32
 * reference, which builds nothing until a step. Without them a scene with GPU sections would be refused.
 */
export function gpuCheckOptions(scene: Scene): SceneSimulationOptions {
  return sceneHasGpuSections(scene) ? { gpu: gpuSceneBackends('reference') } : {};
}

/** How the Lab runs the GPU sections of the scene it loads. */
export interface LabGpuPlan {
  /** 'gpu': WebGPU compute; 'reference': the float32 CPU reference; 'cpu': the float64 solvers (the backend fields dropped). */
  readonly mode: 'gpu' | 'reference' | 'cpu';
  readonly scene: Scene;
  readonly options: SceneSimulationOptions;
  /** Why the scene does not run on the GPU, when it does not. */
  readonly reason: string | null;
}
export interface LabGpuSceneState {
  readonly mode: 'gpu' | 'reference' | 'cpu';
  readonly adapter: string | null; readonly software: boolean;
  readonly reason: string | null;
  readonly steps: number; readonly checkpointTick: number;
  /** Fixed steps the Lab's clock asked for while a step was still on its way (they are not taken: the GPU sets the pace). */
  readonly skipped: number;
  readonly msPerStep: number;
  readonly fallback: GpuSceneFallback | null;
  readonly failed: string | null;
}

export class LabGpu {
  readonly request: LabGpuRequest;
  compute: GpuCompute | null = null;
  reason: string | null = null;
  private pending: Promise<void> | null = null;
  constructor(request: LabGpuRequest) { this.request = request; }
  /** Acquire the compute device once (no-op for 'off' and 'reference'). */
  prepare(): Promise<void> {
    if (this.request !== 'auto') return Promise.resolve();
    return this.pending ??= (async () => {
      try { this.compute = await acquireGpuCompute(); }
      catch (error) { this.reason = error instanceof Error ? error.message : String(error); }
    })();
  }
  get adapter(): string | null {
    const info = this.compute?.info;
    return info ? (`${info.vendor} ${info.architecture} ${info.device}`.replace(/\s+/g, ' ').trim() || 'unknown adapter') : null;
  }
  /** How to load `scene` (one with GPU sections). */
  plan(scene: Scene): LabGpuPlan {
    if (this.request === 'off') return { mode: 'cpu', scene: withoutGpuSections(scene), options: {}, reason: 'The address asks for the CPU (?gpu=off).' };
    if (this.request === 'reference') return { mode: 'reference', scene, options: { gpu: gpuSceneBackends('reference') }, reason: 'The address asks for the float32 CPU reference (?gpu=reference).' };
    if (this.compute && !this.compute.lost) return { mode: 'gpu', scene, options: { gpu: gpuSceneBackends(this.compute) }, reason: null };
    const why = this.compute?.lost ? `The WebGPU compute device was lost (${this.compute.lossReason ?? 'no reason given'}); reload the page to use it again.`
      : this.reason ?? (this.pending ? 'WebGPU compute is still starting.' : 'WebGPU compute was not requested.');
    return { mode: 'cpu', scene: withoutGpuSections(scene), options: {}, reason: why };
  }
}

/** Steps a loaded scene with GPU sections for the Lab: one step at a time, the GPU state pulled after each. */
export class LabGpuStepper {
  readonly runner: GpuSceneRunner<LabSceneHost, NativeBodyHandle>;
  readonly mode: 'gpu' | 'reference';
  private readonly lab: LabGpu;
  private readonly simulation: LabSimulation;
  private inFlight: Promise<void> | null = null;
  private steps = 0; private skipped = 0; private ms = 0; private timed = 0;
  private failure: string | null = null;
  /** Called after each step that was taken and pulled (the Lab redraws from the mirrors then). */
  onStep: (() => void) | null = null;
  constructor(simulation: LabSimulation, lab: LabGpu, mode: 'gpu' | 'reference', options: { readonly snapshotEvery?: number } = {}) {
    this.simulation = simulation; this.lab = lab; this.mode = mode;
    this.runner = new GpuSceneRunner(simulation, options);
  }
  /** A step for the Lab's clock: started when none is on its way, skipped otherwise. */
  tick(): void {
    if (this.failure !== null) return;
    if (this.inFlight) { this.skipped++; return; }
    void this.track(this.run(1)).catch(() => undefined);
  }
  /** Take `count` steps now, one after the other (for tests and captures), after any step on its way. */
  async advance(count: number): Promise<void> {
    while (this.inFlight) await this.inFlight.catch(() => undefined);
    await this.track(this.run(count));
  }
  /** Hold `work` as the step on its way until it settles; a failure stops the scene (and is reported by state()). */
  private track(work: Promise<void>): Promise<void> {
    const held: Promise<void> = work.catch((error: unknown) => {
      this.failure = error instanceof Error ? error.message : String(error);
      console.warn('[GPU scene] The scene stopped.', error);
      throw error;
    }).finally(() => { if (this.inFlight === held) this.inFlight = null; });
    this.inFlight = held;
    return held;
  }
  private async run(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      if (this.failure !== null) throw new EngineError('INVALID_STATE', `The GPU scene stopped: ${this.failure}`);
      const start = performance.now();
      await this.runner.step();
      await this.simulation.pullAsync();
      this.ms += performance.now() - start; this.timed++; this.steps++;
      this.onStep?.();
    }
  }
  /** Wait for the step on its way, if any. */
  settle(): Promise<void> { return (this.inFlight ?? Promise.resolve()).catch(() => undefined); }
  get busy(): boolean { return this.inFlight !== null; }
  state(): LabGpuSceneState {
    const backend = this.runner.backend, info = this.lab.compute?.info;
    return {
      mode: this.mode === 'gpu' && backend === 'reference' ? 'reference' : this.mode, adapter: this.mode === 'gpu' ? this.lab.adapter : null, software: !!info?.software,
      reason: this.mode === 'reference' ? 'The address asks for the float32 CPU reference (?gpu=reference).' : null,
      steps: this.steps, checkpointTick: this.runner.checkpointTick, skipped: this.skipped, msPerStep: this.timed > 0 ? this.ms / this.timed : NaN,
      fallback: this.runner.fallback, failed: this.failure,
    };
  }
  /** One line for the indicator. */
  readout(): string {
    const s = this.state(), ms = Number.isFinite(s.msPerStep) ? `, ${s.msPerStep.toFixed(s.msPerStep < 10 ? 1 : 0)} ms a step` : '';
    if (s.failed) return `GPU sections stopped: ${s.failed}`;
    if (s.fallback) return `GPU device lost at step ${s.fallback.atTick}: now on the float32 CPU reference (from the checkpoint at step ${s.fallback.resumedFrom}, ${s.fallback.stepsRerun} steps taken again)${ms}`;
    if (s.mode === 'gpu') return `GPU sections on WebGPU compute (${s.adapter ?? 'adapter'}${s.software ? ', software' : ''}), float32${ms}`;
    return `GPU sections on the float32 CPU reference${ms}`;
  }
}
