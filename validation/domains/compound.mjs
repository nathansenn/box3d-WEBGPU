// Compound bodies and explicit mass data: cases for the rigid, scene and robot domains.
// Set-ups are those of packages/box3d-kit/test/v17-compound.test.mjs: SI units, 240 Hz, 4 sub-steps.
// rigid.mjs, scene.mjs and robot.mjs append these lists to their own, so the report keeps one section per domain.
import {kit, memo, defineCases, relative, absolute, upper} from '../lib.mjs';

const G = 9.81, HZ = 240, SUB = 4;
const FILE = 'packages/box3d-kit/test/v17-compound.test.mjs';
const T = {
  mass: 'a compound body has the summed mass, centre of mass and parallel-axis inertia of its shapes',
  dumbbell: 'a dumbbell spins up at torque / (2 m d^2 + 2 (2/5) m r^2) and swings as a physical pendulum',
  tipping: 'an L-shaped compound tips when its centre of mass passes over the edge of its base, and rests when it does not',
  rest: 'a compound resting on the ground stays at rest and goes to sleep',
  explicit: 'explicit mass data: a body spins up at I^-1 torque, accelerates at F / m, and keeps the values across a type change',
  centre: 'an explicit centre of mass: a hinged sphere swings with the period its stated mass data imply, and setting them keeps the motion',
  replay: 'recordings with compound bodies and mass data replay bit for bit, and a worker-hosted world agrees with a local one',
  scene: 'scene format version 2: compound shapes and massData validate, canonicalise, travel in share links and load the same everywhere',
  resume: 'a save of a spinning body whose centre of mass is off its origin resumes with the same motion',
  robot: 'robot import: a link with several shapes is one compound body, and the file\'s inertial is what the solver holds',
  rod: 'robot import: a hinged rod whose file states 1.3 x its shape\'s inertia swings with the file\'s period',
  tee: 'robot import: a compound link moves as one rigid body where welded bodies flex',
};

async function world(extra = {}) {
  const {createWorld} = await kit('index');
  return createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ...extra});
}
const periodOf = samples => {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] > 0 && samples[i] <= 0) crossings.push((i - 1 + samples[i - 1] / (samples[i - 1] - samples[i])) / HZ);
  return (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
};
const sphereMass = r => 1000 * 4 / 3 * Math.PI * r ** 3;
const rotate = ([x, y, z, w], v) => {
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
};
const full = ([xx, yy, zz, xy, xz, yz]) => [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
const mulV = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
}
/** Eigenvalues of a symmetric tensor given as [xx, yy, zz, xy, xz, yz], ascending. */
function principal(six) {
  const a = full(six).map(row => [...row]);
  for (let sweep = 0; sweep < 60; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-300) continue;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.hypot(theta, 1)), c = 1 / Math.hypot(t, 1), s = t * c;
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y);
}

// The dumbbell: two spheres of radius R, their centres D either side of the body origin.
const R = 0.1, D = 0.4, M = sphereMass(R), ACROSS = 2 * (0.4 * M * R * R + M * D * D);
const dumbbell = () => ({kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: R}, position: [-D, 0, 0]}, {shape: {kind: 'sphere', radius: R}, position: [D, 0, 0]}]});
// The L: a slab with a tall post on its -x end.
const L_BASE = [0.5, 0.1, 0.3], L_POST = [0.1, 1.0, 0.3], L_POST_AT = [-0.4, 1.2, 0];
const lShape = () => ({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: L_BASE}, position: [0, 0.1, 0]}, {shape: {kind: 'box', halfExtents: L_POST}, position: L_POST_AT}]});
const L = (() => {
  const m1 = 1000 * 8 * L_BASE[0] * L_BASE[1] * L_BASE[2], m2 = 1000 * 8 * L_POST[0] * L_POST[1] * L_POST[2], m = m1 + m2;
  const c = [m2 * L_POST_AT[0] / m, (m1 * 0.1 + m2 * L_POST_AT[1]) / m], d1 = [-c[0], 0.1 - c[1]], d2 = [L_POST_AT[0] - c[0], L_POST_AT[1] - c[1]];
  return {mass: m, center: c, ixy: -(m1 * d1[0] * d1[1] + m2 * d2[0] * d2[1]), critical: Math.atan2(0.5 + c[0], c[1])};
})();

const massData = () => memo('compound/mass', async () => {
  const w = await world({ground: false});
  try {
    return {bar: w.getMassData(w.createBody({shape: dumbbell(), position: [0, 5, 0]})), bracket: w.getMassData(w.createBody({shape: lShape(), position: [3, 5, 0]}))};
  } finally { w.dispose(); }
});

const spinUp = () => memo('compound/spin', async () => {
  const w = await world({ground: false, gravity: [0, 0, 0]});
  try {
    const bar = w.createBody({shape: dumbbell(), position: [0, 5, 0], neverSleeps: true});
    for (let i = 0; i < 2 * HZ; i++) { w.applyTorque(bar, [0, 0, 3]); w.step(); }
    return w.getState(bar).angularVelocity[2];
  } finally { w.dispose(); }
});

const swing = () => memo('compound/pendulum', async () => {
  const w = await world({ground: false});
  try {
    const l1 = 0.5, l2 = 1.2, theta0 = 0.05, pivot = [0, 10, 0];
    const body = w.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: R}, position: [0, -l1, 0]}, {shape: {kind: 'sphere', radius: R}, position: [0, -l2, 0]}]},
      position: pivot, rotation: [0, 0, Math.sin(theta0 / 2), Math.cos(theta0 / 2)], neverSleeps: true});
    w.createJoint({type: 'revolute', bodyA: null, bodyB: body, frameA: {position: pivot}});
    const samples = [];
    for (let i = 0; i < HZ * 30; i++) { w.step(); const q = w.getState(body).rotation; samples.push(2 * Math.atan2(q[2], q[3])); }
    return {period: periodOf(samples), exact: 2 * Math.PI * Math.sqrt((2 * 0.4 * M * R * R + M * (l1 * l1 + l2 * l2)) / (M * G * (l1 + l2))) * (1 + theta0 * theta0 / 16)};
  } finally { w.dispose(); }
});

const tipping = () => memo('compound/tipping', async () => {
  const tilt = async angle => {
    const w = await world({gravity: [-G * Math.sin(angle), -G * Math.cos(angle), 0]});
    try {
      const body = w.createBody({shape: lShape(), position: [0, 0.0005, 0], friction: 2, neverSleeps: true});
      for (let i = 0; i < 8 * HZ; i++) w.step();
      const q = w.getState(body).rotation;
      return 2 * Math.atan2(q[2], q[3]);
    } finally { w.dispose(); }
  };
  let low = L.critical - 0.5 * Math.PI / 180, high = L.critical + 0.5 * Math.PI / 180;
  for (let i = 0; i < 6; i++) { const mid = (low + high) / 2; if (await tilt(mid) > 0.2) high = mid; else low = mid; }
  return (low + high) / 2 * 180 / Math.PI;
});

const rest = () => memo('compound/rest', async () => {
  const w = await world();
  try {
    const body = w.createBody({shape: lShape(), position: [0, 0.0005, 0]}), start = w.getState(body).position;
    let fastest = 0;
    for (let i = 0; i < HZ * 6; i++) { w.step(); if (i >= HZ) { const s = w.getState(body); fastest = Math.max(fastest, Math.hypot(...s.linearVelocity), Math.hypot(...s.angularVelocity)); } }
    return {moved: Math.hypot(...w.getState(body).position.map((v, i) => v - start[i])), fastest};
  } finally { w.dispose(); }
});

const SIX = [0.5, 0.8, 1.1, 0.1, -0.05, 0.2], TORQUE = [0.3, -0.2, 0.25];
const explicit = () => memo('compound/explicit', async () => {
  const w = await world({ground: false, gravity: [0, 0, 0]});
  try {
    const ball = w.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0, 5, 0], neverSleeps: true});
    w.setMassData(ball, {mass: 7, inertia: [2, 3, 5, 0, 0, 0]});
    const body = w.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [3, 9, 0], neverSleeps: true, massData: {mass: 3, inertia: SIX}});
    const cold = w.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [6, 9, 0], neverSleeps: true, massData: {mass: 3, inertia: SIX}});
    let early = 0;
    for (let i = 0; i < 2 * HZ; i++) {
      if (i < HZ) { w.applyForce(ball, [14, 0, 0]); w.applyTorque(ball, [0, 6, 0]); }
      if (i < 12) w.applyTorque(cold, [0.3, 0, 0]);
      if (i === 12) early = w.getState(cold).angularVelocity[1];
      // A torque fixed in the body, turned into the world each step.
      w.applyTorque(body, rotate(w.getState(body).rotation, TORQUE));
      w.step();
    }
    const end = w.getState(body), q = end.rotation, omega = rotate([-q[0], -q[1], -q[2], q[3]], end.angularVelocity);
    // Euler's equations, I w' = torque - w x (I w), by RK4 at 16 times the step rate.
    const tensor = full(SIX), inv = inverse(tensor), rate = v => mulV(inv, TORQUE.map((t, i) => t - cross(v, mulV(tensor, v))[i])), dt = 1 / (HZ * 16);
    let ref = [0, 0, 0];
    for (let i = 0; i < 2 * HZ * 16; i++) {
      const k1 = rate(ref), k2 = rate(ref.map((v, j) => v + dt / 2 * k1[j])), k3 = rate(ref.map((v, j) => v + dt / 2 * k2[j])), k4 = rate(ref.map((v, j) => v + dt * k3[j]));
      ref = ref.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const state = w.getState(ball);
    return {speed: state.linearVelocity[0], spin: state.angularVelocity[1], euler: Math.hypot(...omega.map((v, i) => v - ref[i])) / Math.hypot(...ref), early, earlyExact: inv[1][0] * 0.3 * 12 / HZ};
  } finally { w.dispose(); }
});

const centre = () => memo('compound/centre', async () => {
  const w = await world({ground: false});
  try {
    const m = 2, d = 0.3, about = 0.05, theta0 = 0.05, pivot = [0, 10, 0];
    const body = w.createBody({shape: {kind: 'sphere', radius: 0.1}, position: pivot, rotation: [0, 0, Math.sin(theta0 / 2), Math.cos(theta0 / 2)], neverSleeps: true,
      massData: {mass: m, center: [0, -d, 0], inertia: [about, about, about, 0, 0, 0]}});
    w.createJoint({type: 'revolute', bodyA: null, bodyB: body, frameA: {position: pivot}});
    const samples = [];
    for (let i = 0; i < HZ * 20; i++) { w.step(); const q = w.getState(body).rotation; samples.push(2 * Math.atan2(q[2], q[3])); }
    return {period: periodOf(samples), exact: 2 * Math.PI * Math.sqrt((about + m * d * d) / (m * G * d)) * (1 + theta0 * theta0 / 16)};
  } finally { w.dispose(); }
});

const replay = () => memo('compound/replay', async () => {
  const {createWorld} = await kit('index'), w = await createWorld();
  try {
    w.startRecording({world: {gravity: [0, -9.81, 0]}, checkpointEvery: 30});
    const bar = w.createBody({shape: dumbbell(), position: [0, 3, 0], rotation: [0, 0, 0.3, 0.954], restitution: 0.2});
    const heavy = w.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [-3, 2, 0], massData: {mass: 50, center: [0.1, 0, 0], inertia: [1, 2, 3, 0.1, 0, 0]}});
    w.createBody({shape: lShape(), position: [3, 0.5, 0], angularVelocity: [0, 1, 0]});
    for (let i = 0; i < 120; i++) {
      if (i === 20) w.setMassData(bar, {mass: 9, center: [0.2, 0, 0], inertia: [0.3, 2, 2, 0, 0, 0]});
      if (i === 70) w.resetMassData(bar);
      if (i === 90) w.setMassData(heavy, {mass: 5, inertia: [0.1, 0.1, 0.1, 0, 0, 0]});
      w.step();
    }
    const log = JSON.parse(JSON.stringify(w.stopRecording()));
    w.resetArena();
    const report = w.replayDetailed(log);
    return report.matches ? 0 : 1;
  } finally { w.dispose(); }
});

const sceneOf = () => ({
  format: 'box3d-scene', version: 2, world: {step: 1 / 120, subSteps: 4}, materials: {steel: {density: 7800, friction: 0.4, restitution: 0.1}},
  bodies: [
    {id: 'hammer', position: [0, 2, 0], rotationEuler: [0, 0, 20], material: 'steel', shape: {kind: 'compound', shapes: [
      {shape: {kind: 'capsule', radius: 0.02, halfLength: 0.25}, density: 600, friction: 0.9},
      {shape: {kind: 'box', halfExtents: [0.08, 0.04, 0.04]}, position: [0, 0.29, 0]},
      {shape: {kind: 'hull', points: [0.08, -0.04, -0.04, 0.08, 0.04, -0.04, 0.08, -0.04, 0.04, 0.08, 0.04, 0.04, 0.14, 0, 0]}, position: [0, 0.29, 0], rotationEuler: [0, 180, 0]},
    ]}},
    {id: 'flywheel', position: [2, 1, 0], shape: {kind: 'sphere', radius: 0.2}, massData: {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]}, angularVelocity: [0, 0, 6]},
    {id: 'crate', position: [-2, 0.5, 0], shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, massData: {mass: 30, center: [0, -0.3, 0], inertia: [4, 5, 4, 0.2, 0, -0.1]}},
  ],
  joints: [{id: 'axle', type: 'revolute', bodyA: null, bodyB: 'flywheel', frameA: {position: [2, 1, 0]}}],
});
// sceneHash of the five example scenes at the commit before scene version 2, first 16 hex digits.
const HASHES_BEFORE = {'pendulum-wave': 'b81e98b7c9cf8c76', 'newtons-cradle': '0a586664671aee33', 'domino-run': 'cdf465057fdd04c5', 'terrain-car': 'c52c45ee8645661d', ragdoll: '4d2ed3154b143c11'};

const sceneRun = () => memo('compound/scene', async () => {
  const {createWorld} = await kit('index'), {canonicalize, normalizeScene, encodeSceneLink, decodeSceneLink, loadScene, sceneWorldOptions, sceneHash, EXAMPLE_SCENES} = await kit('scene');
  const scene = sceneOf(), text = canonicalize(scene), link = await encodeSceneLink(scene), back = canonicalize(decodeSceneLink(link));
  let different = Math.abs(text.length - back.length);
  for (let i = 0; i < Math.min(text.length, back.length); i++) if (text[i] !== back[i]) different++;
  const normal = normalizeScene(scene), hashes = [];
  let hammer = 0;
  // Loaded from the file, loaded from its link, and built by hand with createBody and setMassData.
  for (const build of ['file', 'link', 'hand']) {
    const w = await createWorld(sceneWorldOptions(normal));
    try {
      if (build === 'hand') {
        w.reset({});
        w.createBody({position: [0, 2, 0], rotation: normal.bodies[0].rotation, ...scene.materials.steel, shape: normal.bodies[0].shape});
        const wheel = w.createBody({position: [2, 1, 0], shape: {kind: 'sphere', radius: 0.2}, angularVelocity: [0, 0, 6]});
        w.setMassData(wheel, {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]});
        w.createBody({position: [-2, 0.5, 0], shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, massData: {mass: 30, center: [0, -0.3, 0], inertia: [4, 5, 4, 0.2, 0, -0.1]}});
        w.createJoint({type: 'revolute', bodyA: null, bodyB: wheel, frameA: {position: [2, 1, 0]}});
      } else {
        const loaded = loadScene(w, build === 'file' ? scene : decodeSceneLink(link));
        hammer = w.getMassData(loaded.bodies.get('hammer')).mass;
      }
      for (let i = 0; i < 240; i++) w.step();
      hashes.push(w.exactHash());
    } finally { w.dispose(); }
  }
  const changed = Object.entries(EXAMPLE_SCENES).filter(([name, make]) => sceneHash(make()).slice(0, 16) !== HASHES_BEFORE[name] || sceneHash({...make(), version: 2}) !== sceneHash(make())).length;
  return {different, mismatches: (hashes[1] !== hashes[0]) + (hashes[2] !== hashes[0]), hammer, changed};
});

const robotModules = () => memo('compound/robot-modules', async () => ({...(await kit('robot')), createWorld: (await kit('index')).createWorld}));
const arm = () => memo('compound/arm', async () => {
  const {parseURDF, sixDofArmURDF, spawnRobot, robotReport, createWorld} = await robotModules(), robot = parseURDF(sixDofArmURDF());
  const w = await createWorld({step: 1 / HZ, subSteps: SUB});
  try {
    w.reset({ground: false});
    const spawned = spawnRobot(w, robot);
    let worst = 0, centre = 0, total = 0;
    for (const one of robot.links) {
      const handle = spawned.links.get(one.name), data = w.getMassData(handle.body), file = one.inertial, wanted = principal([file.inertia[0], file.inertia[3], file.inertia[5], file.inertia[1], file.inertia[2], file.inertia[4]]);
      principal(data.inertia).forEach((v, i) => { worst = Math.max(worst, Math.abs(v / wanted[i] - 1)); });
      const f = handle.frame, inLink = rotate([-f.rotation[0], -f.rotation[1], -f.rotation[2], f.rotation[3]], data.center.map((v, i) => v - f.position[i]));
      centre = Math.max(centre, Math.hypot(...inLink.map((v, i) => v - file.origin.xyz[i])));
      total += data.mass;
    }
    // The tool link as a compound without the file's inertia: the solver's principal moments against the report's sum over its two boxes.
    w.reset({ground: false});
    const plain = spawnRobot(w, robot, {inertia: 'shapes'}), byHand = robotReport(robot, {inertia: 'shapes'}).links.at(-1), got = principal(w.getMassData(plain.links.get('tool').body).inertia);
    return {worst, centre, total, bodies: spawned.bodies.size, tool: Math.max(...got.map((v, i) => Math.abs(v / byHand.principalActual[i] - 1))), shapesGap: spawned.report.links.at(-1).shapesPrincipalError};
  } finally { w.dispose(); }
});

const rod = () => memo('compound/rod', async () => {
  const {parseURDF, spawnRobot, createWorld} = await robotModules();
  const m = 2, len = 0.8, wd = 0.06, k = 1.3, own = m * (wd * wd + len * len) / 12, theta0 = 0.1;
  const urdf = `<robot name="rod"><link name="world"/>
    <joint name="hinge" type="continuous"><parent link="world"/><child link="rod"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/></joint>
    <link name="rod"><inertial><origin xyz="0 0 ${-len / 2}"/><mass value="${m}"/><inertia ixx="${k * own}" ixy="0" ixz="0" iyy="${k * own}" iyz="0" izz="${m * wd * wd / 6}"/></inertial>
      <collision><origin xyz="0 0 ${-len / 2}"/><geometry><box size="${wd} ${wd} ${len}"/></geometry></collision></link></robot>`;
  const period = I => 2 * Math.PI * Math.sqrt((I + m * len * len / 4) / (m * G * len / 2)) * (1 + theta0 * theta0 / 16);
  const measured = [];
  for (const options of [{}, {inertia: 'shapes'}]) {
    const w = await createWorld({step: 1 / HZ, subSteps: SUB});
    try {
      w.reset({ground: false});
      const robot = spawnRobot(w, parseURDF(urdf), {positions: {hinge: theta0}, ...options}), samples = [];
      for (let i = 0; i < HZ * 20; i++) { w.step(); samples.push(w.getJointState(robot.joints.get('hinge')).value); }
      measured.push(periodOf(samples));
    } finally { w.dispose(); }
  }
  return {file: measured[0], shapes: measured[1], exact: period(k * own), gap: period(k * own) / period(own) - 1};
});

const resume = () => memo('compound/resume', async () => {
  const {createWorld} = await kit('index'), {loadScene, saveScene, sceneWorldOptions} = await kit('scene');
  const scene = {format: 'box3d-scene', version: 2, world: {gravity: [0, 0, 0], ground: false, step: 1 / 240, subSteps: 4}, bodies: [
    {id: 'ell', shape: lShape(), position: [0, 5, 0], linearVelocity: [1, 0, 0], angularVelocity: [0.5, 0, 2], neverSleeps: true}]};
  const first = await createWorld(sceneWorldOptions(scene)), second = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadScene(first, scene);
    for (let i = 0; i < 100; i++) first.step();
    const resumed = loadScene(second, saveScene(first, loaded));
    const a = first.getState(loaded.bodies.get('ell')).linearVelocity, b = second.getState(resumed.bodies.get('ell')).linearVelocity;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  } finally { first.dispose(); second.dispose(); }
});

export const rigidCompound = defineCases('rigid', FILE, [
  {id: 'rigid.compound.mass', title: 'Compound: mass of a dumbbell', quantity: 'mass of two spheres (r = 0.1 m, density 1000 kg/m^3) on one body', unit: 'kg', test: T.mass,
    reference: {formula: 'm = 2 rho (4/3) pi r^3', value: 2 * M}, tolerance: relative(2e-7), note: 'The world stores mass in float32.', measure: async () => (await massData()).bar.mass},
  {id: 'rigid.compound.inertia', title: 'Compound: parallel-axis inertia of a dumbbell', quantity: 'moment of inertia across the bar, sphere centres 0.4 m either side of the centre', unit: 'kg m^2', test: T.mass,
    reference: {formula: 'I = 2 ((2/5) m r^2 + m d^2)', value: ACROSS}, tolerance: relative(2e-7), measure: async () => (await massData()).bar.inertia[1]},
  {id: 'rigid.compound.centre-of-mass', title: 'Compound: centre of mass of an L of two boxes', quantity: 'height of the centre of mass above the body origin (a 1 x 0.2 x 0.6 m slab and a 0.2 x 2 x 0.6 m post)', unit: 'm', test: T.mass,
    reference: {formula: 'c = (m1 c1 + m2 c2) / (m1 + m2)', value: L.center[1]}, tolerance: absolute(2e-7), measure: async () => (await massData()).bracket.center[1]},
  {id: 'rigid.compound.product-of-inertia', title: 'Compound: product of inertia of the L', quantity: 'Ixy about the centre of mass, in body axes', unit: 'kg m^2', test: T.mass,
    reference: {formula: 'Ixy = -(m1 x1 y1 + m2 x2 y2), offsets from the centre of mass', value: L.ixy}, tolerance: relative(3e-7), measure: async () => (await massData()).bracket.inertia[3]},
  {id: 'rigid.compound.spin-up', title: 'Compound: spin-up of a dumbbell under torque', quantity: 'angular velocity after 3 N m acts for 2 s across the bar, no gravity', unit: 'rad/s', test: T.dumbbell,
    reference: {formula: 'omega = tau t / (2 ((2/5) m r^2 + m d^2))', value: 3 * 2 / ACROSS}, tolerance: relative(1e-4), measure: () => spinUp()},
  {id: 'rigid.compound.pendulum', title: 'Compound: physical pendulum of two spheres', quantity: 'period of spheres 0.5 m and 1.2 m below a hinge, released at 0.05 rad, mean over 30 s', unit: 's', test: T.dumbbell,
    reference: {formula: 'T = 2 pi sqrt((2 (2/5) r^2 + l1^2 + l2^2) / (g (l1 + l2))) (1 + theta0^2 / 16)', value: null}, tolerance: relative(1e-4),
    measure: async () => { const r = await swing(); return {value: r.period, reference: r.exact}; }},
  {id: 'rigid.compound.tipping', title: 'Compound: tipping angle of the L', quantity: 'tilt of gravity at which the L turns over the edge of its base (bisected to 0.016 degrees, 8 s a run)', unit: 'degrees', test: T.tipping,
    reference: {formula: 'tan(theta) = (0.5 + c_x) / c_y, from the centre of mass', value: L.critical * 180 / Math.PI}, tolerance: absolute(0.1),
    note: 'A body within about 0.01 degrees of the critical angle takes longer than 8 s to fall; the uniform block of the same outline would tip at 24.4 degrees.', measure: () => tipping()},
  {id: 'rigid.compound.rest', title: 'Compound: the L at rest on the ground', quantity: 'distance its origin moves in 6 s', unit: 'm', test: T.rest,
    reference: {formula: 'no motion', value: 0}, tolerance: upper(1e-3), note: 'It settles into the contact by half a millimetre (Box3D\'s linear slop is 5 mm) and then sleeps.', measure: async () => (await rest()).moved},
  {id: 'rigid.compound.rest-speed', title: 'Compound: no creep at rest', quantity: 'largest linear or angular speed of the L between 1 s and 6 s', unit: 'm/s, rad/s', test: T.rest,
    reference: {formula: 'v = 0', value: 0}, tolerance: upper(1e-3), measure: async () => (await rest()).fastest},
  {id: 'rigid.mass-data.force', title: 'Explicit mass: F = m a', quantity: 'speed after 14 N acts for 1 s on a sphere told to weigh 7 kg (its shape says 4.19 kg)', unit: 'm/s', test: T.explicit,
    reference: {formula: 'v = F t / m', value: 2}, tolerance: relative(1e-4), measure: async () => (await explicit()).speed},
  {id: 'rigid.mass-data.torque', title: 'Explicit inertia: tau = I alpha', quantity: 'spin after 6 N m acts for 1 s about an axis told to have I = 3 kg m^2 (its shape says 0.017)', unit: 'rad/s', test: T.explicit,
    reference: {formula: 'omega = tau t / I', value: 2}, tolerance: relative(1e-4), measure: async () => (await explicit()).spin},
  {id: 'rigid.mass-data.cross-coupling', title: 'Explicit inertia: a full tensor couples the axes', quantity: 'angular velocity about y after a torque of 0.3 N m about x acts for 0.05 s on a body with products of inertia', unit: 'rad/s', test: T.explicit,
    reference: {formula: 'omega = (I^-1 tau) t', value: null}, tolerance: relative(1e-3), measure: async () => { const r = await explicit(); return {value: r.early, reference: r.earlyExact}; }},
  {id: 'rigid.mass-data.euler', title: 'Explicit inertia: Euler\'s equations over 2 s', quantity: 'relative difference of the body-axis angular velocity from an RK4 solution, full tensor, body-fixed torque, about 1.7 rad turned', unit: '1', test: T.explicit,
    reference: {formula: 'I w\' = tau - w x (I w)', value: 0}, tolerance: upper(2e-3), note: 'The engine integrates the gyroscopic term implicitly with one Newton step per sub-step; the torque is re-aimed once a step.', measure: async () => (await explicit()).euler},
  {id: 'rigid.mass-data.centre-of-mass', title: 'Explicit centre of mass: a pendulum from stated mass data', quantity: 'period of a sphere hinged through its centre and told that its centre of mass is 0.3 m below with I = 0.05 kg m^2, mean over 20 s', unit: 's', test: T.centre,
    reference: {formula: 'T = 2 pi sqrt((I + m d^2) / (m g d)) (1 + theta0^2 / 16)', value: null}, tolerance: relative(1e-4),
    note: 'From its shape the body would not swing at all: the hinge passes through the sphere\'s centre.', measure: async () => { const r = await centre(); return {value: r.period, reference: r.exact}; }},
  {id: 'rigid.compound.replay', title: 'Compound and mass data: replay', quantity: 'a recording with compound bodies, setMassData and resetMassData, replayed from its JSON (0: every checkpoint and the final hash match)', unit: '1', test: T.replay,
    reference: {formula: 'replay = recording, bit for bit', value: 0}, tolerance: absolute(0), measure: () => replay()},
]);

export const sceneCompound = defineCases('scene', FILE, [
  {id: 'scene.v2.link', title: 'Version 2: a compound and massData through a share link', quantity: 'characters that differ between the canonical scene and the scene decoded from its compressed link', unit: 'characters', test: T.scene,
    reference: {formula: 'decode(encode(scene)) = scene', value: 0}, tolerance: absolute(0), measure: async () => (await sceneRun()).different},
  {id: 'scene.v2.load', title: 'Version 2: file, link and hand-built worlds agree', quantity: 'exactHash mismatches after 240 steps between the loaded file, the loaded link and the same bodies made with createBody and setMassData', unit: '1', test: T.scene,
    reference: {formula: 'identical hashes', value: 0}, tolerance: absolute(0), measure: async () => (await sceneRun()).mismatches},
  {id: 'scene.v2.material', title: 'Version 2: per-shape density in a compound', quantity: 'mass of a hammer: a 600 kg/m^3 capsule handle, and a box head and hull claw at the body material\'s 7800 kg/m^3', unit: 'kg', test: T.scene,
    reference: {formula: 'm = sum of rho_i V_i', value: 600 * (Math.PI * 0.02 ** 2 * 0.5 + 4 / 3 * Math.PI * 0.02 ** 3) + 7800 * 0.16 * 0.08 * 0.08 + 7800 * (0.08 * 0.08 * 0.06 / 3)}, tolerance: relative(1e-5),
    measure: async () => (await sceneRun()).hammer},
  {id: 'scene.v2.resume', title: 'Version 2: a spinning compound saved and resumed', quantity: 'difference of the centre-of-mass velocity at the moment of loading a save taken after 100 steps (an L spinning at 2 rad/s; origin and centre-of-mass velocities differ by 1.8 m/s)', unit: 'm/s', test: T.resume,
    reference: {formula: 'v_origin = v_com - w x (R c), written by the save', value: 0}, tolerance: upper(5e-6), note: 'float32: the save converts the solver\'s centre-of-mass velocity to the origin velocity the format states.', measure: () => resume()},
  {id: 'scene.v1.unchanged', title: 'Version 1 scenes keep their hash', quantity: 'example scenes (of 5) whose sceneHash differs from the one before version 2 existed, or changes when the file declares version 2 without using it', unit: 'scenes', test: T.scene,
    reference: {formula: 'unchanged', value: 0}, tolerance: absolute(0), measure: async () => (await sceneRun()).changed},
]);

export const robotCompound = defineCases('robot', FILE, [
  {id: 'robot.inertia.applied', title: 'Inertia: the six-joint arm has the file\'s tensors', quantity: 'largest relative error of a principal moment the solver holds against the file\'s, over the arm\'s 7 links', unit: '1', test: T.robot,
    reference: {formula: 'I(solver) = I(file)', value: 0}, tolerance: upper(2e-6), note: 'float32. From the shapes alone the worst link was 42% off.', measure: async () => (await arm()).worst},
  {id: 'robot.inertia.centre-of-mass', title: 'Centre of mass: the six-joint arm has the file\'s', quantity: 'largest distance between a link\'s centre of mass in the solver and the file\'s inertial origin', unit: 'm', test: T.robot,
    reference: {formula: 'c(solver) = c(file)', value: 0}, tolerance: upper(1e-7), note: 'From the shapes alone the tool link was 4.4 mm off.', measure: async () => (await arm()).centre},
  {id: 'robot.compound.bodies', title: 'One body per link', quantity: 'bodies of the six-joint arm, whose tool link has two collision boxes', unit: 'bodies', test: T.robot,
    reference: {formula: 'links with collision shapes', value: 7}, tolerance: absolute(0), measure: async () => (await arm()).bodies},
  {id: 'robot.compound.inertia', title: 'A compound link from its shapes', quantity: 'largest relative error of a principal moment of the two-box tool link in the solver against the sum over its boxes by parallel axes (inertia: shapes)', unit: '1', test: T.robot,
    reference: {formula: 'I = sum of (I_i + m_i d_i^2)', value: 0}, tolerance: upper(2e-6), measure: async () => (await arm()).tool},
  {id: 'robot.pendulum.file-period', title: 'One revolute link: the period of the file\'s inertia', quantity: 'period of a 0.8 m rod hinged at its end whose file states 1.3 x the rod\'s transverse inertia, mean over 20 s', unit: 's', test: T.rod,
    reference: {formula: 'T = 2 pi sqrt((1.3 I_box + m d^2) / (m g d)) (1 + theta0^2 / 16)', value: null}, tolerance: relative(1e-4), measure: async () => { const r = await rod(); return {value: r.file, reference: r.exact}; }},
  {id: 'robot.pendulum.file-against-shapes', title: 'One revolute link: file inertia against shape inertia', quantity: 'measured period with the file\'s inertia over the measured period with inertia: shapes, minus 1', unit: '1', test: T.rod,
    reference: {formula: 'sqrt((1.3 I_box + m d^2) / (I_box + m d^2)) - 1', value: null}, tolerance: absolute(1e-4), measure: async () => { const r = await rod(); return {value: r.file / r.shapes - 1, reference: r.gap}; }},
]);
