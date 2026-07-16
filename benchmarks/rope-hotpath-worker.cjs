'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const buildRoot = path.resolve(process.argv[2]);
const assetRoot = path.resolve(process.argv[3]);
const sceneId = Number.parseInt(process.argv[4] || '699', 10);
const backend = process.argv[5] || 'simd';
const warmupIterations = Math.max(1, Number.parseInt(process.env.ROPE_WARMUPS || '7', 10));
const timedIterations = Math.max(1, Number.parseInt(process.env.ROPE_ITERATIONS || '80', 10));
const projectileCount = Math.max(0, Number.parseInt(process.env.ROPE_PROJECTILES || '96', 10));
const actionSchedule = process.env.ROPE_ACTION_SCHEDULE === '1';

const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
const { SoftSimulationSuite } = require(path.join(buildRoot, 'src/soft/simulations.js'));

let suite;
if (backend === 'js') {
  suite = new SoftSimulationSuite();
} else {
  const { SoftKernelModule } = require(path.join(buildRoot, 'src/soft/kernels.js'));
  const wasm = fs.readFileSync(path.join(assetRoot, `public/soft-kernels-${backend}.wasm`));
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
  suite = new SoftSimulationSuite(new SoftKernelModule(backend, instance.exports));
}

if (!suite.createScene(SCENES[sceneId], 5, 0x191900 + sceneId)) {
  throw new Error(`failed to create rope scene ${sceneId}`);
}
const spawned = suite.spawnRain(projectileCount, 14, 24);
if (spawned !== projectileCount) throw new Error(`expected ${projectileCount} projectiles, spawned ${spawned}`);

let frameIndex = 0;
function operation() {
  if (actionSchedule) {
    if (frameIndex === 60) suite.kick(18);
    else if (frameIndex === 120) suite.explode([0, 8, 0], 24, 12);
    else if (frameIndex === 180) suite.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
    else if (frameIndex === 240) suite.spawnRain(96, 14, 24);
  }
  suite.step(1 / 60, 4);
  suite.buildFrame(false);
  frameIndex++;
}

for (let i = 0; i < warmupIterations; i++) operation();
global.gc?.();
const started = performance.now();
for (let i = 0; i < timedIterations; i++) operation();
const elapsedMs = performance.now() - started;

const frame = suite.buildFrame(false);
const positions = suite.active.positions;
const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
let exactStateHash = 2166136261 >>> 0;
for (let i = 0; i < bytes.length; i++) {
  exactStateHash ^= bytes[i];
  exactStateHash = Math.imul(exactStateHash, 16777619) >>> 0;
}

process.stdout.write(JSON.stringify({
  sceneId,
  backend,
  warmupIterations,
  timedIterations,
  projectileCount,
  actionSchedule,
  elapsedMs,
  msPerFrame: elapsedMs / timedIterations,
  exactStateHash,
  replayHash: suite.hash(),
  nodeCount: frame.nodeCount,
  constraintCount: frame.constraintCount,
  brokenCount: frame.brokenCount,
  instanceCount: frame.instanceCount + (frame.ropeGrid?.segmentCount || 0),
  positions: Buffer.from(bytes).toString('base64'),
}));
