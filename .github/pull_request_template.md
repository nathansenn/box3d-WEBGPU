## Summary

Describe the simulation, renderer, content, tooling, or documentation change.

## Validation

- [ ] `npm run validate:v1.14`
- [ ] **Run 800 + 32 State Tests** passes in a WebGPU browser
- [ ] Manual GPU cloth, tearing cloth, rope, water, and material-member rendering checks pass
- [ ] All ten normalized material presets and load/release/cycle controls were checked
- [ ] Material thresholds are described as comparative—not FEA, design allowables, fatigue life, or safety calculations
- [ ] Preview-backend warning/label is correct
- [ ] Native Box3D WASM tested, or the reason it was not tested is stated
- [ ] No new WGSL compilation warnings/errors
- [ ] Performance and Ultra profiles were both checked for visual changes

## Determinism and performance

- Replay hash impact:
- Largest tested body count:
- Browser / OS / GPU:
- Physics CPU ms:
- Render submit CPU ms:
- GPU timestamp result, when instrumented:

## Screenshots / capture

Include before/after frames or video for visual changes. Include the quality profile and scene/hero name.
