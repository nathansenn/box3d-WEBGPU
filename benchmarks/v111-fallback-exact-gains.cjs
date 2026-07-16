'use strict';

/*
 * Isolates two exact fallback-backend gains that the broader 100-case suite
 * intentionally measures only as part of complete frames:
 *   1. one-time static transform and material construction;
 *   2. allocation-free, broad-rejected explosion impulses.
 *
 * The static-transform control is generated from the candidate build by
 * restoring the legacy every-body matrix/material writes. The explosion control is the
 * exact archived v1.10 source. Timed samples alternate order and every final
 * matrix/color/hash stream must match exactly.
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
const outputPrefix = path.join(root, 'benchmarks/results/v111-fallback-exact-gains');
const samples = Math.max(5, Number.parseInt(process.env.V111_FALLBACK_SAMPLES || '9', 10));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-fallback-exact-'));
const currentBuild = path.join(temp, 'current');
const legacySyncBuild = path.join(temp, 'legacy-sync');
const baselineRoot = path.join(temp, 'baseline');
const baselineBuild = path.join(baselineRoot, '.test-build');
const sceneIds = [49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 549, 599, 190, 240, 290];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}

function writeCommonJs(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function prepare() {
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(root, 'tsconfig.test.json'),
    '--outDir', currentBuild,
  ], { cwd: root });
  writeCommonJs(currentBuild);

  fs.cpSync(currentBuild, legacySyncBuild, { recursive: true });
  const legacyFile = path.join(legacySyncBuild, 'src/physics/fallback.js');
  let legacySource = fs.readFileSync(legacyFile, 'utf8');
  const optimized = /\s*\/\/ Static bodies never change or accumulate collision heat\.[\s\S]*?if \(!body\.dynamic\)\s*continue;/;
  const match = legacySource.match(optimized);
  assert.ok(match, 'could not locate the optimized static matrix/material guard');
  legacySource = legacySource.replace(optimized, '');
  fs.writeFileSync(legacyFile, legacySource);

  fs.mkdirSync(baselineRoot, { recursive: true });
  run('tar', ['-xzf', archive, '-C', baselineRoot]);
  const baseTsconfig = path.join(baselineRoot, 'tsconfig.json');
  if (!fs.existsSync(baseTsconfig)) {
    fs.writeFileSync(baseTsconfig, JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        skipLibCheck: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], noEmit: true,
      },
      include: ['src'],
    }, null, 2));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(baselineRoot, 'node_modules'), 'dir');
  run(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(baselineRoot, 'tsconfig.test.json')], { cwd: baselineRoot });
  writeCommonJs(baselineBuild);
}

function load(build) {
  return {
    Backend: require(path.join(build, 'src/physics/fallback.js')).FallbackPhysicsBackend,
    scenes: require(path.join(build, 'src/scenes.js')).SCENES,
  };
}

function create(project, sceneId) {
  const backend = new project.Backend(4096);
  backend.createScene(project.scenes[sceneId], 5, 0x111000 + sceneId);
  return backend;
}

function capture(backend) {
  const count = backend.bodyCount();
  const matrixOffset = Number(backend._b3w_matrices_ptr()) / 4;
  const colorOffset = Number(backend._b3w_colors_ptr()) / 4;
  const matrixBytes = new Uint8Array(
    backend.HEAPF32.buffer,
    backend.HEAPF32.byteOffset + matrixOffset * 4,
    count * 64,
  );
  const colorBytes = new Uint8Array(
    backend.HEAPF32.buffer,
    backend.HEAPF32.byteOffset + colorOffset * 4,
    count * 16,
  );
  return {
    // Buffer.from(Uint8Array) copies bytes. Do not replace this with the
    // ArrayBuffer overload, which would alias the live fallback heap and turn
    // paired comparisons into false positives after subsequent mutations.
    matrices: Buffer.from(matrixBytes),
    colors: Buffer.from(colorBytes),
    hash: backend.replayHash() >>> 0,
    count,
  };
}

function sourceFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const relative of ['src/physics/fallback.ts', 'src/math.ts', 'src/scenes.ts']) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return hash.digest('hex');
}

function captureBodyState(backend) {
  const values = [];
  for (const body of backend.bodies) {
    values.push(
      body.dynamic ? 1 : 0,
      ...body.pos,
      ...body.vel,
      ...body.rot,
      ...body.angVel,
      ...body.half,
      ...body.color,
      body.mass,
      body.invMass,
      body.friction,
      body.restitution,
      body.heat,
    );
  }
  const state = new Float64Array(values);
  return Buffer.from(new Uint8Array(state.buffer, state.byteOffset, state.byteLength));
}

function nextAfter(value, direction) {
  if (Number.isNaN(value) || value === direction) return direction;
  if (value === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const storage = new ArrayBuffer(8);
  const view = new DataView(storage);
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits += (direction > value) === (value > 0) ? 1n : -1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function explosionBoundaryAudit(baseline, current) {
  const radius = 5;
  const cases = [
    {
      name: 'zero-axis-diagonal-and-adjacent-boundary',
      radius,
      center: [0, 0, 0],
      points: [
        [0, 0, 0],
        [1e-8, 0, 0],
        [1e-7, 0, 0],
        [3, 4, 0],
        [radius, 0, 0],
        [nextAfter(radius, Number.NEGATIVE_INFINITY), 0, 0],
        [nextAfter(radius, Number.POSITIVE_INFINITY), 0, 0],
        [radius + 1e-5, 0, 0],
      ],
    },
    {
      name: 'minimum-radius-clamp',
      radius: 0,
      center: [2, -3, 4],
      points: [[2, -3, 4], [3, -3, 4], [nextAfter(3, Number.POSITIVE_INFINITY), -3, 4]],
    },
    {
      name: 'large-finite-radius',
      radius: 1e150,
      center: [0, 0, 0],
      points: [[0, 0, 0], [6e149, 8e149, 0], [nextAfter(1e150, Number.POSITIVE_INFINITY), 0, 0], [1e200, 0, 0]],
    },
  ];

  const records = [];
  for (const test of cases) {
    const runCase = (project) => {
      const backend = new project.Backend(64);
      for (const point of test.points) {
        backend.launchProjectile(point[0], point[1], point[2], 0, 0, 0, 0.5);
      }
      backend.explode(test.center[0], test.center[1], test.center[2], 13, test.radius);
      backend.syncTransforms();
      const result = { stream: capture(backend), bodies: captureBodyState(backend) };
      backend.destroy();
      return result;
    };
    const before = runCase(baseline);
    const after = runCase(current);
    assertCaptureEqual(before.stream, after.stream, `explosion boundary ${test.name}`);
    assert.equal(Buffer.compare(before.bodies, after.bodies), 0, `explosion boundary ${test.name}: body state`);
    records.push({ name: test.name, points: test.points.length, exact: true });
  }
  return records;
}

function captureDetachmentAudit(project) {
  const backend = create(project, sceneIds[0]);
  const captured = capture(backend);
  const matrixSnapshot = Buffer.from(captured.matrices);
  const colorSnapshot = Buffer.from(captured.colors);
  const matrixFloat = Number(backend._b3w_matrices_ptr()) / 4;
  const colorFloat = Number(backend._b3w_colors_ptr()) / 4;
  backend.HEAPF32[matrixFloat] += 17;
  backend.HEAPF32[colorFloat] += 0.25;
  assert.equal(Buffer.compare(captured.matrices, matrixSnapshot), 0, 'captured matrices alias the live heap');
  assert.equal(Buffer.compare(captured.colors, colorSnapshot), 0, 'captured colors alias the live heap');
  const live = capture(backend);
  assert.notEqual(Buffer.compare(live.matrices, captured.matrices), 0, 'matrix mutation did not reach live heap');
  assert.notEqual(Buffer.compare(live.colors, captured.colors), 0, 'color mutation did not reach live heap');
  backend.destroy();
  return true;
}

function assertCaptureEqual(a, b, label) {
  assert.equal(a.count, b.count, `${label}: body count`);
  assert.equal(a.hash, b.hash, `${label}: hash`);
  assert.equal(Buffer.compare(a.matrices, b.matrices), 0, `${label}: matrices`);
  assert.equal(Buffer.compare(a.colors, b.colors), 0, `${label}: colors`);
}

function timeStatic(project, sceneId, iterations) {
  const backend = create(project, sceneId);
  for (let i = 0; i < 20; i++) backend.syncTransforms();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) backend.syncTransforms();
  const elapsed = performance.now() - started;
  const result = { ms: elapsed / iterations, capture: capture(backend) };
  backend.destroy();
  return result;
}

function timeExplosions(project, sceneId, iterations) {
  const backend = create(project, sceneId);
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    const x = ((i * 17) % 31) - 15;
    const y = 1 + ((i * 7) % 13) * 0.7;
    const z = ((i * 23) % 29) - 14;
    backend.explode(x, y, z, 8 + (i % 9), 3.5 + (i % 4));
  }
  const elapsed = performance.now() - started;
  backend.syncTransforms();
  const result = { ms: elapsed / iterations, capture: capture(backend) };
  backend.destroy();
  return result;
}

function benchmarkPair(label, beforeProject, afterProject, operation, iterations) {
  const records = [];
  for (let sceneIndex = 0; sceneIndex < sceneIds.length; sceneIndex++) {
    const sceneId = sceneIds[sceneIndex];
    const beforeTimes = [];
    const afterTimes = [];
    for (let sample = 0; sample < samples; sample++) {
      const beforeFirst = ((sceneIndex + sample) & 1) === 0;
      const first = operation(beforeFirst ? beforeProject : afterProject, sceneId, iterations);
      const second = operation(beforeFirst ? afterProject : beforeProject, sceneId, iterations);
      const before = beforeFirst ? first : second;
      const after = beforeFirst ? second : first;
      assertCaptureEqual(before.capture, after.capture, `${label} scene ${sceneId} sample ${sample}`);
      beforeTimes.push(before.ms);
      afterTimes.push(after.ms);
    }
    const beforeMedianMs = median(beforeTimes);
    const afterMedianMs = median(afterTimes);
    records.push({
      sceneId,
      title: afterProject.scenes[sceneId].title,
      beforeMedianMs,
      afterMedianMs,
      speedup: beforeMedianMs / afterMedianMs,
      exact: true,
    });
  }
  return {
    label,
    cases: records.length,
    geometricMean: geometricMean(records.map((record) => record.speedup)),
    minimumSpeedup: Math.min(...records.map((record) => record.speedup)),
    maximumSpeedup: Math.max(...records.map((record) => record.speedup)),
    records,
  };
}

function markdown(result) {
  const lines = [
    '# WebPhysics v1.11 fallback exact-gains benchmark', '',
    `Generated: ${result.generatedAt}`, '',
    `Samples per scene/order: **${result.samples}**. All ${result.pairedOutputComparisons} timed paired output comparisons and ${result.boundaryCases.length} boundary suites were byte-exact.`, '',
    '## Exactness guards', '',
    `- Captures detached from the live fallback heap: **${result.capturesDetached ? 'passed' : 'failed'}**.`,
    `- Candidate source stable during the run: **${result.sourceStableDuringRun ? 'yes' : 'no'}**.`,
    `- Boundary suites: ${result.boundaryCases.map((record) => `${record.name} (${record.points} bodies)`).join('; ')}.`, '',
  ];
  for (const group of result.groups) {
    lines.push(
      `## ${group.label}`, '',
      `Geometric-mean speedup: **${group.geometricMean.toFixed(4)}x** ` +
        `(range ${group.minimumSpeedup.toFixed(4)}-${group.maximumSpeedup.toFixed(4)}x).`, '',
      '| Scene | Before ms/op | After ms/op | Speedup |',
      '|---|---:|---:|---:|',
    );
    for (const record of group.records) {
      lines.push(`| ${record.sceneId} ${record.title.replace(/\|/g, '\\|')} | ${record.beforeMedianMs.toFixed(6)} | ${record.afterMedianMs.toFixed(6)} | ${record.speedup.toFixed(4)}x |`);
    }
    lines.push('');
  }
  lines.push('Static transform/material timings isolate recurring stream synchronization. Explosion timings exclude setup and final stream synchronization.');
  return `${lines.join('\n')}\n`;
}

try {
  const sourceFingerprintAtStart = sourceFingerprint();
  prepare();
  const current = load(currentBuild);
  const legacySync = load(legacySyncBuild);
  const baseline = load(baselineBuild);
  const groups = [
    benchmarkPair('One-time static transform and material streams', legacySync, current, timeStatic, 600),
    benchmarkPair('Allocation-free broad-rejected explosions', baseline, current, timeExplosions, 320),
  ];
  const boundaryCases = explosionBoundaryAudit(baseline, current);
  const capturesDetached = captureDetachmentAudit(current);
  const sourceFingerprintAtEnd = sourceFingerprint();
  const sourceStableDuringRun = sourceFingerprintAtStart === sourceFingerprintAtEnd;
  assert.ok(sourceStableDuringRun, 'fallback candidate source changed during benchmark');
  const result = {
    generatedAt: new Date().toISOString(),
    baselineArchive: path.basename(archive),
    baselineSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    sourceFingerprintAtStart,
    sourceFingerprintAtEnd,
    sourceStableDuringRun,
    samples,
    sceneCount: sceneIds.length,
    pairedOutputComparisons: groups.length * sceneIds.length * samples,
    exactComparisons: groups.length * sceneIds.length * samples + boundaryCases.length,
    groups,
    boundaryCases,
    capturesDetached,
    passed: groups.every((group) => group.records.every((record) => record.exact)) &&
      boundaryCases.every((record) => record.exact) && capturesDetached && sourceStableDuringRun,
  };
  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, markdown(result));
  console.log(JSON.stringify({
    passed: result.passed,
    exactComparisons: result.exactComparisons,
    speedups: Object.fromEntries(groups.map((group) => [group.label, group.geometricMean])),
  }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
