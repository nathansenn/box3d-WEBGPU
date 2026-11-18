// The rigid-core example scenes (RIGID_CORE_EXAMPLE_SCENES of box3d-webgpu-kit/scene) and the roles that play them
// (SceneRoles of box3d-webgpu-kit/gameplay): a character on an obstacle course, a car on terrain, a ray-cast
// scanner, bullets and thin plates, a bridge whose welds break. Each scene validates, travels in a share link and
// loads; what happens in it is compared with closed forms; and a checkpoint taken while it plays resumes bit for bit.
// The set-ups are in rigid-core-scenarios.mjs and docs/VALIDATION.md has the same cases as rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as index from 'box3d-webgpu-kit';
import * as gameplay from 'box3d-webgpu-kit/gameplay';
import * as sceneModule from 'box3d-webgpu-kit/scene';
import * as S from './rigid-core-scenarios.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {NativeWorldPool} from '../dist/core/native-world.js';
import {loadLabScene} from '../../../src/lab/scene-host.ts';

const K = {...index, ...gameplay, ...sceneModule};
const {RIGID_CORE_EXAMPLE_SCENES, EXAMPLE_SCENES, SCENE_VERSION, SCENE_VERSIONS, validateScene, normalizeScene, canonicalize, sceneHash, encodeSceneLink, decodeSceneLink, loadScene, saveScene, sceneWorldOptions} = sceneModule;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const copy = value => JSON.parse(JSON.stringify(value));
// Paths at which two JSON values differ; numbers are compared to float32 precision.
const differences = (a, b, path = '', out = []) => {
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 2e-6 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ${a} != ${b}`); }
  else if (a && b && typeof a === 'object' && typeof b === 'object') for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${path}/${key}`, out);
  else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
};

test('the five examples validate, keep the lowest scene version that holds them, travel in share links and load', async () => {
  assert.deepEqual(Object.keys(RIGID_CORE_EXAMPLE_SCENES), ['obstacle-course', 'vehicle-terrain', 'laser-scanner', 'bullet-plates', 'breakable-bridge']);
  assert.deepEqual(Object.keys(EXAMPLE_SCENES), ['pendulum-wave', 'newtons-cradle', 'domino-run', 'terrain-car', 'ragdoll'], 'the older list is what it was');
  assert.deepEqual([SCENE_VERSION, [...SCENE_VERSIONS]], [3, [1, 2, 3]]);
  // Steering on wheel joints and joint thresholds are version 3; the other three scenes use nothing newer than version 1.
  const versions = {'obstacle-course': 1, 'vehicle-terrain': 3, 'laser-scanner': 1, 'bullet-plates': 1, 'breakable-bridge': 3};
  for (const [name, make] of Object.entries(RIGID_CORE_EXAMPLE_SCENES)) {
    const scene = make(), text = canonicalize(scene);
    assert.deepEqual(validateScene(scene), [], name);
    assert.equal(normalizeScene(scene).version, versions[name], `${name}: version`);
    assert.equal(canonicalize(JSON.parse(text)), text, `${name}: canonicalising twice changes nothing`);
    assert.equal(canonicalize(make()), text, `${name}: built the same every time`);
    assert.ok(scene.meta.title.length > 0 && scene.meta.description.length > 0, `${name} has a title and a description`);
    const back = decodeSceneLink(await encodeSceneLink(scene));
    assert.equal(sceneHash(back), sceneHash(scene), `${name}: the share link holds the same scene`);
    const world = await K.createWorld(sceneWorldOptions(normalizeScene(scene)));
    try {
      const loaded = loadScene(world, back);
      assert.equal(loaded.bodies.size, scene.bodies.length, name); assert.equal(loaded.joints.size, scene.joints.length, name);
      // Saved at once, it is the same scene, roles (userData), thresholds, steering and all, with the numbers as the engine holds them (float32).
      const saved = copy(saveScene(world, loaded));
      assert.deepEqual(validateScene(saved), [], `${name}: the saved scene validates`);
      assert.equal(normalizeScene(saved).version, versions[name], `${name}: saved version`);
      assert.deepEqual(differences(JSON.parse(canonicalize(saved)), JSON.parse(text)), [], `${name}: saved before a step, it is the scene that was loaded`);
      assert.equal(gameplay.sceneHasRoles(scene), name !== 'bullet-plates' && name !== 'breakable-bridge', `${name}: roles`);
    } finally { world.dispose(); }
  }
  // A version 3 setting in a scene that declares an older version is refused with the reason.
  const old = {...RIGID_CORE_EXAMPLE_SCENES['breakable-bridge'](), version: 2};
  assert.match(validateScene(old).map(p => `${p.path}: ${p.message}`).join('\n'), /\/joints\/0\/thresholds: thresholds needs scene version 3; this scene declares version 2/);
});

test('scene roles: unusable settings are refused by name before anything is attached, and a scene without roles is left alone', async () => {
  const open = async scene => { const world = await K.createWorld(sceneWorldOptions(normalizeScene(scene))); return {world, loaded: loadScene(world, scene)}; };
  const refuse = async (edit, pattern) => {
    const scene = copy(RIGID_CORE_EXAMPLE_SCENES[edit.name]()); edit.change(scene);
    const {world, loaded} = await open(scene);
    try { assert.throws(() => gameplay.attachSceneRoles(loaded), error => error.code === 'INVALID_PAYLOAD' && pattern.test(error.message), `${pattern}`); assert.equal(loaded.simulation.order().some(row => row.kind === 'scene-roles'), false, 'nothing was registered'); } finally { world.dispose(); }
  };
  await refuse({name: 'obstacle-course', change: s => { s.bodies.find(b => b.id === 'hero').type = 'dynamic'; }}, /body 'hero' userData: a character body must be kinematic/);
  await refuse({name: 'obstacle-course', change: s => { s.bodies.find(b => b.id === 'hero').userData.route = [[1]]; }}, /route\[0\] must be \[x, z\]/);
  await refuse({name: 'obstacle-course', change: s => { s.bodies.find(b => b.id === 'platform').userData.axis = [0, 0, 0]; }}, /body 'platform' userData\.axis must not be zero/);
  await refuse({name: 'vehicle-terrain', change: s => { for (const joint of s.joints.slice(1)) delete joint.userData; }}, /a vehicle needs at least two joints/);
  await refuse({name: 'vehicle-terrain', change: s => { s.joints[0].userData.radius = -1; }}, /joint 'axle-front-left' userData\.radius must be a number/);
  await refuse({name: 'laser-scanner', change: s => { s.bodies[0].userData.rays = 2.5; }}, /rays must be a whole number/);
  const {world, loaded} = await open(RIGID_CORE_EXAMPLE_SCENES['bullet-plates']());
  try {
    const roles = gameplay.attachSceneRoles(loaded);
    assert.equal(roles.active, false); assert.equal(roles.character, null); assert.equal(roles.vehicle, null); assert.deepEqual(roles.beams(), []);
    assert.equal(loaded.simulation.order().some(row => row.kind === 'scene-roles'), false);
  } finally { world.dispose(); }
});

test('obstacle course: the character walks its route up the stairs, down the ramp, pushes the crate, rides the platform, is stopped by the steep slope, jumps, and comes round', async t => {
  const r = await S.exampleCourse(K), again = await S.exampleCourse(K);
  t.diagnostic(`lap in ${r.lapSeconds} s; feet on the deck ${r.deckFeet} m, on the ledge ${r.ledgeFeet} m; crate pushed ${r.cratePushed} m; ${r.rodePlatformSeconds} s on the platform; furthest x ${r.furthest} m; apex ${r.apex} m (v^2 / 2g = ${r.exactApex})`);
  assert.ok(r.lapSeconds !== null && r.lapSeconds < 30, `one lap of the route in under 30 s, got ${r.lapSeconds}`);
  near(r.deckFeet, 0.8, 1e-3, 'four stairs of 0.2 m: feet on the deck'); assert.ok(r.deckFeetSpread < 1e-4, 'steady on the deck');
  near(r.ledgeFeet, 0.3, 1e-3, 'feet on the ledge');
  assert.ok(r.stepped >= 5, `four stairs and the ledge are stepped onto, got ${r.stepped} steps`);
  assert.ok(r.cratePushed > 1.5 && r.cratePushed < 2.2, `the crate is pushed along from 11.6 m to where the walker turns aside at 12.6 m, got ${r.cratePushed}`);
  assert.ok(r.rodePlatformSeconds > 1.2, `the platform (4 m at 2.5 m/s) is ridden, got ${r.rodePlatformSeconds} s`); assert.ok(r.platformFeetError < 1e-3, 'feet on the platform deck while it moves');
  assert.ok(r.furthest < r.slopeFoot, `the 60 degree slope is not climbed: the capsule's centre stays before its foot, got x = ${r.furthest}`);
  assert.ok(r.furthest > r.slopeFoot - 0.3, 'and the walker did reach it');
  within(r.apex, r.exactApex, 1e-3, 'the jump on the way back: apex v^2 / (2 g)');
  assert.equal(again.hash, r.hash, 'the lap is the same every time'); assert.equal(again.lapSeconds, r.lapSeconds);
});

test('vehicle on terrain: static sag m g / (4 k), a cruise at the set speed on the Ackermann circle, and the pedals', async t => {
  const r = await S.exampleVehicle(K);
  t.diagnostic(`sag ${r.sag} m (m g / 4k = ${r.exactSag}); cruise ${r.cruise} m/s (set ${r.cruiseSetting}); circle radius ${r.radius} m (L / tan delta = ${r.exactRadius}); least up ${r.minUp}; full throttle 3 s: ${r.driven} m/s; reverse: ${r.reversed} m/s`);
  within(r.sag, r.exactSag, 5e-3, 'static sag of a scene-file car on suspensionJointSpring'); assert.ok(r.restSpeed < 1e-3, 'at rest on the brake');
  // The autopilot lets the throttle go above 6 m/s and the car rolls on over bumps of +-0.2 m: it holds the speed from above.
  assert.ok(r.cruise > r.cruiseSetting && r.cruise < r.cruiseSetting + 0.5 && r.fastest < r.cruiseSetting + 1, `cruise at ${r.cruiseSetting} m/s, got mean ${r.cruise}, fastest ${r.fastest}`);
  within(r.radius, r.exactRadius, 0.05, 'mean speed over mean yaw rate on the terrain against the Ackermann radius');
  assert.ok(r.minUp > 0.97, `upright all the way, got ${r.minUp}`); assert.ok(r.far < 2 * r.exactRadius + 3, `stays on its circle, got ${r.far} m from the start`);
  assert.ok(r.stopped < 0.01, 'the brake stops it'); assert.ok(r.driven > 6, 'full throttle for 3 s'); assert.ok(r.reversed < -3, 'and reverse');
});

test('laser scanner: 96 rays in one call per step end on the spheres, on the ground at h / sin(pitch), or at the end of their range', async t => {
  const r = await S.exampleLaser(K);
  t.diagnostic(`${r.hits} of ${r.rays} rays hit: ${JSON.stringify(r.counts)}; sphere error ${r.sphereError} m; ground reach error ${r.groundRangeError} m of ${r.groundReach}`);
  assert.equal(r.rays, 96); assert.equal(r.hits + r.misses, 96); assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.hits);
  for (const id of ['ball', 'dome', 'slab', 'block', 'ground']) assert.ok(r.counts[id] > 0, `${id} is hit`);
  assert.ok(r.sphereError < 1e-4, `hit points on the two static spheres lie on them, worst ${r.sphereError} m`);
  assert.equal(r.groundError, 0, 'ground hits at y = 0'); assert.ok(r.groundRangeError < 1e-5, `pitched rays reach the ground h / sin(p) away, worst ${r.groundRangeError}`);
  assert.ok(r.rangeError < 1e-5, 'a ray that hits nothing is drawn to the end of its range');
});

test('bullets and plates at 60 Hz: an ordinary ball passes five free plates, a bullet stops at the first, a static wall stops an ordinary ball', async t => {
  const r = await S.exampleBullets(K);
  t.diagnostic(`after 12 steps: plain ${r.plainEnd} m, bullet ${r.bulletEnd} m, static ${r.staticEnd} m; momentum ${r.momentumBefore} -> ${r.momentumAfter} N s`);
  // 2.5 m per step: 0.3, 2.8, 5.3, 7.8, 10.3; the plates stand at 6.1 to 10.1.
  near(r.plainAtStep4, 10.3, 1e-4, 'the plain ball is past the last free plate after four steps, at full speed'); assert.equal(r.plainPlatesMoved, 0, 'and no plate noticed');
  assert.ok(r.plainEnd > 15.4 && r.plainEnd < r.backstopFace, `the static backstop does stop it, got ${r.plainEnd}`);
  assert.ok(r.bulletEnd > r.plateX && r.bulletEnd < r.plateX + 1.1, `the bullet stays with the first plate, got ${r.bulletEnd}`);
  assert.ok(r.staticEnd < r.plateX && r.staticEnd > r.plateX - 0.2, `the thin static wall stops an ordinary ball, got ${r.staticEnd}`);
  // The plate stands on the ground with friction, which takes about 1% in the step of the impact.
  within(r.momentumAfter, r.momentumBefore, 0.02, 'momentum of ball and plate through the bullet impact');
  assert.ok(r.momentumAfter <= r.momentumBefore, 'none is gained');
});

test('breakable bridge at rest: support shear w L / 2 and moments of a built-in beam of 8 links, w l^2 (n^2 - 1) / 12 at the supports', async t => {
  const r = await S.exampleBridgeAtRest(K);
  t.diagnostic(`shear ${r.shear} N (${r.exactShear}); support moment ${r.supportMoment} N m (${r.exactSupportMoment}; continuous beam ${r.continuousSupportMoment}); mid-span ${r.midMoment} N m (${r.exactMidMoment})`);
  within(r.shear, r.exactShear, 1e-4, 'support shear'); within(r.supportMoment, r.exactSupportMoment, 1e-3, 'support moment'); within(r.farSupportMoment, r.supportMoment, 1e-5, 'both supports alike');
  within(r.midMoment, r.exactMidMoment, 1e-3, 'mid-span moment'); assert.ok(r.midShear < 1, 'no shear at mid-span');
  assert.equal(r.alive, 9, 'it carries itself'); assert.equal(r.events, 0, 'and no weld is near its threshold');
  // The thresholds are six times the shear and three times the support moment.
  assert.equal(r.thresholds.forceThreshold, Math.round(6 * r.exactShear)); assert.equal(r.thresholds.torqueThreshold, Math.round(3 * r.exactSupportMoment)); assert.equal(r.thresholds.breakable, true);
});

test('breakable bridge: intact until the block lands, then the welds that were overloaded break and report what they carried', async t => {
  const r = await S.exampleBridgeBreak(K), again = await S.exampleBridgeBreak(K);
  t.diagnostic(`first break at ${r.firstBreakSeconds} s (free fall ${r.landing} s); broke ${r.breaks.map(b => b.id).join(' ')}; left ${r.aliveAfter.join(' ')}; weakest break at ${r.weakestBreak} of its threshold`);
  assert.equal(r.aliveBefore, 9); assert.equal(r.breaksBefore, 0, 'nothing breaks before the block arrives');
  near(r.firstBreakSeconds, r.landing, 2 / 240 + 1e-9, 'the first weld breaks in the step the block lands (free fall sqrt(2 h / g))');
  assert.equal(r.breaks.length + r.aliveAfter.length, 9); assert.ok(r.breaks.length >= 5, `the span breaks up, got ${r.breaks.length} breaks`);
  assert.ok(r.weakestBreak >= 1, `every weld that broke was at or over a threshold, weakest at ${r.weakestBreak}`);
  assert.deepEqual(new Set(r.breaks.map(b => b.id)).size, r.breaks.length, 'each weld breaks once');
  assert.ok(r.blockSpeed < 0.05 && r.blockY < 0.6, `the block ends on the wreck, at rest: y ${r.blockY}, speed ${r.blockSpeed}`); assert.ok(r.midPlankY < 0.3, 'the middle plank is on the ground');
  assert.deepEqual(r.savedJoints, r.aliveAfter, 'a scene saved after the break holds the welds that are left');
  assert.equal(again.hash, r.hash, 'the same wreck every time'); assert.deepEqual(again.breaks, r.breaks);
});

test('checkpoints: a played example resumes bit for bit from simulation.checkpoint(), roles included', async t => {
  // Mid-push on the course, mid-circle in the car, with the scanner turning, with the bullet in a plate, across the break of the bridge.
  for (const [name, first, then] of [['obstacle-course', 5, 4], ['vehicle-terrain', 5, 5], ['laser-scanner', 1, 1], ['bullet-plates', 0.05, 0.2], ['breakable-bridge', 0.5, 1]]) {
    const r = await S.exampleCheckpoint(K, name, first, then);
    t.diagnostic(`${name}: ${r.bytes} bytes at ${first} s; after ${then} s more ${r.hashA} and ${r.hashB}`);
    assert.ok(r.moved, `${name}: the run went on`); assert.ok(r.restoredSame, `${name}: restored state`);
    assert.equal(r.hashB, r.hashA, `${name}: resumed run`); assert.ok(r.rolesSame, `${name}: the roles' state`);
  }
});

test('the Physics Lab plays the examples as the kit does: equal exactHash and replayHash at 0, 1, 240 and 1,200 steps', async t => {
  const wasm = name => fileURLToPath(new URL(`../wasm/${name}`, import.meta.url));
  const {default: factory} = await import(wasm('box3d.js'));
  // The Lab's worlds come from a pool on the module the page loaded; here it is a second instance of the same artifact.
  const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(wasm('box3d.wasm'))}));
  const MARKS = [0, 1, 240, 1200];
  for (const [name, make] of Object.entries(RIGID_CORE_EXAMPLE_SCENES)) {
    const viaKit = await S.openExample(K, make()), native = pool.createWorld();
    try {
      native.retainBodyShapes(true);
      const lab = loadLabScene(native, make()), host = lab.builder.world;
      gameplay.attachSceneRoles(lab);
      for (const mark of MARKS) {
        while (viaKit.world.tick < mark) viaKit.simulation.step();
        while (host.tick < mark) lab.simulation.step();
        assert.deepEqual([host.exactHash(), host.replayHash()], [viaKit.world.exactHash(), viaKit.world.replayHash()], `${name} at step ${mark}`);
      }
      t.diagnostic(`${name}: exactHash ${host.exactHash()} at step 1,200 on both`);
    } finally { viaKit.world.dispose(); native.destroy(); }
  }
});
