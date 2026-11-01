# Changelog

## Unreleased — 2026-11-01 — Engineering Studio, math runtime pilot and CI repair

### Integrated work

- **Engineering Studio** (`bridge-water-20261003`): `index.html` now opens the studio with eight studies — suspension bridge, canopy, metal press, and liquid, glass, concrete, elastomer and granular labs. The bridge adds configurable experiment scans (load, strength or crosswind; 3–9 cases; 15–120 s recordings; follow-up scans; sample CSV). Falling bridge pieces now interact with the river: buoyancy, drag, downstream drift and riverbed contact, with splash, ring, foam and spray visuals.
- **Studio media** (`backup/offload-20261004`): textures, models and reference images; rebuilt `box3d.wasm` and new `box3d-mt.wasm` matching `BUILD_PROVENANCE.json` (the committed `box3d.wasm` was stale); design and QA evidence images and logs.
- **Math runtime pilot** (`codex/math-runtime-water-pilot-20261031`, based on a review of the `openai/math` catalogue published 2026-10-06): incremental execution graph, planned resident water, optional GPU water solver, conservative transformed-box visibility with stable prefix-sum lists and indirect draws, dependency-checked shadow reuse with empty-caster clears, the orthographic zero-to-one depth fix and the CPU/GPU material-rounding fix. A fresh review of the same catalogue revision found no further result that applies to this code.
- **Oct 3 batches**: input validation and the NaN-safe hash (`claude/correctness-fixes-enhancement-lists`), six speed and visual changes (`claude/speed-visual-accuracy-batch1`), and the cloud-readiness notes.

### Renderer integration

- Instance drawing prefers GPU visibility lists (opt-in `computeVisibility`), then the material partition (opt-in `instancePartitioning`), then direct instancing.
- One shadow cache (on by default, toggleable). It checks caster material, path and initialization and clears when casters vanish; `shadowCacheInfo()` reports its counters.
- Visibility resources follow instance-capacity growth instead of keeping bindings to replaced buffers.
- `useGpuWater()` and `uploadResidentWater()` each reset the other path.

### Fixes

- CI has failed since 2026-08-14. Rope batching is now qualified against the same source's legacy per-constraint cadence: the archived v1.9.0 reference became unreachable when rope drag was made time-step scaled. That exposed real divergence, so batching at maximum stress now excludes rope variants 2, 3 and 5; the 23 remaining batched combinations are bit-exact over 720 frames.
- The self-test validates the studio shell. Projection-depth, studio floor and non-press trajectory tests reflect texel-snapped shadows, riverbed contact and cross-platform float noise.

### Benchmarks

- [`docs/BENCHMARKS_MERGE_20261101.md`](docs/BENCHMARKS_MERGE_20261101.md) compares this branch with `main` on a CPU host and an NVIDIA L4. Results:
  - Renderer: every image check passes against a colour-matched control, and GPU time per frame is 33–45% lower in five of six scenes.
  - Native engine: unchanged speed, and trajectories are bit-identical.
  - Soft bodies: unchanged except 15 rope scenes, which are 13–20% slower on the exact cadence.
  - GPU-resident water: up to 217× faster than CPU water plus upload.
- `benchmarks/merge-20261101` holds the harness, raw results and the generated summary.
- Harness changes:
  - The renderer runtime test now also passes with instance partitioning on.
  - The GPU harnesses gained a `--hardware-vulkan` browser profile and a colour-pipeline control baseline.
  - Dawn scripts now read `WEBGPU_DAWN_BACKEND`.

### Known issues

- The AAA Physics Lab (`src/main.ts`) is no longer a page of the production build; `index.html` opens the Engineering Studio.
- Canopy contact costs 10.8 ms per step at service load, which is 0.77× real time on a 2.1 GHz cloud CPU.
- Glass lab: after fracture (about 364 shards) a CPU step can take about 1 s. `ConvexContactWorld.stepInterval` rolls the whole world back and re-runs half-steps whenever one pair needs recovery, so `tests/studio/material-labs.test.mjs` does not finish in practical time. Unchanged here.
- Twelve `tests/engine` evidence and provenance checks carried over from the Oct 3 snapshot fail. They are not part of CI.

## 1.20.0 — 2026-07-19 — AAA Material Programs Expansion

### Material demonstrations

- Added **30 authored material programs**: ten metal-forming and impact demonstrations, ten architectural and safety-glass fracture demonstrations, and ten reinforced-concrete failure demonstrations.
- Added **Apex Materials Proving Ground**, a combined AAA sequence that runs the metal, glass, and concrete rigs together in one coordinated high-bay stage.
- Kept the proven 800 deterministic physics-recipe and native scene-ID contract intact; the new presentation registry derives material-specialized presets lazily instead of renumbering the native catalog.
- Added per-program fixtures, boundary conditions, load patterns, strike locations, crack styles, camera direction, and Poliigon-derived concrete, metal, glass, and stone stage materials.

### Direction and scale

- Expanded the cinematic director from 34 to **65 hero sequences** while retaining the ten signature scenes and their exactly 100 v1.19 production improvements.
- Added target-aware combined-sequence beats so metal loading and denting, glass impact and shattering, and concrete loading, spall, and fracture can be directed independently before the final synchronized failure pass.
- Preserved the existing 800-scene browser, benchmark baselines, source-frozen performance evidence, native Box3D provenance, and the exact 100-case comparative material campaign.

### Validation and release tooling

- Added deterministic registry contracts for exactly ten metal, ten glass, ten concrete, and one combined program, including unique IDs, finite stage transforms, bounded streams, repeatable replay state, and all 65 hero timelines.
- Promoted `validate:v1.20` through the package, CI, Pages, pull-request, and publishing workflows while retaining all v1.19 soft-system, native-WASM, WebGPU, material, production-build, audit, and manifest gates.

## 1.19.0 — 2026-07-18 — 100-Item AAA Signature Production Pass

### Presentation

- Added exactly 100 numbered runtime improvements across the ten signature scenes, with ten authored architecture, lighting, engineering-forensics, safety, and story-cue upgrades per stage.
- Added backend-neutral static stage primitives to the cached effect instance stream so native Box3D WASM and deterministic preview scenes share identical presentation without changing solver state or replay hashes.
- Reserved authored stage identity ahead of transient particle allocation, keeping signature architecture visible during explosion-, rain-, and fracture-heavy beats.
- Corrected concrete crater aggregate from the woven-fabric material tag to the mineral/stone atlas path.

### Controls and direction

- Global shortcuts now ignore editable controls, key repeats, and browser/OS modifier combinations.
- Pausing simulation now freezes the cinematic clock as well as physics, preventing director events from executing against a frozen world.

### Validation

- Added an executable registry contract for exactly 100 unique ordinals, ten-per-scene ownership, finite transforms and colors, positive scales, category coverage, and runtime stage-frame construction.
- Added release/self-test/CI/publisher checks for the v1.19 gate while preserving all source-frozen performance evidence and native/WebGPU/material gates.

## 1.18.0 — 2026-07-18 — Material Impact Spectacle Pass

### Presentation

- Added dedicated material strike effects: hot metal scale/sparks, concrete dust/aggregate/rebar sparks, and glass micro-shard glints with a vertical fracture-wave ring.
- Added persistent yielded-metal strain bands, concrete crater aggregate, and luminous glass crack-edge geometry so failure remains readable after transient particles clear.
- Added distinct five-key camera tracks for overhead metal-forming inspection, low/side concrete rebar transfer, and grazing-angle glass fracture coverage.

### Validation

- Extended metal, concrete, glass, and cinematic-effect contracts to require the new persistent accent material tags, finite effect streams, and vertical glass wave geometry.
- Retained authoritative lattice state, replay hashes, fracture counts, and the frozen v1.13 performance evidence; VFX remain presentation-only and do not alter solver forces.

## 1.17.0 — 2026-07-18 — AAA Materials Destruction Pass

### Metal

- Added damage-aware galvanized sheet tiles over the compact lattice so bending, springback, permanent set, and opened tears read as a deforming surface.
- Retained the deterministic perimeter-clamped dent rig and added the material-wide `I` strike action.
- Re-directed Steel Yield-to-Rupture around proof load, plastic hinge formation, unloading, notch damage, ultimate displacement, and final permanent-set review.

### Concrete

- Added persistent ductile reinforcement constraints with independent yield, rupture, and metal presentation parameters.
- Concrete cohesive-cell separation now removes local cover tiles and emits deterministic Poliigon-atlas spall bodies.
- Re-authored the hero around service preload, flexural cracking, two physical spall events, rebar load transfer, unloading, and residual bridging.

### Glass

- Replaced the generic horizontal coupon presentation with a framed vertical reflective pane.
- Added a center-punch trigger, eight bounded radial crack fronts, damage-aware pane tiles, and up to 192 thin rotating shards retained through final inspection.
- Removed the duplicate unbreakable central glass dressing so the visible pane now follows the authoritative fracture state.

### Validation

- Added a deterministic dual-run concrete/glass contract covering localized cell failure, fragment retention, rebar persistence, bounded crack propagation, remaining topology, and finite streams.
- Expanded material telemetry with fractured-cell, live-fragment, and surviving-reinforcement counts.
- The suite now contains 26 deterministic unit tests; source-frozen v1.13 performance evidence remains unchanged.

## 1.16.0 — 2026-07-18 — Metal Bend & Dent Lab

### Added

- Added **Titan Metal Bend & Dent**, an 18-second directed hero built on the Structural Steel Impact Demo recipe.
- Added a dense 528-node perimeter-clamped metal pressure panel, a readable galvanized press frame, radial actuator loading, and deterministic centered dent strikes for steel, aluminum, and copper Impact Demo scenes.
- Added current/peak center deflection and unloaded residual-set telemetry, a **Dent Strike** command-deck control, and the `I` shortcut.
- Added a deterministic bend → unload → dent → springback contract that runs two independent simulations and verifies identical hashes, visible yield, retained set, finite GPU-expanded topology, and no rupture during the controlled strike.

### Changed

- Increased the directed hero catalog from 33 to **34** while retaining all 800 deterministic scenes and the ten-scene v1.15 signature set.
- Specialized metal Impact Demo loading from a uniform three-point band to a combined global-bend and radial-indenter field; other material recipes preserve their existing comparison path.
- Expanded material documentation and the live rig so transient indentation, springback, and permanent deformation are independently legible.

### Validation

- All 25 deterministic unit suites pass, including the dedicated 2,875-constraint bend/dent scenario and the complete 34-hero director contract.
- The v1.13 source-frozen performance evidence remains unchanged; v1.16 is a new simulation/presentation feature and does not claim an unmeasured speedup.

## 1.15.0 — 2026-07-18 — Signature AAA Materials

### Added

- Promoted ten hero scenes into a starred signature set with additional authored architecture, observation equipment, facade systems, debris, and stage dressing.
- Added Poliigon-derived weathered concrete, galvanized metal, woven fabric, and honed-stone atlases in directly uploadable ASTC 6×6 KTX2 with RGBA8 and deterministic procedural fallbacks.
- Added reflective architectural-glass shading, a new **Concrete Spall & Rebar Exposure** hero, physical concrete cover fragments, and exposed reinforcement dressing.
- Added a reproducible local material-atlas build script and a dedicated signature-scene guide.

### Changed

- Extended the existing rigid instance material word so concrete, metal, stone, and glass share the established instanced PBR pipeline without per-material draw-call proliferation.
- Textured both packed tearing cloth and GPU-resident intact cloth with the woven-fabric atlas tile.
- Rebuilt the native Box3D WebAssembly artifact with renderer material tags and signature-stage parity.
- Increased the directed hero catalog from 32 to **33** while retaining 800 deterministic scenes.

### Validation

- All 24 deterministic unit suites, 11 WGSL modules, actual renderer runtime, C17 bridge syntax, SIMD/scalar soft kernels, RGBA8 and block-aligned ASTC atlas uploads, native 800-scene double replay, and production/Pages build gates pass.
- The hardware ASTC gate caught and corrected invalid 1024px/63px ASTC 6×6 copy extents; derived atlases are now 1008×1008 and retain only the fully block-aligned compressed mip prefix on the GPU.
- Native Box3D validation covers 1,146,621 body-frames per pass and the 4,096-body ceiling with finite material-tagged streams.
- The 100-case material campaign remains deterministic and finite; concrete and glass use their existing progressive and brittle solver profiles rather than cosmetic-only break animation.

## 1.14.0 — 2026-07-18 — Material Bending and Fracture Lab

### Added

- Added 50 deterministic material-test scenes and two directed heroes, bringing the catalog to **800 scenes** and **32 hero sequences**.
- Added ten normalized comparative presets: structural steel, aluminum, copper, oak, cross-laminated timber, reinforced concrete, soda-lime glass, acrylic, elastomer, and carbon-fiber laminate.
- Added a reduced-order beam lattice with tension/compression yield and break envelopes, plastic set, cumulative damage, fatigue, anisotropy, cohesive crack fronts, and bounded impact/rain/blast coupling.
- Added a 0–200% material load rig with apply, release, cycle, keyboard controls, live thresholds, damage, failure phase, energy, break count, and replay telemetry.
- Added an exact current-source **100-case** material campaign plus material preset, deterministic action, three-backend soak, GPU presentation, and native catalog contracts.

### Changed

- Generalized the compact GPU rope segment path so material members reuse its compute-expanded main/shadow presentation while keeping fracture decisions CPU-authoritative.
- Extended the native/fallback fixture stages, catalog, state sweep, release workflows, and documentation to the sixteenth material-fracture family.
- Rebuilt the pinned native Box3D artifact for the 800-scene stage map while retaining the v1.13 1,000-case result as source-frozen historical evidence.

### Validation

- All 24 deterministic Node suites, 11 Dawn WGSL modules, KTX2 paths, native bridge contract, SIMD/scalar kernels, production build, Pages build, and zero-vulnerability audit pass.
- JavaScript, SIMD-WASM, and scalar-WASM each pass 200 scenes, 4,800 catalog frames, and 2,400 deterministic replay frames.
- The 100-case material matrix is **100/100 finite, deterministic, and monotonic**; 83 cases reach yield/damage and 69 fracture. The representative full release-gate median/p95 case time is 0.398/0.844 ms per frame for the measured solver-plus-frame scope.
- The native Box3D artifact passes two deterministic 800-scene traversals, 1,145,838 body-frames per pass, and the 4,096-body ceiling.
- Visible browser acceptance passes **800/800 scenes**, **32/32 heroes**, representative steel/glass/elastomer/composite interactions, and a zero-warning/error console.

The material coefficients are dimensionless demonstration profiles, not calibrated FEA, real design allowables, or safety certification.

## 1.13.0 — 2026-07-16 — Thousand-Case Optimization Audit

### Added

- Added a source-, harness-, registry-, artifact-, renderer-, and Metal-gate-frozen tournament with exactly **1,000 / 1,000** completed production cases and zero correctness failures.
- Added a deterministic ten-shard runner and verification-only release gate. The full run records calibrated work, balanced execution order, exact state/render fingerprints, a predeclared 22.5 ms timing floor, global multiplicity screening, and fresh-process confirmation logic for any materially slower control that survives the screen.
- Added explicit current-source qualification for two historically missed compiler-mode candidates and for a hybrid renderer scratch-cache candidate; the rejected measurements remain part of the audit trail.

### Changed

- Added an exact eight-entry MRU cache for repeated native convex-hull construction.
- Cached the preview backend's dynamic-body count, added an exact all-static step early return, and avoided clearing reset storage that scene construction immediately overwrites.
- Qualified a high-count shallow-water path, retained stable native-wrapper transform/color pointers, and cached numeric renderer configuration state.
- Kept `-O3` for both packaged soft-kernel variants: current-source SIMD `-O2` and scalar `-Os` did not clear the active-workload performance gate. Kept the current renderer cache after the hybrid scratch-cache candidate regressed unchanged cloth and water work.

### Validation

- Final classification: **165 accepted wins, 353 borderline changed paths, 360 controls, 85 changed timer-floor cases, 37 rejected no-win paths, and 0 correctness failures**.
- The timing floor excludes 203 total cases—85 changed paths and 118 controls—from aggregate claims. Across 555 timer-qualified changed CPU production paths on Apple M3 Ultra / Node 26, the point-estimate geometric mean is **1.0544254732×**. The 242 timer-qualified controls measure **1.0041104525×**.
- No eligible control met both the material-regression threshold (`candidate / baseline < 0.94×`) and the global Benjamini–Hochberg screen (`q <= 0.05`). This wording does not mean every control point estimate improved, and the CPU-path aggregate is not a whole-engine or browser-FPS multiplier.
- The complete automated gate passes 22 deterministic Node suites, JavaScript/SIMD/scalar 150-scene soft soaks, the 250-combination rope qualification, the two-pass 750-scene native Box3D soak, 11 Dawn WGSL modules with zero uncaptured errors, production/Pages builds, and the zero-vulnerability audit.
- Final browser acceptance loaded **Box3D WASM**, visibly rendered and interacted with cloth, rope, and water, and produced **0 console warnings and 0 console errors**.
- Latest post-tournament Metal measurements are stored under `benchmarks/results/post1000-hardware/`; the frozen hardware snapshots referenced by the 1,000-case result remain its benchmark-closure evidence.
- Production output is 24.89 kB HTML, 239.27 kB main JavaScript (66.26 kB gzip), and a 9.25 kB lazy TurboQuant chunk (3.18 kB gzip); the moderate-or-higher npm audit reports zero vulnerabilities.

## 1.12.0 — 2026-07-16 — Sixth Production Optimization Pass

### Added

- Added a source-frozen v1.11-versus-v1.12 production tournament with exactly 100 cases, eight balanced samples per implementation/case, 20,000 stratified-bootstrap resamples, source/harness digests, and exact deterministic fingerprints.
- Added focused exact-output gates for axis-aligned cloth/water matrices, cinematic effect drag factors, cinematic camera sampling, and the rebuilt native Box3D transform stream.
- Added a native v1.11 artifact comparator and bridge-source provenance check; promoted `validate:v1.12` throughout CI, Pages, publish scripts, and repository contracts.

### Changed

- Qualified full batched WASM projection for all five Racing Sail modes.
- Specialized zero-rotation sphere and droplet matrices while preserving float32 bits, including signed zero.
- Hoisted the five built-in effect drag powers once per update and made the cinematic camera director sample into its retained rig.
- Added a density-aware native transform synchronization path: dynamic indices for static-heavy scenes and the original sequential scan for nearly-all-dynamic scenes.
- Corrected water-rain and collider-drape benchmark coverage, build provenance, and canonical-manifest handling of user-owned Finder duplicates.

### Rejected

- Reverted fallback cached-count/traversal, rope tuple removal, indexed cube geometry, stateful camera caching, broader cloth batching, native indexed kick, and native explosion candidates when complete-path, fidelity, or linked-WASM evidence failed the release gate.
- Retained TurboQuant only for bandwidth-constrained remote/replay state because prior local Worker measurements remain slower than raw transfer.

### Validation

- Final 100-case result: **14 accepted wins, 14 borderline paths, 0 no-win rejections, 72 controls, and 0 correctness failures**; changed paths measured **1.0640× geometric mean** and **1.0477× median**.
- Dedicated exact gates measure **1.748×** cloth-sphere staging, **4.135×** 768-droplet staging, **1.093×** complete effects update/build, **1.140×** camera sampling, **1.678×** static-heavy native synchronization, and **1.157×** mixed native frame preparation.
- The tracked native artifact passes two 750-scene deterministic soaks, 1,142,268 body-frames per pass, 4,096-body capacity, invalid-timestep guards, and exact v1.11/v1.12 stream comparisons.

## 1.11.0 — 2026-07-15 — Exact Production Optimization

### Added

- Added allocation-free camera matrix writers and an exact invalidation cache, plus version-keyed main-frame diagnostic/effect line staging.
- Added exact soft-system miss rejection and right-sized retained storage; added one-time fallback static streams, broad-rejected explosions, allocation-free contact resolution, and cadence-aware replay hashing.
- Added independent native Box3D transform/material revisions, awake-state reporting, settled-world step elimination, and zero-byte unchanged uploads.
- Added a source-frozen 100-case v1.10-versus-v1.11 tournament, dedicated camera/fallback/native/Metal/fidelity gates, and machine-readable visible-browser acceptance evidence.

### Changed

- Removed the dead packed-water WGSL module and its two unreachable render pipelines, reducing the live renderer from 12 to 11 shader modules and from 18 to 16 render pipelines without changing rendered pixel hashes.
- Fixed relative-base GitHub Pages loading of the native Box3D module and WASM by resolving public assets against `document.baseURI` before dynamic import.
- Promoted `validate:v1.11` to the CI and Pages release gate, including the tracked native Box3D soak and final benchmark-evidence checks.

### Rejected

- Reverted exact shadow-depth reuse after its separately compiled active rigid CPU-submit control missed the predeclared 0.98 non-regression floor. Its dependency, exact-pixel, zero-error, and paused-frame evidence remains archived, but the candidate is not a v1.11 gain.
- Kept broader fused cloth/rope schedules, a Box3D move-event stream, and four shader candidates out of the release when they failed fidelity or stable-performance gates.

### Validation

- The final balanced tournament ran exactly 100 cases with eight timed samples per variant/case: **20 accepted wins, 2 borderline results, 4 no-win rejections, 74 controls, and 0 correctness failures**. Changed paths measured **1.067× geometric mean** and **1.090× median**.
- The complete v1.11 gate passes 21/21 deterministic unit suites, all 750 scene constructors and 30 hero definitions, JavaScript/SIMD/scalar soft soaks, native Box3D's two-pass 750-scene soak, 11 live WGSL modules, production/Pages builds, and the zero-vulnerability audit.
- A visible macOS browser run of the relative-base Pages build loaded **Box3D WASM** with SIMD soft kernels, exercised rigid bodies plus cloth, rope, and water, and passed **750/750 scenes and 30/30 hero sequences**. Evidence is recorded in `benchmarks/results/v111-visible-browser-acceptance.json`.

## 1.10.0 — 2026-07-14 — Native, Cache, and Measured-Quality Integration

### Added

- Bundled the pinned Box3D v0.1.0 Emscripten artifact, upstream license, and machine-readable build provenance; added a deterministic 750-scene native soak and invalid-timestep regression gate.
- Added real KTX2 BC4/R8 runtime upload and sampling tests on Dawn null and Metal.
- Added Metal timestamp-query quality-profile benchmarks, renderer-startup comparison, unchanged-upload microbenchmark, fresh v1.10 integration benchmark, and a reproducible v1.9 integration baseline archive.
- Added exact rope batching qualification across 250 scene/stress combinations and promoted native/rope/integration checks into `validate:v1.10`, CI, and Pages deployment.

### Changed

- Restored allocation-light effects staging, in-place compaction, reusable debug lines, and unchanged-frame identity caching.
- Added frame-version and identity caches for rigid, effect, line, surface, soft-instance, and rope streams; unchanged uploads now account for zero bytes.
- Removed dead packed-water state, reducing retained maximum-water typed memory by 28.24% and improving construction by 1.375× in the persisted run.
- Restricted the faster multi-iteration rope projection bridge to the 38 maximum-stress combinations that pass exact legacy equivalence; all other stress/layout cases retain the original cadence.
- Made quality profiles control real 1×/4× MSAA, 1,024²/2,048² shadow resources, and 1/9-tap PCF work; Performance skips shadow sampling.
- Updated TurboQuant benchmarks to consume GPU-resident cloth positions, compact rope nodes, and water `eta/u/v`; it remains remote-only after a 53.3× local Worker slowdown.
- Averaged telemetry over its five-Hz reporting interval and eliminated debug-only line-object churn.

### Validation

- Fresh v1.2-to-v1.10 maximum-detail soft workloads measure 7.342× cloth, 2.746× rope, and 13.342× water, for a 6.455× geometric mean with zero correctness failures.
- The cross-platform v1.10 gate, all three 150-scene soft backends, 12 Dawn shaders, native Box3D soak, KTX2 tests, production/Pages builds, 158-entry source manifest, and zero-vulnerability audit pass.
- The Apple Metal gate passes with zero uncaptured WebGPU errors. A visible target-browser pass remains required because the in-app Browser runtime failed before tab acquisition.

## 1.9.0 — 2026-07-14 — Validated Semantic GPU-Cloth and GPU-Rope Integration

### Provenance

- Verified the supplied v1.9 archive with SHA-256 `09fa0eec3db1858d57cdc58a9fe8f021b76cd6c19c5b8913eb9d55e1667a1fbb`.
- Determined that the archive descends from its bundled original v1.8.0 source, while this repository descends from the independently reconstructed v1.8.1 implementation.
- Ported v1.9 behavior manually instead of replacing the repository tree, preserving the current soft-kernel loader/ABI, v1.8.1 fixes, and the v1.4.1 final-presentation V flip exactly once.
- Added [`docs/INTEGRATION_V1.9.md`](docs/INTEGRATION_V1.9.md) to record the lineage, semantic mapping, validation target, and evidence limits.

### Changed

- Added adaptive intact-cloth projection ceilings: four passes for perimeter-pinned membrane drums, six for hammocks/collider drapes, and eight for other intact cloth; tearing cloth keeps the full authoritative schedule.
- Added stiffness compensation for the reduced pass schedules while retaining the current one-stream soft-kernel ABI.
- Changed intact cloth's steady dynamic stream from positions plus strain at 16 bytes per vertex to positions only at 12 bytes per vertex.
- Added immutable rest-position storage so WGSL reconstructs visual strain from current/rest geometry. The legacy strain stream remains for diagnostics and tearing compatibility.
- Added compact rope node/segment publication. Each active segment carries two node indices, inverse rest length, radius, and RGBA in eight float32 words.
- Added WebGPU compute expansion of compact rope data into the existing model-matrix and material buffers, with segment metadata refreshed only when topology changes.
- Kept cloth PBD, rope PBD, shallow-water stepping, collision selection, and break bookkeeping on CPU/JavaScript or CPU/WebAssembly. The new compute pass prepares rendering; it is not a GPU physics solver.

### Validation and evidence status

- Added `npm run validate:v1.9` as the complete integrated target gate.
- The complete manifest-sealed `npm run validate:v1.9` gate passed on July 14, 2026: 16 unit suites, deterministic SIMD/scalar rebuilds, 12 Dawn shaders, the actual renderer runtime, JavaScript/SIMD/scalar soft soaks, supplied-evidence consistency, and production/Pages builds.
- Supplied benchmark reports describe the archive's exact-release lineage, not this manual v1.8.1-derived integration.
- `bench:fifth:gate` checks recorded evidence artifacts; it is not a fresh benchmark rerun.
- Some supplied measurements are noisy or have high MAD. The evidence does not prove physical-GPU duration, visible-browser correctness, or a universal FPS gain.

## 1.8.1 — 2026-07-13 — Reconstructed GPU-Surface and Soft-Kernel Edition

### Provenance

- Reconstructed the v1.8 architecture described in the prior project conversation from the verified v1.4.1 source available in this workspace.
- The referenced v1.8 release archive was not available locally or from the configured repository, so this change does not claim a byte-identical import and does not reuse the conversation's historical speedup figures as current evidence.

### Added

- Added deterministic standalone C17 soft kernels for intact-cloth projection, rope projection, shallow-water stepping, and rope matrix/color stream generation.
- Added reproducible SIMD and scalar WebAssembly builds, a stable ABI loader, a persistent typed-array arena, and automatic SIMD → scalar → JavaScript fallback.
- Added solver-native `gpu-cloth` and `gpu-water` surface contracts with explicit grid metadata and monotonic `frameVersion` values.
- Added GPU cloth main/shadow pipelines that reconstruct position, smooth normal, UV, checker palette, strain heat, woven response, and shadow position from storage buffers.
- Added a GPU water pipeline that reconstructs geometry, normals, curvature, foam, and material response from `eta`, `u`, and `v` storage buffers.
- Added soft-kernel ABI, determinism, numerical-parity, fallback, and real-scene integration tests.

### Changed

- Intact cloth now uploads positions plus strain at 16 bytes per vertex instead of rebuilding a packed render mesh on the CPU.
- Shallow water now uploads authoritative `eta/u/v` state at 12 bytes per cell instead of rebuilding packed surface vertices on the CPU.
- Tearing cloth deliberately retains the packed topology-aware fallback so real openings remain correct.
- Rope segment model matrices and tension colors can be generated directly in persistent WebAssembly memory.
- The deterministic rigid preview now uses a coherent longest-axis sweep-and-prune broadphase with persistent typed ordering/bounds buffers.
- Cloth and rope projectile interaction now rejects whole-system AABB misses before particle-level squared-distance checks.
- Surface, topology, and soft-instance streams now use buffer identity, topology version, and frame version to skip unchanged queue writes.
- Dawn coverage now exercises 11 WGSL modules, packed and GPU surface variants, storage-buffer reconstruction, dynamic shadows, and repeated-frame zero-upload behavior.
- Preserved the v1.4.1 final-presentation V flip exactly once; camera, projection, shadows, and world-space simulation remain unchanged.

### Evidence policy

- Current claims are limited to code contracts and checks reproducible from this repository.
- Historical benchmark reports remain available as historical documents, but v1.8.1 performance should be measured again on the target device before publishing comparative speed claims.

## 1.4.1 — 2026-07-12 — Camera Orientation Hotfix

- Corrected the final HDR fullscreen pass by flipping the sampled render-target V coordinate exactly once before swapchain presentation.
- Kept the existing camera rig, pitch convention, view matrix, projection, and world-space simulation unchanged.
- Added a source regression assertion that rejects removal of the required WebGPU presentation flip.
- Replaced environment-specific npm tarball URLs in the lockfile with public npm registry URLs so clean installs remain portable.
- Revalidated WGSL compilation, Dawn pipeline creation, runtime rendering, deterministic simulation, production builds, and the live browser view.

## 1.4.0 — TurboQuant Transport Evaluation

- Added an independent blockwise TurboQuant-MSE codec with deterministic random orthogonal rotation, Gaussian Lloyd–Max codebooks, and specialized 2/3/4-bit packing.
- Added a structured randomized Walsh–Hadamard path inspired by Fast-TurboQuant for O(d log d) transforms.
- Added synchronized predictive state streams that quantize deltas from the prior reconstructed frame.
- Added real cloth, rope, and water benchmarks for size, encode/decode time, error, copy cost, worker transport, fan-out, and network break-even.
- Added a dynamically loaded in-browser TurboQuant probe for target-device measurements.
- Kept TurboQuant disabled on the authoritative solver and same-thread WebGPU upload path because local end-to-end measurements show a regression despite large byte reductions.
- Added `bench:turboquant`, `bench:turboquant:worker`, `bench:turboquant:all`, and `validate:turboquant` scripts.

## 1.3.0 — 2026-07-12 — Packed Surface and KTX2 Optimization

- Replaced the original 48-byte dynamic cloth/water vertex with a 24-byte packed format using octahedral `snorm16x2` normals, `unorm8x4` color, `unorm16x2` UVs, and `uint16` topology.
- Reduced steady packed-surface traffic by **66.12% for cloth** and **66.39% for water** while caching topology until it changes.
- Added directly uploadable KTX2 BC4 material noise with R8 and deterministic procedural fallbacks; measured **49.73% smaller files** and **50.00% lower resident mip payload** at 30.862 dB base-mip PSNR.
- Added structure-of-arrays constraints, precomputed stiffness/break data, reusable simulation/frame buffers, shallow-water buffer swapping, in-place particle compaction, and geometric renderer buffer growth.
- Parallelized shader diagnostics and asynchronous pipeline creation, while recording local startup/fetch-overlap results as borderline or neutral rather than claiming a universal speedup.
- Retained packed topology-aware rendering for tearing cloth. Later releases superseded the intact cloth and water packed-vertex paths with smaller GPU-resident presentation streams.
- Rejected reciprocal cloth correction, separate final strain traversal, rope delta reuse, and non-water telemetry throttling when measurements failed the performance gate.
- See `docs/PERFORMANCE_V1.3.md` for the integrated workload, traffic, asset-quality, and rejected-candidate evidence.

## 1.2.0 — Performance Engineering Edition

- Added a reproducible 100-candidate optimization benchmark suite with raw JSON and CSV evidence.
- Added baseline-versus-optimized whole-project timing with medians and MAD noise reporting.
- Added allocation-free performance primitives, geometric capacity growth, and fixed ring-buffer utilities.
- Specialized side-effect-free vector-length and square operations in validated hot paths.
- Retained packed soft-body data layouts and cached cloth topology from the optimization branch.
- Added permanent `bench:100`, `bench:end-to-end`, `bench:all`, and `validate:performance` gates.
- Documented accepted, borderline, rejected, and future architectural candidates without multiplying unrelated benchmark ratios.

## 1.1.0 — cloth, rope, and interactive water edition

### Added

- 150 deterministic soft/fluid scenes: 50 cloth, 50 rope/rigging, and 50 water scenarios.
- Six directed hero demonstrations: Tempest Standard Protocol, Parachute Canopy Failure, Sky Crane Cable Failure, Suspension Cable Resonance, Tsunami Research Array, and Leviathan Impact Basin.
- Deterministic position-based cloth with structural, shear, and bend constraints; multiple pin layouts; wind; collision; strain visualization; controlled tearing; and topology holes.
- Deterministic rope/cable PBD with anchors, payloads, bend links, catenaries, cross-links, tension coloring, projectile severing, and controlled breakage.
- Interactive 2.5D linear shallow-water simulation with height/velocity fields, reflected boundaries, waves, wakes, fountains, rain, dam-break fronts, vortices, floaters, foam, and impact displacement.
- Indexed dynamic-surface upload path for cloth and water, including dedicated surface-shadow, woven-cloth, and translucent-water WebGPU pipelines.
- Soft-system command-deck telemetry for solver type, nodes, constraints/cells, broken links, energy, and combined replay hash.
- `npm run test:soft-soak` for all 150 soft/fluid scenes and paired deterministic deep replays.
- `npm run test:cbridge` for strict C17 bridge syntax/API-contract validation with warnings as errors.
- Detailed cloth/rope/water architecture and validation documentation.

### Changed

- Catalog expanded from 600 to 750 scenes and from 12 to 15 families.
- Hero director expanded from 24 to 30 authored sequences.
- Dawn validation expanded from five to eight WGSL modules and now covers indexed cloth/water draws.
- Renderer runtime test now uploads and renders real cloth and water surface frames.
- Soft solvers preallocate hot-path buffers and precompute constraint stiffness to avoid large per-frame allocation churn.
- Source-manifest verification now works with either GNU `sha256sum` or macOS `shasum`.

### Validation

- 11 deterministic Node suites pass.
- All 750 scenes construct and step; all 30 hero definitions validate.
- All 150 soft/fluid scenes pass finite-stream, topology, budget, action, and replay checks.
- Long-run preparation soaks covered 6,000 cloth, 9,000 rope, and 12,000 water frames without numerical corruption.
- Eight WGSL modules and the complete rigid/cloth/water frame graph pass Dawn validation with zero uncaptured errors.

## 1.0.2 — full WebGPU frame-validation hotfix

- Fixed a render-pass compatibility error discovered after the 1.0.1 shader correction: the atmospheric sky pipeline was used in a `depth24plus` render pass without declaring a matching depth/stencil state.
- Added `depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }` to the sky pipeline so it shares the HDR pass safely without modifying depth.
- Added a Dawn-backed `npm run test:webgpu` gate using the null backend. It compiles all five WGSL modules, creates the shadow, sky, solid, line, RGBA post, and BGRA post pipelines, validates bind groups and attachments, and submits a complete offscreen shadow/HDR/post frame.
- Added a second Dawn test that transpiles and executes the actual `WebGPURenderer` class with a canvas-context shim, rendering one shadowed/debug-line frame and one resized no-shadow/zero-instance frame.
- Added a repository regression assertion for sky-pass depth compatibility.
- Fixed an illegal shadow-pass feedback loop: the writable depth map was also present in the scene sampling bind group. The shadow pass now uses a separate uniform-only layout and bind group.
- Added regression assertions that the shadow pass binds only the isolated shadow uniform group.
- Skipped zero-instance solid draw calls to remove Dawn diagnostics and avoid needless command encoding in empty scenes.
- Independently reproduced the original 1.0.0 `textureSampleCompare` failure in Dawn and confirmed that the 1.0.2 solid shader compiles with zero messages.

## 1.0.1 — WGSL shadow validation hotfix

- Fixed startup failure on strict WebGPU implementations where the PBR solid shader rejected `textureSampleCompare` in non-uniform fragment control flow.
- Replaced the shadow-map PCF lookup with `textureSampleCompareLevel`, which does not compute derivatives and has no uniform-control-flow requirement.
- Removed the per-fragment early return from the shadow lookup and masks out-of-bounds projections with `select`/`mix` after sampling.
- Added repository self-test assertions to prevent reintroducing derivative-sensitive `textureSampleCompare` in the solid shader path.

## 1.0.0 — 2026-07-10 — AAA Physics Lab Edition

### Added

- 24 directed hero demonstrations layered over the 600-scene capability catalog.
- Timed camera tracks, captions, impulses, projectiles, explosions, stress rain,
  time dilation, camera shake, and telemetry-lock beats.
- 2,048² PCF shadow mapping, four-sample MSAA, `rgba16float` HDR rendering,
  PBR-inspired GGX lighting, atmospheric sky/fog, emissive effects, bloom,
  tone mapping, vignette, and film grain.
- Performance, Balanced, Cinematic, and Ultra render profiles with real
  resolution, shadow, and effect-budget differences.
- Deterministic cinematic effects, authored scene dressing, and 624-scenario
  in-browser validation.
- A reproducible Box3D v0.1.0 Emscripten wrapper, stable C ABI, refreshed heap
  views after WASM memory growth, and safe GitHub publishing scripts.
- Detailed demo, renderer, native-port, test, publishing, and local browser
  validation documentation.
- MIT license and third-party notices.

### Corrected

- Camera elevation now uses positive pitch consistently, keeping catalog and
  cinematic cameras above their targets rather than below the ground plane.
- Non-uniform instance scaling now uses a normalized rotation basis for normal
  transformation, preventing distorted lighting on beams and slabs.
- Native build topology now wraps Box3D as a subproject rather than inheriting
  inappropriate top-level browser thread settings.
- Emscripten heap access now refreshes typed-array views after memory growth.

### Validation

- Strict TypeScript passed.
- Nine deterministic suites passed.
- All 600 catalog scenes constructed successfully.
- All 24 hero timelines passed camera/beat validation.
- Production and GitHub Pages builds passed.
- npm audit reported zero moderate-or-higher vulnerabilities.
- Native bridge passed strict C17 syntax checking with warnings as errors.
