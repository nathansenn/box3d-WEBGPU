import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { captureBaseline, hashValue, manifestIdentity, reserveRunDirectory, verifyManifestStructure } from '../../scripts/engine-baseline.mjs';
import { bootstrapRatio, checkResult, METRICS, RESULT_SCHEMA, SAMPLE_SCHEMA, verifyRunDirectory } from '../../scripts/engine-check.mjs';
import { makeProtocol } from '../../scripts/engine-benchmark.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
function manifest(label) {
  const file = { path: 'src/studio/physics.ts', bytes: label.length, sha256: sha(label) };
  const source = { status: 'measured', files: [file], bytes: label.length, sha256: hashValue([file]) };
  const asset = { path: 'reference.txt', bytes: 3, sha256: sha('ref') };
  const body = { schema: 'box3d.engine-capture/1', source, artifacts: { ...source, kind: 'typescript-source-inputs' },
    assets: { status: 'measured', files: [asset], bytes: 3, sha256: hashValue([asset]) },
    environment: { runtime: { status: 'measured', name: 'node', version: 'fixture' }, hardware: { status: 'measured', cpuModels: ['fixture'] } } };
  body.identity = manifestIdentity(body);
  return { ...body, contentSha256: hashValue(body) };
}
function fixture({ baselineMs = 10, candidateMs = 5, baselineControl = 10, candidateControl = 10 } = {}) {
  const protocol = makeProtocol({ '--trials': '4', '--steps': '4', '--warmup': '2', '--instances': '1', '--studies': 'bridge' });
  const manifests = { baseline: manifest('reference'), candidate: manifest('candidate') };
  const files = [{ path: 'fixture.mjs', bytes: 4, sha256: sha('code') }];
  const result = { schema: RESULT_SCHEMA, protocol, protocolSha256: hashValue(protocol), manifests,
    identities: { baseline: manifests.baseline.identity, candidate: manifests.candidate.identity },
    harness: { files, sha256: hashValue(files) }, executionOrder: [], samples: [] };
  for (let trial = 0; trial < protocol.trials; trial++) {
    const order = trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    result.executionOrder.push(order);
    for (const side of order) {
      const latency = (side === 'baseline' ? baselineMs : candidateMs) * [1, .99, 1.01, 1.02][trial];
      result.samples.push({ schema: SAMPLE_SCHEMA, status: 'measured', side, trial, pid: 1000 + result.samples.length,
        identity: manifests[side].identity, protocolSha256: result.protocolSha256, harnessSha256: result.harness.sha256,
        runtimeSha256: manifests[side].identity.runtimeSha256, hardwareSha256: manifests[side].identity.hardwareSha256,
        control: { definitionSha256: protocol.controlDefinitionSha256, checksum: sha('unchanged'),
          timingsMs: Array(16).fill(side === 'baseline' ? baselineControl : candidateControl) },
        cases: protocol.cases.map(definition => ({ id: definition.id, definition, scope: protocol.scope,
          quality: { status: 'measured', equivalence: 'exact-per-cycle-snapshot-topology-events', fixedDt: 1 / 120, cols: 37, rows: 4,
            settings: Object.fromEntries(['targetLoad', 'strength', 'damping', 'wind', 'press'].map(key => [key, definition[key]])) },
          workload: { nodes: 148, links: 327, instances: 1 }, outputSha256: sha('same-trajectory'), health: { finite: true, anchors: true },
          timings: Object.fromEntries(METRICS.map((metric, i) => [metric, Array(protocol.steps).fill(latency * [1, .1, .05, 1.15][i])])) })) });
    }
  }
  return result;
}
test('known equal-quality 2x gain retains samples, median/p95, and paired bootstrap intervals', () => {
  const result = checkResult(fixture());
  assert.equal(result.status, 'pass');
  const cycle = result.comparisons.find(c => c.metric === 'cpuCycleMs');
  assert.equal(cycle.speedup.ratio, 2); assert.equal(cycle.speedup.lower95, 2); assert.equal(cycle.speedup.upper95, 2);
  assert.equal(cycle.baseline.cycles.count, 16); assert.ok(cycle.baseline.cycles.p95 > 0); assert.equal(cycle.demonstratedSpeedup, true);
});
test('unchanged control regression rejects an otherwise fast candidate', () => {
  const result = checkResult(fixture({ candidateControl: 15 }));
  assert.equal(result.status, 'fail'); assert.ok(result.regressions.some(r => r.includes('control drift')));
});
test('CPU cycle regression fails its primary and tail budget', () => {
  const result = checkResult(fixture({ candidateMs: 15 }));
  assert.equal(result.status, 'fail'); assert.ok(result.regressions.some(r => r.includes('p95')));
});
test('equal performance can pass no-regression gate without claiming a speedup', () => {
  const result = checkResult(fixture({ candidateMs: 10 }));
  assert.equal(result.status, 'pass'); assert.ok(result.comparisons.every(c => !c.demonstratedSpeedup));
  assert.equal(checkResult(fixture({ candidateMs: 10 }), { minimumSpeedup: 1.1 }).status, 'fail');
});
test('uncertain control drift is inconclusive, never a pass', () => {
  const data = fixture();
  for (const sample of data.samples) if (sample.side === 'candidate') sample.control.timingsMs.fill([6, 9, 11, 16][sample.trial]);
  const result = checkResult(data); assert.equal(result.status, 'inconclusive'); assert.ok(result.uncertain.some(r => r.includes('control')));
});
test('sample source identity/hash mismatch is incomparable', () => {
  const data = structuredClone(fixture()); data.samples[0].identity.sourceSha256 = sha('wrong-source');
  const result = checkResult(data); assert.equal(result.status, 'incomparable'); assert.ok(result.issues.some(i => i.includes('mismatch')));
});
test('manifest inventory tampering is rejected', () => {
  const data = fixture(); data.manifests.baseline.source.files[0].sha256 = sha('tampered');
  assert.equal(checkResult(data).status, 'incomparable');
});
test('missing measured raw values cannot become a pass', () => {
  for (const change of [r => { r.samples = []; }, r => { r.samples[0].cases[0].timings.stepMs = []; }, r => { r.samples[0].status = 'unavailable'; }, r => { r.samples[0].cases[0].timings.cpuCycleMs[0] = NaN; }]) {
    const data = fixture(); change(data); assert.equal(checkResult(data).status, 'incomparable');
  }
});
test('scope, quality, and active workload differences are incomparable', () => {
  for (const change of [c => { c.scope = 'browser-frame'; }, c => { c.quality.settings.wind = 0; }, c => { c.workload.nodes = 74; }, c => { c.quality.status = 'unavailable'; }]) {
    const data = fixture(); change(data.samples.find(s => s.side === 'candidate').cases[0]); assert.equal(checkResult(data).status, 'incomparable');
  }
});
test('a claimed complete cycle cannot omit the measured stage time', () => {
  const data = fixture(); data.samples[0].cases[0].timings.cpuCycleMs.fill(.01);
  assert.equal(checkResult(data).status, 'incomparable');
});
test('physics drift and missing finite/anchor evidence fail closed', () => {
  const drift = fixture(); drift.samples[0].cases[0].outputSha256 = sha('different-trajectory'); assert.equal(checkResult(drift).status, 'fail');
  const anchor = fixture(); anchor.samples[0].cases[0].health.anchors = false; assert.equal(checkResult(anchor).status, 'incomparable');
});
test('runtime identity, balanced order, and isolated process identities are mandatory', () => {
  for (const change of [r => { r.samples[0].runtimeSha256 = sha('another-node'); }, r => { r.executionOrder[1] = ['baseline', 'candidate']; }, r => { r.samples[1].pid = r.samples[0].pid; }, r => { [r.samples[2], r.samples[3]] = [r.samples[3], r.samples[2]]; }]) {
    const data = fixture(); change(data); assert.equal(checkResult(data).status, 'incomparable');
  }
});
test('bootstrap is deterministic and refuses missing/invalid pairs', () => {
  assert.deepEqual(bootstrapRatio([9, 10, 11, 12], [3, 4, 5, 6]), bootstrapRatio([9, 10, 11, 12], [3, 4, 5, 6]));
  assert.throws(() => bootstrapRatio([], [])); assert.throws(() => bootstrapRatio([1, 2], [0, 2]));
});

test('quantized stage zeros remain measured data, while missing/negative or wholly unresolved stages fail', () => {
  const quantized=fixture();
  for(const sample of quantized.samples)sample.cases[0].timings.topologyMs[0]=0;
  assert.equal(checkResult(quantized).status,'pass');
  for(const value of [-1,NaN,null,undefined]) {
    const invalid=fixture();invalid.samples[0].cases[0].timings.topologyMs[0]=value;
    assert.equal(checkResult(invalid).status,'incomparable');
  }
  const unresolved=fixture();unresolved.samples[0].cases[0].timings.topologyMs.fill(0);
  const result=checkResult(unresolved);assert.equal(result.status,'incomparable');
  assert.ok(result.issues.some(issue=>issue.includes('timer resolution')));
});
test('unbounded workload and unbalanced trial requests are rejected before capture', () => {
  for (const args of [{ '--trials': '5' }, { '--instances': '1,2,1000' }, { '--steps': '100000' }, { '--trials': '20', '--steps': '600', '--warmup': '600' }, { '--studies': 'bridge,unknown' }]) assert.throws(() => makeProtocol(args));
});

const modelFixture = `
export const FIXED_DT = 1 / 120;
export class FailureSimulation {
  nodes = [{ p: [0,0,0], rest: [0,0,0] }, { p: [1,0,0], rest: [1,0,0] }];
  links = [{ broken: false }]; faces = [{}]; supports = [0]; events = [];
  config = { cols: 2, rows: 1 }; time = 0; targetLoad = .8; strength = 1; damping = .022; wind = .25;
  constructor(id, press) { this.id = id; this.press = { ...press }; }
  step(dt = FIXED_DT) { this.time += dt; this.nodes[1].p[1] -= this.targetLoad * dt * .001; }
  snapshot() { return { positions: Float32Array.from(this.nodes.flatMap(n => n.p)), broken: new Uint8Array(1),
    strains: new Float32Array(2), punchY: 3.7, response: { time: this.time, load: this.targetLoad, broken: 0 } }; }
  activeIndices() { return [0,1,1]; }
}
`;
async function temporaryFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'box3d-engine-harness-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'input');
  await fs.mkdir(path.join(root, 'src/studio'), { recursive: true }); await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'src/studio/physics.ts'), modelFixture);
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(root, 'public/reference.txt'), 'ref');
  return { root, temporary };
}
test('capture has exact copied source/artifact identities and references assets without copies', async t => {
  const { root, temporary } = await temporaryFixture(t), out = path.join(temporary, 'capture');
  const captured = await captureBaseline({ root, out });
  assert.deepEqual(verifyManifestStructure(captured), []);
  assert.equal(captured.assets.status, 'measured'); assert.equal(captured.environment.gpu.status, 'unavailable');
  assert.equal(await fs.readFile(path.join(out, 'source/src/studio/physics.ts'), 'utf8'), modelFixture);
  await assert.rejects(fs.stat(path.join(out, 'public')), { code: 'ENOENT' });
  await fs.appendFile(path.join(root, 'src/studio/physics.ts'), '\n// concurrent original edit\n');
  assert.equal(await fs.readFile(path.join(out, 'source/src/studio/physics.ts'), 'utf8'), modelFixture);
});
test('existing output, symlink leaf, and source-directory collisions never overwrite', async t => {
  const { root, temporary } = await temporaryFixture(t), out = path.join(temporary, 'capture');
  await captureBaseline({ root, out });
  const original = await fs.readFile(path.join(out, 'manifest.json'));
  await assert.rejects(captureBaseline({ root, out }), /already exists/);
  assert.deepEqual(await fs.readFile(path.join(out, 'manifest.json')), original);
  const link = path.join(temporary, 'linked-capture'); await fs.symlink(out, link);
  await assert.rejects(reserveRunDirectory(link, [root]), /already exists/);
  await assert.rejects(reserveRunDirectory(path.join(root, 'src/new-output'), [root]), /protected input/);
});
test('symbolic source inputs are rejected instead of following mutable external content', async t => {
  const { root, temporary } = await temporaryFixture(t);
  await fs.symlink(path.join(root, 'public/reference.txt'), path.join(root, 'src/linked.txt'));
  await assert.rejects(captureBaseline({ root, out: path.join(temporary, 'capture') }), /Symlink/);
});
test('real subprocess evidence accepts an exact asset archive but rejects changed assets and source tampering', { timeout: 60000 }, async t => {
  const { root, temporary } = await temporaryFixture(t), out = path.join(temporary, 'run');
  // Exercise the documented CLI, outside Node's test-runner process flags/snapshot.
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../scripts/engine-benchmark.mjs', import.meta.url)),
    '--baseline-root', root, '--candidate-root', root, '--out', out, '--trials', '4', '--warmup', '2',
    '--steps', '4', '--instances', '1', '--studies', 'bridge', '--wall-seconds', '60'], { timeout: 60000, maxBuffer: 2 * 1024 ** 2 })
    .catch(error => { assert.ok([1, 2].includes(error.code) && error.stdout.includes('"run"'), error.stderr); });
  const result = JSON.parse(await fs.readFile(path.join(out, 'result.json'), 'utf8'));
  assert.equal(result.samples.length, 8); assert.equal(new Set(result.samples.map(s => s.pid)).size, 8);
  assert.equal(result.sampleFiles.length, 8); assert.equal(result.unmeasured.gpuTime.status, 'unavailable');
  const valid = await verifyRunDirectory(out); assert.notEqual(valid.status, 'incomparable', valid.issues.join('\n'));
  const assetsRoot = path.join(temporary, 'asset-archive');
  await fs.cp(path.join(root, 'public'), assetsRoot, { recursive: true });
  await fs.writeFile(path.join(root, 'public/reference.txt'), 'new asset version');
  const changedAssets = await verifyRunDirectory(out);
  assert.equal(changedAssets.status, 'incomparable');
  assert.ok(changedAssets.issues.some(i => i.includes('referenced asset hash mismatch')));
  assert.deepEqual(await verifyRunDirectory(out, { assetsRoot }), valid);
  await fs.writeFile(path.join(assetsRoot, 'reference.txt'), 'corrupted archive');
  assert.equal((await verifyRunDirectory(out, { assetsRoot })).status, 'incomparable');
  await fs.writeFile(path.join(assetsRoot, 'reference.txt'), 'ref');
  await fs.appendFile(path.join(out, 'candidate/source/src/studio/physics.ts'), '\n// corrupt receipt\n');
  const invalid = await verifyRunDirectory(out, { assetsRoot }); assert.equal(invalid.status, 'incomparable');
  assert.ok(invalid.issues.some(i => i.includes('source snapshot hash mismatch')));
});
