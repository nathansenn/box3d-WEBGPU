# Material laboratory expansion

User request: expand the new engineering studio to liquids, glass, concrete and other useful demos; remove the original workspace; generate mockups first and build from them.

Five generated references were inspected before implementation. They establish a warm ivory application shell, left tool rail, right inspector, bottom playback strip, large grounded apparatus, pale concrete hall and tall steel-framed windows. The apparatus and camera are reconstructed; the generated numerical readings and calibration claims are not treated as specifications.

## Scope and ownership

- New independent modules: src/studio/material-labs, plus shared study navigation.
- Entry routing and index.html retire the original workbench interface. Existing canopy, press and bridge studies remain available in one study picker.
- Five material-specific scenes, eight materials and eight experiments per new scene; model controls, pause/reset, deterministic replay, reference viewer and export.
- Independent reduced models: conservative shallow-water flow, rigid glass fragments, bonded concrete fragments, viscoelastic compression and granular contacts. Authored coefficients are comparative and not material certification data.
- Avoid edits to shared engine/solver files being changed in the concurrent engine task. Runtime acceptance uses a stable build captured after the additions.

## Reference interpretation

- Liquid: elevated three-quarter view, long low glass flume, upstream gate, two downstream posts, pump and hoses. Water sits inside the tank and wraps around the posts.
- Glass: near-frontal perspective, upright clamped rectangular pane, orange crossbar, pendulum, tray. Radial fractures open through actual fragment geometry.
- Concrete: tall four-column frame, centered continuously supported cube, top platen, hydraulic cabinet. Visible aggregate and displaced spalls after bond failure.
- Rubber: two columns and orange crown, circular platens, central teal cylinder, side sample rack. Volume-aware bulging, hold and recovery.
- Granular: long clear-sided tray, raised left gate, downstream cylindrical obstacle. Individual grains remain contained and settle with friction.

Scale, hidden dimensions and material coefficients are inferred/assumed. Reference framing, support contacts, containment, geometry, runtime and phone layout are checked separately.

## Resource budget

17 GiB free at start. No installs or large external assets. Reuse current textures and dependencies; five generated images, source and isolated compiled preview budget below 80 MiB. Retain requested mockups and validation evidence; clean only owned disposable builds after their server exits.
