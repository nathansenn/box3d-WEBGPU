# Changelog

## 1.0.0 — 2026-07-10 — AAA Physics Lab Edition

### Added

- 24 directed hero demonstrations layered over the 600-scene capability catalog.
- Timed camera tracks, captions, impulses, projectiles, explosions, stress rain,
  time dilation, camera shake, and telemetry-lock beats.
- 2,048² PCF shadow mapping, four-sample MSAA, `rgba16float` HDR rendering,
  PBR-inspired GGX lighting, atmospheric sky/fog, emissive effects, bloom,
  tone mapping, vignette, and film grain.
- Performance, Balanced, Cinematic, and Ultra render profiles with real
  resolution, shadow, and effect-budget differences.
- Deterministic cinematic effects, authored scene dressing, and 624-scenario
  in-browser validation.
- A reproducible Box3D v0.1.0 Emscripten wrapper, stable C ABI, refreshed heap
  views after WASM memory growth, and safe GitHub publishing scripts.
- Detailed demo, renderer, native-port, test, publishing, and local browser
  validation documentation.
- MIT license and third-party notices.

### Corrected

- Camera elevation now uses positive pitch consistently, keeping catalog and
  cinematic cameras above their targets rather than below the ground plane.
- Non-uniform instance scaling now uses a normalized rotation basis for normal
  transformation, preventing distorted lighting on beams and slabs.
- Native build topology now wraps Box3D as a subproject rather than inheriting
  inappropriate top-level browser thread settings.
- Emscripten heap access now refreshes typed-array views after memory growth.

### Validation

- Strict TypeScript passed.
- Nine deterministic suites passed.
- All 600 catalog scenes constructed successfully.
- All 24 hero timelines passed camera/beat validation.
- Production and GitHub Pages builds passed.
- npm audit reported zero moderate-or-higher vulnerabilities.
- Native bridge passed strict C17 syntax checking with warnings as errors.
