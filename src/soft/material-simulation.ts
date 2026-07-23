import {
  LcgRng,
  clamp,
  writeAxisAlignedModelMatrix,
  writeModelMatrixFromEuler,
  type Vec3,
} from '../math';
import { getMaterialDemoRecipe, type MaterialDemoRecipe } from '../material-demos';
import type { ScenePreset } from '../scenes';
import type { DebugLine, MaterialFailureTelemetry, RopeGridFrame } from '../types';
import type { SoftSimulation, SoftSimulationFrame } from './simulations';
import { materialPresetForVariant, type MaterialBehaviorPreset } from './material-presets';

const MAX_PROJECTILES = 64;
const MAX_FIXTURE_INSTANCES = 512;
const MAX_MATERIAL_FRAGMENTS = 384;
const MAX_CPU_INSTANCES = MAX_PROJECTILES + MAX_FIXTURE_INSTANCES + MAX_MATERIAL_FRAGMENTS;
export const MATERIAL_RENDER_SEGMENT_BUDGET = 2400;
export const MATERIAL_RENDER_INSTANCE_BUDGET = MAX_CPU_INSTANCES + MATERIAL_RENDER_SEGMENT_BUDGET;
const TELEMETRY_INTERVAL = 8;

type Projectile = {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  life: number;
  color: readonly [number, number, number, number];
};

type MaterialFragment = {
  position: Vec3;
  velocity: Vec3;
  rotation: Vec3;
  angularVelocity: Vec3;
  half: Vec3;
  life: number;
  color: readonly [number, number, number, number];
};

type CrackEvent = { cell: number; delay: number; originStation: number; originLane: number; depth: number };

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
  reinforcement: boolean;
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

function normalizeAxis(x: number, y: number, z: number, fallback: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  return length > 1e-7 ? [x / length, y / length, z / length] : fallback;
}

function writeBasisModelMatrix(
  out: Float32Array,
  offset: number,
  position: Vec3,
  xAxis: Vec3,
  yAxis: Vec3,
  zAxis: Vec3,
  halfExtents: Vec3,
): void {
  out[offset] = xAxis[0] * halfExtents[0];
  out[offset + 1] = xAxis[1] * halfExtents[0];
  out[offset + 2] = xAxis[2] * halfExtents[0];
  out[offset + 3] = 0;
  out[offset + 4] = yAxis[0] * halfExtents[1];
  out[offset + 5] = yAxis[1] * halfExtents[1];
  out[offset + 6] = yAxis[2] * halfExtents[1];
  out[offset + 7] = 0;
  out[offset + 8] = zAxis[0] * halfExtents[2];
  out[offset + 9] = zAxis[1] * halfExtents[2];
  out[offset + 10] = zAxis[2] * halfExtents[2];
  out[offset + 11] = 0;
  out[offset + 12] = position[0];
  out[offset + 13] = position[1];
  out[offset + 14] = position[2];
  out[offset + 15] = 1;
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

  private readonly recipe: MaterialDemoRecipe | null;
  private readonly profile: MaterialBehaviorPreset;
  private readonly mode: number;
  private readonly dentRig: boolean;
  private readonly concreteRig: boolean;
  private readonly glassRig: boolean;
  private readonly verticalRig: boolean;
  private readonly sheetRig: boolean;
  private readonly stress: number;
  private readonly rng: LcgRng;
  private readonly stations: number;
  private readonly lanes: number;
  private readonly nodeCountValue: number;
  private readonly span: number;
  private readonly depth: number;
  private readonly baseY = 7.2;
  private positions: Float32Array;
  private previous: Float32Array;
  private readonly restPositions: Float32Array;
  private readonly invMass: Float32Array;
  private readonly pinned: Uint8Array;
  private readonly loadWeights: Float32Array;
  private readonly loadSigns: Int8Array;

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
  private readonly reinforcement: Uint8Array;
  private readonly failedCells: Uint8Array;
  private readonly queuedCrackCells: Uint8Array;
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
  private readonly fragments: MaterialFragment[] = [];
  private readonly crackEvents: CrackEvent[] = [];
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
  private fracturedCellCountValue = 0;
  private reinforcementCountValue = 0;
  private peakDamageValue = 0;
  private maxStrainValue = 0;
  private peakDeflectionValue = 0;
  private residualDentValue = 0;
  private energyValue = 0;
  private hashValue = 1;

  constructor(scene: ScenePreset, stress: number, seed: number) {
    this.recipe = getMaterialDemoRecipe(scene.materialDemoId);
    this.profile = materialPresetForVariant(this.recipe?.profileVariant ?? scene.variant);
    this.mode = scene.mode;
    this.dentRig = this.recipe ? this.recipe.kind === 'metal' : scene.mode === 3 && scene.variant <= 2;
    this.concreteRig = this.recipe ? this.recipe.kind === 'concrete' : scene.mode === 4 && scene.variant === 5;
    this.glassRig = this.recipe ? this.recipe.kind === 'glass' : scene.mode === 4 && scene.variant === 6;
    this.verticalRig = this.glassRig || this.recipe?.orientation === 'vertical';
    this.sheetRig = this.recipe ? this.recipe.kind === 'metal' : this.dentRig || (scene.mode === 4 && scene.variant <= 2);
    this.stress = clamp(Math.round(stress), 1, 5);
    this.rng = new LcgRng((seed ^ 0xf4ac7e31) >>> 0);
    this.stations = Math.min(48, this.recipe?.stations ?? (24 + this.stress * 4 + (scene.mode >= 3 ? 4 : 0)));
    this.lanes = Math.min(15, this.recipe?.lanes ?? (this.glassRig
      ? 13
      : this.concreteRig
        ? 9
        : this.dentRig
          ? 11
          : Math.min(7, 3 + (scene.variant % 3) + (scene.mode === 4 ? 1 : 0))));
    this.nodeCountValue = this.stations * this.lanes;
    this.span = this.recipe?.span ?? 24;
    this.depth = this.recipe?.depth ?? (this.glassRig ? 8.6 : 3.2 + this.lanes * 0.55);
    this.positions = new Float32Array(this.nodeCountValue * 3);
    this.previous = new Float32Array(this.nodeCountValue * 3);
    this.restPositions = new Float32Array(this.nodeCountValue * 3);
    this.invMass = new Float32Array(this.nodeCountValue);
    this.pinned = new Uint8Array(this.nodeCountValue);
    this.loadWeights = new Float32Array(this.nodeCountValue);
    this.loadSigns = new Int8Array(this.nodeCountValue);
    this.initializeNodes();
    this.initializeLoadField();

    const seeds = this.buildConstraintSeeds(this.recipe?.profileVariant ?? scene.variant);
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
    this.reinforcement = new Uint8Array(seeds.length);
    this.failedCells = new Uint8Array(Math.max(1, (this.stations - 1) * this.lanes));
    this.queuedCrackCells = new Uint8Array(this.failedCells.length);
    for (let i = 0; i < seeds.length; i++) this.writeConstraint(i, seeds[i]);
    for (let i = 0; i < this.reinforcement.length; i++) this.reinforcementCountValue += this.reinforcement[i];

    const renderCapacity = Math.min(MATERIAL_RENDER_SEGMENT_BUDGET, seeds.reduce((sum, value) => sum + (value.render ? 1 : 0), 0));
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
    this.loadTarget = this.recipe?.primaryLoad ?? defaultTargets[this.mode] ?? 0.8;
    this.cycleEnabled = this.recipe?.fixtureStyle === 'fatigue' || (!this.recipe && (this.mode === 1 || this.mode === 4));
    const testModes = ['three-point bend', 'cyclic overload', 'precision displacement ramp', 'instrumented dent and impact', 'cinematic yield-to-fracture'] as const;
    this.telemetry = {
      label: this.recipe?.title ?? this.profile.label,
      testMode: this.recipe
        ? `${this.recipe.fixtureStyle} · ${this.recipe.loadPattern} load · ${failureModeLabel(this.profile)}`
        : `${testModes[this.mode] ?? testModes[0]} · ${failureModeLabel(this.profile)}`,
      loadTarget: this.loadTarget,
      loadProgress: 0,
      maxStrain: 0,
      yieldStrain: this.profile.tensileYieldStrain * (this.concreteRig ? 1.8 * 0.68 : 1),
      breakStrain: this.profile.tensileBreakStrain * (this.concreteRig ? 3.2 * 0.68 : 1),
      yieldedCount: 0,
      damagedCount: 0,
      peakDamage: 0,
      centerDeflection: 0,
      peakDeflection: 0,
      residualDent: 0,
      fracturedCellCount: 0,
      fragmentCount: 0,
      reinforcementCount: this.reinforcementCountValue,
      failurePhase: 'elastic',
    };
    this.label = this.recipe
      ? `${this.recipe.title} · deterministic ${this.recipe.kind} presentation`
      : `${this.profile.label} · normalized beam-lattice failure rig`;
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

  private targetStation(value = this.recipe?.strikeCenter[0] ?? 0.5): number {
    return clamp(Math.round(value * (this.stations - 1)), 1, this.stations - 2);
  }

  private targetLane(value = this.recipe?.strikeCenter[1] ?? 0.5): number {
    return clamp(Math.round(value * (this.lanes - 1)), 1, this.lanes - 2);
  }

  private initializeLoadField(): void {
    if (!this.recipe) return;
    const radiusU = Math.max(0.025, this.recipe.loadRadius[0]);
    const radiusV = Math.max(0.025, this.recipe.loadRadius[1]);
    const centerU = this.recipe.loadCenter[0];
    const centerV = this.recipe.loadCenter[1];
    const patch = (u: number, v: number, patchU: number, patchV: number, ru = radiusU, rv = radiusV): number => {
      const radial = Math.hypot((u - patchU) / ru, (v - patchV) / rv);
      const linear = Math.max(0, 1 - radial);
      return linear * linear * (3 - 2 * linear);
    };
    const dualU = clamp(this.recipe.strikeCenter[0], 0.02, 0.98);
    const mirrorU = clamp(centerU * 2 - dualU, 0.02, 0.98);
    const dualV = clamp(this.recipe.strikeCenter[1], 0.02, 0.98);
    const mirrorV = clamp(centerV * 2 - dualV, 0.02, 0.98);
    for (let station = 0; station < this.stations; station++) {
      const u = station / Math.max(1, this.stations - 1);
      for (let lane = 0; lane < this.lanes; lane++) {
        const v = lane / Math.max(1, this.lanes - 1);
        let weight: number;
        switch (this.recipe.loadPattern) {
          case 'dual':
            weight = Math.max(patch(u, v, dualU, dualV), patch(u, v, mirrorU, mirrorV));
            break;
          case 'line': {
            const linear = Math.max(0, 1 - Math.abs(u - centerU) / radiusU);
            weight = linear * linear * (3 - 2 * linear);
            break;
          }
          case 'distributed':
            weight = 0.22 + 0.78 * patch(u, v, centerU, centerV, Math.max(radiusU, 0.72), Math.max(radiusV, 0.72));
            break;
          case 'torsion':
            weight = 0.35 + 0.65 * patch(u, v, centerU, centerV, Math.max(radiusU, 0.62), Math.max(radiusV, 0.62));
            break;
          default:
            weight = patch(u, v, centerU, centerV);
            break;
        }
        const index = this.node(station, lane);
        this.loadWeights[index] = weight;
        this.loadSigns[index] = this.recipe.loadPattern === 'torsion'
          ? ((u - centerU) * (v - centerV) >= 0 ? 1 : -1)
          : (this.recipe.loadSign ?? -1);
      }
    }
  }

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
        const crossPosition = -this.depth * 0.5 + lane * laneStep;
        const camber = Math.sin(Math.PI * t) * 0.035;
        this.positions[offset] = x;
        this.positions[offset + 1] = this.verticalRig ? this.baseY + crossPosition : this.baseY + camber;
        this.positions[offset + 2] = this.verticalRig ? 0 : crossPosition;
        const boundary = this.recipe?.boundary;
        const atStationEnd = station === 0 || station === this.stations - 1;
        const atLaneEnd = lane === 0 || lane === this.lanes - 1;
        const support = boundary === 'cantilever'
          ? station <= 1
          : boundary === 'four-corner'
            ? atStationEnd && atLaneEnd
            : boundary === 'end-clamped'
              ? station <= 1 || station >= this.stations - 2
              : boundary === 'simple-span'
              ? atStationEnd
              : boundary === 'perimeter'
                ? atStationEnd || atLaneEnd
                : this.dentRig || this.glassRig
                  ? atStationEnd || atLaneEnd
                  : atStationEnd;
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
      reinforcement = false,
    ): void => {
      const ao = a * 3;
      const bo = b * 3;
      const dx = this.positions[bo] - this.positions[ao];
      const dy = this.positions[bo + 1] - this.positions[ao + 1];
      const dz = this.positions[bo + 2] - this.positions[ao + 2];
      const rest = Math.hypot(dx, dy, dz);
      if (!(rest > 1e-6)) return;
      const brittleNotchStation = this.targetStation(this.recipe?.strikeCenter[0] ?? 0.5);
      const brittleNotch = (variant === 5 || variant === 6 || variant === 9) &&
        cohesiveCell >= 0 && Math.abs(Math.floor(cohesiveCell / this.lanes) - brittleNotchStation) <= 1;
      const notchScale = brittleNotch ? 0.68 : 1;
      const matrixYieldScale = this.concreteRig && !reinforcement ? 1.8 : 1;
      const matrixBreakScale = this.concreteRig && !reinforcement ? 3.2 : 1;
      // The lattice is a solver, not a visible material. Signature sheet,
      // glass, and concrete rigs render a continuous deformed skin; only
      // actual reinforcement remains visible inside fractured concrete.
      const visibleConstraint = this.sheetRig || this.glassRig || this.concreteRig
        ? reinforcement
        : render;
      result.push({
        a, b, rest,
        stiffness: 1 - Math.pow(1 - clamp(reinforcement ? 0.988 : stiffness, 0.02, 0.999), 1 / iterations),
        tensileYield: reinforcement ? 0.022 : this.profile.tensileYieldStrain * thresholdScale * notchScale * matrixYieldScale,
        tensileBreak: reinforcement ? 0.165 : this.profile.tensileBreakStrain * thresholdScale * notchScale * matrixBreakScale,
        compressionYield: reinforcement ? 0.026 : this.profile.compressionYieldStrain * thresholdScale * matrixYieldScale,
        compressionBreak: reinforcement ? 0.18 : this.profile.compressionBreakStrain * thresholdScale * matrixBreakScale,
        plasticCreep: reinforcement ? 0.16 : this.profile.plasticCreep,
        damageRate: reinforcement ? 0.48 : this.profile.damageRate,
        fatigueRate: reinforcement ? 0.09 : this.profile.fatigueRate,
        render: visibleConstraint,
        radius: reinforcement ? 0.082 : radius,
        cohesiveCell: reinforcement ? -1 : cohesiveCell,
        reinforcement,
      });
    };

    for (let station = 0; station < this.stations; station++) {
      for (let lane = 0; lane < this.lanes; lane++) {
        const current = this.node(station, lane);
        if (station + 1 < this.stations) {
          const cell = station * this.lanes + lane;
          add(current, this.node(station + 1, lane), this.profile.axialStiffness, 1, true, 0.095, cell);
          if (this.concreteRig && (lane === 2 || lane === this.lanes - 3 || (this.recipe?.crackStyle === 'cone' && lane === Math.floor(this.lanes * 0.5)))) {
            add(current, this.node(station + 1, lane), 0.99, 1, true, 0.082, -1, true);
          }
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
    if (this.concreteRig) {
      for (let station = 2; station < this.stations - 1; station += 4) {
        add(this.node(station, 2), this.node(station, this.lanes - 3), 0.96, 1, true, 0.068, -1, true);
        if (this.recipe?.crackStyle === 'cone' && this.lanes >= 11) {
          add(this.node(station, Math.floor(this.lanes * 0.5) - 2), this.node(station, Math.floor(this.lanes * 0.5) + 2), 0.96, 1, true, 0.064, -1, true);
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
    this.reinforcement[index] = seed.reinforcement ? 1 : 0;
  }

  step(dt: number, subSteps: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const steps = Math.max(1, Math.min(8, Math.round(subSteps)));
    const stepDt = Math.min(dt, 1 / 30) / steps;
    for (let subStep = 0; subStep < steps; subStep++) {
      this.time += stepDt;
      this.updateLoad(stepDt);
      this.advanceCrackFront(stepDt);
      this.integrateProjectiles(stepDt);
      this.integrateFragments(stepDt);
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
    const halfBand = Math.max(1.5, this.stations * (this.dentRig ? 0.16 : 0.075));
    const loadAcceleration = this.loadProgress * (38 + this.stress * 8) * (this.recipe?.loadScale ?? 1) /
      Math.max(0.18, this.profile.densityScale);
    const lateralLoad = !this.recipe && this.mode === 4 ? Math.sin(this.time * 1.1) * this.loadProgress * 5 : 0;
    for (let station = 0; station < this.stations; station++) {
      const distanceToCenter = Math.abs(station - center);
      for (let lane = 0; lane < this.lanes; lane++) {
        const index = this.node(station, lane);
        if (this.pinned[index] !== 0) continue;
        const spanWeight = distanceToCenter <= halfBand ? 1 - distanceToCenter / (halfBand + 0.001) : 0;
        const laneCenter = (this.lanes - 1) * 0.5;
        const laneRadius = Math.max(1, this.lanes * 0.38);
        const radialDistance = Math.hypot(distanceToCenter / halfBand, Math.abs(lane - laneCenter) / laneRadius);
        const dentWeight = Math.max(0, 1 - radialDistance);
        // The instrumented metal panel combines a modest global bend with a
        // concentrated indenter footprint. Other modes retain the original
        // three-point load band for directly comparable material tests.
        const loadWeight = this.recipe ? this.loadWeights[index] : this.dentRig ? Math.max(spanWeight * 0.16, dentWeight) : spanWeight;
        const loadSign = this.recipe ? this.loadSigns[index] || -1 : -1;
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
        this.positions[offset] = x + vx + (lateralLoad + (this.recipe?.loadPattern === 'torsion' ? loadSign * loadAcceleration * 0.08 : 0)) * loadWeight * dt2;
        this.positions[offset + 1] = y + vy - 9.81 * dt2;
        this.positions[offset + 2] = z + vz;
        if (this.verticalRig) {
          this.positions[offset + 2] += loadAcceleration * loadWeight * loadSign * 0.72 * dt2;
        } else {
          this.positions[offset + 1] += loadAcceleration * loadWeight * loadSign * dt2;
        }
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
    if (this.reinforcement[index] !== 0) this.reinforcementCountValue--;
    this.damage[index] = 1;
    this.peakDamageValue = 1;
    this.brokenCountValue++;
    this.telemetryCountdown = 0;
    this.segmentMetadataDirty = true;
  }

  private breakCohesiveCell(
    cell: number,
    originStation = this.targetStation(),
    originLane = this.targetLane(),
    crackDepth = 0,
  ): void {
    if (cell < 0 || cell >= this.failedCells.length || this.failedCells[cell] !== 0) return;
    this.failedCells[cell] = 1;
    this.queuedCrackCells[cell] = 0;
    this.fracturedCellCountValue++;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.cohesiveCell[i] === cell) this.breakConstraint(i);
    }
    if (this.concreteRig) this.emitFragments(cell, 'concrete');
    if (this.glassRig) {
      this.emitFragments(cell, 'glass');
      this.queueGlassCrackNeighbors(cell, originStation, originLane, crackDepth);
    }
  }

  private queueGlassCrackNeighbors(cell: number, originStation: number, originLane: number, crackDepth: number): void {
    const station = Math.floor(cell / this.lanes);
    const lane = cell % this.lanes;
    const centerStation = originStation;
    const centerLane = originLane;
    const directionStation = Math.sign(station - centerStation);
    const directionLane = Math.sign(lane - centerLane);
    const allNeighbors: readonly (readonly [number, number])[] = [
      [station - 1, lane], [station + 1, lane], [station, lane - 1], [station, lane + 1],
      [station - 1, lane - 1], [station - 1, lane + 1], [station + 1, lane - 1], [station + 1, lane + 1],
    ];
    const radialNeighbors: readonly (readonly [number, number])[] = directionStation === 0 && directionLane === 0
      ? [
          ...allNeighbors,
        ]
      : directionStation !== 0 && directionLane !== 0
        ? [[station + directionStation, lane + directionLane]]
        : directionStation !== 0
          ? [[station + directionStation, lane]]
          : [[station, lane + directionLane]];
    const style = this.recipe?.crackStyle ?? 'radial';
    const maxDepth = style === 'dense' ? 7 : style === 'retained' ? 10 : 18;
    if (crackDepth >= maxDepth) return;
    const inwardStation = Math.sign((this.stations - 1) * 0.5 - originStation);
    const inwardLane = Math.sign((this.lanes - 1) * 0.5 - originLane);
    const neighbors: readonly (readonly [number, number])[] = style === 'dense'
      ? allNeighbors
      : style === 'diagonal'
        ? crackDepth === 0
          ? [[station - 1, lane - 1], [station + 1, lane + 1], [station - 1, lane + 1], [station + 1, lane - 1]]
          : [[station + (directionStation || 1), lane + (directionLane || 1)]]
        : style === 'edge'
          ? crackDepth === 0
            ? [[station + inwardStation, lane + inwardLane], [station + inwardStation, lane - 1], [station + inwardStation, lane + 1]]
            : [...radialNeighbors, [station + directionStation, lane - 1], [station + directionStation, lane + 1]]
          : radialNeighbors;
    for (const [nextStation, nextLane] of neighbors) {
      // Leave a two-cell perimeter visually intact inside the metal frame.
      if (nextStation <= 1 || nextStation >= this.stations - 3 || nextLane <= 1 || nextLane >= this.lanes - 2) continue;
      const nextCell = nextStation * this.lanes + nextLane;
      if (this.failedCells[nextCell] !== 0 || this.queuedCrackCells[nextCell] !== 0) continue;
      this.queuedCrackCells[nextCell] = 1;
      const distance = Math.abs(nextStation - centerStation) + Math.abs(nextLane - centerLane);
      const baseDelay = style === 'dense' ? 0.010 : style === 'retained' ? 0.032 : 0.020;
      this.crackEvents.push({
        cell: nextCell,
        delay: baseDelay + (distance % 4) * 0.006,
        originStation,
        originLane,
        depth: crackDepth + 1,
      });
    }
  }

  private advanceCrackFront(dt: number): void {
    const initialCount = this.crackEvents.length;
    for (let i = initialCount - 1; i >= 0; i--) {
      const event = this.crackEvents[i];
      event.delay -= dt;
      if (event.delay > 0) continue;
      this.crackEvents.splice(i, 1);
      this.breakCohesiveCell(event.cell, event.originStation, event.originLane, event.depth);
    }
  }

  private emitFragments(cell: number, kind: 'concrete' | 'glass'): void {
    if (this.fragments.length >= MAX_MATERIAL_FRAGMENTS) return;
    const station = Math.min(this.stations - 2, Math.max(0, Math.floor(cell / this.lanes)));
    const lane = Math.min(this.lanes - 1, Math.max(0, cell % this.lanes));
    const aOffset = this.node(station, lane) * 3;
    const bOffset = this.node(station + 1, lane) * 3;
    const origin: Vec3 = [
      (this.positions[aOffset] + this.positions[bOffset]) * 0.5,
      (this.positions[aOffset + 1] + this.positions[bOffset + 1]) * 0.5,
      (this.positions[aOffset + 2] + this.positions[bOffset + 2]) * 0.5,
    ];
    const style = this.recipe?.crackStyle;
    const count = kind === 'glass'
      ? style === 'dense' ? 3 : style === 'retained' ? 1 : 4
      : style === 'cone' ? 5 : 3;
    for (let i = 0; i < count && this.fragments.length < MAX_MATERIAL_FRAGMENTS; i++) {
      const outward = kind === 'glass' ? (cell & 1 ? 1 : -1) : this.rng.signed(1);
      const half: Vec3 = kind === 'glass'
        ? [this.rng.range(0.16, 0.42), this.rng.range(0.05, 0.20), this.rng.range(0.010, 0.026)]
        : [this.rng.range(0.09, 0.31), this.rng.range(0.06, 0.22), this.rng.range(0.08, 0.28)];
      this.fragments.push({
        position: [origin[0] + this.rng.signed(0.16), origin[1] + this.rng.signed(0.12), origin[2] + this.rng.signed(0.10)],
        velocity: kind === 'glass'
          ? style === 'retained'
            ? [this.rng.signed(0.65), this.rng.range(-0.2, 0.65), outward * this.rng.range(0.25, 0.85)]
            : [this.rng.signed(3.2), this.rng.range(-0.5, 3.8), outward * this.rng.range(2.4, 7.0)]
          : [this.rng.signed(3.8), this.rng.range(1.5, 6.4), this.rng.signed(2.6)],
        rotation: [this.rng.range(0, Math.PI), this.rng.range(0, Math.PI), this.rng.range(0, Math.PI)],
        angularVelocity: [this.rng.signed(5), this.rng.signed(5), this.rng.signed(5)],
        half,
        life: 22,
        color: kind === 'glass'
          ? [0.38, 0.78, 0.90, -4]
          : i % 3 === 0
            ? [0.20, 0.19, 0.17, -5]
            : [0.46, 0.46, 0.43, -1],
      });
    }
  }

  private integrateFragments(dt: number): void {
    let write = 0;
    for (let read = 0; read < this.fragments.length; read++) {
      const fragment = this.fragments[read];
      fragment.life -= dt;
      fragment.velocity[1] -= 9.81 * dt;
      fragment.position[0] += fragment.velocity[0] * dt;
      fragment.position[1] += fragment.velocity[1] * dt;
      fragment.position[2] += fragment.velocity[2] * dt;
      fragment.rotation[0] += fragment.angularVelocity[0] * dt;
      fragment.rotation[1] += fragment.angularVelocity[1] * dt;
      fragment.rotation[2] += fragment.angularVelocity[2] * dt;
      const catchSurface = this.concreteRig || this.glassRig ? 0.41 : 0;
      if (fragment.position[1] < catchSurface + fragment.half[1]) {
        fragment.position[1] = catchSurface + fragment.half[1];
        fragment.velocity[0] *= 0.72;
        fragment.velocity[1] = Math.abs(fragment.velocity[1]) * 0.24;
        fragment.velocity[2] *= 0.72;
        fragment.angularVelocity[0] *= 0.78;
        fragment.angularVelocity[1] *= 0.78;
        fragment.angularVelocity[2] *= 0.78;
      }
      if (fragment.life > 0) this.fragments[write++] = fragment;
    }
    this.fragments.length = write;
  }

  private refreshSegmentMetadata(advanceVersion = true): void {
    if (!this.segmentMetadataDirty) return;
    let count = 0;
    for (let i = 0; i < this.constraintCountValue && count < MATERIAL_RENDER_SEGMENT_BUDGET; i++) {
      if (this.render[i] === 0 || this.broken[i] !== 0) continue;
      const target = count * 8;
      const heat = clamp(this.damage[i] * 1.2, 0, 1);
      const base = this.reinforcement[i] !== 0
        ? ([0.45, 0.54, 0.63, -2] as const)
        : this.profile.baseColor;
      this.segmentData[target] = this.a[i];
      this.segmentData[target + 1] = this.b[i];
      this.segmentData[target + 2] = 1 / Math.max(1e-7, this.rest[i]);
      this.segmentData[target + 3] = this.radius[i];
      this.segmentData[target + 4] = base[0] + (1 - base[0]) * heat * 0.62;
      this.segmentData[target + 5] = base[1] * (1 - heat * 0.58) + 0.25 * heat;
      this.segmentData[target + 6] = base[2] * (1 - heat * 0.78) + 0.03 * heat;
      // Negative alpha values are stable renderer material IDs. Preserve them
      // through damage visualization; positive alpha retains emissive heat.
      this.segmentData[target + 7] = base[3] < 0 ? base[3] : Math.max(1, base[3]) + heat * 0.65;
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
        if (this.verticalRig) {
          this.previous[offset + 2] += impulse * weight;
          this.previous[offset + 1] -= this.rng.signed(impulse * 0.12) * weight;
        } else {
          this.previous[offset + 1] += impulse * weight;
          this.previous[offset + 2] -= this.rng.signed(impulse * 0.18) * weight;
        }
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

  dentStrike(strength: number): number {
    if (!this.dentRig) return -1;
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 1, 0.25, 2);
    const centerStation = this.targetStation();
    const centerLane = this.targetLane();
    const stationRadius = Math.max(2, this.stations * (this.recipe?.loadRadius[0] ?? 0.13));
    const laneRadius = Math.max(2, this.lanes * (this.recipe?.loadRadius[1] ?? 0.34));
    for (let station = 1; station < this.stations - 1; station++) {
      for (let lane = 1; lane < this.lanes - 1; lane++) {
        const index = this.node(station, lane);
        if (this.pinned[index] !== 0) continue;
        const distance = Math.hypot(
          (station - centerStation) / stationRadius,
          (lane - centerLane) / laneRadius,
        );
        const weight = Math.max(0, 1 - distance);
        if (weight <= 0) continue;
        const offset = index * 3;
        // Verlet velocity is current minus previous. Move the previous point
        // opposite the authored surface-normal direction to create impact.
        const sign = this.recipe ? this.loadSigns[index] || -1 : -1;
        if (this.verticalRig) this.previous[offset + 2] -= sign * weight * (0.11 + safeStrength * 0.16);
        else this.previous[offset + 1] -= sign * weight * (0.11 + safeStrength * 0.16);
        this.previous[offset] -= (station - centerStation) * weight * safeStrength * 0.003;
        if (this.verticalRig) this.previous[offset + 1] -= (lane - centerLane) * weight * safeStrength * 0.007;
        else this.previous[offset + 2] -= (lane - centerLane) * weight * safeStrength * 0.007;
      }
    }
    const centerNode = this.node(centerStation, centerLane);
    this.damageNearNode(centerNode, 0.10 + safeStrength * 0.12);
    this.telemetryCountdown = 0;
    this.frameVersion++;
    return centerNode;
  }

  materialStrike(strength: number): number {
    if (this.dentRig) return this.dentStrike(strength);
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 1, 0.25, 2);
    const multiHit = this.recipe?.id === 'glass-hail-multi-hit' && this.fracturedCellCountValue > 0;
    const centerStation = this.targetStation(multiHit ? 1 - this.recipe!.strikeCenter[0] : undefined);
    const centerLane = this.targetLane(multiHit ? 1 - this.recipe!.strikeCenter[1] : undefined);
    const centerNode = this.node(centerStation, centerLane);
    const offset = centerNode * 3;
    if (this.glassRig) {
      const sign = this.recipe ? this.loadSigns[centerNode] || -1 : -1;
      this.previous[offset + 2] -= sign * (0.28 + safeStrength * 0.42);
      let cell = Math.min(this.failedCells.length - 1, centerStation * this.lanes + centerLane);
      if (this.failedCells[cell] !== 0) {
        outer: for (let radius = 1; radius <= 4; radius++) {
          for (let stationOffset = -radius; stationOffset <= radius; stationOffset++) {
            const laneDistance = radius - Math.abs(stationOffset);
            for (const laneOffset of laneDistance === 0 ? [0] : [-laneDistance, laneDistance]) {
              const station = centerStation + stationOffset;
              const lane = centerLane + laneOffset;
              if (station <= 1 || station >= this.stations - 2 || lane <= 1 || lane >= this.lanes - 2) continue;
              const candidate = station * this.lanes + lane;
              if (this.failedCells[candidate] === 0) {
                cell = candidate;
                break outer;
              }
            }
          }
        }
      }
      this.breakCohesiveCell(cell, centerStation, centerLane, 0);
    } else {
      const sign = this.recipe ? this.loadSigns[centerNode] || -1 : -1;
      if (this.verticalRig) this.previous[offset + 2] -= sign * (0.18 + safeStrength * 0.32);
      else this.previous[offset + 1] -= sign * (0.18 + safeStrength * 0.32);
      this.damageNearNode(centerNode, 0.20 + safeStrength * 0.32);
      if (this.concreteRig && safeStrength >= 0.7) {
        const style = this.recipe?.crackStyle ?? 'local';
        const offsets: [number, number][] = [[0, 0]];
        if (safeStrength >= 1.0 || style !== 'local') {
          if (style === 'diagonal') offsets.push([-1, -1], [1, 1], [-2, -2], [2, 2]);
          else offsets.push([-1, 0], [1, 0]);
        }
        if (safeStrength >= 1.25 || style === 'cone' || style === 'radial') {
          offsets.push([0, -1], [0, 1], [-2, 0], [2, 0]);
          if (style === 'cone') offsets.push([-1, -1], [-1, 1], [1, -1], [1, 1], [0, -2], [0, 2]);
        }
        for (const [stationOffset, laneOffset] of offsets) {
          const targetStation = centerStation + stationOffset;
          const targetLane = centerLane + laneOffset;
          if (targetStation <= 1 || targetStation >= this.stations - 2 || targetLane <= 0 || targetLane >= this.lanes - 1) continue;
          this.breakCohesiveCell(targetStation * this.lanes + targetLane);
        }
      }
    }
    this.telemetryCountdown = 0;
    this.frameVersion++;
    return centerNode;
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
    this.telemetry.fracturedCellCount = this.fracturedCellCountValue;
    this.telemetry.fragmentCount = this.fragments.length;
    this.telemetry.reinforcementCount = this.reinforcementCountValue;
    let centerDisplacement = this.verticalRig ? 0 : Number.POSITIVE_INFINITY;
    const centerStation = (this.recipe?.loadCenter[0] ?? 0.5) * (this.stations - 1);
    const centerLane = (this.recipe?.loadCenter[1] ?? 0.5) * (this.lanes - 1);
    for (let station = 0; station < this.stations; station++) {
      if (Math.abs(station - centerStation) > Math.max(1, this.stations * 0.08)) continue;
      for (let lane = 0; lane < this.lanes; lane++) {
        if (Math.abs(lane - centerLane) > Math.max(1, this.lanes * 0.18)) continue;
        const offset = this.node(station, lane) * 3;
        if (this.verticalRig) centerDisplacement = Math.max(centerDisplacement, Math.abs(this.positions[offset + 2] - this.restPositions[offset + 2]));
        else centerDisplacement = Math.min(centerDisplacement, this.positions[offset + 1]);
      }
    }
    const centerDeflection = this.verticalRig
      ? Math.min(centerDisplacement, this.depth * 0.5)
      : Number.isFinite(centerDisplacement) ? Math.max(0, this.baseY - centerDisplacement) : 0;
    this.peakDeflectionValue = Math.max(this.peakDeflectionValue, centerDeflection);
    if (this.loadProgress <= 0.05 && this.peakDeflectionValue > 0.05) {
      this.residualDentValue = centerDeflection;
    }
    this.telemetry.centerDeflection = centerDeflection;
    this.telemetry.peakDeflection = this.peakDeflectionValue;
    this.telemetry.residualDent = this.residualDentValue;
    this.telemetry.failurePhase = this.brokenCountValue > Math.max(8, this.constraintCountValue * 0.18)
      ? 'failed'
      : this.brokenCountValue > 0
        ? 'fracturing'
        : this.yieldedCountValue > 0
          ? 'yielding'
          : 'elastic';
    this.telemetryCountdown = TELEMETRY_INTERVAL;
  }

  private writePanelSkinTiles(startIndex: number): number {
    if (!this.sheetRig && !this.concreteRig && !this.glassRig) return startIndex;
    let instanceCount = startIndex;
    const stationPatch = this.concreteRig ? 3 : 2;
    const lanePatch = 1;
    const color = this.glassRig
      ? ([0.30, 0.72, 0.83, -4] as const)
      : this.concreteRig
        ? ([0.43, 0.43, 0.41, -1] as const)
        : this.profile.baseColor;
    for (let station = 0; station < this.stations - 1 && instanceCount < MAX_FIXTURE_INSTANCES; station += stationPatch) {
      const endStation = Math.min(this.stations - 1, station + stationPatch);
      for (let lane = 0; lane < this.lanes - 1 && instanceCount < MAX_FIXTURE_INSTANCES; lane += lanePatch) {
        const endLane = Math.min(this.lanes - 1, lane + lanePatch);
        let fractured = false;
        for (let s = station; s < endStation && !fractured; s++) {
          for (let l = lane; l < endLane; l++) {
            if (this.failedCells[s * this.lanes + l] !== 0) { fractured = true; break; }
          }
        }
        if (fractured && this.recipe?.crackStyle !== 'retained') continue;
        const corners = [
          this.node(station, lane), this.node(endStation, lane),
          this.node(station, endLane), this.node(endStation, endLane),
        ] as const;
        const center: Vec3 = [0, 0, 0];
        for (const node of corners) {
          const offset = node * 3;
          center[0] += this.positions[offset] * 0.25;
          center[1] += this.positions[offset + 1] * 0.25;
          center[2] += this.positions[offset + 2] * 0.25;
        }
        const p0 = corners[0] * 3;
        const p1 = corners[1] * 3;
        const p2 = corners[2] * 3;
        const p3 = corners[3] * 3;
        const stationVector: Vec3 = [
          ((this.positions[p1] - this.positions[p0]) + (this.positions[p3] - this.positions[p2])) * 0.5,
          ((this.positions[p1 + 1] - this.positions[p0 + 1]) + (this.positions[p3 + 1] - this.positions[p2 + 1])) * 0.5,
          ((this.positions[p1 + 2] - this.positions[p0 + 2]) + (this.positions[p3 + 2] - this.positions[p2 + 2])) * 0.5,
        ];
        const laneVector: Vec3 = [
          ((this.positions[p2] - this.positions[p0]) + (this.positions[p3] - this.positions[p1])) * 0.5,
          ((this.positions[p2 + 1] - this.positions[p0 + 1]) + (this.positions[p3 + 1] - this.positions[p1 + 1])) * 0.5,
          ((this.positions[p2 + 2] - this.positions[p0 + 2]) + (this.positions[p3 + 2] - this.positions[p1 + 2])) * 0.5,
        ];
        const xAxis = normalizeAxis(stationVector[0], stationVector[1], stationVector[2], [1, 0, 0]);
        const laneDotX = laneVector[0] * xAxis[0] + laneVector[1] * xAxis[1] + laneVector[2] * xAxis[2];
        const laneAxis = normalizeAxis(
          laneVector[0] - xAxis[0] * laneDotX,
          laneVector[1] - xAxis[1] * laneDotX,
          laneVector[2] - xAxis[2] * laneDotX,
          this.glassRig ? [0, 1, 0] : [0, 0, 1],
        );
        const tileScale = this.glassRig ? 0.496 : 0.505;
        const xHalf = Math.max(0.05, Math.hypot(...stationVector) * tileScale);
        const laneHalf = Math.max(0.05, Math.hypot(...laneVector) * tileScale);
        if (this.verticalRig) {
          const zAxis = normalizeAxis(
            xAxis[1] * laneAxis[2] - xAxis[2] * laneAxis[1],
            xAxis[2] * laneAxis[0] - xAxis[0] * laneAxis[2],
            xAxis[0] * laneAxis[1] - xAxis[1] * laneAxis[0],
            [0, 0, 1],
          );
          writeBasisModelMatrix(this.matrices, instanceCount * 16, center, xAxis, laneAxis, zAxis, [xHalf, laneHalf, this.glassRig ? 0.007 : this.concreteRig ? 0.11 : 0.018]);
        } else {
          const yAxis = normalizeAxis(
            laneAxis[1] * xAxis[2] - laneAxis[2] * xAxis[1],
            laneAxis[2] * xAxis[0] - laneAxis[0] * xAxis[2],
            laneAxis[0] * xAxis[1] - laneAxis[1] * xAxis[0],
            [0, 1, 0],
          );
          writeBasisModelMatrix(
            this.matrices,
            instanceCount * 16,
            center,
            xAxis,
            yAxis,
            laneAxis,
            [xHalf, this.concreteRig ? 0.11 : 0.018, laneHalf],
          );
        }
        setColor(this.colors, instanceCount++, color);
      }
    }
    return instanceCount;
  }

  private writeFailureAccents(startIndex: number): number {
    let instanceCount = startIndex;
    if (this.dentRig && this.yieldedCountValue > 0) {
      const centerStation = this.targetStation();
      const centerLane = this.targetLane();
      for (let laneOffset = -3; laneOffset <= 3 && instanceCount < MAX_FIXTURE_INSTANCES; laneOffset++) {
        const lane = clamp(centerLane + laneOffset, 1, this.lanes - 2);
        const node = this.node(centerStation, lane);
        const offset = node * 3;
        const demand = clamp(this.peakDamageValue * 0.72 + this.yieldedCountValue / Math.max(1, this.constraintCountValue) * 3.5, 0.12, 1);
        writeAxisAlignedModelMatrix(
          this.matrices,
          instanceCount * 16,
          this.verticalRig
            ? [this.positions[offset], this.positions[offset + 1], this.positions[offset + 2] + 0.075]
            : [this.positions[offset], this.positions[offset + 1] + 0.075, this.positions[offset + 2]],
          0.34,
          this.verticalRig ? 0.035 : 0.018,
          this.verticalRig ? 0.018 : 0.035,
        );
        // Cold forming leaves a restrained witness band, not a glowing heat
        // stripe. The galvanized material tag keeps the anisotropic metal PBR.
        setColor(this.colors, instanceCount++, [0.34 + demand * 0.16, 0.38, 0.43, -2]);
      }
    }

    if (!this.concreteRig && !this.glassRig) return instanceCount;
    const stationStep = this.span / Math.max(1, this.stations - 1);
    const laneStep = this.depth / Math.max(1, this.lanes - 1);
    for (let cell = 0; cell < this.failedCells.length && instanceCount < MAX_FIXTURE_INSTANCES; cell++) {
      if (this.failedCells[cell] === 0) continue;
      const station = Math.min(this.stations - 2, Math.floor(cell / this.lanes));
      const lane = Math.min(this.lanes - 1, cell % this.lanes);
      const aOffset = this.node(station, lane) * 3;
      const bOffset = this.node(station + 1, lane) * 3;
      const center: Vec3 = [
        (this.positions[aOffset] + this.positions[bOffset]) * 0.5,
        (this.positions[aOffset + 1] + this.positions[bOffset + 1]) * 0.5,
        (this.positions[aOffset + 2] + this.positions[bOffset + 2]) * 0.5,
      ];
      if (this.glassRig) {
        center[2] += 0.075;
        const radial = Math.atan2(lane - this.targetLane(), station - this.targetStation());
        const angle = radial + (((station + lane) & 1) ? 0.22 : -0.22);
        writeModelMatrixFromEuler(
          this.matrices,
          instanceCount * 16,
          center,
          [0, 0, angle],
          [Math.max(0.14, stationStep * 0.48), 0.010, 0.014],
        );
        setColor(this.colors, instanceCount++, [0.68, 0.92, 1, 1.32]);
        if (instanceCount < MAX_FIXTURE_INSTANCES && ((station + lane) & 1) === 0) {
          writeModelMatrixFromEuler(
            this.matrices,
            instanceCount * 16,
            [center[0], center[1], center[2] + 0.012],
            [0, 0, angle + 0.58],
            [Math.max(0.08, stationStep * 0.27), 0.006, 0.010],
          );
          setColor(this.colors, instanceCount++, [0.76, 0.95, 1, 1.18]);
        }
      } else {
        if (this.verticalRig) center[2] += 0.055;
        else center[1] += 0.055;
        // Dark, shallow surface fissure plus an exposed aggregate chip makes
        // the fracture readable before large chunks detach.
        writeModelMatrixFromEuler(
          this.matrices,
          instanceCount * 16,
          this.verticalRig ? [center[0], center[1], center[2] + 0.073] : [center[0], center[1] + 0.073, center[2]],
          this.verticalRig ? [0, 0, (station * 0.43 + lane * 0.71) % Math.PI] : [0, (station * 0.43 + lane * 0.71) % Math.PI, 0],
          this.verticalRig
            ? [Math.max(0.10, stationStep * 0.31), Math.max(0.012, laneStep * 0.08), 0.008]
            : [Math.max(0.10, stationStep * 0.31), 0.008, 0.018],
        );
        setColor(this.colors, instanceCount++, [0.045, 0.04, 0.035, 1]);
        if (instanceCount >= MAX_FIXTURE_INSTANCES) break;
        writeModelMatrixFromEuler(
          this.matrices,
          instanceCount * 16,
          center,
          this.verticalRig ? [0, 0, (station * 0.73 + lane * 0.41) % Math.PI] : [0, (station * 0.73 + lane * 0.41) % Math.PI, 0],
          this.verticalRig
            ? [Math.max(0.08, stationStep * 0.14), Math.max(0.08, laneStep * 0.22), 0.055]
            : [Math.max(0.08, stationStep * 0.14), 0.055, Math.max(0.08, laneStep * 0.22)],
        );
        // Material -5 selects the mineral/stone atlas tile. The former -3 tag
        // selected woven fabric, which made exposed concrete aggregate wrong.
        setColor(this.colors, instanceCount++, [0.18, 0.17, 0.15, -5]);
      }
    }
    return instanceCount;
  }

  private currentPoint(normalized: readonly [number, number]): Vec3 {
    const station = clamp(Math.round(normalized[0] * (this.stations - 1)), 0, this.stations - 1);
    const lane = clamp(Math.round(normalized[1] * (this.lanes - 1)), 0, this.lanes - 1);
    const offset = this.node(station, lane) * 3;
    return [this.positions[offset], this.positions[offset + 1], this.positions[offset + 2]];
  }

  private writeRecipeFixtures(startIndex: number): number {
    const recipe = this.recipe;
    if (!recipe || recipe.kind === 'combined') return startIndex;
    let index = startIndex;
    const steel: readonly [number, number, number, number] = [0.48, 0.56, 0.64, -2];
    const darkSteel: readonly [number, number, number, number] = [0.16, 0.20, 0.25, 1];
    const actuator: readonly [number, number, number, number] = [0.78, 0.12, 0.035, 1];
    const add = (position: Vec3, half: Vec3, tint: readonly [number, number, number, number]): void => {
      if (index >= MAX_FIXTURE_INSTANCES) return;
      writeAxisAlignedModelMatrix(this.matrices, index * 16, position, half[0], half[1], half[2]);
      setColor(this.colors, index++, tint);
    };

    const halfSpan = this.span * 0.5;
    const halfDepth = this.depth * 0.5;
    const boundary = recipe.boundary;
    if (this.verticalRig) {
      if (boundary === 'perimeter') {
        add([0, this.baseY - halfDepth - 0.22, 0], [halfSpan + 0.42, 0.18, 0.24], steel);
        add([0, this.baseY + halfDepth + 0.22, 0], [halfSpan + 0.42, 0.18, 0.24], steel);
        add([-halfSpan - 0.22, this.baseY, 0], [0.18, halfDepth + 0.40, 0.24], steel);
        add([halfSpan + 0.22, this.baseY, 0], [0.18, halfDepth + 0.40, 0.24], steel);
      } else if (boundary === 'four-corner') {
        for (const x of [-halfSpan, halfSpan]) for (const y of [this.baseY - halfDepth, this.baseY + halfDepth]) add([x, y, 0], [0.34, 0.34, 0.30], steel);
      } else {
        add([-halfSpan - 0.22, this.baseY, 0], [boundary === 'cantilever' ? 0.42 : 0.22, halfDepth + 0.42, 0.30], steel);
        if (boundary !== 'cantilever') add([halfSpan + 0.22, this.baseY, 0], [0.22, halfDepth + 0.42, 0.30], steel);
      }
      // Reaction legs prevent vertical specimens from floating in the hall.
      add([-halfSpan, Math.max(0.65, this.baseY - halfDepth - 1.25), 0], [0.34, 1.10, 0.34], darkSteel);
      add([halfSpan, Math.max(0.65, this.baseY - halfDepth - 1.25), 0], [0.34, 1.10, 0.34], darkSteel);
    } else if (boundary === 'perimeter') {
      add([-halfSpan, this.baseY - 0.42, 0], [0.30, 0.42, halfDepth + 0.30], steel);
      add([halfSpan, this.baseY - 0.42, 0], [0.30, 0.42, halfDepth + 0.30], steel);
      add([0, this.baseY - 0.42, -halfDepth], [halfSpan, 0.38, 0.24], steel);
      add([0, this.baseY - 0.42, halfDepth], [halfSpan, 0.38, 0.24], steel);
    } else if (boundary === 'four-corner') {
      for (const x of [-halfSpan, halfSpan]) for (const z of [-halfDepth, halfDepth]) add([x, this.baseY - 0.52, z], [0.50, 0.52, 0.50], steel);
    } else if (boundary === 'cantilever') {
      add([-halfSpan, this.baseY, 0], [0.56, 0.70, halfDepth + 0.45], steel);
      add([-halfSpan, this.baseY * 0.48, 0], [0.42, this.baseY * 0.48, halfDepth + 0.28], darkSteel);
    } else {
      for (const x of [-halfSpan, halfSpan]) {
        add([x, this.baseY - 0.55, 0], [boundary === 'end-clamped' ? 0.58 : 0.72, 0.55, halfDepth + 0.32], steel);
        add([x, this.baseY * 0.48, 0], [0.36, this.baseY * 0.48, 0.36], darkSteel);
      }
    }

    const strike = this.currentPoint(recipe.strikeCenter);
    const mirror: readonly [number, number] = [
      clamp(recipe.loadCenter[0] * 2 - recipe.strikeCenter[0], 0.02, 0.98),
      clamp(recipe.loadCenter[1] * 2 - recipe.strikeCenter[1], 0.02, 0.98),
    ];
    const loadPoints = recipe.loadPattern === 'dual' ? [strike, this.currentPoint(mirror)] : [this.currentPoint(recipe.loadCenter)];
    const pressBlendRaw = clamp((this.loadProgress - 0.04) / 0.34, 0, 1);
    const pressBlend = pressBlendRaw * pressBlendRaw * (3 - 2 * pressBlendRaw);
    const sign = recipe.loadSign ?? -1;
    const stationHalf = recipe.loadPattern === 'line'
      ? Math.max(0.34, this.span * recipe.loadRadius[0] * 0.44)
      : recipe.loadPattern === 'distributed' || recipe.fixtureStyle === 'blast'
        ? Math.max(1.2, this.span * recipe.loadRadius[0] * 0.42)
        : Math.max(0.48, this.span * recipe.loadRadius[0] * 0.30);
    const laneHalf = recipe.loadPattern === 'line'
      ? Math.max(0.72, this.depth * 0.46)
      : Math.max(0.48, this.depth * recipe.loadRadius[1] * 0.30);

    if (recipe.fixtureStyle === 'blast') {
      const point = this.currentPoint(recipe.loadCenter);
      if (this.verticalRig) add([point[0], point[1], point[2] + 2.1], [stationHalf, laneHalf, 0.12], [0.10, 0.14, 0.18, 1]);
      else add([point[0], point[1] + 2.1, point[2]], [stationHalf, 0.12, laneHalf], [0.10, 0.14, 0.18, 1]);
    } else {
      for (const point of loadPoints) {
        const normalOffset = (-sign) * (1.75 * (1 - pressBlend) + 0.48);
        if (this.verticalRig) add([point[0], point[1], point[2] + normalOffset], [stationHalf, laneHalf, recipe.fixtureStyle === 'drop' ? 0.48 : 0.28], actuator);
        else add([point[0], point[1] + normalOffset, point[2]], [stationHalf, recipe.fixtureStyle === 'drop' ? 0.48 : 0.28, laneHalf], actuator);
      }
    }

    if (recipe.fixtureStyle === 'drop') {
      if (this.verticalRig) {
        add([strike[0] - 0.9, strike[1], 1.4], [0.08, halfDepth * 0.72, 0.08], darkSteel);
        add([strike[0] + 0.9, strike[1], 1.4], [0.08, halfDepth * 0.72, 0.08], darkSteel);
      } else {
        add([strike[0] - 0.9, this.baseY + 1.5, strike[2]], [0.08, 1.6, 0.08], darkSteel);
        add([strike[0] + 0.9, this.baseY + 1.5, strike[2]], [0.08, 1.6, 0.08], darkSteel);
      }
    }
    if (recipe.fixtureStyle === 'fatigue') {
      const pulse = 0.18 + 0.10 * Math.sin(this.time * 3.4);
      add([-halfSpan - 0.74, this.baseY, this.verticalRig ? pulse : 0], [0.54, this.verticalRig ? halfDepth * 0.68 : 0.72, this.verticalRig ? 0.42 : halfDepth * 0.62], actuator);
      add([halfSpan + 0.74, this.baseY, this.verticalRig ? -pulse : 0], [0.54, this.verticalRig ? halfDepth * 0.68 : 0.72, this.verticalRig ? 0.42 : halfDepth * 0.62], actuator);
    }
    return index;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frame;
    this.refreshSegmentMetadata(true);
    let instanceCount = 0;
    const centerStation = Math.floor(this.stations * 0.5);
    let centerY = 0;
    for (let lane = 0; lane < this.lanes; lane++) centerY += this.positions[this.node(centerStation, lane) * 3 + 1];
    centerY /= this.lanes;
    if (this.recipe) {
      instanceCount = this.writeRecipeFixtures(instanceCount);
    } else if (this.dentRig) {
      // Press head, perimeter die, and corner columns make the boundary
      // conditions legible without adding another renderer path.
      const pressBlendRaw = clamp((this.loadProgress - 0.04) / 0.34, 0, 1);
      const pressBlend = pressBlendRaw * pressBlendRaw * (3 - 2 * pressBlendRaw);
      const pressHomeY = 8.75;
      const contactY = centerY + 0.64;
      const pressY = pressHomeY + (contactY - pressHomeY) * pressBlend;
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, pressY, 0], 1.18, 0.62, 1.18);
      setColor(this.colors, instanceCount++, [0.82, 0.20, 0.035, 1]);
      const fixtureColor: readonly [number, number, number, number] = [0.50, 0.56, 0.62, -2];
      const fixtures: readonly (readonly [Vec3, Vec3])[] = [
        [[-this.span * 0.5, this.baseY - 0.42, 0], [0.30, 0.42, this.depth * 0.56]],
        [[this.span * 0.5, this.baseY - 0.42, 0], [0.30, 0.42, this.depth * 0.56]],
        [[0, this.baseY - 0.42, -this.depth * 0.5], [this.span * 0.48, 0.38, 0.24]],
        [[0, this.baseY - 0.42, this.depth * 0.5], [this.span * 0.48, 0.38, 0.24]],
      ];
      for (const [position, half] of fixtures) {
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, position, half[0], half[1], half[2]);
        setColor(this.colors, instanceCount++, fixtureColor);
      }
      for (const x of [-this.span * 0.5, this.span * 0.5]) {
        for (const z of [-this.depth * 0.5, this.depth * 0.5]) {
          writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, this.baseY * 0.48, z], 0.34, this.baseY * 0.48, 0.34);
          setColor(this.colors, instanceCount++, [0.23, 0.28, 0.34, -2]);
        }
      }
    } else if (this.glassRig) {
      const frameColor: readonly [number, number, number, number] = [0.48, 0.57, 0.66, -2];
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, this.baseY - this.depth * 0.5 - 0.22, 0], this.span * 0.52, 0.18, 0.22);
      setColor(this.colors, instanceCount++, frameColor);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, this.baseY + this.depth * 0.5 + 0.22, 0], this.span * 0.52, 0.18, 0.22);
      setColor(this.colors, instanceCount++, frameColor);
      for (const x of [-this.span * 0.5 - 0.22, this.span * 0.5 + 0.22]) {
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, this.baseY, 0], 0.18, this.depth * 0.55, 0.22);
        setColor(this.colors, instanceCount++, frameColor);
      }
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, this.baseY, 1.15], 0.58, 0.58, 0.58);
      setColor(this.colors, instanceCount++, [0.30, 0.34, 0.39, -2]);
    } else if (this.concreteRig) {
      for (const x of [-this.span * 0.5, this.span * 0.5]) {
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, this.baseY - 0.55, 0], 0.72, 0.55, this.depth * 0.56);
        setColor(this.colors, instanceCount++, [0.38, 0.39, 0.38, -1]);
      }
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, centerY + 0.29, 0], 1.0, 0.26, this.depth * 0.44);
      setColor(this.colors, instanceCount++, [0.76, 0.18, 0.035, 1]);
    } else {
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [0, centerY + 0.68, 0], 1.7, 0.28, this.depth * 0.55);
      setColor(this.colors, instanceCount++, [1, 0.54, 0.08, 1.35]);
    }
    instanceCount = this.writePanelSkinTiles(instanceCount);
    instanceCount = this.writeFailureAccents(instanceCount);
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
    for (const fragment of this.fragments) {
      if (instanceCount >= MAX_CPU_INSTANCES) break;
      writeModelMatrixFromEuler(
        this.matrices,
        instanceCount * 16,
        fragment.position,
        fragment.rotation,
        fragment.half,
      );
      setColor(this.colors, instanceCount, fragment.color);
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
    this.fragments.length = 0;
    this.crackEvents.length = 0;
    this.positions = new Float32Array(0);
    this.previous = new Float32Array(0);
  }
}
