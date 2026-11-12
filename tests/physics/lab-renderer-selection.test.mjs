// Which renderer the Physics Lab draws with (src/webgl/renderer-selection.ts), and a check that nothing the Lab
// steps with depends on it. The browser half (both renderers, the same state hash after N steps, a device loss
// mid-run) is scripts/lab-webgl2-browser-check.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  fallbackReason, rendererAfterLoss, rendererCandidates, rendererLabel, rendererRequest, selectRenderer,
} from '../../src/webgl/renderer-selection.ts';

test('?renderer= picks the request; anything else is auto', () => {
  assert.equal(rendererRequest(''), 'auto');
  assert.equal(rendererRequest('?renderer=webgl2'), 'webgl2');
  assert.equal(rendererRequest('?example=domino-run&renderer=WebGL'), 'webgl2');
  assert.equal(rendererRequest('?renderer=webgpu'), 'webgpu');
  assert.equal(rendererRequest('?renderer=vulkan'), 'auto');
  assert.equal(rendererRequest('?renderer='), 'auto');
});

test('candidates: WebGPU then WebGL2 when navigator.gpu exists, WebGL2 alone without it, a forced one alone', () => {
  assert.deepEqual(rendererCandidates('auto', true), ['webgpu', 'webgl2']);
  assert.deepEqual(rendererCandidates('auto', false), ['webgl2']);
  assert.deepEqual(rendererCandidates('webgl2', true), ['webgl2']);
  assert.deepEqual(rendererCandidates('webgpu', false), ['webgpu']);
});

test('a lost WebGPU device hands over to WebGL2 unless the page forced WebGPU; a lost WebGL2 context gets WebGL2 again', () => {
  assert.equal(rendererAfterLoss('webgpu', 'auto'), 'webgl2');
  assert.equal(rendererAfterLoss('webgpu', 'webgpu'), 'webgpu');
  assert.equal(rendererAfterLoss('webgl2', 'auto'), 'webgl2');
  assert.equal(rendererAfterLoss('webgl2', 'webgl2'), 'webgl2');
  assert.equal(rendererLabel('webgl2', 'WebGPU device lost'), 'WebGL2 (WebGPU device lost)');
  assert.equal(rendererLabel('webgpu'), 'WebGPU');
});

test('startup tries the candidates in order and stops at the first that starts', async () => {
  const calls = [];
  const factories = {
    webgpu: async () => { calls.push('webgpu'); throw new Error('No WebGPU adapter was returned by the browser.'); },
    webgl2: async () => { calls.push('webgl2'); return 'gl'; },
  };
  const fellBack = await selectRenderer(['webgpu', 'webgl2'], factories);
  assert.deepEqual(calls, ['webgpu', 'webgl2']);
  assert.equal(fellBack.kind, 'webgl2');
  assert.equal(fellBack.renderer, 'gl');
  assert.deepEqual(fellBack.attempts, [{kind: 'webgpu', error: 'No WebGPU adapter was returned by the browser.'}]);
  assert.equal(fallbackReason(fellBack, 'auto'), 'WebGPU did not start');

  calls.length = 0;
  const first = await selectRenderer(['webgpu', 'webgl2'], {webgpu: async () => { calls.push('webgpu'); return 'gpu'; }, webgl2: factories.webgl2});
  assert.deepEqual(calls, ['webgpu'], 'WebGL2 is not created when WebGPU starts');
  assert.equal(fallbackReason(first, 'auto'), null);
  assert.equal(fallbackReason(await selectRenderer(['webgl2'], factories), 'auto'), 'WebGPU unavailable');
  assert.equal(fallbackReason(await selectRenderer(['webgl2'], factories), 'webgl2'), 'forced by ?renderer=webgl2');

  await assert.rejects(selectRenderer(['webgpu', 'webgl2'], {webgpu: factories.webgpu, webgl2: async () => { throw new Error('WebGL2 is not available in this browser.'); }}),
    /No renderer could start\. WebGPU: No WebGPU adapter.*WebGL2: WebGL2 is not available/);
});

// The physics is CPU/WASM. Everything the Lab's fixed step runs is reached from these modules; none of them may
// import a renderer, so the renderer cannot change what a step computes.
test('nothing in the stepping path imports a renderer', () => {
  const root = path.resolve(new URL('../../src', import.meta.url).pathname);
  const entries = ['engine/workbench-runtime.ts', 'lab/scene-host.ts', 'lab/coupled-scene.ts', 'lab/si-bridge-scene.ts', 'lab/scene-editor-model.ts', 'engine/simulation.ts', 'soft/simulations.ts', 'engine/native-world.ts'];
  const seen = new Set(), stack = entries.map(e => path.join(root, e));
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      if (match[1]) continue;   // type-only imports are erased
      let target = path.resolve(path.dirname(file), match[2]);
      if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
      if (!path.extname(target)) target += fs.existsSync(target + '.ts') ? '.ts' : '/index.ts';
      stack.push(target);
    }
  }
  const renderers = [...seen].map(f => path.relative(root, f)).filter(f => f.startsWith('webgl/') || f === 'webgpu/renderer.ts' || f.startsWith('studio/'));
  assert.ok(seen.size > entries.length, 'the walk followed imports');
  assert.deepEqual(renderers, [], `stepping-path modules that import a renderer: ${renderers.join(', ')}`);
});
