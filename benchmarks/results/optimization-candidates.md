# Box3D WebGPU — 100 Optimization Candidate Benchmarks

Generated: 2026-07-13T14:16:57.639Z

## Method

- Nine timed samples after four warm-up passes.
- Median ns/op is used; MAD tracks run noise.
- Accepted only at ≥3% median improvement with bounded noise.
- Every candidate is retained in raw JSON/CSV, including regressions and inconclusive results.
- Perceptual/workload-equivalent changes require the end-to-end quality gate before integration.

## Summary

| Candidates | Accepted | Borderline | Rejected | Accepted geometric-mean kernel speedup |
|---:|---:|---:|---:|---:|
| 100 | 76 | 6 | 18 | 11.518× |

## Results

| # | Subsystem | Candidate | Baseline ns/op | Optimized ns/op | Speedup | Status |
|---:|---|---|---:|---:|---:|---|
| 1 | Math | Specialize 3D vector length instead of Math.hypot | 13.02 | 0.70 | 18.566× | accepted |
| 2 | Math | Replace pow(x, 2) with multiplication | 0.70 | 0.77 | 0.916× | rejected-no-win |
| 3 | Math | Use squared distance for threshold tests | 1.53 | 1.36 | 1.125× | accepted |
| 4 | Math | Inline hot clamp operation | 0.78 | 0.84 | 0.924× | rejected-no-win |
| 5 | Math | Cache reciprocal rest length | 0.74 | 0.72 | 1.032× | accepted |
| 6 | Math | Use scalar vector temporaries | 1.81 | 0.77 | 2.352× | accepted |
| 7 | Math | Avoid destructuring hot vectors | 1.20 | 0.72 | 1.671× | accepted |
| 8 | Math | Avoid temporary arithmetic objects | 0.76 | 0.76 | 0.991× | rejected-no-win |
| 9 | Math | Specialize normal-vector normalization | 216.39 | 21.71 | 9.969× | accepted |
| 10 | Math | Hoist repeated fixed coefficients | 0.63 | 0.82 | 0.775× | rejected-no-win |
| 11 | Data layout | Convert particle AoS to SoA | 1.63 | 0.71 | 2.273× | accepted |
| 12 | Data layout | Pack cloth constraints into typed arrays | 2.98 | 1.68 | 1.778× | accepted |
| 13 | Data layout | Pack rope segments into typed arrays | 3.14 | 1.87 | 1.673× | accepted |
| 14 | Data layout | Pack material IDs into bytes | 2.18 | 0.62 | 3.521× | accepted |
| 15 | Data layout | Pack event data into SoA ring buffers | 790.54 | 1.54 | 513.804× | accepted |
| 16 | Data layout | Use active-index list instead of scanning inactive bodies | 1.46 | 1.13 | 1.295× | accepted |
| 17 | Data layout | Use bit flags for broken constraints | 0.76 | 0.71 | 1.078× | accepted |
| 18 | Data layout | Use compact integer indices for topology | 2.96 | 1.83 | 1.615× | accepted |
| 19 | Data layout | Stream matrices directly into packed storage | 4.66 | 1.32 | 3.518× | accepted |
| 20 | Data layout | Cache static transform stream | 26.28 | 0.02 | 1215.655× | borderline |
| 21 | Allocation | Preallocate vector temporaries | 1.77 | 0.78 | 2.271× | accepted |
| 22 | Allocation | Reuse output objects | 0.76 | 0.76 | 1.005× | rejected-no-win |
| 23 | Allocation | Replace map allocation with a reusable buffer | 66.41 | 6.14 | 10.809× | accepted |
| 24 | Allocation | Compact active elements in place instead of filter | 57.36 | 7.51 | 7.642× | accepted |
| 25 | Allocation | Replace reduce callback with indexed loop | 47.12 | 5.81 | 8.106× | accepted |
| 26 | Allocation | Write vertex streams by index instead of push | 51.94 | 13.27 | 3.915× | accepted |
| 27 | Allocation | Use TypedArray.set for contiguous copies | 3.72 | 0.31 | 12.080× | accepted |
| 28 | Allocation | Grow dynamic buffers geometrically | 3.80 | 0.01 | 304.559× | accepted |
| 29 | Allocation | Use object pools for projectiles | 1.04 | 1.08 | 0.960× | rejected-no-win |
| 30 | Allocation | Batch rain spawn into packed storage | 9.38 | 5.06 | 1.855× | accepted |
| 31 | Cloth | Skip broken constraints before math | 0.69 | 0.73 | 0.951× | rejected-no-win |
| 32 | Cloth | Cache inverse rest lengths | 0.68 | 0.75 | 0.907× | rejected-no-win |
| 33 | Cloth | Separate structural constraints into contiguous arrays | 2.83 | 1.72 | 1.646× | accepted |
| 34 | Cloth | Separate shear constraints into contiguous arrays | 3.00 | 1.71 | 1.753× | accepted |
| 35 | Cloth | Separate bend constraints into contiguous arrays | 2.91 | 1.64 | 1.776× | accepted |
| 36 | Cloth | Cache UV coordinates | 8.29 | 0.02 | 372.173× | accepted |
| 37 | Cloth | Cache intact topology indices | 101.06 | 0.02 | 6361.991× | accepted |
| 38 | Cloth | Rebuild tear topology only when dirty | 102.27 | 0.02 | 5361.867× | accepted |
| 39 | Cloth | Generate interleaved surface data directly | 62.47 | 12.46 | 5.013× | accepted |
| 40 | Cloth | Decimate expensive normal regeneration when stable | 0.70 | 0.84 | 0.839× | rejected-no-win |
| 41 | Rope | Pack rope nodes into SoA arrays | 1.55 | 0.77 | 2.015× | accepted |
| 42 | Rope | Skip severed segments early | 0.76 | 0.80 | 0.955× | rejected-no-win |
| 43 | Rope | Cache segment inverse rest length | 0.71 | 0.76 | 0.935× | rejected-no-win |
| 44 | Rope | Reuse segment transform matrix | 4.55 | 1.33 | 3.412× | accepted |
| 45 | Rope | Batch all rope segment instances | 61.57 | 12.30 | 5.004× | accepted |
| 46 | Rope | Maintain active segment range | 1.46 | 1.18 | 1.237× | accepted |
| 47 | Rope | Pack anchor flags into bytes | 2.10 | 0.64 | 3.303× | accepted |
| 48 | Rope | Reuse payload integration temporary | 0.76 | 0.76 | 0.999× | rejected-no-win |
| 49 | Rope | Avoid closure allocation in segment iteration | 3.10 | 0.73 | 4.254× | accepted |
| 50 | Rope | Use squared threshold for cable break checks | 1.54 | 1.32 | 1.163× | accepted |
| 51 | Water | Swap height buffers instead of copying | 6.57 | 4.78 | 1.374× | accepted |
| 52 | Water | Split interior stencil from boundary handling | 91.67 | 44.39 | 2.065× | borderline |
| 53 | Water | Precompute grid neighbor offsets | 94.36 | 44.59 | 2.116× | borderline |
| 54 | Water | Cache grid UV coordinates | 6.01 | 0.02 | 242.436× | accepted |
| 55 | Water | Cache regular-grid indices | 115.07 | 0.00 | 60332.000× | accepted |
| 56 | Water | Fuse height and velocity coefficient setup | 0.72 | 0.77 | 0.931× | rejected-no-win |
| 57 | Water | Use squared radius for ripple injection | 1.37 | 1.18 | 1.159× | accepted |
| 58 | Water | Reuse droplet pool | 5.35 | 4.91 | 1.089× | accepted |
| 59 | Water | Batch droplet instance stream | 66.07 | 11.51 | 5.738× | accepted |
| 60 | Water | Update normals at a stable cadence | 0.63 | 0.74 | 0.850× | rejected-no-win |
| 61 | Surface mesh | Cache cloth UV stream | 7.08 | 0.00 | 2760.417× | accepted |
| 62 | Surface mesh | Cache water UV stream | 7.20 | 0.00 | 2809.524× | accepted |
| 63 | Surface mesh | Cache cloth index topology | 117.22 | 0.00 | 45725.202× | accepted |
| 64 | Surface mesh | Cache water index topology | 115.10 | 0.00 | 45440.771× | borderline |
| 65 | Surface mesh | Reuse interleaved vertex staging buffer | 67.13 | 11.52 | 5.826× | accepted |
| 66 | Surface mesh | Reuse surface-result object | 0.71 | 0.69 | 1.028× | borderline |
| 67 | Surface mesh | Pack colors into material IDs before expansion | 1.98 | 0.58 | 3.383× | accepted |
| 68 | Surface mesh | Specialize finite-difference normals | 176.83 | 14.28 | 12.379× | accepted |
| 69 | Surface mesh | Skip topology rebuild when no tear occurred | 114.03 | 0.00 | 44481.643× | accepted |
| 70 | Surface mesh | Use contiguous typed-array copies | 6.60 | 0.36 | 18.316× | accepted |
| 71 | Renderer CPU | Reuse instance staging arrays | 59.92 | 12.63 | 4.744× | accepted |
| 72 | Renderer CPU | Use geometric GPU-buffer growth | 4.64 | 0.01 | 352.064× | accepted |
| 73 | Renderer CPU | Cache static transforms | 15.50 | 0.03 | 529.734× | borderline |
| 74 | Renderer CPU | Pack material classification | 1.91 | 0.60 | 3.202× | accepted |
| 75 | Renderer CPU | Write matrices without temporary arrays | 4.71 | 1.25 | 3.774× | accepted |
| 76 | Renderer CPU | Batch effect instances | 63.89 | 11.54 | 5.536× | accepted |
| 77 | Renderer CPU | Batch rope instances | 64.95 | 12.32 | 5.274× | accepted |
| 78 | Renderer CPU | Batch droplets | 66.10 | 10.98 | 6.022× | accepted |
| 79 | Renderer CPU | Skip zero-count draw preparation | 0.77 | 0.80 | 0.964× | rejected-no-win |
| 80 | Renderer CPU | Cap debug geometry before generation | 58.02 | 8.67 | 6.688× | accepted |
| 81 | Rigid preview | Use SoA body transform state | 1.54 | 0.71 | 2.157× | accepted |
| 82 | Rigid preview | Maintain active body indices | 1.45 | 1.18 | 1.231× | accepted |
| 83 | Rigid preview | Cache static-body matrices | 11.60 | 0.00 | 4551.647× | accepted |
| 84 | Rigid preview | Pool projectiles | 5.08 | 5.18 | 0.981× | rejected-no-win |
| 85 | Rigid preview | Batch rain bodies | 8.80 | 5.60 | 1.571× | accepted |
| 86 | Rigid preview | Use squared collision broadphase checks | 1.47 | 1.28 | 1.151× | accepted |
| 87 | Rigid preview | Pack body material IDs | 2.04 | 0.60 | 3.394× | accepted |
| 88 | Rigid preview | Skip sleeping bodies before transform math | 0.77 | 0.74 | 1.036× | accepted |
| 89 | Rigid preview | Reuse transform matrices | 4.69 | 1.30 | 3.595× | accepted |
| 90 | Rigid preview | Use ring buffer for action events | 23.07 | 1.25 | 18.429× | accepted |
| 91 | Scheduling | Decimate telemetry formatting | 130.30 | 5.88 | 22.154× | accepted |
| 92 | Scheduling | Avoid per-frame callback closures | 3.20 | 0.73 | 4.365× | accepted |
| 93 | Scheduling | Use ring-buffer event queue | 24.26 | 1.11 | 21.801× | accepted |
| 94 | Scheduling | Reuse fixed-step scratch state | 0.76 | 0.77 | 0.994× | rejected-no-win |
| 95 | Scheduling | Skip inactive work before arithmetic | 0.78 | 0.80 | 0.968× | rejected-no-win |
| 96 | Scheduling | Batch spawn commands | 9.16 | 5.60 | 1.635× | accepted |
| 97 | WASM bridge | Cache typed heap views until memory changes | 12.80 | 0.00 | 5052.711× | accepted |
| 98 | WASM bridge | Stream packed transforms instead of JS objects | 1.38 | 0.77 | 1.798× | accepted |
| 99 | WASM bridge | Pack material stream into bytes | 2.15 | 0.60 | 3.554× | accepted |
| 100 | Build/runtime | Eliminate hot-loop closure creation | 3.26 | 0.74 | 4.438× | accepted |

## Interpretation

A kernel win is evidence for that implementation choice, not permission to stack all ratios multiplicatively. The release report separately measures complete scenes and validates deterministic/visual contracts.
