## Summary

Describe the simulation, renderer, content, tooling, or documentation change.

## Validation

- [ ] `npm run validate:v1.20`
- [ ] **Run 800 + 65 State Tests** passes in a WebGPU browser, including all 31 material-program and ten signature-stage contracts
- [ ] The material-program registry contains exactly 10 metal, 10 glass, 10 concrete, and 1 combined AAA program
- [ ] All 100 numbered AAA improvements are visible ten-per-signature scene and ordinary scenes receive none
- [ ] Manual GPU cloth, tearing cloth, rope, water, and material-member rendering checks pass
- [ ] All ten normalized material presets and load/release/cycle controls were checked
- [ ] Apex Materials Proving Ground can target metal, glass, and concrete independently before its combined finale
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
