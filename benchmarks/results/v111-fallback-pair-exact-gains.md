# v1.11 allocation-free fallback contact benchmark

Candidate source: `a08416021fca58bb10c49b383260490e4158bb98ca720cc95dd587b14cf29dd3` (stable: **yes**).

Archived baseline SHA-256: `dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5`.

Configuration: 21 samples, 4 warm-up + 72 timed complete frames per scene, 50,000 bootstrap resamples.

Pre-edit control → scalar candidate geometric mean: **1.0626x**.
Paired bootstrap 95% interval: **1.0544-1.0723x**.
Archived v1.10 → scalar candidate geometric mean: **1.2470x**.
Acceptance gate: **passed**.

| Scene | Bodies | Candidates | Pre-edit ms/frame | Scalar ms/frame | Speedup | v1.10 speedup |
|---|---:|---:|---:|---:|---:|---:|
| 49 Cross-Laminated Block Grid — Cinematic | 3462 | 402 | 0.7474 | 0.6796 | 1.0998x | 1.1263x |
| 99 Thin-Body Stability Trial — Cinematic | 271 | 0 | 0.0661 | 0.0649 | 1.0176x | 1.3765x |
| 149 Needle Spire Shake Test — Cinematic | 587 | 1170 | 0.7473 | 0.6546 | 1.1415x | 1.2183x |
| 199 Multi-Pier Viaduct — Cinematic | 254 | 89 | 0.1073 | 0.1021 | 1.0511x | 1.2804x |
| 249 Energy Loss Arena — Cinematic | 188 | 3 | 0.0813 | 0.0830 | 0.9801x | 1.1822x |
| 299 Dense Core Rain Column — Cinematic | 2227 | 0 | 0.5925 | 0.5834 | 1.0156x | 1.0417x |
| 349 Progressive Collapse Theater — Cinematic | 510 | 545 | 0.4716 | 0.4006 | 1.1773x | 1.2900x |
| 399 Heavy Hauler Load Shift — Cinematic | 153 | 2 | 0.0316 | 0.0311 | 1.0156x | 1.5429x |
| 449 Physics Toy Museum — Cinematic | 263 | 4 | 0.0780 | 0.0771 | 1.0126x | 1.3246x |
| 499 Foundation Block Layout — Cinematic | 181 | 72 | 0.1153 | 0.1024 | 1.1265x | 1.3057x |
| 549 Inventory Earthquake Proxy — Cinematic | 654 | 325 | 0.6187 | 0.6021 | 1.0275x | 1.0415x |
| 599 Mega Structure Showcase — Cinematic | 262 | 266 | 0.1417 | 0.1280 | 1.1066x | 1.3244x |

All timed samples were exact for matrices, colors, Float64 body state, replay hash, body counts, broadphase axis, and candidate count.
