# Metal press lab enhancement

Owner: current Codex task. Request: expand metals, thicknesses, attachments, strike speeds and applied pressure, with a substantial scene pass.

## Implementation contract
- 16 authored metal profiles, 16 sheet thickness presets from 0.5 to 20 mm, 10 contact shapes, 20 complete experiments.
- Independent model pressure 0–100%, ram speed 2–250 mm/s, depth 5–140 mm, hold 0–10 s, tool size and rotation.
- Pressure limits ram drive/contact compliance. Sheet resistance depends on thickness, material stiffness, mass, yield and rupture. Coefficients are comparative, not laboratory alloy data or calibrated hydraulic force.
- Geometry shares tool parameters with contact; visible sheet thickness is 1 scene unit = 100 mm, including underside and cut walls. No exaggerated gauge.
- Changing a setup resets the run. Export, URL, reset and replay retain the selected press settings. Yield and failure remain irreversible within a run.
- Canopy and bridge baseline trajectories were frozen before editing physics and must remain byte-identical.
- Machine framing includes the full press; desktop controls and phone interaction must work. Verify actual run, fracture, unload and replay.

## Resource budget
Disk at start: 46 GiB free. No package installs or downloaded assets. Use existing textures and procedural tooling. Build budget 170 MiB; remove the owned temporary build after validation. Retain screenshots, test outputs and source receipts in this directory.
