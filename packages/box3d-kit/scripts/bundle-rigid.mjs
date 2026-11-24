// Packs the modules that `import 'box3d-webgpu-kit'` loads into two files, dist/rigid.js and dist/shared.js.
//
// tsc emits one file per source module, and the main entry reached 18 of them (302,742 bytes). In a fresh Node process
// that import took 15 to 20 ms: each file costs a resolve, a read and a compile, and V8 reads every byte, comments
// included. After this step the main entry loads three files: dist/index.js (a list of re-exports), dist/rigid.js (the
// modules only the rigid world needs) and dist/shared.js (the modules below that other entries share). Every module that
// went into a chunk keeps its file, now a list of re-exports of that chunk, so `box3d-webgpu-kit/gameplay`, a deep import,
// a solver entry and the main entry all get the same PhysicsWorld, the same EngineError and the same module state.
// Comments and indentation are removed (one statement per line), and parameters and local variables get short names.
// The names of functions, classes, methods and exports stay, and so do stack traces and `constructor.name`; the script
// checks that every exported function and class keeps its `name`.
//
// Run by `npm run build` after tsc and before build-single.mjs. The .d.ts files are tsc's and are not touched.
import {readFileSync, readdirSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist');
const require = createRequire(join(pkg, '../../package.json'));
const {rolldown} = require('rolldown');
const {parseAst} = require('rolldown/parseAst');

/** The file the bundled modules become. Not an entry of package.json: nothing imports it by name. */
const CHUNK = 'rigid.js';
/**
 * Modules of the main entry that entries which must not load the rigid world import too: the solvers (./heat, ./solid,
 * ...) import the error table and the checkpoint codec, and the page side of ./worker imports the shared frames while the
 * engine runs in the worker. They go into a chunk of their own, which never imports rigid.js.
 */
const SHARED = ['core/contracts.js', 'core/checkpoint.js', 'shared-frames.js'];
const SHARED_CHUNK = 'shared.js';

const posix = file => file.replace(/\\/g, '/');
const staticImports = file => [...readFileSync(join(dist, file), 'utf8').matchAll(/(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
  .map(match => posix(relative(dist, resolve(dist, dirname(file), match[1]))));
function closureOf(entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) { const file = queue.pop(); if (seen.has(file)) continue; seen.add(file); queue.push(...staticImports(file)); }
  return seen;
}

const closure = closureOf('index.js');
for (const file of SHARED) if (!closure.has(file)) throw new Error(`bundle-rigid: ${file} is listed as shared but the main entry no longer loads it`);
const bundled = [...closure].filter(file => !SHARED.includes(file)).sort();
for (const chunk of [CHUNK, SHARED_CHUNK]) if (closure.has(chunk)) throw new Error(`bundle-rigid: dist/${chunk} already exists as a module`);
for (const file of SHARED) for (const target of staticImports(file)) {
  if (!SHARED.includes(target)) throw new Error(`bundle-rigid: the shared module dist/${file} imports dist/${target}, which is not shared`);
}

// A module outside the main entry that imports a bundled module now loads all of rigid.js. That is only acceptable when it
// loaded the rigid world before; anything else belongs in SHARED.
const all = readdirSync(dist, {recursive: true}).map(file => posix(String(file))).filter(file => file.endsWith('.js'));
for (const file of all) {
  if (closure.has(file)) continue;
  const direct = staticImports(file).filter(target => bundled.includes(target));
  if (direct.length && !closureOf(file).has('core/native-world.js')) {
    throw new Error(`bundle-rigid: dist/${file} imports ${direct.join(', ')} but not the rigid world; add ${direct.join(', ')} to SHARED in scripts/bundle-rigid.mjs`);
  }
}

// What every module exports before the bundle, to compare with what its replacement exports.
const chunked = [...bundled, ...SHARED];
const exportsBefore = new Map(), namesBefore = new Map(), sharedWithIndex = [];
const indexBefore = await import(pathToFileURL(join(dist, 'index.js')).href);
const functionNames = module => Object.entries(module).filter(([, value]) => typeof value === 'function').map(([key, value]) => `${key}:${value.name}`).sort().join(' ');
for (const file of chunked) {
  const before = await import(pathToFileURL(join(dist, file)).href);
  exportsBefore.set(file, Object.keys(before).sort());
  namesBefore.set(file, functionNames(before));
  for (const name of Object.keys(before)) if (name in indexBefore && before[name] === indexBefore[name]) sharedWithIndex.push([file, name]);
}
const sourceText = bundled.map(file => readFileSync(join(dist, file), 'utf8')).join('\n');
const bytesBefore = [...closure].reduce((sum, file) => sum + readFileSync(join(dist, file)).length, 0);

const bundle = await rolldown({
  input: Object.fromEntries(chunked.map(file => [file.replace(/\.js$/, ''), join(dist, file)])),
  platform: 'neutral',
  logLevel: 'warn',
  // Every re-export file exports exactly what its module exported.
  preserveEntrySignatures: 'strict',
  external: id => /^node:/.test(id),
  // loader.ts imports node:fs/promises through a variable so that browser bundlers do not try to resolve it. Inlining the
  // constant would put the literal back.
  optimization: {inlineConst: false},
});
const {output} = await bundle.generate({
  format: 'esm',
  dir: dist,
  entryFileNames: '[name].js',
  chunkFileNames: '[name].js',
  codeSplitting: {groups: [
    {name: SHARED_CHUNK.replace(/\.js$/, ''), test: id => SHARED.includes(posix(relative(dist, id))), priority: 2},
    {name: CHUNK.replace(/\.js$/, ''), test: /./, priority: 1},
  ]},
  // Short names for parameters and locals; `keepNames` leaves the names of functions and classes (and so stack traces).
  // No `compress`: it would fold the node:fs indirection of loader.ts and rewrite statements.
  minify: {compress: false, mangle: {keepNames: true}, codegen: {removeWhitespace: true}},
});
await bundle.close();

const chunks = output.filter(item => item.type === 'chunk');
const stray = output.filter(item => item.type !== 'chunk').map(item => item.fileName);
if (stray.length) throw new Error(`bundle-rigid: unexpected assets ${stray.join(', ')}`);
const expected = [...chunked, CHUNK, SHARED_CHUNK].sort().join(' '), written = chunks.map(chunk => posix(chunk.fileName)).sort().join(' ');
if (expected !== written) throw new Error(`bundle-rigid: expected ${expected}\n  got ${written}`);

/**
 * A line break before every statement of a block and every member of a class. The generated code is one line; Node prints
 * the whole line of an uncaught error's origin, and a stack trace is easier to read with one statement per line. The breaks
 * go only between syntax nodes, and the result must parse to the same tree.
 */
function breakLines(code) {
  const shape = text => JSON.stringify(parseAst(text, {sourceType: 'module'}), (key, value) => (key === 'start' || key === 'end' ? undefined : typeof value === 'bigint' ? `${value}n` : value));
  const cuts = new Set();
  const visit = node => {
    if (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock' || node.type === 'ClassBody') for (const child of node.body) cuts.add(child.start);
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) { for (const item of value) if (item && typeof item.type === 'string') visit(item); }
      else if (value && typeof value.type === 'string') visit(value);
    }
  };
  visit(parseAst(code, {sourceType: 'module'}));
  let out = '', last = 0;
  for (const at of [...cuts].sort((a, b) => a - b)) {
    if (at === 0 || code[at - 1] === '\n') continue;
    out += `${code.slice(last, at)}\n`;
    last = at;
  }
  out += code.slice(last);
  if (shape(out) !== shape(code)) throw new Error('bundle-rigid: the line breaks changed the syntax tree');
  return out;
}

for (const chunk of chunks) {
  let code = chunk.code;
  if (posix(chunk.fileName) === SHARED_CHUNK) {
    code = breakLines(code);
    if (/\bfrom\s*["']\.\/rigid\.js["']/.test(code)) throw new Error(`bundle-rigid: dist/${SHARED_CHUNK} imports dist/${CHUNK}`);
    code = `/*! box3d-webgpu-kit: the error table, the checkpoint codec and the shared frames in one module, for every entry. Built by scripts/bundle-rigid.mjs from the modules that now re-export it. */\n${code}`;
  } else if (posix(chunk.fileName) === CHUNK) {
    code = breakLines(code);
    // Bundlers find `new URL('<literal>', import.meta.url)` to copy and hash the WebAssembly; keep the plain string literal.
    code = code.replace(/new URL\(`([^`$\\]+)`,\s*import\.meta\.url\)/g, 'new URL("$1",import.meta.url)');
    // The two dynamic imports take a variable on purpose; without the comment Vite warns that it cannot analyse them.
    code = code.replace(/\bimport\((?![`'"]|\/\*)/g, 'import(/* @vite-ignore */');
    const urls = (code.match(/new URL\("\.\.\/wasm\/box3d(?:-mt)?\.(?:js|wasm)",import\.meta\.url\)/g) ?? []).length;
    const ignored = (code.match(/import\(\/\* @vite-ignore \*\//g) ?? []).length;
    const wantedUrls = (sourceText.match(/new URL\('\.\.\/wasm\/box3d(?:-mt)?\.(?:js|wasm)', import\.meta\.url\)/g) ?? []).length;
    const wantedIgnored = (sourceText.match(/import\(\/\* @vite-ignore \*\//g) ?? []).length;
    if (urls !== wantedUrls || wantedUrls < 4) throw new Error(`bundle-rigid: ${urls} of ${wantedUrls} WebAssembly URLs kept their literal form`);
    if (ignored !== wantedIgnored) throw new Error(`bundle-rigid: ${ignored} of ${wantedIgnored} dynamic imports kept @vite-ignore: ${(code.match(/.{0,60}\bimport\(.{0,60}/g) ?? []).join(' | ')}`);
    if (/import\(\s*(?:\/\*[^*]*\*\/\s*)?[`'"]node:/.test(code)) throw new Error('bundle-rigid: the node:fs import lost its indirection');
    code = `/*! box3d-webgpu-kit: the rigid world (loader, PhysicsWorld, native bridge, helpers) in one module. Built by scripts/bundle-rigid.mjs from the modules that now re-export it. */\n${code}`;
  } else {
    const target = /from\s*["']\.(?:\.)?\/(?:\.\.\/)*shared\.js["']/.test(code) && !/rigid\.js["']/.test(code) ? SHARED_CHUNK : CHUNK;
    code = `// Re-exports dist/${target}, which holds this module's code (scripts/bundle-rigid.mjs).\n${code}`;
  }
  mkdirSync(dirname(join(dist, chunk.fileName)), {recursive: true});
  writeFileSync(join(dist, chunk.fileName), code);
}

// Same exports as before, and the same objects whichever file is imported.
const indexAfter = await import(`${pathToFileURL(join(dist, 'index.js')).href}?bundled`);
const after = new Map();
for (const file of chunked) {
  after.set(file, await import(`${pathToFileURL(join(dist, file)).href}?bundled`));
  const names = Object.keys(after.get(file)).sort();
  if (names.join(' ') !== exportsBefore.get(file).join(' ')) throw new Error(`bundle-rigid: dist/${file} exported ${exportsBefore.get(file).join(' ')}\n  and now exports ${names.join(' ')}`);
  if (functionNames(after.get(file)) !== namesBefore.get(file)) throw new Error(`bundle-rigid: a function or class exported by dist/${file} lost its name:\n  ${namesBefore.get(file)}\n  ${functionNames(after.get(file))}`);
}
// The solver entries load the shared chunk and never the rigid world.
for (const file of SHARED) if (closureOf(file).has(CHUNK)) throw new Error(`bundle-rigid: dist/${file} now loads dist/${CHUNK}`);
for (const [file, name] of sharedWithIndex) {
  if (after.get(file)[name] !== indexAfter[name]) throw new Error(`bundle-rigid: ${name} from dist/${file} is no longer the object the main entry exports`);
}
const closureAfter = closureOf('index.js');
const bytesAfter = [...closureAfter].reduce((sum, file) => sum + readFileSync(join(dist, file)).length, 0);
console.log(`bundled ${bundled.length} modules into dist/${CHUNK} and ${SHARED.length} into dist/${SHARED_CHUNK}: the main entry loads ${closureAfter.size} files (${bytesAfter} bytes) instead of ${closure.size} (${bytesBefore} bytes)`);
