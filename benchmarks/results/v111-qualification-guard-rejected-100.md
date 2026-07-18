# WebPhysics v1.11 production-path 100-case benchmark

Generated: 2026-07-15T09:25:55.294Z

Baseline: **v1.10.0 exact source archive**; candidate: **working tree**.

Exactly **100** cases, **7** timed samples per variant/case, alternating execution order.

## Summary

- Accepted wins: **39**
- Borderline: **7**
- Rejected, no win: **14**
- Rejected, correctness: **10**
- Controls: **30**
- Changed-path geometric mean: **1.0267x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **10/10**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.0275x | 10 |
| rope-wasm | 25 | 1.0373x | 0 |
| fallback | 15 | 1.0078x | 0 |
| effects | 10 | 0.9445x | 0 |
| water-control | 10 | 0.9437x | 0 |
| js-control | 5 | 1.0038x | 0 |
| unchanged-control | 5 | 1.0232x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 1 | cloth-wasm | Tempest Standard — Baseline | 1.541867 | 1.799661 | 0.8568x | 1.475e-2 | match | yes | — | rejected-correctness |
| 2 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 1.676860 | 1.812665 | 0.9251x | 1.368e-3 | match | yes | — | rejected-no-win |
| 3 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.637407 | 1.455303 | 1.1251x | 1.325e-3 | match | yes | — | accepted |
| 4 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.521581 | 1.256795 | 1.2107x | 1.104e-5 | match | yes | — | accepted |
| 5 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 1.551590 | 1.368146 | 1.1341x | 7.996e-4 | match | yes | — | accepted |
| 6 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 1.602367 | 1.836904 | 0.8723x | 1.439e-2 | match | yes | — | rejected-correctness |
| 7 | cloth-wasm | Drape Over Collider — Baseline | 2.018771 | 1.644168 | 1.2278x | 2.137e-4 | match | yes | — | accepted |
| 8 | cloth-wasm | Grand Theater Curtain — Baseline | 1.597090 | 1.753368 | 0.9109x | 1.353e-3 | match | yes | — | rejected-no-win |
| 9 | cloth-wasm | Tensioned Membrane Drum — Baseline | 0.792340 | 0.756538 | 1.0473x | 1.112e-5 | match | yes | — | accepted |
| 10 | cloth-wasm | Tempest Standard — High Stress | 1.868227 | 1.813245 | 1.0303x | 0.000e+0 | match | yes | — | accepted |
| 11 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 1.681705 | 1.828249 | 0.9198x | 2.657e-3 | match | yes | — | rejected-correctness |
| 12 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.636479 | 1.428877 | 1.1453x | 9.260e-4 | match | yes | — | accepted |
| 13 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.520269 | 1.241757 | 1.2243x | 9.201e-6 | match | yes | — | accepted |
| 14 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.557734 | 1.391977 | 1.1191x | 2.157e-4 | match | yes | — | accepted |
| 15 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.613371 | 1.854675 | 0.8699x | 7.923e-3 | match | yes | — | rejected-correctness |
| 16 | cloth-wasm | Drape Over Collider — High Stress | 2.039495 | 1.663435 | 1.2261x | 1.972e-4 | match | yes | — | accepted |
| 17 | cloth-wasm | Grand Theater Curtain — High Stress | 1.591271 | 1.728985 | 0.9203x | 2.354e-3 | match | yes | — | rejected-correctness |
| 18 | cloth-wasm | Tensioned Membrane Drum — High Stress | 0.792388 | 0.762531 | 1.0392x | 1.107e-5 | match | yes | — | accepted |
| 19 | cloth-wasm | Tempest Standard — Precision | 1.559403 | 1.782988 | 0.8746x | 6.191e-3 | match | yes | — | rejected-correctness |
| 20 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 2.024127 | 1.879266 | 1.0771x | 0.000e+0 | match | yes | — | accepted |
| 21 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.642104 | 1.445513 | 1.1360x | 8.102e-4 | match | yes | — | accepted |
| 22 | cloth-wasm | Cargo Net Load Catch — Precision | 1.510830 | 1.238516 | 1.2199x | 9.078e-6 | match | yes | — | accepted |
| 23 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.564041 | 1.360880 | 1.1493x | 2.395e-4 | match | yes | — | accepted |
| 24 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.593044 | 1.833511 | 0.8688x | 4.426e-3 | match | yes | — | rejected-correctness |
| 25 | cloth-wasm | Drape Over Collider — Precision | 2.013815 | 1.669351 | 1.2063x | 3.543e-4 | match | yes | — | accepted |
| 26 | cloth-wasm | Grand Theater Curtain — Precision | 1.598451 | 1.752698 | 0.9120x | 2.085e-3 | match | yes | — | rejected-correctness |
| 27 | cloth-wasm | Tensioned Membrane Drum — Precision | 0.788877 | 0.762024 | 1.0352x | 1.107e-5 | match | yes | — | accepted |
| 28 | cloth-wasm | Tempest Standard — Impact Demo | 1.695848 | 1.930303 | 0.8785x | 5.513e-3 | match | yes | — | rejected-correctness |
| 29 | cloth-wasm | Royal Banner Wind Tunnel — Impact Demo | 1.822851 | 1.993691 | 0.9143x | 4.225e-3 | match | yes | — | rejected-correctness |
| 30 | cloth-wasm | Parachute Canopy Deployment — Impact Demo | 1.986957 | 1.995593 | 0.9957x | 0.000e+0 | match | yes | — | borderline |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.068572 | 0.074840 | 0.9162x | 0.000e+0 | match | yes | — | rejected-no-win |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.157941 | 0.121222 | 1.3029x | 1.027e-5 | match | yes | — | accepted |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.063367 | 0.060337 | 1.0502x | 1.001e-4 | match | yes | — | accepted |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.123399 | 0.112521 | 1.0967x | 1.199e-5 | match | yes | — | accepted |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.138604 | 0.164111 | 0.8446x | 0.000e+0 | match | yes | — | rejected-no-win |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.330313 | 0.313262 | 1.0544x | 1.245e-5 | match | yes | — | accepted |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.061606 | 0.060435 | 1.0194x | 2.143e-5 | match | yes | — | borderline |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.098712 | 0.082241 | 1.2003x | 1.719e-5 | match | yes | — | accepted |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.140190 | 0.145567 | 0.9631x | 0.000e+0 | match | yes | — | rejected-no-win |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.317950 | 0.285297 | 1.1145x | 2.794e-5 | match | yes | — | accepted |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.067222 | 0.060626 | 1.1088x | 1.299e-5 | match | yes | — | accepted |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.130896 | 0.115010 | 1.1381x | 1.027e-5 | match | yes | — | accepted |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.061217 | 0.058388 | 1.0484x | 1.001e-4 | match | yes | — | accepted |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.127552 | 0.113254 | 1.1262x | 1.199e-5 | match | yes | — | accepted |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.134340 | 0.159379 | 0.8429x | 0.000e+0 | match | yes | — | rejected-no-win |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.376910 | 0.359183 | 1.0494x | 1.981e-5 | match | yes | — | accepted |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.061967 | 0.060900 | 1.0175x | 2.143e-5 | match | yes | — | borderline |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.069974 | 0.059146 | 1.1831x | 2.105e-5 | match | yes | — | accepted |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.145168 | 0.154575 | 0.9391x | 0.000e+0 | match | yes | — | rejected-no-win |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.310873 | 0.293522 | 1.0591x | 2.794e-5 | match | yes | — | accepted |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.060596 | 0.059125 | 1.0249x | 1.299e-5 | match | yes | — | borderline |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.127241 | 0.112933 | 1.1267x | 1.027e-5 | match | yes | — | accepted |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.066159 | 0.064994 | 1.0179x | 1.001e-4 | match | yes | — | borderline |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.153424 | 0.153268 | 1.0010x | 9.317e-5 | match | yes | — | borderline |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.136558 | 0.163323 | 0.8361x | 0.000e+0 | match | yes | — | rejected-no-win |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.561193 | 0.525434 | 1.0681x | 0.000e+0 | match | yes | — | accepted |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.120587 | 0.286835 | 0.4204x | 0.000e+0 | match | yes | — | rejected-no-win |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.707092 | 0.455724 | 1.5516x | 0.000e+0 | match | yes | — | accepted |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.156490 | 0.190913 | 0.8197x | 0.000e+0 | match | yes | — | rejected-no-win |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.218714 | 0.170142 | 1.2855x | 0.000e+0 | match | yes | — | accepted |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.479759 | 0.480158 | 0.9992x | 0.000e+0 | match | yes | — | borderline |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.698111 | 0.502569 | 1.3891x | 0.000e+0 | match | yes | — | accepted |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.095009 | 0.110741 | 0.8579x | 0.000e+0 | match | yes | — | rejected-no-win |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.236314 | 0.137201 | 1.7224x | 0.000e+0 | match | yes | — | accepted |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.138045 | 0.268868 | 0.5134x | 0.000e+0 | match | yes | — | rejected-no-win |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.465740 | 0.337300 | 1.3808x | 0.000e+0 | match | yes | — | accepted |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.197042 | 0.284125 | 0.6935x | 0.000e+0 | match | yes | — | rejected-no-win |
| 68 | fallback | Bridge Load Test — Cinematic | 0.248474 | 0.122319 | 2.0314x | 0.000e+0 | match | yes | — | accepted |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.117201 | 0.178613 | 0.6562x | 0.000e+0 | match | yes | — | rejected-no-win |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.417773 | 0.366965 | 1.1385x | 0.000e+0 | match | yes | — | accepted |
| 71 | effects | Cinematic effects variant 1 | 0.015676 | 0.015738 | 0.9961x | 0.000e+0 | match | yes | — | control |
| 72 | effects | Cinematic effects variant 2 | 0.027355 | 0.031334 | 0.8730x | 0.000e+0 | match | yes | — | control |
| 73 | effects | Cinematic effects variant 3 | 0.029520 | 0.053145 | 0.5555x | 0.000e+0 | match | yes | — | control |
| 74 | effects | Cinematic effects variant 4 | 0.034865 | 0.032207 | 1.0825x | 0.000e+0 | match | yes | — | control |
| 75 | effects | Cinematic effects variant 5 | 0.026503 | 0.030333 | 0.8737x | 0.000e+0 | match | yes | — | control |
| 76 | effects | Cinematic effects variant 6 | 0.031895 | 0.027925 | 1.1422x | 0.000e+0 | match | yes | — | control |
| 77 | effects | Cinematic effects variant 7 | 0.029434 | 0.031732 | 0.9276x | 0.000e+0 | match | yes | — | control |
| 78 | effects | Cinematic effects variant 8 | 0.032653 | 0.032495 | 1.0049x | 0.000e+0 | match | yes | — | control |
| 79 | effects | Cinematic effects variant 9 | 0.013017 | 0.019773 | 0.6583x | 0.000e+0 | match | yes | — | control |
| 80 | effects | Cinematic effects variant 10 | 0.033940 | 0.019241 | 1.7639x | 0.000e+0 | match | yes | — | control |
| 81 | water-control | Interactive Ripple Basin — Cinematic | 0.026493 | 0.026170 | 1.0124x | 0.000e+0 | match | yes | — | control |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.024167 | 0.022173 | 1.0899x | 0.000e+0 | match | yes | — | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.029351 | 0.035681 | 0.8226x | 0.000e+0 | match | yes | — | control |
| 84 | water-control | Hydrodynamic Boat Wake — Cinematic | 0.049986 | 0.048136 | 1.0384x | 0.000e+0 | match | yes | — | control |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.024545 | 0.045308 | 0.5417x | 0.000e+0 | match | yes | — | control |
| 86 | water-control | Rain Impact Reservoir — Cinematic | 0.065334 | 0.052782 | 1.2378x | 0.000e+0 | match | yes | — | control |
| 87 | water-control | Dam-Breach Wave Front — Cinematic | 0.024343 | 0.030075 | 0.8094x | 0.000e+0 | match | yes | — | control |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.038177 | 0.032091 | 1.1896x | 0.000e+0 | match | yes | — | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.040428 | 0.058305 | 0.6934x | 0.000e+0 | match | yes | — | control |
| 90 | water-control | Leviathan Impact Pool — Cinematic | 0.046596 | 0.035096 | 1.3277x | 0.000e+0 | match | yes | — | control |
| 91 | js-control | Tempest Standard — Baseline | 1.779756 | 1.776777 | 1.0017x | 0.000e+0 | match | yes | — | control |
| 92 | js-control | Cargo Net Load Catch — Cinematic | 1.933698 | 1.933417 | 1.0001x | 0.000e+0 | match | yes | — | control |
| 93 | js-control | Sky Crane Cable Load — Baseline | 0.079263 | 0.076826 | 1.0317x | 0.000e+0 | match | yes | — | control |
| 94 | js-control | Rope Net Resonance — Cinematic | 0.517919 | 0.502940 | 1.0298x | 0.000e+0 | match | yes | — | control |
| 95 | js-control | Leviathan Impact Pool — Cinematic | 0.216214 | 0.225833 | 0.9574x | 0.000e+0 | match | yes | — | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000055 | 0.000051 | 1.0777x | 2.427e-7 | match | yes | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000046 | 0.000053 | 0.8707x | 4.501e-6 | match | yes | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000054 | 0.000039 | 1.3730x | 0.000e+0 | match | yes | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000042 | 0.000057 | 0.7272x | 1.830e-5 | match | yes | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000058 | 0.000048 | 1.1970x | 0.000e+0 | match | yes | yes | control |

## Gates

- Every timed sample starts from the same scene, seed, stress, and action setup.
- Baseline/candidate order alternates for every case and sample.
- Medians and median absolute deviations are retained in JSON.
- All authoritative state and render streams must remain finite.
- Node/body/instance counts and soft-system break counts must match.
- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.
- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.
- JavaScript controls retain their strict control thresholds.
- Each implementation must reproduce an identical result fingerprint across its samples.
