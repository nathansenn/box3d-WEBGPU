# WebPhysics v1.11 production-path 100-case benchmark

Generated: 2026-07-15T09:21:16.474Z

Baseline: **v1.10.0 exact source archive**; candidate: **working tree**.

Exactly **100** cases, **5** timed samples per variant/case, alternating execution order.

## Summary

- Accepted wins: **63**
- Borderline: **3**
- Rejected, no win: **14**
- Rejected, correctness: **0**
- Controls: **20**
- Changed-path geometric mean: **1.1383x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **10/10**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.1768x | 0 |
| rope-wasm | 25 | 1.3303x | 0 |
| fallback | 15 | 0.9314x | 0 |
| effects | 10 | 0.9425x | 0 |
| water-control | 10 | 1.1270x | 0 |
| js-control | 5 | 1.1111x | 0 |
| unchanged-control | 5 | 0.9651x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 1 | cloth-wasm | Tempest Standard — Baseline | 1.543019 | 1.455477 | 1.0601x | 2.313e-6 | match | yes | — | accepted |
| 2 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 1.841563 | 1.488937 | 1.2368x | 2.385e-7 | match | yes | — | accepted |
| 3 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.692639 | 1.451546 | 1.1661x | 1.243e-5 | match | yes | — | accepted |
| 4 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.766208 | 1.273093 | 1.3873x | 5.094e-5 | match | yes | — | accepted |
| 5 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 1.646738 | 1.413139 | 1.1653x | 7.082e-6 | match | yes | — | accepted |
| 6 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 1.821965 | 1.525646 | 1.1942x | 1.401e-6 | match | yes | — | accepted |
| 7 | cloth-wasm | Drape Over Collider — Baseline | 2.053181 | 1.693056 | 1.2127x | 8.082e-5 | match | yes | — | accepted |
| 8 | cloth-wasm | Grand Theater Curtain — Baseline | 1.788167 | 1.426130 | 1.2539x | 1.887e-7 | match | yes | — | accepted |
| 9 | cloth-wasm | Tensioned Membrane Drum — Baseline | 0.840123 | 0.752530 | 1.1164x | 7.374e-6 | match | yes | — | accepted |
| 10 | cloth-wasm | Tempest Standard — High Stress | 2.061414 | 1.826456 | 1.1286x | 1.790e-6 | match | yes | — | accepted |
| 11 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 1.708303 | 1.574667 | 1.0849x | 2.536e-7 | match | yes | — | accepted |
| 12 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.887852 | 1.490910 | 1.2662x | 1.497e-5 | match | yes | — | accepted |
| 13 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.546743 | 1.276910 | 1.2113x | 3.231e-5 | match | yes | — | accepted |
| 14 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.684600 | 1.385187 | 1.2162x | 7.301e-6 | match | yes | — | accepted |
| 15 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.680863 | 1.545153 | 1.0878x | 1.336e-6 | match | yes | — | accepted |
| 16 | cloth-wasm | Drape Over Collider — High Stress | 2.193965 | 1.689799 | 1.2984x | 2.285e-5 | match | yes | — | accepted |
| 17 | cloth-wasm | Grand Theater Curtain — High Stress | 1.636773 | 1.414968 | 1.1568x | 1.953e-7 | match | yes | — | accepted |
| 18 | cloth-wasm | Tensioned Membrane Drum — High Stress | 1.055905 | 0.778683 | 1.3560x | 7.422e-6 | match | yes | — | accepted |
| 19 | cloth-wasm | Tempest Standard — Precision | 1.586516 | 1.491803 | 1.0635x | 1.024e-6 | match | yes | — | accepted |
| 20 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 2.104396 | 1.902340 | 1.1062x | 1.825e-7 | match | yes | — | accepted |
| 21 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.785699 | 1.478454 | 1.2078x | 2.099e-5 | match | yes | — | accepted |
| 22 | cloth-wasm | Cargo Net Load Catch — Precision | 1.826637 | 1.290116 | 1.4159x | 3.525e-5 | match | yes | — | accepted |
| 23 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.598322 | 1.406694 | 1.1362x | 7.461e-6 | match | yes | — | accepted |
| 24 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.806940 | 1.548729 | 1.1667x | 7.510e-7 | match | yes | — | accepted |
| 25 | cloth-wasm | Drape Over Collider — Precision | 1.994933 | 1.670532 | 1.1942x | 9.557e-5 | match | yes | — | accepted |
| 26 | cloth-wasm | Grand Theater Curtain — Precision | 1.741486 | 1.406428 | 1.2382x | 2.077e-7 | match | yes | — | accepted |
| 27 | cloth-wasm | Tensioned Membrane Drum — Precision | 0.818988 | 0.824213 | 0.9937x | 7.350e-6 | match | yes | — | borderline |
| 28 | cloth-wasm | Tempest Standard — Impact Demo | 1.841458 | 1.625588 | 1.1328x | 1.062e-6 | match | yes | — | accepted |
| 29 | cloth-wasm | Royal Banner Wind Tunnel — Impact Demo | 1.850419 | 1.644109 | 1.1255x | 2.310e-7 | match | yes | — | accepted |
| 30 | cloth-wasm | Parachute Canopy Deployment — Impact Demo | 2.154646 | 2.064222 | 1.0438x | 1.595e-5 | match | yes | — | accepted |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.103276 | 0.061272 | 1.6855x | 1.712e-5 | match | yes | — | accepted |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.191806 | 0.126014 | 1.5221x | 1.037e-5 | match | yes | — | accepted |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.097290 | 0.068681 | 1.4166x | 2.790e-5 | match | yes | — | accepted |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.175514 | 0.139006 | 1.2626x | 1.055e-5 | match | yes | — | accepted |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.175095 | 0.130208 | 1.3447x | 2.481e-5 | match | yes | — | accepted |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.472647 | 0.351964 | 1.3429x | 6.843e-6 | match | yes | — | accepted |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.090494 | 0.072464 | 1.2488x | 4.066e-5 | match | yes | — | accepted |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.139500 | 0.104399 | 1.3362x | 3.914e-5 | match | yes | — | accepted |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.200893 | 0.140950 | 1.4253x | 3.495e-5 | match | yes | — | accepted |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.365905 | 0.340107 | 1.0759x | 3.004e-5 | match | yes | — | accepted |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.088480 | 0.073282 | 1.2074x | 1.712e-5 | match | yes | — | accepted |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.178040 | 0.134048 | 1.3282x | 1.037e-5 | match | yes | — | accepted |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.094238 | 0.072673 | 1.2967x | 2.790e-5 | match | yes | — | accepted |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.183954 | 0.130506 | 1.4095x | 1.055e-5 | match | yes | — | accepted |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.214008 | 0.137534 | 1.5560x | 2.481e-5 | match | yes | — | accepted |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.595742 | 0.436196 | 1.3658x | 5.975e-6 | match | yes | — | accepted |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.102448 | 0.080927 | 1.2659x | 4.066e-5 | match | yes | — | accepted |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.099524 | 0.069998 | 1.4218x | 3.914e-5 | match | yes | — | accepted |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.206530 | 0.156565 | 1.3191x | 3.495e-5 | match | yes | — | accepted |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.342917 | 0.370022 | 0.9267x | 3.004e-5 | match | yes | — | rejected-no-win |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.085254 | 0.074258 | 1.1481x | 1.712e-5 | match | yes | — | accepted |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.187042 | 0.136508 | 1.3702x | 1.037e-5 | match | yes | — | accepted |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.092661 | 0.073085 | 1.2678x | 2.790e-5 | match | yes | — | accepted |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.250371 | 0.179583 | 1.3942x | 1.055e-5 | match | yes | — | accepted |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.210881 | 0.135651 | 1.5546x | 2.481e-5 | match | yes | — | accepted |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 1.567743 | 0.922861 | 1.6988x | 0.000e+0 | match | yes | — | accepted |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.317813 | 0.331549 | 0.9586x | 0.000e+0 | match | yes | — | rejected-no-win |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.901305 | 0.775493 | 1.1622x | 0.000e+0 | match | yes | — | accepted |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.389257 | 0.685014 | 0.5682x | 0.000e+0 | match | yes | — | rejected-no-win |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.371625 | 0.189535 | 1.9607x | 0.000e+0 | match | yes | — | accepted |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.661694 | 1.073805 | 0.6162x | 0.000e+0 | match | yes | — | rejected-no-win |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.830903 | 0.529708 | 1.5686x | 0.000e+0 | match | yes | — | accepted |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.211743 | 0.285500 | 0.7417x | 0.000e+0 | match | yes | — | rejected-no-win |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.285340 | 0.459701 | 0.6207x | 0.000e+0 | match | yes | — | rejected-no-win |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.174625 | 0.540062 | 0.3233x | 0.000e+0 | match | yes | — | rejected-no-win |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.864937 | 0.785062 | 1.1017x | 0.000e+0 | match | yes | — | accepted |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.261167 | 0.468514 | 0.5574x | 0.000e+0 | match | yes | — | rejected-no-win |
| 68 | fallback | Bridge Load Test — Cinematic | 0.285472 | 0.201646 | 1.4157x | 0.000e+0 | match | yes | — | accepted |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.494931 | 0.438347 | 1.1291x | 0.000e+0 | match | yes | — | accepted |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.780653 | 0.675674 | 1.1554x | 0.000e+0 | match | yes | — | accepted |
| 71 | effects | Cinematic effects variant 1 | 0.033089 | 0.031083 | 1.0645x | 0.000e+0 | match | yes | — | accepted |
| 72 | effects | Cinematic effects variant 2 | 0.105044 | 0.106449 | 0.9868x | 0.000e+0 | match | yes | — | borderline |
| 73 | effects | Cinematic effects variant 3 | 0.113253 | 0.122746 | 0.9227x | 0.000e+0 | match | yes | — | rejected-no-win |
| 74 | effects | Cinematic effects variant 4 | 0.147056 | 0.155869 | 0.9435x | 0.000e+0 | match | yes | — | rejected-no-win |
| 75 | effects | Cinematic effects variant 5 | 0.057646 | 0.058468 | 0.9859x | 0.000e+0 | match | yes | — | borderline |
| 76 | effects | Cinematic effects variant 6 | 0.176499 | 0.091760 | 1.9235x | 0.000e+0 | match | yes | — | accepted |
| 77 | effects | Cinematic effects variant 7 | 0.079542 | 0.172628 | 0.4608x | 0.000e+0 | match | yes | — | rejected-no-win |
| 78 | effects | Cinematic effects variant 8 | 0.189094 | 0.210378 | 0.8988x | 0.000e+0 | match | yes | — | rejected-no-win |
| 79 | effects | Cinematic effects variant 9 | 0.100337 | 0.108800 | 0.9222x | 0.000e+0 | match | yes | — | rejected-no-win |
| 80 | effects | Cinematic effects variant 10 | 0.128647 | 0.153983 | 0.8355x | 0.000e+0 | match | yes | — | rejected-no-win |
| 81 | water-control | Interactive Ripple Basin — Cinematic | 0.047224 | 0.049494 | 0.9541x | 0.000e+0 | match | yes | — | control |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.045650 | 0.037740 | 1.2096x | 0.000e+0 | match | yes | — | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.066543 | 0.071090 | 0.9360x | 0.000e+0 | match | yes | — | control |
| 84 | water-control | Hydrodynamic Boat Wake — Cinematic | 0.125388 | 0.070099 | 1.7887x | 0.000e+0 | match | yes | — | control |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.041967 | 0.063458 | 0.6613x | 0.000e+0 | match | yes | — | control |
| 86 | water-control | Rain Impact Reservoir — Cinematic | 0.116904 | 0.096836 | 1.2072x | 0.000e+0 | match | yes | — | control |
| 87 | water-control | Dam-Breach Wave Front — Cinematic | 0.044589 | 0.048229 | 0.9245x | 0.000e+0 | match | yes | — | control |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.074447 | 0.066289 | 1.1231x | 0.000e+0 | match | yes | — | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.088165 | 0.077778 | 1.1336x | 0.000e+0 | match | yes | — | control |
| 90 | water-control | Leviathan Impact Pool — Cinematic | 0.089896 | 0.049388 | 1.8202x | 0.000e+0 | match | yes | — | control |
| 91 | js-control | Tempest Standard — Baseline | 1.884484 | 1.913058 | 0.9851x | 0.000e+0 | match | yes | — | control |
| 92 | js-control | Cargo Net Load Catch — Cinematic | 2.060248 | 1.925178 | 1.0702x | 0.000e+0 | match | yes | — | control |
| 93 | js-control | Sky Crane Cable Load — Baseline | 0.155382 | 0.103106 | 1.5070x | 0.000e+0 | match | yes | — | control |
| 94 | js-control | Rope Net Resonance — Cinematic | 0.569037 | 0.580782 | 0.9798x | 0.000e+0 | match | yes | — | control |
| 95 | js-control | Leviathan Impact Pool — Cinematic | 0.486919 | 0.447567 | 1.0879x | 0.000e+0 | match | yes | — | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000057 | 0.000063 | 0.9026x | 2.453e-7 | match | yes | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000072 | 0.000067 | 1.0746x | 4.501e-6 | match | yes | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000059 | 0.000065 | 0.9085x | 8.049e-6 | match | yes | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000061 | 0.000062 | 0.9933x | 1.830e-5 | match | yes | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000057 | 0.000059 | 0.9565x | 0.000e+0 | match | yes | yes | control |

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
