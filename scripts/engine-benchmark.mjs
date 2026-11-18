#!/usr/bin/env node
/** Isolated Studio CPU measurements. This does not execute a renderer or measure a frame. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import { canonical, captureBaseline, hashFile, hashValue, inventory, LIMITS, observeEnvironment, parseArgs,
  reserveRunDirectory, unavailable, verifyManifestStructure, writeJsonExclusive } from './engine-baseline.mjs';
import { checkResult, METRICS, random, readJsonBounded, RESULT_SCHEMA, SAMPLE_SCHEMA, verifyRunDirectory } from './engine-check.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const CONTROL = Object.freeze({ name: 'unchanged-integer-mix/1', iterations: 1000000, seed: 31337 });
const PRESS = Object.freeze({ metal: 'mild-steel', thickness: 2, tool: 'round', toolScale: 1, angle: 0,
  pressure: 80, strikeSpeed: 50, stroke: 130, hold: 2 });
function integerControl() {
  let value = CONTROL.seed;
  for (let i = 0; i < CONTROL.iterations; i++) value = Math.imul(value ^ (value >>> 13) ^ i, 1664525) + 1013904223 | 0;
  return value >>> 0;
}
const controlDefinitionSha256 = hashValue({ code: integerControl.toString(), settings: CONTROL });
function controlBlock() {
  const timingsMs = [], checksums = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now(), checksum = integerControl();
    timingsMs.push(performance.now() - start); checksums.push(checksum);
  }
  return { timingsMs, checksums };
}
function integerOption(value, fallback, minimum, maximum, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be an integer in ${minimum}..${maximum}`);
  return number;
}
export function makeProtocol(args = {}) {
  const trials = integerOption(args['--trials'], 6, 4, 20, '--trials');
  if (trials % 2) throw new Error('--trials must be even for balanced AB/BA execution');
  const warmupSteps = integerOption(args['--warmup'], 60, 1, 600, '--warmup');
  const steps = integerOption(args['--steps'], 120, 2, 600, '--steps');
  const seed = integerOption(args['--seed'], 100, 0, 0xFFFFFFFF, '--seed');
  const instances = (args['--instances'] ?? '1,2,4').split(',').map(Number);
  if (!instances.length || instances.length > 3 || new Set(instances).size !== instances.length || instances.some(n => ![1, 2, 4].includes(n))) throw new Error('--instances accepts unique values from 1,2,4 only');
  const studies = (args['--studies'] ?? 'canopy,plate,bridge').split(',');
  if (!studies.length || studies.length > 3 || new Set(studies).size !== studies.length || studies.some(s => !['canopy', 'plate', 'bridge'].includes(s))) throw new Error('--studies accepts canopy,plate,bridge only');
  const totalSimulationSteps = trials * 2 * (warmupSteps + steps) * instances.reduce((a, b) => a + b, 0) * studies.length;
  if (totalSimulationSteps > 200000) throw new Error('Experiment exceeds the 200000 simulated-step budget; reduce trials/steps/instances/studies');
  const estimatedRawBytes = trials * 2 * steps * instances.length * studies.length * METRICS.length * 24;
  if (estimatedRawBytes > 12 * 1024 ** 2) throw new Error('Experiment exceeds the 12 MiB raw-number estimate');
  const cpuCycleBudgetMs = args['--cpu-budget-ms'] === undefined ? 1000 / 120 : Number(args['--cpu-budget-ms']);
  if (!Number.isFinite(cpuCycleBudgetMs) || cpuCycleBudgetMs < 1 || cpuCycleBudgetMs > 1000) throw new Error('--cpu-budget-ms must be 1..1000');
  return { schema: 'box3d.engine-protocol/1', scope: 'studio-cpu-step-snapshot-topology/1', trials, warmupSteps, steps, seed,
    fixedDt: 1 / 120, seedUse: 'Seeded case ordering and Math.random replacement; the authored reduced model has no stochastic forces',
    cases: studies.flatMap(study => instances.map(count => ({ id: `${study}.instances-${count}`, study, instances: count,
      targetLoad: study === 'plate' ? 4 : .8, strength: 1, damping: .022, wind: .25, press: { ...PRESS } }))),
    controlDefinitionSha256, control: CONTROL, cpuCycleBudgetMs, totalSimulationSteps,
    timing: { clock: 'node:perf_hooks.performance.now', unit: 'ms', stepMs: 'sum of step calls for all independent instances',
      snapshotMs: 'sum of immutable snapshot calls for all instances', topologyMs: 'sum of activeIndices calls for all instances',
      cpuCycleMs: 'wall time for all instance step/snapshot/topology calls plus timing instrumentation',
      excludes: ['construction/reset', 'type stripping/import', 'hashing/verification', 'GPU submission/execution', 'rendering', 'browser scheduling'],
      warmup: 'Warm each case using the same calls, then construct fresh instances before timing',
      statistics: 'Raw cycles, process-mean median/p95, and paired-process bootstrap 95% intervals; no cross-stage multiplication' },
    fidelity: 'Exact per-cycle snapshot arrays and response, active topology, and final events; finite state and pinned anchors',
    limits: { maximumChildMs: 45000, maximumSimulationSteps: 200000, maximumRawNumberBytes: 12 * 1024 ** 2 } };
}

function digestSnapshot(hash, snapshot, topology) {
  for (const name of ['positions', 'broken', 'strains']) {
    const values = snapshot[name];
    if (!ArrayBuffer.isView(values)) throw new Error(`Snapshot ${name} is not a typed buffer`);
    hash.update(name).update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  }
  hash.update(canonical({ punchY: snapshot.punchY, response: snapshot.response, press: snapshot.press ?? null }));
  hash.update(Buffer.from(Uint32Array.from(topology).buffer));
}
function validateSnapshot(snapshot) {
  for (const name of ['positions', 'strains']) if (!snapshot[name].every(Number.isFinite)) throw new Error(`Non-finite ${name}`);
  if (!Number.isFinite(snapshot.punchY) || !Object.values(snapshot.response).every(value => typeof value !== 'number' || Number.isFinite(value))) throw new Error('Non-finite response');
}

async function worker(taskPath) {
  const task = await readJsonBounded(taskPath), p = task.protocol;
  if (hashValue(p) !== task.protocolSha256 || p.controlDefinitionSha256 !== controlDefinitionSha256 || hashValue(p.control) !== hashValue(CONTROL)) throw new Error('Worker protocol/control identity mismatch');
  const manifest = await readJsonBounded(path.join(task.captureRoot, 'manifest.json'));
  const manifestProblems = verifyManifestStructure(manifest);
  if (manifestProblems.length) throw new Error(manifestProblems.join('; '));
  const sourceRoot = path.join(task.captureRoot, manifest.snapshotRoot);
  const actual = await inventory(sourceRoot, ['.'], LIMITS.sourceBytes);
  if (actual.sha256 !== manifest.identity.sourceSha256) throw new Error('Worker snapshot input hash mismatch');
  // Match the project's .ts and extensionless local imports, without package/dependency fallbacks.
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      if (!/\.[a-z]+$/i.test(specifier)) {
        const target = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(target)) return next(target.href, context);
      }
    }
    return next(specifier, context);
  } });
  const { FailureSimulation, FIXED_DT } = await import(pathToFileURL(path.join(sourceRoot, 'src/studio/physics.ts')).href);
  if (typeof FailureSimulation !== 'function' || FIXED_DT !== p.fixedDt) throw new Error('Studio model API/timestep differs from the benchmark contract');
  const environment = await observeEnvironment();
  for (const category of ['runtime', 'hardware']) if (hashValue(environment[category]) !== manifest.identity[`${category}Sha256`]) {
    const fields = Object.keys(environment[category]).filter(key => hashValue(environment[category][key]) !== hashValue(manifest.environment[category][key]));
    throw new Error(`Worker ${category} differs from capture: ${fields.join(', ')}`);
  }
  for (let i = 0; i < 16; i++) integerControl();
  const before = controlBlock(), cases = [];
  const order = [...p.cases], rng = random(p.seed + task.trial);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const definition of order) {
    function makeInstances() {
      Math.random = random(p.seed);
      return Array.from({ length: definition.instances }, () => {
        const simulation = new FailureSimulation(definition.study, definition.press);
        for (const key of ['targetLoad', 'strength', 'damping', 'wind']) simulation[key] = definition[key];
        return simulation;
      });
    }
    let simulations = makeInstances();
    for (let step = 0; step < p.warmupSteps; step++) for (const simulation of simulations) { simulation.step(p.fixedDt); simulation.snapshot(); simulation.activeIndices(); }
    simulations = makeInstances();
    const first = simulations[0], cpuStart = process.cpuUsage(), memoryBefore = process.memoryUsage();
    const workload = { instances: simulations.length, nodes: simulations.reduce((n, s) => n + s.nodes.length, 0),
      links: simulations.reduce((n, s) => n + s.links.length, 0), faces: simulations.reduce((n, s) => n + s.faces.length, 0),
      perInstance: { nodes: first.nodes.length, links: first.links.length, faces: first.faces.length } };
    const quality = { status: 'measured', equivalence: 'exact-per-cycle-snapshot-topology-events', fixedDt: FIXED_DT,
      model: 'authored-Studio-reduced-failure-model', cols: first.config.cols, rows: first.config.rows,
      settings: { targetLoad: first.targetLoad, strength: first.strength, damping: first.damping, wind: first.wind, press: { ...first.press } },
      solverIterations: unavailable('No public iteration setting; exact trajectory comparison qualifies this CPU reference'),
      physicalAccuracy: unavailable('No calibrated material or engineering reference measurements') };
    const timings = Object.fromEntries(METRICS.map(metric => [metric, []]));
    const output = createHash('sha256');
    let typedSnapshotBytesPerCycle = 0;
    for (const simulation of simulations) digestSnapshot(output, simulation.snapshot(), simulation.activeIndices());
    for (let step = 0; step < p.steps; step++) {
      let stepMs = 0, snapshotMs = 0, topologyMs = 0;
      const observations = [];
      const cycleStart = performance.now();
      for (const simulation of simulations) {
        const t0 = performance.now(); simulation.step(p.fixedDt);
        const t1 = performance.now(), snapshot = simulation.snapshot();
        const t2 = performance.now(), topology = simulation.activeIndices();
        const t3 = performance.now();
        stepMs += t1 - t0; snapshotMs += t2 - t1; topologyMs += t3 - t2;
        observations.push({ snapshot, topology });
      }
      timings.cpuCycleMs.push(performance.now() - cycleStart);
      timings.stepMs.push(stepMs); timings.snapshotMs.push(snapshotMs); timings.topologyMs.push(topologyMs);
      // Instrumentation and correctness hashes are deliberately outside the timed CPU cycle.
      let typedBytes = 0;
      for (const { snapshot, topology } of observations) {
        validateSnapshot(snapshot); digestSnapshot(output, snapshot, topology);
        typedBytes += snapshot.positions.byteLength + snapshot.broken.byteLength + snapshot.strains.byteLength;
      }
      typedSnapshotBytesPerCycle = Math.max(typedSnapshotBytesPerCycle, typedBytes);
    }
    let anchors = true;
    for (const simulation of simulations) {
      for (const index of simulation.supports) for (let axis = 0; axis < 3; axis++) if (simulation.nodes[index].p[axis] !== simulation.nodes[index].rest[axis]) anchors = false;
      output.update(canonical(simulation.events));
    }
    const memoryAfter = process.memoryUsage();
    cases.push({ id: definition.id, definition, scope: p.scope, quality, workload, timings,
      outputSha256: output.digest('hex'), health: { finite: true, anchors },
      allocation: { status: 'measured', typedSnapshotBytesPerCycle,
        excludes: 'Temporary JS arrays, topology arrays, implementation caches, and retained heap are not inferred from typed bytes' },
      processResourceObservations: { cpuMicroseconds: process.cpuUsage(cpuStart), heapBeforeBytes: memoryBefore.heapUsed,
        heapAfterBytes: memoryAfter.heapUsed, rssAfterBytes: memoryAfter.rss, maximumRssKiB: process.resourceUsage().maxRSS,
        scope: 'Process observations include untimed verification and do not estimate bytes allocated per operation' } });
  }
  const after = controlBlock();
  const unchanged = await inventory(sourceRoot, ['.'], LIMITS.sourceBytes);
  if (unchanged.sha256 !== manifest.identity.sourceSha256) throw new Error('Source snapshot changed during measurement');
  return { schema: SAMPLE_SCHEMA, status: 'measured', side: task.side, trial: task.trial, pid: process.pid,
    capturedAt: new Date().toISOString(), identity: manifest.identity, harnessSha256: task.harnessSha256,
    protocolSha256: task.protocolSha256, runtimeSha256: hashValue(environment.runtime), hardwareSha256: hashValue(environment.hardware),
    control: { definitionSha256: controlDefinitionSha256, timingsMs: [...before.timingsMs, ...after.timingsMs],
      checksum: hashValue([...before.checksums, ...after.checksums]), placement: '8 before and 8 after the workload suite' }, cases };
}

export async function runBenchmark(args) {
  const protocol = makeProtocol(args);
  if (!args['--baseline-root'] || !args['--candidate-root'] || !args['--out']) throw new Error('--baseline-root, --candidate-root, and --out are required');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ with native TypeScript stripping and registerHooks is required');
  const wallSeconds = integerOption(args['--wall-seconds'], 300, 30, 600, '--wall-seconds');
  const baselineRoot = await fs.realpath(args['--baseline-root']), candidateRoot = await fs.realpath(args['--candidate-root']);
  const out = await reserveRunDirectory(args['--out'], [baselineRoot, candidateRoot]);
  const started = Date.now();
  try {
    for (const directory of ['baseline', 'candidate', 'harness', 'raw', 'tasks']) await fs.mkdir(path.join(out, directory));
    const files = [];
    for (const name of ['engine-baseline.mjs', 'engine-benchmark.mjs', 'engine-check.mjs']) {
      const bytes = await fs.readFile(path.join(scriptDirectory, name));
      await fs.writeFile(path.join(out, 'harness', name), bytes, { flag: 'wx' });
      files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const harness = { files, sha256: hashValue(files) };
    const manifests = {};
    for (const [side, root] of [['baseline', baselineRoot], ['candidate', candidateRoot]]) {
      manifests[side] = await captureBaseline({ root, out: path.join(out, side), assetsRoot: args['--assets-root'], reserved: true });
    }
    const protocolSha256 = hashValue(protocol);
    await writeJsonExclusive(path.join(out, 'protocol.json'), protocol);
    const samples = [], sampleFiles = [], executionOrder = [];
    for (let trial = 0; trial < protocol.trials; trial++) {
      const order = trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
      executionOrder.push(order);
      for (const side of order) {
        const remaining = wallSeconds * 1000 - (Date.now() - started);
        if (remaining <= 0) throw new Error(`Run exceeded its ${wallSeconds}s wall-clock bound`);
        const taskPath = path.join(out, 'tasks', `${trial}-${side}.json`);
        await writeJsonExclusive(taskPath, { side, trial, protocol, protocolSha256, harnessSha256: harness.sha256, captureRoot: path.join(out, side) });
        const { stdout } = await execFileAsync(process.execPath, [path.join(out, 'harness/engine-benchmark.mjs'), '--worker', taskPath],
          { cwd: out, timeout: Math.min(protocol.limits.maximumChildMs, remaining), maxBuffer: 4 * 1024 ** 2,
            env: { ...process.env, NODE_OPTIONS: '', NODE_NO_WARNINGS: '1' } });
        const sample = JSON.parse(stdout);
        const relative = `raw/${trial}-${side}.json`, rawPath = path.join(out, relative);
        await writeJsonExclusive(rawPath, sample);
        samples.push(sample); sampleFiles.push({ path: relative, sha256: await hashFile(rawPath) });
        console.error(`Measured ${side} trial ${trial + 1}/${protocol.trials} (${protocol.cases.length} CPU cases)`);
      }
    }
    const result = { schema: RESULT_SCHEMA, capturedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      protocol, protocolSha256, harness, manifests, identities: { baseline: manifests.baseline.identity, candidate: manifests.candidate.identity },
      executionOrder, samples, sampleFiles,
      unmeasured: { browserFrames: unavailable('No browser executed'), gpuTime: unavailable('No GPU executed'),
        interactiveCapacity: unavailable('Independent CPU instances do not establish interactive/rendered capacity'),
        renderingCapacity: unavailable('No rendering workload executed'),
        engineeringAccuracy: unavailable('Preservation of an authored reduced model is not physical calibration') } };
    let verdict = checkResult(result);
    const capacityPoints = verdict.comparisons.filter(c => c.metric === 'cpuCycleMs').map(c => ({
      case: c.case, baselineP95Ms: c.baseline.cycles.p95, candidateP95Ms: c.candidate.cycles.p95,
      baselineWithinCpuBudget: c.baseline.cycles.p95 <= protocol.cpuCycleBudgetMs,
      candidateWithinCpuBudget: c.candidate.cycles.p95 <= protocol.cpuCycleBudgetMs }));
    result.cpuCapacitySweep = { scope: 'Independent Studio CPU instances with fixed authored mesh sizes',
      cpuCycleBudgetMs: protocol.cpuCycleBudgetMs, points: capacityPoints,
      frontier: unavailable('Only the requested 1/2/4 instance points were tested; no extrapolation or rendered frame claim') };
    await writeJsonExclusive(path.join(out, 'result.json'), result);
    verdict = await verifyRunDirectory(out);
    await writeJsonExclusive(path.join(out, 'gate.json'), verdict);
    return { out, verdict };
  } catch (error) {
    await writeJsonExclusive(path.join(out, 'failure.json'), { status: 'failed', capturedAt: new Date().toISOString(), message: error.message,
      code: error.code ?? null, signal: error.signal ?? null, killed: error.killed ?? false,
      workerStderr: typeof error.stderr === 'string' ? error.stderr.slice(0, 8192) : null,
      elapsedMs: Date.now() - started, scope: 'Partial evidence; no performance conclusion' }).catch(() => {});
    throw error;
  }
}

async function main() {
  if (process.argv[2] === '--worker') { process.stdout.write(JSON.stringify(await worker(process.argv[3]))); return; }
  const args = parseArgs(process.argv.slice(2), ['--baseline-root', '--candidate-root', '--out', '--assets-root', '--trials', '--warmup', '--steps', '--instances', '--studies', '--seed', '--cpu-budget-ms', '--wall-seconds']);
  if (args.help) { console.log('node scripts/engine-benchmark.mjs --baseline-root ROOT --candidate-root ROOT --out NEW_RUN [--assets-root PUBLIC] [--trials 6 --warmup 60 --steps 120 --instances 1,2,4 --studies canopy,plate,bridge --seed 100 --wall-seconds 300]'); return; }
  const { out, verdict } = await runBenchmark(args);
  console.log(JSON.stringify({ run: out, status: verdict.status, issues: verdict.issues, regressions: verdict.regressions, uncertain: verdict.uncertain, claim: verdict.claim }));
  // Measurements remain useful even if noisy; a qualified gate is deliberately separate.
  process.exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'inconclusive' ? 2 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
