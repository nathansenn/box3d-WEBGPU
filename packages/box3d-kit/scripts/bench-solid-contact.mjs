// Measures the cost of contact between deformable solids (SolidSolidContact) on large surface meshes: two slabs, one
// on the other, with surface meshes that do not match, and the time of the contact search alone (both search directions
// and the edge pairs) and of one whole implicit step (search plus the Newton solve). One thread.
// Build the kit first (npm run build), then:   node scripts/bench-solid-contact.mjs [cells ...] [--method node-face] [--repeat n]
// `cells` is the number of cells along each side of the lower slab (the upper has cells + 1); the default runs 25, 35, 55, 77,
// which give about 6k, 11k, 26k and 50k surface triangles in all.
import {SolidBody, boxMesh} from '../dist/solid.js';
import {SolidSolidContact} from '../dist/solid-contact.js';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const method = flag('--method'), repeat = Number(flag('--repeat') ?? 3), steps = Number(flag('--steps') ?? 1);
const sizes = args.map(Number).filter(n => n > 0);

function bench(n) {
  const material = {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config = {model: 'linear', dt: 1 / 240, gravity: [0, -9.81, 0], tolerance: 1e-8};
  const lower = new SolidBody({mesh: boxMesh({size: [1, 0.05, 1], cells: [n, 2, n]}), material, config});
  const upper = new SolidBody({mesh: boxMesh({size: [1, 0.05, 1], cells: [n + 1, 2, n + 1], origin: [0, 0.05, 0]}), material, config});
  lower.constrain(lower.selectNodes((x, y) => Math.abs(y) < 1e-9), [0, 0, 0]);
  const contact = new SolidSolidContact([lower, upper], method ? {method} : {}), triangles = lower.faces.length / 3 + upper.faces.length / 3;
  // The search alone, at the start of a step (the private method the step calls; nothing else runs).
  const zero = new Float64Array(3 * (lower.nodeCount + upper.nodeCount)), closing = [0, 0];
  let search = Infinity;
  for (let r = 0; r < repeat; r++) { const t = performance.now(); contact['detect'](zero, closing); search = Math.min(search, performance.now() - t); }
  const rows = contact['count'];
  let step = Infinity;
  for (let r = 0; r < Math.max(1, Math.min(repeat, 2)); r++) {
    lower.reset(); upper.reset();
    const t = performance.now(); contact.step(steps); step = Math.min(step, (performance.now() - t) / steps);
  }
  return {cells: n, triangles, nodes: lower.nodeCount + upper.nodeCount, tets: lower.tetCount + upper.tetCount, rows, searchMs: +search.toFixed(1), stepMs: +step.toFixed(0),
    newton: contact.stats.newtonIterations, linear: contact.stats.linearIterations, contacts: contact.stats.contacts, converged: contact.stats.converged};
}

for (const n of sizes.length ? sizes : [25, 35, 55, 77]) console.log(JSON.stringify(bench(n)));
