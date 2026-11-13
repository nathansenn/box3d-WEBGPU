# Shallow water on terrain

`src/engine/shallow-water.ts`, published by the kit as `box3d-webgpu-kit/shallow-water`: the two-dimensional
Saint-Venant equations on a bed of any shape, wet or dry, in SI units and float64, with Manning friction, rain,
Green-Ampt infiltration, inflow, outflow and stage boundaries, and two-way coupling to the rigid world. It is a
subsystem of the one stepping loop (`shallowWaterSubsystem`), has exact checkpoints, and is a section of the scene
format (`shallowWater`, [SCENE_FORMAT.md](SCENE_FORMAT.md)). The Studio's river, rain and surface rigs run on it
([STUDIO_FLOW_LABS.md](STUDIO_FLOW_LABS.md)).

## Equations

    h_t + (hu)_x + (hv)_z = R - I
    (hu)_t + (hu^2 + g h^2/2)_x + (huv)_z = -g h b_x - g n^2 u |u| / h^(1/3) - 3 nu u / h
    (hv)_t + (huv)_x + (hv^2 + g h^2/2)_z = -g h b_z - g n^2 v |u| / h^(1/3) - 3 nu v / h

h depth (m), (u, v) depth-averaged velocity along world x and z (m/s), b bed elevation (world y), n Manning's
coefficient (s/m^(1/3)), nu the liquid's kinematic viscosity for the laminar film term (m^2/s, default 0), R rain
(m/s), I infiltration (m/s).

## Scheme

- **Hydrostatic reconstruction** (Audusse, Bouchut, Bristeau, Klein and Perthame, SIAM J. Sci. Comput. 25 (2004)
  2050). The formulas were read in the restatement by Chen and Noelle, *A new hydrostatic reconstruction scheme
  motivated by the wet-dry front*, IGPM report 440 (RWTH Aachen), eqs. 2.5-2.8
  (<https://www.igpm.rwth-aachen.de/Download/reports/pdf/IGPM440.pdf>); the 2004 paper itself sat behind a bot check
  and was not opened. At each face b* = max(b_L, b_R), h*_L,R = max(0, eta_L,R - b*); the flux is computed from the
  starred states and each side gets the pressure correction g/2 (h^2 - h*^2).
- **Second order**: MUSCL reconstruction of h, eta = h + b, u and v with the minmod limiter; the bed at a face is
  eta - h of the reconstructed values; the centred bed term g h (dh - deta)/dx per cell keeps the scheme
  well-balanced (Audusse et al. 2004, sec. 3, written from that form; not read in the paper). Heun's method (SSP-RK2)
  in time. `order: 1` gives the first-order scheme.
- **Flux**: HLL for depth and normal momentum (wave speeds min/max of u -+ sqrt(g h) of the two sides; u -+ 2 sqrt(g h)
  for a side next to a dry one), the transverse momentum carried upwind of the mass flux.
- **Sources**, split from the transport: rain (with the momentum of an optional horizontal rain velocity), Green-Ampt
  infiltration and bed friction. Friction is backward Euler on |q|, q (1 + a + b |q|) = q*, with b = dt g n^2 / h^(7/3)
  (Manning) and a = 3 nu dt / h^2 (laminar film), applied for half a substep before the transport and half after
  (Strang). It never reverses a flow and is stable at any step.
- **Infiltration** per cell: the exact ponded Green-Ampt increment over the substep, F2 - F1 - S ln((F2 + S)/(F1 + S))
  = K dt with S = psi eta (Rawls et al. 1983, eq. 2 between F1 and F2), by safeguarded Newton, capped by the water on
  the cell.
- **Time step**: each `step()` is split into equal substeps of at most cfl / (max|s_x|/dx + max|s_z|/dz), the wave
  speeds read from the faces (cfl 0.45 by default). A step that would need more than `maxSubsteps` (100,000) is
  refused with UNSTABLE_TIME_STEP. Depths that come out negative by round-off are set to zero and the volume booked in
  `ledger.clipped` (zero in every validated case).
- **Sides**: `'wall'` (mirror), `'open'` (transmissive; at second order the bed is continued with its last slope, so a
  uniform flow leaves unchanged), `{type: 'inflow', discharge, depth?, span?}` (the exact discharge across the face;
  the depth outside from the outgoing Riemann invariant, or imposed for a supercritical inflow; `span` limits it to
  part of the side), `{type: 'stage', level}` (subcritical: the outgoing invariant; transmissive while the flow
  leaves supercritically). Solid cells are walls.
- **Determinism**: no randomness, a fixed loop order; repeat runs and resumed runs are bit-identical.

## Coupling to rigid bodies

`ShallowWaterCoupling` (boxes and spheres), after [WATER_COUPLING.md](WATER_COUPLING.md): the body reads the water plane
one cell outside its footprint (level and slope), takes the exact volume of its shape below that plane and its
centroid, and receives the buoyancy rho g V along the plane's normal at that centroid plus a drag
C_d A rho |w| w / 2 on its velocity w relative to the depth-averaged water, scaled by the submerged fraction (limited
so that drag cannot reverse w in one step). The reaction of the horizontal force goes into the water's momentum over
the footprint (weighted by depth); the change of the displaced volume per cell is added to (or taken from) the water,
so a floating body raises the lake (`ledger.displaced`). What a body displaces when it is first seen is taken as part of the starting water (as in water-coupling.ts), so a scene or a save that holds the water with its bodies in it starts as it was. Forces are explicit (one step), evaluated half a step ahead
as in water-coupling.ts.

## Validation

All in `packages/box3d-kit/test/v20-shallow-water.test.mjs` (kit gate) and 26 cases of the validation registry
(domain `shallow-water`, [VALIDATION.md](VALIDATION.md)). The benchmark set-ups are those of SWASHES, Delestre et al.,
*SWASHES: a compilation of shallow water analytic solutions for hydraulic and environmental studies*, Int. J. Numer.
Meth. Fluids 72 (2013), arXiv:1110.0288 (opened), which also gives the formulas of each case.

| Case | Source (opened) | Measured | Tolerance |
|---|---|---|---|
| Lake at rest over a bumpy bed, immersed (level 0.25 m) | SWASHES 3.1.1 (the principle; a 2D bed of our own) | max \|u\| 1.8e-14 m/s, \|eta - eta0\| 1.7e-16 m after 1600 substeps | 1e-12 m/s, 1e-14 m |
| Same, partly emerged (489 of 2400 cells dry) | SWASHES 3.1.2 | 9.1e-15 m/s, 5.6e-17 m | same |
| Ritter's dry dam break, h_l 5 mm, t = 6 s | SWASHES 4.1.2 | L1 2.5e-3 (400 cells), 5.1e-3 (200): order 1.03; no negative depth; wet front (1% of h_l) 0.12 m behind | 4e-3; order > 0.8; 6 cells |
| Stoker's wet dam break, h_r 1 mm | SWASHES 4.1.1 | L1 2.3e-3 (400), 4.4e-3 (200); shock 6.2624 m vs 6.2598 m | 4e-3; one cell (0.025 m) |
| Thacker's oscillating paraboloid, one period | SWASHES 4.2.2 | L1 2.0e-2 (100^2), 5.4e-2 (50^2): order 1.45 | 0.025; order > 1 |
| Subcritical flow over a bump, q 4.42 m^2/s | SWASHES 3.1.3 (Goutal and Maurel 1997) | L1 6.2e-5 (200 cells), order 1.97 | 1e-4; order 2 +- 0.2 |
| Transcritical flow over a bump, q 1.53 m^2/s | SWASHES 3.1.4 | L1 4.2e-4, Froude 1.89 after the crest | 1e-3 |
| Transcritical with a hydraulic jump, q 0.18 m^2/s | SWASHES 3.1.5 | L1 1.7e-3; jump at 11.625 m vs 11.666 m (Rankine-Hugoniot) | 3e-3; one cell (0.125 m) |
| Manning normal depth, S 0.001, n 0.03, q 0.5 m^2/s | the Manning formula | -2.5e-4 (h 0.639064 m vs 0.639226 m); q exact to 1e-6 | 5e-4 |
| Manning normal depth, S 0.01 (Froude 0.88) | the Manning formula | -1.3e-3 | 2e-3 |
| Rain on an impervious plane, 20 m, 5%, n 0.02, 50 mm/h | kinematic wave, WEPP technical documentation ch. 4 (USDA-ARS 1995), eqs. 4.4.1-4.4.10 (<https://ars.usda.gov/ARSUserFiles/50201000/WEPP/chap4.pdf>) | rms error of the outflow hydrograph 3.8e-2 (400 cells), 7.2e-2 (200); equilibrium outflow = r L to 7e-6 | 0.05; 1e-4 |
| Green-Ampt under 20 mm/h on a loam, 2 h | Rawls, Brakensiek and Miller 1983, J. Hydraul. Eng. 109(1), eqs. 1-2, Table 2 (opened) | max \|F - F_exact\| 4.2e-8 m at dt 10 s, 1.9e-10 m at dt 1 s; ponding at 997 s vs 995.7 s | 1e-6 m; 2 dt |
| Volume budget: inflow, open side, rain, infiltration, friction, wetting | conservation | 1.9e-14 of the volume | 1e-12 |
| Repeat and resume from `saveState` | determinism | bit-identical | exact |
| Box (500 kg/m^3) floating in a lake | Archimedes | displaced 0.0118 vs 0.012 m^3; draft 0.0991 vs 0.1 m; lake rise 7.37e-4 vs 7.50e-4 m (the closed lake still sloshes after the drop; the mean over the 6th second wanders by about 2%) | 3% |
| Sphere in a 0.5 m/s current | drag, third law | 0.450 m/s after 10 s; impulse to the body + impulse to the water = 0 exactly | carried to > 80%; exact |
| Through a Simulation; Simulation checkpoint of water + floating box | `simulation.ts` | bit-identical | exact |

The closed forms are exported (`ritterDamBreak`, `stokerDamBreak`, `thackerDepth`, `bumpSteadyDepth`,
`bumpShockPosition`, `manningNormalDepth`, `kinematicWaveOutflow`, `greenAmptCumulative`, `greenAmptPondingTime`,
`laminarFilmDepth`). The ponding relation F_p = K S / (r - K) follows from setting eq. 1 of Rawls et al. equal to the
rain rate; the kinematic-wave rising limb q = alpha (r t)^m follows from eqs. 4.4.6 and 4.4.2 of the WEPP chapter. The
Bernoulli and Rankine-Hugoniot relations of the bump cases are SWASHES eqs. 8 and 10. The laminar film depth
q = g S h^3 / (3 nu) is written from memory (the Nusselt film) and is not a validation reference here.

## Cost

`packages/box3d-kit/scripts/bench-shallow-water.mjs` (a dam break over Thacker's bowl with friction), one thread, on
this 4-core machine shared with four other jobs (load average 12 when measured, so the figures are low by perhaps a
factor of two to three):

| Cells | Order | Substeps per 1/60 s | Cell-substeps per second | Cells in real time |
|---|---|---|---|---|
| 4,096 | 2 | 2 | 2.2 million | 18,000 |
| 16,384 | 2 | 3 | 2.7 million | 15,000 |
| 65,536 | 2 | 5.9 | 2.2 million | 6,300 |
| 16,384 | 1 | 3 | 5.2 million | 29,000 |

The second-order scheme evaluates the residual twice per substep. The work is in branchy per-face arithmetic
(reconstruction, the hydrostatic reconstruction, HLL) over typed arrays; a WASM SIMD port was not attempted: the
branches on wet and dry faces do not vectorise without masking, and the JavaScript is within a small factor of a
scalar native loop. The Lab's two examples (3,072 and 5,760 cells) run at 4 and 4 times real time in node; the
Studio's 84 x 28 grid runs its presets at 0.2 to 1.7 s of CPU per simulated second under that load.

## Limits

- Shallow water only: hydrostatic pressure, depth-averaged velocity, no vertical acceleration (no dispersion, no
  breaking waves, no flow over a vertical step), no turbulence model beyond bed friction, no Coriolis force, no wind
  stress on the water.
- Steep thin films: where the bed rises by more than the depth across one cell the hydrostatic reconstruction loses
  accuracy (Chen and Noelle 2015 describe this); the rain-on-slope hydrograph converges at first order (7% to 4% from
  200 to 400 cells). Wet-dry fronts are first order.
- Friction is split from the transport: the normal depth carries an O(dt) error (-2.5e-4 to -1.3e-3 above).
- Manning n is a tabulated range per surface (Chow 1959); Green-Ampt is the one-layer model with a uniform starting
  moisture, no redistribution after rain, no crusting or macropores; the texture-class parameters scatter widely
  (Rawls et al. give a factor of about three on psi for one standard deviation). No case is compared with a measured
  flood, flume or plot.
- Coupling: boxes and spheres only; the body exerts no pressure on the water (its volume is a source), so a moving
  body makes no bow wave of its own beyond the volume it pushes; drag is a coefficient, not hydrodynamics. Only a
  resting and a drifting body are checked.
- The volume source of a body that leaves the water is limited by the water there (the shortfall is in
  `ledger.displaced`).
