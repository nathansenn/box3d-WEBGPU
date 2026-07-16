#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const resultsDir = path.resolve('benchmarks/results');
const benchmarkPath = path.join(resultsDir, 'turboquant-benchmark.json');
const workerPath = path.join(resultsDir, 'turboquant-worker-benchmark.json');
if (!fs.existsSync(benchmarkPath)) throw new Error('Run benchmarks/turboquant-benchmark.cjs first.');

const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
const worker = fs.existsSync(workerPath) ? JSON.parse(fs.readFileSync(workerPath, 'utf8')) : null;
const recommendedName = 'TurboQuant structured 4-bit delta';
const recommended = benchmark.results.map((workload) => {
  const codec = workload.codecs.find((item) => item.name === recommendedName);
  if (!codec || codec.skipped) return null;
  return { workload, codec };
}).filter(Boolean);

const f = (value, digits = 3) => Number(value).toFixed(digits);
const kb = (bytes) => `${f(bytes / 1024, 2)} KiB`;
const lines = [];
lines.push('# TurboQuant Simulation-State Benchmark');
lines.push('');
lines.push(`Generated: ${benchmark.generatedAt}`);
lines.push('');
lines.push('## Decision');
lines.push('');
lines.push('**Do not enable TurboQuant on the current same-thread physics → WebGPU upload path.** The JavaScript rotation, quantization, packing, unpacking, and reconstruction cost is greater than a local typed-array copy.');
lines.push('');
lines.push('**Use the predictive 4-bit transport mode for network snapshots, remote spectators, cloud simulation replication, replay archives, or other bandwidth-limited boundaries.** Once encoded, its payload is much cheaper to copy and transmit, and the measured break-even link rate is reported below.');
lines.push('');
lines.push('## Recommended predictive 4-bit result');
lines.push('');
lines.push('| Workload | Raw/frame | Packet/frame | Compression | Encode + decode | Relative L2 | Copy-only speedup | Link break-even | 10 MB/s model | 25 MB/s model | 50 MB/s model |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const { workload, codec } of recommended) {
  const t = codec.transportModel;
  lines.push(`| ${workload.id} | ${kb(codec.rawBytes)} | ${kb(codec.packetBytes)} | ${f(codec.compressionRatio, 2)}× | ${f(t.codecMsPerFrame, 4)} ms | ${f(codec.predictiveError.relativeL2 * 100, 3)}% | ${f(codec.copyOnlySpeedup, 2)}× | ${f(t.breakEvenMegabytesPerSecond, 1)} MB/s | ${f(t.modeledLinks['10'].speedup, 2)}× | ${f(t.modeledLinks['25'].speedup, 2)}× | ${f(t.modeledLinks['50'].speedup, 2)}× |`);
}
lines.push('');
lines.push('The network model is `raw bytes / link rate` versus `codec time + compressed bytes / link rate`; it excludes protocol overhead and assumes codec work is not overlapped. Lower-bandwidth links favor compression.');
lines.push('');
lines.push('## All tested codecs');
for (const workload of benchmark.results) {
  lines.push('');
  lines.push(`### ${workload.scene}`);
  lines.push('');
  lines.push('| Codec | Compression | Predictive time/frame | Predictive relative L2 | Local end-to-end | Break-even |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const codec of workload.codecs) {
    if (codec.skipped) { lines.push(`| ${codec.name} | skipped | — | — | — | — |`); continue; }
    lines.push(`| ${codec.name} | ${f(codec.compressionRatio, 2)}× | ${f(codec.transportModel.codecMsPerFrame, 4)} ms | ${f(codec.predictiveError.relativeL2 * 100, 3)}% | ${f(codec.transportModel.localEndToEndSpeedup, 4)}× | ${f(codec.transportModel.breakEvenMegabytesPerSecond, 1)} MB/s |`);
  }
}
lines.push('');
lines.push('## Worker transport check');
lines.push('');
if (worker) {
  lines.push(`A local Node worker transferred ${worker.frames} water frames. Raw transferable transport took ${f(worker.rawMedianMs, 3)} ms total; predictive TurboQuant encode + transfer + decode took ${f(worker.compressedMedianMs, 3)} ms. End-to-end speedup was **${f(worker.endToEndSpeedup, 4)}×**, meaning TurboQuant was **${f(1 / worker.endToEndSpeedup, 1)}× slower** for this local worker path.`);
  lines.push('');
  lines.push(`Transferred bytes fell from ${worker.rawBytes.toLocaleString()} to ${worker.compressedBytes.toLocaleString()} (${f(worker.compressionRatio, 2)}× smaller), but local memory transfer was already too fast for the JavaScript codec cost to amortize.`);
} else {
  lines.push('Worker benchmark not present. Run `npm run bench:turboquant:worker`.');
}
lines.push('');
lines.push('## Algorithm mapping and scope');
lines.push('');
lines.push('- `dense` is a **blockwise adaptation of TurboQuant-MSE**: normalize each block, apply a deterministic random orthogonal rotation, use Gaussian Lloyd–Max scalar centroids, and inverse-rotate during reconstruction. It is not the paper’s single full-vector dense rotation.');
lines.push('- `structured` replaces the dense rotation with randomized normalized Walsh–Hadamard stages. This is a TurboQuant-style fast transform aligned with the later Fast-TurboQuant direction, not an official Google implementation.');
lines.push('- QJL residual correction is intentionally omitted because this engine reconstructs positions/matrices; it is not estimating attention inner products.');
lines.push('- Predictive mode quantizes the difference from the prior reconstructed frame. Encoder and decoder therefore remain synchronized on the same lossy reference.');
lines.push('');
lines.push('## Reproduction');
lines.push('');
lines.push('```bash');
lines.push('npm ci');
lines.push(`TQ_FRAMES=${benchmark.framesPerWorkload} TQ_SAMPLES=${benchmark.samples} TQ_WARMUPS=${benchmark.warmups} TQ_FANOUTS=${benchmark.fanouts.join(',')} npm run bench:turboquant:all`);
lines.push('```');
lines.push('');
lines.push(`Runtime: ${benchmark.node} on ${benchmark.platform}; ${benchmark.framesPerWorkload} frames/workload, ${benchmark.samples} timed samples, ${benchmark.warmups} warmups.`);

const reportPath = path.join(resultsDir, 'TURBOQUANT_BENCHMARK.md');
fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
const summary = {
  generatedAt: new Date().toISOString(),
  decision: 'disabled_for_same_thread_rendering_enabled_for_opt_in_bandwidth_limited_transport',
  recommendedCodec: recommendedName,
  workloads: recommended.map(({ workload, codec }) => ({
    id: workload.id,
    scene: workload.scene,
    rawBytes: codec.rawBytes,
    packetBytes: codec.packetBytes,
    compressionRatio: codec.compressionRatio,
    codecMsPerFrame: codec.transportModel.codecMsPerFrame,
    predictiveRelativeL2: codec.predictiveError.relativeL2,
    breakEvenMegabytesPerSecond: codec.transportModel.breakEvenMegabytesPerSecond,
    modeledLinks: codec.transportModel.modeledLinks,
  })),
  worker,
};
fs.writeFileSync(path.join(resultsDir, 'turboquant-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${reportPath}`);
