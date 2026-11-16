/**
 * The Lab's examples at scale, computed and drawn on the GPU (docs/GPU_COMPUTE.md):
 *
 *   lab.html?example=sand-avalanche-100k    100 000 grains released on a slope of 30 degrees
 *   lab.html?example=flood-valley-1m        a reservoir let go into a valley of 1024 x 1024 cells
 *
 * `&n=` sets the size (grains; cells along a side). The solvers are the WebGPU backends of src/engine/gpu/ on the
 * renderer's own device, so the renderer draws from their buffers (src/webgpu/simulation-layers.ts) and nothing is read
 * back for a frame; a few hundred bytes of statistics come back per batch of steps. Without WebGPU compute (the WebGL2
 * renderer, or a device too small) the page opens a small CPU example of the same kind instead and says so.
 */
import { EngineError } from '../engine/contracts.ts';
import { ShallowWater } from '../engine/shallow-water.ts';
import { GpuCompute } from '../engine/gpu/compute.ts';
import { packDemWalls } from '../engine/gpu/granular-f32.ts';
import { GpuGranular, demMemory } from '../engine/gpu/granular-gpu.ts';
import { sandAvalanche } from '../engine/gpu/granular-setups.ts';
import { GpuShallowWater } from '../engine/gpu/shallow-water-gpu.ts';
import { floodValley } from '../engine/gpu/shallow-water-setups.ts';
import { createGrainLayer, createHeightFieldLayers, createPlaneLayer } from '../webgpu/simulation-layers.ts';
import type { SimulationLayer, WebGPURenderer } from '../webgpu/renderer';

export const GPU_SHOWCASES = Object.freeze({
  'sand-avalanche-100k': { title: 'Sand avalanche, 100 000 grains (GPU)', size: 100_000, fallback: 'hopper-seesaw' },
  'flood-valley-1m': { title: 'Flood down a valley, 1 048 576 cells (GPU)', size: 1024, fallback: 'dam-break-valley' },
});
export type GpuShowcaseName = keyof typeof GPU_SHOWCASES;
/** The showcase a Lab address asks for (`?example=<name>`), or null. */
export function gpuShowcaseRequest(search: string): GpuShowcaseName | null {
  let name: string | null = null;
  try { name = new URLSearchParams(search).get('example'); } catch { return null; }
  return name !== null && Object.hasOwn(GPU_SHOWCASES, name) ? name as GpuShowcaseName : null;
}

export interface GpuShowcaseState {
  readonly name: string; readonly backend: 'webgpu-f32'; readonly solver: string; readonly elements: number; readonly steps: number; readonly time: number;
  /** Wall milliseconds per solver step over the last batch that was waited for. */
  readonly msPerStep: number; readonly adapter: string; readonly software: boolean; readonly drawStride: number; readonly failed: string | null;
  readonly stats: Readonly<Record<string, number>>;
}
export interface GpuShowcase {
  readonly name: GpuShowcaseName; readonly title: string; readonly device: GPUDevice;
  readonly camera: { readonly yaw: number; readonly pitch: number; readonly distance: number; readonly target: readonly [number, number, number] };
  /** Call once per rendered frame with the 1/60 s steps to take (0 while paused). A frame that arrives while a batch is still on its way to the GPU takes none. */
  frame(steps: number): void;
  /** Take `steps` steps of 1/60 s now and wait for the GPU to finish them (for tests and captures; frames need not be drawn). */
  advance(steps: number): Promise<void>;
  state(): GpuShowcaseState;
  readout(): string;
  dispose(): void;
}
export interface GpuShowcaseFallback { readonly fallback: string; readonly reason: string }

const size = (params: URLSearchParams, standard: number, min: number, max: number): number => {
  const n = Number(params.get('n'));
  return Number.isFinite(n) && n >= min ? Math.min(max, Math.floor(n)) : standard;
};
const adapterText = (compute: GpuCompute): string => `${compute.info.vendor} ${compute.info.architecture} ${compute.info.device}`.replace(/\s+/g, ' ').trim() || 'unknown adapter';
// Column-major 4 x 4 matrices.
const multiply = (a: readonly number[], b: readonly number[]): number[] => { const out = new Array<number>(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[4 * c + r] += a[4 * k + r]! * b[4 * c + k]!; return out; };
const translate = (x: number, y: number, z: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scale = (x: number, y: number, z: number): number[] => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rotateZ = (angle: number): number[] => { const c = Math.cos(angle), s = Math.sin(angle); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

async function avalanche(renderer: WebGPURenderer, compute: GpuCompute, params: URLSearchParams): Promise<GpuShowcase> {
  const name = 'sand-avalanche-100k' as const, made = sandAvalanche(size(params, GPU_SHOWCASES[name].size, 64, 4_000_000)), dem = made.granular, n = dem.grainCount;
  // As many history slots as the device's largest binding holds, up to ten (each takes 32 bytes per grain here).
  const limit = compute.device.limits.maxStorageBufferBindingSize, slots = Math.min(10, Math.floor(limit / (32 * n)));
  if (slots < 4 || demMemory(n, { historySlots: slots, rolling: true, walls: dem.wallCount }).largest > limit) throw new EngineError('GPU_UNAVAILABLE', `${n} grains do not fit this device's storage buffers (${limit} bytes).`);
  const gpu = await GpuGranular.fromGranular(compute, dem, { historySlots: slots });
  // The solver's frame is the slope's: x runs downhill, y is its normal. Drawn tilted, three world metres to the heap.
  const k = 3 / made.length, model = multiply(translate(-7, 6.5, -0.5 * made.width * k), multiply(rotateZ(-made.slope), scale(k, k, k)));
  const target = renderer.simulationLayerTarget();
  const layers: SimulationLayer[] = [
    createPlaneLayer(target, { model, rect: [-0.3 * made.length, -0.6 * made.width, 7.5 * made.length, 1.6 * made.width], gridSize: 0.25 * made.length, color: [0.17, 0.16, 0.15] }),
    createGrainLayer(target, gpu.positionBuffer, n, { model, color: [0.80, 0.63, 0.38] }),
  ];
  renderer.setSimulationLayers(layers);
  const perFrame = made.stepsPerSecond / 60, releaseAt = 0.25;
  let busy = false, released = false, msPerStep = NaN, failed: string | null = null, disposed = false;
  const advance = async (steps: number): Promise<void> => {
    const started = performance.now();
    for (let k = 0; k < steps; k++) {
      if (!released && gpu.time >= releaseAt) {
        // The gate is taken away: the walls are uploaded again and the forces evaluated without it.
        released = true; dem.setWallEnabled(made.gate, false);
        packDemWalls(dem.backendDescription(), gpu.setup.walls, false); gpu.upload({ walls: true });
      }
      await gpu.step(perFrame);
    }
    // One wait for the whole batch: the walls' sums and the counters (a few hundred bytes).
    await gpu.readWalls();
    msPerStep = (performance.now() - started) / (perFrame * Math.max(1, steps));
  };
  return {
    name, title: `Sand avalanche, ${n.toLocaleString('en')} grains (GPU)`, device: compute.device,
    // From the side of the slope, a little downhill of the heap.
    camera: { yaw: 1.2, pitch: 0.2, distance: 10.5, target: [-3.2, 3.9, 0] },
    frame(steps) {
      if (busy || failed || disposed || steps <= 0) return;
      busy = true;
      void advance(Math.min(steps, 2)).catch((error: unknown) => { failed = error instanceof Error ? error.message : String(error); }).finally(() => { busy = false; });
    },
    advance,
    state: () => ({ name, backend: 'webgpu-f32', solver: gpu.solver, elements: n, steps: gpu.stats.steps, time: gpu.time, msPerStep, adapter: adapterText(compute), software: compute.info.software, drawStride: 1, failed,
      stats: { contacts: gpu.stats.contacts, wallContacts: gpu.stats.wallContacts, removed: gpu.stats.removed, historyOverflow: gpu.stats.historyOverflow, bucketOverflow: gpu.stats.bucketOverflow, overlap: gpu.stats.overlap, historySlots: slots, stepsPerSecond: made.stepsPerSecond, released: released ? 1 : 0 } }),
    readout() {
      const s = gpu.stats;
      return `${n.toLocaleString('en')} grains on the GPU · t = ${gpu.time.toFixed(2)} s · ${made.stepsPerSecond} steps per simulated second · ${Number.isFinite(msPerStep) ? `${msPerStep.toFixed(2)} ms per step` : 'starting'} · ${s.contacts.toLocaleString('en')} contacts${s.historyOverflow ? ` · ${s.historyOverflow} without a history slot` : ''}${failed ? ` · stopped: ${failed}` : ''}`;
    },
    dispose() { if (disposed) return; disposed = true; renderer.setSimulationLayers([]); for (const layer of layers) layer.destroy(); gpu.destroy(); },
  };
}

async function flood(renderer: WebGPURenderer, compute: GpuCompute, params: URLSearchParams): Promise<GpuShowcase> {
  const name = 'flood-valley-1m' as const, n = size(params, GPU_SHOWCASES[name].size, 32, 4096), length = 1000;
  if (16 * n * n > compute.device.limits.maxStorageBufferBindingSize) throw new EngineError('GPU_UNAVAILABLE', `${n} x ${n} cells do not fit this device's storage buffers.`);
  const options = floodValley(n, length), water = new ShallowWater(options);
  // A frame never waits for the GPU: the substeps are chosen from the newest face speeds that have come back.
  const gpu = await GpuShallowWater.create(compute, water, { rateLatency: 2, rateWait: false, safety: 1.5 });
  // A kilometre of valley drawn 24 world metres long, heights one and a half times as tall as they are.
  const k = 24 / length, model = multiply(translate(-12, -0.6, -12), scale(k, 1.5 * k, k));
  const field = createHeightFieldLayers(renderer.simulationLayerTarget(), gpu.stateBuffer, gpu.fixedBuffer, { cells: [n, n], origin: [0, 0], spacing: [water.dx, water.dz], model, dryDepth: 0.02, deepDepth: 8, fastSpeed: 9 });
  const layers = [field.terrain, field.water];
  renderer.setSimulationLayers(layers);
  let busy = false, msPerStep = NaN, failed: string | null = null, disposed = false, sinceSync = 0;
  const advance = async (steps: number): Promise<void> => {
    const started = performance.now();
    await gpu.step(steps); await gpu.sync(); await gpu.compute.read([{ buffer: gpu.stateBuffer, size: 16 }]);
    msPerStep = (performance.now() - started) / Math.max(1, steps);
  };
  return {
    name, title: `Flood down a valley, ${(n * n).toLocaleString('en')} cells (GPU)`, device: compute.device,
    // From above the foot of the valley, looking up it.
    camera: { yaw: -0.35, pitch: 0.78, distance: 27, target: [-1, 0.6, 0] },
    frame(steps) {
      if (busy || failed || disposed || steps <= 0) return;
      busy = true;
      // Every twentieth batch waits for the GPU and brings the statistics (32 bytes) up to date.
      const count = Math.min(steps, 2), wait = ++sinceSync >= 20;
      if (wait) sinceSync = 0;
      void (wait ? advance(count) : gpu.step(count)).catch((error: unknown) => { failed = error instanceof Error ? error.message : String(error); }).finally(() => { busy = false; });
    },
    advance,
    state: () => ({ name, backend: 'webgpu-f32', solver: gpu.solver, elements: n * n, steps: gpu.steps, time: gpu.time, msPerStep, adapter: adapterText(compute), software: compute.info.software, drawStride: field.stride, failed,
      stats: { substeps: gpu.stats.substeps, totalSubsteps: gpu.stats.totalSubsteps, courant: gpu.stats.courant, maxCourant: gpu.maxCourant, wetCells: gpu.stats.wetCells, maxWaveSpeed: gpu.stats.maxWaveSpeed } }),
    readout() {
      const s = gpu.stats;
      return `${n} x ${n} cells on the GPU · t = ${gpu.time.toFixed(1)} s · ${s.substeps} substeps per step · Courant number ${s.courant.toFixed(2)} · ${s.wetCells.toLocaleString('en')} wet cells${field.stride > 1 ? ` · drawn every ${field.stride} cells` : ''}${Number.isFinite(msPerStep) ? ` · ${msPerStep.toFixed(1)} ms per step` : ''}${failed ? ` · stopped: ${failed}` : ''}`;
    },
    dispose() { if (disposed) return; disposed = true; renderer.setSimulationLayers([]); for (const layer of layers) layer.destroy(); gpu.destroy(); },
  };
}

/**
 * Start a showcase on the renderer's device, or say which CPU example to open instead and why (no WebGPU renderer, a
 * device that cannot hold the buffers, a shader the device refuses).
 */
export async function startGpuShowcase(name: GpuShowcaseName, renderer: WebGPURenderer | null, params: URLSearchParams): Promise<GpuShowcase | GpuShowcaseFallback> {
  const fallback = GPU_SHOWCASES[name].fallback;
  if (!renderer) return { fallback, reason: 'This page is drawing with WebGL2, which has no compute shaders.' };
  try {
    const compute = new GpuCompute(renderer.device, (renderer.device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo ?? null);
    return await (name === 'sand-avalanche-100k' ? avalanche(renderer, compute, params) : flood(renderer, compute, params));
  } catch (error) {
    renderer.setSimulationLayers([]);
    if (error instanceof EngineError && error.code.startsWith('GPU_')) return { fallback, reason: error.message };
    throw error;
  }
}
