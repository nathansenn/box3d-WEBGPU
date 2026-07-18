'use strict';

/*
 * Cross-version, long-horizon fidelity audit for the exact v1.10 source
 * baseline versus the current tree. This is deliberately separate from the
 * 100-case speed tournament: it qualifies every cloth and rope recipe at
 * stress 5, including both fused/batched candidates and conservative paths.
 *
 * Run:
 *   node benchmarks/v111-long-horizon-fidelity.cjs
 *
 * Environment:
 *   V111_FIDELITY_FRAMES=360       simulated frames per recipe
 *   V111_FIDELITY_CHECKPOINT=12    comparison cadence in frames
 *   V111_FIDELITY_KEEP_TEMP=1      retain isolated build trees
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const frameCount = Math.max(180, Number.parseInt(process.env.V111_FIDELITY_FRAMES || '360', 10));
const checkpointCadence = Math.max(1, Number.parseInt(process.env.V111_FIDELITY_CHECKPOINT || '12', 10));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v111-fidelity-'));
const baselineRoot = path.join(tempRoot, 'baseline-v1.10');
const currentBuild = path.join(tempRoot, 'current-build');
const currentAssets = path.join(tempRoot, 'current-assets');
const outputJson = path.join(root, 'benchmarks/results/v111-long-horizon-fidelity.json');
const outputMarkdown = path.join(root, 'benchmarks/results/v111-long-horizon-fidelity.md');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

function writeCommonJsPackage(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function ensureBaselineBaseTsconfig() {
  const target = path.join(baselineRoot, 'tsconfig.json');
  if (fs.existsSync(target)) return;
  const v110BaseConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      noEmit: true,
    },
    include: ['src'],
  };
  fs.writeFileSync(target, `${JSON.stringify(v110BaseConfig, null, 2)}\n`);
}

function prepareBaseline() {
  if (!fs.existsSync(baselineArchive)) throw new Error(`missing baseline archive: ${baselineArchive}`);
  fs.mkdirSync(baselineRoot, { recursive: true });
  run('tar', ['-xzf', baselineArchive, '-C', baselineRoot]);
  ensureBaselineBaseTsconfig();
  const baselineModules = path.join(baselineRoot, 'node_modules');
  fs.rmSync(baselineModules, { recursive: true, force: true });
  fs.symlinkSync(path.join(root, 'node_modules'), baselineModules, process.platform === 'win32' ? 'junction' : 'dir');
  run(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(baselineRoot, 'tsconfig.test.json')], {
    cwd: baselineRoot,
  });
  writeCommonJsPackage(path.join(baselineRoot, '.test-build'));
  run('bash', [path.join(baselineRoot, 'scripts/build-soft-kernels.sh')], { cwd: baselineRoot });
}

function prepareCurrent() {
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(root, 'tsconfig.test.json'),
    '--outDir', currentBuild,
  ], { cwd: root });
  writeCommonJsPackage(currentBuild);

  // Build the candidate kernels in an isolated miniature tree. The audit must
  // never mutate public/ or another agent's release artifacts.
  fs.mkdirSync(path.join(currentAssets, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(currentAssets, 'wasm'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/build-soft-kernels.sh'), path.join(currentAssets, 'scripts/build-soft-kernels.sh'));
  fs.copyFileSync(path.join(root, 'wasm/soft_kernels.c'), path.join(currentAssets, 'wasm/soft_kernels.c'));
  fs.chmodSync(path.join(currentAssets, 'scripts/build-soft-kernels.sh'), 0o755);
  run('bash', [path.join(currentAssets, 'scripts/build-soft-kernels.sh')], { cwd: currentAssets });
}

function loadProject(buildRoot, assetRoot, label) {
  const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
  const { SoftSimulationSuite } = require(path.join(buildRoot, 'src/soft/simulations.js'));
  const { SoftKernelModule } = require(path.join(buildRoot, 'src/soft/kernels.js'));
  const kernelBytes = fs.readFileSync(path.join(assetRoot, 'public/soft-kernels-simd.wasm'));
  const kernelModule = new WebAssembly.Module(kernelBytes);
  return {
    label,
    SCENES,
    createSuite() {
      const instance = new WebAssembly.Instance(kernelModule, {});
      return new SoftSimulationSuite(new SoftKernelModule('simd', instance.exports));
    },
  };
}

function finiteArray(values) {
  if (!values) return true;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

function exactArray(a, b) {
  if (!a || !b || a.constructor !== b.constructor || a.length !== b.length) return false;
  const aBytes = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const bBytes = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return aBytes.equals(bBytes);
}

function combinedRelativeL2(baselineArrays, candidateArrays) {
  if (baselineArrays.length !== candidateArrays.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  let reference = 0;
  for (let arrayIndex = 0; arrayIndex < baselineArrays.length; arrayIndex++) {
    const baseline = baselineArrays[arrayIndex];
    const candidate = candidateArrays[arrayIndex];
    if (!baseline || !candidate || baseline.length !== candidate.length) return Number.POSITIVE_INFINITY;
    for (let i = 0; i < baseline.length; i++) {
      const delta = candidate[i] - baseline[i];
      error += delta * delta;
      reference += baseline[i] * baseline[i];
    }
  }
  return Math.sqrt(error / Math.max(reference, 1e-30));
}

function combinedMaxAbs(baselineArrays, candidateArrays) {
  if (baselineArrays.length !== candidateArrays.length) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let arrayIndex = 0; arrayIndex < baselineArrays.length; arrayIndex++) {
    const baseline = baselineArrays[arrayIndex];
    const candidate = candidateArrays[arrayIndex];
    if (!baseline || !candidate || baseline.length !== candidate.length) return Number.POSITIVE_INFINITY;
    for (let i = 0; i < baseline.length; i++) maximum = Math.max(maximum, Math.abs(candidate[i] - baseline[i]));
  }
  return maximum;
}

function normalizedPackedSurface(surface) {
  const valuesPerVertex = 11;
  const result = new Float32Array(surface.vertexCount * valuesPerVertex);
  const view = new DataView(surface.vertices.buffer, surface.vertices.byteOffset, surface.vertices.byteLength);
  for (let i = 0; i < surface.vertexCount; i++) {
    const source = i * surface.vertexStride;
    const target = i * valuesPerVertex;
    result[target] = view.getFloat32(source, true);
    result[target + 1] = view.getFloat32(source + 4, true);
    result[target + 2] = view.getFloat32(source + 8, true);
    const nx = view.getInt16(source + 12, true);
    const ny = view.getInt16(source + 14, true);
    result[target + 3] = nx / (nx < 0 ? 32768 : 32767);
    result[target + 4] = ny / (ny < 0 ? 32768 : 32767);
    result[target + 5] = view.getUint8(source + 16) / 255;
    result[target + 6] = view.getUint8(source + 17) / 255;
    result[target + 7] = view.getUint8(source + 18) / 255;
    result[target + 8] = view.getUint8(source + 19) / 255;
    result[target + 9] = view.getUint16(source + 20, true) / 65535;
    result[target + 10] = view.getUint16(source + 22, true) / 65535;
  }
  return result;
}

function hashCapture(arrays, metadata) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(metadata));
  for (const values of arrays) {
    hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  }
  return hash.digest('hex');
}

function captureSuite(suite) {
  const frame = suite.buildFrame(false);
  const active = suite.active;
  assert.ok(active, 'soft suite has no active simulation');

  const positions = active.positions.subarray(0, frame.kind === 'rope' ? frame.ropeGrid.nodeCount * 3 : active.positions.length);
  const previous = active.previous.subarray(0, positions.length);
  const stateArrays = [positions, previous];
  const renderArrays = [
    frame.matrices.subarray(0, frame.instanceCount * 16),
    frame.colors.subarray(0, frame.instanceCount * 4),
  ];
  const topologyArrays = [];
  let surfacePath = 'none';
  let surfaceVertices = 0;
  let surfaceIndices = 0;
  let ropeSegments = 0;

  if (frame.surface) {
    surfacePath = frame.surface.path;
    surfaceVertices = frame.surface.vertexCount;
    surfaceIndices = frame.surface.indexCount;
    topologyArrays.push(frame.surface.indices.subarray(0, frame.surface.indexCount));
    if (frame.surface.path === 'packed') {
      renderArrays.push(normalizedPackedSurface(frame.surface));
    } else if (frame.surface.path === 'gpu-cloth') {
      renderArrays.push(
        frame.surface.positions.subarray(0, frame.surface.vertexCount * 3),
        frame.surface.restPositions.subarray(0, frame.surface.vertexCount * 3),
      );
    }
  }

  if (frame.ropeGrid) {
    ropeSegments = frame.ropeGrid.segmentCount;
    renderArrays.push(
      frame.ropeGrid.positions.subarray(0, frame.ropeGrid.nodeCount * 3),
      frame.ropeGrid.segments.subarray(0, frame.ropeGrid.segmentCount * 8),
    );
    const endpoints = new Uint16Array(frame.ropeGrid.segmentCount * 2);
    for (let i = 0; i < frame.ropeGrid.segmentCount; i++) {
      endpoints[i * 2] = frame.ropeGrid.segments[i * 8];
      endpoints[i * 2 + 1] = frame.ropeGrid.segments[i * 8 + 1];
    }
    topologyArrays.push(endpoints);
  }

  const metadata = {
    kind: frame.kind,
    nodes: frame.nodeCount,
    constraints: frame.constraintCount,
    broken: frame.brokenCount,
    instances: frame.instanceCount,
    surfacePath,
    surfaceVertices,
    surfaceIndices,
    ropeSegments,
    frameVersion: frame.frameVersion,
    hash: suite.hash() >>> 0,
  };
  const finite = [...stateArrays, ...renderArrays].every(finiteArray) && Number.isFinite(frame.energy);
  const fingerprint = hashCapture([...stateArrays, ...renderArrays, ...topologyArrays], metadata);
  const topologyFingerprint = hashCapture(topologyArrays, {
    surfacePath,
    surfaceVertices,
    surfaceIndices,
    ropeSegments,
    broken: frame.brokenCount,
  });
  return {
    frame,
    stateArrays,
    renderArrays,
    topologyArrays,
    metadata,
    finite,
    fingerprint,
    topologyFingerprint,
  };
}

function fidelityLimit(domain, fastPath) {
  if (!fastPath) return 1e-7;
  return domain === 'cloth' ? 0.002 : 0.0005;
}

function applyScheduledAction(suites, frame) {
  if (frame === 60) {
    for (const suite of suites) suite.kick(18);
  } else if (frame === 120) {
    for (const suite of suites) suite.explode([0, 8, 0], 24, 12);
  } else if (frame === 240) {
    for (const suite of suites) suite.kick(12);
  } else if (frame === 300) {
    for (const suite of suites) suite.explode([3, 6, -2], 16, 9);
  }
}

function shouldCheckpoint(frame) {
  return frame === 0 || frame === frameCount || frame % checkpointCadence === 0 || [60, 120, 240, 300].includes(frame);
}

function setupSuite(project, sceneId, seed) {
  const suite = project.createSuite();
  const scene = project.SCENES[sceneId];
  assert.ok(scene, `missing scene ${sceneId} in ${project.label}`);
  assert.ok(suite.createScene(scene, 5, seed), `failed to create scene ${sceneId} in ${project.label}`);
  return suite;
}

function auditScene(baseline, current, sceneId) {
  const baselineScene = baseline.SCENES[sceneId];
  const currentScene = current.SCENES[sceneId];
  assert.equal(currentScene.family, baselineScene.family, `family mismatch for scene ${sceneId}`);
  assert.equal(currentScene.variant, baselineScene.variant, `variant mismatch for scene ${sceneId}`);
  assert.equal(currentScene.mode, baselineScene.mode, `mode mismatch for scene ${sceneId}`);

  const domain = currentScene.family;
  const seed = (0x11f100 + sceneId) >>> 0;
  const baselineA = setupSuite(baseline, sceneId, seed);
  const baselineB = setupSuite(baseline, sceneId, seed);
  const currentA = setupSuite(current, sceneId, seed);
  const currentB = setupSuite(current, sceneId, seed);
  const suites = [baselineA, baselineB, currentA, currentB];

  const runtimeFastFlag = domain === 'cloth'
    ? Boolean(currentA.active.fusedKernelStep)
    : Boolean(currentA.active.fusedKernelIntegration);
  const baselineBatchProjectionFlag = domain === 'rope'
    ? Boolean(baselineA.active.batchKernelProjection)
    : null;
  // Read the qualification flag from the compiled candidate itself instead of
  // duplicating its predicate here. That keeps the audit accurate when a failed
  // scene is deliberately returned to the conservative path.
  const fastPath = runtimeFastFlag;
  // Rope's batch projection already exists in v1.10. For rope, `fastPath`
  // specifically identifies the new WASM integration that reuses the legacy
  // projection flag; do not mislabel the measured difference as projection.
  const pathClass = fastPath ? (domain === 'cloth' ? 'fused-step' : 'fused-integration') : 'conservative';
  const limit = fidelityLimit(domain, fastPath);
  let maxStateRelativeL2 = 0;
  let maxStateFrame = 0;
  let maxStateAbs = 0;
  let maxRenderRelativeL2 = 0;
  let maxRenderFrame = 0;
  let maxRenderAbs = 0;
  let finalStateRelativeL2 = 0;
  let finalRenderRelativeL2 = 0;
  let baselineDeterministic = true;
  let currentDeterministic = true;
  let finite = true;
  let metadataExact = true;
  let topologyExact = true;
  let checkpointCount = 0;
  const mismatches = [];

  try {
    for (let frame = 0; frame <= frameCount; frame++) {
      if (frame > 0) {
        applyScheduledAction(suites, frame);
        for (const suite of suites) suite.step(1 / 60, 4);
      }
      if (!shouldCheckpoint(frame)) continue;
      checkpointCount++;

      const baselineCaptureA = captureSuite(baselineA);
      const baselineCaptureB = captureSuite(baselineB);
      const currentCaptureA = captureSuite(currentA);
      const currentCaptureB = captureSuite(currentB);

      baselineDeterministic &&= baselineCaptureA.fingerprint === baselineCaptureB.fingerprint;
      currentDeterministic &&= currentCaptureA.fingerprint === currentCaptureB.fingerprint;
      finite &&= baselineCaptureA.finite && baselineCaptureB.finite && currentCaptureA.finite && currentCaptureB.finite;

      const stateError = combinedRelativeL2(baselineCaptureA.stateArrays, currentCaptureA.stateArrays);
      const renderError = combinedRelativeL2(baselineCaptureA.renderArrays, currentCaptureA.renderArrays);
      const stateAbs = combinedMaxAbs(baselineCaptureA.stateArrays, currentCaptureA.stateArrays);
      const renderAbs = combinedMaxAbs(baselineCaptureA.renderArrays, currentCaptureA.renderArrays);
      if (stateError > maxStateRelativeL2) {
        maxStateRelativeL2 = stateError;
        maxStateFrame = frame;
      }
      if (renderError > maxRenderRelativeL2) {
        maxRenderRelativeL2 = renderError;
        maxRenderFrame = frame;
      }
      maxStateAbs = Math.max(maxStateAbs, stateAbs);
      maxRenderAbs = Math.max(maxRenderAbs, renderAbs);
      if (frame === frameCount) {
        finalStateRelativeL2 = stateError;
        finalRenderRelativeL2 = renderError;
      }

      const comparableMetadata = ['kind', 'nodes', 'constraints', 'broken', 'instances', 'surfacePath', 'surfaceVertices', 'surfaceIndices', 'ropeSegments'];
      for (const field of comparableMetadata) {
        if (baselineCaptureA.metadata[field] !== currentCaptureA.metadata[field]) {
          metadataExact = false;
          if (mismatches.length < 8) mismatches.push(`frame ${frame}: ${field} ${baselineCaptureA.metadata[field]} != ${currentCaptureA.metadata[field]}`);
        }
      }
      if (baselineCaptureA.topologyFingerprint !== currentCaptureA.topologyFingerprint) {
        topologyExact = false;
        if (mismatches.length < 8) mismatches.push(`frame ${frame}: topology fingerprint differs`);
      }
    }

    const validations = suites.map((suite) => suite.validate());
    const validationOk = validations.every((result) => result.ok);
    const pass = baselineDeterministic && currentDeterministic && finite &&
      metadataExact && topologyExact && validationOk && maxStateRelativeL2 <= limit && maxRenderRelativeL2 <= limit;
    return {
      sceneId,
      title: currentScene.title,
      domain,
      variant: currentScene.variant,
      mode: currentScene.mode,
      stress: 5,
      seed,
      pathClass,
      expectedFastPath: fastPath,
      runtimeFastFlag,
      baselineBatchProjectionFlag,
      frames: frameCount,
      checkpointCadence,
      checkpointCount,
      maxStateRelativeL2,
      maxStateFrame,
      maxStateAbs,
      maxRenderRelativeL2,
      maxRenderFrame,
      maxRenderAbs,
      finalStateRelativeL2,
      finalRenderRelativeL2,
      fidelityLimit: limit,
      metadataExact,
      topologyExact,
      baselineDeterministic,
      currentDeterministic,
      finite,
      validationOk,
      validationMessages: validations.map((result) => result.message),
      mismatches,
      pass,
    };
  } finally {
    for (const suite of suites) suite.destroy();
  }
}

function maximumRecord(records, field) {
  return records.reduce((best, record) => !best || record[field] > best[field] ? record : best, null);
}

function summarize(records) {
  const classes = {};
  for (const record of records) {
    const key = `${record.domain}-${record.pathClass}`;
    const group = classes[key] || (classes[key] = []);
    group.push(record);
  }
  const classSummary = {};
  for (const [key, group] of Object.entries(classes)) {
    const maxState = maximumRecord(group, 'maxStateRelativeL2');
    const maxRender = maximumRecord(group, 'maxRenderRelativeL2');
    classSummary[key] = {
      count: group.length,
      passed: group.filter((record) => record.pass).length,
      maxStateRelativeL2: maxState.maxStateRelativeL2,
      maxStateSceneId: maxState.sceneId,
      maxRenderRelativeL2: maxRender.maxRenderRelativeL2,
      maxRenderSceneId: maxRender.sceneId,
      deterministic: group.every((record) => record.baselineDeterministic && record.currentDeterministic),
      finite: group.every((record) => record.finite),
      metadataExact: group.every((record) => record.metadataExact),
      topologyExact: group.every((record) => record.topologyExact),
    };
  }
  const maxState = maximumRecord(records, 'maxStateRelativeL2');
  const maxRender = maximumRecord(records, 'maxRenderRelativeL2');
  return {
    total: records.length,
    cloth: records.filter((record) => record.domain === 'cloth').length,
    rope: records.filter((record) => record.domain === 'rope').length,
    fastPath: records.filter((record) => record.expectedFastPath).length,
    conservative: records.filter((record) => !record.expectedFastPath).length,
    passed: records.filter((record) => record.pass).length,
    failed: records.filter((record) => !record.pass).length,
    deterministic: records.every((record) => record.baselineDeterministic && record.currentDeterministic),
    finite: records.every((record) => record.finite),
    metadataExact: records.every((record) => record.metadataExact),
    topologyExact: records.every((record) => record.topologyExact),
    maxStateRelativeL2: maxState.maxStateRelativeL2,
    maxStateSceneId: maxState.sceneId,
    maxRenderRelativeL2: maxRender.maxRenderRelativeL2,
    maxRenderSceneId: maxRender.sceneId,
    classes: classSummary,
  };
}

function formatScientific(value) {
  return Number.isFinite(value) ? value.toExponential(6) : String(value);
}

function makeMarkdown(payload) {
  const lines = [
    '# v1.11 Long-Horizon Cloth/Rope Fidelity Audit',
    '',
    `Generated: ${payload.generatedAt}`,
    '',
    `Exact baseline: \`${payload.baseline.sha256}\` (\`box3d-webgpu-v1.10.0-source.tar.gz\`)`,
    '',
    `Candidate source fingerprint: \`${payload.currentSourceFingerprint}\``,
    '',
    `Each of the 50 cloth and 50 rope recipes ran ${payload.configuration.frames} frames at stress 5 with identical seeds, four simulation substeps, deterministic kicks/explosions, and an independent repeat of both versions. Cross-version state/render comparisons were sampled every ${payload.configuration.checkpointCadence} frames. Projectile/rain actions were intentionally excluded so the qualified fused paths remained active; the action schedule still exercises sustained wind, impulses, collision boundaries, and radial disturbance. Rope batch projection is already present in v1.10, so rope \`fused-integration\` rows measure only the new integration-kernel path layered on that existing projection architecture.`,
    '',
    '## Result',
    '',
    '| Gate | Result |',
    '|---|---:|',
    `| Candidate source stable during run | ${payload.sourceStableDuringRun ? 'Passed' : 'Failed — evidence invalid'} |`,
    `| Recipes | ${payload.summary.total} (${payload.summary.cloth} cloth + ${payload.summary.rope} rope) |`,
    `| Qualified fast paths | ${payload.summary.fastPath} |`,
    `| Conservative paths | ${payload.summary.conservative} |`,
    `| Passed | ${payload.summary.passed} / ${payload.summary.total} |`,
    `| Exact deterministic repeats | ${payload.summary.deterministic ? 'Passed' : 'Failed'} |`,
    `| Finite state/render streams | ${payload.summary.finite ? 'Passed' : 'Failed'} |`,
    `| Exact counts and break metadata | ${payload.summary.metadataExact ? 'Passed' : 'Failed'} |`,
    `| Exact surface/rope topology | ${payload.summary.topologyExact ? 'Passed' : 'Failed'} |`,
    `| Maximum state relative L2 | ${formatScientific(payload.summary.maxStateRelativeL2)} (scene ${payload.summary.maxStateSceneId}) |`,
    `| Maximum render relative L2 | ${formatScientific(payload.summary.maxRenderRelativeL2)} (scene ${payload.summary.maxRenderSceneId}) |`,
    '',
    '## Path classes',
    '',
    '| Class | Count | Passed | Max state L2 | Max render L2 | Deterministic | Counts/topology |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [key, group] of Object.entries(payload.summary.classes)) {
    lines.push(`| ${key} | ${group.count} | ${group.passed} | ${formatScientific(group.maxStateRelativeL2)} | ${formatScientific(group.maxRenderRelativeL2)} | ${group.deterministic ? 'yes' : 'no'} | ${group.metadataExact && group.topologyExact ? 'exact' : 'mismatch'} |`);
  }
  lines.push('', '## Per-recipe evidence', '', '| ID | Domain/path | Scene | Max state L2 | Max render L2 | Breaks/counts | Deterministic | Pass |', '|---:|---|---|---:|---:|---:|---:|---:|');
  for (const record of payload.records) {
    lines.push(`| ${record.sceneId} | ${record.domain}/${record.pathClass} | ${record.title.replaceAll('|', '\\|')} | ${formatScientific(record.maxStateRelativeL2)} | ${formatScientific(record.maxRenderRelativeL2)} | ${record.metadataExact && record.topologyExact ? 'exact' : 'mismatch'} | ${record.baselineDeterministic && record.currentDeterministic ? 'exact' : 'failed'} | ${record.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', '## Gates', '', '- Qualified cloth paths: state and render relative L2 must remain at or below 0.2%.', '- Qualified rope paths: state and render relative L2 must remain at or below 0.05%.', '- Conservative paths: relative L2 must remain at or below 1e-7.', '- All paths require finite streams, exact repeated-run fingerprints, exact node/constraint/break/instance counts, exact topology, and successful suite validation.', '');
  return `${lines.join('\n')}\n`;
}

function sourceFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const relative of ['src/soft/simulations.ts', 'src/soft/kernels.ts', 'wasm/soft_kernels.c', 'src/scenes.ts']) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return hash.digest('hex');
}

function main() {
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  const sourceFingerprintAtStart = sourceFingerprint();
  prepareBaseline();
  prepareCurrent();
  const baseline = loadProject(path.join(baselineRoot, '.test-build'), baselineRoot, 'v1.10 exact archive');
  const current = loadProject(currentBuild, currentAssets, 'current working tree');
  const records = [];
  const sceneIds = Array.from({ length: 100 }, (_, index) => 600 + index);
  for (let index = 0; index < sceneIds.length; index++) {
    const sceneId = sceneIds[index];
    const record = auditScene(baseline, current, sceneId);
    records.push(record);
    const statePct = (record.maxStateRelativeL2 * 100).toFixed(5);
    const renderPct = (record.maxRenderRelativeL2 * 100).toFixed(5);
    process.stdout.write(`[${String(index + 1).padStart(3)}/100] ${record.domain}/${record.pathClass} scene ${sceneId}: state ${statePct}% render ${renderPct}% ${record.pass ? 'PASS' : 'FAIL'}\n`);
  }

  const archiveSha = crypto.createHash('sha256').update(fs.readFileSync(baselineArchive)).digest('hex');
  const sourceFingerprintAtEnd = sourceFingerprint();
  const sourceStable = sourceFingerprintAtStart === sourceFingerprintAtEnd;
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      archive: path.relative(root, baselineArchive),
      sha256: archiveSha,
    },
    currentSourceFingerprint: sourceFingerprintAtStart,
    currentSourceFingerprintAtEnd: sourceFingerprintAtEnd,
    sourceStableDuringRun: sourceStable,
    configuration: {
      frames: frameCount,
      dt: 1 / 60,
      subSteps: 4,
      stress: 5,
      checkpointCadence,
      actions: [
        { frame: 60, action: 'kick', strength: 18 },
        { frame: 120, action: 'explode', center: [0, 8, 0], strength: 24, radius: 12 },
        { frame: 240, action: 'kick', strength: 12 },
        { frame: 300, action: 'explode', center: [3, 6, -2], strength: 16, radius: 9 },
      ],
    },
    summary: summarize(records),
    records,
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, makeMarkdown(payload));
  process.stdout.write(`\nWrote ${path.relative(root, outputJson)}\nWrote ${path.relative(root, outputMarkdown)}\n`);
  process.stdout.write(`Passed ${payload.summary.passed}/${payload.summary.total}; max state ${formatScientific(payload.summary.maxStateRelativeL2)}, max render ${formatScientific(payload.summary.maxRenderRelativeL2)}\n`);
  if (!sourceStable) process.stderr.write('Candidate source changed while the audit was running; discard this evidence and rerun.\n');
  if (!sourceStable || payload.summary.failed > 0) process.exitCode = 1;
}

function cleanupTemporaryTree() {
  if (process.env.V111_FIDELITY_KEEP_TEMP === '1') {
    process.stdout.write(`Retained temporary audit tree: ${tempRoot}\n`);
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  root,
  baselineArchive,
  tempRoot,
  baselineRoot,
  currentBuild,
  currentAssets,
  prepareBaseline,
  prepareCurrent,
  loadProject,
  setupSuite,
  captureSuite,
  combinedRelativeL2,
  combinedMaxAbs,
  sourceFingerprint,
  formatScientific,
  cleanupTemporaryTree,
};

if (require.main === module) {
  try {
    main();
  } finally {
    cleanupTemporaryTree();
  }
}
