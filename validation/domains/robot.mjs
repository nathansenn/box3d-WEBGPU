// Robot import: URDF and MJCF as scenes (box3d-webgpu-kit/robot).
// Set-ups are those of packages/box3d-kit/test/v15-robot.test.mjs.
import {kit, memo, defineCases, relative, absolute, upper, lower} from '../lib.mjs';

const G = 9.81, HZ = 240;
const FILE = 'packages/box3d-kit/test/v15-robot.test.mjs';
const T = {
  kinematics: 'forward kinematics: link poses of the two-link and six-joint arms equal the product of joint transforms to 1e-6',
  formats: 'format equivalence: the double pendulum from URDF and from MJCF is the same scene and the same trajectory',
  mass: 'mass and inertia: total mass is the sum of link masses to float32, and the reported inertia errors are those of the shapes',
  pendulum: 'a single revolute link swings with the compound-pendulum period of its ACTUAL inertia, not the inertia in the file',
  cart: 'the cart-pole swings at the coupled small-oscillation frequency, and a slider along gravity falls at g and stops at its limit',
  motor: 'joint limits hold, and a motor with effort tau holds a horizontal link when tau >= m g d and drops it when not',
  spring: 'joint stiffness and damping become a joint spring with the right frequency and decay; dry friction becomes a motor',
  hold: 'static stability: the six-joint arm holds its pose for 5 s within a stated tolerance, by motors and by springs',
  chain: 'maximal-coordinate drift: a 12-link chain stretches by millimetres at its joints, as the soft-constraint model predicts',
  wheels: 'the wheeled cart rests on the ground and rolls at wheel speed x radius when its wheel motors run',
  round: 'round trip: robotToScene validates, loads to the same hashes as spawnRobot, and survives a share link',
};
const modules = () => memo('robot/modules', async () => ({...(await kit('robot')), ...(await kit('scene')), createWorld: (await kit('index')).createWorld}));
const si = async (ground = false, gravity = [0, -G, 0]) => { const {createWorld} = await modules(), world = await createWorld({step: 1 / HZ, subSteps: 4}); world.reset({ground, gravity}); return world; };
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * HZ); i++) world.step(); };
const periodOf = samples => {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] > 0 && samples[i] <= 0) crossings.push((i - 1 + samples[i - 1] / (samples[i - 1] - samples[i])) / HZ);
  return (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
};
const peaks = samples => { const out = []; for (let i = 1; i < samples.length - 1; i++) if (samples[i] > 0 && samples[i] > samples[i - 1] && samples[i] >= samples[i + 1]) out.push([i / HZ, samples[i]]); return out; };
const decay = found => Math.log(found[0][1] / found.at(-1)[1]) / (found.at(-1)[0] - found[0][0]);

const mul = (a, b) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]));
const apply = (a, v) => [0, 1, 2].map(i => a[i * 3] * v[0] + a[i * 3 + 1] * v[1] + a[i * 3 + 2] * v[2]);
const RX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const RY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const RZ = t => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
const AXIS = {x: RX, y: RY, z: RZ}, UP = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const matrixOf = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
const SIX_DOF = [
  {name: 'turret', joint: 'yaw', xyz: [0, 0, 0.1], rpy: [0, 0, 0], axis: 'z'}, {name: 'upper_arm', joint: 'shoulder', xyz: [0, 0.09, 0.2], rpy: [0, 0.3, 0], axis: 'y'},
  {name: 'forearm', joint: 'elbow', xyz: [0, -0.08, 0.4], rpy: [0, 0.9, 0], axis: 'y'}, {name: 'wrist', joint: 'forearm_roll', xyz: [0, 0, 0.3], rpy: [0.2, 0, 0.4], axis: 'z'},
  {name: 'hand', joint: 'wrist_pitch', xyz: [0, 0, 0.12], rpy: [0, 0.5, 0], axis: 'y'}, {name: 'tool', joint: 'tool_roll', xyz: [0, 0, 0.095], rpy: [0, 0, 0.3], axis: 'z'},
];

const kinematics = () => memo('robot/kinematics', async () => {
  const {parseURDF, sixDofArmURDF, robotKinematics, spawnRobot, robotLinkPose} = await modules(), robot = parseURDF(sixDofArmURDF()), world = await si();
  try {
    let pure = 0, bodies = 0;
    for (const q of [[0, 0, 0, 0, 0, 0], [0.4, -0.7, 1.1, -0.9, 0.6, 2.2], [-3, 2, -2.5, 3, -2, -3], [1.5, 0.25, -0.5, 0.75, 1, -1.25]]) {
      const positions = Object.fromEntries(SIX_DOF.map((row, i) => [row.joint, q[i]])), poses = robotKinematics(robot, positions);
      world.reset({ground: false});
      const spawned = spawnRobot(world, robot, {positions});
      let p = [0, 0, 0], r = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      SIX_DOF.forEach((row, i) => {
        const offset = apply(r, row.xyz);
        p = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
        r = mul(r, mul(mul(RZ(row.rpy[2]), mul(RY(row.rpy[1]), RX(row.rpy[0]))), AXIS[row.axis](q[i])));
        const one = poses.get(row.name), handle = spawned.links.get(row.name), actual = robotLinkPose(world.getState(handle.body), handle.frame), at = apply(UP, p), turn = mul(UP, r);
        pure = Math.max(pure, ...one.xyz.map((v, k) => Math.abs(v - p[k])), ...matrixOf(one.quat).map((v, k) => Math.abs(v - r[k])));
        bodies = Math.max(bodies, ...actual.position.map((v, k) => Math.abs(v - at[k])), ...matrixOf(actual.rotation).map((v, k) => Math.abs(v - turn[k])));
      });
    }
    return {pure, bodies};
  } finally { world.dispose(); }
});

const formats = () => memo('robot/formats', async () => {
  const {parseURDF, parseMJCF, doublePendulumURDF, doublePendulumMJCF, robotToScene, spawnRobot, canonicalize, sceneWorldOptions, createWorld} = await modules();
  const robots = [parseURDF(doublePendulumURDF()), parseMJCF(doublePendulumMJCF())], options = {positions: {shoulder: 0.8, elbow: -0.5}};
  const scenes = robots.map(robot => canonicalize(robotToScene(robot, options))), hashes = [];
  let different = Math.abs(scenes[0].length - scenes[1].length);
  for (let i = 0; i < Math.min(scenes[0].length, scenes[1].length); i++) if (scenes[0][i] !== scenes[1][i]) different++;
  for (const robot of robots) {
    const world = await createWorld(sceneWorldOptions(robotToScene(robot, options)));
    try { world.reset({ground: true}); spawnRobot(world, robot, options); for (let i = 0; i < 600; i++) world.step(); hashes.push(world.exactHash()); } finally { world.dispose(); }
  }
  return {different, hashes: hashes[0] === hashes[1] ? 0 : 1};
});

const mass = () => memo('robot/mass', async () => {
  const {parseURDF, sixDofArmURDF, spawnRobot} = await modules(), world = await si();
  try {
    const spawned = spawnRobot(world, parseURDF(sixDofArmURDF()));
    let total = 0;
    for (const body of spawned.bodies.values()) total += world.getState(body).mass;
    const report = spawned.report, link = name => report.links.find(one => one.link === name);
    // The tool's two boxes at one density, by hand (see the test).
    const v1 = 0.1 * 0.06 * 0.04, v2 = 0.02 * 0.06 * 0.06, rho = 0.3 / (v1 + v2), m1 = rho * v1, m2 = rho * v2;
    const cx = m2 * 0.04 / 0.3, cz = (m1 * 0.02 + m2 * 0.07) / 0.3, d1 = [-cx, 0.02 - cz], d2 = [0.04 - cx, 0.07 - cz];
    const ixx = m1 * (0.06 ** 2 + 0.04 ** 2) / 12 + m1 * d1[1] ** 2 + m2 * (0.06 ** 2 + 0.06 ** 2) / 12 + m2 * d2[1] ** 2;
    const izz = m1 * (0.1 ** 2 + 0.06 ** 2) / 12 + m1 * d1[0] ** 2 + m2 * (0.02 ** 2 + 0.06 ** 2) / 12 + m2 * d2[0] ** 2;
    const iyy = m1 * (0.1 ** 2 + 0.04 ** 2) / 12 + m1 * (d1[0] ** 2 + d1[1] ** 2) + m2 * (0.02 ** 2 + 0.06 ** 2) / 12 + m2 * (d2[0] ** 2 + d2[1] ** 2);
    const ixz = -(m1 * d1[0] * d1[1] + m2 * d2[0] * d2[1]);
    const pair = (a, b, c) => { const mean = (a + b) / 2, half = Math.hypot((a - b) / 2, c); return [mean - half, mean + half]; };
    const actual = [...pair(ixx, izz, ixz), iyy].sort((a, b) => a - b), wanted = [...pair(0.0003, 0.0002, -0.00003), 0.00035].sort((a, b) => a - b);
    return {total, tool: link('tool').maxPrincipalError, toolByHand: Math.max(...actual.map((v, i) => Math.abs(v - wanted[i]) / wanted[i])), turret: link('turret').maxPrincipalError, cylinder: report.shapes[0].inertiaError};
  } finally { world.dispose(); }
});

const pendulum = () => memo('robot/pendulum', async () => {
  const {parseURDF, spawnRobot} = await modules(), world = await si();
  try {
    const m = 2, L = 0.8, w = 0.06, k = 1.3, own = m * (w * w + L * L) / 12, theta0 = 0.1;
    const robot = spawnRobot(world, parseURDF(`<robot name="rod"><link name="world"/>
      <joint name="hinge" type="continuous"><parent link="world"/><child link="rod"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/></joint>
      <link name="rod"><inertial><origin xyz="0 0 ${-L / 2}"/><mass value="${m}"/><inertia ixx="${k * own}" ixy="0" ixz="0" iyy="${k * own}" iyz="0" izz="${m * w * w / 6}"/></inertial>
        <collision><origin xyz="0 0 ${-L / 2}"/><geometry><box size="${w} ${w} ${L}"/></geometry></collision></link></robot>`), {positions: {hinge: theta0}}), samples = [];
    for (let i = 0; i < HZ * 20; i++) { world.step(); samples.push(world.getJointState(robot.joints.get('hinge')).value); }
    const period = I => 2 * Math.PI * Math.sqrt((I + m * L * L / 4) / (m * G * L / 2)) * (1 + theta0 * theta0 / 16);
    return {measured: periodOf(samples), actual: period(own), fromFile: period(k * own)};
  } finally { world.dispose(); }
});

const cart = () => memo('robot/cart', async () => {
  const {parseURDF, cartPoleURDF, spawnRobot} = await modules(), world = await si();
  try {
    const M = 1, m = 0.2, l = 1, w = 0.04, d = l / 2, I = m * (w * w + l * l) / 12;
    const robot = spawnRobot(world, parseURDF(cartPoleURDF()), {positions: {hinge: 0.05}}), samples = [];
    for (let i = 0; i < HZ * 20; i++) { world.step(); samples.push(world.getJointState(robot.joints.get('hinge')).value); }
    world.reset({ground: false});
    const slider = spawnRobot(world, parseURDF(`<robot name="drop"><link name="world"/>
      <joint name="slide" type="prismatic"><parent link="world"/><child link="block"/><origin xyz="0 0 50"/><axis xyz="0 0 -1"/><limit lower="-1" upper="30" effort="10" velocity="1"/></joint>
      <link name="block"><inertial><mass value="3"/><inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.02"/></inertial><collision><geometry><box size="0.2 0.2 0.2"/></geometry></collision></link></robot>`));
    run(world, 2);
    const speed = -world.getState(slider.links.get('block').body).linearVelocity[1];
    run(world, 4);
    return {period: periodOf(samples), coupled: 2 * Math.PI / Math.sqrt((M + m) * m * G * d / ((M + m) * (I + m * d * d) - m * m * d * d)), speed, stop: world.getJointState(slider.joints.get('slide')).value};
  } finally { world.dispose(); }
});

const motor = factor => memo(`robot/motor/${factor}`, async () => {
  const {parseURDF, spawnRobot} = await modules(), world = await si();
  try {
    const m = 1.5, L = 0.6, w = 0.05, effort = factor === null ? 0 : factor * m * G * L / 2;
    const robot = spawnRobot(world, parseURDF(`<robot name="arm"><link name="world"/>
      <joint name="hinge" type="revolute"><parent link="world"/><child link="arm"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/><limit lower="${factor === null ? -0.2 : -3}" upper="${factor === null ? 0.5 : 3}" effort="${effort}" velocity="1"/></joint>
      <link name="arm"><inertial><origin xyz="${L / 2} 0 0"/><mass value="${m}"/><inertia ixx="0.001" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.05"/></inertial>
        <collision><origin xyz="${L / 2} 0 0"/><geometry><box size="${L} ${w} ${w}"/></geometry></collision></link></robot>`), factor === null ? {} : {motors: {hinge: 0}});
    run(world, factor === null ? 6 : 3);
    return world.getJointState(robot.joints.get('hinge')).value;
  } finally { world.dispose(); }
});

const spring = (stiffness, damping, theta0, seconds, gravity) => memo(`robot/spring/${stiffness}/${damping}`, async () => {
  const {parseMJCF, spawnRobot} = await modules(), world = await si(false, [0, gravity, 0]);
  try {
    const spawned = spawnRobot(world, parseMJCF(`<mujoco model="spring"><compiler angle="radian"/><option gravity="0 0 ${gravity}"/><worldbody><body name="rod" pos="0 0 1">
      <joint name="hinge" type="hinge" axis="0 1 0" stiffness="${stiffness}" damping="${damping}"/><geom type="box" pos="0 0 -0.3" size="0.03 0.03 0.3" density="800"/></body></worldbody></mujoco>`), {positions: {hinge: theta0}}), samples = [];
    for (let i = 0; i < HZ * seconds; i++) { world.step(); samples.push(world.getJointState(spawned.joints.get('hinge')).value); }
    const m = 800 * 0.06 * 0.06 * 0.6;
    return {period: periodOf(samples), decay: decay(peaks(samples)), pivot: m * (0.06 ** 2 + 0.6 ** 2) / 12 + m * 0.3 ** 2};
  } finally { world.dispose(); }
});

const rotate = ([x, y, z, w], v) => {
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};
function anchorGap(world, robot) {
  const point = (id, frame) => {
    const p = frame?.position ?? [0, 0, 0];
    if (id === null) return p;
    const state = world.getState(robot.bodies.get(id)), r = rotate(state.rotation, p);
    return [state.position[0] + r[0], state.position[1] + r[1], state.position[2] + r[2]];
  };
  let worst = 0;
  for (const one of robot.scene.joints) {
    if (one.type === 'prismatic') continue;
    const a = point(one.bodyA, one.frameA), b = point(one.bodyB, one.frameB);
    worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return worst;
}

const hold = how => memo(`robot/hold/${how}`, async () => {
  const {parseURDF, sixDofArmURDF, spawnRobot, robotLinkPose} = await modules(), world = await si();
  try {
    const options = how === 'motors' ? {motors: Object.fromEntries(SIX_DOF.map(row => [row.joint, 0]))} : {hold: {hertz: 60, dampingRatio: 1}};
    const spawned = spawnRobot(world, parseURDF(sixDofArmURDF()), options), tool = spawned.links.get('tool');
    const at = () => robotLinkPose(world.getState(tool.body), tool.frame).position, start = at();
    let worst = 0, gap = 0;
    for (let i = 0; i < HZ * 5; i++) {
      world.step();
      const p = at();
      worst = Math.max(worst, Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]));
      if (i % 24 === 0) gap = Math.max(gap, anchorGap(world, spawned));
    }
    const p = at();
    return {worst, settled: Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]), gap, angle: Math.max(...SIX_DOF.map(row => Math.abs(world.getJointState(spawned.joints.get(row.joint)).value)))};
  } finally { world.dispose(); }
});

const chain = links => memo(`robot/chain/${links}`, async () => {
  const {parseURDF, hangingChainURDF, spawnRobot} = await modules(), world = await si(), robot = parseURDF(hangingChainURDF(links));
  try {
    const hanging = spawnRobot(world, robot);
    run(world, 5);
    const rest = anchorGap(world, hanging);
    world.reset({ground: false});
    const swinging = spawnRobot(world, robot, {positions: {hinge1: 1.2}});
    let swing = 0;
    for (let i = 0; i < HZ * 10; i++) { world.step(); if (i % 10 === 0) swing = Math.max(swing, anchorGap(world, swinging)); }
    return {rest, swing, estimate: (links - 2) * 0.25 * G / (0.125 * (2 * Math.PI * 60) ** 2)};
  } finally { world.dispose(); }
});

const wheels = () => memo('robot/wheels', async () => {
  const {parseURDF, wheeledCartURDF, spawnRobot} = await modules(), world = await si(true);
  try {
    const cartRobot = spawnRobot(world, parseURDF(wheeledCartURDF()), {floatingBase: true, position: [0, 0.002, 0]}), chassis = cartRobot.links.get('chassis').body;
    run(world, 2);
    const height = world.getState(chassis).position[1];
    for (const axle of cartRobot.joints.values()) world.setJointMotor(axle, {speed: 5, maxForce: 5});
    run(world, 2);
    const x0 = world.getState(chassis).position[0];
    run(world, 2);
    return {height, speed: (world.getState(chassis).position[0] - x0) / 2};
  } finally { world.dispose(); }
});

const round = () => memo('robot/round', async () => {
  const {EXAMPLE_ROBOTS, parseURDF, parseMJCF, robotToScene, spawnRobot, validateScene, loadScene, sceneWorldOptions, encodeSceneLink, decodeSceneLink, createWorld} = await modules();
  let problems = 0, mismatches = 0, robots = 0;
  for (const [name, example] of Object.entries(EXAMPLE_ROBOTS)) {
    const robot = example.format === 'urdf' ? parseURDF(example.text()) : parseMJCF(example.text()), options = name === 'wheeled-cart' ? {floatingBase: true, position: [0, 0.002, 0]} : {};
    const scene = robotToScene(robot, options), hashes = [];
    robots++;
    problems += validateScene(scene).length;
    for (const build of ['load', 'spawn', 'link']) {
      const world = await createWorld(sceneWorldOptions(scene));
      try {
        if (build === 'spawn') { world.reset({ground: scene.world.ground, gravity: scene.world.gravity}); spawnRobot(world, robot, options); }
        else loadScene(world, build === 'load' ? scene : decodeSceneLink(await encodeSceneLink(scene)));
        for (let i = 0; i < 150; i++) world.step();
        hashes.push(world.exactHash());
      } finally { world.dispose(); }
    }
    mismatches += (hashes[1] !== hashes[0]) + (hashes[2] !== hashes[0]);
  }
  return {problems, mismatches, robots};
});

export default defineCases('robot', FILE, [
  {id: 'robot.kinematics.function', title: 'Forward kinematics: the six-joint arm, as a function', quantity: 'largest error of a link position (m) or rotation-matrix entry over 6 links x 4 joint configurations', unit: 'm, 1', test: T.kinematics,
    reference: {formula: 'T_child = T_parent Trans(xyz) Rz(yaw) Ry(pitch) Rx(roll) R(axis, q)', value: 0}, tolerance: absolute(1e-12), measure: async () => (await kinematics()).pure},
  {id: 'robot.kinematics.bodies', title: 'Forward kinematics: the six-joint arm, as spawned bodies', quantity: 'the same error for the link frames read back from the bodies in the world (Y up)', unit: 'm, 1', test: T.kinematics,
    reference: {formula: 'world pose = U T_link, U: (x, y, z) -> (x, z, -y)', value: 0}, tolerance: absolute(1e-6), note: 'Body positions and rotations are float32 in the solver.', measure: async () => (await kinematics()).bodies},
  {id: 'robot.formats.scene', title: 'URDF and MJCF: the double pendulum is one scene', quantity: 'characters that differ between the canonical scene JSON from the URDF file and from the MJCF file', unit: 'characters', test: T.formats,
    reference: {formula: 'canonical(scene from URDF) = canonical(scene from MJCF)', value: 0}, tolerance: absolute(0),
    note: 'The MJCF file writes out a ground plane and a friction of 0.6, because its defaults (no ground, friction 1) differ from the URDF path.', measure: async () => (await formats()).different},
  {id: 'robot.formats.trajectory', title: 'URDF and MJCF: the double pendulum runs identically', quantity: 'difference of the exactHash after 600 steps of the two imports (0: identical)', unit: '1', test: T.formats,
    reference: {formula: 'hash(URDF run) = hash(MJCF run)', value: 0}, tolerance: absolute(0), measure: async () => (await formats()).hashes},
  {id: 'robot.mass.total', title: 'Mass: the six-joint arm weighs what its file says', quantity: 'sum of the masses the solver reports for the arm\'s 8 bodies', unit: 'kg', test: T.mass,
    reference: {formula: 'sum of the link masses in the file', value: 16.8}, tolerance: relative(2e-7), note: 'Density = link mass / collision volume, in float32.', measure: async () => (await mass()).total},
  {id: 'robot.inertia.report', title: 'Inertia report: the two-box tool link', quantity: 'reported largest relative error of a principal moment for the tool link (file tensor against its two boxes at one density)', unit: '1', test: T.mass,
    reference: {formula: 'max |I_i(two boxes, parallel axes) - I_i(file)| / I_i(file)', value: null}, tolerance: absolute(1e-9),
    note: 'This is the fidelity limit itself, not an error of the report: the engine cannot take the file\'s tensor, and here the bodies are 42% off it.', measure: async () => { const r = await mass(); return {value: r.tool, reference: r.toolByHand}; }},
  {id: 'robot.inertia.cylinder', title: 'A cylinder as a 24-sided prism of the same volume', quantity: 'largest relative error of a principal moment of the prism against the solid cylinder, at equal mass', unit: '1', test: T.mass,
    reference: {formula: 'I_prism = I_cylinder', value: 0}, tolerance: absolute(3e-5), measure: async () => (await mass()).cylinder},
  {id: 'robot.pendulum.period', title: 'One revolute link: compound-pendulum period', quantity: 'period of a 0.8 m box rod hinged at its end, mean over 20 s', unit: 's', test: T.pendulum,
    reference: {formula: 'T = 2 pi sqrt((I_box + m d^2) / (m g d)) (1 + theta0^2 / 16), with the body\'s actual inertia', value: null}, tolerance: relative(1e-3),
    measure: async () => { const r = await pendulum(); return {value: r.measured, reference: r.actual}; }},
  {id: 'robot.pendulum.file-inertia', title: 'One revolute link: what the file\'s inertia would have given', quantity: 'period predicted from the file\'s tensor (1.3 x the rod\'s) over the measured period, minus 1', unit: '1', test: T.pendulum,
    reference: {formula: 'sqrt((1.3 I_box + m d^2) / (I_box + m d^2)) - 1', value: null}, tolerance: absolute(1e-3),
    note: 'The body swings 3.7% faster than a body with the file\'s inertia would: the gap the inertia report warns of.', measure: async () => { const r = await pendulum(); return {value: r.fromFile / r.measured - 1, reference: r.fromFile / r.actual - 1}; }},
  {id: 'robot.cart-pole.period', title: 'Cart-pole: coupled small oscillation about the hanging pose', quantity: 'period of the pole on a free cart, mean over 20 s', unit: 's', test: T.cart,
    reference: {formula: 'omega^2 = (M + m) m g d / ((M + m) (I + m d^2) - m^2 d^2)', value: null}, tolerance: relative(2e-3), measure: async () => { const r = await cart(); return {value: r.period, reference: r.coupled}; }},
  {id: 'robot.prismatic.free-fall', title: 'Prismatic joint along gravity', quantity: 'speed of a block on a vertical slider after 2 s', unit: 'm/s', test: T.cart,
    reference: {formula: 'v = g t', value: G * 2}, tolerance: relative(1e-4), measure: async () => (await cart()).speed},
  {id: 'robot.prismatic.limit', title: 'Prismatic joint: the limit holds', quantity: 'travel of the falling block once it rests on its upper limit', unit: 'm', test: T.cart,
    reference: {formula: 'x = upper limit', value: 30}, tolerance: absolute(1e-3), measure: async () => (await cart()).stop},
  {id: 'robot.revolute.limit', title: 'Revolute joint: the limit holds', quantity: 'angle of a horizontal link after it has fallen onto its upper limit', unit: 'rad', test: T.motor,
    reference: {formula: 'theta = upper limit', value: 0.5}, tolerance: absolute(2e-3), measure: () => motor(null)},
  {id: 'robot.motor.holds', title: 'Effort limit: 1.02 m g d holds a horizontal link', quantity: 'angle after 3 s with a zero-speed motor whose largest torque is 1.02 times the gravity torque', unit: 'rad', test: T.motor,
    reference: {formula: 'theta = 0 while tau >= m g d', value: 0}, tolerance: absolute(2e-3), measure: () => motor(1.02)},
  {id: 'robot.motor.drops', title: 'Effort limit: 0.98 m g d does not', quantity: 'angle after 3 s with a zero-speed motor whose largest torque is 0.98 times the gravity torque', unit: 'rad', test: T.motor,
    reference: {formula: 'theta > 0.2 rad: the link sinks when tau < m g d', value: 0.2}, tolerance: lower(0), measure: () => motor(0.98)},
  {id: 'robot.spring.period', title: 'Joint stiffness: period of a spring-loaded hinge without gravity', quantity: 'period of a rod on a hinge with stiffness 20 N m/rad, mean over 10 s', unit: 's', test: T.spring,
    reference: {formula: 'T = 2 pi sqrt(I_pivot / k)', value: null}, tolerance: relative(2e-3),
    measure: async () => { const r = await spring(20, 0, 0.2, 10, 0); return {value: r.period, reference: 2 * Math.PI * Math.sqrt(r.pivot / 20)}; }},
  {id: 'robot.spring.numerical-damping', title: 'Joint stiffness: the spring damps numerically', quantity: 'decay rate of the swing of the undamped spring-loaded hinge', unit: '1/s', test: T.spring,
    reference: {formula: 'rate = 0 for an ideal spring', value: 0}, tolerance: upper(0.12), note: 'The joint spring is integrated implicitly. Here it loses amplitude as a damping of 0.042 N m s/rad would: about 2 k dt, with dt the sub-step.',
    measure: async () => (await spring(20, 0, 0.2, 10, 0)).decay},
  {id: 'robot.damping.decay', title: 'Joint damping: decay of a damped pendulum', quantity: 'decay rate of the swing of a rod on a hinge with damping 0.3 N m s/rad, under gravity', unit: '1/s', test: T.spring,
    reference: {formula: 'rate = c / (2 I_pivot)', value: null}, tolerance: relative(0.01), measure: async () => { const r = await spring(0, 0.3, 0.15, 8, -G); return {value: r.decay, reference: 0.3 / (2 * r.pivot)}; }},
  {id: 'robot.arm.hold-motors', title: 'Six-joint arm held by zero-speed motors', quantity: 'largest displacement of the tool frame from its kinematic pose in 5 s (16.8 kg arm, 1 m reach)', unit: 'm', test: T.hold,
    reference: {formula: 'displacement = 0 for rigid joints', value: 0}, tolerance: upper(0.03), note: 'Joint constraints are soft in the engine (60 Hz), so the arm settles below its kinematic pose.', measure: async () => (await hold('motors')).worst},
  {id: 'robot.arm.hold-motors-settled', title: 'Six-joint arm held by zero-speed motors: where it settles', quantity: 'displacement of the tool frame after 5 s', unit: 'm', test: T.hold,
    reference: {formula: 'displacement = 0 for rigid joints', value: 0}, tolerance: upper(0.03), measure: async () => (await hold('motors')).settled},
  {id: 'robot.arm.hold-springs', title: 'Six-joint arm held by 60 Hz joint springs', quantity: 'largest displacement of the tool frame from its kinematic pose in 5 s', unit: 'm', test: T.hold,
    reference: {formula: 'displacement = 0 for rigid joints and infinitely stiff springs', value: 0}, tolerance: upper(0.05), note: 'The springs add their own sag to that of the joints.', measure: async () => (await hold('springs')).worst},
  {id: 'robot.arm.joint-gap', title: 'Six-joint arm: how far the joints are pulled apart', quantity: 'largest distance between the two sides of a joint anchor in 5 s, motors holding', unit: 'm', test: T.hold,
    reference: {formula: 'gap = 0 for exact constraints', value: 0}, tolerance: upper(2e-3), measure: async () => (await hold('motors')).gap},
  {id: 'robot.chain.rest-gap', title: '12-link hanging chain: joint gap at rest', quantity: 'largest anchor gap of the chain hanging still (the hinge that carries ten links)', unit: 'm', test: T.chain,
    reference: {formula: 'gap = load / (m_reduced (2 pi 60 Hz)^2), the engine\'s 60 Hz soft constraint', value: null}, tolerance: relative(0.15),
    note: 'The estimate uses only the reduced translational mass of the two links at the hinge; it comes out 10% low.', measure: async () => { const r = await chain(12); return {value: r.rest, reference: r.estimate}; }},
  {id: 'robot.chain.swing-gap', title: '12-link chain swinging from 1.2 rad: joint drift', quantity: 'largest anchor gap in 10 s', unit: 'm', test: T.chain,
    reference: {formula: 'gap = 0 for exact constraints', value: 0}, tolerance: upper(6e-3), measure: async () => (await chain(12)).swing},
  {id: 'robot.wheels.rest', title: 'Wheeled cart: rests on its wheels', quantity: 'height of the chassis centre after 2 s on the ground', unit: 'm', test: T.wheels,
    reference: {formula: 'h = wheel radius + 0.05 m', value: 0.15}, tolerance: absolute(1e-3), measure: async () => (await wheels()).height},
  {id: 'robot.wheels.speed', title: 'Wheeled cart: rolls at wheel speed x radius', quantity: 'mean speed over 2 s with the four wheel motors at 5 rad/s', unit: 'm/s', test: T.wheels,
    reference: {formula: 'v = omega r', value: 0.5}, tolerance: relative(0.05), note: 'The wheels are 24-sided prisms, which roll a little slow.', measure: async () => (await wheels()).speed},
  {id: 'robot.round-trip.valid', title: 'Round trip: every example robot is a valid scene', quantity: 'problems validateScene finds in the scenes of the 7 example robots', unit: 'problems', test: T.round,
    reference: {formula: 'validateScene(robotToScene(robot)) = []', value: 0}, tolerance: absolute(0), measure: async () => (await round()).problems},
  {id: 'robot.round-trip.hash', title: 'Round trip: spawnRobot, loadScene and a share link run identically', quantity: 'runs of 150 steps whose exactHash differs from the loaded scene\'s (7 robots x spawnRobot and a share link)', unit: 'runs', test: T.round,
    reference: {formula: 'hash(spawnRobot) = hash(loadScene) = hash(share link)', value: 0}, tolerance: absolute(0), measure: async () => (await round()).mismatches},
]);
