# v1.13 focused water optimization evidence

- Baseline archive SHA-256: `33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67`
- Baseline simulations source SHA-256: `68b5822307675405d494cfa1a7e0ee2dc459eeb05102114f746d7fbebdb5c42a`
- Candidate simulations source SHA-256: `e6a642d5df0433948cc08de6529b96cdd135f57d76ded6e0dfa9f7e134ed49cb`
- Common SIMD kernel SHA-256: `7d11d1d58187501e13f6c8a4fff3d03292089a2a30047ae1a6da1968e8b04c24`
- Samples: 6, paired bootstrap resamples: 5000
- Conditional fast-droplet threshold: **128 droplets**

Both source trees were compiled independently. The exact same source-frozen v1.12 WASM kernel was used on both sides, isolating the TypeScript droplet policy. Threshold candidates are generated from v1.12 and therefore do not include the separately rejected scalar pointer-swap edit.

## Verdict

- Scalar pointer/buffer swaps: **revert** — Excluded from the threshold candidate after the earlier broad source-frozen run failed its steady-control gate.
- Height-only droplet sampler: **retain conditionally** — 1.2117× geometric mean across 128–768 active-droplet complete frames; exact continuation after a later full velocity sample.
- Early-expired droplet removal: **retain conditionally** — 1.1911× geometric mean across 128–768 expiration-heavy complete frames; removed droplets cannot affect authoritative state.
- Conditional policy: **retain** — 1.2013× changed-path geometric mean; 0.9988× control geometric mean, 0.9597× worst control.

## Complete-path results

| Case | Backend | Baseline ms/frame | Candidate ms/frame | Speedup | Paired 95% interval | Exact |
|---|---|---:|---:|---:|---:|---:|
| active-simd-0 | simd | 0.014876 | 0.015058 | **0.9879×** | 0.9731–1.0154× | yes |
| active-simd-1 | simd | 0.015156 | 0.015062 | **1.0063×** | 0.9740–1.0224× | yes |
| active-simd-16 | simd | 0.016780 | 0.016566 | **1.0129×** | 0.9816–1.0243× | yes |
| active-simd-64 | simd | 0.020610 | 0.020998 | **0.9815×** | 0.9294–1.0131× | yes |
| active-simd-128 | simd | 0.027440 | 0.023036 | **1.1912×** | 1.1689–1.2452× | yes |
| active-simd-144 | simd | 0.029459 | 0.023851 | **1.2351×** | 1.2068–1.2780× | yes |
| active-simd-256 | simd | 0.037960 | 0.029370 | **1.2925×** | 1.2478–1.3329× | yes |
| active-simd-512 | simd | 0.065273 | 0.046487 | **1.4041×** | 1.3279–1.5040× | yes |
| active-simd-768 | simd | 0.085075 | 0.057882 | **1.4698×** | 1.4447–1.4967× | yes |
| expiring-simd-0 | simd | 0.014530 | 0.014805 | **0.9815×** | 0.9441–1.0262× | yes |
| expiring-simd-1 | simd | 0.014570 | 0.015016 | **0.9703×** | 0.9483–0.9989× | yes |
| expiring-simd-16 | simd | 0.015493 | 0.015644 | **0.9903×** | 0.9610–1.0220× | yes |
| expiring-simd-64 | simd | 0.016279 | 0.016962 | **0.9597×** | 0.9329–1.0313× | yes |
| expiring-simd-128 | simd | 0.017441 | 0.015283 | **1.1412×** | 1.1030–1.1471× | yes |
| expiring-simd-144 | simd | 0.018002 | 0.015581 | **1.1554×** | 1.1279–1.1919× | yes |
| expiring-simd-256 | simd | 0.019940 | 0.015782 | **1.2635×** | 1.2073–1.3813× | yes |
| expiring-simd-512 | simd | 0.026326 | 0.017403 | **1.5127×** | 1.4693–1.5481× | yes |
| expiring-simd-768 | simd | 0.031695 | 0.018191 | **1.7423×** | 1.6844–1.8285× | yes |
| steady-simd-700 | simd | 0.014719 | 0.015054 | **0.9778×** | 0.9381–1.0128× | yes |
| steady-simd-701 | simd | 0.014458 | 0.014725 | **0.9819×** | 0.9428–1.0306× | yes |
| steady-simd-703 | simd | 0.032840 | 0.032797 | **1.0013×** | 0.9323–1.0395× | yes |
| steady-simd-706 | simd | 0.014928 | 0.014818 | **1.0075×** | 0.9595–1.1038× | yes |
| steady-simd-708 | simd | 0.024586 | 0.024581 | **1.0002×** | 0.9752–1.0324× | yes |
| active-scalar-0 | scalar | 0.038360 | 0.038293 | **1.0017×** | 0.9967–1.0159× | yes |
| active-scalar-1 | scalar | 0.040293 | 0.038657 | **1.0423×** | 0.9784–1.0756× | yes |
| active-scalar-16 | scalar | 0.041378 | 0.041343 | **1.0008×** | 0.9885–1.0298× | yes |
| active-scalar-64 | scalar | 0.046720 | 0.046681 | **1.0008×** | 0.9744–1.0261× | yes |
| active-scalar-128 | scalar | 0.052979 | 0.046931 | **1.1289×** | 1.1053–1.2126× | yes |
| active-scalar-144 | scalar | 0.055287 | 0.047088 | **1.1741×** | 1.0982–1.1870× | yes |
| active-scalar-256 | scalar | 0.064035 | 0.053151 | **1.2048×** | 1.1794–1.2192× | yes |
| active-scalar-512 | scalar | 0.086328 | 0.070246 | **1.2289×** | 1.1878–1.3082× | yes |
| active-scalar-768 | scalar | 0.109248 | 0.080722 | **1.3534×** | 1.2842–1.3985× | yes |
| expiring-scalar-0 | scalar | 0.039704 | 0.039631 | **1.0018×** | 0.9918–1.0160× | yes |
| expiring-scalar-1 | scalar | 0.039067 | 0.039429 | **0.9908×** | 0.9906–1.0129× | yes |
| expiring-scalar-16 | scalar | 0.039392 | 0.039395 | **0.9999×** | 0.9685–1.0408× | yes |
| expiring-scalar-64 | scalar | 0.041405 | 0.040976 | **1.0105×** | 0.9801–1.0199× | yes |
| expiring-scalar-128 | scalar | 0.042290 | 0.039462 | **1.0717×** | 1.0672–1.1039× | yes |
| expiring-scalar-144 | scalar | 0.042568 | 0.039258 | **1.0843×** | 1.0532–1.1249× | yes |
| expiring-scalar-256 | scalar | 0.044492 | 0.039811 | **1.1176×** | 1.0638–1.1459× | yes |
| expiring-scalar-512 | scalar | 0.050529 | 0.041211 | **1.2261×** | 1.1889–1.2803× | yes |
| expiring-scalar-768 | scalar | 0.055185 | 0.041650 | **1.3250×** | 1.2797–1.3614× | yes |
| steady-scalar-700 | scalar | 0.039045 | 0.039064 | **0.9995×** | 0.9756–1.0321× | yes |
| steady-scalar-701 | scalar | 0.039403 | 0.038970 | **1.0111×** | 0.9803–1.0300× | yes |
| steady-scalar-703 | scalar | 0.056615 | 0.057787 | **0.9797×** | 0.9570–1.0214× | yes |
| steady-scalar-706 | scalar | 0.039427 | 0.038794 | **1.0163×** | 1.0083–1.0244× | yes |
| steady-scalar-708 | scalar | 0.049504 | 0.048030 | **1.0307×** | 1.0140–1.0490× | yes |
| active-javascript-0 | javascript | 0.083504 | 0.082806 | **1.0084×** | 0.9829–1.0405× | yes |
| active-javascript-1 | javascript | 0.083595 | 0.083691 | **0.9989×** | 0.9961–1.0205× | yes |
| active-javascript-16 | javascript | 0.084417 | 0.084574 | **0.9981×** | 0.9941–1.0181× | yes |
| active-javascript-64 | javascript | 0.089091 | 0.090233 | **0.9873×** | 0.9613–1.0127× | yes |
| active-javascript-128 | javascript | 0.094239 | 0.089776 | **1.0497×** | 1.0199–1.0814× | yes |
| active-javascript-144 | javascript | 0.095437 | 0.091049 | **1.0482×** | 1.0175–1.0673× | yes |
| active-javascript-256 | javascript | 0.105783 | 0.096076 | **1.1010×** | 1.0639–1.1404× | yes |
| active-javascript-512 | javascript | 0.127129 | 0.111579 | **1.1394×** | 1.1303–1.2342× | yes |
| active-javascript-768 | javascript | 0.155411 | 0.125538 | **1.2380×** | 1.2016–1.3012× | yes |
| expiring-javascript-0 | javascript | 0.081841 | 0.082574 | **0.9911×** | 0.9659–1.0281× | yes |
| expiring-javascript-1 | javascript | 0.084446 | 0.083847 | **1.0071×** | 0.9779–1.0237× | yes |
| expiring-javascript-16 | javascript | 0.083526 | 0.082077 | **1.0177×** | 0.9900–1.0312× | yes |
| expiring-javascript-64 | javascript | 0.082939 | 0.084944 | **0.9764×** | 0.9568–1.0025× | yes |
| expiring-javascript-128 | javascript | 0.085327 | 0.083775 | **1.0185×** | 1.0034–1.0448× | yes |
| expiring-javascript-144 | javascript | 0.087203 | 0.084257 | **1.0350×** | 1.0099–1.0634× | yes |
| expiring-javascript-256 | javascript | 0.091795 | 0.082429 | **1.1136×** | 1.0556–1.1513× | yes |
| expiring-javascript-512 | javascript | 0.094300 | 0.085178 | **1.1071×** | 1.0753–1.1416× | yes |
| expiring-javascript-768 | javascript | 0.098806 | 0.086364 | **1.1441×** | 1.1040–1.1709× | yes |
| steady-javascript-700 | javascript | 0.084218 | 0.083314 | **1.0108×** | 0.9531–1.0406× | yes |
| steady-javascript-701 | javascript | 0.082209 | 0.080986 | **1.0151×** | 0.9836–1.0463× | yes |
| steady-javascript-703 | javascript | 0.102518 | 0.101682 | **1.0082×** | 0.9657–1.0254× | yes |
| steady-javascript-706 | javascript | 0.083670 | 0.082586 | **1.0131×** | 0.9941–1.0220× | yes |
| steady-javascript-708 | javascript | 0.092339 | 0.094036 | **0.9820×** | 0.9616–1.0164× | yes |

## Category summary

| Category | Cases | Geometric mean | Range |
|---|---:|---:|---:|
| active-droplets | 27 | **1.1136×** | 0.9815–1.4698× |
| expiring-droplets | 27 | **1.0977×** | 0.9597–1.7423× |
| steady-controls | 15 | **1.0022×** | 0.9778–1.0307× |

## Correctness boundary

All 69 exact cases passed across 2934 compared history frames. Each frame compared eta/u/v, all three next-step buffers, kernel-pointer parity, full droplet and floater state, RNG state, telemetry/history values, and rendered instance matrices/colors.

The height-only path intentionally does not refresh `sampleVelocityX/Z` during droplet-only queries. Those fields are non-authoritative scratch values. Every trace therefore continued through a later full eta/u/v sample and explosion; authoritative state and history remained exact.

Timings cover one complete production frame (`step(1/60, 4)` plus `buildFrame(false)`). Scene construction and benchmark fixture setup are outside the timed region.
