# v1.13 historical benchmark gap audit

Date: July 16, 2026

Status: reconciled with the final source-frozen 1,000-case tournament

This audit rechecks the v1.2–v1.12 performance history against the code and
artifacts measured by v1.13. Historical results explain why a design remains in
the tree; the authoritative current-source result is
[`v113-production-1000.json`](v113-production-1000.json).

## Bottom line

- No previously proved high-value optimization family is missing from the
  current production tree.
- The final tournament contains **1,000 unique semantic workloads and 1,000
  unique execution traces**, not renamed copies of a smaller benchmark.
- It records **165 accepted wins, 353 borderline cases, 360 controls, 85
  changed cases labeled timer-floor, 37 no-win rejections, and 0 correctness
  failures**. Another 118 below-floor cases retain the `control` label, so
  **203 cases total** are excluded from geometric means.
- The eligible set is 555 changed cases plus 242 controls. On the measured
  Apple M3 Ultra/Node 26 environment, the unweighted case-level geometric means
  are **1.0544× for changed CPU paths** and **1.0041× for controls**. Neither is
  a whole-engine, frame-time, browser-FPS, or physical-GPU multiplier.
- No eligible control met both material-regression screen conditions—a point
  speed below 0.94× and globally corrected one-sided BH `q <= 0.05`. Thus the
  prospective eight-fresh-process stage had no required case IDs; this is not a
  claim that every individual control point estimate was at or above 1.0×.
- The strongest complete v1.13 area is native construction: 80 eligible cases
  measured **1.1784×** geometric mean with 62 accepted wins. Water measured
  **1.0512×** across 91 eligible cases with 38 accepted wins.
- Native actions, fallback as a whole, and rope as a whole are parity in the
  final matrix. Their isolated or selective wins must not be promoted into
  broad engine-speed claims.

## Current release provenance

| Boundary | Final identity |
|---|---|
| Frozen v1.12 archive | `33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67` |
| Source-frozen v1.13 candidate, 63 files | `9baae5ee1004276a5937b66a1eae13f3c2776f3d198edd2a5637f231b1286cbe` |
| Canonical registry | `ac38d476ee69c222ce9fb7380d9d53eb30b101e0dd34a1e13be9334fe0c9c032` |
| Combined benchmark harness | `6b54d5e2a7bc71d086b860c9384dd36d5951630399faeeb21a7c093072c5fcb9` |
| `wasm/box3d_web.c` | `640d65fb3e264cbb0f7f3f487dba22205b981516f35a37707daae03e9a405ce2` |
| `src/physics/fallback.ts` | `1272174d845f2cb2126690bc59b934ccab43b808f738831eebb2f18592f898fe` |
| `src/physics/wasm.ts` | `abbd46cc034fae39ac6eb40ed55dc5c8059c4316fb25ae21035c1fe25850e327` |
| `src/soft/simulations.ts` | `c05966d6cbea30c4b42d70645b7000714bbc7a582800e05acf04c22e0a094dd9` |
| `wasm/soft_kernels.c` | `af5b1bcaea9d4781379a436cb73147297ec3ec29f0482a8511c38709bb2a69f1` |
| `src/webgpu/renderer.ts` | `7c6553969ec5586b5721c5d524d4be74f46608c06adff232aaa2d902bf2a5a9e` |
| Native generated JS | `8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b` |
| Native WASM | `de1fe4c659bb6c99879555b7b987d53455bcf4768cbfffcb35eac3ee75835a1c` |
| Native build provenance | `990f53f576ed851d6ff69932e2bcc15677f3f31f3bb38005b6e0ad935ae51992` |
| SIMD soft WASM | `8744df67b629cca4f15e9ff375723d9b6b2d5411df664c42642ec461c2e10c31` |
| Scalar soft WASM | `99893fdaf3c94214ef952cd1e0d592242f2b06618480741c00630495854286b6` |

The native artifact pins Box3D `v0.1.0` at
`8441b4a06d6d09dcfb0b0f704df4d847d1437b92`, was built twice
byte-identically with Emscripten 4.0.23, records an exact eight-entry box-hull
cache, and explicitly records `sparseMoveEventTransformSync: false`.

## Evidence classification correction

The old 100-candidate ledger reports **76 accepted isolated candidates** and an
11.518× accepted-kernel geometric mean. Those candidates are synthetic or
stand-in microkernels used for discovery. They are **not 76 independently
proved production gains**, and the isolated ratios cannot be multiplied or
treated as an engine aggregate. Several candidates describe overlapping work,
timer-floor elimination, or an implementation idea that later changed shape.

This audit calls a historical family “retained” only when all of the following
are true:

1. the production implementation can be located in the current source;
2. later end-to-end, fidelity, memory, upload, Dawn/Metal, or exact-path evidence
   supports that implementation boundary; and
3. later evidence has not superseded or rejected the earlier mechanism.

The clean cumulative v1.2-to-v1.10 soft-system comparison remains useful
because it measures complete corresponding workloads: 7.342× cloth, 2.746×
rope, and 13.342× water, or 6.455× geometric mean. It includes many intervening
layout, scheduling, WASM, and handoff changes and therefore is not attributable
to any single one of the 76 microkernel labels.

## Historical implementation reconciliation

### v1.3 packed surfaces, KTX2, and startup overlap

The v1.3 report correctly records a 24-byte packed vertex, `uint16` topology,
steady cloth/water traffic reductions of 66.12%/66.39%, a 49.73% smaller KTX2
BC4 file, and a 50.00% resident-payload reduction. The current implementation
has since specialized further:

- **Tearing cloth** still uses the topology-aware packed CPU surface path.
- **Intact cloth** uploads current positions at 12 bytes per vertex and
  reconstructs normals, UVs, strain, material response, and shadows on the GPU.
- **Water** uploads `eta/u/v` at 12 bytes per cell and reconstructs its surface
  on the GPU. It no longer uses the old packed-water surface path.

Therefore, “packed cloth/water surfaces” is historical v1.3 evidence, not an
accurate description of every current soft surface. The current retained
boundary is packed topology-aware tearing cloth plus GPU-resident intact cloth
and water.

Asynchronous pipeline creation remains a sound first-use-stall avoidance
mechanism, but its v1.3 local median was only about 1.02× and overlapped noise.
Overlapping KTX2 fetch/upload with independent renderer initialization measured
1.00× locally. Both architectural paths remain, but neither is claimed as a
proved local CPU speedup.

### v1.10 water construction and retained memory

The allocation audit removed dead packed-water frame state before any GPU
submission. Eleven alternating samples measured water construction at
**1.375351×** (`0.080315 ms` to `0.058396 ms`). Retained maximum-water typed
memory fell from **549,604 to 394,396 bytes**, a **28.24%** reduction. These are
construction and retained-memory results, not water-solver or FPS multipliers.

### v1.11 soft memory, capacity caps, and dead pipelines

The exact v1.11 audit constructed every one of the 150 soft scenes and measured
retained typed-array memory falling **38.74% overall**:

| Domain | Retained-memory reduction |
|---|---:|
| Intact cloth | **34.72%** |
| Tearing cloth | **23.24%** |
| Rope | **80.08%** |
| Water | **27.43%** |

The audited public-action saturation caps were **161 cloth instances, 97 rope
instances, and 788 water instances**. Those caps matter: the memory saving was
proved without silently clamping a candidate below the baseline action count.

Version 1.11 also removed a dead packed-water WGSL module and two unreachable
render pipelines after every live water recipe had moved to the GPU-resident
path:

```text
shader modules       12 -> 11
render pipelines     18 -> 16
compute pipelines     1 -> 1
```

Pixels remained exact and uncaptured WebGPU errors were zero. The 1.051×
fresh-process startup ratio overlapped the declared noise boundary, so the
retained claim is **strict dead-resource elimination**, not a local startup
speedup.

### Soft-kernel compiler modes retested

The v1.6 search favored SIMD `-O2` and scalar `-Os` using one maximum-cloth
scene and three samples. The current-source qualification used 12 active
cloth/rope/water workloads, two controls, 12 balanced AB/BA samples, at least
25 ms per batch, 20,000 bootstrap resamples, and exact 240-frame comparisons.

| Candidate / production `-O3` | Active GM | Cloth GM | Rope GM | Water GM | Maximum membrane |
|---|---:|---:|---:|---:|---:|
| SIMD `-O2` / `-O3` | **0.99480×** | 0.98423× | 1.00108× | 0.99919× | **0.94647×** |
| Scalar `-Os` / `-O3` | **0.99476×** | 0.97989× | 1.00141× | 1.00315× | **0.94105×** |

All comparisons were bit-exact, but both candidates lose overall and materially
regress maximum membrane. Production correctly keeps `-O3` for both modules.

## Retained historical families in current source

| Family | Best-scoped historical evidence | Current status and claim boundary |
|---|---|---|
| Persistent SIMD/scalar soft kernels with JS fallback | Complete v1.2→v1.10 soft GM 6.455× | Present. The cumulative number includes layouts/schedules/handoffs; it is not a WASM-only claim. |
| GPU intact-cloth reconstruction | Maximum logical handoff 81,600→20,400 bytes, −75.00% | Present. Physics remains CPU/WASM; topology-changing cloth uses the packed CPU fallback. |
| GPU shallow-water reconstruction | Logical handoff 309,200→77,360 bytes, −74.98%; later complete paths about 2.9× | Present. It is a 2.5D shallow-water solver, not general volumetric fluid or FPS evidence. |
| GPU rope presentation expansion | Handoff GM 5.969× and mean bytes −84.9% | Present. Solver+handoff 1.026× and 96-impact storm 0.976× prohibit a rope-solver claim. |
| Qualified adaptive cloth | Long 1.555×, storm 1.435×, max recorded error 0.08427% | Present only on qualified intact layouts; tearing/collider boundaries remain conservative. |
| Qualified rope batching | 38/250 combinations; fresh five-scene GM 1.0964× | Present only for the qualification matrix. |
| Frame/topology/upload caches | Unchanged streams 0 bytes; Metal cache microcall 95.52× in earlier evidence | Present. Ratios are work elimination, not whole-frame FPS. |
| Packed surface/topology | v1.3 steady traffic −66.12%/−66.39% | Current packed dynamic surface is tearing-cloth-only; intact cloth/water are GPU-resident. |
| KTX2 BC4/R8 | File −49.73%, resident payload −50.00%, 30.862 dB | Present. Fetch overlap was neutral locally; no local speed claim. |
| Effects reuse and drag cache | Changed frame 1.4767×, update 1.3794×; later drag update 1.314× | Present; unchanged ratios are cache work elimination. |
| Camera cache/sampler | Static resolve 19.35×; v1.12 sampler GM 1.140× | Present; active and unchanged controls remain required. |
| Diagnostic/effect line staging | Paused 752.55×/28.65×, mixed 2.134× | Present; forced-active controls separate caching from active work. |
| Fallback exact paths | Sync 1.383×, explosion 3.554×, contact 1.063×, lazy hash 1.590× | Present. v1.13's full fallback shard is parity and supersedes any broad claim. |
| Native settled/version paths | Settled step 127.51×, active bytes −20%, unchanged 0 bytes | Present with final-sleep and revision controls. |
| Axis soft matrices | Cloth sphere 1.748×; 768-droplet frame 4.135× | Present and exact. |
| Hybrid native transform sync | Static 1.678×, dense 0.997× parity, mixed 1.157× | Present. Sparse move events were rejected. |
| TurboQuant | About 6.7×–7.1× smaller packets; local Worker 53.3× slower | Retained only for remote/network/replay boundaries; absent from the local frame loop. |
| Water construction/storage audit | Construction 1.375×; retained memory −28.24% | Present as initialization/memory work, not solver/FPS speed. |
| v1.11 soft storage audit | 38.74% mean across 150 scenes with proved caps | Present; capacity ceilings are part of correctness. |
| Dead packed-water pipeline removal | 1 shader and 2 render pipelines removed | Present as resource elimination; startup timing was inconclusive. |

## v1.13 discoveries and final outcomes

| Candidate family | Focused evidence | Final source-frozen result |
|---|---|---|
| Eight-entry exact native hull cache | 20-sample GM **1.0685×**; recurring-size wins 1.037×–1.329×; unique-size rain 0.997×; all exact | Included with axis initial matrices and clear removal. Native create group: **1.1784×**, 62 accepted wins. Do not attribute the whole group GM to the cache alone. |
| Native cached-sign kick/explosion miss | Focused exact wins from 1.116× to 3.538× | Native mixed-action GM 0.9993×. Retained exact implementation, but no broad release speedup claim. |
| Fallback cached dynamic count/static early-out/reset reuse | Focused: count 540.81×, static cloth/rope 105.65×/169.16×, small create 1.783×, large create 1.026×, dynamic 1.010× | Full eligible fallback GM **0.9983×**, nine accepted cases. Static-stage cases were timer-floor; no whole-shard gain claimed. |
| Qualified branch-free intact cloth | Narrow exact/qualified specialization | Cloth GM **1.0078×**, 10 accepted; interaction GM 1.0045×. Tearing/unqualified paths unchanged. |
| High-count droplet sampling/expiry | Focused changed GM 1.2092×; threshold 128; exact | Water GM **1.0512×**, 38 accepted; interaction GM **1.0986×**. Retained selectively. |
| Stable WASM pointers | New current-line candidate | Changed wrapper GM **1.2291×**; pointers 1.5136×, step-pointers 1.2120×, mixed 1.2070×. Retained. |
| Numeric surface configuration cache | New current-line candidate | Changed renderer GM **1.3162×**; 18 accepted; bound Dawn/Metal source hash and zero WebGPU errors. Retained. |

## Rejected or deliberately bounded directions

| Candidate | Final evidence | Source state |
|---|---|---|
| Sparse native move events | Exact 100-mix removal GM 0.998994×; no focused 1.03× win | Reverted; provenance records false |
| `emmalloc` | 100-workload GM 1.0049×; startup 0.9777× | Absent; default allocator retained |
| SIMD `-O2` / scalar `-Os` | Active GMs 0.99480×/0.99476×; max membrane 0.94647×/0.94105× | Absent; `-O3` retained |
| Shadow-map reuse | Active lower bound 0.97938 missed the 0.98 floor | Absent |
| PCF/fog/HDR discard and indexed-cube shader edits | Metal parity/regression | Absent |
| Broad fused/adaptive cloth schedules | 19/100 plus 10 guard correctness failures | Absent outside explicit qualifiers |
| Flat particle SoA | Update 0.7867×; update+build 0.9639× | Reverted |
| Mutable camera-shake reuse | Combined path 0.9847× | Reverted |
| Reciprocal cloth algebra | About 0.95× | Absent |
| Rope delta/tuple reuse | About 0.81× / later reject | Absent |
| Cloth/rope energy throttling | About 1.00× | Absent |
| Scalar water pointer-swap rewrite | Control GM 0.9976× | Reverted |
| Local TurboQuant | Smaller payload but local Worker 53.3× slower | Deliberately absent locally |
| Bind-group hoist | Metal aggregate 1.0018× | Reverted before source freeze |
| Partial uniform write | 4-byte 0.988×; 16-byte 0.993× | Reverted before source freeze |
| Hybrid renderer scratch/string cache | Unchanged cloth 0.4914× and water 0.6436× versus numeric cache | Absent |

## Final coverage and control-confirmation policy

| Shard | Group | Optimization ownership |
|---:|---|---|
| 1 | native-create-active | Eight-entry hull cache, initial matrices, reset clear, create and create-plus-step |
| 2 | native-actions-sync | Actions, hybrid sync, active/explicit synchronization controls |
| 3 | fallback-create-actions | All fallback edits, static-stage early-out, historical exact paths |
| 4 | cloth | Qualified projection, GPU intact cloth, tearing neighbors |
| 5 | rope | Qualified batching, GPU expansion, steady/storm controls |
| 6 | water | High-count droplets, GPU handoff, low-count and solver controls |
| 7 | mixed-unchanged | Frame-version caches, zero uploads, mixed active frames |
| 8 | frame-prep-wasm-wrapper | Camera, lines, effects, pointer cache, counts, memory-growth-safe access |
| 9 | renderer-cpu-webgpu | Numeric surface cache and every upload/configuration family |
| 10 | controls | Active native, tearing, invalid steps, forced camera, forced resize |

Eligible controls must remain at or above 0.98× globally and within every
group. A control below 0.94× that survives global one-sided BH correction is
retested in eight independent fresh processes, each with at least eight
balanced AB/BA samples, a 25 ms target, and a repetition cap of at least 1,024.
It fails only if the Bonferroni familywise upper process-bootstrap bound remains
below 0.94×. No eligible final-run control met both screening conditions, so no
post-hoc waiver or confirmation result was needed. Controls below the timing
floor are among the 203 cases excluded from both changed and control GMs even
though they retain their `control` final label.

## Audit conclusion

The missing-gain review is closed for the current architecture. The retained
tree contains the production-backed historical families, corrects the status of
the v1.2 synthetic candidate ledger, reflects the current GPU-resident
cloth/water and tearing-only packed-surface split, carries the water and v1.11
memory/resource reductions, and rejects compiler/build/runtime candidates that
did not survive current-source tests. Any future gain should begin as a new
candidate with a new frozen baseline; historical ratios are discovery context,
not permission to bypass the current gates.
