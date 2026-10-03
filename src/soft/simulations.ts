import {
  LcgRng,
  clamp,
  isFiniteArray,
  writeAxisAlignedModelMatrix,
  writeModelMatrixFromEuler,
  type Vec3,
} from '../math';
import { getMaterialDemoRecipe, materialDemoSpecimenPose } from '../material-demos';
import type { ScenePreset } from '../scenes';
import { quantizedHash as sharedQuantizedHash } from './quantized-hash';
import type {
  CameraRig,
  DebugLine,
  DynamicSurfaceFrame,
  GpuClothSurfaceFrame,
  GpuWaterSurfaceFrame,
  MaterialFailureTelemetry,
  PackedSurfaceFrame,
  RopeGridFrame,
  ConceptWorkspaceId,
} from '../types';
import { MATERIAL_RENDER_INSTANCE_BUDGET, MaterialSimulation } from './material-simulation';
import {
  CombinedMaterialSimulation,
  type CombinedMaterialTarget,
} from './combined-material-simulation';
import { PACKED_SURFACE_VERTEX_BYTES, PackedSurfaceBuffer, packedSurfacePositionsAreFinite } from './packed-surface';
import type {
  ClothStepPointers,
  RopeConstraintPointers,
  SoftConstraintPointers,
  SoftKernelArena,
  SoftKernelModule,
  WaterKernelPointers,
} from './kernels';

export type SoftSimulationKind = 'none' | 'cloth' | 'rope' | 'water' | 'fracture';

/** Concept mockup a curated demo is presented against. */
export const CONCEPT_SCREENS = ['structural', 'correlation', 'field-modal', 'material-lab'] as const;
export type ConceptScreen = (typeof CONCEPT_SCREENS)[number];

/** Soft-sim screen tokens alias the product `ConceptWorkspaceId` kebab ids. */
export const CONCEPT_SCREEN_TO_WORKSPACE = {
  structural: 'structural-test',
  correlation: 'correlation-review',
  'field-modal': 'field-modal',
  'material-lab': 'material-lab',
} as const satisfies Record<ConceptScreen, ConceptWorkspaceId>;

export function conceptWorkspaceIdFromScreen(screen: ConceptScreen): ConceptWorkspaceId {
  switch (screen) {
    case 'structural':
    case 'correlation':
    case 'field-modal':
    case 'material-lab':
      return CONCEPT_SCREEN_TO_WORKSPACE[screen];
    default: {
      const exhaustive: never = screen;
      return exhaustive;
    }
  }
}

/** Rest pose of a workbench specimen in the Y-up, right-handed hall. */
export const SPECIMEN_POSES = [
  'horizontal-sheet',
  'vertical-pane',
  'axial-rail',
  'cantilever',
  'hanging-cloth',
  'suspended-net',
  'horizontal-membrane',
  'catenary',
  'basin',
  'upright',
] as const;
export type SpecimenPose = (typeof SPECIMEN_POSES)[number];

/** World gravity for every curated lab. Down is −Y; never invert for “looks”. */
export const WORLD_GRAVITY: Vec3 = [0, -9.81, 0];

export type SimulationLabPose = {
  readonly camera: CameraRig;
  readonly gravity: Vec3;
  readonly specimenPose: SpecimenPose;
  /** Extra yaw about world Y, radians. 0 keeps span along +X. */
  readonly specimenYaw: number;
  /**
   * Extra pitch from the constructed rest plane, radians.
   * Negative tilts a horizontal sheet to face a −Z inspection camera.
   */
  readonly specimenPitch: number;
};

export type SimulationConceptBinding = {
  readonly id: string;
  readonly conceptScreen: ConceptScreen;
  readonly title: string;
  readonly shortName: string;
  readonly specimen: string;
  readonly camera: CameraRig;
  readonly gravity: Vec3;
  readonly specimenPose: SpecimenPose;
  readonly specimenYaw: number;
  readonly specimenPitch: number;
  readonly sceneId?: number;
  readonly materialDemoId?: string;
};

export type SimulationConceptQuery = {
  readonly labId?: string;
  readonly sceneId?: number;
  readonly materialDemoId?: string;
};

export type SoftSimulationFrame = {
  kind: SoftSimulationKind;
  label: string;
  /** Present only for curated workbench / material-lab demos. */
  conceptScreen?: ConceptScreen;
  camera?: CameraRig;
  gravity?: Vec3;
  specimenPose?: SpecimenPose;
  matrices: Float32Array;
  colors: Float32Array;
  instanceCount: number;
  surface: DynamicSurfaceFrame | null;
  ropeGrid: RopeGridFrame | null;
  debugLines: readonly DebugLine[];
  nodeCount: number;
  constraintCount: number;
  brokenCount: number;
  energy: number;
  hash: number;
  frameVersion: number;
  material?: MaterialFailureTelemetry | null;
};

export interface SoftSimulation {
  readonly kind: Exclude<SoftSimulationKind, 'none'>;
  readonly label: string;
  step(dt: number, subSteps: number): void;
  kick(strength: number): void;
  explode(center: Vec3, strength: number, radius: number): void;
  launchProjectile(position: Vec3, velocity: Vec3, size: number): number;
  spawnRain(count: number, spread: number, height: number): number;
  buildFrame(debug: boolean): SoftSimulationFrame;
  currentHash(): number;
  destroy(): void;
  setLoadTarget?(target: number): void;
  releaseLoad?(): void;
  cycleLoad?(): void;
  dentStrike?(strength: number): number;
  materialStrike?(strength: number): number;
  /** Apply a normalized material strike at specimen coordinates in [0, 1]. */
  materialStrikeAt?(u: number, v: number, strength: number, radiusScale?: number): number;
  setMaterialLoadTarget?(target: CombinedMaterialTarget, value: number): void;
  releaseMaterialLoad?(target: CombinedMaterialTarget): void;
  materialStrikeTarget?(target: CombinedMaterialTarget, strength: number): number;
  materialStrikeAtTarget?(
    target: CombinedMaterialTarget,
    u: number,
    v: number,
    strength: number,
    radiusScale?: number,
  ): number;
}

const EMPTY_FLOAT32: Float32Array<ArrayBufferLike> = new Float32Array(0);
const EMPTY_UINT16: Uint16Array<ArrayBufferLike> = new Uint16Array(0);
const EMPTY_UINT8: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
const MAX_SOFT_INSTANCES = 3072;
const MAX_WATER_DROPLETS = 768;
const MAX_WATER_FLOATERS = 20;
const CLOTH_INSTANCE_CAP = 161; // 160 rain/projectiles + one collider proxy
const ROPE_INSTANCE_CAP = 97; // 96 rain/projectiles + one payload proxy
const WATER_INSTANCE_CAP = MAX_WATER_DROPLETS + MAX_WATER_FLOATERS;
const TELEMETRY_INTERVAL_STEPS = 12;
const SURFACE_VERTEX_BYTES = PACKED_SURFACE_VERTEX_BYTES;
const SOFT_REFERENCE_HZ = 60;

const labCamera = (
  yaw: number,
  pitch: number,
  distance: number,
  target: readonly [number, number, number],
): CameraRig => Object.freeze({
  yaw,
  pitch,
  distance,
  target: Object.freeze([target[0], target[1], target[2]]) as Vec3,
});

const labPose = (
  specimenPose: SpecimenPose,
  camera: CameraRig,
  extras?: { readonly yaw?: number; readonly pitch?: number },
): Pick<SimulationConceptBinding, 'camera' | 'gravity' | 'specimenPose' | 'specimenYaw' | 'specimenPitch'> => Object.freeze({
  camera,
  gravity: WORLD_GRAVITY,
  specimenPose,
  specimenYaw: extras?.yaw ?? 0,
  specimenPitch: extras?.pitch ?? 0,
});

const bindConcept = (
  id: string,
  conceptScreen: ConceptScreen,
  title: string,
  shortName: string,
  specimen: string,
  target: { readonly sceneId: number } | { readonly materialDemoId: string },
  pose: Pick<SimulationConceptBinding, 'camera' | 'gravity' | 'specimenPose' | 'specimenYaw' | 'specimenPitch'>,
): SimulationConceptBinding => Object.freeze({
  id, conceptScreen, title, shortName, specimen, ...target, ...pose,
});

/**
 * Curated demo identity for the four concept screens. Physics workbench
 * flagships bind to Structural / Correlation / Field Modal; remaining labs
 * and authored material recipes bind to Material Lab. Scene ids are only
 * recorded when they uniquely identify a lab (never shared fracture bases).
 *
 * Cameras are Y-up inspection rigs: high pitch for sheets/basins so they are
 * not edge-on, +Z azimuth so clamp/bulkhead/pole stay screen-left, face-on
 * yaw for hanging panes. Gravity is always −Y.
 */
export const SIMULATION_CONCEPT_BINDINGS: readonly SimulationConceptBinding[] = Object.freeze([
  bindConcept('titan-bend-dent', 'structural', 'Ballistic Dent', 'Arm Test', 'Aluminum Panel', { materialDemoId: 'metal-square-punch-forming' },
    labPose('horizontal-sheet', labCamera(-1.08, 0.64, 19, [0, 5.85, 0]))),
  bindConcept('crash-rail-axial-fold', 'correlation', 'Aluminum Crash Box', 'Crash Box', 'Sled Impact', { materialDemoId: 'metal-four-point-bumper-beam' },
    labPose('axial-rail', labCamera(1.48, 0.36, 23, [0, 7.0, 0]))),
  bindConcept('composite-coupon', 'field-modal', 'CANT-BEAM-01', 'Cantilever', 'IMPACT-001', { sceneId: 799 },
    labPose('cantilever', labCamera(1.42, 0.28, 19, [-1, 6.2, 0]))),
  bindConcept('notched-low-cycle-fatigue', 'material-lab', 'Fatigue Notch', 'Fatigue Notch', 'Notched Coupon', { materialDemoId: 'metal-notched-fatigue' },
    labPose('horizontal-sheet', labCamera(-1.05, 0.58, 24, [0, 6.9, 0]))),
  bindConcept('ballistic-glass', 'material-lab', 'Glass Impact', 'Glass Impact', 'Laminated Glass', { materialDemoId: 'glass-laminated-stone-strike' },
    labPose('vertical-pane', labCamera(0.15, 0.26, 30, [0, 7.2, 0]))),
  bindConcept('curtain-wall-wind', 'material-lab', 'Curtain Wall', 'Curtain Wall', 'Facade Lite', { materialDemoId: 'glass-curtain-wall-wind' },
    labPose('vertical-pane', labCamera(0.18, 0.28, 32, [0, 7.4, 0]))),
  bindConcept('rc-punching-shear', 'material-lab', 'Concrete Shear', 'Concrete Shear', 'Reinforced Slab', { materialDemoId: 'concrete-flat-slab-punching' },
    labPose('horizontal-sheet', labCamera(-1.12, 0.68, 32, [0, 6.9, 0]))),
  bindConcept('blast-wall-spall', 'material-lab', 'Blast Spall', 'Blast Spall', 'Reinforced Panel', { materialDemoId: 'concrete-blast-wall-spall' },
    labPose('vertical-pane', labCamera(0.22, 0.30, 34, [0, 7.0, 0]))),
  bindConcept('elastomer-recovery', 'material-lab', 'Soft-Body Crush', 'Foam Crush', 'Foam Block', { sceneId: 798 },
    labPose('horizontal-sheet', labCamera(-1.02, 0.52, 28, [0, 6.8, 0]))),
  bindConcept('tempest-flag', 'material-lab', 'Tempest Flag', 'Tempest Flag', 'Wind Tunnel', { sceneId: 640 },
    labPose('hanging-cloth', labCamera(1.36, 0.22, 26, [-4.2, 6.4, 0]))),
  bindConcept('canopy-load-capture', 'material-lab', 'Canopy', 'Canopy', 'Load Capture', { sceneId: 642 },
    labPose('suspended-net', labCamera(-1.05, 0.52, 28, [0, 9.2, 0]), { pitch: -0.38 })),
  bindConcept('cargo-net-catch', 'material-lab', 'Cargo Net', 'Cargo Net', 'Payload Catch', { sceneId: 643 },
    labPose('suspended-net', labCamera(-1.08, 0.50, 26, [0, 8.6, 0]), { pitch: -0.34 })),
  bindConcept('progressive-fabric-tear', 'material-lab', 'Cloth Tear', 'Cloth Tear', 'Ballistic Fabric', { sceneId: 646 },
    labPose('hanging-cloth', labCamera(1.32, 0.24, 24, [0, 6.2, 0]))),
  bindConcept('membrane-shock', 'material-lab', 'Membrane Shock', 'Membrane', 'Tensioned Sheet', { sceneId: 649 },
    labPose('horizontal-membrane', labCamera(-1.10, 0.62, 22, [0, 5.7, 0]), { pitch: -0.22 })),
  bindConcept('sky-crane-cable', 'material-lab', 'Sky Crane', 'Sky Crane', 'Cable Load', { sceneId: 690 },
    labPose('catenary', labCamera(1.05, 0.28, 32, [0, 11.0, 0]))),
  bindConcept('suspension-cable-resonance', 'material-lab', 'Cable Bridge', 'Cable Bridge', 'Suspension', { sceneId: 691 },
    labPose('catenary', labCamera(-0.15, 0.32, 42, [0, 8.2, 0]))),
  bindConcept('heavy-pendulum', 'material-lab', 'Pendulum', 'Pendulum', 'Heavy Impact', { sceneId: 692 },
    labPose('catenary', labCamera(1.12, 0.22, 30, [3, 10.0, 0]))),
  bindConcept('four-point-mooring', 'material-lab', 'Mooring', 'Mooring', 'Four-Point Array', { sceneId: 694 },
    labPose('catenary', labCamera(-0.85, 0.48, 36, [0, 7.2, 0]))),
  bindConcept('rope-net-resonance', 'material-lab', 'Rope Net', 'Rope Net', 'Resonance', { sceneId: 699 },
    labPose('catenary', labCamera(-0.92, 0.42, 34, [0, 9.5, 0]))),
  bindConcept('tsunami-flume', 'material-lab', 'Tsunami', 'Tsunami', 'Research Flume', { sceneId: 741 },
    labPose('basin', labCamera(-0.55, 0.62, 38, [0, 2.2, 0]))),
  bindConcept('dam-breach-front', 'material-lab', 'Fluid Dam-Break', 'Dam-Break', 'Water', { sceneId: 746 },
    labPose('basin', labCamera(-0.48, 0.64, 36, [-2, 2.1, 0]))),
  bindConcept('boat-wake', 'material-lab', 'Boat Wake', 'Boat Wake', 'Hydrodynamic', { sceneId: 743 },
    labPose('basin', labCamera(-0.72, 0.58, 34, [0, 2.4, 0]))),
  bindConcept('vortex-chamber', 'material-lab', 'Vortex', 'Vortex', 'Current Chamber', { sceneId: 747 },
    labPose('basin', labCamera(-0.80, 0.72, 32, [0, 2.0, 0]))),
  bindConcept('leviathan-impact', 'material-lab', 'Impact Basin', 'Impact Basin', 'Leviathan', { sceneId: 749 },
    labPose('basin', labCamera(-0.68, 0.55, 36, [0, 2.6, 0]))),
  bindConcept('aegis-tower-breach', 'structural', 'Tower Breach', 'Tower Breach', 'Kinetic', { sceneId: 140 },
    labPose('upright', labCamera(-0.62, 0.32, 52, [0, 14, 0]))),
  bindConcept('truss-span-overload', 'structural', 'Truss Span', 'Truss Span', 'Overload', { sceneId: 192 },
    labPose('upright', labCamera(-0.22, 0.36, 44, [0, 5, 0]))),
  bindConcept('citadel-siege', 'structural', 'Citadel', 'Citadel', 'Siege', { sceneId: 340 },
    labPose('upright', labCamera(-0.82, 0.34, 46, [0, 8, 0]))),
  bindConcept('titan-hauler-crash', 'structural', 'Hauler Crash', 'Hauler Crash', 'Crash Range', { sceneId: 390 },
    labPose('upright', labCamera(-0.95, 0.32, 48, [0, 4, 0]))),
  bindConcept('high-bay-rack', 'structural', 'Rack Cascade', 'Rack Cascade', 'High-Bay', { sceneId: 541 },
    labPose('upright', labCamera(-0.88, 0.38, 46, [0, 8, 0]))),
  bindConcept('mega-atrium', 'structural', 'Mega Atrium', 'Mega Atrium', 'Progressive Collapse', { sceneId: 599 },
    labPose('upright', labCamera(-0.70, 0.36, 54, [0, 10, 0]))),
  bindConcept('apex-proving-ground', 'material-lab', 'Apex', 'Apex', 'Materials Proving Ground', { materialDemoId: 'apex-materials-proving-ground' },
    labPose('horizontal-sheet', labCamera(-0.78, 0.48, 96, [0, 7.0, 0]))),
  bindConcept('metal-press-brake-v-bend', 'material-lab', 'Metal Fold', 'Metal Fold', 'Sheet Metal', { materialDemoId: 'metal-press-brake-v-bend' },
    labPose('horizontal-sheet', labCamera(-1.12, 0.58, 28, [0, 6.8, 0]))),
  bindConcept('metal-springback-fold', 'material-lab', 'Springback Fold', 'Springback Fold', 'Thin Aluminum', { materialDemoId: 'metal-springback-fold' },
    labPose('horizontal-sheet', labCamera(-1.10, 0.58, 28, [0, 6.8, 0]))),
  bindConcept('metal-thick-plate-dent', 'material-lab', 'Thick Plate Dent', 'Thick Plate', 'Thick Aluminum', { materialDemoId: 'metal-thick-plate-dent' },
    labPose('horizontal-sheet', labCamera(-1.08, 0.64, 19, [0, 5.85, 0]))),
  bindConcept('metal-notch-tear', 'material-lab', 'Notch Tear', 'Notch Tear', 'Notched Sheet', { materialDemoId: 'metal-notch-tear' },
    labPose('horizontal-sheet', labCamera(-1.05, 0.62, 24, [0, 6.8, 0]))),
]);

const conceptById = new Map<string, SimulationConceptBinding>();
const conceptBySceneId = new Map<number, SimulationConceptBinding>();
const conceptByMaterialDemoId = new Map<string, SimulationConceptBinding>();

for (const binding of SIMULATION_CONCEPT_BINDINGS) {
  if (conceptById.has(binding.id)) throw new Error(`Duplicate simulation concept id '${binding.id}'.`);
  conceptById.set(binding.id, binding);
  if (binding.sceneId !== undefined) {
    if (conceptBySceneId.has(binding.sceneId)) {
      throw new Error(`Duplicate simulation concept scene ${binding.sceneId}.`);
    }
    conceptBySceneId.set(binding.sceneId, binding);
  }
  if (binding.materialDemoId !== undefined) {
    if (conceptByMaterialDemoId.has(binding.materialDemoId)) {
      throw new Error(`Duplicate simulation concept material demo '${binding.materialDemoId}'.`);
    }
    conceptByMaterialDemoId.set(binding.materialDemoId, binding);
  }
}

function poseFromMaterialRecipe(materialDemoId: string): Pick<SimulationConceptBinding, 'camera' | 'gravity' | 'specimenPose' | 'specimenYaw' | 'specimenPitch'> | null {
  const recipe = getMaterialDemoRecipe(materialDemoId);
  if (!recipe) return null;
  const resolved = materialDemoSpecimenPose(recipe);
  const vertical = resolved.orientation === 'vertical';
  const lookDown = !vertical && recipe.camera.pitch < 0.48;
  return labPose(
    vertical ? 'vertical-pane' : 'horizontal-sheet',
    labCamera(
      recipe.camera.yaw,
      lookDown ? Math.max(recipe.camera.pitch, 0.58) : recipe.camera.pitch,
      recipe.camera.distance,
      recipe.camera.target,
    ),
    { yaw: resolved.yaw },
  );
}

function materialLabFallback(materialDemoId: string): SimulationConceptBinding | null {
  const recipe = getMaterialDemoRecipe(materialDemoId);
  const pose = poseFromMaterialRecipe(materialDemoId);
  if (!recipe || !pose) return null;
  const specimen = recipe.specimen;
  return bindConcept(recipe.id, 'material-lab', recipe.title, recipe.title, specimen, { materialDemoId: recipe.id }, pose);
}

export function getSimulationConceptBinding(query: SimulationConceptQuery): SimulationConceptBinding | null {
  if (query.labId) {
    const byLab = conceptById.get(query.labId);
    if (byLab) return byLab;
  }
  if (query.materialDemoId) {
    const byMaterial = conceptByMaterialDemoId.get(query.materialDemoId) ?? materialLabFallback(query.materialDemoId);
    if (byMaterial) return byMaterial;
  }
  if (query.sceneId !== undefined) return conceptBySceneId.get(query.sceneId) ?? null;
  return null;
}

export function cloneSimulationLabCamera(query: SimulationConceptQuery): CameraRig | null {
  const binding = getSimulationConceptBinding(query);
  if (!binding) return null;
  return {
    yaw: binding.camera.yaw,
    pitch: binding.camera.pitch,
    distance: binding.camera.distance,
    target: [binding.camera.target[0], binding.camera.target[1], binding.camera.target[2]],
  };
}

export function conceptScreenAsset(screen: ConceptScreen): 'physics-workbench-structural-v2' | 'physics-workbench-correlation-v2' | 'physics-workbench-field-modal-v2' | 'material-lab-desktop' {
  switch (screen) {
    case 'structural': return 'physics-workbench-structural-v2';
    case 'correlation': return 'physics-workbench-correlation-v2';
    case 'field-modal': return 'physics-workbench-field-modal-v2';
    case 'material-lab': return 'material-lab-desktop';
    default: {
      const exhaustive: never = screen;
      throw new Error(`Unhandled concept screen: ${String(exhaustive)}`);
    }
  }
}

function conceptPresentation(scene: ScenePreset): {
  title: string;
  conceptScreen: ConceptScreen | undefined;
  binding: SimulationConceptBinding | null;
} {
  const binding = getSimulationConceptBinding({
    sceneId: scene.id,
    materialDemoId: scene.materialDemoId,
  });
  if (!binding) return { title: scene.title.replace(/\s+—.*$/, ''), conceptScreen: undefined, binding: null };
  return {
    title: `${binding.title} · ${binding.specimen}`,
    conceptScreen: binding.conceptScreen,
    binding,
  };
}

function rotatePositionsYawPitch(
  positions: Float32Array,
  count: number,
  yaw: number,
  pitch: number,
  origin?: Vec3,
): void {
  if (yaw === 0 && pitch === 0) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  if (origin) {
    cx = origin[0];
    cy = origin[1];
    cz = origin[2];
  } else {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      cx += positions[o];
      cy += positions[o + 1];
      cz += positions[o + 2];
    }
    const inv = 1 / Math.max(1, count);
    cx *= inv;
    cy *= inv;
    cz *= inv;
  }
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x0 = positions[o] - cx;
    const y0 = positions[o + 1] - cy;
    const z0 = positions[o + 2] - cz;
    const y1 = y0 * cosPitch - z0 * sinPitch;
    const z1 = y0 * sinPitch + z0 * cosPitch;
    positions[o] = x0 * cosYaw - z1 * sinYaw + cx;
    positions[o + 1] = y1 + cy;
    positions[o + 2] = x0 * sinYaw + z1 * cosYaw + cz;
  }
}

function hangingClothLayout(pose: SpecimenPose | undefined, variant: number): boolean {
  switch (pose) {
    case 'hanging-cloth':
    case 'vertical-pane':
      return true;
    case 'suspended-net':
    case 'horizontal-membrane':
    case 'horizontal-sheet':
    case 'axial-rail':
    case 'cantilever':
    case 'catenary':
    case 'basin':
    case 'upright':
      return false;
    case undefined:
      return [0, 1, 5, 6, 8].includes(variant);
    default: {
      const exhaustive: never = pose;
      return exhaustive;
    }
  }
}

function softFamily(family: ScenePreset['family']): family is 'cloth' | 'rope' | 'water' | 'fracture' {
  return family === 'cloth' || family === 'rope' || family === 'water' || family === 'fracture';
}

function quantizedHash(values: ArrayLike<number>, count = values.length): number {
  return sharedQuantizedHash(values, 1000, count);
}

function mixColor(a: readonly number[], b: readonly number[], t: number): [number, number, number, number] {
  const u = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    a[3] + (b[3] - a[3]) * u,
  ];
}

function setColor(out: Float32Array, index: number, color: readonly number[]): void {
  const offset = index * 4;
  out[offset + 0] = color[0];
  out[offset + 1] = color[1];
  out[offset + 2] = color[2];
  out[offset + 3] = color[3];
}

function readPosition(array: Float32Array, index: number): Vec3 {
  const offset = index * 3;
  return [array[offset], array[offset + 1], array[offset + 2]];
}

function writePosition(array: Float32Array, index: number, value: Vec3): void {
  const offset = index * 3;
  array[offset] = value[0];
  array[offset + 1] = value[1];
  array[offset + 2] = value[2];
}

function distance(array: Float32Array, a: number, b: number): number {
  const ao = a * 3;
  const bo = b * 3;
  return Math.hypot(
    array[bo] - array[ao],
    array[bo + 1] - array[ao + 1],
    array[bo + 2] - array[ao + 2],
  );
}

type SoftProjectile = {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  life: number;
  color: [number, number, number, number];
};

function computeParticleBounds(
  positions: Float32Array<ArrayBufferLike>,
  inverseMass: Float32Array<ArrayBufferLike>,
  count: number,
  output: Float32Array,
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    if (inverseMass[i] === 0) continue;
    const offset = i * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (minX === Number.POSITIVE_INFINITY) return false;
  output[0] = minX;
  output[1] = minY;
  output[2] = minZ;
  output[3] = maxX;
  output[4] = maxY;
  output[5] = maxZ;
  return true;
}

type ClothConstraint = {
  a: number;
  b: number;
  rest: number;
  solveStiffness: number;
  breakThreshold: number;
  broken: boolean;
  edgeType: 0 | 1 | 2 | 3;
  edgeIndex: number;
};

class ClothSimulation implements SoftSimulation {
  readonly kind = 'cloth' as const;
  readonly label: string;

  private readonly cols: number;
  private readonly rows: number;
  private readonly count: number;
  private positions: Float32Array;
  private readonly restPositions: Float32Array;
  private previous: Float32Array;
  private readonly invMass: Float32Array;
  private readonly strain: Float32Array;
  private readonly normals: Float32Array;
  private readonly constraints: ClothConstraint[] = [];
  private constraintA = EMPTY_UINT16;
  private constraintB = EMPTY_UINT16;
  private constraintRest = EMPTY_FLOAT32;
  private constraintInvRest = EMPTY_FLOAT32;
  private constraintScaleA = EMPTY_FLOAT32;
  private constraintScaleB = EMPTY_FLOAT32;
  private constraintFastScaleA = EMPTY_FLOAT32;
  private constraintFastScaleB = EMPTY_FLOAT32;
  private constraintBreakThreshold = EMPTY_FLOAT32;
  private constraintBroken = EMPTY_UINT8;
  private constraintEdgeType = EMPTY_UINT8;
  private constraintEdgeIndex = new Int32Array(0);
  private constraintCountValue = 0;
  private readonly horizontalBroken: Uint8Array;
  private readonly verticalBroken: Uint8Array;
  private readonly vertices: PackedSurfaceBuffer | null;
  private readonly indexScratch: Uint16Array;
  private readonly edgeFactors: Float32Array;
  private readonly windSinA: Float32Array;
  private readonly windCosA: Float32Array;
  private readonly windSinB: Float32Array;
  private readonly windCosB: Float32Array;
  private readonly windSinZ: Float32Array;
  private readonly windCosZ: Float32Array;
  private readonly baseRgb: Float32Array;
  private topologyDirty = true;
  private topologyVersion = 1;
  private cachedIndexCount = 0;
  private instanceMatrices: Float32Array<ArrayBufferLike> = new Float32Array(CLOTH_INSTANCE_CAP * 16);
  private instanceColors: Float32Array<ArrayBufferLike> = new Float32Array(CLOTH_INSTANCE_CAP * 4);
  private readonly debugLines: DebugLine[] = [];
  private readonly packedSurfaceResult: PackedSurfaceFrame;
  private readonly gpuSurfaceResult: GpuClothSurfaceFrame;
  private readonly frameResult: SoftSimulationFrame;
  private readonly projectiles: SoftProjectile[] = [];
  private readonly projectileBounds = new Float32Array(6);
  private readonly rng: LcgRng;
  private readonly stress: number;
  private readonly variant: number;
  private readonly mode: number;
  private readonly iterations: number;
  private readonly fastIterations: number;
  private readonly windStrength: number;
  private readonly sphereCenter: Vec3;
  private readonly sphereRadius: number;
  private readonly verticalLayout: boolean;
  private readonly gravityY: number;
  private readonly tearingEnabled: boolean;
  private readonly fusedKernelStep: boolean;
  private readonly batchedKernelSolve: boolean;
  private readonly baseColorA: [number, number, number, number];
  private readonly baseColorB: [number, number, number, number];
  private time = 0;
  private brokenCountValue = 0;
  private energyValue = 0;
  private energyDirty = false;
  private energyDt = 0;
  private hashValue = 0;
  private hashCountdown = TELEMETRY_INTERVAL_STEPS;
  private frameVersion = 1;
  private packedSurfaceFrameVersion = -1;
  private builtFrameVersion = -1;
  private builtFrameDebug = false;
  private readonly kernelModule: SoftKernelModule | null;
  private kernelArena: SoftKernelArena | null = null;
  private kernelPointers: ClothStepPointers | null = null;

  constructor(scene: ScenePreset, stress: number, seed: number, kernelModule: SoftKernelModule | null = null) {
    this.variant = scene.variant;
    this.mode = scene.mode;
    this.stress = stress;
    this.tearingEnabled = this.variant === 6 || (this.mode >= 3 && this.variant === 7);
    this.cols = Math.min(52, 24 + stress * 4 + (scene.mode >= 3 ? 4 : 0) + (scene.variant % 2) * 2);
    this.rows = Math.min(36, 16 + stress * 3 + (scene.mode === 4 ? 3 : 0));
    this.count = this.cols * this.rows;
    this.positions = new Float32Array(this.count * 3);
    this.restPositions = new Float32Array(this.count * 3);
    this.previous = new Float32Array(this.count * 3);
    this.invMass = new Float32Array(this.count);
    this.strain = this.tearingEnabled ? new Float32Array(this.count) : EMPTY_FLOAT32;
    this.normals = this.tearingEnabled ? new Float32Array(this.count * 3) : EMPTY_FLOAT32;
    this.horizontalBroken = new Uint8Array(this.rows * Math.max(0, this.cols - 1));
    this.verticalBroken = new Uint8Array(Math.max(0, this.rows - 1) * this.cols);
    this.vertices = this.tearingEnabled ? new PackedSurfaceBuffer(this.count) : null;
    this.indexScratch = new Uint16Array(Math.max(0, (this.cols - 1) * (this.rows - 1) * 6));
    this.edgeFactors = new Float32Array(this.count);
    this.windSinA = new Float32Array(this.count);
    this.windCosA = new Float32Array(this.count);
    this.windSinB = new Float32Array(this.count);
    this.windCosB = new Float32Array(this.count);
    this.windSinZ = new Float32Array(this.count);
    this.windCosZ = new Float32Array(this.count);
    this.baseRgb = this.tearingEnabled ? new Float32Array(this.count * 3) : EMPTY_FLOAT32;
    // PBD quality is driven by both substeps and solver iterations. Keep the
    // total pass count bounded so maximum cloth scenes remain interactive in
    // JavaScript while retaining enough projection passes for stable folds.
    this.iterations = 5 + stress + (scene.mode >= 3 ? 2 : 0);
    // The v1.9 tournament found two scene-structural fast schedules:
    // hammocks/collider drapes remain stable at six passes, while the
    // perimeter-pinned membrane drum remains stable at four. Other intact
    // recipes keep the previously validated eight-pass ceiling. Tearing cloth
    // continues to use the authoritative full schedule below.
    const fastIterationLimit = this.variant === 9 ? 4 : this.variant === 3 ? 6 : 8;
    this.fastIterations = Math.min(this.iterations, fastIterationLimit);
    this.windStrength = 3.5 + stress * 1.35 + scene.mode * 0.45;
    this.rng = new LcgRng(seed ^ 0xc10f7a);
    this.kernelModule = this.tearingEnabled ? null : kernelModule;
    const clothPresentation = conceptPresentation(scene);
    this.label = `${clothPresentation.title} · PBD cloth ${this.cols}×${this.rows}`;
    this.gravityY = clothPresentation.binding?.gravity[1] ?? WORLD_GRAVITY[1];
    this.verticalLayout = hangingClothLayout(clothPresentation.binding?.specimenPose, this.variant);
    // A 360-frame, action-heavy comparison against the exact v1.10 baseline
    // qualifies only the perimeter-pinned membrane layout for the fused
    // float32 integration/solve path. Other layouts retain the legacy cadence:
    // seemingly small rounding differences amplified under sustained wind,
    // impacts, and explosions even when short microbenchmarks passed.
    this.fusedKernelStep = this.variant === 9;
    this.sphereCenter = this.variant === 7 ? [0, 4.2, 0] : this.variant === 3 ? [0, 4.5, 0] : [0, -100, 0];
    this.sphereRadius = this.variant === 7 ? 3.1 : this.variant === 3 ? 1.6 : 0;
    // Intact layouts without a sphere can keep the entire constraint/collision
    // cadence inside one WebAssembly call. This preserves the exact order of
    // projection and floor collision while removing one JS/WASM transition
    // and one JavaScript particle scan per projection pass.
    this.batchedKernelSolve = this.fusedKernelStep || this.variant === 5;

    const palettes: readonly [[number, number, number, number], [number, number, number, number]][] = [
      [[0.04, 0.52, 0.72, 1], [0.92, 0.17, 0.23, 1]],
      [[0.12, 0.26, 0.56, 1], [0.98, 0.76, 0.24, 1]],
      [[0.22, 0.70, 0.62, 1], [0.08, 0.24, 0.42, 1]],
      [[0.78, 0.14, 0.52, 1], [0.18, 0.82, 0.90, 1]],
      [[0.86, 0.38, 0.08, 1], [0.98, 0.88, 0.45, 1]],
    ];
    [this.baseColorA, this.baseColorB] = palettes[this.variant % palettes.length];

    this.initializeParticles();
    if (clothPresentation.binding) {
      rotatePositionsYawPitch(
        this.positions,
        this.count,
        clothPresentation.binding.specimenYaw,
        clothPresentation.binding.specimenPitch,
      );
    }
    this.restPositions.set(this.positions);
    this.initializeRenderCaches();
    this.initializeConstraints();
    this.packConstraints();
    this.previous.set(this.positions);
    this.initializeKernelState();
    this.hashValue = quantizedHash(this.positions, Math.min(this.positions.length, 4096));
    this.packedSurfaceResult = {
      path: 'packed', material: 'cloth', vertices: this.vertices?.data ?? EMPTY_UINT8, indices: this.indexScratch,
      vertexStride: PACKED_SURFACE_VERTEX_BYTES, vertexCount: this.count,
      indexCount: 0, topologyVersion: this.topologyVersion, frameVersion: this.frameVersion,
    };
    this.gpuSurfaceResult = {
      path: 'gpu-cloth', material: 'cloth', positions: this.positions,
      restPositions: this.restPositions,
      indices: this.indexScratch, vertexCount: this.count, indexCount: 0,
      topologyVersion: this.topologyVersion, frameVersion: this.frameVersion,
      cols: this.cols, rows: this.rows, baseColorA: this.baseColorA, baseColorB: this.baseColorB,
    };
    this.frameResult = {
      kind: this.kind, label: this.label, conceptScreen: clothPresentation.conceptScreen,
      camera: clothPresentation.binding?.camera, gravity: clothPresentation.binding?.gravity,
      specimenPose: clothPresentation.binding?.specimenPose,
      matrices: this.instanceMatrices,
      colors: this.instanceColors, instanceCount: 0,
      surface: this.tearingEnabled ? this.packedSurfaceResult : this.gpuSurfaceResult,
      ropeGrid: null,
      debugLines: this.debugLines, nodeCount: this.count,
      constraintCount: this.constraintCountValue, brokenCount: 0, energy: 0, hash: this.hashValue,
      frameVersion: this.frameVersion,
    };
    this.rebuildTopology();
    this.gpuSurfaceResult.indexCount = this.cachedIndexCount;
    if (this.tearingEnabled) this.buildSurface();
  }

  private index(x: number, y: number): number { return y * this.cols + x; }

  private initializeParticles(): void {
    const vertical = this.verticalLayout;
    const width = this.variant === 4 ? 15 : 14 + this.variant * 0.16;
    const height = this.variant === 4 ? 4.5 : 8.5 + (this.variant % 3) * 0.5;
    const baseY = vertical ? 2.0 : (this.variant === 2 ? 10.5 : this.variant === 9 ? 5.8 : 8.4);

    for (let y = 0; y < this.rows; y++) {
      const v = y / Math.max(1, this.rows - 1);
      for (let x = 0; x < this.cols; x++) {
        const u = x / Math.max(1, this.cols - 1);
        const i = this.index(x, y);
        let p: Vec3;
        if (vertical) {
          const flutter = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.18;
          p = [(u - 0.5) * width, baseY + (1 - v) * height, flutter];
          if (this.variant === 0 || this.variant === 5) p[0] -= width * 0.44;
          if (this.variant === 6) p[2] += Math.sin(u * 8 + v * 3) * 0.05;
        } else {
          const xw = (u - 0.5) * width;
          const zw = (v - 0.5) * (this.variant === 4 ? 5.2 : 10.5);
          let yw = baseY;
          if (this.variant === 2) {
            const nx = (u - 0.5) * 2;
            const nz = (v - 0.5) * 2;
            yw += Math.max(0, 1 - nx * nx - nz * nz) * 2.4;
          } else if (this.variant === 3 || this.variant === 4) {
            yw -= Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * (this.variant === 4 ? 1.6 : 0.9);
          } else if (this.variant === 7) {
            yw += Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.12;
          } else if (this.variant === 9) {
            yw += Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2) * 0.08;
          }
          p = [xw, yw, zw];
        }
        writePosition(this.positions, i, p);
        this.invMass[i] = 1;
      }
    }

    const pin = (x: number, y: number): void => { this.invMass[this.index(x, y)] = 0; };
    const pinTopRow = (): void => { for (let x = 0; x < this.cols; x++) pin(x, 0); };
    const pinPerimeter = (): void => {
      for (let x = 0; x < this.cols; x++) { pin(x, 0); pin(x, this.rows - 1); }
      for (let y = 0; y < this.rows; y++) { pin(0, y); pin(this.cols - 1, y); }
    };

    switch (this.variant) {
      case 0:
      case 5:
        for (let y = 0; y < this.rows; y++) pin(0, y);
        break;
      case 1:
      case 8:
        pinTopRow();
        break;
      case 2:
      case 3:
      case 7:
        pin(0, 0); pin(this.cols - 1, 0); pin(0, this.rows - 1); pin(this.cols - 1, this.rows - 1);
        break;
      case 4:
        for (let y = 0; y < this.rows; y++) { pin(0, y); pin(this.cols - 1, y); }
        break;
      case 6:
        for (let x = 0; x < this.cols; x += 3) pin(x, 0);
        pin(this.cols - 1, 0);
        break;
      case 9:
        pinPerimeter();
        break;
      default:
        pinTopRow();
        break;
    }
  }

  private initializeRenderCaches(): void {
    const invCols = 1 / Math.max(1, this.cols - 1);
    const invRows = 1 / Math.max(1, this.rows - 1);
    for (let y = 0; y < this.rows; y++) {
      const v = y * invRows;
      for (let x = 0; x < this.cols; x++) {
        const u = x * invCols;
        const i = y * this.cols + x;
        const o = i * 3;
        const px = this.positions[o];
        const py = this.positions[o + 1];
        const pz = this.positions[o + 2];
        const phaseA = px * 0.48 + py * 0.22 + pz * 0.31;
        const phaseB = -px * 0.27 + py * 0.39;
        const phaseZ = px * 0.17;
        this.windSinA[i] = Math.sin(phaseA);
        this.windCosA[i] = Math.cos(phaseA);
        this.windSinB[i] = Math.sin(phaseB);
        this.windCosB[i] = Math.cos(phaseB);
        this.windSinZ[i] = Math.sin(phaseZ);
        this.windCosZ[i] = Math.cos(phaseZ);
        this.edgeFactors[i] = 0.55 + 0.45 * Math.sin(u * Math.PI);
        if (this.tearingEnabled) {
          const packedOffset = i * 12;
          this.vertices!.u16[packedOffset + 10] = Math.round(u * 65535);
          this.vertices!.u16[packedOffset + 11] = Math.round(v * 65535);
          const checker = ((Math.floor(u * 10) + Math.floor(v * 8)) & 1) === 0 ? 0.22 : 0.78;
          this.baseRgb[o] = this.baseColorA[0] + (this.baseColorB[0] - this.baseColorA[0]) * checker;
          this.baseRgb[o + 1] = this.baseColorA[1] + (this.baseColorB[1] - this.baseColorA[1]) * checker;
          this.baseRgb[o + 2] = this.baseColorA[2] + (this.baseColorB[2] - this.baseColorA[2]) * checker;
        }
      }
    }
  }

  private addConstraint(
    a: number,
    b: number,
    stiffness: number,
    breakThreshold: number,
    edgeType: ClothConstraint['edgeType'] = 0,
    edgeIndex = -1,
  ): void {
    this.constraints.push({
      a,
      b,
      rest: distance(this.positions, a, b),
      solveStiffness: 1 - Math.pow(1 - stiffness, 1 / this.iterations),
      breakThreshold,
      broken: false,
      edgeType,
      edgeIndex,
    });
  }

  private initializeConstraints(): void {
    const structuralBreak = this.tearingEnabled ? 1.34 + this.stress * 0.035 : 4.5;
    const shearBreak = this.tearingEnabled ? structuralBreak * 1.08 : 4.8;

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = this.index(x, y);
        if (x + 1 < this.cols) {
          this.addConstraint(i, this.index(x + 1, y), 0.98, structuralBreak, 1, y * (this.cols - 1) + x);
        }
        if (y + 1 < this.rows) {
          this.addConstraint(i, this.index(x, y + 1), 0.98, structuralBreak, 2, y * this.cols + x);
        }
        if (x + 1 < this.cols && y + 1 < this.rows) {
          this.addConstraint(i, this.index(x + 1, y + 1), 0.88, shearBreak, 0, -1);
          this.addConstraint(this.index(x + 1, y), this.index(x, y + 1), 0.88, shearBreak, 0, -1);
        }
        if (x + 2 < this.cols) this.addConstraint(i, this.index(x + 2, y), 0.48, 8, 0, -1);
        if (y + 2 < this.rows) this.addConstraint(i, this.index(x, y + 2), 0.48, 8, 0, -1);
      }
    }
  }

  private packConstraints(): void {
    // Convert construction-time objects into structure-of-arrays storage. The
    // solver touches every constraint many times per frame, so contiguous
    // typed arrays dramatically reduce property lookups and cache misses.
    const active = this.constraints.filter((constraint) => {
      const weight = this.invMass[constraint.a] + this.invMass[constraint.b];
      return weight > 0;
    });
    const count = active.length;
    this.constraintA = new Uint16Array(count);
    this.constraintB = new Uint16Array(count);
    this.constraintRest = new Float32Array(count);
    this.constraintInvRest = new Float32Array(count);
    this.constraintScaleA = new Float32Array(count);
    this.constraintScaleB = new Float32Array(count);
    this.constraintFastScaleA = new Float32Array(count);
    this.constraintFastScaleB = new Float32Array(count);
    this.constraintBreakThreshold = new Float32Array(count);
    this.constraintBroken = new Uint8Array(count);
    this.constraintEdgeType = new Uint8Array(count);
    this.constraintEdgeIndex = new Int32Array(count);

    for (let i = 0; i < count; i++) {
      const constraint = active[i];
      const wa = this.invMass[constraint.a];
      const wb = this.invMass[constraint.b];
      const inverseWeight = 1 / (wa + wb);
      this.constraintA[i] = constraint.a;
      this.constraintB[i] = constraint.b;
      this.constraintRest[i] = constraint.rest;
      this.constraintInvRest[i] = 1 / Math.max(1e-8, constraint.rest);
      this.constraintScaleA[i] = constraint.solveStiffness * wa * inverseWeight;
      this.constraintScaleB[i] = constraint.solveStiffness * wb * inverseWeight;
      // Preserve the original global stiffness when the intact-cloth fast
      // schedule uses fewer projection passes. This adapts the v1.9 schedule
      // to the current soft-kernel ABI, which projects one compact constraint
      // stream per call.
      const globalStiffness = 1 - Math.pow(1 - constraint.solveStiffness, this.iterations);
      const fastSolveStiffness = 1 - Math.pow(1 - globalStiffness, 1 / this.fastIterations);
      this.constraintFastScaleA[i] = fastSolveStiffness * wa * inverseWeight;
      this.constraintFastScaleB[i] = fastSolveStiffness * wb * inverseWeight;
      this.constraintBreakThreshold[i] = constraint.breakThreshold;
      this.constraintEdgeType[i] = constraint.edgeType;
      this.constraintEdgeIndex[i] = constraint.edgeIndex;
    }
    this.constraintCountValue = count;
    this.constraints.length = 0;
  }

  private initializeKernelState(): void {
    if (!this.kernelModule || this.constraintCountValue <= 0) return;
    const arena = this.kernelModule.createArena();
    const positions = arena.copyF32(this.positions);
    let previousPointer = 0;
    let inverseMassPointer = 0;
    if (this.batchedKernelSolve) {
      const previous = arena.copyF32(this.previous);
      const inverseMass = arena.copyF32(this.invMass);
      previousPointer = previous.pointer;
      inverseMassPointer = inverseMass.pointer;
      this.previous = arena.viewF32(previous.pointer, this.previous.length);
    }
    const indicesA = arena.copyU16(this.constraintA);
    const indicesB = arena.copyU16(this.constraintB);
    const restLengths = arena.copyF32(this.constraintRest);
    const scaleA = arena.copyF32(this.constraintFastScaleA);
    const scaleB = arena.copyF32(this.constraintFastScaleB);
    // Qualified standalone intact-cloth layouts cannot mutate constraint
    // topology, so pass the ABI's null broken stream and select the branch-free
    // native loop. A focused complete-frame sweep retained all hammock modes,
    // baseline/high-stress banner, canopy and cargo-net modes, plus the banner
    // precision mode. Other layouts and the already-amortized batched solver
    // showed no stable win. Tearing cloth remains on the JavaScript path.
    const branchFreeProjection = !this.batchedKernelSolve && (
      this.variant === 4 ||
      (this.mode <= 1 && this.variant >= 1 && this.variant <= 3) ||
      (this.variant === 1 && this.mode === 2)
    );
    const broken = this.tearingEnabled || !branchFreeProjection
      ? arena.copyU8(this.constraintBroken)
      : null;
    let windSinAPointer = 0;
    let windCosAPointer = 0;
    let windSinBPointer = 0;
    let windCosBPointer = 0;
    let windSinZPointer = 0;
    let windCosZPointer = 0;
    let edgeFactorsPointer = 0;
    if (this.fusedKernelStep) {
      windSinAPointer = arena.copyF32(this.windSinA).pointer;
      windCosAPointer = arena.copyF32(this.windCosA).pointer;
      windSinBPointer = arena.copyF32(this.windSinB).pointer;
      windCosBPointer = arena.copyF32(this.windCosB).pointer;
      windSinZPointer = arena.copyF32(this.windSinZ).pointer;
      windCosZPointer = arena.copyF32(this.windCosZ).pointer;
      edgeFactorsPointer = arena.copyF32(this.edgeFactors).pointer;
    }

    this.positions = arena.viewF32(positions.pointer, this.positions.length);
    this.constraintA = arena.viewU16(indicesA.pointer, this.constraintA.length);
    this.constraintB = arena.viewU16(indicesB.pointer, this.constraintB.length);
    this.constraintRest = arena.viewF32(restLengths.pointer, this.constraintRest.length);
    this.constraintFastScaleA = arena.viewF32(scaleA.pointer, this.constraintFastScaleA.length);
    this.constraintFastScaleB = arena.viewF32(scaleB.pointer, this.constraintFastScaleB.length);
    if (broken) this.constraintBroken = arena.viewU8(broken.pointer, this.constraintBroken.length);
    this.kernelPointers = {
      positions: positions.pointer,
      previous: previousPointer,
      inverseMass: inverseMassPointer,
      indicesA: indicesA.pointer,
      indicesB: indicesB.pointer,
      restLengths: restLengths.pointer,
      scaleA: scaleA.pointer,
      scaleB: scaleB.pointer,
      broken: broken?.pointer ?? 0,
      windSinA: windSinAPointer,
      windCosA: windCosAPointer,
      windSinB: windSinBPointer,
      windCosB: windCosBPointer,
      windSinZ: windSinZPointer,
      windCosZ: windCosZPointer,
      edgeFactors: edgeFactorsPointer,
    };
    this.kernelArena = arena;
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Two position-integration substeps plus the bounded projection loop are
    // substantially faster than blindly mirroring the rigid-body substep
    // count, and avoid doing 70+ complete constraint sweeps per frame.
    const steps = Math.min(2, clamp(Math.round(subSteps), 1, 8));
    const subDt = Math.min(dt, 1 / 30) / steps;
    // Intact cloth visual strain is reconstructed from current/rest positions
    // by WebGPU. Only mutable-topology tearing cloth still needs the CPU
    // strain stream.
    if (this.tearingEnabled) this.strain.fill(0);
    for (let sub = 0; sub < steps; sub++) {
      this.time += subDt;
      this.integrateProjectiles(subDt);
      this.integrateParticles(subDt);
      this.collideProjectiles();
      let tearBudget = this.variant === 6 ? 8 : this.mode >= 3 ? 3 : 1;
      const projectionIterations = this.tearingEnabled ? this.iterations : this.fastIterations;
      const useKernelProjection = this.kernelModule !== null &&
        this.kernelPointers !== null && this.projectiles.length === 0;
      if (this.batchedKernelSolve && useKernelProjection) {
        this.kernelModule!.solveCloth(
          this.kernelPointers!,
          this.count,
          this.constraintCountValue,
          projectionIterations,
          0.12,
          0.72,
          this.sphereCenter,
          this.sphereRadius,
        );
      } else if (useKernelProjection) {
        for (let iteration = 0; iteration < projectionIterations; iteration++) {
          this.kernelModule!.projectCloth(this.kernelPointers!, this.constraintCountValue, 1);
          this.solveCollisions();
        }
      } else {
        for (let iteration = 0; iteration < projectionIterations; iteration++) {
          const recordStrain = this.tearingEnabled && sub === steps - 1 && iteration === projectionIterations - 1;
          tearBudget = this.solveConstraints(tearBudget, recordStrain);
          this.solveCollisions();
        }
      }
    }
    this.computeEnergy(dt);
    if (--this.hashCountdown <= 0) {
      this.hashValue = quantizedHash(this.positions, Math.min(this.positions.length, 4096));
      this.hashCountdown = TELEMETRY_INTERVAL_STEPS;
    }
    this.frameVersion++;
  }

  private integrateParticles(dt: number): void {
    const dt2 = dt * dt;
    const referenceRetention = 0.992 - this.stress * 0.0004;
    const drag = Math.pow(referenceRetention, dt * SOFT_REFERENCE_HZ);
    const gust = this.windStrength * (0.72 + 0.28 * Math.sin(this.time * 1.7));
    const vertical = this.verticalLayout;

    // Phase-cache the deterministic wind field. The old implementation called
    // Math.sin three times per moving particle per substep. Angle addition
    // keeps the same periodic frequencies with six trigonometric calls total.
    const timeA = this.time * 3.1;
    const timeB = this.time * 7.3;
    const timeZ = this.time * 1.3;
    const sinA = Math.sin(timeA);
    const cosA = Math.cos(timeA);
    const sinB = Math.sin(timeB);
    const cosB = Math.cos(timeB);
    const sinZ = Math.sin(timeZ);
    const cosZ = Math.cos(timeZ);
    const zScale = vertical ? 0.28 : 0.52;

    if (this.fusedKernelStep && this.kernelModule && this.kernelPointers) {
      this.kernelModule.integrateCloth(
        this.kernelPointers,
        this.count,
        dt2,
        drag,
        gust,
        sinA,
        cosA,
        sinB,
        cosB,
        sinZ,
        cosZ,
        zScale,
        this.variant === 2 ? 1.2 : 0,
        vertical,
      );
      return;
    }

    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      const x = this.positions[o];
      const y = this.positions[o + 1];
      const z = this.positions[o + 2];
      const vx = (x - this.previous[o]) * drag;
      const vy = (y - this.previous[o + 1]) * drag;
      const vz = (z - this.previous[o + 2]) * drag;
      this.previous[o] = x;
      this.previous[o + 1] = y;
      this.previous[o + 2] = z;

      const turbulenceA = sinA * this.windCosA[i] + cosA * this.windSinA[i];
      const turbulenceB = sinB * this.windCosB[i] + cosB * this.windSinB[i];
      const turbulence = turbulenceA + 0.45 * turbulenceB;
      const windX = gust * this.edgeFactors[i] * (0.78 + turbulence * 0.18);
      const windOscillation = sinZ * this.windCosZ[i] + cosZ * this.windSinZ[i];
      const windZ = gust * zScale * windOscillation;
      const lift = vertical ? turbulence * 0.25 : Math.max(0, turbulence) * 0.55 + (this.variant === 2 ? 1.2 : 0);

      this.positions[o] = x + vx + windX * dt2;
      this.positions[o + 1] = y + vy + (this.gravityY + lift) * dt2;
      this.positions[o + 2] = z + vz + windZ * dt2;
    }
  }

  private solveConstraints(tearBudget: number, recordStrain: boolean): number {
    const positions = this.positions;
    const count = this.constraintCountValue;
    const aIndices = this.constraintA;
    const bIndices = this.constraintB;
    const rests = this.constraintRest;
    const scaleAValues = this.tearingEnabled ? this.constraintScaleA : this.constraintFastScaleA;
    const scaleBValues = this.tearingEnabled ? this.constraintScaleB : this.constraintFastScaleB;

    // The overwhelming majority of projection passes do not record strain and
    // most cloth recipes cannot tear. Keep that common path branch-light.
    if (!this.tearingEnabled && !recordStrain) {
      for (let ci = 0; ci < count; ci++) {
        const a = aIndices[ci];
        const b = bIndices[ci];
        const ao = a * 3;
        const bo = b * 3;
        const dx = positions[bo] - positions[ao];
        const dy = positions[bo + 1] - positions[ao + 1];
        const dz = positions[bo + 2] - positions[ao + 2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared < 1e-14) continue;
        const dist = Math.sqrt(distanceSquared);
        const correction = (dist - rests[ci]) / dist;
        const scaleA = correction * scaleAValues[ci];
        const scaleB = correction * scaleBValues[ci];
        positions[ao] += dx * scaleA;
        positions[ao + 1] += dy * scaleA;
        positions[ao + 2] += dz * scaleA;
        positions[bo] -= dx * scaleB;
        positions[bo + 1] -= dy * scaleB;
        positions[bo + 2] -= dz * scaleB;
      }
      return tearBudget;
    }

    const strainValues = this.strain;
    const invRests = this.constraintInvRest;
    const breakThresholds = this.constraintBreakThreshold;
    const broken = this.constraintBroken;
    const edgeTypes = this.constraintEdgeType;
    const edgeIndices = this.constraintEdgeIndex;
    const canTear = this.tearingEnabled;
    for (let ci = 0; ci < count; ci++) {
      const edgeType = edgeTypes[ci];
      if (canTear && edgeType !== 0 && broken[ci] !== 0) continue;
      const a = aIndices[ci];
      const b = bIndices[ci];
      const ao = a * 3;
      const bo = b * 3;
      const dx = positions[bo] - positions[ao];
      const dy = positions[bo + 1] - positions[ao + 1];
      const dz = positions[bo + 2] - positions[ao + 2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared < 1e-14) continue;
      const dist = Math.sqrt(distanceSquared);
      const ratio = dist * invRests[ci];

      if (recordStrain) {
        const strain = Math.abs(ratio - 1);
        if (strain > strainValues[a]) strainValues[a] = strain;
        if (strain > strainValues[b]) strainValues[b] = strain;
      }

      if (canTear && ratio > breakThresholds[ci] && tearBudget > 0 && edgeType !== 0) {
        broken[ci] = 1;
        tearBudget--;
        this.brokenCountValue++;
        this.topologyDirty = true;
        this.topologyVersion++;
        const edgeIndex = edgeIndices[ci];
        if (edgeType === 1 && edgeIndex >= 0) this.horizontalBroken[edgeIndex] = 1;
        if (edgeType === 2 && edgeIndex >= 0) this.verticalBroken[edgeIndex] = 1;
        continue;
      }

      const correction = (dist - rests[ci]) / dist;
      const scaleA = correction * scaleAValues[ci];
      const scaleB = correction * scaleBValues[ci];
      positions[ao] += dx * scaleA;
      positions[ao + 1] += dy * scaleA;
      positions[ao + 2] += dz * scaleA;
      positions[bo] -= dx * scaleB;
      positions[bo + 1] -= dy * scaleB;
      positions[bo + 2] -= dz * scaleB;
    }
    return tearBudget;
  }

  private solveCollisions(): void {
    const sphereTarget = this.sphereRadius + 0.08;
    const sphereTargetSquared = sphereTarget * sphereTarget;
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      if (this.positions[o + 1] < 0.12) {
        this.positions[o + 1] = 0.12;
        this.previous[o] = this.positions[o] - (this.positions[o] - this.previous[o]) * 0.72;
        this.previous[o + 2] = this.positions[o + 2] - (this.positions[o + 2] - this.previous[o + 2]) * 0.72;
      }
      if (this.sphereRadius > 0) {
        const dx = this.positions[o] - this.sphereCenter[0];
        const dy = this.positions[o + 1] - this.sphereCenter[1];
        const dz = this.positions[o + 2] - this.sphereCenter[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= sphereTargetSquared || distanceSquared <= 1e-12) continue;
        const dist = Math.sqrt(distanceSquared);
        if (dist < sphereTarget && dist > 1e-6) {
          const scale = sphereTarget / dist;
          this.positions[o] = this.sphereCenter[0] + dx * scale;
          this.positions[o + 1] = this.sphereCenter[1] + dy * scale;
          this.positions[o + 2] = this.sphereCenter[2] + dz * scale;
        }
      }
    }
  }

  private integrateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      projectile.velocity[1] += this.gravityY * dt;
      projectile.position[0] += projectile.velocity[0] * dt;
      projectile.position[1] += projectile.velocity[1] * dt;
      projectile.position[2] += projectile.velocity[2] * dt;
      if (projectile.position[1] < projectile.radius) {
        projectile.position[1] = projectile.radius;
        projectile.velocity[1] = Math.abs(projectile.velocity[1]) * 0.22;
        projectile.velocity[0] *= 0.72;
        projectile.velocity[2] *= 0.72;
      }
    }
    let write = 0;
    for (let read = 0; read < this.projectiles.length; read++) {
      const projectile = this.projectiles[read];
      if (projectile.life > 0) this.projectiles[write++] = projectile;
    }
    this.projectiles.length = write;
  }

  private collideProjectiles(): void {
    if (this.projectiles.length === 0 || !computeParticleBounds(this.positions, this.invMass, this.count, this.projectileBounds)) return;
    const bounds = this.projectileBounds;
    for (const projectile of this.projectiles) {
      const target = projectile.radius + 0.16;
      if (projectile.position[0] + target < bounds[0] || projectile.position[0] - target > bounds[3] ||
          projectile.position[1] + target < bounds[1] || projectile.position[1] - target > bounds[4] ||
          projectile.position[2] + target < bounds[2] || projectile.position[2] - target > bounds[5]) continue;
      const speed = Math.hypot(projectile.velocity[0], projectile.velocity[1], projectile.velocity[2]);
      const targetSquared = target * target;
      for (let i = 0; i < this.count; i++) {
        if (this.invMass[i] === 0) continue;
        const o = i * 3;
        const dx = this.positions[o] - projectile.position[0];
        const dy = this.positions[o + 1] - projectile.position[1];
        const dz = this.positions[o + 2] - projectile.position[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= targetSquared || distanceSquared < 1e-12) continue;
        const dist = Math.sqrt(distanceSquared);
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const push = (target - dist) + speed * 0.008;
        this.positions[o] += nx * push;
        this.positions[o + 1] += ny * push;
        this.positions[o + 2] += nz * push;
        this.previous[o] -= projectile.velocity[0] * 0.009;
        this.previous[o + 1] -= projectile.velocity[1] * 0.009;
        this.previous[o + 2] -= projectile.velocity[2] * 0.009;
      }
    }
  }

  // Kinetic energy is only read by telemetry, so step() just records dt and
  // the O(particles) sum runs when a frame asks for it.
  private computeEnergy(dt: number): void {
    this.energyDt = dt;
    this.energyDirty = true;
  }

  private currentEnergy(): number {
    if (this.energyDirty) {
      this.energyDirty = false;
      this.computeEnergyNow(this.energyDt);
    }
    return this.energyValue;
  }

  private computeEnergyNow(dt: number): void {
    let energy = 0;
    const invDt = 1 / Math.max(dt, 1e-5);
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const vx = (this.positions[o] - this.previous[o]) * invDt;
      const vy = (this.positions[o + 1] - this.previous[o + 1]) * invDt;
      const vz = (this.positions[o + 2] - this.previous[o + 2]) * invDt;
      energy += vx * vx + vy * vy + vz * vz;
    }
    this.energyValue = energy;
  }

  kick(strength: number): void {
    const impulse = Math.max(1, strength) * 0.018;
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      const wave = 0.35 + 0.65 * ((i % this.cols) / Math.max(1, this.cols - 1));
      this.previous[o] -= impulse * wave;
      this.previous[o + 1] += this.rng.signed(impulse * 0.2);
      this.previous[o + 2] -= this.rng.signed(impulse * 0.45);
    }
    this.frameVersion++;
  }

  explode(center: Vec3, strength: number, radius: number): void {
    const r = Math.max(0.5, radius);
    const rSquared = r * r;
    for (let i = 0; i < this.count; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      const dx = this.positions[o] - center[0];
      const dy = this.positions[o + 1] - center[1];
      const dz = this.positions[o + 2] - center[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= rSquared || distanceSquared < 1e-12) continue;
      const dist = Math.sqrt(distanceSquared);
      if (dist >= r || dist < 1e-6) continue;
      const falloff = 1 - dist / r;
      const impulse = strength * falloff * 0.012;
      this.previous[o] -= (dx / dist) * impulse;
      this.previous[o + 1] -= (dy / dist + 0.35) * impulse;
      this.previous[o + 2] -= (dz / dist) * impulse;
    }
    this.frameVersion++;
  }

  launchProjectile(position: Vec3, velocity: Vec3, size: number): number {
    if (this.projectiles.length >= 24) return -1;
    this.projectiles.push({
      position: [...position] as Vec3,
      velocity: [...velocity] as Vec3,
      radius: clamp(size, 0.18, 1.6),
      life: 8,
      color: [1, 0.62, 0.13, 2.1],
    });
    this.frameVersion++;
    return this.projectiles.length - 1;
  }

  spawnRain(count: number, spread: number, height: number): number {
    const allowed = Math.max(0, Math.min(Math.max(0, Math.round(count)), 160 - this.projectiles.length));
    for (let i = 0; i < allowed; i++) {
      this.projectiles.push({
        position: [this.rng.signed(spread), height + this.rng.range(0, 10), this.rng.signed(spread * 0.65)],
        velocity: [this.rng.signed(0.6), this.rng.range(-12, -7), this.rng.signed(0.6)],
        radius: this.rng.range(0.055, 0.12),
        life: 5,
        color: [0.25, 0.78, 1, 1.8],
      });
    }
    if (allowed > 0) this.frameVersion++;
    return allowed;
  }

  private rebuildTopology(): void {
    if (!this.topologyDirty) return;
    let indexCount = 0;
    const cols = this.cols;
    const rows = this.rows;
    const horizontal = this.horizontalBroken;
    const vertical = this.verticalBroken;
    const indices = this.indexScratch;
    const horizontalStride = cols - 1;

    for (let y = 0; y < rows - 1; y++) {
      const row = y * cols;
      const nextRow = row + cols;
      const horizontalRow = y * horizontalStride;
      const horizontalNext = horizontalRow + horizontalStride;
      const verticalRow = y * cols;
      for (let x = 0; x < cols - 1; x++) {
        if (
          horizontal[horizontalRow + x] !== 0 ||
          horizontal[horizontalNext + x] !== 0 ||
          vertical[verticalRow + x] !== 0 ||
          vertical[verticalRow + x + 1] !== 0
        ) continue;
        const i0 = row + x;
        const i1 = i0 + 1;
        const i2 = nextRow + x;
        const i3 = i2 + 1;
        if (((x + y) & 1) === 0) {
          indices[indexCount++] = i0;
          indices[indexCount++] = i2;
          indices[indexCount++] = i1;
          indices[indexCount++] = i1;
          indices[indexCount++] = i2;
          indices[indexCount++] = i3;
        } else {
          indices[indexCount++] = i0;
          indices[indexCount++] = i2;
          indices[indexCount++] = i3;
          indices[indexCount++] = i0;
          indices[indexCount++] = i3;
          indices[indexCount++] = i1;
        }
      }
    }
    this.cachedIndexCount = indexCount;
    this.topologyDirty = false;
  }

  private buildSurface(): PackedSurfaceFrame {
    this.rebuildTopology();
    const indexCount = this.cachedIndexCount;
    const normals = this.normals;
    const positions = this.positions;
    const indices = this.indexScratch;
    normals.fill(0);

    // Allocation-free triangle normal accumulation.
    for (let i = 0; i < indexCount; i += 3) {
      const ia = indices[i];
      const ib = indices[i + 1];
      const ic = indices[i + 2];
      const ao = ia * 3;
      const bo = ib * 3;
      const co = ic * 3;
      const abx = positions[bo] - positions[ao];
      const aby = positions[bo + 1] - positions[ao + 1];
      const abz = positions[bo + 2] - positions[ao + 2];
      const acx = positions[co] - positions[ao];
      const acy = positions[co + 1] - positions[ao + 1];
      const acz = positions[co + 2] - positions[ao + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      normals[ao] += nx; normals[ao + 1] += ny; normals[ao + 2] += nz;
      normals[bo] += nx; normals[bo + 1] += ny; normals[bo + 2] += nz;
      normals[co] += nx; normals[co + 1] += ny; normals[co + 2] += nz;
    }

    const writer = this.vertices!;
    const f32 = writer.f32;
    const i16 = writer.i16;
    const u8 = writer.u8;
    const baseRgb = this.baseRgb;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      let nx = normals[o];
      let ny = normals[o + 1];
      let nz = normals[o + 2];
      if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) <= 1e-12) {
        if (this.verticalLayout) {
          nx = 0; ny = 0; nz = 1;
        } else {
          nx = 0; ny = 1; nz = 0;
        }
      }

      // Octahedral encoding is homogeneous: L1 normalization below preserves
      // direction, so a prior Euclidean sqrt/normalize pass was redundant.
      const inverseL1 = 1 / Math.max(1e-12, Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
      let ox = nx * inverseL1;
      let oy = ny * inverseL1;
      if (nz < 0) {
        const oldX = ox;
        ox = (1 - Math.abs(oy)) * (oldX < 0 ? -1 : 1);
        oy = (1 - Math.abs(oldX)) * (oy < 0 ? -1 : 1);
      }

      let stress = this.strain[i] * 3.2;
      stress = stress < 0 ? 0 : stress > 1 ? 1 : stress;
      const blend = stress * 0.72;
      const baseR = baseRgb[o];
      const baseG = baseRgb[o + 1];
      const baseB = baseRgb[o + 2];
      const f = i * 6;
      const h = i * 12;
      const byte = i * PACKED_SURFACE_VERTEX_BYTES;
      f32[f] = positions[o];
      f32[f + 1] = positions[o + 1];
      f32[f + 2] = positions[o + 2];
      i16[h + 6] = Math.round((ox < -1 ? -1 : ox > 1 ? 1 : ox) * 32767);
      i16[h + 7] = Math.round((oy < -1 ? -1 : oy > 1 ? 1 : oy) * 32767);
      u8[byte + 16] = Math.round((baseR + (1 - baseR) * blend) * 255);
      u8[byte + 17] = Math.round((baseG + (0.14 - baseG) * blend) * 255);
      u8[byte + 18] = Math.round((baseB + (0.03 - baseB) * blend) * 255);
      u8[byte + 19] = Math.round(stress * 255);
    }

    const surface = this.packedSurfaceResult;
    surface.indexCount = indexCount;
    surface.topologyVersion = this.topologyVersion;
    surface.frameVersion = this.frameVersion;
    this.packedSurfaceFrameVersion = this.frameVersion;
    return surface;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frameResult;
    const matrices = this.instanceMatrices;
    const colors = this.instanceColors;
    let instanceCount = 0;

    if (this.sphereRadius > 0 && instanceCount < CLOTH_INSTANCE_CAP) {
      writeAxisAlignedModelMatrix(
        matrices,
        instanceCount * 16,
        this.sphereCenter,
        this.sphereRadius,
        this.sphereRadius,
        this.sphereRadius,
      );
      setColor(colors, instanceCount, [0.12, 0.18, 0.28, 1]);
      instanceCount++;
    }
    for (const projectile of this.projectiles) {
      if (instanceCount >= CLOTH_INSTANCE_CAP) break;
      writeModelMatrixFromEuler(matrices, instanceCount * 16, projectile.position, [this.time, this.time * 0.7, 0], [projectile.radius, projectile.radius, projectile.radius]);
      setColor(colors, instanceCount, projectile.color);
      instanceCount++;
    }

    const debugLines = this.debugLines;
    debugLines.length = 0;
    if (debug) {
      const count = this.constraintCountValue;
      const stride = Math.max(1, Math.floor(count / 420));
      const positions = this.positions;
      for (let i = 0; i < count; i += stride) {
        if (this.constraintBroken[i] !== 0) continue;
        const a = this.constraintA[i];
        const b = this.constraintB[i];
        const ao = a * 3;
        const bo = b * 3;
        const dx = positions[bo] - positions[ao];
        const dy = positions[bo + 1] - positions[ao + 1];
        const dz = positions[bo + 2] - positions[ao + 2];
        const ratio = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.constraintInvRest[i];
        const tension = clamp((ratio - 1) * 5, 0, 1);
        debugLines.push({
          ax: positions[ao], ay: positions[ao + 1], az: positions[ao + 2],
          bx: positions[bo], by: positions[bo + 1], bz: positions[bo + 2],
          r: 0.2 + tension * 0.8, g: 0.8 - tension * 0.65, b: 1 - tension * 0.8, a: 0.22,
        });
      }
    }

    const frame = this.frameResult;
    frame.instanceCount = instanceCount;
    if (this.tearingEnabled) {
      frame.surface = this.packedSurfaceFrameVersion === this.frameVersion
        ? this.packedSurfaceResult
        : this.buildSurface();
    } else {
      this.rebuildTopology();
      this.gpuSurfaceResult.indexCount = this.cachedIndexCount;
      this.gpuSurfaceResult.topologyVersion = this.topologyVersion;
      this.gpuSurfaceResult.frameVersion = this.frameVersion;
      frame.surface = this.gpuSurfaceResult;
    }
    frame.brokenCount = this.brokenCountValue;
    frame.energy = this.currentEnergy();
    frame.hash = this.hashValue;
    frame.frameVersion = this.frameVersion;
    this.builtFrameVersion = this.frameVersion;
    this.builtFrameDebug = debug;
    return frame;
  }

  currentHash(): number {
    return quantizedHash(this.positions, Math.min(this.positions.length, 4096));
  }

  destroy(): void {
    this.projectiles.length = 0;
  }
}

type RopeConstraint = {
  a: number;
  b: number;
  rest: number;
  solveStiffness: number;
  breakThreshold: number;
  broken: boolean;
  render: boolean;
  radius: number;
  color: [number, number, number, number];
};

type RopePayload = {
  particle: number;
  half: Vec3;
  color: [number, number, number, number];
};

class RopeSimulation implements SoftSimulation {
  readonly kind = 'rope' as const;
  readonly label: string;

  private positions: Float32Array;
  private previous: Float32Array;
  private invMass: Float32Array;
  private constraints: RopeConstraint[] = [];
  private ropeA = EMPTY_UINT16;
  private ropeB = EMPTY_UINT16;
  private ropeRest = EMPTY_FLOAT32;
  private ropeInvRest = EMPTY_FLOAT32;
  private ropeScaleA = EMPTY_FLOAT32;
  private ropeScaleB = EMPTY_FLOAT32;
  private ropeBreakThreshold = EMPTY_FLOAT32;
  private ropeBroken = EMPTY_UINT8;
  private ropeRender = EMPTY_UINT8;
  private ropeRadius = EMPTY_FLOAT32;
  private ropeColor = EMPTY_FLOAT32;
  private ropeConstraintCount = 0;
  private ropeSegmentData = EMPTY_FLOAT32;
  private ropeSegmentCount = 0;
  private ropeTopologyVersion = 1;
  private ropeTopologyBrokenSnapshot = -1;
  private readonly ropeGridResult: RopeGridFrame;
  private payloads: RopePayload[] = [];
  private projectiles: SoftProjectile[] = [];
  private readonly projectileBounds = new Float32Array(6);
  private instanceMatrices: Float32Array<ArrayBufferLike> = new Float32Array(ROPE_INSTANCE_CAP * 16);
  private instanceColors: Float32Array<ArrayBufferLike> = new Float32Array(ROPE_INSTANCE_CAP * 4);
  private readonly debugLines: DebugLine[] = [];
  private readonly frameResult: SoftSimulationFrame;
  private readonly rng: LcgRng;
  private readonly stress: number;
  private readonly variant: number;
  private readonly gravityY: number;
  private readonly mode: number;
  private readonly iterations: number;
  private readonly batchKernelProjection: boolean;
  private windSinA = EMPTY_FLOAT32;
  private windCosA = EMPTY_FLOAT32;
  private windSinZ = EMPTY_FLOAT32;
  private windCosZ = EMPTY_FLOAT32;
  private time = 0;
  private brokenCountValue = 0;
  private energyValue = 0;
  private hashValue = 0;
  private hashCountdown = TELEMETRY_INTERVAL_STEPS;
  private frameVersion = 1;
  private builtFrameVersion = -1;
  private builtFrameDebug = false;
  private readonly kernelModule: SoftKernelModule | null;
  private kernelArena: SoftKernelArena | null = null;
  private kernelConstraintPointers: RopeConstraintPointers | null = null;

  constructor(scene: ScenePreset, stress: number, seed: number, kernelModule: SoftKernelModule | null = null) {
    this.stress = stress;
    this.variant = scene.variant;
    this.mode = scene.mode;
    this.iterations = 6 + stress + (scene.mode >= 3 ? 2 : 0);
    // These maximum-stress layouts remain clear of the intermediate
    // ground/boundary pass. Lower stress geometries can reach that pass at a
    // different projection iteration, so they retain the exact legacy cadence.
    // A 720-frame action-heavy qualification spans every scene and UI stress.
    this.batchKernelProjection = stress === 5 && this.variant !== 4 && this.variant !== 8 &&
      !(this.variant === 0 && (this.mode === 0 || this.mode === 3));
    this.rng = new LcgRng(seed ^ 0x70e5a11);
    this.kernelModule = kernelModule;
    const ropePresentation = conceptPresentation(scene);
    this.label = `${ropePresentation.title} · PBD rope/cable solver`;
    this.gravityY = ropePresentation.binding?.gravity[1] ?? WORLD_GRAVITY[1];

    const positions: number[] = [];
    const invMass: number[] = [];
    const addParticle = (p: Vec3, mass = 1): number => {
      const index = invMass.length;
      positions.push(p[0], p[1], p[2]);
      invMass.push(mass <= 0 ? 0 : 1 / mass);
      return index;
    };
    const addConstraint = (
      a: number,
      b: number,
      stiffness: number,
      breakThreshold: number,
      render: boolean,
      radius: number,
      color: [number, number, number, number],
    ): void => {
      const ao = a * 3;
      const bo = b * 3;
      const rest = Math.hypot(
        positions[bo] - positions[ao],
        positions[bo + 1] - positions[ao + 1],
        positions[bo + 2] - positions[ao + 2],
      );
      this.constraints.push({
        a,
        b,
        rest,
        solveStiffness: 1 - Math.pow(1 - stiffness, 1 / this.iterations),
        breakThreshold,
        broken: false,
        render,
        radius,
        color,
      });
    };
    const addChain = (
      start: Vec3,
      end: Vec3,
      segments: number,
      sag: number,
      pinStart: boolean,
      pinEnd: boolean,
      radius: number,
      color: [number, number, number, number],
      breakThreshold = 1.65,
    ): number[] => {
      const chain: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p: Vec3 = [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t - Math.sin(Math.PI * t) * sag,
          start[2] + (end[2] - start[2]) * t,
        ];
        const pinned = (i === 0 && pinStart) || (i === segments && pinEnd);
        chain.push(addParticle(p, pinned ? 0 : 1));
      }
      for (let i = 0; i < chain.length - 1; i++) {
        addConstraint(chain[i], chain[i + 1], 0.99, breakThreshold, true, radius, color);
      }
      for (let i = 0; i < chain.length - 2; i++) {
        addConstraint(chain[i], chain[i + 2], 0.42, breakThreshold * 1.75, false, radius, color);
      }
      return chain;
    };

    const gold: [number, number, number, number] = [0.94, 0.62, 0.16, 1];
    const steel: [number, number, number, number] = [0.45, 0.62, 0.76, 1];
    const red: [number, number, number, number] = [0.84, 0.18, 0.18, 1];
    const teal: [number, number, number, number] = [0.08, 0.65, 0.72, 1];
    const segments = 28 + stress * 7 + (scene.mode >= 3 ? 6 : 0);
    const weak = this.variant === 5 || this.variant === 8 ? 1.27 + stress * 0.03 : 1.58 + stress * 0.04;

    if (this.variant === 0) {
      const chain = addChain([0, 17, 0], [0, 5.2, 0], segments, 0.3, true, false, 0.10, gold, weak);
      this.payloads.push({ particle: chain[chain.length - 1], half: [1.6, 0.65, 1.0], color: [1, 0.62, 0.12, 1] });
      invMass[chain[chain.length - 1]] = 1 / 8;
    } else if (this.variant === 1) {
      const left = addChain([-16, 9.5, -1.7], [16, 9.5, -1.7], segments, 4.3, true, true, 0.09, teal, weak);
      const right = addChain([-16, 9.5, 1.7], [16, 9.5, 1.7], segments, 4.3, true, true, 0.09, teal, weak);
      for (let i = 0; i < left.length; i += 2) {
        addConstraint(left[i], right[i], 0.95, 1.8, true, 0.13, steel);
      }
    } else if (this.variant === 2) {
      const chain = addChain([0, 17, 0], [8, 5, 0], segments, 1.4, true, false, 0.11, red, weak);
      this.payloads.push({ particle: chain[chain.length - 1], half: [1.2, 1.2, 1.2], color: [0.86, 0.18, 0.12, 1] });
      invMass[chain[chain.length - 1]] = 1 / 11;
    } else if (this.variant === 3) {
      const left = addChain([-2.2, 16, 0], [-2.2, 2.3, 0], segments, 0.3, true, false, 0.075, gold, weak);
      const right = addChain([2.2, 16, 0], [2.2, 2.3, 0], segments, 0.3, true, false, 0.075, gold, weak);
      for (let i = 2; i < Math.min(left.length, right.length); i += 3) {
        addConstraint(left[i], right[i], 0.98, 2.0, true, 0.11, steel);
      }
    } else if (this.variant === 4) {
      const center = addParticle([0, 5.5, 0], 12);
      this.payloads.push({ particle: center, half: [1.4, 0.45, 1.4], color: [0.12, 0.72, 0.82, 1] });
      const anchors: Vec3[] = [[-14, 10, -10], [14, 10, -10], [-14, 10, 10], [14, 10, 10]];
      for (const anchor of anchors) {
        const chain = addChain(anchor, [0, 5.5, 0], Math.max(14, Math.floor(segments * 0.55)), 1.2, true, false, 0.08, teal, weak);
        const end = chain[chain.length - 1];
        addConstraint(end, center, 0.99, weak, true, 0.1, teal);
      }
    } else if (this.variant === 5) {
      for (let lane = -4; lane <= 4; lane++) {
        addChain([lane * 2.2, 16, 0], [lane * 2.2, 1.2, this.rng.signed(0.8)], Math.max(18, Math.floor(segments * 0.65)), 0.2, true, false, 0.055, lane % 2 ? gold : red, weak);
      }
    } else if (this.variant === 6) {
      const chain = addChain([-16, 13, -4], [16, 7, 4], segments, 2.5, true, true, 0.105, teal, weak);
      const riderIndex = chain[Math.floor(chain.length * 0.38)];
      this.payloads.push({ particle: riderIndex, half: [0.7, 1.0, 0.55], color: [0.96, 0.74, 0.18, 1] });
      invMass[riderIndex] = 1 / 6;
    } else if (this.variant === 7) {
      const chain = addChain([-18, 6, 0], [14, 12, 0], segments, 2.0, true, true, 0.09, red, weak);
      this.payloads.push({ particle: chain[Math.floor(chain.length * 0.62)], half: [0.8, 0.55, 0.8], color: [0.22, 0.72, 0.44, 1] });
    } else if (this.variant === 8) {
      const payload = addParticle([0, 5.4, 0], 18);
      this.payloads.push({ particle: payload, half: [2.4, 0.7, 1.5], color: [1, 0.52, 0.1, 1] });
      const anchors: Vec3[] = [[-7, 16, -5], [7, 16, -5], [-7, 16, 5], [7, 16, 5]];
      for (const anchor of anchors) {
        const chain = addChain(anchor, [0, 5.4, 0], Math.max(16, Math.floor(segments * 0.58)), 0.8, true, false, 0.09, gold, weak);
        addConstraint(chain[chain.length - 1], payload, 0.99, weak, true, 0.11, gold);
      }
    } else {
      const horizontal: number[][] = [];
      for (let row = -3; row <= 3; row++) {
        horizontal.push(addChain([-13, 11 + row * 0.55, -4], [13, 11 + row * 0.55, 4], Math.max(18, Math.floor(segments * 0.7)), 2.8, true, true, 0.055, row % 2 ? teal : gold, weak));
      }
      for (let c = 0; c < horizontal[0].length; c += 4) {
        for (let r = 0; r < horizontal.length - 1; r++) {
          addConstraint(horizontal[r][c], horizontal[r + 1][c], 0.9, 1.8, true, 0.045, steel);
        }
      }
    }

    this.positions = new Float32Array(positions);
    if (ropePresentation.binding) {
      rotatePositionsYawPitch(
        this.positions,
        invMass.length,
        ropePresentation.binding.specimenYaw,
        ropePresentation.binding.specimenPitch,
      );
    }
    this.previous = new Float32Array(this.positions);
    this.invMass = new Float32Array(invMass);
    const particleCount = this.invMass.length;
    this.windSinA = new Float32Array(particleCount);
    this.windCosA = new Float32Array(particleCount);
    this.windSinZ = new Float32Array(particleCount);
    this.windCosZ = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const o = i * 3;
      const phaseA = this.positions[o + 1] * 0.32 + this.positions[o + 2] * 0.19;
      const phaseZ = this.positions[o] * 0.2;
      this.windSinA[i] = Math.sin(phaseA);
      this.windCosA[i] = Math.cos(phaseA);
      this.windSinZ[i] = Math.sin(phaseZ);
      this.windCosZ[i] = Math.cos(phaseZ);
    }
    this.packConstraints();
    this.initializeKernelState();
    this.hashValue = quantizedHash(this.positions, Math.min(this.positions.length, 4096));
    this.ropeSegmentData = new Float32Array(Math.max(1, this.ropeConstraintCount) * 8);
    this.ropeGridResult = {
      presentation: 'rope',
      positions: this.positions,
      segments: this.ropeSegmentData,
      nodeCount: this.invMass.length,
      segmentCount: 0,
      topologyVersion: this.ropeTopologyVersion,
      frameVersion: this.frameVersion,
    };
    this.rebuildRopeGridSegments();
    this.frameResult = {
      kind: this.kind, label: this.label, conceptScreen: ropePresentation.conceptScreen,
      camera: ropePresentation.binding?.camera, gravity: ropePresentation.binding?.gravity,
      specimenPose: ropePresentation.binding?.specimenPose,
      matrices: this.instanceMatrices,
      colors: this.instanceColors, instanceCount: 0, surface: null,
      ropeGrid: this.ropeGridResult,
      debugLines: this.debugLines, nodeCount: this.invMass.length,
      constraintCount: this.ropeConstraintCount, brokenCount: 0, energy: 0, hash: this.hashValue,
      frameVersion: this.frameVersion,
    };
    this.buildFrame(false);
  }

  private rebuildRopeGridSegments(): void {
    let count = 0;
    const out = this.ropeSegmentData;
    for (let i = 0; i < this.ropeConstraintCount; i++) {
      if (this.ropeRender[i] === 0 || this.ropeBroken[i] !== 0) continue;
      const target = count * 8;
      const source = i * 4;
      out[target] = this.ropeA[i];
      out[target + 1] = this.ropeB[i];
      out[target + 2] = this.ropeInvRest[i];
      out[target + 3] = this.ropeRadius[i];
      out[target + 4] = this.ropeColor[source];
      out[target + 5] = this.ropeColor[source + 1];
      out[target + 6] = this.ropeColor[source + 2];
      out[target + 7] = this.ropeColor[source + 3];
      count++;
    }
    if (this.ropeTopologyBrokenSnapshot >= 0) this.ropeTopologyVersion++;
    this.ropeTopologyBrokenSnapshot = this.brokenCountValue;
    this.ropeSegmentCount = count;
    this.ropeGridResult.segmentCount = count;
    this.ropeGridResult.topologyVersion = this.ropeTopologyVersion;
  }

  private packConstraints(): void {
    const active = this.constraints.filter((constraint) => {
      return this.invMass[constraint.a] + this.invMass[constraint.b] > 0;
    });
    const count = active.length;
    this.ropeA = new Uint16Array(count);
    this.ropeB = new Uint16Array(count);
    this.ropeRest = new Float32Array(count);
    this.ropeInvRest = new Float32Array(count);
    this.ropeScaleA = new Float32Array(count);
    this.ropeScaleB = new Float32Array(count);
    this.ropeBreakThreshold = new Float32Array(count);
    this.ropeBroken = new Uint8Array(count);
    this.ropeRender = new Uint8Array(count);
    this.ropeRadius = new Float32Array(count);
    this.ropeColor = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const constraint = active[i];
      const wa = this.invMass[constraint.a];
      const wb = this.invMass[constraint.b];
      const inverseWeight = 1 / (wa + wb);
      this.ropeA[i] = constraint.a;
      this.ropeB[i] = constraint.b;
      this.ropeRest[i] = constraint.rest;
      this.ropeInvRest[i] = 1 / Math.max(1e-8, constraint.rest);
      this.ropeScaleA[i] = constraint.solveStiffness * wa * inverseWeight;
      this.ropeScaleB[i] = constraint.solveStiffness * wb * inverseWeight;
      this.ropeBreakThreshold[i] = constraint.breakThreshold;
      this.ropeRender[i] = constraint.render ? 1 : 0;
      this.ropeRadius[i] = constraint.radius;
      const co = i * 4;
      this.ropeColor[co] = constraint.color[0];
      this.ropeColor[co + 1] = constraint.color[1];
      this.ropeColor[co + 2] = constraint.color[2];
      this.ropeColor[co + 3] = constraint.color[3];
    }
    this.ropeConstraintCount = count;
    this.constraints.length = 0;
  }

  private initializeKernelState(): void {
    if (!this.kernelModule || this.ropeConstraintCount <= 0) return;
    const arena = this.kernelModule.createArena();
    const positions = arena.copyF32(this.positions);
    const indicesA = arena.copyU16(this.ropeA);
    const indicesB = arena.copyU16(this.ropeB);
    const restLengths = arena.copyF32(this.ropeRest);
    const inverseRestLengths = arena.copyF32(this.ropeInvRest);
    const scaleA = arena.copyF32(this.ropeScaleA);
    const scaleB = arena.copyF32(this.ropeScaleB);
    const broken = arena.copyU8(this.ropeBroken);
    const render = arena.copyU8(this.ropeRender);
    const breakThresholds = arena.copyF32(this.ropeBreakThreshold);
    const radii = arena.copyF32(this.ropeRadius);
    const baseColors = arena.copyF32(this.ropeColor);
    const matrices = arena.allocBytes(this.instanceMatrices.byteLength, 16);
    const colors = arena.allocBytes(this.instanceColors.byteLength, 16);
    this.positions = arena.viewF32(positions.pointer, this.positions.length);
    this.ropeA = arena.viewU16(indicesA.pointer, this.ropeA.length);
    this.ropeB = arena.viewU16(indicesB.pointer, this.ropeB.length);
    this.ropeRest = arena.viewF32(restLengths.pointer, this.ropeRest.length);
    this.ropeInvRest = arena.viewF32(inverseRestLengths.pointer, this.ropeInvRest.length);
    this.ropeScaleA = arena.viewF32(scaleA.pointer, this.ropeScaleA.length);
    this.ropeScaleB = arena.viewF32(scaleB.pointer, this.ropeScaleB.length);
    this.ropeBroken = arena.viewU8(broken.pointer, this.ropeBroken.length);
    this.ropeRender = arena.viewU8(render.pointer, this.ropeRender.length);
    this.ropeBreakThreshold = arena.viewF32(breakThresholds.pointer, this.ropeBreakThreshold.length);
    this.ropeRadius = arena.viewF32(radii.pointer, this.ropeRadius.length);
    this.ropeColor = arena.viewF32(baseColors.pointer, this.ropeColor.length);
    this.instanceMatrices = arena.viewF32(matrices.pointer, this.instanceMatrices.length);
    this.instanceColors = arena.viewF32(colors.pointer, this.instanceColors.length);
    this.kernelConstraintPointers = {
      positions: positions.pointer,
      indicesA: indicesA.pointer,
      indicesB: indicesB.pointer,
      restLengths: restLengths.pointer,
      inverseRestLengths: inverseRestLengths.pointer,
      scaleA: scaleA.pointer,
      scaleB: scaleB.pointer,
      broken: broken.pointer,
      render: render.pointer,
      breakThresholds: breakThresholds.pointer,
    };
    this.kernelArena = arena;
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const steps = Math.min(3, clamp(Math.round(subSteps), 1, 8));
    const subDt = Math.min(dt, 1 / 30) / steps;
    for (let sub = 0; sub < steps; sub++) {
      this.time += subDt;
      this.integrateProjectiles(subDt);
      this.integrate(subDt);
      this.collideProjectiles();
      let breakBudget = this.mode >= 3 ? 4 : 1;
      if (this.batchKernelProjection && this.kernelModule && this.kernelConstraintPointers) {
        const newlyBroken = this.kernelModule.projectRope(
          this.kernelConstraintPointers,
          this.ropeConstraintCount,
          this.iterations,
          breakBudget,
        );
        this.brokenCountValue += newlyBroken;
        this.solveCollisions();
        continue;
      }
      for (let iteration = 0; iteration < this.iterations; iteration++) {
        if (this.kernelModule && this.kernelConstraintPointers) {
          const newlyBroken = this.kernelModule.projectRope(
            this.kernelConstraintPointers,
            this.ropeConstraintCount,
            1,
            breakBudget,
          );
          this.brokenCountValue += newlyBroken;
          breakBudget = Math.max(0, breakBudget - newlyBroken);
        } else {
          breakBudget = this.solveConstraints(breakBudget);
        }
        this.solveCollisions();
      }
    }
    this.computeEnergy(dt);
    if (--this.hashCountdown <= 0) {
      this.hashValue = quantizedHash(this.positions, Math.min(this.positions.length, 4096));
      this.hashCountdown = TELEMETRY_INTERVAL_STEPS;
    }
    this.frameVersion++;
  }

  private integrate(dt: number): void {
    const dt2 = dt * dt;
    const timeA = this.time * 1.8;
    const timeZ = this.time * 1.1;
    const sinA = Math.sin(timeA);
    const cosA = Math.cos(timeA);
    const sinZ = Math.sin(timeZ);
    const cosZ = Math.cos(timeZ);
    const windScale = 0.8 + this.stress * 0.2;
    const drag = Math.pow(0.994, dt * SOFT_REFERENCE_HZ);
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      const x = this.positions[o];
      const y = this.positions[o + 1];
      const z = this.positions[o + 2];
      const vx = (x - this.previous[o]) * drag;
      const vy = (y - this.previous[o + 1]) * drag;
      const vz = (z - this.previous[o + 2]) * drag;
      this.previous[o] = x;
      this.previous[o + 1] = y;
      this.previous[o + 2] = z;
      const wind = (sinA * this.windCosA[i] + cosA * this.windSinA[i]) * windScale;
      const crossWind = (cosZ * this.windCosZ[i] - sinZ * this.windSinZ[i]) * 0.38;
      this.positions[o] = x + vx + wind * dt2;
      this.positions[o + 1] = y + vy + this.gravityY * dt2;
      this.positions[o + 2] = z + vz + crossWind * dt2;
    }
  }

  private solveConstraints(breakBudget: number): number {
    const positions = this.positions;
    const count = this.ropeConstraintCount;
    const aIndices = this.ropeA;
    const bIndices = this.ropeB;
    const rests = this.ropeRest;
    const invRests = this.ropeInvRest;
    const scaleAValues = this.ropeScaleA;
    const scaleBValues = this.ropeScaleB;
    const broken = this.ropeBroken;
    const render = this.ropeRender;
    const breakThresholds = this.ropeBreakThreshold;
    for (let ci = 0; ci < count; ci++) {
      if (broken[ci] !== 0) continue;
      const a = aIndices[ci];
      const b = bIndices[ci];
      const ao = a * 3;
      const bo = b * 3;
      const dx = positions[bo] - positions[ao];
      const dy = positions[bo + 1] - positions[ao + 1];
      const dz = positions[bo + 2] - positions[ao + 2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared < 1e-14) continue;
      const dist = Math.sqrt(distanceSquared);
      if (render[ci] !== 0 && breakBudget > 0 && dist * invRests[ci] > breakThresholds[ci]) {
        broken[ci] = 1;
        this.brokenCountValue++;
        breakBudget--;
        continue;
      }
      const correction = (dist - rests[ci]) / dist;
      const scaleA = correction * scaleAValues[ci];
      const scaleB = correction * scaleBValues[ci];
      positions[ao] += dx * scaleA;
      positions[ao + 1] += dy * scaleA;
      positions[ao + 2] += dz * scaleA;
      positions[bo] -= dx * scaleB;
      positions[bo + 1] -= dy * scaleB;
      positions[bo + 2] -= dz * scaleB;
    }
    return breakBudget;
  }

  private solveCollisions(): void {
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      if (this.positions[o + 1] < 0.16) {
        this.positions[o + 1] = 0.16;
        this.previous[o] = this.positions[o] - (this.positions[o] - this.previous[o]) * 0.65;
        this.previous[o + 2] = this.positions[o + 2] - (this.positions[o + 2] - this.previous[o + 2]) * 0.65;
      }
      this.positions[o] = clamp(this.positions[o], -42, 42);
      this.positions[o + 2] = clamp(this.positions[o + 2], -42, 42);
    }
  }

  private integrateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      projectile.velocity[1] += this.gravityY * dt;
      projectile.position[0] += projectile.velocity[0] * dt;
      projectile.position[1] += projectile.velocity[1] * dt;
      projectile.position[2] += projectile.velocity[2] * dt;
    }
    let write = 0;
    for (let read = 0; read < this.projectiles.length; read++) {
      const projectile = this.projectiles[read];
      if (projectile.life > 0 && projectile.position[1] >= -4) this.projectiles[write++] = projectile;
    }
    this.projectiles.length = write;
  }

  private collideProjectiles(): void {
    if (this.projectiles.length === 0 || !computeParticleBounds(this.positions, this.invMass, this.invMass.length, this.projectileBounds)) return;
    const bounds = this.projectileBounds;
    for (const projectile of this.projectiles) {
      const target = projectile.radius + 0.22;
      if (projectile.position[0] + target < bounds[0] || projectile.position[0] - target > bounds[3] ||
          projectile.position[1] + target < bounds[1] || projectile.position[1] - target > bounds[4] ||
          projectile.position[2] + target < bounds[2] || projectile.position[2] - target > bounds[5]) continue;
      const speed = Math.hypot(projectile.velocity[0], projectile.velocity[1], projectile.velocity[2]);
      const targetSquared = target * target;
      for (let i = 0; i < this.invMass.length; i++) {
        if (this.invMass[i] === 0) continue;
        const o = i * 3;
        const dx = this.positions[o] - projectile.position[0];
        const dy = this.positions[o + 1] - projectile.position[1];
        const dz = this.positions[o + 2] - projectile.position[2];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared > targetSquared || distanceSquared < 1e-12) continue;
        const d = Math.sqrt(distanceSquared);
        const impulse = speed * 0.012;
        this.previous[o] -= projectile.velocity[0] * 0.012;
        this.previous[o + 1] -= projectile.velocity[1] * 0.012;
        this.previous[o + 2] -= projectile.velocity[2] * 0.012;
        if (speed > 14) this.breakNearestConstraint(projectile.position, projectile.radius + 0.9);
        this.positions[o] += (dx / d) * impulse;
        this.positions[o + 1] += (dy / d) * impulse;
        this.positions[o + 2] += (dz / d) * impulse;
      }
    }
  }

  private breakNearestConstraint(center: Vec3, radius: number): boolean {
    let best = -1;
    let bestDistanceSquared = radius * radius;
    const positions = this.positions;
    for (let i = 0; i < this.ropeConstraintCount; i++) {
      if (this.ropeRender[i] === 0 || this.ropeBroken[i] !== 0) continue;
      const ao = this.ropeA[i] * 3;
      const bo = this.ropeB[i] * 3;
      const dx = (positions[ao] + positions[bo]) * 0.5 - center[0];
      const dy = (positions[ao + 1] + positions[bo + 1]) * 0.5 - center[1];
      const dz = (positions[ao + 2] + positions[bo + 2]) * 0.5 - center[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = i;
      }
    }
    if (best < 0) return false;
    this.ropeBroken[best] = 1;
    this.brokenCountValue++;
    return true;
  }

  private computeEnergy(dt: number): void {
    const invDt = 1 / Math.max(1e-5, dt);
    let energy = 0;
    for (let i = 0; i < this.invMass.length; i++) {
      const o = i * 3;
      const vx = (this.positions[o] - this.previous[o]) * invDt;
      const vy = (this.positions[o + 1] - this.previous[o + 1]) * invDt;
      const vz = (this.positions[o + 2] - this.previous[o + 2]) * invDt;
      energy += vx * vx + vy * vy + vz * vz;
    }
    this.energyValue = energy;
  }

  kick(strength: number): void {
    const scale = Math.max(1, strength) * 0.026;
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      this.previous[o] -= scale * (0.6 + this.rng.next01() * 0.5);
      this.previous[o + 1] += this.rng.signed(scale * 0.18);
      this.previous[o + 2] -= this.rng.signed(scale * 0.55);
    }
    this.frameVersion++;
  }

  explode(center: Vec3, strength: number, radius: number): void {
    const r = Math.max(1, radius);
    const rSquared = r * r;
    for (let i = 0; i < this.invMass.length; i++) {
      if (this.invMass[i] === 0) continue;
      const o = i * 3;
      const dx = this.positions[o] - center[0];
      const dy = this.positions[o + 1] - center[1];
      const dz = this.positions[o + 2] - center[2];
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= rSquared || distanceSquared < 1e-12) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d >= r || d < 1e-6) continue;
      const impulse = (1 - d / r) * strength * 0.018;
      this.previous[o] -= (dx / d) * impulse;
      this.previous[o + 1] -= (dy / d + 0.25) * impulse;
      this.previous[o + 2] -= (dz / d) * impulse;
    }
    if (strength > 15) {
      for (let i = 0; i < Math.min(4, Math.floor(strength / 8)); i++) this.breakNearestConstraint(center, r * 0.75);
    }
    this.frameVersion++;
  }

  launchProjectile(position: Vec3, velocity: Vec3, size: number): number {
    if (this.projectiles.length >= 16) return -1;
    this.projectiles.push({
      position: [...position] as Vec3,
      velocity: [...velocity] as Vec3,
      radius: clamp(size, 0.2, 1.5),
      life: 8,
      color: [1, 0.42, 0.08, 2.4],
    });
    this.frameVersion++;
    return this.projectiles.length - 1;
  }

  spawnRain(count: number, spread: number, height: number): number {
    const allowed = Math.max(0, Math.min(Math.max(0, Math.round(count)), 96 - this.projectiles.length));
    for (let i = 0; i < allowed; i++) {
      this.projectiles.push({
        position: [this.rng.signed(spread), height + this.rng.range(0, 12), this.rng.signed(spread)],
        velocity: [this.rng.signed(1), this.rng.range(-14, -8), this.rng.signed(1)],
        radius: this.rng.range(0.08, 0.18),
        life: 5,
        color: [0.2, 0.72, 1, 1.8],
      });
    }
    if (allowed > 0) this.frameVersion++;
    return allowed;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frameResult;
    const maxCount = ROPE_INSTANCE_CAP;
    const matrices = this.instanceMatrices;
    const colors = this.instanceColors;
    let instanceCount = 0;

    // Rope segments are now published as compact node/segment data and
    // expanded by WebGPU. Rebuild immutable metadata only when a cable break
    // changes the active render topology; payloads and projectiles continue
    // to use the shared CPU instance stream.
    if (this.ropeTopologyBrokenSnapshot !== this.brokenCountValue) this.rebuildRopeGridSegments();

    for (const payload of this.payloads) {
      if (instanceCount >= maxCount) break;
      const p = readPosition(this.positions, payload.particle);
      const o = payload.particle * 3;
      const vx = this.positions[o] - this.previous[o];
      const vz = this.positions[o + 2] - this.previous[o + 2];
      writeModelMatrixFromEuler(matrices, instanceCount * 16, p, [vz * 0.8, 0, -vx * 0.8], payload.half);
      setColor(colors, instanceCount, payload.color);
      instanceCount++;
    }

    for (const projectile of this.projectiles) {
      if (instanceCount >= maxCount) break;
      writeModelMatrixFromEuler(matrices, instanceCount * 16, projectile.position, [this.time * 1.8, this.time, 0], [projectile.radius, projectile.radius, projectile.radius]);
      setColor(colors, instanceCount, projectile.color);
      instanceCount++;
    }

    const debugLines = this.debugLines;
    debugLines.length = 0;
    if (debug) {
      for (let i = 0; i < this.invMass.length; i += Math.max(1, Math.floor(this.invMass.length / 160))) {
        const p = readPosition(this.positions, i);
        const pinned = this.invMass[i] === 0;
        debugLines.push({
          ax: p[0] - 0.12, ay: p[1], az: p[2], bx: p[0] + 0.12, by: p[1], bz: p[2],
          r: pinned ? 1 : 0.2, g: pinned ? 0.72 : 0.85, b: pinned ? 0.12 : 1, a: 0.7,
        });
      }
    }

    const frame = this.frameResult;
    frame.instanceCount = instanceCount;
    frame.nodeCount = this.invMass.length;
    frame.constraintCount = this.ropeConstraintCount;
    frame.brokenCount = this.brokenCountValue;
    frame.energy = this.energyValue;
    frame.hash = this.hashValue;
    frame.frameVersion = this.frameVersion;
    this.ropeGridResult.frameVersion = this.frameVersion;
    this.ropeGridResult.segmentCount = this.ropeSegmentCount;
    this.ropeGridResult.topologyVersion = this.ropeTopologyVersion;
    this.builtFrameVersion = this.frameVersion;
    this.builtFrameDebug = debug;
    return frame;
  }

  currentHash(): number {
    return quantizedHash(this.positions, Math.min(this.positions.length, 4096));
  }

  destroy(): void {
    this.constraints = [];
    this.ropeA = EMPTY_UINT16;
    this.ropeB = EMPTY_UINT16;
    this.ropeRest = EMPTY_FLOAT32;
    this.ropeInvRest = EMPTY_FLOAT32;
    this.ropeScaleA = EMPTY_FLOAT32;
    this.ropeScaleB = EMPTY_FLOAT32;
    this.ropeBreakThreshold = EMPTY_FLOAT32;
    this.ropeBroken = EMPTY_UINT8;
    this.ropeRender = EMPTY_UINT8;
    this.ropeRadius = EMPTY_FLOAT32;
    this.ropeColor = EMPTY_FLOAT32;
    this.ropeConstraintCount = 0;
    this.ropeSegmentData = EMPTY_FLOAT32;
    this.ropeSegmentCount = 0;
    this.payloads = [];
    this.projectiles = [];
    this.positions = EMPTY_FLOAT32;
    this.previous = EMPTY_FLOAT32;
    this.invMass = EMPTY_FLOAT32;
    this.windSinA = EMPTY_FLOAT32;
    this.windCosA = EMPTY_FLOAT32;
    this.windSinZ = EMPTY_FLOAT32;
    this.windCosZ = EMPTY_FLOAT32;
  }
}

type WaterDroplet = {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  life: number;
};

type WaterFloater = {
  position: Vec3;
  velocity: Vec3;
  half: Vec3;
  color: [number, number, number, number];
  mass: number;
};

class WaterSimulation implements SoftSimulation {
  readonly kind = 'water' as const;
  readonly label: string;

  private readonly cols: number;
  private readonly rows: number;
  private readonly count: number;
  private readonly width: number;
  private readonly depth: number;
  private readonly dx: number;
  private readonly dz: number;
  private readonly baseY: number;
  private eta: Float32Array;
  private u: Float32Array;
  private v: Float32Array;
  private nextEta: Float32Array;
  private nextU: Float32Array;
  private nextV: Float32Array;
  private readonly indices: Uint16Array;
  private readonly worldX: Float32Array;
  private readonly worldZ: Float32Array;
  private readonly invTwoDx: number;
  private readonly invTwoDz: number;
  private sampleHeight = 0;
  private sampleVelocityX = 0;
  private sampleVelocityZ = 0;
  private readonly instanceMatrices = new Float32Array(WATER_INSTANCE_CAP * 16);
  private readonly instanceColors = new Float32Array(WATER_INSTANCE_CAP * 4);
  private readonly debugLines: DebugLine[] = [];
  private readonly gpuSurfaceResult: GpuWaterSurfaceFrame;
  private readonly frameResult: SoftSimulationFrame;
  private readonly droplets: WaterDroplet[] = [];
  private readonly floaters: WaterFloater[] = [];
  private readonly rng: LcgRng;
  private readonly stress: number;
  private readonly variant: number;
  private readonly gravityY: number;
  private readonly gravityMagnitude: number;
  private readonly mode: number;
  private time = 0;
  private energyValue = 0;
  private hashValue = 0;
  private hashCountdown = TELEMETRY_INTERVAL_STEPS;
  private frameVersion = 1;
  private builtFrameVersion = -1;
  private builtFrameDebug = false;
  private readonly kernelModule: SoftKernelModule | null;
  private kernelArena: SoftKernelArena | null = null;
  private kernelPointers: WaterKernelPointers | null = null;

  constructor(scene: ScenePreset, stress: number, seed: number, kernelModule: SoftKernelModule | null = null) {
    this.stress = stress;
    this.variant = scene.variant;
    this.mode = scene.mode;
    this.cols = Math.min(96, 44 + stress * 8 + (scene.mode >= 3 ? 8 : 0));
    this.rows = Math.min(80, 34 + stress * 6 + (scene.mode === 4 ? 6 : 0));
    this.count = this.cols * this.rows;
    this.width = 34;
    this.depth = 24;
    this.dx = this.width / Math.max(1, this.cols - 1);
    this.dz = this.depth / Math.max(1, this.rows - 1);
    this.baseY = 1.45;
    this.eta = new Float32Array(this.count);
    this.u = new Float32Array(this.count);
    this.v = new Float32Array(this.count);
    this.nextEta = new Float32Array(this.count);
    this.nextU = new Float32Array(this.count);
    this.nextV = new Float32Array(this.count);
    this.indices = new Uint16Array(Math.max(0, (this.cols - 1) * (this.rows - 1) * 6));
    this.worldX = new Float32Array(this.cols);
    this.worldZ = new Float32Array(this.rows);
    this.invTwoDx = 1 / (2 * this.dx);
    this.invTwoDz = 1 / (2 * this.dz);
    this.rng = new LcgRng(seed ^ 0x57a7e12);
    this.kernelModule = kernelModule;
    const waterPresentation = conceptPresentation(scene);
    this.label = `${waterPresentation.title} · linear shallow-water ${this.cols}×${this.rows}`;
    this.gravityY = waterPresentation.binding?.gravity[1] ?? WORLD_GRAVITY[1];
    this.gravityMagnitude = Math.abs(this.gravityY);
    this.initializeSurface();
    this.initializeGridCache();
    this.initializeVariants();
    this.initializeKernelState();
    this.hashValue = quantizedHash(this.eta, Math.min(this.eta.length, 4096));
    this.gpuSurfaceResult = {
      path: 'gpu-water', material: 'water', eta: this.eta, u: this.u, v: this.v,
      indices: this.indices, vertexCount: this.count, indexCount: this.indices.length,
      topologyVersion: 1, frameVersion: this.frameVersion,
      cols: this.cols, rows: this.rows, width: this.width, depth: this.depth, baseY: this.baseY,
    };
    this.frameResult = {
      kind: this.kind, label: this.label, conceptScreen: waterPresentation.conceptScreen,
      camera: waterPresentation.binding?.camera, gravity: waterPresentation.binding?.gravity,
      specimenPose: waterPresentation.binding?.specimenPose,
      matrices: this.instanceMatrices,
      colors: this.instanceColors, instanceCount: 0, surface: this.gpuSurfaceResult,
      ropeGrid: null,
      debugLines: this.debugLines, nodeCount: this.count,
      constraintCount: Math.max(0, (this.cols - 2) * (this.rows - 2) * 3),
      brokenCount: 0, energy: 0, hash: this.hashValue, frameVersion: this.frameVersion,
    };
  }

  private index(x: number, z: number): number { return z * this.cols + x; }

  private worldToGrid(x: number, z: number): [number, number] {
    return [
      (x / this.width + 0.5) * (this.cols - 1),
      (z / this.depth + 0.5) * (this.rows - 1),
    ];
  }

  private gridToWorld(x: number, z: number): [number, number] {
    return [
      (x / Math.max(1, this.cols - 1) - 0.5) * this.width,
      (z / Math.max(1, this.rows - 1) - 0.5) * this.depth,
    ];
  }

  private initializeGridCache(): void {
    const invCols = 1 / Math.max(1, this.cols - 1);
    const invRows = 1 / Math.max(1, this.rows - 1);
    for (let x = 0; x < this.cols; x++) {
      const u = x * invCols;
      this.worldX[x] = (u - 0.5) * this.width;
    }
    for (let z = 0; z < this.rows; z++) {
      const v = z * invRows;
      this.worldZ[z] = (v - 0.5) * this.depth;
    }
  }

  private initializeSurface(): void {
    let cursor = 0;
    for (let z = 0; z < this.rows - 1; z++) {
      for (let x = 0; x < this.cols - 1; x++) {
        const i0 = this.index(x, z);
        const i1 = this.index(x + 1, z);
        const i2 = this.index(x, z + 1);
        const i3 = this.index(x + 1, z + 1);
        this.indices[cursor++] = i0;
        this.indices[cursor++] = i2;
        this.indices[cursor++] = i1;
        this.indices[cursor++] = i1;
        this.indices[cursor++] = i2;
        this.indices[cursor++] = i3;
      }
    }
  }

  private initializeVariants(): void {
    if (this.variant === 0) {
      this.disturb(0, 0, 0.9, 2.2, 1.4);
      this.disturb(-7, 3, 0.45, 1.2, 0.6);
    } else if (this.variant === 1) {
      for (let z = 0; z < this.rows; z++) {
        for (let x = 0; x < Math.floor(this.cols * 0.18); x++) {
          this.eta[this.index(x, z)] = 1.2 * (1 - x / Math.max(1, this.cols * 0.18));
          this.u[this.index(x, z)] = 1.8;
        }
      }
    } else if (this.variant === 2) {
      for (let z = 0; z < this.rows; z++) {
        for (let x = 0; x < this.cols; x++) {
          const [wx, wz] = this.gridToWorld(x, z);
          this.eta[this.index(x, z)] = Math.sin(wx * 0.55) * 0.12 + Math.cos(wz * 0.72) * 0.09 + this.rng.signed(0.025);
          this.u[this.index(x, z)] = Math.sin(wz * 0.4) * 0.35;
          this.v[this.index(x, z)] = Math.cos(wx * 0.32) * 0.28;
        }
      }
    } else if (this.variant === 3) {
      this.floaters.push({ position: [-12, this.baseY + 0.7, 0], velocity: [2.2, 0, 0.45], half: [1.8, 0.42, 0.75], color: [0.95, 0.42, 0.08, 1], mass: 4 });
    } else if (this.variant === 4) {
      this.disturb(0, 0, 1.2, 1.6, 2.2);
    } else if (this.variant === 5) {
      this.spawnRain(80 + this.stress * 30, 15, 11);
    } else if (this.variant === 6) {
      for (let z = 0; z < this.rows; z++) {
        for (let x = 0; x < this.cols; x++) {
          if (x < this.cols * 0.42) this.eta[this.index(x, z)] = 0.75;
        }
      }
    } else if (this.variant === 7) {
      for (let z = 0; z < this.rows; z++) {
        for (let x = 0; x < this.cols; x++) {
          const [wx, wz] = this.gridToWorld(x, z);
          const r = Math.hypot(wx, wz) + 0.3;
          this.u[this.index(x, z)] = -wz / r * 1.2;
          this.v[this.index(x, z)] = wx / r * 1.2;
          this.eta[this.index(x, z)] = -Math.exp(-r * 0.24) * 0.45;
        }
      }
    } else if (this.variant === 8) {
      this.floaters.push({ position: [-6, this.baseY + 0.5, -2], velocity: [0.3, 0, 0.1], half: [1.2, 0.35, 0.8], color: [0.18, 0.48, 0.78, 1], mass: 3 });
      this.floaters.push({ position: [5, this.baseY + 0.45, 3], velocity: [-0.2, 0, -0.1], half: [0.8, 0.3, 0.6], color: [0.92, 0.72, 0.22, 1], mass: 2 });
    } else {
      this.floaters.push({ position: [0, this.baseY + 2.4, 0], velocity: [0, -1, 0], half: [1.3, 1.3, 1.3], color: [0.82, 0.18, 0.12, 1], mass: 12 });
      this.disturb(0, 0, 1.6, 2.5, 2.6);
    }
  }

  private initializeKernelState(): void {
    if (!this.kernelModule) return;
    const arena = this.kernelModule.createArena();
    const eta = arena.copyF32(this.eta);
    const velocityX = arena.copyF32(this.u);
    const velocityZ = arena.copyF32(this.v);
    const nextEta = arena.copyF32(this.nextEta);
    const nextVelocityX = arena.copyF32(this.nextU);
    const nextVelocityZ = arena.copyF32(this.nextV);

    this.eta = arena.viewF32(eta.pointer, this.count);
    this.u = arena.viewF32(velocityX.pointer, this.count);
    this.v = arena.viewF32(velocityZ.pointer, this.count);
    this.nextEta = arena.viewF32(nextEta.pointer, this.count);
    this.nextU = arena.viewF32(nextVelocityX.pointer, this.count);
    this.nextV = arena.viewF32(nextVelocityZ.pointer, this.count);
    this.kernelPointers = {
      eta: eta.pointer,
      velocityX: velocityX.pointer,
      velocityZ: velocityZ.pointer,
      nextEta: nextEta.pointer,
      nextVelocityX: nextVelocityX.pointer,
      nextVelocityZ: nextVelocityZ.pointer,
    };
    this.kernelArena = arena;
  }

  step(dt: number, subSteps: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const steps = clamp(Math.round(subSteps), 1, 8);
    const subDt = Math.min(dt, 1 / 30) / steps;
    for (let sub = 0; sub < steps; sub++) {
      const previousTime = this.time;
      this.time += subDt;
      this.applyAutomaticForcing(previousTime, subDt);
      this.solveShallowWater(subDt);
      this.updateDroplets(subDt);
      this.updateFloaters(subDt);
    }
    if (--this.hashCountdown <= 0) {
      this.computeEnergy();
      this.hashValue = quantizedHash(this.eta, Math.min(this.eta.length, 4096));
      this.hashCountdown = TELEMETRY_INTERVAL_STEPS;
    }
    this.frameVersion++;
  }

  private applyAutomaticForcing(previousTime: number, dt: number): void {
    if (this.variant === 0) {
      // Tick crossings, rather than a fixed 1/60 look-back window, guarantee
      // exactly one seeded event regardless of the requested substep count.
      const previousTick = Math.floor(previousTime * 2.2);
      const currentTick = Math.floor(this.time * 2.2);
      for (let tick = previousTick + 1; tick <= currentTick; tick++) {
        this.disturb(this.rng.signed(11), this.rng.signed(7), this.rng.range(0.2, 0.55), this.rng.range(0.7, 1.5), 0.7);
      }
      return;
    }
    // The remaining sources are continuous rates authored at 60 Hz. Scale
    // their height and velocity injection by elapsed time so extra substeps
    // refine the forcing rather than multiplying it.
    const forcingScale = dt * SOFT_REFERENCE_HZ;
    if (this.variant === 2) {
      const z = Math.sin(this.time * 0.45) * 8;
      this.disturb(-16, z, Math.sin(this.time * 2.4) * 0.035 * forcingScale, 1.4, 0.12 * forcingScale);
    } else if (this.variant === 3) {
      const x = -14 + (this.time * 3.1) % 28;
      const z = Math.sin(this.time * 0.9) * 3.8;
      this.disturb(x, z, -0.055 * forcingScale, 0.8, 0.35 * forcingScale);
      this.disturb(x - 1.2, z + 0.8, 0.045 * forcingScale, 0.7, 0.24 * forcingScale);
      this.disturb(x - 1.2, z - 0.8, 0.045 * forcingScale, 0.7, 0.24 * forcingScale);
    } else if (this.variant === 4) {
      this.disturb(0, 0, Math.sin(this.time * 5.2) * 0.045 * forcingScale, 1.0, 0.16 * forcingScale);
    } else if (this.variant === 7) {
      const angle = this.time * 1.4;
      this.disturb(Math.cos(angle) * 4, Math.sin(angle) * 4, -0.035 * forcingScale, 1.1, 0.28 * forcingScale);
    }
  }

  private solveShallowWater(dt: number): void {
    const gravity = this.gravityMagnitude;
    const meanDepth = 1.35 + this.stress * 0.05;
    const drag = 0.28 + this.mode * 0.025;
    if (this.kernelModule && this.kernelPointers && this.kernelModule.stepWater(
      this.kernelPointers,
      this.cols,
      this.rows,
      dt,
      gravity,
      meanDepth,
      drag,
      this.invTwoDx,
      this.invTwoDz,
    )) {
      [this.eta, this.nextEta] = [this.nextEta, this.eta];
      [this.u, this.nextU] = [this.nextU, this.u];
      [this.v, this.nextV] = [this.nextV, this.v];
      [this.kernelPointers.eta, this.kernelPointers.nextEta] = [this.kernelPointers.nextEta, this.kernelPointers.eta];
      [this.kernelPointers.velocityX, this.kernelPointers.nextVelocityX] = [this.kernelPointers.nextVelocityX, this.kernelPointers.velocityX];
      [this.kernelPointers.velocityZ, this.kernelPointers.nextVelocityZ] = [this.kernelPointers.nextVelocityZ, this.kernelPointers.velocityZ];
      return;
    }
    const cols = this.cols;
    const rows = this.rows;
    const eta = this.eta;
    const u = this.u;
    const v = this.v;
    const nextEta = this.nextEta;
    const nextU = this.nextU;
    const nextV = this.nextV;
    const velocityDecay = 1 - drag * dt;
    const pressureX = gravity * dt * this.invTwoDx;
    const pressureZ = gravity * dt * this.invTwoDz;
    const continuityX = meanDepth * dt * this.invTwoDx;
    const continuityZ = meanDepth * dt * this.invTwoDz;

    // Every destination cell is written below, so copying three complete grids
    // with TypedArray.set() is unnecessary bandwidth. Pre-fold timestep and
    // grid constants to remove six multiplications per cell.
    for (let z = 1; z < rows - 1; z++) {
      const row = z * cols;
      const rowEnd = row + cols - 1;
      for (let i = row + 1; i < rowEnd; i++) {
        nextU[i] = u[i] * velocityDecay - (eta[i + 1] - eta[i - 1]) * pressureX;
        nextV[i] = v[i] * velocityDecay - (eta[i + cols] - eta[i - cols]) * pressureZ;
      }
    }

    for (let z = 1; z < rows - 1; z++) {
      const row = z * cols;
      const rowEnd = row + cols - 1;
      for (let i = row + 1; i < rowEnd; i++) {
        const next = eta[i]
          - (nextU[i + 1] - nextU[i - 1]) * continuityX
          - (nextV[i + cols] - nextV[i - cols]) * continuityZ;
        nextEta[i] = next < -1.65 ? -1.65 : next > 1.65 ? 1.65 : next;
      }
    }

    const bottomRow = (rows - 1) * cols;
    const innerBottom = (rows - 2) * cols;
    for (let x = 0; x < cols; x++) {
      nextEta[x] = nextEta[cols + x] * 0.92;
      nextU[x] = nextU[cols + x] * 0.78;
      nextV[x] = -nextV[cols + x] * 0.18;
      const bottom = bottomRow + x;
      const inner = innerBottom + x;
      nextEta[bottom] = nextEta[inner] * 0.92;
      nextU[bottom] = nextU[inner] * 0.78;
      nextV[bottom] = -nextV[inner] * 0.18;
    }
    for (let z = 0; z < rows; z++) {
      const row = z * cols;
      const leftInner = row + 1;
      const right = row + cols - 1;
      const rightInner = right - 1;
      nextEta[row] = nextEta[leftInner] * 0.92;
      nextU[row] = -nextU[leftInner] * 0.18;
      nextV[row] = nextV[leftInner] * 0.78;
      nextEta[right] = nextEta[rightInner] * 0.92;
      nextU[right] = -nextU[rightInner] * 0.18;
      nextV[right] = nextV[rightInner] * 0.78;
    }

    this.eta = nextEta;
    this.nextEta = eta;
    this.u = nextU;
    this.nextU = u;
    this.v = nextV;
    this.nextV = v;
  }

  private disturb(x: number, z: number, amplitude: number, radius: number, radialVelocity: number): void {
    const gx = (x / this.width + 0.5) * (this.cols - 1);
    const gz = (z / this.depth + 0.5) * (this.rows - 1);
    const rx = Math.ceil(radius / this.dx) + 1;
    const rz = Math.ceil(radius / this.dz) + 1;
    const minX = Math.max(1, Math.floor(gx) - rx);
    const maxX = Math.min(this.cols - 2, Math.ceil(gx) + rx);
    const minZ = Math.max(1, Math.floor(gz) - rz);
    const maxZ = Math.min(this.rows - 2, Math.ceil(gz) + rz);
    const radiusSquared = radius * radius;
    const inverseRadius = 1 / Math.max(0.001, radius);
    const cols = this.cols;
    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = this.worldZ[iz];
      const row = iz * cols;
      for (let ix = minX; ix <= maxX; ix++) {
        const dx = this.worldX[ix] - x;
        const dz = wz - z;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > radiusSquared) continue;
        const distance = Math.sqrt(distanceSquared);
        const falloff = 0.5 + 0.5 * Math.cos(distance * inverseRadius * Math.PI);
        const i = row + ix;
        const nextHeight = this.eta[i] + amplitude * falloff;
        this.eta[i] = nextHeight < -1.65 ? -1.65 : nextHeight > 1.65 ? 1.65 : nextHeight;
        if (distance > 1e-5) {
          const radialScale = radialVelocity * falloff / distance;
          this.u[i] += dx * radialScale;
          this.v[i] += dz * radialScale;
        }
      }
    }
  }

  private sampleIntoScratch(x: number, z: number): void {
    let gx = (x / this.width + 0.5) * (this.cols - 1);
    let gz = (z / this.depth + 0.5) * (this.rows - 1);
    const maxX = this.cols - 1.001;
    const maxZ = this.rows - 1.001;
    gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
    gz = gz < 0 ? 0 : gz > maxZ ? maxZ : gz;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = gx - x0;
    const tz = gz - z0;
    const oneMinusX = 1 - tx;
    const oneMinusZ = 1 - tz;
    const i00 = z0 * this.cols + x0;
    const i10 = i00 + 1;
    const i01 = z1 * this.cols + x0;
    const i11 = i01 + 1;
    const etaA = this.eta[i00] * oneMinusX + this.eta[i10] * tx;
    const etaB = this.eta[i01] * oneMinusX + this.eta[i11] * tx;
    const uA = this.u[i00] * oneMinusX + this.u[i10] * tx;
    const uB = this.u[i01] * oneMinusX + this.u[i11] * tx;
    const vA = this.v[i00] * oneMinusX + this.v[i10] * tx;
    const vB = this.v[i01] * oneMinusX + this.v[i11] * tx;
    this.sampleHeight = this.baseY + etaA * oneMinusZ + etaB * tz;
    this.sampleVelocityX = uA * oneMinusZ + uB * tz;
    this.sampleVelocityZ = vA * oneMinusZ + vB * tz;
  }

  private sampleHeightIntoScratch(x: number, z: number): void {
    let gx = (x / this.width + 0.5) * (this.cols - 1);
    let gz = (z / this.depth + 0.5) * (this.rows - 1);
    const maxX = this.cols - 1.001;
    const maxZ = this.rows - 1.001;
    gx = gx < 0 ? 0 : gx > maxX ? maxX : gx;
    gz = gz < 0 ? 0 : gz > maxZ ? maxZ : gz;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const tz = gz - z0;
    const oneMinusX = 1 - tx;
    const oneMinusZ = 1 - tz;
    const i00 = z0 * this.cols + x0;
    const i10 = i00 + 1;
    const i01 = i00 + this.cols;
    const i11 = i01 + 1;
    const etaA = this.eta[i00] * oneMinusX + this.eta[i10] * tx;
    const etaB = this.eta[i01] * oneMinusX + this.eta[i11] * tx;
    this.sampleHeight = this.baseY + etaA * oneMinusZ + etaB * tz;
  }

  private updateDroplets(dt: number): void {
    if (this.droplets.length >= 128) {
      this.updateDropletsFast(dt);
      return;
    }
    for (const droplet of this.droplets) {
      droplet.life -= dt;
      droplet.velocity[1] += this.gravityY * dt;
      droplet.position[0] += droplet.velocity[0] * dt;
      droplet.position[1] += droplet.velocity[1] * dt;
      droplet.position[2] += droplet.velocity[2] * dt;
      this.sampleIntoScratch(droplet.position[0], droplet.position[2]);
      if (droplet.position[1] <= this.sampleHeight && droplet.life > 0) {
        const speed = Math.abs(droplet.velocity[1]);
        this.disturb(droplet.position[0], droplet.position[2], clamp(speed * 0.025, 0.04, 0.36), clamp(droplet.radius * 5, 0.5, 1.6), speed * 0.025);
        droplet.life = 0;
      }
    }
    let write = 0;
    for (let read = 0; read < this.droplets.length; read++) {
      const droplet = this.droplets[read];
      if (droplet.life > 0) this.droplets[write++] = droplet;
    }
    this.droplets.length = write;
  }

  private updateDropletsFast(dt: number): void {
    for (const droplet of this.droplets) {
      droplet.life -= dt;
      if (droplet.life <= 0) continue;
      droplet.velocity[1] += this.gravityY * dt;
      droplet.position[0] += droplet.velocity[0] * dt;
      droplet.position[1] += droplet.velocity[1] * dt;
      droplet.position[2] += droplet.velocity[2] * dt;
      this.sampleHeightIntoScratch(droplet.position[0], droplet.position[2]);
      if (droplet.position[1] <= this.sampleHeight) {
        const speed = Math.abs(droplet.velocity[1]);
        this.disturb(droplet.position[0], droplet.position[2], clamp(speed * 0.025, 0.04, 0.36), clamp(droplet.radius * 5, 0.5, 1.6), speed * 0.025);
        droplet.life = 0;
      }
    }
    let write = 0;
    for (let read = 0; read < this.droplets.length; read++) {
      const droplet = this.droplets[read];
      if (droplet.life > 0) this.droplets[write++] = droplet;
    }
    this.droplets.length = write;
  }

  private updateFloaters(dt: number): void {
    const planarRetention = Math.pow(0.998, dt * SOFT_REFERENCE_HZ);
    const verticalRetention = Math.pow(0.995, dt * SOFT_REFERENCE_HZ);
    for (const floater of this.floaters) {
      this.sampleIntoScratch(floater.position[0], floater.position[2]);
      const bottom = floater.position[1] - floater.half[1];
      const submergence = clamp((this.sampleHeight - bottom) / Math.max(0.1, floater.half[1] * 2), 0, 1.4);
      const buoyancy = 15.5 * submergence / Math.max(0.5, floater.mass * 0.35);
      floater.velocity[1] += (this.gravityY + buoyancy) * dt;
      floater.velocity[0] += (this.sampleVelocityX - floater.velocity[0]) * submergence * dt * 1.8;
      floater.velocity[2] += (this.sampleVelocityZ - floater.velocity[2]) * submergence * dt * 1.8;
      floater.velocity[0] *= planarRetention;
      floater.velocity[1] *= verticalRetention;
      floater.velocity[2] *= planarRetention;
      floater.position[0] += floater.velocity[0] * dt;
      floater.position[1] += floater.velocity[1] * dt;
      floater.position[2] += floater.velocity[2] * dt;
      if (floater.position[1] - floater.half[1] < 0.15) {
        floater.position[1] = floater.half[1] + 0.15;
        floater.velocity[1] = Math.abs(floater.velocity[1]) * 0.18;
      }
      if (Math.abs(floater.position[0]) > this.width * 0.47) floater.velocity[0] *= -0.55;
      if (Math.abs(floater.position[2]) > this.depth * 0.47) floater.velocity[2] *= -0.55;
      const couplingScale = dt * SOFT_REFERENCE_HZ;
      this.disturb(
        floater.position[0],
        floater.position[2],
        -submergence * 0.006 * couplingScale,
        Math.max(floater.half[0], floater.half[2]) * 1.6,
        submergence * 0.015 * couplingScale,
      );
    }
  }

  private computeEnergy(): void {
    let energy = 0;
    for (let i = 0; i < this.count; i++) {
      energy += this.eta[i] * this.eta[i] * this.gravityMagnitude + this.u[i] * this.u[i] + this.v[i] * this.v[i];
    }
    this.energyValue = energy;
  }

  kick(strength: number): void {
    const amplitude = clamp(strength * 0.08, 0.2, 1.2);
    this.disturb(-this.width * 0.36, 0, amplitude, 3.2, strength * 0.08);
    for (let z = 1; z < this.rows - 1; z++) {
      const i = this.index(2, z);
      this.u[i] += strength * 0.14;
    }
    this.frameVersion++;
  }

  explode(center: Vec3, strength: number, radius: number): void {
    this.disturb(center[0], center[2], clamp(strength * 0.07, 0.35, 1.65), clamp(radius * 0.32, 1.2, 5.2), strength * 0.09);
    this.sampleIntoScratch(center[0], center[2]);
    const splashHeight = this.sampleHeight;
    const splashCount = Math.max(0, Math.min(
      180,
      Math.max(20, Math.round(strength * 5)),
      MAX_WATER_DROPLETS - this.droplets.length,
    ));
    const speedScale = Math.sqrt(Math.max(1, strength) / 12);
    for (let i = 0; i < splashCount; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const speed = this.rng.range(2, 7) * speedScale;
      this.droplets.push({
        position: [center[0] + cosine * this.rng.range(0, 1.2), splashHeight + this.rng.range(0.1, 0.5), center[2] + sine * this.rng.range(0, 1.2)],
        velocity: [cosine * speed, this.rng.range(4, 10), sine * speed],
        radius: this.rng.range(0.04, 0.11),
        life: this.rng.range(1, 3),
      });
    }
    this.frameVersion++;
  }

  launchProjectile(position: Vec3, velocity: Vec3, size: number): number {
    if (this.floaters.length >= MAX_WATER_FLOATERS) return -1;
    this.floaters.push({
      position: [...position] as Vec3,
      velocity: [...velocity] as Vec3,
      half: [size, size, size],
      color: [1, 0.46, 0.08, 2.1],
      mass: 8 + size * 8,
    });
    this.frameVersion++;
    return this.floaters.length - 1;
  }

  spawnRain(count: number, spread: number, height: number): number {
    const allowed = Math.max(0, Math.min(Math.max(0, Math.round(count)), MAX_WATER_DROPLETS - this.droplets.length));
    for (let i = 0; i < allowed; i++) {
      this.droplets.push({
        position: [this.rng.signed(Math.min(spread, this.width * 0.48)), height + this.rng.range(0, 10), this.rng.signed(Math.min(spread, this.depth * 0.48))],
        velocity: [this.rng.signed(0.45), this.rng.range(-12, -7), this.rng.signed(0.45)],
        radius: this.rng.range(0.025, 0.075),
        life: 4,
      });
    }
    if (allowed > 0) this.frameVersion++;
    return allowed;
  }

  buildFrame(debug: boolean): SoftSimulationFrame {
    if (this.builtFrameVersion === this.frameVersion && this.builtFrameDebug === debug) return this.frameResult;
    const maxCount = WATER_INSTANCE_CAP;
    const matrices = this.instanceMatrices;
    const colors = this.instanceColors;
    let instanceCount = 0;
    for (const floater of this.floaters) {
      if (instanceCount >= maxCount) break;
      this.sampleIntoScratch(floater.position[0], floater.position[2]);
      const pitch = clamp((this.sampleVelocityZ - floater.velocity[2]) * 0.08, -0.35, 0.35);
      const roll = clamp((floater.velocity[0] - this.sampleVelocityX) * 0.08, -0.35, 0.35);
      writeModelMatrixFromEuler(matrices, instanceCount * 16, floater.position, [pitch, 0, roll], floater.half);
      setColor(colors, instanceCount, floater.color);
      instanceCount++;
    }
    for (const droplet of this.droplets) {
      if (instanceCount >= maxCount) break;
      writeAxisAlignedModelMatrix(
        matrices,
        instanceCount * 16,
        droplet.position,
        droplet.radius,
        droplet.radius * 1.9,
        droplet.radius,
      );
      setColor(colors, instanceCount, [0.18, 0.68, 1, 1.7]);
      instanceCount++;
    }

    const debugLines = this.debugLines;
    debugLines.length = 0;
    if (debug) {
      const stepX = Math.max(3, Math.floor(this.cols / 12));
      const stepZ = Math.max(3, Math.floor(this.rows / 9));
      for (let z = stepZ; z < this.rows - stepZ; z += stepZ) {
        for (let x = stepX; x < this.cols - stepX; x += stepX) {
          const i = this.index(x, z);
          const [wx, wz] = this.gridToWorld(x, z);
          const y = this.baseY + this.eta[i] + 0.05;
          debugLines.push({
            ax: wx, ay: y, az: wz,
            bx: wx + this.u[i] * 0.55, by: y, bz: wz + this.v[i] * 0.55,
            r: 0.18, g: 0.82, b: 1, a: 0.55,
          });
        }
      }
    }

    const frame = this.frameResult;
    frame.instanceCount = instanceCount;
    this.gpuSurfaceResult.eta = this.eta;
    this.gpuSurfaceResult.u = this.u;
    this.gpuSurfaceResult.v = this.v;
    this.gpuSurfaceResult.frameVersion = this.frameVersion;
    frame.surface = this.gpuSurfaceResult;
    frame.nodeCount = this.count + this.droplets.length + this.floaters.length;
    frame.energy = this.energyValue;
    frame.hash = this.hashValue;
    frame.frameVersion = this.frameVersion;
    this.builtFrameVersion = this.frameVersion;
    this.builtFrameDebug = debug;
    return frame;
  }

  currentHash(): number {
    return quantizedHash(this.eta, Math.min(this.eta.length, 4096));
  }

  destroy(): void {
    this.droplets.length = 0;
    this.floaters.length = 0;
    this.eta = EMPTY_FLOAT32;
    this.u = EMPTY_FLOAT32;
    this.v = EMPTY_FLOAT32;
    this.nextEta = EMPTY_FLOAT32;
    this.nextU = EMPTY_FLOAT32;
    this.nextV = EMPTY_FLOAT32;
  }
}

const EMPTY_FRAME: SoftSimulationFrame = {
  kind: 'none',
  label: 'Rigid-body only',
  matrices: EMPTY_FLOAT32,
  colors: EMPTY_FLOAT32,
  instanceCount: 0,
  surface: null,
  ropeGrid: null,
  debugLines: [],
  nodeCount: 0,
  constraintCount: 0,
  brokenCount: 0,
  energy: 0,
  hash: 0,
  frameVersion: 0,
  material: null,
};

export class SoftSimulationSuite {
  private active: SoftSimulation | null = null;
  private lastScene: ScenePreset | null = null;
  private lastStress = 1;
  private lastSeed = 0;

  constructor(private readonly kernelModule: SoftKernelModule | null = null) {}

  createScene(scene: ScenePreset, stress: number, seed: number): boolean {
    this.active?.destroy();
    this.active = null;
    this.lastScene = scene;
    this.lastStress = clamp(Math.round(stress), 1, 5);
    this.lastSeed = seed >>> 0;
    if (!softFamily(scene.family)) return false;
    if (scene.family === 'cloth') this.active = new ClothSimulation(scene, this.lastStress, this.lastSeed, this.kernelModule);
    else if (scene.family === 'rope') this.active = new RopeSimulation(scene, this.lastStress, this.lastSeed, this.kernelModule);
    else if (scene.family === 'water') this.active = new WaterSimulation(scene, this.lastStress, this.lastSeed, this.kernelModule);
    else if (getMaterialDemoRecipe(scene.materialDemoId)?.kind === 'combined') {
      this.active = new CombinedMaterialSimulation(scene, this.lastStress, this.lastSeed);
    } else this.active = new MaterialSimulation(scene, this.lastStress, this.lastSeed);
    return true;
  }

  reset(): void {
    if (this.lastScene) this.createScene(this.lastScene, this.lastStress, this.lastSeed);
  }

  isActive(): boolean { return this.active !== null; }
  kind(): SoftSimulationKind { return this.active?.kind ?? 'none'; }
  label(): string { return this.active?.label ?? EMPTY_FRAME.label; }

  step(dt: number, subSteps: number): void { this.active?.step(dt, subSteps); }
  kick(strength: number): void { this.active?.kick(strength); }
  explode(center: Vec3, strength: number, radius: number): void { this.active?.explode(center, strength, radius); }
  launchProjectile(position: Vec3, velocity: Vec3, size: number): number { return this.active?.launchProjectile(position, velocity, size) ?? -1; }
  spawnRain(count: number, spread: number, height: number): number { return this.active?.spawnRain(count, spread, height) ?? 0; }
  setLoadTarget(target: number): void { this.active?.setLoadTarget?.(target); }
  releaseLoad(): void { this.active?.releaseLoad?.(); }
  cycleLoad(): void { this.active?.cycleLoad?.(); }
  dentStrike(strength = 1): number { return this.active?.dentStrike?.(strength) ?? -1; }
  materialStrike(strength = 1): number { return this.active?.materialStrike?.(strength) ?? -1; }
  materialStrikeAt(u: number, v: number, strength = 1, radiusScale = 1): number {
    return this.active?.materialStrikeAt?.(u, v, strength, radiusScale) ?? -1;
  }
  setMaterialLoadTarget(target: CombinedMaterialTarget, value: number): void {
    if (this.active?.setMaterialLoadTarget) this.active.setMaterialLoadTarget(target, value);
    else this.active?.setLoadTarget?.(value);
  }
  releaseMaterialLoad(target: CombinedMaterialTarget): void {
    if (this.active?.releaseMaterialLoad) this.active.releaseMaterialLoad(target);
    else this.active?.releaseLoad?.();
  }
  materialStrikeTarget(target: CombinedMaterialTarget, strength = 1): number {
    if (this.active?.materialStrikeTarget) return this.active.materialStrikeTarget(target, strength);
    return this.active?.materialStrike?.(strength) ?? -1;
  }
  materialStrikeAtTarget(
    target: CombinedMaterialTarget,
    u: number,
    v: number,
    strength = 1,
    radiusScale = 1,
  ): number {
    if (this.active?.materialStrikeAtTarget) {
      return this.active.materialStrikeAtTarget(target, u, v, strength, radiusScale);
    }
    return this.active?.materialStrikeAt?.(u, v, strength, radiusScale) ?? -1;
  }
  dentStrikeTarget(target: CombinedMaterialTarget, strength = 1): number {
    if (this.active?.materialStrikeTarget) return this.active.materialStrikeTarget(target, strength);
    return this.active?.dentStrike?.(strength) ?? -1;
  }
  buildFrame(debug = false): SoftSimulationFrame {
    const frame = this.active?.buildFrame(debug) ?? EMPTY_FRAME;
    if (frame.kind === 'none' || !this.lastScene) return frame;
    const presentation = conceptPresentation(this.lastScene);
    if (!presentation.binding) return frame;
    if (!frame.conceptScreen) frame.conceptScreen = presentation.conceptScreen;
    if (!frame.camera) frame.camera = presentation.binding.camera;
    if (!frame.gravity) frame.gravity = presentation.binding.gravity;
    if (!frame.specimenPose) frame.specimenPose = presentation.binding.specimenPose;
    return frame;
  }
  hash(): number { return this.active?.currentHash() ?? 0; }

  destroy(): void {
    this.active?.destroy();
    this.active = null;
  }

  validate(): { ok: boolean; message: string } {
    const frame = this.buildFrame(false);
    if (frame.kind === 'none') return { ok: true, message: 'No soft simulation active.' };
    if (frame.instanceCount < 0 || frame.instanceCount > MAX_SOFT_INSTANCES) {
      return { ok: false, message: `${frame.kind} exceeded the ${MAX_SOFT_INSTANCES}-instance soft simulation budget.` };
    }
    if (frame.matrices.length < frame.instanceCount * 16 || frame.colors.length < frame.instanceCount * 4) {
      return { ok: false, message: `${frame.kind} instance stream lengths do not match the declared instance count.` };
    }
    if (!isFiniteArray(frame.matrices) || !isFiniteArray(frame.colors)) {
      return { ok: false, message: `${frame.kind} instance stream contains non-finite values.` };
    }
    if (!Number.isFinite(frame.energy) || frame.energy < 0 || !Number.isInteger(frame.hash)) {
      return { ok: false, message: `${frame.kind} telemetry contains invalid energy or replay-hash values.` };
    }
    if (!Number.isInteger(frame.frameVersion) || frame.frameVersion < 0) {
      return { ok: false, message: `${frame.kind} frame version is invalid.` };
    }
    if (frame.surface) {
      if (frame.surface.vertexCount <= 0 || frame.surface.indexCount <= 0) {
        return { ok: false, message: `${frame.kind} surface topology is empty.` };
      }
      switch (frame.surface.path) {
        case 'packed':
          if (
            (frame.surface.material !== 'cloth' && frame.surface.material !== 'sheet') ||
            frame.surface.vertexStride !== PACKED_SURFACE_VERTEX_BYTES ||
            frame.surface.vertices.byteLength !== frame.surface.vertexCount * frame.surface.vertexStride
          ) {
            return { ok: false, message: `${frame.kind} packed surface vertex stride/count is inconsistent.` };
          }
          if (!packedSurfacePositionsAreFinite(frame.surface.vertices, frame.surface.vertexCount)) {
            return { ok: false, message: `${frame.kind} packed surface stream is invalid.` };
          }
          break;
        case 'gpu-cloth':
          if (
            frame.surface.positions.length < frame.surface.vertexCount * 3 ||
            frame.surface.restPositions.length < frame.surface.vertexCount * 3 ||
            !isFiniteArray(frame.surface.positions) ||
            !isFiniteArray(frame.surface.restPositions)
          ) {
            return { ok: false, message: `${frame.kind} GPU-cloth state stream is invalid.` };
          }
          break;
        case 'gpu-water':
          if (
            frame.surface.eta.length < frame.surface.vertexCount ||
            frame.surface.u.length < frame.surface.vertexCount ||
            frame.surface.v.length < frame.surface.vertexCount ||
            !isFiniteArray(frame.surface.eta) || !isFiniteArray(frame.surface.u) || !isFiniteArray(frame.surface.v)
          ) {
            return { ok: false, message: `${frame.kind} GPU-water state stream is invalid.` };
          }
          break;
        default: {
          const _exhaustive: never = frame.surface;
          return { ok: false, message: `Unhandled surface path: ${String(_exhaustive)}` };
        }
      }
      if (frame.surface.indices.length < frame.surface.indexCount) {
        return { ok: false, message: `${frame.kind} surface index stream is truncated.` };
      }
      for (let i = 0; i < frame.surface.indexCount; i++) {
        if (frame.surface.indices[i] >= frame.surface.vertexCount) {
          return { ok: false, message: `${frame.kind} surface index ${frame.surface.indices[i]} is out of range.` };
        }
      }
    }
    if (frame.ropeGrid) {
      const rope = frame.ropeGrid;
      if (
        (rope.presentation !== 'rope' && rope.presentation !== 'material') ||
        rope.nodeCount <= 0 ||
        rope.segmentCount < 0 ||
        rope.positions.length < rope.nodeCount * 3 ||
        rope.segments.length < rope.segmentCount * 8 ||
        !isFiniteArray(rope.positions) ||
        !isFiniteArray(rope.segments)
      ) {
        return { ok: false, message: `${frame.kind} GPU-rope state stream is invalid.` };
      }
      for (let i = 0; i < rope.segmentCount; i++) {
        const offset = i * 8;
        const a = rope.segments[offset];
        const b = rope.segments[offset + 1];
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= rope.nodeCount || b >= rope.nodeCount) {
          return { ok: false, message: `${frame.kind} GPU-rope segment ${i} references an invalid node.` };
        }
      }
    }
    if (frame.kind === 'fracture') {
      const material = frame.material;
      if (!material || material.label.length < 3 || material.testMode.length < 3) {
        return { ok: false, message: 'fracture material telemetry did not initialize.' };
      }
      if (
        !Number.isFinite(material.loadTarget) || !Number.isFinite(material.loadProgress) ||
        !Number.isFinite(material.maxStrain) || !Number.isFinite(material.yieldStrain) ||
        !Number.isFinite(material.breakStrain) || !Number.isFinite(material.peakDamage) ||
        !Number.isFinite(material.centerDeflection) || !Number.isFinite(material.peakDeflection) ||
        !Number.isFinite(material.residualDent) ||
        !Number.isFinite(material.fracturedCellCount) || !Number.isFinite(material.fragmentCount) ||
        !Number.isFinite(material.reinforcementCount) ||
        material.loadTarget < 0 || material.loadProgress < 0 || material.peakDamage < 0 || material.peakDamage > 1 ||
        material.centerDeflection < 0 || material.peakDeflection < material.centerDeflection ||
        material.residualDent < 0 || material.residualDent > material.peakDeflection + 1e-6 ||
        material.yieldStrain <= 0 || material.breakStrain <= material.yieldStrain ||
        material.yieldedCount < 0 || material.damagedCount < 0
        || material.fracturedCellCount < 0 || material.fragmentCount < 0 || material.reinforcementCount < 0
      ) {
        return { ok: false, message: 'fracture material telemetry contains invalid normalized values.' };
      }
    }
    if (frame.nodeCount <= 0 || frame.hash === 0) return { ok: false, message: `${frame.kind} telemetry did not initialize.` };
    return { ok: true, message: `${frame.kind} validated: ${frame.nodeCount} nodes, ${frame.constraintCount} constraints.` };
  }
}

export const SOFT_INSTANCE_BUDGET = MAX_SOFT_INSTANCES;
// The renderer stages GPU-expanded rope/material segments and CPU proxy
// instances in the same instanced buffer. Reserve the true combined material
// ceiling so a full rigid world still retains the complete Ultra VFX budget.
export const SOFT_RENDER_INSTANCE_BUDGET = Math.max(MAX_SOFT_INSTANCES, MATERIAL_RENDER_INSTANCE_BUDGET);
export const CLOTH_INSTANCE_BUDGET = CLOTH_INSTANCE_CAP;
export const ROPE_INSTANCE_BUDGET = ROPE_INSTANCE_CAP;
export const WATER_INSTANCE_BUDGET = WATER_INSTANCE_CAP;
export const SOFT_SURFACE_VERTEX_BYTES = SURFACE_VERTEX_BYTES;
export const EMPTY_SURFACE: DynamicSurfaceFrame = {
  path: 'packed',
  material: 'cloth',
  vertices: EMPTY_UINT8,
  indices: EMPTY_UINT16,
  vertexStride: PACKED_SURFACE_VERTEX_BYTES,
  vertexCount: 0,
  indexCount: 0,
  topologyVersion: 0,
  frameVersion: 0,
};
