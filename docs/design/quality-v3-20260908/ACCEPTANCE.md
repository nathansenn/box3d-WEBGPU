# BOX3D collection pass — 2026-09-08

The job of the collection is to prepare a complete, reproducible experiment, then let the user inspect its failure in a real 3D scene. The existing three workspace treatments remain the visual foundation.

Design: use the current instrument palette (graphite #101617, panel #131b1d, line #2b3638, text #edf0ed, load orange #ff7c1a, response teal #48c4c4). Inter carries names and descriptions; IBM Plex Mono carries normalized inputs. The signature is an actual surface sample paired with the setup's target load ramp. A sidebar separates preset kinds from saved collections; the compact drawer preserves sight of the live scene. Generic scenic stock thumbnails were rejected because they would imply geometry the setup does not contain.

Acceptance:
- 150 useful presets: 60 finishes, 20 lighting treatments, 30 load recipes, 8 camera views, 8 compatible surroundings and 24 authored complete setups.
- Complete setups resolve all five compatible choices and reset the model only after local material loading succeeds.
- Favorites and recent choices persist locally; invalid or unavailable storage cannot prevent use.
- Source filter, search, clear, categories, keyboard navigation, empty states and compact scene view work.
- Three scenes render, can change finishes/lighting/surroundings and can run real failure, release and replay.
- Desktop and phone fit without horizontal overflow. The new connection and oblique cameras frame their intended subjects.
- Authored failure model bytes and all previous source assets stay unchanged.
- New local PBR packs retain byte-for-byte provenance; no source repository is edited.

Storage: the run owns a 180 MiB maximum for temporary build/captures. New assets total 8,415,128 bytes. No bulk Material Forge catalog import, dependency installation or source-project copy. Root owns cleanup of disposable build output. Prior v2 evidence remains frozen.
