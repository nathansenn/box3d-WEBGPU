import './physics-structural.css';

import type {
  EngineeringAssemblyComponent,
  EngineeringComponentKind,
  EngineeringModelManifest,
} from '../workbench/engineering-model';
import { getEngineeringModelForLab } from '../workbench/engineering-model';
import type {
  ChannelDescriptorV1,
  DataProvenance,
  MeasurementQuantity,
} from '../workbench/engineering-evidence';
import type {
  EngineeringPreflightCheck,
  EngineeringRunEvent,
  EngineeringRunEventKind,
  EngineeringRunSnapshot,
  EngineeringRunState,
  EngineeringSample,
  EvidenceSource,
} from '../workbench/engineering-session';
import {
  WORKBENCH_GROUP_LABELS,
  WORKBENCH_LABS,
  WORKBENCH_SOLVER_LABELS,
  getWorkbenchLab,
  type WorkbenchForceMode,
  type WorkbenchGroup,
  type WorkbenchLabDefinition,
  type WorkbenchParameterId,
} from '../workbench/registry';

export const PHYSICS_STRUCTURAL_DISCLOSURE =
  'Deterministic reduced-order simulation for comparative testing and workflow prototyping. Values are not certified engineering predictions.';

export const PHYSICS_STRUCTURAL_PRIMARY_ACTIONS = ['run', 'pause', 'reset'] as const;
export type PhysicsStructuralPrimaryAction = (typeof PHYSICS_STRUCTURAL_PRIMARY_ACTIONS)[number];

export const PHYSICS_STRUCTURAL_HINT_STEPS = [
  'Pick a specimen',
  'Set the normalized load',
  'Click Run, or watch autoplay',
] as const;

export const PHYSICS_STRUCTURAL_HINT_COPY = '1 Pick a specimen. 2 Set the normalized load. 3 Click Run, or watch autoplay.';

const STRUCTURAL_EMPTY_LOG = 'Click Run to start. Results show in the viewport and the charts.';

export const PHYSICS_STRUCTURAL_CHART_IDS = ['force-deflection', 'energy'] as const;
export type PhysicsStructuralChartId = (typeof PHYSICS_STRUCTURAL_CHART_IDS)[number];

export const PHYSICS_STRUCTURAL_OVERLAYS = ['none', 'strain', 'deflection', 'damage'] as const;
export type PhysicsStructuralOverlayId = (typeof PHYSICS_STRUCTURAL_OVERLAYS)[number];

export const PHYSICS_STRUCTURAL_INSPECTOR_TABS = ['load-case', 'material', 'solver'] as const;
export type PhysicsStructuralInspectorTab = (typeof PHYSICS_STRUCTURAL_INSPECTOR_TABS)[number];

export const PHYSICS_STRUCTURAL_VIEWPORT_TOOLS = ['select', 'orbit', 'pan', 'zoom', 'mesh'] as const;
export type PhysicsStructuralViewportTool = (typeof PHYSICS_STRUCTURAL_VIEWPORT_TOOLS)[number];

export const PHYSICS_STRUCTURAL_COMPARE_MODES = ['before', 'after'] as const;
export type PhysicsStructuralCompareMode = (typeof PHYSICS_STRUCTURAL_COMPARE_MODES)[number];

export const PHYSICS_STRUCTURAL_RUN_COMMANDS = [
  'preflight',
  'arm',
  'run',
  'pause',
  'resume',
  'step',
  'reset',
  'abort',
  'replay',
] as const;
export type PhysicsStructuralRunCommand = (typeof PHYSICS_STRUCTURAL_RUN_COMMANDS)[number];

export const PHYSICS_STRUCTURAL_REGIONS = {
  header: {
    mockup: 'Top chrome: PHYSICS TESTING WORKBENCH, twin label, mode badge, deterministic/seed/solver/fidelity/hash',
    selector: '.phys-str-header',
    size: '55px × 1672px',
  },
  experimentRail: {
    mockup: 'Left EXPERIMENT tree, SENSOR CHANNELS table, REVISION HISTORY, undo/redo + state selector',
    selector: '.phys-str-rail',
    size: '272px wide',
  },
  viewport: {
    mockup: 'Center 3D cell with load-target callout, sensor labels, strain legend, XYZ gizmo, overlay toolbar, BEFORE/AFTER',
    selector: '.phys-str-viewport',
    size: 'upper center column; live WebGPU slot',
  },
  timeline: {
    mockup: 'Time/step readout, event markers, play/skip/speed',
    selector: '.phys-str-timeline',
    size: '52px',
  },
  charts: {
    mockup: 'LOAD vs DEFLECTION and NORMALIZED ENERGY (command vs solver; not physical kN/J)',
    selector: '.phys-str-charts',
    size: '168px',
  },
  inspector: {
    mockup: 'LOAD CASE / MATERIAL / SOLVER tabs, simulation limits, envelope card, 3-step hint, RUN/PAUSE/RESET, run log',
    selector: '.phys-str-inspector',
    size: '336px wide',
  },
  footer: {
    mockup: 'Specimen/authored dimensions/solver-native counts/channel count + systems status',
    selector: '.phys-str-footer',
    size: '28px',
  },
} as const;

const CHART_COLORS = ['#29c8ff', '#ff7900', '#9b59ff', '#68df55', '#f3f4f2'] as const;

export type PhysicsStructuralChannelStatus = 'nominal' | 'warning' | 'fault' | 'offline';

export type PhysicsStructuralChannel = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number | string;
  readonly quantity?: MeasurementQuantity;
  readonly provenance?: DataProvenance | EvidenceSource;
  readonly status?: PhysicsStructuralChannelStatus;
  readonly enabled?: boolean;
};

export type PhysicsStructuralRevision = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly timestamp?: string;
  readonly immutable: boolean;
  readonly active?: boolean;
};

export type PhysicsStructuralLogEntry = {
  readonly time: number;
  readonly step: number;
  readonly message: string;
  readonly severity?: EngineeringRunEvent['severity'];
};

export type PhysicsStructuralLimits = {
  readonly maxLoadProgress: number;
  readonly maxNormalizedStrain: number;
  readonly maxBreakCount: number;
  readonly maxDurationSeconds: number;
  readonly abortOnLimit: boolean;
};

export type PhysicsStructuralPredicted = {
  readonly load: number;
  readonly strain: number;
  readonly breaks: number;
  readonly durationSeconds: number;
  readonly withinLimits: boolean;
};

export type PhysicsStructuralChartSeries = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly color?: string;
  readonly dashed?: boolean;
};

export type PhysicsStructuralChartUpdate = {
  readonly x?: readonly number[];
  readonly series: readonly PhysicsStructuralChartSeries[];
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly cursorX?: number;
  readonly xDomain?: readonly [number, number];
  readonly yDomain?: readonly [number, number];
};

export type PhysicsStructuralCallout = {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly xPercent: number;
  readonly yPercent: number;
  readonly tone?: 'load' | 'sensor' | 'note';
};

export type PhysicsStructuralRuntimeCounts = {
  readonly bodies?: number;
  readonly nodes?: number;
  readonly constraints?: number;
  readonly breaks?: number;
  readonly hash?: number;
};

export type PhysicsStructuralCallbacks = {
  readonly onRunCommand?: (command: PhysicsStructuralRunCommand) => void | Promise<void>;
  readonly onLabSelect?: (labId: string) => void;
  readonly onComponentSelect?: (component: EngineeringAssemblyComponent | null) => void;
  readonly onParameterChange?: (id: WorkbenchParameterId, value: number) => void;
  readonly onOverlayChange?: (overlay: PhysicsStructuralOverlayId) => void;
  readonly onCompareModeChange?: (mode: PhysicsStructuralCompareMode) => void;
  readonly onTimelineSeek?: (step: number) => void;
  readonly onChannelZero?: () => void;
  readonly onRevisionSelect?: (revisionId: string) => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onViewportTool?: (tool: PhysicsStructuralViewportTool) => void;
  readonly onInspectorTab?: (tab: PhysicsStructuralInspectorTab) => void;
  readonly onLimitChange?: (limits: PhysicsStructuralLimits) => void;
  readonly onForceTarget?: (u: number, v: number) => void;
  readonly onSubstepsChange?: (substeps: 1 | 2 | 4 | 8) => void;
  readonly onTimeScaleChange?: (scale: 0.25 | 0.5 | 1 | 2) => void;
};

export type PhysicsStructuralOptions = {
  readonly mount: HTMLElement;
  readonly viewport?: HTMLElement;
  readonly idPrefix?: string;
  readonly labs?: readonly WorkbenchLabDefinition[];
  readonly initialLabId?: string;
  readonly callbacks?: PhysicsStructuralCallbacks;
};

export type PhysicsStructuralController = {
  readonly root: HTMLElement;
  attachViewport(viewport: HTMLElement): void;
  updateModel(manifest: EngineeringModelManifest): void;
  updateLab(lab: WorkbenchLabDefinition, parameters?: Readonly<Record<string, number>>): void;
  updateRun(snapshot: EngineeringRunSnapshot): void;
  updateTelemetry(sample: Partial<EngineeringSample> & { readonly time?: number; readonly step?: number }): void;
  updatePreflight(checks: readonly EngineeringPreflightCheck[]): void;
  updateChannels(channels: readonly PhysicsStructuralChannel[] | readonly ChannelDescriptorV1[], values?: Readonly<Record<string, number | string>>): void;
  updateRevisions(revisions: readonly PhysicsStructuralRevision[], activeId?: string): void;
  updateChart(chart: PhysicsStructuralChartId, update: PhysicsStructuralChartUpdate): void;
  updateLimits(limits: Partial<PhysicsStructuralLimits>, predicted?: Partial<PhysicsStructuralPredicted>): void;
  updateLog(entries: readonly PhysicsStructuralLogEntry[]): void;
  appendLog(entry: PhysicsStructuralLogEntry): void;
  updateRuntimeCounts(counts: PhysicsStructuralRuntimeCounts): void;
  setOverlay(overlay: PhysicsStructuralOverlayId): void;
  setCompareMode(mode: PhysicsStructuralCompareMode): void;
  setInspectorTab(tab: PhysicsStructuralInspectorTab): void;
  selectComponent(componentId: string | null): void;
  setForceTarget(u: number, v: number, label?: string): void;
  setCallouts(callouts: readonly PhysicsStructuralCallout[]): void;
  setStatus(message: string, tone?: 'nominal' | 'warning' | 'danger'): void;
  setBackend(label: string, deterministic?: boolean): void;
  setParameters(values: Readonly<Record<string, number>>): void;
  setSubsteps(substeps: 1 | 2 | 4 | 8): void;
  destroy(): void;
};

const DEFAULT_LIMITS: PhysicsStructuralLimits = Object.freeze({
  maxLoadProgress: 1.25,
  maxNormalizedStrain: 1,
  maxBreakCount: 10_000,
  maxDurationSeconds: 30,
  abortOnLimit: false,
});

function assertNever(value: never, label: string): never {
  throw new Error(`Unhandled ${label}: ${String(value)}`);
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Physics structural element not found: ${selector}`);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatFixed(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(precision);
}

function formatChannelValue(value: number | string, unit?: string): string {
  if (typeof value !== 'number') return unit ? `${value} ${unit}` : value;
  const magnitude = Math.abs(value);
  const precision = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : magnitude >= 1 ? 3 : 4;
  const formatted = value.toFixed(precision).replace(/\.?0+$/u, '');
  return unit ? `${formatted} ${unit}` : formatted;
}

function runStateLabel(state: EngineeringRunState): string {
  switch (state) {
    case 'draft': return 'DRAFT';
    case 'preflight': return 'PREFLIGHT';
    case 'armed': return 'ARMED';
    case 'running': return 'RUNNING';
    case 'paused': return 'PAUSED';
    case 'complete': return 'COMPLETE';
    case 'aborted': return 'ABORTED';
    default: return assertNever(state, 'run state');
  }
}

function forceModeLabel(mode: WorkbenchForceMode): string {
  switch (mode) {
    case 'actuator-load': return 'Normalized actuator';
    case 'release-load': return 'Release load';
    case 'cycle-load': return 'Cycle load';
    case 'material-strike': return 'Point strike';
    case 'broad-impulse': return 'Broad impulse';
    case 'radial-blast': return 'Radial blast';
    case 'projectile': return 'Projectile';
    case 'impact-rain': return 'Impact rain';
    default: return assertNever(mode, 'force mode');
  }
}

function componentIcon(kind: EngineeringComponentKind): string {
  switch (kind) {
    case 'assembly': return 'ph-tree-structure';
    case 'specimen': return 'ph-square-half';
    case 'fixture': return 'ph-anchor';
    case 'load-train': return 'ph-arrow-fat-down';
    case 'instrumentation': return 'ph-broadcast';
    case 'environment': return 'ph-warehouse';
    case 'effect': return 'ph-sparkle';
    default: return assertNever(kind, 'component kind');
  }
}

function overlayLabel(overlay: PhysicsStructuralOverlayId): string {
  switch (overlay) {
    case 'none': return 'None';
    case 'strain': return 'Normalized strain';
    case 'deflection': return 'Deflection';
    case 'damage': return 'Damage';
    default: return assertNever(overlay, 'overlay');
  }
}

function eventKindLabel(kind: EngineeringRunEventKind): string {
  switch (kind) {
    case 'preflight': return 'Preflight';
    case 'armed': return 'Armed';
    case 'load-step': return 'Load step';
    case 'hold': return 'Hold';
    case 'impact': return 'Impact';
    case 'limit-warning': return 'Limit warning';
    case 'bookmark': return 'Bookmark';
    case 'complete': return 'Complete';
    case 'abort': return 'Abort';
    default: return assertNever(kind, 'event kind');
  }
}

function checkIcon(status: EngineeringPreflightCheck['status']): string {
  switch (status) {
    case 'pass': return 'ph-check-circle';
    case 'warning': return 'ph-warning';
    case 'fail': return 'ph-x-circle';
    default: return assertNever(status, 'preflight status');
  }
}

function isChartId(value: string): value is PhysicsStructuralChartId {
  return (PHYSICS_STRUCTURAL_CHART_IDS as readonly string[]).includes(value);
}

function isOverlay(value: string): value is PhysicsStructuralOverlayId {
  return (PHYSICS_STRUCTURAL_OVERLAYS as readonly string[]).includes(value);
}

function isInspectorTab(value: string): value is PhysicsStructuralInspectorTab {
  return (PHYSICS_STRUCTURAL_INSPECTOR_TABS as readonly string[]).includes(value);
}

function isViewportTool(value: string): value is PhysicsStructuralViewportTool {
  return (PHYSICS_STRUCTURAL_VIEWPORT_TOOLS as readonly string[]).includes(value);
}

function isRunCommand(value: string): value is PhysicsStructuralRunCommand {
  return (PHYSICS_STRUCTURAL_RUN_COMMANDS as readonly string[]).includes(value);
}

function isTimeScale(value: number): value is 0.25 | 0.5 | 1 | 2 {
  return value === 0.25 || value === 0.5 || value === 1 || value === 2;
}

function isSubsteps(value: number): value is 1 | 2 | 4 | 8 {
  return value === 1 || value === 2 || value === 4 || value === 8;
}

function channelsFromSample(sample: EngineeringSample): PhysicsStructuralChannel[] {
  return [
    { id: 'load', label: 'Load command', unit: 'normalized', value: sample.load, quantity: 'load', provenance: 'solver-native', status: 'nominal' },
    { id: 'response', label: 'Deflection', unit: 'sim units', value: sample.response, quantity: 'displacement', provenance: 'derived', status: 'nominal' },
    { id: 'energy', label: 'Energy proxy', unit: 'normalized', value: sample.energy, quantity: 'energy', provenance: 'derived', status: 'nominal' },
    { id: 'damage', label: 'Peak strain', unit: 'normalized', value: sample.damage, quantity: 'strain', provenance: 'derived', status: 'nominal' },
    { id: 'breaks', label: 'Broken constraints', unit: 'count', value: sample.brokenCount, quantity: 'count', provenance: 'solver-native', status: 'nominal' },
  ];
}

function chartsFromSamples(samples: readonly EngineeringSample[]): Readonly<Record<PhysicsStructuralChartId, PhysicsStructuralChartUpdate>> {
  const response = samples.map((sample) => sample.response);
  const load = samples.map((sample) => sample.load);
  const energy = samples.map((sample) => sample.energy);
  const time = samples.map((sample) => sample.time);
  return {
    'force-deflection': {
      x: response,
      series: [{ id: 'solver', label: 'Solver', values: load, color: CHART_COLORS[0] }],
      xLabel: 'deflection (sim units)',
      yLabel: 'load (normalized)',
      cursorX: response.at(-1),
    },
    energy: {
      x: time,
      series: [{ id: 'solver', label: 'Solver', values: energy, color: CHART_COLORS[0] }],
      xLabel: 'model time (s)',
      yLabel: 'normalized energy',
      cursorX: time.at(-1),
    },
  };
}

function emptyCharts(): Readonly<Record<PhysicsStructuralChartId, PhysicsStructuralChartUpdate>> {
  return {
    'force-deflection': {
      x: [],
      series: [{ id: 'solver', label: 'Solver', values: [], color: CHART_COLORS[0] }],
      xLabel: 'deflection (sim units)',
      yLabel: 'load (normalized)',
    },
    energy: {
      x: [],
      series: [{ id: 'solver', label: 'Solver', values: [], color: CHART_COLORS[0] }],
      xLabel: 'model time (s)',
      yLabel: 'normalized energy',
    },
  };
}

function gizmoMarkup(): string {
  return `
    <svg class="phys-str-gizmo" viewBox="0 0 56 56" aria-hidden="true">
      <line x1="18" y1="38" x2="48" y2="38" stroke="#ff4053" stroke-width="2" />
      <line x1="18" y1="38" x2="18" y2="8" stroke="#68df55" stroke-width="2" />
      <line x1="18" y1="38" x2="6" y2="50" stroke="#29c8ff" stroke-width="2" />
      <text x="50" y="36" fill="#ff4053" font-size="8" font-family="IBM Plex Mono, monospace">X</text>
      <text x="20" y="10" fill="#68df55" font-size="8" font-family="IBM Plex Mono, monospace">Y</text>
      <text x="2" y="54" fill="#29c8ff" font-size="8" font-family="IBM Plex Mono, monospace">Z</text>
    </svg>
  `;
}

function shellMarkup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  return `
    <header class="phys-str-header" aria-label="Structural test status">
        <div class="phys-str-brand">
        <h1 class="phys-str-title">PHYSICS TESTING WORKBENCH</h1>
        <span class="phys-str-twin" data-phys-str-twin>BEND &amp; DENT</span>
      </div>
      <div class="phys-str-identity">
        <span class="phys-str-badge" data-phys-str-mode title="${PHYSICS_STRUCTURAL_DISCLOSURE}">
          <i class="ph ph-seal-check" aria-hidden="true"></i> REDUCED MODEL
        </span>
        <button class="phys-str-icon phys-str-sheet-toggle" type="button" data-phys-str-action="toggle-rail" aria-label="Open experiment rail">
          <i class="ph ph-tree-structure" aria-hidden="true"></i>
        </button>
        <button class="phys-str-icon phys-str-sheet-toggle" type="button" data-phys-str-action="toggle-inspector" aria-label="Open inspector">
          <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>
        </button>
      </div>
      <div class="phys-str-meta" aria-label="Solver provenance">
        <span><span class="phys-str-dot" data-phys-str-backend-dot></span><strong data-phys-str-backend>DETERMINISTIC</strong></span>
        <span>Seed: <strong data-phys-str-seed>—</strong></span>
        <span>Solver: <strong data-phys-str-solver>—</strong></span>
        <span>Fidelity: <strong data-phys-str-fidelity>Reduced numerical model</strong></span>
        <span>Hash: <strong data-phys-str-hash>—</strong></span>
      </div>
    </header>

    <div class="phys-str-body">
      <aside class="phys-str-rail" aria-label="Experiment, channels, and revisions">
        <nav class="phys-str-icon-rail" aria-label="Experiment rail shortcuts">
          <button type="button" data-phys-str-action="toggle-labs" aria-label="Browse labs"><i class="ph ph-grid-four" aria-hidden="true"></i></button>
          <button class="is-active" type="button" data-phys-str-action="focus-tree" aria-label="Experiment tree"><i class="ph ph-tree-structure" aria-hidden="true"></i></button>
          <button type="button" data-phys-str-action="focus-channels" aria-label="Sensor channels"><i class="ph ph-broadcast" aria-hidden="true"></i></button>
          <button type="button" data-phys-str-action="focus-revisions" aria-label="Revision history"><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i></button>
        </nav>

        <section class="phys-str-section" data-phys-str-panel="experiment">
          <header>
            <h2>Experiment</h2>
            <button class="phys-str-icon" type="button" data-phys-str-action="toggle-labs" aria-label="Browse 35 labs" title="Pick a different specimen">
              <i class="ph ph-grid-four" aria-hidden="true"></i>
            </button>
          </header>
          <div class="phys-str-tree" data-phys-str-tree role="tree" aria-label="Experiment assembly tree"></div>
        </section>

        <section class="phys-str-section" data-phys-str-panel="channels">
          <header>
            <h2>Sensor channels</h2>
            <span data-phys-str-channel-count>0 DERIVED</span>
          </header>
          <div class="phys-str-channel-wrap">
            <table class="phys-str-channel-table">
              <thead><tr><th>Name</th><th>Unit</th><th>Value</th></tr></thead>
              <tbody data-phys-str-channels></tbody>
            </table>
            <button class="phys-str-zero" type="button" data-phys-str-action="zero-channels" title="Clears derived display offsets only. No physical DAQ is connected.">ZERO DERIVED OFFSETS</button>
          </div>
        </section>

        <section class="phys-str-section" data-phys-str-panel="revisions">
          <header>
            <h2>Revision history</h2>
            <small>SESSION</small>
          </header>
          <div class="phys-str-revisions" data-phys-str-revisions></div>
        </section>

        <footer class="phys-str-rail-footer">
          <button class="phys-str-icon" type="button" data-phys-str-action="undo" aria-label="Undo draft configuration"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i></button>
          <button class="phys-str-icon" type="button" data-phys-str-action="redo" aria-label="Redo draft configuration"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i></button>
          <label class="phys-str-sr" for="${id('revision-select')}">Active revision</label>
          <select id="${id('revision-select')}" data-phys-str-revision-select></select>
        </footer>
      </aside>

      <div class="phys-str-lab-menu" data-phys-str-lab-menu hidden>
        <header>
          <h2 class="phys-str-sr">Laboratory catalog</h2>
          <label class="phys-str-sr" for="${id('lab-search')}">Search labs</label>
          <input id="${id('lab-search')}" type="search" placeholder="Search 35 labs…" data-phys-str-lab-search autocomplete="off">
        </header>
        <div data-phys-str-lab-list></div>
      </div>

      <main class="phys-str-center">
        <section class="phys-str-viewport" aria-label="Live structural viewport">
          <div class="phys-str-viewport-slot" data-phys-str-viewport-slot>
            <div class="phys-str-viewport-empty"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU viewport</span></div>
          </div>
          <div class="phys-str-toolbar" aria-label="Viewport tools">
            <button class="phys-str-icon is-active" type="button" data-phys-str-tool="orbit" aria-pressed="true" aria-label="Orbit"><i class="ph ph-cube-focus" aria-hidden="true"></i></button>
            <span class="phys-str-tool-hint">Orbit · drag to rotate</span>
            <button class="phys-str-icon is-unavailable" type="button" data-phys-str-tool="select" aria-pressed="false" aria-label="Select" disabled title="Select is not available in this build."><i class="ph ph-cursor" aria-hidden="true"></i></button>
            <button class="phys-str-icon is-unavailable" type="button" data-phys-str-tool="pan" aria-pressed="false" aria-label="Pan" disabled title="Pan is not available. Drag to orbit, scroll to zoom."><i class="ph ph-hand" aria-hidden="true"></i></button>
            <button class="phys-str-icon is-unavailable" type="button" data-phys-str-tool="zoom" aria-pressed="false" aria-label="Zoom" disabled title="Use the mouse wheel to zoom."><i class="ph ph-magnifying-glass" aria-hidden="true"></i></button>
            <button class="phys-str-icon is-unavailable" type="button" data-phys-str-tool="mesh" aria-pressed="false" aria-label="Toggle mesh visibility" disabled title="Mesh overlay is not available in this build."><i class="ph ph-grid-four" aria-hidden="true"></i></button>
            <div class="phys-str-overlay-select">
              <label for="${id('overlay')}">Overlay</label>
              <select id="${id('overlay')}" data-phys-str-overlay>
                <option value="strain" selected>Normalized strain</option>
                <option value="deflection">Deflection</option>
                <option value="damage">Damage</option>
                <option value="none">None</option>
              </select>
            </div>
            <div class="phys-str-compare" role="group" aria-label="Before after compare">
              <button type="button" data-phys-str-compare="before" aria-pressed="false" disabled title="Before/after compare is not available until a stored checkpoint exists.">BEFORE</button>
              <button class="is-active" type="button" data-phys-str-compare="after" aria-pressed="true" disabled title="Live view is always the current model.">AFTER</button>
            </div>
          </div>
          <div class="phys-str-load-arrow" data-phys-str-load-arrow style="left:50%;top:28%">
            <strong data-phys-str-load-label>LOAD TARGET 0.80 normalized</strong>
            <i class="ph ph-arrow-fat-down" aria-hidden="true"></i>
          </div>
          <div data-phys-str-callouts></div>
          <div class="phys-str-legend" data-phys-str-legend>
            <strong data-phys-str-legend-title>NORMALIZED STRAIN</strong>
            <span>1.0</span>
            <div class="phys-str-legend-bar" aria-hidden="true"></div>
            <span>0</span>
          </div>
          ${gizmoMarkup()}
          <span class="phys-str-provenance" data-phys-str-provenance>PRESENTATION DIAGNOSTIC</span>
        </section>

        <section class="phys-str-timeline" aria-label="Run timeline">
          <div class="phys-str-clock">
            <strong>Time: <span data-phys-str-time>0.000</span> s</strong>
            <span>Step: <span data-phys-str-step>0</span></span>
          </div>
          <div class="phys-str-track">
            <div class="phys-str-markers" data-phys-str-markers></div>
            <label class="phys-str-sr" for="${id('timeline')}">Timeline step</label>
            <input id="${id('timeline')}" type="range" min="0" max="1800" value="0" data-phys-str-timeline>
          </div>
          <div class="phys-str-transport">
            <button type="button" data-phys-str-action="run" aria-label="Play or pause"><i class="ph ph-play" data-phys-str-play-icon aria-hidden="true"></i></button>
            <button type="button" data-phys-str-action="step" aria-label="Step one fixed interval"><i class="ph ph-caret-right" aria-hidden="true"></i></button>
            <label class="phys-str-sr" for="${id('speed')}">Playback speed</label>
            <select id="${id('speed')}" class="phys-str-speed" data-phys-str-speed>
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1.0×</option>
              <option value="2">2.0×</option>
            </select>
          </div>
        </section>

        <section class="phys-str-charts" aria-label="Structural analysis charts">
          <article class="phys-str-chart is-visible" data-phys-str-chart-card="force-deflection">
            <header>
              <h2>LOAD vs DEFLECTION</h2>
              <span class="phys-str-live"><span class="phys-str-dot"></span><span data-phys-str-chart-live>SOLVER</span></span>
            </header>
            <canvas data-phys-str-chart="force-deflection" role="img" aria-label="Normalized load versus deflection in simulation units"></canvas>
          </article>
          <article class="phys-str-chart is-visible" data-phys-str-chart-card="energy">
            <header>
              <h2>NORMALIZED ENERGY</h2>
              <span class="phys-str-live"><span class="phys-str-dot"></span><span data-phys-str-chart-live>SOLVER</span></span>
            </header>
            <canvas data-phys-str-chart="energy" role="img" aria-label="Normalized system energy versus model time"></canvas>
          </article>
        </section>
      </main>

      <aside class="phys-str-inspector" aria-label="Load case, material, and solver inspector">
        <div class="phys-str-tabs" role="tablist" aria-label="Inspector sections">
          <button class="is-active" type="button" role="tab" aria-selected="true" data-phys-str-tab="load-case">LOAD CASE</button>
          <button type="button" role="tab" aria-selected="false" data-phys-str-tab="material">MATERIAL</button>
          <button type="button" role="tab" aria-selected="false" data-phys-str-tab="solver">SOLVER</button>
        </div>

        <div class="phys-str-inspector-body">
          <section class="phys-str-form" data-phys-str-tab-panel="load-case" role="tabpanel">
            <h3>Load case</h3>
            <p class="phys-str-hint">Normalized command, not a physical kN. Set the load, then use Run.</p>
            <label class="phys-str-field">Load case name<output data-phys-str-case-name>BEND-DENT-R1</output></label>
            <label class="phys-str-field" for="${id('control-mode')}">Control mode
              <select id="${id('control-mode')}" data-phys-str-control-mode></select>
            </label>
            <label class="phys-str-field" for="${id('target')}">Target load
              <div>
                <input id="${id('target')}" type="number" min="0" max="2" step="0.05" value="0.80" data-phys-str-parameter="actuator-target">
                <em>normalized</em>
              </div>
            </label>
            <label class="phys-str-field" for="${id('rate')}">Time scale
              <div>
                <input id="${id('rate')}" type="number" min="0.05" max="2" step="0.05" value="1" data-phys-str-parameter="time-scale">
                <em>× real time</em>
              </div>
            </label>
            <label class="phys-str-field">Hold at peak
              <div>
                <input type="number" value="" disabled title="Hold duration is not a live solver parameter in this build.">
                <em>not modeled</em>
              </div>
            </label>
            <div data-phys-str-extra-parameters></div>

            <h3>Simulation limits</h3>
            <div class="phys-str-limits">
              <label class="phys-str-field" for="${id('limit-load')}">Max load
                <div>
                  <input id="${id('limit-load')}" type="number" min="0" max="4" step="0.05" value="1.25" data-phys-str-limit="maxLoadProgress">
                  <em>normalized</em>
                </div>
              </label>
              <label class="phys-str-field" for="${id('limit-strain')}">Max strain
                <div>
                  <input id="${id('limit-strain')}" type="number" min="0" max="4" step="0.01" value="1" data-phys-str-limit="maxNormalizedStrain">
                  <em>normalized</em>
                </div>
              </label>
              <label class="phys-str-field" for="${id('limit-breaks')}">Max breaks
                <div>
                  <input id="${id('limit-breaks')}" type="number" min="0" max="100000" step="1" value="10000" data-phys-str-limit="maxBreakCount">
                  <em>count</em>
                </div>
              </label>
              <label class="phys-str-field" for="${id('limit-time')}">Max duration
                <div>
                  <input id="${id('limit-time')}" type="number" min="1" max="120" step="1" value="30" data-phys-str-limit="maxDurationSeconds">
                  <em>model s</em>
                </div>
              </label>
              <label class="phys-str-field" for="${id('abort-limit')}">Abort on limit
                <input id="${id('abort-limit')}" type="checkbox" data-phys-str-limit="abortOnLimit" title="Off by default because demonstrations may reach failure.">
              </label>
            </div>
            <div class="phys-str-status-card" data-phys-str-envelope>
              <i class="ph ph-shield-check" aria-hidden="true"></i>
              <div>
                <strong data-phys-str-envelope-title>WITHIN LIMITS</strong>
                <span data-phys-str-envelope-detail>Predicted load and strain remain inside the declared simulation envelope.</span>
              </div>
            </div>
            <div class="phys-str-preflight" data-phys-str-preflight></div>
          </section>

          <section class="phys-str-form" data-phys-str-tab-panel="material" role="tabpanel" hidden>
            <h3>Material</h3>
            <label class="phys-str-field">Specimen<output data-phys-str-specimen>Reduced-order lattice</output></label>
            <label class="phys-str-field">Preset<output data-phys-str-material>Workbench material preset</output></label>
            <label class="phys-str-field">Group<output data-phys-str-group>Material Mechanics</output></label>
            <p class="phys-str-disclosure" data-phys-str-material-note>Material response is a reduced-order lattice model, not a calibrated continuum or finite-element solve.</p>
            <div data-phys-str-model-limits></div>
          </section>

          <section class="phys-str-form" data-phys-str-tab-panel="solver" role="tabpanel" hidden>
            <h3>Solver</h3>
            <label class="phys-str-field">Type<output data-phys-str-solver-type>Reduced-order beam lattice</output></label>
            <label class="phys-str-field">Fidelity<output data-phys-str-solver-fidelity>Reduced numerical model</output></label>
            <label class="phys-str-field" for="${id('substeps')}">Substeps
              <select id="${id('substeps')}" data-phys-str-substeps>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="4" selected>4</option>
                <option value="8">8</option>
              </select>
            </label>
            <label class="phys-str-field">Fixed step<output>1 / 60 model s</output></label>
            <label class="phys-str-field">Replay hash<output data-phys-str-hash>—</output></label>
            <p class="phys-str-disclosure">${PHYSICS_STRUCTURAL_DISCLOSURE}</p>
          </section>
        </div>

        <div class="phys-str-controls">
          <ol class="phys-str-howto" data-phys-str-hint aria-label="How to run" title="${PHYSICS_STRUCTURAL_HINT_COPY}">${PHYSICS_STRUCTURAL_HINT_STEPS.map((step, index) => `<li><span>${index + 1}</span> ${step}</li>`).join('')}</ol>
          <div class="phys-str-actions" role="group" aria-label="Run, pause, and reset">
            <button class="phys-str-run" type="button" data-phys-str-action="run" title="Start immediately. No Arm step.">Run</button>
            <button type="button" data-phys-str-action="pause" title="Pause the running test.">Pause</button>
            <button type="button" data-phys-str-action="reset" title="Reset the specimen.">Reset</button>
          </div>
          <div class="phys-str-abort-row">
            <button type="button" data-phys-str-action="abort" title="Stop the running test.">Abort</button>
          </div>
        </div>

        <section class="phys-str-log" data-phys-str-log aria-label="Run log" aria-live="polite">
          <p>${STRUCTURAL_EMPTY_LOG}</p>
        </section>
      </aside>
    </div>

    <footer class="phys-str-footer" aria-label="Specimen and runtime status">
      <span>Specimen <strong data-phys-str-footer-specimen>Reduced-order lattice</strong></span>
      <span>Authored span <strong data-phys-str-footer-span>—</strong></span>
      <span>Solver <strong data-phys-str-footer-solver>—</strong></span>
      <span>Nodes <strong data-phys-str-footer-nodes>—</strong></span>
      <span>Channels <strong data-phys-str-footer-channels>0 derived</strong></span>
      <span class="phys-str-footer-status" data-phys-str-systems><span class="phys-str-dot"></span><span data-phys-str-systems-label>All systems nominal</span></span>
    </footer>

    <nav class="phys-str-phone-nav" aria-label="Structural phone views">
      <button class="is-active" type="button" data-phys-str-phone="viewport"><i class="ph ph-cube" aria-hidden="true"></i>View</button>
      <button type="button" data-phys-str-phone="transport"><i class="ph ph-play" aria-hidden="true"></i>Run</button>
      <button type="button" data-phys-str-phone="charts"><i class="ph ph-chart-line" aria-hidden="true"></i>Charts</button>
      <button type="button" data-phys-str-phone="inspector"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>Case</button>
    </nav>

    <div class="phys-str-sr" aria-live="polite" data-phys-str-live></div>
  `;
}

function drawChart(canvas: HTMLCanvasElement, model: PhysicsStructuralChartUpdate): void {
  if (canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const displayWidth = width / ratio;
  const displayHeight = height / ratio;
  context.clearRect(0, 0, displayWidth, displayHeight);
  const padding = { left: 38, right: 10, top: 18, bottom: 22 };
  const plotWidth = Math.max(1, displayWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, displayHeight - padding.top - padding.bottom);
  const maxLength = Math.max(0, ...model.series.map((series) => series.values.length));
  const xValues = model.x && model.x.length >= maxLength
    ? model.x
    : Array.from({ length: maxLength }, (_, index) => index);
  const finiteY = model.series.flatMap((series) => series.values).filter(Number.isFinite);
  const finiteX = xValues.filter(Number.isFinite);
  const xMin = model.xDomain?.[0] ?? Math.min(...finiteX, 0);
  const xMax = model.xDomain?.[1] ?? Math.max(...finiteX, 1);
  let yMin = model.yDomain?.[0] ?? Math.min(...finiteY, 0);
  let yMax = model.yDomain?.[1] ?? Math.max(...finiteY, 1);
  if (Math.abs(yMax - yMin) < 1e-9) {
    yMin -= 1;
    yMax += 1;
  }
  const xScale = (value: number): number => padding.left + (value - xMin) / Math.max(1e-9, xMax - xMin) * plotWidth;
  const yScale = (value: number): number => padding.top + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;

  context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
  context.fillStyle = '#787e80';
  context.strokeStyle = '#282d2f';
  context.lineWidth = 1;
  context.setLineDash([]);
  for (let index = 0; index <= 4; index++) {
    const y = padding.top + plotHeight * index / 4;
    context.beginPath();
    context.moveTo(padding.left, y + 0.5);
    context.lineTo(padding.left + plotWidth, y + 0.5);
    context.stroke();
    context.fillText((yMax - (yMax - yMin) * index / 4).toFixed(Math.abs(yMax - yMin) <= 2 ? 2 : 1), 2, y + 3);
  }

  model.series.forEach((series, seriesIndex) => {
    context.strokeStyle = series.color ?? CHART_COLORS[seriesIndex % CHART_COLORS.length];
    context.lineWidth = 1.6;
    context.setLineDash(series.dashed ? [5, 4] : []);
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xScale(xValues[index] ?? index);
      const y = yScale(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });
  context.setLineDash([]);
  if (model.cursorX !== undefined && Number.isFinite(model.cursorX)) {
    context.strokeStyle = '#ff7900';
    context.setLineDash([3, 3]);
    const cursor = xScale(model.cursorX);
    context.beginPath();
    context.moveTo(cursor, padding.top);
    context.lineTo(cursor, padding.top + plotHeight);
    context.stroke();
    context.setLineDash([]);
  }
  context.fillStyle = '#787e80';
  if (model.xLabel) {
    context.fillText(model.xLabel, padding.left + plotWidth / 2 - context.measureText(model.xLabel).width / 2, displayHeight - 4);
  }
  let legendX = padding.left;
  for (const series of model.series.slice(0, 3)) {
    context.fillStyle = series.color ?? CHART_COLORS[0];
    context.fillRect(legendX, 4, 11, 2);
    context.fillStyle = '#a8adae';
    context.fillText(series.label, legendX + 15, 8);
    legendX += 22 + context.measureText(series.label).width;
  }
}

function isEvidenceChannel(value: PhysicsStructuralChannel | ChannelDescriptorV1): value is ChannelDescriptorV1 {
  return 'quantity' in value && 'provenance' in value && !('value' in value);
}

export function createPhysicsStructural(options: PhysicsStructuralOptions): PhysicsStructuralController {
  const prefix = options.idPrefix ?? 'phys-str';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Physics structural idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }

  const labs = options.labs ?? WORKBENCH_LABS;
  const requestedLabId = options.initialLabId ?? 'titan-bend-dent';
  const initialLab = labs.find((item) => item.id === requestedLabId) ?? getWorkbenchLab(requestedLabId) ?? labs[0];
  if (!initialLab) throw new Error('Physics structural view requires at least one laboratory definition.');
  const root = document.createElement('div');
  root.className = 'phys-str';
  root.id = `${prefix}-root`;
  root.dataset.runState = 'draft';
  root.innerHTML = shellMarkup(prefix);
  options.mount.append(root);

  const abortController = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abortController.signal };
  const liveRegion = required<HTMLElement>(root, '[data-phys-str-live]');
  const treeHost = required<HTMLElement>(root, '[data-phys-str-tree]');
  const channelBody = required<HTMLTableSectionElement>(root, '[data-phys-str-channels]');
  const revisionHost = required<HTMLElement>(root, '[data-phys-str-revisions]');
  const revisionSelect = required<HTMLSelectElement>(root, '[data-phys-str-revision-select]');
  const labMenu = required<HTMLElement>(root, '[data-phys-str-lab-menu]');
  const labList = required<HTMLElement>(root, '[data-phys-str-lab-list]');
  const labSearch = required<HTMLInputElement>(root, '[data-phys-str-lab-search]');
  const viewportSlot = required<HTMLElement>(root, '[data-phys-str-viewport-slot]');
  const calloutHost = required<HTMLElement>(root, '[data-phys-str-callouts]');
  const markerHost = required<HTMLElement>(root, '[data-phys-str-markers]');
  const timeline = required<HTMLInputElement>(root, '[data-phys-str-timeline]');
  const logHost = required<HTMLElement>(root, '[data-phys-str-log]');
  const preflightHost = required<HTMLElement>(root, '[data-phys-str-preflight]');
  const extraParameters = required<HTMLElement>(root, '[data-phys-str-extra-parameters]');
  const modelLimitsHost = required<HTMLElement>(root, '[data-phys-str-model-limits]');
  const controlMode = required<HTMLSelectElement>(root, '[data-phys-str-control-mode]');
  const overlaySelect = required<HTMLSelectElement>(root, '[data-phys-str-overlay]');
  const envelope = required<HTMLElement>(root, '[data-phys-str-envelope]');
  const loadArrow = required<HTMLElement>(root, '[data-phys-str-load-arrow]');
  for (const action of PHYSICS_STRUCTURAL_PRIMARY_ACTIONS) {
    required(root, `[data-phys-str-action="${action}"]`);
  }

  const canvasByChart = new Map<PhysicsStructuralChartId, HTMLCanvasElement>();
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-phys-str-chart]')) {
    const id = canvas.dataset.physStrChart;
    if (id && isChartId(id)) canvasByChart.set(id, canvas);
  }

  let callbacks: PhysicsStructuralCallbacks = options.callbacks ?? {};
  let destroyed = false;
  let lab: WorkbenchLabDefinition = initialLab;
  let manifest: EngineeringModelManifest | null = getEngineeringModelForLab(lab.id);
  let selectedComponentId: string | null = null;
  let runState: EngineeringRunState = 'draft';
  let overlay: PhysicsStructuralOverlayId = 'strain';
  let compareMode: PhysicsStructuralCompareMode = 'after';
  let inspectorTab: PhysicsStructuralInspectorTab = 'load-case';
  let viewportTool: PhysicsStructuralViewportTool = 'orbit';
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let parameters: Record<string, number> = Object.fromEntries(lab.liveParameters.map((item) => [item.id, item.defaultValue]));
  let limits: PhysicsStructuralLimits = DEFAULT_LIMITS;
  let predicted: PhysicsStructuralPredicted = {
    load: 0,
    strain: 0,
    breaks: 0,
    durationSeconds: 0,
    withinLimits: true,
  };
  let channels: PhysicsStructuralChannel[] = [];
  let channelOffsets: Record<string, number> = {};
  let revisions: PhysicsStructuralRevision[] = [{ id: 'r1', label: 'R1', detail: 'Active definition', immutable: false, active: true }];
  let charts = new Map<PhysicsStructuralChartId, PhysicsStructuralChartUpdate>(Object.entries(emptyCharts()) as [PhysicsStructuralChartId, PhysicsStructuralChartUpdate][]);
  let runtimeCounts: PhysicsStructuralRuntimeCounts = {};
  let maxStep = 1800;
  let substeps: 1 | 2 | 4 | 8 = 4;

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => {
      if (!destroyed) liveRegion.textContent = message;
    }, 20);
  };

  const setText = (selector: string, value: string): void => {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) node.textContent = value;
  };

  const drawAllCharts = (): void => {
    for (const [id, canvas] of canvasByChart) {
      const model = charts.get(id);
      if (model) drawChart(canvas, model);
    }
  };

  const syncRunButtons = (): void => {
    let canStart = false;
    let canPause = false;
    let canReset = false;
    let canAbort = false;
    let canStep = false;
    let canDraftEdit = false;
    switch (runState) {
      case 'draft':
        canStart = true;
        canReset = true;
        canDraftEdit = true;
        break;
      case 'preflight':
        canStart = true;
        canReset = true;
        canAbort = true;
        break;
      case 'armed':
        canStart = true;
        canReset = true;
        canAbort = true;
        break;
      case 'running':
        canPause = true;
        canReset = true;
        canAbort = true;
        break;
      case 'paused':
        canStart = true;
        canReset = true;
        canAbort = true;
        canStep = true;
        break;
      case 'complete':
      case 'aborted':
        canStart = true;
        canReset = true;
        break;
      default: {
        const exhaustive: never = runState;
        throw new Error(`Unhandled structural run state: ${String(exhaustive)}`);
      }
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-str-action]')) {
      const action = button.dataset.physStrAction;
      if (action === 'run') {
        const primary = button.classList.contains('phys-str-run');
        button.disabled = primary ? !canStart : !(canStart || canPause);
        if (primary) {
          button.title = canStart
            ? runState === 'paused'
              ? 'Resume immediately. No Arm step.'
              : 'Start immediately. No Arm step.'
            : 'Pause is available while the test is running.';
        } else {
          button.title = canPause ? 'Pause the running test.' : 'Start immediately. No Arm step.';
        }
      } else if (action === 'pause') button.disabled = !canPause;
      else if (action === 'reset') button.disabled = !canReset;
      else if (action === 'abort') button.disabled = !canAbort;
      else if (action === 'step') button.disabled = !canStep;
      else if (action === 'undo' || action === 'redo') button.disabled = !canDraftEdit;
    }
    const playIcon = root.querySelector('[data-phys-str-play-icon]');
    if (playIcon) playIcon.className = `ph ${runState === 'running' ? 'ph-pause' : 'ph-play'}`;
    setText('[data-phys-str-chart-live]', runState === 'running' ? 'LIVE' : 'SOLVER');
  };

  const renderLabs = (query = ''): void => {
    const needle = query.trim().toLowerCase();
    const groups = new Map<WorkbenchGroup, WorkbenchLabDefinition[]>();
    for (const item of labs) {
      if (needle) {
        const haystack = `${item.id} ${item.title} ${item.shortName} ${item.description}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      const bucket = groups.get(item.group) ?? [];
      bucket.push(item);
      groups.set(item.group, bucket);
    }
    labList.replaceChildren();
    for (const [group, items] of groups) {
      const section = document.createElement('section');
      section.className = 'phys-str-lab-group';
      const heading = document.createElement('h3');
      heading.textContent = WORKBENCH_GROUP_LABELS[group];
      section.append(heading);
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'phys-str-lab-item';
        button.classList.toggle('is-active', item.id === lab.id);
        button.dataset.physStrLab = item.id;
        button.innerHTML = `<strong></strong><span></span>`;
        button.querySelector('strong')!.textContent = item.title;
        button.querySelector('span')!.textContent = `${item.shortName} · ${item.fidelity}`;
        section.append(button);
      }
      labList.append(section);
    }
  };

  const renderTree = (): void => {
    treeHost.replaceChildren();
    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.className = 'phys-str-tree-item';
    rootButton.dataset.depth = '0';
    rootButton.dataset.physStrLabRoot = '';
    rootButton.setAttribute('role', 'treeitem');
    rootButton.innerHTML = `<i class="ph ph-flask" aria-hidden="true"></i><span></span><small>LAB</small><span class="phys-str-tree-dot"></span>`;
    rootButton.querySelector('span')!.textContent = lab.shortName.toUpperCase();
    treeHost.append(rootButton);

    if (!manifest) return;
    const byId = new Map(manifest.components.map((component) => [component.id, component] as const));
    const depthFor = (component: EngineeringAssemblyComponent): number => {
      let depth = 1;
      let parentId = component.parentId;
      const visited = new Set<string>();
      while (parentId && depth < 4 && !visited.has(parentId)) {
        visited.add(parentId);
        depth++;
        parentId = byId.get(parentId)?.parentId;
      }
      return depth;
    };

    const groups: { label: string; kinds: readonly EngineeringComponentKind[] }[] = [
      { label: 'Setup', kinds: ['specimen', 'fixture', 'load-train'] },
      { label: 'Sensors', kinds: ['instrumentation'] },
      { label: 'Environment', kinds: ['environment'] },
      { label: 'Notes', kinds: ['effect'] },
    ];

    for (const group of groups) {
      const items = manifest.components.filter((component) => group.kinds.includes(component.kind));
      if (items.length === 0) continue;
      const section = document.createElement('section');
      section.className = 'phys-str-tree-group';
      const header = document.createElement('header');
      header.innerHTML = `<i class="ph ph-caret-down" aria-hidden="true"></i><span></span><i class="ph ph-check-circle" aria-hidden="true"></i>`;
      header.querySelector('span')!.textContent = group.label;
      section.append(header);
      for (const component of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'phys-str-tree-item';
        row.dataset.componentId = component.id;
        row.dataset.depth = String(Math.min(3, depthFor(component)));
        row.classList.toggle('is-selected', component.id === selectedComponentId);
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-selected', String(component.id === selectedComponentId));
        row.title = component.note;
        row.innerHTML = `<i class="ph ${componentIcon(component.kind)}" aria-hidden="true"></i><span></span><small></small><span class="phys-str-tree-dot" data-tone="${component.kind}"></span>`;
        row.querySelector('span')!.textContent = component.label;
        row.querySelector('small')!.textContent = component.evidenceRole === 'presentation-only' ? 'VISUAL' : component.evidenceRole === 'derived-measurement' ? 'DERIVED' : 'LIVE';
        section.append(row);
      }
      treeHost.append(section);
    }
  };

  const renderChannels = (): void => {
    channelBody.replaceChildren();
    for (const channel of channels) {
      const row = document.createElement('tr');
      row.dataset.physStrChannelId = channel.id;
      row.dataset.status = channel.status ?? 'nominal';
      const name = document.createElement('td');
      name.textContent = channel.label;
      const unit = document.createElement('td');
      unit.textContent = channel.unit;
      const value = document.createElement('td');
      const numeric = typeof channel.value === 'number' ? channel.value - (channelOffsets[channel.id] ?? 0) : channel.value;
      value.textContent = formatChannelValue(numeric, undefined);
      row.append(name, unit, value);
      channelBody.append(row);
    }
    const countLabel = `${channels.length} DERIVED`;
    setText('[data-phys-str-channel-count]', countLabel);
    setText('[data-phys-str-footer-channels]', `${channels.length} derived`);
  };

  const renderRevisions = (): void => {
    revisionHost.replaceChildren();
    revisionSelect.replaceChildren();
    for (const revision of revisions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phys-str-revision';
      button.dataset.revisionId = revision.id;
      button.dataset.immutable = String(revision.immutable);
      button.classList.toggle('is-active', Boolean(revision.active));
      button.innerHTML = `<span></span><span><strong></strong><small></small></span><i class="ph ph-circle-fill" aria-hidden="true"></i>`;
      button.querySelector('span')!.textContent = revision.label;
      button.querySelector('strong')!.textContent = revision.detail;
      button.querySelector('small')!.textContent = revision.timestamp ?? (revision.immutable ? 'Immutable after run' : 'Draft snapshot');
      revisionHost.append(button);
      const option = document.createElement('option');
      option.value = revision.id;
      option.selected = Boolean(revision.active);
      option.textContent = `State ${revision.label}`;
      revisionSelect.append(option);
    }
  };

  const renderControlModes = (): void => {
    controlMode.replaceChildren();
    for (const mode of lab.forceModes) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = forceModeLabel(mode);
      controlMode.append(option);
    }
  };

  const renderExtraParameters = (): void => {
    extraParameters.replaceChildren();
    for (const spec of lab.liveParameters) {
      if (spec.id === 'actuator-target' || spec.id === 'time-scale') continue;
      const label = document.createElement('label');
      label.className = 'phys-str-field';
      const inputId = `${prefix}-${spec.id}`;
      label.htmlFor = inputId;
      label.append(document.createTextNode(spec.label));
      const wrap = document.createElement('div');
      const input = document.createElement('input');
      input.id = inputId;
      input.type = 'number';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(parameters[spec.id] ?? spec.defaultValue);
      input.dataset.physStrParameter = spec.id;
      const unit = document.createElement('em');
      unit.textContent = spec.unit;
      wrap.append(input, unit);
      label.append(wrap);
      extraParameters.append(label);
    }
  };

  const renderModelLimits = (): void => {
    modelLimitsHost.replaceChildren();
    if (!manifest) return;
    for (const limit of manifest.limits) {
      const row = document.createElement('p');
      row.className = 'phys-str-disclosure';
      row.textContent = `${limit.subject}: ${limit.disclosure}`;
      modelLimitsHost.append(row);
    }
  };

  const renderPreflight = (checks: readonly EngineeringPreflightCheck[]): void => {
    preflightHost.replaceChildren();
    for (const check of checks) {
      const row = document.createElement('p');
      row.className = 'phys-str-check';
      row.dataset.status = check.status;
      row.title = check.detail;
      row.innerHTML = `<i class="ph ${checkIcon(check.status)}" aria-hidden="true"></i><span></span><strong></strong>`;
      row.querySelector('span')!.textContent = check.label;
      row.querySelector('strong')!.textContent = check.status.toUpperCase();
      preflightHost.append(row);
    }
  };

  const renderCallouts = (callouts: readonly PhysicsStructuralCallout[]): void => {
    calloutHost.replaceChildren();
    for (const callout of callouts) {
      const node = document.createElement('div');
      node.className = 'phys-str-callout';
      node.dataset.tone = callout.tone ?? 'sensor';
      node.style.left = `${clamp(callout.xPercent, 4, 96)}%`;
      node.style.top = `${clamp(callout.yPercent, 8, 92)}%`;
      const title = document.createElement('strong');
      title.textContent = callout.label;
      node.append(title);
      if (callout.value) {
        const value = document.createElement('span');
        value.textContent = callout.value;
        node.append(value);
      }
      calloutHost.append(node);
    }
  };

  const defaultCalloutsFromModel = (): PhysicsStructuralCallout[] => {
    if (!manifest) return [];
    const sensors = manifest.components.filter((component) => component.kind === 'instrumentation').slice(0, 3);
    return sensors.map((component, index) => ({
      id: component.id,
      label: component.label,
      value: component.evidenceRole === 'derived-measurement' ? 'derived' : component.kind,
      xPercent: 28 + index * 18,
      yPercent: 58 + (index % 2) * 8,
      tone: 'sensor' as const,
    }));
  };

  const syncEnvelope = (): void => {
    const loadRatio = predicted.load / Math.max(1e-9, limits.maxLoadProgress);
    const strainRatio = predicted.strain / Math.max(1e-9, limits.maxNormalizedStrain);
    const timeRatio = predicted.durationSeconds / Math.max(1e-9, limits.maxDurationSeconds);
    const breakRatio = predicted.breaks / Math.max(1, limits.maxBreakCount);
    const peak = Math.max(loadRatio, strainRatio, timeRatio, breakRatio);
    const failed = peak > 1 || !predicted.withinLimits;
    const warn = !failed && peak >= 0.9;
    envelope.classList.toggle('is-fail', failed);
    envelope.classList.toggle('is-warn', warn);
    const title = failed ? 'LIMIT BREACHED' : warn ? 'LIMIT WARNING' : 'WITHIN LIMITS';
    setText('[data-phys-str-envelope-title]', title);
    setText(
      '[data-phys-str-envelope-detail]',
      `Predicted load ${formatFixed(predicted.load, 3)} normalized · strain ${formatFixed(predicted.strain, 4)} normalized · ${formatFixed(predicted.durationSeconds, 3)} model s.`,
    );
    const strainField = root.querySelector('[data-phys-str-limit="maxNormalizedStrain"]')?.closest('.phys-str-field');
    strainField?.classList.toggle('is-warn', strainRatio >= 0.9);
    const systems = failed ? 'Limit envelope exceeded' : warn ? 'Approaching simulation limits' : 'All systems nominal';
    setText('[data-phys-str-systems-label]', systems);
    const status = required<HTMLElement>(root, '[data-phys-str-systems]');
    status.style.color = failed ? 'var(--phys-str-red)' : warn ? 'var(--phys-str-yellow)' : 'var(--phys-str-green)';
  };

  const syncFooter = (): void => {
    const specimen = manifest?.components.find((component) => component.kind === 'specimen');
    const span = manifest?.dimensions.find((dimension) => dimension.axis === 'X');
    setText('[data-phys-str-footer-specimen]', specimen?.material ?? specimen?.label ?? lab.shortName);
    setText('[data-phys-str-footer-span]', span ? `${span.value.toFixed(span.value < 1 ? 2 : 1)} sim units` : 'not authored');
    setText('[data-phys-str-footer-solver]', WORKBENCH_SOLVER_LABELS[lab.solver]);
    setText('[data-phys-str-footer-nodes]', runtimeCounts.nodes !== undefined ? String(runtimeCounts.nodes) : 'reduced lattice');
    setText('[data-phys-str-specimen]', specimen?.label ?? 'Reduced-order lattice');
    setText('[data-phys-str-material]', specimen?.material ?? 'Workbench material preset');
    setText('[data-phys-str-group]', WORKBENCH_GROUP_LABELS[lab.group]);
    setText('[data-phys-str-material-note]', manifest?.limits[0]?.disclosure ?? PHYSICS_STRUCTURAL_DISCLOSURE);
  };

  const syncHeader = (): void => {
    setText('[data-phys-str-twin]', `${lab.shortName.toUpperCase()} · ${(manifest?.revision ?? 'R1').toUpperCase()}`);
    setText('[data-phys-str-solver]', WORKBENCH_SOLVER_LABELS[lab.solver]);
    setText('[data-phys-str-fidelity]', lab.fidelity);
    setText('[data-phys-str-solver-type]', WORKBENCH_SOLVER_LABELS[lab.solver]);
    setText('[data-phys-str-solver-fidelity]', lab.fidelity);
    setText('[data-phys-str-case-name]', `${lab.shortName.toUpperCase().replace(/\s+/g, '-')}-${revisions.find((item) => item.active)?.label ?? 'R1'}`);
  };

  const syncLegend = (): void => {
    setText('[data-phys-str-legend-title]', overlay === 'none' ? 'NO OVERLAY' : overlayLabel(overlay).toUpperCase());
    const legend = required<HTMLElement>(root, '[data-phys-str-legend]');
    legend.hidden = overlay === 'none';
  };

  const syncParameterInputs = (): void => {
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-phys-str-parameter]')) {
      const id = input.dataset.physStrParameter as WorkbenchParameterId | undefined;
      if (!id || parameters[id] === undefined) continue;
      input.value = String(parameters[id]);
    }
    const target = parameters['actuator-target'] ?? 0.8;
    setText('[data-phys-str-load-label]', `LOAD TARGET ${formatFixed(target, 2)} normalized`);
  };

  const applyLab = (next: WorkbenchLabDefinition, nextParameters?: Readonly<Record<string, number>>): void => {
    lab = next;
    parameters = {
      ...Object.fromEntries(next.liveParameters.map((item) => [item.id, item.defaultValue])),
      ...nextParameters,
    };
    manifest = getEngineeringModelForLab(next.id);
    selectedComponentId = manifest?.components.find((component) => component.kind === 'specimen')?.id ?? null;
    renderControlModes();
    renderExtraParameters();
    renderTree();
    renderModelLimits();
    renderCallouts(defaultCalloutsFromModel());
    syncHeader();
    syncFooter();
    syncParameterInputs();
    renderLabs(labSearch.value);
  };

  const emitCommand = (command: PhysicsStructuralRunCommand): void => {
    root.dispatchEvent(new CustomEvent('physics-structural-command', { detail: { command } }));
    void Promise.resolve(callbacks.onRunCommand?.(command)).catch((error: unknown) => {
      appendLogInternal({
        time: predicted.durationSeconds,
        step: Number(timeline.value),
        message: error instanceof Error ? error.message : 'Run command failed',
        severity: 'danger',
      });
    });
  };

  function appendLogInternal(entry: PhysicsStructuralLogEntry): void {
    if (logHost.querySelector('p')?.textContent === STRUCTURAL_EMPTY_LOG) logHost.replaceChildren();
    const line = document.createElement('p');
    if (entry.severity) line.dataset.severity = entry.severity;
    line.textContent = `t=${formatFixed(entry.time, 3)}s  step=${entry.step}  ${entry.message}`;
    logHost.append(line);
    logHost.scrollTop = logHost.scrollHeight;
  }

  const attachViewport = (nextViewport: HTMLElement): void => {
    if (destroyed) return;
    if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    viewportMarker?.remove();
    viewport?.classList.remove('phys-str-attached');
    viewport = nextViewport;
    viewportMarker = document.createComment(`${prefix}-viewport-origin`);
    nextViewport.parentNode?.insertBefore(viewportMarker, nextViewport);
    viewportSlot.append(nextViewport);
    nextViewport.classList.add('phys-str-attached');
  };

  const updateModel = (next: EngineeringModelManifest): void => {
    manifest = next;
    if (!selectedComponentId || !next.components.some((component) => component.id === selectedComponentId)) {
      selectedComponentId = next.components.find((component) => component.kind === 'specimen')?.id ?? null;
    }
    renderTree();
    renderModelLimits();
    renderCallouts(defaultCalloutsFromModel());
    syncHeader();
    syncFooter();
  };

  const updateLab = (next: WorkbenchLabDefinition, nextParameters?: Readonly<Record<string, number>>): void => {
    applyLab(next, nextParameters);
  };

  const updateRun = (snapshot: EngineeringRunSnapshot): void => {
    runState = snapshot.state;
    root.dataset.runState = snapshot.state;
    setText('[data-phys-str-seed]', `0x${snapshot.seed.toString(16)}`);
    setText('[data-phys-str-backend]', snapshot.backend.toUpperCase());
    const latest = snapshot.samples.at(-1);
    if (latest) {
      setText('[data-phys-str-time]', formatFixed(latest.time, 3));
      setText('[data-phys-str-step]', String(latest.step));
      setText('[data-phys-str-hash]', `0x${latest.hash.toString(16).padStart(8, '0')}`);
      maxStep = Math.max(1800, latest.step, ...snapshot.events.map((event) => event.step));
      timeline.max = String(maxStep);
      timeline.value = String(latest.step);
      channels = channelsFromSample(latest);
      renderChannels();
      predicted = {
        load: latest.load,
        strain: latest.damage,
        breaks: latest.brokenCount,
        durationSeconds: latest.time,
        withinLimits:
          latest.load <= limits.maxLoadProgress
          && latest.damage <= limits.maxNormalizedStrain
          && latest.brokenCount <= limits.maxBreakCount
          && latest.time <= limits.maxDurationSeconds,
      };
      syncEnvelope();
      const derived = chartsFromSamples(snapshot.samples);
      charts = new Map(Object.entries(derived) as [PhysicsStructuralChartId, PhysicsStructuralChartUpdate][]);
      drawAllCharts();
    }
    markerHost.replaceChildren();
    for (const event of snapshot.events) {
      const marker = document.createElement('span');
      marker.className = 'phys-str-marker';
      marker.dataset.kind = event.kind;
      marker.title = `${eventKindLabel(event.kind)} · ${event.label}`;
      marker.style.left = `${clamp(event.step / Math.max(1, maxStep) * 100, 0, 100)}%`;
      markerHost.append(marker);
    }
    updateLog(snapshot.events.map((event) => ({
      time: event.time,
      step: event.step,
      message: `${eventKindLabel(event.kind)} · ${event.label}`,
      severity: event.severity,
    })));
    syncRunButtons();
    announce(`${runStateLabel(snapshot.state)} · ${snapshot.title}`);
  };

  const updateTelemetry = (sample: Partial<EngineeringSample> & { readonly time?: number; readonly step?: number }): void => {
    if (sample.time !== undefined) setText('[data-phys-str-time]', formatFixed(sample.time, 3));
    if (sample.step !== undefined) {
      setText('[data-phys-str-step]', String(sample.step));
      timeline.value = String(clamp(sample.step, 0, Number(timeline.max)));
    }
    if (sample.hash !== undefined) setText('[data-phys-str-hash]', `0x${(sample.hash >>> 0).toString(16).padStart(8, '0')}`);
    if (sample.load !== undefined || sample.response !== undefined || sample.energy !== undefined || sample.damage !== undefined || sample.brokenCount !== undefined) {
      const current = {
        time: sample.time ?? predicted.durationSeconds,
        step: sample.step ?? Number(timeline.value),
        load: sample.load ?? predicted.load,
        response: sample.response ?? 0,
        energy: sample.energy ?? 0,
        damage: sample.damage ?? predicted.strain,
        brokenCount: sample.brokenCount ?? predicted.breaks,
        hash: sample.hash ?? 0,
      };
      channels = channelsFromSample(current);
      renderChannels();
      predicted = {
        load: current.load,
        strain: current.damage,
        breaks: current.brokenCount,
        durationSeconds: current.time,
        withinLimits:
          current.load <= limits.maxLoadProgress
          && current.damage <= limits.maxNormalizedStrain
          && current.brokenCount <= limits.maxBreakCount
          && current.time <= limits.maxDurationSeconds,
      };
      syncEnvelope();
    }
  };

  const updateChannels = (
    next: readonly PhysicsStructuralChannel[] | readonly ChannelDescriptorV1[],
    values?: Readonly<Record<string, number | string>>,
  ): void => {
    channels = next.map((channel) => {
      if (isEvidenceChannel(channel)) {
        return {
          id: channel.id,
          label: channel.label,
          unit: channel.unit,
          value: values?.[channel.id] ?? '—',
          quantity: channel.quantity,
          provenance: channel.provenance,
          status: 'nominal',
        };
      }
      return channel;
    });
    renderChannels();
  };

  const updateRevisions = (next: readonly PhysicsStructuralRevision[], activeId?: string): void => {
    revisions = next.map((revision) => ({ ...revision, active: activeId ? revision.id === activeId : revision.active }));
    renderRevisions();
    syncHeader();
  };

  const updateChart = (chart: PhysicsStructuralChartId, update: PhysicsStructuralChartUpdate): void => {
    charts.set(chart, update);
    const canvas = canvasByChart.get(chart);
    if (canvas) drawChart(canvas, update);
  };

  const readLimitsFromForm = (): PhysicsStructuralLimits => {
    const numberFor = (key: keyof PhysicsStructuralLimits, fallback: number): number => {
      const input = root.querySelector<HTMLInputElement>(`[data-phys-str-limit="${key}"]`);
      if (!input || input.type === 'checkbox') return fallback;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : fallback;
    };
    const abort = root.querySelector<HTMLInputElement>('[data-phys-str-limit="abortOnLimit"]');
    return {
      maxLoadProgress: numberFor('maxLoadProgress', limits.maxLoadProgress),
      maxNormalizedStrain: numberFor('maxNormalizedStrain', limits.maxNormalizedStrain),
      maxBreakCount: numberFor('maxBreakCount', limits.maxBreakCount),
      maxDurationSeconds: numberFor('maxDurationSeconds', limits.maxDurationSeconds),
      abortOnLimit: Boolean(abort?.checked),
    };
  };

  const writeLimitsToForm = (next: PhysicsStructuralLimits): void => {
    const assign = (key: keyof PhysicsStructuralLimits, value: number | boolean): void => {
      const input = root.querySelector<HTMLInputElement>(`[data-phys-str-limit="${key}"]`);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    };
    assign('maxLoadProgress', next.maxLoadProgress);
    assign('maxNormalizedStrain', next.maxNormalizedStrain);
    assign('maxBreakCount', next.maxBreakCount);
    assign('maxDurationSeconds', next.maxDurationSeconds);
    assign('abortOnLimit', next.abortOnLimit);
  };

  const updateLimits = (next: Partial<PhysicsStructuralLimits>, nextPredicted?: Partial<PhysicsStructuralPredicted>): void => {
    limits = { ...limits, ...next };
    writeLimitsToForm(limits);
    if (nextPredicted) predicted = { ...predicted, ...nextPredicted };
    syncEnvelope();
  };

  const updateLog = (entries: readonly PhysicsStructuralLogEntry[]): void => {
    logHost.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = STRUCTURAL_EMPTY_LOG;
      logHost.append(empty);
      return;
    }
    for (const entry of entries) appendLogInternal(entry);
  };

  const updateRuntimeCounts = (counts: PhysicsStructuralRuntimeCounts): void => {
    runtimeCounts = { ...runtimeCounts, ...counts };
    if (counts.hash !== undefined) setText('[data-phys-str-hash]', `0x${(counts.hash >>> 0).toString(16).padStart(8, '0')}`);
    syncFooter();
  };

  const setOverlay = (next: PhysicsStructuralOverlayId): void => {
    overlay = next;
    overlaySelect.value = next;
    syncLegend();
  };

  const setCompareMode = (next: PhysicsStructuralCompareMode): void => {
    compareMode = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-str-compare]')) {
      const active = button.dataset.physStrCompare === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const setInspectorTab = (next: PhysicsStructuralInspectorTab): void => {
    inspectorTab = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-str-tab]')) {
      const active = button.dataset.physStrTab === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-phys-str-tab-panel]')) {
      panel.hidden = panel.dataset.physStrTabPanel !== next;
    }
  };

  const selectComponent = (componentId: string | null): void => {
    selectedComponentId = componentId;
    const component = manifest?.components.find((item) => item.id === componentId) ?? null;
    for (const row of treeHost.querySelectorAll<HTMLElement>('[data-component-id]')) {
      const selected = row.dataset.componentId === componentId;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
    callbacks.onComponentSelect?.(component);
  };

  const setForceTarget = (u: number, v: number, label?: string): void => {
    loadArrow.style.left = `${clamp(u * 100, 4, 96)}%`;
    loadArrow.style.top = `${clamp((1 - v) * 100, 8, 72)}%`;
    if (label) setText('[data-phys-str-load-label]', label);
    else setText('[data-phys-str-load-label]', `LOAD TARGET ${formatFixed(parameters['actuator-target'] ?? u, 2)} normalized`);
  };

  const setStatus = (message: string, tone: 'nominal' | 'warning' | 'danger' = 'nominal'): void => {
    setText('[data-phys-str-systems-label]', message);
    const status = required<HTMLElement>(root, '[data-phys-str-systems]');
    status.style.color = tone === 'danger' ? 'var(--phys-str-red)' : tone === 'warning' ? 'var(--phys-str-yellow)' : 'var(--phys-str-green)';
  };

  const setBackend = (label: string, deterministic = true): void => {
    setText('[data-phys-str-backend]', label.toUpperCase());
    const dot = required<HTMLElement>(root, '[data-phys-str-backend-dot]');
    dot.style.background = deterministic ? 'var(--phys-str-green)' : 'var(--phys-str-yellow)';
  };

  const setParameters = (values: Readonly<Record<string, number>>): void => {
    parameters = { ...parameters, ...values };
    syncParameterInputs();
  };

  const setSubsteps = (next: 1 | 2 | 4 | 8): void => {
    substeps = next;
    const select = required<HTMLSelectElement>(root, '[data-phys-str-substeps]');
    select.value = String(next);
  };

  const setViewportTool = (next: PhysicsStructuralViewportTool): void => {
    viewportTool = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-str-tool]')) {
      if (button.dataset.physStrTool === 'mesh') continue;
      const active = button.dataset.physStrTool === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const labRoot = target?.closest<HTMLButtonElement>('[data-phys-str-lab-root]');
    if (labRoot) {
      labMenu.hidden = !labMenu.hidden;
      return;
    }
    const labButton = target?.closest<HTMLButtonElement>('[data-phys-str-lab]');
    if (labButton?.dataset.physStrLab) {
      const next = getWorkbenchLab(labButton.dataset.physStrLab) ?? labs.find((item) => item.id === labButton.dataset.physStrLab);
      if (next) {
        applyLab(next);
        labMenu.hidden = true;
        callbacks.onLabSelect?.(next.id);
        announce(`${next.title} selected.`);
      }
      return;
    }
    const componentRow = target?.closest<HTMLButtonElement>('[data-component-id]');
    if (componentRow?.dataset.componentId) {
      selectComponent(componentRow.dataset.componentId);
      return;
    }
    const revisionRow = target?.closest<HTMLButtonElement>('[data-revision-id]');
    if (revisionRow?.dataset.revisionId) {
      updateRevisions(revisions, revisionRow.dataset.revisionId);
      callbacks.onRevisionSelect?.(revisionRow.dataset.revisionId);
      return;
    }
    const tab = target?.closest<HTMLButtonElement>('[data-phys-str-tab]');
    if (tab?.dataset.physStrTab && isInspectorTab(tab.dataset.physStrTab)) {
      setInspectorTab(tab.dataset.physStrTab);
      callbacks.onInspectorTab?.(tab.dataset.physStrTab);
      return;
    }
    const compare = target?.closest<HTMLButtonElement>('[data-phys-str-compare]');
    if (compare?.dataset.physStrCompare === 'before' || compare?.dataset.physStrCompare === 'after') {
      setCompareMode(compare.dataset.physStrCompare);
      callbacks.onCompareModeChange?.(compare.dataset.physStrCompare);
      return;
    }
    const tool = target?.closest<HTMLButtonElement>('[data-phys-str-tool]');
    if (tool?.dataset.physStrTool && isViewportTool(tool.dataset.physStrTool)) {
      if (tool.dataset.physStrTool === 'mesh') {
        const pressed = tool.getAttribute('aria-pressed') !== 'true';
        tool.classList.toggle('is-active', pressed);
        tool.setAttribute('aria-pressed', String(pressed));
      } else {
        setViewportTool(tool.dataset.physStrTool);
      }
      callbacks.onViewportTool?.(tool.dataset.physStrTool);
      return;
    }
    const phone = target?.closest<HTMLButtonElement>('[data-phys-str-phone]');
    if (phone?.dataset.physStrPhone) {
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-phys-str-phone]')) {
        button.classList.toggle('is-active', button === phone);
      }
      root.classList.toggle('is-inspector-open', phone.dataset.physStrPhone === 'inspector');
      if (phone.dataset.physStrPhone === 'charts') {
        const cards = [...root.querySelectorAll<HTMLElement>('[data-phys-str-chart-card]')];
        const current = cards.findIndex((card) => card.classList.contains('is-visible'));
        const next = (current + 1) % Math.max(1, cards.length);
        cards.forEach((card, index) => card.classList.toggle('is-visible', index === next));
      }
      return;
    }
    const actionButton = target?.closest<HTMLButtonElement>('[data-phys-str-action]');
    const action = actionButton?.dataset.physStrAction;
    if (!action) return;
    if (action === 'toggle-labs') labMenu.hidden = !labMenu.hidden;
    else if (action === 'toggle-rail') root.classList.toggle('is-rail-open');
    else if (action === 'toggle-inspector') root.classList.toggle('is-inspector-open');
    else if (action === 'focus-tree' || action === 'focus-channels' || action === 'focus-revisions') {
      root.classList.add('is-rail-open');
      const panel = action === 'focus-tree' ? 'experiment' : action === 'focus-channels' ? 'channels' : 'revisions';
      root.querySelector(`[data-phys-str-panel="${panel}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    else if (action === 'zero-channels') {
      channelOffsets = Object.fromEntries(channels.map((channel) => [channel.id, typeof channel.value === 'number' ? channel.value : 0]));
      renderChannels();
      callbacks.onChannelZero?.();
      announce('Derived channel display offsets cleared.');
    } else if (action === 'undo') callbacks.onUndo?.();
    else if (action === 'redo') callbacks.onRedo?.();
    else if (action === 'run') emitCommand(runState === 'paused' ? 'resume' : 'run');
    else if (action === 'arm') emitCommand('run');
    else if (isRunCommand(action)) emitCommand(action);
  }, eventOptions);

  overlaySelect.addEventListener('change', () => {
    if (!isOverlay(overlaySelect.value)) return;
    setOverlay(overlaySelect.value);
    callbacks.onOverlayChange?.(overlaySelect.value);
  }, eventOptions);

  timeline.addEventListener('input', () => {
    const step = Number(timeline.value);
    callbacks.onTimelineSeek?.(step);
  }, eventOptions);

  revisionSelect.addEventListener('change', () => {
    updateRevisions(revisions, revisionSelect.value);
    callbacks.onRevisionSelect?.(revisionSelect.value);
  }, eventOptions);

  labSearch.addEventListener('input', () => renderLabs(labSearch.value), eventOptions);

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (target.dataset.physStrParameter) {
      const id = target.dataset.physStrParameter as WorkbenchParameterId;
      const value = Number(target.value);
      if (!Number.isFinite(value)) return;
      parameters = { ...parameters, [id]: value };
      syncParameterInputs();
      callbacks.onParameterChange?.(id, value);
      return;
    }
    if (target.dataset.physStrLimit) {
      limits = readLimitsFromForm();
      syncEnvelope();
      callbacks.onLimitChange?.(limits);
      return;
    }
    if (target === root.querySelector('[data-phys-str-substeps]')) {
      const value = Number(target.value);
      if (!isSubsteps(value)) return;
      substeps = value;
      callbacks.onSubstepsChange?.(value);
      return;
    }
    if (target === root.querySelector('[data-phys-str-speed]')) {
      const value = Number(target.value);
      if (!isTimeScale(value)) return;
      parameters = { ...parameters, 'time-scale': value };
      callbacks.onTimeScaleChange?.(value);
    }
  }, eventOptions);

  loadArrow.addEventListener('click', () => {
    callbacks.onForceTarget?.(0.5, 0.5);
  }, eventOptions);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawAllCharts());
  for (const canvas of canvasByChart.values()) resizeObserver?.observe(canvas);

  applyLab(lab);
  renderLabs();
  renderRevisions();
  renderPreflight([]);
  writeLimitsToForm(limits);
  syncRunButtons();
  syncLegend();
  setInspectorTab('load-case');
  if (options.viewport) attachViewport(options.viewport);
  window.requestAnimationFrame(drawAllCharts);

  return {
    root,
    attachViewport,
    updateModel,
    updateLab,
    updateRun,
    updateTelemetry,
    updatePreflight: renderPreflight,
    updateChannels,
    updateRevisions,
    updateChart,
    updateLimits,
    updateLog,
    appendLog: appendLogInternal,
    updateRuntimeCounts,
    setOverlay,
    setCompareMode,
    setInspectorTab,
    selectComponent,
    setForceTarget,
    setCallouts: renderCallouts,
    setStatus,
    setBackend,
    setParameters,
    setSubsteps,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
      viewport?.classList.remove('phys-str-attached');
      viewportMarker?.remove();
      root.remove();
    },
  };
}

export const mountPhysicsStructural = createPhysicsStructural;
