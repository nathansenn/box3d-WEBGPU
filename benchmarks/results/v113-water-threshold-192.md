# v1.13 focused water optimization evidence

- Baseline archive SHA-256: `33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67`
- Baseline simulations source SHA-256: `68b5822307675405d494cfa1a7e0ee2dc459eeb05102114f746d7fbebdb5c42a`
- Candidate simulations source SHA-256: `327f22fbee2054e40dadf5333a3c6575dd83b7c71a8b7cb26e857f193176b53b`
- Common SIMD kernel SHA-256: `7d11d1d58187501e13f6c8a4fff3d03292089a2a30047ae1a6da1968e8b04c24`
- Samples: 6, paired bootstrap resamples: 5000
- Conditional fast-droplet threshold: **192 droplets**

Both source trees were compiled independently. The exact same source-frozen v1.12 WASM kernel was used on both sides, isolating the TypeScript droplet policy. Threshold candidates are generated from v1.12 and therefore do not include the separately rejected scalar pointer-swap edit.

## Verdict

- Scalar pointer/buffer swaps: **revert** — Excluded from the threshold candidate after the earlier broad source-frozen run failed its steady-control gate.
- Height-only droplet sampler: **retain conditionally** — 1.2742× geometric mean across 192–768 active-droplet complete frames; exact continuation after a later full velocity sample.
- Early-expired droplet removal: **retain conditionally** — 1.2613× geometric mean across 192–768 expiration-heavy complete frames; removed droplets cannot affect authoritative state.
- Conditional policy: **retain** — 1.2678× changed-path geometric mean; 0.9995× control geometric mean, 0.9628× worst control.

## Complete-path results

| Case | Backend | Baseline ms/frame | Candidate ms/frame | Speedup | Paired 95% interval | Exact |
|---|---|---:|---:|---:|---:|---:|
| active-simd-0 | simd | 0.014991 | 0.014757 | **1.0158×** | 0.9687–1.0713× | yes |
| active-simd-1 | simd | 0.015050 | 0.015013 | **1.0025×** | 0.9343–1.0738× | yes |
| active-simd-16 | simd | 0.017010 | 0.016834 | **1.0104×** | 0.9865–1.0355× | yes |
| active-simd-64 | simd | 0.022137 | 0.021339 | **1.0374×** | 0.9869–1.0688× | yes |
| active-simd-128 | simd | 0.027505 | 0.028541 | **0.9637×** | 0.9145–1.0047× | yes |
| active-simd-144 | simd | 0.029534 | 0.029613 | **0.9973×** | 0.9543–1.0700× | yes |
| active-simd-256 | simd | 0.039585 | 0.029651 | **1.3350×** | 1.2683–1.3742× | yes |
| active-simd-512 | simd | 0.063545 | 0.045131 | **1.4080×** | 1.3458–1.4819× | yes |
| active-simd-768 | simd | 0.086271 | 0.057387 | **1.5033×** | 1.4447–1.5711× | yes |
| expiring-simd-0 | simd | 0.014405 | 0.014827 | **0.9715×** | 0.9379–1.0505× | yes |
| expiring-simd-1 | simd | 0.015284 | 0.015166 | **1.0078×** | 0.9623–1.0486× | yes |
| expiring-simd-16 | simd | 0.015870 | 0.015666 | **1.0130×** | 0.9849–1.0548× | yes |
| expiring-simd-64 | simd | 0.017051 | 0.016698 | **1.0211×** | 0.9596–1.0918× | yes |
| expiring-simd-128 | simd | 0.017805 | 0.017322 | **1.0279×** | 0.9855–1.0427× | yes |
| expiring-simd-144 | simd | 0.018148 | 0.017991 | **1.0087×** | 0.9451–1.0313× | yes |
| expiring-simd-256 | simd | 0.019931 | 0.015374 | **1.2964×** | 1.2662–1.3455× | yes |
| expiring-simd-512 | simd | 0.026356 | 0.017270 | **1.5261×** | 1.4562–1.6411× | yes |
| expiring-simd-768 | simd | 0.031072 | 0.017682 | **1.7572×** | 1.6883–1.8379× | yes |
| steady-simd-700 | simd | 0.015248 | 0.014781 | **1.0316×** | 1.0011–1.0899× | yes |
| steady-simd-701 | simd | 0.014067 | 0.014240 | **0.9879×** | 0.9696–1.0068× | yes |
| steady-simd-703 | simd | 0.033129 | 0.031732 | **1.0440×** | 1.0104–1.0581× | yes |
| steady-simd-706 | simd | 0.014607 | 0.014799 | **0.9870×** | 0.9745–1.0068× | yes |
| steady-simd-708 | simd | 0.023947 | 0.024688 | **0.9700×** | 0.9464–1.0092× | yes |
| active-scalar-0 | scalar | 0.039154 | 0.038654 | **1.0129×** | 0.9883–1.0403× | yes |
| active-scalar-1 | scalar | 0.039209 | 0.039604 | **0.9900×** | 0.9778–1.0141× | yes |
| active-scalar-16 | scalar | 0.041387 | 0.042025 | **0.9848×** | 0.9697–1.0002× | yes |
| active-scalar-64 | scalar | 0.047000 | 0.046920 | **1.0017×** | 0.9778–1.0228× | yes |
| active-scalar-128 | scalar | 0.053682 | 0.052987 | **1.0131×** | 0.9815–1.0504× | yes |
| active-scalar-144 | scalar | 0.052517 | 0.053010 | **0.9907×** | 0.9624–1.0101× | yes |
| active-scalar-256 | scalar | 0.063441 | 0.054383 | **1.1666×** | 1.1551–1.1874× | yes |
| active-scalar-512 | scalar | 0.088038 | 0.068343 | **1.2882×** | 1.2647–1.3373× | yes |
| active-scalar-768 | scalar | 0.108395 | 0.081259 | **1.3339×** | 1.2966–1.3654× | yes |
| expiring-scalar-0 | scalar | 0.039186 | 0.038686 | **1.0129×** | 0.9836–1.0290× | yes |
| expiring-scalar-1 | scalar | 0.039495 | 0.039952 | **0.9886×** | 0.9746–1.0054× | yes |
| expiring-scalar-16 | scalar | 0.039956 | 0.038873 | **1.0278×** | 0.9936–1.0404× | yes |
| expiring-scalar-64 | scalar | 0.040918 | 0.040981 | **0.9985×** | 0.9850–1.0102× | yes |
| expiring-scalar-128 | scalar | 0.042436 | 0.041894 | **1.0130×** | 0.9858–1.0139× | yes |
| expiring-scalar-144 | scalar | 0.041646 | 0.042424 | **0.9816×** | 0.9666–1.0063× | yes |
| expiring-scalar-256 | scalar | 0.043778 | 0.039754 | **1.1012×** | 1.0766–1.1407× | yes |
| expiring-scalar-512 | scalar | 0.049363 | 0.040834 | **1.2089×** | 1.1899–1.2610× | yes |
| expiring-scalar-768 | scalar | 0.055953 | 0.042416 | **1.3191×** | 1.2971–1.3361× | yes |
| steady-scalar-700 | scalar | 0.038669 | 0.039523 | **0.9784×** | 0.9508–1.0017× | yes |
| steady-scalar-701 | scalar | 0.038517 | 0.038553 | **0.9991×** | 0.9836–1.0061× | yes |
| steady-scalar-703 | scalar | 0.057808 | 0.057376 | **1.0075×** | 0.9806–1.0261× | yes |
| steady-scalar-706 | scalar | 0.038635 | 0.039610 | **0.9754×** | 0.9441–1.0194× | yes |
| steady-scalar-708 | scalar | 0.048163 | 0.050022 | **0.9628×** | 0.9424–1.0066× | yes |
| active-javascript-0 | javascript | 0.081645 | 0.081744 | **0.9988×** | 0.9690–1.0297× | yes |
| active-javascript-1 | javascript | 0.083022 | 0.084259 | **0.9853×** | 0.9449–1.0071× | yes |
| active-javascript-16 | javascript | 0.083628 | 0.084507 | **0.9896×** | 0.9807–1.0106× | yes |
| active-javascript-64 | javascript | 0.089277 | 0.088154 | **1.0127×** | 0.9991–1.0477× | yes |
| active-javascript-128 | javascript | 0.092829 | 0.095555 | **0.9715×** | 0.9415–1.0061× | yes |
| active-javascript-144 | javascript | 0.095642 | 0.098238 | **0.9736×** | 0.9527–1.0321× | yes |
| active-javascript-256 | javascript | 0.107972 | 0.097139 | **1.1115×** | 1.0850–1.1433× | yes |
| active-javascript-512 | javascript | 0.130650 | 0.111282 | **1.1740×** | 1.1164–1.2094× | yes |
| active-javascript-768 | javascript | 0.152342 | 0.127160 | **1.1980×** | 1.1581–1.2350× | yes |
| expiring-javascript-0 | javascript | 0.083389 | 0.083263 | **1.0015×** | 0.9866–1.0294× | yes |
| expiring-javascript-1 | javascript | 0.084541 | 0.083906 | **1.0076×** | 0.9795–1.0213× | yes |
| expiring-javascript-16 | javascript | 0.084793 | 0.085045 | **0.9970×** | 0.9594–1.0152× | yes |
| expiring-javascript-64 | javascript | 0.087020 | 0.085215 | **1.0212×** | 1.0065–1.0392× | yes |
| expiring-javascript-128 | javascript | 0.083810 | 0.085354 | **0.9819×** | 0.9697–1.0226× | yes |
| expiring-javascript-144 | javascript | 0.086921 | 0.086118 | **1.0093×** | 0.9684–1.0385× | yes |
| expiring-javascript-256 | javascript | 0.087455 | 0.085106 | **1.0276×** | 1.0078–1.0717× | yes |
| expiring-javascript-512 | javascript | 0.095155 | 0.085040 | **1.1189×** | 1.0951–1.1365× | yes |
| expiring-javascript-768 | javascript | 0.099041 | 0.086030 | **1.1512×** | 1.1051–1.1925× | yes |
| steady-javascript-700 | javascript | 0.084069 | 0.083524 | **1.0065×** | 0.9779–1.0480× | yes |
| steady-javascript-701 | javascript | 0.082043 | 0.083507 | **0.9825×** | 0.9566–1.0298× | yes |
| steady-javascript-703 | javascript | 0.101227 | 0.100849 | **1.0037×** | 0.9831–1.0184× | yes |
| steady-javascript-706 | javascript | 0.082543 | 0.083933 | **0.9834×** | 0.9567–1.0013× | yes |
| steady-javascript-708 | javascript | 0.094436 | 0.092382 | **1.0222×** | 0.9825–1.0273× | yes |

## Category summary

| Category | Cases | Geometric mean | Range |
|---|---:|---:|---:|
| active-droplets | 27 | **1.0821×** | 0.9637–1.5033× |
| expiring-droplets | 27 | **1.0840×** | 0.9715–1.7572× |
| steady-controls | 15 | **0.9959×** | 0.9628–1.0440× |

## Correctness boundary

All 69 exact cases passed across 2934 compared history frames. Each frame compared eta/u/v, all three next-step buffers, kernel-pointer parity, full droplet and floater state, RNG state, telemetry/history values, and rendered instance matrices/colors.

The height-only path intentionally does not refresh `sampleVelocityX/Z` during droplet-only queries. Those fields are non-authoritative scratch values. Every trace therefore continued through a later full eta/u/v sample and explosion; authoritative state and history remained exact.

Timings cover one complete production frame (`step(1/60, 4)` plus `buildFrame(false)`). Scene construction and benchmark fixture setup are outside the timed region.
