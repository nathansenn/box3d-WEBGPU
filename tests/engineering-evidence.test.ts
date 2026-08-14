import {
  ENGINEERING_EVIDENCE_SCHEMA_V1,
  EVIDENCE_CHIP_STATUSES,
  EVIDENCE_FIELD_CATALOG,
  EVIDENCE_WORKSPACES,
  RUN_RECORD_SCHEMA_V1,
  TEST_DATASET_SCHEMA_V1,
  buildEvidenceFindingsV1,
  canDriveEngineeringPassFail,
  canonicalJson,
  createEngineeringEvidenceV1,
  evidenceChipLabel,
  evidenceChipTone,
  evidenceFieldById,
  evidenceFieldDisplay,
  evidenceFieldsForWorkspace,
  evidenceSummaryStatusForWorkspace,
  parseEngineeringEvidenceV1Json,
  parseRunRecordV1Json,
  parseTestDatasetCsv,
  parseTestDatasetV1Json,
  rollupEvidenceChipStatus,
  runEventSeverityToEvidence,
  sha256Hex,
  tryCanonicalJson,
  validateEvidenceFindingsV1,
  validateProvenanceAndUnits,
  validateRunRecordV1,
  validateTestDatasetV1,
  verifyEngineeringEvidenceV1,
  type ChannelDescriptorV1,
  type EvidenceCalloutV1,
  type EvidenceCheckV1,
  type EvidenceListItemV1,
  type RunRecordV1,
  type TestDatasetV1,
} from '../src/workbench/engineering-evidence';

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

function hasError(result: { ok: boolean; errors?: readonly { code: string }[] }, code: string): boolean {
  return !result.ok && (result.errors?.some((entry) => entry.code === code) ?? false);
}

const displacementChannel: ChannelDescriptorV1 = {
  id: 'center-displacement',
  label: 'Center displacement',
  quantity: 'displacement',
  unit: 'simulation-unit',
  provenance: 'solver-native',
  sampleRateHz: 60,
};

const energyChannel: ChannelDescriptorV1 = {
  id: 'energy-proxy',
  label: 'Normalized energy proxy',
  quantity: 'energy',
  unit: 'normalized-energy',
  provenance: 'solver-native',
  sampleRateHz: 60,
};

function validRun(): RunRecordV1 {
  return {
    schema: RUN_RECORD_SCHEMA_V1,
    runId: 'run-0001',
    createdAt: '2026-08-09T12:00:00.000Z',
    completedAt: '2026-08-09T12:00:01.000Z',
    claimLevel: 'reduced-order',
    lab: {
      id: 'titan-bend-dent',
      title: 'Titan Metal Bend & Dent',
      sceneId: 780,
      materialDemoId: 'metal-square-punch-forming',
      solver: 'material-lattice',
      fidelity: 'Reduced numerical model',
    },
    engine: {
      backend: 'Box3D WASM + material lattice',
      isWasm: true,
      buildVersion: '1.20.0',
      seed: 0x12345678,
      fixedStepS: 1 / 60,
      substeps: 4,
    },
    parameters: {
      'time-scale': 1,
      'actuator-target': 0.8,
    },
    events: [
      { id: 'event-0', timeS: 0, step: 0, kind: 'armed', label: 'Run armed' },
      {
        id: 'event-1', timeS: 0.5, step: 30, kind: 'actuator-load', label: 'Load applied',
        parameters: { target: 0.8, mode: 'normalized' },
      },
    ],
    channels: [displacementChannel, energyChannel],
    samples: {
      timeS: [0, 1 / 60, 2 / 60],
      values: {
        'center-displacement': [0, 0.02, 0.06],
        'energy-proxy': [0, 0.12, 0.42],
      },
    },
    final: { backendHash: 0x10203040, softHash: 0x50607080, warnings: [] },
  };
}

const importedForce: ChannelDescriptorV1 = {
  id: 'load-cell',
  label: 'Load cell',
  quantity: 'force',
  unit: 'kN',
  provenance: 'imported',
  sampleRateHz: 1000,
  uncertainty: { kind: 'relative-2sigma', value: 0.02 },
};

const calibratedDisplacement: ChannelDescriptorV1 = {
  id: 'lvdt',
  label: 'LVDT',
  quantity: 'displacement',
  unit: 'mm',
  provenance: 'user-calibrated',
  calibrationId: 'cal-lvdt-2026',
  sampleRateHz: 1000,
};

function validDataset(): TestDatasetV1 {
  return {
    schema: TEST_DATASET_SCHEMA_V1,
    datasetId: 'test-0001',
    title: 'Imported indentation test',
    createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test', fileName: 'indentation.csv' },
    channels: [importedForce, calibratedDisplacement],
    samples: {
      timeS: [-0.001, 0, 0.001],
      values: {
        'load-cell': [0, 0.4, 1.2],
        lvdt: [0, 0.01, 0.04],
      },
    },
  };
}

async function testCanonicalJsonAndSha256(): Promise<void> {
  equal(canonicalJson({ b: 2, a: { z: false, y: [3, null] } }), '{"a":{"y":[3,null],"z":false},"b":2}');
  equal(
    await sha256Hex(canonicalJson({ b: 2, a: 1 })),
    '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    'canonical JSON should retain the known SHA-256 test vector',
  );
  ok(!tryCanonicalJson({ value: Number.NaN }).ok, 'non-finite numbers must not canonicalize');
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  ok(!tryCanonicalJson(cyclic).ok, 'cycles must not canonicalize');
  ok(!tryCanonicalJson(JSON.parse('{"__proto__":1}')).ok, 'prototype-sensitive keys must not canonicalize');
}

function testProvenanceAndUnitGuards(): void {
  equal(validateProvenanceAndUnits(displacementChannel).length, 0);
  equal(validateProvenanceAndUnits(importedForce).length, 0);
  equal(validateProvenanceAndUnits(calibratedDisplacement).length, 0);

  const falseNativeForce: ChannelDescriptorV1 = {
    ...importedForce,
    id: 'false-native-force',
    provenance: 'solver-native',
  };
  ok(validateProvenanceAndUnits(falseNativeForce).some((entry) => entry.code === 'uncalibrated-physical-unit'));

  const falseSyntheticForce: ChannelDescriptorV1 = {
    ...importedForce,
    id: 'false-synthetic-force',
    provenance: 'synthetic-demo',
  };
  ok(validateProvenanceAndUnits(falseSyntheticForce).some((entry) => entry.code === 'uncalibrated-physical-unit'));

  const missingCalibration: ChannelDescriptorV1 = {
    ...calibratedDisplacement,
    id: 'uncalibrated-lvdt',
    calibrationId: undefined,
  };
  ok(validateProvenanceAndUnits(missingCalibration).some((entry) => entry.code === 'missing-calibration'));

  const residual: ChannelDescriptorV1 = {
    id: 'force-residual',
    label: 'Force residual',
    quantity: 'force',
    unit: 'kN',
    provenance: 'derived',
    sourceChannelIds: ['load-cell'],
  };
  equal(validateProvenanceAndUnits(residual, [importedForce, residual]).length, 0);
  ok(canDriveEngineeringPassFail(importedForce, [importedForce], 'physical-test'));
  ok(canDriveEngineeringPassFail(residual, [importedForce, residual], 'physical-test'));
  ok(!canDriveEngineeringPassFail(displacementChannel, [displacementChannel], 'simulation-export'));
  ok(!canDriveEngineeringPassFail({ ...importedForce, unit: 'normalized' }, [importedForce], 'physical-test'));

  const orphanResidual = { ...residual, sourceChannelIds: ['missing'] } as ChannelDescriptorV1;
  ok(validateProvenanceAndUnits(orphanResidual, [orphanResidual]).some((entry) => entry.code === 'untrusted-derived-unit'));
}

function testRunAndDatasetJsonValidation(): void {
  const run = validRun();
  ok(validateRunRecordV1(run).ok);
  ok(parseRunRecordV1Json(JSON.stringify(run)).ok);
  ok(hasError(parseRunRecordV1Json('{'), 'invalid-json'));
  ok(hasError(parseRunRecordV1Json(JSON.stringify({ ...run, schema: 'box3d.run/2' })), 'unsupported-schema'));

  const nonMonotonic = JSON.parse(JSON.stringify(run)) as { samples: { timeS: number[] } };
  nonMonotonic.samples.timeS = [0, 0.1, 0.05];
  ok(hasError(validateRunRecordV1(nonMonotonic), 'non-monotonic-time'));

  const mismatched = JSON.parse(JSON.stringify(run)) as { samples: { values: Record<string, number[]> } };
  mismatched.samples.values['energy-proxy'] = [0];
  ok(hasError(validateRunRecordV1(mismatched), 'sample-count-mismatch'));

  const dataset = validDataset();
  ok(validateTestDatasetV1(dataset).ok);
  ok(parseTestDatasetV1Json(JSON.stringify(dataset)).ok);
  const badUnit = JSON.parse(JSON.stringify(dataset)) as { channels: Array<{ unit: string }> };
  badUnit.channels[0].unit = 'pounds-force';
  ok(hasError(validateTestDatasetV1(badUnit), 'unsupported-unit'));

  const noSource = JSON.parse(JSON.stringify(dataset)) as { source?: unknown };
  delete noSource.source;
  ok(hasError(validateTestDatasetV1(noSource), 'missing-source'));

  const falsePhysical = JSON.parse(JSON.stringify(dataset)) as { channels: Array<{ provenance: string }> };
  falsePhysical.channels[0].provenance = 'synthetic-demo';
  ok(hasError(validateTestDatasetV1(falsePhysical), 'physical-source-mismatch'));
}

function testCsvParsing(): void {
  const csv = '\ufefftime_s,"Force, corrected",Disp\r\n-0.001,0,0\r\n0,0.4,0.01\r\n0.001,1.2,\r\n';
  const result = parseTestDatasetCsv(csv, {
    datasetId: 'csv-test-1',
    title: 'CSV physical test',
    createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test', fileName: 'input.csv' },
    channels: [
      { column: 'Force, corrected', ...importedForce },
      { column: 'Disp', ...calibratedDisplacement },
    ],
  });
  ok(result.ok, result.ok ? undefined : result.errors.map((entry) => entry.message).join('; '));
  deepEqual(result.value.samples.timeS, [-0.001, 0, 0.001]);
  deepEqual(result.value.samples.values['load-cell'], [0, 0.4, 1.2]);
  deepEqual(result.value.samples.values.lvdt, [0, 0.01, null]);

  const duplicateHeader = parseTestDatasetCsv('time_s,F,F\n0,1,2', {
    datasetId: 'bad-csv', title: 'Bad CSV', createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test' },
    channels: [{ column: 'F', ...importedForce }],
  });
  ok(hasError(duplicateHeader, 'duplicate-header'));

  const nonMonotonic = parseTestDatasetCsv('time_s,F\n0,1\n0,2', {
    datasetId: 'bad-time', title: 'Bad time', createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test' },
    channels: [{ column: 'F', ...importedForce }],
  });
  ok(hasError(nonMonotonic, 'non-monotonic-time'));

  const nonDecimal = parseTestDatasetCsv('time_s,F\n0,0x10', {
    datasetId: 'bad-number', title: 'Bad number', createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test' },
    channels: [{ column: 'F', ...importedForce }],
  });
  ok(hasError(nonDecimal, 'invalid-csv-value'));

  const unterminated = parseTestDatasetCsv('time_s,F\n0,"1', {
    datasetId: 'bad-quote', title: 'Bad quote', createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'physical-test' },
    channels: [{ column: 'F', ...importedForce }],
  });
  ok(hasError(unterminated, 'invalid-csv'));
}

async function testEvidenceChecksumAndTamperDetection(): Promise<void> {
  const run = validRun();
  const dataset = validDataset();
  const created = await createEngineeringEvidenceV1(run, dataset);
  ok(created.ok, created.ok ? undefined : created.errors.map((entry) => entry.message).join('; '));
  equal(created.value.schema, ENGINEERING_EVIDENCE_SCHEMA_V1);
  equal(created.value.checksum.algorithm, 'SHA-256');
  equal(created.value.checksum.value.length, 64);
  ok((await verifyEngineeringEvidenceV1(created.value)).ok);
  ok((await parseEngineeringEvidenceV1Json(JSON.stringify(created.value))).ok);

  (run.parameters as Record<string, number>)['actuator-target'] = 1.7;
  equal(created.value.run.parameters['actuator-target'], 0.8, 'evidence creation must snapshot mutable caller data');

  const reordered = {
    testDataset: created.value.testDataset,
    run: created.value.run,
    checksum: created.value.checksum,
    schema: created.value.schema,
  };
  ok((await verifyEngineeringEvidenceV1(reordered)).ok, 'object key order must not change evidence validity');

  const tampered = JSON.parse(JSON.stringify(created.value)) as {
    run: { samples: { values: Record<string, number[]> } };
  };
  tampered.run.samples.values['center-displacement'][1] = 99;
  const tamperResult = await verifyEngineeringEvidenceV1(tampered);
  ok(hasError(tamperResult, 'checksum-mismatch'));

  const unsupported = JSON.parse(JSON.stringify(created.value)) as { schema: string };
  unsupported.schema = 'box3d.evidence/2';
  ok(hasError(await verifyEngineeringEvidenceV1(unsupported), 'unsupported-schema'));

  const uncovered = { ...created.value, unsignedNote: 'not checksummed' };
  ok(hasError(await verifyEngineeringEvidenceV1(uncovered), 'unexpected-evidence-field'));

  const uncoveredChecksum = JSON.parse(JSON.stringify(created.value)) as { checksum: Record<string, unknown> };
  uncoveredChecksum.checksum.unsignedNote = 'not checksummed';
  ok(hasError(await verifyEngineeringEvidenceV1(uncoveredChecksum), 'unexpected-checksum-field'));
}

function testSyntheticDatasetSafety(): void {
  const syntheticChannel: ChannelDescriptorV1 = {
    id: 'demo-force', label: 'Demo force', quantity: 'force', unit: 'normalized', provenance: 'synthetic-demo',
  };
  const dataset: TestDatasetV1 = {
    schema: TEST_DATASET_SCHEMA_V1,
    datasetId: 'synthetic-demo-1',
    title: 'Synthetic training data',
    createdAt: '2026-08-09T11:30:00.000Z',
    source: { kind: 'synthetic-demo' },
    channels: [syntheticChannel],
    samples: { timeS: [0, 1], values: { 'demo-force': [0, 1] } },
  };
  const result = validateTestDatasetV1(dataset);
  ok(result.ok);
  ok(result.warnings.some((entry) => entry.code === 'synthetic-data'));
  ok(!canDriveEngineeringPassFail(syntheticChannel, [syntheticChannel], 'synthetic-demo'));
}

function structuralFindings(run: RunRecordV1) {
  const peakLoad: EvidenceListItemV1 = {
    id: 'predicted-max-force',
    label: 'Predicted peak load',
    value: 0.89,
    quantity: 'load',
    unit: 'normalized',
    severity: 'pass',
    status: 'within-limits',
    provenance: 'solver-native',
    links: [
      { kind: 'parameter', id: 'actuator-target' },
      { kind: 'field', id: 'max-force-limit' },
    ],
  };
  const peakStrain: EvidenceListItemV1 = {
    id: 'predicted-max-strain-xx',
    label: 'Predicted peak strain',
    value: 0.42,
    quantity: 'strain',
    unit: 'normalized',
    severity: 'pass',
    status: 'within-limits',
    provenance: 'solver-native',
    links: [
      { kind: 'channel', id: 'center-displacement' },
      { kind: 'field', id: 'max-strain-xx-limit' },
    ],
  };
  const forceTarget: EvidenceCalloutV1 = {
    id: 'force-target',
    kind: 'viewport-target',
    label: 'Normalized input',
    value: 0.8,
    unit: 'normalized',
    severity: 'pass',
    status: 'ok',
    links: [
      { kind: 'parameter', id: 'actuator-target' },
      { kind: 'field', id: 'force-target' },
    ],
  };
  const lvdt: EvidenceCalloutV1 = {
    id: 'lvdt-01',
    kind: 'sensor',
    label: 'Deflection probe',
    value: 0.06,
    unit: 'simulation-unit',
    severity: 'pass',
    status: 'ok',
    links: [
      { kind: 'channel', id: 'center-displacement' },
      { kind: 'field', id: 'lvdt-01' },
    ],
  };
  const checks: EvidenceCheckV1[] = [
    { id: 'runtime', label: 'Runtime initialized', status: 'pass', severity: 'pass', detail: 'Solver staged.' },
    { id: 'claims', label: 'Claim boundary', status: 'pass', severity: 'pass', detail: 'Reduced-order output.' },
  ];
  return buildEvidenceFindingsV1({
    workspace: 'structural',
    chips: [
      { id: 'safety-interlock', status: 'ok', label: 'OK', severity: 'pass', links: [{ kind: 'field', id: 'safety-interlock' }] },
      { id: 'deterministic', status: 'ok', label: 'DETERMINISTIC', severity: 'pass', links: [{ kind: 'field', id: 'deterministic' }] },
    ],
    items: [peakLoad, peakStrain],
    callouts: [forceTarget, lvdt],
    checks,
  });
}

function testEvidenceCalloutMapping(): void {
  equal(evidenceChipLabel('within-limits'), 'WITHIN LIMITS');
  equal(evidenceChipLabel('pass-with-notes'), 'PASS WITH NOTES');
  equal(evidenceChipLabel('fail'), 'FAIL');
  equal(evidenceChipLabel('ok'), 'OK');
  equal(evidenceChipLabel('good'), 'GOOD');
  equal(evidenceChipLabel('synced'), 'SYNCED');
  equal(evidenceChipTone('within-limits'), 'good');
  equal(evidenceChipTone('pass-with-notes'), 'caution');
  equal(evidenceChipTone('fail'), 'danger');
  equal(evidenceChipTone('not-scored'), 'info');
  equal(runEventSeverityToEvidence('danger'), 'fail');
  equal(rollupEvidenceChipStatus(['ok', 'pass', 'within-limits']), 'pass');
  equal(rollupEvidenceChipStatus(['ok', 'fail', 'pass-with-notes']), 'fail');
  equal(evidenceSummaryStatusForWorkspace('structural', 'pass'), 'within-limits');
  equal(evidenceSummaryStatusForWorkspace('correlation', 'pass'), 'pass');
  equal(evidenceSummaryStatusForWorkspace('field', 'pass'), 'ok');

  for (const status of EVIDENCE_CHIP_STATUSES) evidenceChipLabel(status);
  for (const workspace of EVIDENCE_WORKSPACES) {
    ok(evidenceFieldsForWorkspace(workspace).length > 0, `${workspace} must expose mockup fields`);
  }

  const force = evidenceFieldById('predicted-max-force');
  ok(force);
  deepEqual(evidenceFieldDisplay(force, 'reduced-order'), { label: 'Predicted peak load', unit: 'normalized' });
  deepEqual(evidenceFieldDisplay(force, 'calibrated'), { label: 'Predicted Max Force', unit: 'kN' });
  equal(evidenceFieldById('sat-marker')?.mockupLabel, 'SAT');
  equal(evidenceFieldById('sensor-saturation')?.mockupLabel, 'Sensor Saturation');
  equal(evidenceFieldById('mac-pred-vs-actual')?.mockupLabel, 'MAC (pred vs actual)');
  equal(evidenceFieldById('workbench-agreement')?.mockupLabel, 'Correlation Score');
  equal(evidenceFieldById('force-magnitude')?.workspace, 'material-lab');
  equal(evidenceFieldById('impulse')?.workspace, 'material-lab');
  equal(evidenceFieldById('max-stress')?.workspace, 'material-lab');
  equal(evidenceFieldById('tap-p1')?.mockupLabel, 'A1');
  equal(evidenceFieldById('tap-p5')?.mockupLabel, 'A5');
  deepEqual([...EVIDENCE_WORKSPACES], ['structural', 'correlation', 'field', 'material-lab']);
  equal(EVIDENCE_FIELD_CATALOG.length, new Set(EVIDENCE_FIELD_CATALOG.map((entry) => entry.id)).size);

  const run = validRun();
  const withSeverity = {
    ...run,
    events: run.events.map((event, index) => (index === 0 ? { ...event, severity: 'pass' as const } : event)),
  };
  ok(validateRunRecordV1(withSeverity).ok, 'optional event severity must be accepted');
  const findings = structuralFindings(run);
  equal(findings.summary.status, 'within-limits');
  equal(findings.summary.label, 'WITHIN LIMITS');
  const valid = validateEvidenceFindingsV1(findings, run);
  ok(valid.ok, valid.ok ? undefined : valid.errors.map((entry) => entry.message).join('; '));

  const optimistic = {
    ...findings,
    summary: { id: 'structural-summary', status: 'pass' as const, label: 'PASS', severity: 'pass' as const },
    checks: [...findings.checks, {
      id: 'sensor-saturation', label: 'Sensor Saturation', status: 'fail' as const, severity: 'fail' as const,
      detail: 'Imported channel reports saturation.',
      links: [{ kind: 'field' as const, id: 'sensor-saturation' }],
    }],
  };
  ok(hasError(validateEvidenceFindingsV1(optimistic, run), 'optimistic-summary'));

  const physical = {
    ...findings,
    items: [{
      ...findings.items[0],
      unit: 'kN' as const,
      value: 22.31,
      label: 'Predicted Max Force',
    }],
  };
  ok(hasError(validateEvidenceFindingsV1(physical, run), 'uncalibrated-physical-unit'));

  const missingLink = {
    ...findings,
    callouts: [{
      ...findings.callouts[0],
      links: [{ kind: 'channel' as const, id: 'missing-load-cell' }],
    }],
  };
  ok(hasError(validateEvidenceFindingsV1(missingLink, run), 'missing-link-target'));
}

async function testFindingsChecksumAndCorrelationCallouts(): Promise<void> {
  const run = validRun();
  const dataset = validDataset();
  const structural = structuralFindings(run);
  const created = await createEngineeringEvidenceV1(run, undefined, structural);
  ok(created.ok, created.ok ? undefined : created.errors.map((entry) => entry.message).join('; '));
  ok(created.value.findings);
  equal(created.value.findings.summary.label, 'WITHIN LIMITS');
  ok((await verifyEngineeringEvidenceV1(created.value)).ok);

  const tampered = JSON.parse(JSON.stringify(created.value)) as { findings: { items: Array<{ value: number }> } };
  tampered.findings.items[0].value = 99;
  ok(hasError(await verifyEngineeringEvidenceV1(tampered), 'checksum-mismatch'));

  const withoutFindings = await createEngineeringEvidenceV1(run, dataset);
  ok(withoutFindings.ok);
  ok(withoutFindings.value.findings === undefined);
  ok((await verifyEngineeringEvidenceV1(withoutFindings.value)).ok, 'legacy envelopes without findings must still verify');

  const saturation: EvidenceCheckV1 = {
    id: 'sensor-saturation',
    label: 'Sensor Saturation',
    status: 'fail',
    severity: 'fail',
    detail: 'Load cell reports saturation at peak.',
    links: [
      { kind: 'channel', id: 'load-cell' },
      { kind: 'field', id: 'sensor-saturation' },
    ],
  };
  const satCallout: EvidenceCalloutV1 = {
    id: 'sat-marker',
    kind: 'graph-marker',
    label: 'SAT',
    detail: 'Saturation on imported force history.',
    timeS: 0.0614,
    severity: 'fail',
    status: 'fail',
    links: [
      { kind: 'check', id: 'sensor-saturation' },
      { kind: 'channel', id: 'load-cell' },
      { kind: 'field', id: 'sat-marker' },
    ],
  };
  const correlation = buildEvidenceFindingsV1({
    workspace: 'correlation',
    checks: [
      { id: 'time-zero-alignment', label: 'Time Zero Alignment', status: 'pass', severity: 'pass', detail: 'Locked.', links: [{ kind: 'field', id: 'time-zero-alignment' }] },
      saturation,
      { id: 'energy-balance', label: 'Energy Balance', status: 'pass-with-notes', severity: 'warning', detail: 'Energy proxy residual is visible.', links: [{ kind: 'field', id: 'energy-balance' }] },
    ],
    callouts: [satCallout],
    items: [{
      id: 'energy-balance-error',
      label: 'Energy proxy residual',
      value: -0.006,
      quantity: 'energy',
      unit: 'normalized-energy',
      severity: 'warning',
      status: 'pass-with-notes',
      provenance: 'derived',
      links: [{ kind: 'channel', id: 'energy-proxy' }, { kind: 'field', id: 'energy-balance-error' }],
    }],
    confidence: {
      id: 'workbench-agreement',
      kind: 'correlation-score',
      label: 'WORKBENCH AGREEMENT',
      value: 94.7,
      unit: '%',
      status: 'pass-with-notes',
      links: [{ kind: 'field', id: 'workbench-agreement' }],
    },
  });
  equal(correlation.summary.status, 'fail');
  equal(correlation.summary.label, 'FAIL');
  const correlationResult = validateEvidenceFindingsV1(correlation, run, dataset);
  ok(correlationResult.ok, correlationResult.ok ? undefined : correlationResult.errors.map((entry) => entry.message).join('; '));

  const field = buildEvidenceFindingsV1({
    workspace: 'field',
    chips: [{ id: 'synced', status: 'synced', label: 'SYNCED', severity: 'pass' }],
    checks: [
      { id: 'preflight', label: 'PREFLIGHT', status: 'pass', severity: 'pass', detail: 'All numerical checks passed.', links: [{ kind: 'field', id: 'preflight' }] },
    ],
    callouts: [
      { id: 'tap-p5', kind: 'channel-health', label: 'P5', value: 0.93, unit: 'normalized', severity: 'pass', status: 'ok', links: [{ kind: 'field', id: 'tap-p5' }] },
      { id: 'capture-001', kind: 'capture-slot', label: 'ACCEPTED', status: 'ok', severity: 'pass', links: [{ kind: 'field', id: 'capture-status' }] },
    ],
    confidence: {
      id: 'spectral-concentration',
      kind: 'spectral-concentration',
      label: 'Peak concentration',
      value: 0.63,
      unit: 'ratio',
      status: 'ok',
      links: [{ kind: 'field', id: 'coherence-threshold' }],
    },
  });
  equal(field.summary.status, 'ok');
  ok(validateEvidenceFindingsV1(field, run).ok);
}

const tests: Array<readonly [string, () => void | Promise<void>]> = [
  ['canonical JSON and SHA-256', testCanonicalJsonAndSha256],
  ['provenance and unit guards', testProvenanceAndUnitGuards],
  ['run and dataset JSON validation', testRunAndDatasetJsonValidation],
  ['CSV parsing', testCsvParsing],
  ['evidence checksum and tamper detection', testEvidenceChecksumAndTamperDetection],
  ['synthetic dataset safety', testSyntheticDatasetSafety],
  ['evidence callout mapping', testEvidenceCalloutMapping],
  ['findings checksum and correlation callouts', testFindingsChecksumAndCorrelationCallouts],
];

async function main(): Promise<void> {
  for (const [name, test] of tests) {
    await test();
    console.log(`✓ ${name}`);
  }
  console.log(`All ${tests.length} engineering evidence suites passed.`);
}

void main();
