# WebPhysics v1.12 production-path 100-case benchmark

Generated: 2026-07-16T13:52:01.155Z

Baseline: **v1.11.0 exact source archive**; candidate: **v1.12 working tree**.

Exactly **100** cases, **8** timed samples per variant/case, with an equal number of both execution orders.

## Summary

- Accepted wins: **7**
- Borderline: **3**
- Rejected, no win: **8**
- Rejected, correctness: **0**
- Controls: **82**
- Changed-path geometric mean: **0.9713x**
- Deterministic baseline/candidate groups: **200/200**
- Exact unchanged before/after groups: **10/10**

## Category counts

| Category | Cases | Geometric mean | Correctness failures |
|---|---:|---:|---:|
| cloth-wasm | 30 | 1.0062x | 0 |
| rope-wasm | 25 | 1.0223x | 0 |
| fallback | 15 | 0.9572x | 0 |
| effects | 10 | 1.0107x | 0 |
| water-control | 10 | 1.0045x | 0 |
| js-control | 5 | 0.9916x | 0 |
| unchanged-control | 5 | 1.0090x | 0 |

## All cases

| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|
| 1 | cloth-wasm | Tensioned Membrane Drum — Baseline | 0.795905 | 0.785932 | 1.0157x | 0.000e+0 | match | yes | — | control |
| 2 | cloth-wasm | Tensioned Membrane Drum — High Stress | 0.802447 | 0.794115 | 1.0119x | 0.000e+0 | match | yes | — | control |
| 3 | cloth-wasm | Tensioned Membrane Drum — Precision | 0.796826 | 0.788890 | 1.0034x | 0.000e+0 | match | yes | — | control |
| 4 | cloth-wasm | Tensioned Membrane Drum — Impact Demo | 0.801496 | 0.829258 | 0.9758x | 0.000e+0 | match | yes | — | control |
| 5 | cloth-wasm | Tensioned Membrane Drum — Cinematic | 0.876438 | 0.910290 | 0.9901x | 0.000e+0 | match | yes | — | control |
| 6 | cloth-wasm | Tempest Standard — Baseline | 1.566922 | 1.665502 | 1.0102x | 0.000e+0 | match | yes | — | control |
| 7 | cloth-wasm | Royal Banner Wind Tunnel — Baseline | 2.184701 | 1.906638 | 1.0450x | 0.000e+0 | match | yes | — | control |
| 8 | cloth-wasm | Parachute Canopy Deployment — Baseline | 1.887205 | 2.030371 | 1.0022x | 0.000e+0 | match | yes | — | control |
| 9 | cloth-wasm | Cargo Net Load Catch — Baseline | 1.717958 | 1.513498 | 1.0000x | 0.000e+0 | match | yes | — | control |
| 10 | cloth-wasm | Suspended Hammock Dynamics — Baseline | 2.097547 | 2.265932 | 0.9962x | 0.000e+0 | match | yes | — | control |
| 11 | cloth-wasm | Racing Sail Aerodynamics — Baseline | 2.003638 | 1.731246 | 1.0515x | 0.000e+0 | match | yes | — | accepted |
| 12 | cloth-wasm | Drape Over Collider — Baseline | 1.970076 | 2.167570 | 0.9906x | 0.000e+0 | match | yes | — | control |
| 13 | cloth-wasm | Grand Theater Curtain — Baseline | 2.000439 | 1.807464 | 0.9936x | 0.000e+0 | match | yes | — | control |
| 14 | cloth-wasm | Tempest Standard — High Stress | 1.755271 | 1.945574 | 0.9862x | 0.000e+0 | match | yes | — | control |
| 15 | cloth-wasm | Royal Banner Wind Tunnel — High Stress | 2.157170 | 1.905938 | 0.9988x | 0.000e+0 | match | yes | — | control |
| 16 | cloth-wasm | Parachute Canopy Deployment — High Stress | 1.898670 | 2.050871 | 1.0154x | 0.000e+0 | match | yes | — | control |
| 17 | cloth-wasm | Cargo Net Load Catch — High Stress | 1.822045 | 1.520951 | 1.0006x | 0.000e+0 | match | yes | — | control |
| 18 | cloth-wasm | Suspended Hammock Dynamics — High Stress | 1.717733 | 1.894339 | 1.0074x | 0.000e+0 | match | yes | — | control |
| 19 | cloth-wasm | Racing Sail Aerodynamics — High Stress | 1.983597 | 1.728492 | 1.0444x | 0.000e+0 | match | yes | — | accepted |
| 20 | cloth-wasm | Drape Over Collider — High Stress | 2.195926 | 2.368170 | 0.9902x | 0.000e+0 | match | yes | — | control |
| 21 | cloth-wasm | Grand Theater Curtain — High Stress | 1.976614 | 1.815396 | 0.9972x | 0.000e+0 | match | yes | — | control |
| 22 | cloth-wasm | Tempest Standard — Precision | 1.763509 | 1.941693 | 0.9911x | 0.000e+0 | match | yes | — | control |
| 23 | cloth-wasm | Royal Banner Wind Tunnel — Precision | 2.165631 | 1.919703 | 1.0106x | 0.000e+0 | match | yes | — | control |
| 24 | cloth-wasm | Parachute Canopy Deployment — Precision | 1.880106 | 2.046148 | 1.0063x | 0.000e+0 | match | yes | — | control |
| 25 | cloth-wasm | Cargo Net Load Catch — Precision | 1.842388 | 1.520212 | 1.0145x | 0.000e+0 | match | yes | — | control |
| 26 | cloth-wasm | Suspended Hammock Dynamics — Precision | 1.688477 | 1.851229 | 1.0089x | 0.000e+0 | match | yes | — | control |
| 27 | cloth-wasm | Racing Sail Aerodynamics — Precision | 1.982506 | 1.693710 | 1.0395x | 0.000e+0 | match | yes | — | accepted |
| 28 | cloth-wasm | Drape Over Collider — Precision | 1.960080 | 2.140093 | 0.9925x | 0.000e+0 | match | yes | — | control |
| 29 | cloth-wasm | Grand Theater Curtain — Precision | 1.995138 | 1.790330 | 1.0055x | 0.000e+0 | match | yes | — | control |
| 30 | cloth-wasm | Tempest Standard — Impact Demo | 2.151157 | 2.322184 | 0.9943x | 0.000e+0 | match | yes | — | control |
| 31 | rope-wasm | Sky Crane Cable Load — Baseline | 0.137572 | 0.102075 | 1.1324x | 0.000e+0 | match | yes | — | control |
| 32 | rope-wasm | Suspension Cable Bridge — Baseline | 0.192462 | 0.194931 | 0.9867x | 0.000e+0 | match | yes | — | control |
| 33 | rope-wasm | Heavy Pendulum Strike — Baseline | 0.107050 | 0.104125 | 1.0512x | 0.000e+0 | match | yes | — | control |
| 34 | rope-wasm | Industrial Rope Ladder — Baseline | 0.194090 | 0.184580 | 1.0083x | 0.000e+0 | match | yes | — | control |
| 35 | rope-wasm | Four-Point Mooring Array — Baseline | 0.262582 | 0.242292 | 1.0475x | 0.000e+0 | match | yes | — | control |
| 36 | rope-wasm | Cable Curtain Failure — Baseline | 0.403729 | 0.403263 | 1.0441x | 0.000e+0 | match | yes | — | control |
| 37 | rope-wasm | High-Speed Zipline — Baseline | 0.104261 | 0.104652 | 0.9929x | 0.000e+0 | match | yes | — | control |
| 38 | rope-wasm | Grappling Line Tension — Baseline | 0.159197 | 0.164696 | 0.9727x | 0.000e+0 | match | yes | — | control |
| 39 | rope-wasm | Multi-Sling Rigging Test — Baseline | 0.221058 | 0.222119 | 1.0522x | 0.000e+0 | match | yes | — | control |
| 40 | rope-wasm | Rope Net Resonance — Baseline | 0.367349 | 0.330764 | 1.1299x | 0.000e+0 | match | yes | — | control |
| 41 | rope-wasm | Sky Crane Cable Load — High Stress | 0.104380 | 0.100470 | 1.0319x | 0.000e+0 | match | yes | — | control |
| 42 | rope-wasm | Suspension Cable Bridge — High Stress | 0.179585 | 0.185138 | 0.9416x | 0.000e+0 | match | yes | — | control |
| 43 | rope-wasm | Heavy Pendulum Strike — High Stress | 0.105112 | 0.105492 | 0.9712x | 0.000e+0 | match | yes | — | control |
| 44 | rope-wasm | Industrial Rope Ladder — High Stress | 0.194407 | 0.184441 | 0.9860x | 0.000e+0 | match | yes | — | control |
| 45 | rope-wasm | Four-Point Mooring Array — High Stress | 0.254284 | 0.239713 | 1.0971x | 0.000e+0 | match | yes | — | control |
| 46 | rope-wasm | Cable Curtain Failure — High Stress | 0.455247 | 0.470455 | 1.0608x | 0.000e+0 | match | yes | — | control |
| 47 | rope-wasm | High-Speed Zipline — High Stress | 0.106811 | 0.105285 | 1.0064x | 0.000e+0 | match | yes | — | control |
| 48 | rope-wasm | Grappling Line Tension — High Stress | 0.104615 | 0.103386 | 1.0158x | 0.000e+0 | match | yes | — | control |
| 49 | rope-wasm | Multi-Sling Rigging Test — High Stress | 0.229840 | 0.217444 | 1.1438x | 0.000e+0 | match | yes | — | control |
| 50 | rope-wasm | Rope Net Resonance — High Stress | 0.369673 | 0.417131 | 1.0028x | 0.000e+0 | match | yes | — | control |
| 51 | rope-wasm | Sky Crane Cable Load — Precision | 0.106585 | 0.103412 | 1.0362x | 0.000e+0 | match | yes | — | control |
| 52 | rope-wasm | Suspension Cable Bridge — Precision | 0.195774 | 0.193394 | 0.9324x | 0.000e+0 | match | yes | — | control |
| 53 | rope-wasm | Heavy Pendulum Strike — Precision | 0.106430 | 0.105072 | 1.0045x | 0.000e+0 | match | yes | — | control |
| 54 | rope-wasm | Industrial Rope Ladder — Precision | 0.236612 | 0.237189 | 0.9313x | 0.000e+0 | match | yes | — | control |
| 55 | rope-wasm | Four-Point Mooring Array — Precision | 0.261976 | 0.230729 | 1.0178x | 0.000e+0 | match | yes | — | control |
| 56 | fallback | Cross-Laminated Block Grid — Cinematic | 0.552631 | 0.659046 | 0.8813x | 0.000e+0 | match | yes | — | rejected-no-win |
| 57 | fallback | Thin-Body Stability Trial — Cinematic | 0.194830 | 0.195077 | 0.8790x | 0.000e+0 | match | yes | — | rejected-no-win |
| 58 | fallback | Needle Spire Shake Test — Cinematic | 0.363557 | 0.463013 | 1.0355x | 0.000e+0 | match | yes | — | accepted |
| 59 | fallback | Multi-Pier Viaduct — Cinematic | 0.361509 | 0.289293 | 1.1300x | 0.000e+0 | match | yes | — | accepted |
| 60 | fallback | Energy Loss Arena — Cinematic | 0.267644 | 0.277560 | 1.0582x | 0.000e+0 | match | yes | — | accepted |
| 61 | fallback | Dense Core Rain Column — Cinematic | 0.526595 | 0.454470 | 1.0137x | 0.000e+0 | match | yes | — | borderline |
| 62 | fallback | Progressive Collapse Theater — Cinematic | 0.513126 | 0.465103 | 1.0030x | 0.000e+0 | match | yes | — | borderline |
| 63 | fallback | Heavy Hauler Load Shift — Cinematic | 0.118257 | 0.136326 | 0.7534x | 0.000e+0 | match | yes | — | rejected-no-win |
| 64 | fallback | Physics Toy Museum — Cinematic | 0.206903 | 0.169786 | 0.9675x | 0.000e+0 | match | yes | — | rejected-no-win |
| 65 | fallback | Foundation Block Layout — Cinematic | 0.246088 | 0.245146 | 0.7921x | 0.000e+0 | match | yes | — | rejected-no-win |
| 66 | fallback | Inventory Earthquake Proxy — Cinematic | 0.345353 | 0.375832 | 0.9744x | 0.000e+0 | match | yes | — | rejected-no-win |
| 67 | fallback | Mega Structure Showcase — Cinematic | 0.303199 | 0.365063 | 0.8788x | 0.000e+0 | match | yes | — | rejected-no-win |
| 68 | fallback | Bridge Load Test — Cinematic | 0.152220 | 0.184127 | 0.9876x | 0.000e+0 | match | yes | — | borderline |
| 69 | fallback | Material Bounce Lab — Cinematic | 0.192446 | 0.134524 | 1.1249x | 0.000e+0 | match | yes | — | accepted |
| 70 | fallback | Object Rain Stress Test — Cinematic | 0.392830 | 0.513926 | 0.9688x | 0.000e+0 | match | yes | — | rejected-no-win |
| 71 | effects | Cinematic effects variant 1 | 0.034976 | 0.032897 | 1.0515x | 0.000e+0 | match | yes | — | control |
| 72 | effects | Cinematic effects variant 2 | 0.114008 | 0.117395 | 0.9984x | 0.000e+0 | match | yes | — | control |
| 73 | effects | Cinematic effects variant 3 | 0.126002 | 0.123722 | 1.0184x | 0.000e+0 | match | yes | — | control |
| 74 | effects | Cinematic effects variant 4 | 0.172980 | 0.188124 | 0.8572x | 0.000e+0 | match | yes | — | control |
| 75 | effects | Cinematic effects variant 5 | 0.062559 | 0.061825 | 1.0107x | 0.000e+0 | match | yes | — | control |
| 76 | effects | Cinematic effects variant 6 | 0.149171 | 0.189567 | 0.8879x | 0.000e+0 | match | yes | — | control |
| 77 | effects | Cinematic effects variant 7 | 0.183676 | 0.180579 | 0.9804x | 0.000e+0 | match | yes | — | control |
| 78 | effects | Cinematic effects variant 8 | 0.258380 | 0.214920 | 1.3401x | 0.000e+0 | match | yes | — | control |
| 79 | effects | Cinematic effects variant 9 | 0.118571 | 0.121089 | 0.9804x | 0.000e+0 | match | yes | — | control |
| 80 | effects | Cinematic effects variant 10 | 0.185938 | 0.162221 | 1.0494x | 0.000e+0 | match | yes | — | control |
| 81 | water-control | Interactive Ripple Basin — Cinematic | 0.043847 | 0.040444 | 1.1026x | 0.000e+0 | match | yes | — | control |
| 82 | water-control | Tsunami Research Flume — Cinematic | 0.041638 | 0.042118 | 1.0066x | 0.000e+0 | match | yes | — | control |
| 83 | water-control | Storm Ocean Surface — Cinematic | 0.072433 | 0.070085 | 1.1384x | 0.000e+0 | match | yes | — | control |
| 84 | water-control | Hydrodynamic Boat Wake — Cinematic | 0.095738 | 0.150874 | 1.0048x | 0.000e+0 | match | yes | — | control |
| 85 | water-control | Oscillating Fountain Pool — Cinematic | 0.064553 | 0.063282 | 1.0380x | 0.000e+0 | match | yes | — | control |
| 86 | water-control | Rain Impact Reservoir — Cinematic | 0.142189 | 0.213916 | 0.9965x | 0.000e+0 | match | yes | — | control |
| 87 | water-control | Dam-Breach Wave Front — Cinematic | 0.038688 | 0.039569 | 0.9787x | 0.000e+0 | match | yes | — | control |
| 88 | water-control | Vortex Current Chamber — Cinematic | 0.064719 | 0.066432 | 0.9136x | 0.000e+0 | match | yes | — | control |
| 89 | water-control | Harbor Buoyancy Lab — Cinematic | 0.113678 | 0.101270 | 0.9849x | 0.000e+0 | match | yes | — | control |
| 90 | water-control | Leviathan Impact Pool — Cinematic | 0.102844 | 0.111313 | 0.9048x | 0.000e+0 | match | yes | — | control |
| 91 | js-control | Tempest Standard — Baseline | 2.247886 | 1.991716 | 1.0083x | 0.000e+0 | match | yes | — | control |
| 92 | js-control | Cargo Net Load Catch — Cinematic | 1.927468 | 2.017472 | 1.0137x | 0.000e+0 | match | yes | — | control |
| 93 | js-control | Sky Crane Cable Load — Baseline | 0.218106 | 0.151208 | 0.9960x | 0.000e+0 | match | yes | — | control |
| 94 | js-control | Rope Net Resonance — Cinematic | 0.560917 | 0.670239 | 0.9229x | 0.000e+0 | match | yes | — | control |
| 95 | js-control | Leviathan Impact Pool — Cinematic | 0.478642 | 0.376098 | 1.0202x | 0.000e+0 | match | yes | — | control |
| 96 | unchanged-control | Tempest Standard — Baseline | 0.000066 | 0.000058 | 1.1033x | 0.000e+0 | match | yes | yes | control |
| 97 | unchanged-control | Tensioned Membrane Drum — Cinematic | 0.000058 | 0.000066 | 0.8708x | 0.000e+0 | match | yes | yes | control |
| 98 | unchanged-control | Sky Crane Cable Load — Baseline | 0.000064 | 0.000056 | 1.0592x | 0.000e+0 | match | yes | yes | control |
| 99 | unchanged-control | Rope Net Resonance — Cinematic | 0.000061 | 0.000067 | 0.9375x | 0.000e+0 | match | yes | yes | control |
| 100 | unchanged-control | Leviathan Impact Pool — Cinematic | 0.000067 | 0.000057 | 1.0964x | 0.000e+0 | match | yes | yes | control |

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
