# Studio parameter sweeps and saved runs

The shared Studio runtime can execute independent canopy, plate, and bridge cases in bounded workers. Each case keeps the same fixed 120 Hz numerical model as interactive playback. These are authored comparative models; a parameter sweep does not make the coefficients calibrated material data.

Create a JSON array of cases:

```json
[
  {
    "id": "bridge-service",
    "options": {"study": "bridge", "controls": {"targetLoad": 0.8, "strength": 1, "wind": 0.25}},
    "ticks": 1440,
    "commands": [{"tick": 1201, "type": "controls", "values": {"targetLoad": 0}}]
  },
  {
    "id": "bridge-overload",
    "options": {"study": "bridge", "controls": {"targetLoad": 4, "strength": 1, "wind": 0.25}},
    "ticks": 1440,
    "commands": [{"tick": 1201, "type": "controls", "values": {"targetLoad": 0}}]
  }
]
```

Run with Node's TypeScript stripping support (the qualified local runtime is Node 26):

```sh
npm run sweep:studio -- --input cases.json --output benchmarks/results/my-new-sweep --concurrency 2 --checkpoint
```

The output directory must not exist. Its parent must exist. Nothing overwrites earlier results. `manifest.json` identifies source hashes, the actual Node runtime, every case, and the sampling settings. Separate result JSON files contain numeric responses, original failure IDs, completion state, and optional full precision checkpoints. `summary.json` lists every result with a SHA-256 digest. Wall and solver timings describe this execution; concurrent sweeps are not controlled performance benchmarks.

Use Ctrl-C to cancel. Active workers terminate, unfinished cases are labeled cancelled, and finished artifacts remain available. A rejected worker is a failed case, never a silently substituted model. Output failures propagate after active workers are cleaned up. The limits are 1–512 cases, 1–4 workers, 72,000 ticks per case, 500,000 total ticks, and 64 ordered control commands per case. Samples default to every 120 ticks; `--sample-every` accepts multiples of 12. Batches yield between at most 120 fixed ticks, with a default of 24.

The CLI streams each checkpoint to its result file and releases it after the write. Library callers can select the same behavior with `retainCheckpoints: false` and an `onResult` sink. In-memory retention of full checkpoints is limited to 64 cases; larger sweeps must stream them. Numeric samples remain bounded by the total-tick budget.

`runStudioSweep(cases, { signal, concurrency, onProgress, onResult, transport })` is exported from `src/engine/index.ts` for applications. Results retain input order. The awaited `onResult` callback gives file/database consumers backpressure. Browser use selects the existing Studio worker transport; the CLI uses the same dispatcher in Node worker threads. Only numeric history is retained by the sweep; intermediate geometry loans are released immediately.

In the Studio, **Resume saved run** opens a JSON checkpoint, a v2 evidence export, or a sweep result generated with `--checkpoint`. Import validates the entire model and topology before replacing the active experiment. It restores positions, previous positions, plastic rest lengths, damage, controls, ram state, and events. The imported run is paused so it can be inspected before continuing. Replay history begins at the imported time; earlier geometry history is not invented. Older exports containing only final render positions cannot be resumed.

The Workbench runtime does not yet support resumable checkpoints or this sweep runner. Its separate solver identity remains explicit.

The latest retained campaign, `benchmarks/results/engine-100x/runs/studio-campaign-256-20260910-01/`, completed 256 distinct bridge strength/wind combinations, each at 240 fixed ticks. It used two workers, streamed all full checkpoints, and completed in 13.046 seconds. All 256 artifact digests were independently rechecked. This qualifies the bounded campaign mechanism, not long-horizon physical response or a controlled throughput multiplier. The 9-case cross-study campaign and 128-case streaming campaign are also retained.
