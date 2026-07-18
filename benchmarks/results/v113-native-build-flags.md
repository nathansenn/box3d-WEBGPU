# v1.13 native allocator build-flag tournament

Verdict: **do not integrate emmalloc**.

Exactly **100** semantically unique workloads used 8 balanced samples per variant and timed batches no shorter than 20 ms. All stateful workloads matched every matrix/color bit, counter/revision, action return, and replay hash.

- Allocator-sensitive complete-path geometric mean: **1.0049×** (gate: >=1.03×)
- Solver-control geometric mean: **1.0062×** (gate: >=0.98×)
- Worst individual median: **0.9756×** (gate: >=0.95×)
- Startup speedup: **0.9777×**
- Artifact size: **410,412 B → 403,851 B** (6,561 B saved; 1.0162× smaller ratio)

## Category results

| Category | Workloads | Geometric mean | Worst median |
|---|---:|---:|---:|
| create | 20 | 1.0018× | 0.9815× |
| action | 20 | 1.0076× | 0.9756× |
| active | 20 | 1.0047× | 0.9882× |
| settled | 20 | 1.0076× | 0.9916× |
| mixed-lifecycle | 19 | 1.0068× | 0.9960× |
| startup | 1 | 0.9777× | 0.9777× |

## Ten slowest emmalloc comparisons

| Workload | Default/emmalloc | 95% interval | Classification |
|---|---:|---:|---|
| action-09-kick | 0.9756× | 0.9545–1.0065× | parity / inconclusive |
| startup-00-module-import-compile-instantiate | 0.9777× | 0.8865–1.1108× | parity / inconclusive |
| create-09-scene-149 | 0.9815× | 0.9776–0.9887× | small measured regression |
| create-08-scene-139 | 0.9850× | 0.9751–1.0026× | parity / inconclusive |
| action-01-kick | 0.9864× | 0.9624–1.0093× | parity / inconclusive |
| action-13-kick | 0.9880× | 0.9716–1.0223× | parity / inconclusive |
| active-07-scene-210 | 0.9882× | 0.9762–1.0214× | parity / inconclusive |
| active-09-scene-268 | 0.9891× | 0.9661–1.0031× | parity / inconclusive |
| create-01-scene-3 | 0.9892× | 0.9823–0.9947× | small measured regression |
| active-11-scene-326 | 0.9903× | 0.9739–1.0172× | parity / inconclusive |

Recommendation: Do not integrate -sMALLOC=emmalloc: it fails at least one predeclared complete-path performance/control/regression gate despite exact output.

Raw balanced samples, hashes, artifact identities, link commands, and all 100 workload definitions are retained in the JSON evidence.
