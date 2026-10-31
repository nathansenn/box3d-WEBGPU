import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createServer } from 'vite';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textureDir = path.join(root, 'public', 'textures');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-ktx2-runtime-'));
const modulePath = path.join(tempDir, 'ktx2.mjs');
const VK_FORMAT_R8_UNORM = 9;
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const VK_FORMAT_R8G8B8A8_SRGB = 43;
const VK_FORMAT_BC4_UNORM_BLOCK = 139;
const VK_FORMAT_ASTC_6X6_UNORM_BLOCK = 165;
const VK_FORMAT_ASTC_6X6_SRGB_BLOCK = 166;
const POLIIGON_ATLAS_SIZE = 1008;
const POLIIGON_ATLAS_MIPS = 10;
const dawnBackend = process.env.KTX2_DAWN_BACKEND ?? 'null';
const expectedIdentifier = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

const loaderSource = fs.readFileSync(path.join(root, 'src', 'assets', 'ktx2.ts'), 'utf8');
fs.writeFileSync(modulePath, ts.transpileModule(loaderSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  fileName: 'ktx2.ts',
}).outputText);

const { loadMaterialAtlasTexture, loadMaterialNoiseTexture, parseKtx2 } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

function levelPayloadBytes(format, width, height) {
  if (format === VK_FORMAT_R8_UNORM) return width * height;
  return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 8;
}

function validateAssetStructure(fileName, expectedFormat) {
  const filePath = path.join(textureDir, fileName);
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual(bytes.subarray(0, expectedIdentifier.length), expectedIdentifier, `${fileName} must have the KTX2 identifier`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(12, true), expectedFormat, `${fileName} VkFormat`);
  assert.equal(view.getUint32(16, true), 1, `${fileName} typeSize`);
  assert.equal(view.getUint32(20, true), 256, `${fileName} width`);
  assert.equal(view.getUint32(24, true), 256, `${fileName} height`);
  assert.equal(view.getUint32(28, true), 0, `${fileName} must be a 2D texture`);
  assert.equal(view.getUint32(32, true), 0, `${fileName} must not be an array texture`);
  assert.equal(view.getUint32(36, true), 1, `${fileName} faceCount`);
  assert.equal(view.getUint32(40, true), 9, `${fileName} must carry the complete 256-to-1 mip chain`);
  assert.equal(view.getUint32(44, true), 0, `${fileName} must be directly uploadable without supercompression`);

  const parsed = parseKtx2(bytes);
  assert.equal(parsed.vkFormat, expectedFormat);
  assert.equal(parsed.width, 256);
  assert.equal(parsed.height, 256);
  assert.equal(parsed.levelCount, 9);
  assert.equal(parsed.levels.length, 9);
  const ranges = [];
  for (let level = 0; level < parsed.levels.length; level++) {
    const mip = parsed.levels[level];
    const expectedWidth = Math.max(1, 256 >> level);
    const expectedHeight = Math.max(1, 256 >> level);
    assert.equal(mip.width, expectedWidth, `${fileName} mip ${level} width`);
    assert.equal(mip.height, expectedHeight, `${fileName} mip ${level} height`);
    assert.equal(mip.data.byteLength, levelPayloadBytes(expectedFormat, expectedWidth, expectedHeight), `${fileName} mip ${level} payload size`);
    const entry = 80 + level * 24;
    const offset = Number(view.getBigUint64(entry, true));
    const length = Number(view.getBigUint64(entry + 8, true));
    const uncompressedLength = Number(view.getBigUint64(entry + 16, true));
    assert.equal(length, mip.data.byteLength, `${fileName} mip ${level} level-index size`);
    assert.equal(uncompressedLength, length, `${fileName} mip ${level} direct-upload size`);
    assert.ok(offset >= 80 + parsed.levelCount * 24, `${fileName} mip ${level} must follow the level index`);
    assert.ok(offset + length <= bytes.byteLength, `${fileName} mip ${level} must remain inside the file`);
    ranges.push([offset, offset + length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] >= ranges[i - 1][1], `${fileName} mip ranges must not overlap`);

  const padded = new Uint8Array(bytes.byteLength + 31);
  padded.set(bytes, 17);
  const parsedFromView = parseKtx2(padded.subarray(17, 17 + bytes.byteLength));
  assert.equal(parsedFromView.levels[0].data.byteLength, parsed.levels[0].data.byteLength, `${fileName} parser must respect Uint8Array byte offsets`);
  return { fileName, fileBytes: bytes.byteLength, parsed };
}

function validateAtlasStructure(fileName, expectedFormat) {
  const bytes = fs.readFileSync(path.join(textureDir, fileName));
  const parsed = parseKtx2(bytes);
  assert.equal(parsed.vkFormat, expectedFormat, `${fileName} VkFormat`);
  assert.equal(parsed.width, POLIIGON_ATLAS_SIZE, `${fileName} width`);
  assert.equal(parsed.height, POLIIGON_ATLAS_SIZE, `${fileName} height`);
  assert.equal(parsed.levelCount, POLIIGON_ATLAS_MIPS, `${fileName} full mip chain`);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(44, true), 0, `${fileName} must be directly uploadable`);
  return { fileName, fileBytes: bytes.byteLength, parsed };
}

function validateParserRejections(validBytes) {
  assert.throws(() => parseKtx2(new Uint8Array(12)), /too short/);
  const badIdentifier = Uint8Array.from(validBytes);
  badIdentifier[0] ^= 0xff;
  assert.throws(() => parseKtx2(badIdentifier), /identifier mismatch/);
  const unsupportedFormat = Uint8Array.from(validBytes);
  new DataView(unsupportedFormat.buffer).setUint32(12, 999, true);
  assert.throws(() => parseKtx2(unsupportedFormat), /Unsupported KTX2 VkFormat/);
  const supercompressed = Uint8Array.from(validBytes);
  new DataView(supercompressed.buffer).setUint32(44, 2, true);
  assert.throws(() => parseKtx2(supercompressed), /Unsupported KTX2 supercompression/);
  const invalidLevel = Uint8Array.from(validBytes);
  new DataView(invalidLevel.buffer).setBigUint64(80, BigInt(invalidLevel.byteLength + 8), true);
  assert.throws(() => parseKtx2(invalidLevel), /points outside the payload/);
}

async function sampleTexture(device, material) {
  const output = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const module = device.createShaderModule({
    code: `
      @group(0) @binding(0) var materialTexture: texture_2d<f32>;
      @group(0) @binding(1) var materialSampler: sampler;
      @group(0) @binding(2) var<storage, read_write> result: array<f32>;
      @compute @workgroup_size(1)
      fn main() {
        result[0] = textureSampleLevel(materialTexture, materialSampler, vec2<f32>(0.371, 0.619), 0.0).r;
      }
    `,
  });
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: material.view },
      { binding: 1, resource: material.sampler },
      { binding: 2, resource: { buffer: output } },
    ],
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(output, 0, readback, 0, 4);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  await readback.mapAsync(GPUMapMode.READ);
  const mapped = readback.getMappedRange();
  // Dawn null validates the command sequence without executing texture sampling.
  const value = dawnBackend === 'null' ? null : new Float32Array(mapped.slice(0))[0];
  readback.unmap();
  output.destroy();
  readback.destroy();
  if (dawnBackend === 'null') return null;
  assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${material.source} sampled value must be normalized`);
  return value;
}

async function loadWithValidationScope(device, supportsBc) {
  device.pushErrorScope('validation');
  const material = await loadMaterialNoiseTexture(device, supportsBc);
  await device.queue.onSubmittedWorkDone();
  const error = await device.popErrorScope();
  assert.equal(error, null, error?.message ?? 'KTX2 upload must have no WebGPU validation error');
  return material;
}

let vite;
const devices = [];
const materials = [];
const atlasTextures = [];
const nativeFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalWarn = console.warn;

try {
  const r8 = validateAssetStructure('material-noise-r8.ktx2', VK_FORMAT_R8_UNORM);
  const bc4 = validateAssetStructure('material-noise-bc4.ktx2', VK_FORMAT_BC4_UNORM_BLOCK);
  const atlasAssets = [
    validateAtlasStructure('poliigon-materials-albedo-rgba8.ktx2', VK_FORMAT_R8G8B8A8_SRGB),
    validateAtlasStructure('poliigon-materials-surface-rgba8.ktx2', VK_FORMAT_R8G8B8A8_UNORM),
    validateAtlasStructure('poliigon-materials-albedo-astc.ktx2', VK_FORMAT_ASTC_6X6_SRGB_BLOCK),
    validateAtlasStructure('poliigon-materials-surface-astc.ktx2', VK_FORMAT_ASTC_6X6_UNORM_BLOCK),
  ];
  validateParserRejections(fs.readFileSync(path.join(textureDir, 'material-noise-r8.ktx2')));

  vite = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address && typeof address === 'object', 'Vite must expose its test port');
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { baseURI: baseUrl } });

  for (const asset of [r8, bc4, ...atlasAssets]) {
    const response = await nativeFetch(new URL(`textures/${asset.fileName}`, baseUrl));
    assert.equal(response.status, 200, `${asset.fileName} must be served`);
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/ktx2', `${asset.fileName} MIME type`);
    assert.equal(Number(response.headers.get('content-length')), asset.fileBytes, `${asset.fileName} served byte length`);
    assert.equal((await response.arrayBuffer()).byteLength, asset.fileBytes, `${asset.fileName} response must be complete`);
  }

  const r8Gpu = create([`backend=${dawnBackend}`]);
  const adapter = await r8Gpu.requestAdapter();
  assert.ok(adapter, `Dawn ${dawnBackend} adapter must be available`);

  const r8Device = await adapter.requestDevice();
  devices.push(r8Device);
  const r8Errors = [];
  r8Device.addEventListener?.('uncapturederror', (event) => r8Errors.push(event.error?.message ?? String(event.error)));
  const r8Material = await loadWithValidationScope(r8Device, false);
  materials.push(r8Material);
  assert.equal(r8Material.source, 'ktx2-r8');
  assert.equal(r8Material.compressed, false);
  assert.equal(r8Material.sourceBytes, 87_381, 'R8 source mip payload bytes');
  assert.equal(r8Material.texture.width, 256);
  assert.equal(r8Material.texture.height, 256);
  assert.equal(r8Material.texture.mipLevelCount, 9);
  const r8Sample = await sampleTexture(r8Device, r8Material);
  assert.deepEqual(r8Errors, [], `R8 path uncaptured errors: ${r8Errors.join('; ')}`);

  r8Device.pushErrorScope('validation');
  const rgbaAtlas = await loadMaterialAtlasTexture(r8Device, false);
  await r8Device.queue.onSubmittedWorkDone();
  const atlasError = await r8Device.popErrorScope();
  assert.equal(atlasError, null, atlasError?.message ?? 'RGBA8 atlas upload must have no WebGPU validation error');
  assert.equal(rgbaAtlas.source, 'poliigon-rgba8');
  assert.equal(rgbaAtlas.compressed, false);
  assert.equal(rgbaAtlas.albedoTexture.width, POLIIGON_ATLAS_SIZE);
  assert.equal(rgbaAtlas.albedoTexture.height, POLIIGON_ATLAS_SIZE);
  atlasTextures.push(rgbaAtlas.albedoTexture, rgbaAtlas.surfaceTexture);
  const atlasSample = await sampleTexture(r8Device, { view: rgbaAtlas.albedoView, sampler: rgbaAtlas.sampler, source: rgbaAtlas.source });

  const supportsBc = adapter.features.has('texture-compression-bc');
  let bc4Result = { supported: false };
  if (supportsBc) {
    const bc4Gpu = create([`backend=${dawnBackend}`]);
    const bc4Adapter = await bc4Gpu.requestAdapter();
    assert.ok(bc4Adapter?.features.has('texture-compression-bc'), 'Dawn BC4 adapter must expose texture-compression-bc');
    const bc4Device = await bc4Adapter.requestDevice({ requiredFeatures: ['texture-compression-bc'] });
    devices.push(bc4Device);
    const bc4Errors = [];
    bc4Device.addEventListener?.('uncapturederror', (event) => bc4Errors.push(event.error?.message ?? String(event.error)));
    const bc4Material = await loadWithValidationScope(bc4Device, true);
    materials.push(bc4Material);
    assert.equal(bc4Material.source, 'ktx2-bc4');
    assert.equal(bc4Material.compressed, true);
    assert.equal(bc4Material.sourceBytes, 43_704, 'BC4 source mip payload bytes');
    assert.equal(bc4Material.texture.width, 256);
    assert.equal(bc4Material.texture.height, 256);
    assert.equal(bc4Material.texture.mipLevelCount, 7, 'BC4 resident chain must stop at the complete 4x4 block level');
    const bc4Sample = await sampleTexture(bc4Device, bc4Material);
    if (dawnBackend !== 'null') {
      assert.ok(Math.abs(bc4Sample - r8Sample) < 0.1, 'BC4 and R8 hardware samples must remain perceptually close');
    }
    assert.deepEqual(bc4Errors, [], `BC4 path uncaptured errors: ${bc4Errors.join('; ')}`);
    bc4Result = { supported: true, sample: bc4Sample, residentMipLevels: bc4Material.texture.mipLevelCount };
  }

  const supportsAstc = adapter.features.has('texture-compression-astc');
  let astcAtlasResult = { supported: false };
  if (supportsAstc) {
    const astcGpu = create([`backend=${dawnBackend}`]);
    const astcAdapter = await astcGpu.requestAdapter();
    assert.ok(astcAdapter?.features.has('texture-compression-astc'), 'Dawn ASTC adapter must expose texture-compression-astc');
    const astcDevice = await astcAdapter.requestDevice({ requiredFeatures: ['texture-compression-astc'] });
    devices.push(astcDevice);
    const astcErrors = [];
    astcDevice.addEventListener?.('uncapturederror', (event) => astcErrors.push(event.error?.message ?? String(event.error)));
    astcDevice.pushErrorScope('validation');
    const astcAtlas = await loadMaterialAtlasTexture(astcDevice, true);
    await astcDevice.queue.onSubmittedWorkDone();
    const astcError = await astcDevice.popErrorScope();
    assert.equal(astcError, null, astcError?.message ?? 'ASTC atlas upload must have no WebGPU validation error');
    assert.equal(astcAtlas.source, 'poliigon-astc');
    assert.equal(astcAtlas.compressed, true);
    assert.equal(astcAtlas.albedoTexture.width, POLIIGON_ATLAS_SIZE);
    assert.equal(astcAtlas.albedoTexture.height, POLIIGON_ATLAS_SIZE);
    atlasTextures.push(astcAtlas.albedoTexture, astcAtlas.surfaceTexture);
    const astcSample = await sampleTexture(astcDevice, { view: astcAtlas.albedoView, sampler: astcAtlas.sampler, source: astcAtlas.source });
    if (dawnBackend !== 'null') {
      assert.ok(Math.abs(astcSample - atlasSample) < 0.2, 'ASTC and RGBA8 atlas samples must remain perceptually close');
    }
    assert.deepEqual(astcErrors, [], `ASTC path uncaptured errors: ${astcErrors.join('; ')}`);
    astcAtlasResult = {
      supported: true,
      sample: astcSample,
      dimensions: [astcAtlas.albedoTexture.width, astcAtlas.albedoTexture.height],
      residentMipLevels: astcAtlas.albedoTexture.mipLevelCount,
    };
  }

  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => { throw new Error('intentional KTX2 fallback test'); },
  });
  const fallbackMaterial = await loadWithValidationScope(r8Device, false);
  materials.push(fallbackMaterial);
  assert.equal(fallbackMaterial.source, 'procedural-r8');
  assert.equal(fallbackMaterial.compressed, false);
  assert.equal(fallbackMaterial.sourceBytes, 64 * 64);
  assert.equal(fallbackMaterial.texture.width, 64);
  assert.equal(fallbackMaterial.texture.height, 64);
  assert.equal(fallbackMaterial.texture.mipLevelCount, 1);
  const fallbackSample = await sampleTexture(r8Device, fallbackMaterial);
  assert.equal(warnings.length, 1, 'fallback must emit one diagnostic warning');
  assert.match(warnings[0], /using deterministic R8 fallback/);

  console.log(JSON.stringify({
    result: 'passed',
    files: {
      r8: { bytes: r8.fileBytes, sourceMipLevels: r8.parsed.levelCount },
      bc4: { bytes: bc4.fileBytes, sourceMipLevels: bc4.parsed.levelCount },
    },
    serving: { baseUrl, mime: 'image/ktx2' },
    dawn: {
      backend: dawnBackend,
      numericalSampling: dawnBackend === 'null'
        ? { status: 'NOT_EXECUTED', reason: 'Dawn null is a validation-only backend.' }
        : { status: 'PASSED' },
      r8: { sample: r8Sample, residentMipLevels: r8Material.texture.mipLevelCount },
      bc4: bc4Result,
      proceduralFallback: { sample: fallbackSample, residentMipLevels: fallbackMaterial.texture.mipLevelCount },
      poliigonRgba8Atlas: { sample: atlasSample, dimensions: [POLIIGON_ATLAS_SIZE, POLIIGON_ATLAS_SIZE], tiles: 4 },
      poliigonAstcAtlas: astcAtlasResult,
      uncapturedErrors: 0,
    },
    parserRejections: 5,
  }, null, 2));
} finally {
  console.warn = originalWarn;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: nativeFetch });
  if (originalDocument === undefined) delete globalThis.document;
  else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  for (const material of materials) material.texture.destroy();
  for (const texture of atlasTextures) texture.destroy();
  for (const device of devices) device.destroy?.();
  await vite?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
