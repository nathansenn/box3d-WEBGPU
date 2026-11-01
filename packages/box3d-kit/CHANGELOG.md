# Changelog

## Versioning policy

- The kit follows semver for its **JavaScript API**. `api/public-api.txt` is the reviewed surface; `npm test` fails when it changes without being regenerated.
- The **WASM** is identified by `BUILD_INFO`: the upstream Box3D ref and commit, the Emscripten version, the bridge source SHA-256 and the `box3d.wasm` SHA-256. Any change to the WASM is at least a minor release, because replay logs and `exactHash()` values are only comparable on the same WASM.
- The native world ABI version (`NATIVE_WORLD_API_VERSION`, currently 1) must match the loaded module; a mismatch fails loudly with `UNSUPPORTED_BACKEND`.
- Before 1.0, minor versions may change the API; the changes are listed below.

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
