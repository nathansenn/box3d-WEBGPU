# Local Browser Validation Runbook

This runbook verifies the part of the project that static tests cannot prove:
that a real browser creates the WebGPU device, compiles the WGSL modules,
submits frames, displays telemetry, and survives the complete live catalog
smoke test.

## Prerequisites

- A current browser with WebGPU enabled.
- macOS, Windows, or Linux with a compatible GPU/driver stack.
- Node.js and npm.
- For the real Box3D backend: an activated Emscripten SDK and the upstream
  Box3D checkout fetched by this project.

## 1. Validate the source package

From the project root:

```bash
npm install
npm run validate
npm run doctor
```

Expected result:

- nine deterministic test suites pass;
- repository self-test passes;
- the Vite production build completes;
- `doctor` reports the JavaScript preview backend as available;
- `doctor` reports the native backend as available only after the WASM files
  have been built.

## 2. Start the application

```bash
npm run dev
```

Open the exact local URL printed by Vite. Do not open `index.html` directly as
`file://`; the application is designed to run through an HTTP development or
preview server.

## 3. Confirm WebGPU startup

The app should show the command deck rather than a blank canvas. Confirm:

1. the backend badge says either **Box3D WASM** or **Deterministic Preview**;
2. the render-quality badge has a value;
3. FPS and body counts update;
4. the 3D scene responds to pointer orbit and wheel zoom;
5. the browser console contains no WGSL compilation error.

The renderer requests shader compilation diagnostics and surfaces readable
errors if a WGSL module fails.

## 4. Exercise the four render profiles

Run the same hero sequence once in each profile:

- Performance
- Balanced
- Cinematic
- Ultra

Confirm that internal resolution, shadow contribution, effect budget, fog,
bloom, and exposure change without breaking the simulation. Ultra may render
above native canvas resolution and is intentionally expensive.

## 5. Run the authored hero tour

Select **Maximum AAA Tour**, or press `T`.

Confirm that the director:

- advances through all 24 hero demonstrations;
- follows authored camera tracks;
- triggers timed impulses, projectiles, explosions, and stress rain;
- enters and exits slow motion;
- updates the timeline progress bar;
- preserves finite transforms and responsive controls.

Pointer-dragging should leave automatic cinematic camera playback and return
control to the operator.

## 6. Run the live 624-scenario gate

Click **Run 600 + 24 Browser Tests**.

The test log should complete without a failure. This exercises every generated
recipe plus every authored showcase against the active backend and validates
body counts, matrix/color buffers, stepping, actions, and replay hashes.

Because this test rebuilds hundreds of scenes, Performance or Balanced mode is
recommended for the first pass.

## 7. Build and verify the real Box3D backend

After activating Emscripten:

```bash
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Reload the page and confirm that the backend badge changes from
**Deterministic Preview** to **Box3D WASM**. Repeat the hero tour and the live
624-scenario gate.

Generated files:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

## 8. Production and GitHub Pages check

```bash
npm run build:pages
npm run preview
```

Open the preview URL and repeat one hero sequence plus the live smoke test.
This confirms that asset URLs remain valid under the repository subpath used
by GitHub Pages.

## Acceptance checklist

- [ ] WebGPU adapter and device created.
- [ ] No WGSL compilation failures.
- [ ] Shadow, HDR, MSAA, post-processing, and effects render.
- [ ] All four quality profiles function.
- [ ] All 24 hero sequences complete.
- [ ] All 600 generated recipes load and step.
- [ ] Replay hashes remain stable for identical seeds/backend.
- [ ] Preview backend is clearly labeled when native WASM is absent.
- [ ] Box3D WASM backend is selected after native artifacts are built.
- [ ] Production/Pages bundle loads through `npm run preview`.
