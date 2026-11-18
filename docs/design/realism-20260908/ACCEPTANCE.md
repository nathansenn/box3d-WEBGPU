# Three failure studios — acceptance contract

User selection: all three generated designs, with full failures simulated (2026-09-08).

The selected studios are canopy / Precision, plate press / Atelier, suspension bridge / Observatory. Each receives its own real 3D scene and UI treatment. All three treatments can also be selected independently. Existing labs remain reachable through the workbench link.

## Required behavior

- Canopy: four pinned corners and attached tensioners; gravity, distributed pressure/wind, strain-driven tearing with removed constraints and triangles, loose fabric continuing under gravity.
- Plate: four supported edges, moving circular punch with contact, permanent plastic extension, strain-driven fracture, loose fragments and collision with the bed.
- Bridge: tower supports, two sagging main cables, deck and hangers; load-driven cable/hanger/deck failure, broken connections removed from the solver, unsupported segments falling.
- Real-time orbit, fit/second view, run/pause/reset, load and strength controls, unload, material/strain mode, slow motion, recorded history replay and JSON evidence export.
- Response plots and failure events originate in solver state. A ramp-to-failure is a load program, not a timer that breaks meshes.
- Persistent deformation survives unloading; reset restores all topology. Controls remain available on mobile.

## Evidence

Pure shared solver tests: support positions, topology, finite state, reversible elastic response, irreversible plastic/failure response, failed vs service load, deterministic reset. TypeScript and production build. Browser: all three intact and failed, second angle, mobile, console errors, main controls. Fresh captures and source hashes in evidence. Compare source and runtime together.

## Accuracy boundary

The physics is a reduced, dimensionless particle/constraint model for comparative study. Mesh scale, load coefficients, yield/fracture thresholds and camera are authored assumptions. There is no calibrated stress in MPa, certified capacity, full continuum fracture mechanics, fluid-structure interaction, or scene-wide destruction of the fixed test machinery/ground. The built solver must not claim those. Visible fixtures are grounded and support their simulated attachment coordinates.

Technical passing status does not establish human acceptance of mockup fidelity.
