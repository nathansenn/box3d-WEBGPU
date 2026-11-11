# Changelog

## Versioning policy

- The kit follows semver for its **JavaScript API**. `api/public-api.txt` is the reviewed surface; `npm test` fails when it changes without being regenerated.
- The **WASM** is identified by `BUILD_INFO`: the upstream Box3D ref and commit, the Emscripten version, the bridge source SHA-256 and the `box3d.wasm` SHA-256. Any change to the WASM is at least a minor release, because replay logs and `exactHash()` values are only comparable on the same WASM.
- The native world ABI version (`NATIVE_WORLD_API_VERSION`, currently 1) must match the loaded module; a mismatch fails loudly with `UNSUPPORTED_BACKEND`.
- Before 1.0, minor versions may change the API; the changes are listed below.

## 0.9.0

The WASM is unchanged from 0.8.0.

- **`box3d-webgpu-kit/coupling`:** `WaterCoupling` couples rigid bodies with one closed shallow-water basin, both ways.
  - Water to body: buoyancy from the exact volume of a box, sphere or capsule below the local water plane, applied at the centre of buoyancy (so it rights a heeled body), the pressure-gradient force of a sloping surface, and a drag model (linear plus quadratic in the velocity relative to the water, scaled by the submerged fraction).
  - Body to water: the displaced volume is a volume source for the free surface (water volume is conserved to float64 roundoff; the mean level rises by displaced volume / basin area), and the reaction of the horizontal force is a momentum source.
  - `attach(body, shape, options)`, `detach(body)`, `step()` (call it before `world.step()`), per-body reports, and diagnostics: `waterVolume`, `displacedVolume`, `surfaceVolume`, `meanElevation`, `elevationAt`, `floorLoad`, `buoyancyTotal`, `waterKineticEnergy`, `waterPotentialEnergy`, `copyTo`.
  - Float64 state, deterministic, no allocation of its own per step.
- `capabilities().modules` lists `coupling`, `heat` and `solid`.
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
  - `createBodiesFromMesh(world, mesh, {as: 'mesh' | 'hull' | 'decomposed'})`: a static mesh body, a hull body, or hull bodies held by weld joints, with mass = density x mesh volume for closed meshes.
  - `capabilities().modules` lists `geometry`. `test/v10-geometry.test.mjs` checks the module against closed-form answers.

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
