# Scene format (`box3d-scene`, versions 1 and 2)

A scene file is plain JSON that says how to build a scene: the world settings, the rigid bodies and the joints, and optionally water basins, cables, frames, cloths, sets of grains, deformable solids and heat grids coupled to those bodies ([Coupled sections](#coupled-sections-water-cables-frames), [Cloths and grains](#coupled-sections-cloths-and-grains), [Solids and heat](#coupled-sections-solids-and-heat)). It can be validated, loaded, saved, diffed, hashed and packed into a share link. The code is `src/engine/scene-format.ts`, published by the kit as `box3d-webgpu-kit/scene` (`packages/box3d-kit/src/scene.ts`) and used by the Physics Lab ([In the Physics Lab](#in-the-physics-lab)); the tests are `packages/box3d-kit/test/v12-scene.test.mjs`, for the coupled sections `packages/box3d-kit/test/v14-simulation.test.mjs`, and for version 2 `packages/box3d-kit/test/v17-compound.test.mjs`.

Version 2 adds two things to version 1 and changes nothing else: a body may be a **compound** of several shapes, and a body may state its **mass data** (mass, centre of mass, inertia tensor). A file that uses neither is a version 1 file. [Versioning](#versioning) has the rules.

The native solver cannot serialise its internal state. A scene file therefore describes how to **build** a scene, and may also carry the pose and velocity each body had when it was saved. [Save and resume](#save-and-resume) lists exactly what that does and does not restore.

Units are SI throughout: metres, kilograms (through density in kg/m³), seconds, radians. Quaternions are `[x, y, z, w]`. The y axis is up.

## Annotated example

```jsonc
{
  "format": "box3d-scene",          // required, exactly this
  "version": 1,                     // required: 1, or 2 when a body is a compound or has massData
  "units": "SI",                    // optional; "SI" is the only value
  "world": {
    "gravity": [0, -9.81, 0],       // m/s^2
    "ground": true,                 // the static 88 m x 88 m slab whose top is y = 0
    "seed": 1,
    "step": 0.016666666666666666,   // 1/60 s
    "subSteps": 4
  },
  "materials": {
    "steel": {"density": 7800, "friction": 0.4, "restitution": 0.1, "color": 12632256}
  },
  "bodies": [
    {
      "id": "ball",
      "shape": {"kind": "sphere", "radius": 0.25},
      "position": [0, 3, 0],
      "material": "steel",          // density, friction, restitution and color from the table
      "restitution": 0.5,           // an inline value overrides the material
      "filter": {"categoryBits": "2", "maskBits": "18446744073709551615"},
      "userData": {"label": "the ball"}
    },
    {
      "id": "ramp",
      "shape": {"kind": "mesh", "vertices": [0, 0, -4, 10, -3, -4, 10, -3, 4, 0, 0, 4], "indices": [0, 2, 1, 0, 3, 2]},
      "position": [0, 2, 0]         // mesh and height-field bodies are always static
    },
    {
      "id": "crate",
      "shape": {"kind": "box", "halfExtents": [0.5, 0.5, 0.5]},
      "position": [-3, 0.5, 0],
      "rotationEuler": [0, 45, 0]   // degrees; input only, see "Rotations"
    }
  ],
  "joints": [
    {
      "id": "rope",
      "type": "distance",
      "bodyA": null,                // null is the fixed world
      "bodyB": "ball",
      "frameA": {"position": [0, 5, 0]},
      "length": 2
    }
  ],
  "meta": {"title": "Sample", "author": "you", "created": "2026-11-11T00:00:00Z"},
  "extensions": {"my-editor": {"camera": [4, 3, 8]}}   // kept, never interpreted
}
```

(The comments are for this page. A scene file is strict JSON.)

## Schema

A key that is not listed here is an error, everywhere except inside `userData` and `extensions`. "Number" means a finite number that fits a float32, because that is what the rigid solver stores; in the `water`, `cables` and `frames` sections it means any finite float64, because those solvers are float64.

### Top level

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `format` | `"box3d-scene"` | yes | | |
| `version` | `1` or `2` | yes | | 2 is needed for a compound shape or `massData`. See [Versioning](#versioning). |
| `units` | `"SI"` | no | `"SI"` | |
| `world` | object | no | all defaults | |
| `materials` | object, name → material | no | `{}` | |
| `bodies` | array of bodies | yes | | May be empty. Built in this order. |
| `joints` | array of joints | no | `[]` | Built in this order, after all bodies. |
| `water` | array of basins | no | absent | See [Coupled sections](#coupled-sections-water-cables-frames). Needs a Simulation to run. |
| `cables` | array of cables | no | absent | |
| `frames` | array of frames | no | absent | |
| `cloths` | array of cloths | no | absent | See [Cloths and grains](#coupled-sections-cloths-and-grains). |
| `grains` | array of grain sets | no | absent | |
| `solids` | array of solids | no | absent | See [Solids and heat](#coupled-sections-solids-and-heat). |
| `heat` | array of heat grids | no | absent | |
| `meta` | object | no | | `title`, `description`, `author`, `created`: strings. `created` must be a date `Date.parse` accepts. |
| `extensions` | object | no | | Any JSON. Preserved by load, save, canonicalize and links; ignored otherwise. |

### `world`

| Key | Type | Default | Limits |
|---|---|---|---|
| `gravity` | `[x, y, z]` | `[0, -9.81, 0]` | |
| `ground` | boolean | `true` | |
| `seed` | integer | `1` | 0 to 4294967295 |
| `step` | number, seconds | `1/60` | in (0, 1/30] |
| `subSteps` | integer | `4` | 1 to 16 |

A `PhysicsWorld` fixes its step and sub-step count when it is created, so `loadScene` refuses a scene whose `step` or `subSteps` differ from the world's. Create the world with `createWorld(sceneWorldOptions(scene))`.

### `materials`

Each entry is `{density, friction, restitution, color?}`. `density` (kg/m³), `friction` and `restitution` are required and at least 0. `color` is an integer `0xRRGGBB`. A material name follows the id rule below.

A body names a material with `material`. Its own `density`, `friction`, `restitution` and `color` override the material's values one by one. Materials are resolved when a body is built; the solver holds no material table.

### Bodies

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | 1 to 64 of `A-Z a-z 0-9 _ . : -`. Unique among all bodies **and** joints. |
| `shape` | shape | yes | | One shape, or in version 2 a `compound` of up to 64. |
| `type` | `"static"`, `"kinematic"`, `"dynamic"` | no | `"dynamic"` | A mesh or height-field body is always static; any other value is an error there. |
| `position` | `[x, y, z]` | yes | | Centre of the body, world space. |
| `rotation` | `[x, y, z, w]` | no | identity | Length must be 1 ± 0.001. |
| `rotationEuler` | `[x, y, z]` degrees | no | | Input only. See [Rotations](#rotations). Not together with `rotation`. |
| `linearVelocity` | `[x, y, z]` m/s | no | zero | |
| `angularVelocity` | `[x, y, z]` rad/s | no | zero | |
| `material` | string | no | | Must be a key of `materials`. |
| `density` | number ≥ 0 | no | 1000 | |
| `friction` | number ≥ 0 | no | 0.6 | |
| `restitution` | number ≥ 0 | no | 0 | |
| `color` | integer 0 to 4294967295 | no | `0xB8C0CC` | `0xRRGGBB`; the top byte is a renderer material tag. |
| `bullet`, `sensor`, `hitEvents`, `neverSleeps`, `lockRotation` | boolean | no | `false` | As in `BodyOptions`. |
| `linearDamping`, `angularDamping` | number ≥ 0 | no | 0 | |
| `gravityScale` | number | no | 1 | |
| `filter` | object | no | | `categoryBits`, `maskBits`: unsigned 64-bit integers as **decimal strings** (`"0"` to `"18446744073709551615"`, no sign, no leading zero, no hex); give both or neither. `groupIndex`: int32. |
| `massData` | object | no | | Version 2. See [Mass data](#mass-data-version-2). Not on a mesh or height field. |
| `userData` | object | no | | Any JSON, for the application. Carried, never interpreted. |

### Shapes

| `kind` | Keys | Rules |
|---|---|---|
| `box` | `halfExtents: [x, y, z]` | each ≥ 0.0001 |
| `sphere` | `radius` | ≥ 0.0001 |
| `capsule` | `radius`, `halfLength` | radius ≥ 0.0001, halfLength ≥ 0.0025. The axis is the body's local y; `halfLength` is half the distance between the cap centres. |
| `hull` | `points: [x, y, z, ...]` | 4 to 4096 points that do not lie in one plane. Box3D keeps at most 64 hull vertices. |
| `mesh` | `vertices: [x, y, z, ...]`, `indices: [a, b, c, ...]` | at least 3 vertices and 1 triangle; every index an integer below the vertex count; counter-clockwise triangles. Static. |
| `heightfield` | `heights`, `countX`, `countZ`, `spacing: [dx, dz]` | `countX`, `countZ` in 2..4096; `heights` holds `countX * countZ` values (index `x + z * countX`); spacing ≥ 0.0001. Starts at the body position and extends along +x and +z. Static. |

| `compound` (version 2) | `shapes: [child, ...]` | 1 to 64 children. See below. |

Geometry is inline, as plain arrays of numbers.

### Compound shapes (version 2)

A compound puts several convex shapes on one body. The body's `position` and `rotation` place a frame; each child is placed in that frame. The engine sums the children's mass, centre of mass and inertia (parallel-axis theorem), so the body's centre of mass is wherever the shapes put it, which need not be the body's `position`. Shapes that overlap count their overlap twice.

```jsonc
{
  "id": "hammer",
  "position": [0, 2, 0],
  "material": "steel",
  "shape": {"kind": "compound", "shapes": [
    {"shape": {"kind": "capsule", "radius": 0.02, "halfLength": 0.25}, "density": 600, "friction": 0.9},   // the handle, along the body's y
    {"shape": {"kind": "box", "halfExtents": [0.08, 0.04, 0.04]}, "position": [0, 0.29, 0]}                // the head, with the body's material
  ]}
}
```

| Child key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `shape` | `box`, `sphere`, `capsule` or `hull` | yes | | A mesh, a height field or another compound is an error. |
| `position` | `[x, y, z]` | no | origin | The child's origin in the body frame. |
| `rotation` | `[x, y, z, w]` | no | identity | The child's orientation in the body frame. A capsule's axis is the child's local y. |
| `rotationEuler` | `[x, y, z]` degrees | no | | Input only, as on a body. |
| `density`, `friction`, `restitution` | number ≥ 0 | no | the body's | Each overrides the body's value (inline, or from its material) for this child. A density of 0 gives a shape that collides and adds no mass. |

The body's `color`, flags (`sensor`, `hitEvents`, …) and `filter` apply to every child. Contact and hit events name the body, not the child. A compound body can be of any type. In the coupled sections a compound cannot float in a basin and cannot be attached to a cable or a frame: both couplings take a body's position as its centre of mass, which a compound's need not be.

### Mass data (version 2)

`massData` replaces the mass, centre of mass and inertia the shape and its density give. The shape still decides how the body collides.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mass` | number > 0 | yes | | kg. |
| `center` | `[x, y, z]` | no | origin | Centre of mass in the body frame, m. |
| `inertia` | `[Ixx, Iyy, Izz, Ixy, Ixz, Iyz]` | yes | | The inertia tensor about the centre of mass, in body axes, kg·m². These are the matrix entries, so a product of inertia is `Ixy = −∫ x y dm`. It must be positive definite, and remain so in float32. |

```jsonc
{"id": "flywheel", "position": [2, 1, 0], "shape": {"kind": "sphere", "radius": 0.2},
 "massData": {"mass": 12, "inertia": [0.9, 0.9, 1.6, 0, 0, 0]}}
```

- The values act while the body is dynamic. A static or kinematic body keeps them for when it is made dynamic.
- A body with `lockRotation` takes the mass and the centre and keeps no inertia.
- In the coupled sections, a body with `massData` needs an explicit `inertia` on every attachment (the coupling cannot take it from the shape), and a body whose `center` is not the origin can neither be attached nor float, for the reason given for compounds. A floating body with `massData` at its origin is accepted; that combination has no test.
- The validator checks that the tensor is positive definite. It does not check that a real object could have it: the triangle inequality of the principal moments (`I1 + I2 ≥ I3`) is not required, and neither is agreement with the collision shape.
- The body's `position` is still the origin of its frame. `linearVelocity` is the velocity of that origin; the solver's own linear velocity (`getState`) is that of the centre of mass and differs by `ω × (R center)` for a spinning body. [Save and resume](#save-and-resume) says how a save handles that.

### Joints

| Key | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Same rule and same namespace as body ids. |
| `type` | `"weld"`, `"revolute"`, `"spherical"`, `"prismatic"`, `"distance"`, `"wheel"` | yes | |
| `bodyA`, `bodyB` | body id or `null` | yes | `null` is the fixed world. They must differ, and not both be `null`. |
| `frameA`, `frameB` | `{position?, rotation?, rotationEuler?}` | no | Local to each body. Default: origin, identity. |
| `collideConnected` | boolean | no | Default `false`. |
| `limits` | `{lower, upper}` | no | `upper ≥ lower`. Angle (rad), travel (m) or length (m); twist on a spherical joint. |
| `motor` | `{speed, maxForce}` | no | `maxForce ≥ 0`. rad/s or m/s; N or N·m. |
| `spring` | `{hertz, dampingRatio, target?}` | no | `hertz`, `dampingRatio` ≥ 0. |
| `length` | number > 0 | distance joints | Rest length in metres. |
| `coneAngle` | number in [0, π] | no | Spherical joints: cone half-angle. |
| `stiffness` | `{hertz, dampingRatio?}` | no | How stiffly the joint holds its bodies together. Default 60 Hz with damping ratio 2. |
| `userData` | object | no | |

Revolute and wheel joints turn about the frame's z axis. Prismatic travel and wheel suspension run along frame A's x axis. A spherical joint's cone is about the frame's z axis.

Which optional settings a joint type takes (anything else is an error):

| Type | Takes |
|---|---|
| `weld` | `spring` |
| `revolute` | `limits`, `motor`, `spring` |
| `spherical` | `limits`, `spring`, `coneAngle` |
| `prismatic` | `limits`, `motor`, `spring` |
| `distance` | `length`, `limits`, `motor`, `spring` |
| `wheel` | `limits`, `motor`, `spring` |

Wheel steering (`setJointSteering`) is a runtime call, not part of `JointOptions`, and is not in the format.

### Rotations

`rotationEuler` is for files written by hand. It holds degrees about the X, Y and Z axes, combined as `q = qx · qy · qz`: a vector is turned about Z first, then Y, then X (the three.js `'XYZ'` order). `normalizeScene`, `canonicalize`, `loadScene` and the link encoder turn it into `rotation`; a saved or canonical scene never contains `rotationEuler`. `eulerToQuaternion` is exported.

## Coupled sections: water, cables, frames

Three optional top-level arrays describe solvers that are coupled to the scene's bodies. A scene that has any of them is a *coupled scene*: it is stepped by a `Simulation` ([`SIMULATION.md`](SIMULATION.md)), which the kit's `loadScene` returns. Ids of basins, cables and frames share the namespace of body and joint ids. Numbers in these sections are float64. The solvers take the world's `step` and `gravity`; neither is repeated here.

### `water`: basins

One closed, flat-bottom shallow-water basin per entry ([`WATER_COUPLING.md`](WATER_COUPLING.md)). At most 8 basins of at most 65,536 cells each.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `cols`, `rows` | integer ≥ 3 | yes | | Cells along world x and z. |
| `dx`, `dz` | number > 0 | yes | | Cell size, m. `step · sqrt(g · restDepth) · hypot(1/dx, 1/dz)` must be at most 0.8; the validator checks it with the scene's step and gravity. |
| `restDepth` | number > 0 | yes | | m. |
| `origin` | `[x, y, z]` | yes | | The basin floor at the grid's minimum-x, minimum-z corner. |
| `density` | number > 0 | no | 1000 | kg/m³. |
| `waterDrag` | number ≥ 0 | no | 0 | Bottom friction, 1/s. |
| `eta`, `u`, `v` | `cols · rows` numbers each | no | zero | State: surface elevation above rest (m) and the two face velocities (m/s), exactly as the solver holds them (the velocities are half a step behind `eta`). A save writes them. |
| `bodies` | array | no | `[]` | The bodies that float: `{body, dragCoefficient?, referenceArea?, linearDrag?, angularDrag?}`. `body` is the id of a box, sphere or capsule body; the drag options are those of `WaterCoupling.attach` and take its defaults. A body may be in one basin only. |

The basin's floor and walls are not bodies. Put a static body where the floor is if something may sink.

### `cables`

One tension-only cable per entry ([`COMPLIANT_CABLE.md`](COMPLIANT_CABLE.md), [`NONLINEAR_CABLE.md`](NONLINEAR_CABLE.md)). At most 1,024 cables of at most 16,384 nodes.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `solver` | `"proximal"` or `"xpbd"` | no | `"proximal"` | |
| `nodes` | `[x, y, z, ...]` | yes | | Node positions, m. A save writes the current ones. |
| `masses` | one number per node | yes | | kg, 1e-9 to 1e12. At least 2 nodes. |
| `pinned` | 0 or 1 per node | no | all 0 | 1 is a fixed anchor in the world. |
| `velocities` | `[x, y, z, ...]` | no | zero | m/s. Zero on pinned nodes. |
| `segments` | array of `{a, b, restLength, compliance}` | yes | | `a ≠ b` are node indices; `restLength` in m; `compliance` in m/N is `restLength / (E A)`, and 0 is inextensible. |
| `substeps` | integer 1..16 | no | 1 | A cable with `drag` needs 1. |
| `maxIterations` | integer | no | 64 | Up to 4096 (proximal) or 256 (xpbd). |
| `residualTolerance` | number in [0, 0.01] | no | 1e-10 | |
| `forceTolerance` | number in [0, 1] | no | 1e-6 | N; proximal solver only. |
| `drag` | number in [0, 1000] | no | 0 | Mass-proportional damping, 1/s. |
| `attachments` | array | no | `[]` | See below. |

A cable attachment ties a free node (not pinned, with a segment, attached once) to one carrier:

- `{node, body, inertia?, localPoint?}`: a point fixed on a body. The cable pulls on the body there.
- `{node, frame, frameNode}`: a node of a frame of this scene.

### `frames`

One linear beam frame per entry ([`FRAME_MECHANICS.md`](FRAME_MECHANICS.md)). At most 64 frames of at most 4,096 nodes and 8,192 elements. A coupled frame steps with one sub-step.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `nodes` | `[x, y, z, ...]` | yes | | Rest positions, m. At least 2 nodes. |
| `elements` | array | yes | | `{a, b, youngModulus, shearModulus, area, iy, iz, torsionConstant, density, up}`: all required, SI. `up` is a direction with components in [-1, 1] that is not parallel to the element. |
| `fixed` | six 0 or 1 per node | no | all 0 | Translation x, y, z, then rotation x, y, z. 1 holds the degree of freedom at zero. |
| `pointMasses` | one number per node | no | zero | kg. |
| `pointInertias` | three numbers per node | no | zero | kg·m². |
| `displacements`, `velocities` | six numbers per node | no | zero | State. Zero on fixed degrees of freedom. A save writes them. |
| `drag` | number in [0, 1000] | no | 0 | 1/s. |
| `maxIterations` | integer 1..1024 | no | 1024 | |
| `forceTolerance`, `momentTolerance`, `impulseTolerance`, `angularImpulseTolerance` | number | no | 1e-9, 1e-9, 1e-10, 1e-10 | N, N·m, N·s, N·m·s. |
| `attachments` | array | no | `[]` | `{node, body, mode?, inertia?, localPoint?}`. `mode` is `"pinned"` (default; forces only) or `"clamped"` (forces and moments). All attachments of all frames together may need at most 96 equations: 3 per pinned, 6 per clamped. |

### Attachments to bodies

- `inertia` is the body's rotational inertia, which the world does not report: `{kind: "box", halfExtents}`, `{kind: "sphere", radius}`, `{kind: "capsule", radius, halfLength}`, `{kind: "principal", moments: [Ix, Iy, Iz]}` or `{kind: "locked"}`. When it is left out it is taken from the body's shape, which works for a box, a sphere or a capsule; for any other shape it is required.
- `localPoint` is the attachment point in body axes. When it is left out, it is where the node is when the scene is built. State `[0, 0, 0]` for an attachment at the centre of mass: the body's position is a float32 and the node's a float64, so the computed offset is otherwise one rounding step, not zero.
- The body's `gravityScale` is passed on.
- Attached bodies should have `neverSleeps: true`: the couplings do not wake bodies.

### What is built, and in which order

After the bodies and joints: every frame, then every cable, in file order; one structure coupling that is handed all of them; the cables' attachments, cable by cable in file order; the frames' attachments; then each basin and its bodies. The order is part of the format: it fixes the bits of a run. `loadScene` returns the basins, cables, frames, the coupling and the live attachment reports next to the bodies and joints ([`SIMULATION.md`](SIMULATION.md#scenes)).

### Coupled sections: cloths and grains

Two more optional arrays, added on 2026-11-11 under the same rules as `water`, `cables` and `frames` (see [Versioning](#versioning)). Ids share the namespace of bodies and joints. Numbers are float64. Both solvers take the world's `step` and `gravity`.

#### `cloths`

One cloth per entry, solved together with the rigid bodies it touches ([`CLOTH.md`](CLOTH.md); `ClothCoupling` and `clothSubsystem`, couple stage, order 150). Backward Euler, at the world's step. At most 16 cloths of at most 16,384 nodes and 32,768 triangles.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `nodes` | `[x, y, z, ...]` | yes | | 3 or more nodes, m. A save writes the current ones. |
| `restNodes` | `[x, y, z, ...]` | no | `nodes` | The stress-free shape. A save of a moved cloth writes it, so a resumed cloth keeps its rest shape. |
| `triangles` | `[a, b, c, ...]` | yes | | Node indices, three different ones per triangle, consistently oriented (the solver refuses a mesh that is not, or an edge shared by three triangles). |
| `velocities` | `[x, y, z, ...]` | no | zero | m/s. |
| `material` | object | yes | | `arealDensity` (kg/m², > 0), `youngModulus` (Pa, ≥ 0), `thickness` (m), `poissonRatio` (−0.99 to 0.499), and optionally `membrane` (`"stvk"` or `"spring"`), `bending` (`"koiter"`, `"hinge"` or `"none"`), `bendingStiffness` (N m). |
| `pinned` | node indices, ascending | no | none | Held where they are. |
| `extraMass` | one number per node | no | zero | kg. |
| `drag` | number ≥ 0 | no | 0 | 1/s. |
| `maxNewtonIterations`, `residualTolerance`, `forceTolerance`, `maxCgIterations`, `cgTolerance` | number | no | 60, 1e-6, 0, 600, 1e-2 | The solver's. |
| `contact` | `{offset?, stiffness?, skin?}` | no | the solver's | |
| `selfCollision` | `{thickness, stiffness?, capacity?}` | no | off | |
| `bodies` | array | no | `[]` | `{body, friction?, collide?, twoWay?, inertia?}`: a box, sphere or capsule body the cloth touches. A dynamic body is pushed by the cloth unless `twoWay` is false. A body may be listed once per cloth. |
| `planes` | array | no | `[]` | `{normal, point?, friction?}`: a fixed half space the cloth cannot enter that is not a body (for example the ground). |
| `attachments` | array | no | `[]` | `{node, body, localPoint?}`: a free node fixed to a point of one of the cloth's `bodies`. |

#### `grains`

One set of spherical grains by the discrete element method per entry ([`GRANULAR.md`](GRANULAR.md); `GranularCoupling` and `granularSubsystem`, couple stage, order 160). At most 8 sets of at most 65,536 grains and 256 fixed walls.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `material` | object | yes | | `density` (kg/m³), `restitution` (0.05 to 1), `friction`, optionally `rollingFriction`; `youngModulus` and `poissonRatio` are required by the Hertz law. |
| `law` | `"hertz"` or `"linear"` | no | `"hertz"` | |
| `normalStiffness` | N/m | with `linear` only | | Required by the linear law, refused with Hertz. |
| `tangentialStiffnessRatio`, `tangentialDamping`, `skin` | number | no | 2/7, 1, the solver's | |
| `substeps` | integer 1..4096 | yes | | Grain steps in one world step: the grains step at `world.step / substeps`. The scene is refused when the build finds that step above the solver's stability limit (`Scene grains "<id>": ... critical time`). |
| `bounds` | `{min, max}` | no | none | Grains that leave this box are removed (and counted in the events). |
| `positions` | `[x, y, z, ...]` | yes | | One triple per grain. A save writes the grains that are left. |
| `radii` | one number per grain | yes | | m. |
| `velocities`, `angularVelocities` | `[x, y, z, ...]` | no | zero | |
| `walls` | array | no | `[]` | `{shape, position?, rotation?, friction?, rollingFriction?, restitution?}`: fixed walls only the grains feel. `shape` is `plane` (`normal`), `box`, `sphere`, `capsule`, `cylinder` (`radius`, `from`, `to`, `axis?`), `annulus` (`innerRadius`, `outerRadius`, `offset?`, `axis?`) or `frustum` (`r0`, `z0`, `r1`, `z1`, `axis?`), as `Granular.addWall` takes them. |
| `bodies` | array | no | `[]` | `{body, friction?, rollingFriction?, restitution?, twoWay?, inertia?}`: a box, sphere or capsule body the grains touch and, when it is dynamic, push. |

Build order, after the frames, cables and their attachments: every cloth in file order (its bodies, planes, then attachments), then every grain set in file order (its walls, then its bodies, then the grains), then the basins. A dynamic body that a cloth or grains push and that no cable or frame carries is counted in the ledger's `rigid` entry. As for the other sections, a body named here cannot be a compound or have an off-origin `massData.center`.

A save writes each cloth's node positions and velocities (and its `restNodes`) and each grain set's live grains with their velocities and spins. Not saved: the cloth's contact state and the support-load estimate of the coupling (both rebuilt in the first steps), and the grains' contact history (tangential springs), which restarts from zero. A run resumed from a saved scene therefore starts from bit-identical fields and then differs slightly, as for the other sections; two loads of the same saved scene stay bit-identical (`tests/physics/lab-coupled-scenes.test.mjs`). To continue a run exactly, save a checkpoint instead of a scene ([`CHECKPOINTS.md`](CHECKPOINTS.md)): it holds the contact state, the support estimate and the tangential springs too.

Heat solvers, deformable solids and fracture bodies have their own sections, below.

### Coupled sections: solids and heat

Two more optional arrays, added on 2026-11-12 under the same rules (see [Versioning](#versioning)). Ids share the namespace of bodies and joints. Numbers are float64.

#### `solids`

One tetrahedral solid per entry ([`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)). Without `contact` or `fracture` it is a `SolidBody` stepped by `solidSubsystem` (post stage); with `contact` it is coupled two-way to the bodies it touches by `SolidCoupling` and `solidContactSubsystem` (couple stage, order 170, [`SOLID_CONTACT.md`](SOLID_CONTACT.md)); with `fracture` it is a `FractureBody` stepped by `fractureSubsystem` (post stage, [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md)). Each is registered under the solid's id. At most 8 solids of at most 20,000 nodes and 60,000 tetrahedra.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `mesh` | object | yes | | `{box: {size, cells, origin?, pattern?}}`: a box split into tetrahedra (`boxMesh`, five per cell, or six with `pattern: "kuhn6"`); or `{positions, tets}`: x, y, z per node and four node indices per tetrahedron. |
| `material` | object | yes | | `youngModulus` (Pa), `poissonRatio` (−0.99 to 0.4999), `density` (kg/m³), `thermalExpansion` (1/K, default 0). |
| `model` | `"linear"`, `"corotational"` or `"neo-hookean"` | no | `"corotational"` | A solid with `fracture` is linear and takes no other value. |
| `integrator` | `"backward-euler"`, `"midpoint"` or `"explicit"` | no | `"backward-euler"` | A solid in contact uses backward Euler only; an explicit solid is refused at build when its step is above its stability limit. |
| `substeps` | integer 1..64 | no | 1 | Solid steps in one world step. A solid in contact takes exactly one. |
| `massDamping`, `stiffnessDamping` | number ≥ 0 | no | 0 | Rayleigh damping, 1/s and s. A solid with fracture has mass damping only. |
| `tolerance`, `maxNewtonIterations` | number | no | the solver's | |
| `gravity` | boolean | no | true | False: the world's gravity does not act on the solid. |
| `supports` | array | no | `[]` | `{min, max, axes?}`: nodes whose reference position is inside the box (bounds widened by 10⁻⁹ of the coordinate) are held where they are, in the components `axes` marks (default all three). |
| `contact` | object | no | none | `{bodies?, planes?, stiffnessScale?, skin?, frictionPasses?, frictionTolerance?}`. `bodies`: `{body, friction?, collide?, twoWay?, inertia?}` for a box, sphere or capsule body; `planes`: `{normal, point?, friction?}`, fixed half spaces. Not with `fracture`. |
| `welds` | array | no | `[]` | `{body, min, max}`: nodes in the box are welded to the body where they are when the scene is built. The body must be in `contact.bodies` (with `collide: false` when it should only carry the weld). |
| `loads` | array | no | `[]` | `{body, min, max}`: the force that holds `body` up, measured from its motion in each rigid step (`m (Δv / Δt − g)`), is put, reversed, on the solid's boundary faces whose centroid is in the box, as a uniform traction (`reactionLoadLink`, one-way). For a body that rests on a fixed carrier over the solid and touches nothing else: every force the world puts on the body is counted. |
| `fracture` | object | no | none | `{strength, toughness, shearWeight?, initialOpeningRatio?, insertion?, insertionThreshold?, tipInsertionThreshold?, notches?, interfaces?}`: cohesive fracture, `strength` σ_c in Pa and `toughness` G_c in J/m². `notches`: boxes; interior faces whose centroid is in one are cut before the first step (`precrack`). `interfaces`: boxes; interior faces there get an undamaged interface before the first step (`insertCohesive`); with `insertion: "manual"` no other face can crack. The crack-band model is not available in scenes. |
| `displacements`, `velocities` | `[x, y, z, ...]` | no | zero | Saved state, one triple per node. For a cracked solid there are more nodes than in the mesh: the order is the one a load of the saved `cracks` gives (below). |
| `cracks` | array | no | none | Saved interfaces of a solid with `fracture`: `{face, history, mix?, open?}`, the interior face, the largest effective opening so far at its three node pairs (m), the mode share and whether it lost all traction (`FractureBody.crackState`). |

#### `heat`

Heat conduction in one solid per entry ([`HEAT_TRANSFER.md`](HEAT_TRANSFER.md); `heatSubsystem`, post stage), with the one-way link that makes its temperature the solid's thermal strain (`thermalSolidLink`, registered as `<id>:solid`). The grid is the solid's box: one heat cell per cell of its `mesh.box`, so the solid must have a box mesh, and a solid has at most one heat grid.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `solid` | solid id | yes | | A solid with a `box` mesh. |
| `material` | object | yes | | `conductivity` (W/(m K)), `density` (kg/m³), `specificHeat` (J/(kg K)). |
| `temperature` | number or one number per cell | yes | | K. Cell (i, j, k) is at `i + nx (j + ny k)`. A save writes the field. |
| `reference` | number | no | `temperature` | The stress-free temperature, K. Required when `temperature` is a field. |
| `scheme` | `"backward-euler"`, `"crank-nicolson"` or `"explicit"` | no | `"backward-euler"` | An explicit grid is refused at build when its step is above the stability limit. |
| `substeps` | integer 1..256 | no | 1 | Heat steps in one world step. |
| `boundaries` | array | no | `[]` (insulated) | `{face, type, ..., region?}` with `face` one of `x-`, `x+`, `y-`, `y+`, `z-`, `z+` and `type` `temperature` (`temperature`), `flux` (`flux`, W/m² into the solid), `convection` (`coefficient`, `ambient`) or `radiation` (`emissivity`, `environment`); `region` is `{min, max}` in cell indices, inclusive. |

Build order, after the grain sets: every solid in file order (mesh, notches and interfaces, saved cracks, supports, saved state, contact bodies and planes, welds, loads), then every heat grid (the solid takes the thermal strain of the given field at once), then the basins. A dynamic body a solid touches two-way or loads is counted in the ledger's `rigid` entry. A solid or heat grid the engine refuses leaves the world reset, with `Scene solid "<id>":` or `Scene heat "<id>":` in the error.

A save writes each solid's displacements and velocities, each cracked solid's interfaces, and each heat grid's temperatures (and its `reference`). Not saved: the contact state of a solid in contact (friction anchors, the coupling's support estimate), the energy counters and events of a fracture body, and the heat grid's boundary energy and clock. **Cracked solids.** The saved interfaces are put back in one batch, so nodes are split as the final set of interfaces requires and numbered in the order one insertion gives, which can differ from the order of the run that was saved; the save writes the displacements in the order the load will use (a node is identified by its node in the mesh and the lowest element that holds it). A reopened cracked solid has the same nodes, interfaces, crack area and node positions bit for bit (`tests/physics/lab-coupled-scenes.test.mjs`). As for the other sections, a run resumed from the saved scene then differs slightly from the run that was saved; two loads of one save stay bit-identical. A checkpoint ([`CHECKPOINTS.md`](CHECKPOINTS.md)) holds what a scene save leaves out, and a run resumed from it is bit-identical.

### Coupled section: fluids

One more optional array, added on 2026-11-12 under the same rules (see [Versioning](#versioning)). Ids share the namespace of bodies and joints. Numbers are float64. The solvers are those of [`FLUID.md`](FLUID.md); a fluid takes the world's gravity (unless a flow says `gravity: false`) and steps at the world step divided by `substeps`.

#### `fluids`

Each entry is a box of `cells` cubic cells of edge `spacing` from `origin`, and one of two kinds:

- **`"flow"`** (the default): incompressible Navier–Stokes on a staggered grid (`Fluid`). The `bodies` it lists are moving obstacles: a `FluidCoupling` reads their pose and velocity before each rigid step and hands each dynamic two-way body the mean force and torque of the fluid (buoyancy included); registered as `fluidSubsystem` in the couple stage, order 180. A flow without bodies is a bare `Fluid` in the post stage (order 510).
- **`"free-surface"`**: an inviscid liquid carried by particles (APIC) in a closed tank of free-slip walls (`FreeSurfaceFluid`), started from the `liquid` boxes; no bodies; `freeSurfaceSubsystem`, post stage, order 520.

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | string | yes | | |
| `kind` | `"flow"` or `"free-surface"` | no | `"flow"` | |
| `cells` | `[nx, ny, nz]` integers | yes | | At least 1 each (2 along x and y for a tank); at most 262,144 together. One cell along z with periodic z sides is a 2D flow. |
| `spacing` | number > 0 | yes | | Cell edge, m. |
| `origin` | vec3 | no | `[0, 0, 0]` | The corner with the smallest coordinates. |
| `density` | number > 0 | yes | | kg/m³. |
| `substeps` | integer 1..64 | no | 1 | Fluid steps in one world step. A flow with bodies must step at the world step: use `substeps: 1` there. |
| `viscosity` | number ≥ 0 | flow: yes | | Dynamic viscosity, Pa s. |
| `gravity` | boolean | no | `true` | Flow only. `false`: no gravity in the fluid (needed with an outflow side along which gravity acts, see below). |
| `boundaries` | object | no | no-slip on every side | Flow only. Keys `xMin`, `xMax`, `yMin`, `yMax`, `zMin`, `zMax`; each `"no-slip"`, `"free-slip"`, `"outflow"` (p = 0), `"periodic"` (both sides of an axis), or `{type: "no-slip", velocity}` (a sliding wall: its normal component must be 0) or `{type: "inflow", velocity}`. |
| `advection` | `"central"` or `"upwind"` | no | `"central"` | Flow only. |
| `diffusion` | `"explicit"`, `"crank-nicolson"` or `"backward-euler"` | no | `"explicit"` | Flow only. |
| `velocity` | vec3 | no | `[0, 0, 0]` | Flow only. A uniform starting velocity, made divergence-free. |
| `bodies` | array | no | `[]` | Flow only. `{body, twoWay?}`: a box, sphere or capsule body whose position is its centre of mass, at most once per flow; `twoWay: false` makes the flow feel the body without pushing it. |
| `u`, `v`, `w`, `pressure` | number arrays | no | | Flow only, saved state: the face velocities ((nx + 1) ny nz, nx (ny + 1) nz and nx ny (nz + 1) values, index `i + Nx (j + Ny k)` with that component's counts), m/s, and the cell pressures (nx ny nz), Pa. `u`, `v` and `w` go together; `pressure` needs them. |
| `particlesPerAxis` | integer 1..4 | no | 2 | Tank only. Particles per cell along each axis when the liquid is seeded. |
| `liquid` | array of `{min, max, velocity?}` | tank: yes | | 1 to 16 boxes of liquid, m; a cell's seeding points inside a box get a particle. |
| `positions`, `velocities`, `affine` | number arrays | no | | Tank only, saved state: 3, 3 and 9 numbers per particle (at most 262,144 particles). When `positions` is given the boxes are not seeded. |

What validation checks beyond the types: the explicit viscous limit `dt ≤ h² / (2 d ν)` at the fluid step (`d` the axes that are not a single periodic cell), reported at `/fluids/i/substeps`; a Courant number above 1 from what the walls, inflows and starting velocity impose; periodic on one side of an axis only; a wall that moves along its normal; an outflow side along which gravity acts (p = 0 over the whole side cannot hold a pressure that varies along it: give the flow `gravity: false`, or put the outflow across gravity); keys of one kind on the other; saved arrays of the wrong length; a body that is missing, listed twice, a hull, mesh, height field or compound, or that has an off-origin `massData.center`. The solver itself refuses, when the scene is built, a flow whose starting Courant number (bodies' speeds included) is above 1: the error then reads `Scene fluid "<id>": ...` and the world is left reset.

Build order: after the heat grids and before the basins, in file order; a flow at rest starts from the hydrostatic pressure (zero on an outflow side, zero mean otherwise), or from its `velocity` made divergence-free, or from its saved fields; a tank is seeded box by box in file order, or takes its saved particles. A dynamic body a flow pushes is counted in the ledger's `rigid` entry.

A save writes a flow's face velocities and pressures and a tank's particles (positions, velocities and affine matrices). A tank's state is complete: a reopened save runs on bit for bit as the original would have (checked over 30 steps). A flow's is not: its Adams–Bashforth history, its energy ledger and the momentum inside its obstacles are not saved, so the first step after a load advects by forward Euler, and the run then differs slightly from the run that was saved; two loads of one save stay bit-identical. To continue a flow exactly, save a checkpoint instead ([`CHECKPOINTS.md`](CHECKPOINTS.md)): it holds the advection history, the ledgers and the obstacles' state, and a run resumed from it is bit-identical. A save of a flow of 4,320 cells is about 160,000 characters of share link; the dam-break tank's 1,440 particles about 250,000.

### Canonical form of the sections

A section that is absent or empty is left out of the normal form (this holds for `cloths`, `grains`, `solids`, `heat` and `fluids` too), so a scene of rigid bodies and joints has the canonical text and `sceneHash` it has always had. Inside a section, a value equal to its default is left out (`solver: "proximal"`, `substeps: 1`, `density: 1000`, an all-zero `eta`, `velocities`, `fixed`, …), and `-0` is written as `0`. Order is kept, because it is the build order. For a fluid: `kind: "flow"`, `substeps: 1`, `gravity: true`, `advection: "central"`, `diffusion: "explicit"`, `particlesPerAxis: 2`, a zero `origin` or `velocity`, a plain `"no-slip"` side (also written as a wall with zero velocity), and saved flow fields that are all zero on a flow with no starting velocity are left out.

## Validation

`validateScene(json)` checks all of the above before anything is built and returns a list of `{path, message}`. `path` is a JSON pointer (RFC 6901) into the scene, for example `/bodies/3/shape/radius`, `/joints/0/bodyB` or `/bodies/1/shape/indices/4`; an empty list means the scene is valid. It never throws.

It reports: unknown keys, missing required keys, wrong types, non-finite numbers and numbers that do not fit a float32, out-of-range sizes, duplicate ids (with the path of the first use), joints that name a missing body, unknown material names, mesh indices out of range, filter bits that are not decimal strings, a compound with no child, with more than 64 or with a child that is not convex, mass data without a positive mass or a positive-definite tensor, a version 2 feature in a version 1 file, and every limit below. In the coupled sections it also reports a basin that would be unstable at the scene's step, a body that cannot float (a hull, mesh or height field), a body in two basins, an attachment to a missing body, frame or node, a pinned or unconnected cable node that is attached, a missing `inertia` where the shape cannot supply it, a compound body or a body with an off-origin `massData.center` in an attachment or a basin, a moving fixed degree of freedom, too many frame equations, and the fluid checks listed under [`fluids`](#fluids). A wrong `format` or an unknown `version` is reported alone, because nothing else can be trusted. At most 100 problems are listed.

`loadScene`, `canonicalize`, `sceneHash`, `normalizeScene` and the link functions throw `SceneValidationError` for an invalid scene. It is an `EngineError` with code `INVALID_PAYLOAD`; its message holds the first five problems and its `problems` property holds them all.

Validation is structural. The engine can still refuse geometry it cannot use, such as a mesh whose triangles have no area or a hull smaller than its tolerance. `loadScene` reports that with the body's id (see below).

## Loading

`loadScene(world, scene)` returns `{bodies: Map<id, Body>, joints: Map<id, Joint>, builder, scene, simulation, water, cables, frames, structure, attachments}`. `simulation` is a ready [`Simulation`](SIMULATION.md): call `simulation.step()` instead of `world.step()`. For a scene without coupled sections the two are the same thing, and the maps are empty.

1. The scene is validated. If it is invalid, the world is **not touched**.
2. The world's step and sub-steps are compared with the scene's. If they differ, `EngineError('INVALID_STATE')` is thrown and the world is not touched.
3. The world is reset to `scene.world` and its body capacity is raised if the scene needs more. Every body is created in file order, then every joint in file order.
4. If the engine refuses a body or a joint, the world is reset again, so it holds none of the scene's bodies (only the ground slab, if the scene asked for one), and the error message starts with `Scene body "<id>":` or `Scene joint "<id>":`.
5. The coupled sections are built ([order](#what-is-built-and-in-which-order)). A frame, cable or basin the engine refuses is handled like a refused body: the world is reset, and the message starts with `Scene frame "<id>":`, `Scene cable "<id>":` or `Scene water "<id>":`.

The loader in `src/engine/scene-format.ts` that the Physics Lab uses has no solvers for the coupled sections. It throws `EngineError('INVALID_STATE')` for a scene that has them and does not touch the world. `loadSimulationScene` (`box3d-webgpu-kit/simulation`) is the loader that builds them; the kit's `loadScene` calls it.

Loading the same scene always gives the same `world.exactHash()` after the same number of steps, on the same WASM build.

## Save and resume

The world cannot report a body's shape or a joint's definition, so saving needs the descriptions the scene was built from. `SceneBuilder` wraps a `PhysicsWorld`, records each description as it creates the body or joint (`addBody(id, options)`, `addJoint(id, options)`, `remove(id)`), and writes them back out with `toJSON()`. `loadScene` returns the builder it used, and `saveScene(world, loaded)` is the same as `loaded.builder.toJSON()`.

A save carries, read from the solver at that moment:

- each body's `position`, `rotation`, `linearVelocity`, `angularVelocity` and `type`;
- the world's `gravity`.

A value the solver still holds unchanged is written exactly as it was authored, so saving a scene before the first step gives back the scene.

`linearVelocity` in a scene is the velocity of the body's origin. The solver holds the velocity of the centre of mass. The two are the same unless the body spins and its centre of mass is off its origin (a compound, `massData` with a `center`, a hull whose points are not centred on its origin); a save then writes `v_com − ω × (R c)`, rounded to float32. For such a body the saved velocity can differ from the authored one in the last float32 digit even before the first step. Measured on an L-shaped compound spinning at 2 rad/s, whose two velocities differ by 1.8 m/s: saved after 100 steps and loaded into a new world, the velocities agree to 4.8e-7 m/s at the moment of loading and the positions are identical after one more second of free flight.

A save of a coupled scene also carries each basin's `eta`, `u` and `v`, each cable's node positions and velocities, each frame's displacements and velocities, each cloth's and grain set's fields, each solid's displacements, velocities and interfaces, and each heat grid's temperatures, as the solvers hold them (float64, bit-exact; a cracked solid's nodes in the order its load gives, [Solids and heat](#coupled-sections-solids-and-heat)). Entries that name a body that no longer exists are left out.

A save does **not** carry:

- sleep state (every body that can move is awake after loading);
- the contact impulses and joint impulses the solver warm-starts from (it starts them from zero);
- forces and torques applied for the next step;
- the tick count (`world.tick` is 0 after loading);
- settings changed on the world directly, such as `setJointMotor`, `setJointLimits`, `setJointSpring`, `setJointSteering`, `setDamping`, `setGravityScale`, `setCollisionFilter`, `setMassData` and `resetMassData`. The saved scene has the values the body or joint was created with;
- in a coupled scene: the structure coupling's own state (last step's interface impulses and the pending half of the frame impulse, so the saved velocity of a body resting on a frame is off by about `g · step / 2`), the cable solver's multipliers, attachments made or removed on the coupling directly, and one step's change of displaced volume (after a load, a body that is in the water is taken as part of the starting state).

Measured (`v12-scene.test.mjs`, each example run for 100 ticks, saved, loaded into a new world):

- At the moment of loading, positions and both velocities are bit-identical to the original. A rotation component can differ by one float32 step (1.2e-7), because the engine renormalises the quaternion it is given.
- The two runs then drift apart, because the resumed solver starts cold. Largest distance between matching bodies after 100 more ticks:

| Scene | Drift | Test bound |
|---|---|---|
| Pendulum wave (joints only) | 5e-8 m | 1e-5 m |
| Newton's cradle (joints, one impact) | 0 | 1e-5 m |
| Car on terrain (rolling contact, springs) | 1.6e-4 m | 5e-3 m |
| Domino run (dominoes mid-fall) | 1.1e-2 m | 5e-2 m |
| Ragdoll (toppling; compared as its head strikes the ground at 7 m/s) | 6.9e-2 m | 0.4 m |
| Moored buoy (coupled; saved mid-swing at tick 240, compared 240 ticks later) | buoy 5.9e-6 m; water surface 4.0e-5 m | 1e-4 m; 4e-4 m |
| Cable-stayed deck (coupled; same ticks) | ball 1.6e-8 m; deck 4.3e-7 m | 2e-7 m; 4e-6 m |

The two coupled rows are measured by `v14-simulation.test.mjs`; their fields are bit-identical at the moment of loading.

A run resumed from a saved scene is a valid simulation from the saved state, not a bit-exact continuation. For a bit-exact continuation, rigid or coupled, save a checkpoint (`simulation.checkpoint()`, the Lab's **Save checkpoint**): it carries everything listed above as not saved (sleep state, warm-start impulses, pending forces, the tick, settings changed on the world, every solver's internal state) and the scene itself, and a run resumed from it is bit-identical to the run it was taken from, in the same page or a fresh one ([`CHECKPOINTS.md`](CHECKPOINTS.md)). Record and replay (`startRecording`, `replay`) remain for rigid sessions driven by calls.

## Canonical form and hash

`normalizeScene(scene)` returns the normal form:

- `units`, `world` (all five settings), `materials`, `bodies` and `joints` are always present;
- `rotationEuler` is replaced by `rotation`;
- a body or joint value equal to the engine default is left out (an inline `density`, `friction`, `restitution` or `color` is kept when the body names a material, because it is then an override; a compound child's `density`, `friction` and `restitution` are always kept, because they override the body's);
- `version` is the lowest version that can hold the scene: 2 when a body is a compound or has `massData`, otherwise 1, whatever the file declared;
- `-0` is written as `0`;
- body and joint order is kept, because it is the build order.

`canonicalize(scene)` is the normal form as JSON with object keys sorted by UTF-16 code unit, no whitespace, and numbers as ECMAScript prints them (the shortest text that reads back to the same double). Scenes that describe the same thing give the same text whatever their key order, and canonicalising twice changes nothing. `canonicalize(scene, {pretty: true})` gives the same content with one key per line and each array of numbers on one line, for reading and diffing.

`sceneHash(scene)` is the SHA-256 of the compact canonical text in UTF-8, as 64 lowercase hex digits.

## Share links

`encodeSceneLink(scene)` (async) and `encodeSceneLinkSync(scene)` return a string; `decodeSceneLink(text)` (sync) returns the validated scene. The string is

```
b3s1 <mode> . <length> . <crc> . <data>
```

| Part | Content |
|---|---|
| `b3s1` | Prefix and link version 1. |
| `mode` | `d`: `data` is raw DEFLATE (RFC 1951, no zlib or gzip wrapper). `r`: `data` is stored as is. |
| `length` | Byte length of the canonical JSON in UTF-8, in lowercase base 36. |
| `crc` | CRC-32 (IEEE 802.3, the zip and PNG polynomial) of those bytes, 8 lowercase hex digits. |
| `data` | base64url (RFC 4648 section 5), no padding. |

For example `b3s1d.1cl.3bb55234.rZRNj6Qg…`. Only `A-Z a-z 0-9 - _ .` appear, so the string needs no escaping in a query or a fragment: `https://example.org/lab.html#scene=b3s1d.…`. `decodeSceneLink` accepts the bare string or any text that contains one, such as a whole URL.

- **Encoding.** `encodeSceneLink` compresses with the platform's `CompressionStream('deflate-raw')`. Where that is missing, when the result is not smaller, or with `{compress: false}`, it stores the JSON (mode `r`). `encodeSceneLinkSync` always stores.
- **Decoding** is synchronous and needs nothing from the platform: the module has its own DEFLATE decoder, so a compressed link opens anywhere.
- **Sizes.** The five example scenes are 1.7 to 4.4 kB of canonical JSON and 565 to 1,086 characters as compressed links (2,343 to 5,942 stored).

`decodeSceneLink` throws `EngineError('INVALID_PAYLOAD')` when:

- the text holds no link, the link version is not 1, or the mode is unknown;
- the link is longer than 1,048,576 characters;
- the declared length is above 4,194,304 bytes;
- the data is not base64url, the DEFLATE stream is damaged or cut off, or bytes follow its end;
- the data would decompress to more than the declared length. The decoder writes into a buffer of exactly the declared length and stops there, so a decompression bomb costs at most 4 MiB;
- the decompressed length or the CRC does not match;
- the bytes are not UTF-8 JSON.

A link whose JSON is not a valid scene throws `SceneValidationError`.

## In the Physics Lab

The Lab (`lab.html`) opens scene files with this module. Nothing is installed; a link is enough.

| How | What opens |
|---|---|
| `lab.html?example=<name>` | An example scene: `pendulum-wave`, `newtons-cradle`, `domino-run`, `terrain-car`, `ragdoll`, and the coupled ones: `moored-buoy`, `cable-stayed-deck`, `buoy-and-crates`, `trampoline`, `hopper-seesaw`, `suspended-platform`, `rubber-pad`, `notched-beam`, `quenched-plate`, `heated-bar`, `sphere-settling`, `cavity-flow`, `flow-past-cylinder`, `dam-break`. |
| `lab.html?scene=b3s1…` | A share link from `encodeSceneLink`. `#scene=…` in the fragment works too. |
| `lab.html?scene=%7B…%7D` | The scene JSON itself, URL-encoded, up to 65,536 characters. |
| The **Scenes** panel, bottom right: **Open file…**, or drop a file anywhere on the page | A scene file (`.json`), or geometry (`.obj`, `.stl`, `.glb`, `.gltf`; drop a `.gltf` together with its `.bin`). |
| `lab.html?edit=1`, alone or with `example=` or `scene=` | The scene editor, on a new scene or on that one ([`SCENE_EDITOR.md`](SCENE_EDITOR.md)). |
| The laboratory catalog, section "SI scenes" | The examples and "Open file…". They are not catalogue recipes. |

With a scene loaded, the panel has **Copy share link** (the address, with `scene=` set to a link of the scene as it is at that moment), **Download scene (.json)** (the same scene as a file) and **Reset** (load it again from its start). Both use the `SceneBuilder` that built the scene, so they carry each body's current pose and velocity; [Save and resume](#save-and-resume) says what such a save restores. Boxes the Lab's own force tools add to the world (projectiles, rain) were not created through the builder and are not in the saved scene. **Save checkpoint** writes a `.b3ck` file with the complete state of the running simulation and the scene it was loaded from; **Load checkpoint…** (or a `.b3ck` file dropped on the page) rebuilds that scene and continues the run exactly where it was saved, also in a fresh page ([`CHECKPOINTS.md`](CHECKPOINTS.md)). A checkpoint holds the projectiles and rain the force tools added, too. The address bar shows `example=<name>` for an example and `scene=<link>` for a scene opened from a link or after its link was copied; a link over 32,768 characters is copied but not written to the address bar.

**One loader.** The kit's `PhysicsWorld` and the Lab's `LabSceneHost` (`src/lab/scene-host.ts`, a thin wrapper over the Lab's `NativeWorldBackend`) both implement `SceneHost`, the dozen members the `SceneBuilder` needs. They pass the same calls with the same values to the same native world. `packages/box3d-kit/test/v13-lab-scenes.test.mjs` loads each example, and a scene with hulls, a mesh and a height field, through both and requires equal `exactHash` and replay hash after 0, 1, 60 and 300 steps, and equal saved scenes.

**Step size.** The Lab steps a scene with the scene's own `step` and `subSteps`, not with the Lab's sub-step control. Its frame loop ticks at 1/60 s, so it takes `round((1/60) / step)` scene steps a tick: 2 for a 1/120 s scene, 4 for a 1/240 s one. A step that does not divide 1/60 s plays slightly fast or slow (1/100 s: 2 steps a tick, 1.2 times real speed).

**Errors.** Input is checked before the world is touched: links by `decodeSceneLink`, scene JSON by `validateScene`, geometry by the parsers of `src/engine/geometry.ts`, files by a 64 MiB size cap. A failure is shown in the panel with up to 12 problems from the validator's list (path and message) and the count of the rest, and the scene on screen stays as it is. A valid scene is then built once in a scratch world that is thrown away: if the engine refuses a body the validator accepted (a mesh whose triangles have no area, for example), that is reported with the body's id and the scene on screen is still untouched. A scene is therefore built twice when it is opened. Text from a file, a link or the address is only ever written to the page as text.

**Geometry files** become one body in a default scene (gravity 9.81 m/s² down, the ground slab). The notes in the panel say what was done:

- All meshes of the file are merged, welded, and centred on their bounding box.
- *Scale.* Files do not state their unit. With "Scale imported geometry to fit" on (the default), the largest side of the bounding box decides: 0.05 to 10 units is read as metres; above 10 it is read as millimetres when that gives 0.05 m to 10 m, and otherwise scaled to 2 m; below 0.05 it is scaled to 1 m. With the box off, the file's numbers are metres.
- *Body.* A surface that is not closed encloses no volume, so it becomes a static triangle mesh. A closed, convex one becomes one dynamic convex hull. A closed, concave one of at most 5,000 triangles is split into up to 16 convex hulls welded together (`convexDecompose`; the note gives how far their volume is from the mesh's, about 10% over for a torus); a larger one becomes a static mesh, because the split would stall the page (5,000 triangles took about 3 s here). The pieces share a collision group, so they do not push each other apart, and each is welded to the nearest piece before it, at the midpoint of their centres of mass. `createBodiesFromMesh` welds every piece to the first one at the body origin instead; that flew apart for a 16-piece torus (tens of metres in free fall), so the Lab does not use it for split bodies. Welds are solved iteratively: on a hard landing the pieces move against each other by up to about 2 cm. A dynamic body has density 1000 kg/m³, so its mass is the mesh volume times that, and it starts 0.3 m above the ground.

The Lab draws hulls, meshes, height fields and compounds from their own geometry; see [`RENDERING_PIPELINE.md`](RENDERING_PIPELINE.md). A compound is one triangle list that holds every child at its local pose (boxes and hulls flat-shaded, spheres and capsules smooth), in the body's one colour.

For the browser console and for tests the page has `box3dLab.sceneState()` (title, source, body and joint counts, shape kinds, tick, scene steps taken, `sceneHash`, `exactHash`, replay hash), `box3dLab.stepSceneTo(tick)` (step without waiting for frames, then report the state) and `box3dLab.sceneJson()` (what Download would save).

A scene can be built and changed in the page: **New scene** and **Edit** in the panel, or `lab.html?edit=1`, open the scene editor ([`SCENE_EDITOR.md`](SCENE_EDITOR.md)). While it is open, Copy share link and Download save the edited scene (its initial state), and Reset returns to it.

**Coupled scenes.** The Lab builds every scene with `loadSimulationScene` (`loadLabScene` in `src/lab/scene-host.ts`; the host takes forces and impulses, which the couplings need) and steps a scene with coupled sections through its `Simulation`: each fixed step runs the couple stage, the rigid step, the post stage and the events, as [`SIMULATION.md`](SIMULATION.md) describes. Play, Pause, Step and Reset work as for a rigid scene; a rigid-only scene is stepped as before (its Simulation has no subsystems). `src/lab/coupled-scene.ts` draws the other solvers with the Lab renderer's existing streams, without a new render pass:

| Solver | Drawn as |
|---|---|
| Water basin | One mesh row: the free surface as a height field over the basin (a vertex per cell corner, the mean of the cells around it, at most 16,384 quads; a larger basin is drawn at every n-th cell) with four sides to the floor, in the translucent material, and a wire grid on the surface in the line stream. |
| Cable, frame | Segments of the rope stream (straight square tubes between node positions; a frame element as thick as its section area, a cable 1/300 of the scene's size, 5 mm to 5 cm). At most 4,096 nodes and segments are drawn. |
| Cloth | One mesh row: the triangles from the node positions after every step, smooth normals, both sides. |
| Grains | One sphere row per grain. A grain that left its bounds keeps its row with no size. |
| Grain walls | Boxes, spheres and capsules as rows of those shapes; cylinders, rings and cones as mesh rows; all translucent. Plane walls are not drawn. |
| Solid | Eight mesh rows, one per colour band of the field the panel picks (von Mises stress from 0 to its present largest value, temperature over the range of the heat grid's start and boundary temperatures, or damage from 0 to 1), on a blue-cyan-green-yellow-red ramp. The triangles are the boundary faces at the present node positions, rebuilt after every step with flat normals; a solid with fracture adds both sides of every interface, each coloured by its own element (or by the interface's damage), so an opened crack shows as two surfaces and each fragment is closed. The panel can draw the displacements 10, 100 or 1000 times larger (`box3dLab.setSolidView({field, scale})`): brittle cracks open by micrometres. An empty band is drawn with no size. |
| Fluid: flow | A slice through the middle of the box across z (the x-y plane; the middle of the one cell of a 2D flow), one quad per cell, in ten mesh rows, one per colour band of the field the panel picks: the speed from 0 to its present largest value, or the pressure less its hydrostatic part ρ g·x (so a fluid at rest is one colour), from its present smallest to largest value. Cells whose centre is inside a body are left out, so the body shows through. Velocity arrows (the in-plane components, scaled to the fastest arrow shown) on a sub-grid of at most 12 along the longer side, just in front of and behind the slice, and the twelve edges of the box, in the line stream. |
| Fluid: free-surface tank | One sphere row per particle, 0.6 of a particle's share of a cell in radius, coloured continuously on the same ramp by its speed or by the pressure of its cell; the edges of the tank in the line stream. |

A panel at the bottom left shows the clock and the measured cost of a step, the step order, the energy ledger by subsystem (total and balance, with the parts on hover) and the latest events: world contacts and each subsystem's events, with body handles shown as scene ids. `box3dLab.sceneState()` also reports `simulationTick`, `stateHash` (a hash of every body transform and every solver's fields, `coupledStateHash`), the energy entries and what is drawn; `box3dLab.coupledReadout()` returns what the panel shows, and `box3dLab.setPaused(flag)` pauses the clock. With solids, the panel also has the field picker and the displacement scale, and shows the range of the ramp for each solid; `sceneState().solidView` reports the same. With fluids, it has the fluid field picker (speed, pressure) and shows for each fluid the range of its ramp, its Courant number and the iterations of its last pressure solve, and for each body in a flow its speed and the fluid's force on it (`box3dLab.setFluidView({field})`, `sceneState().fluidView`). A flow is seen across its slice: its camera starts nearly face on to the x-y plane. Solid events are listed with the others: `contact-begin` and `contact-end` of a solid in contact, `crack` with the kind (`initiated`, `opened`), face, mode and energy of a fracture body. Copy share link and Download save the scene as it is, with the solvers' fields ([Save and resume](#save-and-resume)); a link opened in a fresh page gives the same scene hash and, after the same number of steps, the same state hash (checked by `scripts/coupled-scenes-browser-check.mjs`). The editor opens a coupled scene: its bodies and joints are edited, and its sections are kept as they are and listed ([`SCENE_EDITOR.md`](SCENE_EDITOR.md#coupled-scenes)). A saved coupled scene carries every field, so its link is long: the hopper's is 3,526 characters at the start and 20,395 after 3 s (150 grains with positions, velocities and spins), the buoy and crates' 11,258 after 3 s. That fits the address bar (up to 32,768 characters), but some servers refuse a request line that long (Node's default limit is 16 KB); send the file for those.

Not in the Lab yet: choosing the scale of imported geometry by hand, importing one body per object of a file, and textures or colours from the geometry file. The Studio does not read scenes.

## Limits

`SCENE_LIMITS` exports these numbers.

| Limit | Value |
|---|---|
| Bodies per scene | 65,536 |
| Joints per scene | 65,536 |
| Materials | 1,024 |
| Id and material-name length | 64 characters |
| Hull points | 4,096 (Box3D keeps 64 vertices) |
| Shapes in one compound body | 64 |
| Mesh vertices / triangles | 1,048,576 / 2,097,152 |
| Height-field side | 4,096 samples |
| Numbers in all geometry arrays of one scene, the arrays of the coupled sections included | 8,000,000 |
| Water basins / cells in one basin | 8 / 65,536 |
| Cables / nodes in one cable | 1,024 / 16,384 |
| Frames / nodes / elements in one frame | 64 / 4,096 / 8,192 |
| Cloths / nodes / triangles in one cloth | 16 / 16,384 / 32,768 |
| Grain sets / grains / fixed walls in one set / grain steps per world step | 8 / 65,536 / 256 / 4,096 |
| Solids / nodes / tetrahedra in one solid / solid steps per world step | 8 / 20,000 / 60,000 / 64 |
| Heat grids (one per solid) / heat steps per world step | 8 / 256 |
| Fluids / cells in one fluid / particles in one tank / fluid steps per world step / liquid boxes of one tank / bodies in one flow | 4 / 262,144 / 262,144 / 64 / 16 / 64 |
| Supports, welds, loads, notches or interface boxes of one solid (each list) / saved interfaces | 64 / 60,000 |
| Equations of all frame attachments (3 per pinned, 6 per clamped) | 96 |
| One `userData`, or `extensions` | 65,536 characters of JSON, 32 levels deep |
| A `meta` string | 4,096 characters |
| Problems listed by `validateScene` | 100 |
| Share link | 1,048,576 characters |
| Canonical JSON in a share link | 4,194,304 bytes |

A world has room for 4,096 bodies unless it was created with a larger `capacity`. `loadScene` raises the capacity (to 16,384 or 65,536) when the scene needs more; the ground slab counts as one body, so a scene with the ground holds at most 65,535 of its own. `SceneBuilder.addBody` does not raise it and throws `WORLD_CAPACITY` when the world is full.

## Versioning

- `version` is an integer. This document describes versions 1 and 2.
- A reader accepts exactly the versions it knows. This build reads 1 and 2 and rejects any other number with `unsupported scene version N; this build reads versions 1 and 2`; a reader from before version 2 rejects a version 2 file with `unsupported scene version 2; this build reads version 1 only`. Neither guesses.
- **Version 2** is version 1 plus the `compound` shape kind and the body key `massData`. Nothing else differs: every version 1 file is read as before, and gives the same canonical text and `sceneHash` as before (the kit test pins the hashes of the five example scenes from before version 2).
- A version 2 feature in a file that declares version 1 is an error (`a 'compound' shape needs scene version 2; this scene declares version 1`), so that a version 1 reader is never handed a file it would reject for a reason it cannot name.
- The normal form, and so the canonical text, a save and a share link, carries the lowest version that can hold the scene. A file that declares version 2 and uses neither feature is the version 1 scene: same text, same hash.
- Within a version the schema is closed: unknown keys are errors. That keeps typos from being silently ignored and keeps canonical text and hashes well defined.
- Additive data that a version 1 reader may ignore goes in `extensions` (scene-wide) or `userData` (per body or joint). Use a key you own, for example your tool's name.
- The `water`, `cables` and `frames` sections were added to version 1 without a new number. They are optional, a scene without them is byte for byte the scene it was (same canonical text, same `sceneHash`), and a reader from before them does not misread a scene that has them: it rejects it with `/water: unknown key "water"`, because the schema is closed. A reader cannot tell from the version alone whether it can run a file; `sceneHasCoupling(scene)` says whether a scene needs a Simulation.
- The `cloths` and `grains` sections were added the same way on 2026-11-11, without a new number: optional, absent from the normal form when empty (the example hashes are unchanged; `tests/physics/lab-scenes.test.mjs` and the kit test pin them), and rejected by an earlier reader as `unknown key "cloths"` or `unknown key "grains"`. `sceneHasCoupling` counts them.
- The `solids` and `heat` sections were added the same way on 2026-11-12: optional, absent from the normal form when empty (the example hashes, rigid and coupled, are unchanged), rejected by an earlier reader as `unknown key "solids"` or `unknown key "heat"`, and counted by `sceneHasCoupling`.
- The `fluids` section was added the same way, also on 2026-11-12: optional, absent from the normal form when empty (every earlier example hash, rigid and coupled, is unchanged; `tests/physics/lab-scenes.test.mjs` pins the rigid ones), rejected by an earlier reader as `unknown key "fluids"`, and counted by `sceneHasCoupling`.
- Any change that an earlier reader would misread, such as a new required key, a new shape kind, a changed default or a changed meaning, gets a new `version`. A later reader keeps reading the earlier versions. Version 2 was made for the new shape kind; `massData` went with it because a version 1 reader that ignored it would simulate another body.
- Share links have their own version in the prefix (`b3s1`). A new compression or framing gets a new prefix; version 1 links stay readable.
- Canonical text and `sceneHash` are defined by the scene version. They are stable for versions 1 and 2.
- A scene file does not pin the WASM build. `exactHash()` values are comparable only on the same build (`BUILD_INFO`).

## Example scenes

`box3d-webgpu-kit/scene` exports five small scenes as functions that return scene JSON, and `EXAMPLE_SCENES` maps their names to them.

| Function | Contents |
|---|---|
| `pendulumWaveScene()` | 9 spheres on revolute joints; pendulum k makes 30 + k swings in 60 s. Measured periods are within 0.0004% of the compound-pendulum formula. |
| `newtonsCradleScene()` | 5 elastic balls on hinges. The last ball leaves at 99.6% of the first ball's speed. |
| `dominoRunScene()` | 12 boxes; the first leans past its tipping point. |
| `terrainCarScene()` | A chassis on four wheel joints with suspension and motors, on a height field. No ground slab. |
| `ragdollScene()` | A capsule torso, a sphere head and 8 capsule limbs on 9 spherical joints with cone and twist limits. |

`COUPLED_EXAMPLE_SCENES` maps fourteen more names to scenes with coupled sections. They are kept out of `EXAMPLE_SCENES` because a loader without a Simulation (the core `loadScene`) cannot open them; the Lab opens all of them.

| Function | Contents |
|---|---|
| `mooredBuoyScene()` | A sphere floating in an 8 m × 8 m basin, held under its free waterline by a compliant cable to the bed. At rest the cable carries the buoyancy minus the weight (1337 N); released to the side it swings back and settles. |
| `cableStayedDeckScene()` | An 8 m steel deck on a pin and a roller, two stays from a tower top, a ball pinned to the deck. Stay tensions and deflection match hand statics to 1.4e-4. |
| `buoyAndCratesScene()` | The moored buoy released 0.4 m off its line, with three wooden crates dropped into the basin: water, a cable and four floating bodies. |
| `trampolineScene()` | A 2 m cloth of 81 nodes held along its edges between four posts, with a 6.8 kg ball and a box dropped on it. 1/120 s step. |
| `hopperSeesawScene()` | 150 beads of 6 mm radius (linear contact law, 12 grain steps per 1/240 s world step) run out of a conical hopper into a tray on a hinged plank and tip it against a 24 kg counterweight. |
| `suspendedPlatformScene()` | A platform on four compliant cables from four posts, loaded by four boxes that fall on it one after another. |
| `rubberPadScene()` | An 8 kg box dropped 0.2 m onto a neo-Hookean rubber pad (E = 1.5 MPa, ν = 0.45, 243 nodes) welded along its base to a steel plate: two-way contact with friction. The box bounces, settles and rests pressed in on 25 nodes. |
| `notchedBeamScene()` | A 200 kg drop hammer on a vertical guide (a prismatic joint) falls 1.5 m onto a steel platen over a notched concrete beam (0.4 × 0.1 × 0.05 m, σ_c = 3 MPa, G_c = 100 J/m², 240 tetrahedra), pinned along a node line one cell in from each end of its base, with cohesive interfaces on the mid-section above the notch (`insertion: "manual"`). The platen's reaction is the beam's load; the impact opens half of the ligament from the notch, and at rest the beam carries the hammer's weight (to 10⁻³). |
| `quenchedPlateScene()` | `quenchedPlate()` of `solid-fracture.ts` at 6 mm cells (60 × 36 × 6 mm, 300 tetrahedra): an alumina plate at 600 K whose face x = 0 is quenched by a film of 20,000 W/(m² K) to 300 K. The heat grid's temperature is the plate's thermal strain; the cooled layer cracks from about 1.2 s. The cells are far larger than `l_ch` (0.16 mm): the onset is meaningful, the crack pattern is not. |
| `heatedBarScene()` | An aluminium bar (80 × 16 × 16 mm) clamped between a block held at 500 K and one at 300 K: the temperature settles to a linear ramp in about 20 s and the restrained bar goes into compression (up to about 300 MPa von Mises at the hot end). |
| `sphereSettlingScene()` | A 50 mm PTFE ball (2200 kg/m³) released near the top of a 0.12 × 0.3 × 0.12 m column of a syrup (1380 kg/m³, 2.5 Pa s; 12 × 30 × 12 cells of 10 mm, 2.5 cells per radius), a body of the rigid world and a moving obstacle of the flow. 1/120 s step: the coupling is explicit and the ball's response time in the column is about 0.03 s. It reaches 0.151 m/s within 0.3 s (Re ≈ 4) and lands at about 1.55 s. Stokes's velocity in an unbounded fluid would be 0.447 m/s; the walls, 1.2 diameters away, slow it to about a third. (For comparison only: the wall factor of a sphere on the axis of a circular tube of the same width, by the Haberman–Sayre formula as remembered (K = 3.87 at d/D = 0.417), gives 0.116 m/s; the column is square, Re is not zero and the grid underestimates the drag by several percent at 2.5 cells per radius, see [`FLUID.md`](FLUID.md#validation).) |
| `cavityFlowScene()` | A 0.1 m cube of oil (900 kg/m³, 0.09 Pa s) whose top slides at 0.1 m/s along x, Re 100, 16³ cells, with side walls: one large vortex below the lid and smaller ones in the lower corners. The 2D cavity is the validated case ([`FLUID.md`](FLUID.md#validation)); this 3D box is not compared with a reference. |
| `flowPastCylinderScene()` | A liquid (ν = 4·10⁻⁵ m²/s) entering at 40 mm/s from the left past a 20 mm cylinder (a static capsule of the rigid world lying across the slab, 6 cells across) and leaving on the right (p = 0), Re 20, in two dimensions (80 × 32 × 1 cells, periodic in z), free-slip top and bottom, gravity off in the fluid. A pair of standing vortices forms behind the cylinder. Its drag after 4 s is a drag coefficient of 2.7 per unit length; in an unbounded flow at Re 20 it is about 2 (a value remembered, not checked); here the channel is 5.3 diameters tall (19% blockage), which raises it, and the grid is coarse. |
| `damBreakScene()` | A column of water 0.18 m by 0.09 m and 0.3 m tall in one corner of a closed 0.6 × 0.36 × 0.18 m tank (20 × 12 × 6 cells of 30 mm, 1,440 particles, two fluid steps per world step) let go at t = 0: it spreads over the floor, runs to the far wall, climbs it and falls back. Inviscid, no surface tension. |

Cost of one simulation step, measured once on this sandbox (4 shared cores, Node 22; in the browser, headless Chromium with software WebGPU, stepping only): moored buoy 0.18 ms (browser 0.19 ms), cable-stayed deck 0.47 (0.55), buoy and crates 0.20 (0.78), suspended platform 0.10 (0.32), hopper 1.5 (1.9) against a 4.17 ms real-time budget; the trampoline 4.8 to 5.7 ms in node and 8.8 ms in the browser against its 8.33 ms budget, so it is about real time in node and runs at about 0.9 times real time in that browser. The solids, measured the same way: heated bar 0.8 ms in node (1.1 ms in the browser) against 16.7 ms, about 20 times faster than real time; quenched plate 1.4 to 2.3 ms before it cracks and 20 to 31 ms after (the fracture solve grows with the interfaces), against 16.7 ms, so about 0.6 times real time once cracked (browser 12 ms mean over the first 2.5 s); notched beam 1.5 ms mean against 4.17 ms (browser 2.0 ms), with single steps of 40 ms at the impact; rubber pad 1.7 to 2 ms at rest but about 80 ms per step while the box lands and bounces (the first 0.4 s), about 0.05 times real time then (browser 27 ms mean over the first second). The meshes are kept small for that: 140 to 279 nodes. The cloth is the limit: about 100 nodes in real time ([`CLOTH.md`](CLOTH.md#cost)); grains, about 100 to 250 soft beads ([`GRANULAR.md`](GRANULAR.md#cost)). Larger cloths or more grains run slower than real time: the Lab then takes the steps it can in a frame and drops the rest of the time, as it does for any scene. The fluids, measured in node over 5 s of simulated time with the Lab's drawing (`CoupledSceneView`), on the same machine: sphere settling 7.2 ms per step mean (p95 10.5) against its 8.33 ms budget, 1.1 times real time; lid-driven cavity 5.1 ms against 16.7 ms, 3.1 times; flow past a cylinder 8.9 ms plus 2.2 ms a frame to draw the slice and arrows, 1.5 times; dam break 9.4 ms (two fluid steps) against 16.7 ms, 1.7 times. In the headless browser with software WebGPU (stepping only, `scripts/coupled-scenes-browser-check.mjs`), in three runs on this sandbox while other work loaded it (load average 13 to 15 on 4 cores; the heated bar took 5 to 7 ms there against the 1.1 ms above), they took 13 to 30 ms (settling ball), 6 to 16 ms (cavity), 6 to 16 ms (cylinder) and 46 to 51 ms (dam break) per step: about 0.3 to 0.6 times real time for the ball and the dam break, 1 to 2.6 times for the cavity and the cylinder. Not measured on a quiet machine or a GPU. That is why the grids are 1,440 to 4,320 cells: [`FLUID.md`](FLUID.md#cost) puts the limit at about 10,000 cells per 60 Hz frame on this machine.

Two engine behaviours showed up while building the cradle and are worth knowing when you write scenes: restitution is not applied to slow impacts (a 0.44 m/s impact passed on 23% of its speed, a 1.85 m/s impact 99.6%), and balls that touch at rest do not pass the impulse cleanly, so the scene leaves a 2 mm gap.
