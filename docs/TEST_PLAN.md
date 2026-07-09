# Test Plan — Box3D WebGPU Maximum Lab

## Goals

Validate the full browser physics stack:

```text
scene catalog → physics backend → transform/color buffers → WebGPU renderer → diagnostics
```

## Automated Node tests

Run:

```bash
npm test
```

Coverage:

- TypeScript strict mode.
- 600-scene catalog integrity.
- Category coverage.
- Fallback backend can create every scene.
- Featured scenes can step without invalid matrices.
- Replay determinism for identical seeds.
- Runtime actions: kick, explosion, projectile, rain.
- Repository bridge self-test for C export names and build-script alignment.

## Browser smoke tests

Inside the app, click **Run Browser Tests**.

The browser test:

1. Loads all 600 scenes.
2. Steps each scene briefly.
3. Checks body count.
4. Checks matrix buffer finite values.
5. Reports family-level pass counts and replay hashes.
6. Restores the previously loaded scene.

## Manual stress tests

Recommended matrix:

| Area | Manual check |
|---|---|
| Scene browser | Search, filter, select, featured buttons, prev/next/random |
| Max Tour | Enable tour, verify auto scene changes and auto actions |
| Stress slider | Try levels 1 through 5 on stack, tower, rain, warehouse |
| Camera | Orbit/zoom while bodies move |
| Renderer | Toggle debug lines; ensure cubes and wires stay aligned |
| Actions | Kick, explosion, projectile, rain on several families |
| Runtime health | Watch FPS, sim frame time, upload MB, replay hash |

## Expected limitations

- JS fallback physics is a preview backend, not full Box3D fidelity.
- C/WASM bridge maps all 12 families, but some of the 600 variants share native recipes until deeper parity is implemented.
- The renderer currently displays cube instances only; mesh-specific colliders are a future upgrade.
