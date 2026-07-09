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
const fallback_1 = require("../src/physics/fallback");
const scenes_1 = require("../src/scenes");
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
    const scene = scenes_1.SCENES[23];
    const a = new fallback_1.FallbackPhysicsBackend(4096);
    const b = new fallback_1.FallbackPhysicsBackend(4096);
    a.createScene(scene, 2, 0xbeef);
    b.createScene(scene, 2, 0xbeef);
    for (let i = 0; i < 12; i++) {
        a.step(1 / 60, 2);
        b.step(1 / 60, 2);
    }
    equal(a.replayHash(), b.replayHash(), 'same seed replay hash should match');
}
function testActions() {
    const backend = new fallback_1.FallbackPhysicsBackend(4096);
    backend.createScene(scenes_1.SCENES[0], 1, 0xcafe);
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
