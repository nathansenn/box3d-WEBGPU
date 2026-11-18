# Independent native worlds

The native artifact now supports **16 independent world contexts in one Emscripten module**, plus the original compatibility world. Each context owns its body table, transform/color streams, random seed, hull cache, replay hash and stream revisions. Creating, resetting, stepping or destroying one context leaves the others intact.

This completes the bounded isolation acceptance for roadmap item **26**. Pthread execution now exists only as a separately selected artifact, `box3d-mt` (see [Threaded engine](THREADED_ENGINE.md)); `loadNativeWorldPool` does not use it, and full native checkpoints remain separate work. Generation-checked body references are now implemented; see [Native body lifetime](NATIVE_BODY_LIFECYCLE.md). Each world starts at **4,096 bodies**, can now explicitly reserve up to **65,536**, and executes synchronously on its calling thread. See [Native capacity](NATIVE_CAPACITY.md) for the separately qualified growth API and dense-workload timings.

## Browser API

```ts
import { loadNativeWorldPool } from '../src/physics/wasm';

const pool = await loadNativeWorldPool();
const a = pool.createWorld();
const b = pool.createWorld();

try {
  a.createScene({ id: 0 }, 1, 42);
  b.createScene({ id: 0 }, 1, 99);
  a.kick(2);
  b.kick(18);

  // Both worlds use the existing PhysicsBackend / InstanceBufferSource API.
  a.step(1 / 60, 4);
  b.step(1 / 60, 4);
  renderer.uploadInstances(a, a.bodyCount());

  b.clear(); // Retains B's context, buffers and handle; A is untouched.
  b.createScene({ id: 150 }, 1, 123);
} finally {
  pool.destroy(); // Releases only the worlds created by this pool.
}
```

For an already instantiated Emscripten module, import `NativeWorldPool` or `NativeWorldBackend` from `src/engine/native-world.ts` (also exported by `src/engine/index.ts`). The adapter requires world ABI version 1 and validates required exports and stream bounds before returning a world. The browser loader creates one module per call; create several worlds from the same returned pool to share that module.

`pool.capacity` is the module-wide context limit, not the number of currently free slots. `pool.size` is this pool's owned-world count. Other pools and direct native callers share the same 16 slots. The old `loadWasmPhysicsBackend()` continues to use the separate compatibility world and preserves the original ABI.

## Lifetime and input rules

- World handles are **module-local uint32 values** with a 5-bit slot and 27-bit generation. Destruction advances the generation. Exhausting it retires the slot instead of wrapping to a previously valid handle. Raw handles must not be transferred between modules or persisted as checkpoints.
- `destroy()` is idempotent. Access through a destroyed or stale JavaScript world throws `EngineError` with code `DISPOSED`. Raw C calls reject stale handles without mutating a replacement world. These are world handles. Stable body references are available through the separate lifecycle extension; numeric dense row indices remain mutable after body removal.
- `HEAPF32` is borrowed memory. Read the getter again after any operation that may grow module memory. Stream offsets can relocate during an explicit capacity reservation; ask the pointer getters again afterward. A destroyed context's storage can be reused. Copy arrays when data must outlive the world. The renderer already keys uploads on source, heap, offsets, counts and revisions; switching worlds invalidates both streams even when their counts/revisions match.
- The adapter checks finite float32-compatible inputs, scene IDs 0–799, uint32 seeds, timesteps above zero and at most 1/30 second, and 1–16 substeps. Use integer stress scales from 1–5. A zero-count `spawnRain` request is a no-op. Invalid inputs are rejected before native mutation. Projectile launch arguments retain the previous bridge's impulse semantics.
- Context creation reports `WORLD_CAPACITY` when no slot is free and `ALLOCATION_FAILED` if the context-buffer allocation fails. The capacity extension also makes bridge buffer growth fallible and transactional; it does not make every upstream Box3D allocation recoverable.
- The registry is single-threaded. Independent, interleaved simulations are supported; simultaneous calls from threads sharing the same module are not qualified.

## Isolation qualification

The results below identify the preceding isolation artifact. The capacity-only artifact repeats that acceptance in `runs/native-capacity-worlds-20260910-01/`. The latest body-lifecycle artifact repeats it in `runs/native-recycling-worlds-20260910-02/`; its additional generation tables increase the shared sixteen-world capacity to 29.4375 MiB, versus 271 MiB across sixteen original modules. Both historical and current measurements are retained. Growth and body-lifecycle evidence are documented separately.

`benchmarks/results/engine-100x/runs/native-worlds-20260910-02/` contains frozen old/new artifacts, C/TypeScript inputs, harness, protocol and raw results. The first run remains preserved; the second freezes the final whitespace-clean C source. Their compiled JS/WASM bytes are identical.

| Check | Result |
| --- | --- |
| All 800 recipes, 12 ticks plus initial state, varying seeds/stress and five actions | 20,800 exact comparisons for compatibility and isolated worlds against the old artifact |
| 16 populated contexts, 120 interleaved ticks each | 1,920 exact comparisons against 16 independent old modules |
| Another world's reset, seed change, clear, destruction and slot reuse | Surviving streams, hashes and revisions unchanged |
| Lifecycle checks | 10,000 empty context lifecycles and 256 populated cycles after 32 warmups; stale handles rejected |
| Populated churn memory capacity | Stable 17,760,256-byte WASM heap after warmup |
| Forced WASM heap growth | Fresh borrowed views, stable live offsets and unchanged state |
| Metal renderer | Exact pixels after returning to a world, using copied streams, growing the heap and destroying a sibling; zero uncaptured GPU errors |
| Reproducible native build | Two independent build directories produced identical JS/WASM bytes |
| Legacy native soak | 800 recipes replayed twice, invalid-timestep and action checks passed, maximum 4,096 bodies |

The 16-world experiment used **25,690,112 bytes (24.5 MiB)** of shared WASM linear-memory capacity, compared with **284,164,096 bytes (271 MiB)** summed over sixteen old modules: an **11.06× capacity ratio**. The new module also held a populated compatibility world during the experiment. This measures `HEAPF32.byteLength`, not resident RAM, allocation rate, browser memory, frame speed or parallel throughput. The result does not establish an engine-wide 100× gain.

The local browser probe loaded the public artifact through `loadNativeWorldPool()`, displayed both worlds and a second camera view, reset/destroyed/recreated B while A's hash and revisions stayed unchanged, then advanced both again. Replacing B changed its handle from 34 to 66. The temporary tab was closed after inspection. This is Mac browser validation, not a physical-phone or calibrated-physics test.

Recheck the frozen experiment without rewriting it:

```sh
node scripts/native-world-check.mjs \
  --run benchmarks/results/engine-100x/runs/native-worlds-20260910-02

node --test tests/engine/native-world.test.mjs tests/engine/native-provenance.test.mjs
npm run test:native-wasm
```

Run another exact comparison into a new directory:

```sh
node scripts/native-world-qualify.mjs \
  --baseline-root benchmarks/baselines/native-worlds-before-20260910 \
  --candidate-artifacts public/box3d \
  --out /private/tmp/box3d-native-worlds-new-run
```

For browser inspection, run `npm run dev` on its loopback binding and open `/benchmarks/experiments/native-world-probe.html`. This development page is excluded from the production entry/build.

`public/box3d/BUILD_PROVENANCE.json` identifies the adopted local artifact. The provenance updater now clears old qualification claims when source/artifact hashes change; hashing a build alone cannot carry forward a previous validation pass. Existing release deployments are separate from this local adoption.
