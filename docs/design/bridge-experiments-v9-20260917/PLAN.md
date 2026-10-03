# Bridge experiments V9 — configurable studies

User request: add experiments and options useful to an engineer. Scope: the active bridge experiment desk, using the existing production solver and the existing V5 visual reference. No new imagery or geometry is required for this workflow extension.

Planned additions: ten presets across load, strength and crosswind; custom ranges with 3/5/7/9 cases; 15/30/60/120 second recordings; editable held settings; follow-ups between adjacent completed cases with different observed rupture outcomes; raw sample CSV. Preserve previous five-case scans and actual partial recording semantics. No calibrated capacity or fatigue claims.

Design critique: keep setup collapsible, retain the scene and numeric overview, put follow-ups after the results, and provide explicit units, ranges and invalid-input messages. Workbench context retrieval found W039 (parameter extremes) but its detailed geometry contract does not fit this UI task; only the general lesson to test valid boundaries and invalid combinations is relevant. The historical fixture was a failure, not accepted engineering evidence.

Ownership: only bridge-experiments.ts, bridge-experiments-view.ts, bridge-experiments.css, the baseline parser's sample bound, focused experiment tests and this receipt directory. Shared dirty source, assets and existing evidence are retained. Initial HEAD dfedd9f. No dependency installation, staging, commit, publishing or private transfer.

Resource budget: source/tests and receipts first, then one code-only build linking existing public assets. Planned additional disk output under 15 MB. Raw filesystem headroom measured 2.8 GiB, then 2.3 GiB while inspecting; reserve is advisory under current portfolio policy. No unrelated cleanup. Focused tests use one worker.

Browser exception: task 01a07e7b-23c9-72e1-a62e-b780ac76623f requires the private 127.0.0.1 Vite preview, production worker and native WebGPU scene. Browserless cannot reach loopback; the prior private-build transfer hold remains in force. Use one disposable local IAB tab for actual preset/custom/long/partial scan interactions, exports and desktop/phone layouts. Do not transfer private source/assets or profiles, open tunnels, reuse retained crash tabs, or mark a deliverable. Reset viewport and close only this owned tab at the checkpoint. Stop the owned compiled preview; keep the user-requested development preview on loopback.
