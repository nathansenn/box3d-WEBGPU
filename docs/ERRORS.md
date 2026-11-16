# Errors and diagnostics

Everything the engine refuses, it refuses the same way: it throws an `EngineError` with a `code` from one table, a
message that names the field, the value it got and the values it takes, and it leaves the world or solver as it was.
This page lists the codes, the ranges the rigid world accepts, and the rules `world.diagnose()` and
`simulation.diagnose()` check. The tables are written from the code by `node scripts/errors-doc.mjs`, and
`tests/fuzz/error-taxonomy.test.mjs` fails when they drift or when a code is thrown that is not listed.

## The shape of an error

```js
import {createWorld, isEngineError, explainError} from 'box3d-webgpu-kit';

const world = await createWorld({gravity: [0, -9.81, 0]});
try {
  world.createBody({shape: {kind: 'sphere', radius: -1}, position: [0, 2, 0]});
} catch (error) {
  if (!isEngineError(error)) throw error;
  error.code;       // 'INVALID_PAYLOAD'
  error.message;    // 'radius must be finite and within [0.0001, 1000]; got -1. Pass a finite number within [0.0001, 1000].'
  error.details;    // {path: 'radius', value: '-1', expected: 'a finite number within [0.0001, 1000]'}
  error.fix;        // what to do about this code, from the table below
  explainError(error); // {code, meaning, message, fix, path}: the parts a toast or a log line shows
}
```

- `code` is a key of `ENGINE_ERRORS` (exported with the type `EngineErrorCode`). Switch on it; messages may be reworded.
- `details` is present where one field is at fault: `path` (a dotted name, or a JSON pointer for a scene file),
  `value` (the offending value, shortened and safe to print) and `expected`.
- `isEngineError` works across module copies and workers, where `instanceof` does not.
- A scene file that fails validation throws `SceneValidationError` (code `INVALID_PAYLOAD`) with `problems`, each a
  `{path, message}` whose path is a JSON pointer (RFC 6901) into the file. `validateScene` returns the same list
  without throwing. An XML file throws `XMLParseError` with `line` and `column`.
- A refused call changes nothing. The fuzzers check this by comparing a checkpoint of the world before and after every
  refused call (docs/ROBUSTNESS.md).

Two deliberate exceptions to "throws":

- Questions about a handle answer instead of throwing: `isAlive`, `isJointAlive`, `destroyBody`, `destroyJoint` and
  `getPose` return `false` or `null` for a destroyed body or joint.
- `update(frameSeconds)` and `interpolatedMatrices(alpha)` take time from a clock and clamp it: a negative, zero,
  huge or non-finite value is treated as documented, not refused.

A few modules that predate the taxonomy still throw the built-in `RangeError` or `TypeError` for programmer errors
(the water modules and the couplings' constructor checks: 42 throws in 12 engine files). The taxonomy
test lists them by file so that the number can only go down.

## Codes

<!-- generated:codes by scripts/errors-doc.mjs: edit src/engine/contracts.ts, then run node scripts/errors-doc.mjs -->
### What you passed

| Code | What it means | What to do |
| --- | --- | --- |
| `INVALID_PAYLOAD` | An argument, option, file or message holds a value the engine cannot use. | Read the message: it names the field, the value it got and the values it takes. Correct the input and call again; nothing was changed. |
| `INVALID_STATE` | The call is valid, but not in the state the object is in now. | Do the step the message names first (for example stop recording before reset, or step before reading results). |

### What the object you called still is

| Code | What it means | What to do |
| --- | --- | --- |
| `DISPOSED` | The world, pool, solver or runtime was destroyed, or its native handle is no longer valid. | Create a new one; do not keep references past dispose() or destroy(). |
| `STALE_BODY` | The body handle names a body that was destroyed, or one from before a reset. | Check world.isAlive(body) before using a kept handle, and drop handles when you destroy or reset. |
| `STALE_JOINT` | The joint handle names a joint that was destroyed, or one of its bodies was. | Check world.isJointAlive(joint) before using a kept handle. |
| `STALE_QUERY` | Body storage changed between validating a spatial query and running it. | Run the query again. |
| `STALE_GENERATION` | A reply or command belongs to a runtime generation that was reset. | Discard it and issue the request again against the current runtime. |
| `STALE_REQUEST` | A request was superseded by a newer one before it ran. | Use the result of the newer request. |
| `STALE_SNAPSHOT` | A snapshot was read after the buffer it lives in was reused. | Copy what you need from a snapshot before the next step, or request a new one. |

### Limits

| Code | What it means | What to do |
| --- | --- | --- |
| `WORLD_CAPACITY` | The world, the module or a scene is at a fixed limit (16 worlds per module, 65,536 bodies per world). | Destroy what you no longer need, reserve capacity up front with `capacity`, or split the scene. |
| `ALLOCATION_FAILED` | The WebAssembly heap could not grow, or a native allocation failed. | Free worlds you no longer use; the existing world is intact. On 32-bit WebAssembly the heap is at most 2 GiB. |
| `WORK_LIMIT` | A solver reached its iteration or work budget before it met its tolerance. | Raise the budget the message names, use a smaller time step, or coarsen the model. |
| `QUERY_VERSION_EXHAUSTED` | A world ran more than 2^32 query batches. | Create a new world. |
| `SEQUENCE_EXHAUSTED` | A shared snapshot ring used all of its sequence numbers. | Reset the runtime with a new ring. |
| `BACKPRESSURE` | More work was queued than the worker accepts at once. | Wait for earlier requests to settle before sending more. |
| `BUSY` | The runtime is in the middle of another request. | Await the pending request first. |

### What the platform or the build can do

| Code | What it means | What to do |
| --- | --- | --- |
| `UNSUPPORTED_BACKEND` | This build, WASM artifact or file version does not have the feature the call needs. | Use the artifact shipped with this version (npm run build:wasm in the repository), or the feature the message names. |
| `UNSUPPORTED_JOINT` | That joint type does not take that setting. | See the joint feature table in the kit README: for example only revolute, prismatic, distance and wheel joints have motors. |
| `INVALID_BACKEND` | The WASM module answered with something outside its contract. | The artifact and the JavaScript do not match: rebuild or reinstall so that both come from the same version, and report it if they already do. |
| `WASM_UNAVAILABLE` | WebAssembly could not be loaded or instantiated here. | Check that box3d.wasm is served (the message has the URL and reason) and that the runtime supports WebAssembly. |
| `INTEGRITY_MISMATCH` | The loaded box3d.wasm is not the file this package was built with. | Serve the box3d.wasm from the same package version, without rewriting proxies. |
| `SHARED_UNAVAILABLE` | SharedArrayBuffer is not available (the page is not cross-origin isolated). | Send COOP and COEP headers, or use the copying transport. |

### Files and saved state

| Code | What it means | What to do |
| --- | --- | --- |
| `INCOMPATIBLE_SAVE` | A saved session came from another WASM build or native interface version. | Replay it with the build recorded in the file; replays are exact only on the build that made them. |
| `CHECKPOINT_MISMATCH` | A checkpoint is damaged, of another format version, or from another scene or set-up. | Restore it into a world and solvers built the same way by the same version; nothing was changed by the refused restore. |
| `MODEL_MISMATCH` | Saved or transferred state names a model other than the one receiving it. | Create the runtime with the model the state was produced by. |

### Numerics

| Code | What it means | What to do |
| --- | --- | --- |
| `UNSTABLE_TIME_STEP` | The time step is above the stability limit of the method for these inputs. | Use the step the message gives (it states the limit and the rule), or the solver's stableTimeStep() helper. |
| `NUMERICAL_FAILURE` | A solve produced a non-finite number or failed to converge. | Reduce the time step or the load increment; check world.diagnose() or simulation.diagnose() for ill-conditioned inputs. |
| `SOLVER_NOT_CONVERGED` | An iterative linear solve stopped at its iteration limit. | Raise maxIterations or loosen the tolerance; the message has the residual reached. |
| `SOLVER_BREAKDOWN` | A matrix that must be positive definite is not. | Check material values and constraints: a negative conductivity, capacity or stiffness, or an unconstrained body, causes this. |
| `SINGULAR_STEADY` | A steady problem has no unique answer. | Fix a temperature or add a convective or radiating face on every separate solid. |

### Workers

| Code | What it means | What to do |
| --- | --- | --- |
| `NOT_RUNNING` | The worker or runtime is not running. | Start it, or create a new one after a failure. |
| `NOT_CREATED` | A worker was asked to use a runtime before one was created. | Send the create request first. |
| `RESET` | The request was dropped because the runtime was reset or destroyed while it waited. | Issue it again if it still applies. |
| `INVALID_RESPONSE` | A worker replied with a message outside the protocol. | Host and worker scripts must come from the same version. |
| `INVALID_LOAN` | A loaned buffer was returned twice, or is not the buffer that was lent. | Return each loaned snapshot exactly once. |
| `WORKER_ERROR` | The worker script threw outside a request. | See the message; create a new worker to continue. |
| `WORKER_MESSAGE_ERROR` | A message to or from the worker could not be deserialized. | Send only structured-cloneable values. |
| `WORKER_SEND_ERROR` | A message could not be posted to the worker. | Check that transferred buffers are not already detached. |
| `WORKER_TIMEOUT` | The worker did not answer within the time limit. | The worker was recycled; reduce the work per request or raise the limit. |
| `WORKER_RECYCLE_ERROR` | A worker could not be replaced after a failure. | Create a new client. |
| `RUNTIME_ERROR` | A runtime inside a worker failed with an error that is not an EngineError. | See the message; it is the original error text. |

### Bugs

| Code | What it means | What to do |
| --- | --- | --- |
| `INTERNAL` | The engine reached a state it believes impossible. | This is a bug: report it with the message and, if you can, a checkpoint or replay log. |
<!-- /generated:codes -->

## Accepted ranges of the rigid world

The rigid world holds single-precision numbers. A value outside these ranges is refused with `INVALID_PAYLOAD` by the
world, and by `validateScene` with the path of the field, because products of larger values overflow inside a step and
turn every body they touch into NaN. Each range is far wider than physical use in a world 100 km across. The table is
`RIGID_LIMITS` (exported from the kit).

<!-- generated:ranges by scripts/errors-doc.mjs: edit src/engine/contracts.ts, then run node scripts/errors-doc.mjs -->
| Quantity | Accepted | Unit |
| --- | --- | --- |
| Positions, static geometry (mesh vertices, height fields), joint lengths | within 100000 of the origin | m |
| Half extents, radii and hull points of convex shapes; a frame's distance from its body | at most 1000 (at least 0.0001; capsule half length at least 0.0025) | m |
| Linear and angular velocity | at most 1000000 | m/s, rad/s |
| Gravity; a body's gravity scale | at most 1000000 | m/s^2 |
| Forces, torques, impulses, motor forces, explosion strength | at most 1000000000000 | N, N m, N s |
| Density | 0, or 0.001 to 1000000 | kg/m^3 |
| Explicit mass | 1e-12 to 10000000000000000 | kg |
| Explicit inertia (each moment, for a mass m) | m x 1e-10 to m x 10000000000 (a radius of gyration of 1e-5 to 100000 m) | kg m^2 |
| Joint spring and stiffness frequency, damping ratios, damping coefficients | at most 1000000 | Hz, 1/s |
| Joint limits and spring targets | within 1e6 | rad or m |
| Friction, restitution | 0 to 1e6 | - |
<!-- /generated:ranges -->

Where the limits come from:

- 100 km is Box3D's own sanity limit (`B3_HUGE` in `box3d/constants.h`).
- Convex shapes stop at 1 km because Box3D's step does not return for a cube of about 5 km half extent resting in
  another box (native defect ND-1, docs/ROBUSTNESS.md).
- The others were set by the misuse fuzzer: the largest values at which the world stayed finite for every call it
  tried, rounded down to a power of ten.

The TypeScript solvers hold double precision and state their own ranges in their messages.

## diagnose(): unstable set-ups, by rule

`world.diagnose()` (the kit's `PhysicsWorld`) and `simulation.diagnose()` return a list of findings:

```ts
interface DiagnosticFinding {
  severity: 'error' | 'warning' | 'note';
  rule: string;       // the names below
  subject: string;    // 'body row 12', 'joint 3', a subsystem id
  message: string;    // the rule in words, with the numbers and what to change
  numbers: {[name: string]: number};
}
```

`error`: the state is already wrong. `warning`: outside what the method resolves; expect misbehaviour. `note`: inside
the limits but close, or costly. An empty list means none of these rules is broken; it is not a proof of stability.

| Rule | From | Fires when | Where the number comes from |
| --- | --- | --- | --- |
| `non-finite` | world | a step left a transform that is not finite (also `stats().nonFiniteSince`; a world created with `strict: true` throws `NUMERICAL_FAILURE` at that step) | checked after every step |
| `far-from-origin` | world | a body is more than 16 km from the origin | Box3D `constants.h`: "positions greater than about 16km have precision problems" |
| `tiny-shape` | world | a box, sphere or capsule is thinner than 1 cm | Box3D rests contacts up to 5 mm apart (`B3_LINEAR_SLOP`) |
| `mass-ratio` | world | two dynamic bodies on one joint differ in mass by more than 10 to 1 | the usual rule of thumb for iterative solvers; not measured here |
| `joint-frequency` | world | a joint spring or stiffness is above one eighth of the sub-step rate | the ratio at which Box3D caps its own contact softness (`physics_world.c`: `0.125 * inv_h`) |
| `joint-lever` | world | a joint frame is more than 50 radii of gyration from its body's centre of mass | found by the fuzzers: none of 240 random programs within 40 diverged, about one in 60 did with frames up to 300 away |
| `fast-small-body` | world | a body without `bullet` moves more than its smallest half extent per step | geometry: it can pass through other moving bodies between steps |
| `cfl` | fluid, free surface, shallow water | the step is above 80 % of the CFL or explicit viscous limit, or the shallow water needs more than half of its `maxSubsteps` | the solver's own `maxTimeStep()` / `stableTimeStep()` at the current state |
| `critical-time-step` | grains, explicit solid | the step is above 80 % of the limit (0.4 of the Rayleigh time or 0.2 of the contact duration for grains; 2 / omega_max for the solid) | docs/GRANULAR.md, docs/SOLID.md |
| `explicit-heat-limit` | heat (explicit scheme) | the step is above 80 % of the explicit stability limit | docs/HEAT.md |
| `substeps` | simulation | a solver takes 16 or more of its own steps per world step | cost, not stability |

The world's joint rules cover joints made through `createJoint()` since the last reset. `simulation.diagnose()`
includes the world's findings when the world has `diagnose()` (the kit's has; the Lab's host has not).

```js
for (const finding of simulation.diagnose()) console.warn(`${finding.severity} ${finding.rule} (${finding.subject}): ${finding.message}`);
```
