// Measures what BigInt handles cost in hot loops (roadmap item #47): the
// per-call price of resolving a handle to its row versus reading by row.
//   node scripts/bench-handles.mjs
import {createWorld, readBodyPoses} from '../dist/index.js';

const world = await createWorld({capacity: 16384});
const bodies = [];
for (let i = 0; i < 10000; i++) bodies.push(world.spawnBox({position: [(i % 100) * 1.1 - 55, 0.5 + Math.floor(i / 100) * 1.1, 0], halfSize: 0.45}));
const pose = {position: [0, 0, 0], rotation: [0, 0, 0, 1], halfExtents: [0, 0, 0]};
const out = {positions: new Float32Array(bodies.length * 3), rotations: new Float32Array(bodies.length * 4)};
const time = (label, fn, rounds = 30) => {
  for (let i = 0; i < 5; i++) fn();
  const t = performance.now();
  for (let i = 0; i < rounds; i++) fn();
  const ms = (performance.now() - t) / rounds;
  return {label, msPer10k: +ms.toFixed(3), nsPerBody: Math.round(ms * 1e6 / bodies.length)};
};
const results = [
  time('bodyIndex(handle) only', () => { let s = 0; for (const b of bodies) s += world.native.bodyIndex(b); return s; }),
  time('getPose(handle, out)', () => { for (const b of bodies) world.getPose(b, pose); }),
  time('readBodyPoses(bodies) batch', () => readBodyPoses(world, bodies, out)),
  time('matrices() row read (no handles)', () => { const m = world.matrices(); let s = 0; for (let r = 1; r <= bodies.length; r++) s += m[r * 16 + 13]; return s; }),
];
console.log(JSON.stringify({node: process.version, bodies: bodies.length, results}, null, 1));
world.dispose();
