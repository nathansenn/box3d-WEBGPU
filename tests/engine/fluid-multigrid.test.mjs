// The multigrid preconditioner of the volumetric solver's pressure solve (src/engine/fluid-multigrid.ts,
// pressureSolver: 'multigrid'):
//  - the V-cycle is a symmetric, positive operator (what conjugate gradients needs): <M a, b> = <a, M b> to rounding
//    and <M a, a> > 0, for walls, an outflow side and periodic sides, odd and even grids;
//  - its iteration count stays nearly flat as the grid grows (MIC(0)'s grows), on a lid-driven box;
//  - the flow it gives agrees with MIC(0)'s to the pressure tolerance (not to the bit), with walls, a sphere, an inflow
//    and an outflow, and periodic 2D; a run repeats bit for bit and resumes exactly from a checkpoint;
//  - the default stays MIC(0) and setFluidPressureSolverDefault switches new fluids.
// Every case of the fluid validation domain passes with multigrid: scripts/validate-fluid-multigrid.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s, c, next) { if (s.startsWith('.') && !/\.[a-z]+$/i.test(s) && c.parentURL?.endsWith('.ts')) { const u = new URL(s + '.ts', c.parentURL); if (existsSync(u)) return next(u.href, c); } return next(s, c); }});
const {Fluid, setFluidPressureSolverDefault} = await import('../../src/engine/fluid.ts');
const {PoissonMultigrid} = await import('../../src/engine/fluid-multigrid.ts');

let seed = 7;
const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296 - 0.5;
const boxes = {
  walls: {cells: [9, 8, 7], boundaries: {}},
  outflow: {cells: [12, 6, 5], boundaries: {xMin: {type: 'inflow', velocity: [0.1, 0, 0]}, xMax: 'outflow'}},
  periodic: {cells: [8, 5, 6], boundaries: {xMin: 'periodic', xMax: 'periodic', zMin: 'periodic', zMax: 'periodic'}},
  flat: {cells: [16, 12, 1], boundaries: {zMin: 'periodic', zMax: 'periodic'}},
};
const fluid = (box, extra = {}) => new Fluid({cells: box.cells, spacing: 0.01, density: 1000, viscosity: 1e-3, dt: 1e-3, gravity: [0, 0, 0], boundaries: box.boundaries, ...extra});

test('the V-cycle is symmetric and positive on walls, an outflow, periodic sides and a 2D slab', () => {
  for (const [name, box] of Object.entries(boxes)) {
    const f = fluid(box, {pressureSolver: 'multigrid'}), mg = f['multigrid'], N = f.cells;
    assert.ok(mg instanceof PoissonMultigrid, name);
    assert.ok(mg.levels.length >= 2, `${name}: ${mg.levels.length} levels`);
    const a = Float64Array.from({length: N}, random), b = Float64Array.from({length: N}, random);
    if (mg.singular) for (const v of [a, b]) { const mean = v.reduce((s, x) => s + x, 0) / N; for (let i = 0; i < N; i++) v[i] -= mean; }
    const Ma = new Float64Array(N), Mb = new Float64Array(N);
    mg.apply(a, Ma); mg.apply(b, Mb);
    const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
    const scale = Math.sqrt(dot(Ma, Ma) * dot(b, b));
    assert.ok(Math.abs(dot(Ma, b) - dot(a, Mb)) < 1e-12 * scale, `${name}: <Ma, b> = <a, Mb>`);
    assert.ok(dot(Ma, a) > 0, `${name}: <Ma, a> > 0`);
  }
});

test('iterations stay nearly flat with the grid; MIC(0) grows', () => {
  const counts = {};
  for (const n of [8, 16, 32]) for (const solver of ['mic', 'multigrid']) {
    const h = 1 / n, f = new Fluid({cells: [n, n, n], spacing: h, density: 1, viscosity: 0.01, dt: Math.min(0.4 * h, 0.9 * h * h / 0.06), gravity: [0, 0, 0], pressureSolver: solver, boundaries: {yMax: {type: 'no-slip', velocity: [1, 0, 0]}}});
    f.step(4);
    (counts[solver] ??= []).push(f.stats.pressureIterations);
    assert.equal(f.stats.unconverged, 0);
  }
  console.log(`  pressure iterations at 8^3, 16^3, 32^3: MIC(0) ${counts.mic.join(', ')}; multigrid ${counts.multigrid.join(', ')}`);
  assert.ok(counts.multigrid.every(c => c <= 10), 'multigrid: at most 10 iterations');
  assert.ok(counts.multigrid[2] - counts.multigrid[0] <= 3, 'multigrid: nearly flat');
  assert.ok(counts.mic[2] > 1.5 * counts.mic[0], 'MIC(0) grows with the grid');
  assert.ok(counts.multigrid[2] < counts.mic[2] / 3, 'at 32^3 multigrid needs under a third of the iterations');
});

test('the flow agrees with MIC(0) to the pressure tolerance; runs repeat and resume from a checkpoint exactly', () => {
  const cases = [
    ['cavity with a sphere', {cells: [16, 16, 16], boundaries: {yMax: {type: 'no-slip', velocity: [0.05, 0, 0]}}}, f => f.addObstacle({shape: {kind: 'sphere', radius: 0.03}, position: [0.08, 0.07, 0.08]})],
    ['inflow and outflow past a box', {cells: [24, 10, 10], boundaries: {xMin: {type: 'inflow', velocity: [0.02, 0, 0]}, xMax: 'outflow'}}, f => f.addObstacle({shape: {kind: 'box', halfExtents: [0.01, 0.02, 0.02]}, position: [0.08, 0.05, 0.05]})],
    ['periodic slab', boxes.flat, f => f.setVelocity((x, y) => [Math.sin(2 * Math.PI * y / 0.12) * 0.01, Math.sin(2 * Math.PI * x / 0.16) * 0.01, 0])],
  ];
  for (const [name, box, setup] of cases) {
    const run = (solver, steps = 20) => { const f = fluid(box, {pressureSolver: solver}); setup(f); f.step(steps); return f; };
    const mic = run('mic'), mg = run('multigrid');
    let du = 0, umax = 0;
    for (let c = 0; c < 3; c++) for (let i = 0; i < mic.vel[c].length; i++) { du = Math.max(du, Math.abs(mic.vel[c][i] - mg.vel[c][i])); umax = Math.max(umax, Math.abs(mic.vel[c][i])); }
    assert.ok(umax > 0 && du <= 1e-8 * umax, `${name}: max |u_mg - u_mic| = ${du.toExponential(2)} of max |u| ${umax.toExponential(2)}`);
    assert.ok(mg.stats.divergence <= 1.5e-10, `${name}: divergence ${mg.stats.divergence}`);
    assert.equal(mg.stats.unconverged, 0, name);
    // Bit-for-bit repeat, and a resume from a save.
    const again = run('multigrid');
    assert.deepEqual([...again.u, ...again.v, ...again.w, ...again.p], [...mg.u, ...mg.v, ...mg.w, ...mg.p], `${name}: repeat`);
    const a = fluid(box, {pressureSolver: 'multigrid'}); setup(a); a.step(10);
    const b = fluid(box, {pressureSolver: 'multigrid'}); setup(b); b.restoreState(a.saveState());
    a.step(10); b.step(10);
    assert.deepEqual([...b.u, ...b.v, ...b.w, ...b.p], [...a.u, ...a.v, ...a.w, ...a.p], `${name}: resume`);
  }
});

test('MIC(0) stays the default; setFluidPressureSolverDefault switches the fluids built after it', () => {
  assert.equal(fluid(boxes.walls).pressureSolver, 'mic');
  const before = setFluidPressureSolverDefault('multigrid');
  try { assert.equal(before, 'mic'); assert.equal(fluid(boxes.walls).pressureSolver, 'multigrid'); assert.equal(fluid(boxes.walls, {pressureSolver: 'mic'}).pressureSolver, 'mic'); }
  finally { setFluidPressureSolverDefault(before); }
  assert.equal(fluid(boxes.walls).pressureSolver, 'mic');
  assert.throws(() => fluid(boxes.walls, {pressureSolver: 'jacobi'}), /pressureSolver/);
  // A checkpoint does not carry the preconditioner: a MIC(0) save restores into a multigrid fluid of the same grid.
  const a = fluid(boxes.walls); a.setVelocity(() => [0.01, 0, 0]); a.step(3);
  const b = fluid(boxes.walls, {pressureSolver: 'multigrid'}); b.restoreState(a.saveState());
  assert.deepEqual([...b.u], [...a.u]);
});
