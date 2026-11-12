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
 │                 160  granular coupling    (`granularSubsystem` of box3d-webgpu-kit/granular) takes the grains'
 │                                           own steps to t + dt with the bodies they touch, applies the mean force
 │                 170  solid coupling       (`solidContactSubsystem` of box3d-webgpu-kit/solid-contact) solves the
 │                                           solid with the bodies it touches or is welded to, applies its forces
 │                 180  fluid coupling       (`fluidSubsystem` of box3d-webgpu-kit/fluid) takes the fluid's own steps
 │                                           to t + dt with the bodies as moving obstacles, applies the mean force
 │                 200  water coupling       reads the bodies at t, applies buoyancy and drag,
 │                                           advances the water to t + dt
 │
 ├─ rigid          world.step()              the rigid solver integrates the bodies from t to t + dt
 │
 ├─ post           100  heat                 its own steps to t + dt
 │                 200  links                heat → solid temperature; rigid weight → solid load
 │                 300  solids               their own steps to t + dt
 │                 510  fluid                a flow without bodies: its own steps to t + dt
 │                 520  free surface         (`freeSurfaceSubsystem`) a free-surface tank: its own steps to t + dt
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
  checkpoint?(): StateValue;              // everything later steps and events read, as a state tree (checkpoint.ts)
  restore?(state: StateValue): void;      // put it back; throw CHECKPOINT_MISMATCH for another set-up
}
```

`ctx` is `{world, tick, time, dt, substeps, emit(type, data)}`: `tick` is the step being computed (1 for the first), `time` its start, `dt` the simulation's fixed step, `substeps` how many of its own steps the subsystem takes in this call. The object is reused between calls.

`checkpoint()` and `restore()` make exact checkpoints possible ([`CHECKPOINTS.md`](CHECKPOINTS.md)): `simulation.checkpoint()` collects the world's checkpoint (`world.checkpoint()`), every subsystem's `checkpoint()`, the clock and the `update()` accumulator into one file with a format version and a SHA-256, and `simulation.restore(bytes)` puts them back, after refusing a checkpoint of another scene or another set-up. Every adapter and link in this document has both, and so do the cloth, grain, fluid, solid-contact and fracture subsystems; a subsystem without them makes `checkpoint()` throw. A subsystem's state must include what decides its later events (the adapters keep the counters that trigger `unconverged`, `overlap` and the like).

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
| water ↔ structure on the same body | Each is two-way with the body, and the structure coupling's interface solve counts the water's force (`linkWaterToStructure`; the scene loader makes the link). See below. |
| heat → solid | **One-way link** (`thermalSolidLink`): temperature becomes the solid's thermal strain. With a `FractureBody` that strain can crack the solid ([`SOLID_FRACTURE.md`](SOLID_FRACTURE.md)); the cracks do not change the heat flow. |
| rigid → solid | **One-way links**: `deadLoadLink`, a body's weight as a dead load on solid nodes; `reactionLoadLink`, the force that holds a body up, measured from its motion, as a traction on boundary faces (an impact included). |
| rigid ↔ solid | Two-way, through `SolidCoupling` and `solidContactSubsystem` ([`SOLID_CONTACT.md`](SOLID_CONTACT.md)): contact with friction against boxes, spheres, capsules and planes, and welds. The adapter lives in the solid-contact module. Node against body only; no solid ↔ solid contact. A scene file can describe it (`solids` with `contact` and `welds`). |
| solid → heat, water ↔ solid, water ↔ cable or frame | Not modelled. |
| rigid ↔ cloth | Two-way, through `ClothCoupling` and `clothSubsystem` ([`CLOTH.md`](CLOTH.md)): contact with friction, attachments. The adapter lives in the cloth module, not in `simulation.ts`. A cloth and a cable, a frame or water on the same body do not know of each other, as above. A scene file can describe a cloth (`cloths`, [`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-cloths-and-grains)). |
| rigid ↔ grains | Two-way, through `GranularCoupling` and `granularSubsystem` ([`GRANULAR.md`](GRANULAR.md)): the grains take a whole number of their own steps inside each rigid step, with the bodies they touch moving alongside, and hand the world the mean force. The adapter lives in the granular module. Grains and a cloth, a cable or water on the same body do not know of each other, as above. A scene file can describe grain sets (`grains`). |
| rigid ↔ volumetric fluid | Two-way, through `FluidCoupling` and `fluidSubsystem` ([`FLUID.md`](FLUID.md)): bodies are moving obstacles of the fluid's grid, the fluid takes a whole number of its own steps inside each rigid step and hands each body the mean force and torque (buoyancy included). Explicit: the body sees the fluid one step late. A bare `Fluid` runs in the post stage. The free-surface option is not coupled (`freeSurfaceSubsystem` runs a tank in the post stage). Both are in the scene format's `fluids` section ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#fluids)). A fluid does not know of the height-field water, cloth, cables or grains on the same body. |
| the app's cloth, rope and granular scenes, GPU water | Not in the loop yet. |

### Water and structure together

A body may be attached to a cable or a frame and float in a basin at the same time (the moored buoy). Both couplings read the body at time t and add their forces to the same rigid step. The structure coupling's interface solve uses the body's *free motion*; `linkWaterToStructure(water, structure)` puts the water's force into it:

```ts
import {linkWaterToStructure} from 'box3d-webgpu-kit/simulation';
const unlink = linkWaterToStructure(water, structure);   // loadScene does this for every basin of a scene with cables or frames
```

It registers a load provider on the structure coupling ([`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md)) that asks the water coupling for the buoyancy and drag it is about to apply (`water.predictLoad`, the water coupling's own evaluation for the present state, with no side effects). The order of a step does not change: structure first, then the water applies its force, then the rigid step. For a body on cables only, the predicted force is bit for bit the one the water then applies.

Without the link the free motion has gravity only, and the cable's implicit step places its end node where a body falling under gravity and the cable alone would go, `B dt² / m` lower than the body goes. Measured on a spar on a taut vertical tether (0.2 × 0.2 × 2 m, 32 kg, tether 1000 N/m, basin 4 m deep; `packages/box3d-kit/test/v17-moored.test.mjs`):

| Step | `B dt² / m` | Draught error, linked | Draught error, not linked | Tension error, linked | Tension error, not linked |
|---|---|---|---|---|---|
| 1/240 s | 0.29 mm | 1·10⁻⁷ m | −0.50 mm | −4·10⁻⁷ | +9.1·10⁻⁴ |
| 1/60 s | 4.7 mm | 1·10⁻⁷ m | −3.6 mm | −4·10⁻⁷ | −4.6·10⁻³ |
| 1/30 s | 18.5 mm | 1·10⁻⁷ m | −13.6 mm | −4·10⁻⁷ | −2.2·10⁻² |

Set at its closed-form equilibrium, the linked spar does not move at any of these steps (its float32 height never changes). Not linked, it rings and settles off the equilibrium: a swing of 0.49 mm and an offset of 0.50 mm at 240 Hz, 12.3 mm and 13.6 mm at 30 Hz.

**Heave.** The same spar, kicked at 0.05 m/s with no drag, swings at 1.0449 Hz at 240 Hz against `√((ρ g A + E A / L₀) / (m + m_n)) / 2π` = 1.0495 Hz (−0.43 %; −1.0 % at 60 Hz). The tether alone would give 0.889 Hz. Neither the reference nor the coupling has added mass. The swing decays (to 0.65 of the first swing after 8 s at 240 Hz, 0.25 at 60 Hz): the cable's implicit step takes energy at a rate first order in the step, and the model's water radiates waves.

On the example buoy (80.4 kg sphere, `B` = 2125 N, cable node `m_n` = 0.0275 kg, 240 Hz) the link removed a tension error of +0.729 N (`m_n B / (m + m_n)`) and a draught error of −0.41 mm; the rows are in the table below.

What remains:

- The water's force is taken as constant over the step. Its stiffness, the hydrostatic term `ρ g A`, is not in the interface solve. No instability was found with it at 30 Hz on the spar (392 N/m beside a 1000 N/m tether); a case where the hydrostatic stiffness times `dt²` is large against the mass is not checked.
- A body that is both floating and on a **frame** gets the frame's first half kick after the force was predicted and before the water reads the body, so the predicted and the applied force differ slightly there. The combination runs and is covered by the bit-identity test, but has no closed-form validation.
- Driving the modules by hand: call `linkWaterToStructure` yourself, or the interface solve sees gravity only as before.

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

### Rigid support force → solid (`reactionLoadLink(solid, [{body, faces, gravityScale?}], {id?})`), one-way

The force that holds a body up, `m (Δv / Δt − g)` measured from the body's motion in the rigid step just taken (velocity read in `prepare`, before the rigid step, and in `step`, after it), is put, reversed, on boundary faces of a `SolidBody` or `FractureBody` as a uniform traction (the force over the faces' reference area). It is the body's weight while the body rests, and the impact force, spread over one rigid step, when it lands. It is meant for a body that rests on a fixed carrier over the solid (a platen) and touches nothing else: every force the rigid world puts on the body is counted, so a body that falls off onto the ground loads the solid with its weight. A joint that only guides the body sideways (a prismatic guide) adds nothing along the load. The solid's deflection does not move the body. The link owns the solid's surface loads (it clears them every step). Post stage at link order; for a solid in contact (couple stage) the load acts from the next step. The scene format's `loads` make one link per solid (`<solid id>:loads`). Checked: the notched-beam example carries the hammer's weight to 10⁻³ at rest (`tests/physics/lab-coupled-scenes.test.mjs`); there is no closed-form check of the impact.

## The energy ledger

`simulation.energy()` returns one entry per subsystem that reports energy, in step order, then a `rigid` entry for tracked bodies, with totals:

```ts
{entries: [{id, kind, domain, total, exchanged, balance, parts}], mechanical, thermal, total, exchanged, balance}
```

- `total` is what a subsystem holds now; `exchanged` is what entered through its declared boundaries (the heat solver's boundary and source heat); `balance = total − exchanged` is constant for a solver without losses.
- `mechanical` and `thermal` are kept apart because they differ by many orders of magnitude; `total` is their sum.
- **Rigid bodies.** The world reports mass but not rotational inertia. `simulation.trackBody(body, inertia)` counts a body in the `rigid` entry: `½ m v² + ½ ω·I ω − m g·x`. A body the structure coupling carries is counted there (with the pending half kick), and `trackBody` refuses it. The scene loader tracks floating bodies that no cable or frame carries. Other bodies are not in the ledger unless you track them.
- **Water.** The water's potential includes the work against the displaced volume, which it knows after its first step. Take the baseline after the first step.
- The ledger is a sum of what each solver reports at the end of a step. Terms are known up to half a step apart. With drag it falls, but it may exceed its start by the sampling offset `ρ g V v dt` of [`WATER_COUPLING.md`](WATER_COUPLING.md) (measured 0.82 J against a bound of 4.99 J, in a run that lost 49.7 J).
- A solid whose temperature or loads a link is changing is not a closed system; its entry then changes by the work done on it.

## Scenes

The `box3d-scene` format ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-water-cables-frames)) has seven optional top-level sections: `water`, `cables` and `frames`, since 2026-11-11 `cloths` and `grains` ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-cloths-and-grains)), and since 2026-11-12 `solids` and `heat` ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-solids-and-heat)). **The version stays 1**: the sections are optional and additive, a scene without them has the canonical text and hash it always had (the five example hashes are pinned in the test), and a reader that predates them rejects a scene that has them with `unknown key "water"` rather than misreading it.

`loadScene(world, scene)` of `box3d-webgpu-kit/scene` builds them and returns a ready Simulation next to what it returned before:

```ts
{bodies, joints, builder, scene,
 simulation,            // steps the world and everything else; for a rigid-only scene its step is world.step()
 water,                 // Map<basin id, WaterCoupling>; each is a subsystem under its id
 cables, frames,        // Map<id, CompliantCableRuntime>, Map<id, FrameRuntime>
 structure,             // the one StructureCoupling that holds them (subsystem 'structure'), or null
 attachments,           // Map<'<cable or frame id>:<index>', StructureAttachment>: live force, tension, gap
 cloths, grains,        // Map<id, ClothCoupling>, Map<id, GranularCoupling>; each a subsystem under its id
 solids,                // Map<id, {body, coupling, heat}>: SolidBody or FractureBody, its SolidCoupling or null, its HeatSolver or null
 heat,                  // Map<id, HeatSolver>; each a subsystem under its id, with its link to the solid as '<id>:solid'
 fluids}                // Map<id, {kind: 'flow', flow, coupling} | {kind: 'free-surface', surface}>; each a subsystem under its id
```

Build order, which is part of the format because it fixes the bits: bodies and joints as before; every frame, then every cable, in file order; one `StructureCoupling` that is handed all of them, then the cables' attachments (cable by cable, in file order), then the frames' attachments; then each cloth (its bodies, planes and attachments), then each grain set (walls, bodies, grains); then each solid (mesh, notches and interfaces, saved cracks, supports, saved state, contact, welds, the `<id>:loads` link), then each heat grid with its `<id>:solid` link; then each fluid (a flow with its `FluidCoupling` and bodies, or a bare `Fluid`; a free-surface tank); then each basin and its bodies. A dynamic body that a cloth, grains or a flow push is tracked in the `rigid` ledger entry unless the structure coupling counts it. Cables and frames take the world's step and the scene's gravity. An invalid scene leaves the world untouched; a section the engine refuses leaves it reset and empty, and the error starts with `Scene cable "<id>":`, `Scene frame "<id>":` `Scene water "<id>":`, `Scene solid "<id>":`, `Scene heat "<id>":` or `Scene fluid "<id>":`.

`saveScene` writes the sections back with the fields the solvers hold: the basin's `eta`, `u` and `v`, each cable's node positions and velocities, each frame's displacements and velocities, each solid's displacements, velocities and interfaces, each heat grid's temperatures, each flow's face velocities and pressures and each tank's particles. Not saved: the structure coupling's own state (last step's interface impulses and the pending half kick, so the saved velocity of a body resting on a frame is off by about `g dt / 2`), the cable solver's multipliers, and one step of displaced volume (the first step after a load takes a wet body as part of the starting state). A run resumed from a saved scene starts from bit-identical fields and then differs slightly; the measured drift is in the table below. A checkpoint (`simulation.checkpoint()`, [`CHECKPOINTS.md`](CHECKPOINTS.md)) holds all of that state, and a run resumed from it is bit-identical.

The core `loadScene` of `src/engine/scene-format.ts` builds rigid bodies and joints only, so it **refuses** a scene that has any of these sections (`INVALID_STATE`, world untouched) instead of building its rigid part and dropping the rest. The Physics Lab builds every scene with `loadSimulationScene` through its own host (`src/lab/scene-host.ts`, which takes forces and impulses like the kit's PhysicsWorld) and steps a coupled scene through the returned Simulation, one `simulation.step()` per fixed step ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#in-the-physics-lab)). Heat grids, solids and fracture bodies are described by the `heat` and `solids` sections, fluids by the `fluids` section.

Ten example scenes (`COUPLED_EXAMPLE_SCENES`; they are kept out of `EXAMPLE_SCENES`, which every rigid-only loader can open; the Lab opens all of them with `lab.html?example=<name>`):

| Function | Contents |
|---|---|
| `mooredBuoyScene()` | A sphere (R = 0.4 m, 300 kg/m³) floating in an 8 m × 8 m basin 3 m deep, held under its free waterline by one compliant cable (2.75 m, `EA` = 5·10⁴ N) from an anchor on the bed. Options: `offset`, `linearDrag`, `waterDrag`, `lineDensity`, … |
| `cableStayedDeckScene()` | The span of the structure-coupling validation: an 8 m steel deck of 8 elements on a pin and a roller, two stays from a tower top 3 m above midspan, a 14.1 kg ball pinned to deck node `loadNode`. |
| `buoyAndCratesScene()` | The moored buoy released 0.4 m off its line and three crates dropped into the basin. |
| `trampolineScene()` | A ball and a box dropped on a cloth of 81 nodes held along its edges. 1/120 s. |
| `hopperSeesawScene()` | 150 beads run out of a conical hopper into a tray on a hinged plank and tip it against a counterweight. |
| `suspendedPlatformScene()` | A platform on four compliant cables, loaded by four falling boxes. |
| `rubberPadScene()` | A box dropped onto a neo-Hookean rubber pad welded to a steel plate (solid contact, two-way, friction). |
| `notchedBeamScene()` | A drop hammer on a guide lands on a platen over a notched concrete beam and cracks it (cohesive fracture, `reactionLoadLink`). |
| `quenchedPlateScene()` | A hot alumina plate quenched on one face cracks in the cooled layer (heat → fracture body). |
| `heatedBarScene()` | A bar clamped between a hot and a cold block: temperature ramp and thermal compression (heat → solid). |

These eight (all but the first two) are demonstrations of the coupled loop, not validation cases: they have no closed-form answer. What is checked for them (`tests/physics/lab-coupled-scenes.test.mjs`, in `npm run test:assets`) is that two runs are bit-identical, that a save reopened from its share link starts from the saved fields bit for bit and runs the same twice, and that the parts are drawn.
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
| Moored buoy at rest: force of the cable on the buoy | `ρ g V_sub − m g` = 1338.2262 N | 1338.2271 N (6.6e-7) | 1e-5: float32 mass and gravity |
| … segment tension | `ρ g V_sub − (m + m_n) g` = 1337.9564 N | 1337.9573 N (+0.0009 N, 7·10⁻⁷) | 1e-5. Was +0.729 N before the water's force was in the interface solve |
| … draught, against the equilibrium of cable stretch, level rise and cap volume | 0.57610 m | 0.57610 m (−0.45 µm) | 5e-6 m: float32 height. Was −0.41 mm |
| … tension against that equilibrium | 1337.958 N | 1337.957 N (−6.7e-7) | 1e-5. Was −6.8e-4 |
| … floor load − anchor pull | total weight 1 881 985.494 N | 1 881 985.493 N (−0.001 N) | 0.02 N. Was −0.73 N |
| … mean level rise | `(V_sub − V_0) / A` | equal | 1e-9 m |
| Released 0.4 m to the side, 24 s | bounded by the offset; each 4 s window smaller; back at rest | windows 0.3999, 0.0040, 0.0015, 0.0009, 0.0003, 0.0002 m; ends 0.13 mm off the line, 1.4e-6 m from the rest height | ≤ offset; monotone; 2 mm; 0.2 mm |
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
| Moored buoy with drag, released | falls; never above the start by more than `ρ g V v dt` | fell 49.7 J; largest excess 0.82 J against 4.99 J; always below the start in the second half | as stated |
| A tracked spinning box in zero gravity | `½ m v² + ½ I_x ω²` = 28.080001 J | 28.080001 J at the start; 28.080338 J after 1 s | 1e-6; 1e-4 (the rigid solver's drift; the first bound for this was 1e-6 and it measured 1.2e-5) |

**Save, load, continue.** Saved at tick 240 through a share link, compared 240 ticks later. Bounds are about ten times the measured values.

| Scene | At the moment of loading | Drift after 240 ticks | Bound |
|---|---|---|---|
| Moored buoy, released 0.4 m off | fields bit-identical; body position and velocity equal | buoy 5.9e-6 m; surface 4.0e-5 m (waves 2.3 mm high) | 1e-4 m; 4e-4 m |
| Cable-stayed deck | fields bit-identical; body position and velocity equal | ball 1.6e-8 m; deck 4.3e-7 m (deflection 1.2 mm) | 2e-7 m; 4e-6 m |

Two loads of the same scene, one of them from a share link, stay bit-identical for the whole 480 steps.

## Limits and open items

- **Contact between rigid bodies and deformable solids** is in a module of its own ([`SOLID_CONTACT.md`](SOLID_CONTACT.md)), node against body, with its limits stated there. Two solids do not collide with each other.
- **Water and structure on one body:** the water's force is in the structure coupling's interface solve through `linkWaterToStructure`; its hydrostatic stiffness is not, and a floating body on a frame has no closed-form check (above).
- **Links are one-way** and the thermal link needs co-located box grids. General mesh-to-grid interpolation, thermoelastic feedback and heat from a rigid contact are open.
- **Solids and heat in scenes** (since 2026-11-12): a fracture body has no contact with rigid bodies, so a falling weight reaches it through `reactionLoadLink` only, one-way; the crack-band model has no scene form; a heat grid needs a solid with a box mesh. A save of a solid in contact does not carry its contact state.
- **A save is not a checkpoint.** A saved scene leaves the solvers' internal state out; see the drift table. For an exact continuation use `simulation.checkpoint()` and `restore()` (or `resumeSimulationScene`), [`CHECKPOINTS.md`](CHECKPOINTS.md).
- **The rigid ledger entry covers tracked bodies only**, and assumes the body's position is its centre of mass.
- A subsystem that throws in the middle of a step leaves the step half done; the world's tick then no longer matches and the next `step()` refuses. Build a new Simulation from a saved scene, or resume the last checkpoint.
- The world rejects `applyForce` while recording, so a Simulation with a water or structure coupling cannot run under `startRecording()`.
- **Forces too small for a float32.** The rigid world works in float32 and refuses a nonzero force or torque component below the smallest float32 (about 1.4·10⁻⁴⁵). Round-off of the interface solve can leave one, so the coupling hands over an exact zero for such a component. (Fixed 2026-11-11; before that a cable attached off a floating body's centre threw on its first step.)
- The Physics Lab runs and draws coupled scenes (since 2026-11-11); the Studio does not.

## Reproduce

```sh
npm run test:kit                                                   # builds the kit, runs every kit test, cleans up
npm --prefix packages/box3d-kit run build
node --test --test-reporter=tap packages/box3d-kit/test/v14-simulation.test.mjs   # prints the measured numbers
npm --prefix packages/box3d-kit run clean
npm run validation:check
```
