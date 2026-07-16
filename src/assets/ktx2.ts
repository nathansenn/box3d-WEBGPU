const KTX2_IDENTIFIER = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const VK_FORMAT_R8_UNORM = 9;
const VK_FORMAT_BC4_UNORM_BLOCK = 139;

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

function readUint64(view: DataView, offset: number): number {
  if (typeof view.getBigUint64 === 'function') return Number(view.getBigUint64(offset, true));
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x100000000;
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
  const levelCount = view.getUint32(40, true);
  const supercompression = view.getUint32(44, true);
  if (width <= 0 || height <= 0 || levelCount <= 0) throw new Error('KTX2 dimensions or mip count are invalid.');
  if (supercompression !== 0) throw new Error(`Unsupported KTX2 supercompression scheme ${supercompression}.`);
  if (vkFormat !== VK_FORMAT_R8_UNORM && vkFormat !== VK_FORMAT_BC4_UNORM_BLOCK) {
    throw new Error(`Unsupported KTX2 VkFormat ${vkFormat}.`);
  }

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
  compressed: boolean,
): void {
  const blockWidth = compressed ? 4 : 1;
  const blockHeight = compressed ? 4 : 1;
  const bytesPerBlock = compressed ? 8 : 1;
  const blockCols = Math.max(1, Math.ceil(level.width / blockWidth));
  const blockRows = Math.max(1, Math.ceil(level.height / blockHeight));
  const tightBytesPerRow = blockCols * bytesPerBlock;
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

function createTextureFromParsed(device: GPUDevice, parsed: ParsedKtx2): MaterialNoiseTexture {
  const compressed = parsed.vkFormat === VK_FORMAT_BC4_UNORM_BLOCK;
  const format: GPUTextureFormat = compressed ? 'bc4-r-unorm' : 'r8unorm';
  // WebGPU copy validation requires compressed copy extents to be whole 4x4
  // blocks. Stop the BC4 chain at 4x4; sampling beyond that level naturally
  // clamps to the last resident mip and avoids illegal 2x2/1x1 writes.
  const uploadedLevels = compressed
    ? parsed.levels.filter((level) => level.width >= 4 && level.height >= 4)
    : parsed.levels;
  if (uploadedLevels.length === 0) throw new Error('KTX2 texture has no uploadable mip levels.');
  const texture = device.createTexture({
    label: compressed ? 'KTX2 BC4 material micro-noise' : 'KTX2 R8 material micro-noise',
    size: [parsed.width, parsed.height, 1],
    mipLevelCount: uploadedLevels.length,
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  for (let level = 0; level < uploadedLevels.length; level++) uploadLevel(device, texture, uploadedLevels[level], level, compressed);
  const sampler = device.createSampler({
    label: 'Material micro-noise trilinear sampler',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  return {
    texture,
    view: texture.createView(),
    sampler,
    compressed,
    sourceBytes: parsed.levels.reduce((sum, level) => sum + level.data.byteLength, 0),
    source: compressed ? 'ktx2-bc4' : 'ktx2-r8',
  };
}

function proceduralFallback(device: GPUDevice): MaterialNoiseTexture {
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
  const result = createTextureFromParsed(device, parsed);
  return { ...result, source: 'procedural-r8' };
}

export async function loadMaterialNoiseTexture(device: GPUDevice, supportsBc: boolean): Promise<MaterialNoiseTexture> {
  const file = supportsBc ? 'material-noise-bc4.ktx2' : 'material-noise-r8.ktx2';
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
    const response = await fetch(new URL(`textures/${file}`, base));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsed = parseKtx2(bytes);
    if (supportsBc && parsed.vkFormat !== VK_FORMAT_BC4_UNORM_BLOCK) throw new Error('Expected BC4 KTX2 payload.');
    if (!supportsBc && parsed.vkFormat !== VK_FORMAT_R8_UNORM) throw new Error('Expected R8 KTX2 payload.');
    return createTextureFromParsed(device, parsed);
  } catch (error) {
    console.warn(`[WebGPU] ${file} unavailable; using deterministic R8 fallback.`, error);
    return proceduralFallback(device);
  }
}
