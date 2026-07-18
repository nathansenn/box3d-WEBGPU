'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const { SCENES } = require(path.join(root, '.test-build/src/scenes.js'));
const { SoftSimulationSuite, SOFT_INSTANCE_BUDGET } = require(path.join(root, '.test-build/src/soft/simulations.js'));
const { SoftKernelModule } = require(path.join(root, '.test-build/src/soft/kernels.js'));

const catalogFrames = Math.max(1, Number.parseInt(process.env.SOFT_SOAK_FRAMES ?? '24', 10));
const deepFrames = Math.max(1, Number.parseInt(process.env.SOFT_DEEP_FRAMES ?? '300', 10));
const kernelVariant = process.env.SOFT_SOAK_KERNEL === 'simd' || process.env.SOFT_SOAK_KERNEL === 'scalar'
  ? process.env.SOFT_SOAK_KERNEL
  : 'javascript';
const softScenes = SCENES.filter((scene) =>
  scene.family === 'cloth' || scene.family === 'rope' || scene.family === 'water' || scene.family === 'fracture');

function createKernelModule() {
  if (kernelVariant === 'javascript') return null;
  const bytes = fs.readFileSync(path.join(root, 'public', `soft-kernels-${kernelVariant}.wasm`));
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {});
  return new SoftKernelModule(kernelVariant, instance.exports);
}

function finite(array) {
  for (let i = 0; i < array.length; i++) {
    if (!Number.isFinite(array[i])) return false;
  }
  return true;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectFrame(scene, frame, label) {
  assert(frame.kind === scene.family, `${label}: expected ${scene.family}, received ${frame.kind}`);
  assert(frame.nodeCount > 0, `${label}: node count was not initialized`);
  assert(frame.constraintCount > 0, `${label}: constraint/cell count was not initialized`);
  assert(frame.instanceCount >= 0 && frame.instanceCount <= SOFT_INSTANCE_BUDGET, `${label}: instance budget exceeded`);
  assert(frame.matrices.length >= frame.instanceCount * 16, `${label}: matrix stream is shorter than the active instance range`);
  assert(frame.colors.length >= frame.instanceCount * 4, `${label}: color stream is shorter than the active instance range`);
  assert(finite(frame.matrices.subarray(0, frame.instanceCount * 16)) && finite(frame.colors.subarray(0, frame.instanceCount * 4)), `${label}: non-finite active instance stream`);
  assert(Number.isFinite(frame.energy) && frame.energy >= 0, `${label}: invalid energy telemetry`);
  assert(frame.hash !== 0, `${label}: replay hash was not initialized`);
  assert(Number.isInteger(frame.frameVersion) && frame.frameVersion >= 0, `${label}: frame version was not initialized`);

  if (frame.surface) {
    if (frame.surface.path === 'packed') {
      assert(frame.surface.vertexStride === 24, `${label}: packed surface stride must be 24 bytes`);
      assert(frame.surface.vertices.byteLength >= frame.surface.vertexCount * frame.surface.vertexStride, `${label}: packed surface vertex stream is truncated`);
      const view = new DataView(frame.surface.vertices.buffer, frame.surface.vertices.byteOffset, frame.surface.vertices.byteLength);
      for (let i = 0; i < frame.surface.vertexCount; i++) {
        const offset = i * frame.surface.vertexStride;
        assert(Number.isFinite(view.getFloat32(offset, true)), `${label}: non-finite packed surface X`);
        assert(Number.isFinite(view.getFloat32(offset + 4, true)), `${label}: non-finite packed surface Y`);
        assert(Number.isFinite(view.getFloat32(offset + 8, true)), `${label}: non-finite packed surface Z`);
      }
    } else if (frame.surface.path === 'gpu-cloth') {
      assert(frame.surface.positions.length >= frame.surface.vertexCount * 3, `${label}: GPU-cloth position stream is truncated`);
      assert(finite(frame.surface.positions) && finite(frame.surface.restPositions), `${label}: GPU-cloth state is non-finite`);
    } else {
      assert(frame.surface.eta.length >= frame.surface.vertexCount, `${label}: GPU-water eta stream is truncated`);
      assert(frame.surface.u.length >= frame.surface.vertexCount && frame.surface.v.length >= frame.surface.vertexCount, `${label}: GPU-water velocity stream is truncated`);
      assert(finite(frame.surface.eta) && finite(frame.surface.u) && finite(frame.surface.v), `${label}: GPU-water state is non-finite`);
    }
    assert(frame.surface.indices.length >= frame.surface.indexCount, `${label}: surface index stream is truncated`);
    assert(frame.surface.indices instanceof Uint16Array, `${label}: surface indices must remain uint16`);
    for (let i = 0; i < frame.surface.indexCount; i++) {
      assert(frame.surface.indices[i] < frame.surface.vertexCount, `${label}: surface index out of range`);
    }
  }
  if (frame.ropeGrid) {
    const grid = frame.ropeGrid;
    assert(grid.presentation === 'rope' || grid.presentation === 'material', `${label}: invalid segment presentation`);
    assert(grid.nodeCount > 0 && grid.segmentCount >= 0, `${label}: invalid segment-grid counts`);
    assert(grid.positions.length >= grid.nodeCount * 3 && grid.segments.length >= grid.segmentCount * 8, `${label}: truncated segment grid`);
    assert(finite(grid.positions) && finite(grid.segments), `${label}: non-finite segment grid`);
    for (let i = 0; i < grid.segmentCount; i++) {
      const a = grid.segments[i * 8];
      const b = grid.segments[i * 8 + 1];
      assert(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < grid.nodeCount && b < grid.nodeCount,
        `${label}: segment ${i} references an invalid node`);
    }
  }
  if (scene.family === 'fracture') {
    const material = frame.material;
    assert(material && material.label.length >= 3 && material.testMode.length >= 3, `${label}: material telemetry is missing`);
    assert(Number.isFinite(material.loadTarget) && Number.isFinite(material.loadProgress), `${label}: load telemetry is non-finite`);
    assert(Number.isFinite(material.maxStrain) && material.maxStrain >= 0, `${label}: maximum strain is invalid`);
    assert(material.yieldStrain > 0 && material.breakStrain > material.yieldStrain, `${label}: material strain envelope is invalid`);
    assert(material.yieldedCount >= 0 && material.damagedCount >= 0, `${label}: material counters are invalid`);
    assert(Number.isFinite(material.peakDamage) && material.peakDamage >= 0 && material.peakDamage <= 1, `${label}: peak damage is invalid`);
    assert(gridPresentation(frame) === 'material', `${label}: fracture scene must use the material segment path`);
  }
}

function gridPresentation(frame) {
  return frame.ropeGrid?.presentation ?? null;
}

const started = performance.now();
const summary = {
  kernelVariant,
  catalogScenes: 0,
  catalogFrames: 0,
  deepFrames: 0,
  families: { cloth: 0, rope: 0, water: 0, fracture: 0 },
  maxNodes: 0,
  maxConstraints: 0,
  maxInstances: 0,
  maxBreaks: 0,
  maxEnergy: 0,
};

for (const scene of softScenes) {
  const suite = new SoftSimulationSuite(createKernelModule());
  assert(suite.createScene(scene, 5, 0xa110000 + scene.id), `${scene.title}: solver did not activate`);
  let previousYielded = 0;
  let previousDamaged = 0;
  let previousBroken = 0;
  let previousPeakDamage = 0;
  let previousMaxStrain = 0;
  for (let frameIndex = 0; frameIndex < catalogFrames; frameIndex++) {
    if (scene.family === 'fracture') {
      if (frameIndex === Math.floor(catalogFrames * 0.10)) suite.setLoadTarget(0.42);
      if (frameIndex === Math.floor(catalogFrames * 0.35)) suite.setLoadTarget(0.96);
      if (frameIndex === Math.floor(catalogFrames * 0.55)) suite.setLoadTarget(1.38);
      if (frameIndex === Math.floor(catalogFrames * 0.72)) suite.setLoadTarget(2);
      if (frameIndex === Math.floor(catalogFrames * 0.88)) suite.releaseLoad();
    } else {
      if (frameIndex === Math.floor(catalogFrames * 0.20)) suite.kick(18);
      if (frameIndex === Math.floor(catalogFrames * 0.40)) suite.launchProjectile([-18, 9, 0], [36, 1.5, 0], 0.9);
      if (frameIndex === Math.floor(catalogFrames * 0.60)) suite.explode([0, 5, 0], 36, 18);
      if (frameIndex === Math.floor(catalogFrames * 0.80)) suite.spawnRain(scene.family === 'water' ? 160 : 64, 14, 22);
    }
    suite.step(1 / 60, 4);
    if (scene.family === 'fracture') {
      const current = suite.buildFrame(false);
      const material = current.material;
      assert(material.yieldedCount >= previousYielded, `${scene.title}: yielded count regressed`);
      assert(material.damagedCount >= previousDamaged, `${scene.title}: damaged count regressed`);
      assert(current.brokenCount >= previousBroken, `${scene.title}: broken count regressed`);
      assert(material.peakDamage + 1e-8 >= previousPeakDamage, `${scene.title}: peak damage regressed`);
      assert(material.maxStrain + 1e-8 >= previousMaxStrain, `${scene.title}: maximum strain regressed`);
      previousYielded = material.yieldedCount;
      previousDamaged = material.damagedCount;
      previousBroken = current.brokenCount;
      previousPeakDamage = material.peakDamage;
      previousMaxStrain = material.maxStrain;
    }
  }
  const frame = suite.buildFrame(true);
  inspectFrame(scene, frame, scene.title);
  const validation = suite.validate();
  assert(validation.ok, `${scene.title}: ${validation.message}`);
  summary.catalogScenes++;
  summary.catalogFrames += catalogFrames;
  summary.families[scene.family]++;
  summary.maxNodes = Math.max(summary.maxNodes, frame.nodeCount);
  summary.maxConstraints = Math.max(summary.maxConstraints, frame.constraintCount);
  summary.maxInstances = Math.max(summary.maxInstances, frame.instanceCount);
  summary.maxBreaks = Math.max(summary.maxBreaks, frame.brokenCount);
  summary.maxEnergy = Math.max(summary.maxEnergy, frame.energy);
  suite.destroy();
}

for (const sceneId of [649, 699, 749, 799]) {
  const scene = SCENES[sceneId];
  // Each simultaneous replay owns a separate WebAssembly memory arena.
  const a = new SoftSimulationSuite(createKernelModule());
  const b = new SoftSimulationSuite(createKernelModule());
  a.createScene(scene, 5, 0xdeadbeef);
  b.createScene(scene, 5, 0xdeadbeef);
  for (let frameIndex = 0; frameIndex < deepFrames; frameIndex++) {
    if (scene.family === 'fracture') {
      if (frameIndex === Math.floor(deepFrames * 0.10)) { a.setLoadTarget(0.42); b.setLoadTarget(0.42); }
      if (frameIndex === Math.floor(deepFrames * 0.28)) { a.setLoadTarget(0.96); b.setLoadTarget(0.96); }
      if (frameIndex === Math.floor(deepFrames * 0.46)) { a.setLoadTarget(1.38); b.setLoadTarget(1.38); }
      if (frameIndex === Math.floor(deepFrames * 0.60)) { a.setLoadTarget(2); b.setLoadTarget(2); }
      if (frameIndex === Math.floor(deepFrames * 0.68)) {
        a.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
        b.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
      }
      if (frameIndex === Math.floor(deepFrames * 0.76)) { a.explode([0, 5, 0], 42, 20); b.explode([0, 5, 0], 42, 20); }
      if (frameIndex === Math.floor(deepFrames * 0.88)) { a.releaseLoad(); b.releaseLoad(); }
    } else {
      if (frameIndex === Math.floor(deepFrames * 0.15)) { a.kick(20); b.kick(20); }
      if (frameIndex === Math.floor(deepFrames * 0.30)) {
        a.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
        b.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
      }
      if (frameIndex === Math.floor(deepFrames * 0.50)) {
        a.explode([0, 5, 0], 42, 20);
        b.explode([0, 5, 0], 42, 20);
      }
      if (frameIndex === Math.floor(deepFrames * 0.70)) {
        a.spawnRain(120, 14, 24);
        b.spawnRain(120, 14, 24);
      }
    }
    a.step(1 / 60, 4);
    b.step(1 / 60, 4);
    if (frameIndex % 20 === 0 || frameIndex === deepFrames - 1) {
      const frameA = a.buildFrame(false);
      const frameB = b.buildFrame(false);
      inspectFrame(scene, frameA, `${scene.family} deterministic replay A @ ${frameIndex}`);
      inspectFrame(scene, frameB, `${scene.family} deterministic replay B @ ${frameIndex}`);
      assert(frameA.hash === frameB.hash, `${scene.family}: replay hash diverged at frame ${frameIndex}`);
      assert(frameA.brokenCount === frameB.brokenCount, `${scene.family}: break count diverged at frame ${frameIndex}`);
      if (scene.family === 'fracture') {
        assert(JSON.stringify(frameA.material) === JSON.stringify(frameB.material), `fracture: material telemetry diverged at frame ${frameIndex}`);
        assert(frameA.ropeGrid.segmentCount === frameB.ropeGrid.segmentCount, `fracture: active topology diverged at frame ${frameIndex}`);
      }
    }
  }
  summary.deepFrames += deepFrames * 2;
  a.destroy();
  b.destroy();
}

summary.elapsedMs = Math.round((performance.now() - started) * 100) / 100;
console.log(`✅ ${kernelVariant} soft simulation soak passed: ${summary.catalogScenes} scenes, ${summary.catalogFrames.toLocaleString()} catalog frames, ${summary.deepFrames.toLocaleString()} deterministic replay frames`);
console.log(JSON.stringify(summary, null, 2));
