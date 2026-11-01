# 100 enhancements for box3d-webgpu (2026-10-02)

Status: **a proposal list, not a result.** No item below has been implemented or speed-tested by this document. Nothing here supports a "100x" claim; the earlier measured status stands (best sphere result about 75x vs Box3D mt8, cubes 5.7x/32x and failing the P3 pile check).

How it was built: seven read-only audits (renderer, soft bodies, Studio, WASM bridge, app/UI, tests/CI, plus my own measurements), merged, deduplicated against docs/ENGINE_100X_ROADMAP, docs/INTEGRATION_100, docs/MATH_SPEED_100 and docs/AAA_100_IMPROVEMENTS, then ranked by area.

Evidence provenance (count of items): **14** where I re-read the cited line or ran the check, **70** from subagent reports whose lines I did not re-read, **16** from my own measurements earlier in this session. Subagent line numbers can be off by a line or two (one was: pairLimit is at fallback.ts:1117, reported 1116). The reporting subagents said some of their overlap checks against the four backlog docs were incomplete, so a few items may partly repeat a backlog row.

Constraints respected: items that touch wasm/box3d_web.c or wasm/CMakeLists.txt are marked "proposal" and need a re-pin and rebuild; this list does not edit them. Servers, if any are used for acceptance checks, bind 127.0.0.1 only.

Confidence bands: KNOWN / STRONG / LIKELY / POSSIBLE, with the basis in brackets. Effort: S under half a day, M 1-3 days, L longer. "Impact" states what the change should do; none is a measured gain unless it says so.

Known-defect fixes: the items for M024, M025 and M029 fix defects my qualification runs measured; the MATH_SPEED_100 rows only called for measuring them.


## WebGPU PBD solvers

### E001. Sort bodies by grid cell so neighbour reads are coalesced
- **Evidence:** benchmarks/results/engine-100x/runs/gpu-spheres-opt4-20261002-01 (README/CRITERIA): best sphere result 54.1 ms at 65,536 bodies, about 75x vs Box3D mt8
- **Change:** Add a counting sort of body indices by cell id each step and gather positions in that order.
- **Acceptance check:** Re-run the paired sphere harness at 65,536 bodies with the same seed. Pre-register: median step time drops 10% or more, and the P3 pile hash is unchanged by tolerance.
- **Impact:** Memory-bound neighbour scan is the main cost; could move 75x toward 100x but this is unmeasured.
- **Effort:** M | **Confidence:** LIKELY (reasoned) | **Provenance:** my own measurement from earlier runs this session

### E002. Workgroup shared-memory tiling for the neighbour pass
- **Evidence:** gpu-spheres-opt3/opt4 run folders; neighbour pass reads global memory per candidate
- **Change:** Stage each cell block into var<workgroup> arrays before the pair loop.
- **Acceptance check:** Paired run vs frozen shader at 16,384 and 65,536 bodies; accept only if the control ratio stays in [0.9,1.1] and the median improves 5% or more.
- **Impact:** Fewer global loads; gain size unknown.
- **Effort:** M | **Confidence:** POSSIBLE (reasoned) | **Provenance:** my own measurement from earlier runs this session

### E003. Active-list compaction and sleeping for settled bodies
- **Evidence:** gpu-cubes-20261002-01: settled 65,536 cubes cost 11.3 ms/step; Box3D with sleeping costs 0.24 ms at 16,384
- **Change:** Per-body sleep timer, stream-compact awake indices, dispatch over the compacted list, wake on contact with an awake body.
- **Acceptance check:** Settled-pile scenario: step time under 2 ms at 65,536 cubes, P3 pile check unchanged, wake test passes when a sphere lands on the pile.
- **Impact:** Settled scenes are common; this is the largest known gap against Box3D.
- **Effort:** L | **Confidence:** STRONG (measured gap, design reasoned) | **Provenance:** my own measurement from earlier runs this session

### E004. Guard dispatch sizes above 65,535 workgroups
- **Evidence:** Earlier session: dispatches over 65,535 workgroups were silently dropped and gave invalid timings (documented in round READMEs)
- **Change:** Split into 2D dispatch or loop dispatches, and assert the limit from device.limits at pipeline creation.
- **Acceptance check:** Test that creates 70,000 workgroups of work and asserts every body is updated; harness throws on invalid dispatch.
- **Impact:** Removes a silent wrong-timing failure mode.
- **Effort:** S | **Confidence:** KNOWN (observed) | **Provenance:** my own measurement from earlier runs this session

### E005. Cube SAT contact manifolds (replace single-point contacts)
- **Evidence:** gpu-cubes-20261002-01: cube solver fails the P3 rain-pile check; cubes only 5.7x (16,384) and 32x (65,536)
- **Change:** Clip the incident face against the reference face to get up to 4 points per pair.
- **Acceptance check:** P3 rain-pile check passes at 16,384 cubes with pile height and rest drift under the pre-registered thresholds.
- **Impact:** Needed before cube speed numbers mean anything.
- **Effort:** L | **Confidence:** STRONG (failure measured, cause reasoned) | **Provenance:** my own measurement from earlier runs this session

### E006. Edge-edge contact candidates for cubes
- **Evidence:** Same cube P3 failure; vertex-face contacts miss edge crossings
- **Change:** Add edge-edge SAT axes and a closest-points step to the manifold generator.
- **Acceptance check:** Two cubes crossed at 45 degrees settle without interpenetration over 600 steps.
- **Impact:** Fewer stuck or tunnelled cubes.
- **Effort:** M | **Confidence:** LIKELY (reasoned) | **Provenance:** my own measurement from earlier runs this session

### E007. Restitution, rolling resistance and sleep hysteresis
- **Evidence:** Cube and sphere solvers lack these (run READMEs); Box3D has them
- **Change:** Add per-material restitution with velocity threshold, rolling resistance torque and separate sleep and wake thresholds.
- **Acceptance check:** Bounce-height test within 5% of the analytic value; a rolling sphere stops within a stated distance.
- **Impact:** Closer parity with the Box3D baseline being compared.
- **Effort:** M | **Confidence:** STRONG (reasoned) | **Provenance:** my own measurement from earlier runs this session

### E008. Same-session paired Box3D-vs-GPU harness with CPU-time metric
- **Evidence:** Machine load average 70-97 contaminated wall-clock numbers; gpu-spheres-paired-20261002-01
- **Change:** One script runs Box3D mt8 and the GPU solver interleaved in the same process and reports ratios with a control.
- **Acceptance check:** Control ratio inside [0.9,1.1] across 10 repeats; a JSON result file with raw samples.
- **Impact:** Makes any future speedup claim defensible.
- **Effort:** M | **Confidence:** STRONG (measured problem) | **Provenance:** my own measurement from earlier runs this session

### E009. Document the 4,096 vs 65,536 body-cap difference in every comparison
- **Evidence:** wasm/box3d_web.c B3W_MAX_BODIES=4096 (per docs); GPU runs use 65,536 bodies
- **Change:** Add a "capacity and tier" line to each benchmark README and the result JSON, and reserve a 65,536 pool for Box3D runs.
- **Acceptance check:** check script fails a result JSON without capacity fields for both engines.
- **Impact:** Prevents apples-to-oranges ratios.
- **Effort:** S | **Confidence:** KNOWN (docs) | **Provenance:** my own measurement from earlier runs this session

### E010. Add CPU-time (process.cpuUsage) metric to benchmark-strain.mjs
- **Evidence:** Measured control ratio 0.97-1.02 for CPU time versus 0.85-1.16 for wall time (benchmarks/experiments/m008-pass0-hoist-20261002/results-cpu.jsonl)
- **Change:** Record cpu user+system per sample alongside wall time and gate on the CPU ratio.
- **Acceptance check:** Run under artificial load; CPU control ratio stays within 0.9-1.1 where wall does not.
- **Impact:** Valid timings on a busy machine.
- **Effort:** S | **Confidence:** KNOWN (measured) | **Provenance:** my own measurement from earlier runs this session


## Studio solver

### E011. Make drag dt-consistent (exponential, not per-step)
- **Evidence:** benchmarks/experiments/m-qual-time-step-20261002/results.json: M024 FAIL (drag applied per step); src/studio/physics.ts step functions
- **Change:** Replace v *= (1-c) per step with v *= exp(-c*dt). Keep a legacy backend flag so checkpoints stay reproducible.
- **Acceptance check:** node benchmarks/experiments/m-qual-time-step-20261002/qualify.mjs reports M024 PASS (settling behaviour at dt 1/60 and 1/120 within its pre-registered tolerance).
- **Impact:** Behaviour stops depending on the step rate. Not a speed gain.
- **Effort:** S | **Confidence:** STRONG (defect measured, fix reasoned) | **Provenance:** my own measurement from earlier runs this session

### E012. Scale the per-step displacement clamp by dt
- **Evidence:** m-qual-time-step-20261002 M025 FAIL; clamp is per step
- **Change:** Express the clamp as a max velocity and multiply by dt.
- **Acceptance check:** qualify.mjs M025 PASS.
- **Impact:** Removes a dt-dependent speed limit.
- **Effort:** S | **Confidence:** STRONG | **Provenance:** my own measurement from earlier runs this session

### E013. Make stiffness converge under dt refinement (XPBD compliance)
- **Evidence:** m-qual-convergence-20261002: M029 FAIL (non-converged); bridge breaks 16 links at dt 1/60 and none at finer steps
- **Change:** Use compliance alpha/dt^2 per constraint and scale iteration counts.
- **Acceptance check:** qualify.mjs M029 PASS and the bridge break count is within 1 link across dt 1/60, 1/120, 1/240.
- **Impact:** Fracture results stop depending on the step.
- **Effort:** M | **Confidence:** STRONG (defect measured), LIKELY (fix works) | **Provenance:** my own measurement from earlier runs this session

### E014. Fracture-onset convergence test as a gate
- **Evidence:** Bridge break-count dependence on dt (same folder)
- **Change:** Add the dt-sweep fracture test to tests/qualification and wire it into CI.
- **Acceptance check:** npm run test:qualification fails if break count differs by more than the stated tolerance across dt.
- **Impact:** Catches regressions of the defect above.
- **Effort:** S | **Confidence:** STRONG | **Provenance:** my own measurement from earlier runs this session

### E015. Wire resume-exactness (M099) into CI
- **Evidence:** m-qual-convergence-20261002: M099 PASS; exportCheckpoint/restoreCheckpoint at src/studio/physics.ts:706-710
- **Change:** Add the qualify script as a test that runs 600 steps, checkpoints, restores and compares hashes.
- **Acceptance check:** CI job fails if the post-restore hash differs.
- **Impact:** Locks in a property that currently passes.
- **Effort:** S | **Confidence:** KNOWN (passes today) | **Provenance:** my own measurement from earlier runs this session

### E016. Integrate exact integrate/collide hoists through the step generator once a quiet gate passes
- **Evidence:** benchmarks/experiments/m008-pass0-hoist-20261002/README.md: bit-exact, 0-6% faster, speed gate not passed
- **Change:** Apply candidate-round3.diff via scripts/generate-studio-scaled-step.mjs, not by hand.
- **Acceptance check:** Quiet-machine paired CPU run shows 3% or more with control in [0.9,1.1], and exportCheckpoint hashes match.
- **Impact:** Small, exact, unproven speed gain.
- **Effort:** S | **Confidence:** POSSIBLE (gate not passed) | **Provenance:** my own measurement from earlier runs this session

### E017. Add the existing generator --check to the test script
- **Evidence:** scripts/generate-studio-scaled-step.mjs:20 supports --check; I ran it and it exited 0
- **Change:** Add node scripts/generate-studio-scaled-step.mjs --check to package.json test:studio and CI.
- **Acceptance check:** The command exits 0 now and non-zero after editing the legacy step without regenerating.
- **Impact:** Stops silent drift between the legacy and scaled step.
- **Effort:** S | **Confidence:** KNOWN (ran it) | **Provenance:** I re-read the cited line or ran the check

### E018. Interpolation alpha ignores sim speed
- **Evidence:** src/studio/main.ts:505-531 (alpha at 519-520)
- **Change:** Divide the accumulator by the effective step interval and clamp alpha to [0,1].
- **Acceptance check:** Unit test drives FixedFrameClock at 0.25x and 4x; alpha stays in [0,1] and rises monotonically between steps.
- **Impact:** Removes stutter when speed is not 1x.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E019. Skip re-copying an unchanged replay frame each rAF
- **Evidence:** main.ts:522 and src/studio/presentation-state.ts (copySnapshotInto / interpolateSnapshotInto), approximate lines
- **Change:** Cache the last frame index; interpolate between recorded frames when playing.
- **Acceptance check:** Count world.update calls over 100 rAFs with a paused replay: 0 or 1.
- **Impact:** Less CPU/GPU upload while paused.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E020. Remove per-contact allocations in canopy-contact hot loop
- **Evidence:** src/studio/canopy-contact.ts:62-63, 68, 76, 80, 92, 96, 111
- **Change:** Preallocate scratch vectors and use scalar locals.
- **Acceptance check:** Canopy step output bit-identical; node --trace-gc over 10k steps shows no young-gen growth from this file.
- **Impact:** Lower GC pressure at 120 Hz.
- **Effort:** M | **Confidence:** KNOWN (allocation sites reported); gain unmeasured | **Provenance:** subagent report, not independently re-read

### E021. Reset or restore lastUnresolved on rollback
- **Evidence:** canopy-contact.ts:25,67; rollback in physics.ts:252-283
- **Change:** Reset at the start of each contact pass and restore on rollback.
- **Acceptance check:** A rolled-back step followed by a clean step reports lastUnresolved = 0.
- **Impact:** Correct telemetry.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E022. Validate controls, rest, mass and plastic arrays in checkpoints
- **Evidence:** physics.ts:115-179 (readCheckpoint), 716-751 (applyCheckpoint)
- **Change:** Reject non-finite, out-of-range and wrong-length fields with a typed error before applying; apply atomically.
- **Acceptance check:** Fuzz: NaN, Infinity, negative and wrong-length for each field throws and leaves the live sim untouched.
- **Impact:** Imported files cannot poison the state with NaN.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E023. Validate checkpoints without building a StudioRuntime
- **Evidence:** src/engine/studio-client.ts:153-154
- **Change:** Use a static readCheckpoint-only validator.
- **Acceptance check:** Spy test: importing a checkpoint constructs zero StudioRuntime instances.
- **Impact:** Saves memory and tens of milliseconds per import (unmeasured).
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E024. Parse and validate checkpoint text once on import and export
- **Evidence:** main.ts:289-338; src/studio/checkpoint-file.ts:7
- **Change:** Pass the parsed object down; compute the size check once.
- **Acceptance check:** Spy test: one JSON.parse and one readCheckpoint per import.
- **Impact:** Lower latency on large runs.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E025. Throttle Studio updateUi and redraw charts only when the ring head moves
- **Evidence:** main.ts:401-446; src/perf/frame-clock.ts StageTimings.inspect; recording-ring.ts map
- **Change:** Cache last strings, update at 10 Hz, iterate the ring without map.
- **Acceptance check:** Count textContent and dataset writes over 600 frames: large drop; chart canvas calls fall from about 60/s to about 10/s.
- **Impact:** Less UI-thread work.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E026. Restore after bfcache: pageshow handling for Studio
- **Evidence:** main.ts:533 registers pagehide with once:true; no pageshow handler seen
- **Change:** Handle pageshow with persisted and recreate the worker.
- **Acceptance check:** E2E: back/forward navigation leaves the sim running.
- **Impact:** Avoids a dead sim after back navigation.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E027. Surface a warning when readPress falls back
- **Evidence:** src/studio/press-settings.ts:84-120
- **Change:** Return a flagged result; do not silently normalise imported out-of-range values.
- **Acceptance check:** A press object with NaN returns a flagged result.
- **Impact:** Silent wrong physics from imports becomes visible.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E028. Emit one event per link break
- **Evidence:** physics.ts:597-606
- **Change:** Emit per-break events with link id and step; coalesce only in the UI.
- **Acceptance check:** Two breaks in one step yield two events (or one with count 2).
- **Impact:** Correct fracture telemetry.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E029. Numeric keys in SurfaceTopology rebuild
- **Evidence:** src/studio/surface-topology.ts:17-39 (string-keyed Map)
- **Change:** Key by a*N+b or sort edge pairs in a typed array.
- **Acceptance check:** Identical exposed output across a fracture sequence; benchmark shows lower time.
- **Impact:** Faster fracture and replay frames.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read


## Soft bodies and contact

### E030. Cloth and rope energy telemetry uses the wrong time scale
- **Evidence:** src/soft/simulations.ts:1366-1378 (cloth), 2262-2274 (rope): invDt uses the frame dt but displacement is per substep
- **Change:** Store the substep dt and use it in computeEnergy.
- **Acceptance check:** Step the same scene with subSteps 1 and 2; kinetic energy of a free-falling particle differs by under 2% (reported about 4x apart today).
- **Impact:** Energy-drift gates stop depending on substeps.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E031. Apply floor friction once per substep, not per iteration
- **Evidence:** simulations.ts:1257-1285, 2183-2190; src/soft/material-simulation.ts:1466-1500
- **Change:** Use a Coulomb impulse limit once per substep; expose floor options.
- **Acceptance check:** Cloth sliding distance within 10% for iterations 4 vs 8 and subSteps 1 vs 2.
- **Impact:** Quality settings stop changing the behaviour.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E032. Time-scale rigid-body fallback damping, friction and heat decay
- **Evidence:** src/physics/fallback.ts:1067-1111, 1279-1296, 186-208
- **Change:** Use pow(k, dt*60); move heat decay out of syncTransforms into step.
- **Acceptance check:** 1 s of sim at steps=1 vs 8: mean body speed ratio 0.98-1.02; calling syncTransforms twice leaves heat unchanged.
- **Impact:** Frame-rate independent behaviour.
- **Effort:** M | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E033. Non-finite-aware, saturating hashes covering the full state
- **Evidence:** simulations.ts:493-504; material-simulation.ts:123-133; fallback.ts:53-63,102-108 (replayHash covers 512 bodies)
- **Change:** Fold the NaN bit pattern into the hash, saturate rather than wrap, share one helper.
- **Acceptance check:** hash(state with a NaN) differs from hash(zeros); a divergence at body 600 changes replayHash.
- **Impact:** Blow-ups become detectable by determinism gates.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E034. Fallback broadphase silently skips later bodies
- **Evidence:** src/physics/fallback.ts:1117 pairLimit = n>900 ? 420 : n>650 ? 560 : n (I re-read the line)
- **Change:** Cap by work or active count in a deterministic order, not by body index.
- **Acceptance check:** 1000 dynamic bodies: a box dropped on a body with index 800 comes to rest on it.
- **Impact:** Removes tunnelling at high body counts.
- **Effort:** M | **Confidence:** KNOWN (line verified); effect STRONG | **Provenance:** I re-read the cited line or ran the check

### E035. Remove RNG use from the pair resolver
- **Evidence:** fallback.ts:1297-1305 (this.rng.signed(0.02)*penetration)
- **Change:** Use a stateless hash of (frame, idA, idB) or drop the jitter.
- **Acceptance check:** replayHash after the same explode() is equal with the broadphase axis forced to X vs Z.
- **Impact:** Replay stability across broadphase changes.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E036. Alternate Gauss-Seidel sweep direction
- **Evidence:** simulations.ts:~1195-1255, 2128-2165; material-simulation.ts:1262-1292; compliant-cable.ts:164-175
- **Change:** Alternate direction per iteration; choose tear order by strain; mirror in the C kernel.
- **Acceptance check:** A cloth pinned at both top corners gives a mirror-symmetric result within 1e-4.
- **Impact:** Removes sag asymmetry and tear bias.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E037. Add a fixed-step accumulator and a dropped-time counter
- **Evidence:** simulations.ts:1080,2063-2064,2692-2693; fallback.ts:174 (Math.min(dt,...))
- **Change:** Accumulate time with a max steps per frame and report dropped time.
- **Acceptance check:** Step 1/15 s once vs 2x(1/30): equal simTime telemetry.
- **Impact:** Time stays consistent on slow frames.
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E038. Time-based water decay and boundary absorption with reported clamp loss
- **Evidence:** simulations.ts:2740-2830 (velocityDecay = 1 - drag*dt can go negative), clamp +-1.65 at 2793 and 2858; same constants in wasm/soft_kernels.c
- **Change:** Use exp(-drag*dt) clamped to [0,1]; report volume lost to the clamp.
- **Acceptance check:** 2 s pool with 1 and 3 substeps: energy decay ratio within 5%.
- **Impact:** Stable, conservative water; kernel and JS stay aligned.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E039. Replace the fixed X-axis sweep in convex-contact candidates()
- **Evidence:** src/engine/convex-contact.ts:358-380
- **Change:** Choose the axis by centre variance as fallback.ts does, or use a grid.
- **Acceptance check:** 500 stacked boxes: pairs tested at most 3x actual overlaps (add a counter).
- **Impact:** Avoids O(n^2) on vertical stacks.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E040. Remove indexOf and string keys from the convex-contact loop
- **Evidence:** convex-contact.ts:422 and 518 (this.bodies.indexOf(c.a), I re-read both lines), 440 and 576 (string keys)
- **Change:** Store the index on each body; use numeric keys.
- **Acceptance check:** Counter test shows zero indexOf calls; the state hash is unchanged.
- **Impact:** Removes O(N*C) work and per-contact string garbage.
- **Effort:** S | **Confidence:** KNOWN (lines verified) | **Provenance:** I re-read the cited line or ran the check

### E041. Do not drop unresolved surface-contact sweeps
- **Evidence:** src/engine/surface-contact.ts:354 and 378 (not converged, then continue)
- **Change:** Fall back to conservative advancement or clamp to the nearest feature.
- **Acceptance check:** A fast point crossing a thin triangle with the sweep cap forced to 1 is still stopped.
- **Impact:** Fewer tunnelling failures.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E042. Honest energy units for material telemetry and time-based fragment decay
- **Evidence:** material-simulation.ts:2183-2232, 1102, 1719-1745
- **Change:** Compute 0.5*m*(dx/dt)^2 with the substep dt; use pow-based decay.
- **Acceptance check:** Free-fall energy matches m*g*h within 3% for 4 vs 8 slices.
- **Impact:** Energy gates become meaningful.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E043. Bounds-check constraint indices in the soft C kernel and test kernel vs JS
- **Evidence:** wasm/soft_kernels.c and src/soft/kernels.ts: u16 indices, no index-versus-particle_count check; f32 kernel vs f64 JS
- **Change:** Validate indices on the TS side (do not edit wasm/ source); add a 60-step kernel-vs-JS comparison.
- **Acceptance check:** Position difference under 1e-3 after 60 steps on a seeded cloth.
- **Impact:** Prevents out-of-bounds writes from bad data.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read


## Native WASM bridge

### E044. Stack scenes silently truncate at 4,096 bodies
- **Evidence:** wasm/box3d_web.c:610-614, 718-735, 1310-1325; src/engine/native-world.ts:428-433; stress 5 gives 28*33*5=4620 by the reporter arithmetic
- **Change:** JS: compare returned count with expected and throw CAPACITY_EXCEEDED; C (proposal): reserve or flag truncation.
- **Acceptance check:** createScene({id:1},5,1) either returns 7296+1 after reserveBodyCapacity(16384) or throws.
- **Impact:** Wrong scene content without a signal.
- **Effort:** S | **Confidence:** KNOWN (arithmetic) for the pool; unverified for the app world | **Provenance:** subagent report, not independently re-read

### E045. Reject non-finite and huge impulse, kick, explode and launch inputs
- **Evidence:** box3d_web.c:1500-1566; src/physics/wasm.ts:118-124; native-world.ts:310-315, 452-456
- **Change:** Add isfinite and magnitude bounds in JS now; in C as a proposal.
- **Acceptance check:** Fuzz: NaN and 1e30 launches are rejected; after 1000 hostile calls every transform float is finite.
- **Impact:** One NaN can no longer poison the whole stream.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E046. Replay-hash float-to-int cast is undefined for large values
- **Evidence:** box3d_web.c:1568-1595
- **Change:** Saturate before casting or hash bits via memcpy; version the hash.
- **Acceptance check:** 1e30 velocity then replay_hash does not trap and matches in Node and Chromium.
- **Impact:** A diagnostic call cannot crash a live session.
- **Effort:** S | **Confidence:** LIKELY (depends on Emscripten conversion semantics, not verified) | **Provenance:** subagent report, not independently re-read

### E047. Mirror the dt and substep bounds in the default backend
- **Evidence:** src/physics/wasm.ts:109-113 vs native-world.ts:435
- **Change:** Apply dt <= 1/30 and substeps 1..16 in WasmPhysicsBackend.step.
- **Acceptance check:** step(5, 1000) is rejected and transforms are unchanged.
- **Impact:** Both backends agree on what is legal.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E048. Distinct status codes instead of one DISPOSED
- **Evidence:** native-world.ts:223-225, 455, 459; box3d_web.c:1500-1507, 1285-1287
- **Change:** Status table (OK, STALE, NO_WORLD, BAD_INDEX, NOT_DYNAMIC, CAPACITY_FULL, NOT_FINITE) mapped to EngineError codes.
- **Acceptance check:** Full world gives CAPACITY_FULL; impulse on a static row gives NOT_DYNAMIC; stale handle gives DISPOSED.
- **Impact:** Callers can tell a dead world from a full one.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E049. ABI layout and limits handshake beyond api_version==1
- **Evidence:** native-world.ts:60-61, 152, 210, 247, 261, 325, 369; box3d_web.c:20-21, 66-70, 198
- **Change:** Export b3w_abi_layout (proposal) and assert equality at load.
- **Acceptance check:** A stub module with a one-field layout change fails with UNSUPPORTED_BACKEND.
- **Impact:** A rebuild cannot corrupt reads silently.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E050. Typed-array views and cheaper decoding for native queries
- **Evidence:** native-world.ts:388-422, 272-278, 383, 399
- **Change:** Use typed-array views over the aligned arena and skip cast-only decode for overlap hits.
- **Acceptance check:** native-query-check and native-query-oracle remain bit-identical; allocations per 128-input batch fall.
- **Impact:** Lower GC and CPU for picking (unmeasured).
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E051. Closest-hit early-out flag for casts
- **Evidence:** box3d_web.c:365-381 (callback returns 1.0f, which I re-read at line 374)
- **Change:** Proposal: use the reserved field as a closest-only flag and bump the query ABI.
- **Acceptance check:** Ray through a 4096-body stack with limit 1 returns the same first hit; the visit counter drops.
- **Impact:** Cheaper picking in dense worlds.
- **Effort:** M | **Confidence:** LIKELY (line verified; effect unmeasured) | **Provenance:** I re-read the cited line or ran the check

### E052. Memoize the native pool module and use the threaded artifact
- **Evidence:** src/physics/wasm.ts:216-224; wasm/box3d_threads.c:136
- **Change:** Cache the module promise; load via planThreading.
- **Acceptance check:** Two loadNativeWorldPool calls produce one factory call; cross-origin-isolated pool worlds report more than 1 worker.
- **Impact:** Removes duplicate heaps; enables threads.
- **Effort:** M | **Confidence:** KNOWN (repeat instantiation); STRONG (threading) | **Provenance:** subagent report, not independently re-read

### E053. Terminate pthread workers on load timeout and add dispose()
- **Evidence:** wasm.ts:181-214, 133-136; wasm/CMakeLists.txt:119-123
- **Change:** Keep the pending module reference; terminate on timeout; export PThread.
- **Acceptance check:** Forced-timeout test: every Worker is terminated after fallback.
- **Impact:** No idle workers or second heap per failed load.
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E054. Pair the JS glue and WASM binary with a content hash
- **Evidence:** wasm.ts:149-158; BUILD_PROVENANCE.json; deploy/railway/Caddyfile:30 mitigates only that host
- **Change:** Inject provenance sha8 via a vite define and append ?v= to both URLs.
- **Acceptance check:** Built dist references box3d.js and box3d.wasm with the same v= value.
- **Impact:** Stops a cached old .wasm from pairing with a new .js on static hosts.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E055. Hash CMakeLists.txt and toolchain in build provenance
- **Evidence:** scripts/update-build-provenance.mjs:15-35; update-threaded-provenance.mjs:~21
- **Change:** Include cmake sha and toolchain in qualificationChanged.
- **Acceptance check:** Change one comment in CMakeLists.txt on a temp copy; the script sets validation.status to not_run.
- **Impact:** A link-flag edit can no longer keep a stale pass.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E056. Record real SIMD state in provenance
- **Evidence:** update-threaded-provenance.mjs (simd: true hard-coded); build-wasm*.sh accept BOX3D_DISABLE_SIMD=ON
- **Change:** Pass the build flag through and scan for v128 opcodes.
- **Acceptance check:** A scalar build records simd:false and the scan finds no SIMD opcodes.
- **Impact:** No SIMD claim for a scalar artifact.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E057. Atomic provenance write and kit drift check
- **Evidence:** update-build-provenance.mjs:37; packages/box3d-kit/wasm/BUILD_PROVENANCE.json differs at line 118 (reported)
- **Change:** Write via temp file and rename; add sync-core.mjs --check to CI.
- **Acceptance check:** node packages/box3d-kit/scripts/sync-core.mjs --check exits non-zero now and zero after a sync.
- **Impact:** Removes a corruption window and a stale shipped receipt.
- **Effort:** S | **Confidence:** KNOWN (drift, reported); LIKELY (corruption window) | **Provenance:** subagent report, not independently re-read

### E058. Explicit stack and initial memory in link options (proposal)
- **Evidence:** wasm/CMakeLists.txt:126-142 has neither; -sASSERTIONS=0
- **Change:** Add -sSTACK_SIZE and -sINITIAL_MEMORY; build a test artifact with stack overflow checks. Needs a re-pin.
- **Acceptance check:** native-box3d-soak passes on the 800-scene catalog; HEAPU8.length equals the configured size.
- **Impact:** Avoids silent stack overflow and mid-frame heap growth.
- **Effort:** M | **Confidence:** LIKELY (stack default not verified) | **Provenance:** subagent report, not independently re-read

### E059. One boundary call for renderer stream info
- **Evidence:** native-world.ts:217-235
- **Change:** Proposal: b3w_world_stream_info(handle, out*) returning one 32-byte struct.
- **Acceptance check:** Counting stub shows boundary calls per frame fall from about 6 to 1.
- **Impact:** Fewer per-frame crossings per pooled world (unmeasured).
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read


## Renderer and GPU timing

### E060. Mark per-instance varyings @interpolate(flat)
- **Evidence:** src/webgpu/renderer.ts:217-224 (VertexOut color, materialUv), ShadowVertexOut ~590; grep for "@interpolate" finds none (I ran it)
- **Change:** Flat-interpolate color (carries material id and emissive energy) in solid, transparent and shadow shaders.
- **Acceptance check:** Golden-frame diff identical for non-emissive scenes; no round(-a) flicker.
- **Impact:** Fewer interpolators per pixel; removes interpolation drift of ids.
- **Effort:** S | **Confidence:** KNOWN (absence verified); LIKELY (gain) | **Provenance:** I re-read the cited line or ran the check

### E061. Vertex-only shadow pass fed by the opaque partition
- **Evidence:** renderer.ts:605-615 (discarding fsMain), 3329-3357 (unpartitioned draw) vs 3386-3394 (indirect)
- **Change:** Drop the fragment stage and use the opaque indirect draw, or collapse non-casters in the vertex stage.
- **Acceptance check:** gpuTimingInfo().latest.passMs.shadow drops on a 100k-instance scene; shadow map unchanged for opaque scenes.
- **Impact:** Removes fragment launch and discard in a depth-only pass.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E062. Draw the sky last so early-z can reject covered pixels
- **Evidence:** renderer.ts:3375-3377, 2289 (depthCompare always), skyShader 1322-1383
- **Change:** Draw at z=1 with less-equal after opaque; replace pow(x,2.0) with x*x.
- **Acceptance check:** Main-pass GPU ms drops on dense scenes; golden diff zero.
- **Impact:** Saves a full-screen shade of covered pixels at 4x MSAA.
- **Effort:** S | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E063. Cache canvas size instead of reading layout every frame
- **Evidence:** renderer.ts:2633-2651, 2709, 3282 (clientWidth/Height inside resize(), called twice per frame)
- **Change:** ResizeObserver with devicePixelContentBoxSize; resize only when dirty.
- **Acceptance check:** Chrome trace shows 0 forced layouts from resize() in steady state.
- **Impact:** Removes per-frame layout reads.
- **Effort:** S | **Confidence:** KNOWN / LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E064. Skip unchanged scene-uniform writes
- **Evidence:** renderer.ts:2706-2731 (52 floats, writeBuffer unconditional)
- **Change:** Keep a shadow copy and skip queue.writeBuffer when equal; gate configureQuality on change.
- **Acceptance check:** A paused scene makes 0 uniformBuffer writeBuffer calls per frame.
- **Impact:** Free CPU/driver saving on idle.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E065. Quantise resolution-governor steps to avoid reallocating attachments
- **Evidence:** src/main.ts:4145 (0.05 steps), renderer.ts:2656-2699 (destroys and recreates depth, MSAA colour, HDR); about 66 MB at 1080p reported
- **Change:** Use 4-5 discrete scales or allocate once at max and use a viewport sub-rect; wrap in an error scope.
- **Acceptance check:** createTexture calls per minute during a governor sweep drop to 5 or fewer.
- **Impact:** Removes allocation hitches. Applies only if main.ts is live (see UI orphan item).
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E066. Install a uncapturederror handler
- **Evidence:** grep for uncapturederror|onuncaptured in src returns 0 (I ran it); error scopes only at renderer.ts:2538-2545
- **Change:** Add the listener in create(); count and surface the last message in dataset diagnostics.
- **Acceptance check:** A forced validation error is reported in a test.
- **Impact:** Validation failures, including KTX2 uploads, are silent today.
- **Effort:** S | **Confidence:** KNOWN (verified) | **Provenance:** I re-read the cited line or ran the check

### E067. Stop encoding and submitting after device loss
- **Evidence:** renderer.ts:3278-3283 checks only disposed; deviceLoss is set at 3523 but read only at 2572 (I grepped it)
- **Change:** Early-return from render()/upload* when deviceLoss is set; expose isLost().
- **Acceptance check:** Mock device.lost resolution makes later render() calls return 0 without touching the queue.
- **Impact:** No wasted work on a dead device.
- **Effort:** S | **Confidence:** KNOWN (reads verified) | **Provenance:** I re-read the cited line or ran the check

### E068. Drop the 256-byte row padding in KTX2 uploads
- **Evidence:** src/assets/ktx2.ts:105-133 (align256 at 105, used at 119); 256 rule applies to copyBufferToTexture, not queue.writeTexture
- **Change:** Pass level.data with the tight bytesPerRow; delete align256 and the repack loop.
- **Acceptance check:** Unit test: a 126x126 ASTC level upload allocates no new Uint8Array; atlas identical.
- **Impact:** Removes up to 255 bytes/row of copy per mip at load.
- **Effort:** S | **Confidence:** STRONG (verify on a strict implementation) | **Provenance:** subagent report, not independently re-read

### E069. KTX2 mip filter can shift mip indexes
- **Evidence:** ktx2.ts:142-154 (.filter) and :162 (array index used as the mip index)
- **Change:** Use takeWhile semantics and validate the base level.
- **Acceptance check:** A 54-wide ASTC 6x6 chain yields a mip count equal to the aligned prefix.
- **Impact:** Prevents wrong-level data in a mip slot.
- **Effort:** S | **Confidence:** STRONG (edge case, reported) | **Provenance:** subagent report, not independently re-read

### E070. Validate KTX2 header and level sizes
- **Evidence:** ktx2.ts:79-102 (faceCount, layerCount, pixelDepth not read; level byteLength not compared)
- **Change:** Reject cube, array and 3D textures and mismatched level sizes with a clear error.
- **Acceptance check:** Truncated level and faceCount=6 inputs both throw.
- **Impact:** Bad assets fail early instead of as a GPU validation error.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E071. Make KTX2 fallback real with error scopes and free partial textures
- **Evidence:** ktx2.ts:155-162, 287-291, 306-307, 324-327
- **Change:** pushErrorScope(validation) around create and upload; destroy partial textures on failure.
- **Acceptance check:** An invalid upload falls back to the procedural atlas with no leaked texture.
- **Impact:** The try/catch cannot see asynchronous GPU errors today.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E072. One bad GPU timestamp pair should not disable timing
- **Evidence:** src/webgpu/gpu-timing.ts:255-272, 245-250, 139
- **Change:** Count invalid samples and trip only after N consecutive failures.
- **Acceptance check:** Inject one start>end pair: status stays ready and later samples complete.
- **Impact:** A glitch no longer removes GPU data for the session.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E073. Time the water compute pass
- **Evidence:** src/webgpu/linear-water.ts:147-157 submits its own pass; I grepped it and it has no timestampWrites; PASSES lacks water (gpu-timing.ts ~66)
- **Change:** Add a water pass slot or accept external timestampWrites.
- **Acceptance check:** passMs.water is non-null when water is active.
- **Impact:** Closes the largest GPU-time blind spot.
- **Effort:** S | **Confidence:** STRONG (no timestampWrites verified) | **Provenance:** I re-read the cited line or ran the check

### E074. Feed the governor one consistent metric
- **Evidence:** src/main.ts:4141-4146 mixes GPU pass sum and CPU encode time; src/perf/runtime.ts:49-63 fixed 16.667 ms target
- **Change:** Use GPU+CPU or the rAF interval; derive the target from measured refresh.
- **Acceptance check:** A steady 10 ms stream never triggers a downscale; a 25 ms stream does within 12 samples.
- **Impact:** Avoids false and missed downscales.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E075. Track GPU pass times in the percentile tracker
- **Evidence:** src/perf/frame-clock.ts:30-51; main.ts:359 creates only step, staging, renderCpu, frame
- **Change:** Add gpuShadow, gpuMain, gpuPost, gpuCompute stages.
- **Acceptance check:** engineTimings dataset includes GPU stages with p95.
- **Impact:** Tail-latency visibility.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E076. Pool particle objects and reuse the camera-shake sample
- **Evidence:** src/effects.ts:106-123 (and 147, 179, 220, 266, 303, 327), 404-415
- **Change:** Free-list with SoA Float32Array; reuse one CameraShakeSample.
- **Acceptance check:** A 3000-particle burst shows near-zero young-gen allocation in a heap profile.
- **Impact:** Fewer GC pauses during effects.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read


## App shell and UI

### E077. Decide the fate of the orphaned legacy src/main.ts
- **Evidence:** src/entry.ts:10-16 imports only ./studio/main and ./studio/material-labs/main (I re-read it); src/main.ts is about 4k lines
- **Change:** Move to src/legacy-lab/ behind a banner or delete; fix README.md:557; extract runRecordV1 if kept.
- **Acceptance check:** grep -rn "from './main'" src returns nothing and npx tsc --noEmit passes.
- **Impact:** Stops 4k lines of unreachable code from being audited as live. Most UI items below apply to it only if revived.
- **Effort:** M | **Confidence:** KNOWN (entry file verified) | **Provenance:** I re-read the cited line or ran the check

### E078. appendLog is O(log size) and not a live region
- **Evidence:** src/main.ts:1157-1161 (I re-read it)
- **Change:** Ring buffer of 36 child nodes with role="log" and a rAF-coalesced scroll.
- **Acceptance check:** 1000 appends leave 36 children; axe reports a live region.
- **Impact:** Less string work and a forced layout per call.
- **Effort:** S | **Confidence:** KNOWN (code verified); applies only if main.ts is live | **Provenance:** I re-read the cited line or ran the check

### E079. Multi-touch, wheel deltaMode, touch-action and keyboard orbit
- **Evidence:** src/main.ts:2940-2980
- **Change:** Track pointers in a Map, pinch zoom, normalise wheel, touch-action none, key orbit.
- **Acceptance check:** Playwright two-pointer test changes camera.distance without a yaw jump; key test orbits.
- **Impact:** Usable on touch and by keyboard.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E080. Shortcut guard misses role widgets; add an off switch
- **Evidence:** src/main.ts:3198-3246
- **Change:** Exclude tab/option/listbox roles; persisted shortcuts toggle; block r/digits/arrows during a run.
- **Acceptance check:** keydown r and ArrowRight on a role=tab element change nothing.
- **Impact:** WCAG 2.1.4 and no accidental loss of a run.
- **Effort:** S | **Confidence:** STRONG (gap), LIKELY (destructive effect) | **Provenance:** subagent report, not independently re-read

### E081. Two pagehide handlers, one without a bfcache guard
- **Evidence:** src/main.ts:3248 and 4183
- **Change:** One disposal function behind one { once: true } handler honouring persisted.
- **Acceptance check:** Navigate away and back: bodyCount valid or a reload prompt; dispose twice does not throw.
- **Impact:** No dead lab after back navigation.
- **Effort:** S | **Confidence:** KNOWN (two handlers); LIKELY (failure) | **Provenance:** subagent report, not independently re-read

### E082. Persist completed runs in IndexedDB with schema validation
- **Evidence:** src/main.ts:1654-1665 (in-memory array, evicts past 12); RUN_RECORD_SCHEMA_V1 at 2610
- **Change:** Store RunRecordV1 by runId; validate on read; quarantine invalid entries.
- **Acceptance check:** fake-indexeddb test writes 13, reloads 12 valid, quarantines a tampered record.
- **Impact:** Runs, including the correlation baseline, survive refresh.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E083. Run record provenance literals and non-idempotent timestamp
- **Evidence:** src/main.ts:2626 buildVersion: '1.20.0' (I re-read it), 2628 fixedStepS, 2613 completedAt: new Date()
- **Change:** Inject build version via Vite define; derive step and rate from the loop constant; stamp completedAt once.
- **Acceptance check:** runRecordV1() twice gives deep-equal records and an identical sha256.
- **Impact:** Evidence cannot misstate build or rate; stable hashes.
- **Effort:** S | **Confidence:** KNOWN (literal verified); LIKELY (hash drift) | **Provenance:** I re-read the cited line or ran the check

### E084. Dataset import: precheck size and RFC 4180 header parsing
- **Evidence:** src/main.ts:2708-2725; src/workbench/engineering-evidence.ts:424,507-512
- **Change:** Reject on file.size before text(); tokenise CSV headers; use randomUUID for datasetId.
- **Acceptance check:** A 17 MiB file is rejected before text(); header "a,b",c parses as 2 columns; two same-tick imports get distinct ids.
- **Impact:** A file cannot freeze the tab or corrupt an import.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E085. Evidence export falls back to a different run and does not self-verify
- **Evidence:** src/main.ts:2666-2669, 2655-2663; engineering-evidence.ts:1573-1575
- **Change:** Refuse when the active run is missing; re-parse, validate and re-hash before download; delay revoke.
- **Acceptance check:** A stale activeCorrelationRunId yields no download and a visible error; round trip hash matches.
- **Impact:** Evidence integrity.
- **Effort:** S | **Confidence:** KNOWN (fallback, reported); LIKELY (revoke race) | **Provenance:** subagent report, not independently re-read

### E086. Frame capture from a WebGPU canvas may be blank
- **Evidence:** src/main.ts:2560, 1640, 1666-1710 (toBlob outside the presenting task)
- **Change:** Capture in the same rAF task as the render; reject all-transparent output.
- **Acceptance check:** Browser test: stored run frame has more than 1% non-transparent pixels.
- **Impact:** Correlation reference images are real.
- **Effort:** M | **Confidence:** LIKELY (reporter did not run it) | **Provenance:** subagent report, not independently re-read

### E087. Ban unescaped innerHTML interpolation and add a CSP
- **Evidence:** 20 innerHTML assignments in src/ui/*.ts (reported); index.html:1-58 has no CSP; imported CSV headers reach labels
- **Change:** Export one escapeHtml; lint-ban innerHTML interpolation; add a CSP meta.
- **Acceptance check:** Importing a CSV with a header <img src=x onerror=...> creates no element and runs no script.
- **Impact:** Closes a possible stored-XSS path.
- **Effort:** M | **Confidence:** POSSIBLE (escaping upstream not traced) | **Provenance:** subagent report, not independently re-read

### E088. AbortController teardown for UI listeners and timers
- **Evidence:** src/main.ts:2932-2936, 2906-2918, 2940-3196, 3198; engineering-workspaces.ts:3170-3175; firstRunGuide destroy called twice (2227, 3175)
- **Change:** Pass {signal} to every addEventListener; make destroy idempotent; track timers.
- **Acceptance check:** Mount and destroy 50 times; listener count returns to baseline.
- **Impact:** No leaks on repeated mounts.
- **Effort:** M | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read


## Tests, CI and repo hygiene

### E089. Commit the untracked source in reviewable slices
- **Evidence:** git status --porcelain shows 144 entries (I counted); src/studio and src/engine are untracked
- **Change:** Group into commits (engine, studio, soft, docs, baselines) and add a clean-tree CI check. Only on your request.
- **Acceptance check:** git status --porcelain is empty on a fresh checkout of the branch; CI builds from it.
- **Impact:** Builds today depend on files that exist only on this machine.
- **Effort:** M | **Confidence:** KNOWN (counted) | **Provenance:** I re-read the cited line or ran the check

### E090. Generate the source manifest from git ls-files
- **Evidence:** scripts/generate-source-manifest.sh:11 uses find; 345-line manifest has 1 src/studio|engine hit (reported)
- **Change:** Use git ls-files and remove " 2"/" 3" duplicate files.
- **Acceptance check:** Manifest includes every tracked file and no duplicate-suffixed names.
- **Impact:** The manifest stops attesting an incomplete set.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E091. Run engine, studio, threaded and gpu-water tests in CI
- **Evidence:** .github/workflows/ci.yml:33-54 (reported)
- **Change:** One test:ci script used by ci.yml and pages.yml.
- **Acceptance check:** A deliberately broken tests/engine test fails the workflow.
- **Impact:** Most of the 44 engine test files do not run in CI today (reported).
- **Effort:** M | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E092. Wire unreferenced tests/studio and tests/qualification files by glob
- **Evidence:** 24 of 29 studio tests and all 11 qualification tests unwired (reported)
- **Change:** Glob-based test scripts.
- **Acceptance check:** node --test lists every file under those folders.
- **Impact:** Existing tests actually run.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E093. Replace wall-clock assertions with injected clocks
- **Evidence:** tests/engine/child-supervisor.test.mjs:15-18; studio-state.test.mjs:191
- **Change:** Inject clocks or a time-scale env var.
- **Acceptance check:** Tests pass under CPU load of 90+.
- **Impact:** Fewer flaky failures on this machine.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E094. Collapse copy-pasted validate:v1.xx chains and duplicate workflow steps
- **Evidence:** package.json validate:v1.14..v1.20 (251-char chains); ci.yml:33-65 vs pages.yml:37-70
- **Change:** scripts/validate.mjs plus a reusable workflow.
- **Acceptance check:** One definition; pages.yml needs ci.yml.
- **Impact:** Gate drift between workflows ends.
- **Effort:** M | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E095. Timeouts, concurrency, pinned actions, Node version pin
- **Evidence:** ci.yml (reported): no timeout-minutes/concurrency, tag-pinned actions, no .nvmrc/engines
- **Change:** Add them; matrix Node 22 and the documented version.
- **Acceptance check:** Workflow lint passes; a hung job is cancelled.
- **Impact:** Safer, cheaper CI.
- **Effort:** S | **Confidence:** KNOWN (reported) | **Provenance:** subagent report, not independently re-read

### E096. GitHub Pages cannot send COOP/COEP but ships the threaded build
- **Evidence:** vite.config.ts:4-25 sets headers only for server/preview (reported)
- **Change:** Add a service-worker shim or drop box3d-mt from build:pages; test the fallback.
- **Acceptance check:** The Pages build loads and steps without cross-origin isolation.
- **Impact:** Threads either work or are cleanly absent.
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E097. Ignore or prune benchmarks/experiments (2.0 GB untracked)
- **Evidence:** du -sh benchmarks/experiments reports 2.0G (I ran it); .git is 1.7G; vite.config.ts:14 special-cases the folder
- **Change:** Gitignore it, keep small READMEs and JSON, move bulk to scratch or the Railway drive.
- **Acceptance check:** du -sh benchmarks/experiments is under 50 MB; git status no longer lists it.
- **Impact:** Disk is chronically full per operator policy.
- **Effort:** S | **Confidence:** KNOWN (measured) | **Provenance:** I re-read the cited line or ran the check

### E098. Add a dist-size budget gate
- **Evidence:** public/ is 143M with public/studio 122M untracked (reported)
- **Change:** scripts/check-dist-size.mjs with a per-folder budget.
- **Acceptance check:** Build fails when the budget is exceeded.
- **Impact:** Pages payload stays bounded.
- **Effort:** S | **Confidence:** STRONG (reported) | **Provenance:** subagent report, not independently re-read

### E099. Staleness check for recorded qualification evidence
- **Evidence:** tests/qualification/closed-water-evidence.test.mjs:13 compares recorded JSON only (reported)
- **Change:** Record source hashes in evidence and fail when sources change; add a small live run.
- **Acceptance check:** Editing a hashed source fails the test until evidence is regenerated.
- **Impact:** Evidence cannot silently go stale.
- **Effort:** M | **Confidence:** LIKELY (reported) | **Provenance:** subagent report, not independently re-read

### E100. Check doc claims against reality
- **Evidence:** package.json says 68 demos/34 programs; README says 65 heroes (reported); package.json has 98 scripts (I counted) versus 94 in the docs
- **Change:** scripts/check-doc-claims.mjs comparing counts to code.
- **Acceptance check:** The script fails on the current mismatch and passes after docs are fixed.
- **Impact:** Numbers in docs stay true.
- **Effort:** S | **Confidence:** KNOWN (script count verified) | **Provenance:** I re-read the cited line or ran the check

## What this list does not cover
- Renderer shader hot paths the audit mentioned but I left out of the 100: skipping atlas and noise samples for plain dielectrics (renderer.ts:388-415), double normalize in the vertex shader (254-272), 9-tap PCF vs 4 (343-370), lazy compile of the inactive MSAA pipeline set (2380-2385).
- Roughly 25 further audit findings were cut for overlap or lower value (for example rope projectile O(N*C) scans, scene-browser DOM rebuilds, toast timer).
- Nothing here changes the status of the standing goal: the 100 MATH_SPEED_100 items are not met (about 91 untouched, none passed a speed gate).
