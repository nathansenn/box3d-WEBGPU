// Measures the cost of the fluid solvers on one thread: cell-steps per second for a 3D lid-driven box of N^3 cells and a
// 2D one of N^2 (explicit viscosity, central advection, the steady regime after start-up), the same 3D box with a sphere
// in it, and particle-steps per second for the free-surface dam break. "Real-time cells" is the count of cells whose step
// takes 1/60 s (throughput / 60): a grid that size keeps up with a 60 Hz loop at one fluid step per frame.
// Build the kit first (npm run build), then:   node scripts/bench-fluid.mjs [n ...]
import {Fluid, FreeSurfaceFluid} from '../dist/fluid.js';

function box(n, {flat = false, sphere = false} = {}) {
  const h = 1 / n, nu = 0.01, dt = Math.min(0.4 * h, 0.9 * h * h / (2 * (flat ? 2 : 3) * nu));
  const f = new Fluid({cells: [n, n, flat ? 1 : n], spacing: h, density: 1, viscosity: nu, dt, gravity: [0, 0, 0],
    boundaries: {yMax: {type: 'no-slip', velocity: [1, 0, 0]}, ...(flat ? {zMin: 'periodic', zMax: 'periodic'} : {})}});
  if (sphere) f.addObstacle({shape: {kind: 'sphere', radius: 0.15}, position: [0.5, 0.4, flat ? h / 2 : 0.5]});
  f.step(20);
  const steps = Math.max(5, Math.round(4e6 / f.cells / 40)), t = performance.now();
  f.step(steps);
  const seconds = (performance.now() - t) / 1000, rate = f.cells * steps / seconds;
  return {case: `${flat ? '2D' : '3D'} lid-driven box${sphere ? ' with a sphere' : ''}`, cells: f.cells, msPerStep: +(1000 * seconds / steps).toFixed(2), cellStepsPerSecond: Math.round(rate), realTimeCells: Math.round(rate / 60), pressureIterations: f.stats.pressureIterations};
}
function dam(perA) {
  const a = 0.028575, h = a / perA, f = new FreeSurfaceFluid({cells: [8 * perA, Math.round(2.5 * perA), 1], spacing: h, density: 1000, dt: 5e-4 * 16 / perA});
  f.addLiquid((x, y) => x < a && y < 2 * a);
  f.step(10);
  const steps = 100, t = performance.now();
  f.step(steps);
  const seconds = (performance.now() - t) / 1000;
  return {case: '2D dam break (free surface)', cells: f.nx * f.ny, particles: f.count, msPerStep: +(1000 * seconds / steps).toFixed(2), particleStepsPerSecond: Math.round(f.count * steps / seconds)};
}
const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const results = [];
for (const n of sizes.length ? sizes : [16, 32, 48]) { results.push(box(n)); results.push(box(n, {sphere: true})); }
for (const n of [64, 128]) results.push(box(n, {flat: true}));
for (const perA of [16, 32]) results.push(dam(perA));
console.log(JSON.stringify({node: process.version, results}, null, 1));
