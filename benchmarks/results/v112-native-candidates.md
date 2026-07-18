# v1.12 native Box3D focused benchmark

Compared the exact frozen v1.11 native artifact with the current v1.12 artifact. Matrix bits, color bits, replay hashes, observable state, counts, and stream revisions remained exact across all three correctness scenarios.

| Case | Bodies / dynamic | Median speedup | Balanced-bootstrap 95% interval | Classification |
|---|---:|---:|---:|---|
| Static-heavy explicit transform synchronization | 127 / 55 | 1.678× | 1.666–1.686× | accepted measured win |
| Nearly-all-dynamic explicit transform synchronization | 4096 / 4095 | 0.997× | 0.992–1.017× | parity / no proven difference |
| Static-heavy definite-miss explosion rejection | 127 / 55 | 0.997× | 0.991–1.006× | parity / no proven difference |
| Nearly-all-dynamic definite-miss explosion rejection | 4096 / 4095 | 0.991× | 0.985–1.002× | parity / no proven difference |
| Mixed static/dynamic frame preparation | 191 / 119 | 1.157× | 1.149–1.164× | accepted measured win |

- Frozen v1.11 archive: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`
- Frozen v1.11 WASM: `55106a695b86c801ff7b79348ed50906e88835f46436083d37bbe09cb494f3f4`
- Current v1.12 WASM: `03cf2a4a24e2c4aab33d51411c6bd3ff21440f068a3c8830ece34ad0ed9f168a`
- Frozen v1.11 bridge: `df439fef40fdb832b355999391bc2d912aa2520e4a78874b1400d646db161f1d`
- Current v1.12 bridge: `5807ca7b29b8a7f7cfebbd15a78d843a97290978d571d5bb6b135890b4f13a18`
- Samples: **24 per variant per case**, exactly balanced AB/BA
- Confidence: **20,000** deterministic stratified balanced-order resamples
- Accepted wins: **2**; parity controls: **3**; small unaccepted gains: **0**; bounded slowdowns under 5%: **0**; too noisy/no claim: **0**; material regressions: **0**
- Accepted-path geometric mean: **1.393×**

The nearly-all-dynamic transform case is an intentional control: the dynamic-index optimization has almost no static work to remove there, so it is not presented as a speedup unless its confidence interval independently proves one. Definite-miss explosions measure the squared-distance rejection path. These are bridge subsystem timings, not browser FPS claims.
