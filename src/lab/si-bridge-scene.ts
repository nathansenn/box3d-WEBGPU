/**
 * The cable-stayed bridge (src/engine/si-bridge.ts) as a Physics Lab scene.
 *
 * The model owns the physics: frame elements, stays, the coupling and one rigid body for the
 * vehicle. This file only draws it with what the Lab renderer already has:
 *   - each deck and tower element is a kinematic box set on the chord of its two nodes;
 *   - each stay is one segment of the renderer's rope stream, between the node positions;
 *   - the vehicle is a kinematic box riding on the deck where the model's rigid body is;
 *   - ground, banks, water and tower footings are static boxes.
 * None of these bodies collides with anything (the model has no contact), so they add nothing to
 * the rigid solve.
 *
 * Drawn displacements can be exaggerated: a node is drawn at rest + factor x displacement. The
 * numbers in the panel are never exaggerated. The model's own vehicle body is a small dense block
 * at the deck axis; it is the last row of the world and is left out of the draw, and the box that
 * is drawn follows it (docs/SI_BRIDGE.md says why the body sits at the axis).
 */
import type { NativeBodyHandle, NativeQuaternion, NativeWorldBackend } from '../engine/native-world.ts';
import { cableStayedLayout, SiBridge, SI_BRIDGE_DEFAULTS, SI_BRIDGE_NO_COLLISION, type SiBridgeLayout, type SiBridgeParams } from '../engine/si-bridge.ts';
import type { GpuSegmentGridFrame } from '../types';

export interface SiBridgeSceneSettings {
  /** Vehicle mass in kg; 0 for no vehicle. */
  readonly vehicleMass: number;
  /** Vehicle speed in m/s. */
  readonly vehicleSpeed: number;
  /** Lateral wind load on the deck in N/m. */
  readonly windLoad: number;
}
export const SI_BRIDGE_SCENE_DEFAULTS: SiBridgeSceneSettings = Object.freeze({ vehicleMass: 20000, vehicleSpeed: 10, windLoad: 0 });
/** The scene's fixed step and what the Lab does with it: two 1/120 s steps in each 1/60 s tick. */
export const SI_BRIDGE_SCENE_STEP = Object.freeze({ hz: 120, subSteps: 4, stepsPerTick: 2 });
export const SI_BRIDGE_EXAGGERATIONS = Object.freeze([1, 10, 50, 100]);

const NO_COLLISION = SI_BRIDGE_NO_COLLISION;
const DECK_COLOR = 0xc3c9d1, TOWER_COLOR = 0xb9482e, VEHICLE_COLOR = 0xe2a31d, GROUND_COLOR = 0x5f6a4a, BANK_COLOR = 0x7b7362, WATER_COLOR = 0x1f5f8a, FOOTING_COLOR = 0x8d8f8c;
/** Half extents of the drawn vehicle, m: an 8 m long, 3 m high, 2.5 m wide box. */
const SHELL: readonly [number, number, number] = [4, 1.5, 1.25];
const STAY_RADIUS = 0.07;

type Vec3 = [number, number, number];

/** Quaternion of the rotation whose columns are the unit vectors x, y, z. */
function quaternionFromAxes(x: Vec3, y: Vec3, z: Vec3, out: [number, number, number, number]): void {
  const trace = x[0] + y[1] + z[2];
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    out[3] = s / 4; out[0] = (y[2] - z[1]) / s; out[1] = (z[0] - x[2]) / s; out[2] = (x[1] - y[0]) / s;
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]);
    out[3] = (y[2] - z[1]) / s; out[0] = s / 4; out[1] = (y[0] + x[1]) / s; out[2] = (z[0] + x[2]) / s;
  } else if (y[1] > z[2]) {
    const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]);
    out[3] = (z[0] - x[2]) / s; out[0] = (y[0] + x[1]) / s; out[1] = s / 4; out[2] = (z[1] + y[2]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]);
    out[3] = (x[1] - y[0]) / s; out[0] = (z[0] + x[2]) / s; out[1] = (z[1] + y[2]) / s; out[2] = s / 4;
  }
}

export class SiBridgeScene {
  readonly layout: SiBridgeLayout;
  readonly model: SiBridge;
  readonly settings: SiBridgeSceneSettings;
  readonly params: SiBridgeParams = SI_BRIDGE_DEFAULTS;
  /** The stays as the renderer's rope stream: two nodes and one segment each. */
  readonly ropeGrid: GpuSegmentGridFrame;
  /** Suggested camera: the whole bridge from a little above deck level, x = 0 on the left (the vehicle drives left to right). */
  readonly camera = { yaw: 2.03, pitch: 0.15, distance: 80, target: [60, 3, 0] as [number, number, number] };
  /** Wall-clock cost of the steps taken since the last call of takeStepCost(). */
  private stepMs = 0;
  private stepCount = 0;
  private stepStart = 0;
  private exaggerationFactor = 1;
  private dirty = true;
  private readonly world: NativeWorldBackend;
  private readonly members: NativeBodyHandle[] = [];
  private readonly shell: NativeBodyHandle | null = null;
  private readonly drawn: Float64Array;
  private readonly ends = new Float64Array(6);
  private readonly q: [number, number, number, number] = [0, 0, 0, 1];

  /** Build the scenery, the drawn members and the model in `world`, which is reset first. */
  constructor(world: NativeWorldBackend, settings: SiBridgeSceneSettings = SI_BRIDGE_SCENE_DEFAULTS, seed = 1) {
    this.world = world;
    this.settings = settings;
    const params = this.params, layout = this.layout = cableStayedLayout(params), length = layout.length, depth = params.towerDepth;
    world.resetWorld({ seed, ground: false, gravity: [0, -9.81, 0] });
    const scenery = (halfExtents: Vec3, position: Vec3, color: number): void => {
      if (!world.createBody({ shape: { kind: 'box', halfExtents }, type: 'static', position, color, filter: NO_COLLISION })) throw new Error('The rigid world has no room for the bridge scenery.');
    };
    // River bed under everything, the water between the banks, a bank under each abutment, a footing under each tower.
    scenery([length / 2 + 80, 0.5, 70], [length / 2, -depth - 0.5, 0], GROUND_COLOR);
    scenery([length / 2 - 12, 0.6, 69.5], [length / 2, -depth + 0.6, 0], WATER_COLOR);
    const deckDepth = params.deck.depth, bankHeight = depth - deckDepth - 0.05;
    scenery([46, bankHeight / 2, 69.8], [-34, -depth + bankHeight / 2, 0], BANK_COLOR);
    scenery([46, bankHeight / 2, 69.8], [length + 34, -depth + bankHeight / 2, 0], BANK_COLOR);
    for (const tower of layout.towers) scenery([3, 1, 3], [tower.x, -depth + 1, 0], FOOTING_COLOR);
    // One kinematic box per element, sized from the section; sync() puts it on the chord of its nodes.
    const p = layout.positions;
    layout.elements.forEach((element, index) => {
      const section = layout.members[index] === 'deck' ? params.deck : params.tower;
      const half = Math.hypot(p[3 * element.b] - p[3 * element.a], p[3 * element.b + 1] - p[3 * element.a + 1], p[3 * element.b + 2] - p[3 * element.a + 2]) / 2;
      const body = world.createBody({ shape: { kind: 'box', halfExtents: [half, section.depth / 2, section.width / 2] }, type: 'kinematic', position: [p[3 * element.a], p[3 * element.a + 1], 0],
        color: layout.members[index] === 'deck' ? DECK_COLOR : TOWER_COLOR, filter: NO_COLLISION });
      if (!body) throw new Error('The rigid world has no room for the bridge members.');
      this.members.push(body);
    });
    if (settings.vehicleMass > 0) {
      this.shell = world.createBody({ shape: { kind: 'box', halfExtents: SHELL }, type: 'kinematic', position: [0, SHELL[1], 0], color: VEHICLE_COLOR, filter: NO_COLLISION });
      if (!this.shell) throw new Error('The rigid world has no room for the vehicle.');
    }
    // The model last: its vehicle body is then the last row of the world, which the Lab leaves out of the draw.
    this.model = new SiBridge(world, layout, {
      hz: SI_BRIDGE_SCENE_STEP.hz, subSteps: SI_BRIDGE_SCENE_STEP.subSteps, windLoad: settings.windLoad, warm: true,
      vehicle: settings.vehicleMass > 0 ? { mass: settings.vehicleMass, speed: settings.vehicleSpeed, loop: true } : null,
    });
    this.drawn = new Float64Array(layout.positions.length);
    const stays = layout.stays.length, segments = new Float32Array(8 * stays);
    for (let i = 0; i < stays; i++) segments.set([2 * i, 2 * i + 1, 1 / this.model.statics.restLengths[i], STAY_RADIUS, 0.86, 0.88, 0.9, 1], 8 * i);
    this.ropeGrid = { presentation: 'rope', positions: new Float32Array(6 * stays), segments, nodeCount: 2 * stays, segmentCount: stays, topologyVersion: 1, frameVersion: 0 };
    this.sync();
  }

  get exaggeration(): number { return this.exaggerationFactor; }
  set exaggeration(factor: number) {
    if (!(Number.isFinite(factor) && factor >= 1 && factor <= 1000)) throw new RangeError('The exaggeration factor must be between 1 and 1000.');
    if (factor !== this.exaggerationFactor) { this.exaggerationFactor = factor; this.dirty = true; }
  }
  /** Rows of the world to draw: all of them but the model's own vehicle body when that is the last row. */
  drawnRows(bodyCount: number): number {
    const vehicle = this.model.vehicle;
    return vehicle && this.world.bodyIndex(vehicle.body) === bodyCount - 1 ? bodyCount - 1 : bodyCount;
  }
  /** Call before each fixed step of the world. */
  beforeStep(): void { this.stepStart = performance.now(); this.model.beforeWorldStep(); }
  /** Call after each fixed step of the world. */
  afterStep(): void { this.model.afterWorldStep(); this.stepMs += performance.now() - this.stepStart; this.stepCount++; this.dirty = true; }
  /** Mean wall-clock milliseconds per fixed step (coupling, structure and rigid world) since the last call; NaN if none ran. */
  takeStepCost(): number { const mean = this.stepCount > 0 ? this.stepMs / this.stepCount : NaN; this.stepMs = 0; this.stepCount = 0; return mean; }
  failStay(index: number): boolean { const failed = this.model.failStay(index); if (failed) this.dirty = true; return failed; }

  /** Put the drawn bodies and the stay stream where the model is, with the exaggeration. Returns false when nothing moved. */
  sync(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    const { layout, model, world, drawn, q } = this, factor = this.exaggerationFactor, rest = layout.positions, u = model.frame.couplingViews().displacements;
    for (let node = 0; node < rest.length / 3; node++) for (let k = 0; k < 3; k++) drawn[3 * node + k] = rest[3 * node + k] + factor * u[6 * node + k];
    const x: Vec3 = [0, 0, 0], y: Vec3 = [0, 0, 0], z: Vec3 = [0, 0, 0];
    /** Axes of a member from a to b whose second axis leans towards `up`. Returns the chord length. */
    const axes = (a: number, b: number, up: readonly [number, number, number]): number => {
      for (let k = 0; k < 3; k++) x[k] = drawn[3 * b + k] - drawn[3 * a + k];
      const length = Math.hypot(x[0], x[1], x[2]); for (let k = 0; k < 3; k++) x[k] /= length;
      const along = up[0] * x[0] + up[1] * x[1] + up[2] * x[2];
      for (let k = 0; k < 3; k++) y[k] = up[k] - along * x[k];
      const size = Math.hypot(y[0], y[1], y[2]); for (let k = 0; k < 3; k++) y[k] /= size;
      z[0] = x[1] * y[2] - x[2] * y[1]; z[1] = x[2] * y[0] - x[0] * y[2]; z[2] = x[0] * y[1] - x[1] * y[0];
      return length;
    };
    layout.elements.forEach((element, index) => {
      const deck = layout.members[index] === 'deck';
      axes(element.a, element.b, element.up);
      quaternionFromAxes(x, y, z, q);
      // The deck box hangs below its axis, so that the node line is the deck surface the stays reach; a tower box is centred.
      const drop = deck ? this.params.deck.depth / 2 : 0;
      world.setBodyTransform(this.members[index], [
        (drawn[3 * element.a] + drawn[3 * element.b]) / 2 - drop * y[0], (drawn[3 * element.a + 1] + drawn[3 * element.b + 1]) / 2 - drop * y[1], (drawn[3 * element.a + 2] + drawn[3 * element.b + 2]) / 2 - drop * y[2]], q as NativeQuaternion);
    });
    if (this.shell && model.vehicle) {
      const { index, xi } = model.statics.locate(model.vehicle.x), a = layout.deckNodes[index], b = layout.deckNodes[index + 1];
      axes(a, b, [0, 1, 0]);
      quaternionFromAxes(x, y, z, q);
      world.setBodyTransform(this.shell, [
        drawn[3 * a] + xi * (drawn[3 * b] - drawn[3 * a]) + SHELL[1] * y[0], drawn[3 * a + 1] + xi * (drawn[3 * b + 1] - drawn[3 * a + 1]) + SHELL[1] * y[1], drawn[3 * a + 2] + xi * (drawn[3 * b + 2] - drawn[3 * a + 2]) + SHELL[1] * y[2]], q as NativeQuaternion);
    }
    // Stays: tower end and deck end at the drawn nodes; a failed stay keeps its true shape below its drawn tower end.
    const positions = this.ropeGrid.positions, ends = this.ends;
    layout.stays.forEach((stay, i) => {
      model.stayEnds(i, ends);
      const failed = model.failed.includes(i);
      for (let k = 0; k < 3; k++) {
        const top = drawn[3 * stay.towerNode + k];
        positions[6 * i + k] = top;
        positions[6 * i + 3 + k] = failed ? top + ends[3 + k] - ends[k] : drawn[3 * stay.deckNode + k];
      }
    });
    this.ropeGrid.frameVersion = (this.ropeGrid.frameVersion + 1) >>> 0;
    return true;
  }
  /** Release the model's solvers. The world is the backend's and is cleared by it. */
  dispose(): void { try { this.model.dispose(); } catch { /* the world went first: nothing of the model is left in it */ } }
}
