// Measures the cost of the shallow-water solver on one thread: cell-substeps per second for a dam break over a
// paraboloid bowl (Thacker's set-up with a higher start, so that the flow is fast and the bowl wets and dries), and
// how many cells that is in real time at 60 steps per second (the count N for which advancing one second takes one
// second, with the substeps the CFL limit asks for).
// Build the kit first (npm run build), then:   node scripts/bench-shallow-water.mjs [cells-per-side ...]
import {ShallowWater, thackerBed, thackerDepth} from '../dist/shallow-water.js';

function bench(side, order) {
  const P = {h0: 0.1, a: 1, r0: 0.8, centre: [2, 2]};
  const w = new ShallowWater({cells: [side, side], spacing: 4 / side, order, manning: 0.01, dt: 1 / 60, bed: (x, z) => thackerBed(x, z, P), depth: (x, z) => thackerDepth(x, z, 0, P)});
  for (let i = 0; i < 10; i++) w.step();
  const steps = Math.max(20, Math.round(4e6 / (side * side * 4))), before = w.stats.totalSubsteps;
  const t = performance.now(); w.step(steps); const seconds = (performance.now() - t) / 1000;
  const substeps = w.stats.totalSubsteps - before, rate = side * side * substeps / seconds;
  return {cells: side * side, order, substepsPerStep: +(substeps / steps).toFixed(2), cellSubstepsPerSecond: Math.round(rate), realTimeCells: Math.round(rate / (60 * substeps / steps)), msPerStep: +(seconds * 1000 / steps).toFixed(3)};
}
const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const results = [];
for (const side of sizes.length ? sizes : [64, 128, 256]) for (const order of [2, 1]) results.push(bench(side, order));
console.log(JSON.stringify({node: process.version, results}, null, 1));
