# WebPhysics v1.11 production-path 100-case benchmark

Generated: 2026-07-15T09:23:33.723Z

Baseline: **v1.10.0 exact source archive**; candidate: **working tree**.

Exactly **100** cases, **7** timed samples per variant/case, alternating execution order.

## Summary

- Accepted wins: **34**
- Borderline: **9**
- Rejected, no win: **8**
- Rejected, correctness: **19**
- Controls: **30**
- Changed-path geometric mean: **1.0754x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **10/10**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.1170x | 14 |
| rope-wasm | 25 | 1.0751x | 5 |
| fallback | 15 | 0.9971x | 0 |
| effects | 10 | 0.9914x | 0 |
| water-control | 10 | 0.9377x | 0 |
| js-control | 5 | 0.9953x | 0 |
| unchanged-control | 5 | 0.9973x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 1 | cloth-wasm | Tempest Standard — Baseline | 1.562583 | 1.455666 | 1.0734x | 6.746e-3 | match | yes | — | rejected-correctness |
| 2 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 1.701713 | 1.485206 | 1.1458x | 2.499e-3 | match | yes | — | rejected-correctness |
| 3 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.626709 | 1.450628 | 1.1214x | 1.325e-3 | match | yes | — | accepted |
| 4 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.535532 | 1.259696 | 1.2190x | 1.104e-5 | match | yes | — | accepted |
| 5 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 1.568178 | 1.383194 | 1.1337x | 7.996e-4 | match | yes | — | accepted |
| 6 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 1.603850 | 1.521890 | 1.0539x | 7.250e-3 | match | yes | — | rejected-correctness |
| 7 | cloth-wasm | Drape Over Collider — Baseline | 2.016135 | 1.664157 | 1.2115x | 2.137e-4 | match | yes | — | accepted |
| 8 | cloth-wasm | Grand Theater Curtain — Baseline | 1.600850 | 1.407901 | 1.1370x | 1.088e-3 | match | yes | — | accepted |
| 9 | cloth-wasm | Tensioned Membrane Drum — Baseline | 0.770369 | 0.753853 | 1.0219x | 1.112e-5 | match | yes | — | borderline |
| 10 | cloth-wasm | Tempest Standard — High Stress | 1.870354 | 1.789767 | 1.0450x | 2.970e-3 | match | yes | — | rejected-correctness |
| 11 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 1.683407 | 1.471922 | 1.1437x | 2.147e-3 | match | yes | — | rejected-correctness |
| 12 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.644200 | 1.433292 | 1.1471x | 9.260e-4 | match | yes | — | accepted |
| 13 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.537851 | 1.252144 | 1.2282x | 9.201e-6 | match | yes | — | accepted |
| 14 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.541709 | 1.362476 | 1.1315x | 2.157e-4 | match | yes | — | accepted |
| 15 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.598358 | 1.475994 | 1.0829x | 7.181e-3 | match | yes | — | rejected-correctness |
| 16 | cloth-wasm | Drape Over Collider — High Stress | 2.034008 | 1.640059 | 1.2402x | 1.972e-4 | match | yes | — | accepted |
| 17 | cloth-wasm | Grand Theater Curtain — High Stress | 1.564021 | 1.406528 | 1.1120x | 2.371e-3 | match | yes | — | rejected-correctness |
| 18 | cloth-wasm | Tensioned Membrane Drum — High Stress | 0.777943 | 0.737524 | 1.0548x | 1.107e-5 | match | yes | — | accepted |
| 19 | cloth-wasm | Tempest Standard — Precision | 1.523210 | 1.421877 | 1.0713x | 8.929e-3 | match | yes | — | rejected-correctness |
| 20 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 1.990678 | 1.879067 | 1.0594x | 4.434e-3 | match | yes | — | rejected-correctness |
| 21 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.638980 | 1.437639 | 1.1400x | 8.102e-4 | match | yes | — | accepted |
| 22 | cloth-wasm | Cargo Net Load Catch — Precision | 1.538043 | 1.273421 | 1.2078x | 9.078e-6 | match | yes | — | accepted |
| 23 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.574481 | 1.395646 | 1.1281x | 2.395e-4 | match | yes | — | accepted |
| 24 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.637742 | 1.540083 | 1.0634x | 3.179e-3 | match | yes | — | rejected-correctness |
| 25 | cloth-wasm | Drape Over Collider — Precision | 2.008838 | 1.674917 | 1.1994x | 3.543e-4 | match | yes | — | accepted |
| 26 | cloth-wasm | Grand Theater Curtain — Precision | 1.615259 | 1.415812 | 1.1409x | 2.746e-3 | match | yes | — | rejected-correctness |
| 27 | cloth-wasm | Tensioned Membrane Drum — Precision | 0.795103 | 0.759131 | 1.0474x | 1.107e-5 | match | yes | — | accepted |
| 28 | cloth-wasm | Tempest Standard — Impact Demo | 1.682481 | 1.571054 | 1.0709x | 9.107e-3 | match | yes | — | rejected-correctness |
| 29 | cloth-wasm | Royal Banner Wind Tunnel — Impact Demo | 1.800636 | 1.590002 | 1.1325x | 4.021e-3 | match | yes | — | rejected-correctness |
| 30 | cloth-wasm | Parachute Canopy Deployment — Impact Demo | 1.972564 | 1.970848 | 1.0009x | 6.565e-3 | match | yes | — | rejected-correctness |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.069782 | 0.059854 | 1.1659x | 1.299e-5 | match | yes | — | accepted |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.152360 | 0.119321 | 1.2769x | 1.027e-5 | match | yes | — | accepted |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.057356 | 0.059929 | 0.9571x | 1.001e-4 | match | yes | — | rejected-no-win |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.118293 | 0.111621 | 1.0598x | 1.199e-5 | match | yes | — | accepted |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.134572 | 0.126326 | 1.0653x | 7.992e-3 | match | yes | — | rejected-correctness |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.317844 | 0.310537 | 1.0235x | 1.245e-5 | match | yes | — | borderline |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.057339 | 0.056916 | 1.0074x | 2.143e-5 | match | yes | — | borderline |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.097546 | 0.084181 | 1.1588x | 1.719e-5 | match | yes | — | accepted |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.142664 | 0.132450 | 1.0771x | 1.384e-4 | match | yes | — | rejected-correctness |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.310582 | 0.290758 | 1.0682x | 2.794e-5 | match | yes | — | accepted |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.059171 | 0.059906 | 0.9877x | 1.299e-5 | match | yes | — | borderline |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.129617 | 0.113741 | 1.1396x | 1.027e-5 | match | yes | — | accepted |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.061166 | 0.059852 | 1.0220x | 1.001e-4 | match | yes | — | borderline |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.123870 | 0.111841 | 1.1076x | 1.199e-5 | match | yes | — | accepted |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.152813 | 0.132455 | 1.1537x | 7.992e-3 | match | yes | — | rejected-correctness |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.380843 | 0.365463 | 1.0421x | 1.981e-5 | match | yes | — | accepted |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.059571 | 0.059618 | 0.9992x | 2.143e-5 | match | yes | — | borderline |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.069706 | 0.059991 | 1.1620x | 2.105e-5 | match | yes | — | accepted |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.141168 | 0.136048 | 1.0376x | 1.384e-4 | match | yes | — | rejected-correctness |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.303980 | 0.292393 | 1.0396x | 2.794e-5 | match | yes | — | accepted |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.060606 | 0.059478 | 1.0190x | 1.299e-5 | match | yes | — | borderline |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.131649 | 0.113990 | 1.1549x | 1.027e-5 | match | yes | — | accepted |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.061435 | 0.060185 | 1.0208x | 1.001e-4 | match | yes | — | borderline |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.156360 | 0.141493 | 1.1051x | 9.317e-5 | match | yes | — | accepted |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.138860 | 0.128030 | 1.0846x | 7.992e-3 | match | yes | — | rejected-correctness |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.535052 | 0.575972 | 0.9290x | 0.000e+0 | match | yes | — | rejected-no-win |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.124102 | 0.305995 | 0.4056x | 0.000e+0 | match | yes | — | rejected-no-win |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.700733 | 0.455868 | 1.5371x | 0.000e+0 | match | yes | — | accepted |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.143819 | 0.182901 | 0.7863x | 0.000e+0 | match | yes | — | rejected-no-win |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.210601 | 0.165530 | 1.2723x | 0.000e+0 | match | yes | — | accepted |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.480104 | 0.478439 | 1.0035x | 0.000e+0 | match | yes | — | borderline |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.685422 | 0.522016 | 1.3130x | 0.000e+0 | match | yes | — | accepted |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.092340 | 0.111710 | 0.8266x | 0.000e+0 | match | yes | — | rejected-no-win |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.246448 | 0.144505 | 1.7055x | 0.000e+0 | match | yes | — | accepted |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.140172 | 0.274177 | 0.5112x | 0.000e+0 | match | yes | — | rejected-no-win |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.448528 | 0.326931 | 1.3719x | 0.000e+0 | match | yes | — | accepted |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.190168 | 0.297276 | 0.6397x | 0.000e+0 | match | yes | — | rejected-no-win |
| 68 | fallback | Bridge Load Test — Cinematic | 0.241618 | 0.121168 | 1.9941x | 0.000e+0 | match | yes | — | accepted |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.116113 | 0.130931 | 0.8868x | 0.000e+0 | match | yes | — | rejected-no-win |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.423372 | 0.377359 | 1.1219x | 0.000e+0 | match | yes | — | accepted |
| 71 | effects | Cinematic effects variant 1 | 0.015131 | 0.015301 | 0.9889x | 0.000e+0 | match | yes | — | control |
| 72 | effects | Cinematic effects variant 2 | 0.026692 | 0.032085 | 0.8319x | 0.000e+0 | match | yes | — | control |
| 73 | effects | Cinematic effects variant 3 | 0.039624 | 0.052668 | 0.7523x | 0.000e+0 | match | yes | — | control |
| 74 | effects | Cinematic effects variant 4 | 0.035366 | 0.028205 | 1.2539x | 0.000e+0 | match | yes | — | control |
| 75 | effects | Cinematic effects variant 5 | 0.025853 | 0.029151 | 0.8869x | 0.000e+0 | match | yes | — | control |
| 76 | effects | Cinematic effects variant 6 | 0.030983 | 0.022507 | 1.3766x | 0.000e+0 | match | yes | — | control |
| 77 | effects | Cinematic effects variant 7 | 0.027922 | 0.037385 | 0.7469x | 0.000e+0 | match | yes | — | control |
| 78 | effects | Cinematic effects variant 8 | 0.033866 | 0.027680 | 1.2235x | 0.000e+0 | match | yes | — | control |
| 79 | effects | Cinematic effects variant 9 | 0.013400 | 0.020144 | 0.6652x | 0.000e+0 | match | yes | — | control |
| 80 | effects | Cinematic effects variant 10 | 0.030995 | 0.019464 | 1.5924x | 0.000e+0 | match | yes | — | control |
| 81 | water-control | Interactive Ripple Basin — Cinematic | 0.024498 | 0.025230 | 0.9710x | 0.000e+0 | match | yes | — | control |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.024324 | 0.022264 | 1.0925x | 0.000e+0 | match | yes | — | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.031064 | 0.036177 | 0.8587x | 0.000e+0 | match | yes | — | control |
| 84 | water-control | Hydrodynamic Boat Wake — Cinematic | 0.048599 | 0.051988 | 0.9348x | 0.000e+0 | match | yes | — | control |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.024610 | 0.045561 | 0.5402x | 0.000e+0 | match | yes | — | control |
| 86 | water-control | Rain Impact Reservoir — Cinematic | 0.066691 | 0.051617 | 1.2920x | 0.000e+0 | match | yes | — | control |
| 87 | water-control | Dam-Breach Wave Front — Cinematic | 0.024122 | 0.029028 | 0.8310x | 0.000e+0 | match | yes | — | control |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.036314 | 0.031191 | 1.1643x | 0.000e+0 | match | yes | — | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.041837 | 0.059740 | 0.7003x | 0.000e+0 | match | yes | — | control |
| 90 | water-control | Leviathan Impact Pool — Cinematic | 0.047881 | 0.036673 | 1.3056x | 0.000e+0 | match | yes | — | control |
| 91 | js-control | Tempest Standard — Baseline | 1.789658 | 1.787926 | 1.0010x | 0.000e+0 | match | yes | — | control |
| 92 | js-control | Cargo Net Load Catch — Cinematic | 1.934855 | 1.938355 | 0.9982x | 0.000e+0 | match | yes | — | control |
| 93 | js-control | Sky Crane Cable Load — Baseline | 0.083428 | 0.088319 | 0.9446x | 0.000e+0 | match | yes | — | control |
| 94 | js-control | Rope Net Resonance — Cinematic | 0.516755 | 0.481740 | 1.0727x | 0.000e+0 | match | yes | — | control |
| 95 | js-control | Leviathan Impact Pool — Cinematic | 0.216457 | 0.224413 | 0.9645x | 0.000e+0 | match | yes | — | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000053 | 0.000056 | 0.9514x | 2.453e-7 | match | yes | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000044 | 0.000057 | 0.7593x | 4.501e-6 | match | yes | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000053 | 0.000038 | 1.3993x | 8.049e-6 | match | yes | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000040 | 0.000057 | 0.6914x | 1.830e-5 | match | yes | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000053 | 0.000038 | 1.4113x | 0.000e+0 | match | yes | yes | control |

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
