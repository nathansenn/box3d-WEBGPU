# Native and GPU body capacity

Explicit native worlds now reserve **4,096 → 16,384 → 65,536 bodies**, with matching growable GPU instance storage. This is a **16× increase in the tested per-world body limit**, not a frame-speed multiplier. Roadmap item 22's bounded capacity acceptance passed. The original compatibility world retains its 4,096-body contract.

The change is adopted in the local source and public WASM artifact. The latest artifact also includes [generation-checked body recycling](NATIVE_BODY_LIFECYCLE.md), with an explicit storage cost for its lookup tables. It does not automatically increase workloads in the eight-study application, deploy a release, or establish an engine-wide 100× gain.

## Use the capacity API

```ts
const pool = await loadNativeWorldPool();
const world = pool.createWorld();
try {
  world.createScene({ id: 0 }, 1, 42);

  // Include space for effects/rope outputs when reserving renderer capacity.
  await renderer.reserveInstanceCapacity(65536, {
    signal: controller.signal,
    startupTimeoutMs: 30000,
  });
  world.reserveBodyCapacity(65536);
  world.spawnRain(65536 - world.bodyCount(), 48, 2);
  world.step(1 / 60, 4);
  renderer.uploadInstances(world, world.bodyCount());
  renderer.render(world.bodyCount(), []);

  console.log(world.capacityInfo(), renderer.instanceCapacityInfo());
  console.log(world.contactCount());
} finally {
  pool.destroy();
}
```

Reservations never insert bodies or shrink storage. `clear()` and `createScene()` retain a world's reserved capacity. Destruction releases its allocation. The two reservations are separate operations: if native allocation fails after GPU growth, the renderer keeps its larger capacity and the native world keeps its original state.

The native ABI remains version 1 with an additive optional extension. The TypeScript adapter supports the earlier fixed-capacity world artifact and returns `UNSUPPORTED_BACKEND` when growth is requested there. It rejects partial capacity extensions before allocating a context. New native exports are `b3w_world_reserve`, `b3w_world_buffer_version`, `b3w_world_storage_bytes`, and the optional diagnostic `b3w_world_contact_count`.

## Storage and failure behavior

Native body/slot/index/matrix/color storage uses one allocation per context. Growth allocates and copies the active rows before committing any pointer changes. A bridge allocation failure returns `ALLOCATION_FAILED` and leaves body IDs, state, streams, RNG, hashes, revisions and old capacity intact. Constructor failures release temporary storage and leave the context slot available. Test-only fault injection is absent from the release artifact. This is not a guarantee that every allocation inside the upstream Box3D SDK is recoverable.

Read `HEAPF32` again after any native call that can grow the WASM heap. Capacity growth can also relocate stream offsets; obtain those through the adapter's pointer getters again. The adapter checks the native buffer generation so direct raw-C reservations cannot leave its cached pointers stale. Borrowed views are not lifetime-independent snapshots.

GPU reservations validate device buffer limits, preserve the old streams with ordered GPU copies, rebuild rope/partition bindings, reuse compiled pipelines, and release replaced storage. Ordinary rendering can continue while allocation validation is pending. Growth never calls `queue.onSubmittedWorkDone()`. Each concurrent caller has its own total deadline and cancellation signal. Allocation, validation, submission, timeout, cancellation, disposal and device-loss tests verify that failed reservations do not commit replacement buffers. Rigid uploads and draws reject oversized or invalid counts instead of silently truncating them.

GPU tiers extend through 1,048,576 instances, subject to device limits. Only growth through **131,072** was exercised on this Metal adapter: 65,536 rigid bodies plus two GPU-computed rope outputs require that next tier. No million-rigid-body rendering qualification is claimed. Sixteen ordinary native contexts are qualified together; sixteen simultaneous 64K worlds are not.

`bridgeBufferBytes` counts bridge-owned body/slot/index/matrix/color storage. `matrixColorBytes` counts only the two GPU instance buffers. WASM `HEAPF32.byteLength` is linear-memory capacity and usually does not shrink after freeing bodies. None of these is process RSS or total GPU memory. `contactCount()` reports SDK contact pairs, including non-touching broad-phase pairs; it is not a count of touching manifolds. Older artifacts return `null` for this optional metric.

## Measured dense workload

The table describes the final body-lifecycle artifact, captured in `native-recycling-capacity-metal-{direct,partition}-20260910-02.json`. Earlier capacity-only and pre-ownership-refinement runs remain preserved. Apple M3 Ultra, physical Metal, Node 26 / Dawn `webgpu` 0.4.0. Each tier starts with scene 0, seed 42, fills exactly N bodies with rain spread `12 * sqrt(N / 4096)` and height 2, then runs eight warmup and 24 measured frames. All measured frames retain more than 95% awake bodies and more contact pairs than bodies. Each frame advances 1/60 second with four native substeps, uploads changed streams, renders at 512×320 with one sample and shadows disabled, then waits for submitted GPU work to complete. Procedural material fallback is fixed across runs.

| Bodies | Direct frame p50 / p95 | Partitioned frame p95 | Final contact pairs | WASM linear-memory capacity | Bridge buffers | GPU matrices/colors |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4,096 | 12.52 / 14.24 ms | 14.38 ms | 10,525 | 21,364,736 B | 557,056 B | 327,680 B |
| 16,384 | 60.97 / 66.50 ms | 62.60 ms | 42,902 | 77,070,336 B | 2,228,224 B | 1,310,720 B |
| 65,536 | 301.65 / 320.41 ms | 340.75 ms | 175,001 | 276,561,920 B | 8,912,896 B | 5,242,880 B |

These are two sequential descriptive runs, not a balanced performance comparison. They do not establish a partition speedup, browser/compositor FPS, cross-device capacity frontier, or a sustained 16.67 ms interactive guarantee. The 16K and 64K dense workloads exceed that frame target. At 64K, final direct-mode native stepping alone had a 316.79 ms p95; CPU contact solving dominates this case. Contact queries, full verification readbacks and startup are outside the timed frame. Individual frame records and stage distributions are retained.

## Verification and replay

- All 800 original recipes: **20,800 exact state comparisons**, plus **1,920 exact interleaved comparisons** for sixteen worlds. Capacity changes retain the preceding isolation and legacy-ABI guarantees.
- Full GPU matrix and color buffers match native bytes at 4K/16K/64K. Draw commands/indirect counts cover every instance; stable partition IDs cover the complete active range.
- Direct and partitioned modes produce exact matching pixels, including 65,536 mixed opaque/transparent instances. Native and GPU reservations preserve the prior scene's exact pixels. Rope compute writes verified outputs into grown buffers beyond slot 65,535. Zero uncaptured Metal errors.
- Live state and subsequent stepping remain exact after native growth. Raw caller growth refreshes typed pointers. Failed constructor/growth allocations retain state and slot availability. 128 post-warmup grow/destroy cycles retain bounded WASM capacity.
- Browser inspection exercised 4K/16K/64K construction, two camera angles, a subsequent 64K tick, and reset to the original 157-body scene while retaining capacity. Camera-only redraw uploaded zero bytes; the subsequent tick uploaded matrices only. No probe-reported GPU errors occurred. This was a desktop Mac check, not a phone or browser frame-rate benchmark.
- Two independent native builds produced identical JS and WASM bytes; the public legacy native soak passed. The latest body-lifecycle engine suite passed 173 tests; the preceding capacity-only suite passed 168. Fault-injection and evidence-audit checks passed separately. The verification packet preserves source, support files, artifact hashes and logs.

The current artifact is captured in `verification-native-recycling-20260910/`. The preceding capacity-only evidence lives in `benchmarks/results/engine-100x/verification-native-capacity-20260910/`, the `runs/native-capacity-worlds-20260910-01/` exact-replay run, and `native-capacity-renderer-metal-{direct,partition}-20260910-01.json`. Earlier verification packets remain historical and immutable.

```sh
node --test tests/engine/native-capacity.test.mjs tests/engine/native-world.test.mjs
node scripts/native-world-check.mjs \
  --run benchmarks/results/engine-100x/runs/native-capacity-worlds-20260910-01
node scripts/native-capacity-check.mjs \
  --packet benchmarks/results/engine-100x/verification-native-capacity-20260910 \
  --native-run benchmarks/results/engine-100x/runs/native-capacity-worlds-20260910-01
```

Use `/benchmarks/experiments/native-capacity-probe.html` on the loopback development server to inspect the current artifact. Development probes are excluded from the production build. Run hardware evidence with `WEBGPU_DAWN_BACKEND=metal`, `WEBGPU_GPU_TIMING=0`, and `WEBGPU_NATIVE_CAPACITY_EVIDENCE` set to a new output file; add `WEBGPU_INSTANCE_PARTITION=1` for the partition path. The optional `BOX3D_CAPACITY_ARTIFACT_DIR` and `BOX3D_CAPACITY_SOURCE_ROOT` must identify the artifact's exact source. Evidence files are created exclusively, and source hashes must remain unchanged during capture.
