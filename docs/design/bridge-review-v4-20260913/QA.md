# Bridge Analyze V4 — implementation and verification

Implemented September 13–14, 2026. The existing bridge now has an Analyze step, two cable-plane diagrams, six selectable span zones, component counts, deck drop/lateral movement, recorded failure milestones, optional first-rupture pause, one persistent baseline, time-matched comparison, starting-setup restoration and JSON review export. Span inspection reveals the camera on a phone. Cable sides use stable A/B labels because the camera can orbit.

The new built-in imagegen concept is `mockup.png`; the exact prompt is `PROMPT.md`. The app's Reference dialog includes it as “Analyze workflow · new concept”. The reference copies have identical hashes in `source-hashes.json`.

## Visual comparison

The implementation follows the reference's large scene, dark inspection panel, five-step workflow, connection schematic, metrics, milestones and baseline chart. It retains BOX3D's orange action accent and teal data lines. It shows both cable planes and the actual 327 links instead of copying illustrative reference counts. The outline and duplicate response panel are hidden in Analyze, and the scene camera fits the available width. At short desktop heights, the map is compact; lower analysis sections scroll within the panel. This is a functional layout adaptation, not a claim of pixel-identical rendering or newly calibrated structural behavior.

| Check | Result / evidence |
| --- | --- |
| TypeScript | `npm run typecheck` passed after final edits |
| Focused model and geometry tests | 25 passed; `tests.log` includes 11 new review tests and existing road, ecology and framing checks |
| Production build | Passed; `build.log`. Existing large-chunk advisory remains |
| Initial state | 0 lost of 327 links; correct component totals: cables 72, hangers 74, deck links 72, crossbeams 37, bracing 72 |
| Actual overload auto-pause | Target 5, strength 1.6, wind 2. First rupture at about 7.69 s; dev paused at 7.73 s, compiled run paused at 7.69 s. This option stops at the first returned batch, within 12 ticks / 0.10 s, not an asserted exact event tick |
| Reverse replay | Before-rupture sample 7.60 s restores 0 lost; first-rupture sample restores 1 lost. Verified in development and compiled builds |
| Full progressive collapse | Unchecked auto-pause; run reached 30.01 s, 27 lost, 6.200 deck drop, 4.892 lateral movement. Counts: 3 cable, 3 hanger, 21 deck, 0 crossbeam, 0 bracing. Six zones sum to 27; `progressive-collapse.png` |
| Peak and latest milestones | Clicks moved playback to 7.60 s and 30.01 s in the collapse run |
| Span selection | Map selection filters counts and moves the camera to the current recorded deck position. Phone closes the panel to reveal that position; `phone-inspection.png` |
| Baseline storage | Saved overload baseline, recovered it after page reload, restored target 5 / strength 1.6 / wind 2, replaced with collapse run, then cleared the synthetic QA baseline |
| Comparison | Separate Service crossing at 2.60 s reported +0.054 drop and 0 additional lost links against the overload sample at the same time. At 10.13 s, beyond that baseline's 7.73 s duration, the UI explicitly reported no matching sample |
| Export | Actual browser download parsed and checked: 27 service samples and 79 baseline samples, correct settings and monotonic times. Copy retained as `review-export.json` |
| Invalid data and missing history | Tests reject invalid JSON, incompatible model/backend, nonfinite fields, duplicate timestamps, oversized storage and bad settings. No milestone or comparison jumps across an evicted history gap |
| Desktop | Inspected 1280×720 and 1536×1024; `analyze-desktop.png`, `desktop-wide.png`, `reference-comparison.png` |
| Phone | 390×844; scrollWidth equals viewport width 390. Five tabs fit, Home/End keyboard navigation selects first/last tab. `phone-analyze.png`, `phone-inspection.png` |
| Rendering | Native WebGPU observed on the phone pass; WebGL 2 fallback observed on desktop and compiled runs. Both rendered and simulated. Compiled warning/error log was empty during failure/replay checks |

## Scope and operating evidence

Local native browser exception: private localhost app plus GPU rendering and recorded-geometry interactions; Browserless cannot reach this loopback-only service, and no private build transfer was retried after the earlier transfer rejection. One disposable IAB tab was used at a time. The September 14 resumed session found the previous disposable tab and servers already gone, restarted loopback previews, and used a fresh disposable tab for final label/build verification. User tabs, authenticated Chrome sessions, and unrelated processes were preserved. No retention marks or deferred-automation changes were made.

All servers bind 127.0.0.1. Production preview required sandbox listener escalation, which was approved; the sandbox's unprivileged curl could not reach it, so no HTTP-status claim is made from that check. The actual native browser rendered the compiled app and exercised its controls. Shared disk headroom was 59–64 GiB during the work, above the 50 GiB reserve; no dependency installation or bulk cleanup was needed.

The numerical solver, water force boundary and existing materials were preserved. This is an authored comparative simulation; values are not calibrated predictions, safe-load ratings, or build-ready engineering results. Baseline JSON contains response samples and settings; the existing Export evidence / Resume saved run workflow remains the resumable checkpoint path. Work is local and uncommitted; concurrent work was preserved.

Final resumed verification, September 14: the rebuilt production app rendered with **WebGPU + worker**, displayed stable **SIDE A / SIDE B** labels and enabled Run simulation. `compiled-ready.png` records the finished view; `compiled-console.json` contains an empty warning/error list. Disposable tab 5 was closed, viewport overrides had been reset, and the production QA listener on 5186 was stopped. The main development preview remains on **127.0.0.1:5173**, PID 64923 at handoff. User tabs were preserved.
