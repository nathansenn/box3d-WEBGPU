import './material-lab-mobile.css';
import {
  catalogFiltersForLab,
  getMaterialLabCatalogLabs,
  materialLabCatalogCopy,
} from '../workbench/registry';

export const MATERIAL_LAB_MOBILE_BREAKPOINT_PX = 760;
export const MATERIAL_LAB_MOBILE_PHONE_PX = 430;

export const MATERIAL_LAB_MOBILE_TABS = ['force', 'material', 'solver'] as const;
export type MaterialLabMobileTab = (typeof MATERIAL_LAB_MOBILE_TABS)[number];

export const MATERIAL_LAB_MOBILE_TOOLS = ['orbit', 'apply-force'] as const;
export type MaterialLabMobileTool = (typeof MATERIAL_LAB_MOBILE_TOOLS)[number];

export const MATERIAL_LAB_MOBILE_SHEETS = ['peek', 'controls', 'expanded'] as const;
export type MaterialLabMobileSheet = (typeof MATERIAL_LAB_MOBILE_SHEETS)[number];

export const MATERIAL_LAB_MOBILE_BREAKPOINTS = ['phone', 'phablet', 'wide'] as const;
export type MaterialLabMobileBreakpoint = (typeof MATERIAL_LAB_MOBILE_BREAKPOINTS)[number];

export const MATERIAL_LAB_MOBILE_SUBSTEPS = [1, 2, 4, 8, 16] as const;
export type MaterialLabMobileSubsteps = (typeof MATERIAL_LAB_MOBILE_SUBSTEPS)[number];

export const MATERIAL_LAB_MOBILE_LIBRARY_FILTERS = [
  'all',
  'structural',
  'impact',
  'fluid',
  'soft-body',
  'cloth',
] as const;
export type MaterialLabMobileLibraryFilter = (typeof MATERIAL_LAB_MOBILE_LIBRARY_FILTERS)[number];

export const MATERIAL_LAB_MOBILE_PLAYBACK_COMMANDS = [
  'reset',
  'step',
  'play',
  'pause',
  'capture',
] as const;
export type MaterialLabMobilePlaybackCommand = (typeof MATERIAL_LAB_MOBILE_PLAYBACK_COMMANDS)[number];

export type MaterialLabMobileScalar = {
  readonly value: number;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
};

export type MaterialLabMobileForce = {
  readonly magnitude: MaterialLabMobileScalar;
  readonly radius: MaterialLabMobileScalar;
  readonly impulse: MaterialLabMobileScalar;
};

export type MaterialLabMobileMaterial = {
  readonly id: string;
  readonly label: string;
  readonly yieldStrength: MaterialLabMobileScalar;
  readonly hardening: MaterialLabMobileScalar;
  readonly thickness: MaterialLabMobileScalar;
};

export type MaterialLabMobileSolver = {
  readonly substeps: MaterialLabMobileSubsteps;
  readonly iterations: number;
  readonly collision: boolean;
  readonly adaptiveTimeStep: boolean;
};

export type MaterialLabMobileSimulation = {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly subtitle: string;
  readonly group: Exclude<MaterialLabMobileLibraryFilter, 'all'>;
};

export type MaterialLabMobileStressLegend = {
  readonly title: string;
  readonly highLabel: string;
  readonly lowLabel: string;
};

export type MaterialLabMobileState = {
  readonly title: string;
  readonly tool: MaterialLabMobileTool;
  readonly tab: MaterialLabMobileTab;
  readonly sheet: MaterialLabMobileSheet;
  readonly playing: boolean;
  readonly timeSeconds: number;
  readonly force: MaterialLabMobileForce;
  readonly material: MaterialLabMobileMaterial;
  readonly materials: readonly MaterialLabMobileMaterial[];
  readonly solver: MaterialLabMobileSolver;
  readonly simulations: readonly MaterialLabMobileSimulation[];
  readonly activeSimulationId: string;
  readonly libraryOpen: boolean;
  readonly libraryQuery: string;
  readonly libraryFilter: MaterialLabMobileLibraryFilter;
  readonly forceSectionOpen: boolean;
  readonly stress: MaterialLabMobileStressLegend;
};

export type MaterialLabMobileUpdate = {
  readonly title?: string;
  readonly tool?: MaterialLabMobileTool;
  readonly tab?: MaterialLabMobileTab;
  readonly sheet?: MaterialLabMobileSheet;
  readonly playing?: boolean;
  readonly timeSeconds?: number;
  readonly force?: {
    readonly magnitude?: Partial<MaterialLabMobileScalar>;
    readonly radius?: Partial<MaterialLabMobileScalar>;
    readonly impulse?: Partial<MaterialLabMobileScalar>;
  };
  readonly material?: Partial<MaterialLabMobileMaterial>;
  readonly materials?: readonly MaterialLabMobileMaterial[];
  readonly solver?: Partial<MaterialLabMobileSolver>;
  readonly simulations?: readonly MaterialLabMobileSimulation[];
  readonly activeSimulationId?: string;
  readonly libraryOpen?: boolean;
  readonly libraryQuery?: string;
  readonly libraryFilter?: MaterialLabMobileLibraryFilter;
  readonly forceSectionOpen?: boolean;
  readonly stress?: Partial<MaterialLabMobileStressLegend>;
};

export type MaterialLabMobileCallbacks = {
  readonly onToolChange?: (tool: MaterialLabMobileTool) => void;
  readonly onTabChange?: (tab: MaterialLabMobileTab) => void;
  readonly onSheetChange?: (sheet: MaterialLabMobileSheet) => void;
  readonly onForceChange?: (force: MaterialLabMobileForce) => void;
  readonly onApplyForce?: (force: MaterialLabMobileForce) => void;
  readonly onMaterialChange?: (material: MaterialLabMobileMaterial) => void;
  readonly onSolverChange?: (solver: MaterialLabMobileSolver) => void;
  readonly onPlayback?: (command: MaterialLabMobilePlaybackCommand) => void;
  readonly onSimulationSelect?: (id: string) => void;
  readonly onLibraryToggle?: (open: boolean) => void;
};

export type MaterialLabMobileOptions = {
  readonly mount: HTMLElement;
  readonly viewport?: HTMLElement;
  readonly idPrefix?: string;
  readonly initialState?: MaterialLabMobileUpdate;
  readonly callbacks?: MaterialLabMobileCallbacks;
};

export type MaterialLabMobileController = {
  readonly root: HTMLElement;
  update(patch: MaterialLabMobileUpdate): void;
  attachViewport(viewport: HTMLElement): void;
  getState(): MaterialLabMobileState;
  getBreakpoint(): MaterialLabMobileBreakpoint;
  destroy(): void;
};

const DEFAULT_MATERIALS: readonly MaterialLabMobileMaterial[] = [
  {
    id: 'aluminum-6061-t6',
    label: 'Aluminum 6061-T6',
    yieldStrength: { value: 0.024, unit: 'strain', min: 0.004, max: 0.08, step: 0.001 },
    hardening: { value: 0.28, unit: '', min: 0, max: 1, step: 0.01 },
    thickness: { value: 3, unit: 'sim', min: 0.5, max: 12, step: 0.05 },
  },
  {
    id: 'structural-steel',
    label: 'Structural Steel',
    yieldStrength: { value: 0.02, unit: 'strain', min: 0.004, max: 0.08, step: 0.001 },
    hardening: { value: 0.2, unit: '', min: 0, max: 1, step: 0.01 },
    thickness: { value: 4, unit: 'sim', min: 0.5, max: 12, step: 0.05 },
  },
  {
    id: 'copper',
    label: 'Copper',
    yieldStrength: { value: 0.012, unit: 'strain', min: 0.004, max: 0.08, step: 0.001 },
    hardening: { value: 0.4, unit: '', min: 0, max: 1, step: 0.01 },
    thickness: { value: 2.5, unit: 'sim', min: 0.5, max: 12, step: 0.05 },
  },
];

function catalogGroup(
  lab: ReturnType<typeof getMaterialLabCatalogLabs>[number],
): Exclude<MaterialLabMobileLibraryFilter, 'all'> {
  const filters = catalogFiltersForLab(lab);
  for (const filter of filters) {
    if (filter !== 'all') return filter;
  }
  return 'structural';
}

const DEFAULT_SIMULATIONS: readonly MaterialLabMobileSimulation[] = getMaterialLabCatalogLabs().map((lab, index) => {
  const copy = materialLabCatalogCopy(lab);
  return {
    id: lab.id,
    index: String(index + 1).padStart(2, '0'),
    title: copy.title,
    subtitle: copy.specimen,
    group: catalogGroup(lab),
  };
});

const DEFAULT_FORCE: MaterialLabMobileForce = {
  magnitude: { value: 1, unit: '×', min: 0.25, max: 2, step: 0.05 },
  radius: { value: 1, unit: '×', min: 1, max: 4, step: 0.25 },
  impulse: { value: 1, unit: 'normalized', min: 0.25, max: 2, step: 0.05 },
};

const DEFAULT_SOLVER: MaterialLabMobileSolver = {
  substeps: 4,
  iterations: 32,
  collision: true,
  adaptiveTimeStep: true,
};

const DEFAULT_STRESS: MaterialLabMobileStressLegend = {
  title: 'Normalized demand',
  highLabel: 'High',
  lowLabel: 'Low',
};

const SHEET_HEIGHTS: Readonly<Record<MaterialLabMobileSheet, number>> = {
  peek: 136,
  controls: 300,
  expanded: 640,
};

const ITERATION_OPTIONS = [8, 16, 32, 64] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Material Lab mobile element not found: ${selector}`);
  return element;
}

function mergeScalar(base: MaterialLabMobileScalar, patch?: Partial<MaterialLabMobileScalar>): MaterialLabMobileScalar {
  if (!patch) return base;
  const min = patch.min ?? base.min;
  const max = patch.max ?? base.max;
  const step = patch.step ?? base.step;
  const value = clamp(patch.value ?? base.value, min, max);
  return { value, unit: patch.unit ?? base.unit, min, max, step };
}

function formatScalar(scalar: MaterialLabMobileScalar): string {
  const decimals = scalar.step < 0.1 ? 2 : scalar.step < 1 ? 1 : 0;
  const value = scalar.value.toFixed(decimals);
  return scalar.unit ? `${value} ${scalar.unit}` : value;
}

function formatTime(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(3)} s`;
}

function sliderFill(scalar: MaterialLabMobileScalar): string {
  const span = Math.max(1e-9, scalar.max - scalar.min);
  return `${((scalar.value - scalar.min) / span) * 100}%`;
}

function hueForId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 360} 28% 32%)`;
}

export function materialLabMobileBreakpoint(width = typeof window === 'undefined' ? MATERIAL_LAB_MOBILE_PHONE_PX : window.innerWidth): MaterialLabMobileBreakpoint {
  if (width <= MATERIAL_LAB_MOBILE_PHONE_PX) return 'phone';
  if (width <= MATERIAL_LAB_MOBILE_BREAKPOINT_PX) return 'phablet';
  return 'wide';
}

export function isMaterialLabMobileViewport(width = typeof window === 'undefined' ? MATERIAL_LAB_MOBILE_PHONE_PX : window.innerWidth): boolean {
  return width <= MATERIAL_LAB_MOBILE_BREAKPOINT_PX;
}

function tabCopy(tab: MaterialLabMobileTab): { label: string; icon: string } {
  switch (tab) {
    case 'force': return { label: 'Force', icon: 'ph-target' };
    case 'material': return { label: 'Material', icon: 'ph-hexagon' };
    case 'solver': return { label: 'More', icon: 'ph-faders' };
    default: {
      const exhaustive: never = tab;
      return exhaustive;
    }
  }
}

function toolCopy(tool: MaterialLabMobileTool): { label: string; icon: string } {
  switch (tool) {
    case 'orbit': return { label: 'Orbit', icon: 'ph-cube' };
    case 'apply-force': return { label: 'Aim', icon: 'ph-hand-pointing' };
    default: {
      const exhaustive: never = tool;
      return exhaustive;
    }
  }
}

function toolHint(tool: MaterialLabMobileTool): string {
  switch (tool) {
    case 'orbit': return 'Drag to rotate the view.';
    case 'apply-force': return 'Aim: drag to place the hit, then tap Apply force.';
    default: {
      const exhaustive: never = tool;
      return exhaustive;
    }
  }
}

function howtoCopy(playing: boolean): string {
  return playing
    ? 'Playing now. Tap Apply force to hit the panel.'
    : 'Tap Apply force, then Play.';
}

function filterLabel(filter: MaterialLabMobileLibraryFilter): string {
  switch (filter) {
    case 'all': return 'All';
    case 'structural': return 'Structural';
    case 'impact': return 'Impact';
    case 'fluid': return 'Fluid';
    case 'soft-body': return 'Soft Body';
    case 'cloth': return 'Cloth';
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

function playbackLabel(command: MaterialLabMobilePlaybackCommand): string {
  switch (command) {
    case 'reset': return 'Reset';
    case 'step': return 'Step';
    case 'play': return 'Play';
    case 'pause': return 'Pause';
    case 'capture': return 'Capture';
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

function createDefaultState(): MaterialLabMobileState {
  return {
    title: 'Ballistic Dent',
    tool: 'orbit',
    tab: 'force',
    sheet: 'peek',
    playing: true,
    timeSeconds: 0,
    force: DEFAULT_FORCE,
    material: DEFAULT_MATERIALS[0],
    materials: DEFAULT_MATERIALS,
    solver: DEFAULT_SOLVER,
    simulations: DEFAULT_SIMULATIONS,
    activeSimulationId: 'titan-bend-dent',
    libraryOpen: false,
    libraryQuery: '',
    libraryFilter: 'all',
    forceSectionOpen: true,
    stress: DEFAULT_STRESS,
  };
}

function applyUpdate(state: MaterialLabMobileState, patch: MaterialLabMobileUpdate): MaterialLabMobileState {
  const materials = patch.materials ?? state.materials;
  const materialPatch = patch.material;
  const selected = materialPatch?.id
    ? materials.find((item) => item.id === materialPatch.id) ?? state.material
    : state.material;
  const material: MaterialLabMobileMaterial = {
    ...selected,
    ...materialPatch,
    yieldStrength: mergeScalar(selected.yieldStrength, materialPatch?.yieldStrength),
    hardening: mergeScalar(selected.hardening, materialPatch?.hardening),
    thickness: mergeScalar(selected.thickness, materialPatch?.thickness),
  };
  const solverPatch = patch.solver;
  const substeps = solverPatch?.substeps ?? state.solver.substeps;
  const solver: MaterialLabMobileSolver = {
    ...state.solver,
    ...solverPatch,
    substeps: MATERIAL_LAB_MOBILE_SUBSTEPS.includes(substeps) ? substeps : state.solver.substeps,
  };
  return {
    ...state,
    ...patch,
    force: {
      magnitude: mergeScalar(state.force.magnitude, patch.force?.magnitude),
      radius: mergeScalar(state.force.radius, patch.force?.radius),
      impulse: mergeScalar(state.force.impulse, patch.force?.impulse),
    },
    material,
    materials,
    solver,
    stress: { ...state.stress, ...patch.stress },
  };
}

function markup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  const tabs = MATERIAL_LAB_MOBILE_TABS.map((tab) => {
    const copy = tabCopy(tab);
    return `<button class="ml-mob-tab" type="button" role="tab" id="${id(`tab-${tab}`)}" data-ml-mob-tab="${tab}" aria-controls="${id(`panel-${tab}`)}" aria-selected="${tab === 'force'}"><i class="ph ${copy.icon}" aria-hidden="true"></i>${copy.label}</button>`;
  }).join('');
  const tools = MATERIAL_LAB_MOBILE_TOOLS.map((tool) => {
    const copy = toolCopy(tool);
    return `<button class="ml-mob-tool" type="button" data-ml-mob-tool="${tool}" aria-pressed="${tool === 'orbit'}"><i class="ph ${copy.icon}" aria-hidden="true"></i>${copy.label}</button>`;
  }).join('');
  const substeps = MATERIAL_LAB_MOBILE_SUBSTEPS.map((value) => (
    `<button type="button" data-ml-mob-substeps="${value}" aria-pressed="${value === 4}">${value}</button>`
  )).join('');
  const iterations = ITERATION_OPTIONS.map((value) => (
    `<option value="${value}"${value === 32 ? ' selected' : ''}>${value}</option>`
  )).join('');
  const chips = MATERIAL_LAB_MOBILE_LIBRARY_FILTERS.map((filter) => (
    `<button class="ml-mob-chip eng-filter-chip" type="button" data-ml-mob-filter="${filter}" aria-pressed="${filter === 'all'}">${filterLabel(filter)}</button>`
  )).join('');
  return `
    <header class="ml-mob-header">
      <p class="ml-mob-brand" aria-label="BOX3D">BOX<span>3D</span></p>
      <h1 class="ml-mob-title" data-ml-mob-title>Ballistic Dent</h1>
      <button class="ml-mob-library-btn" type="button" data-ml-mob-action="library" aria-controls="${id('library')}" aria-expanded="false" aria-label="Open simulation library"><i class="ph ph-stack" aria-hidden="true"></i></button>
    </header>

    <section class="ml-mob-stage" aria-label="Material laboratory viewport">
      <div class="ml-mob-viewport" data-ml-mob-viewport-slot>
        <div class="ml-mob-viewport-empty" data-ml-mob-viewport-empty>Live WebGPU viewport</div>
      </div>
      <div class="ml-mob-hud">
        <div class="ml-mob-stress" aria-label="Normalized demand legend">
          <span class="ml-mob-stress-title" data-ml-mob-stress-title>Normalized demand</span>
          <div class="ml-mob-stress-scale">
            <span class="ml-mob-stress-bar" aria-hidden="true"></span>
            <div class="ml-mob-stress-ticks">
              <span data-ml-mob-stress-high>High</span>
              <span data-ml-mob-stress-low>Low</span>
            </div>
          </div>
        </div>
        <div class="ml-mob-reticle" data-ml-mob-reticle aria-hidden="true"><span class="ml-mob-reticle-core"></span></div>
        <div class="ml-mob-gizmo" aria-hidden="true">
          <svg viewBox="0 0 56 56" role="img" aria-label="Coordinate axes">
            <line x1="18" y1="38" x2="48" y2="38" stroke="#e33245" stroke-width="2.4" stroke-linecap="round"/>
            <polygon points="48,38 41,34.4 41,41.6" fill="#e33245"/>
            <line x1="18" y1="38" x2="18" y2="10" stroke="#6bd657" stroke-width="2.4" stroke-linecap="round"/>
            <polygon points="18,10 14.4,17 21.6,17" fill="#6bd657"/>
            <line x1="18" y1="38" x2="6" y2="48" stroke="#20c8f4" stroke-width="2.4" stroke-linecap="round"/>
            <polygon points="6,48 12.4,47.2 9.2,42.2" fill="#20c8f4"/>
            <text x="50" y="34" fill="#e33245" font-size="8" font-family="IBM Plex Mono, monospace">X</text>
            <text x="22" y="12" fill="#6bd657" font-size="8" font-family="IBM Plex Mono, monospace">Y</text>
            <text x="1" y="54" fill="#20c8f4" font-size="8" font-family="IBM Plex Mono, monospace">Z</text>
          </svg>
        </div>
      </div>
      <div class="ml-mob-tools" role="group" aria-label="Viewport interaction mode">${tools}</div>
    </section>

    <section class="ml-mob-sheet eng-sheet" data-ml-mob-sheet-el aria-label="Material lab controls">
      <button class="ml-mob-grabber eng-sheet__handle" type="button" data-ml-mob-action="sheet" aria-label="Resize control sheet">
        <span class="ml-mob-grabber-bar"></span>
      </button>
      <p class="ml-mob-howto" data-ml-mob-howto>Playing now. Tap Apply force to hit the panel.</p>
      <footer class="ml-mob-playback" aria-label="Playback controls">
        <button class="ml-mob-play-btn" type="button" data-ml-mob-playback="reset"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>Reset</button>
        <button class="ml-mob-play-toggle" type="button" data-ml-mob-playback="toggle-play" aria-label="Pause"><i class="ph ph-pause" aria-hidden="true"></i></button>
        <button class="ml-mob-apply" type="button" data-ml-mob-action="apply-force"><i class="ph ph-hand-tap" aria-hidden="true"></i> Apply force</button>
        <output class="ml-mob-time" data-ml-mob-time>0.000 s</output>
      </footer>
      <div class="ml-mob-sheet-body">
        <div class="ml-mob-panel" id="${id('panel-force')}" role="tabpanel" data-ml-mob-panel="force" aria-labelledby="${id('tab-force')}">
          <h2 class="ml-mob-section-head">Hit the panel</h2>
          <div class="ml-mob-field">
            <div class="ml-mob-field-label">
              <label for="${id('magnitude')}">How hard</label>
              <output class="ml-mob-value" for="${id('magnitude')}" data-ml-mob-output="magnitude">1.00 ×</output>
            </div>
            <input class="ml-mob-slider" id="${id('magnitude')}" type="range" min="0.25" max="2" step="0.05" value="1" data-ml-mob-scalar="magnitude">
          </div>
          <div class="ml-mob-field">
            <div class="ml-mob-field-label">
              <label for="${id('radius')}">How wide</label>
              <output class="ml-mob-value" for="${id('radius')}" data-ml-mob-output="radius">1.00 ×</output>
            </div>
            <input class="ml-mob-slider" id="${id('radius')}" type="range" min="1" max="4" step="0.25" value="1" data-ml-mob-scalar="radius">
          </div>
        </div>

        <div class="ml-mob-panel" id="${id('panel-material')}" role="tabpanel" data-ml-mob-panel="material" aria-labelledby="${id('tab-material')}" hidden>
          <h2 class="ml-mob-section-head">Material</h2>
          <p class="ml-mob-hint">Set by the selected specimen.</p>
          <div class="ml-mob-material-fields">
            <label class="ml-mob-sr-only" for="${id('material')}">Material preset</label>
            <select class="ml-mob-select" id="${id('material')}" data-ml-mob-material disabled title="Material is authored by the specimen. Pick a different lab to change it."></select>
          </div>
        </div>

        <div class="ml-mob-panel" id="${id('panel-solver')}" role="tabpanel" data-ml-mob-panel="solver" aria-labelledby="${id('tab-solver')}" hidden>
          <button class="ml-mob-advanced" type="button" data-ml-mob-action="toggle-advanced" aria-expanded="false">
            Advanced <i class="ph ph-caret-right" aria-hidden="true"></i>
          </button>
          <div class="ml-mob-advanced-body" data-ml-mob-advanced hidden>
            <p class="ml-mob-hint">Substeps only. Other solver knobs stay at lab defaults.</p>
            <div class="ml-mob-field">
              <span class="ml-mob-field-label">Substeps</span>
              <div class="ml-mob-substeps" role="group" aria-label="Solver substeps">${substeps}</div>
            </div>
            <label class="ml-mob-field ml-mob-unavailable">
              <span class="ml-mob-field-label">Iterations</span>
              <select class="ml-mob-select" id="${id('iterations')}" data-ml-mob-iterations disabled title="Solver iterations are not a live control in this build.">${iterations}</select>
            </label>
            <div class="ml-mob-switch-row ml-mob-unavailable">
              <span>Collision <small>Not available</small></span>
              <button class="ml-mob-switch" type="button" role="switch" data-ml-mob-switch="collision" aria-checked="true" aria-label="Collision" disabled title="Collision is authored by the specimen."></button>
            </div>
            <div class="ml-mob-switch-row ml-mob-unavailable">
              <span>Adaptive step <small>Not available</small></span>
              <button class="ml-mob-switch" type="button" role="switch" data-ml-mob-switch="adaptiveTimeStep" aria-checked="true" aria-label="Adaptive time step" disabled title="Adaptive stepping is not a live control in this build."></button>
            </div>
            <div class="ml-mob-stepper-row ml-mob-unavailable">
              <span>Yield</span>
              <output class="ml-mob-stepper-value" data-ml-mob-output="yieldStrength">0.024 strain</output>
            </div>
            <div class="ml-mob-stepper-row ml-mob-unavailable">
              <span>Hardening</span>
              <output class="ml-mob-stepper-value" data-ml-mob-output="hardening">0.28</output>
            </div>
            <div class="ml-mob-stepper-row ml-mob-unavailable">
              <span>Thickness</span>
              <output class="ml-mob-stepper-value" data-ml-mob-output="thickness">3.00 sim</output>
            </div>
            <div class="ml-mob-quiet-row">
              <button class="ml-mob-play-btn" type="button" data-ml-mob-playback="step"><i class="ph ph-skip-forward" aria-hidden="true"></i>Step</button>
              <button class="ml-mob-play-btn" type="button" data-ml-mob-playback="capture"><i class="ph ph-camera" aria-hidden="true"></i>Capture</button>
            </div>
          </div>
        </div>
      </div>
      <nav class="ml-mob-tabs eng-tablist" role="tablist" aria-label="Inspector sections">${tabs}</nav>
    </section>

    <div class="ml-mob-library" id="${id('library')}" data-ml-mob-library hidden>
      <button class="ml-mob-library-scrim" type="button" data-ml-mob-action="close-library" aria-label="Close simulation library"></button>
      <section class="ml-mob-library-panel" aria-label="Simulation library">
        <header class="ml-mob-library-head">
          <h2>Simulations</h2>
          <span data-ml-mob-library-count>9 shown</span>
        </header>
        <label class="ml-mob-sr-only" for="${id('search')}">Search simulations</label>
        <input class="ml-mob-search" id="${id('search')}" type="search" placeholder="Search simulations…" data-ml-mob-search autocomplete="off">
        <div class="ml-mob-chips" role="group" aria-label="Library filters">${chips}</div>
        <div class="ml-mob-sim-list" data-ml-mob-sim-list></div>
      </section>
    </div>
    <div class="ml-mob-live ml-mob-sr-only" aria-live="polite" data-ml-mob-live></div>
  `;
}

export function mountMaterialLabMobile(options: MaterialLabMobileOptions): MaterialLabMobileController {
  const prefix = options.idPrefix ?? 'ml-mob';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Material Lab mobile idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }

  let state = applyUpdate(createDefaultState(), options.initialState ?? {});
  let callbacks = options.callbacks ?? {};
  let destroyed = false;
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let sheetDragging = false;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let dragMoved = false;
  let advancedOpen = false;

  const root = document.createElement('div');
  root.className = 'ml-mob-root';
  root.id = `${prefix}-root`;
  root.innerHTML = markup(prefix);
  options.mount.append(root);

  const abortController = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abortController.signal };
  const liveRegion = required<HTMLElement>(root, '[data-ml-mob-live]');
  const viewportSlot = required<HTMLElement>(root, '[data-ml-mob-viewport-slot]');
  const viewportEmpty = required<HTMLElement>(root, '[data-ml-mob-viewport-empty]');
  const sheetEl = required<HTMLElement>(root, '[data-ml-mob-sheet-el]');
  const grabber = required<HTMLButtonElement>(root, '[data-ml-mob-action="sheet"]');
  const magnitudeInput = required<HTMLInputElement>(root, '[data-ml-mob-scalar="magnitude"]');
  const radiusInput = required<HTMLInputElement>(root, '[data-ml-mob-scalar="radius"]');
  const materialSelect = required<HTMLSelectElement>(root, '[data-ml-mob-material]');
  const iterationsSelect = required<HTMLSelectElement>(root, '[data-ml-mob-iterations]');
  const searchInput = required<HTMLInputElement>(root, '[data-ml-mob-search]');
  const simList = required<HTMLElement>(root, '[data-ml-mob-sim-list]');
  const library = required<HTMLElement>(root, '[data-ml-mob-library]');
  const advancedBody = required<HTMLElement>(root, '[data-ml-mob-advanced]');
  const advancedToggle = required<HTMLButtonElement>(root, '[data-ml-mob-action="toggle-advanced"]');

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => { if (!destroyed) liveRegion.textContent = message; }, 20);
  };

  const emit = <K extends keyof MaterialLabMobileCallbacks>(name: K, ...args: Parameters<NonNullable<MaterialLabMobileCallbacks[K]>>): void => {
    const handler = callbacks[name];
    if (!handler) return;
    (handler as (...values: typeof args) => void)(...args);
  };

  const filteredSimulations = (): readonly MaterialLabMobileSimulation[] => {
    const query = state.libraryQuery.trim().toLowerCase();
    return state.simulations.filter((item) => {
      const groupOk = state.libraryFilter === 'all' || item.group === state.libraryFilter;
      if (!groupOk) return false;
      if (!query) return true;
      return `${item.title} ${item.subtitle} ${item.index}`.toLowerCase().includes(query);
    });
  };

  const renderSimulations = (): void => {
    const items = filteredSimulations();
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ml-mob-sim';
      button.dataset.mlMobSim = item.id;
      button.setAttribute('aria-current', String(item.id === state.activeSimulationId));
      const thumb = document.createElement('span');
      thumb.className = 'ml-mob-sim-thumb';
      thumb.style.setProperty('--ml-mob-sim-hue', hueForId(item.id));
      const index = document.createElement('span');
      index.className = 'ml-mob-sim-index';
      index.textContent = item.index;
      const copy = document.createElement('span');
      copy.className = 'ml-mob-sim-copy';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = item.subtitle;
      copy.append(title, subtitle);
      const dot = document.createElement('span');
      dot.className = 'ml-mob-sim-dot';
      button.append(thumb, index, copy, dot);
      fragment.append(button);
    }
    simList.replaceChildren(fragment);
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-library-count]')) {
      node.textContent = `${items.length} shown`;
    }
  };

  const renderMaterials = (): void => {
    const fragment = document.createDocumentFragment();
    for (const material of state.materials) {
      const option = document.createElement('option');
      option.value = material.id;
      option.textContent = material.label;
      option.selected = material.id === state.material.id;
      fragment.append(option);
    }
    materialSelect.replaceChildren(fragment);
    materialSelect.value = state.material.id;
  };

  const setOutput = (key: string, value: string): void => {
    for (const node of root.querySelectorAll<HTMLElement>(`[data-ml-mob-output="${key}"]`)) node.textContent = value;
  };

  const sync = (): void => {
    root.dataset.mlMobTool = state.tool;
    root.dataset.mlMobTab = state.tab;
    root.dataset.mlMobSheet = state.sheet;
    root.dataset.mlMobPlaying = String(state.playing);
    root.dataset.mlMobAdvanced = String(advancedOpen);
    root.dataset.mlMobBreakpoint = materialLabMobileBreakpoint(root.clientWidth || window.innerWidth);

    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-title]')) node.textContent = state.title;
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-howto]')) node.textContent = howtoCopy(state.playing);
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-stress-title]')) node.textContent = state.stress.title;
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-stress-high]')) node.textContent = state.stress.highLabel;
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-stress-low]')) node.textContent = state.stress.lowLabel;
    for (const node of root.querySelectorAll<HTMLElement>('[data-ml-mob-time]')) node.textContent = formatTime(state.timeSeconds);

    const paintSlider = (input: HTMLInputElement, scalar: MaterialLabMobileScalar): void => {
      input.min = String(scalar.min);
      input.max = String(scalar.max);
      input.step = String(scalar.step);
      input.value = String(scalar.value);
      input.style.setProperty('--ml-mob-fill', sliderFill(scalar));
    };
    paintSlider(magnitudeInput, state.force.magnitude);
    paintSlider(radiusInput, state.force.radius);
    setOutput('magnitude', formatScalar(state.force.magnitude));
    setOutput('radius', formatScalar(state.force.radius));
    setOutput('yieldStrength', formatScalar(state.material.yieldStrength));
    setOutput('hardening', formatScalar(state.material.hardening));
    setOutput('thickness', formatScalar(state.material.thickness));

    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-mob-tool]')) {
      const active = button.dataset.mlMobTool === state.tool;
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-mob-tab]')) {
      const active = button.dataset.mlMobTab === state.tab;
      button.setAttribute('aria-selected', String(active));
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-ml-mob-panel]')) {
      panel.hidden = panel.dataset.mlMobPanel !== state.tab;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-mob-substeps]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.mlMobSubsteps) === state.solver.substeps));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-mob-switch]')) {
      const key = button.dataset.mlMobSwitch;
      const on = key === 'collision' ? state.solver.collision : state.solver.adaptiveTimeStep;
      button.setAttribute('aria-checked', String(on));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-ml-mob-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mlMobFilter === state.libraryFilter));
    }
    advancedBody.hidden = !advancedOpen;
    advancedToggle.setAttribute('aria-expanded', String(advancedOpen));
    const libraryButton = required<HTMLButtonElement>(root, '[data-ml-mob-action="library"]');
    libraryButton.setAttribute('aria-expanded', String(state.libraryOpen));
    library.hidden = !state.libraryOpen;
    iterationsSelect.value = String(state.solver.iterations);
    if (searchInput.value !== state.libraryQuery) searchInput.value = state.libraryQuery;

    const playButton = required<HTMLButtonElement>(root, '[data-ml-mob-playback="toggle-play"]');
    const playIcon = required<HTMLElement>(playButton, 'i');
    playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    playIcon.className = `ph ${state.playing ? 'ph-pause' : 'ph-play'}`;

    renderMaterials();
    renderSimulations();
  };

  const setState = (patch: MaterialLabMobileUpdate, announceMessage?: string): void => {
    if (destroyed) return;
    state = applyUpdate(state, patch);
    sync();
    if (announceMessage) announce(announceMessage);
  };

  const attachViewport = (nextViewport: HTMLElement): void => {
    if (destroyed) return;
    if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    viewportMarker?.remove();
    viewport?.classList.remove('ml-mob-attached-viewport');
    viewport = nextViewport;
    viewportMarker = document.createComment(`${prefix}-viewport-origin`);
    nextViewport.parentNode?.insertBefore(viewportMarker, nextViewport);
    viewportEmpty.hidden = true;
    viewportSlot.append(nextViewport);
    nextViewport.classList.add('ml-mob-attached-viewport');
  };

  const snapSheet = (height: number): MaterialLabMobileSheet => {
    const peek = SHEET_HEIGHTS.peek;
    const controls = Math.min(SHEET_HEIGHTS.controls, root.clientHeight * 0.52);
    const expanded = Math.min(SHEET_HEIGHTS.expanded, root.clientHeight * 0.86);
    const distances: ReadonlyArray<readonly [MaterialLabMobileSheet, number]> = [
      ['peek', Math.abs(height - peek)],
      ['controls', Math.abs(height - controls)],
      ['expanded', Math.abs(height - expanded)],
    ];
    return distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)[0];
  };

  const setSheet = (sheet: MaterialLabMobileSheet, fromUser = false): void => {
    setState({ sheet });
    if (fromUser) {
      emit('onSheetChange', sheet);
      root.dispatchEvent(new CustomEvent('ml-mob-sheet', { detail: { sheet } }));
    }
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('button')?.disabled) return;

    const toolButton = target.closest<HTMLButtonElement>('[data-ml-mob-tool]');
    if (toolButton) {
      const tool = toolButton.dataset.mlMobTool as MaterialLabMobileTool;
      if (!MATERIAL_LAB_MOBILE_TOOLS.includes(tool) || tool === state.tool) return;
      setState({ tool }, toolHint(tool));
      emit('onToolChange', tool);
      root.dispatchEvent(new CustomEvent('ml-mob-tool', { detail: { tool } }));
      return;
    }

    const tabButton = target.closest<HTMLButtonElement>('[data-ml-mob-tab]');
    if (tabButton) {
      const tab = tabButton.dataset.mlMobTab as MaterialLabMobileTab;
      if (!MATERIAL_LAB_MOBILE_TABS.includes(tab)) return;
      const sheet = state.sheet === 'peek' ? 'controls' : state.sheet;
      setState({ tab, sheet }, `${tabCopy(tab).label} panel.`);
      emit('onTabChange', tab);
      root.dispatchEvent(new CustomEvent('ml-mob-tab', { detail: { tab } }));
      return;
    }

    const substep = target.closest<HTMLButtonElement>('[data-ml-mob-substeps]');
    if (substep) {
      const value = Number(substep.dataset.mlMobSubsteps) as MaterialLabMobileSubsteps;
      if (!MATERIAL_LAB_MOBILE_SUBSTEPS.includes(value)) return;
      const solver = { ...state.solver, substeps: value };
      setState({ solver });
      emit('onSolverChange', solver);
      root.dispatchEvent(new CustomEvent('ml-mob-solver', { detail: { solver } }));
      return;
    }

    const toggle = target.closest<HTMLButtonElement>('[data-ml-mob-switch]');
    if (toggle) {
      const key = toggle.dataset.mlMobSwitch;
      const solver = key === 'collision'
        ? { ...state.solver, collision: !state.solver.collision }
        : { ...state.solver, adaptiveTimeStep: !state.solver.adaptiveTimeStep };
      setState({ solver });
      emit('onSolverChange', solver);
      root.dispatchEvent(new CustomEvent('ml-mob-solver', { detail: { solver } }));
      return;
    }

    const filter = target.closest<HTMLButtonElement>('[data-ml-mob-filter]');
    if (filter) {
      const next = filter.dataset.mlMobFilter as MaterialLabMobileLibraryFilter;
      if (!MATERIAL_LAB_MOBILE_LIBRARY_FILTERS.includes(next)) return;
      setState({ libraryFilter: next });
      return;
    }

    const sim = target.closest<HTMLButtonElement>('[data-ml-mob-sim]');
    if (sim) {
      const id = sim.dataset.mlMobSim ?? state.activeSimulationId;
      const selected = state.simulations.find((item) => item.id === id);
      setState({
        activeSimulationId: id,
        title: selected?.title ?? state.title,
        libraryOpen: false,
      }, selected ? `${selected.title} loaded.` : undefined);
      emit('onSimulationSelect', id);
      emit('onLibraryToggle', false);
      root.dispatchEvent(new CustomEvent('ml-mob-simulation', { detail: { id } }));
      return;
    }

    const playback = target.closest<HTMLButtonElement>('[data-ml-mob-playback]');
    if (playback) {
      const action = playback.dataset.mlMobPlayback;
      const command: MaterialLabMobilePlaybackCommand = action === 'toggle-play'
        ? (state.playing ? 'pause' : 'play')
        : action as MaterialLabMobilePlaybackCommand;
      if (!MATERIAL_LAB_MOBILE_PLAYBACK_COMMANDS.includes(command)) return;
      if (command === 'play' || command === 'pause') setState({ playing: command === 'play' });
      emit('onPlayback', command);
      root.dispatchEvent(new CustomEvent('ml-mob-playback', { detail: { command } }));
      announce(playbackLabel(command));
      return;
    }

    const actionButton = target.closest<HTMLButtonElement>('[data-ml-mob-action]');
    const action = actionButton?.dataset.mlMobAction;
    if (action === 'library') {
      const open = !state.libraryOpen;
      setState({ libraryOpen: open });
      emit('onLibraryToggle', open);
      if (open) searchInput.focus();
      return;
    }
    if (action === 'close-library') {
      setState({ libraryOpen: false });
      emit('onLibraryToggle', false);
      return;
    }
    if (action === 'toggle-advanced') {
      advancedOpen = !advancedOpen;
      const sheet = advancedOpen && state.sheet !== 'expanded' ? 'expanded' : state.sheet;
      if (sheet !== state.sheet) setState({ sheet });
      else sync();
      return;
    }
    if (action === 'apply-force') {
      emit('onApplyForce', state.force);
      root.dispatchEvent(new CustomEvent('ml-mob-apply-force', { detail: { force: state.force } }));
      announce(state.playing ? 'Force applied.' : 'Force applied. Press Play to watch the result.');
      return;
    }
    if (action === 'sheet' && !dragMoved) {
      const next: MaterialLabMobileSheet = state.sheet === 'peek' ? 'controls' : state.sheet === 'controls' ? 'expanded' : 'peek';
      setSheet(next, true);
    }
  }, eventOptions);

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const key = input.dataset.mlMobScalar;
    if (key !== 'magnitude' && key !== 'radius') return;
    const force = {
      ...state.force,
      [key]: mergeScalar(state.force[key], { value: Number(input.value) }),
    };
    setState({ force });
    emit('onForceChange', force);
    root.dispatchEvent(new CustomEvent('ml-mob-force', { detail: { force } }));
  }, eventOptions);

  materialSelect.addEventListener('change', () => {
    const selected = state.materials.find((item) => item.id === materialSelect.value);
    if (!selected) return;
    setState({ material: selected }, `${selected.label} selected.`);
    emit('onMaterialChange', selected);
    root.dispatchEvent(new CustomEvent('ml-mob-material', { detail: { material: selected } }));
  }, eventOptions);

  iterationsSelect.addEventListener('change', () => {
    const solver = { ...state.solver, iterations: Number(iterationsSelect.value) };
    setState({ solver });
    emit('onSolverChange', solver);
    root.dispatchEvent(new CustomEvent('ml-mob-solver', { detail: { solver } }));
  }, eventOptions);

  searchInput.addEventListener('input', () => {
    setState({ libraryQuery: searchInput.value });
  }, eventOptions);

  const onPointerMove = (event: PointerEvent): void => {
    if (!sheetDragging) return;
    const delta = dragStartY - event.clientY;
    if (Math.abs(delta) > 8) dragMoved = true;
    const maxHeight = Math.min(SHEET_HEIGHTS.expanded, root.clientHeight * 0.9);
    const height = clamp(dragStartHeight + delta, SHEET_HEIGHTS.peek, maxHeight);
    root.style.setProperty('--ml-mob-sheet-h', `${height}px`);
  };

  const endSheetDrag = (event: PointerEvent): void => {
    if (!sheetDragging) return;
    sheetDragging = false;
    if (grabber.hasPointerCapture(event.pointerId)) grabber.releasePointerCapture(event.pointerId);
    const height = sheetEl.getBoundingClientRect().height;
    root.style.removeProperty('--ml-mob-sheet-h');
    if (dragMoved) setSheet(snapSheet(height), true);
  };

  grabber.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    sheetDragging = true;
    dragMoved = false;
    dragStartY = event.clientY;
    dragStartHeight = sheetEl.getBoundingClientRect().height;
    grabber.setPointerCapture(event.pointerId);
  }, eventOptions);
  grabber.addEventListener('pointermove', onPointerMove, eventOptions);
  grabber.addEventListener('pointerup', endSheetDrag, eventOptions);
  grabber.addEventListener('pointercancel', endSheetDrag, eventOptions);

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.libraryOpen) return;
    setState({ libraryOpen: false });
    emit('onLibraryToggle', false);
  }, eventOptions);

  const syncBreakpoint = (): void => {
    if (destroyed) return;
    root.dataset.mlMobBreakpoint = materialLabMobileBreakpoint(root.clientWidth || window.innerWidth);
  };
  const mediaPhone = window.matchMedia(`(max-width: ${MATERIAL_LAB_MOBILE_PHONE_PX}px)`);
  const mediaLab = window.matchMedia(`(max-width: ${MATERIAL_LAB_MOBILE_BREAKPOINT_PX}px)`);
  mediaPhone.addEventListener('change', syncBreakpoint, eventOptions);
  mediaLab.addEventListener('change', syncBreakpoint, eventOptions);
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncBreakpoint);
  resizeObserver?.observe(root);

  if (options.viewport) attachViewport(options.viewport);
  sync();

  return {
    root,
    update: (patch) => { setState(patch); },
    attachViewport,
    getState: () => state,
    getBreakpoint: () => materialLabMobileBreakpoint(root.clientWidth || window.innerWidth),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      if (viewport && viewportMarker?.parentNode) {
        viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
      }
      viewport?.classList.remove('ml-mob-attached-viewport');
      viewportMarker?.remove();
      root.remove();
    },
  };
}
