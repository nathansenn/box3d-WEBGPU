#!/usr/bin/env node
// Production build comparison between two source trees: vite build wall time (alternating rounds) and the emitted
// files' raw, gzip (level 9) and brotli (quality 11) sizes, with the JavaScript and CSS a first visit to each HTML
// entry downloads (its module script plus modulepreload and stylesheet links).
// usage: node benchmarks/merge-20261101/build-size.mjs --baseline <tree> --candidate <tree> [--rounds 3] [--work <dir>] [--out f]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, environment, gitInfo, ratioOfMedians, sha256File } from './stats.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const trees = { baseline: path.resolve(opt('--baseline')), candidate: path.resolve(opt('--candidate')) };
const rounds = Number(opt('--rounds', 3));
const work = path.resolve(opt('--work', fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-build-size-'))));
const out = path.resolve(opt('--out', path.join(root, 'benchmarks/merge-20261101/results/build-size.json')));

function build(which, r) {
  const outDir = path.join(work, `${which}-${r}`);
  const t0 = performance.now();
  const res = spawnSync(path.join(trees[which], 'node_modules/.bin/vite'), ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'],
    { cwd: trees[which], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'production' } });
  const ms = performance.now() - t0;
  if (res.status !== 0) throw new Error(`${which} build failed: ${res.stderr}`);
  return { ms, outDir };
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

function measure(outDir) {
  const files = walk(outDir).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(outDir, name));
    const ext = path.extname(name).slice(1).toLowerCase();
    const textual = ['js', 'mjs', 'css', 'html', 'json', 'svg', 'wasm', 'txt', 'xml'].includes(ext);
    return {
      name, ext, raw: bytes.length,
      gzip: textual ? zlib.gzipSync(bytes, { level: 9 }).length : null,
      brotli: textual ? zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length : null,
    };
  });
  const group = (pred) => files.filter(pred).reduce((a, f) => ({ files: a.files + 1, raw: a.raw + f.raw, gzip: a.gzip + (f.gzip ?? f.raw), brotli: a.brotli + (f.brotli ?? f.raw) }), { files: 0, raw: 0, gzip: 0, brotli: 0 });
  const entries = {};
  for (const html of files.filter((f) => f.ext === 'html')) {
    const text = fs.readFileSync(path.join(outDir, html.name), 'utf8');
    const refs = new Set();
    for (const m of text.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) refs.add(m[1]);
    for (const m of text.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet)"[^>]+href="([^"]+)"/g)) refs.add(m[1]);
    const initial = [...refs].map((ref) => ref.replace(/^\.?\//, '').replace(/^.*?assets\//, 'assets/')).map((n) => files.find((f) => f.name === n)).filter(Boolean);
    entries[html.name] = {
      html: { raw: html.raw, gzip: html.gzip, brotli: html.brotli },
      initialFiles: initial.map((f) => f.name),
      initialJsCss: initial.reduce((a, f) => ({ raw: a.raw + f.raw, gzip: a.gzip + f.gzip, brotli: a.brotli + f.brotli }), { raw: 0, gzip: 0, brotli: 0 }),
    };
  }
  return {
    totals: {
      all: group(() => true),
      javascript: group((f) => f.ext === 'js' || f.ext === 'mjs'),
      css: group((f) => f.ext === 'css'),
      wasm: group((f) => f.ext === 'wasm'),
      html: group((f) => f.ext === 'html'),
      images: group((f) => ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg', 'ktx2'].includes(f.ext)),
      models: group((f) => ['glb', 'gltf', 'bin'].includes(f.ext)),
      video: group((f) => ['webm', 'mp4'].includes(f.ext)),
    },
    entries,
    javascriptFiles: files.filter((f) => f.ext === 'js' || f.ext === 'mjs').sort((a, b) => b.raw - a.raw),
    fileCount: files.length,
  };
}

const times = { baseline: [], candidate: [] };
let last = {};
for (let r = 0; r < rounds; r++) {
  const order = r % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const which of order) {
    const b = build(which, r);
    times[which].push(b.ms);
    last[which] = b.outDir;
    console.log(`[build] round ${r} ${which} ${(b.ms / 1000).toFixed(2)} s`);
  }
}
const sizes = { baseline: measure(last.baseline), candidate: measure(last.candidate) };
const versions = Object.fromEntries(Object.entries(trees).map(([k, dir]) => [k, JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/vite/package.json'), 'utf8')).version]));
const result = {
  title: 'Production build: main vs merged',
  method: { rounds, order: 'alternating', command: 'vite build --outDir <scratch> --emptyOutDir', compression: 'gzip level 9, brotli quality 11 (zlib)' },
  environment: environment(),
  trees: Object.fromEntries(Object.entries(trees).map(([k, dir]) => [k, { dir, git: gitInfo(dir), vite: versions[k] }])),
  harness: { git: gitInfo(root), sha256: sha256File(fileURLToPath(import.meta.url)) },
  buildSeconds: { baseline: describe(times.baseline.map((v) => v / 1000)), candidate: describe(times.candidate.map((v) => v / 1000)), speedRatio: ratioOfMedians(times.baseline, times.candidate) },
  sizes,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
for (const which of ['baseline', 'candidate']) {
  const t = sizes[which].totals;
  console.log(`${which}: files ${sizes[which].fileCount}, all ${(t.all.raw / 1e6).toFixed(2)} MB, js ${(t.javascript.raw / 1e3).toFixed(0)} kB (br ${(t.javascript.brotli / 1e3).toFixed(0)} kB), css ${(t.css.raw / 1e3).toFixed(0)} kB, wasm ${(t.wasm.raw / 1e3).toFixed(0)} kB`);
  for (const [name, e] of Object.entries(sizes[which].entries)) console.log(`   ${name}: initial JS+CSS ${(e.initialJsCss.raw / 1e3).toFixed(0)} kB raw, ${(e.initialJsCss.brotli / 1e3).toFixed(0)} kB brotli (${e.initialFiles.length} files)`);
}
console.log(`wrote ${out}`);
