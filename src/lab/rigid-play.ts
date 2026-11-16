/**
 * Playing a scene in the Physics Lab: the keys and the beams of a scene whose bodies and joints carry roles
 * (src/engine/scene-roles.ts: a character, a vehicle, platforms, a ray-cast scanner).
 *
 * The roles are registered with the scene's Simulation, so the Lab steps such a scene through it and a Lab
 * checkpoint holds the roles' state. This module only decides what the player asks for in each step:
 *
 * - W A S D or the arrow keys walk the character, relative to the camera; Space jumps.
 * - W and S (up, down) are the car's throttle and reverse, A and D (left, right) steer, Space brakes.
 * - Left alone, the scene plays itself (the character's route, the car's autopilot). After a key was used, the
 *   player keeps control until nothing has been pressed for `IDLE_SECONDS`.
 *
 * Nothing here touches the DOM, so it is tested in Node (tests/physics/rigid-play.test.mjs).
 */
import type { DebugLine } from '../types.ts';
import { attachSceneRoles, type SceneRoles, type SceneRolesHost, type SceneRolesInput, type SceneRolesSource } from '../engine/scene-roles.ts';
import type { Subsystem } from '../engine/simulation.ts';
import type { NativeBodyHandle } from '../engine/native-world.ts';

/** `KeyboardEvent.code` values the Lab hands to a playable scene instead of its own shortcuts. */
export const PLAY_KEYS: { readonly [code: string]: 'forward' | 'back' | 'left' | 'right' | 'action' } = Object.freeze({
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'action',
});
/** Seconds without a key after which the scene plays itself again. */
export const IDLE_SECONDS = 4;

export type RigidPlayKind = 'character' | 'vehicle' | 'watch';

export class RigidPlay {
  readonly roles: SceneRoles;
  /** What the keys drive: the character, the vehicle, or nothing (platforms and lasers only). */
  readonly kind: RigidPlayKind;
  /** The camera's yaw (the Lab's: the eye is at target + (cos yaw, ., sin yaw) * distance). Walking is relative to it. */
  cameraYaw = 0;
  private readonly held = new Set<string>();
  private readonly step: number;
  /** Steps since a key was last held; Infinity until the first key. */
  private idleSteps = Infinity;
  private lines: DebugLine[] = [];
  private linesTime = -1;
  /** Changes whenever `beamLines()` returns different lines. */
  version = 0;

  constructor(loaded: SceneRolesSource & { readonly builder: { readonly world: SceneRolesHost }; readonly simulation: { add(subsystem: Subsystem<SceneRolesHost, NativeBodyHandle>): unknown } }) {
    this.step = loaded.builder.world.loop.step;
    this.roles = attachSceneRoles(loaded, { input: () => this.input() });
    this.kind = this.roles.character ? 'character' : this.roles.vehicle ? 'vehicle' : 'watch';
  }

  /** True when the keys of PLAY_KEYS belong to the scene. */
  get takesKeys(): boolean { return this.kind !== 'watch'; }
  /** True while the player, not the scene, is in control. */
  get manual(): boolean { return this.held.size > 0 || this.idleSteps * this.step < IDLE_SECONDS; }

  /** A key went down. Returns true when it is a play key of this scene (the caller then leaves its own shortcuts alone). */
  keyDown(code: string): boolean {
    if (!this.takesKeys || !Object.hasOwn(PLAY_KEYS, code)) return false;
    this.held.add(code); this.idleSteps = 0;
    return true;
  }
  keyUp(code: string): boolean {
    if (!this.takesKeys || !Object.hasOwn(PLAY_KEYS, code)) return false;
    this.held.delete(code);
    return true;
  }
  /** Let go of every key (the window lost focus, say). */
  releaseAll(): void { this.held.clear(); }

  private pressed(action: string): boolean { for (const code of this.held) if (PLAY_KEYS[code] === action) return true; return false; }

  /** What the player asks for in the coming step, or null when the scene plays itself. Called once per step by the roles. */
  input(): SceneRolesInput | null {
    if (this.held.size > 0) this.idleSteps = 0; else if (Number.isFinite(this.idleSteps)) this.idleSteps++;
    if (!this.manual) return null;
    const along = (this.pressed('forward') ? 1 : 0) - (this.pressed('back') ? 1 : 0), side = (this.pressed('right') ? 1 : 0) - (this.pressed('left') ? 1 : 0), action = this.pressed('action');
    if (this.kind === 'vehicle') return { throttle: along, steer: -side, brake: action ? 1 : 0 };
    // The camera looks along (-cos yaw, -sin yaw) in the ground plane; its right is (sin yaw, -cos yaw).
    const fx = -Math.cos(this.cameraYaw), fz = -Math.sin(this.cameraYaw);
    return { move: [along * fx - side * fz, along * fz + side * fx], jump: action };
  }

  /** The point the camera should look at: the character or the car; null for a scene that is only watched. */
  follow(): [number, number, number] | null {
    const c = this.roles.character, v = this.roles.vehicle;
    if (c) { const p = c.state.position; return [p[0], p[1], p[2]]; }
    if (v) { const p = v.state.position; return [p[0], p[1], p[2]]; }
    return null;
  }

  /** The laser beams as overlay lines: bright to a hit, faint where the ray ran its whole range. The array is reused. */
  beamLines(): readonly DebugLine[] {
    const time = this.roles.time;
    if (time === this.linesTime) return this.lines;
    const beams = this.roles.beams(), out = this.lines;
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i]!, hit = beam.body !== null;
      let line = out[i];
      if (!line) { line = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0, g: 0, b: 0, a: 1 }; out[i] = line; }
      line.ax = beam.from[0]; line.ay = beam.from[1]; line.az = beam.from[2]; line.bx = beam.to[0]; line.by = beam.to[1]; line.bz = beam.to[2];
      // The renderers draw lines brighter than their colour (they are part of the lit, tone-mapped frame): a dark red reads as red.
      line.r = hit ? 0.6 : 0.2; line.g = hit ? 0.03 : 0.07; line.b = hit ? 0.05 : 0.08; line.a = hit ? 0.95 : 0.35;
    }
    out.length = beams.length;
    this.linesTime = time; this.version = (this.version + 1) >>> 0;
    return out;
  }

  /** For `box3dLab.playState()` and the tests. */
  state(): Record<string, unknown> {
    const s = this.roles.state;
    return { kind: this.kind, manual: this.manual, held: [...this.held].sort(), time: s.time, platforms: s.platforms, lasers: s.lasers,
      character: s.character ? { position: s.character.position, feet: s.character.feet, grounded: s.character.grounded, waypoint: s.character.waypoint, laps: s.character.laps } : null,
      vehicle: s.vehicle ? { position: s.vehicle.position, forwardSpeed: s.vehicle.forwardSpeed, yawRate: s.vehicle.yawRate } : null };
  }
}
