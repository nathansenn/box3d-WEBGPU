/**
 * Debug draw: box outlines and query rays as plain line-segment vertex
 * buffers (x, y, z per vertex, two vertices per segment). Any renderer can
 * draw them; with three.js use a LineSegments over a BufferGeometry.
 */
import {convertMatrices, type UpAxis} from './axes.js';
import type {InstanceSource} from './three.js';

export interface DebugLineOptions {
  readonly alpha?: number;
  readonly up?: UpAxis;
  /** Reuse this buffer when large enough (24 vertices * 3 floats per box). */
  readonly out?: Float32Array;
  /** Skip row 0 (the arena ground), which is large and usually distracting. Default false. */
  readonly skipGround?: boolean;
}

export interface DebugLines {
  readonly positions: Float32Array;
  /** Number of vertices to draw (two per segment). */
  readonly vertexCount: number;
}

// Unit cube corners (-1..1) and its 12 edges.
const CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const EDGES = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
export const DEBUG_FLOATS_PER_BOX = EDGES.length * 3;

/** Outline every body's box. */
export function boxOutlines(source: InstanceSource, options: DebugLineOptions = {}): DebugLines {
  const count = source.bodyCount(), first = options.skipGround ? 1 : 0, boxes = Math.max(0, count - first);
  let m = options.alpha !== undefined && source.interpolatedMatrices ? source.interpolatedMatrices(options.alpha) : source.matrices();
  if ((options.up ?? 'y') !== 'y') m = convertMatrices(m, new Float32Array(count * 16), count, options.up);
  const need = boxes * DEBUG_FLOATS_PER_BOX;
  const out = options.out && options.out.length >= need ? options.out : new Float32Array(need);
  const corner = new Float32Array(24);
  let w = 0;
  for (let row = first; row < count; row++) {
    const o = row * 16;
    for (let c = 0; c < 8; c++) {
      const [x, y, z] = CORNERS[c];
      corner[c * 3] = m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12];
      corner[c * 3 + 1] = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13];
      corner[c * 3 + 2] = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
    }
    for (const e of EDGES) { out[w++] = corner[e * 3]; out[w++] = corner[e * 3 + 1]; out[w++] = corner[e * 3 + 2]; }
  }
  return {positions: out, vertexCount: w / 3};
}

/**
 * A query ray as one segment, ending at the hit point when there was a hit
 * (pass the result of raycast/sphereCast/boxCast).
 */
export function rayLine(origin: readonly [number, number, number], translation: readonly [number, number, number], hit?: {readonly fraction: number} | null): DebugLines {
  const t = hit ? hit.fraction : 1;
  return {
    positions: new Float32Array([origin[0], origin[1], origin[2], origin[0] + translation[0] * t, origin[1] + translation[1] * t, origin[2] + translation[2] * t]),
    vertexCount: 2,
  };
}
