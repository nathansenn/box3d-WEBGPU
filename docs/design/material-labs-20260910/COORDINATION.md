# Physical laboratories checkpoint

Objective: user-requested expansion to liquids, glass, concrete and additional materials, generated mockups first; retire the original workspace and use a unified engineering studio.

Owned paths: src/studio/material-labs/**, src/studio/study-navigation.ts/.css, src/entry.ts, index.html, public/studio/references/material-labs/**, docs/design/material-labs-20260910/**. No new edits to the engine-owned studio main.ts, physics.ts, materials.ts or world.ts in this expansion.

Completed: five generated source mockups plus a generated empty hall panorama, with prompts and hashes; five apparatus implementations; eight material profiles and eight experiments per new study; one eight-study picker; original workbench import/markup removed. The original workspace URL now opens Liquid dynamics. Full TypeScript check and isolated production build passed. All 56 numerical tests pass, including all 40 complete programs. Five coarse apparatus support/containment graphs pass. Desktop and 390 px local viewport review is complete for the implemented scope; human visual approval, physical-device acceptance and calibrated engineering validity are not claimed. See REVIEW.md for exact evidence and model limits.

Engine integration API: createModel(id, settings) returns LabModel; fixed step is DT=1/120; step(dt), release(), snapshot(). LabFrame carries time, positions:Float32Array, rotations:Float32Array, damage:Uint8Array, actuator:number, phase:string, metrics:[number,number,number]. History snapshots are independent copies. Models are liquid, glass, concrete, rubber and granular. These are new comparative solvers, not existing FailureSimulation instances. Render snapshots are not full solver checkpoints.

Reproducible scenarios: ?studio=liquid&experiment=water-release; ?studio=glass&experiment=laminated-retention; ?studio=concrete&experiment=reinforced-core; ?studio=rubber&experiment=silicone-cycle; ?studio=granular&experiment=bead-runout. All default to seed 42 and serialize their settings into the URL.

Final source/build checkpoint: source-checkpoint.json records the frozen source and verifies parity for all nine owned entry/navigation/material-module files. build-manifest.json records the compiled assets and generated image hashes. Entry is assets/index-DaNDYoQL.js; index HTML SHA-256 is 2e1c609831033dabef3e386521911a62ec0888db6f1a6cdff02b5fb535b8b2e8. Shared engine/classic files remain at the captured preview checkpoint, not necessarily current concurrent peer state.

Preview is http://127.0.0.1:5186/?studio=liquid, bound only to 127.0.0.1. Its owned detached process is recorded in preview-process.json. The existing local QA tab was reused as the deliverable, reset to the default liquid experiment; desktop viewport restored. Metal press, canopy and bridge also rendered with the captured native WebGPU/worker engine and completed representative runs. Classic preset changes preserve the eight-study picker and no original-workbench links remain in the checked UI.

The requested Browserless static check was rejected by automatic approval review before execution: this private compiled build and generated assets lacked specific destination/payload approval. No transfer, no remote session, no indirect retry. remote-browser-qa.json is the blocked receipt. The disposable selected transfer snapshot was removed. Verification used the allowed healthy preexisting local tab; no new local browser was launched.

Next shared-engine integration boundary: agree an adapter with engine-roadmap owner 01a08767-778e-7633-9012-95ababc992ac before editing shared files. This is future integration work, not a dependency for the completed standalone material studies. Resumable checkpoints must include internal velocities, contacts/bonds and random state; LabFrame alone is visual history. Shared ownership is preserved. No commit, push, deployment, DNS change or store submission was performed.


## Completed public SEO follow-up — 2026-09-10

The public app now serves frozen artifact `27a6f75ec93a2d0b37d45a34ca1939c10def5ead` through Railway deployment `d5c878a4-dec1-4e5a-b325-510375fcc267`. Canonical domain: https://box3d.apxlabs.parts/. Source-ready, deployed-verified and marketing-ready are all true for the portfolio SEO gate; no marketing activity was started.

The new entry, metadata, sitemap and route policy cover one application page, eight study selectors and 12 route families. Source and frozen HTML each pass 21 checks, all 49 served HTTP cases pass, and all nine bounded desktop/mobile/no-JavaScript browser checks pass. The initial missing favicon was corrected with the existing approved studio image. All 89 other frozen files, including the simulation bundle and media, retain their hashes. No engine integration or app rebuild occurred.

See `seo-audit/ACCEPTANCE.json`, `seo-audit/final-artifact-manifest.json` and `seo-audit/SEO-RELEASE.md` for the current identity, scope and evidence. Earlier release receipts remain historical. The 0.01 GiB local preparation allocation is ready to release; no future allocation is needed.
