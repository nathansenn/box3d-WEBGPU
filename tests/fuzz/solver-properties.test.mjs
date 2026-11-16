// Property tests of the TypeScript solvers and their couplings (docs/ROBUSTNESS.md).
//
// Through the one stepping loop, for every coupled example scene (water and cables, frames, cloth, grains, solid contact,
// fracture, heat with thermal stress, volumetric fluid, free surface, shallow water):
//   determinism           two runs give the same checkpoint bytes;
//   checkpoint exactness  a checkpoint taken at a random step, resumed in another world, continues to the same bytes;
//   finiteness            no NaN or infinity in any solver field or in the energy ledger, whose identity
//                         balance = total - exchanged holds;
//   time-step refusal     the scene with a larger step is refused by a typed error or runs finite: never a silent blow-up.
// Directly, for the solvers with a closed-form invariant:
//   conservation          heat energy ledger, shallow-water volume, fluid momentum and divergence, grain momentum and
//                         energy, cloth momentum and energy;
//   mirror symmetry       the mirrored set-up gives the mirrored result (heat, shallow water, fluid, grains, cloth).
import assert from 'node:assert/strict';
import test from 'node:test';
import {ENGINE_ERRORS} from '../../src/engine/contracts.ts';
import {COUPLED_EXAMPLE_SCENES, normalizeScene, sceneWorldOptions, validateScene} from '../../src/engine/scene-format.ts';
import {encodeState, readCheckpoint} from '../../src/engine/checkpoint.ts';
import {resumeSimulationScene, simulationCheckpointInfo} from '../../src/engine/simulation.ts';
import {LabSceneHost, disposeLabScene, loadLabScene} from '../../src/lab/scene-host.ts';
import {HeatSolver} from '../../src/engine/heat.ts';
import {ShallowWater} from '../../src/engine/shallow-water.ts';
import {Fluid} from '../../src/engine/fluid.ts';
import {Granular} from '../../src/engine/granular.ts';
import {Cloth, clothGrid} from '../../src/engine/cloth.ts';
import {rng, seeds, scale, hashBytes} from './lib/rng.mjs';
import {nativePool} from './lib/scene-gen.mjs';

const poolA = await nativePool(), poolB = await nativePool();
const SEEDS = seeds(1, 12);
// Steps a scene may take in one run here: the heavy ones (fluid grids, free surface, solids) get fewer.
const HEAVY = {'rubber-pad': 0.25, 'sphere-settling': 0.25, 'flow-past-cylinder': 0.25, 'dam-break': 0.15, 'cavity-flow': 0.4, 'notched-beam': 0.4, 'heated-bar': 0.5, 'hopper-seesaw': 0.5, 'dam-break-valley': 0.5};
const budget = name => Math.max(4, Math.round(scale(16, 240) * (HEAVY[name] ?? 1)));
const same = (a, b) => a.length === b.length && hashBytes(a) === hashBytes(b) && a.every((v, i) => v === b[i]);
const typed = (error, what) => {
  assert.ok(error instanceof Error && error.name === 'EngineError' && error.code in ENGINE_ERRORS, `${what}: threw ${error?.constructor?.name}: ${String(error?.stack ?? error).slice(0, 400)}`);
  assert.ok(error.message.length > 12, `${what}: no helpful message`);
};
// Fields where an infinity is a stated value, not a blow-up: a cloth that cannot tear has infinite strength; a fracture
// history variable is infinite until its element first loads; a fluid cell with no obstacle is infinitely far from one
// (dist) and a free-surface cell outside the narrow band is infinitely far from the surface (phi); a shallow-water side
// with no span runs from -Infinity to +Infinity (lo, hi). NaN is allowed nowhere.
const INFINITE_BY_DESIGN = /\.(strength\w*|hist|dist(\[\d+\])?|phi|lo|hi)$/;
/** Every number in a state tree is finite (or a documented +Infinity). Returns how many were looked at. */
function finiteTree(value, path) {
  const fine = v => Number.isFinite(v) || ((v === Infinity || v === -Infinity) && INFINITE_BY_DESIGN.test(path));
  if (typeof value === 'number') { if (!fine(value)) throw new Error(`${path} is ${value}`); return 1; }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof Float64Array || value instanceof Float32Array) for (let i = 0; i < value.length; i++) if (!fine(value[i])) throw new Error(`${path}[${i}] is ${value[i]}`);
    return value.length;
  }
  if (Array.isArray(value)) return value.reduce((n, item, i) => n + finiteTree(item, `${path}[${i}]`), 0);
  if (value !== null && typeof value === 'object') return Object.entries(value).reduce((n, [key, item]) => n + finiteTree(item, `${path}.${key}`), 0);
  return 0;
}
/**
 * Everything the solvers and the rigid bodies hold after a step: the solvers' state trees and every body's state.
 * (The rigid world's own checkpoint bytes also hold its handle table, which differs between a fresh world and one that
 * ran other scenes before, by design: handles belong to the world that made them.)
 */
function digest(native, simulation) {
  const parts = [encodeState(readCheckpoint(simulation.checkpoint({scene: false}), 'simulation').subsystems)];
  const f = new Float32Array(14);
  for (let row = 0; row < native.bodyCount(); row++) { const s = native.bodyState(native.bodyHandle(row)); f.set(s.position, 0); f.set(s.rotation, 3); f.set(s.linearVelocity, 7); f.set(s.angularVelocity, 10); f[13] = s.mass; parts.push(new Uint8Array(f.buffer.slice(0))); }
  return Buffer.concat(parts);
}
function checkEnergy(simulation, what) {
  const e = simulation.energy();
  for (const [key, value] of Object.entries({mechanical: e.mechanical, thermal: e.thermal, total: e.total, exchanged: e.exchanged, balance: e.balance})) assert.ok(Number.isFinite(value), `${what}: energy ${key} is ${value}`);
  for (const entry of e.entries) for (const [key, value] of Object.entries(entry)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${what}: energy entry ${entry.id}.${key} is ${value}`);
  const scale_ = Math.max(1, Math.abs(e.total), Math.abs(e.exchanged));
  assert.ok(Math.abs(e.balance - (e.total - e.exchanged)) <= 1e-9 * scale_, `${what}: balance ${e.balance} is not total - exchanged = ${e.total - e.exchanged}`);
  return e;
}

for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
  test(`${name}: deterministic, exact across a checkpoint at a random step, finite, ledger identity`, () => {
    const a = poolA.createWorld(), b = poolB.createWorld();
    a.retainBodyShapes(true); b.retainBodyShapes(true);
    try {
      for (const seed of SEEDS) {
        const r = rng(seed ^ hashBytes(new TextEncoder().encode(name))), total = budget(name), k1 = r.int(1, Math.max(1, total - 2)), k2 = total - k1;
        const what = `${name} [seed ${seed}: checkpoint at step ${k1}, ${k2} more]`;
        const first = loadLabScene(a, make());
        for (let i = 0; i < k1; i++) first.simulation.step();
        const saved = first.simulation.checkpoint();
        try { finiteTree(readCheckpoint(saved, 'simulation').subsystems, 'subsystems'); } catch (error) { assert.fail(`${what}: ${error.message}`); }
        checkEnergy(first.simulation, what);
        for (let i = 0; i < k2; i++) first.simulation.step();
        const expected = digest(a, first.simulation), energy = checkEnergy(first.simulation, what);
        try { finiteTree(readCheckpoint(first.simulation.checkpoint({scene: false}), 'simulation').subsystems, 'subsystems'); } catch (error) { assert.fail(`${what}: ${error.message}`); }
        for (let row = 0; row < a.bodyCount(); row++) { const s = a.bodyState(a.bodyHandle(row)); assert.ok([...s.position, ...s.rotation, ...s.linearVelocity, ...s.angularVelocity].every(Number.isFinite), `${what}: rigid body row ${row} is not finite`); }
        disposeLabScene(first);
        // Resume the checkpoint in the other WASM instance, which has run something else before.
        const resumed = resumeSimulationScene(new LabSceneHost(b, sceneWorldOptions(normalizeScene(JSON.parse(simulationCheckpointInfo(saved).scene)))), saved);
        for (let i = 0; i < k2; i++) resumed.simulation.step();
        assert.ok(same(digest(b, resumed.simulation), expected), `${what}: the resumed run differs from the uninterrupted one`);
        assert.equal(resumed.simulation.energy().balance, energy.balance, `${what}: the ledger after resume`);
        disposeLabScene(resumed);
        // And from the start again in the first instance: the same bytes.
        const again = loadLabScene(a, make());
        for (let i = 0; i < total; i++) again.simulation.step();
        assert.ok(same(digest(a, again.simulation), expected), `${what}: a second run from the scene differs`);
        disposeLabScene(again);
      }
    } finally { a.destroy(); b.destroy(); }
  });
}

test('a larger time step is refused by a typed error or runs finite: no scene blows up silently', () => {
  const world = poolA.createWorld();
  world.retainBodyShapes(true);
  const outcome = {refusedByValidation: 0, refusedAtLoad: 0, refusedAtStep: 0, ran: 0};
  try {
    for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
      const base = make(), step = base.world?.step ?? 1 / 60;
      for (const factor of [2, 4, 8]) {
        if (step * factor > 1 / 30 + 1e-12) continue;
        const scene = JSON.parse(JSON.stringify(base)), what = `${name} at ${factor}x its step (${(step * factor).toFixed(5)} s)`;
        scene.world = {...scene.world, step: step * factor};
        const problems = validateScene(scene);
        if (problems.length > 0) { assert.ok(problems.every(p => typeof p.path === 'string' && p.message.length > 3), what); outcome.refusedByValidation++; continue; }
        let loaded;
        try { loaded = loadLabScene(world, scene); } catch (error) { typed(error, `${what}: load`); outcome.refusedAtLoad++; continue; }
        try {
          for (let i = 0; i < Math.max(3, Math.round(budget(name) / factor)); i++) loaded.simulation.step();
          finiteTree(readCheckpoint(loaded.simulation.checkpoint({scene: false}), 'simulation').subsystems, 'subsystems');
          checkEnergy(loaded.simulation, what);
          outcome.ran++;
        } catch (error) {
          if (error.name !== 'EngineError') assert.fail(`${what}: ${error.message}`);
          typed(error, `${what}: step`); outcome.refusedAtStep++;
        } finally { disposeLabScene(loaded); }
      }
    }
  } finally { world.destroy(); }
  console.log(`solver properties: larger steps ${JSON.stringify(outcome)}`);
  assert.ok(outcome.refusedByValidation + outcome.refusedAtLoad + outcome.refusedAtStep + outcome.ran >= 16);
});

// ---- direct properties ----
const close = (actual, expected, tolerance, what) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected} (tolerance ${tolerance})`);

test('heat: the energy ledger closes, a mirrored field stays mirrored, and an unstable explicit step is refused', () => {
  for (const seed of seeds(3, 60)) {
    const r = rng(seed), nx = r.int(4, 10), ny = r.int(2, 5), nz = r.int(1, 4), h = r.real(0.005, 0.05);
    const material = {conductivity: r.log(0.5, 400), density: r.log(500, 9000), specificHeat: r.log(200, 2000)};
    const field = Float64Array.from({length: nx * ny * nz}, () => r.real(250, 600));
    const config = (temperature, flip) => ({nx, ny, nz, dx: h, dy: h, dz: h, materials: [material], temperature, scheme: 'backward-euler', dt: r.real(0.05, 2), tolerance: 1e-13,
      boundaries: [{face: flip ? 'x+' : 'x-', type: 'temperature', temperature: 320}, {face: flip ? 'x-' : 'x+', type: 'convection', coefficient: 25, ambient: 290}]});
    const pick = rng(seed), scheme = pick.pick(['backward-euler', 'crank-nicolson']), dt = pick.real(0.05, 2);
    const build = (temperature, flip) => new HeatSolver({...config(temperature, flip), scheme, dt});
    let a;
    try { a = build(field, false); } catch (error) { typed(error, `heat seed ${seed}`); continue; }
    const mirrored = Float64Array.from(field, (_, index) => { const i = index % nx, rest = index - i; return field[rest + (nx - 1 - i)]; });
    const b = build(mirrored, true), e0 = a.storedEnergy();
    for (let step = 0; step < 12; step++) { a.step(); b.step(); }
    const exchanged = a.boundaryEnergy.reduce((sum, value) => sum + value, 0) + a.sourceEnergy;
    close(a.storedEnergy() - e0, exchanged, 1e-7 * Math.max(1, Math.abs(e0)), `heat seed ${seed}: stored energy change equals what crossed the boundaries`);
    for (let index = 0; index < field.length; index++) { const i = index % nx, rest = index - i; close(b.temperature[rest + (nx - 1 - i)], a.temperature[index], 1e-8, `heat seed ${seed}: mirrored cell ${index}`); }
    for (const t of a.temperature) assert.ok(Number.isFinite(t));
    // An explicit step above the limit is refused, by name, before anything is computed.
    const limit = a.explicitStabilityLimit();
    assert.throws(() => new HeatSolver({...config(field, false), scheme: 'explicit', dt: limit * 1.5}), error => { typed(error, 'heat explicit limit'); return error.code === 'UNSTABLE_TIME_STEP'; });
    assert.doesNotThrow(() => new HeatSolver({...config(field, false), scheme: 'explicit', dt: limit * 0.9}));
  }
});

test('shallow water: volume is conserved in a closed basin, a mirrored dam gives the mirrored flow, steps beyond the CFL limit are subdivided or refused', () => {
  for (const seed of seeds(3, 60)) {
    const r = rng(seed), nx = r.int(8, 24), nz = r.int(1, 10), dx = r.real(0.05, 2), depthLeft = r.real(0.2, 3), depthRight = r.real(0, 0.5), dam = r.int(2, nx - 2) * dx;
    const slope = r.real(0, 0.02), dt = r.real(0.002, 0.05);
    const build = flip => new ShallowWater({cells: [nx, nz], spacing: dx, dt,
      bed: x => slope * (flip ? nx * dx - x : x), depth: x => ((flip ? nx * dx - x : x) <= dam ? depthLeft : depthRight)});
    let a, b;
    try { a = build(false); b = build(true); } catch (error) { typed(error, `shallow water seed ${seed}`); continue; }
    const v0 = a.volume();
    try { for (let step = 0; step < 25; step++) { a.step(); b.step(); } } catch (error) { typed(error, `shallow water seed ${seed}: step`); continue; }
    close(a.volume(), v0, 1e-9 * Math.max(v0, 1e-6), `shallow water seed ${seed}: volume in a closed basin`);
    assert.ok(Math.abs(a.volumeError()) <= 1e-9 * Math.max(v0, 1e-6), `shallow water seed ${seed}: volumeError ${a.volumeError()}`);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const cell = i + k * nx, twin = (nx - 1 - i) + k * nx, tolerance = 1e-9 * Math.max(1, depthLeft);
      close(b.h[twin], a.h[cell], tolerance, `shallow water seed ${seed}: mirrored depth of cell ${cell}`);
      close(b.qx[twin], -a.qx[cell], tolerance * 10, `shallow water seed ${seed}: mirrored discharge of cell ${cell}`);
      assert.ok(a.h[cell] >= 0 && Number.isFinite(a.h[cell]) && Number.isFinite(a.qx[cell]) && Number.isFinite(a.qz[cell]), `shallow water seed ${seed}: cell ${cell} is not a finite, non-negative depth`);
    }
    // A step far above the stable one: subdivided within maxSubsteps, or refused with the limit in the message.
    const big = new ShallowWater({cells: [nx, nz], spacing: dx, dt: 1e3, depth: x => (x <= dam ? depthLeft : depthRight)});
    try { big.step(); for (const h of big.h) assert.ok(Number.isFinite(h) && h >= 0); } catch (error) { typed(error, 'shallow water huge step'); assert.match(error.message, /step|dt|CFL/i); }
  }
});

test('fluid: periodic flow keeps its momentum and stays divergence-free, a mirrored field stays mirrored, an unstable step is refused', () => {
  let checked = 0;
  const PERIODIC = 'periodic', allPeriodic = {xMin: PERIODIC, xMax: PERIODIC, yMin: PERIODIC, yMax: PERIODIC, zMin: PERIODIC, zMax: PERIODIC};
  for (const seed of seeds(2, 30)) {
    const r = rng(seed), n = r.pick([6, 8]), h = r.real(0.01, 0.1), L = n * h, U = r.real(0.01, 0.2), density = r.log(1, 1500), viscosity = density * r.log(1e-6, 1e-3) * 100;
    const k = 2 * Math.PI / L, phase = r.real(0, 1);
    // A divergence-free field: u = U sin(k y + p), v = U sin(k z + p), w = U sin(k x + p).
    const field = (x, y, z) => [U * Math.sin(k * y + phase), U * Math.sin(k * z + phase), U * Math.sin(k * x + phase)];
    const mirror = (x, y, z) => { const [u, v, w] = field(L - x, y, z); return [-u, v, w]; };
    // Within both limits: 0.2 of the advective (CFL) step and 0.8 of the explicit viscous one, h^2 / (6 nu).
    const dt = Math.min(0.2 * h / (2 * U), 0.8 * h * h / (6 * viscosity / density));
    const build = velocity => { const f = new Fluid({cells: [n, n, n], spacing: h, density, viscosity, dt, gravity: [0, 0, 0], boundaries: allPeriodic}); f.setVelocity(velocity); f.project(); return f; };
    let a, b;
    try { a = build(field); b = build(mirror); } catch (error) { typed(error, `fluid seed ${seed}`); continue; }
    checked++;
    const p0 = a.momentum(), e0 = a.kineticEnergy();
    for (let step = 0; step < 6; step++) { a.step(); b.step(); }
    const p1 = a.momentum(), massScale = density * L ** 3 * U;
    for (let axis = 0; axis < 3; axis++) close(p1[axis], p0[axis], 1e-7 * massScale + 1e-12, `fluid seed ${seed}: momentum ${'xyz'[axis]} in a periodic box`);
    assert.ok(a.maxDivergence() * h / U < 1e-5, `fluid seed ${seed}: divergence ${a.maxDivergence()} 1/s`);
    assert.ok(a.kineticEnergy() <= e0 * (1 + 1e-9), `fluid seed ${seed}: kinetic energy rose from ${e0} to ${a.kineticEnergy()} with no forcing`);
    for (let sample = 0; sample < 20; sample++) {
      const x = r.real(0, L), y = r.real(0, L), z = r.real(0, L), va = a.velocityAt(x, y, z), vb = b.velocityAt(L - x, y, z);
      close(vb[0], -va[0], 1e-7 * U, `fluid seed ${seed}: mirrored u`); close(vb[1], va[1], 1e-7 * U, `fluid seed ${seed}: mirrored v`); close(vb[2], va[2], 1e-7 * U, `fluid seed ${seed}: mirrored w`);
    }
    assert.throws(() => { const f = new Fluid({cells: [n, n, n], spacing: h, density, viscosity, dt: 50 * h / U, gravity: [0, 0, 0], boundaries: allPeriodic}); f.setVelocity(field); f.project(); f.step(); },
      error => { typed(error, 'fluid CFL'); return error.code === 'UNSTABLE_TIME_STEP'; }, `fluid seed ${seed}: a step of 50 cells per step must be refused`);
  }
  // Every seed now picks a stable step, so none may be skipped: the properties above were checked on each.
  assert.equal(checked, seeds(2, 30).length, 'fluid: every seed built a field');
});

test('grains: collisions conserve momentum, the ledger closes, a mirrored collision is the mirror image, a step above the critical one is refused', () => {
  for (const seed of seeds(4, 80)) {
    const r = rng(seed), radius = r.real(0.002, 0.02), material = {density: r.log(500, 8000), youngModulus: r.log(1e6, 1e9), poissonRatio: r.real(0.1, 0.4), restitution: r.real(0.3, 1), friction: r.real(0, 0.8)};
    const probe = new Granular({material, config: {dt: 1e-12, capacity: 1, gravity: [0, 0, 0]}}), dt = 0.05 * probe.criticalTimeFor(radius * 0.8);
    const count = r.int(2, 6), grains = [];
    for (let i = 0; i < count; i++) {
      // A line of grains closing on each other, slightly off axis so that friction and spin take part.
      const x = (i - (count - 1) / 2) * 2.4 * radius, rad = radius * r.real(0.8, 1.2);
      grains.push({position: [x, r.real(-0.2, 0.2) * radius, r.real(-0.2, 0.2) * radius], radius: rad, velocity: [-Math.sign(x || 1) * r.real(0.02, 0.3), r.real(-0.02, 0.02), 0]});
    }
    const build = sign => { const g = new Granular({material, config: {dt, capacity: count, gravity: [0, 0, 0]}}); for (const grain of grains) g.addGrain([sign * grain.position[0], grain.position[1], grain.position[2]], grain.radius, [sign * grain.velocity[0], grain.velocity[1], grain.velocity[2]]); return g; };
    const a = build(1), b = build(-1), p0 = a.linearMomentum(), e0 = a.energyBalance(), scaleP = a.mass() * 0.3, scaleE = 0.5 * a.mass() * 0.09;
    for (let step = 0; step < scale(2500, 20000); step++) { a.step(); b.step(); }
    const p1 = a.linearMomentum();
    for (let axis = 0; axis < 3; axis++) close(p1[axis], p0[axis], 1e-9 * scaleP, `grains seed ${seed}: momentum ${'xyz'[axis]}`);
    // The ledger (kinetic + elastic + dissipated) drifts with the square of the step: at 1/20 of the critical step, below 0.2 %.
    close(a.energyBalance(), e0, 2e-3 * Math.abs(e0) + 1e-9 * scaleE, `grains seed ${seed}: energy ledger (kinetic + elastic + dissipated)`);
    assert.ok(a.kineticEnergy() <= e0 * (1 + 1e-9), `grains seed ${seed}: kinetic energy rose`);
    for (let i = 0; i < count * 3; i++) close(b.positions[i], (i % 3 === 0 ? -1 : 1) * a.positions[i], 1e-12, `grains seed ${seed}: mirrored position ${i}`);
    assert.throws(() => new Granular({material, config: {dt: 50 * probe.criticalTimeFor(radius * 0.8), capacity: 2, gravity: [0, 0, 0]}}).addGrain([0, 0, 0], radius * 0.8), error => { typed(error, 'grains critical step'); return error.code === 'UNSTABLE_TIME_STEP'; }, `grains seed ${seed}: a step of 50 critical steps must be refused`);
  }
});

test('cloth: free fall gains exactly m g t of momentum, a mirrored sheet is the mirror image, energy does not rise without forcing', () => {
  for (const seed of seeds(2, 30)) {
    const r = rng(seed), n = r.int(3, 6), side = r.real(0.3, 1.5), g = 9.81, dt = r.pick([1 / 60, 1 / 120]);
    const grid = clothGrid({nx: n, ny: n, u: [side, 0, 0], v: [0, 0, side], origin: [-side / 2, 1, -side / 2]});
    const material = {arealDensity: r.real(0.1, 1), youngModulus: r.log(1e4, 1e7), thickness: 1e-3, poissonRatio: r.real(0, 0.4)};
    const bump = Float64Array.from(grid.positions, (v, i) => i % 3 === 1 ? v + 0.02 * side * Math.sin(3 * grid.positions[i - 1]) * Math.cos(2 * grid.positions[i + 1]) : v);
    const build = (sign, gravity) => new Cloth({positions: Float64Array.from(bump, (v, i) => i % 3 === 0 ? sign * v : v), restPositions: Float64Array.from(grid.positions, (v, i) => i % 3 === 0 ? sign * v : v), triangles: grid.triangles, material,
      config: {dt, gravity, residualTolerance: 1e-11, maxNewtonIterations: 200}});
    let a, b, still;
    try { a = build(1, [0, -g, 0]); b = build(-1, [0, -g, 0]); still = build(1, [0, 0, 0]); } catch (error) { typed(error, `cloth seed ${seed}`); continue; }
    const steps = 20, mass = a.mass(), e0 = still.totalEnergy();
    try { for (let step = 0; step < steps; step++) { a.step(); b.step(); still.step(); } } catch (error) { typed(error, `cloth seed ${seed}: step`); continue; }
    const p = a.linearMomentum();
    close(p[1], -mass * g * steps * dt, 1e-6 * mass * g * steps * dt, `cloth seed ${seed}: vertical momentum after ${steps} steps of free fall`);
    close(p[0], 0, 1e-6 * mass * g * dt, `cloth seed ${seed}: sideways momentum`); close(p[2], 0, 1e-6 * mass * g * dt, `cloth seed ${seed}: sideways momentum`);
    for (let i = 0; i < a.positions.length; i++) close(b.positions[i], (i % 3 === 0 ? -1 : 1) * a.positions[i], 1e-7 * side, `cloth seed ${seed}: mirrored coordinate ${i}`);
    assert.ok(still.totalEnergy() <= e0 * (1 + 1e-6) + 1e-12, `cloth seed ${seed}: with no gravity the energy rose from ${e0} to ${still.totalEnergy()}`);
    for (const v of a.positions) assert.ok(Number.isFinite(v));
  }
});
