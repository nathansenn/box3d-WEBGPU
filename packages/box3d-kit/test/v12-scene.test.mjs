// Scene files (box3d-webgpu-kit/scene): the format, validation, loading and
// saving, canonical text, share links and the example scenes, with the physics
// of two of them checked against closed-form answers. No wall-clock assertions.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import zlib from 'node:zlib';
import {createWorld, capabilities} from 'box3d-webgpu-kit';
import {
  SCENE_FORMAT, SCENE_VERSION, SCENE_LIMITS, SCENE_LINK_PREFIX, EXAMPLE_SCENES, SceneBuilder, SceneValidationError,
  validateScene, normalizeScene, canonicalize, sceneHash, encodeSceneLink, encodeSceneLinkSync, decodeSceneLink,
  loadScene, saveScene, sceneWorldOptions, eulerToQuaternion, pendulumWaveScene, newtonsCradleScene,
} from 'box3d-webgpu-kit/scene';

const G = 9.81;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const copy = value => JSON.parse(JSON.stringify(value));
const open = async scene => { const world = await createWorld(sceneWorldOptions(scene)); return {world, ...loadScene(world, scene)}; };
const rotate = (q, v) => {
  const [x, y, z, w] = q, [a, b, c] = v, tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
};
// The same data with every object's keys in the opposite order.
const reversed = value => Array.isArray(value) ? value.map(reversed)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reversed(value[key])])) : value;
const invalidLink = (text, pattern, label) => assert.throws(() => decodeSceneLink(text), error => {
  assert.equal(error.code, 'INVALID_PAYLOAD', `${label}: ${error.stack}`);
  assert.match(error.message, pattern, label);
  return true;
}, label);
const crcHex = buffer => (zlib.crc32(buffer) >>> 0).toString(16).padStart(8, '0');
const link = (mode, declared, crc, data) => `${SCENE_LINK_PREFIX}${mode}.${declared.toString(36)}.${crc}.${Buffer.from(data).toString('base64url')}`;

// One valid scene that uses every part of the format.
const sample = () => ({
  format: 'box3d-scene', version: 1, units: 'SI',
  world: {gravity: [0, -9.81, 0], ground: true, seed: 7, step: 1 / 60, subSteps: 4},
  materials: {steel: {density: 7800, friction: 0.4, restitution: 0.1, color: 0xC0C0C0}},
  bodies: [
    {id: 'ball', shape: {kind: 'sphere', radius: 0.25}, position: [0, 3, 0], material: 'steel', restitution: 0.5, hitEvents: true,
      filter: {categoryBits: '2', maskBits: '18446744073709551615', groupIndex: -1}, userData: {label: 'ball', tags: ['a', 1, null], nested: {deep: true}}},
    {id: 'ramp', shape: {kind: 'mesh', vertices: [0, 0, -4, 10, -3, -4, 10, -3, 4, 0, 0, 4], indices: [0, 2, 1, 0, 3, 2]}, position: [0, 2, 0]},
    {id: 'rock', shape: {kind: 'hull', points: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]}, position: [4, 5, 0], rotationEuler: [0, 90, 0], density: 2500},
    {id: 'pill', shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, position: [1, 6, 0], type: 'kinematic', linearVelocity: [0, 1, 0]},
    {id: 'crate', shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [-3, 0.5, 0], linearDamping: 0.1, gravityScale: 0.5},
    {id: 'hills', shape: {kind: 'heightfield', heights: [0, 0, 0, 0, 1, 0, 0, 0, 0], countX: 3, countZ: 3, spacing: [2, 2]}, position: [20, 0, 20]},
  ],
  joints: [
    {id: 'rope', type: 'distance', bodyA: null, bodyB: 'ball', frameA: {position: [0, 5, 0]}, length: 2, limits: {lower: 1, upper: 3}, spring: {hertz: 2, dampingRatio: 0.5}},
    {id: 'hinge', type: 'revolute', bodyA: 'crate', bodyB: 'rock', frameA: {position: [0.5, 0, 0], rotationEuler: [90, 0, 0]}, motor: {speed: 1, maxForce: 10}, collideConnected: true},
  ],
  meta: {title: 'Sample', description: 'Every part of the format.', author: 'test', created: '2026-11-11T00:00:00Z'},
  extensions: {editor: {camera: [1, 2, 3]}},
});

test('the module is listed, and the sample scene and every example validate', () => {
  assert.ok(capabilities().modules.includes('scene'));
  assert.equal(SCENE_FORMAT, 'box3d-scene');
  assert.equal(SCENE_VERSION, 1);
  assert.deepEqual(validateScene(sample()), []);
  assert.deepEqual(Object.keys(EXAMPLE_SCENES), ['pendulum-wave', 'newtons-cradle', 'domino-run', 'terrain-car', 'ragdoll']);
  for (const [name, make] of Object.entries(EXAMPLE_SCENES)) {
    const scene = make();
    assert.deepEqual(validateScene(scene), [], name);
    assert.ok(scene.bodies.length <= 16 && canonicalize(scene).length < 6000, `${name} stays small`);
    assert.ok(scene.meta.title.length > 0, `${name} has a title`);
  }
});

test('canonical text: idempotent, independent of key order, defaults and -0, and hashed with SHA-256', () => {
  for (const [name, make] of [['sample', sample], ...Object.entries(EXAMPLE_SCENES)]) {
    const scene = make(), text = canonicalize(scene);
    assert.equal(canonicalize(JSON.parse(text)), text, `${name}: canonicalising twice changes nothing`);
    assert.equal(canonicalize(copy(scene)), text, `${name}: survives JSON.stringify and parse`);
    assert.equal(canonicalize(reversed(scene)), text, `${name}: key order does not matter`);
    assert.equal(canonicalize(normalizeScene(scene)), text, `${name}: the normal form has the same text`);
    assert.equal(canonicalize(JSON.parse(canonicalize(scene, {pretty: true}))), text, `${name}: the pretty text holds the same scene`);
    assert.equal(sceneHash(scene), createHash('sha256').update(text, 'utf8').digest('hex'), `${name}: hash is SHA-256 of the text`);
    assert.equal(sceneHash(reversed(scene)), sceneHash(scene));
  }
  // Keys come out sorted, numbers in their shortest form, and there is no whitespace.
  const text = canonicalize({version: 1, format: 'box3d-scene', bodies: [{position: [1.50, -0, 1e21], shape: {radius: 0.1, kind: 'sphere'}, id: 'a'}]});
  assert.equal(text, '{"bodies":[{"id":"a","position":[1.5,0,1e+21],"shape":{"kind":"sphere","radius":0.1}}],"format":"box3d-scene","joints":[],"materials":{},"units":"SI","version":1,' +
    '"world":{"gravity":[0,-9.81,0],"ground":true,"seed":1,"step":0.016666666666666666,"subSteps":4}}');
  // Writing an engine default out, or leaving it out, is the same scene.
  const bare = {format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [0, 0, 0]}], joints: [{id: 'j', type: 'weld', bodyA: null, bodyB: 'a'}]};
  const spelled = copy(bare);
  Object.assign(spelled, {units: 'SI', world: {gravity: [0, -9.81, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4}, materials: {}});
  Object.assign(spelled.bodies[0], {type: 'dynamic', rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [-0, 0, 0], density: 1000, friction: 0.6, restitution: 0, color: 0xB8C0CC,
    bullet: false, sensor: false, hitEvents: false, neverSleeps: false, lockRotation: false, linearDamping: 0, angularDamping: 0, gravityScale: 1, filter: {groupIndex: 0}});
  Object.assign(spelled.joints[0], {frameA: {position: [0, 0, 0], rotation: [0, 0, 0, 1]}, frameB: {}, collideConnected: false});
  assert.equal(canonicalize(spelled), canonicalize(bare));
  assert.equal(sceneHash(spelled), sceneHash(bare));
  // A different scene has a different text: body order is the build order and is kept.
  const two = copy(bare); two.bodies.push({...two.bodies[0], id: 'b'});
  const swapped = copy(two); swapped.bodies.reverse();
  assert.notEqual(canonicalize(swapped), canonicalize(two));
  // With a named material, an inline value is an override and stays even when it equals the engine default.
  const override = normalizeScene({...bare, materials: {m: {density: 5, friction: 1, restitution: 1}}, bodies: [{...bare.bodies[0], material: 'm', friction: 0.6}]});
  assert.equal(override.bodies[0].friction, 0.6);
  assert.throws(() => canonicalize({format: 'box3d-scene', version: 1}), error => error instanceof SceneValidationError && error.code === 'INVALID_PAYLOAD' && error.problems[0].path === '/bodies');
});

test('rotationEuler is degrees about X, Y, Z (q = qx qy qz) and is normalised to a quaternion', () => {
  const s = Math.SQRT1_2, close = (q, e) => q.forEach((v, i) => near(v, e[i], 1e-12, `quaternion[${i}]`));
  close(eulerToQuaternion([90, 0, 0]), [s, 0, 0, s]);
  close(eulerToQuaternion([0, 90, 0]), [0, s, 0, s]);
  close(eulerToQuaternion([0, 0, 90]), [0, 0, s, s]);
  // X then Y: qx qy turns a vector about Y first, then about X. +z -> +x -> +x.
  const q = eulerToQuaternion([90, 90, 0]);
  rotate(q, [0, 0, 1]).forEach((v, i) => near(v, [1, 0, 0][i], 1e-12, 'z axis'));
  rotate(q, [1, 0, 0]).forEach((v, i) => near(v, [0, 1, 0][i], 1e-12, 'x axis'));
  const normal = normalizeScene(sample());
  assert.equal(normal.bodies[2].rotationEuler, undefined);
  close(normal.bodies[2].rotation, [0, s, 0, s]);
  close(normal.joints[1].frameA.rotation, [s, 0, 0, s]);
  assert.equal(normal.joints[1].frameA.rotationEuler, undefined);
});

// ---- Validation -------------------------------------------------------------

// [what, change to the sample scene (or a whole replacement), path, message, problems expected (default 1)]
const MALFORMED = [
  ['a scene that is not an object', () => null, '', /a scene must be an object, got null/],
  ['a scene that is an array', () => [], '', /got array/],
  ['a missing format', s => { delete s.format; }, '/format', /must be 'box3d-scene', got nothing/],
  ['a wrong format', s => { s.format = 'gltf'; }, '/format', /got "gltf"/],
  ['a newer version', s => { s.version = 2; }, '/version', /unsupported scene version 2; this build reads version 1 only/],
  ['a version of the wrong type', s => { s.version = '1'; }, '/version', /must be the integer 1, got "1"/],
  ['an unknown top-level key', s => { s.camera = {}; }, '/camera', /unknown key "camera"/],
  ['units other than SI', s => { s.units = 'imperial'; }, '/units', /must be 'SI', got "imperial"/],
  ['no bodies', s => { delete s.bodies; delete s.joints; }, '/bodies', /is required/],
  ['bodies that are not an array', s => { s.bodies = {}; delete s.joints; }, '/bodies', /must be an array, got object/],
  ['NaN gravity', s => { s.world.gravity[1] = NaN; }, '/world/gravity/1', /must be a finite number, got NaN/],
  ['gravity with two components', s => { s.world.gravity = [0, -9.81]; }, '/world/gravity', /exactly 3 numbers, got 2/],
  ['a step above 1/30 s', s => { s.world.step = 0.1; }, '/world/step', /must be in \(0, 1\/30\] seconds, got 0.1/],
  ['zero sub-steps', s => { s.world.subSteps = 0; }, '/world/subSteps', /must be >= 1, got 0/],
  ['a negative seed', s => { s.world.seed = -1; }, '/world/seed', /must be >= 0, got -1/],
  ['a fractional seed', s => { s.world.seed = 1.5; }, '/world/seed', /must be an integer, got 1.5/],
  ['ground that is not a boolean', s => { s.world.ground = 1; }, '/world/ground', /must be true or false, got number/],
  ['an unknown world key', s => { s.world.wind = [1, 0, 0]; }, '/world/wind', /unknown key "wind"/],
  ['a material without density', s => { delete s.materials.steel.density; }, '/materials/steel/density', /is required/],
  ['a material name with a space', s => { s.materials['hard steel'] = s.materials.steel; }, '/materials/hard steel', /may hold only letters, digits and _ \. : -/],
  ['a material with an unknown key', s => { s.materials.steel.youngs = 2e11; }, '/materials/steel/youngs', /unknown key "youngs"/],
  ['an unknown body key', s => { s.bodies[0].mass = 5; }, '/bodies/0/mass', /unknown key "mass"/],
  ['a body that is a string', s => { s.bodies[4] = 'crate'; s.joints.pop(); }, '/bodies/4', /must be an object, got string/],
  ['a body without an id', s => { delete s.bodies[4].id; s.joints.pop(); }, '/bodies/4/id', /is required/],
  ['a duplicate body id', s => { s.bodies[4].id = 'ball'; s.joints.pop(); }, '/bodies/4/id', /duplicate id "ball"; first used at \/bodies\/0\/id/],
  ['a joint that reuses a body id', s => { s.joints[1].id = 'ramp'; }, '/joints/1/id', /duplicate id "ramp"; first used at \/bodies\/1\/id/],
  ['a duplicate joint id', s => { s.joints[1].id = 'rope'; }, '/joints/1/id', /duplicate id "rope"; first used at \/joints\/0\/id/],
  ['an empty id', s => { s.bodies[3].id = ''; }, '/bodies/3/id', /1 to 64 characters, got 0/],
  ['an id with a slash', s => { s.bodies[3].id = 'a/b'; }, '/bodies/3/id', /may hold only letters, digits/],
  ['a numeric id', s => { s.bodies[3].id = 3; }, '/bodies/3/id', /must be a string, got number/],
  ['a body without a position', s => { delete s.bodies[3].position; }, '/bodies/3/position', /is required/],
  ['an unknown shape kind', s => { s.bodies[3].shape = {kind: 'cylinder', radius: 1}; }, '/bodies/3/shape/kind', /must be 'box', 'sphere', 'capsule', 'hull', 'mesh' or 'heightfield', got "cylinder"/],
  ['a negative radius', s => { s.bodies[0].shape.radius = -1; }, '/bodies/0/shape/radius', /must be >= 0.0001, got -1/],
  ['a radius given as text', s => { s.bodies[0].shape.radius = '0.25'; }, '/bodies/0/shape/radius', /must be a number, got string/],
  ['a sphere with box keys', s => { s.bodies[0].shape.halfExtents = [1, 1, 1]; }, '/bodies/0/shape/halfExtents', /unknown key "halfExtents"/],
  ['a box with two half extents', s => { s.bodies[4].shape.halfExtents = [1, 1]; }, '/bodies/4/shape/halfExtents', /exactly 3 numbers, got 2/],
  ['a box with a zero half extent', s => { s.bodies[4].shape.halfExtents[2] = 0; }, '/bodies/4/shape/halfExtents/2', /must be >= 0.0001, got 0/],
  ['a capsule without a half length', s => { delete s.bodies[3].shape.halfLength; }, '/bodies/3/shape/halfLength', /is required/],
  ['a hull of three points', s => { s.bodies[2].shape.points.length = 9; }, '/bodies/2/shape/points', /at least 4 points, got 3/],
  ['hull points that are not triples', s => { s.bodies[2].shape.points.push(1); }, '/bodies/2/shape/points', /19 numbers is not a multiple of 3/],
  ['a flat hull', s => { s.bodies[2].shape.points = [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0.5, 0, 0.5]; }, '/bodies/2/shape/points', /lie in one plane/],
  ['a non-finite hull point', s => { s.bodies[2].shape.points[4] = Infinity; }, '/bodies/2/shape/points/4', /must be a finite number, got Infinity/],
  ['too many hull points', s => { s.bodies[2].shape.points = new Array((SCENE_LIMITS.hullPoints + 1) * 3).fill(0); }, '/bodies/2/shape/points', /holds 4097 points; the limit is 4096/],
  ['a mesh index out of range', s => { s.bodies[1].shape.indices[4] = 4; }, '/bodies/1/shape/indices/4', /index 4 is out of range; the mesh has 4 vertices/],
  ['a negative mesh index', s => { s.bodies[1].shape.indices[0] = -1; }, '/bodies/1/shape/indices/0', /index -1 is out of range/],
  ['a fractional mesh index', s => { s.bodies[1].shape.indices[1] = 1.5; }, '/bodies/1/shape/indices/1', /must be an integer, got 1.5/],
  ['mesh indices that are not triangles', s => { s.bodies[1].shape.indices.pop(); }, '/bodies/1/shape/indices', /5 indices is not a multiple of 3/],
  ['a mesh of two vertices', s => { s.bodies[1].shape.vertices.length = 6; s.bodies[1].shape.indices = [0, 1, 0]; }, '/bodies/1/shape/vertices', /at least 3 vertices, got 2/],
  ['a dynamic mesh', s => { s.bodies[1].type = 'dynamic'; }, '/bodies/1/type', /a mesh body is always static, got "dynamic"/],
  ['a height field with the wrong number of heights', s => { s.bodies[5].shape.heights.pop(); }, '/bodies/5/shape/heights', /must hold countX \* countZ = 9 values, got 8/],
  ['a height field one sample wide', s => { s.bodies[5].shape.countX = 1; }, '/bodies/5/shape/countX', /must be >= 2, got 1/],
  ['a height field with zero spacing', s => { s.bodies[5].shape.spacing[1] = 0; }, '/bodies/5/shape/spacing/1', /must be >= 0.0001, got 0/],
  ['an infinite position', s => { s.bodies[0].position[0] = -Infinity; }, '/bodies/0/position/0', /must be a finite number, got -Infinity/],
  ['a position beyond float32', s => { s.bodies[0].position[2] = 1e39; }, '/bodies/0/position/2', /must fit a float32, got 1e\+39/],
  ['a position that is an object', s => { s.bodies[0].position = {x: 0, y: 3, z: 0}; }, '/bodies/0/position', /must be an array of 3 numbers, got object/],
  ['a rotation that is not a unit quaternion', s => { s.bodies[0].rotation = [0, 0, 0, 2]; }, '/bodies/0/rotation', /must be a unit quaternion \[x, y, z, w\].*got length 2/],
  ['both rotation and rotationEuler', s => { s.bodies[2].rotation = [0, 0, 0, 1]; }, '/bodies/2/rotationEuler', /give rotation or rotationEuler, not both/],
  ['an unknown body type', s => { s.bodies[3].type = 'fixed'; }, '/bodies/3/type', /must be 'static', 'kinematic' or 'dynamic', got "fixed"/],
  ['an unknown material name', s => { s.bodies[0].material = 'gold'; }, '/bodies/0/material', /unknown material "gold"/],
  ['a negative density', s => { s.bodies[2].density = -1; }, '/bodies/2/density', /must be >= 0, got -1/],
  ['a fractional color', s => { s.bodies[2].color = 1.5; }, '/bodies/2/color', /must be an integer, got 1.5/],
  ['a flag that is not a boolean', s => { s.bodies[0].hitEvents = 'yes'; }, '/bodies/0/hitEvents', /must be true or false, got string/],
  ['negative damping', s => { s.bodies[4].linearDamping = -0.1; }, '/bodies/4/linearDamping', /must be >= 0, got -0.1/],
  ['filter bits given as a number', s => { s.bodies[0].filter.categoryBits = 2; }, '/bodies/0/filter/categoryBits', /unsigned 64-bit integer as a decimal string, got number/],
  ['filter bits in hexadecimal', s => { s.bodies[0].filter.maskBits = '0xFF'; }, '/bodies/0/filter/maskBits', /decimal string \(0 to 18446744073709551615\), got "0xFF"/],
  ['negative filter bits', s => { s.bodies[0].filter.maskBits = '-1'; }, '/bodies/0/filter/maskBits', /got "-1"/],
  ['filter bits beyond 64 bits', s => { s.bodies[0].filter.maskBits = '18446744073709551616'; }, '/bodies/0/filter/maskBits', /got "18446744073709551616"/],
  ['filter bits with a leading zero', s => { s.bodies[0].filter.categoryBits = '02'; }, '/bodies/0/filter/categoryBits', /got "02"/],
  ['only one of the two filter bit fields', s => { delete s.bodies[0].filter.maskBits; }, '/bodies/0/filter', /needs both categoryBits and maskBits, or neither/],
  ['a filter group beyond int32', s => { s.bodies[0].filter.groupIndex = 2 ** 31; }, '/bodies/0/filter/groupIndex', /must be <= 2147483647/],
  ['userData that is an array', s => { s.bodies[0].userData = [1, 2]; }, '/bodies/0/userData', /must be an object, got array/],
  ['userData holding NaN', s => { s.bodies[0].userData.tags[1] = NaN; }, '/bodies/0/userData/tags/1', /must be a finite number, got NaN/],
  ['userData holding a function', s => { s.bodies[0].userData.nested.run = () => 1; }, '/bodies/0/userData/nested/run', /must be plain JSON, got function/],
  ['userData that is too large', s => { s.bodies[0].userData.blob = 'x'.repeat(70000); }, '/bodies/0/userData', /at most 65536 characters of JSON/],
  ['a joint to a body that does not exist', s => { s.joints[0].bodyB = 'ghost'; }, '/joints/0/bodyB', /unknown body id "ghost"/],
  ['a joint that names another joint as a body', s => { s.joints[1].bodyA = 'rope'; }, '/joints/1/bodyA', /unknown body id "rope"/],
  ['a joint without bodyA', s => { delete s.joints[0].bodyA; }, '/joints/0/bodyA', /is required/],
  ['a joint from a body to itself', s => { s.joints[1].bodyB = 'crate'; }, '/joints/1/bodyB', /two different bodies; both are "crate"/],
  ['a joint from the world to the world', s => { s.joints[0].bodyB = null; }, '/joints/0/bodyB', /cannot both be the world/],
  ['an unknown joint type', s => { s.joints[0].type = 'rope'; }, '/joints/0/type', /must be 'weld', 'revolute', 'spherical', 'prismatic', 'distance' or 'wheel', got "rope"/],
  ['a distance joint without a length', s => { delete s.joints[0].length; }, '/joints/0/length', /is required on a distance joint/],
  ['a distance joint of zero length', s => { s.joints[0].length = 0; }, '/joints/0/length', /must be > 0, got 0/],
  ['limits upside down', s => { s.joints[0].limits = {lower: 3, upper: 1}; }, '/joints/0/limits/upper', /must be >= lower \(3\), got 1/],
  ['a motor with negative force', s => { s.joints[1].motor.maxForce = -5; }, '/joints/1/motor/maxForce', /must be >= 0, got -5/],
  ['a motor without a speed', s => { delete s.joints[1].motor.speed; }, '/joints/1/motor/speed', /is required/],
  ['a spring with negative frequency', s => { s.joints[0].spring.hertz = -1; }, '/joints/0/spring/hertz', /must be >= 0, got -1/],
  ['a cone angle on a hinge', s => { s.joints[1].coneAngle = 0.5; }, '/joints/1/coneAngle', /a revolute joint does not take coneAngle/],
  ['a length on a hinge', s => { s.joints[1].length = 1; }, '/joints/1/length', /a revolute joint does not take length/],
  ['a motor on a weld', s => { s.joints[1].type = 'weld'; }, '/joints/1/motor', /a weld joint does not take motor/],
  ['a cone angle above pi', s => { Object.assign(s.joints[1], {type: 'spherical', coneAngle: 4}); delete s.joints[1].motor; }, '/joints/1/coneAngle', /must be <= 3.14159/],
  ['an unknown joint frame key', s => { s.joints[0].frameA.axis = [0, 1, 0]; }, '/joints/0/frameA/axis', /unknown key "axis"/],
  ['a joint frame rotation that is not unit length', s => { s.joints[0].frameA.rotation = [1, 1, 0, 0]; }, '/joints/0/frameA/rotation', /must be a unit quaternion/],
  ['an unknown meta key', s => { s.meta.license = 'MIT'; }, '/meta/license', /unknown key "license"/],
  ['a meta date that is not a date', s => { s.meta.created = 'yesterday'; }, '/meta/created', /must be a date/],
  ['a numeric title', s => { s.meta.title = 5; }, '/meta/title', /must be a string, got number/],
  ['extensions that are not an object', s => { s.extensions = 'none'; }, '/extensions', /must be an object, got string/],
  ['too many bodies', s => { s.bodies = new Array(SCENE_LIMITS.bodies + 1).fill(s.bodies[0]); s.joints = []; }, '/bodies', /holds 65537 bodies; the limit is 65536/],
];

test(`validation: ${MALFORMED.length} malformed scenes each report the expected path and message`, () => {
  assert.ok(MALFORMED.length >= 40);
  const seen = new Set();
  for (const [what, change, path, message, count = 1] of MALFORMED) {
    assert.ok(!seen.has(what), `case names are unique: ${what}`); seen.add(what);
    const scene = sample(), replaced = change(scene), target = replaced === undefined ? scene : replaced;
    const problems = validateScene(target);
    const found = problems.find(problem => problem.path === path && message.test(problem.message));
    assert.ok(found, `${what}: expected ${path} ${message}, got ${JSON.stringify(problems)}`);
    assert.equal(problems.length, count, `${what}: exactly ${count} problem(s), got ${JSON.stringify(problems)}`);
    // The same finding reaches the caller of loadScene, canonicalize and the link encoder, with no world needed to find it.
    assert.throws(() => canonicalize(target), error => error instanceof SceneValidationError && error.code === 'INVALID_PAYLOAD' && error.message.includes(`${path || '/'}: `), what);
    assert.throws(() => encodeSceneLinkSync(target), error => error.code === 'INVALID_PAYLOAD', what);
  }
});

test('validation lists every problem, stops at the limit, and never throws', () => {
  const scene = sample();
  scene.bodies[0].shape.radius = -1; scene.bodies[1].shape.indices[0] = 9; scene.joints[0].bodyB = 'ghost'; scene.world.subSteps = 99; scene.oops = 1;
  assert.deepEqual(validateScene(scene).map(problem => problem.path).sort(), ['/bodies/0/shape/radius', '/bodies/1/shape/indices/0', '/joints/0/bodyB', '/oops', '/world/subSteps']);
  const error = (() => { try { canonicalize(scene); } catch (caught) { return caught; } })();
  assert.equal(error.problems.length, 5);
  assert.match(error.message, /^Invalid scene \(5 problems\): /);
  const many = {format: 'box3d-scene', version: 1, bodies: new Array(500).fill({id: 'same', shape: {kind: 'sphere', radius: 0}, position: [0, 0, 0]})};
  const problems = validateScene(many);
  assert.equal(problems.length, SCENE_LIMITS.problems + 1);
  assert.match(problems.at(-1).message, /more than 100 problems/);
  assert.match(new SceneValidationError(problems).message, /first 5 shown/);
  for (const junk of [undefined, 0, 'scene', () => 1, new Map(), {format: 'box3d-scene', version: 1, bodies: [null, 1, [], {id: {}, shape: [], position: 'x'}], joints: [null, {id: 1, type: 2, bodyA: 3, bodyB: {}}], world: [], materials: [], meta: 1}]) {
    assert.ok(validateScene(junk).length > 0);
  }
  const cyclic = sample(); cyclic.bodies[0].userData.self = cyclic.bodies[0].userData;
  assert.match(validateScene(cyclic)[0].message, /nested deeper than 32 levels/);
});

test('extensions are kept and ignored; a scene without optional parts loads', async () => {
  const scene = sample();
  scene.extensions = {'vendor/thing': {anything: [1, 'two', null, {three: true}]}, z: 1, a: 2};
  assert.deepEqual(validateScene(scene), []);
  assert.deepEqual(normalizeScene(scene).extensions, scene.extensions);
  assert.deepEqual(decodeSceneLink(encodeSceneLinkSync(scene)).extensions, scene.extensions);
  const {world, bodies, joints, builder} = await open(scene);
  try {
    assert.deepEqual([...bodies.keys()], ['ball', 'ramp', 'rock', 'pill', 'crate', 'hills']);
    assert.deepEqual([...joints.keys()], ['rope', 'hinge']);
    assert.equal(world.bodyCount(), 7, 'six bodies and the ground');
    assert.deepEqual(saveScene(world, builder).extensions, scene.extensions);
    assert.deepEqual(saveScene(world, builder).meta, scene.meta);
    assert.deepEqual(world.bodyKinds().slice(1), ['sphere', 'mesh', 'hull', 'capsule', 'box', 'heightfield']);
    assert.equal(world.getState(bodies.get('pill')).type, 'kinematic');
    assert.equal(world.getState(bodies.get('ramp')).type, 'static');
    // The named material's density reaches the solver; the inline density overrides it.
    within(world.getState(bodies.get('ball')).mass, 7800 * 4 / 3 * Math.PI * 0.25 ** 3, 1e-5, 'ball mass from the steel material');
    within(world.getState(bodies.get('rock')).mass, 2500 * 4 / 3, 1e-5, 'octahedron mass from its own density');
    near(world.getJointState(joints.get('rope')).value, 2, 1e-5, 'the distance joint has its length');
    world.step();
    // Minimal scene: only format, version and bodies. The ground is there by default.
    const minimal = loadScene(world, {format: 'box3d-scene', version: 1, bodies: []});
    assert.equal(world.bodyCount(), 1);
    assert.equal(world.tick, 0);
    assert.deepEqual(minimal.scene.world, {gravity: [0, -9.81, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4});
    world.gravity().forEach((v, i) => near(v, [0, -9.81, 0][i], 1e-6, 'default gravity'));
  } finally { world.dispose(); }
});

test('collision filters travel as decimal strings and reach the solver as 64-bit masks', async () => {
  const scene = {format: 'box3d-scene', version: 1, world: {ground: false}, bodies: [
    {id: 'floor', shape: {kind: 'box', halfExtents: [5, 0.5, 5]}, type: 'static', position: [0, -0.5, 0], filter: {categoryBits: '9223372036854775808', maskBits: '18446744073709551615'}},
    {id: 'lands', shape: {kind: 'sphere', radius: 0.25}, position: [-1, 1, 0], filter: {categoryBits: '1', maskBits: '9223372036854775808'}},
    {id: 'falls', shape: {kind: 'sphere', radius: 0.25}, position: [1, 1, 0], filter: {categoryBits: '1', maskBits: '9223372036854775807'}},
  ]};
  const {world, bodies} = await open(scene);
  try {
    for (let i = 0; i < 90; i++) world.step();
    near(world.getState(bodies.get('lands')).position[1], 0.25, 0.01, 'the sphere whose mask has bit 63 rests on the floor');
    assert.ok(world.getState(bodies.get('falls')).position[1] < -2, 'the sphere whose mask lacks bit 63 falls through');
  } finally { world.dispose(); }
});

test('loadScene is atomic: a bad file leaves the world alone, a refused body leaves it reset and empty', async () => {
  const world = await createWorld({gravity: [0, -9.81, 0]});
  try {
    const good = loadScene(world, sample());
    for (let i = 0; i < 10; i++) world.step();
    const before = world.exactHash();
    // 1. Structural problems are found before anything is built: the running scene is untouched.
    const bad = sample(); bad.joints[1].bodyB = 'ghost';
    assert.throws(() => loadScene(world, bad), error => error instanceof SceneValidationError && error.code === 'INVALID_PAYLOAD' && /\/joints\/1\/bodyB: unknown body id "ghost"/.test(error.message));
    assert.equal(world.exactHash(), before);
    assert.equal(world.tick, 10);
    assert.ok(world.isAlive(good.bodies.get('ball')));
    // 2. A scene for another time step is refused before the world is touched.
    const other = sample(); other.world.step = 1 / 240;
    assert.throws(() => loadScene(world, other), error => error.code === 'INVALID_STATE' && /sceneWorldOptions/.test(error.message));
    assert.equal(world.exactHash(), before);
    // 3. A mesh whose only triangle has no area passes the structural check but the engine refuses it,
    //    after four bodies of the file were already built.
    for (const ground of [true, false]) {
      const midway = sample(); midway.world.ground = ground;
      midway.bodies[4] = {id: 'sliver', shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2]}, position: [0, 0, 0]};
      midway.joints.pop();
      assert.deepEqual(validateScene(midway), []);
      assert.throws(() => loadScene(world, midway), error => error.code === 'INVALID_PAYLOAD' && /^Scene body "sliver": /.test(error.message));
      assert.equal(world.bodyCount(), ground ? 1 : 0, 'none of the scene is left; only the ground slab if the scene asked for one');
      assert.equal(world.tick, 0);
      assert.equal(world.isAlive(good.bodies.get('ball')), false);
    }
    // 4. The same happens when a joint is refused, here by a world that fails on its second joint.
    let calls = 0;
    const faulty = new Proxy(world, {get(target, key) {
      if (key === 'createJoint') return options => { if (++calls === 2) throw new Error('injected fault'); return target.createJoint(options); };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    const full = sample(); full.world.ground = false;
    assert.throws(() => loadScene(faulty, full), error => error.code === 'INTERNAL' && error.message === 'Scene joint "hinge": injected fault');
    assert.equal(world.bodyCount(), 0);
    // The world is usable afterwards.
    assert.equal(loadScene(world, sample()).bodies.size, 6);
    // 5. A scene larger than the world's capacity raises it; one that cannot fit fails cleanly.
    const ball = i => ({id: `b${i}`, shape: {kind: 'sphere', radius: 0.1}, position: [i % 100, 1 + Math.floor(i / 100), 0]});
    assert.equal(world.stats().capacity, 4096);
    const crowd = {format: 'box3d-scene', version: 1, bodies: Array.from({length: 4200}, (_, i) => ball(i))};
    assert.equal(loadScene(world, crowd).bodies.size, 4200);
    assert.equal(world.bodyCount(), 4201);
    assert.ok(world.stats().capacity >= 4201);
    const tooMany = {format: 'box3d-scene', version: 1, bodies: new Array(65536).fill(0).map((_, i) => ball(i))};
    assert.deepEqual(validateScene(tooMany), []);
    assert.throws(() => loadScene(world, tooMany), error => error.code === 'WORLD_CAPACITY' && /65537 bodies with the ground/.test(error.message));
    assert.equal(world.bodyCount(), 1);
  } finally { world.dispose(); }
});

// ---- Share links ------------------------------------------------------------

test('share links: every scene survives the compressed and the stored path to identical canonical text', async () => {
  for (const [name, make] of [['sample', sample], ...Object.entries(EXAMPLE_SCENES)]) {
    const scene = make(), text = canonicalize(scene), bytes = Buffer.from(text, 'utf8');
    const packed = await encodeSceneLink(scene), stored = await encodeSceneLink(scene, {compress: false}), sync = encodeSceneLinkSync(scene);
    assert.match(packed, /^b3s1d\.[0-9a-z]+\.[0-9a-f]{8}\.[A-Za-z0-9_-]+$/, `${name}: compressed link is URL-safe`);
    assert.match(sync, /^b3s1r\.[0-9a-z]+\.[0-9a-f]{8}\.[A-Za-z0-9_-]+$/, `${name}: stored link is URL-safe`);
    assert.equal(stored, sync);
    assert.equal(encodeURIComponent(packed), packed, 'needs no escaping');
    // The stated format, field by field.
    const [head, length, crc, data] = packed.split('.');
    assert.equal(head, 'b3s1d');
    assert.equal(parseInt(length, 36), bytes.length);
    assert.equal(crc, crcHex(bytes));
    assert.deepEqual(zlib.inflateRawSync(Buffer.from(data, 'base64url')), bytes, 'data is raw DEFLATE of the canonical JSON');
    assert.equal(sync, link('r', bytes.length, crcHex(bytes), bytes), 'stored data is the canonical JSON itself');
    assert.ok(packed.length < sync.length * 0.6, `${name}: compression shortens the link (${packed.length} vs ${sync.length})`);
    for (const [label, one] of [['compressed', packed], ['stored', sync], ['in a URL', `https://example.org/lab.html?x=1#scene=${packed}&y=2`]]) {
      assert.equal(canonicalize(decodeSceneLink(one)), text, `${name} ${label}`);
    }
    assert.equal(await encodeSceneLink(reversed(scene)), packed, 'equal scenes give equal links');
  }
});

test('share links: without CompressionStream the encoder stores, and the built-in inflate reads any DEFLATE stream', async () => {
  const scene = EXAMPLE_SCENES['terrain-car'](), text = canonicalize(scene), bytes = Buffer.from(text);
  const saved = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    assert.equal(await encodeSceneLink(scene), encodeSceneLinkSync(scene));
  } finally { globalThis.CompressionStream = saved; }
  assert.match(await encodeSceneLink(scene), /^b3s1d\./);
  // Stored, fixed-Huffman and dynamic-Huffman blocks, small and large windows, and a scene big enough for many blocks.
  const side = 96, big = {format: 'box3d-scene', version: 1, bodies: [{id: 'terrain', position: [0, 0, 0],
    shape: {kind: 'heightfield', countX: side, countZ: side, spacing: [1, 1], heights: Array.from({length: side * side}, (_, i) => Math.round(1000 * Math.sin(i * 0.37) * Math.cos(i * 0.011)) / 1000)}}]};
  for (const source of [bytes, Buffer.from(canonicalize(big))]) {
    for (const options of [{level: 0}, {level: 1}, {level: 9}, {level: 9, strategy: zlib.constants.Z_FIXED}, {level: 6, windowBits: 9}, {level: 6, strategy: zlib.constants.Z_HUFFMAN_ONLY}, {level: 4, chunkSize: 64, memLevel: 1}]) {
      const made = link('d', source.length, crcHex(source), zlib.deflateRawSync(source, options));
      assert.equal(canonicalize(decodeSceneLink(made)), source.toString(), JSON.stringify(options));
    }
  }
  assert.equal(canonicalize(decodeSceneLink(await encodeSceneLink(big))), canonicalize(big));
});

test('share links: corrupt, truncated, wrong-checksum, oversized and bomb links are refused', async () => {
  const scene = EXAMPLE_SCENES['domino-run'](), bytes = Buffer.from(canonicalize(scene));
  const packed = await encodeSceneLink(scene), stored = encodeSceneLinkSync(scene);
  const [head, length, crc, data] = packed.split('.');
  invalidLink('', /no link found/, 'empty');
  invalidLink('https://example.org/', /no link found/, 'a URL without a scene');
  invalidLink(42, /expected a string/, 'not a string');
  invalidLink(packed.replace('b3s1', 'b3s2'), /unsupported link version 2; this build reads version 1/, 'a newer link version');
  invalidLink(packed.replace('b3s1d', 'b3s1z'), /unknown encoding 'z'/, 'an unknown encoding');
  // Wrong checksum.
  invalidLink([head, length, crc === '00000000' ? '00000001' : '00000000', data].join('.'), /checksum mismatch/, 'wrong checksum, compressed');
  invalidLink(stored.replace(/\.[0-9a-f]{8}\./, '.deadbeef.'), /checksum mismatch \(the link says deadbeef/, 'wrong checksum, stored');
  // Truncated, at every kind of place.
  invalidLink(packed.slice(0, 12), /no link found/, 'cut inside the header');
  invalidLink(packed.slice(0, -1), /cut off|corrupt|stray bits|declares/, 'cut by one character');
  invalidLink(packed.slice(0, head.length + length.length + crc.length + 3 + (data.length >> 1)), /cut off|corrupt|stray bits|declares/, 'cut in half');
  invalidLink(stored.slice(0, -8), /declares \d+ bytes and holds \d+/, 'stored link cut short');
  invalidLink([head, length, crc, ''].join('.'), /cut off/, 'no data at all');
  // Corrupt: every single-character change of the data is caught (by the decoder, the length, or the CRC), never accepted.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const whole of [packed, stored]) {
    const start = whole.lastIndexOf('.') + 1;
    for (let i = start; i < whole.length; i += 7) {
      const swap = alphabet[(alphabet.indexOf(whole[i]) + 1 + (i % 62)) % 64];
      assert.throws(() => decodeSceneLink(whole.slice(0, i) + swap + whole.slice(i + 1)), error => error.code === 'INVALID_PAYLOAD', `changed character ${i}`);
    }
  }
  // A stored link whose bytes are valid but are not a scene, or not JSON.
  const notScene = Buffer.from('{"format":"box3d-scene","version":1,"bodies":[{"id":"a"}]}');
  assert.throws(() => decodeSceneLink(link('r', notScene.length, crcHex(notScene), notScene)), error => error instanceof SceneValidationError && error.problems.some(p => p.path === '/bodies/0/shape'));
  const notJson = Buffer.from([0xff, 0xfe, 0x7b]);
  invalidLink(link('r', notJson.length, crcHex(notJson), notJson), /not UTF-8 JSON/, 'bytes that are not UTF-8');
  // Oversized: the text, the declared size, and the scene handed to the encoder.
  invalidLink('x'.repeat(SCENE_LIMITS.linkChars + 5000), /a link is at most 1048576/, 'text far too long');
  invalidLink(`b3s1r.1.00000000.${'A'.repeat(SCENE_LIMITS.linkChars)}`, /the limit is 1048576/, 'link too long');
  invalidLink(link('d', SCENE_LIMITS.linkSceneBytes + 1, crc, zlib.deflateRawSync(bytes)), /declares a scene of 4194305 bytes; the limit is 4194304/, 'declared size over the limit');
  invalidLink(`b3s1d.zzzzzzzzzzzz.${crc}.${data}`, /declares a scene of too many bytes/, 'absurd declared size');
  const side = 700, huge = {format: 'box3d-scene', version: 1, bodies: [{id: 't', position: [0, 0, 0], shape: {kind: 'heightfield', countX: side, countZ: side, spacing: [1, 1], heights: Array.from({length: side * side}, (_, i) => i * 1.000001)}}]};
  assert.deepEqual(validateScene(huge), []);
  assert.throws(() => encodeSceneLinkSync(huge), error => error.code === 'INVALID_PAYLOAD' && /a link carries at most 4194304/.test(error.message));
  await assert.rejects(encodeSceneLink(huge), error => error.code === 'INVALID_PAYLOAD' && /a link carries at most 4194304/.test(error.message));
  // Decompression bombs. 64 MiB of zeros deflates to about 62 KiB; the decoder stops at the declared size
  // and never allocates more than that, whatever the stream goes on to say.
  const bomb = zlib.deflateRawSync(Buffer.alloc(64 << 20), {level: 9});
  assert.ok(bomb.length < 100_000);
  invalidLink(link('d', 1000, '00000000', bomb), /decompresses to more than the 1000 bytes it declares; refused/, 'bomb with a small declared size');
  invalidLink(link('d', SCENE_LIMITS.linkSceneBytes, '00000000', bomb), /decompresses to more than the 4194304 bytes it declares; refused/, 'bomb at the largest declared size');
  invalidLink(link('d', 64 << 20, '00000000', bomb), /the limit is 4194304/, 'bomb that declares its true size');
  // A stream that inflates to LESS than declared is refused too.
  invalidLink(link('d', bytes.length + 1, crc, zlib.deflateRawSync(bytes)), /declares \d+ bytes and holds \d+/, 'shorter than declared');
  // The good link still decodes after all that.
  assert.equal(canonicalize(decodeSceneLink(packed)), bytes.toString());
});

// ---- Determinism, save and resume -------------------------------------------

test('determinism: a scene gives the same exactHash every time it is loaded, also from a share link', async () => {
  for (const [name, make] of Object.entries(EXAMPLE_SCENES)) {
    const scene = make(), ticks = 150;
    const first = await open(scene), second = await open(decodeSceneLink(await encodeSceneLink(scene)));
    try {
      const run = world => { for (let i = 0; i < ticks; i++) world.step(); return world.exactHash(); };
      const hash = run(first.world);
      loadScene(first.world, copy(scene));
      assert.equal(run(first.world), hash, `${name}: reloaded in the same world`);
      assert.equal(run(second.world), hash, `${name}: a fresh world, from a compressed link`);
      loadScene(second.world, decodeSceneLink(encodeSceneLinkSync(reversed(scene))));
      assert.equal(run(second.world), hash, `${name}: from a stored link with shuffled keys`);
      loadScene(second.world, saveScene(first.world, loadScene(first.world, scene), {state: false}));
      assert.equal(run(second.world), hash, `${name}: from the description saved back out`);
      const moved = copy(scene); moved.bodies[moved.bodies.length - 1].position[0] += 0.01;
      loadScene(second.world, moved);
      assert.notEqual(run(second.world), hash, `${name}: a different scene gives a different hash`);
    } finally { first.world.dispose(); second.world.dispose(); }
  }
});

// What a save carries: every body's position, rotation, linear and angular velocity and type, and the world's
// gravity. What it does not: sleep state (every body wakes), the contact impulses and joint impulses the solver
// warm-starts from, and the tick count. So a resumed run starts from the same state but its first solver
// iterations start cold, and the two runs drift apart. The bounds below are for 100 ticks after a save at tick
// 100, each several times the measured value (printed by the test):
//   - pendulum wave, Newton's cradle: joints only, smooth motion. Measured <= 1e-7 m; bound 1e-5 m.
//   - terrain car: rolling contact and suspension springs, which damp a perturbation. Measured 2e-4 m; bound 5e-3 m.
//   - domino run: dominoes mid-fall, where a cold contact changes when each one lands. Measured 1e-2 m; bound 5e-2 m.
//   - ragdoll: saved as it lands on its feet and starts to topple, and compared at tick 200, the moment its head
//     strikes the ground at 7 m/s. One tick of difference in that impact is 6 cm. Measured 7e-2 m; bound 0.4 m,
//     a fifth of its height.
const RESUME_BOUND = {'pendulum-wave': 1e-5, 'newtons-cradle': 1e-5, 'terrain-car': 5e-3, 'domino-run': 5e-2, ragdoll: 0.4};

test('save and resume: state at the moment of load matches to float32, then drifts within a stated bound', async t => {
  for (const [name, make] of Object.entries(EXAMPLE_SCENES)) {
    const original = await open(make());
    for (let i = 0; i < 100; i++) original.world.step();
    const saved = copy(saveScene(original.world, original));
    assert.deepEqual(validateScene(saved), []);
    const resumed = await open(decodeSceneLink(await encodeSceneLink(saved)));
    try {
      assert.deepEqual([...resumed.bodies.keys()], [...original.bodies.keys()]);
      assert.deepEqual([...resumed.joints.keys()], [...original.joints.keys()]);
      let rotationError = 0, asleep = 0;
      for (const [id, body] of original.bodies) {
        const a = original.world.getState(body), b = resumed.world.getState(resumed.bodies.get(id));
        // Bit-exact: the float32 the solver held is written as the shortest decimal that reads back to it.
        assert.deepEqual(b.position, a.position, `${name} ${id}: position`);
        assert.deepEqual(b.linearVelocity, a.linearVelocity, `${name} ${id}: linear velocity`);
        assert.deepEqual(b.angularVelocity, a.angularVelocity, `${name} ${id}: angular velocity`);
        assert.equal(b.type, a.type);
        assert.equal(b.mass, a.mass);
        // The engine renormalises the quaternion it is given, which can move a component by one float32 step.
        a.rotation.forEach((v, i) => { rotationError = Math.max(rotationError, Math.abs(v - b.rotation[i])); });
        // Sleep state is not carried: every loaded body that can move is awake. (A static body never is.)
        if (a.type === 'static') continue;
        if (!a.awake) asleep++;
        assert.equal(b.awake, true, `${name} ${id}: awake after loading`);
      }
      assert.ok(rotationError <= 2 ** -22, `${name}: rotation within two float32 steps (${rotationError})`);
      assert.equal(resumed.world.tick, 0, 'the tick count is not carried');
      // Saving the resumed world at once gives back the same poses and velocities.
      const again = saveScene(resumed.world, resumed);
      again.bodies.forEach((body, i) => { assert.deepEqual(body.position, saved.bodies[i].position); assert.deepEqual(body.linearVelocity, saved.bodies[i].linearVelocity); });
      let energy = 0;
      for (let i = 0; i < 100; i++) { original.world.step(); resumed.world.step(); }
      let drift = 0, speedDrift = 0;
      for (const [id, body] of original.bodies) {
        const a = original.world.getState(body), b = resumed.world.getState(resumed.bodies.get(id));
        drift = Math.max(drift, Math.hypot(...a.position.map((v, i) => v - b.position[i])));
        speedDrift = Math.max(speedDrift, Math.hypot(...a.linearVelocity.map((v, i) => v - b.linearVelocity[i])));
        for (const v of [...b.position, ...b.linearVelocity]) assert.ok(Number.isFinite(v));
        energy += 0.5 * b.mass * b.linearVelocity.reduce((s, v) => s + v * v, 0);
      }
      t.diagnostic(`${name}: saved with ${asleep} of ${original.bodies.size} bodies asleep, all awake after loading; rotation error at load ${rotationError.toExponential(2)}; ` +
        `after 100 more ticks position drift ${drift.toExponential(2)} m, velocity drift ${speedDrift.toExponential(2)} m/s (bound ${RESUME_BOUND[name]} m)`);
      assert.ok(drift <= RESUME_BOUND[name], `${name}: drift ${drift} m after 100 ticks is within ${RESUME_BOUND[name]} m`);
      assert.ok(Number.isFinite(energy));
    } finally { original.world.dispose(); resumed.world.dispose(); }
  }
});

test('SceneBuilder records what it creates, removes by id, and saves at any time', async () => {
  const world = await createWorld({step: 1 / 120, subSteps: 4, seed: 9, gravity: [0, -9.81, 0]});
  try {
    const builder = new SceneBuilder(world, {world: {gravity: [0, -1.62, 0], ground: false}, meta: {title: 'Moon'}});
    assert.equal(world.bodyCount(), 0, 'the builder resets the world to its settings');
    near(world.gravity()[1], -1.62, 1e-6, 'gravity');
    builder.defineMaterial('rock', {density: 3000, friction: 0.8, restitution: 0});
    // Scene JSON and the kit's own BodyOptions (bigints, typed arrays, {x, y, z}) are both accepted.
    const floor = builder.addBody('floor', {shape: {kind: 'box', halfExtents: {x: 5, y: 0.5, z: 5}}, type: 'static', position: {x: 0, y: -0.5, z: 0}, filter: {categoryBits: 1n, maskBits: 0xFFFFFFFFFFFFFFFFn}});
    const stone = builder.addBody('stone', {shape: {kind: 'hull', points: new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1])}, position: [0, 3, 0], material: 'rock', userData: {found: 'crater'}});
    const lamp = builder.addBody('lamp', {shape: {kind: 'sphere', radius: 0.2}, position: [4.2, 2.4, 0]});
    builder.addJoint('chain', {type: 'distance', bodyA: 'floor', bodyB: 'lamp', frameA: {position: [3, 4.5, 0]}, length: 2});
    builder.addJoint('glue', {type: 'weld', bodyA: null, bodyB: 'stone'});
    assert.equal(builder.body('stone'), stone);
    assert.equal(builder.idOf(lamp), 'lamp');
    assert.equal(builder.idOf(floor), 'floor');
    assert.deepEqual([...builder.bodies().keys()], ['floor', 'stone', 'lamp']);
    assert.deepEqual(builder.describe('floor').filter, {categoryBits: '1', maskBits: '18446744073709551615'});
    assert.deepEqual(builder.describe('stone').shape.points, [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    // Mistakes are refused with the same paths, and leave the world as it was.
    const count = world.bodyCount();
    assert.throws(() => builder.addBody('lamp', {shape: {kind: 'sphere', radius: 1}, position: [0, 0, 0]}), error => error instanceof SceneValidationError && /duplicate id "lamp"/.test(error.message));
    assert.throws(() => builder.addBody('chain', {shape: {kind: 'sphere', radius: 1}, position: [0, 0, 0]}), /duplicate id "chain"/);
    assert.throws(() => builder.addBody('bad', {shape: {kind: 'sphere', radius: -1}, position: [0, 0, 0]}), error => error.problems[0].path === '/bodies/bad/shape/radius');
    assert.throws(() => builder.addBody('bad', {shape: {kind: 'sphere', radius: 1}, position: [0, 0, 0], material: 'cheese'}), /unknown material "cheese"/);
    assert.throws(() => builder.addBody('no good', {shape: {kind: 'sphere', radius: 1}, position: [0, 0, 0]}), /may hold only letters/);
    assert.throws(() => builder.addJoint('j', {type: 'weld', bodyA: 'lamp', bodyB: 'nobody'}), error => error.problems[0].path === '/joints/j/bodyB' && /unknown body id "nobody"/.test(error.message));
    assert.throws(() => builder.defineMaterial('ice', {density: -1, friction: 0, restitution: 0}), /\/materials\/ice\/density/);
    assert.equal(world.bodyCount(), count);
    // Save at tick 0: exactly what was described.
    const start = builder.toJSON();
    assert.deepEqual(validateScene(start), []);
    assert.deepEqual(start.world, {gravity: [0, -1.62, 0], ground: false, seed: 9, step: 1 / 120, subSteps: 4});
    assert.deepEqual(start.bodies.map(body => body.id), ['floor', 'stone', 'lamp']);
    assert.deepEqual(start.bodies[1].position, [0, 3, 0], 'an unchanged value is written as authored');
    assert.deepEqual(start.bodies[1].userData, {found: 'crater'});
    assert.deepEqual(start.joints.map(joint => [joint.id, joint.bodyA, joint.bodyB]), [['chain', 'floor', 'lamp'], ['glue', null, 'stone']]);
    assert.equal(start.meta.title, 'Moon');
    assert.equal(JSON.stringify(builder), JSON.stringify(start), 'JSON.stringify(builder) is the scene');
    // Run, change things on the world, save: pose, velocity, type and gravity are read back.
    for (let i = 0; i < 60; i++) world.step();
    world.setGravity([0, -3.7, 0]);
    world.setBodyType(stone, 'kinematic');
    const later = saveScene(world, builder, {meta: {title: 'Mars'}});
    assert.equal(later.meta.title, 'Mars');
    near(later.world.gravity[1], -3.7, 1e-6, 'current gravity');
    assert.equal(later.bodies[1].type, 'kinematic');
    assert.deepEqual(later.bodies[2].position, world.getState(lamp).position);
    assert.deepEqual(later.bodies[2].linearVelocity, world.getState(lamp).linearVelocity);
    assert.ok(Math.abs(later.bodies[2].position[0] - 4.2) > 0.05, 'the lamp swung');
    assert.deepEqual(saveScene(world, builder, {state: false}).bodies[2].position, [4.2, 2.4, 0], 'state: false gives the description');
    // Removing a body removes its joints; removing a joint leaves the bodies.
    assert.equal(builder.remove('glue'), true);
    assert.equal(world.isAlive(stone), true);
    assert.equal(builder.remove('lamp'), true);
    assert.equal(world.isAlive(lamp), false);
    assert.equal(builder.remove('lamp'), false);
    assert.equal(builder.has('chain'), false, 'the joint went with its body');
    // A body destroyed on the world directly is dropped from the next save, with its joints.
    builder.addBody('extra', {shape: {kind: 'capsule', radius: 0.1, halfLength: 0.2}, position: [0, 6, 0]});
    builder.addJoint('tie', {type: 'spherical', bodyA: 'stone', bodyB: 'extra', coneAngle: 0.5});
    world.destroyBody(builder.body('extra'));
    const end = builder.toJSON();
    assert.deepEqual(end.bodies.map(body => body.id), ['floor', 'stone']);
    assert.deepEqual(end.joints, []);
    assert.equal(loadScene(world, end).bodies.size, 2);
    // saveScene insists on the right builder.
    assert.throws(() => saveScene(world, {}), error => error.code === 'INVALID_PAYLOAD' && /needs the SceneBuilder/.test(error.message));
    const elsewhere = await createWorld({});
    try { assert.throws(() => saveScene(elsewhere, builder), /belongs to another world/); } finally { elsewhere.dispose(); }
    assert.throws(() => new SceneBuilder(world, {world: {step: 1 / 60}}), error => error.code === 'INVALID_STATE');
  } finally { world.dispose(); }
});

// ---- Physics from a file ----------------------------------------------------

test('the pendulum-wave scene: every period is 2 pi sqrt(I / (m g L)) within 0.1%, and the wave realigns', async t => {
  const scene = copy(pendulumWaveScene()), {world, bodies} = await open(decodeSceneLink(encodeSceneLinkSync(scene)));
  try {
    const hz = Math.round(1 / scene.world.step), radius = scene.bodies[0].shape.radius;
    const pivots = new Map(scene.joints.map(joint => [joint.bodyB, joint.frameA.position]));
    const previous = new Map(scene.bodies.map(body => [body.id, body.userData.angle])), crossings = new Map(scene.bodies.map(body => [body.id, []]));
    for (let i = 1; i <= hz * 20; i++) {
      world.step();
      for (const [id, body] of bodies) {
        const p = world.getState(body).position, pivot = pivots.get(id), theta = Math.atan2(p[0], pivot[1] - p[1]), was = previous.get(id);
        if (was > 0 && theta <= 0) crossings.get(id).push((i - 1 + was / (was - theta)) / hz);
        previous.set(id, theta);
      }
    }
    let worst = 0;
    scene.bodies.forEach((body, k) => {
      const times = crossings.get(body.id), period = (times.at(-1) - times[0]) / (times.length - 1), {length, angle} = body.userData;
      // Compound pendulum, I = m (L^2 + 2 r^2 / 5), times the finite-amplitude factor 1 + theta0^2 / 16 (as in v08).
      const exact = 2 * Math.PI * Math.sqrt((length * length + 0.4 * radius * radius) / (G * length)) * (1 + angle * angle / 16);
      within(period, exact, 1e-3, `${body.id} period (L = ${length} m)`);
      worst = Math.max(worst, Math.abs(period / exact - 1));
      // The scene's design: pendulum k makes 30 + k swings in 60 s. The file records that period.
      within(body.userData.period, 60 / (30 + k), 1e-5, `${body.id} design period`);
      near(Math.hypot(...world.getState(bodies.get(body.id)).position.map((v, i) => v - pivots.get(body.id)[i])), length, 1e-4, `${body.id} stays on its arc`);
    });
    t.diagnostic(`pendulum wave: worst period error ${(worst * 100).toFixed(4)}% over ${scene.bodies.length} pendulums`);
  } finally { world.dispose(); }
});

test("the Newton's-cradle scene passes the impulse through and conserves momentum", async t => {
  const scene = copy(newtonsCradleScene()), {world, bodies} = await open(scene);
  try {
    const hz = Math.round(1 / scene.world.step), ids = [...bodies.keys()], last = ids.at(-1);
    const state = id => world.getState(bodies.get(id)), vx = id => state(id).linearVelocity[0];
    const momentum = () => ids.reduce((sum, id) => sum + state(id).mass * vx(id), 0);
    const {length} = scene.bodies[0].userData, radius = scene.bodies[0].shape.radius;
    const pivot = scene.joints[0].frameA.position, start = scene.bodies[0].position, angle = Math.atan2(pivot[0] - start[0], pivot[1] - start[1]);
    let incoming = 0, before = 0, outgoing = 0, after = 0, others = 0, struck = -1, left = -1;
    for (let i = 1; i <= hz; i++) {
      const pre = momentum(), speed = vx(ids[0]);
      world.step();
      if (struck < 0 && vx(ids[1]) > 0.01) { struck = i; incoming = speed; before = pre; }
      if (struck >= 0 && left < 0 && vx(last) > 0.01) {
        left = i; outgoing = vx(last); after = momentum();
        others = Math.max(...ids.slice(0, -1).map(id => Math.abs(vx(id))));
      }
    }
    assert.ok(struck > 0 && left > struck, 'the first ball struck and the last ball left');
    // Energy: the first ball arrives at sqrt(2 g L (1 - cos theta) / (1 + 2 r^2 / (5 L^2))).
    within(incoming, Math.sqrt(2 * G * length * (1 - Math.cos(angle)) / (1 + 0.4 * radius * radius / (length * length))), 5e-3, 'arrival speed of the first ball');
    assert.ok(incoming > 1, 'above the speed at which the engine applies restitution');
    // Stated tolerances: 2% on the speed handed to the last ball and on total momentum, measured from the step
    // before the first contact to the step the last ball leaves. The balls between hang on their hinges while the
    // impulse crosses, so gravity and the hinges take a little out; measured loss is 0.5%.
    within(outgoing, incoming, 0.02, 'the last ball leaves at the first ball\'s speed');
    within(after, before, 0.02, 'momentum along the row');
    assert.ok(others < 0.03 * incoming, `the other balls are left nearly at rest (fastest ${others} m/s)`);
    const mass = state(ids[0]).mass;
    for (const id of ids) assert.equal(state(id).mass, mass, 'equal balls');
    t.diagnostic(`cradle: in ${incoming.toFixed(4)} m/s at tick ${struck}, out ${outgoing.toFixed(4)} m/s at tick ${left} (${(outgoing / incoming * 100).toFixed(2)}%), momentum kept ${(after / before * 100).toFixed(2)}%`);
  } finally { world.dispose(); }
});

test('the domino, car and ragdoll scenes do what they describe', async () => {
  const seconds = (world, scene, time) => { for (let i = 0; i < Math.round(time / scene.world.step); i++) world.step(); };
  {
    const scene = EXAMPLE_SCENES['domino-run'](), {world, bodies} = await open(scene);
    try {
      seconds(world, scene, 3);
      for (const [id, body] of bodies) assert.ok(rotate(world.getState(body).rotation, [0, 1, 0])[1] < 0.5, `${id} has fallen`);
    } finally { world.dispose(); }
  }
  {
    const scene = EXAMPLE_SCENES['terrain-car'](), {world, bodies, joints} = await open(scene);
    try {
      assert.equal(world.bodyCount(), 6, 'terrain, chassis and four wheels; no ground slab');
      seconds(world, scene, 3);
      const chassis = world.getState(bodies.get('chassis'));
      assert.ok(Math.abs(chassis.position[0]) > 3, `the car drove (x = ${chassis.position[0]})`);
      assert.ok(chassis.position[1] > 0.5 && chassis.position[1] < 1.5, `and rides on its suspension over the hills (y = ${chassis.position[1]})`);
      near(chassis.position[2], 0, 0.5, 'in a straight line');
      for (const joint of joints.values()) assert.equal(world.getJointState(joint).type, 'wheel');
    } finally { world.dispose(); }
  }
  {
    const scene = EXAMPLE_SCENES.ragdoll(), {world, bodies, joints, scene: built} = await open(scene);
    try {
      assert.equal(joints.size, 9);
      seconds(world, scene, 3);
      // Every socket still holds: the two anchor points coincide.
      for (const joint of built.joints) {
        const a = world.getState(bodies.get(joint.bodyA)), b = world.getState(bodies.get(joint.bodyB));
        const pa = rotate(a.rotation, joint.frameA.position).map((v, i) => v + a.position[i]), pb = rotate(b.rotation, joint.frameB.position).map((v, i) => v + b.position[i]);
        near(Math.hypot(...pa.map((v, i) => v - pb[i])), 0, 0.01, `${joint.id} anchors`);
      }
      for (const [id, body] of bodies) { const y = world.getState(body).position[1]; assert.ok(y > 0 && y < 0.6, `${id} lies on the ground (y = ${y})`); }
    } finally { world.dispose(); }
  }
});

test('joint stiffness is part of the scene format', async () => {
  const {validateScene, canonicalize, loadScene: load} = await import('box3d-webgpu-kit/scene');
  const {createWorld: make} = await import('box3d-webgpu-kit');
  const scene = stiffness => ({format: 'box3d-scene', version: 1, world: {ground: false, step: 1 / 240},
    bodies: [{id: 'bob', shape: {kind: 'sphere', radius: 0.1}, position: [0, -1, 0], density: 8000, neverSleeps: true}],
    joints: [{id: 'rod', type: 'weld', bodyA: null, bodyB: 'bob', frameB: {position: [0, 1, 0]}, ...(stiffness ? {stiffness} : {})}]});
  assert.deepEqual(validateScene(scene({hertz: 240})), []);
  assert.equal(validateScene(scene({hertz: -5}))[0].path, '/joints/0/stiffness/hertz');
  assert.equal(validateScene(scene({hertz: 60, extra: 1}))[0].path, '/joints/0/stiffness/extra');
  assert.ok(canonicalize(scene({hertz: 240, dampingRatio: 2})).includes('"stiffness":{"hertz":240}'), 'the default damping ratio is dropped from the normal form');
  const hang = async stiffness => {
    const world = await make({gravity: [0, -9.81, 0], ground: false, step: 1 / 240, subSteps: 4});
    try { const {bodies} = load(world, scene(stiffness)); for (let i = 0; i < 480; i++) world.step(); return -1 - world.getState(bodies.get('bob')).position[1]; }
    finally { world.dispose(); }
  };
  const soft = await hang(null), stiff = await hang({hertz: 240});
  assert.ok(soft > 4 * stiff && stiff >= 0, `a stiffer weld from a scene file sags less (${soft} m against ${stiff} m)`);
});
