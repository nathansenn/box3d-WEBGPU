# box3d-webgpu-kit

Rigid-body physics for games and interactive apps, built on [Box3D](https://github.com/erincatto/box3d) (Erin Catto) compiled to WebAssembly. One install gives you:

- the prebuilt 450 KB WASM module (190 KB gzipped), with no build toolchain needed;
- up to 16 isolated worlds per module;
- a fixed-timestep game loop with render interpolation;
- generation-checked body handles, plus user data to map them to your entities;
- ray, sphere-cast, box-cast and overlap queries;
- worker hosting (`box3d-webgpu-kit/worker`) so physics never blocks rendering, with lock-free shared-memory frames and a free-running mode;
- deterministic record/replay that pinpoints where a desync started, and an exact state hash;
- compact network snapshots for authoritative multiplayer (server simulates, clients draw), plus a runnable room-server example;
- save files, a live stats overlay and a generated API reference (`api/API.md`);
- a scheduler for many worlds under a frame budget;
- debug-draw line buffers, Z-up conversion, and `{x, y, z}` / three.js `Vector3` inputs anywhere;
- zero-dependency three.js, Babylon.js and raw WebGPU instancing adapters;
- integrity-checked, provenance-stamped WASM, plus explicit failures instead of silent fallbacks.

Tested in Node 20+ and Node `worker_threads`, in a browser through a Vite production build, and in a browser Web Worker. A browser Web Worker and Node produced the same exact state hash for the same session on the same machine.

## Start a project

```bash
npx box3d-webgpu-kit init my-game --template three    # or: node, single
```

- `three` is a Vite + three.js game; its dev server binds 127.0.0.1.
- `node` is a headless loop.
- `single` is a zero-install static page: one self-contained module plus an HTML file, no build step.

`npx box3d-webgpu-kit info` prints what this build and runtime support.

> Community package. It is not an official Box3D release. Box3D is MIT licensed; see `wasm/BOX3D_LICENSE.txt` and `THIRD_PARTY_NOTICES.md`.

## Quick start

```ts
import {createWorld} from 'box3d-webgpu-kit';

const world = await createWorld({seed: 1});         // empty arena: static ground, top face at y = 0
const crate = world.spawnBox({position: [0, 4, 0], halfSize: 0.5});

world.setUserData(crate, myEntity);                 // any value; cleared when the body is destroyed

function frame(seconds: number) {
  const {alpha} = world.update(seconds);             // runs whole 1/60 s steps
  const smooth = world.interpolatedMatrices(alpha);  // blended between the last two steps, for rendering
  const pose = world.getPose(crate);                 // {position, rotation: [x,y,z,w], halfExtents} or null
}

const hit = world.raycast([0, 10, 0], [0, -20, 0]);  // translation is a full displacement, not a direction
const entity = hit && world.getUserData(hit.body);   // back to your game object
world.sphereCast([0, 10, 0], 0.3, [0, -20, 0]);
world.overlapBox([0, 1, 0], [2, 1, 2]);              // also boxCast, overlapSphere; all accept {filter, limit}
world.explode([0, 0, 0], 8, 5);
world.destroyBody(crate);                            // the handle is now stale forever; it never aliases a new body
world.resetArena();                                  // deterministic restart
world.dispose();
```

### Build your own scene: shapes, joints and events

`reset()` starts an empty world in SI units: metres, kilograms (from density in kg/m³), seconds, radians, and gravity 9.81 m/s² down.

```ts
import {createWorld, axisRotation} from 'box3d-webgpu-kit';

const world = await createWorld({gravity: [0, -9.81, 0]});   // SI world with the ground slab; add ground: false for none

const ball = world.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 3, 0], restitution: 0.5, hitEvents: true});
const pill = world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, position: [1, 2, 0], density: 500});
const lift = world.createBody({shape: {kind: 'box', halfExtents: [1, 0.1, 1]}, type: 'kinematic', position: [3, 0.5, 0]});
world.moveKinematic(lift, [3, 2, 0], [0, 0, 0, 1], 1.5);     // reach y = 2 in 1.5 s; pushes whatever rides on it

// A door hinged about the vertical axis, driven by a motor and held by limits.
const door = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 1, 0.05]}, position: [6, 1, 0]});
const up = axisRotation([0, 1, 0]);                          // hinges turn about the frame's z axis: aim it at y
const hinge = world.createJoint({
  type: 'revolute', bodyA: null, bodyB: door,                // null = the fixed world
  frameA: {position: [5.5, 1, 0], rotation: up}, frameB: {position: [-0.5, 0, 0], rotation: up},
  limits: {lower: -1.5, upper: 1.5}, motor: {speed: 1, maxForce: 200},
});
world.setJointMotor(hinge, null);                            // let it swing freely
world.getJointState(hinge);                                  // {type, value: angle, force, torque}

world.onEvent(event => {                                     // after each step
  if (event.kind === 'hit') console.log(event.approachSpeed, event.point);
});

world.applyForce(ball, [10, 0, 0]);                          // newtons, over the next step
world.setVelocity(pill, [0, 5, 0]);
world.getState(ball);                                        // {position, rotation, linearVelocity, angularVelocity, mass, awake, type}
world.setCollisionFilter(pill, 2n, 1n);                      // category 2, collides with category 1 only
world.setGravity([0, -1.62, 0]);                             // the Moon
```

| Joint | Constrains | Options |
|---|---|---|
| `weld` | everything | `spring` makes it flexible |
| `revolute` | hinge about frame z | `limits`, `motor`, `spring` |
| `spherical` | ball and socket | `coneAngle`, twist `limits`, `spring` |
| `prismatic` | slide along frame A x | `limits`, `motor`, `spring` |
| `distance` | a fixed `length` | `limits` (min/max length), `motor`, `spring` |
| `wheel` | spin about frame B z, suspension along frame A x | `spring`, `limits`, `motor`, `setJointSteering` |

```ts
// Convex hull from points, static triangle mesh, and terrain.
world.createBody({shape: {kind: 'hull', points: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]}, position: [0, 5, 0]});
world.createBody({shape: {kind: 'mesh', vertices: [0, 0, -4, 10, -3, -4, 10, -3, 4, 0, 0, 4], indices: [0, 2, 1, 0, 3, 2]}, position: [0, 2, 0]});
world.createBody({shape: {kind: 'heightfield', heights, countX: 65, countZ: 65, spacing: [0.5, 0.5]}, position: [-16, 0, -16]});
```

The physics is checked against closed-form answers in `test/v08.test.mjs`: free fall, the compound-pendulum period (within 0.1%), sliding-friction stopping distance, rebound height, momentum and energy in an elastic collision, `F = m a`, `τ = I α`, spring period, circular-motion tension, and sliding (g sin θ) and rolling (5/7 g sin θ) down mesh and terrain inclines.

**Several shapes on one body, and stated mass.** A compound holds up to 64 boxes, spheres, capsules and hulls, each at its own pose in the body's frame and with its own density, friction and restitution. `massData` (or `setMassData`) replaces the mass, centre of mass and inertia tensor that the shapes give.

```ts
// A hammer: a wooden handle along y and a steel head across its top. `position` is the origin the shapes are placed from.
const hammer = world.createBody({position: [0, 2, 0], density: 7800, shape: {kind: 'compound', shapes: [
  {shape: {kind: 'capsule', radius: 0.02, halfLength: 0.25}, density: 600, friction: 0.9},
  {shape: {kind: 'box', halfExtents: [0.08, 0.04, 0.04]}, position: [0, 0.29, 0]},          // rotation: [x, y, z, w] turns a child
]}});
world.getMassData(hammer);   // {mass, center: [x, y, z] in the body frame, inertia: [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] about it, explicit: false, shapeCount: 2}

// A flywheel that collides as a sphere and has the mass and inertia of the real part.
const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [2, 1, 0], massData: {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]}});
world.setMassData(wheel, {mass: 12, center: [0, 0, 0.01], inertia: [0.9, 0.9, 1.6, 0, 0, 0]});   // later, at any time
world.resetMassData(wheel);                                                                      // back to the shape's
```

- A compound's mass, centre of mass and inertia are the sums over its shapes (parallel-axis theorem); shapes that overlap count their overlap twice. The body's position is the frame's origin, not the centre of mass. `getState().linearVelocity` is the velocity of the centre of mass.
- The whole body has one colour, one collision filter and one set of flags; events name the body, not the shape. Meshes and height fields cannot be part of a compound.
- `inertia` is the tensor about the centre of mass in body axes. It must be positive definite; nothing checks that it suits the collision shape. Setting mass data keeps the body's pose and the velocity of its origin. The values stay across `setBodyType` and act while the body is dynamic; a body with `lockRotation` keeps no inertia.
- Both are recorded and replayed, work on a worker-hosted world, and are in scene files (version 2).

Measured in `test/v17-compound.test.mjs`: a dumbbell's mass and parallel-axis inertia to 8e-8, its spin-up under a torque to 2e-6 and its period as a physical pendulum to 3e-7; the centre of mass and product of inertia of an L of two boxes to 1.3e-7, and the tilt at which that L tips over to 0.008° of the 15.64° its centre of mass gives; a body with a stated full tensor against Euler's equations to 2.2e-4 after 2 s; a pendulum that exists only through a stated centre of mass to 1.7e-6.

To draw mixed shapes with three.js use `createShapeMeshes(THREE, world)` and `syncShapeMeshes(world, meshes, {alpha})` from `box3d-webgpu-kit/three`; capsules render exactly at any size. For other renderers, `world.bodyKinds()` gives the shape of each row of `matrices()`.

### Import geometry: OBJ, STL and glTF

`box3d-webgpu-kit/geometry` reads mesh files into plain `{vertices, indices, name?}` meshes and turns them into shapes. It has no dependencies and does not fetch: you hand it the text or bytes.

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {parseOBJ, parseSTL, parseGLB, meshVolume, isConvex, transformMesh, createBodiesFromMesh} from 'box3d-webgpu-kit/geometry';

const world = await createWorld({gravity: [0, -9.81, 0]});

const [terrain] = parseGLB(await (await fetch('level.glb')).arrayBuffer());   // one mesh per node, in world space
createBodiesFromMesh(world, terrain);                                         // one static triangle-mesh body

const part = transformMesh(parseSTL(await (await fetch('bracket.stl')).arrayBuffer()), {scale: 0.001});   // mm to m
meshVolume(part);                                                             // m^3, for a closed mesh
const {bodies, joints, decomposition} = createBodiesFromMesh(world, part, {
  as: isConvex(part) ? 'hull' : 'decomposed',                                 // one hull, or convex pieces welded together
  position: [0, 2, 0], density: 2700,
});
decomposition?.volumeError;                                                   // (hull volume - mesh volume) / mesh volume
```

| Function | What it does |
|---|---|
| `parseOBJ(text)` | `v` and `f` lines, negative indices, `v/vt/vn` forms, polygons as fans, one mesh per `o`/`g` name. |
| `parseSTL(bytes or text)` | Binary (by the 84 + 50 n length rule, even when the header says "solid") and ASCII; corners welded. |
| `parseGLB(bytes)`, `parseGLTF(json, buffers)` | glTF 2.0 triangles, strips and fans; float positions; 8-, 16- and 32-bit or no indices; `byteStride`; node transforms baked in; `data:` and caller-supplied buffers. Sparse, quantised and compressed geometry is rejected with the reason. |
| `meshVolume`, `meshCenterOfMass`, `meshBounds`, `isClosed`, `isConvex` | Measures of a closed mesh (signed tetrahedra). |
| `weldVertices`, `transformMesh`, `flipWinding`, `convexHull` | Clean-up and conversion. |
| `toHullShape`, `toMeshShape`, `toHeightfieldShape` | Shapes for `createBody`. A hull keeps 32 points by default. |
| `convexDecompose(mesh, options)` | Convex pieces of a concave closed mesh, with the volume error. |
| `createBodiesFromMesh(world, mesh, {as})` | `'mesh'`: one static body. `'hull'`: one body. `'decomposed'`: hull bodies joined by weld joints. |

Things to know:

- A file's units are its own. The kit is in metres: scale millimetre files by 0.001.
- Triangles must be counter-clockwise seen from outside. `meshVolume` is negative for an inside-out mesh; `flipWinding` fixes it.
- Box3D holds at most 64 vertices and 255 half-edges per hull. A rounded hull (all triangles) is cut to 44 points, which makes it smaller: a sphere's hull loses 19% of its volume at 32 points and 14% at 44. Use `{kind: 'sphere'}` for balls. `createBodiesFromMesh` scales the density so a closed mesh still has mass = density x mesh volume.
- `convexDecompose` is greedy plane splitting: the most concave piece is cut by the best of its own face planes and nine axis-aligned planes, until the concavity target or `maxHulls` is met. Solids with flat inner faces (an L, a U, steps) split exactly. Curved concavities are only approached: a torus (576 triangles) is off by 24% with 8 hulls, 9% with 16 and 3% with 32. It is not V-HACD; it needs a closed mesh, and takes about a second for a few thousand triangles.
- `createBodiesFromMesh` makes a decomposed solid as several bodies held by weld joints, as it did before the kit had compound shapes. Welds are solved iteratively and flex slightly under impact (1.7 mm for a 225 kg L landing at 2 m/s in the test). To get one rigid body instead, pass the hulls of `convexDecompose` as the children of a `{kind: 'compound'}` shape (up to 64).
- Parsers reject malformed input with `EngineError('INVALID_PAYLOAD')` and the reason, and refuse more than 4 million vertices or 8 million triangles (`GEOMETRY_LIMITS`).

`test/v10-geometry.test.mjs` checks all of this against closed-form answers: one cube in four formats (volume exactly 1), a tetrahedron's volume and centroid, a sphere's volume converging at second order, transformed glTF nodes, mass = density x volume for imported hulls, sliding at g sin θ down an imported ramp (within 0.1%), and a decomposed L coming to rest on the ground.

### Scene files and share links

`box3d-webgpu-kit/scene` turns a scene into plain JSON and back: one versioned format (`box3d-scene`; version 1, and version 2 for bodies that are compounds or state their mass data) that can be validated, loaded, saved, diffed, hashed and packed into a URL. It has no dependencies. The full schema is in [`docs/SCENE_FORMAT.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/SCENE_FORMAT.md).

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {validateScene, loadScene, saveScene, sceneWorldOptions, canonicalize, sceneHash, encodeSceneLink, decodeSceneLink, SceneBuilder} from 'box3d-webgpu-kit/scene';

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

validateScene(scene);                                  // [] when valid, else [{path: '/bodies/0/shape/radius', message: 'must be >= 0.0001, got -1'}, ...]

const world = await createWorld(sceneWorldOptions(scene));   // the scene's step, sub-steps, seed, gravity and ground
const loaded = loadScene(world, scene);                // {bodies: Map<id, Body>, joints: Map<id, Joint>, builder, scene}
world.applyImpulse(loaded.bodies.get('ball'), [2, 0, 0]);
for (let i = 0; i < 120; i++) world.step();

const paused = saveScene(world, loaded);               // the same scene with every body's current pose and velocities
const link = await encodeSceneLink(paused);            // 'b3s1d.<length>.<crc>.<base64url>': safe in a URL as it is
location.hash = `scene=${link}`;
loadScene(world, decodeSceneLink(location.hash));      // resume, here or on another machine

canonicalize(scene, {pretty: true});                   // stable key order and number format, for diffing
sceneHash(scene);                                      // SHA-256 of the canonical text
```

To build a scene in code and still be able to save it, create bodies and joints through a `SceneBuilder`. The world cannot report a shape or a joint definition, so the builder remembers what it created:

```ts
const builder = new SceneBuilder(world, {world: {gravity: [0, -9.81, 0]}});   // resets the world
builder.addBody('floor', {shape: {kind: 'box', halfExtents: [5, 0.5, 5]}, type: 'static', position: [0, -0.5, 0]});
const lamp = builder.addBody('lamp', {shape: {kind: 'sphere', radius: 0.2}, position: [4.2, 2.4, 0]});   // a Body, as from createBody
builder.addJoint('chain', {type: 'distance', bodyA: 'floor', bodyB: 'lamp', frameA: {position: [3, 4.5, 0]}, length: 2});
builder.remove('chain');
const json = builder.toJSON();                         // at any time
```

- **Validation comes first.** `loadScene` checks the whole file before it touches the world and throws `SceneValidationError` (code `INVALID_PAYLOAD`, `.problems` holds every finding with a JSON-pointer path). An invalid file leaves the running scene alone. If the engine refuses a body or joint part-way, the world is left reset with none of the scene in it, and the error names the id.
- **What a save restores.** Position, rotation, both velocities and the type of every body, and gravity. Positions and velocities come back bit-identical; a rotation component can differ by one float32 step. Sleep state, the solver's contact and joint impulses, the tick count and settings changed on the world directly (`setJointMotor`, `setDamping`, ...) are not saved, so a resumed run is a valid simulation from that state but not a bit-exact continuation. Measured drift after 100 more ticks: 5e-8 m for pendulums, 1.6e-4 m for a car on terrain, 1 cm for falling dominoes, 7 cm for a toppling ragdoll. For bit-exact reproduction use `startRecording` and `replay`.
- **Links.** `encodeSceneLink` uses the platform's `CompressionStream('deflate-raw')` and falls back to storing the JSON; `encodeSceneLinkSync` always stores. `decodeSceneLink` is synchronous and has its own inflate, so it works everywhere. It checks a CRC-32 and the length, and never decompresses more than the link declares (4 MiB at most). The example scenes are 565 to 1,086 characters as links.
- **Examples.** `pendulumWaveScene()`, `newtonsCradleScene()`, `dominoRunScene()`, `terrainCarScene()` and `ragdollScene()` return ready-made scenes; `EXAMPLE_SCENES` lists them by name.
- **Version 2.** A body's shape may be `{kind: 'compound', shapes: [{shape, position?, rotation?, density?, friction?, restitution?}, ...]}`, and a body may have `massData: {mass, center?, inertia}`. A scene that uses either is version 2; every other scene stays version 1 with the canonical text and hash it had, whatever it declares. A version 2 feature in a file that says version 1 is reported.
- **Coupled scenes.** A scene may also have `water`, `cables` and `frames` sections (still version 1; a scene without them is unchanged). `loadScene` builds them and returns a `simulation` to step instead of the world; see [One stepping loop](#one-stepping-loop-for-every-solver).

`test/v12-scene.test.mjs` checks the round trips, determinism from a link, save and resume, 97 malformed files, damaged links and a decompression bomb, and the physics of two example scenes: every pendulum's period within 0.1% of `2π sqrt(I / (m g L))` (measured 0.0004%), and a Newton's cradle whose last ball leaves at the first ball's speed within 2% (measured 0.4%).

### Import a robot: URDF and MJCF

`box3d-webgpu-kit/robot` reads a URDF or MJCF file and makes a scene of it, or adds it to a world. No dependencies: it has its own small XML parser, which refuses DTDs and never expands entities.

```js
import {createWorld} from 'box3d-webgpu-kit';
import {parseURDF, robotToScene, robotReport, spawnRobot, robotLinkPose, sixDofArmURDF} from 'box3d-webgpu-kit/robot';
import {loadScene, sceneWorldOptions} from 'box3d-webgpu-kit/scene';

const robot = parseURDF(sixDofArmURDF());            // or parseMJCF(text); pass {meshes: {name: bytes}} for mesh files
console.log(robot.warnings);                         // everything ignored, approximated or unsupported, by element

const names = robot.joints.map(joint => joint.name);
const options = {positions: {shoulder: 0.4, elbow: -0.8}, motors: Object.fromEntries(names.map(name => [name, 0]))};
const scene = robotToScene(robot, options);          // a scene file: validate, save, share by link
const world = await createWorld(sceneWorldOptions(scene));
loadScene(world, scene);

// Or add it to a world you already have, and get handles by link and joint name.
const arm = spawnRobot(world, robot, {...options, position: [2, 0, 0], prefix: 'second:'});
world.setJointMotor(arm.joints.get('elbow'), {speed: 0.5, maxForce: 80});
const tool = arm.links.get('tool'), pose = robotLinkPose(world.getState(tool.body), tool.frame);

const report = robotReport(robot, options);          // what the bodies are, against what the file says
console.log(report.totalMass, report.totalMassActual, report.maxPrincipalError, report.worstLink);
```

What you get, and what you do not:

- Each link becomes one body, placed by forward kinematics at the joint positions you give; a link with several collision shapes is one compound body (`links: 'welded'` gives one welded body per shape instead). Fixed joints become welds, revolute and continuous joints hinges about the joint axis, prismatic joints sliders, ball joints spherical joints; limits are kept. The root is welded to the world unless `floatingBase: true`. URDF and MJCF are Z up; the robot is turned into the kit's Y-up world.
- **Mass, centre of mass and inertia are the file's.** The import sets `density = mass / collision volume`, and where the shapes then do not have the file's `<inertial>` it gives the body the file's values as `massData`. On the example arm above the solver's principal moments are within 5e-8 of the file's on every link; from the shapes alone the worst link was 42% off, and `robotReport` still gives that number per link (`shapesPrincipalError`). The collision shapes are not changed to agree. `inertia: 'shapes'` turns this off. A link with mass and no collision shape becomes a box with exactly the file's inertia that collides with nothing.
- **Joints are soft.** The engine's joints are 60 Hz constraints by default, so a loaded arm settles below its kinematic pose: 17.0 mm at the tool of this 16.8 kg, 1 m arm. `jointStiffness: {hertz: 240}` brings its largest displacement to 2.3 mm. A long chain stretches by millimetres.
- An effort limit is the largest torque of the motor you ask for with `motors` (speed 0 holds the joint); joint damping and stiffness become a joint spring; dry friction a zero-speed motor.
- Cylinders become 24-sided prisms of the same volume (inertia within 0.003%) or capsules; meshes become convex hulls; MJCF ellipsoids a 42-point hull.
- Not supported, and reported when a file uses them: URDF `mimic` and planar joints; MJCF `equality`, `tendon`, contact pairs, most actuator types, several joints on one body, armature.

`docs/ROBOT_IMPORT.md` in the repository has the tables of supported elements for both formats, the conventions, the mesh name matching and every measured error. Example robots ship as functions that return file text: `twoLinkArmURDF`, `cartPoleURDF`, `sixDofArmURDF`, `wheeledCartURDF`, `doublePendulumURDF`, `doublePendulumMJCF`, `hangingChainURDF`.

### three.js

```ts
import * as THREE from 'three';
import {createBodyMesh, syncInstancedMesh} from 'box3d-webgpu-kit/three';

const mesh = createBodyMesh(THREE, world);            // one InstancedMesh for every body
scene.add(mesh);
renderer.setAnimationLoop(() => {
  const {alpha} = world.update(clock.getDelta());
  syncInstancedMesh(world, mesh, {alpha});            // omit alpha to draw the latest step exactly
  renderer.render(scene, camera);
});
```

The adapter takes your `THREE` namespace, so the package does not depend on any three.js version. It uploads nothing when transforms have not changed. See [`examples/three-falling-boxes.html`](https://github.com/nathansenn/box3d-WEBGPU/tree/main/packages/box3d-kit/examples) in the repository.

### Physics on a worker thread

```ts
// physics.worker.js
import {serveWorld} from 'box3d-webgpu-kit/worker';
serveWorld(self);

// main thread
import {connectWorld} from 'box3d-webgpu-kit/worker';
const world = await connectWorld(new Worker(new URL('./physics.worker.js', import.meta.url), {type: 'module'}));
const crate = await world.spawnBox({position: [0, 4, 0]});  // every call is async; bodies are {token}
await world.update(dt);                                      // steps in the worker, transfers fresh transforms back
syncInstancedMesh(world, mesh);                              // RemoteWorld works with the three adapter
```

**Shared memory:** when `SharedArrayBuffer` is available, frames travel through a lock-free seqlock instead of messages. That means Node `worker_threads`, or browsers on cross-origin isolated pages (COOP/COEP). A stress test with a concurrently writing thread found no torn frames. It also enables a free-running mode:

```ts
const world = await connectWorld(worker, {sharedMemory: true});   // 'auto' (default) uses it when available
await world.start(60);        // the worker steps on its own clock
renderer.setAnimationLoop(() => { syncInstancedMesh(world, mesh); renderer.render(scene, camera); });  // just reads the newest frame
```

In message mode, frames arrive already interpolated to their `alpha`. Interpolation draws up to one physics step behind the latest state, so drawn transforms can trail `getPose()` by a step. That is the usual cost of smooth fixed-step rendering. `setUserData`/`getUserData` stay on the main thread. `connectWorld` also accepts a Node `worker_threads` Worker, and `serveWorld` accepts `parentPort`. See `examples/worker/`.

### Record, replay and desync detection

```ts
world.startRecording({checkpointEvery: 60});  // resets the arena, then logs every mutation and step, hashing every 60 ticks
// ... play ...
const log = world.stopRecording();       // plain JSON: attach it to a bug report
otherWorld.replay(log);                  // true when the final state matches bit-for-bit
otherWorld.replayDetailed(log);          // {matches, divergence: {from, to}}: ticks bounding the first desync
world.exactHash();                       // FNV-1a over the exact float32 bits of every transform
```

Replays need the same WASM build, `step` and `subSteps`. `resetArena`/`loadPreset` throw while recording, because the log could not reproduce them.

### Save files

```ts
const file = saveSession(world.stopRecording());          // JSON-safe: kit version, native ABI, WASM SHA-256, replay log
const report = loadSession(freshWorld, file);             // replays and proves the result: report.matches
```

The native bridge cannot serialize solver state yet, so a save *replays* the session. Loading refuses a file from a different WASM build (`INCOMPATIBLE_SAVE`) unless you pass `{allowOtherBuild: true}`; `matches` then tells you whether it still held.

### Debug overlay

`mountInspector(world)` pins a small panel showing bodies, awake count, contacts, tick, step time, dropped time and WASM heap. It also accepts a `RemoteWorld`. `formatStats(stats)` returns the same text for logs or your own HUD.

### Game-loop helpers

- `world.stats()` returns bodies, awake count, contacts, capacity, tick, `lastStepMs`, `lastUpdateMs` and `droppedSeconds`. Use it for a debug HUD or to adapt quality.
- `createWorld({capacity: 16384})` reserves body storage up front, so growth never stalls gameplay.
- `pauseOnHidden(world)` clears partial-step time when the tab is hidden or shown. On return, also reset your own frame timestamp; `maxSteps` caps any catch-up.
- `EngineErrorCode` is the union of every error `code`.
- A world that is garbage-collected without `dispose()` gets its native slot released and logs a warning. Route or silence the warning with `leakReporting.warn`.

### Babylon.js

```ts
import {syncThinInstances} from 'box3d-webgpu-kit/babylon';
const box = MeshBuilder.CreateBox('bodies', {size: 2}, scene);   // unit cube -1..1
scene.onBeforeRenderObservable.add(() => {
  const {alpha} = world.update(engine.getDeltaTime() / 1000);
  syncThinInstances(world, box, {alpha});                       // pass {rightHanded: true} if scene.useRightHandedSystem
});
```

Babylon is left-handed by default and Box3D is right-handed, so the adapter mirrors Z unless you pass `rightHanded: true`. The adapter is tested against Babylon's thin-instance API shape but has not yet been run in a live Babylon scene.

### Raw WebGPU

```ts
import {writeInstances, INSTANCE_WGSL} from 'box3d-webgpu-kit';
const count = writeInstances(world, device.queue, instanceBuffer, {alpha, up: 'y'});  // mat4x4<f32> per body
pass.draw(36, count);                                                                  // unit cube -1..1
```

The call uploads nothing when nothing moved. With `{changedRowsOnly: true}` it keeps a CPU shadow copy and uploads only the contiguous range of rows that changed, which pays off when most bodies sleep. `lastUploadRange()` reports what was sent. `colorBuffer` also streams RGBA. A test copies the result back from a real WebGPU device (Dawn on the Metal backend) and gets the interpolated matrices back bit for bit.

### Multiplayer snapshots

```ts
// server, one encoder per client
const encoder = new SnapshotEncoder();
socket.send(encoder.encode(world));                 // first call is a keyframe, then deltas
// client
const view = new SnapshotDecoder();
socket.onmessage = e => view.apply(new Uint8Array(e.data));
syncInstancedMesh(view, mesh);                      // the decoder is an InstanceSource
```

- **Precision:** positions within 0.5 mm; rotations use smallest-three int16 quaternions. Snapshots carry poses only: set `view.color` for the one RGBA the decoder reports for every instance.
- **Size:** a keyframe is 31 bytes per body. Bodies that did not move cost one bit, so a settled 151-body scene is a 39-byte delta.
- **Delivery:** deltas need in-order, reliable delivery. A decoder that misses one throws `INVALID_STATE`; send it `encode(world, {keyframe: true})`.

### Many worlds

```ts
const scheduler = new WorldScheduler({budgetMs: 6}).add(roomA).add(roomB).add(roomC);
scheduler.update(dt);   // worlds that do not fit this frame keep their time and go first next frame
```

Deferred worlds still simulate the same total time; a test checks they reach the identical state. Give scheduled worlds a `maxSteps` high enough for the catch-up you allow.

### Debug draw, axes and vectors

- `boxOutlines(world, {alpha, up, skipGround})` returns line-segment vertices (12 edges per box). `rayLine(origin, translation, hit)` draws a query.
- Box3D is metres, kilograms and seconds, right-handed and Y-up. Pass `{up: 'z'}` to `writeInstances`/`boxOutlines`, or use `convertMatrices`, `convertVector` and `toBox3DFrame`, to render in a Z-up engine.
- Every vector parameter accepts `[x, y, z]`, `{x, y, z}` or a three.js `Vector3`.
- `using world = await createWorld()` (and `await using` for `connectWorld`) disposes automatically on runtimes with explicit resource management.

### Gameplay helpers

```ts
import {BodyRing, spawnBoxes, applyImpulses} from 'box3d-webgpu-kit';
const bullets = new BodyRing(world, 100);           // spawning the 101st destroys the oldest: capacity never runs out
bullets.spawn({position: muzzle, impulse: aim});
const crates = spawnBoxes(world, new Float32Array([0, 1, 0, 2, 1, 0]), {halfSize: 0.5});
applyImpulses(world, crates, new Float32Array([0, 5, 0, 0, 5, 0]));
```

### Triggers and a character controller

```ts
import {TriggerSet, CharacterController} from 'box3d-webgpu-kit/gameplay';
const zones = new TriggerSet(world, {attach: true});  // re-checks after every world step
zones.add({shape: {kind: 'box', center: [0, 1, 0], halfExtents: [2, 1, 2]}, data: 'goal'});
zones.on(e => { if (e.type === 'enter') score(e.trigger.data, e.body); });

const hero = new CharacterController(world, {position: [0, 1, 0], pushStrength: 1});
world.onStep(() => hero.move({velocity: input.velocity, jump: input.jump ? 5 : 0}, world.loop.step));
camera.follow(hero.state.position);
```

- **Triggers** run batched overlap queries (128 per call) and diff the results, so they report `enter`/`exit` once per change. A body destroyed inside a trigger exits with `alive: false`. Each trigger reports at most `limit` bodies (up to 256). When a trigger fills up, `trigger.overflow` is set and bodies that dropped out of the report are kept as inside rather than reported as exits.
- **The character** is a kinematic box swept with box casts. It is not a physics body: it collides with static geometry and with boxes, climbs steps up to `stepHeight`, slides along walls, treats slopes steeper than `maxSlopeDegrees` as walls, and sticks to the ground on the way down. Boxes do not push it back. With `pushStrength > 0` it shoves boxes with impulses, which a recording captures as `applyImpulse` commands, so replays match. Move inputs are not recorded.
- **`world.onStep(listener)`** runs after every fixed step. Listeners are silent during `replay`/`replayDetailed`, because their effects are already in the log.
- **Gravity:** the native world uses −10 m/s², not −9.81 (`NATIVE_GRAVITY`). The character defaults to the same value so jumps and falling boxes agree.

### Other renderers

`world.matrices()` is a live `Float32Array` of `bodyCount() * 16` column-major 4×4 matrices, scaled by each box's half extents. Draw a 2×2×2 unit cube per instance. `world.interpolatedMatrices(alpha)` has the same layout. `world.colors()` holds RGBA floats. Fetch both views again every frame, because WASM memory growth detaches old views. `world.transformVersion()` changes only when something moved.

### Optional modules

| Import | What it is |
|---|---|
| `box3d-webgpu-kit/cable` | Compliant cables and ropes (XPBD and proximal solvers, float64): node forces and impulses, tensions, support reactions, exact JSON checkpoints. |
| `box3d-webgpu-kit/water` | CPU shallow-water height fields: an open-boundary reference and a closed-basin solver that conserves volume. |
| `box3d-webgpu-kit/coupling` | Rigid bodies in water, both ways: buoyancy, drag, and bodies that raise the level and make waves (see below). |
| `box3d-webgpu-kit/frame` | 3D beam and column frames: statics, dynamics, end reactions. For structures that bend. |
| `box3d-webgpu-kit/structure` | Cables and frames attached to rigid bodies, both ways: tethers, hanging loads, bodies on beams, cable-stayed spans (see below). |
| `box3d-webgpu-kit/heat` | Heat conduction in solids: transient and steady temperature fields, four boundary types, an energy ledger, and one-way thermal stress and thermal-shock estimates (see below). |
| `box3d-webgpu-kit/solid` | Deformable solids from tetrahedral finite elements with real material parameters: statics, dynamics, stresses, strength checks (see below). |
| `box3d-webgpu-kit/solid-contact` | Those solids in contact with rigid bodies: friction, welds, and two-way coupling to the rigid world in which a light body on a stiff solid stays stable (see below). |
| `box3d-webgpu-kit/fracture` | Fracture of those solids: cohesive cracks along element faces with a strength and a fracture energy, a crack-band model, fragments, and a one-way hand-off of a fragment to the rigid world (see below). |
| `box3d-webgpu-kit/gameplay` | Trigger volumes and a kinematic character controller for the rigid-body world (see above). |
| `box3d-webgpu-kit/geometry` | OBJ, STL and glTF import, mesh measures, convex hulls and convex decomposition (see above). |
| `box3d-webgpu-kit/scene` | Scene files: a versioned JSON format with validation, load, save, canonical text, hashing, share links and example scenes (see above). |
| `box3d-webgpu-kit/cloth` | Calibrated cloth: a membrane and plate with real material parameters, implicit integration, contact and friction against rigid bodies, self-collision, and two-way coupling to the rigid world (see below). |
| `box3d-webgpu-kit/granular` | Granular media by the discrete element method: spherical grains with Hertz or linear contact, friction, rolling resistance, silo and hopper walls, and two-way coupling to the rigid world (see below). |
| `box3d-webgpu-kit/fluid` | Volumetric incompressible flow: the Navier–Stokes equations on a staggered grid with walls, inflows, outflows and periodic sides, fixed and moving obstacles, two-way coupling to the rigid world, and a free-surface tank of liquid particles (see below). |
| `box3d-webgpu-kit/materials` | A material library with sources: steels, aluminium, copper, cast iron, glass, concrete, granite, wood, polymers, rubber, ice, water, air, glass beads and sand, each value with its conditions and citation, and helpers that build the inputs of the solvers above (see below). |
| `box3d-webgpu-kit/simulation` | One stepping loop: a `Simulation` that steps the world, the water and structure couplings, heat and solids in a fixed order, with one clock, energy ledger and event stream (see below). |

Cable, water, frame and solid are the same model code the Box3D WebGPU app runs; the build copies it from the app. The app's own test suites (68 tests: 11 cable, 11 proximal cable, 2 linear water, 6 closed water, 16 frame, 22 solid) run against the packaged copies in `npm test`. Heat and solid are independent of the rigid-body world. Water is coupled to it by `box3d-webgpu-kit/coupling`, and cables and frames by `box3d-webgpu-kit/structure`. The WebGPU water solver is not packaged yet.

### Bodies in water

`WaterCoupling` joins one closed water basin to the world, in both directions. The water lifts each attached body with the weight of the water it displaces, applied at the centre of buoyancy, so bodies float at the right draught and right themselves; a drag model slows them. Each body's displaced volume raises the water and makes waves, and the horizontal force the water puts on a body is taken out of the water's momentum.

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {WaterCoupling} from 'box3d-webgpu-kit/coupling';

const world = await createWorld({step: 1 / 240, ground: false});
// A 16 m x 16 m pool, 2 m deep, floor at y = 0. The pool floor and walls are ordinary static bodies.
world.createBody({shape: {kind: 'box', halfExtents: [8, 0.5, 8]}, type: 'static', position: [0, -0.5, 0]});
const water = new WaterCoupling(world, {cols: 32, rows: 32, dx: 0.5, dz: 0.5, restDepth: 2, origin: [-8, 0, -8]});

const shape = {kind: 'box', halfExtents: [0.5, 0.3, 0.5]};
const crate = world.createBody({shape, position: [0, 4, 0], density: 600});
const report = water.attach(crate, shape);        // pass the shape again: the world does not report it

function fixedStep() {
  water.step();                                   // first: forces for this step, and the water advances
  world.step();                                   // then the rigid bodies
}
report.submergedFraction;                         // 0.6 once it has settled (Archimedes)
water.eta;                                        // Float64Array of surface heights above rest, cols * rows
water.meanElevation();                            // rose by the displaced volume / pool area
```

Units are SI and gravity comes from `world.gravity()`. The step must be the world's fixed step. Drag is a model with coefficients you can set per body (`dragCoefficient`, `referenceArea`, `linearDrag`, `angularDrag`), not a flow solution. `test/v09-coupling.test.mjs` checks the coupling against closed-form answers (Archimedes for all three shapes, volume conservation, heave and roll periods, terminal velocity, the righting moment, an energy budget and determinism); the model, its limits and the measured errors are in [`docs/WATER_COUPLING.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/WATER_COUPLING.md).

### Bodies on cables and frames

`StructureCoupling` attaches cables (`box3d-webgpu-kit/cable`) and frames (`box3d-webgpu-kit/frame`) to bodies of the world, in both directions. A cable end follows a point on a body and its tension pulls on the body there; a frame node carries a body, pinned (forces) or clamped (forces and moments); a cable can hold a frame. Each attachment is solved with the effective mass of both sides, so a light body on a stiff cable or beam stays stable at any step.

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {CompliantCableRuntime} from 'box3d-webgpu-kit/cable';
import {FrameRuntime} from 'box3d-webgpu-kit/frame';
import {StructureCoupling} from 'box3d-webgpu-kit/structure';

const dt = 1 / 240, g = 9.81;
const world = await createWorld({step: dt, ground: false});

// A 2 m cantilever along x, clamped at x = 0: 8 beam elements, 9 nodes with 6 degrees of freedom each.
const section = {youngModulus: 2e9, shearModulus: 8e8, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 1000, up: [0, 1, 0]};
const positions = [], elements = [], fixed = new Array(9 * 6).fill(0);
for (let i = 0; i <= 8; i++) { positions.push(0.25 * i, 0, 0); if (i) elements.push({...section, a: i - 1, b: i}); }
fixed.fill(1, 0, 6);
const frame = new FrameRuntime({positions, elements, fixed, config: {dt, substeps: 1, maxIterations: 1024, drag: 5, gravity: [0, -g, 0],
  forceTolerance: 1e-9, momentTolerance: 1e-9, impulseTolerance: 1e-10, angularImpulseTolerance: 1e-10}});

// A 1 m cable of two segments hanging from the tip, EA = 1e6 N, 0.2 kg/m.
const cable = new CompliantCableRuntime({positions: [2, 0, 0, 2, -0.5, 0, 2, -1, 0], masses: [0.05, 0.1, 0.05],
  constraints: [{a: 0, b: 1, restLength: 0.5, compliance: 0.5 / 1e6}, {a: 1, b: 2, restLength: 0.5, compliance: 0.5 / 1e6}],
  config: {dt, substeps: 1, maxIterations: 2048, residualTolerance: 1e-10, drag: 0, gravity: [0, -g, 0], solver: 'proximal', forceTolerance: 1e-6}});

// A 4.2 kg ball at the end of the cable.
const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [2, -1, 0], density: 1000, neverSleeps: true});

const coupling = new StructureCoupling(world);
coupling.attachCableToFrame(cable, 0, frame, 8);                       // cable top on the beam tip
const hold = coupling.attachCableToBody(cable, 2, ball, {inertia: {kind: 'sphere', radius: 0.1}});   // cable end on the ball

function fixedStep() {
  coupling.step();                                 // first: steps the cable and the frame, gives the ball this step's force
  world.step();                                    // then the rigid bodies
}
hold.force;                                        // N on the ball: [0, m g, 0] once it hangs at rest
frame.inspect().displacements[6 * 8 + 1];          // tip deflection, m: -(m + m_cable) g L^3 / (3 E I) - w L^4 / (8 E I)
coupling.diagnostics().total;                      // energy of ball + cable + frame, J
```

`attachFrameToBody(frame, node, body, {mode: 'pinned' | 'clamped', inertia})` puts a body on a frame node, and `attachCableToBody` on both ends of a cable makes a tether. The world reports a body's mass but not its rotational inertia, so each body attachment states it (`box`, `sphere`, `capsule`, `principal` or `locked`). Units are SI; the step must be the world's fixed step and equal the cable's and the frame's `dt`; a coupled frame needs `substeps: 1`; create attached bodies with `neverSleeps: true`. The coupling steps the cables and frames it is given.

`test/v11-structure.test.mjs` checks it against closed-form answers: a hanging load (tension, stretch, reaction), pendulum and spring-pendulum frequencies, a tether in zero gravity (momentum), an off-centre attachment (torque), a body on a cantilever tip (deflection and frequency), a simply supported beam, a cable-stayed span carrying a body along its deck, light bodies on stiff structures where naive staggering fails, energy and determinism. Not modelled: contact between bodies and cables or beams, cable bending, frame nonlinearity, and the effect of other contacts or joints on an attached body within a step. The scheme, the measured errors and the limits are in [`docs/STRUCTURE_COUPLING.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/STRUCTURE_COUPLING.md).

### Heat in solids

`HeatSolver` solves heat conduction, `rho c dT/dt = div(k grad T) + q`, on a grid of cells. Each cell has a material, and a mask says which cells are solid, so any voxelised shape works; one cell on an axis makes the problem 1-D or 2-D. Faces can be held at a temperature, given a heat flux, cooled by convection or left to radiate. It is independent of the rigid-body world and needs no WASM.

```ts
import {HeatSolver, thermalShock} from 'box3d-webgpu-kit/heat';

// A wall of brick, insulation and concrete, 20 °C inside and -10 °C outside (in kelvin).
const layers = [{k: 0.7, cells: 10}, {k: 0.04, cells: 5}, {k: 1.4, cells: 15}];   // 10 mm cells
const wall = new HeatSolver({
  nx: 30, ny: 1, nz: 1, dx: 0.01, dy: 1, dz: 1,
  materials: layers.map(layer => ({conductivity: layer.k, density: 1800, specificHeat: 900})),
  material: layers.flatMap((layer, index) => Array(layer.cells).fill(index)),
  temperature: 283.15,
  dt: 60, scheme: 'backward-euler',               // or 'crank-nicolson', or 'explicit'
  boundaries: [
    {face: 'x-', type: 'temperature', temperature: 293.15},
    {face: 'x+', type: 'convection', coefficient: 25, ambient: 263.15},
  ],
});

wall.step(60);                                    // one hour of warming up
wall.solveSteady();                               // or go straight to the steady state
wall.boundaryHeatRate(0);                         // W through the inside face: dT / (sum of L/k + 1/h)
wall.faceTemperature(9, 0, 0, 'x+');              // temperature at the brick-insulation interface
wall.temperature;                                 // Float64Array, one value per cell
```

Units are SI and temperatures are kelvin (degrees Celsius also work when nothing radiates). The implicit schemes are stable at any time step; the explicit one reports its limit (`explicitStabilityLimit()`, `h² / (6 alpha)` inside a uniform 3-D grid) and throws above it. `boundaryEnergy` and `sourceEnergy` add up to the change in `storedEnergy()`, so an energy balance can be audited.

`thermalStrain`, `restrainedThermalStress` and `thermalShock` turn a temperature field into the strain `alpha_T (T - T_ref)`, the stress of a fully restrained bar or plate (`-E alpha_T dT`, divided by `1 - nu` for a plate), and the cells whose tensile stress reaches the strength. They are a one-way estimate for feeding a fracture model, not a thermo-mechanical solver. Not modelled: phase change, fluid flow, radiation between surfaces. The equations, the closed-form validation with measured errors and convergence orders, and the limits are in [`docs/HEAT_TRANSFER.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/HEAT_TRANSFER.md).

### Deformable solids

`SolidBody` is a finite-element solid made of tetrahedra. You give it Young's modulus (Pa), Poisson's ratio and density (kg/m³); it gives back displacements, stresses and reactions in SI units. This example bends a steel cantilever and checks it against a strength:

```ts
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';

const beam = new SolidBody({
  mesh: boxMesh({size: [1, 0.2, 0.2], cells: [20, 4, 4]}),            // metres; four cells through the thickness
  material: {youngModulus: 200e9, poissonRatio: 0.3, density: 7850},  // steel
  config: {model: 'corotational', gravity: [0, -9.81, 0]},
});
beam.constrain(beam.selectNodes(x => x < 1e-9));                              // clamp the face at x = 0
beam.addTraction(beam.selectFaces((cx, cy, cz, nx) => nx > 0.99), [0, -25e3, 0]);  // 1 kN down on the end face (25 kPa × 0.04 m²)

const result = beam.solveStatic();
result.converged;                       // true
result.displacements;                   // x, y, z per node, metres
beam.vonMises();                        // Pa, one per element
beam.failedElements({criterion: 'von-mises', strength: 250e6});   // elements above yield: none here
beam.fundamentalMode().frequency;       // lowest natural frequency, Hz
```

- **Models:** `linear` (small strain), `corotational` (large rotations without false stress, the default) and `neo-hookean` (rubber at large stretch).
- **Dynamics:** `beam.step(n)` with `integrator: 'backward-euler'`, `'midpoint'` (conserves energy for the linear model) or `'explicit'` (refuses a time step above its stability limit; see `explicitLimit()`), with Rayleigh damping.
- **Loads:** fixed or prescribed nodes, point forces, tractions and pressure on boundary faces, gravity, and a temperature rise.
- **Accuracy:** checked against closed-form answers in the repository's `docs/SOLID_MECHANICS.md`. Uniform strain states are exact. Bending needs at least four cells through the thickness: the tip deflection is then 12% low, and 3.4% low with eight. Poisson's ratio above 0.49 locks.
- **Not included:** contact and plasticity. `failedElements` only reports where a strength is exceeded; crack growth is in `box3d-webgpu-kit/fracture` (next section). The solid is not coupled to the rigid-body world two-way; `box3d-webgpu-kit/simulation` has two one-way links into it (temperature from the heat solver, the weight of a rigid body).

### Fracture of solids

`FractureBody` is a tetrahedral solid that cracks. You give it a tensile strength `sigma_c` (Pa) and a fracture energy `G_c` (J/m²). With `model: 'cohesive'` a face that reaches its strength gets a cohesive interface (traction rising to `sigma_c`, then falling linearly to zero at the opening `2 G_c / sigma_c`), and its nodes are duplicated where that separates the elements. This example pulls a concrete bar apart and hands one half to the rigid world:

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {FractureBody} from 'box3d-webgpu-kit/fracture';
import {boxMesh} from 'box3d-webgpu-kit/solid';

const bar = new FractureBody({
  mesh: boxMesh({size: [0.2, 0.05, 0.05], cells: [8, 2, 2]}),               // metres
  material: {youngModulus: 30e9, poissonRatio: 0.2, density: 2400},           // concrete
  fracture: {model: 'cohesive', strength: 3e6, toughness: 100},               // 3 MPa, 100 J/m²
});
bar.constrain(bar.selectNodes(x => x < 1e-9));                               // hold the face at x = 0
const end = bar.selectNodes(x => x > 0.2 - 1e-9);
for (let i = 1; i <= 50; i++) {                                              // you step the load: damage is irreversible
  bar.constrain(end, [i * 2e-6, null, null]);                                // pull the other face, 2 µm at a time
  bar.solveStatic();
  for (const event of bar.takeEvents()) console.log(event.kind, event.face, event.mode);   // 'initiated', 'opened'
}
bar.energy().dissipated;                // J: G_c times the area that opened
const pieces = bar.fragments();         // connected pieces with mass, centre of mass, momentum, inertia
if (pieces.length > 1) {
  const {mass, hullVolume, linearMomentum, ...body} = bar.handOff(pieces[1]);   // one way: the piece leaves the solid
  const world = await createWorld({step: 1 / 240});
  world.createBody(body);               // a hull body with the piece's mass and velocity
}
```

- **Laws:** mixed mode through an effective opening `sqrt(<d_n>^2 + beta^2 |d_s|^2)` (`shearWeight`), damage that never heals (unloading returns to the origin), and a penalty that stops the two sides of a closed crack passing through each other.
- **Where cracks start:** on demand, where the traction on a face reaches its strength; on faces you choose (`insertCohesive`); or as a cut from the start (`precrack`, for a notch). `setInterfaceProperties` makes a weak plane.
- **`model: 'crack-band'`** softens elements instead (largest principal stress), with the softening scaled by element size so that the energy per crack area is `G_c`.
- **Solvers:** `solveStatic()` (one increment per call) and `step()` with `backward-euler`, `midpoint` or `explicit`; `energy()` is a ledger of strain, kinetic, dissipated and external work.
- **In the stepping loop:** `fractureSubsystem(body)` emits crack events, and `thermalSolidLink(heat, body, ...)` lets the heat solver crack the solid; `quenchedPlate()` is a ready thermal-shock example.
- **Accuracy:** checked against closed-form fracture mechanics in the repository's `docs/SOLID_FRACTURE.md`: peak load `sigma_c A` and energy `G_c A` of a bar to 1e-9; Griffith's stress for a pre-cracked plate within 3.5 % on cells of half the characteristic length `E G_c / sigma_c^2` (11.5 % on cells of that length); the work of fracture of a notched beam within half a cell of the ligament.
- **Limits, read these:** cracks can only follow element faces, so a crack inclined to the mesh is too large (2.5 % to 30 % in area and 38 % to 54 % in energy, measured) and its path depends on the mesh. On-demand insertion reads the mean stress of two elements, which misses the peak at a crack tip, so faces that touch a crack front are inserted at `tipInsertionThreshold` (0.4) of their strength: on the centre-cracked plate that gives the failure load of a pre-inserted path within 1 % on cells of `l_ch` and `l_ch / 2`, where insertion at the strength held 1.6 times the Griffith stress. It is checked on that case only. Small strain only, no plasticity, no friction, and no contact between fragments: hand them to the rigid world, which is one-way.

### Deformable solids in contact with rigid bodies

`SolidCoupling` lets a `SolidBody` collide with boxes, spheres, capsules and planes of the world, rest on them, carry them, and be welded to them. The solid is stepped by backward Euler with each dynamic body as six unknowns of the same solve, so the stiffness of the solid and the mass of the body can differ by any factor. This sets a box on a rubber pad:

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';
import {SolidCoupling, solidContactSubsystem} from 'box3d-webgpu-kit/solid-contact';
import {createSimulation} from 'box3d-webgpu-kit/simulation';

const world = await createWorld({step: 1 / 240, subSteps: 4, ground: false});
const pad = new SolidBody({mesh: boxMesh({size: [0.2, 0.05, 0.2], cells: [4, 2, 4]}),
  material: {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt: 1 / 240, massDamping: 5}});
pad.constrain(pad.selectNodes((x, y) => y === 0));                       // hold the base
const half = [0.1, 0.05, 0.1];
const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0.1, 0.1, 0.1], density: 800, neverSleeps: true});
const coupling = new SolidCoupling(world, pad);
coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, friction: 0.5});   // say what the body is: the world cannot report shapes
const sim = createSimulation(world).add(solidContactSubsystem(coupling));
for (let i = 0; i < 480; i++) sim.step();
coupling.force(box);   // [0, m g, 0]: the pad carries the box
```

`coupling.weld(nodes, body)` fixes solid nodes to a body. `SolidContact` is the same solver without a world, with its own float64 bodies and a `solveStatic()`. Measured against closed forms: a block on a pad to 1e-11 in uniaxial stress and in uniaxial strain, friction switching at tan θ = μ (sliding acceleration within 0.4 %), a block on a column at the frequency of a bar with a tip mass (−0.14 %), momentum in an impact to 1e-12, and a 4 g body at rest on steel where naive staggering throws it off in one step. Limits: Hertz contact is 7 % to 16 % too stiff on meshes of 2.5 to 5 linear tetrahedra per contact radius; only the solid's nodes are tested against the bodies; no hulls, meshes or height fields; no contact between two solids; backward Euler only. See `docs/SOLID_CONTACT.md` in the repository.

### Cloth with real material parameters

`Cloth` is a triangle mesh with an areal density (kg/m²), Young's modulus (Pa), a thickness (m) and Poisson's ratio. `ClothCoupling` lets it collide with bodies of the world, rest on them, be attached to them and push them. This drops a ball on a sheet held along its edges:

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {Cloth, ClothCoupling, clothGrid, clothSubsystem} from 'box3d-webgpu-kit/cloth';
import {createSimulation} from 'box3d-webgpu-kit/simulation';

const world = await createWorld({step: 1 / 240, subSteps: 4, ground: false});
// A 1 m square sheet, 10 x 10 cells, held along its edges at y = 0.
const grid = clothGrid({nx: 10, ny: 10, u: [1, 0, 0], v: [0, 0, -1], origin: [-0.5, 0, 0.5]});
const edge = [];
for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) if (i % 10 === 0 || j % 10 === 0) edge.push(grid.node(i, j));
const cloth = new Cloth({
  positions: grid.positions, triangles: grid.triangles, pinned: edge,
  material: {arealDensity: 0.3, youngModulus: 5e6, thickness: 1e-3, poissonRatio: 0.3,   // kg/m², Pa, m
    bendingStiffness: 1e-3},                                                              // N m; default E t³ / (12 (1 − ν²))
  config: {dt: 1 / 240, gravity: [0, -9.81, 0], drag: 2},
});

const ball = world.createBody({shape: {kind: 'sphere', radius: 0.35}, position: [0, 0.6, 0], density: 15, neverSleeps: true});
const coupling = new ClothCoupling(world, cloth);
coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.35}, friction: 0.3});   // say what the body is: the world cannot

const sim = createSimulation(world).add(clothSubsystem(coupling));                 // or: coupling.step(); world.step();
sim.onEvent(e => { if (e.source === 'cloth') console.log(e.tick, e.type); });      // contact-begin, contact-end, unconverged
for (let i = 0; i < 4 * 240; i++) sim.step();

coupling.force(ball);          // N: what the cloth does to the ball; the ball's weight once it rests
cloth.totalReaction();         // N: what the supports carry; cloth + ball once they rest
cloth.positions;               // Float64Array, xyz per node, for drawing
cloth.stats.unconvergedSteps;  // steps that stopped at the iteration limit
```

- **Material:** constant-strain triangles with the St. Venant–Kirchhoff law (so Poisson's ratio is real: 0.3002 when asked for 0.3, where edge springs give whatever the mesh dictates) and plate bending with `D = E t³ / (12 (1 − ν²))` or a stiffness you state. Fabric bends more easily than a plate of its thickness: measure it and set `bendingStiffness`.
- **Integration:** backward Euler solved by Newton's method to a force tolerance, so stiffness does not depend on an iteration count. `integrator: 'midpoint'` conserves energy for smooth problems without contact. `solveStatic()` finds equilibria.
- **Supports and loads:** `pinned`, `pin(node, position)`, gravity, `setNodalForce`, `setPressure` (inflation) and `setWind` (a normal-pressure formula, not aerodynamics). `cloth.reactions` holds the support forces.
- **Bodies:** `coupling.addBody(body, {shape, friction})` for boxes, spheres and capsules, `coupling.addPlane({normal})` for a ground, `coupling.attach(node, body)` for a flag on a pole or a load on a hammock. Each dynamic body is an unknown of the cloth's own solve, so a 40 g box on a stiff strip is stable where handing forces back and forth overflows. Call `coupling.step()` immediately before `world.step()`, or register `clothSubsystem(coupling)` with a `Simulation`.
- **Self-collision:** `selfCollision: {thickness}` keeps layers a thickness apart by point-triangle and edge-edge repulsion.
- **Accuracy:** `test/v16-cloth.test.mjs` checks it against closed-form answers; the repository's `docs/CLOTH.md` has the table. Second order on structured meshes: a cantilever's tip is 0.08% off with 32 elements, a tensioned strip's frequency 0.05%, a pressurised membrane 0.1%.
- **Limits, measured:** about 100 nodes in real time on one thread (a 17 × 17 sheet takes 9 ms per 1/240 s step). Bending does not converge on irregular meshes (4% off with nodes jittered by a quarter of a cell): use structured ones. Contact is node against body, so the mesh must be finer than the bodies, and hulls, meshes and height fields are not supported. Self-collision is a repulsion, not a guarantee against intersection. No tearing, no anisotropy.

### Grains: sand, beads and silos

`Granular` is a discrete element solver: spheres that overlap slightly where they touch, with a contact law, friction and rolling resistance. This fills a silo, opens it and counts what flows out:

```ts
import {Granular, granularLattice} from 'box3d-webgpu-kit/granular';

const d = 0.01, radius = 0.075;                                     // 10 mm beads, a silo 15 beads wide
const material = {density: 2500, restitution: 0.3, friction: 0.5, rollingFriction: 0.02};
const law = {law: 'linear', normalStiffness: 5e3};                  // or the default 'hertz' with youngModulus and poissonRatio
const beads = granularLattice({min: [-radius, 0, -radius], max: [radius, 0.24, radius], radius: [0.45 * d, 0.55 * d], jitter: 1, gap: 0,
  inside: (x, y, z) => Math.hypot(x, z) < radius - 0.6 * d});

const g = new Granular({material, config: {...law, dt: 1.1e-4, capacity: beads.count,           // dt: at most g.maxTimeStepFor(radius)
  bounds: {min: [-1, -0.03, -1], max: [1, 10, 1]}}});                                           // beads below the silo are removed
const floor = g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}});                           // closed while filling
g.addWall({shape: {kind: 'annulus', innerRadius: 3 * d, outerRadius: radius + d}});             // a floor with a 6 d orifice
g.addWall({shape: {kind: 'cylinder', radius, from: 0, to: 1}});
g.addGrains(beads.positions, beads.radii);

g.step(4000);                    // pour and settle
g.setWallEnabled(floor, false);  // open
g.step(4000);
g.stats.removedMass;             // kg discharged
g.wallForce(1);                  // N on the orifice plate
g.positions; g.radii;            // for drawing
```

With a rigid world: `const coupling = new GranularCoupling(world, g); coupling.addBody(body, {shape: {kind: 'box', halfExtents}});` then `coupling.step(); world.step();` each step, or `createSimulation(world).add(granularSubsystem(coupling))`. The world's step must be a whole number of grain steps. `coupling.force(body)` is what the grains do to the body: its weight once it rests on them.

- **Contact:** Hertz with Mindlin's tangential stiffness, or linear springs. The dashpot is solved so that the restitution is the one you set, at any impact speed. Friction keeps a tangential spring per contact, so piles stand; `rollingFriction` makes them stand steeper, as angular grains do.
- **Time step:** it must be a fraction of the contact time, typically 1e-4 s for soft centimetre beads and far less for stiff or small ones. The solver refuses a step above its limit (`UNSTABLE_TIME_STEP`) and tells you the largest it accepts.
- **Walls:** planes, boxes, spheres, capsules, cylinders, rings with a hole, cones; fixed, moving or with mass. Each reports the force on it.
- **Accuracy:** `test/v17-granular.test.mjs` checks it against closed-form answers; the repository's `docs/GRANULAR.md` has the table. Hertz contact duration to 1e-5, restitution to 1e-3, sliding and rolling on an incline, an energy ledger that closes to 0.12% of the energy dissipated, a block on a bed carried to 7e-7 of its weight.
- **Limits, measured:** about 2 million grain-steps per second on one thread, which is 100 to 250 soft 10 mm beads in real time. Spheres only. Janssen's saturation and Beverloo's 5/2 law come out in form, with constants that are not the textbook ones. Create coupled bodies with `neverSleeps`.

### Fluid in a volume: drag, wakes and splashes

`Fluid` solves incompressible flow on a grid of cubic cells. This fills a 10 cm tank with an oil, slides its lid, puts a fixed post in it and drops a steel ball of the rigid world into it:

```ts
import {Fluid, FluidCoupling, fluidSubsystem} from 'box3d-webgpu-kit/fluid';
import {createSimulation} from 'box3d-webgpu-kit/simulation';

const fluid = new Fluid({cells: [24, 24, 24], spacing: 0.1 / 24, density: 1260, viscosity: 1.4,   // SI: kg/m^3, Pa s
  dt: 1 / 240, gravity: [0, -9.81, 0], diffusion: 'backward-euler',                               // implicit viscosity: no viscous step limit
  boundaries: {yMax: {type: 'no-slip', velocity: [0.05, 0, 0]}}});                               // other sides: still walls
const post = fluid.addObstacle({shape: {kind: 'cylinder', radius: 0.01, halfLength: 0.03}, position: [0.05, 0.03, 0.05], rotation: [0.7071068, 0, 0, 0.7071068]});
fluid.setPressure((x, y) => 1260 * 9.81 * (0.1 - y));                                           // start at rest, hydrostatic

const ball = world.createBody({shape: {kind: 'sphere', radius: 0.01}, position: [0.05, 0.07, 0.05], density: 7800, neverSleeps: true});
const coupling = new FluidCoupling(world, fluid);                                                // world step = whole number of fluid steps
coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.01}});
const sim = createSimulation(world).add(fluidSubsystem(coupling));
sim.step();
fluid.velocityAt(0.05, 0.09, 0.05);  // m/s, interpolated
fluid.obstacleForce(post);            // N on the post (pressure, viscous stress, buoyancy)
coupling.force(ball);                 // N the fluid put on the ball over the last step
```

Sides are `'no-slip'` (a wall, moving along itself if you give it a velocity), `'free-slip'`, `'inflow'` (a velocity, constant or a function of position), `'outflow'` (p = 0) or `'periodic'`. One cell along z with periodic z sides makes a 2D flow. `FreeSurfaceFluid` is a closed tank of liquid particles with a free surface: `tank.addLiquid((x, y) => x < 0.08 && y < 0.12); tank.step(50); tank.positions`.

- **Method:** pressure on cell centres, velocities on faces, a projection solved by conjugate gradients with an incomplete-Cholesky preconditioner; second-order central advection (or first-order `'upwind'`); viscosity explicit, Crank–Nicolson or backward Euler. Float64 and deterministic.
- **Obstacles and bodies:** spheres, boxes, capsules and cylinders, fixed or moving. Each reports the force and torque of the fluid on it. A coupled body is moved by that force, and what the body gets the fluid loses, to round-off.
- **Time step:** with explicit viscosity at most `h^2 / (2 d nu)`; the Courant number must stay below `cflLimit` (1). A step above either is refused (`UNSTABLE_TIME_STEP`); `fluid.maxTimeStep()` gives both. The coupling is explicit: keep the rigid step below the body's response time (about `m / (6 pi mu r)` for a sphere).
- **Accuracy:** `test/v18-fluid.test.mjs` checks it against closed forms and published data; the repository's `docs/FLUID.md` has the table. The lid-driven cavity within 0.8% (Re 100) and 1.5% (Re 400) of Ghia et al. on the centre lines, Taylor–Green decay at second order, water at rest to round-off, a sphere's drag 7.5% low at 2.4 cells per radius and 3.3% at 3.6, a dam break within 7.4% of Martin & Moyce, sloshing frequency within 0.5%.
- **Limits, measured:** about 0.3 to 0.9 million cell-steps per second on one thread (a 16³ grid in 5 ms, 32³ in 53 ms), so about 10,000 cells per 60 Hz frame. No turbulence model. The free surface has no viscosity, surface tension or bodies.

### Materials with sources

`box3d-webgpu-kit/materials` holds engineering materials in SI units. Every value has the conditions it holds for (grade, temper, temperature, moisture), the figure as read in its source, and a citation (`MATERIAL_SOURCES`, all opened and read); values no source gave are marked unverified and refused unless you pass `allowUnverified: true`.

```ts
import {solidMaterial, fractureLaw, heatMaterial, grainMaterial, contactPair, rigidMaterial, materialValue} from 'box3d-webgpu-kit/materials';

const beam = new SolidBody({mesh, material: solidMaterial('structural-steel-s355')});   // E 210 GPa, nu 0.3, 7850 kg/m3, alpha 12e-6
const pane = new FractureBody({mesh, material: solidMaterial('soda-lime-glass'), fracture: fractureLaw('soda-lime-glass')});
const bar = new HeatSolver({nx: 50, ny: 1, nz: 1, dx: 0.002, dy: 1, dz: 1, materials: [heatMaterial('copper-c11000')], temperature: 293.15, dt: 0.01});
const beads = new Granular({material: grainMaterial('glass-beads'), config: {dt: 1e-6, capacity: 1000}});
world.createBody({shape, ...rigidMaterial('structural-steel-s355')});                    // density, friction 0.6 (static), restitution 0.56
contactPair('ptfe', 'structural-steel-s355');                                            // {staticFriction: 0.04, kineticFriction: 0.04, ...}
materialValue('aluminium-6061-t6', 'fractureToughness');                                 // {value: 29e6, conditions: 'T6, TL orientation', source: 'asm-6061-t6', read: '29 MPa-m^1/2 ...'}
```

- **What it is:** 21 materials, 31 contact pairs, 208 values; 6 unverified. Sources range from standards and NIST data to manufacturers' typical values; 24 values come from The Engineering ToolBox or Webmineral and say so. The repository's `docs/MATERIALS.md` has every value, its source and how it was converted.
- **Choices you should know:** `fractureLaw` converts K_IC to G_c in plane strain unless you pass `state: 'plane-stress'`. `contactPair` and `rigidMaterial` give the static friction coefficient by default (`use: 'kinetic'` for sliding problems); Box3D mixes two bodies as sqrt(f_a f_b) and max(e_a, e_b). Poisson's ratio is capped at 0.4999 for the solvers. Wood is stored along the grain.
- **Accuracy:** `test/v18-materials.test.mjs` and the repository's `materials` validation domain run the solvers with library values against closed forms (a bar in tension to 1e-9, a copper bar's cooling time constant to 4e-4, Hertz contact durations to 2e-5, a cracked glass plate within 5%, steel sliding and bouncing in the rigid world). They check that the values reach the solvers correctly, not that the values are right.

### One stepping loop for every solver

`box3d-webgpu-kit/simulation` replaces "call `water.step()` immediately before `world.step()`, and the structure coupling before that" with one object that knows the order. Register the solvers in any order; each one states the stage it runs in and the time step it needs, and a solver that does not fit the world's step is refused when it is registered.

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {createSimulation, waterSubsystem, structureSubsystem, heatSubsystem, solidSubsystem, thermalSolidLink} from 'box3d-webgpu-kit/simulation';

const world = await createWorld({step: 1 / 240, ground: false});
const sim = createSimulation(world)
  .add(waterSubsystem(water))                            // a WaterCoupling
  .add(structureSubsystem(coupling, {bodies}))           // a StructureCoupling and the bodies attached to it
  .add(heatSubsystem(heat)).add(solidSubsystem(solid))   // a HeatSolver and a SolidBody
  .add(thermalSolidLink(heat, solid, {reference: 300})); // heat -> solid thermal strain, one-way

sim.step();                    // or sim.update(frameSeconds). Do not call world.step() yourself.
sim.order();                   // couple: structure, water -> rigid: world -> post: heat, link, solid -> events
sim.energy();                  // one ledger: an entry per solver, mechanical and thermal totals
sim.onEvent(e => {}); sim.onStep(tick => {});
```

A scene file can describe a coupled scene, and loading it gives a ready Simulation:

```ts
import {loadScene, sceneWorldOptions, mooredBuoyScene} from 'box3d-webgpu-kit/scene';

const scene = mooredBuoyScene();                       // a buoy in a basin, moored to the bed by a cable
const world = await createWorld(sceneWorldOptions(scene));
const {simulation, bodies, cables, attachments} = loadScene(world, scene);
for (let i = 0; i < 8 * 240; i++) simulation.step();
attachments.get('mooring:0').force;                    // the cable's pull on the buoy: buoyancy minus weight
```

- **Order.** `prepare` on everything, then the stages `pre-couple`, `couple` (structure, then water), the rigid step, `post` (heat, links, solids), then events and `onStep`. Inside a stage: by `order`, then by `id`.
- **Bit-identical.** The Simulation adds no numerics. A run through it gives exactly the bits of the same modules driven by hand in that order; `test/v14-simulation.test.mjs` proves it for each adapter alone and for water, structure, heat and a solid together.
- **Time steps.** The water and structure couplings must step with the world. Heat and solids may also take N of their own steps per world step, or one every N world steps; an explicit one must be within its stability limit. Anything else throws an `EngineError` that says which rule failed.
- **Links, both one-way.** `thermalSolidLink` (the heat solver's temperature becomes a solid's thermal strain; the two grids must be the same boxes) and `deadLoadLink` (a rigid body's weight on solid nodes). Nothing flows back.
- **Your own solver.** Anything with `{id, kind, stage, timeStep, step(ctx)}` can be registered; `prepare`, `finish`, `energy`, `diagnostics` and `dispose` are optional.
- **Coupled across modules:** a rigid body collides with a deformable solid through `box3d-webgpu-kit/solid-contact` (node against body; two solids do not collide). A floating body on a cable is solved with the water's force in the cable's interface solve (`linkWaterToStructure(water, structure)`, which `loadScene` calls): on the moored buoy the tension is right to 0.001 N of 1338 N and the draught to 0.5 µm, where they were 0.73 N and 0.4 mm off; the hydrostatic stiffness is not in that solve, and a floating body on a frame is unchecked. **Not in the loop:** rope contact, granular media, GPU water and the app's own cloth. See the repository's `docs/SIMULATION.md` for the contract, the measured numbers and the limits.

### No build step

`box3d-webgpu-kit/single` (`dist/single.js`) is the whole core plus the WASM in one ES module, 652 KiB raw or 265 KiB gzipped. Put it on any static host or CDN and `import {createWorld} from './single.js'`; there are no other files to resolve. It produces bit-identical results to the regular build. Prefer the regular entry when you have a bundler: it is smaller and the WASM is fetched and compiled in parallel.

### Pose arrays for ECS engines

```ts
readPoses(world, {positions, rotations, halfExtents});      // structure-of-arrays for every body row
packPoses(world, compact);                                    // 7 floats (28 bytes) per body: position + quaternion
readBodyPoses(world, entityBodies, {positions, rotations});  // in your entity order, skipping destroyed bodies
```

Handles are BigInt-based. Measured on Node 26, resolving a handle costs about 32 ns per body, and reading a pose by handle about 80–100 ns. Reading by row with `matrices()` or `readPoses` costs about 1 ns. For 10,000 bodies per frame, handle lookups add about 0.3 ms. Use row reads for bulk rendering and handles for gameplay. `npm run bench:handles` reproduces the numbers.

### Several worlds, one module

```ts
import {loadBox3D, PhysicsWorld} from 'box3d-webgpu-kit';
const pool = await loadBox3D();                      // pool.capacity === 16
const server = new PhysicsWorld(pool).resetArena();
const predicted = new PhysicsWorld(pool).resetArena();
```

Worlds are isolated. Running identical inputs on the same build produces bit-identical float32 transforms, across worlds and after `resetArena()`, and the test suite checks this. `replayHash()` is a cheap desync detector: an FNV hash of every transform quantized to 1 mm.

## Loading, integrity and failures

- **Integrity:** `createWorld({integrity: true})` hashes the WASM bytes and refuses to run a file that differs from the one this package was built with (`INTEGRITY_MISMATCH`). Use it when serving the WASM from a CDN. It needs `crypto.subtle`, so the page must be served over HTTPS or from localhost. `BUILD_INFO` exposes the shipped build's identity (Box3D ref and commit, Emscripten version, SHA-256 values); put it in bug reports next to replay logs.
- **Failures:** anything that stops the WASM from loading throws `EngineError('WASM_UNAVAILABLE')`, with the original error as `cause`. The kit never swaps in a different physics implementation behind your back. Call `detectEnvironment()` first to explain missing WebAssembly, SIMD or WebGPU to a player.
- **Content-Security-Policy:** the WASM glue and the kit use no `eval` or `new Function`. `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'` is enough. `examples/csp/` verifies it in a browser, including an integrity-checked load and a module Worker.

## Loading the WASM

By default the loader resolves `wasm/box3d.js` and `wasm/box3d.wasm` through `new URL(..., import.meta.url)`. Vite's production build detects this pattern and emits hashed assets (tested). webpack 5 and Rollup document the same pattern but have not been tested. In Node, the file is read directly. You can override any part:

```ts
await createWorld({wasmUrl: '/static/box3d.wasm', moduleUrl: '/static/box3d.js'});
await createWorld({wasmBinary: await (await fetch(url)).arrayBuffer()});
```

In the Vite dev server (not yet tested), add `optimizeDeps: {exclude: ['box3d-webgpu-kit']}` so pre-bundling does not move the module away from its `wasm/` folder.

## Current limits (read before designing gameplay)

- **Shapes:** box, sphere, capsule or convex hull on any body, or up to 64 of them as one compound; triangle mesh or height field on static bodies, never in a compound. A compound has one colour, one filter and one set of flags, and events and queries name the body. `createShapeMeshes` draws boxes, spheres and capsules; a hull, mesh, terrain or compound row is an unscaled transform that it draws as a unit box, so draw those with your own geometry and the row's matrix (for a compound, each child at its local pose).
- **Two scene styles.** `createWorld()` / `resetArena()` / `loadPreset()` give the classic arena: gravity −10 m/s², `spawnBox` cubes with a small seeded spin. `createWorld({gravity})` / `reset()` give an SI world (9.81 m/s²) that you fill with `createBody` and `createJoint`. Both run on the same solver.
- **Recording an SI world:** `startRecording({world: {gravity}})` starts from an empty SI world and logs every mutating call, including `createBody`, `createJoint` and the setters. Mesh and terrain geometry is stored in the log, so large scenery makes large logs. A joint created before recording began cannot be used while recording.
- **Network snapshots carry transforms only**, as before; they do not describe shapes or joints.
- **No contact-end for destroyed bodies.** Box3D reports no `contact-end` for what a destroyed body was touching; treat `destroyBody()` as the signal.
- **Solver state cannot be saved.** `saveSession` stores a replay log and `loadSession` replays it. `saveScene` (`box3d-webgpu-kit/scene`) stores how to build the scene plus each body's pose and velocity; it resumes from that state but not bit for bit.
- **Single-threaded.** Each world steps synchronously on its thread. Use `box3d-webgpu-kit/worker` to move that thread off the renderer.
- **Interpolation pauses for one step after a destroy, a reset or `setTransform`**, because rows move or jump. New bodies interpolate normally.
- Default capacity is 4,096 bodies per world; `createWorld({capacity})` raises it up to 65,536. The bridge buffers take 136 bytes per body slot.

  Measured WASM heap (Node, one world, 0.6 m cubes spread on the ground):

  | Capacity | Bodies | Heap |
  |---:|---:|---:|
  | 4,096 | 1 | 16.9 MB |
  | 4,096 | 4,001 | 16.9 MB |
  | 16,384 | 16,001 | 35.4 MB |
  | 65,536 | 65,001 | 127.1 MB |

  WebAssembly memory never shrinks, so plan mobile budgets around the peak.

The remaining bridge gaps are tracked in [`docs/ROADMAP.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/ROADMAP.md).

## Low-level access

`world.native` is the underlying `NativeWorldBackend`, which exposes `queryBatch`, `capacityInfo`, `bodyHandle(index)`, `applyImpulse(index)`, `spawnRain` and so on. `NativeWorldPool`, `NativeWorldBackend` and every query type are exported too. Errors are `EngineError`s with a stable `code` (`STALE_BODY`, `WORLD_CAPACITY`, `INVALID_PAYLOAD`, `DISPOSED`, `UNSUPPORTED_BACKEND`, …).

## Determinism across runtimes

`npm run matrix` runs one scripted session under every JavaScript runtime installed on the machine. It never installs one. On the development Mac (arm64), Node 26, Node 22 and Bun 1.3 produce the same `exactHash()`, and so does a Chromium Web Worker for a separate session. Bun runs on JavaScriptCore rather than V8, so this is agreement between two different WebAssembly engines on one machine. x64 and other browsers have not been measured.

## Examples

- `examples/three-falling-boxes.html` — three.js, with picking and recycled projectiles.
- `examples/worker/` — a worker-hosted scene.
- `examples/csp/` — strict Content-Security-Policy.
- `examples/node-headless.mjs` — a headless loop with replay.
- `examples/server/` — an authoritative room server (Node, loopback only) and a thin browser client that decodes snapshots.

## Attribution

Include `LICENSE_NOTICE` (exported as a string) in your credits or third-party notices. Box3D is MIT licensed by Erin Catto, and this kit is MIT licensed.

## Development

The package source of truth stays in the app. `npm run build` does the following:

- copies `src/engine/native-world.ts` and `contracts.ts` into `src/core/` (generated, git-ignored) and rewires two app-only type imports;
- copies `public/box3d/*` into `wasm/`;
- refuses to continue if the WASM or glue bytes differ from `BUILD_PROVENANCE.json`;
- generates `BUILD_INFO`, then compiles.

`src/backend-types.ts` is a hand-kept mirror of the app's `PhysicsBackend` type and is not covered by the drift test.

```bash
npm test            # build + 58 tests (including the app's own cable/water/frame suites run against the package)
npm run test:pack   # size budgets, tarball install, TypeScript consumer, and all three templates (Vite build included)
npm run api         # regenerate api/public-api.txt and api/API.md after an intended API change
npm run matrix      # same session under every installed runtime; fails if any disagree
npm run bench:handles  # handle vs row read costs
node examples/node-headless.mjs   # headless 60 Hz loop with stats and a verified replay
```
