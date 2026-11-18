# Liquid lab V2 review

The expanded study has five apparatus layouts: a closed release flume, metered pipe bench, winding river table, overhead rainfall table and surface-runoff bed. Each has eight presets. Twenty liquid profiles span freely flowing water through oils, honey, molasses, paint, resin and slurry surrogates. Eight viscosity shortcuts complement the continuous 0.1–12× control. Eight substrate profiles alter drag and infiltration.

The pipe bench provides straight, elbow, twin and converging outlets, 20–200 mm bore, 1–20 m hydraulic length and 0–80 L/s demand with an authored 4 m pump-head budget. Rain offers steady, burst and passing-shower programs, 0–300 mm/h intensity and −6 to +6 m/s drift. Grade is 0–12%; drainage is 0–100%. Thin-film depth is distinct from viscosity. A supply cutoff continues the remaining drainage and extends the observation window when applied near completion.

The built-in image generator produced the reference in mockup.png from PROMPT.md. The live scene follows its stainless bench, connected supply circuit, interchangeable outlets, transparent rails, collection sump, measuring scale, elevated inspection camera, teal controls and orange run action. River terrain uses the project's existing generated soil and granite textures, scattered pebbles and grass; rainfall has a joined manifold and visible feed. Runtime imagery is a procedural real-time reconstruction, with lower geometric and photographic detail than the generated target.

Visual iteration corrected pale water, flat metal reflections, missing water side faces, abrupt riverbank edges, and absent discharge geometry. Metal uses separate reflection cards while water uses the laboratory environment. All animated presentation reads the displayed snapshot, including replay and stopped supply.

A concurrent benchmark repeatedly rewrote a generated runtime tsconfig, causing Vite to reload every several seconds. The watcher now ignores that generated runtime tree. Application source still reloads normally. Startup has visible progress stages. Lifecycle cleanup is registered before asynchronous renderer initialization, and root click handlers use an abortable lifetime. Typed liquid controls now commit on Enter or blur as well as change; sliders commit on release.

The shared run library remains available across all five material studies. Legacy liquid records normalize new settings without being discarded. The original press, bridge and canopy modules were preserved.

See MODEL.md for the numerical scope, verification.json for tests and native-browser checks, and source-manifest.json for the verified file hashes. No deployment or remote browser transfer was performed.

Final qualification: 57 liquid/library checks and 27 shared regression checks passed. All 40 hydraulic programs completed with maximum absolute volume-budget error 5.87e-13 m³. Typecheck and the final production build passed. Native browser review covered 1280 × 720, 1440 × 900 and 390 × 844, with WebGPU and WebGL both observed. Final console checks were empty. Rainfall sub-millimetre measurements retain precision; comparison setup tables include all new hydraulic controls.
