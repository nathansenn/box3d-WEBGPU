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
  type GPUVertexFormat = 'float32' | 'float32x2' | 'float32x3' | 'float32x4';
  type GPUBufferBindingType = 'uniform' | 'storage' | 'read-only-storage';
  type GPUTextureUsageFlags = number;
  type GPUBufferUsageFlags = number;
  type GPUShaderStageFlags = number;
  type GPULoadOp = 'load' | 'clear';
  type GPUStoreOp = 'store' | 'discard';
  type GPUCanvasAlphaMode = 'opaque' | 'premultiplied';
  type GPUPowerPreference = 'low-power' | 'high-performance';

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
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  }

  interface GPUQueue {
    writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: BufferSource, dataOffset?: number, size?: number): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }

  interface GPUBuffer { readonly label?: string; destroy(): void; }
  interface GPUTexture { createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView; destroy(): void; }
  interface GPUTextureView {}
  interface GPUShaderModule {}
  interface GPURenderPipeline {}
  interface GPUBindGroup {}
  interface GPUBindGroupLayout {}
  interface GPUPipelineLayout {}
  interface GPUCommandBuffer {}

  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(): GPUCommandBuffer;
  }

  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup): void;
    setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
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
  }

  interface GPUBindGroupDescriptor {
    label?: string;
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }

  interface GPUBindGroupEntry {
    binding: number;
    resource: { buffer: GPUBuffer; offset?: number; size?: number };
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

  interface GPUColorTargetState { format: GPUTextureFormat; }

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
    size: [number, number] | { width: number; height: number; depthOrArrayLayers?: number };
    format: GPUTextureFormat;
    usage: GPUTextureUsageFlags;
  }

  interface GPUTextureViewDescriptor { label?: string; }

  interface GPURenderPassDescriptor {
    label?: string;
    colorAttachments: GPURenderPassColorAttachment[];
    depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
  }

  interface GPURenderPassColorAttachment {
    view: GPUTextureView;
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
