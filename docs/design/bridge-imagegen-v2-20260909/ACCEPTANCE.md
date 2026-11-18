# Bridge ImageGen refinement

Mode: reconstruction refinement. Generate two new visual targets from the existing bridge: a full crossing and a close material/contact view. Freeze their paths and hashes after generation. Existing `public/studio/references/bridge.png` remains unchanged and available.

The existing simulation topology is authority for span, fixed supports, cable and deck motion. ImageGen is authority for the new appearance direction only. Camera, terrain, plant habitat and weathering are inferred artistic choices, not surveyed construction. New references appear only in comparison panels; their pixels are never projected onto the 3D scene or used as a scene background.

Quality floor: the existing StudiCraft fidelity bridge in `../studicraft-fidelity-20260909/captures/fixed-bridge-reference.jpg`. Improve visibly beyond its sparse vegetation, flat bank slopes, coarse reflections and light steel.

Required evidence: before, final main view, reverse, material/contact close-up, phone framing, load/failure and clean runtime. Freeze one production build for the final capture set. Validate geometry on the CPU where new contact/attachment geometry is added. Preserve the user's custom load settings for their working tab.

Runtime evidence and visual correspondence are separate. Visual matching remains subject to human review; this pass claims no calibrated engineering or photographic equivalence. Temporary artifacts are limited to 180 MiB; the task owns and removes its disposable build after evidence is retained.
