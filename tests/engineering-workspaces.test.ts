import {
  buildSyntheticComparisonSeries,
  correlateEngineeringSeries,
  estimateReducedModalResponse,
} from '../src/workbench/engineering-analysis';
import {
  EVIDENCE_CALLOUT_KINDS,
  EVIDENCE_CHIP_STATUSES,
  EVIDENCE_CONFIDENCE_KINDS,
  EVIDENCE_FIELD_CATALOG,
  EVIDENCE_WORKSPACES,
  ENGINEERING_UNITS,
  MEASUREMENT_QUANTITIES,
  RUN_EVENT_KINDS,
  evidenceFieldById,
  evidenceFieldsForWorkspace,
  type EvidenceWorkspaceV1,
} from '../src/workbench/engineering-evidence';
import {
  getEngineeringModelForLab,
  type EngineeringFieldProbe,
  type EngineeringModelManifest,
} from '../src/workbench/engineering-model';
import {
  ENGINEERING_RUN_STATES,
  ENGINEERING_WORKSPACES,
  type EngineeringPreflightCheck,
  type EngineeringSample,
  type EvidenceProvenance,
} from '../src/workbench/engineering-session';
import {
  WORKBENCH_CONCEPT_VIEW_IDS,
  WORKBENCH_FORCE_MODES,
  WORKBENCH_GROUPS,
  WORKBENCH_PARAMETER_IDS,
  getWorkbenchConceptView,
} from '../src/workbench/registry';
import type {
  EngineeringChartId,
  EngineeringTelemetryUpdate,
} from '../src/ui/engineering-workspaces';

function ok(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `expected ${a} to deepEqual ${b}`);
}

const MOCKUP_CHART_IDS = [
  'correlation-force',
  'correlation-energy',
  'correlation-residual',
  'field-frequency-response',
  'field-coherence',
] as const satisfies readonly EngineeringChartId[];

const STRUCTURAL_TELEMETRY_KEYS = [
  'force',
  'displacement',
  'strainX',
  'strainY',
  'strainXY',
  'energy',
  'step',
  'timeSeconds',
] as const satisfies readonly (keyof EngineeringTelemetryUpdate)[];

const CORRELATION_TELEMETRY_KEYS = [
  'force',
  'energy',
  'residual',
  'correlationPercent',
  'frame',
] as const satisfies readonly (keyof EngineeringTelemetryUpdate)[];

const FIELD_TELEMETRY_KEYS = [
  'frequencyHz',
  'dampingPercent',
  'coherence',
] as const satisfies readonly (keyof EngineeringTelemetryUpdate)[];

const FIELD_MODAL_PROBES: readonly EngineeringFieldProbe[] = [
  { id: 'P1', label: 'P1', u: 0.08, v: 0.5, component: 'normal' },
  { id: 'P2', label: 'P2', u: 0.28, v: 0.5, component: 'normal' },
  { id: 'P3', label: 'P3', u: 0.48, v: 0.5, component: 'normal' },
  { id: 'P4', label: 'P4', u: 0.68, v: 0.5, component: 'normal' },
  { id: 'P5', label: 'P5', u: 0.88, v: 0.5, component: 'normal' },
];

const FIELD_MODAL_IMPACT = { u: 0.94, v: 0.5 } as const;
const FIELD_MODAL_CAPTURE_SLOTS = 6;
const FIELD_MODAL_SAMPLE_RATE_HZ = 480;
const FIELD_MODAL_SAMPLE_COUNT = 4096;

function testWorkspaceIdsIncludeConceptScreens(): void {
  deepEqual(
    [...WORKBENCH_CONCEPT_VIEW_IDS],
    ['material-lab-desktop', 'material-lab-mobile', 'structural-test', 'correlation-review', 'field-modal'],
  );
  deepEqual([...ENGINEERING_WORKSPACES], ['test', 'correlation', 'field']);
  deepEqual([...WORKBENCH_GROUPS], ['materials', 'cloth', 'rope', 'water', 'rigid', 'combined']);
  ok(WORKBENCH_FORCE_MODES.includes('actuator-load'));
  ok(WORKBENCH_FORCE_MODES.includes('material-strike'));
  ok(WORKBENCH_PARAMETER_IDS.includes('actuator-target'));
  ok(WORKBENCH_PARAMETER_IDS.includes('material-strike-strength'));
  ok(WORKBENCH_PARAMETER_IDS.includes('material-strike-radius'));
  deepEqual(
    [...ENGINEERING_RUN_STATES],
    ['draft', 'preflight', 'armed', 'running', 'paused', 'complete', 'aborted'],
  );

  const structural = getWorkbenchConceptView('structural-test');
  const correlation = getWorkbenchConceptView('correlation-review');
  const field = getWorkbenchConceptView('field-modal');
  const labDesktop = getWorkbenchConceptView('material-lab-desktop');
  const labMobile = getWorkbenchConceptView('material-lab-mobile');
  ok(structural && correlation && field && labDesktop && labMobile);

  ok(structural.panels.some((panel) => panel.id === 'experiment-navigator'));
  ok(structural.panels.some((panel) => panel.id === 'chart-force-displacement'));
  ok(structural.panels.some((panel) => panel.id === 'timeline'));
  ok(correlation.panels.some((panel) => panel.id === 'split-viewport'));
  ok(correlation.panels.some((panel) => panel.id === 'chart-correlation-residual'));
  ok(correlation.panels.some((panel) => panel.id === 'checklist'));
  ok(field.panels.some((panel) => panel.id === 'chart-field-frequency-response'));
  ok(field.panels.some((panel) => panel.id === 'capture-strip'));
  ok(field.tabs.includes('run') && field.tabs.includes('channels') && field.tabs.includes('modes') && field.tabs.includes('notes'));
  ok(labDesktop.tabs.includes('lab') && labDesktop.tabs.includes('compare') && labDesktop.tabs.includes('captures'));
  ok(labMobile.panels.some((panel) => panel.id === 'inspector-panel-force'));
}

function testCorrelationAndFieldAnalysisShapes(): void {
  const reference = buildSyntheticComparisonSeries(128);
  const candidate = reference.map((value, index) => value * 1.04 + ((index % 5) - 2) * 0.002);
  const result = correlateEngineeringSeries(reference, candidate, {
    maximumShiftSamples: 12,
    smoothingWindow: 5,
    weighting: 'uniform',
  });
  ok(Number.isFinite(result.score), 'correlation score must be finite for the mockup summary');
  ok(Number.isFinite(result.shiftSamples));
  ok(Number.isFinite(result.normalizedRmse));
  ok(Number.isFinite(result.correlationCoefficient));
  ok(result.reference.length >= 3 && result.candidate.length === result.reference.length);
  equal(result.residual.length, result.reference.length, 'residual series must align with the compared window');

  const provenance: EvidenceProvenance = {
    source: 'derived',
    label: 'Reduced-order modal estimate',
    calibrated: false,
    detail: 'Hann-windowed response spectrum',
  };
  const samples: EngineeringSample[] = [];
  for (let step = 0; step < 160; step++) {
    const time = step / 60;
    samples.push({
      time,
      step,
      load: step === 8 ? 1 : 0,
      response: Math.sin(2 * Math.PI * 6 * time) * Math.exp(-0.35 * time),
      energy: 0.18,
      damage: 0,
      brokenCount: 0,
      hash: step,
    });
  }
  const estimate = estimateReducedModalResponse(samples, provenance);
  ok(estimate, 'field-modal spectrum estimate must be produced from a finite impulse record');
  ok(Number.isFinite(estimate.dominantFrequency));
  ok(Number.isFinite(estimate.dampingRatio));
  ok(Number.isFinite(estimate.spectralConfidence));
  ok(estimate.bins.length > 0);
  ok(Number.isFinite(estimate.bins[0].frequency));
  ok(Number.isFinite(estimate.bins[0].amplitudeDb));
  ok(Number.isFinite(estimate.bins[0].relativePower));
  equal(estimate.provenance.source, 'derived');

  equal(MOCKUP_CHART_IDS.length, 5);
  equal(STRUCTURAL_TELEMETRY_KEYS.length, 8);
  equal(CORRELATION_TELEMETRY_KEYS.length, 5);
  equal(FIELD_TELEMETRY_KEYS.length, 3);

  const preflight: EngineeringPreflightCheck = {
    id: 'preflight',
    label: 'PREFLIGHT',
    status: 'pass',
    detail: 'Clone available',
  };
  equal(preflight.status, 'pass');
  ok(RUN_EVENT_KINDS.includes('load-step'));
  ok(RUN_EVENT_KINDS.includes('hold'));
  ok(RUN_EVENT_KINDS.includes('limit-warning'));
  ok(RUN_EVENT_KINDS.includes('abort'));
}

function testEvidenceCatalogCoversMockupWorkspaces(): void {
  deepEqual([...EVIDENCE_WORKSPACES], ['structural', 'correlation', 'field', 'material-lab']);
  for (const workspace of EVIDENCE_WORKSPACES) {
    const fields = evidenceFieldsForWorkspace(workspace);
    ok(fields.length >= 5, `${workspace} mockup must have evidence field ids`);
    for (const field of fields) {
      equal(field.workspace, workspace);
      ok(MEASUREMENT_QUANTITIES.includes(field.quantity));
      ok(ENGINEERING_UNITS.includes(field.mockupUnit));
      ok(ENGINEERING_UNITS.includes(field.disclosureUnit));
      equal(evidenceFieldById(field.id), field);
    }
  }

  equal(evidenceFieldById('force-target')?.workspace, 'structural');
  equal(evidenceFieldById('lvdt-01')?.kind, 'sensor');
  equal(evidenceFieldById('workbench-agreement')?.kind, 'confidence');
  equal(evidenceFieldById('tap-p1')?.mockupLabel, 'A1');
  equal(evidenceFieldById('tap-p5')?.mockupLabel, 'A5');
  equal(evidenceFieldById('force-magnitude')?.workspace, 'material-lab');
  equal(evidenceFieldById('missing-field'), undefined);

  ok(EVIDENCE_CALLOUT_KINDS.includes('checklist-item'));
  ok(EVIDENCE_CALLOUT_KINDS.includes('preflight-item'));
  ok(EVIDENCE_CALLOUT_KINDS.includes('channel-health'));
  ok(EVIDENCE_CALLOUT_KINDS.includes('capture-slot'));
  ok(EVIDENCE_CHIP_STATUSES.includes('within-limits'));
  ok(EVIDENCE_CHIP_STATUSES.includes('pass-with-notes'));
  ok(EVIDENCE_CHIP_STATUSES.includes('armed'));
  ok(EVIDENCE_CONFIDENCE_KINDS.includes('correlation-score'));
  ok(EVIDENCE_CONFIDENCE_KINDS.includes('mac'));
  ok(EVIDENCE_CONFIDENCE_KINDS.includes('coherence'));

  const uniqueIds = new Set(EVIDENCE_FIELD_CATALOG.map((entry) => entry.id));
  equal(uniqueIds.size, EVIDENCE_FIELD_CATALOG.length, 'evidence field catalog ids must be unique');

  const workspaces = new Set<EvidenceWorkspaceV1>(EVIDENCE_FIELD_CATALOG.map((entry) => entry.workspace));
  for (const workspace of EVIDENCE_WORKSPACES) ok(workspaces.has(workspace));
}

function readFieldPanel(model: EngineeringModelManifest): EngineeringModelManifest['field'] | undefined {
  return 'field' in model ? model.field : undefined;
}

function testFlagshipMockupPanelShapes(): void {
  equal(FIELD_MODAL_PROBES.length, 5);
  equal(new Set(FIELD_MODAL_PROBES.map((probe) => probe.id)).size, 5);
  for (const probe of FIELD_MODAL_PROBES) {
    ok(probe.u >= 0 && probe.u <= 1);
    equal(probe.v, 0.5);
    equal(probe.component, 'normal');
  }
  ok(FIELD_MODAL_IMPACT.u > FIELD_MODAL_PROBES[4].u);
  equal(FIELD_MODAL_CAPTURE_SLOTS, 6);

  const structural = getEngineeringModelForLab('titan-bend-dent');
  const correlation = getEngineeringModelForLab('crash-rail-axial-fold');
  const fieldLab = getEngineeringModelForLab('composite-coupon');
  ok(structural && correlation && fieldLab);

  for (const model of [structural, correlation, fieldLab]) {
    ok(model.channels.length >= 3, `${model.labId} must expose live channels for the mockup sensor rail`);
    ok(model.loadCase, `${model.labId} must expose a load-case inspector shape`);
    ok(model.correlation.checks.length >= 1, `${model.labId} must expose correlation checklist rows`);
    ok(model.correlation.series.length >= 1, `${model.labId} must expose reference/candidate series`);
    ok(model.overlays.length >= 1, `${model.labId} must expose a viewport overlay legend`);
    ok(model.materials.length >= 1, `${model.labId} must expose a material card`);
  }

  const field = readFieldPanel(fieldLab);
  ok(field, 'composite-coupon must publish the field-modal panel contract');
  equal(field.capability, 'analysis-only-cantilever');
  equal(field.probes.length, 5, 'field-modal mockup shows five response taps');
  equal(field.captures.length, FIELD_MODAL_CAPTURE_SLOTS, 'capture strip holds six slots');
  equal(field.window, 'hann');
  equal(field.sampleRateHz, FIELD_MODAL_SAMPLE_RATE_HZ);
  equal(field.sampleCount, FIELD_MODAL_SAMPLE_COUNT);
  deepEqual(
    field.probes.map((probe) => [probe.u, probe.v]),
    FIELD_MODAL_PROBES.map((probe) => [probe.u, probe.v]),
  );
  equal(field.impact.u, FIELD_MODAL_IMPACT.u);
  equal(field.impact.v, FIELD_MODAL_IMPACT.v);
  ok(Array.isArray(field.spectrum.frequencies));
  ok(Array.isArray(field.spectrum.amplitudeDb));
  ok(Array.isArray(field.spectrum.relativePower));
}

const tests: Array<readonly [string, () => void]> = [
  ['workspace ids include five concept screens', testWorkspaceIdsIncludeConceptScreens],
  ['correlation and field analysis shapes', testCorrelationAndFieldAnalysisShapes],
  ['evidence catalog covers mockup workspaces', testEvidenceCatalogCoversMockupWorkspaces],
  ['flagship mockup panel shapes', testFlagshipMockupPanelShapes],
];

export function runEngineeringWorkspaceContractTests(): void {
  for (const [, test] of tests) test();
}

function isDirectRun(filename: string): boolean {
  const argv1 = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[1] ?? '';
  return argv1.includes(filename);
}

if (isDirectRun('engineering-workspaces.test')) {
  for (const [name, test] of tests) {
    test();
    console.log(`✓ ${name}`);
  }
  console.log(`All ${tests.length} engineering-workspace suites passed.`);
}
