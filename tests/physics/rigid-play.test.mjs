// Playing a scene in the Physics Lab (src/lab/rigid-play.ts over src/engine/scene-roles.ts): the rigid-core examples
// open from the address and the examples list, their roles are attached to the Lab's scene host, the keys drive the
// character and the car and are left alone otherwise, a scanner's beams become overlay lines, and a checkpoint of
// the Simulation resumes a played scene bit for bit. Runs on the real engine artifact; nothing here needs a browser.
// The comparison with the kit's own world is packages/box3d-kit/test/v22-rigid-examples.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {RIGID_CORE_EXAMPLE_SCENES, validateScene} from '../../src/engine/scene-format.ts';
import {SceneRoles, sceneHasRoles} from '../../src/engine/scene-roles.ts';
import {loadLabScene} from '../../src/lab/scene-host.ts';
import {LAB_EXAMPLE_NAMES, LAB_EXAMPLE_TITLES, RIGID_CORE_EXAMPLE_NAMES, RIGID_CORE_EXAMPLE_TITLES, parseSceneRequest, resolveSceneRequest, sceneCameraFrame} from '../../src/lab/scene-loading.ts';
import {IDLE_SECONDS, PLAY_KEYS, RigidPlay} from '../../src/lab/rigid-play.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
/** A Lab world with an example loaded and played, as src/main.ts sets it up. */
const open = (name, run) => {
  const native = pool.createWorld();
  try {
    native.retainBodyShapes(true);
    const loaded = loadLabScene(native, RIGID_CORE_EXAMPLE_SCENES[name]()), play = new RigidPlay(loaded);
    const steps = seconds => { const n = Math.round(seconds / loaded.builder.world.loop.step); for (let i = 0; i < n; i++) loaded.simulation.step(); };
    return run({native, loaded, play, host: loaded.builder.world, steps});
  } finally { native.destroy(); }
};

test('the Lab lists the rigid-core examples, opens them from the address, and frames them', () => {
  assert.deepEqual(RIGID_CORE_EXAMPLE_NAMES, ['obstacle-course', 'vehicle-terrain', 'laser-scanner', 'bullet-plates', 'breakable-bridge']);
  assert.deepEqual(Object.keys(RIGID_CORE_EXAMPLE_TITLES), RIGID_CORE_EXAMPLE_NAMES, 'every example has a title');
  for (const name of RIGID_CORE_EXAMPLE_NAMES) {
    assert.ok(LAB_EXAMPLE_NAMES.includes(name)); assert.equal(LAB_EXAMPLE_TITLES[name], RIGID_CORE_EXAMPLE_TITLES[name]);
    assert.deepEqual(parseSceneRequest(`?example=${name}`), {kind: 'example', name});
    const read = resolveSceneRequest({kind: 'example', name});
    assert.equal(read.ok, true, name); assert.deepEqual(validateScene(read.scene), []); assert.equal(read.title, RIGID_CORE_EXAMPLE_TITLES[name]);
    const frame = sceneCameraFrame(read.scene);
    assert.ok(frame.target.every(Number.isFinite) && frame.distance > 1 && frame.distance < 400, `${name}: a usable camera frame`);
  }
  assert.deepEqual(RIGID_CORE_EXAMPLE_NAMES.filter(name => sceneHasRoles(RIGID_CORE_EXAMPLE_SCENES[name]())), ['obstacle-course', 'vehicle-terrain', 'laser-scanner']);
});

test('which scenes take the keys: a character and a car do, a scanner is only watched, and a scene without roles has nothing to play', () => {
  open('obstacle-course', ({play}) => { assert.equal(play.kind, 'character'); assert.equal(play.takesKeys, true); assert.ok(play.roles instanceof SceneRoles); assert.ok(play.follow().every(Number.isFinite)); });
  open('vehicle-terrain', ({play}) => { assert.equal(play.kind, 'vehicle'); assert.equal(play.takesKeys, true); });
  open('laser-scanner', ({play}) => {
    assert.equal(play.kind, 'watch'); assert.equal(play.takesKeys, false); assert.equal(play.follow(), null);
    for (const code of Object.keys(PLAY_KEYS)) assert.equal(play.keyDown(code), false, `${code} stays the Lab's`);
  });
  for (const name of ['bullet-plates', 'breakable-bridge']) open(name, ({play, loaded}) => {
    assert.equal(play.roles.active, false, name); assert.equal(play.takesKeys, false);
    assert.equal(loaded.simulation.order().some(row => row.kind === 'scene-roles'), false, 'no subsystem for a scene without roles');
  });
  assert.deepEqual(Object.keys(PLAY_KEYS).sort(), ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyS', 'KeyW', 'Space']);
});

test('character keys: walking is relative to the camera, Space jumps, other keys are not taken, and the route resumes after the idle time', () => {
  open('obstacle-course', ({play, steps}) => {
    // Left alone it walks its route: along +x at 2.5 m/s.
    steps(1);
    assert.equal(play.manual, false); assert.ok(Math.abs(play.roles.state.character.position[0] - 2.5) < 0.05, 'the route');
    assert.equal(play.keyDown('KeyE'), false, 'a key that is not a play key'); assert.equal(play.keyDown('KeyP'), false);
    // The camera at yaw = pi/2 stands on the +z side and looks along -z: forward is -z, right is +x.
    play.cameraYaw = Math.PI / 2;
    const at = () => play.roles.state.character.position, moved = (key, seconds = 0.5) => { const a = at(); assert.equal(play.keyDown(key), true); steps(seconds); assert.equal(play.keyUp(key), true); const b = at(); return [b[0] - a[0], b[2] - a[2]]; };
    const close = (d, expected, label) => assert.ok(Math.abs(d[0] - expected[0]) < 0.03 && Math.abs(d[1] - expected[1]) < 0.03, `${label}: moved ${d}, expected ${expected}`);
    close(moved('KeyW'), [0, -1.25], 'W walks away from the camera'); close(moved('ArrowDown'), [0, 1.25], 'down walks towards it');
    close(moved('KeyA'), [-1.25, 0], 'A walks to the left of the view'); close(moved('ArrowRight'), [1.25, 0], 'right to the right');
    // Another view: the camera behind the walker (on the -x side), so forward is +x.
    play.cameraYaw = Math.PI;
    close(moved('ArrowUp'), [1.25, 0], 'forward follows the camera');
    // Two keys: the diagonal at the same speed.
    play.keyDown('KeyW'); play.keyDown('KeyD');
    const a = at(); steps(0.5); const b = at();
    assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[2] - a[2]) - 1.25) < 0.03, 'a diagonal is not faster');
    play.releaseAll(); assert.deepEqual(play.state().held, []);
    // Space: a jump of v^2 / (2 g) = 1.274 m.
    assert.equal(play.manual, true, 'the player keeps control after letting go');
    const ground = play.roles.state.character.feet;
    play.keyDown('Space'); steps(1 / 240); play.keyUp('Space');
    let apex = 0; for (let i = 0; i < 240; i++) { steps(1 / 240); apex = Math.max(apex, play.roles.state.character.feet - ground); }
    assert.ok(Math.abs(apex - 25 / (2 * 9.81)) < 0.002, `jump apex, got ${apex}`);
    // Standing still while in control; then, IDLE_SECONDS after the last key, the route again.
    const still = at(); steps(1);
    assert.ok(Math.hypot(at()[0] - still[0], at()[2] - still[2]) < 1e-3, 'no key: it stands'); assert.equal(play.manual, true);
    steps(IDLE_SECONDS);
    assert.equal(play.manual, false, 'left alone again'); assert.ok(Math.hypot(at()[0] - still[0], at()[2] - still[2]) > 1, 'it walks its route');
  });
});

test('car keys: throttle, reverse, steering to both sides and the brake', () => {
  open('vehicle-terrain', ({play, steps}) => {
    const v = () => play.roles.state.vehicle;
    play.keyDown('KeyW'); steps(3);
    assert.ok(v().forwardSpeed > 6, `W is the throttle, got ${v().forwardSpeed} m/s`); assert.ok(Math.abs(v().yawRate) < 0.1, 'straight on');
    play.keyDown('ArrowLeft'); steps(1.5); assert.ok(v().yawRate > 0.2, `left turns left, yaw rate ${v().yawRate}`);
    play.keyUp('ArrowLeft'); play.keyDown('KeyD'); steps(1.5); assert.ok(v().yawRate < -0.2, `D turns right, yaw rate ${v().yawRate}`);
    play.keyUp('KeyD'); play.keyUp('KeyW'); play.keyDown('Space'); steps(3);
    assert.ok(v().speed < 0.05, `Space brakes to a stop, got ${v().speed} m/s`);
    play.keyUp('Space'); play.keyDown('ArrowDown'); steps(2);
    assert.ok(v().forwardSpeed < -2, `down reverses, got ${v().forwardSpeed} m/s`);
    // Let go: it rolls on backwards for the idle time, then the autopilot takes it back to its 6 m/s circle.
    play.releaseAll(); steps(IDLE_SECONDS + 8);
    assert.equal(play.manual, false); assert.ok(v().forwardSpeed > 4 && v().yawRate > 0.2, `left alone it drives its circle again, got ${v().forwardSpeed} m/s, yaw rate ${v().yawRate}`);
  });
});

test('scanner beams become overlay lines: one per ray, bright to a hit, and new only when the scene has stepped', () => {
  open('laser-scanner', ({play, steps}) => {
    assert.deepEqual(play.beamLines(), [], 'no beams before the first step');
    steps(0.5);
    const lines = play.beamLines(), version = play.version;
    assert.equal(lines.length, 96); assert.equal(play.beamLines(), lines, 'the same array while nothing stepped'); assert.equal(play.version, version);
    const hits = lines.filter(line => line.r > 0.5).length;
    assert.equal(hits, play.roles.state.lasers[0].hits); assert.ok(hits > 30 && hits < 96);
    for (const line of lines) {
      assert.deepEqual([line.ax, line.ay, line.az], [0, 1.25, 0], 'every beam starts at the emitter');
      assert.ok([line.bx, line.by, line.bz, line.r, line.g, line.b, line.a].every(Number.isFinite));
      assert.ok(Math.hypot(line.bx, line.by - 1.25, line.bz) <= 16 + 1e-4, 'no beam is longer than its range');
    }
    const first = [lines[0].bx, lines[0].bz];
    steps(0.5);
    const next = play.beamLines();
    assert.notEqual(play.version, version); assert.equal(next.length, 96);
    assert.ok(Math.hypot(next[0].bx - first[0], next[0].bz - first[1]) > 0.5, 'the fan turns');
  });
});

test('a Lab checkpoint of a played scene resumes bit for bit, and is refused by a scene loaded without its roles', () => {
  for (const [name, first, then] of [['obstacle-course', 5.5, 3], ['vehicle-terrain', 4, 3]]) {
    const bytes = open(name, ({loaded, host, steps}) => { steps(first); const saved = loaded.simulation.checkpoint(); steps(then); return {saved, hash: host.exactHash(), replay: host.replayHash()}; });
    open(name, ({loaded, host, play, steps}) => {
      loaded.simulation.restore(bytes.saved);
      assert.ok(Math.abs(play.roles.time - first) < 1e-9, 'the roles are at the time of the checkpoint');
      steps(then);
      assert.equal(host.exactHash(), bytes.hash, `${name}: exactHash`); assert.equal(host.replayHash(), bytes.replay, `${name}: replayHash`);
    });
    // Without the roles the simulation is another one: the plan check says so and nothing is changed.
    const native = pool.createWorld();
    try {
      const loaded = loadLabScene(native, RIGID_CORE_EXAMPLE_SCENES[name]());
      assert.throws(() => loaded.simulation.restore(bytes.saved), error => error.code === 'CHECKPOINT_MISMATCH' && /roles \(scene-roles, pre-couple/.test(error.message));
    } finally { native.destroy(); }
  }
});
