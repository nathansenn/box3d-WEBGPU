/**
 * Scene files: one plain-JSON description of a rigid-body scene that can be
 * validated, loaded, saved, diffed, hashed and carried in a share link.
 *
 * The format, its validator, the canonical form, the link codec, the example
 * scenes and the builder live in the repository's src/engine/scene-format.ts,
 * which the Physics Lab uses too. This module publishes them and pins the
 * builder, `loadScene` and `saveScene` to the kit's PhysicsWorld.
 * The format is documented in docs/SCENE_FORMAT.md.
 */
import {EngineError} from './core/contracts.js';
import {
  SceneBuilder as CoreSceneBuilder, normalizeScene,
  type SaveSceneOptions, type Scene, type SceneBody, type SceneJoint, type SceneJointInput, type SceneMaterial, type SceneMeta,
} from './core/scene-format.js';
import {buildSceneSimulation, type Simulation} from './core/simulation.js';
import type {WaterCoupling} from './core/water-coupling.js';
import type {StructureAttachment, StructureCoupling} from './core/structure-coupling.js';
import type {CompliantCableRuntime} from './core/compliant-cable.js';
import type {FrameRuntime} from './core/frame-runtime.js';
import type {ClothCoupling} from './core/cloth.js';
import type {GranularCoupling} from './core/granular.js';
import type {Body, BodyOptions, Joint, PhysicsWorld} from './world.js';

export * from './core/scene-format.js';

/** A body description for SceneBuilder.addBody: a scene body without its id, or the kit's BodyOptions (bigint filter bits, typed arrays, {x, y, z} vectors). */
export type SceneBodyInput = Omit<SceneBody, 'id'> | BodyOptions;

export interface LoadedScene {
  readonly bodies: Map<string, Body>;
  readonly joints: Map<string, Joint>;
  /** Holds the descriptions; use it to add, remove and save. */
  readonly builder: SceneBuilder;
  /** The scene in normal form, as it was built. */
  readonly scene: Scene;
  /**
   * Steps the world and everything else the scene describes, in the right
   * order. Call `simulation.step()` or `simulation.update(frameSeconds)`
   * instead of the world's; for a scene of rigid bodies and joints only the
   * two are the same thing. See `box3d-webgpu-kit/simulation`.
   */
  readonly simulation: Simulation<PhysicsWorld, Body>;
  /** The scene's water basins by id (empty for a rigid-only scene). Each is a subsystem of `simulation` under its id. */
  readonly water: Map<string, WaterCoupling<Body>>;
  readonly cables: Map<string, CompliantCableRuntime>;
  readonly frames: Map<string, FrameRuntime>;
  /** The coupling that holds every cable and frame of the scene (subsystem 'structure'), or null. */
  readonly structure: StructureCoupling<Body> | null;
  /** Live attachment reports, keyed '<cable or frame id>:<index in its attachments>'. */
  readonly attachments: Map<string, StructureAttachment>;
  /** The scene's cloths by id; each coupling is a subsystem of `simulation` under its id, and `.cloth` is the solver. */
  readonly cloths: Map<string, ClothCoupling<Body>>;
  /** The scene's grain sets by id; each coupling is a subsystem of `simulation` under its id, and `.granular` is the solver. */
  readonly grains: Map<string, GranularCoupling<Body>>;
}

/**
 * A PhysicsWorld plus the description of everything put into it. The world
 * cannot report shapes or joint definitions, so the builder remembers them as
 * it creates each body and joint, and `toJSON()` writes them back out with the
 * bodies' current poses and velocities.
 *
 * Constructing a builder RESETS the world to the given settings. Create and
 * remove bodies and joints through the builder; what you change on the world
 * directly (setJointMotor, setDamping, setCollisionFilter, ...) is not seen,
 * except pose, velocity, body type and gravity, which are read back on save.
 */
export class SceneBuilder extends CoreSceneBuilder<PhysicsWorld> {
  declare readonly world: PhysicsWorld;
  /** Shown in saved scenes. Assign to change it. */
  declare meta: SceneMeta | undefined;
  declare extensions: {readonly [key: string]: unknown} | undefined;
  /** Add or replace a named material. Bodies already created keep the values they were built with. */
  override defineMaterial(name: string, material: SceneMaterial): void { super.defineMaterial(name, material); }
  /** Validate, create and remember a body. Throws when the description is invalid, the id is taken, or the world is full. */
  override addBody(id: string, body: SceneBodyInput): Body { return super.addBody(id, body as Omit<SceneBody, 'id'>); }
  /** Validate, create and remember a joint between two bodies named by id (null is the fixed world). */
  override addJoint(id: string, joint: SceneJointInput): Joint { return super.addJoint(id, joint); }
  /** Destroy a body (and with it the joints attached to it) or a joint. Returns false for an unknown id. */
  override remove(id: string): boolean { return super.remove(id); }
  override has(id: string): boolean { return super.has(id); }
  override body(id: string): Body | undefined { return super.body(id); }
  override joint(id: string): Joint | undefined { return super.joint(id); }
  /** The id a body or joint handle was created under, if this builder made it. */
  override idOf(handle: Body | Joint): string | undefined { return super.idOf(handle); }
  /** A new id -> handle map of the live bodies, in creation order. */
  override bodies(): Map<string, Body> { return super.bodies(); }
  override joints(): Map<string, Joint> { return super.joints(); }
  /** The description a body or joint was created from (normal form), or undefined. */
  override describe(id: string): SceneBody | SceneJoint | undefined { return super.describe(id); }
  /**
   * The scene as JSON, in normal form. By default each body carries its
   * CURRENT position, rotation, velocities and type from the solver, and the
   * world its current gravity, so loading the result resumes from this moment.
   * A value the solver still holds unchanged is written as it was authored.
   * Not carried: sleep state, contact and joint impulses (the solver starts
   * them from zero), forces applied for the next step, the tick count, and any
   * setting changed on the world directly other than those listed above.
   */
  override toJSON(options: SaveSceneOptions = {}): Scene { return super.toJSON(options); }

  /** @internal Build a validated, normalised scene; on any failure leave the world reset and empty. */
  static build(world: PhysicsWorld, scene: Scene): SceneBuilder {
    return new SceneBuilder(world, {world: scene.world, materials: scene.materials, meta: scene.meta, extensions: scene.extensions}).populate(scene);
  }
}

/**
 * Validate a scene, reset the world to its settings and build every body, then
 * every joint, in file order. The world's body capacity is raised first when
 * the scene needs more than it has.
 *
 * - An invalid scene throws SceneValidationError (code 'INVALID_PAYLOAD',
 *   `problems` holds the full list) and the world is NOT touched.
 * - A world created with another step or sub-step count throws
 *   EngineError('INVALID_STATE') and is not touched: create it with
 *   `createWorld(sceneWorldOptions(scene))`.
 * - If the engine refuses a body or joint part-way, the world is left reset to
 *   the scene's settings with none of the scene's bodies in it, and the error
 *   names the offending id.
 *
 * The scene's `water`, `cables`, `frames`, `cloths` and `grains` sections are built after the
 * joints, and the result carries a ready `simulation` that steps the world
 * and all of them. A rigid-only scene builds exactly what it always did.
 */
export function loadScene(world: PhysicsWorld, scene: unknown): LoadedScene {
  const normal = normalizeScene(scene), builder = SceneBuilder.build(world, normal);
  const built = buildSceneSimulation(world, builder, normal);
  return {bodies: built.bodies, joints: built.joints, builder, scene: normal, simulation: built.simulation, water: built.water, cables: built.cables, frames: built.frames, structure: built.structure, attachments: built.attachments, cloths: built.cloths, grains: built.grains};
}

/**
 * The scene a builder (or the result of loadScene) describes, with each body's
 * current state: see SceneBuilder.toJSON for exactly what is and is not saved.
 */
export function saveScene(world: PhysicsWorld, handles: SceneBuilder | {readonly builder: SceneBuilder}, options: SaveSceneOptions = {}): Scene {
  const builder = handles instanceof SceneBuilder ? handles : handles?.builder;
  if (!(builder instanceof SceneBuilder)) throw new EngineError('INVALID_PAYLOAD', 'saveScene needs the SceneBuilder that built the scene, or the result of loadScene.');
  if (builder.world !== world) throw new EngineError('INVALID_PAYLOAD', 'That SceneBuilder belongs to another world.');
  return builder.toJSON(options);
}
