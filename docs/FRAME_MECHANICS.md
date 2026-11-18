# Linear frame mechanics

`frame-eb-midpoint-js-f64-v1` adds a distinct physical frame model: axial force, bending in two planes and torsion, with six degrees of freedom per node and consistent mass. The existing Studio bridge still uses its authored PBD model. Coupled cable/deck mechanics and calibration remain required before adopting this backend there.

The local [frame study](http://127.0.0.1:4401/frame-probe.html) provides cantilever loading, supported-beam gravity, bending vibration, torsional vibration, static analysis, fixed stepping, full checkpoints and analytical overlays. Drawing magnification does not change physical state. Rendering stops while paused except when controls or viewport size change.

## Equations and scope

The element uses cubic Hermite bending interpolation and linear axial/twist interpolation. The energy formulation follows [Duke's structural-element notes](https://people.duke.edu/~hpgavin/StructuralDynamics/StructuralElements.pdf); [TU Delft's beam formulation](https://teachbooks.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html) describes the Hermite interpolation and Euler–Bernoulli assumptions.

Inputs are `E` and `G` in Pa, `A` in m², area moments `Iy`, `Iz` and torsion constant `J` in m⁴, and density in kg/m³. Torsional mass inertia uses `rho * (Iy + Iz)`, distinct from `rho * J`. Optional point masses use kg and global diagonal point inertias use kg m². Local x follows endpoint a to b; projected `up` defines y, with z = x cross y.

Translations use metres and rotations radians. Forces/impulses use N/N s; moments/angular impulses use N m/N m s. Gravity is the consistent load `Fg = M g`, including equivalent nodal moments. Fixed degrees of freedom remain at zero displacement and velocity.

For substep `h`, mass damping rate `r`, constant nodal load `f`, displacement `u` and velocity `v`, implicit midpoint solves:

```
A = (1 + r*h/2)*M + (h*h/4)*K
b = M*v + (h/2)*(f + Fg - K*u)
A*v_mid = b
u_next = u + h*v_mid
v_next = 2*v_mid - v
```

The global solve uses element products and diagonal preconditioning. Translational/rotational residuals have separate N/N m tolerances. Apparent convergence is checked against a fresh matrix product; iteration caps remain visible. Short forced conjugate-gradient restarts were removed because they discarded needed bending directions in slender static beams.

An impulse solves `M_ff * delta_v = J_free`; consistent mass makes diagonal division incorrect. Energy records include kinetic/elastic energy, gravity potential, external work and mass-damping dissipation. Unforced, undamped linear midpoint dynamics preserve quadratic energy up to solve and rounding error, while continuum phase still has time-discretization error.

Transverse shear, bending rotary inertia, geometric stiffness, finite rotations, buckling, yielding, fracture and contact are omitted. The declared screen flags nodal rotation above 0.1 rad, axial strain above 0.01 or transverse slope above 0.1. The slope check includes stationary points inside the cubic beam, not only nodes or its chord. These thresholds are domain indicators, not yield values or proof of physical accuracy. Static solutions include the same screen.

## State and force contracts

`step()` advances integer ticks with ordered force/impulse commands. `inspect()` returns owned numeric copies. `solveStatic()` is pure: it does not advance, settle, reset or replace dynamic state.

- Dynamic `supportReactions` use the final substep midpoint, identified by `reactionTime`. They are distinct from accumulated full-tick support impulses.
- Dynamic `elementElasticForces` are local `K_e * u_e` energy gradients, not equilibrated section tractions.
- Static `elementEndForces` subtract consistent element gravity from `K_e * u_e`. Unloaded free ends have zero force/moment, and member end actions balance at unloaded joints. Point loads and point-mass gravity remain joint loads. Dynamic section-force recovery remains separate work.
- `impulses.support`, `.applied` and `.drag` retain generalized impulses for the last complete tick. Angular momentum explicitly uses reference coordinates and small-rotation kinematics.
- Checkpoints contain the definition, state, loads, reactions, work, impulses and diagnostics. JSON restoration preserves exact continuation; input and snapshot buffers remain independently owned.

Limits are 4,096 nodes, 8,192 elements, 16 substeps and 1,024 iterations, subject to a combined two-million estimated element-visit budget per request. Up to 120 ticks and 64 commands may be batched when that bound permits. The runtime does not allocate a dense global matrix. These are work/capacity guards, not maximum-size performance acceptance.

## Accepted evidence

`benchmarks/results/engine-100x/runs/frame-accuracy-20260911-04/` retains **52 cases, 704 full sampled states and 24,980 checked outer ticks** under protocol version 4. Its auditor re-executes every case, every-tick diagnostics, static result, checkpoint and 17-tick continuation. Independent Gaussian integration and dense Cholesky dynamics check the production matrix tables and conjugate-gradient solver on small spatial frames.

Four cases are explicit negative/domain checks: under-convergence, a loaded static mechanism, excessive static deformation and a freely rotating frame beyond the linear domain. They remain in the evidence and do not count as physically accepted examples. The following maxima exclude those four cases.

| Check | Largest observed error |
| --- | ---: |
| Analytical static displacement/rotation | 6.583e-14 m or rad |
| Analytical support force/moment | 1.290e-8 N or N m |
| Analytical equilibrated end force/moment | 1.290e-8 N or N m |
| Exact discrete oscillator displacement/rotation | 2.680e-17 m or rad |
| Exact discrete oscillator velocity | 2.357e-14 m/s or rad/s |
| Independent dense displacement/rotation | 4.119e-11 m or rad |
| Independent dense velocity | 3.475e-9 m/s or rad/s |
| Accumulated energy/work balance | 3.076e-12 J |
| Independent linear impulse balance | 1.203e-10 N s |
| Independent linearized angular impulse balance | 5.404e-11 N m s |

Halving the time step reduces axial/torsional continuum error by factors **3.966–3.999** over 20 periods and bending error by **3.999–4.031** over one period. Energy conservation alone does not imply accurate phase: the coarsest oscillator reaches 0.394 normalized continuum error after 20 periods despite matching its exact discrete midpoint trajectory.

For 2/4/8/16 bending elements at 1,024 steps per period, unadjusted normalized continuum errors are `0.00230860, 0.000142304, 0.00000507740, 0.0000144753`. Mesh and time phase errors can cancel, so these errors are not monotonic. Removing the analytically known midpoint phase of the continuum frequency gives a separate mesh diagnostic: `0.00232370, 0.000157409, 0.0000100277, 0.000000629900`, decreasing by **14.762–15.920**. This diagnostic does not replace the retained physical-time errors.

The live 2 m cantilever reproduces **-4.444444 mm and 10 N** under a -10 N tip load. The supported gravity case reproduces **-0.681250 mm and 39.24 N**. Checkpoint restoration reproduces displayed metrics exactly. The verification packet records the browser observations and their limits.

Run 01 failed its model-domain gate. Run 02 added an explicit out-of-domain example and a separate small-load free frame, but a mutation test exposed incomplete coarse modal acceptance. Run 03 required every bending case to meet a one-percent normalized continuum-error bound. Run 04 distinguishes elastic gradients from static end actions and checks analytical end forces. Earlier runs and failure logs are preserved.

Reproduce the bounded checks with one worker:

```sh
node scripts/frame-qualify.mjs --check benchmarks/results/engine-100x/runs/frame-accuracy-20260911-04
node --test --test-concurrency=1 tests/engine/frame.test.mjs tests/qualification/frame-evidence.test.mjs tests/engine/proximal-cable.test.mjs tests/engine/compliant-cable.test.mjs tests/engine/runtime.test.mjs
./node_modules/.bin/tsc --noEmit
```

Use `--out NEW_DIRECTORY` for new evidence; existing run directories are refused. No timing speedup, calibrated bridge response, Cosserat cable implementation, complete roadmap or completion of the month-long goal is claimed.
