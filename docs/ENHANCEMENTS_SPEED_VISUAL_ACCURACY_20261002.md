# 100 enhancements: speed, visuals, math/physics accuracy (2026-10-02)

Proposals, not results. 76 items are carried from [ENHANCEMENTS_100_20261002.md](ENHANCEMENTS_100_20261002.md) (UI and CI items dropped); their speed/visuals/accuracy label is a keyword heuristic by area. 24 are new (N001-N024); every cited file:line was checked to exist, and a sample of 5 was read and matched. Nothing here is measured, and this is not a 100x claim.

Counts: accuracy 47, speed 28, visuals 25.


## Speed

### E001 Sort bodies by grid cell so neighbour reads are coalesced
- Evidence: benchmarks/results/engine-100x/runs/gpu-spheres-opt4-20261002-01 (README/CRITERIA): best sphere result 54.1 ms at 65,536 bodies, about 75x vs Box3D mt8
- Change: Add a counting sort of body indices by cell id each step and gather positions in that order.
- Acceptance: Re-run the paired sphere harness at 65,536 bodies with the same seed. Pre-register: median step time drops 10% or more, and the P3 pile hash is unchanged by tolerance.
- Confidence: LIKELY (reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E002 Workgroup shared-memory tiling for the neighbour pass
- Evidence: gpu-spheres-opt3/opt4 run folders; neighbour pass reads global memory per candidate
- Change: Stage each cell block into var<workgroup> arrays before the pair loop.
- Acceptance: Paired run vs frozen shader at 16,384 and 65,536 bodies; accept only if the control ratio stays in [0.9,1.1] and the median improves 5% or more.
- Confidence: POSSIBLE (reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E003 Active-list compaction and sleeping for settled bodies
- Evidence: gpu-cubes-20261002-01: settled 65,536 cubes cost 11.3 ms/step; Box3D with sleeping costs 0.24 ms at 16,384
- Change: Per-body sleep timer, stream-compact awake indices, dispatch over the compacted list, wake on contact with an awake body.
- Acceptance: Settled-pile scenario: step time under 2 ms at 65,536 cubes, P3 pile check unchanged, wake test passes when a sphere lands on the pile.
- Confidence: STRONG (measured gap, design reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E004 Guard dispatch sizes above 65,535 workgroups
- Evidence: Earlier session: dispatches over 65,535 workgroups were silently dropped and gave invalid timings (documented in round READMEs)
- Change: Split into 2D dispatch or loop dispatches, and assert the limit from device.limits at pipeline creation.
- Acceptance: Test that creates 70,000 workgroups of work and asserts every body is updated; harness throws on invalid dispatch.
- Confidence: KNOWN (observed)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E005 Cube SAT contact manifolds (replace single-point contacts)
- Evidence: gpu-cubes-20261002-01: cube solver fails the P3 rain-pile check; cubes only 5.7x (16,384) and 32x (65,536)
- Change: Clip the incident face against the reference face to get up to 4 points per pair.
- Acceptance: P3 rain-pile check passes at 16,384 cubes with pile height and rest drift under the pre-registered thresholds.
- Confidence: STRONG (failure measured, cause reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E006 Edge-edge contact candidates for cubes
- Evidence: Same cube P3 failure; vertex-face contacts miss edge crossings
- Change: Add edge-edge SAT axes and a closest-points step to the manifold generator.
- Acceptance: Two cubes crossed at 45 degrees settle without interpenetration over 600 steps.
- Confidence: LIKELY (reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E007 Restitution, rolling resistance and sleep hysteresis
- Evidence: Cube and sphere solvers lack these (run READMEs); Box3D has them
- Change: Add per-material restitution with velocity threshold, rolling resistance torque and separate sleep and wake thresholds.
- Acceptance: Bounce-height test within 5% of the analytic value; a rolling sphere stops within a stated distance.
- Confidence: STRONG (reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E008 Same-session paired Box3D-vs-GPU harness with CPU-time metric
- Evidence: Machine load average 70-97 contaminated wall-clock numbers; gpu-spheres-paired-20261002-01
- Change: One script runs Box3D mt8 and the GPU solver interleaved in the same process and reports ratios with a control.
- Acceptance: Control ratio inside [0.9,1.1] across 10 repeats; a JSON result file with raw samples.
- Confidence: STRONG (measured problem)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E009 Document the 4,096 vs 65,536 body-cap difference in every comparison
- Evidence: wasm/box3d_web.c B3W_MAX_BODIES=4096 (per docs); GPU runs use 65,536 bodies
- Change: Add a "capacity and tier" line to each benchmark README and the result JSON, and reserve a 65,536 pool for Box3D runs.
- Acceptance: check script fails a result JSON without capacity fields for both engines.
- Confidence: KNOWN (docs)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E010 Add CPU-time (process.cpuUsage) metric to benchmark-strain.mjs
- Evidence: Measured control ratio 0.97-1.02 for CPU time versus 0.85-1.16 for wall time (benchmarks/experiments/m008-pass0-hoist-20261002/results-cpu.jsonl)
- Change: Record cpu user+system per sample alongside wall time and gate on the CPU ratio.
- Acceptance: Run under artificial load; CPU control ratio stays within 0.9-1.1 where wall does not.
- Confidence: KNOWN (measured)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E011 Make drag dt-consistent (exponential, not per-step)
- Evidence: benchmarks/experiments/m-qual-time-step-20261002/results.json: M024 FAIL (drag applied per step); src/studio/physics.ts step functions
- Change: Replace v *= (1-c) per step with v *= exp(-c*dt). Keep a legacy backend flag so checkpoints stay reproducible.
- Acceptance: node benchmarks/experiments/m-qual-time-step-20261002/qualify.mjs reports M024 PASS (settling behaviour at dt 1/60 and 1/120 within its pre-registered tolerance).
- Confidence: STRONG (defect measured, fix reasoned)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E012 Scale the per-step displacement clamp by dt
- Evidence: m-qual-time-step-20261002 M025 FAIL; clamp is per step
- Change: Express the clamp as a max velocity and multiply by dt.
- Acceptance: qualify.mjs M025 PASS.
- Confidence: STRONG
- Source: ENHANCEMENTS_100 (category by heuristic)

### E016 Integrate exact integrate/collide hoists through the step generator once a quiet gate passes
- Evidence: benchmarks/experiments/m008-pass0-hoist-20261002/README.md: bit-exact, 0-6% faster, speed gate not passed
- Change: Apply candidate-round3.diff via scripts/generate-studio-scaled-step.mjs, not by hand.
- Acceptance: Quiet-machine paired CPU run shows 3% or more with control in [0.9,1.1], and exportCheckpoint hashes match.
- Confidence: POSSIBLE (gate not passed)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E018 Interpolation alpha ignores sim speed
- Evidence: src/studio/main.ts:505-531 (alpha at 519-520)
- Change: Divide the accumulator by the effective step interval and clamp alpha to [0,1].
- Acceptance: Unit test drives FixedFrameClock at 0.25x and 4x; alpha stays in [0,1] and rises monotonically between steps.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E020 Remove per-contact allocations in canopy-contact hot loop
- Evidence: src/studio/canopy-contact.ts:62-63, 68, 76, 80, 92, 96, 111
- Change: Preallocate scratch vectors and use scalar locals.
- Acceptance: Canopy step output bit-identical; node --trace-gc over 10k steps shows no young-gen growth from this file.
- Confidence: KNOWN (allocation sites reported); gain unmeasured
- Source: ENHANCEMENTS_100 (category by heuristic)

### E024 Parse and validate checkpoint text once on import and export
- Evidence: main.ts:289-338; src/studio/checkpoint-file.ts:7
- Change: Pass the parsed object down; compute the size check once.
- Acceptance: Spy test: one JSON.parse and one readCheckpoint per import.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E029 Numeric keys in SurfaceTopology rebuild
- Evidence: src/studio/surface-topology.ts:17-39 (string-keyed Map)
- Change: Key by a*N+b or sort edge pairs in a typed array.
- Acceptance: Identical exposed output across a fracture sequence; benchmark shows lower time.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E039 Replace the fixed X-axis sweep in convex-contact candidates()
- Evidence: src/engine/convex-contact.ts:358-380
- Change: Choose the axis by centre variance as fallback.ts does, or use a grid.
- Acceptance: 500 stacked boxes: pairs tested at most 3x actual overlaps (add a counter).
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E040 Remove indexOf and string keys from the convex-contact loop
- Evidence: convex-contact.ts:422 and 518 (this.bodies.indexOf(c.a), I re-read both lines), 440 and 576 (string keys)
- Change: Store the index on each body; use numeric keys.
- Acceptance: Counter test shows zero indexOf calls; the state hash is unchanged.
- Confidence: KNOWN (lines verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E054 Pair the JS glue and WASM binary with a content hash
- Evidence: wasm.ts:149-158; BUILD_PROVENANCE.json; deploy/railway/Caddyfile:30 mitigates only that host
- Change: Inject provenance sha8 via a vite define and append ?v= to both URLs.
- Acceptance: Built dist references box3d.js and box3d.wasm with the same v= value.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### N001 Cache or defer the CPU-generated 1024x512 sky environment map
- Evidence: src/studio/lighting.ts:12-29: skyTexture fills a 1024x512 (524,288 texel) Uint16 half-float map on the CPU, running a 5-octave cloudNoise loop (line 25-26) per texel with d.y>.025 and allocating a new T.Color per cloudy texel (line 29).
- Change: Cache the generated texture per sky-preset key, hoist the Color allocation into a reused scratch object, and generate the map incrementally/lazily (or in a worker or a one-off GPU compute pass) so preset switches do not stall a frame.
- Acceptance: In the browser, wrap skyTexture() with performance.now() for each preset and record cold vs cached time; the cached second call must return the identical texture object in <1 ms and the per-preset cold time must drop after removing per-texel allocation. Current cost is unmeasured.
- Confidence: STRONG: per-texel allocation and a fixed 5-octave loop over ~half a million texels is visible in the source; the actual millisecond cost has not been measured.
- Source: new, file:line verified to exist

### N002 Compute soft-cloth kinetic energy lazily instead of every step
- Evidence: src/soft/simulations.ts:1110 calls computeEnergy(dt) at the end of every step(); src/soft/simulations.ts:1358-1369 loops all particles reading positions and previous to sum v^2. The value is only consumed by telemetry at src/soft/simulations.ts:1577 and :1647, while the hash is already throttled by a countdown at :1111-1114.
- Change: Make energyValue a lazy getter evaluated only when telemetry is requested for the current frameVersion (the telemetry result is already memoised by frameVersion at :1570), or recompute only on the hashCountdown cadence.
- Acceptance: Run the cloth soak (scripts/soft-simulation-soak.cjs) with a counter in computeEnergy: calls per 1000 steps must drop from 1000 to the number of telemetry reads, with unchanged reported energy at read time. CPU saving unmeasured.
- Confidence: KNOWN for the redundancy (the call site and the consumers are in the source); the size of the saving is unmeasured and depends on node count.
- Source: new, file:line verified to exist

### N003 Half-resolution bloom bright-pass with separable blur instead of 4/8 full-resolution taps in the post pass
- Evidence: src/webgpu/renderer.ts:1449-1459: bloom samples the full-resolution HDR texture at 4 (or 8 when qualityModes.y>1.5) fixed offsets of texel*3.0 and recomputes the bright-pass mask per tap, for every output pixel. The effective bloom radius cannot grow without adding taps.
- Change: Add a half- or quarter-resolution rgba16float bright-pass target and a separable 5-9 tap blur, then composite one bilinear sample in the post pass. This also makes a larger, smoother bloom affordable.
- Acceptance: GPU timestamp query (feature-gated, as in scripts/webgpu-renderer-runtime-test.mjs style tests) comparing post-pass time at 1080p and 4K before/after; visual diff must show no banding. Current post-pass cost is unmeasured.
- Confidence: POSSIBLE: the tap count and full-res sampling are KNOWN, but with only 4-8 taps the pass may already be cheap on target GPUs; benefit is unmeasured and may be mainly quality.
- Source: new, file:line verified to exist

### N004 Replace Math.hypot with Math.sqrt of the already computed squared distance in soft-body hot paths
- Evidence: src/soft/simulations.ts:1291-1292 computes distanceSquared and then calls Math.hypot(dx,dy,dz) for the same value; same pattern at :1394-1395 (explode). Math.hypot in V8 is a slower, overflow-safe routine than a single sqrt. (Note MATH_SPEED_100 M009 covers a different norm kernel for studio punches, not these soft loops.)
- Change: Use Math.sqrt(distanceSquared) where the squared value is already in range (the early-out tests at :1291 and :1394 already bound it), and keep hypot only for unbounded inputs such as projectile velocity.
- Acceptance: Micro-benchmark the cloth solveCollisions with the sphere collider on a 128x128 grid before/after; hash from quantizedHash (:1112) must be unchanged to within the 1/1000 quantisation. Speedup unmeasured.
- Confidence: LIKELY: Math.hypot being slower than sqrt is well known, but the share of frame time in these two loops is unmeasured.
- Source: new, file:line verified to exist

### N005 Spatially cull cloth particles per projectile rather than scanning all particles each substep
- Evidence: src/soft/simulations.ts:1325-1356: collideProjectiles recomputes particle bounds (computeParticleBounds, :1326) every substep and then for each overlapping projectile loops all this.count particles (:1335) with a squared-distance test.
- Change: Reuse a per-substep uniform grid over the cloth lattice (cols/rows are known), or restrict the loop to the grid index window under the projectile's AABB; cache bounds until positions change.
- Acceptance: Benchmark 1, 8 and 32 simultaneous projectiles on a 128x128 cloth with a counter of distance tests per step; tests must fall from count*projectiles to the local window while the quantizedHash after 300 steps stays within tolerance. Unmeasured.
- Confidence: POSSIBLE: complexity gain is real for many projectiles, but projectiles are usually few and the early bounds rejection at :1330 already removes most work.
- Source: new, file:line verified to exist

### N006 Lift the shallow-water Courant cap per scheme so larger timesteps need fewer ticks
- Evidence: src/engine/linear-water.ts:11-12 rejects any step with dt*sqrt(g*h)*hypot(1/dx,1/dz) > 0.8 for every scheme; src/webgpu/linear-water.ts dispatches 4 kernels per tick and up to 120 ticks per submit. The closed staggered C-grid scheme (src/engine/closed-water.ts) is a leapfrog scheme whose theoretical limit is higher than the collocated forward-backward one, yet shares the 0.8 limit.
- Change: Derive and expose a per-scheme Courant limit (with a safety factor), validate it with an energy-growth test at 99% of the limit, and let the scheduler take fewer, larger ticks where the scheme allows.
- Acceptance: Run a 10,000-tick energy-drift test at Courant 0.8, 0.95 and 1.0 for each scheme (CPU engine, no GPU needed); adopt a limit only if total energy is non-increasing. The theoretical limits are derived by reasoning and have not been measured here.
- Confidence: POSSIBLE: stability bounds come from analysis, not measurement; the nonlinearity clamp (±1.65) and drag may change the real limit.
- Source: new, file:line verified to exist

### N007 Avoid per-call array literal and for-of iteration in the fallback per-substep hot loop
- Evidence: src/physics/fallback.ts:1097 iterates `for (const axis of [0, 2] as const)` inside solveBounds which itself runs for every body on every substep (:1085-1111); integrate (:1067) likewise uses for-of over this.bodies.
- Change: Unroll the two axes (or hoist a module-level constant), and use indexed loops over the bodies array.
- Acceptance: Run the fallback physics bench (several hundred bodies, 8 substeps) with the Chrome allocation profiler: young-generation allocations per frame must reach zero from this path. Throughput gain unmeasured.
- Confidence: POSSIBLE: V8 may already escape-analyse the literal; the allocation is visible in source but its cost has not been measured.
- Source: new, file:line verified to exist

### N008 Make the 3x3 PCF shadow loop cheaper with hardware PCF or a fixed Poisson subset and early-out
- Evidence: src/webgpu/renderer.ts:324-366 (sampleShadow) executes a 3x3 loop of comparison samples for every lit fragment and the surface variants at :160-195 and :685-717 repeat the same loop with different bias/kernel. Fragments with nDotL<=0 or far outside the light frustum still reach the loop only after partial setup.
- Change: Early-out when nDotL<=0 and when the shadow coord is outside [0,1]; use one bilinear comparison tap (textureSampleCompare with a linear comparison sampler) as a pre-test and only run the full kernel in penumbra (taps disagree).
- Acceptance: GPU-timestamp the main pass in a shadow-heavy scene before/after and require pixel difference below 1/255 outside penumbra; cost unmeasured.
- Confidence: POSSIBLE: dynamic-branch savings depend on shadow coverage; unmeasured and may be neutral on tile-based GPUs.
- Source: new, file:line verified to exist


## Visuals

### E060 Mark per-instance varyings @interpolate(flat)
- Evidence: src/webgpu/renderer.ts:217-224 (VertexOut color, materialUv), ShadowVertexOut ~590; grep for "@interpolate" finds none (I ran it)
- Change: Flat-interpolate color (carries material id and emissive energy) in solid, transparent and shadow shaders.
- Acceptance: Golden-frame diff identical for non-emissive scenes; no round(-a) flicker.
- Confidence: KNOWN (absence verified); LIKELY (gain)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E061 Vertex-only shadow pass fed by the opaque partition
- Evidence: renderer.ts:605-615 (discarding fsMain), 3329-3357 (unpartitioned draw) vs 3386-3394 (indirect)
- Change: Drop the fragment stage and use the opaque indirect draw, or collapse non-casters in the vertex stage.
- Acceptance: gpuTimingInfo().latest.passMs.shadow drops on a 100k-instance scene; shadow map unchanged for opaque scenes.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E062 Draw the sky last so early-z can reject covered pixels
- Evidence: renderer.ts:3375-3377, 2289 (depthCompare always), skyShader 1322-1383
- Change: Draw at z=1 with less-equal after opaque; replace pow(x,2.0) with x*x.
- Acceptance: Main-pass GPU ms drops on dense scenes; golden diff zero.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E063 Cache canvas size instead of reading layout every frame
- Evidence: renderer.ts:2633-2651, 2709, 3282 (clientWidth/Height inside resize(), called twice per frame)
- Change: ResizeObserver with devicePixelContentBoxSize; resize only when dirty.
- Acceptance: Chrome trace shows 0 forced layouts from resize() in steady state.
- Confidence: KNOWN / LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E064 Skip unchanged scene-uniform writes
- Evidence: renderer.ts:2706-2731 (52 floats, writeBuffer unconditional)
- Change: Keep a shadow copy and skip queue.writeBuffer when equal; gate configureQuality on change.
- Acceptance: A paused scene makes 0 uniformBuffer writeBuffer calls per frame.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E065 Quantise resolution-governor steps to avoid reallocating attachments
- Evidence: src/main.ts:4145 (0.05 steps), renderer.ts:2656-2699 (destroys and recreates depth, MSAA colour, HDR); about 66 MB at 1080p reported
- Change: Use 4-5 discrete scales or allocate once at max and use a viewport sub-rect; wrap in an error scope.
- Acceptance: createTexture calls per minute during a governor sweep drop to 5 or fewer.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E066 Install a uncapturederror handler
- Evidence: grep for uncapturederror|onuncaptured in src returns 0 (I ran it); error scopes only at renderer.ts:2538-2545
- Change: Add the listener in create(); count and surface the last message in dataset diagnostics.
- Acceptance: A forced validation error is reported in a test.
- Confidence: KNOWN (verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E067 Stop encoding and submitting after device loss
- Evidence: renderer.ts:3278-3283 checks only disposed; deviceLoss is set at 3523 but read only at 2572 (I grepped it)
- Change: Early-return from render()/upload* when deviceLoss is set; expose isLost().
- Acceptance: Mock device.lost resolution makes later render() calls return 0 without touching the queue.
- Confidence: KNOWN (reads verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E068 Drop the 256-byte row padding in KTX2 uploads
- Evidence: src/assets/ktx2.ts:105-133 (align256 at 105, used at 119); 256 rule applies to copyBufferToTexture, not queue.writeTexture
- Change: Pass level.data with the tight bytesPerRow; delete align256 and the repack loop.
- Acceptance: Unit test: a 126x126 ASTC level upload allocates no new Uint8Array; atlas identical.
- Confidence: STRONG (verify on a strict implementation)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E069 KTX2 mip filter can shift mip indexes
- Evidence: ktx2.ts:142-154 (.filter) and :162 (array index used as the mip index)
- Change: Use takeWhile semantics and validate the base level.
- Acceptance: A 54-wide ASTC 6x6 chain yields a mip count equal to the aligned prefix.
- Confidence: STRONG (edge case, reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E070 Validate KTX2 header and level sizes
- Evidence: ktx2.ts:79-102 (faceCount, layerCount, pixelDepth not read; level byteLength not compared)
- Change: Reject cube, array and 3D textures and mismatched level sizes with a clear error.
- Acceptance: Truncated level and faceCount=6 inputs both throw.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E071 Make KTX2 fallback real with error scopes and free partial textures
- Evidence: ktx2.ts:155-162, 287-291, 306-307, 324-327
- Change: pushErrorScope(validation) around create and upload; destroy partial textures on failure.
- Acceptance: An invalid upload falls back to the procedural atlas with no leaked texture.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E072 One bad GPU timestamp pair should not disable timing
- Evidence: src/webgpu/gpu-timing.ts:255-272, 245-250, 139
- Change: Count invalid samples and trip only after N consecutive failures.
- Acceptance: Inject one start>end pair: status stays ready and later samples complete.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E073 Time the water compute pass
- Evidence: src/webgpu/linear-water.ts:147-157 submits its own pass; I grepped it and it has no timestampWrites; PASSES lacks water (gpu-timing.ts ~66)
- Change: Add a water pass slot or accept external timestampWrites.
- Acceptance: passMs.water is non-null when water is active.
- Confidence: STRONG (no timestampWrites verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E074 Feed the governor one consistent metric
- Evidence: src/main.ts:4141-4146 mixes GPU pass sum and CPU encode time; src/perf/runtime.ts:49-63 fixed 16.667 ms target
- Change: Use GPU+CPU or the rAF interval; derive the target from measured refresh.
- Acceptance: A steady 10 ms stream never triggers a downscale; a 25 ms stream does within 12 samples.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E075 Track GPU pass times in the percentile tracker
- Evidence: src/perf/frame-clock.ts:30-51; main.ts:359 creates only step, staging, renderCpu, frame
- Change: Add gpuShadow, gpuMain, gpuPost, gpuCompute stages.
- Acceptance: engineTimings dataset includes GPU stages with p95.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E076 Pool particle objects and reuse the camera-shake sample
- Evidence: src/effects.ts:106-123 (and 147, 179, 220, 266, 303, 327), 404-415
- Change: Free-list with SoA Float32Array; reuse one CameraShakeSample.
- Acceptance: A 3000-particle burst shows near-zero young-gen allocation in a heap profile.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### N009 Make the sky sun disc and stars follow the camera view direction
- Evidence: src/webgpu/renderer.ts:1334 places the sun at screen UV vec2(0.68 - lightDirection.x*0.22, 0.72 + lightDirection.y*0.08) and :1340 hashes stars from floor(uv*vec2(1100,620)); both depend only on screen coordinates, so orbiting the camera never moves the sun or stars relative to the world while the scene's shadows and specular do.
- Change: Reconstruct the world view ray per pixel from the inverse view-projection (add to SceneUniforms), compute sun glow from dot(viewDir, -lightDirection), and hash stars from a direction cell (octahedral or cube mapping) so the sky is anchored to the world.
- Acceptance: Playwright/headless capture at two camera yaws 90 degrees apart: sun pixel centroid must move out of frame consistently with lightDirection projection, and shadow direction must point away from the sun disc. Compare with projected sun position computed in JS to within 2 px.
- Confidence: KNOWN: the code derives the sun purely from screen UV (lines read directly); the visual mismatch follows from that.
- Source: new, file:line verified to exist

### N010 Snap the shadow light view to shadow-map texel increments to stop shimmering when the camera pans
- Evidence: src/camera.ts:118-132 rebuilds the light view whenever target changes by any amount (lightEye = target - lightDir*92, then mat4LookAtInto), and :105-114 uses an orthographic extent of clamp(distance*1.35,34,86) over a 2048 map (renderer.ts:2030-2036), i.e. ~0.033 to 0.084 world units per texel; the light-space origin moves in continuous sub-texel steps.
- Change: Transform the target into light space, round x/y to the texel size (2*extent/2048), transform back, and use that snapped target for the light eye; keep the extent quantised so zoom does not resample continuously either.
- Acceptance: Capture two frames after panning the target by 0.4 texel; the diff in shadow-edge pixels must be zero with snapping and nonzero without. Add a CPU unit test that the light view translation is a multiple of texel size.
- Confidence: STRONG: the continuous sub-texel light-origin motion is in the source; shimmer severity is not measured but the cause is the standard one.
- Source: new, file:line verified to exist

### N011 Unify shadow bias and add normal-offset or texel-scaled bias across solid, surface and cloth shaders
- Evidence: src/webgpu/renderer.ts:346 uses bias max(0.00004, 0.00028*(1-nDotL)) while :700 uses max(0.00005, 0.00036*(1-nDotL)) and :175 (sampleGpuSurfaceShadow) 0.00005/0.00036 with a 1.05 texel kernel; pipeline raster bias is depthBias 1 / slope 1.1 / clamp 0.00035 (:2198-2231). The depth-space constants do not scale with the extent (34..86 units over 2048 texels), so acne/peter-panning changes when the camera zooms.
- Change: Replace constants with a single shared WGSL function: offset the lookup position along the surface normal by ~1.5 * texelWorldSize * (1-nDotL) and keep a small slope-scaled depth bias; pass texelWorldSize in SceneUniforms.
- Acceptance: Render a ground plane with a thin box at grazing light at minimum and maximum camera distance; count acne pixels (lit-in-shadow classification) and light-leak pixels at the contact edge, which must both stay under a fixed threshold at both zoom limits.
- Confidence: STRONG: three different constants are verifiable in source; the visible artefact at extreme zoom is not measured.
- Source: new, file:line verified to exist

### N012 Use the exact sRGB transfer functions instead of pow 2.2 for texture decode and the final encode
- Evidence: src/webgpu/renderer.ts:405 (also 733, 850, 1063, 1180) decodes vertex colours with pow(x, 2.2) and :1472 encodes with pow(color, 1/2.2); the canvas format comes from getPreferredCanvasFormat at :1953, so non-sRGB-suffixed output is encoded by hand. The 2.2 power differs from the piecewise sRGB curve in the darks (the linear segment below 0.04045).
- Change: Implement srgbToLinear/linearToSrgb helpers with the piecewise curves and use them at all decode/encode sites (or use a *-srgb canvas view format).
- Acceptance: Run a one-pixel shader test sweeping 256 encoded values through decode+encode: max round-trip error must be 0 levels; compare dark gradient (0..16) against a reference sRGB ramp image. Visual impact is small and unmeasured.
- Confidence: KNOWN: the formulas are in source and the mismatch with the standard sRGB curve is a mathematical fact; the perceptual impact is subtle.
- Source: new, file:line verified to exist

### N013 Add a deterministic interleaved-gradient dither before 8-bit output to remove sky and fog banding
- Evidence: src/webgpu/renderer.ts:1470-1472: the comment forbids time-driven grain for deterministic captures and the output is pow(clamp(color,0,1), 1/2.2) written straight to an 8-bit opaque canvas; the sky is a smooth screen-space gradient (:1313), fog uses exp falloff (:526-528), so low-gradient regions quantise visibly.
- Change: Add a static (time-independent) interleaved-gradient-noise offset of ±0.5/255 in encoded space before output, gated by a uniform so tests can disable it; deterministic across frames.
- Acceptance: Capture the sky at two identical frames: byte-identical outputs required. Compute the histogram of unique values along a sky vertical line; banding runs (consecutive identical pixels) should shorten. Banding severity is unmeasured.
- Confidence: LIKELY: smooth 8-bit gradients band without dither in general; no screenshot has been analysed here.
- Source: new, file:line verified to exist

### N014 Fix the roughly 2x direct-light energy mismatch between cloth and PBR solids
- Evidence: src/webgpu/renderer.ts:743 and :1072 shade cloth as baseColor*(ambient + vec3(3.7,3.35,3.0)*nDotL*visibility) with no 1/pi, while solids use (kD*baseColor/3.14159265 + specular)*sunRadiance(5.8,5.15,4.55)*nDotL (:485-491). Effective Lambert direct is ~3.7 for cloth versus ~1.85 for solids on the same sun.
- Change: Compute cloth diffuse with the same 1/pi Lambert and sunRadiance as solids (or a shared WGSL function), and retune ambient so the net exposure of existing scenes is preserved deliberately.
- Acceptance: Render a white cloth sheet and a white box face with identical normal and light: sampled linear radiance ratio must be within 5% (currently ~2x by arithmetic). Add this as a renderer regression test.
- Confidence: KNOWN: the two formulas and constants are in source; the ratio follows from arithmetic, although the cloth path may be intentionally brighter.
- Source: new, file:line verified to exist

### N015 Fade the cloth weave pattern with screen-space derivatives to prevent moire
- Evidence: src/webgpu/renderer.ts:728-729 and :1058-1059 compute weave = 0.5+0.5*sin(uv.x*1256.637 + ...) and weft = 0.5+0.5*sin(uv.y*942.478 + ...) with no fwidth-based attenuation; on a cloth spanning ~1 uv unit, ~200 cycles per axis are far above the pixel sampling rate at moderate distance, even with 4x MSAA.
- Change: Scale the weave contrast by 1 - smoothstep(0.25, 0.5, fwidth(uv)*frequency/(2*pi)) and fall back to the mean value at distance.
- Acceptance: Capture cloth at 5 camera distances and compute high-frequency energy (Laplacian variance) of the cloth region versus camera-orbit frame differences; temporal flicker under 1 px/frame orbit should drop. Moire occurrence unmeasured.
- Confidence: STRONG: the unfiltered high-frequency sinusoid is in the source; actual visible aliasing has not been captured.
- Source: new, file:line verified to exist

### N016 Normalise water foam curvature by cell size and derive depth tint from depth instead of eta
- Evidence: src/webgpu/renderer.ts:1139 and :1148 compute curvature = abs(sum of 4 neighbour eta - 4*eta) with no division by the cell spacing squared, so the foam threshold depends on grid resolution; :1150 mixes depth colours with clamp(eta*0.18+0.5), but eta is the surface deviation, not water depth; :1182 sunGlint = pow(nDotH,230)*vec3(14,10.5,7) is an unnormalised Blinn lobe.
- Change: Divide the Laplacian by dx*dz (pass in the water params), use depth = meanDepth + eta for tint, and normalise the glint by (n+8)/(8pi) with a fixed radiance or fold it into the shared GGX path.
- Acceptance: Render the same wave field at 64x64 and 128x128 grids: foam pixel coverage fraction must agree within 5% after the change (it differs now by construction); glint energy integrated over a sweep of roughness must stay constant.
- Confidence: LIKELY: the missing normalisation is evident from the formula; observable foam difference is not measured.
- Source: new, file:line verified to exist


## Accuracy

### E013 Make stiffness converge under dt refinement (XPBD compliance)
- Evidence: m-qual-convergence-20261002: M029 FAIL (non-converged); bridge breaks 16 links at dt 1/60 and none at finer steps
- Change: Use compliance alpha/dt^2 per constraint and scale iteration counts.
- Acceptance: qualify.mjs M029 PASS and the bridge break count is within 1 link across dt 1/60, 1/120, 1/240.
- Confidence: STRONG (defect measured), LIKELY (fix works)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E014 Fracture-onset convergence test as a gate
- Evidence: Bridge break-count dependence on dt (same folder)
- Change: Add the dt-sweep fracture test to tests/qualification and wire it into CI.
- Acceptance: npm run test:qualification fails if break count differs by more than the stated tolerance across dt.
- Confidence: STRONG
- Source: ENHANCEMENTS_100 (category by heuristic)

### E015 Wire resume-exactness (M099) into CI
- Evidence: m-qual-convergence-20261002: M099 PASS; exportCheckpoint/restoreCheckpoint at src/studio/physics.ts:706-710
- Change: Add the qualify script as a test that runs 600 steps, checkpoints, restores and compares hashes.
- Acceptance: CI job fails if the post-restore hash differs.
- Confidence: KNOWN (passes today)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E017 Add the existing generator --check to the test script
- Evidence: scripts/generate-studio-scaled-step.mjs:20 supports --check; I ran it and it exited 0
- Change: Add node scripts/generate-studio-scaled-step.mjs --check to package.json test:studio and CI.
- Acceptance: The command exits 0 now and non-zero after editing the legacy step without regenerating.
- Confidence: KNOWN (ran it)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E019 Skip re-copying an unchanged replay frame each rAF
- Evidence: main.ts:522 and src/studio/presentation-state.ts (copySnapshotInto / interpolateSnapshotInto), approximate lines
- Change: Cache the last frame index; interpolate between recorded frames when playing.
- Acceptance: Count world.update calls over 100 rAFs with a paused replay: 0 or 1.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E021 Reset or restore lastUnresolved on rollback
- Evidence: canopy-contact.ts:25,67; rollback in physics.ts:252-283
- Change: Reset at the start of each contact pass and restore on rollback.
- Acceptance: A rolled-back step followed by a clean step reports lastUnresolved = 0.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E022 Validate controls, rest, mass and plastic arrays in checkpoints
- Evidence: physics.ts:115-179 (readCheckpoint), 716-751 (applyCheckpoint)
- Change: Reject non-finite, out-of-range and wrong-length fields with a typed error before applying; apply atomically.
- Acceptance: Fuzz: NaN, Infinity, negative and wrong-length for each field throws and leaves the live sim untouched.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E023 Validate checkpoints without building a StudioRuntime
- Evidence: src/engine/studio-client.ts:153-154
- Change: Use a static readCheckpoint-only validator.
- Acceptance: Spy test: importing a checkpoint constructs zero StudioRuntime instances.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E025 Throttle Studio updateUi and redraw charts only when the ring head moves
- Evidence: main.ts:401-446; src/perf/frame-clock.ts StageTimings.inspect; recording-ring.ts map
- Change: Cache last strings, update at 10 Hz, iterate the ring without map.
- Acceptance: Count textContent and dataset writes over 600 frames: large drop; chart canvas calls fall from about 60/s to about 10/s.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E026 Restore after bfcache: pageshow handling for Studio
- Evidence: main.ts:533 registers pagehide with once:true; no pageshow handler seen
- Change: Handle pageshow with persisted and recreate the worker.
- Acceptance: E2E: back/forward navigation leaves the sim running.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E027 Surface a warning when readPress falls back
- Evidence: src/studio/press-settings.ts:84-120
- Change: Return a flagged result; do not silently normalise imported out-of-range values.
- Acceptance: A press object with NaN returns a flagged result.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E028 Emit one event per link break
- Evidence: physics.ts:597-606
- Change: Emit per-break events with link id and step; coalesce only in the UI.
- Acceptance: Two breaks in one step yield two events (or one with count 2).
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E030 Cloth and rope energy telemetry uses the wrong time scale
- Evidence: src/soft/simulations.ts:1366-1378 (cloth), 2262-2274 (rope): invDt uses the frame dt but displacement is per substep
- Change: Store the substep dt and use it in computeEnergy.
- Acceptance: Step the same scene with subSteps 1 and 2; kinetic energy of a free-falling particle differs by under 2% (reported about 4x apart today).
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E031 Apply floor friction once per substep, not per iteration
- Evidence: simulations.ts:1257-1285, 2183-2190; src/soft/material-simulation.ts:1466-1500
- Change: Use a Coulomb impulse limit once per substep; expose floor options.
- Acceptance: Cloth sliding distance within 10% for iterations 4 vs 8 and subSteps 1 vs 2.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E032 Time-scale rigid-body fallback damping, friction and heat decay
- Evidence: src/physics/fallback.ts:1067-1111, 1279-1296, 186-208
- Change: Use pow(k, dt*60); move heat decay out of syncTransforms into step.
- Acceptance: 1 s of sim at steps=1 vs 8: mean body speed ratio 0.98-1.02; calling syncTransforms twice leaves heat unchanged.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E033 Non-finite-aware, saturating hashes covering the full state
- Evidence: simulations.ts:493-504; material-simulation.ts:123-133; fallback.ts:53-63,102-108 (replayHash covers 512 bodies)
- Change: Fold the NaN bit pattern into the hash, saturate rather than wrap, share one helper.
- Acceptance: hash(state with a NaN) differs from hash(zeros); a divergence at body 600 changes replayHash.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E034 Fallback broadphase silently skips later bodies
- Evidence: src/physics/fallback.ts:1117 pairLimit = n>900 ? 420 : n>650 ? 560 : n (I re-read the line)
- Change: Cap by work or active count in a deterministic order, not by body index.
- Acceptance: 1000 dynamic bodies: a box dropped on a body with index 800 comes to rest on it.
- Confidence: KNOWN (line verified); effect STRONG
- Source: ENHANCEMENTS_100 (category by heuristic)

### E035 Remove RNG use from the pair resolver
- Evidence: fallback.ts:1297-1305 (this.rng.signed(0.02)*penetration)
- Change: Use a stateless hash of (frame, idA, idB) or drop the jitter.
- Acceptance: replayHash after the same explode() is equal with the broadphase axis forced to X vs Z.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E036 Alternate Gauss-Seidel sweep direction
- Evidence: simulations.ts:~1195-1255, 2128-2165; material-simulation.ts:1262-1292; compliant-cable.ts:164-175
- Change: Alternate direction per iteration; choose tear order by strain; mirror in the C kernel.
- Acceptance: A cloth pinned at both top corners gives a mirror-symmetric result within 1e-4.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E037 Add a fixed-step accumulator and a dropped-time counter
- Evidence: simulations.ts:1080,2063-2064,2692-2693; fallback.ts:174 (Math.min(dt,...))
- Change: Accumulate time with a max steps per frame and report dropped time.
- Acceptance: Step 1/15 s once vs 2x(1/30): equal simTime telemetry.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E038 Time-based water decay and boundary absorption with reported clamp loss
- Evidence: simulations.ts:2740-2830 (velocityDecay = 1 - drag*dt can go negative), clamp +-1.65 at 2793 and 2858; same constants in wasm/soft_kernels.c
- Change: Use exp(-drag*dt) clamped to [0,1]; report volume lost to the clamp.
- Acceptance: 2 s pool with 1 and 3 substeps: energy decay ratio within 5%.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E041 Do not drop unresolved surface-contact sweeps
- Evidence: src/engine/surface-contact.ts:354 and 378 (not converged, then continue)
- Change: Fall back to conservative advancement or clamp to the nearest feature.
- Acceptance: A fast point crossing a thin triangle with the sweep cap forced to 1 is still stopped.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E042 Honest energy units for material telemetry and time-based fragment decay
- Evidence: material-simulation.ts:2183-2232, 1102, 1719-1745
- Change: Compute 0.5*m*(dx/dt)^2 with the substep dt; use pow-based decay.
- Acceptance: Free-fall energy matches m*g*h within 3% for 4 vs 8 slices.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E043 Bounds-check constraint indices in the soft C kernel and test kernel vs JS
- Evidence: wasm/soft_kernels.c and src/soft/kernels.ts: u16 indices, no index-versus-particle_count check; f32 kernel vs f64 JS
- Change: Validate indices on the TS side (do not edit wasm/ source); add a 60-step kernel-vs-JS comparison.
- Acceptance: Position difference under 1e-3 after 60 steps on a seeded cloth.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E044 Stack scenes silently truncate at 4,096 bodies
- Evidence: wasm/box3d_web.c:610-614, 718-735, 1310-1325; src/engine/native-world.ts:428-433; stress 5 gives 28*33*5=4620 by the reporter arithmetic
- Change: JS: compare returned count with expected and throw CAPACITY_EXCEEDED; C (proposal): reserve or flag truncation.
- Acceptance: createScene({id:1},5,1) either returns 7296+1 after reserveBodyCapacity(16384) or throws.
- Confidence: KNOWN (arithmetic) for the pool; unverified for the app world
- Source: ENHANCEMENTS_100 (category by heuristic)

### E045 Reject non-finite and huge impulse, kick, explode and launch inputs
- Evidence: box3d_web.c:1500-1566; src/physics/wasm.ts:118-124; native-world.ts:310-315, 452-456
- Change: Add isfinite and magnitude bounds in JS now; in C as a proposal.
- Acceptance: Fuzz: NaN and 1e30 launches are rejected; after 1000 hostile calls every transform float is finite.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E046 Replay-hash float-to-int cast is undefined for large values
- Evidence: box3d_web.c:1568-1595
- Change: Saturate before casting or hash bits via memcpy; version the hash.
- Acceptance: 1e30 velocity then replay_hash does not trap and matches in Node and Chromium.
- Confidence: LIKELY (depends on Emscripten conversion semantics, not verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E047 Mirror the dt and substep bounds in the default backend
- Evidence: src/physics/wasm.ts:109-113 vs native-world.ts:435
- Change: Apply dt <= 1/30 and substeps 1..16 in WasmPhysicsBackend.step.
- Acceptance: step(5, 1000) is rejected and transforms are unchanged.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E048 Distinct status codes instead of one DISPOSED
- Evidence: native-world.ts:223-225, 455, 459; box3d_web.c:1500-1507, 1285-1287
- Change: Status table (OK, STALE, NO_WORLD, BAD_INDEX, NOT_DYNAMIC, CAPACITY_FULL, NOT_FINITE) mapped to EngineError codes.
- Acceptance: Full world gives CAPACITY_FULL; impulse on a static row gives NOT_DYNAMIC; stale handle gives DISPOSED.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E049 ABI layout and limits handshake beyond api_version==1
- Evidence: native-world.ts:60-61, 152, 210, 247, 261, 325, 369; box3d_web.c:20-21, 66-70, 198
- Change: Export b3w_abi_layout (proposal) and assert equality at load.
- Acceptance: A stub module with a one-field layout change fails with UNSUPPORTED_BACKEND.
- Confidence: STRONG (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E050 Typed-array views and cheaper decoding for native queries
- Evidence: native-world.ts:388-422, 272-278, 383, 399
- Change: Use typed-array views over the aligned arena and skip cast-only decode for overlap hits.
- Acceptance: native-query-check and native-query-oracle remain bit-identical; allocations per 128-input batch fall.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E051 Closest-hit early-out flag for casts
- Evidence: box3d_web.c:365-381 (callback returns 1.0f, which I re-read at line 374)
- Change: Proposal: use the reserved field as a closest-only flag and bump the query ABI.
- Acceptance: Ray through a 4096-body stack with limit 1 returns the same first hit; the visit counter drops.
- Confidence: LIKELY (line verified; effect unmeasured)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E052 Memoize the native pool module and use the threaded artifact
- Evidence: src/physics/wasm.ts:216-224; wasm/box3d_threads.c:136
- Change: Cache the module promise; load via planThreading.
- Acceptance: Two loadNativeWorldPool calls produce one factory call; cross-origin-isolated pool worlds report more than 1 worker.
- Confidence: KNOWN (repeat instantiation); STRONG (threading)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E053 Terminate pthread workers on load timeout and add dispose()
- Evidence: wasm.ts:181-214, 133-136; wasm/CMakeLists.txt:119-123
- Change: Keep the pending module reference; terminate on timeout; export PThread.
- Acceptance: Forced-timeout test: every Worker is terminated after fallback.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E055 Hash CMakeLists.txt and toolchain in build provenance
- Evidence: scripts/update-build-provenance.mjs:15-35; update-threaded-provenance.mjs:~21
- Change: Include cmake sha and toolchain in qualificationChanged.
- Acceptance: Change one comment in CMakeLists.txt on a temp copy; the script sets validation.status to not_run.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E056 Record real SIMD state in provenance
- Evidence: update-threaded-provenance.mjs (simd: true hard-coded); build-wasm*.sh accept BOX3D_DISABLE_SIMD=ON
- Change: Pass the build flag through and scan for v128 opcodes.
- Acceptance: A scalar build records simd:false and the scan finds no SIMD opcodes.
- Confidence: KNOWN (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E057 Atomic provenance write and kit drift check
- Evidence: update-build-provenance.mjs:37; packages/box3d-kit/wasm/BUILD_PROVENANCE.json differs at line 118 (reported)
- Change: Write via temp file and rename; add sync-core.mjs --check to CI.
- Acceptance: node packages/box3d-kit/scripts/sync-core.mjs --check exits non-zero now and zero after a sync.
- Confidence: KNOWN (drift, reported); LIKELY (corruption window)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E058 Explicit stack and initial memory in link options (proposal)
- Evidence: wasm/CMakeLists.txt:126-142 has neither; -sASSERTIONS=0
- Change: Add -sSTACK_SIZE and -sINITIAL_MEMORY; build a test artifact with stack overflow checks. Needs a re-pin.
- Acceptance: native-box3d-soak passes on the 800-scene catalog; HEAPU8.length equals the configured size.
- Confidence: LIKELY (stack default not verified)
- Source: ENHANCEMENTS_100 (category by heuristic)

### E059 One boundary call for renderer stream info
- Evidence: native-world.ts:217-235
- Change: Proposal: b3w_world_stream_info(handle, out*) returning one 32-byte struct.
- Acceptance: Counting stub shows boundary calls per frame fall from about 6 to 1.
- Confidence: LIKELY (reported)
- Source: ENHANCEMENTS_100 (category by heuristic)

### N017 Integrate fallback rigid-body orientation with quaternions instead of adding angular velocity to Euler angles
- Evidence: src/physics/fallback.ts:1076-1078 does body.rot[i] += body.angVel[i]*dt, treating angular velocity as the derivative of Euler angles; this is valid only for rotation about a single axis and is order- and gimbal-dependent for tumbling bodies (rot is then used for rendering).
- Change: Store an orientation quaternion, update q += 0.5*dt*omega*q (renormalise) or exponential map, and build matrices from q.
- Acceptance: Unit test: spin a free body with angVel (1,2,3) for 5 s and compare against an analytic/high-resolution reference quaternion integration; orientation error must stay under 1e-3 rad versus Euler error that grows. Also check pole case ang about y with x pitch near 90 degrees for no snap.
- Confidence: KNOWN: the update line is in source and its inconsistency for 3-axis rotation is mathematically certain (ENGINE_100X #14 only concerns presentation interpolation).
- Source: new, file:line verified to exist

### N018 Make fallback contact respect body rotation (oriented boxes) rather than AABBs
- Evidence: src/physics/fallback.ts:1206-1214 resolveAabbPair tests |dx|<=halfA+halfB per world axis only; the rendered rotation from the integrate step is ignored, so a tilted box collides as an axis-aligned box of its un-rotated half extents.
- Change: Use a SAT oriented-box test (15 axes) or, as a cheaper step, an inflated AABB from the rotated half extents, then resolve along the minimum-penetration axis.
- Acceptance: Test: a box rotated 45 degrees about y placed against a wall must contact at the rotated corner extent (sqrt(2)*half), not half; assert separation distance within 1e-3 of analytic.
- Confidence: KNOWN: the code reads only pos and half in the overlap test; whether the fallback is expected to model rotation is a product decision.
- Source: new, file:line verified to exist

### N019 Replace the fallback velocity-multiply friction and full positional correction with Coulomb friction and a Baumgarte fraction
- Evidence: src/physics/fallback.ts:1275-1278 applies friction as vel *= 1 - friction*0.01 on x/z, independent of normal impulse (not Coulomb, frame/substep dependent); :1237 corrects penetration fully ((penetration+0.002)/invMassSum) every substep, which adds energy via position jumps; :1256 uses min(restitution) with no resting-speed threshold, so stacked bodies jitter.
- Change: Compute tangential impulse jt clamped to mu*jn, apply a Baumgarte (e.g. 0.2) positional fraction with slop, and set restitution to 0 below ~0.5 m/s closing speed.
- Acceptance: Inclined-plane test: a box on a slope of angle theta must remain static for tan(theta)<mu and slide with acceleration g(sin-mu cos) beyond; assert within 5%. Stack of 5 boxes must settle with kinetic energy below a fixed threshold after 3 s.
- Confidence: STRONG: the three formulas are in source and the non-Coulomb nature is evident; (E007 covers GPU solvers, E031 soft floors, not the fallback pair solver).
- Source: new, file:line verified to exist

### N020 Make fallback gravity match native and remove substep-count-dependent damping
- Evidence: src/physics/fallback.ts:1070 applies 9.82 m/s^2 while the native engine uses -10 (see INTEGRATION_100 #69 for NATIVE_GRAVITY); :1071-1072 and :1081-1082 multiply velocity by 0.999 and angVel by 0.998 every substep, so effective damping depends on the number of substeps (step() at :170-184 uses dt/steps).
- Change: Share one gravity constant with the native config and apply damping as exp(-c*dt) (or pow(retention, dt*60)) so results are independent of substep count.
- Acceptance: Run the same fall for 2 s with steps=1,4,16: final height and speed must agree within 0.1%; currently velocity decay varies by substep count by construction. Compare fallback free-fall distance to native 0.5*10*t^2.
- Confidence: KNOWN: both the constant and the per-substep multipliers are in source.
- Source: new, file:line verified to exist

### N021 Remove the collocated-grid checkerboard null mode in GPU and CPU linear water with a staggered or filtered gradient
- Evidence: src/webgpu/linear-water.ts:28-34 and src/engine/linear-water.ts:34-38 compute u and v updates from (eta[i+1]-eta[i-1]) and eta from (nextU[i+1]-nextU[i-1]): central differences over 2 dx on a collocated grid cannot see a 2-dx (alternating) pattern. A grep of docs/*.md found no mention of this mode; the closed C-grid scheme (src/engine/closed-water.ts) avoids it.
- Change: Use a staggered (C-grid) update for the open scheme as in closed-water, or add a weak Laplacian/Shapiro filter on eta whose coefficient is tied to dx and dt.
- Acceptance: Initialise eta with an alternating +/-0.01 checkerboard in the CPU engine and run 2000 ticks: its amplitude must decay under the new scheme but persist (or grow from noise) in the current one; compare total energy.
- Confidence: LIKELY: the null-space property of centred differences is mathematical; the visible effect depends on initial noise and drag, and was not run here.
- Source: new, file:line verified to exist

### N022 Replace the hard eta clamp of +/-1.65 with a conservative limiter or mass-preserving correction
- Evidence: src/engine/linear-water.ts:38 and src/webgpu/linear-water.ts:34 clamp nextEta to +/-1.65 inside the continuity update, silently deleting or creating volume at the limits, and the same constant is in the soft sim at src/soft/simulations.ts:2790.
- Change: Track the clipped volume and redistribute it to neighbours, or soft-limit via tanh-style saturation and report a diagnostic when clamping occurs.
- Acceptance: CPU test: add a tall Gaussian pulse (eta peak 3) in a closed basin and run 1000 ticks; total volume (sum eta*dx*dz) drift must be below 1e-6 relative, versus the clamp's loss which can be asserted nonzero today.
- Confidence: STRONG: the clamp is evident in three files; magnitude of volume loss in real scenes is unmeasured.
- Source: new, file:line verified to exist

### N023 Make cloth constraint stiffness independent of timestep and substep count
- Evidence: src/soft/simulations.ts:1071-1072 caps steps at 2 and subDt = min(dt,1/30)/steps; :1083 uses a fixed iteration count; the projection factors scaleA/scaleB (:1209-1211, built from constraintFastScaleA/B) are constants with no dt term, so effective stiffness changes with frame rate and with the clamp at 1/30. Drag, by contrast, is already dt-corrected at :1121.
- Change: Use XPBD compliance alpha/dt^2 per constraint (or derive the scale factors per frame from a stiffness and dt), keeping the iteration count fixed for cost.
- Acceptance: Hang a cloth from two pins and simulate 5 s at 30, 60 and 120 Hz render rates: max sag and oscillation period must agree within 5%. Current disagreement is expected but unmeasured.
- Confidence: LIKELY: position-based projections without compliance are known to be iteration- and dt-dependent; this specific code was not run at several rates.
- Source: new, file:line verified to exist

### N024 Replace fixed-factor shallow-water boundary kernels with a physical reflective or radiating condition
- Evidence: src/soft/simulations.ts:2796-2817 sets edge cells to eta*0.92, u*0.78, and the normal velocity to -0.18*neighbour on every step, independent of dt, grid spacing and wave speed; the GPU boundary kernels use the same constants.
- Change: Use a reflective wall condition (normal velocity 0, eta copied from neighbour) or a characteristic radiation condition u = +/- sqrt(g/h)*eta, with any damping expressed per second.
- Acceptance: Run a pulse in a closed basin: reflected amplitude after the first wall hit must be ~1.0 for the wall condition (currently reduced by 0.92 per step by construction) and independent of dt (test dt and dt/2 give the same reflection).
- Confidence: STRONG: the constants and their per-step application are in source; the target physical behaviour (wall vs absorbing) is a design choice.
- Source: new, file:line verified to exist
