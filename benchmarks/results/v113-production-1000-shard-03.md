# WebPhysics v1.13 shard 3/10

Generated: 2026-07-16T21:05:09.169Z

Cases: **100**; group: **fallback-create-actions**; smoke: **false**.

Registry: `ac38d476ee69c222ce9fb7380d9d53eb30b101e0dd34a1e13be9334fe0c9c032`

Candidate source: `9baae5ee1004276a5937b66a1eae13f3c2776f3d198edd2a5637f231b1286cbe`

Harness closure: `6b54d5e2a7bc71d086b860c9384dd36d5951630399faeeb21a7c093072c5fcb9`

| ID | Scene | Protocol | Speedup | 95% CI | Min batch | Correct | Decision |
|---:|---|---|---:|---:|---:|---|---|
| 201 | Jenga Shear Test — Baseline | fallback-create-step | 0.8264× | 0.803–0.856 | 46.84 ms | yes | rejected-no-win |
| 202 | Stair-Step Avalanche — Baseline | fallback-create-step | 0.8775× | 0.822–0.908 | 45.36 ms | yes | rejected-no-win |
| 203 | Cantilever Block Shelf — High Stress | fallback-create-step | 0.9035× | 0.885–0.923 | 51.15 ms | yes | rejected-no-win |
| 204 | Mega Stack Collapse — Precision | fallback-create-step | 0.8236× | 0.793–0.883 | 45.40 ms | yes | rejected-no-win |
| 205 | Masonry Wall Buckling — Precision | fallback-create-step | 0.8929× | 0.855–0.952 | 40.77 ms | yes | rejected-no-win |
| 206 | Jenga Shear Test — Impact Demo | fallback-create-step | 0.8336× | 0.804–0.859 | 47.74 ms | yes | rejected-no-win |
| 207 | Stair-Step Avalanche — Impact Demo | fallback-create-step | 0.9610× | 0.922–0.983 | 51.17 ms | yes | rejected-no-win |
| 208 | Cantilever Block Shelf — Cinematic | fallback-create-step | 0.9133× | 0.859–0.931 | 47.25 ms | yes | rejected-no-win |
| 209 | Domino Cathedral — Baseline | fallback-create-step | 1.0404× | 0.969–1.098 | 45.17 ms | yes | borderline |
| 210 | S-Curve Cascade — Baseline | fallback-create-step | 1.0181× | 0.904–1.101 | 14.67 ms | yes | borderline |
| 211 | Double Helix Dominoes — High Stress | fallback-create-step | 1.0663× | 0.759–1.341 | 18.25 ms | yes | borderline |
| 212 | Nested Figure Eight — High Stress | fallback-create-step | 1.0471× | 0.712–1.587 | 13.81 ms | yes | borderline |
| 213 | Concentric Contact Rings — Precision | fallback-create-step | 0.9638× | 0.925–1.126 | 58.90 ms | yes | borderline |
| 214 | Domino Cathedral — Impact Demo | fallback-create-step | 0.9533× | 0.862–0.989 | 23.90 ms | yes | rejected-no-win |
| 215 | S-Curve Cascade — Impact Demo | fallback-create-step | 1.0960× | 0.779–1.562 | 15.40 ms | yes | borderline |
| 216 | Double Helix Dominoes — Cinematic | fallback-create-step | 0.9661× | 0.691–1.006 | 16.73 ms | yes | borderline |
| 217 | Nested Figure Eight — Cinematic | fallback-create-step | 0.9622× | 0.948–0.983 | 28.98 ms | yes | rejected-no-win |
| 218 | Setback Office Tower — Baseline | fallback-create-step | 1.1037× | 1.086–1.118 | 34.71 ms | yes | accepted-provisional |
| 219 | Skyscraper Impact Lab — High Stress | fallback-create-step | 0.9754× | 0.966–0.988 | 33.21 ms | yes | rejected-no-win |
| 220 | Diagonal Tube Frame — High Stress | fallback-create-step | 0.9807× | 0.950–0.999 | 49.42 ms | yes | borderline |
| 221 | Mega-Braced High Rise — Precision | fallback-create-step | 1.2573× | 0.981–1.278 | 30.23 ms | yes | borderline |
| 222 | Needle Spire Shake Test — Precision | fallback-create-step | 1.2130× | 1.205–1.226 | 36.01 ms | yes | accepted-provisional |
| 223 | Podium Tower Collapse — Impact Demo | fallback-create-step | 0.9947× | 0.796–1.272 | 36.63 ms | yes | borderline |
| 224 | Core-and-Shell Tower — Cinematic | fallback-create-step | 0.9836× | 0.967–0.995 | 49.96 ms | yes | borderline |
| 225 | Skybridge Tower Pair — Cinematic | fallback-create-step | 0.9249× | 0.868–0.965 | 46.34 ms | yes | rejected-no-win |
| 226 | Arch Bridge Compression — Baseline | fallback-create-step | 0.9833× | 0.920–1.144 | 55.14 ms | yes | borderline |
| 227 | Multi-Pier Viaduct — Baseline | fallback-create-step | 0.9289× | 0.771–0.963 | 37.45 ms | yes | rejected-no-win |
| 228 | Rail Trestle Vibration — High Stress | fallback-create-step | 0.9701× | 0.956–1.079 | 59.17 ms | yes | borderline |
| 229 | Suspension Deck Proxy — Precision | fallback-create-step | 1.0404× | 0.810–1.284 | 31.04 ms | yes | borderline |
| 230 | Cantilever Span Stress — Precision | fallback-create-step | 1.0275× | 0.955–1.374 | 9.87 ms | yes | borderline |
| 231 | Arch Bridge Compression — Impact Demo | fallback-create-step | 0.9700× | 0.924–1.027 | 37.17 ms | yes | borderline |
| 232 | Multi-Pier Viaduct — Impact Demo | fallback-create-step | 0.9340× | 0.869–1.414 | 12.16 ms | yes | borderline |
| 233 | Rail Trestle Vibration — Cinematic | fallback-create-step | 0.9639× | 0.761–1.049 | 21.33 ms | yes | borderline |
| 234 | Ice vs Rubber Lanes — Baseline | fallback-create-step | 0.9007× | 0.644–1.250 | 13.52 ms | yes | borderline |
| 235 | Floor Coating Comparison — Baseline | fallback-create-step | 0.9783× | 0.962–1.012 | 39.71 ms | yes | borderline |
| 236 | Restitution Staircase — High Stress | fallback-create-step | 1.4602× | 1.352–1.566 | 15.29 ms | yes | accepted-provisional |
| 237 | Energy Loss Arena — High Stress | fallback-create-step | 0.9851× | 0.908–1.323 | 13.50 ms | yes | borderline |
| 238 | Ramp Angle Sweep — Precision | fallback-create-step | 0.9972× | 0.830–1.240 | 24.61 ms | yes | borderline |
| 239 | Ice vs Rubber Lanes — Impact Demo | fallback-create-step | 0.9395× | 0.897–0.997 | 59.01 ms | yes | rejected-no-win |
| 240 | Floor Coating Comparison — Impact Demo | fallback-create-step | 0.9672× | 0.944–0.979 | 31.43 ms | yes | rejected-no-win |
| 241 | Heavy-Light Collision Matrix — Cinematic | fallback-active-step | 1.0044× | 0.993–1.012 | 36.63 ms | yes | borderline |
| 242 | Object Rain Stress Test — Baseline | fallback-active-step | 1.0121× | 0.997–1.028 | 40.50 ms | yes | borderline |
| 243 | GPU Upload Saturation — Baseline | fallback-active-step | 1.0223× | 1.014–1.033 | 41.19 ms | yes | borderline |
| 244 | Debris Storm Chamber — High Stress | fallback-active-step | 1.0119× | 0.956–1.039 | 31.67 ms | yes | borderline |
| 245 | Wide-Area Scatter Rain — High Stress | fallback-active-step | 1.0217× | 0.993–1.041 | 37.69 ms | yes | borderline |
| 246 | Voxel Hail Simulation — Precision | fallback-active-step | 1.0121× | 0.999–1.025 | 45.88 ms | yes | borderline |
| 247 | Object Rain Stress Test — Impact Demo | fallback-active-step | 1.0476× | 1.030–1.095 | 34.85 ms | yes | accepted-provisional |
| 248 | GPU Upload Saturation — Impact Demo | fallback-active-step | 1.0237× | 1.008–1.044 | 37.15 ms | yes | borderline |
| 249 | Debris Storm Chamber — Cinematic | fallback-active-step | 1.0359× | 1.002–1.100 | 40.87 ms | yes | accepted-provisional |
| 250 | Wide-Area Scatter Rain — Cinematic | fallback-active-step | 1.0336× | 1.008–1.057 | 38.77 ms | yes | accepted-provisional |
| 251 | Falling Chimney Test — Baseline | fallback-active-step | 1.0007× | 0.985–1.034 | 43.68 ms | yes | borderline |
| 252 | Castle Siege Impact — High Stress | fallback-active-step | 1.0858× | 1.078–1.098 | 30.88 ms | yes | accepted-provisional |
| 253 | Wrecking Ball Proxy — High Stress | fallback-active-step | 1.0044× | 0.995–1.012 | 41.87 ms | yes | borderline |
| 254 | Rubble Wall Breach — Precision | fallback-active-step | 1.0135× | 1.000–1.037 | 46.93 ms | yes | borderline |
| 255 | Stacked Barricade Assault — Precision | fallback-active-step | 1.0109× | 0.998–1.031 | 45.40 ms | yes | borderline |
| 256 | Falling Chimney Test — Impact Demo | fallback-active-step | 1.0104× | 0.998–1.019 | 47.21 ms | yes | borderline |
| 257 | Castle Siege Impact — Cinematic | fallback-active-step | 1.0094× | 0.998–1.028 | 37.86 ms | yes | borderline |
| 258 | Wrecking Ball Proxy — Cinematic | fallback-active-step | 1.0060× | 0.994–1.017 | 43.95 ms | yes | borderline |
| 259 | Forklift Pallet Push — Baseline | fallback-active-step | 1.0058× | 0.998–1.014 | 72.93 ms | yes | borderline |
| 260 | Container Yard Collision — Baseline | fallback-active-step | 1.0032× | 0.997–1.008 | 98.61 ms | yes | borderline |
| 261 | Crash Barrier Test — High Stress | fallback-active-step | 1.1207× | 0.749–1.312 | 22.82 ms | yes | borderline |
| 262 | Truck Cargo Spill — Precision | fallback-active-step | 1.0091× | 1.002–1.018 | 31.74 ms | yes | borderline |
| 263 | Bulldozer Blade Proxy — Precision | fallback-active-step | 1.3182× | 1.297–1.332 | 34.76 ms | yes | accepted-provisional |
| 264 | Train Car Coupler Proxy — Impact Demo | fallback-active-step | 1.0271× | 0.908–1.287 | 20.64 ms | yes | borderline |
| 265 | Heavy Hauler Load Shift — Impact Demo | fallback-active-step | 1.0026× | 0.821–1.221 | 33.09 ms | yes | borderline |
| 266 | Crash Barrier Test — Cinematic | fallback-active-step | 1.1212× | 0.841–1.211 | 21.84 ms | yes | borderline |
| 267 | Pinball Bumper Field — Baseline | fallback-active-step | 1.0152× | 1.009–1.017 | 27.73 ms | yes | borderline |
| 268 | Gravity Conveyor Course — Baseline | fallback-active-step | 1.0039× | 0.989–1.017 | 41.94 ms | yes | borderline |
| 269 | Funnel Drop Maze — High Stress | fallback-active-step | 1.0015× | 0.996–1.007 | 39.99 ms | yes | borderline |
| 270 | Physics Toy Museum — High Stress | fallback-active-step | 0.9389× | 0.875–1.080 | 34.02 ms | yes | borderline |
| 271 | Timing Gate Cascade — Precision | fallback-mixed-actions | 1.0185× | 0.998–1.038 | 31.85 ms | yes | borderline |
| 272 | Pinball Bumper Field — Impact Demo | fallback-mixed-actions | 1.0083× | 0.973–1.026 | 31.95 ms | yes | borderline |
| 273 | Gravity Conveyor Course — Impact Demo | fallback-mixed-actions | 1.0520× | 1.037–1.076 | 37.61 ms | yes | accepted-provisional |
| 274 | Funnel Drop Maze — Cinematic | fallback-mixed-actions | 1.0539× | 1.022–1.142 | 30.61 ms | yes | accepted-provisional |
| 275 | Physics Toy Museum — Cinematic | fallback-mixed-actions | 1.0282× | 0.972–1.045 | 36.35 ms | yes | borderline |
| 276 | Modular House Assembly — Baseline | fallback-mixed-actions | 0.9868× | 0.972–1.010 | 43.95 ms | yes | borderline |
| 277 | Framing Lumber Stack — High Stress | fallback-mixed-actions | 1.0014× | 0.987–1.014 | 30.58 ms | yes | borderline |
| 278 | Barndominium Frame Test — High Stress | fallback-mixed-actions | 1.0235× | 0.994–1.445 | 17.97 ms | yes | borderline |
| 279 | Scaffold Stability Lab — Precision | fallback-mixed-actions | 0.9974× | 0.982–1.022 | 40.18 ms | yes | borderline |
| 280 | Foundation Block Layout — Precision | fallback-mixed-actions | 0.9987× | 0.984–1.373 | 20.24 ms | yes | borderline |
| 281 | Tempest Standard — Baseline | fallback-static-stage-step | 12.6439× | 11.602–13.697 | 4.13 ms | yes | timer-floor |
| 282 | Racing Sail Aerodynamics — Baseline | fallback-static-stage-step | 13.1075× | 12.344–15.702 | 2.88 ms | yes | timer-floor |
| 283 | Tempest Standard — High Stress | fallback-static-stage-step | 14.0844× | 12.379–15.248 | 4.07 ms | yes | timer-floor |
| 284 | Racing Sail Aerodynamics — High Stress | fallback-static-stage-step | 13.7226× | 11.652–16.559 | 2.57 ms | yes | timer-floor |
| 285 | Tempest Standard — Precision | fallback-static-stage-step | 12.6077× | 11.429–15.796 | 2.78 ms | yes | timer-floor |
| 286 | Racing Sail Aerodynamics — Precision | fallback-static-stage-step | 13.8468× | 11.611–14.128 | 3.86 ms | yes | timer-floor |
| 287 | Tempest Standard — Impact Demo | fallback-static-stage-step | 46.7133× | 40.009–54.403 | 3.18 ms | yes | timer-floor |
| 288 | Racing Sail Aerodynamics — Impact Demo | fallback-static-stage-step | 43.3895× | 37.174–49.128 | 3.65 ms | yes | timer-floor |
| 289 | Tempest Standard — Cinematic | fallback-static-stage-step | 39.0541× | 35.607–44.571 | 4.11 ms | yes | timer-floor |
| 290 | Racing Sail Aerodynamics — Cinematic | fallback-static-stage-step | 41.9823× | 36.538–54.537 | 3.24 ms | yes | timer-floor |
| 291 | Sky Crane Cable Load — Baseline | fallback-static-stage-step | 18.4507× | 17.469–20.067 | 4.09 ms | yes | timer-floor |
| 292 | Cable Curtain Failure — Baseline | fallback-static-stage-step | 15.7992× | 14.841–16.094 | 4.36 ms | yes | timer-floor |
| 293 | Sky Crane Cable Load — High Stress | fallback-static-stage-step | 17.2679× | 16.209–17.619 | 4.50 ms | yes | timer-floor |
| 294 | Cable Curtain Failure — High Stress | fallback-static-stage-step | 16.2085× | 14.575–19.682 | 2.75 ms | yes | timer-floor |
| 295 | Sky Crane Cable Load — Precision | fallback-static-stage-step | 17.2955× | 15.891–21.894 | 3.15 ms | yes | timer-floor |
| 296 | Cable Curtain Failure — Precision | fallback-static-stage-step | 15.6664× | 13.490–16.404 | 4.26 ms | yes | timer-floor |
| 297 | Sky Crane Cable Load — Impact Demo | fallback-static-stage-step | 53.7592× | 44.883–55.442 | 3.83 ms | yes | timer-floor |
| 298 | Cable Curtain Failure — Impact Demo | fallback-static-stage-step | 43.5546× | 40.190–50.305 | 3.56 ms | yes | timer-floor |
| 299 | Sky Crane Cable Load — Cinematic | fallback-static-stage-step | 49.7618× | 42.131–58.976 | 3.55 ms | yes | timer-floor |
| 300 | Cable Curtain Failure — Cinematic | fallback-static-stage-step | 42.1375× | 36.487–50.720 | 3.14 ms | yes | timer-floor |
