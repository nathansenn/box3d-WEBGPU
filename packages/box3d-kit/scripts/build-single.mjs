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

// dist/flow-bundle.js: the flow entry (box3d-webgpu-kit/flow) as one ES module with no imports and no WebAssembly, to
// vendor with provenance. The header and FLOW_SOURCE_COMMIT name the package version and the commit it was built from.
{
  const {spawnSync} = await import('node:child_process');
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: pkg, encoding: 'utf8'});
  const commit = git.status === 0 ? git.stdout.trim() : null;
  const dirty = commit ? spawnSync('git', ['status', '--porcelain', '--', '.', '../../src/engine'], {cwd: pkg, encoding: 'utf8'}).stdout.trim() !== '' : false;
  mkdirSync(work, {recursive: true});
  writeFileSync(join(work, 'flow-entry.mjs'), `export * from '../dist/flow.js';\nexport const FLOW_SOURCE_COMMIT = ${JSON.stringify(commit ? commit + (dirty ? '+modified' : '') : null)};\n`);
  const flowBundle = await rolldown({input: join(work, 'flow-entry.mjs'), platform: 'neutral', logLevel: 'warn'});
  const {output: flowOutput} = await flowBundle.generate({format: 'esm', codeSplitting: false, minify: false});
  await flowBundle.close();
  const flowChunks = flowOutput.filter(o => o.type === 'chunk');
  if (flowChunks.length !== 1) throw new Error(`flow bundle: expected one chunk, got ${flowChunks.map(c => c.fileName).join(', ')}`);
  if (/^\s*import\s/m.test(flowChunks[0].code)) throw new Error('flow bundle: the bundle still imports a module.');
  writeFileSync(join(pkg, 'dist/flow-bundle.js'), `/*! box3d-webgpu-kit ${version} flow bundle (box3d-webgpu-kit/flow in one ES module). Source commit ${commit ?? 'unknown'}${dirty ? ' with local changes' : ''}. MIT. See docs/FLOW.md. */\n${flowChunks[0].code}`);
  writeFileSync(join(pkg, 'dist/flow-bundle.d.ts'), `export * from './flow.js';\n/** The commit the bundle was built from ("+modified" when the sources had local changes), or null. */\nexport declare const FLOW_SOURCE_COMMIT: string | null;\n`);
  rmSync(work, {recursive: true, force: true});
  console.log(`wrote dist/flow-bundle.js (${(flowChunks[0].code.length / 1024).toFixed(0)} KiB)`);
}
