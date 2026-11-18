# Acceptance matrix

| Surface | Required evidence |
| --- | --- |
| Image reference | Concept inspected before UI implementation; large scene, dark inspector, mode segments, scan chips, plot and expandable results |
| Solver | Five independent intact cases, same backend and frozen controls; only selected axis changes; fixed duration and sample cadence; matches direct solver execution |
| Lifecycle | Cancel returns partial results; failures retain completed cases; worker disposed on completion, cancellation and view teardown |
| Results | No fabricated results; event-based first rupture, sampled peak drop/lateral, complete broken counts, model phase and explicit partial statuses |
| Actions | Scan/duration selection, start/cancel, select case, load starting settings, promote baseline, clear saved batch, export CSV/JSON |
| Persistence | Bounded compatible schema; wrong model/corrupt data ignored; completed and partial results survive reload; storage errors reported |
| Desktop | 1280×720 and 1536×1024; readable chart and cards; scene controls visible |
| Phone | 390×844; panel scrolls without horizontal overflow; touch targets, wrapped text, visible focus and keyboard mode switching |
| Regression | Inspect map/milestones/baseline work; scene switching cancels isolated work; live simulation stays independent |
| Verification | Focused behavioral tests, TypeScript, fresh production build and actual compiled UI interactions |
| Cleanup | Clear only synthetic QA saved data, reset viewport, close owned tab, stop owned QA listener; development preview stays running |
