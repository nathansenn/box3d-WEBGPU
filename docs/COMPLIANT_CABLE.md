# Compliant axial cable

The new opt-in `cable-proximal-js-f64-v2` corrects the curved force-balance error described below, adds force-consistent warm starts and full-tick impulse accounting, and passes independent nonlinear equilibrium checks. See [Nonlinear cable force balance](NONLINEAR_CABLE.md). This document retains the original XPBD equations and historical axial acceptance; omitting `config.solver` preserves that backend exactly.

`CompliantCableRuntime` adds the distinct `cable-xpbd-js-f64-v1` model to the engine adapter API. It models three-dimensional point masses joined by elastic, tension-only cables. Positions are metres, masses kilograms, time seconds, forces newtons and impulses newton-seconds. It has fixed anchors, applied forces/impulses, full JSON checkpoints, owned snapshots, support reactions and convergence diagnostics. The existing Studio/cloth/rope PBD models keep their identities and coefficients.

Open the development [cable probe](http://127.0.0.1:4401/cable-probe.html) to run a hanging load or suspended span, change resolution/substeps/iteration limits/axial rigidity, apply an impulse, orbit, and save/restore complete state. This page uses a Canvas presentation of the 3D particle state, without adding another GPU solver. It is not included in the ordinary production entry build.

## Constitutive law and integration

For a segment with reference length `L`, axial rigidity `EA` in newtons and current length `l`, compliance is `alpha=L/EA` in m/N. Elastic energy is `max(l-L,0)^2/(2*alpha)` for positive compliance. Slack segments store no elastic energy and transmit no compression; zero compliance is an inextensible limit. This is an axial Hookean model, without bending or a material calibration.

The multiplier update follows [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf). With substep `h`, use `alphaTilde=alpha/h^2`, initialize every multiplier to zero, and accumulate its corrections across local Gauss–Seidel iterations. Clamp the total multiplier to at most zero for a tension-only cable. The last-substep tension estimate is `-lambda/h^2`. [Small Steps](https://matthias-research.github.io/pages/publications/smallsteps.pdf) motivates testing substep size separately from iteration count.

Velocity damping is an implicit mass-proportional force `-m*r*v`. It scales both the predicted external-force response and the inverse masses used for projection by `1/(1+r*h)`. Scaling only prediction would incorrectly change the static load-extension relation when damping or timestep changes.

Early exit checks the dimensionless constitutive/complementarity residual: the absolute residual of `l-L+alphaTilde*lambda`, divided by `L`, for active cables; positive overstretch for inactive cables. An iteration cap that leaves this above tolerance is reported as an unconverged substep. It is never silently accepted as converged.

The separate `maxImplicitForceResidual` measures the inertial equation in newtons at free nodes. XPBD approximates changing constraint directions; a small constitutive residual alone does not prove that full implicit force balance or continuum motion is accurate. The integrator also introduces numerical damping. The qualified axial motion shows first-order convergence as the actual substep shrinks. Increasing iterations cannot remove that time-integration error.

Kinetic, elastic and gravitational potential energies are separate. Applied work includes explicit forces and impulses; conservative gravity is already represented by potential energy. `dragDissipation` accounts for physical damping. The axial unit test closes the implicit-Euler energy budget, including its additional numerical dissipation. Exact angular-momentum conservation is not claimed.

## API and ownership

```ts
import {CompliantCableRuntime, hangingCableDefinition} from './src/engine/index.ts';

const cable = new CompliantCableRuntime(hangingCableDefinition({
  segments: 32, length: 2, linearDensity: 0.25, tipMass: 1,
  axialRigidity: 1000,
  config: {
    dt: 1/60, substeps: 8, maxIterations: 256,
    residualTolerance: 1e-9, drag: 4, gravity: [0, -9.81, 0],
  },
}));
const frame = cable.step({ticks: 1, commands: [
  {tick: 1, type: 'impulse', node: 32, value: [0.35, 0, 0.15]},
]});
const saved = JSON.parse(JSON.stringify(cable.checkpoint()));
const restored = CompliantCableRuntime.fromCheckpoint(saved);
cable.destroy();
```

`step` and `inspect` return owned copies. The complete definition and state are cloned on input/restore; changing input, snapshots or checkpoints cannot alter a live model. Commands are validated as a whole before stepping. `force` replaces a node's persistent force; `impulse` changes free-node velocity and accounts for applied work. Forces on fixed anchors contribute to support reaction; impulses on anchors are rejected. Destroy releases retained solver buffers and prevents further inspection/stepping.

`hangingCableDefinition` uses half segment masses at endpoints and full masses inside. Segment compliance scales with segment length, so changing the mesh preserves total cable mass and axial rigidity. The anchored mass has weight: support reactions include it even though it does not move.

Bounds are 16,384 nodes, 65,536 links, 1–16 substeps, 1–256 iterations, 1–120 ticks per batch and at most 16 million projected-constraint visits per batch. Large requests must be divided. `dt` lies in `[1e-6,1/30]` seconds; positive compliance is at least `1e-18` m/N. These bounds limit work and representability, not a universal physical-accuracy envelope. Worker execution, moving anchors, bending, collisions and rigid coupling remain open.

## Qualified evidence

`benchmarks/results/engine-100x/runs/compliant-cable-accuracy-20260910-04/` freezes protocol 1 and the solver, oracle, checker and numerical tests. It retains **28 cases and 702 complete sampled states**, per-case full checkpoints and exact 17-tick continuations. The read-only audit rehashes source, replays every sampled state/checkpoint/continuation and recomputes the independent scalar gates.

| Check | Observed |
| --- | ---: |
| Maximum sampled implicit-spring position/velocity component error | 2.274e-12, each component in its own SI unit |
| Maximum sampled spring tension/support-force error | 2.782e-11 N |
| Maximum sampled implicit force-balance residual | 8.935e-10 N |
| Distributed hanging extension, 1/4/16/32 segments | 24.5250000–24.5250010 mm; theory 24.525 mm |
| Distributed total mass / support reaction | 1.5 kg / 14.715 N |
| Maximum sampled linear momentum error over 100 seconds | 4.079e-12 kg·m/s |
| Maximum sampled unforced axial energy increase | 1.487e-13 J |
| Continuum error reduction per halved substep | 1.9387–1.9844× |
| Finest continuum phase-space error | 0.015504 dimensionless |

The spring matrix includes 18 combinations of timestep, damping and iteration limit; its reference uses a complex eigenvalue power of the implicit linear system, independently of XPBD projection. Position and velocity are checked in metres and m/s separately. The continuum score normalizes displacement by oscillation amplitude and velocity by amplitude times angular frequency; its time-refinement test runs to one second. This error is not zero, despite near-exact agreement with the discrete implicit reference.

The hanging test uses eight substeps per 1/60-second outer tick and a 1e-9 residual target. An exploratory 32-segment case using four substeps reached its iteration cap with residual about 6e-9; it was not relabeled as converged. A separate deliberately under-resolved case must report failure to converge. The suspended-span browser scene is functional exploration; no independent catenary/calibration acceptance is inferred from it.

The original curved span exposed nonlinear error: after settling, the browser reported an implicit force residual of 0.004005 N at 1/480-second substeps and 0.001286 N in a separate reset at 1/960 second. Corresponding support reactions were 20.10459 N and 20.10908 N against the 20.1105 N static weight. The two runs used different impulse histories, so they do not establish a controlled convergence rate. Both had small constitutive residuals. The separate [version-2 solver and qualification](NONLINEAR_CABLE.md) address this error, including support/impulse accounting; the original axial qualification above does not cover that work.

Run 01 failed CLI argument parsing before creating a run directory. Run 02 retained a signed-zero checkpoint mismatch. State boundaries now canonicalize zero without changing nonzero values or weakening exact replay. Run 03 passed; run 04 freezes the additional zero-ID/state normalization and bounded record reader. Those earlier attempts remain available. No CPU/GPU speedup or completion of the broader cloth/rope/Studio XPBD migration is claimed.

```sh
node scripts/cable-check.mjs benchmarks/results/engine-100x/runs/compliant-cable-accuracy-20260910-04
node --test --test-concurrency=1 tests/engine/compliant-cable.test.mjs tests/engine/runtime.test.mjs tests/qualification/cable-evidence.test.mjs
# Use a new directory for a new experiment; existing evidence is never overwritten.
node scripts/cable-qualify.mjs --out /absolute/path/to/new-cable-run
```

The latest focused suite passes 22 tests, including existing Studio/workbench exact-output regressions, damping work/energy accounting, slack/unloading, momentum, ownership, invalid commands, JSON replay and corrupted physical evidence. TypeScript and live probe validation are recorded separately in `verification-compliant-cable-20260910/`. Numerical acceptance is bounded to the cases above; physical material calibration and the rest of the 100-item roadmap remain open.
