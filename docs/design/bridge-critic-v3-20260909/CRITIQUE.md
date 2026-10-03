# Bridge concept: independent critic review

User request: ask a critic what is wrong with the generated bridge and remake the image with the fixes.

Reviewed inputs: `../bridge-imagegen-v2-20260909/references/bridge-hero.png` and `../bridge-imagegen-v2-20260909/references/bridge-detail.png`.

The independent critic inspected both actual images. This is a visual design critique, not a structural certification.

| Priority | Observed issue | Remake direction |
| --- | --- | --- |
| Critical | The full-height X diagonals intersect the walking route through both transverse tower openings; the detail makes the obstruction especially clear. | Open portal towers, overhead crossbeam and upper-corner knee braces, with continuous clear deck through both openings. |
| High | Stranded backstays become smooth rod-like main cables; continuity over the crowded tower crown is unclear. | Consistent wire-rope cables over visible curved saddles, with distinct smaller hanger clamps. |
| High | Near anchor hardware is cropped and far backstays disappear into foliage. | Show anchorages and cable terminations behind the towers, outside the walking approaches. Hidden details are not proof of missing components. |
| High | Hangers appear to end against the timber fascia, while the underside does not establish the deck support path. | Legible steel edge girders, transverse floor beams, stringers and hanger clevises. No capacity conclusion follows from this visual concern. |
| Medium | The walking approaches and deck-to-bank transitions are cropped or obscured. | Flush landings and graded gravel approaches, concrete embedded into banks, coherent rock aprons and staining. The image cannot establish scour safety. |
| Medium | Both original views repeat nearly the same side and conceal the same route and support details. | Add an approach view of the same corrected bridge, looking through both open portals. No definite component-count mismatch was established between the originals. |

Preserve the narrow suspension-footbridge character, weathered blue-gray steel, timber deck, clear shallow river, mixed woodland, natural daylight and restrained aging.

Workflow: generate a corrected hero with the built-in ImageGen tool, request a second critic inspection, then generate a complementary approach view from the corrected image. Original images stay unchanged. New references are visual concepts; they do not change or certify the live simulator's topology.

Storage: approximately 15 GiB was free before generation. This is a bounded image-only pass with a 30 MiB artifact budget, owned by this task. No installs, model downloads or disposable production build are needed.

## Critic's recheck

The revised hero fixes the major visible defect. The near portal is open; diagonals projected behind the far portal are suspension cables, rather than the old solid X braces. Anchorages, steel deck-edge support and grounded gravel approaches are substantially more legible. Cable saddle detail and some transverse framing remain indistinct or occluded at the hero scale.

The complementary approach shows a continuous through-route and consistent portal construction. The critic identified one remaining omission: the short exposed river-side approach edge lacked its guardrail. A focused ImageGen edit added matching posts, handrail and infill while keeping the entrance open. The critic inspected the correction and accepted the visual concept. The same railing was then carried into the hero and visually checked by the primary agent.

The approach end post sits slightly behind the timber's leading corner, beside the gravel bank. The critic did not consider that remaining short lip an essential image correction. Hidden framing, exact joints, dimensions and structural performance remain unverified by these pictures.

Selected outputs: `bridge-hero.png` and `bridge-approach.png`. `prompts.json` retains all four built-in ImageGen prompts and source output paths; `references.json` records the final asset hashes. `gallery.html` compares the originals and the corrected concepts. The live 3D scene is a separate implementation and has not been rebuilt in this image-only revision.

Completion storage: the review folder is approximately 7.2 MB. The task's generated originals and selected deliverables are retained; no unique image, source file, lockfile or runtime was deleted. No temporary build or downloaded model was created. Reported free space was approximately 15 GiB before and 14 GiB after; concurrent machine activity prevents attributing that system-wide difference to this bounded image pass. The original v2 image hashes still match their saved manifest.
