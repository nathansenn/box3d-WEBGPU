// Read-only profiling driver for the exported glass model (scratch copy).
// Usage: node --experimental-strip-types glass-profile.mts <scratchRoot> <maxSimSeconds> <wallBudgetSeconds> [material]
import {performance} from 'node:perf_hooks';
const [root, maxSimArg, wallArg, materialArg] = process.argv.slice(2);
const models = await import(`${root}/src/studio/material-labs/models.ts`);
const contact = await import(`${root}/src/engine/convex-contact.ts`);
const W = contact.ConvexContactWorld.prototype as any;
const counters: Record<string, {calls: number; ms: number}> = {};
function wrap(name: string) {
  const orig = W[name];
  counters[name] = {calls: 0, ms: 0};
  W[name] = function (...args: any[]) {
    const c = counters[name]; c.calls++;
    const t0 = performance.now();
    try { return orig.apply(this, args); } finally { c.ms += performance.now() - t0; }
  };
}
for (const n of ['candidates', 'queryPair', 'projectContactPositions', 'externalPenetration', 'separatedByHint', 'stepInterval']) wrap(n);
// Count total retries: stepInterval calls beyond the one per world.step
const settings = materialArg ? {material: materialArg} : {};
const model = new models.GlassModel(settings);
const DT = models.DT;
const maxSim = Number(maxSimArg ?? 3), wall = Number(wallArg ?? 120);
const t0 = performance.now();
let step = 0; let window: number[] = []; let lastReport = 0;
const snapshot = () => Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, {...v}]));
let prev = snapshot();
console.log(`pieces=${model.pieces.length} bodies=${model.collisionWorld.bodies.length}`);
while (model.frame.time < maxSim && (performance.now() - t0) / 1000 < wall) {
  const s0 = performance.now();
  model.step(DT);
  const ms = performance.now() - s0; window.push(ms); step++;
  if (model.frame.time - lastReport >= 0.25 - 1e-9 || (performance.now() - t0) / 1000 >= wall) {
    lastReport = model.frame.time;
    const broken = model.frame.damage.reduce((a: number, b: number) => a + b, 0);
    const dyn = model.shardBodies.filter((b: any) => b.dynamic).length;
    const st = model.collisionWorld.stats;
    const now = snapshot();
    const delta = Object.fromEntries(Object.keys(now).map(k => [k, `${now[k].calls - prev[k].calls}c/${(now[k].ms - prev[k].ms).toFixed(0)}ms`]));
    prev = now;
    const mean = window.reduce((a, b) => a + b, 0) / window.length, max = Math.max(...window);
    console.log(JSON.stringify({t: +model.frame.time.toFixed(3), steps: window.length, meanStepMs: +mean.toFixed(1), maxStepMs: +max.toFixed(1), broken, dynamic: dyn, lastStats: st, phase: model.frame.phase, wrapped: delta}));
    window = [];
  }
}
console.log('done', {simTime: model.frame.time, steps: step, wallS: ((performance.now() - t0) / 1000).toFixed(1)});
console.log('totals', JSON.stringify(counters));
