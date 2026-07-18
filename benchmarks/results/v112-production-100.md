# WebPhysics v1.12 production-path 100-case benchmark

Generated: 2026-07-16T15:10:33.135Z

Baseline: **v1.11.0 exact source archive**; candidate: **v1.12 working tree**.

Exactly **100** cases, **8** timed samples per variant/case, with an equal number of both execution orders.

Baseline archive SHA-256: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`.

Candidate source digest: `c27e51857777bbe9cd096f48aeddba26af61fd43d6592206298f70446c1097e7` (49 files).

Harness digest: `fa5e84dc492bb4004e4ae76702ae613fe4e2f097e6dae9e817cdaec820460bdd`.

## Summary

- Accepted wins: **14**
- Borderline: **14**
- Rejected, no win: **0**
- Rejected, correctness: **0**
- Controls: **72**
- Cases whose minimum observed batch met 25 ms: **90/100** (5 reached the repeat cap)
- Changed-path geometric mean: **1.0640x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **16/16**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.0087x | 0 |
| rope-wasm | 25 | 1.0023x | 0 |
| fallback | 15 | 1.0038x | 0 |
| effects | 10 | 1.1179x | 0 |
| water-rain | 5 | 1.1129x | 0 |
| water-control | 5 | 0.9981x | 0 |
| js-soft | 5 | 0.9986x | 0 |
| unchanged-control | 5 | 1.0296x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | 95% CI | Batch reps | State L2 | Deterministic | Decision |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 1.653119 | 1.573433 | 1.0486x | 1.029–1.065 | 2 | 0.000e+0 | yes | accepted |
| 2 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.650652 | 1.578528 | 1.0468x | 1.028–1.064 | 2 | 0.000e+0 | yes | accepted |
| 3 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.648108 | 1.575705 | 1.0491x | 1.040–1.058 | 2 | 0.000e+0 | yes | accepted |
| 4 | cloth-wasm | Racing Sail Aerodynamics — Impact Demo | 1.896344 | 1.801509 | 1.0504x | 1.037–1.060 | 2 | 0.000e+0 | yes | accepted |
| 5 | cloth-wasm | Racing Sail Aerodynamics — Cinematic | 2.142078 | 2.085223 | 1.0451x | 1.016–1.061 | 1 | 0.000e+0 | yes | accepted |
| 6 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.468059 | 1.461225 | 1.0044x | 0.990–1.013 | 2 | 0.000e+0 | yes | borderline |
| 7 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.481145 | 1.482927 | 0.9973x | 0.992–1.007 | 2 | 0.000e+0 | yes | borderline |
| 8 | cloth-wasm | Cargo Net Load Catch — Precision | 1.483183 | 1.452751 | 1.0166x | 1.008–1.030 | 2 | 0.000e+0 | yes | borderline |
| 9 | cloth-wasm | Cargo Net Load Catch — Impact Demo | 1.570624 | 1.570051 | 1.0037x | 0.993–1.027 | 2 | 0.000e+0 | yes | borderline |
| 10 | cloth-wasm | Cargo Net Load Catch — Cinematic | 1.696639 | 1.693629 | 1.0074x | 0.992–1.026 | 2 | 0.000e+0 | yes | borderline |
| 11 | cloth-wasm | Drape Over Collider — Baseline | 1.882468 | 1.891449 | 0.9963x | 0.981–1.026 | 1 | 0.000e+0 | yes | borderline |
| 12 | cloth-wasm | Drape Over Collider — High Stress | 1.892204 | 1.917113 | 0.9908x | 0.988–1.003 | 2 | 0.000e+0 | yes | borderline |
| 13 | cloth-wasm | Drape Over Collider — Precision | 1.870381 | 1.872181 | 0.9963x | 0.982–1.017 | 1 | 0.000e+0 | yes | borderline |
| 14 | cloth-wasm | Drape Over Collider — Impact Demo | 3.365846 | 3.704846 | 0.9936x | 0.905–1.004 | 1 | 0.000e+0 | yes | borderline |
| 15 | cloth-wasm | Drape Over Collider — Cinematic | 3.999468 | 3.736237 | 1.0124x | 1.000–1.086 | 1 | 0.000e+0 | yes | borderline |
| 16 | cloth-wasm | Tempest Standard — Baseline | 1.693818 | 1.685576 | 1.0035x | 0.993–1.018 | 2 | 0.000e+0 | yes | control |
| 17 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 1.749471 | 1.753992 | 0.9984x | 0.973–1.015 | 1 | 0.000e+0 | yes | control |
| 18 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.777273 | 1.772452 | 1.0045x | 0.990–1.017 | 2 | 0.000e+0 | yes | control |
| 19 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 1.614523 | 1.615691 | 0.9988x | 0.991–1.008 | 2 | 0.000e+0 | yes | control |
| 20 | cloth-wasm | Tempest Standard — High Stress | 1.699984 | 1.678932 | 1.0135x | 0.999–1.026 | 2 | 0.000e+0 | yes | control |
| 21 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 1.768750 | 1.764064 | 1.0024x | 0.988–1.015 | 1 | 0.000e+0 | yes | control |
| 22 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.779807 | 1.772252 | 1.0019x | 0.983–1.021 | 2 | 0.000e+0 | yes | control |
| 23 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.598574 | 1.622443 | 0.9961x | 0.977–1.013 | 2 | 0.000e+0 | yes | control |
| 24 | cloth-wasm | Grand Theater Curtain — High Stress | 1.742645 | 1.740361 | 1.0020x | 0.990–1.009 | 2 | 0.000e+0 | yes | control |
| 25 | cloth-wasm | Tensioned Membrane Drum — High Stress | 0.785498 | 0.783931 | 1.0073x | 0.988–1.021 | 3 | 0.000e+0 | yes | control |
| 26 | cloth-wasm | Tempest Standard — Precision | 1.697366 | 1.715637 | 0.9899x | 0.983–1.024 | 2 | 0.000e+0 | yes | control |
| 27 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 1.750409 | 1.753199 | 0.9976x | 0.983–1.016 | 1 | 0.000e+0 | yes | control |
| 28 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.786431 | 1.795396 | 0.9970x | 0.984–1.003 | 2 | 0.000e+0 | yes | control |
| 29 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.619720 | 1.616351 | 1.0040x | 0.993–1.014 | 2 | 0.000e+0 | yes | control |
| 30 | cloth-wasm | Tensioned Membrane Drum — Precision | 1.038459 | 1.049237 | 0.9907x | 0.979–1.008 | 2 | 0.000e+0 | yes | control |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.074120 | 0.073898 | 1.0077x | 0.982–1.031 | 20 | 0.000e+0 | yes | control |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.143284 | 0.136348 | 1.0582x | 1.043–1.069 | 13 | 0.000e+0 | yes | control |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.062500 | 0.062753 | 1.0063x | 0.953–1.012 | 24 | 0.000e+0 | yes | control |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.147256 | 0.139036 | 1.0444x | 1.028–1.162 | 13 | 0.000e+0 | yes | control |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.152434 | 0.154381 | 0.9842x | 0.949–1.011 | 10 | 0.000e+0 | yes | control |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.381872 | 0.366889 | 1.0359x | 1.012–1.058 | 5 | 0.000e+0 | yes | control |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.062229 | 0.063268 | 1.0085x | 0.919–1.062 | 23 | 0.000e+0 | yes | control |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.096102 | 0.096932 | 1.0020x | 0.972–1.033 | 16 | 0.000e+0 | yes | control |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.158040 | 0.158695 | 0.9987x | 0.979–1.010 | 10 | 0.000e+0 | yes | control |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.379391 | 0.364132 | 1.0436x | 1.027–1.051 | 5 | 0.000e+0 | yes | control |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.062247 | 0.062792 | 0.9647x | 0.932–0.999 | 24 | 0.000e+0 | yes | control |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.149136 | 0.138750 | 1.0393x | 1.031–1.162 | 12 | 0.000e+0 | yes | control |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.062163 | 0.062717 | 0.9903x | 0.979–1.006 | 24 | 0.000e+0 | yes | control |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.124426 | 0.124641 | 0.9956x | 0.986–1.006 | 14 | 0.000e+0 | yes | control |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.152133 | 0.153530 | 0.9877x | 0.958–1.014 | 10 | 0.000e+0 | yes | control |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.372652 | 0.373227 | 1.0022x | 0.979–1.029 | 5 | 0.000e+0 | yes | control |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.063697 | 0.062344 | 1.0199x | 0.920–1.104 | 24 | 0.000e+0 | yes | control |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.060496 | 0.061315 | 0.9699x | 0.910–1.006 | 30 | 0.000e+0 | yes | control |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.159451 | 0.160241 | 0.9963x | 0.981–1.006 | 10 | 0.000e+0 | yes | control |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.325854 | 0.325914 | 1.0068x | 0.986–1.023 | 6 | 0.000e+0 | yes | control |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.062125 | 0.063409 | 0.9708x | 0.888–1.074 | 24 | 0.000e+0 | yes | control |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.125001 | 0.123349 | 1.0108x | 0.988–1.024 | 14 | 0.000e+0 | yes | control |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.063227 | 0.062662 | 1.0043x | 0.936–1.070 | 24 | 0.000e+0 | yes | control |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.158644 | 0.159405 | 0.9404x | 0.873–1.107 | 10 | 0.000e+0 | yes | control |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.151518 | 0.156146 | 0.9779x | 0.967–1.005 | 10 | 0.000e+0 | yes | control |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.489136 | 0.452367 | 1.0234x | 1.002–1.206 | 3 | 0.000e+0 | yes | control |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.070283 | 0.070658 | 0.9894x | 0.971–1.001 | 19 | 0.000e+0 | yes | control |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.377970 | 0.377671 | 1.0018x | 0.984–1.013 | 5 | 0.000e+0 | yes | control |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.072179 | 0.072010 | 1.0056x | 0.826–1.122 | 17 | 0.000e+0 | yes | control |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.064881 | 0.080250 | 0.9935x | 0.772–1.006 | 26 | 0.000e+0 | yes | control |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.456904 | 0.451340 | 1.0209x | 0.989–1.030 | 4 | 0.000e+0 | yes | control |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.306688 | 0.308277 | 0.9979x | 0.990–1.006 | 6 | 0.000e+0 | yes | control |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.037832 | 0.037379 | 1.0267x | 0.659–1.573 | 30 | 0.000e+0 | yes | control |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.056864 | 0.057087 | 0.9971x | 0.987–1.017 | 28 | 0.000e+0 | yes | control |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.092778 | 0.093352 | 0.9977x | 0.990–1.014 | 14 | 0.000e+0 | yes | control |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.338056 | 0.337269 | 0.9974x | 0.981–1.014 | 6 | 0.000e+0 | yes | control |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.112794 | 0.112680 | 1.0023x | 0.995–1.005 | 14 | 0.000e+0 | yes | control |
| 68 | fallback | Bridge Load Test — Cinematic | 0.035642 | 0.035384 | 1.0050x | 0.990–1.018 | 56 | 0.000e+0 | yes | control |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.043318 | 0.043596 | 0.9946x | 0.979–1.007 | 31 | 0.000e+0 | yes | control |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.335408 | 0.333227 | 1.0041x | 0.985–1.016 | 5 | 0.000e+0 | yes | control |
| 71 | effects | Cinematic effects variant 1 | 0.007325 | 0.007247 | 1.0264x | 0.972–1.103 | 131 | 0.000e+0 | yes | borderline |
| 72 | effects | Cinematic effects variant 2 | 0.034518 | 0.029907 | 1.1393x | 0.998–1.242 | 46 | 0.000e+0 | yes | borderline |
| 73 | effects | Cinematic effects variant 3 | 0.033120 | 0.029080 | 1.1371x | 0.995–1.343 | 31 | 0.000e+0 | yes | borderline |
| 74 | effects | Cinematic effects variant 4 | 0.045109 | 0.042834 | 1.0809x | 1.007–1.164 | 30 | 0.000e+0 | yes | accepted |
| 75 | effects | Cinematic effects variant 5 | 0.023313 | 0.015763 | 1.4161x | 1.293–1.490 | 73 | 0.000e+0 | yes | accepted |
| 76 | effects | Cinematic effects variant 6 | 0.042734 | 0.038248 | 1.1230x | 1.010–1.250 | 28 | 0.000e+0 | yes | accepted |
| 77 | effects | Cinematic effects variant 7 | 0.043486 | 0.038401 | 1.1339x | 1.029–1.265 | 28 | 0.000e+0 | yes | accepted |
| 78 | effects | Cinematic effects variant 8 | 0.000009 | 0.000010 | 0.9847x | 0.816–1.173 | 69 | 0.000e+0 | yes | control |
| 79 | effects | Cinematic effects variant 9 | 0.000010 | 0.000007 | 1.2054x | 1.145–1.340 | 70 | 0.000e+0 | yes | control |
| 80 | effects | Cinematic effects variant 10 | 0.000008 | 0.000008 | 0.9905x | 0.810–1.258 | 88 | 0.000e+0 | yes | control |
| 81 | water-rain | Interactive Ripple Basin — Cinematic | 0.059782 | 0.054081 | 1.0937x | 1.047–1.190 | 23 | 0.000e+0 | yes | accepted |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.022462 | 0.022954 | 0.9814x | 0.945–1.000 | 49 | 0.000e+0 | yes | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.029425 | 0.028345 | 1.0261x | 0.992–1.044 | 37 | 0.000e+0 | yes | control |
| 84 | water-rain | Hydrodynamic Boat Wake — Cinematic | 0.098740 | 0.092470 | 1.0686x | 1.035–1.097 | 11 | 0.000e+0 | yes | accepted |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.026358 | 0.026727 | 0.9887x | 0.966–1.014 | 38 | 0.000e+0 | yes | control |
| 86 | water-rain | Rain Impact Reservoir — Cinematic | 0.079975 | 0.068591 | 1.1667x | 1.089–1.218 | 16 | 0.000e+0 | yes | accepted |
| 87 | water-rain | Dam-Breach Wave Front — Cinematic | 0.063752 | 0.055323 | 1.1445x | 1.069–1.199 | 17 | 0.000e+0 | yes | accepted |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.028341 | 0.028047 | 1.0143x | 0.994–1.048 | 40 | 0.000e+0 | yes | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.040668 | 0.041061 | 0.9808x | 0.952–1.015 | 25 | 0.000e+0 | yes | control |
| 90 | water-rain | Leviathan Impact Pool — Cinematic | 0.079779 | 0.071955 | 1.0941x | 1.052–1.121 | 16 | 0.000e+0 | yes | accepted |
| 91 | js-soft | Tempest Standard — Baseline | 1.938146 | 1.947479 | 0.9933x | 0.962–1.011 | 1 | 0.000e+0 | yes | control |
| 92 | js-soft | Cargo Net Load Catch — Cinematic | 1.942461 | 1.894951 | 0.9960x | 0.990–1.030 | 2 | 0.000e+0 | yes | borderline |
| 93 | js-soft | Sky Crane Cable Load — Baseline | 0.086288 | 0.086055 | 1.0033x | 0.988–1.009 | 19 | 0.000e+0 | yes | control |
| 94 | js-soft | Rope Net Resonance — Cinematic | 0.533572 | 0.536546 | 0.9900x | 0.985–1.007 | 4 | 0.000e+0 | yes | control |
| 95 | js-soft | Leviathan Impact Pool — Cinematic | 0.208327 | 0.205806 | 1.0107x | 1.000–1.023 | 8 | 0.000e+0 | yes | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000071 | 0.000071 | 1.0094x | 0.952–1.048 | 64 | 0.000e+0 | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000074 | 0.000074 | 0.9893x | 0.966–1.010 | 64 | 0.000e+0 | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000071 | 0.000073 | 1.1026x | 0.680–1.384 | 64 | 0.000e+0 | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000070 | 0.000072 | 1.0073x | 0.967–1.023 | 64 | 0.000e+0 | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000074 | 0.000072 | 1.0431x | 0.980–1.107 | 64 | 0.000e+0 | yes | control |

## Gates

- Every timed sample starts from the same scene, seed, stress, and action setup.
- Every case has an equal number of baseline-first and candidate-first samples.
- Reported speedup is the geometric mean of the two order-stratified median ratios.
- Every non-control acceptance requires a >1.00 lower bound from a deterministic 95% order-stratified bootstrap and non-regression in both order strata.
- Timed batches are calibrated toward at least 25 ms per implementation where each case's declared repeat safety cap permits it.
- Medians and median absolute deviations are retained in JSON.
- All authoritative state and render streams must remain finite.
- Node/body/instance counts and soft-system break counts must match.
- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.
- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.
- JavaScript controls retain their strict control thresholds.
- Each implementation must reproduce an identical result fingerprint across its samples.
- Exact baseline archive, candidate source-tree, and benchmark-harness digests are recorded and source stability is asserted at the end.
