// The packaged fracture module (box3d-webgpu-kit/fracture). The full validation suite is
// tests/engine/solid-fracture.test.mjs in the repository; this file proves the published module is
// that solver, and runs the two things that need the rigid world: the hand-off of a fragment as a
// hull body, and the Subsystem adapter in a real Simulation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {FractureBody, SOLID_FRACTURE_SOLVER_ID, FRACTURE_SUBSYSTEM_ORDER, fractureSubsystem, quenchedPlate} from 'box3d-webgpu-kit/fracture';
import {boxMesh} from 'box3d-webgpu-kit/solid';
import {createSimulation, heatSubsystem, thermalSolidLink, SUBSYSTEM_ORDER} from 'box3d-webgpu-kit/simulation';
import {createWorld, capabilities} from 'box3d-webgpu-kit';

const concrete = {youngModulus: 30e9, poissonRatio: 0.2, density: 2400}, strength = 3e6, toughness = 100;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const close = (actual, expected, relative, absolute = 0) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
const L = 0.2, w = 0.05;

function weakBar(config) {
  const body = new FractureBody({mesh: boxMesh({size: [L, w, w], cells: [4, 1, 1]}), material: concrete, fracture: {model: 'cohesive', strength: 2 * strength, toughness, initialOpeningRatio: 0.1}, config});
  body.setInterfaceProperties(body.selectInteriorFaces((cx, cy, cz, nx) => near(cx, L / 2) && Math.abs(nx) > 0.999), {strength});
  return body;
}

test('the fracture module is listed and identifies its solver', () => {
  assert.ok(capabilities().modules.includes('fracture'));
  assert.equal(SOLID_FRACTURE_SOLVER_ID, 'solid-fracture-czm-js-f64-v1');
  assert.equal(FRACTURE_SUBSYSTEM_ORDER, SUBSYSTEM_ORDER.solid);
});

test('a bar with a weak cross-section peaks at sigma_c A and dissipates G_c A', () => {
  const body = weakBar({tolerance: 1e-11});
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
  const end = () => body.selectNodes(x => near(x, L)), critical = 2 * toughness / strength, peakAt = strength * L / concrete.youngModulus + 0.1 * critical;
  let peak = 0;
  for (let i = 1; i <= 30; i++) {
    const U = i <= 10 ? peakAt * i / 10 : peakAt + (1.05 * critical - peakAt) * (i - 10) / 20;
    body.constrain(end(), [U, null, null]);
    const result = body.solveStatic(); assert.ok(result.converged);
    let force = 0; for (const n of end()) force += result.reactions[3 * n];
    peak = Math.max(peak, force);
  }
  close(peak, strength * w * w, 1e-9);
  close(body.dissipatedEnergy(), toughness * w * w, 1e-9);
  assert.equal(body.fragments().length, 2);
});

test('a fragment handed to the rigid world is a hull body with the fragment\'s mass and momentum', async () => {
  const world = await createWorld({step: 1 / 240, ground: false, gravity: [0, 0, 0]});
  try {
    const body = weakBar({integrator: 'midpoint', dt: 2e-6, tolerance: 1e-12});
    const X = body.referencePositions;
    body.setState(undefined, Array.from({length: 3 * body.nodeCount}, (_, j) => j % 3 === 0 ? 1.5 * Math.sign(X[j] - L / 2) + 0.4 : j % 3 === 1 ? 0.2 : 0));
    const before = body.momentum();
    for (let i = 0; i < 80 && body.fragments().length < 2; i++) body.step();
    const pieces = body.fragments(); assert.equal(pieces.length, 2);
    const handles = [], descriptions = [];
    for (const piece of pieces) {
      const rigid = body.handOff(piece);
      // The description carries the fragment's momentum to round-off (float64).
      for (let k = 0; k < 3; k++) close(rigid.linearMomentum[k], piece.linearMomentum[k], 1e-15, 1e-15 * body.mass);
      const {mass, hullVolume, linearMomentum, ...descriptor} = rigid;
      handles.push(world.createBody(descriptor)); descriptions.push(rigid);
    }
    // In the world (float32 state, mass from density times the hull volume): mass and momentum within 1e-5.
    const total = [0, 0, 0];
    handles.forEach((handle, i) => {
      const state = world.getState(handle);
      close(state.mass, pieces[i].mass, 1e-5);
      for (let k = 0; k < 3; k++) { close(state.linearVelocity[k], descriptions[i].linearVelocity[k], 1e-6, 1e-7); total[k] += state.mass * state.linearVelocity[k]; }
    });
    for (let k = 0; k < 3; k++) close(total[k], before.linear[k], 1e-5, 1e-5 * body.mass);
    // One way: nothing is left to simulate here, and the rigid bodies fly on.
    const left = body.momentum(); assert.equal(left.mass, 0); close(left.handedOffMass, body.mass, 1e-14);
    for (let i = 0; i < 24; i++) world.step();
    const [a, b] = handles.map(handle => world.getState(handle));
    assert.ok(a.linearVelocity[0] < 0 && b.linearVelocity[0] > 0 && b.position[0] - a.position[0] > descriptions[1].position[0] - descriptions[0].position[0] + 0.05, 'the halves fly apart as rigid bodies');
  } finally { world.dispose(); }
});

test('in a Simulation the heat solver cracks the quenched plate and the cracks arrive as events', async () => {
  const plate = quenchedPlate({dt: 1 / 240}), world = await createWorld({step: 1 / 240, ground: false});
  try {
    const sim = createSimulation(world).add(fractureSubsystem(plate.body)).add(thermalSolidLink(plate.heat, plate.body, {reference: plate.reference})).add(heatSubsystem(plate.heat));
    assert.deepEqual(sim.order().filter(row => row.stage === 'post').map(row => row.id), ['heat', 'thermal-solid', 'fracture']);
    const events = []; sim.onEvent(event => events.push(event));
    for (let i = 0; i < 200 && events.length === 0; i++) sim.step();
    assert.ok(events.length > 0 && events.every(event => event.type === 'crack' && event.source === 'fracture' && event.data.kind === 'initiated' && event.data.mode === 'I'));
    // The first cracks are in the cell layer under the cooled face, when that layer has cooled by about sigma_c (1 - nu) / (E alpha).
    assert.ok(events.every(event => plate.body.interiorFace(event.data.face).centroid[0] < plate.cellSize));
    const drop = plate.reference - plate.heat.temperature[0];
    assert.ok(drop >= plate.criticalDrop && drop <= 1.1 * plate.criticalDrop, `the surface cell cooled by ${drop} K at the first crack; the critical drop is ${plate.criticalDrop} K`);
    assert.ok(sim.energy().entries.some(entry => entry.id === 'fracture' && entry.kind === 'solid-fracture'));
  } finally { world.dispose(); }
});
