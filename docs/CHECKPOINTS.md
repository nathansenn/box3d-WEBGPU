# Exact checkpoints

A checkpoint is the complete state of a running simulation, written between two steps. Restoring it, in the
same page or in a fresh one, makes every later step **bit-identical** to the run it was taken from: the rigid
world, every coupled solver, their histories, warm starts, clocks, counters, ledgers and event cursors. This is
the Phase 1 roadmap item "Solver state save and load".

A saved **scene** ([`SCENE_FORMAT.md`](SCENE_FORMAT.md)) is something else: a document of initial conditions that
people read, edit and share. It carries poses, velocities and the solvers' fields, not their internal state, so a
run resumed from a saved scene drifts away from the one that was saved. A checkpoint is opaque and exact.

```js
import {createWorld} from 'box3d-webgpu-kit';
import {loadSimulationScene, resumeSimulation} from 'box3d-webgpu-kit/simulation';
import {COUPLED_EXAMPLE_SCENES, sceneWorldOptions, normalizeScene} from 'box3d-webgpu-kit/scene';

const scene = COUPLED_EXAMPLE_SCENES['moored-buoy']();
const world = await createWorld(sceneWorldOptions(scene));
const run = loadSimulationScene(world, scene);
for (let i = 0; i < 240; i++) run.simulation.step();
const bytes = run.simulation.checkpoint();          // Uint8Array, carries the scene

// Later, anywhere (another page, another process): the same build of the kit.
const fresh = await createWorld(sceneWorldOptions(scene));
const resumed = resumeSimulation(fresh, bytes);     // loads the scene, then restores
resumed.simulation.step();                          // bit-identical to run.simulation's next step
```

In the Physics Lab (`lab.html`), the Scenes panel has **Save checkpoint** (a `.b3ck` file) and **Load
checkpoint…** next to *Download scene*. Loading a checkpoint rebuilds its scene and resumes the run where it was
saved; a `.b3ck` file dropped on the page does the same.

## API

| Where | Call | What |
|---|---|---|
| `Simulation` (`src/engine/simulation.ts`, kit `box3d-webgpu-kit/simulation`) | `checkpoint({scene?})` | The world's checkpoint, every subsystem's `checkpoint()`, the clock and the `update()` accumulator. Carries the scene the simulation was built from unless `{scene: false}`. |
| | `restore(bytes)` | Refuses (nothing changed) a damaged file, another format version, a checkpoint of another scene, or another set-up (step, sub-steps, subsystem ids, kinds, stages, order or timing); then restores the world, every subsystem and the clock. |
| | `simulationCheckpointInfo(bytes)` | Version, SHA-256, size, tick, time, scene hash, the scene text, the subsystems. |
| | `resumeSimulationScene(world, bytes)`; kit `resumeSimulation(world, bytes)` | Load the scene the checkpoint carries into `world` (reset first), then restore. |
| `Subsystem` contract | `checkpoint()` / `restore(state)` | Every adapter has them; `Simulation.checkpoint()` refuses a subsystem without them. |
| `PhysicsWorld` (kit) | `checkpoint()` / `restoreCheckpoint(bytes)` | The native world (below), the step count, the fixed-step accumulator and the dropped-event count. Not while recording. |
| `RemoteWorld` (kit `box3d-webgpu-kit/worker`) | `checkpoint()` / `restoreCheckpoint(bytes)` | The same, for the world in the worker. |
| `NativeWorldBackend` (`src/engine/native-world.ts`) | `checkpoint()` / `restoreCheckpoint(bytes)`, `supportsCheckpoints` | The bridge's checkpoint; optional exports, an older artifact reports `UNSUPPORTED_BACKEND`. |
| Lab host (`src/lab/scene-host.ts`) | `LabSceneHost.checkpoint()` / `restoreCheckpoint(bytes)` | The same layout as the kit's `PhysicsWorld` (kind `world`). |
| Solvers | `saveState()` / `restoreState(state)` | On `WaterCoupling`, `StructureCoupling`, `CompliantCableRuntime`, `FrameRuntime`, `HeatSolver`, `SolidBody` (with its viscoelastic stress history), `FractureBody`, `PlateBody` (`src/engine/plate.ts`; not a subsystem yet), `SolidContact`, `SolidCoupling`, `Cloth`, `ClothCoupling`, `Granular`, `GranularCoupling`, `Fluid`, `FreeSurfaceFluid`, `FluidCoupling`. In place: a coupling that holds the solver keeps holding it. The cable's and frame's older `checkpoint()` / `fromCheckpoint()` (a JSON copy into a new runtime) are unchanged. |
| `src/engine/checkpoint.ts` (kit re-exports `CHECKPOINT_VERSION`, `CHECKPOINT_ERROR`, `checkpointInfo`) | `writeCheckpoint`, `readCheckpoint`, `encodeState`, `decodeState`, `captureFields`, `restoreFields`, `sha256` | The format and the field walker below. |

A refused checkpoint throws an `EngineError` with code `CHECKPOINT_MISMATCH` and a message that says why ("taken from
another scene", "damaged: its SHA-256 does not match", "format version 2; this build reads version 1", "the
subsystems [...]", ...).

## The rigid world

Box3D v0.1.0 keeps a lot between steps: each contact's manifolds with their normal and tangent impulses (warm
starting), anchor points and feature ids; the constraint graph colouring, which fixes the order the solver visits
contacts; islands, sleep timers and the sleeping solver sets; joints with their accumulated impulses; sensors and
their overlaps; three broad-phase trees, the move buffer and the pair set, whose layout decides the order new
contacts are found; and the id pools with their free lists, which decide the ids new contacts and islands get.
Setting positions and velocities restores none of it, which is why a resumed scene drifts.

Three ways were considered:

- **(a) Copy the world's memory.** Box3D allocates through one global allocator and keeps pointers, so the world's
  memory is not one region and would only be valid at the same addresses in the same module. Rejected.
- **(b) Record and replay from the last keyframe.** Exact by construction, but a resume costs the replay of every
  step since the scene was loaded, and every coupling force applied in between must be in the log.
- **(c) Export and import the state through the bridge.** Chosen, because Box3D already has the code: its
  recording player restores a *keyframe* in place when it seeks backwards (`src/world_snapshot.c`,
  `b3SerializeWorld` / `b3DeserializeIntoShell`), and it checks the world's state hash on every frame after such a
  seek. The image holds all of the above as plain arrays with integer ids, plus the geometry (hulls, meshes, height
  fields, compounds) interned in a registry by content.

`wasm/box3d_snapshot.c` is the only bridge source that includes Box3D's internal headers. It wraps the two calls in
a self-contained image (the snapshot, then the registry), zeroes the one pointer the snapshot leaves in it (a
shape's address of its hull or mesh) so that equal states give equal bytes, and clears the world's event buffers
after a restore so that events of the overwritten world are not reported. The restored mesh and height-field
shapes use the registry's copies of their geometry, which the bridge keeps until the world is destroyed or
restored again.

`wasm/box3d_web.c` adds four exports (`b3w_world_checkpoint`, `b3w_world_checkpoint_ptr`,
`b3w_world_checkpoint_free`, `b3w_world_restore`). Its checkpoint is a 48-byte header, the bridge's body table
(rows, render matrices and colours, shape kinds, dynamic rows, body slots, mass data set by hand, the random
generator) and the snapshot. A restore validates everything before it changes anything, then overwrites the world
in place. When the world's rows are the checkpoint's first rows (it was built the same way, as loading the scene
does; bodies the run added later, such as the Lab's projectiles, are extra rows at the end), each row keeps the
handle it has in *this* world and each extra row gets a new one, so the body and joint handles the caller holds
stay valid even in a world that hosted other scenes before (its slots carry other generations); otherwise the
checkpoint's handle table is taken. Body user data (the bridge's slot) and the world index in body ids are written
for the world the checkpoint lands in.

The world API version stays 1; nothing that existed changed, and the scene recipes, render streams and hashes are
what they were.

## The solvers

Each solver's `saveState()` walks its own fields (`captureFields` in `checkpoint.ts`): every number, boolean,
string, typed array, array and plain object it holds is saved; functions and frozen objects (configuration, body
handles) are constants; every other object must be named, either as not this solver's state (the world, the
bodies, a solver it only reads) or with a handler (the bodies a coupling holds, a solver held by a coupling). An
object field that is neither makes `saveState()` throw, so a field added later cannot be left out silently.
Restoring writes into the live arrays when type and length match, so other objects that hold the same array keep
seeing it, and refuses a state with a field the object does not have or without one it has. The heat solver keeps
its state in private `#` fields and has an explicit list instead.

| Subsystem | What is saved |
|---|---|
| Water coupling | Surface, face velocities, the displaced volumes of the step before (the volume source), gravity, step count, every attached body's report (submerged volume and centre, buoyancy, drag, the "fresh" flag), the momentum ledgers. |
| Structure coupling | Each body carrier's rigid state, inverse inertia and pending impulses; each attachment's multipliers, Jacobians, reference pose and reports; each frame carrier's interface operator (`W`, `P`, `Waug`), multipliers and interface loads; every cable's and frame's full state through them (positions, velocities, masses and inverse masses as attachments drive them, XPBD and vector multipliers, support impulses, work and dissipation ledgers, residual statistics, the reaction time). A frame carrier's `mid` is the frame's own vector, fetched again every tick, and is not saved. |
| Heat | Temperature, sources, boundary values, the boundary energy ledgers and step rates, source energy, time, step count, CG statistics, the assembly flag and the assembled conductances. |
| Solid | Displacements, velocities, loads, constraints, the integrator's history and the corotational frames: every field of `SolidBody`. For an elastic-plastic body also the committed plastic strains and equivalent plastic strains, the eroded-element flags and count, the plastic work, and the tangent data of the last trial state. |
| Press brake | `PressBrake.saveState()`: its sheet (above), its contact solver, the punch's speed, travel and last speed, and the carried-forward increment the next step starts from. It is not a stepping-loop subsystem; the Studio does not resume a press run. |
| Fracture | Every field of `FractureBody`, so the cracked topology (elements, split nodes, interfaces with their damage and history), the energy counters and the events not yet taken. |
| Solid contact | The solid, the contact solver's candidate and active sets, friction anchors and modes, welds (with the weld map), its work vectors and statistics, the bodies' states, and the coupling's records. |
| Cloth | Positions, velocities, the Newton and CG vectors, the contact records, self-contact pairs and spatial hash, statistics and ledgers, the bodies it touches, and the coupling's records (previous velocities, contact flags). |
| Grains | Grains (positions, velocities, spins, radii, the alive flags), the tangential springs of every grain-grain and grain-wall contact, the neighbour lists, the walls' states and impulse ledgers, energy ledgers, statistics, and the coupling's records. |
| Fluid | Every field of `Fluid`: velocities, pressure (the projection's warm start), the advection history (Adams–Bashforth), obstacles and their masks and motion, ledgers, statistics and work vectors, and the coupling's records. A scene's `fluids` section builds either a flow (`fluidSubsystem`) or a free-surface tank (`freeSurfaceSubsystem`, whose checkpoint holds every field of the `FreeSurfaceFluid`: particles and their affine velocities, grid, pressure, the viscous solve's vectors, the voxelised obstacles with their position, velocity and force, and the time step, which `setTimeStep` can change). |
| Links | `thermalSolidLink`: the last heat step handed over. `deadLoadLink`: the weight last applied. `reactionLoadLink`: each body's velocity before the step and the support force last applied. |
| Shallow water | Every field of `ShallowWater`: depths, discharges, bed, Manning n and soil per cell, infiltrated depths, the volume ledger, sides, clock, the length of the last substep (the leading half of the friction uses it), statistics and work arrays; and the coupling's records of each body (the displaced volume per cell, whether it has been seen). |
| Event cursors | The cloth, grain, fluid, free-surface and solid-contact adapters' counters that decide when they emit `unconverged`, `grains-removed`, `overlap`, `cfl-exceeded` and `unstable-step`. |
| Simulation | Tick, the `update()` accumulator, the world's tick. Between steps its event queues are empty. |

## Format

A checkpoint is one self-checking file:

| Bytes | Content |
|---|---|
| 0–3 | `B3CK` |
| 4–7 | Format version, little-endian (`CHECKPOINT_VERSION`, 1) |
| 8–39 | SHA-256 of the body |
| 40–43 | Body length |
| 44– | Body: `encodeState({kind, state})` |

`encodeState` writes a state tree in a tagged binary form: numbers as int32 when they are one and float64
otherwise (every bit kept, `-0` and NaN included), strings in UTF-8, bigints as text, typed arrays with their type
and raw little-endian bytes, arrays, and objects with their keys in order. Equal trees give equal bytes. `kind` is
`simulation`, `world` or (in the Lab) `lab-checkpoint`, which wraps a simulation checkpoint with the scene's title
and step count. A simulation checkpoint holds the world's checkpoint as a nested `world` file, whose `native` field
is the bridge's checkpoint.

The checkpoint does not record when or where it was written, so the same state always gives the same bytes. It
records the SHA-256 of the scene in normal form and, by default, the scene's canonical text.

## Exactness

The guarantee: restore a checkpoint into a simulation built the same way (the same scene, or the same calls in the
same order) on the same build of `box3d.wasm` and the same JavaScript engine semantics (IEEE float64, which every
engine has), and every later step gives the same bits as the run it came from.

Measured:

- `packages/box3d-kit/test/v19-checkpoint.test.mjs` (kit gate, 7 tests, about 170 s on a shared 4-core machine): for each of the 21 example
  scenes (5 rigid, 16 coupled, four of them volumetric fluid, two shallow water), N steps (60 to 300), checkpoint, M more steps; in a fresh world, resume the
  checkpoint and take the same M steps: the whole checkpoint afterwards (every solver and the rigid world) is the
  same bytes, and so is the rigid transform hash. Restoring and checkpointing again gives the same bytes. Nine of
  the scenes (two of them fluid) are also resumed in a fresh Node process, with the same result. For one coupled set-up of each solver
  family, built by hand (cloth with self-contact and an attachment, grains under a block, the volumetric fluid with
  an obstacle and a sphere, solid contact with an impact, an elastic-plastic block dented by a heavy sphere, the quenched plate across the onset of cracking with 178
  crack events before the checkpoint and 66 after, heat with a solid and both links, shallow water on a slope with an inflow, rain, infiltration, friction and a floating box): the same bytes, and the same
  events after the checkpoint. The free-surface fluid, with viscosity, no-slip walls, a moving obstacle and a time step changed mid-run, is restored bit for bit. `tests/engine/solid-plasticity.test.mjs` and `tests/engine/press-brake.test.mjs` resume a plastic bar across the onset of erosion and a press brake mid-stroke from `saveState()` to the same bytes. A world checkpoint keeps handles (also with a body added after the build) and
  the fixed-step accumulator; `RemoteWorld` restores in its worker. Refused, with nothing changed: another scene, a
  flipped bit, another format version, a truncated file, a world checkpoint where a simulation one is expected, a
  simulation with a subsystem removed.
- `tests/physics/checkpoint.test.mjs` (in `npm run test:assets`): the Lab's path, every example scene, resumed in a
  world that hosted two other scenes first: the same transforms, body states and solver states, and every body
  handle of the scene build still valid.
- `scripts/checkpoint-browser-check.mjs` (not gated: the gates have no browser): the Lab's **Save checkpoint** in one
  page, **Load checkpoint** in a fresh browser context, for domino-run, ragdoll, moored-buoy, trampoline,
  hopper-seesaw, rubber-pad, quenched-plate, sphere-settling and dam-break in headless Chromium with software WebGPU: the same transform hash and
  the same state hash of every solver 30 Lab ticks later, no console error.

### Limits

- **Same build.** A checkpoint names the format version, not the build. The Box3D snapshot checks its own struct
  layout and refuses another; the bridge's tables and the solvers' fields are not versioned beyond the format
  version, and a restore into another build either refuses ("field not in this solver") or, if the layout happens to
  match, gives a valid state that is not exact. Exactness across builds or machines is not claimed (the
  cross-device determinism matrix is a separate roadmap item).
- **Same set-up.** A simulation restores only a checkpoint of the same scene (by its hash) and the same subsystems
  (ids, kinds, stages, order, timing). A simulation built by hand has no scene hash: it is matched by its subsystems
  and by the solvers' fields and list lengths, so a set-up that differs only in a constant (a material, a friction
  coefficient) is not detected. A bare world restore (`PhysicsWorld.restoreCheckpoint`) checks nothing about the
  bodies: it replaces them.
- **Handles.** In a world built the same way the caller's body and joint handles keep their meaning, also when the
  run added bodies after the build (they get new handles here; read them with `bodyAt`). After a body was destroyed
  the rows no longer line up: the checkpoint's own handles are taken, and handles held in the world restored into may
  be stale or name another body; read them again with `bodyAt`. JavaScript objects outside the Simulation (user data, listeners, a coupling's attachment
  reports read by reference) are not saved. A body attached to a coupling that died before the checkpoint must
  also be dead in the world restored into, or the coupling's lists differ and the restore is refused.
- **Events.** Events are outputs of the step that made them: a checkpoint holds none, and the world's event buffers
  are cleared by a restore. End events that a body destruction queued *between* two steps are lost.
- **Between steps.** Call `checkpoint()` between steps, not from a step listener inside a subsystem.
- **The Lab.** The Lab's own clock, camera and panels are not saved; the step count is. The Lab keeps running after a
  load unless it was paused, and the autoplay that a scene load schedules may start it; the state at a given step is
  exact either way.
- **Size.** Solvers save all of their fields, including work vectors and constant tables (element matrices of a
  frame are left out), because a missed field would break exactness silently. Checkpoints are therefore larger than
  the state strictly needs; they are not compressed.

## Cost

Measured on one thread of this sandbox's 2.1 GHz Xeon (Node 22, `tests` code path through the Lab host), after 120
steps of each example; the checkpoint includes the scene text. Save is `simulation.checkpoint()` (including the
SHA-256), restore is `simulation.restore()` into the loaded scene (including the SHA-256 check); medians of 7.

| Scene | Checkpoint | of which rigid world | Save | Restore | One step, for scale |
|---|---|---|---|---|---|
| pendulum-wave | 24.4 KiB | 20.7 KiB | 0.9 ms | 1.0 ms | 0.13 ms |
| newtons-cradle | 16.6 KiB | 14.6 KiB | 0.5 ms | 0.4 ms | 0.02 ms |
| domino-run | 28.6 KiB | 26.6 KiB | 1.3 ms | 1.4 ms | 0.10 ms |
| terrain-car | 21.0 KiB | 17.0 KiB | 1.0 ms | 0.9 ms | 0.10 ms |
| ragdoll | 27.6 KiB | 23.0 KiB | 1.1 ms | 1.1 ms | 0.07 ms |
| moored-buoy | 106.4 KiB | 7.7 KiB | 3.4 ms | 3.2 ms | 0.42 ms |
| cable-stayed-deck | 122.7 KiB | 6.5 KiB | 4.3 ms | 3.2 ms | 0.76 ms |
| buoy-and-crates | 112.2 KiB | 11.4 KiB | 3.0 ms | 2.7 ms | 0.49 ms |
| trampoline | 166.9 KiB | 16.1 KiB | 2.8 ms | 2.5 ms | 5.64 ms |
| hopper-seesaw | 583.8 KiB | 22.6 KiB | 13.0 ms | 12.3 ms | 2.27 ms |
| suspended-platform | 110.5 KiB | 16.4 KiB | 3.4 ms | 3.0 ms | 0.15 ms |
| rubber-pad | 597.1 KiB | 9.4 KiB | 12.9 ms | 7.9 ms | 128 ms |
| notched-beam | 407.7 KiB | 11.9 KiB | 6.6 ms | 8.9 ms | 0.44 ms |
| quenched-plate | 602.6 KiB | 8.0 KiB | 12.2 ms | 10.3 ms | 31.3 ms |
| heated-bar | 95.6 KiB | 8.7 KiB | 1.4 ms | 1.3 ms | 2.42 ms |
| sphere-settling | 2895 KiB | 7.7 KiB | 60 ms | 52 ms | 8.4 ms |
| cavity-flow | 2697 KiB | 6.8 KiB | 36 ms | 35 ms | 5.9 ms |
| flow-past-cylinder | 3217 KiB | 7.6 KiB | 66 ms | 57 ms | 8.8 ms |
| dam-break | 474 KiB | 6.8 KiB | 11.8 ms | 7.8 ms | 4.8 ms |

The largest parts are the grains' tangential-spring tables (four of 122 KiB in the hopper), a solid's linearisation
tables and the fluid's grids: a flow saves about 25 arrays of its grid size (velocities, advection history, obstacle masks, the projection's work vectors), so the 4,000-cell flows of the examples take about 3 MiB. The fluid timings were measured with other jobs on the machine. Resuming in a fresh page adds
loading the scene (3 to 40 ms here).

## Reproduce

```sh
npm --prefix packages/box3d-kit run build && node --test packages/box3d-kit/test/v19-checkpoint.test.mjs
node --test tests/physics/checkpoint.test.mjs
npm run build && node scripts/checkpoint-browser-check.mjs   # needs Playwright and a Chromium with WebGPU
```
