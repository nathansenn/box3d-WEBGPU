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
| `box3d-webgpu-kit/frame` | 3D beam and column frames: statics, dynamics, end reactions. For structures that bend. |
| `box3d-webgpu-kit/gameplay` | Trigger volumes and a kinematic character controller for the rigid-body world (see above). |

Cable, water and frame are the same model code the Box3D WebGPU app runs; the build copies it from the app. The app's own test suites (46 tests: 11 cable, 11 proximal cable, 2 linear water, 6 closed water, 16 frame) run against the packaged copies in `npm test`. They are independent of the rigid-body world; coupling them (for example buoyancy, or ropes attached to bodies) needs the native events and pose setters listed under limits. The WebGPU water solver is not packaged yet.

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

The native bridge exposes only what the Box3D WebGPU app needed. Specifically:

- **Cubes only.** Dynamic bodies are cubes from `spawnBox`. The bridge gives each one a small random spin (up to 0.2 rad/s) from the world's seeded RNG, so results stay deterministic. Half sizes of 0.05 or less are replaced with 0.8. The only static body is the 88 m × 88 m ground. Preset scenes (`loadPreset(0..799)`) contain other box sizes. There are no spheres, capsules, meshes, heightfields or joints.
- **No pose/velocity setters, gravity control, collision filters on bodies, or native contact/trigger events.** Queries accept filters, but every body uses the default filter. `box3d-webgpu-kit/gameplay` builds triggers and a character controller from queries and impulses; they cannot report contact forces or make a body kinematic.
- **Single-threaded.** Each world steps synchronously on its thread. Use `box3d-webgpu-kit/worker` to move that thread off the renderer.
- **Interpolation pauses for one step after a destroy or reset**, because destroying a body moves the last instance row into the freed slot. New spawns interpolate normally.
- Default capacity is 4,096 bodies per world; `createWorld({capacity})` raises it up to 65,536. The bridge buffers take 136 bytes per body slot.

  Measured WASM heap (Node, one world, 0.6 m cubes spread on the ground):

  | Capacity | Bodies | Heap |
  |---:|---:|---:|
  | 4,096 | 1 | 16.9 MB |
  | 4,096 | 4,001 | 16.9 MB |
  | 16,384 | 16,001 | 35.4 MB |
  | 65,536 | 65,001 | 127.1 MB |

  WebAssembly memory never shrinks, so plan mobile budgets around the peak.

Closing these gaps needs new exports in `wasm/box3d_web.c` and a rebuild. They are the top P0 items in [`docs/INTEGRATION_100.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/main/docs/INTEGRATION_100.md).

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
