import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const archive = join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const outputJson = join(root, 'benchmarks/results/v111-main-frame-lines.json');
const outputMarkdown = join(root, 'benchmarks/results/v111-main-frame-lines.md');
const sampleCount = Math.max(9, Number.parseInt(process.env.FRAME_LINE_SAMPLES ?? '11', 10));
const scale = Math.max(0.1, Number(process.env.FRAME_LINE_SCALE ?? '1'));
const bootstrapCount = Math.max(5_000, Number.parseInt(process.env.FRAME_LINE_BOOTSTRAPS ?? '20000', 10));
const writeResults = process.env.FRAME_LINE_WRITE !== '0';
const EXPECTED_BASELINE_SHA256 = 'dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const archiveSha256 = sha256(archive);
if (archiveSha256 !== EXPECTED_BASELINE_SHA256) {
  throw new Error(`unexpected v1.10 baseline archive SHA-256: ${archiveSha256}`);
}

const archivedMain = await import('node:child_process').then(({ execFileSync }) =>
  execFileSync('tar', ['-xOf', archive, 'src/main.ts'], { encoding: 'utf8' }));
const legacyContract = `combinedFrameLines.length = 0;
    for (const line of buildDebugLines()) combinedFrameLines.push(line);
    for (const line of softFrame.debugLines) combinedFrameLines.push(line);
    for (const line of effectFrame.debugLines) combinedFrameLines.push(line);`;
if (!archivedMain.includes(legacyContract)) throw new Error('archived v1.10 line-staging contract is missing');

const currentMain = readFileSync(join(root, 'src/main.ts'), 'utf8');
if (!currentMain.includes('frameLineStager.resolve(')) throw new Error('optimized main-loop line stager is not integrated');

const helperSource = readFileSync(join(root, 'src/frame-lines.ts'), 'utf8');
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: 'src/frame-lines.ts',
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`;
const { FrameLineStager } = await import(helperUrl);

const BOX_CORNER_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const LINE_FIELDS = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r', 'g', 'b', 'a'];
let timingSink = 0;

function createLine(seed) {
  return {
    ax: seed * 0.001, ay: seed * 0.002, az: seed * -0.0015,
    bx: seed * 0.0017 + 1, by: seed * -0.0009 + 2, bz: seed * 0.0011 - 3,
    r: ((seed * 17) & 255) / 255,
    g: ((seed * 29) & 255) / 255,
    b: ((seed * 43) & 255) / 255,
    a: 0.15 + ((seed * 7) & 127) / 150,
  };
}

function createLineArray(count, seed) {
  return Array.from({ length: count }, (_, index) => createLine(seed + index));
}

function mutateLines(lines, version, amplitude) {
  const phase = version * 0.00037 * amplitude;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    line.ay = i * 0.002 + phase;
    line.by = i * -0.001 + phase * 0.7;
    line.a = 0.2 + ((i + version) & 31) * (0.8 / 31);
  }
}

function createRigidBuilder() {
  const bodyCount = 280;
  const matrices = new Float32Array(bodyCount * 16);
  const pool = [];
  const lines = [];
  let debugEnabled = false;
  let version = 1;

  function update(nextVersion) {
    version = nextVersion;
    for (let i = 0; i < bodyCount; i++) {
      const offset = i * 16;
      const sx = 0.45 + (i % 9) * 0.07;
      const sy = 0.55 + (i % 13) * 0.05;
      const sz = 0.50 + (i % 7) * 0.06;
      matrices[offset] = sx;
      matrices[offset + 1] = ((i + version) % 5) * 0.0001;
      matrices[offset + 5] = sy;
      matrices[offset + 6] = ((i + version) % 3) * 0.0002;
      matrices[offset + 10] = sz;
      matrices[offset + 12] = (i % 28) * 1.35 - 18 + version * 0.00003;
      matrices[offset + 13] = 0.7 + Math.floor(i / 28) * 1.1 + version * 0.00002;
      matrices[offset + 14] = ((i * 11) % 31) * 1.13 - 16 + version * -0.00001;
      matrices[offset + 15] = 1;
    }
  }

  function append(ax, ay, az, bx, by, bz, r, g, b, a) {
    const index = lines.length;
    let line = pool[index];
    if (!line) {
      line = { ax, ay, az, bx, by, bz, r, g, b, a };
      pool[index] = line;
    } else {
      line.ax = ax; line.ay = ay; line.az = az;
      line.bx = bx; line.by = by; line.bz = bz;
      line.r = r; line.g = g; line.b = b; line.a = a;
    }
    lines[index] = line;
  }

  function build() {
    lines.length = 0;
    if (!debugEnabled) return lines;
    const gridExtent = 44;
    for (let i = -gridExtent; i <= gridExtent; i += 2) {
      const alpha = i % 10 === 0 ? 0.42 : 0.17;
      append(-gridExtent, 0.018, i, gridExtent, 0.018, i, 0.22, 0.48, 0.68, alpha);
      append(i, 0.018, -gridExtent, i, 0.018, gridExtent, 0.22, 0.48, 0.68, alpha);
    }
    append(-10, 0.05, 0, 10, 0.05, 0, 1, 0.12, 0.14, 0.95);
    append(0, 0.05, -10, 0, 0.05, 10, 0.1, 0.72, 1, 0.95);
    append(0, 0.05, 0, 0, 10, 0, 0.25, 1, 0.35, 0.95);
    const stride = bodyCount > 150 ? 7 : bodyCount > 80 ? 4 : 2;
    for (let i = 0; i < bodyCount; i += stride) {
      const offset = i * 16;
      const cx = matrices[offset + 12];
      const cy = matrices[offset + 13];
      const cz = matrices[offset + 14];
      const hx = Math.hypot(matrices[offset], matrices[offset + 1], matrices[offset + 2]);
      const hy = Math.hypot(matrices[offset + 4], matrices[offset + 5], matrices[offset + 6]);
      const hz = Math.hypot(matrices[offset + 8], matrices[offset + 9], matrices[offset + 10]);
      for (const [edgeA, edgeB] of BOX_EDGES) {
        const a = BOX_CORNER_SIGNS[edgeA];
        const b = BOX_CORNER_SIGNS[edgeB];
        append(
          cx + a[0] * hx, cy + a[1] * hy, cz + a[2] * hz,
          cx + b[0] * hx, cy + b[1] * hy, cz + b[2] * hz,
          0.42, 0.82, 1, 0.25,
        );
      }
    }
    return lines;
  }

  update(version);
  return {
    build,
    setDebug(value) { debugEnabled = value; },
    update,
  };
}

function legacyResolve(state, debugEnabled, backendVersion, softVersion, effectVersion) {
  void backendVersion; void softVersion; void effectVersion;
  state.combined.length = 0;
  for (const line of state.rigid.build()) state.combined.push(line);
  for (const line of state.softLines) state.combined.push(line);
  for (const line of state.effectLines) state.combined.push(line);
  return state.combined;
}

function optimizedResolve(state, debugEnabled, backendVersion, softVersion, effectVersion) {
  return state.stager.resolve(
    debugEnabled,
    backendVersion,
    softVersion,
    effectVersion,
    state.rigid.build,
    state.softLines,
    state.effectLines,
  );
}

function createState(optimized) {
  const activeSoftLines = createLineArray(384, 0x3100);
  return {
    optimized,
    combined: [],
    stager: optimized ? new FrameLineStager() : null,
    rigid: createRigidBuilder(),
    softLines: activeSoftLines,
    activeSoftLines,
    emptySoftLines: [],
    effectLines: createLineArray(144, 0x7100),
    backendVersion: 1,
    softVersion: 1,
    effectVersion: 1,
  };
}

function setSourceState(state, frame, mutateSources) {
  const debug = frame.debug;
  state.rigid.setDebug(debug);
  if (frame.backendChange) {
    state.backendVersion = (state.backendVersion + 1) >>> 0;
    if (mutateSources) state.rigid.update(state.backendVersion);
  }
  if (frame.softChange) {
    state.softVersion = (state.softVersion + 1) >>> 0;
    if (mutateSources) mutateLines(state.activeSoftLines, state.softVersion, 3);
  }
  if (frame.effectChange) {
    state.effectVersion = (state.effectVersion + 1) >>> 0;
    if (mutateSources) mutateLines(state.effectLines, state.effectVersion, 5);
  }
  state.softLines = debug ? state.activeSoftLines : state.emptySoftLines;
}

function resolveState(state, frame, mutateSources = false) {
  setSourceState(state, frame, mutateSources);
  return state.optimized
    ? optimizedResolve(state, frame.debug, state.backendVersion, state.softVersion, state.effectVersion)
    : legacyResolve(state, frame.debug, state.backendVersion, state.softVersion, state.effectVersion);
}

function hashLines(lines) {
  let hash = 0x811c9dc5;
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const field of LINE_FIELDS) {
      scratch[0] = line[field];
      hash ^= bits[0];
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

function assertExactLines(expected, actual, label) {
  if (expected.length !== actual.length) throw new Error(`${label}: line count ${expected.length} !== ${actual.length}`);
  for (let i = 0; i < expected.length; i++) {
    for (const field of LINE_FIELDS) {
      if (!Object.is(expected[i][field], actual[i][field])) {
        throw new Error(`${label}: line ${i}.${field} ${expected[i][field]} !== ${actual[i][field]}`);
      }
    }
  }
}

function makeTrace(name, frames) {
  switch (name) {
    case 'paused-diagnostics':
      return Array.from({ length: frames }, () => ({ debug: true, backendChange: false, softChange: false, effectChange: false }));
    case 'paused-effects':
      return Array.from({ length: frames }, () => ({ debug: false, backendChange: false, softChange: false, effectChange: false }));
    case 'active-diagnostics':
      return Array.from({ length: frames }, () => ({ debug: true, backendChange: true, softChange: true, effectChange: true }));
    case 'mixed-60hz':
      return Array.from({ length: frames }, (_, i) => {
        const phase = i % 600;
        if (phase < 180) return { debug: false, backendChange: true, softChange: true, effectChange: true };
        if (phase < 300) return { debug: true, backendChange: false, softChange: false, effectChange: false };
        if (phase < 480) return { debug: true, backendChange: true, softChange: true, effectChange: true };
        return { debug: false, backendChange: false, softChange: false, effectChange: false };
      });
    default:
      throw new Error(`unknown trace ${name}`);
  }
}

const fidelityFrames = Array.from({ length: 4096 }, (_, i) => ({
  debug: ((i / 97) | 0) % 2 === 0,
  backendChange: i % 5 === 0 || i % 113 === 0,
  softChange: i % 7 === 0 || i % 131 === 0,
  effectChange: i % 3 === 0 || i % 173 === 0,
}));
const fidelityBaseline = createState(false);
const fidelityOptimized = createState(true);
let fidelityHash = 0;
let unchangedIdentityChecks = 0;
let previousOptimizedOutput = null;
let previousVersions = null;
for (let i = 0; i < fidelityFrames.length; i++) {
  const frame = fidelityFrames[i];
  const expected = resolveState(fidelityBaseline, frame, true);
  const actual = resolveState(fidelityOptimized, frame, true);
  assertExactLines(expected, actual, `fidelity frame ${i}`);
  fidelityHash = (fidelityHash ^ Math.imul(hashLines(actual), i + 1)) >>> 0;
  const versions = [frame.debug, fidelityOptimized.backendVersion, fidelityOptimized.softVersion, fidelityOptimized.effectVersion];
  if (previousVersions && versions.every((value, index) => Object.is(value, previousVersions[index]))) {
    unchangedIdentityChecks++;
    if (actual !== previousOptimizedOutput) throw new Error(`fidelity frame ${i}: unchanged output identity was not retained`);
  }
  previousOptimizedOutput = actual;
  previousVersions = versions;
}

function runTimed(traceName, optimized, frames) {
  const trace = makeTrace(traceName, frames);
  const state = createState(optimized);
  const start = process.hrtime.bigint();
  let checksum = 0;
  for (let i = 0; i < trace.length; i++) {
    const lines = resolveState(state, trace[i]);
    const selected = lines.length === 0 ? null : lines[(i * 17) % lines.length];
    checksum += lines.length + (selected ? selected.ax + selected.by + selected.a : 0);
  }
  const elapsedNs = Number(process.hrtime.bigint() - start);
  timingSink += checksum;
  return elapsedNs / trace.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

let bootstrapState = 0x51a9e37b;
function randomIndex(limit) {
  bootstrapState ^= bootstrapState << 13;
  bootstrapState ^= bootstrapState >>> 17;
  bootstrapState ^= bootstrapState << 5;
  return (bootstrapState >>> 0) % limit;
}

function pairedBootstrapInterval(baselineSamples, optimizedSamples) {
  const ratios = new Array(bootstrapCount);
  for (let sample = 0; sample < bootstrapCount; sample++) {
    const base = new Array(baselineSamples.length);
    const optimized = new Array(optimizedSamples.length);
    for (let i = 0; i < baselineSamples.length; i++) {
      const index = randomIndex(baselineSamples.length);
      base[i] = baselineSamples[index];
      optimized[i] = optimizedSamples[index];
    }
    ratios[sample] = median(base) / median(optimized);
  }
  ratios.sort((a, b) => a - b);
  return [ratios[Math.floor(ratios.length * 0.025)], ratios[Math.floor(ratios.length * 0.975)]];
}

function measureScenario(name, frames) {
  const warmupFrames = Math.max(300, Math.floor(frames * 0.12));
  for (let i = 0; i < 3; i++) {
    runTimed(name, false, warmupFrames);
    runTimed(name, true, warmupFrames);
  }
  const baselineSamples = [];
  const optimizedSamples = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    if ((sample & 1) === 0) {
      baselineSamples.push(runTimed(name, false, frames));
      optimizedSamples.push(runTimed(name, true, frames));
    } else {
      optimizedSamples.push(runTimed(name, true, frames));
      baselineSamples.push(runTimed(name, false, frames));
    }
  }
  const baselineMedianNsPerFrame = median(baselineSamples);
  const optimizedMedianNsPerFrame = median(optimizedSamples);
  const paired95 = pairedBootstrapInterval(baselineSamples, optimizedSamples);
  return {
    name,
    framesPerSample: frames,
    samples: sampleCount,
    baselineMedianNsPerFrame,
    optimizedMedianNsPerFrame,
    speedup: baselineMedianNsPerFrame / optimizedMedianNsPerFrame,
    paired95,
    baselineMadNsPerFrame: mad(baselineSamples),
    optimizedMadNsPerFrame: mad(optimizedSamples),
    baselineSamples,
    optimizedSamples,
  };
}

const scenarioFrames = Math.max(1_200, Math.floor(12_000 * scale));
const scenarios = [
  measureScenario('paused-diagnostics', scenarioFrames),
  measureScenario('paused-effects', scenarioFrames),
  measureScenario('mixed-60hz', scenarioFrames),
  measureScenario('active-diagnostics', Math.max(600, Math.floor(3_000 * scale))),
];
const pausedDiagnostics = scenarios.find((entry) => entry.name === 'paused-diagnostics');
const pausedEffects = scenarios.find((entry) => entry.name === 'paused-effects');
const mixed = scenarios.find((entry) => entry.name === 'mixed-60hz');
const active = scenarios.find((entry) => entry.name === 'active-diagnostics');
const accepted = pausedDiagnostics.paired95[0] > 1.03 &&
  pausedEffects.paired95[0] > 1.03 &&
  mixed.paired95[0] > 1.03 &&
  active.paired95[0] >= 0.97;
if (!accepted) {
  throw new Error(
    `line staging candidate failed acceptance: paused=${pausedDiagnostics.paired95}, ` +
    `effects=${pausedEffects.paired95}, mixed=${mixed.paired95}, active=${active.paired95}`,
  );
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: 'version-keyed main-loop debug/effect line staging cache',
  decision: 'accepted',
  exactness: {
    framesCompared: fidelityFrames.length,
    floatFieldsComparedPerLine: LINE_FIELDS.length,
    mismatches: 0,
    aggregateHash: `0x${fidelityHash.toString(16).padStart(8, '0')}`,
    unchangedIdentityChecks,
  },
  benchmark: {
    samples: sampleCount,
    alternatingOrder: true,
    bootstrapResamples: bootstrapCount,
    timings: 'nanoseconds per complete main-loop line-staging frame',
    scenarios,
  },
  source: {
    baselineArchive: 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz',
    baselineArchiveSha256: archiveSha256,
    optimizedHelper: 'src/frame-lines.ts',
    integration: 'src/main.ts',
  },
  acceptance: {
    unchangedLower95Minimum: 1.03,
    mixedLower95Minimum: 1.03,
    activeLower95Minimum: 0.97,
    passed: accepted,
  },
  notes: [
    'The measured region includes rigid grid/body wireframe reconstruction plus soft/effect list staging; it is not a timer-floor cache lookup microbenchmark.',
    'The active diagnostics control changes every source version every frame and therefore forces the optimized path to rebuild exactly as the original does.',
    'The renderer line-packing/upload cache remains independent; this optimization removes redundant work before that renderer cache is reached.',
  ],
  sink: timingSink,
};

const markdown = `# v1.11 Main-frame line staging benchmark

Decision: **accepted**.

The main loop now retains its combined rigid/soft/effect line list while all contributing source versions are unchanged. The benchmark exercises the complete staging path with a 280-body diagnostic wireframe, 384 soft diagnostic lines, and 144 shockwave lines.

| Scenario | v1.10 ns/frame | v1.11 ns/frame | Speedup | Paired 95% interval |
|---|---:|---:|---:|---:|
${scenarios.map((entry) => `| ${entry.name} | ${entry.baselineMedianNsPerFrame.toFixed(1)} | ${entry.optimizedMedianNsPerFrame.toFixed(1)} | **${entry.speedup.toFixed(3)}x** | ${entry.paired95[0].toFixed(3)}-${entry.paired95[1].toFixed(3)}x |`).join('\n')}

Exactness: ${fidelityFrames.length.toLocaleString()} mixed active/paused/toggle frames compared, zero line-count or float-field mismatches, ${unchangedIdentityChecks.toLocaleString()} unchanged-frame identity checks.

The active diagnostics control forces a rebuild every frame. Its lower paired confidence bound must remain at least 0.97x, preventing cached paused frames from hiding an active-frame regression.
`;

if (writeResults) {
  mkdirSync(dirname(outputJson), { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outputMarkdown, markdown);
}

console.log(markdown);
