import './engineering-workspaces.css';
import { getEngineeringModelForLab } from '../workbench/engineering-model';
import type {
  EngineeringRunSnapshot,
  EngineeringRunState as EngineeringRecorderState,
  EngineeringSample,
} from '../workbench/engineering-session';
import { getWorkbenchLab, getWorkbenchLabAutoplay } from '../workbench/registry';
import { mountFirstRunGuide, FIRST_RUN_GUIDE_CHANGED_EVENT, type FirstRunGuideController } from './first-run-guide';
import { createMaterialLabDesktop, type MaterialLabDesktopControlChange, type MaterialLabDesktopController } from './material-lab-desktop';
import { mountMaterialLabMobile, type MaterialLabMobileController } from './material-lab-mobile';
import {
  createPhysicsFieldModal,
  PHYSICS_FIELD_MODAL_VIEWS,
  type PhysicsFieldCapture,
  type PhysicsFieldChannel,
  type PhysicsFieldModalController,
  type PhysicsFieldStatusTile,
} from './physics-field-modal';
import {
  createPhysicsStructural,
  PHYSICS_STRUCTURAL_REGIONS,
  type PhysicsStructuralController,
  type PhysicsStructuralRunCommand,
} from './physics-structural';
import {
  mountPhysicsCorrelation,
  type PhysicsCorrelationChartId,
  type PhysicsCorrelationPlot,
  type PhysicsCorrelationView,
} from './physics-correlation';

export { PHYSICS_FIELD_MODAL_VIEWS, PHYSICS_STRUCTURAL_REGIONS };
export { createPhysicsFieldModal, createPhysicsStructural, mountPhysicsCorrelation };

/**
 * Workspace shell for the five concept screens. Sibling modules should call
 * `setConceptView` / `getRegion` rather than reaching into markup.
 *
 * Concept view IDs: material-lab-desktop | material-lab-mobile | structural-test |
 * correlation-review | field-modal
 *
 * Region IDs: header | left | center | viewport | right | analysis | transport |
 * status | mobile-nav
 *
 * Demo URL hooks: ?view=material-lab-desktop | ?layout=material-lab&chrome=compact
 * | ?autoplay=1 | ?ui=simple
 * Events: engineering-workspace-change, engineering-layout-change,
 * engineering-concept-view-change, engineering-field-view-change,
 * engineering-pointer-mode, engineering-play
 */

export const ENGINEERING_WORKSPACE_IDS = ['test', 'correlation', 'field'] as const;
export type EngineeringWorkspaceId = (typeof ENGINEERING_WORKSPACE_IDS)[number];

/** Concept-screen layouts demos can open. `test` hosts structural-test or material-lab. */
export const ENGINEERING_LAYOUT_IDS = [
  'material-lab',
  'structural-test',
  'correlation-review',
  'field-modal',
] as const;
export type EngineeringLayoutId = (typeof ENGINEERING_LAYOUT_IDS)[number];

/** Desktop three-pane chrome vs stacked compact chrome (material-lab-mobile.png). */
export const ENGINEERING_CHROME_IDS = ['desktop', 'compact'] as const;
export type EngineeringChromeId = (typeof ENGINEERING_CHROME_IDS)[number];

/** One ID per concept PNG. Prefer `setConceptView` from demos and sibling modules. */
export const ENGINEERING_CONCEPT_VIEW_IDS = [
  'material-lab-desktop',
  'material-lab-mobile',
  'structural-test',
  'correlation-review',
  'field-modal',
] as const;
export type EngineeringConceptViewId = (typeof ENGINEERING_CONCEPT_VIEW_IDS)[number];

export const ENGINEERING_REGION_IDS = [
  'header',
  'left',
  'center',
  'viewport',
  'right',
  'analysis',
  'transport',
  'status',
  'mobile-nav',
] as const;
export type EngineeringRegionId = (typeof ENGINEERING_REGION_IDS)[number];

export const ENGINEERING_FIELD_VIEW_IDS = ['run', 'channels', 'modes', 'notes'] as const;
export type EngineeringFieldViewId = (typeof ENGINEERING_FIELD_VIEW_IDS)[number];

export const ENGINEERING_MATERIAL_TAB_IDS = ['force', 'material', 'solver'] as const;
export type EngineeringMaterialTabId = (typeof ENGINEERING_MATERIAL_TAB_IDS)[number];

export const ENGINEERING_LAB_NAV_IDS = ['lab', 'compare', 'captures'] as const;
export type EngineeringLabNavId = (typeof ENGINEERING_LAB_NAV_IDS)[number];

export const ENGINEERING_POINTER_MODE_IDS = ['orbit', 'force'] as const;
export type EngineeringPointerModeId = (typeof ENGINEERING_POINTER_MODE_IDS)[number];

export type EngineeringConceptViewSpec = {
  readonly workspace: EngineeringWorkspaceId;
  readonly layout: EngineeringLayoutId;
  readonly chrome: EngineeringChromeId;
  readonly regions: readonly EngineeringRegionId[];
};

export const ENGINEERING_CONCEPT_VIEWS: Readonly<Record<EngineeringConceptViewId, EngineeringConceptViewSpec>> = {
  'material-lab-desktop': {
    workspace: 'test',
    layout: 'material-lab',
    chrome: 'desktop',
    regions: ['header', 'left', 'viewport', 'right', 'transport'],
  },
  'material-lab-mobile': {
    workspace: 'test',
    layout: 'material-lab',
    chrome: 'compact',
    regions: ['header', 'viewport', 'right', 'mobile-nav', 'transport'],
  },
  'structural-test': {
    workspace: 'test',
    layout: 'structural-test',
    chrome: 'desktop',
    regions: ['header', 'left', 'viewport', 'analysis', 'right', 'status'],
  },
  'correlation-review': {
    workspace: 'correlation',
    layout: 'correlation-review',
    chrome: 'desktop',
    regions: ['header', 'left', 'viewport', 'transport', 'analysis', 'right', 'status'],
  },
  'field-modal': {
    workspace: 'field',
    layout: 'field-modal',
    chrome: 'compact',
    regions: ['header', 'viewport', 'right', 'analysis', 'transport', 'mobile-nav'],
  },
};

export const ENGINEERING_WORKSPACE_FOR_LAYOUT: Readonly<Record<EngineeringLayoutId, EngineeringWorkspaceId>> = {
  'material-lab': 'test',
  'structural-test': 'test',
  'correlation-review': 'correlation',
  'field-modal': 'field',
};

/** Sibling factories the shell mounts or re-exports for demos. */
export const ENGINEERING_CONCEPT_MODULES = {
  'material-lab-desktop': 'createMaterialLabDesktop',
  'material-lab-mobile': 'mountMaterialLabMobile',
  'structural-test': 'createPhysicsStructural',
  'correlation-review': 'mountPhysicsCorrelation',
  'field-modal': 'createPhysicsFieldModal',
} as const;

export const ENGINEERING_RUN_STATES = [
  'idle',
  'preflight',
  'armed',
  'running',
  'paused',
  'complete',
  'aborted',
  'error',
] as const;
export type EngineeringRunState = (typeof ENGINEERING_RUN_STATES)[number];

export type EngineeringRunCommand = 'arm' | 'run' | 'pause' | 'complete' | 'reset' | 'replay' | 'abort';
export type EngineeringChartId =
  | 'correlation-force'
  | 'correlation-energy'
  | 'correlation-residual'
  | 'field-frequency-response'
  | 'field-coherence';

export type EngineeringChannelStatus = 'nominal' | 'warning' | 'fault' | 'offline';
export type EngineeringCaseStatus = 'pass' | 'pass-with-notes' | 'fail' | 'pending';
export type EngineeringProvenance = 'solver' | 'measured' | 'synthetic' | 'proxy';

export type EngineeringMeasurement = {
  readonly value: number | string;
  readonly unit?: string;
  readonly precision?: number;
};

export type EngineeringChannelUpdate = {
  readonly id: string;
  readonly label?: string;
  readonly value?: number | string;
  readonly unit?: string;
  readonly status?: EngineeringChannelStatus;
  readonly enabled?: boolean;
};

export type EngineeringTelemetryUpdate = {
  readonly timeSeconds?: number;
  readonly step?: number;
  readonly frame?: number;
  readonly force?: EngineeringMeasurement;
  readonly displacement?: EngineeringMeasurement;
  readonly strainX?: EngineeringMeasurement;
  readonly strainY?: EngineeringMeasurement;
  readonly strainXY?: EngineeringMeasurement;
  readonly energy?: EngineeringMeasurement;
  readonly residual?: EngineeringMeasurement;
  readonly correlationPercent?: number;
  readonly frequencyHz?: number;
  readonly dampingPercent?: number;
  readonly coherence?: number;
  readonly convergence?: number | string;
  readonly backend?: string;
  readonly seed?: number | string;
  readonly fps?: number;
  readonly channels?: readonly EngineeringChannelUpdate[];
};

export type EngineeringRunLifecycleUpdate = {
  readonly state: EngineeringRunState;
  readonly elapsedSeconds?: number;
  readonly step?: number;
  readonly frame?: number;
  readonly progress?: number;
  readonly message?: string;
};

export type EngineeringChartSeries = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly color?: string;
  readonly dashed?: boolean;
};

export type EngineeringChartUpdate = {
  readonly x?: readonly number[];
  readonly series: readonly EngineeringChartSeries[];
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly cursorX?: number;
  readonly xDomain?: readonly [number, number];
  readonly yDomain?: readonly [number, number];
};

export type EngineeringCorrelationCase = {
  readonly id: string;
  readonly speed: number;
  readonly angle: number;
  readonly status: EngineeringCaseStatus;
  readonly note?: string;
};

export type EngineeringReferenceMedia = {
  readonly kind: 'image' | 'video';
  readonly src: string;
  readonly label: string;
  readonly provenance?: 'deterministic' | 'imported';
};

export type EngineeringModalCapture = {
  readonly id: string;
  readonly label: string;
  readonly sampleCount: number;
  readonly status: 'accepted' | 'rejected';
};

export type EngineeringImportKind = 'reference-media' | 'correlation-data';

export type EngineeringImportRequest = {
  readonly workspace: 'correlation';
  readonly kind: EngineeringImportKind;
  readonly file: File;
};

export type EngineeringEvidenceRequest = {
  readonly workspace: 'correlation';
  readonly caseId: string;
  readonly run: EngineeringRunLifecycleUpdate;
  readonly telemetry: Readonly<EngineeringTelemetryUpdate>;
  readonly generatedAt: string;
};

export type EngineeringRunCommandRequest = {
  readonly workspace: EngineeringWorkspaceId;
  readonly command: EngineeringRunCommand;
};

export type EngineeringWorkspaceCallbacks = {
  readonly onWorkspaceChange?: (workspace: EngineeringWorkspaceId) => void;
  readonly onLayoutChange?: (layout: EngineeringLayoutId) => void;
  readonly onConceptViewChange?: (view: EngineeringConceptViewId) => void;
  readonly onFieldViewChange?: (view: EngineeringFieldViewId) => void;
  readonly onRunCommand?: (request: EngineeringRunCommandRequest) => void | Promise<void>;
  readonly onFrameSeek?: (frame: number) => void;
  readonly onCaseChange?: (caseId: string) => void;
  readonly onFileImport?: (request: EngineeringImportRequest) => void | Promise<void>;
  readonly onEvidenceExport?: (request: EngineeringEvidenceRequest) => void | Promise<void>;
  readonly onLabChange?: (labId: string) => void;
  readonly onControlChange?: (change: MaterialLabDesktopControlChange) => void;
  readonly onMaterialPresetChange?: (presetId: string) => void;
  readonly onPlay?: (detail: EngineeringPlayDetail) => void;
};

export type EngineeringPlayDetail = {
  readonly view: EngineeringConceptViewId;
  readonly labId: string;
  readonly alreadyStarted: boolean;
  readonly command: 'play';
};

export type EngineeringDemoIntent = {
  readonly autoplay: boolean;
  readonly simpleUi: boolean;
};

export type EngineeringWorkspacesOptions = {
  readonly mount: HTMLElement;
  readonly testWorkspace: HTMLElement;
  readonly viewport?: HTMLElement;
  readonly initialWorkspace?: EngineeringWorkspaceId;
  readonly initialLayout?: EngineeringLayoutId;
  readonly initialChrome?: EngineeringChromeId | 'auto';
  readonly initialConceptView?: EngineeringConceptViewId;
  readonly initialLabId?: string;
  readonly idPrefix?: string;
  readonly projectLabel?: string;
  readonly testLabel?: string;
  readonly autoplay?: boolean;
  readonly simpleUi?: boolean;
  readonly playbackStarted?: boolean;
  readonly callbacks?: EngineeringWorkspaceCallbacks;
};

export type EngineeringWorkspacesController = {
  readonly root: HTMLElement;
  getWorkspace(): EngineeringWorkspaceId;
  setWorkspace(workspace: EngineeringWorkspaceId, options?: { focus?: boolean; announce?: boolean }): void;
  getLayout(): EngineeringLayoutId;
  setLayout(layout: EngineeringLayoutId, options?: { focus?: boolean; announce?: boolean }): void;
  getChrome(): EngineeringChromeId;
  setChrome(chrome: EngineeringChromeId | 'auto'): void;
  getConceptView(): EngineeringConceptViewId;
  setConceptView(view: EngineeringConceptViewId, options?: { focus?: boolean; announce?: boolean }): void;
  getFieldView(): EngineeringFieldViewId;
  setFieldView(view: EngineeringFieldViewId): void;
  getMaterialTab(): EngineeringMaterialTabId;
  setMaterialTab(tab: EngineeringMaterialTabId): void;
  getRegion(region: EngineeringRegionId, layout?: EngineeringLayoutId): HTMLElement | null;
  attachViewport(viewport: HTMLElement): void;
  moveViewport(workspace?: EngineeringWorkspaceId): void;
  setActiveLab(labId: string, title?: string): void;
  updateTelemetry(update: EngineeringTelemetryUpdate): void;
  updateRunLifecycle(update: EngineeringRunLifecycleUpdate): void;
  updateChart(chart: EngineeringChartId, update: EngineeringChartUpdate): void;
  setCorrelationCases(cases: readonly EngineeringCorrelationCase[], activeCaseId?: string): void;
  setCorrelationReference(reference: EngineeringReferenceMedia | null): void;
  setCorrelationWorkSnapshot(snapshot: EngineeringReferenceMedia | null): void;
  updateModalCaptures(captures: readonly EngineeringModalCapture[]): void;
  setProvenance(provenance: EngineeringProvenance, label?: string): void;
  setPointerMode(mode: EngineeringPointerModeId): void;
  setForceAvailable(available: boolean): void;
  setPlaybackStarted(started: boolean): void;
  getSimpleUi(): boolean;
  setSimpleUi(enabled: boolean): void;
  setFileImportCallback(callback?: EngineeringWorkspaceCallbacks['onFileImport']): void;
  setEvidenceExportCallback(callback?: EngineeringWorkspaceCallbacks['onEvidenceExport']): void;
  destroy(): void;
};

const DEFAULT_CASES: readonly EngineeringCorrelationCase[] = [
  { id: '01', speed: 0.25, angle: 0, status: 'pending' },
  { id: '02', speed: 0.5, angle: 0, status: 'pending' },
  { id: '03', speed: 0.75, angle: 0, status: 'pending', note: 'Synthetic demo fixture' },
  { id: '04', speed: 1, angle: 0, status: 'pending' },
  { id: '05', speed: 0.75, angle: 5, status: 'pending' },
];

const CHART_COLORS = ['#20c8f4', '#9b55f5', '#f1f3f2', '#ff7900', '#6bd657'] as const;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Engineering workspace element not found: ${selector}`);
  return element;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatMeasurement(measurement: EngineeringMeasurement): string {
  const precision = measurement.precision ?? 2;
  const value = typeof measurement.value === 'number'
    ? measurement.value.toFixed(precision)
    : measurement.value;
  return measurement.unit ? `${value} ${measurement.unit}` : value;
}

function formatChannelValue(value: number | string, unit?: string): string {
  if (typeof value !== 'number') return unit ? `${value} ${unit}` : value;
  const magnitude = Math.abs(value);
  const precision = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  const formatted = value.toFixed(precision).replace(/\.?0+$/u, '');
  return unit ? `${formatted} ${unit}` : formatted;
}

function statusLabel(status: EngineeringCaseStatus): string {
  switch (status) {
    case 'pass-with-notes': return 'PASS W/ NOTES';
    case 'pass': return 'PASS';
    case 'fail': return 'FAIL';
    case 'pending': return 'PENDING';
    default: return assertNever(status, `Unknown case status: ${String(status)}`);
  }
}

function statusIcon(status: EngineeringChannelStatus): string {
  switch (status) {
    case 'nominal': return 'ph-check-circle';
    case 'warning': return 'ph-warning';
    case 'fault': return 'ph-x-circle';
    case 'offline': return 'ph-minus-circle';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function assertNever(value: never, message: string): never {
  throw new Error(message);
}

const FIELD_MODULE_CHANNELS: readonly PhysicsFieldChannel[] = [
  { id: 'a1', label: 'P1', value: '— derived', status: 'nominal' },
  { id: 'a2', label: 'P2', value: '— derived', status: 'nominal' },
  { id: 'a3', label: 'P3', value: '— derived', status: 'nominal' },
  { id: 'a4', label: 'P4', value: '— derived', status: 'nominal' },
  { id: 'a5', label: 'P5', value: '— derived', status: 'nominal' },
];

const FIELD_MODULE_TILES: readonly PhysicsFieldStatusTile[] = [
  { id: 'preflight', icon: 'ph-circle-dashed', label: 'PREFLIGHT', value: 'Required', tone: 'caution' },
  { id: 'accel-zero', icon: 'ph-waveform', label: 'BASELINE', value: 'Undamaged model', tone: 'good' },
  { id: 'overload', icon: 'ph-gauge', label: 'PARAMETER LIMITS', value: 'Declared range', tone: 'info' },
  { id: 'coherence', icon: 'ph-stack', label: 'ENSEMBLE INPUT', value: 'Needs 3 accepted', tone: 'caution', editable: true },
  { id: 'sampling', icon: 'ph-pulse', label: 'SAMPLE RATE', value: '60 model Hz', tone: 'info' },
  { id: 'filter', icon: 'ph-faders', label: 'WINDOW', value: 'Hann', tone: 'info' },
  { id: 'calibration', icon: 'ph-calendar', label: 'CALIBRATION', value: 'Not attached', tone: 'caution' },
  { id: 'twin', icon: 'ph-cube', label: 'MODEL BUILD', value: 'Deterministic', tone: 'good' },
];

const EMPTY_FIELD_CHART = {
  x: [] as readonly number[],
  series: [{ id: 'awaiting', label: 'Awaiting accepted capture', values: [] as readonly number[], color: '#20c8f4' }],
  xLabel: 'model Hz',
  yLabel: 'relative amplitude',
} as const;

function stampAttr(root: ParentNode, selector: string, name: string, value = ''): void {
  const node = root.querySelector<HTMLElement>(selector);
  if (node) node.setAttribute(name, value);
}

function stampRegions(root: ParentNode, map: Readonly<Partial<Record<EngineeringRegionId, string>>>): void {
  for (const region of ENGINEERING_REGION_IDS) {
    const selector = map[region];
    if (selector) stampAttr(root, selector, 'data-eng-region', region);
  }
}

function attachWorkspaceMenuButton(host: HTMLElement, selector: string, className: string): void {
  if (host.querySelector('[data-eng-action="workspace-menu"]')) return;
  const target = host.querySelector(selector);
  if (!target) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.engAction = 'workspace-menu';
  button.setAttribute('aria-label', 'Open workspace menu');
  button.innerHTML = '<i class="ph ph-squares-four" aria-hidden="true"></i>';
  target.append(button);
}

function mapShellRunState(state: EngineeringRunState): EngineeringRecorderState {
  switch (state) {
    case 'idle': return 'draft';
    case 'preflight': return 'preflight';
    case 'armed': return 'armed';
    case 'running': return 'running';
    case 'paused': return 'paused';
    case 'complete': return 'complete';
    case 'aborted':
    case 'error':
      return 'aborted';
    default:
      return assertNever(state, `Unknown run state: ${String(state)}`);
  }
}

function toCorrelationPlot(update: EngineeringChartUpdate): PhysicsCorrelationPlot {
  const maxLength = Math.max(0, ...update.series.map((series) => series.values.length));
  return {
    x: update.x && update.x.length >= maxLength ? update.x : Array.from({ length: maxLength }, (_, index) => index),
    series: update.series,
    xLabel: update.xLabel,
    yLabel: update.yLabel,
    xDomain: update.xDomain,
    yDomain: update.yDomain,
    cursorX: update.cursorX,
  };
}

function correlationChartId(chart: EngineeringChartId): PhysicsCorrelationChartId | null {
  switch (chart) {
    case 'correlation-force': return 'response';
    case 'correlation-energy': return 'energy';
    case 'correlation-residual': return 'residual';
    case 'field-frequency-response':
    case 'field-coherence':
      return null;
    default:
      return assertNever(chart, `Unknown engineering chart: ${String(chart)}`);
  }
}

function toFieldCaptures(captures: readonly EngineeringModalCapture[]): PhysicsFieldCapture[] {
  const slots: PhysicsFieldCapture[] = [];
  for (let index = 0; index < 6; index += 1) {
    const capture = captures[index];
    if (capture) {
      slots.push({
        id: capture.id,
        label: capture.label,
        sampleCount: capture.sampleCount,
        status: capture.status,
      });
    } else if (index === captures.length) {
      slots.push({ id: `arm-${index}`, label: String(index + 1).padStart(3, '0'), sampleCount: 0, status: 'armed' });
    } else {
      slots.push({ id: `empty-${index}`, label: String(index + 1).padStart(3, '0'), sampleCount: 0, status: 'empty' });
    }
  }
  return slots;
}

export function isEngineeringWorkspaceId(value: string | null | undefined): value is EngineeringWorkspaceId {
  return value != null && (ENGINEERING_WORKSPACE_IDS as readonly string[]).includes(value);
}

export function isEngineeringLayoutId(value: string | null | undefined): value is EngineeringLayoutId {
  return value != null && (ENGINEERING_LAYOUT_IDS as readonly string[]).includes(value);
}

export function isEngineeringConceptViewId(value: string | null | undefined): value is EngineeringConceptViewId {
  return value != null && (ENGINEERING_CONCEPT_VIEW_IDS as readonly string[]).includes(value);
}

export function isEngineeringFieldViewId(value: string | null | undefined): value is EngineeringFieldViewId {
  return value != null && (ENGINEERING_FIELD_VIEW_IDS as readonly string[]).includes(value);
}

export function isEngineeringMaterialTabId(value: string | null | undefined): value is EngineeringMaterialTabId {
  return value != null && (ENGINEERING_MATERIAL_TAB_IDS as readonly string[]).includes(value);
}

export function isEngineeringLabNavId(value: string | null | undefined): value is EngineeringLabNavId {
  return value != null && (ENGINEERING_LAB_NAV_IDS as readonly string[]).includes(value);
}

export function isEngineeringPointerModeId(value: string | null | undefined): value is EngineeringPointerModeId {
  return value != null && (ENGINEERING_POINTER_MODE_IDS as readonly string[]).includes(value);
}

export function isEngineeringRegionId(value: string | null | undefined): value is EngineeringRegionId {
  return value != null && (ENGINEERING_REGION_IDS as readonly string[]).includes(value);
}

export function workspaceLabel(workspace: EngineeringWorkspaceId): string {
  switch (workspace) {
    case 'test': return 'Structural Test';
    case 'correlation': return 'Correlation Review';
    case 'field': return 'Field Modal';
    default: return assertNever(workspace, `Unknown engineering workspace: ${String(workspace)}`);
  }
}

export function layoutLabel(layout: EngineeringLayoutId): string {
  switch (layout) {
    case 'material-lab': return 'Material Lab';
    case 'structural-test': return 'Structural Test';
    case 'correlation-review': return 'Correlation Review';
    case 'field-modal': return 'Field Modal';
    default: return assertNever(layout, `Unknown engineering layout: ${String(layout)}`);
  }
}

export function conceptViewLabel(view: EngineeringConceptViewId): string {
  switch (view) {
    case 'material-lab-desktop': return 'Material Lab desktop';
    case 'material-lab-mobile': return 'Material Lab mobile';
    case 'structural-test': return 'Structural Test';
    case 'correlation-review': return 'Correlation Review';
    case 'field-modal': return 'Field Modal';
    default: return assertNever(view, `Unknown concept view: ${String(view)}`);
  }
}

export function layoutForWorkspace(
  workspace: EngineeringWorkspaceId,
  testLayout: EngineeringLayoutId = 'structural-test',
): EngineeringLayoutId {
  switch (workspace) {
    case 'test': return testLayout === 'material-lab' ? 'material-lab' : 'structural-test';
    case 'correlation': return 'correlation-review';
    case 'field': return 'field-modal';
    default: return assertNever(workspace, `Unknown engineering workspace: ${String(workspace)}`);
  }
}

export function resolveConceptView(
  workspace: EngineeringWorkspaceId,
  layout: EngineeringLayoutId,
  chrome: EngineeringChromeId,
): EngineeringConceptViewId {
  switch (layout) {
    case 'material-lab':
      return chrome === 'compact' ? 'material-lab-mobile' : 'material-lab-desktop';
    case 'structural-test':
      return 'structural-test';
    case 'correlation-review':
      return 'correlation-review';
    case 'field-modal':
      return 'field-modal';
    default:
      return assertNever(layout, `Unknown engineering layout: ${String(layout)}`);
  }
}

function conceptViewFromSearch(search: string): EngineeringConceptViewId | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const view = params.get('view');
  if (isEngineeringConceptViewId(view)) return view;
  const layout = params.get('layout');
  const chrome = params.get('chrome') === 'compact' ? 'compact' : 'desktop';
  if (layout === 'material-lab') return chrome === 'compact' ? 'material-lab-mobile' : 'material-lab-desktop';
  if (layout === 'structural-test') return 'structural-test';
  if (layout === 'correlation-review') return 'correlation-review';
  if (layout === 'field-modal') return 'field-modal';
  const workspace = params.get('workspace');
  if (workspace === 'correlation') return 'correlation-review';
  if (workspace === 'field') return 'field-modal';
  return null;
}

function parseFlagParam(params: URLSearchParams, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    if (value === '0' || value === 'false' || value === 'off') return false;
    return true;
  }
  return null;
}

/** Demo URL flags: ?autoplay=1 | ?autoplay=0 | ?ui=simple | ?ui=full | ?simple=1 */
export function demoIntentFromSearch(search: string): EngineeringDemoIntent {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const ui = params.get('ui');
  const autoplay = parseFlagParam(params, ['autoplay', 'play']);
  const simpleParam = parseFlagParam(params, ['simple', 'simpleUi']);
  return {
    autoplay: autoplay ?? true,
    simpleUi: ui === 'full' ? false : ui === 'simple' ? true : simpleParam ?? true,
  };
}

function deterministicSeries(length: number, sample: (t: number) => number): number[] {
  return Array.from({ length }, (_, index) => sample(index / Math.max(1, length - 1)));
}

function createDefaultCharts(): Readonly<Record<EngineeringChartId, EngineeringChartUpdate>> {
  const x = Array.from({ length: 80 }, (_, index) => index / 79);
  const reference = deterministicSeries(80, (t) => (1 - Math.exp(-7 * t)) * (1 - 0.22 * Math.max(0, (t - 0.55) / 0.45)));
  const simulation = reference.map((value, index) => value * (0.975 + 0.025 * Math.sin(index * 0.23)));
  const residual = simulation.map((value, index) => value - reference[index]);
  return {
    'correlation-force': {
      x,
      series: [
        { id: 'reference', label: 'Synthetic reference', values: reference, color: CHART_COLORS[0] },
        { id: 'simulation', label: 'Simulation', values: simulation, color: CHART_COLORS[1] },
      ],
      xLabel: 'model time', yLabel: 'normalized response', cursorX: 0.614,
    },
    'correlation-energy': {
      x: [0, 1, 2, 3, 4],
      series: [{ id: 'energy', label: 'Energy proxy', values: [1, 0.85, 0.31, 0.12, 0.04], color: CHART_COLORS[1] }],
      xLabel: 'Energy component', yLabel: 'normalized proxy',
    },
    'correlation-residual': {
      x,
      series: [
        { id: 'residual', label: 'Residual', values: residual, color: CHART_COLORS[2] },
        { id: 'upper', label: '+ demo band', values: x.map(() => 0.08), color: '#e33245', dashed: true },
        { id: 'lower', label: '- demo band', values: x.map(() => -0.08), color: '#e33245', dashed: true },
      ],
      xLabel: 'model time', yLabel: 'normalized residual', cursorX: 0.614,
    },
    'field-frequency-response': {
      x: [],
      series: [{ id: 'response-spectrum', label: 'Awaiting accepted capture', values: [], color: CHART_COLORS[0] }],
      xLabel: 'model Hz', yLabel: 'relative amplitude (dB)',
    },
    'field-coherence': {
      x: [],
      series: [
        { id: 'relative-amplitude', label: 'Awaiting accepted capture', values: [], color: CHART_COLORS[0] },
      ],
      xLabel: 'model Hz', yLabel: 'relative amplitude', yDomain: [0, 1],
    },
  };
}

function workspaceMarkup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  return `
    <div class="eng-workspace-menu" data-eng-menu hidden>
      <div class="eng-workspace-menu__scrim" data-eng-action="close-menu"></div>
      <nav class="eng-workspace-menu__panel" aria-label="Engineering workspaces">
        <p>Workspace</p>
        <button type="button" data-eng-workspace-target="test" data-eng-concept-target="structural-test"><i class="ph ph-cube" aria-hidden="true"></i><span>Structural Test</span></button>
        <button type="button" data-eng-layout-target="material-lab" data-eng-concept-target="material-lab-desktop"><i class="ph ph-flask" aria-hidden="true"></i><span>Material Lab</span></button>
        <button type="button" data-eng-workspace-target="correlation" data-eng-concept-target="correlation-review"><i class="ph ph-columns" aria-hidden="true"></i><span>Correlation Review</span></button>
        <button type="button" data-eng-workspace-target="field" data-eng-concept-target="field-modal"><i class="ph ph-waveform" aria-hidden="true"></i><span>Field Modal</span></button>
      </nav>
    </div>

    <section class="eng-workspace eng-test-host" data-eng-workspace="test" data-eng-layout="structural-test" aria-label="Structural Test">
      <!--
        Structural Test — public/concepts/physics-workbench-structural-v2.png
        Adopted from #app: header=.topbar, left=#library-panel, viewport=.viewport,
        right=#inspector-panel, analysis=.bottom-console, status=.specimen-status-row
      -->
      <div class="eng-layout eng-structural" data-eng-layout-panel="structural-test">
        <div data-eng-module-host="structural-test" hidden></div>
      </div>

      <!--
        Material Lab desktop — public/concepts/material-lab-desktop.png
        header | left | viewport | right | transport
        Material Lab mobile — public/concepts/material-lab-mobile.png
        header | viewport | right (drawer) | mobile-nav | transport
      -->
      <div class="eng-layout eng-material-lab" data-eng-layout-panel="material-lab" hidden>
        <div data-eng-module-host="material-lab-desktop" hidden></div>
        <div data-eng-module-host="material-lab-mobile" hidden></div>
        <div data-eng-inline-fallback>
        <header class="eng-material-lab__header" data-eng-region="header" data-eng-slot="header">
          <div class="eng-material-lab__brand">
            <strong class="eng-product-title">BOX3D</strong>
            <span>MATERIAL LAB</span>
          </div>
          <nav class="eng-material-lab__nav eng-tablist" aria-label="Material lab views">
            <button type="button" class="is-active" data-eng-lab-nav="lab" aria-pressed="true">LAB</button>
            <button type="button" data-eng-lab-nav="compare" aria-pressed="false">COMPARE</button>
            <button type="button" data-eng-lab-nav="captures" aria-pressed="false">CAPTURES</button>
          </nav>
          <div class="eng-material-lab__status">
            <button class="eng-icon-button" type="button" data-eng-action="workspace-menu" aria-label="Open workspace menu"><i class="ph ph-squares-four" aria-hidden="true"></i></button>
        <span class="eng-status-chip eng-chip eng-chip--good" data-eng-backend>WEBGPU</span>
            <strong class="eng-frame-readout"><span data-eng-value="fps">—</span> FPS</strong>
          </div>
          <div class="eng-material-lab__compact-bar">
            <strong class="eng-product-title">BOX3D</strong>
            <span data-eng-test>Ballistic Dent</span>
            <button class="eng-icon-button" type="button" data-eng-action="toggle-library" aria-label="Open simulation library"><i class="ph ph-stack" aria-hidden="true"></i></button>
          </div>
        </header>
        <div class="eng-material-lab__body">
          <aside class="eng-material-lab__left" data-eng-region="left" data-eng-slot="left" aria-label="Simulation library"></aside>
          <main class="eng-material-lab__center" data-eng-region="center">
            <div class="eng-viewport-slot eng-material-lab__viewport" data-eng-viewport-slot="material-lab" data-eng-region="viewport" data-eng-slot="viewport">
              <div class="eng-empty-state eng-empty-state--viewport"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU viewport</span></div>
            </div>
            <div class="eng-material-lab__overlays">
              <div class="eng-material-lab__legend" aria-hidden="true">
                <span>Stress</span><span>Strain</span><span>Plastic</span>
              </div>
              <div class="eng-material-lab__pointer" role="group" aria-label="Pointer mode">
                <button type="button" data-eng-pointer-mode="orbit" aria-pressed="false"><i class="ph ph-cube-focus" aria-hidden="true"></i> ORBIT</button>
                <button type="button" class="is-active" data-eng-pointer-mode="force" aria-pressed="true"><i class="ph ph-hand-pointing" aria-hidden="true"></i> APPLY FORCE</button>
              </div>
            </div>
          </main>
          <aside class="eng-material-lab__right" data-eng-region="right" data-eng-slot="right" aria-label="Force, material, and solver inspector"></aside>
        </div>
        <nav class="eng-material-lab__tabs" data-eng-region="mobile-nav" aria-label="Inspector sections">
          <button type="button" class="is-active" data-eng-material-tab="force" aria-pressed="true"><i class="ph ph-target" aria-hidden="true"></i> FORCE</button>
          <button type="button" data-eng-material-tab="material" aria-pressed="false"><i class="ph ph-hexagon" aria-hidden="true"></i> MATERIAL</button>
          <button type="button" data-eng-material-tab="solver" aria-pressed="false"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i> SOLVER</button>
        </nav>
        <footer class="eng-material-lab__transport" data-eng-region="transport" data-eng-slot="transport" aria-label="Simulation transport">
          <div class="eng-material-lab__transport-fallback" data-eng-transport-fallback>
            <button type="button" data-eng-action="reset" aria-label="Reset"><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> RESET</button>
            <button type="button" data-eng-action="step" aria-label="Step"><i class="ph ph-skip-forward" aria-hidden="true"></i> STEP</button>
            <button class="eng-arm-button" type="button" data-eng-action="run"><span data-eng-arm-label>PLAY</span></button>
            <output data-eng-value="time">0.00</output>
            <button type="button" data-eng-action="capture" aria-label="Capture"><i class="ph ph-camera" aria-hidden="true"></i> CAPTURE</button>
          </div>
        </footer>
      </div>
      </div>
    </section>

    <section class="eng-workspace eng-correlation" data-eng-workspace="correlation" data-eng-layout="correlation-review" aria-label="Correlation Review" hidden>
      <div data-eng-module-host="correlation-review" hidden></div>
      <div data-eng-inline-fallback>
      <header class="eng-correlation__topbar" data-eng-region="header">
        <button class="eng-icon-button" type="button" data-eng-action="workspace-menu" aria-label="Open workspace menu"><i class="ph ph-list" aria-hidden="true"></i></button>
        <strong class="eng-product-title">CORRELATION REVIEW</strong>
        <div class="eng-case-context">
          <strong data-eng-correlation-title>NO ARCHIVED RUN</strong>
          <span data-eng-correlation-context>Deterministic reduced-model comparison · No reference selected</span>
        </div>
        <span class="eng-status-chip" data-eng-correlation-sync><i class="ph ph-link-break" aria-hidden="true"></i> REFERENCE REQUIRED</span>
        <strong class="eng-frame-readout">SAMPLE <span data-eng-value="frame">01842</span></strong>
        <div class="eng-frame-actions" aria-label="Data cursor controls">
          <button type="button" data-eng-action="frame-previous" aria-label="Previous recorded sample"><i class="ph ph-caret-left" aria-hidden="true"></i></button>
          <button type="button" data-eng-action="frame-next" aria-label="Next recorded sample"><i class="ph ph-caret-right" aria-hidden="true"></i></button>
          <button type="button" data-eng-action="replay" aria-label="Return data cursor to the first sample"><i class="ph ph-skip-back" aria-hidden="true"></i></button>
        </div>
        <button class="eng-icon-button" type="button" data-eng-action="export-evidence" aria-label="Export evidence"><i class="ph ph-camera" aria-hidden="true"></i></button>
        <button class="eng-icon-button" type="button" data-eng-action="workspace-menu" aria-label="Workspace menu"><i class="ph ph-squares-four" aria-hidden="true"></i></button>
      </header>

      <div class="eng-correlation__body">
        <aside class="eng-correlation__left" data-eng-region="left" aria-label="Correlation case and channel navigator">
          <section class="eng-rail-section eng-case-section">
            <header><h2>CASE MATRIX</h2><button type="button" data-eng-action="import-data" aria-label="Import correlation case"><i class="ph ph-plus" aria-hidden="true"></i></button></header>
            <table class="eng-case-table">
              <thead><tr><th>ID</th><th>Input ×</th><th>Angle</th><th>Status</th></tr></thead>
              <tbody data-eng-case-list></tbody>
            </table>
          </section>

          <section class="eng-rail-section">
            <header><h2>CHANNELS</h2><i class="ph ph-gear" aria-hidden="true"></i></header>
            <div class="eng-channel-list">
              <label data-eng-channel-id="force-test"><input type="checkbox" checked><span class="eng-channel-dot eng-channel-dot--cyan"></span><span>Reference response</span><output data-eng-channel-value>0.93 normalized</output></label>
              <label data-eng-channel-id="force-sim"><input type="checkbox" checked><span class="eng-channel-dot eng-channel-dot--violet"></span><span>Solver response</span><output data-eng-channel-value>0.96 normalized</output></label>
              <label data-eng-channel-id="accel-sled"><input type="checkbox" checked><span class="eng-channel-dot eng-channel-dot--teal"></span><span>Response rate</span><output data-eng-channel-value>-0.14 normalized</output></label>
              <label data-eng-channel-id="displacement"><input type="checkbox" checked><span class="eng-channel-dot eng-channel-dot--yellow"></span><span>Deflection</span><output data-eng-channel-value>1.29 sim units</output></label>
              <label data-eng-channel-id="energy"><input type="checkbox" checked><span class="eng-channel-dot eng-channel-dot--orange"></span><span>Energy proxy</span><output data-eng-channel-value>8.76 normalized</output></label>
            </div>
          </section>

          <section class="eng-rail-section">
            <header><h2>FRAME BOOKMARKS</h2><button type="button" aria-label="Add bookmark"><i class="ph ph-plus" aria-hidden="true"></i></button></header>
            <div class="eng-bookmarks">
              <button type="button" data-eng-frame="0"><span>00000</span><strong>Initial state</strong></button>
              <button type="button" data-eng-frame="672"><span>00672</span><strong>Input applied</strong></button>
              <button type="button" data-eng-frame="1215"><span>01215</span><strong>First response</strong></button>
              <button class="is-active" type="button" data-eng-frame="1842"><span>01842</span><strong>Peak response</strong></button>
              <button type="button" data-eng-frame="2530"><span>02530</span><strong>Recovery</strong></button>
              <button type="button" data-eng-frame="3310"><span>03310</span><strong>End capture</strong></button>
            </div>
          </section>

          <section class="eng-rail-section eng-checklist">
            <header><h2>CHECKLIST</h2><strong>STATUS</strong></header>
            <p class="is-warning"><i class="ph ph-image" aria-hidden="true"></i><span>Reference role</span><strong>FINAL SNAPSHOT</strong></p>
            <p class="is-warning"><i class="ph ph-arrows-left-right" aria-hidden="true"></i><span>Time alignment</span><strong>NOT MAPPED</strong></p>
            <p class="is-warning"><i class="ph ph-waveform" aria-hidden="true"></i><span>Channel mapping</span><strong>NOT MAPPED</strong></p>
            <p class="is-warning" data-eng-reference-check><i class="ph ph-warning" aria-hidden="true"></i><span>Reference provenance</span><strong data-eng-reference-status>MISSING</strong></p>
            <p class="is-warning"><i class="ph ph-warning" aria-hidden="true"></i><span>Energy proxy</span><strong>MODEL</strong></p>
            <p class="is-pass"><i class="ph ph-check-circle" aria-hidden="true"></i><span>Replay determinism</span><strong>READY</strong></p>
          </section>
        </aside>

        <main class="eng-correlation__center" data-eng-region="center">
          <section class="eng-media-compare" data-eng-region="viewport" aria-label="Reference artifact and solver work comparison">
            <article class="eng-media-pane eng-media-pane--test">
              <header><strong>REFERENCE</strong><span data-eng-reference-time>final checkpoint</span></header>
              <div class="eng-reference-media" data-eng-reference-media>
                <div class="eng-empty-state">
                  <i class="ph ph-file-video" aria-hidden="true"></i>
                  <strong>Import reference media</strong>
                  <span>Image or video · provenance declared on import</span>
                  <button type="button" data-eng-action="import-reference">IMPORT REFERENCE</button>
                </div>
              </div>
            </article>
            <button class="eng-compare-handle" type="button" role="slider" aria-label="Comparison split position" aria-valuemin="30" aria-valuemax="70" aria-valuenow="48" data-eng-split-handle><i class="ph ph-arrows-left-right" aria-hidden="true"></i></button>
            <article class="eng-media-pane eng-media-pane--simulation">
              <header><strong>SIMULATION</strong><span data-eng-work-time>archived checkpoint</span></header>
              <div class="eng-viewport-slot" data-eng-viewport-slot="correlation">
                <div class="eng-empty-state eng-empty-state--viewport"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU viewport</span></div>
                <div class="eng-work-snapshot" data-eng-work-media>
                  <div class="eng-empty-state"><i class="ph ph-images" aria-hidden="true"></i><strong>No work revision selected</strong><span>Complete a second run or select an archived case.</span></div>
                </div>
              </div>
              <span class="eng-provenance-badge" data-eng-provenance>SYNTHETIC DEMO</span>
            </article>
            <span class="eng-split-control" aria-hidden="true"><input id="${id('correlation-split')}" tabindex="-1" type="range" min="30" max="70" value="48" data-eng-split></span>
          </section>

          <section class="eng-correlation-transport" data-eng-region="transport" aria-label="Correlation playback controls">
            <div class="eng-transport-buttons">
              <button type="button" data-eng-action="replay" aria-label="First frame"><i class="ph ph-skip-back" aria-hidden="true"></i></button>
              <button type="button" data-eng-action="frame-previous" aria-label="Previous frame"><i class="ph ph-rewind" aria-hidden="true"></i></button>
              <button type="button" data-eng-action="run" aria-label="Play"><i class="ph ph-play" aria-hidden="true"></i></button>
              <button type="button" data-eng-action="frame-next" aria-label="Next frame"><i class="ph ph-fast-forward" aria-hidden="true"></i></button>
            </div>
            <label for="${id('correlation-frame')}"><span class="eng-sr-only">Correlation frame</span><input id="${id('correlation-frame')}" type="range" min="0" max="4000" value="1842" data-eng-frame-slider></label>
            <output data-eng-value="frame">01842</output>
            <button type="button" data-eng-action="capture" aria-label="Capture comparison"><i class="ph ph-camera" aria-hidden="true"></i></button>
            <button type="button" data-eng-action="bookmark" aria-label="Bookmark current frame"><i class="ph ph-bookmark-simple" aria-hidden="true"></i></button>
          </section>

          <section class="eng-correlation-charts" data-eng-region="analysis">
            <article class="eng-chart-card">
              <header><h2>RESPONSE HISTORY</h2><span>Current <strong data-eng-value="force">0.00 normalized</strong></span></header>
              <canvas data-eng-chart="correlation-force" role="img" aria-label="Measured and simulated force history"></canvas>
            </article>
            <article class="eng-chart-card">
              <header><h2>ENERGY PROXY</h2><span><strong data-eng-value="energy">0.00 normalized</strong></span></header>
              <canvas data-eng-chart="correlation-energy" role="img" aria-label="Simulation energy balance"></canvas>
            </article>
            <article class="eng-chart-card">
              <header><h2>RESIDUAL</h2><span><strong data-eng-value="residual">0.00 normalized</strong></span></header>
              <canvas data-eng-chart="correlation-residual" role="img" aria-label="Force correlation residual"></canvas>
            </article>
          </section>

          <section class="eng-correlation-metadata" aria-label="Test metadata">
            <span data-eng-reference-summary>REFERENCE: NOT SELECTED</span><span>MODEL CLOCK: FIXED 60 HZ</span><span>UNITS: NORMALIZED</span><span>REPLAY: DETERMINISTIC</span>
          </section>

          <section class="eng-evidence-summary">
            <article><h3>ALIGNMENT</h3><p>Trigger offset <strong>0 samples</strong></p><p>Time zero <strong>locked</strong></p></article>
            <article><h3>MODEL QUALITY</h3><p>Fixed step <strong>60 model Hz</strong></p><p>Replay hash <strong data-eng-value="convergence">—</strong></p></article>
            <article><h3>PROVENANCE</h3><p data-eng-provenance-copy>Synthetic comparison fixture</p><p>Deterministic replay</p></article>
            <article class="eng-correlation-score"><h3>WORKBENCH AGREEMENT</h3><strong><span data-eng-value="correlation">—</span></strong><span data-eng-score-status>NOT SCORED</span></article>
            <button class="eng-export-button" type="button" data-eng-action="export-evidence"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span>EXPORT EVIDENCE</span></button>
          </section>
        </main>

        <aside class="eng-correlation__right" data-eng-region="right" aria-label="Correlation controls">
          <section class="eng-control-section is-active"><h2>ALIGNMENT · IMPORT REQUIRED</h2><label>Trigger source<select disabled><option>Not mapped</option></select></label><label>Threshold<div><input type="number" value="0.2" disabled><span>normalized</span></div></label><label>Offset<div><input type="number" value="0" data-eng-alignment-offset disabled><span>samples</span></div></label><button type="button" data-eng-action="auto-align" disabled title="Import and explicitly map a compatible time-series reference first">AUTO ALIGN</button></section>
          <section class="eng-control-section"><h2>SOLVER</h2><label>Type<select><option>Active lab solver</option></select></label><label>Time step<select><option>1 / 60 model s</option></select></label><label>Substeps<select><option>From run record</option></select></label></section>
          <section class="eng-control-section"><h2>CONTACT SCOPE</h2><p><strong>Solver-native state only</strong></p><p>Transforms and replay hashes are available. Contact force channels are not exposed by this build.</p></section>
          <section class="eng-control-section"><h2>MODEL DEFINITION</h2><p><strong>Active lab recipe</strong></p><p>Reduced numerical model with normalized comparative parameters; not a certified constitutive model.</p></section>
          <section class="eng-control-section"><h2>UNCERTAINTY</h2><p><strong>Unavailable</strong></p><p>Shown only when imported evidence or calibration supplies uncertainty.</p></section>
          <section class="eng-control-section"><h2>MODEL COMPARISON</h2><label>Response<select disabled><option>Compatible archived channel</option></select></label><label>Weighting<select disabled><option>Uniform · fixed</option></select></label><label>Smoothing<select disabled><option>5-point · fixed</option></select></label><button type="button" data-eng-action="update-agreement">REFRESH MODEL AGREEMENT</button></section>
        </aside>
      </div>
      <footer class="eng-correlation__status" data-eng-region="status"><span>STATUS: REVIEW MODE</span><span data-eng-run-message>Ready for deterministic review</span><span>Fidelity: Reduced numerical model</span></footer>
      </div>
    </section>

    <section class="eng-workspace eng-field" data-eng-workspace="field" data-eng-layout="field-modal" data-eng-field-view="run" aria-label="Field Modal" hidden>
      <div data-eng-module-host="field-modal" hidden></div>
      <div data-eng-inline-fallback>
      <header class="eng-field__topbar" data-eng-region="header">
        <button class="eng-field-title" type="button" data-eng-action="workspace-menu"><span>MODEL RESPONSE</span><i class="ph ph-caret-down" aria-hidden="true"></i></button>
        <div class="eng-field-context"><i class="ph ph-folder" aria-hidden="true"></i><span>Project: <strong data-eng-project>CANT-BEAM-01</strong><br>Model: <strong data-eng-test>IMPACT-001</strong></span></div>
        <div class="eng-field-status"><i class="ph ph-waveform" aria-hidden="true"></i><span><strong>MODEL CLOCK</strong><br>60 fixed steps/s</span></div>
        <div class="eng-field-status eng-field-status--derived"><i class="ph ph-function" aria-hidden="true"></i><span>RESPONSE TAPS<br><strong>5 DERIVED</strong></span></div>
        <div class="eng-field-status eng-field-status--safe"><i class="ph ph-circle-dashed" aria-hidden="true"></i><strong class="eng-field-readiness" data-eng-field-readiness role="status" aria-live="polite">PREFLIGHT REQUIRED</strong></div>
        <button class="eng-icon-button" type="button" data-eng-action="workspace-menu" aria-label="Open workspace menu"><i class="ph ph-list" aria-hidden="true"></i></button>
      </header>

      <section class="eng-field-viewport" data-eng-region="viewport">
        <div class="eng-viewport-slot" data-eng-viewport-slot="field"><div class="eng-empty-state eng-empty-state--viewport"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU specimen viewport</span></div></div>
        <div class="eng-field-mode-copy"><strong>DOMINANT OUTPUT PEAK</strong><span>peak = <b data-eng-value="frequency">—</b> model Hz</span><span>bandwidth proxy = <b data-eng-value="damping">—</b> %</span></div>
        <button class="eng-orbit-button" type="button" data-eng-action="orbit"><i class="ph ph-cube-focus" aria-hidden="true"></i> RESET VIEW</button>
        <span class="eng-impact-label"><strong>INPUT</strong><i class="ph ph-arrow-down" aria-hidden="true"></i></span>
        <div class="eng-placement-quality"><h2>RESPONSE TAP STATUS <i class="ph ph-info" aria-hidden="true"></i></h2><p><i class="ph ph-info" aria-hidden="true"></i><strong>DERIVED</strong></p><span>Five scaled taps of one solver response; no spatial mode shape</span></div>
        <div class="eng-mode-dots" aria-label="Only the dominant output peak is available"><button class="is-active" type="button" aria-label="Dominant output peak" aria-pressed="true" disabled></button><button type="button" aria-label="Additional peak unavailable" aria-pressed="false" disabled></button><button type="button" aria-label="Additional peak unavailable" aria-pressed="false" disabled></button><button type="button" aria-label="Additional peak unavailable" aria-pressed="false" disabled></button><button type="button" aria-label="Additional peak unavailable" aria-pressed="false" disabled></button></div>
        <span class="eng-provenance-badge" data-eng-provenance>REDUCED MODAL ESTIMATE</span>
      </section>

      <section class="eng-field-controls" data-eng-region="right">
        <div class="eng-field-control-summary">
          <article class="eng-test-state"><h2>MODEL STATE</h2><strong data-eng-run-state>ARMED</strong><span data-eng-run-message role="status" aria-live="polite">Ready for input</span></article>
          <article class="eng-acquisition-settings"><div><h2>MODEL INPUT</h2><strong>1.00</strong><span>NORMALIZED TIP IMPULSE</span></div><div><h2>DECLARED RANGE</h2><strong>0–40</strong><span>NORMALIZED IMPULSE</span></div><div><h2>CAPTURES</h2><strong data-eng-value="capture-count">0</strong><span data-eng-value="capture-status">3 ACCEPTED REQUIRED</span></div></article>
          <article class="eng-channel-health"><h2>DERIVED RESPONSE TAPS</h2><div>
            <span data-eng-channel-id="a1" aria-label="Derived response tap P1"><b>P1</b><i class="ph ph-function" aria-hidden="true"></i><small data-eng-channel-value>— derived</small></span>
            <span data-eng-channel-id="a2" aria-label="Derived response tap P2"><b>P2</b><i class="ph ph-function" aria-hidden="true"></i><small data-eng-channel-value>— derived</small></span>
            <span data-eng-channel-id="a3" aria-label="Derived response tap P3"><b>P3</b><i class="ph ph-function" aria-hidden="true"></i><small data-eng-channel-value>— derived</small></span>
            <span data-eng-channel-id="a4" aria-label="Derived response tap P4"><b>P4</b><i class="ph ph-function" aria-hidden="true"></i><small data-eng-channel-value>— derived</small></span>
            <span data-eng-channel-id="a5" aria-label="Derived response tap P5"><b>P5</b><i class="ph ph-function" aria-hidden="true"></i><small data-eng-channel-value>— derived</small></span>
          </div></article>
        </div>
        <div class="eng-preflight-strip">
          <article><i class="ph ph-circle-dashed" aria-hidden="true"></i><span>PREFLIGHT</span><strong class="eng-status-value--caution" data-eng-preflight-status>Required</strong></article>
          <article><i class="ph ph-waveform" aria-hidden="true"></i><span>BASELINE</span><strong class="eng-status-value--good">Undamaged model</strong></article>
          <article><i class="ph ph-gauge" aria-hidden="true"></i><span>PARAMETER LIMITS</span><strong class="eng-status-value--info">Declared range</strong></article>
          <article><i class="ph ph-stack" aria-hidden="true"></i><span>ENSEMBLE INPUT</span><strong class="eng-status-value--caution" data-eng-ensemble-status>Needs 3 accepted</strong></article>
          <article><i class="ph ph-wave-sine" aria-hidden="true"></i><span>SAMPLE RATE</span><strong class="eng-status-value--info">60 model Hz</strong></article>
          <article><i class="ph ph-faders" aria-hidden="true"></i><span>WINDOW</span><strong class="eng-status-value--info">Hann</strong></article>
          <article><i class="ph ph-calendar" aria-hidden="true"></i><span>CALIBRATION</span><strong class="eng-status-value--caution">Not attached</strong></article>
          <article><i class="ph ph-cube" aria-hidden="true"></i><span>MODEL BUILD</span><strong class="eng-status-value--good">Deterministic</strong></article>
        </div>
        <div class="eng-field-primary-actions">
          <button class="eng-arm-button" type="button" data-eng-action="arm"><i class="ph ph-hammer" aria-hidden="true"></i><span data-eng-arm-label>ARM TEST</span></button>
          <button class="eng-accept-button" type="button" data-eng-action="complete" disabled><i class="ph ph-check-circle" aria-hidden="true"></i>REVIEW CAPTURE</button>
          <button class="eng-abort-button" type="button" data-eng-action="abort"><i class="ph ph-x-circle" aria-hidden="true"></i>ABORT CAPTURE</button>
        </div>
        <p class="eng-safety-copy"><i class="ph ph-info" aria-hidden="true"></i> Runs numerical capture QC on one reduced-order response; no hardware or physical DAQ is connected.</p>
      </section>

      <section class="eng-field-charts" data-eng-region="analysis">
        <article class="eng-chart-card"><header><h2>SINGLE-CHANNEL OUTPUT RESPONSE SPECTRUM</h2><span><strong data-eng-value="frequency">—</strong> model Hz</span></header><canvas data-eng-chart="field-frequency-response" role="img" aria-label="Single-channel reduced-model output response spectrum"></canvas></article>
        <article class="eng-chart-card"><header><h2>RELATIVE SPECTRAL AMPLITUDE</h2><span>Peak concentration <strong data-eng-value="coherence">—</strong></span></header><canvas data-eng-chart="field-coherence" role="img" aria-label="Reduced-model relative spectral amplitude"></canvas></article>
      </section>

      <section class="eng-capture-strip" data-eng-region="transport">
        <header><h2>EVENT / CAPTURE STRIP</h2></header>
        <div class="eng-capture-list">
          <button class="is-active" type="button" data-eng-capture-slot="0"><strong>001</strong><span>ARM NEXT</span><i class="ph ph-play" aria-label="Next capture"></i></button>
          <button class="is-empty" type="button" data-eng-capture-slot="1"><strong>002</strong><span>—</span></button>
          <button class="is-empty" type="button" data-eng-capture-slot="2"><strong>003</strong><span>—</span></button>
          <button class="is-empty" type="button" data-eng-capture-slot="3"><strong>004</strong><span>—</span></button>
          <button class="is-empty" type="button" data-eng-capture-slot="4"><strong>005</strong><span>—</span></button>
          <button class="is-empty" type="button" data-eng-capture-slot="5"><strong>006</strong><span>—</span></button>
          <strong class="eng-capture-queue"><i class="ph ph-note-pencil" aria-hidden="true"></i><span data-eng-capture-queue>0 ACCEPTED · 0 REJECTED<br>3 ACCEPTED REQUIRED</span></strong>
        </div>
        <button class="eng-annotation-button" type="button" data-eng-action="annotation"><i class="ph ph-bookmark-simple" aria-hidden="true"></i> ADD ANNOTATION MARKER</button>
      </section>

      <nav class="eng-field-nav eng-tablist" data-eng-region="mobile-nav" aria-label="Field modal views">
        <button class="is-active" type="button" data-eng-field-view="run" aria-pressed="true"><i class="ph ph-waveform" aria-hidden="true"></i>RUN</button>
        <button type="button" data-eng-field-view="channels" aria-pressed="false" title="Derived response taps from one solver probe"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>CHANNELS</button>
        <button type="button" data-eng-field-view="modes" aria-pressed="false" title="Dominant reduced-order output peak"><i class="ph ph-wave-sine" aria-hidden="true"></i>MODES</button>
        <button type="button" data-eng-field-view="notes" aria-pressed="false" title="Capture annotations"><i class="ph ph-notebook" aria-hidden="true"></i>NOTES</button>
      </nav>
      </div>
    </section>

    <input id="${id('file-input')}" class="eng-sr-only" type="file" data-eng-file-input accept=".csv,.json,image/*,video/*">
    <div class="eng-live-region eng-sr-only" aria-live="polite" data-eng-live-region></div>
    <div data-eng-first-run-host></div>

    <dialog class="eng-arm-dialog" aria-labelledby="${id('arm-title')}">
      <form method="dialog">
        <i class="ph ph-shield-check" aria-hidden="true"></i>
        <h2 id="${id('arm-title')}">Confirm reduced-model run</h2>
        <p>This starts a deterministic model run using the current seed and declared parameters. Output remains normalized and reduced-order.</p>
        <div><button value="cancel">CANCEL</button><button class="eng-arm-button" value="confirm" data-eng-action="confirm-arm">ARM TEST</button></div>
      </form>
    </dialog>
  `;
}

export function createEngineeringWorkspaces(options: EngineeringWorkspacesOptions): EngineeringWorkspacesController {
  if (options.mount === options.testWorkspace || options.testWorkspace.contains(options.mount)) {
    throw new Error('Engineering workspaces mount must be outside the supplied Test workspace.');
  }
  const prefix = options.idPrefix ?? 'eng-ws';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Engineering workspace idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }

  const testMarker = document.createComment(`${prefix}-test-origin`);
  const testParent = options.testWorkspace.parentNode;
  if (testParent) testParent.insertBefore(testMarker, options.testWorkspace);

  const root = document.createElement('div');
  root.className = 'eng-workspaces';
  root.id = `${prefix}-root`;
  root.dataset.runState = 'armed';
  root.innerHTML = workspaceMarkup(prefix);
  options.mount.append(root);
  const testHost = required<HTMLElement>(root, '[data-eng-workspace="test"]');
  const structuralPanel = required<HTMLElement>(root, '[data-eng-layout-panel="structural-test"]');
  const materialLabPanel = required<HTMLElement>(root, '[data-eng-layout-panel="material-lab"]');
  const materialLabViewportSlot = required<HTMLElement>(root, '[data-eng-viewport-slot="material-lab"]');
  const materialLabLeftSlot = required<HTMLElement>(materialLabPanel, '[data-eng-slot="left"]');
  const materialLabRightSlot = required<HTMLElement>(materialLabPanel, '[data-eng-slot="right"]');
  const materialLabTransportSlot = required<HTMLElement>(materialLabPanel, '[data-eng-slot="transport"]');
  const materialLabTransportFallback = required<HTMLElement>(materialLabPanel, '[data-eng-transport-fallback]');
  structuralPanel.append(options.testWorkspace);

  const abortController = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abortController.signal };
  const workspaces = new Map<EngineeringWorkspaceId, HTMLElement>(
    ENGINEERING_WORKSPACE_IDS.map((workspace) => [workspace, required<HTMLElement>(root, `[data-eng-workspace="${workspace}"]`)]),
  );
  for (const element of workspaces.values()) element.tabIndex = -1;
  const viewportSlots = new Map<EngineeringWorkspaceId, HTMLElement>();
  viewportSlots.set('correlation', required(root, '[data-eng-viewport-slot="correlation"]'));
  viewportSlots.set('field', required(root, '[data-eng-viewport-slot="field"]'));

  type AdoptedHome = { readonly node: HTMLElement; readonly parent: Node; readonly next: ChildNode | null };
  const adoptedHomes: AdoptedHome[] = [];
  const rememberHome = (node: HTMLElement | null): HTMLElement | null => {
    if (!node?.parentNode) return node;
    adoptedHomes.push({ node, parent: node.parentNode, next: node.nextSibling });
    return node;
  };
  const restoreHome = (node: HTMLElement | null): void => {
    const home = adoptedHomes.find((entry) => entry.node === node);
    if (!home) return;
    home.parent.insertBefore(home.node, home.next);
  };

  const adoptedHeader = rememberHome(options.testWorkspace.querySelector<HTMLElement>('.topbar'));
  const adoptedLeft = rememberHome(options.testWorkspace.querySelector<HTMLElement>('#library-panel'));
  const adoptedViewport = rememberHome(options.testWorkspace.querySelector<HTMLElement>('.viewport'));
  const adoptedRight = rememberHome(options.testWorkspace.querySelector<HTMLElement>('#inspector-panel'));
  const adoptedAnalysis = rememberHome(options.testWorkspace.querySelector<HTMLElement>('.bottom-console'));
  const adoptedStatus = options.testWorkspace.querySelector<HTMLElement>('.specimen-status-row');
  if (adoptedHeader) adoptedHeader.dataset.engRegion = 'header';
  if (adoptedLeft) adoptedLeft.dataset.engRegion = 'left';
  if (adoptedViewport) adoptedViewport.dataset.engRegion = 'viewport';
  if (adoptedRight) adoptedRight.dataset.engRegion = 'right';
  if (adoptedAnalysis) adoptedAnalysis.dataset.engRegion = 'analysis';
  if (adoptedStatus) adoptedStatus.dataset.engRegion = 'status';
  const adoptedCenter = options.testWorkspace.querySelector<HTMLElement>('.workspace');
  if (adoptedCenter) adoptedCenter.dataset.engRegion = 'center';
  options.testWorkspace.dataset.engLayoutHost = 'structural-test';

  const searchConcept = typeof window === 'undefined' ? null : conceptViewFromSearch(window.location.search);
  const requestedConcept = options.initialConceptView
    ?? searchConcept
    ?? (options.initialLayout ? resolveConceptView(
      ENGINEERING_WORKSPACE_FOR_LAYOUT[options.initialLayout],
      options.initialLayout,
      options.initialChrome === 'compact' ? 'compact' : 'desktop',
    ) : null);
  const compactQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
  let chromePreference: EngineeringChromeId | 'auto' = options.initialChrome ?? (requestedConcept ? ENGINEERING_CONCEPT_VIEWS[requestedConcept].chrome : 'auto');
  let lastTestLayout: EngineeringLayoutId = requestedConcept && ENGINEERING_CONCEPT_VIEWS[requestedConcept].workspace === 'test'
    ? ENGINEERING_CONCEPT_VIEWS[requestedConcept].layout
    : options.initialLayout === 'material-lab' ? 'material-lab' : 'structural-test';
  let activeWorkspace: EngineeringWorkspaceId = requestedConcept
    ? ENGINEERING_CONCEPT_VIEWS[requestedConcept].workspace
    : options.initialWorkspace ?? 'test';
  let activeLayout: EngineeringLayoutId = layoutForWorkspace(activeWorkspace, lastTestLayout);
  let activeFieldView: EngineeringFieldViewId = 'run';
  let activeMaterialTab: EngineeringMaterialTabId = 'force';
  let librarySheetOpen = false;
  let materialLabDesktop: MaterialLabDesktopController | null = null;
  let materialLabMobile: MaterialLabMobileController | null = null;
  let physicsStructural: PhysicsStructuralController | null = null;
  let physicsCorrelation: PhysicsCorrelationView | null = null;
  let physicsFieldModal: PhysicsFieldModalController | null = null;
  let activeLabId = options.initialLabId ?? '';
  let activeLabTitle = options.testLabel ?? options.initialLabId ?? '';
  const materialLabDesktopHost = required<HTMLElement>(materialLabPanel, '[data-eng-module-host="material-lab-desktop"]');
  const materialLabMobileHost = required<HTMLElement>(materialLabPanel, '[data-eng-module-host="material-lab-mobile"]');
  const materialLabFallback = required<HTMLElement>(materialLabPanel, '[data-eng-inline-fallback]');
  const structuralModuleHost = required<HTMLElement>(structuralPanel, '[data-eng-module-host="structural-test"]');
  const correlationWorkspace = required<HTMLElement>(root, '[data-eng-workspace="correlation"]');
  const fieldWorkspace = required<HTMLElement>(root, '[data-eng-workspace="field"]');
  const correlationModuleHost = required<HTMLElement>(correlationWorkspace, '[data-eng-module-host="correlation-review"]');
  const fieldModuleHost = required<HTMLElement>(fieldWorkspace, '[data-eng-module-host="field-modal"]');
  const correlationFallback = required<HTMLElement>(correlationWorkspace, '[data-eng-inline-fallback]');
  const fieldFallback = required<HTMLElement>(fieldWorkspace, '[data-eng-inline-fallback]');
  let callbacks: EngineeringWorkspaceCallbacks = options.callbacks ?? {};
  let importKind: EngineeringImportKind = 'reference-media';
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let telemetry: EngineeringTelemetryUpdate = {};
  let run: EngineeringRunLifecycleUpdate = { state: 'armed', frame: 1842, elapsedSeconds: 0, progress: 0, message: 'Ready for impact' };
  let activeCaseId = '03';
  let referenceObjectUrl: string | null = null;
  let lastStructuralRunState: EngineeringRecorderState | null = null;
  let destroyed = false;
  const searchIntent = typeof window === 'undefined'
    ? { autoplay: true, simpleUi: true }
    : demoIntentFromSearch(window.location.search);
  let autoplayEnabled = options.autoplay ?? searchIntent.autoplay;
  let simpleUi = options.simpleUi ?? searchIntent.simpleUi;
  let playbackStarted = options.playbackStarted ?? false;
  let playRequestQueued = false;
  let firstRunGuide: FirstRunGuideController | null = null;
  const charts = new Map<EngineeringChartId, EngineeringChartUpdate>(Object.entries(createDefaultCharts()) as [EngineeringChartId, EngineeringChartUpdate][]);
  const canvasByChart = new Map<EngineeringChartId, HTMLCanvasElement>();
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('[data-eng-chart]')) {
    canvasByChart.set(canvas.dataset.engChart as EngineeringChartId, canvas);
  }

  const liveRegion = required<HTMLElement>(root, '[data-eng-live-region]');
  const firstRunHost = required<HTMLElement>(root, '[data-eng-first-run-host]');
  const menu = required<HTMLElement>(root, '[data-eng-menu]');
  const fileInput = required<HTMLInputElement>(root, '[data-eng-file-input]');
  const mediaCompare = required<HTMLElement>(root, '.eng-media-compare');
  const splitInput = required<HTMLInputElement>(root, '[data-eng-split]');
  const splitHandle = required<HTMLButtonElement>(root, '[data-eng-split-handle]');
  const frameSlider = required<HTMLInputElement>(root, '[data-eng-frame-slider]');
  const armDialog = required<HTMLDialogElement>(root, '.eng-arm-dialog');
  let splitDragging = false;

  const resolvedChrome = (): EngineeringChromeId => {
    if (chromePreference === 'auto') return compactQuery?.matches ? 'compact' : 'desktop';
    return chromePreference;
  };

  const currentConceptView = (): EngineeringConceptViewId => resolveConceptView(activeWorkspace, activeLayout, resolvedChrome());

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => { if (!destroyed) liveRegion.textContent = message; }, 20);
  };

  const setBoundText = (key: string, value: string): void => {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-eng-value="${key}"]`)) element.textContent = value;
  };

  const syncRunControls = (): void => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-action="abort"]')) {
      button.disabled = !['preflight', 'armed', 'running', 'paused'].includes(run.state);
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-action="complete"]')) {
      const sampleCount = run.step ?? 0;
      button.disabled = !['running', 'paused'].includes(run.state) || sampleCount < 64;
      button.title = button.disabled && ['running', 'paused'].includes(run.state)
        ? `Capture ${sampleCount}/64 fixed-step samples before accepting`
        : '';
    }
  };

  const setSplitValue = (requestedValue: number): void => {
    const value = clamp(requestedValue, Number(splitInput.min), Number(splitInput.max));
    const rounded = Math.round(value * 10) / 10;
    splitInput.value = String(rounded);
    splitHandle.setAttribute('aria-valuenow', String(rounded));
    splitHandle.setAttribute('aria-valuetext', `${rounded}% test reference`);
    mediaCompare.style.setProperty('--eng-split', `${rounded}%`);
  };

  const viewportDestination = (workspace: EngineeringWorkspaceId): HTMLElement | undefined => {
    switch (workspace) {
      case 'correlation':
        return physicsCorrelation?.elements.viewportSlot ?? viewportSlots.get('correlation');
      case 'field':
        return physicsFieldModal?.root.querySelector<HTMLElement>('[data-phys-viewport]')
          ?? viewportSlots.get('field');
      case 'test':
        if (activeLayout === 'material-lab') {
          if (resolvedChrome() === 'compact') {
            return materialLabMobile?.root.querySelector<HTMLElement>('[data-ml-mob-viewport-slot]')
              ?? materialLabViewportSlot;
          }
          return materialLabDesktop?.viewportSlot ?? materialLabViewportSlot;
        }
        return physicsStructural?.root.querySelector<HTMLElement>('[data-phys-str-viewport-slot]') ?? undefined;
      default:
        return assertNever(workspace, `Unknown engineering workspace: ${String(workspace)}`);
    }
  };

  const restoreWorkspaceMenu = (): void => {
    if (menu.parentNode === root) return;
    root.insertBefore(menu, root.firstChild);
  };

  const syncFieldModalOpen = (): void => {
    if (!physicsFieldModal) return;
    const fieldActive = activeWorkspace === 'field' && activeLayout === 'field-modal';
    if (fieldActive) {
      if (!physicsFieldModal.isOpen()) physicsFieldModal.open();
      return;
    }
    if (physicsFieldModal.isOpen()) physicsFieldModal.close();
    restoreWorkspaceMenu();
  };

  const moveAttachedViewport = (workspace: EngineeringWorkspaceId): void => {
    if (!viewport || !viewportMarker) {
      syncFieldModalOpen();
      return;
    }
    if (workspace === 'test' && activeLayout === 'material-lab') {
      if (resolvedChrome() === 'compact' && materialLabMobile) {
        materialLabMobile.attachViewport(viewport);
        viewport.classList.add('eng-attached-viewport');
        viewport.dataset.engViewportWorkspace = workspace;
        syncFieldModalOpen();
        return;
      }
      if (materialLabDesktop) {
        materialLabDesktop.attachViewport(viewport);
        viewport.classList.add('eng-attached-viewport');
        viewport.dataset.engViewportWorkspace = workspace;
        syncFieldModalOpen();
        return;
      }
    }
    if (workspace === 'test' && activeLayout === 'structural-test' && physicsStructural) {
      physicsStructural.attachViewport(viewport);
      viewport.classList.add('eng-attached-viewport');
      viewport.dataset.engViewportWorkspace = workspace;
      syncFieldModalOpen();
      return;
    }
    if (workspace === 'correlation' && physicsCorrelation) {
      physicsCorrelation.attachViewport(viewport);
      viewport.classList.add('eng-attached-viewport');
      viewport.dataset.engViewportWorkspace = workspace;
      syncFieldModalOpen();
      return;
    }
    if (workspace === 'field' && physicsFieldModal) {
      physicsFieldModal.attachViewport(viewport);
      viewport.classList.add('eng-attached-viewport');
      viewport.dataset.engViewportWorkspace = workspace;
      syncFieldModalOpen();
      return;
    }
    const destination = viewportDestination(workspace);
    if (destination) {
      destination.append(viewport);
    } else if (viewportMarker.parentNode) {
      viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    }
    viewport.classList.add('eng-attached-viewport');
    viewport.dataset.engViewportWorkspace = workspace;
    syncFieldModalOpen();
  };

  const getRegion = (region: EngineeringRegionId, layout: EngineeringLayoutId = activeLayout): HTMLElement | null => {
    let layoutRoot: ParentNode;
    switch (layout) {
      case 'material-lab':
        layoutRoot = materialLabPanel;
        break;
      case 'structural-test':
        layoutRoot = !structuralModuleHost.hidden && physicsStructural
          ? physicsStructural.root
          : options.testWorkspace;
        break;
      case 'correlation-review':
        layoutRoot = !correlationModuleHost.hidden && physicsCorrelation
          ? physicsCorrelation.root
          : workspaces.get('correlation') ?? root;
        break;
      case 'field-modal':
        layoutRoot = !fieldModuleHost.hidden && physicsFieldModal
          ? physicsFieldModal.root
          : workspaces.get('field') ?? root;
        break;
      default:
        return assertNever(layout, `Unknown engineering layout: ${String(layout)}`);
    }
    return layoutRoot.querySelector<HTMLElement>(`[data-eng-region="${region}"]`);
  };

  const syncFieldView = (view: EngineeringFieldViewId): void => {
    const field = workspaces.get('field');
    if (!field) return;
    field.dataset.engFieldView = view;
    const viewportRegion = field.querySelector<HTMLElement>('[data-eng-region="viewport"]');
    const controls = field.querySelector<HTMLElement>('[data-eng-region="right"]');
    const chartsRegion = field.querySelector<HTMLElement>('[data-eng-region="analysis"]');
    const captures = field.querySelector<HTMLElement>('[data-eng-region="transport"]');
    switch (view) {
      case 'run':
        if (viewportRegion) viewportRegion.hidden = false;
        if (controls) controls.hidden = false;
        if (chartsRegion) chartsRegion.hidden = false;
        if (captures) captures.hidden = false;
        break;
      case 'channels':
        if (viewportRegion) viewportRegion.hidden = false;
        if (controls) controls.hidden = false;
        if (chartsRegion) chartsRegion.hidden = true;
        if (captures) captures.hidden = true;
        break;
      case 'modes':
        if (viewportRegion) viewportRegion.hidden = false;
        if (controls) controls.hidden = true;
        if (chartsRegion) chartsRegion.hidden = false;
        if (captures) captures.hidden = true;
        break;
      case 'notes':
        if (viewportRegion) viewportRegion.hidden = false;
        if (controls) controls.hidden = true;
        if (chartsRegion) chartsRegion.hidden = true;
        if (captures) captures.hidden = false;
        break;
      default:
        assertNever(view, `Unknown field view: ${String(view)}`);
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-field-view]')) {
      const active = button.dataset.engFieldView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    physicsFieldModal?.update({ activeView: view });
  };

  const syncMaterialTab = (tab: EngineeringMaterialTabId): void => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-material-tab]')) {
      const active = button.dataset.engMaterialTab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    const inspectorTabId = tab === 'force'
      ? 'inspector-tab-force'
      : tab === 'material'
        ? 'inspector-tab-material'
        : tab === 'solver'
          ? 'inspector-tab-solver'
          : assertNever(tab, `Unknown material tab: ${String(tab)}`);
    options.testWorkspace.querySelector<HTMLButtonElement>(`#${inspectorTabId}`)?.click();
  };

  const syncLabNav = (): void => {
    const nav: EngineeringLabNavId = activeWorkspace === 'correlation'
      ? 'compare'
      : activeWorkspace === 'field'
        ? 'captures'
        : 'lab';
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-lab-nav]')) {
      const active = button.dataset.engLabNav === nav;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  const syncLayoutDom = (): void => {
    const chrome = resolvedChrome();
    const concept = currentConceptView();
    root.dataset.engLayout = activeLayout;
    root.dataset.engChrome = chrome;
    root.dataset.engConceptView = concept;
    testHost.dataset.engLayout = activeLayout;
    testHost.dataset.engChrome = chrome;
    materialLabPanel.dataset.engChrome = chrome;
    const materialActive = activeWorkspace === 'test' && activeLayout === 'material-lab';
    structuralPanel.hidden = materialActive;
    materialLabPanel.hidden = !materialActive;
    syncMaterialLabModules(materialActive);
    syncPhysicsModules();
    const useInlineMaterialLab = materialActive && !materialLabFallback.hidden;
    if (useInlineMaterialLab) {
      if (adoptedLeft) materialLabLeftSlot.append(adoptedLeft);
      if (adoptedRight) materialLabRightSlot.append(adoptedRight);
      if (adoptedAnalysis) materialLabTransportSlot.append(adoptedAnalysis);
      if (adoptedHeader) adoptedHeader.hidden = true;
      materialLabTransportFallback.hidden = Boolean(adoptedAnalysis);
      materialLabLeftSlot.hidden = chrome === 'compact' && !librarySheetOpen;
    } else {
      restoreHome(adoptedLeft);
      restoreHome(adoptedRight);
      restoreHome(adoptedAnalysis);
      if (adoptedHeader) adoptedHeader.hidden = false;
      materialLabTransportFallback.hidden = false;
      if (!materialActive) librarySheetOpen = false;
    }
    const structuralModuleLive = !materialActive && activeLayout === 'structural-test' && !structuralModuleHost.hidden;
    options.testWorkspace.hidden = structuralModuleLive;
    options.testWorkspace.classList.toggle('eng-app-data-source', structuralModuleLive);
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-layout-target]')) {
      const active = button.dataset.engLayoutTarget === activeLayout;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-concept-target]')) {
      const active = button.dataset.engConceptTarget === concept
        || (activeLayout === 'material-lab' && button.dataset.engLayoutTarget === 'material-lab');
      button.classList.toggle('is-active', active);
    }
    syncLabNav();
    syncFieldView(activeFieldView);
    applyPlaybackToModules();
    syncFirstRunGuide();
  };

  const emitLayoutEvents = (announceChange: boolean): void => {
    const concept = currentConceptView();
    callbacks.onLayoutChange?.(activeLayout);
    callbacks.onConceptViewChange?.(concept);
    root.dispatchEvent(new CustomEvent('engineering-layout-change', { detail: { layout: activeLayout, chrome: resolvedChrome(), view: concept } }));
    root.dispatchEvent(new CustomEvent('engineering-concept-view-change', { detail: { view: concept } }));
    if (announceChange) announce(`${conceptViewLabel(concept)} active.`);
  };

  const setChrome = (chrome: EngineeringChromeId | 'auto'): void => {
    chromePreference = chrome;
    syncLayoutDom();
    emitLayoutEvents(false);
  };

  const setFieldView = (view: EngineeringFieldViewId): void => {
    if (!isEngineeringFieldViewId(view)) return;
    activeFieldView = view;
    syncFieldView(view);
    callbacks.onFieldViewChange?.(view);
    root.dispatchEvent(new CustomEvent('engineering-field-view-change', { detail: { view } }));
  };

  const setMaterialTab = (tab: EngineeringMaterialTabId): void => {
    if (!isEngineeringMaterialTabId(tab)) return;
    activeMaterialTab = tab;
    syncMaterialTab(tab);
  };

  const setWorkspace = (
    workspace: EngineeringWorkspaceId,
    settings: { focus?: boolean; announce?: boolean } = {},
  ): void => {
    if (destroyed || !isEngineeringWorkspaceId(workspace)) return;
    activeWorkspace = workspace;
    activeLayout = layoutForWorkspace(workspace, lastTestLayout);
    if (workspace === 'test') lastTestLayout = activeLayout;
    for (const [candidate, element] of workspaces) {
      const active = candidate === workspace;
      element.hidden = !active;
      element.setAttribute('aria-hidden', String(!active));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-workspace-target]')) {
      const active = button.dataset.engWorkspaceTarget === workspace;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    }
    menu.hidden = true;
    syncLayoutDom();
    moveAttachedViewport(workspace);
    window.requestAnimationFrame(drawAllCharts);
    callbacks.onWorkspaceChange?.(workspace);
    root.dispatchEvent(new CustomEvent('engineering-workspace-change', { detail: { workspace, layout: activeLayout, view: currentConceptView() } }));
    if (settings.announce !== false) announce(`${conceptViewLabel(currentConceptView())} active.`);
    if (settings.focus) workspaces.get(workspace)?.focus({ preventScroll: true });
    requestPlayAfterLoad();
  };

  const setLayout = (
    layout: EngineeringLayoutId,
    settings: { focus?: boolean; announce?: boolean } = {},
  ): void => {
    if (destroyed || !isEngineeringLayoutId(layout)) return;
    if (layout === 'material-lab' || layout === 'structural-test') lastTestLayout = layout;
    const workspace = ENGINEERING_WORKSPACE_FOR_LAYOUT[layout];
    activeLayout = layout;
    if (workspace !== activeWorkspace) {
      setWorkspace(workspace, settings);
      return;
    }
    syncLayoutDom();
    moveAttachedViewport(activeWorkspace);
    window.requestAnimationFrame(drawAllCharts);
    emitLayoutEvents(settings.announce !== false);
    if (settings.focus) workspaces.get(workspace)?.focus({ preventScroll: true });
    requestPlayAfterLoad();
  };

  const setConceptView = (
    view: EngineeringConceptViewId,
    settings: { focus?: boolean; announce?: boolean } = {},
  ): void => {
    if (destroyed || !isEngineeringConceptViewId(view)) return;
    const spec = ENGINEERING_CONCEPT_VIEWS[view];
    chromePreference = spec.chrome;
    if (spec.workspace === 'test') lastTestLayout = spec.layout;
    activeLayout = spec.layout;
    if (spec.workspace !== activeWorkspace) {
      setWorkspace(spec.workspace, settings);
      return;
    }
    syncLayoutDom();
    moveAttachedViewport(activeWorkspace);
    window.requestAnimationFrame(drawAllCharts);
    emitLayoutEvents(settings.announce !== false);
    if (settings.focus) workspaces.get(spec.workspace)?.focus({ preventScroll: true });
    requestPlayAfterLoad();
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
    moveAttachedViewport(activeWorkspace);
  };

  const setActiveLab = (labId: string, title?: string): void => {
    if (destroyed) return;
    activeLabId = labId;
    if (title) activeLabTitle = title;
    materialLabDesktop?.setLabId(labId, { announce: false, emit: false });
    materialLabMobile?.update({
      activeSimulationId: labId,
      ...(title ? { title } : {}),
    });
    const lab = getWorkbenchLab(labId);
    if (lab && physicsStructural) {
      physicsStructural.updateLab(lab);
      const manifest = getEngineeringModelForLab(lab.id);
      if (manifest) physicsStructural.updateModel(manifest);
    }
    physicsCorrelation?.update({
      ...(title ? { title: title.toUpperCase() } : {}),
      modelNote: lab
        ? `${lab.title} · ${lab.fidelity}. Reduced numerical model with normalized comparative parameters; not a certified constitutive model.`
        : undefined,
    });
    physicsFieldModal?.update({
      ...(title ? { testLabel: title.toUpperCase() } : {}),
      projectLabel: options.projectLabel ?? 'BOX3D-WEBGPU',
    });
    if (options.testLabel === undefined && title) {
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-test]')) node.textContent = title;
    }
    applyPlaybackToModules();
    requestPlayAfterLoad();
  };

  const setPointerMode = (mode: EngineeringPointerModeId): void => {
    if (destroyed) return;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-eng-pointer-mode]')) {
      const active = button.dataset.engPointerMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    materialLabDesktop?.setPointerMode(mode, { emit: false });
  };

  const setForceAvailable = (available: boolean): void => {
    if (destroyed) return;
    materialLabDesktop?.setForceAvailable(available);
  };

  const updateTelemetry = (update: EngineeringTelemetryUpdate): void => {
    telemetry = { ...telemetry, ...update, channels: update.channels ?? telemetry.channels };
    if (update.step !== undefined || update.frame !== undefined || update.timeSeconds !== undefined) {
      run = {
        ...run,
        ...(update.step !== undefined ? { step: update.step } : {}),
        ...(update.frame !== undefined ? { frame: update.frame } : {}),
        ...(update.timeSeconds !== undefined ? { elapsedSeconds: update.timeSeconds } : {}),
      };
      syncRunControls();
    }
    if (update.timeSeconds !== undefined) setBoundText('time', update.timeSeconds.toFixed(2));
    if (update.step !== undefined) setBoundText('step', String(update.step));
    if (update.frame !== undefined) {
      const frame = Math.max(0, Math.round(update.frame));
      setBoundText('frame', String(frame).padStart(5, '0'));
      frameSlider.value = String(clamp(frame, Number(frameSlider.min), Number(frameSlider.max)));
      for (const bookmark of root.querySelectorAll<HTMLElement>('[data-eng-frame]')) {
        bookmark.classList.toggle('is-active', Number(bookmark.dataset.engFrame) === frame);
      }
    }
    if (update.force) setBoundText('force', formatMeasurement(update.force));
    if (update.displacement) setBoundText('displacement', formatMeasurement(update.displacement));
    if (update.strainX) setBoundText('strain-x', formatMeasurement(update.strainX));
    if (update.strainY) setBoundText('strain-y', formatMeasurement(update.strainY));
    if (update.strainXY) setBoundText('strain-xy', formatMeasurement(update.strainXY));
    if (update.energy !== undefined) setBoundText('energy', formatMeasurement(update.energy));
    if (update.residual) setBoundText('residual', formatMeasurement(update.residual));
    if (update.correlationPercent !== undefined) setBoundText('correlation', update.correlationPercent.toFixed(1));
    if (update.frequencyHz !== undefined) setBoundText('frequency', update.frequencyHz.toFixed(1));
    if (update.dampingPercent !== undefined) setBoundText('damping', update.dampingPercent.toFixed(2));
    if (update.coherence !== undefined) setBoundText('coherence', update.coherence.toFixed(2));
    if (update.convergence !== undefined) setBoundText('convergence', String(update.convergence));
    if (update.fps !== undefined) setBoundText('fps', String(Math.max(0, Math.round(update.fps))));
    if (update.backend) {
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-backend]')) node.textContent = update.backend;
    }
    materialLabDesktop?.updateTelemetry({
      timeSeconds: update.timeSeconds,
      force: typeof update.force?.value === 'number' ? update.force.value : undefined,
      energy: typeof update.energy?.value === 'number' ? update.energy.value : undefined,
      peakDemand: typeof update.strainX?.value === 'number' ? update.strainX.value : undefined,
      fps: update.fps,
    });
    if (update.fps !== undefined || update.backend) {
      materialLabDesktop?.updateStatus({ backend: update.backend, fps: update.fps, webgpu: true });
    }
    if (update.timeSeconds !== undefined) materialLabMobile?.update({ timeSeconds: update.timeSeconds });
    if (update.channels) {
      for (const channel of update.channels) {
        for (const row of root.querySelectorAll<HTMLElement>(`[data-eng-channel-id="${CSS.escape(channel.id)}"]`)) {
          row.dataset.channelStatus = channel.status ?? row.dataset.channelStatus ?? 'nominal';
          const value = row.querySelector<HTMLElement>('[data-eng-channel-value]');
          if (value && channel.value !== undefined) value.textContent = formatChannelValue(channel.value, channel.unit);
          const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (checkbox && channel.enabled !== undefined) checkbox.checked = channel.enabled;
          const icon = row.querySelector<HTMLElement>('i.ph');
          if (icon && channel.status) icon.className = `ph ${statusIcon(channel.status)}`;
        }
      }
    }
    const sample: Partial<EngineeringSample> & { readonly time?: number; readonly step?: number } = {
      time: update.timeSeconds,
      step: update.step,
      load: typeof update.force?.value === 'number' ? update.force.value : undefined,
      response: typeof update.displacement?.value === 'number' ? update.displacement.value : undefined,
      energy: typeof update.energy?.value === 'number' ? update.energy.value : undefined,
      damage: typeof update.strainX?.value === 'number' ? update.strainX.value : undefined,
      brokenCount: typeof update.strainXY?.value === 'number' ? update.strainXY.value : undefined,
      hash: typeof update.convergence === 'number' ? update.convergence : undefined,
    };
    physicsStructural?.updateTelemetry(sample);
    if (update.backend) physicsStructural?.setBackend(update.backend, true);
    if (update.correlationPercent !== undefined) {
      physicsCorrelation?.update({
        score: update.correlationPercent,
        frame: update.frame,
        cursorTime: update.timeSeconds ?? null,
      });
    } else if (update.frame !== undefined || update.timeSeconds !== undefined) {
      physicsCorrelation?.update({
        frame: update.frame,
        cursorTime: update.timeSeconds ?? null,
      });
    }
    if (update.frequencyHz !== undefined || update.dampingPercent !== undefined || update.coherence !== undefined || update.channels) {
      physicsFieldModal?.update({
        ...(update.frequencyHz !== undefined ? { frequencyLabel: `${update.frequencyHz.toFixed(1)} model Hz` } : {}),
        ...(update.dampingPercent !== undefined ? { dampingLabel: `${update.dampingPercent.toFixed(2)} %` } : {}),
        ...(update.coherence !== undefined ? { coherenceLabel: update.coherence.toFixed(2) } : {}),
        ...(update.channels ? {
          channels: FIELD_MODULE_CHANNELS.map((channel) => {
            const live = update.channels?.find((item) => item.id === channel.id);
            return live && live.value !== undefined
              ? { ...channel, value: formatChannelValue(live.value, live.unit), status: live.status ?? channel.status }
              : channel;
          }),
        } : {}),
      });
    }
  };

  const updateRunLifecycle = (update: EngineeringRunLifecycleUpdate): void => {
    run = { ...run, ...update };
    if (update.state === 'running') playbackStarted = true;
    else if (update.state !== 'paused') playbackStarted = false;
    root.dataset.runState = update.state;
    const label = update.state.toUpperCase();
    for (const element of root.querySelectorAll<HTMLElement>('[data-eng-run-state]')) element.textContent = label;
    if (update.message) for (const element of root.querySelectorAll<HTMLElement>('[data-eng-run-message]')) element.textContent = update.message;
    if (update.frame !== undefined) updateTelemetry({ frame: update.frame });
    if (update.elapsedSeconds !== undefined) updateTelemetry({ timeSeconds: update.elapsedSeconds });
    let armLabel: string;
    switch (update.state) {
      case 'running': armLabel = 'PAUSE'; break;
      case 'paused': armLabel = 'RESUME'; break;
      case 'armed': armLabel = 'START TEST'; break;
      case 'idle':
      case 'preflight':
      case 'complete':
      case 'aborted':
      case 'error':
        armLabel = 'ARM TEST';
        break;
      default:
        armLabel = assertNever(update.state, `Unknown run state: ${String(update.state)}`);
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-eng-arm-label]')) element.textContent = armLabel;
    let readiness: string;
    switch (update.state) {
      case 'idle': readiness = 'PREFLIGHT REQUIRED'; break;
      case 'preflight': readiness = 'CHECKING MODEL'; break;
      case 'armed': readiness = 'MODEL READY'; break;
      case 'running': readiness = 'ACQUIRING'; break;
      case 'paused': readiness = 'CAPTURE PAUSED'; break;
      case 'complete': readiness = 'REVIEW CAPTURE'; break;
      case 'aborted': readiness = 'CAPTURE REJECTED'; break;
      case 'error': readiness = 'MODEL ERROR'; break;
      default:
        readiness = assertNever(update.state, `Unknown run state: ${String(update.state)}`);
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-eng-field-readiness]')) element.textContent = readiness;
    for (const element of root.querySelectorAll<HTMLElement>('[data-eng-preflight-status]')) {
      const passed = ['armed', 'running', 'paused', 'complete'].includes(update.state);
      element.textContent = passed ? 'Checks passed' : update.state === 'preflight' ? 'Checking' : 'Required';
      element.classList.toggle('eng-status-value--good', passed);
      element.classList.toggle('eng-status-value--caution', !passed);
    }
    syncRunControls();
    materialLabDesktop?.updateRunLifecycle({
      state: update.state,
      playback: playbackFromRunState(update.state),
      elapsedSeconds: update.elapsedSeconds,
      message: update.message,
    });
    materialLabMobile?.update({ playing: update.state === 'running', timeSeconds: update.elapsedSeconds });
    const lab = getWorkbenchLab(activeLabId);
    if (physicsStructural && lab) {
      const seedValue = typeof telemetry.seed === 'number'
        ? telemetry.seed
        : typeof telemetry.seed === 'string'
          ? Number.parseInt(telemetry.seed, 16) || 0
          : 0;
      const snapshot: EngineeringRunSnapshot = {
        id: activeLabId,
        title: activeLabTitle || lab.title,
        labId: lab.id,
        sceneId: typeof lab.sceneId === 'number' ? lab.sceneId : 0,
        solver: lab.solver,
        fidelity: lab.fidelity,
        backend: String(telemetry.backend ?? 'webgpu'),
        seed: Number.isFinite(seedValue) ? seedValue : 0,
        stressPreset: 0,
        fixedStep: 1 / 60,
        createdAt: new Date().toISOString(),
        provenance: {
          source: 'solver',
          label: `${lab.fidelity} · normalized model`,
          calibrated: false,
          detail: 'Deterministic reduced-order simulation for comparative testing and workflow prototyping. Values are not certified engineering predictions.',
        },
        state: mapShellRunState(update.state),
        samples: [],
        events: [],
      };
      const recorderState = snapshot.state;
      if (recorderState !== lastStructuralRunState) {
        lastStructuralRunState = recorderState;
        physicsStructural.updateRun(snapshot);
      }
      if (update.message) physicsStructural.setStatus(update.message);
    }
    physicsFieldModal?.update({
      runState: update.state,
      runMessage: update.message ?? '',
      armLabel,
      readiness,
      abortEnabled: ['preflight', 'armed', 'running', 'paused'].includes(update.state),
    });
    physicsCorrelation?.update({
      playing: update.state === 'running',
      frame: update.frame,
      message: update.message,
    });
  };

  const updateChart = (chart: EngineeringChartId, update: EngineeringChartUpdate): void => {
    charts.set(chart, update);
    drawChart(chart);
    const correlationId = correlationChartId(chart);
    if (correlationId) {
      physicsCorrelation?.update({ plots: { [correlationId]: toCorrelationPlot(update) } });
    }
    switch (chart) {
      case 'field-frequency-response':
        physicsFieldModal?.update({ frequencyChart: update });
        break;
      case 'field-coherence':
        physicsFieldModal?.update({ coherenceChart: update });
        break;
      case 'correlation-force':
      case 'correlation-energy':
      case 'correlation-residual':
        break;
      default:
        assertNever(chart, `Unknown engineering chart: ${String(chart)}`);
    }
  };

  const setCorrelationCases = (cases: readonly EngineeringCorrelationCase[], requestedActiveCaseId?: string): void => {
    const tbody = required<HTMLTableSectionElement>(root, '[data-eng-case-list]');
    tbody.replaceChildren();
    if (requestedActiveCaseId) activeCaseId = requestedActiveCaseId;
    for (const item of cases) {
      const row = document.createElement('tr');
      row.dataset.engCaseId = item.id;
      row.dataset.status = item.status;
      row.classList.toggle('is-active', item.id === activeCaseId);
      row.tabIndex = 0;
      row.setAttribute('aria-selected', String(item.id === activeCaseId));
      row.setAttribute('aria-label', `Case ${item.id}, normalized input ${item.speed.toFixed(2)}, angle ${item.angle.toFixed(1)}, ${statusLabel(item.status)}`);
      const values = [item.id, item.speed.toFixed(1), item.angle.toFixed(1), statusLabel(item.status)];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      tbody.append(row);
    }
    physicsCorrelation?.update({
      cases,
      activeCaseId,
    });
  };

  const setCorrelationReference = (reference: EngineeringReferenceMedia | null): void => {
    const host = required<HTMLElement>(root, '[data-eng-reference-media]');
    const sync = required<HTMLElement>(root, '[data-eng-correlation-sync]');
    const referenceTime = required<HTMLElement>(root, '[data-eng-reference-time]');
    if (referenceObjectUrl && reference?.src !== referenceObjectUrl) {
      URL.revokeObjectURL(referenceObjectUrl);
      referenceObjectUrl = null;
    }
    host.replaceChildren();
    if (!reference) {
      const empty = document.createElement('div');
      empty.className = 'eng-empty-state';
      empty.innerHTML = '<i class="ph ph-file-video" aria-hidden="true"></i><strong>No reference loaded</strong><span>Import an image or video to compare.</span>';
      host.append(empty);
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-correlation-context]')) node.textContent = 'Deterministic reduced-model comparison · No reference selected';
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-reference-summary]')) node.textContent = 'REFERENCE: NOT SELECTED';
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-reference-status]')) node.textContent = 'MISSING';
      for (const row of root.querySelectorAll<HTMLElement>('[data-eng-reference-check]')) {
        row.classList.add('is-warning');
        row.classList.remove('is-pass');
      }
      for (const node of root.querySelectorAll<HTMLElement>('[data-eng-score-status]')) node.textContent = 'NOT SCORED';
      sync.classList.remove('eng-status-chip--good');
      sync.innerHTML = '<i class="ph ph-link-break" aria-hidden="true"></i> REFERENCE REQUIRED';
      referenceTime.textContent = 'no reference';
      physicsCorrelation?.update({
        referenceMedia: null,
        synced: false,
        syncLabel: 'REFERENCE REQUIRED',
        referenceRole: 'REFERENCE',
        referenceCaption: 'no reference',
        score: null,
        scoreStatus: 'NOT SCORED',
        context: 'Deterministic reduced-model comparison · No reference selected',
      });
      return;
    }
    const media: HTMLImageElement | HTMLVideoElement = reference.kind === 'video'
      ? document.createElement('video')
      : document.createElement('img');
    media.src = reference.src;
    media.setAttribute('aria-label', reference.label);
    if (media instanceof HTMLVideoElement) {
      media.controls = true;
      media.muted = true;
      media.playsInline = true;
    } else {
      media.alt = reference.label;
    }
    host.append(media);
    const deterministic = reference.provenance === 'deterministic';
    const referenceKind = deterministic ? 'Deterministic final checkpoint' : 'Imported media reference';
    for (const node of root.querySelectorAll<HTMLElement>('[data-eng-correlation-context]')) node.textContent = `${referenceKind} · linked work revision`;
    for (const node of root.querySelectorAll<HTMLElement>('[data-eng-reference-summary]')) node.textContent = deterministic ? 'REFERENCE: DETERMINISTIC RUN' : 'REFERENCE: IMPORTED MEDIA';
    for (const node of root.querySelectorAll<HTMLElement>('[data-eng-reference-status]')) node.textContent = deterministic ? 'LOCKED' : 'IMPORTED';
    for (const row of root.querySelectorAll<HTMLElement>('[data-eng-reference-check]')) {
      row.classList.toggle('is-warning', !deterministic);
      row.classList.toggle('is-pass', deterministic);
    }
    for (const node of root.querySelectorAll<HTMLElement>('[data-eng-score-status]')) node.textContent = deterministic ? 'WORK RUN REQUIRED' : 'AWAITING DATA MAP';
    sync.classList.toggle('eng-status-chip--good', deterministic);
    sync.innerHTML = deterministic
      ? '<i class="ph ph-image" aria-hidden="true"></i> SNAPSHOT LINKED'
      : '<i class="ph ph-warning" aria-hidden="true"></i> MAP REQUIRED';
    referenceTime.textContent = deterministic ? 'final checkpoint' : 'media · not time mapped';
    physicsCorrelation?.update({
      referenceMedia: { kind: reference.kind, src: reference.src, label: reference.label },
      synced: deterministic,
      syncLabel: deterministic ? 'SNAPSHOT LINKED' : 'MAP REQUIRED',
      referenceRole: deterministic ? 'REFERENCE' : 'TEST',
      referenceCaption: deterministic ? 'final checkpoint' : 'media · not time mapped',
      provenance: deterministic ? 'solver-native' : 'imported',
      provenanceLabel: deterministic ? 'REDUCED NUMERICAL MODEL' : 'IMPORTED REFERENCE',
      scoreStatus: deterministic ? 'WORK RUN REQUIRED' : 'AWAITING DATA MAP',
      context: `${referenceKind} · linked work revision`,
    });
  };

  const setCorrelationWorkSnapshot = (snapshot: EngineeringReferenceMedia | null): void => {
    const host = required<HTMLElement>(root, '[data-eng-work-media]');
    const workTime = required<HTMLElement>(root, '[data-eng-work-time]');
    host.replaceChildren();
    if (!snapshot) {
      host.hidden = true;
      workTime.textContent = 'live model · not archived';
      physicsCorrelation?.update({
        candidateSnapshot: null,
        candidateCaption: 'live model · not archived',
      });
      return;
    }
    host.hidden = false;
    const image = document.createElement('img');
    image.src = snapshot.src;
    image.alt = snapshot.label;
    host.append(image);
    workTime.textContent = 'final checkpoint';
    physicsCorrelation?.update({
      candidateSnapshot: { kind: snapshot.kind, src: snapshot.src, label: snapshot.label },
      candidateCaption: 'final checkpoint',
    });
  };

  const updateModalCaptures = (captures: readonly EngineeringModalCapture[]): void => {
    const bounded = captures.slice(0, 6);
    const slots = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-eng-capture-slot]'));
    slots.forEach((slot, index) => {
      const capture = bounded[index];
      const next = index === bounded.length && bounded.length < slots.length;
      slot.classList.toggle('is-empty', !capture && !next);
      slot.classList.toggle('is-active', next);
      slot.classList.toggle('is-accepted', capture?.status === 'accepted');
      slot.classList.toggle('is-rejected', capture?.status === 'rejected');
      slot.disabled = !capture && !next;
      slot.setAttribute('aria-label', capture
        ? `${capture.label}, ${capture.status}, ${capture.sampleCount} samples`
        : next
          ? `Arm capture ${index + 1}`
          : `Capture ${index + 1} empty`);
      const status = slot.querySelector<HTMLElement>('span');
      if (status) status.textContent = capture
        ? capture.status === 'accepted' ? `${capture.sampleCount} SAMPLES` : 'REJECTED'
        : next ? 'ARM NEXT' : '—';
      const oldIcon = slot.querySelector('i');
      oldIcon?.remove();
      if (capture || next) {
        const icon = document.createElement('i');
        icon.className = `ph ${capture ? capture.status === 'accepted' ? 'ph-check-circle' : 'ph-x-circle' : 'ph-play'}`;
        icon.setAttribute('aria-hidden', 'true');
        slot.append(icon);
      }
    });
    const acceptedCount = bounded.filter((capture) => capture.status === 'accepted').length;
    const rejectedCount = bounded.filter((capture) => capture.status === 'rejected').length;
    setBoundText('capture-count', String(acceptedCount));
    const status = acceptedCount >= 3 ? 'PROCESSING READY' : `${3 - acceptedCount} ACCEPTED REQUIRED`;
    setBoundText('capture-status', status);
    for (const node of root.querySelectorAll<HTMLElement>('[data-eng-ensemble-status]')) {
      const ready = acceptedCount >= 3;
      node.textContent = ready ? 'Ready to process' : `Needs ${3 - acceptedCount} accepted`;
      node.classList.toggle('eng-status-value--good', ready);
      node.classList.toggle('eng-status-value--caution', !ready);
    }
    for (const queue of root.querySelectorAll<HTMLElement>('[data-eng-capture-queue]')) {
      queue.innerHTML = `${acceptedCount} ACCEPTED · ${rejectedCount} REJECTED<br>${status}`;
    }
    physicsFieldModal?.update({
      captures: toFieldCaptures(bounded),
      captureQueue: `${acceptedCount} ACCEPTED · ${rejectedCount} REJECTED\n${status}`,
      statusTiles: FIELD_MODULE_TILES.map((tile) => {
        if (tile.id === 'coherence') {
          return { ...tile, value: status, tone: acceptedCount >= 3 ? 'good' : 'caution' };
        }
        return tile;
      }),
    });
  };

  const setProvenance = (provenance: EngineeringProvenance, label?: string): void => {
    root.dataset.provenance = provenance;
    const shortLabel = label ?? ((): string => {
      switch (provenance) {
        case 'solver': return 'SOLVER OUTPUT';
        case 'measured': return 'MEASURED INPUT';
        case 'proxy': return 'RIGID / PROXY MODEL';
        case 'synthetic': return 'SYNTHETIC DEMO';
        default: return assertNever(provenance, `Unknown provenance: ${String(provenance)}`);
      }
    })();
    for (const badge of root.querySelectorAll<HTMLElement>('[data-eng-provenance]')) badge.textContent = shortLabel;
    for (const copy of root.querySelectorAll<HTMLElement>('[data-eng-provenance-copy]')) copy.textContent = shortLabel;
    let correlationProvenance: 'solver-native' | 'derived' | 'imported' | 'synthetic-demo';
    switch (provenance) {
      case 'solver':
        correlationProvenance = 'solver-native';
        break;
      case 'measured':
        correlationProvenance = 'imported';
        break;
      case 'proxy':
        correlationProvenance = 'derived';
        break;
      case 'synthetic':
        correlationProvenance = 'synthetic-demo';
        break;
      default:
        correlationProvenance = assertNever(provenance, `Unknown provenance: ${String(provenance)}`);
    }
    physicsCorrelation?.update({ provenance: correlationProvenance, provenanceLabel: shortLabel });
    physicsFieldModal?.update({ provenance: shortLabel });
  };

  const drawChart = (chartId: EngineeringChartId): void => {
    const canvas = canvasByChart.get(chartId);
    const model = charts.get(chartId);
    if (!canvas || !model || canvas.offsetWidth <= 0 || canvas.offsetHeight <= 0) return;
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
    const padding = { left: 38, right: 10, top: 20, bottom: 24 };
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
    if (Math.abs(yMax - yMin) < 1e-9) { yMin -= 1; yMax += 1; }
    const xScale = (value: number): number => padding.left + (value - xMin) / Math.max(1e-9, xMax - xMin) * plotWidth;
    const yScale = (value: number): number => padding.top + (1 - (value - yMin) / Math.max(1e-9, yMax - yMin)) * plotHeight;

    context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
    context.fillStyle = '#778083';
    context.strokeStyle = '#2b3133';
    context.lineWidth = 1;
    context.setLineDash([]);
    for (let index = 0; index <= 4; index++) {
      const y = padding.top + plotHeight * index / 4;
      context.beginPath(); context.moveTo(padding.left, y + 0.5); context.lineTo(padding.left + plotWidth, y + 0.5); context.stroke();
      context.fillText((yMax - (yMax - yMin) * index / 4).toFixed(Math.abs(yMax - yMin) <= 2 ? 1 : 0), 2, y + 3);
    }
    for (let index = 0; index <= 5; index++) {
      const x = padding.left + plotWidth * index / 5;
      context.beginPath(); context.moveTo(x + 0.5, padding.top); context.lineTo(x + 0.5, padding.top + plotHeight); context.stroke();
    }

    model.series.forEach((series, seriesIndex) => {
      context.strokeStyle = series.color ?? CHART_COLORS[seriesIndex % CHART_COLORS.length];
      context.lineWidth = series.id.includes('threshold') || series.id === 'upper' || series.id === 'lower' ? 1 : 1.6;
      context.setLineDash(series.dashed ? [5, 4] : []);
      context.beginPath();
      series.values.forEach((value, index) => {
        const x = xScale(xValues[index] ?? index);
        const y = yScale(value);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    });
    context.setLineDash([]);
    if (model.cursorX !== undefined) {
      context.strokeStyle = '#ff7900';
      context.setLineDash([3, 3]);
      const cursor = xScale(model.cursorX);
      context.beginPath(); context.moveTo(cursor, padding.top); context.lineTo(cursor, padding.top + plotHeight); context.stroke();
      context.setLineDash([]);
    }
    context.fillStyle = '#8e9699';
    if (model.xLabel) context.fillText(model.xLabel, padding.left + plotWidth / 2 - context.measureText(model.xLabel).width / 2, displayHeight - 5);
    if (model.yLabel) {
      context.save(); context.translate(10, padding.top + plotHeight / 2); context.rotate(-Math.PI / 2); context.fillText(model.yLabel, -context.measureText(model.yLabel).width / 2, 0); context.restore();
    }
    let legendX = padding.left;
    for (const series of model.series.slice(0, 3)) {
      context.fillStyle = series.color ?? CHART_COLORS[0];
      context.fillRect(legendX, 6, 11, 2);
      context.fillStyle = '#b9bec0';
      context.fillText(series.label, legendX + 15, 10);
      legendX += 22 + context.measureText(series.label).width;
    }
  };

  function drawAllCharts(): void {
    for (const chartId of charts.keys()) drawChart(chartId);
  }

  const emitRunCommand = async (command: EngineeringRunCommand): Promise<void> => {
    const request = { workspace: activeWorkspace, command } as const;
    root.dispatchEvent(new CustomEvent('engineering-run-command', { detail: request }));
    try {
      await callbacks.onRunCommand?.(request);
    } catch (error) {
      updateRunLifecycle({ state: 'error', message: error instanceof Error ? error.message : 'Run command failed' });
    }
  };

  function playbackFromRunState(state: EngineeringRunState): 'stopped' | 'playing' | 'paused' {
    switch (state) {
      case 'running': return 'playing';
      case 'paused': return 'paused';
      case 'idle':
      case 'preflight':
      case 'armed':
      case 'complete':
      case 'aborted':
      case 'error':
        return 'stopped';
      default:
        return assertNever(state, `Unknown run state: ${String(state)}`);
    }
  }

  function playbackIsLive(): boolean {
    return playbackStarted || run.state === 'running';
  }

  function applyPlaybackToModules(): void {
    if (destroyed) return;
    const live = playbackIsLive() && run.state !== 'paused';
    const playback = live ? 'playing' : playbackFromRunState(run.state);
    const state: EngineeringRunState = live && run.state !== 'running' ? 'running' : run.state;
    materialLabDesktop?.updateRunLifecycle({
      state,
      playback,
      elapsedSeconds: run.elapsedSeconds,
      message: run.message,
    });
    materialLabMobile?.update({ playing: playback === 'playing', timeSeconds: run.elapsedSeconds });
    physicsCorrelation?.update({ playing: playback === 'playing' });
    if (live) physicsFieldModal?.update({ runState: 'running' });
  }

  function hideStackedHowto(hidden: boolean): void {
    for (const hint of root.querySelectorAll<HTMLElement>('[data-phys-str-hint]')) hint.hidden = hidden;
  }

  function syncFirstRunGuide(): void {
    if (destroyed) return;
    root.dataset.engSimpleUi = String(simpleUi);
    root.dataset.engAutoplay = String(autoplayEnabled);
    const view = currentConceptView();
    const eligible = resolvedChrome() === 'desktop' && view === 'structural-test' && activeLayout !== 'material-lab';
    firstRunHost.hidden = !eligible;
    if (!eligible) {
      firstRunGuide?.destroy();
      firstRunGuide = null;
      for (const extra of firstRunHost.querySelectorAll('.frg')) extra.remove();
      hideStackedHowto(view === 'material-lab-desktop' || view === 'material-lab-mobile');
      return;
    }
    if (firstRunGuide) {
      hideStackedHowto(Boolean(firstRunGuide.root));
      return;
    }
    if (firstRunHost.querySelector('.frg')) {
      hideStackedHowto(true);
      return;
    }
    firstRunGuide = mountFirstRunGuide({
      mount: firstRunHost,
      callbacks: {
        play: requestUserPlay,
        applyForce: requestGuideForce,
        reset: () => { void emitRunCommand('reset'); },
      },
    });
    hideStackedHowto(Boolean(firstRunGuide.root));
  }

  function emitPlayDetail(alreadyStarted: boolean): void {
    const detail: EngineeringPlayDetail = {
      view: currentConceptView(),
      labId: activeLabId,
      alreadyStarted,
      command: 'play',
    };
    callbacks.onPlay?.(detail);
    root.dispatchEvent(new CustomEvent('engineering-play', { detail }));
  }

  function requestUserPlay(): void {
    if (destroyed) return;
    if (playbackIsLive() || run.state === 'paused') {
      applyPlaybackToModules();
      emitPlayDetail(true);
      return;
    }
    void emitRunCommand('run');
    emitPlayDetail(false);
  }

  function requestGuideForce(): void {
    void emitRunCommand('arm').then(() => {
      root.dispatchEvent(new CustomEvent('engineering-apply-force', { detail: { workspace: activeWorkspace } }));
    });
  }

  function requestPlayAfterLoad(): void {
    if (destroyed) return;
    applyPlaybackToModules();
    syncFirstRunGuide();
    if (run.state === 'paused') {
      emitPlayDetail(true);
      return;
    }
    if (playbackIsLive()) {
      playRequestQueued = false;
      emitPlayDetail(true);
      return;
    }
    if (!autoplayEnabled) return;
    const allowsAutoplay = !activeLabId || getWorkbenchLabAutoplay(activeLabId)?.autoPlay === true;
    if (!allowsAutoplay) return;
    if (playRequestQueued) return;
    playRequestQueued = true;
    emitPlayDetail(false);
    void emitRunCommand('run').finally(() => {
      playRequestQueued = false;
    });
  }

  const setPlaybackStarted = (started: boolean): void => {
    playbackStarted = started;
    applyPlaybackToModules();
    if (started) emitPlayDetail(true);
  };

  const setSimpleUi = (enabled: boolean): void => {
    simpleUi = enabled;
    syncFirstRunGuide();
  };

  function ensureMaterialLabDesktop(): MaterialLabDesktopController {
    if (materialLabDesktop) return materialLabDesktop;
    materialLabDesktop = createMaterialLabDesktop({
      mount: materialLabDesktopHost,
      idPrefix: `${prefix}-ml-desk`,
      initialLabId: activeLabId || options.initialLabId,
      callbacks: {
        onViewChange: (view) => {
          switch (view) {
            case 'lab':
              if (activeLayout !== 'material-lab') setLayout('material-lab');
              break;
            case 'compare':
              setWorkspace('correlation', { focus: true });
              break;
            case 'captures':
              setWorkspace('field', { focus: true });
              break;
            default:
              assertNever(view, `Unknown material lab view: ${String(view)}`);
          }
        },
        onLabChange: (labId) => {
          callbacks.onLabChange?.(labId);
          root.dispatchEvent(new CustomEvent('engineering-lab-change', { detail: { labId } }));
        },
        onControlChange: (change) => {
          callbacks.onControlChange?.(change);
        },
        onMaterialPresetChange: (presetId) => {
          callbacks.onMaterialPresetChange?.(presetId);
        },
        onPointerModeChange: (mode) => {
          root.dispatchEvent(new CustomEvent('engineering-pointer-mode', { detail: { mode, workspace: activeWorkspace } }));
        },
        onCommand: async (command) => {
          switch (command) {
            case 'reset':
              await emitRunCommand('reset');
              break;
            case 'step':
              options.testWorkspace.querySelector<HTMLButtonElement>('#step')?.click();
              break;
            case 'play':
              await emitRunCommand('run');
              break;
            case 'pause':
              await emitRunCommand('pause');
              break;
            case 'capture':
              root.dispatchEvent(new CustomEvent('engineering-capture-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
              break;
            case 'apply-force':
              await emitRunCommand('arm');
              root.dispatchEvent(new CustomEvent('engineering-apply-force', { detail: { workspace: activeWorkspace } }));
              break;
            case 'manage-library':
              librarySheetOpen = true;
              break;
            default:
              assertNever(command, `Unknown material lab command: ${String(command)}`);
          }
        },
      },
    });
    applyPlaybackToModules();
    return materialLabDesktop;
  }

  function ensureMaterialLabMobile(): MaterialLabMobileController {
    if (materialLabMobile) return materialLabMobile;
    materialLabMobile = mountMaterialLabMobile({
      mount: materialLabMobileHost,
      idPrefix: `${prefix}-ml-mob`,
      initialState: activeLabId
        ? { activeSimulationId: activeLabId, title: activeLabTitle || activeLabId }
        : undefined,
      callbacks: {
        onToolChange: (tool) => {
          switch (tool) {
            case 'orbit':
              root.dispatchEvent(new CustomEvent('engineering-pointer-mode', { detail: { mode: 'orbit', workspace: activeWorkspace } }));
              break;
            case 'apply-force':
              root.dispatchEvent(new CustomEvent('engineering-pointer-mode', { detail: { mode: 'force', workspace: activeWorkspace } }));
              break;
            default:
              assertNever(tool, `Unknown material lab tool: ${String(tool)}`);
          }
        },
        onTabChange: (tab) => setMaterialTab(tab),
        onPlayback: (command) => {
          switch (command) {
            case 'reset':
              void emitRunCommand('reset');
              break;
            case 'step':
              options.testWorkspace.querySelector<HTMLButtonElement>('#step')?.click();
              break;
            case 'play':
              void emitRunCommand('run');
              break;
            case 'pause':
              void emitRunCommand('pause');
              break;
            case 'capture':
              root.dispatchEvent(new CustomEvent('engineering-capture-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
              break;
            default:
              assertNever(command, `Unknown material lab playback: ${String(command)}`);
          }
        },
        onApplyForce: () => {
          void emitRunCommand('arm').then(() => {
            root.dispatchEvent(new CustomEvent('engineering-apply-force', { detail: { workspace: activeWorkspace } }));
          });
        },
        onSimulationSelect: (id) => {
          callbacks.onLabChange?.(id);
          root.dispatchEvent(new CustomEvent('engineering-lab-change', { detail: { labId: id } }));
        },
      },
    });
    applyPlaybackToModules();
    return materialLabMobile;
  }

  function syncMaterialLabModules(active: boolean): void {
    if (!active) {
      materialLabDesktopHost.hidden = true;
      materialLabMobileHost.hidden = true;
      materialLabFallback.hidden = false;
      return;
    }
    try {
      if (resolvedChrome() === 'compact') {
        ensureMaterialLabMobile();
        materialLabDesktopHost.hidden = true;
        materialLabMobileHost.hidden = false;
      } else {
        ensureMaterialLabDesktop();
        materialLabDesktopHost.hidden = false;
        materialLabMobileHost.hidden = true;
      }
      materialLabFallback.hidden = true;
    } catch {
      materialLabDesktopHost.hidden = true;
      materialLabMobileHost.hidden = true;
      materialLabFallback.hidden = false;
    }
  }

  function mapStructuralRunCommand(command: PhysicsStructuralRunCommand): void {
    switch (command) {
      case 'preflight':
      case 'arm':
        void emitRunCommand('arm');
        break;
      case 'run':
      case 'resume':
        void emitRunCommand('run');
        break;
      case 'pause':
        void emitRunCommand('pause');
        break;
      case 'step':
        options.testWorkspace.querySelector<HTMLButtonElement>('#step')?.click();
        break;
      case 'reset':
        void emitRunCommand('reset');
        break;
      case 'abort':
        void emitRunCommand('abort');
        break;
      case 'replay':
        void emitRunCommand('replay');
        break;
      default:
        assertNever(command, `Unknown structural run command: ${String(command)}`);
    }
  }

  function applyActiveLabToStructural(controller: PhysicsStructuralController): void {
    const lab = getWorkbenchLab(activeLabId);
    if (!lab) return;
    controller.updateLab(lab);
    const manifest = getEngineeringModelForLab(lab.id);
    if (manifest) controller.updateModel(manifest);
  }

  function ensurePhysicsStructural(): PhysicsStructuralController {
    if (physicsStructural) return physicsStructural;
    physicsStructural = createPhysicsStructural({
      mount: structuralModuleHost,
      idPrefix: `${prefix}-phys-str`,
      initialLabId: activeLabId || 'titan-bend-dent',
      callbacks: {
        onRunCommand: mapStructuralRunCommand,
        onLabSelect: (labId) => {
          callbacks.onLabChange?.(labId);
          root.dispatchEvent(new CustomEvent('engineering-lab-change', { detail: { labId } }));
        },
        onParameterChange: (id, value) => {
          const input = options.testWorkspace.querySelector<HTMLInputElement>(`[data-parameter-id="${CSS.escape(id)}"]`);
          if (!input) return;
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        },
        onForceTarget: () => {
          options.testWorkspace.querySelector<HTMLButtonElement>('#force-tool')?.click();
          options.testWorkspace.querySelector<HTMLButtonElement>('#force-apply')?.click();
        },
        onViewportTool: (tool) => {
          switch (tool) {
            case 'orbit':
              root.dispatchEvent(new CustomEvent('engineering-pointer-mode', { detail: { mode: 'orbit', workspace: activeWorkspace } }));
              break;
            case 'select':
            case 'pan':
            case 'zoom':
            case 'mesh':
              break;
            default:
              assertNever(tool, `Unknown structural viewport tool: ${String(tool)}`);
          }
        },
        onInspectorTab: (tab) => {
          const inspectorTabId = tab === 'load-case'
            ? 'inspector-tab-force'
            : tab === 'material'
              ? 'inspector-tab-material'
              : tab === 'solver'
                ? 'inspector-tab-solver'
                : assertNever(tab, `Unknown structural inspector tab: ${String(tab)}`);
          options.testWorkspace.querySelector<HTMLButtonElement>(`#${inspectorTabId}`)?.click();
        },
        onSubstepsChange: (substeps) => {
          const select = options.testWorkspace.querySelector<HTMLSelectElement>('#solver-substeps');
          if (!select) return;
          select.value = String(substeps);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        },
        onTimeScaleChange: (scale) => {
          const select = options.testWorkspace.querySelector<HTMLSelectElement>('#speed');
          if (!select) return;
          select.value = String(scale);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        },
        onTimelineSeek: (step) => callbacks.onFrameSeek?.(step),
      },
    });
    stampRegions(physicsStructural.root, {
      header: PHYSICS_STRUCTURAL_REGIONS.header.selector,
      left: PHYSICS_STRUCTURAL_REGIONS.experimentRail.selector,
      viewport: PHYSICS_STRUCTURAL_REGIONS.viewport.selector,
      analysis: PHYSICS_STRUCTURAL_REGIONS.charts.selector,
      transport: PHYSICS_STRUCTURAL_REGIONS.timeline.selector,
      right: PHYSICS_STRUCTURAL_REGIONS.inspector.selector,
      status: PHYSICS_STRUCTURAL_REGIONS.footer.selector,
      center: '.phys-str-body',
    });
    stampAttr(physicsStructural.root, '[data-phys-str-twin]', 'data-eng-test');
    stampAttr(physicsStructural.root, '[data-phys-str-backend]', 'data-eng-backend');
    attachWorkspaceMenuButton(physicsStructural.root, '.phys-str-identity', 'phys-str-icon');
    applyActiveLabToStructural(physicsStructural);
    if (activeLabTitle) {
      for (const node of physicsStructural.root.querySelectorAll<HTMLElement>('[data-eng-test]')) {
        node.textContent = activeLabTitle;
      }
    }
    applyPlaybackToModules();
    return physicsStructural;
  }

  function ensurePhysicsCorrelation(): PhysicsCorrelationView {
    if (physicsCorrelation) return physicsCorrelation;
    physicsCorrelation = mountPhysicsCorrelation(correlationModuleHost, {
      idPrefix: `${prefix}-phys-corr`,
      callbacks: {
        onFrameSeek: (frame) => callbacks.onFrameSeek?.(frame),
        onCaseChange: (caseId) => {
          activeCaseId = caseId;
          callbacks.onCaseChange?.(caseId);
        },
        onExportEvidence: () => {
          const request: EngineeringEvidenceRequest = {
            workspace: 'correlation', caseId: activeCaseId, run, telemetry,
            generatedAt: new Date().toISOString(),
          };
          if (!callbacks.onEvidenceExport) {
            announce('Evidence export handler is not connected.');
            return;
          }
          return Promise.resolve(callbacks.onEvidenceExport(request)).then(() => announce('Evidence export requested.'));
        },
        onImportReference: () => requestImport('reference-media'),
        onImportData: () => requestImport('correlation-data'),
        onReplay: () => callbacks.onFrameSeek?.(0),
        onPlayToggle: (playing) => {
          if (playing) announce('The reference is a final checkpoint image. Time-series visual replay is not available in this build.');
        },
        onTool: (tool) => {
          switch (tool) {
            case 'capture':
              root.dispatchEvent(new CustomEvent('engineering-capture-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
              break;
            case 'bookmark':
            case 'grid':
            case 'settings':
              break;
            default:
              assertNever(tool, `Unknown correlation tool: ${String(tool)}`);
          }
        },
      },
    });
    stampRegions(physicsCorrelation.root, {
      header: '.phys-corr-topbar',
      left: '.phys-corr-left',
      center: '.phys-corr-center',
      viewport: '[data-phys-corr-viewport]',
      right: '.phys-corr-right',
      analysis: '.phys-corr-charts',
      transport: '.phys-corr-transport',
      status: '.phys-corr-status',
    });
    stampAttr(physicsCorrelation.root, '[data-phys-corr-bind="title"]', 'data-eng-correlation-title');
    stampAttr(physicsCorrelation.root, '[data-phys-corr-bind="score"]', 'data-eng-value', 'correlation');
    stampAttr(physicsCorrelation.root, '[data-phys-corr-score-badge]', 'data-eng-score-status');
    stampAttr(physicsCorrelation.root, '[data-phys-corr-bind="frame"]', 'data-eng-value', 'frame');
    attachWorkspaceMenuButton(physicsCorrelation.root, '.phys-corr-topbar', 'phys-corr-icon');
    applyPlaybackToModules();
    return physicsCorrelation;
  }

  function ensurePhysicsFieldModal(): PhysicsFieldModalController {
    if (physicsFieldModal) return physicsFieldModal;
    physicsFieldModal = createPhysicsFieldModal({
      mount: fieldModuleHost,
      idPrefix: `${prefix}-phys-field`,
      closeOnOverlay: false,
      closeOnEscape: false,
      initial: {
        title: 'MODEL RESPONSE',
        projectLabel: options.projectLabel ?? 'BOX3D-WEBGPU',
        testLabel: (activeLabTitle || 'COMPOSITE COUPON').toUpperCase(),
        synced: false,
        clockLabel: '60 fixed steps/s',
        readiness: 'PREFLIGHT REQUIRED',
        runState: 'idle',
        runMessage: 'Ready for input',
        triggerValue: '1.00',
        triggerDetail: 'NORMALIZED TIP IMPULSE',
        inputRangeValue: '0–40',
        inputRangeDetail: 'NORMALIZED IMPULSE',
        averagingValue: '3',
        averagingDetail: 'ACCEPTED REQUIRED',
        channels: FIELD_MODULE_CHANNELS,
        statusTiles: FIELD_MODULE_TILES,
        safetyCopy: 'Runs numerical capture QC on one reduced-order response; no hardware or physical DAQ is connected.',
        frequencyLabel: '—',
        dampingLabel: '—',
        coherenceLabel: '—',
        captures: toFieldCaptures([]),
        captureQueue: '0 ACCEPTED · 0 REJECTED\n3 ACCEPTED REQUIRED',
        activeView: activeFieldView,
        armLabel: 'ARM TEST',
        abortEnabled: false,
        abortLabel: 'ABORT CAPTURE',
        provenance: 'REDUCED NUMERICAL MODEL',
        frequencyChart: { ...EMPTY_FIELD_CHART, yLabel: 'relative amplitude (dB)' },
        coherenceChart: { ...EMPTY_FIELD_CHART, yDomain: [0, 1] },
      },
      callbacks: {
        onArm: () => {
          if (run.state === 'armed' || run.state === 'paused') void emitRunCommand('run');
          else if (run.state === 'running') void emitRunCommand('pause');
          else void emitRunCommand('arm');
        },
        onAbort: () => { void emitRunCommand('abort'); },
        onViewChange: (view) => setFieldView(view),
        onOrbit: () => {
          root.dispatchEvent(new CustomEvent('engineering-orbit-request', { detail: { workspace: activeWorkspace } }));
        },
        onAnnotation: () => {
          root.dispatchEvent(new CustomEvent('engineering-annotation-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
        },
        onMenu: () => {
          if (physicsFieldModal?.isOpen()) {
            physicsFieldModal.root.append(menu);
          }
          menu.hidden = !menu.hidden;
        },
        onClose: () => {
          restoreWorkspaceMenu();
          if (!destroyed && activeWorkspace === 'field') setConceptView('structural-test');
        },
      },
    });
    stampRegions(physicsFieldModal.root, {
      header: '.phys-field-topbar',
      viewport: '.phys-field-viewport',
      right: '.phys-field-controls',
      analysis: '.phys-field-charts',
      transport: '.phys-field-captures',
      'mobile-nav': '.phys-field-nav',
    });
    stampAttr(physicsFieldModal.root, '[data-phys-run-state]', 'data-eng-run-state');
    stampAttr(physicsFieldModal.root, '[data-phys-readiness]', 'data-eng-field-readiness');
    physicsFieldModal.root.addEventListener('close', () => {
      restoreWorkspaceMenu();
      if (destroyed || activeWorkspace !== 'field') return;
      setConceptView('structural-test');
    }, eventOptions);
    applyPlaybackToModules();
    return physicsFieldModal;
  }

  function syncPhysicsModules(): void {
    const structuralActive = activeWorkspace === 'test' && activeLayout === 'structural-test';
    const correlationActive = activeWorkspace === 'correlation';
    const fieldActive = activeWorkspace === 'field';
    try {
      if (structuralActive) {
        ensurePhysicsStructural();
        structuralModuleHost.hidden = false;
      } else {
        structuralModuleHost.hidden = true;
      }
    } catch {
      structuralModuleHost.hidden = true;
    }
    try {
      if (correlationActive) {
        ensurePhysicsCorrelation();
        correlationModuleHost.hidden = false;
        correlationFallback.hidden = true;
      } else {
        correlationModuleHost.hidden = true;
        correlationFallback.hidden = false;
      }
    } catch {
      correlationModuleHost.hidden = true;
      correlationFallback.hidden = false;
    }
    try {
      if (fieldActive) {
        ensurePhysicsFieldModal();
        fieldModuleHost.hidden = false;
        fieldFallback.hidden = true;
      } else {
        fieldModuleHost.hidden = true;
        fieldFallback.hidden = false;
      }
    } catch {
      fieldModuleHost.hidden = true;
      fieldFallback.hidden = false;
    }
  }

  const requestImport = (kind: EngineeringImportKind): void => {
    importKind = kind;
    fileInput.accept = kind === 'reference-media' ? 'image/*,video/*' : '.csv,.json';
    fileInput.value = '';
    fileInput.click();
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const conceptButton = target?.closest<HTMLButtonElement>('[data-eng-concept-target]');
    const layoutButton = target?.closest<HTMLButtonElement>('[data-eng-layout-target]');
    const layoutTarget = layoutButton?.dataset.engLayoutTarget;
    const conceptTarget = conceptButton?.dataset.engConceptTarget;
    if (layoutButton && isEngineeringLayoutId(layoutTarget)) {
      setLayout(layoutTarget, { focus: true });
      return;
    }
    if (conceptButton && isEngineeringConceptViewId(conceptTarget)) {
      setConceptView(conceptTarget, { focus: true });
      return;
    }
    const workspaceButton = target?.closest<HTMLButtonElement>('[data-eng-workspace-target]');
    const workspaceTarget = workspaceButton?.dataset.engWorkspaceTarget;
    if (workspaceButton && isEngineeringWorkspaceId(workspaceTarget)) {
      setWorkspace(workspaceTarget, { focus: true });
      return;
    }
    const labNav = target?.closest<HTMLButtonElement>('[data-eng-lab-nav]');
    const labNavId = labNav?.dataset.engLabNav;
    if (labNav && isEngineeringLabNavId(labNavId)) {
      switch (labNavId) {
        case 'lab':
          setLayout('material-lab', { focus: true });
          break;
        case 'compare':
          setWorkspace('correlation', { focus: true });
          break;
        case 'captures':
          setWorkspace('field', { focus: true });
          break;
        default:
          assertNever(labNavId, `Unknown lab nav: ${String(labNavId)}`);
      }
      return;
    }
    const materialTab = target?.closest<HTMLButtonElement>('[data-eng-material-tab]');
    const materialTabId = materialTab?.dataset.engMaterialTab;
    if (materialTab && isEngineeringMaterialTabId(materialTabId)) {
      setMaterialTab(materialTabId);
      announce(`${materialTabId} inspector open.`);
      return;
    }
    const pointerModeButton = target?.closest<HTMLButtonElement>('[data-eng-pointer-mode]');
    const pointerModeId = pointerModeButton?.dataset.engPointerMode;
    if (pointerModeButton && isEngineeringPointerModeId(pointerModeId)) {
      setPointerMode(pointerModeId);
      root.dispatchEvent(new CustomEvent('engineering-pointer-mode', { detail: { mode: pointerModeId, workspace: activeWorkspace } }));
      switch (pointerModeId) {
        case 'orbit':
          announce('Orbit pointer mode. Drag to rotate.');
          break;
        case 'force':
          announce('Apply-force pointer mode. Drag to aim, then click Apply force.');
          break;
        default:
          assertNever(pointerModeId, `Unknown pointer mode: ${String(pointerModeId)}`);
      }
      return;
    }
    const caseRow = target?.closest<HTMLTableRowElement>('[data-eng-case-id]');
    if (caseRow) {
      activeCaseId = caseRow.dataset.engCaseId ?? activeCaseId;
      for (const row of root.querySelectorAll<HTMLElement>('[data-eng-case-id]')) {
        const selected = row === caseRow;
        row.classList.toggle('is-active', selected);
        row.setAttribute('aria-selected', String(selected));
      }
      callbacks.onCaseChange?.(activeCaseId);
      announce(`Correlation case ${activeCaseId} selected.`);
      return;
    }
    const bookmark = target?.closest<HTMLButtonElement>('[data-eng-frame]');
    if (bookmark) {
      const frame = Number(bookmark.dataset.engFrame);
      updateRunLifecycle({ ...run, state: run.state, frame });
      callbacks.onFrameSeek?.(frame);
      for (const button of root.querySelectorAll('[data-eng-frame]')) button.classList.toggle('is-active', button === bookmark);
      return;
    }
    const fieldView = target?.closest<HTMLButtonElement>('[data-eng-field-view]');
    const fieldViewId = fieldView?.dataset.engFieldView;
    if (fieldView && isEngineeringFieldViewId(fieldViewId)) {
      setFieldView(fieldViewId);
      announce(`${fieldView.textContent?.trim() ?? 'Field'} view selected.`);
      return;
    }
    const modeButton = target?.closest<HTMLButtonElement>('.eng-mode-dots button');
    if (modeButton) {
      for (const button of root.querySelectorAll<HTMLButtonElement>('.eng-mode-dots button')) {
        const active = button === modeButton;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      announce(`${modeButton.getAttribute('aria-label') ?? 'Modal result'} selected.`);
      return;
    }
    const captureSlot = target?.closest<HTMLButtonElement>('[data-eng-capture-slot]');
    if (captureSlot) {
      if (captureSlot.classList.contains('is-active')) {
        if (['complete', 'aborted', 'error'].includes(run.state)) {
          void emitRunCommand('reset').then(() => armDialog.showModal());
        } else if (run.state === 'idle') {
          armDialog.showModal();
        }
      } else {
        announce(captureSlot.getAttribute('aria-label') ?? 'Capture selected.');
      }
      return;
    }
    const actionButton = target?.closest<HTMLButtonElement>('[data-eng-action]');
    const action = actionButton?.dataset.engAction;
    if (!action) return;
    switch (action) {
      case 'workspace-menu':
        menu.hidden = !menu.hidden;
        break;
      case 'close-menu':
        menu.hidden = true;
        break;
      case 'import-reference':
        requestImport('reference-media');
        break;
      case 'import-data':
        requestImport('correlation-data');
        break;
      case 'export-evidence': {
        const request: EngineeringEvidenceRequest = {
          workspace: 'correlation', caseId: activeCaseId, run, telemetry,
          generatedAt: new Date().toISOString(),
        };
        if (!callbacks.onEvidenceExport) {
          announce('Evidence export handler is not connected.');
        } else {
          void Promise.resolve(callbacks.onEvidenceExport(request)).then(() => announce('Evidence export requested.')).catch((error: unknown) => announce(error instanceof Error ? error.message : 'Evidence export failed.'));
        }
        break;
      }
      case 'frame-previous':
      case 'frame-next': {
        const frame = clamp((run.frame ?? Number(frameSlider.value)) + (action === 'frame-next' ? 1 : -1), 0, 4000);
        updateRunLifecycle({ ...run, state: run.state, frame });
        callbacks.onFrameSeek?.(frame);
        break;
      }
      case 'capture':
        root.dispatchEvent(new CustomEvent('engineering-capture-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
        announce(`Presentation capture requested for frame ${run.frame ?? 0}.`);
        break;
      case 'bookmark': {
        const frame = run.frame ?? Number(frameSlider.value);
        const host = required<HTMLElement>(root, '.eng-bookmarks');
        const existing = host.querySelector(`[data-eng-frame="${frame}"]`);
        if (!existing) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.engFrame = String(frame);
          button.innerHTML = `<span>${String(frame).padStart(5, '0')}</span><strong>Operator bookmark</strong>`;
          host.append(button);
        }
        announce(`Frame ${frame} bookmarked in this review session.`);
        break;
      }
      case 'auto-align': {
        const offset = root.querySelector<HTMLInputElement>('[data-eng-alignment-offset]');
        if (offset) offset.value = '0';
        announce('Alignment refreshed on the normalized input trigger. Offset is 0 samples.');
        break;
      }
      case 'update-agreement':
        root.dispatchEvent(new CustomEvent('engineering-correlation-refresh'));
        drawAllCharts();
        announce('Model-to-model agreement refreshed from the immutable baseline and selected compatible work revision.');
        break;
      case 'annotation':
        root.dispatchEvent(new CustomEvent('engineering-annotation-request', { detail: { workspace: activeWorkspace, frame: run.frame ?? 0 } }));
        announce(`Annotation marker added at frame ${run.frame ?? 0}.`);
        break;
      case 'orbit':
        root.dispatchEvent(new CustomEvent('engineering-orbit-request', { detail: { workspace: activeWorkspace } }));
        announce('Specimen view reset to the engineering camera profile.');
        break;
      case 'arm':
        if (run.state === 'armed') {
          void emitRunCommand('run');
        } else if (run.state === 'running') {
          void emitRunCommand('pause');
        } else if (run.state === 'paused') {
          void emitRunCommand('run');
        } else if (['complete', 'aborted', 'error'].includes(run.state)) {
          void emitRunCommand('reset').then(() => armDialog.showModal());
        } else armDialog.showModal();
        break;
      case 'confirm-arm':
        void emitRunCommand('arm');
        break;
      case 'complete':
        if (!['running', 'paused'].includes(run.state) || (run.step ?? 0) < 64) {
          announce('Capture needs at least 64 fixed-step samples before it can be accepted.');
        } else {
          void emitRunCommand('complete');
          announce('Capture review requested. The authoritative run will report its quality-control result.');
        }
        break;
      case 'abort':
        void emitRunCommand('abort');
        announce('Capture rejection requested.');
        break;
      case 'run':
        if (activeWorkspace === 'correlation') {
          announce('The reference is a final checkpoint image. Time-series visual replay is not available in this build.');
        } else {
          void emitRunCommand(run.state === 'running' ? 'pause' : 'run');
        }
        break;
      case 'replay':
        if (activeWorkspace === 'correlation') {
          updateTelemetry({ frame: 0 });
          callbacks.onFrameSeek?.(0);
          announce('Data cursor returned to the first recorded sample; the reference image remains a final checkpoint.');
        } else {
          void emitRunCommand('replay');
        }
        break;
      case 'reset':
        void emitRunCommand('reset');
        break;
      case 'step':
        options.testWorkspace.querySelector<HTMLButtonElement>('#step')?.click();
        break;
      case 'apply-force':
        void emitRunCommand('arm').then(() => {
          root.dispatchEvent(new CustomEvent('engineering-apply-force', { detail: { workspace: activeWorkspace } }));
        });
        break;
      case 'toggle-library':
        librarySheetOpen = !librarySheetOpen;
        materialLabLeftSlot.hidden = resolvedChrome() === 'compact' && !librarySheetOpen;
        announce(librarySheetOpen ? 'Simulation library open.' : 'Simulation library closed.');
        break;
      case 'toggle-inspector':
        if (adoptedRight) {
          const open = adoptedRight.hasAttribute('data-eng-sheet-open');
          if (open) adoptedRight.removeAttribute('data-eng-sheet-open');
          else adoptedRight.setAttribute('data-eng-sheet-open', 'true');
          announce(open ? 'Inspector closed.' : 'Inspector open.');
        }
        break;
      default:
        break;
    }
  }, eventOptions);

  root.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLTableRowElement>('[data-eng-case-id]') : null;
    if (!row) return;
    event.preventDefault();
    row.click();
  }, eventOptions);

  splitInput.addEventListener('input', () => setSplitValue(Number(splitInput.value)), eventOptions);
  splitHandle.addEventListener('keydown', (event) => {
    const increment = event.shiftKey ? 5 : 1;
    const current = Number(splitInput.value);
    const next = event.key === 'Home'
      ? Number(splitInput.min)
      : event.key === 'End'
        ? Number(splitInput.max)
        : event.key === 'ArrowLeft'
          ? current - increment
          : event.key === 'ArrowRight'
            ? current + increment
            : null;
    if (next === null) return;
    event.preventDefault();
    setSplitValue(next);
  }, eventOptions);
  const updateSplitFromPointer = (event: PointerEvent): void => {
    const bounds = mediaCompare.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setSplitValue((event.clientX - bounds.left) / bounds.width * 100);
  };
  splitHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    splitDragging = true;
    splitHandle.setPointerCapture(event.pointerId);
    updateSplitFromPointer(event);
  }, eventOptions);
  splitHandle.addEventListener('pointermove', (event) => {
    if (splitDragging) updateSplitFromPointer(event);
  }, eventOptions);
  const endSplitDrag = (event: PointerEvent): void => {
    splitDragging = false;
    if (splitHandle.hasPointerCapture(event.pointerId)) splitHandle.releasePointerCapture(event.pointerId);
  };
  splitHandle.addEventListener('pointerup', endSplitDrag, eventOptions);
  splitHandle.addEventListener('pointercancel', endSplitDrag, eventOptions);
  frameSlider.addEventListener('input', () => {
    const frame = Number(frameSlider.value);
    updateRunLifecycle({ ...run, state: run.state, frame });
    callbacks.onFrameSeek?.(frame);
  }, eventOptions);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (importKind === 'reference-media' && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
      referenceObjectUrl = URL.createObjectURL(file);
      setCorrelationReference({ kind: file.type.startsWith('video/') ? 'video' : 'image', src: referenceObjectUrl, label: file.name, provenance: 'imported' });
    }
    const request: EngineeringImportRequest = { workspace: 'correlation', kind: importKind, file };
    if (!callbacks.onFileImport) {
      announce(importKind === 'reference-media' ? `${file.name} preview loaded.` : 'Correlation data import handler is not connected.');
    } else {
      void Promise.resolve(callbacks.onFileImport(request)).then(() => announce(`${file.name} imported.`)).catch((error: unknown) => announce(error instanceof Error ? error.message : 'Import failed.'));
    }
  }, eventOptions);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawAllCharts());
  for (const canvas of canvasByChart.values()) resizeObserver?.observe(canvas);
  const onChromeQuery = (): void => {
    if (chromePreference !== 'auto' || destroyed) return;
    syncLayoutDom();
    moveAttachedViewport(activeWorkspace);
  };
  compactQuery?.addEventListener('change', onChromeQuery, eventOptions);

  globalThis.addEventListener(FIRST_RUN_GUIDE_CHANGED_EVENT, () => {
    if (destroyed) return;
    if (firstRunGuide?.dismissed) {
      firstRunGuide = null;
    }
    syncFirstRunGuide();
  }, eventOptions);

  if (options.projectLabel) for (const node of root.querySelectorAll<HTMLElement>('[data-eng-project]')) node.textContent = options.projectLabel;
  if (options.testLabel) for (const node of root.querySelectorAll<HTMLElement>('[data-eng-test]')) node.textContent = options.testLabel;
  setCorrelationCases(DEFAULT_CASES, activeCaseId);
  setSplitValue(Number(splitInput.value));
  if (options.viewport) attachViewport(options.viewport);
  setWorkspace(activeWorkspace, { announce: false });
  if (requestedConcept) setConceptView(requestedConcept, { announce: false });
  updateRunLifecycle(run);
  requestPlayAfterLoad();
  window.requestAnimationFrame(drawAllCharts);

  return {
    root,
    getWorkspace: () => activeWorkspace,
    setWorkspace,
    getLayout: () => activeLayout,
    setLayout,
    getChrome: () => resolvedChrome(),
    setChrome,
    getConceptView: () => currentConceptView(),
    setConceptView,
    getFieldView: () => activeFieldView,
    setFieldView,
    getMaterialTab: () => activeMaterialTab,
    setMaterialTab,
    getRegion,
    attachViewport,
    moveViewport: (workspace = activeWorkspace) => moveAttachedViewport(workspace),
    setActiveLab,
    updateTelemetry,
    updateRunLifecycle,
    updateChart,
    setCorrelationCases,
    setCorrelationReference,
    setCorrelationWorkSnapshot,
    updateModalCaptures,
    setProvenance,
    setPointerMode,
    setForceAvailable,
    setPlaybackStarted,
    getSimpleUi: () => simpleUi,
    setSimpleUi,
    setFileImportCallback: (callback) => { callbacks = { ...callbacks, onFileImport: callback }; },
    setEvidenceExportCallback: (callback) => { callbacks = { ...callbacks, onEvidenceExport: callback }; },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      resizeObserver?.disconnect();
      materialLabDesktop?.destroy();
      materialLabMobile?.destroy();
      physicsStructural?.destroy();
      physicsCorrelation?.destroy();
      physicsFieldModal?.destroy();
      firstRunGuide?.destroy();
      materialLabDesktop = null;
      materialLabMobile = null;
      physicsStructural = null;
      physicsCorrelation = null;
      physicsFieldModal = null;
      firstRunGuide = null;
      restoreWorkspaceMenu();
      if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
      if (adoptedHeader) adoptedHeader.hidden = false;
      options.testWorkspace.hidden = false;
      options.testWorkspace.classList.remove('eng-app-data-source');
      for (const home of adoptedHomes) home.parent.insertBefore(home.node, home.next);
      if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
      viewport?.classList.remove('eng-attached-viewport');
      if (testMarker.parentNode) testMarker.parentNode.insertBefore(options.testWorkspace, testMarker.nextSibling);
      viewportMarker?.remove();
      testMarker.remove();
      root.remove();
    },
  };
}
