# Material Bending and Fracture Lab

Version 1.14 adds a deterministic material-failure domain for comparing how different material classes bend, yield, accumulate damage, retain permanent deformation, and separate under controlled loading.

> The material profiles are **normalized comparative presets** tuned for clear, repeatable demonstrations. They are not calibrated constitutive laws, finite-element analysis, certified test data, design allowables, or a substitute for a structural engineer. Do not use the reported thresholds for safety, fabrication, product qualification, or code compliance.

## Model and coordinate contract

The lab uses a reduced-order beam lattice in the same right-handed, Y-up world as the rest of the application. One world unit is treated as one metre for scene scale and camera behavior, but the solver coefficients are dimensionless.

Each specimen contains:

- nodes with position, previous position, inverse mass, and support state;
- axial members for along-span load transfer;
- transverse and diagonal members for shear behavior;
- hidden second-neighbor constraints for bending resistance;
- separate tension and compression yield/break envelopes;
- per-member plastic rest-length drift, damage, fatigue, and broken state;
- cohesive cells that let visible members separate together into readable crack fronts.

The fixed-step loop integrates gravity and actuator load, handles impacts, evaluates strain and damage, projects the surviving constraints, and applies deterministic bounds. A broken member no longer transfers force or appears in the rendered segment topology.

```text
load / projectile / blast / rain
              ↓
deterministic lattice integration
              ↓
tension + compression strain evaluation
              ↓
elastic → yielding → damage → fracture
              ↓
compact nodes + member metadata
              ↓
WebGPU compute segment reconstruction
```

## Ten comparative material presets

The 50-scene family combines five presentation/load modes with these ten presets:

| Preset | Comparative response | Failure classification |
|---|---|---|
| Structural Steel | high axial stiffness, visible yield, plastic set, delayed rupture | ductile |
| Aluminum Alloy | lighter, lower bending stiffness, earlier plastic deformation | ductile |
| Copper | heavy, comparatively compliant, large permanent set before rupture | ductile |
| Oak Timber | strong along fibers, weaker transverse response, progressive splitting | fiber |
| Cross-Laminated Timber | layered load sharing and progressive member loss | progressive |
| Reinforced Concrete | weak comparative tension envelope, stronger compression envelope, cracking and redistribution | progressive |
| Soda-Lime Glass | high stiffness, almost no plasticity, rapid crack propagation | brittle |
| Acrylic | lower stiffness than glass with a larger but still brittle failure envelope | brittle |
| Elastomer | low stiffness, high damping, large reversible deformation before damage | hyperelastic |
| Carbon-Fiber Laminate | very stiff fiber direction, weaker transverse response, abrupt laminate failure | fiber |

Every preset defines normalized density scale, axial/shear/bending stiffness, damping, tension/compression yield and break strain, plastic creep, damage rate, fatigue rate, anisotropy, and presentation color. The names communicate familiar *comparative tendencies*; they do not make the parameters equivalent to Young's modulus, yield stress, fracture toughness, S-N curves, or tested material lots.

## Load modes and controls

The Material Failure family has five deterministic modes:

1. **Three-point bend** — centered quasi-static displacement/load ramp.
2. **Cyclic overload** — repeated loading and unloading for damage/fatigue comparison.
3. **Precision displacement ramp** — controlled threshold inspection.
4. **Instrumented impact** — load plus localized projectile response.
5. **Cinematic yield-to-fracture** — high-range progression for the hero sequences.

When a Material Failure scene is active, the command deck exposes the **Material Load Rig**:

| Control | Effect |
|---|---|
| Load slider | selects a normalized actuator target from 0% to 200% |
| Apply load / `L` | ramps toward the selected target |
| Release load / `U` | removes the actuator target so elastic recovery and permanent set remain visible |
| Cycle load | toggles a deterministic fatigue cycle |
| `Space` | applies a broad structural disturbance |
| `F` | fires a localized projectile |
| `E` | applies radial blast impulse and damage |
| Rain | spawns bounded falling impact particles |
| `D` | displays supports, nodes, break markers, and diagnostic member state |

Two authored heroes exercise the domain:

- **Steel Yield-to-Rupture** — preload, yield onset, plastic hinge formation, ultimate load, release, and permanent-set inspection.
- **Glass Catastrophic Fracture** — precise brittle preload, flaw activation, and rapid crack-front separation.

## Telemetry

The live material panel reports:

- preset and active test mode;
- target and current normalized load;
- maximum observed member strain;
- comparative tension yield and break thresholds;
- yielded and damaged member counts;
- peak damage from 0 to 100%;
- failure phase: `elastic`, `yielding`, `fracturing`, or `failed`;
- total nodes, constraints, broken links, normalized energy, and deterministic replay hash.

Color and emissive heat indicate local demand/damage. Compression and tension are both evaluated, but the display is a qualitative diagnostic rather than a calibrated stress contour.

## Correctness and determinism tests

The current suite verifies:

- exactly ten unique presets with finite, ordered yield/break envelopes;
- tension and compression break thresholds exceed the corresponding yield thresholds;
- profile coefficients and colors remain finite and bounded;
- all 50 material scenes construct, step, and publish a `material` compact-segment contract;
- load application causes finite deformation and advances telemetry;
- release exposes elastic recovery and retained plastic set where applicable;
- projectile, blast, and rain actions remain bounded;
- cyclic and repeated action schedules are deterministic;
- broken topology and counts are monotonic and internally consistent;
- matrices, colors, node streams, segment metadata, energy, and replay hashes remain finite;
- WebGPU material compute expansion, shadow rendering, and main-pass submission complete without uncaptured validation errors.

Use `npm test` for deterministic contracts, `npm run test:webgpu` for Dawn-backed renderer coverage, and the browser **Run 800 + 32 State Tests** action for the live catalog/hero state sweep.

## Deliberate limitations

The current model does not provide:

- stress in pascals, force in newtons, section-property calculations, or code checks;
- calibrated nonlinear plasticity, viscoelasticity, concrete cracking laws, orthotropic laminate theory, or continuum damage mechanics;
- mesh-converged finite elements, fracture mechanics, crack-tip singularities, contact-rich fragment simulation, or validated fatigue life;
- temperature, corrosion, moisture, manufacturing defects, strain-rate calibration, or lot-to-lot variability;
- certification of a real beam, building, vehicle, product, or material selection.

Use this lab to compare behavior, test interaction and rendering paths, and prototype failure storytelling. A real engineering workflow must replace the presets with measured constitutive data, calibrated geometry and boundary conditions, convergence studies, uncertainty bounds, and independent professional review.
