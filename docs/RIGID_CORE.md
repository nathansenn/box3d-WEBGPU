# Rigid core

The rigid-body engine is Box3D v0.1.0 compiled to WebAssembly behind a small C bridge (`wasm/box3d_web.c`). This
document covers what the bridge exposes beyond bodies, shapes and the six basic joints: scene queries, the capsule
character, continuous collision, vehicles, motor and breakable joints, world controls, the step profile, debug
drawing, and five example scenes. Stress tests at scale (tall stacks, piles of thousands of bodies) and a
thread-count option for the kit are not done yet; see [Not done](#not-done). Bodies, shapes, joints and events are in
[`packages/box3d-kit/README.md`](../packages/box3d-kit/README.md); exact checkpoints are in
[`CHECKPOINTS.md`](CHECKPOINTS.md); the scene format is in [`SCENE_FORMAT.md`](SCENE_FORMAT.md).

Every feature runs end to end: bridge export → `NativeWorldBackend` (`src/engine/native-world.ts`) →
`PhysicsWorld` (`packages/box3d-kit/src/world.ts`) → `RemoteWorld` (worker) → recording and replay where the call
changes the world → checkpoints. The world API version is still 1: every export below is optional, and an
artifact built before it reports `UNSUPPORTED_BACKEND` for the calls that need it
(`NativeWorldBackend.supportsRigidCore`).

Units are SI. Numbers under "Measured" are from `npm run validation:report`
([`VALIDATION.md`](VALIDATION.md), domain *Rigid core*), on one machine, with the tolerance each row is held to.

## 1. Scene queries

| Call (`PhysicsWorld`) | What it returns |
|---|---|
| `raycast(origin, translation, options?)` | Closest hit: body, point, unit normal, fraction of the translation, triangle index for meshes and height fields. |
| `raycastAll(origin, translation, options?)` | Every hit, nearest first, up to `limit` (default 32, at most 256). |
| `raycastBatch(rays, filter?)` | Closest hit of each of up to 65,536 rays in **one call into the engine**. `rays` is a flat list, 6 numbers per ray (origin, translation). Results are flat arrays indexed by ray: `fractions` (−1 for a miss), `points`, `normals`, `triangles`, `bodies`. |
| `sphereCast`, `boxCast`, `capsuleCast` | Closest hit of a swept sphere, axis-aligned box or upright capsule. |
| `overlapSphere`, `overlapBox`, `overlapCapsule` | Bodies whose shapes overlap the query shape. |
| `world.native.queryBatch(queries)` | Up to 128 mixed queries per call, each with up to 256 hits, including `'aabb-candidates'` (broad-phase bounds only). |

Filters (`options.filter`, or the second argument of `raycastBatch`): `bodies: 'all' | 'static' | 'dynamic' | 'none'`
(`'dynamic'` includes kinematic bodies), `categoryBits` and `maskBits` (64-bit, as bigints), and `ignoreBody`.
Queries read the world only: a world that was queried steps bit-identically to one that was not (tested).

```js
// A 64 x 64 depth scan from a sensor, one engine call.
const rays = new Float32Array(64 * 64 * 6);
for (let j = 0, k = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
  rays.set(sensorPosition, k); rays.set(direction(i, j).map(c => c * 50), k + 3); k += 6;   // 50 m range
}
const scan = world.raycastBatch(rays, {ignoreBody: sensorBody});
for (let n = 0; n < scan.count; n++) depth[n] = scan.fractions[n] < 0 ? Infinity : scan.fractions[n] * 50;
```

**Translations are whole displacements**, not directions: a ray from `o` along `d` ends at `o + d`, and a hit at
fraction `f` is at `o + f d`.

### What a sweep's fraction means

Box3D does not report the instant of first touch. A swept shape **without a radius** (a box) is stopped one
*linear slop* (5 mm) **before** the surface; a shape **with a radius** (sphere, capsule) is allowed to go up to one
slop **inside** it (exactly 5 mm onto a flat face, 3.8 mm to 5 mm onto a curved one). The reported hit point and
normal are those of that position. If you need the touching time, correct the fraction by
`0.005 / (|translation| cos(angle between translation and normal))`. A sweep that starts overlapping reports
fraction 0 and a zero normal.

### Measured

| Quantity | Measured | Held to |
|---|---|---|
| Ray against a sphere: hit point, 2,000 rays from every side | 3.2e-6 m | ≤ 5e-5 m |
| Ray against an oriented box: hit point | 1.7e-5 m | ≤ 5e-5 m |
| Ray against an oriented capsule: hit point | 2.8e-5 m | ≤ 5e-5 m |
| Unit normal, all three | ≤ 8.8e-6 | ≤ 1e-4 |
| Rays on which the engine and the closed form disagree about hitting (rays within 2 mm of grazing left out) | 0 of 5,978 | 0 |
| Box sweep onto a face: gap at the reported impact | +4.95 mm … +5.00 mm | 5 mm ± 0.2 mm |
| Sphere and capsule sweeps onto a face | −5.00 mm | −5 mm ± 0.2 mm |
| Sphere and capsule sweeps onto a sphere, off centre | −5.00 mm … −3.77 mm | within [−5.2 mm, 0] |
| Overlap counts on a 7 × 7 × 7 lattice: sphere, box, capsule, category mask, broad-phase bounds | 67, 40, 30, 33, 40: all exact | exact |
| `raycastBatch` against 4,096 single `raycast` calls (boxes, spheres, capsules, hulls, a mesh, a height field) | 0 rays differ in any bit | 0 |

One `raycastBatch` call for 4,096 rays took 18 ms against 134 ms for 4,096 `raycast` calls (Node 22, a loaded
4-core machine; a timing, not a validated number).

### Limits

- Query boxes are axis aligned and query capsules upright. Rotated query shapes are not exposed.
- `raycastBatch` returns the closest hit only; use `raycastAll` or `queryBatch` for all hits.
- When two hits are at exactly the same fraction, the one with the smaller body handle is reported, then the
  smaller triangle and compound child, in every ray call (`raycast`, `castRays`, `raycastBatch`), so the answer does
  not depend on tree order. `castRays` and `raycastBatch` use the bridge's closest-hit call
  (`b3w_world_cast_rays`): each ray is clipped just beyond its best hit so far, so shapes behind it are not tested,
  and a hit at the same fraction is still seen and compared. On the engine comparison's 100,000 rays against
  10,000 bodies this took `castRays` from 1,662 ms to 336 ms (best of three; load 4 before, 8.5 after, 4 CPUs) with
  the same 97,457 hits; `test/v22-rigid-queries.test.mjs` checks 72 rays built to tie (two bodies in one place, rays
  that start on a face, a mesh's shared edge, 50 km from the origin) against `raycast()`, bit for bit.
- Queries against meshes, height fields, hulls and compounds have no closed-form row; they are covered by the
  bit-for-bit agreement of the batched and single calls.

## 2. Character controller

`CapsuleCharacterController` (`box3d-webgpu-kit/gameplay`; source `src/engine/character-controller.ts`) is a capsule
moved by Box3D's character mover, the way the upstream character sample does it: gather the collision planes around
the capsule (`b3World_CollideMover`), solve for the closest allowed translation (`b3SolvePlanes`), and cast the
capsule along it (`b3World_CastMover`). The bridge runs up to 16 such rounds in one call
(`PhysicsWorld.moveCapsule`, which is also usable on its own).

```js
import {CapsuleCharacterController} from 'box3d-webgpu-kit/gameplay';

const character = new CapsuleCharacterController(world, {
  position: [0, 0.9, 0], radius: 0.3, height: 1.8,
  maxSlopeDegrees: 50, stepHeight: 0.35, maxPushForce: 800,
});
world.onStep(() => {
  const state = character.move({velocity: [input.x * 4, 0, input.z * 4], jump: input.jump ? 5 : 0}, world.loop.step);
  playerMesh.position.set(...state.position);
});
```

What it does, and where each rule comes from:

- **Walking.** On walkable ground the wanted velocity is turned into the ground plane and kept at the wanted speed,
  so the character moves at that speed *along* a slope. After each move it looks `snapDistance` below its feet and
  stays on the ground down slopes and stairs.
- **Slope limit.** A surface steeper than `maxSlopeDegrees` is a wall while the character stands on walkable ground
  (the bridge turns such planes vertical before the plane solver sees them), and a slide when it is in the air
  (pushing into it does not climb it).
- **Steps.** When a wall stops it, the character rises by `stepHeight`, moves one radius forwards and looks down. If
  walkable ground is there, higher than where it stood, it takes its move at that height; until the capsule itself
  stands on the ledge, the ledge under its leading foot carries it. While raised, anything that is not level is a
  wall, which is what makes the limit sharp: a ledge 5 mm higher than `stepHeight` is refused.
- **Jumping and falling.** In the air the vertical move of a step uses the mean of the speeds at its two ends, which
  is exact for constant gravity.
- **Moving platforms.** The character takes the velocity of the body under its feet at the point it stands on
  (`v + ω × r`), kinematic or dynamic, and keeps the horizontal part when it leaves.
- **Pushing.** A dynamic body in the way gets the impulse that brings its contact point up to the character's speed,
  limited to `maxPushForce × dt`, through `applyImpulseAt`. A box needs `μ m g` to slide, so boxes lighter than
  `maxPushForce / (μ g)` are pushed at walking speed and heavier ones stop the character.
- **Thin geometry.** Every translation is cast, so no speed gets the capsule through a wall.

The character is not a body: other bodies do not collide with it (give it a kinematic body to push things that
fall on it, and pass that body as `ignoreBody`), and a dynamic body it stands on does not feel its weight. Its own
state (`saveState()` / `restoreState()`) is ten fields; with the world's checkpoint it resumes a walk bit for bit.
A recording of the world holds the character's pushes, so a replay reproduces the world without the character.

### Measured

| Quantity | Measured | Held to |
|---|---|---|
| Speed on flat ground, commanded 3 m/s | 2.99998 m/s | 0.1% |
| Steepest ramp climbed / shallowest refused, limit 45° (0.5° scan) | 44.5° / 45° | limit ± 0.75° |
| The same at a 30° limit | 29.5° / 30° | limit ± 0.75° |
| Speed along a 42° ramp, commanded 2 m/s | 2.0000 m/s | 0.2% |
| Tallest ledge stepped onto / lowest refused, `stepHeight` 0.35 m (5 mm scan) | 0.350 m / 0.355 m | 0.35 m ± 6 mm / ± 11 mm |
| The same at 0.2 m | 0.200 m / 0.205 m | |
| Five stairs of 0.2 m up and down | top at 1.000 m, 0 of 385 steps of the way down in the air | 2 mm, 0 |
| Apex of a 5 m/s jump: v²/(2g) = 1.27421 m | 1.27420 m | 1 mm |
| Air time: 2v/g = 1.0194 s | 1.0167 s | one step (1/240 s) |
| A 1 cm wall at 10, 50, 100 and 300 m/s (5 m per move at the top speed) | 5.00 mm past the near face at every speed | ≤ Box3D's 5 mm slop |
| Carried by a platform moving at (1.5, 0.5) m/s | (1.49999, 0.50000) m/s, slip 0 | 0.1% |
| On a platform rising at 1 m/s for 2 s | 1.99999 m with the platform's 1.99999 m | 0.1% |
| Pushing, limit 400 N and μ = 0.5 (limit mass 81.5 kg): a 40.8 kg box | 1.487 m/s at a 1.5 m/s walk | 2% |
| The same push on a 163 kg box | 0.0013 m/s | ≤ 0.015 m/s |
| Resume from a checkpoint (a step, a platform ride, a jump, 68 pushes) | 0 of 1,150 later steps differ in any bit | 0 |

### Limits

- The capsule is upright and does not crouch. Its round bottom rides over bumps lower than
  `radius × (1 − cos(maxSlope))` (10.7 cm with the defaults) whatever `stepHeight` is.
- A step needs one radius of standing room on the ledge.
- A ramp exactly at the limit is on the edge of float32: it is refused, and the capsule may creep a few centimetres
  up its foot.
- A platform that moves away sideways faster than the character can follow in one step is left behind; a rising
  platform is followed with one step of lag (4 mm at 1 m/s and 240 Hz).
- Checked on boxes and ramps. Triangle-mesh and height-field ground work through the same queries but have no
  validation row.
- The older `CharacterController` (a box on box casts, no platforms, impulse pushing without a force limit) is
  unchanged and still exported.

## 3. Continuous collision

A discrete step moves a body by `v dt` and then looks for overlaps, so a small fast body can be on one side of a
thin wall before a step and on the other side after it. Box3D prevents this in two ways:

- **`continuous`** (world setting, on by default): a dynamic body that moves far in a step is swept against
  **static** shapes and stopped at the time of impact. `world.configure({continuous: false})` switches it off.
- **`bullet`** (body flag, `createBody({bullet: true})` or `world.setBullet(body, true)`): the body is also swept
  against **moving** bodies. Without it, two dynamic bodies are never swept against each other. Bullets cost
  more; use them for projectiles.

Both are part of a checkpoint. A `reset()` world has `continuous` on again.

### Measured

5 cm steel balls fired at a 2 cm static wall at 60 Hz, 24 start positions spread over one step of travel, so that
every alignment of the steps with the wall occurs:

| Speed | Travel per step | Through the wall, `continuous` off | Predicted | `continuous` on |
|---|---|---|---|---|
| 15 m/s | 0.25 m | 19 of 24 | 19 | 0 |
| 30 m/s | 0.5 m | 21 | 21 | 0 |
| 60 m/s | 1 m | 23 | 23 | 0 |
| 120 m/s | 2 m | 23 | 23 | 0 |
| 240 m/s | 4 m | 24 | 24 | 0 |

The prediction is a window model: without the sweep the ball is stopped only if some step ends with its centre
between `r + 2 cm` before the near face (Box3D makes contacts 2 cm ahead of touching: `B3_SPECULATIVE_DISTANCE`,
4 linear slops, read in `third_party/box3d/include/box3d/constants.h`) and the wall's mid-plane (deeper overlap is
pushed out of the far side). That window is `r + 2 cm + thickness / 2` = 5.5 cm out of every `v dt` of travel.

A 0.88 kg ball at 150 m/s (2.5 m per step) against a free 160 kg plate 2 cm thick: without the bullet flag the
ball passes and the plate does not move; with it both end at 0.82249 m/s, which is `m u / (m + M)` to 5 digits,
and the momentum is conserved to 9e-8 of its value.

### Limits

- Only translation is swept. A thin bar spinning fast can still pass through something.
- Kinematic bodies are not swept against static ones.
- Checked for spheres against boxes.

## 4. Vehicles

Box3D's wheel joint (`b3WheelJoint`, 36 functions) holds a wheel on a chassis with exactly what a car corner needs:
travel along one axis of the chassis with a spring, a damper and limits; free spin about the axle with a motor; and
steering about the travel axis with a spring, a torque limit and limits. So the vehicle is built from wheel joints
rather than from ray casts: the wheels are real bodies with mass and inertia that collide with everything.

`Vehicle` (`box3d-webgpu-kit/gameplay`; source `src/engine/vehicle.ts`) builds a chassis box, one sphere per wheel
and one wheel joint per wheel, and turns pedals and a steering wheel into joint settings:

```js
import {Vehicle} from 'box3d-webgpu-kit/gameplay';

const car = new Vehicle(world, {
  position: [0, 0.6, 0], chassisHalfExtents: [1.6, 0.25, 0.75], chassisMass: 1200,
  wheels: [{position: [1.3, -0.25, -0.8]}, {position: [1.3, -0.25, 0.8]}, {position: [-1.3, -0.25, -0.8]}, {position: [-1.3, -0.25, 0.8]}],
  wheelRadius: 0.35, wheelMass: 20,
  suspension: {stiffness: 60000, damping: 4000, travel: 0.2},     // N/m and N s/m per wheel
  maxDriveTorque: 400, maxBrakeTorque: 1500, maxSteerAngle: 0.6, dragArea: 0.7,
});
world.onStep(() => car.update({throttle: keys.up - keys.down, steer: keys.left - keys.right, brake: keys.space}));
```

Chassis axes: +x forward, +y up, +z right. `steer` > 0 turns left.

- **Suspension in physical units.** Box3D states a joint spring as a frequency of *the joint's own effective mass*
  (`1 / (1/M + 1/m + (r × a) · I⁻¹ (r × a))` for a wheel of mass `m` at `r` from the chassis' centre of mass, travel
  axis `a`), not of the chassis. With a 20 kg wheel under a 1,200 kg chassis that mass is about 19 kg, so a "2 Hz"
  wheel joint is a spring of 3 kN/m, not the 12 kN/m a 300 kg corner needs. `Vehicle` takes the stiffness (N/m) and
  damping (N s/m) you mean and computes the joint's frequency and damping ratio for each wheel; or it takes the
  bounce `frequency` and `dampingRatio` of the chassis on its springs.
- **Steering** follows Ackermann geometry: for a bicycle angle δ the wheels steer so that every axle line passes
  through one point on the rear axle line, at `R = L / tan δ` from the centre line.
- **Drive and brake.** The throttle sets each driven wheel's motor to `maxWheelSpeed` with a torque limit of
  `throttle × maxDriveTorque`; the brake sets the motor to zero speed with `brake × maxBrakeTorque`.
- **Drag** is `ρ CdA v² / 2` against the chassis' velocity, applied each step.
- `update()` talks to the joints only when a setting changes, so a recording of a drive stays small. The vehicle's
  own state (the last controls) saves with `saveState()`; its bodies and joints are in the world's checkpoint.

`world.getJointDetails(joint)` reports a wheel joint's spin speed and torque, steering angle and torque, and
suspension travel; `setJointSteeringLimits` limits the steering angle.

### Measured

| Quantity | Closed form | Measured | Held to |
|---|---|---|---|
| Static sag, 1,200 kg on 4 × 60 kN/m | M g / (4 k) = 49.050 mm | 49.050 mm | 0.1% |
| Front / rear sag with the centre of mass 0.4 m forward | M g (½ ± x/L) / (2 k) = 64.14 / 33.96 mm | 64.22 / 33.86 mm | 0.5% |
| Heave frequency, 1,200 kg on 4 × 60 kN/m | √(4k/M)/(2π) = 2.2508 Hz | 2.2332 Hz (−0.8%) | 1.5% |
| Heave frequency, 800 kg on 4 × 20 kN/m | 1.5915 Hz | 1.5890 Hz (−0.2%) | 1.5% |
| Damping ratio with 4 × 2 kN s/m | 4c / (2√(4kM)) = 0.2357 | 0.2472 | ± 0.02 |
| Top speed, 4 × 40 N m against CdA = 1.2 m² | √(8τ/(R ρ CdA)) = 24.939 m/s | 24.988 from below, 25.013 from above | 1% |
| The same at 4 × 80 N m, 0.8 m² / 4 × 20 N m, 2 m² | 43.196 / 13.660 m/s | 43.33…43.36 / 13.67…13.69 m/s | 1% |
| Turning radius at 3 m/s, δ = 0.25 rad, L = 2.6 m | L / tan δ = 10.1824 m | 10.1849 m (speed over yaw rate), 10.1847 m (circle fit) | 1% |
| Turning radius at 2 m/s, δ = 0.4 rad | 6.1496 m | 6.1506 m | 1% |
| Inner front wheel angle, track 1.6 m | atan(L / (R − T/2)) = 0.27033 rad | 0.27029 rad | ± 0.002 rad |
| Braking from 20 m/s with locked wheels, μ = 0.8 | v² / (2 μ g) = 25.474 m | 25.421 m in 2.546 s (exact 2.548 s) | 1% |
| Drive over a height field, restored from a checkpoint half way | identical | 0 of 1,500 steps differ in any bit | 0 |

Why the small misses: the tyre contact is itself a stiff spring in series with the suspension (lower frequency);
the integrator of the joint spring is implicit and adds a damping ratio of 0.010 to 0.018 at 240 Hz with 4 sub-steps
(measured with the dampers at zero); and a wheel rolls on a radius a little smaller than `R` because its contact
sinks by millimetres, so the thrust `τ / R` is a little higher (top speed +0.2% to +0.4%; wheel slip 0.4% to 1%).

### Limits

- Wheels are rigid spheres with Coulomb friction. There is no tyre model (slip curves, camber, load sensitivity,
  relaxation), no drivetrain (gears, differential, engine curve), no anti-roll bars, no aerodynamic lift.
- Validated at low lateral acceleration (0.88 m/s²). Cornering at the limit, roll-over and jumps behave as rigid
  bodies with friction do and are not checked against vehicle data.
- A sphere wheel is as wide as it is tall; give the chassis and other bodies room for it.
- 2 to 16 wheels. Tracked vehicles and trailers are joints you add yourself.

## 5. Joints: motor, parallel, filter, events and breaking

`createJoint` takes nine types. The first six (`weld`, `revolute`, `spherical`, `prismatic`, `distance`, `wheel`)
are in the kit README. The others:

| Type | What it does | Options |
|---|---|---|
| `motor` | Drives the relative motion of two bodies in all six degrees of freedom: hold a relative linear and angular velocity with a bounded force and torque, and/or pull frame B onto frame A with a linear and an angular spring, each with its own force limit. | `drive: {linearVelocity, angularVelocity, maxForce, maxTorque, linearSpring: {hertz, dampingRatio, maxForce}, angularSpring: {hertz, dampingRatio, maxTorque}}`; `setJointDrive` |
| `parallel` | Keeps the z axis of frame B along the z axis of frame A with a spring; leaves position and spin about that axis free. For keeping something upright. | `spring: {hertz, dampingRatio}`, `maxTorque`; `setJointParallelSpring` |
| `filter` | Stops the two bodies colliding with each other. Nothing else. Removing it restores the collision at once. | none |

**A 6-DOF joint** is a combination: a `motor` joint with springs is a soft 6-DOF drive to a pose (stiffness per
group, not per axis); a `prismatic` or `revolute` joint with limits, motor and spring gives one controlled axis and
locks the other five; a `spherical` joint has a cone limit, twist limits, a spring to a target rotation
(`setJointTargetRotation`) and an angular motor (`setJointAngularMotor`). Per-axis linear limits with free rotation
(a full generic 6-DOF constraint) are not in Box3D v0.1.0; chain a massless-enough intermediate body with one
joint per axis if you need that, or use the robot importer, which does it for URDF and MJCF.

### Joint events and breakable joints

Every joint can have a force threshold (N) and a torque threshold (N m), `thresholds: {force, torque, breakable}`
at creation or `setJointThresholds` later. In every step in which the joint's constraint force or torque is at or
above a threshold, the world reports a `'joint-overload'` event with the joint, its bodies, and the force and
torque it carried. With `breakable: true` the joint is destroyed at the end of that step and the event is
`'joint-break'`. Breaking happens in the engine, with or without a listener, so it is the same in a replay and
after a checkpoint (the flags travel in the checkpoint).

`getJointState(joint)` gives the reaction force and torque; `getJointDetails(joint)` adds the separation errors
(how far the joint is from holding), the thresholds, and per type: angle, limits, motor torque, travel and speed,
cone angle, wheel spin, steering angle and suspension travel.

### Measured

| Quantity | Closed form | Measured | Held to |
|---|---|---|---|
| Breakable weld, threshold 500 N, load growing by 0.25 N per step | breaks at 500 N | whole at 500.10 N, broke at 500.35 N | ± 0.75 N |
| Breakable weld holding a block 0.5 m to the side, threshold 100 N m | breaks at 100 N m | whole at 99.925 N m, broke at 100.05 N m | ± 0.375 N m |
| Reaction force a weld reports | weight + applied force | within 0.2% | 0.2% |
| `joint-overload` events while over the threshold for 120 steps / while under | 120 / 0 | 120 / 0 | exact |
| Motor joint, 200 N velocity drive to 3 m/s on 65.4 kg | m v / F = 0.9817 s | 0.9833 s, then holds 3.0000 m/s | 2 steps; 0.01% |
| Motor joint, 3 N m spin drive to 4 rad/s | I ω / τ = 2.1817 s | 2.1833 s | 2 steps |
| Motor joint, undamped 1.5 Hz spring | T = 0.66667 s | 0.66670 s | 0.2% |
| Motor joint, critically damped return after one period, from 0.4 m | x₀(1 + ωt)e^(−ωt) = 5.44 mm | 5.86 mm | ± 2 mm |
| Motor joint spring under gravity, 2 Hz, 64 kg and 512 kg | g / (2πf)² = 62.123 mm | 62.119 mm, both | 0.2% |
| Parallel joint, undamped 1 Hz | T = 1 s | 0.99901 s | 0.3% |
| Filter joint: two overlapping boxes after 1 s | 0.4 m (unchanged) | 0.4 m | 1e-6 m |
| After removing it, against boxes that never had one | 1.2914 m | 1.2914 m | 1 mm |
| Checkpoint before a weld breaks; restored world | same tick | tick 1216 in both; 0 of 1,440 later steps differ | exact |

### Limits

- A joint's force is evaluated at every sub-step. A short impact can break a joint whose mean load over the step
  is below its threshold; choose thresholds with the sub-step in mind.
- Box3D's springs are integrated implicitly: frequencies hold to 0.2%, but an undamped spring loses amplitude
  (a numerical damping ratio of about 0.008 at 240 Hz with 4 sub-steps).
- When a joint other than a filter joint is removed or breaks, two bodies that were overlapping start to collide
  only once one of them has moved out of its bounds margin (a few centimetres): Box3D pairs shapes when they move.
  Pieces of a breaking structure are moving, so this is rarely visible.
- A joint spring's `hertz` is a frequency of the joint's own effective mass (see Vehicles), which equals the
  body's mass only when the other body is the world or much heavier.

## 6. World controls and introspection

| Call | What |
|---|---|
| `world.settings()` / `world.configure({...})` | `sleeping`, `continuous`, `speculative`, `warmStarting` (booleans); `restitutionThreshold` and `hitEventThreshold` (m/s); `contactHertz`, `contactDampingRatio`, `contactPushSpeed` (m/s); `maximumLinearSpeed` (m/s); `contactRecycleDistance` (m). Box3D's defaults: on, on, on, on, 1, 1, 30, 10, 3, 400, 0.05. `configure` wakes every dynamic body. Settings last until the next `reset()` and are part of a checkpoint. |
| `world.setSleep(body, {enabled, threshold})`, `setBullet`, `setMotionLocks(body, {linearX…angularZ})`, `getBodyFlags(body)` | Per-body sleeping, bullet flag and motion locks (a 2D body: lock `linearZ`, `angularX`, `angularY`). |
| `world.awakeCount()` | Bodies being simulated. |
| `world.explodeArea({center, radius, falloff, impulsePerArea, maskBits})` | Box3D's explosion: every sphere, capsule and hull within `radius + falloff` takes an impulse along the line from the centre to its closest point, of `impulsePerArea` × the area it shows × a factor that falls linearly from 1 at `radius` to 0 at `radius + falloff`. Applied at the closest point, so bodies hit off-centre spin. (`world.explode(center, strength, radius)` is the older call: a centre impulse with an upward bias.) |
| `world.profile()` | Box3D's own timing of the most recent step, in milliseconds by stage (`step`, `pairs`, `collide`, `solve`, `solverSetup`, `constraints`, `prepareConstraints`, `integrateVelocities`, `warmStart`, `solveImpulses`, `integratePositions`, `relaxImpulses`, `applyRestitution`, `storeImpulses`, `splitIslands`, `transforms`, `sensorHits`, `jointEvents`, `hitEvents`, `refit`, `bullets`, `sleepIslands`, `sensors`), and counters (`bodies`, `shapes`, `contacts`, `joints`, `islands`, tree heights, `awakeBodies`, `awakeContacts`, …). Wall-clock numbers; not part of a checkpoint. |
| `world.contactStats()` | From the solver's manifolds: touching `pairs`, contact `points`, `deepestPenetration` and `meanPenetration` (m), `totalNormalForce` and `largestNormalForce` (N). The health check for stacks and piles. |

What the less obvious settings do, as measured: a ball that lands faster than `restitutionThreshold` bounces
(to 0.0485 m from a 0.2 m drop with restitution 0.5, where e²h is 0.05 m) and one that lands slower does not at all;
`hitEventThreshold` is the approach speed above which a `'hit'` event is reported (1.962 m/s reported for
√(2gh) = 1.981 m/s; the speed is taken one step before the plane); `maximumLinearSpeed` clips every body (20.000 m/s
after an impulse worth 10⁵ m/s); `contactPushSpeed` is the speed at which overlap is resolved (a ball started 0.3 m
inside the ground leaves it at 2.998 m/s with the default 3 and at 0.498 m/s with 0.5).

The explosion matches its formula to float32: a sphere of radius 0.2 m takes `P π r² / m` = 0.18750 m/s (measured
0.18750), half of that half way across the falloff, nothing beyond it, and a box showing a 0.6 × 0.8 m face takes
`P A / m`. The contact statistics of 16 stacks of three boxes report 48 pairs, 192 points and a total normal force
of 117,720 N, which is 16 × (3 + 2 + 1) box weights to 6 digits, with the deepest overlap at 1.1 mm.

## 7. Debug draw

`world.debugLines(options)` runs Box3D's own debug drawing (`b3World_Draw`) and returns line segments: `positions`
(x, y, z per vertex, two vertices per line) and `colors` (r, g, b in 0..1 per vertex). Layers: `joints`,
`jointExtras` (frames and limits), `bounds` (the bounding box of every shape), `mass` (centres of mass with body
axes), `contacts`, `contactNormals`, `contactForces`, `frictionForces`, `islands`, and `graphColors` (colour contacts
by solver colour). `region: {min, max}` draws only what lies in a box; `jointScale` and `forceScale` size the
drawings. At most 1,048,576 vertices; `truncated` says when the rest was dropped. It reads the world only.

```js
const lines = world.debugLines({contacts: true, contactNormals: true, joints: true});
geometry.setAttribute('position', new THREE.BufferAttribute(lines.positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(lines.colors, 3));     // THREE.LineSegments, vertexColors
```

In the Physics Lab: **`lab.html?debug=1`** (contacts, normals, joints, mass centres), `?debug=all`, or a list such
as `?debug=joints,bounds`; and the **Debug draw** switch with its six layers in the Scenes panel. The lines go
through the overlay-line path that both renderers share, so they are drawn the same on WebGPU and on WebGL2
(`?renderer=webgl2`). The Lab draws at most 60,000 lines a frame and asks the engine again only when bodies have
moved or the layers changed. It applies to scenes that run in a general world (scene files, examples, the SI
demos); the 800 recipes use the compatibility world, which has no debug draw.

Counts are exact for a known scene: 50 shapes give 50 × 12 edges = 1,200 bound vertices, and 192 contact points
give 192 × 3 lines = 1,152 vertices (registry rows). Shapes themselves are not drawn by this call (the renderers
draw them); text labels (body names, contact features) are dropped.

## 8. Examples and scene roles

Five scene files show the rigid core. `RIGID_CORE_EXAMPLE_SCENES` (`box3d-webgpu-kit/scene`) has them by name and
the Lab opens them with `lab.html?example=<name>` or from the Scenes panel. They are plain scenes of bodies and
joints; two use scene version 3 ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#joints-version-3)).

| Name | What it shows | Played by |
|---|---|---|
| `obstacle-course` | The capsule character: four stairs of 0.2 m, a 25° ramp, a 26 kg crate to push, a ledge, a platform that moves sideways under it, a 60° slope and a 0.8 m wall it cannot climb. | role `character`, `platform` |
| `vehicle-terrain` | A 1,200 kg car on four wheel joints, 60 kN/m and 5 kN·s/m per wheel, Ackermann steering, on 128 m × 128 m of rolling terrain. | role `vehicle`, `wheel` |
| `laser-scanner` | 96 rays in one `castRayBatch` call per step, turning at 0.35 rad/s, drawn to their hit points among static bodies, a pendulum and a rolling ball. | role `laser` |
| `bullet-plates` | Continuous collision in three lanes at 60 Hz: a 150 m/s ball (2.5 m per step) passes five free 2 cm plates; with `bullet: true` it hits the first; without it, a thin static wall still stops it. | nothing: it is physics only |
| `breakable-bridge` | Eight planks on nine breakable welds; a 300 kg block dropped 2 m breaks the span. | nothing: joint thresholds |

### Scene roles

What makes the first three playable is `userData.role` on a body or a joint, read by `SceneRoles`
(`src/engine/scene-roles.ts`, exported by `box3d-webgpu-kit/gameplay`). The scene format carries `userData` and
never reads it, so a file with roles is an ordinary scene to any other reader. The roles and their settings are
listed in [`SCENE_FORMAT.md`](SCENE_FORMAT.md#scene-roles).

```js
import {createWorld} from 'box3d-webgpu-kit';
import {loadScene, sceneWorldOptions, RIGID_CORE_EXAMPLE_SCENES} from 'box3d-webgpu-kit/scene';
import {attachSceneRoles} from 'box3d-webgpu-kit/gameplay';

const scene = RIGID_CORE_EXAMPLE_SCENES['obstacle-course']();
const world = await createWorld(sceneWorldOptions(scene));
const loaded = loadScene(world, scene);
let input = null;                                   // null: the scene plays itself (route, autopilot)
const roles = attachSceneRoles(loaded, {input: () => input});
// each fixed step:
input = {move: [1, 0], jump: false};                // or {throttle, steer, brake} for a car
loaded.simulation.step();                           // the roles act, then the world steps
roles.state.character.position;                     // roles.character is the CapsuleCharacterController
```

The roles are a subsystem of the scene's Simulation (stage `pre-couple`): they act before every rigid step, and
`loaded.simulation.checkpoint()` holds their state (the controller, the route progress, the clock that moves
platforms and turns scanners) beside the world's. A checkpoint taken while a scene is played resumes bit for bit
(tested mid-push on the course, mid-circle in the car, with the bullet in its plate, and across the break of the
bridge). A simulation without the roles refuses such a checkpoint (`CHECKPOINT_MISMATCH`).

### In the Lab

`src/lab/rigid-play.ts` gives a played scene the keyboard:

| Scene | Keys |
|---|---|
| A character | W A S D or the arrow keys walk, relative to the camera; Space jumps. |
| A car | W and S (or up and down) are throttle and reverse, A and D (or left and right) steer, Space brakes. |

Left alone the scene plays itself; after a key, the player keeps control until nothing has been pressed for 4 s.
While such a scene is open these keys do not trigger the Lab's own shortcuts (Space, D, the arrows); the others
still do. The camera follows the character or the car. A scanner's beams are overlay lines on both renderers.
The Lab steps a scene with roles through its Simulation, so **Save checkpoint** and **Load checkpoint** resume a
played scene exactly, and the Lab and the kit give equal `exactHash` and `replayHash` for all five scenes at 0, 1,
240 and 1,200 steps (kit test).

### The breakable bridge, at rest

The bridge is a beam built in at both ends, made of n = 8 rigid links of length l on n + 1 soft welds, under its
own weight w per metre (135 kg per plank: w = 1,324.35 N/m). By symmetry each support carries half the weight,
V = w L / 2 = 5,297.4 N. The moments follow from compatibility: the rotations of the welds must add up to zero.
A weld turns by M / k under a moment M, and a Box3D joint spring is stated as a frequency of the joint's own
effective inertia, so its stiffness is proportional to (1/I_A + 1/I_B)⁻¹: a weld between two planks has half the
stiffness of a weld between a plank and a fixed abutment. With M(x) = −M₀ + V x − w x² / 2 at the welds x = 0, l,
…, n l and the two end welds counted at half weight,

  M₀ = w l² (n² − 1) / 12 = 6,952.8 N·m for n = 8,

which tends to the continuous beam's w L² / 12 (7,063.2 N·m) as n grows; the mid-span moment is
V L / 2 − w L² / 8 − M₀ = 3,642.0 N·m. The welds break at 6 V (31,784 N) or 3 M₀ (20,859 N·m).

This closed form is derived here, not taken from a table; the limit n → ∞ is the textbook value. It depends on
Box3D's convention for joint springs, which section 4 measured independently on wheel joints.

### Measured

| Case | Reference | Measured | Tolerance |
|---|---|---|---|
| Course: feet on the deck after four stairs | 0.8 m | 0.80002 m | 1 mm |
| Course: jump on the route | v² / 2g = 1.27421 m | 1.27420 m | 0.1% |
| Course: one lap of the route | (no closed form) | 24.98 s; crate pushed 1.84 m; 1.61 s on the platform; stopped 0.23 m before the foot of the 60° slope | asserted as ranges |
| Vehicle: static sag of the scene-file car | m g / 4k = 0.04905 m | 0.04901 m | 0.5% |
| Vehicle: autopilot circle on the terrain | L / tan δ = 10.18 m | 10.21 m (mean speed 6.16 m/s over mean yaw rate) | 5% |
| Scanner: length of pitched rays to the ground | h / sin p = 10.4417 m | worst error 8 × 10⁻⁷ m | 10⁻⁵ m |
| Scanner: hit points on the two static spheres | on the surface | worst 1.9 × 10⁻⁷ m off | 10⁻⁴ m |
| Bullets: free plates that noticed an ordinary 150 m/s ball | 0 of 5 | 0 | exact |
| Bullets: momentum through the bullet impact | 1,058.6 N·s | 1,048.5 N·s (−0.95%) | 2% |
| Bridge at rest: support shear | w L / 2 = 5,297.4 N | 5,297.5 N | 0.01% |
| Bridge at rest: support moment | w l² (n² − 1) / 12 = 6,952.8 N·m | 6,952.6 N·m | 0.1% |
| Bridge at rest: mid-span moment | 3,642.0 N·m | 3,641.8 N·m | 0.1% |
| Bridge: first weld breaks | √(2h / g) = 0.6386 s | 0.6417 s (the step after) | 2 steps |
| Bridge: weakest weld that broke | ≥ 1 × its threshold | 1.40 | lower bound |

Seven of the nine welds break in the step the block lands; the two end welds stay, each holding one plank as a
cantilever. A scene saved after the break holds those two welds and no others.

### Limits

- Roles are for examples and small games: one character and one vehicle per scene, a platform moves on a sine,
  and the route walker steers straight at its next point (it does not plan around obstacles; the example's route
  is laid out so that it does not need to).
- The player's keys are input, not state: a checkpoint restores the scene, not which keys were held.
- The bullet's momentum row loses about 1% to ground friction in the step of the impact; it is not a statement
  about the solver's conservation in free flight (section 3 has that).
- The bridge's welds all see the impact in one step, because the planks are rigid: which welds break depends on
  the step size as well as on the block. The example is deterministic, not mesh-converged.
- The vehicle circle is measured on bumpy ground and so only to 5%; the flat-ground rows are in section 4.

## Custom filter and pre-solve callbacks: not exposed

Box3D can call the application for every candidate pair (`b3World_SetCustomFilterCallback`) and for every touching
contact before it is solved (`b3World_SetPreSolveCallback`). The bridge does not expose them, for three reasons:

1. **Cost.** Each call would cross from WebAssembly into JavaScript and back. A 5,000-body pile has about
   20,000 contacts per step, at 4 sub-steps a frame; a boundary crossing costs on the order of 100 ns, which is
   several milliseconds a frame before the callback does anything.
2. **Threads.** In the pthread artifact the callbacks run on worker threads, which have no access to the page's
   JavaScript. Routing them to the main thread would block the solver's barriers.
3. **Determinism and checkpoints.** A callback is code outside the engine: a replay or a restored checkpoint is
   exact only if the same callback is installed and answers the same way, which the engine cannot check.

What is exposed instead is declarative and travels in checkpoints: category and mask bits and group indices per
body (`filter`, `setCollisionFilter`), `collideConnected` per joint, and the **filter joint** (`type: 'filter'`),
which switches off collision between two chosen bodies and does nothing else.

## Not done

- **Scale.** No stress test of a 20-row pyramid, a 5,000-body pile, a 1,000-hull pile or a ragdoll pile is in the
  repository yet, and no single- versus multi-threaded step times of them were measured. The rows above are of
  scenes with at most a few hundred bodies.
- **Threads in the kit.** `loadBox3D` and `createWorld` load only the single-threaded artifact. The pthread
  artifact (`public/box3d/box3d-mt.*`, [`THREADED_ENGINE.md`](THREADED_ENGINE.md)) is used by the Lab only.

