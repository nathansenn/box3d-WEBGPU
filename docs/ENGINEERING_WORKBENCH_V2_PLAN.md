# Engineering Workbench V2 Implementation Plan

Status: implementation-ready  
Product target: browser-native professional physics testing workbench  
Reference assets:

- `public/concepts/physics-workbench-structural-v2.png` — Structural Test, 1672 × 941
- `public/concepts/physics-workbench-correlation-v2.png` — Correlation Review, 1672 × 941
- `public/concepts/physics-workbench-field-modal-v2.png` — Field Modal, 1024 × 1536

## 1. Outcome and non-negotiable decisions

Build one responsive Vite/TypeScript application with three real workspaces:

1. **Structural Test** is the primary desktop laboratory. It exposes all 31 curated simulations, adjustable forces and material controls, a guarded run lifecycle, live telemetry, timelines, charts, replay, and evidence capture.
2. **Correlation Review** compares a recorded reference run with a recorded candidate run. It supports synchronized 3D checkpoints, channel alignment, residuals, deterministic comparison metrics, checklists, and evidence export.
3. **Field Modal** is the portrait/tablet workflow. It runs a deterministic, analysis-only impulse capture on a normalized composite cantilever, shows five virtual sensors, extracts reduced-order modes, and presents frequency response, coherence, mode shapes, capture history, and annotations.

The generated images are quality and interaction references, not raster backgrounds. The shipped viewport remains live WebGPU, the charts remain data-driven, and every visible control must change real application state.

The implementation will:

- retain vanilla TypeScript, Vite, Box3D WASM, the deterministic fallback, current soft solvers, and the custom WebGPU renderer;
- preserve exactly 31 public workbench labs, 800 stable scene recipes, 65 showcases, and the current material-demo registry counts;
- avoid a React or component-framework migration;
- use IndexedDB for run archives and preferences, with an explicit in-memory fallback;
- add a small analysis Web Worker for correlation and modal math;
- add bundled Inter, IBM Plex Mono, and Phosphor icons; no runtime font or icon CDN is permitted;
- use the current renderer as the numerical presentation path and never replace it with generated imagery.

## 2. Product truth and fidelity policy

The application is a high-quality engineering **workflow simulator** over the existing deterministic reduced models. It is not a certified finite-element, crashworthiness, modal-test, or structural-design system.

### 2.1 Required provenance labels

Every channel, chart, headline value, export field, and comparison result carries one of these provenance values:

```ts
export type DataProvenance =
  | 'solver-native'
  | 'derived-normalized'
  | 'deterministic-reference'
  | 'imported-test'
  | 'presentation-only';
```

- `solver-native`: directly reported by Box3D or a soft solver, such as body count, node count, broken constraints, or replay hash.
- `derived-normalized`: calculated from current normalized solver state, such as reduced strain, normalized energy, deflection in simulation units, correlation score, or simulation-time modal frequency.
- `deterministic-reference`: a previously recorded Box3D Workbench run used as a baseline.
- `imported-test`: user-supplied time-series data with declared units and metadata.
- `presentation-only`: rendering, particles, camera, annotations, or visual overlays that do not feed the numerical solve.

### 2.2 Language rules

Built-in runs must use:

- normalized load or force;
- simulation units for length and displacement;
- normalized strain and energy;
- simulation seconds and simulation Hz;
- `REFERENCE` and `CANDIDATE` in the correlation viewer.

Built-in runs must not use kN, N, MPa, Pa, mm, µε, joules, physical DAQ sample rates, `calibrated`, `mesh converged`, `implicit nonlinear`, `high fidelity`, or `physical test`.

`TEST` may replace `REFERENCE` only when the selected run has `imported-test` provenance. Uncertainty bands are hidden unless imported data includes uncertainty. The UI must never invent uncertainty, calibration, camera metadata, contact forces, or material constants.

`ARM`, `RUN`, `PAUSE`, and `ABORT` operate only on the simulated run state. The reference image's safety interlock becomes **Simulation Limits** and must not imply control of physical equipment.

### 2.3 Visible disclosure

The shell always exposes the active solver and fidelity badge. Built-in material workspaces display `Reduced numerical model`. Tooltips and evidence exports include the longer disclosure:

> Deterministic reduced-order simulation for comparative testing and workflow prototyping. Values are not certified engineering predictions.

## 3. Existing capability map

All 31 current labs remain available in Structural Test:

| Group | Labs |
|---|---|
| Material mechanics | Titan Metal Bend & Dent; Press-Brake V-Bend; Notched Low-Cycle Fatigue; Ballistic Glass Penetration; Curtain-Wall Wind Failure; RC Flat-Slab Punching Shear; Blast-Wall Back-Face Spall; Elastomer Cyclic Recovery; Composite Coupon Failure |
| Cloth and membranes | Tempest Flag Wind Tunnel; Canopy Load Capture; Cargo-Net Payload Catch; Progressive Fabric Tear; Tensioned Membrane Shock |
| Rope and rigging | Sky-Crane Cable Load; Suspension Cable Resonance; Heavy Pendulum Impact; Four-Point Mooring Array; Rope-Net Resonance |
| Water dynamics | Tsunami Research Flume; Dam-Breach Wave Front; Hydrodynamic Boat Wake; Vortex Current Chamber; Leviathan Impact Basin |
| Rigid systems | Aegis Tower Kinetic Breach; Truss Span Overload; Citadel Siege; Titan Hauler Crash Range; High-Bay Rack Cascade; Mega Atrium Progressive Collapse |
| Combined | Apex Materials Proving Ground |

Capability flags are added to lab definitions rather than inferred by UI code:

```ts
export type WorkbenchCapabilities = {
  structuralTest: true;
  correlation: boolean;
  pointForce: boolean;
  loadControl: boolean;
  renderCheckpointHz: 10 | 30;
  modalAnalysis: 'none' | 'analysis-only-cantilever';
};
```

Defaults:

- all 31 labs support Structural Test and correlation recording;
- material, cloth, rope, water, and combined labs record render checkpoints at 30 Hz;
- rigid labs record render checkpoints at 10 Hz;
- only `composite-coupon` exposes the analysis-only field-modal workflow;
- unsupported actions stay visible only when useful for discovery, are disabled, and explain the capability boundary in a tooltip.

## 4. Application architecture

### 4.1 Module ownership

Refactor the current monolithic controller into these subsystems:

```text
src/main.ts
  bootstrap, dependency creation, requestAnimationFrame

src/workbench/
  schema.ts                 public product/runtime contracts
  registry.ts               immutable 31-lab catalog and capabilities
  store.ts                  application and experiment state
  commands.ts               validated command dispatcher and event log
  runtime.ts                Box3D + SoftSimulationSuite coordinator
  telemetry.ts              channels, fixed-capacity buffers, decimation
  recorder.ts               run archive and render checkpoints
  persistence.ts            IndexedDB repository and quota handling
  evidence.ts               import/export and evidence-package validation
  correlation.ts            correlation request/result contracts
  modal.ts                  modal request/result contracts
  analysis.worker.ts        correlation, FFT, FRF, coherence, damping, MAC

src/ui/
  app-shell.ts              workspace routing, top status, fatal states
  structural-view.ts        structural tree, inspector, timeline, charts
  correlation-view.ts       synchronized viewer, checks, metrics, export
  field-modal-view.ts       portrait workflow, sensors, modes, captures
  charts.ts                 allocation-aware Canvas 2D chart primitives
  controls.ts               accessible shared controls and drawers
  icons.ts                  typed Phosphor icon mapping
  styles/*.css              tokens, shell, workspaces, responsive states
```

`main.ts` must be reduced to bootstrap and frame coordination. Workspace views subscribe to the store and issue commands; they do not access `PhysicsBackend`, `SoftSimulationSuite`, or `WebGPURenderer` directly.

### 4.2 Store and lifecycle

```ts
export type WorkspaceId =
  | 'structural-test'
  | 'correlation-review'
  | 'field-modal';

export type ExperimentPhase =
  | 'draft'
  | 'preflight'
  | 'armed'
  | 'running'
  | 'paused'
  | 'completed'
  | 'aborted';

export type WorkbenchState = {
  workspace: WorkspaceId;
  phase: ExperimentPhase;
  labId: string;
  seed: number;
  stress: number;
  solverSubsteps: 1 | 2 | 4 | 8;
  timeScale: 0.25 | 0.5 | 1 | 2;
  parameters: Readonly<Record<string, number>>;
  selection: { forceU: number; forceV: number; tool: 'orbit' | 'force' };
  activeRunId: string | null;
  dirty: boolean;
};
```

Allowed lifecycle transitions are fixed:

```text
draft -> preflight -> armed -> running -> paused -> running
                                  |          |        |
                                  +----------+--------+-> completed
                                  +----------+--------+-> aborted
completed -> draft
aborted   -> draft
```

- Changing the lab, seed, stress, solver substeps, or numerical parameter after preflight returns the session to `draft` and marks prior checks stale.
- Presentation-only changes such as camera, overlay, panel state, or render quality do not invalidate preflight.
- `step` is allowed only in `paused`.
- `reset` returns the same configuration and seed to `armed` when preflight is still valid; otherwise it returns to `draft`.
- `abort` freezes the final record, writes an abort event, and prevents further numerical commands until reset.

### 4.3 Command contract

```ts
export type SimulationCommand =
  | { kind: 'set-parameter'; id: WorkbenchParameterId; value: number }
  | { kind: 'point-force'; u: number; v: number; strength: number; radius: number }
  | { kind: 'broad-impulse'; strength: number }
  | { kind: 'radial-blast'; center: Vec3; strength: number; radius: number }
  | { kind: 'projectile'; speed: number; size: number }
  | { kind: 'impact-rain'; count: number }
  | { kind: 'set-load'; target: number }
  | { kind: 'release-load' }
  | { kind: 'cycle-load' }
  | { kind: 'preflight' | 'arm' | 'run' | 'pause' | 'resume' | 'step' | 'reset' | 'abort' }
  | { kind: 'annotation'; label: string };

export type CommandResult =
  | { ok: true; event: RunEvent | null }
  | { ok: false; code: string; message: string };
```

The dispatcher performs capability checks and clamping once. Successful commands update solver state, store state, timeline, run log, and recorder in the same transaction. Failed commands never partially mutate those systems.

### 4.4 Simulation coordinator

```ts
export interface SimulationCoordinator {
  loadLab(request: { labId: string; seed: number; stress: number }): void;
  dispatch(command: SimulationCommand): CommandResult;
  tick(realDeltaSeconds: number): RuntimeFrame;
  stepFixed(count: number): RuntimeFrame;
  snapshot(): RuntimeSnapshot;
  destroy(): void;
}
```

The coordinator retains the current 1/60-second fixed step, maximum eight catch-up steps, deterministic seed derivation, Box3D/soft parallel stepping, effects coordination, and existing upload caching. UI refresh frequency is independent from physics frequency.

## 5. Telemetry, recording, and persistence

### 5.1 Channel contract

```ts
export type ChannelDefinition = {
  id: string;
  label: string;
  quantity: string;
  unit: string;
  provenance: DataProvenance;
  sampleRateHz: number;
};

export type TelemetrySample = {
  step: number;
  timeSeconds: number;
  replayHash: number;
  values: Float64Array;
};
```

Common channels:

- normalized load/force signal;
- load target and load progress;
- maximum normalized strain;
- current, peak, and residual deflection in simulation units;
- normalized system energy;
- body, dynamic-body, node, constraint, break, fragment, and reinforcement counts;
- simulation and render CPU milliseconds, upload MiB, FPS, and replay hash.

Unavailable channels are omitted, not zero-filled. Channel order is frozen in the run record so samples use compact typed arrays.

Telemetry is recorded every fixed step. Headline values update at 5 Hz and charts render at 10 Hz using min/max bucket decimation, preserving spikes without redrawing all samples.

### 5.2 Run archive

```ts
export type RunRecord = {
  schema: 'box3d-run@1';
  id: string;
  createdAt: string;
  labId: string;
  seed: number;
  backend: string;
  solver: WorkbenchSolver;
  fidelity: WorkbenchFidelity;
  recipeVersion: string;
  parameters: Readonly<Record<string, number>>;
  channels: readonly ChannelDefinition[];
  samples: readonly TelemetrySample[];
  events: readonly RunEvent[];
  checkpoints: readonly RenderCheckpoint[];
  result: 'completed' | 'aborted';
};
```

- `createdAt` is metadata and never participates in deterministic hashes.
- Telemetry stays full precision. TurboQuant may compress only render-checkpoint transforms and node positions.
- Default maximum duration is 30 simulation seconds.
- Per-run estimated storage is checked during preflight.
- Per-run hard cap is 128 MiB; global archive cap is 512 MiB.
- The app never silently deletes old runs. When quota is insufficient, recording is refused with a recovery action that opens archive management.
- IndexedDB database: `box3d-engineering-workbench`, version 1.
- Object stores: `runs`, `checkpoints`, `preferences`, and `captures`.
- If IndexedDB is unavailable, the app runs in memory and shows `Session-only storage`; export remains available.

### 5.3 Evidence and imports

Evidence export produces one `*.box3d-evidence.json` file containing:

- schema/version and provenance;
- run metadata and parameter snapshot;
- channel definitions and samples;
- timeline events and replay hashes;
- preflight and comparison checks;
- correlation or modal result when applicable;
- optional base64 PNG captures explicitly labeled `presentation-only`;
- SHA-256 digest over the canonical JSON payload, calculated with Web Crypto.

The digest establishes file integrity only, not certification.

CSV import requires a header and explicit mapping:

```text
time_seconds,<channel columns...>
```

The import dialog requires the user to assign label, quantity, and unit to every selected channel. Unknown columns are ignored only after confirmation. The application never converts unmatched units or guesses calibration.

## 6. Structural Test workspace

### 6.1 Desktop composition

Match `physics-workbench-structural-v2.png` at 1672 × 941:

- 56 px global status bar;
- 272 px experiment/library rail;
- flexible central viewport and analysis area;
- 336 px load/material/solver inspector;
- central viewport occupies the upper portion of the middle column;
- timeline, force/displacement, and energy charts form the lower analysis row;
- status strip spans the bottom.

The left rail contains the 31-lab catalog, experiment setup tree, sensor channels, run history, and undo/redo for draft configuration. The right rail contains Load Case, Material, and Solver tabs, numerical limits, preflight status, and transport controls.

### 6.2 Behavior

- Selecting a lab loads its stable scene/material target and capabilities.
- Force targeting uses the existing normalized point-strike mapping and real viewport reticle.
- Load, release, cycle, point force, broad impulse, blast, projectile, and impact-rain commands route through the dispatcher.
- Preflight reports individual pass/fail items and predicted capacity, never fabricated physical limits.
- Timeline markers include load, force, hold, limit warning, pause, annotation, completion, and abort.
- Before/after mode uses a stored initial render checkpoint and the current frame.
- Revision history records parameter snapshots within the browser session. A revision is immutable after a run starts.
- Replay reloads the same lab/seed/parameters and deterministically reapplies logged numerical commands at their original fixed-step indices.
- PNG capture includes the WebGPU viewport only. Evidence capture can additionally serialize the surrounding UI state.

### 6.3 Simulation limits

Default limit checks are normalized and per-lab configurable:

- maximum normalized load progress;
- maximum normalized strain;
- maximum break count or break fraction;
- maximum fragment count;
- maximum simulation duration;
- archive capacity.

Limit exceedance writes a warning event. `Abort on limit` defaults off because existing demonstrations intentionally reach failure. When enabled, the dispatcher sends one deterministic abort after the first breached fixed step.

## 7. Correlation Review workspace

### 7.1 Correlation contracts

```ts
export type CorrelationCase = {
  referenceRunId: string;
  candidateRunId: string;
  channelPairs: readonly {
    referenceChannelId: string;
    candidateChannelId: string;
    weight: number;
  }[];
  alignment: {
    method: 'event-trigger' | 'bounded-cross-correlation' | 'manual';
    event?: string;
    maxOffsetSeconds: number;
    manualOffsetSeconds?: number;
  };
  window: readonly [number, number];
};

export type CorrelationResult = {
  score: number;
  offsetSeconds: number;
  weightedNrmse: number;
  peakError: number;
  areaError: number;
  timeToPeakError: number;
  residuals: readonly CorrelationSeries[];
  checks: readonly CorrelationCheck[];
};
```

### 7.2 Calculation rules

1. Validate channel quantity and units. A mismatch blocks the channel pair.
2. Apply event/manual offset, or search the declared bounded offset for maximum normalized cross-correlation.
3. Resample both series onto the lower source rate using linear interpolation inside their shared time domain.
4. Residual is `candidate - reference`.
5. Per-channel NRMSE is RMS residual divided by the reference range, with an epsilon floor of `1e-9`.
6. Weighted NRMSE is the weight-normalized sum of channel NRMSE values.
7. Score is `100 × (1 - min(1, weightedNrmse))`.
8. Peak error, trapezoidal integrated-area error, and time-to-peak error remain separately visible.
9. Uncertainty pass/fail is evaluated only when an imported reference supplies an uncertainty band.

Default checklist:

- time alignment;
- channel compatibility;
- finite samples;
- no saturation metadata on imported channels;
- energy trend available;
- replay hashes available for deterministic runs;
- correlation window contains at least 32 common samples;
- score calculated without extrapolation.

### 7.3 Split renderer

Refactor renderer dynamic resources into slots while sharing the GPU device, pipelines, material textures, and post process:

```ts
export type RenderSlotId = 0 | 1;

export interface ComparisonRenderer {
  upload(slot: RenderSlotId, frame: RenderFramePacket): number;
  renderViews(views: readonly {
    slot: RenderSlotId;
    rect: { x: number; y: number; width: number; height: number };
    camera: CameraRig;
  }[]): number;
}
```

Each slot owns independent instance, rope/material, surface, uniform, shadow, and cache state. Both views render into one HDR target with viewport/scissor rectangles and one final tone-map pass. Slot 0 remains the sole allocation in Structural Test and Field Modal; slot 1 is allocated lazily on entry to Correlation Review.

Recorded checkpoints render at exact stored fixed steps. Measurement cursors never interpolate numerical samples. The viewer may interpolate camera movement only.

Checkpoint defaults:

- 30 Hz for material, cloth, rope, water, and combined labs;
- 10 Hz for rigid labs;
- full checkpoint at topology changes and annotations;
- deterministic delta compression between full checkpoints;
- explicit `Nearest recorded frame` label when the scrubber is between checkpoint times.

### 7.4 Layout and behavior

Match `physics-workbench-correlation-v2.png` at 1672 × 941:

- case/run matrix and channels on the left;
- synchronized reference/candidate split viewport in the upper center;
- alignment, solver provenance, channel mapping, and correlation controls on the right;
- shared frame transport immediately below the viewport;
- force/history, normalized energy balance, and residual charts below transport;
- evidence/check summary across the bottom.

The default comparison is a deterministic baseline run versus a changed candidate of the same lab. Imported data changes the left heading from `REFERENCE` to `TEST`; it does not create a fake 3D test view. When imported data has no visual checkpoint, that pane shows the data provenance card and synchronized channel cursor instead.

## 8. Field Modal workspace

### 8.1 Analysis boundary

Field Modal is an offline reduced-order impulse analysis. It does not claim an experimental modal test or a calibrated eigenvalue solve.

Use an analysis-only carbon-fiber cantilever derived from `composite-coupon`. This derived definition does not enter `WORKBENCH_LABS`, `MATERIAL_DEMO_RECIPES`, `SCENES`, or `AAA_SHOWCASES`, so public registry counts remain unchanged.

Add a read-only instrumentation interface instead of exposing solver-private arrays:

```ts
export type ProbeDefinition = {
  id: string;
  u: number;
  v: number;
  component: 'normal' | 'x' | 'y' | 'z';
};

export interface InstrumentationProvider {
  sampleProbes(probes: readonly ProbeDefinition[], output: Float64Array): number;
  probeDomain(): {
    width: number;
    height: number;
    coordinateSystem: 'normalized';
  };
}
```

`MaterialSimulation` maps normalized coordinates to lattice nodes and measures displacement from immutable rest positions. `SoftSimulationSuite` forwards the optional interface.

### 8.2 Modal analysis request and result

```ts
export type ModalAnalysisRequest = {
  labId: 'composite-coupon';
  seed: number;
  probes: readonly ProbeDefinition[];
  impact: { u: number; v: number; strength: number };
  sampleRate: 480;
  sampleCount: 4096;
  window: 'hann';
};

export type ModalMode = {
  index: number;
  frequencySimulationHz: number;
  dampingRatio: number | null;
  coherence: number;
  normalizedShape: Float64Array;
  mac: number | null;
};

export type ModalAnalysisResult = {
  frequencies: Float64Array;
  frfMagnitude: Float64Array;
  coherence: Float64Array;
  modes: readonly ModalMode[];
  provenance: 'derived-normalized';
};
```

The analysis worker:

1. creates a fresh, undamaged deterministic cantilever clone;
2. samples 4,096 points at 480 simulation-samples/s;
3. applies one small normalized tip impulse that is preflight-limited below yield;
4. samples five virtual accelerometer/displacement probes;
5. removes mean and linear trend;
6. applies a Hann window;
7. performs an in-worker radix-2 FFT;
8. computes H1 FRF `Sxy / Sxx` and coherence `|Sxy|² / (Sxx × Syy)`;
9. peak-picks local maxima above the configurable prominence floor;
10. estimates damping from half-power bandwidth when both crossings exist;
11. normalizes mode shapes by maximum absolute probe response;
12. calculates MAC only when a previous compatible capture exists.

Nyquist is shown as 240 simulation Hz. Damping is `Unavailable` when half-power crossings are absent; it is never fabricated.

### 8.3 Field workflow

Match `physics-workbench-field-modal-v2.png` at 1024 × 1536:

- compact synchronized/status header;
- large cantilever viewport with five sensor labels, impact marker, mode overlay, legend, and orbit control;
- state, trigger, input range, averaging, and channel-health card;
- eight-item preflight/status strip;
- full-width orange `ARM ANALYSIS` and red `ABORT` controls;
- frequency-response and coherence charts;
- six-slot event/capture strip and annotation action;
- Run, Channels, Modes, and Notes bottom navigation.

Default virtual sensor positions are `u = 0.08, 0.28, 0.48, 0.68, 0.88`, all at `v = 0.5`, measuring specimen-normal response. Default impact is `u = 0.94, v = 0.5`.

Preflight blocks analysis when:

- a probe or impact lies outside the normalized specimen;
- probe IDs are duplicated;
- the analysis clone is unavailable;
- the requested impulse exceeds the configured linear-response ceiling;
- the worker or required memory is unavailable;
- parameters are non-finite;
- the browser is already running another analysis.

The capture strip holds six captures. Creating a seventh requires selecting a slot to replace; no capture is silently removed.

## 9. Visual system and responsiveness

### 9.1 Tokens

Use one restrained industrial design system:

```css
--bg: #050708;
--chrome: #080a0b;
--panel: #0c0f10;
--panel-raised: #121617;
--panel-soft: #171b1c;
--line: #282d2f;
--line-strong: #464d4f;
--text: #f3f4f2;
--muted: #a8adae;
--dim: #787e80;
--orange: #ff7900;
--cyan: #29c8ff;
--violet: #9b59ff;
--green: #68df55;
--red: #ff4053;
--yellow: #f6d64a;
```

- Inter is the interface face; IBM Plex Mono is used for values, units, hashes, timestamps, and logs.
- Use a 4 px spacing grid, 4–8 px control radii, one-pixel dividers, and restrained shadows.
- Orange is reserved for active controls, force/load, selected timeline events, and primary run actions.
- Cyan is measurement/current data; violet is candidate/modal response; green is valid/pass; red is abort/failure; yellow is warning.
- Do not use gradients as decoration, oversized marketing typography, glassmorphism, excessive pills, or rounded floating card grids.
- Use Phosphor SVG icons with adjacent text or accessible labels. Do not use Unicode glyphs as interface icons.

### 9.2 Breakpoints

- `>= 1280 px`: full three-column Structural and Correlation layouts.
- `1041–1279 px`: library rail collapses to a 56 px icon rail; inspector remains 320 px.
- `761–1040 px`: one primary viewport column; library and inspector become modal side sheets; Field Modal uses its portrait composition.
- `<= 760 px`: phone control mode with viewport, transport, one chart at a time, and bottom navigation. Correlation uses stacked reference/candidate panes.
- Minimum interactive target is 44 × 44 CSS px.
- Respect safe-area insets and `prefers-reduced-motion`.

Panel scroll positions are independent. The WebGPU canvas never scrolls inside a panel and must resize through `ResizeObserver`, not polling.

## 10. Failure and recovery behavior

- WebGPU initialization remains terminal for the live viewport; the shell shows actionable diagnostics and still permits opening saved evidence metadata.
- Box3D WASM load failure uses the existing deterministic fallback and records the fallback backend in the run.
- Soft-kernel WASM failure follows SIMD → scalar → JavaScript fallback and records the selected path.
- Worker failure cancels the active analysis, preserves the source runs, and offers retry.
- Invalid/corrupt import is rejected before persistence with field-specific errors.
- IndexedDB or quota failure switches new work to session-only mode; existing stored records are not deleted.
- Device loss pauses the active run, finalizes a recoverable partial record, and asks the user to reload the renderer.
- Visibility loss does not advance wall-clock simulation time; fixed-step replay remains deterministic.

## 11. Milestones and acceptance gates

### Milestone 0 — Baseline and guardrails

Deliverables:

- document current registry counts, representative replay hashes, build output, and renderer budgets;
- add no visual behavior yet;
- preserve all current dirty-worktree changes.

Gate:

- typecheck passes;
- existing 33 unit suites pass;
- 31/800/65 counts and representative material hashes are frozen in tests;
- current WebGPU renderer runtime test passes;
- any known local clang linker failure remains separately documented and is not misreported as a TypeScript failure.

### Milestone 1 — Runtime extraction

Deliverables:

- extract store, coordinator, commands, charts, and UI modules;
- split CSS from `index.html`;
- retain the current single Lab workspace behavior.

Gate:

- `main.ts` contains bootstrap and frame orchestration only;
- existing lab selection, camera, forces, material actions, showcase playback, capture, telemetry, and validation behave identically;
- replay hashes remain unchanged for frozen schedules;
- single-slot renderer upload and frame timings regress by no more than 5% in the existing benchmark.

### Milestone 2 — Sessions, provenance, and recording

Deliverables:

- implement lifecycle, preflight, command log, channels, run recorder, IndexedDB, import/export, and archive management;
- route existing controls through the dispatcher.

Gate:

- transition table and invalid-command tests pass;
- every visible measurement exposes provenance and unit;
- deterministic `box3d-run@1` round trip passes;
- quota limits and session-only fallback are exercised;
- no failed command partially changes solver, timeline, or recorder state.

### Milestone 3 — Structural Test quality pass

Deliverables:

- build the structural reference layout and responsive variants;
- connect experiment tree, sensors, limits, timeline, charts, revisions, logs, before/after, and transport.

Gate:

- all 31 labs load and expose only supported controls;
- complete arm/run/pause/step/resume/abort/reset/replay flows pass;
- keyboard-only and touch flows pass;
- exact Structural QA fixture passes the visual gate in Section 12.

### Milestone 4 — Analysis infrastructure

Deliverables:

- analysis worker, correlation math, TurboQuant checkpoint recording, and evidence results;
- unit-tested FFT and signal helpers.

Gate:

- worker output is deterministic;
- telemetry remains full precision;
- synthetic correlation and frequency-domain golden tests pass;
- capture/analysis creates no UI-thread task longer than 50 ms.

### Milestone 5 — Dual-slot renderer and Correlation Review

Deliverables:

- lazy slot 1 allocation, shared HDR composition, synchronized checkpoint scrubber, correlation controls, checks, metrics, and export.

Gate:

- slot data, shadows, surfaces, and caches cannot contaminate the other slot;
- single-slot rendered hashes/screenshots remain unchanged within accepted antialiasing tolerance;
- comparison respects archive caps and exact checkpoint labels;
- imported data without visual evidence never displays a fabricated test image;
- exact Correlation QA fixture passes Section 12.

### Milestone 6 — Field Modal

Deliverables:

- analysis-only cantilever, instrumentation provider, worker analysis, sensors, charts, modes, six-slot captures, annotations, and portrait navigation.

Gate:

- FFT-bin, FRF, coherence, damping, shape normalization, and MAC tests pass;
- analysis cannot mutate the active Structural Test run;
- all modal values use simulation-time/normalized labels;
- exact Field Modal QA fixture passes Section 12.

### Milestone 7 — Release hardening

Deliverables:

- accessibility, device-loss recovery, import fuzz cases, memory cleanup, documentation, final design QA, and source manifest regeneration.

Gate:

- `npm run typecheck`, unit tests, self-test, C bridge, soft-kernel numerical tests, WebGPU tests, build, and Pages build pass where the local toolchain is available;
- all three fixtures have zero P0, P1, or P2 design defects;
- no console error, uncaptured WebGPU validation error, unhandled rejection, or accessibility blocker remains;
- `SOURCE_MANIFEST.sha256` is regenerated once, after all tracked files are final, and verifies cleanly.

## 12. Exact visual QA fixtures

The generated references are immutable fixtures. Test captures must use the exact viewport, device scale factor 1, reduced motion, hidden browser chrome, and the stated deterministic state. A fixture helper may accelerate simulation offscreen, but it must produce the same solver state as replaying the listed fixed steps and commands.

### QA-STRUCTURAL-1672

- Reference: `public/concepts/physics-workbench-structural-v2.png`
- Capture viewport: `1672 × 941`
- Workspace: `structural-test`
- Lab: `titan-bend-dent`
- Seed: `0x53545231`
- Stress: `5`
- Solver substeps: `4`
- Time scale: `1`
- Render quality: `cinematic`
- Force target: `u=0.50, v=0.50`
- Force strength/radius: `1.00 / 1.00`
- Actuator target: `0.82`
- State sequence:
  1. load lab and pass preflight;
  2. arm and run;
  3. set actuator target at fixed step 60;
  4. apply point force at fixed step 360;
  5. pause after fixed step 748;
  6. select `Strain` overlay and open Load Case inspector.
- Required visible state: experiment tree, at least three real channels, revision list, central deformed specimen, force marker, strain legend, timeline markers, force/deflection and energy charts, simulation limits, paused transport, deterministic hash, solver/fidelity status.

### QA-CORRELATION-1672

- Reference: `public/concepts/physics-workbench-correlation-v2.png`
- Capture viewport: `1672 × 941`
- Workspace: `correlation-review`
- Lab: `titan-bend-dent`
- Reference run: QA-STRUCTURAL configuration with actuator `0.82` and strike `1.00`
- Candidate run: same seed/schedule with actuator `0.90` and strike `1.10`
- Alignment: event-trigger on `point-force`, maximum offset `0.25 s`
- Selected channel: normalized load/force signal
- Selected checkpoint: fixed step `360`
- Viewer labels: `REFERENCE` and `CANDIDATE`
- Required visible state: run matrix, channel list, event bookmarks, synchronized split viewport, shared frame cursor, force history, normalized energy balance, residual chart, alignment/solver/provenance controls, checklist, score with formula tooltip, evidence export, and deterministic replay action.
- The score is whatever the real calculation returns; the fixture must not hard-code the mockup's 94.7%.

### QA-FIELD-MODAL-1024

- Reference: `public/concepts/physics-workbench-field-modal-v2.png`
- Capture viewport: `1024 × 1536`
- Workspace: `field-modal`
- Analysis definition: analysis-only `composite-coupon` cantilever
- Seed: `0x4d4f4441`
- Sample rate/count: `480 / 4096`
- Probes: `(0.08,0.50)`, `(0.28,0.50)`, `(0.48,0.50)`, `(0.68,0.50)`, `(0.88,0.50)`
- Impact: `(0.94,0.50)`, linear-response strength ceiling
- Window: Hann
- State sequence:
  1. complete three deterministic captures;
  2. select the first extracted mode;
  3. reset into `armed` state while retaining the most recent analysis result;
  4. prepare capture slot 4.
- Required visible state: cantilever, five sensors, impact marker, mode-shape overlay, simulation-frequency/damping values, sensor-quality result, armed state, five healthy channels, preflight strip, ARM and ABORT actions, frequency response, coherence, three completed captures, armed fourth capture, annotation action, and four-item bottom navigation.
- Frequencies and damping are real worker results and must not copy the mockup's 128.7 Hz or 0.52%.

### QA severity and comparison method

- **P0:** missing workspace, broken renderer, unusable primary flow, false engineering claim, or data shown with incorrect provenance.
- **P1:** major layout/hierarchy mismatch, clipped primary control/chart, wrong fixture state, unreadable viewport, or inaccessible primary action.
- **P2:** incorrect spacing/color/type/icon treatment, inconsistent chart encoding, responsive overflow, or noticeable reference-quality regression.
- **P3:** minor polish issue that does not reduce understanding or control.

For each fixture:

1. capture the exact state and viewport;
2. compare side-by-side and at 50% overlay against the reference;
3. record findings in `design-qa.md` with fixture, severity, evidence, and resolution;
4. fix and recapture every P0, P1, and P2;
5. retain final captures as acceptance artifacts.

The reference's photographic machinery and exact specimen are inspirational; acceptance compares information hierarchy, density, proportions, visual discipline, interaction state, and production quality. It does not require copying false physical values or replacing the live renderer with an image.

## 13. Test matrix

### Unit

- lifecycle transitions and stale-preflight rules;
- capability and parameter validation;
- command atomicity and event ordering;
- telemetry channel creation, omission, ring capacity, and decimation;
- archive estimate, cap enforcement, serialization, digest, and import rejection;
- correlation alignment, interpolation, residuals, score, peaks, area, and time-to-peak;
- FFT known bins, Hann window, FRF, coherence, half-power damping, normalized shapes, and MAC;
- probe-coordinate mapping and out-of-range handling;
- modal clone isolation;
- all existing registry, solver, material, deterministic, and numerical tests.

### Integration

- every lab completes load/preflight/arm/run/pause/reset;
- every declared action reaches its solver and creates one event;
- deterministic replay recreates representative final hashes;
- archive survives reload and session-only fallback;
- baseline/candidate creation, alignment, scrub, and export;
- imported reference with compatible/incompatible units;
- modal preflight, capture, abort, mode select, replace-slot confirmation, and annotation;
- device loss, worker crash, storage quota, corrupt file, and visibility change.

### Renderer and performance

- single- and dual-slot WebGPU creation/submission;
- independent rigid, soft, rope/material, surface, effect, line, uniform, shadow, and cache data;
- no extra upload for unchanged frames in either slot;
- lazy slot destruction releases GPU resources when leaving correlation;
- no more than 5% regression in existing single-view benchmark after extraction;
- no more than 10% regression in Structural Test after full telemetry recording;
- analysis stays in the worker and UI has no task over 50 ms during active capture;
- archive memory never exceeds declared cap.

### Accessibility

- semantic landmarks and headings;
- tab and arrow-key behavior for tablists;
- visible focus and logical focus order;
- 44 px targets and touch-safe drawers;
- live regions that do not announce every frame;
- non-color status labels and chart legends;
- reduced-motion behavior;
- forced-colors usability;
- screen-reader labels for canvas summaries and every icon-only action.

## 14. Completion definition

Workbench V2 is complete only when all three workspaces are functional, the 31 simulations and existing deterministic contracts remain intact, built-in data is truthfully labeled, records can be replayed and exported, correlation and modal values come from tested calculations, the three exact QA fixtures pass with no P0/P1/P2 findings, and the full locally available validation suite succeeds.
