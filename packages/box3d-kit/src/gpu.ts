/**
 * Raw WebGPU interop: stream instance transforms into a buffer you own, for
 * custom renderers. No dependency on the app's renderer or on @webgpu/types.
 */
import {convertMatrices, type UpAxis} from './axes.js';
import type {InstanceSource} from './three.js';

/** Structural subset of GPUQueue. */
export interface GpuQueueLike {
  writeBuffer(buffer: unknown, bufferOffset: number, data: ArrayBufferView, dataOffset?: number, size?: number): void;
}
/** Structural subset of GPUBuffer. */
export interface GpuBufferLike { readonly size: number }

export interface WriteInstancesOptions {
  /** Byte offset into `buffer`; must be a multiple of 4. Default 0. */
  readonly offset?: number;
  /** Interpolation factor from update(); omit for the latest step. */
  readonly alpha?: number;
  /** Render frame. Default 'y' (Box3D's own). */
  readonly up?: UpAxis;
  /** Also write RGBA float colors into this buffer (4 floats per instance). */
  readonly colorBuffer?: GpuBufferLike;
  readonly colorOffset?: number;
  /**
   * Upload only the contiguous range of rows that changed since the last
   * upload to this buffer (keeps a CPU shadow copy). Pays off when most
   * bodies sleep. Default false.
   */
  readonly changedRowsOnly?: boolean;
}

/** Rows written by the most recent writeInstances call (for profiling). */
export interface UploadRange { readonly firstRow: number; readonly rows: number }
const shadows = new WeakMap<object, {data: Float32Array; count: number; offset: number}>();
let lastRange: UploadRange = {firstRow: 0, rows: 0};
/** The row range the most recent writeInstances call uploaded. */
export function lastUploadRange(): UploadRange { return lastRange; }

const uploaded = new WeakMap<object, {transform: number; color: number; count: number; alpha: number | undefined}>();
let scratch = new Float32Array(0);

/**
 * Write `bodyCount()` column-major mat4x4<f32> (64 bytes each) into `buffer`.
 * Skips the upload when nothing moved since the last call for this buffer.
 * Returns the instance count to draw; instances beyond the buffer are dropped.
 *
 *   const count = writeInstances(world, device.queue, instanceBuffer, {alpha});
 *   pass.draw(36, count);
 */
export function writeInstances(source: InstanceSource, queue: GpuQueueLike, buffer: GpuBufferLike, options: WriteInstancesOptions = {}): number {
  const offset = options.offset ?? 0;
  if (offset % 4 !== 0) throw new RangeError('offset must be a multiple of 4 bytes.');
  const fit = Math.max(0, Math.floor((buffer.size - offset) / 64));
  const count = Math.min(source.bodyCount(), fit);
  const transform = source.transformVersion(), color = source.colorVersion(), alpha = options.alpha;
  const last = uploaded.get(buffer as object);
  lastRange = {firstRow: 0, rows: 0};
  if (!(last && last.transform === transform && last.count === count && last.alpha === alpha)) {
    const matrices = alpha !== undefined && source.interpolatedMatrices ? source.interpolatedMatrices(alpha) : source.matrices();
    let data = matrices.subarray(0, count * 16);
    if ((options.up ?? 'y') !== 'y') {
      if (scratch.length < data.length) scratch = new Float32Array(data.length);
      data = convertMatrices(data, scratch, count, options.up).subarray(0, count * 16);
    }
    if (options.changedRowsOnly) {
      let shadow = shadows.get(buffer as object);
      if (shadow && shadow.offset !== offset) shadow = undefined; // a different region: start over
      if (!shadow || shadow.data.length < count * 16) {
        const grown = new Float32Array(Math.max(count, 64) * 16);
        if (shadow) grown.set(shadow.data.subarray(0, Math.min(shadow.count, count) * 16));
        shadow = {data: grown, count: shadow?.count ?? 0, offset};
        shadows.set(buffer as object, shadow);
      }
      let first = -1, lastRow = -1;
      for (let row = 0; row < count; row++) {
        const o = row * 16;
        let same = row < shadow.count;
        for (let k = 0; same && k < 16; k++) same = shadow.data[o + k] === data[o + k];
        if (!same) { if (first < 0) first = row; lastRow = row; }
      }
      if (first >= 0) {
        queue.writeBuffer(buffer, offset + first * 64, data, first * 16, (lastRow - first + 1) * 16);
        shadow.data.set(data.subarray(first * 16, (lastRow + 1) * 16), first * 16);
        lastRange = {firstRow: first, rows: lastRow - first + 1};
      }
      shadow.count = count;
    } else if (count > 0) {
      queue.writeBuffer(buffer, offset, data, 0, count * 16);
      lastRange = {firstRow: 0, rows: count};
    }
  }
  if (options.colorBuffer) {
    const colorFit = Math.max(0, Math.floor((options.colorBuffer.size - (options.colorOffset ?? 0)) / 16));
    const colorCount = Math.min(count, colorFit);
    const lastColor = uploaded.get(options.colorBuffer as object);
    if (colorCount > 0 && !(lastColor && lastColor.color === color && lastColor.count === colorCount)) {
      queue.writeBuffer(options.colorBuffer, options.colorOffset ?? 0, source.colors(), 0, colorCount * 4);
    }
    uploaded.set(options.colorBuffer as object, {transform, color, count: colorCount, alpha: undefined});
  }
  uploaded.set(buffer as object, {transform, color, count, alpha});
  return count;
}

/** WGSL snippet matching the layout written by writeInstances (bind as read-only storage). */
export const INSTANCE_WGSL = /* wgsl */ `
struct Instances { m: array<mat4x4<f32>> };
@group(0) @binding(0) var<storage, read> instances: Instances;
// Box3D matrices are scaled by half extents: draw a unit cube spanning -1..1.
fn instanceMatrix(i: u32) -> mat4x4<f32> { return instances.m[i]; }
`;
