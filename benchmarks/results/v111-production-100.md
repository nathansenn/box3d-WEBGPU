# WebPhysics v1.11 production-path 100-case benchmark

Generated: 2026-07-15T10:43:07.080Z

Baseline: **v1.10.0 exact source archive**; candidate: **working tree**.

Exactly **100** cases, **8** timed samples per variant/case, with an equal number of both execution orders.

## Summary

- Accepted wins: **20**
- Borderline: **2**
- Rejected, no win: **4**
- Rejected, correctness: **0**
- Controls: **74**
- Changed-path geometric mean: **1.0673x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **10/10**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.0424x | 0 |
| rope-wasm | 25 | 1.0049x | 0 |
| fallback | 15 | 1.0309x | 0 |
| effects | 10 | 0.9869x | 0 |
| water-control | 10 | 0.9968x | 0 |
| js-control | 5 | 1.0353x | 0 |
| unchanged-control | 5 | 1.0136x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 1 | cloth-wasm | Tensioned Membrane Drum — Baseline | 0.824519 | 0.760856 | 1.0803x | 1.112e-5 | match | yes | — | accepted |
| 2 | cloth-wasm | Tensioned Membrane Drum — High Stress | 0.830318 | 0.761184 | 1.0991x | 1.107e-5 | match | yes | — | accepted |
| 3 | cloth-wasm | Tensioned Membrane Drum — Precision | 0.838359 | 0.757166 | 1.1029x | 1.107e-5 | match | yes | — | accepted |
| 4 | cloth-wasm | Tensioned Membrane Drum — Impact Demo | 0.856064 | 0.790821 | 1.0839x | 1.103e-5 | match | yes | — | accepted |
| 5 | cloth-wasm | Tensioned Membrane Drum — Cinematic | 0.952611 | 0.871661 | 1.0970x | 1.113e-5 | match | yes | — | accepted |
| 6 | cloth-wasm | Tempest Standard — Baseline | 1.573238 | 1.563826 | 1.0089x | 0.000e+0 | match | yes | — | control |
| 7 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 1.695540 | 1.690212 | 1.0034x | 0.000e+0 | match | yes | — | control |
| 8 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.637889 | 1.651234 | 0.9971x | 0.000e+0 | match | yes | — | control |
| 9 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.539125 | 1.338241 | 1.1496x | 0.000e+0 | match | yes | — | accepted |
| 10 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 1.850018 | 1.825411 | 1.0073x | 0.000e+0 | match | yes | — | control |
| 11 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 1.648475 | 1.634983 | 1.0067x | 0.000e+0 | match | yes | — | control |
| 12 | cloth-wasm | Drape Over Collider — Baseline | 2.060703 | 1.800772 | 1.1509x | 0.000e+0 | match | yes | — | accepted |
| 13 | cloth-wasm | Grand Theater Curtain — Baseline | 1.643589 | 1.636334 | 1.0041x | 0.000e+0 | match | yes | — | control |
| 14 | cloth-wasm | Tempest Standard — High Stress | 1.574195 | 1.579031 | 0.9953x | 0.000e+0 | match | yes | — | control |
| 15 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 1.721535 | 1.707101 | 1.0095x | 0.000e+0 | match | yes | — | control |
| 16 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.647673 | 1.645261 | 0.9996x | 0.000e+0 | match | yes | — | control |
| 17 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.534476 | 1.337412 | 1.1394x | 0.000e+0 | match | yes | — | accepted |
| 18 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.575738 | 1.625865 | 0.9699x | 0.000e+0 | match | yes | — | control |
| 19 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.629100 | 1.619729 | 1.0016x | 0.000e+0 | match | yes | — | control |
| 20 | cloth-wasm | Drape Over Collider — High Stress | 2.225151 | 2.003813 | 1.1283x | 0.000e+0 | match | yes | — | accepted |
| 21 | cloth-wasm | Grand Theater Curtain — High Stress | 1.625631 | 1.615909 | 1.0058x | 0.000e+0 | match | yes | — | control |
| 22 | cloth-wasm | Tempest Standard — Precision | 1.562815 | 1.563215 | 1.0005x | 0.000e+0 | match | yes | — | control |
| 23 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 1.705905 | 1.689975 | 1.0126x | 0.000e+0 | match | yes | — | control |
| 24 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.643962 | 1.634294 | 1.0033x | 0.000e+0 | match | yes | — | control |
| 25 | cloth-wasm | Cargo Net Load Catch — Precision | 1.539842 | 1.337193 | 1.1432x | 0.000e+0 | match | yes | — | accepted |
| 26 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.583187 | 1.615385 | 0.9844x | 0.000e+0 | match | yes | — | control |
| 27 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.627760 | 1.627589 | 1.0023x | 0.000e+0 | match | yes | — | control |
| 28 | cloth-wasm | Drape Over Collider — Precision | 2.023709 | 1.772009 | 1.1388x | 0.000e+0 | match | yes | — | accepted |
| 29 | cloth-wasm | Grand Theater Curtain — Precision | 1.624238 | 1.611532 | 1.0028x | 0.000e+0 | match | yes | — | control |
| 30 | cloth-wasm | Tempest Standard — Impact Demo | 1.980465 | 2.013818 | 0.9951x | 0.000e+0 | match | yes | — | control |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.072984 | 0.067661 | 1.0198x | 0.000e+0 | match | yes | — | control |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.126593 | 0.146506 | 1.0084x | 0.000e+0 | match | yes | — | control |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.073838 | 0.065471 | 1.0122x | 0.000e+0 | match | yes | — | control |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.121936 | 0.133780 | 1.0159x | 0.000e+0 | match | yes | — | control |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.167610 | 0.148333 | 1.0075x | 0.000e+0 | match | yes | — | control |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.320997 | 0.322107 | 1.0122x | 0.000e+0 | match | yes | — | control |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.070742 | 0.065376 | 1.0160x | 0.000e+0 | match | yes | — | control |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.083254 | 0.099294 | 0.9777x | 0.000e+0 | match | yes | — | control |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.159673 | 0.147340 | 0.9875x | 0.000e+0 | match | yes | — | control |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.301131 | 0.319526 | 0.9788x | 0.000e+0 | match | yes | — | control |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.069015 | 0.065300 | 1.0248x | 0.000e+0 | match | yes | — | control |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.123418 | 0.140628 | 1.0192x | 0.000e+0 | match | yes | — | control |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.071872 | 0.066799 | 1.0038x | 0.000e+0 | match | yes | — | control |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.121054 | 0.142397 | 0.9910x | 0.000e+0 | match | yes | — | control |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.168300 | 0.150601 | 0.9835x | 0.000e+0 | match | yes | — | control |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.351427 | 0.365245 | 0.9925x | 0.000e+0 | match | yes | — | control |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.071804 | 0.065783 | 1.0311x | 0.000e+0 | match | yes | — | control |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.064989 | 0.071707 | 0.9843x | 0.000e+0 | match | yes | — | control |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.168930 | 0.149842 | 0.9948x | 0.000e+0 | match | yes | — | control |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.299780 | 0.301802 | 0.9948x | 0.000e+0 | match | yes | — | control |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.071039 | 0.064742 | 1.0224x | 0.000e+0 | match | yes | — | control |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.124567 | 0.139204 | 1.0236x | 0.000e+0 | match | yes | — | control |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.072571 | 0.064766 | 1.0186x | 0.000e+0 | match | yes | — | control |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.145944 | 0.167014 | 1.0175x | 0.000e+0 | match | yes | — | control |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.167114 | 0.141885 | 0.9887x | 0.000e+0 | match | yes | — | control |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.495191 | 0.430408 | 1.0665x | 0.000e+0 | match | yes | — | accepted |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.097134 | 0.074355 | 1.0855x | 0.000e+0 | match | yes | — | accepted |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.552641 | 0.465276 | 1.1948x | 0.000e+0 | match | yes | — | accepted |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.129249 | 0.100430 | 1.0915x | 0.000e+0 | match | yes | — | accepted |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.074102 | 0.095947 | 1.0375x | 0.000e+0 | match | yes | — | accepted |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.456218 | 0.411953 | 1.0892x | 0.000e+0 | match | yes | — | accepted |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.347979 | 0.290891 | 1.1964x | 0.000e+0 | match | yes | — | accepted |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.056045 | 0.062581 | 0.8557x | 0.000e+0 | match | yes | — | rejected-no-win |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.084178 | 0.104554 | 1.0464x | 0.000e+0 | match | yes | — | accepted |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.084561 | 0.081522 | 0.9042x | 0.000e+0 | match | yes | — | rejected-no-win |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.457154 | 0.508395 | 0.9859x | 0.000e+0 | match | yes | — | borderline |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.153082 | 0.152498 | 0.9853x | 0.000e+0 | match | yes | — | borderline |
| 68 | fallback | Bridge Load Test — Cinematic | 0.069290 | 0.090053 | 0.9043x | 0.000e+0 | match | yes | — | rejected-no-win |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.098680 | 0.092746 | 0.9592x | 0.000e+0 | match | yes | — | rejected-no-win |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.347493 | 0.307133 | 1.1335x | 0.000e+0 | match | yes | — | accepted |
| 71 | effects | Cinematic effects variant 1 | 0.015207 | 0.015195 | 0.9912x | 0.000e+0 | match | yes | — | control |
| 72 | effects | Cinematic effects variant 2 | 0.039765 | 0.035303 | 1.2521x | 0.000e+0 | match | yes | — | control |
| 73 | effects | Cinematic effects variant 3 | 0.041768 | 0.032254 | 1.1156x | 0.000e+0 | match | yes | — | control |
| 74 | effects | Cinematic effects variant 4 | 0.035867 | 0.040816 | 1.1123x | 0.000e+0 | match | yes | — | control |
| 75 | effects | Cinematic effects variant 5 | 0.025846 | 0.027487 | 1.0070x | 0.000e+0 | match | yes | — | control |
| 76 | effects | Cinematic effects variant 6 | 0.025714 | 0.029536 | 0.8308x | 0.000e+0 | match | yes | — | control |
| 77 | effects | Cinematic effects variant 7 | 0.034974 | 0.028281 | 1.0830x | 0.000e+0 | match | yes | — | control |
| 78 | effects | Cinematic effects variant 8 | 0.034542 | 0.044838 | 0.7075x | 0.000e+0 | match | yes | — | control |
| 79 | effects | Cinematic effects variant 9 | 0.038000 | 0.017215 | 0.9601x | 0.000e+0 | match | yes | — | control |
| 80 | effects | Cinematic effects variant 10 | 0.026168 | 0.028929 | 0.9248x | 0.000e+0 | match | yes | — | control |
| 81 | water-control | Interactive Ripple Basin — Cinematic | 0.025809 | 0.024326 | 0.9978x | 0.000e+0 | match | yes | — | control |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.023274 | 0.025037 | 1.0010x | 0.000e+0 | match | yes | — | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.034394 | 0.030767 | 1.0112x | 0.000e+0 | match | yes | — | control |
| 84 | water-control | Hydrodynamic Boat Wake — Cinematic | 0.046692 | 0.047834 | 0.9950x | 0.000e+0 | match | yes | — | control |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.041825 | 0.034360 | 0.9794x | 0.000e+0 | match | yes | — | control |
| 86 | water-control | Rain Impact Reservoir — Cinematic | 0.057984 | 0.066161 | 0.9647x | 0.000e+0 | match | yes | — | control |
| 87 | water-control | Dam-Breach Wave Front — Cinematic | 0.030122 | 0.024741 | 0.9974x | 0.000e+0 | match | yes | — | control |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.032820 | 0.039690 | 0.9951x | 0.000e+0 | match | yes | — | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.062081 | 0.050782 | 1.0151x | 0.000e+0 | match | yes | — | control |
| 90 | water-control | Leviathan Impact Pool — Cinematic | 0.041673 | 0.051530 | 1.0125x | 0.000e+0 | match | yes | — | control |
| 91 | js-control | Tempest Standard — Baseline | 1.789805 | 1.777728 | 1.0058x | 0.000e+0 | match | yes | — | control |
| 92 | js-control | Cargo Net Load Catch — Cinematic | 1.932515 | 1.701462 | 1.1362x | 0.000e+0 | match | yes | — | control |
| 93 | js-control | Sky Crane Cable Load — Baseline | 0.082015 | 0.079742 | 1.0513x | 0.000e+0 | match | yes | — | control |
| 94 | js-control | Rope Net Resonance — Cinematic | 0.505920 | 0.527248 | 0.9965x | 0.000e+0 | match | yes | — | control |
| 95 | js-control | Leviathan Impact Pool — Cinematic | 0.220669 | 0.170291 | 0.9937x | 0.000e+0 | match | yes | — | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000046 | 0.000056 | 0.9216x | 0.000e+0 | match | yes | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000055 | 0.000047 | 1.0422x | 4.501e-6 | match | yes | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000047 | 0.000054 | 1.0363x | 0.000e+0 | match | yes | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000055 | 0.000046 | 1.0222x | 0.000e+0 | match | yes | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000049 | 0.000053 | 1.0513x | 0.000e+0 | match | yes | yes | control |

## Gates

- Every timed sample starts from the same scene, seed, stress, and action setup.
- Every case has an equal number of baseline-first and candidate-first samples.
- Reported speedup is the geometric mean of the two order-stratified median ratios.
- Medians and median absolute deviations are retained in JSON.
- All authoritative state and render streams must remain finite.
- Node/body/instance counts and soft-system break counts must match.
- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.
- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.
- JavaScript controls retain their strict control thresholds.
- Each implementation must reproduce an identical result fingerprint across its samples.
