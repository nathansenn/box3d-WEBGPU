# Canopy continuous contact

New canopy runs in the Studio use `studio-pbd-canopy-ccd-js-v1`. Fabric now collides with its own active surface, the primary support hardware and the floor. The previous `studio-pbd-js-v1` and `studio-pbd-scaled-norm3-js-v1` remain available for saved runs; plate and bridge behavior is preserved.

## Geometry and response

Continuous queries test vertices against triangles and edges against edges over their linear motion between accepted states. A persistent, flat Float64 AABB hierarchy prunes static-only branches and duplicate edge-pair subtrees, and produces deterministic candidate order. Bounded candidate caches reuse enlarged feature/query envelopes; every query filters against current exact swept bounds and recomputes the narrow phase. An escaping feature or changed mass mask invalidates the cache before querying. Motion bounds reuse storage. It rebuilds topology when links break, removing torn faces and their edges from contact. Particles without an active face cannot create invisible surface contacts.

The candidate displacement includes the twelve structural PBD passes. Contact processing then checks that complete displacement and any subsequent corrections. Solver guesses within a structural/contact pass are not treated as extra time samples. Closest-feature separating planes bound closing speed; tangential motion alone cannot close the plane. Degenerate triangles reduce to their edges or points. Work-limit exhaustion is explicit: the complete tick rolls back and the UI pauses rather than accepting an unresolved query.

The authored proximity separation is **3 mm**, with a **1 micrometre** crossing margin and **0.1 micrometre** query tolerance. Separating proximity response from crossing detection avoids costly searches around the thickness boundary in grazing folds. Nearby contact constraints share corrections by inverse mass and barycentric/edge weights. Up to twelve inexpensive local sweeps precede a fresh whole-surface query, with sixteen outer passes available. The position stopping criterion is a **2 micrometre maximum particle correction**, not a general geometric-error certificate.

`canopy-rig.ts` supplies the renderer and contact geometry with the same base plates, column flanges/webs/caps, top plates, corner ties, turnbuckles and clevis dimensions. Cylinders use twelve sides to match the rendered tie rods. Beveled boxes use enclosing box proxies. Bolts, rings, threads and base gussets remain decorative; these small fixtures are not individually collidable. A 90 mm patch at each fixed corner is treated as the intentional attachment joint.

Surface contacts are frictionless and remove approaching normal velocity while preserving free tangential motion. Floor friction uses an authored coefficient of 0.28, bounded by the normal correction and applied once per tick. The preceding floor clamp applied tangential damping during each structural contact pass. This model is still authored PBD: it is not calibrated fabric mechanics, a finite-element shell, or a coupling to moving rigid bodies.

The feature-pair decomposition and distinction between proximity and crossings follow the established cloth-contact approach described by [Bridson, Fedkiw and Anderson](https://www.cs.ubc.ca/~rbridson/docs/cloth2002.pdf). This implementation has its own bounded position solve and does not inherit that paper's general collision-free guarantee.

## Search optimization

The [September 12 optimization](../benchmarks/experiments/canopy-contact-optimization-20260912-01/) preserves the numerical backend and contact equations. Every complete checkpoint and contact-statistics report matches the frozen preceding implementation over **8,640 ticks**: a fresh 30-second default tear, a fresh 30-second high-wind case and a 12-second service case. An additional 540 checkpoint comparisons cover intact and saved folded/wind states; 120 complete random contact-report comparisons and three new cache regressions cover changed masses, moving features, thickness, point participation, tears and dense cache fallback.

[Deterministic work counts](../benchmarks/experiments/canopy-contact-optimization-20260912-01/work-counts.json) use 24 warmup ticks followed by 240 checked ticks per workload:

| Workload | Previous tree visits | Current tree visits | Reduction | Current exact leaf-bound checks |
| --- | ---: | ---: | ---: | ---: |
| Intact | 58,011,476 | 5,344,457 | 90.79% | 5,843,350 |
| Folded | 138,813,540 | 3,929,834 | 97.17% | 13,607,293 |
| High wind | 150,349,290 | 53,262,282 | 64.57% | 10,040,924 |

All 720 instrumented tick comparisons match complete state and contact statistics. The work counter observes zero new motion-bound arrays after warmup in these fixed-topology windows (previously 2.69–6.46 million per window). For N target features, total cached candidate IDs are capped at max(256, 32N) and query records at max(256, 4N); dense inputs fall back to traversal. The search margin affects candidate work only, not the 3 mm response thickness or 1 micrometre crossing margin.

These counts exclude other costs such as containment checks, narrow-phase geometry, constraints and rendering. Raw profiler timings remain diagnostic: unchanged/sham timing controls have not qualified a new CPU or FPS multiplier on this shared machine. The initial flat-tree-only and cached candidates, their profiles and exact-state checks are retained alongside the final source.

The installed source passes **54 production tests** and full repository TypeScript. Its [native WebGPU/worker review](../benchmarks/experiments/canopy-contact-optimization-20260912-01/browser-review.json) completes at 30.01 seconds with 72 broken links, 13 events, zero reported final lag and zero overloads. Hero/reverse views, replay to the intact start and return to Live pass without a captured console error. The owned tab was closed and the original user tab preserved. This single runtime observation is not a controlled timing comparison.

## Verification

[The frozen numerical run](../benchmarks/experiments/canopy-contact-20260911-03/results.json) passes the full 30-second default tear, a 15-second high-wind/weak-connection case and a 12-second service-load case: 6,840 ticks. All accepted states are finite and every query resolves. All 60 independently sampled active-surface checks pass. The independent oracle uses Three.js segment/triangle queries and separate polygon clipping for coplanar overlap; it also checks the ground bound. The earlier oracle incorrectly counted shared mesh edges as crossings; that failure and the corrected shared-seam regression remain in the evidence.

The [high-wind continuation](../benchmarks/experiments/canopy-contact-20260911-03/high-wind-tail.json) also passes from its full 15-second checkpoint through 30 seconds, adding 1,800 accepted ticks. Combined coverage is **8,640 ticks and 75 distinct independently checked scene states**, with zero sampled intersections or unresolved queries.

[The 51-test run](../benchmarks/experiments/canopy-contact-20260911-03/final-tests.log) covers thin transits, moving faces, crossing edges, geometry degeneracy, hierarchy/exhaustive agreement, mass sharing, fixed anchors, topology deletion, floor friction, rejected-tick rollback, full checkpoints and both worker transports. [Legacy compatibility](../benchmarks/experiments/canopy-contact-20260911-03/legacy-compatibility.json) compares 72 complete checkpoints across 4,320 ticks per implementation for all three studies and both preceding backends, in addition to frozen non-press trajectory checks. Full repository TypeScript passes.

The live native WebGPU/worker check completed the default run at 30.01 seconds, displayed 72 broken links and 13 events, and passed a second-angle inspection, replay to the intact start and return to Live. No console error was captured. The owned test tab was closed; the user's original tab and existing loopback server were preserved. [Native review image](../benchmarks/experiments/canopy-contact-20260911-03/native-settled.png).

The initial live run, before the search optimization, ended **11.553 seconds behind wall time** while rendering remained responsive. Recorded Node elapsed times include the oracle and shared-machine effects; they are diagnostics, not a qualified speedup. Further work includes performance, friction against supports/fabric, moving-body coupling, all other cloth/rope engines, more extreme topology/motion cases and material calibration. No engine-wide 100x improvement is claimed.
