/**
 * Layers the Lab's WebGPU renderer draws straight from the buffers of the GPU simulation backends (src/engine/gpu/):
 * nothing is read back to draw a frame.
 *
 *  - grains: one camera-facing quad per grain, shaded as a sphere, its centre and radius pulled from the backend's position
 *    buffer (x, y, z, r; a removed grain has r <= 0 and is moved out of the view) in the vertex shader;
 *  - a height field: the terrain and the water surface of a shallow-water backend as a grid generated from the vertex
 *    index, with heights pulled from the state buffer (h, hu, hv, carry) and the bed buffer; dry cells of the water
 *    surface are discarded; the grid is drawn every `stride` cells when the solver's grid is finer than the screen needs.
 *  - a flat rectangle (a slope, a floor).
 * `model` places the simulation's frame in the world (the avalanche is computed in the frame of its slope; a valley of a
 * kilometre is drawn at a scale the Lab's camera frames).
 *
 * The renderer calls `draw` inside its main pass with the scene uniforms bound as group 0
 * (WebGPURenderer.setSimulationLayers). Pipelines exist for both of the renderer's sample counts.
 */
import type { SimulationLayer, SimulationLayerTarget } from './renderer';

const head = (target: SimulationLayerTarget): string => `${target.sceneUniformStruct}
@group(0) @binding(0) var<uniform> scene : SceneUniforms;
fn lit(base : vec3<f32>, normal : vec3<f32>, worldPos : vec3<f32>) -> vec3<f32> {
  let light = normalize(scene.lightDirExposure.xyz);
  let view = normalize(scene.cameraPosTime.xyz - worldPos);
  let diffuse = 0.30 + 0.70 * max(dot(normal, -light), 0.0);
  let glint = pow(max(dot(normalize(view - light), normal), 0.0), 48.0);
  var color = base * diffuse + vec3<f32>(glint * 0.18);
  let far = length(scene.cameraPosTime.xyz - worldPos);
  let fog = 1.0 - exp(-scene.fogColorDensity.w * far * far * 0.018);
  return mix(color, scene.fogColorDensity.xyz, clamp(fog, 0.0, 0.90));
}
`;

export const GRAIN_LAYER_WGSL = (target: SimulationLayerTarget): string => /* wgsl */ `${head(target)}
struct Grains { model : mat4x4<f32>, color : vec4<f32>, scale : vec4<f32> };
@group(1) @binding(0) var<storage, read> grainPositions : array<vec4<f32>>;
@group(1) @binding(1) var<uniform> grains : Grains;
struct GrainOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) corner : vec2<f32>,
  @location(1) centre : vec3<f32>,
  @location(2) @interpolate(flat) radius : f32,
  @location(3) @interpolate(flat) tint : f32,
};
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instance : u32) -> GrainOut {
  let p = grainPositions[instance];
  let corner = vec2<f32>(f32(vertexIndex & 1u), f32((vertexIndex >> 1u) & 1u)) * 2.0 - 1.0;
  let centre = (grains.model * vec4<f32>(p.xyz, 1.0)).xyz;
  // The model's scale (the length of its first column) applies to the radius as to the centre.
  let radius = max(p.w, 0.0) * grains.scale.x * length(grains.model[0].xyz);
  let toCamera = normalize(scene.cameraPosTime.xyz - centre);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), toCamera));
  let up = cross(toCamera, right);
  var out : GrainOut;
  out.clip = scene.viewProj * vec4<f32>(centre + (right * corner.x + up * corner.y) * radius, 1.0);
  // A removed grain (radius negated by the solver) is put outside the clip volume.
  if (p.w <= 0.0) { out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  out.corner = corner; out.centre = centre; out.radius = radius;
  // A fixed shade per grain, so that a moving pile reads as grains.
  let hash = (instance * 2654435761u) >> 8u;
  out.tint = 0.78 + 0.22 * f32(hash & 0xFFu) / 255.0;
  return out;
}
@fragment
fn fsMain(input : GrainOut) -> @location(0) vec4<f32> {
  let d2 = dot(input.corner, input.corner);
  if (d2 > 1.0) { discard; }
  let toCamera = normalize(scene.cameraPosTime.xyz - input.centre);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), toCamera));
  let up = cross(toCamera, right);
  let normal = normalize(right * input.corner.x + up * input.corner.y + toCamera * sqrt(1.0 - d2));
  return vec4<f32>(lit(grains.color.rgb * input.tint, normal, input.centre + normal * input.radius), 1.0);
}
`;

export const HEIGHT_FIELD_LAYER_WGSL = (target: SimulationLayerTarget): string => /* wgsl */ `${head(target)}
struct Field { model : mat4x4<f32>, grid : vec4<u32>, cell : vec4<f32>, look : vec4<f32> };
@group(1) @binding(0) var<storage, read> waterState : array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> bedState : array<vec4<f32>>;
@group(1) @binding(2) var<uniform> field : Field;
struct FieldOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) depth : f32,
  @location(3) wet : f32,
  @location(4) speed : f32,
};
// The cell of a draw-grid point, clamped to the solver's grid.
fn cellOf(gi : i32, gk : i32) -> u32 {
  let i = u32(clamp(gi * i32(field.grid.z), 0, i32(field.grid.x) - 1));
  let k = u32(clamp(gk * i32(field.grid.z), 0, i32(field.grid.y) - 1));
  return i + field.grid.x * k;
}
// Height drawn at a cell: the bed, or the water level where the cell is wet (the bed, a little lowered, where it is dry).
fn heightAt(c : u32) -> f32 {
  let bed = bedState[c].x;
  if (field.grid.w == 0u) { return bed; }
  let h = waterState[c].x;
  return bed + select(-field.look.y, h, h > field.look.x);
}
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FieldOut {
  let quadsX = (field.grid.x - 1u) / field.grid.z;
  let quad = vertexIndex / 6u; let corner = vertexIndex % 6u;
  // Two triangles: (0,0) (1,0) (0,1), (1,0) (1,1) (0,1).
  let ox = array<i32, 6>(0, 1, 0, 1, 1, 0); let oz = array<i32, 6>(0, 0, 1, 0, 1, 1);
  let gi = i32(quad % quadsX) + ox[corner]; let gk = i32(quad / quadsX) + oz[corner];
  let c = cellOf(gi, gk);
  let stride = f32(field.grid.z);
  let x = field.cell.x + (f32(min(u32(gi) * field.grid.z, field.grid.x - 1u)) + 0.5) * field.cell.z;
  let z = field.cell.y + (f32(min(u32(gk) * field.grid.z, field.grid.y - 1u)) + 0.5) * field.cell.w;
  let y = heightAt(c);
  let sx = (heightAt(cellOf(gi + 1, gk)) - heightAt(cellOf(gi - 1, gk))) / (2.0 * stride * field.cell.z);
  let sz = (heightAt(cellOf(gi, gk + 1)) - heightAt(cellOf(gi, gk - 1))) / (2.0 * stride * field.cell.w);
  let world = field.model * vec4<f32>(x, y, z, 1.0);
  let state = waterState[c];
  var out : FieldOut;
  out.clip = scene.viewProj * world;
  out.worldPos = world.xyz;
  // The model may scale the height differently from the plan: the normal is the cross product of the drawn tangents.
  let tangentX = (field.model * vec4<f32>(1.0, sx, 0.0, 0.0)).xyz; let tangentZ = (field.model * vec4<f32>(0.0, sz, 1.0, 0.0)).xyz;
  out.normal = normalize(cross(tangentZ, tangentX));
  out.depth = state.x;
  out.wet = select(0.0, 1.0, state.x > field.look.x);
  out.speed = select(0.0, length(state.yz) / max(state.x, 1e-6), state.x > field.look.x);
  return out;
}
@fragment
fn fsTerrain(input : FieldOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  // Meadow on the flats, rock on the steeps, a darker band where the ground is under water.
  let steep = clamp((1.0 - n.y) * 3.5, 0.0, 1.0);
  var base = mix(vec3<f32>(0.11, 0.21, 0.07), vec3<f32>(0.24, 0.22, 0.19), steep);
  base = mix(base, base * 0.55, clamp(input.wet, 0.0, 1.0));
  return vec4<f32>(lit(base, n, input.worldPos), 1.0);
}
@fragment
fn fsWater(input : FieldOut) -> @location(0) vec4<f32> {
  if (input.wet < 0.5) { discard; }
  let n = normalize(input.normal);
  let deep = clamp(input.depth / field.look.z, 0.0, 1.0);
  let foam = clamp(input.speed / field.look.w - 0.35, 0.0, 1.0);
  let base = mix(mix(vec3<f32>(0.04, 0.30, 0.40), vec3<f32>(0.006, 0.07, 0.16), deep), vec3<f32>(0.75, 0.85, 0.88), foam);
  return vec4<f32>(lit(base, n, input.worldPos), mix(0.55, 0.92, max(deep, foam)));
}
`;

export const PLANE_LAYER_WGSL = (target: SimulationLayerTarget): string => /* wgsl */ `${head(target)}
struct Plane { model : mat4x4<f32>, color : vec4<f32>, size : vec4<f32> };
@group(1) @binding(0) var<uniform> plane : Plane;
struct PlaneOut { @builtin(position) clip : vec4<f32>, @location(0) worldPos : vec3<f32>, @location(1) normal : vec3<f32>, @location(2) uv : vec2<f32> };
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> PlaneOut {
  let corner = vec2<f32>(f32(vertexIndex & 1u), f32((vertexIndex >> 1u) & 1u));
  let local = vec3<f32>(plane.size.x + corner.x * (plane.size.z - plane.size.x), 0.0, plane.size.y + corner.y * (plane.size.w - plane.size.y));
  let world = plane.model * vec4<f32>(local, 1.0);
  var out : PlaneOut;
  out.clip = scene.viewProj * world; out.worldPos = world.xyz;
  out.normal = normalize((plane.model * vec4<f32>(0.0, 1.0, 0.0, 0.0)).xyz); out.uv = local.xz;
  return out;
}
@fragment
fn fsMain(input : PlaneOut) -> @location(0) vec4<f32> {
  // A faint grid of color.a metres, so that motion over the plane can be read.
  let g = abs(fract(input.uv / plane.color.a) - 0.5);
  let line = 1.0 - smoothstep(0.47, 0.5, max(g.x, g.y));
  return vec4<f32>(lit(plane.color.rgb * (0.86 + 0.14 * line), normalize(input.normal), input.worldPos), 1.0);
}
`;

type Mat4Like = ArrayLike<number>;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function pipelines(target: SimulationLayerTarget, label: string, code: string, layout: GPUBindGroupLayout, fragment: string, options: { topology: GPUPrimitiveTopology; blended: boolean }): [GPURenderPipeline, GPURenderPipeline] {
  const device = target.device, module = device.createShaderModule({ label, code });
  const pipelineLayout = device.createPipelineLayout({ label, bindGroupLayouts: [target.sceneBindGroupLayout, layout] });
  const make = (count: 1 | 4): GPURenderPipeline => device.createRenderPipeline({
    label: `${label} ${count}x`, layout: pipelineLayout,
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: fragment, targets: [{ format: target.colorFormat, ...(options.blended ? { blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } } : {}) }] },
    primitive: { topology: options.topology, cullMode: 'none' },
    depthStencil: { format: target.depthFormat, depthWriteEnabled: !options.blended, depthCompare: 'less-equal' },
    multisample: { count },
  });
  return [make(1), make(4)];
}
const uniform = (device: GPUDevice, label: string, floats: number): GPUBuffer => device.createBuffer({ label, size: 4 * floats, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

export interface GrainLayer extends SimulationLayer { setCount(count: number): void; setModel(model: Mat4Like): void }
/** Spheres from a buffer of (x, y, z, radius) per grain. `radiusScale` draws them larger or smaller than they are. */
export function createGrainLayer(target: SimulationLayerTarget, positions: GPUBuffer, count: number, options: { readonly color?: readonly [number, number, number]; readonly model?: Mat4Like; readonly radiusScale?: number } = {}): GrainLayer {
  const device = target.device;
  const layout = device.createBindGroupLayout({ label: 'grain layer', entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const [one, four] = pipelines(target, 'grain layer', GRAIN_LAYER_WGSL(target), layout, 'fsMain', { topology: 'triangle-strip', blended: false });
  const data = new Float32Array(24), buffer = uniform(device, 'grain layer uniforms', 24);
  const write = (): void => device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer);
  data.set(options.model ?? IDENTITY, 0); data.set([...(options.color ?? [0.76, 0.60, 0.36]), 1], 16); data[20] = options.radiusScale ?? 1; write();
  const group = device.createBindGroup({ label: 'grain layer', layout, entries: [{ binding: 0, resource: { buffer: positions } }, { binding: 1, resource: { buffer } }] });
  let instances = count;
  return {
    blended: false,
    setCount(next) { instances = Math.max(0, Math.floor(next)); },
    setModel(model) { data.set(model, 0); write(); },
    draw(pass, sampleCount) { if (instances === 0) return; pass.setPipeline(sampleCount === 1 ? one : four); pass.setBindGroup(1, group); pass.draw(4, instances); },
    destroy() { buffer.destroy(); },
  };
}

export interface HeightFieldOptions {
  readonly cells: readonly [number, number]; readonly origin: readonly [number, number]; readonly spacing: readonly [number, number];
  readonly model?: Mat4Like;
  /** Depth above which a cell is drawn as water, m. */
  readonly dryDepth?: number;
  /** Depth at which the water has its deepest colour, m, and speed at which it is white, m/s. */
  readonly deepDepth?: number; readonly fastSpeed?: number;
  /** Most quads drawn along a side: the grid is drawn every ceil(cells / this) cells. Default 512. */
  readonly maxQuads?: number;
}
/** The stride a height field of these cells is drawn at. */
export const heightFieldStride = (cells: readonly [number, number], maxQuads = 512): number => Math.max(1, Math.ceil((Math.max(cells[0], cells[1]) - 1) / maxQuads));
/** The terrain (opaque) and the water surface (blended) of a shallow-water backend, from its state and bed buffers. */
export function createHeightFieldLayers(target: SimulationLayerTarget, state: GPUBuffer, bed: GPUBuffer, options: HeightFieldOptions): { terrain: SimulationLayer; water: SimulationLayer; stride: number; vertices: number; setModel(model: Mat4Like): void } {
  const device = target.device, [nx, nz] = options.cells, stride = heightFieldStride(options.cells, options.maxQuads ?? 512);
  const quadsX = Math.floor((nx - 1) / stride), quadsZ = Math.floor((nz - 1) / stride), vertices = 6 * quadsX * quadsZ;
  const layout = device.createBindGroupLayout({ label: 'height field layer', entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const code = HEIGHT_FIELD_LAYER_WGSL(target);
  const terrainPipelines = pipelines(target, 'terrain layer', code, layout, 'fsTerrain', { topology: 'triangle-list', blended: false });
  const waterPipelines = pipelines(target, 'water surface layer', code, layout, 'fsWater', { topology: 'triangle-list', blended: true });
  const buffers: GPUBuffer[] = [];
  const make = (kind: 0 | 1): { group: GPUBindGroup; write(model: Mat4Like): void } => {
    const bytes = new ArrayBuffer(112), floats = new Float32Array(bytes), words = new Uint32Array(bytes), buffer = uniform(device, 'height field uniforms', 28);
    buffers.push(buffer);
    words.set([nx, nz, stride, kind], 16);
    floats.set([options.origin[0], options.origin[1], options.spacing[0], options.spacing[1]], 20);
    const dry = options.dryDepth ?? 1e-3;
    floats.set([dry, 0.02 * Math.max(options.spacing[0], options.spacing[1]), options.deepDepth ?? 3, options.fastSpeed ?? 6], 24);
    const write = (model: Mat4Like): void => { floats.set(model, 0); device.queue.writeBuffer(buffer, 0, bytes); };
    write(options.model ?? IDENTITY);
    return { write, group: device.createBindGroup({ label: 'height field layer', layout, entries: [{ binding: 0, resource: { buffer: state } }, { binding: 1, resource: { buffer: bed } }, { binding: 2, resource: { buffer } }] }) };
  };
  const terrain = make(0), water = make(1);
  const layer = (pair: [GPURenderPipeline, GPURenderPipeline], group: GPUBindGroup, blended: boolean): SimulationLayer => ({
    blended, draw(pass, sampleCount) { if (vertices === 0) return; pass.setPipeline(sampleCount === 1 ? pair[0] : pair[1]); pass.setBindGroup(1, group); pass.draw(vertices, 1); }, destroy() { for (const b of buffers.splice(0)) b.destroy(); },
  });
  return { terrain: layer(terrainPipelines, terrain.group, false), water: layer(waterPipelines, water.group, true), stride, vertices, setModel(model) { terrain.write(model); water.write(model); } };
}

/** A rectangle [x0, x1] x [z0, z1] of the plane y = 0 of `model`, with a grid of `gridSize` metres. */
export function createPlaneLayer(target: SimulationLayerTarget, options: { readonly model?: Mat4Like; readonly color?: readonly [number, number, number]; readonly rect: readonly [number, number, number, number]; readonly gridSize?: number }): SimulationLayer {
  const device = target.device;
  const layout = device.createBindGroupLayout({ label: 'plane layer', entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const [one, four] = pipelines(target, 'plane layer', PLANE_LAYER_WGSL(target), layout, 'fsMain', { topology: 'triangle-strip', blended: false });
  const data = new Float32Array(24), buffer = uniform(device, 'plane layer uniforms', 24);
  data.set(options.model ?? IDENTITY, 0); data.set([...(options.color ?? [0.20, 0.19, 0.17]), options.gridSize ?? 1], 16); data.set(options.rect, 20);
  device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer);
  const group = device.createBindGroup({ label: 'plane layer', layout, entries: [{ binding: 0, resource: { buffer } }] });
  return { blended: false, draw(pass, sampleCount) { pass.setPipeline(sampleCount === 1 ? one : four); pass.setBindGroup(1, group); pass.draw(4, 1); }, destroy() { buffer.destroy(); } };
}
