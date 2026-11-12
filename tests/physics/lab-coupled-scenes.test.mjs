// Coupled scenes in the Physics Lab: the code path the page uses (loadLabScene, which builds every scene with
// loadSimulationScene, and CoupledSceneView, which steps it through its Simulation and builds the rows the renderer
// draws), run in node against the real WASM world. What is checked:
//  - the cloth and grain sections of the scene format: validation with paths, normal form, hash, share links;
//  - each coupled example runs the same, bit for bit, twice;
//  - a save at step N (what Copy share link and Download write), reopened from its link in a fresh world, has the
//    same scene hash, starts from the same solver fields, and two such reopenings stay identical;
//  - what is drawn: rows, meshes and rope segments;
//  - rigid scenes are unchanged: their Simulation has no subsystems and steps exactly like the world.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {
  COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, canonicalize, decodeSceneLink, encodeSceneLink, encodeSceneLinkSync, loadScene, normalizeScene, sceneHash,
  sceneHasCoupling, trampolineScene, hopperSeesawScene, validateScene,
} from '../../src/engine/scene-format.ts';
import {exactTransformHash, loadLabScene} from '../../src/lab/scene-host.ts';
import {CoupledSceneView, coupledStateHash, grainWallMesh, sceneIsCoupled, waterDrawGrid, writeTwoSidedMesh, writeWaterMesh} from '../../src/lab/coupled-scene.ts';
import {COUPLED_EXAMPLE_NAMES, LAB_EXAMPLE_NAMES, parseSceneRequest, resolveSceneRequest, sceneCameraFrame, sceneSummary} from '../../src/lab/scene-loading.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));

const withWorld = run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return run(world); } finally { world.destroy(); } };
/** Steps of each example in the repeat test: about one second, fewer for the slow ones. */
const STEPS = {'moored-buoy': 240, 'cable-stayed-deck': 240, 'buoy-and-crates': 360, trampoline: 150, 'hopper-seesaw': 360, 'suspended-platform': 480};
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
  assert.deepEqual(COUPLED_EXAMPLE_NAMES, ['moored-buoy', 'cable-stayed-deck', 'buoy-and-crates', 'trampoline', 'hopper-seesaw', 'suspended-platform']);
  assert.deepEqual(LAB_EXAMPLE_NAMES, [...Object.keys(EXAMPLE_SCENES), ...COUPLED_EXAMPLE_NAMES]);
  for (const name of COUPLED_EXAMPLE_NAMES) {
    const request = parseSceneRequest(`?example=${name}`);
    assert.deepEqual(request, {kind: 'example', name});
    const read = resolveSceneRequest(request);
    assert.equal(read.ok, true, name);
    assert.equal(sceneHash(read.scene), sceneHash(COUPLED_EXAMPLE_SCENES[name]()));
    assert.equal(sceneIsCoupled(read.scene), true);
    assert.match(sceneSummary(read.scene), /basin|cable|frame|cloth|grains/);
    const frame = sceneCameraFrame(read.scene);
    assert.ok(frame.distance > 1 && frame.distance < 40 && frame.target.every(Number.isFinite), `${name}: ${JSON.stringify(frame)}`);
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
