// Native defects found by fuzzing (docs/ROBUSTNESS.md, ND-1 to ND-5), fixed in the C bridge (wasm/box3d_web.c) and
// checked here on the shipped artifact through the kit's own NativeWorldBackend. Each test is the defect's report
// turned into a requirement.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {NativeWorldPool} from '../dist/core/native-world.js';

const wasm = name => fileURLToPath(new URL(`../wasm/${name}`, import.meta.url));
const {default: factory} = await import(wasm('box3d.js'));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(wasm('box3d.wasm'))}));
const finite = values => values.every(Number.isFinite);

test('ND-1: a dynamic convex shape above 1 km is refused by the bridge, so the step that used to loop for ever returns', () => {
  // In a child process with a time limit, through the raw export the fuzzer used (a 5 km cube resting in the ground).
  const script = `
    import {readFile} from 'node:fs/promises';
    import {NativeWorldPool} from ${JSON.stringify(new URL('../dist/core/native-world.js', import.meta.url).href)};
    const {default: factory} = await import(${JSON.stringify(new URL('../wasm/box3d.js', import.meta.url).href)});
    const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(${JSON.stringify(wasm('box3d.wasm'))})}));
    const world = pool.createWorld();
    world.resetWorld({ground: true});
    const token = world.mod._b3w_world_launch_projectile_handle(world.handle, 0, 6, 0, 0, 0, 0, 5000);
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    console.log('returned', String(token));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {timeout: 60000, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.error?.code, undefined, `the steps did not return within 60 s (${child.error?.code})`);
  assert.match(child.stdout, /returned 0/, `the 5 km cube is refused: ${child.stdout}${child.stderr}`);
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const refused = (shape, label) => assert.throws(() => world.createBody({shape, position: [0, 6, 0]}), error => error.code === 'INVALID_PAYLOAD', label);
    refused({kind: 'box', halfExtents: [1001, 1, 1]}, 'a dynamic box half extent above 1 km');
    refused({kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1500]}, 'a dynamic hull point 1.5 km from the body origin');
    refused({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [2000, 1, 1]}}]}, 'a dynamic compound box child above 1 km');
    refused({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [1200, 0, 0]}]}, 'a dynamic compound box child 1.2 km from the body origin');
    assert.equal(world.launchProjectileBody(0, 6, 0, 0, 0, 0, 5000), null, 'the projectile export');
    // Static and kinematic bodies of any size are fine: a 20 km road and a 5 km kinematic slab, with boxes landing on them.
    const road = world.createBody({shape: {kind: 'box', halfExtents: [20000, 1, 20000]}, type: 'static', position: [0, -1, 0]});
    world.createBody({shape: {kind: 'box', halfExtents: [5000, 1, 5000]}, type: 'kinematic', position: [0, 40, 0]});
    const boxes = [0, 1, 2].map(i => world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [i * 2, 3 + 40 * (i % 2), 0], linearVelocity: [0, -10, 0]}));
    // Making a large body dynamic is refused for the same reason.
    assert.throws(() => world.setBodyType(road, 'dynamic'), error => error.code === 'INVALID_PAYLOAD', 'a 20 km slab cannot become dynamic');
    // At the limit: a 1 km dynamic cube landing at 200 m/s, deep in the ground, steps normally.
    const big = world.createBody({shape: {kind: 'box', halfExtents: [1000, 1000, 1000]}, position: [0, 6, 3000], linearVelocity: [0, -200, 0]});
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    for (const body of [big, ...boxes]) { const state = world.bodyState(body); assert.ok(finite([...state.position, ...state.linearVelocity]), 'finite'); }
    // Spheres and capsules have no polytope contact and are not limited by the bridge.
    assert.ok(world.createBody({shape: {kind: 'sphere', radius: 5000}, position: [0, 9000, 0]}));
  } finally { world.destroy(); }
});
