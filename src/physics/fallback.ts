import { LcgRng, clamp, matrixColumnLength, writeAxisAlignedModelMatrix, writeModelMatrixFromEuler, type Vec3 } from '../math';
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
  return rgba(hex, 1);
}

function rgba(hex: number, materialTag: number): [number, number, number, number] {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
    materialTag,
  ];
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
  private hashDirty = false;
  private readonly colorPtrBytes: number;
  private readonly broadphaseOrder: Int32Array;
  private readonly broadphaseBounds: Float64Array;
  private broadphaseCount = 0;
  private broadphaseAxisIndex: 0 | 1 | 2 = 0;
  private broadphaseCandidateCountValue = 0;
  private dynamicBodyCount = 0;
  private transformFrameVersion = 0;
  private colorFrameVersion = 0;

  constructor(maxBodies = DEFAULT_MAX_BODIES) {
    this.maxBodies = maxBodies;
    this.colorPtrBytes = maxBodies * MATRIX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
    this.HEAPF32 = new Float32Array(maxBodies * (MATRIX_FLOATS + COLOR_FLOATS));
    this.broadphaseOrder = new Int32Array(maxBodies);
    this.broadphaseBounds = new Float64Array(maxBodies * 6);
  }

  _b3w_matrices_ptr(): number { return MATRIX_PTR_BYTES; }
  _b3w_colors_ptr(): number { return this.colorPtrBytes; }
  _b3w_body_count(): number { return this.bodyCount(); }
  _b3w_max_bodies(): number { return this.maxBodies; }
  frameVersion(): number { return this.transformFrameVersion; }
  colorVersion(): number { return this.colorFrameVersion; }

  bodyCount(): number { return this.bodies.length; }
  dynamicCount(): number { return this.dynamicBodyCount; }
  replayHash(): number {
    if (this.hashDirty) {
      this.hashValue = quantizedHash(this.HEAPF32, Math.min(this.bodies.length, 512) * MATRIX_FLOATS);
      this.hashDirty = false;
    }
    return this.hashValue;
  }
  broadphaseAxis(): 0 | 1 | 2 { return this.broadphaseAxisIndex; }
  broadphaseCandidateCount(): number { return this.broadphaseCandidateCountValue; }

  destroy(): void {
    this.resetSceneState();
    // Public destruction keeps the historical observable zeroed-heap contract.
    // Scene replacement uses resetForScene() because every active slot is
    // overwritten by addBox() before the new body count is exposed.
    this.HEAPF32.fill(0);
  }

  private resetSceneState(): void {
    this.bodies.length = 0;
    this.dynamicBodyCount = 0;
    this.hashValue = 0;
    this.hashDirty = false;
    this.broadphaseCount = 0;
    this.broadphaseCandidateCountValue = 0;
  }

  private resetForScene(): void {
    this.resetSceneState();
  }

  createScene(scene: ScenePreset, stressScale: number, seed: number): number {
    const stress = clampStress(stressScale);
    const variant = scene.variant ?? scene.id % 10;
    this.resetForScene();
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
      case 'cloth': this.createClothStage(stress, variant); break;
      case 'rope': this.createRopeStage(stress, variant); break;
      case 'water': this.createWaterStage(stress, variant); break;
      case 'fracture': this.createFractureStage(stress, variant); break;
      default: this.createStackLab(stress, variant); break;
    }

    // Impact and Cinematic modes add authored set dressing without changing the
    // deterministic family recipe. This gives the fallback path presentation
    // parity with the AAA WebGPU renderer while real Box3D/WASM owns full physics.
    if (scene.mode >= 3) this.addCinematicSetDressing(scene.family, stress, variant);

    this.syncTransforms();
    return this.bodyCount();
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Cloth and rope recipes use the rigid backend only for immutable stage
    // geometry. With no dynamic bodies there is no integration, collision,
    // heat decay, transform reconstruction, or stream revision to publish.
    if (this.dynamicBodyCount === 0) return;
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
      // Static bodies never change or accumulate collision heat. Their matrix
      // and material stream are written once in addBox(), so recurring frames
      // touch only bodies whose transform or heat can actually change.
      if (!body.dynamic) continue;
      writeModelMatrixFromEuler(this.HEAPF32, i * MATRIX_FLOATS, body.pos, body.rot, body.half);
      const heat = clamp(body.heat, 0, 1);
      const c = body.color;
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 0] = clamp(c[0] + heat * 0.45, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 1] = clamp(c[1] + heat * 0.18, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 2] = clamp(c[2] + heat * 0.04, 0, 1);
      this.HEAPF32[colorOffset + i * COLOR_FLOATS + 3] = c[3];
      body.heat *= 0.88;
    }
    this.hashDirty = true;
    this.transformFrameVersion = (this.transformFrameVersion + 1) >>> 0;
    // Fallback colors include collision heat that decays during every sync, so
    // unlike native Box3D's immutable palette this stream genuinely changes.
    this.colorFrameVersion = (this.colorFrameVersion + 1) >>> 0;
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
    const r = Math.max(1, radius);
    const radiusSquared = r * r;
    for (const body of this.bodies) {
      if (!body.dynamic) continue;
      const dx = body.pos[0] - centerX;
      const dy = body.pos[1] - centerY;
      const dz = body.pos[2] - centerZ;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      // Use the squared test only as a broad rejection. Near the boundary we
      // retain Math.hypot and the original radius comparison so accepted
      // contacts remain bit-for-bit compatible with the v1.10 path.
      if (distanceSquared > radiusSquared * 1.000001) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d > r) continue;
      const falloff = 1 - d / r;
      const nx = d > 1e-7 ? dx / d : 0;
      const ny = d > 1e-7 ? dy / d : 1;
      const nz = d > 1e-7 ? dz / d : 0;
      body.vel[0] += nx * strength * falloff;
      body.vel[1] += (ny + 0.55) * strength * falloff;
      body.vel[2] += nz * strength * falloff;
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
    if (body.dynamic) this.dynamicBodyCount++;
    const index = this.bodies.length - 1;
    // Populate the authoritative stream immediately. Dynamic transforms are
    // refreshed by syncTransforms(); static transforms remain valid forever.
    if (Object.is(body.rot[0], 0) && Object.is(body.rot[1], 0) && Object.is(body.rot[2], 0)) {
      writeAxisAlignedModelMatrix(this.HEAPF32, index * MATRIX_FLOATS, body.pos, body.half[0], body.half[1], body.half[2]);
    } else {
      writeModelMatrixFromEuler(this.HEAPF32, index * MATRIX_FLOATS, body.pos, body.rot, body.half);
    }
    const colorOffset = this.colorPtrBytes / Float32Array.BYTES_PER_ELEMENT + index * COLOR_FLOATS;
    this.HEAPF32[colorOffset + 0] = clamp(body.color[0], 0, 1);
    this.HEAPF32[colorOffset + 1] = clamp(body.color[1], 0, 1);
    this.HEAPF32[colorOffset + 2] = clamp(body.color[2], 0, 1);
    this.HEAPF32[colorOffset + 3] = body.color[3];
    return index;
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


  private createClothStage(stress: number, variant: number): void {
    const width = 11 + (variant % 3) * 1.4;
    const top = 10.5 + stress * 0.8 + (variant === 2 ? 4.5 : 0);
    const postColor = variant % 2 ? 0x334155 : 0x475569;
    // Flag and sail layouts pin their left edge at -0.94 × cloth width. Keep
    // the presentation post just outside that edge so the fabric meets the
    // support instead of being initialized through its solid volume.
    const clothWidth = 14 + variant * 0.16;
    const leftPost = variant === 0 || variant === 5 ? -clothWidth * 0.94 - 0.35 : -width;
    this.addBox({ dynamic: false, pos: [leftPost, top * 0.5, 0], half: [0.22, top * 0.5, 0.22], color: rgb(postColor), density: 0, friction: 0.82, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [width, top * 0.5, 0], half: [0.22, top * 0.5, 0.22], color: rgb(postColor), density: 0, friction: 0.82, restitution: 0.01 });
    this.addBeamBetween([leftPost, top, 0], [width, top, 0], 0.20, variant % 2 ? 0xffd166 : 0x30aebf, false, 2.5);
    this.addBox({ dynamic: false, pos: [0, 0.12, 0], half: [width + 2.5, 0.12, 7.0], color: rgb(0x132033), density: 0, friction: 0.88, restitution: 0.01 });
    if (variant === 3 || variant === 7) {
      const radius = variant === 7 ? 3.1 : 1.7;
      this.addBox({ dynamic: false, pos: [0, 4.4, 0], half: [radius, radius, radius], color: rgba(0x15243b, 1.2), density: 0, friction: 0.45, restitution: 0.05 });
    }
    if (variant === 2) {
      this.addBox({ dynamic: false, pos: [0, top + 2.1, 0], half: [1.6, 0.42, 1.6], color: rgba(0xffd166, 2.1), density: 0, friction: 0.7, restitution: 0.02 });
    }
    for (let i = -3; i <= 3; i++) {
      this.addBox({ dynamic: false, pos: [i * 3.2, 0.28, -6.2], half: [1.15, 0.28, 0.35], color: rgb(i % 2 ? 0x25354d : 0x1b2a41), density: 0, friction: 0.82, restitution: 0.01 });
    }
  }

  private createRopeStage(stress: number, variant: number): void {
    const towerHeight = 12.5 + stress * 0.75;
    const span = variant === 1 || variant === 6 || variant === 9 ? 16 : 9;
    const towerColor = variant % 2 ? 0xf97316 : 0x30aebf;
    for (const side of [-1, 1]) {
      this.addBox({ dynamic: false, pos: [side * span, towerHeight * 0.5, -2.2], half: [0.28, towerHeight * 0.5, 0.28], color: rgb(towerColor), density: 0, friction: 0.85, restitution: 0.01 });
      this.addBox({ dynamic: false, pos: [side * span, towerHeight * 0.5, 2.2], half: [0.28, towerHeight * 0.5, 0.28], color: rgb(towerColor), density: 0, friction: 0.85, restitution: 0.01 });
      this.addBeamBetween([side * span, towerHeight, -2.2], [side * span, towerHeight, 2.2], 0.24, towerColor, false, 1.6);
    }
    this.addBox({ dynamic: false, pos: [0, 0.16, 0], half: [span + 3, 0.16, 7.5], color: rgb(0x111d30), density: 0, friction: 0.88, restitution: 0.01 });
    if (variant === 1 || variant === 6) {
      const segments = 11;
      for (let i = 0; i < segments; i++) {
        const x = -span + (i + 0.5) * (span * 2 / segments);
        this.addBox({ dynamic: false, pos: [x, 3.4, 0], half: [span / segments * 0.52, 0.14, 1.7], color: rgb(i % 2 ? 0x243a55 : 0x2f4d69), density: 0, friction: 0.82, restitution: 0.01 });
      }
    } else if (variant === 0 || variant === 2 || variant === 8) {
      this.addBeamBetween([-span, towerHeight - 0.3, 0], [span, towerHeight - 0.3, 0], 0.17, 0x64748b, false, 1.4);
      this.addBox({ dynamic: false, pos: [0, 2.0, 0], half: [3.5, 0.18, 3.0], color: rgb(0x18263b), density: 0, friction: 0.85, restitution: 0.01 });
    }
    for (let i = -4; i <= 4; i++) {
      this.addBox({ dynamic: false, pos: [i * 3.1, 0.10, -6.0], half: [1.05, 0.10, 0.07], color: rgba(i % 2 ? 0xffd166 : 0x50d8ff, 2.0), density: 0, friction: 0.85, restitution: 0.01 });
    }
  }

  private createWaterStage(stress: number, variant: number): void {
    const halfWidth = 16 + (variant % 3) * 1.5;
    const halfDepth = 10 + (variant % 2) * 1.5;
    const wallHeight = variant === 1 || variant === 5 ? 4.2 : 2.4;
    this.addBox({ dynamic: false, pos: [0, -0.15, 0], half: [halfWidth, 0.15, halfDepth], color: rgb(0x0b1f33), density: 0, friction: 0.92, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [-halfWidth - 0.25, wallHeight * 0.5, 0], half: [0.25, wallHeight * 0.5, halfDepth + 0.5], color: rgb(0x20344c), density: 0, friction: 0.8, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [halfWidth + 0.25, wallHeight * 0.5, 0], half: [0.25, wallHeight * 0.5, halfDepth + 0.5], color: rgb(0x20344c), density: 0, friction: 0.8, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [0, wallHeight * 0.5, -halfDepth - 0.25], half: [halfWidth + 0.5, wallHeight * 0.5, 0.25], color: rgb(0x20344c), density: 0, friction: 0.8, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [0, wallHeight * 0.5, halfDepth + 0.25], half: [halfWidth + 0.5, wallHeight * 0.5, 0.25], color: rgb(0x20344c), density: 0, friction: 0.8, restitution: 0.01 });
    if (variant === 1 || variant === 5) {
      this.addBox({ dynamic: false, pos: [-halfWidth + 2.1, 2.3, 0], half: [0.5, 2.3, halfDepth * 0.82], color: rgb(0x314861), density: 0, friction: 0.8, restitution: 0.01 });
    }
    if (variant === 4 || variant === 8) {
      for (let i = -3; i <= 3; i++) {
        this.addBox({ dynamic: false, pos: [i * 3.2, 1.15, -halfDepth + 2.1], half: [0.18, 1.15, 0.18], color: rgb(0x64748b), density: 0, friction: 0.8, restitution: 0.01 });
      }
    }
    // A few Box3D props become visible impact/buoyancy proxies while the water
    // surface itself is owned by the deterministic shallow-water solver.
    for (let i = 0; i < 2 + stress; i++) {
      const size = 0.45 + (i % 3) * 0.16;
      this.addBox({ dynamic: true, pos: [-5 + i * 2.4, 2.4 + i * 0.3, this.rng.signed(3.5)], half: [size * 1.4, size * 0.55, size], color: rgb(PALETTE[(variant + i + 2) % PALETTE.length]), density: 0.45, friction: 0.4, restitution: 0.08 });
    }
  }

  private createFractureStage(stress: number, variant: number): void {
    // Box3D owns only the immutable test fixture. Bending, plastic yield,
    // damage, and bond fracture remain authoritative in MaterialSimulation.
    const supportSpan = 8.5 + (variant % 3) * 0.65;
    const frameTop = 9.4 + stress * 0.28;
    const accent = variant % 2 ? 0xffd166 : 0x30aebf;
    this.addBox({ dynamic: false, pos: [0, 0.14, 0], half: [supportSpan + 5.0, 0.14, 6.5], color: rgb(0x111d30), density: 0, friction: 0.9, restitution: 0.01 });
    for (const side of [-1, 1]) {
      this.addBox({ dynamic: false, pos: [side * supportSpan, 0.9, 0], half: [0.62, 0.9, 2.35], color: rgb(0x334155), density: 0, friction: 0.88, restitution: 0.01 });
      this.addBox({ dynamic: false, pos: [side * supportSpan, 1.9, 0], half: [0.9, 0.10, 2.55], color: rgba(accent, 1.8), density: 0, friction: 0.82, restitution: 0.01 });
    }
    for (const z of [-5.2, 5.2]) {
      this.addBox({ dynamic: false, pos: [0, frameTop * 0.5, z], half: [0.30, frameTop * 0.5, 0.30], color: rgb(0x475569), density: 0, friction: 0.85, restitution: 0.01 });
    }
    this.addBeamBetween([0, frameTop, -5.2], [0, frameTop, 5.2], 0.28, accent, false, 1.7);
    this.addBox({ dynamic: false, pos: [0, frameTop - 1.75, 0], half: [0.34, 1.75, 0.34], color: rgb(0x64748b), density: 0, friction: 0.82, restitution: 0.01 });
    this.addBox({ dynamic: false, pos: [0, frameTop - 3.55, 0], half: [0.72, 0.12, 1.15], color: rgba(0xf97316, 2.2), density: 0, friction: 0.82, restitution: 0.01 });
  }

  private addCinematicSetDressing(family: ScenePreset['family'], stress: number, variant: number): void {
    // Shared arena lighting and scale markers. The alpha/material channel is
    // intentionally > 1 for emissive accents in the WebGPU PBR shader.
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const radius = 31 + (i % 2) * 2.5;
      const x = Math.cos(t) * radius;
      const z = Math.sin(t) * radius;
      this.addBox({ dynamic: false, pos: [x, 1.35, z], half: [0.09, 1.35, 0.09], color: rgb(0x263244), density: 0, friction: 0.8, restitution: 0.01 });
      this.addBox({ dynamic: false, pos: [x, 2.8, z], half: [0.18, 0.08, 0.18], color: rgba(i % 3 === 0 ? 0xffd166 : 0x50d8ff, 4.2), density: 0, friction: 0.8, restitution: 0.01 });
    }

    switch (family) {
      case 'stack': {
        for (const side of [-1, 1]) {
          const x = side * (12 + variant * 0.15);
          this.addBeamBetween([x, 0.2, -9], [x, 8 + stress, -9], 0.14, 0x64748b, false);
          this.addBeamBetween([x, 0.2, 9], [x, 8 + stress, 9], 0.14, 0x64748b, false);
          this.addBeamBetween([x, 8 + stress, -9], [x, 8 + stress, 9], 0.12, 0x0d8ea7, false);
        }
        for (let i = -4; i <= 4; i++) {
          this.addBox({ dynamic: false, pos: [i * 2.2, 0.12, -12], half: [0.8, 0.12, 0.6], color: rgba(i % 2 ? 0x30aebf : 0xffd166, 2.8), density: 0, friction: 0.85, restitution: 0.01 });
        }
        break;
      }
      case 'domino': {
        this.addBox({ dynamic: false, pos: [0, 0.16, 0], half: [4.8, 0.16, 4.8], color: rgb(0x18253a), density: 0, friction: 0.78, restitution: 0.02 });
        for (let ring = 0; ring < 2; ring++) {
          const radius = 13 + ring * 6;
          for (let i = 0; i < 12; i++) {
            const t = (i / 12) * Math.PI * 2;
            const x = Math.cos(t) * radius;
            const z = Math.sin(t) * radius;
            this.addBox({ dynamic: false, pos: [x, 1.6, z], half: [0.18, 1.6, 0.18], color: rgb(0x3d4d66), density: 0, friction: 0.75, restitution: 0.02 });
            this.addBox({ dynamic: false, pos: [x, 3.35, z], half: [0.3, 0.08, 0.3], color: rgba(ring ? 0x8b5cf6 : 0x50d8ff, 3.4), density: 0, friction: 0.75, restitution: 0.02 });
          }
        }
        break;
      }
      case 'skyscraper': {
        this.addBox({ dynamic: false, pos: [0, 0.3, 0], half: [8.5, 0.3, 8.5], color: rgb(0x101827), density: 0, friction: 0.88, restitution: 0.01 });
        for (let block = 0; block < 10; block++) {
          const side = block % 2 ? -1 : 1;
          const x = side * (13 + (block % 3) * 3.2);
          const z = -12 + Math.floor(block / 2) * 5.8;
          const height = 1.8 + (block % 4) * 1.1;
          this.addBox({ dynamic: false, pos: [x, height, z], half: [1.8, height, 1.8], color: rgb(block % 2 ? 0x152238 : 0x1d2e49), density: 0, friction: 0.8, restitution: 0.01 });
          this.addBox({ dynamic: false, pos: [x, height * 1.45, z - 1.82], half: [0.9, 0.05, 0.05], color: rgba(0x55dfff, 2.6), density: 0, friction: 0.8, restitution: 0.01 });
        }
        this.addBeamBetween([0, 8, 0], [0, 18 + stress * 1.4, 0], 0.09, 0xffd166, false, 3.2);
        break;
      }
      case 'bridge': {
        const span = 21 + variant * 0.8;
        for (const side of [-1, 1]) {
          const x = side * span * 0.42;
          this.addBeamBetween([x, 0.4, -2.2], [x, 9 + stress * 0.4, -2.2], 0.17, 0x64748b, false);
          this.addBeamBetween([x, 0.4, 2.2], [x, 9 + stress * 0.4, 2.2], 0.17, 0x64748b, false);
          this.addBeamBetween([x, 8.8, -2.2], [x, 8.8, 2.2], 0.12, 0x30aebf, false, 2.1);
        }
        for (let i = 0; i < 12; i++) {
          const x0 = -span * 0.42 + (i / 12) * span * 0.84;
          const x1 = -span * 0.42 + ((i + 1) / 12) * span * 0.84;
          const high = 8.4 - Math.abs((i + 0.5) / 12 - 0.5) * 7;
          this.addBeamBetween([x0, 2.8, -2.05], [x1, high, -2.05], 0.055, 0xffd166, false, 1.9);
          this.addBeamBetween([x0, 2.8, 2.05], [x1, high, 2.05], 0.055, 0xffd166, false, 1.9);
        }
        break;
      }
      case 'material': {
        for (let lane = -3; lane <= 3; lane++) {
          const z = lane * 2.8;
          this.addBox({ dynamic: false, pos: [9.5, 0.16, z], half: [0.12, 0.16, 1.08], color: rgba(PALETTE[(lane + 13) % PALETTE.length], 2.6), density: 0, friction: 0.8, restitution: 0.02 });
          this.addBeamBetween([-15, 0.15, z - 1.18], [11, 0.15, z - 1.18], 0.035, 0x334155, false);
          this.addBeamBetween([-15, 0.15, z + 1.18], [11, 0.15, z + 1.18], 0.035, 0x334155, false);
        }
        break;
      }
      case 'rain': {
        for (const x of [-16, 16]) {
          for (const z of [-16, 16]) {
            this.addBox({ dynamic: false, pos: [x, 4.2, z], half: [0.38, 4.2, 0.38], color: rgb(0x27364c), density: 0, friction: 0.8, restitution: 0.02 });
            this.addBox({ dynamic: false, pos: [x, 8.7, z], half: [0.75, 0.12, 0.75], color: rgba(0x50d8ff, 4.8), density: 0, friction: 0.8, restitution: 0.02 });
          }
        }
        for (let i = -3; i <= 3; i++) {
          this.addBox({ dynamic: false, pos: [i * 4.4, 0.22, 18], half: [1.75, 0.22, 1.3], color: rgb(i % 2 ? 0x17243a : 0x20304a), density: 0, friction: 0.85, restitution: 0.02 });
        }
        break;
      }
      case 'demolition': {
        for (const x of [-11, 11]) {
          for (const z of [-5.2, 5.2]) {
            this.addTower(x, z, 8 + stress, 0x475569, 0.46);
            this.addBox({ dynamic: true, pos: [x, 5.2 + stress * 0.4, z], half: [0.8, 0.16, 0.8], color: rgb(0x64748b), density: 1.9, friction: 0.72, restitution: 0.02 });
          }
        }
        for (let i = -5; i <= 5; i++) {
          this.addBox({ dynamic: true, pos: [i * 1.75, 0.55, -7.2], half: [0.7, 0.55, 0.42], color: rgb(i % 2 ? 0x7c3aed : 0x334155), density: 2.2, friction: 0.74, restitution: 0.02 });
        }
        break;
      }
      case 'vehicle': {
        for (let lane = -2; lane <= 2; lane++) {
          const z = lane * 3.9;
          for (let x = -20; x <= 20; x += 4) {
            this.addBox({ dynamic: false, pos: [x, 0.06, z - 1.65], half: [1.4, 0.025, 0.035], color: rgba(0xfff2a8, 2.4), density: 0, friction: 0.8, restitution: 0.01 });
          }
        }
        this.addBeamBetween([8, 0.2, -11], [8, 5.8, -11], 0.12, 0x64748b, false);
        this.addBeamBetween([8, 0.2, 11], [8, 5.8, 11], 0.12, 0x64748b, false);
        this.addBeamBetween([8, 5.8, -11], [8, 5.8, 11], 0.12, 0x0d8ea7, false, 2.3);
        break;
      }
      case 'marble': {
        for (let x = -15; x <= 15; x += 6) {
          this.addBeamBetween([x, 0.2, -9], [x, 8.2, -9], 0.1, 0x475569, false);
          this.addBeamBetween([x, 0.2, 9], [x, 8.2, 9], 0.1, 0x475569, false);
          this.addBeamBetween([x, 8.2, -9], [x, 8.2, 9], 0.08, 0x30aebf, false, 2.0);
        }
        for (let bin = -3; bin <= 3; bin++) {
          this.addBox({ dynamic: false, pos: [14, 0.4, bin * 2.5], half: [1.4, 0.4, 1.0], color: rgb(PALETTE[(bin + 13) % PALETTE.length]), density: 0, friction: 0.7, restitution: 0.2 });
        }
        break;
      }
      case 'construction': {
        const craneX = -14;
        for (let y = 0; y < 13; y++) {
          this.addBox({ dynamic: false, pos: [craneX, 0.5 + y, -8], half: [0.15, 0.5, 0.15], color: rgb(y % 2 ? 0xf97316 : 0xffd166), density: 0, friction: 0.8, restitution: 0.01 });
          if (y % 2 === 0) this.addBeamBetween([craneX - 0.55, y + 0.3, -8], [craneX + 0.55, y + 1.1, -8], 0.055, 0xffd166, false);
        }
        this.addBeamBetween([craneX, 13.2, -8], [9, 13.2, -8], 0.14, 0xf97316, false, 1.4);
        this.addBeamBetween([5, 13.1, -8], [5, 7.2, -8], 0.045, 0xd8dee9, false);
        this.addBox({ dynamic: true, pos: [5, 6.2, -8], half: [1.4, 0.4, 0.8], color: rgb(0xffd166), density: 4.5, friction: 0.7, restitution: 0.02 });
        break;
      }
      case 'warehouse': {
        this.addBox({ dynamic: false, pos: [18, 2.4, 0], half: [0.4, 2.4, 18], color: rgb(0x172235), density: 0, friction: 0.82, restitution: 0.02 });
        for (let dock = -4; dock <= 4; dock++) {
          const z = dock * 3.7;
          this.addBox({ dynamic: false, pos: [17.5, 1.0, z], half: [0.55, 1.0, 1.45], color: rgb(dock % 2 ? 0x263b59 : 0x334155), density: 0, friction: 0.8, restitution: 0.02 });
          this.addBox({ dynamic: false, pos: [17.0, 2.25, z], half: [0.08, 0.08, 0.8], color: rgba(dock % 2 ? 0xffd166 : 0x50d8ff, 3.0), density: 0, friction: 0.8, restitution: 0.02 });
        }
        this.addBeamBetween([-18, 7.5, -10], [15, 7.5, -10], 0.08, 0x30aebf, false, 2.0);
        this.addBeamBetween([-18, 7.5, 10], [15, 7.5, 10], 0.08, 0x30aebf, false, 2.0);
        break;
      }
      case 'architecture': {
        for (let i = 0; i < 18; i++) {
          const t = (i / 18) * Math.PI * 2;
          const radius = 17.5;
          const x = Math.cos(t) * radius;
          const z = Math.sin(t) * radius;
          this.addBox({ dynamic: false, pos: [x, 2.8, z], half: [0.32, 2.8, 0.32], color: rgb(i % 2 ? 0xd8dee9 : 0xb8c2d3), density: 0, friction: 0.82, restitution: 0.01 });
          this.addBox({ dynamic: false, pos: [x, 5.8, z], half: [0.58, 0.18, 0.58], color: rgba(i % 3 ? 0xffd166 : 0x50d8ff, 2.5), density: 0, friction: 0.82, restitution: 0.01 });
        }
        this.addBox({ dynamic: false, pos: [0, 0.13, 0], half: [9, 0.13, 9], color: rgb(0x17243a), density: 0, friction: 0.84, restitution: 0.01 });
        break;
      }
      case 'cloth': {
        this.addBeamBetween([-16, 7.5, -8], [-16, 7.5, 8], 0.10, 0x30aebf, false, 2.4);
        this.addBeamBetween([16, 7.5, -8], [16, 7.5, 8], 0.10, 0xffd166, false, 2.4);
        for (let i = -4; i <= 4; i++) {
          this.addBox({ dynamic: false, pos: [i * 3.6, 0.12, 9.5], half: [1.2, 0.12, 0.22], color: rgba(i % 2 ? 0x8b5cf6 : 0x50d8ff, 2.4), density: 0, friction: 0.84, restitution: 0.01 });
        }
        break;
      }
      case 'rope': {
        for (const side of [-1, 1]) {
          this.addBeamBetween([side * 19, 0.2, -7], [side * 19, 10, -7], 0.12, 0xf97316, false, 1.8);
          this.addBeamBetween([side * 19, 0.2, 7], [side * 19, 10, 7], 0.12, 0xf97316, false, 1.8);
          this.addBeamBetween([side * 19, 10, -7], [side * 19, 10, 7], 0.10, 0xffd166, false, 2.3);
        }
        break;
      }
      case 'water': {
        for (let i = -5; i <= 5; i++) {
          this.addBox({ dynamic: false, pos: [i * 3.2, 0.42, -14], half: [1.1, 0.42, 0.26], color: rgb(i % 2 ? 0x1d4e6d : 0x2c6f8f), density: 0, friction: 0.85, restitution: 0.01 });
          this.addBox({ dynamic: false, pos: [i * 3.2, 0.42, 14], half: [1.1, 0.42, 0.26], color: rgb(i % 2 ? 0x1d4e6d : 0x2c6f8f), density: 0, friction: 0.85, restitution: 0.01 });
        }
        this.addBeamBetween([-18, 6.5, -13], [18, 6.5, -13], 0.08, 0x50d8ff, false, 2.8);
        break;
      }
      case 'fracture': {
        // Static observation hardware only; the soft material lattice owns
        // deformation and every fracture decision.
        for (let i = -5; i <= 5; i++) {
          const x = i * 3.2;
          this.addBox({ dynamic: false, pos: [x, 0.08, -6.1], half: [1.25, 0.08, 0.08], color: rgba(i % 2 ? 0xffd166 : 0x50d8ff, 2.1), density: 0, friction: 0.86, restitution: 0.01 });
          this.addBox({ dynamic: false, pos: [x, 0.08, 6.1], half: [1.25, 0.08, 0.08], color: rgba(i % 2 ? 0x50d8ff : 0xffd166, 2.1), density: 0, friction: 0.86, restitution: 0.01 });
        }
        this.addBeamBetween([-13, 6.8, -5.8], [13, 6.8, -5.8], 0.07, 0x30aebf, false, 2.4);
        this.addBeamBetween([-13, 6.8, 5.8], [13, 6.8, 5.8], 0.07, 0xffd166, false, 2.4);
        break;
      }
    }
  }

  private addBeamBetween(a: Vec3, b: Vec3, thickness: number, colorHex: number, dynamic: boolean, materialTag = 1): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.001) return;
    const nx = dx / length;
    const ny = dy / length;
    const nz = dz / length;
    const yaw = -Math.asin(clamp(nz, -1, 1));
    const roll = Math.atan2(ny, nx);
    this.addBox({
      dynamic,
      pos: [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5],
      half: [length * 0.5, thickness, thickness],
      rot: [0, yaw, roll],
      color: rgba(colorHex, materialTag),
      density: dynamic ? 1.6 : 0,
      friction: 0.72,
      restitution: 0.02,
    });
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
    if (pairLimit < 2) {
      this.broadphaseCandidateCountValue = 0;
      return;
    }

    const bounds = this.broadphaseBounds;
    let minCenterX = Number.POSITIVE_INFINITY;
    let minCenterY = Number.POSITIVE_INFINITY;
    let minCenterZ = Number.POSITIVE_INFINITY;
    let maxCenterX = Number.NEGATIVE_INFINITY;
    let maxCenterY = Number.NEGATIVE_INFINITY;
    let maxCenterZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pairLimit; i++) {
      const body = this.bodies[i];
      const offset = i * 6;
      bounds[offset] = body.pos[0] - body.half[0];
      bounds[offset + 1] = body.pos[1] - body.half[1];
      bounds[offset + 2] = body.pos[2] - body.half[2];
      bounds[offset + 3] = body.pos[0] + body.half[0];
      bounds[offset + 4] = body.pos[1] + body.half[1];
      bounds[offset + 5] = body.pos[2] + body.half[2];
      if (!body.dynamic) continue;
      minCenterX = Math.min(minCenterX, body.pos[0]);
      minCenterY = Math.min(minCenterY, body.pos[1]);
      minCenterZ = Math.min(minCenterZ, body.pos[2]);
      maxCenterX = Math.max(maxCenterX, body.pos[0]);
      maxCenterY = Math.max(maxCenterY, body.pos[1]);
      maxCenterZ = Math.max(maxCenterZ, body.pos[2]);
    }

    const spanX = maxCenterX - minCenterX;
    const spanY = maxCenterY - minCenterY;
    const spanZ = maxCenterZ - minCenterZ;
    // Deterministic ties prefer X, then Y, then Z. Dynamic centers select the
    // axis so the large static floor and boundary walls do not dominate it.
    const axis: 0 | 1 | 2 = spanY > spanX && spanY >= spanZ ? 1 : spanZ > spanX && spanZ > spanY ? 2 : 0;
    this.broadphaseAxisIndex = axis;

    const order = this.broadphaseOrder;
    if (pairLimit < this.broadphaseCount || this.broadphaseCount === 0) {
      for (let i = 0; i < pairLimit; i++) order[i] = i;
    } else if (pairLimit > this.broadphaseCount) {
      for (let i = this.broadphaseCount; i < pairLimit; i++) order[i] = i;
    }
    this.broadphaseCount = pairLimit;

    // Insertion sort exploits temporal coherence: after the first step most
    // bodies move only a few slots. Body index is the stable tie-breaker, so
    // candidate and solver order are reproducible across runs.
    for (let i = 1; i < pairLimit; i++) {
      const bodyIndex = order[i];
      const bodyMin = bounds[bodyIndex * 6 + axis];
      let cursor = i - 1;
      while (cursor >= 0) {
        const previousIndex = order[cursor];
        const previousMin = bounds[previousIndex * 6 + axis];
        if (previousMin < bodyMin || (previousMin === bodyMin && previousIndex < bodyIndex)) break;
        order[cursor + 1] = previousIndex;
        cursor--;
      }
      order[cursor + 1] = bodyIndex;
    }

    const otherAxisA: 0 | 1 | 2 = axis === 0 ? 1 : 0;
    const otherAxisB: 0 | 1 | 2 = axis === 2 ? 1 : 2;
    let candidates = 0;
    for (let sortedA = 0; sortedA < pairLimit; sortedA++) {
      const indexA = order[sortedA];
      const a = this.bodies[indexA];
      const boundsA = indexA * 6;
      const maxA = bounds[boundsA + 3 + axis];
      for (let sortedB = sortedA + 1; sortedB < pairLimit; sortedB++) {
        const indexB = order[sortedB];
        const boundsB = indexB * 6;
        if (bounds[boundsB + axis] > maxA) break;
        const b = this.bodies[indexB];
        if (!a.dynamic && !b.dynamic) continue;
        if (bounds[boundsA + 3 + otherAxisA] <= bounds[boundsB + otherAxisA] ||
            bounds[boundsB + 3 + otherAxisA] <= bounds[boundsA + otherAxisA] ||
            bounds[boundsA + 3 + otherAxisB] <= bounds[boundsB + otherAxisB] ||
            bounds[boundsB + 3 + otherAxisB] <= bounds[boundsA + otherAxisB]) continue;
        candidates++;
        this.resolveAabbPair(a, b);
      }
    }
    this.broadphaseCandidateCountValue = candidates;
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

    let normalX = Math.sign(dx) || 1;
    let normalY = 0;
    let normalZ = 0;
    let penetration = px;
    if (py < penetration) {
      penetration = py;
      normalX = 0;
      normalY = Math.sign(dy) || 1;
      normalZ = 0;
    }
    if (pz < penetration) {
      penetration = pz;
      normalX = 0;
      normalY = 0;
      normalZ = Math.sign(dz) || 1;
    }

    const invMassSum = a.invMass + b.invMass;
    if (invMassSum <= 0) return;

    const correction = (penetration + 0.002) / invMassSum;
    if (a.dynamic) {
      const correctionA = correction * a.invMass;
      a.pos[0] = a.pos[0] - normalX * correctionA;
      a.pos[1] = a.pos[1] - normalY * correctionA;
      a.pos[2] = a.pos[2] - normalZ * correctionA;
    }
    if (b.dynamic) {
      const correctionB = correction * b.invMass;
      b.pos[0] = b.pos[0] + normalX * correctionB;
      b.pos[1] = b.pos[1] + normalY * correctionB;
      b.pos[2] = b.pos[2] + normalZ * correctionB;
    }

    const relativeVelocityX = b.vel[0] - a.vel[0];
    const relativeVelocityY = b.vel[1] - a.vel[1];
    const relativeVelocityZ = b.vel[2] - a.vel[2];
    const vn = relativeVelocityX * normalX + relativeVelocityY * normalY + relativeVelocityZ * normalZ;
    if (vn < 0) {
      const e = Math.min(a.restitution, b.restitution);
      const impulseMag = (-(1 + e) * vn) / invMassSum;
      // Preserve the legacy multiplication order: scale(normal, impulseMag)
      // was followed by scale(impulse, invMass) before the final add/subtract.
      const impulseX = normalX * impulseMag;
      const impulseY = normalY * impulseMag;
      const impulseZ = normalZ * impulseMag;
      if (a.dynamic) {
        a.vel[0] = a.vel[0] - impulseX * a.invMass;
        a.vel[1] = a.vel[1] - impulseY * a.invMass;
        a.vel[2] = a.vel[2] - impulseZ * a.invMass;
      }
      if (b.dynamic) {
        b.vel[0] = b.vel[0] + impulseX * b.invMass;
        b.vel[1] = b.vel[1] + impulseY * b.invMass;
        b.vel[2] = b.vel[2] + impulseZ * b.invMass;
      }
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
