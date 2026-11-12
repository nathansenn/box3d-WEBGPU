/**
 * The Physics Lab's WebGL2 renderer: the fallback for browsers without WebGPU and for a lost WebGPU
 * device (docs/RENDERING_PIPELINE.md, "WebGL2 fallback").
 *
 * It takes the same streams as src/webgpu/renderer.ts (the LabRenderer interface in
 * ./renderer-selection.ts) and draws them with the same frame structure: a depth-only shadow map
 * from the one directional light, an HDR scene pass (sky, opaque instances, the dynamic surface,
 * translucent instances, overlay lines) with MSAA, and a post pass (bloom, exposure, ACES, vignette).
 *
 *   - Instances: boxes, spheres and capsules with the shared meshes and shape plan of
 *     src/webgpu/instance-shapes.ts; hulls, meshes, height fields and compounds (and the coupled
 *     scenes' mesh rows) with their own geometry from `shapeGeometry`, uploaded once per object.
 *     WebGL2 has no base instance, so each run re-points the instance attributes at its first row.
 *   - Ropes: expanded on the CPU (expandRopeSegments) where WebGPU runs a compute pass.
 *   - Surfaces: rebuilt on the CPU (buildSurface) where WebGPU reconstructs them in vertex shaders.
 *
 * What it does not do is listed in ./lab-shaders.ts and in the docs: no material textures, no GPU
 * timing queries, no shadow-map cache, no GPU visibility lists.
 */
import type { DebugLine, DynamicSurfaceFrame, InstanceBufferSource, InstanceGeometry, RopeGridFrame, SceneUniformState } from '../types';
import type { GpuTimingInfo } from '../webgpu/gpu-timing.js';
import { classifyInstanceMaterialMask } from '../webgpu/instance-visibility.ts';
import {
  capsulesBelow, cylinderVertexCount, cylinderVertexData, forEachBoxRun, forEachRun, geometryRowsBelow, hemisphereVertexCount,
  planInstanceShapes, sphereVertexCount, sphereVertexData, writeCapsuleCaps, type InstanceShapePlan,
} from '../webgpu/instance-shapes.ts';
import {
  LINE_VERTEX_FLOATS, MAX_ROPE_SEGMENTS, MAX_SURFACE_VERTICES, SURFACE_VERTEX_FLOATS, buildSurface, expandRopeSegments, fillLineVertexData,
  type BuiltSurface,
} from './lab-streams.ts';
import * as S from './lab-shaders.ts';
import type { LabRenderer } from './renderer-selection.ts';

const CUBE_VERTEX_COUNT = 36;
const SPHERE_VERTEX_COUNT = sphereVertexCount();
const HEMISPHERE_VERTEX_COUNT = hemisphereVertexCount();
const CYLINDER_VERTEX_COUNT = cylinderVertexCount();
const MAX_INSTANCE_CAPACITY = 1048576;
const MAX_DEBUG_LINE_VERTICES = 131072;
const SCENE_UNIFORM_FLOATS = 56;
const MAX_FRAMEBUFFER_PIXELS_4X = 2560 * 1440;
const MAX_FRAMEBUFFER_PIXELS_1X = 3840 * 2160;

function cubeVertexData(): Float32Array {
  // The WebGPU renderer's cube: position, normal; counter-clockwise from outside.
  return new Float32Array([
    1, -1, -1, 1, 0, 0, 1, 1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, 1, 1, 0, 0,
    -1, -1, 1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, 1, -1, -1, 0, 0, -1, -1, 1, -1, 0, 0, -1, 1, -1, -1, 0, 0, -1, -1, -1, -1, 0, 0,
    -1, 1, -1, 0, 1, 0, -1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, -1, 1, -1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, -1, 0, 1, 0,
    -1, -1, 1, 0, -1, 0, -1, -1, -1, 0, -1, 0, 1, -1, -1, 0, -1, 0, -1, -1, 1, 0, -1, 0, 1, -1, -1, 0, -1, 0, 1, -1, 1, 0, -1, 0,
    1, -1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, -1, 1, 1, 0, 0, 1, 1, -1, 1, 0, 0, 1, -1, 1, 1, 0, 0, 1, -1, -1, 1, 0, 0, 1,
    -1, -1, -1, 0, 0, -1, -1, 1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, -1, -1, -1, 0, 0, -1, 1, 1, -1, 0, 0, -1, 1, -1, -1, 0, 0, -1,
  ]);
}

const ptr = (value: number | bigint): number => (typeof value === 'bigint' ? Number(value) : value);
function hasTransparent(colors: ArrayLike<number>, start: number, count: number): boolean {
  for (let i = 0; i < count; i++) if ((classifyInstanceMaterialMask(colors[start + i * 4 + 3]!) & 2) !== 0) return true;
  return false;
}

interface Program { readonly program: WebGLProgram; readonly uniforms: Map<string, WebGLUniformLocation | null> }
interface Targets {
  readonly width: number; readonly height: number; readonly samples: number;
  readonly sceneFramebuffer: WebGLFramebuffer; readonly colorBuffer: WebGLRenderbuffer; readonly depthBuffer: WebGLRenderbuffer;
  readonly resolveFramebuffer: WebGLFramebuffer; readonly resolveTexture: WebGLTexture;
}

export interface WebGL2RendererOptions {
  /** Called with a short stage name while the renderer starts, as the WebGPU renderer does. */
  onStartupProgress?: (stage: string) => void;
}

export class WebGL2LabRenderer implements LabRenderer {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  readonly maxInstances: number;
  /** HDR targets (EXT_color_buffer_float); without them each fragment is tone-mapped where it is drawn. */
  readonly hdr: boolean;
  private readonly gl: WebGL2RenderingContext;
  private disposed = false;
  private lost: { reason: string; message: string } | null = null;
  private readonly lostListeners = new Set<(info: { readonly reason: string; readonly message: string }) => void>();
  private readonly onContextLost: (event: Event) => void;

  private readonly programs: { solid: Program; transparent: Program; shadow: Program; surfaceShadow: Program; surface: Program; sky: Program; line: Program; post: Program };
  private readonly uniformBuffer: WebGLBuffer;
  private readonly uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);
  private readonly matrixBuffer: WebGLBuffer;
  private readonly colorBuffer: WebGLBuffer;
  private readonly capMatrixBuffer: WebGLBuffer;
  private readonly capColorBuffer: WebGLBuffer;
  private capCapacity = 0;
  private capMatrices = new Float32Array(0);
  private capColors = new Float32Array(0);
  private readonly meshes: { cube: WebGLVertexArrayObject; sphere: WebGLVertexArrayObject; cylinder: WebGLVertexArrayObject; body: WebGLVertexArrayObject };
  private readonly meshBuffers: { cube: WebGLBuffer; sphere: WebGLBuffer; cylinder: WebGLBuffer; body: WebGLBuffer };
  private bodyMeshCapacity = 0;
  private bodyMeshRanges = new Map<InstanceGeometry, { first: number; count: number }>();
  private bodyMeshDraws = new Uint32Array(0);
  private bodyMeshVertices = 0;
  private readonly lineVao: WebGLVertexArrayObject;
  private readonly lineBuffer: WebGLBuffer;
  private readonly lineScratch = new Float32Array(MAX_DEBUG_LINE_VERTICES * LINE_VERTEX_FLOATS);
  private lineFloats = 0;
  private lineSource: readonly DebugLine[] | null = null;
  private lineSourceCount = -1;
  private lineVersion = -1;
  private readonly surfaceVao: WebGLVertexArrayObject;
  private readonly surfaceVertexBuffer: WebGLBuffer;
  private readonly surfaceIndexBuffer: WebGLBuffer;
  private readonly surfaceScratch = new Float32Array(MAX_SURFACE_VERTICES * SURFACE_VERTEX_FLOATS);
  private surface: BuiltSurface | null = null;
  private surfaceKey: unknown[] = [];
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly shadowFramebuffer: WebGLFramebuffer;
  private shadowTexture: WebGLTexture;
  private shadowMapSize = 0;
  private targets: Targets | null = null;
  private readonly maxSamples: number;

  private shapePlan: InstanceShapePlan | null = null;
  private rigidKey: unknown[] = [];
  private rigidShapeVersion: number | undefined = undefined;
  private rigidTransparent = false;
  private softKey: unknown[] = [];
  private softTransparent = false;
  private effectKey: unknown[] = [];
  private effectTransparent = false;
  private ropeKey: unknown[] = [];
  private ropeTransparent = false;
  private readonly ropeMatrices = new Float32Array(MAX_ROPE_SEGMENTS * 16);
  private readonly ropeColors = new Float32Array(MAX_ROPE_SEGMENTS * 4);

  private width = 0;
  private height = 0;
  private resolutionScale = 1;
  private sampleCount: 1 | 4 = 4;
  private shadowStrength = 1;
  private lastUploadedBytes = 0;
  private frames = 0;
  private shadowPasses = 0;
  private shadowReuses = 0;
  // The shadow map is drawn again only when a caster stream, the light or the map changed (as the WebGPU shadow cache).
  private shadowGeneration = 0;
  private shadowDrawn: unknown[] = [];

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, maxInstances: number, hdr: boolean) {
    this.canvas = canvas;
    this.gl = gl;
    this.maxInstances = maxInstances;
    this.hdr = hdr;
    const define = hdr ? '' : '#define INLINE_TONEMAP\n';
    const withDefine = (source: string): string => source.replace('#version 300 es\n', `#version 300 es\n${define}`);
    this.programs = {
      solid: this.program('solid', S.SOLID_VERTEX, withDefine(S.SOLID_FRAGMENT), ['shadowMap']),
      transparent: this.program('transparent', S.SOLID_VERTEX, withDefine(S.TRANSPARENT_FRAGMENT), ['shadowMap']),
      shadow: this.program('shadow', S.SHADOW_VERTEX, S.SHADOW_FRAGMENT, []),
      surfaceShadow: this.program('surface shadow', S.SURFACE_SHADOW_VERTEX, S.SHADOW_FRAGMENT.replace('in float vAlpha;', 'float vAlpha = 1.0;'), []),
      surface: this.program('surface', S.SURFACE_VERTEX, withDefine(S.SURFACE_FRAGMENT), ['shadowMap', 'uShading']),
      sky: this.program('sky', S.SKY_VERTEX, withDefine(S.SKY_FRAGMENT), ['shadowMap']),
      line: this.program('line', S.LINE_VERTEX, withDefine(S.LINE_FRAGMENT), ['shadowMap']),
      post: this.program('post', S.POST_VERTEX, S.POST_FRAGMENT, ['hdrTexture', 'uPassThrough']),
    };
    for (const p of [this.programs.solid, this.programs.transparent, this.programs.surface, this.programs.sky, this.programs.line]) {
      gl.useProgram(p.program); gl.uniform1i(p.uniforms.get('shadowMap')!, 0);
    }
    gl.useProgram(this.programs.post.program); gl.uniform1i(this.programs.post.uniforms.get('hdrTexture')!, 1);
    gl.useProgram(null);

    this.uniformBuffer = this.buffer(gl.UNIFORM_BUFFER, SCENE_UNIFORM_FLOATS * 4);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.uniformBuffer);
    this.matrixBuffer = this.buffer(gl.ARRAY_BUFFER, maxInstances * 64);
    this.colorBuffer = this.buffer(gl.ARRAY_BUFFER, maxInstances * 16);
    this.capMatrixBuffer = this.buffer(gl.ARRAY_BUFFER, 64);
    this.capColorBuffer = this.buffer(gl.ARRAY_BUFFER, 16);
    const cube = this.staticBuffer(cubeVertexData()), sphere = this.staticBuffer(sphereVertexData()), cylinder = this.staticBuffer(cylinderVertexData());
    const body = this.buffer(gl.ARRAY_BUFFER, 24);
    this.meshBuffers = { cube, sphere, cylinder, body };
    this.meshes = { cube: this.meshVao(cube), sphere: this.meshVao(sphere), cylinder: this.meshVao(cylinder), body: this.meshVao(body) };

    this.lineBuffer = this.buffer(gl.ARRAY_BUFFER, this.lineScratch.byteLength);
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);

    this.surfaceVertexBuffer = this.buffer(gl.ARRAY_BUFFER, this.surfaceScratch.byteLength);
    this.surfaceIndexBuffer = gl.createBuffer()!;
    this.surfaceVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.surfaceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceVertexBuffer);
    const stride = SURFACE_VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 40);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.surfaceIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 98304 * 2, gl.DYNAMIC_DRAW);
    this.emptyVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);

    this.shadowFramebuffer = gl.createFramebuffer()!;
    this.shadowTexture = gl.createTexture()!;
    const format = hdr ? gl.RGBA16F : gl.RGBA8;
    const samples = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as Int32Array | null;
    this.maxSamples = samples && samples.length ? Math.max(...samples) : 0;

    this.onContextLost = (event: Event) => {
      event.preventDefault();
      this.notifyLost({ reason: 'context-lost', message: 'The WebGL2 context was lost.' });
    };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  /**
   * Create the renderer on `canvas`. A browser that has just lost its GPU process can refuse a new
   * context for a moment; the request is retried for about two seconds, as the Studio's initWebGL does
   * (src/studio/device-loss.ts). Throws when WebGL2 is not available.
   */
  static async create(canvas: HTMLCanvasElement, maxInstances: number, options: WebGL2RendererOptions = {}): Promise<WebGL2LabRenderer> {
    if (!Number.isSafeInteger(maxInstances) || maxInstances < 1 || maxInstances > MAX_INSTANCE_CAPACITY) throw new RangeError('Renderer instance capacity must be 1–1048576.');
    options.onStartupProgress?.('Creating WebGL2 context');
    let gl: WebGL2RenderingContext | null = null;
    for (let attempt = 1; ; attempt++) {
      // preserveDrawingBuffer keeps the frame readable after it is shown: the Lab's capture and run-archive buttons call
      // toBlob outside the animation frame. It costs a copy per frame on some GPUs.
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (gl && !gl.isContextLost()) break;
      if (attempt === 5) throw new Error('WebGL2 is not available in this browser.');
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const hdr = gl.getExtension('EXT_color_buffer_float') !== null;
    options.onStartupProgress?.('Compiling WebGL2 programs');
    return new WebGL2LabRenderer(canvas, gl, maxInstances, hdr);
  }

  private shader(type: number, source: string, label: string): WebGLShader {
    const gl = this.gl, shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`WebGL2 ${label} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${gl.getShaderInfoLog(shader) ?? 'compile failed'}`);
    }
    return shader;
  }

  private program(label: string, vertex: string, fragment: string, uniforms: readonly string[]): Program {
    const gl = this.gl, program = gl.createProgram()!;
    const vs = this.shader(gl.VERTEX_SHADER, vertex, label), fs = this.shader(gl.FRAGMENT_SHADER, fragment, label);
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`WebGL2 ${label} program: ${gl.getProgramInfoLog(program) ?? 'link failed'}`);
    gl.deleteShader(vs); gl.deleteShader(fs);
    const block = gl.getUniformBlockIndex(program, 'Scene');
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
    return { program, uniforms: new Map(uniforms.map(name => [name, gl.getUniformLocation(program, name)])) };
  }

  private buffer(target: number, bytes: number): WebGLBuffer {
    const gl = this.gl, buffer = gl.createBuffer()!;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, Math.max(4, bytes), gl.DYNAMIC_DRAW);
    return buffer;
  }

  private staticBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl, buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  /** A vertex array with a position/normal mesh in locations 0 and 1 and per-instance rows in 2 to 6. */
  private meshVao(mesh: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    this.pointMesh(mesh);
    for (let location = 2; location <= 6; location++) { gl.enableVertexAttribArray(location); gl.vertexAttribDivisor(location, 1); }
    gl.bindVertexArray(null);
    return vao;
  }

  private pointMesh(mesh: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  }

  /** Draw `instances` rows from `startRow` of the given streams with a mesh's vertices [first, first + count). */
  private drawMesh(vao: WebGLVertexArrayObject, first: number, count: number, matrices: WebGLBuffer, colors: WebGLBuffer, startRow: number, instances: number): void {
    if (count <= 0 || instances <= 0) return;
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, matrices);
    for (let c = 0; c < 4; c++) gl.vertexAttribPointer(2 + c, 4, gl.FLOAT, false, 64, startRow * 64 + c * 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, colors);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, startRow * 16);
    gl.drawArraysInstanced(gl.TRIANGLES, first, count, instances);
  }

  /** Every instance below `count`, by shape, as the WebGPU renderer's drawShapedInstances. */
  private drawInstances(count: number): void {
    const plan = this.shapePlan, m = this.meshes, M = this.matrixBuffer, C = this.colorBuffer;
    if (!plan) { this.drawMesh(m.cube, 0, CUBE_VERTEX_COUNT, M, C, 0, count); return; }
    forEachBoxRun(plan, count, (start, length) => this.drawMesh(m.cube, 0, CUBE_VERTEX_COUNT, M, C, start, length));
    if (plan.sphereCount > 0) forEachRun(plan.sphereRuns, count, (start, length) => this.drawMesh(m.sphere, 0, SPHERE_VERTEX_COUNT, M, C, start, length));
    const geometryRows = geometryRowsBelow(plan, count), draws = this.bodyMeshDraws;
    for (let k = 0; k < geometryRows; k++) this.drawMesh(m.body, draws[k * 2]!, draws[k * 2 + 1]!, M, C, plan.geometryRows[k]!, 1);
    const capsules = capsulesBelow(plan, count);
    if (capsules > 0) {
      forEachRun(plan.capsuleRuns, count, (start, length) => this.drawMesh(m.cylinder, 0, CYLINDER_VERTEX_COUNT, M, C, start, length));
      this.drawMesh(m.sphere, 0, HEMISPHERE_VERTEX_COUNT, this.capMatrixBuffer, this.capColorBuffer, 0, capsules * 2);
    }
  }

  private same(previous: unknown[], next: unknown[]): boolean {
    if (previous.length !== next.length) return false;
    for (let i = 0; i < next.length; i++) if (previous[i] !== next[i]) return false;
    return true;
  }

  private active(): boolean {
    if (this.disposed) throw new Error('WebGL2LabRenderer has been disposed.');
    return this.lost === null && !this.gl.isContextLost();
  }

  writeSceneUniforms(state: SceneUniformState): void {
    if (!this.active()) return;
    const q = state.quality;
    this.sampleCount = q.sampleCount;
    this.resolutionScale = Math.max(0.5, Math.min(1.35, q.resolutionScale));
    this.shadowStrength = q.shadowStrength;
    this.resize();
    const d = this.uniformData;
    d.set(state.viewProjection, 0);
    d.set(state.lightViewProjection, 16);
    d[32] = state.cameraPosition[0]; d[33] = state.cameraPosition[1]; d[34] = state.cameraPosition[2]; d[35] = state.timeSeconds;
    d[36] = state.lightDirection[0]; d[37] = state.lightDirection[1]; d[38] = state.lightDirection[2]; d[39] = q.exposure;
    d[40] = state.fogColor[0]; d[41] = state.fogColor[1]; d[42] = state.fogColor[2]; d[43] = q.fogDensity;
    d[44] = this.width; d[45] = this.height; d[46] = this.hdr ? q.bloomStrength : 0; d[47] = q.shadowStrength;
    d[48] = q.shadowTapCount; d[49] = q.sampleCount; d[50] = q.shadowMapSize; d[51] = state.studioMode ? 1 : 0;
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.uniformBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, d);
    this.ensureShadowMap(q.shadowMapSize);
  }

  private ensureShadowMap(size: number): void {
    if (size === this.shadowMapSize) return;
    const gl = this.gl;
    gl.deleteTexture(this.shadowTexture);
    this.shadowTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    // depth32float as in the WebGPU renderer; with a compare mode set, linear filtering of it is allowed (hardware 2x2 PCF).
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowMapSize = size;
  }

  /** Size the drawing buffer as the WebGPU renderer does (device pixels times the quality's scale, capped). */
  private resize(): void {
    const gl = this.gl;
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * this.resolutionScale);
    const requestedWidth = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const requestedHeight = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const maxPixels = this.sampleCount === 4 ? MAX_FRAMEBUFFER_PIXELS_4X : MAX_FRAMEBUFFER_PIXELS_1X;
    const maxDimension = Math.max(1, Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number));
    const fit = Math.min(1, Math.sqrt(maxPixels / (requestedWidth * requestedHeight)), maxDimension / requestedWidth, maxDimension / requestedHeight);
    const width = Math.max(1, Math.floor(requestedWidth * fit)), height = Math.max(1, Math.floor(requestedHeight * fit));
    const samples = Math.min(this.sampleCount === 4 ? 4 : 0, this.maxSamples);
    if (this.targets && width === this.width && height === this.height && samples === this.targets.samples) return;
    this.width = width; this.height = height;
    this.canvas.width = width; this.canvas.height = height;
    this.releaseTargets();
    const format = this.hdr ? gl.RGBA16F : gl.RGBA8;
    const colorBuffer = gl.createRenderbuffer()!, depthBuffer = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, colorBuffer);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
    const sceneFramebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFramebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorBuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
    const resolveTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, resolveTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const resolveFramebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = { width, height, samples, sceneFramebuffer, colorBuffer, depthBuffer, resolveFramebuffer, resolveTexture };
  }

  private releaseTargets(): void {
    const t = this.targets, gl = this.gl;
    if (!t) return;
    gl.deleteFramebuffer(t.sceneFramebuffer); gl.deleteFramebuffer(t.resolveFramebuffer);
    gl.deleteRenderbuffer(t.colorBuffer); gl.deleteRenderbuffer(t.depthBuffer); gl.deleteTexture(t.resolveTexture);
    this.targets = null;
  }

  uploadInstances(source: InstanceBufferSource, count: number): number {
    if (!this.active()) return 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > this.maxInstances) throw new RangeError('Rigid instance count exceeds renderer capacity; reserve storage before uploading.');
    const sourceCount = source._b3w_body_count(), sourceCapacity = source._b3w_max_bodies();
    if (!Number.isSafeInteger(sourceCount) || sourceCount < 0 || sourceCount > sourceCapacity || count > sourceCount) throw new RangeError('Rigid instance count exceeds the source’s active body storage.');
    const matrixPtr = ptr(source._b3w_matrices_ptr()), colorPtr = ptr(source._b3w_colors_ptr()), heap = source.HEAPF32;
    if (matrixPtr < 0 || matrixPtr % 4 !== 0 || matrixPtr + count * 64 > heap.byteLength || colorPtr < 0 || colorPtr % 4 !== 0 || colorPtr + count * 16 > heap.byteLength) {
      throw new RangeError('Rigid instance stream is outside its current heap view.');
    }
    const layout = [source, heap.buffer, heap.byteOffset, matrixPtr, colorPtr, count];
    const key = [...layout, source.frameVersion(), source.colorVersion()];
    if (this.same(this.rigidKey, key)) { this.lastUploadedBytes = 0; return 0; }
    const layoutMatches = this.same(this.rigidKey.slice(0, layout.length), layout);
    this.rigidKey = key;
    const gl = this.gl, matrixStart = matrixPtr / 4, colorStart = colorPtr / 4;
    let bytes = 0;
    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, heap, matrixStart, count * 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, heap, colorStart, count * 4);
      bytes += count * 80;
    }
    this.rigidTransparent = hasTransparent(heap, colorStart, count);
    const shapeVersion = source.shapeVersion?.();
    if (shapeVersion === undefined) this.shapePlan = null;
    else if (!layoutMatches || shapeVersion !== this.rigidShapeVersion) {
      const geometry = source.shapeGeometry ? (row: number): boolean => source.shapeGeometry!(row) !== null : undefined;
      this.shapePlan = planInstanceShapes(source.shapeKinds?.() ?? null, count, geometry);
      if (this.shapePlan && this.shapePlan.geometryRows.length > 0) bytes += this.uploadBodyMeshes(this.shapePlan, source);
    }
    this.rigidShapeVersion = shapeVersion;
    if (this.shapePlan && this.shapePlan.capsuleCount > 0) bytes += this.uploadCaps(this.shapePlan, heap, matrixStart, colorStart);
    this.lastUploadedBytes = bytes;
    this.shadowGeneration++;
    return bytes;
  }

  private uploadCaps(plan: InstanceShapePlan, heap: Float32Array, matrixStart: number, colorStart: number): number {
    const caps = plan.capsuleCount * 2, gl = this.gl;
    if (caps > this.capCapacity) {
      let capacity = Math.max(64, this.capCapacity);
      while (capacity < caps) capacity *= 2;
      this.capMatrices = new Float32Array(capacity * 16);
      this.capColors = new Float32Array(capacity * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.capMatrixBuffer); gl.bufferData(gl.ARRAY_BUFFER, capacity * 64, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.capColorBuffer); gl.bufferData(gl.ARRAY_BUFFER, capacity * 16, gl.DYNAMIC_DRAW);
      this.capCapacity = capacity;
    }
    writeCapsuleCaps(heap, matrixStart, heap, colorStart, plan.capsuleRows, this.capMatrices, this.capColors);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.capMatrixBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.capMatrices, 0, caps * 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.capColorBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.capColors, 0, caps * 4);
    return caps * 80;
  }

  /** One vertex buffer for every body's own geometry; a mesh object is uploaded once (as the WebGPU renderer). */
  private uploadBodyMeshes(plan: InstanceShapePlan, source: InstanceBufferSource): number {
    const rows = plan.geometryRows, meshes: InstanceGeometry[] = [];
    let known = this.bodyMeshVertices > 0 || this.bodyMeshRanges.size > 0;
    for (let k = 0; k < rows.length; k++) {
      const mesh = source.shapeGeometry!(rows[k]!)!;
      meshes.push(mesh);
      if (!this.bodyMeshRanges.has(mesh)) known = false;
    }
    let bytes = 0;
    const gl = this.gl;
    if (!known) {
      const ranges = new Map<InstanceGeometry, { first: number; count: number }>();
      let total = 0;
      for (const mesh of meshes) {
        if (ranges.has(mesh)) continue;
        const count = Math.min(mesh.vertexCount, Math.floor(mesh.vertices.length / 6));
        ranges.set(mesh, { first: total, count });
        total += count;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffers.body);
      if (total > this.bodyMeshCapacity) {
        let capacity = Math.max(1024, this.bodyMeshCapacity);
        while (capacity < total) capacity *= 2;
        gl.bufferData(gl.ARRAY_BUFFER, capacity * 24, gl.DYNAMIC_DRAW);
        this.bodyMeshCapacity = capacity;
      }
      for (const [mesh, range] of ranges) {
        if (range.count === 0) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, range.first * 24, mesh.vertices, 0, range.count * 6);
        bytes += range.count * 24;
      }
      this.bodyMeshRanges = ranges;
      this.bodyMeshVertices = total;
    }
    if (this.bodyMeshDraws.length < rows.length * 2) this.bodyMeshDraws = new Uint32Array(rows.length * 2);
    for (let k = 0; k < rows.length; k++) {
      const range = this.bodyMeshRanges.get(meshes[k]!)!;
      this.bodyMeshDraws[k * 2] = range.first;
      this.bodyMeshDraws[k * 2 + 1] = range.count;
    }
    return bytes;
  }

  private uploadRows(matrices: Float32Array, colors: Float32Array, base: number, count: number): number {
    const gl = this.gl;
    this.shadowGeneration++;
    const matrixFloats = Math.min(count * 16, matrices.length), colorFloats = Math.min(count * 4, colors.length);
    if (matrixFloats > 0) { gl.bindBuffer(gl.ARRAY_BUFFER, this.matrixBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, base * 64, matrices, 0, matrixFloats); }
    if (colorFloats > 0) { gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, base * 16, colors, 0, colorFloats); }
    return (matrixFloats + colorFloats) * 4;
  }

  uploadSoftInstances(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number, frameVersion: number): number {
    if (!this.active()) return 0;
    const base = Math.max(0, Math.min(baseInstance, this.maxInstances)), safe = Math.max(0, Math.min(count, this.maxInstances - base));
    const key = [matrices.buffer, colors.buffer, matrices.byteOffset, colors.byteOffset, matrices.byteLength, colors.byteLength, base, safe, frameVersion];
    if (this.same(this.softKey, key)) return 0;
    this.softKey = key;
    const bytes = this.uploadRows(matrices, colors, base, safe);
    this.softTransparent = hasTransparent(colors, 0, Math.min(safe, Math.floor(colors.length / 4)));
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  uploadEffects(matrices: Float32Array, colors: Float32Array, baseInstance: number, count: number, frameVersion: number): number {
    if (!this.active()) return 0;
    const base = Math.max(0, Math.min(baseInstance, this.maxInstances)), safe = Math.max(0, Math.min(count, this.maxInstances - base));
    const key = [matrices.buffer, colors.buffer, matrices.byteOffset, colors.byteOffset, base, safe, frameVersion];
    if (this.same(this.effectKey, key)) return 0;
    this.effectKey = key;
    const bytes = this.uploadRows(matrices, colors, base, safe);
    this.effectTransparent = hasTransparent(colors, 0, Math.min(safe, Math.floor(colors.length / 4)));
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  uploadRopeGrid(grid: RopeGridFrame | null, baseInstance: number): number {
    if (!this.active()) return 0;
    if (!grid || grid.nodeCount <= 0 || grid.segmentCount <= 0) { if (this.ropeKey.length) this.shadowGeneration++; this.ropeKey = []; this.ropeTransparent = false; return 0; }
    const base = Math.max(0, Math.min(Math.floor(baseInstance), this.maxInstances));
    const key = [grid.positions.buffer, grid.positions.byteOffset, grid.frameVersion, grid.segments.buffer, grid.segments.byteOffset, grid.topologyVersion, grid.presentation, grid.nodeCount, grid.segmentCount, base];
    if (this.same(this.ropeKey, key)) return 0;
    this.ropeKey = key;
    const rows = Math.min(expandRopeSegments(grid, this.ropeMatrices, this.ropeColors), this.maxInstances - base);
    const bytes = this.uploadRows(this.ropeMatrices, this.ropeColors, base, rows);
    this.ropeTransparent = hasTransparent(this.ropeColors, 0, rows);
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  uploadSurface(surface: DynamicSurfaceFrame | null): number {
    if (!this.active()) return 0;
    // A surface whose versions, counts and arrays are those already drawn is not rebuilt.
    const data = !surface ? null : surface.path === 'packed' ? surface.vertices : surface.path === 'gpu-cloth' ? surface.positions : surface.eta;
    const key = surface ? [surface.path, surface.material, surface.frameVersion, surface.topologyVersion, surface.vertexCount, surface.indexCount, data!.buffer, data!.byteOffset, surface.indices.buffer] : [];
    if (this.same(this.surfaceKey, key)) return 0;
    this.surfaceKey = key;
    let built: BuiltSurface | null = null;
    try { built = buildSurface(surface, this.surfaceScratch); } catch (error) { console.warn('[WebGL2] Ignoring invalid surface.', error); }
    if (built || this.surface) this.shadowGeneration++;
    this.surface = built;
    if (!built) return 0;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceVertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.surfaceScratch, 0, built.vertexCount * SURFACE_VERTEX_FLOATS);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.surfaceIndexBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, built.indices, 0, built.indexCount);
    const bytes = built.vertexCount * SURFACE_VERTEX_FLOATS * 4 + built.indexCount * 2;
    this.lastUploadedBytes += bytes;
    return bytes;
  }

  invalidateDynamicCaches(): void {
    // The surface is dropped with its key: the next upload builds it again, or leaves none when there is none.
    this.rigidKey = []; this.softKey = []; this.effectKey = []; this.ropeKey = []; this.surfaceKey = []; this.surface = null;
    this.rigidShapeVersion = undefined;
    this.shadowGeneration++;
    this.lineSource = null; this.lineSourceCount = -1; this.lineVersion = -1;
  }

  render(instanceCount: number, debugLines: readonly DebugLine[], lineFrameVersion?: number): number {
    if (!this.active()) return 0;
    if (!Number.isSafeInteger(instanceCount) || instanceCount < 0 || instanceCount > this.maxInstances) throw new RangeError('Draw count exceeds renderer capacity; reserve storage before rendering.');
    const start = performance.now();
    this.resize();
    const gl = this.gl, t = this.targets!, P = this.programs;
    if (!(lineFrameVersion !== undefined && this.lineSource === debugLines && this.lineSourceCount === debugLines.length && this.lineVersion === lineFrameVersion)) {
      this.lineFloats = fillLineVertexData(debugLines, MAX_DEBUG_LINE_VERTICES, this.lineScratch);
      if (this.lineFloats > 0) { gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineScratch, 0, this.lineFloats); }
      this.lineSource = debugLines; this.lineSourceCount = debugLines.length; this.lineVersion = lineFrameVersion ?? -1;
    }
    this.frames++;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.uniformBuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    const surface = this.surface;

    // Shadow map: depth only, from the light, with a slope-scaled bias.
    const shadowKey = [this.shadowGeneration, instanceCount, this.shadowMapSize, ...this.uniformData.subarray(16, 32)];
    if (this.shadowStrength > 0.001 && this.same(this.shadowDrawn, shadowKey)) this.shadowReuses++;
    else if (this.shadowStrength > 0.001) {
      this.shadowDrawn = shadowKey;
      this.shadowPasses++;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
      gl.viewport(0, 0, this.shadowMapSize, this.shadowMapSize);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.1, 1);
      if (instanceCount > 0) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        gl.useProgram(P.shadow.program);
        this.drawInstances(instanceCount);
      }
      if (surface?.castsShadow) {
        gl.disable(gl.CULL_FACE);
        gl.useProgram(P.surfaceShadow.program);
        gl.bindVertexArray(this.surfaceVao);
        gl.drawElements(gl.TRIANGLES, surface.indexCount, gl.UNSIGNED_SHORT, 0);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFramebuffer);
    gl.viewport(0, 0, t.width, t.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
    gl.depthMask(true);
    if (this.hdr) gl.clearColor(0.003, 0.006, 0.015, 1); else gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.useProgram(P.sky.program);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    if (instanceCount > 0) {
      gl.depthFunc(gl.LESS); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.useProgram(P.solid.program);
      this.drawInstances(instanceCount);
    }
    if (surface) {
      const water = surface.shading === 'water';
      gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LEQUAL); gl.depthMask(!water);
      if (water) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
      gl.useProgram(P.surface.program);
      gl.uniform1i(P.surface.uniforms.get('uShading')!, surface.shading === 'cloth' ? 0 : surface.shading === 'sheet' ? 1 : 2);
      gl.bindVertexArray(this.surfaceVao);
      gl.drawElements(gl.TRIANGLES, surface.indexCount, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
    }
    if (instanceCount > 0 && (this.rigidTransparent || this.softTransparent || this.effectTransparent || this.ropeTransparent)) {
      gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.transparent.program);
      this.drawInstances(instanceCount);
      gl.disable(gl.BLEND);
    }
    if (this.lineFloats > 0) {
      gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.line.program);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINES, 0, this.lineFloats / LINE_VERTEX_FLOATS);
      gl.disable(gl.BLEND);
    }

    // Resolve the multisampled target, then tone map onto the canvas.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.sceneFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.resolveFramebuffer);
    gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(true);
    gl.useProgram(P.post.program);
    gl.uniform1i(P.post.uniforms.get('uPassThrough')!, this.hdr ? 0 : 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.resolveTexture);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    return performance.now() - start;
  }

  gpuTimingInfo(): GpuTimingInfo {
    return {
      status: 'unsupported', supported: false, reason: 'WebGL2 renderer: no GPU timestamp queries', latest: null, frames: this.frames,
      submittedSamples: 0, completedSamples: 0, droppedSamples: 0, failedSamples: 0, pendingSamples: 0, ringSize: 0, sampleEveryFrames: 0,
    };
  }

  shadowCacheInfo(): { rendered: number; reused: number } { return { rendered: this.shadowPasses, reused: this.shadowReuses }; }

  bodyMeshInfo(): Readonly<{ bodies: number; vertices: number }> {
    const bodies = this.shapePlan?.geometryRows.length ?? 0;
    return { bodies, vertices: bodies > 0 ? this.bodyMeshVertices : 0 };
  }

  instanceShapeInfo(): Readonly<{ mode: 'boxes' | 'direct-shapes'; spheres: number; capsules: number; boxRuns: number }> {
    const plan = this.shapePlan;
    return plan ? { mode: 'direct-shapes', spheres: plan.sphereCount, capsules: plan.capsuleCount, boxRuns: plan.boxRuns.length / 2 } : { mode: 'boxes', spheres: 0, capsules: 0, boxRuns: 1 };
  }

  uploadedMegabytes(): number { return this.lastUploadedBytes / (1024 * 1024); }
  viewport(): readonly [number, number] { return [this.width, this.height]; }

  /** For tests: lose the context through WEBGL_lose_context, as a driver reset would. */
  simulateContextLoss(): boolean {
    const extension = this.gl.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return extension !== null;
  }

  onDeviceLost(callback: (info: { readonly reason: string; readonly message: string }) => void): () => void {
    if (this.disposed) return () => {};
    this.lostListeners.add(callback);
    if (this.lost) { const info = this.lost; queueMicrotask(() => { if (!this.disposed && this.lostListeners.has(callback)) callback(info); }); }
    return () => { this.lostListeners.delete(callback); };
  }

  private notifyLost(info: { reason: string; message: string }): void {
    if (this.disposed || this.lost) return;
    this.lost = Object.freeze(info);
    for (const callback of [...this.lostListeners]) {
      try { callback(this.lost); } catch (error) { console.warn('[WebGL2] Context-loss listener failed.', error); }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lostListeners.clear();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    const gl = this.gl;
    if (!gl.isContextLost()) {
      this.releaseTargets();
      for (const b of [this.uniformBuffer, this.matrixBuffer, this.colorBuffer, this.capMatrixBuffer, this.capColorBuffer, this.lineBuffer, this.surfaceVertexBuffer, this.surfaceIndexBuffer,
        this.meshBuffers.cube, this.meshBuffers.sphere, this.meshBuffers.cylinder, this.meshBuffers.body]) gl.deleteBuffer(b);
      for (const v of [this.meshes.cube, this.meshes.sphere, this.meshes.cylinder, this.meshes.body, this.lineVao, this.surfaceVao, this.emptyVao]) gl.deleteVertexArray(v);
      for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
      gl.deleteTexture(this.shadowTexture);
      gl.deleteFramebuffer(this.shadowFramebuffer);
    }
    this.shapePlan = null;
    this.bodyMeshRanges = new Map();
    this.surface = null;
  }
}
