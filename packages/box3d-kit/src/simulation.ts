/**
 * One stepping loop for every solver: a `Simulation` owns a PhysicsWorld and
 * any number of registered subsystems (water coupling, structure coupling,
 * heat, deformable solids, links between them) and advances them all with one
 * `step()` or `update(frameSeconds)`, in a fixed stage order, with one clock,
 * one energy ledger and one event stream. A run through it is bit-identical
 * to calling the modules by hand in their documented order.
 *
 * The contract, the adapters and the scene builder live in the repository's
 * src/engine/simulation.ts. This module publishes them and pins the scene
 * loader to the kit's PhysicsWorld. See docs/SIMULATION.md in the repository.
 */
import {Simulation, loadSimulationScene as coreLoadSimulationScene, type LoadedSimulationScene as CoreLoadedSimulationScene, type SimulationOptions} from './core/simulation.js';
import type {Body, PhysicsWorld} from './world.js';

export * from './core/simulation.js';

/** A Simulation of a PhysicsWorld. */
export type WorldSimulation = Simulation<PhysicsWorld, Body>;
/** What `loadSimulationScene` returns for a PhysicsWorld. */
export type LoadedSimulationScene = CoreLoadedSimulationScene<PhysicsWorld>;

/** A Simulation that owns the stepping of `world`. Register subsystems with `add`, then call `step()` instead of `world.step()`. */
export function createSimulation(world: PhysicsWorld, options: SimulationOptions = {}): WorldSimulation {
  return new Simulation<PhysicsWorld, Body>(world, options);
}

/**
 * Validate a scene, build its bodies, joints, water basins, cables and frames
 * in `world`, and return them with a ready Simulation. `loadScene` of
 * `box3d-webgpu-kit/scene` does the same and returns the kit's SceneBuilder.
 */
export function loadSimulationScene(world: PhysicsWorld, scene: unknown): LoadedSimulationScene {
  return coreLoadSimulationScene(world, scene);
}
