"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function ok(value, message = 'assertion failed') {
    if (!value)
        throw new Error(message);
}
function equal(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
    }
}
function deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(message ?? `expected ${a} to deepEqual ${b}`);
}
const math_1 = require("../src/math");
const effects_1 = require("../src/effects");
const fallback_1 = require("../src/physics/fallback");
const scenes_1 = require("../src/scenes");
const showcases_1 = require("../src/showcases");
function approx(a, b, eps = 1e-5) {
    ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}
function testMath() {
    const id = (0, math_1.mat4Identity)();
    const model = new Float32Array(16);
    (0, math_1.writeModelMatrixFromEuler)(model, 0, [1, 2, 3], [0, 0, 0], [2, 3, 4]);
    const result = (0, math_1.mat4Multiply)(id, model);
    for (let i = 0; i < 16; i++)
        approx(result[i], model[i]);
    approx(model[0], 2);
    approx(model[5], 3);
    approx(model[10], 4);
    approx(model[12], 1);
    approx(model[13], 2);
    approx(model[14], 3);
    const perspective = (0, math_1.mat4Perspective)(Math.PI / 3, 16 / 9, 0.08, 360);
    const orthographic = (0, math_1.mat4Orthographic)(-50, 50, -30, 30, 0.1, 190);
    ok((0, math_1.isFiniteArray)(perspective), 'perspective matrix must be finite');
    ok((0, math_1.isFiniteArray)(orthographic), 'orthographic matrix must be finite');
    ok(perspective[0] > 0 && perspective[5] > 0, 'perspective focal terms must be positive');
    ok(orthographic[0] > 0 && orthographic[5] > 0, 'orthographic scale terms must be positive');
}
function testSceneCatalog() {
    equal(scenes_1.SCENES.length, 600);
    equal(scenes_1.FEATURED_SCENE_IDS.length, 24);
    const ids = new Set(scenes_1.SCENES.map((scene) => scene.id));
    equal(ids.size, scenes_1.SCENES.length);
    deepEqual([...ids].slice(0, 5), [0, 1, 2, 3, 4]);
    deepEqual([...ids].slice(-5), [595, 596, 597, 598, 599]);
    for (const category of scenes_1.SCENE_CATEGORIES) {
        ok(scenes_1.SCENES.some((scene) => scene.category === category), `${category} should have scenes`);
    }
    for (const scene of scenes_1.SCENES) {
        ok((0, scenes_1.sceneLabel)(scene).startsWith(String(scene.id + 1).padStart(3, '0')));
        ok(scene.title.length > 5);
        ok(scene.defaultStress >= 1 && scene.defaultStress <= 5);
        ok(scene.variant >= 0 && scene.variant < 10);
        ok(scene.tags.length >= 4);
        ok(scene.camera.pitch >= 0.08 && scene.camera.pitch <= 1.3, `${scene.title} camera elevation must remain above the scene`);
        const cameraEyeY = scene.camera.target[1] + Math.sin(scene.camera.pitch) * scene.camera.distance;
        ok(cameraEyeY > scene.camera.target[1], `${scene.title} camera eye must be above its target`);
    }
}
function testHeroShowcaseCatalog() {
    equal(showcases_1.AAA_SHOWCASES.length, 24);
    const ids = new Set(showcases_1.AAA_SHOWCASES.map((showcase) => showcase.id));
    equal(ids.size, showcases_1.AAA_SHOWCASES.length, 'showcase IDs must be unique');
    for (let i = 0; i < showcases_1.AAA_SHOWCASES.length; i++) {
        const showcase = showcases_1.AAA_SHOWCASES[i];
        ok(scenes_1.SCENES.some((scene) => scene.id === showcase.sceneId), `${showcase.title} must reference a valid scene`);
        ok(showcase.title.length > 8);
        ok(showcase.tagline.length > 24);
        ok(showcase.objective.length > 32);
        ok(showcase.duration >= 12);
        ok(showcase.cameraTrack.length >= 5);
        ok(showcase.beats.length >= 6);
        ok(showcase.beats.every((beat, index) => index === 0 || beat.at >= showcase.beats[index - 1].at), `${showcase.title} beats must be sorted`);
        ok(showcase.cameraTrack.every((key, index) => index === 0 || key.at >= showcase.cameraTrack[index - 1].at), `${showcase.title} camera keys must be sorted`);
        for (const time of [0, showcase.duration * 0.25, showcase.duration * 0.5, showcase.duration * 0.75, showcase.duration]) {
            const camera = (0, showcases_1.sampleShowcaseCamera)(showcase, time);
            ok(Number.isFinite(camera.yaw + camera.pitch + camera.distance + camera.target[0] + camera.target[1] + camera.target[2]), `${showcase.title} camera must be finite`);
            ok(camera.distance >= 8, `${showcase.title} camera distance must remain usable`);
            ok(camera.pitch >= 0.08 && camera.pitch <= 1.3, `${showcase.title} camera elevation must remain above the scene`);
            const eyeY = camera.target[1] + Math.sin(camera.pitch) * camera.distance;
            ok(eyeY > camera.target[1], `${showcase.title} camera eye must be above its target`);
        }
        equal((0, showcases_1.getShowcaseById)(showcase.id).id, showcase.id);
        equal((0, showcases_1.getShowcaseByOrdinal)(i + showcases_1.AAA_SHOWCASES.length).id, showcase.id);
    }
}
function testFallbackCanCreateEveryScene() {
    const backend = new fallback_1.FallbackPhysicsBackend(4096);
    for (const scene of scenes_1.SCENES) {
        const count = backend.createScene(scene, 1, 0x1234 + scene.id);
        ok(count > 0, `${scene.title} should create bodies`);
        const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
        const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 24) * 16);
        ok((0, math_1.isFiniteArray)(matrices), `${scene.title} produced non-finite matrices`);
        ok(backend.replayHash() !== 0, `${scene.title} hash should update`);
    }
}
function testAAACinematicSetDressing() {
    const baseline = new fallback_1.FallbackPhysicsBackend(4096);
    const cinematic = new fallback_1.FallbackPhysicsBackend(4096);
    const baselineCount = baseline.createScene(scenes_1.SCENES[0], 1, 0x4141);
    const cinematicCount = cinematic.createScene(scenes_1.SCENES[40], 1, 0x4141);
    ok(cinematicCount > baselineCount, `AAA scene should add authored set dressing (${cinematicCount} > ${baselineCount})`);
    for (const showcase of showcases_1.AAA_SHOWCASES) {
        const scene = scenes_1.SCENES[showcase.sceneId];
        const count = cinematic.createScene(scene, showcase.recommendedStress, 0x7000 + scene.id);
        ok(count > 10, `${showcase.title} should create a substantial hero scene`);
        cinematic.step(1 / 60, 2);
        const start = Number(cinematic._b3w_matrices_ptr()) / 4;
        ok((0, math_1.isFiniteArray)(cinematic.HEAPF32.subarray(start, start + Math.min(48, count) * 16)), `${showcase.title} matrices must remain finite`);
    }
}
function testFeaturedScenesStep() {
    const backend = new fallback_1.FallbackPhysicsBackend(4096);
    for (const id of scenes_1.FEATURED_SCENE_IDS) {
        const scene = scenes_1.SCENES[id];
        ok(scene, `featured scene ${id} should exist`);
        backend.createScene(scene, 1, 0x5000 + id);
        for (let i = 0; i < 3; i++)
            backend.step(1 / 60, 1);
        const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
        const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 32) * 16);
        ok((0, math_1.isFiniteArray)(matrices), `${scene.title} stepped into invalid matrices`);
    }
}
function testDeterminism() {
    const scene = scenes_1.SCENES[40];
    const a = new fallback_1.FallbackPhysicsBackend(4096);
    const b = new fallback_1.FallbackPhysicsBackend(4096);
    a.createScene(scene, 2, 0xbeef);
    b.createScene(scene, 2, 0xbeef);
    for (let i = 0; i < 12; i++) {
        a.step(1 / 60, 2);
        b.step(1 / 60, 2);
    }
    equal(a.replayHash(), b.replayHash(), 'same seed AAA replay hash should match');
}
function testCinematicEffects() {
    const effects = new effects_1.CinematicEffects();
    effects.clear(0x515151);
    effects.spawnExplosion([0, 3, 0], 18, 512);
    effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], 512);
    effects.spawnImpulseDust([0, 0.2, 0], 10, 512);
    effects.spawnRainFlash([0, 16, 0], 512);
    ok(effects.particleCount() >= 100, 'cinematic events should create a meaningful effect field');
    const before = effects.buildFrame(512);
    ok(before.count > 0);
    ok((0, math_1.isFiniteArray)(before.matrices));
    ok((0, math_1.isFiniteArray)(before.colors));
    ok(before.debugLines.length >= 72, 'explosion should create a shockwave ring');
    ok(before.colors.some((value, index) => index % 4 === 3 && value > 1), 'effects should carry emissive material tags');
    effects.update(1 / 60);
    const after = effects.buildFrame(256);
    ok(after.count <= 256, 'effect frame must honor render budget');
    ok((0, math_1.isFiniteArray)(after.matrices));
    const shake = effects.cameraShake();
    ok(Number.isFinite(shake.yaw + shake.pitch + shake.targetOffset[0] + shake.targetOffset[1] + shake.targetOffset[2]));
}
function testActions() {
    const backend = new fallback_1.FallbackPhysicsBackend(4096);
    backend.createScene(scenes_1.SCENES[40], 1, 0xcafe);
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
