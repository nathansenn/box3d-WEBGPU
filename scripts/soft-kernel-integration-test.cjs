'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { SCENES } = require(path.join(root, '.test-build/src/scenes.js'));
const { SoftSimulationSuite } = require(path.join(root, '.test-build/src/soft/simulations.js'));
const { loadSoftKernels } = require(path.join(root, '.test-build/src/soft/kernels.js'));

async function loadBytes(source) {
  return fs.readFile(path.join(root, 'public', path.basename(String(source))));
}

function finite(values) {
  for (let i = 0; i < values.length; i++) if (!Number.isFinite(values[i])) return false;
  return true;
}

function inspectFrame(scene, frame) {
  assert.equal(frame.kind, scene.family);
  assert.ok(frame.frameVersion > 1);
  assert.ok(finite(frame.matrices.subarray(0, frame.instanceCount * 16)));
  assert.ok(finite(frame.colors.subarray(0, frame.instanceCount * 4)));
  if (scene.family === 'cloth') {
    assert.equal(frame.surface.path, 'gpu-cloth');
    assert.ok(finite(frame.surface.positions));
    assert.ok(finite(frame.surface.restPositions));
  } else if (scene.family === 'water') {
    assert.equal(frame.surface.path, 'gpu-water');
    assert.ok(finite(frame.surface.eta));
    assert.ok(finite(frame.surface.u));
    assert.ok(finite(frame.surface.v));
  } else {
    assert.equal(frame.surface, null);
    assert.ok(frame.instanceCount > 0);
  }
}

async function run() {
  const runtime = await loadSoftKernels({
    simdUrl: 'soft-kernels-simd.wasm',
    scalarUrl: 'soft-kernels-scalar.wasm',
    loadBytes,
  });
  assert.equal(runtime.available, true);
  assert.equal(runtime.variant, 'simd');
  assert.ok(runtime.module);

  const suite = new SoftSimulationSuite(runtime.module);
  for (const sceneId of [600, 650, 700]) {
    const scene = SCENES[sceneId];
    const seed = 0x518000 + sceneId;
    assert.equal(suite.createScene(scene, 4, seed), true);
    for (let frame = 0; frame < 36; frame++) {
      if (frame === 12) suite.kick(9);
      if (frame === 24) suite.explode([0, 5, 0], 14, 9);
      suite.step(1 / 60, 4);
    }
    const first = suite.buildFrame(false);
    inspectFrame(scene, first);
    const hash = suite.hash();

    assert.equal(suite.createScene(scene, 4, seed), true);
    for (let frame = 0; frame < 36; frame++) {
      if (frame === 12) suite.kick(9);
      if (frame === 24) suite.explode([0, 5, 0], 14, 9);
      suite.step(1 / 60, 4);
    }
    inspectFrame(scene, suite.buildFrame(false));
    assert.equal(suite.hash(), hash, `${scene.family} WASM replay must be deterministic`);
  }
  suite.destroy();
  console.log('soft-kernel scene integration: SIMD cloth, rope, and water paths passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
