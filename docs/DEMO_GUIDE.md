# Demo Guide — Maximum Physics Capability Lab

## Demo story

This demo proves the stack is no longer just a renderer. It is a browser physics lab:

```text
real-time physics → transform buffer → WebGPU instance renderer → diagnostics → tests → 600-scene catalog
```

## Suggested presentation sequence

### 1. Start with Max Tour

Click **Max Tour** or press `T`.

Show:

- The app auto-cycles through featured scenes.
- Automatic impulses, projectiles, explosions, and rain events trigger per family.
- Replay hashes and body counts keep updating.

### 2. Search for “tower”

Show:

- Searchable scene catalog.
- Tall-structure family variety.
- Stress slider changes complexity.
- Projectile button turns the scene into an impact lab.

### 3. Filter to Infrastructure

Show:

- Bridge Load Test.
- Truss Span Failure.
- Viaduct / deck segmentation.
- Manual explosion can force failure.

### 4. Filter to Materials

Show:

- Friction and restitution lanes.
- Density changes.
- Bounce and sliding differences.

### 5. Switch to Rain / Stress Tests

Show:

- High-volume body spawn.
- GPU upload MB metric.
- FPS metric.
- Rain button adds more bodies without restarting.

### 6. Run Browser Tests

Show:

- All 600 scenes are loaded and stepped.
- Matrix buffers are checked for finite values.
- Family-level pass counts and replay hashes are printed.

## Recommended talking points

- Physics is still CPU/WASM in the real backend. WebGPU renders the simulation output.
- This is the correct foundation before attempting GPU compute physics.
- The fallback backend is intentionally simple; it lets the UI and renderer run before the WASM artifact exists.
- The catalog is organized around physics capabilities: contacts, towers, bridges, materials, stress, destruction, vehicles, logistics, and architecture.
- The next major milestone is Worker isolation and true Box3D debug-draw parity.

## Capture checklist

For a clean screen recording:

- Use Chrome/Edge/Safari with WebGPU enabled.
- Close heavy tabs.
- Start at stress level 3.
- Toggle debug overlay on for explanations, off for cinematic captures.
- Use `F` for projectile and `E` for explosion.
- Use `T` for Max Tour.
- End with **Run Browser Tests** to show engineering confidence.
