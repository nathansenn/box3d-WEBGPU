'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(process.argv[2]);
const variant = process.argv[3];
const workloadId = process.argv[4];
const build = path.join(root, '.test-build');
const { SCENES } = require(path.join(build, 'src/scenes.js'));
const { SoftSimulationSuite } = require(path.join(build, 'src/soft/simulations.js'));
const wasmModule = new WebAssembly.Module(fs.readFileSync(path.join(root, 'public/soft-kernels-simd.wasm')));
const currentKernelPath = path.join(build, 'src/soft/kernels.js');
let createSuite;
let unifiedSurface;
if (fs.existsSync(currentKernelPath)) {
  const { SoftKernelModule } = require(currentKernelPath);
  unifiedSurface = true;
  createSuite = () => {
    // A suite owns its WASM memory. Sharing an instance across the mixed
    // workload would let a later arena reset overwrite an earlier scene.
    const instance = new WebAssembly.Instance(wasmModule, {});
    return new SoftSimulationSuite(new SoftKernelModule('simd', instance.exports));
  };
} else {
  // Preserve the bundled v1.8 global-install/no-argument construction path.
  const kernels = require(path.join(build, 'src/soft/wasm-kernels.js'));
  kernels.installSoftKernelModule(wasmModule, `${variant}-simd`);
  unifiedSurface = false;
  createSuite = () => new SoftSimulationSuite();
}

const definitions = {
  'cloth-cargo-full': { sceneIds: [643], warmup: 20, iterations: 150, operation: 'full' },
  'cloth-membrane-full': { sceneIds: [649], warmup: 20, iterations: 135, operation: 'full' },
  'cloth-membrane-storm': { sceneIds: [649], warmup: 8, iterations: 75, operation: 'full', rain: 72 },
  'rope-maximum-frame': { sceneIds: [699], warmup: 32, iterations: 5000, operation: 'frame' },
  'rope-maximum-full': { sceneIds: [699], warmup: 16, iterations: 150, operation: 'full' },
  'rope-maximum-storm': { sceneIds: [699], warmup: 7, iterations: 80, operation: 'full', rain: 96 },
  'mixed-maximum': { sceneIds: [649, 699, 749], warmup: 14, iterations: 95, operation: 'full' },
  'cloth-tearing-control': { sceneIds: [646], warmup: 14, iterations: 85, operation: 'full' },
  'water-maximum-control': { sceneIds: [749], warmup: 20, iterations: 280, operation: 'full' },
  'cloth-regular-control': { sceneIds: [608], warmup: 18, iterations: 125, operation: 'full' },
};
const definition = definitions[workloadId];
if (!definition) throw new Error(`unknown workload ${workloadId}`);
const workloadScale = Math.max(0.01, Number(process.env.V19_WORKER_SCALE || '1'));
const warmupIterations = Math.max(1, Math.round(definition.warmup * workloadScale));
const timedIterations = Math.max(1, Math.round(definition.iterations * workloadScale));

const suites = definition.sceneIds.map((sceneId) => {
  const suite = createSuite();
  if (!suite.createScene(SCENES[sceneId], 5, 0x191900 + sceneId)) {
    throw new Error(`failed to create scene ${sceneId}`);
  }
  if (definition.rain) suite.spawnRain(definition.rain, 14, 24);
  return suite;
});

function operation() {
  for (const suite of suites) {
    if (definition.operation === 'frame') {
      suite.active.frameDirty = true;
      suite.buildFrame(false);
    } else if (definition.operation === 'step') {
      suite.step(1 / 60, 4);
    } else {
      suite.step(1 / 60, 4);
      suite.buildFrame(false);
    }
  }
}

for (let i = 0; i < warmupIterations; i++) operation();
global.gc?.();
const started = performance.now();
for (let i = 0; i < timedIterations; i++) operation();
const elapsedMs = performance.now() - started;

function concatFloat32(arrays) {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const array of arrays) { out.set(array, offset); offset += array.length; }
  return out;
}

function reconstructRope(frame) {
  if (!frame.ropeGrid) {
    return {
      matrices: Float32Array.from(frame.matrices.subarray(0, frame.instanceCount * 16)),
      colors: Float32Array.from(frame.colors.subarray(0, frame.instanceCount * 4)),
      count: frame.instanceCount,
    };
  }
  const grid = frame.ropeGrid;
  const total = grid.segmentCount + frame.instanceCount;
  const matrices = new Float32Array(total * 16);
  const colors = new Float32Array(total * 4);
  const positions = grid.positions;
  const segments = grid.segments;
  for (let i = 0; i < grid.segmentCount; i++) {
    const so = i * 8;
    const a = segments[so] | 0;
    const b = segments[so + 1] | 0;
    const ao = a * 3;
    const bo = b * 3;
    const ax = positions[ao]; const ay = positions[ao + 1]; const az = positions[ao + 2];
    const bx = positions[bo]; const by = positions[bo + 1]; const bz = positions[bo + 2];
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const rawLength = lengthSquared > 0 ? Math.sqrt(lengthSquared) : 0;
    const length = Math.max(rawLength, 0.0001);
    const yx = dx / length; const yy = dy / length; const yz = dz / length;
    let xx; let xy; let xz;
    if (Math.abs(yy) < 0.92) { xx = yz; xy = 0; xz = -yx; }
    else { xx = -yy; xy = yx; xz = 0; }
    const xLength = Math.max(Math.sqrt(xx * xx + xy * xy + xz * xz), 0.000001);
    xx /= xLength; xy /= xLength; xz /= xLength;
    const zx = yy * xz - yz * xy;
    const zy = yz * xx - yx * xz;
    const zz = yx * xy - yy * xx;
    const tension = Math.max(0, Math.min(1, (rawLength * segments[so + 2] - 1) * 4.2));
    const radius = segments[so + 3] * (1 - tension * 0.2);
    const mo = i * 16;
    matrices[mo] = xx * radius; matrices[mo + 1] = xy * radius; matrices[mo + 2] = xz * radius;
    matrices[mo + 4] = yx * length * 0.5; matrices[mo + 5] = yy * length * 0.5; matrices[mo + 6] = yz * length * 0.5;
    matrices[mo + 8] = zx * radius; matrices[mo + 9] = zy * radius; matrices[mo + 10] = zz * radius;
    matrices[mo + 12] = (ax + bx) * 0.5; matrices[mo + 13] = (ay + by) * 0.5; matrices[mo + 14] = (az + bz) * 0.5; matrices[mo + 15] = 1;
    const co = i * 4;
    colors[co] = segments[so + 4] + (1 - segments[so + 4]) * tension;
    colors[co + 1] = segments[so + 5] + (0.06 - segments[so + 5]) * tension;
    colors[co + 2] = segments[so + 6] + (0.02 - segments[so + 6]) * tension;
    colors[co + 3] = segments[so + 7] + (2.2 - segments[so + 7]) * tension;
  }
  matrices.set(frame.matrices.subarray(0, frame.instanceCount * 16), grid.segmentCount * 16);
  colors.set(frame.colors.subarray(0, frame.instanceCount * 4), grid.segmentCount * 4);
  return { matrices, colors, count: total };
}

let combinedHash = 2166136261 >>> 0;
let nodes = 0;
let constraints = 0;
let instances = 0;
let dynamicBytes = 0;
const states = [];
const ropeMatrices = [];
const ropeColors = [];
for (const suite of suites) {
  const frame = suite.buildFrame(false);
  const active = suite.active;
  const state = active.kind === 'water' ? active.eta : active.positions;
  states.push(Float32Array.from(state));
  combinedHash ^= suite.hash();
  combinedHash = Math.imul(combinedHash, 16777619) >>> 0;
  nodes += frame.nodeCount;
  constraints += frame.constraintCount;
  const rope = reconstructRope(frame);
  instances += rope.count;
  if (active.kind === 'rope') {
    ropeMatrices.push(rope.matrices);
    ropeColors.push(rope.colors);
    dynamicBytes += frame.ropeGrid
      ? frame.ropeGrid.nodeCount * 12 + frame.instanceCount * 80
      : frame.instanceCount * 80;
  } else if (unifiedSurface) {
    if (frame.surface?.path === 'gpu-cloth' || frame.surface?.path === 'gpu-water') {
      dynamicBytes += frame.surface.vertexCount * 12;
    } else if (frame.surface?.path === 'packed') {
      dynamicBytes += frame.surface.vertexCount * frame.surface.vertexStride;
    }
  } else {
    // Preserve the historical v1.8 accounting contract exactly.
    if (frame.clothGrid) {
      dynamicBytes += frame.clothGrid.vertexCount * (frame.clothGrid.restPositions ? 12 : 16);
    } else if (frame.waterGrid) {
      dynamicBytes += frame.waterGrid.vertexCount * 12;
    } else if (frame.surface) {
      dynamicBytes += frame.surface.vertexCount * frame.surface.vertexStride;
    }
  }
}
const state = concatFloat32(states);
const matrices = concatFloat32(ropeMatrices);
const colors = concatFloat32(ropeColors);

process.stdout.write(JSON.stringify({
  variant,
  workloadId,
  elapsedMs,
  iterations: timedIterations,
  msPerOperation: elapsedMs / timedIterations,
  hash: combinedHash >>> 0,
  nodes,
  constraints,
  instances,
  dynamicBytes,
  state: Buffer.from(state.buffer, state.byteOffset, state.byteLength).toString('base64'),
  matrices: Buffer.from(matrices.buffer, matrices.byteOffset, matrices.byteLength).toString('base64'),
  colors: Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength).toString('base64'),
}));
