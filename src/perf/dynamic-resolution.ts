/**
 * Dynamic resolution: scales the drawing-buffer pixel ratio between a floor and a ceiling to hold a frame-time target.
 *
 * Fed with one frame cost per rendered frame, either a GPU time (timestamp queries, or the submit-to-done latency of a
 * frame submitted to an idle queue: both show the headroom below the target) or a presented-frame interval (rAF time
 * between rendered frames: vsync-locked, so it shows only whether frames are missed). Frame cost scales with the pixel
 * count, the square of the ratio, so a step down aims at sqrt(target / cost). Upward steps are single and slow, and are
 * held back for longer after each one that had to be undone, so the ratio settles instead of oscillating.
 *
 * Rendering only: the ratio never reaches the simulation, so no physics result depends on it.
 */
export type FrameCostSource = 'gpu' | 'interval';

export interface DynamicResolutionOptions {
  /** Highest pixel ratio: devicePixelRatio, capped by the quality setting. */
  ceiling: number;
  /** Lowest pixel ratio on a hardware adapter (default 0.5, or the ceiling when that is lower). */
  floor?: number;
  /** Frame time to hold, ms (default 14 for GPU time, 19 for presented-frame intervals). */
  targetMs?: number;
  /** A software adapter (SwiftShader, a fallback adapter): starts at the floor and may go to SOFTWARE_FLOOR. */
  software?: boolean;
  /** A fixed pixel ratio (tests, comparisons): adaptation is off. */
  fixed?: number | null;
  /** Off: the ratio stays at the ceiling. */
  enabled?: boolean;
  source?: FrameCostSource;
}

/** Ratios are kept on a grid of this step so a render target is not reallocated for a 1% change. */
export const RESOLUTION_STEP = 0.05;
/** Hardware floor: half the CSS resolution on each axis, a quarter of the pixels at devicePixelRatio 1. */
export const HARDWARE_FLOOR = 0.5;
/** Software adapters rasterise on the CPU: they may go to an eighth of the CSS pixels. */
export const SOFTWARE_FLOOR = 0.35;

const quantize = (value: number): number => Math.round(value / RESOLUTION_STEP) * RESOLUTION_STEP;

export class DynamicResolution {
  readonly ceiling: number;
  readonly floor: number;
  readonly targetMs: number;
  readonly source: FrameCostSource;
  readonly adaptive: boolean;
  readonly software: boolean;
  private current: number;
  private ema = 0;
  private samples = 0;
  private over = 0;
  private under = 0;
  /** Samples to wait after a change (render-target reallocation and pipeline warm-up spike the next frames). */
  private settle = 0;
  /** Under-target samples needed before the next upward step; doubles each time an upward step is undone. */
  private upwardPatience: number;
  private lastStepUp = false;
  changes = 0;

  constructor(options: DynamicResolutionOptions) {
    this.source = options.source ?? 'gpu';
    this.software = options.software === true;
    this.ceiling = Math.max(0.1, options.ceiling);
    const hardwareFloor = Math.min(this.ceiling, options.floor ?? HARDWARE_FLOOR);
    this.floor = this.software ? Math.min(hardwareFloor, SOFTWARE_FLOOR) : hardwareFloor;
    this.targetMs = options.targetMs ?? (this.source === 'gpu' ? 14 : 19);
    this.upwardPatience = this.source === 'gpu' ? 45 : 120;
    const fixed = options.fixed;
    this.adaptive = options.enabled !== false && !(fixed !== undefined && fixed !== null && Number.isFinite(fixed));
    if (!this.adaptive) this.current = fixed !== undefined && fixed !== null && Number.isFinite(fixed) ? Math.max(0.1, fixed) : this.ceiling;
    else this.current = this.software ? hardwareFloor : this.ceiling;
  }

  /** The pixel ratio to draw at now. */
  get ratio(): number { return this.current; }
  /** The ratio as a fraction of the ceiling (1 = full resolution). */
  get scale(): number { return this.current / this.ceiling; }
  get averageMs(): number { return this.ema; }

  /** Records one rendered frame's cost; returns true when the ratio changed. */
  sample(frameMs: number): boolean {
    if (!this.adaptive || !Number.isFinite(frameMs) || frameMs < 0) return false;
    if (this.settle > 0) { this.settle--; return false; }
    this.samples++;
    this.ema = this.samples === 1 ? frameMs : this.ema + (frameMs - this.ema) * 0.2;
    const target = this.targetMs;
    if (this.ema > target * 1.2) {
      this.under = 0;
      if (++this.over >= 4) return this.stepDown();
    } else if (this.ema < (this.source === 'gpu' ? target * 0.6 : target)) {
      this.over = 0;
      if (++this.under >= this.upwardPatience) return this.stepUp();
    } else { this.over = 0; this.under = 0; }
    return false;
  }

  private stepDown(): boolean {
    this.over = 0;
    if (this.lastStepUp) this.upwardPatience = Math.min(this.upwardPatience * 2, 3600);
    this.lastStepUp = false;
    const factor = Math.min(0.9, Math.max(0.6, Math.sqrt(this.targetMs / Math.max(this.ema, 1e-3))));
    return this.set(Math.min(this.current - RESOLUTION_STEP, quantize(this.current * factor)));
  }

  private stepUp(): boolean {
    this.under = 0;
    this.lastStepUp = true;
    return this.set(this.current + RESOLUTION_STEP);
  }

  private set(next: number): boolean {
    const value = Math.max(this.floor, Math.min(this.ceiling, next));
    if (Math.abs(value - this.current) < 1e-9) return false;
    this.current = value;
    this.changes++;
    this.samples = 0;
    this.settle = 3;
    return true;
  }
}

/** URL switches shared by the Studio and the Lab: `?resolution=<ratio>` fixes the pixel ratio (deterministic captures and
 * tests), `?adaptive=0` keeps it at the quality setting's ratio. */
export function resolutionQuery(search: string): { fixed: number | null; enabled: boolean } {
  const query = new URLSearchParams(search);
  const raw = query.get('resolution');
  const value = raw === null || raw === '' ? Number.NaN : Number(raw);
  return { fixed: Number.isFinite(value) && value > 0 ? Math.min(4, Math.max(0.1, value)) : null, enabled: query.get('adaptive') !== '0' };
}

interface AdapterInfoLike { vendor?: string; architecture?: string; device?: string; description?: string; isFallbackAdapter?: boolean }

/** True for a CPU rasteriser: a WebGPU fallback adapter or SwiftShader, or a WebGL context on SwiftShader, llvmpipe or a
 * software Mesa or Microsoft Basic Render driver. */
export function isSoftwareAdapter(info: AdapterInfoLike | null | undefined, webglRenderer?: string | null): boolean {
  if (info?.isFallbackAdapter) return true;
  const text = [info?.vendor, info?.architecture, info?.device, info?.description, webglRenderer].filter(Boolean).join(' ').toLowerCase();
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/.test(text);
}

/** Software detection for a three.js WebGPURenderer (WebGPU device adapter info, else the WebGL renderer string). */
export function rendererIsSoftware(backend: unknown): boolean {
  const b = backend as { device?: { adapterInfo?: AdapterInfoLike } | null; gl?: WebGL2RenderingContext | null } | null;
  if (b?.device) return isSoftwareAdapter(b.device.adapterInfo);
  if (b?.gl) return isSoftwareAdapter(null, webglRendererName(b.gl));
  return false;
}

export function webglRendererName(gl: WebGL2RenderingContext | WebGLRenderingContext): string | null {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch { return null; }
}
