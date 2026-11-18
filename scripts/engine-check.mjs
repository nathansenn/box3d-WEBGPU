#!/usr/bin/env node
/** Scope-limited performance gate. Unknown measurements never become successful evidence. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, hashFile, hashValue, inventory, LIMITS, parseArgs, verifyManifestStructure } from './engine-baseline.mjs';

export const RESULT_SCHEMA = 'box3d.engine-benchmark/1';
export const SAMPLE_SCHEMA = 'box3d.engine-sample/1';
export const METRICS = ['stepMs', 'snapshotMs', 'topologyMs', 'cpuCycleMs'];
export function random(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function quantile(values, p) {
  if (!values.length) throw new Error('Cannot summarize missing samples');
  const sorted = [...values].sort((a, b) => a - b);
  const offset = (sorted.length - 1) * p, low = Math.floor(offset), fraction = offset - low;
  return sorted[low] * (1 - fraction) + sorted[Math.ceil(offset)] * fraction;
}
export const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
export function summary(values) {
  return { count: values.length, mean: mean(values), median: quantile(values, .5), p95: quantile(values, .95), min: Math.min(...values), max: Math.max(...values) };
}
export function bootstrapRatio(baseline, candidate, { seed = 100, iterations = 2000 } = {}) {
  if (baseline.length !== candidate.length || baseline.length < 2 || ![...baseline, ...candidate].every(v => Number.isFinite(v) && v > 0)) throw new Error('Bootstrap requires equal positive paired samples');
  if (!Number.isSafeInteger(iterations) || iterations < 100 || iterations > 10000) throw new Error('Bootstrap iterations must be 100..10000');
  const rng = random(seed), ratios = [];
  for (let i = 0; i < iterations; i++) {
    const b = [], c = [];
    for (let j = 0; j < baseline.length; j++) { const selected = Math.floor(rng() * baseline.length); b.push(baseline[selected]); c.push(candidate[selected]); }
    ratios.push(quantile(b, .5) / quantile(c, .5));
  }
  return { estimator: 'ratio-of-medians-of-paired-process-means', ratio: quantile(baseline, .5) / quantile(candidate, .5),
    lower95: quantile(ratios, .025), upper95: quantile(ratios, .975), resamples: iterations, seed };
}

/** Pure checker, also usable by test fixtures. CLI additionally verifies every retained input. */
export function checkResult(result, { maxRegression = .05, controlTolerance = .15, minSamples = 4, minimumSpeedup = null } = {}) {
  const issues = [], regressions = [], uncertain = [], comparisons = [];
  const incomparable = () => ({ schema: 'box3d.engine-gate/1', status: 'incomparable', issues, regressions, uncertain, comparisons, claim: 'No performance conclusion' });
  if (![maxRegression, controlTolerance].every(n => Number.isFinite(n) && n > 0 && n < .5) || !Number.isSafeInteger(minSamples) || minSamples < 4 || (minimumSpeedup !== null && (!Number.isFinite(minimumSpeedup) || minimumSpeedup <= 1))) throw new Error('Invalid gate thresholds');
  if (result?.schema !== RESULT_SCHEMA) { issues.push('Unknown result schema'); return incomparable(); }
  const p = result.protocol;
  if (!p || p.scope !== 'studio-cpu-step-snapshot-topology/1' || result.protocolSha256 !== hashValue(p)) issues.push('Protocol scope/hash mismatch');
  if (!p || !Number.isSafeInteger(p.trials) || p.trials < minSamples || p.trials > 20 || p.trials % 2 || !Number.isSafeInteger(p.steps) || p.steps < 2 || p.steps > 600 || !Number.isSafeInteger(p.warmupSteps) || p.warmupSteps < 1 || p.warmupSteps > 600 || !Array.isArray(p.cases) || !p.cases.length || p.cases.length > 9 || !Number.isSafeInteger(p.seed)) issues.push('Missing or invalid bounded measured-sample protocol');
  if (!result.harness || result.harness.sha256 !== hashValue(result.harness.files) || !result.harness.files?.length) issues.push('Harness identity mismatch');
  for (const side of ['baseline', 'candidate']) {
    const manifest = result.manifests?.[side];
    issues.push(...verifyManifestStructure(manifest).map(i => `${side}: ${i}`));
    if (canonical(result.identities?.[side]) !== canonical(manifest?.identity)) issues.push(`${side}: result identity/hash mismatch`);
    if (manifest?.environment?.runtime?.status !== 'measured' || manifest?.environment?.hardware?.status !== 'measured' || manifest?.assets?.status !== 'measured') issues.push(`${side}: runtime/hardware/asset identity unavailable`);
  }
  if (issues.length) return incomparable();
  for (const field of ['runtimeSha256', 'hardwareSha256', 'assetSha256']) if (result.identities.baseline[field] !== result.identities.candidate[field]) issues.push(`Incomparable ${field}`);
  const samples = result.samples;
  if (!Array.isArray(samples) || samples.length !== p.trials * 2) { issues.push('Missing measured process samples'); return incomparable(); }
  const caseIds = p.cases.map(c => c?.id);
  if (new Set(caseIds).size !== caseIds.length) issues.push('Duplicate workload case');
  if (p.cases.some(c => !['canopy', 'plate', 'bridge'].includes(c?.study) || ![1, 2, 4].includes(c?.instances) || c.id !== `${c.study}.instances-${c.instances}`)) issues.push('Invalid bounded case definition');
  if (issues.length) return incomparable();
  const bySide = { baseline: [], candidate: [] }, pids = new Set();
  for (const sample of samples) {
    const side = sample?.side;
    if (!bySide[side] || sample.schema !== SAMPLE_SCHEMA || sample.status !== 'measured' || !Number.isSafeInteger(sample.trial) || sample.trial < 0 || sample.trial >= p.trials) { issues.push('Invalid or unmeasured process sample'); continue; }
    if (bySide[side][sample.trial]) issues.push(`Duplicate ${side} trial ${sample.trial}`);
    bySide[side][sample.trial] = sample;
    if (!Number.isSafeInteger(sample.pid) || sample.pid <= 0 || pids.has(sample.pid)) issues.push('Samples do not have distinct isolated process identities');
    pids.add(sample.pid);
    if (canonical(sample.identity) !== canonical(result.identities[side]) || sample.protocolSha256 !== result.protocolSha256 || sample.harnessSha256 !== result.harness.sha256) issues.push(`${side}/${sample.trial}: input hash mismatch`);
    if (sample.runtimeSha256 !== sample.identity.runtimeSha256 || sample.hardwareSha256 !== sample.identity.hardwareSha256) issues.push(`${side}/${sample.trial}: measured environment mismatch`);
    if (sample.control?.definitionSha256 !== p.controlDefinitionSha256 || !/^[a-f0-9]{64}$/.test(sample.control?.checksum ?? '') || !Array.isArray(sample.control?.timingsMs) || sample.control.timingsMs.length !== 16 || !sample.control.timingsMs.every(v => Number.isFinite(v) && v > 0)) issues.push(`${side}/${sample.trial}: missing unchanged control samples`);
    if (!Array.isArray(sample.cases) || canonical(sample.cases.map(c => c?.id).sort()) !== canonical([...caseIds].sort())) { issues.push(`${side}/${sample.trial}: workload coverage mismatch`); continue; }
    for (const item of sample.cases) {
      const definition = p.cases.find(c => c.id === item.id);
      if (canonical(item.definition) !== canonical(definition) || item.scope !== p.scope) issues.push(`${item.id}: workload/scope mismatch`);
      if (!item.quality || item.quality.status !== 'measured' || item.quality.equivalence !== 'exact-per-cycle-snapshot-topology-events' || item.quality.fixedDt !== 1 / 120 || !item.quality.settings || !Number.isSafeInteger(item.workload?.nodes) || item.workload.nodes <= 0 || !Number.isSafeInteger(item.workload?.links) || item.workload.links <= 0) issues.push(`${item.id}: missing measured quality/workload`);
      const requestedSettings = Object.fromEntries(['targetLoad', 'strength', 'damping', 'wind', 'press'].map(key => [key, definition[key]]));
      if (canonical(item.quality?.settings) !== canonical(requestedSettings) || item.workload?.instances !== definition.instances || !Number.isSafeInteger(item.quality?.cols) || item.quality.cols < 1 || !Number.isSafeInteger(item.quality?.rows) || item.quality.rows < 1) issues.push(`${item.id}: measured settings/capacity do not match requested protocol`);
      if (item.health?.finite !== true || item.health?.anchors !== true || !/^[a-f0-9]{64}$/.test(item.outputSha256 ?? '')) issues.push(`${item.id}: missing or failed finite/anchor/output verification`);
      for (const metric of METRICS) {
        const values = item.timings?.[metric];
        if (!Array.isArray(values) || values.length !== p.steps || !values.every(n => Number.isFinite(n) && n >= 0)) issues.push(`${item.id}/${metric}: missing or invalid measured samples`);
        // Very small stages can fall below the clock resolution for one cycle.
        // Keep those measured zeros; never replace them with epsilon or invent a
        // sample. A process whose entire stage is unresolved has no valid ratio.
        else if (mean(values) <= 0) issues.push(`${item.id}/${metric}: process mean is below timer resolution`);
      }
      if (METRICS.every(metric => Array.isArray(item.timings?.[metric]) && item.timings[metric].length === p.steps)) {
        for (let cycle = 0; cycle < p.steps; cycle++) if (item.timings.cpuCycleMs[cycle] + 1e-8 < item.timings.stepMs[cycle] + item.timings.snapshotMs[cycle] + item.timings.topologyMs[cycle]) {
          issues.push(`${item.id}: complete CPU cycle excludes recorded stage time`); break;
        }
      }
    }
  }
  if (!Array.isArray(result.executionOrder) || result.executionOrder.length !== p.trials || result.executionOrder.some((order, i) => canonical(order) !== canonical(i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']))) issues.push('Missing balanced AB/BA execution order');
  else if (samples.some((sample, i) => sample?.trial !== Math.floor(i / 2) || sample?.side !== result.executionOrder[Math.floor(i / 2)][i % 2])) issues.push('Actual sample order does not match balanced AB/BA sequence');
  for (const side of Object.keys(bySide)) for (let trial = 0; trial < p.trials; trial++) if (!bySide[side][trial]) issues.push(`Missing ${side} paired trial ${trial}`);
  if (issues.length) return incomparable();
  const allControlChecksums = new Set(samples.map(s => s.control.checksum));
  if (allControlChecksums.size !== 1) issues.push('Unchanged control result differs');
  const controls = bootstrapRatio(bySide.baseline.map(s => mean(s.control.timingsMs)), bySide.candidate.map(s => mean(s.control.timingsMs)), { seed: p.seed });
  const controlFloor = 1 / (1 + controlTolerance), controlCeiling = 1 / (1 - controlTolerance);
  if (controls.ratio < controlFloor || controls.ratio > controlCeiling) regressions.push('Unchanged control drift exceeds tolerance; timing gain is not qualified');
  else if (controls.lower95 < controlFloor || controls.upper95 > controlCeiling) uncertain.push('Unchanged control confidence interval is too wide');
  for (let ci = 0; ci < caseIds.length; ci++) {
    const id = caseIds[ci];
    const baseline = bySide.baseline.map(s => s.cases.find(c => c.id === id)), candidate = bySide.candidate.map(s => s.cases.find(c => c.id === id));
    const reference = baseline[0];
    if ([...baseline, ...candidate].some(c => canonical(c.quality) !== canonical(reference.quality) || canonical(c.workload) !== canonical(reference.workload))) issues.push(`${id}: incomparable numerical quality/settings/capacity`);
    if ([...baseline, ...candidate].some(c => c.outputSha256 !== reference.outputSha256)) regressions.push(`${id}: deterministic trajectory/topology/event fidelity changed`);
    for (const metric of METRICS) {
      const b = baseline.map(c => mean(c.timings[metric])), c = candidate.map(c => mean(c.timings[metric]));
      const speedup = bootstrapRatio(b, c, { seed: p.seed + ci * 10 + METRICS.indexOf(metric) });
      const item = { case: id, metric, baseline: { cycles: summary(baseline.flatMap(c => c.timings[metric])), processMeans: summary(b) },
        candidate: { cycles: summary(candidate.flatMap(c => c.timings[metric])), processMeans: summary(c) }, speedup,
        demonstratedSpeedup: speedup.lower95 > 1, primaryGate: metric === 'cpuCycleMs' };
      comparisons.push(item);
      if (metric === 'cpuCycleMs') {
        const floor = minimumSpeedup ?? 1 / (1 + maxRegression);
        if (speedup.upper95 < floor) regressions.push(`${id}: CPU cycle exceeds declared regression/speedup threshold`);
        else if (speedup.lower95 < floor) uncertain.push(`${id}: CPU cycle confidence interval crosses declared threshold`);
        if (item.candidate.cycles.p95 > item.baseline.cycles.p95 * (1 + maxRegression)) regressions.push(`${id}: measured CPU cycle p95 regressed beyond tolerance`);
      }
    }
  }
  if (issues.length) return { ...incomparable(), controls };
  const status = regressions.length ? 'fail' : uncertain.length ? 'inconclusive' : 'pass';
  return { schema: 'box3d.engine-gate/1', status, issues, regressions, uncertain, controls, comparisons,
    thresholds: { maxRegression, controlTolerance, minSamples, minimumSpeedup },
    claim: status === 'pass' ? 'Qualified only for the recorded Studio CPU cycle workloads; see each measured speedup interval' : 'No qualified performance gain',
    exclusions: ['browser frames', 'GPU timing', 'rendering capacity', 'interactive capacity', 'thermal stability', 'physical engineering accuracy', 'engine-wide speedup'] };
}

export async function readJsonBounded(file, maximumBytes = 24 * 1024 ** 2) {
  const info = await fs.stat(file);
  if (info.size > maximumBytes) throw new Error(`Evidence file exceeds read bound: ${file}`);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function inside(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.')) throw new Error('Unsafe evidence path');
  const resolved = await fs.realpath(path.join(root, relative));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Evidence path escapes run');
  return resolved;
}
export async function verifyRunDirectory(runDirectory, options = {}) {
  const root = await fs.realpath(runDirectory), result = await readJsonBounded(path.join(root, 'result.json'));
  const integrity = [];
  try {
    if (canonical(await readJsonBounded(await inside(root, 'protocol.json'))) !== canonical(result.protocol)) integrity.push('Retained protocol differs from result');
    for (const side of ['baseline', 'candidate']) {
      const manifestPath = await inside(root, `${side}/manifest.json`);
      const manifest = await readJsonBounded(manifestPath);
      if (canonical(manifest) !== canonical(result.manifests?.[side])) integrity.push(`${side}: retained manifest differs from result`);
      const actual = await inventory(await inside(root, `${side}/source`), ['.'], LIMITS.sourceBytes);
      if (actual.sha256 !== manifest.source?.sha256) integrity.push(`${side}: source snapshot hash mismatch`);
      const artifactFiles = actual.files.filter(f => f.path.startsWith('src/') && /\.[cm]?ts$/.test(f.path));
      if (hashValue(artifactFiles) !== manifest.artifacts?.sha256) integrity.push(`${side}: runtime artifact hash mismatch`);
      if (manifest.assets?.status === 'measured') {
        // An exact archive may replace the original location after assets change.
        // Its complete inventory must still match the immutable captured digest.
        const assets = await inventory(options.assetsRoot ?? manifest.assetsRoot, ['.'], LIMITS.assetBytes);
        if (assets.sha256 !== manifest.assets.sha256) integrity.push(`${side}: referenced asset hash mismatch`);
      }
    }
    if (!Array.isArray(result.sampleFiles) || result.sampleFiles.length !== result.samples?.length) integrity.push('Missing raw sample files');
    else for (let i = 0; i < result.sampleFiles.length; i++) {
      const record = result.sampleFiles[i], file = await inside(root, record.path);
      if (await hashFile(file) !== record.sha256 || canonical(await readJsonBounded(file)) !== canonical(result.samples[i])) integrity.push(`Raw sample hash/content mismatch: ${record.path}`);
      const sample = result.samples[i];
      const task = await readJsonBounded(await inside(root, `tasks/${sample.trial}-${sample.side}.json`));
      if (task.side !== sample.side || task.trial !== sample.trial || task.protocolSha256 !== result.protocolSha256 || task.harnessSha256 !== result.harness.sha256 || canonical(task.protocol) !== canonical(result.protocol)) integrity.push(`Worker task contract mismatch: ${record.path}`);
    }
    for (const record of result.harness?.files ?? []) {
      if (await hashFile(await inside(root, `harness/${record.path}`)) !== record.sha256) integrity.push(`Harness hash mismatch: ${record.path}`);
    }
  } catch (error) { integrity.push(`Evidence integrity unavailable: ${error.message}`); }
  const checked = checkResult(result, options);
  if (integrity.length) return { ...checked, status: 'incomparable', issues: [...integrity, ...checked.issues], claim: 'No performance conclusion; retained evidence failed verification' };
  return checked;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['--run', '--assets-root', '--max-regression', '--control-tolerance', '--minimum-speedup']);
  if (args.help) { console.log('node scripts/engine-check.mjs --run RUN_DIRECTORY [--assets-root EXACT_ASSET_ARCHIVE] [--max-regression 0.05 --control-tolerance 0.15 --minimum-speedup 1.1]'); return; }
  if (!args['--run']) throw new Error('--run is required');
  const options = {};
  if (args['--assets-root'] !== undefined) options.assetsRoot = args['--assets-root'];
  for (const [flag, key] of [['--max-regression', 'maxRegression'], ['--control-tolerance', 'controlTolerance'], ['--minimum-speedup', 'minimumSpeedup']]) if (args[flag] !== undefined) options[key] = Number(args[flag]);
  const verdict = await verifyRunDirectory(args['--run'], options);
  console.log(JSON.stringify(verdict, null, 2));
  process.exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'inconclusive' ? 2 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
