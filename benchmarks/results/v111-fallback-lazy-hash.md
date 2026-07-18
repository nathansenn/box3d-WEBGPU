# v1.11 JS fallback lazy replay-hash benchmark

Generated: 2026-07-15T09:32:33.022Z

Baseline: exact bundled **v1.10** source archive; candidate: **working tree**.

Each cell uses **9 fresh processes per version**, alternating order, after 360 in-process JIT warmups. Timings contain 1200 production `syncTransforms()` calls per process.

## Result

**Real conditional win:** sync-only geometric mean 1.590x; telemetry-cadence 1.502x; hash-every-sync 0.994x.

Caveat: The gain exists only while replayHash() is requested less often than syncTransforms(); requesting a hash every sync forces the deferred O(min(bodies, 512)) scan and should collapse the advantage toward parity.

| Scene | Bodies | Hash policy | v1.10 ms/sync | Current ms/sync | Speedup | Paired 95% interval | Exact matrices + hash |
|---|---:|---|---:|---:|---:|---:|---|
| Medium bridge | 254 | Sync only | 0.028564 | 0.010568 | 2.703x | 2.673–2.739x | yes |
| Medium bridge | 254 | Telemetry every 12 | 0.028563 | 0.012050 | 2.370x | 2.292–2.405x | yes |
| Medium bridge | 254 | Hash every sync | 0.028603 | 0.028577 | 1.001x | 0.991–1.012x | yes |
| Dense stack | 3462 | Sync only | 0.180988 | 0.144339 | 1.254x | 1.241–1.272x | yes |
| Dense stack | 3462 | Telemetry every 12 | 0.181682 | 0.147865 | 1.229x | 1.215–1.241x | yes |
| Dense stack | 3462 | Hash every sync | 0.181024 | 0.181622 | 0.997x | 0.981–1.004x | yes |
| Rain stress + 180 | 2407 | Sync only | 0.230679 | 0.194591 | 1.185x | 1.174–1.196x | yes |
| Rain stress + 180 | 2407 | Telemetry every 12 | 0.230327 | 0.197793 | 1.164x | 1.156–1.175x | yes |
| Rain stress + 180 | 2407 | Hash every sync | 0.230989 | 0.234415 | 0.985x | 0.967–1.002x | yes |

## Aggregate by hash policy

| Policy | Geometric-mean speedup | All exact |
|---|---:|---|
| Sync only | 1.590x | yes |
| Telemetry every 12 | 1.502x | yes |
| Hash every sync | 0.994x | yes |

## Method and interpretation

- `sync-only` does not request telemetry during the timed loop.
- `telemetry cadence` requests `replayHash()` every 12 syncs.
- `hash every sync` forces the candidate to perform the deferred hash work every time.
- A final hash request occurs outside the timer for exact result validation.
- Matrix buffers are compared byte-for-byte using SHA-256, and replay hashes must match exactly.
- Every version/sample runs in a fresh Node process; import, setup, warmup, and process startup are excluded.
- Medians, MAD, all raw samples, and deterministic paired-bootstrap intervals are preserved in JSON.
