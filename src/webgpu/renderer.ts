import type { Mat4 } from '../math';
import type { DebugLine, InstanceBufferSource } from '../types';

const CUBE_VERTEX_COUNT = 36;
const LINE_FLOATS = 10; // xyz + rgba for A, xyz + rgba for B is written as two vertices of 7 each? Kept for capacity naming only.
const MAX_DEBUG_LINE_VERTICES = 131072;

const solidShader = /* wgsl */ `
struct Camera {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> camera : Camera;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) m0 : vec4<f32>,
  @location(3) m1 : vec4<f32>,
  @location(4) m2 : vec4<f32>,
  @location(5) m3 : vec4<f32>,
  @location(6) color : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) color : vec4<f32>,
  @location(2) worldPos : vec3<f32>,
  @location(3) viewDepth : f32,
};

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
  let model = mat4x4<f32>(input.m0, input.m1, input.m2, input.m3);
  let world = model * vec4<f32>(input.position, 1.0);

  var out : VertexOut;
  out.clipPosition = camera.viewProj * world;
  out.worldNormal = normalize((model * vec4<f32>(input.normal, 0.0)).xyz);
  out.color = input.color;
  out.worldPos = world.xyz;
  out.viewDepth = out.clipPosition.w;
  return out;
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.worldNormal);
  let key = normalize(vec3<f32>(-0.42, 0.86, 0.34));
  let fill = normalize(vec3<f32>(0.64, 0.31, -0.52));
  let rim = normalize(vec3<f32>(0.10, 0.48, -1.00));

  let kd = max(dot(n, key), 0.0);
  let fd = max(dot(n, fill), 0.0) * 0.24;
  let rd = pow(max(dot(n, rim), 0.0), 2.0) * 0.42;
  let horizon = clamp((input.worldPos.y + 2.0) / 30.0, 0.0, 1.0);
  let checker = select(0.88, 1.0, fract(input.worldPos.x * 0.5) > 0.5);
  let lit = 0.16 + 0.74 * kd + fd + rd + horizon * 0.05;
  let rgb = input.color.rgb * lit * checker;
  return vec4<f32>(rgb, input.color.a);
}
`;

const lineShader = /* wgsl */ `
struct Camera {
  viewProj : mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> camera : Camera;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) color : vec4<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn vsMain(input : VertexIn) -> VertexOut {
  var out : VertexOut;
  out.clipPosition = camera.viewProj * vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input : VertexOut) -> @location(0) vec4<f32> {
  return input.color;
}
`;

function cubeVertexData(): Float32Array {
  return new Float32Array([
    1, -1, -1, 1, 0, 0,  1, 1, -1, 1, 0, 0,  1, 1, 1, 1, 0, 0,
    1, -1, -1, 1, 0, 0,  1, 1, 1, 1, 0, 0,  1, -1, 1, 1, 0, 0,
    -1, -1, 1, -1, 0, 0,  -1, 1, 1, -1, 0, 0,  -1, 1, -1, -1, 0, 0,
    -1, -1, 1, -1, 0, 0,  -1, 1, -1, -1, 0, 0,  -1, -1, -1, -1, 0, 0,
    -1, 1, -1, 0, 1, 0,  -1, 1, 1, 0, 1, 0,  1, 1, 1, 0, 1, 0,
    -1, 1, -1, 0, 1, 0,  1, 1, 1, 0, 1, 0,  1, 1, -1, 0, 1, 0,
    -1, -1, 1, 0, -1, 0,  -1, -1, -1, 0, -1, 0,  1, -1, -1, 0, -1, 0,
    -1, -1, 1, 0, -1, 0,  1, -1, -1, 0, -1, 0,  1, -1, 1, 0, -1, 0,
    1, -1, 1, 0, 0, 1,  1, 1, 1, 0, 0, 1,  -1, 1, 1, 0, 0, 1,
    1, -1, 1, 0, 0, 1,  -1, 1, 1, 0, 0, 1,  -1, -1, 1, 0, 0, 1,
    -1, -1, -1, 0, 0, -1,  -1, 1, -1, 0, 0, -1,  1, 1, -1, 0, 0, -1,
    -1, -1, -1, 0, 0, -1,  1, 1, -1, 0, 0, -1,  1, -1, -1, 0, 0, -1,
  ]);
}

function ptrToNumber(ptr: number | bigint): number {
  return typeof ptr === 'bigint' ? Number(ptr) : ptr;
}


function writeFloatBuffer(queue: GPUQueue, buffer: GPUBuffer, offset: number, data: Float32Array): void {
  queue.writeBuffer(buffer, offset, data as unknown as BufferSource);
}

function createLineVertexData(lines: readonly DebugLine[], maxVertices: number): Float32Array {
  const vertexCount = Math.min(maxVertices, lines.length * 2);
  const out = new Float32Array(vertexCount * 7);
  let cursor = 0;
  for (let i = 0; i < lines.length && cursor + 14 <= out.length; i++) {
    const line = lines[i];
    out[cursor++] = line.ax;
    out[cursor++] = line.ay;
    out[cursor++] = line.az;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
    out[cursor++] = line.bx;
    out[cursor++] = line.by;
    out[cursor++] = line.bz;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
  }
  return out.subarray(0, cursor);
}

export class WebGPURenderer {
  readonly canvas: HTMLCanvasElement;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly maxInstances: number;

  private solidPipeline: GPURenderPipeline;
  private linePipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private uniformBuffer: GPUBuffer;
  private vertexBuffer: GPUBuffer;
  private matrixBuffer: GPUBuffer;
  private colorBuffer: GPUBuffer;
  private lineBuffer: GPUBuffer;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private width = 0;
  private height = 0;
  private lastUploadedBytes = 0;

  private constructor(args: {
    canvas: HTMLCanvasElement;
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
    maxInstances: number;
    solidPipeline: GPURenderPipeline;
    linePipeline: GPURenderPipeline;
    bindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer;
    vertexBuffer: GPUBuffer;
    matrixBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    lineBuffer: GPUBuffer;
  }) {
    this.canvas = args.canvas;
    this.device = args.device;
    this.context = args.context;
    this.format = args.format;
    this.maxInstances = args.maxInstances;
    this.solidPipeline = args.solidPipeline;
    this.linePipeline = args.linePipeline;
    this.bindGroup = args.bindGroup;
    this.uniformBuffer = args.uniformBuffer;
    this.vertexBuffer = args.vertexBuffer;
    this.matrixBuffer = args.matrixBuffer;
    this.colorBuffer = args.colorBuffer;
    this.lineBuffer = args.lineBuffer;
  }

  static async create(canvas: HTMLCanvasElement, maxInstances: number): Promise<WebGPURenderer> {
    if (!navigator.gpu) {
      throw new Error('navigator.gpu is unavailable. Open this over localhost/HTTPS in a WebGPU-capable browser.');
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was returned by the browser.');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a webgpu canvas context.');

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const cube = cubeVertexData();
    const vertexBuffer = device.createBuffer({ label: 'cube vertices', size: cube.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    writeFloatBuffer(device.queue, vertexBuffer, 0, cube);

    const matrixBuffer = device.createBuffer({ label: 'model matrices', size: maxInstances * 16 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const colorBuffer = device.createBuffer({ label: 'instance colors', size: maxInstances * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const uniformBuffer = device.createBuffer({ label: 'camera uniform', size: 16 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const lineBuffer = device.createBuffer({ label: 'debug line vertices', size: MAX_DEBUG_LINE_VERTICES * 7 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    const bindGroupLayout = device.createBindGroupLayout({
      label: 'camera layout',
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const bindGroup = device.createBindGroup({
      label: 'camera bind group',
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    const layout = device.createPipelineLayout({ label: 'pipeline layout', bindGroupLayouts: [bindGroupLayout] });

    const solidModule = device.createShaderModule({ label: 'solid shader', code: solidShader });
    const solidPipeline = device.createRenderPipeline({
      label: 'solid instanced cube pipeline',
      layout,
      vertex: {
        module: solidModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 6 * 4,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
            ],
          },
          {
            arrayStride: 16 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x4' },
              { shaderLocation: 3, offset: 4 * 4, format: 'float32x4' },
              { shaderLocation: 4, offset: 8 * 4, format: 'float32x4' },
              { shaderLocation: 5, offset: 12 * 4, format: 'float32x4' },
            ],
          },
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 6, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: { module: solidModule, entryPoint: 'fsMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const lineModule = device.createShaderModule({ label: 'line shader', code: lineShader });
    const linePipeline = device.createRenderPipeline({
      label: 'debug line pipeline',
      layout,
      vertex: {
        module: lineModule,
        entryPoint: 'vsMain',
        buffers: [{
          arrayStride: 7 * 4,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: lineModule, entryPoint: 'fsMain', targets: [{ format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
    });

    const renderer = new WebGPURenderer({
      canvas,
      device,
      context,
      format,
      maxInstances,
      solidPipeline,
      linePipeline,
      bindGroup,
      uniformBuffer,
      vertexBuffer,
      matrixBuffer,
      colorBuffer,
      lineBuffer,
    });
    renderer.resize();
    return renderer;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({ label: 'depth texture', size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depthView = this.depthTexture.createView();
  }

  writeCamera(viewProjection: Mat4): void {
    writeFloatBuffer(this.device.queue, this.uniformBuffer, 0, viewProjection);
  }

  uploadInstances(source: InstanceBufferSource, count: number): number {
    const safeCount = Math.max(0, Math.min(count, this.maxInstances));
    const matrixStart = ptrToNumber(source._b3w_matrices_ptr()) / 4;
    const colorStart = ptrToNumber(source._b3w_colors_ptr()) / 4;
    const matrixFloats = safeCount * 16;
    const colorFloats = safeCount * 4;
    const matrices = source.HEAPF32.subarray(matrixStart, matrixStart + matrixFloats);
    const colors = source.HEAPF32.subarray(colorStart, colorStart + colorFloats);
    writeFloatBuffer(this.device.queue, this.matrixBuffer, 0, matrices);
    writeFloatBuffer(this.device.queue, this.colorBuffer, 0, colors);
    this.lastUploadedBytes = matrices.byteLength + colors.byteLength;
    return this.lastUploadedBytes;
  }

  render(instanceCount: number, debugLines: readonly DebugLine[]): void {
    this.resize();
    if (!this.depthView) return;
    const safeCount = Math.max(0, Math.min(instanceCount, this.maxInstances));
    const lineData = createLineVertexData(debugLines, MAX_DEBUG_LINE_VERTICES);
    if (lineData.byteLength > 0) {
      writeFloatBuffer(this.device.queue, this.lineBuffer, 0, lineData);
    }

    const encoder = this.device.createCommandEncoder({ label: 'frame encoder' });
    const pass = encoder.beginRenderPass({
      label: 'main pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.023, g: 0.032, b: 0.055, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.solidPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setVertexBuffer(1, this.matrixBuffer);
    pass.setVertexBuffer(2, this.colorBuffer);
    pass.draw(CUBE_VERTEX_COUNT, safeCount);

    if (lineData.length > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.lineBuffer);
      pass.draw(lineData.length / 7, 1);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  uploadedMegabytes(): number {
    return this.lastUploadedBytes / (1024 * 1024);
  }
}
