# WebPhysics v1.12 production-path 100-case benchmark

Generated: 2026-07-16T14:24:41.828Z

Baseline: **v1.11.0 exact source archive**; candidate: **v1.12 working tree**.

Smoke subset **15** cases, **8** timed samples per variant/case, with an equal number of both execution orders.

Baseline archive SHA-256: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`.

Candidate source digest: `126034929d08747a1496c2c92f3a7b50797a151208489801e0912402b4d6812a` (49 files).

Harness digest: `d2261ef2ec80ffa0d246f50021aebe488174c26a0f5898e0a31a667d4bbac087`.

## Summary

- Accepted wins: **3**
- Borderline: **10**
- Rejected, no win: **2**
- Rejected, correctness: **0**
- Controls: **0**
- Cases whose minimum observed batch met 25 ms: **14/15** (0 reached the repeat cap)
- Changed-path geometric mean: **1.0094x**
- Deterministic baseline/candidate groups: **30/30**
- Exact unchanged before/after groups: **0/0**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| fallback | 15 | 1.0094x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | 95% CI | Batch reps | State L2 | Deterministic | Decision |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.464968 | 0.484465 | 0.9759x | 0.906–0.998 | 3 | 0.000e+0 | yes | rejected-no-win |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.061756 | 0.062794 | 0.9781x | 0.969–0.987 | 27 | 0.000e+0 | yes | rejected-no-win |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.445632 | 0.447132 | 0.9944x | 0.984–1.009 | 3 | 0.000e+0 | yes | borderline |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.070327 | 0.066472 | 1.0492x | 1.025–1.086 | 29 | 0.000e+0 | yes | accepted |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.083847 | 0.083605 | 0.9960x | 0.898–1.317 | 16 | 0.000e+0 | yes | borderline |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.454032 | 0.446989 | 1.0077x | 0.991–1.033 | 4 | 0.000e+0 | yes | borderline |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.368892 | 0.374256 | 0.9895x | 0.979–1.005 | 4 | 0.000e+0 | yes | borderline |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.036156 | 0.033540 | 1.0755x | 1.069–1.079 | 68 | 0.000e+0 | yes | accepted |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.060039 | 0.060325 | 0.9905x | 0.980–1.006 | 21 | 0.000e+0 | yes | borderline |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.083946 | 0.085257 | 0.9885x | 0.985–1.001 | 21 | 0.000e+0 | yes | borderline |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.341949 | 0.345984 | 1.0003x | 0.979–1.008 | 5 | 0.000e+0 | yes | borderline |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.105664 | 0.097728 | 1.0819x | 1.059–1.097 | 19 | 0.000e+0 | yes | accepted |
| 68 | fallback | Bridge Load Test — Cinematic | 0.045292 | 0.045610 | 0.9968x | 0.983–1.005 | 26 | 0.000e+0 | yes | borderline |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.046593 | 0.044208 | 1.0417x | 1.024–1.056 | 38 | 0.000e+0 | yes | borderline |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.338032 | 0.341875 | 0.9833x | 0.962–1.000 | 4 | 0.000e+0 | yes | borderline |

## Gates

- Every timed sample starts from the same scene, seed, stress, and action setup.
- Every case has an equal number of baseline-first and candidate-first samples.
- Reported speedup is the geometric mean of the two order-stratified median ratios.
- Every non-control acceptance requires a >1.00 lower bound from a deterministic 95% order-stratified bootstrap and non-regression in both order strata.
- Timed batches are calibrated toward at least 25 ms per implementation where the 512-repeat safety cap permits it.
- Medians and median absolute deviations are retained in JSON.
- All authoritative state and render streams must remain finite.
- Node/body/instance counts and soft-system break counts must match.
- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.
- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.
- JavaScript controls retain their strict control thresholds.
- Each implementation must reproduce an identical result fingerprint across its samples.
- Exact baseline archive, candidate source-tree, and benchmark-harness digests are recorded and source stability is asserted at the end.
