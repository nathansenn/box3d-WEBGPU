# Material Bending and Fracture Lab

Version 1.18 introduced three differentiated material rigs. The current realism pass refines their presentation: dense skin tiles now derive an orthonormal basis from four deformed simulation corners; internal solver lattices stay hidden except for real concrete reinforcement; cold-formed metal uses a restrained witness tint and coating flakes; concrete combines physical graded spall with translucent dust; and glass uses a dedicated two-sided blended Fresnel pass with transparent shards and restrained branch glints.

Version 1.19 retains those authoritative mechanics and adds laboratory hardware, safety systems, datum markers, catch trays, measurement scales, and controlled lighting through the backend-neutral 100-improvement signature-stage registry. It also corrects the persistent concrete aggregate accent from the woven-fabric tag to the mineral/stone atlas path.

The current material expansion adds a separate, lazy **31-program presentation registry**: ten metal, ten glass, ten reinforced-concrete, and one combined proving-ground program. It intentionally derives from stable scene IDs instead of extending the native catalog. The established contracts therefore remain exactly 800 catalog scenes, 50 Material Failure recipes, ten signature scenes, and the source-frozen 100-case material benchmark. The director grows from 34 to 65 heroes without relabeling historical benchmark or browser-capture evidence.

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
4. **Instrumented dent and impact** — metal presets use a dense perimeter-clamped pressure panel with radial press loading and localized forming strikes; other presets retain load-plus-projectile response.
5. **Cinematic yield-to-fracture** — high-range progression for the hero sequences.

The new recipe-driven programs sit above those stable catalog modes. A `MaterialDemoRecipe` supplies a proven base scene ID plus its own profile variant, specimen geometry and orientation, support boundary, load pattern/center/radius/sign, strike center, primary and ultimate loads, strike strengths, crack style, fixture style, stress, duration, and camera. That separation allows a focused test to reuse native-safe staging while selecting a distinct material experiment.

When a Material Failure scene is active, the command deck exposes the **Material Load Rig**:

| Control | Effect |
|---|---|
| Load slider | selects a normalized actuator target from 0% to 200% |
| Apply load / `L` | ramps toward the selected target |
| Release load / `U` | removes the actuator target so elastic recovery and permanent set remain visible |
| Cycle load | toggles a deterministic fatigue cycle |
| Material Strike / `I` | applies a centered forming impulse to metal, ejects concrete cover from a local failure cell, or nucleates a glass crack front |
| `Space` | applies a broad structural disturbance |
| `F` | fires a localized projectile |
| `E` | applies radial blast impulse and damage |
| Rain | spawns bounded falling impact particles |
| `D` | displays supports, nodes, break markers, and diagnostic member state |

Four established heroes remain unchanged:

- **Steel Yield-to-Rupture** — preload, yield onset, plastic hinge formation, ultimate load, release, and permanent-set inspection.
- **Titan Metal Bend & Dent** — perimeter-clamped panel bending, unload/springback, two localized forming strikes, secondary overload, and residual-set inspection.
- **Concrete Spall & Rebar Exposure** — clean service preload, localized cohesive failure, damage-aware cover removal, physical spall emission, exposed reinforcement, and residual bridging.
- **Glass Catastrophic Fracture** — transverse preload on a vertical pane, center-punch flaw activation, eight timed radial crack rays, disappearing glass skin tiles, and a persistent rotating shard field.

## Thirty focused material programs

The director adds ten test programs per presentation class. Titles are unique registry IDs in source and each program owns its boundary, demand, fixture, crack presentation, load schedule, and inspection camera.

### Metal forming and failure

| Program | Boundary / demand | Fixture | Demonstrated response |
|---|---|---|---|
| **Square-Punch Steel Forming** | perimeter / centered patch | press | bowl forming, shoulder curvature, unload springback, residual dent |
| **Aluminum Hailstorm Panel** | perimeter / offset pulses | drop rig | overlapping dimples, oil-canning recovery, low-mass response |
| **Copper Deep-Draw Dome** | perimeter / broad distributed patch | press | large ductile stretch, permanent dome, strain redistribution |
| **Automotive Door-Skin Oblique Dent** | vertical perimeter / offset ellipse | ram | asymmetric crease, oblique load transfer, rebound witness |
| **Press-Brake V-Bend** | simple span / narrow line | rollers | localized plastic hinge and retained fold angle |
| **Four-Point Bumper Beam** | simple span / dual patches | rollers | constant-moment region, twin hinge shoulders, permanent sweep |
| **Cantilever Bracket Overbend** | cantilever / edge patch | ram | root hinge, one-sided plasticity, retained tip displacement |
| **Tension-Field Shear Panel** | four corners / torsion | fatigue frame | diagonal tension-field wrinkling and X-shaped yield |
| **Notched Low-Cycle Fatigue** | end-clamped / reversing line | fatigue frame | notch damage, stiffness loss, progressive ligament failure |
| **Blast-Bulge Armor Plate** | vertical perimeter / distributed pulse | blast frame | membrane action, radial yield bands, rebound and residual bulge |

### Architectural glass

| Program | Boundary / demand | Fracture presentation | Demonstrated response |
|---|---|---|---|
| **Annealed Pendulum Impact** | perimeter / center | radial | long cracks and larger transparent shards |
| **Tempered Safety-Glass Punch** | perimeter / compact center | dense | rapid pebble-like breakup with bounded shard energy |
| **Laminated Windshield Stone Strike** | perimeter / offset | retained | spiderweb cracking and retained broken islands |
| **Edge-Chip Runaway Crack** | perimeter / edge | edge-biased | asymmetric crack fan from a seeded frame flaw |
| **Four-Bolt Point-Supported Facade** | four corners / distributed | edge-biased | point-support concentration and corner-origin star fracture |
| **Curtain-Wall Wind Failure** | perimeter / distributed | edge-biased | broad bowing, perimeter crack, whole-pane release |
| **Ballistic Off-Center Penetration** | perimeter / offset compact | radial | local opening, directional shards, bounded perforation growth |
| **Blast Overpressure Release** | perimeter / broad pulse | dense | whole-pane impulse and outward fragment sheet |
| **Hailstone Multi-Hit Pattern** | perimeter / dual | radial | interacting crack origins and bounded multi-hit damage |
| **Thermal Corner Fracture** | end-clamped / distributed | diagonal | corner-origin diagonal forensic crack map |

### Reinforced concrete

| Program | Boundary / demand | Fracture presentation | Demonstrated response |
|---|---|---|---|
| **RC Three-Point Beam** | simple span / center line | local | soffit cracking, cover spall, exposed bridging steel |
| **RC Four-Point Constant-Moment Beam** | simple span / dual line | local | broad distributed flexural cracking and cover loss |
| **Flat-Slab Punching Shear** | four corners / center patch | cone | two-way action, annular breakout, radial reinforcement |
| **One-Way Slab Drop Weight** | end-clamped / pulse | radial | top crater, radial cracks, back-face spall |
| **Bridge-Deck Wheel Patch** | simple span / dual patch | local | lane-localized demand, residual curvature, bar continuity |
| **Cantilever Corbel Shear** | cantilever / edge | diagonal | deep-member shear crack and steel-tie bridging |
| **Highway Barrier Impact Strip** | vertical end-clamped / offset | radial | front crater, rear scabbing, residual reinforcement |
| **Blast-Wall Back-Face Spall** | vertical perimeter / distributed | radial | broad impulse, rear scab, dust and persistent steel grid |
| **Anchor Pull-Out Cone** | four corners / positive center | cone | lifted breakout cone, radial spokes, anchor-zone exposure |
| **Cyclic Deck Fatigue Strip** | simple span / reversing line | local | accumulated cracks, stiffness loss, final overload spall |

## Apex Materials Proving Ground

The 31st recipe is a true three-rig composition rather than a single lattice wearing three materials. It runs a square-punch steel-forming cell, a backlit off-center ballistic-glass cell, and a reinforced-concrete punching/spall cell in one high-bay environment. The three simulations retain separate nodes, constraints, hashes, material telemetry, failure mechanics, and local stage offsets.

The coordinator can target metal, glass, concrete, or all rigs for load, release, and strike beats. It merges their translated finite matrices/colors and compact node/member streams into one bounded frame; concrete reinforcement remains visible, while hidden metal/glass solver lattices stay hidden. Combined telemetry is an inspection summary, not evidence that the three reduced-order specimens have continuum contact or constitutive coupling.

## Material-specific AAA presentation

Metal, concrete, and glass share the deterministic lattice authority but no longer share a generic visual shell:

- dense metal skin tiles rotate with current station/lane tangents so global bending and retained dents read as a continuous shell rather than a wire lattice;
- concrete cover tiles follow loaded curvature and are removed only above fractured cohesive cells, revealing only a separate set of higher-capacity ductile rebar constraints;
- concrete cell separation emits bounded concrete/mineral spall bodies that settle on the catch tray, plus low-opacity dust in the blended material pass;
- glass is oriented vertically inside a metal capture frame, with a thin transparent pane covering the hidden intact lattice;
- the first glass strike seeds eight outward crack rays instead of flood-filling the pane, while a two-cell perimeter remains captured;
- glass cells emit thin transparent shards with deterministic translation, rotation, gravity, catch-tray bounce, lifetime, and capacity limits;
- the opaque pass discards glass/dust tags; a conditional depth-reading, non-depth-writing pass renders Fresnel transmission and dust without opaque binary shadows;
- strike VFX remain renderer presentation state: they follow the deterministic material event and camera timeline but do not feed force or damage back into the authoritative lattice.
- dedicated five-key camera tracks inspect the metal press footprint from above, the concrete tensile face and rebar cage from below/side, and the glass pane from grazing optical angles.

## Telemetry

The live material panel reports:

- preset and active test mode;
- target and current normalized load;
- maximum observed member strain;
- comparative tension yield and break thresholds;
- yielded and damaged member counts;
- peak damage from 0 to 100%;
- current and peak center deflection;
- unloaded residual deformation after springback;
- fractured cohesive-cell and live fragment counts;
- surviving reinforcement count for reinforced-concrete rigs;
- failure phase: `elastic`, `yielding`, `fracturing`, or `failed`;
- total nodes, constraints, broken links, normalized energy, and deterministic replay hash.

Subtle material tint, exposed aggregate, missing cover, crack branches, and reinforcement transfer indicate local demand/damage. Strong emissive overlays are reserved for diagnostics and brief contact glints. Compression and tension are both evaluated, but the display is a qualitative diagnostic rather than a calibrated stress contour.

## Correctness and determinism tests

The current suite verifies:

- exactly ten unique presets with finite, ordered yield/break envelopes;
- exactly 31 unique material-demo recipes split 10 metal / 10 glass / 10 concrete / 1 combined, with valid stable base-scene references;
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
- every focused material program constructs, steps, publishes finite presentation state, and remains within the material-instance budget;
- Apex publishes all three material classes simultaneously, retains concrete reinforcement segments, and merges translated streams without overflowing the combined budget.

The dedicated bend/dent contract runs two independent copies of recipe 781 through load, unload, forming strike, and recovery. It requires identical hashes and telemetry, a visible peak indentation, a smaller retained residual set after springback, normalized yield, no rupture during the controlled strike, a tilted finite shell basis, a hidden internal lattice, and no emissive cold-forming surface.

The concrete/glass contract runs two copies of recipes 796 and 797 through their complete preload, first strike, propagation, second strike, and inspection schedules. It requires exact replay agreement, curvature-following cover/pane bases, localized concrete cell loss, at least 80 surviving reinforcement members, no visible glass solver grid, bounded radial glass fracture rather than pane-wide flood fill, retained physical fragments, preserved dust/glass material tags, and finite presentation streams. Dawn tests compile and submit the conditional blended glass/dust pass with zero uncaptured WebGPU errors.

Use `npm test` for deterministic contracts, `npm run test:webgpu` for Dawn-backed renderer coverage, and the browser **Run 800 + 65 State Tests** action for the live catalog/hero state sweep. The exact historical `test:material:100` benchmark remains source-frozen and separate; the 31-program contract does not rewrite its case population.

## Deliberate limitations

The current model does not provide:

- stress in pascals, force in newtons, section-property calculations, or code checks;
- calibrated nonlinear plasticity, viscoelasticity, concrete cracking laws, orthotropic laminate theory, or continuum damage mechanics;
- shell elements, contact tooling, thickness reduction, wrinkling, anisotropic sheet forming, or calibrated dent/crashworthiness prediction;
- mesh-converged finite elements, fracture mechanics, crack-tip singularities, contact-rich fragment simulation, or validated fatigue life;
- constitutive or contact coupling between the three Apex rigs; their coordination is cinematic, spatial, and telemetry-level;
- temperature, corrosion, moisture, manufacturing defects, strain-rate calibration, or lot-to-lot variability;
- certification of a real beam, building, vehicle, product, or material selection.

Use this lab to compare behavior, test interaction and rendering paths, and prototype failure storytelling. A real engineering workflow must replace the presets with measured constitutive data, calibrated geometry and boundary conditions, convergence studies, uncertainty bounds, and independent professional review.
