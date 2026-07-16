import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const resultsDirectory = path.join(root, 'benchmarks', 'results');
const readResult = (name) => JSON.parse(fs.readFileSync(path.join(resultsDirectory, name), 'utf8'));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const candidates = readResult('optimization-candidates.json');
const endToEnd = fs.existsSync(path.join(resultsDirectory, 'end-to-end.json'))
  ? readResult('end-to-end.json')
  : null;
const audit = fs.existsSync(path.join(resultsDirectory, 'source-integration-audit.json'))
  ? readResult('source-integration-audit.json')
  : null;
const release = packageJson.version;
const baselineRelease = endToEnd?.method?.baselineVersion ?? '1.2.0';

const accepted = candidates.results.filter((result) => result.status === 'accepted');
const bySubsystem = {};
for (const result of candidates.results) {
  const summary = bySubsystem[result.subsystem] ??= {
    total: 0,
    accepted: 0,
    borderline: 0,
    rejected: 0,
    best: 0,
  };
  summary.total++;
  if (result.status === 'accepted') summary.accepted++;
  else if (result.status === 'borderline') summary.borderline++;
  else summary.rejected++;
  summary.best = Math.max(summary.best, result.speedup);
}

const lines = [
  '# Box3D WebGPU AAA — Performance Engineering Report',
  '',
  `Release: **v${release} GPU Surface / WASM Edition**  `,
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Executive result',
  '',
  `This run evaluated **${candidates.summary.candidates} distinct microbenchmark candidates**. ` +
    `**${candidates.summary.accepted}** cleared the kernel threshold, ` +
    `**${candidates.summary.borderline}** were borderline, and ` +
    `**${candidates.summary.rejected}** were rejected or inconclusive.`,
  '',
  `The accepted-kernel geometric mean is **${candidates.summary.acceptedGeomeanSpeedup.toFixed(3)}×**. ` +
    'It describes isolated accepted kernels—including timer-floor work-elimination cases—and is not an engine-wide speed claim.',
  '',
  '## Measurement discipline',
  '',
  '- Four warm-up passes and nine timed samples per candidate.',
  '- Median ns/op is primary; median absolute deviation records noise.',
  '- Kernel acceptance requires at least 3% median improvement and bounded dispersion.',
  '- Whole-project acceptance requires at least 2% median improvement with normalized MAD at or below 15%.',
  '- Rejected and borderline results remain in the evidence set.',
  '- Ratios from unrelated kernels are never multiplied.',
  '',
  '## Candidate summary by subsystem',
  '',
  '| Subsystem | Candidates | Accepted | Borderline | Rejected | Best isolated kernel |',
  '|---|---:|---:|---:|---:|---:|',
];

for (const [name, summary] of Object.entries(bySubsystem)) {
  lines.push(
    `| ${name} | ${summary.total} | ${summary.accepted} | ${summary.borderline} | ` +
      `${summary.rejected} | ${summary.best.toFixed(3)}× |`,
  );
}

lines.push('', `## End-to-end comparison against bundled v${baselineRelease}`, '');
if (endToEnd) {
  lines.push(
    '| Workload | Baseline median | Current median | Speedup | Time reduction | Noise ceiling | Accepted |',
    '|---|---:|---:|---:|---:|---:|---|',
  );
  for (const result of endToEnd.results) {
    if (!result.available) {
      lines.push(`| \`${result.script}\` | — | — | — | — | — | unavailable |`);
    } else if (result.baseline?.passed && result.optimized?.passed) {
      lines.push(
        `| \`${result.script}\` | ${result.baseline.medianSeconds.toFixed(4)}s | ` +
          `${result.optimized.medianSeconds.toFixed(4)}s | ${result.speedup.toFixed(3)}× | ` +
          `${result.timeReductionPercent.toFixed(2)}% | ${result.noiseCeilingPercent.toFixed(2)}% | ` +
          `${result.accepted ? 'yes' : 'no'} |`,
      );
    } else {
      lines.push(`| \`${result.script}\` | failed | ${result.optimized?.passed ? 'passed' : 'failed'} | — | — | — | no |`);
    }
  }
  lines.push(
    '',
    `Production bundle delta: **${endToEnd.bundle.deltaBytes >= 0 ? '+' : ''}${endToEnd.bundle.deltaBytes.toLocaleString()} bytes** ` +
      `(${endToEnd.bundle.deltaPercent == null ? 'n/a' : `${endToEnd.bundle.deltaPercent.toFixed(2)}%`}).`,
    '',
    'A failed baseline gate is reported as unavailable evidence; it is never converted into a speed claim.',
  );
} else {
  lines.push('No end-to-end evidence was present. Run `npm run bench:end-to-end`, then regenerate this report.');
}

lines.push(
  '',
  '## Source integration audit',
  '',
  audit
    ? `Changed implementation/configuration files: **${audit.summary.changedFiles}**; source files: ` +
      `**${audit.summary.sourceFiles}**; line delta: **+${audit.summary.linesAdded} / -${audit.summary.linesDeleted}**. ` +
      'See `benchmarks/results/source-integration-audit.md` for hashes and file detail.'
    : 'No source integration audit was present.',
  '',
  '## Retained engineering changes',
  '',
  '1. Packed constraint/material layouts and reusable typed-array staging.',
  '2. Cached tear topology, regular-grid topology, UVs, static transforms, and unchanged frame streams.',
  '3. Buffer swapping, geometric capacity growth, in-place compaction, and batched instance preparation.',
  '4. SIMD/scalar standalone WASM cloth, rope, water, and rope-render kernels with JavaScript fallback.',
  '5. GPU-resident intact-cloth reconstruction at 16 dynamic bytes per vertex.',
  '6. GPU-resident shallow-water reconstruction at 12 dynamic bytes per cell.',
  '7. Topology-aware packed CPU fallback for tearing cloth.',
  '8. Coherent sweep-and-prune deterministic preview broadphase.',
  '9. Whole-system projectile AABB and squared-distance contact rejection.',
  '10. Optional TurboQuant transport compression kept outside the local authoritative frame loop.',
  '',
  '## Evidence policy',
  '',
  '- A microbenchmark win alone is insufficient for a release claim.',
  '- CPU and Dawn command-submission results are not physical-GPU FPS measurements.',
  '- Regressions, parity, timer-floor cases, and unavailable baseline gates stay visible.',
  '- The original native Box3D Emscripten artifact is a separate build gate from the packaged soft-kernel WASM modules.',
  '',
  '## Reproduce',
  '',
  '```bash',
  'npm ci',
  'npm run validate:v1.8',
  'npm run bench:100',
  'npm run bench:end-to-end',
  'npm run bench:audit',
  'npm run perf:report',
  '```',
  '',
  'The source manifest is generated after reports and verified as the final provenance gate.',
  '',
);

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'PERFORMANCE_OPTIMIZATION_REPORT.md'), `${lines.join('\n')}\n`);

const ledger = {
  schema: 1,
  release,
  baselineRelease,
  generatedAt: new Date().toISOString(),
  environment: candidates.environment,
  summary: candidates.summary,
  subsystems: bySubsystem,
  endToEnd: endToEnd?.results ?? [],
  candidates: candidates.results.map((result) => ({
    id: result.id,
    subsystem: result.subsystem,
    idea: result.idea,
    quality: result.quality,
    status: result.status,
    speedup: result.speedup,
    baselineNs: result.baselineNs,
    optimizedNs: result.optimizedNs,
    noise: result.noise,
    note: result.note,
  })),
};
fs.writeFileSync(path.join(resultsDirectory, 'optimization-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
fs.writeFileSync(
  path.join(root, 'PERFORMANCE.md'),
  '# Performance evidence\n\n' +
    'See [the complete report](docs/PERFORMANCE_OPTIMIZATION_REPORT.md), ' +
    '[the 100 candidate measurements](benchmarks/results/optimization-candidates.md), and ' +
    '[the end-to-end comparison](benchmarks/results/end-to-end.md).\n\n' +
    'Run `npm run validate:performance` to reproduce the complete gate.\n',
);

console.log(JSON.stringify({
  report: 'docs/PERFORMANCE_OPTIMIZATION_REPORT.md',
  release,
  accepted: accepted.length,
  candidates: candidates.results.length,
  endToEnd: Boolean(endToEnd),
}, null, 2));
