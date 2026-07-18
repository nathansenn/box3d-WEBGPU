# WebPhysics v1.11 fallback exact-gains benchmark

Generated: 2026-07-15T10:10:08.355Z

Samples per scene/order: **9**. All 270 timed paired output comparisons and 3 boundary suites were byte-exact.

## Exactness guards

- Captures detached from the live fallback heap: **passed**.
- Candidate source stable during the run: **yes**.
- Boundary suites: zero-axis-diagonal-and-adjacent-boundary (8 bodies); minimum-radius-clamp (3 bodies); large-finite-radius (4 bodies).

## One-time static transform and material streams

Geometric-mean speedup: **1.3827x** (range 0.9906-2.5783x).

| Scene | Before ms/op | After ms/op | Speedup |
|---|---:|---:|---:|
| 49 Cross-Laminated Block Grid — Cinematic | 0.146754 | 0.146787 | 0.9998x |
| 99 Thin-Body Stability Trial — Cinematic | 0.013479 | 0.010506 | 1.2830x |
| 149 Needle Spire Shake Test — Cinematic | 0.023112 | 0.020925 | 1.1045x |
| 199 Multi-Pier Viaduct — Cinematic | 0.010665 | 0.007773 | 1.3720x |
| 249 Energy Loss Arena — Cinematic | 0.007607 | 0.004852 | 1.5679x |
| 299 Dense Core Rain Column — Cinematic | 0.179058 | 0.180754 | 0.9906x |
| 349 Progressive Collapse Theater — Cinematic | 0.020039 | 0.018575 | 1.0788x |
| 399 Heavy Hauler Load Shift — Cinematic | 0.006184 | 0.002398 | 2.5783x |
| 449 Physics Toy Museum — Cinematic | 0.011087 | 0.005841 | 1.8981x |
| 499 Foundation Block Layout — Cinematic | 0.007685 | 0.004815 | 1.5960x |
| 549 Inventory Earthquake Proxy — Cinematic | 0.026100 | 0.023385 | 1.1161x |
| 599 Mega Structure Showcase — Cinematic | 0.010149 | 0.007663 | 1.3244x |
| 190 Bridge Load Test — Cinematic | 0.006325 | 0.003069 | 2.0608x |
| 240 Material Bounce Lab — Cinematic | 0.006813 | 0.004134 | 1.6482x |
| 290 Object Rain Stress Test — Cinematic | 0.152954 | 0.151304 | 1.0109x |

## Allocation-free broad-rejected explosions

Geometric-mean speedup: **3.5536x** (range 0.8339-7.6182x).

| Scene | Before ms/op | After ms/op | Speedup |
|---|---:|---:|---:|
| 49 Cross-Laminated Block Grid — Cinematic | 0.094828 | 0.035531 | 2.6689x |
| 99 Thin-Body Stability Trial — Cinematic | 0.004510 | 0.000592 | 7.6182x |
| 149 Needle Spire Shake Test — Cinematic | 0.010662 | 0.002645 | 4.0312x |
| 199 Multi-Pier Viaduct — Cinematic | 0.003447 | 0.000976 | 3.5309x |
| 249 Energy Loss Arena — Cinematic | 0.002246 | 0.000662 | 3.3942x |
| 299 Dense Core Rain Column — Cinematic | 0.045612 | 0.009629 | 4.7370x |
| 349 Progressive Collapse Theater — Cinematic | 0.009882 | 0.002849 | 3.4685x |
| 399 Heavy Hauler Load Shift — Cinematic | 0.001049 | 0.001258 | 0.8339x |
| 449 Physics Toy Museum — Cinematic | 0.002469 | 0.000651 | 3.7907x |
| 499 Foundation Block Layout — Cinematic | 0.002244 | 0.000566 | 3.9621x |
| 549 Inventory Earthquake Proxy — Cinematic | 0.013038 | 0.003460 | 3.7684x |
| 599 Mega Structure Showcase — Cinematic | 0.003502 | 0.000909 | 3.8547x |
| 190 Bridge Load Test — Cinematic | 0.001516 | 0.000446 | 3.3968x |
| 240 Material Bounce Lab — Cinematic | 0.001971 | 0.000613 | 3.2179x |
| 290 Object Rain Stress Test — Cinematic | 0.046584 | 0.008217 | 5.6695x |

Static transform/material timings isolate recurring stream synchronization. Explosion timings exclude setup and final stream synchronization.
