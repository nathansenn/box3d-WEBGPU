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
| 0 | Glass study: a step takes 0.2–8 s after fracture, so `tests/studio/material-labs.test.mjs` cannot finish | open |
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
| 1 | A Lab scene built with the general API ("Mechanisms" SI demo, `lab.html?si=mechanisms`) | done as a separate entry, not one of the 800 recipes |
| 1 | Publish `box3d-webgpu-kit` 1.0 to npm | open (owner decision) |
| 2 | Rigid ↔ water, both ways: buoyancy, drag, volume and momentum sources (`box3d-webgpu-kit/coupling`, [`WATER_COUPLING.md`](WATER_COUPLING.md)) | done in the kit with closed-form validation (`packages/box3d-kit/test/v09-coupling.test.mjs`); not yet used by a scene or the Studio |
| 2 | One scene description and stepping loop; rigid ↔ cloth and rope; cable and frame ↔ rigid; bridge rebuild | open |
| 3 | Heat conduction in solids: transient and steady, four boundary types, implicit and explicit stepping, energy ledger (`box3d-webgpu-kit/heat`, [`HEAT_TRANSFER.md`](HEAT_TRANSFER.md)) | done as a standalone solver with closed-form validation (`tests/engine/heat.test.mjs`, in the pull-request gate); thermal stress and thermal shock are one-way estimates; not yet coupled to a fracture solver or used by a scene |
| 5 | Import glTF, OBJ and STL: parsers, mesh measures, convex hulls and decomposition, bodies from meshes (`box3d-webgpu-kit/geometry`) | done in the kit with closed-form validation (`packages/box3d-kit/test/v10-geometry.test.mjs`); not yet used by a scene, the Studio or an editor |
| 3 | Deformable solids with real material parameters: tetrahedral FEM, linear, corotational and Neo-Hookean, statics and dynamics (`box3d-webgpu-kit/solid`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)) | done as a stand-alone solver with closed-form validation (`tests/engine/solid.test.mjs`, in the pull-request gate); not coupled to the rigid world; no contact, plasticity or fracture; not yet used by a scene or the Studio |
| 3 | Fracture on the solid solver; replace the rubber, concrete and lattice one-offs; the other Phase 3 domains | open |
| 4–6 | Everything else below | not started |

## Phase 0: clean base

- Browser acceptance passes for all eight Studio routes and becomes a blocking check.
- The engine suite passes and becomes blocking. It fails today only because `benchmarks/results/engine-100x` and the baseline archives were never committed.
- Every test file runs in a gate. A contract test fails when a new test file is not wired in.
- GitHub Pages is enabled so there is a public link.

## Phase 1: open the engine

Box3D already has the features; the C bridge (`wasm/box3d_web.c`) exposes them and the kit (`packages/box3d-kit`) wraps them.

Done in kit 0.8.0: general bodies, six shape types, three body types, setters, forces, six joint types, events, SI worlds, and a closed-form validation suite (pendulum period within 0.1%, friction stopping distance within 1%, rebound height within 2%, momentum and energy conserved in an elastic collision, sliding and rolling down inclines within 1%).

Done after 0.8.0: the Lab renderer draws spheres and capsules ([`RENDERING_PIPELINE.md`](RENDERING_PIPELINE.md)), and the Mechanisms SI demo shows pendulums on revolute joints, capsule chains on spherical joints with cone limits, a motor-driven hinge and a car on wheel joints.

Remaining: compound shapes, state save/load, and the npm release.

## Phase 2: one world, coupled

- One scene description and one stepping loop that every solver plugs into, in SI units.
- Two-way coupling, in order of payoff:
  1. rigid ↔ water: buoyancy and drag that push back on the water (done in kit 0.9.0 for one flat-bottom basin; see [`WATER_COUPLING.md`](WATER_COUPLING.md));
  2. rigid ↔ cloth and rope;
  3. cable and frame ↔ rigid.
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

- A public validation page: every solver against textbook cases, with error numbers.
- A calibrated material library with sources.
- A cross-device determinism matrix.
- Remove the "not engineering predictions" disclaimer one study at a time, as each earns it.

## Phase 5: usable by anyone

Starts after Phase 1.

- Scene editor: bodies, joints, materials, loads.
- Import glTF, OBJ, STL (done in the kit: `box3d-webgpu-kit/geometry` parses the files and makes static mesh bodies, hull bodies, or welded hull sets from an approximate convex decomposition; an editor and URDF/MJCF are still to come). Export CSV, glTF, video.
- Scripting API and console; share links that carry the whole scene.
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
