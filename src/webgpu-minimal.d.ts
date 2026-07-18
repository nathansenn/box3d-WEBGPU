export {};

declare global {
  interface Navigator {
    gpu?: GPU;
  }

  type GPUTextureFormat = string;
  type GPUIndexFormat = 'uint16' | 'uint32';
  type GPUPrimitiveTopology = 'point-list' | 'line-list' | 'line-strip' | 'triangle-list' | 'triangle-strip';
  type GPUCullMode = 'none' | 'front' | 'back';
  type GPUFrontFace = 'ccw' | 'cw';
  type GPUCompareFunction = 'never' | 'less' | 'equal' | 'less-equal' | 'greater' | 'not-equal' | 'greater-equal' | 'always';
  type GPUVertexStepMode = 'vertex' | 'instance';
  type GPUVertexFormat = 'float32' | 'float32x2' | 'float32x3' | 'float32x4' | 'snorm16x2' | 'unorm8x4' | 'unorm16x2';
  type GPUBufferBindingType = 'uniform' | 'storage' | 'read-only-storage';
  type GPUTextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
  type GPUSamplerBindingType = 'filtering' | 'non-filtering' | 'comparison';
  type GPUTextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  type GPUTextureDimension = '1d' | '2d' | '3d';
  type GPUTextureUsageFlags = number;
  type GPUBufferUsageFlags = number;
  type GPUShaderStageFlags = number;
  type GPULoadOp = 'load' | 'clear';
  type GPUStoreOp = 'store' | 'discard';
  type GPUCanvasAlphaMode = 'opaque' | 'premultiplied';
  type GPUPowerPreference = 'low-power' | 'high-performance';
  type GPUFilterMode = 'nearest' | 'linear';
  type GPUAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
  type GPUBlendFactor =
    | 'zero' | 'one' | 'src' | 'one-minus-src' | 'src-alpha' | 'one-minus-src-alpha'
    | 'dst' | 'one-minus-dst' | 'dst-alpha' | 'one-minus-dst-alpha'
    | 'src-alpha-saturated' | 'constant' | 'one-minus-constant';
  type GPUBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';

  const GPUBufferUsage: {
    MAP_READ: number;
    MAP_WRITE: number;
    COPY_SRC: number;
    COPY_DST: number;
    INDEX: number;
    VERTEX: number;
    UNIFORM: number;
    STORAGE: number;
    INDIRECT: number;
    QUERY_RESOLVE: number;
  };

  const GPUTextureUsage: {
    COPY_SRC: number;
    COPY_DST: number;
    TEXTURE_BINDING: number;
    STORAGE_BINDING: number;
    RENDER_ATTACHMENT: number;
  };

  const GPUShaderStage: {
    VERTEX: number;
    FRAGMENT: number;
    COMPUTE: number;
  };

  interface GPU {
    requestAdapter(options?: { powerPreference?: GPUPowerPreference }): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }

  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
    readonly features?: ReadonlySet<string>;
    readonly limits?: Record<string, number>;
  }

  interface GPUDeviceDescriptor {
    label?: string;
    requiredFeatures?: string[];
    requiredLimits?: Record<string, number>;
  }

  interface GPUDevice {
    readonly queue: GPUQueue;
    createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
    createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    createRenderPipelineAsync?(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline>;
    createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
    createComputePipelineAsync?(descriptor: GPUComputePipelineDescriptor): Promise<GPUComputePipeline>;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
    createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  }

  interface GPUQueue {
    writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: BufferSource, dataOffset?: number, size?: number): void;
    writeTexture(destination: GPUImageCopyTexture, data: BufferSource, dataLayout: GPUImageDataLayout, size: GPUExtent3D): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }


  interface GPUImageCopyTexture { texture: GPUTexture; mipLevel?: number; origin?: GPUOrigin3D; aspect?: string; }
  interface GPUImageDataLayout { offset?: number; bytesPerRow?: number; rowsPerImage?: number; }
  type GPUExtent3D = { width: number; height?: number; depthOrArrayLayers?: number } | readonly [number, number?, number?];
  type GPUOrigin3D = { x?: number; y?: number; z?: number } | readonly [number?, number?, number?];

  interface GPUBuffer { readonly label?: string; destroy(): void; }
  interface GPUTexture { createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView; destroy(): void; }
  interface GPUTextureView {}
  interface GPUSampler {}
  interface GPUShaderModule {
    getCompilationInfo?(): Promise<GPUCompilationInfo>;
  }
  interface GPUCompilationInfo { messages: readonly GPUCompilationMessage[]; }
  interface GPUCompilationMessage {
    message: string;
    type: 'error' | 'warning' | 'info';
    lineNum: number;
    linePos: number;
    offset: number;
    length: number;
  }
  interface GPURenderPipeline {}
  interface GPUComputePipeline {}
  interface GPUBindGroup {}
  interface GPUBindGroupLayout {}
  interface GPUPipelineLayout {}
  interface GPUCommandBuffer {}

  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
    finish(): GPUCommandBuffer;
  }

  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
    setIndexBuffer(buffer: GPUBuffer, indexFormat: GPUIndexFormat, offset?: number, size?: number): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number): void;
    end(): void;
  }

  interface GPUComputePassDescriptor { label?: string; }
  interface GPUComputePassEncoder {
    setPipeline(pipeline: GPUComputePipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    dispatchWorkgroups(workgroupCountX: number, workgroupCountY?: number, workgroupCountZ?: number): void;
    end(): void;
  }

  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    getCurrentTexture(): GPUTexture;
  }

  interface HTMLCanvasElement {
    getContext(contextId: 'webgpu'): GPUCanvasContext | null;
  }

  interface GPUCanvasConfiguration {
    device: GPUDevice;
    format: GPUTextureFormat;
    alphaMode?: GPUCanvasAlphaMode;
  }

  interface GPUBufferDescriptor {
    label?: string;
    size: number;
    usage: GPUBufferUsageFlags;
    mappedAtCreation?: boolean;
  }

  interface GPUBindGroupLayoutDescriptor {
    label?: string;
    entries: GPUBindGroupLayoutEntry[];
  }

  interface GPUBindGroupLayoutEntry {
    binding: number;
    visibility: GPUShaderStageFlags;
    buffer?: { type?: GPUBufferBindingType };
    texture?: GPUTextureBindingLayout;
    sampler?: GPUSamplerBindingLayout;
  }

  interface GPUTextureBindingLayout {
    sampleType?: GPUTextureSampleType;
    viewDimension?: GPUTextureViewDimension;
    multisampled?: boolean;
  }

  interface GPUSamplerBindingLayout {
    type?: GPUSamplerBindingType;
  }

  interface GPUBindGroupDescriptor {
    label?: string;
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }

  interface GPUBufferBinding { buffer: GPUBuffer; offset?: number; size?: number; }

  interface GPUBindGroupEntry {
    binding: number;
    resource: GPUBufferBinding | GPUTextureView | GPUSampler;
  }

  interface GPUShaderModuleDescriptor { label?: string; code: string; }
  interface GPUPipelineLayoutDescriptor { label?: string; bindGroupLayouts: GPUBindGroupLayout[]; }
  interface GPUCommandEncoderDescriptor { label?: string; }

  interface GPURenderPipelineDescriptor {
    label?: string;
    layout: GPUPipelineLayout;
    vertex: GPUVertexState;
    fragment?: GPUFragmentState;
    primitive?: GPUPrimitiveState;
    depthStencil?: GPUDepthStencilState;
    multisample?: GPUMultisampleState;
  }

  interface GPUComputePipelineDescriptor {
    label?: string;
    layout: GPUPipelineLayout;
    compute: GPUProgrammableStage;
  }

  interface GPUProgrammableStage {
    module: GPUShaderModule;
    entryPoint: string;
  }

  interface GPUVertexState {
    module: GPUShaderModule;
    entryPoint: string;
    buffers?: GPUVertexBufferLayout[];
  }

  interface GPUFragmentState {
    module: GPUShaderModule;
    entryPoint: string;
    targets: GPUColorTargetState[];
  }

  interface GPUColorTargetState {
    format: GPUTextureFormat;
    blend?: GPUBlendState;
    writeMask?: number;
  }

  interface GPUBlendState {
    color: GPUBlendComponent;
    alpha: GPUBlendComponent;
  }

  interface GPUBlendComponent {
    operation?: GPUBlendOperation;
    srcFactor?: GPUBlendFactor;
    dstFactor?: GPUBlendFactor;
  }

  interface GPUPrimitiveState {
    topology?: GPUPrimitiveTopology;
    stripIndexFormat?: GPUIndexFormat;
    frontFace?: GPUFrontFace;
    cullMode?: GPUCullMode;
  }

  interface GPUDepthStencilState {
    format: GPUTextureFormat;
    depthWriteEnabled?: boolean;
    depthCompare?: GPUCompareFunction;
  }

  interface GPUMultisampleState {
    count?: number;
    mask?: number;
    alphaToCoverageEnabled?: boolean;
  }

  interface GPUVertexBufferLayout {
    arrayStride: number;
    stepMode?: GPUVertexStepMode;
    attributes: GPUVertexAttribute[];
  }

  interface GPUVertexAttribute {
    shaderLocation: number;
    offset: number;
    format: GPUVertexFormat;
  }

  interface GPUTextureDescriptor {
    label?: string;
    size: [number, number] | [number, number, number] | { width: number; height: number; depthOrArrayLayers?: number };
    mipLevelCount?: number;
    sampleCount?: number;
    dimension?: GPUTextureDimension;
    format: GPUTextureFormat;
    usage: GPUTextureUsageFlags;
  }

  interface GPUTextureViewDescriptor { label?: string; }

  interface GPUSamplerDescriptor {
    label?: string;
    addressModeU?: GPUAddressMode;
    addressModeV?: GPUAddressMode;
    addressModeW?: GPUAddressMode;
    magFilter?: GPUFilterMode;
    minFilter?: GPUFilterMode;
    mipmapFilter?: GPUFilterMode;
    compare?: GPUCompareFunction;
    maxAnisotropy?: number;
  }

  interface GPURenderPassDescriptor {
    label?: string;
    colorAttachments: GPURenderPassColorAttachment[];
    depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
  }

  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
    resolveTarget?: GPUTextureView;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: GPULoadOp;
    storeOp: GPUStoreOp;
  }

  interface GPURenderPassDepthStencilAttachment {
    view: GPUTextureView;
    depthClearValue?: number;
    depthLoadOp?: GPULoadOp;
    depthStoreOp?: GPUStoreOp;
  }
}
