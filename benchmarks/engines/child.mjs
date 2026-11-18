// One measurement in one fresh Node process: load an engine, warm up, build the scene, step it, print one JSON line.
//   node benchmarks/engines/child.mjs --engine=rapier --scene=boxes-1k [--solver=default|8] [--warm=0] [--budgetMs=120000]
// Used by run.mjs (the full comparison) and by tests/benchmarks/engine-comparison.test.mjs (the smoke variant).
// The timed region of a step is the engine's step call and nothing else; state is read for the quality numbers
// between steps. `step` is the CPU time of the process per step, `stepWall` the wall time. Construction time is world creation, every body and joint, and the first step (several engines
// build their broad phase lazily there), so the step statistics start at the second step.
import {performance} from 'node:perf_hooks';
import {findScene, DT, GRAVITY} from './scenes.mjs';
import {summarize, hashState, hashState64} from './lib/util.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : '1']; }));

export async function measure({engine: engineId, scene: sceneId, solver = 'default', warm = true, budgetMs = 120000, twice = false}) {
  const scene = findScene(sceneId);
  if (!scene) throw new Error(`unknown scene ${sceneId}`);
  const adapter = await import(`./adapters/${engineId}.mjs`);
  const loadStart = performance.now();
  const engine = await adapter.load();
  const loadMs = performance.now() - loadStart;

  const construct = (data, sleep) => {
    const counts = {bodies: data.bodies.length, dynamic: data.bodies.filter(b => b.type === 'dynamic').length, joints: data.joints.length};
    const world = engine.createWorld({gravity: [0, -GRAVITY, 0], solver, sleep, counts});
    for (const body of data.bodies) world.addBody(body);
    for (const joint of data.joints) world.addJoint(joint);
    world.finalize();
    return world;
  };

  if (twice) {
    // Same-process determinism: build and run the scene twice, one world after the other, and compare the final states bit for bit.
    const hashOf = adapter.meta.precision === 'float64' ? hashState64 : hashState, hashes = [];
    let steps = 0;
    for (let pass = 0; pass < 2; pass++) {
      const data = scene.build(), world = construct(data, scene.sleep), state = new Float64Array(data.bodies.length * 7), start = process.cpuUsage();
      // The first pass stops at the scene's length or at half the time budget; the second runs exactly as many steps.
      if (pass === 0) { for (; steps < data.steps && (process.cpuUsage(start).user + process.cpuUsage(start).system) / 1000 < budgetMs / 2; steps++) world.step(DT); }
      else for (let i = 0; i < steps; i++) world.step(DT);
      world.readState(state);
      hashes.push(hashOf(state));
      world.destroy();
    }
    return {engine: engineId, scene: sceneId, solver, version: engine.version, twice: {first: hashes[0], second: hashes[1], steps, identical: hashes[0] === hashes[1]}};
  }

  // Warm-up: a small copy of the scene, built and stepped in this process, then destroyed.
  if (warm && scene.warm) {
    const data = scene.warm(), world = construct(data, scene.sleep);
    for (let i = 0; i < 60; i++) world.step(DT);
    if (data.rays) world.raycastMany(data.rays.origins, data.rays.directions, data.rays.maxDistance, new Float32Array(data.rays.count));
    world.destroy();
  }
  globalThis.gc?.();

  const data = scene.build(), count = data.bodies.length;
  const cpuMs = since => { const used = process.cpuUsage(since); return (used.user + used.system) / 1000; };
  const buildCpu = process.cpuUsage(), buildStart = performance.now();
  const world = construct(data, scene.sleep);
  const builtMs = cpuMs(buildCpu), builtWallMs = performance.now() - buildStart;
  const firstCpu = process.cpuUsage(), firstStart = performance.now();
  world.step(DT);
  const firstStepMs = cpuMs(firstCpu), firstStepWallMs = performance.now() - firstStart;

  const ctx = {state: new Float64Array(count * 7), velocity: new Float64Array(count * 6), count, awake: null, initial: new Float64Array(count * 7)};
  data.bodies.forEach((body, i) => { ctx.initial.set(body.position, i * 7); ctx.initial.set(body.rotation, i * 7 + 3); });
  const read = () => { world.readState(ctx.state); if (data.needsVelocity) world.readVelocity(ctx.velocity); ctx.awake = scene.sleep === 'default' ? world.awakeCount() : null; };
  // The quality hooks start after step 1; `ctx.initial` holds the poses the scene was built with.
  read();
  data.quality.init(ctx);

  // Two clocks around every step: wall time, and the CPU time this process used. On a quiet machine they agree; on a
  // busy one the wall clock also counts the time the process waited for a core, the CPU clock does not.
  const times = new Float64Array(Math.max(0, data.steps - 1)), cpuTimes = new Float64Array(times.length);
  let done = 1, timedOut = false;
  // The time budget counts CPU time, like the step statistics: on a busy machine a run takes longer, not fewer steps.
  const runStart = process.cpuUsage();
  for (let step = 2; step <= data.steps; step++) {
    const c0 = process.cpuUsage(), t0 = performance.now();
    world.step(DT);
    times[step - 2] = performance.now() - t0;
    const used = process.cpuUsage(c0);
    cpuTimes[step - 2] = (used.user + used.system) / 1000;
    done = step;
    if (data.sample && step % data.sample === 0) { read(); data.quality.sample?.(ctx, step); }
    if (cpuMs(runStart) > budgetMs) { timedOut = step < data.steps; break; }
  }
  read();
  const quality = data.quality.finish(ctx);

  let rays = null;
  if (data.rays) {
    const out = new Float32Array(data.rays.count), passes = [];
    const wallPasses = [];
    for (let pass = 0; pass < 3; pass++) {
      const c0 = process.cpuUsage(), t0 = performance.now();
      world.raycastMany(data.rays.origins, data.rays.directions, data.rays.maxDistance, out);
      wallPasses.push(performance.now() - t0);
      const used = process.cpuUsage(c0);
      passes.push((used.user + used.system) / 1000);
    }
    let hits = 0, sum = 0;
    for (let i = 0; i < out.length; i++) if (out[i] >= 0) { hits++; sum += out[i]; }
    const best = Math.min(...passes);
    rays = {count: data.rays.count, passesMs: passes, wallPassesMs: wallPasses, bestMs: best, raysPerSecond: data.rays.count / (best / 1000), hits, meanHitDistanceM: hits ? sum / hits : null};
    if (data.rays.expected) {
      // Terrain placement check: the hit distance of every vertical ray against the height the scene defines there.
      let worst = 0;
      for (let i = 0; i < out.length; i++) if (out[i] >= 0) worst = Math.max(worst, Math.abs(out[i] - data.rays.expected[i]));
      rays.maxErrorM = worst; rays.missed = out.length - hits;
    }
  }

  const memoryBytes = world.memoryBytes();
  const result = {
    engine: engineId, scene: sceneId, solver, version: engine.version, settings: world.settings, bodies: count, joints: data.joints.length, steps: data.steps, stepsDone: done, timedOut,
    loadMs, constructionMs: builtMs + firstStepMs, constructionWallMs: builtWallMs + firstStepWallMs, buildMs: builtMs, firstStepMs,
    step: summarize(cpuTimes.subarray(0, Math.max(0, done - 1))), stepWall: summarize(times.subarray(0, Math.max(0, done - 1))),
    quality, rays, stateHash: adapter.meta.precision === 'float64' ? hashState64(ctx.state) : hashState(ctx.state),
    wasmMemoryBytes: memoryBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024, heapUsedBytes: process.memoryUsage().heapUsed,
  };
  world.destroy();
  return result;
}

if (args.engine) {
  // --scene takes one scene, or several separated by commas (one JSON line each, in one process: the smoke test).
  for (const scene of String(args.scene).split(',')) {
    try {
      const result = await measure({engine: args.engine, scene, solver: args.solver === undefined || args.solver === 'default' ? 'default' : Number(args.solver),
        warm: args.warm !== '0', budgetMs: Number(args.budgetMs ?? 120000), twice: args.twice === '1'});
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({engine: args.engine, scene, solver: args.solver ?? 'default', failed: true, error: String(error?.message ?? error).slice(0, 600)})}\n`);
    }
  }
  process.exit(0);
}
