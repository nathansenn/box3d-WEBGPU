// One measurement of the time to the first step, for v24-first-step.test.mjs: run in a fresh process, it imports the main
// entry, instantiates the WebAssembly, builds a small jointed assembly and steps once, timing each part.
// Everything before t0 (Node itself, this file, node:fs) is outside the measurement.
//   node test/first-step-child.mjs [kitDir]        kitDir holds dist/ and wasm/; default: this package
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const kit = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const now = () => performance.now();
const parts = {};
const t0 = now();
let last = t0;
const lap = name => { const t = now(); parts[name] = t - last; last = t; };

const K = await import(pathToFileURL(join(kit, 'dist/index.js')).href);
lap('importMs');
const pool = await K.loadBox3D({wasmBinary: readFileSync(join(kit, 'wasm/box3d.wasm'))});
lap('instantiateMs');
// Eight bodies of three shapes each in a chain: a fixed base, then links held by limited and motorised hinges and welds.
const world = new K.PhysicsWorld(pool, {step: 1 / 60, subSteps: 4, interpolate: false});
world.reset({ground: false, gravity: [0, -9.80665, 0]});
const bodies = [];
for (let i = 0; i < 8; i++) {
  const material = {density: 7800, friction: 0.5, restitution: 0};
  const body = world.createBody({
    type: i === 0 ? 'static' : 'dynamic', position: [i * 0.4, 1, 0], rotation: [0, 0, 0, 1], linearDamping: 0, angularDamping: 0, gravityScale: 1,
    neverSleeps: true, sensor: false, hitEvents: false, density: 1000, friction: 0.5, restitution: 0,
    shape: {kind: 'compound', shapes: [
      {shape: {kind: 'box', halfExtents: [0.2, 0.05, 0.05]}, position: [0, 0, 0], rotation: [0, 0, 0, 1], ...material},
      {shape: {kind: 'sphere', radius: 0.06}, position: [0.2, 0, 0], ...material},
      {shape: {kind: 'capsule', radius: 0.03, halfLength: 0.1}, position: [-0.2, 0, 0], rotation: [0, 0, 0, 1], ...material},
    ]},
  });
  if (!body) throw new Error(`body ${i} was refused`);
  bodies.push(body);
}
for (let i = 1; i < bodies.length; i++) {
  const rotation = K.axisRotation([0, 0, 1]);
  world.createJoint({
    type: i % 3 === 0 ? 'weld' : 'revolute', bodyA: bodies[i - 1], bodyB: bodies[i], collideConnected: false,
    frameA: {position: [0.2, 0, 0], rotation}, frameB: {position: [-0.2, 0, 0], rotation},
    limits: i % 2 ? {lower: -1, upper: 1} : undefined, motor: i === 1 ? {speed: 1, maxForce: 10} : undefined,
  });
}
lap('buildMs');
world.step();
lap('firstStepMs');
const totalMs = now() - t0;
const y = world.getState(bodies[7]).position[1];
if (!(y < 1) || !Number.isFinite(y)) throw new Error(`the chain did not move as expected: y = ${y}`);
process.stdout.write(`${JSON.stringify({totalMs, parts})}\n`);
