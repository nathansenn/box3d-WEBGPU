/** Deterministic producers for Round 5; no GPU work or performance inference here. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const MODES = ['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass'];
const DT = 1 / 60, SUBSTEPS = 4;

/** Both arms recreate the same input state for each paired window. */
export function fixtureSeed(seed, pairIndex) {
  assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff, 'Invalid fixture seed');
  assert.ok(Number.isSafeInteger(pairIndex) && pairIndex >= 0, 'Invalid fixture pair index');
  return (seed + Math.imul(pairIndex, 0x9e3779b9)) >>> 0;
}

export function recordWords(source, kind, count) {
  const pointer = Number(kind === 'matrices' ? source._b3w_matrices_ptr() : source._b3w_colors_ptr());
  const length = count * (kind === 'matrices' ? 16 : 4), heap = source.HEAPF32;
  assert.ok(Number.isSafeInteger(pointer) && pointer >= 0 && pointer % 4 === 0 && pointer + length * 4 <= heap.byteLength,
    'Fixture stream is outside the current native heap');
  return new Uint32Array(heap.buffer, heap.byteOffset + pointer, length);
}

function trackerPairs(count, factory) {
  assert.equal(typeof factory, 'function', 'trackerFactory is required');
  return new Map(MODES.map(mode => [mode, { matrices: factory(count, mode), colors: factory(count, mode) }]));
}

function trackingEvidence(result) {
  return { dirtyCount: result.dirtyCount, countedDirtyRecords: result.countedDirtyRecords,
    coverageUpperBound: result.coverageUpperBound, full: result.full, spanCount: result.spans.length };
}

function finishEvidence(pair, source, previousFrameVersion, previousColorVersion, mode, origin) {
  const matrices = pair.matrices.finish(), colors = pair.colors.finish();
  return { previousFrameVersion, previousColorVersion,
    frameVersion: source.frameVersion(), colorVersion: source.colorVersion(),
    // An empty list proves no writes. Abandoning metadata must request a full upload.
    matrices: matrices.full ? undefined : matrices.spans,
    colors: colors.full ? undefined : colors.spans,
    trackingEvidence: { mode, origin, matrices: trackingEvidence(matrices), colors: trackingEvidence(colors) } };
}

function scanAndSnapshot(current, previous, stride, tracker) {
  assert.equal(current.length, previous.length, 'Native stream size changed during a window');
  for (let record = 0; record < current.length / stride; record++) {
    for (let word = 0; word < stride; word++) {
      if (current[record * stride + word] !== previous[record * stride + word]) {
        tracker.mark(record);
        break;
      }
    }
  }
  previous.set(current);
}

function syntheticFixture(workload, options) {
  const { count, pattern, streams } = workload;
  assert.ok(count === 4096 || count === 16384, 'Unsupported controlled workload size');
  assert.ok(['contiguous', 'clustered', 'scattered', 'dense'].includes(pattern), 'Unknown controlled pattern');
  assert.ok(streams === 'matrix-only' || streams === 'matrix+color', 'Unknown controlled streams');
  const activeCount = count - 1;
  const changedRecordsPerFrame = pattern === 'dense' ? Math.ceil(activeCount * .8) : count / 64;
  if (workload.changedRecordsPerFrame !== undefined) assert.equal(workload.changedRecordsPerFrame, changedRecordsPerFrame);
  const heap = new Float32Array(count * 20), matrices = heap.subarray(0, count * 16), colors = heap.subarray(count * 16);
  const pairs = trackerPairs(count, options.trackerFactory);
  let frameVersion = 0, colorVersion = 0, windowSeed = 0, pairIndex = 0, nextFrame = 0, closed = false;
  const source = { HEAPF32: heap, frameVersion: () => frameVersion, colorVersion: () => colorVersion,
    _b3w_matrices_ptr: () => 0, _b3w_colors_ptr: () => count * 64,
    _b3w_body_count: () => count, _b3w_max_bodies: () => count };
  function reset(seed, pair) {
    assert.equal(closed, false, 'Fixture is closed');
    assert.ok(pair < options.pairsPerSet, 'Pair exceeds the registered window count');
    windowSeed = fixtureSeed(seed, pair); pairIndex = pair; nextFrame = 0;
    heap.fill(0);
    const side = Math.ceil(Math.sqrt(activeCount)), spacing = 30 / side, tint = (windowSeed % 17) * .001;
    for (let i = 1; i < count; i++) {
      const offset = i * 16;
      matrices[offset] = matrices[offset + 10] = spacing * .38;
      matrices[offset + 5] = .2 + (i % 7) * .03; matrices[offset + 15] = 1;
      matrices[offset + 12] = ((i - 1) % side - (side - 1) / 2) * spacing;
      matrices[offset + 13] = matrices[offset + 5];
      matrices[offset + 14] = (Math.floor((i - 1) / side) - (side - 1) / 2) * spacing;
      colors.set([.2 + (i % 11) * .05 + tint, .25 + (i % 7) * .07, .32 + (i % 5) * .09, -2], i * 4);
    }
    matrices.set([18, 0, 0, 0, 0, .2, 0, 0, 0, 0, 18, 0, 0, -.3, 0, 1], 0);
    colors.set([.35, .39, .43, -5], 0);
    frameVersion++; colorVersion++;
  }
  function step(frameIndex, candidate, mode) {
    assert.equal(closed, false, 'Fixture is closed');
    assert.equal(frameIndex, nextFrame, 'Frames must be stepped in order from zero');
    assert.ok(frameIndex < options.framesPerWindow, 'Frame exceeds the registered window');
    const previousFrameVersion = frameVersion, previousColorVersion = colorVersion;
    const pair = candidate ? pairs.get(mode) : undefined;
    if (candidate) { assert.ok(pair, 'Unknown tracking mode'); pair.matrices.begin(); pair.colors.begin(); }
    const absoluteFrame = pairIndex * options.framesPerWindow + frameIndex;
    const base = (windowSeed + Math.imul(absoluteFrame, 23)) >>> 0;
    for (let j = 0; j < changedRecordsPerFrame; j++) {
      const offset = pattern === 'clustered' ? (j % 4) * Math.floor(activeCount / 4) + Math.floor(j / 4)
        : pattern === 'scattered' ? j * 997 : j;
      const index = 1 + ((base + offset) % activeCount), position = index * 16;
      matrices[position + 13] += .003 * (1 + (index + absoluteFrame) % 5);
      matrices[position + 12] += .001 * (1 + absoluteFrame % 3);
      if (candidate) pair.matrices.mark(index);
      if (streams === 'matrix+color') {
        colors[index * 4] = (colors[index * 4] + .017) % .95;
        if (candidate) pair.colors.mark(index);
      }
    }
    frameVersion++; if (streams === 'matrix+color') colorVersion++;
    nextFrame++;
    return candidate ? finishEvidence(pair, source, previousFrameVersion, previousColorVersion, mode, 'producer-marks') : undefined;
  }
  reset(options.seeds[0], 0);
  return { definition: { ...workload, changedRecordsPerFrame, mutableRecords: activeCount,
    groundRecord: 0, colorUpdates: streams === 'matrix+color' ? 'every-frame' : 'none',
    scatteredStride: pattern === 'scattered' ? 997 : null,
    seedFormula: '(seed + imul(pairIndex, 0x9e3779b9)) >>> 0' },
  count, source, reset, step, close() { closed = true; pairs.clear(); } };
}

async function nativeFixture(workload, options) {
  assert.equal(typeof options.nativeFactory, 'function', 'nativeFactory is required for native workloads');
  const mod = await options.nativeFactory({ wasmBinary: options.wasmBinary });
  for (const name of ['_b3w_create_scene', '_b3w_step', '_b3w_transform_version', '_b3w_color_version',
    '_b3w_matrices_ptr', '_b3w_colors_ptr', '_b3w_body_count', '_b3w_max_bodies']) {
    assert.equal(typeof mod[name], 'function', 'Native export missing: ' + name);
  }
  let count = 0, pairs, previousMatrices, previousColors, nextFrame = 0, closed = false;
  const source = { get HEAPF32() { return mod.HEAPF32; },
    frameVersion: () => mod._b3w_transform_version(), colorVersion: () => mod._b3w_color_version(),
    _b3w_matrices_ptr: () => mod._b3w_matrices_ptr(), _b3w_colors_ptr: () => mod._b3w_colors_ptr(),
    _b3w_body_count: () => mod._b3w_body_count(), _b3w_max_bodies: () => mod._b3w_max_bodies() };
  function reset(seed, pairIndex) {
    assert.equal(closed, false, 'Fixture is closed');
    assert.ok(pairIndex < options.pairsPerSet, 'Pair exceeds the registered window count');
    const derivedSeed = fixtureSeed(seed, pairIndex);
    mod._b3w_create_scene(workload.sceneId, workload.stress, derivedSeed);
    for (let frame = 0; frame < workload.preSteps; frame++) mod._b3w_step(DT, SUBSTEPS);
    const currentCount = source._b3w_body_count();
    assert.ok(Number.isSafeInteger(currentCount) && currentCount > 0 && currentCount <= source._b3w_max_bodies(), 'Invalid native body count');
    if (currentCount !== count) {
      count = currentCount;
      pairs = trackerPairs(count, options.trackerFactory);
      previousMatrices = new Uint32Array(count * 16); previousColors = new Uint32Array(count * 4);
    }
    previousMatrices.set(recordWords(source, 'matrices', count));
    previousColors.set(recordWords(source, 'colors', count)); nextFrame = 0;
  }
  function step(frameIndex, candidate, mode) {
    assert.equal(closed, false, 'Fixture is closed');
    assert.equal(frameIndex, nextFrame, 'Frames must be stepped in order from zero');
    assert.ok(frameIndex < options.framesPerWindow, 'Frame exceeds the registered window');
    const previousFrameVersion = source.frameVersion(), previousColorVersion = source.colorVersion();
    // Live native simulation runs in both arms, inside the caller's timed window.
    mod._b3w_step(DT, SUBSTEPS);
    assert.equal(source._b3w_body_count(), count, 'Native body count changed during a window');
    nextFrame++;
    if (!candidate) return undefined;
    const pair = pairs.get(mode); assert.ok(pair, 'Unknown tracking mode');
    pair.matrices.begin(); pair.colors.begin();
    // Exact word comparisons also detect signed zero and noncanonical NaN bits.
    // Discovery and both snapshot copies remain inside the measured candidate step.
    scanAndSnapshot(recordWords(source, 'matrices', count), previousMatrices, 16, pair.matrices);
    scanAndSnapshot(recordWords(source, 'colors', count), previousColors, 4, pair.colors);
    return finishEvidence(pair, source, previousFrameVersion, previousColorVersion, mode, 'native-exact-scan');
  }
  try { reset(options.seeds[0], 0); }
  catch (error) { mod._b3w_destroy?.(); throw error; }
  return { definition: { ...workload, dt: DT, substeps: SUBSTEPS, nativeStep: 'live-inside-timed-step',
    dirtyDiscovery: 'candidate-only exact uint32 record scan and snapshot copies inside timed step',
    initialBodyCount: count, wasmSha256: createHash('sha256').update(options.wasmBinary).digest('hex'),
    seedFormula: '(seed + imul(pairIndex, 0x9e3779b9)) >>> 0' },
  get count() { return count; }, source, reset, step,
  close() { if (!closed) { closed = true; pairs?.clear(); mod._b3w_destroy?.(); } } };
}

/** Construction/reset are outside timing. Every step includes all producer work. */
export async function createFixture(workload, {
  trackerFactory, nativeFactory, wasmBinary, framesPerWindow = 8, pairsPerSet = 32,
  seeds = [0x5a170b21, 0x65c3d109],
} = {}) {
  assert.ok(Number.isSafeInteger(framesPerWindow) && framesPerWindow > 0, 'Invalid framesPerWindow');
  assert.ok(Number.isSafeInteger(pairsPerSet) && pairsPerSet > 0, 'Invalid pairsPerSet');
  assert.ok(Array.isArray(seeds) && seeds.length === 2, 'Two registered input seeds are required');
  const options = { trackerFactory, nativeFactory, wasmBinary, framesPerWindow, pairsPerSet, seeds };
  if (workload.kind === 'synthetic') return syntheticFixture(workload, options);
  if (workload.kind === 'native') return nativeFixture(workload, options);
  throw new Error('Unknown fixture kind: ' + workload.kind);
}
