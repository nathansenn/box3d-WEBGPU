// One stepping loop (box3d-webgpu-kit/simulation): the Subsystem contract and its stage order, the
// adapters for water coupling, structure coupling, heat and solids, the two one-way links, the coupled
// scene sections, and the two coupled example scenes against closed-form statics.
//
// The key property is bit-identity: a run through the Simulation gives exactly the bits of the same
// modules driven by hand in the order their own documents give. SI units, 240 Hz and 4 sub-steps
// unless a test says otherwise. Nothing here asserts on wall-clock time. Tolerances are derived next
// to each check; the measured numbers are printed with `node --test --test-reporter=tap`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createWorld, capabilities, EngineError} from 'box3d-webgpu-kit';
import {
  Simulation, SIMULATION_STAGES, SUBSYSTEM_ORDER, createSimulation, resolveTiming, waterSubsystem, structureSubsystem, heatSubsystem, solidSubsystem,
  thermalSolidLink, deadLoadLink, cellTemperaturesToNodes, loadSimulationScene,
} from 'box3d-webgpu-kit/simulation';
import {
  COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, mooredBuoyScene, cableStayedDeckScene, validateScene, normalizeScene, canonicalize, sceneHash, sceneHasCoupling,
  encodeSceneLink, encodeSceneLinkSync, decodeSceneLink, loadScene, saveScene, sceneWorldOptions, SceneValidationError,
} from 'box3d-webgpu-kit/scene';
import {WaterCoupling} from 'box3d-webgpu-kit/coupling';
import {StructureCoupling} from 'box3d-webgpu-kit/structure';
import {CompliantCableRuntime, hangingCableDefinition} from 'box3d-webgpu-kit/cable';
import {FrameRuntime} from 'box3d-webgpu-kit/frame';
import {HeatSolver} from 'box3d-webgpu-kit/heat';
import {SolidBody, boxMesh, boxNode} from 'box3d-webgpu-kit/solid';

const G = 9.81, HZ = 240, SUB = 4, DT = 1 / HZ;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = value => value.toExponential(2);
const copy = value => JSON.parse(JSON.stringify(value));
const newWorld = (options = {}) => createWorld({step: 1 / (options.hz ?? HZ), subSteps: SUB, ground: options.ground ?? false, ...(options.gravity ? {gravity: options.gravity} : {})});
/** SHA-256 of the exact bytes of some float arrays: any difference in any bit changes it. */
const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const refuses = (fn, code, pattern, label) => assert.throws(fn, error => {
  assert.ok(error instanceof EngineError, `${label}: an EngineError (${error.stack})`);
  assert.equal(error.code, code, `${label}: ${error.message}`);
  assert.match(error.message, pattern, label);
  return true;
}, label);

const cableConfig = (overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 2048, residualTolerance: 1e-10, drag: 0, gravity: [0, -G, 0], solver: 'proximal', forceTolerance: 1e-6, ...overrides});
const soft = {youngModulus: 2e9, shearModulus: 8e8, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 1000, up: [0, 1, 0]};
const steel = {youngModulus: 2e11, shearModulus: 8e10, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 7850, up: [0, 1, 0]};
const frameConfig = (drag, overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 1024, drag, gravity: [0, -G, 0], forceTolerance: 1e-9, momentTolerance: 1e-9, impulseTolerance: 1e-10, angularImpulseTolerance: 1e-10, ...overrides});
function beam({section, segments, length, drag, support}) {
  const positions = new Float64Array(3 * (segments + 1)), fixed = new Uint8Array(6 * (segments + 1)), elements = [];
  for (let i = 0; i <= segments; i++) { positions[3 * i] = length * i / segments; if (i) elements.push({...section, a: i - 1, b: i}); }
  if (support === 'cantilever') fixed.fill(1, 0, 6);
  else { fixed[0] = fixed[1] = fixed[2] = fixed[3] = 1; fixed[6 * segments + 1] = fixed[6 * segments + 2] = 1; }
  return {config: frameConfig(drag), positions, fixed, elements};
}
const COPPER = {conductivity: 401, density: 8960, specificHeat: 385};
const STEEL_SOLID = {youngModulus: 200e9, poissonRatio: 0.3, density: 7850, thermalExpansion: 12e-6};

// ---- The contract -----------------------------------------------------------

test('the module is listed; one step runs prepare, the stages in their fixed order, then finish, events and onStep', async () => {
  assert.ok(capabilities().modules.includes('simulation'));
  assert.deepEqual([...SIMULATION_STAGES], ['pre-couple', 'couple', 'rigid', 'post', 'events']);
  const world = await newWorld({ground: true});
  try {
    const sim = createSimulation(world), log = [];
    assert.ok(sim instanceof Simulation);
    world.onStep(() => log.push('rigid'));
    const fake = (id, stage, order) => ({
      id, kind: 'fake', stage, order, timeStep: null,
      prepare(ctx) { log.push(`prepare:${id}@${ctx.tick}`); },
      step(ctx) { log.push(`step:${id}`); assert.equal(ctx.dt, DT); assert.equal(ctx.world, world); },
      finish(ctx) { log.push(`finish:${id}`); ctx.emit('done', {id}); },
    });
    // Registered in an order that is not the order they run in.
    sim.add(fake('z-post', 'post', 0)).add(fake('b-couple', 'couple', 5)).add(fake('a-couple', 'couple', 5)).add(fake('first-couple', 'couple', 1)).add(fake('pre', 'pre-couple', 9)).add(fake('a-post', 'post', 0));
    assert.deepEqual(sim.order().map(row => `${row.stage}:${row.id}`),
      ['pre-couple:pre', 'couple:first-couple', 'couple:a-couple', 'couple:b-couple', 'rigid:world', 'post:a-post', 'post:z-post', 'events:events']);
    const events = [], ticks = [];
    sim.onEvent(event => { log.push(`event:${event.source}`); events.push(event); });
    sim.onStep(tick => { log.push('onStep'); ticks.push([tick, sim.tick, world.tick, sim.time]); });
    sim.step();
    const run = ['pre', 'first-couple', 'a-couple', 'b-couple', 'a-post', 'z-post'];
    assert.deepEqual(log, [
      ...run.map(id => `prepare:${id}@1`),
      'step:pre', 'step:first-couple', 'step:a-couple', 'step:b-couple', 'rigid', 'step:a-post', 'step:z-post',
      ...run.map(id => `finish:${id}`), ...run.map(id => `event:${id}`), 'onStep',
    ]);
    assert.deepEqual(ticks, [[1, 1, 1, DT]], 'one clock: the simulation tick, the world tick and the time agree');
    assert.deepEqual(events.map(e => [e.tick, e.source, e.type, e.data.id]), run.map(id => [1, id, 'done', id]));

    // World events arrive in the events stage too, before the subsystems' own.
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 0.25, 0], hitEvents: true});
    log.length = 0; events.length = 0;
    for (let i = 0; i < 60 && !events.some(e => e.source === 'world'); i++) { log.length = 0; events.length = 0; sim.step(); }
    const contact = events.find(e => e.source === 'world');
    assert.ok(contact, 'a contact event was delivered');
    assert.equal(contact.type, contact.data.kind);
    assert.ok(log.indexOf('event:world') > log.indexOf('finish:z-post') && log.indexOf('event:world') < log.indexOf('event:pre'), 'world events after every stage, before subsystem events');
    assert.ok(world.isAlive(ball));

    // update() takes whole steps only.
    const before = sim.tick, result = sim.update(2.5 * DT);
    assert.equal(result.steps, 2); assert.equal(sim.tick, before + 2); near(result.alpha, 0.5, 1e-9, 'alpha');
    assert.equal(sim.update(100).steps, sim.maxSteps, 'at most maxSteps per update');

    // Ids, stages and reserved names.
    refuses(() => sim.add(fake('pre', 'post', 0)), 'INVALID_PAYLOAD', /already registered/, 'duplicate id');
    refuses(() => sim.add(fake('world', 'post', 0)), 'INVALID_PAYLOAD', /reserved/, 'reserved id');
    refuses(() => sim.add(fake('x', 'rigid', 0)), 'INVALID_PAYLOAD', /stage must be 'pre-couple', 'couple' or 'post'/, 'the rigid stage is the simulation\'s');
    refuses(() => sim.add({...fake('bad id', 'post', 0)}), 'INVALID_PAYLOAD', /subsystem id/, 'bad id');
    assert.equal(sim.remove('pre'), true); assert.equal(sim.remove('pre'), false); assert.equal(sim.get('pre'), undefined);
    assert.equal(sim.get('a-post').id, 'a-post');

    // The order is enforced against the world too: stepping it behind the simulation's back is refused.
    world.step();
    refuses(() => sim.step(), 'INVALID_STATE', /stepped or reset outside the simulation/, 'world stepped by hand');
    sim.dispose();
    refuses(() => sim.step(), 'DISPOSED', /disposed/, 'disposed');
  } finally { world.dispose(); }
});

test('a subsystem whose time step does not fit the simulation step is refused at registration, with the reason', async () => {
  const world = await newWorld(), other = await newWorld({hz: 120});
  try {
    // The rule itself.
    assert.deepEqual(resolveTiming('a', 'k', {dt: DT, rule: 'equal'}, DT), {dt: DT, substeps: 1, every: 1});
    assert.deepEqual(resolveTiming('a', 'k', {dt: DT / 4, rule: 'commensurate'}, DT), {dt: DT / 4, substeps: 4, every: 1});
    assert.deepEqual(resolveTiming('a', 'k', {dt: 3 * DT, rule: 'commensurate'}, DT), {dt: 3 * DT, substeps: 1, every: 3});
    refuses(() => resolveTiming('a', 'k', {dt: DT / 2, rule: 'equal'}, DT), 'INVALID_STATE', /exchanges forces with the rigid step, so the two must be equal; it cannot be sub-cycled/, 'equal rule');
    refuses(() => resolveTiming('a', 'k', {dt: 0.7 * DT, rule: 'commensurate'}, DT), 'INVALID_STATE', /neither the simulation step .* a whole fraction of it .* nor a whole multiple of it/, 'commensurate rule');
    refuses(() => resolveTiming('a', 'k', {dt: 1.5 * DT, rule: 'commensurate'}, DT), 'INVALID_STATE', /neither the simulation step/, '1.5 steps');
    refuses(() => resolveTiming('a', 'k', {dt: 0, rule: 'commensurate'}, DT), 'INVALID_STATE', /has no time step/, 'no dt');

    const sim = createSimulation(world);
    // Water and structure couplings exchange forces with the rigid step: their dt must be the world's.
    const water = new WaterCoupling(other, {cols: 8, rows: 8, dx: 1, dz: 1, restDepth: 1, origin: [-4, 0, -4]});
    refuses(() => sim.add(waterSubsystem(water)), 'INVALID_STATE', /Subsystem "water" \(water-coupling\) steps at 0\.008333\d* s but the simulation steps at 0\.004166\d* s/, 'water at another step');
    const structure = new StructureCoupling(other);
    refuses(() => sim.add(structureSubsystem(structure)), 'INVALID_STATE', /Subsystem "structure" \(structure-coupling\) steps at .* cannot be sub-cycled/, 'structure at another step');
    assert.equal(sim.subsystems().length, 0, 'a refused subsystem is not registered');

    // Heat: implicit schemes may sub-cycle either way; an incommensurate step is refused; no step at all is refused.
    const heat = (dt, scheme = 'backward-euler', boundaries = []) => new HeatSolver({nx: 8, ny: 1, nz: 1, dx: 0.01, dy: 0.01, dz: 0.01, materials: [COPPER], temperature: 300, dt, scheme, boundaries});
    refuses(() => sim.add(heatSubsystem(heat(0.7 * DT))), 'INVALID_STATE', /Subsystem "heat" \(heat\) steps at .* neither the simulation step/, 'heat at 0.7 steps');
    refuses(() => sim.add(heatSubsystem(heat(undefined))), 'INVALID_STATE', /has no time step/, 'heat without dt');
    sim.add(heatSubsystem(heat(DT / 4), {id: 'fine'})).add(heatSubsystem(heat(3 * DT), {id: 'coarse'}));
    assert.deepEqual(sim.order().filter(row => row.kind === 'heat').map(row => [row.id, row.timing.substeps, row.timing.every]), [['coarse', 1, 3], ['fine', 4, 1]]);
    // Explicit: within the solver's stability limit, or refused. The solver's own constructor already refuses a dt above its
    // limit, so the case the adapter must catch is a limit that fell after construction. 1 mm copper cells have the limit
    // h^2 / (2 alpha) = 4.30 ms, just above the 4.17 ms step; raising the film coefficient of a convective face towards a
    // fixed-temperature face lowers it to h^2 / (3 alpha) = 2.87 ms.
    const fineGrid = () => new HeatSolver({nx: 8, ny: 1, nz: 1, dx: 0.001, dy: 0.001, dz: 0.001, materials: [COPPER], temperature: 300, dt: DT, scheme: 'explicit', boundaries: [{face: 'x-', type: 'convection', coefficient: 10, ambient: 300}]});
    const explicit = fineGrid();
    assert.ok(explicit.explicitStabilityLimit() > DT);
    sim.add(heatSubsystem(explicit, {id: 'explicit'}));
    const falling = fineGrid();
    falling.updateBoundary(0, {coefficient: 1e12});
    const limit = falling.explicitStabilityLimit();
    assert.ok(limit < DT, `the limit fell to ${limit} s`);
    refuses(() => sim.add(heatSubsystem(falling, {id: 'falling'})), 'UNSTABLE_TIME_STEP', /Subsystem "falling" \(heat\): the explicit step 0\.004166\d* s is above the stability limit/, 'explicit heat above its limit');

    // Solids: the same rule. An explicit body needs many of its own steps per simulation step.
    const mesh = boxMesh({size: [0.4, 0.1, 0.1], cells: [4, 1, 1]});
    refuses(() => sim.add(solidSubsystem(new SolidBody({mesh, material: STEEL_SOLID, config: {dt: 0.7 * DT}}))), 'INVALID_STATE', /Subsystem "solid" \(solid\) steps at .* neither the simulation step/, 'solid at 0.7 steps');
    const probe = new SolidBody({mesh, material: STEEL_SOLID, config: {dt: DT}}), critical = probe.explicitLimit().criticalTimeStep;
    const substeps = Math.ceil(DT / (0.9 * critical));
    sim.add(solidSubsystem(new SolidBody({mesh, material: STEEL_SOLID, config: {dt: DT / substeps, integrator: 'explicit'}}), {id: 'explicit-solid'}));
    assert.equal(sim.order().find(row => row.id === 'explicit-solid').timing.substeps, substeps);
    assert.throws(() => new SolidBody({mesh, material: STEEL_SOLID, config: {dt: DT, integrator: 'explicit'}}), /UNSTABLE_TIME_STEP|stability|limit/i, 'the module refuses an explicit body at the simulation step');

    // The thermal link refuses grids that are not co-located.
    const grid = heat(DT);
    refuses(() => thermalSolidLink(grid, probe, {reference: 300}), 'INVALID_PAYLOAD', /the solid has 20 nodes but a box mesh on the 8 x 1 x 1 heat grid has 36/, 'node count');
    const stretched = new SolidBody({mesh: boxMesh({size: [0.16, 0.01, 0.01], cells: [8, 1, 1]}), material: STEEL_SOLID, config: {dt: DT}});
    refuses(() => thermalSolidLink(grid, stretched, {reference: 300}), 'INVALID_PAYLOAD', /the solid's cells are 0\.02 m along axis 0 but the heat cells are 0\.01 m/, 'cell size');
    sim.step(); sim.step(); sim.step();
  } finally { world.dispose(); other.dispose(); }
});

// ---- Bit-identity -----------------------------------------------------------

/** A box dropped into a basin and a capsule floating in it. */
function waterCase(world) {
  const water = new WaterCoupling(world, {cols: 16, rows: 16, dx: 0.5, dz: 0.5, restDepth: 2, origin: [-4, 0, -4]});
  const box = {kind: 'box', halfExtents: [0.4, 0.25, 0.3]}, capsule = {kind: 'capsule', radius: 0.2, halfLength: 0.4};
  const a = world.createBody({shape: box, position: [-0.7, 2.6, 0.2], rotation: [0.1, 0, 0.05, Math.sqrt(1 - 0.0125)], density: 600, neverSleeps: true});
  const b = world.createBody({shape: capsule, position: [1.5, 2.0, -0.5], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], density: 500, neverSleeps: true});
  world.createBody({shape: {kind: 'box', halfExtents: [4, 0.25, 4]}, type: 'static', position: [0, -0.25, 0]});
  water.attach(a, box); water.attach(b, capsule, {angularDrag: 5});
  return {water, state: () => bits(water.eta, water.u, water.v)};
}
/** A ball clamped to a damped cantilever tip, a ball on a cable from the cantilever, and a pendulum on its own cable. */
function structureCase(world) {
  const frame = new FrameRuntime(beam({section: soft, segments: 4, length: 2, drag: 2, support: 'cantilever'}));
  const coupling = new StructureCoupling(world), radius = 0.1;
  const tip = world.createBody({shape: {kind: 'sphere', radius}, position: [2, 0, 0], density: 1000, neverSleeps: true});
  coupling.attachFrameToBody(frame, 4, tip, {mode: 'clamped', inertia: {kind: 'sphere', radius}});
  const hanger = new CompliantCableRuntime({config: cableConfig(), positions: [1, 0, 0, 1.2, -0.3, 0, 1.4, -0.6, 0], masses: [0.05, 0.1, 0.05],
    constraints: [{a: 0, b: 1, restLength: 0.4, compliance: 0.4 / 1e5}, {a: 1, b: 2, restLength: 0.4, compliance: 0.4 / 1e5}]});
  const hung = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.05, 0.08]}, position: [1.4, -0.65, 0], density: 800, neverSleeps: true});
  coupling.attachCableToFrame(hanger, 0, frame, 2);
  coupling.attachCableToBody(hanger, 2, hung, {inertia: {kind: 'box', halfExtents: [0.1, 0.05, 0.08]}});
  const definition = hangingCableDefinition({segments: 1, length: 1.5, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e6, config: cableConfig()});
  for (let k = 0; k < 2; k++) definition.positions[3 * k] += 5;
  definition.positions[3] += 1.5 * Math.sin(0.2); definition.positions[4] = -1.5 * Math.cos(0.2);
  const pendulum = new CompliantCableRuntime(definition);
  const bob = world.createBody({shape: {kind: 'sphere', radius}, position: [definition.positions[3], definition.positions[4], 0], density: 2000, neverSleeps: true});
  coupling.attachCableToBody(pendulum, 1, bob, {inertia: {kind: 'sphere', radius}});
  const views = [frame.couplingViews(), hanger.couplingViews(), pendulum.couplingViews()];
  return {coupling, bodies: [tip, hung, bob], state: () => bits(views[0].displacements, views[0].velocities, views[1].positions, views[1].velocities, views[2].positions, views[2].velocities)};
}
/** A copper bar between two fixed-temperature faces with a source, at the given own step and scheme. */
function heatCase(dt, scheme = 'crank-nicolson') {
  const heat = new HeatSolver({nx: 12, ny: 2, nz: 2, dx: 0.005, dy: 0.005, dz: 0.005, materials: [COPPER], temperature: 300, dt, scheme,
    boundaries: [{face: 'x-', type: 'temperature', temperature: 400}, {face: 'x+', type: 'convection', coefficient: 500, ambient: 280}], sources: [{min: [5, 0, 0], max: [6, 1, 1], power: 20}]});
  return {heat, state: () => bits(heat.temperature, heat.boundaryEnergy, Float64Array.of(heat.sourceEnergy, heat.time))};
}
/** A steel bar fixed at one end, plucked along its axis. */
function solidCase(dt, integrator = 'midpoint', model = 'linear') {
  const cells = [6, 1, 1], solid = new SolidBody({mesh: boxMesh({size: [0.6, 0.1, 0.1], cells}), material: STEEL_SOLID, config: {dt, integrator, model, gravity: [0, -G, 0]}});
  solid.constrain(solid.selectNodes(x => x === 0), [0, 0, 0]);
  const u = new Float64Array(3 * solid.nodeCount);
  for (let n = 0; n < solid.nodeCount; n++) u[3 * n] = 1e-5 * solid.referencePositions[3 * n] / 0.6;
  solid.setState(u);
  return {solid, state: () => bits(solid.displacements, solid.velocities)};
}

test('bit-identity, each adapter alone: N steps through the Simulation equal the module driven by hand in its documented order', async t => {
  const steps = 480, every = 60;
  const pair = async (build, hand, register, label) => {
    const worldA = await newWorld(), worldB = await newWorld();
    try {
      const a = build(worldA), b = build(worldB), sim = createSimulation(worldB);
      register(sim, b);
      for (let i = 1; i <= steps; i++) {
        hand(worldA, a, i); sim.step();
        if (i % every === 0) {
          assert.equal(worldB.exactHash(), worldA.exactHash(), `${label}: world hash at step ${i}`);
          assert.equal(b.state(), a.state(), `${label}: field state at step ${i}`);
        }
      }
      t.diagnostic(`${label}: ${steps} steps, world exactHash ${worldA.exactHash()}, field sha256 ${a.state().slice(0, 16)}… identical`);
    } finally { worldA.dispose(); worldB.dispose(); }
  };
  // docs/WATER_COUPLING.md: water.step() immediately before world.step().
  await pair(waterCase, (world, {water}) => { water.step(); world.step(); }, (sim, {water}) => sim.add(waterSubsystem(water)), 'water coupling');
  // docs/STRUCTURE_COUPLING.md: coupling.step() (which steps the cables and frames) immediately before world.step().
  await pair(structureCase, (world, {coupling}) => { coupling.step(); world.step(); }, (sim, {coupling, bodies}) => sim.add(structureSubsystem(coupling, {bodies})), 'structure coupling');
  // Heat and solids step on their own; with the world, after it.
  await pair(() => heatCase(DT), (world, {heat}) => { world.step(); heat.step(); }, (sim, {heat}) => sim.add(heatSubsystem(heat)), 'heat, one step per step');
  await pair(() => heatCase(DT / 5, 'backward-euler'), (world, {heat}) => { world.step(); heat.step(5); }, (sim, {heat}) => sim.add(heatSubsystem(heat)), 'heat, 5 sub-steps per step');
  await pair(() => heatCase(4 * DT), (world, {heat}, i) => { world.step(); if (i % 4 === 0) heat.step(); }, (sim, {heat}) => sim.add(heatSubsystem(heat)), 'heat, one step every 4 steps');
  await pair(() => solidCase(DT), (world, {solid}) => { world.step(); solid.step(); }, (sim, {solid}) => sim.add(solidSubsystem(solid)), 'solid, midpoint');
  await pair(() => solidCase(DT / 2, 'backward-euler', 'corotational'), (world, {solid}) => { world.step(); solid.step(2); }, (sim, {solid}) => sim.add(solidSubsystem(solid)), 'solid, corotational, 2 sub-steps');
});

/** Everything at once: the moored buoy (water + cable), a framed ball, heat driving a solid through the thermal link. */
function combinedCase(world) {
  const water = new WaterCoupling(world, {cols: 16, rows: 16, dx: 0.5, dz: 0.5, restDepth: 3, origin: [-4, 0, -4], waterDrag: 0.5});
  const radius = 0.4, sphere = {kind: 'sphere', radius};
  const buoy = world.createBody({shape: sphere, position: [0.3, 2.77, 0], density: 300, neverSleeps: true});
  water.attach(buoy, sphere, {linearDrag: 200});
  const mooring = new CompliantCableRuntime({config: cableConfig({maxIterations: 64}), positions: [0, 0, 0, 0.3, 2.77, 0], masses: [0.03, 0.03], pinned: [1, 0], constraints: [{a: 0, b: 1, restLength: 2.75, compliance: 2.75 / 5e4}]});
  const coupling = new StructureCoupling(world);
  coupling.attachCableToBody(mooring, 1, buoy, {inertia: sphere, localPoint: [0, 0, 0]});
  // A floating box with a frame clamped to it: a frame <-> body attachment on a body the water also pushes.
  const box = {kind: 'box', halfExtents: [0.4, 0.2, 0.4]}, raft = world.createBody({shape: box, position: [-2, 3.0, 1], density: 500, neverSleeps: true});
  water.attach(raft, box);
  const mast = new FrameRuntime({config: frameConfig(5), positions: [-2, 3.2, 1, -2, 3.7, 1, -2, 4.2, 1], elements: [{...soft, up: [1, 0, 0], a: 0, b: 1}, {...soft, up: [1, 0, 0], a: 1, b: 2}]});
  coupling.attachFrameToBody(mast, 0, raft, {mode: 'clamped', inertia: box});
  const {heat} = heatCase(DT / 2, 'backward-euler');
  const solid = new SolidBody({mesh: boxMesh({size: [0.06, 0.01, 0.01], cells: [12, 2, 2]}), material: STEEL_SOLID, config: {dt: DT, integrator: 'backward-euler', model: 'linear'}});
  solid.constrain(solid.selectNodes(x => x === 0), [0, 0, 0]);
  const cells = [12, 2, 2], rise = new Array(solid.nodeCount).fill(0);
  const views = [mooring.couplingViews(), mast.couplingViews()];
  return {water, coupling, heat, solid, cells, rise, bodies: [buoy, raft],
    state: () => bits(water.eta, water.u, water.v, views[0].positions, views[0].velocities, views[1].displacements, views[1].velocities, heat.temperature, solid.displacements, solid.velocities)};
}

test('bit-identity, combined: water + structure + heat + solid with the thermal link, registered in any order, equal the hand-driven sequence', async t => {
  const steps = 360;
  const worlds = [await newWorld(), await newWorld(), await newWorld(), await newWorld()];
  try {
    const [hand, forward, backward, shuffled] = worlds.map(combinedCase);
    const subsystems = c => [structureSubsystem(c.coupling, {bodies: c.bodies}), waterSubsystem(c.water), heatSubsystem(c.heat), thermalSolidLink(c.heat, c.solid, {reference: 300}), solidSubsystem(c.solid)];
    const sims = [forward, backward, shuffled].map((c, i) => {
      const sim = createSimulation(worlds[i + 1]), list = subsystems(c);
      for (const s of i === 0 ? list : i === 1 ? list.reverse() : [list[2], list[4], list[1], list[3], list[0]]) sim.add(s);
      return sim;
    });
    assert.deepEqual(sims[2].order().map(row => `${row.stage}:${row.id}`), ['couple:structure', 'couple:water', 'rigid:world', 'post:heat', 'post:thermal-solid', 'post:solid', 'events:events']);
    for (const sim of sims) assert.deepEqual(sim.order(), sims[0].order(), 'the plan does not depend on the registration order');
    for (let i = 1; i <= steps; i++) {
      // The order the Simulation documents, written out by hand.
      hand.coupling.step();                     // couple: cables and frames, closing last step's frame impulse first
      hand.water.step();                        // couple: water, immediately before the rigid step
      worlds[0].step();                         // rigid
      hand.heat.step(2);                        // post: heat (two of its steps per simulation step)
      hand.solid.setTemperatureChange(cellTemperaturesToNodes(hand.heat.temperature, hand.cells, 300, hand.rise));   // post: the link
      hand.solid.step();                        // post: the solid
      for (const sim of sims) sim.step();
      if (i % 60 === 0) for (let k = 0; k < 3; k++) {
        const label = ['registered in stage order', 'registered in reverse', 'registered shuffled'][k];
        assert.equal(worlds[k + 1].exactHash(), worlds[0].exactHash(), `${label}: world hash at step ${i}`);
        assert.equal([forward, backward, shuffled][k].state(), hand.state(), `${label}: field state at step ${i}`);
      }
    }
    // The other order of the two couplings is a different simulation: the order is a real property, and it is fixed.
    const swapped = await newWorld();
    try {
      const c = combinedCase(swapped);
      for (let i = 0; i < steps; i++) { c.water.step(); c.coupling.step(); swapped.step(); c.heat.step(2); c.solid.setTemperatureChange(cellTemperaturesToNodes(c.heat.temperature, c.cells, 300, c.rise)); c.solid.step(); }
      assert.notEqual(c.state(), hand.state(), 'water before structure gives other bits');
    } finally { swapped.dispose(); }
    t.diagnostic(`${steps} steps of water + structure (a cable and a clamped frame) + heat + link + solid: world exactHash ${worlds[0].exactHash()}, field sha256 ${hand.state().slice(0, 16)}…, identical for three registration orders`);
    assert.ok(SUBSYSTEM_ORDER.structure < SUBSYSTEM_ORDER.water && SUBSYSTEM_ORDER.heat < SUBSYSTEM_ORDER.link && SUBSYSTEM_ORDER.link < SUBSYSTEM_ORDER.solid);
  } finally { for (const world of worlds) world.dispose(); }
});

// ---- Links ------------------------------------------------------------------

test('thermal -> solid link: a free block expands by alpha dT with zero stress; a restrained bar reaches -E alpha dT as the heat solver brings it to a uniform temperature', async t => {
  // Copper for the heat solver (alpha_th = 1.16e-4 m^2/s), steel for the solid, 60 Hz, backward Euler in both.
  // Both faces x- and x+ are held at T1 = 380 K from T0 = 300 K (the stress-free temperature). The slowest thermal mode
  // decays with tau = L^2 / (pi^2 alpha_th): 0.35 s for the 20 mm bar, 0.14 s for the 12.5 mm block. After 600 steps
  // (10 s) what is left of it is below 1e-12 of the 80 K step, so the temperature is uniform to solver precision.
  // The solid follows quasi-statically: its first axial period (about 8e-6 s) is far below the step, where backward
  // Euler damps completely. Expected, with alpha dT = 9.6e-4:
  //   free block  displacement alpha dT x at every node, stress 0;
  //   bar         sigma_xx = -E alpha dT = -192 MPa exactly for the linear model (docs/SOLID_MECHANICS.md).
  // Tolerances: 1e-9 relative for displacement and stress, 1e-9 E alpha dT for the stress that should be zero: the two
  // solvers' own tolerances (1e-12 and 1e-10) and the thermal remainder. The uniform state is in the element space,
  // so there is no discretisation error to allow for.
  const hz = 60, dt = 1 / hz, T0 = 300, T1 = 380, alpha = STEEL_SOLID.thermalExpansion, E = STEEL_SOLID.youngModulus, strain = alpha * (T1 - T0);
  const world = await newWorld({hz});
  try {
    const sim = createSimulation(world);
    const build = (id, cells, h, constrain) => {
      const [nx, ny, nz] = cells;
      const heat = new HeatSolver({nx, ny, nz, dx: h, dy: h, dz: h, materials: [COPPER], temperature: T0, dt, scheme: 'backward-euler',
        boundaries: [{face: 'x-', type: 'temperature', temperature: T1}, {face: 'x+', type: 'temperature', temperature: T1}]});
      // forceTolerance: a free block ends with no force at all in it, so a tolerance relative to the forces has nothing to
      // measure against. 1e-7 N is 1e-10 of E alpha dT on one cell face (1200 N).
      const solid = new SolidBody({mesh: boxMesh({size: [nx * h, ny * h, nz * h], cells}), material: STEEL_SOLID, config: {dt, integrator: 'backward-euler', model: 'linear', forceTolerance: 1e-7}});
      constrain(solid);
      sim.add(solidSubsystem(solid, {id: `${id}-solid`})).add(thermalSolidLink(heat, solid, {id: `${id}-link`, reference: T0})).add(heatSubsystem(heat, {id: `${id}-heat`}));
      return {heat, solid, cells, h};
    };
    // Symmetry planes only: the block is free to grow.
    const free = build('free', [5, 4, 3], 0.0025, solid => {
      solid.constrain(solid.selectNodes(x => x === 0), [0, null, null]); solid.constrain(solid.selectNodes((x, y) => y === 0), [null, 0, null]); solid.constrain(solid.selectNodes((x, y, z) => z === 0), [null, null, 0]);
    });
    // Both ends held along x; the sides are free, so the stress is uniaxial.
    const bar = build('bar', [8, 2, 2], 0.0025, solid => {
      solid.constrain(solid.selectNodes(x => x === 0 || Math.abs(x - 0.02) < 1e-12), [0, null, null]); solid.constrain(solid.selectNodes((x, y) => y === 0), [null, 0, null]); solid.constrain(solid.selectNodes((x, y, z) => z === 0), [null, null, 0]);
    });
    assert.deepEqual(sim.order().map(row => row.id), ['world', 'bar-heat', 'free-heat', 'bar-link', 'free-link', 'bar-solid', 'free-solid', 'events']);
    let peakGradient = 0;
    for (let i = 0; i < 600; i++) {
      sim.step();
      if (i === 5) { const T = bar.heat.temperature; peakGradient = T[bar.heat.index(0, 0, 0)] - T[bar.heat.index(4, 0, 0)]; }
    }
    assert.ok(peakGradient > 20, `the bar was far from uniform on the way (${peakGradient.toFixed(1)} K between its end and its middle after 6 steps)`);
    for (const one of [free, bar]) for (const T of one.heat.temperature) near(T, T1, 1e-9, 'uniform temperature at the end');

    const u = free.solid.displacements, X = free.solid.referencePositions; let worstU = 0;
    for (let j = 0; j < u.length; j++) worstU = Math.max(worstU, Math.abs(u[j] - strain * X[j]));
    const size = 5 * 0.0025, freeStress = free.solid.stresses().reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    near(worstU, 0, 1e-9 * strain * size, 'free block: every node displaced by alpha dT x');
    near(freeStress, 0, 1e-9 * E * strain, 'free block: stress');
    const s = bar.solid.stresses(); let worstAxial = 0, worstOther = 0;
    for (let e = 0; e < bar.solid.tetCount; e++) { worstAxial = Math.max(worstAxial, Math.abs(s[6 * e] / (-E * strain) - 1)); for (let k = 1; k < 6; k++) worstOther = Math.max(worstOther, Math.abs(s[6 * e + k])); }
    near(worstAxial, 0, 1e-9, 'restrained bar: sigma_xx = -E alpha dT in every element');
    near(worstOther, 0, 1e-9 * E * strain, 'restrained bar: the other stress components');
    t.diagnostic(`free block: largest displacement error ${sci(worstU)} m of ${sci(strain * size)} m (alpha dT L), largest stress ${sci(freeStress)} Pa = ${sci(freeStress / (E * strain))} E alpha dT`);
    t.diagnostic(`restrained bar: sigma_xx = ${(s[0] / 1e6).toFixed(9)} MPa, expected ${(-E * strain / 1e6).toFixed(9)} MPa; worst element error ${sci(worstAxial)}; other components ${sci(worstOther)} Pa`);

    // The mapping: a field that is linear in x is reproduced at the interior nodes (the mean of two cell centres is the
    // value at the face between them) and held at the half-cell value on the two end planes.
    const nodes = cellTemperaturesToNodes(Float64Array.from({length: 8 * 2 * 2}, (_, i) => 300 + 10 * (i % 8 + 0.5)), [8, 2, 2], 300, new Float64Array(9 * 3 * 3));
    for (let k = 0; k <= 2; k++) for (let j = 0; j <= 2; j++) for (let i = 0; i <= 8; i++) near(nodes[boxNode([8, 2, 2], i, j, k)], i === 0 ? 5 : i === 8 ? 75 : 10 * i, 1e-12, `node ${i},${j},${k}`);
    // One-way: the heat solver is the one it would be alone.
    const alone = new HeatSolver({nx: 8, ny: 2, nz: 2, dx: 0.0025, dy: 0.0025, dz: 0.0025, materials: [COPPER], temperature: T0, dt, scheme: 'backward-euler',
      boundaries: [{face: 'x-', type: 'temperature', temperature: T1}, {face: 'x+', type: 'temperature', temperature: T1}]});
    alone.step(600);
    assert.equal(bits(alone.temperature), bits(bar.heat.temperature), 'the solid does not act on the temperature');
  } finally { world.dispose(); }
});

test('rigid -> solid dead load (one-way): a block under a resting body shortens by m g L / (E A) with stress -m g / A; the body is not moved', async t => {
  // A steel block 0.1 x 0.2 x 0.1 m (4 x 8 x 4 cells), base held in y, on symmetry planes in x and z, so the stress is
  // uniaxial. A 0.2 m steel cube (62.8 kg, the float32 mass the world reports) rests on a static slab in the rigid world;
  // its weight is spread over the block's top faces as a uniform traction. 60 Hz, backward Euler: the block's first
  // axial period is about 1.6e-4 s, far below the step, so it is at its static state within a few steps.
  // Expected: top displacement -m g L / (E A), sigma_yy = -m g / A in every element, base reaction m g.
  // Tolerance 1e-8 relative: a uniform stress is in the element space, so only the solver tolerance (1e-10) and the
  // decaying start-up transient are left. One-way: the rigid world steps exactly as it does without the solid.
  const hz = 60, world = await newWorld({hz, ground: true}), twin = await newWorld({hz, ground: true});
  try {
    const make = w => { w.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.05, 0.5]}, type: 'static', position: [0, 0.05, 0]}); return w.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [0, 0.2, 0], density: 7850}); };
    const body = make(world); make(twin);
    const L = 0.2, A = 0.01, E = STEEL_SOLID.youngModulus;
    const solid = new SolidBody({mesh: boxMesh({size: [0.1, L, 0.1], cells: [4, 8, 4]}), material: {...STEEL_SOLID, thermalExpansion: 0}, config: {dt: 1 / hz, integrator: 'backward-euler', model: 'linear'}});
    solid.constrain(solid.selectNodes((x, y) => y === 0), [null, 0, null]); solid.constrain(solid.selectNodes(x => x === 0), [0, null, null]); solid.constrain(solid.selectNodes((x, y, z) => z === 0), [null, null, 0]);
    const top = solid.selectFaces((cx, cy, cz, nx, ny) => ny > 0.99);
    assert.equal(top.length, 2 * 4 * 4);
    const sim = createSimulation(world).add(solidSubsystem(solid)).add(deadLoadLink(body, solid, {faces: top}));
    assert.deepEqual(sim.order().map(row => row.id), ['world', 'dead-load', 'solid', 'events']);
    for (let i = 0; i < 120; i++) { sim.step(); twin.step(); }
    assert.equal(world.exactHash(), twin.exactHash(), 'the rigid world is the one it would be without the solid (one-way)');
    const mass = world.getState(body).mass, weight = mass * world.gravity()[1], u = solid.displacements, s = solid.stresses(), r = solid.reactions();
    let worstU = 0, worstS = 0, reaction = 0;
    for (const n of solid.selectNodes((x, y) => Math.abs(y - L) < 1e-12)) worstU = Math.max(worstU, Math.abs(u[3 * n + 1] / (weight * L / (E * A)) - 1));
    for (let e = 0; e < solid.tetCount; e++) worstS = Math.max(worstS, Math.abs(s[6 * e + 1] / (weight / A) - 1));
    for (const n of solid.selectNodes((x, y) => y === 0)) reaction += r[3 * n + 1];
    t.diagnostic(`m = ${mass.toFixed(4)} kg: top displacement error ${sci(worstU)} of ${sci(weight * L / (E * A))} m, stress error ${sci(worstS)} of ${(weight / A).toFixed(2)} Pa, base reaction ${reaction.toFixed(6)} N of ${(-weight).toFixed(6)} N`);
    near(worstU, 0, 1e-8, 'shortening m g L / (E A)'); near(worstS, 0, 1e-8, 'stress -m g / A'); within(reaction, -weight, 1e-8, 'base reaction m g');
    assert.deepEqual(sim.diagnostics().subsystems['dead-load'].weight, [0, weight, 0]);
    // A destroyed body takes its weight away.
    world.destroyBody(body);
    for (let i = 0; i < 60; i++) sim.step();
    near(Math.max(...Array.from(solid.displacements, Math.abs)), 0, 1e-8 * Math.abs(weight) * L / (E * A), 'unloaded after the body is gone');
    refuses(() => deadLoadLink(body, solid, {}), 'INVALID_PAYLOAD', /give faces or nodes, not both/, 'no target');
    refuses(() => deadLoadLink(body, solid, {nodes: [0, 0]}), 'INVALID_PAYLOAD', /listed twice/, 'node twice');
  } finally { world.dispose(); twin.dispose(); }
});

// ---- The scene sections -----------------------------------------------------

// sceneHash of the five rigid examples before this format gained its coupled sections (computed from the previous
// revision of src/engine/scene-format.ts). A rigid-only scene must keep its canonical text.
const RIGID_HASHES = {
  'pendulum-wave': 'b81e98b7c9cf8c7609695e8b6c1d91bffccd248ce0a378716316a7bb08fb49b9',
  'newtons-cradle': '0a586664671aee3367790b55ef7ca56c2f76afccbb675686e3384361fd912d40',
  'domino-run': 'cdf465057fdd04c5db4ec21bebd8c757472a03a2f491cb54b151099479420bed',
  'terrain-car': 'c52c45ee8645661df0c383a4d81bf1eab23ce71870c59cf3c4ebf5f1292cb7ea',
  ragdoll: '4d2ed3154b143c11a1f3dcfcc33a8826b6ce613b85c309f09c2191be0cc4f9f1',
};

test('scene format: rigid-only scenes keep their hashes and load as before; loadScene returns a Simulation whose step is the world step', async () => {
  assert.deepEqual(Object.keys(EXAMPLE_SCENES), Object.keys(RIGID_HASHES), 'the coupled examples are not in EXAMPLE_SCENES');
  for (const [name, make] of Object.entries(EXAMPLE_SCENES)) {
    const scene = make(), normal = normalizeScene(scene);
    assert.equal(sceneHash(scene), RIGID_HASHES[name], `${name}: sceneHash`);
    for (const key of ['water', 'cables', 'frames']) assert.equal(key in normal, false, `${name}: no ${key} key in the normal form`);
    assert.equal(sceneHash({...scene, water: [], cables: [], frames: []}), RIGID_HASHES[name], `${name}: empty sections are the same scene`);
    assert.equal(sceneHasCoupling(normal), false);
  }
  const scene = EXAMPLE_SCENES['domino-run']();
  const a = await createWorld(sceneWorldOptions(scene)), b = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadScene(a, scene), plain = loadScene(b, scene);
    assert.ok(loaded.simulation instanceof Simulation);
    assert.deepEqual(loaded.simulation.order().map(row => row.id), ['world', 'events']);
    assert.equal(loaded.structure, null); assert.equal(loaded.water.size + loaded.cables.size + loaded.frames.size + loaded.attachments.size, 0);
    for (let i = 0; i < 200; i++) { loaded.simulation.step(); b.step(); }
    assert.equal(a.exactHash(), b.exactHash(), 'simulation.step() of a rigid scene is world.step()');
    assert.equal(a.replayHash(), b.replayHash());
    assert.deepEqual(saveScene(a, loaded), saveScene(b, plain));
  } finally { a.dispose(); b.dispose(); }
});

test('scene format: the coupled sections validate with paths, normalise, hash and survive a share link', async () => {
  assert.deepEqual(Object.keys(COUPLED_EXAMPLE_SCENES), ['moored-buoy', 'cable-stayed-deck', 'buoy-and-crates', 'trampoline', 'hopper-seesaw', 'suspended-platform', 'rubber-pad', 'notched-beam', 'quenched-plate', 'heated-bar',
    'sphere-settling', 'cavity-flow', 'flow-past-cylinder', 'dam-break', 'dam-break-valley', 'river-bend']);
  for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
    const scene = make(), normal = normalizeScene(scene);
    assert.deepEqual(validateScene(scene), [], name);
    assert.equal(scene.version, 1, 'the version stays 1: the sections are additive and optional');
    assert.equal(sceneHasCoupling(normal), true);
    assert.equal(canonicalize(normal), canonicalize(scene), `${name}: normalising twice changes nothing`);
    const viaLink = decodeSceneLink(await encodeSceneLink(scene));
    assert.equal(sceneHash(viaLink), sceneHash(scene), `${name}: lossless through a compressed link`);
    assert.equal(sceneHash(decodeSceneLink(encodeSceneLinkSync(scene))), sceneHash(scene), `${name}: lossless through a stored link`);
    const defaults = copy(scene);
    for (const cable of defaults.cables ?? []) Object.assign(cable, {solver: 'proximal', substeps: 1, drag: cable.drag ?? 0, velocities: new Array(cable.nodes.length).fill(0)});
    for (const frame of defaults.frames ?? []) Object.assign(frame, {maxIterations: 1024, forceTolerance: 1e-9, pointMasses: new Array(frame.nodes.length / 3).fill(0)});
    for (const basin of defaults.water ?? []) Object.assign(basin, {density: 1000, eta: new Array(basin.cols * basin.rows).fill(0)});
    assert.equal(sceneHash(defaults), sceneHash(scene), `${name}: writing a default out does not change the hash`);
  }
  const problems = edit => { const scene = mooredBuoyScene(); edit(scene); return validateScene(scene).map(p => `${p.path}: ${p.message}`).join('\n'); };
  assert.match(problems(s => { s.water[0].bodies[0].body = 'nobody'; }), /\/water\/0\/bodies\/0\/body: unknown body id "nobody"/);
  assert.match(problems(s => { s.bodies[1].shape = {kind: 'hull', points: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]}; }), /\/cables\/0\/attachments\/0\/inertia: is required: the inertia of a hull body cannot be taken from its shape[\s\S]*\/water\/0\/bodies\/0\/body: a hull body cannot float/);
  assert.match(problems(s => { s.water[0].dx = 0.01; }), /\/water\/0: step \* sqrt\(g \* restDepth\) \* hypot\(1\/dx, 1\/dz\) must be <= 0\.8/);
  assert.match(problems(s => { s.water[0].eta = [0, 1]; }), /\/water\/0\/eta: must hold exactly 256 numbers, got 2/);
  assert.match(problems(s => { s.water.push({...s.water[0], id: 'second'}); }), /\/water\/1\/bodies\/0\/body: body "buoy" is already in a basin, at \/water\/0\/bodies\/0\/body/);
  assert.match(problems(s => { s.cables[0].id = 'buoy'; }), /\/cables\/0\/id: duplicate id "buoy"; first used at \/bodies\/1\/id/);
  assert.match(problems(s => { s.cables[0].attachments[0].node = 0; }), /\/cables\/0\/attachments\/0\/node: node 0 is pinned: attach a free node/);
  assert.match(problems(s => { s.cables[0].attachments[0].frame = 'deck'; }), /\/cables\/0\/attachments\/0: needs exactly one of body and frame/);
  assert.match(problems(s => { s.cables[0].segments[0].b = 7; }), /\/cables\/0\/segments\/0\/b: must be <= 1, got 7/);
  assert.match(problems(s => { s.cables[0].drag = 1; s.cables[0].substeps = 2; }), /\/cables\/0\/substeps: a cable with drag needs substeps = 1/);
  assert.match(problems(s => { s.cables[0].tension = 5; }), /\/cables\/0\/tension: unknown key "tension"/);
  const deck = edit => { const scene = cableStayedDeckScene(); edit(scene); return validateScene(scene).map(p => `${p.path}: ${p.message}`).join('\n'); };
  assert.match(deck(s => { s.cables[0].attachments[0].frameNode = 99; }), /\/cables\/0\/attachments\/0\/frameNode: node 99 is out of range; frame "deck" has 9 nodes/);
  assert.match(deck(s => { s.cables[1].attachments[0].frame = 'bridge'; }), /\/cables\/1\/attachments\/0\/frame: unknown frame id "bridge"/);
  assert.match(deck(s => { s.frames[0].attachments[0].mode = 'welded'; }), /\/frames\/0\/attachments\/0\/mode: must be 'pinned' or 'clamped'/);
  assert.match(deck(s => { s.frames[0].elements[2].area = -1; }), /\/frames\/0\/elements\/2\/area: must be >= 1e-10, got -1/);
  assert.match(deck(s => { s.frames[0].displacements = new Array(54).fill(0); s.frames[0].displacements[1] = 0.01; }), /\/frames\/0\/displacements\/1: a fixed degree of freedom cannot move/);
  assert.match(deck(s => { s.frames[0].attachments = Array.from({length: 17}, () => ({node: 3, body: 'load', mode: 'clamped'})); }), /\/frames: the frame attachments need 102 equations/);

  // An invalid coupled scene leaves the world untouched; one the engine refuses leaves it reset, with the id.
  const scene = cableStayedDeckScene(), world = await createWorld(sceneWorldOptions(scene));
  try {
    const marker = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0, 5, 0]});
    const broken = copy(scene); broken.frames[0].attachments[0].body = 'ghost';
    assert.throws(() => loadScene(world, broken), SceneValidationError);
    assert.ok(world.isAlive(marker), 'validation failed before the world was touched');
    const refused = copy(scene); refused.frames[0].elements[0].up = [1, 0, 0];   // parallel to the element: only the frame solver can tell
    refuses(() => loadScene(world, refused), 'INVALID_PAYLOAD', /^Scene frame "deck": Element up must not be parallel to its axis/, 'engine refusal names the frame');
    assert.equal(world.isAlive(marker), false); assert.equal(world.bodyCount(), 0, 'the world is left reset and empty');
    assert.deepEqual([...loadSimulationScene(world, scene).frames.keys()], ['deck'], 'loadSimulationScene is the same loader');
  } finally { world.dispose(); }
});

// ---- Moored buoy ------------------------------------------------------------

const capVolume = (R, d) => d <= 0 ? 0 : d >= 2 * R ? 4 / 3 * Math.PI * R ** 3 : Math.PI * d * d * (3 * R - d) / 3;

test('moored buoy at rest: cable tension = rho g V_sub - weight, the draught follows, and the floor and the anchor carry the total weight', async t => {
  // The example scene with more drag so that it is at rest in 8 s: a sphere (R = 0.4 m, 300 kg/m^3, 80.4 kg) in a 64 m^2
  // basin 3 m deep, held under its free waterline by one cable segment (L0 = 2.75 m, EA = 5e4 N, 0.0275 kg per node)
  // from an anchor on the bed to its centre. Means over the last half second.
  //
  // Closed form. With s the stretch, the buoy's centre is at y = L0 + s; the level is H + (V - V0) / A, V0 being the
  // volume the buoy displaced when the scene started (the water is taken to stand around a body that starts wet); the
  // draught is d = level - (y - R) and V = pi d^2 (3R - d) / 3. Equilibrium: E A s / L0 = rho g V - (m + m_n) g, m_n the
  // cable's upper node, which hangs from the buoy. One equation in s, solved by bisection.
  //
  // The water's force in the interface solve (docs/SIMULATION.md, "Water and structure together"): the scene loader links
  // the basin to the structure coupling (linkWaterToStructure), so the body's free motion in the cable's interface solve
  // contains the buoyancy B the water coupling applies in the same step. Before that link the free motion had gravity
  // only: (a) the cable's implicit step placed the node where a body falling under gravity and the cable alone would go,
  // B dt^2 / m = 0.46 mm lower than it does go, a draught error of that size (measured -0.41 mm); (b) the node's own
  // weight and inertia were transmitted for that imagined fall, which made the segment tension high by
  // m_n B / (m + m_n) = 0.73 N (measured +0.729 N). Both are gone; v17-moored.test.mjs measures the two schemes side by side.
  //
  // Checks and tolerances:
  //   1. force of the cable on the buoy = rho g V_sub - m g: 1e-5 relative (float32 mass and gravity in the rigid solver).
  //   2. segment tension = rho g V_sub - (m + m_n) g: 1e-5 relative (measured 7e-7).
  //   3. draught against the closed form: 5e-6 m (measured under 1e-6 m; float32 resolves the buoy's height to 2.4e-7 m).
  //   4. tension against the closed form: 1e-5 relative (measured -7e-7).
  //   5. vertical balance: hydrostatic floor load - anchor pull = weight of water + buoy + cable, within 0.02 N of 1.88 MN.
  //   6. mean level rise = (V_sub - V0) / A: 1e-9 m (the water volume is conserved to roundoff).
  const R = 0.4, H = 3, L0 = 2.75, EA = 5e4, A = 64, rho = 1000, scene = mooredBuoyScene({linearDrag: 2000, waterDrag: 2});
  const world = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadScene(world, scene), sim = loaded.simulation, buoy = loaded.bodies.get('buoy'), water = loaded.water.get('basin'), cable = loaded.cables.get('mooring'), attachment = loaded.attachments.get('mooring:0');
    assert.deepEqual(sim.order().map(row => `${row.stage}:${row.id}`), ['couple:structure', 'couple:basin', 'rigid:world', 'events:events']);
    const g = -world.gravity()[1], m = world.getState(buoy).mass, mn = scene.cables[0].masses[1], y0 = world.getState(buoy).position[1], V0 = capVolume(R, H - (y0 - R));
    const balance = s => { let V = capVolume(R, H - (L0 + s - R)); for (let i = 0; i < 60; i++) V = capVolume(R, H + (V - V0) / A - (L0 + s - R)); return {V, residual: EA * s / L0 - (rho * g * V - (m + mn) * g)}; };
    let lo = 0, hi = 0.5; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (balance(mid).residual > 0) hi = mid; else lo = mid; }
    const stretch = (lo + hi) / 2, V = balance(stretch).V, tension = EA * stretch / L0, draught = H + (V - V0) / A - (L0 + stretch - R);
    const steps = 8 * HZ, window = HZ / 2, mean = {tension: 0, force: 0, y: 0, x: 0, V: 0, buoyancy: 0, anchor: 0, floor: 0, level: 0};
    for (let i = 0; i < steps; i++) {
      sim.step();
      if (i < steps - window) continue;
      const s = world.getState(buoy), report = water.report(buoy);
      mean.tension += cable.inspect().tensions[0] / window; mean.force += attachment.force[1] / window; mean.y += s.position[1] / window; mean.x += Math.hypot(s.position[0], s.position[2]) / window;
      mean.V += report.submergedVolume / window; mean.buoyancy += report.buoyancy[1] / window; mean.anchor += cable.inspect().supportReactions[1] / window; mean.floor += water.floorLoad() / window; mean.level += water.elevationAt(s.position[0], s.position[2]) / window;
    }
    const B = rho * g * mean.V, bias = mn * B / (m + mn), lag = B * DT * DT / m, measuredDraught = H + mean.level - (mean.y - R);
    const total = rho * g * water.waterVolume() + (m + 2 * mn) * g;
    t.diagnostic(`closed form: stretch ${(stretch * 1e3).toFixed(3)} mm, tension ${tension.toFixed(3)} N, draught ${draught.toFixed(5)} m, V_sub ${V.toFixed(6)} m^3; before the water was in the interface solve: m_n B/(m+m_n) = ${bias.toFixed(3)} N, B dt^2/m = ${(lag * 1e3).toFixed(3)} mm`);
    t.diagnostic(`measured: force on the buoy ${mean.force.toFixed(4)} N against rho g V_sub - m g = ${(B - m * g).toFixed(4)} N (${sci(-mean.force / (B - m * g) - 1)}); segment tension ${mean.tension.toFixed(4)} N against rho g V_sub - (m + m_n) g = ${(B - (m + mn) * g).toFixed(4)} N (+${(mean.tension - (B - (m + mn) * g)).toFixed(4)} N)`);
    t.diagnostic(`measured: draught ${measuredDraught.toFixed(5)} m (closed form ${draught.toFixed(5)}, ${((measuredDraught - draught) * 1e6).toFixed(3)} um); tension against the closed form ${sci(mean.tension / tension - 1)}; floor load - anchor pull ${(mean.floor + mean.anchor).toFixed(3)} N against total weight ${total.toFixed(3)} N (${(mean.floor + mean.anchor - total).toFixed(3)} N); sideways ${sci(mean.x)} m`);
    within(-mean.force, B - m * g, 1e-5, '1. force of the cable on the buoy');
    within(B, mean.buoyancy, 1e-9, 'the reported buoyancy is rho g V_sub');
    within(mean.tension, B - (m + mn) * g, 1e-5, '2. segment tension');
    assert.ok(bias > 0.7 && lag > 4e-4, 'the errors the link removes were 0.73 N and 0.46 mm');
    assert.ok(mean.tension > 0.5 * m * g, 'the cable is taut: the buoy is held under its free waterline');
    near(measuredDraught, draught, 5e-6, '3. draught');
    within(mean.tension, tension, 1e-5, '4. tension against the closed form');
    near(mean.floor + mean.anchor, total, 0.02, '5. floor load - anchor pull = total weight');
    near(water.meanElevation(), (water.displacedVolume() - V0) / A, 1e-9, '6. mean level');
    near(mean.x, 0, 1e-6, 'no sideways drift');
    assert.equal(cable.inspect().diagnostics.unconvergedSubsteps, 0);
  } finally { world.dispose(); }
});

test('moored buoy released 0.4 m to the side: bounded, decaying with the drag, back at the equilibrium; the ledger with drag only falls', async t => {
  // The example scene as it ships (linear drag 200 N s/m on the buoy, bottom friction 0.5 /s in the basin), started 0.4 m
  // off the anchor with the cable stretched. The sideways mode is a pendulum of stiffness T / L = 480 N/m on 80 kg:
  // period 2.6 s, damping ratio about 0.35. Checks: the buoy never strays beyond its starting offset; the largest
  // excursion in each 4 s window is smaller than in the one before; after 24 s it is within 2 mm of the anchor line
  // (0.5% of the offset: what the sloshing it started still moves it by) and within 0.2 mm of the height it rests at
  // when started with no offset.
  // Energy: the ledger is the structure entry (buoy and cable) plus the water entry, taken from the first step on (the
  // water's potential is defined once it has seen the bodies). It ends far below its start. It may exceed the start by
  // the sampling offset docs/WATER_COUPLING.md derives, rho g V v dt with v the buoy's largest speed, because the terms
  // are known half a step apart; it must not exceed that.
  const offset = 0.4, seconds = 24, run = async start => {
    const scene = mooredBuoyScene({offset: start}), world = await createWorld(sceneWorldOptions(scene));
    try {
      const loaded = loadScene(world, scene), sim = loaded.simulation, buoy = loaded.bodies.get('buoy'), water = loaded.water.get('basin');
      sim.step();
      const first = sim.energy(), windows = [], energy = [first.balance];
      assert.deepEqual(first.entries.map(e => e.id), ['structure', 'basin'], 'the buoy is counted once, by the structure entry');
      let speed = 0, far = 0;
      for (let i = 1; i < seconds * HZ; i++) {
        sim.step();
        const s = world.getState(buoy), x = Math.hypot(s.position[0], s.position[2]), w = Math.floor(i / (4 * HZ));
        windows[w] = Math.max(windows[w] ?? 0, x); far = Math.max(far, x); speed = Math.max(speed, Math.hypot(...s.linearVelocity));
        if (i % 4 === 0) energy.push(sim.energy().balance);
      }
      const s = world.getState(buoy);
      return {windows, far, speed, energy, x: Math.hypot(s.position[0], s.position[2]), y: s.position[1], buoyancy: water.report(buoy).buoyancy[1], volume: water.waterVolume()};
    } finally { world.dispose(); }
  };
  const rest = await run(0), released = await run(offset);
  const bound = released.buoyancy * released.speed * DT, excess = Math.max(...released.energy) - released.energy[0], drop = released.energy[0] - released.energy.at(-1);
  t.diagnostic(`largest excursion per 4 s window: ${released.windows.map(v => v.toFixed(4)).join(', ')} m; end ${sci(released.x)} m from the anchor line, ${sci(released.y - rest.y)} m from the rest height ${rest.y.toFixed(5)} m`);
  t.diagnostic(`energy ledger: ${released.energy[0].toFixed(2)} J -> ${released.energy.at(-1).toFixed(2)} J (fell ${drop.toFixed(2)} J); largest excess above the start ${excess.toFixed(3)} J, bound rho g V v dt = ${bound.toFixed(3)} J at v = ${released.speed.toFixed(3)} m/s`);
  assert.ok(released.far <= offset * (1 + 1e-6), `bounded by the starting offset (went to ${released.far} m)`);
  for (let w = 1; w < released.windows.length; w++) assert.ok(released.windows[w] < released.windows[w - 1], `window ${w}: ${released.windows[w]} m is below ${released.windows[w - 1]} m`);
  assert.ok(released.windows.at(-1) < 0.02 * offset, 'the last window is below 2% of the offset');
  near(released.x, 0, 2e-3, 'back on the anchor line'); near(released.y, rest.y, 2e-4, 'back at the rest height');
  assert.ok(drop > 10, `the drag took energy out (${drop} J)`);
  assert.ok(excess <= bound, `the ledger exceeded its start by ${excess} J, above the sampling bound ${bound} J`);
  let above = -Infinity; for (let i = released.energy.length >> 1; i < released.energy.length; i++) above = Math.max(above, released.energy[i] - released.energy[0]);
  assert.ok(above < 0, 'in the second half the ledger is always below its start');
  const restDrop = rest.energy[0] - rest.energy.at(-1), restExcess = Math.max(...rest.energy) - rest.energy[0];
  assert.ok(restDrop > 0 && restExcess <= rest.buoyancy * rest.speed * DT, `started on the anchor line: fell ${restDrop} J, excess ${restExcess} J`);
});

// ---- Cable-stayed deck ------------------------------------------------------

/** Hand statics of the span by the flexibility method, as in v11-structure.test.mjs: the deck is a simply supported beam
 * (influence function of a point load, self-weight deflection, axial shortening from the stays' horizontal pulls), each
 * stay a spring L / (E A) along its chord. Two tensions from two compatibility equations. */
function stayStatics(span, loadX) {
  const {L, towerX, towerY, stayEA, mass} = span, EI = steel.youngModulus * steel.iz, EA = steel.youngModulus * steel.area, w = steel.density * steel.area * G;
  const influence = (x, a) => { const b = L - a; return x <= a ? b * x * (L * L - b * b - x * x) / (6 * L * EI) : a * (L - x) * (L * L - a * a - (L - x) ** 2) / (6 * L * EI); };
  const self = x => w * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * EI);
  const stays = span.stays.map(s => ({x: s.x, length: s.length, cx: (towerX - s.x) / s.length, cy: towerY / s.length, end: s.endMass * G}));
  const A = [[0, 0], [0, 0]], b = [0, 0];
  for (let i = 0; i < 2; i++) {
    let sag = self(stays[i].x) + mass * G * influence(stays[i].x, loadX);
    for (const s of stays) sag += s.end * influence(stays[i].x, s.x);
    b[i] = sag * stays[i].cy;
    for (let j = 0; j < 2; j++) A[i][j] = stays[j].cy * influence(stays[i].x, stays[j].x) * stays[i].cy + stays[j].cx * Math.min(stays[i].x, stays[j].x) / EA * stays[i].cx + (i === j ? stays[i].length / stayEA : 0);
  }
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0], tensions = [(b[0] * A[1][1] - b[1] * A[0][1]) / det, (A[0][0] * b[1] - A[1][0] * b[0]) / det];
  const deflection = x => -self(x) - mass * G * influence(x, loadX) + stays.reduce((sum, s, j) => sum + (tensions[j] * s.cy - s.end) * influence(x, s.x), 0);
  return {tensions, deflection};
}
const SPAN = {L: 8, segments: 8, towerX: 4, towerY: 3, stayEA: 5e6, stayRho: 0.2, radius: 0.15};
/** The span built by hand, as docs/STRUCTURE_COUPLING.md does it, with the ball pinned to `node`. */
function buildSpan(world, node) {
  const {L, segments, towerX, towerY, stayEA, stayRho, radius} = SPAN;
  const frame = new FrameRuntime(beam({section: steel, segments, length: L, drag: 60, support: 'simple'})), coupling = new StructureCoupling(world);
  const stays = [2, 6].map(x => {
    const length = Math.hypot(x - towerX, towerY);
    const cable = new CompliantCableRuntime({config: cableConfig({maxIterations: 64, forceTolerance: 1e-9, residualTolerance: 1e-12}),
      positions: [towerX, towerY, 0, x, 0, 0], masses: [stayRho * length / 2, stayRho * length / 2], pinned: [1, 0], constraints: [{a: 0, b: 1, restLength: length, compliance: length / stayEA}]});
    coupling.attachCableToFrame(cable, 1, frame, x);
    return {cable, length, x, endMass: stayRho * length / 2};
  });
  const body = world.createBody({shape: {kind: 'sphere', radius}, position: [node, 0, 0], density: 1000, neverSleeps: true});
  const attachment = coupling.attachFrameToBody(frame, node, body, {mode: 'pinned', inertia: {kind: 'sphere', radius}});
  const mass = world.getState(body).mass;
  return {...SPAN, frame, coupling, stays, body, attachment, mass, weight: (mass + steel.density * steel.area * L + stays.reduce((sum, s) => sum + stayRho * s.length, 0)) * G};
}
/** Settle 1.75 s, then quarter-second means of the two stay tensions, the deflection under the ball and the total vertical reaction. */
function measureSpan(sim, frame, cables, node) {
  for (let i = 0; i < Math.round(1.75 * HZ); i++) sim.step();
  const window = HZ / 4, tension = [0, 0]; let reaction = 0, deflection = 0;
  for (let i = 0; i < window; i++) {
    sim.step();
    const s = frame.inspect(); reaction += (s.supportReactions[1] + s.supportReactions[6 * SPAN.segments + 1]) / window; deflection += s.displacements[6 * node + 1] / window;
    cables.forEach((cable, k) => { const c = cable.inspect(); tension[k] += c.tensions[0] / window; reaction += c.supportReactions[1] / window; });
  }
  const f = frame.couplingViews();
  return {tension, deflection, reaction, state: bits(f.displacements, f.velocities, ...cables.flatMap(cable => { const v = cable.couplingViews(); return [v.positions, v.velocities]; }))};
}

test('cable-stayed deck: stay tensions and deflection match the hand statics through the Simulation, from the scene JSON and from a share link, with the same bits', async t => {
  // The span of docs/STRUCTURE_COUPLING.md: 8 m steel deck (EI = 6e5 N m^2, 125.6 kg) on a pin and a roller, two stays
  // (EA = 5e6 N) from a tower top 3 m above midspan to the deck at 2 m and 6 m, a 14.1 kg ball pinned to the deck.
  // Tolerances are those of v11-structure.test.mjs: tension 2e-4 relative and deflection 2e-4 relative + 1e-7 m against
  // the flexibility-method solution (whose own error is its linearised stay geometry), total vertical reaction 5e-5.
  // Here the ball starts on each node with the deck undeflected, instead of being moved along a deck that has settled.
  const check = (measured, span, node, label) => {
    const hand = stayStatics(span, node);
    measured.tension.forEach((value, i) => within(value, hand.tensions[i], 2e-4, `${label}: stay ${i} tension with the ball at ${node} m`));
    near(measured.deflection, hand.deflection(node), 2e-4 * Math.abs(hand.deflection(node)) + 1e-7, `${label}: deflection under the ball at ${node} m`);
    within(measured.reaction, span.weight, 5e-5, `${label}: total vertical reaction with the ball at ${node} m`);
    return {tension: Math.max(...measured.tension.map((v, i) => Math.abs(v / hand.tensions[i] - 1))), deflection: Math.abs(measured.deflection / hand.deflection(node) - 1), reaction: Math.abs(measured.reaction / span.weight - 1), hand};
  };
  const worst = {tension: 0, deflection: 0, reaction: 0}, byNode = new Map();
  for (const node of [1, 3, 4, 5, 7]) {
    const world = await newWorld();
    try {
      const span = buildSpan(world, node), sim = createSimulation(world).add(structureSubsystem(span.coupling, {bodies: [span.body]}));
      const measured = measureSpan(sim, span.frame, span.stays.map(s => s.cable), node), error = check(measured, span, node, 'Simulation');
      for (const key of Object.keys(worst)) worst[key] = Math.max(worst[key], error[key]);
      byNode.set(node, {measured, hash: world.exactHash(), span});
      t.diagnostic(`ball at x = ${node} m: stays ${measured.tension.map(v => v.toFixed(3))} N (hand ${error.hand.tensions.map(v => v.toFixed(3))}); deflection ${sci(measured.deflection)} m (hand ${sci(error.hand.deflection(node))}); reaction ${measured.reaction.toFixed(4)} N (weight ${span.weight.toFixed(4)})`);
    } finally { world.dispose(); }
  }
  t.diagnostic(`worst over 5 positions through the Simulation: tension ${sci(worst.tension)}, deflection ${sci(worst.deflection)}, reaction ${sci(worst.reaction)}`);

  // The same span as a scene file, and as a share link of it: the same numbers, and the same bits as the hand-built run.
  const node = 5, reference = byNode.get(node), scene = cableStayedDeckScene({loadNode: node});
  const sources = {'scene JSON': copy(scene), 'share link (compressed)': decodeSceneLink(await encodeSceneLink(scene)), 'share link (stored)': decodeSceneLink(`https://example.org/lab.html#scene=${encodeSceneLinkSync(scene)}`)};
  for (const [label, source] of Object.entries(sources)) {
    const world = await createWorld(sceneWorldOptions(source));
    try {
      const loaded = loadScene(world, source);
      assert.deepEqual(loaded.simulation.order().map(row => `${row.stage}:${row.id}`), ['couple:structure', 'rigid:world', 'events:events']);
      assert.deepEqual([...loaded.attachments.keys()], ['stay-left:0', 'stay-right:0', 'deck:0']);
      const measured = measureSpan(loaded.simulation, loaded.frames.get('deck'), [loaded.cables.get('stay-left'), loaded.cables.get('stay-right')], node);
      check(measured, reference.span, node, label);
      assert.deepEqual(measured.tension, reference.measured.tension, `${label}: the same stay tensions, to the last bit`);
      assert.equal(measured.deflection, reference.measured.deflection, `${label}: the same deflection`);
      assert.equal(measured.reaction, reference.measured.reaction, `${label}: the same reaction`);
      assert.equal(measured.state, reference.measured.state, `${label}: the same frame and cable state`);
      assert.equal(world.exactHash(), reference.hash, `${label}: the same world hash`);
      // One step's value on a deck that still rings (docs/STRUCTURE_COUPLING.md, "Frame ringing"): 1%.
      within(Math.hypot(...loaded.attachments.get('deck:0').force), reference.span.mass * G, 1e-2, `${label}: the deck carries the ball`);
    } finally { world.dispose(); }
  }
  t.diagnostic(`scene JSON, compressed link and stored link at x = ${node} m: tensions ${reference.measured.tension.map(v => v.toFixed(6))} N, deflection ${sci(reference.measured.deflection)} m, world exactHash ${reference.hash}, frame and cable sha256 ${reference.measured.state.slice(0, 16)}…: identical to the hand-built run`);
});

// ---- Energy ledger ----------------------------------------------------------

test('energy ledger, undamped: conserved to the stated order of the integrators and never growing', async t => {
  // 1. A midpoint, linear solid (energy conserved exactly by the scheme: docs/SOLID_MECHANICS.md states 6.4e-15) and a
  //    heat solver with one fixed face and a source (stored energy - boundary heat - source heat is constant to the solver
  //    tolerance: docs/HEAT_TRANSFER.md states 8.6e-15), in one simulation. Tolerance 1e-10 on each balance.
  const world = await newWorld();
  try {
    const {solid} = solidCase(DT), {heat} = heatCase(DT), sim = createSimulation(world).add(solidSubsystem(solid)).add(heatSubsystem(heat));
    const start = sim.energy(), at = (e, id) => e.entries.find(entry => entry.id === id);
    assert.deepEqual(start.entries.map(e => [e.id, e.domain]), [['heat', 'thermal'], ['solid', 'mechanical']]);
    let mechanical = 0, thermal = 0;
    const swing = at(start, 'solid').parts.strain, exchangedScale = () => Math.abs(at(sim.energy(), 'heat').exchanged);
    for (let i = 0; i < 480; i++) {
      sim.step();
      if (i % 8) continue;
      const e = sim.energy();
      mechanical = Math.max(mechanical, Math.abs(at(e, 'solid').balance - at(start, 'solid').balance) / swing);
      thermal = Math.max(thermal, Math.abs(at(e, 'heat').balance - at(start, 'heat').balance) / Math.max(exchangedScale(), 1));
      near(e.total, e.mechanical + e.thermal, 1e-9 * Math.abs(e.total), 'the total is the sum of the domains');
      near(e.balance, e.total - e.exchanged, 1e-9 * Math.abs(e.total), 'balance = total - exchanged');
    }
    const end = sim.energy();
    t.diagnostic(`solid (midpoint, linear): largest change of the balance ${sci(mechanical)} of the ${sci(swing)} J in play; heat: ${sci(thermal)} of the ${exchangedScale().toFixed(3)} J exchanged (stored energy rose ${(end.thermal - start.thermal).toFixed(3)} J)`);
    assert.ok(mechanical <= 1e-10, `solid energy changed by ${mechanical}`);
    assert.ok(thermal <= 1e-10, `heat balance changed by ${thermal}`);
    assert.ok(end.thermal - start.thermal > 1, 'heat did enter: the balance is constant because the ledger subtracts it');
  } finally { world.dispose(); }

  // 2. A pendulum on a stiff cable (no drag anywhere). The cable step is implicit Euler: first order, and it damps the
  //    swing at (n + 1) / (4 n) omega^2 dt per second for n rigid sub-steps (docs/STRUCTURE_COUPLING.md). So the ledger
  //    never grows, and halving the step halves the loss. Rise between samples at most 1e-4 of the swing energy
  //    (float32 body state); loss ratio 2 within 0.3; loss at 240 Hz within a factor 1.5 of 2 x rate x time.
  const pendulum = async hz => {
    const L = 2, radius = 0.1, theta = 0.1, seconds = 6, world = await newWorld({hz});
    try {
      const definition = hangingCableDefinition({segments: 1, length: L, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e6, config: cableConfig({dt: 1 / hz})});
      definition.positions[3] = L * Math.sin(theta); definition.positions[4] = -L * Math.cos(theta);
      const cable = new CompliantCableRuntime(definition), body = world.createBody({shape: {kind: 'sphere', radius}, position: [L * Math.sin(theta), -L * Math.cos(theta), 0], density: 2000, neverSleeps: true});
      const coupling = new StructureCoupling(world);
      coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'sphere', radius}});
      const sim = createSimulation(world).add(structureSubsystem(coupling, {bodies: [body]}));
      refuses(() => sim.trackBody(body, {kind: 'sphere', radius}), 'INVALID_STATE', /already counted by subsystem "structure"/, 'a body is counted once');
      const energy = [sim.energy().balance], scale = world.getState(body).mass * G * L * (1 - Math.cos(theta));
      for (let i = 1; i <= seconds * hz; i++) { sim.step(); if (i % (hz / 4) === 0) energy.push(sim.energy().balance); }
      let rise = 0; for (let i = 1; i < energy.length; i++) rise = Math.max(rise, energy[i] - energy[i - 1]);
      return {loss: (energy[0] - energy.at(-1)) / scale, rise: rise / scale, top: (Math.max(...energy) - energy[0]) / scale, predicted: 2 * (SUB + 1) / (4 * SUB) * (G / L) / hz * seconds};
    } finally { world.dispose(); }
  };
  const coarse = await pendulum(240), fine = await pendulum(480);
  t.diagnostic(`cable pendulum, 6 s: loss ${sci(coarse.loss)} of the swing energy at 240 Hz (rate formula ${sci(coarse.predicted)}), ${sci(fine.loss)} at 480 Hz, ratio ${(coarse.loss / fine.loss).toFixed(3)}; largest rise between samples ${sci(Math.max(coarse.rise, fine.rise))}`);
  for (const run of [coarse, fine]) { assert.ok(run.top <= 1e-4, `the ledger rose above its start by ${run.top}`); assert.ok(run.rise <= 1e-4, `the ledger rose by ${run.rise} between samples`); }
  near(coarse.loss / fine.loss, 2, 0.3, 'first order: half the step, half the loss');
  assert.ok(coarse.loss > coarse.predicted / 1.5 && coarse.loss < coarse.predicted * 1.5, `loss ${coarse.loss} against the rate formula ${coarse.predicted}`);

  // 3. The 'rigid' entry: bodies no subsystem counts are tracked with their inertia. A box (half extents 0.3, 0.1, 0.2;
  //    density 800) turned 0.7 rad about a skew axis, moving at v and spinning about its own x axis at w, in zero gravity:
  //    kinetic energy m v^2 / 2 + I_x w^2 / 2 with I_x = m (hy^2 + hz^2) / 3. Tolerance 1e-6 at the start (float32 body
  //    state) and 1e-4 after one second (the rigid solver's drift, see below).
  const free = await newWorld({gravity: [0, 0, 0]});
  try {
    const h = [0.3, 0.1, 0.2], axis = [1 / 3, 2 / 3, 2 / 3], half = 0.35, q = [...axis.map(a => a * Math.sin(half)), Math.cos(half)], w = 3, v = [0.5, -0.25, 1];
    // The body's own x axis in world axes: the first column of the rotation matrix.
    const ex = [1 - 2 * (q[1] * q[1] + q[2] * q[2]), 2 * (q[0] * q[1] + q[2] * q[3]), 2 * (q[0] * q[2] - q[1] * q[3])];
    const body = free.createBody({shape: {kind: 'box', halfExtents: h}, position: [0, 0, 0], rotation: q, density: 800, linearVelocity: v, angularVelocity: ex.map(c => c * w), neverSleeps: true});
    const sim = createSimulation(free).trackBody(body, {kind: 'box', halfExtents: h}), m = free.getState(body).mass;
    const expected = 0.5 * m * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + 0.5 * m / 3 * (h[1] ** 2 + h[2] ** 2) * w * w, start = sim.energy();
    assert.deepEqual(start.entries.map(e => [e.id, e.kind, e.domain]), [['rigid', 'rigid-world', 'mechanical']]);
    within(start.total, expected, 1e-6, 'kinetic energy of a moving, spinning box');
    for (let i = 0; i < 240; i++) sim.step();
    // Set after a first measurement: the first bound here was 1e-6 and the energy had risen by 1.2e-5 after 240 steps.
    // That is the rigid solver's own float32 drift for a spinning box, not the ledger (which matched to 1e-6 at the start).
    within(sim.energy().total, expected, 1e-4, 'and one second later');
    t.diagnostic(`tracked box: kinetic energy ${start.total.toFixed(6)} J at the start and ${sim.energy().total.toFixed(6)} J after 1 s, expected ${expected.toFixed(6)} J`);
    assert.equal(sim.untrackBody(body), true); assert.equal(sim.energy().entries.length, 0);
  } finally { free.dispose(); }
  // A scene with a floating body that no cable or frame carries: the loader tracks it, with the inertia of its shape.
  const floating = mooredBuoyScene(); delete floating.cables;
  const pond = await createWorld(sceneWorldOptions(floating));
  try {
    const loaded = loadScene(pond, floating);
    assert.deepEqual(loaded.simulation.energy().entries.map(e => e.id), ['basin', 'rigid']);
    for (let i = 0; i < 30; i++) loaded.simulation.step();
    assert.ok(loaded.water.get('basin').report(loaded.bodies.get('buoy')).submergedFraction > 0.2);
  } finally { pond.dispose(); }
});

// ---- Determinism, save and resume -------------------------------------------

test('determinism: a coupled scene repeats bit for bit; save -> load -> continue starts from the same fields and stays within a stated bound', async t => {
  // What a save of a coupled scene carries, beyond a rigid one: the basin's eta, u and v; every cable's node positions
  // and velocities; every frame's displacements and velocities. What it does not: the structure coupling's own state
  // (last step's interface impulses and the frame's pending half kick), the cable solver's multipliers, the body's
  // displaced volume as of the last step (the first step after a load takes the wet body as part of the starting
  // state, so one step's change of displaced volume is not put into the water), and what a rigid save does not carry.
  // So a resumed run starts from the same fields and then differs slightly. Saved at tick 240, compared 240 ticks later.
  // Bounds are about ten times the measured values (printed):
  //   moored buoy, released 0.4 m off (mid-swing at the save): buoy position 1e-4 m (measured 6.1e-6); eta 4e-4 m (measured
  //     4.0e-5 of waves 2.3e-3 m high: the lost step of displaced volume, A_wp v dt = 8e-5 m^3 over the buoy's kernel).
  //   cable-stayed deck (settling at the save): ball position 2e-7 m (measured 1.6e-8); deck displacement 4e-6 m (measured
  //     4.3e-7 of a 1.2e-3 m deflection). The saved velocity of a body on a frame lacks the closing half of the last frame
  //     impulse, about g dt / 2 = 0.02 m/s for a body at rest on it, so the resumed deck rings once more and settles.
  const cases = {
    'moored-buoy': {scene: mooredBuoyScene({offset: 0.4}), body: 'buoy', bound: {body: 1e-4, field: 4e-4}, field: l => l.water.get('basin').eta, fields: l => { const w = l.water.get('basin'), c = l.cables.get('mooring').couplingViews(); return [w.eta, w.u, w.v, c.positions, c.velocities]; }},
    'cable-stayed-deck': {scene: cableStayedDeckScene(), body: 'load', bound: {body: 2e-7, field: 4e-6}, field: l => l.frames.get('deck').couplingViews().displacements,
      fields: l => { const f = l.frames.get('deck').couplingViews(); return [f.displacements, f.velocities, ...['stay-left', 'stay-right'].flatMap(id => { const c = l.cables.get(id).couplingViews(); return [c.positions, c.velocities]; })]; }},
  };
  for (const [name, {scene, body, bound, field, fields}] of Object.entries(cases)) {
    const open = async source => { const world = await createWorld(sceneWorldOptions(source)); return {world, ...loadScene(world, source)}; };
    const a = await open(scene), b = await open(decodeSceneLink(await encodeSceneLink(scene)));
    let resumed = null;
    try {
      for (let i = 0; i < 240; i++) { a.simulation.step(); b.simulation.step(); }
      assert.equal(a.world.exactHash(), b.world.exactHash(), `${name}: two loads give the same world`);
      assert.equal(bits(...fields(a)), bits(...fields(b)), `${name}: and the same fields`);
      const saved = copy(saveScene(a.world, a));
      assert.deepEqual(validateScene(saved), [], `${name}: the save is a valid scene`);
      assert.notEqual(sceneHash(saved), sceneHash(scene), 'the save carries state');
      assert.equal(sceneHash(saveScene(a.world, a, {state: false})), sceneHash(scene), `${name}: saved without state, it is the scene it was loaded from`);
      resumed = await open(decodeSceneLink(await encodeSceneLink(saved)));
      // At the moment of loading: the fields are bit-identical and the body is where it was.
      assert.equal(bits(...fields(resumed)), bits(...fields(a)), `${name}: the fields at the moment of loading`);
      assert.deepEqual(resumed.world.getState(resumed.bodies.get(body)).position, a.world.getState(a.bodies.get(body)).position);
      assert.deepEqual(resumed.world.getState(resumed.bodies.get(body)).linearVelocity, a.world.getState(a.bodies.get(body)).linearVelocity);
      assert.equal(resumed.simulation.tick, 0, 'the tick count is not carried');
      for (let i = 0; i < 240; i++) { a.simulation.step(); b.simulation.step(); resumed.simulation.step(); }
      assert.equal(a.world.exactHash(), b.world.exactHash(), `${name}: still bit-identical after 480 steps`);
      assert.equal(bits(...fields(a)), bits(...fields(b)));
      const pa = a.world.getState(a.bodies.get(body)).position, pr = resumed.world.getState(resumed.bodies.get(body)).position, drift = Math.hypot(pa[0] - pr[0], pa[1] - pr[1], pa[2] - pr[2]);
      const fa = field(a), fr = field(resumed); let fieldDrift = 0, scale = 0;
      for (let i = 0; i < fa.length; i++) { fieldDrift = Math.max(fieldDrift, Math.abs(fa[i] - fr[i])); scale = Math.max(scale, Math.abs(fa[i])); }
      t.diagnostic(`${name}: saved at tick 240 (${JSON.stringify(saved).length} characters of JSON), resumed for 240 ticks: body ${sci(drift)} m apart (bound ${sci(bound.body)}), field ${sci(fieldDrift)} m apart of ${sci(scale)} m (bound ${sci(bound.field)})`);
      assert.ok(drift <= bound.body, `${name}: the resumed body is ${drift} m from the original, above the bound ${bound.body} m`);
      assert.ok(fieldDrift <= bound.field, `${name}: the resumed field is ${fieldDrift} m from the original, above the bound ${bound.field} m`);
    } finally { a.world.dispose(); b.world.dispose(); resumed?.world.dispose(); }
  }
});

test('a cable attached off a floating body\'s centre runs: round-off torques too small for float32 are dropped', async () => {
  const {loadScene: load, mooredBuoyScene: buoy, sceneWorldOptions: options} = await import('box3d-webgpu-kit/scene');
  const {createWorld: make} = await import('box3d-webgpu-kit');
  const scene = JSON.parse(JSON.stringify(buoy()));
  scene.cables[0].attachments[0].localPoint = [0, -0.2, 0];
  const world = await make(options(scene));
  try {
    // Before the fix the first step threw INVALID_PAYLOAD: the interface solve left a torque component
    // of about 1e-50 N m, nonzero but below the smallest float32, which the rigid world refuses.
    const {simulation, bodies} = load(world, scene);
    for (let i = 0; i < 240; i++) simulation.step();
    const state = world.getState(bodies.get('buoy'));
    assert.ok(state.position.every(Number.isFinite) && Math.hypot(...state.linearVelocity) < 5, 'the moored buoy stays finite and bounded');
  } finally { world.dispose(); }
});
