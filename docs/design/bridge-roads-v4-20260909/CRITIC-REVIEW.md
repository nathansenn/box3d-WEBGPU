# Bridge road review

The independent critic found and rechecked three implementation defects: a 0.09 approach support gap, rails using world-up while posts tilted, and shoulder faces crossing terrain diagonals. All three were corrected. The repeat check covered 334,376 face-interior points across 47,768 road triangles; clearance stayed between 0.060 and 0.084 model units. Tilted rails remained attached within floating-point precision.

The final hero and approach captures show no connected-road or portal blocker. The gravel meets the timber, both portals remain open, approach railings continue, and supporting deck steel is visible. These close views do not show the roads' full distant length.

Remaining visual differences from the generated concepts: road/concrete/steel surface variation is simpler; foliage silhouettes and distant haze are less coherent; the water has smoother reflections and more repetitive ripples. The image pair is a visual concept, not a certified bridge design or a claim of photographic renderer parity.

A subsequent reverse/phone inspection found large distant bands from the screen-space ambient-occlusion pass. A controlled no-AO comparison removed them. The final shader retains near contact shading and fades AO from view depth 28 to 70. The river shader and solver remain unchanged.
