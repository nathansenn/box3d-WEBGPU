# Cable-stayed bridge in SI units

`lab.html?si=bridge` (or "Cable-stayed bridge (SI)" under "SI scenes" at the end of the Lab's catalog) shows a cable-stayed bridge that runs on the validated solvers in real units:

- deck and towers: Euler–Bernoulli beam elements ([`FRAME_MECHANICS.md`](FRAME_MECHANICS.md));
- stays: tension-only compliant cables ([`COMPLIANT_CABLE.md`](COMPLIANT_CABLE.md), proximal backend);
- vehicle: one rigid body in the Box3D world;
- all of it coupled both ways by `StructureCoupling` ([`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md)).

The model is `src/engine/si-bridge.ts`, the scene `src/lab/si-bridge-scene.ts`, the panel `src/lab/si-bridge-panel.ts`, the tests `tests/physics/si-bridge.test.mjs` (in the pull-request gate), and 30 of its checks are published in [`VALIDATION.md`](VALIDATION.md#cable-stayed-bridge-si-scene).

**What it is:** linear beams, axial stays, loads attached at nodes. **What it is not:** there is no contact between wheels and deck, no buckling, yielding or geometric stiffness of the members, no cable sag, and no aerodynamics beyond a static wind load. The utilisation ratios are linear-elastic indicators, not a design check. The section properties are hand estimates for a plausible steel footbridge that can carry a service vehicle; this is not a designed or surveyed bridge, and nothing is calibrated against measurements.

The Studio's suspension-bridge study (`index.html?studio=bridge`) runs on a second model of the same family, the suspension footbridge of `src/engine/si-suspension.ts`: [the second part of this document](#suspension-footbridge-the-studio-bridge) describes it.

## The structure

| | |
|---|---|
| Spans | side 30 m, main 60 m, side 30 m; the deck is one line of twenty 6 m beam elements at y = 0 from x = 0 to x = 120 m |
| Towers | two columns at x = 30 m and x = 90 m, from 8 m below the deck axis to 15 m above it, six elements each, clamped at the base, in the plane of the deck |
| Stays | 16, one plane, semi-fan: four on each side of each tower, to deck nodes every 6 m (none at the tower, none at the abutments), from anchorages at 15, 13.5, 12 and 10.5 m (the outermost stay highest) |
| Deck supports | both abutments hold the deck vertically, laterally, in torsion and along the bridge; the deck passes the towers without touching them (a floating deck) |
| Gravity | 9.81 m/s² (the rigid world keeps it in float32, 9.8100004, and the structure uses that same value) |

Holding the deck along the bridge at both abutments keeps the structure mirror-symmetric, which the symmetry test needs; a real bridge would usually be held at one point. With the floating deck there are three 12 m gaps between supports of the deck: one at each tower and one at midspan.

### Hand numbers

**Deck** (`SI_BRIDGE_DECK`): a steel box girder 4.0 m wide and 1.2 m deep in 16 mm plate, with 20 % added for longitudinal stiffeners, carrying a 5 m wide surface.

| Property | Calculation | Value |
|---|---|---|
| Area | 2 (4.0 + 1.2) × 0.016 × 1.2 | 0.20 m² |
| Vertical bending, I_z | flanges 2 (4.0 × 0.016) 0.6² = 0.0461; webs 2 × 0.016 × 1.2³ / 12 = 0.0046; × 1.2 | 0.060 m⁴ |
| Section modulus | I_z / 0.6 m | 0.10 m³ |
| Lateral bending, I_y | webs 2 (1.2 × 0.016) 2.0² = 0.154; flanges 2 × 0.016 × 4³ / 12 = 0.171; × 1.2, rounded down | 0.38 m⁴ |
| Torsion (Bredt, one cell) | 4 (4.0 × 1.2)² / (2 (4.0 + 1.2) / 0.016) | 0.14 m⁴ |
| Mass | steel 7850 × 0.20 = 1570; 70 mm asphalt on 5 m, 2300 × 0.07 × 5 = 805; parapets and services 225 | 2600 kg/m (25.5 kN/m) |
| E, G, yield | steel S355 | 210 GPa, 81 GPa, 355 MPa |

The frame element takes a density; it is given mass per metre over area (13,000 kg/m³), so that an element weighs what the member and everything fixed to it weigh.

**Tower** (`SI_BRIDGE_TOWER`): a steel box 1.5 m square in 30 mm plate. A = 4 × 1.5 × 0.03 = 0.18 m²; I = 2 (1.5 × 0.03) 0.75² + 2 × 0.03 × 1.5³ / 12 = 0.0675 m⁴; section modulus 0.09 m³; Bredt J = 4 (1.5²)² / (4 × 1.5 / 0.03) = 0.10 m⁴; 7850 × 0.18 = 1413 kg/m; S355.

**Stay** (`SI_BRIDGE_STAY`): six 15.7 mm seven-wire strands of 150 mm². A = 900 mm², E = 195 GPa (E A = 175.5 MN), breaking stress 1860 MPa (breaking load 1674 kN), 7850 × 9·10⁻⁴ × 1.15 for the sheath = 8.1 kg/m. One cable segment per stay: its weight is lumped half on each end and it does not sag.

**Weights:** deck 3060.7 kN, towers 637.6 kN, stays 25.3 kN: 3723.7 kN.

**Vehicle:** 20 t by default (a two-axle truck), 10 m/s. The Lab's sliders go to 60 t and 40 m/s.

### Pretension: the zero-displacement method

The stays are cut so that the deck is level under dead load.

1. Replace each stay by an unknown force along its drawn chord. The frame is then linear: `u = u₀ + Σ Tᵢ cᵢ`, with `u₀` the deflection under the dead load and `cᵢ` the deflection under a unit pull of stay `i` (17 linear solves).
2. Ask for zero vertical deflection at every deck anchorage: 16 equations for 16 forces.
3. Cut each stay to the unstressed length that gives its force at its deformed chord, `L₀ = l / (1 + T / (E A))`.
4. The towers lean by centimetres, which turns the chords, so the true (nonlinear) equilibrium then has the anchorages level only to about 0.2 mm. Repeat steps 2 and 3 on what is left, with the same influence matrix, until it is below 10⁻⁷ m (a quasi-Newton iteration of a few passes).

The deck then stands as a continuous beam on level supports at the anchorages.

Dead-load state (statics; the bridge is symmetric, so one half is listed):

| Stay (deck x) | 6 m | 12 m | 18 m | 24 m | 36 m | 42 m | 48 m | 54 m |
|---|---|---|---|---|---|---|---|---|
| Unstressed length, m | 28.275 | 22.487 | 16.972 | 12.082 | 12.061 | 16.937 | 22.452 | 28.195 |
| Tension, kN | 323.8 | 269.0 | 151.8 | 308.7 | 304.9 | 167.5 | 197.4 | 501.5 |
| Stress / breaking | 19 % | 16 % | 9 % | 18 % | 18 % | 10 % | 12 % | 30 % |

- Largest deflection at an anchorage 4·10⁻⁸ m; largest anywhere on the deck 0.185 mm, on the three 12 m gaps.
- Each tower base: 101.1 kN along the bridge, 1801.0 kN vertical, 2392 kN m. The main span pulls harder than the side span (the stays next to the midspan gap carry 502 kN), so each tower top leans 30 mm towards midspan. Tower stress 10 % of yield.
- Each abutment: 60.9 kN vertical and 416.9 kN along the bridge. With a 20 t vehicle in the main span the vertical reaction falls to 15.9 kN at the least; a heavier vehicle makes it negative. The supports are linear and hold either way: uplift is not modelled as a lift-off.
- Deck stress 1.4 % of yield under dead load, 5.3 % at most with the 20 t vehicle. The deck is far from yield; the stays are the more heavily used members here.

Under the 20 t vehicle (statics): the midspan deflection peaks at 20.3 mm with the vehicle at midspan (span / 2950), and the most affected stay gains 84 kN.

## The vehicle

The vehicle is **one rigid body pinned to the two deck nodes it stands between**. What that means:

- The two pins share its weight by the lever rule and pass its vertical inertia to the deck. Nothing touches the deck surface: there are no wheels, no suspension and no contact.
- It is moved by re-attachment. Every step the body is set down `speed × dt` further along the chord of its element, turned to lie along the chord, and pinned again where the two nodes are; at a node it moves on to the next element. It has no velocity along the deck, so there are no convective (centripetal) terms: what the deck feels is a moving weight whose mass follows the deck's own vertical motion.
- The body is a 2.0 × 0.8 × 1.6 m block whose centre of mass lies on the deck axis, and it is pinned at that height. Two pins in a line cannot steady a body whose centre is above them (it would roll over sideways as soon as wind moved the deck), and the frame has nodes on the centreline only. The Lab does not draw this block: it draws an 8 × 3 × 2.5 m box riding on the deck at the block's position.
- The lever rule is not the exact load for a cubic beam element, which also needs nodal moments. The difference is second order in the element length and zero when the vehicle stands on a node. On the default 6 m elements it is at most 1.9 % of the peak midspan deflection (0.39 mm of 20.3 mm) and 2.3 % of the peak stay-tension change (2.0 kN of 84 kN), measured against statics with the consistent load. `elementsPerPanel: 2` (3 m elements) brings both under 0.7 % and costs between three and four times the step time.
- The body is rigid between its pins, so it is also a strut along the element it stands on and stiffens the deck axially there. In the hand case below this raises the stay tension by 2·10⁻⁴ to 8·10⁻⁴; on the bridge it is inside the lever-rule error.
- While it stands on an abutment node its weight goes straight into the support.

## Other loads and events

- **Wind:** a uniform lateral load in N/m on the deck, as consistent nodal loads (forces and end moments), constant in time. It is fixed when the model is built; changing it in the Lab restarts the run from the static state with that wind.
- **Stay failure:** the deck anchorage of a stay lets go (`failStay(index)`, or `failure: {stay, time}`). The stay stays on the tower and swings from it as a one-segment pendulum; its weight is still carried. Most of its strain energy (20 kJ for the 502 kN stay) is lost at once in the cable solver's implicit step.
- **Damping:** mass-proportional, 0.1 /s on the frame and on the stays by default. The model also damps itself: the stays' implicit-Euler step takes about 1 % of critical out of the first vertical mode at 120 Hz (measured 0.98 %).

## Outputs

`SiBridge.out` is updated in place after every step:

| Output | Meaning |
|---|---|
| `deckDeflection`, `deckLateral`, `midspanDeflection` | displacement of each deck node from its drawn position, m |
| `stayTension`, `stayUtilisation`, `maxStayTension` | tension from the current stretch between the two frame nodes a stay holds, `E A (l − L₀) / L₀`, and that over the breaking load |
| `reactions`, `towerBase`, `totalReaction` | elastic support reactions `K u − f` at every fixed degree of freedom (forces and moments); the six of each tower base; the sum |
| `deckMoment`, `deckAxial`, `deckUtilisation` | bending moment at each deck node (sagging positive) and axial force of each deck element, from member end actions `Kₑ uₑ` minus the element's own distributed load; the largest `|M| / Z + |N| / A` over yield |
| `towerUtilisation` | the same for the towers |
| `energy()` | kinetic + elastic + gravitational energy of frame, stays and vehicle, J |

Two of these need a word. The reactions are elastic: they leave out the inertia of the supported nodes, so they ripple while the structure moves (within 0.1 % of the weight during the slow crossing) and are exact at rest; the frame solver's own reactions, which include inertia, are available from `bridge.frame.inspect()` and the tests read both. The energy takes the stays' strain energy from their stretch between frame nodes, not from the cable solver's ledger: the cable solver forms its figure at the node positions it predicted for the end of the step, which differ from where the frame went, and with stays this stiff that is hundreds of joules of bookkeeping noise while the structure moves.

`SiBridgeStatics` in the same file is an independent static solver of the same discrete structure: dense Newton iteration, each stay a tension-only spring along its current chord. It provides the pretension, the start state, influence lines, the damaged re-solve, the modes (inverse iteration on `K_t x = ω² M x`) and the Rayleigh estimate. It shares the element matrices and the stay law with the time-stepped model and nothing else.

## Validation

All numbers are measured by `tests/physics/si-bridge.test.mjs` (13 tests) on the default bridge at 120 Hz with 4 rigid substeps unless a row says otherwise. Readings of the time-stepped model are means over half a second after a damped settle.

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| Dead load, statics: vertical reactions | weight 3723.7 kN | error 2·10⁻¹⁶ | 10⁻⁹: a Newton solve ends at round-off |
| … horizontal reactions | sum 0 (each tower 101 kN, each abutment 417 kN) | 3·10⁻¹⁰ N | 10⁻⁹ of the weight |
| … deck level | 0 at every anchorage | 4.2·10⁻⁸ m; 0.185 mm between anchorages | 10⁻⁶ m (the iteration stops at 10⁻⁷); 0.5 mm |
| Dead load + 20 t vehicle at 37.3 m, time-stepped: vertical reactions | deck + stays + towers + vehicle, 3919.89 kN | error 7.7·10⁻⁹ (elastic), 3.4·10⁻⁸ (frame solver) | 10⁻⁶: what is left of the motion after 2 s at 8 /s |
| … horizontal reactions | 0 | −5.4·10⁻⁹ of the weight | 10⁻⁶ |
| … against statics | same tensions and deflections | 9.6·10⁻⁵ in tension, 9.6·10⁻⁶ m | 3·10⁻⁴ and 5·10⁻⁵ m: the coupling's bias at 120 Hz (below) |
| Hand case: stay tension, any mesh | flexibility method with the true chord, 89,108.09 N | 89,108.22 N (1.5·10⁻⁶) | 5·10⁻⁵ |
| … midspan deflection | 19.17214 mm | 19.17223 mm (4.5·10⁻⁶) | 5·10⁻⁵ |
| … against the linearised hand solution | 89,054.63 N, 19.17657 mm | +6.0·10⁻⁴, −2.3·10⁻⁴ | 10⁻³: the sag turns and lengthens the stay at second order, 7.5·10⁻⁴ of its stretch |
| … mesh | the same answer with 2, 4, 8 and 16 elements | equal to 6·10⁻⁹ | 2·10⁻⁶: cubic elements are exact at the nodes for these loads |
| … reactions (the start is undeformed) | the weight | within 1.1·10⁻⁵ (frame solver), 3.6·10⁻⁵ (elastic) | 5·10⁻⁵ and 10⁻⁴: the blow of that start leaves the stiffest modes rippling |
| Hand case with a vehicle between nodes | error ∝ h² ξ (1 − ξ) | −3.00 %, −1.63 %, −0.60 %, −0.002 % in deflection for 2, 4, 8, 16 elements | 0.2 % × h² ξ (1 − ξ) / m² + 10⁻⁴ (10⁻³ for tension: the strut effect) |
| … statics with the consistent load | the hand solution at every mesh | 10⁻¹⁴ | 10⁻⁶ |
| Symmetry, statics | mirror-image tensions and deflections | 4·10⁻¹³; 1.5·10⁻¹⁵ m | 10⁻⁹; 10⁻¹² m |
| Symmetry, time-stepped, dead load | the same | 8·10⁻¹¹; 5·10⁻¹³ m | 10⁻⁶; 10⁻⁷ m |
| Mirrored vehicles (37.3 m and 82.7 m), time-stepped | mirrored results | 2.7·10⁻⁸; 3.1·10⁻⁹ m | 10⁻⁶; 10⁻⁷ m: residual motion and the solvers' 10⁻⁴ N stopping tolerances |
| Influence line, midspan deflection (20 t at 3 m/s, 6 /s, 60 Hz, 82 positions) | static solve at each position, peak 20.31 mm | worst error 0.119 mm, 0.58 % of the peak | 2 % of the peak: the lag of a damped structure behind the load (0.14 m of travel) and the ripple of the motion |
| Influence line, tension of stay 5 | changes by −3.5 to +84.1 kN | worst error 0.296 kN, 0.35 % | 2 % |
| First vertical mode, time-stepped | eigenvalue solve, 1.7999 Hz | 1.7973 Hz (−0.14 %) | 0.5 %: `(ω dt)² / 12` of the midpoint rule and as much from the stays |
| Stay failure: the other stays | static re-solve without the stay | worst error 7.8·10⁻⁵ | 5·10⁻⁴ |
| … midspan | −14.561 mm | −14.566 mm | 0.05 mm |
| … reactions | the same weight | error 3.4·10⁻⁵ | 10⁻⁴: the hanging stay still swings |
| … energy | never grows | largest rise between steps 0.26 J of 262 kJ | 10⁻⁵ of the total: solver tolerances |
| Wind 2 kN/m: lateral deflection against statics | 64.207 mm | 64.207 mm (−5.6·10⁻⁶) | 10⁻⁴ |
| … against a bare beam | `5 q L⁴ / (384 E I_y)` = 67.67 mm | −5.1 % | below it and within 10 %: the stays hold the deck back like pendulums |
| … lateral reactions | the whole load, 240 kN | error 1.4·10⁻⁸ | 10⁻⁶ |
| Start (a bridge with 8 stays, vehicle parked) | at rest from the first step | node speeds 1.1·10⁻⁴ m/s, tensions within 3.3·10⁻⁵, pins within 2.3·10⁻⁴ | 10⁻³ m/s, 10⁻⁴, 10⁻³ |
| Determinism | bit-identical repeat | identical: 5024 bytes of frame, stay and vehicle state, and the world hash | exact |
| Node and browser | the same numbers | midspan −0.017533173326478586 m at step 624 in both | not asserted (one machine, software WebGPU) |

### The hand case

A 30 m simply supported deck (pin at x = 0, roller at x = 30 m) propped at midspan by one stay from the top of a 10 m column clamped at the pin; the stay's unstressed length is its drawn length. One redundant, the stay force `T` (flexibility method), with `w` the deck's weight per metre, `W_e` half the stay's weight, `θ` the stay's slope:

```
deck at midspan    δ   = 5 w L⁴ / (384 E I) + (W_e − T sin θ) L³ / (48 E I)
deck shortening    u_d = T cos θ (L/2) / (E A)_deck
column top, sway   Δ_t = T cos θ H³ / (3 E I)_column
column top, down   δ_t = (T sin θ + W_e) H / (E A)_column + w_t H² / (2 (E A)_column)
stay stretch       e   = T L_s / (E A)_stay = sin θ (δ − δ_t) − cos θ (u_d + Δ_t)
```

That is linear in `T`: 89,054.63 N and 19.17657 mm, where the deck alone would sag 21.38 mm. The model starts undeformed and settles under heavy damping, so it finds its own equilibrium; it agrees to 6·10⁻⁴. Taking the stay's chord between the displaced end points and iterating the same formulas gives 89,108.09 N and 19.17214 mm, and the model agrees to 1.5·10⁻⁶ and 4.5·10⁻⁶.

The mesh study adds a 20 t vehicle at x = 7 L / 16, a node only of the 16-element mesh:

| Elements | h² ξ (1 − ξ) | Deflection error | Tension error | Statics with the consistent load |
|---|---|---|---|---|
| 2 | 24.6 m² | −3.00 % | −2.93 % | 10⁻¹⁴ |
| 4 | 10.5 m² | −1.63 % | −1.55 % | 10⁻¹⁴ |
| 8 | 3.5 m² | −0.60 % | −0.56 % | 10⁻¹⁴ |
| 16 | 0 | −0.002 % | +0.023 % | 10⁻¹⁴ |

The deflection error per m² is 0.12 to 0.17 %. The tension at 16 elements is not at zero because of the strut effect described above (the time-stepped tension is 7.9, 7.8, 4.5 and 2.3 ·10⁻⁴ above the lever-rule statics).

### Frequencies

| Mode | Eigenvalue solve | By hand | Difference |
|---|---|---|---|
| 1: lateral sway of the deck | 0.6191 Hz | `(π/2) √(E I_y / (m L⁴))` over 120 m = 0.6043 Hz | +2.4 % (the stays add pendulum stiffness) |
| 2: first vertical | 1.7999 Hz | Rayleigh, dead-load shape: 2.1182 Hz | +17.7 % |
| | | one Stodola refinement: 1.8559 Hz | +3.1 % |
| | | two: 1.8266 Hz | +1.5 % |
| 3: lateral | 2.4176 Hz | | |
| 4: second vertical | 3.1627 Hz | | |
| 5, 6: towers | 3.286 Hz | | |

The hand estimate lumps the deck's mass at its nodes (15.7 t each) and uses as shape the deck's deflection under its own weight applied to the standing structure (0 at the abutments, 31 mm at the towers, 80 mm at midspan): `f = √(g Σ m δ / Σ m δ²) / 2π`. It is an upper bound, and a coarse one here, because the weight puts the side spans down with the main span where the mode lifts them near the abutments. Stodola's refinement (load with the inertia forces `m δ` of the previous shape and repeat) brings it within 1.5 %; what is left is the lumping and the tower mass the hand method leaves out. The time-stepped model, released from 200 kN at midspan, gives 1.7973 Hz.

The lowest mode is lateral because nothing holds the deck sideways at the towers. A design would add bearings there.

### Dynamic amplification

The largest midspan deflection of a crossing over the largest of the static influence line (20.33 mm, with the vehicle at midspan), with `a = v / (2 f₁ L)`, `L` the main span: half the fundamental period over the time on the span.

| Speed | a | Amplification | Envelope `1 / (1 − a)` |
|---|---|---|---|
| 20 m/s (72 km/h) | 0.093 | 1.016 | 1.102 |
| 40 m/s (144 km/h) | 0.185 | 1.014 | 1.227 |

The envelope is the classical one for a force crossing a simple span. Here the deck is continuous over three spans, so the load comes on smoothly, and the first mode is damped about 1 %: the factor stays close to 1. The test asserts that it is between 0.98 and the envelope; it does not compare it with a moving-load solution.

### Stay failure

Stay 8 of 16 (502 kN) lets go at 0.5 s. Tensions after over before:

```
0.76 0.75 0.64 0.92 | 1.39 1.79 1.69 lost | 1.04 1.11 1.13 1.06 | 1.03 1.07 1.06 1.06
```

The three main-span stays left on that tower take 39 to 79 % more (the neighbour goes from 197 to 333 kN, with a dynamic peak of 370 kN). Its back stays lose 8 to 36 %, because the tower top, pulled 30 mm towards the main span before, comes back to 14 mm. The other tower's stays gain 3 to 13 %. Midspan drops to 14.6 mm. Energy: 261.8 kJ before, 246.1 kJ just after, 221.7 kJ at 10 s.

### The coupling's steady-state bias

At rest the time-stepped model does not sit exactly on its statics. With the vehicle parked on the default bridge:

| Step rate | 60 Hz | 120 Hz | 240 Hz | 480 Hz |
|---|---|---|---|---|
| Worst stay tension error | 2.9·10⁻⁴ | 9.6·10⁻⁵ | 3.1·10⁻⁵ | 9.8·10⁻⁶ |
| Worst deck deflection error | 0.027 mm | 0.0096 mm | 0.0031 mm | 0.0010 mm |

It falls by a factor of three per halving of the step. The same magnitude appears in the kit's cable-stayed span (1.1·10⁻⁴ at 240 Hz). The cause was not isolated; it appears where both ends of a stay sit on the same frame, and it sets the floor of every "against statics" tolerance above.

## Cost

Measured in Node 22 on a shared 4-core machine, default bridge (32 beam elements, 16 stays, 20 t vehicle at 10 m/s), median of three runs of 20 s of model time:

| Step rate | CPU per step | Real-time factor |
|---|---|---|
| 120 Hz (the Lab's) | 1.95 ms | 4.3 |
| 240 Hz | 1.64 ms | 2.5 |

In headless Chromium with software WebGPU on the same machine the page itself reported 2.0 to 4.5 ms per step (real-time factor 1.9 to 4.2) while it also rendered on the CPU. The build takes about 0.3 s.

Two changes to `StructureCoupling` were needed; both are in [`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md):

- One attachment's question about its frame formed the response of every attached node (n² per attachment). It now forms only its own six rows: the same sums, bit-identical results, 4.05 → 2.70 ms per step on this bridge at the time of the change.
- `prime()` tells the coupling what each attachment already carries at the start. Without it the first step set the frame ringing (node speeds of 0.125 m/s, 3 kN of tension error and a 5 kJ jump on a bridge with 8 stays).

## In the Lab

Twenty deck boxes and twelve tower boxes are kinematic bodies set on the chords of the beam elements each frame; the stays go through the renderer's existing rope stream (`uploadRopeGrid`: two nodes and one segment per stay, expanded to box instances by the compute pass that draws the Lab's ropes); ground, banks, water and footings are static boxes. None of them collides with anything.

- **Deflection drawn ×1, ×10, ×50, ×100:** a node is drawn at rest + factor × displacement. Only the drawing changes; the panel's numbers are never exaggerated. A failed stay keeps its true shape below its drawn tower end.
- **Panel:** time, midspan deflection (mm), largest stay tension (kN) and its share of the breaking load, the tension of stay 8, the base moment of the tower at x = 30 m (kN m), deck stress over yield, vehicle position (m), total energy (kJ), reactions over weight, and the measured step cost; sliders for vehicle mass, speed and wind (each restarts the run); "Fail stay" with a choice of stay; pause and reset; and a 30 s history of midspan deflection and stay tension.
- `box3dLab.bridgeState()` in the console returns the same numbers.

Checked in headless Chromium with software WebGPU (not on a real GPU): the bridge, its shadows on the water, the crossing vehicle, the ×50 drawing and a dangling failed stay are drawn, and the panel shows the model's numbers digit for digit when paused.

## Limits

- No contact: nothing rests on the deck surface, and bodies dropped in the Lab fall through the bridge.
- Linear members: no buckling of deck or towers under the stays' thrust, no P-delta, no yielding. Stays are axial, tension-only, without sag; a slack stay simply carries nothing.
- The vehicle model as described: lever rule, no wheels or suspension, no convective terms, a strut along its element.
- One vehicle. The coupling allows 96 constraint equations, so more are possible; the model does not offer them.
- Supports are bilateral: an abutment in uplift holds the deck down.
- Wind is a static load fixed at build time.
- The deck is held along the bridge at both abutments and not at all at the towers.
- Most references are the model's own statics. The independent ones are the hand case, the lateral frequency, the Rayleigh estimates and the wind beam.
- No checkpoint: the coupling's own state is not saved.

# Suspension footbridge (the Studio bridge)

`index.html?studio=bridge` (the Engineering Studio's "Suspension bridge") runs on `src/engine/si-suspension.ts`, the Studio's own geometry as an SI model on the validated solvers:

- deck grillage and portal towers: Euler–Bernoulli frame elements ([`FRAME_MECHANICS.md`](FRAME_MECHANICS.md)), factorised directly (`solver: 'direct'`);
- main cables, backstays and hangers: one tension-only cable network with exact geometry ([`COMPLIANT_CABLE.md`](COMPLIANT_CABLE.md)), solved by the cable runtime's Newton backend;
- the two are solved together each step by `StructureCoupling`'s joint step ([`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md));
- an optional service vehicle is a rigid body in the Box3D world, pinned to the deck centreline as in the cable-stayed scene.

The model is `src/engine/si-suspension.ts`, the Studio adapter `src/studio/si-bridge-study.ts`, the tests `tests/physics/si-suspension.test.mjs` (16 tests, in the pull-request gate), and 24 checks are published in [`VALIDATION.md`](VALIDATION.md) under "Suspension footbridge".

**What it is:** linear steel beams; axial, tension-only steel strands whose geometry is exact, so the main cables' sag and gravity stiffness are modelled; loads at nodes; a static wind. **What it is not:** no contact, no buckling, yielding or geometric stiffness of the beams, no slip of the cables over the saddles, no aerodynamics beyond a static lateral load, no stiffness of the timber boards (they are mass only). The utilisations are linear-elastic indicators against stated strengths, not a design check. The sections below are table values and hand estimates for a plausible footbridge of the Studio's look; it is not a designed or surveyed bridge and nothing is calibrated against measurements.

## The structure

The geometry is the Studio's (`src/studio/physics.ts` `STUDIES.bridge`, `world.ts`, `reference-scene.ts`), in metres, in the Studio's own coordinates (x along the bridge, y up, z across).

| | |
|---|---|
| Span | 42 m between the tower axes (x = ±21 m), 36 panels of 7/6 m |
| Deck | two edge girders at z = ±1.9 m and y = 4.8 m, a crossbeam at every panel point (with a centreline node for a vehicle), X plan bracing in every panel; both girder ends held in x, y and z on the piers |
| Towers | at each end a portal: two columns from the pier top (y = 3.73 m, clamped) to the saddle (y = 14.0 m), a portal beam at 13.5 m and two knee braces from 11.85 m |
| Main cables | two, in the planes z = ±1.9 m, 36 straight segments each between the saddles, drawn sag 6.8 m (lowest point 7.2 m), fixed to the saddles (no slip) |
| Backstays | from each saddle to a ground anchorage at x = ±31 m, z = ±4.3 m, y = 6.30 m (the drawn anchorages stand between 6.25 and 6.36 m; one height keeps the structure symmetric) |
| Hangers | 70, vertical, at every interior panel point of both cables (stations 1 to 35) |
| Gravity | 9.81 m/s² as the rigid world keeps it (float32, 9.8100004) |

### Sections

Steel values come from the material library (`structural-steel-s355`: E = 210 GPa, G = 81 GPa, ρ = 7850 kg/m³, f_y = 355 MPa); the timber density from `pine-loblolly` (571.2 kg/m³ at 12 % moisture). Rolled sections use their EN 10365 table values.

| Member | Section | Values |
|---|---|---|
| Edge girder | HEA 340 | A = 133.5 cm², I = 27,690 cm⁴ (vertical), 7,436 cm⁴ (lateral), I_t = 127.2 cm⁴, W = 1,678 cm³; 104.8 kg/m steel + 227.9 kg/m carried = 332.7 kg/m |
| Crossbeam | IPE 200 | A = 28.48 cm², I = 1,943 cm⁴, W = 194.3 cm³; 22.4 kg/m |
| Plan bracing | L 60 × 6 | A = 6.91 cm², 5.4 kg/m (an axial member in practice) |
| Column | HEB 400 | A = 197.8 cm², I = 57,680 cm⁴ along the bridge, 10,820 cm⁴ across; 155.3 kg/m |
| Portal beam, knees | HEB 300, HEB 200 | strong axis in the portal plane |
| Main cable | 50 mm full locked coil strand | metallic area 0.87 × π 25² = 1,708 mm²; E = 160 GPa (EN 1993-1-11 range for locked coil); minimum breaking force 0.9 × 1,570 MPa × 1,708 mm² = 2,413 kN; 13.7 kg/m |
| Hanger | 20 mm spiral strand | 0.78 × π 10² = 245 mm²; E = 150 GPa; minimum breaking force 0.86 × 1,770 MPa × 245 mm² = 373 kN; 2.0 kg/m |
| Saddle | lumped mass | 500 kg at each column top (saddle casting, clamp, tower head fittings) |

The deck surface carried by the girders (half each), per metre of bridge: timber boards 3.8 × 0.16 × 571.2 = 347.3 kg; two fascia boards 2 × 0.26 × 0.14 × 571.2 = 41.6 kg; two railings, each a 76.1 × 3.6 tube (6.4 kg/m), five 24 mm bars (3.55 kg/m each) and a 48.3 × 4 post (4.4 kg/m × 1.15 m) every 7/6 m, 57.0 kg; fixings 10 kg: 455.8 kg/m. With the girders, crossbeams and bracing the deck weighs 775 kg/m; with the cables and hangers the span carries 821.6 kg/m. The whole structure weighs 441.1 kN.

### Form-finding

The cables are cut so that, under dead load, the deck is level at every hanger, the main cables pass through the drawn midspan height and the hangers hang plumb:

1. The deck's hanger forces: the frame alone with each girder held vertically at every hanger, a continuous grillage on level supports. Its support reactions are the hanger tensions (half of each hanger's weight acts on the deck).
2. Each main cable is the funicular polygon of those forces, half of each hanger's weight and its own weight between the saddles: `y_j = chord − M_j / H`, with `M_j` the simple-beam moment of the point loads and `H` chosen so that the midspan point is at 14.0 − 6.8 = 7.2 m. Each backstay's force balances `H` along the bridge, so that the towers stand plumb.
3. Every segment is cut to the unstressed length that gives its force at its target chord, `L₀ = l / (1 + T / EA)`.
4. The towers shorten by 0.48 mm and the backstays, which run outwards to z = ±4.3 m, pull the saddles 0.25 mm sideways: the structure is solved, the saddle targets are moved to where the saddles went (down and sideways; along the bridge they stay plumb) and steps 2 and 3 are repeated. Four passes take the deck level to 5.8·10⁻⁸ m and the midspan height to 6·10⁻⁸ m; about 0.3 s.

### Hand numbers under dead load

| Quantity | Model | Hand | |
|---|---|---|---|
| Horizontal cable tension `H`, each cable | 129.79 kN | parabola `w L² / 8 f` with `w` = cable load / L = 3.93 kN/m: 127.43 kN | +1.9 %: the end hangers carry 13 % more (the end panels of a continuous deck), so the load is not uniform |
| Tension at the towers (end segment) | 153.81 kN | `√(H² + V²)`, V = half the cable load: 153.81 kN; parabola `H √(1 + 16 (f/L)²)`: 151.82 kN | 2·10⁻⁸; +1.3 % |
| Midspan hanger | 4.4598 kN | one panel of deck: (girder + half crossbeam + half bracing) g s + half its own weight = 4.4598 kN | 2·10⁻⁸ |
| End hanger | 5.06 kN | | 1.13 × the midspan hanger |
| Backstay | 166.7 kN | | 6.9 % of its breaking force; the main cables are the most used strands |

Utilisations under dead load: main cable 6.9 %, hangers 1.4 % at most, girders below 1 %.

### Deflection theory

A point load against the linearised deflection theory of a suspension bridge with a stiffening deck pinned at both ends (Timoshenko 1930; Bleich): `EI v'''' − H v'' = p − (8f/L²) h`, with the extra horizontal force `h` from the cable's compatibility `h (L_e / EA + 2 / k_s) = (8f/L²) ∫ v dx` per cable, `L_e = L (1 + 8 (f/L)²)` and `k_s` the longitudinal stiffness of a saddle (backstay axial along the bridge, 12.89 MN/m, plus the column as a cantilever, 0.34 MN/m). Fourier sine series, 600 terms; EI of both girders, H of both cables.

| 20 kN (half on each girder) | Model | Theory | Difference |
|---|---|---|---|
| at midspan: deflection | 10.973 mm | 10.733 mm | +2.2 % |
| at midspan: extra cable force (both) | 23.446 kN | 23.463 kN | −0.07 % |
| at the quarter point: deflection | 18.181 mm | 18.625 mm | −2.4 % |
| at the quarter point: extra cable force | 16.696 kN | 16.760 kN | −0.38 % |
| down and up at the quarter points: deflection | 29.225 mm | 30.210 mm | −3.3 % (h = 0 to first order; the model's 25 N) |

The theory spreads inextensible hangers into a membrane; the model has 35 elastic hangers per cable on a grillage and portal towers.

### Frequencies

| Mode | Eigenvalue solve | Closed form | |
|---|---|---|---|
| 1: first antisymmetric vertical | 1.4148 Hz | tensioned beam, `f = √((EI k⁴ + H k²) / m) / 2π`, `k = 2π / L`, m = 821.6 kg/m: 1.4054 Hz | +0.67 % |
| 2: first torsion | 1.4996 Hz | | |
| 3 to 6: cable sway and torsion | 1.62 to 2.20 Hz | | |
| 7: first symmetric vertical | 2.2502 Hz | | |

The antisymmetric mode needs no change of cable length, which is why the string-and-beam closed form holds for it; the symmetric mode stretches the cables and the backstays and is stiffer. The lowest mode, 1.41 Hz, lies in the band of walking pace (1.6 to 2.4 Hz is the usual first band, 1.25 to 2.3 Hz in some guides): a real bridge of this kind would need a pedestrian comfort check, which this model does not make.

## Time stepping

`SiSuspensionBridge` steps at 120 Hz. Each step the coupling solves the whole cable network together with the frame: instead of a proxy mass per attached node, the cable solver sees the frame's response on all 74 attached nodes at once (saddles and hanger feet), `S = (h² G / 2)⁻¹` with `G` the translational blocks of the frame's interface operator, and holds them towards where the frame would put them without the cables, `x* = x + h (v + Δv_free / 2)`. That is consistent with the frame's midpoint rule, so the cables end the step exactly where the frame puts their ends. The cable step is backward Euler, solved by Newton's method with a direct factorisation that is kept from step to step (three to four iterations). The frame's midpoint operator is factorised once. On the default bridge a step takes 5 to 9 ms in Node on a shared 4-core machine; building the model about 1 s.

Two coupling schemes were tried first and rejected, with the numbers that ruled them out:

- **The coupling's proxy per attached node with the proximal cable solver.** The proximal solver's Gauss–Seidel projections need about 16 substeps and 30 to 40 iterations per substep on these stiff steel chains (k h²/m ≈ 1000 at 120 Hz), 34 ms a step. Worse, the 35 hanger feet of one network are coupled through the deck with last step's impulses, and a saddle, where a main cable and a backstay meet at an angle, gets one isotropic proxy mass for a column that is stiff vertically and soft along the bridge: the time-stepped model then sat 3 to 11 % off its statics at rest.
- **The joint step with `S = (h² G)⁻¹`, `x* = x + h (v + Δv_free)`** (an Euler step for the frame's ends) agreed with the statics at rest but grew unstable without damping (a released antisymmetric oscillation doubled in about a second), because the frame's midpoint rule moves an attached node only half as far within the step.

### Loads and events

- **Crowd:** a uniform pressure on whole panels, half the width on each girder, as consistent nodal loads (`setCrowd`, any time). The Studio puts it on the east half (panels 18 to 36) and builds it up at 0.5 kN/m² per second.
- **Wind:** a uniform lateral load on the deck in N/m, half on each girder (`setWind`, any time).
- **Hanger failure:** `failHanger(segment)` (or `failures: [{segment, time}]`). The hanger's link is released in the cable solver: from that step on it carries nothing, and its two halves of weight stay where they were. A hanger also fails by itself when its tension exceeds its minimum breaking force (`ruptureAt`, default 1). It is not drawn swinging.
- **Service vehicle:** `vehicle: {mass, speed, start}`, a 2.0 × 1.2 × 1.0 m rigid body pinned to the two centreline nodes it stands between. It needs a Box3D world and adds 37 attached nodes to the interface (about three times the step cost), so the Studio does not use it.

### Validation

All numbers are measured by `tests/physics/si-suspension.test.mjs` on the default bridge at 120 Hz; time-stepped readings are means over half a second after a damped settle.

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| Form-finding: deck level at the hangers | 0 | 5.8·10⁻⁸ m | 10⁻⁶ m |
| … midspan cable height | 7.2 m | 7.19999994 m | 10⁻⁶ m |
| … hangers plumb | 0 | 0.23 mm | 0.5 mm: the backstays pull the saddles 0.25 mm sideways and the main cable follows |
| Dead load, statics: vertical reactions | weight 441.06 kN | error 3·10⁻¹⁴ | 10⁻⁹ |
| Main cable `H` against the parabola | 127.43 kN | 129.79 kN (+1.9 %) | 3 %: non-uniform load (above) |
| Tower tension against `√(H² + V²)` | 153.81 kN | 2·10⁻⁸ | 10⁻⁶ |
| … against the parabola | 151.82 kN | +1.3 % | 3 % |
| Midspan hanger against one panel of deck | 4.4598 kN | 2·10⁻⁸ | 10⁻⁵ |
| Point load: deflection (midspan, quarter, antisymmetric) | deflection theory | +2.2 %, −2.4 %, −3.3 % | 5 %: membrane of inextensible hangers in the theory |
| … extra cable force (midspan, quarter) | deflection theory | −0.07 %, −0.38 % | 1 % |
| First antisymmetric vertical mode | tensioned beam, 1.4054 Hz | 1.4148 Hz (+0.67 %) | 2 % |
| … time-stepped, released, undamped | eigenvalue solve, 1.4148 Hz | 1.4143 Hz (−0.03 %) | 0.2 %: `(ω h)²/12` of the midpoint rule and the cables' implicit Euler |
| Crowd 3 kN/m² on the west half, time-stepped against statics | 0 | tension 3·10⁻¹¹, deflection 10⁻¹³ m | 10⁻⁶, 10⁻⁷ m: the solvers' stopping tolerances |
| … reactions | weight + crowd | error 4·10⁻¹³ | 10⁻⁶ |
| Symmetry: crowds on the west and east thirds | mirror images | statics 5·10⁻¹², time-stepped 8·10⁻¹³ | 10⁻⁹, 10⁻⁶ |
| Hanger failure (hanger 12 of the upstream cable), 3 s later | static re-solve without it | 7.9·10⁻⁷; deck 2·10⁻⁹ m | 10⁻⁴, 10⁻⁶ m |
| … its neighbours | | +49.6 % each (statics +49.6 %) | between +40 and +60 % |
| … reactions | weight | error 1.6·10⁻⁷ | 10⁻⁵ |
| Wind 1.5 kN/m: midspan lateral deflection | statics, 4.7707 mm | equal to 10⁻¹² | 10⁻⁶ |
| … lateral reactions | 63 kN | error 10⁻¹³ | 10⁻⁶ |
| Parked 2 t service vehicle (Box3D rigid body) | statics with its weight by the lever rule | 5·10⁻⁹ | 10⁻⁶ |
| Determinism: crowd changed mid-run, wind, a failing hanger | bit-identical | identical, 20,472 bytes | exact |
| Newton cable backend against the proximal one (hanging chain with a tip mass) | the same backward-Euler step | 10⁻⁸ m after 60 ticks | 10⁻⁷ m |
| Frame direct solver against conjugate gradients | the same equations | equal to 10⁻⁹ | 10⁻⁹ relative |

## In the Studio

`src/studio/si-bridge-study.ts` adapts the model to the Studio's runtime contract (fixed 120 Hz steps, the worker protocol, snapshots of the drawn particles): each snapshot's deck particles are the girder nodes, its cable particles the main cable points and saddles, and a hanger's link is marked broken when that hanger has failed. The Three.js scene reads those positions every frame (`world.ts` is unchanged apart from what reads the snapshot: the same towers, timber deck, river and ecology). The SI readings travel in `snapshot.si`.

- **Controls:** crowd 0 to 5 kN/m² on the east half (the EN 1991-2 crowd for this span, 2 + 120 / (L + 30), is 3.7 kN/m²), hangers cut on the upstream cable 0 to 6 (from midspan outwards), wind 0 to 2 kN/m. The prepared load cases are in these units.
- **Readouts:** deck drop in mm, hangers failed of 70, largest hanger and main cable tensions in kN; in Analyze → Inspect the crowd, wind, midspan deflection, hanger and main cable tension against breaking, girder stress in MPa against yield, tower utilisation and saddle movement, and a hanger map by span; Experiments scans the crowd, the hangers lost or the wind, in mm and kN.
- **Footer:** "SI model · validated solvers" with a link to this document, in place of "Comparative model · not calibrated" (the other studies keep theirs).
- **Default load case:** *Hanger loss under crowd*: 3.7 kN/m² on the east half, wind 0.3 kN/m and four hangers of the upstream cable cut at midspan (stations 16 to 19). Its four failed hangers are those cuts, not ruptures: the remaining hangers stay below 7 % of their breaking force, and the same crowd and wind with no cuts fail none (`tests/studio/bridge-review.test.mjs`). The readouts say how many failures are cuts ("of 70 · 4 cut", and "4 cut, 0 ruptured" in Inspect).
- **Saved runs:** Export holds the Studio checkpoint with the model's exact state (`SiSuspensionBridge.saveState()` and the adapter's cut and failure counters, in the checkpoint's `si` field; the checkpoint is 11.9 MB, gzip-packed to 4.8 MB in the file). **Resume saved run** continues it bit for bit (`tests/studio/bridge-review.test.mjs`: the next 36 ticks, their recording samples and events, and the next checkpoint are identical to the uninterrupted run's).
- **Failed hangers** are drawn hanging from their clamp on the main cable, at their unstressed length in the model (`statics.restLengths`), in orange; the model itself releases the hanger's link and keeps no geometry of the slack strand, so the drawing does not swing.
- **Not supported:** the service vehicle (it lives in the Box3D rigid world, which the Studio's worker does not load; with it a step costs 5.3 times as much, see [Real time in the Studio](#real-time-in-the-studio)).

Under a 3 kN/m² crowd on the east half the deck drops about 130 mm; cutting the three midspan hangers of one cable raises the largest hanger tension from 7 to 19.5 kN, 5 % of its breaking force. The bridge does not progress to a collapse under these loads: its hangers are close together and strong, and that is what the model says.

### Real time in the Studio

The model runs free in the Studio's worker toward wall time ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#scheduling-the-solver-runs-free-of-the-renderer)); the page draws the newest state. A step (1/120 s) costs 3.3 to 4.2 ms in Node 22 on this shared 4-core machine (load average 10 to 20), 2.0 to 2.5 times real time. With the suspension model's service vehicle (`vehicle: {mass: 2000, speed: 3, loop: true}`, a rigid body in a Box3D world) a step costs 17.5 ms, 5.3 times as much: 0.47 times real time in Node. The free run would carry it at that rate (the footer would say how far behind wall time it is), but the Studio's worker does not load the Box3D world and the bridge's checkpoint does not hold one, so the Studio does not offer the vehicle yet. Measured with `SiSuspensionBridge` and the Studio's damping, 5 s of stepping after 30 warm-up steps, one run each.

The earlier authored model (`FailureSimulation('bridge')`, position-based, normalised units) is still in `src/studio/physics.ts` for the tests that freeze its behaviour; the Studio no longer uses it for the bridge.

## Limits of the suspension model

- No contact; pedestrians are a pressure on whole panels.
- Linear beams: no buckling of the columns, girders or bracing (the bracing is linear and carries compression), no yielding.
- The cables are fixed to the saddles; there is no slip, no bending of strands and no clamp slip.
- Wind is static; no vortex shedding, flutter, buffeting or pedestrian lock-in.
- A failed hanger stops carrying load at once; the Studio draws it hanging straight down from its clamp (no slack-strand dynamics); a main cable does not fail.
- The timber boards are mass only; crossbeam eccentricity and bearing flexibility are left out.
- Exact checkpoints: `SiSuspensionBridge.saveState()` / `restoreState()` hold the coupling, the frame, every cable (the Newton backend's kept factor and released links included), the loads, the failures and the outputs; a bridge resumed from one, fresh or rewound in place, steps on bit for bit (`tests/physics/si-suspension.test.mjs`). About 8.9 MB per checkpoint (the frame's interface operators are dense). Not with the service vehicle, which lives in the rigid world. The Studio's checkpoints carry them (see In the Studio).
- Most time-stepped references are the model's own statics; the independent ones are the parabola, the hanger share, the deflection theory and the tensioned-beam frequency.
