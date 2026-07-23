# 100 AAA Improvements — v1.19 Production Ledger

This ledger is the release contract for the v1.19 signature-scene production pass. Every numbered item is represented by runtime geometry in `src/aaa-improvements.ts`; the registry requires exactly ten improvements for each of the ten signature showcases. The presentation layer is backend-neutral, so native Box3D WASM and deterministic preview physics receive the same authored stage without duplicating simulation bodies or changing replay hashes.

The items are intentionally concrete: each has a stable ID, owning scene, category, finite transform, positive scale, and one or more visible material or emissive primitives. `testAAA100ImprovementRegistry` rejects missing, duplicate, misowned, non-finite, or zero-scale entries.

## Aegis Tower: Kinetic Breach — 1–10

1. Stepped weathered-concrete blast plinth.
2. Four load-path corner buttresses.
3. Galvanized mechanical-floor belt.
4. Layered rooftop crown and antenna base.
5. Paired aviation warning beacons.
6. Kinetic-breach target chevrons.
7. Perimeter impact bollards.
8. Low debris-containment curb.
9. Dark mechanical louver bank.
10. Cyan podium guidance rails.

## Twin Spire Progressive Collapse — 11–20

11. Shared stone-and-concrete megapodium.
12. Galvanized skybridge underside keel.
13. Matched rooftop crown plates.
14. Independent spire status beacons.
15. Outer galvanized stability fins.
16. Readable skybridge expansion joint.
17. Four recessed plaza light wells.
18. Twin elevated setback terraces.
19. Asymmetric impact-side warning strip.
20. Skybridge-fall debris barrier.

## Truss Span Failure — 21–30

21. Eight visible elastomeric bearing pads.
22. Honed-stone approach slabs.
23. Continuous galvanized guard rails.
24. End portal frames for silhouette depth.
25. Under-deck redundancy chords.
26. Readable deck expansion joints.
27. Pier inspection lamps.
28. Layered concrete pier caps.
29. Emissive deck lane markers.
30. Under-deck crossbeam array.

## Citadel Siege — 31–40

31. Stone breach-analysis apron.
32. Twin exposed rebar cages.
33. Layered parapet capstones.
34. Massive side buttresses.
35. Breach rubble catch wall.
36. Red breach warning lamps.
37. Galvanized inner gate frame.
38. Darkened breach-face scorch plate.
39. Forensic observation light bar.
40. Numbered-style debris marker row.

## Mega Atrium Collapse — 41–50

41. Galvanized-and-glass entry canopy.
42. Layered central roof oculus.
43. Emissive skylight datum ring.
44. Continuous facade mullion belt.
45. Opposed interior balcony slabs.
46. Cross-axis luminous floor inlay.
47. Emergency egress beacon quartet.
48. Four atrium mega-columns.
49. Entry debris-control barriers.
50. Suspended luminous atrium signage.

## Tempest Standard Protocol — 51–60

51. Wind-tunnel contraction frame.
52. Four anemometer reference poles.
53. Cyan pitot telemetry rail.
54. Readable cloth-anchor cap blocks.
55. Emissive floor streamline array.
56. Glazed wind-control booth.
57. Rear observation safety rail.
58. Amber storm-level beacons.
59. Post-impact recovery datum markers.
60. Overhead service gantry.

## Sky Crane Cable Failure — 61–70

61. Four honed-stone outrigger mats.
62. Glazed operator inspection cage.
63. Luminous payload landing zone.
64. Layered concrete counterweight blocks.
65. Crane envelope warning beacons.
66. Payload tag-line guide posts.
67. Hook-path inspection light bar.
68. Alternating deck-edge guidance stripes.
69. Twin mast-base stability braces.
70. Concrete payload cribbing stands.

## Tsunami Research Array — 71–80

71. Five calibrated wave-gauge poles.
72. Cyan still-water datum lights.
73. Elevated glazed control booth.
74. High-contrast wave-impact target.
75. Honed-stone wave run-up ramp.
76. Pressure-sensor rail array.
77. Flood-level emergency beacons.
78. Flume drainage-slot markers.
79. Overhead high-speed camera gantry.
80. Downstream foam-collection boom.

## Concrete Spall & Rebar Exposure — 81–90

81. Hydraulic actuator head and platen.
82. Emissive load-cell collar.
83. Twin honed-stone support saddles.
84. Warm rebar-transfer inspection lights.
85. Deep spall-fragment catch tray.
86. Seven crack-width gauge markers.
87. Glazed lateral safety shields.
88. Alternating floor hazard strip.
89. Luminous specimen identification plaque.
90. Residual-deflection datum rail.

## Glass Catastrophic Fracture — 91–100

91. Galvanized impact-pendulum guide.
92. Four perimeter fracture light bars.
93. Deep honed-stone shard catch tray.
94. Transparent lateral standoff fins.
95. Broad cool fracture backlight.
96. Localized crack-origin beacon.
97. Galvanized edge-clamp covers.
98. Front-of-stage safety barriers.
99. Twin forensic fracture scale bars.
100. Shard-field collection markers.

## Architecture and performance boundary

- These additions are renderer-owned presentation state. They do not create contacts, apply forces, or alter native/preview body streams.
- Only the active signature scene stages its improvement primitives; ordinary catalog scenes receive zero additional instances.
- Stage props are cached with the effects frame and retain the existing exact upload-version contract.
- Quality budgets reserve stage props before transient particles so authored scene identity remains present during maximum-impact beats.
- The renderer reserves the maximum combined GPU-segment plus CPU-proxy soft stream separately from the full Ultra effect budget; signature props and maximum-stress glass therefore do not silently clamp one another.
- Transient particles and shockwaves have deterministic backing-pool limits, so repeated actions while paused cannot accumulate invisible update work without bound.
- Material tags reuse the current concrete, galvanized metal, glass, stone, and emissive paths. Concrete crater aggregate now uses the mineral/stone tile rather than the previously incorrect woven-fabric tag.

## Acceptance evidence

```bash
npm test
npm run test:webgpu
npm run test:native-wasm
npm run test:soft-soak:all
npm run test:material:100
npm run build
```

The release is complete only when the registry remains exactly 100 entries, every signature scene owns exactly ten, all transforms and colors are finite, the renderer submits the combined stage/effect stream without uncaptured WebGPU errors, replay hashes stay deterministic, and the final source manifest verifies.
