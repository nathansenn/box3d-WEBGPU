import { clamp, type Vec3 } from '../math';
import {
  COMBINED_MATERIAL_OFFSETS,
  getMaterialDemoRecipe,
  sceneForMaterialDemo,
  type MaterialDemoKind,
} from '../material-demos';
import type { ScenePreset } from '../scenes';
import type { DebugLine, MaterialFailureTelemetry, PackedSurfaceFrame, RopeGridFrame } from '../types';
import { MATERIAL_RENDER_INSTANCE_BUDGET, MaterialSimulation } from './material-simulation';
import type { SoftSimulation, SoftSimulationFrame } from './simulations';
import { PACKED_SURFACE_VERTEX_BYTES, PackedSurfaceBuffer, translatePackedSurfacePositions } from './packed-surface';

export type CombinedMaterialTarget = Exclude<MaterialDemoKind, 'combined'> | 'all';

/** Three single-specimen streams can request up to 2,880 proxies after heavy
 * fracture. A 3,072 ceiling preserves every core fixture and almost all live
 * debris while leaving a bounded GPU-member remainder in the proven arena. */
export const COMBINED_MATERIAL_CPU_INSTANCE_BUDGET = 3072;

/** CPU proxies and GPU-expanded material members share one renderer arena.
 * Keeping the merged member stream under the remainder preserves the proven
 * MATERIAL_RENDER_INSTANCE_BUDGET contract without requiring a larger global
 * rigid/soft allocation. */
export const COMBINED_MATERIAL_SEGMENT_BUDGET =
  MATERIAL_RENDER_INSTANCE_BUDGET - COMBINED_MATERIAL_CPU_INSTANCE_BUDGET;

const MAX_COMBINED_DEBUG_LINES = 1024;

type MaterialBay = Exclude<MaterialDemoKind, 'combined'>;

type ChildSimulation = {
  readonly kind: MaterialBay;
  readonly offset: Vec3;
  readonly simulation: MaterialSimulation;
};

/** Individual-lab copies. Metal stays the horizontal packed-sheet dent cell;
 * glass and concrete keep their brittle tiled covers. */
const CHILD_RECIPES: Readonly<Record<MaterialBay, string>> = {
  metal: 'metal-square-punch-forming',
  glass: 'glass-ballistic-off-center',
  concrete: 'concrete-flat-slab-punching',
};

const BAY_ORDER: readonly MaterialBay[] = ['metal', 'glass', 'concrete'];

function bayOrientation(kind: MaterialBay): 'horizontal' | 'vertical' {
  switch (kind) {
    case 'metal':
    case 'concrete':
      return 'horizontal';
    case 'glass':
      return 'vertical';
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled material bay: ${exhaustive}`);
    }
  }
}

function bayUsesPackedMetalPunch(kind: MaterialBay): boolean {
  switch (kind) {
    case 'metal':
      return true;
    case 'glass':
    case 'concrete':
      return false;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled material bay: ${exhaustive}`);
    }
  }
}

/** UI kicks are ~1; soak/broad impulses can be 7–40. Keep the packed sheet
 * inside the authored dent envelope instead of a membrane slap. */
function metalPunchStrength(strength: number): number {
  const finite = Number.isFinite(strength) ? strength : 1;
  return clamp(finite > 2 ? finite / 8 : finite, 0.35, 1.6);
}

/** Horizontal metal sheet: span along X, depth along Z, punch along −Y. */
function metalSpecimenUv(localPoint: Vec3): readonly [number, number] {
  const recipe = getMaterialDemoRecipe(CHILD_RECIPES.metal);
  const span = recipe?.span ?? 24;
  const depth = recipe?.depth ?? 8.6;
  return [
    clamp(localPoint[0] / span + 0.5, 0, 1),
    clamp(localPoint[2] / depth + 0.5, 0, 1),
  ];
}

function childSceneFor(kind: MaterialBay): ScenePreset {
  const recipeId = CHILD_RECIPES[kind];
  const recipe = getMaterialDemoRecipe(recipeId);
  if (!recipe || recipe.kind !== kind) {
    throw new Error(`Combined bay '${kind}' must copy a ${kind} recipe; received '${recipeId}'.`);
  }
  const scene = sceneForMaterialDemo(recipeId);
  const orientation = bayOrientation(kind);
  const tags = scene.tags.filter((tag) => (
    tag !== 'vertical'
    && tag !== 'horizontal'
    && tag !== 'upward'
    && tag !== 'downward'
    && tag !== 'water'
    && tag !== 'cloth'
  ));
  return {
    ...scene,
    variant: recipe.profileVariant,
    materialDemoId: recipeId,
    tags: [
      ...tags,
      orientation,
      bayUsesPackedMetalPunch(kind) ? 'packed-sheet' : 'tiled-cover',
      'load-sign-down',
    ],
  };
}

const HASH_SEEDS: Readonly<Record<MaterialBay, number>> = {
  metal: 0x6d657461,
  glass: 0x676c6173,
  concrete: 0x636f6e63,
};

function translatedPoint(point: Vec3, offset: Vec3): Vec3 {
  return [point[0] - offset[0], point[1] - offset[1], point[2] - offset[2]];
}

function mixHash(hash: number, value: number): number {
  hash ^= value >>> 0;
  hash = Math.imul(hash, 16777619) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}

function phaseRank(phase: MaterialFailureTelemetry['failurePhase']): number {
  if (phase === 'failed') return 3;
  if (phase === 'fracturing') return 2;
  if (phase === 'yielding') return 1;
  return 0;
}

function phaseForRank(rank: number): MaterialFailureTelemetry['failurePhase'] {
  if (rank >= 3) return 'failed';
  if (rank === 2) return 'fracturing';
  if (rank === 1) return 'yielding';
  return 'elastic';
}

/** Fair deterministic allocation prevents one busy bay from consuming every
 * proxy slot after a large fracture event. Unused capacity is redistributed
 * to bays that still have live fragments. */
function allocateFairCounts(requested: readonly number[], budget: number): number[] {
  const result = requested.map(() => 0);
  if (budget <= 0 || requested.length === 0) return result;
  const fairShare = Math.floor(budget / requested.length);
  let used = 0;
  for (let i = 0; i < requested.length; i++) {
    result[i] = Math.min(Math.max(0, requested[i]), fairShare);
    used += result[i];
  }
  let remaining = budget - used;
  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < requested.length && remaining > 0; i++) {
      if (result[i] >= requested[i]) continue;
      result[i]++;
      remaining--;
      progressed = true;
    }
    if (!progressed) break;
  }
  return result;
}

/**
 * Three-bay material proving ground.
 *
 * Each bay owns a real MaterialSimulation copied from its individual lab
 * recipe — never the combined hall's glass variant. Metal is a horizontal
 * packed sheet with downward punch; glass and concrete stay brittle/tiled.
 * This class only translates and merges presentation streams; it never
 * aliases or rewrites authoritative child positions, constraints, damage,
 * or telemetry. World contract remains Y-up, right-handed, one unit = one metre.
 */
export class CombinedMaterialSimulation implements SoftSimulation {
  readonly kind = 'fracture' as const;
  readonly label = 'Apex Materials Proving Ground · metal + glass + reinforced concrete';

  private readonly children: readonly ChildSimulation[];
  private readonly matrices = new Float32Array(COMBINED_MATERIAL_CPU_INSTANCE_BUDGET * 16);
  private readonly colors = new Float32Array(COMBINED_MATERIAL_CPU_INSTANCE_BUDGET * 4);
  private readonly ropePositions: Float32Array;
  private readonly ropeSegments = new Float32Array(COMBINED_MATERIAL_SEGMENT_BUDGET * 8);
  private readonly ropeGrid: RopeGridFrame;
  private readonly debugLines: DebugLine[] = [];
  private readonly telemetry: MaterialFailureTelemetry;
  private readonly frame: SoftSimulationFrame;
  private readonly sheetVertices: PackedSurfaceBuffer;
  private readonly sheetIndices: Uint16Array;
  private readonly packedSheetResult: PackedSurfaceFrame;
  private frameVersion = 1;
  private builtFrameVersion = -1;
  private builtFrameDebug = false;
  private ropeTopologyVersion = 1;
  private ropeTopologySignature = 0;
  private lastFocusedBay: MaterialBay = 'metal';
  private destroyed = false;

  constructor(_scene: ScenePreset, stress: number, seed: number) {
    const safeStress = clamp(Math.round(stress), 1, 5);
    const baseSeed = seed >>> 0;
    this.children = BAY_ORDER.map((kind) => ({
      kind,
      offset: [...COMBINED_MATERIAL_OFFSETS[kind]] as Vec3,
      simulation: new MaterialSimulation(
        childSceneFor(kind),
        safeStress,
        (baseSeed ^ HASH_SEEDS[kind]) >>> 0,
      ),
    }));

    const initialFrames = this.children.map((child) => child.simulation.buildFrame(false));
    const nodeCapacity = initialFrames.reduce((sum, childFrame) => sum + (childFrame.ropeGrid?.nodeCount ?? 0), 0);
    this.ropePositions = new Float32Array(Math.max(1, nodeCapacity) * 3);
    this.ropeGrid = {
      presentation: 'material',
      positions: this.ropePositions,
      segments: this.ropeSegments,
      nodeCount: nodeCapacity,
      segmentCount: 0,
      topologyVersion: this.ropeTopologyVersion,
      frameVersion: this.frameVersion,
    };
    const metalIndex = this.children.findIndex((child) => child.kind === 'metal');
    const metalSurface = metalIndex >= 0 ? initialFrames[metalIndex]?.surface : undefined;
    const packedMetal = metalSurface && metalSurface.path === 'packed' && metalSurface.material === 'sheet'
      ? metalSurface
      : null;
    const vertexCapacity = packedMetal
      ? Math.max(1, Math.floor(packedMetal.vertices.byteLength / PACKED_SURFACE_VERTEX_BYTES))
      : 1;
    const indexCapacity = packedMetal ? Math.max(1, packedMetal.indices.length) : 1;
    this.sheetVertices = new PackedSurfaceBuffer(vertexCapacity);
    this.sheetIndices = new Uint16Array(indexCapacity);
    this.packedSheetResult = {
      path: 'packed',
      material: 'sheet',
      vertices: this.sheetVertices.data,
      indices: this.sheetIndices,
      vertexStride: PACKED_SURFACE_VERTEX_BYTES,
      vertexCount: 0,
      indexCount: 0,
      topologyVersion: 1,
      frameVersion: 1,
    };

    this.telemetry = {
      label: 'Apex materials forensic telemetry',
      testMode: 'coordinated metal forming · ballistic glass fracture · reinforced-concrete punching shear',
      loadTarget: 0,
      loadProgress: 0,
      maxStrain: 0,
      yieldStrain: 0.001,
      breakStrain: 0.002,
      yieldedCount: 0,
      damagedCount: 0,
      peakDamage: 0,
      centerDeflection: 0,
      peakDeflection: 0,
      residualDent: 0,
      fracturedCellCount: 0,
      fragmentCount: 0,
      reinforcementCount: 0,
      elasticEnergy: 0,
      plasticWork: 0,
      dampingWork: 0,
      contactWork: 0,
      failurePhase: 'elastic',
    };
    this.frame = {
      kind: this.kind,
      label: this.label,
      matrices: this.matrices,
      colors: this.colors,
      instanceCount: 0,
      surface: null,
      ropeGrid: this.ropeGrid,
      debugLines: this.debugLines,
      nodeCount: nodeCapacity,
      constraintCount: initialFrames.reduce((sum, childFrame) => sum + childFrame.constraintCount, 0),
      brokenCount: 0,
      energy: 0,
      hash: 1,
      frameVersion: this.frameVersion,
      material: this.telemetry,
    };
    this.buildFrame(false);
  }

  private childFor(target: MaterialBay): ChildSimulation {
    const child = this.children.find((candidate) => candidate.kind === target);
    if (!child) throw new Error(`Combined material bay '${target}' was not initialized.`);
    return child;
  }

  private targets(target: CombinedMaterialTarget): readonly ChildSimulation[] {
    return target === 'all' ? this.children : [this.childFor(target)];
  }

  private changed(): void {
    this.frameVersion++;
  }

  step(dt: number, subSteps: number): void {
    if (this.destroyed || !(dt > 0) || !Number.isFinite(dt)) return;
    for (const child of this.children) child.simulation.step(dt, subSteps);
    this.changed();
  }

  kick(strength: number): void {
    if (this.destroyed) return;
    for (const child of this.children) {
      if (bayUsesPackedMetalPunch(child.kind)) child.simulation.dentStrike(metalPunchStrength(strength));
      else child.simulation.kick(strength);
    }
    this.changed();
  }

  explode(center: Vec3, strength: number, radius: number): void {
    if (this.destroyed) return;
    for (const child of this.children) {
      const local = translatedPoint(center, child.offset);
      if (bayUsesPackedMetalPunch(child.kind)) {
        const [u, v] = metalSpecimenUv(local);
        child.simulation.materialStrikeAt(u, v, metalPunchStrength(strength));
      } else {
        child.simulation.explode(local, strength, radius);
      }
    }
    this.changed();
  }

  private nearestBay(worldX: number): ChildSimulation {
    let nearest = this.children[0];
    let distance = Math.abs(worldX - nearest.offset[0]);
    for (let i = 1; i < this.children.length; i++) {
      const candidateDistance = Math.abs(worldX - this.children[i].offset[0]);
      if (candidateDistance < distance) {
        nearest = this.children[i];
        distance = candidateDistance;
      }
    }
    return nearest;
  }

  launchProjectile(position: Vec3, velocity: Vec3, size: number): number {
    if (this.destroyed) return -1;
    const child = this.nearestBay(position[0]);
    this.lastFocusedBay = child.kind;
    const local = translatedPoint(position, child.offset);
    let result: number;
    if (bayUsesPackedMetalPunch(child.kind)) {
      const [u, v] = metalSpecimenUv(local);
      const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
      result = child.simulation.materialStrikeAt(u, v, metalPunchStrength(speed / 12));
    } else {
      result = child.simulation.launchProjectile(local, velocity, size);
    }
    if (result >= 0) this.changed();
    return result;
  }

  spawnRain(count: number, spread: number, height: number): number {
    if (this.destroyed) return 0;
    const requested = Math.max(0, Math.round(count));
    const eligible = this.children.map((child) => (bayUsesPackedMetalPunch(child.kind) ? 0 : requested));
    const shares = allocateFairCounts(eligible, requested);
    let spawned = 0;
    for (let i = 0; i < this.children.length; i++) {
      if (shares[i] <= 0) continue;
      spawned += this.children[i].simulation.spawnRain(shares[i], Math.min(spread, 12), height);
    }
    if (spawned > 0) this.changed();
    return spawned;
  }

  setLoadTarget(target: number): void {
    this.setMaterialLoadTarget('all', target);
  }

  releaseLoad(): void {
    this.releaseMaterialLoad('all');
  }

  cycleLoad(): void {
    if (this.destroyed) return;
    for (const child of this.children) child.simulation.cycleLoad();
    this.changed();
  }

  dentStrike(strength: number): number {
    return this.materialStrikeTarget('metal', strength);
  }

  materialStrike(strength: number): number {
    return this.materialStrikeTarget('all', strength);
  }

  materialStrikeAt(u: number, v: number, strength: number, radiusScale = 1): number {
    return this.materialStrikeAtTarget(this.lastFocusedBay, u, v, strength, radiusScale);
  }

  setMaterialLoadTarget(target: CombinedMaterialTarget, value: number): void {
    if (this.destroyed) return;
    const safeValue = clamp(Number.isFinite(value) ? value : 0, 0, 2);
    for (const child of this.targets(target)) child.simulation.setLoadTarget(safeValue);
    if (target !== 'all') this.lastFocusedBay = target;
    this.changed();
  }

  releaseMaterialLoad(target: CombinedMaterialTarget): void {
    if (this.destroyed) return;
    for (const child of this.targets(target)) child.simulation.releaseLoad();
    if (target !== 'all') this.lastFocusedBay = target;
    this.changed();
  }

  materialStrikeTarget(target: CombinedMaterialTarget, strength: number): number {
    if (this.destroyed) return -1;
    let firstResult = -1;
    for (const child of this.targets(target)) {
      const result = child.kind === 'metal'
        ? child.simulation.dentStrike(strength)
        : child.simulation.materialStrike(strength);
      if (firstResult < 0 && result >= 0) firstResult = result;
      this.lastFocusedBay = child.kind;
    }
    if (firstResult >= 0) this.changed();
    return firstResult;
  }

  materialStrikeAtTarget(
    target: CombinedMaterialTarget,
    u: number,
    v: number,
    strength: number,
    radiusScale = 1,
  ): number {
    if (this.destroyed) return -1;
    let firstResult = -1;
    for (const child of this.targets(target)) {
      const result = child.simulation.materialStrikeAt(u, v, strength, radiusScale);
      if (firstResult < 0 && result >= 0) firstResult = result;
      this.lastFocusedBay = child.kind;
    }
    if (firstResult >= 0) this.changed();
    return firstResult;
  }

  private mergeInstances(childFrames: readonly SoftSimulationFrame[]): number {
    const allocations = allocateFairCounts(
      childFrames.map((childFrame) => Math.max(0, childFrame.instanceCount)),
      COMBINED_MATERIAL_CPU_INSTANCE_BUDGET,
    );
    let writeInstance = 0;
    for (let childIndex = 0; childIndex < childFrames.length; childIndex++) {
      const childFrame = childFrames[childIndex];
      const offset = this.children[childIndex].offset;
      const count = allocations[childIndex];
      if (count <= 0) continue;
      const matrixStart = writeInstance * 16;
      const colorStart = writeInstance * 4;
      this.matrices.set(childFrame.matrices.subarray(0, count * 16), matrixStart);
      this.colors.set(childFrame.colors.subarray(0, count * 4), colorStart);
      for (let instance = 0; instance < count; instance++) {
        const matrixOffset = (writeInstance + instance) * 16;
        this.matrices[matrixOffset + 12] += offset[0];
        this.matrices[matrixOffset + 13] += offset[1];
        this.matrices[matrixOffset + 14] += offset[2];
      }
      writeInstance += count;
    }
    return writeInstance;
  }

  private mergeRopeGrids(childFrames: readonly SoftSimulationFrame[]): void {
    let nodeWrite = 0;
    let segmentWrite = 0;
    let topologySignature = 2166136261 >>> 0;
    for (let childIndex = 0; childIndex < childFrames.length; childIndex++) {
      const source = childFrames[childIndex].ropeGrid;
      if (!source) continue;
      const offset = this.children[childIndex].offset;
      const sourceNodeBase = nodeWrite;
      const nodesAvailable = Math.min(source.nodeCount, Math.floor((this.ropePositions.length - nodeWrite * 3) / 3));
      for (let node = 0; node < nodesAvailable; node++) {
        const sourceOffset = node * 3;
        const destinationOffset = (nodeWrite + node) * 3;
        this.ropePositions[destinationOffset] = source.positions[sourceOffset] + offset[0];
        this.ropePositions[destinationOffset + 1] = source.positions[sourceOffset + 1] + offset[1];
        this.ropePositions[destinationOffset + 2] = source.positions[sourceOffset + 2] + offset[2];
      }
      nodeWrite += nodesAvailable;

      const segmentCapacity = COMBINED_MATERIAL_SEGMENT_BUDGET - segmentWrite;
      const segmentCount = Math.min(source.segmentCount, Math.max(0, segmentCapacity));
      for (let segment = 0; segment < segmentCount; segment++) {
        const sourceOffset = segment * 8;
        const destinationOffset = (segmentWrite + segment) * 8;
        this.ropeSegments[destinationOffset] = source.segments[sourceOffset] + sourceNodeBase;
        this.ropeSegments[destinationOffset + 1] = source.segments[sourceOffset + 1] + sourceNodeBase;
        for (let word = 2; word < 8; word++) {
          this.ropeSegments[destinationOffset + word] = source.segments[sourceOffset + word];
        }
      }
      segmentWrite += segmentCount;
      topologySignature = mixHash(topologySignature, source.topologyVersion);
      topologySignature = mixHash(topologySignature, segmentCount);
    }
    if (topologySignature !== this.ropeTopologySignature) {
      this.ropeTopologySignature = topologySignature;
      this.ropeTopologyVersion++;
    }
    this.ropeGrid.nodeCount = nodeWrite;
    this.ropeGrid.segmentCount = segmentWrite;
    this.ropeGrid.topologyVersion = this.ropeTopologyVersion;
    this.ropeGrid.frameVersion = this.frameVersion;
  }

  private mergeSheetSurface(childFrames: readonly SoftSimulationFrame[]): PackedSurfaceFrame | null {
    for (let childIndex = 0; childIndex < childFrames.length; childIndex++) {
      if (!bayUsesPackedMetalPunch(this.children[childIndex].kind)) continue;
      const source = childFrames[childIndex].surface;
      if (!source || source.path !== 'packed' || source.material !== 'sheet') continue;
      const offset = this.children[childIndex].offset;
      const vertexCount = Math.min(source.vertexCount, Math.floor(this.sheetVertices.data.byteLength / PACKED_SURFACE_VERTEX_BYTES));
      const indexCount = Math.min(source.indexCount, this.sheetIndices.length);
      if (vertexCount <= 0 || indexCount <= 0) continue;
      this.sheetVertices.data.set(source.vertices.subarray(0, vertexCount * PACKED_SURFACE_VERTEX_BYTES));
      this.sheetIndices.set(source.indices.subarray(0, indexCount));
      translatePackedSurfacePositions(this.sheetVertices.data, vertexCount, offset[0], offset[1], offset[2]);
      this.packedSheetResult.vertexCount = vertexCount;
      this.packedSheetResult.indexCount = indexCount;
      this.packedSheetResult.topologyVersion = source.topologyVersion;
      this.packedSheetResult.frameVersion = this.frameVersion;
      return this.packedSheetResult;
    }
    this.packedSheetResult.vertexCount = 0;
    this.packedSheetResult.indexCount = 0;
    return null;
  }

  private mergeDebugLines(childFrames: readonly SoftSimulationFrame[], debug: boolean): void {
    this.debugLines.length = 0;
    if (!debug) return;
    for (let childIndex = 0; childIndex < childFrames.length; childIndex++) {
      const offset = this.children[childIndex].offset;
      for (const line of childFrames[childIndex].debugLines) {
        if (this.debugLines.length >= MAX_COMBINED_DEBUG_LINES) return;
        this.debugLines.push({
          ax: line.ax + offset[0], ay: line.ay + offset[1], az: line.az + offset[2],
          bx: line.bx + offset[0], by: line.by + offset[1], bz: line.bz + offset[2],
          r: line.r, g: line.g, b: line.b, a: line.a,
        });
      }
    }
  }

  private updateTelemetry(childFrames: readonly SoftSimulationFrame[]): void {
    const materials = childFrames
      .map((childFrame) => childFrame.material)
      .filter((material): material is MaterialFailureTelemetry => material !== null && material !== undefined);
    if (materials.length === 0) return;
    let loadTarget = 0;
    let loadProgress = 0;
    let yieldStrain = 0;
    let breakStrain = 0;
    let maxStrain = 0;
    let yieldedCount = 0;
    let damagedCount = 0;
    let peakDamage = 0;
    let centerDeflection = 0;
    let peakDeflection = 0;
    let residualDent = 0;
    let fracturedCellCount = 0;
    let fragmentCount = 0;
    let reinforcementCount = 0;
    let elasticEnergy = 0;
    let plasticWork = 0;
    let dampingWork = 0;
    let contactWork = 0;
    let failureRank = 0;
    for (const material of materials) {
      loadTarget += material.loadTarget;
      loadProgress += material.loadProgress;
      yieldStrain += material.yieldStrain;
      breakStrain += material.breakStrain;
      maxStrain = Math.max(maxStrain, material.maxStrain);
      yieldedCount += material.yieldedCount;
      damagedCount += material.damagedCount;
      peakDamage = Math.max(peakDamage, material.peakDamage);
      centerDeflection = Math.max(centerDeflection, material.centerDeflection);
      peakDeflection = Math.max(peakDeflection, material.peakDeflection);
      residualDent = Math.max(residualDent, material.residualDent);
      fracturedCellCount += material.fracturedCellCount;
      fragmentCount += material.fragmentCount;
      reinforcementCount += material.reinforcementCount;
      elasticEnergy += material.elasticEnergy ?? 0;
      plasticWork += material.plasticWork ?? 0;
      dampingWork += material.dampingWork ?? 0;
      contactWork += material.contactWork ?? 0;
      failureRank = Math.max(failureRank, phaseRank(material.failurePhase));
    }
    const inverseCount = 1 / materials.length;
    this.telemetry.loadTarget = loadTarget * inverseCount;
    this.telemetry.loadProgress = loadProgress * inverseCount;
    this.telemetry.maxStrain = maxStrain;
    this.telemetry.yieldStrain = Math.max(1e-6, yieldStrain * inverseCount);
    this.telemetry.breakStrain = Math.max(this.telemetry.yieldStrain + 1e-6, breakStrain * inverseCount);
    this.telemetry.yieldedCount = yieldedCount;
    this.telemetry.damagedCount = damagedCount;
    this.telemetry.peakDamage = peakDamage;
    this.telemetry.centerDeflection = centerDeflection;
    this.telemetry.peakDeflection = Math.max(centerDeflection, peakDeflection);
    this.telemetry.residualDent = Math.min(this.telemetry.peakDeflection, residualDent);
    this.telemetry.fracturedCellCount = fracturedCellCount;
    this.telemetry.fragmentCount = fragmentCount;
    this.telemetry.reinforcementCount = reinforcementCount;
    this.telemetry.elasticEnergy = elasticEnergy;
    this.telemetry.plasticWork = plasticWork;
    this.telemetry.dampingWork = dampingWork;
    this.telemetry.contactWork = contactWork;
    this.telemetry.failurePhase = phaseForRank(failureRank);
    this.telemetry.testMode = `coordinated three-bay failure · focus ${this.lastFocusedBay} · ${phaseForRank(failureRank)}`;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.destroyed) return this.frame;
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frame;
    const childFrames = this.children.map((child) => child.simulation.buildFrame(debug));
    this.frame.instanceCount = this.mergeInstances(childFrames);
    this.mergeRopeGrids(childFrames);
    this.mergeDebugLines(childFrames, debug);
    this.frame.surface = this.mergeSheetSurface(childFrames);
    this.updateTelemetry(childFrames);
    this.frame.nodeCount = childFrames.reduce((sum, childFrame) => sum + childFrame.nodeCount, 0);
    this.frame.constraintCount = childFrames.reduce((sum, childFrame) => sum + childFrame.constraintCount, 0);
    this.frame.brokenCount = childFrames.reduce((sum, childFrame) => sum + childFrame.brokenCount, 0);
    this.frame.energy = childFrames.reduce((sum, childFrame) => sum + childFrame.energy, 0);
    this.frame.hash = this.currentHash();
    this.frame.frameVersion = this.frameVersion;
    this.frame.material = this.telemetry;
    this.builtFrameVersion = this.frameVersion;
    this.builtFrameDebug = debug;
    return this.frame;
  }

  currentHash(): number {
    if (this.destroyed) return 0;
    let hash = 2166136261 >>> 0;
    for (const child of this.children) {
      hash = mixHash(hash, HASH_SEEDS[child.kind]);
      hash = mixHash(hash, child.simulation.currentHash());
    }
    return hash === 0 ? 1 : hash;
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const child of this.children) child.simulation.destroy();
    this.debugLines.length = 0;
    this.destroyed = true;
    this.frame.instanceCount = 0;
    this.frame.nodeCount = 0;
    this.frame.constraintCount = 0;
    this.frame.brokenCount = 0;
    this.frame.energy = 0;
    this.frame.hash = 0;
    this.ropeGrid.nodeCount = 0;
    this.ropeGrid.segmentCount = 0;
  }
}
