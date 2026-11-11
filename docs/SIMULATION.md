# One stepping loop

`Simulation` (`src/engine/simulation.ts`, kit subpath `box3d-webgpu-kit/simulation`) owns a rigid world and any number of registered subsystems and advances them all with one `step()` or `update(frameSeconds)`. It is the "one stepping loop that every solver plugs into" of Phase 2 of the [roadmap](ROADMAP.md).

Before it, each solver had its own stepping call and an ordering rule written in prose (`water.step()` immediately before `world.step()`; `coupling.step()` immediately before `world.step()`; heat and solids on their own). Combining two of them meant reading four documents, and nothing checked the result. Now the order is a property of each subsystem, the time-step requirements are checked when a subsystem is registered, and a scene file can describe a coupled scene.

The Simulation adds no numerics of its own. A run through it is **bit-identical** to calling the same modules by hand in the order below. That is the property the tests prove first (`packages/box3d-kit/test/v14-simulation.test.mjs`, 13 tests, in the kit gate).

## Use

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {createSimulation, waterSubsystem, structureSubsystem, heatSubsystem, solidSubsystem, thermalSolidLink} from 'box3d-webgpu-kit/simulation';

const world = await createWorld({step: 1 / 240, ground: false});
const sim = createSimulation(world);

// Build the solvers as their own documents describe, then register them. Any order.
sim.add(waterSubsystem(water));                         // a WaterCoupling
sim.add(structureSubsystem(coupling, {bodies}));        // a StructureCoupling and the bodies attached to it
sim.add(heatSubsystem(heat)).add(solidSubsystem(solid)).add(thermalSolidLink(heat, solid, {reference: 300}));

sim.step();                 // everything, in stage order. Do not call world.step() yourself.
sim.update(frameSeconds);   // or: whole fixed steps from a frame time, at most maxSteps (default 5)
sim.tick; sim.time;         // one clock
sim.onStep(tick => {});     // after every step, when everything has advanced
sim.onEvent(event => {});   // world contact events and subsystem events, in the events stage
sim.diagnostics();          // the clock, the step plan, the energy ledger, every subsystem's own report
```

Or load a scene file that describes all of it ([Scenes](#scenes)):

```ts
import {loadScene, sceneWorldOptions, mooredBuoyScene} from 'box3d-webgpu-kit/scene';

const scene = mooredBuoyScene();
const world = await createWorld(sceneWorldOptions(scene));
const {simulation, bodies, water, cables, attachments} = loadScene(world, scene);
simulation.step();
```

## The stage order

```
 simulation.step()
 │
 ├─ prepare        every subsystem, in the order below: the world and all fields are at time t
 │
 ├─ pre-couple     (empty unless you register something here)
 │
 ├─ couple         100  structure coupling   closes last step's frame impulse, reads the bodies at t,
 │                                           steps its cables and frames, applies their forces
 │                 150  cloth coupling       (`clothSubsystem` of box3d-webgpu-kit/cloth) solves the cloth with
 │                                           the bodies it touches, applies its forces
 │                 170  solid coupling       (`solidContactSubsystem` of box3d-webgpu-kit/solid-contact) solves the
 │                                           solid with the bodies it touches or is welded to, applies its forces
 │                 200  water coupling       reads the bodies at t, applies buoyancy and drag,
 │                                           advances the water to t + dt
 │
 ├─ rigid          world.step()              the rigid solver integrates the bodies from t to t + dt
 │
 ├─ post           100  heat                 its own steps to t + dt
 │                 200  links                heat → solid temperature; rigid weight → solid load
 │                 300  solids               their own steps to t + dt
 │
 └─ events         finish on every subsystem; world events, then subsystem events, to onEvent listeners;
                   then onStep listeners
```

- Stages run in this fixed order. Inside a stage, subsystems run by `order` (the numbers above are the adapters' defaults, exported as `SUBSYSTEM_ORDER`), then by `id`. Registering in any order gives the same bits; the test registers five solvers forwards, backwards and shuffled.
- `rigid` and `events` belong to the Simulation. A subsystem chooses `pre-couple`, `couple` or `post`.
- **Structure before water** in the couple stage, because the structure coupling's first act is to give each frame-attached body the closing half of last step's frame impulse; the water then reads the body's complete velocity. Swapping the two gives different bits (asserted) and is not offered.
- The world is stepped by the Simulation only. If `world.tick` is not where the Simulation left it, `step()` throws `EngineError('INVALID_STATE')`: the world was stepped or reset behind its back. Make a new Simulation after `world.reset()`.
- `simulation.order()` returns the plan as data.

`step()` allocates nothing of its own: the context object is reused and the per-stage lists are rebuilt only when a subsystem is added or removed. The modules allocate what they always did (the kit's `getState` and `applyForce`, the frame's CG temporaries, and one array per update in `SolidBody.setTemperatureChange`). Event objects are created only while an `onEvent` listener is registered.

## The Subsystem contract

```ts
interface Subsystem<W, B> {
  readonly id: string;                    // unique in a Simulation; 'world' and 'rigid' are reserved
  readonly kind: string;                  // for reports, e.g. 'water-coupling'
  readonly stage: 'pre-couple' | 'couple' | 'post';
  readonly order?: number;                // inside the stage; lower first, ties by id; default 0
  readonly timeStep: {dt: number; rule: 'equal' | 'commensurate'} | null;
  readonly bodies?: Iterable<B>;          // bodies whose energy energy() already counts
  validate?(info: {dt, subSteps, timing}): void;   // at registration; throw an EngineError to refuse
  prepare?(ctx): void;                    // everything is at t: read, do not advance
  step(ctx): void;                        // advance, in its stage
  finish?(ctx): void;                     // everything is at t + dt: emit events
  energy?(): {domain: 'mechanical' | 'thermal'; total: number; exchanged: number; parts: {...}};
  diagnostics?(): unknown;
  dispose?(): void;
}
```

`ctx` is `{world, tick, time, dt, substeps, emit(type, data)}`: `tick` is the step being computed (1 for the first), `time` its start, `dt` the simulation's fixed step, `substeps` how many of its own steps the subsystem takes in this call. The object is reused between calls.

### Time steps

The simulation's fixed step is the world's (`world.loop.step`). A subsystem states its own step and one of two rules, and `add()` checks them:

| Rule | Meaning | Refused with |
|---|---|---|
| `equal` | It exchanges forces with the rigid step. Its `dt` must be the simulation step (within 1e-12 s). | `INVALID_STATE`: `Subsystem "water" (water-coupling) steps at 0.00833 s but the simulation steps at 0.00417 s. It exchanges forces with the rigid step, so the two must be equal; it cannot be sub-cycled.` |
| `commensurate` | An independent field. Its `dt` may be the step, a whole fraction of it (N of its steps per simulation step) or a whole multiple of it (one of its steps every N simulation steps). | `INVALID_STATE`: `… steps at 0.0029 s, which is neither the simulation step 0.00417 s, a whole fraction of it … nor a whole multiple of it …` |

`resolveTiming(id, kind, timeStep, dt)` is the rule as a function. A subsystem that steps every N simulation steps runs on ticks N, 2N, …, so its time equals the simulation's on those ticks and lags by up to N − 1 steps between them.

## Adapters

Each adapter calls the module's own `step` and nothing else. No module's numerics were changed; the only edit to an existing solver file is that `principalMoments` in `structure-coupling.ts` is now exported.

| Adapter | Stage, order | Calls | Time-step requirement | Energy entry |
|---|---|---|---|---|
| `waterSubsystem(water, {id?})` | couple, 200 | `water.step()` | `equal`: `water.dt` is the simulation step. | Water kinetic + potential. Track the floating bodies with `trackBody`. |
| `structureSubsystem(coupling, {id?, bodies?})` | couple, 100 | `coupling.step()`, which steps the cables and frames it holds | `equal`: `coupling.dt` is the simulation step. The coupling itself requires every cable's and frame's `dt` to equal its own, frames to use `substeps: 1`, and a cable with drag to use `substeps: 1`. | `coupling.diagnostics()`: attached bodies (with the pending half kick), cables and frames. Pass the attached bodies as `bodies`. |
| `heatSubsystem(heat, {id?})` | post, 100 | `heat.step(substeps)` | `commensurate`. With `scheme: 'explicit'` the solver's `dt` must also be within `explicitStabilityLimit()`, else `UNSTABLE_TIME_STEP` (the module checks this when it is built; the adapter checks again, because a boundary changed later can lower the limit). | Thermal: stored energy, with boundary and source heat as `exchanged`. |
| `solidSubsystem(solid, {id?})` | post, 300 | `solid.step(substeps)` | `commensurate`. An explicit body must be within `explicitLimit()`, else `UNSTABLE_TIME_STEP`; in practice it needs many of its own steps per simulation step (the test uses the count the limit gives). | Kinetic + strain + load potential. |
| `fractureSubsystem(body, {id?})` (from `box3d-webgpu-kit/fracture`) | post, 300 | `body.step(substeps)`; crack events of the step are emitted as `'crack'` in the events stage | `commensurate`. An explicit body must be within its `explicitLimit()`, which already allows for every face cracking. | Kinetic + strain + interface energy, with the dissipated and damped energy as `exchanged`. |

**Sub-cycling, and where it is sound.** Heat and solids are independent fields here: nothing in the rigid step depends on them inside a step, so stepping them N times per simulation step, or once every N steps, is exactly the solver run at its own `dt`. Both are allowed for every scheme, subject to the solver's own stability check. Water and structure couplings exchange forces with the rigid step and are never sub-cycled. A link reads its source when the source has advanced, so a solid that steps more often than its heat solver holds the temperature between heat steps.

## What is coupled, and what is not

| Pair | Status |
|---|---|
| rigid ↔ water | Two-way, through `WaterCoupling` ([`WATER_COUPLING.md`](WATER_COUPLING.md)). |
| rigid ↔ cables, rigid ↔ frames, cable ↔ frame | Two-way, through `StructureCoupling` ([`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md)). |
| water ↔ structure on the same body | **Each is two-way with the body; they do not know of each other.** See below. |
| heat → solid | **One-way link** (`thermalSolidLink`): temperature becomes the solid's thermal strain. With a `FractureBody` that strain can crack the solid ([`SOLID_FRACTURE.md`](SOLID_FRACTURE.md)); the cracks do not change the heat flow. |
| rigid → solid | **One-way link** (`deadLoadLink`): a body's weight becomes a dead load on solid nodes. |
| rigid ↔ solid | Two-way, through `SolidCoupling` and `solidContactSubsystem` ([`SOLID_CONTACT.md`](SOLID_CONTACT.md)): contact with friction against boxes, spheres, capsules and planes, and welds. The adapter lives in the solid-contact module. Node against body only; no solid ↔ solid contact. Solids are not in the scene format. |
| solid → heat, water ↔ solid, water ↔ cable or frame | Not modelled. |
| rigid ↔ cloth | Two-way, through `ClothCoupling` and `clothSubsystem` ([`CLOTH.md`](CLOTH.md)): contact with friction, attachments. The adapter lives in the cloth module, not in `simulation.ts`. A cloth and a cable, a frame or water on the same body do not know of each other, as above. Cloth is not in the scene format. |
| the app's cloth and rope, granular, GPU water | Not in the loop yet. |

### Water and structure together

A body may be attached to a cable or a frame and float in a basin at the same time (the moored buoy). Both couplings read the body at time t and add their forces to the same rigid step, so the body's motion has both. What is missing is inside the structure coupling: its interface solve uses the body's *free response*, and that contains gravity only ([`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md), "Other constraints on an attached body"). It does not see the buoyancy `B`. Measured on the moored buoy at rest (80.4 kg sphere, `B` = 2125 N, cable node `m_n` = 0.0275 kg, 240 Hz):

- The cable's implicit step places its end node where a body falling under gravity and the cable alone would go, `B dt² / m` = 0.46 mm lower than the buoy goes. The draught is off by that much (measured −0.41 mm).
- The node's own weight and inertia are transmitted for that imagined fall, which makes the segment tension high by `m_n B / (m + m_n)` = 0.73 N of 1337 N (measured +0.729 N).
- The force of the cable **on the buoy** is not affected: the rigid solver balances it against the buoyancy (measured 1.9e-6 from `ρ g V_sub − m g`).

Neither error grows in time, and both scale with `B dt²` and with the cable's end mass: keep the cable's nodes light compared with the body. With a 0.69 kg end node the same buoy reads a tension 18 N (1.4%) high. Feeding the water force into the structure coupling's free response would remove both; it needs a hook in `structure-coupling.ts` and is open.

A body that is both floating and on a **frame** gets the frame's half kicks before the water reads its velocity (that is why structure runs first). The combination runs and is covered by the bit-identity test, but has no closed-form validation.

## Links

### Heat → solid (`thermalSolidLink(heat, solid, {reference, id?})`), one-way

The heat solver's temperature becomes the solid's thermal load, the isotropic eigenstrain `α_T (T − reference)` of [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md). `reference` is the stress-free temperature. The solid does not act on the temperature (asserted: the heat field has the bits it has alone).

- **Co-located grids only.** The solid must be a `boxMesh` whose cells are the heat grid's cells: the same counts, the same cell size, every heat cell solid. The constructor refuses anything else with the two numbers that disagree.
- **Mapping.** Heat is cell-centred, the solid's temperature is nodal. Node `(i, j, k)` takes the mean of the heat cells that touch it (one at a corner, two on an edge, four on a face, eight inside), minus `reference`; the solid then uses the mean of an element's four nodes. `cellTemperaturesToNodes` is the function. A field linear in x is reproduced at interior nodes and held at the half-cell value on the end planes, so a uniform temperature is exact and a gradient is first-order accurate at the surface.
- It runs in the post stage between heat and the solid, whenever the heat solver has advanced.

### Rigid weight → solid (`deadLoadLink(body, solid, {faces | nodes, id?})`), one-way

The weight `m g` of a rigid body is put on solid nodes as a dead load. With `faces` it is spread as a uniform traction over those boundary faces (each node of a face takes a third of the face's share by area); with `nodes` it is shared equally.

- The solid's deflection does not move the body, and nothing here holds the body up: support it in the rigid world (the test rests it on a static slab). **This link has no contact;** for a body that rests on the solid and is carried by it, use `SolidCoupling` ([`SOLID_CONTACT.md`](SOLID_CONTACT.md)).
- Mass and gravity are read from the world each step, so a changed gravity or a destroyed body changes the load.
- The link owns the point forces of those nodes (`setNodalForce` replaces them).

## The energy ledger

`simulation.energy()` returns one entry per subsystem that reports energy, in step order, then a `rigid` entry for tracked bodies, with totals:

```ts
{entries: [{id, kind, domain, total, exchanged, balance, parts}], mechanical, thermal, total, exchanged, balance}
```

- `total` is what a subsystem holds now; `exchanged` is what entered through its declared boundaries (the heat solver's boundary and source heat); `balance = total − exchanged` is constant for a solver without losses.
- `mechanical` and `thermal` are kept apart because they differ by many orders of magnitude; `total` is their sum.
- **Rigid bodies.** The world reports mass but not rotational inertia. `simulation.trackBody(body, inertia)` counts a body in the `rigid` entry: `½ m v² + ½ ω·I ω − m g·x`. A body the structure coupling carries is counted there (with the pending half kick), and `trackBody` refuses it. The scene loader tracks floating bodies that no cable or frame carries. Other bodies are not in the ledger unless you track them.
- **Water.** The water's potential includes the work against the displaced volume, which it knows after its first step. Take the baseline after the first step.
- The ledger is a sum of what each solver reports at the end of a step. Terms are known up to half a step apart. With drag it falls, but it may exceed its start by the sampling offset `ρ g V v dt` of [`WATER_COUPLING.md`](WATER_COUPLING.md) (measured 0.85 J against a bound of 4.99 J, in a run that lost 49.9 J).
- A solid whose temperature or loads a link is changing is not a closed system; its entry then changes by the work done on it.

## Scenes

The `box3d-scene` format ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-water-cables-frames)) has three optional top-level sections, `water`, `cables` and `frames`. **The version stays 1**: the sections are optional and additive, a scene without them has the canonical text and hash it always had (the five example hashes are pinned in the test), and a reader that predates them rejects a scene that has them with `unknown key "water"` rather than misreading it.

`loadScene(world, scene)` of `box3d-webgpu-kit/scene` builds them and returns a ready Simulation next to what it returned before:

```ts
{bodies, joints, builder, scene,
 simulation,            // steps the world and everything else; for a rigid-only scene its step is world.step()
 water,                 // Map<basin id, WaterCoupling>; each is a subsystem under its id
 cables, frames,        // Map<id, CompliantCableRuntime>, Map<id, FrameRuntime>
 structure,             // the one StructureCoupling that holds them (subsystem 'structure'), or null
 attachments}           // Map<'<cable or frame id>:<index>', StructureAttachment>: live force, tension, gap
```

Build order, which is part of the format because it fixes the bits: bodies and joints as before; every frame, then every cable, in file order; one `StructureCoupling` that is handed all of them, then the cables' attachments (cable by cable, in file order), then the frames' attachments; then each basin and its bodies. Cables and frames take the world's step and the scene's gravity. An invalid scene leaves the world untouched; a section the engine refuses leaves it reset and empty, and the error starts with `Scene cable "<id>":`, `Scene frame "<id>":` or `Scene water "<id>":`.

`saveScene` writes the sections back with the fields the solvers hold: the basin's `eta`, `u` and `v`, each cable's node positions and velocities, each frame's displacements and velocities. Not saved: the structure coupling's own state (last step's interface impulses and the pending half kick, so the saved velocity of a body resting on a frame is off by about `g dt / 2`), the cable solver's multipliers, and one step of displaced volume (the first step after a load takes a wet body as part of the starting state). A resumed run starts from bit-identical fields and then differs slightly; the measured drift is in the table below.

The Physics Lab builds scenes through a host with no solvers for these sections, so the core `loadScene` of `src/engine/scene-format.ts` **refuses** a scene that has them (`INVALID_STATE`, world untouched) instead of building its rigid part and dropping the rest. Heat solvers and solids are not in the scene format.

Two example scenes (`COUPLED_EXAMPLE_SCENES`; they are kept out of `EXAMPLE_SCENES`, which every rigid-only loader can open):

| Function | Contents |
|---|---|
| `mooredBuoyScene()` | A sphere (R = 0.4 m, 300 kg/m³) floating in an 8 m × 8 m basin 3 m deep, held under its free waterline by one compliant cable (2.75 m, `EA` = 5·10⁴ N) from an anchor on the bed. Options: `offset`, `linearDrag`, `waterDrag`, `lineDensity`, … |
| `cableStayedDeckScene()` | The span of the structure-coupling validation: an 8 m steel deck of 8 elements on a pin and a roller, two stays from a tower top 3 m above midspan, a 14.1 kg ball pinned to deck node `loadNode`. |

## Validation

`packages/box3d-kit/test/v14-simulation.test.mjs`, run by `npm run test:kit`; 240 Hz and 4 sub-steps unless stated. Tolerances are derived in the test file next to each check. The cases are also in the [validation report](VALIDATION.md) (domain "One stepping loop").

**Bit-identity.** World `exactHash()` and SHA-256 of the solvers' float64 arrays, compared every 60 steps.

| Run | Steps | Result |
|---|---|---|
| Water coupling alone (a box dropped in, a capsule floating) | 480 | identical |
| Structure coupling alone (a ball clamped to a cantilever, a box on a cable from it, a cable pendulum) | 480 | identical |
| Heat: one step per step; 5 sub-steps per step; one step every 4 steps | 480 each | identical |
| Solid: midpoint linear; corotational backward Euler with 2 sub-steps | 480 each | identical |
| Water + structure (a moored buoy, and a floating box with a frame clamped to it) + heat + thermal link + solid, hand-driven against three registration orders | 360 | identical in all three |
| The same with water stepped before structure | 360 | different, as it must be |
| Cable-stayed deck: built by hand, from scene JSON, from a compressed link, from a stored link | 480 | identical, including the measured tensions and deflection |
| A rigid-only scene: `simulation.step()` against `world.step()` | 200 | identical; the five example `sceneHash` values are unchanged |

**Closed forms.**

| Check | Expected | Measured | Tolerance |
|---|---|---|---|
| Moored buoy at rest: force of the cable on the buoy | `ρ g V_sub − m g` = 1336.5894 N | 1336.5920 N (1.9e-6) | 1e-5: float32 mass and gravity |
| … segment tension | `ρ g V_sub − (m + m_n) g` = 1336.320 N | 1337.049 N (+0.729 N) | 1.05 `m_n B / (m + m_n)` = 0.76 N: the free-response limit above |
| … draught, against the equilibrium of cable stretch, level rise and cap volume | 0.57610 m | 0.57569 m (−0.41 mm) | 1.3 `B dt² / m` = 0.60 mm |
| … tension against that equilibrium | 1337.958 N | 1337.049 N (−6.8e-4) | 3.1 N: the draught bound times `ρ g A_wp`, plus 0.76 N |
| … floor load − anchor pull | total weight 1 881 985.49 N | 1 881 984.76 N (−0.73 N) | 0.76 N |
| … mean level rise | `(V_sub − V_0) / A` | equal | 1e-9 m |
| Released 0.4 m to the side, 24 s | bounded by the offset; each 4 s window smaller; back at rest | windows 0.3999, 0.0040, 0.0015, 0.0009, 0.0003, 0.0002 m; ends 0.13 mm off the line, 4.8e-7 m from the rest height | ≤ offset; monotone; 2 mm; 0.2 mm |
| Cable-stayed deck, ball on nodes 1, 3, 4, 5, 7: stay tensions | flexibility-method hand statics | worst error 9.5e-5 | 2e-4 |
| … deflection under the ball | hand statics | worst error 1.4e-4 | 2e-4 + 1e-7 m |
| … total vertical reaction | total weight 1384.97 N | worst error 1.7e-5 | 5e-5 |
| Heat → solid, free block, 80 K | grows by `α ΔT` = 9.6e-4, zero stress | displacement error 7e-17 m of 1.2e-5 m; stress 1.9e-11 `E α ΔT` | 1e-9 |
| Heat → solid, bar held at both ends, linear model | `−E α ΔT` = −192 MPa | −192.000000001 MPa (3e-11) | 1e-9 |
| Rigid weight on a solid, 62.8 kg on 0.01 m² × 0.2 m | shortening `m g L / (E A)` = 6.1607e-8 m; stress `−m g / A` = −61 606.81 Pa; base reaction `m g` | errors 1.5e-11, 2.6e-11; reaction equal to 9 digits | 1e-8 |

**Energy ledger.**

| Check | Expected | Measured | Tolerance |
|---|---|---|---|
| Midpoint linear solid, 480 steps | constant | 5.5e-12 of the energy in play | 1e-10 |
| Heat with a fixed face, a film and a source | stored − exchanged constant | 6.5e-13 of the 625 J exchanged | 1e-10 |
| Cable pendulum, no drag, 6 s | never grows; loss first order in `dt` | largest rise 0; loss 8.1% at 240 Hz (rate formula 7.7%), 4.5% at 480 Hz, ratio 1.79 | rise ≤ 1e-4; ratio 2 ± 0.3; loss within 1.5× of the formula |
| Moored buoy with drag, released | falls; never above the start by more than `ρ g V v dt` | fell 49.9 J; largest excess 0.85 J against 4.99 J; always below the start in the second half | as stated |
| A tracked spinning box in zero gravity | `½ m v² + ½ I_x ω²` = 28.080001 J | 28.080001 J at the start; 28.080338 J after 1 s | 1e-6; 1e-4 (the rigid solver's drift; the first bound for this was 1e-6 and it measured 1.2e-5) |

**Save, load, continue.** Saved at tick 240 through a share link, compared 240 ticks later. Bounds are about ten times the measured values.

| Scene | At the moment of loading | Drift after 240 ticks | Bound |
|---|---|---|---|
| Moored buoy, released 0.4 m off | fields bit-identical; body position and velocity equal | buoy 6.1e-6 m; surface 4.0e-5 m (waves 2.3 mm high) | 1e-4 m; 4e-4 m |
| Cable-stayed deck | fields bit-identical; body position and velocity equal | ball 1.6e-8 m; deck 4.3e-7 m (deflection 1.2 mm) | 2e-7 m; 4e-6 m |

Two loads of the same scene, one of them from a share link, stay bit-identical for the whole 480 steps.

## Limits and open items

- **Contact between rigid bodies and deformable solids** is in a module of its own ([`SOLID_CONTACT.md`](SOLID_CONTACT.md)), node against body, with its limits stated there. Two solids do not collide with each other.
- **Water forces are not in the structure coupling's free response** (above). The error is bounded and measured; removing it is open.
- **Links are one-way** and the thermal link needs co-located box grids. General mesh-to-grid interpolation, thermoelastic feedback and heat from a rigid contact are open.
- **Heat and solids are not in the scene format.** A coupled scene describes rigid bodies, joints, basins, cables and frames.
- **A save is not a checkpoint.** The structure coupling has no checkpoint; see the drift table.
- **The rigid ledger entry covers tracked bodies only**, and assumes the body's position is its centre of mass.
- A subsystem that throws in the middle of a step leaves the step half done; the world's tick then no longer matches and the next `step()` refuses. Build a new Simulation from a saved scene.
- The world rejects `applyForce` while recording, so a Simulation with a water or structure coupling cannot run under `startRecording()`.
- **Forces too small for a float32.** The rigid world works in float32 and refuses a nonzero force or torque component below the smallest float32 (about 1.4·10⁻⁴⁵). Round-off of the interface solve can leave one, so the coupling hands over an exact zero for such a component. (Fixed 2026-11-11; before that a cable attached off a floating body's centre threw on its first step.)
- The Physics Lab and the Studio do not run coupled scenes.

## Reproduce

```sh
npm run test:kit                                                   # builds the kit, runs every kit test, cleans up
npm --prefix packages/box3d-kit run build
node --test --test-reporter=tap packages/box3d-kit/test/v14-simulation.test.mjs   # prints the measured numbers
npm --prefix packages/box3d-kit run clean
npm run validation:check
```
