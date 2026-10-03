// Builds dist/single.js: the whole kit (core, helpers) plus box3d.js and the
// WASM embedded as base64 in ONE ES module. Drop it on any static host or CDN
// and import it; nothing else needs to resolve. Larger (base64 adds ~33%),
// so prefer the regular entry when you use a bundler.
import {readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(pkg, '../../package.json'));
const {rolldown} = require('rolldown');

const work = join(pkg, 'build-single');
mkdirSync(work, {recursive: true});
const base64 = readFileSync(join(pkg, 'wasm/box3d.wasm')).toString('base64');
writeFileSync(join(work, 'entry.mjs'), `
import factory from '../wasm/box3d.js';
import {createWorld as createFromUrl, loadBox3D as loadFromUrl} from '../dist/index.js';
export * from '../dist/index.js';

const WASM_BASE64 = ${JSON.stringify(base64)};
let bytes = null;
/** The embedded box3d.wasm bytes (decoded once). */
export function embeddedWasm() {
  if (!bytes) { const text = atob(WASM_BASE64); bytes = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); }
  return bytes;
}
/** Same as the regular loadBox3D, but uses the embedded glue and WASM: no files to fetch. */
export function loadBox3D(options = {}) { return loadFromUrl({...options, factory: options.factory ?? factory, wasmBinary: options.wasmBinary ?? embeddedWasm()}); }
/** Same as the regular createWorld, with the embedded WASM. */
export function createWorld(options = {}) { return createFromUrl({...options, factory: options.factory ?? factory, wasmBinary: options.wasmBinary ?? embeddedWasm()}); }
`);

const bundle = await rolldown({input: join(work, 'entry.mjs'), platform: 'neutral', logLevel: 'warn', external: [/^node:/]});
const {output} = await bundle.generate({format: 'esm', codeSplitting: false, minify: true});
await bundle.close();
const chunks = output.filter(o => o.type === 'chunk');
if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.map(c => c.fileName).join(', ')}`);
const assets = output.filter(o => o.type === 'asset');
writeFileSync(join(pkg, 'dist/single.js'), `/*! box3d-webgpu-kit single-file build. Box3D (c) Erin Catto, MIT. */\n${chunks[0].code}`);
rmSync(work, {recursive: true, force: true});
console.log(`wrote dist/single.js (${(chunks[0].code.length / 1024).toFixed(0)} KiB${assets.length ? `; ignored ${assets.length} asset(s): ${assets.map(a => a.fileName).join(', ')}` : ''})`);
