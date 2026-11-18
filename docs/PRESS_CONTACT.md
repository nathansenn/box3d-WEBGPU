# Analytical press contact queries

`PressToolCollider` provides closed working-tool distance, outward normal and continuous sphere queries for twelve press working shapes. The engine exports the API through `src/engine/index.ts`. The existing Studio simulation still uses its versioned height-based contact rule; these queries are a qualified building block for its replacement.

The geometry includes working faces, sides, top caps, the ring bore and all four tips. The cross uses the boundary of the union of its two bars, so the internal overlapping box faces do not become penetration surfaces. Coupling, shank, collar, machine frame and sheet self-contact are outside this module's scope.

## Units and use

Queries use metres. One authored Studio scene unit is 0.1 metre. Tool scale is 0.65–1.3; angle is a rotation about Y from 0–90 degrees. The ram translates along Y. Settings are immutable for the lifetime of a collider; create a new instance when geometry settings change.

```ts
import {
  PressToolCollider, createPressToolQuery, pressNormalCorrection,
} from './engine/index.ts';

const tool = new PressToolCollider({tool: 'ball', toolScale: 1, angle: 0});
const target = createPressToolQuery();
const radius = 0.001; // half the thickness of a 2 mm sheet particle
const query = tool.sample([0.0528, 0.01, 0], 0, target);
const correction = pressNormalCorrection(query, radius, 1, 0.01);

const sweep = tool.sweep(
  [0, -0.12, 0], [0, 0.1, 0], // particle start/end in metres
  0, 0,                       // ram start/end in metres
  radius,
);
```

The signed distance is negative inside the tool; the normal points outward. `sample` can fill a caller-owned target. `pressNormalCorrection` returns a linearized particle displacement along the surface normal and the reaction displacement of the ram along its Y guide. Its denominator is `particleInverseWeight + ramInverseWeight * normalY²`. Weights must share a mass unit; the guide absorbs lateral tool reaction. An unresolvable constraint returns `resolvable: false` and zero corrections. Callers must resample after applying corrections because normals and contact features may change.

This geometric API does not calibrate the Studio material model, convert its authored inverse weights to physical masses, provide tangential friction, or account for actuator/contact work.

## Continuous queries

`sweep` advances a sphere along linear particle motion relative to linear ram motion. Orientation and scale stay fixed during a query. Convex tools use a supporting plane to bound the earliest possible collision. The cross and four tips take the earliest safe time across their convex components; their penetration normals still come from the closed union. The ring uses its exact circular support where valid and a distance-based bound near the bore.

The default contact tolerance is **1 nanometre**, with a **128-iteration cap**. `queries` counts complete tool samples/advancement iterations; compound iterations additionally evaluate component bounds. It is not a count of internal square roots or component evaluations. Supported options are a tolerance of `1e-10`–`1e-4` metres and 1–4096 iterations. Positions and ram coordinates must be finite and within ±10 km; sphere radius must be 0–1 metre.

The result distinguishes `hit`, `miss` and `unresolved`. A hit can lie within the declared tolerance just before exact touching. `initialOverlap` identifies penetration at the start. Exhaustion or failure to advance returns `unresolved`, with a known safe lower time; it never becomes a miss. A consuming solver must keep the motion within a safe bound, refine the query or report the unresolved state. Rotating tools, deforming triangles, edge crossings and contacts between sheet faces need additional algorithms.

## Retained qualification

The current candidate is frozen in `benchmarks/experiments/press-contact-20260911-07/candidate/`. Its manifest identifies the exact source and tests. Phases 01–06 retain earlier candidates, failures, witnesses and the corrected independent reference protocol.

- **4,800** point queries reproduce the previous candidate exactly. Independent triangle-mesh distances differ by at most **0.0907 mm**, within the predeclared **0.1 mm** tessellation envelope. Analytical curved surfaces remain exact; this envelope is not solver penetration tolerance.
- **1,280** vertical casts and **2,400** oblique point/sphere casts resolve with **zero unresolved results and zero failed contact checks**. The oblique set uses five radii, four poses and moving-ram cases. Its largest iteration count is **58**.
- The oblique oracle intersects the sphere with triangle faces, finite edge cylinders and vertex spheres. It does not use the candidate's advancement algorithm. Cross geometry is independently extracted from the rendered union boundary.
- Polygonal ring bores are smaller than a perfect circular bore. Ring point casts therefore use independent exact cylinder/plane roots, and finite-radius ring casts use mesh-radius brackets with the unchanged tessellation envelope. The erroneous one-sided comparison and its 16 failures are retained in phase 04; the corrected reference was checked against the unchanged candidate in phase 05 before changing the solver.
- Nine targeted tests cover analytical surfaces/normals, finite caps, holes, concave features, coordinate transformations, normal reactions, extreme inverse weights, invalid input, grazing motion and the five retained oblique exhaustion witnesses.

## Query performance

Six separate processes compare the current kernel with phase 02's analytical collider. The timed set contains **2,395** oblique cases that both versions resolve to the same status. Five previously exhausted cases are excluded from timing and remain in the complete 2,400-case correctness set. Full results for all 2,400 cases match the accurate phase 06 candidate exactly after removing transient offset arrays and per-iteration closures.

| Sweep workload | Throughput ratio | 95% process-bootstrap interval |
| --- | ---: | ---: |
| All ten tools | 1.363× | 1.348–1.378× |
| Ring | 1.860× | 1.844–1.877× |
| Cross | 1.278× | 1.243–1.308× |
| Four-point | 1.746× | 1.740–1.751× |

Every workload passes the predeclared throughput, p95 and unchanged-control gates. Each process records and verifies balanced role positions. The p95 values describe block means, not individual cast latency. The measured function includes public input validation and returned allocations. These CPU query ratios do not establish a full Studio/FPS gain and must not be multiplied by the separate norm optimization.

The accepted raw samples, protocol, calculation and decision are in `benchmarks/experiments/press-contact-20260911-07/timing/`. Both earlier phase 06 timing attempts remain unaccepted: the first had a run-order error; the second passed median/control checks but failed two tail-latency gates. No earlier result was overwritten.

These are bounded geometry and primitive-query checks. Full press integration still requires a new backend identity, checkpoint/worker compatibility, continuous checks through constraint projection, pinned-node handling, penetration audits across supported experiments, physical constitutive validation and live runtime review. The month-long engine goal and the corresponding roadmap items remain open.

## Catalogue extension, 2026-09-11

The press catalogue now also includes a convex hexagonal flat punch and a convex capsule flat former. Both have a 0.32 scene-unit working-solid height and use the existing extrusion query and continuous-cast algorithms. Their lower faces match the Studio height projection and visible tooling. The original ten working geometries and the material solver equations are unchanged.

The expanded twelve-shape transform, distance, gradient and Lipschitz tests, explicit new-tool boundary/cast witnesses, and all 36 visible attachment configurations are covered by `tests/engine/press-contact.test.mjs`, `tests/studio/press-v3.test.mjs` and `tests/studio/press-inspection.test.mjs`. Historical qualification counts above describe the original ten shapes only; this extension does not inherit those wider qualification counts. The closed-solid query kernel remains separate from the Studio height-projection solver.
