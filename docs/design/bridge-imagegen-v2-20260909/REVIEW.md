# Bridge refinement · ImageGen v2

Two new ImageGen targets informed the live bridge: the full river crossing and a closer abutment/steelwork view. Both original generation outputs and versioned project copies are retained. The generated pixels appear only in the comparison interface and this review.

Implemented changes:

- A 480 × 600 model-unit valley with an uninterrupted channel, denser layered woodland, shared Poly Haven tree materials across three geometry levels, and distant canopy infill. Source licenses and exact copy hashes accompany the imported models.
- Grounded, clustered ferns and sedges; smaller gravel and bank stones around the abutments; planting avoids foundation, approach and boulder footprints. The scanned tree bases are seated below the downslope terrain to hide their ground skirts.
- Weathered steel, darker fasteners, flange splice plates, crossing gussets, cast-concrete aggregate/streaks, continuous approach planks, and correctly oriented timber fascia grain. Deck fascia remains part of each simulated deck station.
- Finer river normals, shallow transmission through to the actual terrain and stones, and fragmented wakes sharing coordinates with exposed riffle stones. The river remains a visual water model and does not change structural forces.
- Woodland daylight, River crossing and Abutment & steelwork cameras, and the complete River observatory preset. The collection now contains 161 presets. The comparison dialog includes both new concepts and the original image, plus a camera alignment control.
- Camera framing accounts for the open desk and response panel. Portrait overviews move above the river corridor; the reverse view also avoids the surrounding canopy. Compact response charts reduce tick density.

Validation: TypeScript and production build pass. 90 checks pass across failure physics (26), presets (44), river workflow (7), reference geometry (6) and the new refinement checks (7). The final fixed production build was checked in the in-app browser using its WebGL 2 fallback at 1536 × 1024, 1280 × 720 and 390 × 844. These viewport checks are browser emulation, not a physical phone test. The build retains Vite's large-chunk advisory.

The bridge overload ran to 30 model seconds, with 27 broken connections and 6.200 model-unit deflection. Replay returned to the intact initial state; reset restored zero deflection and zero broken connections. Renderer startup, scene switching, new preset selection and the generated/live comparison are checked separately in the runtime receipts.

Visual review: the live geometry follows the references' steel/timber/concrete treatment, planted banks and wooded crossing composition. It is still a real-time reconstruction, not a photographic match. The generated targets have denser undergrowth, stronger fine weathering, more irregular landforms and more complex turbulent water. Distant foliage uses simplified geometry and cutout clusters. No calibrated engineering or full fluid/structure simulation is claimed.

All final captures refer to the source and asset hashes in `frozen-build.json`. The custom settings on the user's working tab are preserved. The working preview also starts with WebGPU. The temporary production preview is removed after capture; the development preview remains on 127.0.0.1:5173.
