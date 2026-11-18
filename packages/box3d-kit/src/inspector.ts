/**
 * A small live debug overlay: body, awake and contact counts, capacity, tick,
 * step time, dropped time and WASM heap size. Works with PhysicsWorld and
 * RemoteWorld (whose stats() is async). Plain DOM, no styles leak out.
 */
import type {WorldStats} from './world.js';

interface ElementLike { textContent: string | null; style: {cssText: string}; remove(): void }
interface DocumentLike { createElement(tag: string): ElementLike; body?: {appendChild(node: any): unknown} | null }

export interface InspectorSource {
  stats(): WorldStats | Promise<WorldStats>;
  readonly native?: {readonly HEAPF32: Float32Array};
}

export interface InspectorOptions {
  /** Where to attach; default document.body. */
  readonly parent?: {appendChild(node: any): unknown};
  readonly document?: DocumentLike;
  /** Refresh period. Default 250 ms. */
  readonly intervalMs?: number;
  readonly title?: string;
}

export interface Inspector {
  readonly element: ElementLike;
  /** Refresh now (also runs on the interval). */
  refresh(): Promise<void>;
  unmount(): void;
}

/** Render one stats snapshot as the overlay's text. Exposed for custom HUDs and logging. */
export function formatStats(stats: WorldStats, heapBytes?: number, title = 'Box3D'): string {
  const lines = [
    title,
    `bodies   ${stats.bodies} / ${stats.capacity}`,
    `awake    ${stats.awake}`,
    `contacts ${stats.contacts ?? 'n/a'}`,
    `tick     ${stats.tick}`,
    `step     ${stats.lastStepMs.toFixed(2)} ms`,
    `update   ${stats.lastUpdateMs.toFixed(2)} ms`,
  ];
  if (stats.droppedSeconds > 0) lines.push(`dropped  ${(stats.droppedSeconds * 1000).toFixed(0)} ms`);
  if (heapBytes !== undefined) lines.push(`heap     ${(heapBytes / 1048576).toFixed(1)} MB`);
  return lines.join('\n');
}

export function mountInspector(source: InspectorSource, options: InspectorOptions = {}): Inspector {
  const doc = options.document ?? (globalThis as {document?: DocumentLike}).document;
  if (!doc) throw new TypeError('mountInspector needs a DOM document.');
  const parent = options.parent ?? doc.body;
  if (!parent) throw new TypeError('mountInspector needs a parent element.');
  const element = doc.createElement('pre');
  element.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;margin:0;padding:8px 10px;'
    + 'font:12px/1.35 ui-monospace,Menlo,monospace;color:#e6edf3;background:rgba(13,17,23,.82);'
    + 'border-radius:6px;pointer-events:none;white-space:pre';
  parent.appendChild(element);
  let alive = true;
  const refresh = async () => {
    if (!alive) return;
    try {
      const stats = await source.stats();
      if (alive) element.textContent = formatStats(stats, source.native?.HEAPF32.buffer.byteLength, options.title);
    } catch (error) {
      if (alive) element.textContent = `${options.title ?? 'Box3D'}\n${(error as Error).message}`;
    }
  };
  const timer = setInterval(refresh, options.intervalMs ?? 250);
  void refresh();
  return {
    element,
    refresh,
    unmount() { alive = false; clearInterval(timer); element.remove(); },
  };
}
