// Helper of v22-rigid-scale.test.mjs and scripts/rigid-scale-benchmark.mjs, run as a child process: one pile in one
// world on a stated number of threads. It prints `RESULT <json>` and exits by itself, because the workers of the
// pthread artifact can keep a Node process alive after the work is done (docs/THREADED_ENGINE.md, section 9).
//   node rigid-scale-child.mjs '{"count":1500,"kind":"mixed","seconds":4,"threads":4}'
import * as K from 'box3d-webgpu-kit';
import * as S from './rigid-core-scenarios.mjs';

const spec = JSON.parse(process.argv[2] ?? '{}');
const {count = 1500, kind = 'mixed', seconds = 4, threads = 1, threshold, time = false, marks = []} = spec;
const world = await K.createWorld({...S.SCALE_STEP, gravity: [0, -S.G, 0], ground: false, capacity: Math.max(4096, count + 64), threads, ...(threshold === undefined ? {} : {threadThreshold: threshold})});
const built = S.buildPile(world, {count, kind});
let most = 0;
const hashes = {};
const result = S.runPile(world, built, {seconds, clock: time ? () => performance.now() : null, each: i => {
  most = Math.max(most, world.threading.lastStepThreads());
  if (marks.includes(i + 1)) hashes[i + 1] = [world.exactHash(), world.replayHash()];
}});
const out = {...result, replayHash: world.replayHash(), hashes, threads: world.threading.threads, threshold: world.threading.threshold, mostThreads: most};
process.stdout.write(`RESULT ${JSON.stringify(out)}\n`, () => process.exit(0));
