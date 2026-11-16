/**
 * The Physics Lab's rigid-body debug draw: Box3D's own drawing of contact points and normals, joints, shape
 * bounds, centres of mass and islands (NativeWorldBackend.debugLines, from b3World_Draw), turned into the line
 * records both of the Lab's renderers draw (WebGPU and WebGL2 share one overlay-line path).
 *
 * Switched on with `lab.html?debug=1` (or a list: `?debug=contacts,joints`) and from the Scenes panel. It applies
 * to scenes that run in a general world (scene files, examples, the SI demos); the 800 recipes use the
 * compatibility world, which has no debug draw.
 *
 * Nothing here touches the DOM, so the module is tested in Node (tests/physics/rigid-debug.test.mjs).
 */
import type { DebugLine } from '../types.ts';
import type { NativeDebugDrawOptions, NativeDebugLines } from '../engine/native-world.ts';

export const RIGID_DEBUG_LAYERS = ['contacts', 'normals', 'joints', 'bounds', 'mass', 'islands'] as const;
export type RigidDebugLayer = typeof RIGID_DEBUG_LAYERS[number];
export const RIGID_DEBUG_LABELS: { readonly [K in RigidDebugLayer]: string } = Object.freeze({
  contacts: 'Contact points', normals: 'Contact normals', joints: 'Joints', bounds: 'Bounds (AABB)', mass: 'Centres of mass', islands: 'Islands',
});
export interface RigidDebugState {
  readonly enabled: boolean;
  readonly layers: { readonly [K in RigidDebugLayer]: boolean };
}
/** What `?debug=1` shows: everything except the bounds and the islands, which bury a scene of any size in boxes. */
const DEFAULT_LAYERS: RigidDebugState['layers'] = Object.freeze({ contacts: true, normals: true, joints: true, bounds: false, mass: true, islands: false });
export const RIGID_DEBUG_OFF: RigidDebugState = Object.freeze({ enabled: false, layers: DEFAULT_LAYERS });

/**
 * The debug-draw state an address asks for. `?debug=1` (or `true`, `on`, `all`) switches the default layers on
 * (`all`: every layer); `?debug=contacts,joints` switches exactly those on; `0`, `off`, nothing, or only unknown
 * words leave it off.
 */
export function parseRigidDebugParam(value: string | null | undefined): RigidDebugState {
  const text = (value ?? '').trim().toLowerCase();
  if (text === '' || text === '0' || text === 'off' || text === 'false' || text === 'no') return RIGID_DEBUG_OFF;
  if (text === '1' || text === 'on' || text === 'true' || text === 'yes') return { enabled: true, layers: DEFAULT_LAYERS };
  const words = text.split(/[,+\s]+/).filter(Boolean);
  if (words.includes('all')) return { enabled: true, layers: { contacts: true, normals: true, joints: true, bounds: true, mass: true, islands: true } };
  const chosen = RIGID_DEBUG_LAYERS.filter(layer => words.includes(layer));
  if (chosen.length === 0) return RIGID_DEBUG_OFF;
  const layers = Object.fromEntries(RIGID_DEBUG_LAYERS.map(layer => [layer, chosen.includes(layer)])) as RigidDebugState['layers'];
  return { enabled: true, layers };
}

/** The value of `?debug=` that reproduces a state; null when it is off. */
export function rigidDebugParam(state: RigidDebugState): string | null {
  if (!state.enabled) return null;
  const chosen = RIGID_DEBUG_LAYERS.filter(layer => state.layers[layer]);
  if (chosen.length === 0) return null;
  if (RIGID_DEBUG_LAYERS.every(layer => state.layers[layer] === DEFAULT_LAYERS[layer])) return '1';
  return chosen.length === RIGID_DEBUG_LAYERS.length ? 'all' : chosen.join(',');
}

/** The engine options for a state. */
export function rigidDebugOptions(state: RigidDebugState): NativeDebugDrawOptions {
  const { contacts, normals, joints, bounds, mass, islands } = state.layers;
  return { contacts: contacts || normals, contactNormals: normals, joints, jointExtras: joints, bounds, mass, islands, jointScale: 0.6 };
}

/** The most lines one frame draws: a pile of thousands of bodies has more contact marks than are worth uploading. */
export const RIGID_DEBUG_LINE_LIMIT = 60000;

/**
 * Line records for the renderers from the engine's vertex pairs. `out` is reused: it is truncated or extended to
 * the number of lines, and its records are overwritten in place. Lines beyond `limit` are dropped.
 */
export function debugLinesToOverlay(lines: Pick<NativeDebugLines, 'positions' | 'colors' | 'vertexCount'>, out: DebugLine[] = [], limit = RIGID_DEBUG_LINE_LIMIT): DebugLine[] {
  const count = Math.min(Math.floor(lines.vertexCount / 2), limit), p = lines.positions, c = lines.colors;
  for (let i = 0; i < count; i++) {
    const a = i * 6, k = i * 6;
    let line = out[i];
    if (!line) { line = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0, g: 0, b: 0, a: 1 }; out[i] = line; }
    line.ax = p[a]!; line.ay = p[a + 1]!; line.az = p[a + 2]!; line.bx = p[a + 3]!; line.by = p[a + 4]!; line.bz = p[a + 5]!;
    // Box3D draws on black; lift the darkest colours so that they read on the Lab's dark floor too.
    line.r = Math.max(c[k]!, 0.18); line.g = Math.max(c[k + 1]!, 0.18); line.b = Math.max(c[k + 2]!, 0.18); line.a = 0.95;
  }
  out.length = count;
  return out;
}

/** What the overlay needs from a world: NativeWorldBackend has it. */
export interface RigidDebugSource {
  readonly supportsRigidCore: boolean;
  debugLines(options: NativeDebugDrawOptions): NativeDebugLines;
}

/**
 * Keeps the overlay lines of one world. `update` asks the engine again only when the world's transforms or the
 * chosen layers have changed, and `version` changes exactly when the lines do.
 */
export class RigidDebugOverlay {
  readonly lines: DebugLine[] = [];
  version = 1;
  /** Vertices the engine reported in the last update, before the line limit. */
  vertexCount = 0;
  truncated = false;
  private key = '';

  update(source: RigidDebugSource | null, state: RigidDebugState, frameVersion: number): readonly DebugLine[] {
    const key = source && state.enabled && source.supportsRigidCore ? `${frameVersion}:${rigidDebugParam(state) ?? ''}` : 'off';
    if (key === this.key) return this.lines;
    this.key = key;
    this.version = (this.version + 1) >>> 0;
    if (key === 'off') { this.lines.length = 0; this.vertexCount = 0; this.truncated = false; return this.lines; }
    const drawn = source!.debugLines(rigidDebugOptions(state));
    debugLinesToOverlay(drawn, this.lines);
    this.vertexCount = drawn.vertexCount;
    this.truncated = drawn.truncated || drawn.vertexCount / 2 > RIGID_DEBUG_LINE_LIMIT;
    return this.lines;
  }
}
