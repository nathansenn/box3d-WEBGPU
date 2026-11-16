# The stepping loop

Physics advances in fixed steps. Rendering happens whenever the display asks.

```js
function frame(seconds) {                               // seconds since the last frame
  const {steps, alpha} = world.update(seconds);         // runs the whole steps that are due
  const matrices = world.interpolatedMatrices(alpha);   // transforms blended between the last two steps
  draw(matrices);
}
```

- `world.step()` advances by exactly one fixed step. `world.update(seconds)` accumulates frame time and takes as many
  steps as are due, at most `maxSteps` per call; the rest is dropped and reported as `droppedSeconds`.
- A negative, zero, huge or non-finite frame time is clamped, not refused: a tab that was hidden for a minute does not
  explode the simulation. `pauseOnHidden(world)` resets the accumulator when the page is hidden.
- `world.matrices()` is a live view of column-major 4x4 transforms, one per body, ready for instanced drawing.
  Fetch it again every frame: growth of the WebAssembly memory detaches old views.

## One loop for every solver

When water, cables, cloth, grains, solids, heat or fluids run beside the rigid world, a `Simulation` steps all of
them in the right order:

```js
import {createSimulation, waterSubsystem, structureSubsystem} from 'box3d-webgpu-kit/simulation';

const simulation = createSimulation(world).add(waterSubsystem(water)).add(structureSubsystem(coupling, {bodies}));
simulation.step();          // or simulation.update(frameSeconds); do not call world.step() yourself
simulation.order();         // the stages and what runs in each
simulation.energy();        // one ledger over every solver
simulation.diagnose();      // steps against their stability limits, by rule with the numbers
```

Each solver states its own time step. It may equal the world's, divide it (N solver steps per world step) or be a
multiple of it (one solver step every N world steps); anything else is refused when the solver is added. A step
beyond a solver's stability limit is refused with `UNSTABLE_TIME_STEP` and the limit in the message. More in the
[simulation page](../../solvers/simulation.html).
