# box3d-WEBGPU: agent notes

Box3D physics (C, compiled to WASM) with a WebGPU/Three.js renderer and studio. See README.md and PERFORMANCE.md.

## Commands
- Install: `npm ci`
- Dev server: `npm run dev` (vite, bound to 127.0.0.1).
- Build: `npm run build`; GitHub Pages build: `npm run build:pages`
- Typecheck / tests: `npm run typecheck`, `npm test`; full gate: `npm run validate`
- WASM: `npm run fetch:box3d` then `npm run build:wasm` (needs emscripten); `npm run doctor` checks the toolchain
- Source manifest: `npm run verify:source` (regenerate with `npm run manifest:generate` after adding files)

## Network rule
Bind every server to 127.0.0.1 (`vite --host 127.0.0.1`, `python3 -m http.server --bind 127.0.0.1`,
node `listen(port,'127.0.0.1')`). Never 0.0.0.0 or a `dev:lan` script on the owner's Mac. Cloud
sandboxes may need their own preview binding; follow the cloud platform's rule there.

## Deploys
`.github/workflows/pages.yml` deploys GitHub Pages after CI passes on `main`. Work on branches and PRs;
merging to `main` publishes the site.

## CI workflows
Workflows only check code; they never change it. Never add a workflow, job or step that commits,
pushes, tags or otherwise writes to the repository, asks for `contents: write` or `write-all`, uses
`pull_request_target`, or reads a stored secret. CI must not edit source, tests, `package-lock.json` or
`SOURCE_MANIFEST.sha256`: make each change as a normal commit you have checked locally, and land it on
`main` through a pull request whose CI passed. `tests/release-contracts.test.mjs` fails the required
check when a workflow breaks this rule. Only the Pages deploy job may hold `pages` and `id-token` write.

## Media
Studio runtime media (`public/studio/`) and the design QA evidence (`docs/design/`) are in git since
2026-11-01. Other large media lives on the Railway drive (Railway project `workflows`,
bucket `home-inactive-offload-20260915-vpgsxt`, prefix `media/box3d-WEBGPU/`). See MEDIA.md.
Benchmark runs (`benchmarks/experiments/`, `benchmarks/results/`) and captures stay out of git.
