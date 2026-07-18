'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const baselineArchive = path.join(root, 'benchmarks', 'baselines', 'box3d-webgpu-v1.12.0-source.tar.gz');
const resultsDir = path.join(root, 'benchmarks', 'results');
const generatedThreshold = process.env.WATER_FOCUSED_THRESHOLD
  ? Number.parseInt(process.env.WATER_FOCUSED_THRESHOLD, 10)
  : 0;
const existingThreshold = process.env.WATER_FOCUSED_EXISTING_THRESHOLD
  ? Number.parseInt(process.env.WATER_FOCUSED_EXISTING_THRESHOLD, 10)
  : 0;
const policyThreshold = generatedThreshold || existingThreshold;
const outputStem = generatedThreshold ? `v113-water-threshold-${generatedThreshold}` : 'v113-water-focused';
const jsonPath = path.join(resultsDir, `${outputStem}.json`);
const markdownPath = path.join(resultsDir, `${outputStem}.md`);
const sampleCount = Math.max(4, Number.parseInt(process.env.WATER_FOCUSED_SAMPLES || '8', 10));
const bootstrapCount = Math.max(1000, Number.parseInt(process.env.WATER_FOCUSED_BOOTSTRAPS || '10000', 10));
const dropletCounts = [0, 1, 16, 64, 128, 144, 256, 512, 768];
const currentSource = path.join(root, 'src', 'soft', 'simulations.ts');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) * 0.5 : sorted[middle];
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / Math.max(1, values.length));
}

function bootstrapInterval(before, after, rounds, seed) {
  let state = seed >>> 0;
  const randomIndex = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * before.length);
  };
  const ratios = new Float64Array(rounds);
  for (let round = 0; round < rounds; round++) {
    const sampledBefore = new Array(before.length);
    const sampledAfter = new Array(after.length);
    for (let index = 0; index < before.length; index++) {
      const selected = randomIndex();
      sampledBefore[index] = before[selected];
      sampledAfter[index] = after[selected];
    }
    ratios[round] = median(sampledBefore) / median(sampledAfter);
  }
  ratios.sort();
  return [ratios[Math.floor(rounds * 0.025)], ratios[Math.min(rounds - 1, Math.floor(rounds * 0.975))]];
}

async function compileBuilds(work) {
  const baselineSource = path.join(work, 'baseline-source');
  const baselineBuild = path.join(work, 'baseline-build');
  const candidateBuild = path.join(work, 'candidate-build');
  await fsp.mkdir(baselineSource, { recursive: true });
  execFileSync('tar', ['-xzf', baselineArchive, '-C', baselineSource], { stdio: 'inherit' });
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  execFileSync(tsc, ['-p', path.join(baselineSource, 'tsconfig.test.json'), '--outDir', baselineBuild], { stdio: 'inherit' });
  let candidateProject = root;
  if (generatedThreshold > 0) {
    candidateProject = path.join(work, 'candidate-source');
    await fsp.cp(baselineSource, candidateProject, { recursive: true });
    const sourceFile = path.join(candidateProject, 'src', 'soft', 'simulations.ts');
    let source = await fsp.readFile(sourceFile, 'utf8');
    const start = source.indexOf('  private updateDroplets(dt: number): void {');
    const end = source.indexOf('  private updateFloaters(dt: number): void {', start);
    assert.ok(start >= 0 && end > start, 'unable to locate baseline water droplet updater');
    const replacement = `  private sampleHeightIntoScratch(x: number, z: number): void {\n` +
      `    let gx = (x / this.width + 0.5) * (this.cols - 1);\n` +
      `    let gz = (z / this.depth + 0.5) * (this.rows - 1);\n` +
      `    const maxX = this.cols - 1.001;\n` +
      `    const maxZ = this.rows - 1.001;\n` +
      `    gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;\n` +
      `    gz = gz < 0 ? 0 : gz > maxZ ? maxZ : gz;\n` +
      `    const x0 = Math.floor(gx);\n` +
      `    const z0 = Math.floor(gz);\n` +
      `    const tx = gx - x0;\n` +
      `    const tz = gz - z0;\n` +
      `    const oneMinusX = 1 - tx;\n` +
      `    const oneMinusZ = 1 - tz;\n` +
      `    const i00 = z0 * this.cols + x0;\n` +
      `    const i10 = i00 + 1;\n` +
      `    const i01 = i00 + this.cols;\n` +
      `    const i11 = i01 + 1;\n` +
      `    const etaA = this.eta[i00] * oneMinusX + this.eta[i10] * tx;\n` +
      `    const etaB = this.eta[i01] * oneMinusX + this.eta[i11] * tx;\n` +
      `    this.sampleHeight = this.baseY + etaA * oneMinusZ + etaB * tz;\n` +
      `  }\n\n` +
      `  private updateDroplets(dt: number): void {\n` +
      `    if (this.droplets.length >= ${generatedThreshold}) {\n` +
      `      this.updateDropletsFast(dt);\n` +
      `      return;\n` +
      `    }\n` +
      `    for (const droplet of this.droplets) {\n` +
      `      droplet.life -= dt;\n` +
      `      droplet.velocity[1] -= 9.81 * dt;\n` +
      `      droplet.position[0] += droplet.velocity[0] * dt;\n` +
      `      droplet.position[1] += droplet.velocity[1] * dt;\n` +
      `      droplet.position[2] += droplet.velocity[2] * dt;\n` +
      `      this.sampleIntoScratch(droplet.position[0], droplet.position[2]);\n` +
      `      if (droplet.position[1] <= this.sampleHeight && droplet.life > 0) {\n` +
      `        const speed = Math.abs(droplet.velocity[1]);\n` +
      `        this.disturb(droplet.position[0], droplet.position[2], clamp(speed * 0.025, 0.04, 0.36), clamp(droplet.radius * 5, 0.5, 1.6), speed * 0.025);\n` +
      `        droplet.life = 0;\n` +
      `      }\n` +
      `    }\n` +
      `    let write = 0;\n` +
      `    for (let read = 0; read < this.droplets.length; read++) {\n` +
      `      const droplet = this.droplets[read];\n` +
      `      if (droplet.life > 0) this.droplets[write++] = droplet;\n` +
      `    }\n` +
      `    this.droplets.length = write;\n` +
      `  }\n\n` +
      `  private updateDropletsFast(dt: number): void {\n` +
      `    for (const droplet of this.droplets) {\n` +
      `      droplet.life -= dt;\n` +
      `      if (droplet.life <= 0) continue;\n` +
      `      droplet.velocity[1] -= 9.81 * dt;\n` +
      `      droplet.position[0] += droplet.velocity[0] * dt;\n` +
      `      droplet.position[1] += droplet.velocity[1] * dt;\n` +
      `      droplet.position[2] += droplet.velocity[2] * dt;\n` +
      `      this.sampleHeightIntoScratch(droplet.position[0], droplet.position[2]);\n` +
      `      if (droplet.position[1] <= this.sampleHeight) {\n` +
      `        const speed = Math.abs(droplet.velocity[1]);\n` +
      `        this.disturb(droplet.position[0], droplet.position[2], clamp(speed * 0.025, 0.04, 0.36), clamp(droplet.radius * 5, 0.5, 1.6), speed * 0.025);\n` +
      `        droplet.life = 0;\n` +
      `      }\n` +
      `    }\n` +
      `    let write = 0;\n` +
      `    for (let read = 0; read < this.droplets.length; read++) {\n` +
      `      const droplet = this.droplets[read];\n` +
      `      if (droplet.life > 0) this.droplets[write++] = droplet;\n` +
      `    }\n` +
      `    this.droplets.length = write;\n` +
      `  }\n\n`;
    source = source.slice(0, start) + replacement + source.slice(end);
    await fsp.writeFile(sourceFile, source);
  }
  execFileSync(tsc, ['-p', path.join(candidateProject, 'tsconfig.test.json'), '--outDir', candidateBuild], { stdio: 'inherit' });
  for (const build of [baselineBuild, candidateBuild]) {
    await fsp.mkdir(build, { recursive: true });
    await fsp.writeFile(path.join(build, 'package.json'), '{"type":"commonjs"}\n');
  }
  return { baselineSource, baselineBuild, candidateBuild, candidateProject };
}

async function instantiateKernel(build, baselineSource, backend) {
  if (backend === 'javascript') return null;
  const { SoftKernelModule } = require(path.join(build, 'src', 'soft', 'kernels.js'));
  const file = path.join(baselineSource, 'public', `soft-kernels-${backend}.wasm`);
  const bytes = await fsp.readFile(file);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return new SoftKernelModule(backend, instance.exports);
}

async function loadImplementation(label, build, baselineSource) {
  const { SoftSimulationSuite } = require(path.join(build, 'src', 'soft', 'simulations.js'));
  const { SCENES } = require(path.join(build, 'src', 'scenes.js'));
  return {
    label,
    SoftSimulationSuite,
    SCENES,
    kernels: {
      simd: await instantiateKernel(build, baselineSource, 'simd'),
      scalar: await instantiateKernel(build, baselineSource, 'scalar'),
      javascript: null,
    },
  };
}

function createSuite(implementation, testCase, seed) {
  const suite = new implementation.SoftSimulationSuite(implementation.kernels[testCase.backend]);
  assert.equal(suite.createScene(implementation.SCENES[testCase.sceneId], 5, seed), true);
  const active = suite.active;
  if (testCase.count > 0) {
    assert.equal(suite.spawnRain(testCase.count, 11, 50), testCase.count);
    assert.equal(active.droplets.length, testCase.count);
    for (let index = 0; index < active.droplets.length; index++) {
      const droplet = active.droplets[index];
      droplet.position[1] = 50 + (index % 11) * 0.01;
      droplet.velocity[1] = 0;
      droplet.life = testCase.kind === 'expiring' ? 1e-9 : 100;
    }
  }
  return suite;
}

function runFrame(suite) {
  suite.step(1 / 60, 4);
  return suite.buildFrame(false);
}

function exactTypedArray(left, right, label) {
  assert.equal(left.constructor.name, right.constructor.name, `${label}: type`);
  assert.equal(left.length, right.length, `${label}: length`);
  const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  assert.equal(Buffer.compare(leftBytes, rightBytes), 0, `${label}: bytes`);
}

function exactNumbers(left, right, label) {
  assert.equal(left.length, right.length, `${label}: length`);
  for (let index = 0; index < left.length; index++) {
    assert.ok(Object.is(left[index], right[index]), `${label}[${index}]: ${left[index]} !== ${right[index]}`);
  }
}

function flattenDroplets(droplets) {
  const output = new Float64Array(droplets.length * 8);
  let cursor = 0;
  for (const droplet of droplets) {
    output[cursor++] = droplet.position[0];
    output[cursor++] = droplet.position[1];
    output[cursor++] = droplet.position[2];
    output[cursor++] = droplet.velocity[0];
    output[cursor++] = droplet.velocity[1];
    output[cursor++] = droplet.velocity[2];
    output[cursor++] = droplet.radius;
    output[cursor++] = droplet.life;
  }
  return output;
}

function flattenFloaters(floaters) {
  const output = new Float64Array(floaters.length * 14);
  let cursor = 0;
  for (const floater of floaters) {
    for (const value of floater.position) output[cursor++] = value;
    for (const value of floater.velocity) output[cursor++] = value;
    for (const value of floater.half) output[cursor++] = value;
    for (const value of floater.color) output[cursor++] = value;
    output[cursor++] = floater.mass;
  }
  return output;
}

function compareState(baselineSuite, candidateSuite, label) {
  const baseline = baselineSuite.active;
  const candidate = candidateSuite.active;
  for (const field of ['eta', 'u', 'v', 'nextEta', 'nextU', 'nextV']) {
    exactTypedArray(baseline[field], candidate[field], `${label}.${field}`);
  }
  exactNumbers(flattenDroplets(baseline.droplets), flattenDroplets(candidate.droplets), `${label}.droplets`);
  exactNumbers(flattenFloaters(baseline.floaters), flattenFloaters(candidate.floaters), `${label}.floaters`);
  for (const field of ['time', 'energyValue', 'hashValue', 'hashCountdown', 'frameVersion']) {
    assert.ok(Object.is(baseline[field], candidate[field]), `${label}.${field}`);
  }
  assert.equal(baseline.rng.state, candidate.rng.state, `${label}.rng`);
  if (baseline.kernelPointers || candidate.kernelPointers) {
    assert.deepEqual(baseline.kernelPointers, candidate.kernelPointers, `${label}.kernelPointers`);
  }
  const baselineFrame = baselineSuite.buildFrame(false);
  const candidateFrame = candidateSuite.buildFrame(false);
  assert.equal(baselineFrame.instanceCount, candidateFrame.instanceCount, `${label}.instanceCount`);
  exactTypedArray(
    baselineFrame.matrices.subarray(0, baselineFrame.instanceCount * 16),
    candidateFrame.matrices.subarray(0, candidateFrame.instanceCount * 16),
    `${label}.matrices`,
  );
  exactTypedArray(
    baselineFrame.colors.subarray(0, baselineFrame.instanceCount * 4),
    candidateFrame.colors.subarray(0, candidateFrame.instanceCount * 4),
    `${label}.colors`,
  );
}

function updateDigest(hash, suite) {
  const active = suite.active;
  for (const field of ['eta', 'u', 'v', 'nextEta', 'nextU', 'nextV']) {
    hash.update(Buffer.from(active[field].buffer, active[field].byteOffset, active[field].byteLength));
  }
  const droplets = flattenDroplets(active.droplets);
  const floaters = flattenFloaters(active.floaters);
  hash.update(Buffer.from(droplets.buffer));
  hash.update(Buffer.from(floaters.buffer));
  hash.update(Buffer.from(new Float64Array([
    active.time,
    active.energyValue,
    active.hashValue,
    active.hashCountdown,
    active.frameVersion,
    active.rng.state,
  ]).buffer));
}

async function exactTrace(baseline, candidate, testCase) {
  const seed = 0x713000 + testCase.id;
  const baselineSuite = createSuite(baseline, testCase, seed);
  const candidateSuite = createSuite(candidate, testCase, seed);
  const baselineDigest = crypto.createHash('sha256');
  const candidateDigest = crypto.createHash('sha256');
  const frames = testCase.kind === 'control' ? 96 : testCase.kind === 'expiring' ? 8 : 32;
  for (let frame = 0; frame < frames; frame++) {
    runFrame(baselineSuite);
    runFrame(candidateSuite);
    compareState(baselineSuite, candidateSuite, `${testCase.name}.frame${frame}`);
    updateDigest(baselineDigest, baselineSuite);
    updateDigest(candidateDigest, candidateSuite);
  }
  // Force a later full eta/u/v sample after height-only droplet sampling. This
  // proves the intentionally excluded scratch velocity fields cannot leak into
  // subsequent authoritative state.
  baselineSuite.explode([0, 5, 0], 9, 6);
  candidateSuite.explode([0, 5, 0], 9, 6);
  for (let frame = 0; frame < 6; frame++) {
    runFrame(baselineSuite);
    runFrame(candidateSuite);
    compareState(baselineSuite, candidateSuite, `${testCase.name}.continuation${frame}`);
    updateDigest(baselineDigest, baselineSuite);
    updateDigest(candidateDigest, candidateSuite);
  }
  const baselineHex = baselineDigest.digest('hex');
  const candidateHex = candidateDigest.digest('hex');
  assert.equal(candidateHex, baselineHex, `${testCase.name}: history digest`);
  baselineSuite.destroy();
  candidateSuite.destroy();
  return { frames: frames + 6, digest: baselineHex };
}

function measureOneFrame(implementation, testCase, seed) {
  const suite = createSuite(implementation, testCase, seed);
  const start = performance.now();
  runFrame(suite);
  const elapsed = performance.now() - start;
  suite.destroy();
  return elapsed;
}

function measureSample(implementation, testCase, sample) {
  const suite = createSuite(implementation, testCase, 0x517000 + testCase.id * 1009 + sample * 131);
  let elapsed;
  if (testCase.kind === 'expiring' && testCase.count > 0) {
    const active = suite.active;
    const pool = [...active.droplets];
    const templates = pool.map((droplet) => ({
      position: [...droplet.position],
      velocity: [...droplet.velocity],
      radius: droplet.radius,
    }));
    elapsed = 0;
    for (let operation = 0; operation < testCase.operations; operation++) {
      active.droplets.length = 0;
      for (let index = 0; index < pool.length; index++) {
        const droplet = pool[index];
        const template = templates[index];
        droplet.position[0] = template.position[0];
        droplet.position[1] = template.position[1];
        droplet.position[2] = template.position[2];
        droplet.velocity[0] = template.velocity[0];
        droplet.velocity[1] = template.velocity[1];
        droplet.velocity[2] = template.velocity[2];
        droplet.radius = template.radius;
        droplet.life = 1e-9;
        active.droplets.push(droplet);
      }
      const start = performance.now();
      runFrame(suite);
      elapsed += performance.now() - start;
    }
  } else {
    const start = performance.now();
    for (let operation = 0; operation < testCase.operations; operation++) runFrame(suite);
    elapsed = performance.now() - start;
  }
  suite.destroy();
  return elapsed / testCase.operations;
}

function makeCases() {
  const cases = [];
  let id = 1;
  const operationsFor = (count) => count <= 16 ? 120 : count <= 64 ? 100 : count <= 144 ? 80 : count <= 256 ? 70 : count <= 512 ? 60 : 50;
  for (const backend of ['simd', 'scalar', 'javascript']) {
    for (const count of dropletCounts) {
      cases.push({ id: id++, name: `active-${backend}-${count}`, category: 'active-droplets', kind: 'active', backend, sceneId: 700, count, operations: operationsFor(count) });
    }
    for (const count of dropletCounts) {
      cases.push({ id: id++, name: `expiring-${backend}-${count}`, category: 'expiring-droplets', kind: 'expiring', backend, sceneId: 700, count, operations: operationsFor(count) });
    }
    for (const sceneId of [700, 701, 703, 706, 708]) {
      cases.push({ id: id++, name: `steady-${backend}-${sceneId}`, category: 'steady-controls', kind: 'control', backend, sceneId, count: 0, operations: 120 });
    }
  }
  return cases;
}

function summarize(results) {
  const categories = {};
  for (const result of results) {
    (categories[result.category] ||= []).push(result.speedup);
  }
  return Object.fromEntries(Object.entries(categories).map(([name, speedups]) => [name, {
    count: speedups.length,
    geometricMean: geometricMean(speedups),
    minimum: Math.min(...speedups),
    maximum: Math.max(...speedups),
  }]));
}

function recommendation(results, category, predicate = () => true) {
  const selected = results.filter((result) => result.category === category && predicate(result));
  const speedups = selected.map((result) => result.speedup);
  const lowerBounds = selected.map((result) => result.interval95[0]);
  const geometric = geometricMean(speedups);
  const minimum = Math.min(...speedups);
  const worstLower = Math.min(...lowerBounds);
  return { cases: selected.length, geometricMean: geometric, minimum, worstLower };
}

function aggregate(results, predicate) {
  const selected = results.filter(predicate);
  const speedups = selected.map((result) => result.speedup);
  const lowerBounds = selected.map((result) => result.interval95[0]);
  const upperBounds = selected.map((result) => result.interval95[1]);
  return {
    cases: selected.length,
    geometricMean: geometricMean(speedups),
    minimum: Math.min(...speedups),
    maximum: Math.max(...speedups),
    worstLower: Math.min(...lowerBounds),
    worstUpper: Math.min(...upperBounds),
    statisticallySlowerCases: selected.filter((result) => result.interval95[1] < 1).map((result) => result.name),
  };
}

function buildMarkdown(report) {
  const thresholdLine = report.configuration.threshold > 0
    ? `- Conditional fast-droplet threshold: **${report.configuration.threshold} droplets**`
    : '- Candidate mode: current production source';
  const lines = [
    '# v1.13 focused water optimization evidence',
    '',
    `- Baseline archive SHA-256: \`${report.provenance.baselineArchiveSha256}\``,
    `- Baseline simulations source SHA-256: \`${report.provenance.baselineSourceSha256}\``,
    `- Candidate simulations source SHA-256: \`${report.provenance.candidateSourceSha256}\``,
    `- Common SIMD kernel SHA-256: \`${report.provenance.simdKernelSha256}\``,
    `- Samples: ${report.configuration.samples}, paired bootstrap resamples: ${report.configuration.bootstraps}`,
    thresholdLine,
    '',
    report.configuration.generatedFromBaseline
      ? 'Both source trees were compiled independently. The exact same source-frozen v1.12 WASM kernel was used on both sides. This threshold candidate was generated from v1.12 and therefore excludes the separately rejected scalar pointer-swap edit.'
      : 'The source-frozen v1.12 baseline and current workspace source were compiled independently. Both sides used the exact same v1.12 WASM kernel, isolating TypeScript-side water behavior; the current candidate has the rejected scalar pointer-swap edit reverted.',
    '',
    '## Verdict',
    '',
    `- Scalar pointer/buffer swaps: **${report.recommendations.pointerSwaps.decision}** — ${report.recommendations.pointerSwaps.reason}`,
    `- Height-only droplet sampler: **${report.recommendations.heightSampler.decision}** — ${report.recommendations.heightSampler.reason}`,
    `- Early-expired droplet removal: **${report.recommendations.earlyExpiry.decision}** — ${report.recommendations.earlyExpiry.reason}`,
    `- Conditional policy: **${report.recommendations.conditionalPolicy.decision}** — ${report.recommendations.conditionalPolicy.reason}`,
    '',
    '## Complete-path results',
    '',
    '| Case | Backend | Baseline ms/frame | Candidate ms/frame | Speedup | Paired 95% interval | Exact |',
    '|---|---|---:|---:|---:|---:|---:|',
  ];
  for (const result of report.results) {
    lines.push(`| ${result.name} | ${result.backend} | ${result.baselineMedianMs.toFixed(6)} | ${result.candidateMedianMs.toFixed(6)} | **${result.speedup.toFixed(4)}×** | ${result.interval95[0].toFixed(4)}–${result.interval95[1].toFixed(4)}× | yes |`);
  }
  lines.push('', '## Category summary', '', '| Category | Cases | Geometric mean | Range |', '|---|---:|---:|---:|');
  for (const [name, summary] of Object.entries(report.categorySummary)) {
    lines.push(`| ${name} | ${summary.count} | **${summary.geometricMean.toFixed(4)}×** | ${summary.minimum.toFixed(4)}–${summary.maximum.toFixed(4)}× |`);
  }
  lines.push(
    '',
    '## Correctness boundary',
    '',
    `All ${report.exact.totalCases} exact cases passed across ${report.exact.totalFrames} compared history frames. Each frame compared eta/u/v, all three next-step buffers, kernel-pointer parity, full droplet and floater state, RNG state, telemetry/history values, and rendered instance matrices/colors.`,
    '',
    'The height-only path intentionally does not refresh `sampleVelocityX/Z` during droplet-only queries. Those fields are non-authoritative scratch values. Every trace therefore continued through a later full eta/u/v sample and explosion; authoritative state and history remained exact.',
    '',
    'Timings cover one complete production frame (`step(1/60, 4)` plus `buildFrame(false)`). Scene construction and benchmark fixture setup are outside the timed region.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  assert.ok(fs.existsSync(baselineArchive), `missing baseline archive: ${baselineArchive}`);
  const workspaceStartHash = sha256File(currentSource);
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'webphysics-water-focused-'));
  try {
    const builds = await compileBuilds(work);
    const candidateSourceFile = path.join(builds.candidateProject, 'src', 'soft', 'simulations.ts');
    const candidateStartHash = sha256File(candidateSourceFile);
    const baseline = await loadImplementation('v1.12', builds.baselineBuild, builds.baselineSource);
    const candidate = await loadImplementation('candidate', builds.candidateBuild, builds.baselineSource);
    const cases = makeCases();
    const exactResults = [];
    let totalExactFrames = 0;
    for (const testCase of cases) {
      const exact = await exactTrace(baseline, candidate, testCase);
      exactResults.push({ name: testCase.name, ...exact });
      totalExactFrames += exact.frames;
    }

    // Warm both implementations without recording setup/JIT transients.
    for (const testCase of cases) {
      for (let warmup = 0; warmup < 4; warmup++) {
        measureOneFrame(baseline, testCase, 0x900000 + testCase.id * 31 + warmup);
        measureOneFrame(candidate, testCase, 0x900000 + testCase.id * 31 + warmup);
      }
    }

    const results = [];
    for (const testCase of cases) {
      const before = [];
      const after = [];
      for (let sample = 0; sample < sampleCount; sample++) {
        if ((sample & 1) === 0) {
          before.push(measureSample(baseline, testCase, sample));
          after.push(measureSample(candidate, testCase, sample));
        } else {
          after.push(measureSample(candidate, testCase, sample));
          before.push(measureSample(baseline, testCase, sample));
        }
      }
      const baselineMedianMs = median(before);
      const candidateMedianMs = median(after);
      const interval95 = bootstrapInterval(before, after, bootstrapCount, 0x715500 + testCase.id);
      results.push({
        ...testCase,
        baselineSamplesMs: before,
        candidateSamplesMs: after,
        baselineMedianMs,
        candidateMedianMs,
        baselineMadMs: mad(before),
        candidateMadMs: mad(after),
        speedup: baselineMedianMs / candidateMedianMs,
        interval95,
      });
      process.stdout.write(`${testCase.name}: ${(baselineMedianMs / candidateMedianMs).toFixed(4)}x\n`);
    }

    const effectiveThreshold = policyThreshold || 64;
    const pointerEvidence = recommendation(results, 'steady-controls');
    const heightEvidence = recommendation(results, 'active-droplets', (result) => result.count >= effectiveThreshold);
    const expiryEvidence = recommendation(results, 'expiring-droplets', (result) => result.count >= effectiveThreshold);
    const changedEvidence = aggregate(
      results,
      (result) => (result.category === 'active-droplets' || result.category === 'expiring-droplets') && result.count >= effectiveThreshold,
    );
    const controlEvidence = aggregate(
      results,
      (result) => result.category === 'steady-controls'
        || ((result.category === 'active-droplets' || result.category === 'expiring-droplets') && result.count < effectiveThreshold),
    );
    const thresholdQualified = policyThreshold > 0
      && changedEvidence.geometricMean >= 1.02
      && changedEvidence.minimum >= 0.98
      && controlEvidence.geometricMean >= 0.99
      && controlEvidence.minimum >= 0.95;
    const pointerDecision = 'revert';
    const heightDecision = thresholdQualified ? 'retain conditionally' : 'revert';
    const expiryDecision = thresholdQualified ? 'retain conditionally' : 'revert';
    const conditionalDecision = thresholdQualified ? 'retain' : 'revert';
    const baselineSourceFile = path.join(builds.baselineSource, 'src', 'soft', 'simulations.ts');
    const simdKernel = path.join(builds.baselineSource, 'public', 'soft-kernels-simd.wasm');
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      configuration: {
        samples: sampleCount,
        bootstraps: bootstrapCount,
        dropletCounts,
        threshold: policyThreshold,
        generatedFromBaseline: generatedThreshold > 0,
        timedPath: 'step(1/60, 4) + buildFrame(false)',
      },
      provenance: {
        baselineArchive: path.relative(root, baselineArchive),
        baselineArchiveSha256: sha256File(baselineArchive),
        baselineSourceSha256: sha256File(baselineSourceFile),
        candidateSourceSha256: candidateStartHash,
        candidateEndSourceSha256: sha256File(candidateSourceFile),
        workspaceStartSourceSha256: workspaceStartHash,
        workspaceEndSourceSha256: sha256File(currentSource),
        simdKernelSha256: sha256File(simdKernel),
        scalarKernelSha256: sha256File(path.join(builds.baselineSource, 'public', 'soft-kernels-scalar.wasm')),
        commonKernelForBothSides: true,
      },
      exact: { totalCases: exactResults.length, totalFrames: totalExactFrames, passed: true, scratchVelocityFieldsExcluded: true, cases: exactResults },
      categorySummary: summarize(results),
      recommendations: {
        pointerSwaps: {
          decision: pointerDecision,
          evidence: pointerEvidence,
          reason: generatedThreshold > 0
            ? 'Excluded from the threshold candidate after the earlier broad source-frozen run failed its steady-control gate.'
            : `${pointerEvidence.geometricMean.toFixed(4)}× geometric mean across zero-droplet controls; broad qualification requires a clear win and non-regression.`,
        },
        heightSampler: {
          decision: heightDecision,
          evidence: heightEvidence,
          reason: `${heightEvidence.geometricMean.toFixed(4)}× geometric mean across ${effectiveThreshold}–768 active-droplet complete frames; exact continuation after a later full velocity sample.`,
        },
        earlyExpiry: {
          decision: expiryDecision,
          evidence: expiryEvidence,
          reason: `${expiryEvidence.geometricMean.toFixed(4)}× geometric mean across ${effectiveThreshold}–768 expiration-heavy complete frames; removed droplets cannot affect authoritative state.`,
        },
        conditionalPolicy: {
          decision: conditionalDecision,
          threshold: policyThreshold,
          changedEvidence,
          controlEvidence,
          reason: policyThreshold > 0
            ? `${changedEvidence.geometricMean.toFixed(4)}× changed-path geometric mean; ${controlEvidence.geometricMean.toFixed(4)}× control geometric mean, ${controlEvidence.minimum.toFixed(4)}× worst control.`
            : 'No conditional threshold was declared for this run.',
        },
      },
      results,
    };
    assert.equal(report.provenance.candidateSourceSha256, report.provenance.candidateEndSourceSha256, 'candidate source changed during benchmark');
    assert.equal(report.provenance.workspaceStartSourceSha256, report.provenance.workspaceEndSourceSha256, 'workspace source changed during benchmark');
    await fsp.mkdir(resultsDir, { recursive: true });
    await fsp.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await fsp.writeFile(markdownPath, buildMarkdown(report));
    console.log(`wrote ${path.relative(root, jsonPath)}`);
    console.log(`wrote ${path.relative(root, markdownPath)}`);
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
