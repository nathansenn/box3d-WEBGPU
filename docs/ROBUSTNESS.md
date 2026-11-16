# Robustness: fuzzing, hostile input and the soak

What the engine promises when it is used wrongly, fed a hostile file or run for a long time, how that is tested, what
the tests found, and what is still open. The error contract itself is in [ERRORS.md](ERRORS.md).

## The contract

1. A call with an invalid argument throws an `EngineError` whose code is in the taxonomy and whose message names the
   field, the value and the accepted values. The world or solver is unchanged.
2. A file from outside (a scene, a share link, OBJ, STL, glTF, GLB, URDF, MJCF, a replay log, a checkpoint) either
   loads to data that is finite and in range, or is refused by an `EngineError` in bounded time and memory. Nothing
   outside the input is read: no file, no URL, no entity.
3. Valid use never produces NaN silently. Where the native solver can diverge on valid input (ND-2, ND-5 below), the
   world records the step in `stats().nonFiniteSince`, and a world created with `strict: true` throws
   `NUMERICAL_FAILURE` at that step.
4. Runs are deterministic, a checkpoint resumes bit for bit, and a recording replays bit for bit.

## Running it

| Command | What | Time (4 cores shared, load 20) |
| --- | --- | --- |
| `npm run test:fuzz` | the short, deterministic run; part of `validate:pr` | about 3.5 min including the kit build |
| `npm run fuzz:long` | 300 seeds for the rigid world, 2,000 scenes, 20 seeds of file mutations, the ten-minute soak | not in a gate |
| `npm run fuzz:soak` | the soak alone | 10 min |

Every case is named by a seed. A failure prints `rerun with FUZZ_SEED=<n>`; `FUZZ_SEED=<n> node scripts/fuzz.mjs short
tests/fuzz/<file>` replays exactly that case on any machine. `FUZZ_SEEDS=<n>` sets how many seeds, `FUZZ_TRACE=1`
prints each misuse call before it runs (the last line is the call that hung or trapped). No fuzzer uses
`Math.random`.

## What is fuzzed

| File (tests/fuzz) | Target | Invariants | Gate run |
| --- | --- | --- | --- |
| `world-misuse.test.mjs` | every public method of `PhysicsWorld` (61 with value arguments; a method without a row fails the test), `restoreCheckpoint`, `replay`, `startRecording`, a disposed world | one leaf of valid arguments replaced by each hostile value of its kind: refused with a taxonomy error and a byte-identical checkpoint, or accepted and finite two steps later | 17,820 hostile calls: 12,870 refused, 4,950 accepted healthy |
| `world-fuzz.test.mjs` | random programs through `PhysicsWorld`: all seven shape kinds, compounds, mass data, filters, flags, kinematic motion, forces, impulses, explosions, teleports, joints of every type and their setters, creation and destruction between steps, queries | after every step: no NaN or infinity in states, transforms, colours; unit rotations; handles of live rows alive, destroyed handles dead; counts agree; `diagnose()` clean. Checkpoint, continue, restore, continue again: equal digests. Recording replays in the same and a second world and after JSON. Same seed in two WASM instances and beside a busy neighbour world: equal digests. Heap constant after the second create/destroy cycle | 6 programs of 260 operations, 2,190 steps, 24 checkpoint windows, 6 recordings (811 commands), 12 cycles of 150 bodies |
| `scene-fuzz.test.mjs` | scene files and share links | valid random scenes: canonical text a fixed point and independent of key order, hash stable, links round-trip, load, save, reload give the same file and the same states after stepping. Mutated scenes: `validateScene` never throws, every problem has a JSON pointer that resolves, a scene that still validates loads and steps or is refused by a typed error. Hostile structure: prototype-pollution keys, cycles, 100,000 levels of nesting, sparse arrays of 2^32 entries, class instances; links cut at 300 places, 600 single-character changes, wrong length and checksum, a 256 MiB decompression bomb (refused after at most the 4 MiB cap), megabyte texts of near-links | 40 valid scenes (321 bodies), 43,158 mutated scenes: 33,439 rejected with a pointer, 9,719 still valid of which 120 loaded and stepped |
| `import-fuzz.test.mjs` | `parseOBJ`, `parseSTL`, `parseGLTF`, `parseGLB`, `parseXML`, `parseURDF`, `parseMJCF`, `robotToScene`, and the shape converters and a native world behind them | parse to finite, in-range data or refuse with a typed error within 3 s; what parses is welded, hulled, decomposed, made into bodies and stepped. Hand-made: billion laughs, external entities, DOCTYPE, `<include>`, mesh paths to `/etc/passwd` and `http://`, lying STL and GLB headers, accessor counts of 2^31, node cycles, 50,000-deep node chains, NaN and 1e999 coordinates, indices of 1e11, joint loops, 5,000 links | 700 random mutations of each of six formats plus the hand-made cases: 6,196 accepted with valid results, 5,317 refused |
| `solver-properties.test.mjs` | all 16 coupled example scenes (water and cables, frames, cloth, grains, solid contact, fracture, heat with thermal stress, fluid, free surface, shallow water) and five solvers directly | per scene: a checkpoint at a random step resumed in another WASM instance continues to the same solver state and body states; a second run from the scene is identical; no NaN in any field; the ledger identity `balance = total - exchanged`. The scene at 2, 4 and 8 times its step is refused by a typed error or runs finite. Directly: heat energy ledger to 1e-7 and mirror symmetry to 1e-8 K; shallow-water volume to 1e-9 and mirrored dam break; fluid momentum to 1e-7, divergence, mirror; grain momentum to 1e-9, energy ledger to 0.2 %, mirror to 1e-12 m; cloth free-fall momentum `m g t` to 1e-6, mirror to 1e-7 | one seed per scene; larger steps: 27 ran finite, 5 refused |
| `solver-misuse.test.mjs` | constructors and builders of heat, shallow water, fluid, free surface, grains, cloth, solid, the mesh and hull helpers, the material lookups | as for the world: typed refusal, or an object that steps once without NaN | 9,723 hostile calls over 20 rows |
| `error-taxonomy.test.mjs` | the taxonomy and `diagnose()` | every thrown code is listed and every listed code thrown; ERRORS.md current; each `diagnose()` rule fires with its numbers | - |
| `native-defects.test.mjs` | the native defects below | each states the correct behaviour and is an expected failure (`todo`); the TypeScript guards are tested | 5 expected failures |
| `soak.test.mjs` | seven coupled scenes and a rigid churn world in one WASM instance, with checkpoints, restores and reloads | bounds in the next section | 4 s in the gate, 600 s in `fuzz:long` |

Not covered: the Studio's own solvers outside `src/engine` shipped modules, the plate (`src/engine/plate.ts`), the
worker transport (`RemoteWorld`), the renderers, and public methods of the solver classes beyond construction and
`step` (about 480 methods; the 20 rows above are their entry points). Mirror symmetry is tested for heat, shallow
water, fluid, grains and cloth, not for the solid, fracture, cables, frames or the water basin.

## Soak bounds

`tests/fuzz/soak.test.mjs`, 600 s of wall-clock time: moored buoy, cable-stayed deck, buoy and crates, hopper and
seesaw (the four whose energy flows are all in the ledger), suspended platform, trampoline and river bend (energy
enters from outside the ledger: falling boxes, a ball, the inflow), each in its own world of one WASM instance, with a
rigid world beside them in which bodies of every kind are created and destroyed.

- No NaN in any solver field or body state. (Some fields hold infinity by design: a cloth that cannot tear has
  infinite strength, a fluid cell with no obstacle is infinitely far from one. They are listed in the test.)
- `balance = total - exchanged` to 1e-9 of the largest energy.
- In the four closed scenes the balance never rises above its start by more than 0.5 % of the largest energy seen.
  Measured over 25 s of simulated time: 0 for the buoy, the deck and the crates, 0.095 % for the hopper.
- Every 15th round a scene is checkpointed, stepped and restored: the state is the checkpointed one bit for bit.
- After the first quarter of the ten-minute run and at its end everything is torn down (every scene disposed, every
  world destroyed); the memory then still in use in the WASM heap rises by less than 1 MiB from the first teardown to
  the second, and the JavaScript heap, collected, grows by less than 48 MiB. Memory in use is the heap size less the
  free memory a probe finds by taking 64 KiB blocks until the heap would have to grow. Measured: 0.9 -> 1.0 MiB after
  a teardown over 600 s (11,991 rounds, 209,352 coupled steps, 71,946 churned bodies, 799 restores, 299 reloads).
  The heap's size is not the measure: in an earlier run it grew once, 16 to 24 MiB at about 609 s, while probes at
  rounds 500, 3000, 6000 and 9000 found 7.7, 12.3, 12.4 and 12.1 MiB in use; Box3D's pools and the solvers' scratch
  arrays keep their largest size, and the churn world's 40 random bodies can hold large meshes. While running, the
  memory in use rose in steps from 13.1 to 21.1 MiB, 14.3 MiB of it in the churn world, all of it returned by the
  teardown. A churn world alone for 40,000 rounds (240,000 bodies made and destroyed) held 7.7 MiB until about round
  8,000 and 10.4 to 10.5 MiB from then on; emptied it kept 10.5 MiB (Box3D keeps its arrays at their largest size),
  destroyed it left 1.0 MiB. A long-lived world therefore holds its high-water mark, not a growing total. The gate's
  four seconds only report the numbers.

Observed in the same measurement, and not a defect: the ledger balance of the suspended platform rises by 39 % of its
scale when the boxes land (their energy is not tracked), and the river bend's by 78 % (the inflow adds water whose
energy is not in `exchanged`).

## Bugs found and fixed

All in TypeScript. Severity: what a caller who meets it suffers.

| # | Severity | What | Fix |
| --- | --- | --- | --- |
| B-1 | high | `overlapSphere` and `overlapBox` threw `INVALID_BACKEND` whenever a compound body with two or more shapes was in range: the bridge reports one hit per shape and the adapter read the repeat as an unordered result. `TriggerSet` is built on these queries | the adapter merges repeats of one body (`native-world.ts`) |
| B-2 | high | `replay()` of a log with `ticks: Infinity` (or any absurd count) stepped forever; a log could also call any method by name through `op: 'call'` only after partial checks | the whole log is checked before the world is touched: types, order, a bound of 2^31 - 1 ticks, the list of replayable calls |
| B-3 | high | Finite but extreme values were accepted and turned the world into NaN within two steps: gravity, velocities, forces, impulses, gravity scale, density, explicit mass and inertia, centre of mass, joint spring and stiffness values, joint frames, explosion strength | `RIGID_LIMITS`: one table of accepted ranges, checked by the world and by `validateScene` (ERRORS.md) |
| B-4 | medium | Wrong types reached the WASM or threw `TypeError` from inside: `null` options for `createBody`, `createJoint`, `spawnBox`, `reset`, queries; filter bits that are not bigints; vectors of the wrong length; a non-object joint frame, motor, limits or spring; `seed` of any type silently coerced | every public rigid call checks the shape of its arguments first |
| B-5 | medium | `__proto__` as a key of `userData` or `extensions` was dropped by `canonicalize` and `normalizeScene` and became the prototype of the copy; `__proto__` as a material name or id replaced the prototype of the materials table, so the material vanished on save | own-property writes in the scene module; `__proto__` refused as an id |
| B-6 | medium | `parseXML` was quadratic for a document with no line breaks: 300,000 elements on one line took 9 s to refuse | the line counter keeps the next line break instead of searching for it from each element |
| B-7 | medium | An MJCF `<include file="...">` was silently ignored, so a model lost whatever the include held | refused with a message that says to paste the included elements |
| B-8 | low | `robotToScene` could return a scene that `validateScene` rejects (a file with a 1e19 kg m^2 inertia) | the robot's numbers are checked against `RIGID_LIMITS` with the link or joint named |
| B-9 | low | A sparse array as `boxMesh` size, cells or origin, or as `eulerToQuaternion` input, gave NaN (`map` and `every` skip holes) | `Array.from` and index loops |
| B-10 | low | `granularLattice`, `clothGrid`, `convexHull`, `toHullShape`, `weldVertices`, `spawnRobot`, `new Cloth`, `new ShallowWater`: `null` or missing options threw `TypeError` from inside; grain gravity of 1e30 gave NaN | argument checks at the top of each |
| B-11 | low | `shallow-water.ts` threw the code `INVALID_ARGUMENT`, which no other module uses | `INVALID_PAYLOAD` |
| B-12 | low | The kit's helpers threw `RangeError` and `TypeError` (`FixedStepLoop`, `spawnBoxes`, `applyImpulses`, `BodyRing`, `writeInstances`, `mountInspector`, worker endpoints) | `EngineError` with the offending value |
| B-13 | medium | OBJ and ASCII STL coordinates that are finite as doubles but beyond single precision (`1e39`) were accepted, and became infinite vertices in Box3D's float32 mesh. Found by `npm run fuzz:long` | the parsers refuse a coordinate whose float32 value is not finite (`geometry.ts`) |
| B-14 | low | `robotToScene` passed on a negative or enormous friction or restitution (an MJCF `friction="-2147483649"`) and velocities beyond the speed limit, giving a scene `validateScene` rejects; same class as B-8. Found by `npm run fuzz:long` | `checkRanges` checks friction, restitution and velocities (`robot-import.ts`) |
| B-15 | medium (tests) | The fluid property test in `solver-properties.test.mjs` checked nothing in the gate: both gate seeds chose a step above the explicit viscous limit and were skipped as refused, and its mirror comparison called `velocityAt([x, y, z])` instead of `velocityAt(x, y, z)`, which `fuzz:long` exposed as NaN | the step is chosen within both limits, the call fixed, and the test fails if any seed is skipped |
| B-16 | low | When Box3D's own builders refused a mesh, hull or height field, the message was "The native bridge rejected the body descriptor" | the message names the geometry and what is wrong with it |

Behaviour that changed as a result, and the tests updated for it: positions beyond 100 km, convex shapes beyond 1 km,
densities between 0 and 0.001 kg/m^3 and the other values outside `RIGID_LIMITS` are now refused where they were
accepted; `packages/box3d-kit/test/v12-scene.test.mjs` (a position of 1e21 and a height of 490,000 m used as test
data, one message, one case added), `v04.test.mjs` and `world.test.mjs` (`RangeError` to `EngineError`). No scene,
example or recipe hash changed.

## Native defects (not fixed here)

In Box3D or the C bridge `wasm/box3d_web.c`, which this work does not change. Each has an expected-failure test in
`tests/fuzz/native-defects.test.mjs` with a minimal reproduction.

| # | Severity | What | Guard in TypeScript |
| --- | --- | --- | --- |
| ND-1 | high | Box3D's step does not return for a cube with half extents of about 5 km or more resting in the ground (3 km returns, 5 km does not) | convex shapes are limited to 1 km |
| ND-2 | high | Joints that contradict each other on one body (a hinge to an anchor 4 m away, a wheel joint, and a second wheel joint to the world with limits, a spring and a motor) give NaN within four steps; Box3D logs "unstable" and continues | none before the step; `nonFiniteSince`, and `NUMERICAL_FAILURE` in a strict world |
| ND-3 | medium | `b3w_world_restore` keeps the world's handle table by row whenever the world has no more bodies than the checkpoint. After a body was destroyed since the checkpoint the rows have moved, so kept handles name other bodies and the destroyed body's handle stays dead. The physical state is exact | none; read handles again with `bodyAt()` after a restore (docs/CHECKPOINTS.md) |
| ND-4 | low | Overlap queries report one hit per shape: for a compound, `totalHits` and `overflow` count shapes, and a limit can be used up by one body | repeats are merged; with a limit below the shape count `overflow` is still true for one body |
| ND-5 | high | Jointed mechanisms diverge in about one random program in 150 with every input in range and no `diagnose()` warning (4 of 603 programs at the default seed base: seeds 21702374, 21741969, 20427415, 20878798). Much more often when a joint frame is far from its body or one end of a joint is teleported metres away | the `joint-lever` rule of `diagnose()`; the programs avoid both; caught as for ND-2. `world-fuzz.test.mjs` counts caught divergences against an allowance of 3 % of programs and fails above it or when a program without joints diverges |

Also observed, by design rather than a defect: a joint handle made after a checkpoint is invalid after restoring it,
and comes alive again when a later joint receives the same Box3D id; the world's checkpoint bytes include its handle
table, so two worlds with different histories give different bytes for equal physical states (the fuzzers compare
body states and solver state trees instead).

## Known gaps

- `tests/fuzz/solver-misuse-known.json` lists 18 classes of lenient acceptance in the solver builders, none of which
  throws a built-in error or produces NaN: a vector of the wrong length or a typed array where three numbers are
  expected (grains, cloth, fluid, shallow-water bed, mesh indices), a fractional iteration count (fluid, cloth), a
  non-object as hull options. The test fails when a class is fixed without being removed from the list, or a new one
  appears.
- 42 built-in `RangeError` and `TypeError` throws remain in 12 engine files (the water modules, the couplings'
  constructor checks), listed by file in `error-taxonomy.test.mjs`.
- Two refusals come after the native side has already made and removed a body: a hull so thin that its mass rounds to
  zero, and geometry that Box3D's own builders reject. The world is physically unchanged, but a body slot's
  generation has advanced, so its checkpoint bytes differ from before the call.
- Pure formula helpers (`ritterDamBreak`, `thermalStrain`, `hertzContactDuration` and the like, about 60 functions)
  return NaN for NaN input, as arithmetic does; they are not in the misuse tables.
- A hand-built `RobotDescription` is checked for its outline only (`links`, `joints`, `root`); descriptions come from
  the parsers.
- A scene object that is a `Proxy` with throwing traps can make `validateScene` throw whatever the trap throws; JSON
  cannot produce one.
