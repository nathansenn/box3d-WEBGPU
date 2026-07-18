import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const archive = join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const writeResults = process.env.CAMERA_BENCH_WRITE !== '0';
const scale = Math.max(0.05, Number(process.env.CAMERA_BENCH_SCALE ?? '1'));
const sampleCount = Math.max(5, Number.parseInt(process.env.CAMERA_BENCH_SAMPLES ?? '9', 10));
const warmupCount = Math.max(2, Number.parseInt(process.env.CAMERA_BENCH_WARMUPS ?? '3', 10));
const temp = mkdtempSync(join(tmpdir(), 'box3d-camera-v110-'));

let sink = 0;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function transpile(sourcePath, destinationPath, rewrites = []) {
  let source = readFileSync(sourcePath, 'utf8');
  for (const [from, to] of rewrites) source = source.replaceAll(from, to);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  });
  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, output.outputText);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function maxAbsDifference(a, b) {
  let maximum = 0;
  for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  return maximum;
}

function countFloat32BitMismatches(a, b) {
  const aBits = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const bBits = new Uint32Array(b.buffer, b.byteOffset, b.length);
  let mismatches = 0;
  for (let i = 0; i < aBits.length; i++) mismatches += aBits[i] === bBits[i] ? 0 : 1;
  return mismatches;
}

function timeLoop(iterations, callback) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const frame = callback(i);
    sink += frame.viewProjection[(i * 7) & 15] + frame.lightViewProjection[(i * 11) & 15] + frame.eye[i % 3];
  }
  return Number(process.hrtime.bigint() - start) / iterations;
}

function measurePair(iterations, baseline, optimized) {
  for (let i = 0; i < warmupCount; i++) {
    timeLoop(Math.max(1000, Math.floor(iterations * 0.08)), baseline);
    timeLoop(Math.max(1000, Math.floor(iterations * 0.08)), optimized);
  }

  const baselineSamples = [];
  const optimizedSamples = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    if ((sample & 1) === 0) {
      baselineSamples.push(timeLoop(iterations, baseline));
      optimizedSamples.push(timeLoop(iterations, optimized));
    } else {
      optimizedSamples.push(timeLoop(iterations, optimized));
      baselineSamples.push(timeLoop(iterations, baseline));
    }
  }
  const baselineMedianNs = median(baselineSamples);
  const optimizedMedianNs = median(optimizedSamples);
  return {
    iterations,
    samples: sampleCount,
    baselineMedianNs,
    optimizedMedianNs,
    speedup: baselineMedianNs / optimizedMedianNs,
    baselineMadNs: mad(baselineSamples),
    optimizedMadNs: mad(optimizedSamples),
    baselineSamples,
    optimizedSamples,
  };
}

try {
  const baselineRoot = join(temp, 'baseline-source');
  const modules = join(temp, 'modules');
  mkdirSync(baselineRoot, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', baselineRoot]);

  const baselineMainPath = join(baselineRoot, 'src/main.ts');
  const baselineMathPath = join(baselineRoot, 'src/math.ts');
  const baselineMain = readFileSync(baselineMainPath, 'utf8');
  const sourceContracts = [
    'function cameraMatrices(rig: CameraRig)',
    'const projection = mat4Perspective((58 * Math.PI) / 180, aspect, 0.08, 360)',
    'const lightEye = vec3Sub(rig.target, vec3Scale(LIGHT_DIRECTION, 92))',
    'function cameraWithShake()',
  ];
  for (const contract of sourceContracts) {
    if (!baselineMain.includes(contract)) throw new Error(`archived v1.10 camera contract is missing: ${contract}`);
  }

  const baselineMathModule = join(modules, 'baseline-math.mjs');
  const optimizedMathModule = join(modules, 'optimized-math.mjs');
  const optimizedCameraModule = join(modules, 'camera.mjs');
  transpile(baselineMathPath, baselineMathModule);
  transpile(join(root, 'src/math.ts'), optimizedMathModule);
  transpile(join(root, 'src/camera.ts'), optimizedCameraModule, [["'./math'", "'./optimized-math.mjs'"]]);

  const baselineMath = await import(`${pathToFileURL(baselineMathModule).href}?v=${Date.now()}`);
  const optimizedModule = await import(`${pathToFileURL(optimizedCameraModule).href}?v=${Date.now()}`);
  const lightDirection = baselineMath.vec3Normalize([0.42, -0.84, 0.34]);
  const noShake = { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] };

  function baselineResolve(rig, shake, aspect, direction = lightDirection) {
    const frameRig = {
      yaw: rig.yaw + shake.yaw,
      pitch: baselineMath.clamp(rig.pitch + shake.pitch, 0.08, 1.3),
      distance: rig.distance,
      target: baselineMath.vec3Add(rig.target, shake.targetOffset),
    };
    const cp = Math.cos(frameRig.pitch);
    const eye = [
      frameRig.target[0] + Math.cos(frameRig.yaw) * cp * frameRig.distance,
      frameRig.target[1] + Math.sin(frameRig.pitch) * frameRig.distance,
      frameRig.target[2] + Math.sin(frameRig.yaw) * cp * frameRig.distance,
    ];
    const projection = baselineMath.mat4Perspective((58 * Math.PI) / 180, aspect, 0.08, 360);
    const view = baselineMath.mat4LookAt(eye, frameRig.target, [0, 1, 0]);
    const shadowExtent = baselineMath.clamp(frameRig.distance * 1.35, 34, 86);
    const lightEye = baselineMath.vec3Sub(frameRig.target, baselineMath.vec3Scale(direction, 92));
    const lightView = baselineMath.mat4LookAt(lightEye, frameRig.target, [0, 1, 0]);
    const lightProjection = baselineMath.mat4Orthographic(
      -shadowExtent,
      shadowExtent,
      -shadowExtent,
      shadowExtent,
      0.1,
      190,
    );
    return {
      viewProjection: baselineMath.mat4Multiply(projection, view),
      lightViewProjection: baselineMath.mat4Multiply(lightProjection, lightView),
      eye,
    };
  }

  const fidelityCache = new optimizedModule.CameraMatrixCache();
  let maximumViewDifference = 0;
  let maximumLightDifference = 0;
  let maximumEyeDifference = 0;
  let viewBitMismatches = 0;
  let lightBitMismatches = 0;
  let eyeValueMismatches = 0;
  for (let i = 0; i < 4096; i++) {
    const rig = {
      yaw: -2.8 + (i % 257) * 0.021,
      pitch: 0.02 + (i % 149) * 0.0097,
      distance: 9 + (i % 113) * 0.47,
      target: [Math.sin(i * 0.031) * 7, 1 + Math.cos(i * 0.019) * 5, Math.sin(i * 0.013) * 9],
    };
    const shake = {
      yaw: Math.sin(i * 0.17) * 0.018,
      pitch: Math.cos(i * 0.11) * 0.012,
      targetOffset: [Math.sin(i * 0.07) * 0.2, Math.cos(i * 0.09) * 0.1, Math.sin(i * 0.05) * 0.15],
    };
    const aspect = 0.7 + (i % 197) * 0.009;
    const expected = baselineResolve(rig, shake, aspect);
    const actual = fidelityCache.resolve(rig, shake, aspect, lightDirection);
    maximumViewDifference = Math.max(maximumViewDifference, maxAbsDifference(expected.viewProjection, actual.viewProjection));
    maximumLightDifference = Math.max(maximumLightDifference, maxAbsDifference(expected.lightViewProjection, actual.lightViewProjection));
    maximumEyeDifference = Math.max(maximumEyeDifference, maxAbsDifference(expected.eye, actual.eye));
    viewBitMismatches += countFloat32BitMismatches(expected.viewProjection, actual.viewProjection);
    lightBitMismatches += countFloat32BitMismatches(expected.lightViewProjection, actual.lightViewProjection);
    for (let component = 0; component < 3; component++) {
      eyeValueMismatches += Object.is(expected.eye[component], actual.eye[component]) ? 0 : 1;
    }
  }
  const fidelityCeiling = 1e-6;
  if (
    maximumViewDifference > fidelityCeiling ||
    maximumLightDifference > fidelityCeiling ||
    maximumEyeDifference > fidelityCeiling ||
    viewBitMismatches !== 0 ||
    lightBitMismatches !== 0 ||
    eyeValueMismatches !== 0
  ) {
    throw new Error(
      `camera fidelity failed: view=${maximumViewDifference}/${viewBitMismatches} bits, ` +
      `light=${maximumLightDifference}/${lightBitMismatches} bits, eye=${maximumEyeDifference}/${eyeValueMismatches} values`,
    );
  }

  const staticRig = { yaw: -0.82, pitch: 0.46, distance: 42, target: [1.5, 5.25, -2.75] };
  const orbitInputs = Array.from({ length: 4096 }, (_, i) => ({
    rig: {
      yaw: staticRig.yaw + i * 0.00091,
      pitch: staticRig.pitch + Math.sin(i * 0.013) * 0.08,
      distance: staticRig.distance,
      target: staticRig.target,
    },
    shake: noShake,
    aspect: 16 / 9,
  }));
  const changingInputs = Array.from({ length: 4096 }, (_, i) => ({
    rig: {
      yaw: -1.4 + i * 0.0013,
      pitch: 0.12 + (i % 907) * 0.0011,
      distance: 18 + (i % 311) * 0.09,
      target: [Math.sin(i * 0.007) * 5, 3 + Math.cos(i * 0.011), Math.sin(i * 0.017) * 4],
    },
    shake: {
      yaw: Math.sin(i * 0.031) * 0.02,
      pitch: Math.cos(i * 0.023) * 0.014,
      targetOffset: [Math.sin(i * 0.037) * 0.2, Math.cos(i * 0.029) * 0.1, Math.sin(i * 0.041) * 0.18],
    },
    aspect: 1.2 + (i % 97) * 0.006,
  }));
  const mixedInputs = Array.from({ length: 2048 }, (_, i) => {
    const keyframe = Math.floor(i / 30);
    return {
      rig: {
        yaw: staticRig.yaw + keyframe * 0.007,
        pitch: staticRig.pitch + Math.sin(keyframe * 0.1) * 0.04,
        distance: staticRig.distance + (keyframe % 5) * 0.15,
        target: [1.5 + (keyframe % 3) * 0.05, 5.25, -2.75],
      },
      shake: noShake,
      aspect: 16 / 9,
    };
  });

  function workload(name, baseIterations, inputs) {
    const iterations = Math.max(5000, Math.floor(baseIterations * scale));
    const baselineCallback = inputs
      ? (i) => {
          const input = inputs[i & (inputs.length - 1)];
          return baselineResolve(input.rig, input.shake, input.aspect);
        }
      : () => baselineResolve(staticRig, noShake, 16 / 9);
    const cache = new optimizedModule.CameraMatrixCache();
    const optimizedCallback = inputs
      ? (i) => {
          const input = inputs[i & (inputs.length - 1)];
          return cache.resolve(input.rig, input.shake, input.aspect, lightDirection);
        }
      : () => cache.resolve(staticRig, noShake, 16 / 9, lightDirection);
    return { name, ...measurePair(iterations, baselineCallback, optimizedCallback) };
  }

  const workloads = [
    workload('static-camera', 180000, null),
    workload('continuous-orbit', 100000, orbitInputs),
    workload('fully-changing-cinematic-shake', 80000, changingInputs),
    workload('mixed-30-frame-keyframes', 140000, mixedInputs),
  ];

  const identityCache = new optimizedModule.CameraMatrixCache();
  const first = identityCache.resolve(staticRig, noShake, 16 / 9, lightDirection);
  const second = identityCache.resolve(staticRig, noShake, 16 / 9, lightDirection);
  const baselineFirst = baselineResolve(staticRig, noShake, 16 / 9);
  const baselineSecond = baselineResolve(staticRig, noShake, 16 / 9);
  const identity = {
    optimizedFrameReused: first === second,
    optimizedViewProjectionReused: first.viewProjection === second.viewProjection,
    optimizedLightViewProjectionReused: first.lightViewProjection === second.lightViewProjection,
    optimizedEyeReused: first.eye === second.eye,
    baselineFrameReused: baselineFirst === baselineSecond,
    baselineViewProjectionReused: baselineFirst.viewProjection === baselineSecond.viewProjection,
  };
  if (!identity.optimizedFrameReused || !identity.optimizedViewProjectionReused || !identity.optimizedLightViewProjectionReused || !identity.optimizedEyeReused) {
    throw new Error('optimized camera storage identity gate failed');
  }
  if (identity.baselineFrameReused || identity.baselineViewProjectionReused) {
    throw new Error('archived v1.10 unexpectedly reused camera storage');
  }

  const staticResult = workloads.find((entry) => entry.name === 'static-camera');
  const changingResults = workloads.filter((entry) => entry.name !== 'static-camera');
  const gates = {
    fidelity:
      maximumViewDifference <= fidelityCeiling &&
      maximumLightDifference <= fidelityCeiling &&
      maximumEyeDifference <= fidelityCeiling &&
      viewBitMismatches === 0 &&
      lightBitMismatches === 0 &&
      eyeValueMismatches === 0,
    staticSpeedup: staticResult.speedup >= 1.1,
    changingPathNoMaterialRegression: changingResults.every((entry) => entry.speedup >= 0.95),
  };
  const passed = Object.values(gates).every(Boolean);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      label: 'exact archived v1.10 source',
      archive: 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz',
      archiveSha256: sha256(archive),
      mainSha256: sha256(baselineMainPath),
      mathSha256: sha256(baselineMathPath),
      sourceContracts,
    },
    optimized: {
      cameraSha256: sha256(join(root, 'src/camera.ts')),
      mathSha256: sha256(join(root, 'src/math.ts')),
      sourceLevelHeapAllocationsPerResolve: 0,
      baselineSourceLevelHeapAllocationsPerResolveAtLeast: 22,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      samples: sampleCount,
      warmups: warmupCount,
      scale,
    },
    fidelity: {
      cases: 4096,
      ceiling: fidelityCeiling,
      maximumViewDifference,
      maximumLightDifference,
      maximumEyeDifference,
      viewBitMismatches,
      lightBitMismatches,
      eyeValueMismatches,
    },
    identity,
    workloads,
    gates,
    passed,
    sink,
  };

  if (writeResults) {
    const resultJson = join(root, 'benchmarks/results/camera-path-v110.json');
    const resultMarkdown = join(root, 'benchmarks/results/camera-path-v110.md');
    mkdirSync(dirname(resultJson), { recursive: true });
    writeFileSync(resultJson, `${JSON.stringify(report, null, 2)}\n`);
    const rows = workloads.map((entry) =>
      `| ${entry.name} | ${entry.baselineMedianNs.toFixed(2)} | ${entry.optimizedMedianNs.toFixed(2)} | ${entry.speedup.toFixed(3)}x |`,
    );
    writeFileSync(
      resultMarkdown,
      [
        '# Camera path benchmark versus archived v1.10',
        '',
        '| Workload | v1.10 ns/frame | optimized ns/frame | speedup |',
        '|---|---:|---:|---:|',
        ...rows,
        '',
        `- Fidelity cases: ${report.fidelity.cases}`,
        `- Maximum view-projection difference: ${maximumViewDifference}`,
        `- Maximum light-view-projection difference: ${maximumLightDifference}`,
        `- Maximum eye difference: ${maximumEyeDifference}`,
        `- Float32 view-projection bit mismatches: ${viewBitMismatches}`,
        `- Float32 light-view-projection bit mismatches: ${lightBitMismatches}`,
        `- Camera-eye value mismatches: ${eyeValueMismatches}`,
        `- Static result/object/typed-array identity reuse: ${identity.optimizedFrameReused ? 'passed' : 'failed'}`,
        `- Changing-path no-regression gate (>=0.95x): ${gates.changingPathNoMaterialRegression ? 'passed' : 'failed'}`,
        `- Overall decision: ${passed ? 'retain' : 'reject'}`,
        '',
        'The source-level allocation count is conservative and does not assume whether the JavaScript engine performs escape analysis.',
        '',
      ].join('\n'),
    );
  }

  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
