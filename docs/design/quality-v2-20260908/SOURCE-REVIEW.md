# Four-workspace review and preset collection

Scope: reviewed relevant local source, catalogs and material payloads from the four requested projects. This was a targeted implementation review, not a claim that every screen or preset in those applications was audited. All four source projects remain unchanged.

| Workspace | Reviewed source | Applied in BOX3D |
| --- | --- | --- |
| StudiCraft | `src/utils/cinematicPresets.ts`, `src/utils/ambientLighting.ts`, Graphify report and wiki index | Five camera compositions and atmospheric lighting palettes. The camera targets the active specimen; lighting moods remain separate from wind. |
| HouseBuilder | `apps/web/src/domain/materials/catalog.ts`, `apps/web/src/features/scene/proceduralEnvironment.ts` | Compatible finish filtering, architectural finish palette, appearance separated from physical coefficients, a procedural linear HDR environment with a coupled sun. |
| Commander Academy | `labs/d3d-lighting-kit/index.js`, failure-analysis-hall and rope-bridge material definitions | Linen, iron and timber base/normal/roughness packs; workshop fixtures; inspectable load, yield and failure study patterns. |
| Material Forge | `src/scripts/studio-environment.js`, `src/scripts/water-material-scene.js`, V7/V8 catalogs and selected payloads | Broad softbox reflections, river lighting, sampled terrain placement, copper/bronze/navy surface maps. |

The collection contains **36 finish treatments** (12 per specimen), **12 lighting setups**, **18 load recipes** (6 per study), and **5 camera compositions**: 71 selectable presets. Color and roughness variants deliberately share eight reusable surface packs. These are 71 presets, not 71 different engineering models or 71 distinct scanned materials.

Finishes and lighting never change the solver. The 18 new load recipes use BOX3D's existing normalized load, connection strength, wind and playback controls. Applying one prepares a fresh run, and the library explains that before selection. They are newly authored comparative recipes inspired by Academy's teaching workflow, not imported physical test data.

## Asset use

`asset-provenance.json` records source paths, byte lengths and SHA-256 hashes for every copied asset. The selected Material Forge V8 catalog entries had no local image payloads; verified V7 base/roughness maps were used instead. Copper and bronze treatments share Academy's fine iron normal map; navy uses Academy's linen normal map. These are explicitly authored combinations, not complete source-faithful scans.

Four newly generated material images supply weathered oak, granite, riverbank earth and forest floor. They are texture inputs on inspectable geometry. No generated scene image is used as the viewport background. The existing frozen ImageGen interface concepts remain in the reference dialog.

## Rendering changes

- Fiber normal detail and cloth sheen, seams and perimeter stitches tied to live membrane connections.
- Curved press hoses, gauge scale, collar seals, fasteners, and exposed sheet edges derived from surviving solver faces.
- Six visible boards per bridge station, deck fasteners following station transforms, cable clamps and a brighter galvanized finish.
- Blended moss/soil terrain, rooted bank cover, irregular rocks, varied forest crowns, and a moving planar water reflection.
- One HDR sky direction shared by the sun, environment and river highlights. Indoor reflections use four broad photographic emitters.
- Static fixture geometry grouped by material, stable 4096-pixel shadow maps, reduced output resolution in Balanced, separate analysis materials and a panel-free inspection mode.

The implementation uses the pinned Three.js WebGPU [WaterMesh](https://threejs.org/docs/pages/WaterMesh.html) and [physical node material](https://threejs.org/docs/pages/MeshPhysicalNodeMaterial.html) APIs. The single-sample MRT / GTAO / FXAA pipeline is preserved to avoid the earlier multisampled depth incompatibility.

## Boundaries

The preserved solver hash is in `baseline.json`. This pass improves presentation and usable presets; it does not add FEM calibration, cloth self-collision, hydraulic fluid simulation, water/structure coupling, or failure of fixed scenery. Those limits remain visible in the application. Automated checks establish runtime behavior and consistency. Human approval of visual quality remains open.
