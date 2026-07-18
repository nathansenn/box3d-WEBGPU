'use strict';

/*
 * Interaction-heavy qualification of the eight v1.11 fast-path scenes.
 * Compares the exact v1.10 source archive to:
 *   1. the current scene-qualified fast path, and
 *   2. a benchmark-only dynamic guard that disables fused integration while
 *      soft projectiles/rain are active.
 *
 * The guard is simulated by changing ordinary compiled-JS instance flags;
 * simulation source is never edited by this benchmark.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const harness = require('./v111-long-horizon-fidelity.cjs');
const {
  root,
  baselineArchive,
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
} = harness;

const SCENE_IDS = [609, 619, 629, 639, 649, 655, 665, 675];
const FRAMES = 360;
const CHECKPOINT_CADENCE = 12;
const outputJson = path.join(root, 'benchmarks/results/v111-fastpath-interaction-fidelity.json');
const outputMarkdown = path.join(root, 'benchmarks/results/v111-fastpath-interaction-fidelity.md');

const ACTION_FRAMES = new Set([36, 72, 120, 180, 225, 270, 330]);

function comparableMetadataEqual(baseline, candidate) {
  const fields = ['kind', 'nodes', 'constraints', 'broken', 'instances', 'surfacePath', 'surfaceVertices', 'surfaceIndices', 'ropeSegments'];
  return fields.every((field) => baseline.metadata[field] === candidate.metadata[field]);
}

function makeMetrics() {
  return {
    maxStateRelativeL2: 0,
    maxStateFrame: 0,
    maxStateAbs: 0,
    maxRenderRelativeL2: 0,
    maxRenderFrame: 0,
    maxRenderAbs: 0,
    finalStateRelativeL2: 0,
    finalRenderRelativeL2: 0,
    deterministic: true,
    finite: true,
    metadataExact: true,
    topologyExact: true,
    mismatches: [],
  };
}

function updateMetrics(metrics, frame, baselineA, candidateA, candidateB) {
  metrics.deterministic &&= candidateA.fingerprint === candidateB.fingerprint;
  metrics.finite &&= candidateA.finite && candidateB.finite;
  const stateError = combinedRelativeL2(baselineA.stateArrays, candidateA.stateArrays);
  const renderError = combinedRelativeL2(baselineA.renderArrays, candidateA.renderArrays);
  const stateAbs = combinedMaxAbs(baselineA.stateArrays, candidateA.stateArrays);
  const renderAbs = combinedMaxAbs(baselineA.renderArrays, candidateA.renderArrays);
  if (stateError > metrics.maxStateRelativeL2) {
    metrics.maxStateRelativeL2 = stateError;
    metrics.maxStateFrame = frame;
  }
  if (renderError > metrics.maxRenderRelativeL2) {
    metrics.maxRenderRelativeL2 = renderError;
    metrics.maxRenderFrame = frame;
  }
  metrics.maxStateAbs = Math.max(metrics.maxStateAbs, stateAbs);
  metrics.maxRenderAbs = Math.max(metrics.maxRenderAbs, renderAbs);
  if (frame === FRAMES) {
    metrics.finalStateRelativeL2 = stateError;
    metrics.finalRenderRelativeL2 = renderError;
  }
  if (!comparableMetadataEqual(baselineA, candidateA)) {
    metrics.metadataExact = false;
    if (metrics.mismatches.length < 8) metrics.mismatches.push(`frame ${frame}: count/break metadata differs`);
  }
  if (baselineA.topologyFingerprint !== candidateA.topologyFingerprint) {
    metrics.topologyExact = false;
    if (metrics.mismatches.length < 8) metrics.mismatches.push(`frame ${frame}: topology differs`);
  }
}

function launchSpec(domain, ordinal) {
  if (domain === 'cloth') {
    return ordinal === 1
      ? { position: [0, 18, 0], velocity: [0, -28, 0], size: 0.9 }
      : { position: [-16, 6, 0], velocity: [34, 0, 0], size: 0.75 };
  }
  return ordinal === 1
    ? { position: [-18, 9, 0], velocity: [38, 0, 0], size: 0.9 }
    : { position: [18, 11, 0], velocity: [-40, -1, 0], size: 0.8 };
}

function performAction(suite, domain, frame) {
  if (frame === 36) {
    suite.kick(14);
    return { action: 'kick', strength: 14 };
  }
  if (frame === 72 || frame === 225) {
    const spec = launchSpec(domain, frame === 72 ? 1 : 2);
    return {
      action: 'projectile',
      ...spec,
      result: suite.launchProjectile(spec.position, spec.velocity, spec.size),
    };
  }
  if (frame === 120 || frame === 270) {
    const requested = domain === 'cloth'
      ? (frame === 120 ? 64 : 48)
      : (frame === 120 ? 48 : 32);
    const spread = 12;
    const height = domain === 'cloth' ? 20 : 22;
    return {
      action: 'rain',
      requested,
      spread,
      height,
      result: suite.spawnRain(requested, spread, height),
    };
  }
  if (frame === 180) {
    const center = domain === 'cloth' ? [0, 6, 0] : [0, 8, 0];
    suite.explode(center, 20, 10);
    return { action: 'explode', center, strength: 20, radius: 10 };
  }
  if (frame === 330) {
    suite.kick(10);
    return { action: 'kick', strength: 10 };
  }
  return null;
}

function applyActions(suites, domain, frame) {
  if (!ACTION_FRAMES.has(frame)) return { exact: true, outcome: null };
  const outcomes = suites.map((suite) => performAction(suite, domain, frame));
  const encoded = outcomes.map((outcome) => JSON.stringify(outcome));
  return {
    exact: encoded.every((value) => value === encoded[0]),
    outcome: outcomes[0],
  };
}

function setDynamicInteractionGuard(suite, domain) {
  const active = suite.active;
  const interactionFree = active.projectiles.length === 0;
  if (domain === 'cloth') active.fusedKernelStep = interactionFree;
  else active.fusedKernelIntegration = interactionFree;
  return !interactionFree;
}

function setPrearmedInteractionGuard(suite, domain) {
  if (domain === 'cloth') suite.active.fusedKernelStep = false;
  else suite.active.fusedKernelIntegration = false;
}

function thresholdFor(domain) {
  return domain === 'cloth' ? 0.002 : 0.0005;
}

function shouldCheckpoint(frame) {
  return frame === 0 || frame === FRAMES || frame % CHECKPOINT_CADENCE === 0 || ACTION_FRAMES.has(frame);
}

function finishMetrics(metrics, threshold, validationOk) {
  metrics.validationOk = validationOk;
  metrics.pass = metrics.deterministic && metrics.finite && metrics.metadataExact && metrics.topologyExact &&
    validationOk && metrics.maxStateRelativeL2 <= threshold && metrics.maxRenderRelativeL2 <= threshold;
  return metrics;
}

function auditScene(baseline, current, sceneId) {
  const scene = current.SCENES[sceneId];
  const domain = scene.family;
  const threshold = thresholdFor(domain);
  const seed = (0x11fa00 + sceneId) >>> 0;
  const baselineA = setupSuite(baseline, sceneId, seed);
  const baselineB = setupSuite(baseline, sceneId, seed);
  const currentA = setupSuite(current, sceneId, seed);
  const currentB = setupSuite(current, sceneId, seed);
  const guardedA = setupSuite(current, sceneId, seed);
  const guardedB = setupSuite(current, sceneId, seed);
  const prearmedA = setupSuite(current, sceneId, seed);
  const prearmedB = setupSuite(current, sceneId, seed);
  setPrearmedInteractionGuard(prearmedA, domain);
  setPrearmedInteractionGuard(prearmedB, domain);
  const suites = [baselineA, baselineB, currentA, currentB, guardedA, guardedB, prearmedA, prearmedB];
  const actual = makeMetrics();
  const guarded = makeMetrics();
  const prearmed = makeMetrics();
  let baselineDeterministic = true;
  let baselineFinite = true;
  let actionsExact = true;
  let checkpointCount = 0;
  let guardedFrames = 0;
  const actionOutcomes = [];

  const originalFastFlag = domain === 'cloth'
    ? Boolean(currentA.active.fusedKernelStep)
    : Boolean(currentA.active.fusedKernelIntegration);
  const baselineBatchProjectionFlag = domain === 'rope'
    ? Boolean(baselineA.active.batchKernelProjection)
    : null;

  try {
    for (let frame = 0; frame <= FRAMES; frame++) {
      if (frame > 0) {
        const action = applyActions(suites, domain, frame);
        actionsExact &&= action.exact;
        if (action.outcome) actionOutcomes.push({ frame, ...action.outcome });
        const guardA = setDynamicInteractionGuard(guardedA, domain);
        const guardB = setDynamicInteractionGuard(guardedB, domain);
        if (guardA || guardB) guardedFrames++;
        for (const suite of suites) suite.step(1 / 60, 4);
      }
      if (!shouldCheckpoint(frame)) continue;
      checkpointCount++;
      const baseCaptureA = captureSuite(baselineA);
      const baseCaptureB = captureSuite(baselineB);
      const currentCaptureA = captureSuite(currentA);
      const currentCaptureB = captureSuite(currentB);
      const guardedCaptureA = captureSuite(guardedA);
      const guardedCaptureB = captureSuite(guardedB);
      const prearmedCaptureA = captureSuite(prearmedA);
      const prearmedCaptureB = captureSuite(prearmedB);
      baselineDeterministic &&= baseCaptureA.fingerprint === baseCaptureB.fingerprint;
      baselineFinite &&= baseCaptureA.finite && baseCaptureB.finite;
      updateMetrics(actual, frame, baseCaptureA, currentCaptureA, currentCaptureB);
      updateMetrics(guarded, frame, baseCaptureA, guardedCaptureA, guardedCaptureB);
      updateMetrics(prearmed, frame, baseCaptureA, prearmedCaptureA, prearmedCaptureB);
    }

    const validations = suites.map((suite) => suite.validate());
    const baselineValidation = validations[0].ok && validations[1].ok;
    const actualValidation = validations[2].ok && validations[3].ok;
    const guardedValidation = validations[4].ok && validations[5].ok;
    const prearmedValidation = validations[6].ok && validations[7].ok;
    finishMetrics(actual, threshold, baselineValidation && actualValidation && actionsExact && baselineDeterministic && baselineFinite);
    finishMetrics(guarded, threshold, baselineValidation && guardedValidation && actionsExact && baselineDeterministic && baselineFinite);
    finishMetrics(prearmed, threshold, baselineValidation && prearmedValidation && actionsExact && baselineDeterministic && baselineFinite);
    return {
      sceneId,
      title: scene.title,
      domain,
      variant: scene.variant,
      mode: scene.mode,
      stress: 5,
      seed,
      originalFastFlag,
      baselineBatchProjectionFlag,
      frames: FRAMES,
      checkpointCount,
      guardedFrames,
      actionsExact,
      actionOutcomes,
      baselineDeterministic,
      baselineFinite,
      threshold,
      actual,
      dynamicGuard: guarded,
      prearmedInteractionGuard: prearmed,
    };
  } finally {
    for (const suite of suites) suite.destroy();
  }
}

function summarize(records) {
  const actualFailures = records.filter((record) => !record.actual.pass);
  const guardFailures = records.filter((record) => !record.dynamicGuard.pass);
  const prearmedFailures = records.filter((record) => !record.prearmedInteractionGuard.pass);
  const maxActualState = records.reduce((best, record) => !best || record.actual.maxStateRelativeL2 > best.actual.maxStateRelativeL2 ? record : best, null);
  const maxActualRender = records.reduce((best, record) => !best || record.actual.maxRenderRelativeL2 > best.actual.maxRenderRelativeL2 ? record : best, null);
  const maxGuardState = records.reduce((best, record) => !best || record.dynamicGuard.maxStateRelativeL2 > best.dynamicGuard.maxStateRelativeL2 ? record : best, null);
  const maxGuardRender = records.reduce((best, record) => !best || record.dynamicGuard.maxRenderRelativeL2 > best.dynamicGuard.maxRenderRelativeL2 ? record : best, null);
  const maxPrearmedState = records.reduce((best, record) => !best || record.prearmedInteractionGuard.maxStateRelativeL2 > best.prearmedInteractionGuard.maxStateRelativeL2 ? record : best, null);
  const maxPrearmedRender = records.reduce((best, record) => !best || record.prearmedInteractionGuard.maxRenderRelativeL2 > best.prearmedInteractionGuard.maxRenderRelativeL2 ? record : best, null);
  let recommendation = 'No additional dynamic fallback is required by this interaction schedule.';
  if (actualFailures.length > 0 && guardFailures.length === 0) {
    recommendation = 'Gate fused cloth/rope integration with projectiles.length === 0; retain the v1.10-compatible integration while projectile or rain contacts are active.';
  } else if (guardFailures.length > 0 && prearmedFailures.length === 0) {
    recommendation = 'Cloth may retain its qualified fused path. Rope must use `qualified && !interactionArmed && projectiles.length === 0`: contact-time fallback alone is too late, so interactive rope sessions need conservative integration from scene creation. If future actions cannot be known in advance, disable fused rope integration.';
  } else if (prearmedFailures.length > 0) {
    recommendation = 'Even the pre-armed conservative interaction path failed; reject the affected scene optimization.';
  }
  return {
    total: records.length,
    actualPassed: records.length - actualFailures.length,
    actualFailed: actualFailures.length,
    actualFailedSceneIds: actualFailures.map((record) => record.sceneId),
    dynamicGuardPassed: records.length - guardFailures.length,
    dynamicGuardFailed: guardFailures.length,
    dynamicGuardFailedSceneIds: guardFailures.map((record) => record.sceneId),
    prearmedGuardPassed: records.length - prearmedFailures.length,
    prearmedGuardFailed: prearmedFailures.length,
    prearmedGuardFailedSceneIds: prearmedFailures.map((record) => record.sceneId),
    actionsExact: records.every((record) => record.actionsExact),
    actualDeterministic: records.every((record) => record.actual.deterministic),
    dynamicGuardDeterministic: records.every((record) => record.dynamicGuard.deterministic),
    actualFinite: records.every((record) => record.actual.finite),
    dynamicGuardFinite: records.every((record) => record.dynamicGuard.finite),
    prearmedGuardDeterministic: records.every((record) => record.prearmedInteractionGuard.deterministic),
    prearmedGuardFinite: records.every((record) => record.prearmedInteractionGuard.finite),
    maxActualStateRelativeL2: maxActualState.actual.maxStateRelativeL2,
    maxActualStateSceneId: maxActualState.sceneId,
    maxActualRenderRelativeL2: maxActualRender.actual.maxRenderRelativeL2,
    maxActualRenderSceneId: maxActualRender.sceneId,
    maxGuardStateRelativeL2: maxGuardState.dynamicGuard.maxStateRelativeL2,
    maxGuardStateSceneId: maxGuardState.sceneId,
    maxGuardRenderRelativeL2: maxGuardRender.dynamicGuard.maxRenderRelativeL2,
    maxGuardRenderSceneId: maxGuardRender.sceneId,
    maxPrearmedStateRelativeL2: maxPrearmedState.prearmedInteractionGuard.maxStateRelativeL2,
    maxPrearmedStateSceneId: maxPrearmedState.sceneId,
    maxPrearmedRenderRelativeL2: maxPrearmedRender.prearmedInteractionGuard.maxRenderRelativeL2,
    maxPrearmedRenderSceneId: maxPrearmedRender.sceneId,
    recommendation,
  };
}

function makeMarkdown(payload) {
  const summary = payload.summary;
  const lines = [
    '# v1.11 Fast-Path Interaction Fidelity Audit',
    '',
    `Generated: ${payload.generatedAt}`,
    '',
    `Exact v1.10 baseline SHA-256: \`${payload.baseline.sha256}\``,
    '',
    `Candidate source fingerprint: \`${payload.currentSourceFingerprint}\``,
    '',
    'The eight qualified fast scenes ran for 360 frames at stress 5 with duplicate runs of the exact v1.10 baseline, current source, and a benchmark-only dynamic interaction guard. The schedule includes two projectiles, two rain waves, kicks, and an explosion. Rope batch projection is existing v1.10 behavior; the measured rope change is only the new fused integration kernel.',
    '',
    '## Summary',
    '',
    '| Gate | Current fast path | Contact-time guard | Pre-armed interaction guard |',
    '|---|---:|---:|---:|',
    `| Passed scenes | ${summary.actualPassed} / ${summary.total} | ${summary.dynamicGuardPassed} / ${summary.total} | ${summary.prearmedGuardPassed} / ${summary.total} |`,
    `| Deterministic | ${summary.actualDeterministic ? 'yes' : 'no'} | ${summary.dynamicGuardDeterministic ? 'yes' : 'no'} | ${summary.prearmedGuardDeterministic ? 'yes' : 'no'} |`,
    `| Finite | ${summary.actualFinite ? 'yes' : 'no'} | ${summary.dynamicGuardFinite ? 'yes' : 'no'} | ${summary.prearmedGuardFinite ? 'yes' : 'no'} |`,
    `| Maximum state relative L2 | ${formatScientific(summary.maxActualStateRelativeL2)} (scene ${summary.maxActualStateSceneId}) | ${formatScientific(summary.maxGuardStateRelativeL2)} (scene ${summary.maxGuardStateSceneId}) | ${formatScientific(summary.maxPrearmedStateRelativeL2)} (scene ${summary.maxPrearmedStateSceneId}) |`,
    `| Maximum render relative L2 | ${formatScientific(summary.maxActualRenderRelativeL2)} (scene ${summary.maxActualRenderSceneId}) | ${formatScientific(summary.maxGuardRenderRelativeL2)} (scene ${summary.maxGuardRenderSceneId}) | ${formatScientific(summary.maxPrearmedRenderRelativeL2)} (scene ${summary.maxPrearmedRenderSceneId}) |`,
    `| Failed IDs | ${summary.actualFailedSceneIds.join(', ') || 'none'} | ${summary.dynamicGuardFailedSceneIds.join(', ') || 'none'} | ${summary.prearmedGuardFailedSceneIds.join(', ') || 'none'} |`,
    '',
    `**Recommendation:** ${summary.recommendation}`,
    '',
    '## Per-scene evidence',
    '',
    '| ID | Domain | Scene | Limit | Actual state/render | Actual | Contact guard state/render | Contact guard | Pre-armed state/render | Pre-armed |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const record of payload.records) {
    lines.push(`| ${record.sceneId} | ${record.domain} | ${record.title.replaceAll('|', '\\|')} | ${formatScientific(record.threshold)} | ${formatScientific(record.actual.maxStateRelativeL2)} / ${formatScientific(record.actual.maxRenderRelativeL2)} | ${record.actual.pass ? 'PASS' : 'FAIL'} | ${formatScientific(record.dynamicGuard.maxStateRelativeL2)} / ${formatScientific(record.dynamicGuard.maxRenderRelativeL2)} | ${record.dynamicGuard.pass ? 'PASS' : 'FAIL'} | ${formatScientific(record.prearmedInteractionGuard.maxStateRelativeL2)} / ${formatScientific(record.prearmedInteractionGuard.maxRenderRelativeL2)} | ${record.prearmedInteractionGuard.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', '## Deterministic action schedule', '', '- Frame 36: structural kick.', '- Frame 72: direct projectile crossing the cloth membrane or rope curtain.', '- Frame 120: first rain wave.', '- Frame 180: centered explosion.', '- Frame 225: opposing projectile.', '- Frame 270: second rain wave.', '- Frame 330: final kick.', '', 'The contact-time guard is evaluated as `qualifiedFastPath && projectiles.length === 0` immediately before each step. The pre-armed guard uses conservative integration from scene creation, modeling `qualifiedFastPath && !interactionArmed`. Both are benchmark-only evidence; this script does not edit simulation source.', '');
  return `${lines.join('\n')}\n`;
}

function main() {
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  const sourceStart = sourceFingerprint();
  prepareBaseline();
  prepareCurrent();
  const baseline = loadProject(path.join(baselineRoot, '.test-build'), baselineRoot, 'v1.10 exact archive');
  const current = loadProject(currentBuild, currentAssets, 'current working tree');
  const records = [];
  for (let index = 0; index < SCENE_IDS.length; index++) {
    const record = auditScene(baseline, current, SCENE_IDS[index]);
    records.push(record);
    process.stdout.write(`[${index + 1}/${SCENE_IDS.length}] scene ${record.sceneId} ${record.domain}: actual ${record.actual.pass ? 'PASS' : 'FAIL'} contact ${record.dynamicGuard.pass ? 'PASS' : 'FAIL'} prearmed ${record.prearmedInteractionGuard.pass ? 'PASS' : 'FAIL'} state ${formatScientific(record.actual.maxStateRelativeL2)} -> ${formatScientific(record.dynamicGuard.maxStateRelativeL2)} -> ${formatScientific(record.prearmedInteractionGuard.maxStateRelativeL2)}\n`);
  }
  const sourceEnd = sourceFingerprint();
  const sourceStable = sourceStart === sourceEnd;
  const archiveSha = crypto.createHash('sha256').update(fs.readFileSync(baselineArchive)).digest('hex');
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: { archive: path.relative(root, baselineArchive), sha256: archiveSha },
    currentSourceFingerprint: sourceStart,
    currentSourceFingerprintAtEnd: sourceEnd,
    sourceStableDuringRun: sourceStable,
    configuration: {
      sceneIds: SCENE_IDS,
      frames: FRAMES,
      dt: 1 / 60,
      subSteps: 4,
      stress: 5,
      checkpointCadence: CHECKPOINT_CADENCE,
      dynamicGuard: 'qualifiedFastPath && projectiles.length === 0',
      prearmedInteractionGuard: 'qualifiedFastPath && !interactionArmed',
    },
    summary: summarize(records),
    records,
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(payload, (_key, value) => {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }, 2)}\n`);
  fs.writeFileSync(outputMarkdown, makeMarkdown(payload));
  process.stdout.write(`Wrote ${path.relative(root, outputJson)}\nWrote ${path.relative(root, outputMarkdown)}\n`);
  process.stdout.write(`Actual ${payload.summary.actualPassed}/${payload.summary.total}; contact guard ${payload.summary.dynamicGuardPassed}/${payload.summary.total}; prearmed guard ${payload.summary.prearmedGuardPassed}/${payload.summary.total}\n`);
  if (!sourceStable) process.stderr.write('Source changed during the run; discard this evidence.\n');
  if (!sourceStable || payload.summary.actualFailed > 0 || payload.summary.dynamicGuardFailed > 0 || payload.summary.prearmedGuardFailed > 0) process.exitCode = 1;
}

try {
  main();
} finally {
  cleanupTemporaryTree();
}
