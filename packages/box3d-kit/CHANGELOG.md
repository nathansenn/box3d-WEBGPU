# Changelog

## Versioning policy

- The kit follows semver for its **JavaScript API**. `api/public-api.txt` is the reviewed surface; `npm test` fails when it changes without being regenerated.
- The **WASM** is identified by `BUILD_INFO`: the upstream Box3D ref and commit, the Emscripten version, the bridge source SHA-256 and the `box3d.wasm` SHA-256. Any change to the WASM is at least a minor release, because replay logs and `exactHash()` values are only comparable on the same WASM.
- The native world ABI version (`NATIVE_WORLD_API_VERSION`, currently 1) must match the loaded module; a mismatch fails loudly with `UNSUPPORTED_BACKEND`.
- Before 1.0, minor versions may change the API; the changes are listed below.

## Unreleased

- **`box3d-webgpu-kit/fluid`:** volumetric incompressible flow (solver id `fluid-mac-projection-mic-pcg-js-f64-v1`), its two-way coupling to the rigid world (`rigid-fluid-coupling-fictitious-domain-js-f64-v1`) and a free-surface option (`fluid-free-surface-apic-mac-js-f64-v1`). The equations, the validation table and the limits are in `docs/FLUID.md`.
  - `Fluid`: the Navier–Stokes equations on a staggered grid of cubic cells in SI units, float64, deterministic. Incremental pressure projection by MIC(0)-preconditioned conjugate gradients (`pressureTolerance` on max |div u| h over the largest velocity, default 1e-10); `advection: 'central' | 'upwind' | 'none'` with Adams–Bashforth 2; `diffusion: 'explicit' | 'crank-nicolson' | 'backward-euler'`; `gravity` and a uniform `bodyForce`. Sides `no-slip` (moving lids), `free-slip`, `inflow`, `outflow`, `periodic`.
  - Obstacles: `addObstacle` (sphere, box, capsule, cylinder), `setObstacleState`, `setObstacleEnabled`, `obstacleForce`, `obstacleTorque`, `obstacleImpulse`, `obstacleVolume`; `controlVolumeForce` integrates momentum flux, pressure and viscous stress over a box of faces.
  - Measures: `velocityAt`, `pressureAt`, `flowRate`, `maxDivergence`, `kineticEnergy`, `momentum`, `energyBalance` with `dissipated`, `workByBodies`, `workByBoundaries`, `workByForces`; `setVelocity`, `setPressure`, `project`.
  - Time step: `maxTimeStep()`, `checkTimeStep()`; a step above the explicit viscous limit is refused with `UNSTABLE_TIME_STEP` (or flagged under `allowUnstable`); the Courant number is recorded every step.
  - `FluidCoupling(world, fluid)`: `addBody(body, {shape})`; `step()` before `world.step()` moves the bodies' obstacles and hands them the mean force and torque (float32-safe). `fluidSubsystem` for a `Simulation` (couple stage, order 180; a bare `Fluid` in the post stage) with an energy entry and `cfl-exceeded`, `unconverged` and `unstable-step` events.
  - `FreeSurfaceFluid`: inviscid liquid particles (APIC) in a closed tank, ghost-fluid free surface; `addLiquid`, `front`, `surfaceHeight`, `liquidVolume`, energies.
  - Closed forms: `taylorGreenVelocity`, `poiseuilleVelocity`, `ductVelocity`, `ductFlowRate`, `hasimotoDragFactor`, `sloshingFrequency`, `fluidShapeVolume`.
  - Measured: divergence 6e-11 after projection; Taylor–Green decay rate −0.28% at 32 cells, second order; Poiseuille, Couette and square-duct profiles; the cavity within 0.22%/0.82% (Re 100, 32²) and 1.3%/1.5% (Re 400, 48²) of Ghia et al.; water at rest to 8e-20 m/s; Stokes drag −7.5% and −3.3% against Hasimoto at 2.4 and 3.6 cells per radius; a settling rigid sphere 6% fast; momentum exchange to 9e-16 (float64) and 2.8e-7 (through the float32 world); dam break within 7.4% of Martin & Moyce; sloshing −0.48%.
  - Limits: no turbulence model; obstacles placed to about h^2 (drag several percent off at 2–4 cells per radius); explicit coupling; the free surface is inviscid, without surface tension or bodies; about 10,000 cells per 60 Hz frame on one thread.
- `capabilities().modules` includes `'fluid'`. `test/v18-fluid.test.mjs` (14 tests, about 31 s) runs in the gate. `scripts/bench-fluid.mjs` measures the cost.
- **`box3d-webgpu-kit/materials`:** a material library with sources (`MATERIAL_LIBRARY_VERSION` 1.0.0): 21 materials and 31 contact-pair entries, 208 SI values each with conditions, the figure read and a citation (`MATERIAL_SOURCES`); 6 contact coefficients without a source are marked unverified and refused unless `allowUnverified` is passed. Helpers build solver inputs: `solidMaterial` (solid and fracture), `fractureLaw` (G_c from K_IC, plane strain by default), `heatMaterial`, `grainMaterial`, `contactPair` and `rigidMaterial` (density, friction, restitution for a body). `materialAudit()` and `shearConsistency()` for checks. Pure data and functions; it imports only types from the solver modules. See `docs/MATERIALS.md` in the repository.
- `capabilities().modules` includes `'materials'`. `test/v18-materials.test.mjs` (3 tests) runs in the gate.

## 0.9.0

The WASM changed: the bridge has four new exports (`b3w_world_create_compound_body`, `b3w_world_set_body_mass_data`, `b3w_world_get_body_mass_data`, `b3w_world_reset_body_mass_data`) and `BUILD_INFO` has new hashes. Nothing that existed was changed: the native world ABI version is still 1, and the replay hashes of the presets, the hashes of the example scenes and the determinism checks of the gate are what they were. The new exports are optional; an artifact without them still loads, and asking it for a compound or mass data throws `UNSUPPORTED_BACKEND`.

- **Compound bodies:** `createBody({shape: {kind: 'compound', shapes: [...]}})` puts 1 to 64 boxes, spheres, capsules and convex hulls on one body, each with its own `position` and `rotation` in the body's frame and its own `density`, `friction` and `restitution` (each defaults to the body's). Mass, centre of mass and inertia are the sums over the shapes. `bodyKinds()` reports `'compound'`; the render row is an unscaled transform. New types: `ConvexShapeOptions`, `CompoundShapeOptions`, and on the native layer `NativeConvexShape`, `NativeCompoundChild`, `NATIVE_COMPOUND_LIMIT`.
- **Explicit mass data:** `BodyOptions.massData`, `world.setMassData(body, {mass, center?, inertia})`, `world.resetMassData(body)` and `world.getMassData(body)` (mass, centre of mass in the body frame, inertia tensor about it as `[Ixx, Iyy, Izz, Ixy, Ixz, Iyz]`, whether it was set, and the shape count). The bridge keeps the pose and the velocity of the body's origin when the centre of mass moves, keeps the values across `setBodyType` (Box3D alone drops them), refreshes the world-space inertia at once (Box3D alone uses the old one for a step), and gives a body with `lockRotation` no inertia. New types: `MassDataOptions`, `BodyMassData`, `NativeMassData`, `NativeBodyMassState`. `setCollisionFilter` now reaches all 64 shapes of a body (it stopped at 8).
- **Replay and worker:** `createBody` with a compound or `massData`, `setMassData` and `resetMassData` are recorded and replayed bit for bit, and `RemoteWorld` has `setMassData`, `resetMassData` and `getMassData`.
- **`box3d-webgpu-kit/scene`, version 2:** the shape kind `compound` (children with `shape`, `position`, `rotation` or `rotationEuler`, `density`, `friction`, `restitution`) and the body key `massData`. `SCENE_VERSION` is now 2 and `SCENE_VERSIONS` is `[1, 2]`; `SCENE_LIMITS.compoundShapes` is 64. A scene that uses neither feature is still written as version 1, with the canonical text and `sceneHash` it had; a version 2 feature in a file that declares version 1 is a validation problem. A reader of 0.8 rejects a version 2 file by its version. New types: `SceneConvexShape`, `SceneCompoundChild`, `SceneMassData`.
- **`box3d-webgpu-kit/robot`:** a link with several collision shapes is now one compound body, and a link whose shapes do not have the file's `<inertial>` (to 1e-9) is given the file's mass, centre of mass and inertia tensor. On the example arm the solver's principal moments are within 5e-8 of the file's (42% off on the worst link before); a rod whose file states 1.3 × its shape's inertia swings with the file's period to 8.6e-7. This changes the scenes of robots whose files state an inertia their shapes do not have, and of robots with multi-shape links. New options `links: 'compound' | 'welded'` and `inertia: 'file' | 'shapes'`; `{links: 'welded', inertia: 'shapes'}` gives the previous scenes character for character (checked on the seven example robots). `RobotLinkReport` gains `inertiaSource`, `shapesPrincipalError`, `shapesTensorError` and `shapesComOffset`; its `principalActual`, `comActual` and errors now describe what the solver is given.
- Limits: a compound has one colour, one filter and one set of flags; events and queries name the body, not the shape; no meshes or height fields in a compound; overlapping shapes count twice; a stated inertia tensor only has to be positive definite. `createShapeMeshes` (three.js) and the Babylon adapter draw a compound row as a unit box. `createBodiesFromMesh` still welds decomposed pieces.
- `test/v17-compound.test.mjs` (12 tests) checks all of the above against closed forms; 26 cases were added to the validation registry.

- **`box3d-webgpu-kit/fracture`:** fracture of tetrahedral solids, in SI units. The laws, the validation and the limits are in `docs/SOLID_FRACTURE.md`.
  - `FractureBody`: the small-strain solid of `box3d-webgpu-kit/solid` (linear model) that cracks. `model: 'cohesive'` puts an interface on a face that reaches its strength and duplicates the nodes it separates, deterministically and without changing the body's mass. The interface follows a bilinear traction-separation law with strength `sigma_c` and fracture energy `G_c` (critical opening `2 G_c / sigma_c`), mixed mode by an effective opening, irreversible damage and a contact penalty. `insertCohesive`, `precrack` and `setInterfaceProperties` place interfaces, notches and weak planes by hand. `model: 'crack-band'` softens elements by a Rankine criterion with the softening scaled by element size.
  - `solveStatic()` (one increment per call), `step()` with backward Euler, midpoint or explicit integration, and `energy()`, a ledger of strain, interface, kinetic, dissipated, damping and relaxation energy against external work.
  - `fragments()` lists the connected pieces with mass, centre of mass, momentum and inertia; `handOff(fragment)` returns a hull-body description for `createBody` and stops simulating the piece. One-way.
  - `fractureSubsystem(body)` for a `Simulation` (post stage, with crack events), and `quenchedPlate()`, a thermal-shock example. `thermalSolidLink` now accepts a `FractureBody` (its parameter type is the new `ThermalSolidTarget`).
  - Measured: peak load and fracture energy of a bar to 1e-9; mesh-objective energy for both models; Griffith's stress of a centre-cracked plate +11.5 % on cells of `l_ch = E G_c / sigma_c^2` and −3.5 % on cells of `l_ch / 2` (a converged cohesive crack of that size is 4.5 % below Griffith); work of fracture of a notched beam within 0.1 % of `G_c` times the area that can open; momentum of a bar breaking in flight to 2e-14; first thermal-shock crack 2.5 % later than the heat module's estimate.
  - Limits: cracks follow element faces, so a crack inclined 30° to the mesh is 24 % to 48 % too large at any resolution; on-demand insertion misses crack-tip stress on coarse meshes (use `insertionThreshold` or pre-insert the path); small strain; no plasticity; no contact between fragments.
- **`box3d-webgpu-kit/solid-contact`:** contact between the tetrahedral solid and rigid bodies (solver id `solid-contact-penalty-newton-pcg-js-f64-v1`) and its two-way coupling to the rigid world (`rigid-solid-coupling-monolithic-js-f64-v1`). The equations, the validation table and the limits are in `docs/SOLID_CONTACT.md`.
  - `SolidContact`: a `SolidBody` (backward Euler) stepped together with rigid bodies: `addBody` (box, sphere, capsule, plane; static, kinematic or dynamic), `weld`, `unweld`, `step`, `solveStatic`, `bodyForce`, `bodyTorque`, `nodeForce`, `maxPenetration`, `contactEnergy`, `externalWork`, `linearMomentum`, `stats`. Contacts are one-sided springs between surface nodes and the bodies, as stiff as `stiffnessScale` (default 100) layers of elements over the area the node turns to the body; friction is a stick spring capped at `μ N`; welds are springs in three directions.
  - `SolidCoupling`: `addBody`, `addPlane`, `weld`, `step()` (call it before `world.step()`), `force`, `torque`, `contactChanges`, `diagnostics`. Each dynamic body is six unknowns of the solid's solve with the inertia the rigid step gives it; `scheme: 'naive-staggered'` exists to show what that avoids. Forces too small for a float32 are handed to the world as zero.
  - `solidContactSubsystem` for the one stepping loop (couple stage, order 170, between the cloth and the water), with an energy entry and `contact-begin`, `contact-end` and `unconverged` events.
  - `SolidBody.kernel()` (in `box3d-webgpu-kit/solid`): the element mechanics for a solver that advances the body together with something else. `SolidBody` itself is unchanged.
  - Measured: block on a pad to 1e-11 in uniaxial stress and strain; Hertz +16 %, +9 %, +7 % at 2.5, 3.75 and 5 elements per contact radius (against Hertz with the bonded-layer factor), exponent 1.56; friction sticks at tan θ = 0.488 and slides within 0.4 % of `g (sin θ − μ cos θ)` at 0.521 with μ = 0.5; block on a column −0.14 % from the bar with a tip mass; welded weight to 4e-6; momentum to 8e-13 (float64 bodies) and 1e-7 (float32 world); a 4 g body on steel never faster than 6e-7 m/s.
  - Limits: node against body only; no hulls, meshes or height fields; no solid ↔ solid contact; one contact plane per node, body and step, nothing traced along a path; backward Euler only; friction with one coefficient.
  - `capabilities().modules` lists `solid-contact`. `test/v17-solid-contact.test.mjs` checks all of the above.
- **Fracture, on-demand insertion at crack fronts.** New `FractureLaw.tipInsertionThreshold` (default 0.4, exported as `TIP_INSERTION_THRESHOLD`): a face that shares a node with a cut, open or softening face gets its interface at that share of its strength; every other face still at `insertionThreshold` (default 1). The centre-cracked plate with nothing inserted beforehand now fails at the stress of the pre-inserted path (0 and +0.9 % on cells of `l_ch / 2` and `l_ch`, one load step being 1 %), where it held 1.59 and more than 1.8 times its Griffith stress. One lower threshold for every face was measured and rejected: it gives the same failure load but a bar at 0.9 of its strength then carries 68 % (8 cells) or 50 % (16 cells) of its elastic stress. Unchanged bit for bit: the bar's peak and `G_c A`, the energy balances, the notched beam, free flight, the thermal shock to its first crack. Changed: a crack inclined 30° to the mesh now has 1.03, 1.21 and 1.30 times the area of the plane (was 1.24, 1.24, 1.48) and a peak load 2 % to 15 % high (was 11 % to 44 %). `tipInsertionThreshold: 1` restores the old rule.
- **Water forces in the structure coupling's interface solve.** `StructureCoupling.addLoadProvider((body, out) => …)` adds another solver's force and torque to an attached body's free motion; `WaterCoupling.predictLoad(body, out)` reports the buoyancy and drag `step()` would apply now, without side effects; `linkWaterToStructure(water, structure)` of `box3d-webgpu-kit/simulation` joins the two, and `loadScene` calls it for every basin of a scene with cables or frames. A floating body on a cable is then placed where it goes: on a moored spar the draught and tension are right to 1e-7 m and 4e-7 at steps of 1/240, 1/60 and 1/30 s, where they were 0.50, 3.6 and 13.6 mm and up to 2.2 % off; the example buoy's tension error of 0.73 N and draught error of 0.41 mm are gone. Results of scenes with a floating body on a cable or frame change by those amounts. The hydrostatic stiffness is not in the interface matrix. `test/v17-moored.test.mjs`.

- **`box3d-webgpu-kit/granular`:** granular media by the discrete element method (solver id `granular-dem-soft-sphere-verlet-js-f64-v1`) and its two-way coupling to the rigid world (`rigid-granular-coupling-subcycled-js-f64-v1`). The equations, the validation table and the limits are in `docs/GRANULAR.md`.
  - `Granular`: spherical grains of any radii in SI units, float64, velocity Verlet. `law: 'hertz'` (Young's modulus and Poisson's ratio) or `'linear'` (`normalStiffness`); a dashpot solved for the `restitution` asked for (`granularDampingCoefficient`); a tangential spring with history under Coulomb `friction`; `rollingFriction` as an elastic-plastic spring. `addGrain`, `addGrains`, `removeGrain`, `granularLattice` for a seeded starting arrangement, `bounds` to remove and count grains that leave.
  - Time step: `criticalTimeFor(radius)` (the Rayleigh time for Hertz, the contact duration for linear), `maxTimeStepFor`, `timeStepFraction`. A grain for which `dt` exceeds 0.4 (Hertz) or 0.2 (linear) of the critical time is refused with `EngineError` code `UNSTABLE_TIME_STEP`, unless `allowUnstable` is set.
  - Walls: `addWall` with a plane, box, sphere, capsule, `cylinder`, `annulus` (a floor with an orifice) or `frustum` (a hopper); static, kinematic (`setWallVelocity`) or dynamic (mass and inertia). `wallForce`, `wallTorque`, `wallImpulse`, `wallNormalLoad`, `setWallEnabled`.
  - Energies: `kineticEnergy`, `gravitationalEnergy`, `elasticEnergy`, `dissipatedDamping`, `dissipatedFriction`, `externalWork`, `energyBalance`; `linearMomentum`, `angularMomentum`, `coordination`, `stats`.
  - `GranularCoupling(world, granular)`: `addBody(body, {shape})` for boxes, spheres and capsules; `step()` before `world.step()` takes the grains through one rigid step in a whole number of their own steps and hands the bodies the mean force. `granularSubsystem` for a `Simulation` (couple stage, order 160).
  - Measured: Hertz contact duration to 1e-5 and second order; restitution to 1e-3; sliding and rolling on an incline to 1e-12 and 2e-4; the energy ledger to 0.12% of the energy dissipated; a block on a bed to 7e-7 of its weight; momentum with a rigid body to 2e-7. Janssen saturation and the Beverloo 5/2 law hold in form, with constants (K about 1.1, C 0.45 to 0.49) that are not the textbook ones.
  - Limits: spheres only; the validation's beads are about a thousand times softer than glass; about 2 million grain-steps per second on one thread, 100 to 250 soft 10 mm beads in real time; no twisting resistance, cohesion or checkpoints.
- **`box3d-webgpu-kit/cloth`:** a calibrated cloth (solver id `cloth-stvk-koiter-newton-pcg-js-f64-v1`) and its two-way coupling to the rigid world (`rigid-cloth-coupling-monolithic-js-f64-v1`). The equations, the validation table and the limits are in `docs/CLOTH.md`.
  - `Cloth`: a triangle mesh in SI units with an areal density, Young's modulus, a thickness and Poisson's ratio. Membrane: constant-strain triangles with the St. Venant–Kirchhoff plane-stress law (`membrane: 'spring'` is an edge-spring model for comparison, which cannot be given a Poisson's ratio). Bending: the Koiter plate energy on the triangle-averaged shape operator, `D = E t³ / (12 (1 − ν²))` or a stated `bendingStiffness` (`bending: 'hinge'` is the plain hinge energy, for comparison). Mass-proportional `drag`.
  - Integration: backward Euler as a minimisation, solved by Newton's method with a positive-definite Hessian, block-Jacobi conjugate gradients and a line search, to a force tolerance; `integrator: 'midpoint'` for smooth problems without contact; `solveStatic()` for equilibria. Deterministic, float64, no allocation in `step()`.
  - Supports and loads: `pinned`, `pin`, `release`, gravity, `setNodalForce`, `setPressure`, `setWind` (a normal-pressure formula), `reactions`, `totalReaction`, `triangleStress`, energies and `externalWork`.
  - Contact with boxes, spheres, capsules and planes by their exact signed distance, found along each node's path relative to the body, with Coulomb friction that sticks without creep. A 2 mm plate swept at 200 m/s leaves no node behind.
  - `ClothCoupling`: `addBody`, `addPlane`, `attach`, `step()` (call it before `world.step()`), `force`, `torque`, `diagnostics`. Each dynamic body is six unknowns of the cloth's solve with the inertia the rigid step gives it, so contact and attachments are implicit on both sides; the forces handed to the world are the ones the cloth felt, reversed. `scheme: 'naive-staggered'` is there to show the instability it avoids.
  - Self-collision: `selfCollision: {thickness}`, point-triangle and edge-edge repulsion from a spatial hash, with `minimumSelfDistance()` to check it.
  - `clothSubsystem` for the one stepping loop (couple stage, order 150, between the structure coupling and the water), with an energy entry and `contact-begin`, `contact-end` and `unconverged` events. `clothGrid` builds rectangular meshes.
  - Measured: patch test to 9e-15 m; `σ = E ε` and `−ν ε` to the law's own 1.5 ε; catenary sag, cantilever tip, strip frequency and membrane deflection to 0.05%, 0.08%, 0.05% and 0.1% at 32 elements, all second order; sliding at `g (sin θ − μ cos θ)` to 5e-9; trampoline momentum to 1.5e-6; a draped cloth's weight on a scale to 1.2e-5.
  - Limits: about 100 nodes in real time; bending is consistent on structured meshes only (4% off at 25% jitter, not improving with refinement); node-against-body contact, no hulls, meshes or height fields; self-collision is not intersection-free; no tearing, anisotropy or material damping.
  - `capabilities().modules` lists `cloth`. `test/v16-cloth.test.mjs` checks all of the above against closed-form answers.
- **Joint stiffness:** `JointOptions.stiffness` and `world.setJointStiffness(joint, hertz, dampingRatio)` set how stiffly a joint holds its bodies together. Box3D's fixed default (60 Hz, damping ratio 2) let a loaded chain sag by millimetres per joint; the sag falls as 1 / hertz², measured 9.9 mm, 2.5 mm and 0.6 mm at 60, 120 and 240 Hz on a 12-link hanging chain. Also in scene files, recordings, the worker, and as `jointStiffness` in robot import. The WASM is rebuilt for it.
- **`box3d-webgpu-kit/simulation`:** one stepping loop for every solver. The contract and the measured numbers are in `docs/SIMULATION.md`.
  - `Simulation` (`createSimulation(world)`) owns a `PhysicsWorld` and any number of subsystems and advances them with one `step()` or `update(frameSeconds)`: `prepare`, then the stages `pre-couple`, `couple`, the rigid step, `post`, then events and `onStep`. The order is a property of each subsystem (`stage`, `order`, `id`), so registering in any order gives the same bits. One clock (`tick`, `time`), one `onStep`, one `onEvent` stream that carries the world's contact events and the subsystems' own, `order()`, `energy()` and `diagnostics()`.
  - Adapters for the existing modules, which are not changed: `waterSubsystem`, `structureSubsystem` (couple stage, structure before water), `heatSubsystem`, `solidSubsystem` (post stage). Each states its time-step requirement, checked at registration: the couplings must step with the world; heat and solids may take N of their own steps per world step or one every N; an explicit one must be within its stability limit. A subsystem that does not fit is refused with an `EngineError` that names the rule.
  - A run through the Simulation is bit-identical to driving the modules by hand in their documented order: checked for each adapter alone, and for water, structure (a cable and a clamped frame), heat, the thermal link and a solid together in three registration orders.
  - Two one-way links: `thermalSolidLink` (the heat solver's temperature becomes a solid's thermal strain; co-located box grids only; a free block grows by `alpha dT` with stress below 2e-11 `E alpha dT`, a held bar reaches `-E alpha dT` to 3e-11) and `deadLoadLink` (a rigid body's weight as a dead load on solid nodes; shortening and stress to 3e-11).
  - An energy ledger: one entry per solver with mechanical and thermal totals and the heat that crossed boundaries; `trackBody` adds rigid bodies. Conserved to 5e-12 for a midpoint linear solid, never growing for a cable pendulum, falling with drag.
  - Not coupled: contact between rigid bodies and deformable solids; the structure coupling does not see water forces in its interface solve (a moored buoy's cable tension reads 0.73 N of 1337 N high); the links are one-way.
- **`box3d-webgpu-kit/scene`:** coupled scenes. The format stays version 1.
  - Optional top-level sections `water` (basins and the bodies that float in them), `cables` and `frames` (with attachments to bodies and to each other), validated with JSON-pointer paths, normalised, hashed and carried by share links. A scene without them has the canonical text and `sceneHash` it had before.
  - `loadScene` builds the sections after the joints and also returns `simulation`, `water`, `cables`, `frames`, `structure` and `attachments`. Step `simulation`, not the world; for a rigid-only scene the two are the same. `saveScene` writes the water, cable and frame fields back; a resumed run starts from bit-identical fields and drifts by 6e-6 m (moored buoy) and 4e-7 m (deck) in 240 ticks, because the coupling's own state is not saved.
  - `mooredBuoyScene` and `cableStayedDeckScene` (`COUPLED_EXAMPLE_SCENES`): a buoy held under its waterline by a cable to the bed, with cable force, draught and floor load against closed forms, and the cable-stayed span of the structure validation, whose stay tensions and deflection match hand statics to 1.4e-4 from the scene file and from a share link, bit for bit.
  - `sceneHasCoupling`, `SceneWater`, `SceneCable`, `SceneFrameSection` and the attachment types; `SCENE_LIMITS` gains the limits of the sections.
- **`box3d-webgpu-kit/structure`:** `principalMoments` is exported. Nothing else in the module changed.
- `capabilities().modules` lists `simulation`. `test/v14-simulation.test.mjs` covers all of the above.
- **`box3d-webgpu-kit/robot`:** URDF and MJCF import. Dependency-free; documented in `docs/ROBOT_IMPORT.md`.
  - `parseXML`: a small XML parser for robot files (elements, attributes, text, comments, CDATA, the five predefined entities, numeric references). It refuses a DOCTYPE with entity declarations, never expands or fetches anything, caps size, depth and element count, and reports the line and column of every error.
  - `parseURDF` and `parseMJCF` read a file into one neutral `RobotDescription`. URDF: links, inertials, box, cylinder, sphere and mesh collisions, fixed, revolute, continuous, prismatic and floating joints with limits and dynamics, and a validated tree. MJCF: compiler angle and eulerseq, option gravity and timestep, nested default classes, the body tree, inertials or mass from geoms, box, sphere, capsule, cylinder, ellipsoid, mesh and plane geoms (also by `fromto`), hinge, slide, ball and free joints, and motor, position and velocity actuators. Meshes come from a map of file name to bytes (`package://` and relative names are matched after normalisation). Everything ignored, approximated or unsupported (mimic, planar, tendon, equality, contact pairs, armature, unknown attributes, ...) is listed in `warnings` with the element named.
  - `robotToScene` makes a scene file and `spawnRobot` adds the same bodies and joints to an existing world, returning handles by link and joint name; `robotKinematics` and `robotLinkPose` give link poses. One body per collision shape, welded per link; cylinders as prisms of the same volume or as capsules; joints aimed at their axes with limits, motors from effort limits on request, springs from stiffness and damping, dry friction as a zero-speed motor; joined links do not collide; the base is welded unless `floatingBase`.
  - `robotReport`: each link's mass is matched exactly through its density, and the inertia tensor that results is compared with the file's, per link, because the engine cannot take a tensor. On the example arm the worst link is 42% off; a link with mass and no shape is reproduced exactly as a non-colliding box.
  - Example robots as functions returning file text: `twoLinkArmURDF`, `cartPoleURDF`, `sixDofArmURDF`, `wheeledCartURDF`, `doublePendulumURDF`, `doublePendulumMJCF`, `hangingChainURDF`.
  - Limits, measured: joints are 60 Hz soft constraints in the engine, so the 16.8 kg example arm settles 17.7 mm below its kinematic pose at the tool and a 12-link chain shows joint gaps of 1.5 mm at rest and 3.8 mm swinging.
  - `capabilities().modules` lists `robot`. `test/v15-robot.test.mjs` checks it against closed-form answers.
- **`box3d-webgpu-kit/scene`:** scene files and share links. Dependency-free; the schema is in `docs/SCENE_FORMAT.md`.
  - A versioned plain-JSON format (`box3d-scene`, version 1, SI): world settings, named materials, bodies with all six shape kinds and every `BodyOptions` field (64-bit filter bits as decimal strings), joints with every `JointOptions` field naming bodies by id, free-form `userData`, `meta`, and an `extensions` object that is preserved and ignored. `rotationEuler` (degrees) is accepted on input.
  - `validateScene` checks a file completely before anything is built and returns problems with JSON-pointer paths. `loadScene` builds it atomically: an invalid file leaves the world untouched, and a body or joint the engine refuses leaves it reset and empty, with the id in the error.
  - `SceneBuilder` wraps a world and records what it creates (`addBody`, `addJoint`, `remove`, `toJSON`), because the world cannot report shapes or joint definitions. `saveScene` writes the scene with each body's current pose, velocities and type. Sleep state and the solver's contact and joint impulses are not saved, so a resumed run drifts from the original (measured in the test).
  - `canonicalize` (sorted keys, shortest round-trip numbers, defaults dropped), `normalizeScene` and `sceneHash` (SHA-256).
  - `encodeSceneLink` / `encodeSceneLinkSync` / `decodeSceneLink`: `b3s1<mode>.<length>.<crc32>.<base64url>`, raw DEFLATE through `CompressionStream` with a stored fallback, a built-in inflate for decoding, and a cap on decompressed size.
  - Example scenes: `pendulumWaveScene`, `newtonsCradleScene`, `dominoRunScene`, `terrainCarScene`, `ragdollScene`.
  - `capabilities().modules` lists `scene`. `test/v12-scene.test.mjs` covers it.
- **`box3d-webgpu-kit/coupling`:** `WaterCoupling` couples rigid bodies with one closed shallow-water basin, both ways.
  - Water to body: buoyancy from the exact volume of a box, sphere or capsule below the local water plane, applied at the centre of buoyancy (so it rights a heeled body), the pressure-gradient force of a sloping surface, and a drag model (linear plus quadratic in the velocity relative to the water, scaled by the submerged fraction).
  - Body to water: the displaced volume is a volume source for the free surface (water volume is conserved to float64 roundoff; the mean level rises by displaced volume / basin area), and the reaction of the horizontal force is a momentum source.
  - `attach(body, shape, options)`, `detach(body)`, `step()` (call it before `world.step()`), per-body reports, and diagnostics: `waterVolume`, `displacedVolume`, `surfaceVolume`, `meanElevation`, `elevationAt`, `floorLoad`, `buoyancyTotal`, `waterKineticEnergy`, `waterPotentialEnergy`, `copyTo`.
  - Float64 state, deterministic, no allocation of its own per step.
- **`box3d-webgpu-kit/structure`:** `StructureCoupling` couples rigid bodies with cables (`/cable`) and frames (`/frame`), both ways (backend id `rigid-structure-coupling-schur-proxy-js-f64-v1`).
  - `attachCableToBody` (a cable node follows a point on a body, the tension acts there and so also turns the body; both ends on bodies make a tether; static and kinematic bodies are moving anchors), `attachCableToFrame`, `attachFrameToBody` (`pinned`: forces; `clamped`: forces and moments; a kinematic body prescribes the node's motion), `detach`, `step()` (call it before `world.step()`), live per-attachment reports (`force`, `moment`, `tension`, `gap`, `effectiveMass`) and `diagnostics()` (energy, momentum, mass).
  - Every attachment is solved with the effective mass of both sides: a cable node becomes a proxy of the carrier point with mass `1 / (dᵀ G d)`, and frame ↔ body constraints are one dense interface solve with the frame's midpoint operator. A light body on a stiff structure is stable where naive staggering blows up (`scheme: 'naive-staggered'` is there to show it).
  - `prime(attachment, force, moment?)` tells the coupling what an attachment already carries when it is made on a structure set up in equilibrium (the pull of a stay, the force on a resting body), so that a stiff structure that starts loaded starts at rest instead of ringing. The SI bridge scene uses it.
  - Float64 state, deterministic, no allocation of its own per step.
  - `CompliantCableRuntime` gains `advance()`, `couplingViews()` and `driveNode()`; `FrameRuntime` gains `couplingViews()`, `solveCoupledOperator()`, `beginCoupledTick()` and `finishCoupledTick()`. These are additions for the coupling; `step()` and every existing result are unchanged bit for bit.
  - Not modelled: contact between bodies and cables or beams, cable bending, frame nonlinearity; an attached body's other contacts and joints are not in the interface solve (error bounded by `g dt²`).
- `test/v11-structure.test.mjs` checks the structure coupling against closed-form answers; see `docs/STRUCTURE_COUPLING.md` for the scheme, the stability analysis, the measured errors and the limits.
- `capabilities().modules` lists `coupling`, `heat`, `solid`, `structure`, `geometry` and `scene`.
- **`box3d-webgpu-kit/heat`:** `HeatSolver` solves heat conduction in solids, `rho c dT/dt = div(k grad T) + q`, in SI units and float64 (solver id `heat-fv-implicit-js-f64-v1`).
  - A structured 3-D grid of cells with per-cell materials, optional temperature-dependent conductivity from a table, and a solid mask for voxelised shapes; one cell on an axis gives 1-D and 2-D problems. Harmonic-mean face conductivity makes layered walls exact at steady state.
  - Boundary conditions per face region: fixed temperature, prescribed flux (insulated by default), convection `h_c (T_inf - T)`, and grey-body radiation linearised each step. Volumetric, region and point sources.
  - `step()` with backward Euler or Crank-Nicolson (matrix-free preconditioned conjugate gradients, no allocation in the step) or explicit Euler, which reports its stability limit (`h^2 / (6 alpha)` for an interior cell in 3-D) and refuses a larger step. `solveSteady()` solves the steady state directly.
  - Outputs: temperatures, face heat fluxes, face and surface temperatures, stored energy, heat rates per boundary condition, and energy ledgers that balance the stored-energy change to solver precision.
  - `thermalStrain`, `restrainedThermalStress` (bar, plate, volume) and `thermalShock` (which cells reach the tensile strength). These are a one-way thermal to stress estimate, not a coupled thermo-mechanical solver.
  - Deterministic. Not modelled: phase change, fluid flow, radiation between surfaces, unstructured meshes.
- **`box3d-webgpu-kit/solid`:** `SolidBody`, a tetrahedral finite-element solver for deformable solids with real material parameters (Young's modulus, Poisson's ratio, density, optional thermal expansion). Solver id `solid-tet-corot-js-f64-v1`.
  - Three material models: `linear`, `corotational` (the default; large rotations without false stress) and compressible `neo-hookean`.
  - Statics by Newton's method with a preconditioned conjugate-gradient solve; dynamics by backward Euler, the implicit midpoint rule or an explicit integrator that reports and enforces its stability limit; Rayleigh damping.
  - Fixed and prescribed nodes, point forces, tractions and pressure on boundary faces, gravity, temperature change.
  - Outputs: displacements, strain and Cauchy stress per element, von Mises and principal stresses, energies, reactions, volume, lowest natural frequency. `failedElements` flags elements above a strength; it does not crack or yield them.
  - `boxMesh` builds a box of tetrahedra; caller meshes are accepted.
  - No contact, plasticity or crack growth, and no coupling to the rigid-body world yet. Linear tetrahedra are stiff in bending and lock near `nu = 0.5`; `docs/SOLID_MECHANICS.md` gives the measured errors.
  - `capabilities().modules` lists `solid`. `EngineErrorCode` gains `NUMERICAL_FAILURE`, `WORK_LIMIT` and `UNSTABLE_TIME_STEP`, which the optional modules raise.
  - `test/v10-solid.test.mjs` checks the packaged module; the full closed-form suite is `tests/engine/solid.test.mjs` in the repository.
- `test/v09-coupling.test.mjs` checks the coupling against closed-form answers; see `docs/WATER_COUPLING.md` for the model, the measured errors and the limits.
- `test/v09-heat.test.mjs` checks the packaged heat module; the full closed-form suite is `tests/engine/heat.test.mjs` in the repository, and `docs/HEAT_TRANSFER.md` has the equations, the validation table with measured errors and convergence orders, and the limits.
- **`box3d-webgpu-kit/geometry`:** geometry import and preparation, with no dependencies and no fetching.
  - Parsers that return `{vertices: Float32Array, indices: Uint32Array, name?}`: `parseOBJ` (v/f, negative indices, `v/vt/vn` forms, polygons as fans, `o`/`g` meshes), `parseSTL` (binary by the 84 + 50 n length rule and ASCII, corners welded), `parseGLB` and `parseGLTF` (glTF 2.0 triangles, strips and fans; float positions; 8-, 16-, 32-bit or no indices; `byteStride`; node matrix or TRS transforms baked in; GLB BIN chunk, `data:` URIs and caller-supplied buffers). Sparse accessors, quantised or compressed geometry and anything that reads outside its buffer are rejected with `INVALID_PAYLOAD` and the reason. `GEOMETRY_LIMITS` caps sizes.
  - Measures and tools: `meshVolume`, `meshCenterOfMass`, `meshBounds`, `isClosed`, `isConvex`, `weldVertices`, `transformMesh`, `flipWinding`, `convexHull`.
  - Shapes: `toHullShape` (farthest-first decimation to 32 points by default, and never more than Box3D's 64 vertices or 255 half-edges), `toMeshShape`, `toHeightfieldShape` (from a function or a mesh).
  - `convexDecompose`: approximate convex decomposition by greedy plane splitting. Exact for solids with flat inner faces; a 576-triangle torus is within 9% with 16 hulls and 3% with 32.
  - `createBodiesFromMesh(world, mesh, {as: 'mesh' | 'hull' | 'decomposed'})`: a static mesh body, a hull body, or hull bodies held by weld joints, with mass = density x mesh volume for closed meshes. Decomposed pieces are welded each to its nearest earlier piece; welding all of them to the first let a 16-piece ring fly apart.
  - `capabilities().modules` lists `geometry`. `test/v10-geometry.test.mjs` checks the module against closed-form answers.

- **Shared with the Physics Lab:** the code of `/scene` and `/geometry` now lives in the repository's `src/engine` (`scene-format.ts`, `scene-examples.ts`, `geometry.ts`) and is copied into the package like the other core files, because the Lab loads scenes with it. Every export of both modules keeps its name and signature. New: `SceneHost`, the contract `SceneBuilder` needs from a world (a `PhysicsWorld` meets it), and on the native world `retainBodyShapes()` and `bodyShape(row)`, which a renderer uses to draw hulls, meshes and height fields; they are off by default and change nothing for a world that does not call them.

## 0.8.0

The WASM changed (new bridge exports), so replay logs and `exactHash()` values from 0.7.0 builds are not comparable with this one. The classic arena, presets and their behaviour are unchanged.

- **General rigid bodies:** `world.createBody({shape, type, position, …})` with box, sphere, capsule and convex-hull shapes, plus static triangle meshes and height-field terrain; static, kinematic and dynamic types; density, friction, restitution, damping, gravity scale, bullet, sensor, rotation lock and collision filters.
- **SI worlds:** `world.reset({ground, gravity, seed})` and `createWorld({gravity, ground})` start an empty world with gravity 9.81 m/s²; `setGravity` / `gravity`.
- **State access:** `getState`, `setTransform`, `setVelocity`, `moveKinematic`, `setBodyType`, `setAwake`, `setGravityScale`, `setDamping`, `setCollisionFilter`.
- **Forces:** `applyForce` (optionally at a point), `applyTorque`, `applyImpulseAt`, `applyAngularImpulse`.
- **Joints:** `createJoint` for weld, revolute, spherical, prismatic, distance and wheel joints, with limits, motors and springs; `setJointMotor`, `setJointLimits`, `setJointSpring`, `setJointSteering`, `getJointState`, `isJointAlive`, `destroyJoint`; `axisRotation()` to aim joint frames.
- **Events:** `world.onEvent(listener)` delivers `contact-begin`, `contact-end`, `hit`, `sensor-begin` and `sensor-end` after each step.
- **Rendering:** `world.bodyKinds()`; `createShapeMeshes` / `syncShapeMeshes` in `box3d-webgpu-kit/three` draw boxes, spheres and exact capsules.
- **`toQuat`**, and the types `BodyOptions`, `ShapeOptions`, `BodyState`, `JointOptions`, `JointState`, `WorldEvent`, `ResetOptions`, `QuatLike`.
- New error codes: `STALE_JOINT`, `UNSUPPORTED_JOINT`.
- `NativeWorldBackend` gains the matching low-level calls (`createBody`, `createJoint`, `collectEvents`, …) and `supportsGeneralBodies`.
- **Recording and replay** cover every new call. `startRecording({world})` begins from an SI world; such logs are `version: 2` with `'call'` commands, stay plain JSON, and replay bit for bit. Classic recordings are unchanged (`version: 1`).
- **Worker:** `RemoteWorld` gains `reset`, `createBody`, `createJoint`, the setters, force calls, joint calls, `getState`, `getJointState`, `bodyKinds()` and `takeEvents()`. `connectWorld(worker, {gravity})` starts an SI world. A mechanism run in a worker matches the main thread bit for bit.
- `NativeWorldBackend.shapeVersion()` and `shapeKinds()` give renderers the shape of each row as bytes (0 box, 1 sphere, 2 capsule, 3 hull, 4 mesh, 5 height field), read from the bridge once per change; `shapeKinds()` is null when every row is a box.
- `test/v08.test.mjs` checks the solver against closed-form physics.

## 0.7.0

- **`box3d-webgpu-kit/gameplay`:**
  - `TriggerSet`: enter/exit events from batched overlap queries, with overflow handling;
  - `CharacterController`: a swept-box kinematic character with step-up, slope limit, ground snapping, jumping and optional pushing;
  - `NATIVE_GRAVITY` (−10 m/s²) and `MAX_QUERY_HITS` (256).
- **`world.onStep(listener)`:** runs after every fixed step. Listeners are not called during `replay`/`replayDetailed`, whose logs already hold their commands.
- **`capabilities()`:** `modules` now lists `'gameplay'`, and `limits.queryHitsMax` is new.
- **Packaging:**
  - source maps are no longer shipped: they pointed at `src/`, which is not in the tarball (the packed size fell from 599 to 564 KiB);
  - the smoke test rejects `.map` files;
  - the optional-modules gzip budget rose from 20 to 24 KiB.

## 0.6.0

- **Optional modules:** `./cable`, `./water` (CPU) and `./frame`, copied from the app's engine and checked by running the app's own 46 tests against the packaged copies.
- **`./single`:** one self-contained ES module with the WASM embedded, for CDNs and no-build pages.
- **`box3d-kit` CLI:** `init` with `node`, `three` and `single` templates, and `info`.
- **Capabilities report:** `capabilities()`.
- **Pose arrays:** `readPoses`, `packPoses` (28 B per body) and `readBodyPoses` for ECS engines.
- **Handle cost measured:** `npm run bench:handles`. Number-typed handles were not warranted.
- **Size budgets:**
  - brotli is now tracked;
  - the core and the optional modules have separate budgets;
  - the packed budget rose to 600 KiB because `single.js` ships in the tarball.

## 0.5.0

- **Shared-memory worker frames:** a lock-free seqlock over a `SharedArrayBuffer` (`sharedMemory: 'auto' | true | false`), plus `RemoteWorld.start(hz)` / `stop()` so the worker steps on its own clock.
- **Save files:** `saveSession` / `loadSession`, with build-identity checks (`INCOMPATIBLE_SAVE`).
- **Debug overlay:** `mountInspector` and `formatStats`.
- **Leak recovery:** a FinalizationRegistry releases the native slot of a garbage-collected world and warns (`leakReporting`).
- **Generated API reference:** `api/API.md`, checked in tests and shipped in the package.
- **Runtime matrix:** `npm run matrix` runs Node 26, Node 22 and Bun, and they agree bit for bit.
- **Room server example:** Node over HTTP with server-sent events, plus a browser thin client.

## 0.4.0

- **Integrity and provenance:** `BUILD_INFO` exports the shipped WASM's identity. `loadBox3D({integrity: true})` verifies the SHA-256 before instantiating. The build refuses artifacts whose bytes differ from `BUILD_PROVENANCE.json`.
- **Explicit failure policy:** load failures throw `EngineError('WASM_UNAVAILABLE')` with the original error as `cause`, and never fall back silently.
- **Babylon.js adapter** (`box3d-webgpu-kit/babylon`): thin instances, left/right-handed conversion.
- **Uploads:** `writeInstances(..., {changedRowsOnly: true})` uploads only the rows that changed, and `lastUploadRange()` reports them.
- **Helpers:**
  - `spawnBoxes` and `applyImpulses` for batches;
  - `BodyRing` for recycling projectiles and debris;
  - `detectEnvironment()`;
  - `LICENSE_NOTICE`.
- **Testing:**
  - the public API report (`npm run api`);
  - a drift check against the app sources;
  - a 3,000-call hostile-input fuzz test;
  - a CSP check.
- **Examples:** raycast picking and projectile recycling in the three.js example, and a strict-CSP page.

## 0.3.0

- **Rendering and debugging:**
  - `writeInstances` for raw WebGPU, with `INSTANCE_WGSL`;
  - `boxOutlines` and `rayLine` for debug draw;
  - Z-up conversion.
- **Multiplayer:** `SnapshotEncoder` / `SnapshotDecoder` network snapshots.
- **Many worlds:** `WorldScheduler`.
- **Replay:** checkpoints and `replayDetailed()`.
- **Ergonomics:**
  - `Vec3Like` inputs;
  - `Symbol.dispose` / `Symbol.asyncDispose`;
  - SSR-safe imports.
- **Release gate:** size budgets in `test:pack`.

## 0.2.0

- Render interpolation.
- Worker hosting (`box3d-webgpu-kit/worker`).
- Record/replay.
- `exactHash()`.
- User data on bodies.
- Sphere/box casts and box overlap.
- `stats()`, capacity reservation, `pauseOnHidden`, `EngineErrorCode`.

## 0.1.0

- The first package:
  - a loader decoupled from Vite;
  - `createWorld` / `PhysicsWorld` with a fixed-step loop, pose readback and ray/overlap queries;
  - the three.js instancing adapter;
  - the tarball smoke test.
