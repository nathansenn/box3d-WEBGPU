// Scene files, share links and the example scenes (box3d-webgpu-kit/scene).
// Set-ups are those of packages/box3d-kit/test/v12-scene.test.mjs.
import {kit, memo, defineCases, relative, absolute} from '../lib.mjs';
import {sceneCompound} from './compound.mjs';

const G = 9.81;
const FILE = 'packages/box3d-kit/test/v12-scene.test.mjs';
const T = {
  euler: 'rotationEuler is degrees about X, Y, Z (q = qx qy qz) and is normalised to a quaternion',
  links: 'share links: every scene survives the compressed and the stored path to identical canonical text',
  determinism: 'determinism: a scene gives the same exactHash every time it is loaded, also from a share link',
  resume: 'save and resume: state at the moment of load matches to float32, then drifts within a stated bound',
  wave: 'the pendulum-wave scene: every period is 2 pi sqrt(I / (m g L)) within 0.1%, and the wave realigns',
  cradle: "the Newton's-cradle scene passes the impulse through and conserves momentum",
};
const copy = value => JSON.parse(JSON.stringify(value));
const modules = () => memo('scene/modules', async () => ({...(await kit('scene')), createWorld: (await kit('index')).createWorld}));
const open = async scene => { const m = await modules(), world = await m.createWorld(m.sceneWorldOptions(scene)); return {world, ...m.loadScene(world, scene)}; };

const euler = () => memo('scene/euler', async () => {
  const {eulerToQuaternion} = await modules(), s = Math.SQRT1_2;
  let worst = 0;
  for (const [angles, expected] of [[[90, 0, 0], [s, 0, 0, s]], [[0, 90, 0], [0, s, 0, s]], [[0, 0, 90], [0, 0, s, s]]]) {
    eulerToQuaternion(angles).forEach((v, i) => { worst = Math.max(worst, Math.abs(v - expected[i])); });
  }
  return worst;
});

const links = () => memo('scene/links', async () => {
  const {EXAMPLE_SCENES, canonicalize, encodeSceneLink, encodeSceneLinkSync, decodeSceneLink} = await modules();
  let scenes = 0, mismatches = 0;
  for (const make of Object.values(EXAMPLE_SCENES)) {
    const scene = make(), text = canonicalize(scene);
    scenes++;
    for (const one of [await encodeSceneLink(scene), encodeSceneLinkSync(scene)]) if (canonicalize(decodeSceneLink(one)) !== text) mismatches++;
  }
  return {scenes, mismatches};
});

const determinism = () => memo('scene/determinism', async () => {
  const {EXAMPLE_SCENES, loadScene, encodeSceneLink, decodeSceneLink} = await modules();
  let mismatches = 0, runs = 0;
  for (const make of Object.values(EXAMPLE_SCENES)) {
    const scene = make(), first = await open(scene), second = await open(decodeSceneLink(await encodeSceneLink(scene)));
    try {
      const run = world => { for (let i = 0; i < 150; i++) world.step(); return world.exactHash(); };
      const hash = run(first.world);
      loadScene(first.world, copy(scene));
      for (const again of [run(first.world), run(second.world)]) { runs++; if (again !== hash) mismatches++; }
    } finally { first.world.dispose(); second.world.dispose(); }
  }
  return {mismatches, runs};
});

const resume = name => memo(`scene/resume/${name}`, async () => {
  const {EXAMPLE_SCENES, saveScene, encodeSceneLink, decodeSceneLink} = await modules();
  const original = await open(EXAMPLE_SCENES[name]());
  for (let i = 0; i < 100; i++) original.world.step();
  const saved = copy(saveScene(original.world, original));
  const resumed = await open(decodeSceneLink(await encodeSceneLink(saved)));
  try {
    let atLoad = 0;
    for (const [id, body] of original.bodies) {
      const a = original.world.getState(body), b = resumed.world.getState(resumed.bodies.get(id));
      atLoad = Math.max(atLoad, ...a.position.map((v, i) => Math.abs(v - b.position[i])), ...a.linearVelocity.map((v, i) => Math.abs(v - b.linearVelocity[i])));
    }
    for (let i = 0; i < 100; i++) { original.world.step(); resumed.world.step(); }
    let drift = 0;
    for (const [id, body] of original.bodies) {
      const a = original.world.getState(body), b = resumed.world.getState(resumed.bodies.get(id));
      drift = Math.max(drift, Math.hypot(...a.position.map((v, i) => v - b.position[i])));
    }
    return {atLoad, drift};
  } finally { original.world.dispose(); resumed.world.dispose(); }
});

const wave = () => memo('scene/wave', async () => {
  const {pendulumWaveScene, encodeSceneLinkSync, decodeSceneLink} = await modules();
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
    let worst = 0, first = null;
    scene.bodies.forEach(body => {
      const times = crossings.get(body.id), period = (times.at(-1) - times[0]) / (times.length - 1), {length, angle} = body.userData;
      const exact = 2 * Math.PI * Math.sqrt((length * length + 0.4 * radius * radius) / (G * length)) * (1 + angle * angle / 16);
      worst = Math.max(worst, Math.abs(period / exact - 1));
      first ??= {period, exact};
    });
    return {worst, first, count: scene.bodies.length};
  } finally { world.dispose(); }
});

const cradle = () => memo('scene/cradle', async () => {
  const {newtonsCradleScene} = await modules();
  const scene = copy(newtonsCradleScene()), {world, bodies} = await open(scene);
  try {
    const hz = Math.round(1 / scene.world.step), ids = [...bodies.keys()], last = ids.at(-1);
    const state = id => world.getState(bodies.get(id)), vx = id => state(id).linearVelocity[0];
    const momentum = () => ids.reduce((sum, id) => sum + state(id).mass * vx(id), 0);
    const {length} = scene.bodies[0].userData, radius = scene.bodies[0].shape.radius;
    const pivot = scene.joints[0].frameA.position, start = scene.bodies[0].position, angle = Math.atan2(pivot[0] - start[0], pivot[1] - start[1]);
    let incoming = 0, before = 0, outgoing = 0, after = 0, struck = -1, left = -1;
    for (let i = 1; i <= hz; i++) {
      const pre = momentum(), speed = vx(ids[0]);
      world.step();
      if (struck < 0 && vx(ids[1]) > 0.01) { struck = i; incoming = speed; before = pre; }
      if (struck >= 0 && left < 0 && vx(last) > 0.01) { left = i; outgoing = vx(last); after = momentum(); }
    }
    return {incoming, outgoing, before, after, arrival: Math.sqrt(2 * G * length * (1 - Math.cos(angle)) / (1 + 0.4 * radius * radius / (length * length)))};
  } finally { world.dispose(); }
});

// The bounds of the test (RESUME_BOUND): 100 ticks after a save at tick 100.
const RESUME = [
  ['pendulum-wave', 1e-5, 'joints only, smooth motion'],
  ['newtons-cradle', 1e-5, 'joints only, smooth motion'],
  ['terrain-car', 5e-3, 'rolling contact and suspension springs'],
  ['domino-run', 5e-2, 'dominoes mid-fall, where a cold contact changes when each one lands'],
  ['ragdoll', 0.4, 'saved as it starts to topple and compared as its head strikes the ground at 7 m/s'],
];

const cases = defineCases('scene', FILE, [
  {id: 'scene.euler-quaternion', title: 'Euler angles to quaternion', quantity: 'largest component error of the quaternions for 90 degrees about X, Y and Z', unit: '1', test: T.euler,
    reference: {formula: 'q = (sin 45, 0, 0, cos 45) and its permutations', value: 0}, tolerance: absolute(1e-12), measure: euler},
  {id: 'scene.share-link.round-trip', title: 'Share links: round trip', quantity: 'example scenes whose canonical text changes through a compressed or a stored link (of 5 scenes x 2 paths)', unit: 'links', test: T.links,
    reference: {formula: 'decode(encode(scene)) = scene', value: 0}, tolerance: absolute(0), measure: async () => (await links()).mismatches},
  {id: 'scene.determinism', title: 'Scene load is deterministic', quantity: 'runs of 150 ticks whose exactHash differs after a reload or a load from a share link (of 5 scenes x 2 reloads)', unit: 'runs', test: T.determinism,
    reference: {formula: 'hash(run 2) = hash(run 1)', value: 0}, tolerance: absolute(0), measure: async () => (await determinism()).mismatches},
  {id: 'scene.resume.state-at-load', title: 'Save and resume: state at the moment of load', quantity: 'largest position or velocity component difference right after loading a saved pendulum-wave scene', unit: 'm, m/s', test: T.resume,
    reference: {formula: 'x_loaded = x_saved (bit for bit)', value: 0}, tolerance: absolute(0), note: 'A float32 is written as the shortest decimal that reads back to it.',
    measure: async () => (await resume('pendulum-wave')).atLoad},
  ...RESUME.map(([name, bound, why]) => (
    {id: `scene.resume.drift.${name}`, title: `Save and resume: drift of the ${name} scene`, quantity: 'largest position difference between the original and the resumed run 100 ticks after the save', unit: 'm', test: T.resume,
      reference: {formula: '|x_resumed - x_original| = 0', value: 0}, tolerance: absolute(bound),
      note: `A save does not carry the solver's warm-start impulses or sleep state, so a resumed run is not a bit-exact continuation: ${why}.`,
      measure: async () => (await resume(name)).drift})),
  {id: 'scene.pendulum-wave.period', title: 'Pendulum-wave scene: first pendulum', quantity: 'period of the longest pendulum, mean over 20 s, loaded from a share link', unit: 's', test: T.wave,
    reference: {formula: 'T = 2 pi sqrt((L^2 + 2 r^2 / 5) / (g L)) (1 + theta0^2 / 16)', value: null}, tolerance: relative(1e-3),
    measure: async () => { const r = await wave(); return {value: r.first.period, reference: r.first.exact}; }},
  {id: 'scene.pendulum-wave.worst', title: 'Pendulum-wave scene: worst period error', quantity: 'largest relative period error over all pendulums of the scene', unit: '1', test: T.wave,
    reference: {formula: '|T / T_exact - 1| = 0', value: 0}, tolerance: absolute(1e-3), measure: async () => (await wave()).worst},
  {id: 'scene.cradle.arrival-speed', title: "Newton's cradle: arrival speed of the first ball", quantity: 'speed of the released ball in the step before it strikes', unit: 'm/s', test: T.cradle,
    reference: {formula: 'v = sqrt(2 g L (1 - cos(theta)) / (1 + 2 r^2 / (5 L^2)))', value: null}, tolerance: relative(5e-3),
    measure: async () => { const r = await cradle(); return {value: r.incoming, reference: r.arrival}; }},
  {id: 'scene.cradle.transfer', title: "Newton's cradle: the last ball leaves at the first ball's speed", quantity: 'speed of the last ball when it leaves the row', unit: 'm/s', test: T.cradle,
    reference: {formula: 'v_out = v_in', value: null}, tolerance: relative(0.02), note: 'The balls between hang on their hinges while the impulse crosses, so gravity and the hinges take a little out.',
    measure: async () => { const r = await cradle(); return {value: r.outgoing, reference: r.incoming}; }},
  {id: 'scene.cradle.momentum', title: "Newton's cradle: momentum along the row", quantity: 'total x momentum when the last ball leaves', unit: 'kg m/s', test: T.cradle,
    reference: {formula: 'p_after = p_before', value: null}, tolerance: relative(0.02),
    measure: async () => { const r = await cradle(); return {value: r.after, reference: r.before}; }},
]);

export default [...cases, ...sceneCompound];
