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

import {
  isFiniteArray,
  mat4Identity,
  mat4Multiply,
  mat4Orthographic,
  mat4Perspective,
  writeModelMatrixFromEuler,
} from '../src/math';
import { CinematicEffects } from '../src/effects';
import { FallbackPhysicsBackend } from '../src/physics/fallback';
import { FEATURED_SCENE_IDS, SCENES, SCENE_CATEGORIES, sceneLabel } from '../src/scenes';
import { AAA_SHOWCASES, getShowcaseById, getShowcaseByOrdinal, sampleShowcaseCamera } from '../src/showcases';

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

  const perspective = mat4Perspective(Math.PI / 3, 16 / 9, 0.08, 360);
  const orthographic = mat4Orthographic(-50, 50, -30, 30, 0.1, 190);
  ok(isFiniteArray(perspective), 'perspective matrix must be finite');
  ok(isFiniteArray(orthographic), 'orthographic matrix must be finite');
  ok(perspective[0] > 0 && perspective[5] > 0, 'perspective focal terms must be positive');
  ok(orthographic[0] > 0 && orthographic[5] > 0, 'orthographic scale terms must be positive');
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
    ok(scene.camera.pitch >= 0.08 && scene.camera.pitch <= 1.3, `${scene.title} camera elevation must remain above the scene`);
    const cameraEyeY = scene.camera.target[1] + Math.sin(scene.camera.pitch) * scene.camera.distance;
    ok(cameraEyeY > scene.camera.target[1], `${scene.title} camera eye must be above its target`);
  }
}

function testHeroShowcaseCatalog(): void {
  equal(AAA_SHOWCASES.length, 24);
  const ids = new Set(AAA_SHOWCASES.map((showcase) => showcase.id));
  equal(ids.size, AAA_SHOWCASES.length, 'showcase IDs must be unique');

  for (let i = 0; i < AAA_SHOWCASES.length; i++) {
    const showcase = AAA_SHOWCASES[i];
    ok(SCENES.some((scene) => scene.id === showcase.sceneId), `${showcase.title} must reference a valid scene`);
    ok(showcase.title.length > 8);
    ok(showcase.tagline.length > 24);
    ok(showcase.objective.length > 32);
    ok(showcase.duration >= 12);
    ok(showcase.cameraTrack.length >= 5);
    ok(showcase.beats.length >= 6);
    ok(showcase.beats.every((beat, index) => index === 0 || beat.at >= showcase.beats[index - 1].at), `${showcase.title} beats must be sorted`);
    ok(showcase.cameraTrack.every((key, index) => index === 0 || key.at >= showcase.cameraTrack[index - 1].at), `${showcase.title} camera keys must be sorted`);

    for (const time of [0, showcase.duration * 0.25, showcase.duration * 0.5, showcase.duration * 0.75, showcase.duration]) {
      const camera = sampleShowcaseCamera(showcase, time);
      ok(Number.isFinite(camera.yaw + camera.pitch + camera.distance + camera.target[0] + camera.target[1] + camera.target[2]), `${showcase.title} camera must be finite`);
      ok(camera.distance >= 8, `${showcase.title} camera distance must remain usable`);
      ok(camera.pitch >= 0.08 && camera.pitch <= 1.3, `${showcase.title} camera elevation must remain above the scene`);
      const eyeY = camera.target[1] + Math.sin(camera.pitch) * camera.distance;
      ok(eyeY > camera.target[1], `${showcase.title} camera eye must be above its target`);
    }

    equal(getShowcaseById(showcase.id).id, showcase.id);
    equal(getShowcaseByOrdinal(i + AAA_SHOWCASES.length).id, showcase.id);
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

function testAAACinematicSetDressing(): void {
  const baseline = new FallbackPhysicsBackend(4096);
  const cinematic = new FallbackPhysicsBackend(4096);
  const baselineCount = baseline.createScene(SCENES[0], 1, 0x4141);
  const cinematicCount = cinematic.createScene(SCENES[40], 1, 0x4141);
  ok(cinematicCount > baselineCount, `AAA scene should add authored set dressing (${cinematicCount} > ${baselineCount})`);

  for (const showcase of AAA_SHOWCASES) {
    const scene = SCENES[showcase.sceneId];
    const count = cinematic.createScene(scene, showcase.recommendedStress, 0x7000 + scene.id);
    ok(count > 10, `${showcase.title} should create a substantial hero scene`);
    cinematic.step(1 / 60, 2);
    const start = Number(cinematic._b3w_matrices_ptr()) / 4;
    ok(isFiniteArray(cinematic.HEAPF32.subarray(start, start + Math.min(48, count) * 16)), `${showcase.title} matrices must remain finite`);
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
  const scene = SCENES[40];
  const a = new FallbackPhysicsBackend(4096);
  const b = new FallbackPhysicsBackend(4096);
  a.createScene(scene, 2, 0xbeef);
  b.createScene(scene, 2, 0xbeef);
  for (let i = 0; i < 12; i++) {
    a.step(1 / 60, 2);
    b.step(1 / 60, 2);
  }
  equal(a.replayHash(), b.replayHash(), 'same seed AAA replay hash should match');
}

function testCinematicEffects(): void {
  const effects = new CinematicEffects();
  effects.clear(0x515151);
  effects.spawnExplosion([0, 3, 0], 18, 512);
  effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], 512);
  effects.spawnImpulseDust([0, 0.2, 0], 10, 512);
  effects.spawnRainFlash([0, 16, 0], 512);
  ok(effects.particleCount() >= 100, 'cinematic events should create a meaningful effect field');

  const before = effects.buildFrame(512);
  ok(before.count > 0);
  ok(isFiniteArray(before.matrices));
  ok(isFiniteArray(before.colors));
  ok(before.debugLines.length >= 72, 'explosion should create a shockwave ring');
  ok(before.colors.some((value, index) => index % 4 === 3 && value > 1), 'effects should carry emissive material tags');

  effects.update(1 / 60);
  const after = effects.buildFrame(256);
  ok(after.count <= 256, 'effect frame must honor render budget');
  ok(isFiniteArray(after.matrices));
  const shake = effects.cameraShake();
  ok(Number.isFinite(shake.yaw + shake.pitch + shake.targetOffset[0] + shake.targetOffset[1] + shake.targetOffset[2]));
}

function testActions(): void {
  const backend = new FallbackPhysicsBackend(4096);
  backend.createScene(SCENES[40], 1, 0xcafe);
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
  testHeroShowcaseCatalog,
  testFallbackCanCreateEveryScene,
  testAAACinematicSetDressing,
  testFeaturedScenesStep,
  testDeterminism,
  testCinematicEffects,
  testActions,
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}

console.log(`All ${tests.length} unit suites passed.`);
