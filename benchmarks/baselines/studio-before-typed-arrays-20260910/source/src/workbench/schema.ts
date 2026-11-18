import type { ConceptWorkspaceId } from '../types';

/** Stable categories used by the curated interactive workbench. */
export const WORKBENCH_GROUPS = [
  'materials',
  'cloth',
  'rope',
  'water',
  'rigid',
  'combined',
] as const;

export type WorkbenchGroup = (typeof WORKBENCH_GROUPS)[number];

export const WORKBENCH_GROUP_LABELS: Readonly<Record<WorkbenchGroup, string>> = {
  materials: 'Material Mechanics',
  cloth: 'Cloth & Membranes',
  rope: 'Ropes & Rigging',
  water: 'Water Dynamics',
  rigid: 'Rigid-Body Systems',
  combined: 'Composite Laboratory',
};

/** Numerical authority behind a lab. WebGPU presents these states; it does not solve them. */
export const WORKBENCH_SOLVERS = [
  'material-lattice',
  'pbd-cloth',
  'pbd-rope',
  'shallow-water',
  'box3d-rigid',
  'combined-material',
] as const;

export type WorkbenchSolver = (typeof WORKBENCH_SOLVERS)[number];

export const WORKBENCH_SOLVER_LABELS: Readonly<Record<WorkbenchSolver, string>> = {
  'material-lattice': 'Reduced-order beam lattice',
  'pbd-cloth': 'Position-based cloth',
  'pbd-rope': 'Position-based rope',
  'shallow-water': 'Linear 2.5D shallow water',
  'box3d-rigid': 'Box3D rigid bodies',
  'combined-material': 'Three-rig material coordinator',
};

/**
 * Fidelity describes the numerical claim, not the rendering quality. Dust,
 * sparks, foam, spray, coating flakes, and shard glints remain presentation.
 */
export const WORKBENCH_FIDELITIES = [
  'Reduced numerical model',
  'Numerical PBD model',
  'Numerical 2.5D model',
  'Numerical + proxy coupling',
  'Rigid-body proxy',
  'Independent numerical rigs',
] as const;

export type WorkbenchFidelity = (typeof WORKBENCH_FIDELITIES)[number];

export const WORKBENCH_FORCE_MODES = [
  'actuator-load',
  'release-load',
  'cycle-load',
  'material-strike',
  'broad-impulse',
  'radial-blast',
  'projectile',
  'impact-rain',
] as const;

export type WorkbenchForceMode = (typeof WORKBENCH_FORCE_MODES)[number];

export const WORKBENCH_PARAMETER_IDS = [
  'time-scale',
  'actuator-target',
  'material-strike-strength',
  'material-strike-radius',
  'impulse-strength',
  'blast-strength',
  'blast-radius',
  'projectile-speed',
  'projectile-size',
  'rain-count',
] as const;

export type WorkbenchParameterId = (typeof WORKBENCH_PARAMETER_IDS)[number];

/**
 * `wired` means the current application already exposes the value. A
 * `solver-argument` is still a truthful live value: the numerical API accepts
 * it today, but the current shell supplies a hard-coded value.
 */
export type WorkbenchParameterAvailability = 'wired' | 'solver-argument';

export type WorkbenchLiveParameter = {
  readonly id: WorkbenchParameterId;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly unit: string;
  readonly valueKind: 'continuous' | 'integer';
  readonly availability: WorkbenchParameterAvailability;
};

export type WorkbenchSceneTarget = {
  readonly sceneId: number;
  readonly materialDemoId?: never;
};

export type WorkbenchMaterialTarget = {
  readonly materialDemoId: string;
  readonly sceneId?: never;
};

export type WorkbenchLabTarget = WorkbenchSceneTarget | WorkbenchMaterialTarget;

export type WorkbenchLabDefinition = WorkbenchLabTarget & {
  readonly id: string;
  readonly title: string;
  readonly shortName: string;
  readonly group: WorkbenchGroup;
  readonly solver: WorkbenchSolver;
  readonly fidelity: WorkbenchFidelity;
  readonly description: string;
  readonly forceModes: readonly WorkbenchForceMode[];
  readonly liveParameters: readonly WorkbenchLiveParameter[];
};

export type WorkbenchLabFilter = {
  readonly group?: WorkbenchGroup;
  readonly solver?: WorkbenchSolver;
  readonly fidelity?: WorkbenchFidelity;
  readonly forceMode?: WorkbenchForceMode;
  readonly query?: string;
};

/** Compile-time exhaustiveness helper for discriminated unions and const enums. */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled workbench variant: ${String(value)}`);
}

/**
 * Concept-workspace contracts. These types describe the four reference UIs
 * without changing the 31-lab catalog or existing lab-definition fields.
 *
 * materialLab         material-lab-desktop.png (1586×992), material-lab-mobile.png (853×1844)
 * physicsStructural   physics-workbench-structural-v2.png (1672×941)
 * physicsCorrelation  physics-workbench-correlation-v2.png (1672×941)
 * physicsFieldModal   physics-workbench-field-modal-v2.png (1024×1536)
 */
export const WORKSPACE_KINDS = [
  'materialLab',
  'physicsStructural',
  'physicsCorrelation',
  'physicsFieldModal',
] as const;

export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_KIND_LABELS: Readonly<Record<WorkspaceKind, string>> = {
  materialLab: 'Material Lab',
  physicsStructural: 'Structural Test',
  physicsCorrelation: 'Correlation Review',
  physicsFieldModal: 'Field Modal',
};

/** Current shell ids (`test` / `correlation` / `field`) mapped onto concept kinds. */
export const LEGACY_WORKSPACE_IDS = ['test', 'correlation', 'field'] as const;
export type LegacyWorkspaceId = (typeof LEGACY_WORKSPACE_IDS)[number];

export const LEGACY_WORKSPACE_KIND: Readonly<Record<LegacyWorkspaceId, WorkspaceKind>> = {
  test: 'physicsStructural',
  correlation: 'physicsCorrelation',
  field: 'physicsFieldModal',
};

/** Schema camelCase kinds ↔ `ConceptWorkspaceId` kebab ids. Layout-specific PNG ids live in the registry. */
export const WORKSPACE_KIND_TO_CONCEPT_WORKSPACE = {
  materialLab: 'material-lab',
  physicsStructural: 'structural-test',
  physicsCorrelation: 'correlation-review',
  physicsFieldModal: 'field-modal',
} as const satisfies Record<WorkspaceKind, ConceptWorkspaceId>;

export const CONCEPT_WORKSPACE_TO_KIND = {
  'material-lab': 'materialLab',
  'structural-test': 'physicsStructural',
  'correlation-review': 'physicsCorrelation',
  'field-modal': 'physicsFieldModal',
} as const satisfies Record<ConceptWorkspaceId, WorkspaceKind>;

export type WorkspaceConceptAsset = {
  readonly kind: WorkspaceKind;
  readonly title: string;
  readonly assets: readonly string[];
  readonly viewports: readonly {
    readonly id: 'desktop' | 'phone' | 'portrait';
    readonly width: number;
    readonly height: number;
  }[];
};

export const WORKSPACE_CONCEPTS = [
  {
    kind: 'materialLab',
    title: 'Material Lab',
    assets: [
      'public/concepts/material-lab-desktop.png',
      'public/concepts/material-lab-mobile.png',
    ],
    viewports: [
      { id: 'desktop', width: 1586, height: 992 },
      { id: 'phone', width: 853, height: 1844 },
    ],
  },
  {
    kind: 'physicsStructural',
    title: 'Physics Testing Workbench',
    assets: ['public/concepts/physics-workbench-structural-v2.png'],
    viewports: [{ id: 'desktop', width: 1672, height: 941 }],
  },
  {
    kind: 'physicsCorrelation',
    title: 'Correlation Review',
    assets: ['public/concepts/physics-workbench-correlation-v2.png'],
    viewports: [{ id: 'desktop', width: 1672, height: 941 }],
  },
  {
    kind: 'physicsFieldModal',
    title: 'Field Modal Test',
    assets: ['public/concepts/physics-workbench-field-modal-v2.png'],
    viewports: [{ id: 'portrait', width: 1024, height: 1536 }],
  },
] as const satisfies readonly WorkspaceConceptAsset[];

export const WORKBENCH_PROVENANCES = [
  'solver-native',
  'derived-normalized',
  'deterministic-reference',
  'imported-test',
  'presentation-only',
] as const;

export type WorkbenchProvenance = (typeof WORKBENCH_PROVENANCES)[number];

export const WORKBENCH_PROVENANCE_LABELS: Readonly<Record<WorkbenchProvenance, string>> = {
  'solver-native': 'Solver-native',
  'derived-normalized': 'Derived · normalized',
  'deterministic-reference': 'Deterministic reference',
  'imported-test': 'Imported test',
  'presentation-only': 'Presentation only',
};

/**
 * `wired` is already on the live shell. `analysis-planned` is specified by the
 * workbench v2 analysis worker. `concept-only` appears on a mockup but must not
 * be treated as hardware, DAQ, or a calibrated engineering claim.
 */
export type ConceptFieldAvailability = 'wired' | 'analysis-planned' | 'concept-only';

export const EXPERIMENT_PHASES = [
  'draft',
  'preflight',
  'armed',
  'running',
  'paused',
  'completed',
  'aborted',
] as const;

export type ExperimentPhase = (typeof EXPERIMENT_PHASES)[number];

export type WorkbenchCapabilities = {
  readonly structuralTest: true;
  readonly correlation: boolean;
  readonly pointForce: boolean;
  readonly loadControl: boolean;
  readonly renderCheckpointHz: 10 | 30;
  readonly modalAnalysis: 'none' | 'analysis-only-cantilever';
};

export const MATERIAL_LAB_PANEL_IDS = [
  'material-header',
  'material-library',
  'material-viewport',
  'material-force',
  'material-material',
  'material-solver',
  'material-transport',
  'material-chart-force',
  'material-chart-energy',
  'material-chart-stress',
  'material-mobile-nav',
] as const;

export type MaterialLabPanelId = (typeof MATERIAL_LAB_PANEL_IDS)[number];

export const STRUCTURAL_PANEL_IDS = [
  'structural-header',
  'structural-experiment',
  'structural-sensors',
  'structural-revisions',
  'structural-viewport',
  'structural-timeline',
  'structural-chart-force-displacement',
  'structural-chart-energy',
  'structural-load-case',
  'structural-material',
  'structural-solver',
  'structural-run-log',
  'structural-status',
] as const;

export type StructuralPanelId = (typeof STRUCTURAL_PANEL_IDS)[number];

export const CORRELATION_PANEL_IDS = [
  'correlation-header',
  'correlation-case-matrix',
  'correlation-channels',
  'correlation-bookmarks',
  'correlation-checklist',
  'correlation-reference-viewport',
  'correlation-candidate-viewport',
  'correlation-transport',
  'correlation-chart-force',
  'correlation-chart-energy',
  'correlation-chart-residual',
  'correlation-alignment',
  'correlation-solver',
  'correlation-contact',
  'correlation-model',
  'correlation-uncertainty',
  'correlation-controls',
  'correlation-evidence',
  'correlation-status',
] as const;

export type CorrelationPanelId = (typeof CORRELATION_PANEL_IDS)[number];

export const FIELD_MODAL_PANEL_IDS = [
  'field-header',
  'field-viewport',
  'field-state',
  'field-acquisition',
  'field-channel-health',
  'field-preflight',
  'field-actions',
  'field-chart-frequency',
  'field-chart-coherence',
  'field-captures',
  'field-nav',
] as const;

export type FieldModalPanelId = (typeof FIELD_MODAL_PANEL_IDS)[number];

export type WorkbenchPanelId =
  | MaterialLabPanelId
  | StructuralPanelId
  | CorrelationPanelId
  | FieldModalPanelId;

export type WorkbenchPanelRef =
  | { readonly workspace: 'materialLab'; readonly id: MaterialLabPanelId }
  | { readonly workspace: 'physicsStructural'; readonly id: StructuralPanelId }
  | { readonly workspace: 'physicsCorrelation'; readonly id: CorrelationPanelId }
  | { readonly workspace: 'physicsFieldModal'; readonly id: FieldModalPanelId };

export const MATERIAL_LAB_PANEL_LABELS: Readonly<Record<MaterialLabPanelId, string>> = {
  'material-header': 'Product header',
  'material-library': 'Simulation library',
  'material-viewport': 'Specimen viewport',
  'material-force': 'Force inspector',
  'material-material': 'Material inspector',
  'material-solver': 'Solver inspector',
  'material-transport': 'Transport',
  'material-chart-force': 'Force sparkline',
  'material-chart-energy': 'Energy sparkline',
  'material-chart-stress': 'Response sparkline',
  'material-mobile-nav': 'Force / Material / Solver tabs',
};

export const STRUCTURAL_PANEL_LABELS: Readonly<Record<StructuralPanelId, string>> = {
  'structural-header': 'Status header',
  'structural-experiment': 'Experiment tree',
  'structural-sensors': 'Sensor channels',
  'structural-revisions': 'Revision history',
  'structural-viewport': 'Test-cell viewport',
  'structural-timeline': 'Run timeline',
  'structural-chart-force-displacement': 'Force vs displacement',
  'structural-chart-energy': 'Normalized energy',
  'structural-load-case': 'Load case',
  'structural-material': 'Material',
  'structural-solver': 'Solver',
  'structural-run-log': 'Run log',
  'structural-status': 'Status strip',
};

export const CORRELATION_PANEL_LABELS: Readonly<Record<CorrelationPanelId, string>> = {
  'correlation-header': 'Case header',
  'correlation-case-matrix': 'Case matrix',
  'correlation-channels': 'Channels',
  'correlation-bookmarks': 'Frame bookmarks',
  'correlation-checklist': 'Checklist',
  'correlation-reference-viewport': 'Reference pane',
  'correlation-candidate-viewport': 'Candidate pane',
  'correlation-transport': 'Shared transport',
  'correlation-chart-force': 'Response history',
  'correlation-chart-energy': 'Energy proxy',
  'correlation-chart-residual': 'Residual',
  'correlation-alignment': 'Alignment',
  'correlation-solver': 'Solver provenance',
  'correlation-contact': 'Contact scope',
  'correlation-model': 'Model definition',
  'correlation-uncertainty': 'Uncertainty',
  'correlation-controls': 'Comparison controls',
  'correlation-evidence': 'Evidence summary',
  'correlation-status': 'Status strip',
};

export const FIELD_MODAL_PANEL_LABELS: Readonly<Record<FieldModalPanelId, string>> = {
  'field-header': 'Synchronized header',
  'field-viewport': 'Cantilever viewport',
  'field-state': 'Model state',
  'field-acquisition': 'Acquisition settings',
  'field-channel-health': 'Response taps',
  'field-preflight': 'Preflight strip',
  'field-actions': 'Arm / abort',
  'field-chart-frequency': 'Frequency response',
  'field-chart-coherence': 'Coherence',
  'field-captures': 'Capture strip',
  'field-nav': 'Run / Channels / Modes / Notes',
};

export const STRUCTURAL_METRICS = [
  {
    id: 'normalized-force',
    label: 'Normalized force',
    quantity: 'force',
    unit: 'normalized',
    provenance: 'derived-normalized',
    conceptHint: 'Force (kN) on the structural and material-lab boards',
  },
  {
    id: 'normalized-load-progress',
    label: 'Load progress',
    quantity: 'load',
    unit: 'ratio',
    provenance: 'solver-native',
    conceptHint: 'Actuator / hold progress toward the authored target',
  },
  {
    id: 'displacement',
    label: 'Displacement',
    quantity: 'displacement',
    unit: 'simulation-unit',
    provenance: 'derived-normalized',
    conceptHint: 'LVDT-01 (mm) on the structural board',
  },
  {
    id: 'peak-deflection',
    label: 'Peak deflection',
    quantity: 'displacement',
    unit: 'simulation-unit',
    provenance: 'derived-normalized',
    conceptHint: 'Peak punch / centerline displacement',
  },
  {
    id: 'residual-deflection',
    label: 'Residual deflection',
    quantity: 'displacement',
    unit: 'simulation-unit',
    provenance: 'derived-normalized',
    conceptHint: 'Retained dent after unload',
  },
  {
    id: 'strain-xx',
    label: 'Normalized strain XX',
    quantity: 'strain',
    unit: 'strain',
    provenance: 'derived-normalized',
    conceptHint: 'Strain XX (με) / DIC-01 on the structural board',
  },
  {
    id: 'strain-yy',
    label: 'Normalized strain YY',
    quantity: 'strain',
    unit: 'strain',
    provenance: 'derived-normalized',
    conceptHint: 'Strain YY (με) on the structural board',
  },
  {
    id: 'strain-xy',
    label: 'Normalized strain XY',
    quantity: 'strain',
    unit: 'strain',
    provenance: 'derived-normalized',
    conceptHint: 'Strain XY (με) on the structural board',
  },
  {
    id: 'max-normalized-strain',
    label: 'Peak normalized strain',
    quantity: 'strain',
    unit: 'strain',
    provenance: 'derived-normalized',
    conceptHint: 'Max Stress (MPa) sparkline on the material-lab board',
  },
  {
    id: 'normalized-energy',
    label: 'Normalized energy',
    quantity: 'energy',
    unit: 'normalized-energy',
    provenance: 'derived-normalized',
    conceptHint: 'Strain Energy (J) / Energy (kJ) charts',
  },
  {
    id: 'failure-phase',
    label: 'Failure phase',
    quantity: 'phase',
    unit: 'none',
    provenance: 'solver-native',
    phases: ['elastic', 'yielding', 'fracturing', 'failed'],
  },
  {
    id: 'break-count',
    label: 'Broken constraints',
    quantity: 'count',
    unit: 'count',
    provenance: 'solver-native',
  },
  {
    id: 'fragment-count',
    label: 'Fragment count',
    quantity: 'count',
    unit: 'count',
    provenance: 'solver-native',
  },
  {
    id: 'body-count',
    label: 'Body count',
    quantity: 'count',
    unit: 'count',
    provenance: 'solver-native',
  },
  {
    id: 'node-count',
    label: 'Node count',
    quantity: 'count',
    unit: 'count',
    provenance: 'solver-native',
  },
  {
    id: 'replay-hash',
    label: 'Replay hash',
    quantity: 'hash',
    unit: 'hash',
    provenance: 'solver-native',
  },
] as const;

export type StructuralMetric = (typeof STRUCTURAL_METRICS)[number];
export type StructuralMetricId = StructuralMetric['id'];

export const STRUCTURAL_LOAD_CASE_FIELDS = [
  {
    id: 'case-name',
    label: 'Load case name',
    valueKind: 'text',
    availability: 'wired',
    conceptHint: 'ARM TEST on the structural board',
  },
  {
    id: 'control-mode',
    label: 'Control mode',
    valueKind: 'enum',
    availability: 'wired',
    options: ['normalized-actuator', 'point-strike', 'broad-impulse', 'projectile'],
    conceptHint: 'Displacement Control on the structural board',
  },
  {
    id: 'target',
    label: 'Normalized target',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'wired',
    conceptHint: 'Target Displacement 5.000 mm',
  },
  {
    id: 'loading-rate',
    label: 'Time scale',
    valueKind: 'enum',
    availability: 'wired',
    options: ['0.25', '0.5', '1', '2'],
    conceptHint: 'Loading Rate 0.500 mm/s',
  },
  {
    id: 'hold-at-peak',
    label: 'Hold at peak',
    valueKind: 'continuous',
    unit: 's',
    availability: 'analysis-planned',
    conceptHint: 'Hold at Peak 2.000 s',
  },
  {
    id: 'abort-max-load',
    label: 'Max normalized load',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'analysis-planned',
    conceptHint: 'Abort Max Force 25.00 kN',
  },
  {
    id: 'abort-max-displacement',
    label: 'Max displacement',
    valueKind: 'continuous',
    unit: 'simulation-unit',
    availability: 'analysis-planned',
    conceptHint: 'Abort Max Displacement 6.000 mm',
  },
  {
    id: 'abort-max-strain',
    label: 'Max normalized strain',
    valueKind: 'continuous',
    unit: 'strain',
    availability: 'analysis-planned',
    conceptHint: 'Abort Max Strain |XX| 1000 με',
  },
  {
    id: 'simulation-limits',
    label: 'Simulation limits',
    valueKind: 'status',
    availability: 'wired',
    conceptHint: 'Safety Interlock on the structural board; product name is Simulation Limits',
  },
] as const;

export type StructuralLoadCaseField = (typeof STRUCTURAL_LOAD_CASE_FIELDS)[number];
export type StructuralLoadCaseFieldId = StructuralLoadCaseField['id'];

export const CORRELATION_SERIES = [
  {
    id: 'reference',
    role: 'baseline',
    label: 'REFERENCE',
    importedLabel: 'TEST',
    provenance: 'deterministic-reference',
    style: 'solid',
    conceptHint: 'Test / Measured (blue) on correlation and structural charts',
  },
  {
    id: 'candidate',
    role: 'comparison',
    label: 'CANDIDATE',
    importedLabel: 'CANDIDATE',
    provenance: 'derived-normalized',
    style: 'solid',
    conceptHint: 'Sim (corr) / Simulation (magenta or dashed white)',
  },
  {
    id: 'uncertainty-band',
    role: 'envelope',
    label: 'Uncertainty',
    importedLabel: 'Uncertainty (±2σ)',
    provenance: 'imported-test',
    style: 'band',
    sigma: 2,
    visibleWhen: 'imported-uncertainty',
    conceptHint: 'Grey ±2σ band; hidden unless imported evidence supplies uncertainty',
  },
  {
    id: 'residual',
    role: 'derived',
    label: 'Residual',
    importedLabel: 'Residual',
    provenance: 'derived-normalized',
    style: 'solid',
    conceptHint: 'Force Residual chart; residual is candidate − reference',
  },
  {
    id: 'energy-proxy',
    role: 'balance',
    label: 'Energy proxy',
    importedLabel: 'Energy proxy',
    provenance: 'derived-normalized',
    style: 'solid',
    conceptHint: 'Energy Balance / Absorbed donut on the correlation board',
  },
] as const;

export type CorrelationSeries = (typeof CORRELATION_SERIES)[number];
export type CorrelationSeriesId = CorrelationSeries['id'];

export const CORRELATION_ALIGNMENT_METHODS = [
  'event-trigger',
  'bounded-cross-correlation',
  'manual',
] as const;

export type CorrelationAlignmentMethod = (typeof CORRELATION_ALIGNMENT_METHODS)[number];

export const FIELD_MODAL_VIEWS = ['run', 'channels', 'modes', 'notes'] as const;
export type FieldModalViewId = (typeof FIELD_MODAL_VIEWS)[number];

export const FIELD_MODAL_PROBE_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;
export type FieldModalProbeId = (typeof FIELD_MODAL_PROBE_IDS)[number];

export const FIELD_MODAL_CAPTURE_STATES = ['empty', 'armed', 'accepted', 'rejected'] as const;
export type FieldModalCaptureState = (typeof FIELD_MODAL_CAPTURE_STATES)[number];

export const FIELD_MODAL_WINDOWS = ['hann'] as const;
export type FieldModalWindow = (typeof FIELD_MODAL_WINDOWS)[number];

export const FIELD_MODAL_PROBES = [
  { id: 'p1', label: 'P1', conceptLabel: 'A1', u: 0.08, v: 0.5, component: 'normal' },
  { id: 'p2', label: 'P2', conceptLabel: 'A2', u: 0.28, v: 0.5, component: 'normal' },
  { id: 'p3', label: 'P3', conceptLabel: 'A3', u: 0.48, v: 0.5, component: 'normal' },
  { id: 'p4', label: 'P4', conceptLabel: 'A4', u: 0.68, v: 0.5, component: 'normal' },
  { id: 'p5', label: 'P5', conceptLabel: 'A5', u: 0.88, v: 0.5, component: 'normal' },
] as const;

export type FieldModalProbe = (typeof FIELD_MODAL_PROBES)[number];

export const FIELD_MODAL_FIELDS = [
  {
    id: 'trigger-threshold',
    label: 'Trigger',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'concept-only',
    conceptHint: 'TRIGGER 25.0 mV POS PEAK; product uses a normalized tip impulse',
  },
  {
    id: 'trigger-polarity',
    label: 'Trigger polarity',
    valueKind: 'enum',
    availability: 'concept-only',
    options: ['pos-peak', 'neg-peak', 'absolute'],
  },
  {
    id: 'input-range',
    label: 'Declared input range',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'wired',
    conceptHint: 'INPUT RANGE ±10 V; product range is 0–40 normalized impulse',
  },
  {
    id: 'averaging-count',
    label: 'Averaging count',
    valueKind: 'integer',
    availability: 'analysis-planned',
    conceptHint: 'AVERAGING 8 LINEAR',
  },
  {
    id: 'averaging-method',
    label: 'Averaging method',
    valueKind: 'enum',
    availability: 'analysis-planned',
    options: ['linear', 'exponential'],
  },
  {
    id: 'sample-rate',
    label: 'Sample rate',
    valueKind: 'integer',
    unit: 'model-Hz',
    availability: 'analysis-planned',
    defaultValue: 480,
    conceptHint: '12.5 kS/s on the board; analysis worker uses 480 simulation samples/s',
  },
  {
    id: 'sample-count',
    label: 'Sample count',
    valueKind: 'integer',
    availability: 'analysis-planned',
    defaultValue: 4096,
  },
  {
    id: 'window',
    label: 'Window',
    valueKind: 'enum',
    availability: 'wired',
    options: ['hann'],
  },
  {
    id: 'coherence-threshold',
    label: 'Coherence threshold',
    valueKind: 'continuous',
    unit: 'ratio',
    availability: 'analysis-planned',
    defaultValue: 0.8,
    conceptHint: 'COHERENCE THRESHOLD 0.80 dashed line',
  },
  {
    id: 'anti-alias-cutoff',
    label: 'Anti-alias cutoff',
    valueKind: 'continuous',
    unit: 'model-Hz',
    availability: 'concept-only',
    conceptHint: 'ANTI-ALIAS FILTER 5.0 kHz; no physical DAQ filter is connected',
  },
  {
    id: 'calibration',
    label: 'Calibration',
    valueKind: 'status',
    availability: 'concept-only',
    conceptHint: 'CALIBRATION Exp: 2025-12-31; shown only with imported-test evidence',
  },
  {
    id: 'model-build',
    label: 'Model build',
    valueKind: 'status',
    availability: 'wired',
    conceptHint: 'DIGITAL TWIN REV 1.2.0 Deterministic',
  },
  {
    id: 'impact-u',
    label: 'Impact u',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'analysis-planned',
    defaultValue: 0.94,
  },
  {
    id: 'impact-v',
    label: 'Impact v',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'analysis-planned',
    defaultValue: 0.5,
  },
  {
    id: 'impact-strength',
    label: 'Impact strength',
    valueKind: 'continuous',
    unit: 'normalized',
    availability: 'wired',
    conceptHint: 'IMPACT marker at the free end',
  },
  {
    id: 'selected-mode',
    label: 'Selected mode',
    valueKind: 'integer',
    availability: 'analysis-planned',
    conceptHint: 'MODE 1 • BENDING overlay',
  },
  {
    id: 'capture-slot',
    label: 'Capture slot',
    valueKind: 'integer',
    availability: 'wired',
    min: 0,
    max: 5,
    conceptHint: 'Six-slot EVENT / CAPTURE STRIP',
  },
  {
    id: 'field-view',
    label: 'Field view',
    valueKind: 'enum',
    availability: 'wired',
    options: ['run', 'channels', 'modes', 'notes'],
  },
] as const;

export type FieldModalField = (typeof FIELD_MODAL_FIELDS)[number];
export type FieldModalFieldId = FieldModalField['id'];

export const FIELD_MODAL_METRICS = [
  {
    id: 'frequency',
    label: 'Simulation frequency',
    unit: 'model-Hz',
    provenance: 'derived-normalized',
    conceptHint: 'f1 = 128.7 Hz; live value comes from the analysis worker',
  },
  {
    id: 'damping-ratio',
    label: 'Damping ratio',
    unit: 'ratio',
    provenance: 'derived-normalized',
    conceptHint: 'ζ1 = 0.52%; Unavailable when half-power crossings are absent',
  },
  {
    id: 'mac',
    label: 'MAC',
    unit: 'ratio',
    provenance: 'derived-normalized',
    conceptHint: 'MAC (pred vs actual): 0.93; null without a prior compatible capture',
  },
  {
    id: 'coherence',
    label: 'Coherence',
    unit: 'ratio',
    provenance: 'derived-normalized',
    conceptHint: 'A5 / Impact coherence chart',
  },
  {
    id: 'displacement-amplitude',
    label: 'Displacement amplitude',
    unit: 'simulation-unit',
    provenance: 'derived-normalized',
    conceptHint: 'DISP AMP (µm) legend on the cantilever',
  },
] as const;

export type FieldModalMetric = (typeof FIELD_MODAL_METRICS)[number];
export type FieldModalMetricId = FieldModalMetric['id'];

export type MaterialLabWorkspace = {
  readonly kind: 'materialLab';
  readonly title: 'Material Lab';
  readonly panels: typeof MATERIAL_LAB_PANEL_IDS;
  readonly inspectorTabs: readonly ['force', 'material', 'solver'];
  readonly shellTabs: readonly ['lab', 'compare', 'captures'];
  readonly metrics: readonly StructuralMetricId[];
  readonly mobileNav: readonly ['force', 'material', 'solver'];
};

export type PhysicsStructuralWorkspace = {
  readonly kind: 'physicsStructural';
  readonly title: 'Structural Test';
  readonly panels: typeof STRUCTURAL_PANEL_IDS;
  readonly inspectorTabs: readonly ['load-case', 'material', 'solver'];
  readonly metrics: readonly StructuralMetricId[];
  readonly loadCaseFields: typeof STRUCTURAL_LOAD_CASE_FIELDS;
  readonly series: readonly CorrelationSeriesId[];
};

export type PhysicsCorrelationWorkspace = {
  readonly kind: 'physicsCorrelation';
  readonly title: 'Correlation Review';
  readonly panels: typeof CORRELATION_PANEL_IDS;
  readonly series: typeof CORRELATION_SERIES;
  readonly alignmentMethods: typeof CORRELATION_ALIGNMENT_METHODS;
  readonly metrics: readonly StructuralMetricId[];
};

export type PhysicsFieldModalWorkspace = {
  readonly kind: 'physicsFieldModal';
  readonly title: 'Field Modal';
  readonly panels: typeof FIELD_MODAL_PANEL_IDS;
  readonly fields: typeof FIELD_MODAL_FIELDS;
  readonly probes: typeof FIELD_MODAL_PROBES;
  readonly views: typeof FIELD_MODAL_VIEWS;
  readonly metrics: typeof FIELD_MODAL_METRICS;
  readonly captureSlotCount: 6;
  readonly impact: { readonly u: number; readonly v: number };
};

export type WorkbenchWorkspace =
  | MaterialLabWorkspace
  | PhysicsStructuralWorkspace
  | PhysicsCorrelationWorkspace
  | PhysicsFieldModalWorkspace;

const MATERIAL_LAB_WORKSPACE: MaterialLabWorkspace = {
  kind: 'materialLab',
  title: 'Material Lab',
  panels: MATERIAL_LAB_PANEL_IDS,
  inspectorTabs: ['force', 'material', 'solver'],
  shellTabs: ['lab', 'compare', 'captures'],
  metrics: ['normalized-force', 'normalized-energy', 'max-normalized-strain'],
  mobileNav: ['force', 'material', 'solver'],
};

const STRUCTURAL_WORKSPACE: PhysicsStructuralWorkspace = {
  kind: 'physicsStructural',
  title: 'Structural Test',
  panels: STRUCTURAL_PANEL_IDS,
  inspectorTabs: ['load-case', 'material', 'solver'],
  metrics: [
    'normalized-force',
    'normalized-load-progress',
    'displacement',
    'peak-deflection',
    'residual-deflection',
    'strain-xx',
    'strain-yy',
    'strain-xy',
    'max-normalized-strain',
    'normalized-energy',
    'failure-phase',
    'break-count',
    'fragment-count',
    'replay-hash',
  ],
  loadCaseFields: STRUCTURAL_LOAD_CASE_FIELDS,
  series: ['reference', 'candidate'],
};

const CORRELATION_WORKSPACE: PhysicsCorrelationWorkspace = {
  kind: 'physicsCorrelation',
  title: 'Correlation Review',
  panels: CORRELATION_PANEL_IDS,
  series: CORRELATION_SERIES,
  alignmentMethods: CORRELATION_ALIGNMENT_METHODS,
  metrics: [
    'normalized-force',
    'displacement',
    'normalized-energy',
    'replay-hash',
  ],
};

const FIELD_MODAL_WORKSPACE: PhysicsFieldModalWorkspace = {
  kind: 'physicsFieldModal',
  title: 'Field Modal',
  panels: FIELD_MODAL_PANEL_IDS,
  fields: FIELD_MODAL_FIELDS,
  probes: FIELD_MODAL_PROBES,
  views: FIELD_MODAL_VIEWS,
  metrics: FIELD_MODAL_METRICS,
  captureSlotCount: 6,
  impact: { u: 0.94, v: 0.5 },
};

export function workspaceKindLabel(kind: WorkspaceKind): string {
  switch (kind) {
    case 'materialLab':
    case 'physicsStructural':
    case 'physicsCorrelation':
    case 'physicsFieldModal':
      return WORKSPACE_KIND_LABELS[kind];
    default:
      return assertNever(kind);
  }
}

export function workspaceKindFromLegacyId(id: LegacyWorkspaceId): WorkspaceKind {
  switch (id) {
    case 'test':
      return 'physicsStructural';
    case 'correlation':
      return 'physicsCorrelation';
    case 'field':
      return 'physicsFieldModal';
    default:
      return assertNever(id);
  }
}

export function conceptWorkspaceIdFromKind(kind: WorkspaceKind): ConceptWorkspaceId {
  switch (kind) {
    case 'materialLab':
    case 'physicsStructural':
    case 'physicsCorrelation':
    case 'physicsFieldModal':
      return WORKSPACE_KIND_TO_CONCEPT_WORKSPACE[kind];
    default:
      return assertNever(kind);
  }
}

export function workspaceKindFromConceptWorkspaceId(id: ConceptWorkspaceId): WorkspaceKind {
  switch (id) {
    case 'material-lab':
    case 'structural-test':
    case 'correlation-review':
    case 'field-modal':
      return CONCEPT_WORKSPACE_TO_KIND[id];
    default:
      return assertNever(id);
  }
}

export function workbenchWorkspace(kind: WorkspaceKind): WorkbenchWorkspace {
  switch (kind) {
    case 'materialLab':
      return MATERIAL_LAB_WORKSPACE;
    case 'physicsStructural':
      return STRUCTURAL_WORKSPACE;
    case 'physicsCorrelation':
      return CORRELATION_WORKSPACE;
    case 'physicsFieldModal':
      return FIELD_MODAL_WORKSPACE;
    default:
      return assertNever(kind);
  }
}

export function panelsForWorkspace(kind: WorkspaceKind): readonly WorkbenchPanelId[] {
  switch (kind) {
    case 'materialLab':
      return MATERIAL_LAB_PANEL_IDS;
    case 'physicsStructural':
      return STRUCTURAL_PANEL_IDS;
    case 'physicsCorrelation':
      return CORRELATION_PANEL_IDS;
    case 'physicsFieldModal':
      return FIELD_MODAL_PANEL_IDS;
    default:
      return assertNever(kind);
  }
}

export function panelLabel(ref: WorkbenchPanelRef): string {
  switch (ref.workspace) {
    case 'materialLab':
      return MATERIAL_LAB_PANEL_LABELS[ref.id];
    case 'physicsStructural':
      return STRUCTURAL_PANEL_LABELS[ref.id];
    case 'physicsCorrelation':
      return CORRELATION_PANEL_LABELS[ref.id];
    case 'physicsFieldModal':
      return FIELD_MODAL_PANEL_LABELS[ref.id];
    default:
      return assertNever(ref);
  }
}

function catalogById<T extends { readonly id: string }>(items: readonly T[], id: T['id']): T {
  for (const item of items) {
    if (item.id === id) return item;
  }
  throw new Error(`Unknown workbench catalog id: ${id}`);
}

export function structuralMetricById(id: StructuralMetricId): StructuralMetric {
  switch (id) {
    case 'normalized-force':
    case 'normalized-load-progress':
    case 'displacement':
    case 'peak-deflection':
    case 'residual-deflection':
    case 'strain-xx':
    case 'strain-yy':
    case 'strain-xy':
    case 'max-normalized-strain':
    case 'normalized-energy':
    case 'failure-phase':
    case 'break-count':
    case 'fragment-count':
    case 'body-count':
    case 'node-count':
    case 'replay-hash':
      return catalogById(STRUCTURAL_METRICS, id);
    default:
      return assertNever(id);
  }
}

export function correlationSeriesById(id: CorrelationSeriesId): CorrelationSeries {
  switch (id) {
    case 'reference':
    case 'candidate':
    case 'uncertainty-band':
    case 'residual':
    case 'energy-proxy':
      return catalogById(CORRELATION_SERIES, id);
    default:
      return assertNever(id);
  }
}

export function fieldModalFieldById(id: FieldModalFieldId): FieldModalField {
  switch (id) {
    case 'trigger-threshold':
    case 'trigger-polarity':
    case 'input-range':
    case 'averaging-count':
    case 'averaging-method':
    case 'sample-rate':
    case 'sample-count':
    case 'window':
    case 'coherence-threshold':
    case 'anti-alias-cutoff':
    case 'calibration':
    case 'model-build':
    case 'impact-u':
    case 'impact-v':
    case 'impact-strength':
    case 'selected-mode':
    case 'capture-slot':
    case 'field-view':
      return catalogById(FIELD_MODAL_FIELDS, id);
    default:
      return assertNever(id);
  }
}

export function fieldModalMetricById(id: FieldModalMetricId): FieldModalMetric {
  switch (id) {
    case 'frequency':
    case 'damping-ratio':
    case 'mac':
    case 'coherence':
    case 'displacement-amplitude':
      return catalogById(FIELD_MODAL_METRICS, id);
    default:
      return assertNever(id);
  }
}

export function defaultWorkbenchCapabilities(
  lab: Pick<WorkbenchLabDefinition, 'id' | 'solver' | 'forceModes'>,
): WorkbenchCapabilities {
  const pointForce = lab.forceModes.includes('material-strike');
  const loadControl = lab.forceModes.includes('actuator-load');
  const modalAnalysis = lab.id === 'composite-coupon' ? 'analysis-only-cantilever' : 'none';
  switch (lab.solver) {
    case 'material-lattice':
    case 'pbd-cloth':
    case 'pbd-rope':
    case 'shallow-water':
    case 'combined-material':
      return {
        structuralTest: true,
        correlation: true,
        pointForce,
        loadControl,
        renderCheckpointHz: 30,
        modalAnalysis,
      };
    case 'box3d-rigid':
      return {
        structuralTest: true,
        correlation: true,
        pointForce,
        loadControl,
        renderCheckpointHz: 10,
        modalAnalysis: 'none',
      };
    default:
      return assertNever(lab.solver);
  }
}

function assertUniqueIds(label: string, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must be unique.`);
  }
}

assertUniqueIds('Workbench panel ids', [
  ...MATERIAL_LAB_PANEL_IDS,
  ...STRUCTURAL_PANEL_IDS,
  ...CORRELATION_PANEL_IDS,
  ...FIELD_MODAL_PANEL_IDS,
]);
assertUniqueIds('Structural metric ids', STRUCTURAL_METRICS.map((metric) => metric.id));
assertUniqueIds('Correlation series ids', CORRELATION_SERIES.map((series) => series.id));
assertUniqueIds('Field-modal field ids', FIELD_MODAL_FIELDS.map((field) => field.id));
assertUniqueIds('Field-modal probe ids', FIELD_MODAL_PROBES.map((probe) => probe.id));
