/**
 * Versioned, dependency-free interchange contracts for engineering runs.
 *
 * The workbench's numerical models are deterministic, but most of their
 * outputs are normalized or reduced-order. These guards prevent those values
 * from silently acquiring calibrated engineering units during import/export.
 */

export const RUN_RECORD_SCHEMA_V1 = 'box3d.run/1' as const;
export const TEST_DATASET_SCHEMA_V1 = 'box3d.test-data/1' as const;
export const ENGINEERING_EVIDENCE_SCHEMA_V1 = 'box3d.evidence/1' as const;
export const CANONICAL_JSON_SCHEMA_V1 = 'box3d-canonical-json/1' as const;

export const DATA_PROVENANCES = [
  'solver-native',
  'derived',
  'user-calibrated',
  'imported',
  'synthetic-demo',
] as const;
export type DataProvenance = (typeof DATA_PROVENANCES)[number];

export const CLAIM_LEVELS = ['normalized', 'reduced-order', 'calibrated'] as const;
export type ClaimLevel = (typeof CLAIM_LEVELS)[number];

export const MEASUREMENT_QUANTITIES = [
  'time',
  'load',
  'force',
  'displacement',
  'velocity',
  'acceleration',
  'strain',
  'damage',
  'energy',
  'height',
  'pressure',
  'frequency',
  'amplitude',
  'count',
  'hash',
  'other',
] as const;
export type MeasurementQuantity = (typeof MEASUREMENT_QUANTITIES)[number];

/** Units deliberately supported by the v1 evidence boundary. */
export const ENGINEERING_UNITS = [
  'none',
  's',
  'normalized',
  'ratio',
  '%',
  'strain',
  'simulation-unit',
  'simulation-unit/s',
  'simulation-unit/s^2',
  'normalized-energy',
  'model-Hz',
  'count',
  'hash',
  'dB',
  'N',
  'kN',
  'Pa',
  'kPa',
  'MPa',
  'm',
  'mm',
  'µm',
  'm/s',
  'mm/s',
  'm/s^2',
  'g',
  'J',
  'kJ',
  'Hz',
  'µε',
  'V',
  'mV',
] as const;
export type EngineeringUnit = (typeof ENGINEERING_UNITS)[number];

export type ChannelUncertaintyV1 = {
  readonly kind: 'absolute' | 'relative-1sigma' | 'relative-2sigma';
  readonly value: number;
  readonly unit?: EngineeringUnit;
};

export type ChannelDescriptorV1 = {
  readonly id: string;
  readonly label: string;
  readonly quantity: MeasurementQuantity;
  readonly unit: EngineeringUnit;
  readonly provenance: DataProvenance;
  readonly sampleRateHz?: number;
  readonly calibrationId?: string;
  readonly sourceChannelIds?: readonly string[];
  readonly uncertainty?: ChannelUncertaintyV1;
};

export type SampleTableV1 = {
  /** Simulation or acquisition time. Pre-trigger imported values may be negative. */
  readonly timeS: readonly number[];
  readonly values: Readonly<Record<string, readonly (number | null)[]>>;
};

export const RUN_EVENT_SEVERITIES = ['info', 'pass', 'warning', 'danger'] as const;
export type RunEventSeverityV1 = (typeof RUN_EVENT_SEVERITIES)[number];

export const RUN_EVENT_KINDS = [
  'preflight',
  'armed',
  'load-step',
  'hold',
  'impact',
  'limit-warning',
  'bookmark',
  'complete',
  'abort',
  'actuator-load',
  'annotation',
  'pause',
] as const;
export type RunEventKindV1 = (typeof RUN_EVENT_KINDS)[number];

export type RunEventV1 = {
  readonly id: string;
  readonly timeS: number;
  readonly step: number;
  readonly kind: string;
  readonly label: string;
  readonly severity?: RunEventSeverityV1;
  readonly parameters?: Readonly<Record<string, number | string | boolean | null>>;
};

export type RunRecordV1 = {
  readonly schema: typeof RUN_RECORD_SCHEMA_V1;
  readonly runId: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly claimLevel: ClaimLevel;
  readonly lab: {
    readonly id: string;
    readonly title: string;
    readonly sceneId: number;
    readonly materialDemoId?: string;
    readonly solver: string;
    readonly fidelity: string;
  };
  readonly engine: {
    readonly backend: string;
    readonly isWasm: boolean;
    readonly buildVersion: string;
    readonly seed: number;
    readonly fixedStepS: number;
    readonly substeps: number;
  };
  readonly parameters: Readonly<Record<string, number>>;
  readonly events: readonly RunEventV1[];
  readonly channels: readonly ChannelDescriptorV1[];
  readonly samples: SampleTableV1;
  readonly final: {
    readonly backendHash: number;
    readonly softHash: number;
    readonly warnings: readonly string[];
  };
};

export type TestDatasetV1 = {
  readonly schema: typeof TEST_DATASET_SCHEMA_V1;
  readonly datasetId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly source: {
    readonly kind: 'physical-test' | 'simulation-export' | 'synthetic-demo';
    readonly fileName?: string;
    readonly notes?: string;
  };
  readonly channels: readonly ChannelDescriptorV1[];
  readonly samples: SampleTableV1;
};

export type EngineeringEvidenceV1 = {
  readonly schema: typeof ENGINEERING_EVIDENCE_SCHEMA_V1;
  readonly checksum: {
    readonly algorithm: 'SHA-256';
    readonly canonicalization: typeof CANONICAL_JSON_SCHEMA_V1;
    readonly value: string;
  };
  readonly run: RunRecordV1;
  readonly testDataset?: TestDatasetV1;
  /** Optional UI findings: status chips, evidence lists, and field-linked callouts. */
  readonly findings?: EvidenceFindingsV1;
};

export const EVIDENCE_WORKSPACES = ['structural', 'correlation', 'field', 'material-lab'] as const;
export type EvidenceWorkspaceV1 = (typeof EVIDENCE_WORKSPACES)[number];

export const EVIDENCE_SEVERITIES = ['info', 'pass', 'warning', 'fail'] as const;
export type EvidenceSeverityV1 = (typeof EVIDENCE_SEVERITIES)[number];

/** Status-chip values as shown on the workbench mockups. */
export const EVIDENCE_CHIP_STATUSES = [
  'pass',
  'pass-with-notes',
  'fail',
  'within-limits',
  'pending',
  'not-scored',
  'ok',
  'armed',
  'safe',
  'good',
  'synced',
] as const;
export type EvidenceChipStatusV1 = (typeof EVIDENCE_CHIP_STATUSES)[number];

export const EVIDENCE_CALLOUT_KINDS = [
  'limit-status',
  'viewport-target',
  'sensor',
  'graph-marker',
  'checklist-item',
  'preflight-item',
  'channel-health',
  'capture-slot',
  'confidence',
  'telemetry',
] as const;
export type EvidenceCalloutKindV1 = (typeof EVIDENCE_CALLOUT_KINDS)[number];

export const EVIDENCE_LINK_KINDS = ['channel', 'parameter', 'event', 'check', 'limit', 'field'] as const;
export type EvidenceLinkKindV1 = (typeof EVIDENCE_LINK_KINDS)[number];

export const EVIDENCE_CONFIDENCE_KINDS = [
  'correlation-score',
  'mac',
  'coherence',
  'spectral-concentration',
  'placement',
] as const;
export type EvidenceConfidenceKindV1 = (typeof EVIDENCE_CONFIDENCE_KINDS)[number];

export const EVIDENCE_FIELD_AVAILABILITIES = ['wired', 'imported-only', 'not-modeled'] as const;
export type EvidenceFieldAvailabilityV1 = (typeof EVIDENCE_FIELD_AVAILABILITIES)[number];

export type EvidenceFieldLinkV1 = {
  readonly kind: EvidenceLinkKindV1;
  readonly id: string;
};

export type EvidenceStatusChipV1 = {
  readonly id: string;
  readonly status: EvidenceChipStatusV1;
  readonly label: string;
  readonly severity: EvidenceSeverityV1;
  readonly links?: readonly EvidenceFieldLinkV1[];
};

export type EvidenceListItemV1 = {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly quantity: MeasurementQuantity;
  readonly unit: EngineeringUnit;
  readonly severity: EvidenceSeverityV1;
  readonly status: EvidenceChipStatusV1;
  readonly provenance: DataProvenance;
  readonly links: readonly EvidenceFieldLinkV1[];
};

export type EvidenceCalloutV1 = {
  readonly id: string;
  readonly kind: EvidenceCalloutKindV1;
  readonly label: string;
  readonly detail?: string;
  readonly value?: number | string;
  readonly unit?: EngineeringUnit;
  readonly severity: EvidenceSeverityV1;
  readonly status: EvidenceChipStatusV1;
  readonly timeS?: number;
  readonly step?: number;
  readonly links: readonly EvidenceFieldLinkV1[];
};

export type EvidenceCheckV1 = {
  readonly id: string;
  readonly label: string;
  readonly status: EvidenceChipStatusV1;
  readonly severity: EvidenceSeverityV1;
  readonly detail: string;
  readonly links?: readonly EvidenceFieldLinkV1[];
};

export type EvidenceConfidenceV1 = {
  readonly id: string;
  readonly kind: EvidenceConfidenceKindV1;
  readonly label: string;
  readonly value: number;
  readonly unit: Extract<EngineeringUnit, 'normalized' | 'ratio' | '%' | 'none'>;
  readonly status: EvidenceChipStatusV1;
  readonly links?: readonly EvidenceFieldLinkV1[];
};

export type EvidenceFindingsV1 = {
  readonly workspace: EvidenceWorkspaceV1;
  readonly summary: EvidenceStatusChipV1;
  readonly chips: readonly EvidenceStatusChipV1[];
  readonly items: readonly EvidenceListItemV1[];
  readonly callouts: readonly EvidenceCalloutV1[];
  readonly checks: readonly EvidenceCheckV1[];
  readonly confidence?: EvidenceConfidenceV1;
};

export type EvidenceFieldCatalogEntryV1 = {
  readonly id: string;
  readonly workspace: EvidenceWorkspaceV1;
  readonly kind: EvidenceCalloutKindV1;
  readonly mockupLabel: string;
  readonly disclosureLabel: string;
  readonly quantity: MeasurementQuantity;
  readonly mockupUnit: EngineeringUnit;
  readonly disclosureUnit: EngineeringUnit;
  readonly availability: EvidenceFieldAvailabilityV1;
};

function catalogEntry(entry: EvidenceFieldCatalogEntryV1): EvidenceFieldCatalogEntryV1 {
  return Object.freeze(entry);
}

/** Stable field ids that bind evidence records to mockup callouts, chips, and inspector rows. */
export const EVIDENCE_FIELD_CATALOG: readonly EvidenceFieldCatalogEntryV1[] = Object.freeze([
  catalogEntry({ id: 'predicted-max-force', workspace: 'structural', kind: 'telemetry', mockupLabel: 'Predicted Max Force', disclosureLabel: 'Predicted peak load', quantity: 'load', mockupUnit: 'kN', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'predicted-max-strain-xx', workspace: 'structural', kind: 'telemetry', mockupLabel: 'Predicted Max Strain |XX|', disclosureLabel: 'Predicted peak strain', quantity: 'strain', mockupUnit: 'µε', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'max-force-limit', workspace: 'structural', kind: 'limit-status', mockupLabel: 'Max Force', disclosureLabel: 'Max normalized load', quantity: 'load', mockupUnit: 'kN', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'max-displacement-limit', workspace: 'structural', kind: 'limit-status', mockupLabel: 'Max Displacement', disclosureLabel: 'Max deflection', quantity: 'displacement', mockupUnit: 'mm', disclosureUnit: 'simulation-unit', availability: 'wired' }),
  catalogEntry({ id: 'max-strain-xx-limit', workspace: 'structural', kind: 'limit-status', mockupLabel: 'Max Strain |XX|', disclosureLabel: 'Max strain', quantity: 'strain', mockupUnit: 'µε', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'force-target', workspace: 'structural', kind: 'viewport-target', mockupLabel: 'FORCE TARGET', disclosureLabel: 'Normalized input', quantity: 'load', mockupUnit: 'kN', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'lvdt-01', workspace: 'structural', kind: 'sensor', mockupLabel: 'LVDT-01', disclosureLabel: 'Deflection probe', quantity: 'displacement', mockupUnit: 'mm', disclosureUnit: 'simulation-unit', availability: 'wired' }),
  catalogEntry({ id: 'dic-01', workspace: 'structural', kind: 'sensor', mockupLabel: 'DIC-01', disclosureLabel: 'Strain field probe', quantity: 'strain', mockupUnit: 'µε', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'safety-interlock', workspace: 'structural', kind: 'limit-status', mockupLabel: 'Safety Interlock', disclosureLabel: 'Simulation Limits', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'limit-warning', workspace: 'structural', kind: 'graph-marker', mockupLabel: 'Limit Warning', disclosureLabel: 'Limit warning', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'calibrated-mode', workspace: 'structural', kind: 'limit-status', mockupLabel: 'CALIBRATED MODE', disclosureLabel: 'Reduced-order claim', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'imported-only' }),
  catalogEntry({ id: 'deterministic', workspace: 'structural', kind: 'limit-status', mockupLabel: 'DETERMINISTIC', disclosureLabel: 'Deterministic replay', quantity: 'hash', mockupUnit: 'hash', disclosureUnit: 'hash', availability: 'wired' }),
  catalogEntry({ id: 'time-zero-alignment', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Time Zero Alignment', disclosureLabel: 'Time alignment', quantity: 'time', mockupUnit: 's', disclosureUnit: 's', availability: 'wired' }),
  catalogEntry({ id: 'trigger-alignment', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Trigger Alignment', disclosureLabel: 'Trigger mapping', quantity: 'time', mockupUnit: 's', disclosureUnit: 's', availability: 'wired' }),
  catalogEntry({ id: 'channel-integrity', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Channel Integrity', disclosureLabel: 'Channel mapping', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'sensor-saturation', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Sensor Saturation', disclosureLabel: 'Saturation metadata', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'imported-only' }),
  catalogEntry({ id: 'energy-balance', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Energy Balance', disclosureLabel: 'Energy proxy', quantity: 'energy', mockupUnit: 'kJ', disclosureUnit: 'normalized-energy', availability: 'wired' }),
  catalogEntry({ id: 'energy-balance-error', workspace: 'correlation', kind: 'telemetry', mockupLabel: 'Energy Balance Error', disclosureLabel: 'Energy proxy residual', quantity: 'energy', mockupUnit: 'kJ', disclosureUnit: 'normalized-energy', availability: 'wired' }),
  catalogEntry({ id: 'mass-scaling', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Mass Scaling', disclosureLabel: 'Mass scaling', quantity: 'other', mockupUnit: '%', disclosureUnit: 'none', availability: 'not-modeled' }),
  catalogEntry({ id: 'contact-stability', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Contact Stability', disclosureLabel: 'Contact scope', quantity: 'other', mockupUnit: 'MPa', disclosureUnit: 'none', availability: 'not-modeled' }),
  catalogEntry({ id: 'boundary-conditions', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Boundary Conditions', disclosureLabel: 'Boundary conditions', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'correlation-quality', workspace: 'correlation', kind: 'checklist-item', mockupLabel: 'Correlation Quality', disclosureLabel: 'Workbench agreement', quantity: 'other', mockupUnit: '%', disclosureUnit: '%', availability: 'wired' }),
  catalogEntry({ id: 'workbench-agreement', workspace: 'correlation', kind: 'confidence', mockupLabel: 'Correlation Score', disclosureLabel: 'WORKBENCH AGREEMENT', quantity: 'other', mockupUnit: '%', disclosureUnit: '%', availability: 'wired' }),
  catalogEntry({ id: 'hourglass-energy', workspace: 'correlation', kind: 'telemetry', mockupLabel: 'Hourglass Energy', disclosureLabel: 'Hourglass energy', quantity: 'other', mockupUnit: '%', disclosureUnit: 'none', availability: 'not-modeled' }),
  catalogEntry({ id: 'convergence-index', workspace: 'correlation', kind: 'telemetry', mockupLabel: 'Convergence Index', disclosureLabel: 'Replay hash', quantity: 'hash', mockupUnit: 'ratio', disclosureUnit: 'hash', availability: 'wired' }),
  catalogEntry({ id: 'sat-marker', workspace: 'correlation', kind: 'graph-marker', mockupLabel: 'SAT', disclosureLabel: 'Saturation marker', quantity: 'force', mockupUnit: 'kN', disclosureUnit: 'normalized', availability: 'imported-only' }),
  catalogEntry({ id: 'preflight', workspace: 'field', kind: 'preflight-item', mockupLabel: 'PREFLIGHT', disclosureLabel: 'PREFLIGHT', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'accel-zero', workspace: 'field', kind: 'preflight-item', mockupLabel: 'ACCEL ZERO', disclosureLabel: 'BASELINE', quantity: 'acceleration', mockupUnit: 'g', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'overload-headroom', workspace: 'field', kind: 'preflight-item', mockupLabel: 'OVERLOAD HEADROOM', disclosureLabel: 'PARAMETER LIMITS', quantity: 'amplitude', mockupUnit: 'dB', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'coherence-threshold', workspace: 'field', kind: 'preflight-item', mockupLabel: 'COHERENCE THRESHOLD', disclosureLabel: 'Spectral concentration floor', quantity: 'other', mockupUnit: 'ratio', disclosureUnit: 'ratio', availability: 'wired' }),
  catalogEntry({ id: 'sampling-rate', workspace: 'field', kind: 'preflight-item', mockupLabel: 'SAMPLING RATE', disclosureLabel: 'SAMPLE RATE', quantity: 'frequency', mockupUnit: 'Hz', disclosureUnit: 'model-Hz', availability: 'wired' }),
  catalogEntry({ id: 'anti-alias-filter', workspace: 'field', kind: 'preflight-item', mockupLabel: 'ANTI-ALIAS FILTER', disclosureLabel: 'WINDOW', quantity: 'other', mockupUnit: 'Hz', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'calibration', workspace: 'field', kind: 'preflight-item', mockupLabel: 'CALIBRATION', disclosureLabel: 'CALIBRATION', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'imported-only' }),
  catalogEntry({ id: 'digital-twin', workspace: 'field', kind: 'preflight-item', mockupLabel: 'DIGITAL TWIN', disclosureLabel: 'MODEL BUILD', quantity: 'other', mockupUnit: 'none', disclosureUnit: 'none', availability: 'wired' }),
  catalogEntry({ id: 'mac-pred-vs-actual', workspace: 'field', kind: 'confidence', mockupLabel: 'MAC (pred vs actual)', disclosureLabel: 'RESPONSE TAP STATUS', quantity: 'other', mockupUnit: 'ratio', disclosureUnit: 'none', availability: 'not-modeled' }),
  catalogEntry({ id: 'tap-p1', workspace: 'field', kind: 'channel-health', mockupLabel: 'A1', disclosureLabel: 'P1', quantity: 'acceleration', mockupUnit: 'dB', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'tap-p2', workspace: 'field', kind: 'channel-health', mockupLabel: 'A2', disclosureLabel: 'P2', quantity: 'acceleration', mockupUnit: 'dB', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'tap-p3', workspace: 'field', kind: 'channel-health', mockupLabel: 'A3', disclosureLabel: 'P3', quantity: 'acceleration', mockupUnit: 'dB', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'tap-p4', workspace: 'field', kind: 'channel-health', mockupLabel: 'A4', disclosureLabel: 'P4', quantity: 'acceleration', mockupUnit: 'dB', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'tap-p5', workspace: 'field', kind: 'channel-health', mockupLabel: 'A5', disclosureLabel: 'P5', quantity: 'acceleration', mockupUnit: 'dB', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'capture-status', workspace: 'field', kind: 'capture-slot', mockupLabel: 'Capture', disclosureLabel: 'ACCEPTED', quantity: 'count', mockupUnit: 'count', disclosureUnit: 'count', availability: 'wired' }),
  catalogEntry({ id: 'force-magnitude', workspace: 'material-lab', kind: 'telemetry', mockupLabel: 'Magnitude', disclosureLabel: 'Force magnitude', quantity: 'force', mockupUnit: 'kN', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'impulse', workspace: 'material-lab', kind: 'telemetry', mockupLabel: 'Impulse', disclosureLabel: 'Impulse', quantity: 'other', mockupUnit: 's', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'yield-strength', workspace: 'material-lab', kind: 'telemetry', mockupLabel: 'Yield Strength', disclosureLabel: 'Yield threshold', quantity: 'pressure', mockupUnit: 'MPa', disclosureUnit: 'normalized', availability: 'imported-only' }),
  catalogEntry({ id: 'max-stress', workspace: 'material-lab', kind: 'telemetry', mockupLabel: 'Max Stress', disclosureLabel: 'Peak response demand', quantity: 'pressure', mockupUnit: 'MPa', disclosureUnit: 'normalized', availability: 'wired' }),
  catalogEntry({ id: 'energy-readout', workspace: 'material-lab', kind: 'telemetry', mockupLabel: 'Energy', disclosureLabel: 'Energy proxy', quantity: 'energy', mockupUnit: 'kJ', disclosureUnit: 'normalized-energy', availability: 'wired' }),
]);

const EVIDENCE_FIELD_BY_ID = new Map(EVIDENCE_FIELD_CATALOG.map((entry) => [entry.id, entry] as const));

export function evidenceFieldById(id: string): EvidenceFieldCatalogEntryV1 | undefined {
  return EVIDENCE_FIELD_BY_ID.get(id);
}

export function evidenceFieldsForWorkspace(workspace: EvidenceWorkspaceV1): readonly EvidenceFieldCatalogEntryV1[] {
  return EVIDENCE_FIELD_CATALOG.filter((entry) => entry.workspace === workspace);
}

export function evidenceFieldDisplay(
  entry: EvidenceFieldCatalogEntryV1,
  claimLevel: ClaimLevel,
): { readonly label: string; readonly unit: EngineeringUnit } {
  return claimLevel === 'calibrated'
    ? { label: entry.mockupLabel, unit: entry.mockupUnit }
    : { label: entry.disclosureLabel, unit: entry.disclosureUnit };
}

export type EvidenceIssue = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

export type SafeValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly EvidenceIssue[] }
  | { readonly ok: false; readonly errors: readonly EvidenceIssue[]; readonly warnings: readonly EvidenceIssue[] };

export type CsvChannelSpec = Omit<ChannelDescriptorV1, 'sampleRateHz'> & {
  /** Exact column name in the CSV header. */
  readonly column: string;
};

export type TestDatasetCsvOptions = {
  readonly datasetId: string;
  readonly title: string;
  readonly createdAt?: string;
  readonly timeColumn?: string;
  readonly channels: readonly CsvChannelSpec[];
  readonly source: TestDatasetV1['source'];
};

const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_CHANNELS = 256;
const MAX_SAMPLES = 1_000_000;
const MAX_EVENTS = 100_000;
const MAX_PARAMETERS = 256;
const MAX_FINDING_ENTRIES = 64;
const MAX_FINDING_LINKS = 16;
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 2_000_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const PHYSICAL_UNITS = new Set<EngineeringUnit>([
  'N', 'kN', 'Pa', 'kPa', 'MPa', 'm', 'mm', 'µm', 'm/s', 'mm/s', 'm/s^2',
  'g', 'J', 'kJ', 'Hz', 'µε', 'V', 'mV',
]);

const QUANTITY_UNITS: Readonly<Record<MeasurementQuantity, ReadonlySet<EngineeringUnit>>> = {
  time: new Set(['s']),
  load: new Set(['normalized', 'ratio', '%', 'N', 'kN']),
  force: new Set(['normalized', 'N', 'kN']),
  displacement: new Set(['normalized', 'simulation-unit', 'm', 'mm', 'µm']),
  velocity: new Set(['normalized', 'simulation-unit/s', 'm/s', 'mm/s']),
  acceleration: new Set(['normalized', 'simulation-unit/s^2', 'm/s^2', 'g']),
  strain: new Set(['normalized', 'ratio', '%', 'strain', 'µε']),
  damage: new Set(['normalized', 'ratio', '%']),
  energy: new Set(['normalized', 'normalized-energy', 'J', 'kJ']),
  height: new Set(['normalized', 'simulation-unit', 'm', 'mm', 'µm']),
  pressure: new Set(['normalized', 'Pa', 'kPa', 'MPa']),
  frequency: new Set(['model-Hz', 'Hz']),
  amplitude: new Set(ENGINEERING_UNITS),
  count: new Set(['count']),
  hash: new Set(['hash']),
  other: new Set(ENGINEERING_UNITS),
};

class EvidenceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasForbiddenKey(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => FORBIDDEN_KEYS.has(key));
}

function issue(errors: EvidenceIssue[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function success<T>(value: T, warnings: readonly EvidenceIssue[] = []): SafeValidationResult<T> {
  return { ok: true, value, warnings };
}

function failure<T>(errors: readonly EvidenceIssue[], warnings: readonly EvidenceIssue[] = []): SafeValidationResult<T> {
  return { ok: false, errors, warnings };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function validText(value: unknown, maxLength = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateTextSize(text: string, label: string): EvidenceIssue | null {
  const bytes = new TextEncoder().encode(text).byteLength;
  return bytes <= MAX_TEXT_BYTES
    ? null
    : { path: '$', code: 'too-large', message: `${label} exceeds the ${MAX_TEXT_BYTES}-byte safety limit.` };
}

function safeJsonValue(text: string, label: string): SafeValidationResult<unknown> {
  const sizeIssue = validateTextSize(text, label);
  if (sizeIssue) return failure([sizeIssue]);
  try {
    return success(JSON.parse(text) as unknown);
  } catch (error) {
    return failure([{
      path: '$',
      code: 'invalid-json',
      message: `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }]);
  }
}

/** True only for units that imply a physical calibration rather than model scale. */
export function isPhysicalEngineeringUnit(unit: EngineeringUnit): boolean {
  return PHYSICAL_UNITS.has(unit);
}

function validateChannelShape(channel: unknown, path: string, errors: EvidenceIssue[]): channel is ChannelDescriptorV1 {
  if (!isRecord(channel) || hasForbiddenKey(channel)) {
    issue(errors, path, 'invalid-channel', 'Channel descriptor must be a safe object.');
    return false;
  }
  if (!validId(channel.id)) issue(errors, `${path}.id`, 'invalid-id', 'Channel id must be a stable 1-128 character identifier.');
  if (!validText(channel.label, 256)) issue(errors, `${path}.label`, 'invalid-label', 'Channel label must contain 1-256 characters.');
  if (!MEASUREMENT_QUANTITIES.includes(channel.quantity as MeasurementQuantity)) {
    issue(errors, `${path}.quantity`, 'unsupported-quantity', 'Channel quantity is not supported by schema v1.');
  }
  if (!ENGINEERING_UNITS.includes(channel.unit as EngineeringUnit)) {
    issue(errors, `${path}.unit`, 'unsupported-unit', 'Channel unit is not supported by schema v1.');
  }
  if (!DATA_PROVENANCES.includes(channel.provenance as DataProvenance)) {
    issue(errors, `${path}.provenance`, 'unsupported-provenance', 'Channel provenance is not supported by schema v1.');
  }
  if (channel.sampleRateHz !== undefined && (!validFiniteNumber(channel.sampleRateHz) || channel.sampleRateHz <= 0)) {
    issue(errors, `${path}.sampleRateHz`, 'invalid-sample-rate', 'Sample rate must be a positive finite number.');
  }
  if (channel.calibrationId !== undefined && !validId(channel.calibrationId)) {
    issue(errors, `${path}.calibrationId`, 'invalid-calibration-id', 'Calibration id must be a stable identifier.');
  }
  if (channel.sourceChannelIds !== undefined) {
    if (!Array.isArray(channel.sourceChannelIds) || channel.sourceChannelIds.length === 0 || channel.sourceChannelIds.length > MAX_CHANNELS) {
      issue(errors, `${path}.sourceChannelIds`, 'invalid-source-list', 'Source channel ids must be a non-empty bounded array.');
    } else {
      const unique = new Set<string>();
      for (let index = 0; index < channel.sourceChannelIds.length; index++) {
        const source = channel.sourceChannelIds[index];
        if (!validId(source)) issue(errors, `${path}.sourceChannelIds[${index}]`, 'invalid-id', 'Source channel id is invalid.');
        else if (unique.has(source)) issue(errors, `${path}.sourceChannelIds[${index}]`, 'duplicate-source', 'Source channel ids must be unique.');
        else unique.add(source);
      }
    }
  }
  if (channel.uncertainty !== undefined) {
    const uncertainty = channel.uncertainty;
    if (!isRecord(uncertainty)) {
      issue(errors, `${path}.uncertainty`, 'invalid-uncertainty', 'Uncertainty must be an object.');
    } else {
      if (!['absolute', 'relative-1sigma', 'relative-2sigma'].includes(String(uncertainty.kind))) {
        issue(errors, `${path}.uncertainty.kind`, 'invalid-uncertainty-kind', 'Uncertainty kind is unsupported.');
      }
      if (!validFiniteNumber(uncertainty.value) || uncertainty.value < 0) {
        issue(errors, `${path}.uncertainty.value`, 'invalid-uncertainty-value', 'Uncertainty must be finite and non-negative.');
      }
      if (uncertainty.unit !== undefined && !ENGINEERING_UNITS.includes(uncertainty.unit as EngineeringUnit)) {
        issue(errors, `${path}.uncertainty.unit`, 'unsupported-unit', 'Uncertainty unit is unsupported.');
      }
    }
  }
  return errors.length === 0;
}

function derivedChannelHasTrustedSources(
  channel: ChannelDescriptorV1,
  channelsById: ReadonlyMap<string, ChannelDescriptorV1>,
  visiting = new Set<string>(),
): boolean {
  if (channel.provenance === 'imported' || channel.provenance === 'user-calibrated') return true;
  if (channel.provenance !== 'derived' || !channel.sourceChannelIds?.length || visiting.has(channel.id)) return false;
  visiting.add(channel.id);
  const result = channel.sourceChannelIds.every((sourceId) => {
    const source = channelsById.get(sourceId);
    return source ? derivedChannelHasTrustedSources(source, channelsById, visiting) : false;
  });
  visiting.delete(channel.id);
  return result;
}

/**
 * Enforces quantity/unit compatibility and prevents uncalibrated model or
 * synthetic channels from claiming physical engineering units.
 */
export function validateProvenanceAndUnits(
  channel: ChannelDescriptorV1,
  allChannels: readonly ChannelDescriptorV1[] = [channel],
  path = '$.channel',
): readonly EvidenceIssue[] {
  const errors: EvidenceIssue[] = [];
  if (!QUANTITY_UNITS[channel.quantity].has(channel.unit)) {
    issue(errors, `${path}.unit`, 'quantity-unit-mismatch', `${channel.unit} is not valid for ${channel.quantity}.`);
  }
  if (channel.provenance === 'user-calibrated' && !channel.calibrationId) {
    issue(errors, `${path}.calibrationId`, 'missing-calibration', 'User-calibrated channels require a calibration id.');
  }
  if ((channel.provenance === 'solver-native' || channel.provenance === 'synthetic-demo') && isPhysicalEngineeringUnit(channel.unit)) {
    issue(errors, `${path}.unit`, 'uncalibrated-physical-unit', `${channel.provenance} data cannot claim ${channel.unit}.`);
  }
  if (channel.provenance === 'derived' && isPhysicalEngineeringUnit(channel.unit)) {
    const byId = new Map(allChannels.map((candidate) => [candidate.id, candidate] as const));
    if (!derivedChannelHasTrustedSources(channel, byId)) {
      issue(errors, `${path}.sourceChannelIds`, 'untrusted-derived-unit', 'Derived physical units require a complete imported or calibrated source chain.');
    }
  }
  if (channel.uncertainty?.kind === 'absolute') {
    const uncertaintyUnit = channel.uncertainty.unit ?? channel.unit;
    if (uncertaintyUnit !== channel.unit) {
      issue(errors, `${path}.uncertainty.unit`, 'uncertainty-unit-mismatch', 'Absolute uncertainty must use the channel unit.');
    }
  }
  return errors;
}

/** Imported/calibrated evidence, or a fully trusted derivation of it, may drive an engineering pass/fail decision. */
export function canDriveEngineeringPassFail(
  channel: ChannelDescriptorV1,
  allChannels: readonly ChannelDescriptorV1[] = [channel],
  sourceKind?: TestDatasetV1['source']['kind'],
): boolean {
  if (sourceKind !== 'physical-test') return false;
  if (!isPhysicalEngineeringUnit(channel.unit) && channel.unit !== 'strain') return false;
  return derivedChannelHasTrustedSources(channel, new Map(allChannels.map((candidate) => [candidate.id, candidate] as const)));
}

export function runEventSeverityToEvidence(severity: RunEventSeverityV1): EvidenceSeverityV1 {
  switch (severity) {
    case 'info': return 'info';
    case 'pass': return 'pass';
    case 'warning': return 'warning';
    case 'danger': return 'fail';
    default: {
      const exhaustive: never = severity;
      return exhaustive;
    }
  }
}

export function evidenceChipLabel(status: EvidenceChipStatusV1): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'pass-with-notes': return 'PASS WITH NOTES';
    case 'fail': return 'FAIL';
    case 'within-limits': return 'WITHIN LIMITS';
    case 'pending': return 'PENDING';
    case 'not-scored': return 'NOT SCORED';
    case 'ok': return 'OK';
    case 'armed': return 'ARMED';
    case 'safe': return 'SAFE';
    case 'good': return 'GOOD';
    case 'synced': return 'SYNCED';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function evidenceChipTone(
  status: EvidenceChipStatusV1,
): 'good' | 'caution' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'pass':
    case 'within-limits':
    case 'ok':
    case 'safe':
    case 'good':
    case 'synced':
      return 'good';
    case 'pass-with-notes':
    case 'armed':
      return 'caution';
    case 'fail':
      return 'danger';
    case 'pending':
      return 'neutral';
    case 'not-scored':
      return 'info';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function evidenceSeverityFromChip(status: EvidenceChipStatusV1): EvidenceSeverityV1 {
  switch (status) {
    case 'pass':
    case 'within-limits':
    case 'ok':
    case 'safe':
    case 'good':
    case 'synced':
      return 'pass';
    case 'pass-with-notes':
    case 'armed':
      return 'warning';
    case 'fail':
      return 'fail';
    case 'pending':
    case 'not-scored':
      return 'info';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function chipRank(status: EvidenceChipStatusV1): number {
  switch (status) {
    case 'fail': return 5;
    case 'pass-with-notes': return 4;
    case 'armed': return 3;
    case 'pending': return 2;
    case 'not-scored': return 1;
    case 'pass':
    case 'within-limits':
    case 'ok':
    case 'safe':
    case 'good':
    case 'synced':
      return 0;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function rollupEvidenceChipStatus(statuses: readonly EvidenceChipStatusV1[]): EvidenceChipStatusV1 {
  if (statuses.length === 0) return 'not-scored';
  if (statuses.some((status) => status === 'fail')) return 'fail';
  if (statuses.some((status) => status === 'pass-with-notes')) return 'pass-with-notes';
  if (statuses.some((status) => status === 'armed')) return 'armed';
  if (statuses.some((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'not-scored')) return 'not-scored';
  const unique = new Set(statuses);
  return unique.size === 1 ? statuses[0]! : 'pass';
}

export function evidenceSummaryStatusForWorkspace(
  workspace: EvidenceWorkspaceV1,
  rolled: EvidenceChipStatusV1,
): EvidenceChipStatusV1 {
  if (rolled !== 'pass') return rolled;
  switch (workspace) {
    case 'structural': return 'within-limits';
    case 'correlation': return 'pass';
    case 'field': return 'ok';
    case 'material-lab': return 'ok';
    default: {
      const exhaustive: never = workspace;
      return exhaustive;
    }
  }
}

function collectFindingStatuses(input: {
  readonly chips?: readonly EvidenceStatusChipV1[];
  readonly items?: readonly EvidenceListItemV1[];
  readonly callouts?: readonly EvidenceCalloutV1[];
  readonly checks?: readonly EvidenceCheckV1[];
  readonly confidence?: EvidenceConfidenceV1;
}): EvidenceChipStatusV1[] {
  const statuses: EvidenceChipStatusV1[] = [];
  for (const chip of input.chips ?? []) statuses.push(chip.status);
  for (const item of input.items ?? []) statuses.push(item.status);
  for (const callout of input.callouts ?? []) statuses.push(callout.status);
  for (const check of input.checks ?? []) statuses.push(check.status);
  if (input.confidence) statuses.push(input.confidence.status);
  return statuses;
}

export function buildEvidenceFindingsV1(input: {
  readonly workspace: EvidenceWorkspaceV1;
  readonly chips?: readonly EvidenceStatusChipV1[];
  readonly items?: readonly EvidenceListItemV1[];
  readonly callouts?: readonly EvidenceCalloutV1[];
  readonly checks?: readonly EvidenceCheckV1[];
  readonly confidence?: EvidenceConfidenceV1;
}): EvidenceFindingsV1 {
  const status = evidenceSummaryStatusForWorkspace(
    input.workspace,
    rollupEvidenceChipStatus(collectFindingStatuses(input)),
  );
  return {
    workspace: input.workspace,
    summary: {
      id: `${input.workspace}-summary`,
      status,
      label: evidenceChipLabel(status),
      severity: evidenceSeverityFromChip(status),
    },
    chips: input.chips ?? [],
    items: input.items ?? [],
    callouts: input.callouts ?? [],
    checks: input.checks ?? [],
    ...(input.confidence ? { confidence: input.confidence } : {}),
  };
}

const FINDINGS_KEYS = new Set(['workspace', 'summary', 'chips', 'items', 'callouts', 'checks', 'confidence']);
const CHIP_KEYS = new Set(['id', 'status', 'label', 'severity', 'links']);
const ITEM_KEYS = new Set(['id', 'label', 'value', 'quantity', 'unit', 'severity', 'status', 'provenance', 'links']);
const CALLOUT_KEYS = new Set(['id', 'kind', 'label', 'detail', 'value', 'unit', 'severity', 'status', 'timeS', 'step', 'links']);
const CHECK_KEYS = new Set(['id', 'label', 'status', 'severity', 'detail', 'links']);
const CONFIDENCE_KEYS = new Set(['id', 'kind', 'label', 'value', 'unit', 'status', 'links']);
const LINK_KEYS = new Set(['kind', 'id']);
const CONFIDENCE_UNITS = new Set<EngineeringUnit>(['normalized', 'ratio', '%', 'none']);

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: EvidenceIssue[],
  code: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issue(errors, `${path}.${key}`, code, `Field '${key}' is not covered by schema v1.`);
  }
}

function validateEvidenceLinks(
  links: unknown,
  path: string,
  errors: EvidenceIssue[],
  ids: { readonly channels: ReadonlySet<string>; readonly parameters: ReadonlySet<string>; readonly events: ReadonlySet<string>; readonly checks: ReadonlySet<string> },
): void {
  if (links === undefined) return;
  if (!Array.isArray(links) || links.length > MAX_FINDING_LINKS) {
    issue(errors, path, 'invalid-links', `Links must be an array with at most ${MAX_FINDING_LINKS} entries.`);
    return;
  }
  for (let index = 0; index < links.length; index++) {
    const linkPath = `${path}[${index}]`;
    const link = links[index];
    if (!isRecord(link) || hasForbiddenKey(link)) {
      issue(errors, linkPath, 'invalid-link', 'Field link must be a safe object.');
      continue;
    }
    rejectUnknownKeys(link, LINK_KEYS, linkPath, errors, 'unexpected-link-field');
    if (!EVIDENCE_LINK_KINDS.includes(link.kind as EvidenceLinkKindV1)) {
      issue(errors, `${linkPath}.kind`, 'unsupported-link-kind', 'Field link kind is unsupported.');
    }
    if (!validId(link.id)) issue(errors, `${linkPath}.id`, 'invalid-id', 'Field link id is invalid.');
    const kind = link.kind as EvidenceLinkKindV1;
    const target = typeof link.id === 'string' ? link.id : '';
    if (kind === 'channel' && target && !ids.channels.has(target)) {
      issue(errors, `${linkPath}.id`, 'missing-link-target', `Linked channel '${target}' does not exist.`);
    } else if (kind === 'parameter' && target && !ids.parameters.has(target)) {
      issue(errors, `${linkPath}.id`, 'missing-link-target', `Linked parameter '${target}' does not exist.`);
    } else if (kind === 'event' && target && !ids.events.has(target)) {
      issue(errors, `${linkPath}.id`, 'missing-link-target', `Linked event '${target}' does not exist.`);
    } else if (kind === 'check' && target && !ids.checks.has(target)) {
      issue(errors, `${linkPath}.id`, 'missing-link-target', `Linked check '${target}' does not exist.`);
    } else if ((kind === 'limit' || kind === 'field') && target && !EVIDENCE_FIELD_BY_ID.has(target) && !validId(target)) {
      issue(errors, `${linkPath}.id`, 'invalid-id', 'Linked field id is invalid.');
    }
  }
}

function validateChipShape(
  value: unknown,
  path: string,
  errors: EvidenceIssue[],
  ids: { readonly channels: ReadonlySet<string>; readonly parameters: ReadonlySet<string>; readonly events: ReadonlySet<string>; readonly checks: ReadonlySet<string> },
): void {
  if (!isRecord(value) || hasForbiddenKey(value)) {
    issue(errors, path, 'invalid-chip', 'Status chip must be a safe object.');
    return;
  }
  rejectUnknownKeys(value, CHIP_KEYS, path, errors, 'unexpected-chip-field');
  if (!validId(value.id)) issue(errors, `${path}.id`, 'invalid-id', 'Chip id is invalid.');
  if (!EVIDENCE_CHIP_STATUSES.includes(value.status as EvidenceChipStatusV1)) {
    issue(errors, `${path}.status`, 'unsupported-chip-status', 'Chip status is unsupported.');
  }
  if (!validText(value.label, 128)) issue(errors, `${path}.label`, 'invalid-label', 'Chip label must contain 1-128 characters.');
  if (!EVIDENCE_SEVERITIES.includes(value.severity as EvidenceSeverityV1)) {
    issue(errors, `${path}.severity`, 'unsupported-severity', 'Chip severity is unsupported.');
  }
  if (
    EVIDENCE_CHIP_STATUSES.includes(value.status as EvidenceChipStatusV1)
    && EVIDENCE_SEVERITIES.includes(value.severity as EvidenceSeverityV1)
    && value.severity !== evidenceSeverityFromChip(value.status as EvidenceChipStatusV1)
  ) {
    issue(errors, `${path}.severity`, 'chip-severity-mismatch', 'Chip severity must match its status.');
  }
  validateEvidenceLinks(value.links, `${path}.links`, errors, ids);
}

function validateScalarValue(value: unknown, path: string, errors: EvidenceIssue[]): void {
  if (typeof value === 'string') {
    if (!validText(value, 256)) issue(errors, path, 'invalid-value', 'Text values must contain 1-256 characters.');
    return;
  }
  if (!validFiniteNumber(value)) issue(errors, path, 'invalid-value', 'Numeric values must be finite.');
}

export function validateEvidenceFindingsV1(
  input: unknown,
  run: RunRecordV1,
  testDataset?: TestDatasetV1,
  path = '$.findings',
): SafeValidationResult<EvidenceFindingsV1> {
  const errors: EvidenceIssue[] = [];
  if (!isRecord(input) || hasForbiddenKey(input)) {
    return failure([{ path, code: 'invalid-findings', message: 'Findings must be a safe object.' }]);
  }
  rejectUnknownKeys(input, FINDINGS_KEYS, path, errors, 'unexpected-findings-field');
  if (!EVIDENCE_WORKSPACES.includes(input.workspace as EvidenceWorkspaceV1)) {
    issue(errors, `${path}.workspace`, 'unsupported-workspace', 'Findings workspace is unsupported.');
  }

  const channelIds = new Set([
    ...run.channels.map((channel) => channel.id),
    ...(testDataset?.channels.map((channel) => channel.id) ?? []),
  ]);
  const parameterIds = new Set(Object.keys(run.parameters));
  const eventIds = new Set(run.events.map((event) => event.id));
  const checkIds = new Set<string>();
  if (Array.isArray(input.checks)) {
    for (const check of input.checks) {
      if (isRecord(check) && typeof check.id === 'string') checkIds.add(check.id);
    }
  }
  const ids = { channels: channelIds, parameters: parameterIds, events: eventIds, checks: checkIds };

  if (!Array.isArray(input.chips) || input.chips.length > MAX_FINDING_ENTRIES) {
    issue(errors, `${path}.chips`, 'invalid-chips', `Chips must be an array with at most ${MAX_FINDING_ENTRIES} entries.`);
  } else {
    for (let index = 0; index < input.chips.length; index++) {
      validateChipShape(input.chips[index], `${path}.chips[${index}]`, errors, ids);
    }
  }

  if (!Array.isArray(input.items) || input.items.length > MAX_FINDING_ENTRIES) {
    issue(errors, `${path}.items`, 'invalid-items', `Evidence items must be an array with at most ${MAX_FINDING_ENTRIES} entries.`);
  } else {
    for (let index = 0; index < input.items.length; index++) {
      const itemPath = `${path}.items[${index}]`;
      const item = input.items[index];
      if (!isRecord(item) || hasForbiddenKey(item)) {
        issue(errors, itemPath, 'invalid-item', 'Evidence item must be a safe object.');
        continue;
      }
      rejectUnknownKeys(item, ITEM_KEYS, itemPath, errors, 'unexpected-item-field');
      if (!validId(item.id)) issue(errors, `${itemPath}.id`, 'invalid-id', 'Evidence item id is invalid.');
      if (!validText(item.label, 256)) issue(errors, `${itemPath}.label`, 'invalid-label', 'Evidence item label is invalid.');
      validateScalarValue(item.value, `${itemPath}.value`, errors);
      if (!MEASUREMENT_QUANTITIES.includes(item.quantity as MeasurementQuantity)) {
        issue(errors, `${itemPath}.quantity`, 'unsupported-quantity', 'Evidence item quantity is unsupported.');
      }
      if (!ENGINEERING_UNITS.includes(item.unit as EngineeringUnit)) {
        issue(errors, `${itemPath}.unit`, 'unsupported-unit', 'Evidence item unit is unsupported.');
      }
      if (!EVIDENCE_SEVERITIES.includes(item.severity as EvidenceSeverityV1)) {
        issue(errors, `${itemPath}.severity`, 'unsupported-severity', 'Evidence item severity is unsupported.');
      }
      if (!EVIDENCE_CHIP_STATUSES.includes(item.status as EvidenceChipStatusV1)) {
        issue(errors, `${itemPath}.status`, 'unsupported-chip-status', 'Evidence item status is unsupported.');
      }
      if (!DATA_PROVENANCES.includes(item.provenance as DataProvenance)) {
        issue(errors, `${itemPath}.provenance`, 'unsupported-provenance', 'Evidence item provenance is unsupported.');
      }
      if (
        MEASUREMENT_QUANTITIES.includes(item.quantity as MeasurementQuantity)
        && ENGINEERING_UNITS.includes(item.unit as EngineeringUnit)
        && !QUANTITY_UNITS[item.quantity as MeasurementQuantity].has(item.unit as EngineeringUnit)
      ) {
        issue(errors, `${itemPath}.unit`, 'quantity-unit-mismatch', `${String(item.unit)} is not valid for ${String(item.quantity)}.`);
      }
      if (
        (item.provenance === 'solver-native' || item.provenance === 'synthetic-demo')
        && ENGINEERING_UNITS.includes(item.unit as EngineeringUnit)
        && isPhysicalEngineeringUnit(item.unit as EngineeringUnit)
      ) {
        issue(errors, `${itemPath}.unit`, 'uncalibrated-physical-unit', `${String(item.provenance)} evidence cannot claim ${String(item.unit)}.`);
      }
      if (!Array.isArray(item.links)) issue(errors, `${itemPath}.links`, 'invalid-links', 'Evidence items require a links array.');
      else validateEvidenceLinks(item.links, `${itemPath}.links`, errors, ids);
    }
  }

  if (!Array.isArray(input.callouts) || input.callouts.length > MAX_FINDING_ENTRIES) {
    issue(errors, `${path}.callouts`, 'invalid-callouts', `Callouts must be an array with at most ${MAX_FINDING_ENTRIES} entries.`);
  } else {
    for (let index = 0; index < input.callouts.length; index++) {
      const calloutPath = `${path}.callouts[${index}]`;
      const callout = input.callouts[index];
      if (!isRecord(callout) || hasForbiddenKey(callout)) {
        issue(errors, calloutPath, 'invalid-callout', 'Callout must be a safe object.');
        continue;
      }
      rejectUnknownKeys(callout, CALLOUT_KEYS, calloutPath, errors, 'unexpected-callout-field');
      if (!validId(callout.id)) issue(errors, `${calloutPath}.id`, 'invalid-id', 'Callout id is invalid.');
      if (!EVIDENCE_CALLOUT_KINDS.includes(callout.kind as EvidenceCalloutKindV1)) {
        issue(errors, `${calloutPath}.kind`, 'unsupported-callout-kind', 'Callout kind is unsupported.');
      }
      if (!validText(callout.label, 256)) issue(errors, `${calloutPath}.label`, 'invalid-label', 'Callout label is invalid.');
      if (callout.detail !== undefined && (typeof callout.detail !== 'string' || callout.detail.length > 1024)) {
        issue(errors, `${calloutPath}.detail`, 'invalid-detail', 'Callout detail must be text no longer than 1,024 characters.');
      }
      if (callout.value !== undefined) validateScalarValue(callout.value, `${calloutPath}.value`, errors);
      if (callout.unit !== undefined && !ENGINEERING_UNITS.includes(callout.unit as EngineeringUnit)) {
        issue(errors, `${calloutPath}.unit`, 'unsupported-unit', 'Callout unit is unsupported.');
      }
      if (!EVIDENCE_SEVERITIES.includes(callout.severity as EvidenceSeverityV1)) {
        issue(errors, `${calloutPath}.severity`, 'unsupported-severity', 'Callout severity is unsupported.');
      }
      if (!EVIDENCE_CHIP_STATUSES.includes(callout.status as EvidenceChipStatusV1)) {
        issue(errors, `${calloutPath}.status`, 'unsupported-chip-status', 'Callout status is unsupported.');
      }
      if (callout.timeS !== undefined && (!validFiniteNumber(callout.timeS) || callout.timeS < 0)) {
        issue(errors, `${calloutPath}.timeS`, 'invalid-time', 'Callout time must be finite and non-negative.');
      }
      if (callout.step !== undefined && (typeof callout.step !== 'number' || !Number.isSafeInteger(callout.step) || callout.step < 0)) {
        issue(errors, `${calloutPath}.step`, 'invalid-event-step', 'Callout step must be a non-negative safe integer.');
      }
      if (!Array.isArray(callout.links)) issue(errors, `${calloutPath}.links`, 'invalid-links', 'Callouts require a links array.');
      else validateEvidenceLinks(callout.links, `${calloutPath}.links`, errors, ids);
    }
  }

  if (!Array.isArray(input.checks) || input.checks.length > MAX_FINDING_ENTRIES) {
    issue(errors, `${path}.checks`, 'invalid-checks', `Checks must be an array with at most ${MAX_FINDING_ENTRIES} entries.`);
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < input.checks.length; index++) {
      const checkPath = `${path}.checks[${index}]`;
      const check = input.checks[index];
      if (!isRecord(check) || hasForbiddenKey(check)) {
        issue(errors, checkPath, 'invalid-check', 'Check must be a safe object.');
        continue;
      }
      rejectUnknownKeys(check, CHECK_KEYS, checkPath, errors, 'unexpected-check-field');
      if (!validId(check.id)) issue(errors, `${checkPath}.id`, 'invalid-id', 'Check id is invalid.');
      else if (seen.has(check.id)) issue(errors, `${checkPath}.id`, 'duplicate-check', `Check '${check.id}' is duplicated.`);
      else seen.add(check.id);
      if (!validText(check.label, 256)) issue(errors, `${checkPath}.label`, 'invalid-label', 'Check label is invalid.');
      if (!EVIDENCE_CHIP_STATUSES.includes(check.status as EvidenceChipStatusV1)) {
        issue(errors, `${checkPath}.status`, 'unsupported-chip-status', 'Check status is unsupported.');
      }
      if (!EVIDENCE_SEVERITIES.includes(check.severity as EvidenceSeverityV1)) {
        issue(errors, `${checkPath}.severity`, 'unsupported-severity', 'Check severity is unsupported.');
      }
      if (typeof check.detail !== 'string' || check.detail.length > 1024) {
        issue(errors, `${checkPath}.detail`, 'invalid-detail', 'Check detail must be text no longer than 1,024 characters.');
      }
      validateEvidenceLinks(check.links, `${checkPath}.links`, errors, ids);
    }
  }

  if (input.confidence !== undefined) {
    const confidencePath = `${path}.confidence`;
    const confidence = input.confidence;
    if (!isRecord(confidence) || hasForbiddenKey(confidence)) {
      issue(errors, confidencePath, 'invalid-confidence', 'Confidence must be a safe object.');
    } else {
      rejectUnknownKeys(confidence, CONFIDENCE_KEYS, confidencePath, errors, 'unexpected-confidence-field');
      if (!validId(confidence.id)) issue(errors, `${confidencePath}.id`, 'invalid-id', 'Confidence id is invalid.');
      if (!EVIDENCE_CONFIDENCE_KINDS.includes(confidence.kind as EvidenceConfidenceKindV1)) {
        issue(errors, `${confidencePath}.kind`, 'unsupported-confidence-kind', 'Confidence kind is unsupported.');
      }
      if (!validText(confidence.label, 256)) issue(errors, `${confidencePath}.label`, 'invalid-label', 'Confidence label is invalid.');
      if (!validFiniteNumber(confidence.value) || confidence.value < 0) {
        issue(errors, `${confidencePath}.value`, 'invalid-confidence-value', 'Confidence value must be finite and non-negative.');
      }
      if (!CONFIDENCE_UNITS.has(confidence.unit as EngineeringUnit)) {
        issue(errors, `${confidencePath}.unit`, 'unsupported-unit', 'Confidence unit must be normalized, ratio, %, or none.');
      }
      if (!EVIDENCE_CHIP_STATUSES.includes(confidence.status as EvidenceChipStatusV1)) {
        issue(errors, `${confidencePath}.status`, 'unsupported-chip-status', 'Confidence status is unsupported.');
      }
      validateEvidenceLinks(confidence.links, `${confidencePath}.links`, errors, ids);
    }
  }

  validateChipShape(input.summary, `${path}.summary`, errors, ids);
  if (isRecord(input.summary) && EVIDENCE_CHIP_STATUSES.includes(input.summary.status as EvidenceChipStatusV1)) {
    const rolled = rollupEvidenceChipStatus(collectFindingStatuses({
      chips: Array.isArray(input.chips) ? input.chips as EvidenceStatusChipV1[] : [],
      items: Array.isArray(input.items) ? input.items as EvidenceListItemV1[] : [],
      callouts: Array.isArray(input.callouts) ? input.callouts as EvidenceCalloutV1[] : [],
      checks: Array.isArray(input.checks) ? input.checks as EvidenceCheckV1[] : [],
      confidence: isRecord(input.confidence) ? input.confidence as unknown as EvidenceConfidenceV1 : undefined,
    }));
    const expected = evidenceSummaryStatusForWorkspace(
      EVIDENCE_WORKSPACES.includes(input.workspace as EvidenceWorkspaceV1) ? input.workspace as EvidenceWorkspaceV1 : 'structural',
      rolled,
    );
    if (chipRank(input.summary.status as EvidenceChipStatusV1) < chipRank(expected)) {
      issue(errors, `${path}.summary.status`, 'optimistic-summary', `Summary '${String(input.summary.status)}' is more optimistic than rolled-up '${expected}'.`);
    }
  }

  return errors.length > 0 ? failure(errors) : success(input as unknown as EvidenceFindingsV1);
}

function validateChannels(channels: unknown, path: string, errors: EvidenceIssue[]): channels is readonly ChannelDescriptorV1[] {
  if (!Array.isArray(channels) || channels.length === 0 || channels.length > MAX_CHANNELS) {
    issue(errors, path, 'invalid-channels', `Channels must contain between 1 and ${MAX_CHANNELS} descriptors.`);
    return false;
  }
  const startCount = errors.length;
  const ids = new Set<string>();
  for (let index = 0; index < channels.length; index++) {
    const channelPath = `${path}[${index}]`;
    validateChannelShape(channels[index], channelPath, errors);
    const id = isRecord(channels[index]) ? channels[index].id : undefined;
    if (typeof id === 'string') {
      if (ids.has(id)) issue(errors, `${channelPath}.id`, 'duplicate-channel', `Channel '${id}' is duplicated.`);
      ids.add(id);
    }
  }
  if (errors.length === startCount) {
    const typed = channels as unknown as readonly ChannelDescriptorV1[];
    for (let index = 0; index < typed.length; index++) {
      errors.push(...validateProvenanceAndUnits(typed[index], typed, `${path}[${index}]`));
      for (const sourceId of typed[index].sourceChannelIds ?? []) {
        if (!ids.has(sourceId)) issue(errors, `${path}[${index}].sourceChannelIds`, 'missing-source-channel', `Source channel '${sourceId}' does not exist.`);
      }
    }
  }
  return errors.length === startCount;
}

function validateSamples(
  samples: unknown,
  channels: readonly ChannelDescriptorV1[],
  path: string,
  errors: EvidenceIssue[],
  allowNegativeTime: boolean,
): samples is SampleTableV1 {
  if (!isRecord(samples) || hasForbiddenKey(samples)) {
    issue(errors, path, 'invalid-samples', 'Samples must be a safe object.');
    return false;
  }
  if (!Array.isArray(samples.timeS) || samples.timeS.length === 0 || samples.timeS.length > MAX_SAMPLES) {
    issue(errors, `${path}.timeS`, 'invalid-time-series', `Time series must contain between 1 and ${MAX_SAMPLES} samples.`);
    return false;
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples.timeS.length; index++) {
    const value = samples.timeS[index];
    if (!validFiniteNumber(value) || (!allowNegativeTime && value < 0)) {
      issue(errors, `${path}.timeS[${index}]`, 'invalid-time', 'Time values must be finite and valid for this record type.');
      continue;
    }
    if (value <= previous) issue(errors, `${path}.timeS[${index}]`, 'non-monotonic-time', 'Time values must be strictly increasing.');
    previous = value;
  }
  if (!isRecord(samples.values) || hasForbiddenKey(samples.values)) {
    issue(errors, `${path}.values`, 'invalid-values', 'Sample values must be a safe channel map.');
    return false;
  }
  const expectedIds = new Set(channels.map((channel) => channel.id));
  for (const key of Object.keys(samples.values)) {
    if (!expectedIds.has(key)) issue(errors, `${path}.values.${key}`, 'unexpected-channel-values', `Values reference unknown channel '${key}'.`);
  }
  for (const channel of channels) {
    const values = samples.values[channel.id];
    if (!Array.isArray(values) || values.length !== samples.timeS.length) {
      issue(errors, `${path}.values.${channel.id}`, 'sample-count-mismatch', `Channel '${channel.id}' must contain ${samples.timeS.length} samples.`);
      continue;
    }
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value !== null && !validFiniteNumber(value)) {
        issue(errors, `${path}.values.${channel.id}[${index}]`, 'invalid-sample', 'Samples must be finite numbers or null.');
      }
    }
  }
  return true;
}

function validateParameters(parameters: unknown, path: string, errors: EvidenceIssue[]): void {
  if (!isRecord(parameters) || hasForbiddenKey(parameters)) {
    issue(errors, path, 'invalid-parameters', 'Parameters must be a safe object.');
    return;
  }
  const entries = Object.entries(parameters);
  if (entries.length > MAX_PARAMETERS) issue(errors, path, 'too-many-parameters', `At most ${MAX_PARAMETERS} parameters are allowed.`);
  for (const [key, value] of entries) {
    if (!validId(key)) issue(errors, `${path}.${key}`, 'invalid-id', 'Parameter name is invalid.');
    if (!validFiniteNumber(value)) issue(errors, `${path}.${key}`, 'invalid-parameter', 'Parameter value must be finite.');
  }
}

function validateRunEvents(events: unknown, errors: EvidenceIssue[]): void {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    issue(errors, '$.events', 'invalid-events', `Events must be an array with at most ${MAX_EVENTS} entries.`);
    return;
  }
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousStep = -1;
  const ids = new Set<string>();
  for (let index = 0; index < events.length; index++) {
    const path = `$.events[${index}]`;
    const event = events[index];
    if (!isRecord(event) || hasForbiddenKey(event)) {
      issue(errors, path, 'invalid-event', 'Run event must be a safe object.');
      continue;
    }
    if (!validId(event.id)) issue(errors, `${path}.id`, 'invalid-id', 'Event id is invalid.');
    else if (ids.has(event.id)) issue(errors, `${path}.id`, 'duplicate-event', `Event '${event.id}' is duplicated.`);
    else ids.add(event.id);
    if (!validFiniteNumber(event.timeS) || event.timeS < 0 || event.timeS < previousTime) {
      issue(errors, `${path}.timeS`, 'invalid-event-time', 'Event times must be finite, non-negative, and ordered.');
    } else previousTime = event.timeS;
    if (typeof event.step !== 'number' || !Number.isSafeInteger(event.step) || event.step < 0 || event.step < previousStep) {
      issue(errors, `${path}.step`, 'invalid-event-step', 'Event steps must be safe, non-negative, and ordered.');
    } else previousStep = event.step;
    if (!validText(event.kind, 128)) issue(errors, `${path}.kind`, 'invalid-event-kind', 'Event kind is invalid.');
    if (!validText(event.label, 512)) issue(errors, `${path}.label`, 'invalid-event-label', 'Event label is invalid.');
    if (event.severity !== undefined && !RUN_EVENT_SEVERITIES.includes(event.severity as RunEventSeverityV1)) {
      issue(errors, `${path}.severity`, 'invalid-event-severity', 'Event severity is unsupported.');
    }
    if (event.parameters !== undefined) {
      if (!isRecord(event.parameters) || Object.keys(event.parameters).length > MAX_PARAMETERS || hasForbiddenKey(event.parameters)) {
        issue(errors, `${path}.parameters`, 'invalid-event-parameters', 'Event parameters must be a bounded safe object.');
      } else {
        for (const [key, value] of Object.entries(event.parameters)) {
          if (!validId(key)) issue(errors, `${path}.parameters.${key}`, 'invalid-id', 'Event parameter name is invalid.');
          if (value !== null && !['number', 'string', 'boolean'].includes(typeof value)) {
            issue(errors, `${path}.parameters.${key}`, 'invalid-event-parameter', 'Event parameter value is not JSON-scalar data.');
          }
          if (typeof value === 'string' && value.length > 2048) {
            issue(errors, `${path}.parameters.${key}`, 'invalid-event-parameter', 'Event parameter text exceeds 2,048 characters.');
          }
          if (typeof value === 'number' && !Number.isFinite(value)) {
            issue(errors, `${path}.parameters.${key}`, 'invalid-event-parameter', 'Event parameter number must be finite.');
          }
        }
      }
    }
  }
}

export function validateRunRecordV1(input: unknown): SafeValidationResult<RunRecordV1> {
  const errors: EvidenceIssue[] = [];
  const warnings: EvidenceIssue[] = [];
  if (!isRecord(input) || hasForbiddenKey(input)) return failure([{ path: '$', code: 'invalid-record', message: 'Run record must be a safe object.' }]);
  if (input.schema !== RUN_RECORD_SCHEMA_V1) issue(errors, '$.schema', 'unsupported-schema', `Expected ${RUN_RECORD_SCHEMA_V1}.`);
  if (!validId(input.runId)) issue(errors, '$.runId', 'invalid-id', 'Run id is invalid.');
  if (!validIsoDate(input.createdAt)) issue(errors, '$.createdAt', 'invalid-date', 'createdAt must be an ISO-compatible date.');
  if (input.completedAt !== undefined && !validIsoDate(input.completedAt)) issue(errors, '$.completedAt', 'invalid-date', 'completedAt must be an ISO-compatible date.');
  if (validIsoDate(input.createdAt) && validIsoDate(input.completedAt) && Date.parse(input.completedAt) < Date.parse(input.createdAt)) {
    issue(errors, '$.completedAt', 'invalid-date-order', 'completedAt cannot precede createdAt.');
  }
  if (!CLAIM_LEVELS.includes(input.claimLevel as ClaimLevel)) issue(errors, '$.claimLevel', 'unsupported-claim', 'Claim level is unsupported.');

  if (!isRecord(input.lab) || hasForbiddenKey(input.lab)) issue(errors, '$.lab', 'invalid-lab', 'Lab descriptor must be a safe object.');
  else {
    if (!validId(input.lab.id)) issue(errors, '$.lab.id', 'invalid-id', 'Lab id is invalid.');
    if (!validText(input.lab.title, 512)) issue(errors, '$.lab.title', 'invalid-title', 'Lab title is invalid.');
    if (typeof input.lab.sceneId !== 'number' || !Number.isSafeInteger(input.lab.sceneId) || input.lab.sceneId < 0) issue(errors, '$.lab.sceneId', 'invalid-scene', 'Scene id must be a non-negative safe integer.');
    if (input.lab.materialDemoId !== undefined && !validId(input.lab.materialDemoId)) issue(errors, '$.lab.materialDemoId', 'invalid-id', 'Material demo id is invalid.');
    if (!validText(input.lab.solver, 128)) issue(errors, '$.lab.solver', 'invalid-solver', 'Solver label is invalid.');
    if (!validText(input.lab.fidelity, 256)) issue(errors, '$.lab.fidelity', 'invalid-fidelity', 'Fidelity label is invalid.');
  }

  if (!isRecord(input.engine) || hasForbiddenKey(input.engine)) issue(errors, '$.engine', 'invalid-engine', 'Engine descriptor must be a safe object.');
  else {
    if (!validText(input.engine.backend, 256)) issue(errors, '$.engine.backend', 'invalid-backend', 'Backend label is invalid.');
    if (typeof input.engine.isWasm !== 'boolean') issue(errors, '$.engine.isWasm', 'invalid-boolean', 'isWasm must be boolean.');
    if (!validText(input.engine.buildVersion, 128)) issue(errors, '$.engine.buildVersion', 'invalid-version', 'Build version is invalid.');
    if (typeof input.engine.seed !== 'number' || !Number.isSafeInteger(input.engine.seed) || input.engine.seed < 0 || input.engine.seed > 0xffffffff) issue(errors, '$.engine.seed', 'invalid-seed', 'Seed must be an unsigned 32-bit integer.');
    if (!validFiniteNumber(input.engine.fixedStepS) || input.engine.fixedStepS <= 0 || input.engine.fixedStepS > 1) issue(errors, '$.engine.fixedStepS', 'invalid-fixed-step', 'Fixed step must be in (0, 1] seconds.');
    if (typeof input.engine.substeps !== 'number' || !Number.isSafeInteger(input.engine.substeps) || input.engine.substeps < 1 || input.engine.substeps > 64) issue(errors, '$.engine.substeps', 'invalid-substeps', 'Substeps must be an integer from 1 to 64.');
  }

  validateParameters(input.parameters, '$.parameters', errors);
  validateRunEvents(input.events, errors);
  let channels: readonly ChannelDescriptorV1[] | null = null;
  if (validateChannels(input.channels, '$.channels', errors)) {
    channels = input.channels;
    validateSamples(input.samples, channels, '$.samples', errors, false);
  }

  if (!isRecord(input.final) || hasForbiddenKey(input.final)) issue(errors, '$.final', 'invalid-final', 'Final state must be a safe object.');
  else {
    for (const key of ['backendHash', 'softHash'] as const) {
      if (!Number.isSafeInteger(input.final[key]) || (input.final[key] as number) < 0 || (input.final[key] as number) > 0xffffffff) {
        issue(errors, `$.final.${key}`, 'invalid-hash', `${key} must be an unsigned 32-bit integer.`);
      }
    }
    if (!Array.isArray(input.final.warnings) || input.final.warnings.length > 256 || !input.final.warnings.every((value) => typeof value === 'string' && value.length <= 2048)) {
      issue(errors, '$.final.warnings', 'invalid-warnings', 'Warnings must be a bounded string array.');
    }
  }

  if (channels && input.claimLevel === 'calibrated' && !channels.some((channel) => channel.provenance === 'imported' || channel.provenance === 'user-calibrated')) {
    issue(errors, '$.claimLevel', 'unsupported-calibrated-claim', 'A calibrated run requires at least one imported or user-calibrated channel.');
  }
  if (channels && channels.some((channel) => channel.provenance === 'synthetic-demo')) {
    warnings.push({ path: '$.channels', code: 'synthetic-data', message: 'Run contains synthetic demo channels that cannot support engineering pass/fail decisions.' });
  }
  return errors.length > 0 ? failure(errors, warnings) : success(input as unknown as RunRecordV1, warnings);
}

export function validateTestDatasetV1(input: unknown): SafeValidationResult<TestDatasetV1> {
  const errors: EvidenceIssue[] = [];
  const warnings: EvidenceIssue[] = [];
  if (!isRecord(input) || hasForbiddenKey(input)) return failure([{ path: '$', code: 'invalid-dataset', message: 'Test dataset must be a safe object.' }]);
  if (input.schema !== TEST_DATASET_SCHEMA_V1) issue(errors, '$.schema', 'unsupported-schema', `Expected ${TEST_DATASET_SCHEMA_V1}.`);
  if (!validId(input.datasetId)) issue(errors, '$.datasetId', 'invalid-id', 'Dataset id is invalid.');
  if (!validText(input.title, 512)) issue(errors, '$.title', 'invalid-title', 'Dataset title is invalid.');
  if (!validIsoDate(input.createdAt)) issue(errors, '$.createdAt', 'invalid-date', 'createdAt must be an ISO-compatible date.');
  if (input.source === undefined) issue(errors, '$.source', 'missing-source', 'Dataset source provenance is required.');
  else if (!isRecord(input.source) || hasForbiddenKey(input.source)) issue(errors, '$.source', 'invalid-source', 'Dataset source must be a safe object.');
  else {
    if (!['physical-test', 'simulation-export', 'synthetic-demo'].includes(String(input.source.kind))) issue(errors, '$.source.kind', 'invalid-source-kind', 'Dataset source kind is unsupported.');
    if (input.source.fileName !== undefined && !validText(input.source.fileName, 512)) issue(errors, '$.source.fileName', 'invalid-file-name', 'Source file name is invalid.');
    if (input.source.notes !== undefined && (typeof input.source.notes !== 'string' || input.source.notes.length > 8192)) issue(errors, '$.source.notes', 'invalid-notes', 'Source notes must be text no longer than 8,192 characters.');
  }
  let channels: readonly ChannelDescriptorV1[] | null = null;
  if (validateChannels(input.channels, '$.channels', errors)) {
    channels = input.channels;
    validateSamples(input.samples, channels, '$.samples', errors, true);
  }
  const declaredProvenances = Array.isArray(input.channels)
    ? input.channels.filter(isRecord).map((channel) => channel.provenance)
    : [];
  if (channels && input.source && isRecord(input.source) && input.source.kind === 'synthetic-demo') {
    const nonSynthetic = channels.filter((channel) => channel.provenance !== 'synthetic-demo' && channel.provenance !== 'derived');
    if (nonSynthetic.length > 0) issue(errors, '$.channels', 'synthetic-source-mismatch', 'Synthetic datasets may contain only synthetic or derived channels.');
    warnings.push({ path: '$.source', code: 'synthetic-data', message: 'Synthetic datasets cannot support engineering pass/fail decisions.' });
  }
  if (input.source && isRecord(input.source) && input.source.kind === 'physical-test') {
    if (declaredProvenances.some((provenance) => provenance === 'solver-native' || provenance === 'synthetic-demo')) {
      issue(errors, '$.channels', 'physical-source-mismatch', 'Physical-test datasets may contain only imported, calibrated, or trusted derived channels.');
    }
  }
  if (input.source && isRecord(input.source) && input.source.kind === 'simulation-export') {
    if (declaredProvenances.some((provenance) => provenance === 'synthetic-demo')) {
      issue(errors, '$.channels', 'simulation-source-mismatch', 'Simulation exports cannot contain synthetic-demo channels.');
    }
  }
  return errors.length > 0 ? failure(errors, warnings) : success(input as unknown as TestDatasetV1, warnings);
}

export function parseRunRecordV1Json(text: string): SafeValidationResult<RunRecordV1> {
  const parsed = safeJsonValue(text, 'Run record');
  return parsed.ok ? validateRunRecordV1(parsed.value) : parsed;
}

export function parseTestDatasetV1Json(text: string): SafeValidationResult<TestDatasetV1> {
  const parsed = safeJsonValue(text, 'Test dataset');
  return parsed.ok ? validateTestDatasetV1(parsed.value) : parsed;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      if (rows.length > MAX_SAMPLES + 2) throw new EvidenceFormatError(`CSV exceeds the ${MAX_SAMPLES}-sample safety limit.`);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new EvidenceFormatError('CSV contains an unterminated quoted field.');
  row.push(field);
  if (row.length > 1 || row[0].length > 0) rows.push(row);
  return rows;
}

function parseCsvNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!DECIMAL_PATTERN.test(trimmed)) throw new EvidenceFormatError(`'${trimmed.slice(0, 64)}' is not a finite decimal number.`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new EvidenceFormatError(`'${trimmed.slice(0, 64)}' is not finite.`);
  return parsed;
}

/** Parses mapped wide-form CSV into the same validated dataset contract used by JSON import. */
export function parseTestDatasetCsv(text: string, options: TestDatasetCsvOptions): SafeValidationResult<TestDatasetV1> {
  const sizeIssue = validateTextSize(text, 'CSV dataset');
  if (sizeIssue) return failure([sizeIssue]);
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch (error) {
    return failure([{ path: '$', code: 'invalid-csv', message: error instanceof Error ? error.message : String(error) }]);
  }
  if (rows.length < 2) return failure([{ path: '$', code: 'empty-csv', message: 'CSV requires a header and at least one sample row.' }]);
  const headers = rows[0].map((value, index) => (index === 0 ? value.replace(/^\ufeff/, '') : value).trim());
  if (headers.some((header) => header.length === 0)) return failure([{ path: '$.header', code: 'empty-header', message: 'CSV headers cannot be empty.' }]);
  if (new Set(headers).size !== headers.length) return failure([{ path: '$.header', code: 'duplicate-header', message: 'CSV headers must be unique.' }]);
  if (options.channels.length === 0 || options.channels.length > MAX_CHANNELS) return failure([{ path: '$.channels', code: 'invalid-channels', message: `CSV mapping requires 1-${MAX_CHANNELS} channels.` }]);

  const timeColumn = options.timeColumn ?? 'time_s';
  const timeIndex = headers.indexOf(timeColumn);
  if (timeIndex < 0) return failure([{ path: '$.header', code: 'missing-time-column', message: `CSV is missing required '${timeColumn}' column.` }]);
  const mappedIndices = new Map<string, number>();
  const channels: ChannelDescriptorV1[] = options.channels.map(({ column: _column, ...channel }) => ({ ...channel }));
  for (const spec of options.channels) {
    const columnIndex = headers.indexOf(spec.column);
    if (columnIndex < 0) return failure([{ path: '$.header', code: 'missing-channel-column', message: `CSV is missing mapped '${spec.column}' column.` }]);
    if (mappedIndices.has(spec.column)) return failure([{ path: '$.channels', code: 'duplicate-mapping', message: `CSV column '${spec.column}' is mapped more than once.` }]);
    mappedIndices.set(spec.column, columnIndex);
  }

  const timeS: number[] = [];
  const values: Record<string, (number | null)[]> = Object.create(null) as Record<string, (number | null)[]>;
  for (const channel of channels) values[channel.id] = [];
  try {
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (row.length > headers.length) throw new EvidenceFormatError(`Row ${rowIndex + 1} contains more fields than the header.`);
      const time = parseCsvNumber(row[timeIndex] ?? '');
      if (time === null) throw new EvidenceFormatError(`Row ${rowIndex + 1} is missing time.`);
      timeS.push(time);
      for (let channelIndex = 0; channelIndex < options.channels.length; channelIndex++) {
        const spec = options.channels[channelIndex];
        values[channels[channelIndex].id].push(parseCsvNumber(row[mappedIndices.get(spec.column)!] ?? ''));
      }
    }
  } catch (error) {
    return failure([{ path: '$.rows', code: 'invalid-csv-value', message: error instanceof Error ? error.message : String(error) }]);
  }

  const dataset: TestDatasetV1 = {
    schema: TEST_DATASET_SCHEMA_V1,
    datasetId: options.datasetId,
    title: options.title,
    createdAt: options.createdAt ?? new Date().toISOString(),
    source: options.source,
    channels,
    samples: { timeS, values },
  };
  return validateTestDatasetV1(dataset);
}

function canonicalize(
  value: unknown,
  stack: Set<object>,
  counter: { value: number },
  depth: number,
): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new EvidenceFormatError(`Canonical JSON exceeds depth ${MAX_CANONICAL_DEPTH}.`);
  counter.value++;
  if (counter.value > MAX_CANONICAL_NODES) throw new EvidenceFormatError('Canonical JSON exceeds the node safety limit.');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EvidenceFormatError('Canonical JSON cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new EvidenceFormatError(`Canonical JSON does not support ${typeof value}.`);
  if (stack.has(value)) throw new EvidenceFormatError('Canonical JSON cannot contain cycles.');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, stack, counter, depth + 1)).join(',')}]`;
    }
    if (!isRecord(value) || hasForbiddenKey(value)) throw new EvidenceFormatError('Canonical JSON requires safe plain objects.');
    const fields = Object.keys(value).sort().map((key) => {
      const entry = value[key];
      if (entry === undefined) throw new EvidenceFormatError(`Canonical JSON field '${key}' is undefined.`);
      return `${JSON.stringify(key)}:${canonicalize(entry, stack, counter, depth + 1)}`;
    });
    return `{${fields.join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

/** Stable JSON encoding with recursively sorted object keys and strict JSON values. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>(), { value: 0 }, 0);
}

export function tryCanonicalJson(value: unknown): SafeValidationResult<string> {
  try {
    return success(canonicalJson(value));
  } catch (error) {
    return failure([{ path: '$', code: 'non-canonical-value', message: error instanceof Error ? error.message : String(error) }]);
  }
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new EvidenceFormatError('Web Crypto SHA-256 is unavailable in this runtime.');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function evidencePayload(
  run: RunRecordV1,
  testDataset?: TestDatasetV1,
  findings?: EvidenceFindingsV1,
): Record<string, unknown> {
  return {
    schema: ENGINEERING_EVIDENCE_SCHEMA_V1,
    run,
    ...(testDataset ? { testDataset } : {}),
    ...(findings ? { findings } : {}),
  };
}

export async function computeEvidenceChecksumV1(
  run: RunRecordV1,
  testDataset?: TestDatasetV1,
  findings?: EvidenceFindingsV1,
): Promise<string> {
  return sha256Hex(canonicalJson(evidencePayload(run, testDataset, findings)));
}

export async function createEngineeringEvidenceV1(
  run: RunRecordV1,
  testDataset?: TestDatasetV1,
  findings?: EvidenceFindingsV1,
): Promise<SafeValidationResult<EngineeringEvidenceV1>> {
  const runResult = validateRunRecordV1(run);
  if (!runResult.ok) return failure(runResult.errors, runResult.warnings);
  const warnings: EvidenceIssue[] = [...runResult.warnings];
  if (testDataset) {
    const datasetResult = validateTestDatasetV1(testDataset);
    warnings.push(...datasetResult.warnings);
    if (!datasetResult.ok) return failure(datasetResult.errors, warnings);
  }
  if (findings) {
    const findingsResult = validateEvidenceFindingsV1(findings, runResult.value, testDataset);
    if (!findingsResult.ok) return failure(findingsResult.errors, warnings);
  }
  try {
    // Snapshot before the asynchronous digest so caller mutation cannot create
    // an envelope whose checksum was computed from a different payload state.
    const snapshotRun = JSON.parse(canonicalJson(run)) as RunRecordV1;
    const snapshotDataset = testDataset
      ? JSON.parse(canonicalJson(testDataset)) as TestDatasetV1
      : undefined;
    const snapshotFindings = findings
      ? JSON.parse(canonicalJson(findings)) as EvidenceFindingsV1
      : undefined;
    const checksum = await computeEvidenceChecksumV1(snapshotRun, snapshotDataset, snapshotFindings);
    return success({
      schema: ENGINEERING_EVIDENCE_SCHEMA_V1,
      checksum: { algorithm: 'SHA-256', canonicalization: CANONICAL_JSON_SCHEMA_V1, value: checksum },
      run: snapshotRun,
      ...(snapshotDataset ? { testDataset: snapshotDataset } : {}),
      ...(snapshotFindings ? { findings: snapshotFindings } : {}),
    }, warnings);
  } catch (error) {
    return failure([{ path: '$', code: 'checksum-failed', message: error instanceof Error ? error.message : String(error) }], warnings);
  }
}

export async function verifyEngineeringEvidenceV1(input: unknown): Promise<SafeValidationResult<EngineeringEvidenceV1>> {
  const errors: EvidenceIssue[] = [];
  const warnings: EvidenceIssue[] = [];
  if (!isRecord(input) || hasForbiddenKey(input)) return failure([{ path: '$', code: 'invalid-evidence', message: 'Evidence must be a safe object.' }]);
  for (const key of Object.keys(input)) {
    if (!['schema', 'checksum', 'run', 'testDataset', 'findings'].includes(key)) {
      issue(errors, `$.${key}`, 'unexpected-evidence-field', `Evidence field '${key}' is not covered by schema v1.`);
    }
  }
  if (input.schema !== ENGINEERING_EVIDENCE_SCHEMA_V1) issue(errors, '$.schema', 'unsupported-schema', `Expected ${ENGINEERING_EVIDENCE_SCHEMA_V1}.`);
  if (!isRecord(input.checksum)) issue(errors, '$.checksum', 'invalid-checksum', 'Checksum descriptor is missing.');
  else {
    for (const key of Object.keys(input.checksum)) {
      if (!['algorithm', 'canonicalization', 'value'].includes(key)) {
        issue(errors, `$.checksum.${key}`, 'unexpected-checksum-field', `Checksum field '${key}' is not covered by schema v1.`);
      }
    }
    if (input.checksum.algorithm !== 'SHA-256') issue(errors, '$.checksum.algorithm', 'unsupported-checksum', 'Only SHA-256 is supported.');
    if (input.checksum.canonicalization !== CANONICAL_JSON_SCHEMA_V1) issue(errors, '$.checksum.canonicalization', 'unsupported-canonicalization', `Expected ${CANONICAL_JSON_SCHEMA_V1}.`);
    if (typeof input.checksum.value !== 'string' || !CHECKSUM_PATTERN.test(input.checksum.value)) issue(errors, '$.checksum.value', 'invalid-checksum', 'Checksum must be 64 lowercase hexadecimal characters.');
  }
  const runResult = validateRunRecordV1(input.run);
  warnings.push(...runResult.warnings);
  if (!runResult.ok) errors.push(...runResult.errors.map((entry) => ({ ...entry, path: `$.run${entry.path.slice(1)}` })));
  let dataset: TestDatasetV1 | undefined;
  if (input.testDataset !== undefined) {
    const datasetResult = validateTestDatasetV1(input.testDataset);
    warnings.push(...datasetResult.warnings);
    if (!datasetResult.ok) errors.push(...datasetResult.errors.map((entry) => ({ ...entry, path: `$.testDataset${entry.path.slice(1)}` })));
    else dataset = datasetResult.value;
  }
  let findings: EvidenceFindingsV1 | undefined;
  if (input.findings !== undefined) {
    if (!runResult.ok) {
      issue(errors, '$.findings', 'invalid-findings', 'Findings cannot be verified until the run record is valid.');
    } else {
      const findingsResult = validateEvidenceFindingsV1(input.findings, runResult.value, dataset);
      if (!findingsResult.ok) errors.push(...findingsResult.errors);
      else findings = findingsResult.value;
    }
  }
  if (errors.length > 0 || !runResult.ok || !isRecord(input.checksum) || typeof input.checksum.value !== 'string') return failure(errors, warnings);
  try {
    const expected = await computeEvidenceChecksumV1(runResult.value, dataset, findings);
    if (expected !== input.checksum.value) return failure([{ path: '$.checksum.value', code: 'checksum-mismatch', message: 'Evidence payload does not match its SHA-256 checksum.' }], warnings);
    return success(input as unknown as EngineeringEvidenceV1, warnings);
  } catch (error) {
    return failure([{ path: '$.checksum', code: 'checksum-failed', message: error instanceof Error ? error.message : String(error) }], warnings);
  }
}

export async function parseEngineeringEvidenceV1Json(text: string): Promise<SafeValidationResult<EngineeringEvidenceV1>> {
  const parsed = safeJsonValue(text, 'Engineering evidence');
  return parsed.ok ? verifyEngineeringEvidenceV1(parsed.value) : parsed;
}
