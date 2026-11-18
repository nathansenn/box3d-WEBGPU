// API misuse of the solver modules (docs/ROBUSTNESS.md): the constructors and builders a caller hands numbers to.
//
// Each row is one valid call. The harness (lib/misuse.mjs) replaces one leaf at a time with every hostile value of its
// kind and requires an EngineError of the taxonomy, or an object that is still healthy: it steps once and every number
// in its saved state is finite (an EngineError from that step, such as UNSTABLE_TIME_STEP, is a refusal too).
// KNOWN lists what still breaks that contract, by row and failure text; the test fails when a listed entry stops
// failing (remove it) or a new one appears (fix it or list it with the reason).
import assert from 'node:assert/strict';
import test from 'node:test';
import {ENGINE_ERRORS} from '../../src/engine/contracts.ts';
import {HeatSolver} from '../../src/engine/heat.ts';
import {ShallowWater} from '../../src/engine/shallow-water.ts';
import {Fluid, FreeSurfaceFluid} from '../../src/engine/fluid.ts';
import {Granular, granularLattice} from '../../src/engine/granular.ts';
import {Cloth, clothGrid} from '../../src/engine/cloth.ts';
import {SolidBody} from '../../src/engine/solid.ts';
import {boxMesh} from '../../src/engine/solid-mesh.ts';
import {convexHull, toHullShape, toMeshShape, meshVolume, weldVertices} from '../../src/engine/geometry.ts';
import {eulerToQuaternion} from '../../src/engine/scene-format.ts';
import {material, materialValue, solidMaterial} from '../../src/engine/materials.ts';
import {runRecipe} from './lib/misuse.mjs';

const tax = {
  problem(error) {
    if (!(error instanceof Error) || error.name !== 'EngineError') return `threw ${error?.constructor?.name ?? typeof error} ("${String(error?.message ?? error).slice(0, 110)}") instead of an EngineError`;
    if (!(error.code in ENGINE_ERRORS)) return `EngineError code ${error.code} is not in the taxonomy`;
    if (error.message.trim().length < 12) return `EngineError ${error.code} has no helpful message`;
    return null;
  },
};
const nothing = {digest: () => '', restore: () => {}, health: () => {}};
/** A built solver is healthy when it can step (or refuses to, by a typed error) and its saved state has no NaN. */
function healthy(solver) {
  if (solver === null || typeof solver !== 'object') return;
  try { solver.step?.(); } catch (error) { if (tax.problem(error)) throw error; return; }
  const walk = (value, path, depth) => {
    if (typeof value === 'number') { if (Number.isNaN(value)) throw new Error(`${path} is NaN after one step`); return; }
    if (ArrayBuffer.isView(value)) { if (value instanceof Float64Array || value instanceof Float32Array) for (let i = 0; i < value.length; i++) if (Number.isNaN(value[i])) throw new Error(`${path}[${i}] is NaN after one step`); return; }
    if (value !== null && typeof value === 'object' && depth < 8) for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`, depth + 1);
  };
  if (typeof solver.saveState === 'function') walk(solver.saveState(), 'state', 0);
  else walk(solver, 'result', 0);
}

const cube = boxMesh({size: [0.2, 0.2, 0.2], cells: [2, 2, 2]}), grid = clothGrid({nx: 3, ny: 3, u: [0.6, 0, 0], v: [0, 0, 0.6]});
const tetra = {vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]};
// The solvers hold float64, so a number beyond float32 is a legal value for them (the `wide` hint below).
const POSITIVE = /(spacing|dx|dy|dz|dt|density|specificHeat|conductivity|thickness|arealDensity|radius|size\.\d|nx|ny|nz|cells\.\d|capacity)$/;
const INTEGER = /(nx|ny|nz|cells\.\d|capacity|maxIterations|maxNewtonIterations|maxCgIterations|seed)$/;

const ROWS = {
  'new HeatSolver': {make: o => new HeatSolver(o), args: () => [{nx: 4, ny: 3, nz: 2, dx: 0.01, dy: 0.01, dz: 0.01, materials: [{conductivity: 50, density: 7800, specificHeat: 500}], temperature: 300, dt: 0.5, scheme: 'backward-euler',
    boundaries: [{face: 'x-', type: 'temperature', temperature: 350}, {face: 'x+', type: 'convection', coefficient: 20, ambient: 290}], heatGeneration: 0, tolerance: 1e-10, maxIterations: 200}]},
  'new ShallowWater': {make: o => new ShallowWater(o), args: () => [{cells: [8, 4], spacing: 0.5, origin: [0, 0], bed: [...Array(32)].map((_, i) => 0.01 * (i % 8)), level: 1, velocity: [0.1, 0], manning: 0.02, gravity: 9.81, density: 1000, dt: 0.01, cfl: 0.4, order: 2,
    boundaries: {xMin: 'wall', xMax: 'open'}}]},
  'new Fluid': {make: o => new Fluid(o), args: () => [{cells: [4, 4, 4], spacing: 0.05, origin: [0, 0, 0], density: 1000, viscosity: 1e-3, dt: 0.01, gravity: [0, -9.81, 0], bodyForce: [0, 0, 0], advection: 'upwind', diffusion: 'backward-euler',
    pressureTolerance: 1e-8, maxIterations: 200, cflLimit: 1}]},
  'new FreeSurfaceFluid': {make: o => new FreeSurfaceFluid(o), args: () => [{cells: [6, 6, 4], spacing: 0.05, origin: [0, 0, 0], density: 1000, viscosity: 1e-3, dt: 0.005, gravity: [0, -9.81, 0], walls: 'free-slip'}]},
  'new Granular': {make: o => { const g = new Granular(o); g.addGrain([0, 0.01, 0], 0.005); g.addGrain([0, 0.021, 0], 0.005, [0, -0.1, 0]); return g; }, args: () => [{material: {density: 2500, youngModulus: 1e7, poissonRatio: 0.25, restitution: 0.6, friction: 0.4, rollingFriction: 0.01}, config: {dt: 1e-5, capacity: 8, gravity: [0, -9.81, 0], law: 'hertz', skin: 0.001}}]},
  'Granular.addGrain': {make: (...args) => { const g = new Granular({material: {density: 2500, youngModulus: 1e7, poissonRatio: 0.25, restitution: 0.6, friction: 0.4}, config: {dt: 1e-5, capacity: 4, gravity: [0, -9.81, 0]}}); g.addGrain(...args); return g; }, args: () => [[0, 0.01, 0], 0.005, [0, -0.1, 0], [0, 0, 1]], positive: /^1$/},
  granularLattice: {make: o => granularLattice(o), args: () => [{min: [0, 0, 0], max: [0.05, 0.05, 0.05], radius: [0.004, 0.006], gap: 0, jitter: 0.5, seed: 3}], lenient: /seed$/},
  'new Cloth': {make: o => new Cloth(o), args: () => [{positions: Array.from(grid.positions), triangles: Array.from(grid.triangles), pinned: [0, 3], material: {arealDensity: 0.3, youngModulus: 1e5, thickness: 1e-3, poissonRatio: 0.3},
    config: {dt: 1 / 60, gravity: [0, -9.81, 0], integrator: 'backward-euler', drag: 0, maxNewtonIterations: 40, residualTolerance: 1e-8}}], integer: /(triangles\.\d+|pinned\.\d+|maxNewtonIterations)$/},
  clothGrid: {make: o => clothGrid(o), args: () => [{nx: 3, ny: 2, u: [1, 0, 0], v: [0, 0, 1], origin: [0, 1, 0], diagonal: 'alternate', jitter: 0.1, seed: 2}], lenient: /seed$/},
  'new SolidBody': {make: o => new SolidBody(o), args: () => [{mesh: {positions: Array.from(cube.positions), tets: Array.from(cube.tets)}, material: {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt: 1e-3, gravity: [0, -9.81, 0], massDamping: 1, tolerance: 1e-8}}], integer: /tets\.\d+$/},
  boxMesh: {make: o => boxMesh(o), args: () => [{size: [0.2, 0.1, 0.1], cells: [2, 1, 1], origin: [0, 0, 0]}]},
  convexHull: {make: (...a) => convexHull(...a), args: () => [[0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0.2, 0.2, 0.2], {maxVertices: 16}], integer: /maxVertices$/},
  // A hull is built from the vertices alone; the indices of a mesh handed in are not read.
  toHullShape: {make: (...a) => toHullShape(...a), args: () => [tetra, {maxPoints: 16}], integer: /maxPoints$/, lenient: /indices/},
  toMeshShape: {make: m => toMeshShape(m), args: () => [tetra], integer: /indices\.\d+$/},
  meshVolume: {make: m => meshVolume(m), args: () => [tetra], integer: /indices\.\d+$/},
  weldVertices: {make: (...a) => weldVertices(...a), args: () => [tetra, 1e-6], integer: /indices\.\d+$/},
  eulerToQuaternion: {make: e => eulerToQuaternion(e), args: () => [[10, 20, 30]]},
  material: {make: id => material(id), args: () => ['structural-steel-s355']},
  // A property the entry does not have answers null: that is the function's contract.
  materialValue: {make: (...a) => materialValue(...a), args: () => ['structural-steel-s355', 'youngModulus'], lenient: /^1$/},
  solidMaterial: {make: id => solidMaterial(id), args: () => ['structural-steel-s355']},
};

// What still breaks the contract, found by this file and not fixed here. Each entry: row -> patterns of failure lines.
// The solver files belong to other work in progress; these are input checks that are missing, reported in
// docs/ROBUSTNESS.md ("Known gaps"), not crashes of valid use.
const KNOWN = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./solver-misuse-known.json', import.meta.url), 'utf8'));

const summary = {tried: 0, refused: 0, accepted: 0, known: 0};
for (const [name, row] of Object.entries(ROWS)) {
  test(`${name}: hostile arguments are refused by a typed error or give a healthy result`, () => {
    assert.doesNotThrow(() => healthy(row.make(...row.args())), `the valid ${name} call`);
    const result = runRecipe({name, args: row.args, hints: {positive: row.positive ?? POSITIVE, integer: row.integer ?? INTEGER, lenient: row.lenient, wide: /./}, call: (...args) => row.make(...args), undo: healthy}, nothing, tax);
    summary.tried += result.tried; summary.refused += result.refused; summary.accepted += result.accepted;
    // Compare by class of failure (the path with indices folded, and the verdict), so the list stays short and stable.
    const classOf = line => line.replace(/\(([^=]*?) = .*?\) \[/, (_, path) => `(${path.replace(/\.\d+/g, '.N')}) [`).replace(/: (accepted, must be refused|threw \w+|accepted and left the subject unhealthy).*$/, ': $1');
    const classes = [...new Set(result.failures.map(classOf))].sort(), known = [...(KNOWN[name] ?? [])].sort();
    if (process.env.FUZZ_WRITE_KNOWN) { KNOWN[name] = classes; return; }
    summary.known += classes.length;
    assert.deepEqual(classes.filter(line => !known.includes(line)), [], `${name}: new contract failures (fix them, or list them in solver-misuse-known.json with the reason in docs/ROBUSTNESS.md)`);
    assert.deepEqual(known.filter(line => !classes.includes(line)), [], `${name}: these listed failures no longer happen; remove them from solver-misuse-known.json`);
  });
}
test('solver misuse totals', async () => {
  if (process.env.FUZZ_WRITE_KNOWN) { await (await import('node:fs/promises')).writeFile(new URL('./solver-misuse-known.json', import.meta.url), `${JSON.stringify(KNOWN, null, 1)}\n`); return; }
  console.log(`solver misuse: ${summary.tried} hostile calls over ${Object.keys(ROWS).length} constructors and builders; ${summary.refused} refused, ${summary.accepted} accepted healthy or listed; ${summary.known} listed classes of missing checks`);
  assert.ok(summary.tried > 3000);
});
