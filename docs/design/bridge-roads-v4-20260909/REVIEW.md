# Connected woodland approaches

Both gravel roads now curve into the forest and meet the timber approaches. Terrain is graded under the route, shoulder triangles conform to the rendered ground, and vegetation and anchor blocks clear the walking lane. The authored gravel section extends 122.5 model units beyond each timber approach.

The bridge now has open portal towers with upper knee braces, splayed backstays and clevis anchors, visible deck steelwork and bearing supports, continuous approach rails, beveled timber boards and board fasteners. The deck steel and rails follow recorded deck-station deformation. The structural solver is unchanged.

The new **Woodland approach** setup and **Road & open portals** camera join the existing collection of 163 presets. The comparison dialog uses the critic-corrected ImageGen crossing and approach concepts.

## Verification

- TypeScript check and production build passed. The existing large JavaScript chunk warning remains.
- 97 bounded checks passed: physics 26, presets 44, river 7, reference geometry 6, refinement 7 and roads 7.
- Road tests check triangle interiors, upward winding, terrain clearance, both timber joins, route clearance, tilted rail attachment and camera framing.
- Production browser checks cover the hero, approach, opposite bank, bearing detail, reference comparison, setup application, collapse, replay restoration and 390 × 844 layout.
- The collapse case reaches 27 broken connections and 6.200 model units of deflection; replay to the first frame restores zero broken connections and zero deflection.
- A controlled render isolated distant rectangular bands to ambient occlusion. The final pass retains nearby contact shading and fades the effect with distance.

See `frozen-build.json`, `runtime-receipts.json` and `CRITIC-REVIEW.md` for the exact scope and evidence. Browser viewport emulation does not establish physical phone or touch-device performance. The production session used the built-in WebGL 2 fallback; development also rendered through WebGPU during this pass. Observed frame rates are not a performance benchmark.

## Visual limits

The critic found no visible connected-road or portal blocker. Surface wear, forest silhouettes and irregular water detail remain simpler than the generated concepts. This pass improves the live scene; it does not establish photographic parity or engineering certification.
