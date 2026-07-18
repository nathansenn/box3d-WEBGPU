'use strict';

/*
 * Exact three-way benchmark for allocation-free fallback contact resolution:
 *   1. archived v1.10;
 *   2. the immediately preceding current implementation reconstructed by
 *      replacing the scalar candidate with its allocating Vec3 method;
 *   3. the current scalar in-place candidate.
 *
 * Timed regions contain complete fallback steps, including broadphase,
 * contact resolution, bounds, transform/material synchronization, and hash
 * publication. Every sample copies and compares matrices, colors, internal
 * Float64 body state, replay hash, body counts, broadphase axis, and candidate
 * count before it contributes to statistics.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const outputPrefix = path.join(root, 'benchmarks/results/v111-fallback-pair-exact-gains');
const samples = Math.max(9, Number.parseInt(process.env.V111_PAIR_SAMPLES || '9', 10));
const timedFrames = Math.max(16, Number.parseInt(process.env.V111_PAIR_FRAMES || '24', 10));
const warmupFrames = Math.max(2, Number.parseInt(process.env.V111_PAIR_WARMUP || '4', 10));
const bootstraps = Math.max(2000, Number.parseInt(process.env.V111_PAIR_BOOTSTRAPS || '10000', 10));
const sceneIds = [49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 549, 599];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-fallback-pair-'));
const candidateBuild = path.join(temp, 'candidate');
const allocatingBuild = path.join(temp, 'allocating-control');
const archiveRoot = path.join(temp, 'archive');
const archiveBuild = path.join(archiveRoot, '.test-build');

const ALLOCATING_RESOLVER = `    resolveAabbPair(a, b) {
        const dx = b.pos[0] - a.pos[0];
        const px = a.half[0] + b.half[0] - Math.abs(dx);
        if (px <= 0)
            return;
        const dy = b.pos[1] - a.pos[1];
        const py = a.half[1] + b.half[1] - Math.abs(dy);
        if (py <= 0)
            return;
        const dz = b.pos[2] - a.pos[2];
        const pz = a.half[2] + b.half[2] - Math.abs(dz);
        if (pz <= 0)
            return;
        let normal = [Math.sign(dx) || 1, 0, 0];
        let penetration = px;
        if (py < penetration) {
            penetration = py;
            normal = [0, Math.sign(dy) || 1, 0];
        }
        if (pz < penetration) {
            penetration = pz;
            normal = [0, 0, Math.sign(dz) || 1];
        }
        const invMassSum = a.invMass + b.invMass;
        if (invMassSum <= 0)
            return;
        const correction = (penetration + 0.002) / invMassSum;
        if (a.dynamic)
            a.pos = sub(a.pos, scale(normal, correction * a.invMass));
        if (b.dynamic)
            b.pos = add(b.pos, scale(normal, correction * b.invMass));
        const relVel = sub(b.vel, a.vel);
        const vn = dot(relVel, normal);
        if (vn < 0) {
            const e = Math.min(a.restitution, b.restitution);
            const impulseMag = (-(1 + e) * vn) / invMassSum;
            const impulse = scale(normal, impulseMag);
            if (a.dynamic)
                a.vel = sub(a.vel, scale(impulse, a.invMass));
            if (b.dynamic)
                b.vel = add(b.vel, scale(impulse, b.invMass));
        }
        const friction = (0, math_1.clamp)((a.friction + b.friction) * 0.5, 0, 0.95);
        if (a.dynamic) {
            a.vel[0] *= 1 - friction * 0.01;
            a.vel[2] *= 1 - friction * 0.01;
            a.angVel[0] += this.rng.signed(0.02) * penetration;
            a.angVel[2] += this.rng.signed(0.02) * penetration;
            a.heat = Math.max(a.heat, (0, math_1.clamp)(penetration * 1.5, 0.1, 1));
        }
        if (b.dynamic) {
            b.vel[0] *= 1 - friction * 0.01;
            b.vel[2] *= 1 - friction * 0.01;
            b.angVel[0] += this.rng.signed(0.02) * penetration;
            b.angVel[2] += this.rng.signed(0.02) * penetration;
            b.heat = Math.max(b.heat, (0, math_1.clamp)(penetration * 1.5, 0.1, 1));
        }
    }
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

function writeCommonJs(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function prepare() {
  run(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(root, 'tsconfig.test.json'), '--outDir', candidateBuild], { cwd: root });
  writeCommonJs(candidateBuild);
  fs.cpSync(candidateBuild, allocatingBuild, { recursive: true });
  const controlFile = path.join(allocatingBuild, 'src/physics/fallback.js');
  let controlSource = fs.readFileSync(controlFile, 'utf8');
  const allocatingHelpers = `function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
`;
  assert.ok(controlSource.includes('class FallbackPhysicsBackend'), 'could not locate fallback class for allocating helpers');
  controlSource = controlSource.replace('class FallbackPhysicsBackend', `${allocatingHelpers}class FallbackPhysicsBackend`);
  const method = /    resolveAabbPair\(a, b\) \{[\s\S]*?\n    \}\n    getMatrixScale\(/;
  assert.ok(method.test(controlSource), 'could not locate compiled scalar contact resolver');
  controlSource = controlSource.replace(method, `${ALLOCATING_RESOLVER}    getMatrixScale(`);
  fs.writeFileSync(controlFile, controlSource);

  fs.mkdirSync(archiveRoot, { recursive: true });
  run('tar', ['-xzf', archive, '-C', archiveRoot]);
  const tsconfig = path.join(archiveRoot, 'tsconfig.json');
  if (!fs.existsSync(tsconfig)) {
    fs.writeFileSync(tsconfig, JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        skipLibCheck: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], noEmit: true,
      },
      include: ['src'],
    }, null, 2));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(archiveRoot, 'node_modules'), 'dir');
  run(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(archiveRoot, 'tsconfig.test.json')], { cwd: archiveRoot });
  writeCommonJs(archiveBuild);
}

function load(build, name) {
  return {
    name,
    Backend: require(path.join(build, 'src/physics/fallback.js')).FallbackPhysicsBackend,
    scenes: require(path.join(build, 'src/scenes.js')).SCENES,
  };
}

function capture(backend) {
  const count = backend.bodyCount();
  const matrixFloat = Number(backend._b3w_matrices_ptr()) / 4;
  const colorFloat = Number(backend._b3w_colors_ptr()) / 4;
  const matrixView = new Uint8Array(backend.HEAPF32.buffer, backend.HEAPF32.byteOffset + matrixFloat * 4, count * 64);
  const colorView = new Uint8Array(backend.HEAPF32.buffer, backend.HEAPF32.byteOffset + colorFloat * 4, count * 16);
  const bodyValues = [];
  for (const body of backend.bodies) {
    bodyValues.push(body.dynamic ? 1 : 0, ...body.pos, ...body.vel, ...body.rot, ...body.angVel, ...body.half, body.heat);
  }
  const bodyState = new Float64Array(bodyValues);
  return {
    count,
    dynamicCount: backend.dynamicCount(),
    hash: backend.replayHash() >>> 0,
    axis: backend.broadphaseAxis(),
    candidates: backend.broadphaseCandidateCount(),
    matrices: Buffer.from(matrixView),
    colors: Buffer.from(colorView),
    bodies: Buffer.from(new Uint8Array(bodyState.buffer, bodyState.byteOffset, bodyState.byteLength)),
  };
}

function assertExact(before, after, label) {
  for (const key of ['count', 'dynamicCount', 'hash', 'axis', 'candidates']) {
    assert.equal(after[key], before[key], `${label}: ${key}`);
  }
  for (const key of ['matrices', 'colors', 'bodies']) {
    assert.equal(Buffer.compare(after[key], before[key]), 0, `${label}: ${key}`);
  }
}

function execute(project, sceneId) {
  const backend = new project.Backend(4096);
  backend.createScene(project.scenes[sceneId], 5, (0xca1100 + sceneId) >>> 0);
  for (let frame = 0; frame < warmupFrames; frame++) backend.step(1 / 60, 4);
  const started = performance.now();
  for (let frame = 0; frame < timedFrames; frame++) backend.step(1 / 60, 4);
  const elapsedMs = performance.now() - started;
  const result = { elapsedMs, msPerFrame: elapsedMs / timedFrames, capture: capture(backend) };
  backend.destroy();
  return result;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function xorshift(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function bootstrapInterval(ratios) {
  const random = xorshift(0x711ca7);
  const estimates = new Float64Array(bootstraps);
  for (let sample = 0; sample < bootstraps; sample++) {
    let logSum = 0;
    for (let i = 0; i < ratios.length; i++) {
      logSum += Math.log(ratios[Math.floor(random() * ratios.length)]);
    }
    estimates[sample] = Math.exp(logSum / ratios.length);
  }
  estimates.sort();
  return {
    lower: estimates[Math.floor(bootstraps * 0.025)],
    upper: estimates[Math.min(bootstraps - 1, Math.floor(bootstraps * 0.975))],
  };
}

function benchmark(archiveProject, controlProject, candidateProject) {
  const records = [];
  const pairedRatios = [];
  for (let sceneIndex = 0; sceneIndex < sceneIds.length; sceneIndex++) {
    const sceneId = sceneIds[sceneIndex];
    const times = { archive: [], control: [], candidate: [] };
    for (let sample = 0; sample < samples; sample++) {
      const projects = [archiveProject, controlProject, candidateProject];
      const rotation = (sceneIndex + sample) % projects.length;
      const ordered = [...projects.slice(rotation), ...projects.slice(0, rotation)];
      const outputs = new Map();
      for (const project of ordered) outputs.set(project.name, execute(project, sceneId));
      const archiveResult = outputs.get(archiveProject.name);
      const controlResult = outputs.get(controlProject.name);
      const candidateResult = outputs.get(candidateProject.name);
      assertExact(controlResult.capture, candidateResult.capture, `control/candidate scene ${sceneId} sample ${sample}`);
      assertExact(archiveResult.capture, candidateResult.capture, `archive/candidate scene ${sceneId} sample ${sample}`);
      times.archive.push(archiveResult.msPerFrame);
      times.control.push(controlResult.msPerFrame);
      times.candidate.push(candidateResult.msPerFrame);
      pairedRatios.push(controlResult.msPerFrame / candidateResult.msPerFrame);
    }
    const archiveMedianMs = median(times.archive);
    const controlMedianMs = median(times.control);
    const candidateMedianMs = median(times.candidate);
    records.push({
      sceneId,
      title: candidateProject.scenes[sceneId].title,
      bodyCount: execute(candidateProject, sceneId).capture.count,
      candidateCount: execute(candidateProject, sceneId).capture.candidates,
      archiveMedianMs,
      controlMedianMs,
      candidateMedianMs,
      speedupVsControl: controlMedianMs / candidateMedianMs,
      speedupVsArchive: archiveMedianMs / candidateMedianMs,
      exact: true,
    });
  }
  const interval = bootstrapInterval(pairedRatios);
  const geometricMeanVsControl = geometricMean(records.map((record) => record.speedupVsControl));
  const geometricMeanVsArchive = geometricMean(records.map((record) => record.speedupVsArchive));
  const minimumSpeedupVsControl = Math.min(...records.map((record) => record.speedupVsControl));
  return {
    records,
    geometricMeanVsControl,
    geometricMeanVsArchive,
    minimumSpeedupVsControl,
    pairedBootstrap95: interval,
    accepted: interval.lower >= 1.02 && minimumSpeedupVsControl >= 0.98,
  };
}

function fingerprint() {
  const hash = crypto.createHash('sha256');
  for (const relative of ['src/physics/fallback.ts', 'src/math.ts', 'src/scenes.ts']) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return hash.digest('hex');
}

function markdown(result) {
  const benchmarkResult = result.benchmark;
  const lines = [
    '# v1.11 allocation-free fallback contact benchmark', '',
    `Candidate source: \`${result.sourceFingerprint}\` (stable: **${result.sourceStableDuringRun ? 'yes' : 'no'}**).`, '',
    `Archived baseline SHA-256: \`${result.archiveSha256}\`.`, '',
    `Configuration: ${result.samples} samples, ${result.warmupFrames} warm-up + ${result.timedFrames} timed complete frames per scene, ${result.bootstraps.toLocaleString()} bootstrap resamples.`, '',
    `Pre-edit control → scalar candidate geometric mean: **${benchmarkResult.geometricMeanVsControl.toFixed(4)}x**.`,
    `Paired bootstrap 95% interval: **${benchmarkResult.pairedBootstrap95.lower.toFixed(4)}-${benchmarkResult.pairedBootstrap95.upper.toFixed(4)}x**.`,
    `Archived v1.10 → scalar candidate geometric mean: **${benchmarkResult.geometricMeanVsArchive.toFixed(4)}x**.`,
    `Acceptance gate: **${benchmarkResult.accepted ? 'passed' : 'failed'}**.`, '',
    '| Scene | Bodies | Candidates | Pre-edit ms/frame | Scalar ms/frame | Speedup | v1.10 speedup |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const record of benchmarkResult.records) {
    lines.push(`| ${record.sceneId} ${record.title.replace(/\|/g, '\\|')} | ${record.bodyCount} | ${record.candidateCount} | ${record.controlMedianMs.toFixed(4)} | ${record.candidateMedianMs.toFixed(4)} | ${record.speedupVsControl.toFixed(4)}x | ${record.speedupVsArchive.toFixed(4)}x |`);
  }
  lines.push('', 'All timed samples were exact for matrices, colors, Float64 body state, replay hash, body counts, broadphase axis, and candidate count.');
  return `${lines.join('\n')}\n`;
}

try {
  const sourceFingerprintAtStart = fingerprint();
  prepare();
  const archiveProject = load(archiveBuild, 'archive');
  const controlProject = load(allocatingBuild, 'control');
  const candidateProject = load(candidateBuild, 'candidate');
  const benchmarkResult = benchmark(archiveProject, controlProject, candidateProject);
  const sourceFingerprintAtEnd = fingerprint();
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    archive: path.relative(root, archive),
    archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    sourceFingerprint: sourceFingerprintAtStart,
    sourceFingerprintAtEnd,
    sourceStableDuringRun: sourceFingerprintAtStart === sourceFingerprintAtEnd,
    samples,
    warmupFrames,
    timedFrames,
    bootstraps,
    exactComparisons: sceneIds.length * samples * 2,
    benchmark: benchmarkResult,
    passed: benchmarkResult.accepted && sourceFingerprintAtStart === sourceFingerprintAtEnd,
  };
  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, markdown(result));
  console.log(JSON.stringify({
    passed: result.passed,
    exactComparisons: result.exactComparisons,
    speedupVsControl: benchmarkResult.geometricMeanVsControl,
    lower95: benchmarkResult.pairedBootstrap95.lower,
    minimumSpeedup: benchmarkResult.minimumSpeedupVsControl,
    speedupVsArchive: benchmarkResult.geometricMeanVsArchive,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
