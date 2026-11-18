# Native body lifetime and recycling

Explicit native worlds now support **body removal with constant-time bridge bookkeeping, dense stream compaction, slot reuse and generation-checked references**. The adopted local implementation completes roadmap item 23's bounded acceptance: **1,048,576 spawn/despawn pairs** (2,097,152 create/destroy operations) kept storage bounded, with **4,721,658 stale-token lookups/mutations rejected**. This adds lifecycle functionality; it is not a measured engine-wide speedup.

## Use stable references

```ts
const pool = await loadNativeWorldPool();
const world = pool.createWorld();
try {
  world.createScene({ id: 0 }, 1, 42);
  const target = world.bodyHandle(156);

  world.destroyBody(world.bodyHandle(1));
  // The same target now occupies row 1 after dense stream compaction.
  console.log(world.bodyIndex(target));
  world.applyBodyImpulse(target, 0, 4, 0);

  const projectile = world.launchProjectileBody(0, 8, 0, 0, 0, 0, 0.5);
  if (projectile) {
    world.destroyBody(projectile);      // true on first removal
    world.destroyBody(projectile);      // false when already removed
    world.bodyIndex(projectile);        // null
    // applyBodyImpulse(projectile, ...) would throw STALE_BODY.
  }

  world.step(1 / 60, 4);
  renderer.uploadInstances(world, world.bodyCount());
  renderer.render(world.bodyCount(), []);
} finally {
  pool.destroy();
}
```

`bodyHandle(index)` obtains a frozen, world-owned `NativeBodyHandle`; `bodyIndex(handle)` returns its current dense render row or `null`. `destroyBody` and `applyBodyImpulse` validate ownership and the generation before native mutation. `launchProjectileBody` returns a reference or `null` when no slot is available. Projectile velocity-labelled arguments retain the bridge's existing impulse semantics. `supportsBodyLifecycle` reports extension availability. Earlier native artifacts remain usable; lifecycle calls on them report `UNSUPPORTED_BACKEND`.

The existing numeric body-index APIs remain compatible. **A persistent numeric index can refer to another body after deletion compacts rows.** Obtain a stable reference before storing a target across removals, then use reference-based actions. Removal can change the draw order of surviving rows; transparent sorting remains a separate renderer concern.

## Identity, ownership and failure behavior

Native tokens use 64 bits: 17 bits for slot plus one and 47 bits for generation. A removed slot advances its generation before reuse. `clear()` and scene replacement invalidate every former body token while retaining the allocation and generation table. Capacity growth copies live rows and the complete used-slot history, including dead slots. An exhausted generation permanently retires that slot instead of wrapping. The exhaustion test exercises the high bit and verifies retirement.

Raw tokens are **world-local** and must be paired with the original world handle from the same module. They are not globally unique. The TypeScript reference additionally carries a private per-world ownership marker, so another world, replacement context or module cannot accept it. JavaScript references retain only that small marker, not the backend or its WASM module. A GC test confirms that retaining an old reference does not keep a disposed backend alive.

WASM exposes i64 results as signed JavaScript BigInts, including C `uint64_t` returns. The adapter normalizes them to unsigned 64-bit tokens without converting to Number. Keep tokens as BigInt; use `.token.toString()` for diagnostics. A body reference is not JSON checkpoint data or a transferable worker command. Full native checkpoints and cross-worker command ownership remain separate work.

The bridge adds five optional exports together: `b3w_world_body_handle`, `b3w_world_body_index`, `b3w_world_destroy_body`, `b3w_world_apply_body_impulse`, and `b3w_world_launch_projectile_handle`. Incomplete extension sets are rejected before context allocation. World ABI version 1 and the old compatibility exports remain supported. The compatibility world retains its fixed 4,096-body API and does not expose body recycling.

The bridge bookkeeping is constant-time; the SDK's own shape/contact teardown depends on the removed body's attachments. Deletion removes the SDK body, swaps the last live body/transform/color row into the hole, repairs the dynamic-body and slot lookups, clears the retired tail row, and advances both stream revisions. No live renderer row is left as a hole. Removing the support beneath a sleeping body was separately tested: the SDK wakes the survivor and gravity resumes rather than being skipped by the sleeping-world cache. Bridge allocation failure leaves live references, dead generations and the free list intact. This does not make every upstream SDK allocation recoverable.

## Evidence and memory cost

The frozen lifecycle run at `runs/native-body-recycling-20260910-04/` exercises 524,288 repeated pairs on one slot and 512 batches of 1,024 pairs with permuted destruction. After 4,096 hot warmups and four full batch warmups, all 128 recorded checkpoints had zero live bodies between batches, the same **17,760,256-byte WASM linear-memory capacity**, **557,056 bytes of bridge storage**, and at most **1,024 used slots**. The run is a correctness/retention experiment; elapsed time is not a qualified throughput comparison. Earlier runs remain preserved.

The generation and lookup tables increase bridge storage from **112 to 136 bytes per reserved body**. That is an explicit feature cost: 557,056 bytes at 4K, 2,228,224 bytes at 16K and 8,912,896 bytes at 64K. In the repeated sixteen-world isolation experiment, shared WASM linear-memory capacity is now **30,867,456 bytes (29.4375 MiB)** versus **284,164,096 bytes (271 MiB)** across sixteen old modules, a **9.21× capacity ratio**. The preceding capacity-only artifact used 24.5 MiB. These are linear-memory capacities, not process RSS or total allocated bytes.

`runs/native-recycling-worlds-20260910-02/` repeats the 800-scene exact comparison: 20,800 exact catalog snapshots and 1,920 exact interleaved snapshots across sixteen worlds. It preserves hashes, counts, colors, transforms and revisions against the original native artifact. Two independent Release builds produced identical JS/WASM bytes; generation-exhaustion and allocation-failure injection exports are absent from the release.

The Metal renderer checks ten lifecycle stages in each direct/partition mode: initial state, middle-row compaction, several removals, slot reuse, rejected stale actions, buffer growth, reference impulse and subsequent stepping, sibling destruction, empty world and scene reset. All active GPU matrix/color bytes match the native streams. Copied streams produce identical pixels; direct and partitioned modes also match. The final artifact separately repeats the complete 4K/16K/64K capacity, mixed-material and rope-output checks. Dense-workload timings remain descriptive and vary between runs; see [Native capacity](NATIVE_CAPACITY.md). No 64K interactive-frame guarantee is claimed.

The local browser showed token `131229` moving from row 156 to row 1 after another body's removal. Destroying it and creating a projectile reused the slot with token `262301`. Attempting the old reference's impulse left the new scene hash unchanged and uploaded zero bytes. Twelve ticks, a second camera view, reset and a second stale-action rejection passed. The temporary tab was closed. This is desktop functional/visual verification, not a phone or browser FPS benchmark.

The final full engine suite passed **173/173 tests**. Seven tests passed against the fault-injection artifact, including generation exhaustion and failed-growth retention. The sleeping-support and independent evidence-audit checks passed separately.

Verification is retained in `benchmarks/results/engine-100x/verification-native-recycling-20260910/`. Previous storage, world-isolation and capacity packets remain immutable. This task has not committed, pushed, deployed or changed the application task's material-lab solvers.

```sh
node --test tests/engine/native-recycling.test.mjs
node --test tests/qualification/native-recycling-sleep.test.mjs
node scripts/native-recycling-check.mjs \
  --run benchmarks/results/engine-100x/runs/native-body-recycling-20260910-04 \
  --packet benchmarks/results/engine-100x/verification-native-recycling-20260910 \
  --native-run benchmarks/results/engine-100x/runs/native-recycling-worlds-20260910-02
```

For browser inspection, open `/benchmarks/experiments/native-recycling-probe.html` on the loopback development server. The probe is excluded from the production build. The next native work includes checkpoints, broader shape/joint/query APIs, and profiling/optimizing dense contact solving.
