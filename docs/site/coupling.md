# Coupling

The rigid world is Box3D compiled to WebAssembly. Around it are solvers written in TypeScript, each validated against
closed forms ([validation](../../../validation/index.html)), each coupled to rigid bodies in a stated way.

| Solver | Module | Coupled to rigid bodies by |
| --- | --- | --- |
| [Water basin](../../solvers/water-coupling.html) (shallow, linear waves) | `/coupling`, `/water` | buoyancy, drag and wave making, two-way |
| [Cables](../../solvers/compliant-cable.html) and [frames](../../solvers/frame-mechanics.html) | `/cable`, `/frame`, `/structure` | attachments that carry force and moment, two-way and implicit |
| [Cloth](../../solvers/cloth.html) | `/cloth` | contact and attachments, two-way |
| [Grains](../../solvers/granular.html) | `/granular` | contact with bodies as walls, two-way |
| [Deformable solids](../../solvers/solid-mechanics.html) | `/solid`, `/solid-contact` | node-against-body contact, friction and welds, two-way |
| [Fracture](../../solvers/solid-fracture.html) | `/fracture` | as solids; fragments stay in the solid solver |
| [Heat](../../solvers/heat-transfer.html) | `/heat` | none; drives thermal strain in a solid, one-way |
| [Fluid in a volume](../../solvers/fluid.html) | `/fluid` | drag and lift on immersed bodies, two-way |
| [Shallow water on terrain](../../solvers/shallow-water.html) | `/shallow-water` | buoyancy and drag on floating bodies, two-way |

Each coupling is explicit unless the table says otherwise: forces computed from the state before the step are applied
during it. The pages state the consequences (a stability limit, an added-mass effect) with numbers.

## Building a coupled scene

By hand, with the solver's own classes and one `Simulation` ([the stepping loop](stepping-loop.html)); or from a
scene file, which can describe every solver above:

```js
import {createWorld} from 'box3d-webgpu-kit';
import {loadScene, sceneWorldOptions, mooredBuoyScene} from 'box3d-webgpu-kit/scene';

const scene = mooredBuoyScene();                              // a buoy in a basin, moored to the bed by a cable
const world = await createWorld(sceneWorldOptions(scene));
const {simulation, bodies, cables, attachments} = loadScene(world, scene);
for (let i = 0; i < 8 * 240; i++) simulation.step();
```

The [examples gallery](../../examples/index.html) has a scene for each solver, with its JSON.

## What is not coupled

Two deformable solids do not collide with each other. Grains do not interact with cloth or fluids. The free-surface
fluid has no bodies in it. Heat does not flow into rigid bodies. Each solver page lists its limits.
