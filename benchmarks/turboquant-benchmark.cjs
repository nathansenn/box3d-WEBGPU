#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { SCENES } = require('../.bench-build/src/scenes.js');
const { SoftSimulationSuite } = require('../.bench-build/src/soft/simulations.js');
const {
  TurboQuantCodec,
  TurboQuantDeltaStream,
  turboQuantError,
  turboQuantPacketBytes,
  turboQuantCompressionRatio,
} = require('../.bench-build/src/compression/turboquant.js');

const OUTPUT = path.join(__dirname, 'results', 'turboquant-benchmark.json');
const FRAMES = Number(process.env.TQ_FRAMES || 96);
const SAMPLES = Number(process.env.TQ_SAMPLES || 7);
const WARMUPS = Number(process.env.TQ_WARMUPS || 2);
const FANOUTS = (process.env.TQ_FANOUTS || '1,4,16').split(',').map(Number).filter(value => Number.isInteger(value) && value > 0);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function mad(values) {
  const m = median(values);
  return median(values.map(v => Math.abs(v - m)));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function timeSamples(fn, warmups = WARMUPS, samples = SAMPLES) {
  for (let i = 0; i < warmups; i++) fn();
  const values = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  return { samplesMs: values, medianMs: median(values), madMs: mad(values) };
}

function extractSurfacePositions(surface) {
  if (surface.path === 'gpu-cloth') {
    return surface.positions.slice(0, surface.vertexCount * 3);
  }
  if (surface.path === 'gpu-water') {
    const count = surface.vertexCount;
    const output = new Float32Array(count * 3);
    output.set(surface.eta.subarray(0, count), 0);
    output.set(surface.u.subarray(0, count), count);
    output.set(surface.v.subarray(0, count), count * 2);
    return output;
  }
  if (surface.path !== 'packed') throw new Error(`Unsupported surface path: ${surface.path}`);
  const output = new Float32Array(surface.vertexCount * 3);
  const floats = new Float32Array(surface.vertices.buffer, surface.vertices.byteOffset, surface.vertices.byteLength / 4);
  for (let i = 0; i < surface.vertexCount; i++) {
    const src = i * 6;
    const dst = i * 3;
    output[dst] = floats[src];
    output[dst + 1] = floats[src + 1];
    output[dst + 2] = floats[src + 2];
  }
  return output;
}

function copyActiveMatrices(frame) {
  return frame.matrices.slice(0, frame.instanceCount * 16);
}

function copyRopePositions(frame) {
  if (!frame.ropeGrid) throw new Error('Rope frame did not publish compact node state.');
  return frame.ropeGrid.positions.slice(0, frame.ropeGrid.nodeCount * 3);
}

function collectFrames(sceneId, kind) {
  const scene = SCENES.find(item => item.id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found.`);
  const suite = new SoftSimulationSuite();
  if (!suite.createScene(scene, 5, 0x5eed1234)) throw new Error(`Unable to create ${scene.title}.`);
  const frames = [];
  const actionFrames = new Set([
    Math.max(1, Math.floor(FRAMES * 0.20)),
    Math.max(2, Math.floor(FRAMES * 0.40)),
    Math.max(3, Math.floor(FRAMES * 0.60)),
    Math.max(4, Math.floor(FRAMES * 0.80)),
  ]);
  const [kickFrame, projectileFrame, explosionFrame, rainFrame] = [...actionFrames];
  for (let frameIndex = 0; frameIndex < FRAMES; frameIndex++) {
    if (frameIndex === kickFrame) suite.kick(13);
    if (frameIndex === projectileFrame) suite.launchProjectile([-12, 9, 0], [25, -2, 1.5], 0.55);
    if (frameIndex === explosionFrame) suite.explode([0, 4, 0], 18, 9);
    if (frameIndex === rainFrame) suite.spawnRain(240, 13, 18);
    suite.step(1 / 60, 4);
    const frame = suite.buildFrame(false);
    if (kind === 'surface') {
      if (!frame.surface) throw new Error(`${scene.title} did not produce a surface.`);
      frames.push(extractSurfacePositions(frame.surface));
    } else if (kind === 'rope') {
      frames.push(copyRopePositions(frame));
    } else {
      frames.push(copyActiveMatrices(frame));
    }
  }
  const validation = suite.validate();
  suite.destroy();
  if (!validation.ok) throw new Error(validation.message);
  const minimumLength = frames.reduce((minimum, frame) => Math.min(minimum, frame.length), Number.POSITIVE_INFINITY);
  const normalizedFrames = frames.every((frame) => frame.length === minimumLength)
    ? frames
    : frames.map((frame) => frame.slice(0, minimumLength));
  return { scene, frames: normalizedFrames, validation };
}

function aggregateError(referenceFrames, decodedFrames) {
  let error2 = 0;
  let reference2 = 0;
  let count = 0;
  let maxAbs = 0;
  const absErrors = [];
  for (let f = 0; f < referenceFrames.length; f++) {
    const a = referenceFrames[f];
    const b = decodedFrames[f];
    for (let i = 0; i < a.length; i++) {
      const delta = b[i] - a[i];
      const abs = Math.abs(delta);
      error2 += delta * delta;
      reference2 += a[i] * a[i];
      count++;
      if (abs > maxAbs) maxAbs = abs;
      if ((i & 7) === 0) absErrors.push(abs);
    }
  }
  return {
    mse: error2 / Math.max(1, count),
    rmse: Math.sqrt(error2 / Math.max(1, count)),
    relativeL2: Math.sqrt(error2 / Math.max(1e-30, reference2)),
    maxAbs,
    p95Abs: percentile(absErrors, 0.95),
    p99Abs: percentile(absErrors, 0.99),
  };
}

function benchCodec(workload, config) {
  const frames = workload.frames;
  const length = frames[0].length;
  if (!frames.every(frame => frame.length === length)) {
    return { name: config.name, skipped: true, reason: 'variable-length frame stream' };
  }
  const codec = new TurboQuantCodec(config.options);
  const packet = codec.createPacket(length);
  const output = new Float32Array(length);
  const decodedFrames = [];

  const absoluteTiming = timeSamples(() => {
    for (const frame of frames) {
      codec.encodeInto(frame, packet);
      codec.decodeInto(packet, output);
    }
  });

  for (const frame of frames) {
    codec.encodeInto(frame, packet);
    codec.decodeInto(packet, output);
    decodedFrames.push(output.slice());
  }

  // Stateful predictive path: encoder and decoder maintain their own copy of
  // the previous reconstructed state, exactly as two transport endpoints do.
  const encoder = new TurboQuantDeltaStream(length, config.options);
  const decoder = new TurboQuantDeltaStream(length, config.options);
  const predictiveDecoded = [];
  const predictiveTiming = timeSamples(() => {
    encoder.reset();
    decoder.reset();
    for (const frame of frames) {
      const encoded = encoder.encodeFrame(frame);
      decoder.decodeFrame(encoded);
    }
  });
  encoder.reset();
  decoder.reset();
  for (const frame of frames) {
    const encoded = encoder.encodeFrame(frame);
    predictiveDecoded.push(decoder.decodeFrame(encoded).slice());
  }

  const rawBytes = length * 4;
  const packetBytes = turboQuantPacketBytes(packet);
  const rawTarget = new Float32Array(length);
  const codeTarget = new Uint8Array(packet.codes.length);
  const normTarget = new Float32Array(packet.norms.length);
  const meanTarget = new Float32Array(packet.means.length);

  const rawCopyTiming = timeSamples(() => {
    for (const frame of frames) rawTarget.set(frame);
  });
  codec.encodeInto(frames[frames.length - 1], packet);
  const compressedCopyTiming = timeSamples(() => {
    for (let i = 0; i < frames.length; i++) {
      codeTarget.set(packet.codes);
      normTarget.set(packet.norms);
      if (meanTarget.length) meanTarget.set(packet.means);
    }
  });

  const fanout = {};
  for (const copies of FANOUTS) {
    const rawTargets = Array.from({ length: copies }, () => new Float32Array(length));
    const codeTargets = Array.from({ length: copies }, () => new Uint8Array(packet.codes.length));
    const normTargets = Array.from({ length: copies }, () => new Float32Array(packet.norms.length));
    const meanTargets = Array.from({ length: copies }, () => new Float32Array(packet.means.length));
    const raw = timeSamples(() => {
      const frame = frames[frames.length - 1];
      for (let i = 0; i < copies; i++) rawTargets[i].set(frame);
    }, 2, 9);
    const compressed = timeSamples(() => {
      for (let i = 0; i < copies; i++) {
        codeTargets[i].set(packet.codes);
        normTargets[i].set(packet.norms);
        if (packet.means.length) meanTargets[i].set(packet.means);
      }
    }, 2, 9);
    fanout[copies] = {
      rawCopyMedianMs: raw.medianMs,
      compressedCopyMedianMs: compressed.medianMs,
      copyOnlySpeedup: raw.medianMs / compressed.medianMs,
    };
  }

  return {
    name: config.name,
    options: config.options,
    vectorLength: length,
    rawBytes,
    packetBytes,
    compressionRatio: turboQuantCompressionRatio(packet),
    absoluteEncodeDecode: absoluteTiming,
    predictiveEncodeDecode: predictiveTiming,
    rawCopy: rawCopyTiming,
    compressedCopy: compressedCopyTiming,
    copyOnlySpeedup: rawCopyTiming.medianMs / compressedCopyTiming.medianMs,
    absoluteError: aggregateError(frames, decodedFrames),
    predictiveError: aggregateError(frames, predictiveDecoded),
    fanout,
    transportModel: (() => {
      const codecMsPerFrame = predictiveTiming.medianMs / frames.length;
      const rawCopyMsPerFrame = rawCopyTiming.medianMs / frames.length;
      const compressedCopyMsPerFrame = compressedCopyTiming.medianMs / frames.length;
      const bytesSavedPerFrame = Math.max(0, rawBytes - packetBytes);
      const breakEvenBytesPerSecond = codecMsPerFrame > 0 ? bytesSavedPerFrame / (codecMsPerFrame / 1000) : Infinity;
      const modeledLinks = {};
      for (const megabytesPerSecond of [5, 10, 25, 50, 100, 250]) {
        const bytesPerSecond = megabytesPerSecond * 1_000_000;
        const rawLatencyMs = (rawBytes / bytesPerSecond) * 1000;
        const turboLatencyMs = codecMsPerFrame + (packetBytes / bytesPerSecond) * 1000;
        modeledLinks[megabytesPerSecond] = {
          rawLatencyMs,
          turboLatencyMs,
          speedup: rawLatencyMs / turboLatencyMs,
        };
      }
      return {
        codecMsPerFrame,
        rawCopyMsPerFrame,
        compressedCopyMsPerFrame,
        localEndToEndSpeedup: rawCopyMsPerFrame / codecMsPerFrame,
        bytesSavedPerFrame,
        breakEvenBytesPerSecond,
        breakEvenMegabytesPerSecond: breakEvenBytesPerSecond / 1_000_000,
        modeledLinks,
      };
    })(),
  };
}

function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  console.log(`Collecting ${FRAMES} frames per workload...`);
  const workloads = [
    { id: 'cloth', kind: 'surface', ...collectFrames(649, 'surface') },
    { id: 'rope', kind: 'rope-positions', ...collectFrames(699, 'rope') },
    { id: 'water', kind: 'surface', ...collectFrames(749, 'surface') },
  ];
  const configs = [
    { name: 'TurboQuant blockwise dense 4-bit', options: { bits: 4, blockSize: 32, rotation: 'dense', centered: true, seed: 0x715517 } },
    { name: 'TurboQuant structured 4-bit', options: { bits: 4, blockSize: 64, rotation: 'structured', centered: true, seed: 0x715517 } },
    { name: 'TurboQuant structured 3-bit', options: { bits: 3, blockSize: 64, rotation: 'structured', centered: true, seed: 0x715517 } },
    { name: 'TurboQuant structured 4-bit delta', options: { bits: 4, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 } },
    { name: 'TurboQuant structured 3-bit delta', options: { bits: 3, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 } },
  ];

  const results = [];
  for (const workload of workloads) {
    console.log(`Benchmarking ${workload.id}: ${workload.scene.title} (${workload.frames[0].length} floats)`);
    const codecs = configs.map(config => benchCodec(workload, config));
    results.push({
      id: workload.id,
      sceneId: workload.scene.id,
      scene: workload.scene.title,
      kind: workload.kind,
      frameCount: workload.frames.length,
      vectorLength: workload.frames[0].length,
      codecs,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    framesPerWorkload: FRAMES,
    samples: SAMPLES,
    warmups: WARMUPS,
    fanouts: FANOUTS,
    methodology: 'Median wall-clock timing after warmup on real maximum-detail cloth, rope, and water streams. Dense mode is a blockwise TurboQuant-MSE adaptation; structured mode uses randomized Walsh-Hadamard rotations inspired by Fast-TurboQuant. Both use Gaussian Lloyd-Max scalar codebooks.',
    results,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUTPUT}`);

  for (const workload of results) {
    console.log(`\n${workload.id.toUpperCase()} — ${workload.vectorLength * 4} raw bytes/frame`);
    for (const item of workload.codecs) {
      if (item.skipped) { console.log(`  ${item.name}: skipped (${item.reason})`); continue; }
      console.log(`  ${item.name}`);
      console.log(`    compression ${item.compressionRatio.toFixed(2)}x · packet ${item.packetBytes} B`);
      console.log(`    abs E+D ${(item.absoluteEncodeDecode.medianMs / workload.frameCount).toFixed(4)} ms/frame · relL2 ${(item.absoluteError.relativeL2 * 100).toFixed(3)}%`);
      console.log(`    delta E+D ${(item.predictiveEncodeDecode.medianMs / workload.frameCount).toFixed(4)} ms/frame · relL2 ${(item.predictiveError.relativeL2 * 100).toFixed(3)}%`);
      console.log(`    compressed-copy-only ${item.copyOnlySpeedup.toFixed(2)}x vs raw copy`);
      console.log(`    local end-to-end ${item.transportModel.localEndToEndSpeedup.toFixed(3)}x · link break-even ${item.transportModel.breakEvenMegabytesPerSecond.toFixed(1)} MB/s`);
    }
  }
}

main();
