// Headless server-style loop: fixed 60 Hz simulation, no renderer.
// From packages/box3d-kit: npm run build && node examples/node-headless.mjs
import {createWorld} from '../dist/index.js';

const world = await createWorld({seed: 2026});
world.startRecording(); // capture the session so it can be replayed exactly, e.g. from a bug report
for (let i = 0; i < 40; i++) world.spawnBox({position: [(i % 8) - 3.5, 0.5 + Math.floor(i / 8), 0], halfSize: 0.45});
const cannonball = world.spawnBox({position: [-20, 1.5, 0], impulse: [300, 20, 0], halfSize: 0.6});
world.setUserData(cannonball, {name: 'cannonball'});

for (let tick = 1; tick <= 300; tick++) {
  world.step();
  if (tick % 60 === 0) {
    const s = world.stats(), pose = world.getPose(cannonball);
    console.log(`t=${tick / 60}s bodies=${s.bodies} awake=${s.awake} step=${s.lastStepMs.toFixed(3)}ms cannonball.x=${pose.position[0].toFixed(2)}`);
  }
}

const log = world.stopRecording();
const check = await createWorld();
console.log(`replay of ${log.commands.length} commands over ${log.ticks} ticks matches: ${check.replay(log)}`);
check.dispose();
world.dispose();
