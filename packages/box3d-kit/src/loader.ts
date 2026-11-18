import {NativeWorldPool} from './core/native-world.js';
import {EngineError} from './core/contracts.js';
import {BUILD_INFO} from './core/build-info.js';

/** Emscripten MODULARIZE/EXPORT_ES6 factory exported by box3d.js. */
export type Box3DModuleFactory = (options?: {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
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
}

const isNode = !!(globalThis as {process?: {versions?: {node?: string}}}).process?.versions?.node;

// Keep URL construction in this literal form so bundlers (Vite, webpack 5,
// Rollup, esbuild with the asset plugin) detect, hash and emit both files.
const defaultModuleUrl = () => new URL('../wasm/box3d.js', import.meta.url);
const defaultWasmUrl = () => new URL('../wasm/box3d.wasm', import.meta.url);

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
  try {
    let factory = options.factory;
    if (!factory) {
      const moduleUrl = String(options.moduleUrl ?? defaultModuleUrl());
      const imported = await import(/* @vite-ignore */ moduleUrl) as {default?: Box3DModuleFactory} | Box3DModuleFactory;
      factory = typeof imported === 'function' ? imported : imported.default;
      if (typeof factory !== 'function') throw new Error(`${moduleUrl} did not export an Emscripten module factory.`);
    }
    const wasmUrl = new URL(String(options.wasmUrl ?? defaultWasmUrl()));
    let wasmBinary = options.wasmBinary;
    if (!wasmBinary && isNode && wasmUrl.protocol === 'file:') wasmBinary = await readNodeFile(wasmUrl);
    if (options.integrity) {
      if (!wasmBinary) {
        const response = await fetch(wasmUrl);
        if (!response.ok) throw new Error(`${wasmUrl.href}: HTTP ${response.status}`);
        wasmBinary = new Uint8Array(await response.arrayBuffer());
      }
      await verifyIntegrity(wasmBinary, typeof options.integrity === 'string' ? options.integrity : BUILD_INFO.wasmSha256);
    }
    module = await factory(wasmBinary ? {wasmBinary} : {locateFile: () => wasmUrl.href});
  } catch (error) {
    if (error instanceof EngineError) throw error;
    // Never fall back silently to a different physics implementation: report it.
    const failure = new EngineError('WASM_UNAVAILABLE', `Box3D WebAssembly could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    (failure as {cause?: unknown}).cause = error;
    throw failure;
  }
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
