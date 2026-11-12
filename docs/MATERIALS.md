# Material library

`src/engine/materials.ts`, published by the kit as `box3d-webgpu-kit/materials`: engineering materials in SI units, each value with the conditions it holds for, the figure exactly as it was read in its source, the conversion when it was not read in SI, a range where sources disagree or state one, and a numbered citation below. Library version `1.0.0` (`MATERIAL_LIBRARY_VERSION`); the sources were opened on 2026-11-12.

This is roadmap Phase 4, "a calibrated material library with sources". *Calibrated* here means traceable: every number can be followed to a page that was opened and read. It does not mean that the project measured anything. The values are typical or nominal figures for a named grade; real samples differ.

## What is in it

24 materials, 31 contact-pair entries, 36 sources, **214 values: 207 from a source, 7 unverified**.

| Material (`id`) | Grade and conditions | Density | E, ν, G | Strength | K_IC / G_c | k, c_p, α |
|---|---|---|---|---|---|---|
| Structural steel S355 (`structural-steel-s355`), S235 (`structural-steel-s235`) | EN 10025-2, t ≤ 40 mm | 7850 | 210 GPa, 0.30, 81 GPa | f_y 355 / 235, f_u 490 / 360 MPa | — | 53.3, 440, 12e-6 (20 °C) |
| Stainless 304 (`stainless-304`) | annealed | 8000 | 193–200 GPa, 0.29, 86 GPa (flagged) | 215 / 505 MPa | — | 16.2, 500, 17.3e-6 |
| Aluminium 6061-T6 (`aluminium-6061-t6`) | T6 / T651 | 2700 | 68.9 (–70.4) GPa, 0.33, 26 GPa | 276 / 310 MPa | 29 MPa√m | 167 (154–167), 896 (–943), 23.6e-6 |
| Copper C11000 (`copper-c11000`) | ETP, annealed | 8910 | 117 GPa, 0.328, 44.1 GPa | 69 / 221 MPa (to 303 / 331 hard) | — | 391, 385, 16.9e-6 |
| Grey cast iron (`cast-iron-gjl-250`) | EN-GJL-250 | 7200 | 103–118 GPa, 0.26 | Rp0.1 165–228, Rm 250–350 MPa | 15.2 MPa√m | 48.5 (100 °C), 460, 11.7e-6 |
| Soda-lime glass (`soda-lime-glass`) | annealed sheet | 2500 | 72 GPa, 0.23, 30 GPa | flexural 41 MPa | 0.75 ± 0.04 MPa√m | 0.937, 880, 8.3e-6 |
| Concrete C30/37 (`concrete-c30-37`) | normal weight, 28 days | 2400 (2300–2500) | 32.8 GPa, 0.2 | f_cm 38, f_ctm 2.9 MPa | — | 1.64 (1.33–1.95), 900, 10e-6 |
| Granite (`granite-barre`) | Barre granite, intact | 2659 | 72.4 GPa, 0.22, 29.7 GPa | UCS 234.5, tensile 7.6 MPa | — | 2.37 |
| Northern red oak (`oak-red-northern`), loblolly pine (`pine-loblolly`) | clear wood, 12% moisture, along the grain | 706, 571 | 13.75 / 13.53 GPa, ν_LR 0.350 / 0.328, G_LR 1.22 / 1.11 GPa | MOR 99 / 88, compression 46.6 / 49.2 MPa | 0.22–0.55 MPa√m (crack along the grain) | 0.31 / 0.26, 1620, 3.8e-6 |
| PMMA (`pmma`) | PLEXIGLAS GS, 23 °C | 1190 | 3.3 GPa, 0.37, 1.7 GPa dynamic (flagged) | tensile 80 MPa | — | 0.19, 1470, 70e-6 |
| ABS (`abs`) | Terluran GP-35 | 1040 | 2.3 GPa | yield 44 MPa | — | 0.17, —, 80–110e-6 |
| Nylon 66 (`nylon-66`) | Zytel 101L, dry (conditioned) | 1140 | 3.1 (1.4) GPa, 0.37 (0.43) | yield 82 (55) MPa | — | 0.24, —, 100e-6 |
| PTFE (`ptfe`) | unfilled | 2160 | 0.55 GPa | tensile 26.9 MPa | — | 0.245, —, 135e-6 |
| Natural rubber (`natural-rubber`) | pure-gum vulcanizate; rubber hydrocarbon | 922 | 1.5 (1–2) MPa, 0.5, E/3 | — | — | —, 1880, 223e-6 |
| Ice (`ice`) | polycrystalline, about −10 °C | 919 | 9.3 GPa, 0.33 | — | 0.1 MPa√m, G_c 1 J/m² | 2.30, 2000 |
| Water (`water`) | 20 °C, 1 atm | 998.2 | — | — | — | 0.598, 4184; μ 1.0016 mPa s, c 1482 m/s |
| Air (`air`) | 20 °C, 1 atm | 1.204 | — | — | — | 0.0251, 1007; μ 1.825e-5 Pa s |
| Glycerol (`glycerol`) | anhydrous, 20 °C | 1261.1 | — | — | — | μ 1.412 Pa s |
| Olive oil (`olive-oil`) | refined; μ at 20 °C, ρ at 25 °C | 879 | — | — | — | μ 79.7 mPa s |
| Honey (`honey`) | industrialized, 21–24% water, 20 °C | 1420 (unverified) | — | — | — | μ 7.43 Pa s |
| Glass beads (`glass-beads`) | 2–4 mm | 2500 (–2600) | 46.2 (–65) GPa, 0.245 | — | — | — |
| Quartz sand (`sand-quartz`) | Leighton Buzzard, 1.18–2.36 mm | 2650 | 52 ± 12 GPa (grain scale), 0.25 | — | — | — |

Units: kg/m³, W/(m K), J/(kg K), 1/K. The full tables with every condition, the figure read and the citation are below.

Where the values come from, counted per value: standards and design aids that tabulate them 26, government laboratories and agencies (NIST, NBS, USDA Forest Products Laboratory, Lawrence Livermore) 35, manufacturers' and distributors' datasheets 76, peer-reviewed papers 24, an open textbook and a university course table 22, and **The Engineering ToolBox and Webmineral, marked as last resort, 24** (20 friction coefficients, ice's density, conductivity and specific heat, quartz's density). Two kinds of secondary copy are used and named as such: the Eurocode clauses were read in design aids (Eurocode Applied, Dlubal) except EN 1992-1-2, which was read in a copy of the standard; Wikipedia was not used.

## Unverified values

Six contact coefficients that the scene editor needs, and the density of honey, were not found in any opened source. They are kept so that the editor keeps a value, carry `source: 'unverified'` and a reason, and every helper refuses them unless `allowUnverified: true` is passed:

| Pair | Value | Note |
|---|---|---|
| aluminium 6061-T6 on itself, restitution | 0.5 | the editor's earlier value, written from memory |
| concrete on concrete, static friction | 0.6 | the editor's earlier table cited ACI 318's shear-friction coefficient; that code was not opened |
| concrete on concrete, restitution | 0.2 | the editor's earlier value |
| natural rubber on itself, restitution | 0.8 | the editor's earlier value |
| ice on ice, restitution | 0.3 | the editor's earlier value |
| loblolly pine on itself, restitution | 0.45 | the editor's earlier value |
| honey, density | 1420 kg/m³ | a recalled typical figure; the viscosity source's specific-gravity table was not readable |

Not in the library because no opened source gave them (the helpers then ask for the value): fracture toughness of the steels, stainless 304, copper, concrete (fracture energy), granite, PMMA, ABS, nylon and PTFE; tensile strength of ice; Poisson's ratio and specific heat of ABS and PTFE; specific heat of nylon; thermal conductivity of natural rubber; heat capacity and expansion of granite (illegible in the scanned report); restitution of quartz sand and of most pairs.

## Using it

```ts
import {solidMaterial, fractureLaw, heatMaterial, grainMaterial, contactPair, rigidMaterial, materialValue} from 'box3d-webgpu-kit/materials';

new SolidBody({mesh, material: solidMaterial('aluminium-6061-t6')});            // E, nu, rho, alpha
new FractureBody({mesh, material: solidMaterial('soda-lime-glass'), fracture: fractureLaw('soda-lime-glass')});
new HeatSolver({..., materials: [heatMaterial('copper-c11000'), heatMaterial('water')]});
new Granular({material: grainMaterial('glass-beads'), config});                   // E, nu, rho, e and mu bead on bead
const steel = contactPair('structural-steel-s355', 'structural-steel-s355');    // {staticFriction: 0.6, kineticFriction: 0.3, friction: 0.6, restitution: 0.56, impactSpeed: [3.13, 4.43], ...}
world.createBody({..., ...rigidMaterial('structural-steel-s355')});              // density, friction, restitution (+ where they came from)
materialValue('soda-lime-glass', 'fractureToughness');                          // {value: 750000, uncertainty: 40000, conditions, source, read, ...}
```

- **Overrides:** every helper takes the solver's own option names as overrides (`solidMaterial('abs', {poissonRatio: 0.35})`), and refuses with `EngineError('INVALID_PAYLOAD')` a value the library does not have or has only as unverified.
- **Poisson's ratio** is capped at 0.4999 (`SOLVER_POISSON_LIMIT`) for the solid and granular solvers: rubber's 0.5 cannot be passed as it is. Linear tetrahedra lock near 0.5 (see [SOLID_MECHANICS.md](SOLID_MECHANICS.md)).
- **Fracture:** `fractureLaw` turns K_IC into the cohesive law's G_c by Irwin's relation, **plane strain by default**, G_c = K_IC² (1 − ν²) / E, because K_IC is measured on thick specimens in plane strain. Pass `state: 'plane-stress'` (G_c = K_IC² / E) for a thin sheet whose crack front is in plane stress. The strength is the tensile strength, else the flexural strength (glass: 41 MPa in bending, set by surface flaws).
- **Friction in the rigid world:** Box3D has one Coulomb coefficient per contact for sticking and sliding, and mixes two bodies as √(f_a f_b) for friction and max(e_a, e_b) for restitution. `contactPair` and `rigidMaterial` give the **static** coefficient by default, so that what holds still in reality holds still; sliding then dissipates μ_s / μ_k times too much (2× for steel on steel). Pass `use: 'kinetic'` for sliding problems. To get a pair's value between two different materials, give both bodies the pair's numbers, or install a friction callback.
- **Restitution** belongs to a pair, a size and an impact speed. The library records the speed of the measurement (`impactSpeed`); no solver uses it, and Box3D does not apply restitution to slow impacts at all ([SCENE_FORMAT.md](SCENE_FORMAT.md#example-scenes)).
- **Wood** is orthotropic and is stored along the grain (`isotropic: false`); `solidMaterial` uses those values as isotropic, which is right only for loads along the grain. Table 5-1 of the Wood Handbook gives the ratios E_T / E_L and E_R / E_L for an orthotropic model.
- **Audit:** `materialAudit()` lists every value with its source; `shearConsistency(id)` compares a stated G with E / (2 (1 + ν)).

## Internal consistency

For the isotropic entries that state E, ν and G, the stated G against E / (2 (1 + ν)): S355 and S235 +0.29% (the design value is itself rounded), 6061-T6 +0.38%, copper −0.01% (ν was derived from the two moduli), granite +0.09%, soda-lime glass +2.5% (both moduli given to two digits). Two disagree and are **flagged** in the entry and kept as stated: stainless 304, where the datasheet's 86 GPa is 13% above the 76 GPa its own E and ν give, and PMMA, whose shear modulus is a dynamic one at 10 Hz, 41% above the value from the short-term tensile modulus (the material is viscoelastic).

## Validation

The `materials` domain of [VALIDATION.md](VALIDATION.md) (15 cases) runs solvers with library values and compares each with the closed form in which the value enters, with the reference computed from the library's own number: the four consistency rows above and a check that no disagreement is unflagged; an aluminium bar in tension (F L / (E A), to 1e-9); a steel cantilever (Timoshenko, 3.7% stiff at 8 cells through the thickness, the element's known bending error); a heated stainless bar (α ΔT L, to 1e-9); a centre-cracked glass plate failing at K_IC / (Y √(π a)) (3.5% low, the same as the concrete-like plate of the fracture domain); a copper bar cooling with τ = L² / (π² α) (to 4e-4); Hertz contact durations of rubber spheres and glass beads (to 2e-5); the glass beads' restitution (to 1e-5); and in the rigid world a steel block sliding to v₀² / (2 μ_k g) and a steel ball rebounding to e² h (2% low at 240 Hz). These check that the values reach the solvers in the right units and roles. They do not check the values against experiments.

Tests: `tests/engine/materials.test.mjs` (12 tests, in `npm run test:engine`) checks that every value has a listed source, the figure read and conditions, that every listed source is cited, the recorded unit conversions, the helpers and their refusals, and the solver cases; `packages/box3d-kit/test/v18-materials.test.mjs` (3 tests, in the kit gate) checks the published subpath and the rigid cases.

## Adding a material or a value

1. Open a source you can cite: a standard, a government laboratory, a manufacturer's datasheet, a peer-reviewed paper, a university course table. An engineering data website only when nothing else is found, with `kind: 'last-resort'`. Not memory, and not an encyclopaedia except to find the primary source.
2. Add the source to `MATERIAL_SOURCES` with its title, author, kind and URL, and the value to `MATERIALS` (or `CONTACT_PAIRS`) with `v(value, sourceId, read, conditions, {range, uncertainty, derived, also})`: `read` is the figure exactly as printed with its unit; `derived` says how the SI number follows from it (unit factor, evaluated formula, middle of a range). A value no source gave is `unverified(value, conditions, reason)`.
3. Keep the SI value to the digits the source gives; a range only when the sources disagree or one states it, and the value inside it.
4. Run `node --test tests/engine/materials.test.mjs`: it fails for a missing source, a value outside its range, a source that nothing cites, or a changed count (update the counts here and in the test). Raise `MATERIAL_LIBRARY_VERSION` (minor for a new or changed value, major for a removed one) and regenerate the tables below from the library.
5. If the value feeds a solver input that has a closed form, add a case to `validation/domains/materials.mjs` with its test.

## Full tables

### Structural steel S355 (`structural-steel-s355`)

EN 10025-2 S355, thickness up to 40 mm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 7850 |  | S355, EN 1993-1-1 3.2.6 design value | rho ≈ 7850 kg/m3 | [1] |
| Young's modulus (GPa) | 210 |  | S355, EN 1993-1-1 3.2.6 | E = 210000 MPa | [1] |
| Poisson's ratio (1) | 0.3 |  | S355, elastic range, EN 1993-1-1 3.2.6 | nu = 0.30 | [1] |
| Shear modulus (GPa) | 81 |  | S355, EN 1993-1-1 3.2.6 | G = E / [2 (1 + nu)] ≈ 81000 MPa | [1] |
| Thermal expansion (1e-6/K) | 12 |  | S355, EN 1993-1-1 3.2.6, for T <= 100 °C | alpha = 12 x 10^-6 1/K | [1] |
| Thermal conductivity (W/(m K)) | 53.334 |  | carbon steel at 20 °C, EN 1993-1-2 | lambda_a = 54 - 3.33 x 10^-2 theta_a W/(m K), 20 °C <= theta_a < 800 °C *(evaluated at theta_a = 20 °C)* | [2] |
| Specific heat (J/(kg K)) | 439.8 |  | carbon steel at 20 °C, EN 1993-1-2 | c_a = 425 + 7.73 x 10^-1 theta_a - 1.69 x 10^-3 theta_a^2 + 2.22 x 10^-6 theta_a^3 J/(kg K), 20 °C <= theta_a < 600 °C *(evaluated at theta_a = 20 °C: 425 + 15.46 - 0.676 + 0.018)* | [2] |
| Yield strength (MPa) | 355 |  | S355, EN 10025-2, t <= 40 mm (nominal) | f_y = 355 MPa | [1] |
| Tensile strength (MPa) | 490 |  | S355, EN 10025-2, t <= 40 mm (nominal) | f_u = 490 MPa | [1] |

*Note:* No fracture toughness: none was found in an opened source; structural steel is ductile at room temperature and its toughness depends on the grade's Charpy class.

### Structural steel S235 (`structural-steel-s235`)

EN 10025-2 S235, thickness up to 40 mm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 7850 |  | S235, EN 1993-1-1 3.2.6 design value | rho ≈ 7850 kg/m3 | [1] |
| Young's modulus (GPa) | 210 |  | S235, EN 1993-1-1 3.2.6 | E = 210000 MPa | [1] |
| Poisson's ratio (1) | 0.3 |  | S235, elastic range, EN 1993-1-1 3.2.6 | nu = 0.30 | [1] |
| Shear modulus (GPa) | 81 |  | S235, EN 1993-1-1 3.2.6 | G = E / [2 (1 + nu)] ≈ 81000 MPa | [1] |
| Thermal expansion (1e-6/K) | 12 |  | S235, EN 1993-1-1 3.2.6, for T <= 100 °C | alpha = 12 x 10^-6 1/K | [1] |
| Thermal conductivity (W/(m K)) | 53.334 |  | carbon steel at 20 °C, EN 1993-1-2 | lambda_a = 54 - 3.33 x 10^-2 theta_a W/(m K), 20 °C <= theta_a < 800 °C *(evaluated at theta_a = 20 °C)* | [2] |
| Specific heat (J/(kg K)) | 439.8 |  | carbon steel at 20 °C, EN 1993-1-2 | c_a = 425 + 7.73 x 10^-1 theta_a - 1.69 x 10^-3 theta_a^2 + 2.22 x 10^-6 theta_a^3 J/(kg K), 20 °C <= theta_a < 600 °C *(evaluated at theta_a = 20 °C: 425 + 15.46 - 0.676 + 0.018)* | [2] |
| Yield strength (MPa) | 235 |  | S235, EN 10025-2, t <= 40 mm (nominal) | f_y = 235 MPa | [1] |
| Tensile strength (MPa) | 360 |  | S235, EN 10025-2, t <= 40 mm (nominal) | f_u = 360 MPa | [1] |

### Stainless steel 304 (`stainless-304`)

AISI 304 (UNS S30400), annealed.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 8000 |  | room temperature | 8 g/cc | [3] |
| Young's modulus (GPa) | 196.5 | 193 – 200 | room temperature | 193 - 200 GPa *(middle of the stated range)* | [3] |
| Poisson's ratio (1) | 0.29 |  | room temperature | 0.29 | [3] |
| Shear modulus (GPa) | 86 |  | room temperature | 86 GPa | [3] |
| Yield strength (MPa) | 215 |  | annealed, room temperature | 215 MPa at 0.2% offset | [3] |
| Tensile strength (MPa) | 505 |  | annealed, room temperature | 505 MPa | [3] |
| Thermal conductivity (W/(m K)) | 16.2 |  | 0 to 100 °C | 16.2 W/m-K at 0-100 °C | [3] |
| Specific heat (J/(kg K)) | 500 |  | 0 to 100 °C | 0.5 J/g-°C from 0-100 °C | [3] |
| Thermal expansion (1e-6/K) | 17.3 |  | mean, 0 to 100 °C | 17.3 µm/m-°C, from 0-100 °C | [3] |

**Flag:** The sheet's shear modulus, 86 GPa, is 11% to 15% above E / (2 (1 + nu)) = 74.8 to 77.5 GPa from its own E and nu. Both are kept as stated; solidMaterial uses E and nu.

### Aluminium 6061-T6 (`aluminium-6061-t6`)

AA 6061-T6 / T651 (UNS A96061).

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2700 |  | room temperature | 2.7 g/cc (AA; Typical) | [4] |
| Young's modulus (GPa) | 68.9 | 68.9 – 70.35 | room temperature | 68.9 GPa (AA; Typical; average of tension and compression) *(NIST fit E(T) = 77.71221 + 1.030646e-2 T - 2.9241e-4 T^2 + 8.9936e-7 T^3 - 1.0709e-9 T^4 GPa gives 70.35 GPa at 293.15 K)* | [4] [5] |
| Poisson's ratio (1) | 0.33 |  | room temperature | 0.33 (estimated from trends in similar Al alloys) | [4] |
| Shear modulus (GPa) | 26 |  | room temperature | 26 GPa (estimated from similar Al alloys) | [4] |
| Yield strength (MPa) | 276 |  | T6, room temperature | 276 MPa (AA; Typical) | [4] |
| Tensile strength (MPa) | 310 |  | T6, room temperature | 310 MPa (AA; Typical) | [4] |
| Fracture toughness K_IC (MPa√m) | 29 |  | T6, TL orientation | 29 MPa-m^1/2 (K_IC; TL orientation) | [4] |
| Thermal conductivity (W/(m K)) | 167 | 154.4 – 167 | 25 °C | 167 W/m-K (AA; Typical at 77 °F) *(NIST log-polynomial fit evaluated at 293.15 K gives 154.4 W/(m K) (fit error 0.5%))* | [4] [5] |
| Specific heat (J/(kg K)) | 896 | 896 – 943 | room temperature | 0.896 J/g-°C *(NIST log-polynomial fit evaluated at 293.15 K gives 943 J/(kg K) (fit error 5%))* | [4] [5] |
| Thermal expansion (1e-6/K) | 23.6 |  | mean, 20 to 100 °C | 23.6 µm/m-°C (AA; Typical; average over 68-212 °F) | [4] |

### Copper C11000 (ETP) (`copper-c11000`)

C11000 electrolytic tough pitch, annealed (OS050) unless stated.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 8910 | 8885 – 8941 | 20 °C | specific gravity 8.91; density 0.322 lb/cu in at 68 °F (actual 0.321 - 0.323) *(0.321 and 0.323 lb/in^3 x 27679.9)* | [6] |
| Young's modulus (GPa) | 117.21 |  | room temperature | modulus of elasticity in tension 17000 ksi *(17000 ksi x 6.894757 MPa/ksi)* | [6] |
| Shear modulus (GPa) | 44.126 |  | room temperature | modulus of rigidity 6400 ksi *(6400 ksi x 6.894757 MPa/ksi)* | [6] |
| Poisson's ratio (1) | 0.328 |  | room temperature | derived from the two moduli above *(nu = E / (2 G) - 1 = 117.21 / 88.25 - 1)* | [6] |
| Yield strength (MPa) | 68.95 | 68.95 – 303.4 | annealed OS050; up to hard H04 | YS-0.5% Ext 10 ksi (flat, OS050, typical); 44 ksi for hard (H04) rod *(ksi x 6.894757 MPa/ksi)* | [6] |
| Tensile strength (MPa) | 220.6 | 220.6 – 330.9 | annealed OS050; up to hard H04 | tensile strength 32 ksi (flat, OS050, typical); 48 ksi for hard (H04) rod *(ksi x 6.894757 MPa/ksi)* | [6] |
| Thermal conductivity (W/(m K)) | 391.1 |  | 20 °C | 226 Btu/ sq ft/ ft hr/ °F at 68 °F *(226 x 1.730735 W/(m K) per Btu/(ft h °F))* | [6] |
| Specific heat (J/(kg K)) | 385.2 |  | 20 °C | 0.092 Btu/ lb /°F at 68 °F *(0.092 x 4186.8 J/(kg K) per Btu/(lb °F))* | [6] |
| Thermal expansion (1e-6/K) | 16.92 |  | mean, 20 to 100 °C | 9.4 x 10^-6 per °F (68 - 212 °F) *(9.4e-6 x 1.8)* | [6] |

### Grey cast iron EN-GJL-250 (`cast-iron-gjl-250`)

EN-GJL-250 (EN-JL-1040; comparable ASTM A48 class 35/40), pearlitic, separately cast 30 mm specimen.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 7200 |  | room temperature | 7,20 g/cm3 | [7] |
| Young's modulus (GPa) | 110.5 | 103 – 118 | room temperature, depends on the load | E (load-dependent) 103 - 118 kN/mm2 *(middle of the stated range)* | [7] |
| Poisson's ratio (1) | 0.26 |  | room temperature | 0,26 | [7] |
| Yield strength (MPa) | 196.5 | 165 – 228 | 0.1% proof stress | Rp0,1 165 - 228 N/mm2 (0.1% elastic limit) *(middle of the stated range)* | [7] |
| Tensile strength (MPa) | 300 | 250 – 350 | separately cast 30 mm specimen | Rm 250 - 350 N/mm2 *(middle of the stated range)* | [7] |
| Compressive strength (MPa) | 840 |  | room temperature | sigma_dB 840 N/mm2 | [7] |
| Fracture toughness K_IC (MPa√m) | 15.18 |  | room temperature | K_IC 480 N/mm^3/2 *(480 N/mm^1.5 x 31622.8 (Pa m^0.5 per N mm^-1.5))* | [7] |
| Thermal conductivity (W/(m K)) | 48.5 | 44.5 – 48.5 | 100 °C (44.5 at 500 °C) | lambda (100 - 500 °C) 48,5 - 44,5 W/(m K) | [7] |
| Specific heat (J/(kg K)) | 460 |  | mean, 20 to 200 °C | c 20° - 200° C = 460 J/(kg K) | [7] |
| Thermal expansion (1e-6/K) | 11.7 |  | mean, 20 to 200 °C | alpha 20° - 200° C = 11,7 µm/(m K) | [7] |

### Soda-lime glass (`soda-lime-glass`)

float / sheet soda-lime-silica glass, annealed.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2500 |  | 18 °C | 2 500 kg/m3 (@ 18 °C) | [8] |
| Young's modulus (GPa) | 72 |  | room temperature | 72 GPa | [8] |
| Shear modulus (GPa) | 30 |  | room temperature | 30 GPa | [8] |
| Poisson's ratio (1) | 0.23 |  | room temperature | 0,23 | [8] |
| Flexural strength (MPa) | 41 |  | annealed | flexural strength, annealed: 41 MPa (heat-strengthened 83, toughened 165) | [8] |
| Fracture toughness K_IC (MPa√m) | 0.75 ± 0.04 | 0.71 – 0.81 | in air at 35% RH and 73 °F; 0.79 MPa√m dry | soda lime silicate 0.75 ± 0.04 (35/73) in air; 0.79 ± 0.02 in dry N2 (MPa√m, ASTM C1421) *(range: air mean minus one deviation to dry mean plus one deviation)* | [9] |
| Thermal conductivity (W/(m K)) | 0.937 |  | room temperature | 0,937 W/(m K) | [8] |
| Specific heat (J/(kg K)) | 880 |  | room temperature | 0,88 kJ/(kg K) | [8] |
| Thermal expansion (1e-6/K) | 8.3 |  | room temperature | 8,3 * 10^-6 °C | [8] |

*Note:* The strength of glass is set by its surface flaws, not by a material constant; 41 MPa is the sheet's figure for annealed glass in bending.

### Concrete C30/37 (`concrete-c30-37`)

normal-weight concrete, strength class C30/37 (EN 1992-1-1), siliceous or calcareous aggregate.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2400 | 2300 – 2500 | plain normal-weight concrete | 2300 kg/m3 (siliceous concrete with 3% moisture, EN 1992-1-2 3.3.2 figure); ≈ 2500 kg/m3 for reinforced concrete (design aid) *(middle of the two figures read)* | [11] [10] |
| Young's modulus (GPa) | 32.837 |  | secant modulus at 28 days, quartzite-type aggregate | E_cm = 32837 MPa (C30/37) | [10] |
| Poisson's ratio (1) | 0.2 |  | uncracked | nu = 0.2 (uncracked concrete), clause 3.1.3(4) | [10] |
| Compressive strength (MPa) | 38 | 30 – 38 | mean cylinder strength at 28 days; characteristic 30 MPa | f_cm = 38 MPa (f_ck = 30 MPa) | [10] |
| Tensile strength (MPa) | 2.9 |  | mean axial tensile strength at 28 days | f_ctm = 2.90 MPa | [10] |
| Thermal conductivity (W/(m K)) | 1.642 | 1.333 – 1.951 | 20 °C | upper limit lambda_c = 2 - 0,2451 (theta/100) + 0,0107 (theta/100)^2 W/m K; lower limit 1,36 - 0,136 (theta/100) + 0,0057 (theta/100)^2 *(both limits evaluated at 20 °C; the value is their mean)* | [11] |
| Specific heat (J/(kg K)) | 900 |  | dry concrete (moisture 0%), 20 to 100 °C | c_p(theta) = 900 J/kg K for 20 °C <= theta <= 100 °C | [11] |
| Thermal expansion (1e-6/K) | 10 |  | design value | alpha = 10 x 10^-6 1/K, clause 3.1.3(5) | [10] |

*Note:* No fracture energy: the fib Model Code formula was not opened in a source, so fractureLaw needs `toughness` for concrete.

### Granite (Barre) (`granite-barre`)

Barre granite (Vermont), intact laboratory specimen.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2659.3 |  | intact, natural moisture | unit weight 2659.3 kg/m3 | [12] |
| Young's modulus (GPa) | 72.4 |  | intact | Young's modulus 72.4 GPa | [12] |
| Poisson's ratio (1) | 0.22 |  | intact | Poisson's ratio 0.22 | [12] |
| Shear modulus (GPa) | 29.7 |  | intact | shear modulus 29.7 GPa | [12] |
| Compressive strength (MPa) | 234.5 |  | intact | uniaxial compressive strength 234.5 MPa | [12] |
| Tensile strength (MPa) | 7.6 |  | intact | tensile strength 7.6 MPa | [12] |
| Thermal conductivity (W/(m K)) | 2.37 |  | room temperature | thermal conductivity 2.37 W/m °K | [12] |

*Note:* Heat capacity and expansion coefficient are in the same table but not legible in the scanned copy; fracture toughness was not found in an opened source.

### Northern red oak, along the grain (`oak-red-northern`)

Quercus rubra, clear straight-grained, 12% moisture content. Orthotropic: elastic values are along the grain.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 705.6 |  | 12% moisture content | specific gravity 0.63 at 12% (oven-dry mass, volume at 12%) *(rho = G_12 (1 + 0.12) x 1000 kg/m3 (Table 4-6a gives 694 and 717 for G = 0.62 and 0.64))* | [13] [14] |
| Young's modulus (GPa) | 13.75 | 12.5 – 13.75 | E_L, 12% moisture content | modulus of elasticity 12,500 MPa (static bending); "to correct for shear deflection, the modulus can be increased by 10%" *(12.5 GPa x 1.10)* | [13] |
| Poisson's ratio (1) | 0.35 | 0.35 – 0.448 | nu_LR, about 12% moisture content | mu_LR 0.350, mu_LT 0.448 (Table 5-2, oak, red) | [13] |
| Shear modulus (GPa) | 1.224 |  | G_LR, about 12% moisture content | G_LR / E_L = 0.089 (Table 5-1, oak, red) *(0.089 x 13.75 GPa)* | [13] |
| Flexural strength (MPa) | 99 |  | 12% moisture content, clear specimen | modulus of rupture 99,000 kPa | [13] |
| Compressive strength (MPa) | 46.6 |  | 12% moisture content, clear specimen | compression parallel to grain 46,600 kPa | [13] |
| Fracture toughness K_IC (MPa√m) | 0.385 | 0.22 – 0.55 | crack along the grain (TL, RL), 10 to 12% moisture content | mode I fracture toughness 220 to 550 kPa m^1/2 (all species) *(middle of the stated range)* | [13] |
| Thermal conductivity (W/(m K)) | 0.309 | 0.257 – 0.481 | along the grain, 12% moisture, about 24 °C | k = G_x (B + C x) + A, A = 0.01864, B = 0.1941, C = 0.004064 (across the grain); along the grain greater by a factor of 1.5 to 2.8, average about 1.8 *(across 0.1716 W/(m K) at G = 0.63, x = 12, times 1.8 (1.5 to 2.8))* | [14] |
| Specific heat (J/(kg K)) | 1620 |  | 12% moisture content, 293.15 K | c_p0 = 0.1031 + 0.003867 T; c_p,x = (c_p0 + c_pw x/100)/(1 + x/100) + A_c; A_c = x (b1 + b2 T + b3 x), b1 = -0.06191, b2 = 2.36e-4, b3 = -1.33e-4 *(evaluated at T = 293.15 K, x = 12, c_pw = 4.18 kJ/(kg K): 1.620 kJ/(kg K))* | [14] |
| Thermal expansion (1e-6/K) | 3.8 | 3.1 – 4.5 | along the grain, oven-dry wood | parallel-to-grain values have ranged from about 3.1 to 4.5 x 10^-6 K^-1 *(middle of the stated range)* | [14] |

*Note:* Orthotropic: E_T / E_L = 0.082 and E_R / E_L = 0.154 (Table 5-1). solidMaterial uses the along-grain values as if isotropic, which is right only for loads along the grain.

### Loblolly pine (southern pine), along the grain (`pine-loblolly`)

Pinus taeda, clear straight-grained, 12% moisture content. Orthotropic: elastic values are along the grain.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 571.2 |  | 12% moisture content | specific gravity 0.51 at 12% *(rho = G_12 (1 + 0.12) x 1000 kg/m3)* | [13] [14] |
| Young's modulus (GPa) | 13.53 | 12.3 – 13.53 | E_L, 12% moisture content | modulus of elasticity 12,300 MPa (static bending), +10% for shear deflection *(12.3 GPa x 1.10)* | [13] |
| Poisson's ratio (1) | 0.328 | 0.292 – 0.328 | nu_LR, about 12% moisture content | mu_LR 0.328, mu_LT 0.292 (Table 5-2, pine, loblolly) | [13] |
| Shear modulus (GPa) | 1.109 |  | G_LR, about 12% moisture content | G_LR / E_L = 0.082 (Table 5-1, pine, loblolly) *(0.082 x 13.53 GPa)* | [13] |
| Flexural strength (MPa) | 88 |  | 12% moisture content, clear specimen | modulus of rupture 88,000 kPa | [13] |
| Compressive strength (MPa) | 49.2 |  | 12% moisture content, clear specimen | compression parallel to grain 49,200 kPa | [13] |
| Fracture toughness K_IC (MPa√m) | 0.385 | 0.22 – 0.55 | crack along the grain (TL, RL), 10 to 12% moisture content | mode I fracture toughness 220 to 550 kPa m^1/2 (all species) *(middle of the stated range)* | [13] |
| Thermal conductivity (W/(m K)) | 0.2565 | 0.2138 – 0.399 | along the grain, 12% moisture, about 24 °C | k = G_x (B + C x) + A across the grain; along the grain 1.5 to 2.8 times, average about 1.8 *(across 0.1425 W/(m K) at G = 0.51, x = 12, times 1.8 (1.5 to 2.8))* | [14] |
| Specific heat (J/(kg K)) | 1620 |  | 12% moisture content, 293.15 K | equations 4-16a, 4-17, 4-18 (independent of species) *(evaluated at T = 293.15 K, x = 12)* | [14] |
| Thermal expansion (1e-6/K) | 3.8 | 3.1 – 4.5 | along the grain, oven-dry wood | parallel-to-grain values about 3.1 to 4.5 x 10^-6 K^-1 *(middle of the stated range)* | [14] |

*Note:* Orthotropic: E_T / E_L = 0.078 and E_R / E_L = 0.113 (Table 5-1).

### PMMA (cast acrylic) (`pmma`)

PLEXIGLAS GS (cast), 23 °C and 50% RH.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1190 |  | 23 °C | 1.19 g/cm3 (ISO 1183) | [15] |
| Young's modulus (GPa) | 3.3 |  | short-term, 23 °C | modulus of elasticity E_t (short-term value) 3300 MPa (ISO 527-2/1B/1) | [15] |
| Poisson's ratio (1) | 0.37 |  | 23 °C | Poisson's ratio 0.37 (5% per min, up to 2% dilatation, 23 °C) | [15] |
| Shear modulus (GPa) | 1.7 |  | dynamic, about 10 Hz, 23 °C | dynamic shear modulus G at approx. 10 Hz 1700 MPa (ISO 537) | [15] |
| Tensile strength (MPa) | 80 |  | 23 °C | tensile strength 80 MPa at 23 °C (110 at -40 °C, 40 at 70 °C) | [15] |
| Flexural strength (MPa) | 115 |  | 23 °C | flexural strength 115 MPa (ISO 178) | [15] |
| Compressive strength (MPa) | 110 |  | 23 °C | compressive yield stress 110 MPa (ISO 604) | [15] |
| Thermal conductivity (W/(m K)) | 0.19 |  | room temperature | 0.19 W/mK (DIN 52612) | [15] |
| Specific heat (J/(kg K)) | 1470 |  | room temperature | 1.47 J/gK | [15] |
| Thermal expansion (1e-6/K) | 70 |  | mean, 0 to 50 °C | 7 x 10^-5 1/K for 0 - 50 °C | [15] |

**Flag:** The dynamic shear modulus (10 Hz) is 41% above E / (2 (1 + nu)) = 1.20 GPa from the short-term tensile modulus: PMMA is viscoelastic and the two are measured at different rates.

### ABS (`abs`)

Terluran GP-35, general purpose injection moulding grade, 23 °C.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1040 |  | 23 °C | 1040 kg/m3 (ISO 1183) | [16] |
| Young's modulus (GPa) | 2.3 |  | 23 °C | tensile modulus 2300 MPa (ISO 527-1/-2) | [16] |
| Yield strength (MPa) | 44 |  | 23 °C, 50 mm/min | yield stress, 50 mm/min, 44 MPa | [16] |
| Flexural strength (MPa) | 65 |  | 23 °C | flexural strength 65 MPa (ISO 178) | [16] |
| Thermal conductivity (W/(m K)) | 0.17 |  | room temperature | thermal conductivity 0.17 W/(m K) (DIN 52612-1) | [16] |
| Thermal expansion (1e-6/K) | 95 | 80 – 110 | mean, 23 to 80 °C | coefficient of linear thermal expansion, longitudinal (23-80) °C, 0.8 - 1.1 E-4/°C *(middle of the stated range)* | [16] |

*Note:* No Poisson's ratio or specific heat in the opened datasheet: solidMaterial and heatMaterial need them as overrides.

### Nylon 66 (PA66) (`nylon-66`)

Zytel 101L NC010, unreinforced, dry as moulded (conditioned values in the ranges).

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1140 |  | dry, 23 °C | density 1140 kg/m3 (ISO 1183) | [17] |
| Young's modulus (GPa) | 3.1 | 1.4 – 3.1 | dry as moulded, 23 °C; 1.4 GPa conditioned | tensile modulus 3100 / 1400 MPa (dry / conditioned, ISO 527-1/-2) | [17] |
| Poisson's ratio (1) | 0.37 | 0.37 – 0.43 | dry; 0.43 conditioned | Poisson's ratio 0.37 / 0.43 (dry / conditioned) | [17] |
| Yield strength (MPa) | 82 | 55 – 82 | dry; 55 MPa conditioned | yield stress, 50 mm/min, 82 / 55 MPa (dry / conditioned) | [17] |
| Thermal conductivity (W/(m K)) | 0.24 |  | solid | thermal conductivity 0.24 W/(m K) (ISO 22007-2) | [17] |
| Thermal expansion (1e-6/K) | 100 | 100 – 110 | parallel to flow | coeff. of linear therm. expansion, parallel 100 E-6/K (normal 110) | [17] |

*Note:* No specific heat of the solid in the opened datasheet (only of the melt): heatMaterial needs it as an override.

### PTFE (`ptfe`)

unfilled PTFE, 23 °C.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2160 |  | 23 °C | 2.16 g/cm3 (ASTM D792) | [18] |
| Young's modulus (GPa) | 0.5516 |  | 23 °C | tensile modulus 80,000 psi (ASTM D638) *(80000 psi x 6894.757 Pa/psi)* | [18] |
| Tensile strength (MPa) | 26.89 |  | 23 °C | tensile strength 3,900 psi (ASTM D638) *(3900 psi x 6894.757 Pa/psi)* | [18] |
| Compressive strength (MPa) | 24.13 |  | 23 °C | compressive strength 3,500 psi (ASTM D695) *(3500 psi x 6894.757 Pa/psi)* | [18] |
| Thermal conductivity (W/(m K)) | 0.2452 |  | 23 °C | 1.70 BTU-in/ft2-hr-°F; 5.86 x 10^-4 cal/cm-sec-°C (ASTM C177) *(5.86e-4 x 418.4)* | [18] |
| Thermal expansion (1e-6/K) | 135 |  | around 23 °C | 7.5 x 10^-5 in./in./°F (ASTM D696) *(7.5e-5 x 1.8)* | [18] |

*Note:* No Poisson's ratio or specific heat in the opened datasheet: solidMaterial and heatMaterial need them as overrides.

### Natural rubber (`natural-rubber`)

pure-gum (unfilled) vulcanizate for the stiffness; rubber hydrocarbon for density, expansion and heat capacity.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 921.7 |  | unvulcanized rubber hydrocarbon, near room temperature (the temperature is not legible in the scanned copy) | taking the density to be 0.921 7 at that temperature (dilatometer sample of rubber hydrocarbon) | [19] |
| Young's modulus (GPa) | 1.5e-3 | 1e-3 – 2e-3 | small strain, pure-gum vulcanizate | 1, 1.5, and 2 MPa respectively, normal values for a pure-gum vulcanizate at different increasing degrees of cross-linking | [21] |
| Shear modulus (GPa) | 5e-4 | 3.33e-4 – 6.67e-4 | small strain | Young's modulus "will be equal to 3G where G is the shear modulus" *(G = E / 3)* | [21] |
| Poisson's ratio (1) | 0.5 |  | small strain | E = 3G (incompressible) *(E = 2 G (1 + nu) with E = 3 G gives nu = 0.5; the solver helpers use 0.4999, the largest value the solvers accept)* | [21] |
| Specific heat (J/(kg K)) | 1880 ± 2 |  | rubber hydrocarbon, 298.1 K | At 298.1 °K the heat capacity of the rubber is 1.880 ± 0.002 j/g/°C | [20] |
| Thermal expansion (1e-6/K) | 223 |  | linear, 25 °C | volume coefficient of expansion (amorphous I form, -72 to +85 °C) = 0.00067 + 0.0000007 (t - 25) *(one third of the volume coefficient 6.7e-4 at 25 °C)* | [19] |

*Note:* Thermal conductivity was not found in an opened source. Filled compounds are denser and stiffer than these values.

### Ice (freshwater, polycrystalline) (`ice`)

pristine terrestrial ice Ih, about 3 mm grains; thermal values at -10 °C.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 918.9 | 916.2 – 920 | -10 °C | 918.9 kg/m3 at -10 °C (916.2 at 0 °C, 920.0 at -30 °C) | [23] |
| Young's modulus (GPa) | 9.3 |  | terrestrial conditions | Young's modulus E = 9.3 GPa (Gammon et al. 1983) under terrestrial conditions | [22] |
| Poisson's ratio (1) | 0.33 |  | terrestrial conditions | Poisson's ratio = 0.33 (Gammon et al. 1983) | [22] |
| Fracture toughness K_IC (MPa√m) | 0.1 | 0.1 – 0.14 | about 3 mm grains, near -10 °C | K_Ic = 0.1 MPa m^1/2 for pristine, terrestrial ice of ∼3-mm grain size; 0.14 at -173 °C | [22] |
| Fracture energy G_c (J/m^2) | 1 |  | plane strain, from the values above | G_c = K_Ic^2 (1 - nu^2) / E ... giving G_c = 1 J m^-2 | [22] |
| Thermal conductivity (W/(m K)) | 2.3 | 2.22 – 2.5 | -10 °C | 2.30 W/mK at -10 °C (2.22 at 0 °C) | [23] |
| Specific heat (J/(kg K)) | 2000 | 1882 – 2050 | -10 °C | 2.000 kJ/kgK at -10 °C (2.050 at 0 °C) | [23] |

*Note:* No tensile strength in an opened source: fractureLaw needs `strength` for ice.

### Water at 20 °C (`water`)

liquid water, 293.15 K, 0.101325 MPa (IAPWS-95 via NIST).

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 998.21 |  | 293.15 K, 0.101325 MPa | 998.207 kg/m3 | [24] |
| Specific heat (J/(kg K)) | 4184.1 |  | 293.15 K, 0.101325 MPa | Cp 4.18405 J/g*K | [24] |
| Thermal conductivity (W/(m K)) | 0.59801 |  | 293.15 K, 0.101325 MPa | therm. cond. 0.598012 W/m*K | [24] |
| Viscosity (mPa s) | 1.0016 |  | 293.15 K, 0.101325 MPa | viscosity 0.00100160 Pa*s | [24] |
| Speed of sound (m/s) | 1482.3 |  | 293.15 K, 0.101325 MPa | sound spd. 1482.35 m/s | [24] |

### Air at 20 °C (`air`)

dry air, 20 °C, 1 atm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1.204 |  | 20 °C, 1 atm | rho 1.204 kg/m3 at 20 °C | [25] |
| Specific heat (J/(kg K)) | 1007 |  | 20 °C, 1 atm | c_p 1007 J/kg K at 20 °C | [25] |
| Thermal conductivity (W/(m K)) | 0.02514 |  | 20 °C, 1 atm | k 0.02514 W/m K at 20 °C | [25] |
| Viscosity (mPa s) | 0.01825 |  | 20 °C, 1 atm | mu 1.825 x 10^-5 kg/m s at 20 °C | [25] |


### Glycerol at 20 °C (`glycerol`)

anhydrous glycerol (100% by weight), 20 °C, 1 atm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1261.1 |  | 100% glycerol, 20 °C | 100 w/w %: 1.26108 at 20 °C (g/cm3) | [34] |
| Viscosity (mPa s) | 1412 |  | 100% glycerol, 20 °C | 100% glycerol, 20 °C: 1412 centipoise (Table V) | [33] |

A few percent of water lowers the viscosity sharply: 99% glycerol is 1150 cP and 95% is 523 cP at 20 °C in the same table.

### Olive oil (refined) (`olive-oil`)

refined olive oil (Salada brand), viscosity at 20 °C, density at 25 °C.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 879 | ± 3 | 25 °C (not 20 °C) | Oliva: ρ 0,879 ± 0,003 g/cm3 at 25 ± 1 °C (Tabela 2) | [35] |
| Viscosity (mPa s) | 79.7 |  | 20 °C, constant shear rate | Oliva, T 20,0 °C: 79,7 mPa.s (Tabela 3) | [35] |

### Honey (industrialized) (`honey`)

industrialized bee honey, 20.8 to 24.4% water, 73.6 to 77.3 °Brix, 20 °C.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 1420 |  | 20 °C, about 17 to 18% water | — | unverified |
| Viscosity (mPa s) | 7430 |  | 20 °C, Brookfield RVDV-E viscometer, mean of the samples | mean absolute viscosity at 20 ºC (7430 mPa∙s); Newtonian | [36] |

Honey viscosity depends strongly on water content and temperature: 2636 mPa s at 30 °C in the same source.
### Glass beads (`glass-beads`)

solid glass spheres of about 2 to 4 mm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2500 | 2500 – 2600 | beads of 2 mm | density of glass beads rho 2500 kg/m3 (Table 5) *(Sandeep et al. 2020 Table 1: 2.60 t/m3)* | [26] [28] |
| Young's modulus (GPa) | 46.2 | 46.2 – 65 | DEM input | Young's modulus of glass beads E 46.2 GPa (Table 5, DEM input; the paper does not say how it was obtained) *(Sandeep and Senetakis 2018: 58 ± 7 GPa back-calculated from grain-contact tests)* | [26] [27] |
| Poisson's ratio (1) | 0.245 | 0.245 – 0.3 | DEM input | Poisson's ratio of glass beads 0.245 (Table 5) *(Sandeep and Senetakis 2018 use 0.30 from the literature)* | [26] [27] |

*Note:* Grain-scale moduli back-calculated from contact tests depend on surface roughness; they are not the bulk modulus of the glass.

### Quartz sand (`sand-quartz`)

Leighton Buzzard quartz sand grains, 1.18 to 2.36 mm.

| Property | Value | Range | Conditions | Read in the source | Source |
|---|---|---|---|---|---|
| Density (kg/m^3) | 2650 | 2600 – 2650 | quartz mineral (grain density, not bulk density) | Specific Gravity of Quartz = 2.65 gm/cc; density 2.6 - 2.65, average = 2.62 | [29] |
| Young's modulus (GPa) | 52 ± 12 |  | grain-scale, back-calculated | Young's modulus E 52 ± 12 GPa (LBS, back-calculated from Hertz fits of grain contacts) | [27] |
| Poisson's ratio (1) | 0.25 |  | assumed by the source | Poisson's ratio 0.25 (LBS; based on the literature) | [27] |

*Note:* No restitution for quartz grains in an opened source: grainMaterial needs `restitution` for sand.

## Contact pairs

| Pair | Condition | Static | Kinetic | Unqualified | Restitution | Impact speed (m/s) | Sources |
|---|---|---|---|---|---|---|---|
| `structural-steel-s355` / `structural-steel-s355` | dry | 0.6 (0.5–0.8) | 0.3 (0.3–0.42) |  | 0.56 | 3.13–4.43 | [30] [31] [32] |
| `structural-steel-s355` / `structural-steel-s355` | lubricated | 0.05 (0.05–0.23) | 0.03 (0.03–0.084) |  |  |  | [30] [31] |
| `aluminium-6061-t6` / `structural-steel-s355` | dry | 0.61 | 0.47 |  |  |  | [31] |
| `aluminium-6061-t6` / `aluminium-6061-t6` | dry | 1.2 (1.05–1.35) | 0.4 |  |  |  | [31] |
| `copper-c11000` / `structural-steel-s355` | dry | 0.53 | 0.36 |  |  |  | [31] |
| `cast-iron-gjl-250` / `cast-iron-gjl-250` | dry | 1.1 | 0.15 |  |  |  | [31] |
| `cast-iron-gjl-250` / `structural-steel-s355` | dry | 0.4 | 0.23 |  |  |  | [31] |
| `soda-lime-glass` / `soda-lime-glass` | dry | 0.95 (0.9–1) | 0.4 |  |  |  | [31] |
| `soda-lime-glass` / `soda-lime-glass` | lubricated | 0.35 (0.1–0.6) | 0.105 (0.09–0.12) |  |  |  | [31] |
| `soda-lime-glass` / `structural-steel-s355` | dry |  |  |  | 0.71 | 3.13–4.43 | [32] |
| `glass-beads` / `glass-beads` | dry |  |  | 0.12 (0.1–0.16) ± 0.02 | 0.926 (0.926–0.94) | not stated | [27] [26] |
| `glass-beads` / `granite-barre` | dry |  |  |  | 0.95 (0.92–0.97) | 1.74–2.43 | [28] |
| `sand-quartz` / `sand-quartz` | dry |  |  | 0.19 (0.15–0.23) ± 0.04 |  |  | [27] |
| `oak-red-northern` / `oak-red-northern` | dry | 0.62 | 0.48 |  |  |  | [31] |
| `pine-loblolly` / `pine-loblolly` | dry | 0.5 | 0.3 |  |  |  | [30] |
| `pine-loblolly` / `structural-steel-s355` | dry | 0.5 | 0.3 (0.3–0.5) |  |  |  | [30] [14] |
| `natural-rubber` / `concrete-c30-37` | dry | 1 | 0.7 (0.6–0.85) |  |  |  | [30] [31] |
| `natural-rubber` / `concrete-c30-37` | wet | 0.6 (0.5–0.7) | 0.4 (0.3–0.5) |  |  |  | [30] |
| `ptfe` / `structural-steel-s355` | dry | 0.04 (0.04–0.2) | 0.04 |  |  |  | [30] [31] |
| `ptfe` / `ptfe` | dry | 0.04 | 0.04 |  |  |  | [31] |
| `ice` / `ice` | dry | 0.1 (0.1–0.6) | 0.03 (0.02–0.035) |  |  |  | [30] [31] [22] |
| `ice` / `structural-steel-s355` | dry | 0.04 | 0.02 |  |  |  | [30] |
| `pmma` / `pmma` | dry |  |  | 0.8 |  |  | [15] |
| `pmma` / `structural-steel-s355` | dry |  |  | 0.5 (0.45–0.5) |  |  | [15] |
| `nylon-66` / `nylon-66` | dry | 0.2 (0.15–0.25) |  |  |  |  | [31] |
| `nylon-66` / `structural-steel-s355` | dry | 0.4 |  |  |  |  | [31] |
| `aluminium-6061-t6` / `aluminium-6061-t6` | dry |  |  |  | 0.5 **unverified** | 1–1 | — |
| `concrete-c30-37` / `concrete-c30-37` | dry | 0.6 **unverified** |  |  | 0.2 **unverified** | 1–1 | — |
| `natural-rubber` / `natural-rubber` | dry |  |  |  | 0.8 **unverified** | 1–1 | — |
| `ice` / `ice` | dry |  |  |  | 0.3 **unverified** | 1–1 | — |
| `pine-loblolly` / `pine-loblolly` | dry |  |  |  | 0.45 **unverified** | 1–1 | — |

## Sources

All opened on 2026-11-12.

1. `ec3-design-properties` — Eurocode Applied (design aid), *Eurocode 3 Table of design material properties for structural steel (EN 1993-1-1:2005+AC2:2009, 3.2.1 and 3.2.6)*. <https://cdn.eurocodeapplied.com/design/en1993/steel-design-properties>. Kind: standard. A design aid that tabulates the clauses of EN 1993-1-1; the standard itself was not opened.
2. `dlubal-en1993-1-2` — Dlubal Software (knowledge base), *Structural Fire Design According to DIN EN 1993-1-2 (Thermal Material Properties)*. <https://www.dlubal.com/en-US/support-and-learning/support/knowledge-base/001496>. Kind: standard. Quotes the EN 1993-1-2:2005+AC:2009 formulas for carbon steel; the standard itself was not opened.
3. `asm-304` — Aerospace Specification Metals (ASM material data sheet), *AISI Type 304 Stainless Steel*. <https://www.aerospacemetals.com/wp-content/uploads/2023/07/AISI-Type-304-Stainless-Steel.pdf>. Kind: manufacturer.
4. `asm-6061-t6` — Aerospace Specification Metals (ASM material data sheet; data from the Aluminum Association, "AA; Typical", not for design), *Aluminum 6061-T6; 6061-T651*. <https://www.aerospacemetals.com/wp-content/uploads/2023/06/Aluminum-6061-T6-6061-T651.pdf>. Kind: manufacturer.
5. `nist-cryo-6061` — NIST Cryogenic Technologies Group, *Material Properties: 6061-T6 Aluminum (UNS A96061)*. <https://trc.nist.gov/cryogenics/materials/6061%20Aluminum/6061_T6Aluminum_rev.htm>. Kind: government. Curve fits for 1 to 300 K; the values here are the fits evaluated at 293.15 K (the Young's modulus fit is stated to 295 K).
6. `cda-c11000` — Copper Development Association, *C11000 Electrolytic Tough Pitch (ETP) copper: properties*. <https://alloys.copper.org/alloy/C11000>. Kind: manufacturer.
7. `ke-en1561` — Kemptener Eisengießerei Adam Hönig AG, *KE factory standard based on EN 1561, cast iron with lamellar graphite (material table)*. <https://www.ke-ag.de/wp-content/uploads/2018/10/Werkstofftabelle-GJLver2018.pdf>. Kind: manufacturer.
8. `ct-soda-lime` — Continental Trade Sp. z o.o., *Soda-lime glass properties (information sheet)*. <https://www.continentaltrade.com.pl/en/download/WhfvdEYg1jSqsBXM5x9dRJnJfIPvp1gO/soda-lime-glass-properties.pdf>. Kind: manufacturer.
9. `salem-jenkins-2018` — J. A. Salem (NASA Glenn), M. G. Jenkins, *Applying ASTM International C1421 to glasses and optical ceramics, Ceramic Engineering and Science Proceedings (42nd ICACC), 2018, Table 4*. <https://ntrs.nasa.gov/api/citations/20180005170/downloads/20180005170.pdf>. Kind: peer-reviewed.
10. `ec2-design-properties` — Eurocode Applied (design aid), *Table of concrete design properties (fcd, fctm, Ecm, fctd), Eurocode 2 (EN 1992-1-1:2004+AC2:2010, 3.1.2 and 3.1.3)*. <https://eurocodeapplied.com/design/en1992/concrete-design-properties>. Kind: standard. A design aid that tabulates EN 1992-1-1 Table 3.1; the standard itself was not opened.
11. `en1992-1-2` — CEN (BS EN 1992-1-2:2004), *Eurocode 2: Design of concrete structures, Part 1-2: Structural fire design, clauses 3.3.2 and 3.3.3*. <https://www.phd.eng.br/wp-content/uploads/2015/12/en.1992.1.2.2004.pdf>. Kind: standard.
12. `ucrl-15151` — Willard Owens Associates for Lawrence Livermore Laboratory, *UCRL-15151, Geoscience parameter data base handbook: granites and basalts, Table 1-5 "Intact properties of Barre Granite" (from Office of Waste Isolation, 1978)*. <https://www.osti.gov/servlets/purl/5719576>. Kind: government. A scanned report; the heat capacity and the expansion coefficient in the same table are not legible and were not used.
13. `wood-handbook-ch5` — D. E. Kretschmann, USDA Forest Products Laboratory, *Mechanical Properties of Wood, chapter 5 of the Wood Handbook, FPL-GTR-190 (2010), Tables 5-1, 5-2 and 5-3a*. <https://research.fs.usda.gov/download/treesearch/37427.pdf>. Kind: government.
14. `wood-handbook-ch4` — S. V. Glass, S. L. Zelinka, USDA Forest Products Laboratory, *Moisture Relations and Physical Properties of Wood, chapter 4 of the Wood Handbook, FPL-GTR-190 (2010), equations 4-15 to 4-18*. <https://research.fs.usda.gov/download/treesearch/37428.pdf>. Kind: government.
15. `evonik-plexiglas` — Evonik Industries AG, *Technical Information PLEXIGLAS GS/XT (211-1), September 2011*. <https://igepa.ee/wp-content/uploads/2017/06/211-1-PLEXIGLAS-GS-XT-en.pdf>. Kind: manufacturer.
16. `basf-terluran-gp35` — BASF SE, *Product Information Terluran GP-35 (ABS)*. <https://static.chipdip.ru/lib/299/DOC015299117.pdf>. Kind: manufacturer.
17. `dupont-zytel-101l` — DuPont, *Zytel 101L NC010 nylon resin (PA66) datasheet*. <https://quickparts.com/wp-content/uploads/2023/04/zytel%C2%AE-101l-nc010-gb.pdf>. Kind: manufacturer.
18. `proplas-ptfe` — Professional Plastics (distributor), *Typical properties of PTFE*. <https://www.professionalplastics.com/professionalplastics/content/downloads/Teflon_PTFE.pdf>. Kind: manufacturer.
19. `nbs-rp717` — N. Bekkedahl, National Bureau of Standards, *Forms of rubber as indicated by temperature-volume relationship, J. Res. NBS 13 (1934) 411, RP717*. <https://nvlpubs.nist.gov/nistpubs/jres/13/jresv13n3p411_A2b.pdf>. Kind: government.
20. `nbs-rp844` — N. Bekkedahl, H. Matheson, National Bureau of Standards, *Heat capacity, entropy, and free energy of rubber hydrocarbon, J. Res. NBS 15 (1935) 503, RP844*. <https://nvlpubs.nist.gov/nistpubs/jres/15/jresv15n5p503_A1b.pdf>. Kind: government.
21. `wood-1977-rubber` — L. A. Wood, National Bureau of Standards, *Uniaxial Extension and Compression in Stress-Strain Relations of Rubber, J. Res. NBS 82 (1977) 57-63, doi:10.6028/jres.082.005*. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6751957>. Kind: peer-reviewed.
22. `schulson-renshaw-2022` — E. M. Schulson, C. E. Renshaw, *Fracture, Friction, and Permeability of Ice, Annu. Rev. Earth Planet. Sci. 50 (2022) 323-343*. <https://par.nsf.gov/servlets/purl/10334531>. Kind: peer-reviewed.
23. `etb-ice` — The Engineering ToolBox, *Ice - Thermal Properties*. <https://www.engineeringtoolbox.com/ice-thermal-properties-d_576.html>. Kind: last-resort.
24. `nist-webbook-water` — NIST Chemistry WebBook, SRD 69 (E. W. Lemmon, M. O. McLinden, D. G. Friend), *Thermophysical Properties of Fluid Systems: water, isobar 0.101325 MPa, 293.15 K*. <https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID=C7732185&Type=IsoBar&Digits=6&P=0.101325&THigh=293.15&TLow=293.15&TInc=1&RefState=DEF&TUnit=K&PUnit=MPa&DUnit=kg%2Fm3&HUnit=kJ%2Fkg&WUnit=m%2Fs&VisUnit=Pa*s&STUnit=N%2Fm>. Kind: government.
25. `cengel-a9-air` — Y. A. Çengel, Table A-9, as posted by J. M. Cimbala for Penn State ME 420, *Table A-9: Properties of air at 1 atm pressure*. <https://www.me.psu.edu/cimbala/me420/Links/Table_A_9_CC_Properties_of_Air.pdf>. Kind: textbook.
26. `tang-2019` — H. Tang, R. Song, Y. Dong, X. Song, *Measurement of Restitution and Friction Coefficients for Granular Particles and Discrete Element Simulation for the Tests of Glass Beads, Materials 12 (2019) 3170, doi:10.3390/ma12193170, Tables 3 and 5*. <https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6803946/fullTextXML>. Kind: peer-reviewed.
27. `sandeep-2018` — C. S. Sandeep, K. Senetakis, *Effect of Young's Modulus and Surface Roughness on the Inter-Particle Friction of Granular Materials, Materials 11 (2018) 217, doi:10.3390/ma11020217, Table 1*. <https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5848914/fullTextXML>. Kind: peer-reviewed.
28. `sandeep-2020` — C. S. Sandeep, L. Luo, K. Senetakis, *Effect of Grain Size and Surface Roughness on the Normal Coefficient of Restitution of Single Grains, Materials 13 (2020) 814, doi:10.3390/ma13040814, Tables 1 and 2*. <https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7079616/fullTextXML>. Kind: peer-reviewed.
29. `webmineral-quartz` — Webmineral (D. Barthelmy), *Quartz Mineral Data*. <https://www.webmineral.com/data/Quartz.shtml>. Kind: last-resort.
30. `openstax-up1` — OpenStax (Rice University), University Physics Volume 1, *6.2 Friction, Table 6.1 "Approximate Coefficients of Static and Kinetic Friction"*. <https://openstax.org/books/university-physics-volume-1/pages/6-2-friction>. Kind: textbook. The text states that the values are approximate, to one or two digits.
31. `etb-friction` — The Engineering ToolBox, *Friction and Friction Coefficients for various Materials*. <https://www.engineeringtoolbox.com/friction-coefficients-d_778.html>. Kind: last-resort. Gives no primary reference for its rows.
32. `zou-2024` — Z. Zou et al., *Experimental study of the restitution coefficient of spherical particles, J. Phys.: Conf. Ser. 2730 (2024) 012008, Table 1*. <https://iopscience.iop.org/article/10.1088/1742-6596/2730/1/012008/pdf>. Kind: peer-reviewed.
33. `segur-oberstar-1951` — J. B. Segur, H. E. Oberstar, *Viscosity of Glycerol and Its Aqueous Solutions, Ind. Eng. Chem. 43 (1951) 2117-2120, doi:10.1021/ie50501a040, Table V*. <https://faculty.ksu.edu.sa/sites/default/files/viscocity_of_glycerol.pdf>. Kind: peer-reviewed. A scanned copy of the journal article.
34. `volk-kahler-2018` — A. Volk, C. J. Kähler (supplementary material), tabulating N. Bosart and A. O. Snoddy (1928), *Density model for aqueous glycerol solutions, Exp. Fluids 59 (2018) 75, doi:10.1007/s00348-018-2527-y, Electronic Supplementary Material 2, Table 1 "Measured densities of aqueous glycerol solutions (Bosart and Snoddy 1928)"*. <https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00348-018-2527-y/MediaObjects/348_2018_2527_MOESM2_ESM.pdf>. Kind: peer-reviewed.
35. `brock-2008` — J. Brock, M. R. Nogueira, C. Zakrzevski, F. de Castilhos Corazza, M. L. Corazza, J. V. de Oliveira, *Determinação experimental da viscosidade e condutividade térmica de óleos vegetais (Experimental measurements of viscosity and thermal conductivity of vegetable oils), Ciênc. Tecnol. Aliment. 28 (2008) 564-570, Tables 2 and 3*. <https://www.redalyc.org/pdf/3959/395940088010.pdf>. Kind: peer-reviewed.
36. `rodriguez-navarro-2022` — H. Rodriguez-Navarro, D. Vivanco-Pezantes, *Influence of temperature on the rheological behavior of industrialized honey, Agroindustrial Science 12 (2022) 7-14, doi:10.17268/agroind.sci.2022.01.01*. <https://revistas.unitru.edu.pe/index.php/agroindscience/article/download/4359/6544?inline=1>. Kind: peer-reviewed.

## Unverified values

| Value | Number | Reason |
|---|---|---|
| honey density | 1420 | The opened source measured the specific gravity but its table was not readable; 1420 kg/m3 is a typical figure recalled, not read. A honey with 22% water, as in the viscosity source, is lighter (about 1.38 to 1.40). |
| aluminium-6061-t6/aluminium-6061-t6 (dry) restitution | 0.5 | No source was opened for this value. It is the scene editor's earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it. |
| concrete-c30-37/concrete-c30-37 (dry) staticFriction | 0.6 | The editor's earlier table cited ACI 318 shear-friction coefficients; that code was not opened here. |
| concrete-c30-37/concrete-c30-37 (dry) restitution | 0.2 | No source was opened for this value. It is the scene editor's earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it. |
| natural-rubber/natural-rubber (dry) restitution | 0.8 | No source was opened for this value. It is the scene editor's earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it. |
| ice/ice (dry) restitution | 0.3 | No source was opened for this value. It is the scene editor's earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it. |
| pine-loblolly/pine-loblolly (dry) restitution | 0.45 | No source was opened for this value. It is the scene editor's earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it. |
