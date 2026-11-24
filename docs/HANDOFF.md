# Handoff — 2026-11-24

State of the work on branch `claude/upbeat-archimedes-k21g6x` (pull request #19 to `main`), what is unfinished, and the
decisions that are the owner's. Work stopped here at the owner's request.

## What this branch holds

Round three of the engine work, on top of #18 (merged to `main` as `5f0454d`):

| Strand | Where | Status |
|---|---|---|
| Mortar segment-to-segment contact between deformable solids | `src/engine/solid-solid-contact.ts`, kit `./solid-contact` | done, validated |
| Concrete strength-factor fix | `src/engine/concrete-law.ts` | done; post-peak law unchanged (see open decisions) |
| Glass study: fragments collide, implicit fine cells | Studio glass lab | done |
| Faster tetrahedral FEM (sparse LDLᵀ kernels, ordering, contact line search) | `src/engine/sparse-ldl.ts`, `solid-contact.ts` | done; every press preset above real time |
| Dynamic resolution, shadow reuse, frames on demand | `src/perf/dynamic-resolution.ts`, Studio and labs | done |
| GPU scene sections, kit `./gpu` | `src/engine/gpu/` | done; no real GPU run |
| Smaller WebAssembly, faster first step | `wasm/`, `scripts/wasm-cold-functions.mjs`, `docs/WASM_SIZE.md`, kit `dist/rigid.js` + `dist/shared.js` | done; bit-identical; 47/47 and 10/10 gates on `620879f` |
| Flow solver: lattice-Boltzmann flow around and through geometry, kit `./flow`, `./flow-bundle`, `./flow-three` | `src/engine/flow*.ts`, `src/engine/gpu/flow-gpu.ts`, `docs/FLOW.md`, `validation/domains/flow.mjs` | merged in the last commit; see "Verification of the last merge" |

## Verification of the last merge (the flow solver)

- **On the flow branch (`work/flow` at `7e4c966`, before the merge):** `validate:pr` passed 47/47 (827 of 827 validation cases), `validate:studio` passed 10/10, and `verify:source` passed. Each ran once, uninterrupted.
- **On the merge commit:**
  - Done: the kit build, the API report, the validation report, the pack test and the source manifest. The package size budget was re-measured.
  - **Not run:** `validate:pr` and `validate:studio`, because work stopped at the owner's request. Run both before merging #19:
    ```bash
    npm run validate:pr
    ```
    ```bash
    npm run validate:studio
    ```
- **On `620879f`, the head before the flow merge:** `validate:pr` passed 47/47 with no skips, and `validate:studio` passed 10/10. CI was green.

## Flow solver: what is validated and what is not

`docs/FLOW.md` has the full table and the limits. In short:

- **Passing:** 51 registry cases. They cover:
  - pipes and ducts;
  - cylinder drag and Strouhal number at Re 20–200;
  - cube and square plate at Re 10⁵;
  - the backward-facing step;
  - sudden expansion, tee split and a multi-inlet tank;
  - laminar pipes at Re 500/1000/1500 at 20–64 cells;
  - sparse-versus-dense bit-identity, including a 99 M-cell box;
  - stagnation Cp of the cube (1.04) and sphere (0.96).
- **Documented misses:**
  - Laminar pipes at Re ≈ 1000 below about 20 cells across: −30 % at 12 cells. The cause is the regularised collision's spurious secondary flow at high cell Reynolds numbers, and there is a warning above cell Re 50.
  - Sphere at Re 10⁴: +32 % at 16 cells.
  - The building's stagnation Cp reads 1.16 at 8 cells and 1.01 at 11.5.
- **External studies on real CAD models:** they still read resolved stagnation Cp of 1.23–1.66 where the walls are thinner than a cell.
- **GPU:** the WGSL step compiles and encodes on Dawn and its float32 mirror is checked; it has never run on a device.

## Open items, in suggested order

1. Run `validate:pr` and `validate:studio` on the head of #19, then decide on merging #19 to `main` (that publishes the site).
2. **Flow:** a collision that stays accurate for laminar pipes at cell Re above 50 (central-moment or cumulant). The ones already tried and why they failed are in `docs/FLOW.md`.
3. **Flow:** stagnation Cp on sub-cell walls (resolved Cp above 1.1 on slabs, shells and decks).
4. **Flow:** run the GPU step on real hardware.
5. **Rigid:** the subnormal slowdown of exactly planar mechanisms with rotated capsules (ND-7 in `docs/RIGID_CORE.md`; `packages/box3d-kit/scripts/bench-subnormal.mjs`).
6. **Start-up:** the first step is still about 1.4× the thinner assembly build's. Going further means moving rarely used `PhysicsWorld` methods out of the main import, which is an API change.

## Decisions that are the owner's

- **Merge #19 to `main`.**
- **Raised kit size budgets** (recorded with measurements in `packages/box3d-kit/scripts/pack-smoke.mjs`): `solid-contact` 142 KiB, `fracture` 144, `scene` 460, `simulation` 459, `gpu` 174, and the packed total with the flow solver.
- **Concrete post-peak law in the Studio:** a localising law would move the Studio's peak strengths by design.
- **Real-GPU run:** a paid RunPod run, which needs the RunPod connector re-authorised.
- **Kit version:** whether to cut 1.0.0-rc.1 (prepared on the old branch `work/dx`, not merged).
- **GitHub Pages:** enable it (Settings → Pages → Source: GitHub Actions). The deploy job fails until then.
- **Timing test on loaded machines:** the first-step timing test is reported and skipped, not failed, when the load average exceeds the processor count. Say if it should fail instead.

## Related work outside this repository

The `apex-agi` app has two local branches that use this engine; they were not pushed, because this session had no push access there:
- **`physics-bench`:** a benchmark of the app's Box3D builds against this kit, with fixes to the app's mechanical assemblies and verifiers.
- **`flow-dynamics`:** the flow skill, workflow and viewer built on the vendored `./flow-bundle`.

Each has its own handoff file on its branch. Their findings that concern this repository are items 2–6 above.
