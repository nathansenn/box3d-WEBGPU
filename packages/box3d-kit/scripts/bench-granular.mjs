// Measures the cost of the granular solver on one thread: grain-steps per second for a settled bed of
// 10 mm beads in a box, for both contact laws, and how many beads that is in real time (the count N for
// which advancing the simulation by one second takes one second: throughput x time step).
// Build the kit first (npm run build), then:   node scripts/bench-granular.mjs [beads ...]
import {Granular, granularLattice} from '../dist/granular.js';

const R = 0.005, D = 2 * R, G = 9.81, MASS = 2500 * Math.PI / 6 * D ** 3, PITCH = 2.2 * R;
const LAWS = {
  // The stiffness of the silo cases of the validation: k_n = 4000 m g / d.
  linear: {material: {density: 2500, restitution: 0.3, friction: 0.5, rollingFriction: 0.02}, config: {law: 'linear', normalStiffness: 4000 * MASS * G / D}, fraction: 0.12},
  hertz: {material: {density: 2500, youngModulus: 5e6, poissonRatio: 0.3, restitution: 0.3, friction: 0.5, rollingFriction: 0.02}, config: {}, fraction: 0.12},
};

function bench(law, beads) {
  const {material, config, fraction} = LAWS[law], layers = 10, side = Math.max(2, Math.round(Math.sqrt(beads / layers)));
  const lattice = granularLattice({min: [0, 0, 0], max: [side * PITCH, layers * PITCH, side * PITCH], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed: 1});
  const probe = new Granular({material, config: {...config, dt: 1e-12, capacity: 1}}), dt = fraction * probe.criticalTimeFor(0.9 * R);
  const g = new Granular({material, config: {...config, dt, capacity: lattice.count}});
  g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}});
  for (const [normal, position] of [[[1, 0, 0], [0, 0, 0]], [[-1, 0, 0], [side * PITCH, 0, 0]], [[0, 0, 1], [0, 0, 0]], [[0, 0, -1], [0, 0, side * PITCH]]]) g.addWall({shape: {kind: 'plane', normal}, position});
  g.addGrains(lattice.positions, lattice.radii);
  // Pour and settle (not timed apart: the poured phase is reported too), then time the bed at rest.
  const pour = Math.round(0.3 / dt), rest = Math.max(200, Math.round(4e6 / lattice.count));
  let t = performance.now(); g.step(pour); const pouring = lattice.count * pour / (performance.now() - t) * 1e3;
  const rebuilds = g.stats.rebuilds;
  t = performance.now(); g.step(rest); const resting = lattice.count * rest / (performance.now() - t) * 1e3;
  return {law, beads: lattice.count, dt: +dt.toExponential(3), contactsPerBead: +(g.stats.contacts / lattice.count).toFixed(2), pouringGrainStepsPerSecond: Math.round(pouring), restingGrainStepsPerSecond: Math.round(resting),
    realTimeBeads: Math.round(Math.min(pouring, resting) * dt), rebuildsWhilePouring: rebuilds, overlap: +g.stats.maxOverlap.toFixed(3)};
}
const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const results = [];
for (const beads of sizes.length ? sizes : [1000, 8000, 64000]) for (const law of ['linear', 'hertz']) results.push(bench(law, beads));
console.log(JSON.stringify({node: process.version, results}, null, 1));
