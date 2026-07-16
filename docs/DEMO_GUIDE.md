# Demo Guide — AAA Physics Capability Lab

## A focused 10-minute presentation

### 0:00–0:45 — Explain the hybrid engine

Show the pipeline:

```text
Box3D/WASM rigid physics + deterministic cloth/rope/water
        → streamed transforms and indexed surfaces
        → WebGPU shadows, HDR, MSAA, materials, effects, post
```

Point out the backend badge. **Deterministic Preview** means native Box3D WASM has not been built; cloth, rope, and water are still live because they run in the TypeScript soft-simulation layer.

### 0:45–2:00 — Titan Foundry Stackfall

Play **Titan Foundry Stackfall** and call out stacked contacts, camera direction, shadow/HDR quality, body count, upload bandwidth, and replay hash.

### 2:00–3:15 — Aegis Tower: Kinetic Breach

Play the tower sequence, pause after impact, enable diagnostics, and advance several fixed frames. This demonstrates projectiles, time dilation, progressive collapse, aligned transforms, and deterministic stepping.

### 3:15–4:30 — Tempest Standard Protocol

1. Select the cloth hero.
2. Keep the surface telemetry visible.
3. Watch the wind front and folds.
4. Observe the projectile/pressure event and any controlled tear.
5. Enable diagnostics briefly to show pins and particle samples.

Call out structural, shear, and bend constraints; two-sided woven rendering; dynamic normals; strain colors; and real topology openings after broken links.

### 4:30–5:45 — Sky Crane Cable Failure

Show the payload and cable before impact, then let the projectile/blast sequence run. Call out tension coloring, anchored endpoints, payload inertia, line severing, and residual oscillation.

### 5:45–7:00 — Tsunami Research Array

Use a wide camera. Watch the wave front cross the basin, reflect, interfere, and form foam. Turn on diagnostics to expose current vectors. Explain that this is an interactive 2.5D shallow-water solver rather than a volumetric fluid simulation.

### 7:00–8:00 — Leviathan Impact Basin

This is the strongest fluid finale: rain, traveling waves, ballistic entry, floaters, splash displacement, foam, HDR highlights, and post-processing.

### 8:00–9:00 — Orbital Cargo Storm

Demonstrate body creation and transform streaming. Switch from Cinematic to Performance during motion to show real quality-budget changes.

### 9:00–10:00 — Engineering confidence

Open **Automated Validation**, run **750 + 30 State Tests**, and finish with the validation summary. This checks scene state, generated surface contracts, and hero data; complete the visual rendering checklist separately.

State the boundaries clearly:

- Box3D/WASM is the native rigid backend;
- the preview rigid backend is deterministic but approximate;
- cloth, rope, and water numerical kernels prefer SIMD WebAssembly, fall back to scalar WebAssembly, then to deterministic JavaScript;
- water is a CPU/WASM shallow-water heightfield;
- WebGPU reconstructs intact cloth and water presentation from solver state but does not yet run the numerical solver as compute;
- topology-changing cloth deliberately uses the packed CPU presentation path;
- 750 entries are deterministic parameterized scenes;
- 30 hero demonstrations are manually directed.

## Maximum AAA Tour

Press `T` or select **Maximum AAA Tour**. It loads each hero at its recommended stress, resets the deterministic state, plays camera/action beats, captures telemetry, and advances to the next sequence.

For the strongest short capture order:

1. Titan Foundry Stackfall
2. Aegis Tower: Kinetic Breach
3. Tempest Standard Protocol
4. Sky Crane Cable Failure
5. Tsunami Research Array
6. Leviathan Impact Basin
7. Mega Atrium Collapse

## Soft-system interaction controls

| Action | Cloth | Rope | Water |
|---|---|---|---|
| Structural impulse | wind-like broad disturbance | line excitation | broad displacement/current impulse |
| Projectile | local momentum and possible tear | segment hit and possible sever | ballistic floater/impact |
| Explosion | radial fabric impulse | radial cable/payload impulse | radial surface disturbance and droplets |
| Rain | falling impact particles | falling cable impacts | real droplets injecting ripples |
| Diagnostics | pins and sampled nodes | anchors/nodes and segment state | sampled current vectors |

## Capture settings

### Desktop

- Browser zoom: 100%.
- Quality: Cinematic or Ultra.
- Use hero-recommended stress.
- Turn diagnostics off for beauty shots and on for engineering explanation.
- Use 0.25× or 0.5× for tearing, line failure, and impact inspection.

### Integrated GPU or tablet

- Quality: Performance or Balanced.
- Reduce stress before maximum cloth/water scenes.
- Avoid running the complete catalog gate during a live presentation.

## Troubleshooting

| Symptom | Action |
|---|---|
| Preview backend active | Build the native WASM artifact; soft/fluid systems still work meanwhile |
| WebGPU unavailable | Use localhost/HTTPS and a WebGPU-capable browser |
| Low FPS in cloth | Lower stress or quality; close GPU-heavy tabs |
| Water looks opaque/incorrect | Check browser console for blend/depth shader errors, then run `npm run test:webgpu` against the current v1.9 tree |
| Cloth surface disappears | Run `npm test`; surface stride/index validation should identify corruption |
| npm ENOENT | Return to project root; do not run npm in `third_party/box3d` |
| Shader startup fault | Use the line/column from runtime WGSL compilation diagnostics |
