# Scene files

A scene is plain JSON in one versioned format, `box3d-scene`. It can be validated, loaded, saved, hashed and packed
into a link.

```js
import {validateScene, loadScene, saveScene, sceneWorldOptions, canonicalize, sceneHash, encodeSceneLink, decodeSceneLink} from 'box3d-webgpu-kit/scene';

const scene = {
  format: 'box3d-scene', version: 1,
  world: {gravity: [0, -9.81, 0], step: 1 / 60, subSteps: 4},
  materials: {steel: {density: 7800, friction: 0.4, restitution: 0.1}},
  bodies: [
    {id: 'ball', shape: {kind: 'sphere', radius: 0.25}, position: [1.2, 3.4, 0], material: 'steel'},
    {id: 'crate', shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [-3, 0.5, 0], rotationEuler: [0, 45, 0]},
  ],
  joints: [{id: 'rope', type: 'distance', bodyA: null, bodyB: 'ball', frameA: {position: [0, 5, 0]}, length: 2}],
};

validateScene(scene);                                  // [] or a list of {path, message}; path is a JSON pointer
const world = await createWorld(sceneWorldOptions(scene));
const loaded = loadScene(world, scene);                // {bodies, joints, builder, simulation, ...}
const now = saveScene(world, loaded);                  // the scene with every body where it is now
const link = await encodeSceneLink(scene);             // 'b3s1d....': letters, digits, - _ . only
decodeSceneLink(`https://example.org/lab.html?scene=${link}`);
```

- **Canonical text.** `canonicalize(scene)` sorts keys, drops defaults and writes numbers one way, so equal scenes
  give equal text and `sceneHash` (SHA-256) names a scene.
- **Coupled scenes.** Sections `water`, `cables`, `frames`, `cloths`, `grains`, `solids`, `heat`, `fluids` and
  `shallowWater` describe the other solvers; loading such a scene returns a ready `Simulation`.
- **Robots.** `robotToScene(parseURDF(text))` from `box3d-webgpu-kit/robot` turns a URDF or MJCF file into a scene.

## Scenes from outside

A scene file or a link can come from anyone. `validateScene` never throws and reports every problem with the path
of the field; limits on counts, sizes and nesting are checked before anything is allocated; a link is checked for
length and checksum and is never decompressed beyond the size it declares (4 MiB at most). Keys such as `__proto__`
are data. The fuzzers mutate tens of thousands of scenes on every pull request to keep it so
([robustness](../../reference/robustness.html)). The format is specified in the
[scene format page](../../solvers/scene-format.html).
