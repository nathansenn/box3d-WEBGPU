# Shared Studio snapshots

The classic canopy, plate and bridge worker supports an optional three-slot `SharedArrayBuffer` transport. It preserves the existing numerical model, fixed ticks, immutable recording copies and full checkpoints. The five newer material labs are separate models and are not migrated by this change.

```ts
const client = await createStudioClient(
  { study: 'canopy', controls: { targetLoad: 4 } },
  { mode: 'worker', snapshots: 'shared' },
);
const frame = await client.step({ ticks: 2 });
try {
  renderer.update(frame.liveSnapshot); // Consume or copy while the loan is held.
} finally {
  frame.release();
}
await client.destroy();
```

`snapshots: 'transfer'` remains the default. Explicit `'shared'` rejects unavailable sharing; `'auto'` selects sharing where available and reports `snapshotFallbackReason` when it must use transfer. `snapshotTransport` records the actual selection. Browser sharing requires a secure, cross-origin-isolated context; the document and worker both check support. Shared buffers are cloned references to the same storage and never belong in a transfer list. See [MDN's shared-memory requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) and [atomic compare/exchange](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/compareExchange).

The production server headers and default application transport are unchanged. A separate local development server can exercise isolation without changing the existing preview:

```sh
node scripts/studio-shared-probe-server.mjs
# http://127.0.0.1:4402/benchmarks/experiments/studio-shared-probe.html
```

## Ownership and reset

The writer reserves a free slot **before stepping**. It copies positions, strains and the complete broken-member mask into that slot, then atomically publishes its sequence and tick. The reader atomically claims the published slot before validating or exposing its views. The writer cannot reuse it until release. Neither endpoint waits with `Atomics.wait` or spins while the ring is full; normal worker messages schedule subsequent work. A full ring produces `BACKPRESSURE` without applying commands or advancing ticks.

Each reset allocates a fresh ring and closes the old one. A caller may finish reading a retained old-generation snapshot, but its release cannot free a current-generation slot. Snapshot sequence exhaustion retires that slot instead of wrapping. Duplicate, wrong-tick, wrong-generation and already-consumed publications are rejected. Late worker messages cannot resolve a new request. Closing the client stops publication and terminates its worker.

The returned arrays are borrowed and writable JavaScript views: applications must treat them as read-only and stop using them after `release()`. They do not detach on release. Mutating them does not update authoritative solver state. Recording samples and checkpoints remain independent owned data. Keeping old released views is not a supported way to save a frame; copy a snapshot or export a checkpoint.

## Fixed storage and measured performance

The shared ring uses one 256-byte atomic header and three aligned payload regions. The worker additionally retains one ordinary runtime snapshot target for packing. This first implementation deliberately includes a copy from that target into the reserved shared slot; it does not claim direct solver writes into shared memory.

| Study | Live snapshot bytes | Shared ring bytes |
| --- | ---: | ---: |
| Canopy | 19,304 | 58,168 |
| Plate | 20,746 | 62,500 |
| Bridge | 2,695 | 8,344 |

The comparison retained six balanced transfer/shared process pairs, both inspection and two-tick batches, full raw timings, unchanged CPU controls, message-byte counters and exact trajectory/checkpoint digests. Every measured shared live snapshot removed its three outbound transferred buffers and the three-buffer recycle message. Recording transfers remained present. The fixed shared storage costs more than the minimum one-slot transfer case.

**No statistically qualified speedup was established.** The unchanged-control ratio was 0.9957 (95% interval 0.9342–1.0157), within the declared 15% envelope, but none of the six workloads met the predeclared ratio lower-bound and p95 requirements. This is why the default remains transfer.

| Workload | Transfer p95, ms | Shared p95, ms | Ratio estimate | Paired 95% interval |
| --- | ---: | ---: | ---: | --- |
| Canopy inspection | 0.180 | 0.176 | 1.046 | 0.899–1.253 |
| Canopy two-tick step | 5.210 | 4.950 | 1.045 | 0.965–1.093 |
| Plate inspection | 0.176 | 0.175 | 1.045 | 0.938–1.144 |
| Plate two-tick step | 6.364 | 6.133 | 1.024 | 0.970–1.043 |
| Bridge inspection | 0.094 | 0.103 | 1.089 | 0.940–1.311 |
| Bridge two-tick step | 0.633 | 0.527 | 0.981 | 0.927–1.217 |

These are Node worker round trips through response validation and release return, including shared packing and local copy costs. The interval estimates use paired process means; the p95 uses pooled individual samples. Hash checking is outside timing. The last transfer recycle is enqueued, with FIFO processing observed by the next request. There is no renderer in this benchmark and these values are not browser FPS or a full-frame speedup.

## Evidence and acceptance

- `tests/engine/shared-snapshot.test.mjs`: atomic ownership, early reads, stale publications, sequence retirement, malformed layouts, exact three-study output/checkpoints, recording independence, full-ring command rejection, reset during work, old-generation retention and capability fallback.
- `runs/studio-shared-stress-20260910-01/`: **131,072 concurrently published snapshots, 7,710 delayed held reads, 1,195,190,584 scalar checks and zero torn reads**. The producer yields between writing different fields, and the consumer yields while holding reads. All 128 recorded storage observations retain the same 58,168-byte ring. Elapsed time is descriptive only.
- `runs/studio-shared-transport-20260910-01/`: twelve process receipts, frozen source/harness, protocol, exact digests, raw round-trip samples and an independently recomputed timing gate. Its unqualified speedup result is preserved.
- `verification-studio-shared-20260910/`: final source, tests, browser observations, production build and receipt inventory for this continuation.

The first two run paths are relative to `benchmarks/results/engine-100x/`. Recheck them without overwriting evidence:

```sh
node scripts/studio-shared-check.mjs --run benchmarks/results/engine-100x/runs/studio-shared-stress-20260910-01
node scripts/studio-shared-benchmark.mjs --check benchmarks/results/engine-100x/runs/studio-shared-transport-20260910-01
```

Roadmap item 13 is implemented, with concurrency correctness established for this bounded transport. A lower transfer cost and broad browser/device timing qualification remain unproven. Future optimization can eliminate the worker's staging copy, but must preserve the loan and recording contracts and qualify total costs again. To disable this optional path, omit `snapshots` or select `'transfer'`; no native artifact rollback is required.
