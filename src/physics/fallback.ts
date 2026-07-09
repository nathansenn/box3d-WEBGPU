import { LcgRng, clamp, matrixColumnLength, writeModelMatrixFromEuler, type Vec3 } from '../math';
import type { ScenePreset } from '../scenes';
import { clampStress } from '../scenes';
import type { PhysicsBackend } from '../types';

type Body = {
  dynamic: boolean;
  pos: Vec3;
  vel: Vec3;
  rot: Vec3;
  angVel: Vec3;
  half: Vec3;
  color: [number, number, number, number];
  mass: number;
  invMass: number;
  friction: number;
  restitution: number;
  heat: number;
};

type BoxArgs = {
  dynamic: boolean;
  pos: Vec3;
  half: Vec3;
  color: [number, number, number, number];
  density: number;
  friction: number;
  restitution: number;
  vel?: Vec3;
  rot?: Vec3;
  angVel?: Vec3;
};

const MATRIX_FLOATS = 16;
const COLOR_FLOATS = 4;
const MATRIX_PTR_BYTES = 0;
const DEFAULT_MAX_BODIES = 4096;
const PALETTE = [0x30aebf, 0xdc3132, 0x8cc924, 0xffee8c, 0x7c3aed, 0xf97316, 0x06b6d4, 0x22c55e, 0xd8dee9, 0x214160] as const;

function rgb(hex: number): [number, number, number, number] {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
    1,
  ];
}

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-7 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

function quantizedHash(values: Float32Array, countFloats: number): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < countFloats; i++) {
    const q = Math.trunc(values[i] * 1000) | 0;
    hash ^= q & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 8) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 16) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 24) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export class FallbackPhysicsBackend implements PhysicsBackend {
  readonly name = 'JS fallback physics';
  readonly isWasm = false;
  readonly maxBodies: number;
  readonly HEAPF32: Float32Array;

  private bodies: Body[] = [];
  private rng = new LcgRng(0xc0ffee);
  private hashValue = 0;
  private readonly colorPtrBytes: number;

  constructor(maxBodies = DEFAULT_MAX_BODIES) {
    this.maxBodies = maxBodies;
    this.colorPtrBytes = maxBodies * MATRIX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    this.HEAPF32 = new Float32Array(maxBodies * (MATRIX_FLOATS + COLOR_FLOATS));
  }

  _b3w_matrices_ptr(): number { return MATRIX_PTR_BYTES; }
  _b3w_colors_ptr(): number { return this.colorPtrBytes; }
  _b3w_body_count(): number { return this.bodyCount(); }
  _b3w_max_bodies(): number { return this.maxBodies; }

  bodyCount(): number { return this.bodies.length; }
  dynamicCount(): number { return this.bodies.reduce((sum, body) => sum + (body.dynamic ? 1 : 0), 0); }
  replayHash(): number { return this.hashValue; }

  destroy(): void {
    this.bodies.length = 0;
    this.HEAPF32.fill(0);
    this.hashValue = 0;
  }

  createScene(scene: ScenePreset, stressScale: number, seed: number): number {
    const stress = clampStress(stressScale);
    const variant = scene.variant ?? scene.id % 10;
    this.destroy();
    this.rng = new LcgRng(seed >>> 0);
    this.addWorldBounds();

    switch (scene.family) {
      case 'stack': this.createStackLab(stress, variant); break;
      case 'domino': this.createDominoLab(stress, variant); break;
      case 'skyscraper': this.createSkyscraperLab(stress, variant); break;
      case 'bridge': this.createBridgeLab(stress, variant); break;
      case 'material': this.createMaterialLab(stress, variant); break;
      case 'rain': this.createRainLab(stress, variant); break;
      case 'demolition': this.createDemolitionLab(stress, variant); break;
      case 'vehicle': this.createVehicleLab(stress, variant); break;
      case 'marble': this.createMarbleLab(stress, variant); break;
      case 'construction': this.createConstructionLab(stress, variant); break;
      case 'warehouse': this.createWarehouseLab(stress, variant); break;
      case 'architecture': this.createArchitectureLab(stress, variant); break;
      default: this.createStackLab(stress, variant); break;
    }

    this.syncTransforms();
    return this.bodyCount();
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const steps = clamp(Math.round(subSteps), 1, 16);
    const subDt = Math.min(dt, 1 / 20) / steps;
    for (let i = 0; i < steps; i++) {
      this.integrate(subDt);
      this.solveBounds();
      this.solveBodyPairs();
    }
    this.syncTransforms();
  }

  syncTransforms(): void {
    const colorOffset = this.colorPtrBytes / Float32Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      writeModelMatrixFromEuler(this.HEAPF32, i * MATRIX_FLOATS, body.pos, body.rot, body.half);
      const heat = clamp(body.heat, 0, 1);
      const c = body.color;
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 0] = clamp(c[0] + heat * 0.45, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 1] = clamp(c[1] + heat * 0.18, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 2] = clamp(c[2] + heat * 0.04, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 3] = c[3];
      body.heat *= 0.88;
    }
    this.hashValue = quantizedHash(this.HEAPF32, Math.min(this.bodies.length, 512) * MATRIX_FLOATS);
  }

  kick(strength: number): void {
    const s = strength > 0 ? strength : 8;
    for (const body of this.bodies) {
      if (!body.dynamic) continue;
      const side = body.pos[0] >= 0 ? 1 : -1;
      body.vel[0] += side * this.rng.range(0.2, 1.0) * s;
      body.vel[1] += this.rng.range(0.3, 1.2) * s;
      body.vel[2] += this.rng.signed(0.35) * s;
      body.angVel[0] += this.rng.signed(2.4);
      body.angVel[2] += this.rng.signed(2.4);
    }
  }

  explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void {
    const center: Vec3 = [centerX, centerY, centerZ];
    const r = Math.max(1, radius);
    for (const body of this.bodies) {
      if (!body.dynamic) continue;
      const delta = sub(body.pos, center);
      const d = len(delta);
      if (d > r) continue;
      const falloff = 1 - d / r;
      const n = normalize(delta);
      body.vel[0] += n[0] * strength * falloff;
      body.vel[1] += (n[1] + 0.55) * strength * falloff;
      body.vel[2] += n[2] * strength * falloff;
      body.angVel[0] += this.rng.signed(6) * falloff;
      body.angVel[1] += this.rng.signed(4) * falloff;
      body.angVel[2] += this.rng.signed(6) * falloff;
      body.heat = Math.max(body.heat, falloff);
    }
  }

  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number {
    const index = this.addBox({
      dynamic: true,
      pos: [x, y, z],
      vel: [vx, vy, vz],
      rot: [0.1, 0.2, 0.05],
      angVel: [this.rng.signed(3), this.rng.signed(3), this.rng.signed(3)],
      half: [size, size, size],
      color: rgb(0xffd166),
      density: 8,
      friction: 0.45,
      restitution: 0.12,
    });
    this.syncTransforms();
    return index;
  }

  spawnRain(count: number, spread: number, height: number): number {
    let added = 0;
    for (let i = 0; i < count; i++) {
      if (this.bodies.length >= this.maxBodies) break;
      const size = this.rng.range(0.18, 0.58);
      this.addBox({
        dynamic: true,
        pos: [this.rng.signed(spread), height + this.rng.range(0, 20), this.rng.signed(spread)],
        vel: [this.rng.signed(1.2), this.rng.range(-2, 1), this.rng.signed(1.2)],
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angVel: [this.rng.signed(5), this.rng.signed(5), this.rng.signed(5)],
        half: [size, size, size],
        color: rgb(PALETTE[i % PALETTE.length]),
        density: 1,
        friction: 0.62,
        restitution: 0.05,
      });
      added++;
    }
    this.syncTransforms();
    return added;
  }

  private addBox(args: BoxArgs): number {
    if (this.bodies.length >= this.maxBodies) return -1;
    const volume = Math.max(0.001, args.half[0] * 2 * args.half[1] * 2 * args.half[2] * 2);
    const mass = args.dynamic ? Math.max(0.001, volume * args.density) : Number.POSITIVE_INFINITY;
    const body: Body = {
      dynamic: args.dynamic,
      pos: [...args.pos] as Vec3,
      vel: args.vel ? [...args.vel] as Vec3 : [0, 0, 0],
      rot: args.rot ? [...args.rot] as Vec3 : [0, 0, 0],
      angVel: args.angVel ? [...args.angVel] as Vec3 : [0, 0, 0],
      half: [...args.half] as Vec3,
      color: args.color,
      mass,
      invMass: args.dynamic ? 1 / mass : 0,
      friction: args.friction,
      restitution: args.restitution,
      heat: 0,
    };
    this.bodies.push(body);
    return this.bodies.length - 1;
  }

  private addWorldBounds(): void {
    this.addBox({ dynamic: false, pos: [0, -1, 0], half: [44, 1, 44], color: rgb(0x162033), density: 0, friction: 0.86, restitution: 0.02 });
    this.addBox({ dynamic: false, pos: [-44.5, 12, 0], half: [0.5, 12, 44], color: rgb(0x0f172a), density: 0, friction: 0.7, restitution: 0.05 });
    this.addBox({ dynamic: false, pos: [44.5, 12, 0], half: [0.5, 12, 44], color: rgb(0x0f172a), density: 0, friction: 0.7, restitution: 0.05 });
    this.addBox({ dynamic: false, pos: [0, 12, -44.5], half: [44, 12, 0.5], color: rgb(0x0f172a), density: 0, friction: 0.7, restitution: 0.05 });
    this.addBox({ dynamic: false, pos: [0, 12, 44.5], half: [44, 12, 0.5], color: rgb(0x0f172a), density: 0, friction: 0.7, restitution: 0.05 });
  }

  private createStackLab(stress: number, variant: number): void {
    const columns = 6 + stress * 3 + (variant % 4);
    const rows = 7 + stress * 4 + Math.floor(variant / 2);
    const layers = 1 + Math.floor(stress * 0.7) + (variant % 3 === 0 ? 1 : 0);
    const h: Vec3 = variant % 5 === 2 ? [0.34, 0.56, 0.34] : variant % 5 === 4 ? [0.72, 0.26, 0.42] : [0.46, 0.46, 0.46];
    const sx = h[0] * 2 + 0.06;
    const sy = h[1] * 2 + 0.055;
    const sz = h[2] * 2 + 0.06;
    const startX = -0.5 * (columns - 1) * sx;
    const startZ = -0.5 * (layers - 1) * sz;
    for (let layer = 0; layer < layers; layer++) {
      for (let y = 0; y < rows; y++) {
        const taper = variant === 3 ? Math.floor(y * 0.35) : 0;
        for (let x = taper; x < columns - taper; x++) {
          if (variant === 4 && x > columns * 0.66 && y > rows * 0.55) continue;
          this.addBox({
            dynamic: true,
            pos: [startX + x * sx + (y % 2 ? sx * 0.12 : 0) + this.rng.signed(0.012), h[1] + y * sy, startZ + layer * sz + this.rng.signed(0.015)],
            half: h,
            rot: [0, (variant % 2) * 0.08, 0],
            color: rgb(PALETTE[(x + y + layer + variant) % PALETTE.length]),
            density: 1 + (variant % 3) * 0.4,
            friction: 0.62 + (variant % 4) * 0.04,
            restitution: 0.02 + (variant % 3) * 0.02,
            angVel: [this.rng.signed(0.16), this.rng.signed(0.08), this.rng.signed(0.16)],
          });
        }
      }
    }
    if (variant === 8) this.explode(-7, 1.6, 0, 8, 5);
  }

  private createDominoLab(stress: number, variant: number): void {
    const count = 38 + stress * 24 + variant * 3;
    const radius = 6.5 + stress * 2 + variant * 0.22;
    const loops = variant === 2 ? 2 : variant === 8 ? 1.7 : 1;
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2 * loops;
      const wave = variant % 3 === 1 ? Math.sin(t * 3) * 1.8 : 0;
      const ring = variant === 5 ? -18 + i * (36 / count) : radius + wave;
      const x = variant === 5 ? ring : Math.cos(t) * ring;
      const z = variant === 5 ? Math.sin(i * 0.35) * 2.8 : Math.sin(t) * ring;
      const yaw = variant === 5 ? Math.PI / 2 : -t + (variant % 2 ? 0.35 : 0);
      this.addBox({
        dynamic: true,
        pos: [x, 1.22, z],
        half: [0.07, 1.22, 0.4],
        rot: [0, yaw, i < 4 ? 0.14 : 0],
        color: rgb(PALETTE[(i + variant) % 6]),
        density: 0.8,
        friction: 0.74,
        restitution: 0.02,
      });
    }
    this.explode(variant === 5 ? -18 : radius, 1.2, 0, 6.5 + stress, 4.2);
  }

  private createSkyscraperLab(stress: number, variant: number): void {
    const levels = 7 + stress * 3 + variant;
    const grid = 3 + Math.floor((stress + variant % 3) / 2);
    const spacing = 1.5 + (variant % 3) * 0.18;
    const halfSpan = ((grid - 1) * spacing) / 2;
    const towers = variant === 2 || variant === 7 ? 2 : 1;
    for (let tower = 0; tower < towers; tower++) {
      const ox = towers === 2 ? (tower === 0 ? -4.8 : 4.8) : 0;
      for (let y = 0; y < levels; y++) {
        const setback = variant === 4 ? Math.floor(y / 5) * 0.25 : 0;
        const levelY = 0.35 + y * 1.03;
        this.addBox({ dynamic: true, pos: [ox, levelY, 0], half: [halfSpan + 0.8 - setback, 0.08, halfSpan + 0.8 - setback], color: rgb(y % 2 ? 0x214160 : 0x263b59), density: 1.2, friction: 0.62, restitution: 0.02 });
        for (let x = 0; x < grid; x++) {
          for (let z = 0; z < grid; z++) {
            if (x !== 0 && x !== grid - 1 && z !== 0 && z !== grid - 1 && !(variant === 1 && x === Math.floor(grid / 2) && z === Math.floor(grid / 2))) continue;
            this.addBox({
              dynamic: true,
              pos: [ox - halfSpan + x * spacing, levelY + 0.5, -halfSpan + z * spacing],
              half: [0.13, 0.5, 0.13],
              color: rgb(variant === 6 ? 0x30aebf : 0xd8dee9),
              density: 2.4,
              friction: 0.66,
              restitution: 0.02,
            });
          }
        }
        if ((variant === 3 || variant === 6) && y % 2 === 0) {
          this.addBox({ dynamic: true, pos: [ox, levelY + 0.5, -halfSpan - 0.15], half: [halfSpan + 0.55, 0.07, 0.08], rot: [0, 0, 0.25], color: rgb(0xffee8c), density: 1.5, friction: 0.64, restitution: 0.02 });
          this.addBox({ dynamic: true, pos: [ox, levelY + 0.5, halfSpan + 0.15], half: [halfSpan + 0.55, 0.07, 0.08], rot: [0, 0, -0.25], color: rgb(0xffee8c), density: 1.5, friction: 0.64, restitution: 0.02 });
        }
      }
    }
    if (variant === 7) this.addBox({ dynamic: true, pos: [0, 9, 0], half: [4.8, 0.18, 0.52], color: rgb(0x06b6d4), density: 1, friction: 0.6, restitution: 0.02 });
    this.launchProjectile(-24, 5.2 + stress, variant % 2 ? -3 : 0, 24 + stress * 3, 2, variant % 2 ? 4 : 0, 0.78);
  }

  private createBridgeLab(stress: number, variant: number): void {
    const span = 18 + variant * 0.8;
    const segments = 10 + stress * 4 + variant;
    this.addBox({ dynamic: false, pos: [-span / 2 - 1, 1.1, 0], half: [1.2, 1.1, 3.2], color: rgb(0x394150), density: 0, friction: 0.8, restitution: 0.02 });
    this.addBox({ dynamic: false, pos: [span / 2 + 1, 1.1, 0], half: [1.2, 1.1, 3.2], color: rgb(0x394150), density: 0, friction: 0.8, restitution: 0.02 });
    const spacing = span / segments;
    for (let i = 0; i < segments; i++) {
      const x = -span / 2 + spacing * (i + 0.5);
      this.addBox({ dynamic: true, pos: [x, 2.45 + this.rng.signed(0.015), 0], half: [spacing * 0.52, 0.13, 1.55], color: rgb(i % 2 ? 0x30aebf : 0x0d8ea7), density: 1.5, friction: 0.78, restitution: 0.02 });
      if (variant === 2 || variant === 7 || variant === 9) {
        this.addBox({ dynamic: true, pos: [x, 3.15, -1.75], half: [0.06, 0.7, 0.06], rot: [0, 0, i % 2 ? 0.55 : -0.55], color: rgb(0xffee8c), density: 1, friction: 0.7, restitution: 0.02 });
        this.addBox({ dynamic: true, pos: [x, 3.15, 1.75], half: [0.06, 0.7, 0.06], rot: [0, 0, i % 2 ? -0.55 : 0.55], color: rgb(0xffee8c), density: 1, friction: 0.7, restitution: 0.02 });
      }
    }
    const loads = 10 + stress * 8 + variant * 2;
    for (let i = 0; i < loads; i++) {
      this.addBox({ dynamic: true, pos: [-span * 0.32 + (i % 12) * 0.75, 3.2 + Math.floor(i / 12) * 0.72, this.rng.signed(0.9)], half: [0.32, 0.32, 0.32], color: rgb(PALETTE[(i + variant) % PALETTE.length]), density: 3.5, friction: 0.65, restitution: 0.01 });
    }
  }

  private createMaterialLab(stress: number, variant: number): void {
    const lanes = 5 + (variant % 3);
    for (let lane = 0; lane < lanes; lane++) {
      const z = (lane - (lanes - 1) / 2) * 2.8;
      const restitution = clamp((lane + (variant % 4)) / (lanes + 2), 0.02, 0.92);
      const friction = clamp(0.08 + lane * 0.13 + (variant % 3) * 0.05, 0.05, 0.92);
      this.addBox({ dynamic: false, pos: [-10, 2.2, z], half: [5.0, 0.12, 0.95], rot: [0, 0, -0.20 - variant * 0.01], color: rgb(0x243247), density: 0, friction, restitution });
      this.addBox({ dynamic: false, pos: [2, 0.2, z], half: [8.5, 0.2, 0.08], color: rgb(0x334155), density: 0, friction, restitution });
      const count = 5 + stress * 3 + Math.floor(variant / 2);
      for (let i = 0; i < count; i++) {
        const size = variant === 4 ? 0.22 + (i % 5) * 0.08 : 0.3;
        this.addBox({ dynamic: true, pos: [-13 + i * 0.72, 5.0 + i * 0.08, z + this.rng.signed(0.18)], vel: [2 + lane * 0.8, 0, 0], half: [size, size, size], color: rgb(PALETTE[(lane + i) % PALETTE.length]), density: 0.8 + (variant % 5), friction, restitution });
      }
    }
  }

  private createRainLab(stress: number, variant: number): void {
    if (variant === 3 || variant === 4) {
      this.addWarehouseRacks(variant, stress);
    }
    const count = 160 + stress * 340 + variant * 35;
    const spread = variant === 9 ? 4.8 : 14 + stress * 2.4 + variant;
    const height = 10 + stress * 4 + variant * 1.2;
    this.spawnRain(count, spread, height);
  }

  private createDemolitionLab(stress: number, variant: number): void {
    const wallWidth = 8 + stress * 2 + variant;
    const wallHeight = 5 + stress * 2;
    const layers = 1 + (variant % 3);
    for (let layer = 0; layer < layers; layer++) {
      this.addBrickWall([0, 0.35, (layer - (layers - 1) / 2) * 1.05], wallWidth, wallHeight, 0.42, rgb(PALETTE[(variant + layer) % PALETTE.length]));
    }
    if (variant === 0 || variant === 8) {
      this.addTower(-7, 0, 5 + stress, 0x394150);
      this.addTower(7, 0, 5 + stress, 0x394150);
    }
    if (variant === 4) this.addTower(0, 4, 11 + stress, 0xffee8c);
    if (variant === 6) this.launchProjectile(-18, 4, 0, 14, 0, 0, 1.25);
    else if (variant === 7) this.explode(0, 2.5, 0, 18, 7);
    else this.launchProjectile(-22, 3 + stress, 0, 22 + stress * 2, 1.2, 0, 0.75);
  }

  private createVehicleLab(stress: number, variant: number): void {
    const lanes = 2 + (variant % 3);
    for (let lane = 0; lane < lanes; lane++) {
      const z = (lane - (lanes - 1) / 2) * 4;
      this.addBox({ dynamic: false, pos: [0, 0.08, z], half: [24, 0.08, 1.4], color: rgb(0x111827), density: 0, friction: 0.8, restitution: 0.03 });
      for (let i = 0; i < 4 + stress; i++) {
        this.addBox({ dynamic: true, pos: [-18 - i * 2.8, 0.55, z + this.rng.signed(0.08)], vel: [6 + stress + variant * 0.25, 0, 0], half: [0.95, 0.42, 0.62], color: rgb(PALETTE[(lane + i + variant) % PALETTE.length]), density: 5, friction: 0.72, restitution: 0.05 });
        if (variant === 1 || variant === 6 || variant === 9) {
          this.addBox({ dynamic: true, pos: [-18 - i * 2.8, 1.15, z], vel: [6 + stress, 0, 0], half: [0.52, 0.38, 0.48], color: rgb(0xffee8c), density: 1, friction: 0.7, restitution: 0.03 });
        }
      }
      for (let o = 0; o < 5 + stress; o++) {
        this.addBox({ dynamic: true, pos: [-3 + o * 1.4, 0.55, z + (o % 2 ? 0.75 : -0.75)], half: [0.35, 0.55, 0.35], color: rgb(0xd8dee9), density: 2, friction: 0.7, restitution: 0.05 });
      }
      if (variant === 7) this.addBox({ dynamic: true, pos: [-8, 0.55, z], vel: [9, 0, 0], half: [2.2, 0.28, 0.25], color: rgb(0xf97316), density: 7, friction: 0.75, restitution: 0.02 });
    }
  }

  private createMarbleLab(stress: number, variant: number): void {
    const ramps = 4 + (variant % 4);
    for (let r = 0; r < ramps; r++) {
      const z = (r - (ramps - 1) / 2) * 2.7;
      this.addBox({ dynamic: false, pos: [-12 + r * 3.8, 4.8 - r * 0.55, z], half: [3.2, 0.10, 0.75], rot: [0, 0, (r % 2 ? 0.16 : -0.16)], color: rgb(0x243247), density: 0, friction: 0.24, restitution: 0.25 });
      for (let p = 0; p < 6 + stress; p++) {
        this.addBox({ dynamic: false, pos: [-9 + r * 3.8 + p * 0.8, 0.8, z + (p % 2 ? 0.35 : -0.35)], half: [0.12, 0.65, 0.12], color: rgb(0x64748b), density: 0, friction: 0.6, restitution: 0.4 });
      }
    }
    const count = 24 + stress * 18 + variant * 3;
    for (let i = 0; i < count; i++) {
      const size = 0.18 + (i % 4) * 0.025;
      this.addBox({ dynamic: true, pos: [-15 + this.rng.signed(1.5), 8 + this.rng.range(0, 4), this.rng.signed(6)], vel: [2.5 + this.rng.range(0, 2), -0.5, this.rng.signed(0.8)], half: [size, size, size], color: rgb(PALETTE[(i + variant) % PALETTE.length]), density: 1, friction: 0.18, restitution: 0.35 + (variant % 4) * 0.08, angVel: [this.rng.signed(6), this.rng.signed(6), this.rng.signed(6)] });
    }
  }

  private createConstructionLab(stress: number, variant: number): void {
    if (variant === 0) {
      for (let i = 0; i < 6 + stress; i++) this.addBox({ dynamic: true, pos: [this.rng.signed(8), 8 + i * 0.8, this.rng.signed(4)], half: [1.8, 0.15, 0.18], color: rgb(0xf97316), density: 1.3, friction: 0.7, restitution: 0.02, angVel: [this.rng.signed(2), this.rng.signed(2), this.rng.signed(2)] });
    }
    if (variant === 5 || variant === 6 || variant === 7) {
      const modules = 5 + stress * 2;
      for (let i = 0; i < modules; i++) this.addBox({ dynamic: true, pos: [-8 + (i % 5) * 4, 0.9 + Math.floor(i / 5) * 2.0, variant === 7 ? (i % 2) * 3 : this.rng.signed(2)], half: [1.85, 0.85, 1.1], color: rgb(PALETTE[(i + variant) % PALETTE.length]), density: 2, friction: 0.72, restitution: 0.02 });
    }
    const floors = 3 + stress + Math.floor(variant / 3);
    const bays = 4 + (variant % 4);
    for (let y = 0; y < floors; y++) {
      for (let x = 0; x < bays; x++) {
        const px = -bays * 1.2 + x * 2.4;
        this.addBox({ dynamic: true, pos: [px, 0.65 + y * 1.35, -3], half: [0.12, 0.65, 0.12], color: rgb(0xd8dee9), density: 1.4, friction: 0.7, restitution: 0.02 });
        this.addBox({ dynamic: true, pos: [px, 0.65 + y * 1.35, 3], half: [0.12, 0.65, 0.12], color: rgb(0xd8dee9), density: 1.4, friction: 0.7, restitution: 0.02 });
      }
      this.addBox({ dynamic: true, pos: [0, 1.3 + y * 1.35, 0], half: [bays * 1.25, 0.1, 3.2], color: rgb(y % 2 ? 0x214160 : 0x0d8ea7), density: 1.1, friction: 0.68, restitution: 0.02 });
    }
    if (variant === 2 || variant === 8) this.spawnRain(40 + stress * 30, 8, 12);
  }

  private createWarehouseLab(stress: number, variant: number): void {
    this.addWarehouseRacks(variant, stress);
    const parcels = 40 + stress * 35 + variant * 5;
    for (let i = 0; i < parcels; i++) {
      const lane = i % 4;
      const z = (lane - 1.5) * 3.5;
      this.addBox({ dynamic: true, pos: [-18 + (i % 10) * 1.2, 1 + Math.floor(i / 10) * 0.65, z + this.rng.signed(0.3)], vel: [1.4 + lane * 0.6, 0, this.rng.signed(0.2)], half: [0.38, 0.28, 0.42], color: rgb(PALETTE[(i + variant) % PALETTE.length]), density: 1.2, friction: 0.55, restitution: 0.04 });
    }
    if (variant === 1 || variant === 6 || variant === 9) this.explode(0, 2.8, 0, 8 + stress, 9);
  }

  private createArchitectureLab(stress: number, variant: number): void {
    const columns = 8 + stress * 2 + (variant % 3) * 2;
    const radius = 7 + variant * 0.4;
    if (variant === 2 || variant === 5) {
      for (let row = 0; row < 5 + stress; row++) {
        for (let i = 0; i < columns; i++) {
          this.addBox({ dynamic: true, pos: [-12 + i * 1.6, 0.35 + row * 0.7, -7 + row * 1.5], half: [0.72, 0.28, 0.62], color: rgb(PALETTE[(i + row + variant) % PALETTE.length]), density: 1.5, friction: 0.72, restitution: 0.03 });
        }
      }
    } else {
      for (let i = 0; i < columns; i++) {
        const t = (i / columns) * Math.PI * 2;
        const x = Math.cos(t) * radius;
        const z = Math.sin(t) * radius;
        this.addTower(x, z, 4 + stress + (variant % 4), variant % 2 ? 0xd8dee9 : 0x30aebf, 0.28);
      }
      const roofLevels = 2 + stress;
      for (let y = 0; y < roofLevels; y++) {
        const size = radius - y * 0.85;
        this.addBox({ dynamic: true, pos: [0, 5.2 + y * 0.45 + stress * 0.55, 0], half: [size, 0.14, size], color: rgb(y % 2 ? 0x214160 : 0xffee8c), density: 1.8, friction: 0.72, restitution: 0.02 });
      }
    }
    if (variant === 7) this.spawnRain(30 + stress * 18, 6, 13);
    if (variant === 9) this.launchProjectile(-24, 6, 0, 23, 1, 0, 1.1);
  }

  private addBrickWall(origin: Vec3, width: number, height: number, block: number, color: [number, number, number, number]): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.addBox({ dynamic: true, pos: [origin[0] + (x - width / 2) * block * 2.05 + (y % 2) * block, origin[1] + y * block * 2.05, origin[2]], half: [block, block, block * 0.55], color, density: 1.7, friction: 0.72, restitution: 0.02 });
      }
    }
  }

  private addTower(x: number, z: number, blocks: number, colorHex: number, radius = 0.36): void {
    for (let y = 0; y < blocks; y++) {
      this.addBox({ dynamic: true, pos: [x, radius + y * radius * 2.05, z], half: [radius, radius, radius], color: rgb(y % 2 ? colorHex : 0x64748b), density: 2.2, friction: 0.72, restitution: 0.02 });
    }
  }

  private addWarehouseRacks(variant: number, stress: number): void {
    const aisles = 3 + (variant % 3);
    const levels = 3 + stress;
    for (let aisle = 0; aisle < aisles; aisle++) {
      const z = (aisle - (aisles - 1) / 2) * 4.5;
      for (let x = -14; x <= 14; x += 4) {
        this.addBox({ dynamic: true, pos: [x, 0.85, z - 1.2], half: [0.12, 0.85, 0.12], color: rgb(0x64748b), density: 1.8, friction: 0.7, restitution: 0.02 });
        this.addBox({ dynamic: true, pos: [x, 0.85, z + 1.2], half: [0.12, 0.85, 0.12], color: rgb(0x64748b), density: 1.8, friction: 0.7, restitution: 0.02 });
        for (let y = 0; y < levels; y++) {
          this.addBox({ dynamic: true, pos: [x, 0.75 + y * 1.45, z], half: [1.35, 0.12, 1.25], color: rgb(0x334155), density: 1.1, friction: 0.68, restitution: 0.02 });
          if ((x + y + aisle) % 2 === 0) this.addBox({ dynamic: true, pos: [x, 1.1 + y * 1.45, z], half: [0.56, 0.34, 0.52], color: rgb(PALETTE[(x + y + aisle + variant + 40) % PALETTE.length]), density: 1.4, friction: 0.7, restitution: 0.02 });
        }
      }
    }
  }

  private integrate(dt: number): void {
    for (const body of this.bodies) {
      if (!body.dynamic) continue;
      body.vel[1] -= 9.82 * dt;
      body.vel[0] *= 0.999;
      body.vel[2] *= 0.999;
      body.pos[0] += body.vel[0] * dt;
      body.pos[1] += body.vel[1] * dt;
      body.pos[2] += body.vel[2] * dt;
      body.rot[0] += body.angVel[0] * dt;
      body.rot[1] += body.angVel[1] * dt;
      body.rot[2] += body.angVel[2] * dt;
      body.angVel[0] *= 0.998;
      body.angVel[1] *= 0.998;
      body.angVel[2] *= 0.998;
    }
  }

  private solveBounds(): void {
    for (const body of this.bodies) {
      if (!body.dynamic) continue;
      if (body.pos[1] - body.half[1] < 0) {
        body.pos[1] = body.half[1];
        if (body.vel[1] < 0) body.vel[1] = -body.vel[1] * body.restitution;
        body.vel[0] *= 1 - clamp(body.friction, 0, 0.95) * 0.04;
        body.vel[2] *= 1 - clamp(body.friction, 0, 0.95) * 0.04;
        body.angVel[0] *= 0.96;
        body.angVel[2] *= 0.96;
        body.heat = Math.max(body.heat, 0.45);
      }
      for (const axis of [0, 2] as const) {
        const min = -43 + body.half[axis];
        const max = 43 - body.half[axis];
        if (body.pos[axis] < min) {
          body.pos[axis] = min;
          body.vel[axis] = Math.abs(body.vel[axis]) * body.restitution;
          body.heat = 0.7;
        } else if (body.pos[axis] > max) {
          body.pos[axis] = max;
          body.vel[axis] = -Math.abs(body.vel[axis]) * body.restitution;
          body.heat = 0.7;
        }
      }
    }
  }

  private solveBodyPairs(): void {
    const n = this.bodies.length;
    // The fallback exists so every browser can preview the renderer without WASM.
    // For giant demo scenes, cap pair checks and let real Box3D/WASM handle full fidelity.
    const pairLimit = n > 900 ? 420 : n > 650 ? 560 : n;
    for (let i = 0; i < pairLimit; i++) {
      const a = this.bodies[i];
      for (let j = i + 1; j < pairLimit; j++) {
        const b = this.bodies[j];
        if (!a.dynamic && !b.dynamic) continue;
        this.resolveAabbPair(a, b);
      }
    }
  }

  private resolveAabbPair(a: Body, b: Body): void {
    const dx = b.pos[0] - a.pos[0];
    const px = a.half[0] + b.half[0] - Math.abs(dx);
    if (px <= 0) return;
    const dy = b.pos[1] - a.pos[1];
    const py = a.half[1] + b.half[1] - Math.abs(dy);
    if (py <= 0) return;
    const dz = b.pos[2] - a.pos[2];
    const pz = a.half[2] + b.half[2] - Math.abs(dz);
    if (pz <= 0) return;

    let normal: Vec3 = [Math.sign(dx) || 1, 0, 0];
    let penetration = px;
    if (py < penetration) { penetration = py; normal = [0, Math.sign(dy) || 1, 0]; }
    if (pz < penetration) { penetration = pz; normal = [0, 0, Math.sign(dz) || 1]; }

    const invMassSum = a.invMass + b.invMass;
    if (invMassSum <= 0) return;

    const correction = (penetration + 0.002) / invMassSum;
    if (a.dynamic) a.pos = sub(a.pos, scale(normal, correction * a.invMass));
    if (b.dynamic) b.pos = add(b.pos, scale(normal, correction * b.invMass));

    const relVel = sub(b.vel, a.vel);
    const vn = dot(relVel, normal);
    if (vn < 0) {
      const e = Math.min(a.restitution, b.restitution);
      const impulseMag = (-(1 + e) * vn) / invMassSum;
      const impulse = scale(normal, impulseMag);
      if (a.dynamic) a.vel = sub(a.vel, scale(impulse, a.invMass));
      if (b.dynamic) b.vel = add(b.vel, scale(impulse, b.invMass));
    }

    const friction = clamp((a.friction + b.friction) * 0.5, 0, 0.95);
    if (a.dynamic) {
      a.vel[0] *= 1 - friction * 0.01;
      a.vel[2] *= 1 - friction * 0.01;
      a.angVel[0] += this.rng.signed(0.02) * penetration;
      a.angVel[2] += this.rng.signed(0.02) * penetration;
      a.heat = Math.max(a.heat, clamp(penetration * 1.5, 0.1, 1));
    }
    if (b.dynamic) {
      b.vel[0] *= 1 - friction * 0.01;
      b.vel[2] *= 1 - friction * 0.01;
      b.angVel[0] += this.rng.signed(0.02) * penetration;
      b.angVel[2] += this.rng.signed(0.02) * penetration;
      b.heat = Math.max(b.heat, clamp(penetration * 1.5, 0.1, 1));
    }
  }

  getMatrixScale(index: number): Vec3 {
    const offset = index * MATRIX_FLOATS;
    return [
      matrixColumnLength(this.HEAPF32, offset, 0),
      matrixColumnLength(this.HEAPF32, offset, 1),
      matrixColumnLength(this.HEAPF32, offset, 2),
    ];
  }
}
