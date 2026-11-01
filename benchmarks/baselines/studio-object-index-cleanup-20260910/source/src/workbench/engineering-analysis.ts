import {
  engineeringProvenanceForSolver,
  type EngineeringRunEvent,
  type EngineeringRunEventKind,
  type EngineeringSample,
  type EvidenceProvenance,
} from './engineering-session';

export type CorrelationSettings = {
  readonly maximumShiftSamples: number;
  readonly smoothingWindow: number;
  readonly weighting: 'uniform' | 'peak-weighted' | 'energy-weighted';
};

export type CorrelationResult = {
  readonly shiftSamples: number;
  readonly correlationCoefficient: number;
  readonly normalizedRmse: number;
  readonly score: number;
  readonly reference: readonly number[];
  readonly candidate: readonly number[];
  readonly residual: readonly number[];
};

export type ModalSpectrumBin = {
  readonly frequency: number;
  readonly amplitudeDb: number;
  /** Relative response-spectrum magnitude. This is not multi-capture coherence. */
  readonly relativePower: number;
};

export type ModalEstimate = {
  readonly dominantFrequency: number;
  readonly dampingRatio: number;
  readonly spectralConfidence: number;
  readonly bins: readonly ModalSpectrumBin[];
  readonly provenance: EvidenceProvenance;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function smooth(values: readonly number[], window: number): number[] {
  const width = clamp(Math.round(window), 1, 31);
  if (width <= 1) return values.slice();
  const half = Math.floor(width / 2);
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -half; offset <= half; offset++) {
      const candidate = index + offset;
      if (candidate < 0 || candidate >= values.length) continue;
      sum += values[candidate];
      count++;
    }
    return count > 0 ? sum / count : 0;
  });
}

function pairedValues(
  reference: readonly number[],
  candidate: readonly number[],
  shift: number,
): { reference: number[]; candidate: number[] } {
  const outputReference: number[] = [];
  const outputCandidate: number[] = [];
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex++) {
    const candidateIndex = referenceIndex + shift;
    if (candidateIndex < 0 || candidateIndex >= candidate.length) continue;
    const a = reference[referenceIndex];
    const b = candidate[candidateIndex];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    outputReference.push(a);
    outputCandidate.push(b);
  }
  return { reference: outputReference, candidate: outputCandidate };
}

function weightsFor(
  reference: readonly number[],
  candidate: readonly number[],
  weighting: CorrelationSettings['weighting'],
): number[] {
  if (weighting === 'uniform') return reference.map(() => 1);
  if (weighting === 'peak-weighted') {
    const peak = Math.max(1e-9, ...reference.map((value) => Math.abs(value)));
    return reference.map((value) => 0.35 + 0.65 * Math.abs(value) / peak);
  }
  const increments = reference.map((value, index) => {
    if (index === 0) return Math.abs(value);
    const referenceWork = Math.abs(value * (value - reference[index - 1]));
    const candidateWork = Math.abs(candidate[index] * (candidate[index] - candidate[index - 1]));
    return 0.25 + referenceWork + candidateWork;
  });
  const peak = Math.max(1e-9, ...increments);
  return increments.map((value) => value / peak);
}

function metrics(
  reference: readonly number[],
  candidate: readonly number[],
  weighting: CorrelationSettings['weighting'],
): { coefficient: number; normalizedRmse: number } {
  if (reference.length < 3 || reference.length !== candidate.length) {
    return { coefficient: 0, normalizedRmse: 1 };
  }
  const weights = weightsFor(reference, candidate, weighting);
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
  const referenceMean = reference.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum;
  const candidateMean = candidate.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum;
  let covariance = 0;
  let referenceVariance = 0;
  let candidateVariance = 0;
  let squaredError = 0;
  let referenceMin = Number.POSITIVE_INFINITY;
  let referenceMax = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < reference.length; index++) {
    const weight = weights[index];
    const referenceDelta = reference[index] - referenceMean;
    const candidateDelta = candidate[index] - candidateMean;
    covariance += weight * referenceDelta * candidateDelta;
    referenceVariance += weight * referenceDelta * referenceDelta;
    candidateVariance += weight * candidateDelta * candidateDelta;
    const error = reference[index] - candidate[index];
    squaredError += weight * error * error;
    referenceMin = Math.min(referenceMin, reference[index]);
    referenceMax = Math.max(referenceMax, reference[index]);
  }
  const denominator = Math.sqrt(referenceVariance * candidateVariance);
  const coefficient = denominator > 1e-12 ? clamp(covariance / denominator, -1, 1) : 0;
  const scale = Math.max(1e-9, referenceMax - referenceMin, Math.abs(referenceMean));
  const normalizedRmse = clamp(Math.sqrt(squaredError / weightSum) / scale, 0, 4);
  return { coefficient, normalizedRmse };
}

export function correlateEngineeringSeries(
  referenceValues: readonly number[],
  candidateValues: readonly number[],
  settings: CorrelationSettings = { maximumShiftSamples: 24, smoothingWindow: 5, weighting: 'uniform' },
): CorrelationResult {
  const reference = smooth(referenceValues, settings.smoothingWindow);
  const candidate = smooth(candidateValues, settings.smoothingWindow);
  const maximumShift = clamp(Math.round(settings.maximumShiftSamples), 0, 240);
  let bestShift = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestPair = pairedValues(reference, candidate, 0);
  let bestMetrics = metrics(bestPair.reference, bestPair.candidate, settings.weighting);
  for (let shift = -maximumShift; shift <= maximumShift; shift++) {
    const pair = pairedValues(reference, candidate, shift);
    if (pair.reference.length < 3) continue;
    const candidateMetrics = metrics(pair.reference, pair.candidate, settings.weighting);
    const cost = candidateMetrics.normalizedRmse + (1 - candidateMetrics.coefficient) * 0.35;
    if (cost >= bestCost) continue;
    bestCost = cost;
    bestShift = shift;
    bestPair = pair;
    bestMetrics = candidateMetrics;
  }
  const residual = bestPair.reference.map((value, index) => bestPair.candidate[index] - value);
  const agreement = clamp(1 - bestMetrics.normalizedRmse, 0, 1);
  const shape = clamp((bestMetrics.coefficient + 1) * 0.5, 0, 1);
  return Object.freeze({
    shiftSamples: bestShift,
    correlationCoefficient: bestMetrics.coefficient,
    normalizedRmse: bestMetrics.normalizedRmse,
    score: 100 * (agreement * 0.65 + shape * 0.35),
    reference: Object.freeze(bestPair.reference),
    candidate: Object.freeze(bestPair.candidate),
    residual: Object.freeze(residual),
  });
}

function medianStep(samples: readonly EngineeringSample[]): number {
  const deltas: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    const delta = samples[index].time - samples[index - 1].time;
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return 1 / 60;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

type ComplexSpectrum = { real: number[]; imaginary: number[]; power: number[] };

function spectrum(values: readonly number[]): ComplexSpectrum {
  const count = values.length;
  const binCount = Math.floor(count / 2);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, count);
  const real = new Array<number>(binCount).fill(0);
  const imaginary = new Array<number>(binCount).fill(0);
  const power = new Array<number>(binCount).fill(0);
  for (let bin = 0; bin < binCount; bin++) {
    let re = 0;
    let im = 0;
    for (let index = 0; index < count; index++) {
      const window = count > 1 ? 0.5 * (1 - Math.cos(2 * Math.PI * index / (count - 1))) : 1;
      const value = (values[index] - mean) * window;
      const angle = -2 * Math.PI * bin * index / count;
      re += value * Math.cos(angle);
      im += value * Math.sin(angle);
    }
    real[bin] = re;
    imaginary[bin] = im;
    power[bin] = re * re + im * im;
  }
  return { real, imaginary, power };
}

export function estimateReducedModalResponse(
  samples: readonly EngineeringSample[],
  provenance: EvidenceProvenance,
): ModalEstimate | null {
  if (samples.length < 32) return null;
  const selected = samples.slice(-Math.min(512, samples.length));
  const response = selected.map((sample) => sample.response);
  const responseSpectrum = spectrum(response);
  const dt = medianStep(selected);
  const binCount = responseSpectrum.power.length;
  if (binCount < 4) return null;
  const peakPower = Math.max(1e-18, ...responseSpectrum.power.slice(1));
  const totalPower = responseSpectrum.power.slice(1).reduce((sum, value) => sum + value, 0) || 1;
  const bins: ModalSpectrumBin[] = [];
  let peakIndex = 1;
  for (let bin = 1; bin < binCount; bin++) {
    if (responseSpectrum.power[bin] > responseSpectrum.power[peakIndex]) peakIndex = bin;
    bins.push(Object.freeze({
      frequency: bin / (selected.length * dt),
      amplitudeDb: 10 * Math.log10(Math.max(1e-18, responseSpectrum.power[bin] / peakPower)),
      relativePower: Math.sqrt(clamp(responseSpectrum.power[bin] / peakPower, 0, 1)),
    }));
  }
  const halfPower = responseSpectrum.power[peakIndex] * 0.5;
  let lower = peakIndex;
  let upper = peakIndex;
  while (lower > 1 && responseSpectrum.power[lower] > halfPower) lower--;
  while (upper < binCount - 1 && responseSpectrum.power[upper] > halfPower) upper++;
  const dominantFrequency = peakIndex / (selected.length * dt);
  const bandwidth = (upper - lower) / (selected.length * dt);
  const dampingRatio = dominantFrequency > 1e-9 ? clamp(bandwidth / (2 * dominantFrequency), 0, 1) : 0;
  return Object.freeze({
    dominantFrequency,
    dampingRatio,
    spectralConfidence: clamp(responseSpectrum.power[peakIndex] / totalPower, 0, 1),
    bins: Object.freeze(bins),
    provenance,
  });
}

export function buildSyntheticComparisonSeries(length = 180): readonly number[] {
  const count = clamp(Math.round(length), 32, 2400);
  const values = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    const t = index / Math.max(1, count - 1);
    const rise = 1 - Math.exp(-8 * t);
    const fold = t < 0.62 ? 1 : Math.exp(-(t - 0.62) * 2.8);
    const ripple = Math.sin(index * 0.43) * 0.012 + Math.sin(index * 0.11) * 0.018;
    values[index] = rise * fold * (0.92 + ripple);
  }
  return Object.freeze(values);
}

/** Mockup panel titles the UI binds to. Values behind them stay reduced-order. */
export const STRUCTURAL_UI_REGIONS = Object.freeze({
  sensorChannels: 'SENSOR CHANNELS',
  forceVsDisplacement: 'FORCE vs DISPLACEMENT',
  strainEnergy: 'STRAIN ENERGY',
  analysisOutput: 'WITHIN LIMITS',
  timeline: 'TIMELINE',
  forceTarget: 'FORCE TARGET',
} as const);

export const CORRELATION_UI_REGIONS = Object.freeze({
  channels: 'CHANNELS',
  forceHistory: 'FORCE HISTORY',
  energyBalance: 'ENERGY BALANCE',
  residual: 'RESIDUAL',
  correlationScore: 'CORRELATION SCORE',
  checklist: 'CHECKLIST',
  frameBookmarks: 'FRAME BOOKMARKS',
} as const);

export const LAB_UI_REGIONS = Object.freeze({
  metrics: 'LAB METRICS',
  force: 'Force',
  energy: 'Energy',
  maxStress: 'Max Stress',
} as const);

export const SENSOR_CHANNEL_SLOTS = [
  'Force (Load Cell)',
  'Displacement (LVDT-01)',
  'Strain XX (DIC-01)',
  'Strain YY (DIC-01)',
  'Strain XY (DIC-01)',
] as const;

export const CORRELATION_CHANNEL_SLOTS = [
  'Force - Load Cell',
  'Force - Sim (corr)',
  'Acceleration - Sled',
  'Displacement - Sled',
  'Energy Absorbed',
  'Contact Force - Total',
  'Time',
] as const;

export const ANALYSIS_UNITS = [
  'normalized',
  'simulation-unit',
  'simulation-unit/s',
  'strain',
  'normalized-energy',
  'count',
  's',
  'ratio',
  '%',
] as const;
export type AnalysisUnit = (typeof ANALYSIS_UNITS)[number];

export const ANALYSIS_CHECK_STATUSES = [
  'pass',
  'fail',
  'warning',
  'not-evaluated',
  'not-modeled',
] as const;
export type AnalysisCheckStatus = (typeof ANALYSIS_CHECK_STATUSES)[number];

export const STRUCTURAL_LIMIT_STATUSES = [
  'within-limits',
  'limit-warning',
  'limit-exceeded',
  'limits-not-set',
] as const;
export type StructuralLimitStatus = (typeof STRUCTURAL_LIMIT_STATUSES)[number];

export const STRUCTURAL_LIMIT_HEADLINES = [
  'WITHIN LIMITS',
  'LIMIT WARNING',
  'LIMIT EXCEEDED',
  'LIMITS NOT SET',
] as const;
export type StructuralLimitHeadline = (typeof STRUCTURAL_LIMIT_HEADLINES)[number];

export const CORRELATION_SCORE_VERDICTS = [
  'not-scored',
  'insufficient-samples',
  'model-agreement',
  'unreviewed',
] as const;
export type CorrelationScoreVerdict = (typeof CORRELATION_SCORE_VERDICTS)[number];

export const ANALYSIS_SERIES_ROLES = [
  'measured',
  'simulation',
  'baseline',
  'work',
  'residual',
  'proxy',
] as const;
export type AnalysisSeriesRole = (typeof ANALYSIS_SERIES_ROLES)[number];

export const REDUCED_ORDER_DISCLOSURE =
  'Deterministic reduced-order simulation for comparative testing and workflow prototyping. Values are not certified engineering predictions.';

export type EngineeringLiveFields = {
  readonly maxStrain?: number;
  readonly peakDamage?: number;
  readonly residualDent?: number;
  readonly yieldStrain?: number;
  readonly loadTarget?: number;
  readonly brokenCount?: number;
};

export type StructuralLimitEnvelope = {
  readonly maxLoad?: number;
  readonly maxResponse?: number;
  readonly maxStrain?: number;
  readonly maxBrokenCount?: number;
};

export type AnalysisMetric = {
  readonly id: string;
  readonly uiRegion: string;
  readonly uiSlot: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: AnalysisUnit;
  readonly available: boolean;
  readonly precision: number;
  readonly provenance: EvidenceProvenance;
  readonly disclosure: string;
};

export type MetricPanel = {
  readonly uiRegion: string;
  readonly metrics: readonly AnalysisMetric[];
};

export type AnalysisChartAnnotation = {
  readonly uiSlot: string;
  readonly label: string;
  readonly value: number;
  readonly index: number;
};

export type AnalysisChartSeries = {
  readonly id: string;
  readonly uiSlot: string;
  readonly label: string;
  readonly values: readonly number[];
  readonly role: AnalysisSeriesRole;
};

export type AnalysisChart = {
  readonly uiRegion: string;
  readonly title: string;
  readonly x: readonly number[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly series: readonly AnalysisChartSeries[];
  readonly cursorIndex: number | null;
  readonly yDomain?: readonly [number, number];
  readonly annotations: readonly AnalysisChartAnnotation[];
  readonly available: boolean;
  readonly disclosure: string;
};

export type AnalysisCheck = {
  readonly id: string;
  readonly uiSlot: string;
  readonly label: string;
  readonly status: AnalysisCheckStatus;
  readonly badge: string;
  readonly detail: string;
};

export type TimelinePanel = {
  readonly uiRegion: typeof STRUCTURAL_UI_REGIONS.timeline;
  readonly time: AnalysisMetric;
  readonly step: AnalysisMetric;
};

export type StructuralLimitPanel = {
  readonly uiRegion: typeof STRUCTURAL_UI_REGIONS.analysisOutput;
  readonly headline: StructuralLimitHeadline;
  readonly status: StructuralLimitStatus;
  readonly predictedMaxForce: AnalysisMetric;
  readonly predictedMaxStrainXx: AnalysisMetric;
  readonly checks: readonly AnalysisCheck[];
  readonly disclosure: string;
};

export type EnergyBalanceComponent = {
  readonly uiSlot: string;
  readonly label: string;
  readonly fraction: number | null;
  readonly value: number | null;
  readonly available: boolean;
};

export type EnergyBalancePanel = {
  readonly uiRegion: typeof CORRELATION_UI_REGIONS.energyBalance;
  readonly absorbed: AnalysisMetric;
  readonly components: readonly EnergyBalanceComponent[];
  readonly error: AnalysisMetric;
  readonly proxiesAgree: boolean | null;
  readonly disclosure: string;
};

export type CorrelationScorePanel = {
  readonly uiRegion: typeof CORRELATION_UI_REGIONS.correlationScore;
  readonly score: number | null;
  readonly verdict: CorrelationScoreVerdict;
  readonly badge: string;
  readonly shiftSamples: number;
  readonly offsetSeconds: number | null;
  readonly correlationCoefficient: number | null;
  readonly normalizedRmse: number | null;
  readonly peakError: number | null;
  readonly areaError: number | null;
  readonly timeToPeakError: number | null;
  readonly primaryChannel: 'load' | 'response';
  readonly disclosure: string;
};

export type FrameBookmark = {
  readonly uiSlot: string;
  readonly label: string;
  readonly time: number;
  readonly step: number;
  readonly sampleIndex: number;
};

export type StructuralAnalysisOptions = {
  readonly live?: EngineeringLiveFields;
  readonly limits?: StructuralLimitEnvelope;
  readonly cursorIndex?: number;
};

export type StructuralPanelOutputs = {
  readonly sensorChannels: MetricPanel;
  readonly forceVsDisplacement: AnalysisChart;
  readonly strainEnergy: AnalysisChart;
  readonly analysisOutput: StructuralLimitPanel;
  readonly timeline: TimelinePanel;
  readonly forceTarget: AnalysisMetric;
  readonly labMetrics: MetricPanel;
  readonly labCharts: {
    readonly force: AnalysisChart;
    readonly energy: AnalysisChart;
    readonly maxStress: AnalysisChart;
  };
};

export type CorrelationAnalysisOptions = {
  readonly settings?: CorrelationSettings;
  readonly cursorIndex?: number;
  readonly events?: readonly EngineeringRunEvent[];
};

export type CorrelationPanelOutputs = {
  readonly channels: MetricPanel;
  readonly forceHistory: AnalysisChart;
  readonly energyBalance: EnergyBalancePanel;
  readonly residual: AnalysisChart;
  readonly correlationScore: CorrelationScorePanel;
  readonly checklist: readonly AnalysisCheck[];
  readonly frameBookmarks: readonly FrameBookmark[];
};

const LIMIT_WARNING_RATIO = 0.8;
const ENERGY_PROXY_AGREE = 0.05;

function solverProvenance(detail: string): EvidenceProvenance {
  return engineeringProvenanceForSolver(detail);
}

function derivedProvenance(detail: string): EvidenceProvenance {
  return Object.freeze({
    source: 'derived',
    label: 'Derived · reduced model',
    calibrated: false,
    detail,
  });
}

function finiteNumber(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function analysisMetric(input: {
  id: string;
  uiRegion: string;
  uiSlot: string;
  label: string;
  value: number | null;
  unit: AnalysisUnit;
  available: boolean;
  precision: number;
  provenance: EvidenceProvenance;
  disclosure: string;
}): AnalysisMetric {
  const value = finiteNumber(input.value ?? undefined);
  return Object.freeze({
    ...input,
    value,
    available: input.available && value !== null,
  });
}

function metricPanel(uiRegion: string, metrics: readonly AnalysisMetric[]): MetricPanel {
  return Object.freeze({ uiRegion, metrics: Object.freeze([...metrics]) });
}

function chartSeries(input: AnalysisChartSeries): AnalysisChartSeries {
  return Object.freeze({ ...input, values: Object.freeze([...input.values]) });
}

function analysisChart(input: AnalysisChart): AnalysisChart {
  return Object.freeze({
    ...input,
    x: Object.freeze([...input.x]),
    series: Object.freeze(input.series.map(chartSeries)),
    annotations: Object.freeze(input.annotations.map((entry) => Object.freeze({ ...entry }))),
    ...(input.yDomain ? { yDomain: Object.freeze([input.yDomain[0], input.yDomain[1]]) as readonly [number, number] } : {}),
  });
}

function emptyChart(uiRegion: string, title: string, xLabel: string, yLabel: string, disclosure: string): AnalysisChart {
  return analysisChart({
    uiRegion,
    title,
    x: [],
    xLabel,
    yLabel,
    series: [],
    cursorIndex: null,
    annotations: [],
    available: false,
    disclosure,
  });
}

export function analysisCheckBadge(status: AnalysisCheckStatus): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'fail': return 'FAIL';
    case 'warning': return 'PASS WITH NOTES';
    case 'not-evaluated': return 'NOT EVALUATED';
    case 'not-modeled': return 'NOT MODELED';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function structuralHeadline(status: StructuralLimitStatus): StructuralLimitHeadline {
  switch (status) {
    case 'within-limits': return 'WITHIN LIMITS';
    case 'limit-warning': return 'LIMIT WARNING';
    case 'limit-exceeded': return 'LIMIT EXCEEDED';
    case 'limits-not-set': return 'LIMITS NOT SET';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function correlationScoreBadge(verdict: CorrelationScoreVerdict): string {
  switch (verdict) {
    case 'not-scored': return 'NOT SCORED';
    case 'insufficient-samples': return 'INSUFFICIENT SAMPLES';
    case 'model-agreement': return 'MODEL-TO-MODEL';
    case 'unreviewed': return 'UNREVIEWED';
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}

function eventBookmarkSlot(kind: EngineeringRunEventKind): string {
  switch (kind) {
    case 'preflight': return 'Preflight';
    case 'armed': return 'Pre-Impact';
    case 'load-step': return 'Load Step';
    case 'hold': return 'Hold';
    case 'impact': return 'Initial Contact';
    case 'limit-warning': return 'Limit Warning';
    case 'bookmark': return 'Bookmark';
    case 'complete': return 'End of Event';
    case 'abort': return 'Abort';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function analysisCheck(
  id: string,
  uiSlot: string,
  label: string,
  status: AnalysisCheckStatus,
  detail: string,
): AnalysisCheck {
  return Object.freeze({ id, uiSlot, label, status, badge: analysisCheckBadge(status), detail });
}

function extrema(values: readonly number[]): { min: number; max: number; peakAbs: number; peakIndex: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let peakAbs = 0;
  let peakIndex = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    const magnitude = Math.abs(value);
    if (magnitude >= peakAbs) {
      peakAbs = magnitude;
      peakIndex = index;
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0, peakAbs: 0, peakIndex: 0 };
  return { min, max, peakAbs, peakIndex };
}

function spanOf(values: readonly number[]): number {
  const { min, max } = extrema(values);
  return max - min;
}

function trapezoidArea(values: readonly number[], dx: number): number {
  if (values.length < 2 || !(dx > 0)) return 0;
  let area = 0;
  for (let index = 1; index < values.length; index++) {
    area += 0.5 * (values[index] + values[index - 1]) * dx;
  }
  return area;
}

function cumulativePathWork(samples: readonly EngineeringSample[]): number[] {
  const work = new Array<number>(samples.length).fill(0);
  for (let index = 1; index < samples.length; index++) {
    const travel = samples[index].response - samples[index - 1].response;
    work[index] = work[index - 1] + 0.5 * (samples[index].load + samples[index - 1].load) * travel;
  }
  return work;
}

function backwardRate(samples: readonly EngineeringSample[], index: number): number | null {
  if (index < 1 || index >= samples.length) return null;
  const dt = samples[index].time - samples[index - 1].time;
  if (!(dt > 0)) return null;
  return (samples[index].response - samples[index - 1].response) / dt;
}

function cursorIndexFor(length: number, requested?: number): number {
  if (length <= 0) return 0;
  if (requested === undefined) return length - 1;
  return clamp(Math.round(requested), 0, length - 1);
}

function ratioAgainstLimit(observed: number, limit: number | undefined): number | null {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.abs(observed) / limit;
}

function worstLimitStatus(ratios: readonly (number | null)[]): StructuralLimitStatus {
  const defined = ratios.filter((value): value is number => value !== null);
  if (defined.length === 0) return 'limits-not-set';
  if (defined.some((value) => value >= 1)) return 'limit-exceeded';
  if (defined.some((value) => value >= LIMIT_WARNING_RATIO)) return 'limit-warning';
  return 'within-limits';
}

function limitCheck(
  id: string,
  uiSlot: string,
  label: string,
  observed: number,
  limit: number | undefined,
  unit: AnalysisUnit,
): AnalysisCheck {
  const ratio = ratioAgainstLimit(observed, limit);
  if (ratio === null) {
    return analysisCheck(id, uiSlot, label, 'not-evaluated', `${label} has no configured normalized envelope.`);
  }
  const status: AnalysisCheckStatus = ratio >= 1 ? 'fail' : ratio >= LIMIT_WARNING_RATIO ? 'warning' : 'pass';
  return analysisCheck(
    id,
    uiSlot,
    label,
    status,
    `Observed ${observed.toFixed(3)} ${unit} vs limit ${limit!.toFixed(3)} ${unit} (${(ratio * 100).toFixed(1)}%).`,
  );
}

function unavailableMetric(
  id: string,
  uiRegion: string,
  uiSlot: string,
  label: string,
  unit: AnalysisUnit,
  disclosure: string,
  precision = 3,
): AnalysisMetric {
  return analysisMetric({
    id,
    uiRegion,
    uiSlot,
    label,
    value: null,
    unit,
    available: false,
    precision,
    provenance: derivedProvenance(disclosure),
    disclosure,
  });
}

function sampleAt(samples: readonly EngineeringSample[], index: number): EngineeringSample | undefined {
  return samples.length > 0 ? samples[cursorIndexFor(samples.length, index)] : undefined;
}

function strainXxMetric(
  uiRegion: string,
  sample: EngineeringSample | undefined,
  live: EngineeringLiveFields | undefined,
): AnalysisMetric {
  const liveStrain = finiteNumber(live?.maxStrain);
  if (liveStrain !== null) {
    return analysisMetric({
      id: 'strain-xx-dic-01',
      uiRegion,
      uiSlot: 'Strain XX (DIC-01)',
      label: 'Peak lattice strain',
      value: liveStrain,
      unit: 'strain',
      available: true,
      precision: 4,
      provenance: solverProvenance('Live lattice maxStrain diagnostic. Not a DIC εxx tensor component.'),
      disclosure: 'Scalar peak strain from the reduced lattice, not calibrated microstrain or a DIC XX component.',
    });
  }
  const damage = finiteNumber(sample?.damage);
  if (damage === null) {
    return unavailableMetric(
      'strain-xx-dic-01',
      uiRegion,
      'Strain XX (DIC-01)',
      'Peak lattice strain',
      'strain',
      'No live maxStrain and no recorded damage diagnostic are available for this cursor.',
      4,
    );
  }
  return analysisMetric({
    id: 'strain-xx-dic-01',
    uiRegion,
    uiSlot: 'Strain XX (DIC-01)',
    label: 'Peak damage diagnostic',
    value: damage,
    unit: 'normalized',
    available: true,
    precision: 4,
    provenance: solverProvenance('Recorded peakDamage occupies the Strain XX slot when live maxStrain is absent.'),
    disclosure: 'Archived samples do not store a strain tensor. This readout is peak damage, not DIC εxx.',
  });
}

function strainYyMetric(
  uiRegion: string,
  sample: EngineeringSample | undefined,
  live: EngineeringLiveFields | undefined,
): AnalysisMetric {
  if (finiteNumber(live?.maxStrain) !== null) {
    const damage = finiteNumber(live?.peakDamage) ?? finiteNumber(sample?.damage);
    if (damage === null) {
      return unavailableMetric(
        'strain-yy-dic-01',
        uiRegion,
        'Strain YY (DIC-01)',
        'Peak damage diagnostic',
        'normalized',
        'No independent YY strain exists. Damage diagnostic is unavailable at this cursor.',
      );
    }
    return analysisMetric({
      id: 'strain-yy-dic-01',
      uiRegion,
      uiSlot: 'Strain YY (DIC-01)',
      label: 'Peak damage diagnostic',
      value: damage,
      unit: 'normalized',
      available: true,
      precision: 3,
      provenance: solverProvenance('Peak damage diagnostic mapped to the Strain YY slot. Not a DIC εyy component.'),
      disclosure: 'The lattice does not report a strain tensor. YY shows peak damage so XX can show live maxStrain.',
    });
  }
  return unavailableMetric(
    'strain-yy-dic-01',
    uiRegion,
    'Strain YY (DIC-01)',
    'Peak damage diagnostic',
    'normalized',
    'No independent YY strain channel. When live maxStrain is absent, damage is shown in Strain XX instead of duplicating it here.',
  );
}

function buildSensorChannelPanel(
  samples: readonly EngineeringSample[],
  live: EngineeringLiveFields | undefined,
  cursor: number,
): MetricPanel {
  const region = STRUCTURAL_UI_REGIONS.sensorChannels;
  const sample = sampleAt(samples, cursor);
  const broken = finiteNumber(live?.brokenCount) ?? finiteNumber(sample?.brokenCount);
  return metricPanel(region, [
    analysisMetric({
      id: 'force-load-cell',
      uiRegion: region,
      uiSlot: 'Force (Load Cell)',
      label: 'Normalized input load',
      value: finiteNumber(sample?.load),
      unit: 'normalized',
      available: sample !== undefined,
      precision: 3,
      provenance: solverProvenance('Recorded load / loadProgress channel. Not a physical load-cell force.'),
      disclosure: 'Normalized actuator or strike progress from the run record, not kilonewtons.',
    }),
    analysisMetric({
      id: 'displacement-lvdt-01',
      uiRegion: region,
      uiSlot: 'Displacement (LVDT-01)',
      label: 'P1 response',
      value: finiteNumber(sample?.response),
      unit: 'simulation-unit',
      available: sample !== undefined,
      precision: 3,
      provenance: solverProvenance('Recorded probe response or center deflection. Not an LVDT measurement.'),
      disclosure: 'Reduced-model displacement in simulation units, not millimetres.',
    }),
    strainXxMetric(region, sample, live),
    strainYyMetric(region, sample, live),
    analysisMetric({
      id: 'strain-xy-dic-01',
      uiRegion: region,
      uiSlot: 'Strain XY (DIC-01)',
      label: 'Broken constraints',
      value: broken,
      unit: 'count',
      available: broken !== null,
      precision: 0,
      provenance: solverProvenance('Broken constraint count mapped to the Strain XY slot. Not a DIC εxy component.'),
      disclosure: 'Integer break count from the solver, not a shear-strain tensor component.',
    }),
  ]);
}

function buildLabMetricPanel(
  samples: readonly EngineeringSample[],
  live: EngineeringLiveFields | undefined,
  cursor: number,
): MetricPanel {
  const region = LAB_UI_REGIONS.metrics;
  const sample = sampleAt(samples, cursor);
  const strain = finiteNumber(live?.maxStrain);
  return metricPanel(region, [
    analysisMetric({
      id: 'lab-force',
      uiRegion: region,
      uiSlot: 'Force',
      label: 'Normalized input load',
      value: finiteNumber(sample?.load),
      unit: 'normalized',
      available: sample !== undefined,
      precision: 3,
      provenance: solverProvenance('Recorded load channel for the material-lab Force graph.'),
      disclosure: 'Normalized load, not kilonewtons.',
    }),
    analysisMetric({
      id: 'lab-energy',
      uiRegion: region,
      uiSlot: 'Energy',
      label: 'Solver energy proxy',
      value: finiteNumber(sample?.energy),
      unit: 'normalized-energy',
      available: sample !== undefined,
      precision: 3,
      provenance: solverProvenance('Recorded solver energy proxy for the material-lab Energy graph.'),
      disclosure: 'Normalized energy proxy, not kilojoules.',
    }),
    strain !== null
      ? analysisMetric({
        id: 'lab-max-stress',
        uiRegion: region,
        uiSlot: 'Max Stress',
        label: 'Peak lattice strain',
        value: strain,
        unit: 'strain',
        available: true,
        precision: 4,
        provenance: solverProvenance('Live maxStrain occupies the Max Stress slot. The lattice does not report Cauchy stress.'),
        disclosure: 'Peak strain diagnostic, not megapascals.',
      })
      : analysisMetric({
        id: 'lab-max-stress',
        uiRegion: region,
        uiSlot: 'Max Stress',
        label: 'Peak damage diagnostic',
        value: finiteNumber(sample?.damage),
        unit: 'normalized',
        available: sample !== undefined,
        precision: 3,
        provenance: solverProvenance('Recorded peakDamage occupies the Max Stress slot. The lattice does not report Cauchy stress.'),
        disclosure: 'Peak damage diagnostic, not megapascals. Live maxStrain was not supplied.',
      }),
  ]);
}

function buildForceDisplacementChart(samples: readonly EngineeringSample[], cursor: number): AnalysisChart {
  const region = STRUCTURAL_UI_REGIONS.forceVsDisplacement;
  if (samples.length < 2) {
    return emptyChart(
      region,
      region,
      'response (simulation-unit)',
      'normalized load',
      'Force vs displacement needs at least two recorded samples. No measured load-cell overlay is synthesized.',
    );
  }
  const response = samples.map((sample) => sample.response);
  const load = samples.map((sample) => sample.load);
  return analysisChart({
    uiRegion: region,
    title: region,
    x: response,
    xLabel: 'response (simulation-unit)',
    yLabel: 'normalized load',
    series: [
      chartSeries({
        id: 'simulation',
        uiSlot: 'Simulation',
        label: 'Simulation',
        values: load,
        role: 'simulation',
      }),
    ],
    cursorIndex: cursorIndexFor(samples.length, cursor),
    annotations: [],
    available: true,
    disclosure: 'Path of recorded load versus response. A Measured series appears only when imported test channels exist; none are taken from EngineeringSample.',
  });
}

function buildStrainEnergyChart(samples: readonly EngineeringSample[], cursor: number): AnalysisChart {
  const region = STRUCTURAL_UI_REGIONS.strainEnergy;
  if (samples.length < 2) {
    return emptyChart(
      region,
      region,
      'response (simulation-unit)',
      'normalized-energy',
      'Strain-energy path work needs at least two recorded samples.',
    );
  }
  const response = samples.map((sample) => sample.response);
  const pathWork = cumulativePathWork(samples);
  const solverEnergy = samples.map((sample) => sample.energy);
  return analysisChart({
    uiRegion: region,
    title: region,
    x: response,
    xLabel: 'response (simulation-unit)',
    yLabel: 'normalized-energy',
    series: [
      chartSeries({
        id: 'path-work',
        uiSlot: 'Load-path work',
        label: 'Load-path work',
        values: pathWork,
        role: 'proxy',
      }),
      chartSeries({
        id: 'solver-energy',
        uiSlot: 'Simulation',
        label: 'Solver energy proxy',
        values: solverEnergy,
        role: 'simulation',
      }),
    ],
    cursorIndex: cursorIndexFor(samples.length, cursor),
    annotations: [],
    available: true,
    disclosure: 'Load-path work is trapezoidal ∫ F du from recorded load and response. Solver energy is the native proxy. Neither is strain energy in joules. The Measured slot is path work, not a physical test channel.',
  });
}

function buildLabCharts(
  samples: readonly EngineeringSample[],
  live: EngineeringLiveFields | undefined,
  cursor: number,
): StructuralPanelOutputs['labCharts'] {
  const times = samples.map((sample) => sample.time);
  const index = samples.length > 0 ? cursorIndexFor(samples.length, cursor) : null;
  const missing = 'Need recorded samples before the material-lab time histories can be drawn.';
  if (samples.length === 0) {
    return Object.freeze({
      force: emptyChart(LAB_UI_REGIONS.force, LAB_UI_REGIONS.force, 'model time (s)', 'normalized load', missing),
      energy: emptyChart(LAB_UI_REGIONS.energy, LAB_UI_REGIONS.energy, 'model time (s)', 'normalized-energy', missing),
      maxStress: emptyChart(LAB_UI_REGIONS.maxStress, LAB_UI_REGIONS.maxStress, 'model time (s)', 'normalized diagnostic', missing),
    });
  }
  const pathWork = cumulativePathWork(samples);
  const stressValues = samples.map((sample) => sample.damage);
  const stressLabel = finiteNumber(live?.maxStrain) !== null
    ? 'Peak damage diagnostic (live strain is cursor-only)'
    : 'Peak damage diagnostic';
  return Object.freeze({
    force: analysisChart({
      uiRegion: LAB_UI_REGIONS.force,
      title: LAB_UI_REGIONS.force,
      x: times,
      xLabel: 'model time (s)',
      yLabel: 'normalized load',
      series: [chartSeries({ id: 'force', uiSlot: 'Force', label: 'Normalized input load', values: samples.map((sample) => sample.load), role: 'simulation' })],
      cursorIndex: index,
      annotations: [],
      available: true,
      disclosure: 'Recorded load versus model time. Not a kilonewton force history.',
    }),
    energy: analysisChart({
      uiRegion: LAB_UI_REGIONS.energy,
      title: LAB_UI_REGIONS.energy,
      x: times,
      xLabel: 'model time (s)',
      yLabel: 'normalized-energy',
      series: [
        chartSeries({ id: 'energy', uiSlot: 'Energy', label: 'Solver energy proxy', values: samples.map((sample) => sample.energy), role: 'simulation' }),
        chartSeries({ id: 'path-work', uiSlot: 'STRAIN ENERGY', label: 'Load-path work', values: pathWork, role: 'proxy' }),
      ],
      cursorIndex: index,
      annotations: [],
      available: true,
      disclosure: 'Solver energy proxy and trapezoidal load-path work versus model time. Not kilojoules.',
    }),
    maxStress: analysisChart({
      uiRegion: LAB_UI_REGIONS.maxStress,
      title: LAB_UI_REGIONS.maxStress,
      x: times,
      xLabel: 'model time (s)',
      yLabel: 'normalized diagnostic',
      series: [chartSeries({ id: 'damage', uiSlot: 'Max Stress', label: stressLabel, values: stressValues, role: 'simulation' })],
      cursorIndex: index,
      annotations: [],
      available: true,
      disclosure: 'Recorded peakDamage versus model time. The lattice does not emit Cauchy stress or megapascals.',
    }),
  });
}

function buildTimelinePanel(samples: readonly EngineeringSample[], cursor: number): TimelinePanel {
  const region = STRUCTURAL_UI_REGIONS.timeline;
  const sample = sampleAt(samples, cursor);
  return Object.freeze({
    uiRegion: region,
    time: analysisMetric({
      id: 'timeline-time',
      uiRegion: region,
      uiSlot: 'Time',
      label: 'Model time',
      value: finiteNumber(sample?.time),
      unit: 's',
      available: sample !== undefined,
      precision: 3,
      provenance: solverProvenance('Fixed-step sample time from the run record.'),
      disclosure: 'Simulation seconds at the selected sample, not a physical DAQ timestamp.',
    }),
    step: analysisMetric({
      id: 'timeline-step',
      uiRegion: region,
      uiSlot: 'Step',
      label: 'Fixed step',
      value: finiteNumber(sample?.step),
      unit: 'count',
      available: sample !== undefined,
      precision: 0,
      provenance: solverProvenance('Monotonic fixed-step index from the run record.'),
      disclosure: 'Integer solver step, not an implicit-nonlinear iteration count.',
    }),
  });
}

function buildStructuralLimitPanel(
  samples: readonly EngineeringSample[],
  live: EngineeringLiveFields | undefined,
  limits: StructuralLimitEnvelope | undefined,
): StructuralLimitPanel {
  const region = STRUCTURAL_UI_REGIONS.analysisOutput;
  const loads = samples.map((sample) => sample.load);
  const responses = samples.map((sample) => sample.response);
  const damages = samples.map((sample) => sample.damage);
  const breaks = samples.map((sample) => sample.brokenCount);
  const peakLoad = extrema(loads).peakAbs;
  const peakResponse = extrema(responses).peakAbs;
  const peakStrain = Math.max(extrema(damages).peakAbs, finiteNumber(live?.maxStrain) ?? 0);
  const peakBreaks = Math.max(extrema(breaks).peakAbs, finiteNumber(live?.brokenCount) ?? 0);
  const hasRun = samples.length > 0;
  const loadRatio = hasRun ? ratioAgainstLimit(peakLoad, limits?.maxLoad) : null;
  const responseRatio = hasRun ? ratioAgainstLimit(peakResponse, limits?.maxResponse) : null;
  const strainRatio = hasRun || finiteNumber(live?.maxStrain) !== null
    ? ratioAgainstLimit(peakStrain, limits?.maxStrain)
    : null;
  const breakRatio = hasRun ? ratioAgainstLimit(peakBreaks, limits?.maxBrokenCount) : null;
  const status = worstLimitStatus([loadRatio, responseRatio, strainRatio, breakRatio]);
  const checks = Object.freeze([
    limitCheck('max-load', 'Max Force', 'Peak load', peakLoad, hasRun ? limits?.maxLoad : undefined, 'normalized'),
    limitCheck('max-displacement', 'Max Displacement', 'Peak response', peakResponse, hasRun ? limits?.maxResponse : undefined, 'simulation-unit'),
    limitCheck('max-strain-xx', 'Max Strain |XX|', 'Peak strain diagnostic', peakStrain, hasRun || finiteNumber(live?.maxStrain) !== null ? limits?.maxStrain : undefined, finiteNumber(live?.maxStrain) !== null ? 'strain' : 'normalized'),
    limitCheck('max-breaks', 'Broken constraints', 'Peak break count', peakBreaks, hasRun ? limits?.maxBrokenCount : undefined, 'count'),
  ]);
  return Object.freeze({
    uiRegion: region,
    headline: structuralHeadline(status),
    status,
    predictedMaxForce: analysisMetric({
      id: 'predicted-max-force',
      uiRegion: region,
      uiSlot: 'Predicted Max Force',
      label: 'Observed peak load',
      value: samples.length > 0 ? peakLoad : null,
      unit: 'normalized',
      available: samples.length > 0,
      precision: 3,
      provenance: derivedProvenance('Running peak of the recorded load channel, not an FEA capacity prediction.'),
      disclosure: 'Observed peak normalized load on this run. Not a predicted kilonewton failure load.',
    }),
    predictedMaxStrainXx: analysisMetric({
      id: 'predicted-max-strain-xx',
      uiRegion: region,
      uiSlot: 'Predicted Max Strain |XX|',
      label: 'Observed peak strain diagnostic',
      value: samples.length > 0 || finiteNumber(live?.maxStrain) !== null ? peakStrain : null,
      unit: finiteNumber(live?.maxStrain) !== null ? 'strain' : 'normalized',
      available: samples.length > 0 || finiteNumber(live?.maxStrain) !== null,
      precision: 4,
      provenance: derivedProvenance('Peak of recorded damage and live maxStrain when supplied. Not |εxx| in microstrain.'),
      disclosure: 'Observed peak of the strain/damage diagnostics. Not a predicted DIC |XX| in microstrain.',
    }),
    checks,
    disclosure: `${REDUCED_ORDER_DISCLOSURE} Limit comparison uses caller-supplied normalized envelopes only.`,
  });
}

/** Sensor, F–d, strain-energy, limit, timeline, and material-lab metric panels. */
export function buildStructuralPanelOutputs(
  samples: readonly EngineeringSample[],
  options: StructuralAnalysisOptions = {},
): StructuralPanelOutputs {
  const cursor = cursorIndexFor(samples.length, options.cursorIndex);
  const live = options.live;
  return Object.freeze({
    sensorChannels: buildSensorChannelPanel(samples, live, cursor),
    forceVsDisplacement: buildForceDisplacementChart(samples, cursor),
    strainEnergy: buildStrainEnergyChart(samples, cursor),
    analysisOutput: buildStructuralLimitPanel(samples, live, options.limits),
    timeline: buildTimelinePanel(samples, cursor),
    forceTarget: analysisMetric({
      id: 'force-target',
      uiRegion: STRUCTURAL_UI_REGIONS.forceTarget,
      uiSlot: 'FORCE TARGET',
      label: 'Commanded load target',
      value: finiteNumber(live?.loadTarget),
      unit: 'normalized',
      available: finiteNumber(live?.loadTarget) !== null,
      precision: 3,
      provenance: derivedProvenance('Authored load-case target, not a predicted reaction force.'),
      disclosure: 'Normalized command from the load case. Not a 20 kN physical target.',
    }),
    labMetrics: buildLabMetricPanel(samples, live, cursor),
    labCharts: buildLabCharts(samples, live, cursor),
  });
}

function pickPrimaryChannel(reference: readonly EngineeringSample[], candidate: readonly EngineeringSample[]): 'load' | 'response' {
  const loadSpan = Math.max(spanOf(reference.map((sample) => sample.load)), spanOf(candidate.map((sample) => sample.load)));
  const responseSpan = Math.max(spanOf(reference.map((sample) => sample.response)), spanOf(candidate.map((sample) => sample.response)));
  return loadSpan > 1e-6 && loadSpan >= responseSpan * 0.05 ? 'load' : 'response';
}

function alignedCursor(shift: number, referenceLength: number, candidateLength: number, requested?: number): {
  pairedIndex: number;
  referenceIndex: number;
  candidateIndex: number;
  length: number;
} {
  const referenceStart = Math.max(0, -shift);
  const candidateStart = Math.max(0, shift);
  const length = Math.max(0, Math.min(referenceLength - referenceStart, candidateLength - candidateStart));
  const pairedIndex = cursorIndexFor(length, requested);
  return {
    pairedIndex,
    referenceIndex: referenceStart + pairedIndex,
    candidateIndex: candidateStart + pairedIndex,
    length,
  };
}

function peakAnnotation(uiSlot: string, label: string, values: readonly number[]): AnalysisChartAnnotation | null {
  if (values.length === 0) return null;
  const { peakAbs, peakIndex, max, min } = extrema(values);
  const value = Math.abs(max) >= Math.abs(min) ? max : min;
  if (!(peakAbs > 0) && value === 0) return Object.freeze({ uiSlot, label, value, index: peakIndex });
  return Object.freeze({ uiSlot, label, value, index: peakIndex });
}

function buildEnergyBalancePanel(candidate: readonly EngineeringSample[]): EnergyBalancePanel {
  const region = CORRELATION_UI_REGIONS.energyBalance;
  const last = candidate.at(-1);
  const pathWork = candidate.length > 1 ? cumulativePathWork(candidate).at(-1) ?? 0 : 0;
  const energy = finiteNumber(last?.energy);
  const work = candidate.length > 1 ? pathWork : null;
  const error = energy !== null && work !== null ? energy - work : null;
  const scale = Math.max(Math.abs(energy ?? 0), Math.abs(work ?? 0), 1e-9);
  const relative = error !== null ? error / scale : null;
  const proxiesAgree = relative === null ? null : Math.abs(relative) <= ENERGY_PROXY_AGREE;
  const components: EnergyBalanceComponent[] = [
    Object.freeze({
      uiSlot: 'Internal Energy/Plastic',
      label: 'Solver energy proxy',
      fraction: energy !== null ? 1 : null,
      value: energy,
      available: energy !== null,
    }),
    Object.freeze({ uiSlot: 'Kinetic Energy In', label: 'Kinetic energy in', fraction: null, value: null, available: false }),
    Object.freeze({ uiSlot: 'Contact Work', label: 'Contact work', fraction: null, value: null, available: false }),
    Object.freeze({ uiSlot: 'Other', label: 'Unclassified remainder', fraction: null, value: null, available: false }),
    Object.freeze({ uiSlot: 'Kinetic Energy Out', label: 'Kinetic energy out', fraction: null, value: null, available: false }),
  ];
  return Object.freeze({
    uiRegion: region,
    absorbed: analysisMetric({
      id: 'energy-absorbed',
      uiRegion: region,
      uiSlot: 'Energy Absorbed',
      label: 'Solver energy proxy',
      value: energy,
      unit: 'normalized-energy',
      available: energy !== null,
      precision: 3,
      provenance: solverProvenance('Final recorded solver energy proxy. Not absorbed kilojoules.'),
      disclosure: 'Single recorded energy channel. Lattice telemetry also has normalized elastic / plastic / damping / contact proxies; none are joules.',
    }),
    components: Object.freeze(components),
    error: analysisMetric({
      id: 'energy-balance-error',
      uiRegion: region,
      uiSlot: 'Energy Balance Error',
      label: 'Solver energy minus load-path work',
      value: error,
      unit: 'normalized-energy',
      available: error !== null,
      precision: 3,
      provenance: derivedProvenance('Difference between solver energy proxy and trapezoidal ∫ F du. Mixed normalized units.'),
      disclosure: relative === null
        ? 'Energy-balance error needs both solver energy and at least two samples of load-path work.'
        : `Relative proxy gap ${(relative * 100).toFixed(1)}%. This is not a physical conservation residual.`,
    }),
    proxiesAgree,
    disclosure: 'The recorded sample energy is a single normalized solver proxy. Elastic / plastic / damping / contact splits exist on live material telemetry but are not converted into mockup kilojoule percentages.',
  });
}

function buildFrameBookmarks(
  samples: readonly EngineeringSample[],
  events: readonly EngineeringRunEvent[] | undefined,
): readonly FrameBookmark[] {
  const bookmarks: FrameBookmark[] = [];
  if (samples.length > 0) {
    bookmarks.push(Object.freeze({
      uiSlot: 'Pre-Impact',
      label: 'Initial state',
      time: samples[0].time,
      step: samples[0].step,
      sampleIndex: 0,
    }));
    const peak = extrema(samples.map((sample) => sample.load));
    bookmarks.push(Object.freeze({
      uiSlot: 'Peak Load',
      label: 'Peak load',
      time: samples[peak.peakIndex].time,
      step: samples[peak.peakIndex].step,
      sampleIndex: peak.peakIndex,
    }));
    const last = samples.length - 1;
    bookmarks.push(Object.freeze({
      uiSlot: 'End of Event',
      label: 'End of record',
      time: samples[last].time,
      step: samples[last].step,
      sampleIndex: last,
    }));
  }
  for (const event of events ?? []) {
    let sampleIndex = 0;
    for (let index = 0; index < samples.length; index++) {
      if (samples[index].step <= event.step) sampleIndex = index;
    }
    bookmarks.push(Object.freeze({
      uiSlot: eventBookmarkSlot(event.kind),
      label: event.label,
      time: event.time,
      step: event.step,
      sampleIndex,
    }));
  }
  bookmarks.sort((left, right) => left.time - right.time || left.step - right.step);
  return Object.freeze(bookmarks);
}

function buildCorrelationChecklist(
  pairedLength: number,
  score: CorrelationScorePanel,
  energy: EnergyBalancePanel,
  events: readonly EngineeringRunEvent[] | undefined,
): readonly AnalysisCheck[] {
  const integrity: AnalysisCheckStatus = pairedLength >= 3 ? 'pass' : 'fail';
  const alignment: AnalysisCheckStatus = pairedLength >= 3 ? 'pass' : 'fail';
  const hasImpact = (events ?? []).some((event) => event.kind === 'impact' || event.kind === 'load-step');
  const trigger: AnalysisCheckStatus = hasImpact ? 'warning' : 'not-evaluated';
  const energyStatus: AnalysisCheckStatus = energy.proxiesAgree === null
    ? 'not-evaluated'
    : energy.proxiesAgree
      ? 'pass'
      : 'warning';
  const quality: AnalysisCheckStatus = score.verdict === 'insufficient-samples' || score.score === null
    ? 'fail'
    : score.score >= 90
      ? 'pass'
      : score.score >= 50
        ? 'warning'
        : 'fail';
  return Object.freeze([
    analysisCheck('time-zero', 'Time Zero Alignment', 'Time zero alignment', alignment, pairedLength >= 3
      ? `Bounded cross-correlation used ${pairedLength} paired samples (shift ${score.shiftSamples}).`
      : 'Fewer than three paired samples; alignment was not accepted.'),
    analysisCheck('trigger', 'Trigger Alignment', 'Trigger alignment', trigger, hasImpact
      ? 'Load/impact events exist, but threshold trigger alignment is not applied to these model channels.'
      : 'No trigger channel or threshold search is available on EngineeringSample.'),
    analysisCheck('channel-integrity', 'Channel Integrity', 'Channel integrity', integrity, pairedLength >= 3
      ? 'Paired baseline and work samples are finite and equal length after the shift window.'
      : 'Paired series are too short for a correlation score.'),
    analysisCheck('saturation', 'Sensor Saturation', 'Sensor saturation', 'not-evaluated', 'Saturation metadata is not part of the recorded sample contract.'),
    analysisCheck('energy-balance', 'Energy Balance', 'Energy balance', energyStatus, energy.error.disclosure),
    analysisCheck('mass-scaling', 'Mass Scaling', 'Mass scaling', 'not-modeled', 'Mass scaling is not a reported solver channel in this build.'),
    analysisCheck('contact-stability', 'Contact Stability', 'Contact stability', 'not-modeled', 'Contact-force and hourglass channels are not exposed by the run record.'),
    analysisCheck('boundary-conditions', 'Boundary Conditions', 'Boundary conditions', 'not-modeled', 'Fixture compliance and boundary residuals are not solved as separate channels.'),
    analysisCheck('correlation-quality', 'Correlation Quality', 'Correlation quality', quality, score.disclosure),
  ]);
}

/** Channel, force-history, energy-balance, residual, score, and checklist panels. */
export function buildCorrelationPanelOutputs(
  referenceSamples: readonly EngineeringSample[],
  candidateSamples: readonly EngineeringSample[],
  options: CorrelationAnalysisOptions = {},
): CorrelationPanelOutputs {
  const settings = options.settings ?? { maximumShiftSamples: 24, smoothingWindow: 5, weighting: 'uniform' };
  const region = CORRELATION_UI_REGIONS.channels;
  const primary = pickPrimaryChannel(referenceSamples, candidateSamples);
  const referencePrimary = referenceSamples.map((sample) => sample[primary]);
  const candidatePrimary = candidateSamples.map((sample) => sample[primary]);
  const canScore = referencePrimary.length >= 3 && candidatePrimary.length >= 3;
  const result = canScore ? correlateEngineeringSeries(referencePrimary, candidatePrimary, settings) : null;
  const shift = result?.shiftSamples ?? 0;
  const aligned = alignedCursor(shift, referenceSamples.length, candidateSamples.length, options.cursorIndex);
  const loadPair = pairedValues(
    referenceSamples.map((sample) => sample.load),
    candidateSamples.map((sample) => sample.load),
    shift,
  );
  const responsePair = pairedValues(
    referenceSamples.map((sample) => sample.response),
    candidateSamples.map((sample) => sample.response),
    shift,
  );
  const energyPair = pairedValues(
    referenceSamples.map((sample) => sample.energy),
    candidateSamples.map((sample) => sample.energy),
    shift,
  );
  const timePair = pairedValues(
    referenceSamples.map((sample) => sample.time),
    candidateSamples.map((sample) => sample.time),
    shift,
  );
  const cursorOk = aligned.length > 0 && aligned.pairedIndex < loadPair.reference.length;
  const candidateSample = candidateSamples[aligned.candidateIndex];
  const dt = candidateSamples.length >= 2 ? medianStep(candidateSamples) : null;
  const peakErrorValue = result ? extrema(result.candidate).max - extrema(result.reference).max : null;
  const areaSpacing = dt !== null && dt > 0 ? dt : 1;
  const areaErrorValue = result ? trapezoidArea(result.candidate, areaSpacing) - trapezoidArea(result.reference, areaSpacing) : null;
  const timeToPeakErrorValue = result && dt !== null
    ? (extrema(result.candidate).peakIndex - extrema(result.reference).peakIndex) * dt
    : null;
  const verdict: CorrelationScoreVerdict = !canScore || !result
    ? 'insufficient-samples'
    : 'model-agreement';
  const scorePanel: CorrelationScorePanel = Object.freeze({
    uiRegion: CORRELATION_UI_REGIONS.correlationScore,
    score: result?.score ?? null,
    verdict,
    badge: correlationScoreBadge(verdict),
    shiftSamples: shift,
    offsetSeconds: dt !== null ? shift * dt : null,
    correlationCoefficient: result?.correlationCoefficient ?? null,
    normalizedRmse: result?.normalizedRmse ?? null,
    peakError: peakErrorValue,
    areaError: areaErrorValue,
    timeToPeakError: timeToPeakErrorValue,
    primaryChannel: primary,
    disclosure: result
      ? `Model-to-model ${primary} agreement after a ±${settings.maximumShiftSamples}-sample shift search. Score is not an engineering PASS/FAIL and does not use imported uncertainty.`
      : 'Need at least three finite samples on both runs before a correlation score can be computed.',
  });
  const energyBalance = buildEnergyBalancePanel(candidateSamples);
  const residualValues = result?.residual ?? [];
  const residualScale = Math.max(spanOf(result?.reference ?? []), extrema(result?.reference ?? []).peakAbs, 1e-9);
  const residualPercent = residualValues.map((value) => 100 * value / residualScale);
  const residualBound = Math.max(20, Math.ceil(extrema(residualPercent).peakAbs / 5) * 5);
  const forceSeries = primary === 'load' ? loadPair : responsePair;
  const peakTest = peakAnnotation('Peak Test', 'Peak baseline', forceSeries.reference);
  const peakSim = peakAnnotation('Peak Sim', 'Peak work revision', forceSeries.candidate);
  const historyAvailable = forceSeries.reference.length >= 2;
  const forceHistory = historyAvailable
    ? analysisChart({
      uiRegion: CORRELATION_UI_REGIONS.forceHistory,
      title: CORRELATION_UI_REGIONS.forceHistory,
      x: timePair.reference,
      xLabel: 'model time (s)',
      yLabel: primary === 'load' ? 'normalized load' : 'response (simulation-unit)',
      series: [
        chartSeries({
          id: 'reference',
          uiSlot: 'Test',
          label: 'Baseline',
          values: forceSeries.reference,
          role: 'baseline',
        }),
        chartSeries({
          id: 'candidate',
          uiSlot: 'Sim (corr)',
          label: 'Work revision',
          values: forceSeries.candidate,
          role: 'work',
        }),
      ],
      cursorIndex: aligned.pairedIndex,
      annotations: [peakTest, peakSim].filter((entry): entry is AnalysisChartAnnotation => entry !== null),
      available: true,
      disclosure: primary === 'load'
        ? 'Aligned recorded load channels. Baseline is not a physical test unless an imported dataset is bound by the UI.'
        : 'Load span was degenerate, so the force-history panel uses aligned response instead of inventing a force channel.',
    })
    : emptyChart(
      CORRELATION_UI_REGIONS.forceHistory,
      CORRELATION_UI_REGIONS.forceHistory,
      'model time (s)',
      'normalized load',
      'Need two aligned samples before force history can be drawn.',
    );
  const residualChart = result && residualPercent.length >= 2
    ? analysisChart({
      uiRegion: CORRELATION_UI_REGIONS.residual,
      title: CORRELATION_UI_REGIONS.residual,
      x: timePair.reference,
      xLabel: 'model time (s)',
      yLabel: 'residual (% of baseline range)',
      series: [
        chartSeries({
          id: 'residual-percent',
          uiSlot: 'RESIDUAL',
          label: 'Work − baseline',
          values: residualPercent,
          role: 'residual',
        }),
      ],
      cursorIndex: aligned.pairedIndex,
      yDomain: [-residualBound, residualBound],
      annotations: [],
      available: true,
      disclosure: 'Residual is aligned work minus baseline, scaled by the baseline range. Instantaneous percent-of-point is avoided near zeros.',
    })
    : emptyChart(
      CORRELATION_UI_REGIONS.residual,
      CORRELATION_UI_REGIONS.residual,
      'model time (s)',
      'residual (% of baseline range)',
      'Residual percent is available after a scored, aligned pair exists.',
    );
  const candidateRate = backwardRate(candidateSamples, aligned.candidateIndex);
  const channels = metricPanel(region, [
    analysisMetric({
      id: 'force-load-cell',
      uiRegion: region,
      uiSlot: 'Force - Load Cell',
      label: 'Baseline load',
      value: cursorOk ? finiteNumber(loadPair.reference[aligned.pairedIndex]) : null,
      unit: 'normalized',
      available: cursorOk,
      precision: 3,
      provenance: solverProvenance('Aligned baseline load at the data cursor. Not a physical load-cell channel.'),
      disclosure: 'Normalized baseline load after the correlation shift. Not kilonewtons.',
    }),
    analysisMetric({
      id: 'force-sim-corr',
      uiRegion: region,
      uiSlot: 'Force - Sim (corr)',
      label: 'Work load',
      value: cursorOk ? finiteNumber(loadPair.candidate[aligned.pairedIndex]) : null,
      unit: 'normalized',
      available: cursorOk,
      precision: 3,
      provenance: solverProvenance('Aligned work-revision load at the data cursor.'),
      disclosure: 'Normalized work load after the correlation shift. Not kilonewtons.',
    }),
    analysisMetric({
      id: 'acceleration-sled',
      uiRegion: region,
      uiSlot: 'Acceleration - Sled',
      label: 'Response rate',
      value: candidateRate,
      unit: 'simulation-unit/s',
      available: candidateRate !== null,
      precision: 3,
      provenance: derivedProvenance('Backward difference of recorded response. Not sled acceleration in g.'),
      disclosure: 'Δresponse / Δt from adjacent work samples. Not a sled accelerometer channel.',
    }),
    analysisMetric({
      id: 'displacement-sled',
      uiRegion: region,
      uiSlot: 'Displacement - Sled',
      label: 'Work response',
      value: cursorOk ? finiteNumber(responsePair.candidate[aligned.pairedIndex]) : null,
      unit: 'simulation-unit',
      available: cursorOk,
      precision: 3,
      provenance: solverProvenance('Aligned work response at the data cursor. Not an LVDT sled displacement.'),
      disclosure: 'Reduced-model response in simulation units, not millimetres.',
    }),
    analysisMetric({
      id: 'energy-absorbed',
      uiRegion: region,
      uiSlot: 'Energy Absorbed',
      label: 'Work energy proxy',
      value: cursorOk ? finiteNumber(energyPair.candidate[aligned.pairedIndex]) : finiteNumber(candidateSample?.energy),
      unit: 'normalized-energy',
      available: cursorOk || candidateSample !== undefined,
      precision: 3,
      provenance: solverProvenance('Recorded solver energy proxy at the data cursor.'),
      disclosure: 'Normalized energy proxy, not absorbed kilojoules.',
    }),
    unavailableMetric(
      'contact-force-total',
      region,
      'Contact Force - Total',
      'Contact force',
      'normalized',
      'Contact force is not a recorded EngineeringSample channel and is not invented from load or energy.',
    ),
    analysisMetric({
      id: 'correlation-time',
      uiRegion: region,
      uiSlot: 'Time',
      label: 'Work model time',
      value: cursorOk ? finiteNumber(timePair.candidate[aligned.pairedIndex]) : finiteNumber(candidateSample?.time),
      unit: 's',
      available: cursorOk || candidateSample !== undefined,
      precision: 3,
      provenance: solverProvenance('Aligned work-run sample time.'),
      disclosure: 'Simulation seconds at the aligned cursor.',
    }),
  ]);
  return Object.freeze({
    channels,
    forceHistory,
    energyBalance,
    residual: residualChart,
    correlationScore: scorePanel,
    checklist: buildCorrelationChecklist(result?.reference.length ?? 0, scorePanel, energyBalance, options.events),
    frameBookmarks: buildFrameBookmarks(candidateSamples, options.events),
  });
}
