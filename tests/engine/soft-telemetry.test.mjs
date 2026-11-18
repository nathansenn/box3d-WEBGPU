import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync('/private/tmp/box3d-soft-telemetry-');
const require = createRequire(import.meta.url);
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const archive = join(root, 'benchmarks/baselines/engine-100x-20260910-source.tar.gz');

// Each invocation owns its small output directory. Never clear shared test
// builds or rewrite the frozen source/evidence used as the legacy oracle.
after(() => rmSync(temporary, { recursive: true, force: true }));
function compile(sourceRoot, output) {
  execFileSync(process.execPath, [
    compiler, '--target', 'ES2022', '--module', 'CommonJS',
    '--moduleResolution', 'Node', '--strict', '--skipLibCheck',
    '--lib', 'ES2022,DOM,DOM.Iterable', '--rootDir', sourceRoot,
    '--outDir', output, join(sourceRoot, 'src/soft/simulations.ts'),
  ], { cwd: root, stdio: 'pipe' });
  writeFileSync(join(output, 'package.json'), '{"type":"commonjs"}\n');
  return {
    ...require(join(output, 'src/soft/simulations.js')),
    ...require(join(output, 'src/scenes.js')),
    ...require(join(output, 'src/material-demos.js')),
  };
}

let current;
let legacy;
try {
  current = compile(root, join(temporary, 'current'));
  if (existsSync(archive)) {
    const baseline = join(temporary, 'baseline');
    mkdirSync(baseline);
    execFileSync('tar', ['-xzf', archive, '-C', baseline,
      'src/soft', 'src/math.ts', 'src/types.ts', 'src/scenes.ts',
      'src/material-demos.ts', 'src/aaa-improvements.ts',
    ]);
    legacy = compile(baseline, join(temporary, 'legacy'));
  }
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
}

const cases = [
  { name: 'GPU cloth', family: 'cloth', variant: 0 },
  { name: 'tearing cloth', family: 'cloth', variant: 6 },
  { name: 'rope', family: 'rope', variant: 1 },
  { name: 'GPU water', family: 'water', variant: 3 },
  { name: 'material sheet', demo: 'metal-square-punch-forming' },
  { name: 'brittle glass', demo: 'glass-ballistic-off-center', fracture: true },
  { name: 'reinforced concrete', demo: 'concrete-flat-slab-punching', fracture: true },
  { name: 'composite probe', sceneId: 799 },
  { name: 'combined material', demo: 'apex-materials-proving-ground', fracture: true },
];
function sceneFor(library, spec) {
  const scene = spec.demo ? library.sceneForMaterialDemo(spec.demo)
    : spec.sceneId !== undefined ? library.getSceneById(spec.sceneId)
      : library.SCENES.find((candidate) => (
        candidate.family === spec.family && candidate.variant === spec.variant && candidate.mode === 0
      ));
  assert.ok(scene, spec.name);
  return scene;
}
function suiteFor(library, spec, seed = 0x51ced, stress = 1) {
  const suite = new library.SoftSimulationSuite();
  assert.equal(suite.createScene(sceneFor(library, spec), stress, seed), true);
  return suite;
}
function numeric(value) {
  return {
    kind: value.kind, label: value.label, nodeCount: value.nodeCount,
    constraintCount: value.constraintCount, brokenCount: value.brokenCount,
    energy: value.energy, hash: value.hash, frameVersion: value.frameVersion,
    material: value.material == null ? value.material : { ...value.material },
  };
}
function action(suite, tick) {
  if (tick === 1) suite.kick(12);
  if (tick === 5) suite.spawnRain(4, 5, 12);
  if (tick === 9) suite.launchProjectile([0, 14, 0], [2, -20, -1], 0.6);
  if (tick === 13) suite.explode([0, 7, 0], 28, 12);
  if (tick === 17) { suite.setLoadTarget(1.6); suite.materialStrikeAt(0.43, 0.57, 1.7, 1.4); }
  if (tick === 25) suite.releaseLoad();
  if (tick === 29) suite.cycleLoad();
  if (tick === 33) suite.materialStrike(2);
  if (tick === 37) suite.materialStrikeTarget('glass', 1.6);
  if (tick === 41) suite.materialStrikeAtTarget('concrete', 0.58, 0.46, 1.8, 1.3);
  if (tick === 43) suite.dentStrikeTarget('metal', 1.5);
  if (tick === 45) suite.setMaterialLoadTarget('all', 1.2);
  if (tick === 47) suite.releaseMaterialLoad('all');
}
function finiteTelemetry(value) {
  for (const key of ['nodeCount', 'constraintCount', 'brokenCount', 'energy', 'hash', 'frameVersion']) {
    assert.ok(Number.isFinite(value[key]), key);
  }
  for (const [key, entry] of Object.entries(value.material ?? {})) {
    if (typeof entry === 'number') assert.ok(Number.isFinite(entry), `material.${key}`);
  }
}

test('inactive, destroyed and reset suites expose immutable telemetry without a frame build', () => {
  const suite = new current.SoftSimulationSuite();
  const empty = suite.readTelemetry();
  assert.deepEqual(numeric(empty), numeric(suite.buildFrame(false)));
  assert.equal(suite.readTelemetry(), empty);
  assert.ok(Object.isFrozen(empty));
  suite.createScene(current.SCENES.find((scene) => scene.family === 'stack'), 1, 1);
  assert.equal(suite.readTelemetry(), empty);
  const scene = sceneFor(current, cases[0]);
  suite.createScene(scene, 1, 123);
  const initial = suite.readTelemetry();
  suite.step(1 / 60, 1);
  suite.reset();
  assert.deepEqual(suite.readTelemetry(), initial);
  suite.destroy();
  assert.equal(suite.readTelemetry(), empty);
});

function checkTrajectory(oracle, spec, seed, stress, framesEveryTick) {
  const observed = suiteFor(current, spec, seed, stress);
  const expected = suiteFor(oracle, spec, seed, stress);
  const retained = [];
  let maxBroken = 0;
  try {
    for (let tick = 0; tick <= 48; tick++) {
      action(observed, tick);
      action(expected, tick);
      if (tick > 0) {
        const subSteps = [1, 2, 4][tick % 3];
        observed.step(1 / 60, subSteps);
        expected.step(1 / 60, subSteps);
      }
      const reading = observed.readTelemetry();
      assert.equal(observed.readTelemetry(), reading, `${spec.name}: cache at ${tick}`);
      assert.ok(Object.isFrozen(reading));
      if (reading.material) assert.ok(Object.isFrozen(reading.material));
      assert.throws(() => { reading.energy = -1; }, TypeError);
      finiteTelemetry(reading);
      maxBroken = Math.max(maxBroken, reading.brokenCount);
      if (framesEveryTick || tick % 8 === 0) {
        const frame = expected.buildFrame(tick % 16 === 0);
        assert.deepEqual(numeric(reading), numeric(frame), `${spec.name}: telemetry at ${tick}`);
        assert.deepEqual(observed.buildFrame(tick % 16 === 0), frame, `${spec.name}: full frame at ${tick}`);
        assert.equal(observed.hash(), expected.hash(), `${spec.name}: current hash at ${tick}`);
      }
      if (tick % 8 === 0) retained.push([reading, structuredClone(reading)]);
    }
    for (const [reading, original] of retained) assert.deepEqual(reading, original, `${spec.name}: retained snapshot`);
    if (spec.fracture) assert.ok(maxBroken > 0, `${spec.name}: trajectory reached fracture`);
  } finally {
    observed.destroy();
    expected.destroy();
  }
}

for (const spec of cases) {
  test(`${spec.name}: seeded telemetry equals the frame path through loads and fracture actions`, () => {
    checkTrajectory(current, spec, 0x51ced, 1, true);
  });
}

test('frozen pre-change source retains exact frames and hashes with eight fixed steps per presentation', () => {
  assert.ok(legacy, 'The frozen engine-100x source archive is required for the regression oracle.');
  for (const spec of cases) checkTrajectory(legacy, spec, 0xba5e11, 2, false);
});

const presentationMethods = [
  'buildFrame', 'buildSurface', 'rebuildTopology', 'rebuildRopeGridSegments',
  'refreshSegmentMetadata', 'writeRecipeFixtures', 'writePanelSkinTiles',
  'writeFailureAccents', 'writeSheetSkin', 'mergeInstances', 'mergeRopeGrids',
  'mergeDebugLines', 'mergeSheetSurface',
];
const presentationFields = [
  'instanceMatrices', 'instanceColors', 'matrices', 'colors', 'debugLines',
  'indexScratch', 'indices', 'ropeSegmentData', 'segmentData', 'ropePositions',
  'ropeSegments', 'sheetIndices', 'vertices', 'sheetVertices',
  'topologyDirty', 'topologyVersion', 'packedSurfaceFrameVersion',
  'builtFrameVersion', 'builtFrameDebug', 'ropeTopologyVersion',
  'ropeTopologyBrokenSnapshot', 'ropeSegmentCount', 'segmentTopologyVersion',
  'segmentMetadataDirty', 'skinTopologyVersion', 'skinTearSignature',
];
function guardPresentation(simulation, restore, allowLiveHash = false) {
  const snapshots = [];
  for (const child of simulation.children ?? []) snapshots.push(...guardPresentation(child.simulation, restore, true));
  for (const method of presentationMethods) {
    if (typeof simulation[method] !== 'function') continue;
    const original = simulation[method];
    simulation[method] = () => assert.fail(`Telemetry called presentation method ${method}`);
    restore.push(() => { simulation[method] = original; });
  }
  if (!simulation.children) {
    for (const method of ['currentHash', 'updateTelemetry']) {
      if (typeof simulation[method] !== 'function') continue;
      // Combined scenes intentionally use live hashes; their child scans are
      // covered by the separate hash-contract test below.
      if (method === 'currentHash' && allowLiveHash) continue;
      const original = simulation[method];
      simulation[method] = () => assert.fail(`Telemetry triggered a full state scan: ${method}`);
      restore.push(() => { simulation[method] = original; });
    }
    if (!allowLiveHash) {
      for (const field of ['positions', 'previous', 'restPositions', 'invMass', 'eta', 'u', 'v',
        'rest', 'hingeRest', 'damage', 'cellDamage', 'broken']) {
        const original = simulation[field];
        if (!ArrayBuffer.isView(original)) continue;
        simulation[field] = new Proxy(original, {
          get(target, key) {
            if (key === 'length') return target.length;
            assert.fail(`Telemetry scanned geometry field ${field}.${String(key)}`);
          },
        });
        restore.push(() => { simulation[field] = original; });
      }
    }
  }
  const capture = () => structuredClone(Object.fromEntries(presentationFields
    .filter((key) => key in simulation).map((key) => [key, simulation[key]])));
  snapshots.push([capture, capture()]);
  return snapshots;
}

test('telemetry never enters presentation code, rewrites geometry or advances topology versions', () => {
  for (const spec of cases) {
    const suite = suiteFor(current, spec);
    const restore = [];
    try {
      suite.kick(12);
      suite.materialStrike(1.7);
      suite.step(1 / 60, 2);
      const simulation = suite.active;
      const snapshots = guardPresentation(simulation, restore);
      const telemetry = suite.readTelemetry();
      finiteTelemetry(telemetry);
      assert.equal(suite.readTelemetry(), telemetry);
      for (const [capture, original] of snapshots) assert.deepEqual(capture(), original, spec.name);
    } finally {
      for (const reset of restore.reverse()) reset();
      suite.destroy();
    }
  }
});

test('combined live hash runs once per requested version while cloth, rope and water retain their sample cadence', () => {
  for (const spec of cases.slice(0, 4)) {
    const suite = suiteFor(current, spec);
    try {
      const initial = suite.readTelemetry();
      for (let tick = 1; tick <= 11; tick++) {
        suite.step(1 / 60, 1);
        assert.equal(suite.readTelemetry().hash, initial.hash, `${spec.name}: sample cadence at ${tick}`);
      }
      suite.step(1 / 60, 1);
      assert.equal(suite.readTelemetry().hash, suite.hash(), `${spec.name}: scheduled refresh`);
    } finally { suite.destroy(); }
  }
  const suite = suiteFor(current, cases.at(-1));
  try {
    const simulation = suite.active;
    const hash = simulation.currentHash.bind(simulation);
    let scans = 0;
    simulation.currentHash = () => { scans++; return hash(); };
    suite.step(1 / 60, 1);
    assert.equal(scans, 0, 'Stepping does not request the combined frame hash');
    const telemetry = suite.readTelemetry();
    assert.equal(scans, 1);
    assert.equal(telemetry.hash, hash());
    assert.equal(suite.readTelemetry(), telemetry);
    assert.equal(suite.buildFrame(false).hash, telemetry.hash);
    assert.equal(suite.buildFrame(true).hash, telemetry.hash);
    assert.equal(scans, 1, 'Repeated reads and presentation share the same requested hash');
  } finally { suite.destroy(); }
});
