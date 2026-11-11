# Robot import: URDF and MJCF

`box3d-webgpu-kit/robot` (source: `src/engine/robot-import.ts`) reads a URDF or an MJCF file and turns it into a scene of the rigid world, or adds it to a world that already exists. It has no dependencies: the XML parser is part of the module.

Read this before relying on a result:

- **The file's mass, centre of mass and inertia tensor are what the solver uses.** Where a link's collision shapes do not already have the file's `<inertial>`, the body is given it explicitly (`massData`, scene version 2). On the example arm the solver's principal moments are then within 5e-8 of the file's on every link, where the shapes alone were up to 42% off. A pendulum built from a file whose inertia is 1.3 × its shape's swings with the file's period to 8.6e-7. The numbers are set, not the shapes: collision still uses the file's collision geometry. `inertia: 'shapes'` gives the earlier behaviour (mass matched through the density, inertia from the shapes). [Mass and inertia](#mass-and-inertia) has the policy and the measured numbers.
- **One body per link.** A link with several collision shapes is one compound body. `links: 'welded'` gives the earlier one body per shape, held by welds.
- **Joints are soft.** The engine solves joints as constraints with a stiffness of 60 Hz by default. A loaded arm settles below its kinematic pose (17.0 mm at the tool of the 1 m example arm) and a chain stretches by millimetres. [Limits](#limits) has the measurements. `jointStiffness: {hertz: 240}` in the import options (or `stiffness` on any joint) cuts the same arm's largest tool displacement from 23.0 mm to 2.3 mm at 240 Hz stepping with 4 sub-steps.
- **Nothing is dropped silently.** Every element the import ignores, approximates or cannot represent is in `warnings`, with the element named.

## Use

```js
import {createWorld} from 'box3d-webgpu-kit';
import {parseURDF, robotToScene, robotReport, spawnRobot, robotLinkPose} from 'box3d-webgpu-kit/robot';
import {loadScene, sceneWorldOptions} from 'box3d-webgpu-kit/scene';

const robot = parseURDF(urdfText, {meshes: {'meshes/hand.stl': handBytes}});
for (const w of robot.warnings) console.warn(w.code, w.element, w.message);

// As a scene file: validate, load, save, share by link.
const scene = robotToScene(robot, {positions: {elbow: 0.6}});
const world = await createWorld(sceneWorldOptions(scene));
loadScene(world, scene);

// Or into a world you already have, with handles by name.
const arm = spawnRobot(world, robot, {position: [2, 0, 0], prefix: 'arm2:'});
world.setJointMotor(arm.joints.get('elbow'), {speed: 0.5, maxForce: 20});
const hand = arm.links.get('hand');
const pose = robotLinkPose(world.getState(hand.body), hand.frame);   // the link frame in the world

// How far the bodies are from the file.
const report = robotReport(robot);
console.table(report.links.map(l => ({link: l.link, kind: l.kind, mass: l.massActual, inertia: l.inertiaSource, fromShapesAlone: l.shapesPrincipalError})));
```

| Function | Result |
|---|---|
| `parseXML(text, limits?)` | An element tree. Throws `XMLParseError` with `line` and `column`. |
| `parseURDF(text, options?)`, `parseMJCF(text, options?)` | A `RobotDescription`: links, joints, the root, world settings, `warnings`. |
| `robotTree(description)` | Parent joint and child joints of every link, and the links parents first. |
| `robotKinematics(description, positions?)` | Pose of every link frame, in the robot's own axes. |
| `robotToScene(description, options?)` | A scene (`docs/SCENE_FORMAT.md`). |
| `robotReport(description, options?)` | Per-link mass and inertia against the file, shape stand-ins, the joint mapping, every warning. |
| `spawnRobot(world, description, options?)` | Bodies and joints in the world; handles by link and joint name; the scene and the report. |
| `robotLinkPose(bodyState, frame)` | World pose of a link frame. |
| `twoLinkArmURDF`, `cartPoleURDF`, `sixDofArmURDF`, `wheeledCartURDF`, `doublePendulumURDF`, `doublePendulumMJCF`, `hangingChainURDF`, `EXAMPLE_ROBOTS` | Example robots, as file text. |

Parse options: `meshes` (files by name), `missingMeshes: 'error' | 'box'`, `strict` (the first warning throws).

Scene options: `positions`, `floatingBase`, `selfCollision`, `jointStiffness`, `position`, `rotation`, `up`, `cylinders`, `cylinderSides`, `motors`, `hold`, `dampingHertz`, `defaultDensity`, `friction`, `restitution`, `world`, `neverSleeps`, `prefix`, `collisionGroup`, `links` (`'compound'` or `'welded'`), `inertia` (`'file'` or `'shapes'`). Each is described where it applies below.

A scene from `robotToScene` is scene version 2 when a link is a compound or was given mass data, and version 1 otherwise ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#versioning)). With `{links: 'welded', inertia: 'shapes'}` the seven example robots give, character for character, the scenes this import gave before the engine had compound bodies and explicit mass data (checked by hash when the options were added).

`spawnRobot` does not reset the world and does not apply the scene's world settings (gravity, ground, step): the world keeps its own. It creates the same bodies and joints as `robotToScene`, in the same order, so both ways give the same `exactHash` (tested for every example).

## Conventions

- **Units:** SI and radians. Joint positions passed to `positions` are radians or metres, also for an MJCF file written in degrees.
- **Quaternions** are `[x, y, z, w]`. MJCF writes `w` first; the parser reorders it.
- **Axes.** A description keeps the file's axes. URDF and MJCF are Z up and the engine's world is Y up, so `robotToScene` maps file `(x, y, z)` to world `(x, z, -y)` (`up: 'z'`, the default). `up: 'y'` keeps the axes. `position` and `rotation` then place the robot's origin in the world. Gravity is the file's (`<option gravity>`), or 9.81 m/s² down.
- **URDF `rpy`** is roll, pitch, yaw about fixed axes: `R = Rz(yaw) Ry(pitch) Rx(roll)`.
- **MJCF orientation:** `quat`, `euler` (with `compiler eulerseq`; lower-case letters turn about the moving axes, upper-case about fixed ones), `axisangle`, `xyaxes`, `zaxis`. Angles are degrees unless `compiler angle="radian"`.
- **Kinematics.** `T_child = T_parent · T_origin · T_motion(q)`. A revolute joint turns the child about its axis through the joint's anchor; a prismatic joint slides it along the axis. In URDF the anchor is the child link's origin; in MJCF it is the joint's `pos` in the body. An MJCF `ref` is the joint value of the pose the file describes; limits and spring references are shifted by it.
- **Joint frames.** The engine's revolute joint turns about its frame's z axis and its prismatic joint slides along x; the import aims the frames at the joint axis. The angle the solver reports (`getJointState(joint).value`) is the file's joint position (minus `ref`), positive about the axis.
- **Ids.** A body's id is its link's name and a joint's id is its joint's name, with characters outside `A-Z a-z 0-9 _ . : -` replaced by `_`. With `links: 'welded'`, a link with several shapes has bodies `name`, `name.2`, … welded by `name.weld2`, …. The base weld is `<root>.base`. `prefix` is put before every id so that two robots can share a world. Bodies carry `userData: {link}` and joints `userData: {joint, effort?, velocity?}`.
- **Link frames.** `scene.extensions.robot.links[name]` gives the body that carries each link frame and the frame's pose in that body's coordinates (`body: null`: in world coordinates). `spawnRobot` returns the same as `links.get(name)`. A body's origin is the centre of mass of its first shape (the heaviest), not the link origin and not necessarily the body's centre of mass, so use `robotLinkPose`.
- **The base.** The root link is welded to the world unless `floatingBase: true`. An MJCF model's root is the world body itself: a body without a joint is fixed, a body with a free joint is free, and `floatingBase` changes nothing.
- **Ground.** URDF: the scene has the engine's ground slab (top face at world y = 0) unless `world: {ground: false}`. MJCF: only when the model has a horizontal plane through the origin. A robot that should stand on the ground needs `floatingBase: true`.
- **Sleep.** Robot bodies are created with `neverSleeps` unless `neverSleeps: false`.

## URDF

| Element | Support |
|---|---|
| `<robot name>` | read |
| `<link>` `<inertial>`: `origin`, `mass`, `inertia` | read, and given to the body: mass, centre of mass (`origin xyz`) and the tensor, turned from the inertial frame (`origin rpy`) into the body's axes. A tensor that is not positive definite is reported and not applied |
| `<link>` `<collision>`: `origin`, `box`, `sphere`, `cylinder`, `mesh` with `scale` | read. A cylinder becomes a prism or a capsule (below); a mesh becomes its convex hull, at most 32 points |
| `<collision>` `capsule` (`radius`, `length` between the cap centres) | read (an extension some exporters write) |
| `<link>` `<visual>` | not read, except the colour of the first visual (`<material><color rgba>` or a named top-level material) |
| `<joint type="fixed">` | weld |
| `revolute`, `continuous` | revolute joint about the axis; `continuous` has no limits |
| `prismatic` | prismatic joint along the axis |
| `floating` | no joint: the child is free |
| `planar` | **unsupported**: reported, and the child is left free (6 degrees of freedom instead of 3) |
| `<origin xyz rpy>`, `<axis xyz>` (default `1 0 0`, normalised) | read |
| `<limit lower upper>` | joint limits. A revolute limit reaching beyond ±π from the reference position is reported and dropped (the engine measures a hinge angle in (−π, π]) |
| `<limit effort>` | recorded; the largest torque or force of the joint's motor when you ask for one (`motors`) |
| `<limit velocity>` | recorded in `userData`; the engine has no joint speed limit |
| `<dynamics damping>` | a joint spring-damper (below) |
| `<dynamics friction>` | a motor holding zero speed with the friction as its largest torque, which is dry friction. Dropped, with a warning, when `motors` drives the joint |
| `<mimic>` | **unsupported**: reported; the joint moves independently |
| `<calibration>`, `<safety_controller>`, `<transmission>`, `<gazebo>`, unknown elements | reported as ignored |
| Xacro | not expanded: run `xacro` first |

Errors, with the line and column where one element is at fault: a root that is not `<robot>`, a missing or duplicate name, a joint naming a link that does not exist, more or fewer than one root, a link with two parents (a closed loop), a cycle, a number that does not parse, a zero axis, a size that is not positive, `upper < lower`, an unknown joint type or collision shape, a mesh that was not supplied.

## MJCF

The common subset is read. MuJoCo has many features this import does not have; a model that depends on one of them loads, with a warning, and does not behave as in MuJoCo.

| Element | Support |
|---|---|
| `<mujoco model>` | read |
| `<compiler>` `angle`, `eulerseq`, `meshdir` (or `assetdir`), `autolimits`, `inertiafromgeom` | read. `coordinate="global"` is an error. Other attributes are reported |
| `<option>` `gravity`, `timestep` | read: scene gravity and step (a timestep above 1/30 s is reported and not used). Other attributes and `<flag>` are reported |
| `<default>` with nested `class`, and `childclass` on bodies | read, for `geom`, `joint`, `mesh`, `material` and the actuator shortcuts. A class starts from its parent's settings |
| `<asset>` `<mesh file scale>` or `<mesh vertex>`, `<material rgba>` | read. `<hfield>` is reported |
| `<worldbody>`, nested `<body>` with `pos` and `quat`, `euler`, `axisangle`, `xyaxes` or `zaxis` | read. The world body is the root link `world`; its geoms are static bodies |
| `<inertial>` `pos`, orientation, `mass`, `diaginertia` or `fullinertia` | read, and given to the body as for URDF. Without it, mass and inertia come from the geoms (`density`, default 1000 kg/m³, or `mass`), as in MuJoCo; where a geom has a stand-in (a cylinder as a prism, an ellipsoid as a hull) the body is given the exact shape's values |
| `<geom type>` `box`, `sphere`, `capsule`, `cylinder`, `mesh`, by `size` or `fromto` | read |
| `ellipsoid` | **approximated** and reported: a 42-point convex hull of the same volume (principal moments within 0.08% in the two cases measured) |
| `plane` | on the world: the horizontal plane through the origin is the engine's ground; any other plane is **approximated** by a static slab 88 m square. On a body: reported and dropped |
| `hfield`, `sdf` geoms | **unsupported**: reported and dropped |
| geom `friction` | the first value (sliding); default 1, as in MuJoCo. The engine combines two frictions by its own rule, not MuJoCo's maximum |
| geom `contype`, `conaffinity` | both 0: the geom does not collide and is skipped (reported if the body's mass was to come from it). Other values are reported; the geom collides with everything |
| `<joint type>` `hinge`, `slide`, `ball`, `<freejoint>` / `free` | revolute, prismatic, spherical, no joint. A body with no joint is welded to its parent |
| joint `pos`, `axis`, `range` (with `limited` and `autolimits`), `ref` | read |
| joint `damping`, `stiffness`, `springref` | a joint spring-damper (below) |
| joint `frictionloss` | dry friction, as for URDF |
| joint `armature` | recorded and reported: not modelled |
| joint `actuatorfrcrange` | the joint's effort limit |
| `range`, `damping`, `stiffness` on a ball joint | **unsupported**: reported |
| Several joints on one body | three hinges at one point with independent axes become one ball joint (**approximated**: ranges, damping and actuators are dropped). Any other combination is **unsupported**: the first joint is kept and the others are reported |
| `<actuator>` `<motor joint gear ctrlrange forcerange>` | the limit becomes the joint's effort; reported as a note. Nothing drives the joint until you do |
| `<position joint kp kv>` | a joint spring of stiffness `kp` towards 0 with damping `kv` (times `gear²`). `forcerange` is recorded but the spring is not force-limited |
| `<velocity joint kv>` | **approximated**: at zero command it is a damper, so `kv` is added to the joint's damping |
| `<general>`, `<cylinder>`, `<muscle>`, `<adhesion>`, …, and actuators on tendons or sites | **unsupported**: reported by name |
| `<equality>` (`connect`, `weld`, `joint`, `tendon`, `distance`) | **unsupported**: each is reported; the bodies or joints it ties move independently |
| `<tendon>` (`fixed`, `spatial`) | **unsupported**: each is reported; no force and no limit |
| `<contact>` `<exclude>` | bodies joined by a joint never collide here, so such an exclusion needs nothing. Between other bodies it is **unsupported** and reported (`selfCollision: false` stops all self-collision) |
| `<contact>` `<pair>` | **unsupported**: reported |
| `<include>`, and `<composite>`, `<flexcomp>`, `<replicate>`, `<frame>`, `<plugin>` inside a body | **unsupported**: reported; the element and what is inside it are dropped |
| `<sensor>`, `<keyframe>`, `<custom>`, `<extension>`, `<deformable>` | reported as ignored |
| `<site>`, `<camera>`, `<light>`, `<visual>`, `<statistic>`, `<size>`, textures | skipped without a warning: they do not change the motion |
| Any attribute of a geom, joint, body, inertial, mesh, compiler, option, motor, position or velocity element that the import does not use (`condim`, `solref`, `solimp`, `margin`, `integrator`, …) | reported by name |

## Meshes

The module does not read files. Pass them: `{meshes: {name: bytes or text}}` (an object or a `Map`). STL and GLB are bytes; OBJ and glTF may be text. Parsing is the geometry module's (`box3d-webgpu-kit/geometry`). COLLADA (`.dae`) is not read: convert it.

A name in the robot file is matched to a key in three steps, and both sides are normalised the same way (`normalizeMeshPath`: backslashes become `/`, a URI scheme such as `package://`, `file://` or `model://` is removed, and empty, `.` and `..` segments are resolved):

1. the key equals the name exactly as written;
2. the normalised key equals the normalised name;
3. one is a tail of the other by whole path segments (`package://arm/meshes/hand.stl` finds `meshes/hand.stl` or `hand.stl`; `meshes/hand.stl` finds `/ws/src/arm/meshes/hand.stl`). The longest match wins; two equally long matches are an error that lists them.

For MJCF, `meshdir` is put before the file name first.

A mesh that is not found is an error naming the file and the normalised name that was looked for. With `missingMeshes: 'box'` a box takes its place and a warning says so. The file's bounds are unknown, so the box is the solid box with the link's mass and inertia tensor (which reproduces the link's inertia exactly), or a 0.1 m cube times the mesh scale when the link has no usable inertial.

A mesh collides as its **convex hull** (at most 32 points) and its mass is spread over the hull. This is reported for every mesh. For a concave link, decompose the mesh yourself (`convexDecompose`) and write one collision per piece.

## From links to bodies

- A link with one collision shape is one body. Its origin is the shape's centre of mass.
- A link with several collision shapes is one **compound body** that holds every shape at its place in the link. The body's frame is that of the heaviest shape, which is listed first; the others are placed relative to it. Nothing holds the shapes together but the body itself, so the link is exactly rigid. A compound holds at most 64 shapes, which is also the description's limit per link.
- `links: 'welded'` makes one body per shape instead, each welded to the nearest one before it at the midpoint of their centres (the pattern `createBodiesFromMesh` uses). The heaviest shape carries the link's joints and keeps the link's name, and the bodies of one link share a negative collision group. Welds are constraints: measured on a T of two boxes caught by its joint limit, the two welded boxes move against each other by 0.53 mm. Such a link cannot be given the file's inertia (it is several bodies), so it keeps its shapes'.
- A link with mass and no collision shape is a box that collides with nothing and has **exactly** the file's mass and inertia tensor (the solid box with those principal moments, along the principal axes). If no box has that tensor because a principal moment is larger than the other two together, it is a 5 cm sphere that collides with nothing and is given the file's mass and tensor explicitly; a note says so. If a principal moment is zero or negative the tensor cannot be held at all: the sphere keeps its own inertia at the right mass, and a warning says so.
- A link with collision shapes and no mass is static scenery when it is rigidly fixed to the world, and otherwise gets `defaultDensity` (1000 kg/m³), with a warning.
- A link with neither is only a frame. Fixed to its parent, it rides on the parent's body. On a moving joint, the first link fixed to it that has a body stands in, and the fixed joints between them need no weld. If there is none, `robotToScene` throws, naming the link.

**Cylinders.** The engine has no cylinder. The default (`cylinders: 'hull'`) is a regular prism with `cylinderSides` sides (24; 8 to 32) whose cross-section has the circle's area, so that the volume is the cylinder's. Its flat ends and its rolling are those of a cylinder, which a capsule's are not: a thin wheel cannot be a capsule at all. `cylinders: 'capsule'` gives a capsule of the same radius and overall length, which is cheaper and smoother but rounder and lighter per volume.

| Stand-in | Volume error | Largest principal-moment error, at equal mass | Outline |
|---|---|---|---|
| 24-sided prism of the same volume | 0 (2.7e-8 after float32) | 0.0026% | corners 0.57% outside the circle, flats 0.29% inside |
| 32-sided prism | 0 (9e-9) | 0.0008% | corners 0.32% outside, flats 0.16% inside |
| 8-sided prism | 0 (4e-8) | 0.23% | corners 5.4% outside, flats 2.6% inside |
| capsule, for a cylinder of radius 0.03 m and length 0.4 m | −5.0% (`−2r / (3l)`) | 9.3% | hemispherical ends |

Both numbers are in `robotReport(...).shapes` for every stand-in (cylinder, ellipsoid, a capsule too short for the engine).

**Self-collision.** Bodies joined by a joint do not collide. With `selfCollision: false` the whole robot shares one negative collision group and nothing in it collides with anything else in it. With `links: 'welded'`, when a link has several bodies, "joined links do not collide" needs more than the joint's own flag, so each link gets a category bit and masks out its neighbours' (up to 63 links with bodies; beyond that a warning says that neighbouring bodies may collide). With one body per link no filter is needed, and none is written.

## Mass and inertia

**Policy.**

1. `density = link mass / collision volume`, one density for the link, so the shapes weigh what the file says. (MJCF bodies without `<inertial>` keep one density per geom, as the file gives it.) Overlapping collision shapes are counted twice in the volume.
2. The shapes at that density have a mass, a centre of mass and an inertia tensor. They are compared with the file's `<inertial>`. Where they differ by more than 1e-9 (relative, in mass or in the tensor about the file's centre of mass; or 1e-9 of the radius of gyration in the centre of mass), the body is given the file's values explicitly: mass, centre of mass in the body frame, and the tensor turned into the body's axes. Where they agree to 1e-9 nothing is set, and the scene is the version 1 scene it would have been.
3. `inertia: 'shapes'` stops after step 1.

The solver holds mass data in float32. A tensor that is not positive definite, or whose determinant underflows float32, is not applied; a note names the link and the shapes' inertia is used. The engine accepts any positive-definite tensor, including one no solid body could have (`I1 + I2 < I3`); the import does not check that. Setting the numbers does not change the collision shapes, so the shapes of a link can disagree with its dynamics as much as the file's do.

`robotReport` gives per link:

- `inertiaSource`: `'file'` when the body was given the file's values, `'shapes'` when it has its shapes'.
- `principalError`: `|actual − specified| / specified` for each principal moment about the centre of mass, sorted ascending; `maxPrincipalError` is the largest. A moment below 1e-9 of the largest is compared with the largest. "Actual" is what the solver is given, so it is 0 for a link with `inertiaSource: 'file'`.
- `tensorError`: the Frobenius norm of the difference of the two tensors, both about the file's centre of mass in the link frame, over the norm of the file's. It also sees a shifted centre of mass and turned principal axes, which sorted moments do not.
- `comOffset`: the distance between the file's centre of mass and the body's.
- `shapesPrincipalError`, `shapesTensorError`, `shapesComOffset`: with `inertiaSource: 'file'`, what the three numbers above would have been from the shapes alone.

When the worst link is more than 1% off, a warning with the number and the link is added. With the defaults that happens only for a link whose tensor cannot be held.

**Measured on the example robots** (`robotReport`; "in the solver" is `world.getMassData` on the spawned body against the file, float32):

| Robot | Link | Mass | From the shapes alone: largest principal-moment error, tensor error, centre-of-mass offset | Given the file's values | In the solver, against the file (measured for the six-joint arm only) |
|---|---|---|---|---|---|
| double pendulum (URDF and MJCF) | both | 1 kg, 0.6 kg | < 2e-12, < 2e-12, 0 | no (already equal) | |
| cart-pole | cart, pole | 1 kg, 0.2 kg | < 4e-12, < 3e-12, 0 | no | |
| two-link arm | base | 5 kg | < 4e-12, < 4e-12, 0 | no | |
| | upper arm, forearm (cylinders as prisms) | 2 kg, 1.2 kg | 0.0026%, 0.0001%, 0 | yes | |
| wheeled cart | chassis | 5 kg | < 4e-12, < 3e-12, 0 | no | |
| | four wheels (cylinders) | 0.5 kg each | 0.0026%, 0.0026%, 0 | yes | |
| hanging chain | each link (file: a cylinder's inertia; shape: a capsule) | 0.25 kg | 12.0%, 11.9%, 0 | yes | |
| six-joint arm | base (cylinder) | 6 kg | 0.0026%, 0.0024%, 0 | yes | 4.7e-8 at worst over the seven links; centre of mass within 3.5e-10 m |
| | turret (file: 1.15 × the cylinder's) | 4 kg | 13.0%, 13.0%, 0 | yes | |
| | upper arm (file: 0.9 × the box's) | 3 kg | 11.1%, 11.1%, 0 | yes | |
| | forearm (file: 1.1 × the box's) | 2 kg | 9.1%, 9.1%, 0 | yes | |
| | wrist (file: 0.85 × the cylinder's) | 1 kg | 17.7%, 17.6%, 0 | yes | |
| | hand (sphere) | 0.5 kg | 1.25%, 1.25%, 0 | yes | |
| | tool (two boxes as one compound; the file's tensor has a product of inertia) | 0.3 kg | **42.4%**, 47.4%, 4.4 mm | yes | |

With `inertia: 'shapes'` the tool link, as a compound body, has in the solver the tensor of its two boxes summed by parallel axes to 7.4e-8.

**What it does to the motion.** A rod hinged at its end, whose file claims 1.3 × the rod's transverse inertia, swings with the period of the file's inertia: 1.521212 s measured against 1.521210 s (8.6e-7). With `inertia: 'shapes'` it swings with the rod's own, 1.466971 s against 1.466970 s, which is 3.70% shorter; the measured ratio of the two runs is the predicted one to 1.1e-7.

**What it does not do.** Joint springs are solved from the file's stiffness and damping with the inertia the body has, so a link given the file's inertia gets a slightly different spring frequency than before. Holding an arm still is barely affected: the example arm settles 17.0 mm below its pose with the file's inertia and 17.7 mm with the shapes' ([Limits](#limits)).

## Joints

| File | Engine joint | Notes |
|---|---|---|
| fixed; an MJCF body without a joint | weld | not made between two link frames on one body |
| revolute, continuous, hinge | revolute about the axis | limits; motor; spring |
| prismatic, slide | prismatic along the axis | limits; motor; spring |
| ball; three hinges at one point | spherical | limits, damping and stiffness are reported, not imported |
| floating, free | none | |
| planar | none | reported: the child is free |

**Motors.** A file's effort limit is not a motor: by default joints are free and the effort is only recorded (`userData.effort`, `report.joints[i].effort`). `motors: {elbow: 0.5}` adds a motor at that speed (rad/s or m/s) whose largest torque is the file's effort; `{elbow: {speed, maxForce}}` overrides it; a joint without an effort limit needs `maxForce`. Speed 0 holds the joint against anything below the effort. After `spawnRobot`, `world.setJointMotor(robot.joints.get(name), …)` does the same.

**Holding a pose.** `hold: {hertz, dampingRatio?, joints?}` puts a spring on every moving joint (or those listed) towards the position it is built in. It replaces the file's stiffness and damping on those joints, with a note.

**Stiffness and damping.** The engine's joint spring takes a frequency `f` and a damping ratio `ζ` and acts on the joint's own effective mass `m` (for a hinge, `1 / (a · (I_A⁻¹ + I_B⁻¹) · a)` with the two bodies' inertia about their own centres; for a slider the corresponding translational mass). It then behaves as a stiffness `m (2πf)²` and a damping `2 m ζ (2πf)`. The import solves these for the file's stiffness `k` and damping `c`: `f = sqrt(k / m) / 2π`, `ζ = c / (2 sqrt(k m))`. `report.joints[i].spring` gives `hertz`, `dampingRatio`, `target`, the `stiffness` and `damping` they stand for and `effectiveMass`.

- A joint spring and a position servo on one joint are one spring: stiffnesses add and the target is their stiffness-weighted mean.
- Damping without stiffness is carried by a spring of `dampingHertz` (0.01 Hz), which adds a very small stiffness towards the starting position (2.1e-4 N m/rad in the test case). A note states the number.
- `m` is taken at the pose the robot is built in. For a slider whose anchor is off the centre of mass it changes with the pose.
- Measured: a hinge with stiffness 20 N m/rad swings with period `2π sqrt(I_pivot / k)` to 0.10%; a pendulum with damping 0.3 N m s/rad decays at `c / (2 I_pivot)` to 0.39%.

## Limits

**Joints are soft constraints.** Box3D gives each joint's constraint rows a stiffness of 60 Hz and a damping ratio of 2 by default (`constraintHertz`, `constraintDampingRatio` in its joint definition). A joint under a steady load is therefore displaced, by about `load / (m_reduced (2π · 60 Hz)²)`. Raising the step rate or the sub-steps does not remove it: the arm below settles at 17.0 mm at 240 Hz with 4 sub-steps, 16.8 mm with 8, 16.7 mm with 16, and 16.7 mm at 480 Hz with 8. The stiffness can be raised per joint (`JointOptions.stiffness`, `setJointStiffness`, `jointStiffness` here); sag falls as 1 / hertz² up to about a quarter of the sub-step rate (at 240 Hz the same arm moves 2.3 mm at most and settles at 1.4 mm). The measurements below are at the default stiffness, 240 Hz and 4 sub-steps, with the import's default options; the second number in brackets is with `{links: 'welded', inertia: 'shapes'}`, the import before compound links and file inertia.

| Case | Measured |
|---|---|
| Six-joint arm (16.8 kg, tool 1.0 m from the base), every joint held by a zero-speed motor at its effort limit | tool frame 23.0 mm (24.0) from its kinematic pose at most in 5 s, 17.0 mm (17.7) once settled; joint angles within 0.003 rad (0.004); largest joint-anchor gap 0.90 mm (0.91) |
| The same arm held by 60 Hz joint springs (`hold`) | 42.8 mm (44.5) at most, 29.2 mm (30.2) settled (the springs add their own sag) |
| 12-link chain (0.25 kg, 0.2 m links) hanging still | largest anchor gap 1.52 mm (1.52), at the hinge carrying ten links. The 60 Hz estimate is 1.38 mm |
| The same chain swinging from 1.2 rad for 10 s | largest anchor gap 3.65 mm (3.75) |
| 24-link chain | 3.17 mm (3.17) at rest, 7.64 mm (7.67) swinging |

The gap grows with the load a joint carries and falls with the mass of the two links it joins. A long chain of light links carrying a heavy payload is the worst case. The tool displacement of the arm is far larger than its anchor gaps because the same softness lets each joint tilt off its axis, and a tilt near the base moves the tool by the whole reach: once settled, the base weld is tilted by 0.0044 rad and the yaw hinge's two axes are 0.010 rad apart. There is no reduced-coordinate articulation solver; a robot that needs rigid joints under load is outside what this import can do today.

**Other limits.**

- Joint springs are integrated implicitly and damp: the undamped 20 N m/rad spring above loses amplitude at 0.10 /s, as a damping of 0.042 N m s/rad would (about `2 k Δt` with `Δt` the sub-step, 1/960 s).
- The base weld, and with `links: 'welded'` the welds inside a link, are the same soft constraints. A compound link has no welds.
- A compound body has one colour and one set of flags; the per-shape colour of a link's collisions is not kept (the first shape's is used). Per-shape friction is kept.
- A zero-speed motor holds velocity, not position: under a load just below its limit the joint creeps (3.7e-4 rad in 3 s with a limit 2% above the load).
- A revolute limit cannot reach beyond ±π from the reference position.
- Mesh collision is a convex hull of at most 32 points. Triangle meshes are static only in the engine.
- Cylinders as prisms roll slightly rough: the wheeled cart moves at 0.487 m/s where `ω r` is 0.5 m/s (−2.7%) and its chassis bobs by about half a millimetre. More sides (`cylinderSides: 32`) make the wheel rounder.
- MuJoCo combines friction, solves contact and integrates differently. No result here has been compared with MuJoCo or Gazebo on the same model.
- Armature, joint speed limits, tendons, equality constraints, mimic joints and planar joints are not modelled (each is reported).
- The description's limits: 4096 links, 4096 joints, 64 collision shapes per link.
- Not in the Lab's menus or the Studio: the module is a library. A scene from `robotToScene` opens in the Lab like any scene file or share link, and the Lab draws each shape of a compound link at its place.

## The XML parser

`parseXML` reads what robot files use: elements, attributes, text, comments, CDATA, the five predefined entities (`&lt; &gt; &amp; &quot; &apos;`) and numeric character references. It is not a general XML processor, on purpose:

- A `DOCTYPE` with an internal subset (where entities are declared) is refused at the `DOCTYPE`. An entity that is not predefined is an error. Nothing is ever expanded, so a "billion laughs" file fails at once without allocating, and nothing is ever fetched, so an external entity cannot read a file or make a request. A bare `<!DOCTYPE robot>` is skipped.
- Hard caps, each with a clear error: 16 MiB of text, 64 levels of nesting, 200,000 elements, 256 attributes per element, 256 characters per name (`XML_LIMITS`; pass lower ones as the second argument). The parser does not recurse, so a deep file fails on the cap and not on the stack.
- Every error is an `XMLParseError` (code `INVALID_PAYLOAD`) with the 1-based `line` and `column`: an unclosed or mismatched tag, a duplicate attribute, an unquoted value, `<` in a value, text outside the root, two roots, an unterminated comment or CDATA section, an illegal character reference.
- Namespaces are not interpreted: `xacro:macro` is just a name.

## Example robots

Functions that return file text, so there is nothing to fetch: `twoLinkArmURDF()` (a planar two-link arm on a post), `cartPoleURDF()` (a pendulum on a cart), `sixDofArmURDF()` (a serial six-joint arm from boxes, cylinders and a sphere, with roll-pitch-yaw offsets, a two-shape tool and inertia tensors that deliberately differ from the shapes'), `wheeledCartURDF()` (four continuous joints as wheels; build it with `floatingBase: true`), `doublePendulumURDF()` and `doublePendulumMJCF()` (the same robot in both formats), and `hangingChainURDF(n)` (a chain for measuring joint drift). `EXAMPLE_ROBOTS` lists them by name.

The two double-pendulum files give the same scene, character for character in canonical JSON, and the same `exactHash` after 600 steps. The MJCF file writes out a ground plane and a friction of 0.6 because MJCF's defaults (no ground, friction 1) differ from the URDF path's.

## Validation

`packages/box3d-kit/test/v15-robot.test.mjs` and, for compound links and the file's inertia, `packages/box3d-kit/test/v17-compound.test.mjs` run in the pull-request gate. The headline cases are in the validation registry (`validation/domains/robot.mjs`, `validation/domains/compound.mjs`) and their measured numbers are published in [`VALIDATION.md`](VALIDATION.md#robot-import-urdf-and-mjcf). Worlds are SI, 240 Hz with 4 sub-steps.

| Check | Expected | Measured | Tolerance |
|---|---|---|---|
| Forward kinematics, six-joint arm, 4 configurations: `robotKinematics` against the product of joint transforms | 0 | 1.1e-15 | 1e-12 |
| The same, read back from the spawned bodies (float32, Y up) | 0 | 6.4e-8 | 1e-6 |
| Double pendulum, URDF against MJCF: canonical scene JSON | identical | 0 characters differ | 0 |
| Double pendulum, URDF against MJCF: `exactHash` after 600 steps | identical | identical | 0 |
| Total mass of the six-joint arm, from the solver (`links: 'welded'`, `inertia: 'shapes'`) | 16.8 kg | 16.8 kg (−2.6e-8 rel.) | 2e-7 rel. |
| Six-joint arm, default options: largest principal-moment error in the solver against the file | 0 | 4.7e-8 | 2e-6 |
| The same: largest distance of a link's centre of mass from the file's | 0 | 3.5e-10 m | 1e-7 m |
| The same: bodies (the two-box tool link is one compound) | 7 | 7 | 0 |
| The two-box tool link as a compound with `inertia: 'shapes'`: principal moments in the solver against the sum by parallel axes | 0 | 7.4e-8 | 2e-6 |
| With `inertia: 'shapes'`: reported inertia error of the two-box tool link against a hand calculation | 0.4235674 | 0.4235674 | 1e-9 |
| Cylinder as a 24-sided prism: principal moments | equal | 2.6e-5 rel. | 3e-5 |
| One revolute link whose file states 1.3 × its shape's inertia: period | 1.521210 s | 1.521212 s (+8.6e-7) | 0.01% |
| The same with `inertia: 'shapes'`: period from the shape's inertia | 1.466970 s | 1.466971 s (+7.5e-7) | 0.1% |
| Ratio of the two measured periods, minus 1 | +3.69744% | +3.69745% (+1.1e-7) | 0.01% abs. |
| Cart-pole: coupled small-oscillation period | 1.532509 s | 1.532926 s (+0.027%) | 0.2% |
| Prismatic joint along gravity: speed after 2 s | 19.62 m/s | 19.62016 m/s (+8.1e-6) | 0.01% |
| Prismatic limit: travel at the stop | 30 m | 30.00006 m | 1 mm |
| Revolute limit: angle at the stop | 0.5 rad | 0.5005 rad | 0.002 rad |
| Motor with effort 1.02 × `m g d` holds a horizontal link: angle after 3 s | 0 | 3.7e-4 rad | 0.002 rad |
| Motor with effort 0.98 × `m g d`: angle after 3 s | > 0.2 rad | 0.348 rad | lower bound |
| Joint stiffness 20 N m/rad, no gravity: period | 0.640574 s | 0.641238 s (+0.10%) | 0.2% |
| Joint damping 0.3 N m s/rad under gravity: decay rate | 0.72158 /s | 0.71879 /s (−0.39%) | 1% |
| Six-joint arm held by motors, 5 s: largest tool displacement | 0 | 23.0 mm | 30 mm |
| Six-joint arm held by 60 Hz springs, 5 s | 0 | 42.8 mm | 50 mm |
| 12-link chain at rest: anchor gap against the 60 Hz estimate | 1.38 mm | 1.52 mm (+10%) | 15% |
| 12-link chain swinging, 10 s: largest anchor gap | 0 | 3.65 mm | 6 mm |
| Wheeled cart at rest: chassis height | 0.15 m | 0.15014 m | 1 mm |
| Wheeled cart, wheels at 5 rad/s: mean speed | 0.5 m/s | 0.4866 m/s (−2.7%) | 5% |
| Seven example robots: `validateScene` problems | 0 | 0 | 0 |
| Seven example robots: `spawnRobot`, `loadScene` and a share link, hash after 150 steps | identical | identical | 0 |

The test file also covers the XML parser (well-formed input, malformed input with positions, DOCTYPE and entity refusal, the caps), both parsers' errors, the exact warning lists for files with unsupported elements, meshes and the name matching, the joint mapping, collision filters, links of several shapes (welded and compound), and links without mass or shape.
