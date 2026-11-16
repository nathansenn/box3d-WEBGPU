# Events and queries

## Contact and sensor events

```js
const off = world.onEvent(event => {
  // event.kind: 'contact-begin' | 'contact-end' | 'hit' | 'sensor-begin' | 'sensor-end'
  // event.bodyA, event.bodyB: handles (null for a body that no longer exists)
  if (event.kind === 'hit') console.log(event.point, event.normal, event.approachSpeed);
});
off();   // stop listening
```

- Events are delivered after the step that produced them.
- `'hit'` events come only for bodies created with `hitEvents: true`.
- A body created with `sensor: true` reports `'sensor-begin'` and `'sensor-end'` and collides with nothing.
- Destroying a body does not produce a `'contact-end'` for what it touched.
- One step delivers at most 65,536 events; `world.droppedEvents` counts the rest.

`world.onStep(tick => {})` runs after every fixed step, the place for game logic that must run at the physics rate.

## Queries

```js
const hit = world.raycast([0, 10, 0], [0, -20, 0]);        // origin and a full displacement, not a direction
if (hit) console.log(hit.body, hit.point, hit.normal, hit.fraction);
world.sphereCast([0, 10, 0], 0.3, [0, -20, 0]);
world.boxCast([0, 10, 0], [0.3, 0.3, 0.3], [0, -20, 0]);
world.overlapSphere([0, 1, 0], 2);                          // bodies, each once
world.overlapBox([0, 1, 0], [2, 1, 2], {limit: 64, filter: {bodies: 'dynamic', ignoreBody: player}});
```

Queries do not change the world and may be made at any time between steps. `world.setUserData(body, value)` attaches
your own object to a body, and `world.getUserData(hit.body)` gets it back from a hit.

For trigger volumes and a character controller see `box3d-webgpu-kit/gameplay` in the
[API reference](../../api/gameplay.html).
