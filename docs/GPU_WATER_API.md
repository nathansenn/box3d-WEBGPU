# GPU water runtime

The API offers the inherited `linear-water-webgpu-f32-v1` field via `GpuLinearWater.create`, and the conservative `linear-water-closed-cgrid-webgpu-f32-v1` model via `GpuLinearWater.createClosed`. Both expose GPU buffers to the renderer. See [Closed-basin equations, initialization and physical evidence](CLOSED_WATER.md) for the conservative model, now selected by default in the development probe. These optional backends remain distinct from the eight-study Studio's liquid laboratory.

```ts
import {GpuLinearWater, createLinearWaterArrays} from './src/engine/index.ts';
import {WebGPURenderer} from './src/webgpu/renderer.ts';

const startup = new AbortController();
const renderer = await WebGPURenderer.create(canvas, 1, {
  signal: startup.signal,
  startupTimeoutMs: 30_000,
  onStartupProgress: stage => showStatus(stage),
});
const config = {
  cols: 128, rows: 128, dt: 1 / 240,
  gravity: 9.81, meanDepth: 1.5, drag: 0.28,
  dx: 40 / 127, dz: 24 / 127,
};
const initial = createLinearWaterArrays(config);
initial.eta[64 * 128 + 64] = 0.4;
const water = await GpuLinearWater.create(renderer.device, config, initial, {
  signal: startup.signal,
});
renderer.useGpuWater(water);

// A displayed state may contain several authoritative fixed ticks.
water.step(4);
renderer.writeSceneUniforms(sceneUniforms); // The application's camera/lighting.
renderer.render(0, []);

// At an explicitly chosen low sampling rate, outside the frame's critical path:
const sample = await water.telemetry();
console.log(sample.tick, sample.heightRms, sample.maxSpeed);

// On teardown: detach the borrowed fields, release the solver, then the renderer.
renderer.useGpuWater(null);
water.destroy();
renderer.dispose();
```

Use a bounded frame clock to decide the tick count; do not change the model timestep to catch up with wall time. `step()` accepts 0–120 fixed ticks per call, submits their work in order, then publishes the submitted tick and buffer parity. It does not wait for GPU completion. A submission that throws leaves the published tick and parity unchanged. The ordinary step/render path requires no CPU state readback.

The local development probe is `http://127.0.0.1:4401/engine-probe.html` when the owned Vite server is running. It exposes explicit closed/absorbing model selection, run/pause, grid selection, reset, a complete in-memory checkpoint, restore, and keyboard/pointer camera controls. It is a separate development entry, not an addition to the application's default production bundle. Run any replacement server on `127.0.0.1`.

## Inherited model and numerical limits

The field uses elevation `eta` and horizontal velocities `u`/`v`, with three destination arrays. The four ordered compute dispatches preserve the CPU reference's velocity, continuity, horizontal-boundary, and vertical-boundary stages. Both ping-pong histories matter: the original boundary equations intentionally read retained destination-edge values before their boundary update. Replacing those histories with zero changes the numerical model.

Grids require at least 3 cells per axis and at most **1,048,576 cells**. Coefficients must be finite, positive where applicable, representable for the folded float32 update, and satisfy the conservative Courant limit of 0.8. The maximum accepted timestep is 1/30 second. Drag cannot reverse the velocity decay. The inherited elevation clamp is ±1.65 and the boundaries absorb waves. The backend does not claim exact mass conservation or calibrated physical accuracy.

`createLinearWaterArrays()` copies inputs into six independent float32 arrays. The CPU reference `stepLinearWaterCpu()` uses the same original operation and boundary order, allowing exact comparison with the frozen CPU implementation. GPU float32 results use a declared tolerance; they are not promised to be bitwise identical to JavaScript arithmetic or other GPU adapters.

Automatic disturbances, foam/droplets, buoyancy proxies, arbitrary obstacles, wetting/drying, nonlinear fluxes, and two-way rigid coupling are not part of this field backend. Its telemetry `energyProxy` is a normalized grid average, not joules.

## Ownership and display resolution

| Owner | Resources and contract |
| --- | --- |
| Caller | Owns the shared `GPUDevice`, the solver, and renderer lifecycle. A solver never destroys its caller's device. |
| `GpuLinearWater` | Six storage buffers, coefficient uniform, pipelines, and two ping-pong bind groups. `getFields()` borrows current GPU buffers and identifies their owner, device, dimensions, submitted tick and time. Do not destroy borrowed buffers. |
| `ResidentWaterSurface` | Presentation indices/uniform and at most two bind groups. Detaching or replacing it releases these resources while leaving the solver alive. |
| `WaterTelemetryReader` | Bounded reduction storage plus one 32-byte asynchronous readback slot. A second pending telemetry request is rejected. |

The renderer uses **uint32 source indices**, including when source indices exceed 65,535. Its current water display mesh is limited to 16,384 vertices. Larger numerical fields require an explicit `renderStride`; the solver still updates every cell. For example, `renderer.useGpuWater(water, {renderStride: 9})` displays a 1024×1024 field using a 115×115 mesh, including the final row and column. This is declared display decimation, not an increase in equal-quality rendering capacity. The same stride must be used in an A/B comparison.

`gpuWaterInfo()` distinguishes the new numerical binding from the older CPU-field upload path. There is one active water surface per renderer; multiple independent surface collections are still a separate roadmap item. A destroyed solver cannot be used for later rendering. Replacing a field first builds the new presentation resources; if validation fails, the previous presentation remains attached.

At one million cells, the solver's six field buffers total 24 MiB, before renderer and telemetry resources. An explicit checkpoint additionally needs a 24 MiB staging buffer and a 24 MiB owned CPU copy. Initial-array copies also have a temporary CPU cost. These are payload sizes, not a measured total process-memory footprint.

## Telemetry and checkpoints

`await water.telemetry()` returns volume perturbation, elevation/velocity RMS, peak speed, min/max elevation, and the energy proxy. Two reduction dispatches summarize the GPU field and read back **32 bytes**. The result carries the sampled tick/time and request/completion times. Rendering may continue while it is pending. The first request compiles the reduction lazily, so the actual sampled state may be newer than the state at the API call; always use the returned timestamp. A consumer must display sample age rather than attaching delayed scalars to a later frame.

`await water.checkpoint()` captures all six histories, coefficients, backend version and tick. Only one full checkpoint readback may be pending per solver. Checkpoints own their CPU arrays and cannot change the live GPU state. The checkpoint is structured-cloneable typed data; **plain `JSON.stringify()` does not preserve its typed arrays**. It is not the Studio PBD JSON checkpoint format.

```ts
const saved = await water.checkpoint();
const restored = await GpuLinearWater.fromCheckpoint(renderer.device, saved);
renderer.useGpuWater(restored, {renderStride: 9});
water.destroy();
```

Restore rejects incomplete, incompatible, nonfinite or incorrectly sized state. Same-adapter continuation has been checked for exact equality, including both histories. Cross-adapter replay has not been qualified. Device loss invalidates GPU state; recovery requires a previously retained checkpoint. The probe reports a device-loss error and asks for a reload rather than pretending the lost GPU buffers survived.

GPU initialization accepts a cancellation signal and a total 1–120,000 ms budget, defaulting to 30 seconds. It reports the stage that times out, destroys a device that arrives after cancellation, and aborts pending renderer texture loads. Cancellation applies during startup; successful return transfers lifecycle responsibility to the caller.

## Evidence

- `scripts/gpu-water-qualify.mjs`: real Metal comparisons at six grid sizes, CPU/GPU error envelopes, exact same-adapter checkpoint continuation, compact telemetry, and ownership guards. Requires a new output JSON path.
- `scripts/webgpu-renderer-runtime-test.mjs` with `WEBGPU_WATER_EVIDENCE`: direct borrowed fields versus uploaded copies produce identical pixels; uint32 indices, explicit stride and destruction are exercised.
- `scripts/gpu-water-benchmark.mjs`: bounded, fresh-process, balanced CPU/GPU comparisons at fixed numerical and display settings. Includes completed rendering; preserves raw samples, controls, source snapshots, errors, and small-grid losses. This measures serialized offscreen frame latency, not browser FPS.
- `tests/engine/gpu-startup.test.mjs`, `gpu-timing.test.mjs`, `linear-water.test.mjs`, `resident-water.test.mjs`, and `water-benchmark.test.mjs`: reference, protocol, failure and resource checks.

See `ENGINE_100X_PROGRESS.md` for the current result paths and acceptance limits. No result establishes an engine-wide 100× gain.
