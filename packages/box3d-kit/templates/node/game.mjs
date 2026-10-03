// Headless game loop: fixed 60 Hz physics, a projectile, and a replay check.
import {createWorld, BodyRing} from 'box3d-webgpu-kit';

const world = await createWorld({seed: 1});
for (let i = 0; i < 24; i++) world.spawnBox({position: [(i % 6) - 2.5, 0.5 + Math.floor(i / 6) * 1.05, 0], halfSize: 0.48});
const shots = new BodyRing(world, 10);
shots.spawn({position: [-12, 1.5, 0], impulse: [160, 10, 0], halfSize: 0.5});

for (let tick = 1; tick <= 240; tick++) {
  world.step();
  if (tick % 60 === 0) console.log(`t=${tick / 60}s awake=${world.awakeCount()} bodies=${world.bodyCount()}`);
}
console.log(`final state hash ${world.exactHash()}`);
world.dispose();
