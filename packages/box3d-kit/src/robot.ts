/**
 * Robot import: URDF and MJCF files as scenes, or as bodies and joints in a
 * world. `parseURDF` and `parseMJCF` read a file into one neutral description;
 * `robotToScene` turns a description into a scene file (see
 * `box3d-webgpu-kit/scene`), `spawnRobot` adds it to a world and returns
 * handles by link and joint name, and `robotReport` says how far the result
 * is from the file.
 *
 * Read the report. The engine derives a body's inertia from its shape and
 * density, so the import matches each link's MASS exactly and reports the
 * inertia that results; every element it ignored or approximated is in
 * `warnings`. docs/ROBOT_IMPORT.md in the repository has the tables of what is
 * supported, the conventions and the measured errors.
 *
 * The code lives in the repository's src/engine/robot-import.ts. This module
 * publishes it and types `spawnRobot` with the kit's body and joint handles.
 */
import {spawnRobot as coreSpawnRobot, type RobotDescription, type RobotHost as CoreRobotHost, type RobotSceneOptions, type SpawnedRobot as CoreSpawnedRobot} from './core/robot-import.js';
import type {Body, BodyOptions, Joint, JointOptions} from './world.js';

export * from './core/robot-import.js';

/** The part of `PhysicsWorld` this module uses. */
export interface RobotHost {
  createBody(options: BodyOptions): Body | null;
  createJoint(options: JointOptions): Joint;
  destroyBody?(body: Body): boolean;
}
export type SpawnedRobot = CoreSpawnedRobot<Body, Joint>;

/**
 * Add a robot to a world that already exists, without resetting it, and return
 * handles by link and joint name:
 *
 *     const robot = spawnRobot(world, parseURDF(text), {position: [0, 0, 0]});
 *     world.setJointMotor(robot.joints.get('elbow'), {speed: 1, maxForce: 20});
 *     const pose = robotLinkPose(world.getState(robot.links.get('hand').body), robot.links.get('hand').frame);
 *
 * The bodies and joints are those of `robotToScene`, created in the same
 * order, so the world steps exactly like one loaded from that scene. The
 * scene's world settings (gravity, ground, step) are NOT applied: the world
 * keeps its own. If the world fills up part-way, the bodies made so far are
 * destroyed and the error names the body.
 */
export function spawnRobot(world: RobotHost, description: RobotDescription, options: RobotSceneOptions = {}): SpawnedRobot {
  // The kit's options differ from the native descriptors only in also accepting {x, y, z} vectors.
  return coreSpawnRobot<Body, Joint>(world as unknown as CoreRobotHost<Body, Joint>, description, options);
}
