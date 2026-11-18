# Nonlinear cable force balance

`cable-proximal-js-f64-v2` is an opt-in solver for the existing SI axial cable model. It corrects the changing-direction force error in scalar XPBD, supports elastic and inextensible tension-only links, and retains the original `cable-xpbd-js-f64-v1` behavior when no solver is selected. The cable development probe defaults to the new solver and offers the original solver for comparison. The production Studio bridge still uses its existing comparative model.

```ts
const definition = hangingCableDefinition({
  segments: 32, length: 2, linearDensity: 0.25, tipMass: 1,
  axialRigidity: 1000,
  config: {
    dt: 1/60, substeps: 8, maxIterations: 256,
    residualTolerance: 1e-9, forceTolerance: 1e-6,
    solver: 'proximal', drag: 4, gravity: [0, -9.81, 0],
  },
});
const runtime = new CompliantCableRuntime(definition);
```

## Equations and convergence

For substep `h` and mass-proportional drag coefficient `r`, the free-node predictor is `p* = p + h/(1+r*h) * (v + h*(g + F/m))`. The target position minimizes

```
sum_nodes m*(1+r*h)/(2*h^2) * |x - p*|^2
  + sum_elastic max(|xb-xa| - L, 0)^2/(2*alpha)
```

Fixed anchors are eliminated. An inextensible link adds the convex constraint `|xb-xa| <= L`. The elastic energy is convex, and the mass term is strictly convex on free positions. This is still backward Euler; solving its nonlinear equations accurately does not remove its numerical damping or time-discretization error.

The implementation uses vector dual block minimization, a form of [Dykstra splitting for a sum of convex functions and a quadratic](https://arxiv.org/abs/1709.09499). Each link stores a three-component correction `q`, with positive direction from `a` to `b`. With `wa = inverseMass[a]/(1+r*h)`, `wb` similarly, and `w = wa+wb`, remove the old correction from the link separation algebraically:

```
d = xb - xa + w*q
qNew = max(|d|-L,0) / (w + alpha/h^2) * d/|d|
xa += wa * (qNew-q)
xb -= wb * (qNew-q)
```

Coincident/slack separations yield zero correction. Zero compliance uses the ball projection. Updating a vector, instead of only a scalar multiplier along each iteration's changing gradient, restores the nonlinear stationarity condition. No dense matrix is allocated.

Warm starts retain the previous substep's vector corrections. The new predictor receives their matching mass-weighted position changes before iteration. Retaining old forces without those position changes would violate stationarity. Complete version-2 checkpoints therefore include the vector corrections; version-1 checkpoints retain their original format and backend.

Three separate stopping checks must pass:

- The vector constitutive/complementarity gap divided by reference length is below `residualTolerance`.
- The free-node implicit force equation, evaluated with the actual elastic force from extension and final direction, is below `forceTolerance` in newtons.
- The vector gap divided by `h^2*(wa+wb+alpha/h^2)` is below the same force tolerance. This last check prevents a small hard-link position error from producing large force corrections at small substeps.

The hard-link tension is a dual estimate, with its final direction checked by the vector gap. Fixed-node support reactions use final constitutive forces and include anchored weight and applied forces. These force readings describe the last substep. `snapshot.impulses` separately reports the actual support, applied and damping impulses accumulated over the **last complete tick**; applied impulse includes gravity and explicit impulse commands. A multi-tick call returns the final tick's impulses, not the whole batch sum. Under-converged solves still expose their actual applied impulses and all failed tolerances.

The existing node/link/substep limits remain. The new backend allows up to 4,096 iterations; the original allows 256. Admission still caps a batch at 16 million link visits, including a possible warm-start application per link/substep. Early exit counts actual visits. A cap reached above any tolerance is explicitly reported; these limits do not guarantee convergence for every network or stiffness.

## Independent acceptance

Frozen run: `benchmarks/results/engine-100x/runs/proximal-cable-accuracy-20260911-02/`. Its audit reconstructs every case from frozen source, replays **505 full sampled states**, recomputes checks across **16,564 outer ticks**, and verifies all complete checkpoints and 17-tick continuations. There are **21 cases**, including one deliberately under-converged case whose warning is required. Numerical acceptance excludes those four deliberately under-converged ticks.

| Check | Maximum observed error |
| --- | ---: |
| Nonlinear symmetric trajectory versus independent scalar bisection | 5.241e-12 m position; 4.899e-10 m/s velocity |
| Full static nodal positions versus force-polygon shooting | 7.709e-10 m |
| Static segment tension | 1.841e-6 N |
| Total static vertical support reaction | 1.086e-6 N |
| Independently recomputed single-substep force equation | 1.384e-9 N |
| Complete-tick linear momentum/impulse balance | 8.507e-12 N s |
| Excess over the tested unforced backward-Euler energy inequality | 2.310e-14 J |

The scalar dynamic reference solves a monotone nonlinear equation by bisection at each implicit step; it does not use dual updates. It covers three timesteps for elastic and hard two-link spans. This is discrete-time agreement, not an exact continuum trajectory.

Static shooting uses constant horizontal tension and vertical tension jumps equal to the nodal weights. Hooke's law then gives each segment's complete vector directly. A scalar span-width root determines horizontal tension independently of time integration. Nine elastic cases use 8/16/32 segments at axial rigidities 500/1,000/5,000 N. Further 32-segment cases vary substeps at fixed rigidity. A separate eight-segment hard cable converges with `maxIterations=4096`, `residualTolerance=1e-12`, and `forceTolerance=1e-8 N`; its most demanding substep uses 2,493 iterations. Reducing that budget or relaxing its tolerances is not covered by that acceptance.

For the uniform cable plus central mass, an independent continuum integral gives half-width and sag. With reference half-length `S`, load per reference length `w`, central half-load `P/2`, horizontal tension `H`, and `V0=P/2`, `V1=V0+w*S`:

```
halfWidth = H/w * (asinh(V1/H)-asinh(V0/H)) + H*S/EA
sag = (hypot(H,V1)-hypot(H,V0))/w + (V0*S+w*S^2/2)/EA
```

Halving segment length reduces sag error **4.0008–4.0041 times**, consistent with second-order spatial convergence for these static cases. Finest-mesh sag errors are 0.04325–0.04738 mm. These finite errors remain even though the discrete equilibrium is solved much more tightly.

Focused tests also cover mixed hard/elastic 3D links, rigid rotation/translation of a nonlinear problem, applied forces on anchors, off-axis impulses, energy/momentum accounting, slack/coincident links, fixed stretched elastic links, missing/mismatched backend state, owned snapshots, and exact warm-start replay. The original backend reproduces all **702** previously qualified sampled states, full checkpoints and continuations exactly. The combined focused suite passes **36 tests**; TypeScript is checked separately. No full build or broad GPU timing run was needed for this numerical change.

The native browser review runs the new 32-segment span at 1/480-second substeps. At tick 6,391 it reads 20.11050 N support reaction against 20.1105 N static weight, with implicit residual 6.524e-7 N and no unconverged substeps. An off-axis impulse, second camera angle, switching to the original solver, and restoring the saved version-2 state all work without reported console warnings/errors. The settled tick reports 448 link visits including warm-start applications. That operation count is not a qualified timing gain.

The first hard-span test failed at the inherited 256-iteration cap. Subsequent tests exposed force jitter from positional tolerance. Those failure logs are retained with the final passing checks. Qualification run 01 passed; run 02 freezes the additional mixed-link, coordinate-invariance and evidence tests. The equations and thresholds were not loosened between those qualification runs.

```sh
node scripts/cable-proximal-qualify.mjs --check benchmarks/results/engine-100x/runs/proximal-cable-accuracy-20260911-02
node --test --test-concurrency=1 tests/engine/proximal-cable.test.mjs tests/qualification/proximal-cable-evidence.test.mjs
# New experiments require a new output directory.
node scripts/cable-proximal-qualify.mjs --out /absolute/path/to/new-run
```

The verification packet `verification-proximal-cable-20260911/` retains the source identities, raw-run references, browser observation, test logs and failed attempts. Material calibration, nonlinear continuum-time acceptance beyond the existing axial oscillator, bending, collisions, moving supports, rigid coupling, and adoption in Studio/cloth/rope remain open. The complete 100-item objective remains active; this result establishes no engine-wide or 100x speed claim.
