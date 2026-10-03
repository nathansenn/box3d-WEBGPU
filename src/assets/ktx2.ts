const KTX2_IDENTIFIER = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

const VK_FORMAT_R8_UNORM = 9;
const VK_FORMAT_R8G8B8A8_UNORM = 37;
const VK_FORMAT_R8G8B8A8_SRGB = 43;
const VK_FORMAT_BC4_UNORM_BLOCK = 139;
const VK_FORMAT_ASTC_6X6_UNORM_BLOCK = 165;
const VK_FORMAT_ASTC_6X6_SRGB_BLOCK = 166;

type KtxGpuFormatInfo = {
  format: GPUTextureFormat;
  blockWidth: number;
  blockHeight: number;
  bytesPerBlock: number;
  compressed: boolean;
};

const FORMAT_INFO: Readonly<Record<number, KtxGpuFormatInfo>> = {
  [VK_FORMAT_R8_UNORM]: { format: 'r8unorm', blockWidth: 1, blockHeight: 1, bytesPerBlock: 1, compressed: false },
  [VK_FORMAT_R8G8B8A8_UNORM]: { format: 'rgba8unorm', blockWidth: 1, blockHeight: 1, bytesPerBlock: 4, compressed: false },
  [VK_FORMAT_R8G8B8A8_SRGB]: { format: 'rgba8unorm-srgb', blockWidth: 1, blockHeight: 1, bytesPerBlock: 4, compressed: false },
  [VK_FORMAT_BC4_UNORM_BLOCK]: { format: 'bc4-r-unorm', blockWidth: 4, blockHeight: 4, bytesPerBlock: 8, compressed: true },
  [VK_FORMAT_ASTC_6X6_UNORM_BLOCK]: { format: 'astc-6x6-unorm', blockWidth: 6, blockHeight: 6, bytesPerBlock: 16, compressed: true },
  [VK_FORMAT_ASTC_6X6_SRGB_BLOCK]: { format: 'astc-6x6-unorm-srgb', blockWidth: 6, blockHeight: 6, bytesPerBlock: 16, compressed: true },
};

export type ParsedKtx2Level = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type ParsedKtx2 = {
  vkFormat: number;
  width: number;
  height: number;
  levelCount: number;
  levels: readonly ParsedKtx2Level[];
};

export type MaterialNoiseTexture = {
  texture: GPUTexture;
  view: GPUTextureView;
  sampler: GPUSampler;
  compressed: boolean;
  sourceBytes: number;
  source: 'ktx2-bc4' | 'ktx2-r8' | 'procedural-r8';
};

export type MaterialAtlasTexture = {
  albedoTexture: GPUTexture;
  albedoView: GPUTextureView;
  surfaceTexture: GPUTexture;
  surfaceView: GPUTextureView;
  sampler: GPUSampler;
  compressed: boolean;
  sourceBytes: number;
  source: 'poliigon-astc' | 'poliigon-rgba8' | 'procedural-atlas';
};

function readUint64(view: DataView, offset: number): number {
  if (typeof view.getBigUint64 === 'function') return Number(view.getBigUint64(offset, true));
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x100000000;
}

function formatInfo(vkFormat: number): KtxGpuFormatInfo {
  const info = FORMAT_INFO[vkFormat];
  if (!info) throw new Error(`Unsupported KTX2 VkFormat ${vkFormat}.`);
  return info;
}

export function parseKtx2(input: ArrayBuffer | Uint8Array): ParsedKtx2 {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 104) throw new Error('KTX2 payload is too short.');
  for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
    if (bytes[i] !== KTX2_IDENTIFIER[i]) throw new Error('KTX2 identifier mismatch.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vkFormat = view.getUint32(12, true);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const pixelDepth = view.getUint32(28, true);
  const layerCount = view.getUint32(32, true);
  const faceCount = view.getUint32(36, true);
  const levelCount = view.getUint32(40, true);
  const supercompression = view.getUint32(44, true);
  if (width <= 0 || height <= 0 || levelCount <= 0) throw new Error('KTX2 dimensions or mip count are invalid.');
  if (pixelDepth > 1 || layerCount > 1 || faceCount !== 1) {
    throw new Error(`Unsupported KTX2 layout (depth ${pixelDepth}, layers ${layerCount}, faces ${faceCount}); only single 2D images are supported.`);
  }
  if (supercompression !== 0) throw new Error(`Unsupported KTX2 supercompression scheme ${supercompression}.`);
  formatInfo(vkFormat);

  const levels: ParsedKtx2Level[] = [];
  for (let level = 0; level < levelCount; level++) {
    const entry = 80 + level * 24;
    const byteOffset = readUint64(view, entry);
    const byteLength = readUint64(view, entry + 8);
    if (!Number.isSafeInteger(byteOffset) || !Number.isSafeInteger(byteLength) || byteOffset < 0 || byteLength <= 0 || byteOffset + byteLength > bytes.byteLength) {
      throw new Error(`KTX2 mip ${level} points outside the payload.`);
    }
    levels.push({
      data: new Uint8Array(bytes.buffer, bytes.byteOffset + byteOffset, byteLength),
      width: Math.max(1, width >> level),
      height: Math.max(1, height >> level),
    });
  }
  return { vkFormat, width, height, levelCount, levels };
}

function align256(value: number): number {
  return (value + 255) & ~255;
}

function uploadLevel(
  device: GPUDevice,
  texture: GPUTexture,
  level: ParsedKtx2Level,
  mipLevel: number,
  info: KtxGpuFormatInfo,
): void {
  const blockCols = Math.max(1, Math.ceil(level.width / info.blockWidth));
  const blockRows = Math.max(1, Math.ceil(level.height / info.blockHeight));
  const tightBytesPerRow = blockCols * info.bytesPerBlock;
  const bytesPerRow = align256(tightBytesPerRow);
  let upload = level.data;
  if (bytesPerRow !== tightBytesPerRow) {
    upload = new Uint8Array(bytesPerRow * blockRows);
    for (let row = 0; row < blockRows; row++) {
      upload.set(level.data.subarray(row * tightBytesPerRow, (row + 1) * tightBytesPerRow), row * bytesPerRow);
    }
  }
  device.queue.writeTexture(
    { texture, mipLevel, origin: [0, 0, 0] },
    upload as unknown as BufferSource,
    { offset: 0, bytesPerRow, rowsPerImage: blockRows },
    { width: level.width, height: level.height, depthOrArrayLayers: 1 },
  );
}

export function alignedMipPrefix<T extends { width: number; height: number }>(
  levels: readonly T[],
  info: { blockWidth: number; blockHeight: number },
): T[] {
  const end = levels.findIndex((level) => !(
    level.width >= info.blockWidth
    && level.height >= info.blockHeight
    && level.width % info.blockWidth === 0
    && level.height % info.blockHeight === 0
  ));
  return end < 0 ? [...levels] : levels.slice(0, end);
}

function createGpuTextureFromParsed(device: GPUDevice, parsed: ParsedKtx2, label: string): {
  texture: GPUTexture;
  view: GPUTextureView;
  compressed: boolean;
  sourceBytes: number;
} {
  const info = formatInfo(parsed.vkFormat);
  // Strict WebGPU implementations require compressed copy extents to remain
  // complete block multiples. Keep the consecutive block-aligned prefix of
  // the source chain; trilinear sampling naturally clamps to its final
  // resident level (126x126 for ASTC 6x6, 4x4 for BC4).
  const uploadedLevels = info.compressed ? alignedMipPrefix(parsed.levels, info) : parsed.levels;
  if (uploadedLevels.length === 0) throw new Error('KTX2 texture has no uploadable mip levels.');
  const texture = device.createTexture({
    label,
    size: [parsed.width, parsed.height, 1],
    mipLevelCount: uploadedLevels.length,
    format: info.format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  for (let level = 0; level < uploadedLevels.length; level++) uploadLevel(device, texture, uploadedLevels[level], level, info);
  return {
    texture,
    view: texture.createView(),
    compressed: info.compressed,
    sourceBytes: parsed.levels.reduce((sum, level) => sum + level.data.byteLength, 0),
  };
}

function createNoiseTextureFromParsed(device: GPUDevice, parsed: ParsedKtx2): MaterialNoiseTexture {
  const compressed = parsed.vkFormat === VK_FORMAT_BC4_UNORM_BLOCK;
  if (!compressed && parsed.vkFormat !== VK_FORMAT_R8_UNORM) throw new Error('Material noise must be BC4 or R8.');
  const gpu = createGpuTextureFromParsed(device, parsed, compressed ? 'KTX2 BC4 material micro-noise' : 'KTX2 R8 material micro-noise');
  const sampler = device.createSampler({
    label: 'Material micro-noise trilinear sampler',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 4,
  });
  return {
    ...gpu,
    sampler,
    source: compressed ? 'ktx2-bc4' : 'ktx2-r8',
  };
}

function proceduralNoiseFallback(device: GPUDevice): MaterialNoiseTexture {
  const width = 64;
  const height = 64;
  const data = new Uint8Array(width * height);
  let state = 0x51ed270b;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = state & 0xff;
  }
  const parsed: ParsedKtx2 = {
    vkFormat: VK_FORMAT_R8_UNORM,
    width,
    height,
    levelCount: 1,
    levels: [{ data, width, height }],
  };
  const result = createNoiseTextureFromParsed(device, parsed);
  return { ...result, source: 'procedural-r8' };
}

function proceduralAtlasFallback(device: GPUDevice): MaterialAtlasTexture {
  const tile = 32;
  const width = tile * 2;
  const height = tile * 2;
  const albedo = new Uint8Array(width * height * 4);
  const surface = new Uint8Array(width * height * 4);
  const colors = [
    [128, 132, 133], // weathered concrete
    [158, 166, 171], // galvanized metal
    [168, 76, 32],   // woven safety fabric
    [122, 126, 130], // honed stone
  ] as const;
  const roughness = [205, 105, 225, 184] as const;
  let state = 0x7a11c0de;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileIndex = (x >= tile ? 1 : 0) + (y >= tile ? 2 : 0);
      state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
      const grain = ((state >>> 24) & 31) - 15;
      const offset = (y * width + x) * 4;
      const color = colors[tileIndex];
      albedo[offset] = Math.max(0, Math.min(255, color[0] + grain));
      albedo[offset + 1] = Math.max(0, Math.min(255, color[1] + grain));
      albedo[offset + 2] = Math.max(0, Math.min(255, color[2] + grain));
      albedo[offset + 3] = 255;
      surface[offset] = 128 + Math.trunc(grain * 0.35);
      surface[offset + 1] = 128 + Math.trunc(grain * 0.25);
      surface[offset + 2] = 255;
      surface[offset + 3] = roughness[tileIndex];
    }
  }
  const albedoGpu = createGpuTextureFromParsed(device, {
    vkFormat: VK_FORMAT_R8G8B8A8_SRGB,
    width, height, levelCount: 1, levels: [{ data: albedo, width, height }],
  }, 'Procedural AAA material albedo atlas');
  const surfaceGpu = createGpuTextureFromParsed(device, {
    vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
    width, height, levelCount: 1, levels: [{ data: surface, width, height }],
  }, 'Procedural AAA material normal-roughness atlas');
  const sampler = device.createSampler({
    label: 'AAA material atlas trilinear sampler',
    addressModeU: 'repeat', addressModeV: 'repeat',
    magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
  return {
    albedoTexture: albedoGpu.texture,
    albedoView: albedoGpu.view,
    surfaceTexture: surfaceGpu.texture,
    surfaceView: surfaceGpu.view,
    sampler,
    compressed: false,
    sourceBytes: albedo.byteLength + surface.byteLength,
    source: 'procedural-atlas',
  };
}

async function fetchKtx2(file: string): Promise<ParsedKtx2> {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  const response = await fetch(new URL(`textures/${file}`, base));
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return parseKtx2(new Uint8Array(await response.arrayBuffer()));
}

export async function loadMaterialNoiseTexture(device: GPUDevice, supportsBc: boolean): Promise<MaterialNoiseTexture> {
  const file = supportsBc ? 'material-noise-bc4.ktx2' : 'material-noise-r8.ktx2';
  try {
    const parsed = await fetchKtx2(file);
    if (supportsBc && parsed.vkFormat !== VK_FORMAT_BC4_UNORM_BLOCK) throw new Error('Expected BC4 KTX2 payload.');
    if (!supportsBc && parsed.vkFormat !== VK_FORMAT_R8_UNORM) throw new Error('Expected R8 KTX2 payload.');
    return createNoiseTextureFromParsed(device, parsed);
  } catch (error) {
    console.warn(`[WebGPU] ${file} unavailable; using deterministic R8 fallback.`, error);
    return proceduralNoiseFallback(device);
  }
}

export async function loadMaterialAtlasTexture(device: GPUDevice, supportsAstc: boolean): Promise<MaterialAtlasTexture> {
  const variant = supportsAstc ? 'astc' : 'rgba8';
  const albedoFile = `poliigon-materials-albedo-${variant}.ktx2`;
  const surfaceFile = `poliigon-materials-surface-${variant}.ktx2`;
  try {
    const [albedo, surface] = await Promise.all([fetchKtx2(albedoFile), fetchKtx2(surfaceFile)]);
    const expectedAlbedo = supportsAstc ? VK_FORMAT_ASTC_6X6_SRGB_BLOCK : VK_FORMAT_R8G8B8A8_SRGB;
    const expectedSurface = supportsAstc ? VK_FORMAT_ASTC_6X6_UNORM_BLOCK : VK_FORMAT_R8G8B8A8_UNORM;
    if (albedo.vkFormat !== expectedAlbedo || surface.vkFormat !== expectedSurface) {
      throw new Error(`Unexpected Poliigon atlas formats ${albedo.vkFormat}/${surface.vkFormat}.`);
    }
    if (albedo.width !== surface.width || albedo.height !== surface.height) throw new Error('Poliigon atlas dimensions do not match.');
    const albedoGpu = createGpuTextureFromParsed(device, albedo, 'Poliigon AAA albedo atlas');
    const surfaceGpu = createGpuTextureFromParsed(device, surface, 'Poliigon AAA normal-roughness atlas');
    const sampler = device.createSampler({
      label: 'Poliigon material atlas trilinear sampler',
      addressModeU: 'repeat', addressModeV: 'repeat',
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      maxAnisotropy: 8,
    });
    return {
      albedoTexture: albedoGpu.texture,
      albedoView: albedoGpu.view,
      surfaceTexture: surfaceGpu.texture,
      surfaceView: surfaceGpu.view,
      sampler,
      compressed: supportsAstc,
      sourceBytes: albedoGpu.sourceBytes + surfaceGpu.sourceBytes,
      source: supportsAstc ? 'poliigon-astc' : 'poliigon-rgba8',
    };
  } catch (error) {
    console.warn(`[WebGPU] Poliigon ${variant} material atlases unavailable; using deterministic procedural materials.`, error);
    return proceduralAtlasFallback(device);
  }
}
