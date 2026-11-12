// Exact checkpoints (docs/CHECKPOINTS.md): Simulation.checkpoint() / restore(), PhysicsWorld.checkpoint() /
// restoreCheckpoint(), resumeSimulation, and RemoteWorld through a worker.
//
// The property is bit-identity. For every example scene (rigid and coupled) and for a coupled set-up of every solver
// family (cloth, grains, volumetric fluid, solid contact, fracture, heat, water, cables and frames): run N steps,
// checkpoint, run M more and take the checkpoint A; in a fresh world (and, for the scenes, a fresh process) resume the
// first checkpoint, run M steps and take B; A and B must be the same bytes. A checkpoint holds every field every solver
// steps from, the rigid world's contact and solver state, the clocks and the event cursors, so equal bytes mean equal
// states. Restoring and checkpointing again must also give the same bytes, and a checkpoint is refused, with nothing
// changed, when it is damaged, of another format version, or from another scene or set-up.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {createWorld} from 'box3d-webgpu-kit';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import {
  createSimulation, loadSimulationScene, resumeSimulation, simulationCheckpointInfo, checkpointInfo, CHECKPOINT_VERSION, CHECKPOINT_ERROR,
  heatSubsystem, thermalSolidLink, solidSubsystem, deadLoadLink,
} from 'box3d-webgpu-kit/simulation';
import {encodeState} from '../dist/core/checkpoint.js';
import {COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, sceneWorldOptions} from 'box3d-webgpu-kit/scene';
import {Cloth, ClothCoupling, clothGrid, clothSubsystem} from 'box3d-webgpu-kit/cloth';
import {Granular, GranularCoupling, granularLattice, granularSubsystem} from 'box3d-webgpu-kit/granular';
import {Fluid, FluidCoupling, FreeSurfaceFluid, fluidSubsystem} from 'box3d-webgpu-kit/fluid';
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';
import {SolidCoupling, solidContactSubsystem} from 'box3d-webgpu-kit/solid-contact';
import {quenchedPlate, fractureSubsystem} from 'box3d-webgpu-kit/fracture';
import {HeatSolver} from 'box3d-webgpu-kit/heat';

const G = 9.81;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const kit = fileURLToPath(new URL('..', import.meta.url));

/** Steps before and after the checkpoint, per scene: long enough that contacts, cracks and settling are under way. */
const STEPS = {
  'pendulum-wave': [240, 240], 'newtons-cradle': [240, 240], 'domino-run': [300, 300], 'terrain-car': [240, 240], ragdoll: [240, 240],
  'moored-buoy': [240, 240], 'cable-stayed-deck': [240, 240], 'buoy-and-crates': [240, 240], trampoline: [120, 120], 'hopper-seesaw': [60, 60],
  'suspended-platform': [240, 240], 'rubber-pad': [90, 90], 'notched-beam': [120, 120], 'quenched-plate': [120, 120], 'heated-bar': [240, 240],
  'sphere-settling': [40, 40], 'cavity-flow': [40, 40], 'flow-past-cylinder': [40, 40], 'dam-break': [90, 90],
};
const SCENES = {...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES};

test('every example scene resumes from a checkpoint bit for bit, in a fresh world', async t => {
  const rows = [];
  for (const [name, make] of Object.entries(SCENES)) {
    const [n, m] = STEPS[name] ?? [120, 120], scene = make();
    const a = await createWorld(sceneWorldOptions(scene)), b = await createWorld(sceneWorldOptions(scene));
    try {
      const run = loadSimulationScene(a, scene);
      for (let i = 0; i < n; i++) run.simulation.step();
      let start = performance.now();
      const saved = run.simulation.checkpoint();
      const saveMs = performance.now() - start;
      for (let i = 0; i < m; i++) run.simulation.step();
      const expected = run.simulation.checkpoint(), hashA = a.exactHash();
      start = performance.now();
      const resumed = resumeSimulation(b, saved);
      const resumeMs = performance.now() - start;
      assert.ok(same(resumed.simulation.checkpoint(), saved), `${name}: restore then checkpoint gives the same bytes`);
      assert.equal(resumed.simulation.tick, n, `${name}: the clock is restored`);
      for (let i = 0; i < m; i++) resumed.simulation.step();
      assert.equal(b.exactHash(), hashA, `${name}: the rigid transforms are bit-identical after ${m} more steps`);
      assert.ok(same(resumed.simulation.checkpoint(), expected), `${name}: the full state is bit-identical after ${m} more steps`);
      rows.push(`${name}: ${saved.length} bytes, save ${saveMs.toFixed(1)} ms, resume ${resumeMs.toFixed(1)} ms`);
      run.simulation.dispose(); resumed.simulation.dispose();
    } finally { a.dispose(); b.dispose(); }
  }
  t.diagnostic(rows.join('\n'));
});

test('a checkpoint resumed in a fresh process continues bit for bit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'box3d-checkpoint-'));
  try {
    const expected = {};
    for (const name of ['domino-run', 'ragdoll', 'moored-buoy', 'trampoline', 'hopper-seesaw', 'rubber-pad', 'quenched-plate', 'sphere-settling', 'dam-break']) {
      const scene = SCENES[name](), world = await createWorld(sceneWorldOptions(scene));
      try {
        const run = loadSimulationScene(world, scene);
        for (let i = 0; i < 60; i++) run.simulation.step();
        writeFileSync(join(dir, `${name}.b3ck`), run.simulation.checkpoint());
        for (let i = 0; i < 60; i++) run.simulation.step();
        expected[name] = checkpointInfo(run.simulation.checkpoint()).hash;
        run.simulation.dispose();
      } finally { world.dispose(); }
    }
    const script = `
      import {readFileSync} from 'node:fs';
      import {createWorld} from 'box3d-webgpu-kit';
      import {resumeSimulation, simulationCheckpointInfo, checkpointInfo} from 'box3d-webgpu-kit/simulation';
      import {normalizeScene, sceneWorldOptions} from 'box3d-webgpu-kit/scene';
      const out = {};
      for (const name of ${JSON.stringify(Object.keys(expected))}) {
        const bytes = new Uint8Array(readFileSync(${JSON.stringify(dir)} + '/' + name + '.b3ck'));
        const scene = normalizeScene(JSON.parse(simulationCheckpointInfo(bytes).scene));
        const world = await createWorld(sceneWorldOptions(scene));
        const run = resumeSimulation(world, bytes);
        for (let i = 0; i < 60; i++) run.simulation.step();
        out[name] = checkpointInfo(run.simulation.checkpoint()).hash;
        world.dispose();
      }
      console.log(JSON.stringify(out));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd: kit, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)), expected);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

// ---------------------------------------------------------------------------------------------------
// One coupled set-up per solver family, built by a function so that a fresh world gets the same one.
// ---------------------------------------------------------------------------------------------------

const HZ = 240, DT = 1 / HZ;
const newWorld = (gravity = [0, -G, 0], step = DT) => createWorld({step, subSteps: 4, ground: true, gravity});

const SETUPS = {
  async cloth(world) {
    const n = 8, side = 0.6, grid = clothGrid({nx: n, ny: n, u: [side, 0, 0], v: [0, 0, -side], origin: [-side / 2, 0.5, side / 2], diagonal: 'alternate'});
    const cloth = new Cloth({positions: grid.positions, triangles: grid.triangles, pinned: [grid.node(0, 0), grid.node(n, 0), grid.node(0, n), grid.node(n, n)],
      material: {arealDensity: 0.3, youngModulus: 2e6, thickness: 1e-3, poissonRatio: 0.3, bendingStiffness: 2e-4}, config: {dt: DT, gravity: [0, -G, 0], drag: 1}, selfCollision: {thickness: 3e-3}});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0.05, 0.75, 0.02], density: 400, neverSleeps: true});
    const weight = world.createBody({shape: {kind: 'box', halfExtents: [0.04, 0.04, 0.04]}, position: [0, 0.5 - 0.04, -side / 2], density: 500, neverSleeps: true});
    const coupling = new ClothCoupling(world, cloth);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.1}, friction: 0.4});
    coupling.addBody(weight, {shape: {kind: 'box', halfExtents: [0.04, 0.04, 0.04]}, collide: false});
    coupling.attach(grid.node(n / 2, n), weight);
    return createSimulation(world).add(clothSubsystem(coupling)).trackBody(ball, {kind: 'sphere', radius: 0.1});
  },
  async grains(world) {
    const lattice = granularLattice({min: [-0.06, 0.02, -0.06], max: [0.06, 0.1, 0.06], radius: 0.008, jitter: 0.2, seed: 3});
    const g = new Granular({material: {density: 2500, restitution: 0.5, friction: 0.5, youngModulus: 1e6, poissonRatio: 0.3},
      config: {dt: DT / 8, capacity: lattice.count, gravity: [0, -G, 0], law: 'hertz'}});
    g.addWall({shape: {kind: 'box', halfExtents: [0.2, 0.01, 0.2]}, type: 'static', position: [0, -0.01, 0], friction: 0.5});
    g.addGrains(lattice.positions, lattice.radii);
    const block = world.createBody({shape: {kind: 'box', halfExtents: [0.04, 0.02, 0.04]}, position: [0.01, 0.2, 0], density: 1500, neverSleeps: true});
    const coupling = new GranularCoupling(world, g);
    coupling.addBody(block, {shape: {kind: 'box', halfExtents: [0.04, 0.02, 0.04]}});
    return createSimulation(world).add(granularSubsystem(coupling)).trackBody(block, {kind: 'box', halfExtents: [0.04, 0.02, 0.04]});
  },
  async fluid(world) {
    const fluid = new Fluid({cells: [10, 12, 10], spacing: 0.01, density: 1000, viscosity: 0.05, dt: world.loop.step, gravity: [0, -G, 0], diffusion: 'crank-nicolson', boundaries: {yMax: 'free-slip'}});
    fluid.addObstacle({shape: {kind: 'box', halfExtents: [0.02, 0.01, 0.03]}, position: [0.05, 0.02, 0.05], rotation: [0, 0.2588190451, 0, 0.9659258263]});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.015}, position: [0.08, 0.08, 0.075], density: 4000, neverSleeps: true});
    const coupling = new FluidCoupling(world, fluid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.015}});
    return createSimulation(world).add(fluidSubsystem(coupling));
  },
  async 'solid-contact'(world) {
    const solid = new SolidBody({mesh: boxMesh({size: [0.2, 0.2, 0.2], cells: [4, 4, 4]}), material: {youngModulus: 5e5, poissonRatio: 0.3, density: 1000}, config: {model: 'corotational', dt: DT, tolerance: 1e-12}});
    const radius = 0.05;
    const ball = world.createBody({shape: {kind: 'sphere', radius}, position: [0.2 + radius + 0.02, 0.13, 0.08], density: 3 / (4 / 3 * Math.PI * radius ** 3), linearVelocity: [-2, -0.4, 0.3], neverSleeps: true});
    const coupling = new SolidCoupling(world, solid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius}, friction: 0.4});
    return createSimulation(world).add(solidContactSubsystem(coupling)).trackBody(ball, {kind: 'sphere', radius});
  },
  async fracture(world) {
    const plate = quenchedPlate({dt: world.loop.step});
    return createSimulation(world).add(heatSubsystem(plate.heat)).add(thermalSolidLink(plate.heat, plate.body, {reference: plate.reference})).add(fractureSubsystem(plate.body));
  },
  async 'heat-solid'(world) {
    const solid = new SolidBody({mesh: boxMesh({size: [0.3, 0.05, 0.05], cells: [6, 1, 1]}), material: {youngModulus: 7e10, poissonRatio: 0.33, density: 2700, thermalExpansion: 2.3e-5}, config: {model: 'linear', dt: world.loop.step}});
    solid.constrain(solid.selectNodes(x => x < 1e-9), [0, 0, 0]);
    const heat = new HeatSolver({nx: 6, ny: 1, nz: 1, dx: 0.05, dy: 0.05, dz: 0.05, materials: [{conductivity: 237, density: 2700, specificHeat: 900}], temperature: 300, dt: world.loop.step / 2,
      boundaries: [{face: 'x-', type: 'temperature', temperature: 500}, {face: 'x+', type: 'convection', coefficient: 50, ambient: 290}]});
    const body = world.createBody({shape: {kind: 'box', halfExtents: [0.05, 0.05, 0.05]}, type: 'static', position: [0.3, 0.5, 0]});
    return createSimulation(world).add(heatSubsystem(heat)).add(thermalSolidLink(heat, solid, {reference: 300})).add(solidSubsystem(solid))
      .add(deadLoadLink(body, solid, {faces: solid.selectFaces((cx, cy, cz, nx, ny) => ny > 0.99)}));
  },
};
const SETUP_STEPS = {cloth: [100, 60], grains: [60, 40], fluid: [15, 15], 'solid-contact': [120, 60], fracture: [230, 60], 'heat-solid': [80, 80]};
const SETUP_WORLD = {fluid: () => newWorld([0, -G, 0], 1 / 120), fracture: () => newWorld([0, -G, 0], 2e-3)};

test('a coupled set-up of every solver family resumes bit for bit', async t => {
  const rows = [];
  for (const [name, build] of Object.entries(SETUPS)) {
    const [n, m] = SETUP_STEPS[name], make = SETUP_WORLD[name] ?? (() => newWorld());
    const a = await make(), b = await make();
    try {
      const simA = await build(a), events = {a: [], b: []};
      simA.onEvent(e => { if (e.source !== 'world') events.a.push(`${e.tick}:${e.source}:${e.type}`); });
      for (let i = 0; i < n; i++) simA.step();
      const saved = simA.checkpoint();
      for (let i = 0; i < m; i++) simA.step();
      const expected = simA.checkpoint();
      const simB = await build(b);
      simB.onEvent(e => { if (e.source !== 'world') events.b.push(`${e.tick}:${e.source}:${e.type}`); });
      simB.restore(saved);
      assert.ok(same(simB.checkpoint(), saved), `${name}: restore then checkpoint gives the same bytes`);
      for (let i = 0; i < m; i++) simB.step();
      assert.equal(b.exactHash(), a.exactHash(), `${name}: rigid transforms`);
      assert.ok(same(simB.checkpoint(), expected), `${name}: the full state is bit-identical after ${m} more steps`);
      assert.deepEqual(events.b, events.a.filter(e => Number(e.split(':')[0]) > n), `${name}: the same events after the checkpoint`);
      rows.push(`${name}: ${saved.length} bytes, ${simA.subsystems().map(s => s.kind).join(', ')}; events before ${events.a.filter(e => Number(e.split(':')[0]) <= n).length}, after ${events.b.length}`);
      simA.dispose(); simB.dispose();
    } finally { a.dispose(); b.dispose(); }
  }
  t.diagnostic(rows.join('\n'));
});

test('the free-surface fluid restores its particles, grid, viscosity, obstacles and time step exactly', () => {
  const options = {cells: [16, 12, 1], spacing: 0.01, density: 1000, dt: 0.002, gravity: [0, -G, 0], viscosity: 0.05, walls: 'no-slip'};
  const make = () => {
    const f = new FreeSurfaceFluid(options);
    f.addLiquid((x, y) => x < 0.06 && y < 0.08);
    f.addObstacle({shape: {kind: 'box', halfExtents: [0.01, 0.015, 0.02]}, position: [0.11, 0.015, 0.005]});
    return f;
  };
  const a = make(), b = make();
  for (let i = 0; i < 20; i++) a.step();
  // Changed between steps, so that the checkpoint must carry them.
  a.setTimeStep(0.0015); a.moveObstacle(0, [0.105, 0.015, 0.005], [-0.2, 0, 0]);
  for (let i = 0; i < 10; i++) a.step();
  const saved = a.saveState();
  for (let i = 0; i < 30; i++) a.step();
  b.restoreState(saved);
  assert.equal(b.dt, 0.0015);
  for (let i = 0; i < 30; i++) b.step();
  assert.deepEqual(b.obstacleForce(0), a.obstacleForce(0));
  assert.ok(same(encodeState(b.saveState()), encodeState(a.saveState())), 'every field');
  assert.ok(same(new Uint8Array(b.p.buffer.slice(0)), new Uint8Array(a.p.buffer.slice(0))), 'pressure');
  assert.ok(same(new Uint8Array(b.positions.buffer.slice(0)), new Uint8Array(a.positions.buffer.slice(0))), 'particles');
});

test('a checkpoint is refused, with nothing changed, when it is damaged, of another version, or from another scene', async () => {
  const scene = COUPLED_EXAMPLE_SCENES['moored-buoy'](), world = await createWorld(sceneWorldOptions(scene));
  const other = EXAMPLE_SCENES['domino-run'](), otherWorld = await createWorld(sceneWorldOptions(other));
  try {
    const run = loadSimulationScene(world, scene);
    for (let i = 0; i < 30; i++) run.simulation.step();
    const saved = run.simulation.checkpoint(), info = simulationCheckpointInfo(saved);
    assert.equal(info.version, CHECKPOINT_VERSION);
    assert.equal(info.tick, 30);
    assert.deepEqual(info.subsystems.map(s => s.id), ['structure', 'basin']);
    assert.match(info.hash, /^[0-9a-f]{64}$/);
    const refused = (bytes, target, pattern) => {
      const before = target.simulation.checkpoint();
      assert.throws(() => target.simulation.restore(bytes), error => error.code === CHECKPOINT_ERROR && pattern.test(error.message));
      assert.ok(same(target.simulation.checkpoint(), before), 'nothing changed');
    };
    // Another scene: a world built from the domino run.
    const domino = loadSimulationScene(otherWorld, other);
    refused(saved, domino, /taken from another scene/);
    // A damaged file: one bit flipped in the body.
    const damaged = saved.slice(); damaged[damaged.length - 100] ^= 1;
    refused(damaged, run, /damaged/);
    // Another format version.
    const future = saved.slice(); new DataView(future.buffer).setUint32(4, CHECKPOINT_VERSION + 1, true);
    refused(future, run, /format version 2.*reads version 1/);
    // Not a checkpoint, a truncated one, and a world checkpoint where a simulation one is expected.
    refused(new Uint8Array(64), run, /not a box3d checkpoint/);
    refused(saved.subarray(0, saved.length - 1), run, /truncated/);
    refused(world.checkpoint(), run, /checkpoint of a world, not of a simulation/);
    // The same scene with a different set-up: one subsystem removed.
    run.simulation.remove('basin');
    assert.throws(() => run.simulation.restore(saved), error => error.code === CHECKPOINT_ERROR && /subsystems/.test(error.message));
    domino.simulation.dispose(); run.simulation.dispose();
  } finally { world.dispose(); otherWorld.dispose(); }
});

test('a world checkpoint restores in place, keeps body handles and the fixed-step accumulator', async () => {
  const make = async () => {
    const world = await createWorld({step: 1 / 120, subSteps: 4, gravity: [0, -G, 0]});
    const bodies = [];
    for (let i = 0; i < 12; i++) bodies.push(world.createBody({shape: {kind: i % 3 === 0 ? 'sphere' : 'box', radius: 0.2, halfExtents: [0.2, 0.15, 0.25]}, position: [0.05 * i, 0.4 + 0.45 * i, 0.03 * i], density: 500}));
    const hinge = world.createJoint({type: 'revolute', bodyA: null, bodyB: bodies[11], frameA: {position: [0.55, 6, 0.33]}, frameB: {position: [0, 0.6, 0]}});
    return {world, bodies, hinge};
  };
  const a = await make(), b = await make();
  try {
    for (let i = 0; i < 80; i++) a.world.update(1 / 100);
    // A body made after the build: the checkpoint has one row more than the world it is restored into.
    const extra = a.world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [2, 3, 0], linearVelocity: [0, 0, 1], density: 800});
    for (let i = 0; i < 10; i++) a.world.update(1 / 100);
    const tick = a.world.tick, saved = a.world.checkpoint();
    for (let i = 0; i < 90; i++) a.world.update(1 / 100);
    b.world.restoreCheckpoint(saved);
    assert.equal(b.world.tick, tick);
    for (let i = 0; i < 90; i++) b.world.update(1 / 100);
    assert.equal(b.world.tick, a.world.tick);
    assert.equal(b.world.exactHash(), a.world.exactHash());
    for (let i = 0; i < 12; i++) assert.deepEqual(b.world.getState(b.bodies[i]), a.world.getState(a.bodies[i]));
    assert.equal(b.world.bodyCount(), a.world.bodyCount());
    assert.deepEqual(b.world.getState(b.world.bodyAt(a.world.native.bodyIndex(extra))), a.world.getState(extra), 'the added body, found by its row');
    assert.deepEqual(b.world.getJointState(b.hinge), a.world.getJointState(a.hinge));
  } finally { a.world.dispose(); b.world.dispose(); }
});

test('RemoteWorld checkpoints and restores the world in its worker', async () => {
  const worker = new Worker(new URL('./fixtures/physics.worker.mjs', import.meta.url));
  const remote = await connectWorld(worker, {sharedMemory: false, gravity: [0, -G, 0], step: 1 / 120});
  try {
    for (let i = 0; i < 20; i++) await remote.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [0.07 * i, 0.3 + 0.42 * i, 0], density: 300});
    for (let i = 0; i < 60; i++) await remote.stepOnce();
    const saved = await remote.checkpoint();
    assert.equal(checkpointInfo(saved).kind, 'world');
    for (let i = 0; i < 60; i++) await remote.stepOnce();
    const hash = await remote.exactHash();
    await remote.restoreCheckpoint(saved);
    for (let i = 0; i < 60; i++) await remote.stepOnce();
    assert.equal(await remote.exactHash(), hash);
    assert.equal(remote.bodyCount(), 21);
  } finally { await remote.dispose(); }
});
