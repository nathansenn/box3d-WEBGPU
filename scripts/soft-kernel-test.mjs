import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variants = [
  { name: 'simd', marker: 1, file: path.join(root, 'public', 'soft-kernels-simd.wasm') },
  { name: 'scalar', marker: 0, file: path.join(root, 'public', 'soft-kernels-scalar.wasm') },
];

function nearly(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function allocator(exports) {
  exports.soft_reset();
  const memory = exports.memory;
  return {
    f32(values) {
      const input = Float32Array.from(values);
      const pointer = exports.soft_alloc(input.byteLength, 16);
      assert.notEqual(pointer, 0);
      new Float32Array(memory.buffer, pointer, input.length).set(input);
      return { pointer, length: input.length };
    },
    u16(values) {
      const input = Uint16Array.from(values);
      const pointer = exports.soft_alloc(input.byteLength, 2);
      assert.notEqual(pointer, 0);
      new Uint16Array(memory.buffer, pointer, input.length).set(input);
      return { pointer, length: input.length };
    },
    u8(values) {
      const input = Uint8Array.from(values);
      const pointer = exports.soft_alloc(input.byteLength, 1);
      assert.notEqual(pointer, 0);
      new Uint8Array(memory.buffer, pointer, input.length).set(input);
      return { pointer, length: input.length };
    },
    zeroF32(length) {
      const pointer = exports.soft_alloc(length * 4, 16);
      assert.notEqual(pointer, 0);
      new Float32Array(memory.buffer, pointer, length).fill(0);
      return { pointer, length };
    },
    viewF32(slice) {
      return new Float32Array(memory.buffer, slice.pointer, slice.length);
    },
    viewU8(slice) {
      return new Uint8Array(memory.buffer, slice.pointer, slice.length);
    },
  };
}

async function instantiate(file) {
  const bytes = await readFile(file);
  assert.equal(WebAssembly.validate(bytes), true, `${file} is invalid WebAssembly`);
  const compiled = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(compiled), [], `${file} must remain standalone`);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return { bytes, exports: instance.exports };
}

function testAllocatorAndVector(exports, marker) {
  assert.equal(exports.soft_version(), 0x00010100);
  assert.equal(exports.soft_variant(), marker);
  exports.soft_reset();
  const start = exports.soft_heap_offset();
  const a = exports.soft_alloc(3, 1);
  const b = exports.soft_alloc(16, 16);
  assert.equal(a, start);
  assert.equal(b % 16, 0);
  exports.soft_reset();
  assert.equal(exports.soft_alloc(3, 1), start, 'arena reset must be deterministic');

  const arena = allocator(exports);
  const input = arena.f32([1, 2, 3, 4]);
  const output = arena.zeroF32(4);
  exports.soft_vector_add_one(output.pointer, input.pointer);
  assert.deepEqual([...arena.viewF32(output)], [2, 3, 4, 5]);
}

function testClothIntegratedStep(exports) {
  const arena = allocator(exports);
  const positions = arena.f32([0, 1, 0, 2, 0.05, 0]);
  const previous = arena.f32([0, 1, 0, 1.8, 0.05, 0]);
  const inverseMass = arena.f32([0, 1]);
  const zeros = arena.f32([0, 0]);
  const ones = arena.f32([1, 1]);
  const a = arena.u16([0]);
  const b = arena.u16([1]);
  const rest = arena.f32([1]);
  const scaleA = arena.f32([0]);
  const scaleB = arena.f32([1]);
  const broken = arena.u8([0]);

  assert.equal(exports.soft_cloth_integrate(
    positions.pointer,
    previous.pointer,
    inverseMass.pointer,
    zeros.pointer,
    ones.pointer,
    zeros.pointer,
    ones.pointer,
    zeros.pointer,
    ones.pointer,
    ones.pointer,
    2,
    1 / 3600,
    0.99,
    0,
    0,
    1,
    0,
    1,
    0,
    1,
    0.5,
    0,
    0,
  ), 1);
  const projected = exports.soft_cloth_solve(
    positions.pointer,
    previous.pointer,
    inverseMass.pointer,
    a.pointer,
    b.pointer,
    rest.pointer,
    scaleA.pointer,
    scaleB.pointer,
    broken.pointer,
    2,
    1,
    2,
    0.12,
    0.72,
    0,
    -100,
    0,
    0,
  );
  assert.equal(projected, 2);
  const result = arena.viewF32(positions);
  assert.equal(result.every(Number.isFinite), true);
  assert.ok(result[4] >= 0.12);
  nearly(result[0], 0);
  nearly(result[1], 1);
}

function testClothProjection(exports) {
  const arena = allocator(exports);
  const positions = arena.f32([0, 0, 0, 2, 0, 0]);
  const a = arena.u16([0]);
  const b = arena.u16([1]);
  const rest = arena.f32([1]);
  const scaleA = arena.f32([0.5]);
  const scaleB = arena.f32([0.5]);
  const broken = arena.u8([0]);
  const projected = exports.soft_cloth_project(
    positions.pointer,
    a.pointer,
    b.pointer,
    rest.pointer,
    scaleA.pointer,
    scaleB.pointer,
    broken.pointer,
    1,
    1,
  );
  assert.equal(projected, 1);
  const result = arena.viewF32(positions);
  nearly(result[0], 0.5);
  nearly(result[3], 1.5);
  nearly(result[3] - result[0], 1);
}

function testRopeProjectionAndBreaking(exports) {
  const arena = allocator(exports);
  const positions = arena.f32([0, 0, 0, 2, 0, 0]);
  const a = arena.u16([0]);
  const b = arena.u16([1]);
  const rest = arena.f32([1]);
  const invRest = arena.f32([1]);
  const scaleA = arena.f32([0.5]);
  const scaleB = arena.f32([0.5]);
  const broken = arena.u8([0]);
  const render = arena.u8([1]);
  const threshold = arena.f32([1.5]);
  const newBreaks = exports.soft_rope_project(
    positions.pointer,
    a.pointer,
    b.pointer,
    rest.pointer,
    invRest.pointer,
    scaleA.pointer,
    scaleB.pointer,
    broken.pointer,
    render.pointer,
    threshold.pointer,
    1,
    4,
    1,
  );
  assert.equal(newBreaks, 1);
  assert.equal(arena.viewU8(broken)[0], 1);
  assert.deepEqual([...arena.viewF32(positions)], [0, 0, 0, 2, 0, 0]);
}

function runWaterStep(exports) {
  const arena = allocator(exports);
  const cols = 8;
  const rows = 6;
  const count = cols * rows;
  const initialEta = new Float32Array(count);
  initialEta[2 * cols + 3] = 1;
  initialEta[3 * cols + 4] = -0.35;
  const eta = arena.f32(initialEta);
  const u = arena.f32(new Float32Array(count));
  const v = arena.f32(new Float32Array(count));
  const nextEta = arena.zeroF32(count);
  const nextU = arena.zeroF32(count);
  const nextV = arena.zeroF32(count);
  assert.equal(exports.soft_water_step(
    eta.pointer,
    u.pointer,
    v.pointer,
    nextEta.pointer,
    nextU.pointer,
    nextV.pointer,
    cols,
    rows,
    1 / 120,
    9.81,
    1.55,
    0.32,
    0.75,
    0.65,
  ), 1);
  const output = {
    eta: Float32Array.from(arena.viewF32(nextEta)),
    u: Float32Array.from(arena.viewF32(nextU)),
    v: Float32Array.from(arena.viewF32(nextV)),
  };
  for (const array of Object.values(output)) {
    assert.equal(array.every(Number.isFinite), true);
  }
  assert.notEqual(output.u[2 * cols + 2], 0);
  assert.notEqual(output.v[1 * cols + 3], 0);
  assert.ok(Math.abs(output.eta[2 * cols + 3]) <= 1.65);
  return output;
}

const waterOutputs = [];
for (const variant of variants) {
  const { exports } = await instantiate(variant.file);
  testAllocatorAndVector(exports, variant.marker);
  testClothProjection(exports);
  testClothIntegratedStep(exports);
  testRopeProjectionAndBreaking(exports);
  waterOutputs.push(runWaterStep(exports));
  console.log(`soft kernels (${variant.name}): core numerical tests passed`);
}

for (const field of ['eta', 'u', 'v']) {
  const simd = waterOutputs[0][field];
  const scalar = waterOutputs[1][field];
  assert.equal(simd.length, scalar.length);
  for (let i = 0; i < simd.length; i++) {
    nearly(simd[i], scalar[i], 2e-6);
  }
}

// Exercise the public async loader, including SIMD preference, scalar fallback,
// and the non-fatal JavaScript fallback state.
const ts = await import('typescript');
const loaderSource = await readFile(path.join(root, 'src', 'soft', 'kernels.ts'), 'utf8');
const loaderJavaScript = ts.transpileModule(loaderSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
// Import the transpiled loader from a temporary file. Very large data: URLs
// can trigger pathological module-loader behavior in current Node releases.
const loaderDirectory = await mkdtemp(path.join(tmpdir(), 'box3d-soft-loader-'));
const loaderPath = path.join(loaderDirectory, 'kernels.mjs');
await writeFile(loaderPath, loaderJavaScript);
const loader = await import(pathToFileURL(loaderPath).href);
const byteMap = new Map(await Promise.all(variants.map(async (variant) => {
  const bytes = await readFile(variant.file);
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return [variant.name, exact];
})));
assert.equal(loader.getSoftKernelRuntime().variant, 'javascript');
assert.equal(loader.getActiveSoftKernelModule(), null);
const preferred = await loader.initializeSoftKernelRuntime({
  simdUrl: 'simd',
  scalarUrl: 'scalar',
  loadBytes: async (source) => byteMap.get(String(source)),
});
assert.equal(preferred.available, true);
assert.equal(preferred.variant, 'simd');
assert.ok(preferred.module);
assert.equal(loader.getSoftKernelRuntime(), preferred);
assert.equal(loader.getActiveSoftKernelModule(), preferred.module);

const scalarFallback = await loader.loadSoftKernels({
  simdUrl: 'bad-simd',
  scalarUrl: 'scalar',
  loadBytes: async (source) => {
    if (String(source) === 'bad-simd') throw new Error('simulated SIMD rejection');
    return byteMap.get(String(source));
  },
});
assert.equal(scalarFallback.available, true);
assert.equal(scalarFallback.variant, 'scalar');

const javascriptFallback = await loader.loadSoftKernels({
  loadBytes: async () => { throw new Error('simulated unavailable WebAssembly'); },
});
assert.equal(javascriptFallback.available, false);
assert.equal(javascriptFallback.variant, 'javascript');
assert.match(javascriptFallback.reason, /SIMD:.*scalar:/);

await rm(loaderDirectory, { recursive: true, force: true });

console.log('soft kernels: SIMD/scalar parity and loader fallback tests passed');
