/**
 * What the Physics Lab does with scene input before anything touches the
 * physics world: reading `?scene=` and `?example=`, telling file types apart,
 * turning imported geometry into a scene, and reporting problems as a list.
 *
 * Everything here is pure and synchronous (no DOM, no WASM), so it runs in
 * node. Untrusted input only ever passes through the scene format's validator
 * and link decoder (src/engine/scene-format.ts) and the geometry parsers
 * (src/engine/geometry.ts), which enforce their own size caps; the caps in
 * LAB_SCENE_LIMITS are checked before those are called.
 */
import {
  convexDecompose, createBodiesFromMesh, isClosed, isConvex, meshBounds, meshVolume, parseGLB, parseGLTF, parseOBJ, parseSTL,
  transformMesh, weldVertices, flipWinding,
  type BodyFactory, type TriangleMesh,
} from '../engine/geometry.ts';
import type { NativeBodyDescriptor } from '../engine/native-world.ts';
import {
  COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, SCENE_LIMITS, SCENE_LINK_PREFIX, SceneValidationError, decodeSceneLink, normalizeScene, validateScene,
  type Scene, type SceneBody, type SceneJoint, type SceneProblem, type SceneSolid,
} from '../engine/scene-format.ts';

export const LAB_SCENE_LIMITS = Object.freeze({
  /** Bytes of a scene (.json) or geometry file the Lab reads. */
  fileBytes: 64 * 1024 * 1024,
  /** Characters of scene JSON given directly in the address (`?scene={...}`). Larger scenes use a share link or a file. */
  urlJsonChars: 65536,
  /** Characters of a share link the Lab writes into the address bar. A longer link is still copied. */
  addressLinkChars: 32768,
  /** Triangles of a closed, concave mesh the Lab decomposes into convex hulls in the page. */
  decomposeTriangles: 5000,
  /** Convex hulls a decomposed import may have. A torus is within about 10% of its volume at 16 hulls and 30% at 8. */
  decomposeHulls: 16,
  /** Problems shown at once. */
  shownProblems: 12,
});

export const EXAMPLE_SCENE_TITLES: { readonly [name: string]: string } = Object.freeze({
  'pendulum-wave': 'Pendulum wave',
  'newtons-cradle': "Newton's cradle",
  'domino-run': 'Domino run',
  'terrain-car': 'Car on terrain',
  ragdoll: 'Ragdoll',
});
export const EXAMPLE_SCENE_NAMES: readonly string[] = Object.freeze(Object.keys(EXAMPLE_SCENES));
/** The coupled examples: scenes with water, cables, frames, cloths, grains, solids, heat or fluids, which the Lab steps through a Simulation. */
export const COUPLED_EXAMPLE_TITLES: { readonly [name: string]: string } = Object.freeze({
  'moored-buoy': 'Moored buoy',
  'cable-stayed-deck': 'Cable-stayed deck',
  'buoy-and-crates': 'Buoy and crates',
  trampoline: 'Trampoline',
  'hopper-seesaw': 'Hopper and see-saw',
  'suspended-platform': 'Suspended platform',
  'rubber-pad': 'Rubber pad',
  'notched-beam': 'Notched beam',
  'quenched-plate': 'Quenched plate',
  'heated-bar': 'Heated bar',
  'sphere-settling': 'Sphere settling',
  'cavity-flow': 'Lid-driven cavity',
  'flow-past-cylinder': 'Flow past a cylinder',
  'dam-break': 'Dam break',
});
export const COUPLED_EXAMPLE_NAMES: readonly string[] = Object.freeze(Object.keys(COUPLED_EXAMPLE_SCENES));
/** Every example `?example=<name>` opens: the rigid ones, then the coupled ones. */
export const LAB_EXAMPLE_SCENES: { readonly [name: string]: () => Scene } = Object.freeze({ ...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES });
export const LAB_EXAMPLE_TITLES: { readonly [name: string]: string } = Object.freeze({ ...EXAMPLE_SCENE_TITLES, ...COUPLED_EXAMPLE_TITLES });
export const LAB_EXAMPLE_NAMES: readonly string[] = Object.freeze(Object.keys(LAB_EXAMPLE_SCENES));

/** Where the scene on screen came from. */
export type LabSceneSource =
  | { readonly kind: 'example'; readonly name: string }
  | { readonly kind: 'link' }
  | { readonly kind: 'json' }
  | { readonly kind: 'file'; readonly name: string }
  | { readonly kind: 'geometry'; readonly name: string }
  /** The document of the scene editor (src/lab/scene-editor.ts). */
  | { readonly kind: 'editor' };

export type LabSceneRequest =
  | { readonly kind: 'example'; readonly name: string }
  | { readonly kind: 'link'; readonly text: string }
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'error'; readonly title: string; readonly message: string };

export type SceneRead =
  | { readonly ok: true; readonly scene: Scene; readonly source: LabSceneSource; readonly title: string; readonly notes: readonly string[] }
  | { readonly ok: false; readonly title: string; readonly problems: readonly SceneProblem[] };

const fail = (title: string, message: string): SceneRead => ({ ok: false, title, problems: [{ path: '', message }] });
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
/** Untrusted text shown in a message: bounded, and with control characters removed. */
export function quoteForDisplay(text: string, max = 80): string {
  let clean = '';
  for (const char of text.length > max * 4 ? text.slice(0, max * 4) : text) {
    const code = char.codePointAt(0)!;
    clean += code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ? ' ' : char;
  }
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * The scene a Lab address asks for, or null when it asks for none.
 *
 *   ?example=<name>        one of LAB_EXAMPLE_NAMES
 *   ?scene=b3s1...         a share link from encodeSceneLink
 *   ?scene={...}           the scene JSON itself, URL-encoded, for small scenes
 *
 * The same keys are read from the fragment (`#scene=...`) when the query has
 * neither. `scene` wins over `example`. Nothing is decoded here.
 */
export function parseSceneRequest(search: string, hash = ''): LabSceneRequest | null {
  for (const part of [search, hash.replace(/^#/, '')]) {
    let params: URLSearchParams;
    try { params = new URLSearchParams(part); } catch { continue; }
    const scene = params.get('scene');
    if (scene !== null) {
      const text = scene.trim();
      if (text.length === 0) return { kind: 'error', title: 'The scene link is empty', message: 'The address has scene= with nothing after it.' };
      if (text.length > SCENE_LIMITS.linkChars) {
        return { kind: 'error', title: 'The scene link is too long', message: `It has ${text.length} characters; the limit is ${SCENE_LIMITS.linkChars}.` };
      }
      if (text.startsWith('{')) {
        if (text.length > LAB_SCENE_LIMITS.urlJsonChars) {
          return { kind: 'error', title: 'The scene in the address is too large', message: `Scene JSON in the address may have ${LAB_SCENE_LIMITS.urlJsonChars} characters; this has ${text.length}. Use a share link (${SCENE_LINK_PREFIX}…) or open the file.` };
        }
        return { kind: 'json', text };
      }
      return { kind: 'link', text };
    }
    const example = params.get('example');
    if (example !== null) {
      if (Object.hasOwn(LAB_EXAMPLE_SCENES, example)) return { kind: 'example', name: example };
      return { kind: 'error', title: 'Unknown example scene', message: `There is no example called "${quoteForDisplay(example, 64)}". The examples are: ${LAB_EXAMPLE_NAMES.join(', ')}.` };
    }
  }
  return null;
}

function validated(json: unknown, source: LabSceneSource, fallbackTitle: string, failTitle: string): SceneRead {
  const problems = validateScene(json);
  if (problems.length > 0) return { ok: false, title: failTitle, problems };
  const scene = normalizeScene(json);
  return { ok: true, scene, source, title: scene.meta?.title ? quoteForDisplay(scene.meta.title, 96) : fallbackTitle, notes: [] };
}

/** Scene JSON as text: parsed, validated with validateScene and returned in normal form, or the list of problems. */
export function readSceneText(text: string, source: LabSceneSource, fallbackTitle: string): SceneRead {
  let json: unknown;
  try { json = JSON.parse(text); } catch (error) { return fail('This is not valid JSON', messageOf(error)); }
  return validated(json, source, fallbackTitle, 'This scene is not valid');
}

/** The scene an address asked for. Never throws. */
export function resolveSceneRequest(request: LabSceneRequest): SceneRead {
  switch (request.kind) {
    case 'error': return fail(request.title, request.message);
    case 'example': {
      if (!Object.hasOwn(LAB_EXAMPLE_SCENES, request.name)) return fail('Unknown example scene', `There is no example called "${quoteForDisplay(request.name, 64)}".`);
      return validated(LAB_EXAMPLE_SCENES[request.name]!(), { kind: 'example', name: request.name }, LAB_EXAMPLE_TITLES[request.name] ?? request.name, 'The example scene is not valid');
    }
    case 'json': return readSceneText(request.text, { kind: 'json' }, 'Scene from the address');
    case 'link': {
      try {
        const scene = decodeSceneLink(request.text);
        return { ok: true, scene, source: { kind: 'link' }, title: scene.meta?.title ? quoteForDisplay(scene.meta.title, 96) : 'Shared scene', notes: [] };
      } catch (error) {
        if (error instanceof SceneValidationError) return { ok: false, title: 'The scene in this link is not valid', problems: error.problems };
        return fail('This share link cannot be opened', messageOf(error));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type LabFileKind = 'json' | 'obj' | 'stl' | 'glb' | 'gltf';
export interface LabFile { readonly name: string; readonly bytes: Uint8Array }

const extensionOf = (name: string): string => { const dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot + 1).toLowerCase(); };
function firstText(bytes: Uint8Array, limit = 4096): string {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) start = 3;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, Math.min(bytes.length, start + limit)));
}

/**
 * What a file is, from its name and its first bytes. The `glTF` magic wins
 * over the extension; otherwise a known extension decides; a file without one
 * is sniffed (`{` is JSON, `solid` is an ASCII STL, `v x y z` lines are OBJ).
 * `json` covers both a scene file and a `.gltf` saved as `.json`: readLabFile
 * tells them apart after parsing. Null means the Lab does not read this file.
 */
export function detectFileKind(name: string, bytes: Uint8Array): LabFileKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6C && bytes[2] === 0x54 && bytes[3] === 0x46) return 'glb';
  switch (extensionOf(name)) {
    case 'json': return 'json';
    case 'gltf': return 'gltf';
    case 'glb': return 'glb';
    case 'obj': return 'obj';
    case 'stl': return 'stl';
    default: break;
  }
  const head = firstText(bytes).trimStart();
  if (head.startsWith('{')) return 'json';
  if (/^solid\b/.test(head)) return 'stl';
  if (/^(?:#[^\n]*\n\s*)*(?:v|o|g|mtllib)\s/.test(head)) return 'obj';
  return null;
}

export interface ReadFileOptions {
  /** Scale imported geometry with chooseImportScale. Default true. */
  readonly scaleToFit?: boolean;
  /** Other files opened or dropped with this one: a .gltf finds its external buffers among them by name. */
  readonly companions?: readonly LabFile[];
}

/** A scene from one opened or dropped file: a scene file as it is, geometry as a body in a default SI scene. Never throws. */
export function readLabFile(file: LabFile, options: ReadFileOptions = {}): SceneRead {
  const shown = quoteForDisplay(file.name || 'file', 96);
  if (file.bytes.length === 0) return fail(`${shown} is empty`, 'The file has no content.');
  if (file.bytes.length > LAB_SCENE_LIMITS.fileBytes) {
    return fail(`${shown} is too large`, `The file has ${file.bytes.length} bytes; the Lab reads files up to ${LAB_SCENE_LIMITS.fileBytes} bytes.`);
  }
  const kind = detectFileKind(file.name, file.bytes);
  if (kind === null) return fail(`${shown} is not a file the Lab reads`, 'Open a scene file (.json) or geometry (.obj, .stl, .glb, .gltf).');
  const text = (): string => new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
  try {
    if (kind === 'json' || kind === 'gltf') {
      let json: unknown;
      try { json = JSON.parse(text()); } catch (error) { return fail(`${shown} is not valid JSON`, messageOf(error)); }
      const object = json !== null && typeof json === 'object' && !Array.isArray(json) ? json as { readonly [key: string]: unknown } : null;
      const isGltf = kind === 'gltf' || (object !== null && object.format === undefined && object.asset !== undefined);
      if (!isGltf) return validated(json, { kind: 'file', name: shown }, shown, `${shown} is not a valid scene`);
      const buffers = new Map<string, Uint8Array>();
      for (const other of options.companions ?? []) buffers.set(other.name, other.bytes);
      return importGeometry(parseGLTF(json as object, buffers), { name: shown, scaleToFit: options.scaleToFit });
    }
    const meshes = kind === 'obj' ? parseOBJ(text()) : kind === 'stl' ? [parseSTL(file.bytes)] : parseGLB(file.bytes);
    return importGeometry(meshes, { name: shown, scaleToFit: options.scaleToFit });
  } catch (error) {
    return fail(`${shown} could not be read`, messageOf(error));
  }
}

// ---------------------------------------------------------------------------
// Geometry -> scene
// ---------------------------------------------------------------------------

export interface ImportScale { readonly scale: number; readonly reason: string }
const METRE_RANGE = [0.05, 10] as const;
const digits = (value: number, n = 3): string => Number(value.toPrecision(n)).toString();

/**
 * The factor imported geometry is multiplied by, from the largest side of its
 * bounding box in file units. Files do not say what their unit is, so:
 *
 *   - 0.05 to 10: read as metres, unchanged;
 *   - above 10: read as millimetres (x 0.001) when that gives 0.05 m to 10 m,
 *     which covers CAD parts from 50 mm to 10 m; otherwise scaled so the
 *     largest side is 2 m;
 *   - below 0.05: scaled so the largest side is 1 m.
 *
 * With `fit` false the geometry keeps the file's numbers as metres.
 */
export function chooseImportScale(largestSide: number, fit = true): ImportScale {
  if (!(largestSide > 0) || !Number.isFinite(largestSide)) throw new RangeError('The geometry has no size.');
  if (!fit) return { scale: 1, reason: `kept at the file's size, read as metres (${digits(largestSide)} m across); scale to fit is off` };
  if (largestSide >= METRE_RANGE[0] && largestSide <= METRE_RANGE[1]) return { scale: 1, reason: `read as metres (${digits(largestSide)} m across)` };
  if (largestSide > METRE_RANGE[1]) {
    const millimetres = largestSide * 0.001;
    if (millimetres >= METRE_RANGE[0] && millimetres <= METRE_RANGE[1]) {
      return { scale: 0.001, reason: `read as millimetres: ${digits(largestSide)} units across became ${digits(millimetres)} m` };
    }
    return { scale: 2 / largestSide, reason: `scaled to 2 m across: ${digits(largestSide)} units is too large as metres and too small as millimetres` };
  }
  return { scale: 1 / largestSide, reason: `scaled to 1 m across: ${digits(largestSide)} units is under 5 cm as metres` };
}

export type ImportBodyMode = 'hull' | 'decomposed' | 'mesh';
export interface ImportBodyPlan { readonly mode: ImportBodyMode; readonly reason: string }

/**
 * How a mesh becomes a body:
 *
 *   - not closed (an edge without its opposite, or inconsistent winding): it
 *     encloses no volume, so it has no mass. Static triangle mesh.
 *   - closed and convex: one dynamic convex hull.
 *   - closed, concave, at most LAB_SCENE_LIMITS.decomposeTriangles triangles:
 *     dynamic convex hulls from an approximate decomposition, welded together.
 *   - closed, concave and larger: static triangle mesh, because the
 *     decomposition would stall the page.
 *
 * `mesh` must be welded and outward-wound when it is closed.
 */
export function planImportBody(mesh: TriangleMesh): ImportBodyPlan {
  const triangles = mesh.indices.length / 3, vertices = mesh.vertices.length / 3;
  if (!isClosed(mesh)) return { mode: 'mesh', reason: 'the surface is not closed (it has open edges or inconsistent winding), so it encloses no volume and has no mass' };
  // isConvex tests every vertex against every face and refuses beyond its own budget.
  const convexTestable = vertices * triangles <= 2e8;
  if (convexTestable && isConvex(mesh)) return { mode: 'hull', reason: 'the surface is closed and convex' };
  if (triangles <= LAB_SCENE_LIMITS.decomposeTriangles) return { mode: 'decomposed', reason: 'the surface is closed and concave' };
  return { mode: 'mesh', reason: `the surface is closed but concave, and its ${triangles} triangles are more than the ${LAB_SCENE_LIMITS.decomposeTriangles} the Lab splits into convex pieces in the page` };
}

/** The shortest decimal that reads back to the same float32, so scene files and links stay small. */
export function shortFloat32(value: number): number {
  const single = Math.fround(value);
  if (single === 0 || !Number.isFinite(single)) return single === 0 ? 0 : single;
  for (let precision = 1; precision <= 9; precision++) {
    const candidate = Number(single.toPrecision(precision));
    if (Math.fround(candidate) === single) return candidate;
  }
  return single;
}
const shortList = (values: ArrayLike<number>): number[] => Array.from(values, shortFloat32);

function mergeMeshes(meshes: readonly TriangleMesh[]): TriangleMesh {
  if (meshes.length === 1) return meshes[0]!;
  let vertexFloats = 0, indexCount = 0;
  for (const mesh of meshes) { vertexFloats += mesh.vertices.length; indexCount += mesh.indices.length; }
  const vertices = new Float32Array(vertexFloats), indices = new Uint32Array(indexCount);
  let v = 0, i = 0;
  for (const mesh of meshes) {
    const base = v / 3;
    vertices.set(mesh.vertices, v); v += mesh.vertices.length;
    for (let k = 0; k < mesh.indices.length; k++) indices[i++] = mesh.indices[k]! + base;
  }
  return { vertices, indices };
}

const IMPORT_DENSITY = 1000;
const IMPORT_COLORS = [0xE0A458, 0x5FA8D3, 0x9BC53D, 0xE4572E, 0xB497D6, 0x4ECDC4, 0xF2C14E, 0xC97B84];
const STATIC_MESH_COLOR = 0x9AA7B4;

/**
 * Geometry from a file as a scene: one body on the ground slab of a default SI
 * world (gravity 9.81 m/s^2 down). All meshes of the file are merged into that
 * body. The mesh is welded, scaled (chooseImportScale), centred on its bounding
 * box and turned outward if it is closed and inside-out; planImportBody then
 * chooses the body. A dynamic body starts 0.3 m above the ground and its mass is
 * 1000 kg/m^3 times the mesh volume; a static mesh rests 2 mm above the ground.
 * The notes say what was done and why. Never throws.
 */
export function importGeometry(meshes: readonly TriangleMesh[], options: { readonly name: string; readonly scaleToFit?: boolean }): SceneRead {
  const name = quoteForDisplay(options.name, 96);
  try {
    if (meshes.length === 0) return fail(`${name} has no geometry`, 'The file holds no triangles.');
    const merged = mergeMeshes(meshes);
    let mesh = weldVertices(merged, 0);
    if (mesh.indices.length === 0) return fail(`${name} has no geometry`, 'The file holds no triangles with area.');
    const raw = meshBounds(mesh);
    const side = Math.max(raw.max[0] - raw.min[0], raw.max[1] - raw.min[1], raw.max[2] - raw.min[2]);
    if (!(side > 0)) return fail(`${name} has no size`, 'Every vertex is at the same point.');
    const scale = chooseImportScale(side, options.scaleToFit !== false);
    const centre: [number, number, number] = [(raw.min[0] + raw.max[0]) / 2, (raw.min[1] + raw.max[1]) / 2, (raw.min[2] + raw.max[2]) / 2];
    mesh = transformMesh(mesh, { scale: scale.scale, position: [-centre[0] * scale.scale, -centre[1] * scale.scale, -centre[2] * scale.scale] });
    const closed = isClosed(mesh);
    if (closed && meshVolume(mesh) < 0) mesh = flipWinding(mesh);
    const triangles = mesh.indices.length / 3, vertices = mesh.vertices.length / 3;
    if (vertices > SCENE_LIMITS.meshVertices || triangles > SCENE_LIMITS.meshTriangles) {
      return fail(`${name} is too large`, `It has ${vertices} vertices and ${triangles} triangles; a scene mesh may have ${SCENE_LIMITS.meshVertices} vertices and ${SCENE_LIMITS.meshTriangles} triangles.`);
    }
    const halfHeight = (raw.max[1] - raw.min[1]) * scale.scale / 2;
    let plan = planImportBody(mesh);
    const notes: string[] = [];
    if (meshes.length > 1) notes.push(`The file's ${meshes.length} objects were merged into one body.`);
    notes.push(`Size: ${scale.reason}.`);

    const bodies: SceneBody[] = [], joints: SceneJoint[] = [];
    const hullBody = (k: number, points: ArrayLike<number>, y: number, density: number, grouped: boolean): SceneBody => ({
      id: `part-${k}`, shape: { kind: 'hull', points: shortList(points) }, position: [0, shortFloat32(y), 0],
      density: shortFloat32(density), friction: 0.6, restitution: 0.1, color: IMPORT_COLORS[k % IMPORT_COLORS.length]!,
      // The pieces of one body overlap; a shared negative group keeps them from pushing each other apart.
      ...(grouped ? { filter: { groupIndex: -1 } } : {}),
    });
    // One convex hull: the geometry module chooses the hull points and scales the density so the mass is the mesh's.
    const singleHull = (y: number): void => {
      const made: NativeBodyDescriptor[] = [];
      const factory: BodyFactory<number, number> = { createBody: descriptor => made.push(descriptor), createJoint: () => 0 };
      createBodiesFromMesh<number, number>(factory, mesh, { as: 'hull', position: [0, y, 0], density: IMPORT_DENSITY });
      const descriptor = made[0]!;
      bodies.push(hullBody(0, (descriptor.shape as { readonly points: ArrayLike<number> }).points, y, descriptor.density ?? IMPORT_DENSITY, false));
    };
    // Several convex hulls, each with the mass of the piece of the solid it covers, welded into one body.
    // Each piece is welded to the nearest piece before it, at the midpoint of their centres of mass. Welding
    // every piece to the first one at the body origin, as createBodiesFromMesh does, was unstable here: a
    // 16-piece torus flew apart in free fall (tests/physics/lab-scenes.test.mjs checks that this one holds).
    const decomposed = (y: number): { hulls: number; overshoot: number } => {
      const result = convexDecompose(mesh, { maxHulls: LAB_SCENE_LIMITS.decomposeHulls });
      const pieces = result.hulls;
      if (pieces.length === 0) throw new Error('the decomposition produced no hulls');
      pieces.forEach((piece, k) => {
        bodies.push(hullBody(k, piece.points, y, IMPORT_DENSITY * piece.partVolume / piece.volume, pieces.length > 1));
        if (k === 0) return;
        let nearest = 0, best = Infinity;
        for (let other = 0; other < k; other++) {
          const c = pieces[other]!.centroid, distance = Math.hypot(piece.centroid[0] - c[0], piece.centroid[1] - c[1], piece.centroid[2] - c[2]);
          if (distance < best) { best = distance; nearest = other; }
        }
        const c = pieces[nearest]!.centroid;
        const anchor: [number, number, number] = [shortFloat32((piece.centroid[0] + c[0]) / 2), shortFloat32((piece.centroid[1] + c[1]) / 2), shortFloat32((piece.centroid[2] + c[2]) / 2)];
        joints.push({ id: `weld-${k}`, type: 'weld', bodyA: `part-${nearest}`, bodyB: `part-${k}`, frameA: { position: anchor }, frameB: { position: anchor } });
      });
      return { hulls: pieces.length, overshoot: result.volumeError };
    };

    const dynamicY = halfHeight + 0.3;
    if (plan.mode === 'decomposed') {
      try {
        const { hulls, overshoot } = decomposed(dynamicY);
        notes.push(`Dynamic body: ${plan.reason}, so it was split into ${hulls} convex ${hulls === 1 ? 'hull' : 'hulls welded together'}` +
          `${Math.abs(overshoot) < 5e-5 ? ' (together they have the volume of the mesh)' : ` (their volume is ${digits(Math.abs(overshoot) * 100, 2)}% ${overshoot >= 0 ? 'over' : 'under'} the mesh's${overshoot > 0.15 ? ', so hollows are partly filled in' : ''})`}.`);
      } catch (error) {
        bodies.length = 0; joints.length = 0;
        plan = { mode: 'mesh', reason: `the surface is closed and concave, but it could not be split into convex pieces (${messageOf(error)})` };
      }
    } else if (plan.mode === 'hull') {
      singleHull(dynamicY);
      const first = bodies[0]!.shape, kept = first.kind === 'hull' ? first.points.length / 3 : 0;
      notes.push(`Dynamic body: ${plan.reason}, so it is one convex hull of ${kept} points.`);
    }
    if (plan.mode === 'mesh') {
      bodies.push({
        id: 'mesh', type: 'static', shape: { kind: 'mesh', vertices: shortList(mesh.vertices), indices: Array.from(mesh.indices) },
        position: [0, shortFloat32(halfHeight + 0.002), 0], friction: 0.6, color: STATIC_MESH_COLOR,
      });
      notes.push(`Static mesh (it does not move): ${plan.reason}. ${triangles} triangles.`);
    } else {
      const volume = meshVolume(mesh);
      notes.push(`Mass ${digits(volume * IMPORT_DENSITY)} kg: ${digits(volume)} m³ at ${IMPORT_DENSITY} kg/m³.`);
    }
    const scene = { format: 'box3d-scene', version: 1, units: 'SI', world: {}, bodies, joints, meta: { title: name, description: `Imported geometry. ${notes.join(' ')}`.slice(0, SCENE_LIMITS.metaChars) } };
    const problems = validateScene(scene);
    if (problems.length > 0) return { ok: false, title: `${name} could not be turned into a scene`, problems };
    return { ok: true, scene: normalizeScene(scene), source: { kind: 'geometry', name }, title: name, notes };
  } catch (error) {
    return fail(`${name} could not be imported`, messageOf(error));
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Problems as lines of text for the page, with the count that did not fit. */
export function problemLines(problems: readonly SceneProblem[], limit: number = LAB_SCENE_LIMITS.shownProblems): { lines: string[]; more: number } {
  const lines = problems.slice(0, limit).map(problem => quoteForDisplay(problem.path ? `${problem.path}: ${problem.message}` : problem.message, 400));
  return { lines, more: Math.max(0, problems.length - limit) };
}

/** "9 bodies · 9 joints · sphere, revolute" for the scene panel. */
export function sceneSummary(scene: Scene): string {
  const kinds = [...new Set(scene.bodies.map(body => body.shape.kind))];
  const joints = scene.joints ?? [], types = [...new Set(joints.map(joint => joint.type))];
  const world = scene.world ?? {}, g = world.gravity ?? [0, -9.81, 0];
  return `${scene.bodies.length} ${scene.bodies.length === 1 ? 'body' : 'bodies'} (${kinds.join(', ') || 'none'}) · ${joints.length} ${joints.length === 1 ? 'joint' : 'joints'}` +
    `${types.length ? ` (${types.join(', ')})` : ''}${coupledSummary(scene)} · gravity ${digits(Math.hypot(g[0], g[1], g[2]))} m/s² · ${world.ground === false ? 'no ground slab' : 'ground slab'}`;
}

/** " · 1 basin (256 cells) · 4 cables …" for a coupled scene, or nothing. */
function coupledSummary(scene: Scene): string {
  const parts: string[] = [], count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  if (scene.water?.length) parts.push(`${count(scene.water.length, 'basin', 'basins')} (${scene.water.reduce((sum, basin) => sum + basin.cols * basin.rows, 0)} cells)`);
  if (scene.cables?.length) parts.push(`${count(scene.cables.length, 'cable', 'cables')} (${scene.cables.reduce((sum, cable) => sum + cable.masses.length, 0)} nodes)`);
  if (scene.frames?.length) parts.push(`${count(scene.frames.length, 'frame', 'frames')} (${scene.frames.reduce((sum, frame) => sum + frame.elements.length, 0)} elements)`);
  if (scene.cloths?.length) parts.push(`${count(scene.cloths.length, 'cloth', 'cloths')} (${scene.cloths.reduce((sum, cloth) => sum + cloth.nodes.length / 3, 0)} nodes)`);
  if (scene.grains?.length) parts.push(`${scene.grains.reduce((sum, set) => sum + set.radii.length, 0)} grains`);
  if (scene.solids?.length) parts.push(`${count(scene.solids.length, 'solid', 'solids')} (${scene.solids.reduce((sum, solid) => sum + solidMeshSize(solid).tets, 0)} tetrahedra${scene.solids.some(solid => solid.fracture) ? ', fracture' : ''}${scene.solids.some(solid => solid.contact) ? ', contact' : ''})`);
  if (scene.heat?.length) parts.push(`${count(scene.heat.length, 'heat grid', 'heat grids')}`);
  for (const fluid of scene.fluids ?? []) {
    const cells = fluid.cells[0] * fluid.cells[1] * fluid.cells[2];
    parts.push(fluid.kind === 'free-surface'
      ? `a free-surface tank (${cells} cells${fluid.positions ? `, ${fluid.positions.length / 3} particles` : ''})`
      : `a flow (${cells} cells${fluid.bodies?.length ? `, ${count(fluid.bodies.length, 'body', 'bodies')} in it` : ''})`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Nodes and tetrahedra of a solid's mesh as given. */
function solidMeshSize(solid: SceneSolid): { nodes: number; tets: number } {
  if ('box' in solid.mesh) { const [nx, ny, nz] = solid.mesh.box.cells; return { nodes: (nx + 1) * (ny + 1) * (nz + 1), tets: nx * ny * nz * (solid.mesh.box.pattern === 'kuhn6' ? 6 : 5) }; }
  return { nodes: solid.mesh.positions.length / 3, tets: solid.mesh.tets.length / 4 };
}
/** The corners of a solid's mesh as given, as a point list. */
function solidCorners(solid: SceneSolid): number[] {
  if (!('box' in solid.mesh)) return [...solid.mesh.positions];
  const o = solid.mesh.box.origin ?? [0, 0, 0], d = solid.mesh.box.size;
  return [o[0], o[1], o[2], o[0] + d[0], o[1] + d[1], o[2] + d[2]];
}

/** A camera target and distance; `yaw` and `pitch` (radians) when the scene asks for a view of its own (a flow is seen across its slice). */
export interface SceneFrame { readonly target: [number, number, number]; readonly distance: number; readonly yaw?: number; readonly pitch?: number }

/**
 * A camera target and distance for a scene. The view is centred on the bodies
 * that can move, when there are any, and is wide enough to show them and at
 * least a third of the whole scene, so a small car on a long terrain is not a
 * speck. The ground slab is not counted.
 */
export function sceneCameraFrame(scene: Scene): SceneFrame {
  type Box = { min: number[]; max: number[] };
  const empty = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const all = empty(), moving = empty();
  for (const body of scene.bodies) {
    const [px, py, pz] = body.position, shape = body.shape;
    const fixed = (body.type ?? 'dynamic') === 'static' || shape.kind === 'mesh' || shape.kind === 'heightfield';
    const grow = (x: number, y: number, z: number): void => {
      for (const box of fixed ? [all] : [all, moving]) {
        if (x < box.min[0]!) box.min[0] = x; if (y < box.min[1]!) box.min[1] = y; if (z < box.min[2]!) box.min[2] = z;
        if (x > box.max[0]!) box.max[0] = x; if (y > box.max[1]!) box.max[1] = y; if (z > box.max[2]!) box.max[2] = z;
      }
    };
    // Rotations are ignored: a sphere around each shape's local bounds is enough to frame it.
    const around = (cx: number, cy: number, cz: number, r: number): void => { grow(px + cx - r, py + cy - r, pz + cz - r); grow(px + cx + r, py + cy + r, pz + cz + r); };
    const cloud = (points: readonly number[]): void => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i + 2 < points.length; i += 3) for (let k = 0; k < 3; k++) { const v = points[i + k]!; if (v < lo[k]!) lo[k] = v; if (v > hi[k]!) hi[k] = v; }
      if (!(hi[0]! >= lo[0]!)) { around(0, 0, 0, 0.5); return; }
      around((lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2);
    };
    switch (shape.kind) {
      case 'box': around(0, 0, 0, Math.hypot(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2])); break;
      case 'sphere': around(0, 0, 0, shape.radius); break;
      case 'capsule': around(0, 0, 0, shape.radius + shape.halfLength); break;
      case 'hull': cloud(shape.points); break;
      case 'compound': for (const child of shape.shapes) {
        const [cx, cy, cz] = child.position ?? [0, 0, 0], one = child.shape;
        if (one.kind === 'hull') { let r = 0; for (let i = 0; i + 2 < one.points.length; i += 3) r = Math.max(r, Math.hypot(one.points[i]!, one.points[i + 1]!, one.points[i + 2]!)); around(cx, cy, cz, r); }
        else around(cx, cy, cz, one.kind === 'box' ? Math.hypot(one.halfExtents[0], one.halfExtents[1], one.halfExtents[2]) : one.kind === 'sphere' ? one.radius : one.radius + one.halfLength);
      } break;
      case 'mesh': cloud(shape.vertices); break;
      case 'heightfield': {
        let lo = Infinity, hi = -Infinity;
        for (const h of shape.heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
        const w = (shape.countX - 1) * shape.spacing[0], d = (shape.countZ - 1) * shape.spacing[1];
        grow(px, py + lo, pz); grow(px + w, py + hi, pz + d);
        break;
      }
    }
  }
  // The coupled sections: a basin and a frame are counted like fixed scenery, cables, cloths and grains like bodies that move.
  const point = (boxes: readonly Box[], x: number, y: number, z: number): void => {
    for (const box of boxes) {
      if (x < box.min[0]!) box.min[0] = x; if (y < box.min[1]!) box.min[1] = y; if (z < box.min[2]!) box.min[2] = z;
      if (x > box.max[0]!) box.max[0] = x; if (y > box.max[1]!) box.max[1] = y; if (z > box.max[2]!) box.max[2] = z;
    }
  };
  const points = (boxes: readonly Box[], values: readonly number[]): void => { for (let i = 0; i + 2 < values.length; i += 3) point(boxes, values[i]!, values[i + 1]!, values[i + 2]!); };
  for (const basin of scene.water ?? []) {
    const [ox, oy, oz] = basin.origin;
    point([all], ox, oy, oz); point([all], ox + basin.cols * basin.dx, oy + basin.restDepth, oz + basin.rows * basin.dz);
  }
  for (const frame of scene.frames ?? []) points([all], frame.nodes);
  for (const cable of scene.cables ?? []) points([all, moving], cable.nodes);
  for (const cloth of scene.cloths ?? []) points([all, moving], cloth.nodes);
  for (const set of scene.grains ?? []) points([all, moving], set.positions);
  // A solid is what the scene is about: the view is centred on the solids when there are any.
  const solidBox = empty();
  for (const solid of scene.solids ?? []) points([all, moving, solidBox], solidCorners(solid));
  // So is a fluid: its box, seen from close by. A flow's slice is the x-y plane: it is seen nearly face on.
  const fluidBox = empty();
  for (const fluid of scene.fluids ?? []) {
    const o = fluid.origin ?? [0, 0, 0], h = fluid.spacing;
    points([all, fluidBox], [o[0], o[1], o[2], o[0] + fluid.cells[0] * h, o[1] + fluid.cells[1] * h, o[2] + fluid.cells[2] * h]);
  }
  const has = (box: Box): boolean => box.max[0]! >= box.min[0]!;
  if (!has(all)) return { target: [0, 1, 0], distance: 8 };
  if (has(fluidBox) && !has(solidBox)) {
    const extent = Math.max(fluidBox.max[0]! - fluidBox.min[0]!, fluidBox.max[1]! - fluidBox.min[1]!, fluidBox.max[2]! - fluidBox.min[2]!);
    const flow = (scene.fluids ?? []).some(fluid => fluid.kind !== 'free-surface');
    return {
      target: [(fluidBox.min[0]! + fluidBox.max[0]!) / 2, (fluidBox.min[1]! + fluidBox.max[1]!) / 2, (fluidBox.min[2]! + fluidBox.max[2]!) / 2],
      distance: Math.min(400, Math.max(0.3, 1.35 * extent + 0.05)), yaw: flow ? 1.3 : 1.05, pitch: flow ? 0.2 : 0.42,
    };
  }
  const sizeOf = (box: Box): number => Math.hypot(box.max[0]! - box.min[0]!, box.max[1]! - box.min[1]!, box.max[2]! - box.min[2]!);
  const distanceFor = (size: number): number => size * 1.15 + 0.6;
  const focus = has(solidBox) ? solidBox : has(moving) ? moving : all;
  return {
    target: [(focus.min[0]! + focus.max[0]!) / 2, (focus.min[1]! + focus.max[1]!) / 2, (focus.min[2]! + focus.max[2]!) / 2],
    // A scene smaller than half a metre (a specimen: a plate, a bar) is framed by its own size, not from 0.9 m.
    distance: sizeOf(all) < 0.5 ? Math.max(0.3, 3 * sizeOf(focus), 1.2 * sizeOf(all)) : Math.min(400, Math.max(0.9, distanceFor(sizeOf(focus)), distanceFor(sizeOf(all)) / 3)),
  };
}

/** `name.json`, from a title, safe as a download file name. */
export function sceneFileName(title: string): string {
  const base = title.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64).replace(/\.(json|obj|stl|glb|gltf)$/i, '');
  return `${base || 'scene'}.json`;
}
