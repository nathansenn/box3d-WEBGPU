# V4 verification

Implemented from the new built-in imagegen reference in `mockup.png`, using `PROMPT.md`. The native scene uses the existing apparatus with a visible section plane and A/B/C probe markers. The new Analyze workflow adds a profile chart, one-parameter comparisons, recorded curves, exports and saved setup loading. All 60 presets, 24 liquids and older saved runs remain available.

## Gates

- TypeScript passes. Production Vite build passes; existing large-chunk warning remains.
- 104 liquid, terrain, analysis and saved-library checks pass, plus 27 relevant concrete/rubber/normalization regressions: **131 passed**. All 60 existing liquid presets ran their full program.
- Tests cover signed section integration, dry/solid readings, recorded-frame isolation, legacy timing defaults, exact cutoff with crossing time steps, post-cutoff drainage, parameter bounds/duplicates, worker/live agreement, 60-second endpoints, sample limits and CSV metadata.
- The initial 60-second test used strict equality for two equivalent floating-point coordinate expressions. It was corrected to a numerical tolerance; the full final suite passes. The initial diagnostic log is retained separately from the final `tests-liquid.log`.
- Native in-app browser: dev origin 5173 and compiled origin 5186, WebGPU renderer, no recorded warning/error logs. Tested 1280×720, 1440×900 and 390×844. The final development reload started successfully with the existing WebGL fallback; the production check used native WebGPU. Phone document width equals viewport width (390 px), with no horizontal overflow.
- Production URL opens directly with `panel=analyze`. Keyboard Home/End reaches Set up/Analyze. Program duration and cutoff inputs commit to the model and comparison description. Duplicate case values are rejected without starting work.
- Comparison cancellation and restart work. Three 12-second river cases with bank heights 0.04 / 0.09 / 0.17 m and cutoff at 8 s completed. Final coverage: 100 / 65.2 / 58.8 percent. Maximum depths: 319.1 / 330.9 / 352.4 mm. Collected plus overflow: 22.4 / 16.4 / 15.4 L. The low-bank case is already partly flooded at the initial water level; time-zero data is retained.
- Downloaded comparison CSV: 363 data rows, three cases, exact input settings and SI units. Downloaded JSON report retains all results. A loaded case completed live with all three final metrics matching the worker within 1e-10. Its section CSV contains 182 recorded frames at 4.535714 m. Replay to frame zero restores time zero and initial active supply.
- Saved case 2 appears in the existing run library alongside three older dev-origin results. No saved runs removed.
- The IAB download-event waiter timed out, but the actual downloaded file was present. Its bytes and parsed data were independently verified and copied to this evidence directory; this was a browser automation notification limitation.

## Browser and ownership scope

Used the recorded localhost/native-GPU/module-worker exception. Existing Browserless private-transfer and tab-retention rejections were respected. No private build uploaded and no tunnel created. Only one disposable IAB tab was opened; no user Chrome tabs or shared browser processes touched. The temporary production preview is stopped after QA, the viewport override is reset, and the owned tab is closed. Development server remains on 127.0.0.1:5173. No deployment or commit.

Screenshots: desktop-analysis.png, desktop-comparison.png, top-probes.png, mobile-analysis.png. Machine-readable results and source hashes are in verification.json and source-manifest.json.
