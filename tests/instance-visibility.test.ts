/// <reference path="../src/webgpu-minimal.d.ts" />
import {
  classifyInstanceMaterial, instanceVisibilityAllocation, isCubeVisibleConservative,
  INSTANCE_VISIBILITY_WORKGROUP_SIZE,
} from '../src/webgpu/instance-visibility.js';
import { mat4Identity, mat4LookAt, mat4Multiply, mat4Orthographic, mat4Perspective } from '../src/math.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, label: string): void {
  assert(Object.is(actual, expected), `${label}: expected ${String(expected)}, got ${String(actual)}`);
}
function throws(operation: () => unknown, text: string): void {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes(text), `Expected error containing ${text}, got ${String(caught)}`);
}
let passed = 0;
function test(name: string, operation: () => void): void {
  try { operation(); passed++; }
  catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function model(x: number, y: number, z: number, sx = 1, sy = sx, sz = sx): Float32Array {
  const m = mat4Identity();
  m[0] = sx; m[5] = sy; m[10] = sz; m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/**
 * Independent oracle: enumerate eight actual cube vertices, transform each
 * through model THEN camera, and ask whether every corner is outside any clip
 * half-space. Deliberately does not compose matrices or compute support radii.
 * Run in both double precision and per-operation f32 to cover vertex rounding.
 */
function cornerOracle(m: Float32Array, view: Float32Array, float32 = false): boolean {
  const f = float32 ? Math.fround : (value: number) => value;
  const maxima = new Array<number>(6).fill(-Infinity);
  const transform = (matrix: Float32Array, value: number[]): number[] => {
    const result = [0, 0, 0, 0];
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) result[row] = f(result[row] + f(matrix[column * 4 + row] * value[column]));
    }
    return result;
  };
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const [cx, cy, cz, cw] = transform(view, transform(m, [x, y, z, 1]));
    const distances = [f(cw + cx), f(cw - cx), f(cw + cy), f(cw - cy), cz, f(cw - cz)];
    distances.forEach((distance, plane) => { maxima[plane] = Math.max(maxima[plane], distance); });
  }
  return maxima.every(maximum => maximum >= 0);
}
function checkConservative(m: Float32Array, view: Float32Array, label: string): void {
  const candidate = isCubeVisibleConservative(m, view);
  for (const float32 of [false, true]) {
    if (cornerOracle(m, view, float32)) assert(candidate, `${label}: false cull against ${float32 ? 'f32' : 'double'} corner oracle`);
  }
}
let state = 0x61c88647;
function random(): number {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return (state >>> 0) / 4294967296;
}

test('uses actual unit half-extents and all six WebGPU clip planes', () => {
  const identity = mat4Identity();
  equal(isCubeVisibleConservative(model(1.5, 0, 0.5), identity), true, 'cube extends one unit from center');
  for (const m of [model(-3, 0, 0.5), model(3, 0, 0.5), model(0, -3, 0.5), model(0, 3, 0.5),
    model(0, 0, -2), model(0, 0, 3)]) equal(isCubeVisibleConservative(m, identity), false, 'fully outside plane');
  equal(isCubeVisibleConservative(model(0, 0, -0.25, 0.1), identity), false, 'near clipping is z>=0, not z>=-w');
  equal(isCubeVisibleConservative(model(0, 0, 0.5, 20), identity), true, 'box encloses view despite no corner inside');
});

test('retains exact boundaries, near-plane intersections and degenerate boxes', () => {
  const identity = mat4Identity();
  for (const m of [model(-2, 0, 0.5), model(2, 0, 0.5), model(0, -2, 0.5), model(0, 2, 0.5),
    model(0, 0, -1), model(0, 0, 2), model(1, 1, 0, 0), model(0, 0, 0.5, 0, 1, 1e-30)]) {
    equal(isCubeVisibleConservative(m, identity), true, 'boundary or singular visible');
    checkConservative(m, identity, 'boundary');
  }
  const perspective = mat4Perspective(Math.PI / 2, 1, 0.1, 100);
  checkConservative(model(0, 0, -0.1, 0.05), perspective, 'intersects perspective near plane');
  equal(isCubeVisibleConservative(model(0, 0, 2, 0.1), perspective), false, 'behind camera has negative w');
});

test('camera and light visibility remain independent for off-camera casters', () => {
  const camera = mat4Identity(), light = mat4Identity(), caster = model(8, 0, 0.5, 0.25);
  light[12] = -8;
  equal(isCubeVisibleConservative(caster, camera), false, 'caster is off camera');
  equal(isCubeVisibleConservative(caster, light), true, 'caster remains in light volume');
});

test('random affine boxes never reject the independent corner oracle', () => {
  const view = mat4Multiply(mat4Perspective(1.1, 1.6, 0.05, 150), mat4LookAt([4, 3, 6], [0, 0, -8], [0, 1, 0]));
  const light = mat4Multiply(mat4Orthographic(-12, 12, -9, 9, 0.1, 90), mat4LookAt([9, 20, 12], [0, 0, -12], [0, 1, 0]));
  let culled = 0, visible = 0;
  for (let i = 0; i < 6000; i++) {
    const m = model((random() - 0.5) * 140, (random() - 0.5) * 80, (random() - 0.6) * 180);
    // Independent random columns include shear, reflection, anisotropy and near singularity.
    for (let column = 0; column < 3; column++) {
      const scale = 10 ** (random() * 5 - 3);
      for (let row = 0; row < 3; row++) m[column * 4 + row] = (random() - 0.5) * scale;
    }
    checkConservative(m, view, `random camera ${i}`);
    checkConservative(m, light, `random light ${i}`);
    if (isCubeVisibleConservative(m, view)) visible++; else culled++;
  }
  assert(culled > 1000 && visible > 500, `random suite must exercise both decisions: culled=${culled}, visible=${visible}`);
});

test('large translation cancellation uses absolute product error scale', () => {
  for (const magnitude of [1e4, 1e6, 1e8, 1e10, 1e12, 1e14]) {
    for (let i = 0; i < 80; i++) {
      const m = model(magnitude, -magnitude * 0.5, magnitude * 0.25, 0.01 + random() * 4, 0.05, 0.25);
      m[4] = 1e-6; m[8] = -0.03; m[9] = 0.07;
      const view = mat4Identity();
      view[12] = -m[12]; view[13] = -m[13]; view[14] = -m[14];
      checkConservative(m, view, `large cancellation ${magnitude}:${i}`);
      assert(isCubeVisibleConservative(m, view), 'large cancellation must retain origin-crossing box');
    }
  }
});

test('random near-boundary transformations retain f32 corner visibility', () => {
  const identity = mat4Identity();
  for (let i = 0; i < 3000; i++) {
    const extent = 10 ** (random() * 8 - 6);
    const m = model(1 + extent + (random() - 0.5) * 1e-5, 0, 0.5, extent, extent * 1e-4, extent * 0.25);
    m[4] = (random() - 0.5) * extent;
    m[8] = (random() - 0.5) * extent;
    checkConservative(m, identity, `boundary ${i}`);
  }
});

test('nonfinite and extreme matrices are retained before unsafe arithmetic', () => {
  const identity = mat4Identity();
  for (const value of [NaN, Infinity, -Infinity, 1e20, -1e20]) for (const offset of [0, 3, 5, 12, 15]) {
    const m = model(1e7, 1e7, 1e7, 0.01); m[offset] = value;
    equal(isCubeVisibleConservative(m, identity), true, `uncertain model ${value}:${offset}`);
    equal(isCubeVisibleConservative(identity, m), true, `uncertain view ${value}:${offset}`);
  }
  throws(() => isCubeVisibleConservative(new Float32Array(15), identity), '16 components');
  throws(() => isCubeVisibleConservative(identity, new Float32Array(15)), '16 components');
});

test('material lists match renderer semantics for authored tags and emitters', () => {
  for (let tag = 0; tag <= 30; tag++) {
    const result = classifyInstanceMaterial(-tag), transparent = tag === 4 || tag === 6;
    equal(result.transparent, transparent, `tag ${tag} transparent`);
    equal(result.opaque, !transparent, `tag ${tag} opaque`);
    equal(result.shadow, !transparent, `tag ${tag} shadow`);
  }
  for (const alpha of [0, 0.3, 1, 1.001]) {
    const result = classifyInstanceMaterial(alpha);
    assert(result.opaque && result.shadow && !result.transparent, `positive alpha ${alpha} remains opaque/caster`);
  }
  for (const alpha of [1.002, 1.5, 4, 100]) {
    const result = classifyInstanceMaterial(alpha);
    assert(result.opaque && !result.shadow && !result.transparent, `emitter ${alpha} does not cast`);
  }
});

test('material threshold uncertainty retains original shader decisions', () => {
  for (const boundary of [-3.5, -4.5, -5.5, -6.5]) {
    for (const delta of [0, 1e-7, -1e-7]) {
      const result = classifyInstanceMaterial(boundary + delta);
      assert(result.opaque && result.transparent && result.shadow, `ambiguous tag ${boundary + delta}`);
    }
  }
  for (const alpha of [NaN, Infinity, -Infinity, -4294967296]) {
    const result = classifyInstanceMaterial(alpha);
    assert(result.opaque && result.transparent && result.shadow, `nonrepresentable tag ${alpha}`);
  }
  assert(classifyInstanceMaterial(1.0010005).shadow, 'interpolated emissive boundary stays a candidate');
  equal(classifyInstanceMaterial(-3.5001).opaque, false, 'unambiguous glass lower interval');
  equal(classifyInstanceMaterial(-4.4999).opaque, false, 'unambiguous glass upper interval');
  equal(classifyInstanceMaterial(-4.5001).transparent, false, 'outside glass interval');
});

test('fixed capacity accounts for partial workgroups and all output lists', () => {
  equal(INSTANCE_VISIBILITY_WORKGROUP_SIZE, 64, 'portable workgroup width');
  for (const capacity of [1, 63, 64, 65, 4096, 4097, 32768]) {
    const allocation = instanceVisibilityAllocation(capacity);
    equal(allocation.groups, Math.ceil(capacity / 64), `groups for ${capacity}`);
    equal(allocation.indexBytes, capacity * 4, 'full capacity for each list');
    equal(allocation.metadataBytes, capacity * 16, 'one rank record per source');
    equal(allocation.totalBytes, 192 + capacity * 28 + Math.ceil(capacity / 64) * 32, 'bounded resident bytes');
  }
  for (const capacity of [0, -1, 1.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    throws(() => instanceVisibilityAllocation(capacity), 'positive u32');
  }
});

console.log(`instance visibility: ${passed} tests passed; 6000 random affine + 3000 boundary + 480 cancellation cases`);
