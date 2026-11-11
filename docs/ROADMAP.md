# Roadmap

This is the one roadmap for the project. It replaces the four earlier 100-item lists as the plan of record; those lists stay in `docs/` as an idea backlog and are linked at the end.

**Goal:** the most comprehensive validated physics simulator that runs in a browser tab. Zero install, shareable by link, embeddable, with every solver checked against known answers.

**First audiences:** engineering education and web developers.

**Scope:** mechanics first (rigid, deformable, fluid, granular, structural), then heat. Electromagnetics is out of scope for now.

## Rules

1. A solver ships with its validation case: a test that compares it with a closed-form answer or reference data and states the error.
2. One unit system: SI. Metres, kilograms, seconds, radians.
3. Solvers plug into one world and exchange forces both ways. A solver that cannot couple is a demo, and is labelled as one.
4. Optimisations are kept only when measured, with the numbers recorded. Rejected ideas are recorded too.
5. New showcase scenes, CPU micro-optimisation rounds and catalogue sweeps are paused until Phases 1 and 2 are done.

## Status

Updated 2026-11-11.

| Phase | Item | Status |
|---|---|---|
| 0 | Studio keeps working when its WebGPU device is lost (the cause of the acceptance errors) | done for 7 of 8 routes in software rendering; bridge still times out there; unverified in CI and on a real GPU |
| 0 | Restore the engine evidence so the 11 failing engine tests pass | open (needs the 2 GB evidence archive; owner) |
| 0 | Run every test file in a gate, or list it with a reason | done (20 wired, 8 listed) |
| 0 | Glass study: a step takes 0.2–8 s after fracture, so `tests/studio/material-labs.test.mjs` cannot finish | partly done: steps are 1.5–1.8× faster with bit-identical results (mean 90–820 ms, real-time factor 0.01–0.09); the file now finishes in 36 min but stays unwired because its laminated-retention assertion fails on unchanged physics (645 mm against a 227 mm limit). Real time needs a different solver; see `docs/GLASS_CONTACT.md` |
| 0 | One roadmap and status ledger | done (this file) |
| 0 | Enable GitHub Pages | open (owner setting) |
| 1 | Boxes, spheres, capsules, convex hulls; static meshes and height fields; static, kinematic, dynamic bodies | done |
| 1 | Pose, velocity and gravity access; forces and torques; collision filters | done |
| 1 | Joints: weld, revolute, spherical, prismatic, distance, wheel; limits, motors, springs | done |
| 1 | Contact, hit and sensor events | done |
| 1 | SI worlds (`reset`, gravity 9.81) beside the classic arena | done |
| 1 | Closed-form validation of the rigid solver (`packages/box3d-kit/test/v08.test.mjs`) | done |
| 1 | Compound shapes (several shapes on one body) | open |
| 1 | Record and replay of the new calls; worker transport for them | done |
| 1 | Solver state save and load | open |
| 1 | Lab renderer draws spheres and capsules | done for direct draws in the shadow, opaque and transparent passes; the opt-in partition and visibility lists fall back to direct draws; seen in software rendering only, not on a real GPU |
| 1 | Lab renderer draws convex hulls, static meshes and height fields from each body's own geometry | done for direct draws in the same three passes (lit, shadowed, casting shadows); the partition and visibility lists fall back; very large meshes are drawn reduced; seen in software rendering only, not on a real GPU |
| 1 | A Lab scene built with the general API ("Mechanisms" SI demo, `lab.html?si=mechanisms`) | done as a separate entry, not one of the 800 recipes |
| 1 | Publish `box3d-webgpu-kit` 1.0 to npm | open (owner decision) |
| 2 | Rigid ↔ water, both ways: buoyancy, drag, volume and momentum sources (`box3d-webgpu-kit/coupling`, [`WATER_COUPLING.md`](WATER_COUPLING.md)) | done in the kit with closed-form validation (`packages/box3d-kit/test/v09-coupling.test.mjs`); not yet used by a scene or the Studio |
| 2 | One scene description for rigid bodies and joints: a versioned JSON format with validation, load and save (`box3d-webgpu-kit/scene`, [`SCENE_FORMAT.md`](SCENE_FORMAT.md)) | done (`src/engine/scene-format.ts`, published by the kit; `packages/box3d-kit/test/v12-scene.test.mjs`); rigid bodies and joints only, so cables, water, frames and heat are not in the format yet; a save restores poses and velocities, not solver state; the Lab loads scenes with it, the Studio does not |
| 2 | Cable and frame ↔ rigid, both ways: cable ends and frame nodes attached to bodies (pinned or clamped), tethers, cables holding frames (`box3d-webgpu-kit/structure`, [`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md)) | done in the kit with closed-form validation (`packages/box3d-kit/test/v11-structure.test.mjs`), including a small cable-stayed span carrying a body; no contact between bodies and members; not yet used by a scene or the Studio |
| 2 | One stepping loop for every solver; rigid ↔ cloth and rope; bridge rebuild | open |
| 3 | Heat conduction in solids: transient and steady, four boundary types, implicit and explicit stepping, energy ledger (`box3d-webgpu-kit/heat`, [`HEAT_TRANSFER.md`](HEAT_TRANSFER.md)) | done as a standalone solver with closed-form validation (`tests/engine/heat.test.mjs`, in the pull-request gate); thermal stress and thermal shock are one-way estimates; not yet coupled to a fracture solver or used by a scene |
| 5 | Import glTF, OBJ and STL: parsers, mesh measures, convex hulls and decomposition, bodies from meshes (`box3d-webgpu-kit/geometry`) | done (`src/engine/geometry.ts`, published by the kit) with closed-form validation (`packages/box3d-kit/test/v10-geometry.test.mjs`); the Lab imports a dropped or opened file as one body; no editor, and the Studio does not use it. |
| 3 | Deformable solids with real material parameters: tetrahedral FEM, linear, corotational and Neo-Hookean, statics and dynamics (`box3d-webgpu-kit/solid`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)) | done as a stand-alone solver with closed-form validation (`tests/engine/solid.test.mjs`, in the pull-request gate); not coupled to the rigid world; no contact, plasticity or fracture; not yet used by a scene or the Studio |
| 3 | Fracture on the solid solver; replace the rubber, concrete and lattice one-offs; the other Phase 3 domains | open |
| 4 | A public validation page: every solver against textbook cases, with error numbers ([`VALIDATION.md`](VALIDATION.md), served at `<site>/validation/`) | done for the ten solver domains with closed-form tests: 211 cases measured by `node scripts/validation-report.mjs` from the registry in `validation/`, all inside their tolerances; `npm run validation:check` in the pull-request gate fails when a case misses or the published numbers go stale. Open: the Studio's authored models, cloth, rope, granular and the GPU water path have no cases; cross-machine agreement of the published digits is unverified |
| 4 | A calibrated material library with sources; a cross-device determinism matrix; removing the "not engineering predictions" disclaimer study by study | open |
| 5 | Share links that carry the whole scene (`encodeSceneLink`, `decodeSceneLink` in `box3d-webgpu-kit/scene`) | done: compressed, checksummed, URL-safe, with a size cap; the Lab opens `lab.html?scene=<link>` and copies a link of the scene on screen; the Studio does not |
| 5 | Open a scene in the Lab without installing anything: example links, share links, scene files and OBJ, STL and glTF geometry by file dialog or drag and drop, with download and reset ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#in-the-physics-lab)) | done; one body per geometry file; no editing; checked in headless Chromium with software WebGPU only |
| 4–6 | Everything else below | not started |

## Phase 0: clean base

- Browser acceptance passes for all eight Studio routes and becomes a blocking check.
- The engine suite passes and becomes blocking. It fails today only because `benchmarks/results/engine-100x` and the baseline archives were never committed.
- Every test file runs in a gate. A contract test fails when a new test file is not wired in.
- GitHub Pages is enabled so there is a public link.

## Phase 1: open the engine

Box3D already has the features; the C bridge (`wasm/box3d_web.c`) exposes them and the kit (`packages/box3d-kit`) wraps them.

Done in kit 0.8.0: general bodies, six shape types, three body types, setters, forces, six joint types, events, SI worlds, and a closed-form validation suite (pendulum period within 0.1%, friction stopping distance within 1%, rebound height within 2%, momentum and energy conserved in an elastic collision, sliding and rolling down inclines within 1%).

Done after 0.8.0: the Lab renderer draws spheres and capsules, and convex hulls, static meshes and height fields from each body's own geometry ([`RENDERING_PIPELINE.md`](RENDERING_PIPELINE.md)), and the Mechanisms SI demo shows pendulums on revolute joints, capsule chains on spherical joints with cone limits, a motor-driven hinge and a car on wheel joints.

Remaining: compound shapes, state save/load, and the npm release.

## Phase 2: one world, coupled

- One scene description and one stepping loop that every solver plugs into, in SI units. The scene description exists for rigid bodies and joints ([`SCENE_FORMAT.md`](SCENE_FORMAT.md)) and the Lab loads it; the other solvers and the shared loop are still to come.
- Two-way coupling, in order of payoff:
  1. rigid ↔ water: buoyancy and drag that push back on the water (done in kit 0.9.0 for one flat-bottom basin; see [`WATER_COUPLING.md`](WATER_COUPLING.md));
  2. rigid ↔ cloth and rope;
  3. cable and frame ↔ rigid (done in the kit as attachments; see [`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md)). Contact between bodies and members is not modelled.
- Rebuild the bridge study on the validated frame and cable solvers, carrying real bodies in real units. It becomes the flagship.

## Phase 3: missing domains

One at a time, each with its validation case.

- Deformable solids (tetrahedral FEM or XPBD with material parameters), then fracture on top. Replaces the rubber, concrete and lattice one-offs. The tetrahedral solver is done and validated ([`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)); contact, coupling to the rigid world, fracture and the replacement of the one-offs remain.
- Volumetric fluid on GPU compute; sloped beds and wetting/drying for the shallow-water solver.
- Granular on GPU (today: about 1,344 grains in JS).
- Cloth self-collision and calibrated stiffness.
- Articulated bodies with URDF and MJCF import.
- Heat transfer, coupled to fracture. Conduction in solids is done ([`HEAT_TRANSFER.md`](HEAT_TRANSFER.md)), with a one-way thermal stress and thermal-shock estimate. Remaining: the coupling to a fracture solver, phase change, and convection in fluids.
- Later: frame buckling and plasticity.

## Phase 4: trust

Runs alongside Phases 1–3.

- A public validation page: every solver against textbook cases, with error numbers. Done for the solvers that have closed-form tests: [`VALIDATION.md`](VALIDATION.md) and the page at `<site>/validation/` are generated from the registry in `validation/` by `node scripts/validation-report.mjs`, which runs each case and prints the reference, the measured value, the error and the tolerance, with a "what is not validated" list per domain. `npm run validation:check` keeps the published numbers from going stale. A new solver adds its cases to the registry with its test (rule 1). Still without cases: the Studio's authored models, cloth, rope, granular and GPU water.
- A calibrated material library with sources.
- A cross-device determinism matrix.
- Remove the "not engineering predictions" disclaimer one study at a time, as each earns it.

## Phase 5: usable by anyone

Starts after Phase 1.

- Scene editor: bodies, joints, materials, loads.
- Import glTF, OBJ, STL (done: `box3d-webgpu-kit/geometry` parses the files and makes static mesh bodies, hull bodies, or welded hull sets from an approximate convex decomposition, and the Lab opens such a file as one body; an editor and URDF/MJCF are still to come). Export CSV, glTF, video.
- Scripting API and console; share links that carry the whole scene (done for the Lab: it opens example links, share links and scene files, and copies a link of the scene on screen; the Studio does not read links yet).
- Docs site with runnable examples and a teaching track.
- WebGL2 fallback for the Lab; a tested support statement for Safari, Firefox and mobile.

## Phase 6: scale

- Cloth, rope, granular and fluid on GPU compute. GPU water measured 41× at 512² and 217× at 1024² on an NVIDIA L4.
- A GPU rigid solver for restricted shapes, as an experiment: spheres measured about 75× against threaded Box3D, and cubes failed the pile check.

## Earlier lists

Idea backlogs, no longer the plan of record:

- [`ENGINE_100X_ROADMAP.md`](ENGINE_100X_ROADMAP.md) with [`ENGINE_100X_STATUS.json`](ENGINE_100X_STATUS.json): 6 verified, 11 implemented, 32 partial, 51 not started.
- [`MATH_SPEED_100.md`](MATH_SPEED_100.md): 1 implemented, 3 partial, 2 trials rejected, 92 proposed.
- [`INTEGRATION_100.md`](INTEGRATION_100.md): 38 delivered, 26 partly, 36 proposed. Its P0 bridge gaps (#1–#4, #6, #7) are closed by kit 0.8.0.
- [`ENHANCEMENTS_100_20261002.md`](ENHANCEMENTS_100_20261002.md) and [`ENHANCEMENTS_SPEED_VISUAL_ACCURACY_20261002.md`](ENHANCEMENTS_SPEED_VISUAL_ACCURACY_20261002.md): proposals, mostly unmeasured.
