import {
  isMaterialLabPresetId,
  MATERIAL_LAB_SELECTED_PRESET_ID,
  type MaterialLabPresetId,
} from '../soft/material-presets';
import { getWorkbenchLab } from './registry';
import {
  assertNever,
  FIELD_MODAL_VIEWS,
  LEGACY_WORKSPACE_IDS,
  WORKSPACE_CONCEPTS,
  WORKSPACE_KIND_LABELS,
  WORKSPACE_KINDS,
  workspaceKindFromLegacyId,
  type FieldModalViewId,
  type WorkbenchFidelity,
  type WorkbenchSolver,
  type WorkspaceKind,
} from './schema';

export const ENGINEERING_WORKSPACES = LEGACY_WORKSPACE_IDS;
export type EngineeringWorkspace = (typeof ENGINEERING_WORKSPACES)[number];

export const ENGINEERING_RUN_STATES = [
  'draft',
  'preflight',
  'armed',
  'running',
  'paused',
  'complete',
  'aborted',
] as const;
export type EngineeringRunState = (typeof ENGINEERING_RUN_STATES)[number];

export type EvidenceSource = 'solver' | 'derived' | 'imported' | 'synthetic-demo' | 'presentation';

export type EvidenceProvenance = {
  readonly source: EvidenceSource;
  readonly label: string;
  readonly calibrated: boolean;
  readonly detail: string;
};

export type EngineeringSample = {
  /** Model time in fixed-step simulation seconds. */
  readonly time: number;
  readonly step: number;
  readonly load: number;
  readonly response: number;
  readonly energy: number;
  readonly damage: number;
  readonly brokenCount: number;
  readonly hash: number;
};

export type EngineeringRunEventKind =
  | 'preflight'
  | 'armed'
  | 'load-step'
  | 'hold'
  | 'impact'
  | 'limit-warning'
  | 'bookmark'
  | 'complete'
  | 'abort';

export type EngineeringRunEvent = {
  readonly id: string;
  readonly time: number;
  readonly step: number;
  readonly kind: EngineeringRunEventKind;
  readonly label: string;
  readonly severity: 'info' | 'pass' | 'warning' | 'danger';
};

export type EngineeringRunDescriptor = {
  readonly id: string;
  readonly title: string;
  readonly labId: string;
  readonly sceneId: number;
  readonly solver: WorkbenchSolver;
  readonly fidelity: WorkbenchFidelity;
  readonly backend: string;
  readonly seed: number;
  readonly stressPreset: number;
  readonly fixedStep: number;
  readonly createdAt: string;
  readonly provenance: EvidenceProvenance;
};

export type EngineeringRunSnapshot = EngineeringRunDescriptor & {
  readonly state: EngineeringRunState;
  readonly samples: readonly EngineeringSample[];
  readonly events: readonly EngineeringRunEvent[];
};

export type EngineeringPreflightCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: 'pass' | 'warning' | 'fail';
  readonly detail: string;
};

const TRANSITIONS: Readonly<Record<EngineeringRunState, readonly EngineeringRunState[]>> = {
  draft: ['preflight', 'aborted'],
  preflight: ['armed', 'draft', 'aborted'],
  armed: ['running', 'draft', 'aborted'],
  running: ['paused', 'complete', 'aborted'],
  paused: ['running', 'complete', 'aborted'],
  complete: [],
  aborted: [],
};

const finiteOr = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export function normalizeEngineeringSample(
  value: EngineeringSample,
  previous?: EngineeringSample,
): EngineeringSample {
  const previousTime = previous?.time ?? 0;
  const previousStep = previous?.step ?? -1;
  return Object.freeze({
    time: Math.max(previousTime, finiteOr(value.time, previousTime)),
    step: Math.max(previousStep + 1, Math.round(finiteOr(value.step, previousStep + 1))),
    load: finiteOr(value.load),
    response: finiteOr(value.response),
    energy: Math.max(0, finiteOr(value.energy)),
    damage: Math.max(0, finiteOr(value.damage)),
    brokenCount: Math.max(0, Math.round(finiteOr(value.brokenCount))),
    hash: finiteOr(value.hash) >>> 0,
  });
}

/**
 * Bounded, deterministic run recorder used by all three workspaces. It stores
 * model values and provenance; physical-unit conversion belongs to an explicit
 * imported calibration profile and is intentionally not inferred here.
 */
export class EngineeringRunRecorder {
  private stateValue: EngineeringRunState = 'draft';
  private readonly samplesValue: EngineeringSample[] = [];
  private readonly eventsValue: EngineeringRunEvent[] = [];

  constructor(
    readonly descriptor: EngineeringRunDescriptor,
    readonly sampleCapacity = 7200,
  ) {
    if (!Number.isInteger(sampleCapacity) || sampleCapacity < 64) {
      throw new Error('Engineering run sample capacity must be an integer of at least 64.');
    }
  }

  get state(): EngineeringRunState { return this.stateValue; }
  get samples(): readonly EngineeringSample[] { return this.samplesValue; }
  get events(): readonly EngineeringRunEvent[] { return this.eventsValue; }

  canTransition(next: EngineeringRunState): boolean {
    return TRANSITIONS[this.stateValue].includes(next);
  }

  transition(next: EngineeringRunState): void {
    if (next === this.stateValue) return;
    if (!this.canTransition(next)) {
      throw new Error(`Invalid engineering run transition: ${this.stateValue} -> ${next}.`);
    }
    this.stateValue = next;
  }

  record(sample: EngineeringSample): EngineeringSample {
    const normalized = normalizeEngineeringSample(sample, this.samplesValue.at(-1));
    this.samplesValue.push(normalized);
    if (this.samplesValue.length > this.sampleCapacity) this.samplesValue.shift();
    return normalized;
  }

  mark(
    kind: EngineeringRunEventKind,
    label: string,
    severity: EngineeringRunEvent['severity'] = 'info',
  ): EngineeringRunEvent {
    const sample = this.samplesValue.at(-1);
    const event = Object.freeze({
      id: `${this.descriptor.id}-event-${String(this.eventsValue.length + 1).padStart(3, '0')}`,
      time: sample?.time ?? 0,
      step: sample?.step ?? 0,
      kind,
      label: label.trim() || kind,
      severity,
    });
    this.eventsValue.push(event);
    return event;
  }

  snapshot(): EngineeringRunSnapshot {
    return Object.freeze({
      ...this.descriptor,
      state: this.stateValue,
      samples: Object.freeze(this.samplesValue.slice()),
      events: Object.freeze(this.eventsValue.slice()),
    });
  }
}

export function engineeringProvenanceForSolver(detail: string): EvidenceProvenance {
  return Object.freeze({
    source: 'solver',
    label: 'Solver-authoritative · reduced model',
    calibrated: false,
    detail,
  });
}

export function syntheticDemoProvenance(detail: string): EvidenceProvenance {
  return Object.freeze({
    source: 'synthetic-demo',
    label: 'Synthetic demo · not physical test data',
    calibrated: false,
    detail,
  });
}

export function importedEvidenceProvenance(detail: string, calibrated: boolean): EvidenceProvenance {
  return Object.freeze({
    source: 'imported',
    label: calibrated ? 'Imported calibrated evidence' : 'Imported evidence · units unverified',
    calibrated,
    detail,
  });
}

/** Concept screens. Ids match `WorkspaceKind` so demos and chrome share one vocabulary. */
export const ENGINEERING_CONCEPT_VIEWS = WORKSPACE_KINDS;
export type EngineeringConceptView = WorkspaceKind;
export const ENGINEERING_CONCEPT_VIEW_LABELS = WORKSPACE_KIND_LABELS;

export const ENGINEERING_LAYOUTS = ['desktop', 'mobile'] as const;
export type EngineeringLayout = (typeof ENGINEERING_LAYOUTS)[number];

/** Width thresholds for phone, tablet, compact desktop, and full three-column chrome. */
export const ENGINEERING_LAYOUT_BREAKPOINTS = Object.freeze({
  phoneMax: 760,
  tabletMax: 1040,
  compactMax: 1279,
  desktopMin: 1280,
});

export const ENGINEERING_LAYOUT_TIERS = ['phone', 'tablet', 'compact', 'desktop'] as const;
export type EngineeringLayoutTier = (typeof ENGINEERING_LAYOUT_TIERS)[number];

/**
 * Viewport overlay channels shown in the mockups. Labels stay normalized;
 * built-in runs do not claim MPa, µε, or calibrated transducer units.
 */
export const ENGINEERING_FIELD_IDS = [
  'none',
  'stress',
  'strain',
  'plastic',
  'contacts',
  'displacement',
] as const;
export type EngineeringFieldId = (typeof ENGINEERING_FIELD_IDS)[number];

export const ENGINEERING_FIELD_LABELS: Readonly<Record<EngineeringFieldId, string>> = {
  none: 'None',
  stress: 'Stress',
  strain: 'Strain',
  plastic: 'Plastic',
  contacts: 'Contacts',
  displacement: 'Displacement',
};

export const ENGINEERING_SESSION_MODALS = [
  'library',
  'inspector',
  'arm-confirm',
  'workspace-menu',
] as const;
export type EngineeringSessionModal = (typeof ENGINEERING_SESSION_MODALS)[number];

export const ENGINEERING_INSPECTOR_TABS = [
  'force',
  'load-case',
  'material',
  'solver',
  'assembly',
] as const;
export type EngineeringInspectorTab = (typeof ENGINEERING_INSPECTOR_TABS)[number];

export const ENGINEERING_LAB_CHROME_TABS = ['lab', 'compare', 'captures'] as const;
export type EngineeringLabChromeTab = (typeof ENGINEERING_LAB_CHROME_TABS)[number];

export const ENGINEERING_FIELD_NAV_IDS = FIELD_MODAL_VIEWS;
export type EngineeringFieldNavId = FieldModalViewId;

export const ENGINEERING_VIEWPORT_TOOLS = ['orbit', 'force'] as const;
export type EngineeringViewportTool = (typeof ENGINEERING_VIEWPORT_TOOLS)[number];

export const ENGINEERING_CONCEPT_FIXTURE_IDS = [
  'material-lab-desktop',
  'material-lab-mobile',
  'structural',
  'correlation',
  'field-modal',
] as const;
export type EngineeringConceptFixtureId = (typeof ENGINEERING_CONCEPT_FIXTURE_IDS)[number];

const FIELD_MODAL_LAB_ID = 'composite-coupon';
const DEFAULT_STRUCTURAL_LAB_ID = 'titan-bend-dent';
const DEFAULT_CORRELATION_LAB_ID = 'crash-rail-axial-fold';
const DEFAULT_COMPOSITE_PRESET_ID: MaterialLabPresetId = 'carbon-fiber';

type ViewMemory = {
  labId: string;
  materialPresetId: MaterialLabPresetId;
  field: EngineeringFieldId;
  inspectorTab: EngineeringInspectorTab;
  labChromeTab: EngineeringLabChromeTab;
  fieldNav: EngineeringFieldNavId;
  viewportTool: EngineeringViewportTool;
};

/** In-memory onboarding / playback flags. Not part of the run recorder. */
export type EngineeringSessionFlags = {
  /** When true, opening this view/fixture may start playback without an Arm step. */
  readonly autoplayOnOpen: boolean;
  /** When true, the first-run how-to overlay stays hidden for this session. */
  readonly firstRunGuideDismissed: boolean;
};

export const ENGINEERING_SESSION_FLAG_DEFAULTS: EngineeringSessionFlags = Object.freeze({
  autoplayOnOpen: true,
  firstRunGuideDismissed: false,
});

/** Shared with the first-run overlay; session stores the live flag, storage is optional. */
export const FIRST_RUN_GUIDE_DISMISSED_STORAGE_KEY = 'box3d-guide-dismissed';

export type EngineeringSessionAutoplayOptions = {
  readonly autoplayOnOpen?: boolean;
};

export type EngineeringSessionState = {
  readonly view: EngineeringConceptView;
  readonly layout: EngineeringLayout;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly field: EngineeringFieldId;
  readonly modal: EngineeringSessionModal | null;
  readonly labId: string;
  readonly materialPresetId: MaterialLabPresetId;
  readonly inspectorTab: EngineeringInspectorTab;
  readonly labChromeTab: EngineeringLabChromeTab;
  readonly fieldNav: EngineeringFieldNavId;
  readonly viewportTool: EngineeringViewportTool;
  readonly conceptFixtureId: EngineeringConceptFixtureId | null;
  readonly autoplayOnOpen: boolean;
  readonly firstRunGuideDismissed: boolean;
};

export type EngineeringSessionOptions = {
  readonly view?: EngineeringConceptView;
  readonly layout?: EngineeringLayout;
  readonly viewportWidth?: number;
  readonly viewportHeight?: number;
  readonly field?: EngineeringFieldId;
  readonly modal?: EngineeringSessionModal | null;
  readonly labId?: string;
  readonly materialPresetId?: MaterialLabPresetId | string;
  readonly inspectorTab?: EngineeringInspectorTab;
  readonly labChromeTab?: EngineeringLabChromeTab;
  readonly fieldNav?: EngineeringFieldNavId;
  readonly viewportTool?: EngineeringViewportTool;
  readonly autoplayOnOpen?: boolean;
  readonly firstRunGuideDismissed?: boolean;
};

export type EngineeringConceptFixture = {
  readonly id: EngineeringConceptFixtureId;
  readonly title: string;
  readonly mockupPath: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly workspace: EngineeringWorkspace;
  readonly state: EngineeringSessionState;
};

export type EngineeringSessionListener = (state: EngineeringSessionState) => void;

function hasToken<T extends string>(tokens: readonly T[], value: string): value is T {
  return (tokens as readonly string[]).includes(value);
}

function requireToken<T extends string>(tokens: readonly T[], value: string, label: string): T {
  if (!hasToken(tokens, value)) throw new Error(`Unknown engineering ${label}: ${value}.`);
  return value;
}

function requireLabId(labId: string): string {
  if (!getWorkbenchLab(labId)) throw new Error(`Unknown workbench lab: ${labId}.`);
  return labId;
}

function requireMaterialPresetId(presetId: string): MaterialLabPresetId {
  if (!isMaterialLabPresetId(presetId)) throw new Error(`Unknown material preset: ${presetId}.`);
  return presetId;
}

function requirePositiveSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Engineering session viewport size must be finite and positive.');
  }
}

function sessionStorageOrNull(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadFirstRunGuideDismissed(
  storage: Pick<Storage, 'getItem'> | null = sessionStorageOrNull(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(FIRST_RUN_GUIDE_DISMISSED_STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export function persistFirstRunGuideDismissed(
  dismissed: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = sessionStorageOrNull(),
): void {
  if (!storage) return;
  try {
    if (dismissed) storage.setItem(FIRST_RUN_GUIDE_DISMISSED_STORAGE_KEY, 'true');
    else storage.removeItem(FIRST_RUN_GUIDE_DISMISSED_STORAGE_KEY);
  } catch {
    // Private mode / quota: the in-memory session flag still applies.
  }
}

export function engineeringSessionAllowsAutoplay(state: EngineeringSessionState): boolean {
  return state.autoplayOnOpen;
}

export function engineeringSessionShowsFirstRunGuide(state: EngineeringSessionState): boolean {
  return !state.firstRunGuideDismissed;
}

function conceptAssetFor(kind: EngineeringConceptView): (typeof WORKSPACE_CONCEPTS)[number] {
  for (const concept of WORKSPACE_CONCEPTS) {
    if (concept.kind === kind) return concept;
  }
  throw new Error(`Missing workspace concept for ${kind}.`);
}

export function workspaceForConceptView(view: EngineeringConceptView): EngineeringWorkspace {
  switch (view) {
    case 'materialLab':
    case 'physicsStructural':
      return 'test';
    case 'physicsCorrelation':
      return 'correlation';
    case 'physicsFieldModal':
      return 'field';
    default:
      return assertNever(view);
  }
}

export function defaultConceptViewForWorkspace(workspace: EngineeringWorkspace): EngineeringConceptView {
  return workspaceKindFromLegacyId(workspace);
}

export function conceptViewsForWorkspace(workspace: EngineeringWorkspace): readonly EngineeringConceptView[] {
  switch (workspace) {
    case 'test':
      return ['physicsStructural', 'materialLab'];
    case 'correlation':
      return ['physicsCorrelation'];
    case 'field':
      return ['physicsFieldModal'];
    default:
      return assertNever(workspace);
  }
}

export function renderSlotCountForView(view: EngineeringConceptView): 1 | 2 {
  return view === 'physicsCorrelation' ? 2 : 1;
}

export function fieldsForConceptView(view: EngineeringConceptView): readonly EngineeringFieldId[] {
  switch (view) {
    case 'materialLab':
      return ['stress', 'strain', 'plastic'];
    case 'physicsStructural':
      return ['strain', 'stress', 'plastic'];
    case 'physicsCorrelation':
      return ['plastic', 'contacts', 'strain'];
    case 'physicsFieldModal':
      return ['displacement'];
    default:
      return assertNever(view);
  }
}

export function inspectorTabsForConceptView(view: EngineeringConceptView): readonly EngineeringInspectorTab[] {
  switch (view) {
    case 'materialLab':
      return ['force', 'material', 'solver'];
    case 'physicsStructural':
      return ['load-case', 'material', 'solver', 'assembly'];
    case 'physicsCorrelation':
      return ['material', 'solver'];
    case 'physicsFieldModal':
      return [];
    default:
      return assertNever(view);
  }
}

export function inspectorTabLabel(view: EngineeringConceptView, tab: EngineeringInspectorTab): string {
  if (view === 'physicsStructural' && tab === 'force') return 'Load Case';
  switch (tab) {
    case 'force':
      return 'Force';
    case 'load-case':
      return 'Load Case';
    case 'material':
      return 'Material';
    case 'solver':
      return 'Solver';
    case 'assembly':
      return 'Assembly';
    default:
      return assertNever(tab);
  }
}

export function defaultLabIdForConceptView(view: EngineeringConceptView): string {
  switch (view) {
    case 'materialLab':
    case 'physicsStructural':
      return DEFAULT_STRUCTURAL_LAB_ID;
    case 'physicsCorrelation':
      return DEFAULT_CORRELATION_LAB_ID;
    case 'physicsFieldModal':
      return FIELD_MODAL_LAB_ID;
    default:
      return assertNever(view);
  }
}

export function defaultMaterialPresetIdForConceptView(view: EngineeringConceptView): MaterialLabPresetId {
  return view === 'physicsFieldModal' ? DEFAULT_COMPOSITE_PRESET_ID : MATERIAL_LAB_SELECTED_PRESET_ID;
}

export function defaultFieldForConceptView(view: EngineeringConceptView): EngineeringFieldId {
  return fieldsForConceptView(view)[0];
}

/** Material Lab COMPARE / CAPTURES tabs correspond to the dedicated workbench screens. */
export function conceptViewForLabChromeTab(tab: EngineeringLabChromeTab): EngineeringConceptView {
  switch (tab) {
    case 'lab':
      return 'materialLab';
    case 'compare':
      return 'physicsCorrelation';
    case 'captures':
      return 'physicsFieldModal';
    default:
      return assertNever(tab);
  }
}

export function defaultConceptFixtureIdFor(
  view: EngineeringConceptView,
  layout: EngineeringLayout,
): EngineeringConceptFixtureId {
  switch (view) {
    case 'materialLab':
      return layout === 'mobile' ? 'material-lab-mobile' : 'material-lab-desktop';
    case 'physicsStructural':
      return 'structural';
    case 'physicsCorrelation':
      return 'correlation';
    case 'physicsFieldModal':
      return 'field-modal';
    default:
      return assertNever(view);
  }
}

export function parseEngineeringConceptView(value: string | null | undefined): EngineeringConceptView | null {
  if (!value) return null;
  const token = value.trim();
  if (hasToken(WORKSPACE_KINDS, token)) return token;
  switch (token.toLowerCase()) {
    case 'material-lab':
    case 'material-lab-desktop':
    case 'material-lab-mobile':
    case 'material':
    case 'lab':
    case 'materiallab':
      return 'materialLab';
    case 'structural':
    case 'structural-test':
    case 'test':
    case 'physicsstructural':
      return 'physicsStructural';
    case 'correlation':
    case 'correlation-review':
    case 'compare':
    case 'physicscorrelation':
      return 'physicsCorrelation';
    case 'field-modal':
    case 'field':
    case 'modal':
    case 'physicsfieldmodal':
      return 'physicsFieldModal';
    default:
      return null;
  }
}

/** Session fixture ids plus the five PNG / shell view-id aliases. */
export function resolveEngineeringConceptFixtureId(value: string | null | undefined): EngineeringConceptFixtureId | null {
  if (!value) return null;
  const token = value.trim();
  if (hasToken(ENGINEERING_CONCEPT_FIXTURE_IDS, token)) return token;
  switch (token) {
    case 'structural-test':
    case 'physicsStructural':
      return 'structural';
    case 'correlation-review':
    case 'physicsCorrelation':
    case 'compare':
      return 'correlation';
    case 'material-lab':
    case 'materialLab':
      return 'material-lab-desktop';
    case 'physicsFieldModal':
    case 'field':
    case 'modal':
      return 'field-modal';
    default:
      return null;
  }
}

export function engineeringLayoutTierForWidth(width: number): EngineeringLayoutTier {
  if (!Number.isFinite(width) || width <= ENGINEERING_LAYOUT_BREAKPOINTS.phoneMax) return 'phone';
  if (width <= ENGINEERING_LAYOUT_BREAKPOINTS.tabletMax) return 'tablet';
  if (width <= ENGINEERING_LAYOUT_BREAKPOINTS.compactMax) return 'compact';
  return 'desktop';
}

export function engineeringLayoutForTier(tier: EngineeringLayoutTier): EngineeringLayout {
  switch (tier) {
    case 'phone':
    case 'tablet':
      return 'mobile';
    case 'compact':
    case 'desktop':
      return 'desktop';
    default:
      return assertNever(tier);
  }
}

export function engineeringLayoutForViewportWidth(width: number): EngineeringLayout {
  return engineeringLayoutForTier(engineeringLayoutTierForWidth(width));
}

export function representativeViewportFor(
  view: EngineeringConceptView,
  layout: EngineeringLayout,
): { readonly width: number; readonly height: number } {
  const concept = conceptAssetFor(view);
  if (layout === 'mobile') {
    for (const viewport of concept.viewports) {
      if (viewport.id === 'phone' || viewport.id === 'portrait') {
        return { width: viewport.width, height: viewport.height };
      }
    }
    return { width: 853, height: 1844 };
  }
  for (const viewport of concept.viewports) {
    if (viewport.id === 'desktop') return { width: viewport.width, height: viewport.height };
  }
  const fallback = concept.viewports[0];
  return { width: fallback.width, height: fallback.height };
}

const VIEW_DEFAULTS: Readonly<Record<EngineeringConceptView, ViewMemory>> = {
  materialLab: {
    labId: DEFAULT_STRUCTURAL_LAB_ID,
    materialPresetId: MATERIAL_LAB_SELECTED_PRESET_ID,
    field: 'stress',
    inspectorTab: 'force',
    labChromeTab: 'lab',
    fieldNav: 'run',
    viewportTool: 'force',
  },
  physicsStructural: {
    labId: DEFAULT_STRUCTURAL_LAB_ID,
    materialPresetId: MATERIAL_LAB_SELECTED_PRESET_ID,
    field: 'strain',
    inspectorTab: 'load-case',
    labChromeTab: 'lab',
    fieldNav: 'run',
    viewportTool: 'orbit',
  },
  physicsCorrelation: {
    labId: DEFAULT_CORRELATION_LAB_ID,
    materialPresetId: MATERIAL_LAB_SELECTED_PRESET_ID,
    field: 'plastic',
    inspectorTab: 'material',
    labChromeTab: 'compare',
    fieldNav: 'run',
    viewportTool: 'orbit',
  },
  physicsFieldModal: {
    labId: FIELD_MODAL_LAB_ID,
    materialPresetId: DEFAULT_COMPOSITE_PRESET_ID,
    field: 'displacement',
    inspectorTab: 'force',
    labChromeTab: 'lab',
    fieldNav: 'run',
    viewportTool: 'orbit',
  },
};

function cloneViewDefaults(): Record<EngineeringConceptView, ViewMemory> {
  return {
    materialLab: { ...VIEW_DEFAULTS.materialLab },
    physicsStructural: { ...VIEW_DEFAULTS.physicsStructural },
    physicsCorrelation: { ...VIEW_DEFAULTS.physicsCorrelation },
    physicsFieldModal: { ...VIEW_DEFAULTS.physicsFieldModal },
  };
}

function freezeSessionState(state: EngineeringSessionState): EngineeringSessionState {
  return Object.freeze({ ...state });
}

function sessionStatesEqual(left: EngineeringSessionState, right: EngineeringSessionState): boolean {
  return left.view === right.view
    && left.layout === right.layout
    && left.viewportWidth === right.viewportWidth
    && left.viewportHeight === right.viewportHeight
    && left.field === right.field
    && left.modal === right.modal
    && left.labId === right.labId
    && left.materialPresetId === right.materialPresetId
    && left.inspectorTab === right.inspectorTab
    && left.labChromeTab === right.labChromeTab
    && left.fieldNav === right.fieldNav
    && left.viewportTool === right.viewportTool
    && left.conceptFixtureId === right.conceptFixtureId
    && left.autoplayOnOpen === right.autoplayOnOpen
    && left.firstRunGuideDismissed === right.firstRunGuideDismissed;
}

function constrainedLabId(view: EngineeringConceptView, labId: string): string {
  const resolved = requireLabId(labId);
  if (view === 'physicsFieldModal' && resolved !== FIELD_MODAL_LAB_ID) {
    throw new Error(`Field Modal only exposes the analysis-only ${FIELD_MODAL_LAB_ID} cantilever.`);
  }
  return resolved;
}

function constrainedField(view: EngineeringConceptView, field: EngineeringFieldId): EngineeringFieldId {
  const available = fieldsForConceptView(view);
  return available.includes(field) ? field : defaultFieldForConceptView(view);
}

function constrainedInspectorTab(
  view: EngineeringConceptView,
  tab: EngineeringInspectorTab,
): EngineeringInspectorTab {
  const available = inspectorTabsForConceptView(view);
  if (available.length === 0) return tab;
  return available.includes(tab) ? tab : available[0];
}

function desktopSheetModal(modal: EngineeringSessionModal | null): EngineeringSessionModal | null {
  if (modal === 'library' || modal === 'inspector') return null;
  return modal;
}

function composeSessionState(
  view: EngineeringConceptView,
  layout: EngineeringLayout,
  memory: ViewMemory,
  viewportWidth: number,
  viewportHeight: number,
  modal: EngineeringSessionModal | null,
  conceptFixtureId: EngineeringConceptFixtureId | null,
  autoplayOnOpen = ENGINEERING_SESSION_FLAG_DEFAULTS.autoplayOnOpen,
  firstRunGuideDismissed = ENGINEERING_SESSION_FLAG_DEFAULTS.firstRunGuideDismissed,
): EngineeringSessionState {
  requirePositiveSize(viewportWidth, viewportHeight);
  return freezeSessionState({
    view,
    layout,
    viewportWidth,
    viewportHeight,
    field: constrainedField(view, memory.field),
    modal: layout === 'desktop' ? desktopSheetModal(modal) : modal,
    labId: constrainedLabId(view, memory.labId),
    materialPresetId: requireMaterialPresetId(memory.materialPresetId),
    inspectorTab: constrainedInspectorTab(view, memory.inspectorTab),
    labChromeTab: memory.labChromeTab,
    fieldNav: memory.fieldNav,
    viewportTool: memory.viewportTool,
    conceptFixtureId,
    autoplayOnOpen,
    firstRunGuideDismissed,
  });
}

function fixtureState(
  id: EngineeringConceptFixtureId,
  view: EngineeringConceptView,
  layout: EngineeringLayout,
  modal: EngineeringSessionModal | null,
): EngineeringSessionState {
  const viewport = representativeViewportFor(view, layout);
  return composeSessionState(view, layout, VIEW_DEFAULTS[view], viewport.width, viewport.height, modal, id);
}

function fixtureFromConcept(
  id: EngineeringConceptFixtureId,
  view: EngineeringConceptView,
  layout: EngineeringLayout,
  assetIndex: number,
  viewportIndex: number,
  modal: EngineeringSessionModal | null,
): EngineeringConceptFixture {
  const concept = conceptAssetFor(view);
  const viewport = concept.viewports[viewportIndex];
  return Object.freeze({
    id,
    title: concept.title,
    mockupPath: concept.assets[assetIndex],
    viewport: Object.freeze({ width: viewport.width, height: viewport.height }),
    workspace: workspaceForConceptView(view),
    state: fixtureState(id, view, layout, modal),
  });
}

export const ENGINEERING_CONCEPT_FIXTURES: readonly EngineeringConceptFixture[] = Object.freeze([
  fixtureFromConcept('material-lab-desktop', 'materialLab', 'desktop', 0, 0, null),
  fixtureFromConcept('material-lab-mobile', 'materialLab', 'mobile', 1, 1, 'inspector'),
  fixtureFromConcept('structural', 'physicsStructural', 'desktop', 0, 0, null),
  fixtureFromConcept('correlation', 'physicsCorrelation', 'desktop', 0, 0, null),
  fixtureFromConcept('field-modal', 'physicsFieldModal', 'mobile', 0, 0, null),
]);

const fixturesById = new Map(ENGINEERING_CONCEPT_FIXTURES.map((fixture) => [fixture.id, fixture] as const));

export function getEngineeringConceptFixture(id: EngineeringConceptFixtureId): EngineeringConceptFixture {
  const fixture = fixturesById.get(id);
  if (!fixture) throw new Error(`Unknown engineering concept fixture: ${id}.`);
  return fixture;
}

export function matchEngineeringConceptFixture(state: EngineeringSessionState): EngineeringConceptFixtureId | null {
  for (const fixture of ENGINEERING_CONCEPT_FIXTURES) {
    if (sessionStatesEqual({
      ...state,
      conceptFixtureId: fixture.id,
      autoplayOnOpen: fixture.state.autoplayOnOpen,
      firstRunGuideDismissed: fixture.state.firstRunGuideDismissed,
    }, fixture.state)) return fixture.id;
  }
  return null;
}

/**
 * Single source of concept-workspace UI mode. Demos switch screens through
 * `setView` / `applyConceptFixture`, which re-arm `autoplayOnOpen`. The run
 * recorder remains the numerical lifecycle owner and is not mutated here.
 */
export class EngineeringSession {
  private current: EngineeringSessionState;
  private readonly memory = cloneViewDefaults();
  private readonly listeners = new Set<EngineeringSessionListener>();

  constructor(options: EngineeringSessionOptions = {}) {
    const view = options.view ?? 'physicsStructural';
    requireToken(ENGINEERING_CONCEPT_VIEWS, view, 'concept view');
    if (options.labId) this.memory[view].labId = constrainedLabId(view, options.labId);
    if (options.materialPresetId) {
      this.memory[view].materialPresetId = requireMaterialPresetId(options.materialPresetId);
    }
    if (options.field) {
      this.memory[view].field = constrainedField(view, requireToken(ENGINEERING_FIELD_IDS, options.field, 'field'));
    }
    if (options.inspectorTab) {
      this.memory[view].inspectorTab = constrainedInspectorTab(
        view,
        requireToken(ENGINEERING_INSPECTOR_TABS, options.inspectorTab, 'inspector tab'),
      );
    }
    if (options.labChromeTab) {
      this.memory[view].labChromeTab = requireToken(
        ENGINEERING_LAB_CHROME_TABS,
        options.labChromeTab,
        'lab chrome tab',
      );
    }
    if (options.fieldNav) {
      this.memory[view].fieldNav = requireToken(ENGINEERING_FIELD_NAV_IDS, options.fieldNav, 'field nav');
    }
    if (options.viewportTool) {
      this.memory[view].viewportTool = requireToken(
        ENGINEERING_VIEWPORT_TOOLS,
        options.viewportTool,
        'viewport tool',
      );
    }

    const layout = options.layout
      ?? (options.viewportWidth !== undefined
        ? engineeringLayoutForViewportWidth(options.viewportWidth)
        : 'desktop');
    requireToken(ENGINEERING_LAYOUTS, layout, 'layout');
    const representative = representativeViewportFor(view, layout);
    const width = options.viewportWidth ?? representative.width;
    const height = options.viewportHeight ?? representative.height;
    const modal = options.modal === undefined ? null : options.modal;
    if (modal !== null) requireToken(ENGINEERING_SESSION_MODALS, modal, 'modal');
    this.current = composeSessionState(
      view,
      layout,
      this.memory[view],
      width,
      height,
      modal,
      null,
      options.autoplayOnOpen ?? ENGINEERING_SESSION_FLAG_DEFAULTS.autoplayOnOpen,
      options.firstRunGuideDismissed ?? loadFirstRunGuideDismissed(),
    );
  }

  static fromConceptFixture(id: EngineeringConceptFixtureId): EngineeringSession {
    const session = new EngineeringSession();
    session.applyConceptFixture(id);
    return session;
  }

  get state(): EngineeringSessionState { return this.current; }
  get view(): EngineeringConceptView { return this.current.view; }
  get layout(): EngineeringLayout { return this.current.layout; }
  get viewportWidth(): number { return this.current.viewportWidth; }
  get viewportHeight(): number { return this.current.viewportHeight; }
  get field(): EngineeringFieldId { return this.current.field; }
  get modal(): EngineeringSessionModal | null { return this.current.modal; }
  get labId(): string { return this.current.labId; }
  get materialPresetId(): MaterialLabPresetId { return this.current.materialPresetId; }
  get workspace(): EngineeringWorkspace { return workspaceForConceptView(this.current.view); }
  get renderSlotCount(): 1 | 2 { return renderSlotCountForView(this.current.view); }
  get autoplayOnOpen(): boolean { return this.current.autoplayOnOpen; }
  get firstRunGuideDismissed(): boolean { return this.current.firstRunGuideDismissed; }
  get showsFirstRunGuide(): boolean { return !this.current.firstRunGuideDismissed; }

  snapshot(): EngineeringSessionState { return this.current; }

  subscribe(listener: EngineeringSessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  isModalOpen(modal?: EngineeringSessionModal): boolean {
    return modal ? this.current.modal === modal : this.current.modal !== null;
  }

  setView(view: EngineeringConceptView, options: EngineeringSessionAutoplayOptions = {}): void {
    const next = requireToken(ENGINEERING_CONCEPT_VIEWS, view, 'concept view');
    this.commit(composeSessionState(
      next,
      this.current.layout,
      this.memory[next],
      this.current.viewportWidth,
      this.current.viewportHeight,
      null,
      null,
      options.autoplayOnOpen ?? true,
      this.current.firstRunGuideDismissed,
    ));
  }

  /** Switches chrome density and adopts the mockup viewport for that density. Live shells should prefer `setViewportSize`. */
  setLayout(layout: EngineeringLayout): void {
    const next = requireToken(ENGINEERING_LAYOUTS, layout, 'layout');
    const viewport = representativeViewportFor(this.current.view, next);
    this.commit(composeSessionState(
      this.current.view,
      next,
      this.memory[this.current.view],
      viewport.width,
      viewport.height,
      next === 'desktop' ? desktopSheetModal(this.current.modal) : this.current.modal,
      null,
      this.current.autoplayOnOpen,
      this.current.firstRunGuideDismissed,
    ));
  }

  setViewportSize(width: number, height: number): void {
    requirePositiveSize(width, height);
    const layout = engineeringLayoutForViewportWidth(width);
    this.commit(composeSessionState(
      this.current.view,
      layout,
      this.memory[this.current.view],
      width,
      height,
      layout === 'desktop' ? desktopSheetModal(this.current.modal) : this.current.modal,
      null,
      this.current.autoplayOnOpen,
      this.current.firstRunGuideDismissed,
    ));
  }

  selectField(field: EngineeringFieldId): void {
    const next = requireToken(ENGINEERING_FIELD_IDS, field, 'field');
    const available = fieldsForConceptView(this.current.view);
    if (!available.includes(next)) {
      throw new Error(`Field '${next}' is not available on ${this.current.view}.`);
    }
    this.memory[this.current.view].field = next;
    this.patch({ field: next });
  }

  openModal(modal: EngineeringSessionModal): void {
    const next = requireToken(ENGINEERING_SESSION_MODALS, modal, 'modal');
    if (this.current.layout === 'desktop' && (next === 'library' || next === 'inspector')) {
      throw new Error(`Modal '${next}' is a mobile sheet and is closed on desktop chrome.`);
    }
    this.patch({ modal: next });
  }

  closeModal(): void {
    this.patch({ modal: null });
  }

  toggleModal(modal: EngineeringSessionModal): void {
    if (this.current.modal === modal) this.closeModal();
    else this.openModal(modal);
  }

  selectLab(labId: string): void {
    const next = constrainedLabId(this.current.view, labId);
    this.memory[this.current.view].labId = next;
    this.patch({ labId: next });
  }

  selectMaterialPreset(presetId: string): void {
    const next = requireMaterialPresetId(presetId);
    this.memory[this.current.view].materialPresetId = next;
    this.patch({ materialPresetId: next });
  }

  setInspectorTab(tab: EngineeringInspectorTab): void {
    const next = requireToken(ENGINEERING_INSPECTOR_TABS, tab, 'inspector tab');
    const available = inspectorTabsForConceptView(this.current.view);
    if (available.length === 0) {
      throw new Error(`Inspector tabs are not part of the ${this.current.view} chrome.`);
    }
    if (!available.includes(next)) {
      throw new Error(`Inspector tab '${next}' is not available on ${this.current.view}.`);
    }
    this.memory[this.current.view].inspectorTab = next;
    this.patch({ inspectorTab: next });
  }

  setLabChromeTab(tab: EngineeringLabChromeTab): void {
    const next = requireToken(ENGINEERING_LAB_CHROME_TABS, tab, 'lab chrome tab');
    if (this.current.view !== 'materialLab') {
      throw new Error('LAB / COMPARE / CAPTURES chrome belongs to Material Lab.');
    }
    this.memory.materialLab.labChromeTab = next;
    this.patch({ labChromeTab: next });
  }

  setFieldNav(nav: EngineeringFieldNavId): void {
    const next = requireToken(ENGINEERING_FIELD_NAV_IDS, nav, 'field nav');
    if (this.current.view !== 'physicsFieldModal') {
      throw new Error('Field navigation belongs to Field Modal.');
    }
    this.memory.physicsFieldModal.fieldNav = next;
    this.patch({ fieldNav: next });
  }

  setViewportTool(tool: EngineeringViewportTool): void {
    const next = requireToken(ENGINEERING_VIEWPORT_TOOLS, tool, 'viewport tool');
    this.memory[this.current.view].viewportTool = next;
    this.patch({ viewportTool: next });
  }

  applyConceptFixture(id: string, options: EngineeringSessionAutoplayOptions = {}): void {
    const resolved = resolveEngineeringConceptFixtureId(id);
    if (!resolved) throw new Error(`Unknown engineering concept fixture: ${id}.`);
    const fixture = getEngineeringConceptFixture(resolved);
    this.memory[fixture.state.view] = {
      labId: fixture.state.labId,
      materialPresetId: fixture.state.materialPresetId,
      field: fixture.state.field,
      inspectorTab: fixture.state.inspectorTab,
      labChromeTab: fixture.state.labChromeTab,
      fieldNav: fixture.state.fieldNav,
      viewportTool: fixture.state.viewportTool,
    };
    this.commit(freezeSessionState({
      ...fixture.state,
      autoplayOnOpen: options.autoplayOnOpen ?? true,
      firstRunGuideDismissed: this.current.firstRunGuideDismissed,
    }));
  }

  setAutoplayOnOpen(enabled: boolean): void {
    this.patchSessionFlags({ autoplayOnOpen: enabled });
  }

  /** Returns whether autoplay is allowed, then clears the one-shot flag. */
  consumeAutoplayOnOpen(): boolean {
    const allowed = this.current.autoplayOnOpen;
    if (allowed) this.patchSessionFlags({ autoplayOnOpen: false });
    return allowed;
  }

  setFirstRunGuideDismissed(dismissed: boolean): void {
    this.patchSessionFlags({ firstRunGuideDismissed: dismissed });
    persistFirstRunGuideDismissed(dismissed);
  }

  dismissFirstRunGuide(): void {
    this.setFirstRunGuideDismissed(true);
  }

  private patch(update: Partial<EngineeringSessionState>): void {
    this.commit(freezeSessionState({
      ...this.current,
      ...update,
      conceptFixtureId: null,
      autoplayOnOpen: this.current.autoplayOnOpen,
      firstRunGuideDismissed: this.current.firstRunGuideDismissed,
    }));
  }

  private patchSessionFlags(update: Partial<EngineeringSessionFlags>): void {
    this.commit(freezeSessionState({
      ...this.current,
      ...update,
    }));
  }

  private commit(next: EngineeringSessionState): void {
    if (sessionStatesEqual(this.current, next)) return;
    this.current = next;
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

