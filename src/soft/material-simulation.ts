import {
  LcgRng,
  clamp,
  writeAxisAlignedModelMatrix,
  writeModelMatrixFromEuler,
  type Vec3,
} from '../math';
import type { ScenePreset } from '../scenes';
import type { DebugLine, MaterialFailureTelemetry, RopeGridFrame } from '../types';
import type { SoftSimulation, SoftSimulationFrame } from './simulations';
import { materialPresetForVariant, type MaterialBehaviorPreset } from './material-presets';

const MAX_PROJECTILES = 64;
const MAX_CPU_INSTANCES = MAX_PROJECTILES + 1;
const MAX_RENDER_SEGMENTS = 1900;
const TELEMETRY_INTERVAL = 8;

type Projectile = {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  life: number;
  color: readonly [number, number, number, number];
};

type ConstraintSeed = {
  a: number;
  b: number;
  rest: number;
  stiffness: number;
  tensileYield: number;
  tensileBreak: number;
  compressionYield: number;
  compressionBreak: number;
  plasticCreep: number;
  damageRate: number;
  fatigueRate: number;
  render: boolean;
  radius: number;
  cohesiveCell: number;
};

function quantizedHash(values: ArrayLike<number>, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let i = 0; i < values.length; i++) {
    const q = Math.trunc(values[i] * 100000) | 0;
    hash ^= q & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 8) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 16) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 24) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function setColor(out: Float32Array, index: number, color: readonly number[]): void {
  const offset = index * 4;
  out[offset] = color[0];
  out[offset + 1] = color[1];
  out[offset + 2] = color[2];
  out[offset + 3] = color[3];
}

function failureModeLabel(profile: MaterialBehaviorPreset): string {
  switch (profile.failureMode) {
    case 'ductile': return 'ductile yield → plastic set → rupture';
    case 'brittle': return 'elastic response → rapid brittle fracture';
    case 'fiber': return 'anisotropic fiber loading → progressive split';
    case 'hyperelastic': return 'large reversible flexure → damage';
    default: return 'progressive cracking and load redistribution';
  }
}

/**
 * Deterministic reduced-order material specimen.
 *
 * World contract: Y-up, right-handed, one world unit represents one metre.
 * This is a normalized comparative beam-lattice model, not calibrated FEA.
 */
export class MaterialSimulation implements SoftSimulation {
  readonly kind = 'fracture' as const;
  readonly label: string;

  private readonly profile: MaterialBehaviorPreset;
  private readonly mode: number;
  private readonly stress: number;
  private readonly rng: LcgRng;
  private readonly stations: number;
  private readonly lanes: number;
  private readonly nodeCountValue: number;
  private readonly span = 24;
  private readonly depth: number;
  private readonly baseY = 7.2;
  private positions: Float32Array;
  private previous: Float32Array;
  private readonly restPositions: Float32Array;
  private readonly invMass: Float32Array;
  private readonly pinned: Uint8Array;

  private readonly a: Uint16Array;
  private readonly b: Uint16Array;
  private readonly rest: Float32Array;
  private readonly originalRest: Float32Array;
  private readonly stiffness: Float32Array;
  private readonly tensileYield: Float32Array;
  private readonly tensileBreak: Float32Array;
  private readonly compressionYield: Float32Array;
  private readonly compressionBreak: Float32Array;
  private readonly plasticCreep: Float32Array;
  private readonly damageRate: Float32Array;
  private readonly fatigueRate: Float32Array;
  private readonly damage: Float32Array;
  private readonly yielded: Uint8Array;
  private readonly damaged: Uint8Array;
  private readonly broken: Uint8Array;
  private readonly render: Uint8Array;
  private readonly radius: Float32Array;
  private readonly cohesiveCell: Int32Array;
  private readonly constraintCountValue: number;

  private readonly segmentData: Float32Array;
  private segmentCount = 0;
  private segmentTopologyVersion = 1;
  private segmentMetadataDirty = true;
  private readonly segmentGrid: RopeGridFrame;
  private readonly matrices = new Float32Array(MAX_CPU_INSTANCES * 16);
  private readonly colors = new Float32Array(MAX_CPU_INSTANCES * 4);
  private readonly debugLines: DebugLine[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly telemetry: MaterialFailureTelemetry;
  private readonly frame: SoftSimulationFrame;

  private loadTarget = 0;
  private loadProgress = 0;
  private cycleEnabled = false;
  private time = 0;
  private frameVersion = 1;
  private builtFrameVersion = -1;
  private builtFrameDebug = false;
  private telemetryCountdown = 0;
  private yieldedCountValue = 0;
  private damagedCountValue = 0;
  private brokenCountValue = 0;
  private peakDamageValue = 0;
  private maxStrainValue = 0;
  private energyValue = 0;
  private hashValue = 1;

  constructor(scene: ScenePreset, stress: number, seed: number) {
    this.profile = materialPresetForVariant(scene.variant);
    this.mode = scene.mode;
    this.stress = clamp(Math.round(stress), 1, 5);
    this.rng = new LcgRng((seed ^ 0xf4ac7e31) >>> 0);
    this.stations = Math.min(48, 24 + this.stress * 4 + (scene.mode >= 3 ? 4 : 0));
    this.lanes = Math.min(7, 3 + (scene.variant % 3) + (scene.mode === 4 ? 1 : 0));
    this.nodeCountValue = this.stations * this.lanes;
    this.depth = 3.2 + this.lanes * 0.55;
    this.positions = new Float32Array(this.nodeCountValue * 3);
    this.previous = new Float32Array(this.nodeCountValue * 3);
    this.restPositions = new Float32Array(this.nodeCountValue * 3);
    this.invMass = new Float32Array(this.nodeCountValue);
    this.pinned = new Uint8Array(this.nodeCountValue);
    this.initializeNodes();

    const seeds = this.buildConstraintSeeds(scene.variant);
    this.constraintCountValue = seeds.length;
    this.a = new Uint16Array(seeds.length);
    this.b = new Uint16Array(seeds.length);
    this.rest = new Float32Array(seeds.length);
    this.originalRest = new Float32Array(seeds.length);
    this.stiffness = new Float32Array(seeds.length);
    this.tensileYield = new Float32Array(seeds.length);
    this.tensileBreak = new Float32Array(seeds.length);
    this.compressionYield = new Float32Array(seeds.length);
    this.compressionBreak = new Float32Array(seeds.length);
    this.plasticCreep = new Float32Array(seeds.length);
    this.damageRate = new Float32Array(seeds.length);
    this.fatigueRate = new Float32Array(seeds.length);
    this.damage = new Float32Array(seeds.length);
    this.yielded = new Uint8Array(seeds.length);
    this.damaged = new Uint8Array(seeds.length);
    this.broken = new Uint8Array(seeds.length);
    this.render = new Uint8Array(seeds.length);
    this.radius = new Float32Array(seeds.length);
    this.cohesiveCell = new Int32Array(seeds.length);
    for (let i = 0; i < seeds.length; i++) this.writeConstraint(i, seeds[i]);

    const renderCapacity = Math.min(MAX_RENDER_SEGMENTS, seeds.reduce((sum, value) => sum + (value.render ? 1 : 0), 0));
    this.segmentData = new Float32Array(Math.max(1, renderCapacity) * 8);
    this.segmentGrid = {
      presentation: 'material',
      positions: this.positions,
      segments: this.segmentData,
      nodeCount: this.nodeCountValue,
      segmentCount: 0,
      topologyVersion: this.segmentTopologyVersion,
      frameVersion: this.frameVersion,
    };

    const defaultTargets = [0.78, 1.30, 0.62, 1.08, 1.55] as const;
    this.loadTarget = defaultTargets[this.mode] ?? 0.8;
    this.cycleEnabled = this.mode === 1 || this.mode === 4;
    const testModes = ['three-point bend', 'cyclic overload', 'precision displacement ramp', 'instrumented impact', 'cinematic yield-to-fracture'] as const;
    this.telemetry = {
      label: this.profile.label,
      testMode: `${testModes[this.mode] ?? testModes[0]} · ${failureModeLabel(this.profile)}`,
      loadTarget: this.loadTarget,
      loadProgress: 0,
      maxStrain: 0,
      yieldStrain: this.profile.tensileYieldStrain,
      breakStrain: this.profile.tensileBreakStrain,
      yieldedCount: 0,
      damagedCount: 0,
      peakDamage: 0,
      failurePhase: 'elastic',
    };
    this.label = `${this.profile.label} · normalized beam-lattice failure rig`;
    this.frame = {
      kind: this.kind,
      label: this.label,
      matrices: this.matrices,
      colors: this.colors,
      instanceCount: 0,
      surface: null,
      ropeGrid: this.segmentGrid,
      debugLines: this.debugLines,
      nodeCount: this.nodeCountValue,
      constraintCount: this.constraintCountValue,
      brokenCount: 0,
      energy: 0,
      hash: 1,
      frameVersion: this.frameVersion,
      material: this.telemetry,
    };
    this.refreshSegmentMetadata(false);
    this.updateTelemetry(true);
    this.buildFrame(false);
  }

  private node(station: number, lane: number): number { return station * this.lanes + lane; }

  private initializeNodes(): void {
    const stationStep = this.span / Math.max(1, this.stations - 1);
    const laneStep = this.depth / Math.max(1, this.lanes - 1);
    const mass = Math.max(0.08, this.profile.densityScale);
    for (let station = 0; station < this.stations; station++) {
      const x = -this.span * 0.5 + station * stationStep;
      const t = station / Math.max(1, this.stations - 1);
      for (let lane = 0; lane < this.lanes; lane++) {
        const index = this.node(station, lane);
        const offset = index * 3;
        const z = -this.depth * 0.5 + lane * laneStep;
        const camber = Math.sin(Math.PI * t) * 0.035;
        this.positions[offset] = x;
        this.positions[offset + 1] = this.baseY + camber;
        this.positions[offset + 2] = z;
        const support = station === 0 || station === this.stations - 1;
        this.pinned[index] = support ? 1 : 0;
        this.invMass[index] = support ? 0 : 1 / mass;
      }
    }
    this.previous.set(this.positions);
    this.restPositions.set(this.positions);
  }

  private buildConstraintSeeds(variant: number): ConstraintSeed[] {
    const result: ConstraintSeed[] = [];
    const iterations = 5 + this.stress;
    const add = (
      a: number,
      b: number,
      stiffness: number,
      thresholdScale: number,
      render: boolean,
      radius: number,
      cohesiveCell: number,
    ): void => {
      const ao = a * 3;
      const bo = b * 3;
      const dx = this.positions[bo] - this.positions[ao];
      const dy = this.positions[bo + 1] - this.positions[ao + 1];
      const dz = this.positions[bo + 2] - this.positions[ao + 2];
      const rest = Math.hypot(dx, dy, dz);
      if (!(rest > 1e-6)) return;
      const brittleNotch = (variant === 5 || variant === 6 || variant === 9) &&
        cohesiveCell >= 0 && Math.abs(Math.floor(cohesiveCell / this.lanes) - Math.floor(this.stations * 0.5)) <= 1;
      const notchScale = brittleNotch ? 0.68 : 1;
      result.push({
        a, b, rest,
        stiffness: 1 - Math.pow(1 - clamp(stiffness, 0.02, 0.999), 1 / iterations),
        tensileYield: this.profile.tensileYieldStrain * thresholdScale * notchScale,
        tensileBreak: this.profile.tensileBreakStrain * thresholdScale * notchScale,
        compressionYield: this.profile.compressionYieldStrain * thresholdScale,
        compressionBreak: this.profile.compressionBreakStrain * thresholdScale,
        plasticCreep: this.profile.plasticCreep,
        damageRate: this.profile.damageRate,
        fatigueRate: this.profile.fatigueRate,
        render, radius, cohesiveCell,
      });
    };

    for (let station = 0; station < this.stations; station++) {
      for (let lane = 0; lane < this.lanes; lane++) {
        const current = this.node(station, lane);
        if (station + 1 < this.stations) {
          const cell = station * this.lanes + lane;
          add(current, this.node(station + 1, lane), this.profile.axialStiffness, 1, true, 0.095, cell);
        }
        if (lane + 1 < this.lanes) {
          add(current, this.node(station, lane + 1), this.profile.shearStiffness, this.profile.anisotropy, true, 0.065, -1);
        }
        if (station + 1 < this.stations && lane + 1 < this.lanes) {
          const cell = station * this.lanes + lane;
          const diagonalScale = Math.sqrt(this.profile.anisotropy);
          add(current, this.node(station + 1, lane + 1), this.profile.shearStiffness, diagonalScale, true, 0.052, cell);
          add(this.node(station + 1, lane), this.node(station, lane + 1), this.profile.shearStiffness, diagonalScale, true, 0.052, cell);
        }
        if (station + 2 < this.stations) {
          const cell = (station + 1) * this.lanes + lane;
          add(current, this.node(station + 2, lane), this.profile.bendStiffness, 1.3, false, 0.04, cell);
        }
        if (lane + 2 < this.lanes) {
          add(current, this.node(station, lane + 2), this.profile.bendStiffness * this.profile.anisotropy, 1.5, false, 0.04, -1);
        }
      }
    }
    return result;
  }

  private writeConstraint(index: number, seed: ConstraintSeed): void {
    this.a[index] = seed.a;
    this.b[index] = seed.b;
    this.rest[index] = seed.rest;
    this.originalRest[index] = seed.rest;
    this.stiffness[index] = seed.stiffness;
    this.tensileYield[index] = Math.max(0.0001, seed.tensileYield);
    this.tensileBreak[index] = Math.max(this.tensileYield[index] + 0.0001, seed.tensileBreak);
    this.compressionYield[index] = Math.max(0.0001, seed.compressionYield);
    this.compressionBreak[index] = Math.max(this.compressionYield[index] + 0.0001, seed.compressionBreak);
    this.plasticCreep[index] = seed.plasticCreep;
    this.damageRate[index] = seed.damageRate;
    this.fatigueRate[index] = seed.fatigueRate;
    this.render[index] = seed.render ? 1 : 0;
    this.radius[index] = seed.radius;
    this.cohesiveCell[index] = seed.cohesiveCell;
  }

  step(dt: number, subSteps: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const steps = Math.max(1, Math.min(8, Math.round(subSteps)));
    const stepDt = Math.min(dt, 1 / 30) / steps;
    for (let subStep = 0; subStep < steps; subStep++) {
      this.time += stepDt;
      this.updateLoad(stepDt);
      this.integrateProjectiles(stepDt);
      this.integrate(stepDt);
      this.collideProjectiles();
      this.evaluateDamage(stepDt);
      const iterations = 5 + this.stress;
      for (let iteration = 0; iteration < iterations; iteration++) this.projectConstraints();
      this.solveBounds();
    }
    this.telemetryCountdown--;
    if (this.telemetryCountdown <= 0) this.updateTelemetry(false);
    this.frameVersion++;
  }

  private updateLoad(dt: number): void {
    const target = this.cycleEnabled
      ? this.loadTarget * (0.20 + 0.80 * (0.5 + 0.5 * Math.sin(this.time * (this.mode === 4 ? 0.72 : 1.25))))
      : this.loadTarget;
    const response = 1 - Math.pow(0.0008, dt);
    this.loadProgress += (target - this.loadProgress) * response;
  }

  private integrate(dt: number): void {
    const dt2 = dt * dt;
    const damping = this.profile.damping;
    const center = (this.stations - 1) * 0.5;
    const halfBand = Math.max(1.5, this.stations * 0.075);
    const loadAcceleration = this.loadProgress * (38 + this.stress * 8) / Math.max(0.18, this.profile.densityScale);
    const lateralLoad = this.mode === 4 ? Math.sin(this.time * 1.1) * this.loadProgress * 5 : 0;
    for (let station = 1; station < this.stations - 1; station++) {
      const distanceToCenter = Math.abs(station - center);
      const loadWeight = distanceToCenter <= halfBand ? 1 - distanceToCenter / (halfBand + 0.001) : 0;
      for (let lane = 0; lane < this.lanes; lane++) {
        const index = this.node(station, lane);
        if (this.pinned[index] !== 0) continue;
        const offset = index * 3;
        const x = this.positions[offset];
        const y = this.positions[offset + 1];
        const z = this.positions[offset + 2];
        const vx = (x - this.previous[offset]) * damping;
        const vy = (y - this.previous[offset + 1]) * damping;
        const vz = (z - this.previous[offset + 2]) * damping;
        this.previous[offset] = x;
        this.previous[offset + 1] = y;
        this.previous[offset + 2] = z;
        this.positions[offset] = x + vx + lateralLoad * loadWeight * dt2;
        this.positions[offset + 1] = y + vy - (9.81 + loadAcceleration * loadWeight) * dt2;
        this.positions[offset + 2] = z + vz;
      }
    }
  }

  private evaluateDamage(dt: number): void {
    const pendingCells = new Int32Array(12);
    let pendingCount = 0;
    let maxStrain = this.maxStrainValue;
    let peakDamage = this.peakDamageValue;
    let plasticChanged = false;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] !== 0) continue;
      const ao = this.a[i] * 3;
      const bo = this.b[i] * 3;
      const dx = this.positions[bo] - this.positions[ao];
      const dy = this.positions[bo + 1] - this.positions[ao + 1];
      const dz = this.positions[bo + 2] - this.positions[ao + 2];
      const length = Math.hypot(dx, dy, dz);
      if (!(length > 1e-8)) continue;
      const signedStrain = (length - this.rest[i]) / Math.max(1e-7, this.rest[i]);
      const strain = Math.abs(signedStrain);
      const yieldPoint = signedStrain >= 0 ? this.tensileYield[i] : this.compressionYield[i];
      const breakPoint = signedStrain >= 0 ? this.tensileBreak[i] : this.compressionBreak[i];
      const reportableStrain = Math.min(strain, breakPoint * 1.5);
      if (reportableStrain > maxStrain) maxStrain = reportableStrain;
      if (strain <= yieldPoint) continue;
      if (this.yielded[i] === 0) {
        this.yielded[i] = 1;
        this.yieldedCountValue++;
        this.telemetryCountdown = 0;
      }
      const normalized = clamp((strain - yieldPoint) / Math.max(1e-6, breakPoint - yieldPoint), 0, 2);
      const cyclic = this.cycleEnabled ? Math.abs(Math.sin(this.time * 1.25)) : 0;
      const addedDamage = (normalized * normalized * this.damageRate[i] + normalized * cyclic * this.fatigueRate[i]) * dt;
      if (addedDamage > 0) {
        if (this.damaged[i] === 0) {
          this.damaged[i] = 1;
          this.damagedCountValue++;
          this.telemetryCountdown = 0;
        }
        this.damage[i] = clamp(this.damage[i] + addedDamage, 0, 1);
        if (this.damage[i] > peakDamage) peakDamage = this.damage[i];
      }
      if (this.plasticCreep[i] > 0 && strain < breakPoint * 1.25) {
        const drift = (length - this.rest[i]) * this.plasticCreep[i] * dt * (0.4 + normalized);
        const maxPlastic = this.originalRest[i] * Math.min(0.42, breakPoint * 1.8);
        const next = clamp(this.rest[i] + drift, this.originalRest[i] - maxPlastic, this.originalRest[i] + maxPlastic);
        if (Math.abs(next - this.rest[i]) > 1e-7) {
          this.rest[i] = next;
          plasticChanged = true;
        }
      }
      if ((strain >= breakPoint || this.damage[i] >= 1) && pendingCount < pendingCells.length) {
        const cell = this.cohesiveCell[i];
        pendingCells[pendingCount++] = cell >= 0 ? cell : -(i + 1);
      }
    }
    this.maxStrainValue = maxStrain;
    this.peakDamageValue = peakDamage;
    if (plasticChanged) this.segmentMetadataDirty = true;
    for (let i = 0; i < pendingCount; i++) {
      const value = pendingCells[i];
      if (value >= 0) this.breakCohesiveCell(value);
      else this.breakConstraint(-value - 1);
    }
  }

  private projectConstraints(): void {
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] !== 0) continue;
      const a = this.a[i];
      const b = this.b[i];
      const ao = a * 3;
      const bo = b * 3;
      const dx = this.positions[bo] - this.positions[ao];
      const dy = this.positions[bo + 1] - this.positions[ao + 1];
      const dz = this.positions[bo + 2] - this.positions[ao + 2];
      const lengthSquared = dx * dx + dy * dy + dz * dz;
      if (lengthSquared < 1e-14) continue;
      const length = Math.sqrt(lengthSquared);
      const invA = this.invMass[a];
      const invB = this.invMass[b];
      const total = invA + invB;
      if (total <= 0) continue;
      const softened = this.stiffness[i] * (1 - this.damage[i] * 0.72);
      const correction = (length - this.rest[i]) / length * softened;
      const scaleA = correction * invA / total;
      const scaleB = correction * invB / total;
      this.positions[ao] += dx * scaleA;
      this.positions[ao + 1] += dy * scaleA;
      this.positions[ao + 2] += dz * scaleA;
      this.positions[bo] -= dx * scaleB;
      this.positions[bo + 1] -= dy * scaleB;
      this.positions[bo + 2] -= dz * scaleB;
    }
  }

  private solveBounds(): void {
    for (let i = 0; i < this.nodeCountValue; i++) {
      if (this.pinned[i] !== 0) {
        const offset = i * 3;
        this.positions[offset] = this.restPositions[offset];
        this.positions[offset + 1] = this.restPositions[offset + 1];
        this.positions[offset + 2] = this.restPositions[offset + 2];
        this.previous[offset] = this.restPositions[offset];
        this.previous[offset + 1] = this.restPositions[offset + 1];
        this.previous[offset + 2] = this.restPositions[offset + 2];
        continue;
      }
      const offset = i * 3;
      if (this.positions[offset + 1] < 0.22) {
        this.positions[offset + 1] = 0.22;
        this.previous[offset] = this.positions[offset] - (this.positions[offset] - this.previous[offset]) * 0.48;
        this.previous[offset + 2] = this.positions[offset + 2] - (this.positions[offset + 2] - this.previous[offset + 2]) * 0.48;
      }
      this.positions[offset] = clamp(this.positions[offset], -36, 36);
      this.positions[offset + 1] = clamp(this.positions[offset + 1], 0.22, 30);
      this.positions[offset + 2] = clamp(this.positions[offset + 2], -24, 24);
    }
  }

  private breakConstraint(index: number): void {
    if (index < 0 || index >= this.constraintCountValue || this.broken[index] !== 0) return;
    if (this.yielded[index] === 0) {
      this.yielded[index] = 1;
      this.yieldedCountValue++;
    }
    if (this.damaged[index] === 0) {
      this.damaged[index] = 1;
      this.damagedCountValue++;
    }
    this.broken[index] = 1;
    this.damage[index] = 1;
    this.peakDamageValue = 1;
    this.brokenCountValue++;
    this.telemetryCountdown = 0;
    this.segmentMetadataDirty = true;
  }

  private breakCohesiveCell(cell: number): void {
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.cohesiveCell[i] === cell) this.breakConstraint(i);
    }
  }

  private refreshSegmentMetadata(advanceVersion = true): void {
    if (!this.segmentMetadataDirty) return;
    let count = 0;
    const base = this.profile.baseColor;
    for (let i = 0; i < this.constraintCountValue && count < MAX_RENDER_SEGMENTS; i++) {
      if (this.render[i] === 0 || this.broken[i] !== 0) continue;
      const target = count * 8;
      const heat = clamp(this.damage[i] * 1.2, 0, 1);
      this.segmentData[target] = this.a[i];
      this.segmentData[target + 1] = this.b[i];
      this.segmentData[target + 2] = 1 / Math.max(1e-7, this.rest[i]);
      this.segmentData[target + 3] = this.radius[i];
      this.segmentData[target + 4] = base[0] + (1 - base[0]) * heat * 0.62;
      this.segmentData[target + 5] = base[1] * (1 - heat * 0.58) + 0.25 * heat;
      this.segmentData[target + 6] = base[2] * (1 - heat * 0.78) + 0.03 * heat;
      this.segmentData[target + 7] = Math.max(1, base[3]) + heat * 0.65;
      count++;
    }
    this.segmentCount = count;
    if (advanceVersion) this.segmentTopologyVersion++;
    this.segmentGrid.segmentCount = count;
    this.segmentGrid.topologyVersion = this.segmentTopologyVersion;
    this.segmentMetadataDirty = false;
  }

  private integrateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      projectile.velocity[1] -= 9.81 * dt;
      projectile.position[0] += projectile.velocity[0] * dt;
      projectile.position[1] += projectile.velocity[1] * dt;
      projectile.position[2] += projectile.velocity[2] * dt;
    }
    let write = 0;
    for (let read = 0; read < this.projectiles.length; read++) {
      const projectile = this.projectiles[read];
      if (projectile.life > 0 && projectile.position[1] >= -3) this.projectiles[write++] = projectile;
    }
    this.projectiles.length = write;
  }

  private collideProjectiles(): void {
    for (const projectile of this.projectiles) {
      const target = projectile.radius + 0.30;
      const targetSquared = target * target;
      const speed = Math.hypot(projectile.velocity[0], projectile.velocity[1], projectile.velocity[2]);
      let nearestNode = -1;
      let nearestDistance = targetSquared;
      for (let i = 0; i < this.nodeCountValue; i++) {
        if (this.pinned[i] !== 0) continue;
        const offset = i * 3;
        const dx = this.positions[offset] - projectile.position[0];
        const dy = this.positions[offset + 1] - projectile.position[1];
        const dz = this.positions[offset + 2] - projectile.position[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= nearestDistance) continue;
        nearestDistance = distanceSquared;
        nearestNode = i;
      }
      if (nearestNode < 0) continue;
      const offset = nearestNode * 3;
      const impulse = clamp(speed * 0.010, 0.04, 0.55);
      this.previous[offset] -= projectile.velocity[0] * impulse;
      this.previous[offset + 1] -= projectile.velocity[1] * impulse;
      this.previous[offset + 2] -= projectile.velocity[2] * impulse;
      if (speed > 16) this.damageNearNode(nearestNode, clamp(speed * 0.012, 0.08, 0.48));
      projectile.life = 0;
    }
  }

  private damageNearNode(node: number, amount: number): void {
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] !== 0 || (this.a[i] !== node && this.b[i] !== node)) continue;
      if (this.damaged[i] === 0) {
        this.damaged[i] = 1;
        this.damagedCountValue++;
        this.telemetryCountdown = 0;
      }
      this.damage[i] = clamp(this.damage[i] + amount, 0, 1);
      this.peakDamageValue = Math.max(this.peakDamageValue, this.damage[i]);
      if (this.damage[i] >= 1) {
        const cell = this.cohesiveCell[i];
        if (cell >= 0) this.breakCohesiveCell(cell);
        else this.breakConstraint(i);
      }
    }
    this.segmentMetadataDirty = true;
  }

  kick(strength: number): void {
    const center = (this.stations - 1) * 0.5;
    const impulse = clamp(strength, 0, 40) * 0.032;
    for (let station = 1; station < this.stations - 1; station++) {
      const weight = Math.max(0, 1 - Math.abs(station - center) / Math.max(2, this.stations * 0.22));
      if (weight <= 0) continue;
      for (let lane = 0; lane < this.lanes; lane++) {
        const offset = this.node(station, lane) * 3;
        this.previous[offset + 1] += impulse * weight;
        this.previous[offset + 2] -= this.rng.signed(impulse * 0.18) * weight;
      }
    }
    this.frameVersion++;
  }

  explode(center: Vec3, strength: number, radius: number): void {
    const safeRadius = Math.max(0.5, radius);
    const radiusSquared = safeRadius * safeRadius;
    for (let i = 0; i < this.nodeCountValue; i++) {
      if (this.pinned[i] !== 0) continue;
      const offset = i * 3;
      const dx = this.positions[offset] - center[0];
      const dy = this.positions[offset + 1] - center[1];
      const dz = this.positions[offset + 2] - center[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared <= 1e-10 || distanceSquared >= radiusSquared) continue;
      const distance = Math.sqrt(distanceSquared);
      const impulse = (1 - distance / safeRadius) * strength * 0.024;
      this.previous[offset] -= dx / distance * impulse;
      this.previous[offset + 1] -= (dy / distance + 0.22) * impulse;
      this.previous[offset + 2] -= dz / distance * impulse;
      if (strength > 14) this.damageNearNode(i, clamp((1 - distance / safeRadius) * strength * 0.006, 0, 0.32));
    }
    this.frameVersion++;
  }

  launchProjectile(position: Vec3, velocity: Vec3, size: number): number {
    if (this.projectiles.length >= MAX_PROJECTILES) return -1;
    this.projectiles.push({
      position: [...position] as Vec3,
      velocity: [...velocity] as Vec3,
      radius: clamp(size, 0.12, 1.5),
      life: 8,
      color: [1, 0.38, 0.06, 2.2],
    });
    this.frameVersion++;
    return this.projectiles.length - 1;
  }

  spawnRain(count: number, spread: number, height: number): number {
    const allowed = Math.max(0, Math.min(Math.round(count), MAX_PROJECTILES - this.projectiles.length));
    for (let i = 0; i < allowed; i++) {
      this.projectiles.push({
        position: [this.rng.signed(Math.min(spread, this.span * 0.55)), height + this.rng.range(0, 8), this.rng.signed(Math.min(spread, this.depth))],
        velocity: [this.rng.signed(0.7), this.rng.range(-15, -9), this.rng.signed(0.7)],
        radius: this.rng.range(0.08, 0.17),
        life: 5,
        color: [0.22, 0.68, 1, 1.7],
      });
    }
    if (allowed > 0) this.frameVersion++;
    return allowed;
  }

  setLoadTarget(target: number): void {
    const next = clamp(Number.isFinite(target) ? target : 0, 0, 2);
    this.loadTarget = next;
    this.cycleEnabled = false;
    this.telemetry.loadTarget = next;
    this.frameVersion++;
  }

  releaseLoad(): void {
    this.loadTarget = 0;
    this.cycleEnabled = false;
    this.telemetry.loadTarget = 0;
    this.frameVersion++;
  }

  cycleLoad(): void {
    this.cycleEnabled = !this.cycleEnabled;
    if (this.loadTarget <= 0.05) this.loadTarget = 1.15;
    this.telemetry.loadTarget = this.loadTarget;
    this.frameVersion++;
  }

  private updateTelemetry(force: boolean): void {
    if (!force && this.telemetryCountdown > 0) return;
    let kinetic = 0;
    for (let i = 0; i < this.nodeCountValue; i++) {
      const offset = i * 3;
      const vx = this.positions[offset] - this.previous[offset];
      const vy = this.positions[offset + 1] - this.previous[offset + 1];
      const vz = this.positions[offset + 2] - this.previous[offset + 2];
      kinetic += vx * vx + vy * vy + vz * vz;
    }
    let strainEnergy = 0;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] !== 0) continue;
      const ao = this.a[i] * 3;
      const bo = this.b[i] * 3;
      const dx = this.positions[bo] - this.positions[ao];
      const dy = this.positions[bo + 1] - this.positions[ao + 1];
      const dz = this.positions[bo + 2] - this.positions[ao + 2];
      const delta = Math.hypot(dx, dy, dz) - this.rest[i];
      strainEnergy += delta * delta * this.stiffness[i];
    }
    this.energyValue = (kinetic + strainEnergy) / Math.max(1, this.nodeCountValue);
    let hash = quantizedHash(this.positions);
    hash = quantizedHash(this.rest, hash);
    hash = quantizedHash(this.damage, hash);
    hash = quantizedHash(this.broken, hash);
    this.hashValue = hash === 0 ? 1 : hash;
    this.telemetry.loadTarget = this.loadTarget;
    this.telemetry.loadProgress = this.loadProgress;
    this.telemetry.maxStrain = this.maxStrainValue;
    this.telemetry.yieldedCount = this.yieldedCountValue;
    this.telemetry.damagedCount = this.damagedCountValue;
    this.telemetry.peakDamage = this.peakDamageValue;
    this.telemetry.failurePhase = this.brokenCountValue > Math.max(8, this.constraintCountValue * 0.18)
      ? 'failed'
      : this.brokenCountValue > 0
        ? 'fracturing'
        : this.yieldedCountValue > 0
          ? 'yielding'
          : 'elastic';
    this.telemetryCountdown = TELEMETRY_INTERVAL;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frame;
    this.refreshSegmentMetadata(true);
    let instanceCount = 0;
    const centerStation = Math.floor(this.stations * 0.5);
    let centerY = 0;
    for (let lane = 0; lane < this.lanes; lane++) centerY += this.positions[this.node(centerStation, lane) * 3 + 1];
    centerY /= this.lanes;
    writeAxisAlignedModelMatrix(this.matrices, 0, [0, centerY + 0.68, 0], 1.7, 0.28, this.depth * 0.55);
    setColor(this.colors, 0, [1, 0.54, 0.08, 1.35]);
    instanceCount++;
    for (const projectile of this.projectiles) {
      if (instanceCount >= MAX_CPU_INSTANCES) break;
      writeModelMatrixFromEuler(
        this.matrices,
        instanceCount * 16,
        projectile.position,
        [this.time * 1.3, this.time * 0.8, 0],
        [projectile.radius, projectile.radius, projectile.radius],
      );
      setColor(this.colors, instanceCount, projectile.color);
      instanceCount++;
    }

    this.debugLines.length = 0;
    if (debug) {
      for (const station of [0, this.stations - 1]) {
        for (let lane = 0; lane < this.lanes; lane++) {
          const offset = this.node(station, lane) * 3;
          const x = this.positions[offset];
          const y = this.positions[offset + 1];
          const z = this.positions[offset + 2];
          this.debugLines.push({ ax: x - 0.15, ay: y, az: z, bx: x + 0.15, by: y, bz: z, r: 1, g: 0.72, b: 0.08, a: 0.9 });
        }
      }
      let sampled = 0;
      for (let i = 0; i < this.constraintCountValue && sampled < 180; i++) {
        if (this.damage[i] < 0.12 || this.broken[i] !== 0) continue;
        const ao = this.a[i] * 3;
        const bo = this.b[i] * 3;
        const heat = this.damage[i];
        this.debugLines.push({
          ax: this.positions[ao], ay: this.positions[ao + 1], az: this.positions[ao + 2],
          bx: this.positions[bo], by: this.positions[bo + 1], bz: this.positions[bo + 2],
          r: 1, g: 0.62 * (1 - heat), b: 0.04, a: 0.88,
        });
        sampled++;
      }
    }

    this.segmentGrid.positions = this.positions;
    this.segmentGrid.frameVersion = this.frameVersion;
    this.frame.instanceCount = instanceCount;
    this.frame.brokenCount = this.brokenCountValue;
    this.frame.energy = this.energyValue;
    this.frame.hash = this.hashValue;
    this.frame.frameVersion = this.frameVersion;
    this.frame.material = this.telemetry;
    this.builtFrameVersion = this.frameVersion;
    this.builtFrameDebug = debug;
    return this.frame;
  }

  currentHash(): number {
    let hash = quantizedHash(this.positions);
    hash = quantizedHash(this.rest, hash);
    hash = quantizedHash(this.damage, hash);
    hash = quantizedHash(this.broken, hash);
    return hash === 0 ? 1 : hash;
  }

  destroy(): void {
    this.projectiles.length = 0;
    this.positions = new Float32Array(0);
    this.previous = new Float32Array(0);
  }
}
