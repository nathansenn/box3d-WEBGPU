// The scene editor's model (src/lab/scene-editor-model.ts): every command, undo and redo back to
// byte-identical canonical JSON, rename and delete reaching the joints, refusals with the
// validator's message, snapping, the materials table, terrain determinism, joint frames, step
// warnings, the measurement series and its CSV, and autosave records. The scenes the editor
// produces are also built in the native world, the way the Lab builds them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {isClosed, meshVolume} from '../../src/engine/geometry.ts';
import {EXAMPLE_SCENES, canonicalize, decodeSceneLink, encodeSceneLinkSync, eulerToQuaternion, sceneHash, validateScene} from '../../src/engine/scene-format.ts';
import {loadLabScene} from '../../src/lab/scene-host.ts';
import {
  AUTOSAVE_MAX_CHARS, BODY_PRESETS, EditorError, GRAVITY_PRESETS, JOINT_TYPES, MATERIAL_PRESETS, MEASUREMENT_COLUMNS, MeasurementSeries, ROUND_SEGMENTS, SceneDocument,
  bodyEnergy, cameraProject, cameraRay, decodeAutosave, emptyScene, encodeAutosave, generateShape, generatedShapeOf, gravityPresetOf, jointFramesFromWorld, jointGeometryInScene,
  jointTraits, materialPreset, presetShape, principalInertia, quatRotate, quaternionToEuler, rayPlaneY, resolvedMaterial, restingHeight, rulerMeasure, shapeExtentAlong,
  shapeLocalBounds, shapeThickness, shapeVolume, snapValue, snapVec3, stepWarnings, terrainHeights, uniqueId,
} from '../../src/lab/scene-editor-model.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const withWorld = run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return run(world); } finally { world.destroy(); } };
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} vs ${expected} (±${tolerance})`);
const nearVec = (actual, expected, tolerance, message) => actual.forEach((value, k) => near(value, expected[k], tolerance, `${message ?? ''}[${k}]`));
const ok = (result) => { assert.equal(result.ok, true, result.ok ? '' : result.message); return result; };
const refused = (result, pattern) => { assert.equal(result.ok, false, 'the command should be refused'); assert.match(result.message, pattern); assert.ok(result.problems.length > 0); return result; };

/** A document with three bodies and a hinge, built by commands. */
function sample() {
  const doc = new SceneDocument();
  ok(doc.apply({type: 'addBody', preset: 'box', id: 'base', position: [0, 0.5, 0]}));
  ok(doc.apply({type: 'addBody', preset: 'sphere', id: 'ball', position: [0, 2, 0]}));
  ok(doc.apply({type: 'addBody', preset: 'capsule', id: 'arm', position: [1.5, 1, 0]}));
  ok(doc.apply({type: 'addJoint', jointType: 'revolute', id: 'hinge', bodyA: 'base', bodyB: 'arm', anchor: [0.5, 1, 0], axis: [0, 0, 1]}));
  return doc;
}

test('a new document is an empty, valid SI scene with the ground slab', () => {
  const doc = new SceneDocument();
  assert.deepEqual(validateScene(doc.scene), []);
  assert.equal(doc.scene.bodies.length, 0);
  assert.deepEqual(doc.scene.world, {gravity: [0, -9.81, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4});
  assert.equal(doc.scene.meta.title, 'Untitled scene');
  assert.equal(doc.canonical(), canonicalize(emptyScene()));
  assert.deepEqual([doc.canUndo, doc.canRedo, doc.undoLabel, doc.revision], [false, false, null, 0]);
  assert.equal(doc.undo(), null);
  assert.equal(doc.redo(), null);
  assert.throws(() => new SceneDocument({format: 'box3d-scene', version: 3, bodies: []}), /unsupported scene version/);
  assert.throws(() => new SceneDocument(EXAMPLE_SCENES['pendulum-wave'](), {historyLimit: 0}), RangeError);
  const withWater = {...emptyScene(), water: [{id: 'w', cols: 4, rows: 4, dx: 1, dz: 1, restDepth: 1, origin: [0, 0, 0]}]};
  assert.deepEqual(validateScene(withWater), []);
  assert.throws(() => new SceneDocument(withWater), EditorError, 'coupled scenes are not edited');
});

test('every command changes the scene, and undo and redo restore the exact canonical text', () => {
  const doc = sample();
  const commands = [
    {type: 'addBody', preset: 'wedge'},
    {type: 'addBody', preset: 'cylinder', position: [3, 0.5, 0]},
    {type: 'addBody', preset: 'cone', position: [5, 0.5, 0]},
    {type: 'addBody', preset: 'ramp', position: [0, 0, 6]},
    {type: 'addBody', preset: 'terrain-flat', position: [20, 0, 0]},
    {type: 'addBody', preset: 'terrain-slope', position: [20, 0, 20]},
    {type: 'addBody', preset: 'terrain-hills', position: [-20, 0, 0]},
    {type: 'duplicateBody', id: 'ball'},
    {type: 'rename', id: 'ball-1', newId: 'second-ball'},
    {type: 'setTransform', id: 'ball', position: [0.25, 3, -1]},
    {type: 'setTransform', id: 'base', rotationEuler: [0, 30, 0]},
    {type: 'setTransform', id: 'arm', rotation: [0, 0, 0.38268343, 0.92387953]},
    {type: 'setShape', id: 'base', shape: {kind: 'box', halfExtents: [1, 0.25, 0.75]}},
    {type: 'setShape', id: 'ball', shape: {kind: 'sphere', radius: 0.3}},
    {type: 'setShape', id: 'arm', shape: {kind: 'capsule', radius: 0.1, halfLength: 0.6}},
    {type: 'setGenerated', id: 'cylinder-1', generated: {preset: 'cylinder', radius: 0.2, height: 2}},
    {type: 'setGenerated', id: 'terrain-3', generated: {preset: 'terrain', fn: 'hills', countX: 9, countZ: 9, spacing: 2, amplitude: 3, seed: 7}},
    {type: 'setBodyType', id: 'base', bodyType: 'static'},
    {type: 'setBodyType', id: 'second-ball', bodyType: 'kinematic'},
    {type: 'setMaterial', id: 'ball', material: 'steel'},
    {type: 'setMaterial', id: 'arm', material: null, density: 450, friction: 0.3, restitution: 0.2},
    {type: 'setColor', id: 'arm', color: 0x336699},
    {type: 'setVelocity', id: 'ball', linear: [1, 0, -2], angular: [0, 3, 0]},
    {type: 'setFlags', id: 'ball', flags: {bullet: true, neverSleeps: true, linearDamping: 0.1, gravityScale: 0.5}},
    {type: 'setFilter', id: 'ball', filter: {categoryBits: '2', maskBits: '18446744073709551615', groupIndex: -1}},
    {type: 'addJoint', jointType: 'distance', bodyA: null, bodyB: 'ball', anchor: [0, 6, 0]},
    {type: 'addJoint', jointType: 'spherical', bodyA: 'ball', bodyB: 'second-ball'},
    {type: 'setJoint', id: 'hinge', patch: {limits: {lower: -0.5, upper: 0.5}, motor: {speed: 1, maxForce: 20}, spring: {hertz: 2, dampingRatio: 0.7, target: 0.1}, stiffness: {hertz: 30, dampingRatio: 1}, collideConnected: true}},
    {type: 'setJoint', id: 'hinge', patch: {anchor: [0.75, 1, 0], axis: [0, 1, 0]}},
    {type: 'setJoint', id: 'hinge', patch: {jointType: 'prismatic'}},
    {type: 'setJoint', id: 'spherical-1', patch: {coneAngle: 0.6, limits: {lower: -0.2, upper: 0.2}}},
    {type: 'setJoint', id: 'distance-1', patch: {length: 2.5, limits: null}},
    {type: 'deleteJoint', id: 'spherical-1'},
    {type: 'setWorld', world: {gravity: [0, -1.62, 0], ground: false, step: 1 / 120, subSteps: 8, seed: 5}},
    {type: 'setMeta', title: 'Edited', description: 'A test scene.', author: 'node'},
    {type: 'deleteBody', id: 'second-ball'},
    {type: 'replaceScene', scene: EXAMPLE_SCENES['newtons-cradle']()},
  ];
  const texts = [doc.canonical()];
  for (const command of commands) {
    const before = doc.canonical(), result = ok(doc.apply(command));
    assert.notEqual(doc.canonical(), before, `${command.type} (${result.label}) changes the scene`);
    assert.deepEqual(validateScene(doc.scene), [], `${command.type} leaves a valid scene`);
    assert.equal(doc.undoLabel, result.label);
    texts.push(doc.canonical());
  }
  assert.equal(doc.canonical(), canonicalize(EXAMPLE_SCENES['newtons-cradle']()), 'replaceScene holds the opened scene');
  // Undo everything, checking each state on the way back; then redo everything.
  for (let i = commands.length - 1; i >= 0; i--) {
    assert.equal(typeof doc.undo(), 'string');
    assert.equal(doc.canonical(), texts[i], `undo of ${commands[i].type} is byte-identical`);
  }
  assert.equal(doc.canUndo, true, 'the four commands of the sample remain');
  for (let i = 0; i < commands.length; i++) {
    assert.equal(typeof doc.redo(), 'string');
    assert.equal(doc.canonical(), texts[i + 1], `redo of ${commands[i].type} is byte-identical`);
  }
  assert.equal(doc.canRedo, false);
  // A new command after an undo discards the redo stack.
  doc.undo();
  ok(doc.apply({type: 'setMeta', title: 'Branch'}));
  assert.equal(doc.canRedo, false);
});

test('command details: ids, defaults, transforms, materials, flags', () => {
  const doc = sample();
  assert.deepEqual(doc.scene.bodies.map(body => body.id), ['base', 'ball', 'arm']);
  // Generated ids are unique among bodies and joints.
  assert.deepEqual(ok(doc.apply({type: 'addBody', preset: 'box'})).created, ['box-1']);
  assert.deepEqual(ok(doc.apply({type: 'addBody', preset: 'box'})).created, ['box-2']);
  assert.equal(uniqueId(doc.scene, 'box-2'), 'box-3');
  assert.equal(uniqueId(doc.scene, 'hinge'), 'hinge-1');
  // A body added without a position rests on the ground plane y = 0.
  assert.deepEqual(doc.body('box-1').position, [0, 0.5, 0]);
  ok(doc.apply({type: 'addBody', preset: 'capsule'}));
  assert.deepEqual(doc.body('capsule-1').position, [0, 0.75, 0], 'radius 0.25 + half length 0.5');
  // Height fields are centred on the asked point; meshes and height fields are static.
  ok(doc.apply({type: 'addBody', preset: 'terrain-flat', position: [10, 0, -4]}));
  assert.deepEqual(doc.body('terrain-1').position, [2, 0, -12]);
  assert.equal(doc.body('terrain-1').type, 'static');
  refused(doc.apply({type: 'setBodyType', id: 'terrain-1', bodyType: 'dynamic'}), /type/);
  // Rotations are entered as Euler degrees and stored as a quaternion.
  ok(doc.apply({type: 'setTransform', id: 'base', rotationEuler: [0, 90, 0]}));
  assert.equal(doc.body('base').rotationEuler, undefined);
  nearVec(doc.body('base').rotation, eulerToQuaternion([0, 90, 0]), 1e-7);
  nearVec(quaternionToEuler(doc.body('base').rotation), [0, 90, 0], 1e-3);
  assert.deepEqual(doc.body('base').position, [0, 0.5, 0], 'the position is kept');
  for (const euler of [[10, 20, 30], [-170, 45, 5], [0, 0, 0], [90, 0, -90], [35, -80, 120], [0, 90, 0]]) {
    const back = quaternionToEuler(eulerToQuaternion(euler));
    nearVec(eulerToQuaternion(back), eulerToQuaternion(euler).map(v => v * Math.sign(eulerToQuaternion(back)[3] * eulerToQuaternion(euler)[3] || 1)), 1e-5, `euler ${euler}`);
  }
  refused(doc.apply({type: 'setTransform', id: 'base', rotation: [0, 0, 0, 1], rotationEuler: [0, 0, 0]}), /not both/);
  // Values are written as float32 decimals.
  ok(doc.apply({type: 'setTransform', id: 'ball', position: [0.1 + 0.2, 1 / 3, 2]}));
  assert.deepEqual(doc.body('ball').position, [0.3, 0.33333334, 2]);
  // A named material goes into the scene's table and replaces the body's own numbers.
  ok(doc.apply({type: 'setMaterial', id: 'ball', material: null, density: 500, friction: 0.2, restitution: 0.9}));
  assert.deepEqual([doc.body('ball').density, doc.body('ball').friction, doc.body('ball').restitution, doc.body('ball').material], [500, 0.2, 0.9, undefined]);
  ok(doc.apply({type: 'setMaterial', id: 'ball', material: 'rubber'}));
  assert.deepEqual(doc.scene.materials.rubber, {density: 1100, friction: 0.9, restitution: 0.8, color: 0x2F3336});
  assert.deepEqual([doc.body('ball').material, doc.body('ball').density, doc.body('ball').friction, doc.body('ball').color], ['rubber', undefined, undefined, undefined]);
  assert.deepEqual(resolvedMaterial(doc.scene, doc.body('ball')), {density: 1100, friction: 0.9, restitution: 0.8, color: 0x2F3336});
  assert.deepEqual(resolvedMaterial(doc.scene, doc.body('arm')).density, 1000, 'the engine default');
  refused(doc.apply({type: 'setMaterial', id: 'ball', material: 'unobtainium'}), /no material called/);
  // Editing one value of a material body makes it custom, keeping the other values.
  ok(doc.apply({type: 'setMaterial', id: 'ball', material: null, friction: 0.33}));
  assert.deepEqual([doc.body('ball').material, doc.body('ball').density, doc.body('ball').friction, doc.body('ball').restitution], [undefined, 1100, 0.33, 0.8]);
  ok(doc.apply({type: 'setFlags', id: 'ball', flags: {sensor: true, hitEvents: true, lockRotation: true, angularDamping: 0.25}}));
  assert.deepEqual([doc.body('ball').sensor, doc.body('ball').hitEvents, doc.body('ball').lockRotation, doc.body('ball').angularDamping], [true, true, true, 0.25]);
  ok(doc.apply({type: 'setFilter', id: 'ball', filter: {groupIndex: -3}}));
  ok(doc.apply({type: 'setFilter', id: 'ball', filter: null}));
  assert.equal(doc.body('ball').filter, undefined);
  // Scene details: an empty string removes a field.
  ok(doc.apply({type: 'setMeta', title: 'T', description: 'D'}));
  ok(doc.apply({type: 'setMeta', description: ''}));
  assert.deepEqual(doc.scene.meta, {title: 'T'});
  // Duplicates sit beside the original and keep everything but the id.
  const copy = ok(doc.apply({type: 'duplicateBody', id: 'arm'})).created[0];
  assert.equal(copy, 'arm-1');
  assert.deepEqual(doc.body(copy).shape, doc.body('arm').shape);
  assert.ok(doc.body(copy).position[0] > doc.body('arm').position[0]);
  assert.match(doc.apply({type: 'duplicateBody', id: 'arm', offset: [0, 0, 1]}).notes[0], /joints of "arm" were not copied/);
});

test('rename and delete reach the joints', () => {
  const doc = sample();
  ok(doc.apply({type: 'addJoint', jointType: 'weld', id: 'glue', bodyA: 'ball', bodyB: 'arm'}));
  ok(doc.apply({type: 'addJoint', jointType: 'distance', id: 'rope', bodyA: null, bodyB: 'ball', anchor: [0, 5, 0]}));
  const renamed = ok(doc.apply({type: 'rename', id: 'arm', newId: 'lever'}));
  assert.deepEqual(renamed.created, ['lever']);
  assert.match(renamed.notes[0], /2 joints follow the new name/);
  assert.deepEqual([doc.joint('hinge').bodyB, doc.joint('glue').bodyB, doc.joint('rope').bodyB], ['lever', 'lever', 'ball']);
  assert.equal(doc.body('arm'), null);
  // A joint can be renamed too; ids stay unique across bodies and joints.
  ok(doc.apply({type: 'rename', id: 'glue', newId: 'weld-a'}));
  assert.equal(doc.joint('weld-a').type, 'weld');
  refused(doc.apply({type: 'rename', id: 'ball', newId: 'lever'}), /duplicate id|already/i);
  refused(doc.apply({type: 'rename', id: 'ball', newId: 'hinge'}), /duplicate id|already/i);
  refused(doc.apply({type: 'rename', id: 'ball', newId: 'has space'}), /letters, digits/);
  refused(doc.apply({type: 'rename', id: 'ball', newId: ''}), /./);
  refused(doc.apply({type: 'rename', id: 'ball', newId: 'x'.repeat(65)}), /64/);
  refused(doc.apply({type: 'rename', id: 'nobody', newId: 'x'}), /no body or joint called "nobody"/);
  refused(doc.apply({type: 'rename', id: 'ball', newId: 'ball'}), /unchanged/);
  // Deleting a body removes its joints and says so.
  const before = doc.canonical();
  const removed = ok(doc.apply({type: 'deleteBody', id: 'lever'}));
  assert.deepEqual(removed.notes, ['Joint "hinge" was removed with it: it was attached to "lever".', 'Joint "weld-a" was removed with it: it was attached to "lever".']);
  assert.deepEqual(doc.scene.joints.map(joint => joint.id), ['rope']);
  assert.deepEqual(validateScene(doc.scene), []);
  doc.undo();
  assert.equal(doc.canonical(), before, 'undo brings the body and both joints back');
});

test('an edit that would make the scene invalid is refused with the validator\'s message, and nothing changes', () => {
  const doc = sample();
  const before = doc.canonical(), depth = doc.undoDepth, revision = doc.revision;
  const cases = [
    [{type: 'setShape', id: 'ball', shape: {kind: 'sphere', radius: 0}}, /\/bodies\/1\/shape\/radius/],
    [{type: 'setShape', id: 'ball', shape: {kind: 'sphere', radius: -1}}, /radius/],
    [{type: 'setShape', id: 'base', shape: {kind: 'box', halfExtents: [1, 0, 1]}}, /halfExtents/],
    [{type: 'setShape', id: 'base', shape: {kind: 'box', halfExtents: [1, NaN, 1]}}, /halfExtents/],
    [{type: 'setShape', id: 'arm', shape: {kind: 'capsule', radius: 0.1, halfLength: 0.001}}, /halfLength/],
    [{type: 'setTransform', id: 'ball', position: [0, Infinity, 0]}, /position/],
    [{type: 'setTransform', id: 'ball', position: [0, 1e39, 0]}, /position/],
    [{type: 'setTransform', id: 'ball', rotation: [0, 0, 0, 2]}, /rotation/],
    [{type: 'setTransform', id: 'ball', rotationEuler: [0, NaN, 0]}, /angle/],
    [{type: 'setTransform', id: 'nobody', position: [0, 0, 0]}, /no body called "nobody"/],
    [{type: 'setMaterial', id: 'ball', material: null, density: -5}, /density/],
    [{type: 'setMaterial', id: 'ball', material: null, friction: -0.1}, /friction/],
    [{type: 'setFlags', id: 'ball', flags: {linearDamping: -1}}, /linearDamping/],
    [{type: 'setFilter', id: 'ball', filter: {categoryBits: '0x2', maskBits: '1'}}, /categoryBits/],
    [{type: 'setFilter', id: 'ball', filter: {categoryBits: '2'}}, /maskBits|both/],
    [{type: 'setColor', id: 'ball', color: -1}, /color/],
    [{type: 'setVelocity', id: 'ball', linear: [NaN, 0, 0]}, /linearVelocity/],
    [{type: 'setBodyType', id: 'ball', bodyType: 'floating'}, /type/],
    [{type: 'addBody', preset: 'box', id: 'ball'}, /duplicate|already/i],
    [{type: 'addBody', preset: 'pyramid'}, /no shape preset/],
    [{type: 'addJoint', jointType: 'revolute', bodyA: 'ball', bodyB: 'ball'}, /two different bodies/],
    [{type: 'addJoint', jointType: 'revolute', bodyA: null, bodyB: null}, /at least one body/],
    [{type: 'addJoint', jointType: 'revolute', bodyA: 'ball', bodyB: 'ghost'}, /no body called "ghost"/],
    [{type: 'addJoint', jointType: 'revolute', bodyA: 'ball', bodyB: 'arm', axis: [0, 0, 0]}, /axis must have a length/],
    [{type: 'setJoint', id: 'hinge', patch: {limits: {lower: 1, upper: -1}}}, /limits/],
    [{type: 'setJoint', id: 'hinge', patch: {motor: {speed: 1, maxForce: -1}}}, /maxForce/],
    [{type: 'setJoint', id: 'hinge', patch: {coneAngle: 0.5}}, /coneAngle/],
    [{type: 'setJoint', id: 'hinge', patch: {length: 2}}, /length/],
    [{type: 'setJoint', id: 'hinge', patch: {stiffness: {hertz: -1}}}, /stiffness/],
    [{type: 'setJoint', id: 'hinge', patch: {bodyB: 'base'}}, /bodyA|bodyB|differ/],
    [{type: 'setJoint', id: 'nope', patch: {}}, /no joint called "nope"/],
    [{type: 'deleteJoint', id: 'nope'}, /no joint called "nope"/],
    [{type: 'deleteBody', id: 'nope'}, /no body called "nope"/],
    [{type: 'setWorld', world: {step: 0}}, /\/world\/step/],
    [{type: 'setWorld', world: {step: 0.1}}, /\/world\/step/],
    [{type: 'setWorld', world: {subSteps: 17}}, /\/world\/subSteps/],
    [{type: 'setWorld', world: {subSteps: 2.5}}, /\/world\/subSteps/],
    [{type: 'setWorld', world: {gravity: [0, NaN, 0]}}, /\/world\/gravity/],
    [{type: 'setWorld', world: {seed: -1}}, /\/world\/seed/],
    [{type: 'setMeta', title: 'x'.repeat(5000)}, /\/meta\/title/],
    [{type: 'setGenerated', id: 'ball', generated: {preset: 'cylinder', radius: 1, height: 1}}, /cannot become/],
    [{type: 'replaceScene', scene: {format: 'box3d-scene', version: 1}}, /bodies/],
    [{type: 'replaceScene', scene: 'not a scene'}, /./],
    [{type: 'explode'}, /Unknown command/],
  ];
  for (const [command, pattern] of cases) {
    refused(doc.apply(command), pattern);
    assert.equal(doc.canonical(), before, `${command.type} left the scene alone`);
    assert.deepEqual([doc.undoDepth, doc.revision], [depth, revision], `${command.type} left the history alone`);
  }
  // A body that was made dynamic explicitly cannot take a static-only shape.
  ok(doc.apply({type: 'setBodyType', id: 'ball', bodyType: 'dynamic'}));
  refused(doc.apply({type: 'setShape', id: 'ball', shape: {kind: 'heightfield', heights: [0, 0, 0, 0], countX: 2, countZ: 2, spacing: [1, 1]}}), /always static/);
  doc.undo();
  assert.equal(doc.canonical(), before);
  // The message is the validator's own, with its path.
  const result = doc.apply({type: 'setShape', id: 'ball', shape: {kind: 'sphere', radius: 0}});
  const candidate = JSON.parse(before); candidate.bodies[1].shape.radius = 0;
  const [problem] = validateScene(candidate);
  assert.equal(result.message, `${problem.path}: ${problem.message}`);
  assert.deepEqual(result.problems, validateScene(candidate));
});

test('a document can ask a second opinion before a command is applied', () => {
  // The Lab passes a scratch build in the native world here.
  const seen = [];
  const doc = new SceneDocument(emptyScene(), {accept: (scene) => { seen.push(scene.bodies.length); return scene.bodies.length > 2 ? 'the engine refuses a third body' : null; }});
  ok(doc.apply({type: 'addBody', preset: 'box'}));
  ok(doc.apply({type: 'addBody', preset: 'box'}));
  const before = doc.canonical();
  const result = refused(doc.apply({type: 'addBody', preset: 'box'}), /the engine refuses a third body/);
  assert.deepEqual(result.problems, [{path: '', message: 'the engine refuses a third body'}]);
  assert.deepEqual([doc.canonical(), doc.undoDepth], [before, 2]);
  refused(doc.apply({type: 'setShape', id: 'box-1', shape: {kind: 'sphere', radius: 0}}), /radius/);
  assert.deepEqual(seen, [1, 2, 3], 'only valid candidates are passed on');
  // In the native world: a mesh whose triangles have no area is valid JSON but cannot be built.
  const real = new SceneDocument(emptyScene(), {accept: scene => withWorld((world) => { try { loadLabScene(world, scene); return null; } catch (error) { return error.message; } })});
  ok(real.apply({type: 'addBody', preset: 'ramp', id: 'ramp'}));
  refused(real.apply({type: 'setShape', id: 'ramp', shape: {kind: 'mesh', vertices: [0, 0, 0, 0, 0, 0, 0, 0, 0], indices: [0, 1, 2]}}), /Scene body "ramp"/);
  assert.equal(real.body('ramp').shape.vertices.length, 18);
});

test('the undo stack has a size cap, and merged commands are one step', () => {
  const doc = new SceneDocument(emptyScene(), {historyLimit: 5});
  ok(doc.apply({type: 'addBody', preset: 'box', id: 'b'}));
  for (let i = 1; i <= 9; i++) ok(doc.apply({type: 'setTransform', id: 'b', position: [i, 0.5, 0]}));
  assert.deepEqual([doc.undoDepth, doc.historyLimit], [5, 5]);
  let undone = 0;
  while (doc.undo() !== null) undone++;
  assert.equal(undone, 5);
  assert.deepEqual(doc.body('b').position, [4, 0.5, 0], 'the oldest five steps were forgotten');
  assert.equal(new SceneDocument().historyLimit, 100);
  // A run of nudges with one merge key is one undo step.
  const merged = new SceneDocument();
  ok(merged.apply({type: 'addBody', preset: 'box', id: 'b'}));
  const start = merged.canonical();
  for (let i = 1; i <= 4; i++) ok(merged.apply({type: 'setTransform', id: 'b', position: [i * 0.1, 0.5, 0]}, 'nudge:b'));
  assert.equal(merged.undoDepth, 2);
  assert.deepEqual(merged.body('b').position, [0.4, 0.5, 0]);
  merged.breakMerge();
  ok(merged.apply({type: 'setTransform', id: 'b', position: [1, 0.5, 0]}, 'nudge:b'));
  assert.equal(merged.undoDepth, 3, 'breakMerge starts a new step');
  merged.undo();
  assert.deepEqual(merged.body('b').position, [0.4, 0.5, 0]);
  merged.undo();
  assert.equal(merged.canonical(), start);
  merged.redo();
  assert.deepEqual(merged.body('b').position, [0.4, 0.5, 0]);
  // Untouched bodies are shared between history states, so the stack stays small with large meshes.
  const shared = sample(), base = shared.body('base');
  ok(shared.apply({type: 'setTransform', id: 'ball', position: [9, 9, 9]}));
  assert.equal(shared.body('base'), base);
});

test('shape presets: every one is valid, generated shapes keep their recipe, hulls and the ramp are well formed', () => {
  assert.deepEqual(BODY_PRESETS.map(preset => preset.id), ['box', 'sphere', 'capsule', 'wedge', 'cylinder', 'cone', 'ramp', 'terrain-flat', 'terrain-slope', 'terrain-hills']);
  const doc = new SceneDocument();
  BODY_PRESETS.forEach((preset, k) => ok(doc.apply({type: 'addBody', preset: preset.id, position: [k * 30, 2, 0]})));
  assert.deepEqual(doc.scene.bodies.map(body => body.shape.kind), ['box', 'sphere', 'capsule', 'hull', 'hull', 'hull', 'mesh', 'heightfield', 'heightfield', 'heightfield']);
  for (const body of doc.scene.bodies) {
    const generated = generatedShapeOf(body);
    if (['box', 'sphere', 'capsule'].includes(body.shape.kind)) { assert.equal(generated, null); continue; }
    assert.deepEqual(generateShape(generated), body.shape, `${body.id} can be regenerated from its record`);
  }
  assert.equal(generatedShapeOf({id: 'x', shape: {kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]}, position: [0, 0, 0], userData: {editor: {preset: 'cylinder', radius: 'big'}}}), null, 'a damaged record is ignored');
  assert.equal(generatedShapeOf({id: 'x', shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [0, 0, 0], userData: {editor: {preset: 'cylinder', radius: 1, height: 1}}}), null, 'a record for another kind is ignored');
  // Sizes: a cylinder of radius r and height h.
  const cylinder = generateShape({preset: 'cylinder', radius: 0.5, height: 2});
  assert.equal(cylinder.points.length, ROUND_SEGMENTS * 2 * 3);
  for (let i = 0; i < cylinder.points.length; i += 3) { near(Math.hypot(cylinder.points[i], cylinder.points[i + 2]), 0.5, 1e-6); assert.equal(Math.abs(cylinder.points[i + 1]), 1); }
  const cone = generateShape({preset: 'cone', radius: 1, height: 3});
  assert.deepEqual(cone.points.slice(-3), [0, 1.5, 0]);
  assert.deepEqual(shapeLocalBounds(generateShape({preset: 'wedge', size: [2, 1, 4]})), {min: [-1, -0.5, -2], max: [1, 0.5, 2]});
  // The ramp is a closed, outward-wound prism: half the volume of its bounding box.
  const ramp = generateShape({preset: 'ramp', length: 4, height: 1.5, width: 2});
  const mesh = {vertices: new Float32Array(ramp.vertices), indices: new Uint32Array(ramp.indices)};
  assert.equal(isClosed(mesh), true);
  near(meshVolume(mesh), 4 * 1.5 * 2 / 2, 1e-5);
  for (const bad of [{preset: 'cylinder', radius: 0, height: 1}, {preset: 'cone', radius: 1, height: -1}, {preset: 'wedge', size: [1, NaN, 1]}, {preset: 'ramp', length: 0, height: 1, width: 1}, {preset: 'terrain', fn: 'flat', countX: 1, countZ: 4, spacing: 1, amplitude: 0, seed: 1}, {preset: 'terrain', fn: 'flat', countX: 4, countZ: 4, spacing: 0, amplitude: 0, seed: 1}]) {
    assert.throws(() => generateShape(bad), EditorError);
  }
  assert.throws(() => presetShape('pyramid'), EditorError);
});

test('terrain functions are deterministic and have the stated shape', () => {
  assert.deepEqual(terrainHeights('flat', 3, 2, 5), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(terrainHeights('slope', 5, 2, 2), [0, 0.5, 1, 1.5, 2, 0, 0.5, 1, 1.5, 2]);
  const hills = terrainHeights('hills', 33, 17, 1.5, 7);
  assert.equal(hills.length, 33 * 17);
  assert.deepEqual(hills, terrainHeights('hills', 33, 17, 1.5, 7), 'same arguments, same numbers');
  assert.notDeepEqual(hills, terrainHeights('hills', 33, 17, 1.5, 8), 'another seed, another terrain');
  assert.equal(Math.min(...hills), 0);
  assert.equal(Math.max(...hills), 1.5);
  assert.ok(hills.every(value => Number.isFinite(value) && Math.fround(value) === Math.fround(Number(value))));
  // No cliffs: on this grid (4 samples per cell of the finer lattice) no neighbour step is above a quarter of the range.
  let steepest = 0;
  for (let z = 0; z < 17; z++) for (let x = 1; x < 33; x++) steepest = Math.max(steepest, Math.abs(hills[x + z * 33] - hills[x - 1 + z * 33]));
  assert.ok(steepest < 1.5 / 4, `steepest neighbour step ${steepest}`);
  // Pinned values: the generator is arithmetic only, so these hold on every machine.
  assert.equal(sceneHash({format: 'box3d-scene', version: 1, bodies: [{id: 't', type: 'static', position: [0, 0, 0], shape: {kind: 'heightfield', heights: terrainHeights('hills', 9, 9, 2, 1), countX: 9, countZ: 9, spacing: [1, 1]}}]}),
    sceneHash({format: 'box3d-scene', version: 1, bodies: [{id: 't', type: 'static', position: [0, 0, 0], shape: generateShape({preset: 'terrain', fn: 'hills', countX: 9, countZ: 9, spacing: 1, amplitude: 2, seed: 1})}]}));
  assert.deepEqual(terrainHeights('hills', 3, 3, 1, 1).map(value => Number(value.toFixed(6))), TERRAIN_PIN);
  assert.throws(() => terrainHeights('hills', 5000, 4, 1), EditorError);
  assert.throws(() => terrainHeights('slope', 4, 4, NaN), EditorError);
});
// terrainHeights('hills', 3, 3, 1, 1), to six decimals.
const TERRAIN_PIN = [0.845536, 0.639076, 1, 0.750291, 0.169079, 0.45561, 0.199605, 0, 0.809042];

test('the materials table: seven named materials with typical values inside their published ranges', () => {
  assert.deepEqual(MATERIAL_PRESETS.map(preset => preset.name), ['steel', 'aluminium', 'concrete', 'wood', 'rubber', 'ice', 'glass']);
  for (const preset of MATERIAL_PRESETS) {
    for (const key of ['density', 'friction', 'restitution']) {
      const [low, high] = preset[`${key}Range`];
      assert.ok(low <= preset[key] && preset[key] <= high && low < high, `${preset.name} ${key} ${preset[key]} is inside ${low}..${high}`);
    }
    assert.ok(preset.restitution >= 0 && preset.restitution <= 1 && preset.friction >= 0 && preset.density > 0);
    assert.ok(Number.isInteger(preset.color) && preset.color >= 0 && preset.color <= 0xFFFFFF);
    assert.match(preset.name, /^[a-z]+$/);
    assert.equal(materialPreset(preset.name), preset);
    assert.ok(Object.isFrozen(preset));
    // Each one can be given to a body, and the scene stays valid.
    const doc = new SceneDocument();
    ok(doc.apply({type: 'addBody', preset: 'sphere', id: 'b'}));
    ok(doc.apply({type: 'setMaterial', id: 'b', material: preset.name}));
    assert.deepEqual(resolvedMaterial(doc.scene, doc.body('b')), {density: preset.density, friction: preset.friction, restitution: preset.restitution, color: preset.color});
  }
  assert.deepEqual(MATERIAL_PRESETS.map(preset => [preset.name, preset.density, preset.friction, preset.restitution]), [
    ['steel', 7850, 0.6, 0.6], ['aluminium', 2700, 0.5, 0.5], ['concrete', 2400, 0.6, 0.2], ['wood', 600, 0.4, 0.45], ['rubber', 1100, 0.9, 0.8], ['ice', 917, 0.05, 0.3], ['glass', 2500, 0.5, 0.65],
  ]);
  assert.equal(materialPreset('toString'), null);
  // A scene's own material of the same name is used as it is, not overwritten by the preset.
  const doc = new SceneDocument({format: 'box3d-scene', version: 1, materials: {steel: {density: 7700, friction: 0.3, restitution: 0.1}}, bodies: [{id: 'b', shape: {kind: 'sphere', radius: 1}, position: [0, 1, 0]}]});
  ok(doc.apply({type: 'setMaterial', id: 'b', material: 'steel'}));
  assert.equal(doc.scene.materials.steel.density, 7700);
  assert.deepEqual(GRAVITY_PRESETS.map(preset => [preset.id, preset.gravity[1]]), [['earth', -9.81], ['moon', -1.62], ['mars', -3.72], ['zero', 0]]);
  assert.equal(gravityPresetOf([0, -9.81, 0]), 'earth');
  assert.equal(gravityPresetOf([0, -1.62, 0]), 'moon');
  assert.equal(gravityPresetOf([0, 0, 0]), 'zero');
  assert.equal(gravityPresetOf([1, -9.81, 0]), 'custom');
});

test('snapping: grid, and resting a body on the surface below it', () => {
  assert.equal(snapValue(0.26, 0.25), 0.25);
  assert.equal(snapValue(0.38, 0.25), 0.5);
  assert.equal(snapValue(-0.38, 0.25), -0.5);
  assert.equal(snapValue(0.29, 0.1), 0.3, 'no binary noise');
  assert.equal(snapValue(1.23456, 0), 1.23456, 'a grid of 0 is off');
  assert.equal(snapValue(1.23456, -1), 1.23456);
  assert.equal(snapValue(1.23456, NaN), 1.23456);
  assert.ok(Object.is(snapValue(-0.01, 0.25), 0), 'never -0');
  assert.deepEqual(snapVec3([0.26, 1.11, -0.9], 0.5), [0.5, 1, -1]);
  assert.deepEqual(snapVec3([0.26, 1.11, -0.9], 0.5, [true, false, true]), [0.5, 1.11, -1], 'the height can be left free');
  // The lowest point of each shape, turned or not.
  const box = {kind: 'box', halfExtents: [1, 0.25, 0.5]};
  assert.equal(shapeExtentAlong(box, [0, 0, 0, 1], [0, -1, 0]), 0.25);
  near(shapeExtentAlong(box, eulerToQuaternion([0, 0, 90]), [0, -1, 0]), 1, 1e-9, 'turned on its end');
  near(shapeExtentAlong(box, eulerToQuaternion([0, 0, 45]), [0, -1, 0]), (1 + 0.25) * Math.SQRT1_2, 1e-9);
  assert.equal(shapeExtentAlong({kind: 'sphere', radius: 0.4}, eulerToQuaternion([10, 20, 30]), [0, -1, 0]), 0.4);
  const capsule = {kind: 'capsule', radius: 0.2, halfLength: 0.5};
  near(shapeExtentAlong(capsule, [0, 0, 0, 1], [0, -1, 0]), 0.7, 1e-12);
  near(shapeExtentAlong(capsule, eulerToQuaternion([90, 0, 0]), [0, -1, 0]), 0.2, 1e-9, 'lying down');
  near(shapeExtentAlong(generateShape({preset: 'cone', radius: 1, height: 3}), [0, 0, 0, 1], [0, -1, 0]), 1.5, 1e-9);
  assert.equal(restingHeight(box, [0, 0, 0, 1], 0), 0.25);
  assert.equal(restingHeight(box, [0, 0, 0, 1], 2, 0.001), 2.251);
  near(restingHeight(capsule, eulerToQuaternion([90, 0, 0]), 1), 1.2, 1e-6);
  assert.equal(shapeThickness(box), 0.5);
  assert.equal(shapeThickness(capsule), 0.4);
  assert.equal(shapeThickness(generateShape({preset: 'wedge', size: [2, 0.2, 1]})), 0.2);
  near(shapeVolume({kind: 'sphere', radius: 1}), 4.18879, 1e-5);
  assert.equal(shapeVolume(box), 1);
  assert.equal(shapeVolume(generateShape({preset: 'cone', radius: 1, height: 3})), null);
});

test('a body dropped by surface snapping rests on the body below it in the native world', () => {
  // The view casts a ray down and calls restingHeight with the hit; this does the same in node.
  const doc = new SceneDocument();
  ok(doc.apply({type: 'addBody', preset: 'box', id: 'table', position: [0, 0.5, 0]}));
  ok(doc.apply({type: 'setShape', id: 'table', shape: {kind: 'box', halfExtents: [2, 0.5, 2]}}));
  ok(doc.apply({type: 'setBodyType', id: 'table', bodyType: 'static'}));
  withWorld((world) => {
    loadLabScene(world, doc.scene);
    const cast = (x, z) => world.queryBatch([{kind: 'ray', origin: [x, 100, z], translation: [0, -200, 0], limit: 1}])[0].hits[0];
    near(cast(1, 1).point[1], 1, 1e-4, 'the table top');
    near(cast(10, 10).point[1], 0, 1e-4, 'the ground slab');
    const {shape} = presetShape('sphere');
    ok(doc.apply({type: 'addBody', preset: 'sphere', id: 'ball', position: [1, restingHeight(shape, [0, 0, 0, 1], cast(1, 1).point[1]), 1]}));
  });
  assert.deepEqual(doc.body('ball').position, [1, 1.5, 1]);
  withWorld((world) => {
    const loaded = loadLabScene(world, doc.scene);
    for (let i = 0; i < 120; i++) loaded.builder.world.step();
    near(world.bodyState(loaded.bodies.get('ball')).position[1], 1.5, 0.01, 'it stays where it was put');
  });
});

test('the picking ray matches the Lab camera', () => {
  const rig = {yaw: 0.72, pitch: 0.3, distance: 8, target: [1, 2, 3]};
  const centre = cameraRay(rig, 16 / 9, 0.5, 0.5);
  near(Math.hypot(centre.origin[0] - 1, centre.origin[1] - 2, centre.origin[2] - 3), 8, 1e-9, 'the eye is `distance` from the target');
  nearVec(centre.direction.map((value, k) => centre.origin[k] + value * 8), [1, 2, 3], 1e-9, 'the centre ray hits the target');
  near(centre.origin[1], 2 + 8 * Math.sin(0.3), 1e-12);
  // The top and right edges are half the field of view away from the centre.
  const top = cameraRay(rig, 16 / 9, 0.5, 0), right = cameraRay(rig, 16 / 9, 1, 0.5);
  const angle = (a, b) => Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  near(angle(top.direction, centre.direction), 29 * Math.PI / 180, 1e-9);
  near(Math.tan(angle(right.direction, centre.direction)), 16 / 9 * Math.tan(29 * Math.PI / 180), 1e-9);
  assert.ok(top.direction[1] > centre.direction[1], 'v = 0 is the top of the canvas');
  near(right.direction[1], centre.direction[1] * Math.cos(angle(right.direction, centre.direction)), 1e-9, 'the horizon is level');
  // Projecting a point of a ray gives back the viewport position the ray was made for.
  for (const [u, v] of [[0.5, 0.5], [0.1, 0.9], [0.93, 0.2], [0, 0], [1, 1]]) {
    const ray = cameraRay(rig, 1.6, u, v), seen = cameraProject(rig, 1.6, ray.origin.map((value, k) => value + ray.direction[k] * 7));
    nearVec([seen.u, seen.v], [u, v], 1e-9, `project ${u}, ${v}`);
    assert.ok(seen.depth > 0 && seen.depth <= 7);
  }
  assert.ok(cameraProject(rig, 1.6, centre.origin.map((value, k) => value - centre.direction[k])).depth < 0, 'behind the eye');
  // The pitch is clamped as the camera clamps it.
  near(cameraRay({...rig, pitch: 5}, 1, 0.5, 0.5).origin[1], 2 + 8 * Math.sin(1.3), 1e-12);
  // A ray to the ground plane and back.
  const hit = rayPlaneY(centre.origin, centre.direction, 0);
  assert.equal(hit[1], 0);
  near((hit[0] - centre.origin[0]) / centre.direction[0], (hit[2] - centre.origin[2]) / centre.direction[2], 1e-9);
  assert.equal(rayPlaneY([0, 1, 0], [1, 0, 0], 0), null, 'parallel');
  assert.equal(rayPlaneY([0, 1, 0], [0, 1, 0], 0), null, 'pointing away');
  // In the native world the centre ray hits the body the camera looks at.
  const doc = new SceneDocument();
  ok(doc.apply({type: 'addBody', preset: 'box', id: 'crate', position: [1, 2, 3]}));
  withWorld((world) => {
    const loaded = loadLabScene(world, doc.scene);
    const [result] = world.queryBatch([{kind: 'ray', origin: centre.origin, translation: centre.direction.map(value => value * 100), limit: 1}]);
    assert.equal(result.hits[0].body.token, loaded.bodies.get('crate').token);
    const [miss] = world.queryBatch([{kind: 'ray', origin: top.origin, translation: top.direction.map(value => value * 100), limit: 1}]);
    assert.equal(miss.hits.length, 0, 'the top-edge ray looks over the crate and the ground');
  });
});

test('joint frames: both frames meet at the picked point, and the picked axis is the joint axis', () => {
  const poseA = {position: [1, 2, 3], rotation: eulerToQuaternion([20, 40, 60])}, poseB = {position: [-1, 0.5, 2], rotation: eulerToQuaternion([0, 90, 0])};
  const anchor = [0.25, 1.5, 2.5];
  for (const type of JOINT_TYPES) {
    const traits = jointTraits(type);
    for (const axis of [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 2, -3]]) {
      const frames = jointFramesFromWorld(type, poseA, poseB, anchor, axis, [-1, 0.5, 2]);
      const joint = {id: 'j', type, bodyA: 'a', bodyB: 'b', ...frames};
      const scene = {format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'sphere', radius: 0.1}, ...poseA}, {id: 'b', shape: {kind: 'sphere', radius: 0.1}, ...poseB}], joints: [type === 'distance' ? {...joint, length: 1} : joint]};
      assert.deepEqual(validateScene(scene), [], `${type} frames are valid`);
      const world = jointGeometryInScene(scene, joint);
      nearVec(world.anchorA, anchor, 1e-6, `${type} anchor on A`);
      nearVec(world.anchorB, type === 'distance' ? [-1, 0.5, 2] : anchor, 1e-6, `${type} anchor on B`);
      if (traits.axis === null) { assert.equal(world.axis, null); continue; }
      const length = Math.hypot(...axis);
      nearVec(world.axis, axis.map(value => value / length), 1e-6, `${type} axis`);
      // Frame B, seen from body B, shows the same axis: the frames coincide in the world.
      const viaB = quatRotate(poseB.rotation, quatRotate(frames.frameB.rotation ?? [0, 0, 0, 1], traits.axis === 'z' ? [0, 0, 1] : [1, 0, 0]));
      nearVec(viaB, world.axis, 1e-6, `${type} axis through B`);
    }
  }
  // A wheel's suspension (frame x) is as close to vertical as the axle allows.
  const wheel = jointFramesFromWorld('wheel', {position: [0, 0, 0], rotation: [0, 0, 0, 1]}, {position: [0, 0, 0], rotation: [0, 0, 0, 1]}, [0, 0, 0], [0, 0, 1]);
  nearVec(quatRotate(wheel.frameA.rotation, [1, 0, 0]), [0, 1, 0], 1e-6);
  assert.deepEqual(jointTraits('revolute'), {limits: 'angle', motor: 'angular', spring: 'angle', coneAngle: false, length: false, axis: 'z', axisLabel: 'Hinge axis'});
  assert.equal(jointTraits('prismatic').axis, 'x');
  assert.equal(jointTraits('weld').limits, null);
  assert.equal(jointTraits('distance').length, true);
  // Defaults when nothing is picked: the midpoint of two bodies, the body's centre for a joint to the world.
  const doc = sample();
  ok(doc.apply({type: 'addJoint', jointType: 'spherical', id: 's', bodyA: 'base', bodyB: 'ball'}));
  nearVec(jointGeometryInScene(doc.scene, doc.joint('s')).anchorA, [0, 1.25, 0], 1e-6);
  ok(doc.apply({type: 'addJoint', jointType: 'revolute', id: 'pin', bodyA: null, bodyB: 'ball'}));
  nearVec(jointGeometryInScene(doc.scene, doc.joint('pin')).anchorB, [0, 2, 0], 1e-6);
  ok(doc.apply({type: 'addJoint', jointType: 'distance', id: 'rope', bodyA: null, bodyB: 'ball'}));
  assert.equal(doc.joint('rope').length, 1);
  nearVec(jointGeometryInScene(doc.scene, doc.joint('rope')).anchorA, [0, 3, 0], 1e-6);
  // Moving an anchor keeps the axis; changing the type keeps both and drops what the new type does not take.
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {limits: {lower: -1, upper: 1}, motor: {speed: 2, maxForce: 5}}}));
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {axis: [0, 1, 0]}}));
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {anchor: [0.5, 1.5, 0]}}));
  nearVec(jointGeometryInScene(doc.scene, doc.joint('hinge')).axis, [0, 1, 0], 1e-6);
  nearVec(jointGeometryInScene(doc.scene, doc.joint('hinge')).anchorB, [0.5, 1.5, 0], 1e-6);
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {jointType: 'spherical'}}));
  assert.deepEqual([doc.joint('hinge').motor, doc.joint('hinge').limits], [undefined, {lower: -1, upper: 1}], 'a spherical joint has no motor; twist limits stay angles');
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {jointType: 'distance'}}));
  assert.deepEqual([doc.joint('hinge').limits, typeof doc.joint('hinge').length], [undefined, 'number'], 'angle limits do not become lengths');
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {jointType: 'weld'}}));
  assert.equal(doc.joint('hinge').length, undefined);
  assert.deepEqual(validateScene(doc.scene), []);
});

test('scenes made by the editor build in the native world, and a hinge holds its anchor', () => {
  const doc = new SceneDocument();
  BODY_PRESETS.forEach((preset, k) => ok(doc.apply({type: 'addBody', preset: preset.id, position: [k * 30, 3, 0]})));
  ok(doc.apply({type: 'addBody', preset: 'box', id: 'post', position: [0, 3, 10]}));
  ok(doc.apply({type: 'setBodyType', id: 'post', bodyType: 'static'}));
  ok(doc.apply({type: 'addBody', preset: 'capsule', id: 'arm', position: [0, 1.75, 10]}));
  ok(doc.apply({type: 'addJoint', jointType: 'revolute', id: 'hinge', bodyA: 'post', bodyB: 'arm', anchor: [0, 2.5, 10], axis: [0, 0, 1]}));
  JOINT_TYPES.forEach((type, k) => ok(doc.apply({type: 'addJoint', jointType: type, bodyA: k % 2 ? null : 'box-1', bodyB: 'sphere-1'})));
  for (const material of MATERIAL_PRESETS) ok(doc.apply({type: 'setMaterial', id: 'box-1', material: material.name}));
  ok(doc.apply({type: 'setVelocity', id: 'arm', linear: [2, 0, 0]}));
  // Through a share link and back: the same scene.
  assert.equal(sceneHash(decodeSceneLink(encodeSceneLinkSync(doc.scene))), sceneHash(doc.scene));
  const run = () => withWorld((world) => {
    const loaded = loadLabScene(world, doc.scene);
    assert.equal(loaded.bodies.size, doc.scene.bodies.length);
    assert.equal(loaded.joints.size, doc.scene.joints.length);
    for (let i = 0; i < 120; i++) loaded.builder.world.step();
    const arm = world.bodyState(loaded.bodies.get('arm'));
    // The arm's end stays at the hinge: its centre is 0.75 m from the anchor, wherever it has swung.
    near(Math.hypot(arm.position[0], arm.position[1] - 2.5, arm.position[2] - 10), 0.75, 0.02, 'the hinge holds');
    assert.ok(Math.abs(arm.position[0]) > 0.05, 'and the arm swings');
    return [world.replayHash(), loaded.builder.world.exactHash()];
  });
  assert.deepEqual(run(), run(), 'the same scene steps to the same hashes');
  // Undo to the start and redo: the rebuilt scene is the same scene.
  const text = doc.canonical(), hashes = run();
  let steps = 0;
  while (doc.undo() !== null) steps++;
  assert.equal(doc.canonical(), canonicalize(emptyScene()));
  for (let i = 0; i < steps; i++) doc.redo();
  assert.equal(doc.canonical(), text);
  assert.deepEqual(run(), hashes);
});

test('step warnings name the joint or body and never fire for the default scene sizes', () => {
  const doc = sample();
  assert.deepEqual(stepWarnings(doc.scene), []);
  for (const name of Object.keys(EXAMPLE_SCENES)) assert.ok(Array.isArray(stepWarnings(EXAMPLE_SCENES[name]())));
  // The default joint stiffness (60 Hz) is exactly a quarter of the default sub-step rate (240 Hz).
  ok(doc.apply({type: 'setWorld', world: {subSteps: 2}}));
  assert.match(stepWarnings(doc.scene).join('\n'), /Joint "hinge": stiffness 60 Hz is above a quarter of the sub-step rate \(30 Hz/);
  ok(doc.apply({type: 'setWorld', world: {subSteps: 4, step: 1 / 240}}));
  assert.deepEqual(stepWarnings(doc.scene), []);
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {stiffness: {hertz: 500}, spring: {hertz: 400, dampingRatio: 1}}}));
  assert.equal(stepWarnings(doc.scene).filter(line => line.startsWith('Joint "hinge"')).length, 2);
  ok(doc.apply({type: 'setJoint', id: 'hinge', patch: {stiffness: null, spring: null}}));
  ok(doc.apply({type: 'setWorld', world: {step: 1 / 60}}));
  // A fast body crosses more than its own thickness in a step.
  ok(doc.apply({type: 'setVelocity', id: 'ball', linear: [0, 0, 90]}));
  assert.match(stepWarnings(doc.scene).join('\n'), /Body "ball": at 90 m\/s it moves 1\.5 m a step, more than its thickness \(1 m\)/);
  ok(doc.apply({type: 'setFlags', id: 'ball', flags: {bullet: true}}));
  assert.deepEqual(stepWarnings(doc.scene), [], 'a bullet body is swept');
  // Small and thin bodies.
  ok(doc.apply({type: 'setShape', id: 'arm', shape: {kind: 'capsule', radius: 0.005, halfLength: 0.1}}));
  assert.match(stepWarnings(doc.scene).join('\n'), /Body "arm": 10 mm thick/);
  ok(doc.apply({type: 'setShape', id: 'arm', shape: {kind: 'capsule', radius: 0.05, halfLength: 0.1}}));
  assert.match(stepWarnings(doc.scene).join('\n'), /Body "arm": after 1 s of free fall it moves 0\.164 m a step, more than its thickness \(0\.1 m\)/);
  ok(doc.apply({type: 'setWorld', world: {step: 1 / 240}}));
  assert.deepEqual(stepWarnings(doc.scene), []);
  ok(doc.apply({type: 'setShape', id: 'base', shape: {kind: 'box', halfExtents: [10, 0.05, 1]}}));
  assert.match(stepWarnings(doc.scene).join('\n'), /Body "base": its sides differ by a factor of 200/);
  ok(doc.apply({type: 'setBodyType', id: 'base', bodyType: 'static'}));
  assert.deepEqual(stepWarnings(doc.scene), [], 'static bodies are not warned about');
});

test('measurement: energy, the series ring, and the CSV format', () => {
  const gravity = [0, -9.81, 0];
  // A 2 kg body 3 m up moving at 4 m/s: 16 J kinetic, 58.86 J potential.
  const state = {mass: 2, position: [1, 3, -2], rotation: [0, 0, 0, 1], linearVelocity: [0, -4, 0], angularVelocity: [0, 0, 0]};
  const energy = bodyEnergy(state, gravity, null);
  assert.equal(energy.translational, 16);
  near(energy.potential, 58.86, 1e-12);
  assert.ok(Number.isNaN(energy.rotational), 'unknown without an inertia');
  near(energy.total, 74.86, 1e-12);
  // A sphere spinning at 10 rad/s: (1/2)(2/5 m r^2) w^2.
  const sphere = {kind: 'sphere', radius: 0.5}, spinning = {...state, linearVelocity: [0, 0, 0], angularVelocity: [0, 10, 0]};
  near(bodyEnergy(spinning, gravity, principalInertia(sphere, 2)).rotational, 0.5 * 0.4 * 2 * 0.25 * 100, 1e-12);
  // A box spinning about a world axis that is its local x after a quarter turn about z.
  const box = {kind: 'box', halfExtents: [0.5, 1, 1.5]}, inertia = principalInertia(box, 6);
  nearVec(inertia, [2 * (1 + 2.25), 2 * (0.25 + 2.25), 2 * (0.25 + 1)], 1e-12);
  const turned = {...spinning, rotation: eulerToQuaternion([0, 0, 90]), angularVelocity: [0, 2, 0]};
  near(bodyEnergy(turned, gravity, inertia).rotational, 0.5 * inertia[0] * 4, 1e-9);
  // Capsule: a zero-length capsule is a sphere; the transverse moment agrees with a numerical integral.
  nearVec(principalInertia({kind: 'capsule', radius: 0.5, halfLength: 0}, 2), [0.2, 0.2, 0.2], 1e-12);
  const capsule = {kind: 'capsule', radius: 0.3, halfLength: 0.7};
  let volume = 0, ixx = 0, iyy = 0;
  const n = 60, cell = 0.6 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < Math.round(2 / cell); j++) for (let k = 0; k < n; k++) {
    const x = -0.3 + (i + 0.5) * cell, y = -1 + (j + 0.5) * cell, z = -0.3 + (k + 0.5) * cell;
    const inside = Math.hypot(x, Math.max(0, Math.abs(y) - 0.7) , z) <= 0.3;
    if (inside) { volume++; ixx += y * y + z * z; iyy += x * x + z * z; }
  }
  near(volume * cell ** 3, shapeVolume(capsule), 0.01 * shapeVolume(capsule), 'capsule volume');
  const exact = principalInertia(capsule, 1);
  near(exact[0], ixx / volume, 0.01 * exact[0], 'capsule transverse inertia');
  near(exact[1], iyy / volume, 0.01 * exact[1], 'capsule axial inertia');
  assert.equal(principalInertia(generateShape({preset: 'cone', radius: 1, height: 1}), 1), null);

  const series = new MeasurementSeries(4);
  assert.equal(series.toCsv(), `${MEASUREMENT_COLUMNS.join(',')}\r\n`);
  for (let i = 0; i < 6; i++) series.push(i / 60, {...state, position: [i, 3, 0], linearVelocity: [3, 0, 4]}, gravity, i === 5 ? [1, 1, 1] : null);
  assert.equal(series.length, 4, 'a ring: the two oldest rows were dropped');
  assert.deepEqual(series.column('x_m'), [2, 3, 4, 5]);
  assert.deepEqual(series.column('speed_m_per_s'), [5, 5, 5, 5]);
  assert.equal(series.row(0)[0], 2 / 60);
  assert.throws(() => series.row(4), RangeError);
  const lines = series.toCsv().split('\r\n');
  assert.equal(lines.length, 6, 'a header, four rows and the final line end');
  assert.equal(lines[0], 'time_s,x_m,y_m,z_m,vx_m_per_s,vy_m_per_s,vz_m_per_s,speed_m_per_s,kinetic_translational_J,kinetic_rotational_J,potential_J,total_J');
  assert.equal(lines[1], '0.0333333333,2,3,0,3,0,4,5,25,,58.86,83.86', 'an unknown value is an empty field');
  assert.equal(lines[4], '0.0833333333,5,3,0,3,0,4,5,25,0,58.86,83.86');
  assert.equal(lines[5], '');
  for (const line of lines.slice(0, 5)) assert.equal(line.split(',').length, MEASUREMENT_COLUMNS.length);
  assert.doesNotMatch(series.toCsv(), /NaN|Infinity|undefined/);
  series.clear();
  assert.equal(series.length, 0);
  assert.throws(() => new MeasurementSeries(0), RangeError);

  // A dropped ball in the native world: the recorded energy stays within 1% until it lands.
  const doc = new SceneDocument();
  ok(doc.apply({type: 'addBody', preset: 'sphere', id: 'ball', position: [0, 5, 0]}));
  withWorld((world) => {
    const loaded = loadLabScene(world, doc.scene), handle = loaded.bodies.get('ball'), fall = new MeasurementSeries();
    const body = doc.body('ball');
    for (let tick = 0; tick <= 45; tick++) {
      const live = world.bodyState(handle);
      fall.push(tick / 60, live, gravity, principalInertia(body.shape, live.mass));
      loaded.builder.world.step();
    }
    const total = fall.column('total_J'), mass = world.bodyState(handle).mass;
    near(mass, 1000 * shapeVolume(body.shape), 1e-2);
    near(total[0], mass * 9.81 * 5, 1e-6 * total[0]);
    for (const value of total) near(value, total[0], 0.01 * total[0], 'energy in free fall');
    near(fall.column('y_m').at(-1), 5 - 0.5 * 9.81 * 0.75 ** 2, 0.08, 'y = y0 - g t^2 / 2 after 0.75 s');
  });
  assert.deepEqual(rulerMeasure([0, 0, 0], [3, 4, 12]), {distance: 13, delta: [3, 4, 12], horizontal: Math.hypot(3, 12)});
});

test('autosave records are validated like any other scene', () => {
  const doc = sample();
  const text = encodeAutosave(doc.scene, '2026-11-11T10:00:00.000Z');
  const back = decodeAutosave(text);
  assert.equal(back.savedAt, '2026-11-11T10:00:00.000Z');
  assert.equal(canonicalize(back.scene), doc.canonical());
  for (const bad of [null, '', 'not json', '{}', '[]', 'null', JSON.stringify({kind: 'box3d-scene-editor-autosave', version: 2, savedAt: '2026-11-11', scene: doc.scene}),
    JSON.stringify({kind: 'box3d-scene-editor-autosave', version: 1, savedAt: 'yesterday-ish', scene: doc.scene}),
    JSON.stringify({kind: 'box3d-scene-editor-autosave', version: 1, savedAt: '2026-11-11', scene: {format: 'box3d-scene', version: 1}}),
    JSON.stringify({kind: 'box3d-scene-editor-autosave', version: 1, savedAt: '2026-11-11', scene: {...doc.scene, bodies: [{id: '<img onerror=x>', shape: {kind: 'sphere', radius: 1}, position: [0, 0, 0]}]}}),
    'x'.repeat(AUTOSAVE_MAX_CHARS * 2 + 1)]) {
    assert.equal(decodeAutosave(bad), null);
  }
  // A scene too large to keep in localStorage is not autosaved.
  const big = new SceneDocument();
  ok(big.apply({type: 'addBody', preset: 'terrain-hills', id: 't'}));
  ok(big.apply({type: 'setGenerated', id: 't', generated: {preset: 'terrain', fn: 'hills', countX: 400, countZ: 400, spacing: 1, amplitude: 10, seed: 3}}));
  assert.ok(big.canonical().length > AUTOSAVE_MAX_CHARS);
  assert.equal(encodeAutosave(big.scene, '2026-11-11T10:00:00.000Z'), null);
});

test('a scene with compound bodies and massData opens in the editor: bounds, resting height, moves and undo', () => {
  // An L of two boxes and a capsule laid along x. The editor cannot edit their geometry; it must measure and move them.
  const q90z = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const ell = {kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [0.5, 0.1, 0.3]}, position: [0, 0.1, 0]}, {shape: {kind: 'box', halfExtents: [0.1, 1, 0.3]}, position: [-0.4, 1.2, 0]},
    {shape: {kind: 'capsule', radius: 0.05, halfLength: 0.4}, position: [0.2, 0.5, 0], rotation: q90z}]};
  const scene = {format: 'box3d-scene', version: 2, bodies: [
    {id: 'ell', shape: ell, position: [0, 0, 0]},
    {id: 'ball', shape: {kind: 'sphere', radius: 0.2}, position: [3, 0.2, 0], massData: {mass: 9, center: [0, -0.05, 0], inertia: [1, 1, 1, 0, 0, 0]}},
  ]};
  assert.deepEqual(validateScene(scene), []);
  const bounds = shapeLocalBounds(ell);
  nearVec(bounds.min, [-0.5, 0, -0.3], 1e-12, 'lower corner');
  nearVec(bounds.max, [0.65, 2.2, 0.3], 1e-12, 'upper corner: the post reaches 2.2 m and the turned capsule 0.2 + 0.4 + 0.05 along x');
  near(shapeExtentAlong(ell, q90z, [1, 0, 0]), 0, 1e-12, 'turned a quarter about z, its base is what faces +x');
  near(shapeThickness(ell), 0.6, 1e-12, 'its smallest overall extent');
  near(restingHeight(ell, [0, 0, 0, 1], 0), 0, 1e-7, 'the body origin is in its base, so it rests at y = 0');
  assert.equal(shapeVolume(ell), null);
  assert.equal(principalInertia(ell, 1), null, 'the engine has its inertia; the editor does not compute it');
  assert.deepEqual(stepWarnings(scene), []);
  const doc = new SceneDocument(scene), before = doc.canonical();
  assert.equal(doc.scene.version, 2);
  ok(doc.apply({type: 'setTransform', id: 'ell', position: [1, 0, -2]}));
  ok(doc.apply({type: 'duplicateBody', id: 'ell'}));
  assert.equal(doc.scene.bodies.length, 3);
  assert.deepEqual(doc.scene.bodies.at(-1).shape, doc.scene.bodies[0].shape, 'a copy keeps every child');
  refused(doc.apply({type: 'setShape', id: 'ell', shape: {kind: 'compound', shapes: []}}), /a compound holds 1 to 64 shapes, got 0/);
  doc.undo(); doc.undo();
  assert.equal(doc.canonical(), before, 'undo returns the exact text, massData included');
  // The scene the editor holds builds in the engine with the compound's three shapes and the ball's stated mass.
  withWorld((world) => {
    const loaded = loadLabScene(world, doc.scene);
    assert.deepEqual(world.bodyKinds().slice(1), ['compound', 'sphere']);
    assert.equal(world.bodyMassData(loaded.bodies.get('ell')).shapeCount, 3);
    assert.deepEqual([world.bodyMassData(loaded.bodies.get('ball')).mass, world.bodyMassData(loaded.bodies.get('ball')).explicit], [9, true]);
  });
});
