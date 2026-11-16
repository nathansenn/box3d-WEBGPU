# Joints

A joint connects two bodies, or a body and the fixed world (`null`). Frames are in each body's own coordinates.

```js
import {axisRotation} from 'box3d-webgpu-kit';

const hinge = world.createJoint({
  type: 'revolute', bodyA: post, bodyB: door,
  frameA: {position: [0.5, 1, 0], rotation: axisRotation([0, 1, 0])},   // hinge about the world's up axis
  frameB: {position: [-0.5, 0, 0], rotation: axisRotation([0, 1, 0])},
  limits: {lower: 0, upper: Math.PI / 2},
  motor: {speed: 1, maxForce: 20},
});
world.setJointMotor(hinge, null);                       // off
world.getJointState(hinge);                             // {type, value: the angle, force, torque}
```

| Type | Moves | Limits | Motor | Spring | Extra |
| --- | --- | --- | --- | --- | --- |
| `weld` | nothing | - | - | makes it flexible | |
| `revolute` | turns about the frame's z | angle | yes | yes | |
| `spherical` | turns freely | twist | - | yes | `coneAngle` |
| `prismatic` | slides along frame A's x | travel | yes | yes | |
| `distance` | keeps a length | length | yes | yes | `length` (required) |
| `wheel` | spins about z, suspension along x | travel | spin | suspension | `setJointSteering` |

`axisRotation(axis)` gives the frame rotation that puts the hinge on `axis`; for a prismatic joint pass `'x'` as the
second argument.

## Keeping joints stable

These are the rules `world.diagnose()` checks ([the table](../../reference/errors.html)):

- Keep the masses on a joint within about 10 to 1.
- Keep a joint's spring or `stiffness` frequency below one eighth of the sub-step rate (30 Hz at 60 Hz with 4
  sub-steps). Raise `subSteps` for stiffer joints.
- Put each frame near its body: within 50 radii of gyration of the centre of mass.
- Do not ask one body to satisfy joints that contradict each other.

A set-up outside them can make the native solver diverge. A world created with `strict: true` throws
`NUMERICAL_FAILURE` at the step where that happens; otherwise `world.stats().nonFiniteSince` records it.
