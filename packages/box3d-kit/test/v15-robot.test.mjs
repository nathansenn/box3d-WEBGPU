// Robot import (box3d-webgpu-kit/robot): the XML parser, URDF and MJCF, forward kinematics, the scene a robot
// becomes, and the dynamics of imported robots against closed-form answers in SI worlds.
// Tolerances are stated beside each check; the measured numbers are in docs/ROBOT_IMPORT.md and docs/VALIDATION.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from 'box3d-webgpu-kit';
import {
  parseXML, XMLParseError, XML_LIMITS, parseURDF, parseMJCF, robotKinematics, robotToScene, robotReport, spawnRobot, robotLinkPose, robotTree, normalizeMeshPath,
  twoLinkArmURDF, cartPoleURDF, sixDofArmURDF, wheeledCartURDF, doublePendulumURDF, doublePendulumMJCF, hangingChainURDF, EXAMPLE_ROBOTS,
} from 'box3d-webgpu-kit/robot';
import {validateScene, loadScene, sceneWorldOptions, canonicalize, encodeSceneLink, encodeSceneLinkSync, decodeSceneLink} from 'box3d-webgpu-kit/scene';

const G = 9.81, HZ = 240, SUB = 4;
// The import before the engine had compound bodies and explicit mass data: one welded body per collision shape, and
// inertia from the shapes. Both are still available as options; the tests that measure that policy ask for it.
// The defaults (one compound body per link, the file's inertial applied) are tested in v17-compound.test.mjs.
const OLD = {links: 'welded', inertia: 'shapes'};
/** An empty SI world without the ground slab. */
const si = async (ground = false) => { const world = await createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0]}); world.reset({ground}); return world; };
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * HZ); i++) world.step(); };
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
/** Mean time between downward zero crossings of a sampled signal. */
const periodOf = samples => {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] > 0 && samples[i] <= 0) crossings.push((i - 1 + samples[i - 1] / (samples[i - 1] - samples[i])) / HZ);
  return (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
};
const xmlError = (text, pattern, line, column, limits) => assert.throws(() => parseXML(text, limits), error => {
  assert.ok(error instanceof XMLParseError, `an XMLParseError, got ${error}`);
  assert.equal(error.code, 'INVALID_PAYLOAD');
  assert.match(error.message, pattern);
  assert.deepEqual([error.line, error.column], [line, column], `position of "${error.message}"`);
  return true;
});

// 3 x 3 matrices (row-major) for the independent kinematics.
const mul = (a, b) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]));
const apply = (a, v) => [0, 1, 2].map(i => a[i * 3] * v[0] + a[i * 3 + 1] * v[1] + a[i * 3 + 2] * v[2]);
const RX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const RY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const RZ = t => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
/** URDF roll, pitch, yaw about fixed axes. */
const RPY = ([r, p, y]) => mul(RZ(y), mul(RY(p), RX(r)));
const AXIS = {x: RX, y: RY, z: RZ};
const matrixOf = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
/** Robot axes (Z up) to world axes (Y up): (x, y, z) -> (x, z, -y). */
const UP = [1, 0, 0, 0, 0, 1, 0, -1, 0];
/** Link poses of a serial chain: each row is a joint {xyz, rpy, axis} and q its angle. T_child = T_parent * Trans(xyz) * RPY(rpy) * R(axis, q). */
function chain(rows, q) {
  let p = [0, 0, 0], r = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return rows.map((row, i) => {
    const offset = apply(r, row.xyz);
    p = [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
    r = mul(r, mul(RPY(row.rpy ?? [0, 0, 0]), AXIS[row.axis](q[i])));
    return {name: row.name, p, r};
  });
}
const TWO_LINK = [{name: 'upper_arm', joint: 'shoulder', xyz: [0, 0.1, 0.5], axis: 'y'}, {name: 'forearm', joint: 'elbow', xyz: [0.4, 0.08, 0], axis: 'y'}];
const SIX_DOF = [
  {name: 'turret', joint: 'yaw', xyz: [0, 0, 0.1], axis: 'z'},
  {name: 'upper_arm', joint: 'shoulder', xyz: [0, 0.09, 0.2], rpy: [0, 0.3, 0], axis: 'y'},
  {name: 'forearm', joint: 'elbow', xyz: [0, -0.08, 0.4], rpy: [0, 0.9, 0], axis: 'y'},
  {name: 'wrist', joint: 'forearm_roll', xyz: [0, 0, 0.3], rpy: [0.2, 0, 0.4], axis: 'z'},
  {name: 'hand', joint: 'wrist_pitch', xyz: [0, 0, 0.12], rpy: [0, 0.5, 0], axis: 'y'},
  {name: 'tool', joint: 'tool_roll', xyz: [0, 0, 0.095], rpy: [0, 0, 0.3], axis: 'z'},
];

/** Largest distance between the two sides of any joint anchor: how far the constraints have been pulled apart. */
function anchorGap(world, robot) {
  const rotate = ([x, y, z, w], v) => {
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
  };
  const point = (id, frame) => {
    const p = frame?.position ?? [0, 0, 0];
    if (id === null) return p;
    const state = world.getState(robot.bodies.get(id)), r = rotate(state.rotation, p);
    return [state.position[0] + r[0], state.position[1] + r[1], state.position[2] + r[2]];
  };
  let worst = 0, joint = '';
  for (const one of robot.scene.joints) {
    if (one.type === 'prismatic') continue;   // a slider's anchors are meant to separate
    const a = point(one.bodyA, one.frameA), b = point(one.bodyB, one.frameB), gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (gap > worst) { worst = gap; joint = one.id; }
  }
  return {gap: worst, joint};
}

test('XML: elements, attributes, text, comments, CDATA, the predefined entities and numeric references', () => {
  const root = parseXML(`<?xml version="1.0" encoding="UTF-8"?>
<!-- a robot -->
<!DOCTYPE robot>
<robot name="a &amp; b" note='say "hi"'>
  <link name="base">text &lt;1&gt; &#65;&#x42;&#x1F916; <![CDATA[<raw> & kept]]> tail</link>
  <xacro:arg name="x"/>
  <empty/><!-- between --><last a = "1"
    b="2" />
</robot>
<!-- after -->
`);
  assert.equal(root.name, 'robot');
  assert.deepEqual(root.attributes, {name: 'a & b', note: 'say "hi"'});
  assert.deepEqual(root.children.map(child => child.name), ['link', 'xacro:arg', 'empty', 'last']);
  assert.equal(root.children[0].text, 'text <1> AB\u{1F916} <raw> & kept tail');
  assert.deepEqual(root.children[3].attributes, {a: '1', b: '2'});
  assert.deepEqual([root.line, root.column], [4, 1]);
  assert.deepEqual([root.children[0].line, root.children[0].column], [5, 3]);
  assert.deepEqual([root.children[3].line, root.children[3].column], [7, 27]);
  assert.equal(parseXML('\uFEFF<a>&quot;&apos;</a>').text, '"\'', 'a byte-order mark is skipped');
  assert.equal(parseXML('<a b="x&#10;y"/>').attributes.b, 'x\ny');
  assert.equal(parseXML('<a><b><c/></b></a>').children[0].children[0].name, 'c');
  assert.throws(() => parseXML(42), error => error.code === 'INVALID_PAYLOAD');
});

test('XML: malformed documents are refused with the line and column', () => {
  xmlError('<robot>\n  <link name="a">\n</robot>', /closing tag <\/robot> does not match <link> opened at line 2, column 3/, 3, 1);
  xmlError('<robot>\n  <link name="a"/>\n', /unclosed tag <robot>/, 1, 1);
  xmlError('<robot>\n  <link name="a"', /unclosed tag <link>: the document ends inside it/, 2, 3);
  xmlError('<a>\n <b x="1" x="2"/></a>', /duplicate attribute "x"/, 2, 11);
  xmlError('<a b=1/>', /must be quoted/, 1, 6);
  xmlError('<a b="1/>', /unterminated value of attribute "b"/, 1, 6);
  xmlError('<a b="x<y"/>', /"<" is not allowed/, 1, 8);
  xmlError('<a>ok</a><b/>', /more than one root element/, 1, 10);
  xmlError('<a/>\ntrailing', /text after the root element/, 2, 1);
  xmlError('hello <a/>', /text before the root element/, 1, 1);
  xmlError('</a>', /has no opening tag/, 1, 1);
  xmlError('<a><!-- never closed </a>', /unterminated comment/, 1, 4);
  xmlError('<a><![CDATA[ x </a>', /unterminated CDATA/, 1, 4);
  xmlError('', /no root element/, 1, 1);
  xmlError('<a __proto__="x"/>', /"__proto__" is not allowed/, 1, 4);
  // Entities: only the five predefined names and numeric references. Nothing is ever expanded.
  xmlError('<a>\n  x &nbsp; y</a>', /undefined entity &nbsp;/, 2, 5);
  xmlError('<a b="1 & 2"/>', /"&" must start an entity reference/, 1, 9);
  xmlError('<a>&#0;</a>', /not a legal XML character/, 1, 4);
  xmlError('<a>&#xD800;</a>', /not a legal XML character/, 1, 4);
  xmlError('<a>&#x110000;</a>', /not a legal XML character/, 1, 4);
  xmlError('<a>&#12abc;</a>', /malformed character reference/, 1, 4);
});

test('XML: DOCTYPE entity declarations, external entities, and oversize or over-deep input are refused without expansion', () => {
  // A DOCTYPE that declares an entity: refused at the DOCTYPE, before the reference is even read.
  xmlError('<?xml version="1.0"?>\n<!DOCTYPE robot [\n  <!ENTITY name "value">\n]>\n<robot name="&name;"/>', /DOCTYPE with an internal subset .* is refused/, 2, 1);
  // An external entity (file read / request forgery in a full XML processor).
  xmlError('<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>', /DOCTYPE with an internal subset/, 1, 1);
  // Billion laughs: ten levels of tenfold expansion would be 10^9 "lol"s. It must fail at once, having allocated nothing.
  const levels = Array.from({length: 9}, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`).join('\n');
  const bomb = `<?xml version="1.0"?>\n<!DOCTYPE lolz [\n<!ENTITY lol0 "lol">\n${levels}\n]>\n<lolz>&lol9;</lolz>`;
  const heap = process.memoryUsage().heapUsed;
  xmlError(bomb, /DOCTYPE with an internal subset/, 2, 1);
  assert.ok(process.memoryUsage().heapUsed - heap < 64 * 1024 * 1024, 'refusing the bomb allocates nothing like its expansion');
  // The same reference without the declaration is an undefined entity, not an expansion.
  xmlError('<lolz>&lol9;</lolz>', /undefined entity &lol9;/, 1, 7);
  // Size, depth and node caps.
  xmlError(`<a>${' '.repeat(200)}</a>`, /the document is 207 characters; the limit is 100/, 1, 1, {maxChars: 100});
  const deep = depth => '<a>'.repeat(depth) + '</a>'.repeat(depth);
  assert.equal(parseXML(deep(XML_LIMITS.maxDepth)).name, 'a', 'the depth limit itself is allowed');
  xmlError(deep(XML_LIMITS.maxDepth + 1), /nested deeper than 64 levels/, 1, XML_LIMITS.maxDepth * 3 + 1);
  xmlError('<a>\n' + '<b/>'.repeat(10) + '</a>', /more than 8 elements/, 2, 29, {maxNodes: 8});
  xmlError(`<a ${Array.from({length: 5}, (_, i) => `k${i}="1"`).join(' ')}/>`, /more than 4 attributes/, 1, 32, {maxAttributes: 4});
  // A very deep document must fail on the cap, not on the JavaScript stack.
  xmlError(deep(100000), /nested deeper than 64 levels/, 1, 193);
});

test('URDF: links, joints and the tree are read; a broken tree or a bad value is refused by name and position', () => {
  const arm = parseURDF(sixDofArmURDF());
  assert.equal(arm.name, 'six-dof-arm');
  assert.equal(arm.source, 'urdf');
  assert.equal(arm.root, 'base');
  assert.deepEqual(arm.links.map(link => link.name), ['base', 'turret', 'upper_arm', 'forearm', 'wrist', 'hand', 'tool']);
  assert.deepEqual(arm.joints.map(joint => joint.type), Array(6).fill('revolute'));
  assert.equal(arm.links[0].color, 0x8C99AD, 'the first visual colour is kept');
  const elbow = arm.joints[2];
  assert.deepEqual([elbow.parent, elbow.child, elbow.axis, elbow.limits, elbow.effort, elbow.velocity], ['upper_arm', 'forearm', [0, 1, 0], {lower: -2.5, upper: 2.5}, 80, 3]);
  assert.deepEqual(elbow.origin.xyz, [0, -0.08, 0.4]);
  // rpy = (0, 0.9, 0) is a rotation of 0.9 rad about y.
  elbow.origin.quat.forEach((v, i) => near(v, [0, Math.sin(0.45), 0, Math.cos(0.45)][i], 1e-15, 'pitch quaternion'));
  assert.equal(arm.joints[0].damping, 0.5);
  const tool = arm.links.at(-1);
  assert.deepEqual(tool.inertial, {mass: 0.3, origin: {xyz: [0.012, 0, 0.035], quat: [0, 0, 0, 1]}, inertia: [0.0003, 0, -0.00003, 0.00035, 0, 0.0002]});
  assert.deepEqual(tool.collisions.map(c => [c.name, c.geometry]), [['palm', {type: 'box', size: [0.1, 0.06, 0.04]}], ['finger', {type: 'box', size: [0.02, 0.06, 0.06]}]]);
  assert.deepEqual(arm.warnings, [], 'the example uses nothing unsupported');
  const tree = robotTree(arm);
  assert.deepEqual(tree.order, arm.links.map(link => link.name));
  assert.equal(tree.parentJoint.get('tool').name, 'tool_roll');

  const robot = body => `<robot name="t">${body}</robot>`, link = name => `<link name="${name}"/>`;
  const joint = (name, parent, child, extra = '', type = 'fixed') => `<joint name="${name}" type="${type}"><parent link="${parent}"/><child link="${child}"/>${extra}</joint>`;
  const refused = (text, pattern) => assert.throws(() => parseURDF(text), error => { assert.equal(error.code, 'INVALID_PAYLOAD'); assert.match(error.message, pattern); return true; });
  refused('<mujoco/>', /URDF line 1, column 1: <mujoco> is not a URDF/);
  refused(robot(''), /has no <link>/);
  refused(robot(link('a') + link('a')), /duplicate link name "a"/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'nowhere')), /joint "j" names the child link "nowhere", which does not exist/);
  refused(robot(link('a') + link('b') + joint('j', 'ghost', 'b')), /joint "j" names the parent link "ghost", which does not exist/);
  refused(robot(link('a') + link('b')), /exactly one root link, found 2: "a", "b"/);
  refused(robot(link('a') + link('b') + joint('j1', 'a', 'b') + joint('j2', 'b', 'a')), /form a cycle and there is no root link/);
  refused(robot(link('r') + link('a') + link('b') + joint('j1', 'a', 'b') + joint('j2', 'b', 'a')), /link "a" is the child of|not reachable from the root "r": "a", "b"/);
  refused(robot(link('r') + link('a') + joint('j1', 'r', 'a') + joint('j2', 'r', 'a')), /link "a" is the child of two joints, "j1" and "j2"; closed loops are not supported/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'b') + joint('j', 'a', 'b')), /duplicate joint name "j"/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'b', '', 'screw')), /type must be fixed, revolute, continuous, prismatic, floating or planar, got "screw"/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'b', '<axis xyz="0 0 0"/>', 'revolute')), /must not be the zero vector/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'b', '<limit lower="1" upper="0"/>', 'revolute')), /upper \(0\) is below lower \(1\)/);
  refused(robot(link('a') + link('b') + joint('j', 'a', 'b', '<origin xyz="0 0"/>')), /xyz="0 0" must hold 3 numbers, got 2/);
  refused(robot('\n<link name="a"><inertial><mass value="heavy"/></inertial></link>'), /URDF line 2, column 26: <mass> value="heavy": "heavy" is not a finite number/);
  refused(robot('<link name="a"><collision><geometry><box size="1 -1 1"/></geometry></collision></link>'), /size must be positive/);
  refused(robot('<link name="a"><collision><geometry><cone radius="1"/></geometry></collision></link>'), /not a collision shape this import reads/);
  // Malformed XML keeps its own error type and position.
  assert.throws(() => parseURDF('<robot name="t">\n<link name="a">'), error => error instanceof XMLParseError && error.line === 2 && error.column === 1);
});

test('URDF: unsupported elements load and are listed precisely, never silently', () => {
  const urdf = `<robot name="gripper">
  <link name="palm"><inertial><mass value="1"/><inertia ixx="0.01" iyy="0.01" izz="0.01"/></inertial><collision><geometry><box size="0.1 0.1 0.1"/></geometry></collision></link>
  <link name="left"><inertial><mass value="0.1"/><inertia ixx="0.001" iyy="0.001" izz="0.001"/></inertial><collision><geometry><box size="0.02 0.02 0.1"/></geometry></collision></link>
  <link name="right"><inertial><mass value="0.1"/><inertia ixx="0.001" iyy="0.001" izz="0.001"/></inertial><collision><geometry><box size="0.02 0.02 0.1"/></geometry></collision></link>
  <link name="puck"><inertial><mass value="0.2"/><inertia ixx="0.001" iyy="0.001" izz="0.001"/></inertial><collision><geometry><cylinder radius="0.05" length="0.02"/></geometry></collision></link>
  <link name="lens"><visual><geometry><sphere radius="0.01"/></geometry></visual></link>
  <joint name="left_slide" type="prismatic"><parent link="palm"/><child link="left"/><origin xyz="0.04 0 0.1"/><axis xyz="1 0 0"/><limit lower="0" upper="0.03" effort="20" velocity="0.1"/></joint>
  <joint name="right_slide" type="prismatic"><parent link="palm"/><child link="right"/><origin xyz="-0.04 0 0.1"/><axis xyz="-1 0 0"/><limit lower="0" upper="0.03" effort="20" velocity="0.1"/>
    <mimic joint="left_slide" multiplier="1"/><calibration rising="0"/><safety_controller k_velocity="1"/></joint>
  <joint name="table" type="planar"><parent link="palm"/><child link="puck"/><origin xyz="0 0.3 0"/><axis xyz="0 0 1"/></joint>
  <joint name="camera" type="fixed"><parent link="palm"/><child link="lens"/></joint>
  <joint name="loose" type="revolute"><parent link="palm"/><child link="spare"/></joint>
  <link name="spare"><inertial><mass value="0.1"/><inertia ixx="0.001" iyy="0.001" izz="0.001"/></inertial></link>
  <transmission name="left_trans"><type>transmission_interface/SimpleTransmission</type></transmission>
  <gazebo reference="palm"><material>Gazebo/Grey</material></gazebo>
  <sensor name="imu"/>
</robot>`;
  const robot = parseURDF(urdf);
  assert.deepEqual(robot.warnings.map(w => [w.code, w.element, w.message, w.line]), [
    ['note', 'link "lens"', 'has visual geometry but no collision geometry: it collides with nothing', 6],
    ['unsupported', 'joint "right_slide" <mimic>', 'mimic joints are not supported: "right_slide" moves independently of "left_slide"', 9],
    ['ignored', 'joint "right_slide" <calibration>', 'not used by the simulation; ignored', 9],
    ['ignored', 'joint "right_slide" <safety_controller>', 'not used by the simulation; ignored', 9],
    ['unsupported', 'joint "table"', 'planar joints are not supported: link "puck" is left free (6 degrees of freedom instead of 3)', 10],
    ['note', 'joint "loose"', 'a revolute joint needs a <limit>; none was given, so the joint is left unlimited', 12],
    ['ignored', '<transmission> "left_trans"', 'simulator-specific element; ignored', 14],
    ['ignored', '<gazebo> for "palm"', 'simulator-specific element; ignored', 15],
    ['ignored', '<sensor>', 'unknown element; ignored', 16],
  ]);
  assert.equal(robot.joints.find(joint => joint.name === 'table').supported, false);
  // The scene is still built: the planar child is free, the mimic joint is an ordinary slider, the frame-only lens has no body.
  const scene = robotToScene(robot, OLD), report = robotReport(robot, OLD);
  assert.deepEqual(validateScene(scene), []);
  assert.deepEqual(scene.joints.map(joint => [joint.id, joint.type]), [['palm.base', 'weld'], ['left_slide', 'prismatic'], ['right_slide', 'prismatic'], ['loose', 'revolute']]);
  assert.deepEqual(report.joints.find(joint => joint.joint === 'table'), {joint: 'table', type: 'planar', id: null, as: 'none'});
  assert.deepEqual(report.links.find(link => link.link === 'lens').kind, 'frame');
  assert.equal(report.links.find(link => link.link === 'spare').kind, 'inertia-box');
  // The conversion keeps every parser warning and adds one of its own: these made-up inertia tensors are far from the boxes'.
  assert.deepEqual(report.warnings.slice(0, robot.warnings.length), robot.warnings);
  assert.deepEqual(report.warnings.slice(robot.warnings.length).map(w => [w.code, w.element]), [['note', 'robot "gripper"']]);
  assert.match(report.warnings.at(-1).message, /the bodies' inertia differs from the file's by up to 99\.3% of a principal moment \(link "left"\)/);
  // By default the file's inertia is applied instead, and the conversion has nothing to add.
  assert.deepEqual(robotReport(robot).warnings, robot.warnings);
  // strict: the first warning is an error instead.
  assert.throws(() => parseURDF(urdf, {strict: true}), /URDF line 6, column 3: link "lens": has visual geometry but no collision geometry.*\(strict mode\)/);
});

test('URDF meshes come from the supplied map by a normalised name; a missing file is an error naming it, or a reported box', () => {
  const cube = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
    'f 1 3 2', 'f 1 4 3', 'f 5 6 7', 'f 5 7 8', 'f 1 2 6', 'f 1 6 5', 'f 2 3 7', 'f 2 7 6', 'f 3 4 8', 'f 3 8 7', 'f 4 1 5', 'f 4 5 8'].join('\n');
  const urdf = (filename, scale = '0.2 0.1 0.4') => `<robot name="m"><link name="block">
    <inertial><origin xyz="0.1 0.05 0.2"/><mass value="4"/><inertia ixx="${4 * (0.01 + 0.16) / 12}" iyy="${4 * (0.04 + 0.16) / 12}" izz="${4 * (0.04 + 0.01) / 12}"/></inertial>
    <collision><geometry><mesh filename="${filename}" scale="${scale}"/></geometry></collision></link></robot>`;
  assert.equal(normalizeMeshPath('package://arm/meshes/./x/../hand.stl'), 'arm/meshes/hand.stl');
  assert.equal(normalizeMeshPath('C:\\robots\\hand.STL'), 'C:/robots/hand.STL');
  assert.equal(normalizeMeshPath('file:///tmp/a.obj'), 'tmp/a.obj');
  // The same file found four ways: exact key, normalised, by trailing segments of the request, and of the key.
  for (const [filename, key] of [['package://arm/meshes/block.obj', 'package://arm/meshes/block.obj'], ['package://arm/meshes/block.obj', 'arm/meshes/block.obj'],
    ['package://arm/meshes/block.obj', 'block.obj'], ['meshes/block.obj', '/home/me/ws/src/arm/meshes/block.obj'], ['../meshes/block.obj', new Map([['meshes/block.obj', cube]])]]) {
    const robot = parseURDF(urdf(filename), {meshes: typeof key === 'string' ? {[key]: cube} : key}), geometry = robot.links[0].collisions[0].geometry;
    assert.equal(geometry.type, 'mesh');
    assert.equal(geometry.points.length, 24, 'the hull of a scaled cube has 8 points');
    assert.deepEqual([Math.max(...geometry.points.filter((_, i) => i % 3 === 0)), Math.max(...geometry.points.filter((_, i) => i % 3 === 1)), Math.max(...geometry.points.filter((_, i) => i % 3 === 2))].map(v => +v.toFixed(6)), [0.2, 0.1, 0.4]);
    assert.deepEqual(robot.warnings.map(w => [w.code, w.element]), [['approximated', `link "block" mesh "${filename}"`]]);
    // The hull is the box itself, so mass and inertia are the file's: the body sits at the box centre.
    const report = robotReport(robot), scene = robotToScene(robot, {up: 'y'});
    within(report.links[0].massActual, 4, 1e-6, 'mass');   // the hull's corners are float32
    assert.ok(report.links[0].maxPrincipalError < 1e-6 && report.links[0].comOffset < 1e-7, `inertia ${report.links[0].maxPrincipalError}, centre ${report.links[0].comOffset}`);
    scene.bodies[0].position.forEach((v, i) => near(v, [0.1, 0.05, 0.2][i], 1e-7, 'the body origin is the centre of mass'));
    assert.deepEqual(validateScene(scene), []);
  }
  // Binary STL bytes work too (one tetrahedron).
  const stl = new Uint8Array(84 + 4 * 50), view = new DataView(stl.buffer), corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  view.setUint32(80, 4, true);
  [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]].forEach((face, t) => face.forEach((corner, k) => corners[corner].forEach((value, axis) => view.setFloat32(84 + t * 50 + 12 + k * 12 + axis * 4, value, true))));
  const tetra = parseURDF(urdf('tetra.stl', '1 1 1'), {meshes: {'tetra.stl': stl}});
  assert.equal(tetra.links[0].collisions[0].geometry.points.length, 12);
  within(robotReport(tetra).links[0].volume, 1 / 6, 1e-9, 'tetrahedron volume');
  // Missing, ambiguous, unreadable.
  assert.throws(() => parseURDF(urdf('package://arm/meshes/block.obj')), /URDF line 3, column 26: <mesh> mesh "package:\/\/arm\/meshes\/block.obj" was not supplied: add it to the meshes option \(looked for "arm\/meshes\/block.obj"\)/);
  assert.throws(() => parseURDF(urdf('block.obj'), {meshes: {'a/block.obj': cube, 'b/block.obj': cube}}), /matches more than one supplied file: "a\/block.obj", "b\/block.obj"/);
  assert.throws(() => parseURDF(urdf('block.dae'), {meshes: {'block.dae': '<COLLADA/>'}}), /mesh "block.dae": ".dae" files are not supported; convert the mesh to OBJ, STL or GLB/);
  assert.throws(() => parseURDF(urdf('block.obj'), {meshes: {'block.obj': 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'}}), /mesh "block.obj": .*coplanar/);
  // missingMeshes: 'box' stands a box in and says so. With an inertial, it is the box with that mass and inertia: here the true one.
  const stood = parseURDF(urdf('package://arm/meshes/block.obj'), {missingMeshes: 'box'});
  assert.deepEqual(stood.links[0].collisions[0].geometry, {type: 'missing-mesh', filename: 'package://arm/meshes/block.obj', scale: [0.2, 0.1, 0.4]});
  assert.deepEqual(stood.warnings.map(w => [w.code, w.element]), [['approximated', 'link "block" mesh "package://arm/meshes/block.obj"']]);
  assert.match(stood.warnings[0].message, /the mesh file was not supplied; a box takes its place/);
  const box = robotToScene(stood, {up: 'y'}).bodies[0];
  [...box.shape.halfExtents].sort().forEach((v, i) => near(v, [0.05, 0.1, 0.2][i], 1e-9, 'inertia box half extents'));
  near(robotReport(stood).links[0].maxPrincipalError, 0, 1e-9, 'the stand-in box has the file\'s inertia');
});

test('MJCF: defaults, compiler settings, geoms, joints and actuators are read; unsupported elements are listed precisely', () => {
  const mjcf = `<mujoco model="rich">
  <compiler angle="degree" eulerseq="XYZ" meshdir="assets"/>
  <option gravity="0 0 -3.7" timestep="0.004" integrator="RK4"/>
  <default>
    <joint damping="0.2"/>
    <geom density="500" friction="0.8 0.005 0.0001"/>
    <default class="arm">
      <default class="wrist"><joint range="-45 45"/></default>
      <joint range="-90 90" damping="0.4"/>
      <geom type="capsule" size="0.03"/>
    </default>
  </default>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <geom name="post" type="box" pos="1 0 0.5" size="0.1 0.1 0.5"/>
    <light pos="0 0 3"/>
    <body name="upper" pos="0 0 1" euler="0 90 0" childclass="arm">
      <joint name="j1" axis="0 1 0" armature="0.01"/>
      <geom fromto="0 0 0 0 0 0.4"/>
      <body name="lower" pos="0 0 0.4">
        <joint name="j2" class="wrist" axis="1 0 0" stiffness="3" springref="10" frictionloss="0.05"/>
        <geom fromto="0 0 0 0.3 0 0"/>
        <geom name="tip" class="main" type="ellipsoid" pos="0.3 0 0" size="0.05 0.04 0.03" condim="4"/>
        <site name="tcp" pos="0.3 0 0"/>
      </body>
    </body>
    <body name="ball" pos="2 0 1"><freejoint/><geom type="sphere" size="0.1" mass="2"/></body>
    <body name="pin" pos="3 0 1"><geom type="cylinder" size="0.02 0.1" rgba="1 0 0 1"/></body>
    <body name="hip" pos="4 0 1"><joint name="hx" axis="1 0 0"/><joint name="hy" axis="0 1 0"/><joint name="hz" axis="0 0 1"/><geom type="sphere" size="0.05"/></body>
    <body name="slider" pos="5 0 1"><joint name="sx" type="slide" axis="1 0 0"/><joint name="sy" type="slide" axis="0 1 0"/><geom type="sphere" size="0.05"/></body>
  </worldbody>
  <actuator>
    <motor name="m1" joint="j1" gear="50" ctrlrange="-1 1"/>
    <position name="p2" joint="j2" kp="20" kv="1"/>
    <velocity name="v1" joint="j1" kv="0.3"/>
    <general name="g1" joint="j1"/>
    <motor name="mt" tendon="t1"/>
    <motor name="mh" joint="hy"/>
  </actuator>
  <tendon><fixed name="t1"><joint joint="j1" coef="1"/></fixed></tendon>
  <equality><joint name="couple" joint1="j1" joint2="j2"/><weld body1="ball" body2="pin"/></equality>
  <contact><exclude body1="upper" body2="lower"/><exclude body1="upper" body2="ball"/></contact>
  <sensor><jointpos joint="j1"/></sensor>
</mujoco>`;
  const robot = parseMJCF(mjcf), link = name => robot.links.find(one => one.name === name), joint = name => robot.joints.find(one => one.name === name);
  assert.deepEqual([robot.name, robot.source, robot.root], ['rich', 'mjcf', 'world']);
  assert.deepEqual(robot.world, {ground: true, gravity: [0, 0, -3.7], timestep: 0.004});
  assert.deepEqual(robot.links.map(one => one.name), ['world', 'upper', 'lower', 'ball', 'pin', 'hip', 'slider']);
  assert.equal(link('world').isWorld, true);
  assert.deepEqual(link('world').collisions.map(c => [c.name, c.geometry]), [['post', {type: 'box', size: [0.2, 0.2, 1]}]], 'the horizontal plane through the origin is the ground, not a shape');
  // euler="0 90 0" in degrees about fixed axes: a quarter turn about y.
  joint('j1').origin.quat.forEach((v, i) => near(v, [0, Math.SQRT1_2, 0, Math.SQRT1_2][i], 1e-15, 'body euler'));
  // Class "arm" gives j1 its range and damping; class "wrist" inherits arm's damping, written after it, and narrows the range.
  assert.deepEqual([joint('j1').type, joint('j1').parent, joint('j1').child, joint('j1').axis], ['revolute', 'world', 'upper', [0, 1, 0]]);
  near(joint('j1').limits.upper, Math.PI / 2, 1e-15, 'j1 range in radians'); near(joint('j1').limits.lower, -Math.PI / 2, 1e-15, 'j1 range');
  near(joint('j2').limits.upper, Math.PI / 4, 1e-15, 'j2 range from the nested class');
  near(joint('j1').damping, 0.4 + 0.3, 1e-15, 'class damping plus the velocity servo');
  assert.deepEqual([joint('j2').damping, joint('j2').stiffness, joint('j2').friction, joint('j1').armature], [0.4, 3, 0.05, 0.01]);
  near(joint('j2').springRef, 10 * Math.PI / 180, 1e-15, 'springref in radians');
  assert.deepEqual([joint('j1').effort, joint('j2').servo], [50, {kp: 20, kv: 1}]);
  // Capsule from the class, placed by fromto: radius 0.03, 0.4 m between cap centres, density 500.
  const capsule = link('upper').collisions[0];
  assert.deepEqual([capsule.geometry, capsule.origin.xyz, capsule.friction], [{type: 'capsule', radius: 0.03, length: 0.4}, [0, 0, 0.2], 0.8]);
  within(capsule.mass, 500 * (Math.PI * 0.03 ** 2 * 0.4 + 4 / 3 * Math.PI * 0.03 ** 3), 1e-12, 'capsule mass = density x volume');
  within(link('upper').inertial.mass, capsule.mass, 1e-15, 'a body without <inertial> takes its mass from its geoms');
  assert.equal(link('upper').inertial.derived, true);
  // fromto along x: the shape's z axis is turned onto x.
  const along = link('lower').collisions[0];
  assert.deepEqual(along.origin.xyz, [0.15, 0, 0]);
  along.origin.quat.forEach((v, i) => near(v, [0, Math.SQRT1_2, 0, Math.SQRT1_2][i], 1e-12, 'fromto orientation'));
  // The ellipsoid uses the main class: density 500, and its own type.
  const tip = link('lower').collisions[1];
  assert.deepEqual(tip.geometry, {type: 'ellipsoid', radii: [0.05, 0.04, 0.03]});
  within(tip.mass, 500 * 4 / 3 * Math.PI * 0.05 * 0.04 * 0.03, 1e-12, 'ellipsoid mass');
  // The centre of mass and inertia of "lower" from its two geoms, by hand.
  const m1 = along.mass, m2 = tip.mass, cx = (m1 * 0.15 + m2 * 0.3) / (m1 + m2);
  link('lower').inertial.origin.xyz.forEach((v, i) => near(v, [cx, 0, 0][i], 1e-15, 'derived centre of mass'));
  const vc = Math.PI * 0.03 ** 2 * 0.3, vs = 4 / 3 * Math.PI * 0.03 ** 3, rho = 500;
  const capAlong = rho * (vc * 0.03 ** 2 / 2 + vs * 0.4 * 0.03 ** 2), capAcross = rho * (vc * (3 * 0.03 ** 2 + 0.3 ** 2) / 12 + vs * (0.4 * 0.03 ** 2 + 0.3 ** 2 / 4 + 3 * 0.3 * 0.03 / 8));
  const [ixx, , , iyy, , izz] = link('lower').inertial.inertia;
  within(ixx, capAlong + m2 * (0.04 ** 2 + 0.03 ** 2) / 5, 1e-12, 'derived ixx');
  within(iyy, capAcross + m1 * (cx - 0.15) ** 2 + m2 * (0.05 ** 2 + 0.03 ** 2) / 5 + m2 * (0.3 - cx) ** 2, 1e-12, 'derived iyy');
  within(izz, capAcross + m1 * (cx - 0.15) ** 2 + m2 * (0.05 ** 2 + 0.04 ** 2) / 5 + m2 * (0.3 - cx) ** 2, 1e-12, 'derived izz');
  assert.deepEqual([joint('ball_joint').type, link('ball').inertial.mass], ['floating', 2]);
  assert.deepEqual([joint('pin_fixed').type, link('pin').collisions[0].color], ['fixed', 0xFF0000], 'a body without a joint is fixed to its parent');
  assert.deepEqual([joint('hx').type, joint('sx').type, joint('hy'), joint('sy')], ['spherical', 'prismatic', undefined, undefined]);
  assert.deepEqual(robot.warnings.map(w => [w.code, w.element, w.message, w.line]), [
    ['ignored', '<option>', 'attribute not used by this import: integrator', 3],
    ['note', 'joint "j1"', 'armature 0.01 (rotor inertia) is recorded but not modelled', 18],
    ['ignored', 'geom "tip" of body "lower"', 'attribute not used by this import: condim', 23],
    ['approximated', 'geom "tip" of body "lower"', 'an ellipsoid is represented by a 42-point convex hull of the same volume', 23],
    ['approximated', 'body "hip"', 'the three hinge joints "hx", "hy", "hz" at one point are represented by one ball joint named "hx"; their ranges, damping, stiffness and actuators are dropped', 29],
    ['unsupported', 'body "slider"', 'has 2 joints ("sx", "sy"); only one joint per body is supported, so only "sx" is used and the body loses the other degrees of freedom', 30],
    ['note', 'actuator <motor> "m1"', 'a torque source: its limit (50) is recorded as the effort of joint "j1"; drive the joint with the motors option or setJointMotor', 33],
    ['approximated', 'actuator <velocity> "v1"', 'a velocity servo at zero command is a damper: 0.3 is added to the damping of joint "j1"', 35],
    ['unsupported', 'actuator <general> "g1"', '<general> actuators are not imported', 36],
    ['unsupported', 'actuator <motor> "mt"', 'only actuators on a joint are imported (this one acts on tendon)', 37],
    ['unsupported', 'actuator <motor> "mh"', 'acts on joint "hy", which was dropped', 38],
    ['unsupported', 'tendon <fixed> "t1"', 'tendons are not imported: it applies no force and no limit', 40],
    ['unsupported', 'equality <joint> "couple"', 'equality constraints are not imported: the bodies or joints it ties move independently', 41],
    ['unsupported', 'equality <weld>', 'equality constraints are not imported: the bodies or joints it ties move independently', 41],
    ['unsupported', 'contact <exclude> body1="upper" body2="ball"', 'only links joined by a joint are excluded from colliding; these two can collide (selfCollision: false stops all self-collision)', 42],
    ['ignored', '<sensor>', 'not used by this import (1 element inside)', 43],
  ]);

  // The scene: gravity and the step from <option>, the ground from the plane, a static post, and the joint mapping.
  const scene = robotToScene(robot, OLD), report = robotReport(robot, OLD);
  assert.deepEqual(validateScene(scene), []);
  assert.deepEqual(scene.world, {gravity: [0, -3.7, 0], ground: true, step: 0.004});
  assert.deepEqual(scene.bodies.map(body => [body.id, body.shape.kind, body.type ?? 'dynamic']), [['post', 'box', 'static'], ['upper', 'capsule', 'dynamic'], ['lower', 'capsule', 'dynamic'],
    ['lower.2', 'hull', 'dynamic'], ['ball', 'sphere', 'dynamic'], ['pin', 'hull', 'dynamic'], ['hip', 'sphere', 'dynamic'], ['slider', 'sphere', 'dynamic']]);
  assert.deepEqual(scene.joints.map(one => [one.id, one.type, one.bodyA, one.bodyB]), [['j1', 'revolute', null, 'upper'], ['j2', 'revolute', 'upper', 'lower'], ['lower.weld2', 'weld', 'lower', 'lower.2'],
    ['pin_fixed', 'weld', null, 'pin'], ['hx', 'spherical', null, 'hip'], ['sx', 'prismatic', null, 'slider']]);
  assert.equal(scene.bodies[1].friction, 0.8);
  // j2: the file's spring (3 towards 10 degrees) and the servo (20 towards 0) are one spring of 23 towards their weighted mean; dry friction is a zero-speed motor.
  const j2 = report.joints.find(one => one.joint === 'j2'), sceneJ2 = scene.joints[1];
  within(j2.spring.stiffness, 23, 1e-12, 'combined stiffness');
  within(j2.spring.damping, 0.4 + 1, 1e-12, 'combined damping');
  within(j2.spring.target, 3 * (10 * Math.PI / 180) / 23, 1e-12, 'combined target');
  within(sceneJ2.spring.hertz, Math.sqrt(23 / j2.spring.effectiveMass) / (2 * Math.PI), 1e-12, 'hertz from the effective mass');
  within(sceneJ2.spring.dampingRatio, 1.4 / (2 * Math.sqrt(23 * j2.spring.effectiveMass)), 1e-12, 'damping ratio');
  assert.deepEqual(sceneJ2.motor, {speed: 0, maxForce: 0.05});
  assert.deepEqual(sceneJ2.userData, {joint: 'j2'});
  assert.deepEqual(scene.joints[0].userData, {joint: 'j1', effort: 50});
  // The ellipsoid and the cylinder are stand-ins with a stated error: same volume, inertia within 3% and 0.01%.
  const stand = Object.fromEntries(report.shapes.map(shape => [shape.body, shape]));
  assert.deepEqual([stand['lower.2'].as, stand.pin.as], ['42-point hull of the same volume', '24-sided prism of the same volume']);
  assert.ok(Math.abs(stand['lower.2'].volumeError) < 1e-6 && stand['lower.2'].inertiaError < 0.03, `ellipsoid ${JSON.stringify(stand['lower.2'])}`);
  assert.ok(Math.abs(stand.pin.volumeError) < 1e-6 && stand.pin.inertiaError < 1e-4, `cylinder ${JSON.stringify(stand.pin)}`);
  // Derived mass is reproduced per shape, so every link's mass and inertia match what MuJoCo would compute from the geoms (the hull stand-ins apart).
  for (const one of report.links) if (one.mass > 0) { within(one.massActual, one.mass, 1e-6, `${one.link} mass`); assert.ok(one.maxPrincipalError < 0.01, `${one.link} inertia error ${one.maxPrincipalError}`); }

  const refused = (text, pattern) => assert.throws(() => parseMJCF(text), error => { assert.equal(error.code, 'INVALID_PAYLOAD'); assert.match(error.message, pattern); return true; });
  refused('<robot/>', /MJCF line 1, column 1: <robot> is not an MJCF model/);
  refused('<mujoco/>', /has no <worldbody>/);
  refused('<mujoco><compiler coordinate="global"/><worldbody/></mujoco>', /coordinate="global" is not supported/);
  refused('<mujoco><worldbody><body name="a"><geom class="nope"/></body></worldbody></mujoco>', /uses the default class "nope", which is not defined/);
  refused('<mujoco><worldbody><body name="a"/><body name="a"/></worldbody></mujoco>', /duplicate body name "a"/);
  refused('<mujoco><worldbody><body name="a"><geom type="box" size="1 1"/></body></worldbody></mujoco>', /a box needs 3 size values, got 2/);
  refused('<mujoco><worldbody><body name="a"><geom type="mesh" mesh="m"/></body></worldbody></mujoco>', /the mesh asset "m" is not defined/);
  refused('<mujoco><worldbody><body name="a"><body name="b"><freejoint/></body></body></worldbody></mujoco>', /a free joint must be on a body directly inside <worldbody>/);
  refused('<mujoco><worldbody><body name="a"><joint name="j"/><geom size="1"/></body></worldbody><actuator><motor joint="k"/></actuator></mujoco>', /acts on joint "k", which does not exist/);
  // Radians, lower-case (moving-axis) Euler angles, and a quaternion written w first.
  const turned = parseMJCF('<mujoco><compiler angle="radian" eulerseq="zyx"/><worldbody><body name="a" euler="0.3 0.2 0.1"><geom size="1"/></body><body name="b" quat="0 1 0 0"><geom size="1"/></body></worldbody></mujoco>');
  const expected = mul(RZ(0.3), mul(RY(0.2), RX(0.1))), got = matrixOf(turned.joints[0].origin.quat);
  got.forEach((v, i) => near(v, expected[i], 1e-15, 'euler zyx'));
  assert.deepEqual(turned.joints[1].origin.quat, [1, 0, 0, 0]);
  assert.deepEqual(turned.world, {ground: false}, 'no plane, no ground');
});

test('forward kinematics: link poses of the two-link and six-joint arms equal the product of joint transforms to 1e-6', async () => {
  const world = await si();
  try {
    let worstPure = 0, worstBody = 0, checked = 0;
    for (const [text, rows, configurations] of [
      [twoLinkArmURDF(), TWO_LINK, [[0, 0], [0.7, -1.1], [-2.6, 2.4], [1.234, 0.321]]],
      [sixDofArmURDF(), SIX_DOF, [[0, 0, 0, 0, 0, 0], [0.4, -0.7, 1.1, -0.9, 0.6, 2.2], [-3, 2, -2.5, 3, -2, -3], [1.5, 0.25, -0.5, 0.75, 1, -1.25]]],
    ]) {
      const robot = parseURDF(text);
      for (const q of configurations) {
        const positions = Object.fromEntries(rows.map((row, i) => [row.joint, q[i]])), expected = chain(rows, q), poses = robotKinematics(robot, positions);
        world.reset({ground: false});
        const spawned = spawnRobot(world, robot, {positions, position: [0.5, 1, -0.25]});
        for (const link of expected) {
          // The pure function, in the robot's own axes.
          const pure = poses.get(link.name), rotation = matrixOf(pure.quat);
          worstPure = Math.max(worstPure, ...pure.xyz.map((v, i) => Math.abs(v - link.p[i])), ...rotation.map((v, i) => Math.abs(v - link.r[i])));
          // The bodies in the world (float32), mapped to Y up and moved to `position`.
          const handle = spawned.links.get(link.name), actual = robotLinkPose(world.getState(handle.body), handle.frame);
          const at = apply(UP, link.p), turn = mul(UP, link.r), turnActual = matrixOf(actual.rotation);
          worstBody = Math.max(worstBody, ...actual.position.map((v, i) => Math.abs(v - (at[i] + [0.5, 1, -0.25][i]))), ...turnActual.map((v, i) => Math.abs(v - turn[i])));
          checked++;
        }
      }
    }
    assert.equal(checked, 4 * 2 + 4 * 6);
    assert.ok(worstPure < 1e-12, `robotKinematics against the analytic chain: ${worstPure}`);
    assert.ok(worstBody < 1e-6, `spawned bodies against the analytic chain: ${worstBody}`);
    // Joint angles the solver reports are the positions asked for.
    world.reset({ground: false});
    const spawned = spawnRobot(world, parseURDF(sixDofArmURDF()), {positions: {yaw: 0.4, shoulder: -0.7, elbow: 1.1, forearm_roll: -0.9, wrist_pitch: 0.6, tool_roll: 2.2}});
    // Read back from two float32 body quaternions, so to about 1e-5 rad.
    [0.4, -0.7, 1.1, -0.9, 0.6, 2.2].forEach((q, i) => near(world.getJointState(spawned.joints.get(SIX_DOF[i].joint)).value, q, 5e-5, `${SIX_DOF[i].joint} angle`));
    assert.throws(() => robotKinematics(parseURDF(twoLinkArmURDF()), {wrist: 1}), /has no joint "wrist"/);
    assert.throws(() => robotKinematics(parseURDF(twoLinkArmURDF()), {elbow: NaN}), /must be a finite number/);
  } finally { world.dispose(); }
});

test('format equivalence: the double pendulum from URDF and from MJCF is the same scene and the same trajectory', async () => {
  const urdf = parseURDF(doublePendulumURDF()), mjcf = parseMJCF(doublePendulumMJCF()), options = {positions: {shoulder: 0.8, elbow: -0.5}};
  assert.deepEqual([urdf.warnings, mjcf.warnings], [[], []]);
  const a = robotToScene(urdf, options), b = robotToScene(mjcf, options);
  assert.deepEqual(validateScene(a), []);
  assert.equal(canonicalize(a), canonicalize(b), 'canonical JSON is identical');
  assert.deepEqual(a.bodies.map(body => body.id), ['upper', 'lower']);
  assert.deepEqual(a.joints.map(joint => [joint.id, joint.type, joint.bodyA, joint.bodyB]), [['shoulder', 'revolute', null, 'upper'], ['elbow', 'revolute', 'upper', 'lower']]);
  const hashes = [];
  for (const robot of [urdf, mjcf]) {
    const world = await createWorld(sceneWorldOptions(a));
    try {
      world.reset({ground: true});
      const spawned = spawnRobot(world, robot, options);
      for (let i = 0; i < 600; i++) world.step();
      hashes.push(world.exactHash());
      assert.ok(Math.abs(world.getJointState(spawned.joints.get('shoulder')).value) < Math.PI, 'still swinging');
    } finally { world.dispose(); }
  }
  assert.equal(hashes[0], hashes[1], 'identical trajectory hash after 600 steps');
});

test('mass and inertia: total mass is the sum of link masses to float32, and the reported inertia errors are those of the shapes', async () => {
  const world = await si();
  try {
    for (const [name, example] of Object.entries(EXAMPLE_ROBOTS)) {
      const robot = example.format === 'urdf' ? parseURDF(example.text()) : parseMJCF(example.text());
      world.reset({ground: false});
      const spawned = spawnRobot(world, robot), report = spawned.report, specified = robot.links.reduce((sum, link) => sum + (link.inertial?.mass ?? 0), 0);
      let total = 0;
      for (const body of spawned.bodies.values()) total += world.getState(body).mass;
      within(report.totalMass, specified, 1e-12, `${name}: the report's file mass`);
      within(report.totalMassActual, specified, 1e-9, `${name}: mass of the bodies as planned (float64)`);
      within(total, specified, 2e-7, `${name}: mass the solver reports (float32)`);
      for (const link of report.links) if (link.kind === 'collision') within(link.bodies.reduce((sum, id) => sum + world.getState(spawned.bodies.get(id)).mass, 0), link.mass, 3e-7, `${name} ${link.link}: link mass`);
    }
    const report = robotReport(parseURDF(sixDofArmURDF()), OLD), link = name => report.links.find(one => one.link === name);
    // Turret: the file says 1.15 x the inertia of its cylinder (r 0.07, l 0.2, 4 kg); the body is a 24-sided prism of the cylinder's volume.
    const m = 4, r = 0.07, l = 0.2, step = 2 * Math.PI / 24, r2 = r * r * step / Math.sin(step), polygon = (2 + Math.cos(step)) / 6;
    const prism = [m * r2 * polygon, m * (r2 * polygon / 2 + l * l / 12), m * (r2 * polygon / 2 + l * l / 12)], file = [1.15 * m * r * r / 2, 1.15 * m * (3 * r * r + l * l) / 12, 1.15 * m * (3 * r * r + l * l) / 12];
    link('turret').principalActual.forEach((v, i) => within(v, prism[i], 1e-7, `turret principal moment ${i} of the prism`));   // the prism's corners are float32, as the engine stores them
    link('turret').principalError.forEach((v, i) => near(v, Math.abs(prism[i] - file[i]) / file[i], 1e-7, `turret principal error ${i}`));
    near(link('turret').maxPrincipalError, 0.15 / 1.15, 1e-4, 'turret: 1 - 1/1.15, less the prism\'s 0.003%');
    // Forearm: a box whose file inertia is 1.1 x the box's: every moment is 1/1.1 of the file's.
    link('forearm').principalError.forEach((v, i) => near(v, 1 - 1 / 1.1, 1e-9, `forearm principal error ${i}`));
    near(link('forearm').tensorError, 1 - 1 / 1.1, 1e-9, 'forearm tensor error');
    // Hand: a 0.5 kg sphere of radius 0.045 against 4e-4 on every axis.
    link('hand').principalError.forEach((v, i) => near(v, Math.abs(0.4 * 0.5 * 0.045 ** 2 - 4e-4) / 4e-4, 1e-9, `hand principal error ${i}`));
    // Tool: two boxes at one density. By hand: masses by volume, centre of mass, parallel axes; y is a principal axis by symmetry and x-z is a 2 x 2 problem.
    const v1 = 0.1 * 0.06 * 0.04, v2 = 0.02 * 0.06 * 0.06, rho = 0.3 / (v1 + v2), m1 = rho * v1, m2 = rho * v2;
    const cx = m2 * 0.04 / 0.3, cz = (m1 * 0.02 + m2 * 0.07) / 0.3, d1 = [-cx, 0.02 - cz], d2 = [0.04 - cx, 0.07 - cz];
    const ixx = m1 * (0.06 ** 2 + 0.04 ** 2) / 12 + m1 * d1[1] ** 2 + m2 * (0.06 ** 2 + 0.06 ** 2) / 12 + m2 * d2[1] ** 2;
    const izz = m1 * (0.1 ** 2 + 0.06 ** 2) / 12 + m1 * d1[0] ** 2 + m2 * (0.02 ** 2 + 0.06 ** 2) / 12 + m2 * d2[0] ** 2;
    const iyy = m1 * (0.1 ** 2 + 0.04 ** 2) / 12 + m1 * (d1[0] ** 2 + d1[1] ** 2) + m2 * (0.02 ** 2 + 0.06 ** 2) / 12 + m2 * (d2[0] ** 2 + d2[1] ** 2);
    const ixz = -(m1 * d1[0] * d1[1] + m2 * d2[0] * d2[1]);
    const pair = (a, b, c) => { const mean = (a + b) / 2, half = Math.hypot((a - b) / 2, c); return [mean - half, mean + half]; };
    const actual = [...pair(ixx, izz, ixz), iyy].sort((a, b) => a - b), wanted = [...pair(0.0003, 0.0002, -0.00003), 0.00035].sort((a, b) => a - b);
    link('tool').principalActual.forEach((v, i) => within(v, actual[i], 1e-9, `tool principal moment ${i}`));
    link('tool').principalError.forEach((v, i) => near(v, Math.abs(actual[i] - wanted[i]) / wanted[i], 1e-9, `tool principal error ${i}`));
    near(link('tool').comOffset, Math.hypot(cx - 0.012, cz - 0.035), 1e-12, 'tool centre-of-mass offset');
    within(link('tool').massActual, 0.3, 1e-12, 'tool mass');
    assert.deepEqual([report.worstLink, link('tool').bodies], ['tool', ['tool', 'tool.2']]);
    near(report.maxPrincipalError, link('tool').maxPrincipalError, 0, 'the headline number is the worst link\'s');
    assert.ok(report.maxPrincipalError > 0.4 && report.maxPrincipalError < 0.45, `worst principal error ${report.maxPrincipalError}`);
    assert.match(report.warnings.at(-1).message, /the bodies' inertia differs from the file's by up to 42\.\d% of a principal moment \(link "tool"\)/, 'a large gap is a warning, not only a number');
    // A cylinder as a capsule keeps the radius and overall length and loses volume: 2 r / (3 l) of it.
    const capsule = robotReport(parseURDF(twoLinkArmURDF()), {cylinders: 'capsule'}).shapes[0];
    assert.equal(capsule.as, 'capsule of the same radius and overall length');
    near(capsule.volumeError, -2 * 0.03 / (3 * 0.4), 1e-12, 'capsule volume error');
    assert.ok(capsule.inertiaError > 0.05 && capsule.inertiaError < 0.2, `capsule inertia error ${capsule.inertiaError}`);
    const prismShape = robotReport(parseURDF(twoLinkArmURDF())).shapes[0];
    assert.ok(Math.abs(prismShape.volumeError) < 1e-6 && prismShape.inertiaError < 3e-5, `prism ${JSON.stringify(prismShape)}`);
  } finally { world.dispose(); }
});

test("with inertia: 'shapes', a single revolute link swings with the compound-pendulum period of its shape's inertia, not the inertia in the file", async () => {
  const world = await si();
  try {
    // A 2 kg box rod, 0.8 m long, hinged at its end. The file claims 1.3 x the rod's true transverse inertia.
    const m = 2, L = 0.8, w = 0.06, k = 1.3, own = m * (w * w + L * L) / 12, theta0 = 0.1;
    const urdf = `<robot name="rod"><link name="world"/>
      <joint name="hinge" type="continuous"><parent link="world"/><child link="rod"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/></joint>
      <link name="rod"><inertial><origin xyz="0 0 ${-L / 2}"/><mass value="${m}"/><inertia ixx="${k * own}" ixy="0" ixz="0" iyy="${k * own}" iyz="0" izz="${m * w * w / 6}"/></inertial>
        <collision><origin xyz="0 0 ${-L / 2}"/><geometry><box size="${w} ${w} ${L}"/></geometry></collision></link></robot>`;
    const robot = spawnRobot(world, parseURDF(urdf), {positions: {hinge: theta0}, inertia: 'shapes'}), samples = [];
    for (let i = 0; i < HZ * 20; i++) { world.step(); samples.push(world.getJointState(robot.joints.get('hinge')).value); }
    // T = 2 pi sqrt(I_pivot / (m g d)) (1 + theta0^2 / 16), with d = L / 2.
    const T = I => 2 * Math.PI * Math.sqrt((I + m * L * L / 4) / (m * G * L / 2)) * (1 + theta0 * theta0 / 16);
    const measured = periodOf(samples), actual = T(own), fromFile = T(k * own);
    within(measured, actual, 1e-3, 'period from the engine\'s inertia');
    assert.ok(Math.abs(measured / fromFile - 1) > 0.03, `the file's inertia would give ${fromFile} s, ${((fromFile / actual - 1) * 100).toFixed(2)}% longer; measured ${measured} s`);
    near(fromFile / actual - 1, 0.03697, 1e-4, 'predicted period gap from the inertia gap');
    // The report says the same thing: the transverse moments are 1/1.3 of the file's.
    near(robot.report.links.find(link => link.link === 'rod').maxPrincipalError, 1 - 1 / k, 1e-9, 'reported inertia error');
    within(Math.max(...samples.slice(-HZ * 3).map(Math.abs)), theta0, 0.01, 'amplitude after 17 s (no energy drift)');
  } finally { world.dispose(); }
});

test('the cart-pole swings at the coupled small-oscillation frequency, and a slider along gravity falls at g and stops at its limit', async () => {
  const world = await si();
  try {
    // Cart M on a frictionless rail, pole m with its centre d below the hinge and inertia I about that centre:
    // omega^2 = (M + m) m g d / ((M + m) (I + m d^2) - m^2 d^2). A fixed cart would give the plain pendulum instead.
    const M = 1, m = 0.2, l = 1, w = 0.04, d = l / 2, I = m * (w * w + l * l) / 12;
    const robot = spawnRobot(world, parseURDF(cartPoleURDF()), {positions: {hinge: 0.05}}), samples = [], travel = [];
    within(world.getState(robot.links.get('cart').body).mass, M, 1e-6, 'cart mass'); within(world.getState(robot.links.get('pole').body).mass, m, 1e-6, 'pole mass');
    for (let i = 0; i < HZ * 20; i++) { world.step(); samples.push(world.getJointState(robot.joints.get('hinge')).value); travel.push(world.getJointState(robot.joints.get('slider')).value); }
    const coupled = 2 * Math.PI / Math.sqrt((M + m) * m * G * d / ((M + m) * (I + m * d * d) - m * m * d * d)), fixed = 2 * Math.PI * Math.sqrt((I + m * d * d) / (m * G * d));
    const measured = periodOf(samples);
    within(measured, coupled, 2e-3, 'coupled period');
    assert.ok(Math.abs(measured / fixed - 1) > 0.05, `the cart moves: a fixed pivot would give ${fixed} s, measured ${measured} s`);
    // The cart swings against the pole about a fixed centre of mass: its travel spans 2 m d theta0 / (M + m).
    within(Math.max(...travel) - Math.min(...travel), 2 * m * d * Math.sin(0.05) / (M + m), 0.02, 'cart travel');

    world.reset({ground: false});
    // A 3 kg block on a vertical slider (axis down), limits [-1, 30] m. Under gravity it is in free fall until the stop.
    const slider = spawnRobot(world, parseURDF(`<robot name="drop"><link name="world"/>
      <joint name="slide" type="prismatic"><parent link="world"/><child link="block"/><origin xyz="0 0 50"/><axis xyz="0 0 -1"/><limit lower="-1" upper="30" effort="10" velocity="1"/></joint>
      <link name="block"><inertial><mass value="3"/><inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.02"/></inertial><collision><geometry><box size="0.2 0.2 0.2"/></geometry></collision></link></robot>`));
    const block = slider.links.get('block').body, joint = slider.joints.get('slide'), t = 2;
    run(world, t);
    within(world.getState(block).linearVelocity[1], -G * t, 1e-4, 'speed after 2 s: v = g t');
    // Semi-implicit Euler travels g t dt / 2 further than the continuum answer; allow exactly that.
    near(world.getJointState(joint).value, 0.5 * G * t * t, 0.5 * G * t / (HZ * SUB) + 1e-3, 'travel after 2 s: g t^2 / 2');
    run(world, 4);
    near(world.getJointState(joint).value, 30, 1e-3, 'the upper limit holds');
    near(Math.hypot(...world.getState(block).linearVelocity), 0, 1e-3, 'at rest on the stop');
  } finally { world.dispose(); }
});

test('joint limits hold, and a motor with effort tau holds a horizontal link when tau >= m g d and drops it when not', async () => {
  const world = await si();
  try {
    // A 1.5 kg, 0.6 m box link along x on a hinge about y: gravity turns it with m g d, d = 0.3 m (positive angle is down).
    const m = 1.5, L = 0.6, w = 0.05, load = m * G * L / 2;
    const arm = (effort, limit = '-3" upper="3') => parseURDF(`<robot name="arm"><link name="world"/>
      <joint name="hinge" type="revolute"><parent link="world"/><child link="arm"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/><limit lower="${limit}" effort="${effort}" velocity="1"/></joint>
      <link name="arm"><inertial><origin xyz="${L / 2} 0 0"/><mass value="${m}"/><inertia ixx="0.001" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.05"/></inertial>
        <collision><origin xyz="${L / 2} 0 0"/><geometry><box size="${L} ${w} ${w}"/></geometry></collision></link></robot>`);
    const after = (description, options, seconds) => { world.reset({ground: false}); const robot = spawnRobot(world, description, options); run(world, seconds); return world.getJointState(robot.joints.get('hinge')).value; };
    // No motor: the link falls onto its limit and stays there.
    near(after(arm(0, '-0.2" upper="0.5'), {}, 6), 0.5, 2e-3, 'the upper limit holds the falling link');
    // Holding motor (speed 0) with the file's effort as its largest torque.
    for (const factor of [1.1, 1.02]) near(after(arm(factor * load), {motors: {hinge: 0}}, 3), 0, 2e-3, `effort ${factor} x m g d holds`);
    assert.ok(after(arm(0.98 * load), {motors: {hinge: 0}}, 3) > 0.2, 'effort 0.98 x m g d lets the link sink');
    assert.ok(after(arm(0.9 * load), {motors: {hinge: 0}}, 3) > 0.6, 'effort 0.9 x m g d drops the link');
    // The motor's torque is the file's effort, and can be overridden.
    world.reset({ground: false});
    const description = arm(1.5 * load);
    assert.deepEqual(robotToScene(description, {motors: {hinge: 0.5}}).joints[0].motor, {speed: 0.5, maxForce: 1.5 * load});
    assert.deepEqual(robotToScene(description, {motors: {hinge: {speed: -1, maxForce: 7}}}).joints[0].motor, {speed: -1, maxForce: 7});
    assert.equal(robotToScene(description).joints[0].motor, undefined, 'no motor unless asked: the effort is only recorded');
    assert.deepEqual(robotToScene(description).joints[0].userData, {joint: 'hinge', effort: 1.5 * load, velocity: 1});
    assert.throws(() => robotToScene(description, {motors: {elbow: 1}}), /has no joint "elbow"/);
    assert.throws(() => robotToScene(parseURDF(doublePendulumURDF()), {motors: {elbow: 1}}), /joint "elbow" has no effort limit in the file; give \{speed, maxForce\}/);
    // A limit beyond half a turn cannot be measured by the engine's hinge angle: reported, and left unlimited.
    const wide = robotReport(arm(1, '-4" upper="4'));
    assert.deepEqual(wide.warnings.filter(w => w.code === 'unsupported').map(w => w.element), ['joint "hinge"']);
    assert.match(wide.warnings[0].message, /the limit \[-4, 4\] rad reaches beyond half a turn/);
    assert.equal(wide.joints[0].limits, undefined);
  } finally { world.dispose(); }
});

test('joint stiffness and damping become a joint spring with the right frequency and decay; dry friction becomes a motor', async () => {
  // One box rod (0.06 x 0.06 x 0.6 m, 800 kg/m^3) hinged at its end, as MJCF with stiffness and damping on the hinge.
  const swing = async (stiffness, damping, theta0, seconds, gravity) => {
    const robot = parseMJCF(`<mujoco model="spring"><compiler angle="radian"/><option gravity="0 0 ${gravity}"/><worldbody><body name="rod" pos="0 0 1">
      <joint name="hinge" type="hinge" axis="0 1 0" stiffness="${stiffness}" damping="${damping}"/><geom type="box" pos="0 0 -0.3" size="0.03 0.03 0.3" density="800"/></body></worldbody></mujoco>`);
    const world = await createWorld({step: 1 / HZ, subSteps: SUB});
    try {
      world.reset({ground: false, gravity: [0, gravity, 0]});
      const spawned = spawnRobot(world, robot, {positions: {hinge: theta0}}), samples = [];
      for (let i = 0; i < HZ * seconds; i++) { world.step(); samples.push(world.getJointState(spawned.joints.get('hinge')).value); }
      return {samples, spring: spawned.report.joints[0].spring, warnings: spawned.report.warnings};
    } finally { world.dispose(); }
  };
  const m = 800 * 0.06 * 0.06 * 0.6, own = m * (0.06 ** 2 + 0.6 ** 2) / 12, pivot = own + m * 0.3 ** 2;
  const peaks = samples => { const out = []; for (let i = 1; i < samples.length - 1; i++) if (samples[i] > 0 && samples[i] > samples[i - 1] && samples[i] >= samples[i + 1]) out.push([i / HZ, samples[i]]); return out; };
  const decay = found => Math.log(found[0][1] / found.at(-1)[1]) / (found.at(-1)[0] - found[0][0]);
  // Stiffness alone, no gravity: T = 2 pi sqrt(I_pivot / k). The engine's spring acts on the hinge's own effective mass (the rod's inertia about its centre).
  const spring = await swing(20, 0, 0.2, 10, 0);
  within(spring.spring.effectiveMass, own, 1e-9, 'effective mass at the hinge');
  within(spring.spring.stiffness, 20, 1e-12, 'stiffness the spring stands for');
  within(periodOf(spring.samples), 2 * Math.PI * Math.sqrt(pivot / 20), 2e-3, 'spring period');
  // The spring is integrated implicitly, which damps: measured 0.10 /s here, as a damping of 0.042 N m s/rad would (about 2 k dt per sub-step). Bound it.
  const numerical = decay(peaks(spring.samples));
  assert.ok(numerical > 0 && numerical < 0.12, `numerical decay rate of an undamped spring: ${numerical} /s`);
  // Damping alone, under gravity: the swing decays as exp(-c t / (2 I_pivot)).
  const damped = await swing(0, 0.3, 0.15, 8, -G);
  within(decay(peaks(damped.samples)), 0.3 / (2 * pivot), 0.01, 'decay rate from the joint damping');
  within(damped.spring.damping, 0.3, 1e-12, 'damping the spring stands for');
  assert.deepEqual(damped.warnings.map(w => [w.code, w.element]), [['note', 'joint "hinge"']]);
  assert.match(damped.warnings[0].message, /its damping \(0\.3\) is carried by a joint spring of 0\.01 Hz, which adds a stiffness of 0\.000207 towards the starting position/);
  // Both: the decay is the damping's plus the numerical part measured above.
  const both = await swing(20, 0.4, 0.2, 6, 0);
  within(decay(peaks(both.samples)), 0.4 / (2 * pivot) + numerical, 0.02, 'decay rate with stiffness and damping');
  // Dry friction: a motor holding zero speed with the friction as its torque cap, unless the joint is driven.
  const sticky = parseURDF(`<robot name="f"><link name="world"/><joint name="hinge" type="continuous"><parent link="world"/><child link="a"/><axis xyz="0 1 0"/><dynamics friction="0.7"/><limit effort="5"/></joint>
    <link name="a"><inertial><mass value="1"/><inertia ixx="0.004" iyy="0.004" izz="0.004"/></inertial><collision><geometry><sphere radius="0.1"/></geometry></collision></link></robot>`);
  assert.deepEqual(robotToScene(sticky).joints[0].motor, {speed: 0, maxForce: 0.7});
  assert.deepEqual(robotToScene(sticky, {motors: {hinge: 2}}).joints[0].motor, {speed: 2, maxForce: 5});
  assert.deepEqual(robotReport(sticky, {motors: {hinge: 2}}).warnings.map(w => w.message), ['its dry friction (0.7) is dropped: the joint\'s one motor is driving it']);
});

test('static stability: the six-joint arm holds its pose for 5 s within a stated tolerance, by motors and by springs', async () => {
  const world = await si();
  try {
    const robot = parseURDF(sixDofArmURDF()), names = SIX_DOF.map(row => row.joint);
    // Joints are soft constraints in the engine (60 Hz), so the arm settles a little below its kinematic pose: measured 17.7 mm at the tool
    // with holding motors, 30.2 mm with 60 Hz springs (which add their own sag), on a 1 m reach. The tolerances state that.
    for (const [label, options, toolLimit, angleLimit] of [
      ['motors holding zero speed', {motors: Object.fromEntries(names.map(name => [name, 0]))}, 0.03, 0.01],
      ['60 Hz springs', {hold: {hertz: 60, dampingRatio: 1}}, 0.05, 0.02],
      ['motors, joints stiffened to 240 Hz', {motors: Object.fromEntries(names.map(name => [name, 0])), jointStiffness: {hertz: 240}}, 0.003, 0.01],
    ]) {
      world.reset({ground: false});
      const spawned = spawnRobot(world, robot, options), tool = spawned.links.get('tool');
      const at = () => robotLinkPose(world.getState(tool.body), tool.frame).position, start = at();
      let worst = 0, fastest = 0, gap = 0;
      for (let i = 0; i < HZ * 5; i++) {
        world.step();
        const p = at();
        worst = Math.max(worst, Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]));
        if (i % 24 === 0) { gap = Math.max(gap, anchorGap(world, spawned).gap); for (const body of spawned.bodies.values()) fastest = Math.max(fastest, Math.hypot(...world.getState(body).linearVelocity)); }
      }
      if (process.env.ROBOT_PROBE) console.log(label, 'worst', worst, 'gap', gap);
      assert.ok(worst < toolLimit, `${label}: the tool moved ${worst} m at most (limit ${toolLimit})`);
      assert.ok(fastest < 1, `${label}: no body ever moved faster than 1 m/s (${fastest}): nothing exploded`);
      assert.ok(gap < 2e-3, `${label}: joint anchors stayed within 2 mm (${gap})`);
      for (const name of names) assert.ok(Math.abs(world.getJointState(spawned.joints.get(name)).value) < angleLimit, `${label}: ${name} is at ${world.getJointState(spawned.joints.get(name)).value} rad`);
      for (const body of spawned.bodies.values()) assert.ok(Math.hypot(...world.getState(body).linearVelocity) < 1e-3, `${label}: at rest after 5 s`);
    }
    // hold replaces the file's damping on the joint and says so; it can be limited to named joints.
    const report = robotReport(robot, {hold: {hertz: 30, joints: ['elbow']}});
    assert.deepEqual(report.joints.map(joint => joint.spring?.hertz), [0.01, undefined, 30, undefined, undefined, undefined]);
    assert.equal(report.joints[2].spring.dampingRatio, 1);
    assert.match(robotReport(robot, {hold: {hertz: 30}}).warnings[0].message, /the hold option replaces the stiffness and damping the file gives this joint/);
  } finally { world.dispose(); }
});

test('maximal-coordinate drift: a 12-link chain stretches by millimetres at its joints, as the soft-constraint model predicts', async () => {
  const world = await si();
  try {
    // Hanging at rest, the second hinge carries ten links (2.5 kg). Box3D's joint rows are springs of 60 Hz on the pair's reduced mass,
    // so the anchor gap is about load / (m_reduced (2 pi 60)^2) = 24.5 N / (0.125 kg x 142,122 /s^2) = 1.38 mm.
    const robot = parseURDF(hangingChainURDF(12));
    const hanging = spawnRobot(world, robot);
    run(world, 5);
    const rest = anchorGap(world, hanging);
    within(rest.gap, 10 * 0.25 * G / (0.125 * (2 * Math.PI * 60) ** 2), 0.15, 'anchor gap at rest against the 60 Hz soft-constraint estimate');
    assert.ok(['hinge1', 'hinge2'].includes(rest.joint), `the gap is largest near the top (${rest.joint})`);
    // Swinging from 1.2 rad, the largest gap in 10 s: measured 3.75 mm. Stated bound: 6 mm.
    world.reset({ground: false});
    const swinging = spawnRobot(world, robot, {positions: {hinge1: 1.2}});
    let worst = 0;
    for (let i = 0; i < HZ * 10; i++) { world.step(); if (i % 10 === 0) worst = Math.max(worst, anchorGap(world, swinging).gap); }
    assert.ok(worst > rest.gap && worst < 6e-3, `largest anchor gap while swinging: ${worst} m`);
  } finally { world.dispose(); }
});

test('the wheeled cart rests on the ground and rolls at wheel speed x radius when its wheel motors run', async () => {
  const world = await si(true);
  try {
    const robot = parseURDF(wheeledCartURDF());
    // Welded down by default; floatingBase sets it free. Start 2 mm up so the wheels settle onto the ground.
    assert.equal(robotToScene(robot).joints[0].id, 'chassis.base');
    const cart = spawnRobot(world, robot, {floatingBase: true, position: [0, 0.002, 0]}), chassis = cart.links.get('chassis').body;
    assert.equal(cart.allJoints.size, 4, 'four axles and no base weld');
    run(world, 2);
    const rest = world.getState(chassis);
    near(rest.position[1], 0.15, 1e-3, 'chassis centre height at rest: wheel radius + 0.05 m');
    assert.ok(Math.hypot(rest.position[0], rest.position[2]) < 1e-3 && Math.hypot(...rest.linearVelocity) < 1e-3, `at rest: ${rest.position} moving at ${rest.linearVelocity}`);
    // 5 rad/s on 0.1 m wheels is 0.5 m/s. The wheels are 24-sided prisms, so the ride is slightly bumpy and a little slow.
    for (const axle of cart.joints.values()) world.setJointMotor(axle, {speed: 5, maxForce: 5});
    run(world, 2);
    const x0 = world.getState(chassis).position[0];
    run(world, 2);
    const moving = world.getState(chassis);
    within((moving.position[0] - x0) / 2, 0.5, 0.05, 'mean speed over 2 s');
    near(moving.position[1], 0.15, 3e-3, 'still on its wheels');
    assert.ok(Math.abs(moving.position[2]) < 0.1, `it drives straight: sideways ${moving.position[2]} m after ${moving.position[0]} m`);
    // The same from the scene, with the motors named in the options.
    const scene = robotToScene(robot, {floatingBase: true, motors: Object.fromEntries([...cart.joints.keys()].map(name => [name, 5]))});
    assert.deepEqual(scene.joints.map(joint => joint.motor), Array(4).fill({speed: 5, maxForce: 5}));
  } finally { world.dispose(); }
});

test('round trip: robotToScene validates, loads to the same hashes as spawnRobot, and survives a share link', async () => {
  for (const [name, example] of Object.entries(EXAMPLE_ROBOTS)) {
    const robot = example.format === 'urdf' ? parseURDF(example.text()) : parseMJCF(example.text());
    const options = name === 'wheeled-cart' ? {floatingBase: true, position: [0, 0.002, 0]} : name === 'six-dof-arm' ? {positions: {shoulder: 0.5, elbow: -0.8}, selfCollision: false} : {};
    const scene = robotToScene(robot, options);
    assert.deepEqual(validateScene(scene), [], `${name}: the scene is valid`);
    assert.deepEqual(canonicalize(robotToScene(robot, options)), canonicalize(scene), `${name}: the conversion is deterministic`);
    const link = await encodeSceneLink(scene), stored = encodeSceneLinkSync(scene);
    assert.equal(canonicalize(decodeSceneLink(link)), canonicalize(scene), `${name}: share link`);
    assert.equal(canonicalize(decodeSceneLink(stored)), canonicalize(scene), `${name}: stored share link`);
    const hashes = [];
    for (const build of ['load', 'spawn', 'link']) {
      const world = await createWorld(sceneWorldOptions(scene));
      try {
        if (build === 'spawn') {
          world.reset({ground: scene.world.ground, gravity: scene.world.gravity});
          const spawned = spawnRobot(world, robot, options);
          assert.deepEqual([...spawned.bodies.keys()], scene.bodies.map(body => body.id), `${name}: spawnRobot makes the scene's bodies`);
          assert.deepEqual([...spawned.allJoints.keys()], scene.joints.map(joint => joint.id));
          assert.deepEqual(canonicalize(spawned.scene), canonicalize(scene));
        } else {
          const loaded = loadScene(world, build === 'load' ? scene : decodeSceneLink(link));
          assert.equal(loaded.bodies.size, scene.bodies.length);
          // The scene records which body carries each link and where the link frame is in it.
          for (const [linkName, entry] of Object.entries(loaded.scene.extensions.robot.links)) assert.ok(entry.body === null || loaded.bodies.has(entry.body), `${name}: ${linkName} -> ${entry.body}`);
        }
        const start = world.exactHash();
        for (let i = 0; i < 150; i++) world.step();
        hashes.push([start, world.exactHash()]);
      } finally { world.dispose(); }
    }
    assert.deepEqual(hashes[1], hashes[0], `${name}: spawnRobot and loadScene agree at the start and after 150 steps`);
    assert.deepEqual(hashes[2], hashes[0], `${name}: the share link gives the same run`);
  }
});

test('scene details: ids, collision filters, the base, compound links, cylinders and the world axes', async () => {
  const arm = parseURDF(sixDofArmURDF());
  const scene = robotToScene(arm, OLD), byId = Object.fromEntries(scene.bodies.map(body => [body.id, body]));
  // With links: 'welded', one body per collision shape; the tool's two boxes are welded and share a negative group.
  assert.deepEqual(scene.bodies.map(body => [body.id, body.shape.kind]), [['base', 'hull'], ['turret', 'hull'], ['upper_arm', 'box'], ['forearm', 'box'], ['wrist', 'hull'], ['hand', 'sphere'], ['tool', 'box'], ['tool.2', 'box']]);
  assert.deepEqual(scene.joints.map(joint => [joint.id, joint.type, joint.bodyA, joint.bodyB]), [['base.base', 'weld', null, 'base'], ['yaw', 'revolute', 'base', 'turret'], ['shoulder', 'revolute', 'turret', 'upper_arm'],
    ['elbow', 'revolute', 'upper_arm', 'forearm'], ['forearm_roll', 'revolute', 'forearm', 'wrist'], ['wrist_pitch', 'revolute', 'wrist', 'hand'], ['tool_roll', 'revolute', 'hand', 'tool'], ['tool.weld2', 'weld', 'tool', 'tool.2']]);
  assert.ok(scene.joints.every(joint => joint.collideConnected === undefined), 'joined bodies do not collide');
  assert.equal(byId.tool.filter.groupIndex, byId['tool.2'].filter.groupIndex);
  assert.ok(byId.tool.filter.groupIndex < 0);
  assert.deepEqual([byId.tool.userData, byId['tool.2'].userData, byId.hand.userData], [{link: 'tool', part: 1}, {link: 'tool', part: 2}, {link: 'hand'}]);
  // With a compound link, joined LINKS are kept apart by category bits: the hand (bit 6) and the tool (bit 7) mask each other out, the hand and the forearm do not.
  const bits = id => [BigInt(byId[id].filter.categoryBits), BigInt(byId[id].filter.maskBits)];
  const collide = (a, b) => (bits(a)[0] & bits(b)[1]) !== 0n && (bits(b)[0] & bits(a)[1]) !== 0n;
  assert.deepEqual([collide('hand', 'tool'), collide('hand', 'tool.2'), collide('wrist', 'hand'), collide('forearm', 'hand'), collide('base', 'tool.2')], [false, false, false, true, true]);
  assert.ok((bits('tool')[1] & 1n) === 1n, 'everything still collides with ordinary bodies (category 1)');
  // Without a compound link the filters are left alone.
  assert.ok(robotToScene(parseURDF(twoLinkArmURDF())).bodies.every(body => body.filter === undefined));
  // selfCollision: false puts every body in one negative group.
  assert.deepEqual([...new Set(robotToScene(arm, {selfCollision: false, collisionGroup: 77}).bodies.map(body => body.filter.groupIndex))], [-77]);
  // The weld inside the tool sits at the midpoint of the two centres, in each body's own frame.
  const weld = scene.joints.at(-1), a = byId.tool, b = byId['tool.2'];
  assert.ok(weld.frameA.position.every((v, i) => Math.abs(v + weld.frameB.position[i]) < 1e-12), 'the anchor is halfway between the two centres');
  near(Math.hypot(...weld.frameA.position), Math.hypot(...a.position.map((v, i) => v - b.position[i])) / 2, 1e-9, 'weld anchor distance');
  // Z up in the file is Y up in the world: the base cylinder's centre (0, 0, 0.05) is at (0, 0.05, 0), and gravity points down y.
  byId.base.position.forEach((v, i) => near(v, [0, 0.05, 0][i], 1e-12, 'base position'));
  assert.deepEqual(scene.world, {gravity: [0, -9.81, 0], ground: true});
  assert.deepEqual(robotToScene(arm, {up: 'y'}).world.gravity, [0, -9.81, 0]);
  robotToScene(arm, {up: 'y'}).bodies[0].position.forEach((v, i) => near(v, [0, 0, 0.05][i], 1e-12, 'up: y keeps the axes'));
  assert.deepEqual(robotToScene(arm, {world: {gravity: [0, -1.62, 0], ground: false, step: 1 / 120}}).world, {gravity: [0, -1.62, 0], ground: false, step: 1 / 120});
  // position and rotation place the whole robot: a quarter turn about world y sends the upper arm's +x offset to -z.
  const turned = robotToScene(parseURDF(twoLinkArmURDF()), {position: [1, 2, 3], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2]});
  turned.bodies[1].position.forEach((v, i) => near(v, [1 - 0.1, 2 + 0.5, 3 - 0.2][i], 1e-12, 'placed and turned'));
  // prefix keeps two robots apart; ids are cleaned to the scene format's alphabet.
  assert.deepEqual(robotToScene(parseURDF(doublePendulumURDF()), {prefix: 'left:'}).bodies.map(body => body.id), ['left:upper', 'left:lower']);
  const odd = parseURDF('<robot name="odd"><link name="base link/1"><inertial><mass value="1"/><inertia ixx="1" iyy="1" izz="1"/></inertial><collision><geometry><sphere radius="0.1"/></geometry></collision></link></robot>');
  assert.deepEqual([robotToScene(odd).bodies[0].id, robotToScene(odd).joints[0].id, robotToScene(odd).bodies[0].userData.link], ['base_link_1', 'base_link_1.base', 'base link/1']);
  // floatingBase removes the weld; a massless root that only carries a frame is merged into the world.
  assert.deepEqual(robotToScene(arm, {floatingBase: true}).joints[0].id, 'yaw');
  assert.equal(robotToScene(parseURDF(doublePendulumURDF())).extensions.robot.links.world.body, null);
  // A cylinder becomes a 24-sided prism by default (48 points), a capsule on request, and the prism can be finer.
  assert.equal(byId.turret.shape.points.length, 48 * 3);
  assert.equal(robotToScene(arm, {cylinderSides: 32}).bodies[1].shape.points.length, 64 * 3);
  const capsules = robotToScene(parseURDF(twoLinkArmURDF()), {cylinders: 'capsule'}).bodies[1];
  assert.deepEqual(capsules.shape, {kind: 'capsule', radius: 0.03, halfLength: 0.2 - 0.03});
  assert.throws(() => robotToScene(arm, {cylinderSides: 100}), /cylinderSides must be an integer from 8 to 32/);
  // The 32-sided prism and the compound tool really build, and the tool's two bodies do not push each other apart.
  const world = await si();
  try {
    const spawned = spawnRobot(world, arm, {...OLD, cylinderSides: 32, motors: Object.fromEntries(SIX_DOF.map(row => [row.joint, 0]))});
    run(world, 2);
    const p = world.getState(spawned.bodies.get('tool')).position, q = world.getState(spawned.bodies.get('tool.2')).position;
    near(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), Math.hypot(0.04, 0.05), 1e-3, 'the tool\'s two boxes keep their spacing');
  } finally { world.dispose(); }
});

test('links without mass or shape: static scenery, default density, inertia boxes and merged frames, each reported', () => {
  const box = (size = '0.2 0.2 0.2') => `<collision><geometry><box size="${size}"/></geometry></collision>`;
  const inertial = (m, i = '0.01') => `<inertial><mass value="${m}"/><inertia ixx="${i}" iyy="${i}" izz="${i}"/></inertial>`;
  const urdf = `<robot name="mixed">
    <link name="pedestal">${box('1 1 0.2')}</link>
    <joint name="mount" type="fixed"><parent link="pedestal"/><child link="flange"/><origin xyz="0 0 0.1"/></joint>
    <link name="flange"/>
    <joint name="swivel" type="continuous"><parent link="flange"/><child link="adapter"/><origin xyz="0 0 0.2"/><axis xyz="0 0 1"/></joint>
    <link name="adapter"/>
    <joint name="adapter_fix" type="fixed"><parent link="adapter"/><child link="arm"/><origin xyz="0 0 0.1"/></joint>
    <link name="arm">${inertial(2, 2 * 0.08 / 12)}${box()}</link>
    <joint name="tip_fix" type="fixed"><parent link="arm"/><child link="tcp"/><origin xyz="0 0 0.3"/></joint>
    <link name="tcp"/>
    <joint name="wrist" type="revolute"><parent link="arm"/><child link="payload"/><origin xyz="0.3 0 0"/><axis xyz="1 0 0"/><limit lower="-1" upper="1"/></joint>
    <link name="payload"><inertial><origin xyz="0 0 0.05" rpy="0.3 0.2 0.1"/><mass value="1.5"/><inertia ixx="0.004" ixy="0" ixz="0" iyy="0.006" iyz="0" izz="0.008"/></inertial></link>
    <joint name="shell_fix" type="continuous"><parent link="arm"/><child link="shell"/><origin xyz="-0.3 0 0"/></joint>
    <link name="shell">${box('0.1 0.1 0.1')}</link>
  </robot>`;
  const robot = parseURDF(urdf), scene = robotToScene(robot), report = robotReport(robot), link = name => report.links.find(one => one.link === name);
  assert.deepEqual(validateScene(scene), []);
  assert.deepEqual(report.links.map(one => [one.link, one.kind, one.bodies]), [['pedestal', 'static', ['pedestal']], ['flange', 'frame', []], ['adapter', 'frame', []], ['arm', 'collision', ['arm']],
    ['tcp', 'frame', []], ['payload', 'inertia-box', ['payload']], ['shell', 'default-density', ['shell']]]);
  // The massless pedestal is static scenery; the swivel hangs the arm from it through two frame-only links, with no weld for the fixed joints.
  assert.equal(scene.bodies[0].type, 'static');
  assert.deepEqual(scene.joints.map(joint => [joint.id, joint.type, joint.bodyA, joint.bodyB]), [['swivel', 'revolute', 'pedestal', 'arm'], ['wrist', 'revolute', 'arm', 'payload'], ['shell_fix', 'revolute', 'arm', 'shell']]);
  // Frames ride on the body that carries them: tcp is 0.3 m above the arm's body origin; the adapter is 0.1 m below it.
  const frames = scene.extensions.robot.links;
  assert.deepEqual([frames.tcp.body, frames.adapter.body, frames.flange.body, frames.pedestal.body], ['arm', 'arm', 'pedestal', 'pedestal']);
  frames.tcp.position.forEach((v, i) => near(v, [0, 0, 0.3][i], 1e-12, 'tcp frame')); frames.adapter.position.forEach((v, i) => near(v, [0, 0, -0.1][i], 1e-12, 'adapter frame'));
  // The payload has mass and no shape: a box with exactly the file's mass and inertia tensor, that collides with nothing.
  const payload = scene.bodies.find(body => body.id === 'payload');
  assert.deepEqual(payload.filter, {categoryBits: '1', maskBits: '0'});
  [...payload.shape.halfExtents].sort().forEach((v, i) => near(v, [Math.sqrt(6 * 0.002 / 1.5) / 2, Math.sqrt(6 * 0.006 / 1.5) / 2, Math.sqrt(6 * 0.010 / 1.5) / 2][i], 1e-12, 'inertia box'));
  assert.ok(link('payload').maxPrincipalError < 1e-12 && link('payload').tensorError < 1e-12 && link('payload').comOffset < 1e-15, `payload inertia is exact: ${JSON.stringify(link('payload'))}`);
  within(link('payload').massActual, 1.5, 1e-12, 'payload mass');
  // The shell has shapes and no mass, and moves: default density, reported.
  within(link('shell').massActual, 1, 1e-12, '1000 kg/m^3 x 0.001 m^3');
  assert.deepEqual(report.warnings.map(w => [w.code, w.element, w.message]), [
    ['note', 'link "shell"', 'has collision shapes but no mass; its bodies get the default density of 1000 kg/m^3 (1 kg)'],
  ]);
  within(report.totalMass, 3.5, 1e-12, 'file mass of the links with bodies'); within(report.totalMassActual, 4.5, 1e-12, 'with the default-density shell');
  // A moving link with nothing on it and nothing fixed to it cannot be simulated: an error that names it.
  assert.throws(() => robotToScene(parseURDF(`<robot name="bad"><link name="a">${inertial(1)}${box()}</link><joint name="j" type="continuous"><parent link="a"/><child link="ghost"/></joint><link name="ghost"/></robot>`)),
    /link "ghost" moves on joint "j" but has no mass and no collision shape, and no link fixed to it has a body/);
  // An inertia tensor no solid box can have (a principal moment larger than the other two together) becomes a sphere, and says so.
  const odd = robotReport(parseURDF(`<robot name="odd"><link name="a"><inertial><mass value="1"/><inertia ixx="0.01" iyy="0.01" izz="0.05"/></inertial></link></robot>`), {inertia: 'shapes'});
  assert.deepEqual(odd.warnings.map(w => [w.code, w.element]), [['approximated', 'link "a"'], ['note', 'robot "odd"']]);
  assert.match(odd.warnings[0].message, /no solid box has its inertia tensor/);
});
