// The hand-written part of the engine comparison: what each scene is, what each engine cannot do, how the numbers
// were taken. report.mjs copies these texts into public/benchmarks/benchmarks.json and docs/BENCHMARKS_ENGINES.md,
// next to the measured numbers. Nothing here is a measurement: a number in these texts that comes from a run is
// marked with the file that produced it.

export const METHOD = [
  'Every engine receives the same scene: the same shapes, poses, masses (density times volume), friction 0.5 and restitution 0 on every body unless the scene says otherwise, gravity 9.81 m/s^2, step 1/60 s. Linear and angular damping are set to 0 in every engine (Jolt, PhysX, Havok and cannon-es ship non-zero defaults). Scenes come from a seeded generator in `benchmarks/engines/scenes.mjs`.',
  'Each engine runs twice: with the solver settings its own documentation gives as the default ("default" rows), and with 8 solver passes per step ("equal budget" rows; the engines table says which setting that is in each engine). Havok exposes no solver setting, so it has one row.',
  'Every heavy scene (piles, terrain, ragdolls, ray casts) is measured in a fresh Node process on one thread; the light scenes of one engine share one process per repeat, so peak memory is reported for the heavy scenes only. A small copy of the scene is built and stepped 60 times first (warm-up), then the measured world is built. Construction time is world creation, all bodies and joints, and the first step. The step statistics cover every later step of the run (179 steps for a 180-step scene). Six measurement processes run at a time. Light scenes are repeated 5 times; heavy scenes 3 times, the 5,000-body scenes and the large ray-cast scene twice and the 10,000-box pile once (each pass over the engines costs minutes of CPU there); every table gives the number of repeats behind a row.',
  'A step is timed by two clocks: the CPU time the process used, and the wall clock. The tables show CPU time, because the machine was shared: a process that waits for a core accumulates wall time but no CPU time. On a quiet machine the two agree. The published JSON holds both.',
  'Node runs with `--no-liftoff`: every WebAssembly function is compiled by the optimizing compiler when first called, so the warm-up pays for compilation. With V8\'s default tiering the optimized code arrives from background threads, which a busy machine starves; the same 1,000-box Rapier run measured 15.4 ms per step with tiering and 7.9 ms without (one run each, load average 15).',
  'Runs are interleaved: within one repeat, each scene is run by every engine before the next scene starts. The ratio to this engine is taken inside each repeat and the median over the repeats is reported, so slow drifts of machine load cancel.',
  'In timing scenes every body is kept awake in every engine (sleep disabled per body), so the numbers compare solvers and not sleep policies. Sleeping is measured separately on the two "default sleep policy" pyramids.',
  'A run that exceeds its time budget (20 s of CPU time in steps; 60 s for the 10,000-box pile) is stopped and reported as "timed out" with the mean over the steps it finished; it is not repeated. A run that throws is reported as failed with the error. No row is dropped.',
  'State hashes are FNV-1a over the float32 bits of every body position and rotation at the end of a run (float64 bits for cannon-es). "Repeats identical" means the separate processes of one engine ended in the same state bit for bit.',
  'Quality numbers are read from the engine state between steps, outside the timed region. Closed forms: energy of a frictionless pendulum is constant; its period for a 90 degree release is 4 sqrt(L_eff / g) K(sin 45 deg) with L_eff = L + 2 r^2 / (5 L); a sphere dropped from h with restitution e rebounds to e^2 h; an ideal chain does not stretch; rigid boxes do not overlap.',
];

export const SCENE_NOTES = {
  'pyramid-10': 'A flat pyramid of 0.5 m cubes (125 kg each), 10 in the bottom row, 2.5 cm apart sideways, resting. Sleep disabled: the cost of solving a resting stack.',
  'pyramid-20': 'The same pyramid 20 rows high.',
  'pyramid-10-sleep': 'The 10-row pyramid with each engine\'s own sleep policy, 5 s. Reports how far any box moved and when the last body fell asleep.',
  'pyramid-20-sleep': 'The 20-row pyramid with each engine\'s own sleep policy, 5 s.',
  'boxes-1k': '1,000 cubes of 0.5 m, slightly tilted, on a jittered lattice 0.75 m apart vertically, fall into a walled pit and pile up. 3 s.',
  'boxes-5k': 'The same with 5,000 cubes (18 x 18 per layer, 16 layers).',
  'boxes-10k': 'The same with 10,000 cubes (22 x 22 per layer, 21 layers): a pile about 10 m deep.',
  'spheres-5k': '5,000 spheres of radius 0.25 m in the same arrangement.',
  'capsules-2k': '2,000 capsules (radius 0.15 m, 0.7 m long) with random orientations.',
  'hulls-1k': '1,000 convex hulls: an icosahedron (12 points) stretched to four proportions, random orientations.',
  'trimesh-2k': 'A static triangle mesh of rolling hills in a shallow bowl (63 x 63 cells of 1 m, 7,938 triangles) and 2,000 boxes, spheres and capsules dropped 2 to 4 m onto it.',
  'heightfield-2k': 'The same terrain as a height field (64 x 64 samples) with the same 2,000 bodies.',
  'ragdolls-100': '100 ragdolls of 11 bodies each (boxes, a sphere, capsules; about 70 kg) with 6 ball joints (cone and twist limits) and 4 hinges (limited to +-1.2 rad), tilted and dropped on the ground. Jointed parts do not collide with each other.',
  'chain-100': '100 spheres (0.27 kg each) joined by ball joints hang from a fixed point, with one sphere of 100 times the mass at the end. The chain starts in its rest pose, so any motion is solver error. 5 s. Stretch is the extra distance of the end mass from the fixed point, as a share of the chain length.',
  'chain-1000': 'The same with 1,000 links (100 m of chain; the top joint carries 1,100 link weights).',
  'stack-10': 'Four 10 kg cubes with one 100 kg cube on top (1:10). Penetration is the largest overlap between neighbours while the stack stands.',
  'stack-100': 'Four 10 kg cubes with one 1,000 kg cube on top (1:100).',
  'stack-1000': 'Four 10 kg cubes with one 10,000 kg cube on top (1:1000).',
  'pair-1000': 'One 10 kg cube under one 10,000 kg cube (1:1000).',
  'bullets': '50 spheres of radius 5 cm at 200 m/s (3.3 m per step) against a 2 cm static wall, and 50 against a 2 cm dynamic steel plate (11.5 t). Continuous collision is switched on the way each engine documents it. A bullet behind the wall at the end has tunnelled.',
  'pendulum': 'A 4.2 kg sphere on a hinge to the world, 1 m arm, released from horizontal, no friction or damping, 10 s. Energy must stay at its initial value; the period has a closed form.',
  'bounce': 'A sphere dropped 2 m onto the ground, restitution 0.5 on both. The first rebound must reach 0.5 m.',
  'raycast-10k': '10,000 bodies (boxes and spheres) on a jittered lattice; 100,000 rays from a sphere around it towards points inside, nearest hit only. Best of three passes. The hit count and the mean hit distance show that the engines saw the same scene.',
  'raycast-200': 'The same rays against 200 bodies: most of the time is the cost of calling into the engine once per ray, or once per batch where the engine has a batch call.',
  'probe-trimesh': '180 vertical rays onto the bare triangle-mesh terrain: the largest difference between the hit and the height the scene defines there. Checks that every adapter placed the terrain where the others have it.',
  'probe-heightfield': 'The same check for the height field.',
};

export const ENGINE_NOTES = {
  box3d: [
    'The kit\'s PhysicsWorld on `public/box3d/box3d.wasm` (Box3D v0.1.0 compiled with WASM SIMD), `interpolate: false` because nothing is rendered.',
    'At most 65,536 bodies per world, 64 hull points per shape, 128 rays per query batch.',
    'A convex hull body builds its own hull: the kit has no way to share one hull between bodies.',
    'The threaded artifact `box3d-mt` is not in this comparison. It runs in Node, but the machine was shared (load average 13 to 20 on 4 CPUs), so a wall-clock speed-up could not be measured; `docs/THREADED_ENGINE.md` has the earlier measurements (1.4 to 2.8 times for 4,096 to 16,384 awake bodies on 4 to 8 workers, taken under load).',
  ],
  'rapier-simd': [
    'The `-compat` packages inline the WASM as base64; the size given is the WASM itself as found in the package.',
    'The JS bindings expose no cone or twist limit on ball joints: the ragdolls\' ball joints are unlimited in Rapier.',
  ],
  rapier: [
    'The same engine without WASM SIMD (the package the task names). Same remarks as the SIMD build.',
  ],
  jolt: [
    'The npm build exported by default is single-threaded without SIMD (the package readme: SIMD is on in the multi-threaded builds only).',
    'The build has a fixed 128 MB heap and a 10 MiB temporary allocator (`JoltJS.h`; npm 1.1.1 has no setting for it). Contact constraints are allocated from it each step at about 496 bytes each, so more than about 20,000 abort the module. The adapter caps `mMaxContactConstraints` at 16,384; scenes that need more contacts lose the excess.',
  ],
  'physx-tgs': [
    'PhysX with the TGS solver, which the PhysX guide calls "generally the recommended solver".',
    'The npm build targets browsers only; the adapter hides `process` while the module starts so the same WASM runs in Node. Its JavaScript glue is built with assertions, which costs time on each call into the engine (construction, state read-back, ray casts), not inside a step.',
    'The binding offers `scene.raycast` only with a touch buffer and without a filter callback, so PhysX reports every shape on a ray; the adapter takes the nearest. A closest-hit query would do less work.',
  ],
  physx: [
    'PhysX with its default PGS solver. Same remarks as the TGS row.',
  ],
  havok: [
    'Used through the HP_* interface that Babylon.js\'s HavokPlugin calls. The interface exposes no solver iterations, sub-steps or continuous-collision switch.',
    'Licence: the package ships an MIT LICENSE file and the Babylon.js documentation says "It is available free to use under the MIT license"; neither restricts benchmarking.',
    'Ball-joint limits are per-axis angle limits (a pyramid), not a cone.',
  ],
  ammo: [
    'ammo.js wraps Bullet 2.82 (its readme). Bullet multiplies the two bodies\' friction and restitution, so each body is given the square root of the scene value.',
    'The world set-up (broad phase, solver, continuous-collision calls) is written from memory of the Bullet manual and demos; only the ammo.js readme was opened for this work.',
    'Default 0.04 m collision margin kept; it makes shapes slightly larger, which is why ammo.js reports a few more ray hits than the others.',
  ],
  cannon: [
    'Pure JavaScript, double precision.',
    'No capsule shape: a capsule is a compound of a 12-sided cylinder and two spheres.',
    'A Trimesh collides only with spheres and planes, so boxes and capsules fall through the mesh terrain.',
    'Hinges have no angle limits: elbows and knees use ConeTwistConstraint. No continuous collision detection.',
    'Sleeping is off by default; the two sleep-policy scenes switch `allowSleep` on.',
  ],
};

// What was changed on the JavaScript side after the first measurements, and what is left for the C side.
// Written by hand from the profiles; every number names the command that produced it. The profiles were taken on the
// same shared machine as the comparison (load average 13 to 20), as CPU time.
export const ACTIONS = {
  optimizations: [
    {title: 'Ray casts from flat arrays: `castRays()`', text: [
      'Profile (`node --no-liftoff --cpu-prof benchmarks/engines/child.mjs --engine=box3d --scene=raycast-10k`, object path): 80 % of the time in WASM, 13 % in JavaScript that exists only to pass rays in and hits out as objects (`queryVector` 5.9 %, `queryBatch` 2.2 %, garbage collection 1.8 %, `validateQuery`, `onlyKeys`, `wrapBody`).',
      'Change: `PhysicsWorld.castRays(origins, translations, fractions, {points?, normals?, bodies?, filter?})` and `NativeWorldBackend.castRays` write the rays into the bridge\'s query arena through typed-array views and read fractions, points, normals and body tokens back the same way, 128 rays per bridge call, with no object per ray or per hit. `src/engine/native-world.ts`, `packages/box3d-kit/src/world.ts`.',
      'Same answers: each ray gives exactly the first hit of `raycast()` for the same float32 inputs; `packages/box3d-kit/test/v21-ray-batch.test.mjs` compares fraction, point, normal and body bit for bit over boxes, spheres, capsules, hulls, a compound, a mesh and a height field, with filters, across the 128-query boundary. The WASM is unchanged, and no existing hash moved.',
      'Measured (`BOX3D_RAYS=objects` against the default in the same harness, 100,000 rays, CPU time of the best of three passes, two runs each, alternating): 200 bodies 482 to 564 ms before, 252 to 257 ms after; 10,000 bodies 2,506 to 2,887 ms before, 1,961 to 1,985 ms after. Hit count and mean hit distance identical (78,260 hits; 97,457 hits). The tables above use `castRays()`.',
    ]},
    {title: 'Looked at and left alone', text: [
      'Step wrapper: with a contact listener that receives every event (34 events per step in the 1,000-box pile) or with the interpolation copy switched on, the step cost of `PhysicsWorld.step()` did not move outside run-to-run noise (5.4 to 6.5 ms per step in all three modes; scratch script stepping the pile three ways). Nothing to fix.',
      'Construction: 10,000 boxes are created in 41 ms once the code is warm (4.1 microseconds per body; 1,101 ragdoll bodies and 1,000 joints in 5.5 ms), about half of it in WASM. The first build in a process costs several times more because V8 is still compiling. Not changed.',
      'Joint stiffness is settable from JavaScript today, and it is the lever for chains. Measured with the kit (hanging chain scenes of this comparison, 5 s): 1,000 links at the defaults (4 sub-steps) stretch 113 %; at 8 sub-steps with `stiffness: {hertz: 120}` 37 %; at 16 sub-steps with `stiffness: {hertz: 480}` 3.8 % (5.9 to 6.7 ms per step instead of 2.2). 100 links: 12.7 %, 7.2 %, 1.5 %. At 4 sub-steps the option changes nothing, because Box3D caps a joint\'s stiffness at a quarter of the sub-step rate (`src/joint.c`: `min(constraintHertz, 0.25 * inv_h)`), which is the 60 Hz default. The defaults were not changed: that would change every existing scene with joints.',
    ]},
  ],
  recommendations: [
    {title: '1. Stop a nearest-hit ray at its hit', text: [
      'Where: `wasm/box3d_web.c`, `b3w_query_cast_callback` ends with `return 1.0f; // Visit all candidates: exact total count and deterministic ties.` Every ray therefore tests every shape along its whole length, also when the caller asked for one hit.',
      'Change: give the query input a "nearest only" bit (the `reserved` word of `B3WQueryInput` is free) and, when it is set and `limit == 1`, return the hit\'s `fraction` so that Box3D clips the ray. `totalHits` and `overflow` cannot be exact in that mode and should be documented as "at least"; the default mode stays as it is. Check equal-fraction ties against the current order (body token, triangle, child) before relying on bit-identical results with the unclipped path.',
      'Expected gain: the engines that stop at the nearest hit are the reference. On the 10,000-body scene Havok, Rapier (SIMD) and Jolt take 540, 637 and 749 ms for 100,000 rays where this engine takes 2,718 ms with `castRays()`, of which the profile puts 80 % or more in the WASM traversal. An estimate from those numbers, not a measurement: 2 to 4 times on dense scenes, little on sparse ones (against 200 bodies this engine is already within 4 % of the fastest).',
    ]},
    {title: '2. Let the sub-step rate raise the joint and contact stiffness', text: [
      'Where: Box3D caps joint stiffness at 0.25 times the sub-step rate (`src/joint.c`) and contact stiffness at 0.125 times it (`src/physics_world.c`), and the bridge leaves the defaults (joints 60 Hz, contacts 30 Hz, push-out 3 m/s) for every sub-step count. At the default 4 sub-steps both caps equal the defaults; at 8 or 16 sub-steps the defaults are what limits quality, so the equal-budget rows of this engine barely improve.',
      'Change: export `b3w_world_set_contact_tuning(world, hertz, dampingRatio, pushSpeed)` around `b3World_SetContactTuning` (`include/box3d/box3d.h`), and a world-level default for joint stiffness, so that the kit can offer `createWorld({subSteps: 8, stiffness: \'match-substeps\'})` or similar without touching existing worlds. Keep today\'s values as the default so no hash changes.',
      'Expected gain, joints: measured from JavaScript with the per-joint option (see above): the 1,000-link chain goes from 113 % stretch to 37 % at 8 sub-steps and 3.8 % at 16. Contacts: not measurable without the export; the 1:100 stack\'s 57 mm of overlap at 30 Hz is the case to test.',
    ]},
    {title: '3. Large piles: the time is inside Box3D\'s solver and narrow phase', text: [
      'Profile of the 5,000-box pile on a scratch build of the same sources with `--profiling-funcs` (function names; not shipped, `public/box3d` untouched): `b3ExecuteBlock` 31 %, `b3CollideTask` 30 %, `b3SolveContacts_Convex` 15 %, `b3GatherBodies` 6 %, everything else under 2 % each. The bridge is not in it: `b3w_world_step` (the transform stream it rebuilds every step) is 0.4 %. For hulls the narrow phase leads: `b3CollideTask` 26 %, `b3QueryEdgeDirections` 12 %, `b3ExecuteBlock` 13 %.',
      'So the gap to Havok on piles (see "Where this engine stands") is not bridge or JavaScript overhead. What the bridge can offer: (a) the threaded artifact `box3d-mt` for large scenes (`docs/THREADED_ENGINE.md`; not measured here because the machine was shared and wall-clock scaling could not be observed); (b) fewer sub-steps as a per-world choice: the 1,000-box pile costs 6.8 to 7.5 ms per step at 4 sub-steps and 5.0 to 5.5 ms at 2 (scratch runs on the profiling build), with softer stacks. Build flags were not explored: the artifact is built `-O3 -flto -msimd128` and uses Box3D\'s SSE2 path through Emscripten.',
    ]},
    {title: '4. Smaller items', text: [
      'World capacity: the three `b3DefaultWorldDef()` call sites in `wasm/box3d_web.c` leave `worldDef.capacity` empty. `reserveBodyCapacity(n)` already tells the bridge how many bodies to expect; passing that as `capacity.dynamicBodyCount`, `dynamicShapeCount` and a contact estimate would remove array growth while a large scene is built. Expected gain: a share of construction time only (41 ms for 10,000 boxes warm, half of it in WASM); not measured.',
      'Hulls: `b3w_world_create_hull_body` computes a hull for every body and the shape keeps its own copy. A cache keyed by the points (as the 8-entry box-hull cache already does for boxes) would save the hull computation when many bodies share a shape. Construction of the 1,000-hull pile: 52 ms here, 16 ms in Jolt and 29 ms in PhysX, which both share one hull per shape.',
      'A `__vfprintf_internal` frame shows up in the hull pile\'s profile (0.6 %): something formats a string while bodies are created or stepped. Worth finding.',
    ]},
  ],
};
