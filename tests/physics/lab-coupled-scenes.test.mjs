// Coupled scenes in the Physics Lab: the code path the page uses (loadLabScene, which builds every scene with
// loadSimulationScene, and CoupledSceneView, which steps it through its Simulation and builds the rows the renderer
// draws), run in node against the real WASM world. What is checked:
//  - the cloth and grain sections of the scene format: validation with paths, normal form, hash, share links;
//  - each coupled example runs the same, bit for bit, twice;
//  - a save at step N (what Copy share link and Download write), reopened from its link in a fresh world, has the
//    same scene hash, starts from the same solver fields, and two such reopenings stay identical;
//  - what is drawn: rows, meshes and rope segments;
//  - rigid scenes are unchanged: their Simulation has no subsystems and steps exactly like the world;
//  - solids, fracture and heat: validation paths, the build, a save of a cracked solid reopened from its link with
//    the same nodes, interfaces and fields, the reaction load at rest, the colour bands and the events.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {
  COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, canonicalize, decodeSceneLink, encodeSceneLink, encodeSceneLinkSync, loadScene, normalizeScene, sceneHash,
  sceneHasCoupling, trampolineScene, hopperSeesawScene, validateScene, rubberPadScene, notchedBeamScene, quenchedPlateScene, heatedBarScene,
} from '../../src/engine/scene-format.ts';
import {FractureBody} from '../../src/engine/solid-fracture.ts';
import {exactTransformHash, loadLabScene} from '../../src/lab/scene-host.ts';
import {CoupledSceneView, SOLID_BANDS, boundaryFaceElements, coupledStateHash, grainWallMesh, rampColor, sceneIsCoupled, solidBand, waterDrawGrid, writeTwoSidedMesh, writeWaterMesh} from '../../src/lab/coupled-scene.ts';
import {COUPLED_EXAMPLE_NAMES, LAB_EXAMPLE_NAMES, parseSceneRequest, resolveSceneRequest, sceneCameraFrame, sceneSummary} from '../../src/lab/scene-loading.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));

const withWorld = run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return run(world); } finally { world.destroy(); } };
/** Steps of each example in the repeat test: about one second, fewer for the slow ones. */
const STEPS = {'moored-buoy': 240, 'cable-stayed-deck': 240, 'buoy-and-crates': 360, trampoline: 150, 'hopper-seesaw': 360, 'suspended-platform': 480,
  'rubber-pad': 90, 'notched-beam': 180, 'quenched-plate': 150, 'heated-bar': 120};
const copy = value => JSON.parse(JSON.stringify(value));

/** Load a scene as the Lab does, step it `steps` times through the view, and report. */
function run(scene, steps, after) {
  return withWorld(world => {
    const loaded = loadLabScene(world, scene), view = new CoupledSceneView(loaded, world), hashes = [];
    for (let i = 1; i <= steps; i++) { view.step(); if (i % 60 === 0) hashes.push(view.stateHash()); }
    view.sync();
    const out = {hashes, final: view.stateHash(), tick: loaded.simulation.tick, saved: loaded.builder.toJSON(), draw: view.drawInfo(), rows: view.rowCount, bodies: world.bodyCount(), events: view.eventTotal(), extra: after?.(loaded, view)};
    view.dispose();
    return out;
  });
}

test('the Lab opens every coupled example by name, after the rigid ones', () => {
  assert.deepEqual(COUPLED_EXAMPLE_NAMES, ['moored-buoy', 'cable-stayed-deck', 'buoy-and-crates', 'trampoline', 'hopper-seesaw', 'suspended-platform', 'rubber-pad', 'notched-beam', 'quenched-plate', 'heated-bar']);
  assert.deepEqual(LAB_EXAMPLE_NAMES, [...Object.keys(EXAMPLE_SCENES), ...COUPLED_EXAMPLE_NAMES]);
  for (const name of COUPLED_EXAMPLE_NAMES) {
    const request = parseSceneRequest(`?example=${name}`);
    assert.deepEqual(request, {kind: 'example', name});
    const read = resolveSceneRequest(request);
    assert.equal(read.ok, true, name);
    assert.equal(sceneHash(read.scene), sceneHash(COUPLED_EXAMPLE_SCENES[name]()));
    assert.equal(sceneIsCoupled(read.scene), true);
    assert.match(sceneSummary(read.scene), /basin|cable|frame|cloth|grains|solid/);
    const frame = sceneCameraFrame(read.scene);
    assert.ok(frame.distance >= 0.3 && frame.distance < 40 && frame.target.every(Number.isFinite), `${name}: ${JSON.stringify(frame)}`);
  }
  for (const make of Object.values(EXAMPLE_SCENES)) assert.equal(sceneIsCoupled(normalizeScene(make())), false);
});

test('cloth and grain sections: valid examples, normal form, hash and links', async () => {
  for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
    const scene = make(), normal = normalizeScene(scene);
    assert.deepEqual(validateScene(scene), [], name);
    assert.equal(normal.version, 1, `${name}: the sections are additive; the lowest version that holds the scene is kept`);
    assert.equal(sceneHasCoupling(normal), true);
    assert.equal(canonicalize(normal), canonicalize(scene), `${name}: normalising twice changes nothing`);
    assert.equal(sceneHash(decodeSceneLink(await encodeSceneLink(scene))), sceneHash(scene), `${name}: compressed link`);
    assert.equal(sceneHash(decodeSceneLink(encodeSceneLinkSync(scene))), sceneHash(scene), `${name}: stored link`);
  }
  // Defaults written out do not change the hash.
  const t = trampolineScene(), d = copy(t);
  Object.assign(d.cloths[0], {maxNewtonIterations: 60, cgTolerance: 1e-2, restNodes: d.cloths[0].nodes, velocities: new Array(d.cloths[0].nodes.length).fill(0)});
  Object.assign(d.cloths[0].material, {membrane: 'stvk', bending: 'koiter'});
  d.cloths[0].bodies[0].collide = true;
  assert.equal(sceneHash(d), sceneHash(t));
  const h = hopperSeesawScene(), e = copy(h);
  Object.assign(e.grains[0], {tangentialDamping: 1, velocities: new Array(e.grains[0].positions.length).fill(0)});
  assert.equal(sceneHash(e), sceneHash(h));
});

test('cloth and grain sections: problems are reported with their paths and nothing is built', () => {
  const problems = (make, edit) => { const scene = make(); edit(scene); return validateScene(scene).map(p => `${p.path}: ${p.message}`).join('\n'); };
  assert.match(problems(trampolineScene, s => { s.cloths[0].triangles[4] = 9999; }), /\/cloths\/0\/triangles\/4: must be a node index below 81/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].tear = true; }), /\/cloths\/0\/tear: unknown key "tear"/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].attachments = [{node: 40, body: 'post-0'}]; }), /\/cloths\/0\/attachments\/0\/body: body "post-0" is not in this cloth's bodies/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].attachments = [{node: 0, body: 'ball'}]; }), /attachments\/0\/node: node 0 is pinned/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].bodies.push({body: 'nobody'}); }), /\/cloths\/0\/bodies\/2\/body: unknown body id "nobody"/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].pinned = [3, 2]; }), /\/cloths\/0\/pinned\/1: node indices must be ascending/);
  assert.match(problems(trampolineScene, s => { s.cloths[0].id = 'ball'; }), /\/cloths\/0\/id: duplicate id "ball"/);
  assert.match(problems(hopperSeesawScene, s => { delete s.grains[0].normalStiffness; }), /\/grains\/0\/normalStiffness: is required by the 'linear' law/);
  assert.match(problems(hopperSeesawScene, s => { s.grains[0].law = 'hertz'; }), /\/grains\/0\/material\/youngModulus: is required/);
  assert.match(problems(hopperSeesawScene, s => { s.grains[0].radii.pop(); }), /\/grains\/0\/positions: must hold exactly/);
  assert.match(problems(hopperSeesawScene, s => { s.grains[0].walls[0].shape.kind = 'torus'; }), /\/grains\/0\/walls\/0\/shape\/kind: must be 'plane'/);
  assert.match(problems(hopperSeesawScene, s => { s.grains[0].substeps = 0; }), /\/grains\/0\/substeps/);
  // An unstable grain step is refused when the scene is built, with the set's id, and the world is left reset to the scene's settings.
  withWorld(world => {
    const scene = hopperSeesawScene(); scene.grains[0].substeps = 1;
    assert.throws(() => loadLabScene(world, scene), /Scene grains "beads":.*critical time/);
    assert.equal(world.bodyCount(), 1, 'reset to the scene settings: only the ground slab');
  });
});

test('the core loader still refuses a coupled scene; the Lab loader builds it with a Simulation', () => {
  withWorld(world => {
    for (const make of Object.values(COUPLED_EXAMPLE_SCENES)) assert.throws(() => loadScene({}, make()), /has coupled sections.*loadSimulationScene/);
    const loaded = loadLabScene(world, trampolineScene());
    assert.equal(loaded.cloths.size, 1);
    assert.deepEqual(loaded.simulation.order().map(row => row.id), ['sheet', 'world', 'events']);
    const hopper = loadLabScene(world, hopperSeesawScene());
    assert.equal(hopper.grains.get('beads').substeps, 12);
    assert.deepEqual(hopper.simulation.order().map(row => row.id), ['beads', 'world', 'events']);
  });
});

test('rigid scenes are untouched: the Lab Simulation of a rigid scene has no subsystems and steps like the world', () => {
  for (const name of ['domino-run', 'ragdoll']) {
    const a = withWorld(world => { const loaded = loadLabScene(world, EXAMPLE_SCENES[name]()); assert.equal(loaded.simulation.subsystems().length, 0); for (let i = 0; i < 120; i++) loaded.simulation.step(); return exactTransformHash(world); });
    const b = withWorld(world => { const loaded = loadLabScene(world, EXAMPLE_SCENES[name]()); for (let i = 0; i < 120; i++) loaded.builder.world.step(); return exactTransformHash(world); });
    assert.equal(a, b, name);
  }
});

for (const name of Object.keys(COUPLED_EXAMPLE_SCENES)) {
  test(`${name}: two runs through the Lab's code path are bit-identical, and the scene is drawn`, () => {
    const steps = STEPS[name], first = run(COUPLED_EXAMPLE_SCENES[name](), steps), second = run(COUPLED_EXAMPLE_SCENES[name](), steps);
    assert.equal(first.tick, steps);
    assert.deepEqual(second.hashes, first.hashes);
    assert.equal(second.final, first.final);
    assert.equal(sceneHash(second.saved), sceneHash(first.saved));
    assert.equal(first.rows, first.bodies + first.draw.meshRows + first.draw.wallRows + first.draw.grainRows);
    const scene = normalizeScene(COUPLED_EXAMPLE_SCENES[name]());
    assert.equal(first.draw.meshRows > 0 || first.draw.lineSegments > 0 || first.draw.grainRows > 0, true);
    if (scene.cloths) assert.equal(first.draw.meshVertices >= scene.cloths[0].triangles.length * 2, true);
    if (scene.cables) assert.equal(first.draw.lineSegments, scene.cables.reduce((n, c) => n + c.segments.length, 0) + (scene.frames ?? []).reduce((n, f) => n + f.elements.length, 0));
    if (scene.grains) assert.equal(first.draw.grainRows, scene.grains[0].radii.length);
    if (scene.solids) { assert.equal(first.draw.solidRows, SOLID_BANDS * scene.solids.length); assert.ok(first.draw.solidTriangles > 0 && first.draw.meshVertices === 3 * first.draw.solidTriangles + (scene.cloths ? 0 : 0)); }
  });
}

test('a save after N steps reopens from its share link with the same scene hash and the same fields, and runs the same twice', async () => {
  for (const [name, steps] of [['buoy-and-crates', 240], ['trampoline', 120], ['hopper-seesaw', 300], ['suspended-platform', 360]]) {
    const original = run(COUPLED_EXAMPLE_SCENES[name](), steps, loaded => ({
      cloth: [...loaded.cloths.values()].map(c => Array.from(c.cloth.positions)),
      grains: [...loaded.grains.values()].map(g => Array.from(g.granular.positions.subarray(0, 3 * g.granular.grainCount))),
      water: [...loaded.water.values()].map(w => Array.from(w.eta)),
    }));
    const link = await encodeSceneLink(original.saved), reopened = decodeSceneLink(link);
    assert.equal(sceneHash(reopened), sceneHash(original.saved), `${name}: the link carries the saved scene`);
    const fields = withWorld(world => {
      const loaded = loadLabScene(world, reopened);
      return {
        cloth: [...loaded.cloths.values()].map(c => Array.from(c.cloth.positions)),
        grains: [...loaded.grains.values()].map(g => Array.from(g.granular.positions.subarray(0, 3 * g.granular.grainCount))),
        water: [...loaded.water.values()].map(w => Array.from(w.eta)),
      };
    });
    assert.deepEqual(fields, original.extra, `${name}: the solvers start from the saved fields, bit for bit`);
    const a = run(reopened, 120), b = run(decodeSceneLink(link), 120);
    assert.deepEqual(b.hashes, a.hashes, `${name}: two fresh openings of the link stay identical`);
    assert.equal(b.final, a.final);
  }
});

test('drawing helpers: water surface, cloth mesh and grain walls', () => {
  // A flat basin: every top normal points up, the surface is at the rest depth, the sides reach the floor.
  const grid = waterDrawGrid(4, 3), out = new Float32Array(grid.floats), heights = new Float32Array((grid.nx + 1) * (grid.nz + 1));
  const floats = writeWaterMesh(new Float32Array(12), 4, 3, 0.5, 0.5, 2, [1, 0, -1], grid, heights, out);
  assert.equal(floats, grid.floats);
  for (let v = 0; v < 4 * 3 * 6; v++) { assert.equal(out[6 * v + 1], 2); assert.equal(out[6 * v + 4], 1); }
  let lowest = Infinity; for (let v = 0; v < floats / 6; v++) lowest = Math.min(lowest, out[6 * v + 1]); assert.equal(lowest, 0);
  assert.equal(waterDrawGrid(512, 512).stride, 4);
  // A cloth triangle is written on both sides with opposite normals.
  const mesh = new Float32Array(36), normals = new Float32Array(9);
  assert.equal(writeTwoSidedMesh([0, 0, 0, 1, 0, 0, 0, 0, -1], [0, 1, 2], normals, mesh), 36);
  assert.deepEqual([mesh[3], mesh[4], mesh[5]], [0, 1, 0]);
  assert.deepEqual([mesh[21], mesh[22], mesh[23]], [-0, -1, -0]);
  // A cone wall is a closed band of triangles around its axis at the wall's position.
  const cone = grainWallMesh({shape: {kind: 'frustum', r0: 0.1, z0: 1, r1: 0.4, z1: 2}, position: [0.5, 0, 0]});
  assert.ok(cone && cone.length === 32 * 4 * 3 * 6);
  let ys = [Infinity, -Infinity]; for (let v = 0; v < cone.length / 6; v++) { ys = [Math.min(ys[0], cone[6 * v + 1]), Math.max(ys[1], cone[6 * v + 1])]; }
  assert.deepEqual(ys, [1, 2]);
  assert.equal(grainWallMesh({shape: {kind: 'plane', normal: [0, 1, 0]}}), null);
});

test('the state hash covers the solver fields, not only the bodies', () => {
  withWorld(world => {
    const loaded = loadLabScene(world, trampolineScene()), before = coupledStateHash(loaded);
    loaded.cloths.get('sheet').cloth.velocities[30] += 1e-9;
    assert.notEqual(coupledStateHash(loaded), before);
  });
});

test('the event stream carries world contacts and subsystem events, with scene ids', () => {
  const platform = run(COUPLED_EXAMPLE_SCENES['suspended-platform'](), 600, (loaded, view) => view.readout().events);
  assert.ok(platform.events > 0);
  assert.ok(platform.extra.some(e => e.source === 'world' && e.type === 'contact-begin' && /bodyA (platform|load-\d)/.test(e.detail)), JSON.stringify(platform.extra));
  const hopper = run(COUPLED_EXAMPLE_SCENES['hopper-seesaw'](), 360, (loaded, view) => view.readout().events);
  assert.ok(hopper.extra.some(e => e.source === 'beads' && /^contact-(begin|end)$/.test(e.type) && /body (plank|tray-|counterweight)/.test(e.detail)), JSON.stringify(hopper.extra));
});

// ---------------------------------------------------------------------------
// Solids, fracture and heat
// ---------------------------------------------------------------------------

test('solid and heat sections: problems are reported with their paths', () => {
  const problems = (make, edit) => { const scene = make(); edit(scene); return validateScene(scene).map(p => `${p.path}: ${p.message}`).join('\n'); };
  assert.match(problems(rubberPadScene, s => { s.solids[0].mesh.box.cells = [0, 2, 2]; }), /\/solids\/0\/mesh\/box\/cells\/0: must be >= 1/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].mesh.box.cells = [100, 100, 100]; }), /\/solids\/0\/mesh\/box\/cells: make 1030301 nodes/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].mesh = {positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], tets: [0, 1, 2, 7]}; }), /\/solids\/0\/mesh\/tets\/3: must be a node index below 4/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].material.poissonRatio = 0.5; }), /\/solids\/0\/material\/poissonRatio: must be <= 0.4999/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].integrator = 'explicit'; }), /\/solids\/0\/integrator: a solid in contact uses 'backward-euler'/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].contact.bodies.push({body: 'nobody'}); }), /\/solids\/0\/contact\/bodies\/2\/body: unknown body id "nobody"/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].welds[0].body = 'box2'; }), /\/solids\/0\/welds\/0\/body: body "box2" is not in this solid's contact.bodies/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].welds[0].max = [-2, 0, 0]; }), /\/solids\/0\/welds\/0\/max: must not be below min/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].displacements = [0, 0]; }), /\/solids\/0\/displacements: must hold exactly 729 numbers, got 2/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].id = 'box'; }), /\/solids\/0\/id: duplicate id "box"/);
  assert.match(problems(rubberPadScene, s => { s.solids[0].fracture = {strength: 1e6, toughness: 10}; }), /\/solids\/0\/model: a solid with fracture is 'linear'[\s\S]*\/solids\/0\/contact: a solid with fracture has no contact/);
  assert.match(problems(notchedBeamScene, s => { s.solids[0].fracture.toughness = -1; }), /\/solids\/0\/fracture\/toughness: must be >= 1e-12/);
  assert.match(problems(notchedBeamScene, s => { s.solids[0].fracture.insertion = 'always'; }), /\/solids\/0\/fracture\/insertion: must be 'on-demand' or 'manual'/);
  assert.match(problems(notchedBeamScene, s => { s.solids[0].cracks = [{face: 3, history: [1, 2]}]; }), /\/solids\/0\/cracks\/0\/history: must hold exactly 3 numbers/);
  assert.match(problems(notchedBeamScene, s => { s.solids[0].loads[0].body = 'ghost'; }), /\/solids\/0\/loads\/0\/body: unknown body id "ghost"/);
  assert.match(problems(heatedBarScene, s => { s.solids[0].cracks = []; }), /\/solids\/0\/cracks: belongs to a solid with fracture/);
  assert.match(problems(heatedBarScene, s => { s.heat[0].solid = 'nothing'; }), /\/heat\/0\/solid: unknown solid id "nothing"/);
  assert.match(problems(heatedBarScene, s => { s.solids[0].mesh = {positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], tets: [0, 1, 2, 3]}; delete s.solids[0].supports; }), /\/heat\/0\/solid: solid "bar" needs a box mesh/);
  assert.match(problems(heatedBarScene, s => { s.heat.push({...s.heat[0], id: 'second'}); }), /\/heat\/1\/solid: solid "bar" already has a heat grid/);
  assert.match(problems(heatedBarScene, s => { s.heat[0].temperature = [300, 301]; }), /\/heat\/0\/temperature: must hold exactly 40 numbers[\s\S]*\/heat\/0\/reference: is required when the temperature is given per cell/);
  assert.match(problems(heatedBarScene, s => { s.heat[0].boundaries[0].type = 'glow'; }), /\/heat\/0\/boundaries\/0\/type: must be 'temperature', 'flux', 'convection' or 'radiation'/);
  assert.match(problems(heatedBarScene, s => { s.heat[0].boundaries[0].region = {min: [0, 0, 0], max: [10, 0, 0]}; }), /\/heat\/0\/boundaries\/0\/region\/max\/0: must be <= 9/);
  assert.match(problems(quenchedPlateScene, s => { s.heat[0].scheme = 'leapfrog'; }), /\/heat\/0\/scheme: must be 'backward-euler'/);
  // A solid the solver refuses is reported with its id, and the world is left reset.
  withWorld(world => {
    const scene = notchedBeamScene(); scene.solids[0].integrator = 'explicit';
    assert.throws(() => loadLabScene(world, scene), /Scene solid "beam":/);
    assert.equal(world.bodyCount(), 1, 'reset to the scene settings: only the ground slab');
  });
  // Defaults written out do not change the hash, and rigid scenes keep theirs (pinned in lab-scenes.test.mjs).
  const pad = rubberPadScene(), d = copy(pad);
  Object.assign(d.solids[0], {integrator: 'backward-euler', substeps: 1, massDamping: 0, gravity: true, displacements: new Array(729).fill(0)});
  Object.assign(d.solids[0].contact.bodies[0], {twoWay: true, collide: true});
  assert.equal(sceneHash(d), sceneHash(pad));
  const bar = heatedBarScene(), e = copy(bar);
  Object.assign(e.heat[0], {scheme: 'backward-euler', substeps: 1, reference: e.heat[0].temperature});
  e.solids[0].supports[0].axes = [true, true, true];
  assert.equal(sceneHash(e), sceneHash(bar));
});

test('solids are built as their sections say: subsystems, contact, welds, loads, fracture and the thermal link', () => {
  withWorld(world => {
    const pad = loadLabScene(world, rubberPadScene()), runtime = pad.solids.get('pad');
    assert.deepEqual(pad.simulation.order().map(row => row.id), ['pad', 'world', 'events']);
    assert.ok(runtime.coupling && runtime.coupling.contact.weldCount === 81, `81 welded nodes, got ${runtime.coupling?.contact.weldCount}`);
    const beam = loadLabScene(world, notchedBeamScene()), body = beam.solids.get('beam').body;
    assert.ok(body instanceof FractureBody);
    assert.deepEqual(beam.simulation.order().map(row => row.id), ['world', 'beam:loads', 'beam', 'events']);
    const area = body.crackArea();
    assert.ok(Math.abs(area.precrack - 0.025 * 0.05) < 1e-12 && Math.abs(area.cohesive - 0.075 * 0.05) < 1e-12, JSON.stringify(area));
    const plate = loadLabScene(world, quenchedPlateScene());
    assert.deepEqual(plate.simulation.order().map(row => row.id), ['world', 'plate-heat', 'plate-heat:solid', 'plate', 'events']);
    assert.equal(plate.heat.get('plate-heat').cells, 60);
    assert.equal(plate.solids.get('plate').heat, plate.heat.get('plate-heat'));
  });
});

test('a cracked solid saved after N steps reopens from its link with the same nodes, interfaces and fields; heat and contact too', async () => {
  for (const [name, steps] of [['quenched-plate', 150], ['notched-beam', 180], ['rubber-pad', 70], ['heated-bar', 120]]) {
    const original = run(COUPLED_EXAMPLE_SCENES[name](), steps, loaded => ({
      solids: [...loaded.solids.values()].map(s => ({nodes: s.body.nodeCount, cracks: s.body instanceof FractureBody ? s.body.crackState().length : 0, area: s.body instanceof FractureBody ? s.body.crackArea() : null,
        positions: Array.from(s.body.referencePositions, (x, i) => x + s.body.displacements[i]).map((v, i, all) => i % 3 === 0 ? `${all[i]},${all[i + 1]},${all[i + 2]}` : null).filter(Boolean).sort()})),
      heat: [...loaded.heat.values()].map(h => Array.from(h.temperature)),
    }));
    if (name === 'quenched-plate') assert.ok(original.extra.solids[0].cracks > 20 && original.extra.solids[0].nodes > 154, `the plate has cracked: ${original.extra.solids[0].cracks} interfaces, ${original.extra.solids[0].nodes} nodes`);
    if (name === 'notched-beam') assert.ok(original.extra.solids[0].area.open > 0, 'the beam has cracked');
    const link = await encodeSceneLink(original.saved), reopened = decodeSceneLink(link);
    assert.equal(sceneHash(reopened), sceneHash(original.saved), `${name}: the link carries the saved scene`);
    const fields = withWorld(world => {
      const loaded = loadLabScene(world, reopened);
      for (const [id, s] of loaded.solids) {
        const saved = original.saved.solids.find(entry => entry.id === id);
        assert.deepEqual(Array.from(s.body.displacements), saved.displacements ?? new Array(3 * s.body.nodeCount).fill(0), `${name}: the solid starts from the saved displacements`);
        assert.deepEqual(Array.from(s.body.velocities), saved.velocities ?? new Array(3 * s.body.nodeCount).fill(0));
      }
      return {
        solids: [...loaded.solids.values()].map(s => ({nodes: s.body.nodeCount, cracks: s.body instanceof FractureBody ? s.body.crackState().length : 0, area: s.body instanceof FractureBody ? s.body.crackArea() : null,
          positions: Array.from(s.body.referencePositions, (x, i) => x + s.body.displacements[i]).map((v, i, all) => i % 3 === 0 ? `${all[i]},${all[i + 1]},${all[i + 2]}` : null).filter(Boolean).sort()})),
        heat: [...loaded.heat.values()].map(h => Array.from(h.temperature)),
      };
    });
    assert.deepEqual(fields, original.extra, `${name}: same node count, interfaces, crack area, node positions bit for bit and temperatures`);
    const a = run(reopened, 30), b = run(decodeSceneLink(link), 30);
    assert.equal(b.final, a.final, `${name}: two fresh openings of the link stay identical`);
  }
});

test('the reaction load carries the weight of the body at rest; contact and crack events reach the readout', () => {
  const beam = run(notchedBeamScene(), 720, (loaded, view) => ({support: loaded.simulation.get('beam:loads').diagnostics().loads[0].support, mass: loaded.builder.world.getState(loaded.bodies.get('weight')).mass, events: view.readout().events,
    sag: Math.max(...Array.from(loaded.solids.get('beam').body.displacements, Math.abs)), open: loaded.solids.get('beam').body.crackArea().open}));
  assert.ok(beam.extra.sag < 1e-4 && beam.extra.open > 0, `the cracked beam stays on its supports: largest displacement ${beam.extra.sag} m, open crack area ${beam.extra.open} m^2`);
  const weight = beam.extra.mass * 9.81;
  assert.ok(Math.abs(beam.extra.support[1] - weight) < 1e-3 * weight, `support ${beam.extra.support[1]} N against the weight ${weight} N`);
  const pad = run(rubberPadScene(), 70, (loaded, view) => view.readout().events);
  assert.ok(pad.extra.some(e => e.source === 'pad' && e.type === 'contact-begin' && /body box/.test(e.detail)), JSON.stringify(pad.extra));
  const plate = run(quenchedPlateScene(), 120, (loaded, view) => view.readout().events);
  assert.ok(plate.extra.some(e => e.source === 'plate' && e.type === 'crack' && /kind (initiated|opened)/.test(e.detail)), JSON.stringify(plate.extra));
});

test('solids are coloured in bands of the chosen field, and cracks are drawn as two surfaces', () => {
  assert.deepEqual(rampColor(0).map(v => +v.toFixed(2)), [0.16, 0.29, 0.78]);
  assert.deepEqual(rampColor(1).map(v => +v.toFixed(2)), [0.86, 0.2, 0.16]);
  assert.equal(solidBand(0, 0, 1), 0); assert.equal(solidBand(1, 0, 1), SOLID_BANDS - 1); assert.equal(solidBand(0.5, 0, 1), 4); assert.equal(solidBand(NaN, 0, 1), 0);
  // Each boundary face of a two-tetrahedron mesh belongs to the element that holds it.
  assert.deepEqual(Array.from(boundaryFaceElements([0, 1, 2, 1, 2, 4], [0, 1, 2, 3, 1, 2, 3, 4], null)), [0, 1]);
  withWorld(world => {
    const loaded = loadLabScene(world, quenchedPlateScene()), view = new CoupledSceneView(loaded, world);
    for (let i = 0; i < 150; i++) view.step();
    for (const field of ['stress', 'temperature', 'damage']) {
      view.setSolidView({field, scale: 100}); assert.equal(view.sync(), true);
      const info = view.drawInfo(), solid = view.solidView().solids[0];
      assert.ok(info.crackFaces > 0 && info.solidTriangles === loaded.solids.get('plate').body.faces.length / 3 + 2 * info.crackFaces, JSON.stringify(info));
      assert.equal(info.meshVertices, 3 * info.solidTriangles);
      if (field === 'temperature') assert.deepEqual([solid.min, solid.max], [300, 600]);
      if (field === 'damage') assert.equal(solid.peak, 1);
      // An empty band is drawn with no size, never as the unit box a mesh row without geometry would be.
      for (let row = view.rowCount - SOLID_BANDS; row < view.rowCount; row++) {
        const geometry = view.shapeGeometry(row);
        if (geometry === null) assert.deepEqual(Array.from(view.HEAPF32.subarray(16 * row, 16 * row + 16)), new Array(16).fill(0));
      }
    }
    assert.throws(() => view.setSolidView({field: 'colour'}), /Unknown solid field/);
    view.dispose();
  });
});
