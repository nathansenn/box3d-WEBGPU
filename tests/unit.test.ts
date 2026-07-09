function ok(value: unknown, message = 'assertion failed'): void {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `expected ${a} to deepEqual ${b}`);
}

import { isFiniteArray, mat4Identity, mat4Multiply, writeModelMatrixFromEuler } from '../src/math';
import { FallbackPhysicsBackend } from '../src/physics/fallback';
import { FEATURED_SCENE_IDS, SCENES, SCENE_CATEGORIES, sceneLabel } from '../src/scenes';

function approx(a: number, b: number, eps = 1e-5): void {
  ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}

function testMath(): void {
  const id = mat4Identity();
  const model = new Float32Array(16);
  writeModelMatrixFromEuler(model, 0, [1, 2, 3], [0, 0, 0], [2, 3, 4]);
  const result = mat4Multiply(id, model);
  for (let i = 0; i < 16; i++) approx(result[i], model[i]);
  approx(model[0], 2);
  approx(model[5], 3);
  approx(model[10], 4);
  approx(model[12], 1);
  approx(model[13], 2);
  approx(model[14], 3);
}

function testSceneCatalog(): void {
  equal(SCENES.length, 600);
  equal(FEATURED_SCENE_IDS.length, 24);
  const ids = new Set(SCENES.map((scene) => scene.id));
  equal(ids.size, SCENES.length);
  deepEqual([...ids].slice(0, 5), [0, 1, 2, 3, 4]);
  deepEqual([...ids].slice(-5), [595, 596, 597, 598, 599]);
  for (const category of SCENE_CATEGORIES) {
    ok(SCENES.some((scene) => scene.category === category), `${category} should have scenes`);
  }
  for (const scene of SCENES) {
    ok(sceneLabel(scene).startsWith(String(scene.id + 1).padStart(3, '0')));
    ok(scene.title.length > 5);
    ok(scene.defaultStress >= 1 && scene.defaultStress <= 5);
    ok(scene.variant >= 0 && scene.variant < 10);
    ok(scene.tags.length >= 4);
  }
}

function testFallbackCanCreateEveryScene(): void {
  const backend = new FallbackPhysicsBackend(4096);
  for (const scene of SCENES) {
    const count = backend.createScene(scene, 1, 0x1234 + scene.id);
    ok(count > 0, `${scene.title} should create bodies`);
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 24) * 16);
    ok(isFiniteArray(matrices), `${scene.title} produced non-finite matrices`);
    ok(backend.replayHash() !== 0, `${scene.title} hash should update`);
  }
}

function testFeaturedScenesStep(): void {
  const backend = new FallbackPhysicsBackend(4096);
  for (const id of FEATURED_SCENE_IDS) {
    const scene = SCENES[id];
    ok(scene, `featured scene ${id} should exist`);
    backend.createScene(scene, 1, 0x5000 + id);
    for (let i = 0; i < 3; i++) backend.step(1 / 60, 1);
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 32) * 16);
    ok(isFiniteArray(matrices), `${scene.title} stepped into invalid matrices`);
  }
}

function testDeterminism(): void {
  const scene = SCENES[23];
  const a = new FallbackPhysicsBackend(4096);
  const b = new FallbackPhysicsBackend(4096);
  a.createScene(scene, 2, 0xbeef);
  b.createScene(scene, 2, 0xbeef);
  for (let i = 0; i < 12; i++) {
    a.step(1 / 60, 2);
    b.step(1 / 60, 2);
  }
  equal(a.replayHash(), b.replayHash(), 'same seed replay hash should match');
}

function testActions(): void {
  const backend = new FallbackPhysicsBackend(4096);
  backend.createScene(SCENES[0], 1, 0xcafe);
  const before = backend.bodyCount();
  backend.kick(6);
  backend.explode(0, 3, 0, 12, 8);
  const projectile = backend.launchProjectile(-10, 5, 0, 12, 0, 0, 0.5);
  ok(projectile >= 0, 'projectile should spawn');
  const rain = backend.spawnRain(20, 4, 8);
  equal(rain, 20);
  equal(backend.bodyCount(), before + 21);
  backend.step(1 / 60, 2);
  ok(backend.replayHash() !== 0);
}

const tests = [
  testMath,
  testSceneCatalog,
  testFallbackCanCreateEveryScene,
  testFeaturedScenesStep,
  testDeterminism,
  testActions,
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}

console.log(`All ${tests.length} unit suites passed.`);
