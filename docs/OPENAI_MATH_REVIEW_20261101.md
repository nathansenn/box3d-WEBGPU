# openai/math (October 2026) × box3d-WEBGPU: skeptical applicability review

*Research review, 2026-11-01. The glass measurements ran on scratch copies of seven source files exported from `bridge-water-20261003` (`ebae0da`); `src/engine/convex-contact.ts` is unchanged in the integrated tree.*

## 1. Bottom line

| Question | Answer |
| --- | --- |
| Catalogue revision read | [`openai/math@4eaee87548250b2682affda7d05d947c05554bae`](https://github.com/openai/math/tree/4eaee87548250b2682affda7d05d947c05554bae). This was the `main` HEAD when cloned on 2026-11-01. The commit is dated 2026-10-29 17:35 −0700 ("Merge pull request #4 from openai/codex/update-10-29"), and `overview.tex` is dated October 26, 2026. |
| Size | **373 families, 721 manuscript links, 17 disciplines.** This is the **same revision** reviewed in the pilot branch's docs, so nothing new has landed since that review. 245 of 373 families have a `[Lean]` link. The README states that about 42% of top-line results are formalized. A Lean link can cover less than the headline result: family 266 is an example (see §4). |
| Does anything give this codebase a faster algorithm, a tighter usable bound, or a correctness guarantee? | **No.** Zero *implement* verdicts are grounded in the mathematics. The nearest useful item is not a theorem. It is the verification engineering (an arithmetic contract plus a probe) from one computer-assisted proof (266). It has low value here. Two results that look like test oracles (hot spots, triangular-lattice energy) do not fit the solvers that actually exist in the repo. |
| Glass shard slowdown | **Nothing in the catalogue helps.** The hotspot is measured: `ConvexContactWorld.stepInterval` in `src/engine/convex-contact.ts` **rolls back the whole world and re-runs the step as two half-steps** (recursively, up to 10 levels) whenever *any* pair's continuous sweep runs out of iterations, penetration exceeds 0.2 mm, or contact discovery needs more than 4 rounds. 98% of rollbacks come from exhausted CCD sweeps. In a CPU profile of the first 1.76 simulated seconds, which the impact peak dominates, 82% of samples are inside re-run half-intervals. In addition, the broad and narrow phases are rebuilt about 20 times per step when the pile has settled and about 130 times per step at the peak. It is **not** an all-pairs O(n²) narrow phase, because the broad phase is sort-and-sweep. The fix is standard engineering: localized recovery, one broad phase per step with persistent pairs, sleeping and islands, and allocation-free math. Details are in §5. |

## 2. Method and sources

1. I made a shallow clone of `github.com/openai/math`. The `gh api` route to that repository is blocked in this session, but the git proxy serves anonymous clones. I parsed `overview.tex` (the `\cataloguesection`/`\resultentry` macros give the discipline, title and summary for each family) and `CONTENTS.md` (family → manuscript title, path and abstract). The result is a JSON catalogue of 373 families and 721 manuscripts.
2. I screened **all 721 abstracts** with keyword groups covering each requested topic:
   - iterative solvers (Gauss–Seidel, Jacobi, Kaczmarz, preconditioning, condition numbers)
   - contact and convex geometry (polytopes, Minkowski sums, separation, nearest neighbour, packing)
   - complementarity and optimization (LCP, friction, cones, LP/SDP/QP, projection)
   - rigidity and structural mechanics (frameworks, tensegrity, elasticity, stress, strain, plasticity)
   - fracture and connectivity (percolation, union-find, components, cracks, spanning trees, cuts)
   - PDE numerics (shallow water, conservation laws, CFL, discretization, Navier–Stokes, wave equations)
   - parallel algorithms (prefix sums, sorting, scheduling, coloring, matching)
   - floating point (rounding, interval arithmetic, certified computation, binary64, error bounds)
   - sampling and hashing (pseudorandomness, shuffles, expanders, derandomization)
   - rendering geometry (visibility, triangulation, Voronoi, convex hulls, k-sets, arrangements)
3. I read the full family summaries in TCS, combinatorics, convex/metric geometry, probability/statistical mechanics, PDE, real and complex analysis, functional analysis, dynamics and mathematical physics. For differential geometry, topology, algebra, group theory and logic I read the first ~170 characters of each summary. For number theory, algebraic geometry and operator algebras I read titles only. **23 families** got a close reading of their full manuscript abstracts plus `lean/docs/<id>.md` scope notes (§6).
4. I read the relevant code on `origin/bridge-water-20261003` (head `ebae0da1278d5412c2877dd91aea6a6c625238b5`) and `origin/codex/math-runtime-water-pilot-20261031` (head `4ef2d8cb30c748bfe200411bea48ae485716f9fd`), then profiled the glass lab (§5).

**Limits.** I read statements, abstracts and Lean scope notes, not proofs. I did not verify any manuscript. "Lean" below means the family's `lean/docs/<id>.md` describes a formalized statement, and I quote what that statement covers.

### Prior work on the pilot branch (not repeated)

[`docs/MATH_RUNTIME_PILOT.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/4ef2d8cb30c748bfe200411bea48ae485716f9fd/docs/MATH_RUNTIME_PILOT.md) and [`docs/NANITE_RENDERING_REVIEW.md`](https://github.com/nathansenn/box3d-WEBGPU/blob/4ef2d8cb30c748bfe200411bea48ae485716f9fd/docs/NANITE_RENDERING_REVIEW.md) already classify these as hypotheses, not accelerators:

- Crouzeix (325)
- "normalization" (probably 245)
- identity testing (116)
- "SAT" (probably 378, the ETH/#SAT family; the doc is ambiguous)
- matrix multiplication (107)
- Fourier (130)
- integer multiplication (109)

I agree. The asymptotic gains are galactic: δ = 10⁻¹³ for the FFT and κ = 2⁻¹⁸² for integer multiplication, and the box3d workloads are 4×4 transforms and grids of 10³–10⁵ cells. I mention them below only where they bear on a new question.

## 3. Discipline triage

| Discipline | Families | Closely read | Applicable |
| --- | ---: | ---: | ---: |
| Theoretical computer science | 41 | 8 (107, 109, 120, 124, 130, 136, 141, 378) | 0 |
| Combinatorics | 37 | 2 (174, 184) | 0 |
| Algebraic and complex geometry | 36 | 0 | 0 |
| Number theory | 31 | 1 (017) | 0 |
| Probability and statistical mechanics | 29 | 3 (213, 224, 238) | 0 |
| Differential geometry | 29 | 0 | 0 |
| Mathematical physics | 25 | 1 (266) | 0 (method only) |
| Operator algebras | 19 | 0 | 0 |
| Algebra | 18 | 0 | 0 |
| Topology | 18 | 0 | 0 |
| Real and complex analysis | 16 | 0 | 0 |
| Partial differential equations | 16 | 4 (366, 369, 372, 376) | 0 |
| Convex and metric geometry | 15 | 2 (090, 097) | 0 |
| Group theory | 14 | 0 | 0 |
| Dynamical systems and ergodic theory | 12 | 0 | 0 |
| Functional analysis | 11 | 2 (325, 328) | 0 |
| Mathematical logic | 6 | 0 | 0 |
| **Total** | **373** | **23** | **0** |

**The keyword screen found no manuscripts** on Gauss–Seidel or Jacobi convergence, PBD, LCP or complementarity, friction cones, contact or collision, framework or tensegrity rigidity, union-find or fragment detection, shallow-water or CFL stability, prefix sums or GPU algorithms, floating-point error analysis, hashing, or culling. The collection consists of results on open problems in pure mathematics and theoretical computer science. Its algorithmic results (109, 120, 121, 124, 130, 138, 142, 378) are asymptotic or concern unrelated problems.

## 4. Ranked candidates (by practical value for this code; all verdicts candid)

| # | Family | Lean? | Verdict |
| --- | --- | --- | --- |
| 1 | 266, MUBs in dimension six (its verification method only) | Partial; the computer-assisted part is not formalized | **Prototype (cheap), low value.** Useful only if cross-engine bit-exact replay matters. |
| 2 | 369, Hot spots (simply connected planar domains) | Yes | **Not worth it.** No solver in the repo matches the hypotheses. |
| 3 | 325, Complete Crouzeix | Yes | **Not worth it.** It is an analysis bound and changes no algorithm. |
| 4 | 238, Thorp shuffle Θ(log N) mixing | Yes | **Not worth it.** |
| 5 | 124, Three-machine unit-job scheduling | Yes | **Not worth it.** |
| 6 | 213 and 224, critical and Voronoi percolation | 213 yes, 224 no | **Not worth it.** |
| 7 | 366, Planar Mumford–Shah regularity | No | **Not worth it.** It would encode the wrong physics. |
| 8 | 372, Global uniqueness, isotropic elasticity | Yes (uniqueness only) | **Not worth it.** |
| 9 | 097, Euclidean Steinitz–Bergström | Yes (existential) | **Not worth it.** |
| 10 | 090, Universal optimality of the triangular lattice | Yes | **Not worth it.** |

### All fields at a glance

"If pursued" describes the smallest honest experiment. For items marked "not worth it", I recommend not doing it.

| # | Where in code | Concrete change (if pursued) | Expected benefit | Risk | How to verify |
| --- | --- | --- | --- | --- | --- |
| 1 (266) | Checkpoints in `src/studio/physics.ts`; the `convex-contact-sat-js-f64-v5` world; replay and archive gates | Add a bit-pattern fingerprint of `Math.*` results (optionally also WGSL) to checkpoints and archives, and downgrade exact comparisons when it differs | Clearer attribution of failures. No speedup. | Low (scope creep) | Fingerprints across Node and browsers. Unit test that a mismatch downgrades the comparison. |
| 2 (369) | None today. It would apply to `closed-water.ts` or `linear-water.ts` only if a constant-depth, non-rectangular basin existed. | Assert that the slowest mode's extrema lie on boundary cells | Weak oracle, dominated by exact discrete dispersion tests | False failures from staircase boundaries | — |
| 3 (325) | `FailureSimulation.step` (12 Gauss–Seidel sweeps) | Nothing from the theorem. Prototype Chebyshev or XPBD separately if iterations are a bottleneck. | None from the theorem | — | Residual-vs-cost curves for any acceleration prototype |
| 4 (238) | None (no GPU permutation in use) | Nothing. Use Fisher–Yates or sort-by-hash if a permutation is ever needed. | None | Loses determinism | — |
| 5 (124) | `src/runtime/execution-graph.ts`, workers | Nothing. Use critical-path list scheduling if the graph is ever parallelized. | None | Complexity | — |
| 6 (213, 224) | Fracture and fragment statistics, shard generation | Nothing | None | — | — |
| 7 (366) | Fracture-pattern validation | Do **not** use it as an oracle | None | Encodes the wrong physics | — |
| 8 (372) | Lab material calibration | Nothing (non-constructive) | None | — | — |
| 9 (097) | Summation order of impulses or residuals | Nothing (d = 3) | None | — | — |
| 10 (090) | `GranularModel` oracles | Nothing (3D hard spheres, not completely monotone potentials) | None | — | — |

Permalink base: `https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/`

### 1. Family 266: "Exactly three mutually unbiased bases in dimension six" (methodology borrow, not a theorem)

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/The-maximum-number-of-mutually-unbiased-bases-in-dimension-six-September-24-2026/The-maximum-number-of-mutually-unbiased-bases-in-dimension-six-September-24-2026.pdf) · [verification README](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/The-maximum-number-of-mutually-unbiased-bases-in-dimension-six-September-24-2026/verification/saved-run/VERIFY.md) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/266.md)
- **Formalization:** Partial. Lean proves only a weaker *five*-basis bound plus a Fourier-vanishing lemma. The three-basis result is a binary64 computer-assisted proof and is **not** formalized.
- **Statement:** N(6) = 3. The exclusion of a fourth basis is a complete certified run under an explicit **arithmetic contract**: IEEE binary64, round-to-nearest, correctly rounded √, `FLT_EVAL_METHOD == 0`, and no fast-math, reassociation or FMA contraction. A small `abi-fp-probe` program checks part of the contract on samples (the authors note it is not a proof), and an independent Python checker verifies the coverage and consistency of the saved numerical records without re-running the computation.
- **What transfers:** Only the engineering pattern. The theorem is irrelevant.
- **Where it would apply:**
  - The exact-replay and checkpoint machinery: the Studio checkpoints in `src/studio/physics.ts` (`studio-pbd-js-v1`, "full precision solver state") and the glass world `convex-contact-sat-js-f64-v5`.
  - Both call `Math.sin/cos/exp/pow/hypot`, which ECMAScript does not require to be correctly rounded. Bit-exact replay across JS engines or engine versions is therefore not guaranteed.
  - The WASM soft kernels already compile with `-ffp-contract=off` (`scripts/build-soft-kernels.sh`). The WGSL water pilot already treats GPU arithmetic as tolerance-compared.
- **Concrete change:** Add an "arithmetic fingerprint": hash the bit patterns of about 50 fixed inputs through the transcendental `Math.*` calls the solvers actually use. Store it in checkpoints and replay archives. When fingerprints differ, report "environment changed" instead of "trajectory mismatch".
- **Benefit:** Clearer attribution when exact gates fail, and no phantom regressions across browsers. **No speedup.**
- **Risk:** Low. The main risk is spending effort on a non-goal if cross-engine replay is not required.
- **Verify:** Compute fingerprints on Node 22 and 24, Chromium, Firefox and Safari. Add a unit test that a mismatched fingerprint downgrades an exact comparison to a tolerance check.
- **Checked and ruled out:** This does **not** explain the known rope-batching archive failure (stress 2, scene 650, frame 0). [`scripts/rope-batching-qualification.mjs`](https://github.com/nathansenn/box3d-WEBGPU/blob/4ef2d8cb30c748bfe200411bea48ae485716f9fd/scripts/rope-batching-qualification.mjs) runs both builds in the same Node process with the same WASM, so the environment's arithmetic is identical for both.

### 2. Family 369: "The hot spots conjecture for simply connected planar domains"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/Strict-hot-spots-and-absence-of-interior-critical-points-on-smooth-simply-connected-planar-domains-September-24-2026/main.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/369.md)
- **Formalization:** The full strict statement is formalized.
- **Statement:** On a smooth, bounded, simply connected planar domain, every first nonconstant Neumann eigenfunction has no interior critical point, so its extrema lie on the boundary.
- **Possible use:** A test oracle for the slowest sloshing mode of constant-depth linear shallow water with zero normal flux (η_tt = gH Δη, ∂η/∂n = 0) on **non-rectangular** basins.
- **Fit to the code:** None today.
  - `src/engine/closed-water.ts` and `src/engine/linear-water.ts` are documented as "closed, rectangular, flat-bottom". The fixed-grid `src/soft` water and the GPU water pilot are also rectangular. For rectangles the mode is cos(πx/L) in closed form, and the discrete C-grid dispersion relation is a much sharper oracle.
  - `LiquidModel` (`src/studio/material-labs/models.ts`) has a variable bed and masks. Its operator is ∇·(h∇·), not the Laplacian, and it can be multiply connected, where hot-spot counterexamples exist.
  - Staircase grid boundaries are not smooth, so any check would have to be "soft".
- **Verdict:** **Not worth it.** Revisit only if a constant-depth, simply connected, non-rectangular basin solver is added.

### 3. Family 325: "The complete Crouzeix conjecture"

- **Links:** [direct proof](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/A-direct-proof-of-the-complete-Crouzeix-inequality-September-26-2026/paper.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/325.md)
- **Formalization:** Yes.
- **Statement:** ‖P[A]‖ ≤ 2 sup over W(A) of ‖P(z)‖, and the constant 2 is sharp.
- **Possible use:** An a-priori bound for polynomial-accelerated iterations with non-normal iteration matrices, such as Chebyshev semi-iterative acceleration of Jacobi or PBD.
- **Fit to the code:** `FailureSimulation.step` in `src/studio/physics.ts` runs 12 symmetric Gauss–Seidel sweeps over **nonlinear** distance constraints, and links break or yield during the sweeps.
  - The iteration operator changes every step, and computing its numerical range is impractical.
  - Earlier constants (for example 1+√2, Crouzeix–Palencia 2017) already sufficed for any engineering use. Tightening the constant to the sharp 2 changes no decision.
- **Verdict:** **Not worth it**, which matches the pilot doc. If iteration count becomes a bottleneck, prototype Chebyshev acceleration, XPBD compliance or "many substeps, one iteration" on their own merits. None of them needs this theorem.

### 4. Family 238: "Optimal logarithmic mixing of the Thorp shuffle"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/Optimal-order-mixing-of-the-Thorp-shuffle-September-26-2026/paper.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/238.md)
- **Formalization:** Yes.
- **Statement:** Θ(d) shuffles mix 2^d cards. The explicit upper bound is **1600d** rounds (512d in a companion), against a lower bound of 2d − O(1).
- **Possible use:** GPU-friendly random permutations, for example randomized constraint order or particle sampling.
- **Fit to the code:** None.
  - The code deliberately avoids randomized ordering. `physics.ts` says: "Alternate order reduces directional bias without randomizing reproducibility."
  - Where a permutation is needed, Fisher–Yates (CPU, O(n)), sort-by-hash, or a keyed Feistel bijection on the GPU are far cheaper than ≥ 512·log₂N exchange rounds.
- **Verdict:** **Not worth it.**

### 5. Family 124: "Polynomial-time scheduling on three identical machines"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/A-polynomial-time-algorithm-for-three-machine-unit-job-scheduling-September-24-2026/paper.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/124.md)
- **Formalization:** Yes.
- **Statement:** Exact minimum makespan for unit-length jobs with precedence constraints on **three** machines.
- **Possible use:** Scheduling `ExecutionGraph` nodes (`src/runtime/execution-graph.ts`) or worker tasks.
- **Fit to the code:** None. The graph is synchronous, single-threaded and demand-driven. Its tasks are not unit length, and the worker count is not 3. Ordinary list scheduling on the critical path is within 2 − 1/m of optimal and trivial to implement.
- **Verdict:** **Not worth it.**

### 6. Families 213 and 224: critical percolation and Voronoi percolation

- **Links:** [213](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/No-percolation-at-criticality-on-quasi-transitive-graphs-September-24-2026/paper.pdf) (Lean) · [224](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/From-critical-crossings-to-quenched-near-critical-universality-in-Voronoi-percolation-October-5-2026/critical-crossings-quenched-near-critical-universality-voronoi-percolation.pdf) (manuscript only)
- **Statements:** 213: no infinite cluster at p_c on quasi-transitive graphs. 224: Cardy's formula and near-critical universality for Poisson–Voronoi percolation.
- **Possible use:** Statistical oracles for fragment connectivity, or for Voronoi-based shard generation.
- **Fit to the code:** None. These are scaling-limit statements on infinite graphs. The studio failures are small, deterministic and load-driven. The glass shards come from a fixed radial/ring triangulation (`GlassModel` constructor, `models.ts` lines 144–149), not Voronoi cells.
- **Verdict:** **Not worth it.**

### 7. Family 366: "The planar Mumford–Shah regularity conjecture"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/Interior-regularity-of-planar-Mumford-Shah-minimizers-September-24-2026/Interior-regularity-of-planar-Mumford-Shah-minimizers-September-24-2026.pdf)
- **Formalization:** None (manuscript only).
- **Statement:** The crack set of a planar Mumford–Shah minimizer is locally a C^{1,α} arc, a crack tip, or three arcs meeting at 120°.
- **Risk of misuse:** It is tempting as a crack-geometry oracle ("Y-junctions at 120°"). However, it describes static minimizers of a scalar segmentation-type energy. Dynamic brittle fracture in glass and crack branching follow different physics.
- **Verdict:** **Not worth it.** Do not use it to validate fracture patterns.

### 8. Family 372: "Global uniqueness in smooth isotropic elasticity"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/Global-Uniqueness-for-the-Smooth-Isotropic-Elasticity-Inverse-Problem-September-24-2026/article.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/372.md)
- **Formalization:** Yes. Lean scope: "uniqueness; it does not supply a reconstruction algorithm".
- **Possible use:** Identifiability for material calibration in the labs.
- **Fit to the code:** None. It needs the full boundary displacement-to-traction map of a smooth continuum. The labs are reduced PBD or particle models with no Lamé fields.
- **Verdict:** **Not worth it.**

### 9. Family 097: "The Euclidean Steinitz–Bergström conjecture"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/The-Euclidean-Steinitz-Bergstrom-theorem-September-24-2026/The-Euclidean-Steinitz-Bergstrom-theorem-September-24-2026.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/097.md)
- **Formalization:** Yes. The result is existential, with "no online algorithm".
- **Statement:** Signs exist that keep every partial sum within C√d.
- **Possible use:** Reordering impulse or residual sums to bound rounding error.
- **Fit to the code:** None. Here d = 3, and the classical Steinitz bound (≤ d) is already O(1). Solver order is dictated by physics and determinism, not summation error.
- **Verdict:** **Not worth it.**

### 10. Family 090: "Universal optimality of the triangular lattice"

- **Links:** [manuscript](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/preprints/Universal-optimality-of-the-triangular-lattice-September-23-2026/paper.pdf) · [Lean scope](https://github.com/openai/math/blob/4eaee87548250b2682affda7d05d947c05554bae/lean/docs/090.md)
- **Formalization:** Yes.
- **Possible use:** An energy lower bound as a test oracle for 2D particle systems with completely monotone pair potentials.
- **Fit to the code:** None. `GranularModel` (`models.ts`) is a 3D PBD sphere model with hard non-penetration constraints. It has no completely monotone potential and no 2D periodic system.
- **Verdict:** **Not worth it.**

## 5. Glass shard-contact slowdown: measured assessment

### 5.1 Setup

| Item | Detail |
| --- | --- |
| Source | Seven files exported from `origin/bridge-water-20261003` (`ebae0da`) into a scratch directory, with extensionless imports rewritten to `.ts`. The files are `models.ts`, `catalog.ts`, `liquid-config.ts`, `liquid-terrain.ts`, `glass-rig.ts`, `glass-pendulum.ts` and `src/engine/convex-contact.ts` (backend `convex-contact-sat-js-f64-v5`). |
| Scene | Default glass lab: annealed pane, radial impact, seed 42, DT = 1/120 s. |
| Bodies | **364 shards.** The pane is built from 28 angles × (2·7 − 1) rings of triangular prisms; the tempered preset gives 46 × 23 = 1,058. There are 394 contact bodies including fixtures, floor and pendulum. |
| Runtime | Node v22.23.4 with `--experimental-strip-types`, on a 4-vCPU "Intel Xeon @ 2.10 GHz" container. |
| Sample size | One run per configuration. |

### 5.2 Step cost over the 12 s lab (baseline, light method-wrapping instrumentation)

| Window (simulated s) | Mean ms/step | Max ms/step | Contacts | Slower than real time |
| --- | ---: | ---: | ---: | ---: |
| 0–0.5 (pendulum falling) | 2–4 | 22 | 0 | — |
| 0.75–1.25 (fracture, release) | 87–128 | 223 | 377–1,239 | 10–15× |
| **1.50–1.75 (shards hit the tray)** | **1,044** | **1,648** | 1,361 | **≈125×** |
| 2.0–2.5 | 306–446 | 1,281 | 1,673–2,206 | 37–53× |
| 2.75–12 (settled pile, never sleeps) | 159–198 | 507 | 2,200–2,600 | ≈19–24× |
| **Whole 12 s run** | 296 s of wall time | | | **24.7×** |

Without instrumentation (§5.5), the same peak window measured 875 ms/step. The user's "about 1 s per step" matches the impact and pile-up phase. The settled pile still costs about 180 ms per step because the 345 dynamic shards never sleep.

For comparison, the September version-1 qualification table in `docs/GLASS_CONTACT.md` reports 62.98 s per 12 s for `radial-impact`, on an unrecorded machine and with an earlier contact backend. That is not comparable to these numbers. The doc records that v5 (2026-09-25) began rejecting the full step on exhausted sweeps ("Exhausted sweep, contact-discovery and endpoint checks now reject the full step"), and that is consistent with the cost below.

### 5.3 Where the time goes

**CPU profile, t = 0–1.76 s (49.6 s sampled):**

- **82.4%** of samples are under the `retry` closure (`convex-contact.ts`, line 418). That is, they belong to re-simulated half-intervals after a whole-world rollback.
- Self time:

  | Function | Self time |
  | --- | ---: |
  | SAT axis projection (`convexSeparation` `axis`, line 119) | 12.4% |
  | Garbage collector | 12.1% |
  | `candidates()` broad phase | 11.5% |
  | `separatingAxisMiss` | 8.8% |
  | `ConvexBody.at()` (allocating pose copies) | 7.1% |
  | `currentAxisGap` | 2.9% |
  | `advanceQuaternion` | 2.2% |

**Rollback triggers** (instrumented scratch copy, t = 0–2 s):

| Trigger | Count | Share |
| --- | ---: | ---: |
| Exhausted continuous sweep (`appendContact`, lines 444–447) | 519 | **98.3%** |
| Penetration above 0.2 mm (line 597) | 8 | 1.5% |
| More than 4 discovery rounds (line 535) | 1 | 0.2% |

- In t = 1.50–1.75 s, 30 steps executed **486** sub-intervals, down to refinement level 5 (1/32 of a step).
- Per step in that window there were about **132 `candidates()` calls, about 170k `queryPair` calls and about 150k `separatedByHint` calls**.

**Settled pile, t = 3–4 s (120 steps, 178 ms/step, 2,490 contacts):** Rollbacks fall to 5% of samples, and repeated collision detection dominates.

| Function | Self time | Inclusive time |
| --- | ---: | ---: |
| SAT axis projection | 16.4% | — |
| Garbage collector | 10.1% | — |
| `candidates()` | 9.6% | — |
| `separatingAxisMiss` | 7.6% | — |
| `at()` | 5.2% | — |
| `queryPair` | — | 22.8% |
| `convexSeparation` | — | 20.1% |
| `sweepConvexWithHint` | — | 12.7% |
| Actual constraint solving (PGS `solve` plus `projectContactPositions`) | — | about 11% |

In this window there are about **21 broad-phase rebuilds and about 24k pair queries per step**, for roughly 10³ candidate pairs.

### 5.4 Root cause in the code (`src/engine/convex-contact.ts` @ `ebae0da`)

1. **Global rollback for local problems.**
   - `stepInterval` (line 416) wraps the whole world. `retry` (lines 418–427) restores **all** bodies and re-runs `dt/2` twice.
   - It is triggered by any single exhausted pair sweep (line 445, up to `MAX_CCD_REFINEMENT = 10` levels, line 18), by penetration above 0.2 mm (line 597, up to 5 levels), or by discovery overflow (line 535).
   - One spinning sliver can therefore force re-simulation of all 394 bodies on ever smaller intervals. I observed depths down to level 5 (1/32-step intervals); the cap allows 10.
2. **Expensive CCD that often fails to converge.**
   - `sweepConvexWithHint` (line 246) bisects a time interval. It must localize contact to within `CONTACT_SKIN + 0.2·CONTACT_SKIN` = 12 µm, uses a rotational chord padding of r·ω²·Δt²/8, and is capped at **48** SAT visits (lines 274 and 402).
   - Each visit runs a full prism–prism SAT (5 + 5 face axes plus 16 edge×edge axes, each projecting 12 vertices) and allocates fresh poses with `at()`.
   - Thin, spinning shards drive the padding up, so the 48-visit cap is hit often.
3. **Broad and narrow phase redone many times per step.**
   - `candidates()` is a single-axis sort-and-sweep, which is fine on its own (O(n log n + k)). But it is called again with fresh `at()` poses for all bodies:
     - once at the start (line 430)
     - in each of up to 5 discovery rounds in each of 4 substeps (lines 478–521)
     - in each of up to 6 position-projection passes (line 576)
     - once in the final penetration check (line 593)
   - All of that is multiplied by the number of re-run sub-intervals. **This is the O(work × repetitions) problem, not O(n²).**
4. **Allocation-heavy vector math.** `add`, `sub`, `mul`, `cross` and `at()` all return fresh arrays, so garbage collection takes 10–12% of samples.
5. **No sleeping or islands.** 345 dynamic shards stay awake for the full 12 s, and the phase stays "Fractured · releasing".

### 5.5 Scratch prototype: is the rollback really the lever?

I made one change in a scratch copy, never in the repo. An exhausted sweep now **keeps its conservative lower-bound time `q.lo`** (every earlier time has been excluded) as a speculative contact instead of calling `retry()`. All other triggers and gates are unchanged. Both runs below use the same counters and no method wrappers, over t = 0–4 s (481 steps).

| Metric | Baseline | Sweep-rollback removed |
| --- | ---: | ---: |
| Wall time, 0–4 s | 111.6 s | **83.7 s (1.33×)** |
| p50 / p95 / max ms per step | 166.5 / 828.3 / 1,189 | 163.6 / **519** / 1,436 |
| Peak window 1.50–1.75 s, mean ms/step | 875 | **625 (1.4×)** |
| Rollbacks: sweep / penetration / discovery | 528 / 47 / 8 | 0 / 48 / 21 |
| Sub-intervals executed | 1,647 | 619 |
| Max penetration | ≤ 0.2 mm | ≤ 0.2 mm |

**Reading:** Removing one rollback trigger helps, but only by about 1.3–1.4×. Rollbacks shift to the penetration and discovery triggers: 58% of peak-window samples are still under `retry`. In addition, 1,198 accepted exhausted sweeps each still cost 48 SAT visits. The lesson is that the *policy* of whole-world rollback has to go entirely, and CCD has to become cheaper.

These are single runs. The trajectories diverge after the first changed step, so the two runs see different physical states. Physical acceptance (the 0.5 mm overlap gate across all 8 presets, energy, and the clamps) was **not** re-qualified. This is evidence about where the cost is, not a candidate patch.

### 5.6 What to do (standard engineering; none of it comes from the catalogue)

| # | Change | Where | Expected benefit | Risk | How to verify |
| --- | --- | --- | --- | --- | --- |
| 1 | **Localize recovery.** Never roll back the world for a pair-local event. Exhausted sweep: use `q.lo` as a speculative contact (prototyped above). Penetration or discovery overflow: sub-step only the affected island (bodies connected through contacts), or let the next projection pass fix it within the 0.5 mm gate. | `stepInterval` / `retry`, lines 416–427, 444–447, 535–538, 597–600 | Removes most of the 58–82% "re-run" share at the peak. Combined with #2 it should also flatten p95. | Trajectories change, so the exact-replay receipts (accepted tick 116 and others) must be re-baselined. Overlap gates must be re-run. | 8-preset qualification (overlap ≤ 0.5 mm, zero unresolved, clamps unchanged). Step-time p50/p95/max on the windows above using the scratch harness (§8). |
| 2 | **One broad phase per step, with persistent pairs.** Build fattened swept AABBs once per step (they must enclose the full Δt, including the rotation chord bound) and reuse the pair list across substeps, discovery rounds, projection passes and the final check. Keep the sort order incrementally (insertion sort on a nearly sorted list) or use a uniform grid; `GranularModel.step` in `models.ts` already has a linked-cell hash grid. Keep per-pair manifolds and separating-axis hints across steps (hints already exist). | `candidates()` (line 369) and every call site | Removes most of the `candidates` and `at()` time (≈15–19% self time) and much of the repeated SAT. My estimate is 1.5–3× for the settled pile; this is not measured. | A fat AABB that is too small misses pairs. It must stay conservative. | Property test: on recorded states, the new candidate set must be a superset of every set the current per-call `candidates()` produces. Then timing. |
| 3 | **Cheaper CCD policy.** Use continuous sweeps only against static geometry (tray, floor, clamps) and for fast or thin "bullet" shards. Use speculative margins for slow dynamic–dynamic pairs, as Box2D v3 does. When chord padding is large, sub-step that *pair*, not the world. Skip the 16 edge×edge axes when a face axis already separates by more than the skin. | `predictContact` / `sweepConvexWithHint` (lines 246–278), `convexSeparation` | Cuts the 48-visit sweeps (≈30% inclusive at the peak in the prototype). | More speculative contacts can produce "ghost" collisions, so tune the margins. | Same as #1, plus a tunnelling fixture: a thin, fast shard against the tray at 1/120 s. |
| 4 | **Sleeping and islands.** Use island velocity thresholds with a timer, and wake an island when its contacts change. | `ConvexContactWorld` and the glass `advanceStep` | The settled pile (≈180 ms/step for about 10 s of the lab) should become nearly free. | Sleep decisions must stay deterministic. The retention presets (laminated, wired) use spring "held" forces and need wake rules. | Measure step time from t = 3 s on. Replay-determinism test. Visual check that no shard freezes in mid-air. |
| 5 | **Allocation-free hot paths.** Use structure-of-arrays `Float64Array` poses, an in-place `at()`, and inline SAT projections. | `ConvexBody.at` (line 77), `convexSeparation` (line 115), vector helpers | Up to about 10% (GC) and better cache behaviour. | The previous "SAT allocation rewrite" measured **0.9355×**, i.e. slower (`GLASS_CONTACT.md`), so gate this on a benchmark rather than assuming it helps. | Paired benchmark against the existing projection harness. |
| 6 | *(Larger decision)* **Simulate shards in the native Box3D world (C/WASM).** It already has a dynamic-tree broad phase, islands, sleeping, a substepping soft-step solver, and hull support (`docs/NATIVE_WORLDS.md` mentions a per-context hull cache). | `src/engine/native-world.ts` | Box2D-class engines run thousands of bodies in real time. | It uses f32 and different contact semantics. The JS f64 world exists for auditable exactness, so this needs its own qualification. | Port one preset and compare overlap and settle statistics plus timing. |
| 7 | **Keep the offline exact-certificate program out of the runtime path.** `docs/GLASS_CONTACT.md` describes residual targets of 1e-6 m/s, 96-digit certificates, and friction-cone duals for a single captured tick with 6,023 contacts. | Process | It improves single-tick accuracy and has no route to interactive speed. Its own logs record 54–211 s per solve or replay of one to two ticks. | — | — |

**Bottom line on speed:** The partial form of #1 measured 1.33× overall and 1.4× at the peak. A complete #1 that also localizes the penetration and discovery triggers should do better, but I have not measured it. Getting close to real time (8.3 ms/step) for about 345 tumbling prisms and about 2,500 contacts in JS will likely need #1 through #5 together, or #6. Today the actual constraint solve is only about 11% of a settled step. The rest is collision-detection repetition, rollbacks and GC.

### 5.7 Why the catalogue cannot help here

The bottlenecks are control-flow policy (whole-world rollback), data-structure reuse (the broad phase), memory allocation, and missing sleeping. None of these is an open mathematical problem.

The catalogue's TCS results are asymptotic or concern complexity. Its convex-geometry results concern high-dimensional volume and covering inequalities. Its probability results are scaling limits.

The pursuit of exact frictional contact in `GLASS_CONTACT.md` runs into a classical obstacle that is not in the catalogue: Baraff (SIGGRAPH 1991) showed that a consistency problem for rigid contact with Coulomb friction is NP-complete. The catalogue's hardness results (136 PCP-for-PPAD, 141 ETR in the counting hierarchy, 117 sparsest cut) do not cover this problem and supply no algorithms.

## 6. Not-applicable list (summary)

- **Closely read and rejected (23 families):**

  | Reason | Families |
  | --- | --- |
  | Galactic asymptotics; already covered by the pilot review | 107, 109, 130, 378 |
  | No matching or thin-tree problem in the pipeline; thin trees satisfy the opposite inequality to a preconditioner | 120, 174 |
  | Constraint graphs contain large cliques, so greedy Δ+1 coloring is what's used | 184 |
  | Hardness results only | 136, 141 |
  | Asymptotic irrationality measure; binary64 argument-reduction worst cases are already enumerated exhaustively | 017 |
  | Infinite-dimensional fixed-point theorem; trivial in finite dimensions | 328 |
  | Universal computation in forced Navier–Stokes; no numerics content | 376 |
  | Ranked above with candid verdicts | 266, 369, 325, 238, 124, 213, 224, 366, 372, 097, 090 |

- **Rejected at triage (350 families).** By discipline: algebraic and complex geometry 36, number theory 30, TCS 33, combinatorics 35, probability 26, differential geometry 29, mathematical physics 24, operator algebras 19, algebra 18, topology 18, real and complex analysis 16, PDE 12, convex/metric geometry 13, group theory 14, dynamics 12, functional analysis 9, logic 6. All are results in pure mathematics or complexity theory. Some are asymptotic algorithms for unrelated problems (104 mean-payoff games, 121 edit distance, 138 subset sum, 142 polynomial factorization). None has algorithmic, numerical-analysis or computational-geometry content that maps onto rigid-body, PBD, shallow-water or rendering code.

## 7. Could not access, and uncertainty

- The `gh api` route to `openai/math` is blocked in this session ("GitHub access to this repository is not enabled"). The anonymous git clone worked, and the catalogue above comes from it. I did not open the PDFs. I relied on abstracts, family summaries and Lean scope notes.
- The `benchmarks/experiments/glass-*` packets cited in `GLASS_CONTACT.md` are not in git, so I could not inspect the pre-v5 sweep-exhaustion behaviour to confirm that v5's whole-step rejection caused a regression.
- All timings are single runs on a shared 4-vCPU container. Method-wrapping instrumentation adds about 15–20% at the peak, which explains 1,044 vs 875 ms/step. Speedup estimates for items #2–#6 are engineering judgement, not measurements.
- No physical re-qualification was done for the prototype.

## 8. Reproduction

The analysis scripts were scratch-only and are not part of the repository. To repeat it:

- **Catalogue:** clone `https://github.com/openai/math` at `4eaee87548250b2682affda7d05d947c05554bae`, parse the family/manuscript index, and screen abstracts by the keyword groups in §2.
- **Glass profile:** run the glass lab's default radial-impact program (`createModel('glass', …)` from `src/studio/material-labs/models.ts`) for 12 model seconds under `node --cpu-prof`. Count which trigger calls `retry()` in `ConvexContactWorld.stepInterval`: an unconverged sweep, penetration above the limit, or discovery overflow.
