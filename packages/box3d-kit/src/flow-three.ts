/**
 * three.js view of a flow result (`box3d-flow-result/1`, from `box3d-webgpu-kit/flow`): streamlines as tubes coloured
 * by speed, the surfaces of the parts (plain, or coloured by the pressure coefficient), slices, and a colour legend.
 * Written against the structural shape of three's classes, so this package has no dependency on three: pass your own
 * THREE namespace in.
 *
 *   const view = createFlowView(THREE, result, {surface: 'cp'});
 *   scene.add(view.group);
 *   flowLegend(canvas.getContext('2d'), {min: view.range[0], max: view.range[1], title: 'Speed', unit: 'm/s'});
 */

interface GeometryLike {
  setAttribute(name: string, attribute: unknown): unknown;
  setIndex(index: unknown): unknown;
  computeVertexNormals(): void;
  dispose(): void;
}
interface Object3DLike { add(...objects: unknown[]): unknown; name: string; renderOrder: number }
/** The parts of the THREE namespace this module uses. */
export interface FlowThreeLike {
  Group: new () => any;
  BufferGeometry: new () => any;
  BufferAttribute: new (array: Float32Array | Uint32Array, itemSize: number) => any;
  Mesh: new (geometry: any, material: any) => any;
  MeshStandardMaterial: new (options?: object) => any;
  MeshBasicMaterial: new (options?: object) => any;
  LineSegments: new (geometry: any, material: any) => any;
  LineBasicMaterial: new (options?: object) => any;
  DoubleSide: unknown;
}

/** The members of a result this module reads (any `box3d-flow-result/1` document fits). */
export interface FlowResultLike {
  readonly setup: {readonly lattice: {readonly cell: number}; readonly referenceSpeed: number};
  readonly streamlines?: {readonly speedRange: readonly number[]; readonly lines: readonly {readonly points: ArrayLike<number>; readonly speed: ArrayLike<number>; readonly pressure: ArrayLike<number>}[]};
  readonly surface?: readonly {readonly part: string; readonly positions: ArrayLike<number>; readonly indices: ArrayLike<number>; readonly pressure: ArrayLike<number>; readonly cp: ArrayLike<number>; readonly flags?: ArrayLike<number>}[];
  readonly slices?: readonly {readonly axis: string; readonly position: number; readonly axes: readonly string[]; readonly nu: number; readonly nv: number; readonly origin: readonly number[]; readonly cell: number;
    readonly speed: ArrayLike<number>; readonly pressure: ArrayLike<number>; readonly fluid: ArrayLike<number>}[];
}

/** The colour maps of the streamlines, slices and surfaces. */
export type FlowColormap = 'rainbow' | 'turbo' | 'viridis' | 'coolwarm';
const MAPS: Record<FlowColormap, readonly (readonly [number, number, number])[]> = {
  // the classic blue-cyan-green-yellow-red scale of CFD pictures
  rainbow: [[0, 0, 0.75], [0, 0.35, 1], [0, 0.85, 1], [0.1, 0.9, 0.45], [0.75, 0.95, 0.1], [1, 0.75, 0], [1, 0.3, 0], [0.8, 0, 0]],
  turbo: [[0.19, 0.07, 0.23], [0.27, 0.41, 0.92], [0.11, 0.76, 0.89], [0.2, 0.97, 0.55], [0.64, 0.99, 0.24], [0.96, 0.8, 0.23], [0.98, 0.45, 0.1], [0.75, 0.13, 0.01]],
  viridis: [[0.27, 0, 0.33], [0.28, 0.2, 0.5], [0.21, 0.36, 0.55], [0.15, 0.5, 0.56], [0.12, 0.63, 0.53], [0.29, 0.76, 0.43], [0.63, 0.85, 0.22], [0.99, 0.91, 0.14]],
  coolwarm: [[0.23, 0.3, 0.75], [0.44, 0.55, 0.95], [0.67, 0.78, 0.99], [0.87, 0.87, 0.87], [0.97, 0.72, 0.62], [0.91, 0.47, 0.37], [0.7, 0.02, 0.15]],
};
/** A colour map: `t` in [0, 1] to [r, g, b] in [0, 1]. A name that is not a colour map gives 'rainbow'. */
export function flowColormap(name: FlowColormap = 'rainbow'): (t: number) => [number, number, number] {
  const stops = MAPS[name] ?? MAPS.rainbow;
  return t => {
    const x = (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
}

/** Options of `createFlowView`: what to draw, the styles and the colour ranges. */
export interface FlowViewOptions {
  /** Draw the streamlines. Default true. */
  readonly streamlines?: boolean;
  /** 'tubes' (default) or 'lines' (one-pixel lines, cheaper). */
  readonly streamlineStyle?: 'tubes' | 'lines';
  /** Radius of the tubes, metres. Default 0.18 of a cell. */
  readonly tubeRadius?: number;
  /** Sides of a tube. Default 6. */
  readonly tubeSides?: number;
  /** What colours the streamlines and slices. Default 'speed'. */
  readonly colorBy?: 'speed' | 'pressure';
  /** Range of the colour scale. Default: the range of the streamlines (or of the slices). */
  readonly range?: readonly [number, number];
  readonly colormap?: FlowColormap;
  /** 'plain' (default), 'cp' (coloured by the pressure coefficient, coolwarm over `cpRange`), or false. */
  readonly surface?: 'plain' | 'cp' | false;
  /** With surface 'cp': the colour of vertices whose sample is flagged as not resolved (`surface[].flags`: a sharp
   * edge, a gap under three cells), or null to colour them like the rest. Default 0x9a9a9a (grey). */
  readonly flaggedColor?: number | null;
  readonly surfaceColor?: number;
  /** Opacity of the surfaces, 0 to 1. Default 1 (internal walls are usually drawn at 0.2 to 0.35). */
  readonly surfaceOpacity?: number;
  /** Range of the pressure coefficient scale. Default [-1.5, 1]. */
  readonly cpRange?: readonly [number, number];
  /** Draw the slices. Default true. */
  readonly slices?: boolean;
  readonly sliceOpacity?: number;
}
/** The three.js objects of a result: a group, the streamlines, surfaces and slices, the colour range, and `dispose()`. */
export interface FlowView {
  readonly group: any;
  readonly streamlines: any | null;
  readonly surfaces: any[];
  readonly slices: any[];
  /** The range of the colour scale of the streamlines and slices, and what it shows. */
  readonly range: [number, number];
  readonly colorBy: 'speed' | 'pressure';
  dispose(): void;
}

/** Build the three.js objects of a flow result. */
export function createFlowView(THREE: FlowThreeLike, result: FlowResultLike, options: FlowViewOptions = {}): FlowView {
  const group = new THREE.Group() as Object3DLike, disposables: {dispose(): void}[] = [], colorBy = options.colorBy ?? 'speed', map = flowColormap(options.colormap ?? 'rainbow');
  group.name = 'flow';
  const cell = result.setup.lattice.cell, lines = options.streamlines === false ? [] : result.streamlines?.lines ?? [];
  // range of the colour scale
  let lo = Infinity, hi = -Infinity;
  if (options.range) { lo = options.range[0]; hi = options.range[1]; }
  else {
    for (const line of lines) { const v = colorBy === 'speed' ? line.speed : line.pressure; for (let i = 0; i < v.length; i++) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; } }
    if (!(lo <= hi)) for (const slice of result.slices ?? []) { const v = colorBy === 'speed' ? slice.speed : slice.pressure; for (let i = 0; i < v.length; i++) if (slice.fluid[i]) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; } }
    if (!(lo <= hi)) { lo = 0; hi = result.setup.referenceSpeed; }
    if (colorBy === 'speed') lo = 0;
  }
  const span = hi > lo ? hi - lo : 1, shade = (v: number): [number, number, number] => map((v - lo) / span);
  const make = (positions: Float32Array, colors: Float32Array | null, index: Uint32Array | null): GeometryLike => {
    const geometry = new THREE.BufferGeometry() as GeometryLike;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    disposables.push(geometry);
    return geometry;
  };

  // ---- streamlines ----
  let streamlines: any = null;
  if (lines.length > 0) {
    if ((options.streamlineStyle ?? 'tubes') === 'lines') {
      let segments = 0;
      for (const line of lines) segments += Math.max(0, line.speed.length - 1);
      const positions = new Float32Array(segments * 6), colors = new Float32Array(segments * 6);
      let o = 0;
      for (const line of lines) {
        const v = colorBy === 'speed' ? line.speed : line.pressure;
        for (let i = 0; i + 1 < line.speed.length; i++) for (let e = 0; e < 2; e++) {
          const c = shade(v[i + e]);
          positions[o] = line.points[3 * (i + e)]; positions[o + 1] = line.points[3 * (i + e) + 1]; positions[o + 2] = line.points[3 * (i + e) + 2];
          colors[o] = c[0]; colors[o + 1] = c[1]; colors[o + 2] = c[2]; o += 3;
        }
      }
      const material = new THREE.LineBasicMaterial({vertexColors: true});
      disposables.push(material);
      streamlines = new THREE.LineSegments(make(positions, colors, null), material);
    } else {
      const sides = Math.max(3, Math.floor(options.tubeSides ?? 6)), radius = options.tubeRadius ?? 0.18 * cell;
      let vertices = 0, triangles = 0;
      for (const line of lines) { const n = line.speed.length; if (n < 2) continue; vertices += n * sides; triangles += (n - 1) * sides * 2; }
      const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3), index = new Uint32Array(triangles * 3);
      let vo = 0, io = 0;
      for (const line of lines) {
        const n = line.speed.length, P = line.points, v = colorBy === 'speed' ? line.speed : line.pressure;
        if (n < 2) continue;
        // a frame carried along the line: the normal is kept perpendicular to the tangent
        let nx = 0, ny = 0, nz = 0;
        const first = vo;
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          let tx = P[3 * b] - P[3 * a], ty = P[3 * b + 1] - P[3 * a + 1], tz = P[3 * b + 2] - P[3 * a + 2];
          const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
          if (i === 0) { if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } }
          const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx, c = shade(v[i]);
          for (let s = 0; s < sides; s++) {
            const ang = 2 * Math.PI * s / sides, co = Math.cos(ang), si = Math.sin(ang), ox = co * nx + si * bx, oy = co * ny + si * by, oz = co * nz + si * bz;
            positions[3 * vo] = P[3 * i] + radius * ox; positions[3 * vo + 1] = P[3 * i + 1] + radius * oy; positions[3 * vo + 2] = P[3 * i + 2] + radius * oz;
            normals[3 * vo] = ox; normals[3 * vo + 1] = oy; normals[3 * vo + 2] = oz;
            colors[3 * vo] = c[0]; colors[3 * vo + 1] = c[1]; colors[3 * vo + 2] = c[2]; vo++;
          }
        }
        for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
          const a = first + i * sides + s, b = first + i * sides + (s + 1) % sides, c = a + sides, d = b + sides;
          index[io++] = a; index[io++] = c; index[io++] = b; index[io++] = b; index[io++] = c; index[io++] = d;
        }
      }
      const geometry = make(positions, colors, index);
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.45, metalness: 0});
      disposables.push(material);
      streamlines = new THREE.Mesh(geometry, material);
    }
    streamlines.name = 'flow-streamlines';
    group.add(streamlines);
  }

  // ---- surfaces of the parts ----
  const surfaces: any[] = [];
  if (options.surface !== false) {
    const byCp = options.surface === 'cp', cpMap = flowColormap('coolwarm'), cpRange = options.cpRange ?? [-1.5, 1], opacity = options.surfaceOpacity ?? 1;
    for (const part of result.surface ?? []) {
      const positions = Float32Array.from(part.positions as ArrayLike<number>);
      let colors: Float32Array | null = null;
      if (byCp) {
        colors = new Float32Array(positions.length);
        const flags = part.flags, grey = options.flaggedColor === undefined ? 0x9a9a9a : options.flaggedColor;
        const gc: [number, number, number] | null = grey === null ? null : [((grey >> 16) & 255) / 255, ((grey >> 8) & 255) / 255, (grey & 255) / 255];
        for (let v = 0; v < part.cp.length; v++) {
          const c = gc && flags && flags[v] ? gc : cpMap((part.cp[v] - cpRange[0]) / (cpRange[1] - cpRange[0]));
          colors[3 * v] = c[0]; colors[3 * v + 1] = c[1]; colors[3 * v + 2] = c[2];
        }
      }
      const geometry = make(positions, colors, Uint32Array.from(part.indices as ArrayLike<number>));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({color: byCp ? 0xffffff : options.surfaceColor ?? 0x8f98a3, vertexColors: byCp, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1});
      disposables.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `flow-surface:${part.part}`;
      if (opacity < 1) mesh.renderOrder = 2;
      surfaces.push(mesh); group.add(mesh);
    }
  }

  // ---- slices ----
  const slices: any[] = [];
  if (options.slices !== false) for (const slice of result.slices ?? []) {
    const {nu, nv} = slice, a = 'xyz'.indexOf(slice.axis), ua = 'xyz'.indexOf(slice.axes[0]), va = 'xyz'.indexOf(slice.axes[1]), values = colorBy === 'speed' ? slice.speed : slice.pressure;
    const positions = new Float32Array(nu * nv * 3), colors = new Float32Array(nu * nv * 3), index: number[] = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = i + nu * j, c = shade(values[k]);
      positions[3 * k + a] = slice.position; positions[3 * k + ua] = slice.origin[0] + i * slice.cell; positions[3 * k + va] = slice.origin[1] + j * slice.cell;
      colors[3 * k] = c[0]; colors[3 * k + 1] = c[1]; colors[3 * k + 2] = c[2];
    }
    // quads whose four corners are in the fluid
    for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) {
      const k = i + nu * j;
      if (slice.fluid[k] && slice.fluid[k + 1] && slice.fluid[k + nu] && slice.fluid[k + nu + 1]) index.push(k, k + 1, k + nu, k + 1, k + nu + 1, k + nu);
    }
    const opacity = options.sliceOpacity ?? 0.9, material = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1});
    disposables.push(material);
    const mesh = new THREE.Mesh(make(positions, colors, Uint32Array.from(index)), material);
    mesh.name = `flow-slice:${slice.axis}`;
    slices.push(mesh); group.add(mesh);
  }
  return {group, streamlines, surfaces, slices, range: [lo, hi], colorBy, dispose() { for (const d of disposables) d.dispose(); }};
}

/** The part of a 2D canvas context the legend draws with. */
export interface FlowLegendContext {
  fillStyle: unknown; strokeStyle: unknown; font: string; textAlign: string; textBaseline: string; lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}
/** Options of `flowLegend`: the range, title, unit, colour map and placement. */
export interface FlowLegendOptions {
  readonly min: number; readonly max: number;
  readonly title?: string; readonly unit?: string;
  readonly colormap?: FlowColormap;
  /** Top-left corner, bar width and height in canvas pixels. Defaults 16, 16, 18, 180. */
  readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number;
  /** Number of labelled values. Default 6. */
  readonly ticks?: number;
  readonly color?: string; readonly font?: string;
}
/** Draw a vertical colour scale with labelled values (largest at the top) on a 2D canvas context. */
export function flowLegend(context: FlowLegendContext, options: FlowLegendOptions): void {
  const map = flowColormap(options.colormap ?? 'rainbow'), x = options.x ?? 16, y0 = options.y ?? 16, w = options.width ?? 18, h = options.height ?? 180, ticks = Math.max(2, options.ticks ?? 6), color = options.color ?? '#1c2530';
  let y = y0;
  context.font = options.font ?? '12px system-ui, sans-serif'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillStyle = color;
  if (options.title) { context.fillText(options.unit ? `${options.title} [${options.unit}]` : options.title, x, y + 6); y += 20; }
  for (let i = 0; i < h; i++) {
    const c = map(1 - i / (h - 1));
    context.fillStyle = `rgb(${Math.round(255 * c[0])},${Math.round(255 * c[1])},${Math.round(255 * c[2])})`;
    context.fillRect(x, y + i, w, 1.5);
  }
  context.strokeStyle = color; context.lineWidth = 1; context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  context.fillStyle = color;
  const span = options.max - options.min, digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  for (let t = 0; t < ticks; t++) {
    const f = t / (ticks - 1), value = options.max - f * span;
    context.fillRect(x + w, y + f * (h - 1), 4, 1);
    context.fillText(value.toFixed(digits), x + w + 8, y + f * (h - 1));
  }
}
