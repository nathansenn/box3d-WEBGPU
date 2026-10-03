# Four-workspace review

Reviewed read-only on 2026-09-08. All implementation changes are in BOX3D.

| Workspace | Current source reviewed | Adaptation |
|---|---|---|
| StudiCraft | `graphify-out/GRAPH_REPORT.md`, wiki index, `Cinematics_and_Screen_Effects.md`, `Texture_Management.md`, `src/utils/cinematicPresets.ts`, `src/store/useWeatherStore.ts` | Scale-aware camera composition, light palettes, independent visual surroundings. The graph wiki's communities link was absent; the existing individual wiki pages were used. No animation or weather engine is claimed as imported. |
| HouseBuilder | `apps/web/src/domain/materials/catalog.ts` | Compatible appearance choices, architectural warm white/slate/charred/oak/cedar palettes, clear separation of geometry from finish. Quarantined catalog textures were not copied. |
| Commander Academy | `labs/plate-d3d-012-blacksmith-alloy/src/materials.js`, `labs/plate-d3d-019-satchel-load/src/materials.js`; complete public/lab PBR packs | Five complete local packs: brass sheet, heirloom leather, Cloudrest timber, blacksmith iron and copper sheet. Low-amplitude normal response, separate coating and sheen treatments. Source bytes recorded in asset-provenance.json. |
| Material Forge | `src/scripts/water-scene-settings.js`, `src/scripts/water-material-scene.js`; v7/v8 catalog/map availability | Woodland/wetland river palettes, a multiscale periodic ripple normal field, coupled reflection color and light. The original WebGL water engine is not imported into the WebGPU studio. |

Material Forge catalogs contain multiple master-derived variants. Many v8 map paths are unavailable locally; some available normal maps exceed 30 MB. This pass therefore uses the compact, complete Academy packs rather than publishing unsupported catalog entries. Previous copied source assets remain unchanged.

The new collection has 150 total entries: 60 finishes, 20 lighting treatments, 30 load recipes, 8 cameras, 8 surroundings, and 24 complete setups. Only entries compatible with the active study are presented. Setup cards show actual material samples and their prescribed input ramps, not invented simulation results.

Boundary: leather, iron, brass and timber names describe visible surfaces. Appearance does not alter the existing authored solver. The three reduced models simulate connection loss, plastic sheet extension, contact and collapse according to their established scope; fixed laboratory and landscape geometry remains fixed. Water is visual and does not apply fluid forces to the deck.
