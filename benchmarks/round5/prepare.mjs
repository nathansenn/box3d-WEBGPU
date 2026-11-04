import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { emitTypeScriptModuleTree } from '../../scripts/emit-typescript-module-tree.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.resolve(process.argv[2] || path.join(repo, 'build/round5-bundle'));
if (!output.startsWith(repo + path.sep + 'build' + path.sep)) throw new Error('Bundle output must be under repository build/');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite bundle: ' + output);
fs.mkdirSync(output, { recursive: true });
const digest = b => createHash('sha256').update(b).digest('hex');
const files = [];
function copy(source, destination) {
  const bytes = fs.readFileSync(path.join(repo, source)), target = path.join(output, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  files.push({ source, destination, bytes: bytes.length, sha256: digest(bytes) });
}
copy('benchmarks/round5/gpu-100.mjs', 'gpu-100.mjs');
for (const file of ['hardware-runtime.mjs', 'statistics.mjs']) copy('benchmarks/round4/' + file, file);
for (const file of ['plan.mjs', 'producer-fixtures.mjs']) if (fs.existsSync(path.join(repo, 'benchmarks/round5', file))) copy('benchmarks/round5/' + file, file);
const source = fs.readFileSync(path.join(repo, 'src/webgpu/sparse-upload.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
fs.writeFileSync(path.join(output, 'sparse-upload.mjs'), compiled);
files.push({ source: 'src/webgpu/sparse-upload.ts', sourceSha256: digest(source), destination: 'sparse-upload.mjs', sha256: digest(compiled) });
const emitted = emitTypeScriptModuleTree({ sourceRoot: path.join(repo, 'src'), outputRoot: path.join(output, 'emitted'), entry: 'webgpu/renderer.ts' });
const math = emitTypeScriptModuleTree({ sourceRoot: path.join(repo, 'src'), outputRoot: path.join(output, 'emitted'), entry: 'math.ts' });
const tracker = emitTypeScriptModuleTree({ sourceRoot: path.join(repo, 'src'), outputRoot: path.join(output, 'emitted'), entry: 'webgpu/dirty-record-tracker.ts' });
emitted.files.push(...math.files, ...tracker.files);
for (const row of emitted.files) files.push({ source: path.relative(repo, row.sourcePath),
  sourceSha256: digest(fs.readFileSync(row.sourcePath)), destination: path.relative(output, row.outputPath),
  sha256: digest(fs.readFileSync(row.outputPath)) });
copy('public/box3d/box3d.js', 'native/box3d.js'); copy('public/box3d/box3d.wasm', 'native/box3d.wasm');
fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module"}\n');
const manifest = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(),
  node: process.version, typescript: ts.version, files };
fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, files: files.length, sourceManifestSha256: digest(JSON.stringify(manifest, null, 2) + '\n') }));
