import './material-lab-desktop.css';
import { getMaterialDemoRecipe } from '../material-demos';
import {
  MATERIAL_BEHAVIOR_PRESETS,
  materialPresetForVariant,
  type MaterialBehaviorPreset,
} from '../soft/material-presets';
import {
  getMaterialLabCatalogLabs,
  hostWorkbenchLabForMaterialDemo,
  labMatchesCatalogFilter,
  materialLabCatalogCopy,
  materialLabCatalogSearchText,
  WORKBENCH_SOLVER_LABELS,
  type MaterialLabCatalogFilter,
  type WorkbenchGroup,
  type WorkbenchLabDefinition,
  type WorkbenchParameterId,
} from '../workbench/registry';
import {
  FIRST_RUN_GUIDE_COPY,
  clearFirstRunGuideDismissed,
  mountFirstRunGuide,
  type FirstRunGuideController,
} from './first-run-guide';

/**
 * Desktop Material Lab chrome matching `public/concepts/material-lab-desktop.png`.
 * The live WebGPU canvas occupies the center slot; overlays are presentation-only.
 * Built-in readouts stay normalized / simulation-unit and are not certified allowables.
 */

export const MATERIAL_LAB_DESKTOP_ROOT_CLASS = 'ml-desk';

export type { WorkbenchLabDefinition, WorkbenchParameterId } from '../workbench/registry';

export const MATERIAL_LAB_DESKTOP_VIEWS = ['lab', 'compare', 'captures'] as const;
export type MaterialLabDesktopView = (typeof MATERIAL_LAB_DESKTOP_VIEWS)[number];

export const MATERIAL_LAB_DESKTOP_FILTERS = [
  'all',
  'structural',
  'impact',
  'fluid',
  'soft-body',
  'cloth',
] as const;
export type MaterialLabDesktopFilter = (typeof MATERIAL_LAB_DESKTOP_FILTERS)[number];

export const MATERIAL_LAB_DESKTOP_COMMANDS = [
  'reset',
  'step',
  'play',
  'pause',
  'capture',
  'apply-force',
  'manage-library',
] as const;
export type MaterialLabDesktopCommand = (typeof MATERIAL_LAB_DESKTOP_COMMANDS)[number];

export const MATERIAL_LAB_DESKTOP_CONTROLS = [
  'magnitude',
  'radius',
  'impulse',
  'yield-strain',
  'hardening',
  'depth',
  'substeps',
  'iterations',
  'collision',
  'adaptive-step',
  'time-scale',
  'material-preset',
] as const;
export type MaterialLabDesktopControlId = (typeof MATERIAL_LAB_DESKTOP_CONTROLS)[number];

export const MATERIAL_LAB_DESKTOP_PLAYBACK = ['stopped', 'playing', 'paused'] as const;
export type MaterialLabDesktopPlayback = (typeof MATERIAL_LAB_DESKTOP_PLAYBACK)[number];

export const MATERIAL_LAB_DESKTOP_POINTER_MODES = ['orbit', 'force'] as const;
export type MaterialLabDesktopPointerMode = (typeof MATERIAL_LAB_DESKTOP_POINTER_MODES)[number];

export const MATERIAL_LAB_DESKTOP_RUN_STATES = [
  'idle',
  'preflight',
  'armed',
  'running',
  'paused',
  'complete',
  'aborted',
  'error',
] as const;
export type MaterialLabDesktopRunState = (typeof MATERIAL_LAB_DESKTOP_RUN_STATES)[number];

export const MATERIAL_LAB_DESKTOP_FILTER_LABELS: Readonly<Record<MaterialLabDesktopFilter, string>> = {
  all: 'ALL',
  structural: 'STRUCTURAL',
  impact: 'IMPACT',
  fluid: 'FLUID',
  'soft-body': 'SOFT BODY',
  cloth: 'CLOTH',
};

export const MATERIAL_LAB_DESKTOP_VIEW_LABELS: Readonly<Record<MaterialLabDesktopView, string>> = {
  lab: 'Lab',
  compare: 'Compare',
  captures: 'Captures',
};

export const MATERIAL_LAB_DESKTOP_IMMEDIATE_ACTIONS = ['play', 'pause', 'reset', 'apply-force'] as const;
export type MaterialLabDesktopImmediateAction = (typeof MATERIAL_LAB_DESKTOP_IMMEDIATE_ACTIONS)[number];

export const MATERIAL_LAB_DESKTOP_IMMEDIATE_ACTION_LABELS: Readonly<
  Record<MaterialLabDesktopImmediateAction, string>
> = {
  play: FIRST_RUN_GUIDE_COPY.play,
  pause: 'Pause',
  reset: FIRST_RUN_GUIDE_COPY.reset,
  'apply-force': FIRST_RUN_GUIDE_COPY.applyForce,
};

export type MaterialLabDesktopControlChange = {
  readonly control: MaterialLabDesktopControlId;
  readonly value: number | boolean | string;
  readonly parameterId?: WorkbenchParameterId;
};

export type MaterialLabDesktopTelemetry = {
  readonly timeSeconds?: number;
  readonly force?: number;
  readonly energy?: number;
  readonly peakDemand?: number;
  readonly fps?: number;
  readonly forceHistory?: readonly number[];
  readonly energyHistory?: readonly number[];
  readonly demandHistory?: readonly number[];
  readonly historyTime?: readonly number[];
};

export type MaterialLabDesktopLifecycleUpdate = {
  readonly playback?: MaterialLabDesktopPlayback;
  readonly state?: MaterialLabDesktopRunState;
  readonly elapsedSeconds?: number;
  readonly message?: string;
};

export type MaterialLabDesktopStatusUpdate = {
  readonly backend?: string;
  readonly fps?: number;
  readonly webgpu?: boolean;
};

export type MaterialLabDesktopCallbacks = {
  readonly onViewChange?: (view: MaterialLabDesktopView) => void;
  readonly onLabChange?: (labId: string) => void;
  readonly onFilterChange?: (filter: MaterialLabDesktopFilter) => void;
  readonly onCommand?: (command: MaterialLabDesktopCommand) => void | Promise<void>;
  readonly onControlChange?: (change: MaterialLabDesktopControlChange) => void;
  readonly onMaterialPresetChange?: (presetId: string) => void;
  readonly onPointerModeChange?: (mode: MaterialLabDesktopPointerMode) => void;
};

export type MaterialLabDesktopOptions = {
  readonly mount: HTMLElement;
  readonly viewport?: HTMLElement;
  readonly idPrefix?: string;
  readonly labs?: readonly WorkbenchLabDefinition[];
  readonly initialLabId?: string;
  readonly initialView?: MaterialLabDesktopView;
  readonly backendLabel?: string;
  readonly callbacks?: MaterialLabDesktopCallbacks;
};

export type MaterialLabDesktopController = {
  readonly root: HTMLElement;
  readonly viewportSlot: HTMLElement;
  getView(): MaterialLabDesktopView;
  setView(view: MaterialLabDesktopView, options?: { announce?: boolean }): void;
  getLabId(): string;
  setLabId(labId: string, options?: { announce?: boolean; emit?: boolean }): void;
  getFilter(): MaterialLabDesktopFilter;
  setFilter(filter: MaterialLabDesktopFilter): void;
  attachViewport(viewport: HTMLElement): void;
  updateTelemetry(update: MaterialLabDesktopTelemetry): void;
  updateRunLifecycle(update: MaterialLabDesktopLifecycleUpdate): void;
  updateStatus(update: MaterialLabDesktopStatusUpdate): void;
  setControl(control: MaterialLabDesktopControlId, value: number | boolean | string): void;
  setMaterialPreset(presetId: string): void;
  setPointerMode(mode: MaterialLabDesktopPointerMode, options?: { emit?: boolean }): void;
  setForceAvailable(available: boolean): void;
  destroy(): void;
};

const HISTORY_LENGTH = 80;
const SUBSTEP_VALUES = [1, 2, 4, 8, 16] as const;
const TIME_SCALE_VALUES = [0.25, 0.5, 1, 2] as const;
const SPARK_COLORS = {
  force: '#ff7900',
  energy: '#20c8f4',
  demand: '#30b9ad',
} as const;

const DEFAULT_CONTROLS = {
  magnitude: 0.75,
  radius: 1.25,
  impulse: 3.75,
  'yield-strain': 0.024,
  hardening: 0.24,
  depth: 8.6,
  substeps: 4,
  iterations: 32,
  collision: true,
  'adaptive-step': true,
  'time-scale': 1,
  'material-preset': 'aluminum-alloy',
} as const;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Material Lab desktop element not found: ${selector}`);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

function zeroHistory(): number[] {
  return Array.from({ length: HISTORY_LENGTH }, () => 0);
}

function presetSwatch(preset: MaterialBehaviorPreset): string {
  const [r, g, b] = preset.baseColor;
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

function groupIcon(group: WorkbenchGroup): string {
  switch (group) {
    case 'materials':
      return 'ph-cube';
    case 'cloth':
      return 'ph-flag';
    case 'rope':
      return 'ph-line-segments';
    case 'water':
      return 'ph-drop';
    case 'rigid':
      return 'ph-buildings';
    case 'combined':
      return 'ph-stack';
    default: {
      const exhaustive: never = group;
      throw new Error(`Unhandled workbench group: ${String(exhaustive)}`);
    }
  }
}

function groupThumbTone(group: WorkbenchGroup): string {
  switch (group) {
    case 'materials':
      return '#3a2a18';
    case 'cloth':
      return '#1a2a32';
    case 'rope':
      return '#2a2418';
    case 'water':
      return '#102430';
    case 'rigid':
      return '#1c2224';
    case 'combined':
      return '#241828';
    default: {
      const exhaustive: never = group;
      throw new Error(`Unhandled workbench group: ${String(exhaustive)}`);
    }
  }
}

function labMatchesFilter(lab: WorkbenchLabDefinition, filter: MaterialLabDesktopFilter): boolean {
  return labMatchesCatalogFilter(lab, filter as MaterialLabCatalogFilter);
}

function labCatalogCopy(lab: WorkbenchLabDefinition): { readonly title: string; readonly subtitle: string } {
  const copy = materialLabCatalogCopy(lab);
  return { title: copy.title, subtitle: copy.specimen };
}

function viewTabTitle(view: MaterialLabDesktopView): string {
  switch (view) {
    case 'lab':
      return 'This lab';
    case 'compare':
      return 'Compare runs (optional)';
    case 'captures':
      return 'Saved captures (optional)';
    default: {
      const exhaustive: never = view;
      throw new Error(`Unhandled material lab view: ${String(exhaustive)}`);
    }
  }
}

function pointerHint(mode: MaterialLabDesktopPointerMode): string {
  switch (mode) {
    case 'orbit':
      return 'Drag to orbit.';
    case 'force':
      return 'Drag to aim, then Apply force.';
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unhandled material lab pointer mode: ${String(exhaustive)}`);
    }
  }
}

function immediateActionIcon(action: MaterialLabDesktopImmediateAction): string {
  switch (action) {
    case 'play':
      return 'ph-play';
    case 'pause':
      return 'ph-pause';
    case 'reset':
      return 'ph-arrow-counter-clockwise';
    case 'apply-force':
      return 'ph-hand-tap';
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled material lab immediate action: ${String(exhaustive)}`);
    }
  }
}

function immediateActionClass(action: MaterialLabDesktopImmediateAction): string {
  switch (action) {
    case 'play':
      return 'ml-desk-action ml-desk-play';
    case 'pause':
      return 'ml-desk-action';
    case 'reset':
      return 'ml-desk-action';
    case 'apply-force':
      return 'ml-desk-action ml-desk-apply';
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled material lab immediate action: ${String(exhaustive)}`);
    }
  }
}

function playbackLabel(playback: MaterialLabDesktopPlayback): string {
  switch (playback) {
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Paused';
    case 'stopped':
      return 'Stopped';
    default: {
      const exhaustive: never = playback;
      throw new Error(`Unhandled material lab playback: ${String(exhaustive)}`);
    }
  }
}

function labPreset(lab: WorkbenchLabDefinition): MaterialBehaviorPreset | null {
  if (!('materialDemoId' in lab) || !lab.materialDemoId) return null;
  const recipe = getMaterialDemoRecipe(lab.materialDemoId);
  return recipe ? materialPresetForVariant(recipe.profileVariant) : null;
}

function labDepth(lab: WorkbenchLabDefinition): number {
  if (!('materialDemoId' in lab) || !lab.materialDemoId) return DEFAULT_CONTROLS.depth;
  return getMaterialDemoRecipe(lab.materialDemoId)?.depth ?? DEFAULT_CONTROLS.depth;
}

function playbackFromState(state: MaterialLabDesktopRunState): MaterialLabDesktopPlayback {
  switch (state) {
    case 'running':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'idle':
    case 'preflight':
    case 'armed':
    case 'complete':
    case 'aborted':
    case 'error':
      return 'stopped';
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled material lab run state: ${String(exhaustive)}`);
    }
  }
}

function parameterIdForControl(control: MaterialLabDesktopControlId): WorkbenchParameterId | undefined {
  switch (control) {
    case 'magnitude':
      return 'actuator-target';
    case 'radius':
      return 'material-strike-radius';
    case 'impulse':
      return 'impulse-strength';
    case 'time-scale':
      return 'time-scale';
    case 'yield-strain':
    case 'hardening':
    case 'depth':
    case 'substeps':
    case 'iterations':
    case 'collision':
    case 'adaptive-step':
    case 'material-preset':
      return undefined;
    default: {
      const exhaustive: never = control;
      throw new Error(`Unhandled material lab control: ${String(exhaustive)}`);
    }
  }
}

function controlReadout(control: MaterialLabDesktopControlId, value: number | boolean | string): string {
  switch (control) {
    case 'magnitude':
      return `${formatFixed(Number(value), 2)} ×`;
    case 'radius':
      return `${formatFixed(Number(value), 2)} ×`;
    case 'impulse':
      return `${formatFixed(Number(value), 2)} norm.`;
    case 'yield-strain':
      return formatFixed(Number(value), 3);
    case 'hardening':
      return formatFixed(Number(value), 2);
    case 'depth':
      return `${formatFixed(Number(value), 2)} sim`;
    case 'substeps':
    case 'iterations':
      return String(value);
    case 'time-scale':
      return `${formatFixed(Number(value), 1)}×`;
    case 'collision':
    case 'adaptive-step':
      return value ? 'On' : 'Off';
    case 'material-preset':
      return MATERIAL_BEHAVIOR_PRESETS.find((preset) => preset.id === value)?.label ?? String(value);
    default: {
      const exhaustive: never = control;
      throw new Error(`Unhandled material lab control: ${String(exhaustive)}`);
    }
  }
}

function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const pct = ((value - min) / Math.max(1e-9, max - min)) * 100;
  input.style.setProperty('--ml-desk-fill', `${pct}%`);
}

function axisMarkup(size: number): string {
  const c = size / 2;
  return `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
      <line x1="${c}" y1="${c}" x2="${size - 6}" y2="${c + 8}" stroke="#e33245" stroke-width="2" />
      <line x1="${c}" y1="${c}" x2="${c}" y2="8" stroke="#6bd657" stroke-width="2" />
      <line x1="${c}" y1="${c}" x2="10" y2="${c + 14}" stroke="#20c8f4" stroke-width="2" />
      <circle cx="${c}" cy="${c}" r="3" fill="#f1f3f2" />
      <text x="${size - 10}" y="${c + 18}" fill="#e33245" font-size="9" font-family="IBM Plex Mono, monospace">X</text>
      <text x="${c + 4}" y="10" fill="#6bd657" font-size="9" font-family="IBM Plex Mono, monospace">Y</text>
      <text x="4" y="${c + 26}" fill="#20c8f4" font-size="9" font-family="IBM Plex Mono, monospace">Z</text>
    </svg>
  `;
}

function workspaceMarkup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  const filterButtons = MATERIAL_LAB_DESKTOP_FILTERS.map((filter) => (
    `<button class="${filter === 'all' ? 'ml-desk-chip is-active' : 'ml-desk-chip'}" type="button" role="tab" aria-selected="${filter === 'all'}" data-ml-desk-filter="${filter}">${MATERIAL_LAB_DESKTOP_FILTER_LABELS[filter]}</button>`
  )).join('');
  const viewButtons = MATERIAL_LAB_DESKTOP_VIEWS.map((view) => {
    const quiet = view !== 'lab';
    return `<button class="${quiet ? 'ml-desk-tab-quiet' : 'is-active'}" type="button" role="tab" aria-selected="${view === 'lab'}" data-ml-desk-view="${view}" title="${viewTabTitle(view)}">${MATERIAL_LAB_DESKTOP_VIEW_LABELS[view]}</button>`;
  }).join('');
  const actionButtons = MATERIAL_LAB_DESKTOP_IMMEDIATE_ACTIONS.map((action) => {
    const label = MATERIAL_LAB_DESKTOP_IMMEDIATE_ACTION_LABELS[action];
    const paused = action === 'pause';
    return `<button class="${immediateActionClass(action)}" type="button" data-ml-desk-action="${action}"${paused ? ' disabled' : ''} aria-label="${label}"><i class="ph ${immediateActionIcon(action)}" aria-hidden="true"></i> ${label}</button>`;
  }).join('');
  const presetOptions = MATERIAL_BEHAVIOR_PRESETS.map((preset) => (
    `<option value="${preset.id}"${preset.id === DEFAULT_CONTROLS['material-preset'] ? ' selected' : ''}>${preset.label}</option>`
  )).join('');
  const presetSlots = MATERIAL_BEHAVIOR_PRESETS.map((preset) => (
    `<button class="ml-desk-slot${preset.id === DEFAULT_CONTROLS['material-preset'] ? ' is-active' : ''}" type="button" data-ml-desk-preset="${preset.id}" aria-label="${preset.label}" aria-pressed="${preset.id === DEFAULT_CONTROLS['material-preset']}" style="background:${presetSwatch(preset)}"></button>`
  )).join('');
  const substepButtons = SUBSTEP_VALUES.map((value) => (
    `<button class="${value === DEFAULT_CONTROLS.substeps ? 'is-active' : ''}" type="button" data-ml-desk-substeps="${value}" aria-pressed="${value === DEFAULT_CONTROLS.substeps}">${value}</button>`
  )).join('');
  const timeScaleOptions = TIME_SCALE_VALUES.map((value) => (
    `<option value="${value}"${value === DEFAULT_CONTROLS['time-scale'] ? ' selected' : ''}>${value.toFixed(1)}x</option>`
  )).join('');

  return `
    <header class="ml-desk-chrome">
      <div class="ml-desk-brand">
        <i class="ph ph-cube" aria-hidden="true"></i>
        <div class="ml-desk-brand-copy">
          <strong>BOX3D</strong>
          <span>MATERIAL LAB</span>
        </div>
        <button class="ml-desk-help" type="button" data-ml-desk-action="show-guide" aria-expanded="false">${FIRST_RUN_GUIDE_COPY.title}</button>
      </div>
      <nav class="ml-desk-tabs eng-tablist" role="tablist" aria-label="Optional views">${viewButtons}</nav>
      <div class="ml-desk-status" aria-label="Runtime status">
        <button class="eng-icon-button" type="button" data-ml-desk-action="workspace-menu" aria-label="Open workspace menu"><i class="ph ph-squares-four" aria-hidden="true"></i></button>
        <span class="ml-desk-backend"><i class="ml-desk-dot is-live" data-ml-desk="backend-dot" aria-hidden="true"></i><span data-ml-desk-value="backend">WEBGPU</span></span>
        <span class="ml-desk-fps"><strong data-ml-desk-value="fps">—</strong> FPS</span>
      </div>
    </header>

    <div class="ml-desk-body">
      <aside class="ml-desk-library" aria-label="Specimen library">
        <header>
          <div>
            <h2>SPECIMEN LIBRARY</h2>
            <p class="ml-desk-hint"><span data-ml-desk-value="lab-count">35</span> specimens · click a row to load it</p>
          </div>
        </header>
        <div class="ml-desk-search">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <label class="eng-sr-only" for="${id('search')}">Search specimens</label>
          <input id="${id('search')}" type="search" placeholder="Search specimens..." autocomplete="off" data-ml-desk="search">
        </div>
        <div class="ml-desk-filters eng-tablist" role="tablist" aria-label="Specimen filters">${filterButtons}</div>
        <div class="ml-desk-catalog" role="listbox" aria-label="Curated laboratories" data-ml-desk="catalog"></div>
      </aside>

      <main class="ml-desk-stage" aria-label="Material simulation viewport">
        <div class="eng-viewport-slot" data-eng-viewport-slot="test" data-ml-desk="viewport-slot">
          <div class="eng-empty-state eng-empty-state--viewport">
            <i class="ph ph-cube" aria-hidden="true"></i>
            <span>Live WebGPU viewport</span>
          </div>
        </div>
        <div class="ml-desk-overlay ml-desk-tools" role="group" aria-label="Pointer mode">
          <button class="is-active" type="button" data-ml-desk-pointer="orbit" aria-pressed="true"><i class="ph ph-cube-focus" aria-hidden="true"></i> Orbit</button>
          <button type="button" data-ml-desk-pointer="force" aria-pressed="false"><i class="ph ph-hand-pointing" aria-hidden="true"></i> Aim</button>
          <p class="ml-desk-tool-hint" data-ml-desk-value="pointer-hint">Drag to orbit.</p>
        </div>
        <div class="ml-desk-overlay ml-desk-guide-host" data-ml-desk="guide-host"></div>
        <div class="ml-desk-overlay ml-desk-legend" aria-label="Presentation overlay legend">
          <span><i data-swatch="demand"></i> Demand</span>
          <span><i data-swatch="strain"></i> Strain</span>
          <span><i data-swatch="plastic"></i> Plastic</span>
        </div>
        <div class="ml-desk-overlay ml-desk-colorbar" aria-label="Normalized demand scale">
          <strong>Demand (norm.)</strong>
          <div class="ml-desk-colorbar__ramp"><span>1.0</span><span>0</span></div>
        </div>
        <div class="ml-desk-overlay ml-desk-bar" aria-hidden="true"><b></b>10 sim</div>
        <div class="ml-desk-overlay ml-desk-axis">${axisMarkup(64)}</div>
        <span class="eng-provenance-badge" data-ml-desk="provenance">REDUCED NUMERICAL MODEL</span>
      </main>

      <aside class="ml-desk-inspector" aria-label="Force, material, and solver controls">
        <section class="ml-desk-group eng-control-section" data-ml-desk-group="force">
          <header>FORCE</header>
          <p class="ml-desk-hint">Optional. Use Apply force below, or just Play.</p>
          <div class="ml-desk-slider">
            <div class="ml-desk-slider__row">
              <label for="${id('magnitude')}">How hard</label>
              <output for="${id('magnitude')}" data-ml-desk-value="magnitude">0.75 ×</output>
            </div>
            <input id="${id('magnitude')}" type="range" min="0" max="2" step="0.05" value="0.75" data-ml-desk-control="magnitude">
            <div class="ml-desk-slider__ends"><span>0</span><span>2 ×</span></div>
          </div>
          <div class="ml-desk-slider">
            <div class="ml-desk-slider__row">
              <label for="${id('radius')}">How wide</label>
              <output for="${id('radius')}" data-ml-desk-value="radius">1.25 ×</output>
            </div>
            <input id="${id('radius')}" type="range" min="1" max="4" step="0.05" value="1.25" data-ml-desk-control="radius">
            <div class="ml-desk-slider__ends"><span>1 ×</span><span>4 ×</span></div>
          </div>
          <div class="ml-desk-slider is-unavailable" hidden>
            <div class="ml-desk-slider__row">
              <label for="${id('impulse')}">Impulse</label>
              <output for="${id('impulse')}" data-ml-desk-value="impulse">3.75 norm.</output>
            </div>
            <input id="${id('impulse')}" type="range" min="0" max="20" step="0.05" value="3.75" data-ml-desk-control="impulse" disabled title="Impulse is not a live control in this lab.">
            <p class="ml-desk-unavailable-note">Not available</p>
          </div>
        </section>

        <section class="ml-desk-group eng-control-section" data-ml-desk-group="material">
          <header>MATERIAL</header>
          <p class="ml-desk-hint">Set by the selected specimen.</p>
          <label class="ml-desk-field" for="${id('material')}">Material
            <select id="${id('material')}" data-ml-desk-control="material-preset" disabled title="Material is authored by the specimen. Pick a different lab to change it.">${presetOptions}</select>
          </label>
          <div class="ml-desk-slots" aria-hidden="true" hidden>${presetSlots}</div>
        </section>

        <section class="ml-desk-group eng-control-section" data-ml-desk-group="advanced">
          <button class="ml-desk-advanced" type="button" data-ml-desk-action="toggle-advanced" aria-expanded="false">
            Solver &amp; advanced <i class="ph ph-caret-right" aria-hidden="true"></i>
          </button>
          <div class="ml-desk-advanced-body" data-ml-desk="advanced-body" hidden>
            <p><span>Solver</span> <strong data-ml-desk-value="solver">Reduced-order beam lattice</strong></p>
            <p><span>Fidelity</span> <strong data-ml-desk-value="fidelity">Reduced numerical model</strong></p>
            <div>
              <p class="ml-desk-slider__row"><span>Substeps</span><output data-ml-desk-value="substeps">4</output></p>
              <div class="ml-desk-segmented" role="group" aria-label="Solver substeps">${substepButtons}</div>
            </div>
            <label class="ml-desk-field is-unavailable" for="${id('iterations')}">Iterations
              <select id="${id('iterations')}" data-ml-desk-control="iterations" disabled title="Solver iterations are not a live control in this build.">
                <option value="8">8</option>
                <option value="16">16</option>
                <option value="32" selected>32</option>
                <option value="64">64</option>
              </select>
            </label>
            <div class="ml-desk-toggle is-unavailable">
              <span>Collision <small>Not available</small></span>
              <button class="ml-desk-switch is-on" type="button" role="switch" aria-checked="true" data-ml-desk-control="collision" aria-label="Collision" disabled title="Collision is authored by the specimen."></button>
            </div>
            <div class="ml-desk-toggle is-unavailable">
              <span>Adaptive step <small>Not available</small></span>
              <button class="ml-desk-switch is-on" type="button" role="switch" aria-checked="true" data-ml-desk-control="adaptive-step" aria-label="Adaptive time step" disabled title="Adaptive stepping is not a live control in this build."></button>
            </div>
            <div class="ml-desk-slider is-unavailable">
              <div class="ml-desk-slider__row">
                <label for="${id('yield')}">Yield strain</label>
                <output for="${id('yield')}" data-ml-desk-value="yield-strain">0.024</output>
              </div>
              <input id="${id('yield')}" type="range" min="0" max="0.3" step="0.001" value="0.024" data-ml-desk-control="yield-strain" disabled title="Yield strain is authored by the specimen.">
            </div>
            <div class="ml-desk-slider is-unavailable">
              <div class="ml-desk-slider__row">
                <label for="${id('hardening')}">Hardening</label>
                <output for="${id('hardening')}" data-ml-desk-value="hardening">0.24</output>
              </div>
              <input id="${id('hardening')}" type="range" min="0" max="1" step="0.01" value="0.24" data-ml-desk-control="hardening" disabled title="Hardening is authored by the specimen.">
            </div>
            <div class="ml-desk-slider is-unavailable">
              <div class="ml-desk-slider__row">
                <label for="${id('depth')}">Depth</label>
                <output for="${id('depth')}" data-ml-desk-value="depth">8.60 sim</output>
              </div>
              <input id="${id('depth')}" type="range" min="0.1" max="20" step="0.1" value="8.6" data-ml-desk-control="depth" disabled title="Specimen depth is authored by the lab recipe.">
            </div>
            <p class="ml-desk-note">Deterministic reduced-order simulation for comparative testing. Values are not certified engineering predictions.</p>
          </div>
        </section>
      </aside>
    </div>

    <footer class="ml-desk-transport" aria-label="Playback and telemetry">
      <div class="ml-desk-actions" role="group" aria-label="Immediate actions">
        ${actionButtons}
        <span class="ml-desk-playback-state" data-ml-desk-value="playback">Stopped</span>
        <span class="ml-desk-keys" aria-hidden="true">Space play · R reset</span>
        <label class="ml-desk-inline" for="${id('time-scale')}">Time scale
          <select id="${id('time-scale')}" data-ml-desk-control="time-scale">${timeScaleOptions}</select>
        </label>
        <dl class="ml-desk-time">
          <dt>Time</dt>
          <dd data-ml-desk-value="time">0.000 s</dd>
        </dl>
        <button class="ml-desk-quiet" type="button" data-ml-desk-action="step" disabled title="Pause first to step."><i class="ph ph-skip-forward" aria-hidden="true"></i> Step</button>
        <button class="ml-desk-capture ml-desk-quiet" type="button" data-ml-desk-action="capture"><i class="ph ph-camera" aria-hidden="true"></i> Capture</button>
      </div>
      <div class="ml-desk-telemetry" aria-label="Normalized telemetry">
        <article class="ml-desk-spark" data-series="force">
          <header><span>Force (norm.)</span><output data-ml-desk-value="force">0.00</output></header>
          <canvas data-ml-desk-chart="force" role="img" aria-label="Normalized force history"></canvas>
          <footer><span>0.0</span><span>0.5 s</span></footer>
        </article>
        <article class="ml-desk-spark" data-series="energy">
          <header><span>Energy (norm.)</span><output data-ml-desk-value="energy">0.000</output></header>
          <canvas data-ml-desk-chart="energy" role="img" aria-label="Normalized energy history"></canvas>
          <footer><span>0.0</span><span>0.5 s</span></footer>
        </article>
        <article class="ml-desk-spark" data-series="demand">
          <header><span>Peak demand</span><output data-ml-desk-value="demand">0.00</output></header>
          <canvas data-ml-desk-chart="demand" role="img" aria-label="Normalized peak demand history"></canvas>
          <footer><span>0.0</span><span>0.5 s</span></footer>
        </article>
      </div>
    </footer>
    <div class="eng-live-region eng-sr-only" aria-live="polite" data-ml-desk="live-region"></div>
  `;
}

function drawSparkline(canvas: HTMLCanvasElement, values: readonly number[], color: string): void {
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
  context.fillStyle = '#0a0d0e';
  context.fillRect(0, 0, displayWidth, displayHeight);
  context.strokeStyle = '#2b3133';
  context.lineWidth = 1;
  for (let index = 0; index <= 3; index++) {
    const y = (displayHeight * index) / 3;
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(displayWidth, y + 0.5);
    context.stroke();
  }
  for (let index = 0; index <= 4; index++) {
    const x = (displayWidth * index) / 4;
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, displayHeight);
    context.stroke();
  }
  if (values.length === 0) return;
  const finite = values.filter(Number.isFinite);
  const yMin = Math.min(0, ...finite);
  const yMax = Math.max(1e-6, ...finite);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  values.forEach((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * displayWidth;
    const y = displayHeight - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * displayHeight;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

export function createMaterialLabDesktop(options: MaterialLabDesktopOptions): MaterialLabDesktopController {
  const prefix = options.idPrefix ?? 'ml-desk';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Material Lab desktop idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }
  const catalog: readonly WorkbenchLabDefinition[] = options.labs ?? getMaterialLabCatalogLabs();
  if (catalog.length === 0) throw new Error('Material Lab desktop requires at least one laboratory.');
  const labsById = new Map(catalog.map((lab) => [lab.id, lab] as const));
  const fallbackLab = catalog[0];
  if (!fallbackLab) throw new Error('Material Lab desktop requires at least one laboratory.');
  const resolveCatalogLab = (id: string | undefined): WorkbenchLabDefinition | undefined => {
    if (!id) return undefined;
    const direct = labsById.get(id);
    if (direct) return direct;
    const host = hostWorkbenchLabForMaterialDemo(id);
    if (host) {
      const hosted = labsById.get(host.id);
      if (hosted) return hosted;
    }
    return catalog.find((row) => 'materialDemoId' in row && row.materialDemoId === id);
  };
  const initialLab = resolveCatalogLab(options.initialLabId) ?? fallbackLab;

  const root = document.createElement('div');
  root.className = 'ml-desk eng-workspace';
  root.id = `${prefix}-root`;
  root.dataset.mlDesk = 'root';
  root.dataset.playback = 'stopped';
  root.dataset.pointerMode = 'orbit';
  root.setAttribute('aria-label', 'Material Lab desktop');
  root.innerHTML = workspaceMarkup(prefix);
  options.mount.append(root);

  const abortController = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abortController.signal };
  const liveRegion = required<HTMLElement>(root, '[data-ml-desk="live-region"]');
  const catalogHost = required<HTMLElement>(root, '[data-ml-desk="catalog"]');
  const viewportSlot = required<HTMLElement>(root, '[data-ml-desk="viewport-slot"]');
  const searchInput = required<HTMLInputElement>(root, '[data-ml-desk="search"]');
  const advancedBody = required<HTMLElement>(root, '[data-ml-desk="advanced-body"]');
  const playButton = required<HTMLButtonElement>(root, '.ml-desk-play');
  const pauseButton = required<HTMLButtonElement>(root, '[data-ml-desk-action="pause"]');
  const helpButton = required<HTMLButtonElement>(root, '[data-ml-desk-action="show-guide"]');
  const guideHost = required<HTMLElement>(root, '[data-ml-desk="guide-host"]');
  const canvases = {
    force: required<HTMLCanvasElement>(root, '[data-ml-desk-chart="force"]'),
    energy: required<HTMLCanvasElement>(root, '[data-ml-desk-chart="energy"]'),
    demand: required<HTMLCanvasElement>(root, '[data-ml-desk-chart="demand"]'),
  } as const;

  let callbacks: MaterialLabDesktopCallbacks = options.callbacks ?? {};
  let view: MaterialLabDesktopView = options.initialView ?? 'lab';
  let filter: MaterialLabDesktopFilter = 'all';
  let query = '';
  let labId = initialLab.id;
  let playback: MaterialLabDesktopPlayback = 'stopped';
  let pointerMode: MaterialLabDesktopPointerMode = 'orbit';
  let forceAvailable = true;
  let destroyed = false;
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let advancedOpen = false;
  let firstRunGuide: FirstRunGuideController | null = null;
  const controls: Record<MaterialLabDesktopControlId, number | boolean | string> = { ...DEFAULT_CONTROLS };
  let histories = {
    force: zeroHistory(),
    energy: zeroHistory(),
    demand: zeroHistory(),
  };

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => { if (!destroyed) liveRegion.textContent = message; }, 20);
  };

  const setBoundText = (key: string, value: string): void => {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-ml-desk-value="${key}"]`)) element.textContent = value;
  };

  const drawAllCharts = (): void => {
    drawSparkline(canvases.force, histories.force, SPARK_COLORS.force);
    drawSparkline(canvases.energy, histories.energy, SPARK_COLORS.energy);
    drawSparkline(canvases.demand, histories.demand, SPARK_COLORS.demand);
  };

  const syncPlayback = (): void => {
    root.dataset.playback = playback;
    playButton.disabled = playback === 'playing';
    playButton.classList.toggle('is-active', playback === 'playing');
    playButton.setAttribute('aria-pressed', String(playback === 'playing'));
    pauseButton.disabled = playback !== 'playing';
    pauseButton.classList.toggle('is-active', playback === 'paused');
    pauseButton.setAttribute('aria-pressed', String(playback === 'paused'));
    setBoundText('playback', playbackLabel(playback));
    const stepButton = root.querySelector<HTMLButtonElement>('[data-ml-desk-action="step"]');
    if (stepButton) {
      stepButton.disabled = playback !== 'paused';
      stepButton.title = playback === 'paused' ? 'Advance one model step' : 'Pause first to step.';
    }
  };

  const syncPointerMode = (): void => {
    root.dataset.pointerMode = pointerMode;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-pointer]')) {
      const active = button.dataset.mlDeskPointer === pointerMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    setBoundText('pointer-hint', pointerHint(pointerMode));
  };

  const setPointerMode = (next: MaterialLabDesktopPointerMode, settings: { emit?: boolean } = {}): void => {
    if (destroyed || !MATERIAL_LAB_DESKTOP_POINTER_MODES.includes(next)) return;
    if (next === 'force' && !forceAvailable) {
      pointerMode = 'orbit';
    } else {
      pointerMode = next;
    }
    syncPointerMode();
    if (settings.emit !== false) callbacks.onPointerModeChange?.(pointerMode);
  };

  const setForceAvailable = (available: boolean): void => {
    if (destroyed) return;
    forceAvailable = available;
    const applyTitle = available
      ? 'Apply the hit to the specimen'
      : 'This specimen uses a different input. Pick an impact lab to apply a point force.';
    for (const applyButton of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-action="apply-force"]')) {
      applyButton.disabled = !available;
      applyButton.title = applyTitle;
    }
    const forceTool = root.querySelector<HTMLButtonElement>('[data-ml-desk-pointer="force"]');
    if (forceTool) {
      forceTool.disabled = !available;
      forceTool.title = available ? 'Drag on the panel to aim the hit' : 'Point-force aiming is not available for this specimen.';
    }
    if (!available && pointerMode === 'force') setPointerMode('orbit', { emit: true });
  };

  const syncControlReadout = (control: MaterialLabDesktopControlId): void => {
    setBoundText(control, controlReadout(control, controls[control]));
    const input = root.querySelector(`[data-ml-desk-control="${control}"]`);
    if (input instanceof HTMLInputElement && input.type === 'range') {
      input.value = String(controls[control]);
      paintRange(input);
    } else if (input instanceof HTMLSelectElement) {
      input.value = String(controls[control]);
    } else if (input instanceof HTMLButtonElement) {
      const on = Boolean(controls[control]);
      input.classList.toggle('is-on', on);
      input.setAttribute('aria-checked', String(on));
    }
    if (control === 'substeps') {
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-substeps]')) {
        const active = Number(button.dataset.mlDeskSubsteps) === Number(controls.substeps);
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    if (control === 'material-preset') {
      const presetId = String(controls['material-preset']);
      for (const slot of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-preset]')) {
        const active = slot.dataset.mlDeskPreset === presetId;
        slot.classList.toggle('is-active', active);
        slot.setAttribute('aria-pressed', String(active));
      }
    }
  };

  const writeControl = (
    control: MaterialLabDesktopControlId,
    value: number | boolean | string,
    emit: boolean,
  ): void => {
    controls[control] = value;
    syncControlReadout(control);
    if (!emit) return;
    const parameterId = parameterIdForControl(control);
    callbacks.onControlChange?.({
      control,
      value,
      ...(parameterId !== undefined ? { parameterId } : {}),
    });
  };

  const applyMaterialPreset = (presetId: string, settings: { announce?: boolean; emit?: boolean } = {}): void => {
    const preset = MATERIAL_BEHAVIOR_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const emit = settings.emit !== false;
    writeControl('material-preset', preset.id, emit);
    writeControl('yield-strain', preset.tensileYieldStrain, emit);
    writeControl('hardening', preset.plasticCreep, emit);
    if (emit) callbacks.onMaterialPresetChange?.(preset.id);
    if (settings.announce) announce(`${preset.label} comparative profile selected.`);
  };

  const renderCatalog = (): void => {
    const normalizedQuery = query.trim().toLowerCase();
    const visible = catalog.filter((lab) => {
      if (!labMatchesFilter(lab, filter)) return false;
      if (!normalizedQuery) return true;
      const haystack = materialLabCatalogSearchText(lab).toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    catalogHost.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'ml-desk-catalog-empty';
      empty.textContent = 'No simulations match this filter.';
      catalogHost.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const lab of visible) {
      const index = catalog.indexOf(lab) + 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ml-desk-card${lab.id === labId ? ' is-active' : ''}`;
      button.dataset.mlDeskLab = lab.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(lab.id === labId));
      const copyData = labCatalogCopy(lab);
      button.setAttribute('aria-label', `${String(index).padStart(2, '0')} ${copyData.title}, ${copyData.subtitle}`);
      const thumb = document.createElement('span');
      thumb.className = 'ml-desk-card__thumb';
      thumb.style.background = groupThumbTone(lab.group);
      thumb.innerHTML = `<i class="ph ${groupIcon(lab.group)}" aria-hidden="true"></i>`;
      const indexNode = document.createElement('span');
      indexNode.className = 'ml-desk-card__index';
      indexNode.textContent = String(index).padStart(2, '0');
      const copy = document.createElement('span');
      copy.className = 'ml-desk-card__copy';
      const title = document.createElement('strong');
      title.textContent = copyData.title;
      const subtitle = document.createElement('span');
      subtitle.textContent = copyData.subtitle;
      copy.append(title, subtitle);
      const badge = document.createElement('span');
      badge.className = 'ml-desk-card__badge';
      badge.textContent = lab.id === labId ? 'Specimen' : '';
      badge.hidden = lab.id !== labId;
      const mark = document.createElement('span');
      mark.className = 'ml-desk-card__mark';
      button.append(thumb, indexNode, copy, badge, mark);
      fragment.append(button);
    }
    catalogHost.append(fragment);
    scheduleCatalogReveal();
  };

  const revealActiveCatalogCard = (): void => {
    if (destroyed) return;
    const active = catalogHost.querySelector<HTMLElement>(`[data-ml-desk-lab="${CSS.escape(labId)}"]`);
    if (!active || catalogHost.clientHeight <= 0) return;
    const hostRect = catalogHost.getBoundingClientRect();
    const cardRect = active.getBoundingClientRect();
    const pad = 6;
    if (cardRect.top >= hostRect.top - 1 && cardRect.bottom <= hostRect.bottom + 1) return;
    if (cardRect.bottom > hostRect.bottom) {
      catalogHost.scrollTop += cardRect.bottom - hostRect.bottom + pad;
    } else if (cardRect.top < hostRect.top) {
      catalogHost.scrollTop += cardRect.top - hostRect.top - pad;
    }
  };

  const scheduleCatalogReveal = (): void => {
    const run = (): void => { revealActiveCatalogCard(); };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    window.setTimeout(run, 80);
    window.setTimeout(run, 220);
  };

  const syncLabChrome = (lab: WorkbenchLabDefinition): void => {
    setBoundText('solver', WORKBENCH_SOLVER_LABELS[lab.solver]);
    setBoundText('fidelity', lab.fidelity);
    setBoundText('specimen-title', labCatalogCopy(lab).title);
    const provenance = required<HTMLElement>(root, '[data-ml-desk="provenance"]');
    provenance.textContent = lab.fidelity.toUpperCase();
    controls.depth = labDepth(lab);
    syncControlReadout('depth');
    const preset = labPreset(lab);
    if (preset) applyMaterialPreset(preset.id, { emit: false });
  };

  const setFilter = (next: MaterialLabDesktopFilter): void => {
    if (destroyed || !MATERIAL_LAB_DESKTOP_FILTERS.includes(next)) return;
    filter = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-filter]')) {
      const active = button.dataset.mlDeskFilter === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    renderCatalog();
    callbacks.onFilterChange?.(next);
  };

  const setView = (next: MaterialLabDesktopView, settings: { announce?: boolean } = {}): void => {
    if (destroyed || !MATERIAL_LAB_DESKTOP_VIEWS.includes(next)) return;
    view = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-desk-view]')) {
      const active = button.dataset.mlDeskView === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    callbacks.onViewChange?.(next);
    if (settings.announce !== false) announce(`${MATERIAL_LAB_DESKTOP_VIEW_LABELS[next]} view selected.`);
  };

  const setLabId = (nextId: string, settings: { announce?: boolean; emit?: boolean } = {}): void => {
    if (destroyed) return;
    const lab = resolveCatalogLab(nextId);
    if (!lab) return;
    const changed = lab.id !== labId;
    labId = lab.id;
    if (changed) {
      renderCatalog();
      syncLabChrome(lab);
    }
    if (settings.emit !== false && changed) callbacks.onLabChange?.(lab.id);
    if (changed && settings.announce !== false) announce(`${lab.title} selected.`);
  };

  const attachViewport = (nextViewport: HTMLElement): void => {
    if (destroyed) return;
    if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    viewportMarker?.remove();
    viewport?.classList.remove('eng-attached-viewport');
    delete viewport?.dataset.engViewportWorkspace;
    viewport = nextViewport;
    viewportMarker = document.createComment(`${prefix}-viewport-origin`);
    nextViewport.parentNode?.insertBefore(viewportMarker, nextViewport);
    viewportSlot.append(nextViewport);
    nextViewport.classList.add('eng-attached-viewport');
    nextViewport.dataset.engViewportWorkspace = 'test';
  };

  const updateTelemetry = (update: MaterialLabDesktopTelemetry): void => {
    if (update.timeSeconds !== undefined) setBoundText('time', `${formatFixed(update.timeSeconds, 3)} s`);
    if (update.force !== undefined) {
      setBoundText('force', formatFixed(update.force, 2));
      histories = { ...histories, force: [...histories.force.slice(1), update.force] };
    }
    if (update.energy !== undefined) {
      histories = { ...histories, energy: [...histories.energy.slice(1), update.energy] };
    }
    if (update.peakDemand !== undefined) {
      setBoundText('demand', formatFixed(update.peakDemand, 2));
      histories = { ...histories, demand: [...histories.demand.slice(1), update.peakDemand] };
    }
    if (update.forceHistory) histories = { ...histories, force: [...update.forceHistory] };
    if (update.energyHistory) histories = { ...histories, energy: [...update.energyHistory] };
    if (update.demandHistory) histories = { ...histories, demand: [...update.demandHistory] };
    if (update.energy !== undefined || update.energyHistory) {
      const lastEnergy = histories.energy[histories.energy.length - 1] ?? 0;
      setBoundText('energy', formatFixed(lastEnergy, 3));
      const energyOut = root.querySelector<HTMLElement>('[data-ml-desk-value="energy"]');
      if (energyOut) {
        energyOut.title = 'Normalized kinetic + elastic + plastic + damping proxy. Same series as the chart. Not joules.';
      }
    }
    if (update.fps !== undefined && Number.isFinite(update.fps)) {
      setBoundText('fps', String(Math.max(0, Math.round(update.fps))));
    }
    drawAllCharts();
  };

  const updateRunLifecycle = (update: MaterialLabDesktopLifecycleUpdate): void => {
    if (update.state) playback = playbackFromState(update.state);
    if (update.playback) playback = update.playback;
    syncPlayback();
    if (update.elapsedSeconds !== undefined) setBoundText('time', `${formatFixed(update.elapsedSeconds, 3)} s`);
    if (update.message) announce(update.message);
  };

  const updateStatus = (update: MaterialLabDesktopStatusUpdate): void => {
    if (update.backend) setBoundText('backend', update.backend);
    if (update.fps !== undefined && Number.isFinite(update.fps)) {
      setBoundText('fps', String(Math.max(0, Math.round(update.fps))));
    }
    if (update.webgpu !== undefined) {
      required<HTMLElement>(root, '[data-ml-desk="backend-dot"]').classList.toggle('is-live', update.webgpu);
    }
  };

  const setControl = (control: MaterialLabDesktopControlId, value: number | boolean | string): void => {
    if (control === 'material-preset') {
      applyMaterialPreset(String(value), { emit: false });
      return;
    }
    writeControl(control, value, false);
  };

  const emitCommand = (command: MaterialLabDesktopCommand): void => {
    switch (command) {
      case 'reset':
        playback = 'stopped';
        syncPlayback();
        setBoundText('time', '0.000 s');
        announce('Reset. Specimen restored.');
        break;
      case 'play':
        playback = 'playing';
        syncPlayback();
        announce('Playing. Watch the viewport and the graphs.');
        break;
      case 'pause':
        playback = 'paused';
        syncPlayback();
        announce('Paused.');
        break;
      case 'apply-force':
        announce('Force applied. Press Play to watch the result.');
        break;
      case 'step':
      case 'capture':
        break;
      case 'manage-library':
        setFilter('all');
        searchInput.focus();
        break;
      default: {
        const exhaustive: never = command;
        throw new Error(`Unhandled material lab command: ${String(exhaustive)}`);
      }
    }
    void callbacks.onCommand?.(command);
  };

  const syncGuideChrome = (visible: boolean): void => {
    helpButton.setAttribute('aria-expanded', String(visible));
    root.dataset.guide = visible ? 'open' : 'dismissed';
  };

  const attachGuide = (): void => {
    if (guideHost.querySelector('.frg')) {
      syncGuideChrome(true);
      return;
    }
    firstRunGuide?.destroy();
    firstRunGuide = mountFirstRunGuide({
      mount: guideHost,
      callbacks: {
        play: () => emitCommand('play'),
        applyForce: () => emitCommand('apply-force'),
        reset: () => emitCommand('reset'),
      },
    });
    syncGuideChrome(Boolean(firstRunGuide.root));
  };

  const showGuide = (): void => {
    if (guideHost.querySelector('.frg')) return;
    clearFirstRunGuideDismissed();
    attachGuide();
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const viewButton = target?.closest<HTMLButtonElement>('[data-ml-desk-view]');
    if (viewButton) {
      const next = viewButton.dataset.mlDeskView as MaterialLabDesktopView;
      setView(next);
      return;
    }
    const filterButton = target?.closest<HTMLButtonElement>('[data-ml-desk-filter]');
    if (filterButton) {
      setFilter(filterButton.dataset.mlDeskFilter as MaterialLabDesktopFilter);
      return;
    }
    const labButton = target?.closest<HTMLButtonElement>('[data-ml-desk-lab]');
    if (labButton?.dataset.mlDeskLab) {
      setLabId(labButton.dataset.mlDeskLab);
      return;
    }
    const pointerButton = target?.closest<HTMLButtonElement>('[data-ml-desk-pointer]');
    const pointerNext = pointerButton?.dataset.mlDeskPointer;
    if (pointerButton && pointerNext && MATERIAL_LAB_DESKTOP_POINTER_MODES.includes(pointerNext as MaterialLabDesktopPointerMode)) {
      setPointerMode(pointerNext as MaterialLabDesktopPointerMode, { emit: true });
      announce(pointerHint(pointerNext as MaterialLabDesktopPointerMode));
      return;
    }
    const presetButton = target?.closest<HTMLButtonElement>('[data-ml-desk-preset]');
    if (presetButton?.dataset.mlDeskPreset) {
      applyMaterialPreset(presetButton.dataset.mlDeskPreset, { announce: true, emit: true });
      return;
    }
    const substepButton = target?.closest<HTMLButtonElement>('[data-ml-desk-substeps]');
    if (substepButton) {
      writeControl('substeps', Number(substepButton.dataset.mlDeskSubsteps), true);
      return;
    }
    const switchButton = target?.closest<HTMLButtonElement>('[data-ml-desk-control][role="switch"]');
    if (switchButton && !switchButton.disabled) {
      const control = switchButton.dataset.mlDeskControl as MaterialLabDesktopControlId;
      writeControl(control, !Boolean(controls[control]), true);
      return;
    }
    const actionButton = target?.closest<HTMLButtonElement>('[data-ml-desk-action]');
    const action = actionButton?.dataset.mlDeskAction;
    if (!action) return;
    if (action === 'toggle-advanced') {
      advancedOpen = !advancedOpen;
      advancedBody.hidden = !advancedOpen;
      actionButton?.setAttribute('aria-expanded', String(advancedOpen));
      actionButton?.closest('.ml-desk-group')?.classList.toggle('is-open', advancedOpen);
      return;
    }
    if (action === 'show-guide') {
      showGuide();
      return;
    }
    if (action === 'workspace-menu') {
      root.dispatchEvent(new CustomEvent('material-lab-workspace-menu', { bubbles: true }));
      return;
    }
    if (MATERIAL_LAB_DESKTOP_COMMANDS.includes(action as MaterialLabDesktopCommand)) {
      emitCommand(action as MaterialLabDesktopCommand);
    }
  }, eventOptions);

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderCatalog();
  }, eventOptions);

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    const control = target.dataset.mlDeskControl as MaterialLabDesktopControlId | undefined;
    if (!control) return;
    if (control === 'material-preset') {
      applyMaterialPreset(target.value, { announce: true, emit: true });
      return;
    }
    if (control === 'collision' || control === 'adaptive-step') return;
    const numeric = control === 'iterations' || target instanceof HTMLInputElement;
    writeControl(control, numeric ? Number(target.value) : target.value, true);
  }, eventOptions);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawAllCharts());
  resizeObserver?.observe(canvases.force);
  resizeObserver?.observe(canvases.energy);
  resizeObserver?.observe(canvases.demand);

  setBoundText('lab-count', String(catalog.length));
  if (options.backendLabel) setBoundText('backend', options.backendLabel);
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="range"]')) paintRange(input);
  renderCatalog();
  syncLabChrome(initialLab);
  syncPlayback();
  syncPointerMode();
  attachGuide();
  setView(view, { announce: false });
  if (options.viewport) attachViewport(options.viewport);
  window.requestAnimationFrame(drawAllCharts);

  return {
    root,
    viewportSlot,
    getView: () => view,
    setView,
    getLabId: () => labId,
    setLabId,
    getFilter: () => filter,
    setFilter,
    attachViewport,
    updateTelemetry,
    updateRunLifecycle,
    updateStatus,
    setControl,
    setMaterialPreset: (presetId) => applyMaterialPreset(presetId, { emit: false }),
    setPointerMode: (mode, options) => setPointerMode(mode, options),
    setForceAvailable,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      firstRunGuide?.destroy();
      firstRunGuide = null;
      root.closest('.eng-workspaces')?.querySelector('[data-ml-desk-guide-sentinel]')?.remove();
      if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
      viewport?.classList.remove('eng-attached-viewport');
      delete viewport?.dataset.engViewportWorkspace;
      viewportMarker?.remove();
      root.remove();
    },
  };
}

export const mountMaterialLabDesktop = createMaterialLabDesktop;
