# Demo Guide — AAA Physics Capability Lab

## The 8-minute presentation

### 0:00–0:45 — Establish the architecture

Open the app at the default **Cinematic** profile and explain the visible pipeline:

```text
Box3D/WASM physics → contiguous transforms → WebGPU instancing → shadow/HDR/post → telemetry
```

Point out the backend badge. A preview-backend warning means the WASM artifact has not been built; a native state confirms Box3D is active.

### 0:45–2:00 — Titan Foundry Stackfall

1. Select **Titan Foundry Stackfall**.
2. Press **Play**.
3. Let the automatic impulse, slow motion, shockwave, and settling sequence complete.
4. Call out body count, simulation time, upload volume, and replay hash.

What this proves:

- dense stacked contacts;
- deterministic scene construction;
- camera choreography;
- HDR material separation and shadows;
- effects that do not become physics bodies;
- fixed-step simulation independent of render cadence.

### 2:00–3:20 — Aegis Tower: Kinetic Breach

1. Select **Aegis Tower: Kinetic Breach**.
2. Use **Ultra** quality on a strong desktop GPU.
3. Play the sequence.
4. Pause immediately after the primary breach and turn on diagnostics.
5. Step two or three fixed frames with **Step Frame**.

What this proves:

- high-speed projectile creation;
- continuous native physics path when WASM is loaded;
- progressive floor/column interaction;
- time-scale control;
- aligned instance transforms and debug bounds.

### 3:20–4:20 — Atlas Suspension Convoy

Use the wide camera to show:

- segmented deck bodies;
- concentrated cargo load;
- support and pylon set dressing;
- failure propagation over a long span;
- shadow stability across a broad scene.

### 4:20–5:15 — Hypermaterial Gauntlet

Show friction/restitution lanes. Trigger **Structural Impulse** once and compare slide/bounce/settling behavior. Explain that the material lab is for visible comparative response, not a benchmark score.

### 5:15–6:15 — Orbital Cargo Storm

1. Start at stress 4.
2. Play the hero sequence.
3. Watch the body and upload counters through both rain waves.
4. Switch from Cinematic to Performance during motion.

What this proves:

- runtime spawn growth;
- quality-profile resolution scaling;
- shadow-pass bypass in Performance mode;
- effect-budget control;
- high-volume matrix streaming.

### 6:15–7:15 — Construction and logistics

Play either:

- **Sky Crane Load Failure**, or
- **High-Bay Cascade**.

These are valuable because they demonstrate scenes that resemble practical industrial simulation rather than abstract piles.

### 7:15–8:00 — Engineering confidence

Open **Automated Validation**, run **600 + 24 Browser Tests**, and finish on the validation summary.

Explain the boundary honestly:

- the native backend is Box3D/WASM;
- the preview backend is a deterministic approximation;
- 600 entries are parameterized recipes;
- 24 demos are manually choreographed hero sequences;
- GPU timings are not yet timestamp-query timings.

---

## Maximum AAA Tour

Press `T` or select **Start Maximum AAA Tour**. The tour:

1. loads a hero scene at its recommended stress;
2. resets deterministic seed/effects;
3. plays camera keys and timed action beats;
4. captures final telemetry state;
5. advances to the next hero sequence.

Use this for unattended expo loops or a long screen capture.

---

## Capture settings

### Desktop cinematic capture

- Browser zoom: 100%.
- Quality: Cinematic or Ultra.
- Stress: the hero-recommended value.
- Diagnostics: off except when explaining alignment.
- Close heavy GPU tabs.
- Record at 60 FPS when possible.
- Use 0.25× or 0.5× manual time scale for detailed impacts.

### Mobile/tablet demonstration

- Quality: Performance or Balanced.
- Keep the left command deck collapsed to the needed section.
- Use touch drag to orbit and two-finger/browser gesture for zoom where supported.
- Avoid the maximum storm sequences until native performance on the device is known.

---

## Troubleshooting during a demo

| Symptom | Action |
|---|---|
| “Preview backend active” | Run `npm run fetch:box3d`, activate Emscripten, then `npm run build:wasm` |
| WebGPU unavailable | Serve from localhost/HTTPS and use a WebGPU-capable browser |
| Low FPS | Select Performance, lower stress, stop diagnostics |
| Scene seems static | Resume, restart hero sequence, or apply impulse/projectile |
| npm ENOENT for package.json | Return to the project root; do not run npm inside `third_party/box3d` |
| Shader startup fault | Read the line/column error shown by runtime WGSL validation |
