import './physics-correlation.css';

import {
  correlateEngineeringSeries,
  type CorrelationResult,
  type CorrelationSettings,
} from '../workbench/engineering-analysis';
import type {
  ChannelUncertaintyV1,
  SampleTableV1,
} from '../workbench/engineering-evidence';
import type { EngineeringSample } from '../workbench/engineering-session';

export const PHYSICS_CORRELATION_CSS_PREFIX = 'phys-corr-';
export const PHYSICS_CORRELATION_CHART_IDS = ['response', 'energy', 'residual'] as const;
export type PhysicsCorrelationChartId = (typeof PHYSICS_CORRELATION_CHART_IDS)[number];

export const PHYSICS_CORRELATION_SAMPLE_CHANNELS = ['load', 'response', 'energy', 'damage'] as const;
export type PhysicsCorrelationSampleChannel = (typeof PHYSICS_CORRELATION_SAMPLE_CHANNELS)[number];

export const PHYSICS_CORRELATION_WEIGHTINGS = ['uniform', 'peak-weighted', 'energy-weighted'] as const;
export type PhysicsCorrelationWeighting = (typeof PHYSICS_CORRELATION_WEIGHTINGS)[number];

export const PHYSICS_CORRELATION_ALIGNMENTS = [
  'event-trigger',
  'bounded-cross-correlation',
  'manual',
] as const;
export type PhysicsCorrelationAlignmentMethod = (typeof PHYSICS_CORRELATION_ALIGNMENTS)[number];

export const PHYSICS_CORRELATION_CHECK_STATUSES = ['pass', 'warning', 'fail', 'pending'] as const;
export type PhysicsCorrelationCheckStatus = (typeof PHYSICS_CORRELATION_CHECK_STATUSES)[number];

export const PHYSICS_CORRELATION_CASE_STATUSES = ['pass', 'pass-with-notes', 'fail', 'pending'] as const;
export type PhysicsCorrelationCaseStatus = (typeof PHYSICS_CORRELATION_CASE_STATUSES)[number];

export const PHYSICS_CORRELATION_ROLES = ['REFERENCE', 'TEST'] as const;
export type PhysicsCorrelationReferenceRole = (typeof PHYSICS_CORRELATION_ROLES)[number];

export const PHYSICS_CORRELATION_ACTIONS = [
  'frame-previous',
  'frame-next',
  'replay',
  'play',
  'align',
  'refresh',
  'export',
  'import-data',
  'import-reference',
  'capture',
  'grid',
  'settings',
  'bookmark',
] as const;
export type PhysicsCorrelationAction = (typeof PHYSICS_CORRELATION_ACTIONS)[number];

export const PHYSICS_CORRELATION_DISCLOSURE =
  'Deterministic reduced-order simulation for comparative testing and workflow prototyping. Values are not certified engineering predictions.';

export const DEFAULT_PHYSICS_CORRELATION_SETTINGS: CorrelationSettings = Object.freeze({
  maximumShiftSamples: 24,
  smoothingWindow: 5,
  weighting: 'uniform',
});

const COLORS = {
  reference: '#20c8f4',
  candidate: '#9b55f5',
  residual: '#f1f3f2',
  cursor: '#ff7900',
  grid: '#2b3133',
  axis: '#778083',
  legend: '#b9bec0',
  band: 'rgba(148, 156, 160, 0.28)',
  zero: '#51585b',
  energy: ['#ff7900', '#20c8f4', '#9b55f5', '#6bd657', '#ffc21a'] as const,
} as const;

export type PhysicsCorrelationSeries = {
  readonly id: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly color?: string;
  readonly dashed?: boolean;
};

export type PhysicsCorrelationBand = {
  readonly label: string;
  readonly lower: readonly number[];
  readonly upper: readonly number[];
  readonly color?: string;
};

export type PhysicsCorrelationPlot = {
  readonly title?: string;
  readonly x: readonly number[];
  readonly series: readonly PhysicsCorrelationSeries[];
  readonly band?: PhysicsCorrelationBand;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly xDomain?: readonly [number, number];
  readonly yDomain?: readonly [number, number];
  readonly cursorX?: number;
  readonly cursorLabel?: string;
  readonly zeroLine?: boolean;
  readonly emptyLabel?: string;
};

export type PhysicsCorrelationEnergySlice = {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly percent: number;
  readonly color?: string;
};

export type PhysicsCorrelationCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: PhysicsCorrelationCheckStatus;
  readonly detail: string;
};

export type PhysicsCorrelationCase = {
  readonly id: string;
  readonly speed: number;
  readonly angle: number;
  readonly status: PhysicsCorrelationCaseStatus;
  readonly note?: string;
};

export type PhysicsCorrelationChannel = {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly unit: string;
  readonly color: string;
  readonly enabled: boolean;
};

export type PhysicsCorrelationBookmark = {
  readonly frame: number;
  readonly label: string;
};

export type PhysicsCorrelationStat = {
  readonly label: string;
  readonly value: string;
};

export type PhysicsCorrelationMedia = {
  readonly kind: 'image' | 'video';
  readonly src: string;
  readonly label: string;
};

export type PhysicsCorrelationAlignment = {
  readonly method: PhysicsCorrelationAlignmentMethod;
  readonly triggerSource: string;
  readonly threshold: number;
  readonly thresholdUnit: string;
  readonly offsetSamples: number;
  readonly maxOffsetSeconds: number;
};

export type PhysicsCorrelationCallbacks = {
  readonly onFrameSeek?: (frame: number) => void;
  readonly onCursorSeek?: (x: number) => void;
  readonly onCaseChange?: (caseId: string) => void;
  readonly onChannelToggle?: (channelId: string, enabled: boolean) => void;
  readonly onSettingsChange?: (settings: CorrelationSettings) => void;
  readonly onAlign?: (result: CorrelationResult) => void;
  readonly onExportEvidence?: () => void | Promise<void>;
  readonly onReplay?: () => void;
  readonly onPlayToggle?: (playing: boolean) => void;
  readonly onImportReference?: () => void;
  readonly onImportData?: () => void;
  readonly onTool?: (tool: 'capture' | 'grid' | 'settings' | 'bookmark') => void;
  readonly onSplitChange?: (percent: number) => void;
};

export type PhysicsCorrelationUpdate = {
  readonly title?: string;
  readonly context?: string;
  readonly syncLabel?: string;
  readonly synced?: boolean;
  readonly frame?: number;
  readonly frameMax?: number;
  readonly cursorTime?: number | null;
  readonly timeUnit?: string;
  readonly playing?: boolean;
  readonly referenceRole?: PhysicsCorrelationReferenceRole;
  readonly referenceCaption?: string;
  readonly candidateCaption?: string;
  readonly provenanceLabel?: string;
  readonly provenance?: 'solver-native' | 'derived' | 'imported' | 'synthetic-demo';
  readonly score?: number | null;
  readonly scoreStatus?: string;
  readonly result?: CorrelationResult | null;
  readonly settings?: Partial<CorrelationSettings>;
  readonly plots?: Partial<Record<PhysicsCorrelationChartId, PhysicsCorrelationPlot>>;
  readonly energy?: readonly PhysicsCorrelationEnergySlice[];
  readonly energyWarning?: string | null;
  readonly energyAbsorbed?: { readonly value: number; readonly unit: string; readonly label: string } | null;
  readonly cases?: readonly PhysicsCorrelationCase[];
  readonly activeCaseId?: string;
  readonly channels?: readonly PhysicsCorrelationChannel[];
  readonly bookmarks?: readonly PhysicsCorrelationBookmark[];
  readonly checks?: readonly PhysicsCorrelationCheck[];
  readonly alignment?: Partial<PhysicsCorrelationAlignment>;
  readonly solverStats?: readonly PhysicsCorrelationStat[];
  readonly contactNote?: string;
  readonly modelNote?: string;
  readonly uncertaintyStats?: readonly PhysicsCorrelationStat[];
  readonly footerStats?: readonly PhysicsCorrelationStat[];
  readonly evidenceStats?: {
    readonly alignment?: readonly PhysicsCorrelationStat[];
    readonly model?: readonly PhysicsCorrelationStat[];
    readonly provenance?: readonly PhysicsCorrelationStat[];
  };
  readonly responseChannelId?: PhysicsCorrelationSampleChannel | string;
  readonly referenceSamples?: readonly EngineeringSample[] | null;
  readonly candidateSamples?: readonly EngineeringSample[] | null;
  readonly referenceTable?: SampleTableV1 | null;
  readonly candidateTable?: SampleTableV1 | null;
  readonly pair?: { readonly referenceChannelId: string; readonly candidateChannelId: string };
  readonly uncertainty?: ChannelUncertaintyV1 | null;
  readonly referenceMedia?: PhysicsCorrelationMedia | null;
  readonly candidateSnapshot?: PhysicsCorrelationMedia | null;
  readonly lastSaved?: string | null;
  readonly message?: string;
};

export type PhysicsCorrelationMountOptions = {
  readonly idPrefix?: string;
  readonly viewport?: HTMLElement;
  readonly callbacks?: PhysicsCorrelationCallbacks;
  readonly initial?: PhysicsCorrelationUpdate;
  readonly splitPercent?: number;
};

export type PhysicsCorrelationView = {
  readonly root: HTMLElement;
  readonly elements: {
    readonly viewportSlot: HTMLElement;
    readonly referencePane: HTMLElement;
    readonly canvases: Readonly<Record<PhysicsCorrelationChartId, HTMLCanvasElement>>;
  };
  update(patch: PhysicsCorrelationUpdate): void;
  attachViewport(viewport: HTMLElement | null): void;
  redraw(): void;
  getState(): PhysicsCorrelationPublicState;
  destroy(): void;
};

export type PhysicsCorrelationPublicState = {
  readonly frame: number;
  readonly frameMax: number;
  readonly score: number | null;
  readonly synced: boolean;
  readonly playing: boolean;
  readonly activeCaseId: string;
  readonly settings: CorrelationSettings;
  readonly result: CorrelationResult | null;
  readonly referenceRole: PhysicsCorrelationReferenceRole;
};

type ViewState = {
  title: string;
  context: string;
  syncLabel: string;
  synced: boolean;
  frame: number;
  frameMax: number;
  cursorTime: number | null;
  timeUnit: string;
  playing: boolean;
  referenceRole: PhysicsCorrelationReferenceRole;
  referenceCaption: string;
  candidateCaption: string;
  provenanceLabel: string;
  provenance: 'solver-native' | 'derived' | 'imported' | 'synthetic-demo';
  score: number | null;
  scoreStatus: string | null;
  result: CorrelationResult | null;
  settings: CorrelationSettings;
  plots: Partial<Record<PhysicsCorrelationChartId, PhysicsCorrelationPlot>>;
  energy: readonly PhysicsCorrelationEnergySlice[];
  energyWarning: string | null;
  energyAbsorbed: { value: number; unit: string; label: string } | null;
  cases: readonly PhysicsCorrelationCase[];
  activeCaseId: string;
  channels: readonly PhysicsCorrelationChannel[];
  bookmarks: readonly PhysicsCorrelationBookmark[];
  checks: readonly PhysicsCorrelationCheck[] | null;
  alignment: PhysicsCorrelationAlignment;
  solverStats: readonly PhysicsCorrelationStat[];
  contactNote: string;
  modelNote: string;
  uncertaintyStats: readonly PhysicsCorrelationStat[];
  footerStats: readonly PhysicsCorrelationStat[];
  evidenceAlignment: readonly PhysicsCorrelationStat[];
  evidenceModel: readonly PhysicsCorrelationStat[];
  evidenceProvenance: readonly PhysicsCorrelationStat[];
  responseChannelId: string;
  referenceSamples: readonly EngineeringSample[] | null;
  candidateSamples: readonly EngineeringSample[] | null;
  referenceTable: SampleTableV1 | null;
  candidateTable: SampleTableV1 | null;
  pair: { referenceChannelId: string; candidateChannelId: string } | null;
  uncertainty: ChannelUncertaintyV1 | null;
  lastSaved: string | null;
  message: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Physics correlation element not found: ${selector}`);
  return element;
}

function padFrame(frame: number): string {
  return String(Math.max(0, Math.round(frame))).padStart(5, '0');
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return value.toExponential(2);
  return value.toFixed(digits);
}

function formatAxis(value: number, span: number): string {
  if (!Number.isFinite(value)) return '—';
  if (span >= 100) return value.toFixed(0);
  if (span >= 10) return value.toFixed(1);
  if (span >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function formatChannelValue(value: number | string, unit: string): string {
  const text = typeof value === 'number' ? formatNumber(value) : value;
  return unit ? `${text} ${unit}` : text;
}

function statusLabel(status: PhysicsCorrelationCaseStatus): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'pass-with-notes': return 'PASS W/ NOTES';
    case 'fail': return 'FAIL';
    case 'pending': return 'PENDING';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function checkIcon(status: PhysicsCorrelationCheckStatus): string {
  switch (status) {
    case 'pass': return 'ph-check-circle';
    case 'warning': return 'ph-warning';
    case 'fail': return 'ph-x-circle';
    case 'pending': return 'ph-circle-dashed';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function checkTone(status: PhysicsCorrelationCheckStatus): string {
  switch (status) {
    case 'pass': return 'pass';
    case 'warning': return 'warning';
    case 'fail': return 'fail';
    case 'pending': return 'pending';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function weightingLabel(weighting: PhysicsCorrelationWeighting): string {
  switch (weighting) {
    case 'uniform': return 'Uniform';
    case 'peak-weighted': return 'Peak-weighted';
    case 'energy-weighted': return 'Energy-weighted';
    default: {
      const exhaustive: never = weighting;
      return exhaustive;
    }
  }
}

function alignmentLabel(method: PhysicsCorrelationAlignmentMethod): string {
  switch (method) {
    case 'event-trigger': return 'Event trigger';
    case 'bounded-cross-correlation': return 'Bounded cross-correlation';
    case 'manual': return 'Manual offset';
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

function sampleValue(sample: EngineeringSample, channel: PhysicsCorrelationSampleChannel): number {
  switch (channel) {
    case 'load': return sample.load;
    case 'response': return sample.response;
    case 'energy': return sample.energy;
    case 'damage': return sample.damage;
    default: {
      const exhaustive: never = channel;
      return exhaustive;
    }
  }
}

function isSampleChannel(value: string): value is PhysicsCorrelationSampleChannel {
  return (PHYSICS_CORRELATION_SAMPLE_CHANNELS as readonly string[]).includes(value);
}

function isWeighting(value: string): value is PhysicsCorrelationWeighting {
  return (PHYSICS_CORRELATION_WEIGHTINGS as readonly string[]).includes(value);
}

function isAlignment(value: string): value is PhysicsCorrelationAlignmentMethod {
  return (PHYSICS_CORRELATION_ALIGNMENTS as readonly string[]).includes(value);
}

function isAction(value: string): value is PhysicsCorrelationAction {
  return (PHYSICS_CORRELATION_ACTIONS as readonly string[]).includes(value);
}

function seriesFromTable(table: SampleTableV1, channelId: string): { time: number[]; values: number[] } {
  const raw = table.values[channelId] ?? [];
  const time: number[] = [];
  const values: number[] = [];
  for (let index = 0; index < table.timeS.length; index++) {
    const value = raw[index];
    if (value === null || !Number.isFinite(value)) continue;
    time.push(table.timeS[index]);
    values.push(value);
  }
  return { time, values };
}

function bandFromUncertainty(
  values: readonly number[],
  uncertainty: ChannelUncertaintyV1 | null,
): PhysicsCorrelationBand | undefined {
  if (!uncertainty || uncertainty.value <= 0) return undefined;
  let lower: number[];
  let upper: number[];
  switch (uncertainty.kind) {
    case 'absolute':
      lower = values.map((value) => value - uncertainty.value);
      upper = values.map((value) => value + uncertainty.value);
      break;
    case 'relative-1sigma':
    case 'relative-2sigma':
      lower = values.map((value) => value * (1 - uncertainty.value));
      upper = values.map((value) => value * (1 + uncertainty.value));
      break;
    default: {
      const exhaustive: never = uncertainty.kind;
      return exhaustive;
    }
  }
  const label = uncertainty.kind === 'relative-2sigma'
    ? 'Imported ±2σ'
    : uncertainty.kind === 'relative-1sigma'
      ? 'Imported ±1σ'
      : `Imported ±${formatNumber(uncertainty.value)}`;
  return { label, lower, upper, color: COLORS.band };
}

function pairedTimes(
  result: CorrelationResult,
  times: readonly number[] | undefined,
): number[] {
  if (times && times.length === result.reference.length) return times.slice();
  return result.reference.map((_, index) => index);
}

export function buildPhysicsCorrelationPlots(
  result: CorrelationResult,
  options: {
    readonly times?: readonly number[];
    readonly cursorX?: number;
    readonly xLabel?: string;
    readonly yLabel?: string;
    readonly residualYLabel?: string;
    readonly referenceLabel?: string;
    readonly candidateLabel?: string;
    readonly uncertainty?: ChannelUncertaintyV1 | null;
  } = {},
): Pick<Record<PhysicsCorrelationChartId, PhysicsCorrelationPlot>, 'response' | 'residual'> {
  const x = pairedTimes(result, options.times);
  const referenceLabel = options.referenceLabel ?? 'REFERENCE';
  const candidateLabel = options.candidateLabel ?? 'CANDIDATE';
  const band = bandFromUncertainty(result.reference, options.uncertainty ?? null);
  const cursorX = options.cursorX;
  return {
    response: {
      title: 'RESPONSE HISTORY',
      x,
      series: [
        { id: 'reference', label: referenceLabel, values: result.reference, color: COLORS.reference },
        { id: 'candidate', label: candidateLabel, values: result.candidate, color: COLORS.candidate },
      ],
      band,
      xLabel: options.xLabel ?? 'model time',
      yLabel: options.yLabel ?? 'normalized response',
      cursorX,
      emptyLabel: 'No paired series',
    },
    residual: {
      title: 'RESIDUAL',
      x,
      series: [{ id: 'residual', label: 'Residual', values: result.residual, color: COLORS.residual }],
      band: band
        ? {
          label: band.label,
          lower: result.reference.map((_, index) => (band.lower[index] ?? 0) - result.reference[index]),
          upper: result.reference.map((_, index) => (band.upper[index] ?? 0) - result.reference[index]),
          color: COLORS.band,
        }
        : undefined,
      xLabel: options.xLabel ?? 'model time',
      yLabel: options.residualYLabel ?? 'normalized residual',
      cursorX,
      zeroLine: true,
      emptyLabel: 'No residual',
    },
  };
}

function extractSeries(state: ViewState): { reference: number[]; candidate: number[]; times: number[] } | null {
  if (state.referenceTable && state.candidateTable && state.pair) {
    const reference = seriesFromTable(state.referenceTable, state.pair.referenceChannelId);
    const candidate = seriesFromTable(state.candidateTable, state.pair.candidateChannelId);
    if (reference.values.length < 3 || candidate.values.length < 3) return null;
    return { reference: reference.values, candidate: candidate.values, times: reference.time };
  }
  if (state.referenceSamples && state.candidateSamples) {
    const channel = isSampleChannel(state.responseChannelId) ? state.responseChannelId : 'response';
    const reference = state.referenceSamples.map((sample) => sampleValue(sample, channel));
    const candidate = state.candidateSamples.map((sample) => sampleValue(sample, channel));
    if (reference.length < 3 || candidate.length < 3) return null;
    return {
      reference,
      candidate,
      times: state.referenceSamples.map((sample) => sample.time),
    };
  }
  return null;
}

function recompute(state: ViewState): CorrelationResult | null {
  const series = extractSeries(state);
  if (!series) return null;
  return correlateEngineeringSeries(series.reference, series.candidate, state.settings);
}

function deriveChecks(state: ViewState): PhysicsCorrelationCheck[] {
  const result = state.result;
  const count = result?.reference.length ?? 0;
  const paired = count >= 3;
  const finite = paired
    && result!.reference.every(Number.isFinite)
    && result!.candidate.every(Number.isFinite);
  const hashes = Boolean(
    state.referenceSamples?.some((sample) => sample.hash !== 0)
    || state.candidateSamples?.some((sample) => sample.hash !== 0),
  );
  const energy = state.energy.length > 0
    || Boolean(state.referenceSamples?.some((sample) => sample.energy > 0));
  return [
    {
      id: 'alignment',
      label: 'Time alignment',
      status: result ? 'pass' : 'pending',
      detail: result ? `${result.shiftSamples} samples` : 'Not mapped',
    },
    {
      id: 'channels',
      label: 'Channel compatibility',
      status: paired ? 'pass' : 'pending',
      detail: paired ? 'Paired quantities' : 'Not mapped',
    },
    {
      id: 'finite',
      label: 'Finite samples',
      status: !paired ? 'pending' : finite ? 'pass' : 'fail',
      detail: finite ? 'OK' : 'Non-finite',
    },
    {
      id: 'saturation',
      label: 'Saturation metadata',
      status: state.referenceRole === 'TEST' ? 'pass' : 'pending',
      detail: state.referenceRole === 'TEST' ? 'Imported record' : 'N/A',
    },
    {
      id: 'energy',
      label: 'Energy trend',
      status: energy ? 'pass' : 'pending',
      detail: energy ? 'Proxy available' : 'Unavailable',
    },
    {
      id: 'replay',
      label: 'Replay hashes',
      status: hashes ? 'pass' : 'pending',
      detail: hashes ? 'Present' : 'Unavailable',
    },
    {
      id: 'window',
      label: 'Window ≥ 32 samples',
      status: !paired ? 'pending' : count >= 32 ? 'pass' : 'fail',
      detail: `${count} samples`,
    },
    {
      id: 'score',
      label: 'Score without extrapolation',
      status: paired ? 'pass' : 'pending',
      detail: paired ? 'Shared domain' : 'Not scored',
    },
  ];
}

function scoreBadge(state: ViewState, checks: readonly PhysicsCorrelationCheck[]): { label: string; tone: string } {
  if (state.scoreStatus) {
    const label = state.scoreStatus;
    if (/fail/i.test(label)) return { label, tone: 'fail' };
    if (/pass with/i.test(label)) return { label, tone: 'warning' };
    if (/^pass$/i.test(label)) return { label, tone: 'pass' };
    if (/not scored|pending/i.test(label)) return { label, tone: 'pending' };
    return { label, tone: 'warning' };
  }
  if (state.score === null || !state.result) return { label: 'NOT SCORED', tone: 'pending' };
  if (checks.some((check) => check.status === 'fail')) return { label: 'CHECKS FAILED', tone: 'fail' };
  if (state.referenceRole === 'TEST' && state.provenance === 'imported') {
    return checks.some((check) => check.status === 'warning')
      ? { label: 'PASS WITH NOTES', tone: 'warning' }
      : { label: 'PASS', tone: 'pass' };
  }
  return { label: 'MODEL AGREEMENT', tone: 'warning' };
}

function defaultState(): ViewState {
  return {
    title: 'NO ARCHIVED RUN',
    context: 'Deterministic reduced-model comparison · No reference selected',
    syncLabel: 'REFERENCE REQUIRED',
    synced: false,
    frame: 0,
    frameMax: 4000,
    cursorTime: null,
    timeUnit: 's',
    playing: false,
    referenceRole: 'REFERENCE',
    referenceCaption: 'no reference',
    candidateCaption: 'live model · not archived',
    provenanceLabel: 'REDUCED NUMERICAL MODEL',
    provenance: 'solver-native',
    score: null,
    scoreStatus: null,
    result: null,
    settings: { ...DEFAULT_PHYSICS_CORRELATION_SETTINGS },
    plots: {},
    energy: [],
    energyWarning: null,
    energyAbsorbed: null,
    cases: [],
    activeCaseId: '',
    channels: [],
    bookmarks: [],
    checks: null,
    alignment: {
      method: 'bounded-cross-correlation',
      triggerSource: 'Not mapped',
      threshold: 0.2,
      thresholdUnit: 'normalized',
      offsetSamples: 0,
      maxOffsetSeconds: 0.25,
    },
    solverStats: [
      { label: 'Type', value: 'Active lab solver' },
      { label: 'Time step', value: '1 / 60 model s' },
      { label: 'Substeps', value: 'From run record' },
    ],
    contactNote: 'Solver-native state only. Transforms and replay hashes are available. Contact force channels are not exposed by this build.',
    modelNote: 'Reduced numerical model with normalized comparative parameters; not a certified constitutive model.',
    uncertaintyStats: [],
    footerStats: [
      { label: 'ALIGNMENT', value: 'NOT MAPPED' },
      { label: 'UNITS', value: 'NORMALIZED' },
      { label: 'MODEL CLOCK', value: 'FIXED 60 HZ' },
      { label: 'REPLAY', value: 'DETERMINISTIC' },
    ],
    evidenceAlignment: [
      { label: 'Trigger offset', value: '0 samples' },
      { label: 'Time zero', value: 'unlocked' },
    ],
    evidenceModel: [
      { label: 'Fixed step', value: '60 model Hz' },
      { label: 'Replay hash', value: '—' },
    ],
    evidenceProvenance: [
      { label: 'Claim', value: 'Reduced-order' },
      { label: 'Replay', value: 'Deterministic' },
    ],
    responseChannelId: 'response',
    referenceSamples: null,
    candidateSamples: null,
    referenceTable: null,
    candidateTable: null,
    pair: null,
    uncertainty: null,
    lastSaved: null,
    message: 'Ready for deterministic review',
  };
}

function applyPatch(state: ViewState, patch: PhysicsCorrelationUpdate): ViewState {
  const next: ViewState = { ...state };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.context !== undefined) next.context = patch.context;
  if (patch.syncLabel !== undefined) next.syncLabel = patch.syncLabel;
  if (patch.synced !== undefined) next.synced = patch.synced;
  if (patch.frame !== undefined) next.frame = Math.max(0, Math.round(patch.frame));
  if (patch.frameMax !== undefined) next.frameMax = Math.max(1, Math.round(patch.frameMax));
  if (patch.cursorTime !== undefined) next.cursorTime = patch.cursorTime;
  if (patch.timeUnit !== undefined) next.timeUnit = patch.timeUnit;
  if (patch.playing !== undefined) next.playing = patch.playing;
  if (patch.referenceRole !== undefined) next.referenceRole = patch.referenceRole;
  if (patch.referenceCaption !== undefined) next.referenceCaption = patch.referenceCaption;
  if (patch.candidateCaption !== undefined) next.candidateCaption = patch.candidateCaption;
  if (patch.provenanceLabel !== undefined) next.provenanceLabel = patch.provenanceLabel;
  if (patch.provenance !== undefined) next.provenance = patch.provenance;
  if (patch.settings) next.settings = { ...next.settings, ...patch.settings };
  if (patch.energy) next.energy = patch.energy;
  if (patch.energyWarning !== undefined) next.energyWarning = patch.energyWarning;
  if (patch.energyAbsorbed !== undefined) next.energyAbsorbed = patch.energyAbsorbed;
  if (patch.cases) next.cases = patch.cases;
  if (patch.activeCaseId !== undefined) next.activeCaseId = patch.activeCaseId;
  if (patch.channels) next.channels = patch.channels;
  if (patch.bookmarks) next.bookmarks = patch.bookmarks;
  if (patch.alignment) next.alignment = { ...next.alignment, ...patch.alignment };
  if (patch.solverStats) next.solverStats = patch.solverStats;
  if (patch.contactNote !== undefined) next.contactNote = patch.contactNote;
  if (patch.modelNote !== undefined) next.modelNote = patch.modelNote;
  if (patch.uncertaintyStats) next.uncertaintyStats = patch.uncertaintyStats;
  if (patch.footerStats) next.footerStats = patch.footerStats;
  if (patch.evidenceStats?.alignment) next.evidenceAlignment = patch.evidenceStats.alignment;
  if (patch.evidenceStats?.model) next.evidenceModel = patch.evidenceStats.model;
  if (patch.evidenceStats?.provenance) next.evidenceProvenance = patch.evidenceStats.provenance;
  if (patch.responseChannelId !== undefined) next.responseChannelId = patch.responseChannelId;
  if (patch.referenceSamples !== undefined) next.referenceSamples = patch.referenceSamples;
  if (patch.candidateSamples !== undefined) next.candidateSamples = patch.candidateSamples;
  if (patch.referenceTable !== undefined) next.referenceTable = patch.referenceTable;
  if (patch.candidateTable !== undefined) next.candidateTable = patch.candidateTable;
  if (patch.pair !== undefined) next.pair = patch.pair;
  if (patch.uncertainty !== undefined) next.uncertainty = patch.uncertainty;
  if (patch.lastSaved !== undefined) next.lastSaved = patch.lastSaved;
  if (patch.message !== undefined) next.message = patch.message;

  const recomputeFromInputs = patch.referenceSamples !== undefined
    || patch.candidateSamples !== undefined
    || patch.referenceTable !== undefined
    || patch.candidateTable !== undefined
    || patch.pair !== undefined
    || patch.settings !== undefined
    || patch.responseChannelId !== undefined
    || patch.uncertainty !== undefined;

  if (patch.result !== undefined) next.result = patch.result;
  else if (recomputeFromInputs) next.result = recompute(next);

  if (next.result) {
    next.alignment = { ...next.alignment, offsetSamples: next.result.shiftSamples };
    if (patch.score === undefined) next.score = next.result.score;
    if (!patch.synced && next.result.reference.length >= 3) {
      next.synced = true;
      if (patch.syncLabel === undefined) next.syncLabel = 'SYNCED';
    }
  }
  if (patch.score !== undefined) next.score = patch.score;
  if (patch.scoreStatus !== undefined) next.scoreStatus = patch.scoreStatus;

  if (patch.plots) {
    next.plots = { ...next.plots, ...patch.plots };
  } else if (next.result && (recomputeFromInputs || patch.result)) {
    const series = extractSeries(next);
    const times = series && series.times.length === next.result.reference.length ? series.times : undefined;
    const cursorX = next.cursorTime ?? (times && times.length > 0
      ? times[clamp(next.frame, 0, times.length - 1)]
      : undefined);
    next.plots = {
      ...next.plots,
      ...buildPhysicsCorrelationPlots(next.result, {
        times,
        cursorX,
        referenceLabel: next.referenceRole,
        candidateLabel: 'CANDIDATE',
        uncertainty: next.uncertainty,
      }),
    };
  }

  if (patch.checks) next.checks = patch.checks;
  else if (recomputeFromInputs || patch.result !== undefined) next.checks = deriveChecks(next);

  if (!next.energyAbsorbed && next.energy.length > 0) {
    const total = next.energy.reduce((sum, slice) => sum + slice.value, 0);
    next.energyAbsorbed = {
      value: total,
      unit: next.energy[0]?.unit ?? 'normalized',
      label: 'Energy proxy',
    };
  }

  return next;
}

function plotPadding(): { left: number; right: number; top: number; bottom: number } {
  return { left: 44, right: 12, top: 22, bottom: 28 };
}

function domainOf(values: readonly number[], fallback: readonly [number, number]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [fallback[0], fallback[1]];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (Math.abs(max - min) < 1e-9) {
    min -= 1;
    max += 1;
  }
  return [min, max];
}

function drawLinePlot(canvas: HTMLCanvasElement, plot: PhysicsCorrelationPlot | undefined): void {
  const context = canvas.getContext('2d');
  if (!context || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
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
  context.fillStyle = '#0b0e10';
  context.fillRect(0, 0, displayWidth, displayHeight);

  const padding = plotPadding();
  const plotWidth = Math.max(1, displayWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, displayHeight - padding.top - padding.bottom);
  const series = plot?.series ?? [];
  const maxLength = Math.max(0, ...series.map((entry) => entry.values.length), plot?.x.length ?? 0);
  const xValues = plot && plot.x.length >= maxLength
    ? plot.x
    : Array.from({ length: maxLength }, (_, index) => index);
  const yValues = [
    ...series.flatMap((entry) => entry.values),
    ...(plot?.band ? [...plot.band.lower, ...plot.band.upper] : []),
  ];
  const xDomain = plot?.xDomain ?? domainOf(xValues, [0, 1]);
  let yDomain = plot?.yDomain ?? domainOf(yValues, [0, 1]);
  if (plot?.zeroLine) {
    const extent = Math.max(Math.abs(yDomain[0]), Math.abs(yDomain[1]), 1e-6);
    yDomain = [-extent, extent];
  }
  const xScale = (value: number): number => padding.left + (value - xDomain[0]) / Math.max(1e-9, xDomain[1] - xDomain[0]) * plotWidth;
  const yScale = (value: number): number => padding.top + (1 - (value - yDomain[0]) / Math.max(1e-9, yDomain[1] - yDomain[0])) * plotHeight;

  context.save();
  context.beginPath();
  context.rect(padding.left, padding.top, plotWidth, plotHeight);
  context.clip();

  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  context.setLineDash([]);
  for (let index = 0; index <= 4; index++) {
    const y = padding.top + plotHeight * index / 4;
    context.beginPath();
    context.moveTo(padding.left, y + 0.5);
    context.lineTo(padding.left + plotWidth, y + 0.5);
    context.stroke();
  }
  for (let index = 0; index <= 5; index++) {
    const x = padding.left + plotWidth * index / 5;
    context.beginPath();
    context.moveTo(x + 0.5, padding.top);
    context.lineTo(x + 0.5, padding.top + plotHeight);
    context.stroke();
  }

  if (plot?.band && plot.band.lower.length > 1 && plot.band.upper.length > 1) {
    context.fillStyle = plot.band.color ?? COLORS.band;
    context.beginPath();
    plot.band.lower.forEach((value, index) => {
      const x = xScale(xValues[index] ?? index);
      const y = yScale(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    for (let index = plot.band.upper.length - 1; index >= 0; index--) {
      context.lineTo(xScale(xValues[index] ?? index), yScale(plot.band.upper[index]));
    }
    context.closePath();
    context.fill();
  }

  if (plot?.zeroLine) {
    context.strokeStyle = COLORS.zero;
    context.setLineDash([3, 3]);
    const y = yScale(0);
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(padding.left + plotWidth, y);
    context.stroke();
    context.setLineDash([]);
  }

  for (const entry of series) {
    if (entry.values.length < 2) continue;
    context.strokeStyle = entry.color ?? COLORS.reference;
    context.lineWidth = 1.7;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.setLineDash(entry.dashed ? [5, 4] : []);
    context.beginPath();
    entry.values.forEach((value, index) => {
      const x = xScale(xValues[index] ?? index);
      const y = yScale(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.setLineDash([]);
    let peakIndex = 0;
    for (let index = 1; index < entry.values.length; index++) {
      if (Math.abs(entry.values[index]) > Math.abs(entry.values[peakIndex])) peakIndex = index;
    }
    context.fillStyle = entry.color ?? COLORS.reference;
    context.beginPath();
    context.arc(xScale(xValues[peakIndex] ?? peakIndex), yScale(entry.values[peakIndex]), 2.4, 0, Math.PI * 2);
    context.fill();
  }

  if (plot?.cursorX !== undefined && Number.isFinite(plot.cursorX)) {
    const cursor = xScale(plot.cursorX);
    context.strokeStyle = COLORS.cursor;
    context.setLineDash([4, 3]);
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(cursor, padding.top);
    context.lineTo(cursor, padding.top + plotHeight);
    context.stroke();
    context.setLineDash([]);
    const label = plot.cursorLabel ?? `t = ${formatNumber(plot.cursorX, 3)}`;
    context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
    context.fillStyle = COLORS.cursor;
    const labelWidth = context.measureText(label).width;
    const labelX = clamp(cursor + 6, padding.left + 4, padding.left + plotWidth - labelWidth - 4);
    context.fillText(label, labelX, padding.top + 12);
  }
  context.restore();

  context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
  context.fillStyle = COLORS.axis;
  const ySpan = yDomain[1] - yDomain[0];
  const xSpan = xDomain[1] - xDomain[0];
  for (let index = 0; index <= 4; index++) {
    const value = yDomain[1] - ySpan * index / 4;
    const y = padding.top + plotHeight * index / 4;
    context.fillText(formatAxis(value, ySpan), 4, y + 3);
  }
  for (let index = 0; index <= 4; index++) {
    const value = xDomain[0] + xSpan * index / 4;
    const x = padding.left + plotWidth * index / 4;
    const text = formatAxis(value, xSpan);
    context.fillText(text, x - context.measureText(text).width / 2, displayHeight - 12);
  }
  if (plot?.xLabel) {
    context.fillText(plot.xLabel, padding.left + plotWidth / 2 - context.measureText(plot.xLabel).width / 2, displayHeight - 2);
  }
  if (plot?.yLabel) {
    context.save();
    context.translate(11, padding.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(plot.yLabel, -context.measureText(plot.yLabel).width / 2, 0);
    context.restore();
  }

  const legend: { label: string; color: string; swatch: 'line' | 'band' }[] = [];
  for (const entry of series.slice(0, 3)) {
    legend.push({ label: entry.label, color: entry.color ?? COLORS.reference, swatch: 'line' });
  }
  if (plot?.band) legend.push({ label: plot.band.label, color: '#94a0a4', swatch: 'band' });
  let legendX = padding.left;
  context.font = '10px IBM Plex Mono, SFMono-Regular, monospace';
  for (const item of legend) {
    if (item.swatch === 'band') {
      context.fillStyle = COLORS.band;
      context.fillRect(legendX, 6, 12, 8);
      context.strokeStyle = item.color;
      context.strokeRect(legendX + 0.5, 6.5, 11, 7);
    } else {
      context.strokeStyle = item.color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(legendX, 10);
      context.lineTo(legendX + 12, 10);
      context.stroke();
    }
    context.fillStyle = COLORS.legend;
    context.fillText(item.label, legendX + 16, 13);
    legendX += 24 + context.measureText(item.label).width;
  }

  if (!plot || maxLength < 2) {
    context.fillStyle = COLORS.axis;
    const empty = plot?.emptyLabel ?? 'No paired series';
    context.fillText(empty, padding.left + plotWidth / 2 - context.measureText(empty).width / 2, padding.top + plotHeight / 2);
  }
}

function drawEnergyDonut(
  canvas: HTMLCanvasElement,
  slices: readonly PhysicsCorrelationEnergySlice[],
  absorbed: { value: number; unit: string; label: string } | null,
): void {
  const context = canvas.getContext('2d');
  if (!context || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
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
  const cx = displayWidth / 2;
  const cy = displayHeight / 2 - 4;
  const radius = Math.max(18, Math.min(displayWidth, displayHeight) * 0.42);
  const inner = radius * 0.58;
  context.strokeStyle = '#2b3133';
  context.lineWidth = radius - inner;
  context.beginPath();
  context.arc(cx, cy, (radius + inner) / 2, 0, Math.PI * 2);
  context.stroke();

  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.percent || slice.value), 0);
  let angle = -Math.PI / 2;
  if (total > 0) {
    slices.forEach((slice, index) => {
      const portion = Math.max(0, slice.percent || slice.value) / total;
      const next = angle + portion * Math.PI * 2;
      context.strokeStyle = slice.color ?? COLORS.energy[index % COLORS.energy.length];
      context.lineWidth = radius - inner;
      context.beginPath();
      context.arc(cx, cy, (radius + inner) / 2, angle, next);
      context.stroke();
      angle = next;
    });
  }

  context.fillStyle = '#f1f3f2';
  context.font = '700 16px Barlow Condensed, Arial Narrow, sans-serif';
  const valueText = absorbed ? formatNumber(absorbed.value) : '—';
  context.fillText(valueText, cx - context.measureText(valueText).width / 2, cy + 2);
  context.fillStyle = '#8e9699';
  context.font = '8px IBM Plex Mono, SFMono-Regular, monospace';
  const unit = absorbed ? `${absorbed.unit} · ${absorbed.label}` : 'no energy proxy';
  context.fillText(unit, cx - context.measureText(unit).width / 2, cy + 14);
}

function drawTimeline(canvas: HTMLCanvasElement, frame: number, frameMax: number): void {
  const context = canvas.getContext('2d');
  if (!context || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
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
  context.strokeStyle = '#363d40';
  context.beginPath();
  context.moveTo(0, displayHeight - 6.5);
  context.lineTo(displayWidth, displayHeight - 6.5);
  context.stroke();
  context.fillStyle = '#767e81';
  context.font = '8px IBM Plex Mono, SFMono-Regular, monospace';
  const ticks = 4;
  for (let index = 0; index <= ticks; index++) {
    const x = displayWidth * index / ticks;
    context.strokeStyle = '#51585b';
    context.beginPath();
    context.moveTo(x + 0.5, 4);
    context.lineTo(x + 0.5, displayHeight - 6);
    context.stroke();
    const label = padFrame(frameMax * index / ticks);
    const offset = index === 0 ? 0 : index === ticks ? -context.measureText(label).width : -context.measureText(label).width / 2;
    context.fillText(label, x + offset, 10);
  }
  const playhead = displayWidth * (frame / Math.max(1, frameMax));
  context.strokeStyle = COLORS.cursor;
  context.fillStyle = COLORS.cursor;
  context.beginPath();
  context.moveTo(playhead, 2);
  context.lineTo(playhead, displayHeight);
  context.stroke();
  context.beginPath();
  context.moveTo(playhead, 2);
  context.lineTo(playhead - 4, 10);
  context.lineTo(playhead + 4, 10);
  context.closePath();
  context.fill();
}

function eventToDomainX(canvas: HTMLCanvasElement, plot: PhysicsCorrelationPlot | undefined, event: PointerEvent): number | null {
  if (!plot) return null;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0) return null;
  const padding = plotPadding();
  const local = event.clientX - bounds.left;
  const plotWidth = Math.max(1, bounds.width - padding.left - padding.right);
  const t = clamp((local - padding.left) / plotWidth, 0, 1);
  const xValues = plot.x.length > 0 ? plot.x : plot.series[0]?.values.map((_, index) => index) ?? [0, 1];
  const domain = plot.xDomain ?? domainOf(xValues, [0, 1]);
  return domain[0] + t * (domain[1] - domain[0]);
}

function markup(prefix: string): string {
  const id = (suffix: string): string => `${prefix}-${suffix}`;
  return `
    <header class="phys-corr-topbar">
      <strong class="phys-corr-title">CORRELATION REVIEW</strong>
      <div class="phys-corr-case">
        <strong data-phys-corr-bind="title">NO ARCHIVED RUN</strong>
        <span data-phys-corr-bind="context">Deterministic reduced-model comparison · No reference selected</span>
      </div>
      <span class="phys-corr-sync phys-corr-sync--warn" data-phys-corr-sync><i class="ph ph-link-break" aria-hidden="true"></i><span data-phys-corr-bind="sync">REFERENCE REQUIRED</span></span>
      <strong class="phys-corr-frame">FRAME <span data-phys-corr-bind="frame">00000</span></strong>
      <div class="phys-corr-frame-actions" aria-label="Checkpoint cursor">
        <button type="button" data-phys-corr-action="frame-previous" aria-label="Previous recorded frame"><i class="ph ph-caret-left" aria-hidden="true"></i></button>
        <button type="button" data-phys-corr-action="frame-next" aria-label="Next recorded frame"><i class="ph ph-caret-right" aria-hidden="true"></i></button>
        <button type="button" data-phys-corr-action="replay" aria-label="Return to first recorded frame"><i class="ph ph-skip-back" aria-hidden="true"></i></button>
      </div>
      <button class="phys-corr-icon" type="button" data-phys-corr-action="capture" aria-label="Capture comparison"><i class="ph ph-camera" aria-hidden="true"></i></button>
      <button class="phys-corr-icon" type="button" data-phys-corr-action="grid" aria-label="Toggle overlay grid"><i class="ph ph-grid-four" aria-hidden="true"></i></button>
      <button class="phys-corr-icon" type="button" data-phys-corr-action="settings" aria-label="Correlation settings"><i class="ph ph-gear" aria-hidden="true"></i></button>
    </header>
    <div class="phys-corr-body">
      <aside class="phys-corr-left" aria-label="Case matrix, channels, bookmarks, and checklist">
        <section class="phys-corr-section">
          <header><h2>CASE MATRIX</h2><button type="button" data-phys-corr-action="import-data" aria-label="Import correlation case"><i class="ph ph-plus" aria-hidden="true"></i></button></header>
          <table class="phys-corr-table">
            <thead><tr><th>ID</th><th>Input ×</th><th>Angle</th><th>Status</th></tr></thead>
            <tbody data-phys-corr-cases></tbody>
          </table>
        </section>
        <section class="phys-corr-section">
          <header><h2>CHANNELS</h2><i class="ph ph-waveform" aria-hidden="true"></i></header>
          <div class="phys-corr-channels" data-phys-corr-channels></div>
        </section>
        <section class="phys-corr-section">
          <header><h2>FRAME BOOKMARKS</h2><button type="button" data-phys-corr-action="bookmark" aria-label="Bookmark current frame"><i class="ph ph-plus" aria-hidden="true"></i></button></header>
          <div class="phys-corr-bookmarks" data-phys-corr-bookmarks></div>
        </section>
        <section class="phys-corr-section phys-corr-checklist-wrap">
          <header><h2>CHECKLIST</h2><strong>STATUS</strong></header>
          <div data-phys-corr-checks></div>
        </section>
      </aside>
      <main class="phys-corr-center">
        <section class="phys-corr-compare" data-phys-corr-compare aria-label="Reference and candidate comparison">
          <article class="phys-corr-pane phys-corr-pane--reference">
            <header><strong data-phys-corr-bind="reference-role">REFERENCE</strong><span data-phys-corr-bind="reference-caption">no reference</span></header>
            <div class="phys-corr-reference" data-phys-corr-reference></div>
          </article>
          <button class="phys-corr-split" type="button" role="slider" aria-label="Comparison split" aria-valuemin="30" aria-valuemax="70" aria-valuenow="48" data-phys-corr-split-handle><i class="ph ph-arrows-left-right" aria-hidden="true"></i></button>
          <article class="phys-corr-pane phys-corr-pane--candidate">
            <header><strong>CANDIDATE</strong><span data-phys-corr-bind="candidate-caption">live model · not archived</span></header>
            <div class="phys-corr-viewport" data-phys-corr-viewport>
              <div class="phys-corr-placeholder phys-corr-placeholder--viewport"><i class="ph ph-cube" aria-hidden="true"></i><span>Live WebGPU viewport</span></div>
              <div class="phys-corr-snapshot" data-phys-corr-snapshot hidden></div>
            </div>
            <span class="phys-corr-badge" data-phys-corr-bind="provenance" title="${PHYSICS_CORRELATION_DISCLOSURE}">REDUCED NUMERICAL MODEL</span>
          </article>
        </section>
        <section class="phys-corr-transport" aria-label="Shared frame transport">
          <div class="phys-corr-transport-buttons">
            <button type="button" data-phys-corr-action="replay" aria-label="First frame"><i class="ph ph-skip-back" aria-hidden="true"></i></button>
            <button type="button" data-phys-corr-action="frame-previous" aria-label="Previous frame"><i class="ph ph-rewind" aria-hidden="true"></i></button>
            <button type="button" data-phys-corr-action="play" aria-label="Play" data-phys-corr-play><i class="ph ph-play" aria-hidden="true"></i></button>
            <button type="button" data-phys-corr-action="frame-next" aria-label="Next frame"><i class="ph ph-fast-forward" aria-hidden="true"></i></button>
          </div>
          <div class="phys-corr-timeline">
            <canvas data-phys-corr-timeline role="img" aria-label="Recorded frame ruler"></canvas>
            <label><span class="phys-corr-sr">Correlation frame</span><input id="${id('frame')}" type="range" min="0" max="4000" value="0" data-phys-corr-frame></label>
          </div>
          <output data-phys-corr-bind="frame">00000</output>
          <button type="button" data-phys-corr-action="capture" aria-label="Capture comparison"><i class="ph ph-camera" aria-hidden="true"></i></button>
          <button type="button" data-phys-corr-action="bookmark" aria-label="Bookmark current frame"><i class="ph ph-bookmark-simple" aria-hidden="true"></i></button>
        </section>
        <section class="phys-corr-charts" aria-label="Correlation plots">
          <article class="phys-corr-chart">
            <header class="phys-corr-chart-head"><h2 data-phys-corr-bind="response-title">RESPONSE HISTORY</h2><span>Cursor <strong data-phys-corr-bind="response-readout">—</strong></span></header>
            <canvas data-phys-corr-chart="response" role="img" aria-label="Reference and candidate response history"></canvas>
          </article>
          <article class="phys-corr-chart">
            <header class="phys-corr-chart-head"><h2>ENERGY BALANCE</h2><span><strong data-phys-corr-bind="energy-readout">—</strong></span></header>
            <div class="phys-corr-energy">
              <div class="phys-corr-energy-list" data-phys-corr-energy-list></div>
              <div class="phys-corr-energy-plot">
                <canvas data-phys-corr-chart="energy" role="img" aria-label="Normalized energy balance"></canvas>
              </div>
              <p class="phys-corr-energy-warning" data-phys-corr-energy-warning hidden></p>
            </div>
          </article>
          <article class="phys-corr-chart">
            <header class="phys-corr-chart-head"><h2 data-phys-corr-bind="residual-title">RESIDUAL</h2><span><strong data-phys-corr-bind="residual-readout">—</strong></span></header>
            <canvas data-phys-corr-chart="residual" role="img" aria-label="Candidate minus reference residual"></canvas>
          </article>
        </section>
        <section class="phys-corr-meta" data-phys-corr-footer-stats aria-label="Run metadata"></section>
        <section class="phys-corr-evidence" aria-label="Evidence summary">
          <article data-phys-corr-evidence="alignment"><h3>ALIGNMENT</h3></article>
          <article data-phys-corr-evidence="model"><h3>MODEL QUALITY</h3></article>
          <article data-phys-corr-evidence="provenance"><h3>PROVENANCE</h3></article>
          <article class="phys-corr-score">
            <h3>WORKBENCH AGREEMENT</h3>
            <strong class="phys-corr-score-value" data-phys-corr-bind="score" title="Score = 100 × (0.65 × (1 − NRMSE) + 0.35 × (ρ + 1) / 2)">—</strong>
            <span class="phys-corr-score-badge" data-phys-corr-score-badge data-tone="pending">NOT SCORED</span>
          </article>
          <div class="phys-corr-actions">
            <button class="phys-corr-export" type="button" data-phys-corr-action="export"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span>EXPORT EVIDENCE</span></button>
            <button class="phys-corr-replay" type="button" data-phys-corr-action="replay">REPLAY (DETERMINISTIC)</button>
          </div>
        </section>
      </main>
      <aside class="phys-corr-right" aria-label="Alignment, solver, and correlation controls">
        <section class="phys-corr-controls is-active">
          <h2>ALIGNMENT</h2>
          <label>Method<select data-phys-corr-field="alignment-method"></select></label>
          <label>Trigger source<select data-phys-corr-field="trigger-source"></select></label>
          <label>Threshold<div class="phys-corr-field"><input data-phys-corr-field="threshold" type="number" step="0.01" value="0.2"><span data-phys-corr-bind="threshold-unit">normalized</span></div></label>
          <label>Offset<div class="phys-corr-field"><input data-phys-corr-field="offset" type="number" step="1" value="0"><span>samples</span></div></label>
          <button type="button" data-phys-corr-action="align">AUTO ALIGN</button>
        </section>
        <section class="phys-corr-controls">
          <h2>SOLVER</h2>
          <div data-phys-corr-solver-stats></div>
        </section>
        <section class="phys-corr-controls">
          <h2>CONTACT SCOPE</h2>
          <p class="phys-corr-note" data-phys-corr-bind="contact-note"></p>
        </section>
        <section class="phys-corr-controls">
          <h2>MODEL DEFINITION</h2>
          <p class="phys-corr-note" data-phys-corr-bind="model-note"></p>
        </section>
        <section class="phys-corr-controls">
          <h2>UNCERTAINTY</h2>
          <div data-phys-corr-uncertainty></div>
        </section>
        <section class="phys-corr-controls">
          <h2>CORRELATION CONTROLS</h2>
          <label>Response<select data-phys-corr-field="response-channel"></select></label>
          <label>Weighting<select data-phys-corr-field="weighting"></select></label>
          <label>Smoothing<select data-phys-corr-field="smoothing"></select></label>
          <button type="button" data-phys-corr-action="refresh">REFRESH AGREEMENT</button>
        </section>
      </aside>
    </div>
    <footer class="phys-corr-status">
      <span>STATUS: REVIEW MODE</span>
      <span data-phys-corr-bind="message">Ready for deterministic review</span>
      <span data-phys-corr-bind="saved"></span>
      <span>Fidelity: Reduced numerical model</span>
    </footer>
    <div class="phys-corr-sr" aria-live="polite" data-phys-corr-live></div>
  `;
}

function renderStats(host: HTMLElement, stats: readonly PhysicsCorrelationStat[], heading?: string): void {
  const fragment = document.createDocumentFragment();
  if (heading) {
    const title = document.createElement('h3');
    title.textContent = heading;
    fragment.append(title);
  }
  for (const stat of stats) {
    const row = document.createElement('p');
    row.className = host.classList.contains('phys-corr-controls') || host.matches('[data-phys-corr-solver-stats], [data-phys-corr-uncertainty]')
      ? 'phys-corr-side-stat'
      : 'phys-corr-stat';
    const label = document.createElement('span');
    label.textContent = stat.label;
    const value = document.createElement('strong');
    value.className = 'phys-corr-stat-value';
    value.textContent = stat.value;
    row.append(label, value);
    fragment.append(row);
  }
  if (heading) host.replaceChildren(fragment);
  else host.replaceChildren(fragment);
}

function fillSelect(
  select: HTMLSelectElement,
  options: readonly { value: string; label: string }[],
  selected: string,
): void {
  select.replaceChildren();
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  }
  select.value = selected;
  if (select.selectedIndex < 0 && options[0]) select.value = options[0].value;
}

export function mountPhysicsCorrelation(
  host: HTMLElement,
  options: PhysicsCorrelationMountOptions = {},
): PhysicsCorrelationView {
  const prefix = options.idPrefix ?? 'phys-corr';
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error('Physics correlation idPrefix must begin with a letter and contain only letters, numbers, hyphens, or underscores.');
  }

  const root = document.createElement('section');
  root.className = 'phys-corr-root';
  root.id = `${prefix}-root`;
  root.setAttribute('aria-label', 'Correlation Review');
  root.innerHTML = markup(prefix);
  host.append(root);

  const abort = new AbortController();
  const eventOptions: AddEventListenerOptions = { signal: abort.signal };
  let destroyed = false;
  let callbacks = options.callbacks ?? {};
  let state = defaultState();
  let split = clamp(options.splitPercent ?? 48, 30, 70);
  let viewport: HTMLElement | null = null;
  let viewportMarker: Comment | null = null;
  let referenceObjectUrl: string | null = null;

  const compare = required<HTMLElement>(root, '[data-phys-corr-compare]');
  const splitHandle = required<HTMLButtonElement>(root, '[data-phys-corr-split-handle]');
  const frameSlider = required<HTMLInputElement>(root, '[data-phys-corr-frame]');
  const viewportSlot = required<HTMLElement>(root, '[data-phys-corr-viewport]');
  const referencePane = required<HTMLElement>(root, '[data-phys-corr-reference]');
  const snapshotHost = required<HTMLElement>(root, '[data-phys-corr-snapshot]');
  const liveRegion = required<HTMLElement>(root, '[data-phys-corr-live]');
  const timeline = required<HTMLCanvasElement>(root, '[data-phys-corr-timeline]');
  const canvases = {
    response: required<HTMLCanvasElement>(root, '[data-phys-corr-chart="response"]'),
    energy: required<HTMLCanvasElement>(root, '[data-phys-corr-chart="energy"]'),
    residual: required<HTMLCanvasElement>(root, '[data-phys-corr-chart="residual"]'),
  } as const;
  const methodSelect = required<HTMLSelectElement>(root, '[data-phys-corr-field="alignment-method"]');
  const triggerSelect = required<HTMLSelectElement>(root, '[data-phys-corr-field="trigger-source"]');
  const thresholdInput = required<HTMLInputElement>(root, '[data-phys-corr-field="threshold"]');
  const offsetInput = required<HTMLInputElement>(root, '[data-phys-corr-field="offset"]');
  const responseSelect = required<HTMLSelectElement>(root, '[data-phys-corr-field="response-channel"]');
  const weightingSelect = required<HTMLSelectElement>(root, '[data-phys-corr-field="weighting"]');
  const smoothingSelect = required<HTMLSelectElement>(root, '[data-phys-corr-field="smoothing"]');
  const playButton = required<HTMLButtonElement>(root, '[data-phys-corr-play]');
  let splitDragging = false;

  const announce = (message: string): void => {
    liveRegion.textContent = '';
    window.setTimeout(() => { if (!destroyed) liveRegion.textContent = message; }, 20);
  };

  const setBind = (name: string, value: string): void => {
    for (const node of root.querySelectorAll(`[data-phys-corr-bind="${name}"]`)) node.textContent = value;
  };

  const setSplit = (percent: number): void => {
    split = clamp(percent, 30, 70);
    const rounded = Math.round(split * 10) / 10;
    splitHandle.setAttribute('aria-valuenow', String(rounded));
    splitHandle.setAttribute('aria-valuetext', `${rounded}% reference`);
    compare.style.setProperty('--phys-corr-split', `${rounded}%`);
  };

  const attachViewport = (next: HTMLElement | null): void => {
    if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
    viewportMarker?.remove();
    viewport?.classList.remove('phys-corr-attached');
    viewport = next;
    if (!next) return;
    viewportMarker = document.createComment(`${prefix}-viewport-origin`);
    next.parentNode?.insertBefore(viewportMarker, next);
    viewportSlot.append(next);
    next.classList.add('phys-corr-attached');
  };

  const seekFrame = (frame: number): void => {
    const next = clamp(Math.round(frame), 0, state.frameMax);
    apply({ frame: next });
    callbacks.onFrameSeek?.(next);
  };

  const renderCases = (): void => {
    const body = required<HTMLTableSectionElement>(root, '[data-phys-corr-cases]');
    body.replaceChildren();
    if (state.cases.length === 0) {
      const row = document.createElement('tr');
      row.className = 'phys-corr-empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'No archived cases';
      row.append(cell);
      body.append(row);
      return;
    }
    for (const item of state.cases) {
      const row = document.createElement('tr');
      row.dataset.physCorrCase = item.id;
      row.dataset.status = item.status;
      row.classList.toggle('is-active', item.id === state.activeCaseId);
      row.tabIndex = 0;
      row.setAttribute('aria-selected', String(item.id === state.activeCaseId));
      for (const value of [item.id, item.speed.toFixed(2), item.angle.toFixed(1), statusLabel(item.status)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
  };

  const renderChannels = (): void => {
    const host = required<HTMLElement>(root, '[data-phys-corr-channels]');
    host.replaceChildren();
    if (state.channels.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'phys-corr-note';
      empty.textContent = 'No mapped channels';
      host.append(empty);
      return;
    }
    for (const channel of state.channels) {
      const row = document.createElement('label');
      row.className = 'phys-corr-channel';
      row.dataset.physCorrChannel = channel.id;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = channel.enabled;
      const dot = document.createElement('span');
      dot.className = 'phys-corr-dot';
      dot.style.background = channel.color;
      const name = document.createElement('span');
      name.textContent = channel.label;
      const value = document.createElement('output');
      value.className = 'phys-corr-channel-value';
      value.textContent = formatChannelValue(channel.value, channel.unit);
      row.append(input, dot, name, value);
      host.append(row);
    }
  };

  const renderBookmarks = (): void => {
    const host = required<HTMLElement>(root, '[data-phys-corr-bookmarks]');
    host.replaceChildren();
    if (state.bookmarks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'phys-corr-note';
      empty.textContent = 'No bookmarks';
      host.append(empty);
      return;
    }
    for (const bookmark of state.bookmarks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phys-corr-bookmark';
      button.classList.toggle('is-active', bookmark.frame === state.frame);
      button.dataset.physCorrFrame = String(bookmark.frame);
      const frame = document.createElement('span');
      frame.className = 'phys-corr-bookmark-frame';
      frame.textContent = padFrame(bookmark.frame);
      const label = document.createElement('strong');
      label.textContent = bookmark.label;
      button.append(frame, label);
      host.append(button);
    }
  };

  const renderChecks = (checks: readonly PhysicsCorrelationCheck[]): void => {
    const host = required<HTMLElement>(root, '[data-phys-corr-checks]');
    host.replaceChildren();
    for (const check of checks) {
      const row = document.createElement('p');
      row.className = `phys-corr-check phys-corr-check--${checkTone(check.status)}`;
      const icon = document.createElement('i');
      icon.className = `ph ${checkIcon(check.status)}`;
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = check.label;
      const detail = document.createElement('strong');
      detail.textContent = check.detail;
      row.append(icon, label, detail);
      host.append(row);
    }
  };

  const renderEnergy = (): void => {
    const host = required<HTMLElement>(root, '[data-phys-corr-energy-list]');
    host.replaceChildren();
    const slices = state.energy;
    if (slices.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'phys-corr-note';
      empty.textContent = 'No energy proxy';
      host.append(empty);
    } else {
      slices.forEach((slice, index) => {
        const row = document.createElement('div');
        row.className = 'phys-corr-energy-row';
        const dot = document.createElement('span');
        dot.className = 'phys-corr-dot';
        dot.style.background = slice.color ?? COLORS.energy[index % COLORS.energy.length];
        const label = document.createElement('span');
        label.textContent = slice.label;
        const value = document.createElement('output');
        value.textContent = formatNumber(slice.value);
        const percent = document.createElement('small');
        percent.textContent = `${formatNumber(slice.percent, 1)}%`;
        row.append(dot, label, value, percent);
        host.append(row);
      });
    }
    const warning = required<HTMLElement>(root, '[data-phys-corr-energy-warning]');
    warning.hidden = !state.energyWarning;
    warning.textContent = state.energyWarning ?? '';
    const absorbed = state.energyAbsorbed;
    setBind('energy-readout', absorbed ? `${formatNumber(absorbed.value)} ${absorbed.unit}` : '—');
  };

  const renderSelects = (): void => {
    fillSelect(
      methodSelect,
      PHYSICS_CORRELATION_ALIGNMENTS.map((method) => ({ value: method, label: alignmentLabel(method) })),
      state.alignment.method,
    );
    fillSelect(
      triggerSelect,
      state.channels.length > 0
        ? state.channels.map((channel) => ({ value: channel.id, label: channel.label }))
        : [{ value: state.alignment.triggerSource, label: state.alignment.triggerSource }],
      state.alignment.triggerSource,
    );
    fillSelect(
      responseSelect,
      state.channels.length > 0
        ? state.channels.map((channel) => ({ value: channel.id, label: channel.label }))
        : PHYSICS_CORRELATION_SAMPLE_CHANNELS.map((channel) => ({ value: channel, label: channel })),
      state.responseChannelId,
    );
    fillSelect(
      weightingSelect,
      PHYSICS_CORRELATION_WEIGHTINGS.map((weighting) => ({ value: weighting, label: weightingLabel(weighting) })),
      state.settings.weighting,
    );
    fillSelect(
      smoothingSelect,
      [1, 3, 5, 7, 9, 11].map((window) => ({
        value: String(window),
        label: window === 1 ? 'None' : `${window}-pt moving average`,
      })),
      String(state.settings.smoothingWindow),
    );
    thresholdInput.value = String(state.alignment.threshold);
    offsetInput.value = String(state.alignment.offsetSamples);
    setBind('threshold-unit', state.alignment.thresholdUnit);
    const canAlign = Boolean(extractSeries(state));
    required<HTMLButtonElement>(root, '[data-phys-corr-action="align"]').disabled = !canAlign;
    triggerSelect.disabled = state.channels.length === 0;
    thresholdInput.disabled = !canAlign;
    offsetInput.disabled = state.alignment.method !== 'manual' && !canAlign;
  };

  const drawAll = (): void => {
    drawLinePlot(canvases.response, state.plots.response);
    drawLinePlot(canvases.residual, state.plots.residual);
    if (state.energy.length > 0 || state.energyAbsorbed) {
      drawEnergyDonut(canvases.energy, state.energy, state.energyAbsorbed);
    } else if (state.plots.energy) {
      drawLinePlot(canvases.energy, state.plots.energy);
    } else {
      drawEnergyDonut(canvases.energy, [], null);
    }
    drawTimeline(timeline, state.frame, state.frameMax);
  };

  const paint = (light = false): void => {
    root.dataset.provenance = state.provenance;
    setBind('title', state.title);
    setBind('context', state.context);
    setBind('sync', state.syncLabel);
    setBind('frame', padFrame(state.frame));
    setBind('reference-role', state.referenceRole);
    setBind('reference-caption', state.referenceCaption);
    setBind('candidate-caption', state.candidateCaption);
    setBind('provenance', state.provenanceLabel);
    setBind('contact-note', state.contactNote);
    setBind('model-note', state.modelNote);
    setBind('message', state.message);
    setBind('saved', state.lastSaved ? `Last saved ${state.lastSaved}` : '');
    setBind('response-title', state.plots.response?.title ?? 'RESPONSE HISTORY');
    setBind('residual-title', state.plots.residual?.title ?? 'RESIDUAL');
    const sync = required<HTMLElement>(root, '[data-phys-corr-sync]');
    sync.classList.toggle('phys-corr-sync--good', state.synced);
    sync.classList.toggle('phys-corr-sync--warn', !state.synced);
    const syncIcon = sync.querySelector('i');
    if (syncIcon) syncIcon.className = `ph ${state.synced ? 'ph-link' : 'ph-link-break'}`;
    frameSlider.max = String(state.frameMax);
    frameSlider.value = String(clamp(state.frame, 0, state.frameMax));
    const playIcon = playButton.querySelector('i');
    if (playIcon) playIcon.className = `ph ${state.playing ? 'ph-pause' : 'ph-play'}`;
    playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    const cursor = state.plots.response?.cursorX;
    setBind('response-readout', cursor !== undefined ? `${formatNumber(cursor, 3)} ${state.timeUnit}` : '—');
    const residual = state.result?.residual;
    const residualAt = residual && residual.length > 0
      ? residual[clamp(Math.round((state.frame / Math.max(1, state.frameMax)) * (residual.length - 1)), 0, residual.length - 1)]
      : null;
    setBind('residual-readout', residualAt === null ? '—' : formatNumber(residualAt, 3));
    setBind('score', state.score === null ? '—' : `${formatNumber(state.score, 1)}%`);
    const checks = state.checks ?? deriveChecks(state);
    const badge = scoreBadge(state, checks);
    const badgeNode = required<HTMLElement>(root, '[data-phys-corr-score-badge]');
    badgeNode.textContent = badge.label;
    badgeNode.dataset.tone = badge.tone;
    renderBookmarks();
    if (!light) {
      renderCases();
      renderChannels();
      renderChecks(checks);
      renderEnergy();
      renderSelects();
      renderStats(required(root, '[data-phys-corr-solver-stats]'), state.solverStats);
      const uncertaintyHost = required<HTMLElement>(root, '[data-phys-corr-uncertainty]');
      if (state.uncertaintyStats.length > 0) renderStats(uncertaintyHost, state.uncertaintyStats);
      else {
        uncertaintyHost.replaceChildren();
        const note = document.createElement('p');
        note.className = 'phys-corr-note';
        note.textContent = 'Unavailable. Shown only when imported evidence supplies uncertainty.';
        uncertaintyHost.append(note);
      }
      const footer = required<HTMLElement>(root, '[data-phys-corr-footer-stats]');
      footer.replaceChildren();
      for (const stat of state.footerStats) {
        const span = document.createElement('span');
        span.textContent = `${stat.label}: ${stat.value}`;
        footer.append(span);
      }
      renderStats(required(root, '[data-phys-corr-evidence="alignment"]'), state.evidenceAlignment, 'ALIGNMENT');
      renderStats(required(root, '[data-phys-corr-evidence="model"]'), state.evidenceModel, 'MODEL QUALITY');
      renderStats(required(root, '[data-phys-corr-evidence="provenance"]'), state.evidenceProvenance, 'PROVENANCE');
      canvases.response.setAttribute('aria-label', `${state.plots.response?.yLabel ?? 'Response'} versus ${state.plots.response?.xLabel ?? 'time'}; ${state.plots.response?.series.map((entry) => entry.label).join(' vs ') || 'no series'}`);
      canvases.residual.setAttribute('aria-label', `Residual ${state.plots.residual?.yLabel ?? ''}`);
    }
    window.requestAnimationFrame(drawAll);
  };

  const apply = (patch: PhysicsCorrelationUpdate): void => {
    if (destroyed) return;
    state = applyPatch(state, patch);
    const keys = Object.keys(patch);
    const light = keys.length > 0 && keys.every((key) => (
      key === 'frame' || key === 'playing' || key === 'cursorTime' || key === 'plots' || key === 'score'
    ));
    paint(light);
  };

  const alignNow = (): void => {
    const result = recompute(state);
    if (!result) {
      announce('Import or select paired reference and candidate series before aligning.');
      return;
    }
    apply({
      result,
      alignment: { ...state.alignment, offsetSamples: result.shiftSamples, method: 'bounded-cross-correlation' },
    });
    callbacks.onAlign?.(result);
    announce(`Aligned by ${result.shiftSamples} samples. Agreement ${formatNumber(result.score, 1)}%.`);
  };

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const caseRow = target?.closest<HTMLTableRowElement>('[data-phys-corr-case]');
    if (caseRow?.dataset.physCorrCase) {
      apply({ activeCaseId: caseRow.dataset.physCorrCase });
      callbacks.onCaseChange?.(caseRow.dataset.physCorrCase);
      announce(`Case ${caseRow.dataset.physCorrCase} selected.`);
      return;
    }
    const bookmark = target?.closest<HTMLButtonElement>('[data-phys-corr-frame]');
    if (bookmark) {
      seekFrame(Number(bookmark.dataset.physCorrFrame));
      return;
    }
    const action = target?.closest<HTMLButtonElement>('[data-phys-corr-action]')?.dataset.physCorrAction;
    if (!action || !isAction(action)) return;
    switch (action) {
      case 'frame-previous':
        seekFrame(state.frame - 1);
        break;
      case 'frame-next':
        seekFrame(state.frame + 1);
        break;
      case 'replay':
        seekFrame(0);
        callbacks.onReplay?.();
        announce('Data cursor returned to the first recorded sample.');
        break;
      case 'play': {
        const playing = !state.playing;
        apply({ playing });
        callbacks.onPlayToggle?.(playing);
        break;
      }
      case 'align':
      case 'refresh':
        alignNow();
        break;
      case 'export':
        if (!callbacks.onExportEvidence) announce('Evidence export handler is not connected.');
        else void Promise.resolve(callbacks.onExportEvidence()).then(() => announce('Evidence export requested.'));
        break;
      case 'import-data':
        callbacks.onImportData?.();
        break;
      case 'import-reference':
        callbacks.onImportReference?.();
        break;
      case 'capture':
      case 'grid':
      case 'settings':
      case 'bookmark':
        callbacks.onTool?.(action);
        if (action === 'bookmark') {
          const existing = state.bookmarks.some((entry) => entry.frame === state.frame);
          if (!existing) {
            apply({
              bookmarks: [...state.bookmarks, { frame: state.frame, label: 'Operator bookmark' }],
            });
          }
          announce(`Frame ${padFrame(state.frame)} bookmarked.`);
        }
        break;
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }, eventOptions);

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const row = target.closest<HTMLElement>('[data-phys-corr-channel]');
      if (!row?.dataset.physCorrChannel) return;
      const id = row.dataset.physCorrChannel;
      apply({
        channels: state.channels.map((channel) => channel.id === id ? { ...channel, enabled: target.checked } : channel),
      });
      callbacks.onChannelToggle?.(id, target.checked);
      return;
    }
    const field = target.getAttribute('data-phys-corr-field');
    if (field === 'alignment-method' && isAlignment(target.value)) {
      apply({ alignment: { ...state.alignment, method: target.value } });
    } else if (field === 'trigger-source') {
      apply({ alignment: { ...state.alignment, triggerSource: target.value } });
    } else if (field === 'threshold') {
      apply({ alignment: { ...state.alignment, threshold: Number(target.value) } });
    } else if (field === 'offset') {
      apply({ alignment: { ...state.alignment, method: 'manual', offsetSamples: Number(target.value) } });
    } else if (field === 'response-channel') {
      apply({ responseChannelId: target.value });
      callbacks.onSettingsChange?.(state.settings);
    } else if (field === 'weighting' && isWeighting(target.value)) {
      const settings = { ...state.settings, weighting: target.value };
      apply({ settings });
      callbacks.onSettingsChange?.(settings);
    } else if (field === 'smoothing') {
      const settings = { ...state.settings, smoothingWindow: Number(target.value) };
      apply({ settings });
      callbacks.onSettingsChange?.(settings);
    }
  }, eventOptions);

  root.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target instanceof Element ? event.target.closest<HTMLTableRowElement>('[data-phys-corr-case]') : null;
    if (!row) return;
    event.preventDefault();
    row.click();
  }, eventOptions);

  frameSlider.addEventListener('input', () => seekFrame(Number(frameSlider.value)), eventOptions);

  const onPlotPointer = (chart: PhysicsCorrelationChartId, event: PointerEvent): void => {
    if (chart === 'energy') return;
    const x = eventToDomainX(canvases[chart], state.plots[chart], event);
    if (x === null) return;
    const plots: Partial<Record<PhysicsCorrelationChartId, PhysicsCorrelationPlot>> = { ...state.plots };
    if (state.plots.response) plots.response = { ...state.plots.response, cursorX: x };
    if (state.plots.residual) plots.residual = { ...state.plots.residual, cursorX: x };
    apply({ plots, cursorTime: x });
    callbacks.onCursorSeek?.(x);
    const times = state.plots.response?.x;
    if (times && times.length > 1) {
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      times.forEach((time, index) => {
        const delta = Math.abs(time - x);
        if (delta < best) {
          best = delta;
          nearest = index;
        }
      });
      const frame = Math.round(nearest / Math.max(1, times.length - 1) * state.frameMax);
      callbacks.onFrameSeek?.(frame);
    }
  };
  canvases.response.addEventListener('pointerdown', (event) => onPlotPointer('response', event), eventOptions);
  canvases.residual.addEventListener('pointerdown', (event) => onPlotPointer('residual', event), eventOptions);

  splitHandle.addEventListener('keydown', (event) => {
    const increment = event.shiftKey ? 5 : 1;
    const next = event.key === 'Home'
      ? 30
      : event.key === 'End'
        ? 70
        : event.key === 'ArrowLeft'
          ? split - increment
          : event.key === 'ArrowRight'
            ? split + increment
            : null;
    if (next === null) return;
    event.preventDefault();
    setSplit(next);
    callbacks.onSplitChange?.(split);
  }, eventOptions);
  const updateSplitFromPointer = (event: PointerEvent): void => {
    const bounds = compare.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setSplit((event.clientX - bounds.left) / bounds.width * 100);
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
  const endSplit = (event: PointerEvent): void => {
    if (!splitDragging) return;
    splitDragging = false;
    if (splitHandle.hasPointerCapture(event.pointerId)) splitHandle.releasePointerCapture(event.pointerId);
    callbacks.onSplitChange?.(split);
  };
  splitHandle.addEventListener('pointerup', endSplit, eventOptions);
  splitHandle.addEventListener('pointercancel', endSplit, eventOptions);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawAll());
  resizeObserver?.observe(canvases.response);
  resizeObserver?.observe(canvases.energy);
  resizeObserver?.observe(canvases.residual);
  resizeObserver?.observe(timeline);

  const setMedia = (hostEl: HTMLElement, media: PhysicsCorrelationMedia | null, empty: { icon: string; title: string; copy: string; action?: string }): void => {
    hostEl.replaceChildren();
    if (!media) {
      const placeholder = document.createElement('div');
      placeholder.className = 'phys-corr-placeholder';
      placeholder.innerHTML = `<i class="ph ${empty.icon}" aria-hidden="true"></i><strong></strong><span></span>`;
      placeholder.querySelector('strong')!.textContent = empty.title;
      placeholder.querySelector('span')!.textContent = empty.copy;
      if (empty.action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.physCorrAction = empty.action;
        button.textContent = 'IMPORT REFERENCE';
        placeholder.append(button);
      }
      hostEl.append(placeholder);
      return;
    }
    const node = media.kind === 'video' ? document.createElement('video') : document.createElement('img');
    node.src = media.src;
    if (node instanceof HTMLVideoElement) {
      node.controls = true;
      node.muted = true;
      node.playsInline = true;
      node.setAttribute('aria-label', media.label);
    } else {
      node.alt = media.label;
    }
    hostEl.append(node);
  };

  const view: PhysicsCorrelationView = {
    root,
    elements: { viewportSlot, referencePane, canvases },
    update(patch) {
      if (patch.referenceMedia !== undefined) {
        if (referenceObjectUrl && patch.referenceMedia?.src !== referenceObjectUrl) {
          URL.revokeObjectURL(referenceObjectUrl);
          referenceObjectUrl = null;
        }
        setMedia(referencePane, patch.referenceMedia, {
          icon: 'ph-file-video',
          title: 'Import reference media',
          copy: 'Image or video · provenance declared on import. TEST replaces REFERENCE only for imported-test records.',
          action: 'import-reference',
        });
      }
      if (patch.candidateSnapshot !== undefined) {
        snapshotHost.hidden = !patch.candidateSnapshot;
        if (patch.candidateSnapshot) setMedia(snapshotHost, patch.candidateSnapshot, { icon: 'ph-images', title: '', copy: '' });
        else snapshotHost.replaceChildren();
      }
      apply(patch.referenceRole === undefined && patch.provenance === 'imported'
        ? { ...patch, referenceRole: 'TEST' }
        : patch);
    },
    attachViewport,
    redraw: drawAll,
    getState: () => Object.freeze({
      frame: state.frame,
      frameMax: state.frameMax,
      score: state.score,
      synced: state.synced,
      playing: state.playing,
      activeCaseId: state.activeCaseId,
      settings: state.settings,
      result: state.result,
      referenceRole: state.referenceRole,
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      resizeObserver?.disconnect();
      if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
      if (viewport && viewportMarker?.parentNode) viewportMarker.parentNode.insertBefore(viewport, viewportMarker.nextSibling);
      viewport?.classList.remove('phys-corr-attached');
      viewportMarker?.remove();
      root.remove();
    },
  };

  setSplit(split);
  setMedia(referencePane, null, {
    icon: 'ph-file-video',
    title: 'Import reference media',
    copy: 'Image or video · provenance declared on import. TEST replaces REFERENCE only for imported-test records.',
    action: 'import-reference',
  });
  if (options.viewport) attachViewport(options.viewport);
  apply(options.initial ?? {});
  return view;
}

export function updatePhysicsCorrelation(
  view: PhysicsCorrelationView,
  patch: PhysicsCorrelationUpdate,
): void {
  view.update(patch);
}
