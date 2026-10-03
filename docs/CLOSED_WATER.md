# Conservative closed-basin water

The engine now includes `linear-water-closed-cgrid-webgpu-f32-v1` and its CPU reference `linear-water-closed-cgrid-js-f32-v1`. They solve linear shallow-water waves in a closed rectangular basin with a flat bottom and constant mean depth. The development water probe selects this model by default and retains the inherited absorbing model as an explicit alternative. The Studio liquid laboratory remains a distinct model.

In the retained 32×24 rest-water experiment, the inherited boundary rules reduced an initially uniform volume perturbation from 1.919999957 to 0.275535927 m³ in ten simulated seconds and generated motion from rest: an 85.65% loss of the perturbation. The new closed model preserves uniform elevation and zero velocity exactly in the tested grids. No boundary damping multiplier or elevation clamp changes its volume.

## Equations and storage

With SI inputs, `eta`, `dx`, `dz` and `meanDepth = H` are metres, velocities are metres per second, `gravity = g` is metres per second squared, and `drag = r` is inverse seconds:

```
eta_t = -H (u_x + v_z)
u_t   = -g eta_x - r u
v_t   = -g eta_z - r v
```

Domain dimensions are `cols*dx` and `rows*dz`. Elevation is at cell centres. `u[z*cols+x]` is that cell's east-face velocity; `v[z*cols+x]` is its north-face velocity. Rightmost `u` and topmost `v` slots are zero. West and south exterior faces are implicit zero. This placement follows the face/continuity-cell arrangement in the [MITgcm C-grid documentation](https://mitgcm.readthedocs.io/en/latest/algorithm/c-grid.html); the linear solver and time update here are a separate implementation.

Elevation is at `n*dt`; stored velocities are at `(n-1/2)*dt`. With `a=r*dt/2`, each tick computes:

```
u_plus   = ((1-a)*u_minus - g*dt*Gx(eta)) / (1+a)
v_plus   = ((1-a)*v_minus - g*dt*Gz(eta)) / (1+a)
eta_next = eta - H*dt*(Dx(u_plus) + Dz(v_plus))
```

`G` differences adjacent elevations; `D` differences opposing face velocities, each divided by spacing. Interior face fluxes cancel in the volume sum and exterior fluxes are zero. Only float32 roundoff remains; no correction redistributes mass after the update. Every destination element is overwritten, so scratch histories cannot affect future closed-model states.

There are **two ordered GPU dispatches per tick**, compared with four in the inherited model. This is a dispatch-count reduction, not a measured speedup. Ordinary stepping/rendering requires no full state readback. Six float32 buffers use 24 MiB at 1,048,576 cells.

Validation requires at least 3 cells per axis, at most 1,048,576 cells, finite representable update coefficients, `dt<=1/30`, `0<=r*dt<=1`, and `dt*sqrt(g*H)*hypot(1/dx,1/dz)<=0.8`. Use one fixed timestep. Extreme-coefficient and subnormal behavior across adapters is not qualified.

## Initialization, checkpoints and display

```ts
import {createClosedWaterArrays, GpuLinearWater} from './src/engine/index.ts';

const config = {
  cols: 128, rows: 96, dx: 12 / 128, dz: 9 / 96,
  dt: 1 / 480, gravity: 9.81, meanDepth: 1.5, drag: 0.28,
};
const eta = new Float32Array(config.cols * config.rows);
for (let z = 0; z < config.rows; z++) {
  for (let x = 0; x < config.cols; x++) {
    eta[z * config.cols + x] = 0.03
      * Math.cos(2 * Math.PI * (x + 0.5) / config.cols)
      * Math.cos(Math.PI * (z + 0.5) / config.rows);
  }
}
const initial = createClosedWaterArrays(config, {eta});
const water = await GpuLinearWater.createClosed(renderer.device, config, initial);
renderer.useGpuWater(water);
water.step(4);
const checkpoint = await water.checkpoint();
const restored = await GpuLinearWater.fromCheckpoint(renderer.device, checkpoint);
renderer.useGpuWater(restored);
water.destroy();
```

`createClosedWaterArrays` accepts synchronized elevation and optional face velocities at time zero, copies them, and initializes the negative half-time velocity. `createClosed` accepts already staggered fields, such as that helper's result. Do not pass legacy collocated velocities or synchronized nonzero velocities directly to it. `copyClosedWaterArrays` copies already staggered state. Outward wall flux is rejected before GPU allocation.

Checkpoints retain the backend, tick, configuration and all six arrays. Restore selects the recorded backend, including after changing models in the probe. Typed structured cloning preserves the arrays; plain JSON serialization does not. Startup, submission, device-loss and ownership rules remain as documented in [GPU water runtime](GPU_WATER_API.md).

The renderer averages face velocities to cell centres for speed-based appearance. The 32-byte telemetry path does the same and reports `velocityTime` separately from elevation `time`; velocity remains at its half-time level. `energyProxy` is still a display diagnostic, not joules or the conservation test's invariant.

## Accepted evidence

`benchmarks/results/engine-100x/runs/closed-water-accuracy-20260910-03/` retains protocol version 2, frozen source, 16 cases, 149 complete GPU samples, initial/final CPU states and physical Apple M3 Ultra / Metal identity. The longest case runs 120,000 ticks at Courant 0.799. The largest field is 1024×1024 for 120 ticks; these are separate stress cases.

| Check | Observed | Predeclared bound |
| --- | ---: | ---: |
| Uniform rest, 3×3 and 31×17, 24,000 ticks | Exact elevation, zero velocity | Exact |
| Maximum volume error / initial elevation L1 volume | 1.352217e-6 | 1e-4 |
| Maximum undamped modified-energy relative error | 4.367169e-6 | 5e-4 |
| Maximum component error versus discrete modal solution | 9.705386e-7 | 5e-6 |
| Maximum CPU/GPU component difference | 3.653113e-5 | 5e-5 + 5e-5 × abs(reference) |
| Finest continuum normalized RMS, no drag | 0.000571102 | 0.003 |
| Finest continuum normalized RMS, drag 0.28/s | 0.000144800 | 0.003 |
| Error reduction per joint space/time refinement | 3.9724–4.0049× | 3.5–4.5× |
| Same-adapter checkpoint continuation, 16 cases | Exact complete state | Exact |

Component tolerances apply separately to elevation in metres and velocities in metres per second. The continuum score is dimensionless: divide elevation error by amplitude and velocity error by `amplitude*sqrt(g/H)`. Each field uses its actual time level. The standing-wave comparison runs to 10 seconds on 16×12, 32×24, 64×48 and 128×96 grids with matching timestep refinement. An independent discrete modal solution separates execution error from finite-resolution physical dispersion.

For undamped runs the audited energy per density is:

```
0.5*dx*dz * sum(g*eta² + H*(u_minus²+v_minus²)
                 - g*H*dt*(u_minus*Gx(eta)+v_minus*Gz(eta)))
```

This leapfrog invariant includes a cross term; it does not assert exact conservation of sampled continuum kinetic-plus-potential energy. Constant background elevation is subtracted for the wave-energy test, while volume is measured separately. Damped cases use the damped analytic solution instead of the undamped invariant.

The read-only checker rehashes every retained sample/source, replays the frozen CPU solver, and recomputes mass, wall, modified-energy, modal and continuum gates:

```sh
node scripts/closed-water-check.mjs \
  benchmarks/results/engine-100x/runs/closed-water-accuracy-20260910-03
```

Run a new experiment with `node scripts/closed-water-qualify.mjs` and a **new** output directory. Run 01 preserves a missing-adapter sandbox failure. Run 02 retains a numerical pass whose combined continuum RMS used one scale for unlike units. Version 2 corrects that reporting issue; the solver and thresholds did not change for run 03. Run 02 is not used for the dimensionless convergence claim.

`closed-water-renderer-metal-20260910-01.json` records exact pixels against separately uploaded CPU face-to-centre interpolation at ticks 1, 3 and 20. Explicit stride/uint32 indexing and borrowed-resource ownership pass. The inherited model's GPU regression is retained separately in `closed-water-legacy-gpu-regression-20260910-01.json`.

## Remaining scope

These cases validate this linear discretization. Physical assumptions include small surface perturbations and wavelengths long relative to depth. The probe starts with a 0.05 m wave over 1.5 m mean depth. High-frequency random input is a numerical stability stress, not evidence that shallow-water physics describes those wavelengths. Nonlinear advection/breaking, wetting/drying, bathymetry, moving boundaries, rigid coupling and empirical calibration remain open.

The historical 4.51× completed-frame result belongs to the inherited absorbing model and its frozen source. It does not transfer to this solver. Two closed-model six-pair completed-frame comparisons now retain equal equations, physical tolerance and display mesh, with full-field audits passing all 60 workload records in each run. Both fail the unchanged GPU-control timing gate, so neither qualifies a speedup. The [benchmark contract and retained runs](ENGINE_BENCHMARKS.md#closed-water-completed-frame-comparison) record the uncertainty and the conditions needed for a fresh measurement. Application integration and numerical acceptance for the other models remain open; this addition does not complete roadmap items 5 or 41.
