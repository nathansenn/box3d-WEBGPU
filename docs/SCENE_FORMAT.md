# Scene format (`box3d-scene`, version 1)

A scene file is plain JSON that says how to build a rigid-body scene: the world settings, the bodies and the joints. It can be validated, loaded, saved, diffed, hashed and packed into a share link. The code is `box3d-webgpu-kit/scene` (`packages/box3d-kit/src/scene.ts`); the tests are `packages/box3d-kit/test/v12-scene.test.mjs`.

The native solver cannot serialise its internal state. A scene file therefore describes how to **build** a scene, and may also carry the pose and velocity each body had when it was saved. [Save and resume](#save-and-resume) lists exactly what that does and does not restore.

Units are SI throughout: metres, kilograms (through density in kg/m³), seconds, radians. Quaternions are `[x, y, z, w]`. The y axis is up.

## Annotated example

```jsonc
{
  "format": "box3d-scene",          // required, exactly this
  "version": 1,                     // required, exactly 1
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

A key that is not listed here is an error, everywhere except inside `userData` and `extensions`. "Number" always means a finite number that fits a float32, because that is what the solver stores.

### Top level

| Key | Type | Required | Default | Notes |
|---|---|---|---|---|
| `format` | `"box3d-scene"` | yes | | |
| `version` | `1` | yes | | See [Versioning](#versioning). |
| `units` | `"SI"` | no | `"SI"` | |
| `world` | object | no | all defaults | |
| `materials` | object, name → material | no | `{}` | |
| `bodies` | array of bodies | yes | | May be empty. Built in this order. |
| `joints` | array of joints | no | `[]` | Built in this order, after all bodies. |
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
| `shape` | shape | yes | | One shape per body. |
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

Geometry is inline, as plain arrays of numbers.

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

## Validation

`validateScene(json)` checks all of the above before anything is built and returns a list of `{path, message}`. `path` is a JSON pointer (RFC 6901) into the scene, for example `/bodies/3/shape/radius`, `/joints/0/bodyB` or `/bodies/1/shape/indices/4`; an empty list means the scene is valid. It never throws.

It reports: unknown keys, missing required keys, wrong types, non-finite numbers and numbers that do not fit a float32, out-of-range sizes, duplicate ids (with the path of the first use), joints that name a missing body, unknown material names, mesh indices out of range, filter bits that are not decimal strings, and every limit below. A wrong `format` or an unknown `version` is reported alone, because nothing else can be trusted. At most 100 problems are listed.

`loadScene`, `canonicalize`, `sceneHash`, `normalizeScene` and the link functions throw `SceneValidationError` for an invalid scene. It is an `EngineError` with code `INVALID_PAYLOAD`; its message holds the first five problems and its `problems` property holds them all.

Validation is structural. The engine can still refuse geometry it cannot use, such as a mesh whose triangles have no area or a hull smaller than its tolerance. `loadScene` reports that with the body's id (see below).

## Loading

`loadScene(world, scene)` returns `{bodies: Map<id, Body>, joints: Map<id, Joint>, builder, scene}`.

1. The scene is validated. If it is invalid, the world is **not touched**.
2. The world's step and sub-steps are compared with the scene's. If they differ, `EngineError('INVALID_STATE')` is thrown and the world is not touched.
3. The world is reset to `scene.world` and its body capacity is raised if the scene needs more. Every body is created in file order, then every joint in file order.
4. If the engine refuses a body or a joint, the world is reset again, so it holds none of the scene's bodies (only the ground slab, if the scene asked for one), and the error message starts with `Scene body "<id>":` or `Scene joint "<id>":`.

Loading the same scene always gives the same `world.exactHash()` after the same number of steps, on the same WASM build.

## Save and resume

The world cannot report a body's shape or a joint's definition, so saving needs the descriptions the scene was built from. `SceneBuilder` wraps a `PhysicsWorld`, records each description as it creates the body or joint (`addBody(id, options)`, `addJoint(id, options)`, `remove(id)`), and writes them back out with `toJSON()`. `loadScene` returns the builder it used, and `saveScene(world, loaded)` is the same as `loaded.builder.toJSON()`.

A save carries, read from the solver at that moment:

- each body's `position`, `rotation`, `linearVelocity`, `angularVelocity` and `type`;
- the world's `gravity`.

A value the solver still holds unchanged is written exactly as it was authored, so saving a scene before the first step gives back the scene.

A save does **not** carry:

- sleep state (every body that can move is awake after loading);
- the contact impulses and joint impulses the solver warm-starts from (it starts them from zero);
- forces and torques applied for the next step;
- the tick count (`world.tick` is 0 after loading);
- settings changed on the world directly, such as `setJointMotor`, `setJointLimits`, `setJointSpring`, `setJointSteering`, `setDamping`, `setGravityScale` and `setCollisionFilter`. The saved scene has the values the body or joint was created with.

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

A resumed run is a valid simulation from the saved state. It is not a bit-exact continuation; for that, record and replay (`startRecording`, `replay`).

## Canonical form and hash

`normalizeScene(scene)` returns the normal form:

- `units`, `world` (all five settings), `materials`, `bodies` and `joints` are always present;
- `rotationEuler` is replaced by `rotation`;
- a body or joint value equal to the engine default is left out (an inline `density`, `friction`, `restitution` or `color` is kept when the body names a material, because it is then an override);
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

## Limits

`SCENE_LIMITS` exports these numbers.

| Limit | Value |
|---|---|
| Bodies per scene | 65,536 |
| Joints per scene | 65,536 |
| Materials | 1,024 |
| Id and material-name length | 64 characters |
| Hull points | 4,096 (Box3D keeps 64 vertices) |
| Mesh vertices / triangles | 1,048,576 / 2,097,152 |
| Height-field side | 4,096 samples |
| Numbers in all geometry arrays of one scene | 8,000,000 |
| One `userData`, or `extensions` | 65,536 characters of JSON, 32 levels deep |
| A `meta` string | 4,096 characters |
| Problems listed by `validateScene` | 100 |
| Share link | 1,048,576 characters |
| Canonical JSON in a share link | 4,194,304 bytes |

A world has room for 4,096 bodies unless it was created with a larger `capacity`. `loadScene` raises the capacity (to 16,384 or 65,536) when the scene needs more; the ground slab counts as one body, so a scene with the ground holds at most 65,535 of its own. `SceneBuilder.addBody` does not raise it and throws `WORLD_CAPACITY` when the world is full.

## Versioning

- `version` is an integer. This document is version 1.
- A reader accepts exactly the versions it knows. Version 1 readers reject any other number with `unsupported scene version N; this build reads version 1 only`, and do not guess.
- Within version 1 the schema is closed: unknown keys are errors. That keeps typos from being silently ignored and keeps canonical text and hashes well defined.
- Additive data that a version 1 reader may ignore goes in `extensions` (scene-wide) or `userData` (per body or joint). Use a key you own, for example your tool's name.
- Any change that a version 1 reader would misread, such as a new required key, a new shape kind, a changed default or a changed meaning, gets a new `version`. A later reader will keep reading version 1 files.
- Share links have their own version in the prefix (`b3s1`). A new compression or framing gets a new prefix; version 1 links stay readable.
- Canonical text and `sceneHash` are defined by the scene version. They are stable for version 1.
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

Two engine behaviours showed up while building the cradle and are worth knowing when you write scenes: restitution is not applied to slow impacts (a 0.44 m/s impact passed on 23% of its speed, a 1.85 m/s impact 99.6%), and balls that touch at rest do not pass the impulse cleanly, so the scene leaves a 2 mm gap.
