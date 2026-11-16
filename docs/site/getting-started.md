# Getting started

Two ways in, both under five minutes. The first needs nothing installed.

## In the browser: the Physics Lab

1. Open the [Physics Lab](../../lab.html?example=domino-run). A scene of dominoes loads and runs.
2. Pick another example from the [examples gallery](../examples/index.html): every card has an **Open in the Lab** link.
3. The Lab can copy a link that holds the whole scene and save the scene as a JSON file; dropping a scene file, or
   an OBJ, STL or glTF file, onto the page loads it.
4. Add `&edit=1` to the address to open the scene editor: add bodies and joints, change materials, undo and redo.

The Lab runs the same engine as the kit below, in your browser, with WebGPU where available and WebGL2 otherwise.

## In your own code: the kit

```bash
npm install box3d-webgpu-kit
```

```js
import {createWorld} from 'box3d-webgpu-kit';

const world = await createWorld({gravity: [0, -9.81, 0]});   // SI units, a ground slab whose top is y = 0
const ball = world.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 3, 0], restitution: 0.5});

for (let i = 0; i < 120; i++) world.step();                  // two seconds at 1/60 s
console.log(world.getState(ball).position);                  // [0, 0.25..., 0]: resting on the ground
world.dispose();
```

That runs in Node 20 or later and in any current browser; the package carries its WebAssembly and loads it itself.

To start a project with a renderer:

```bash
npx box3d-webgpu-kit init my-game --template three    # Vite and three.js; also: node, single
```

`single` is one self-contained module and an HTML file with no build step.

### Without npm

```html
<script type="module">
  import {createWorld} from './box3d-kit.single.js';   // from `npx box3d-webgpu-kit init x --template single`
  const world = await createWorld({gravity: [0, -9.81, 0]});
</script>
```

## Next

- [Worlds and units](concepts/worlds-and-units.html), [shapes](concepts/shapes.html), [joints](concepts/joints.html)
  and [events](concepts/events.html): the rigid world.
- [The stepping loop](concepts/stepping-loop.html) and [coupling](concepts/coupling.html): water, cables, cloth,
  grains, solids, heat and fluids beside the rigid bodies.
- [Scene files](concepts/scene-files.html), [checkpoints](concepts/checkpoints.html),
  [determinism](concepts/determinism.html), [materials](concepts/materials.html).
- When something is refused or misbehaves: [errors and diagnostics](../reference/errors.html).
- The [API reference](../api/index.html) lists every export; press `/` to search it.
