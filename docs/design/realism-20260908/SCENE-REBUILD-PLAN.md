# Scene rebuild plan

Status: proposed authoring targets, not completed scene work.  
Registry source: `src/workbench/registry.ts`, 35 labs at `dfedd9f`.  
The selected mockup determines the common UI and rendering language. Every row below still requires authored geometry, runtime inspection and visual comparison.

## Shared scene requirements

- Use the actual solver coordinates, fixed anchors, body transforms, surface topology and deformation streams.
- Support witnesses must meet solver pins. Machine punches must meet the actual driven specimen. Rendered decorative parts must not imply new contacts or constraints.
- Use believable thicknesses, clearances, bases, fasteners, washers, seams, hinges, cable end fittings and material scale. These are visual details unless backed by the solver.
- Put every environment on the correct ground datum. Use physically legible daylight or workshop lighting, controlled reflections and contact shadows.
- Use distinct settings for materials, membranes, rigging, water and structural scenes.
- Keep natural metal, cloth, concrete, glass, rubber and water appearance separate from numerical response overlays.
- Avoid star fields in indoor labs, emissive structural members, rainbow cloth, floating fixtures, oversized surface texture, or a single generic floor for every experiment.
- Preserve the reduced-model boundary: no inferred engineering certification or unimplemented physical units.
- Keep the 800 underlying scene recipe IDs stable; shared rendering changes must not regress their creation or physics. The 35 curated labs below are the authored realism targets.

## Lab-specific authoring matrix

| Lab ID | Realistic environment and visible apparatus | Numerical alignment / verification |
|---|---|---|
| titan-bend-dent | Sunlit materials hall; four-column press, machined punch, supported plate, bed slots, guide bushings and mounting bolts | Punch follows the actuator; plate follows lattice nodes; support interfaces align |
| metal-press-brake-v-bend | Press-brake bay; upper blade, V die, back gauge, bent sheet and grounded frame | Die and punch witnesses follow existing support and actuation geometry |
| metal-springback-fold | Bench-scale forming rig; thin sheet, clamp jaws, ruled base and unloading witness | Preserve release and springback response; show pre/post state only when recorded |
| metal-thick-plate-dent | Heavy press fixture with thick plate, broad supports and visible plate edge | Model thickness and loading contact agree with the authored lattice envelope |
| metal-notch-tear | Tensile test frame; opposed grips, notched coupon, reinforced grip shoulders | The visible notch and tearing surface use actual failed topology |
| crash-rail-axial-fold | Crash laboratory; corrugated rail specimen, rigid platen, carriage guides and fixed reaction wall | End restraint and shortening follow the reduced material rig; no physical crash-rating claim |
| notched-low-cycle-fatigue | Repeated-load coupon station; grips, exposed notch and actuation axis | Cycling state, visible damage and break count remain linked |
| ballistic-glass | Protected glazing test bay; layered pane, edge frame, clamping blocks and projectile path | Fracture triangles and projectile proxy follow existing state; no ballistic certification |
| curtain-wall-wind | Facade test chamber; mullions, transoms, gaskets and supported glazing panels | Panel edges and restraints align with numerical boundaries; wind is an authored load proxy |
| rc-punching-shear | Concrete structures hall; slab, column/punch, support plinths and concrete edge detail | Failure openings follow lattice breaks; reinforcement is not implied to be solved unless present |
| blast-wall-spall | Barrier research range; supported concrete wall, back-face capture space and grounded fixtures | Spall follows existing fracture state; no blast-wave fluid solver implied |
| elastomer-recovery | Universal-test bench; compliant coupon between realistic clamp jaws | Color and rounded appearance do not imply a constitutive rubber model |
| composite-coupon | Composite test bench; laminated coupon, directional surface weave and grip blocks | Fiber direction matches anisotropic lattice axes |
| tempest-flag | Wind-test bay; flagpole, halyard fittings, mast foot and neutral tunnel setting | Pinned edge aligns to mast; cloth responds to current procedural wind |
| canopy-load-capture | Skylit structural hall; ivory membrane, four posts, corner clevises, cable tensioners and bolted floor plates | All four fixtures end at actual cloth pins; canopy corners use the solver's coordinates |
| cargo-net-catch | Handling test bay; rope-like net edges, supported corners and visible payload witness | Net surface, sag, impacts and anchored corners track current particles |
| progressive-fabric-tear | Fabric test frame; clamped edge, reinforced border and torn topology | Do not cover real holes with a cosmetic membrane |
| membrane-shock | Full perimeter test frame; gasket/clamp strips, accessible center load area | Every perimeter support corresponds to actual pinned particles |
| sky-crane-cable | High-bay lifting rig; overhead beam, anchor eye, continuous cable and load block | Cable and payload follow the PBD chain; no decorative cable substitutes |
| suspension-cable-resonance | Daylit bridge study; tower saddles, continuous catenaries, hangers, deck and coherent abutments | Cable path is numerical; deck and environment must disclose any presentation-only attachment |
| heavy-pendulum | Impact hall; gantry, pivot, suspended impact mass and target plinth | Pivot, cable length and payload transform agree across the entire swing |
| four-point-mooring | Marine test basin; floating platform proxy, four fairleads, lines and shore anchors | Lines connect to actual endpoints; preserve proxy buoyancy boundary |
| rope-net-resonance | Cable-net research frame; interconnected strands, grounded support perimeter | Render every chain junction from shared numerical node coordinates |
| tsunami-flume | Long hydraulic research flume; concrete walls, side gauges, service walkway and grounded basin | Water heightfield stays within numerical basin; no volumetric-fluid claim |
| dam-breach-front | Hydraulic test channel; gate witness, upstream pool, downstream apron and debris proxies | Gate is presentation where unsupported; front is the actual shallow-water field |
| boat-wake | Towing tank; hull proxy, shore rails and reflective water with restrained foam | Wake and buoyancy remain labeled proxy coupling |
| vortex-chamber | Circular-in-plan research chamber around the numerical basin; clear walls and service deck | Surface depression and horizontal velocity are real heightfield state; no 3D vortex core implied |
| leviathan-impact | Large impact basin; realistic surrounding walkways, lifting/impact witness and reflective water | Projectile/float proxy displaces the heightfield; spray is presentation only |
| aegis-tower-breach | Structural research range; stacked floor slabs, columns, grounded foundation and impact lane | Structural blocks follow native rigid bodies; no continuous stress field implied |
| truss-span-overload | Civil structures test yard; deck, legible triangulation, piers, bearings and loading witness | Preserve block/contact proxy boundaries; decorative truss details do not create new joints |
| citadel-siege | Masonry failure study; believable blocks, parapet, foundation and impact ground | Every failing block follows native rigid state; no unsupported mortar mechanics |
| titan-hauler-crash | Vehicle proving hall; coherent chassis/body presentation over collision proxies, barriers and marked lane | Keep visuals within body envelopes; no unsupported tire or suspension physics |
| high-bay-rack | Warehouse test bay; perforated uprights, beams, pallets, cartons and forklift-clear aisle | Rack loads and collapsing parts track native body transforms |
| mega-atrium | Daylit atrium; floor plates, columns, parapets, curtain-wall context and ground level | Modeled architectural members track the existing rigid contacts |
| apex-proving-ground | Coherent materials laboratory with distinct metal, concrete and glazing stations | Preserve independent rig state and explicitly avoid implying cross-rig contact coupling |

## Engineering interfaces to preserve

| Existing module | Responsibility in rebuild |
|---|---|
| `src/workbench/registry.ts` | Stable 35-lab IDs, solver labels, capabilities and parameter bounds |
| `src/soft/simulations.ts` | Cloth pins/topology, rope chains, heightfield water and render streams |
| `src/soft/material-simulation.ts` | Material specimen deformation, fracture topology and fixtures |
| `src/soft/combined-material-simulation.ts` | Independent material rigs and shared rendering |
| `src/physics/wasm.ts` and native bridge | Rigid transform / shape / body state; preserve source physics |
| `src/webgpu/renderer.ts` | Material shading, geometry, light, shadow and environment presentation |
| `src/main.ts` | Scene loading, camera framing, run lifecycle, recording and UI integration |
| `src/ui/physics-structural.*` | Primary experiment screen and controls |
| `src/ui/physics-correlation.*` | Recorded reference/candidate comparison and empty states |
| `src/ui/physics-field-modal.*` | Touch/field interaction and derived analysis |
| `src/ui/material-lab-desktop.*`, `material-lab-mobile.*` | Alternative laboratory layouts and responsive behavior |

## Acceptance matrix

Each lab needs explicit states: planned → authored → runtime checked → compared with reference → accepted. No row starts as accepted.

- Natural-material view and response-overlay view both render correctly.
- At least two orbit angles show valid anchors, load paths and ground contacts.
- Run, pause, reset and applicable live parameters change actual simulation state.
- Material/texturing changes do not alter solver hashes for identical numerical runs.
- Output values retain correct solver-native, derived, imported or presentation provenance.
- No camera or geometry clipping, unknown startup errors or leaked GPU resources.
- Desktop 1440×1024, tablet 1024×768 and phone 390×844 keep main actions accessible.
- Source checks, targeted regression tests and production build pass.
- Browser screenshots are compared alongside the chosen mockup at corresponding state and viewport.
- Performance is measured on the actual target browser and hardware; no unmeasured FPS guarantee.

