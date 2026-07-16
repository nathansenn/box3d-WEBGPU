# v1.13 focused water optimization evidence

- Baseline archive SHA-256: `33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67`
- Baseline simulations source SHA-256: `68b5822307675405d494cfa1a7e0ee2dc459eeb05102114f746d7fbebdb5c42a`
- Candidate simulations source SHA-256: `c05966d6cbea30c4b42d70645b7000714bbc7a582800e05acf04c22e0a094dd9`
- Common SIMD kernel SHA-256: `7d11d1d58187501e13f6c8a4fff3d03292089a2a30047ae1a6da1968e8b04c24`
- Samples: 8, paired bootstrap resamples: 10000
- Conditional fast-droplet threshold: **128 droplets**

The source-frozen v1.12 baseline and current workspace source were compiled independently. Both sides used the exact same v1.12 WASM kernel, isolating TypeScript-side water behavior; the current candidate has the rejected scalar pointer-swap edit reverted.

## Verdict

- Scalar pointer/buffer swaps: **revert** — 0.9976× geometric mean across zero-droplet controls; broad qualification requires a clear win and non-regression.
- Height-only droplet sampler: **retain conditionally** — 1.2260× geometric mean across 128–768 active-droplet complete frames; exact continuation after a later full velocity sample.
- Early-expired droplet removal: **retain conditionally** — 1.1925× geometric mean across 128–768 expiration-heavy complete frames; removed droplets cannot affect authoritative state.
- Conditional policy: **retain** — 1.2092× changed-path geometric mean; 0.9995× control geometric mean, 0.9691× worst control.

## Complete-path results

| Case | Backend | Baseline ms/frame | Candidate ms/frame | Speedup | Paired 95% interval | Exact |
|---|---|---:|---:|---:|---:|---:|
| active-simd-0 | simd | 0.014918 | 0.015034 | **0.9923×** | 0.9548–1.0383× | yes |
| active-simd-1 | simd | 0.014743 | 0.014807 | **0.9957×** | 0.9602–1.0205× | yes |
| active-simd-16 | simd | 0.016518 | 0.016219 | **1.0184×** | 0.9684–1.0589× | yes |
| active-simd-64 | simd | 0.020924 | 0.020762 | **1.0078×** | 0.9594–1.0300× | yes |
| active-simd-128 | simd | 0.027851 | 0.021855 | **1.2743×** | 1.2246–1.3292× | yes |
| active-simd-144 | simd | 0.028435 | 0.023040 | **1.2342×** | 1.1735–1.2992× | yes |
| active-simd-256 | simd | 0.039483 | 0.029840 | **1.3232×** | 1.2527–1.3809× | yes |
| active-simd-512 | simd | 0.064937 | 0.044435 | **1.4614×** | 1.4016–1.5736× | yes |
| active-simd-768 | simd | 0.088803 | 0.058670 | **1.5136×** | 1.4818–1.5780× | yes |
| expiring-simd-0 | simd | 0.015066 | 0.015043 | **1.0015×** | 0.9504–1.0288× | yes |
| expiring-simd-1 | simd | 0.015472 | 0.015318 | **1.0101×** | 0.9826–1.0393× | yes |
| expiring-simd-16 | simd | 0.015551 | 0.015493 | **1.0037×** | 0.9485–1.0312× | yes |
| expiring-simd-64 | simd | 0.016569 | 0.016762 | **0.9885×** | 0.9649–1.0148× | yes |
| expiring-simd-128 | simd | 0.018463 | 0.016115 | **1.1457×** | 1.0971–1.1674× | yes |
| expiring-simd-144 | simd | 0.019211 | 0.016104 | **1.1930×** | 1.1549–1.2368× | yes |
| expiring-simd-256 | simd | 0.020788 | 0.016038 | **1.2961×** | 1.2168–1.3303× | yes |
| expiring-simd-512 | simd | 0.026473 | 0.017550 | **1.5085×** | 1.4170–1.5391× | yes |
| expiring-simd-768 | simd | 0.031962 | 0.018794 | **1.7007×** | 1.6599–1.8069× | yes |
| steady-simd-700 | simd | 0.014108 | 0.014177 | **0.9951×** | 0.9881–1.0046× | yes |
| steady-simd-701 | simd | 0.014825 | 0.014872 | **0.9969×** | 0.9756–1.0173× | yes |
| steady-simd-703 | simd | 0.033383 | 0.033775 | **0.9884×** | 0.9781–0.9987× | yes |
| steady-simd-706 | simd | 0.014902 | 0.014690 | **1.0145×** | 0.9865–1.0462× | yes |
| steady-simd-708 | simd | 0.024492 | 0.024265 | **1.0094×** | 0.9653–1.0458× | yes |
| active-scalar-0 | scalar | 0.038898 | 0.039215 | **0.9919×** | 0.9698–1.0382× | yes |
| active-scalar-1 | scalar | 0.039126 | 0.038703 | **1.0109×** | 0.9741–1.0430× | yes |
| active-scalar-16 | scalar | 0.041512 | 0.042035 | **0.9876×** | 0.9687–1.0035× | yes |
| active-scalar-64 | scalar | 0.044246 | 0.045546 | **0.9715×** | 0.9430–0.9977× | yes |
| active-scalar-128 | scalar | 0.052067 | 0.046978 | **1.1083×** | 1.0917–1.1387× | yes |
| active-scalar-144 | scalar | 0.053632 | 0.046161 | **1.1618×** | 1.1090–1.1800× | yes |
| active-scalar-256 | scalar | 0.063269 | 0.053481 | **1.1830×** | 1.1511–1.1989× | yes |
| active-scalar-512 | scalar | 0.086623 | 0.068820 | **1.2587×** | 1.2172–1.2824× | yes |
| active-scalar-768 | scalar | 0.108051 | 0.081616 | **1.3239×** | 1.3002–1.3813× | yes |
| expiring-scalar-0 | scalar | 0.038871 | 0.038531 | **1.0088×** | 0.9651–1.0362× | yes |
| expiring-scalar-1 | scalar | 0.039037 | 0.038899 | **1.0035×** | 0.9739–1.0484× | yes |
| expiring-scalar-16 | scalar | 0.039628 | 0.040109 | **0.9880×** | 0.9729–1.0232× | yes |
| expiring-scalar-64 | scalar | 0.041336 | 0.040937 | **1.0097×** | 0.9807–1.0455× | yes |
| expiring-scalar-128 | scalar | 0.042734 | 0.040038 | **1.0674×** | 1.0295–1.1033× | yes |
| expiring-scalar-144 | scalar | 0.042653 | 0.039909 | **1.0688×** | 1.0316–1.1020× | yes |
| expiring-scalar-256 | scalar | 0.044727 | 0.038973 | **1.1476×** | 1.1176–1.1672× | yes |
| expiring-scalar-512 | scalar | 0.050198 | 0.041170 | **1.2193×** | 1.1680–1.2480× | yes |
| expiring-scalar-768 | scalar | 0.054433 | 0.042277 | **1.2875×** | 1.2554–1.3185× | yes |
| steady-scalar-700 | scalar | 0.039899 | 0.039885 | **1.0003×** | 0.9837–1.0071× | yes |
| steady-scalar-701 | scalar | 0.038858 | 0.039220 | **0.9908×** | 0.9545–1.0367× | yes |
| steady-scalar-703 | scalar | 0.056507 | 0.055685 | **1.0148×** | 0.9943–1.0222× | yes |
| steady-scalar-706 | scalar | 0.039243 | 0.039086 | **1.0040×** | 0.9712–1.0257× | yes |
| steady-scalar-708 | scalar | 0.047458 | 0.048971 | **0.9691×** | 0.9431–1.0074× | yes |
| active-javascript-0 | javascript | 0.082803 | 0.083153 | **0.9958×** | 0.9760–1.0070× | yes |
| active-javascript-1 | javascript | 0.083471 | 0.082528 | **1.0114×** | 1.0042–1.0193× | yes |
| active-javascript-16 | javascript | 0.085525 | 0.085112 | **1.0049×** | 0.9845–1.0464× | yes |
| active-javascript-64 | javascript | 0.091078 | 0.090226 | **1.0094×** | 0.9881–1.0188× | yes |
| active-javascript-128 | javascript | 0.096125 | 0.090864 | **1.0579×** | 1.0426–1.0646× | yes |
| active-javascript-144 | javascript | 0.098780 | 0.091667 | **1.0776×** | 1.0536–1.0989× | yes |
| active-javascript-256 | javascript | 0.106359 | 0.098433 | **1.0805×** | 1.0712–1.0904× | yes |
| active-javascript-512 | javascript | 0.132536 | 0.111160 | **1.1923×** | 1.1671–1.2285× | yes |
| active-javascript-768 | javascript | 0.155242 | 0.125363 | **1.2383×** | 1.2100–1.2678× | yes |
| expiring-javascript-0 | javascript | 0.080892 | 0.081224 | **0.9959×** | 0.9825–1.0294× | yes |
| expiring-javascript-1 | javascript | 0.083128 | 0.083067 | **1.0007×** | 0.9768–1.0157× | yes |
| expiring-javascript-16 | javascript | 0.084516 | 0.082743 | **1.0214×** | 0.9992–1.0423× | yes |
| expiring-javascript-64 | javascript | 0.083841 | 0.084995 | **0.9864×** | 0.9701–1.0197× | yes |
| expiring-javascript-128 | javascript | 0.086700 | 0.080943 | **1.0711×** | 1.0236–1.0810× | yes |
| expiring-javascript-144 | javascript | 0.086796 | 0.082262 | **1.0551×** | 1.0261–1.0739× | yes |
| expiring-javascript-256 | javascript | 0.087912 | 0.085428 | **1.0291×** | 1.0193–1.0526× | yes |
| expiring-javascript-512 | javascript | 0.093925 | 0.083663 | **1.1227×** | 1.0904–1.1386× | yes |
| expiring-javascript-768 | javascript | 0.099669 | 0.086652 | **1.1502×** | 1.1360–1.1742× | yes |
| steady-javascript-700 | javascript | 0.082535 | 0.083221 | **0.9917×** | 0.9829–1.0157× | yes |
| steady-javascript-701 | javascript | 0.083632 | 0.083961 | **0.9961×** | 0.9734–1.0157× | yes |
| steady-javascript-703 | javascript | 0.101444 | 0.102535 | **0.9894×** | 0.9801–1.0105× | yes |
| steady-javascript-706 | javascript | 0.084399 | 0.083669 | **1.0087×** | 0.9865–1.0162× | yes |
| steady-javascript-708 | javascript | 0.093185 | 0.093519 | **0.9964×** | 0.9690–1.0111× | yes |

## Category summary

| Category | Cases | Geometric mean | Range |
|---|---:|---:|---:|
| active-droplets | 27 | **1.1197×** | 0.9715–1.5136× |
| expiring-droplets | 27 | **1.1035×** | 0.9864–1.7007× |
| steady-controls | 15 | **0.9976×** | 0.9691–1.0148× |

## Correctness boundary

All 69 exact cases passed across 2934 compared history frames. Each frame compared eta/u/v, all three next-step buffers, kernel-pointer parity, full droplet and floater state, RNG state, telemetry/history values, and rendered instance matrices/colors.

The height-only path intentionally does not refresh `sampleVelocityX/Z` during droplet-only queries. Those fields are non-authoritative scratch values. Every trace therefore continued through a later full eta/u/v sample and explosion; authoritative state and history remained exact.

Timings cover one complete production frame (`step(1/60, 4)` plus `buildFrame(false)`). Scene construction and benchmark fixture setup are outside the timed region.
