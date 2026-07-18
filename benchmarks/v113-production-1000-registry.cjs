'use strict';

/*
 * Canonical v1.13 release-tournament registry.
 *
 * The ten shards deliberately measure every retained production optimization
 * family instead of treating 600 differently named native scenes as 600
 * independent code paths.  Case semantics (including the operation variant)
 * are hashed without the numeric case ID, so duplicate work cannot pass the
 * uniqueness gate merely by receiving a different label.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const GROUPS = Object.freeze([
  'native-create-active',
  'native-actions-sync',
  'fallback-create-actions',
  'cloth',
  'rope',
  'water',
  'mixed-unchanged',
  'frame-prep-wasm-wrapper',
  'renderer-cpu-webgpu',
  'controls',
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) { return JSON.stringify(stableValue(value)); }
function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function schedule(kind, variant = 0) {
  const shift = variant % 3;
  if (kind === 'native' || kind === 'fallback') {
    return [
      { frame: 0, action: 'kick', strength: 7 + shift },
      { frame: 3 + shift, action: 'explosion', center: [0, 3 + shift, 0], strength: 17 + shift, radius: 9 },
      { frame: 7 + shift, action: 'projectile', position: [-12, 6, 0], velocity: [24, 2, 0], size: 0.8 },
      { frame: 11 + shift, action: 'rain', count: 20 + shift * 2, spread: 8, height: 14 },
    ];
  }
  const water = kind === 'water';
  return [
    { frame: 0, action: 'kick', strength: 16 + shift },
    { frame: 5 + shift, action: 'projectile', position: [-18, 9, 0], velocity: [36, 1.5, 0], size: 0.9 },
    { frame: 11 + shift, action: 'explosion', center: [0, 5, 0], strength: 34 + shift, radius: 18 },
    { frame: 17 + shift, action: 'rain', count: water ? 144 + shift * 8 : 56 + shift * 4, spread: 14, height: 22 },
  ];
}

function fidelity(domain, exact = false) {
  if (exact) return { stateRelativeL2: 0, renderRelativeL2: 0, exactBits: true };
  if (domain === 'cloth') return { stateRelativeL2: 0.002, renderRelativeL2: 0.002, exactBits: false };
  if (domain === 'rope') return { stateRelativeL2: 0.0005, renderRelativeL2: 0.0005, exactBits: false };
  if (domain === 'water') return { stateRelativeL2: 1e-7, renderRelativeL2: 1e-7, exactBits: false };
  if (domain === 'mixed') return { stateRelativeL2: 0.002, renderRelativeL2: 0.002, exactBits: false };
  if (domain === 'fallback') return { stateRelativeL2: 0, renderRelativeL2: 0, exactBits: true };
  return { stateRelativeL2: 0, renderRelativeL2: 0, exactBits: true };
}

function base(id, fields) {
  return {
    id,
    shard: Math.floor((id - 1) / 100) + 1,
    group: GROUPS[Math.floor((id - 1) / 100)],
    stress: 5,
    warmup: 4,
    iterations: 16,
    maxRepetitions: 128,
    actions: [],
    checkpointFractions: [0.25, 0.5, 0.75, 1],
    expectedControl: false,
    fidelity: fidelity('exact', true),
    ...fields,
  };
}

function nativeCreate(id, local) {
  // Reserve the final 20 cases for the cloth/rope/water native stage recipes.
  // The exact multi-entry hull cache has its largest complete-path effect on
  // these recurring dimensions, so a rigid-only 0..599 sample would leave the
  // newly qualified production path outside the definitive tournament.
  const stageOffset = local - 80;
  const sceneId = local < 80
    ? (local * 6 + Math.floor(local / 17)) % 600
    : 600 + (stageOffset % 3) * 50 + ((stageOffset * 7) % 50);
  const protocol = local < 50 ? 'native-create-only' : 'native-create-step';
  return base(id, {
    engine: 'native', domain: 'rigid', sceneId, protocol, variant: local,
    seed: (0x11310000 ^ Math.imul(sceneId + 1, 0x9e3779b1) ^ local) >>> 0,
    warmup: 1, iterations: protocol === 'native-create-only' ? 8 : 6, maxRepetitions: 128,
    fidelity: fidelity('exact', true),
  });
}

function nativeAction(id, local) {
  const sceneId = (local * 7 + 3) % 600;
  const protocol = ['active-step-sync', 'explicit-sync', 'native-mixed-actions', 'native-step-explicit-sync'][local % 4];
  return base(id, {
    engine: 'native', domain: 'rigid', sceneId, protocol, variant: local,
    seed: (0x11320000 ^ Math.imul(sceneId + 1, 0x85ebca6b) ^ local) >>> 0,
    warmup: 3,
    iterations: protocol === 'native-mixed-actions' ? 32 + (local % 3) * 2 : 256 + (local % 3) * 16,
    maxRepetitions: 64,
    actions: protocol === 'native-mixed-actions' ? schedule('native', local) : [],
    actionCycle: protocol === 'native-mixed-actions' ? 16 : null,
    expectedControl: protocol !== 'native-mixed-actions',
    fidelity: fidelity('exact', true),
  });
}

function fallback(id, local) {
  const staticStage = local >= 80;
  const staticOffset = local - 80;
  const sceneId = staticStage
    ? (staticOffset < 10 ? 600 + staticOffset * 5 : 650 + (staticOffset - 10) * 5)
    : (local * 6 + 2 + Math.floor(local / 20)) % 600;
  const protocol = local < 40 ? 'fallback-create-step'
    : local < 70 ? 'fallback-active-step'
      : staticStage ? 'fallback-static-stage-step' : 'fallback-mixed-actions';
  return base(id, {
    engine: 'fallback', domain: 'fallback', sceneId, protocol, variant: local,
    seed: (0x11330000 ^ Math.imul(sceneId + 1, 0xc2b2ae35) ^ local) >>> 0,
    warmup: protocol === 'fallback-create-step' || staticStage ? 1 : 4,
    iterations: protocol === 'fallback-create-step' ? 8 : staticStage ? 512 : 18,
    maxRepetitions: protocol === 'fallback-create-step' ? 128 : 128,
    actions: protocol === 'fallback-mixed-actions' ? schedule('fallback', local) : [],
    fidelity: fidelity('fallback'),
  });
}

function soft(id, local, domain, sceneBase) {
  const interaction = local >= 50;
  const sceneId = sceneBase + (local % 50);
  return base(id, {
    engine: 'soft', domain, sceneId,
    protocol: interaction ? 'deterministic-interaction' : 'steady', variant: local,
    seed: (0x11340000 ^ Math.imul(sceneId + 1, 0x27d4eb2f) ^ local) >>> 0,
    warmup: 8, iterations: 24,
    actions: interaction ? schedule(domain, local) : [],
    fidelity: fidelity(domain),
  });
}

function mixed(id, local) {
  const unchanged = local >= 50;
  const variant = local % 50;
  return base(id, {
    engine: 'mixed-soft', domain: 'mixed', sceneId: null,
    sceneIds: [600 + variant, 650 + ((variant * 7) % 50), 700 + ((variant * 13) % 50)],
    protocol: unchanged ? 'mixed-unchanged-frame' : 'mixed-active-frame', variant: local,
    seed: (0x11370000 ^ Math.imul(local + 1, 0x165667b1)) >>> 0,
    warmup: unchanged ? 12 : 6,
    iterations: unchanged ? 256 : 16,
    maxRepetitions: unchanged ? 64 : 96,
    unchangedFrame: unchanged,
    expectedControl: unchanged,
    fidelity: fidelity('mixed'),
  });
}

function framePrep(id, local) {
  const family = local < 25 ? 'camera' : local < 50 ? 'frame-lines' : local < 75 ? 'effects' : 'wasm-wrapper';
  const variant = local % 25;
  const unchanged = (variant & 1) === 1;
  const protocol = family === 'camera' ? (unchanged ? 'camera-unchanged' : 'camera-active')
    : family === 'frame-lines' ? (unchanged ? 'lines-unchanged' : 'lines-active')
      : family === 'effects' ? (unchanged ? 'effects-unchanged' : 'effects-active')
        : ['wrapper-pointers', 'wrapper-counts', 'wrapper-step-pointers', 'wrapper-mixed'][variant % 4];
  return base(id, {
    engine: family, domain: family, sceneId: null, protocol, variant,
    seed: (0x11380000 ^ Math.imul(local + 1, 0xd3a2646c)) >>> 0,
    warmup: 8,
    iterations: family === 'effects' ? 32 : family === 'wasm-wrapper' ? 8192 : 1024,
    maxRepetitions: family === 'effects' ? 128 : family === 'wasm-wrapper' ? 256 : 32,
    unchangedFrame: unchanged && family !== 'wasm-wrapper',
    fidelity: fidelity('exact', true),
  });
}

function renderer(id, local) {
  let engine;
  let offset;
  if (local < 20) { engine = 'renderer-rigid'; offset = local; }
  else if (local < 40) { engine = 'renderer-cloth'; offset = local - 20; }
  else if (local < 60) { engine = 'renderer-water'; offset = local - 40; }
  else if (local < 70) { engine = 'renderer-rope'; offset = local - 60; }
  else if (local < 80) { engine = 'renderer-effects'; offset = local - 70; }
  else { engine = 'renderer-uniform-resize'; offset = local - 80; }
  const unchanged = (offset & 1) === 1 && engine !== 'renderer-uniform-resize';
  const definition = base(id, {
    engine, domain: 'renderer', sceneId: null,
    protocol: engine === 'renderer-uniform-resize'
      ? (offset < 7 ? 'uniforms-resize-dedup' : offset < 14 ? 'uniforms-delayed-resize' : 'uniforms-active-resize')
      : `${engine.replace('renderer-', '')}-${unchanged ? 'unchanged' : 'active'}-upload`,
    variant: offset,
    seed: (0x11390000 ^ Math.imul(local + 1, 0xfd7046c5)) >>> 0,
    warmup: 8, iterations: 2048, maxRepetitions: 256,
    unchangedFrame: unchanged || (engine === 'renderer-uniform-resize' && offset < 7),
    fidelity: fidelity('exact', true),
  });
  if (engine === 'renderer-rigid' || engine === 'renderer-rope' || engine === 'renderer-effects' ||
      engine === 'renderer-uniform-resize') {
    definition.expectedControl = true;
  }
  return definition;
}

function control(id, local) {
  let definition;
  if (local < 20) {
    definition = base(id, {
      engine: 'native', domain: 'rigid', sceneId: (local * 29 + 5) % 600,
      // These are active native-step parity controls. Several stress scenes are
      // intentionally persistent and cannot reach zero awake bodies, so treating
      // them as settled controls made the checker reject otherwise valid traces.
      protocol: 'native-step-control', variant: local,
      seed: (0x113a0000 ^ Math.imul(local + 1, 0x9e3779b1)) >>> 0,
      warmup: 240, iterations: 192, maxRepetitions: 32,
      fidelity: fidelity('exact', true),
    });
  } else if (local < 40) {
    const variant = local - 20;
    definition = soft(id, variant, 'cloth', 600);
    definition.protocol = 'tearing-control';
    definition.sceneId = 606 + (variant % 4) * 10;
    definition.variant = variant;
  } else if (local < 60) {
    const variant = local - 40;
    definition = base(id, {
      engine: 'fallback', domain: 'fallback', sceneId: (variant * 31 + 7) % 600,
      protocol: 'fallback-invalid-step-control', variant,
      seed: (0x113b0000 ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0,
      warmup: 8, iterations: 1024, unchangedFrame: true,
      fidelity: fidelity('exact', true),
    });
  } else if (local < 80) {
    const variant = local - 60;
    definition = base(id, {
      engine: 'camera', domain: 'camera', sceneId: null,
      protocol: 'camera-forced-active-control', variant,
      seed: (0x113c0000 ^ Math.imul(variant + 1, 0xc2b2ae35)) >>> 0,
      warmup: 8, iterations: 1024, fidelity: fidelity('exact', true),
    });
  } else {
    const variant = local - 80;
    definition = base(id, {
      engine: 'renderer-uniform-resize', domain: 'renderer', sceneId: null,
      protocol: 'renderer-forced-resize-control', variant,
      seed: (0x113d0000 ^ Math.imul(variant + 1, 0x27d4eb2f)) >>> 0,
      warmup: 8, iterations: 128, maxRepetitions: 64,
      fidelity: fidelity('exact', true),
    });
  }
  definition.expectedControl = true;
  return definition;
}

function semanticProjection(definition) {
  return {
    group: definition.group, engine: definition.engine, domain: definition.domain,
    sceneId: definition.sceneId, sceneIds: definition.sceneIds,
    protocol: definition.protocol, variant: definition.variant,
    stress: definition.stress, seed: definition.seed, warmup: definition.warmup,
    iterations: definition.iterations, actions: definition.actions,
    actionCycle: definition.actionCycle,
    unchangedFrame: Boolean(definition.unchangedFrame), expectedControl: definition.expectedControl,
  };
}

function executionProjection(definition) {
  return {
    engine: definition.engine, sceneId: definition.sceneId, sceneIds: definition.sceneIds,
    protocol: definition.protocol, variant: definition.variant,
    stress: definition.stress, seed: definition.seed,
    warmup: definition.warmup, iterations: definition.iterations, actions: definition.actions,
    actionCycle: definition.actionCycle,
  };
}

function decorate(definition) {
  const semanticKey = stableStringify(semanticProjection(definition));
  const executionTrace = stableStringify(executionProjection(definition));
  return {
    ...definition,
    semanticKey,
    semanticSha256: sha256Text(semanticKey),
    executionTraceSha256: sha256Text(executionTrace),
  };
}

function makeRegistry() {
  const definitions = [];
  for (let local = 0; local < 100; local++) definitions.push(nativeCreate(1 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(nativeAction(101 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(fallback(201 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(soft(301 + local, local, 'cloth', 600));
  for (let local = 0; local < 100; local++) definitions.push(soft(401 + local, local, 'rope', 650));
  for (let local = 0; local < 100; local++) definitions.push(soft(501 + local, local, 'water', 700));
  for (let local = 0; local < 100; local++) definitions.push(mixed(601 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(framePrep(701 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(renderer(801 + local, local));
  for (let local = 0; local < 100; local++) definitions.push(control(901 + local, local));
  definitions.sort((a, b) => a.id - b.id);
  const registry = definitions.map(decorate);

  assert.equal(registry.length, 1000, 'v1.13 registry must contain exactly 1,000 cases');
  assert.deepEqual(registry.map((entry) => entry.id), Array.from({ length: 1000 }, (_, index) => index + 1));
  for (let shard = 1; shard <= 10; shard++) {
    assert.equal(registry.filter((entry) => entry.shard === shard).length, 100, `shard ${shard} case count`);
    assert.equal(registry.filter((entry) => entry.group === GROUPS[shard - 1]).length, 100, `group ${GROUPS[shard - 1]} case count`);
  }
  assert.equal(new Set(registry.map((entry) => entry.semanticSha256)).size, 1000, 'duplicate semantic workload');
  assert.equal(new Set(registry.map((entry) => entry.executionTraceSha256)).size, 1000, 'duplicate execution trace');
  return registry;
}

function registryDigest(registry = makeRegistry()) { return sha256Text(stableStringify(registry)); }

module.exports = { GROUPS, makeRegistry, registryDigest, stableStringify };
