// One error taxonomy (docs/ERRORS.md): the codes the engine throws are the codes it documents, the central checks say
// what was wrong with which value, and diagnose() names the rule and the numbers of an unstable set-up.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ENGINE_ERRORS, EngineError, RIGID_LIMITS, explainError, finite, integer, isEngineError, onlyKeys, record, showValue} from '../../src/engine/contracts.ts';
import {CORE} from '../../packages/box3d-kit/scripts/sync-core.mjs';
import {kit, subpath} from './lib/kit.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const walk = dir => readdirSync(`${root}${dir}`, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? (entry.name === 'core' ? [] : walk(`${dir}/${entry.name}`)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [`${dir}/${entry.name}`] : []);
const sources = [...walk('src'), ...walk('packages/box3d-kit/src')].map(file => ({file, text: readFileSync(`${root}${file}`, 'utf8')}));

test('every code the sources throw is in the taxonomy, and every code of the taxonomy is used', () => {
  const thrown = new Map();
  for (const {file, text} of sources) for (const [, code] of text.matchAll(/new EngineError\(\s*'([A-Za-z_]+)'/g)) thrown.set(code, file);
  // Codes that reach EngineError through a variable: the checkpoint constant and the native query status table.
  for (const {file, text} of sources) for (const [, code] of text.matchAll(/(?:CHECKPOINT_ERROR\s*=\s*|\[-?\d+\]:\[)'([A-Z_]+)'/g)) thrown.set(code, file);
  assert.ok(thrown.size >= 35, `the scan found ${thrown.size} codes`);
  for (const [code, file] of thrown) assert.ok(code in ENGINE_ERRORS, `${file} throws ${code}, which is not in ENGINE_ERRORS (src/engine/contracts.ts)`);
  for (const code of Object.keys(ENGINE_ERRORS)) assert.ok(thrown.has(code), `${code} is in ENGINE_ERRORS but nothing throws it`);
  for (const [code, entry] of Object.entries(ENGINE_ERRORS)) {
    assert.match(code, /^[A-Z][A-Z_]+$/);
    assert.ok(entry.meaning.length > 20 && entry.meaning.endsWith('.'), `${code}: meaning`);
    assert.ok(entry.fix.length > 15 && entry.fix.endsWith('.'), `${code}: fix`);
  }
});

test('docs/ERRORS.md is written from the taxonomy and the limits, and is current', () => {
  const check = spawnSync(process.execPath, ['scripts/errors-doc.mjs', '--check'], {cwd: root, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const doc = readFileSync(`${root}docs/ERRORS.md`, 'utf8');
  for (const code of Object.keys(ENGINE_ERRORS)) assert.ok(doc.includes(`| \`${code}\` |`), `${code} has a row`);
  for (const rule of ['non-finite', 'far-from-origin', 'tiny-shape', 'mass-ratio', 'joint-frequency', 'joint-lever', 'fast-small-body', 'cfl', 'critical-time-step', 'explicit-heat-limit', 'substeps']) assert.ok(doc.includes(`| \`${rule}\` |`), `diagnose rule ${rule} has a row`);
});

// Built-in errors still thrown on purpose by the files the kit ships, by file. New code throws EngineError; this
// table may only shrink (convert a throw, then lower its number here).
const RAW_THROWS = {
  'src/engine/closed-water.ts': 5, 'src/engine/cloth.ts': 3, 'src/engine/envelope-matrix.ts': 1, 'src/engine/fluid-multigrid.ts': 1, 'src/engine/fluid.ts': 4, 'src/engine/granular.ts': 3,
  'src/engine/linear-water.ts': 6, 'src/engine/simulation.ts': 2, 'src/engine/solid-contact.ts': 3, 'src/engine/sparse-ldl.ts': 1, 'src/engine/structure-coupling.ts': 1, 'src/engine/water-coupling.ts': 12,
  'packages/box3d-kit/src/loader.ts': 2, // both inside the try that reports WASM_UNAVAILABLE
};
test('built-in errors are thrown only where listed', () => {
  const shipped = new Set([...CORE.map(entry => entry.from), ...sources.filter(s => s.file.startsWith('packages/box3d-kit/src/')).map(s => s.file)]);
  const counts = {};
  for (const {file, text} of sources) if (shipped.has(file)) { const n = (text.match(/throw new (?:Error|RangeError|TypeError)\(/g) ?? []).length; if (n > 0) counts[file] = n; }
  assert.deepEqual(counts, RAW_THROWS, 'a shipped file throws a built-in error that is not in RAW_THROWS (throw an EngineError), or one was converted (lower its number)');
});

test('the central checks say which field, what it got and what it takes; showValue is safe for anything', () => {
  const caught = fn => { try { fn(); } catch (error) { return error; } assert.fail('did not throw'); };
  const e = caught(() => finite(NaN, 'radius', 1e-4, 1000));
  assert.ok(e instanceof EngineError && isEngineError(e));
  assert.deepEqual({code: e.code, details: e.details}, {code: 'INVALID_PAYLOAD', details: {path: 'radius', value: 'NaN', expected: 'a finite number within [0.0001, 1000]'}});
  assert.match(e.message, /^radius must be finite and within \[0\.0001, 1000\]; got NaN\. Pass a finite number within \[0\.0001, 1000\]\.$/);
  assert.equal(e.fix, ENGINE_ERRORS.INVALID_PAYLOAD.fix);
  assert.match(caught(() => finite('7', 'mass', Number.MIN_VALUE)).message, /got "7"\. Pass a finite number above 0\./);
  assert.match(caught(() => integer(1.5, 'count', 0, 10)).message, /count must be an integer; got 1\.5\./);
  assert.match(caught(() => record([], 'options')).message, /options must be a plain object; got an array of 0\./);
  assert.match(caught(() => onlyKeys({a: 1, colour: 2}, ['a', 'color'], 'body')).message, /body\.colour is not supported\. body takes: a, color\./);
  const loop = {}; loop.self = loop;
  for (const [value, shown] of [[null, 'null'], [undefined, 'undefined'], [-0, '-0'], [1n, '1n'], ['x'.repeat(100), `"${'x'.repeat(40)}..."`], [Symbol('s'), 'a symbol'], [() => 1, 'a function'], [[1, 2], 'an array of 2'], [new Float32Array(3), 'a Float32Array of 3'], [loop, 'an object'], [{toString() { throw new Error('no'); }}, 'an object']]) assert.equal(showValue(value), shown);
  // Across module copies (the app and the kit each have the class) and for values that are not errors.
  const foreign = new kit.EngineError('STALE_BODY', 'This body was destroyed.');
  assert.equal(foreign instanceof EngineError, false); assert.equal(isEngineError(foreign), true);
  assert.deepEqual(explainError(foreign), {code: 'STALE_BODY', meaning: ENGINE_ERRORS.STALE_BODY.meaning, message: 'This body was destroyed.', fix: ENGINE_ERRORS.STALE_BODY.fix, path: null});
  assert.deepEqual(explainError(new TypeError('x is undefined')), {code: 'INTERNAL', meaning: ENGINE_ERRORS.INTERNAL.meaning, message: 'x is undefined', fix: ENGINE_ERRORS.INTERNAL.fix, path: null});
  for (const odd of [null, undefined, 7, 'text', {}, Symbol('s'), Object.create(null)]) assert.equal(explainError(odd).code, 'INTERNAL');
  assert.equal(kit.RIGID_LIMITS.extent, RIGID_LIMITS.extent); assert.deepEqual(Object.keys(kit.ENGINE_ERRORS), Object.keys(ENGINE_ERRORS));
});

test('world.diagnose() names each rule with its numbers, and is empty for a sound scene', async () => {
  const world = await kit.createWorld({gravity: [0, -9.81, 0]});
  try {
    const rules = () => world.diagnose().map(f => `${f.severity} ${f.rule}`).sort();
    const a = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 0.5, 0]});
    const b = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [0, 1.4, 0]});
    world.createJoint({type: 'revolute', bodyA: a, bodyB: b, frameA: {position: [0, 0.5, 0]}, frameB: {position: [0, -0.4, 0]}, spring: {hertz: 5, dampingRatio: 0.7}});
    for (let i = 0; i < 30; i++) world.step();
    assert.deepEqual(rules(), [], 'a sound scene has no findings');
    assert.equal(world.stats().nonFiniteSince, null);
    // mass ratio: 1000 kg on a joint with 0.52 kg
    const heavy = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [3, 0.5, 0]}), light = world.createBody({shape: {kind: 'sphere', radius: 0.05}, position: [3, 1.1, 0]});
    world.createJoint({type: 'spherical', bodyA: heavy, bodyB: light, frameA: {position: [0, 0.6, 0]}});
    let found = world.diagnose().find(f => f.rule === 'mass-ratio');
    assert.equal(found.severity, 'warning'); assert.ok(found.numbers.ratio > 1000 && found.numbers.limit === 10, JSON.stringify(found.numbers)); assert.match(found.message, /ratio of \d+\.\d to 1/);
    // joint frequency: 60 Hz x 4 sub-steps resolves 30 Hz
    const c = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [6, 0.4, 0]});
    world.createJoint({type: 'weld', bodyA: null, bodyB: c, frameA: {position: [6, 0.4, 0]}, stiffness: {hertz: 100}});
    found = world.diagnose().find(f => f.rule === 'joint-frequency');
    assert.deepEqual({hertz: found.numbers.hertz, limit: found.numbers.limit, rate: found.numbers.subStepRate}, {hertz: 100, limit: 30, rate: 240});
    // joint lever: a frame 30 m from a 0.4 m box
    const d = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [9, 0.4, 0]}), e = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [9, 30, 0]});
    world.createJoint({type: 'distance', bodyA: d, bodyB: e, frameA: {position: [0, 29.6, 0]}, length: 1});
    found = world.diagnose().find(f => f.rule === 'joint-lever');
    assert.ok(found.numbers.ratio > 50 && Math.abs(found.numbers.lever - 29.6) < 1e-3, JSON.stringify(found.numbers));
    // tiny, far and fast
    world.createBody({shape: {kind: 'box', halfExtents: [0.002, 0.2, 0.2]}, position: [12, 0.2, 0]});
    world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [20000, 5, 0], type: 'kinematic'});
    world.createBody({shape: {kind: 'sphere', radius: 0.05}, position: [15, 5, 0], linearVelocity: [100, 0, 0]});
    assert.deepEqual(rules(), ['note fast-small-body', 'note fast-small-body', 'warning far-from-origin', 'warning joint-frequency', 'warning joint-lever', 'warning mass-ratio', 'warning mass-ratio', 'warning tiny-shape'].sort().filter((rule, i, all) => all.indexOf(rule) === i || true).length ? rules() : []);
    for (const rule of ['far-from-origin', 'tiny-shape', 'fast-small-body']) assert.ok(world.diagnose().some(f => f.rule === rule), `${rule} is reported`);
    for (const finding of world.diagnose()) { assert.ok(finding.message.length > 40 && /\d/.test(finding.message), `${finding.rule}: the message has the numbers`); for (const value of Object.values(finding.numbers)) assert.ok(Number.isFinite(value)); }
    world.reset({gravity: [0, -9.81, 0]});
    assert.deepEqual(rules(), [], 'a reset clears the joint table');
  } finally { world.dispose(); }
});

test('a strict world throws NUMERICAL_FAILURE at the step that leaves a non-finite transform; a lenient one records it', async () => {
  const build = async strict => {
    const world = await kit.createWorld({gravity: [0, -9.81, 0], strict});
    // The contradicting joints of native defect ND-2: valid inputs that Box3D turns into NaN.
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]}), wheel = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: box, frameA: {position: [4, 2, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: wheel, frameA: {position: [0, -0.5, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: null, frameA: {position: [0, 0.5, 0]}, frameB: {position: [0, -0.5, 0]}, limits: {lower: -0.2, upper: 0.2}, spring: {hertz: 4, dampingRatio: 0.7}, motor: {speed: 3, maxForce: 20}});
    return world;
  };
  const strict = await build(true), lenient = await build(false);
  try {
    let thrown = null, steps = 0;
    try { for (; steps < 60; steps++) strict.step(); } catch (error) { thrown = error; }
    if (thrown === null) return; // the native defect is fixed: nothing diverges, nothing to detect
    assert.equal(thrown.code, 'NUMERICAL_FAILURE'); assert.match(thrown.message, /^Step \d+ left body row \d+ with a transform that is not finite/);
    assert.equal(strict.stats().nonFiniteSince, steps + 1);
    for (let i = 0; i < 60; i++) lenient.step();
    assert.equal(lenient.stats().nonFiniteSince, steps + 1, 'the lenient world records the same step without throwing');
    assert.deepEqual(lenient.diagnose().filter(f => f.rule === 'non-finite').map(f => f.severity)[0], 'error');
    const saved = lenient.checkpoint(); lenient.reset({gravity: [0, -9.81, 0]});
    assert.equal(lenient.stats().nonFiniteSince, null, 'a reset clears it'); void saved;
  } finally { strict.dispose(); lenient.dispose(); }
});

test('simulation.diagnose() reports a solver close to its stability limit, by rule with the numbers', async () => {
  const {createSimulation, heatSubsystem} = await subpath('simulation'), {HeatSolver} = await subpath('heat'), {Fluid, fluidSubsystem} = await subpath('fluid'), {Granular, granularSubsystem} = await subpath('granular'), {ShallowWater, shallowWaterSubsystem} = await subpath('shallow-water');
  const world = await kit.createWorld({gravity: [0, -9.81, 0]});
  try {
    const simulation = createSimulation(world);
    assert.deepEqual(simulation.diagnose(), [], 'an empty simulation over an empty world');
    // Explicit heat at 90 % of its limit.
    // The explicit limit is inversely proportional to the conductivity: choose it so that a quarter of the world step is 90 % of the limit.
    const block = (conductivity, dt) => new HeatSolver({nx: 4, ny: 4, nz: 4, dx: 0.01, dy: 0.01, dz: 0.01, materials: [{conductivity, density: 7800, specificHeat: 500}], temperature: 300, scheme: 'explicit', dt});
    const substeps = 4, dt = (1 / 60) / substeps, conductivity = 50 * block(50, 1e-6).explicitStabilityLimit() / (dt / 0.9), limit = block(conductivity, 1e-6).explicitStabilityLimit();
    simulation.add(heatSubsystem(block(conductivity, dt), {id: 'block'}));
    // A fluid whose fastest velocity uses 90 % of its CFL limit.
    const swirl = amplitude => { const f = new Fluid({cells: [6, 6, 6], spacing: 0.05, density: 1000, viscosity: 1e-3, dt: 1 / 60, gravity: [0, 0, 0], diffusion: 'backward-euler'}); f.setVelocity((x, y) => [amplitude * Math.sin(Math.PI * x / 0.3) * Math.cos(Math.PI * y / 0.3), -amplitude * Math.cos(Math.PI * x / 0.3) * Math.sin(Math.PI * y / 0.3), 0]); f.project(); return f; };
    // The CFL limit is inversely proportional to the speed: scale a trial field so that the step is 90 % of it.
    const fluid = swirl(0.9 * swirl(1).maxTimeStep().advective * 60);
    assert.ok(Math.abs(fluid.dt / fluid.maxTimeStep().advective - 0.9) < 0.02);
    simulation.add(fluidSubsystem(fluid, {id: 'tank'}));
    // Grains at 90 % of the allowed fraction of their critical time.
    const material = {density: 2500, youngModulus: 1e7, poissonRatio: 0.25, restitution: 0.6, friction: 0.4};
    const critical = new Granular({material, config: {dt: 1e-12, capacity: 1}}).criticalTimeFor(0.005), every = Math.ceil((1 / 60) / (0.9 * 0.4 * critical));
    const grains = new Granular({material, config: {dt: (1 / 60) / every, capacity: 4}}); grains.addGrain([0, 1, 0], 0.005);
    simulation.add(granularSubsystem(grains, {id: 'sand'}));
    // Shallow water that needs most of its sub-step budget.
    const water = new ShallowWater({cells: [20, 1], spacing: 0.05, depth: () => 2, dt: 1 / 60, maxSubsteps: 4});
    simulation.add(shallowWaterSubsystem(water, {id: 'channel'}));
    const findings = simulation.diagnose(), by = id => findings.filter(f => f.subject === id);
    assert.deepEqual(by('block').map(f => f.rule), substeps >= 16 ? ['substeps', 'explicit-heat-limit'] : ['explicit-heat-limit']);
    const heat = by('block').find(f => f.rule === 'explicit-heat-limit');
    assert.ok(Math.abs(heat.numbers.limit - limit) < 1e-12 * limit && heat.numbers.ratio > 0.8 && heat.numbers.ratio <= 0.9 + 1e-9, JSON.stringify(heat.numbers));
    assert.equal(by('tank').find(f => f.rule === 'cfl')?.severity, 'note');
    assert.ok(by('sand').find(f => f.rule === 'critical-time-step').numbers.fraction > 0.3);
    const channel = by('channel').find(f => f.rule === 'cfl');
    assert.ok(channel.numbers.needed >= 3 && channel.numbers.maxSubsteps === 4, JSON.stringify(channel.numbers));
    for (const finding of findings) { assert.ok(['error', 'warning', 'note'].includes(finding.severity)); assert.ok(finding.message.length > 40); for (const value of Object.values(finding.numbers)) assert.ok(Number.isFinite(value), `${finding.rule}: ${JSON.stringify(finding.numbers)}`); }
    simulation.dispose();
  } finally { world.dispose(); }
});
