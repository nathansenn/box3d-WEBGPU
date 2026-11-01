# box3d-WEBGPU: agent notes

Box3D physics (C, compiled to WASM) with a WebGPU/Three.js renderer and studio. See README.md and PERFORMANCE.md.

## Commands
- Install: `npm ci`
- Dev server: `npm run dev` (vite). On `main` this script still says `--host 0.0.0.0`;
  on the owner's Mac run `npx vite --host 127.0.0.1` instead (newer branches already fixed it).
- Build: `npm run build`; GitHub Pages build: `npm run build:pages`
- Typecheck / tests: `npm run typecheck`, `npm test`; full gate: `npm run validate`
- WASM: `npm run fetch:box3d` then `npm run build:wasm` (needs emscripten); `npm run doctor` checks the toolchain
- Source manifest: `npm run verify:source` (regenerate with `npm run manifest:generate` after adding files)

## Network rule
Bind every server to 127.0.0.1 (`vite --host 127.0.0.1`, `python3 -m http.server --bind 127.0.0.1`,
node `listen(port,'127.0.0.1')`). Never 0.0.0.0 or a `dev:lan` script on the owner's Mac. Cloud
sandboxes may need their own preview binding; follow the cloud platform's rule there.

## Deploys
`.github/workflows/pages.yml` deploys GitHub Pages on every push to `main`. Work on branches and PRs;
merging to `main` publishes the site.

## Media
Large media is not in git. It lives on the Railway drive (Railway project `workflows`,
bucket `home-inactive-offload-20260915-vpgsxt`, prefix `media/box3d-WEBGPU/`). See MEDIA.md.
Benchmark runs (`benchmarks/experiments/`, `benchmarks/results/`) and captures stay out of git.
