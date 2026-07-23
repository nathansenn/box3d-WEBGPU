# Demo Guide — AAA Physics Capability Lab

## A focused 10-minute presentation

### 0:00–0:45 — Explain the hybrid engine

Show the pipeline:

```text
Box3D/WASM rigid physics + deterministic cloth/rope/water/material failure
        → streamed transforms and indexed surfaces
        → WebGPU shadows, HDR, MSAA, materials, effects, post
```

Point out the backend badge. **Deterministic Preview** means native Box3D WASM has not been built; cloth, rope, water, and material failure are still live because they run in the TypeScript soft/material layer.

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

### 7:00–8:15 — Steel Yield-to-Rupture

Open the **Material Load Rig**. Follow the authored preload, yield, plastic-hinge, ultimate-load, and release beats. Pause after unloading to compare elastic recovery with retained plastic set. Call out the live target/current load, maximum strain, comparative yield/break thresholds, yielded/damaged counts, peak damage, failure phase, broken links, and replay hash.

State the confidence boundary while the telemetry is visible: this is a normalized comparative beam lattice, not calibrated FEA, material certification, or a structural safety calculation.

### 8:15–8:40 — Concrete Spall & Rebar Exposure

Start from the clean service preload, then let the authored strike expose the first local cover bay. Keep the fractured-cell, fragment, and rebar counters visible while dust expands, aggregate remains in the crater, brief sparks pick out the steel, and continued load transfers across the surviving cage. Unload before the low side close-up so loose spall and the residual bridge are easy to distinguish.

### 8:40–9:00 — Glass Catastrophic Fracture

Contrast the ductile steel and reinforced concrete sequences with the framed soda-lime pane. Use slow motion around the center punch, follow the vertical fracture wave and eight luminous radial rays instead of a whole-pane flood fill, unload for a clean fracture hold, then trigger the second strike. Finish on the micro-shard glints, persistent rotating shard field, and captured perimeter.

### 9:00–9:30 — Leviathan Impact Basin

This is the strongest fluid finale: rain, traveling waves, ballistic entry, floaters, splash displacement, foam, HDR highlights, and post-processing.

### 9:30–9:45 — Orbital Cargo Storm

Demonstrate body creation and transform streaming. Switch from Cinematic to Performance during motion to show real quality-budget changes.

### 9:45–10:00 — Engineering confidence

Open **Automated Validation**, run **800 + 65 State Tests**, and finish with the validation summary. This checks the stable scene catalog, generated surface/member contracts, all 31 material-demo recipes, metal deformation, concrete spall/rebar persistence, glass fracture/shards, the Apex three-rig composition, and hero data; complete the visual rendering checklist separately.

State the boundaries clearly:

- Box3D/WASM is the native rigid backend;
- the preview rigid backend is deterministic but approximate;
- cloth, rope, and water numerical kernels prefer SIMD WebAssembly, fall back to scalar WebAssembly, then to deterministic JavaScript;
- material specimens use a deterministic TypeScript beam lattice with normalized comparative coefficients;
- water is a CPU/WASM shallow-water heightfield;
- WebGPU reconstructs intact cloth and water presentation from solver state but does not yet run the numerical solver as compute;
- topology-changing cloth deliberately uses the packed CPU presentation path;
- material preset thresholds are illustrative and must not be used as real design allowables, FEA, fatigue life, or safety calculations;
- 800 entries are deterministic parameterized scenes;
- 65 hero demonstrations are directed: 34 established timelines plus 31 recipe-driven material programs;
- the ten starred signature scenes and their 100-item production-stage contract are separate and unchanged;
- Apex coordinates three active material rigs but is not a coupled continuum or contact solver.

## Maximum AAA Tour

Press `T` or select **Maximum AAA Tour**. It loads each of the 65 heroes at its recommended stress, resets the deterministic state, plays camera/action beats, captures telemetry, and advances to the next sequence.

For the strongest short capture order:

1. Titan Foundry Stackfall
2. Aegis Tower: Kinetic Breach
3. Tempest Standard Protocol
4. Sky Crane Cable Failure
5. Tsunami Research Array
6. Leviathan Impact Basin
7. Steel Yield-to-Rupture
8. Concrete Spall & Rebar Exposure
9. Glass Catastrophic Fracture
10. Mega Atrium Collapse
11. Apex Materials Proving Ground

## Focused material-program presentation

The recipe registry is large enough that a live operator should not attempt all 31 programs in a short meeting. Use this ten-stop progression to make the range legible before finishing on the combined scene:

1. **Square-Punch Steel Forming** — establish press tooling, proof load, springback, and permanent set.
2. **Automotive Door-Skin Oblique Dent** — show that strike origin, panel orientation, and asymmetric crease direction are recipe-specific.
3. **Press-Brake V-Bend** — contrast a narrow line-load plastic hinge with the square-punch bowl.
4. **Blast-Bulge Armor Plate** — switch to distributed impulse and broad membrane action.
5. **Tempered Safety-Glass Punch** — show dense transparent breakup and bounded small fragments.
6. **Laminated Windshield Stone Strike** — contrast retained islands and a localized spiderweb with tempered breakup.
7. **Ballistic Off-Center Penetration** — use slow motion for directional crack and shard motion.
8. **Flat-Slab Punching Shear** — orbit above then below to reveal the cone, mineral spall, and radial reinforcement.
9. **Blast-Wall Back-Face Spall** — frame the front bow and rear scab/dust/rebar response in the same shot.
10. **Apex Materials Proving Ground** — finish wide, then let the targeted metal → glass → concrete → all-rigs beats play without manual intervention.

For the individual programs, keep the recipe title, boundary/load description, target/current normalized load, deflection/residual, fractured-cell/fragment, reinforcement, and replay hash visible. Use 0.25× around the first glass crack or concrete spall and 0.5× for metal springback. In Apex, begin with the wide establishing camera so all three cells are identifiable before using closer inspection keys.

## Soft-system interaction controls

| Action | Cloth | Rope | Water | Material lattice |
|---|---|---|---|---|
| Structural impulse | wind-like broad disturbance | line excitation | broad displacement/current impulse | broad specimen disturbance |
| Projectile | local momentum and possible tear | segment hit and possible sever | ballistic floater/impact | localized impact and damage |
| Explosion | radial fabric impulse | radial cable/payload impulse | radial surface disturbance and droplets | radial impulse and damage |
| Rain | falling impact particles | falling cable impacts | real droplets injecting ripples | bounded repeated impacts |
| Diagnostics | pins and sampled nodes | anchors/nodes and segment state | sampled current vectors | supports, nodes, member demand, and breaks |
| Material load rig | — | — | — | apply/release 0–200% target or deterministic cycle; Apex beats may target one rig or all three |
| Material Strike / `I` | — | — | — | recipe-local dent, crack seed, or spall event at the authored strike center |

## Capture settings

### Desktop

- Browser zoom: 100%.
- Quality: Cinematic or Ultra.
- Use hero-recommended stress.
- Turn diagnostics off for beauty shots and on for engineering explanation.
- Use 0.25× or 0.5× for tearing, line failure, material fracture, and impact inspection.

### Integrated GPU or tablet

- Quality: Performance or Balanced.
- Reduce stress before maximum cloth/water/material scenes.
- Avoid running the complete catalog gate during a live presentation.

## Troubleshooting

| Symptom | Action |
|---|---|
| Preview backend active | Build the native WASM artifact; soft/fluid systems still work meanwhile |
| WebGPU unavailable | Use localhost/HTTPS and a WebGPU-capable browser |
| Low FPS in cloth | Lower stress or quality; close GPU-heavy tabs |
| Water looks opaque/incorrect | Check browser console for blend/depth shader errors, then run `npm run test:webgpu` against the current v1.9 tree |
| Cloth surface disappears | Run `npm test`; surface stride/index validation should identify corruption |
| Material rig is hidden | Select a scene in the **Material Failure** family |
| Material fractures too early/late | Reset, confirm stress and normalized load target, then compare the preset/mode label; do not reinterpret the value as a physical load |
| Apex shows only one rig | Reset the **Apex Materials Proving Ground** hero rather than opening its base catalog scene; the combined coordinator is selected by the derived material-demo ID |
| npm ENOENT | Return to project root; do not run npm in `third_party/box3d` |
| Shader startup fault | Use the line/column from runtime WGSL compilation diagnostics |

For the full material model, preset table, telemetry definitions, and engineering limitations, see [`MATERIAL_FRACTURE.md`](MATERIAL_FRACTURE.md).
