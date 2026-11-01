#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { emitTypeScriptModuleTree } from '../../scripts/emit-typescript-module-tree.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselineCommit = '031724b8501b194d2da770eeb5f407a3520cb311';
const args = process.argv.slice(2), arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const build = path.join(root, '.bench-build/rendering');
const expected = JSON.parse(fs.readFileSync(new URL('./baseline-sources.json', import.meta.url), 'utf8'));
const baselineRoot = arg('--baseline-root') ? path.resolve(arg('--baseline-root')) : path.join(build, 'baseline-source');
fs.mkdirSync(build, { recursive: true });
if (!arg('--baseline-root'))
    for (const item of expected.files) {
        const bytes = execFileSync('git', ['show', `${baselineCommit}:${item.path}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
        const destination = path.join(baselineRoot, item.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes);
    }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
for (const item of expected.files) {
    const actual = gitBlob(fs.readFileSync(path.join(baselineRoot, item.path)));
    if (actual !== item.gitBlobSha)
        throw new Error(`Baseline mismatch ${item.path}: ${actual} !== ${item.gitBlobSha}`);
}
const provenance = { schemaVersion: 1, baselineCommit, baselineGitBlobVerification: 'PASSED', compiler: 'TypeScript transpileModule ES2022; independent runtime dependency trees; no shader/source substitutions', baseline: {}, candidate: {}, harness: {}, assets: {} };
for (const [kind, sourceRoot] of [['baseline', baselineRoot], ['candidate', root]]) {
    const files = new Map();
    for (const entry of ['src/webgpu/renderer.ts', 'src/math.ts', 'src/webgpu/water-compute.ts', 'src/soft/water-reference.ts']) {
        const emitted = emitTypeScriptModuleTree({ sourceRoot, outputRoot: path.join(build, kind), entry });
        for (const file of emitted.files)
            files.set(file.sourcePath, file.outputPath);
    }
    for (const [source, output] of files) {
        const name = path.relative(sourceRoot, source).split(path.sep).join('/');
        provenance[kind][name] = { sourceSha256: sha256(fs.readFileSync(source)), emittedSha256: sha256(fs.readFileSync(output)) };
    }
}
for (const name of fs.readdirSync(path.join(root, 'benchmarks/rendering')).filter(n => /\.(mjs|html|json)$/.test(n)))
    provenance.harness[name] = sha256(fs.readFileSync(path.join(root, 'benchmarks/rendering', name)));
for (const name of fs.readdirSync(path.join(root, 'public/textures')).filter(n => n.endsWith('.ktx2')))
    provenance.assets[name] = sha256(fs.readFileSync(path.join(root, 'public/textures', name)));
fs.writeFileSync(path.join(build, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify({ build, baselineCommit, baselineFiles: Object.keys(provenance.baseline).length, candidateFiles: Object.keys(provenance.candidate).length }));
