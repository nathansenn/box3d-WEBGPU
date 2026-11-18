/**
 * Geometry import and preparation: OBJ, STL and glTF 2.0 parsers that return
 * plain triangle meshes, mesh measures (volume, centre of mass, bounds,
 * convexity), convex hulls, an approximate convex decomposition, and helpers
 * that turn a mesh into the kit's hull, mesh and height-field shapes.
 *
 * Nothing here fetches, touches the DOM or needs the WASM: every function is
 * synchronous and works on data you already hold. Units are whatever the file
 * uses; the kit's worlds are in metres, so scale with `transformMesh` first
 * when a file is in millimetres. Malformed input throws
 * `EngineError('INVALID_PAYLOAD')` with the reason.
 *
 * The code lives in the repository's src/engine/geometry.ts, which the Physics
 * Lab uses too. This module publishes it and types `createBodiesFromMesh` with
 * the kit's body options.
 */
import {createBodiesFromMesh as coreCreateBodiesFromMesh, type BodyFactory as CoreBodyFactory, type ConvexDecomposeOptions, type ConvexDecomposition, type MeshBodiesOptions as CoreMeshBodiesOptions, type MeshLike} from './core/geometry.js';
import type {Body, BodyOptions, BodyType, Joint, JointOptions, Vec3Like} from './world.js';

export * from './core/geometry.js';

/** The part of `PhysicsWorld` this module uses. */
export interface BodyFactory {
  createBody(options: BodyOptions): Body | null;
  createJoint(options: JointOptions): Joint;
  destroyBody?(body: Body): boolean;
}

export interface MeshBodiesOptions extends Omit<BodyOptions, 'shape' | 'position' | 'type'> {
  /**
   * 'mesh' (default): one static triangle-mesh body, for scenery of any shape.
   * 'hull': one body with the mesh's convex hull.
   * 'decomposed': one hull body per piece of `convexDecompose`, welded together.
   */
  readonly as?: 'mesh' | 'hull' | 'decomposed';
  /** Where the mesh's origin goes. Default [0, 0, 0]. */
  readonly position?: Vec3Like;
  /** For 'hull' and 'decomposed'. Default 'dynamic'. A 'mesh' body is always static. */
  readonly type?: BodyType;
  /** For 'hull': most hull points, default 32. */
  readonly maxPoints?: number;
  /** For 'decomposed'. */
  readonly decomposition?: ConvexDecomposeOptions;
}

export interface MeshBodies {
  bodies: Body[];
  /** Weld joints holding a decomposed set together (bodies[0] to each other body). Empty otherwise. */
  joints: Joint[];
  /** The decomposition, when `as` is 'decomposed'. */
  decomposition?: ConvexDecomposition;
}

/**
 * Put a mesh into a world.
 *
 * - `as: 'mesh'`: one static triangle-mesh body.
 * - `as: 'hull'`: one body shaped as the mesh's convex hull (see `toHullShape`
 *   for how many points are kept). For a closed mesh the density is scaled so
 *   the body's mass is density x mesh volume, whether the hull is larger than
 *   the mesh (a concave solid) or smaller (a rounded solid cut to 44 points);
 *   for an open mesh the mass is density x hull volume.
 * - `as: 'decomposed'`: the kit has no compound shapes yet, so a concave solid
 *   becomes one hull body per convex piece, all created at the same pose and
 *   held together by weld joints to the largest piece. The pieces share a
 *   negative collision group (pass `filter.groupIndex` to choose it), so they
 *   do not push each other apart. Each piece's density is scaled by its exact
 *   volume over its hull volume, so the set's total mass is density x mesh
 *   volume even where hulls overlap. Welds are solved iteratively: under hard
 *   impacts the set flexes slightly, unlike a true compound body.
 */
export function createBodiesFromMesh(world: BodyFactory, mesh: MeshLike, options: MeshBodiesOptions = {}): MeshBodies {
  // The kit's options differ from the native descriptor only in accepting {x, y, z} vectors, which the world converts.
  return coreCreateBodiesFromMesh<Body, Joint>(world as unknown as CoreBodyFactory<Body, Joint>, mesh, options as unknown as CoreMeshBodiesOptions);
}
