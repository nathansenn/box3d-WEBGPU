export const SOFT_KERNEL_ABI_VERSION = 0x00010100;

export type SoftKernelVariant = 'simd' | 'scalar' | 'javascript';
export type SoftWasmPointer = number;

export interface SoftKernelExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  soft_version(): number;
  soft_variant(): number;
  soft_reset(): void;
  soft_heap_offset(): number;
  soft_alloc(byteCount: number, alignment: number): SoftWasmPointer;
  soft_vector_add_one(output: SoftWasmPointer, input: SoftWasmPointer): void;
  soft_cloth_project(
    positions: SoftWasmPointer,
    indicesA: SoftWasmPointer,
    indicesB: SoftWasmPointer,
    restLengths: SoftWasmPointer,
    scaleA: SoftWasmPointer,
    scaleB: SoftWasmPointer,
    broken: SoftWasmPointer,
    constraintCount: number,
    iterations: number,
  ): number;
  soft_cloth_integrate(
    positions: SoftWasmPointer,
    previous: SoftWasmPointer,
    inverseMass: SoftWasmPointer,
    windSinA: SoftWasmPointer,
    windCosA: SoftWasmPointer,
    windSinB: SoftWasmPointer,
    windCosB: SoftWasmPointer,
    windSinZ: SoftWasmPointer,
    windCosZ: SoftWasmPointer,
    edgeFactors: SoftWasmPointer,
    particleCount: number,
    dtSquared: number,
    drag: number,
    gust: number,
    sinA: number,
    cosA: number,
    sinB: number,
    cosB: number,
    sinZ: number,
    cosZ: number,
    zScale: number,
    variantLift: number,
    verticalLayout: number,
  ): number;
  soft_cloth_solve(
    positions: SoftWasmPointer,
    previous: SoftWasmPointer,
    inverseMass: SoftWasmPointer,
    indicesA: SoftWasmPointer,
    indicesB: SoftWasmPointer,
    restLengths: SoftWasmPointer,
    scaleA: SoftWasmPointer,
    scaleB: SoftWasmPointer,
    broken: SoftWasmPointer,
    particleCount: number,
    constraintCount: number,
    iterations: number,
    floorHeight: number,
    groundSlide: number,
    sphereX: number,
    sphereY: number,
    sphereZ: number,
    sphereRadius: number,
  ): number;
  soft_rope_project(
    positions: SoftWasmPointer,
    indicesA: SoftWasmPointer,
    indicesB: SoftWasmPointer,
    restLengths: SoftWasmPointer,
    inverseRestLengths: SoftWasmPointer,
    scaleA: SoftWasmPointer,
    scaleB: SoftWasmPointer,
    broken: SoftWasmPointer,
    render: SoftWasmPointer,
    breakThresholds: SoftWasmPointer,
    constraintCount: number,
    iterations: number,
    breakBudget: number,
  ): number;
  soft_water_step(
    eta: SoftWasmPointer,
    velocityX: SoftWasmPointer,
    velocityZ: SoftWasmPointer,
    nextEta: SoftWasmPointer,
    nextVelocityX: SoftWasmPointer,
    nextVelocityZ: SoftWasmPointer,
    cols: number,
    rows: number,
    dt: number,
    gravity: number,
    meanDepth: number,
    drag: number,
    inverseTwoDx: number,
    inverseTwoDz: number,
  ): number;
}

export interface SoftConstraintPointers {
  positions: SoftWasmPointer;
  indicesA: SoftWasmPointer;
  indicesB: SoftWasmPointer;
  restLengths: SoftWasmPointer;
  scaleA: SoftWasmPointer;
  scaleB: SoftWasmPointer;
  broken: SoftWasmPointer;
}

export interface ClothStepPointers extends SoftConstraintPointers {
  previous: SoftWasmPointer;
  inverseMass: SoftWasmPointer;
  windSinA: SoftWasmPointer;
  windCosA: SoftWasmPointer;
  windSinB: SoftWasmPointer;
  windCosB: SoftWasmPointer;
  windSinZ: SoftWasmPointer;
  windCosZ: SoftWasmPointer;
  edgeFactors: SoftWasmPointer;
}

export interface RopeConstraintPointers extends SoftConstraintPointers {
  inverseRestLengths: SoftWasmPointer;
  render: SoftWasmPointer;
  breakThresholds: SoftWasmPointer;
}

export interface WaterKernelPointers {
  eta: SoftWasmPointer;
  velocityX: SoftWasmPointer;
  velocityZ: SoftWasmPointer;
  nextEta: SoftWasmPointer;
  nextVelocityX: SoftWasmPointer;
  nextVelocityZ: SoftWasmPointer;
}

export interface SoftKernelLoadOptions {
  simdUrl?: string | URL;
  scalarUrl?: string | URL;
  loadBytes?: (source: string | URL) => Promise<ArrayBuffer>;
  fetch?: typeof globalThis.fetch;
}

export interface SoftKernelRuntime {
  readonly available: boolean;
  readonly variant: SoftKernelVariant;
  readonly module: SoftKernelModule | null;
  readonly reason?: string;
}

export interface SoftWasmAllocation {
  readonly pointer: SoftWasmPointer;
  readonly byteLength: number;
}

const JAVASCRIPT_SOFT_KERNEL_RUNTIME: SoftKernelRuntime = {
  available: false,
  variant: 'javascript',
  module: null,
  reason: 'soft-kernel WebAssembly has not been initialized',
};

let activeRuntime: SoftKernelRuntime = JAVASCRIPT_SOFT_KERNEL_RUNTIME;
let initialization: Promise<SoftKernelRuntime> | null = null;

function defaultAssetUrl(fileName: string): string {
  if (typeof document !== 'undefined') {
    return new URL(fileName, document.baseURI).href;
  }
  return `/${fileName}`;
}

function assertKernelExports(value: WebAssembly.Exports): SoftKernelExports {
  // Do not name this local `exports`: the CommonJS test build uses that
  // identifier for the module namespace and would otherwise rewrite the ABI
  // constant lookup against the WebAssembly export object.
  const wasmExports = value as Partial<SoftKernelExports>;
  const functionNames: ReadonlyArray<keyof SoftKernelExports> = [
    'soft_version',
    'soft_variant',
    'soft_reset',
    'soft_heap_offset',
    'soft_alloc',
    'soft_vector_add_one',
    'soft_cloth_project',
    'soft_cloth_integrate',
    'soft_cloth_solve',
    'soft_rope_project',
    'soft_water_step',
  ];
  if (!(wasmExports.memory instanceof WebAssembly.Memory)) {
    throw new Error('soft-kernel module does not export WebAssembly memory');
  }
  for (const name of functionNames) {
    if (typeof wasmExports[name] !== 'function') {
      throw new Error(`soft-kernel module is missing ${String(name)}`);
    }
  }
  const typed = value as SoftKernelExports;
  if (typed.soft_version() !== SOFT_KERNEL_ABI_VERSION) {
    throw new Error(`unsupported soft-kernel ABI ${typed.soft_version().toString(16)}`);
  }
  return typed;
}

async function defaultLoadBytes(
  source: string | URL,
  fetcher: typeof globalThis.fetch | undefined,
): Promise<ArrayBuffer> {
  if (typeof fetcher !== 'function') {
    throw new Error('fetch is unavailable and no loadBytes callback was supplied');
  }
  const response = await fetcher(source.toString());
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

async function instantiateKernel(
  source: string | URL,
  variant: Exclude<SoftKernelVariant, 'javascript'>,
  options: SoftKernelLoadOptions,
): Promise<SoftKernelModule> {
  const bytes = options.loadBytes
    ? await options.loadBytes(source)
    : await defaultLoadBytes(source, options.fetch ?? globalThis.fetch);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = assertKernelExports(instance.exports);
  const encodedVariant = exports.soft_variant();
  if ((variant === 'simd' && encodedVariant !== 1) || (variant === 'scalar' && encodedVariant !== 0)) {
    throw new Error(`soft-kernel variant marker does not match ${variant}`);
  }
  return new SoftKernelModule(variant, exports);
}

/**
 * Load the fastest compatible module. A rejected SIMD binary automatically
 * falls back to scalar WebAssembly; total WebAssembly failure leaves the app
 * on its existing JavaScript simulation path instead of blocking startup.
 */
export async function loadSoftKernels(options: SoftKernelLoadOptions = {}): Promise<SoftKernelRuntime> {
  const simdUrl = options.simdUrl ?? defaultAssetUrl('soft-kernels-simd.wasm');
  const scalarUrl = options.scalarUrl ?? defaultAssetUrl('soft-kernels-scalar.wasm');
  const failures: string[] = [];

  try {
    return { available: true, variant: 'simd', module: await instantiateKernel(simdUrl, 'simd', options) };
  } catch (error) {
    failures.push(`SIMD: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return { available: true, variant: 'scalar', module: await instantiateKernel(scalarUrl, 'scalar', options) };
  } catch (error) {
    failures.push(`scalar: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    available: false,
    variant: 'javascript',
    module: null,
    reason: failures.join('; '),
  };
}

/** Initialize and cache the process-wide runtime before constructing scenes. */
export function initializeSoftKernelRuntime(options: SoftKernelLoadOptions = {}): Promise<SoftKernelRuntime> {
  if (initialization === null) {
    initialization = loadSoftKernels(options).then((runtime) => {
      activeRuntime = runtime;
      return runtime;
    });
  }
  return initialization;
}

/**
 * Synchronous scene-construction lookup. Before initialization (and whenever
 * both binaries fail) this intentionally describes the JavaScript fallback.
 */
export function getSoftKernelRuntime(): SoftKernelRuntime {
  return activeRuntime;
}

export function getActiveSoftKernelModule(): SoftKernelModule | null {
  return activeRuntime.module;
}

export class SoftKernelModule {
  readonly variant: 'simd' | 'scalar';
  readonly exports: SoftKernelExports;

  constructor(variant: 'simd' | 'scalar', exports: SoftKernelExports) {
    this.variant = variant;
    this.exports = exports;
  }

  get memory(): WebAssembly.Memory {
    return this.exports.memory;
  }

  reset(): void {
    this.exports.soft_reset();
  }

  createArena(): SoftKernelArena {
    this.reset();
    return new SoftKernelArena(this);
  }

  projectCloth(pointers: SoftConstraintPointers, constraintCount: number, iterations: number): number {
    return this.exports.soft_cloth_project(
      pointers.positions,
      pointers.indicesA,
      pointers.indicesB,
      pointers.restLengths,
      pointers.scaleA,
      pointers.scaleB,
      pointers.broken,
      constraintCount,
      iterations,
    );
  }

  integrateCloth(
    pointers: ClothStepPointers,
    particleCount: number,
    dtSquared: number,
    drag: number,
    gust: number,
    sinA: number,
    cosA: number,
    sinB: number,
    cosB: number,
    sinZ: number,
    cosZ: number,
    zScale: number,
    variantLift: number,
    verticalLayout: boolean,
  ): number {
    return this.exports.soft_cloth_integrate(
      pointers.positions,
      pointers.previous,
      pointers.inverseMass,
      pointers.windSinA,
      pointers.windCosA,
      pointers.windSinB,
      pointers.windCosB,
      pointers.windSinZ,
      pointers.windCosZ,
      pointers.edgeFactors,
      particleCount,
      dtSquared,
      drag,
      gust,
      sinA,
      cosA,
      sinB,
      cosB,
      sinZ,
      cosZ,
      zScale,
      variantLift,
      verticalLayout ? 1 : 0,
    );
  }

  solveCloth(
    pointers: ClothStepPointers,
    particleCount: number,
    constraintCount: number,
    iterations: number,
    floorHeight: number,
    groundSlide: number,
    sphereCenter: readonly [number, number, number],
    sphereRadius: number,
  ): number {
    return this.exports.soft_cloth_solve(
      pointers.positions,
      pointers.previous,
      pointers.inverseMass,
      pointers.indicesA,
      pointers.indicesB,
      pointers.restLengths,
      pointers.scaleA,
      pointers.scaleB,
      pointers.broken,
      particleCount,
      constraintCount,
      iterations,
      floorHeight,
      groundSlide,
      sphereCenter[0],
      sphereCenter[1],
      sphereCenter[2],
      sphereRadius,
    );
  }

  projectRope(
    pointers: RopeConstraintPointers,
    constraintCount: number,
    iterations: number,
    breakBudget: number,
  ): number {
    return this.exports.soft_rope_project(
      pointers.positions,
      pointers.indicesA,
      pointers.indicesB,
      pointers.restLengths,
      pointers.inverseRestLengths,
      pointers.scaleA,
      pointers.scaleB,
      pointers.broken,
      pointers.render,
      pointers.breakThresholds,
      constraintCount,
      iterations,
      breakBudget,
    );
  }

  stepWater(
    pointers: WaterKernelPointers,
    cols: number,
    rows: number,
    dt: number,
    gravity: number,
    meanDepth: number,
    drag: number,
    inverseTwoDx: number,
    inverseTwoDz: number,
  ): boolean {
    return this.exports.soft_water_step(
      pointers.eta,
      pointers.velocityX,
      pointers.velocityZ,
      pointers.nextEta,
      pointers.nextVelocityX,
      pointers.nextVelocityZ,
      cols,
      rows,
      dt,
      gravity,
      meanDepth,
      drag,
      inverseTwoDx,
      inverseTwoDz,
    ) !== 0;
  }

}

/**
 * Monotonic arena for persistent simulation arrays. Create all allocations
 * before retaining views because a later memory.grow invalidates old views.
 */
export class SoftKernelArena {
  private readonly module: SoftKernelModule;

  constructor(module: SoftKernelModule) {
    this.module = module;
  }

  allocBytes(byteLength: number, alignment = 16): SoftWasmAllocation {
    const safeLength = Math.max(0, Math.floor(byteLength));
    const pointer = this.module.exports.soft_alloc(safeLength, alignment);
    if (pointer === 0) {
      throw new Error(`unable to allocate ${safeLength} bytes in soft-kernel memory`);
    }
    return { pointer, byteLength: safeLength };
  }

  copyF32(values: ArrayLike<number>): SoftWasmAllocation {
    const allocation = this.allocBytes(values.length * Float32Array.BYTES_PER_ELEMENT, 16);
    new Float32Array(this.module.memory.buffer, allocation.pointer, values.length).set(values);
    return allocation;
  }

  copyU16(values: ArrayLike<number>): SoftWasmAllocation {
    const allocation = this.allocBytes(values.length * Uint16Array.BYTES_PER_ELEMENT, 2);
    new Uint16Array(this.module.memory.buffer, allocation.pointer, values.length).set(values);
    return allocation;
  }

  copyU8(values: ArrayLike<number>): SoftWasmAllocation {
    const allocation = this.allocBytes(values.length, 1);
    new Uint8Array(this.module.memory.buffer, allocation.pointer, values.length).set(values);
    return allocation;
  }

  viewF32(pointer: SoftWasmPointer, length: number): Float32Array {
    return new Float32Array(this.module.memory.buffer, pointer, length);
  }

  viewU16(pointer: SoftWasmPointer, length: number): Uint16Array {
    return new Uint16Array(this.module.memory.buffer, pointer, length);
  }

  viewU8(pointer: SoftWasmPointer, length: number): Uint8Array {
    return new Uint8Array(this.module.memory.buffer, pointer, length);
  }
}
