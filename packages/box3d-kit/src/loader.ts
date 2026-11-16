import {NativeWorldPool} from './core/native-world.js';
import {EngineError} from './core/contracts.js';
import {BUILD_INFO} from './core/build-info.js';

/** Emscripten MODULARIZE/EXPORT_ES6 factory exported by box3d.js. */
export type Box3DModuleFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Threaded artifact only: workers to start with the module (the calling thread is not counted). */
  b3wPoolSize?: number;
}) => Promise<unknown>;

export interface LoadBox3DOptions {
  /** Where box3d.js lives. Default: the copy shipped inside this package. */
  readonly moduleUrl?: string | URL;
  /** Where box3d.wasm lives. Default: the copy shipped inside this package. */
  readonly wasmUrl?: string | URL;
  /** Pre-fetched WASM bytes (Node, service workers, single-file builds). Skips the fetch. */
  readonly wasmBinary?: ArrayBuffer | Uint8Array;
  /** An already-imported box3d.js factory, for bundlers that inline it. */
  readonly factory?: Box3DModuleFactory;
  /**
   * Check the WASM bytes against the SHA-256 recorded at build time
   * (BUILD_INFO.wasmSha256) before instantiating, e.g. when serving the file
   * from a CDN. `true` checks the shipped hash; a hex string checks that one.
   */
  readonly integrity?: boolean | string;
  /**
   * Solver threads, the calling thread included: 1 to 32. 1 (the default) loads the single-threaded artifact.
   * 2 or more loads the pthread artifact (box3d-mt.js and box3d-mt.wasm, shipped beside the other) with
   * `threads - 1` workers and steps every world that has at least `threadThreshold` awake bodies on them.
   * The simulation is the same bit for bit at every thread count (docs/THREADED_ENGINE.md, docs/RIGID_CORE.md
   * section 9); only the step time changes, and small worlds are not faster. It needs SharedArrayBuffer: Node, or
   * a cross-origin isolated page (COOP and COEP headers). Where it cannot run, loading fails with
   * UNSUPPORTED_BACKEND instead of silently using one thread. `moduleUrl`, `wasmUrl`, `wasmBinary`, `factory` and
   * `integrity`, when given with `threads`, are those of the pthread artifact.
   */
  readonly threads?: number;
  /** Awake bodies from which a world is stepped on the workers. Default 384 (below it the threads cost more than they save); 0 threads every world. */
  readonly threadThreshold?: number;
}

/** How a pool's worlds are stepped. */
export interface Box3DThreading {
  /** Threads asked for, the calling thread included. 1 for the single-threaded artifact. */
  readonly threads: number;
  /** Awake bodies from which a world uses them. */
  readonly threshold: number;
  /** Threads the latest step that reached the solver ran on (1 below the threshold). */
  lastStepThreads(): number;
}

const threadings = new WeakMap<NativeWorldPool, Box3DThreading>();
const SINGLE: Box3DThreading = Object.freeze({threads: 1, threshold: 0, lastStepThreads: () => 1});
/** How the worlds of a pool from `loadBox3D` are stepped: on how many threads, and from how many awake bodies. */
export function box3dThreading(pool: NativeWorldPool): Box3DThreading { return threadings.get(pool) ?? SINGLE; }

interface ThreadedModule {
  readonly wasmMemory?: WebAssembly.Memory;
  _b3w_threads_supported?(): number;
  _b3w_set_worker_count?(workers: number): number;
  _b3w_last_step_workers?(): number;
  _b3w_get_thread_threshold?(): number;
  _b3w_set_thread_threshold?(bodies: number): number;
}
/** Workers that cannot start would leave the module factory pending for ever. */
const THREADED_START_TIMEOUT_MS = 30000;

const isNode = !!(globalThis as {process?: {versions?: {node?: string}}}).process?.versions?.node;

// Keep URL construction in this literal form so bundlers (Vite, webpack 5,
// Rollup, esbuild with the asset plugin) detect, hash and emit both files.
const defaultModuleUrl = () => new URL('../wasm/box3d.js', import.meta.url);
const defaultWasmUrl = () => new URL('../wasm/box3d.wasm', import.meta.url);
const defaultThreadedModuleUrl = () => new URL('../wasm/box3d-mt.js', import.meta.url);
const defaultThreadedWasmUrl = () => new URL('../wasm/box3d-mt.wasm', import.meta.url);

async function readNodeFile(url: URL): Promise<Uint8Array> {
  // Indirect specifier keeps browser bundlers from trying to resolve node:fs.
  const fsName = 'node:fs/promises';
  const fs = await import(/* @vite-ignore */ fsName) as {readFile(path: URL): Promise<Uint8Array>};
  return fs.readFile(url);
}

/**
 * Instantiate the Box3D WebAssembly module and return a pool that can create
 * up to `pool.capacity` isolated worlds sharing that module's memory.
 * Call once per page/worker and reuse the pool.
 */
export async function loadBox3D(options: LoadBox3DOptions = {}): Promise<NativeWorldPool> {
  let module: unknown;
  const threads = options.threads ?? 1, threaded = threads > 1;
  if (!Number.isInteger(threads) || threads < 1 || threads > 32) throw new EngineError('INVALID_PAYLOAD', 'threads must be a whole number from 1 to 32.');
  if (options.threadThreshold !== undefined && !(Number.isInteger(options.threadThreshold) && options.threadThreshold >= 0 && options.threadThreshold <= 1_000_000)) throw new EngineError('INVALID_PAYLOAD', 'threadThreshold must be a whole number of bodies, 0 or more.');
  if (threaded) {
    const g = globalThis as {SharedArrayBuffer?: unknown; crossOriginIsolated?: boolean};
    if (typeof g.SharedArrayBuffer !== 'function') throw new EngineError('UNSUPPORTED_BACKEND', 'threads needs SharedArrayBuffer, which this environment does not have.');
    if (!isNode && g.crossOriginIsolated !== true) throw new EngineError('UNSUPPORTED_BACKEND', 'threads needs a cross-origin isolated page: serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let factory = options.factory;
    if (!factory) {
      const moduleUrl = String(options.moduleUrl ?? (threaded ? defaultThreadedModuleUrl() : defaultModuleUrl()));
      const imported = await import(/* @vite-ignore */ moduleUrl) as {default?: Box3DModuleFactory} | Box3DModuleFactory;
      factory = typeof imported === 'function' ? imported : imported.default;
      if (typeof factory !== 'function') throw new Error(`${moduleUrl} did not export an Emscripten module factory.`);
    }
    const wasmUrl = new URL(String(options.wasmUrl ?? (threaded ? defaultThreadedWasmUrl() : defaultWasmUrl())));
    let wasmBinary = options.wasmBinary;
    if (!wasmBinary && isNode && wasmUrl.protocol === 'file:') wasmBinary = await readNodeFile(wasmUrl);
    if (options.integrity) {
      if (!wasmBinary) {
        const response = await fetch(wasmUrl);
        if (!response.ok) throw new Error(`${wasmUrl.href}: HTTP ${response.status}`);
        wasmBinary = new Uint8Array(await response.arrayBuffer());
      }
      await verifyIntegrity(wasmBinary, typeof options.integrity === 'string' ? options.integrity : threaded ? BUILD_INFO.threadedWasmSha256 : BUILD_INFO.wasmSha256);
    }
    const source = wasmBinary ? {wasmBinary} : {locateFile: () => wasmUrl.href};
    if (!threaded) module = await factory(source);
    else {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the ${threads - 1} workers did not start within ${THREADED_START_TIMEOUT_MS} ms`)), THREADED_START_TIMEOUT_MS); });
      const mod = await Promise.race([factory({...source, b3wPoolSize: threads - 1}), timeout]) as ThreadedModule;
      if (mod._b3w_threads_supported?.() !== 1 || !mod._b3w_set_worker_count || !mod.wasmMemory) throw new EngineError('UNSUPPORTED_BACKEND', 'threads was asked for, but the module that loaded is not the pthread artifact (box3d-mt.js).');
      const accepted = mod._b3w_set_worker_count(threads);
      if (accepted !== threads) throw new EngineError('UNSUPPORTED_BACKEND', `the pthread artifact accepted ${accepted} of ${threads} threads.`);
      if (options.threadThreshold !== undefined) mod._b3w_set_thread_threshold?.(options.threadThreshold);
      // A worker can grow the shared memory, and the views the module made at start do not follow: read the live buffer.
      const memory = mod.wasmMemory;
      let buffer: ArrayBufferLike | undefined, view: Float32Array | undefined;
      module = Object.create(mod, {HEAPF32: {get(): Float32Array { if (memory.buffer !== buffer || !view) { buffer = memory.buffer; view = new Float32Array(buffer); } return view; }}});
      const pool = new NativeWorldPool(module);
      threadings.set(pool, Object.freeze({threads, threshold: mod._b3w_get_thread_threshold?.() ?? 384, lastStepThreads: () => mod._b3w_last_step_workers?.() ?? 1}));
      return pool;
    }
  } catch (error) {
    if (error instanceof EngineError) throw error;
    // Never fall back silently to a different physics implementation: report it.
    const failure = new EngineError('WASM_UNAVAILABLE', `Box3D WebAssembly could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    (failure as {cause?: unknown}).cause = error;
    throw failure;
  } finally { clearTimeout(timer); }
  return new NativeWorldPool(module);
}

async function verifyIntegrity(bytes: ArrayBuffer | Uint8Array, expected: string): Promise<void> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new EngineError('UNSUPPORTED_BACKEND', 'integrity checking needs crypto.subtle (a secure context).');
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = new Uint8Array(await subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>));
  const actual = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expected.toLowerCase()) throw new EngineError('INTEGRITY_MISMATCH', `box3d.wasm sha256 ${actual} does not match expected ${expected}.`);
}
