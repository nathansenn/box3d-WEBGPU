// How the Physics Lab reads scene input (src/lab/scene-loading.ts) and builds it in a native world
// (src/lab/scene-host.ts): address parsing, file-type detection, the import scale heuristic, the
// geometry-to-body decision, error lists, and that nothing is half-loaded.
// The comparison with the kit's own loadScene needs the built kit, so it is
// packages/box3d-kit/test/v13-lab-scenes.test.mjs (npm run test:kit).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {isClosed, meshVolume, weldVertices} from '../../src/engine/geometry.ts';
import {
  EXAMPLE_SCENES, SCENE_LIMITS, SceneValidationError, canonicalize, decodeSceneLink, encodeSceneLink, encodeSceneLinkSync, sceneHash, validateScene,
} from '../../src/engine/scene-format.ts';
import {LabSceneHost, exactTransformHash, loadLabScene, sceneStepsPerLabTick} from '../../src/lab/scene-host.ts';
import {
  EXAMPLE_SCENE_NAMES, EXAMPLE_SCENE_TITLES, LAB_SCENE_LIMITS, chooseImportScale, detectFileKind, importGeometry, parseSceneRequest, planImportBody,
  problemLines, quoteForDisplay, readLabFile, readSceneText, resolveSceneRequest, sceneCameraFrame, sceneFileName, sceneSummary, shortFloat32,
} from '../../src/lab/scene-loading.ts';
import {bracketObj, gemMesh, halfPipeObj, meshToGlb, meshToObj, showcaseScene, stlBinary, torusMesh} from './lab-scene-fixtures.mjs';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const utf8 = text => new TextEncoder().encode(text);
const withWorld = run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return run(world); } finally { world.destroy(); } };

test('the address says which scene to open', async () => {
  assert.equal(parseSceneRequest(''), null);
  assert.equal(parseSceneRequest('?lab=titan-hauler-crash&si=mechanisms&seed=3'), null);
  assert.deepEqual(parseSceneRequest('?example=ragdoll'), {kind: 'example', name: 'ragdoll'});
  assert.deepEqual(parseSceneRequest('?lab=x&example=terrain-car&autoplay=0'), {kind: 'example', name: 'terrain-car'});
  for (const name of ['nope', '__proto__', 'constructor', 'toString', '']) {
    const request = parseSceneRequest(`?example=${encodeURIComponent(name)}`);
    assert.equal(request.kind, 'error', name);
    assert.match(request.message, /pendulum-wave, newtons-cradle, domino-run, terrain-car, ragdoll/);
  }
  assert.equal(parseSceneRequest(`?example=${'x'.repeat(5000)}`).message.length < 400, true, 'a long name is not echoed in full');
  const link = await encodeSceneLink(EXAMPLE_SCENES['domino-run']());
  assert.deepEqual(parseSceneRequest(`?scene=${link}`), {kind: 'link', text: link});
  assert.deepEqual(parseSceneRequest(`?example=ragdoll&scene=${link}`), {kind: 'link', text: link}, 'scene wins over example');
  assert.deepEqual(parseSceneRequest('', `#scene=${link}`), {kind: 'link', text: link}, 'the fragment is read too');
  assert.deepEqual(parseSceneRequest('?lab=x', `#example=ragdoll`), {kind: 'example', name: 'ragdoll'});
  assert.deepEqual(parseSceneRequest('?example=ragdoll', `#scene=${link}`), {kind: 'example', name: 'ragdoll'}, 'the query wins over the fragment');
  const json = JSON.stringify({format: 'box3d-scene', version: 1, bodies: []});
  assert.deepEqual(parseSceneRequest(`?scene=${encodeURIComponent(json)}`), {kind: 'json', text: json});
  assert.equal(parseSceneRequest('?scene=').kind, 'error');
  assert.equal(parseSceneRequest(`?scene=${encodeURIComponent(`{"pad":"${'x'.repeat(LAB_SCENE_LIMITS.urlJsonChars)}"}`)}`).title, 'The scene in the address is too large');
  assert.equal(parseSceneRequest(`?scene=${'A'.repeat(SCENE_LIMITS.linkChars + 1)}`).title, 'The scene link is too long');
  assert.deepEqual(EXAMPLE_SCENE_NAMES, ['pendulum-wave', 'newtons-cradle', 'domino-run', 'terrain-car', 'ragdoll']);
  assert.deepEqual(Object.keys(EXAMPLE_SCENE_TITLES), EXAMPLE_SCENE_NAMES, 'every example has a title');
});

test('a request becomes a validated scene or a list of problems, and never throws', async () => {
  for (const name of EXAMPLE_SCENE_NAMES) {
    const read = resolveSceneRequest({kind: 'example', name});
    assert.equal(read.ok, true);
    assert.deepEqual([read.source, read.title], [{kind: 'example', name}, read.scene.meta?.title ?? EXAMPLE_SCENE_TITLES[name]]);
    assert.equal(sceneHash(read.scene), sceneHash(EXAMPLE_SCENES[name]()));
    // A link made from it opens as the same scene, compressed or stored.
    for (const link of [await encodeSceneLink(read.scene), encodeSceneLinkSync(read.scene), `https://example.org/lab.html?scene=${await encodeSceneLink(read.scene)}`]) {
      const opened = resolveSceneRequest({kind: 'link', text: link});
      assert.equal(opened.ok, true);
      assert.equal(canonicalize(opened.scene), canonicalize(read.scene));
      assert.equal(opened.source.kind, 'link');
    }
  }
  assert.equal(resolveSceneRequest({kind: 'example', name: 'constructor'}).ok, false);
  // Links that cannot be decoded: one problem with the decoder's reason.
  const good = await encodeSceneLink(EXAMPLE_SCENES.ragdoll());
  const flip = good.slice(0, -6) + (good.at(-6) === 'A' ? 'B' : 'A') + good.slice(-5);
  for (const text of ['hello', 'b3s1', 'b3s9d.1.00000000.AA', good.slice(0, good.length - 40), flip, `b3s1r.5.00000000.${'A'.repeat(7)}`]) {
    const read = resolveSceneRequest({kind: 'link', text});
    assert.equal(read.ok, false, text.slice(0, 30));
    assert.equal(read.title, 'This share link cannot be opened');
    assert.equal(read.problems.length, 1);
    assert.ok(read.problems[0].message.length > 10);
  }
  // A link that decodes to JSON that is not a valid scene: the validator's list, with JSON pointers.
  const broken = {format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'sphere', radius: -1}, position: [0, 1, 0]}, {id: 'a', shape: {kind: 'cube'}, position: [0, 0]}], joints: [{id: 'j', type: 'weld', bodyA: 'a', bodyB: 'ghost'}]};
  const stored = bytes => `b3s1r.${bytes.length.toString(36)}.${crc32(bytes).toString(16).padStart(8, '0')}.${Buffer.from(bytes).toString('base64url')}`;
  const invalid = resolveSceneRequest({kind: 'link', text: stored(utf8(JSON.stringify(broken)))});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.title, 'The scene in this link is not valid');
  assert.deepEqual(invalid.problems, validateScene(broken));
  assert.ok(invalid.problems.some(problem => problem.path === '/bodies/0/shape/radius'));
  // The same scene as JSON in the address.
  const fromJson = resolveSceneRequest({kind: 'json', text: JSON.stringify(broken)});
  assert.deepEqual([fromJson.ok, fromJson.title, fromJson.problems], [false, 'This scene is not valid', validateScene(broken)]);
  assert.equal(resolveSceneRequest({kind: 'json', text: '{"format":'}).title, 'This is not valid JSON');
  assert.equal(resolveSceneRequest({kind: 'json', text: JSON.stringify(EXAMPLE_SCENES['pendulum-wave']())}).ok, true);
  assert.deepEqual(resolveSceneRequest({kind: 'error', title: 't', message: 'm'}), {ok: false, title: 't', problems: [{path: '', message: 'm'}]});
  // A wrong version is reported alone.
  assert.deepEqual(readSceneText('{"format":"box3d-scene","version":3,"bodies":[]}', {kind: 'json'}, 'x').problems.map(problem => problem.path), ['/version']);
  // Problem lists are bounded for the page.
  const many = {format: 'box3d-scene', version: 1, bodies: Array.from({length: 150}, () => ({}))};
  const found = validateScene(many), lines = problemLines(found);
  assert.ok(found.length >= SCENE_LIMITS.problems, 'the validator stops at its own limit');
  assert.deepEqual([lines.lines.length, lines.more], [LAB_SCENE_LIMITS.shownProblems, found.length - LAB_SCENE_LIMITS.shownProblems]);
  assert.match(lines.lines[0], /^\/bodies\/0/);
});
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return ~crc >>> 0;
}

test('file types are told apart by name and by content', () => {
  const glb = meshToGlb(gemMesh()), stl = stlBinary(gemMesh());
  assert.equal(detectFileKind('part.glb', glb), 'glb');
  assert.equal(detectFileKind('part.json', glb), 'glb', 'the glTF magic wins over the extension');
  assert.equal(detectFileKind('renamed', glb), 'glb');
  assert.equal(detectFileKind('scene.json', utf8('{"format":"box3d-scene"}')), 'json');
  assert.equal(detectFileKind('SCENE.JSON', utf8('{}')), 'json');
  assert.equal(detectFileKind('model.gltf', utf8('{"asset":{"version":"2.0"}}')), 'gltf');
  assert.equal(detectFileKind('a.b.OBJ', utf8('v 0 0 0')), 'obj');
  assert.equal(detectFileKind('part.stl', stl), 'stl');
  assert.equal(detectFileKind('part.STL', utf8('solid x\nendsolid x')), 'stl');
  // No extension: sniffed.
  assert.equal(detectFileKind('scene', utf8('  \n {"format":"box3d-scene"}')), 'json');
  assert.equal(detectFileKind('scene', new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8('{}')])), 'json', 'a byte-order mark is skipped');
  assert.equal(detectFileKind('part', utf8('solid thing\nfacet normal 0 0 1')), 'stl');
  assert.equal(detectFileKind('part', utf8('# comment\n# another\nv 0 0 0\nv 1 0 0')), 'obj');
  assert.equal(detectFileKind('part.txt', utf8('o thing\nv 0 0 0')), 'obj');
  assert.equal(detectFileKind('notes.txt', utf8('hello there')), null);
  assert.equal(detectFileKind('photo.png', new Uint8Array([0x89, 0x50, 0x4E, 0x47])), null);
  assert.equal(detectFileKind('part', stl), null, 'a binary STL has no signature, so it needs its extension');
  assert.equal(detectFileKind('empty', new Uint8Array(0)), null);
});

test('the scale heuristic reads CAD millimetres as millimetres and never makes a kilometre-sized body', () => {
  const scale = (side, fit) => chooseImportScale(side, fit).scale;
  // 0.05 to 10 units: metres, unchanged.
  for (const side of [0.05, 0.3, 1, 2.5, 10]) assert.equal(scale(side), 1, `${side} is read as metres`);
  // Above 10: millimetres when that lands in 0.05 m to 10 m.
  for (const side of [50, 200, 1000, 9999, 10000]) assert.equal(scale(side), 0.001, `${side} is read as millimetres`);
  assert.match(chooseImportScale(200).reason, /read as millimetres: 200 units across became 0\.2 m/);
  // Between the two readings (10 to 50), and beyond 10 m as millimetres: scaled to 2 m.
  for (const side of [10.5, 20, 49, 10001, 1e6, 1e9]) assert.ok(Math.abs(scale(side) * side - 2) < 1e-9, `${side} is scaled to 2 m`);
  // Below 5 cm: scaled to 1 m.
  for (const side of [0.049, 0.001, 1e-6]) assert.ok(Math.abs(scale(side) * side - 1) < 1e-9, `${side} is scaled to 1 m`);
  // Every result is between 5 cm and 10 m when fitting is on.
  for (let e = -8; e <= 9; e += 0.25) { const side = 10 ** e, size = side * scale(side); assert.ok(size >= 0.05 - 1e-12 && size <= 10 + 1e-9, `${side} -> ${size}`); }
  // Off: the file's numbers are metres, whatever they are.
  for (const side of [0.001, 1, 200, 1e6]) assert.equal(scale(side, false), 1);
  assert.match(chooseImportScale(200, false).reason, /scale to fit is off/);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => chooseImportScale(bad), RangeError);
});

test('the body decision: hull when convex, decomposed when concave and small, static mesh when open or large', () => {
  const welded = mesh => weldVertices(mesh, 0);
  assert.deepEqual(planImportBody(welded(gemMesh())), {mode: 'hull', reason: 'the surface is closed and convex'});
  const smallTorus = welded(torusMesh(16, 8));
  assert.equal(smallTorus.indices.length / 3, 256);
  assert.deepEqual(planImportBody(smallTorus), {mode: 'decomposed', reason: 'the surface is closed and concave'});
  const largeTorus = welded(torusMesh(64, 40));
  assert.equal(largeTorus.indices.length / 3, 5120);
  assert.ok(isClosed(largeTorus) && meshVolume(largeTorus) > 0);
  const large = planImportBody(largeTorus);
  assert.equal(large.mode, 'mesh');
  assert.match(large.reason, /closed but concave, and its 5120 triangles are more than the 5000/);
  // Exactly at the limit is still decomposed.
  assert.equal(planImportBody(welded(torusMesh(50, 50))).mode, 'decomposed');
  // An open surface: drop one triangle of the gem.
  const gem = gemMesh(), open = {vertices: gem.vertices, indices: gem.indices.slice(3)};
  const plan = planImportBody(welded(open));
  assert.equal(plan.mode, 'mesh');
  assert.match(plan.reason, /not closed/);
});

test('dropped geometry becomes one body in a default SI scene, with a note that says which and why', () => {
  // A concave bracket drawn in millimetres: read as millimetres, split into hulls, dynamic.
  const bracket = readLabFile({name: 'bracket.obj', bytes: utf8(bracketObj())});
  assert.equal(bracket.ok, true);
  assert.deepEqual([bracket.source, bracket.title], [{kind: 'geometry', name: 'bracket.obj'}, 'bracket.obj']);
  assert.deepEqual(validateScene(bracket.scene), []);
  assert.deepEqual(bracket.scene.world, {gravity: [0, -9.81, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4});
  assert.equal(bracket.scene.bodies.length, 2);
  assert.ok(bracket.scene.bodies.every(body => body.shape.kind === 'hull' && (body.type ?? 'dynamic') === 'dynamic' && body.filter.groupIndex === -1));
  assert.deepEqual(bracket.scene.joints.map(joint => [joint.type, joint.bodyA, joint.bodyB]), [['weld', 'part-0', 'part-1']]);
  assert.match(bracket.notes[0], /^Size: read as millimetres: 200 units across became 0\.2 m\.$/);
  assert.match(bracket.notes[1], /^Dynamic body: the surface is closed and concave, so it was split into 2 convex hulls welded together/);
  assert.match(bracket.notes[2], /^Mass 2\.4 kg: 0\.0024 m³ at 1000 kg\/m³\.$/);
  // Its extent is 0.2 m, centred, and it starts 0.3 m above the ground.
  const all = bracket.scene.bodies.flatMap(body => body.shape.points);
  assert.ok(Math.abs(Math.max(...all) - 0.1) < 1e-6 && Math.abs(Math.min(...all) + 0.1) < 1e-6);
  assert.ok(Math.abs(bracket.scene.bodies[0].position[1] - 0.4) < 1e-6, 'half height 0.1 m plus 0.3 m');
  // The same file with scale to fit off is 200 m across.
  const unscaled = readLabFile({name: 'bracket.obj', bytes: utf8(bracketObj())}, {scaleToFit: false});
  assert.ok(Math.abs(Math.max(...unscaled.scene.bodies.flatMap(body => body.shape.points)) - 100) < 1e-3);
  assert.match(unscaled.notes[0], /kept at the file's size, read as metres \(200 m across\); scale to fit is off/);

  // A convex gem as binary STL, in metres already: one dynamic hull.
  const gem = readLabFile({name: 'gem.stl', bytes: stlBinary(gemMesh())});
  assert.equal(gem.ok, true);
  assert.deepEqual(gem.scene.bodies.map(body => [body.id, body.shape.kind]), [['part-0', 'hull']]);
  assert.equal(gem.scene.joints.length, 0);
  assert.match(gem.notes[0], /^Size: read as metres \(0\.74 m across\)\.$/);
  assert.match(gem.notes[1], /^Dynamic body: the surface is closed and convex, so it is one convex hull of 18 points\.$/);
  // The same gem as .glb and as OBJ gives the same body: the same hull points (their order follows the file's vertex order).
  const points = read => { const p = read.scene.bodies[0].shape.points, out = []; for (let i = 0; i < p.length; i += 3) out.push(`${p[i]},${p[i + 1]},${p[i + 2]}`); return out.sort(); };
  const rest = read => { const {shape, ...body} = read.scene.bodies[0]; return [shape.kind, body, read.scene.world, read.notes]; };
  const asGlb = readLabFile({name: 'gem.glb', bytes: meshToGlb(gemMesh())}), asObj = readLabFile({name: 'gem.obj', bytes: utf8(meshToObj(gemMesh()))});
  assert.equal(asGlb.ok && asObj.ok, true);
  for (const other of [asGlb, asObj]) { assert.deepEqual(points(other), points(gem)); assert.deepEqual(rest(other), rest(gem)); }

  // An open half-pipe: a static mesh, with the reason.
  const pipe = readLabFile({name: 'halfpipe.obj', bytes: utf8(halfPipeObj())});
  assert.equal(pipe.ok, true);
  // The normal form leaves `type` out of a mesh body, which is always static; the next test reads 'static' back from the engine.
  assert.deepEqual(pipe.scene.bodies.map(body => [body.id, body.shape.kind, body.type]), [['mesh', 'mesh', undefined]]);
  assert.match(pipe.notes[1], /^Static mesh \(it does not move\): the surface is not closed .* so it encloses no volume and has no mass\. 32 triangles\.$/);
  assert.ok(Math.abs(pipe.scene.bodies[0].position[1] - 0.502) < 1e-6, 'its lowest point is 2 mm above the ground');
  // A closed but large concave mesh: static too, and the note says why.
  const big = importGeometry([torusMesh(64, 40)], {name: 'torus'});
  assert.equal(big.scene.bodies[0].shape.kind, 'mesh');
  assert.match(big.notes[1], /closed but concave, and its 5120 triangles are more than the 5000/);
  // Several objects in one file are merged into one body.
  const two = importGeometry([gemMesh(), gemMesh()], {name: 'two'});
  assert.match(two.notes[0], /The file's 2 objects were merged into one body\./);
  // The description travels with the scene.
  assert.match(bracket.scene.meta.description, /^Imported geometry\. Size: read as millimetres/);
});

test('imported bodies simulate: the dynamic ones fall and come to rest, the static mesh stays', () => {
  for (const [name, bytes, dynamic] of [['bracket.obj', utf8(bracketObj()), true], ['gem.stl', stlBinary(gemMesh()), true], ['halfpipe.obj', utf8(halfPipeObj()), false]]) {
    const read = readLabFile({name, bytes});
    withWorld(world => {
      const loaded = loadLabScene(world, read.scene), host = loaded.builder.world;
      const first = [...loaded.bodies.values()][0], before = host.getState(first);
      assert.equal(before.type, dynamic ? 'dynamic' : 'static', name);
      for (let i = 0; i < 300; i++) host.step();
      const after = host.getState(first);
      if (dynamic) {
        assert.ok(after.position[1] < before.position[1] - 0.1, `${name} fell`);
        assert.ok(after.position[1] > 0, `${name} rests on the ground slab`);
        assert.ok(Math.hypot(...after.linearVelocity) < 0.05, `${name} came to rest (${Math.hypot(...after.linearVelocity)} m/s)`);
        assert.ok(after.mass > 0);
      } else {
        assert.deepEqual(after.position, before.position, `${name} did not move`);
        assert.equal(world.bodyShape(1).kind, 'mesh');
      }
    });
  }
  // The decomposed bracket weighs what its volume says: 2.4 kg in total.
  withWorld(world => {
    const loaded = loadLabScene(world, readLabFile({name: 'bracket.obj', bytes: utf8(bracketObj())}).scene);
    const mass = [...loaded.bodies.values()].reduce((sum, body) => sum + loaded.builder.world.getState(body).mass, 0);
    assert.ok(Math.abs(mass - 2.4) < 0.01, `total mass ${mass} kg`);
  });
});

// A decomposed body is many hulls held by weld joints. Welded all to one piece at the body origin, 16 pieces of
// this torus flew apart (tens of metres, hundreds of m/s) even in free fall; welded piece to nearest piece they hold.
test('a body split into many convex hulls stays in one piece, in free fall and when it lands', () => {
  for (const [around, tube] of [[24, 12], [16, 8], [50, 50]]) {
    const read = importGeometry([torusMesh(around, tube)], {name: 'torus'});
    assert.equal(read.ok, true);
    const pieces = read.scene.bodies.length;
    assert.equal(pieces, 16);
    assert.equal(read.scene.joints.length, pieces - 1, 'a tree of welds: every piece but the first is welded to an earlier one');
    read.scene.joints.forEach((joint, k) => {
      assert.equal(joint.bodyB, `part-${k + 1}`);
      assert.ok(Number(joint.bodyA.slice(5)) <= k, 'welded to an earlier piece');
      assert.deepEqual(joint.frameA.position, joint.frameB.position, 'the pieces share one pose, so one anchor serves both');
    });
    assert.match(read.notes[1], /split into 16 convex hulls welded together \(their volume is \d+(\.\d+)?% (over|under) the mesh's\)/);
    for (const ground of [false, true]) {
      withWorld(world => {
        const loaded = loadLabScene(world, {...read.scene, world: {...read.scene.world, ground}}), host = loaded.builder.world, bodies = [...loaded.bodies.values()];
        const start = host.getState(bodies[0]).position[1];
        let spread = 0, top = -Infinity;
        for (let i = 0; i < 480; i++) {
          host.step();
          const positions = bodies.map(body => host.getState(body).position);
          // Every piece was created at the same pose, so in a rigid body their origins stay together.
          for (const p of positions) { spread = Math.max(spread, Math.hypot(p[0] - positions[0][0], p[1] - positions[0][1], p[2] - positions[0][2])); top = Math.max(top, p[1]); }
        }
        assert.ok(spread < 0.05, `${around}x${tube}, ground ${ground}: the pieces stayed within ${spread} m of each other`);
        assert.ok(top <= start + 1e-3, `${around}x${tube}, ground ${ground}: nothing was thrown upward (top ${top}, start ${start})`);
        const speeds = bodies.map(body => Math.hypot(...host.getState(body).linearVelocity));
        if (ground) assert.ok(Math.max(...speeds) < 0.05, `it came to rest (${Math.max(...speeds)} m/s)`);
        // Free fall for 8 s: every piece has the speed g t.
        else for (const speed of speeds) assert.ok(Math.abs(speed - 9.81 * 8) < 0.05, `free-fall speed ${speed}`);
        const mass = bodies.reduce((sum, body) => sum + host.getState(body).mass, 0);
        assert.ok(Math.abs(mass / (meshVolume(weldVertices(torusMesh(around, tube), 0)) * 1000) - 1) < 0.01, `total mass ${mass} kg is the mesh volume times the density`);
      });
    }
  }
});

test('files that cannot be used are reported and give no scene', () => {
  const titles = [
    [{name: 'empty.obj', bytes: new Uint8Array(0)}, /is empty/],
    [{name: 'notes.txt', bytes: utf8('just some words')}, /is not a file the Lab reads/],
    [{name: 'bad.json', bytes: utf8('{"format": "box3d-scene", ')}, /is not valid JSON/],
    [{name: 'list.json', bytes: utf8('[1, 2, 3]')}, /is not a valid scene/],
    [{name: 'wrong.json', bytes: utf8('{"format":"box3d-scene","version":1,"bodies":[{"id":"a"}],"extra":1}')}, /is not a valid scene/],
    [{name: 'broken.glb', bytes: new Uint8Array([0x67, 0x6C, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0])}, /could not be read/],
    [{name: 'broken.stl', bytes: new Uint8Array(100)}, /could not be read|has no geometry/],
    [{name: 'points.obj', bytes: utf8('v 0 0 0\nv 1 0 0\nv 0 1 0\n')}, /could not be read|has no geometry/],
    [{name: 'flat.obj', bytes: utf8('v 0 0 0\nv 0 0 0\nv 0 0 0\nf 1 2 3\n')}, /has no geometry|has no size|could not be/],
    [{name: 'external.gltf', bytes: utf8(JSON.stringify({asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}], meshes: [{primitives: [{attributes: {POSITION: 0}}]}], buffers: [{uri: 'missing.bin', byteLength: 36}], bufferViews: [{buffer: 0, byteLength: 36}], accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}]}))}, /could not be read/],
  ];
  for (const [file, title] of titles) {
    const read = readLabFile(file);
    assert.equal(read.ok, false, file.name);
    assert.match(read.title, title, file.name);
    assert.ok(read.problems.length >= 1 && read.problems.every(problem => typeof problem.message === 'string' && problem.message.length > 0), file.name);
  }
  // A scene file's problems are the validator's, path by path.
  const wrong = JSON.parse('{"format":"box3d-scene","version":1,"bodies":[{"id":"a"}],"extra":1}');
  assert.deepEqual(readLabFile({name: 'wrong.json', bytes: utf8(JSON.stringify(wrong))}).problems, validateScene(wrong));
  // A size cap is checked before the content is looked at.
  const huge = {name: 'huge.obj', bytes: {length: LAB_SCENE_LIMITS.fileBytes + 1}};
  assert.match(readLabFile(huge).title, /is too large/);
  // A .gltf finds its buffer among the files dropped with it.
  const gem = gemMesh(), positions = Float32Array.from(gem.vertices), indices = Uint32Array.from(gem.indices);
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0); bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const gltf = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}], meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
    buffers: [{uri: 'gem.bin', byteLength: bin.length}], bufferViews: [{buffer: 0, byteLength: positions.byteLength}, {buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength}],
    accessors: [{bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3'}, {bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR'}]};
  assert.equal(readLabFile({name: 'gem.gltf', bytes: utf8(JSON.stringify(gltf))}).ok, false, 'without its buffer');
  const withBuffer = readLabFile({name: 'gem.gltf', bytes: utf8(JSON.stringify(gltf))}, {companions: [{name: 'gem.bin', bytes: bin}]});
  assert.equal(withBuffer.ok, true);
  assert.equal(withBuffer.scene.bodies[0].shape.kind, 'hull');
  // A glTF saved with a .json name is still geometry, and a scene file is still a scene.
  assert.equal(readLabFile({name: 'gem.json', bytes: utf8(JSON.stringify(gltf))}, {companions: [{name: 'gem.bin', bytes: bin}]}).source.kind, 'geometry');
  const sceneFile = readLabFile({name: 'showcase.json', bytes: utf8(JSON.stringify(showcaseScene()))});
  assert.deepEqual([sceneFile.ok, sceneFile.source, sceneFile.title], [true, {kind: 'file', name: 'showcase.json'}, 'Shape showcase']);
});

test('text from a file or link is bounded and stripped of control characters before it is shown', () => {
  assert.equal(quoteForDisplay('plain'), 'plain');
  assert.equal(quoteForDisplay('a\u0000b\nc d\u009fe'), 'a b c d e');
  assert.equal(quoteForDisplay('x'.repeat(500), 10), `${'x'.repeat(10)}…`);
  const named = readLabFile({name: `evil\n<img src=x onerror=alert(1)>${'y'.repeat(300)}.txt`, bytes: utf8('nothing')});
  assert.ok(named.title.length < 140 && !named.title.includes('\n'));
  assert.equal(sceneFileName('Car on terrain'), 'Car-on-terrain.json');
  assert.equal(sceneFileName('bracket.obj'), 'bracket.json');
  assert.equal(sceneFileName('../../etc/passwd'), 'etc-passwd.json');
  assert.equal(sceneFileName('日本'), 'scene.json');
  assert.equal(sceneFileName('x'.repeat(500)).length, 64 + 5);
});

test('short float32 text reads back to the same float32', () => {
  for (const value of [0, -0, 1, -1, 0.1, 0.2, 1 / 3, 2.4e-3, 123456.789, 1e-30, 3.4028234e38, 0.30000001192092896, Math.PI, -Math.E * 1e7]) {
    const short = shortFloat32(value);
    assert.equal(Math.fround(short), Math.fround(value) + 0, String(value));
    assert.ok(String(short).length <= String(Math.fround(value)).length, `${short} is no longer than ${Math.fround(value)}`);
  }
  assert.equal(shortFloat32(0.1), 0.1);
  assert.equal(shortFloat32(Math.fround(0.2)), 0.2);
});

test('the scene summary and camera frame describe what was loaded', () => {
  const car = EXAMPLE_SCENES['terrain-car']();
  assert.equal(sceneSummary(car), '6 bodies (heightfield, box, sphere) · 4 joints (wheel) · gravity 9.81 m/s² · no ground slab');
  assert.equal(sceneSummary({format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'sphere', radius: 1}, position: [0, 1, 0]}]}), '1 body (sphere) · 0 joints · gravity 9.81 m/s² · ground slab');
  // The car on its long terrain: the view is centred on the car, not on the middle of the terrain.
  const frame = sceneCameraFrame(car), chassis = car.bodies.find(body => body.shape.kind === 'box');
  assert.ok(Math.hypot(frame.target[0] - chassis.position[0], frame.target[2] - chassis.position[2]) < 1.5, 'centred on the car');
  assert.ok(frame.distance >= 5 && frame.distance <= 40, `distance ${frame.distance}`);
  for (const name of EXAMPLE_SCENE_NAMES) {
    const f = sceneCameraFrame(EXAMPLE_SCENES[name]());
    assert.ok(f.target.every(Number.isFinite) && f.distance >= 0.9 && f.distance <= 400, name);
  }
  assert.deepEqual(sceneCameraFrame({format: 'box3d-scene', version: 1, bodies: []}), {target: [0, 1, 0], distance: 8});
});

test('a scene the engine refuses leaves an empty world, and an invalid one leaves the world untouched', () => {
  withWorld(world => {
    const first = loadLabScene(world, EXAMPLE_SCENES['domino-run']());
    for (let i = 0; i < 30; i++) first.builder.world.step();
    const count = world.bodyCount(), hash = exactTransformHash(world);
    // Invalid: SceneValidationError, and the dominoes are exactly as they were.
    assert.throws(() => loadLabScene(world, {format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'sphere', radius: 0}, position: [0, 1, 0]}]}), SceneValidationError);
    assert.deepEqual([world.bodyCount(), exactTransformHash(world)], [count, hash]);
    // Valid by the schema, refused by the engine: a mesh whose only triangle has no area.
    const refused = {format: 'box3d-scene', version: 1, bodies: [
      {id: 'fine', shape: {kind: 'sphere', radius: 0.2}, position: [0, 1, 0]},
      {id: 'sliver', shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2]}, position: [0, 2, 0]},
    ]};
    assert.deepEqual(validateScene(refused), []);
    assert.throws(() => loadLabScene(world, refused), /Scene body "sliver"/);
    assert.equal(world.bodyCount(), 1, 'only the ground slab is left: none of the scene was kept');
    assert.equal(world.bodyShape(0), null);
  });
});

// exactHash and replayHash of each example after 0, 60 and 300 steps.
// packages/box3d-kit/test/v13-lab-scenes.test.mjs checks that the kit's loadScene gives the same numbers.
test('each example loads through the Lab host and steps deterministically', () => {
  for (const name of EXAMPLE_SCENE_NAMES) {
    const run = () => withWorld(world => {
      const scene = EXAMPLE_SCENES[name](), loaded = loadLabScene(world, scene), host = loaded.builder.world;
      assert.ok(host instanceof LabSceneHost);
      // The host steps with the scene's own settings: the examples use 1/240 s and 1/120 s, not the Lab's 1/60 s.
      assert.deepEqual([host.loop.step, host.subSteps, host.seed], [scene.world.step, scene.world.subSteps ?? 4, scene.world.seed ?? 1]);
      assert.equal(sceneStepsPerLabTick(host.loop.step), name === 'pendulum-wave' || name === 'newtons-cradle' ? 4 : 2, `${name}: steps in one 1/60 s Lab tick`);
      assert.equal(world.bodyCount(), scene.bodies.length + (scene.world?.ground === false ? 0 : 1), name);
      assert.equal(loaded.joints.size, scene.joints?.length ?? 0);
      const hashes = [];
      for (const ticks of [0, 60, 300]) { while (host.tick < ticks) host.step(); hashes.push([host.exactHash(), host.replayHash()]); }
      // A save taken before the first step of a fresh load is the scene itself.
      return {hashes, saved: canonicalize(loadLabScene(world, scene).builder.toJSON())};
    });
    const a = run(), b = run();
    assert.deepEqual(a.hashes, b.hashes, `${name} repeats`);
    assert.equal(a.saved, canonicalize(EXAMPLE_SCENES[name]()), `${name} saves as it was loaded`);
    assert.notDeepEqual(a.hashes[0], a.hashes[2], `${name} moves`);
  }
});

test('a scene plays at real speed: the Lab takes as many of its steps as fit one 1/60 s tick', () => {
  assert.deepEqual([1 / 60, 1 / 120, 1 / 240, 1 / 30, 1 / 100, 1 / 1000].map(sceneStepsPerLabTick), [1, 2, 4, 1, 2, 17]);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => sceneStepsPerLabTick(bad), RangeError);
});

test('a share link of a running scene reopens with the same bodies and continues deterministically', async () => {
  for (const name of ['domino-run', 'terrain-car']) {
    const saved = withWorld(world => {
      const loaded = loadLabScene(world, EXAMPLE_SCENES[name]());
      for (let i = 0; i < 90; i++) loaded.builder.world.step();
      return loaded.builder.toJSON();
    });
    const link = await encodeSceneLink(saved);
    assert.ok(link.length < LAB_SCENE_LIMITS.addressLinkChars, `${name}: ${link.length} characters fit the address bar`);
    const reopened = resolveSceneRequest(parseSceneRequest(`?scene=${link}`));
    assert.equal(reopened.ok, true);
    assert.equal(sceneHash(reopened.scene), sceneHash(saved));
    assert.equal(sceneHash(decodeSceneLink(link)), sceneHash(saved));
    const after = () => withWorld(world => {
      const loaded = loadLabScene(world, reopened.scene), host = loaded.builder.world;
      assert.equal(world.bodyCount(), saved.bodies.length + (saved.world.ground ? 1 : 0));
      for (let i = 0; i < 120; i++) host.step();
      return [host.exactHash(), host.replayHash()];
    });
    assert.deepEqual(after(), after(), `${name}: two openings of the link agree step for step`);
  }
});

// The page builds a scene in a scratch world first, so a scene the engine refuses never replaces the one on screen.
test('a scratch build in a second world of the same module leaves the first one exactly as it was', () => {
  withWorld(shown => {
    const first = loadLabScene(shown, EXAMPLE_SCENES.ragdoll());
    for (let i = 0; i < 40; i++) first.builder.world.step();
    const before = [shown.bodyCount(), exactTransformHash(shown), first.builder.world.replayHash()];
    const refused = {format: 'box3d-scene', version: 1, bodies: [{id: 'sliver', shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2]}, position: [0, 2, 0]}]};
    assert.throws(() => withWorld(scratch => loadLabScene(scratch, refused)), /Scene body "sliver"/);
    withWorld(scratch => { loadLabScene(scratch, showcaseScene()); for (let i = 0; i < 10; i++) scratch.step(1 / 60, 4); });
    assert.deepEqual([shown.bodyCount(), exactTransformHash(shown), first.builder.world.replayHash()], before);
    // And it still continues as an undisturbed run does.
    const undisturbed = withWorld(world => { const loaded = loadLabScene(world, EXAMPLE_SCENES.ragdoll()); for (let i = 0; i < 80; i++) loaded.builder.world.step(); return loaded.builder.world.exactHash(); });
    for (let i = 0; i < 40; i++) first.builder.world.step();
    assert.equal(first.builder.world.exactHash(), undisturbed);
  });
});
