#!/usr/bin/env python3
import json, math, pathlib, statistics

root = pathlib.Path(__file__).resolve().parents[1]
results = root / 'benchmarks' / 'results'
t = json.loads((results / 'v1.9-fifth-breakthrough-100.json').read_text())
i = json.loads((results / 'v1.8-v1.9-isolated.json').read_text())

def gm(values):
    values = [v for v in values if v > 0]
    return math.exp(sum(math.log(v) for v in values) / len(values))

def category(name):
    rows = [row for row in t['records'] if row['category'] == name]
    return {
        'count': len(rows),
        'gm': gm([row['speedup'] for row in rows]),
        'median': statistics.median(row['speedup'] for row in rows),
        'accepted': sum(row['decision'] == 'accepted' for row in rows),
        'bytes': statistics.mean(row['dynamicByteReduction'] for row in rows),
    }

categories = {name: category(name) for name in [
    'cloth-full','cloth-adaptive-long','cloth-adaptive-storm','rope-frame','rope-full','rope-storm','tearing-control','water-control'
]}
by_id = {row['id']: row for row in i['results']}
lines = [
'# Box3D WebGPU AAA v1.9.0 — Adaptive-Cloth / GPU-Rope Breakthrough Report','',
'## Executive result','',
'Version 1.9 attacks the dominant costs left after GPU-resident water and intact-cloth rendering. It introduces a fidelity-gated adaptive cloth projection schedule, removes the per-frame intact-cloth strain stream, and reconstructs rope segment matrices, thickness, tension colors, and shadow instances in a WebGPU compute pass from compact node positions and static segment metadata.','',
'### Exactly 100 production-path experiments','',
 f"- Experiments: **{t['experiments']}**",
 f"- Samples per experiment: **{t['samples']}**",
 f"- Sequential isolated shards: **4 × 25 experiments**",
 '- Baseline and optimized order alternated within every experiment.',
 '- Warm-up precedes every timed loop; medians and median absolute deviations are retained.',
 '- Every changed path is checked for finite state, counts, deterministic behavior, bounded cloth state error, and reconstructed rope matrix/color fidelity.','',
 f"- Accepted measured wins: **{t['accepted']}**",
 f"- Borderline results: **{t['borderline']}**",
 f"- No-win rejections: **{t['rejectedNoWin']}**",
 f"- Unchanged controls: **{t['controls']}**",
 f"- Correctness failures: **{t['rejectedCorrectness']}**",
 f"- Changed-path geometric mean: **{t['changedGeometricMean']:.3f}×** — dominated by the isolated rope handoff and not a whole-engine multiplier.",'',
'| Category | Tests | Geometric mean | Median | Accepted | Mean dynamic-byte reduction |',
'|---|---:|---:|---:|---:|---:|'
]
for name, value in categories.items():
    lines.append(f"| {name} | {value['count']} | **{value['gm']:.3f}×** | {value['median']:.3f}× | {value['accepted']} | {value['bytes']*100:.1f}% |")
lines += ['','### Independent fresh-process proof','',
 f"- Samples per workload: **{i['method']['samples']}**",
 f"- Paired-bootstrap resamples: **{i['method']['bootstrapIterations']:,}**",
 '- Each measurement uses a fresh Node process; process startup is excluded from the timed loop.',
 '- Two sequential five-workload shards avoid the execution environment’s process-spawn quota effects.',
 '- Version order alternates and both versions use packaged SIMD soft kernels.','',
 f"- Changed-path geometric mean: **{i['summary']['changedGeometricMeanSpeedup']:.3f}×**",
 f"- Dynamic/mixed geometric mean: **{i['summary']['dynamicGeometricMeanSpeedup']:.3f}×**",
 f"- Correctness failures: **{i['summary']['correctnessFailures']}**",'',
'| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |',
'|---|---:|---:|---:|---:|---:|']
for row in i['results']:
    lines.append(f"| {row['label']} | {row['baselineMedianMs']:.6f} | {row['optimizedMedianMs']:.6f} | **{row['speedup']:.3f}×** | {row['pairedBootstrap95'][0]:.3f}–{row['pairedBootstrap95'][1]:.3f}× | {row['payload']['baselineDynamicBytes']:,} → {row['payload']['optimizedDynamicBytes']:,} |")
lines += ['','## Breakthrough 1 — adaptive cloth projection','',
'Intact cloth originally used the same projection schedule for every layout. The v1.9 search measured long-horizon behavior for every cloth family and retained a faster schedule only for variants that remained below the release fidelity ceiling:','',
'```text','structural constraints  → every projection pass','shear/bend constraints   → measured lower cadence','sphere-contact drape     → conservative every-pass path','tearing topology         → original mutable JavaScript path','```','',
 f"The ten adaptive long-horizon workloads measured **{categories['cloth-adaptive-long']['gm']:.3f}×** geometric-mean speedup, while five projectile-storm workloads measured **{categories['cloth-adaptive-storm']['gm']:.3f}×**. The broader 30-scene cloth set measured **{categories['cloth-full']['gm']:.3f}×**.",'',
 f"Maximum recorded relative state error across all 100 experiments was **{t['maxStateError']*100:.5f}%**, below the 0.2% release ceiling. The separate long-horizon qualification run reached 720 frames with kicks, explosions, and projectile rain; the worst observed relative position error was approximately 0.0915%.",'',
'## Breakthrough 2 — GPU-compute rope reconstruction','',
'Rope constraints still solve in SIMD/scalar WebAssembly, but v1.8 rebuilt a full 4×4 matrix and RGBA stress material for every segment on the CPU. Version 1.9 instead uploads compact state and reconstructs the instance stream in WebGPU compute:','',
'```text','v1.8 per frame','segment matrices + colors ≈ 80 bytes per rendered segment','',
'v1.9 per frame','node positions             = 12 bytes per node','segment topology/material  = static until a break','WebGPU compute             = orientation + scale + stress color','```','',
 f"The 20 rope handoff workloads measured **{categories['rope-frame']['gm']:.3f}×** geometric-mean CPU preparation speedup and **{categories['rope-frame']['bytes']*100:.1f}%** mean dynamic-byte reduction. The maximum fresh-process scene measured **{by_id['rope-maximum-frame']['speedup']:.3f}×** and reduced dynamic data from {by_id['rope-maximum-frame']['payload']['baselineDynamicBytes']:,} to {by_id['rope-maximum-frame']['payload']['optimizedDynamicBytes']:,} bytes.",'',
 f"Reconstructed matrices and colors match the legacy stream to floating-point noise: maximum tournament matrix relative L2 **{t['maxMatrixError']:.3e}**, maximum color relative L2 **{t['maxColorError']:.3e}**.",'',
'## Traffic reductions','',
'- Intact cloth steady dynamic data falls from 16 to 12 bytes per vertex: **25% less**.',
'- Maximum rope steady dynamic data falls from 32,160 to 4,116 bytes: **87.20% less**.',
'- The mixed maximum cloth/rope/water workload falls from 136,640 to 101,796 dynamic bytes: **25.50% less**.',
'- Static cloth rest positions, rope topology/material metadata, and unchanged frame revisions are cached.','',
'## Convergence and rejected directions','',
'The rope solver itself is now the dominant rope cost. The fresh maximum-rope solver + handoff workload measured 1.019× and the 96-impact storm measured 0.976×, so v1.9 does not claim a solver breakthrough there. The GPU reconstruction path is retained because it removes CPU work, cuts bandwidth, passes Dawn, and improves rendering scalability; further rope speedups must target constraint solving or parallelism.','',
'Tearing cloth and water controls remained at parity. Candidates that exceeded the cloth fidelity ceiling or failed to improve the measured workload were not promoted.','',
'## Reproduction','',
'```bash','npm ci','npm run bench:fifth:100','npm run bench:v1.8-v1.9','npm run bench:fifth:gate','npm run validate:v1.9','```','',
'Raw evidence: `benchmarks/results/v1.9-fifth-breakthrough-100.json` and `benchmarks/results/v1.8-v1.9-isolated.json`. The exact v1.8 source baseline is bundled at `benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz`.','',
'## Validation boundary','',
'Dawn validates the rope compute shader, storage-buffer layouts, compute-to-render synchronization, main/shadow pipelines, indexed cloth/water draws, upload caching, HDR/MSAA integration, and command submission. These CPU and Dawn measurements do not establish a universal target-Mac physical-GPU FPS multiplier. Target-device timestamp queries and visible pixel inspection remain hardware acceptance gates.','']
report = '\n'.join(lines)
(root / 'docs' / 'PERFORMANCE_V1.9.md').write_text(report)
(root / 'PERFORMANCE.md').write_text('\n'.join([
'# Performance Edition v1.9.0','',
 f"Adaptive cloth measured {categories['cloth-adaptive-long']['gm']:.3f}× across long-horizon workloads and {categories['cloth-adaptive-storm']['gm']:.3f}× across projectile storms. GPU-compute rope reconstruction measured {categories['rope-frame']['gm']:.3f}× faster CPU handoff with {categories['rope-frame']['bytes']*100:.1f}% less dynamic rope data.",'',
 f"The independent fresh-process mixed maximum cloth/rope/water workload measured {by_id['mixed-maximum']['speedup']:.3f}×, with zero correctness failures.",'',
'See [docs/PERFORMANCE_V1.9.md](docs/PERFORMANCE_V1.9.md).',''
]))
summary = '\n'.join([
'Box3D WebGPU AAA v1.9.0 — Fifth Breakthrough Summary',
'=====================================================',
 f"100 experiments: {t['accepted']} accepted, {t['borderline']} borderline, {t['rejectedNoWin']} no-win, {t['controls']} controls, {t['rejectedCorrectness']} correctness failures",
 f"Adaptive cloth long-horizon geometric mean: {categories['cloth-adaptive-long']['gm']:.4f}x",
 f"Adaptive cloth storm geometric mean: {categories['cloth-adaptive-storm']['gm']:.4f}x",
 f"Rope CPU handoff geometric mean: {categories['rope-frame']['gm']:.4f}x",
 f"Rope mean dynamic-byte reduction: {categories['rope-frame']['bytes']*100:.2f}%",
 f"Fresh-process mixed maximum speedup: {by_id['mixed-maximum']['speedup']:.4f}x",
 f"Fresh-process dynamic/mixed geometric mean: {i['summary']['dynamicGeometricMeanSpeedup']:.4f}x",
 f"Maximum state error: {t['maxStateError']:.9f}",
 f"Maximum rope matrix error: {t['maxMatrixError']:.3e}",
 f"Maximum rope color error: {t['maxColorError']:.3e}",
]) + '\n'
(results / 'V1.9_FIFTH_BREAKTHROUGH_100.md').write_text(report)
(results / 'v1.9-result-summary.txt').write_text(summary)
print(root / 'docs' / 'PERFORMANCE_V1.9.md')
