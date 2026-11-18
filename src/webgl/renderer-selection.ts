/**
 * Which renderer the Physics Lab draws with, and the interface both renderers give the Lab.
 *
 *   - `?renderer=webgl2` forces the WebGL2 renderer; `?renderer=webgpu` forces WebGPU with no fallback
 *     (the old behaviour, for tests that must exercise WebGPU). Any other value, or none, is `auto`.
 *   - `auto`: WebGPU when `navigator.gpu` exists and the WebGPU renderer starts (adapter, device and
 *     pipelines); otherwise WebGL2.
 *   - A lost WebGPU device switches to WebGL2 (`rendererAfterLoss`). A lost WebGL2 context is replaced
 *     by a new WebGL2 context. The scene, clock and camera are not touched: they live on the CPU.
 *
 * No DOM here: the startup attempt takes its factories as arguments, so node tests can drive it
 * (tests/physics/lab-renderer-selection.test.mjs).
 */
import type { DebugLine, DynamicSurfaceFrame, InstanceBufferSource, RopeGridFrame, SceneUniformState } from '../types';
import type { GpuTimingInfo } from '../webgpu/gpu-timing.js';

export type LabRendererKind = 'webgpu' | 'webgl2';
export type LabRendererRequest = 'auto' | LabRendererKind;

/** What the Lab's frame loop calls on its renderer; WebGPURenderer and WebGL2LabRenderer both have it. */
export interface LabRenderer {
  readonly maxInstances: number;
  writeSceneUniforms(state: SceneUniformState): void;
  uploadInstances(source: InstanceBufferSource, count: number): number;
  uploadRopeGrid(grid: RopeGridFrame | null, baseInstance: number): number;
  uploadSoftInstances(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number, frameVersion: number): number;
  uploadEffects(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number, frameVersion: number): number;
  uploadSurface(surface: DynamicSurfaceFrame | null): number;
  render(instanceCount: number, debugLines: readonly DebugLine[], lineFrameVersion?: number): number;
  invalidateDynamicCaches(): void;
  gpuTimingInfo(): GpuTimingInfo;
  shadowCacheInfo(): { rendered: number; reused: number };
  bodyMeshInfo(): Readonly<{ bodies: number; vertices: number }>;
  instanceShapeInfo(): Readonly<{ mode: 'boxes' | 'direct-shapes'; spheres: number; capsules: number; boxRuns: number }>;
  uploadedMegabytes(): number;
  onDeviceLost(callback: (info: { readonly reason: string; readonly message: string }) => void): () => void;
  dispose(): void;
}

/** The renderer the address asks for: `?renderer=webgl2`, `?renderer=webgpu`, or `auto`. */
export function rendererRequest(search: string): LabRendererRequest {
  let value: string | null = null;
  try { value = new URLSearchParams(search).get('renderer'); } catch { value = null; }
  const v = value?.trim().toLowerCase();
  if (v === 'webgl2' || v === 'webgl') return 'webgl2';
  if (v === 'webgpu') return 'webgpu';
  return 'auto';
}

/** The renderers to try at startup, in order. */
export function rendererCandidates(request: LabRendererRequest, hasNavigatorGpu: boolean): LabRendererKind[] {
  if (request === 'webgl2') return ['webgl2'];
  if (request === 'webgpu') return ['webgpu'];
  return hasNavigatorGpu ? ['webgpu', 'webgl2'] : ['webgl2'];
}

/** The renderer that replaces one whose device or context was lost. */
export function rendererAfterLoss(lost: LabRendererKind, request: LabRendererRequest): LabRendererKind {
  // A page that forced WebGPU keeps trying WebGPU, as before this fallback existed.
  if (lost === 'webgpu' && request === 'webgpu') return 'webgpu';
  return 'webgl2';
}

/** The status line for the active renderer. */
export function rendererLabel(kind: LabRendererKind, reason: string | null = null): string {
  const name = kind === 'webgpu' ? 'WebGPU' : 'WebGL2';
  return reason ? `${name} (${reason})` : name;
}

export interface RendererAttempt { readonly kind: LabRendererKind; readonly error: string }
export interface RendererSelection<R> {
  readonly renderer: R;
  readonly kind: LabRendererKind;
  /** Why an earlier candidate was not used, in order; empty when the first one started. */
  readonly attempts: readonly RendererAttempt[];
}

/**
 * Start the first candidate whose factory resolves. Throws an error that lists every attempt when none
 * does. A factory is called only after the previous one failed.
 */
export async function selectRenderer<R>(
  candidates: readonly LabRendererKind[], factories: Readonly<Record<LabRendererKind, () => Promise<R>>>,
): Promise<RendererSelection<R>> {
  const attempts: RendererAttempt[] = [];
  for (const kind of candidates) {
    try { return { renderer: await factories[kind](), kind, attempts }; }
    catch (error) { attempts.push({ kind, error: error instanceof Error ? error.message : String(error) }); }
  }
  throw new Error(`No renderer could start. ${attempts.map(a => `${rendererLabel(a.kind)}: ${a.error}`).join(' ')}`.trim());
}

/** Why the first started renderer is not the first candidate, for the status line; null when it is. */
export function fallbackReason(selection: RendererSelection<unknown>, request: LabRendererRequest): string | null {
  if (request === 'webgl2') return 'forced by ?renderer=webgl2';
  if (selection.attempts.length === 0) return selection.kind === 'webgl2' ? 'WebGPU unavailable' : null;
  return 'WebGPU did not start';
}
