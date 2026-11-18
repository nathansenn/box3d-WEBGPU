import { getMaterialDemoRecipe } from '../material-demos';
import {
  MATERIAL_BEHAVIOR_PRESETS,
  MATERIAL_BEHAVIOR_PRESET_IDS,
  type MaterialBehaviorPresetId,
  type MaterialFailureMode,
} from '../soft/material-presets';
import { WORKBENCH_LABS } from './registry';
import type { WorkbenchForceMode, WorkbenchGroup, WorkbenchLabDefinition, WorkbenchSolver } from './schema';

/**
 * Box3D-native, declarative assembly metadata for the engineering workbench.
 *
 * The manifest describes what a scene represents and which subsystem owns
 * each visible element. It deliberately does not claim CAD topology, physical
 * dimensions, or a solver capability that the runtime does not provide.
 */
export const ENGINEERING_MODEL_SCHEMA_VERSION = 'box3d-engineering-model/1' as const;
export const ENGINEERING_MODEL_COMPONENT_CAP = 256;

export type EngineeringModelDetailLevel = 'catalog' | 'flagship';
export type EngineeringModelOwner = 'solver-runtime' | 'workbench-definition' | 'renderer-presentation';
export type EngineeringEvidenceRole =
  | 'scope-container'
  | 'numerical-state'
  | 'boundary-condition'
  | 'derived-measurement'
  | 'presentation-only';
export type EngineeringComponentKind =
  | 'assembly'
  | 'specimen'
  | 'fixture'
  | 'load-train'
  | 'instrumentation'
  | 'environment'
  | 'effect';
export type EngineeringLimitStatus = 'represented' | 'reduced-order' | 'not-modeled' | 'presentation-only';
export type EngineeringDimensionAxis = 'X' | 'Y' | 'Z' | 'radial' | 'span';

export type EngineeringPoint = readonly [number, number, number];

export type EngineeringBounds = {
  readonly min: EngineeringPoint;
  readonly max: EngineeringPoint;
  readonly space: 'world';
};

export type EngineeringCoordinateFrame = {
  readonly upAxis: 'Y';
  readonly handedness: 'right-handed';
  readonly units: 'normalized simulation units';
  readonly scaleDisclosure: string;
};

export type EngineeringAssemblyLayer = {
  readonly id: string;
  readonly label: string;
  readonly parentId?: string;
  readonly owner: EngineeringModelOwner;
  readonly evidenceRole: EngineeringEvidenceRole;
  readonly defaultVisibility: 'visible' | 'hidden';
};

export type EngineeringAssemblyComponent = {
  readonly id: string;
  readonly label: string;
  readonly layerId: string;
  readonly parentId?: string;
  readonly kind: EngineeringComponentKind;
  readonly owner: EngineeringModelOwner;
  readonly evidenceRole: EngineeringEvidenceRole;
  readonly quantity: number;
  readonly material?: string;
  readonly note: string;
  /** Optional scene-space scope used for selection and framing, never collision. */
  readonly bounds?: EngineeringBounds;
};

export type EngineeringAuthoredDimension = {
  readonly id: string;
  readonly label: string;
  readonly axis: EngineeringDimensionAxis;
  readonly value: number;
  readonly unit: 'simulation units';
  readonly authority: 'authored-scene';
  readonly note: string;
  readonly from?: EngineeringPoint;
  readonly to?: EngineeringPoint;
};

export type EngineeringModelLimit = {
  readonly id: string;
  readonly subject: string;
  readonly status: EngineeringLimitStatus;
  readonly disclosure: string;
};

export const ENGINEERING_LATTICE_PRESET_IDS = MATERIAL_BEHAVIOR_PRESET_IDS;
export type EngineeringLatticePresetId = MaterialBehaviorPresetId;

export const ENGINEERING_PROXY_PRESET_IDS = ['pbd-cloth', 'pbd-rope', 'shallow-water', 'rigid-proxy'] as const;
export type EngineeringProxyPresetId = (typeof ENGINEERING_PROXY_PRESET_IDS)[number];
export type EngineeringMaterialPresetId = EngineeringLatticePresetId | EngineeringProxyPresetId;

export const ENGINEERING_MATERIAL_FAMILIES = [
  'lattice-metal',
  'lattice-glass',
  'lattice-concrete',
  'lattice-composite',
  'lattice-elastomer',
  'lattice-timber',
  'pbd-cloth',
  'pbd-rope',
  'shallow-water',
  'rigid-proxy',
] as const;
export type EngineeringMaterialFamily = (typeof ENGINEERING_MATERIAL_FAMILIES)[number];

export const ENGINEERING_FAILURE_MODES = [
  'ductile',
  'brittle',
  'progressive',
  'fiber',
  'hyperelastic',
  'fluid',
  'constraint-tear',
  'contact-proxy',
  'heightfield',
] as const;
export type EngineeringFailureMode = (typeof ENGINEERING_FAILURE_MODES)[number];

export const ENGINEERING_MEMBER_ROLES = [
  'specimen',
  'fixture',
  'load-path',
  'instrument',
  'environment',
] as const;
export type EngineeringMemberRole = (typeof ENGINEERING_MEMBER_ROLES)[number];

export const ENGINEERING_METRIC_KINDS = [
  'span',
  'width',
  'thickness',
  'lattice-stations',
  'lattice-lanes',
  'node-count',
  'sensor-count',
  'normalized-load-target',
  'normalized-deflection',
  'normalized-strain',
  'normalized-energy',
] as const;
export type EngineeringMetricKind = (typeof ENGINEERING_METRIC_KINDS)[number];

export const ENGINEERING_METRIC_UNITS = [
  'simulation units',
  'count',
  'normalized',
  'strain',
  'ratio',
] as const;
export type EngineeringMetricUnit = (typeof ENGINEERING_METRIC_UNITS)[number];

export const ENGINEERING_METRIC_PROVENANCES = [
  'authored-scene',
  'solver-native',
  'derived-normalized',
] as const;
export type EngineeringMetricProvenance = (typeof ENGINEERING_METRIC_PROVENANCES)[number];

export const ENGINEERING_LOAD_CONTROL_MODES = ['actuator', 'point', 'impulse', 'projectile'] as const;
export type EngineeringLoadControlMode = (typeof ENGINEERING_LOAD_CONTROL_MODES)[number];

export const ENGINEERING_OVERLAY_IDS = [
  'normalized-strain',
  'normalized-deflection',
  'normalized-energy',
  'damage',
] as const;
export type EngineeringOverlayId = (typeof ENGINEERING_OVERLAY_IDS)[number];

export const ENGINEERING_CHANNEL_QUANTITIES = [
  'load',
  'response',
  'displacement',
  'strain',
  'energy',
  'damage',
  'count',
] as const;
export type EngineeringChannelQuantity = (typeof ENGINEERING_CHANNEL_QUANTITIES)[number];

export const ENGINEERING_CHANNEL_UNITS = [
  'normalized',
  'simulation-unit',
  'strain',
  'count',
  'normalized-energy',
] as const;
export type EngineeringChannelUnit = (typeof ENGINEERING_CHANNEL_UNITS)[number];

export const ENGINEERING_SERIES_PROVENANCES = [
  'solver-native',
  'derived-normalized',
  'synthetic-demo',
] as const;
export type EngineeringSeriesProvenance = (typeof ENGINEERING_SERIES_PROVENANCES)[number];

export const ENGINEERING_BOOKMARK_KINDS = [
  'initial',
  'input',
  'first-response',
  'peak',
  'recovery',
  'end',
] as const;
export type EngineeringBookmarkKind = (typeof ENGINEERING_BOOKMARK_KINDS)[number];

export const ENGINEERING_CORRELATION_CHECK_STATUSES = ['pass', 'warning', 'fail', 'pending'] as const;
export type EngineeringCorrelationCheckStatus = (typeof ENGINEERING_CORRELATION_CHECK_STATUSES)[number];

export const ENGINEERING_PROBE_COMPONENTS = ['normal', 'x', 'y', 'z'] as const;
export type EngineeringProbeComponent = (typeof ENGINEERING_PROBE_COMPONENTS)[number];

export const ENGINEERING_FIELD_WINDOWS = ['hann'] as const;
export type EngineeringFieldWindow = (typeof ENGINEERING_FIELD_WINDOWS)[number];

export const ENGINEERING_FIELD_CAPABILITIES = ['none', 'analysis-only-cantilever'] as const;
export type EngineeringFieldCapability = (typeof ENGINEERING_FIELD_CAPABILITIES)[number];

export const ENGINEERING_CAPTURE_SLOT_STATUSES = ['empty', 'armed', 'accepted', 'rejected'] as const;
export type EngineeringCaptureSlotStatus = (typeof ENGINEERING_CAPTURE_SLOT_STATUSES)[number];

export const ENGINEERING_MATERIAL_FAMILY_LABELS: Readonly<Record<EngineeringMaterialFamily, string>> = {
  'lattice-metal': 'Lattice metal',
  'lattice-glass': 'Lattice glass',
  'lattice-concrete': 'Lattice concrete',
  'lattice-composite': 'Lattice composite',
  'lattice-elastomer': 'Lattice elastomer',
  'lattice-timber': 'Lattice timber',
  'pbd-cloth': 'PBD cloth',
  'pbd-rope': 'PBD rope',
  'shallow-water': 'Shallow water',
  'rigid-proxy': 'Rigid proxy',
};

export const ENGINEERING_OVERLAY_LABELS: Readonly<Record<EngineeringOverlayId, string>> = {
  'normalized-strain': 'Normalized strain',
  'normalized-deflection': 'Normalized deflection',
  'normalized-energy': 'Normalized energy',
  damage: 'Constraint damage',
};

/**
 * Comparative lattice or proxy material card for inspector dropdowns.
 * Coefficients are dimensionless workbench profiles, not certified allowables.
 */
export type EngineeringMaterialCard = {
  readonly id: string;
  readonly label: string;
  readonly family: EngineeringMaterialFamily;
  readonly presetId: EngineeringMaterialPresetId;
  readonly failureMode: EngineeringFailureMode;
  readonly densityScale: number;
  readonly axialStiffness: number;
  readonly shearStiffness: number;
  readonly bendStiffness: number;
  readonly tensileYieldStrain: number;
  readonly tensileBreakStrain: number;
  readonly compressionYieldStrain: number;
  readonly compressionBreakStrain: number;
  /** Comparative plastic-set rate; feeds the Material Lab hardening control. */
  readonly hardening: number;
  /** Authored display thickness in simulation units, not a physical gauge. */
  readonly displayThickness: number;
  readonly disclosure: string;
};

export type EngineeringMemberMetric = {
  readonly id: string;
  readonly kind: EngineeringMetricKind;
  readonly label: string;
  readonly value: number;
  readonly unit: EngineeringMetricUnit;
  readonly provenance: EngineeringMetricProvenance;
};

export type EngineeringStructuralMember = {
  readonly id: string;
  readonly componentId: string;
  readonly label: string;
  readonly role: EngineeringMemberRole;
  readonly materialId: string;
  readonly metrics: readonly EngineeringMemberMetric[];
};

export type EngineeringLoadCase = {
  readonly name: string;
  readonly controlMode: EngineeringLoadControlMode;
  readonly target: number;
  readonly rate: number;
  readonly maxLoad: number;
  readonly maxDisplacement: number;
  readonly maxStrain: number;
};

export type EngineeringViewportOverlay = {
  readonly id: EngineeringOverlayId;
  readonly label: string;
  readonly unit: EngineeringChannelUnit;
  readonly min: number;
  readonly max: number;
  readonly provenance: 'derived-normalized' | 'presentation-only';
};

export type EngineeringDemoChannel = {
  readonly id: string;
  readonly label: string;
  readonly quantity: EngineeringChannelQuantity;
  readonly unit: EngineeringChannelUnit;
  readonly provenance: EngineeringSeriesProvenance;
};

export type EngineeringCorrelationSeries = {
  readonly id: string;
  readonly channelId: string;
  readonly label: string;
  readonly quantity: EngineeringChannelQuantity;
  readonly unit: EngineeringChannelUnit;
  readonly provenance: EngineeringSeriesProvenance;
  readonly times: readonly number[];
  readonly reference: readonly number[];
  readonly candidate: readonly number[];
};

export type EngineeringEnergyBalanceTerm = {
  readonly id: string;
  readonly label: string;
  readonly fraction: number;
  readonly provenance: EngineeringSeriesProvenance;
};

export type EngineeringCorrelationBookmark = {
  readonly id: string;
  readonly step: number;
  readonly label: string;
  readonly kind: EngineeringBookmarkKind;
};

export type EngineeringCorrelationCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: EngineeringCorrelationCheckStatus;
  readonly detail: string;
};

export type EngineeringCorrelationPanel = {
  readonly caseLabel: string;
  readonly channels: readonly EngineeringDemoChannel[];
  readonly series: readonly EngineeringCorrelationSeries[];
  readonly energyBalance: readonly EngineeringEnergyBalanceTerm[];
  readonly bookmarks: readonly EngineeringCorrelationBookmark[];
  readonly checks: readonly EngineeringCorrelationCheck[];
};

export type EngineeringFieldProbe = {
  readonly id: string;
  readonly label: string;
  readonly u: number;
  readonly v: number;
  readonly component: EngineeringProbeComponent;
};

export type EngineeringFieldSpectrum = {
  readonly provenance: EngineeringSeriesProvenance;
  readonly frequencies: readonly number[];
  readonly amplitudeDb: readonly number[];
  readonly relativePower: readonly number[];
};

export type EngineeringFieldMode = {
  readonly index: number;
  readonly frequencySimulationHz: number | null;
  readonly dampingRatio: number | null;
  readonly spectralConfidence: number | null;
  readonly mac: number | null;
  readonly disclosure: string;
};

export type EngineeringFieldCaptureSlot = {
  readonly index: number;
  readonly status: EngineeringCaptureSlotStatus;
  readonly label: string;
};

export type EngineeringFieldPanel = {
  readonly capability: EngineeringFieldCapability;
  readonly projectLabel: string;
  readonly testLabel: string;
  readonly sampleRateHz: number;
  readonly sampleCount: number;
  readonly window: EngineeringFieldWindow;
  readonly impact: { readonly u: number; readonly v: number; readonly strength: number };
  readonly probes: readonly EngineeringFieldProbe[];
  readonly spectrum: EngineeringFieldSpectrum;
  readonly modes: readonly EngineeringFieldMode[];
  readonly captures: readonly EngineeringFieldCaptureSlot[];
};

export type EngineeringModelManifest = {
  readonly schemaVersion: typeof ENGINEERING_MODEL_SCHEMA_VERSION;
  readonly labId: string;
  readonly title: string;
  readonly revision: string;
  readonly detailLevel: EngineeringModelDetailLevel;
  readonly group: WorkbenchGroup;
  readonly solver: WorkbenchSolver;
  readonly coordinateFrame: EngineeringCoordinateFrame;
  readonly summary: string;
  readonly layers: readonly EngineeringAssemblyLayer[];
  readonly components: readonly EngineeringAssemblyComponent[];
  readonly dimensions: readonly EngineeringAuthoredDimension[];
  readonly limits: readonly EngineeringModelLimit[];
  readonly materials: readonly EngineeringMaterialCard[];
  readonly primaryMaterialId: string;
  readonly members: readonly EngineeringStructuralMember[];
  readonly loadCase: EngineeringLoadCase;
  readonly defaultOverlay: EngineeringOverlayId;
  readonly overlays: readonly EngineeringViewportOverlay[];
  readonly channels: readonly EngineeringDemoChannel[];
  readonly correlation: EngineeringCorrelationPanel;
  readonly field: EngineeringFieldPanel;
  /** Optional aggregate framing scope; values are normalized scene coordinates. */
  readonly focusBounds?: EngineeringBounds;
};

const COORDINATE_FRAME: EngineeringCoordinateFrame = Object.freeze({
  upAxis: 'Y',
  handedness: 'right-handed',
  units: 'normalized simulation units',
  scaleDisclosure: 'Scene-space values communicate layout and comparison only; they are not calibrated physical units.',
});

type ModelDraft = Omit<EngineeringModelManifest, 'schemaVersion' | 'coordinateFrame'>;

const point = (x: number, y: number, z: number): EngineeringPoint => Object.freeze([x, y, z]);
const bounds = (min: EngineeringPoint, max: EngineeringPoint): EngineeringBounds => Object.freeze({
  min,
  max,
  space: 'world',
});

function freezeMetric(metric: EngineeringMemberMetric): EngineeringMemberMetric {
  return Object.freeze({ ...metric });
}

function freezeMember(member: EngineeringStructuralMember): EngineeringStructuralMember {
  return Object.freeze({
    ...member,
    metrics: Object.freeze(member.metrics.map(freezeMetric)),
  });
}

function freezeSeries(series: EngineeringCorrelationSeries): EngineeringCorrelationSeries {
  return Object.freeze({
    ...series,
    times: Object.freeze(series.times.slice()),
    reference: Object.freeze(series.reference.slice()),
    candidate: Object.freeze(series.candidate.slice()),
  });
}

function freezeCorrelation(panel: EngineeringCorrelationPanel): EngineeringCorrelationPanel {
  return Object.freeze({
    ...panel,
    channels: Object.freeze(panel.channels.map((channel) => Object.freeze({ ...channel }))),
    series: Object.freeze(panel.series.map(freezeSeries)),
    energyBalance: Object.freeze(panel.energyBalance.map((term) => Object.freeze({ ...term }))),
    bookmarks: Object.freeze(panel.bookmarks.map((bookmark) => Object.freeze({ ...bookmark }))),
    checks: Object.freeze(panel.checks.map((check) => Object.freeze({ ...check }))),
  });
}

function freezeField(panel: EngineeringFieldPanel): EngineeringFieldPanel {
  return Object.freeze({
    ...panel,
    impact: Object.freeze({ ...panel.impact }),
    probes: Object.freeze(panel.probes.map((probe) => Object.freeze({ ...probe }))),
    spectrum: Object.freeze({
      ...panel.spectrum,
      frequencies: Object.freeze(panel.spectrum.frequencies.slice()),
      amplitudeDb: Object.freeze(panel.spectrum.amplitudeDb.slice()),
      relativePower: Object.freeze(panel.spectrum.relativePower.slice()),
    }),
    modes: Object.freeze(panel.modes.map((mode) => Object.freeze({ ...mode }))),
    captures: Object.freeze(panel.captures.map((capture) => Object.freeze({ ...capture }))),
  });
}

function freezeManifest(draft: ModelDraft): EngineeringModelManifest {
  return Object.freeze({
    ...draft,
    schemaVersion: ENGINEERING_MODEL_SCHEMA_VERSION,
    coordinateFrame: COORDINATE_FRAME,
    layers: Object.freeze(draft.layers.map((layer) => Object.freeze({ ...layer }))),
    components: Object.freeze(draft.components.map((component) => Object.freeze({ ...component }))),
    dimensions: Object.freeze(draft.dimensions.map((dimension) => Object.freeze({ ...dimension }))),
    limits: Object.freeze(draft.limits.map((limit) => Object.freeze({ ...limit }))),
    materials: Object.freeze(draft.materials.map((material) => Object.freeze({ ...material }))),
    members: Object.freeze(draft.members.map(freezeMember)),
    loadCase: Object.freeze({ ...draft.loadCase }),
    overlays: Object.freeze(draft.overlays.map((overlay) => Object.freeze({ ...overlay }))),
    channels: Object.freeze(draft.channels.map((channel) => Object.freeze({ ...channel }))),
    correlation: freezeCorrelation(draft.correlation),
    field: freezeField(draft.field),
  });
}

function standardLayers(labId: string): readonly EngineeringAssemblyLayer[] {
  const root = `${labId}:layer:assembly`;
  return [
    {
      id: root,
      label: 'Assembly',
      owner: 'workbench-definition',
      evidenceRole: 'scope-container',
      defaultVisibility: 'visible',
    },
    {
      id: `${labId}:layer:numerical`,
      label: 'Numerical domain',
      parentId: root,
      owner: 'solver-runtime',
      evidenceRole: 'numerical-state',
      defaultVisibility: 'visible',
    },
    {
      id: `${labId}:layer:boundary`,
      label: 'Fixtures & load path',
      parentId: root,
      owner: 'workbench-definition',
      evidenceRole: 'boundary-condition',
      defaultVisibility: 'visible',
    },
    {
      id: `${labId}:layer:measurement`,
      label: 'Measurement references',
      parentId: root,
      owner: 'workbench-definition',
      evidenceRole: 'derived-measurement',
      defaultVisibility: 'visible',
    },
    {
      id: `${labId}:layer:presentation`,
      label: 'Presentation context',
      parentId: root,
      owner: 'renderer-presentation',
      evidenceRole: 'presentation-only',
      defaultVisibility: 'visible',
    },
  ];
}

type GroupBlueprint = {
  readonly numericalLabel: string;
  readonly numericalMaterial: string;
  readonly fixtureLabel: string;
  readonly loadLabel: string;
  readonly measurementLabel: string;
  readonly contextLabel: string;
  readonly numericalNote: string;
  readonly fixtureNote: string;
  readonly solverLimit: string;
  readonly omittedLimit: string;
};

const GROUP_BLUEPRINTS: Readonly<Record<WorkbenchGroup, GroupBlueprint>> = {
  materials: {
    numericalLabel: 'Reduced-order material specimen',
    numericalMaterial: 'Workbench material preset',
    fixtureLabel: 'Authored restraint witnesses',
    loadLabel: 'Authored load applicator',
    measurementLabel: 'Material response telemetry',
    contextLabel: 'Test-cell presentation shell',
    numericalNote: 'Solver-owned lattice nodes and constraints provide the evolving state.',
    fixtureNote: 'Visible hardware explains the boundary condition; fixed solver nodes own the restraint.',
    solverLimit: 'Material response is a reduced-order lattice model, not a calibrated continuum or finite-element solve.',
    omittedLimit: 'Fasteners, contact tooling, and manufacturing tolerances are not individually resolved.',
  },
  cloth: {
    numericalLabel: 'PBD membrane mesh',
    numericalMaterial: 'Position-based cloth preset',
    fixtureLabel: 'Pinned-edge anchors',
    loadLabel: 'Impulse and projectile input field',
    measurementLabel: 'Membrane response telemetry',
    contextLabel: 'Wind-test presentation context',
    numericalNote: 'Solver-owned particles and constraints provide the evolving membrane state.',
    fixtureNote: 'Anchor witnesses correspond to pinned particles in the numerical mesh.',
    solverLimit: 'The membrane uses position-based constraints rather than a calibrated textile constitutive model.',
    omittedLimit: 'Airflow, seam construction, weave, and fixture compliance are not resolved.',
  },
  rope: {
    numericalLabel: 'PBD line network',
    numericalMaterial: 'Position-based rope preset',
    fixtureLabel: 'Line anchors and supports',
    loadLabel: 'Payload or impulse input',
    measurementLabel: 'Line response telemetry',
    contextLabel: 'Rigging presentation context',
    numericalNote: 'Solver-owned particles and distance constraints provide the evolving line state.',
    fixtureNote: 'Support witnesses identify pinned endpoints and authored load-transfer locations.',
    solverLimit: 'The line network is a position-based model without calibrated cable section or termination behavior.',
    omittedLimit: 'Sheaves, strand construction, fittings, fatigue, and anchor flexibility are not resolved.',
  },
  water: {
    numericalLabel: 'Shallow-water heightfield',
    numericalMaterial: 'Linear 2.5D water field',
    fixtureLabel: 'Basin boundary',
    loadLabel: 'Surface disturbance input',
    measurementLabel: 'Wave-field telemetry',
    contextLabel: 'Basin and spray presentation',
    numericalNote: 'Solver-owned height and horizontal-velocity samples provide the evolving water state.',
    fixtureNote: 'Visible walls identify the authored numerical boundary envelope.',
    solverLimit: 'The water domain is a linear 2.5D heightfield, not a volumetric free-surface solve.',
    omittedLimit: 'Viscosity, air entrainment, breaking-wave turbulence, and detailed wet contact are not resolved.',
  },
  rigid: {
    numericalLabel: 'Box3D rigid-body set',
    numericalMaterial: 'Rigid proxy materials',
    fixtureLabel: 'Static contact foundation',
    loadLabel: 'Rigid impact and impulse input',
    measurementLabel: 'Body-state telemetry',
    contextLabel: 'Architectural presentation shell',
    numericalNote: 'Solver-owned rigid transforms and contacts provide the evolving state.',
    fixtureNote: 'Static bodies and scene witnesses establish the supported contact envelope.',
    solverLimit: 'Bodies use box-hull rigid contact and do not represent structural members or deformable connections.',
    omittedLimit: 'Joint stiffness, local crushing, fracture mechanics, and connection detailing are not resolved.',
  },
  combined: {
    numericalLabel: 'Independent material rigs',
    numericalMaterial: 'Metal, glass, and concrete presets',
    fixtureLabel: 'Bay-specific test frames',
    loadLabel: 'Independent authored actuators',
    measurementLabel: 'Synchronized rig telemetry',
    contextLabel: 'Shared proving-ground presentation shell',
    numericalNote: 'Three solver-owned lattices share a clock but retain independent state and boundaries.',
    fixtureNote: 'Visible frames explain each bay boundary without adding cross-bay constraints.',
    solverLimit: 'The bays are coordinated independent rigs, not a coupled multi-material solve.',
    omittedLimit: 'Cross-rig collision, load transfer, and common physical calibration are not modeled.',
  },
};

function assertNever(value: never, label: string): never {
  throw new Error(`Unhandled ${label}: ${String(value)}`);
}

function isLatticePresetId(value: string): value is EngineeringLatticePresetId {
  return (ENGINEERING_LATTICE_PRESET_IDS as readonly string[]).includes(value);
}

function failureModeFromPreset(mode: MaterialFailureMode): EngineeringFailureMode {
  switch (mode) {
    case 'ductile':
    case 'brittle':
    case 'progressive':
    case 'fiber':
    case 'hyperelastic':
    case 'fluid':
      return mode;
    default:
      return assertNever(mode, 'material failure mode');
  }
}

function familyForLatticePreset(id: EngineeringLatticePresetId): EngineeringMaterialFamily {
  switch (id) {
    case 'structural-steel':
    case 'aluminum-alloy':
    case 'copper':
      return 'lattice-metal';
    case 'soda-lime-glass':
    case 'acrylic':
      return 'lattice-glass';
    case 'reinforced-concrete':
      return 'lattice-concrete';
    case 'carbon-fiber':
      return 'lattice-composite';
    case 'elastomer':
      return 'lattice-elastomer';
    case 'oak-timber':
    case 'cross-laminated-timber':
      return 'lattice-timber';
    default:
      return assertNever(id, 'lattice preset');
  }
}

function familyForProxyPreset(id: EngineeringProxyPresetId): EngineeringMaterialFamily {
  switch (id) {
    case 'pbd-cloth':
      return 'pbd-cloth';
    case 'pbd-rope':
      return 'pbd-rope';
    case 'shallow-water':
      return 'shallow-water';
    case 'rigid-proxy':
      return 'rigid-proxy';
    default:
      return assertNever(id, 'proxy preset');
  }
}

function failureModeForProxy(id: EngineeringProxyPresetId): EngineeringFailureMode {
  switch (id) {
    case 'pbd-cloth':
    case 'pbd-rope':
      return 'constraint-tear';
    case 'shallow-water':
      return 'heightfield';
    case 'rigid-proxy':
      return 'contact-proxy';
    default:
      return assertNever(id, 'proxy failure mode');
  }
}

function displayThicknessForPreset(id: EngineeringMaterialPresetId): number {
  switch (id) {
    case 'structural-steel':
      return 0.036;
    case 'aluminum-alloy':
      return 0.064;
    case 'copper':
      return 0.04;
    case 'oak-timber':
    case 'cross-laminated-timber':
      return 0.12;
    case 'reinforced-concrete':
      return 0.22;
    case 'soda-lime-glass':
      return 0.12;
    case 'acrylic':
      return 0.08;
    case 'elastomer':
      return 0.16;
    case 'carbon-fiber':
      return 0.18;
    case 'pbd-cloth':
      return 0.02;
    case 'pbd-rope':
      return 0.03;
    case 'shallow-water':
      return 0.08;
    case 'rigid-proxy':
      return 0.12;
    default:
      return assertNever(id, 'display thickness');
  }
}

function controlModeFor(mode: WorkbenchForceMode): EngineeringLoadControlMode {
  switch (mode) {
    case 'actuator-load':
    case 'release-load':
    case 'cycle-load':
      return 'actuator';
    case 'material-strike':
      return 'point';
    case 'broad-impulse':
    case 'radial-blast':
    case 'impact-rain':
      return 'impulse';
    case 'projectile':
      return 'projectile';
    default:
      return assertNever(mode, 'force mode');
  }
}

type AuthoredGeometry = {
  readonly presetId: EngineeringMaterialPresetId;
  readonly thickness: number;
  readonly stations: number;
  readonly lanes: number;
  readonly span: number;
  readonly width: number;
};

function groupGeometry(group: WorkbenchGroup): AuthoredGeometry {
  switch (group) {
    case 'materials':
      return { presetId: 'structural-steel', thickness: 0.04, stations: 32, lanes: 9, span: 20, width: 8 };
    case 'cloth':
      return { presetId: 'pbd-cloth', thickness: 0.02, stations: 36, lanes: 24, span: 16, width: 12 };
    case 'rope':
      return { presetId: 'pbd-rope', thickness: 0.03, stations: 24, lanes: 1, span: 18, width: 0.2 };
    case 'water':
      return { presetId: 'shallow-water', thickness: 0.08, stations: 52, lanes: 40, span: 28, width: 22 };
    case 'rigid':
      return { presetId: 'rigid-proxy', thickness: 0.12, stations: 1, lanes: 1, span: 24, width: 16 };
    case 'combined':
      return { presetId: 'structural-steel', thickness: 0.036, stations: 48, lanes: 13, span: 24, width: 8.6 };
    default:
      return assertNever(group, 'workbench group');
  }
}

const SCENE_LAB_GEOMETRY: Readonly<Record<string, AuthoredGeometry>> = {
  'elastomer-recovery': { presetId: 'elastomer', thickness: 0.16, stations: 28, lanes: 9, span: 16, width: 6 },
  'composite-coupon': { presetId: 'carbon-fiber', thickness: 0.18, stations: 40, lanes: 7, span: 24, width: 5.4 },
  'apex-proving-ground': { presetId: 'structural-steel', thickness: 0.036, stations: 48, lanes: 13, span: 24, width: 8.6 },
};

const LAB_THICKNESS: Readonly<Record<string, number>> = {
  'titan-bend-dent': 0.036,
  'crash-rail-axial-fold': 0.064,
  'composite-coupon': 0.18,
};

function geometryFor(lab: WorkbenchLabDefinition): AuthoredGeometry {
  const sceneGeometry = SCENE_LAB_GEOMETRY[lab.id];
  if (sceneGeometry) return sceneGeometry;
  if ('materialDemoId' in lab && lab.materialDemoId) {
    const recipe = getMaterialDemoRecipe(lab.materialDemoId);
    if (recipe) {
      const preset = MATERIAL_BEHAVIOR_PRESETS[recipe.profileVariant] ?? MATERIAL_BEHAVIOR_PRESETS[0];
      const presetId = isLatticePresetId(preset.id) ? preset.id : 'structural-steel';
      return {
        presetId,
        thickness: LAB_THICKNESS[lab.id] ?? displayThicknessForPreset(presetId),
        stations: recipe.stations,
        lanes: recipe.lanes,
        span: recipe.span,
        width: recipe.depth,
      };
    }
  }
  return groupGeometry(lab.group);
}

function latticeCard(labId: string, presetId: EngineeringLatticePresetId, thickness: number): EngineeringMaterialCard {
  const preset = MATERIAL_BEHAVIOR_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`Missing lattice preset '${presetId}'.`);
  return {
    id: `${labId}:material:${presetId}`,
    label: preset.label,
    family: familyForLatticePreset(presetId),
    presetId,
    failureMode: failureModeFromPreset(preset.failureMode),
    densityScale: preset.densityScale,
    axialStiffness: preset.axialStiffness,
    shearStiffness: preset.shearStiffness,
    bendStiffness: preset.bendStiffness,
    tensileYieldStrain: preset.tensileYieldStrain,
    tensileBreakStrain: preset.tensileBreakStrain,
    compressionYieldStrain: preset.compressionYieldStrain,
    compressionBreakStrain: preset.compressionBreakStrain,
    hardening: preset.plasticCreep,
    displayThickness: thickness,
    disclosure: "Comparative lattice coefficients for workbench inspection. Not Young's modulus, yield stress, or certified allowables.",
  };
}

function proxyCard(labId: string, presetId: EngineeringProxyPresetId, thickness: number): EngineeringMaterialCard {
  const labels: Readonly<Record<EngineeringProxyPresetId, string>> = {
    'pbd-cloth': 'Position-based cloth',
    'pbd-rope': 'Position-based rope',
    'shallow-water': 'Linear 2.5D water',
    'rigid-proxy': 'Rigid contact proxy',
  };
  return {
    id: `${labId}:material:${presetId}`,
    label: labels[presetId],
    family: familyForProxyPreset(presetId),
    presetId,
    failureMode: failureModeForProxy(presetId),
    densityScale: 1,
    axialStiffness: 0,
    shearStiffness: 0,
    bendStiffness: 0,
    tensileYieldStrain: 0,
    tensileBreakStrain: 0,
    compressionYieldStrain: 0,
    compressionBreakStrain: 0,
    hardening: 0,
    displayThickness: thickness,
    disclosure: 'Proxy presentation profile. Constraint or contact coefficients live in the owning solver, not this card.',
  };
}

function materialCard(labId: string, presetId: EngineeringMaterialPresetId, thickness: number): EngineeringMaterialCard {
  switch (presetId) {
    case 'pbd-cloth':
    case 'pbd-rope':
    case 'shallow-water':
    case 'rigid-proxy':
      return proxyCard(labId, presetId, thickness);
    default:
      return latticeCard(labId, presetId, thickness);
  }
}

function materialsFor(lab: WorkbenchLabDefinition, geometry: AuthoredGeometry): EngineeringMaterialCard[] {
  if (lab.id === 'apex-proving-ground') {
    return [
      latticeCard(lab.id, 'structural-steel', 0.036),
      latticeCard(lab.id, 'soda-lime-glass', 0.12),
      latticeCard(lab.id, 'reinforced-concrete', 0.22),
    ];
  }
  return [materialCard(lab.id, geometry.presetId, geometry.thickness)];
}

function metric(
  id: string,
  kind: EngineeringMetricKind,
  label: string,
  value: number,
  unit: EngineeringMetricUnit,
  provenance: EngineeringMetricProvenance = 'authored-scene',
): EngineeringMemberMetric {
  return { id, kind, label, value, unit, provenance };
}

function specimenMetrics(labId: string, geometry: AuthoredGeometry, sensorCount: number): EngineeringMemberMetric[] {
  return [
    metric(`${labId}:metric:span`, 'span', 'Authored span', geometry.span, 'simulation units'),
    metric(`${labId}:metric:width`, 'width', 'Authored width', geometry.width, 'simulation units'),
    metric(`${labId}:metric:thickness`, 'thickness', 'Display thickness', geometry.thickness, 'simulation units'),
    metric(`${labId}:metric:stations`, 'lattice-stations', 'Stations / columns', geometry.stations, 'count'),
    metric(`${labId}:metric:lanes`, 'lattice-lanes', 'Lanes / rows', geometry.lanes, 'count'),
    metric(`${labId}:metric:nodes`, 'node-count', 'Authored nodes', geometry.stations * geometry.lanes, 'count'),
    metric(`${labId}:metric:sensors`, 'sensor-count', 'Active channels', sensorCount, 'count'),
    metric(`${labId}:metric:load-target`, 'normalized-load-target', 'Load target', 0.8, 'normalized', 'derived-normalized'),
  ];
}

const DEMO_SAMPLE_COUNT = 80;
const DEMO_DT = 1 / 60;

function syntheticPair(kind: 'load' | 'response' | 'energy' | 'strain'): {
  times: number[];
  reference: number[];
  candidate: number[];
} {
  const times: number[] = [];
  const reference: number[] = [];
  const candidate: number[] = [];
  for (let index = 0; index < DEMO_SAMPLE_COUNT; index++) {
    const t = index / Math.max(1, DEMO_SAMPLE_COUNT - 1);
    let value = 0;
    switch (kind) {
      case 'load':
        value = (1 - Math.exp(-7 * t)) * (1 - 0.22 * Math.max(0, (t - 0.55) / 0.45));
        break;
      case 'response':
        value = (1 - Math.exp(-6 * t)) * (0.72 + 0.18 * t);
        break;
      case 'energy':
        value = (1 - Math.exp(-5 * t)) * Math.exp(-1.4 * Math.max(0, t - 0.35));
        break;
      case 'strain':
        value = 0.02 + 0.11 * (1 - Math.exp(-8 * t)) * (0.4 + 0.6 * t);
        break;
      default:
        return assertNever(kind, 'demo series');
    }
    times.push(index * DEMO_DT);
    reference.push(value);
    candidate.push(value * (0.975 + 0.025 * Math.sin(index * 0.23)));
  }
  return { times, reference, candidate };
}

function syntheticFieldSpectrum(): EngineeringFieldSpectrum {
  const frequencies: number[] = [];
  const amplitudeDb: number[] = [];
  const relativePower: number[] = [];
  const peakHz = 0.6;
  for (let index = 0; index < 64; index++) {
    const frequency = (index / 63) * 12;
    const detune = (frequency - peakHz) / 0.18;
    const magnitude = Math.exp(-detune * detune);
    frequencies.push(frequency);
    relativePower.push(magnitude);
    amplitudeDb.push(20 * Math.log10(Math.max(1e-4, magnitude)) - 40);
  }
  return {
    provenance: 'synthetic-demo',
    frequencies,
    amplitudeDb,
    relativePower,
  };
}

function emptyFieldSpectrum(): EngineeringFieldSpectrum {
  return {
    provenance: 'synthetic-demo',
    frequencies: [],
    amplitudeDb: [],
    relativePower: [],
  };
}

type PanelOptions = {
  readonly specimenComponentId: string;
  readonly fixtureComponentId: string;
  readonly instrumentComponentId: string;
  readonly extraMembers?: readonly EngineeringStructuralMember[];
};

type WorkbenchPanels = Pick<
  EngineeringModelManifest,
  | 'materials'
  | 'primaryMaterialId'
  | 'members'
  | 'loadCase'
  | 'defaultOverlay'
  | 'overlays'
  | 'channels'
  | 'correlation'
  | 'field'
>;

function buildWorkbenchPanels(lab: WorkbenchLabDefinition, options: PanelOptions): WorkbenchPanels {
  const id = lab.id;
  const geometry = geometryFor(lab);
  const materials = materialsFor(lab, geometry);
  const primaryMaterialId = materials[0]?.id ?? `${id}:material:missing`;
  const channels: EngineeringDemoChannel[] = [
    { id: `${id}:channel:load`, label: 'Input command', quantity: 'load', unit: 'normalized', provenance: 'derived-normalized' },
    { id: `${id}:channel:response`, label: 'P1 response', quantity: 'displacement', unit: 'simulation-unit', provenance: 'derived-normalized' },
    { id: `${id}:channel:strain`, label: 'Peak strain', quantity: 'strain', unit: 'strain', provenance: 'derived-normalized' },
    { id: `${id}:channel:energy`, label: 'Energy proxy', quantity: 'energy', unit: 'normalized-energy', provenance: 'derived-normalized' },
    { id: `${id}:channel:damage`, label: 'Damage / breaks', quantity: 'count', unit: 'count', provenance: 'solver-native' },
  ];
  const loadPair = syntheticPair('load');
  const responsePair = syntheticPair('response');
  const energyPair = syntheticPair('energy');
  const firstResponseLabel = lab.id === 'crash-rail-axial-fold' ? 'First fold' : 'First response';
  const recoveryLabel = lab.id === 'crash-rail-axial-fold' ? 'Progressive fold' : 'Recovery';
  const fieldCapability: EngineeringFieldCapability = lab.id === 'composite-coupon' ? 'analysis-only-cantilever' : 'none';
  const fieldProbes: EngineeringFieldProbe[] = fieldCapability === 'analysis-only-cantilever'
    ? [
      { id: `${id}:probe:p1`, label: 'P1', u: 0.08, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p2`, label: 'P2', u: 0.28, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p3`, label: 'P3', u: 0.48, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p4`, label: 'P4', u: 0.68, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p5`, label: 'P5', u: 0.88, v: 0.5, component: 'normal' },
    ]
    : [
      { id: `${id}:probe:p1`, label: 'P1', u: 0.17, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p2`, label: 'P2', u: 0.38, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p3`, label: 'P3', u: 0.51, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p4`, label: 'P4', u: 0.64, v: 0.5, component: 'normal' },
      { id: `${id}:probe:p5`, label: 'P5', u: 0.77, v: 0.5, component: 'normal' },
    ];
  const recipe = 'materialDemoId' in lab ? getMaterialDemoRecipe(lab.materialDemoId) : null;
  const impactU = fieldCapability === 'analysis-only-cantilever' ? 0.94 : recipe?.strikeCenter[0] ?? 0.5;
  const impactV = fieldCapability === 'analysis-only-cantilever' ? 0.5 : recipe?.strikeCenter[1] ?? 0.5;
  const loadTarget = recipe?.primaryLoad ?? 0.8;

  const specimenMember: EngineeringStructuralMember = {
    id: `${id}:member:specimen`,
    componentId: options.specimenComponentId,
    label: GROUP_BLUEPRINTS[lab.group].numericalLabel,
    role: 'specimen',
    materialId: primaryMaterialId,
    metrics: specimenMetrics(id, geometry, channels.length).map((entry) => (
      entry.kind === 'normalized-load-target' ? { ...entry, value: loadTarget } : entry
    )),
  };
  const fixtureMember: EngineeringStructuralMember = {
    id: `${id}:member:fixture`,
    componentId: options.fixtureComponentId,
    label: GROUP_BLUEPRINTS[lab.group].fixtureLabel,
    role: 'fixture',
    materialId: primaryMaterialId,
    metrics: [
      metric(`${id}:metric:fixture-qty`, 'sensor-count', 'Fixture groups', 1, 'count'),
    ],
  };
  const instrumentMember: EngineeringStructuralMember = {
    id: `${id}:member:instrument`,
    componentId: options.instrumentComponentId,
    label: GROUP_BLUEPRINTS[lab.group].measurementLabel,
    role: 'instrument',
    materialId: primaryMaterialId,
    metrics: [
      metric(`${id}:metric:channel-count`, 'sensor-count', 'Live channels', channels.length, 'count'),
    ],
  };

  return {
    materials,
    primaryMaterialId,
    members: [specimenMember, fixtureMember, instrumentMember, ...(options.extraMembers ?? [])],
    loadCase: {
      name: `${lab.shortName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()}-R1`,
      controlMode: controlModeFor(lab.forceModes[0] ?? 'broad-impulse'),
      target: loadTarget,
      rate: 1,
      maxLoad: 2,
      maxDisplacement: geometry.span * 0.25,
      maxStrain: 1,
    },
    defaultOverlay: 'normalized-strain',
    overlays: ENGINEERING_OVERLAY_IDS.map((overlayId) => {
      let unit: EngineeringChannelUnit;
      switch (overlayId) {
        case 'normalized-strain':
          unit = 'strain';
          break;
        case 'normalized-deflection':
          unit = 'simulation-unit';
          break;
        case 'normalized-energy':
          unit = 'normalized-energy';
          break;
        case 'damage':
          unit = 'normalized';
          break;
        default:
          return assertNever(overlayId, 'overlay');
      }
      return {
        id: overlayId,
        label: ENGINEERING_OVERLAY_LABELS[overlayId],
        unit,
        min: 0,
        max: 1,
        provenance: 'derived-normalized' as const,
      };
    }),
    channels,
    correlation: {
      caseLabel: lab.shortName,
      channels: [
        { id: `${id}:corr:reference`, label: 'Reference response', quantity: 'response', unit: 'normalized', provenance: 'synthetic-demo' },
        { id: `${id}:corr:candidate`, label: 'Solver response', quantity: 'response', unit: 'normalized', provenance: 'synthetic-demo' },
        { id: `${id}:corr:rate`, label: 'Response rate', quantity: 'response', unit: 'normalized', provenance: 'synthetic-demo' },
        { id: `${id}:corr:deflection`, label: 'Deflection', quantity: 'displacement', unit: 'simulation-unit', provenance: 'synthetic-demo' },
        { id: `${id}:corr:energy`, label: 'Energy proxy', quantity: 'energy', unit: 'normalized-energy', provenance: 'synthetic-demo' },
      ],
      series: [
        {
          id: `${id}:series:force`,
          channelId: `${id}:corr:reference`,
          label: 'Response history',
          quantity: 'load',
          unit: 'normalized',
          provenance: 'synthetic-demo',
          times: loadPair.times,
          reference: loadPair.reference,
          candidate: loadPair.candidate,
        },
        {
          id: `${id}:series:energy`,
          channelId: `${id}:corr:energy`,
          label: 'Energy proxy',
          quantity: 'energy',
          unit: 'normalized-energy',
          provenance: 'synthetic-demo',
          times: energyPair.times,
          reference: energyPair.reference,
          candidate: energyPair.candidate,
        },
        {
          id: `${id}:series:residual`,
          channelId: `${id}:corr:candidate`,
          label: 'Residual',
          quantity: 'response',
          unit: 'normalized',
          provenance: 'synthetic-demo',
          times: responsePair.times,
          reference: responsePair.reference.map((value, index) => responsePair.candidate[index] - value),
          candidate: responsePair.reference.map(() => 0),
        },
      ],
      energyBalance: [
        { id: `${id}:energy:strain`, label: 'Stored strain', fraction: 0.35, provenance: 'synthetic-demo' },
        { id: `${id}:energy:damage`, label: 'Dissipated damage', fraction: 0.40, provenance: 'synthetic-demo' },
        { id: `${id}:energy:kinetic`, label: 'Residual kinetic', fraction: 0.15, provenance: 'synthetic-demo' },
        { id: `${id}:energy:other`, label: 'Other / remainder', fraction: 0.10, provenance: 'synthetic-demo' },
      ],
      bookmarks: [
        { id: `${id}:bookmark:initial`, step: 0, label: 'Initial state', kind: 'initial' },
        { id: `${id}:bookmark:input`, step: 60, label: 'Input applied', kind: 'input' },
        { id: `${id}:bookmark:first`, step: 360, label: firstResponseLabel, kind: 'first-response' },
        { id: `${id}:bookmark:peak`, step: 748, label: 'Peak response', kind: 'peak' },
        { id: `${id}:bookmark:recovery`, step: 1200, label: recoveryLabel, kind: 'recovery' },
        { id: `${id}:bookmark:end`, step: 1800, label: 'End capture', kind: 'end' },
      ],
      checks: [
        { id: `${id}:check:role`, label: 'Reference role', status: 'pending', detail: 'Import or archive a reference run before scoring.' },
        { id: `${id}:check:align`, label: 'Time alignment', status: 'pending', detail: 'Offset is applied only after a mapped reference exists.' },
        { id: `${id}:check:channels`, label: 'Channel mapping', status: 'pending', detail: 'Quantity and unit must match before pairing.' },
        { id: `${id}:check:provenance`, label: 'Reference provenance', status: 'pending', detail: 'No imported or archived reference is attached.' },
        { id: `${id}:check:energy`, label: 'Energy proxy', status: 'warning', detail: 'Energy remains a normalized model proxy.' },
        { id: `${id}:check:replay`, label: 'Replay determinism', status: 'pass', detail: 'Fixed-step replay hash is available for this lab.' },
      ],
    },
    field: {
      capability: fieldCapability,
      projectLabel: fieldCapability === 'analysis-only-cantilever' ? 'CANT-BEAM-01' : `${lab.shortName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()}-01`,
      testLabel: fieldCapability === 'analysis-only-cantilever' ? 'IMPACT-001' : 'MODEL-001',
      sampleRateHz: fieldCapability === 'analysis-only-cantilever' ? 480 : 60,
      sampleCount: fieldCapability === 'analysis-only-cantilever' ? 4096 : 0,
      window: 'hann',
      impact: { u: impactU, v: impactV, strength: 1 },
      probes: fieldProbes,
      spectrum: fieldCapability === 'analysis-only-cantilever' ? syntheticFieldSpectrum() : emptyFieldSpectrum(),
      modes: fieldCapability === 'analysis-only-cantilever'
        ? [{
          index: 1,
          frequencySimulationHz: null,
          dampingRatio: null,
          spectralConfidence: null,
          mac: null,
          disclosure: 'Dominant peak, damping, and MAC are computed from an accepted capture. The bundled spectrum is synthetic-demo scaffolding only.',
        }]
        : [],
      captures: [0, 1, 2, 3, 4, 5].map((index) => ({
        index,
        status: fieldCapability === 'analysis-only-cantilever' && index === 0 ? 'armed' : 'empty',
        label: String(index + 1).padStart(3, '0'),
      })),
    },
  };
}

function makeCatalogManifest(lab: WorkbenchLabDefinition): EngineeringModelManifest {
  const id = lab.id;
  const assemblyId = `${id}:component:assembly`;
  const blueprint = GROUP_BLUEPRINTS[lab.group];
  return freezeManifest({
    labId: id,
    title: lab.title,
    revision: 'catalog-r1',
    detailLevel: 'catalog',
    group: lab.group,
    solver: lab.solver,
    summary: `${lab.description} This catalog manifest exposes ownership and evidence scope without implying production CAD detail.`,
    layers: standardLayers(id),
    components: [
      {
        id: assemblyId,
        label: `${lab.shortName} experiment assembly`,
        layerId: `${id}:layer:assembly`,
        kind: 'assembly',
        owner: 'workbench-definition',
        evidenceRole: 'scope-container',
        quantity: 1,
        note: 'Logical experiment root used for selection, grouping, and disclosure.',
      },
      {
        id: `${id}:component:numerical-domain`,
        label: blueprint.numericalLabel,
        layerId: `${id}:layer:numerical`,
        parentId: assemblyId,
        kind: 'specimen',
        owner: 'solver-runtime',
        evidenceRole: 'numerical-state',
        quantity: 1,
        material: blueprint.numericalMaterial,
        note: blueprint.numericalNote,
      },
      {
        id: `${id}:component:restraints`,
        label: blueprint.fixtureLabel,
        layerId: `${id}:layer:boundary`,
        parentId: assemblyId,
        kind: 'fixture',
        owner: 'workbench-definition',
        evidenceRole: 'boundary-condition',
        quantity: 1,
        note: blueprint.fixtureNote,
      },
      {
        id: `${id}:component:load-input`,
        label: blueprint.loadLabel,
        layerId: `${id}:layer:boundary`,
        parentId: assemblyId,
        kind: 'load-train',
        owner: 'workbench-definition',
        evidenceRole: 'boundary-condition',
        quantity: 1,
        note: 'The visible input witness follows the active authored force mode and its normalized control value.',
      },
      {
        id: `${id}:component:telemetry`,
        label: blueprint.measurementLabel,
        layerId: `${id}:layer:measurement`,
        parentId: assemblyId,
        kind: 'instrumentation',
        owner: 'workbench-definition',
        evidenceRole: 'derived-measurement',
        quantity: 1,
        note: 'Displayed channels are computed from numerical state; presentation effects do not contribute samples.',
      },
      {
        id: `${id}:component:context`,
        label: blueprint.contextLabel,
        layerId: `${id}:layer:presentation`,
        parentId: assemblyId,
        kind: 'environment',
        owner: 'renderer-presentation',
        evidenceRole: 'presentation-only',
        quantity: 1,
        note: 'Floor, lighting, guards, dust, spray, and other context improve legibility but are excluded from evidence.',
      },
    ],
    dimensions: [],
    limits: [
      {
        id: `${id}:limit:solver`,
        subject: 'Numerical method',
        status: 'reduced-order',
        disclosure: blueprint.solverLimit,
      },
      {
        id: `${id}:limit:detail`,
        subject: 'Engineering detail',
        status: 'not-modeled',
        disclosure: blueprint.omittedLimit,
      },
      {
        id: `${id}:limit:units`,
        subject: 'Scale and units',
        status: 'not-modeled',
        disclosure: 'All dimensions and loads remain normalized simulation values; no physical unit calibration is claimed.',
      },
      {
        id: `${id}:limit:presentation`,
        subject: 'Visual effects',
        status: 'presentation-only',
        disclosure: 'Lighting, particles, trails, glints, dust, foam, and fracture dressing are excluded from engineering evidence.',
      },
    ],
    ...buildWorkbenchPanels(lab, {
      specimenComponentId: `${id}:component:numerical-domain`,
      fixtureComponentId: `${id}:component:restraints`,
      instrumentComponentId: `${id}:component:telemetry`,
    }),
  });
}

function titanBendDentManifest(lab: WorkbenchLabDefinition): EngineeringModelManifest {
  const id = lab.id;
  const assemblyId = `${id}:component:assembly`;
  return freezeManifest({
    labId: id,
    title: lab.title,
    revision: 'flagship-r1',
    detailLevel: 'flagship',
    group: lab.group,
    solver: lab.solver,
    summary: 'A structured press-cell assembly around the live sheet lattice, with the load path, fixture ownership, and evidence boundary declared explicitly.',
    layers: standardLayers(id),
    focusBounds: bounds(point(-16.2, 0, -8.4), point(16.2, 16.9, 14.4)),
    components: [
      {
        id: assemblyId, label: 'Servo-hydraulic forming cell', layerId: `${id}:layer:assembly`, kind: 'assembly',
        owner: 'workbench-definition', evidenceRole: 'scope-container', quantity: 1,
        note: 'Logical root for the specimen, load train, reaction frame, measurement references, and room context.',
        bounds: bounds(point(-16.2, 0, -8.4), point(16.2, 16.9, 14.4)),
      },
      {
        id: `${id}:component:sheet-lattice`, label: 'Forming sheet lattice', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Steel response preset',
        note: 'The 48 by 11 node lattice owns elastic response, plastic set, damage state, and retained dent measurements.',
        bounds: bounds(point(-12, 7.16, -4.3), point(12, 7.28, 4.3)),
      },
      {
        id: `${id}:component:die-ring`, label: 'Four-edge die ring', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 4, material: 'Tool steel presentation material',
        note: 'The ring shows the perimeter clamp; edge-node inverse mass defines the actual numerical restraint.',
        bounds: bounds(point(-12.3, 6.38, -4.54), point(12.3, 7.2, 4.54)),
      },
      {
        id: `${id}:component:press-bed`, label: 'Anchored press bed', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Painted structural steel',
        note: 'Grounded visual reaction surface for reading the load path; it is not an additional collision solve.',
      },
      {
        id: `${id}:component:guide-columns`, label: 'Press guide columns', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 4, material: 'Dark structural steel',
        note: 'Presentation geometry keeps the moving punch visually registered to the frame.',
      },
      {
        id: `${id}:component:crosshead`, label: 'Fixed upper crosshead', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Painted structural steel',
        note: 'Completes the visible reaction loop from actuator barrel to the anchored bed.',
      },
      {
        id: `${id}:component:actuator-barrel`, label: 'Actuator barrel and telescoping sleeve', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Machined steel',
        note: 'The sleeve follows the live load progress; it does not add a second actuator model.',
      },
      {
        id: `${id}:component:punch-shoe`, label: 'Machined punch head', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Tool steel',
        note: 'A presentation skin around the kinematic sphere; frictional tool contact is not solved.',
        bounds: bounds(point(-1.18, 7.2, -1.18), point(1.18, 10.2, 1.18)),
      },
      {
        id: `${id}:component:bed-anchors`, label: 'Bed anchor group', layerId: `${id}:layer:boundary`, parentId: `${id}:component:press-bed`,
        kind: 'fixture', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 6, material: 'Galvanized steel',
        note: 'Scale-setting hardware only; bolt preload and foundation compliance are not modeled.',
      },
      {
        id: `${id}:component:load-channel`, label: 'Normalized actuator channel', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 1,
        note: 'Reports the commanded normalized load and progress from the active material run.',
      },
      {
        id: `${id}:component:denting-channel`, label: 'Deflection and residual-set channels', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 2,
        note: 'Values are derived from solved lattice node positions rather than a modeled transducer.',
      },
      {
        id: `${id}:component:side-guards`, label: 'Removable safety guards', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 2, material: 'Steel and safety glazing',
        note: 'Visible room-scale reference excluded from contact, loads, and measurements.',
      },
      {
        id: `${id}:component:test-cell`, label: 'Warehouse shop-floor shell', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'CMU walls, concrete floor, high-bay lights, and loading-bay markings establish shop context only.',
      },
      {
        id: `${id}:component:surface-effects`, label: 'Scuff, coating, and particle effects', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'effect', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'Visual response dressing is intentionally excluded from numerical evidence.',
      },
    ],
    dimensions: [
      { id: `${id}:dimension:sheet-span`, label: 'Authored sheet span', axis: 'X', value: 24, unit: 'simulation units', authority: 'authored-scene', note: 'Full lattice extent before deformation.', from: point(-12, 7.2, 0), to: point(12, 7.2, 0) },
      { id: `${id}:dimension:sheet-depth`, label: 'Authored sheet depth', axis: 'Z', value: 8.6, unit: 'simulation units', authority: 'authored-scene', note: 'Full transverse lattice extent.', from: point(0, 7.2, -4.3), to: point(0, 7.2, 4.3) },
      { id: `${id}:dimension:render-gauge`, label: 'Rendered sheet gauge', axis: 'Y', value: 0.036, unit: 'simulation units', authority: 'authored-scene', note: 'Display thickness only; no physical sheet gauge is claimed.' },
      { id: `${id}:dimension:punch-face`, label: 'Punch face width', axis: 'X', value: 2.36, unit: 'simulation units', authority: 'authored-scene', note: 'Rendered full width of the square applicator.' },
      { id: `${id}:dimension:cell-height`, label: 'Shop-bay clear height', axis: 'Y', value: 18.2, unit: 'simulation units', authority: 'authored-scene', note: 'Presentation envelope used for scene composition.' },
    ],
    limits: [
      { id: `${id}:limit:lattice`, subject: 'Sheet mechanics', status: 'reduced-order', disclosure: 'The specimen is a reduced-order beam lattice and is not a shell, solid, or calibrated finite-element model.' },
      { id: `${id}:limit:contact`, subject: 'Tool contact', status: 'not-modeled', disclosure: 'The punch is an authored load witness; explicit frictional tool contact and die draw-in are not solved.' },
      { id: `${id}:limit:fixtures`, subject: 'Fixture compliance', status: 'not-modeled', disclosure: 'The reaction frame, anchors, fasteners, and guards do not deform or contribute numerical stiffness.' },
      { id: `${id}:limit:units`, subject: 'Physical calibration', status: 'not-modeled', disclosure: 'Geometry, loads, and response are normalized; no force, stress, or material certification is implied.' },
      { id: `${id}:limit:effects`, subject: 'Surface and debris effects', status: 'presentation-only', disclosure: 'Scuff, coating, dust, sparks, and fragments are visual effects and are excluded from evidence.' },
    ],
    ...buildWorkbenchPanels(lab, {
      specimenComponentId: `${id}:component:sheet-lattice`,
      fixtureComponentId: `${id}:component:die-ring`,
      instrumentComponentId: `${id}:component:load-channel`,
    }),
  });
}

function crashRailManifest(lab: WorkbenchLabDefinition): EngineeringModelManifest {
  const id = lab.id;
  const assemblyId = `${id}:component:assembly`;
  return freezeManifest({
    labId: id,
    title: lab.title,
    revision: 'flagship-r1',
    detailLevel: 'flagship',
    group: lab.group,
    solver: lab.solver,
    summary: 'A guided axial-crush fixture organized around a solver-owned formed rail, with the pinned bulkhead end and moving terminal platen separated from visual hardware.',
    layers: standardLayers(id),
    focusBounds: bounds(point(-12.5, 0, -4.9), point(12.5, 11.0, 4.9)),
    components: [
      {
        id: assemblyId, label: 'Axial rail correlation rig', layerId: `${id}:layer:assembly`, kind: 'assembly',
        owner: 'workbench-definition', evidenceRole: 'scope-container', quantity: 1,
        note: 'Logical root for the rail, bulkhead, guided platen, sled foundation, and evidence references.',
        bounds: bounds(point(-12.5, 0, -4.9), point(12.5, 11.0, 4.9)),
      },
      {
        id: `${id}:component:formed-rail`, label: 'Formed aluminum rail lattice', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Aluminum response preset',
        note: 'A 48-station profiled lattice owns axial shortening, seeded folding, plastic set, and damage state.',
        bounds: bounds(point(-9, 4.45, -2.7), point(9, 9.95, 2.7)),
      },
      {
        id: `${id}:component:bulkhead`, label: 'Fixed reaction bulkhead', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Structural steel',
        note: 'Visually identifies the fixed end; the first two lattice stations own the actual restraint.',
      },
      {
        id: `${id}:component:clamp-stack`, label: 'Rail-to-bulkhead clamp stack', layerId: `${id}:layer:boundary`, parentId: `${id}:component:bulkhead`,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 2, material: 'Aluminum and steel',
        note: 'Upper and lower clamp witnesses make the pinned section legible without adding contact bodies.',
      },
      {
        id: `${id}:component:fastener-group`, label: 'Bulkhead fastener group', layerId: `${id}:layer:boundary`, parentId: `${id}:component:bulkhead`,
        kind: 'fixture', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 8, material: 'Blackened steel',
        note: 'Scale and assembly cue only; bolt preload, slip, and failure are not solved.',
      },
      {
        id: `${id}:component:guided-platen`, label: 'Terminal guided platen', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Tool steel',
        note: 'Tracks the solved terminal-section centroid to display the applied shortening path.',
        bounds: bounds(point(8.5, 4.0, -3.5), point(12.0, 10.4, 3.5)),
      },
      {
        id: `${id}:component:actuator-coupler`, label: 'Platen actuator coupler', layerId: `${id}:layer:boundary`, parentId: `${id}:component:guided-platen`,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Machined steel',
        note: 'Presentation of the normalized axial input, not a hydraulic or servo-control simulation.',
      },
      {
        id: `${id}:component:sled-rails`, label: 'Twin sled guide rails', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 2, material: 'Structural steel',
        note: 'Ground the axial load path visually; rail friction and guide contact are not solved.',
      },
      {
        id: `${id}:component:rail-shoes`, label: 'Sled foundation shoes', layerId: `${id}:layer:boundary`, parentId: `${id}:component:sled-rails`,
        kind: 'fixture', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 4, material: 'Painted steel',
        note: 'Presentation-only supports for a credible installed test rig.',
      },
      {
        id: `${id}:component:crush-channel`, label: 'Shortening and load-progress channels', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 2,
        note: 'Computed from normalized command state and solved node positions; no physical load cell is modeled.',
      },
      {
        id: `${id}:component:fold-markers`, label: 'Fold-station review markers', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'renderer-presentation', evidenceRole: 'derived-measurement', quantity: 5,
        note: 'Selection references follow solved lattice stations and do not create independent sensor channels.',
      },
      {
        id: `${id}:component:crash-cell`, label: 'Low-reflection crash-cell shell', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'Walls, task lights, floor channels, guards, and observation glazing provide realistic context only.',
      },
      {
        id: `${id}:component:fold-effects`, label: 'Surface fold and debris dressing', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'effect', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'Glints, flakes, dust, and other visual effects are excluded from evidence.',
      },
    ],
    dimensions: [
      { id: `${id}:dimension:rail-length`, label: 'Authored rail length', axis: 'X', value: 18, unit: 'simulation units', authority: 'authored-scene', note: 'Undeformed station-to-station lattice extent.', from: point(-9, 7.2, 0), to: point(9, 7.2, 0) },
      { id: `${id}:dimension:profile-envelope`, label: 'Profile envelope', axis: 'span', value: 5.4, unit: 'simulation units', authority: 'authored-scene', note: 'Normalized cross-section control depth, not a physical extrusion size.' },
      { id: `${id}:dimension:render-wall`, label: 'Rendered rail wall', axis: 'radial', value: 0.064, unit: 'simulation units', authority: 'authored-scene', note: 'Display thickness only; the lattice has no shell wall formulation.' },
      { id: `${id}:dimension:bulkhead-offset`, label: 'Bulkhead offset from rail end', axis: 'X', value: 0.62, unit: 'simulation units', authority: 'authored-scene', note: 'Authored fixture layout value.' },
      { id: `${id}:dimension:guide-spacing`, label: 'Guide-rail spacing', axis: 'Z', value: 7.4, unit: 'simulation units', authority: 'authored-scene', note: 'Approximate center-to-center presentation spacing.' },
    ],
    limits: [
      { id: `${id}:limit:lattice`, subject: 'Crush mechanics', status: 'reduced-order', disclosure: 'Progressive folding emerges from a profiled lattice with seeded imperfections, not a shell or solid crash finite-element model.' },
      { id: `${id}:limit:contact`, subject: 'Platen and guide contact', status: 'not-modeled', disclosure: 'The platen follows terminal solver state; friction, guide clearance, and explicit platen contact are not solved.' },
      { id: `${id}:limit:joints`, subject: 'Joints and fasteners', status: 'not-modeled', disclosure: 'Welds, bolts, clamp slip, fracture, and bulkhead compliance are visual or omitted.' },
      { id: `${id}:limit:units`, subject: 'Physical calibration', status: 'not-modeled', disclosure: 'Shortening, force demand, and energy are normalized and cannot certify a production crash rail.' },
      { id: `${id}:limit:effects`, subject: 'Visual damage dressing', status: 'presentation-only', disclosure: 'Scuff, debris, dust, sparks, and glints do not participate in the solver or measurements.' },
    ],
    ...buildWorkbenchPanels(lab, {
      specimenComponentId: `${id}:component:formed-rail`,
      fixtureComponentId: `${id}:component:bulkhead`,
      instrumentComponentId: `${id}:component:crush-channel`,
    }),
  });
}

function compositeCouponManifest(lab: WorkbenchLabDefinition): EngineeringModelManifest {
  const id = lab.id;
  const assemblyId = `${id}:component:assembly`;
  return freezeManifest({
    labId: id,
    title: lab.title,
    revision: 'flagship-r1',
    detailLevel: 'flagship',
    group: lab.group,
    solver: lab.solver,
    summary: 'A cantilevered anisotropic coupon rig whose clamp stack, solver lattice, response taps, and presentation-only foundation are independently identified.',
    layers: standardLayers(id),
    focusBounds: bounds(point(-15.5, 0, -5.0), point(14.0, 11.2, 5.0)),
    components: [
      {
        id: assemblyId, label: 'Composite coupon test assembly', layerId: `${id}:layer:assembly`, kind: 'assembly',
        owner: 'workbench-definition', evidenceRole: 'scope-container', quantity: 1,
        note: 'Logical root for the numerical coupon, fixed-end fixture, applied demand, review taps, and stage.',
        bounds: bounds(point(-15.5, 0, -5.0), point(14.0, 11.2, 5.0)),
      },
      {
        id: `${id}:component:anisotropic-lattice`, label: 'Anisotropic coupon lattice', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Directional composite preset',
        note: 'Directional constraint families own flexure, weaker transverse failure, damage, and residual displacement.',
        bounds: bounds(point(-12, 7.08, -2.7), point(12, 7.32, 2.7)),
      },
      {
        id: `${id}:component:fixed-node-band`, label: 'Fixed-end node band', layerId: `${id}:layer:numerical`, parentId: `${id}:component:anisotropic-lattice`,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'boundary-condition', quantity: 1,
        note: 'The first two solver stations own the cantilever restraint; the visible clamp is explanatory geometry.',
        bounds: bounds(point(-12.0, 7.08, -2.7), point(-10.98, 7.32, 2.7)),
      },
      {
        id: `${id}:component:rear-reaction-plate`, label: 'Rear reaction plate', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1, material: 'Structural steel',
        note: 'Presents the fixed-end reaction path without contributing solver stiffness.',
        bounds: bounds(point(-13.94, 0.55, -4.32), point(-13.62, 6.75, 4.32)),
      },
      {
        id: `${id}:component:clamp-jaws`, label: 'Twin coupon clamp jaws', layerId: `${id}:layer:boundary`, parentId: `${id}:component:rear-reaction-plate`,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 2, material: 'Machined steel',
        note: 'Visible jaws align with the pinned station band; pressure and friction are not modeled.',
        bounds: bounds(point(-12.94, 6.44, -3.68), point(-11.54, 8.88, 3.68)),
      },
      {
        id: `${id}:component:fixture-gussets`, label: 'Reaction-frame gussets', layerId: `${id}:layer:boundary`, parentId: `${id}:component:rear-reaction-plate`,
        kind: 'fixture', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 2, material: 'Painted steel',
        note: 'Reinforces the visual load path only and adds no numerical stiffness.',
        bounds: bounds(point(-14.82, 0.52, -3.28), point(-12.62, 3.92, 3.28)),
      },
      {
        id: `${id}:component:clamp-bolts`, label: 'Clamp fastener group', layerId: `${id}:layer:boundary`, parentId: `${id}:component:clamp-jaws`,
        kind: 'fixture', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 6, material: 'Bright steel',
        note: 'Scale-setting fasteners; preload, bearing, and failure are not solved.',
        bounds: bounds(point(-11.63, 6.21, -3.03), point(-11.41, 8.19, 3.03)),
      },
      {
        id: `${id}:component:tip-load`, label: 'Authored cantilever demand', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1,
        note: 'Applies normalized demand through the active material load field rather than explicit gripping contact.',
        bounds: bounds(point(10.92, 7.18, -0.30), point(11.62, 7.75, 0.30)),
      },
      {
        id: `${id}:component:response-taps`, label: 'Solver-node response taps', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'renderer-presentation', evidenceRole: 'derived-measurement', quantity: 5,
        note: 'Markers follow actual lattice nodes for review but do not represent separate hardware sensors.',
        bounds: bounds(point(-7.35, 7.18, -0.42), point(10.55, 7.82, 0.42)),
      },
      {
        id: `${id}:component:failure-channels`, label: 'Directional response channels', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 3,
        note: 'Deflection, constraint damage, and failure counts are derived from solver state.',
      },
      {
        id: `${id}:component:fixture-base`, label: 'Grounded fixture base', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1, material: 'Sealed steel base',
        note: 'Provides credible installation and scale without entering the solve.',
        bounds: bounds(point(-15.4, 0, -4.65), point(-8.4, 0.68, 4.65)),
      },
      {
        id: `${id}:component:coupon-effects`, label: 'Failure and surface effects', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'effect', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'Surface contouring, glints, and detached visual dressing are excluded from evidence.',
      },
    ],
    dimensions: [
      { id: `${id}:dimension:coupon-span`, label: 'Authored coupon span', axis: 'X', value: 24, unit: 'simulation units', authority: 'authored-scene', note: 'Full undeformed numerical span.', from: point(-12, 7.2, 0), to: point(12, 7.2, 0) },
      { id: `${id}:dimension:coupon-width`, label: 'Authored coupon width', axis: 'Z', value: 5.4, unit: 'simulation units', authority: 'authored-scene', note: 'Transverse numerical extent.', from: point(0, 7.2, -2.7), to: point(0, 7.2, 2.7) },
      { id: `${id}:dimension:render-thickness`, label: 'Rendered coupon thickness', axis: 'Y', value: 0.18, unit: 'simulation units', authority: 'authored-scene', note: 'Display thickness only; no laminate ply stack is represented.' },
      { id: `${id}:dimension:fixed-band`, label: 'Fixed station band', axis: 'X', value: 1.02, unit: 'simulation units', authority: 'authored-scene', note: 'Approximate authored width of the first two restrained stations.' },
      { id: `${id}:dimension:tap-count`, label: 'Response-tap layout pitch', axis: 'X', value: 3.1, unit: 'simulation units', authority: 'authored-scene', note: 'Approximate review-marker pitch across five selected solver stations.' },
    ],
    limits: [
      { id: `${id}:limit:laminate`, subject: 'Laminate mechanics', status: 'reduced-order', disclosure: 'Anisotropy is represented by directional lattice constraints, not laminate theory, ply-by-ply damage, or continuum mechanics.' },
      { id: `${id}:limit:clamp`, subject: 'Clamp interface', status: 'not-modeled', disclosure: 'The fixed node band owns the restraint; jaw pressure, friction, slip, and bearing damage are not solved.' },
      { id: `${id}:limit:failure`, subject: 'Failure modes', status: 'reduced-order', disclosure: 'Constraint damage is qualitative and cannot distinguish matrix cracking, delamination, fiber pullout, or interlaminar failure.' },
      { id: `${id}:limit:units`, subject: 'Physical calibration', status: 'not-modeled', disclosure: 'Geometry and demand remain normalized; no coupon standard, material allowables, or certification result is claimed.' },
      { id: `${id}:limit:effects`, subject: 'Visual effects', status: 'presentation-only', disclosure: 'Contours, flakes, glints, and detached dressing are excluded from numerical evidence.' },
    ],
    ...buildWorkbenchPanels(lab, {
      specimenComponentId: `${id}:component:anisotropic-lattice`,
      fixtureComponentId: `${id}:component:clamp-jaws`,
      instrumentComponentId: `${id}:component:response-taps`,
    }),
  });
}

function apexProvingGroundManifest(lab: WorkbenchLabDefinition): EngineeringModelManifest {
  const id = lab.id;
  const assemblyId = `${id}:component:assembly`;
  return freezeManifest({
    labId: id,
    title: lab.title,
    revision: 'flagship-r1',
    detailLevel: 'flagship',
    group: lab.group,
    solver: lab.solver,
    summary: 'A three-bay proving ground that schedules metal, glass, and concrete rigs under one run clock while preserving separate numerical ownership and limitations.',
    layers: standardLayers(id),
    focusBounds: bounds(point(-44, 0, -14), point(44, 14.7, 14)),
    components: [
      {
        id: assemblyId, label: 'Three-bay materials proving ground', layerId: `${id}:layer:assembly`, kind: 'assembly',
        owner: 'workbench-definition', evidenceRole: 'scope-container', quantity: 1,
        note: 'Logical root for three independent numerical rigs, their fixtures, synchronized review channels, and shared hall.',
        bounds: bounds(point(-44, 0, -14), point(44, 14.7, 14)),
      },
      {
        id: `${id}:component:metal-rig`, label: 'Metal forming lattice bay', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Steel response preset',
        note: 'Independent solver state offset to the west bay; it does not contact the other specimens.',
        bounds: bounds(point(-38, 6.9, -4.3), point(-14, 7.5, 4.3)),
      },
      {
        id: `${id}:component:glass-rig`, label: 'Brittle glass lattice bay', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Glass response preset',
        note: 'Independent central-bay lattice state with qualitative crack and fragment progression.',
        bounds: bounds(point(-12, 2.6, -0.2), point(12, 11.8, 0.4)),
      },
      {
        id: `${id}:component:concrete-rig`, label: 'Reinforced concrete lattice bay', layerId: `${id}:layer:numerical`, parentId: assemblyId,
        kind: 'specimen', owner: 'solver-runtime', evidenceRole: 'numerical-state', quantity: 1, material: 'Concrete and reinforcement presets',
        note: 'Independent east-bay lattice state with separately tagged reinforcement constraints.',
        bounds: bounds(point(14, 6.4, -5.0), point(38, 7.8, 5.0)),
      },
      {
        id: `${id}:component:metal-frame`, label: 'Metal-bay press fixture', layerId: `${id}:layer:boundary`, parentId: `${id}:component:metal-rig`,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1,
        note: 'Explains the metal boundary and normalized load path; fixed nodes own the numerical restraint.',
      },
      {
        id: `${id}:component:glass-frame`, label: 'Glass-bay support frame', layerId: `${id}:layer:boundary`, parentId: `${id}:component:glass-rig`,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1,
        note: 'Explains the glass perimeter restraint without adding structural-frame compliance.',
      },
      {
        id: `${id}:component:concrete-frame`, label: 'Concrete-bay reaction fixture', layerId: `${id}:layer:boundary`, parentId: `${id}:component:concrete-rig`,
        kind: 'fixture', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 1,
        note: 'Explains concrete supports and actuator location; fixture response is not solved.',
      },
      {
        id: `${id}:component:load-trains`, label: 'Independent bay load trains', layerId: `${id}:layer:boundary`, parentId: assemblyId,
        kind: 'load-train', owner: 'workbench-definition', evidenceRole: 'boundary-condition', quantity: 3,
        note: 'Each visible applicator follows its own normalized solver input despite sharing the run clock.',
      },
      {
        id: `${id}:component:run-coordinator`, label: 'Shared run-clock coordinator', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 1,
        note: 'Synchronizes stepping and comparison views; it does not create numerical coupling between bays.',
      },
      {
        id: `${id}:component:bay-telemetry`, label: 'Bay-specific telemetry groups', layerId: `${id}:layer:measurement`, parentId: assemblyId,
        kind: 'instrumentation', owner: 'workbench-definition', evidenceRole: 'derived-measurement', quantity: 3,
        note: 'Each group is derived only from its owning solver state and preserves that provenance.',
      },
      {
        id: `${id}:component:bay-separators`, label: 'Marked bay separators', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 3,
        note: 'Floor zones and visual spacing reinforce the independent numerical scopes.',
      },
      {
        id: `${id}:component:proving-hall`, label: 'Shared proving-hall shell', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'environment', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 1,
        note: 'Floor, structure, lighting, and glazing establish scale and do not participate in any rig.',
      },
      {
        id: `${id}:component:combined-effects`, label: 'Bay-specific visual effects', layerId: `${id}:layer:presentation`, parentId: assemblyId,
        kind: 'effect', owner: 'renderer-presentation', evidenceRole: 'presentation-only', quantity: 3,
        note: 'Sparks, glass dressing, concrete dust, and debris remain visual and are excluded from comparison data.',
      },
    ],
    dimensions: [
      { id: `${id}:dimension:hall-span`, label: 'Authored hall span', axis: 'X', value: 88, unit: 'simulation units', authority: 'authored-scene', note: 'Aggregate presentation envelope across all bays.', from: point(-44, 0, 0), to: point(44, 0, 0) },
      { id: `${id}:dimension:bay-pitch`, label: 'Bay center pitch', axis: 'X', value: 26, unit: 'simulation units', authority: 'authored-scene', note: 'Offset between the metal, glass, and concrete numerical origins.' },
      { id: `${id}:dimension:hall-depth`, label: 'Authored hall depth', axis: 'Z', value: 28, unit: 'simulation units', authority: 'authored-scene', note: 'Aggregate presentation envelope.' },
      { id: `${id}:dimension:hall-height`, label: 'Authored hall height', axis: 'Y', value: 14.7, unit: 'simulation units', authority: 'authored-scene', note: 'Presentation structure envelope.' },
    ],
    limits: [
      { id: `${id}:limit:coupling`, subject: 'Cross-bay coupling', status: 'not-modeled', disclosure: 'The metal, glass, and concrete rigs share a clock and render stream only; no contact, load, or state crosses bay boundaries.' },
      { id: `${id}:limit:methods`, subject: 'Material methods', status: 'reduced-order', disclosure: 'All three specimens are reduced-order lattices with material-specific presets rather than calibrated continuum models.' },
      { id: `${id}:limit:fixtures`, subject: 'Fixtures and hall', status: 'presentation-only', disclosure: 'Frames, applicators, floor structure, barriers, and fasteners visually explain the experiment but do not form a coupled facility model.' },
      { id: `${id}:limit:comparison`, subject: 'Comparison scope', status: 'represented', disclosure: 'Synchronized normalized telemetry supports side-by-side qualitative comparison within this implementation.' },
      { id: `${id}:limit:units`, subject: 'Physical calibration', status: 'not-modeled', disclosure: 'No common force, stress, length, or time calibration is implied across the three material rigs.' },
      { id: `${id}:limit:effects`, subject: 'Visual effects', status: 'presentation-only', disclosure: 'Dust, shards, sparks, scuff, lighting, and debris dressing are excluded from evidence.' },
    ],
    ...buildWorkbenchPanels(lab, {
      specimenComponentId: `${id}:component:metal-rig`,
      fixtureComponentId: `${id}:component:metal-frame`,
      instrumentComponentId: `${id}:component:bay-telemetry`,
      extraMembers: [
        {
          id: `${id}:member:glass-specimen`,
          componentId: `${id}:component:glass-rig`,
          label: 'Brittle glass lattice bay',
          role: 'specimen',
          materialId: `${id}:material:soda-lime-glass`,
          metrics: [
            metric(`${id}:metric:glass-span`, 'span', 'Glass bay span', 24, 'simulation units'),
            metric(`${id}:metric:glass-thickness`, 'thickness', 'Display thickness', 0.12, 'simulation units'),
          ],
        },
        {
          id: `${id}:member:concrete-specimen`,
          componentId: `${id}:component:concrete-rig`,
          label: 'Reinforced concrete lattice bay',
          role: 'specimen',
          materialId: `${id}:material:reinforced-concrete`,
          metrics: [
            metric(`${id}:metric:concrete-span`, 'span', 'Concrete bay span', 24, 'simulation units'),
            metric(`${id}:metric:concrete-thickness`, 'thickness', 'Display thickness', 0.22, 'simulation units'),
          ],
        },
      ],
    }),
  });
}

type FlagshipBuilder = (lab: WorkbenchLabDefinition) => EngineeringModelManifest;

const FLAGSHIP_BUILDERS: Readonly<Record<string, FlagshipBuilder>> = Object.freeze({
  'titan-bend-dent': titanBendDentManifest,
  'crash-rail-axial-fold': crashRailManifest,
  'composite-coupon': compositeCouponManifest,
  'apex-proving-ground': apexProvingGroundManifest,
});

/** Stable one-to-one engineering manifest list in workbench registry order. */
export const ENGINEERING_MODELS: readonly EngineeringModelManifest[] = Object.freeze(
  WORKBENCH_LABS.map((lab) => (FLAGSHIP_BUILDERS[lab.id] ?? makeCatalogManifest)(lab)),
);

const modelsByLabId = new Map(ENGINEERING_MODELS.map((model) => [model.labId, model] as const));

function isFinitePoint(value: EngineeringPoint): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

function assertBounds(value: EngineeringBounds, label: string): void {
  if (value.space !== 'world' || !isFinitePoint(value.min) || !isFinitePoint(value.max)) {
    throw new Error(`${label} must use finite world-space bounds.`);
  }
  for (let axis = 0; axis < 3; axis++) {
    if (value.min[axis] >= value.max[axis]) {
      throw new Error(`${label} must have positive extent on every axis.`);
    }
  }
}

/**
 * Validates registry coverage, hierarchy integrity, finite authored geometry,
 * and the aggregate UI/detail budget. Throws on the first invalid contract.
 */
export function validateEngineeringModelRegistry(
  models: readonly EngineeringModelManifest[] = ENGINEERING_MODELS,
): void {
  if (models.length !== WORKBENCH_LABS.length) {
    throw new Error(`Engineering model registry must contain exactly ${WORKBENCH_LABS.length} manifests; received ${models.length}.`);
  }

  const expectedLabIds = new Set<string>(WORKBENCH_LABS.map((lab) => lab.id));
  const modelIds = new Set<string>();
  const globalLayerIds = new Set<string>();
  const globalComponentIds = new Set<string>();
  const globalDimensionIds = new Set<string>();
  const globalLimitIds = new Set<string>();
  let componentTotal = 0;

  for (const model of models) {
    if (!expectedLabIds.has(model.labId)) {
      throw new Error(`Engineering model '${model.labId}' does not match a workbench lab.`);
    }
    if (modelIds.has(model.labId)) throw new Error(`Engineering model '${model.labId}' is duplicated.`);
    modelIds.add(model.labId);

    if (model.schemaVersion !== ENGINEERING_MODEL_SCHEMA_VERSION) {
      throw new Error(`Engineering model '${model.labId}' has unsupported schema '${model.schemaVersion}'.`);
    }
    if (model.coordinateFrame.upAxis !== 'Y' || model.coordinateFrame.units !== 'normalized simulation units') {
      throw new Error(`Engineering model '${model.labId}' must use Y-up normalized simulation units.`);
    }
    if (!model.title.trim() || !model.summary.trim() || !model.revision.trim()) {
      throw new Error(`Engineering model '${model.labId}' must include title, summary, and revision.`);
    }
    if (model.layers.length === 0 || model.components.length === 0 || model.limits.length === 0) {
      throw new Error(`Engineering model '${model.labId}' must declare layers, components, and limits.`);
    }
    if (model.focusBounds) assertBounds(model.focusBounds, `Engineering model '${model.labId}' focus`);

    const layerIds = new Set<string>();
    for (const layer of model.layers) {
      if (!layer.id.trim() || !layer.label.trim()) throw new Error(`Engineering model '${model.labId}' has an unlabeled layer.`);
      if (layerIds.has(layer.id) || globalLayerIds.has(layer.id)) throw new Error(`Engineering layer id '${layer.id}' is duplicated.`);
      layerIds.add(layer.id);
      globalLayerIds.add(layer.id);
    }
    for (const layer of model.layers) {
      if (layer.parentId && !layerIds.has(layer.parentId)) {
        throw new Error(`Engineering layer '${layer.id}' references missing parent '${layer.parentId}'.`);
      }
      if (layer.parentId === layer.id) throw new Error(`Engineering layer '${layer.id}' cannot parent itself.`);
    }

    const componentIds = new Set<string>();
    for (const component of model.components) {
      if (!component.id.trim() || !component.label.trim() || !component.note.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an incomplete component.`);
      }
      if (componentIds.has(component.id) || globalComponentIds.has(component.id)) {
        throw new Error(`Engineering component id '${component.id}' is duplicated.`);
      }
      if (!layerIds.has(component.layerId)) {
        throw new Error(`Engineering component '${component.id}' references missing layer '${component.layerId}'.`);
      }
      if (!Number.isInteger(component.quantity) || component.quantity <= 0) {
        throw new Error(`Engineering component '${component.id}' must have a positive integer quantity.`);
      }
      if (component.bounds) assertBounds(component.bounds, `Engineering component '${component.id}'`);
      componentIds.add(component.id);
      globalComponentIds.add(component.id);
    }
    for (const component of model.components) {
      if (component.parentId && !componentIds.has(component.parentId)) {
        throw new Error(`Engineering component '${component.id}' references missing parent '${component.parentId}'.`);
      }
      if (component.parentId === component.id) throw new Error(`Engineering component '${component.id}' cannot parent itself.`);
    }

    for (const dimension of model.dimensions) {
      if (globalDimensionIds.has(dimension.id)) throw new Error(`Engineering dimension id '${dimension.id}' is duplicated.`);
      if (!dimension.id.trim() || !dimension.label.trim() || !dimension.note.trim()
        || !Number.isFinite(dimension.value) || dimension.value <= 0) {
        throw new Error(`Engineering model '${model.labId}' has an invalid authored dimension.`);
      }
      if ((dimension.from === undefined) !== (dimension.to === undefined)
        || (dimension.from && !isFinitePoint(dimension.from))
        || (dimension.to && !isFinitePoint(dimension.to))) {
        throw new Error(`Engineering dimension '${dimension.id}' has invalid endpoints.`);
      }
      globalDimensionIds.add(dimension.id);
    }

    for (const limit of model.limits) {
      if (globalLimitIds.has(limit.id)) throw new Error(`Engineering limit id '${limit.id}' is duplicated.`);
      if (!limit.id.trim() || !limit.subject.trim() || !limit.disclosure.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an incomplete model-limit disclosure.`);
      }
      globalLimitIds.add(limit.id);
    }

    if (model.materials.length === 0) {
      throw new Error(`Engineering model '${model.labId}' must declare at least one material card.`);
    }
    const materialIds = new Set<string>();
    for (const material of model.materials) {
      if (materialIds.has(material.id) || !material.id.trim() || !material.label.trim() || !material.disclosure.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an invalid material card.`);
      }
      if (!Number.isFinite(material.displayThickness) || material.displayThickness < 0
        || !Number.isFinite(material.hardening) || material.hardening < 0 || material.hardening > 1) {
        throw new Error(`Engineering material '${material.id}' has invalid comparative coefficients.`);
      }
      materialIds.add(material.id);
    }
    if (!materialIds.has(model.primaryMaterialId)) {
      throw new Error(`Engineering model '${model.labId}' primary material '${model.primaryMaterialId}' is missing.`);
    }

    if (model.members.length === 0) {
      throw new Error(`Engineering model '${model.labId}' must declare structural members.`);
    }
    const memberIds = new Set<string>();
    let specimenCount = 0;
    for (const member of model.members) {
      if (memberIds.has(member.id) || !member.id.trim() || !member.label.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an invalid structural member.`);
      }
      if (!componentIds.has(member.componentId)) {
        throw new Error(`Engineering member '${member.id}' references missing component '${member.componentId}'.`);
      }
      if (!materialIds.has(member.materialId)) {
        throw new Error(`Engineering member '${member.id}' references missing material '${member.materialId}'.`);
      }
      if (member.role === 'specimen') specimenCount += 1;
      for (const entry of member.metrics) {
        if (!entry.id.trim() || !entry.label.trim() || !Number.isFinite(entry.value) || entry.value < 0) {
          throw new Error(`Engineering member '${member.id}' has an invalid metric.`);
        }
      }
      memberIds.add(member.id);
    }
    if (specimenCount === 0) {
      throw new Error(`Engineering model '${model.labId}' must declare a specimen member.`);
    }

    if (!model.loadCase.name.trim() || !Number.isFinite(model.loadCase.target) || model.loadCase.target < 0
      || !Number.isFinite(model.loadCase.rate) || model.loadCase.rate <= 0) {
      throw new Error(`Engineering model '${model.labId}' has an invalid load case.`);
    }
    if (!model.overlays.some((overlay) => overlay.id === model.defaultOverlay)) {
      throw new Error(`Engineering model '${model.labId}' default overlay is not in the overlay list.`);
    }
    if (model.channels.length < 3) {
      throw new Error(`Engineering model '${model.labId}' must declare at least three demo channels.`);
    }
    const channelIds = new Set<string>();
    for (const channel of model.channels) {
      if (channelIds.has(channel.id) || !channel.id.trim() || !channel.label.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an invalid demo channel.`);
      }
      channelIds.add(channel.id);
    }

    const correlationChannelIds = new Set<string>();
    for (const channel of model.correlation.channels) {
      if (correlationChannelIds.has(channel.id) || !channel.id.trim() || !channel.label.trim()) {
        throw new Error(`Engineering model '${model.labId}' has an invalid correlation channel.`);
      }
      correlationChannelIds.add(channel.id);
    }
    if (model.correlation.series.length === 0 || model.correlation.bookmarks.length === 0 || model.correlation.checks.length === 0) {
      throw new Error(`Engineering model '${model.labId}' must declare correlation series, bookmarks, and checks.`);
    }
    for (const series of model.correlation.series) {
      if (!correlationChannelIds.has(series.channelId)) {
        throw new Error(`Engineering series '${series.id}' references missing correlation channel '${series.channelId}'.`);
      }
      if (series.times.length < 8 || series.times.length !== series.reference.length || series.times.length !== series.candidate.length) {
        throw new Error(`Engineering series '${series.id}' must have aligned finite demo samples.`);
      }
      for (let index = 0; index < series.times.length; index++) {
        if (!Number.isFinite(series.times[index]) || !Number.isFinite(series.reference[index]) || !Number.isFinite(series.candidate[index])) {
          throw new Error(`Engineering series '${series.id}' contains a non-finite sample.`);
        }
        if (index > 0 && series.times[index] < series.times[index - 1]) {
          throw new Error(`Engineering series '${series.id}' times must be non-decreasing.`);
        }
      }
    }
    let energyFraction = 0;
    for (const term of model.correlation.energyBalance) {
      if (!term.id.trim() || !term.label.trim() || !Number.isFinite(term.fraction) || term.fraction < 0) {
        throw new Error(`Engineering model '${model.labId}' has an invalid energy-balance term.`);
      }
      energyFraction += term.fraction;
    }
    if (model.correlation.energyBalance.length === 0 || Math.abs(energyFraction - 1) > 1e-6) {
      throw new Error(`Engineering model '${model.labId}' energy-balance fractions must sum to 1.`);
    }

    const expectedFieldCapability: EngineeringFieldCapability = model.labId === 'composite-coupon'
      ? 'analysis-only-cantilever'
      : 'none';
    if (model.field.capability !== expectedFieldCapability) {
      throw new Error(`Engineering model '${model.labId}' has unexpected field capability '${model.field.capability}'.`);
    }
    if (model.field.probes.length !== 5 || model.field.captures.length !== 6) {
      throw new Error(`Engineering model '${model.labId}' must declare five field probes and six capture slots.`);
    }
    const probeIds = new Set<string>();
    for (const probe of model.field.probes) {
      if (probeIds.has(probe.id) || !probe.id.trim() || !probe.label.trim()
        || !Number.isFinite(probe.u) || !Number.isFinite(probe.v)
        || probe.u < 0 || probe.u > 1 || probe.v < 0 || probe.v > 1) {
        throw new Error(`Engineering model '${model.labId}' has an invalid field probe.`);
      }
      probeIds.add(probe.id);
    }
    if (!Number.isFinite(model.field.impact.u) || !Number.isFinite(model.field.impact.v)
      || model.field.impact.u < 0 || model.field.impact.u > 1
      || model.field.impact.v < 0 || model.field.impact.v > 1) {
      throw new Error(`Engineering model '${model.labId}' has an invalid field impact target.`);
    }
    const spectrum = model.field.spectrum;
    if (spectrum.frequencies.length !== spectrum.amplitudeDb.length
      || spectrum.frequencies.length !== spectrum.relativePower.length) {
      throw new Error(`Engineering model '${model.labId}' field spectrum arrays must align.`);
    }
    if (model.field.capability === 'analysis-only-cantilever') {
      if (model.field.sampleRateHz !== 480 || model.field.sampleCount !== 4096 || spectrum.frequencies.length === 0) {
        throw new Error(`Engineering model '${model.labId}' must ship the analysis-only cantilever request and a synthetic-demo spectrum.`);
      }
    }

    componentTotal += model.components.length;
  }

  for (const labId of expectedLabIds) {
    if (!modelIds.has(labId)) throw new Error(`Workbench lab '${labId}' is missing an engineering model manifest.`);
  }
  if (modelIds.size !== expectedLabIds.size) {
    throw new Error(`Engineering model coverage mismatch: ${modelIds.size} manifests for ${expectedLabIds.size} workbench labs.`);
  }
  if (componentTotal > ENGINEERING_MODEL_COMPONENT_CAP) {
    throw new Error(`Engineering model registry exceeds the ${ENGINEERING_MODEL_COMPONENT_CAP}-component aggregate cap (${componentTotal}).`);
  }
}

validateEngineeringModelRegistry();

/** Returns the stable manifest for a workbench lab, or null for an unknown id. */
export function getEngineeringModelForLab(labId: string): EngineeringModelManifest | null {
  return modelsByLabId.get(labId) ?? null;
}
