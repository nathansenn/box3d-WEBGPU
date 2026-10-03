import {
  LcgRng,
  clamp,
  writeAxisAlignedModelMatrix,
  writeModelMatrixFromEuler,
  type Vec3,
} from '../math';
import { getMaterialDemoRecipe, type MaterialDemoRecipe } from '../material-demos';
import type { ScenePreset } from '../scenes';
import { quantizedHash as sharedQuantizedHash } from './quantized-hash';
import type { DebugLine, MaterialFailureTelemetry, PackedSurfaceFrame, RopeGridFrame } from '../types';
import type { SoftSimulation, SoftSimulationFrame } from './simulations';
import { materialPresetForVariant, type MaterialBehaviorPreset } from './material-presets';
import {
  PACKED_SURFACE_VERTEX_BYTES,
  PackedSurfaceBuffer,
  writePackedSurfaceVertex,
} from './packed-surface';
import {
  areaWeightedMass,
  collideDynamicSphere,
  polylineBendAngle,
  projectKinematicCapsule,
  projectKinematicSphere,
  projectStationSelfContact,
  projectXpbdAngle,
  type SphereContactAccum,
} from './material-shell';

const MAX_PROJECTILES = 64;
const MAX_FIXTURE_INSTANCES = 512;
const MAX_MATERIAL_FRAGMENTS = 384;
const MAX_CPU_INSTANCES = MAX_PROJECTILES + MAX_FIXTURE_INSTANCES + MAX_MATERIAL_FRAGMENTS;
export const MATERIAL_RENDER_SEGMENT_BUDGET = 2400;
export const MATERIAL_RENDER_INSTANCE_BUDGET = MAX_CPU_INSTANCES + MATERIAL_RENDER_SEGMENT_BUDGET;
const TELEMETRY_INTERVAL = 8;
const MIN_STRIKE_RADIUS_SCALE = 0.25;
const MAX_STRIKE_RADIUS_SCALE = 4;
const REFERENCE_SIMULATION_HZ = 60;
// Material presets were authored against four projection slices per 60 Hz
// frame. Treat that cadence as part of the normalized reduced-order model so
// quality substeps redistribute, rather than multiply or dilute, its response.
const MATERIAL_REFERENCE_SOLVE_SLICES = 4;
const MATERIAL_MAX_SOLVE_SLICES = 16;
const CONCRETE_MATRIX_TENSILE_YIELD_SCALE = 1.8;
const CONCRETE_MATRIX_TENSILE_BREAK_SCALE = 3.2;
/**
 * Comparative discrete-shell hinge stiffness (not N·m/rad). XPBD uses
 * α̃ = 1/(k Δt²). Bending k scales with thicknessScale³.
 */
const SHELL_BEND_K = 420;
/** Skip-2 chords stay as a weaker in-plane regularizer once hinges own flexure. */
const SKIP_BEND_SCALE = 0.62;
/** Must stay inside the renderer packed-surface upload caps. */
const SHEET_SKIN_MAX_VERTICES = 16384;
const SHEET_SKIN_MAX_INDICES = 98304;
const SHEET_TEAR_STRETCH = 2.55;
const SHEET_FAILED_TEAR_STRETCH = 1.18;
const SHEET_NOTCH_TEAR_STRETCH = 1.065;
const SHEET_NOTCH_FAILED_TEAR_STRETCH = 1.012;
const PUNCHING_CONE_CELL_RADIUS = 3.4;
const PUNCHING_CONE_CELL_CAP = 28;

// Normalized open hat/omega section sampled by the crash-rail lattice. Each
// entry is [z/depth, y/depth]; interpolation keeps the profile valid if a
// caller reduces the authored thirteen-lane presentation grid.
const CRASH_RAIL_SECTION: readonly (readonly [number, number])[] = [
  [-0.50, -0.34], [-0.42, -0.34], [-0.36, -0.27],
  [-0.31, 0.23], [-0.24, 0.38], [-0.12, 0.42],
  [0.00, 0.42], [0.12, 0.42], [0.24, 0.38],
  [0.31, 0.23], [0.36, -0.27], [0.42, -0.34],
  [0.50, -0.34],
] as const;

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

type HingeSeed = {
  a: number;
  b: number;
  c: number;
  rest: number;
  stiffness: number;
  yieldAngle: number;
  breakAngle: number;
  plasticCreep: number;
};

function quantizedHash(values: ArrayLike<number>, seed = 2166136261): number {
  return sharedQuantizedHash(values, 100000, values.length, seed);
}

function setColor(out: Float32Array, index: number, color: readonly number[]): void {
  const offset = index * 4;
  out[offset] = color[0];
  out[offset + 1] = color[1];
  out[offset + 2] = color[2];
  out[offset + 3] = color[3];
}

function diagnosticContourColor(value: number): readonly [number, number, number, number] {
  const t = clamp(value, 0, 1);
  const stops = [
    [0.141, 0.286, 0.780],
    [0.000, 0.722, 0.690],
    [0.482, 0.863, 0.231],
    [0.953, 0.824, 0.184],
    [0.863, 0.231, 0.184],
  ] as const;
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
    -8,
  ];
}

function responseContourColor(value: number): readonly [number, number, number, number] {
  const t = clamp(value, 0, 1);
  const stops = [
    [0.18, 0.055, 0.42],
    [0.43, 0.08, 0.66],
    [0.77, 0.11, 0.54],
    [0.95, 0.27, 0.24],
    [1.00, 0.78, 0.10],
  ] as const;
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
    -7,
  ];
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

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sheetSkinLayout(stations: number, lanes: number): { div: number; cols: number; rows: number; midCount: number } {
  const safeStations = Math.max(2, stations);
  const safeLanes = Math.max(2, lanes);
  for (const div of [4, 3, 2, 1]) {
    const cols = (safeStations - 1) * div + 1;
    const rows = (safeLanes - 1) * div + 1;
    const midCount = cols * rows;
    const vertexCount = midCount * 2;
    const faceIndices = (cols - 1) * (rows - 1) * 2 * 6;
    const edgeIndices = (2 * (cols - 1) + 2 * (rows - 1)) * 6;
    if (vertexCount <= SHEET_SKIN_MAX_VERTICES && faceIndices + edgeIndices <= SHEET_SKIN_MAX_INDICES) {
      return { div, cols, rows, midCount };
    }
  }
  return {
    div: 1,
    cols: safeStations,
    rows: safeLanes,
    midCount: safeStations * safeLanes,
  };
}

function failureModeLabel(profile: MaterialBehaviorPreset): string {
  switch (profile.failureMode) {
    case 'ductile': return 'ductile yield → plastic set → rupture';
    case 'brittle': return 'elastic response → rapid brittle fracture';
    case 'fiber': return 'anisotropic fiber loading → progressive split';
    case 'hyperelastic': return 'large reversible flexure → damage';
    case 'progressive': return 'progressive cracking and load redistribution';
    case 'fluid': return 'free-surface flow → inertial runout';
    default: {
      const exhaustive: never = profile.failureMode;
      return exhaustive;
    }
  }
}

function normalizedStrikeCoordinate(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0.5, 0, 1);
}

function normalizedStrikeRadiusScale(value: number | undefined): number {
  return clamp(
    typeof value === 'number' && Number.isFinite(value) ? value : 1,
    MIN_STRIKE_RADIUS_SCALE,
    MAX_STRIKE_RADIUS_SCALE,
  );
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
  private readonly crashRailRig: boolean;
  private readonly concreteRig: boolean;
  private readonly glassRig: boolean;
  private readonly compositeRig: boolean;
  private readonly verticalRig: boolean;
  private readonly sheetRig: boolean;
  private readonly sheetSkin: boolean;
  private readonly skinDiv: number;
  private readonly skinCols: number;
  private readonly skinRows: number;
  private readonly skinMidCount: number;
  private readonly skinVertices: PackedSurfaceBuffer | null;
  private readonly skinIndices: Uint16Array | null;
  private readonly skinMid: Float32Array | null;
  private readonly skinRest: Float32Array | null;
  private readonly skinNormals: Float32Array | null;
  private readonly nodeDemand: Float32Array;
  private readonly packedSheetResult: PackedSurfaceFrame | null;
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
  /** Normalized response per reference solve slice, not a physical modulus. */
  private readonly stiffness: Float32Array;
  /** Per-projection response derived from stiffness, dt, and substep count. */
  private readonly solveStiffness: Float32Array;
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
  private readonly cellDamage: Float32Array;
  private readonly constraintCountValue: number;

  private readonly hingeA: Uint16Array;
  private readonly hingeB: Uint16Array;
  private readonly hingeC: Uint16Array;
  private readonly hingeRest: Float32Array;
  private readonly hingeOriginalRest: Float32Array;
  private readonly hingeStiffness: Float32Array;
  private readonly hingeLambda: Float32Array;
  private readonly hingeYield: Float32Array;
  private readonly hingeBreak: Float32Array;
  private readonly hingePlasticCreep: Float32Array;
  private readonly hingeYielded: Uint8Array;
  private readonly hingeCountValue: number;

  private readonly thicknessScale: number;
  private readonly hardeningCoeff: number;
  private readonly meanNodeArea: number;
  private readonly contactAccum: SphereContactAccum = { work: 0, hits: 0 };
  private indenterKind: 'none' | 'sphere' | 'line' = 'none';
  private indenterX = 0;
  private indenterY = 0;
  private indenterZ = 0;
  private indenterRadius = 0.4;
  private indenterAx = 0;
  private indenterAy = 0;
  private indenterAz = 0;
  private indenterBx = 0;
  private indenterBy = 0;
  private indenterBz = 0;
  private platenX = 0;
  private lastStepDt = 1 / 240;
  private liveDistanceMembers = true;

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
  private formingHold = 0;
  private holdElapsed = 0;
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
  private elasticEnergyValue = 0;
  private plasticWorkValue = 0;
  private dampingWorkValue = 0;
  private contactWorkValue = 0;
  private hashValue = 1;
  private skinTopologyVersion = 1;
  private skinTearSignature = 0;

  constructor(scene: ScenePreset, stress: number, seed: number) {
    this.recipe = getMaterialDemoRecipe(scene.materialDemoId);
    this.profile = materialPresetForVariant(this.recipe?.profileVariant ?? scene.variant);
    this.mode = scene.mode;
    this.dentRig = this.recipe ? this.recipe.kind === 'metal' : scene.mode === 3 && scene.variant <= 2;
    this.crashRailRig = this.recipe?.id === 'metal-four-point-bumper-beam';
    this.concreteRig = this.recipe ? this.recipe.kind === 'concrete' : scene.mode === 4 && scene.variant === 5;
    this.glassRig = this.recipe ? this.recipe.kind === 'glass' : scene.mode === 4 && scene.variant === 6;
    this.compositeRig = !this.recipe && scene.variant === 9;
    this.verticalRig = this.glassRig || this.recipe?.orientation === 'vertical';
    this.sheetRig = this.recipe ? this.recipe.kind === 'metal' : this.compositeRig || this.dentRig || (scene.mode === 4 && scene.variant <= 2);
    this.sheetSkin = this.sheetRig && !this.compositeRig && !this.glassRig && !this.concreteRig;
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
    const authoredGaugeMm = this.recipe?.thicknessMm ?? this.profile.lab.thicknessMm;
    this.thicknessScale = clamp(authoredGaugeMm / Math.max(0.1, this.profile.lab.thicknessMm), 0.05, 8);
    this.hardeningCoeff = clamp(this.profile.lab.hardening, 0, 1);
    this.meanNodeArea = (this.span / Math.max(1, this.stations - 1)) * (this.depth / Math.max(1, this.lanes - 1));
    this.positions = new Float32Array(this.nodeCountValue * 3);
    this.previous = new Float32Array(this.nodeCountValue * 3);
    this.restPositions = new Float32Array(this.nodeCountValue * 3);
    this.invMass = new Float32Array(this.nodeCountValue);
    this.nodeDemand = new Float32Array(this.nodeCountValue);
    this.pinned = new Uint8Array(this.nodeCountValue);
    this.loadWeights = new Float32Array(this.nodeCountValue);
    this.loadSigns = new Int8Array(this.nodeCountValue);
    if (this.sheetSkin) {
      const layout = sheetSkinLayout(this.stations, this.lanes);
      this.skinDiv = layout.div;
      this.skinCols = layout.cols;
      this.skinRows = layout.rows;
      this.skinMidCount = layout.midCount;
      this.skinVertices = new PackedSurfaceBuffer(layout.midCount * 2);
      this.skinIndices = new Uint16Array((layout.cols - 1) * (layout.rows - 1) * 12 + (layout.cols + layout.rows) * 12);
      this.skinMid = new Float32Array(layout.midCount * 3);
      this.skinRest = new Float32Array(layout.midCount * 3);
      this.skinNormals = new Float32Array(layout.midCount * 3);
      this.packedSheetResult = {
        path: 'packed',
        material: 'sheet',
        vertices: this.skinVertices.data,
        indices: this.skinIndices,
        vertexStride: PACKED_SURFACE_VERTEX_BYTES,
        vertexCount: 0,
        indexCount: 0,
        topologyVersion: 1,
        frameVersion: 1,
      };
    } else {
      this.skinDiv = 1;
      this.skinCols = 0;
      this.skinRows = 0;
      this.skinMidCount = 0;
      this.skinVertices = null;
      this.skinIndices = null;
      this.skinMid = null;
      this.skinRest = null;
      this.skinNormals = null;
      this.packedSheetResult = null;
    }
    this.initializeNodes();
    this.initializeLoadField();
    this.bakeSheetRestSkin();

    const seeds = this.buildConstraintSeeds(this.recipe?.profileVariant ?? scene.variant);
    this.constraintCountValue = seeds.length;
    this.a = new Uint16Array(seeds.length);
    this.b = new Uint16Array(seeds.length);
    this.rest = new Float32Array(seeds.length);
    this.originalRest = new Float32Array(seeds.length);
    this.stiffness = new Float32Array(seeds.length);
    this.solveStiffness = new Float32Array(seeds.length);
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
    this.cellDamage = new Float32Array(this.failedCells.length);
    for (let i = 0; i < seeds.length; i++) this.writeConstraint(i, seeds[i]);
    for (let i = 0; i < this.reinforcement.length; i++) this.reinforcementCountValue += this.reinforcement[i];
    const hingeSeeds = this.buildHingeSeeds();
    this.hingeCountValue = hingeSeeds.length;
    this.hingeA = new Uint16Array(Math.max(1, hingeSeeds.length));
    this.hingeB = new Uint16Array(Math.max(1, hingeSeeds.length));
    this.hingeC = new Uint16Array(Math.max(1, hingeSeeds.length));
    this.hingeRest = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeOriginalRest = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeStiffness = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeLambda = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeYield = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeBreak = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingePlasticCreep = new Float32Array(Math.max(1, hingeSeeds.length));
    this.hingeYielded = new Uint8Array(Math.max(1, hingeSeeds.length));
    for (let i = 0; i < hingeSeeds.length; i++) {
      const hinge = hingeSeeds[i];
      this.hingeA[i] = hinge.a;
      this.hingeB[i] = hinge.b;
      this.hingeC[i] = hinge.c;
      this.hingeRest[i] = hinge.rest;
      this.hingeOriginalRest[i] = hinge.rest;
      this.hingeStiffness[i] = hinge.stiffness;
      this.hingeYield[i] = hinge.yieldAngle;
      this.hingeBreak[i] = hinge.breakAngle;
      this.hingePlasticCreep[i] = hinge.plasticCreep;
    }
    this.seedAuthoredNotch();

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
    this.loadTarget = this.compositeRig ? 0 : (this.recipe?.primaryLoad ?? defaultTargets[this.mode] ?? 0.8);
    this.cycleEnabled = !this.compositeRig && (this.recipe?.fixtureStyle === 'fatigue' || (!this.recipe && (this.mode === 1 || this.mode === 4)));
    const testModes = ['three-point bend', 'cyclic overload', 'precision displacement ramp', 'instrumented dent and impact', 'cinematic yield-to-fracture'] as const;
    this.telemetry = {
      label: this.recipe?.title ?? this.profile.label,
      testMode: this.recipe
        ? `${this.recipe.fixtureStyle} · ${this.recipe.loadPattern} load · ${this.recipe.crackStyle} · ${failureModeLabel(this.profile)}`
        : `${testModes[this.mode] ?? testModes[0]} · ${failureModeLabel(this.profile)}`,
      loadTarget: this.loadTarget,
      loadProgress: 0,
      maxStrain: 0,
      yieldStrain: this.profile.tensileYieldStrain * (this.concreteRig ? CONCRETE_MATRIX_TENSILE_YIELD_SCALE : 1),
      breakStrain: this.profile.tensileBreakStrain * (this.concreteRig ? CONCRETE_MATRIX_TENSILE_BREAK_SCALE : 1),
      yieldedCount: 0,
      damagedCount: 0,
      peakDamage: 0,
      centerDeflection: 0,
      peakDeflection: 0,
      residualDent: 0,
      fracturedCellCount: 0,
      fragmentCount: 0,
      reinforcementCount: this.reinforcementCountValue,
      elasticEnergy: 0,
      plasticWork: 0,
      dampingWork: 0,
      contactWork: 0,
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
    if (this.crashRailRig) {
      // A guided platen acts on the terminal section, so every point around
      // the folded cross-section receives the same axial demand. Spreading
      // that demand over the final few stations avoids a singular end node
      // while retaining a clear fixed-end/free-end load path.
      for (let station = 0; station < this.stations; station++) {
        const u = station / Math.max(1, this.stations - 1);
        const edgeT = clamp((u - 0.84) / 0.16, 0, 1);
        const weight = edgeT * edgeT * (3 - 2 * edgeT);
        for (let lane = 0; lane < this.lanes; lane++) {
          const index = this.node(station, lane);
          this.loadWeights[index] = weight;
          this.loadSigns[index] = -1;
        }
      }
      return;
    }
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
          case 'center':
          case 'offset':
          case 'pulse':
          case 'edge':
            weight = patch(u, v, centerU, centerV);
            break;
          default: {
            const exhaustive: never = this.recipe.loadPattern;
            weight = patch(u, v, centerU, centerV);
            void exhaustive;
            break;
          }
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
    const mass = areaWeightedMass(this.meanNodeArea, this.thicknessScale, Math.max(0.08, this.profile.densityScale) / Math.max(1e-4, this.meanNodeArea));
    for (let station = 0; station < this.stations; station++) {
      const x = -this.span * 0.5 + station * stationStep;
      const t = station / Math.max(1, this.stations - 1);
      for (let lane = 0; lane < this.lanes; lane++) {
        const index = this.node(station, lane);
        const offset = index * 3;
        const crossPosition = -this.depth * 0.5 + lane * laneStep;
        const camber = Math.sin(Math.PI * t) * 0.035;
        if (this.crashRailRig) {
          const profilePosition = lane / Math.max(1, this.lanes - 1) * (CRASH_RAIL_SECTION.length - 1);
          const profileIndex = Math.min(CRASH_RAIL_SECTION.length - 2, Math.floor(profilePosition));
          const profileBlend = profilePosition - profileIndex;
          const profileA = CRASH_RAIL_SECTION[profileIndex];
          const profileB = CRASH_RAIL_SECTION[profileIndex + 1];
          const profileZ = profileA[0] + (profileB[0] - profileA[0]) * profileBlend;
          const profileY = profileA[1] + (profileB[1] - profileA[1]) * profileBlend;
          const imperfectionEnvelope = Math.pow(clamp((t - 0.46) / 0.54, 0, 1), 2);
          // Small deterministic geometric imperfections seed stable local
          // buckling under axial compression. They are part of the reduced
          // model's initial geometry, not a pre-authored crush animation.
          this.positions[offset] = x;
          this.positions[offset + 1] = this.baseY + profileY * this.depth * 0.58
            + Math.sin(t * Math.PI * 8 + lane * 0.22) * 0.028 * imperfectionEnvelope;
          this.positions[offset + 2] = profileZ * this.depth
            + Math.sin(t * Math.PI * 7 + lane * 0.41) * 0.022 * imperfectionEnvelope;
        } else {
          this.positions[offset] = x;
          this.positions[offset + 1] = this.verticalRig ? this.baseY + crossPosition : this.baseY + camber;
          this.positions[offset + 2] = this.verticalRig ? 0 : crossPosition;
        }
        const boundary = this.recipe?.boundary;
        const atStationEnd = station === 0 || station === this.stations - 1;
        const atLaneEnd = lane === 0 || lane === this.lanes - 1;
        const support = this.crashRailRig
          ? station <= 1
          : this.compositeRig
            ? station <= 1
            : boundary === 'cantilever'
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
      const authoredNotch = this.notchWeaken(a, b);
      const notchScale = (brittleNotch ? 0.68 : 1) * authoredNotch;
      const matrixYieldScale = this.concreteRig && !reinforcement ? CONCRETE_MATRIX_TENSILE_YIELD_SCALE : 1;
      const matrixBreakScale = this.concreteRig && !reinforcement ? CONCRETE_MATRIX_TENSILE_BREAK_SCALE : 1;
      const visibleConstraint = (this.sheetRig && !this.compositeRig) || this.glassRig || this.concreteRig
        ? reinforcement
        : render;
      result.push({
        a, b, rest,
        stiffness: clamp(reinforcement ? 0.988 : stiffness, 0.02, 0.999),
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
          add(current, this.node(station + 2, lane), this.profile.bendStiffness * (this.sheetSkin ? SKIP_BEND_SCALE : 1), 1.3, false, 0.04, cell);
        }
        if (lane + 2 < this.lanes) {
          add(current, this.node(station, lane + 2), this.profile.bendStiffness * this.profile.anisotropy * (this.sheetSkin ? SKIP_BEND_SCALE : 1), 1.5, false, 0.04, -1);
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

  private notchWeaken(a: number, b: number): number {
    const notch = this.recipe?.notch;
    if (!notch) return 1;
    const [nu, nv, nw] = notch;
    const acrossScale = Math.max(0.018, nw * 0.42);
    const alongScale = Math.max(0.08, nw * 1.55);
    const sample = (index: number): number => {
      const station = Math.floor(index / this.lanes);
      const lane = index % this.lanes;
      const u = station / Math.max(1, this.stations - 1);
      const v = lane / Math.max(1, this.lanes - 1);
      const across = Math.abs(u - nu) / acrossScale;
      const along = Math.abs(v - nv) / alongScale;
      if (across >= 1 || along >= 1) return 1;
      return 0.10 + 0.90 * Math.max(across, along * 0.45);
    };
    return Math.min(sample(a), sample(b));
  }

  private seedAuthoredNotch(): void {
    const notch = this.recipe?.notch;
    if (!notch) return;
    const [nu, nv, nw] = notch;
    const halfWidth = Math.max(0.038, nw * 0.42);
    const halfLength = Math.max(0.10, nw * 0.88);
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.reinforcement[i] !== 0 || this.broken[i] !== 0) continue;
      const au = Math.floor(this.a[i] / this.lanes) / Math.max(1, this.stations - 1);
      const av = (this.a[i] % this.lanes) / Math.max(1, this.lanes - 1);
      const bu = Math.floor(this.b[i] / this.lanes) / Math.max(1, this.stations - 1);
      const bv = (this.b[i] % this.lanes) / Math.max(1, this.lanes - 1);
      const midU = 0.5 * (au + bu);
      const midV = 0.5 * (av + bv);
      const crossesSeam = (au - nu) * (bu - nu) <= 0;
      if (!crossesSeam || Math.abs(midU - nu) > halfWidth || Math.abs(midV - nv) > halfLength) continue;
      this.breakConstraint(i);
      const cell = this.cohesiveCell[i];
      if (cell >= 0 && cell < this.failedCells.length) this.failedCells[cell] = 1;
    }
    this.segmentMetadataDirty = true;
  }

  private skinQuadOnAuthoredNotch(col: number, row: number): boolean {
    const notch = this.recipe?.notch;
    if (!notch) return false;
    const [nu, nv, nw] = notch;
    const u0 = col / Math.max(1, this.skinCols - 1);
    const u1 = (col + 1) / Math.max(1, this.skinCols - 1);
    const v0 = row / Math.max(1, this.skinRows - 1);
    const v1 = (row + 1) / Math.max(1, this.skinRows - 1);
    const halfWidth = Math.max(0.028, nw * 0.42);
    const halfLength = Math.max(0.09, nw * 0.88);
    const crossesSeam = u0 <= nu && u1 >= nu;
    const alongSeam = Math.min(v1, nv + halfLength) > Math.max(v0, nv - halfLength);
    return crossesSeam && alongSeam && u0 < nu + halfWidth && u1 > nu - halfWidth;
  }

  private buildHingeSeeds(): HingeSeed[] {
    if (!this.sheetSkin) return [];
    const result: HingeSeed[] = [];
    const thicknessBend = Math.pow(clamp(this.thicknessScale, 0.45, 1.75), 3);
    const yieldAngle = Math.max(this.sheetSkin ? 0.028 : 0.04, this.profile.tensileYieldStrain * (this.sheetSkin ? 3.2 : 6.5));
    const breakAngle = Math.max(yieldAngle + 0.08, this.profile.tensileBreakStrain * 9);
    const add = (a: number, b: number, c: number, stiffnessScale: number): void => {
      const ao = a * 3;
      const bo = b * 3;
      const co = c * 3;
      const rest = polylineBendAngle(
        this.positions[ao], this.positions[ao + 1], this.positions[ao + 2],
        this.positions[bo], this.positions[bo + 1], this.positions[bo + 2],
        this.positions[co], this.positions[co + 1], this.positions[co + 2],
      );
      const chord = 0.5 * (
        Math.hypot(this.positions[ao] - this.positions[bo], this.positions[ao + 1] - this.positions[bo + 1], this.positions[ao + 2] - this.positions[bo + 2])
        + Math.hypot(this.positions[co] - this.positions[bo], this.positions[co + 1] - this.positions[bo + 1], this.positions[co + 2] - this.positions[bo + 2])
      );
      if (!(chord > 1e-5)) return;
      result.push({
        a, b, c, rest,
        stiffness: SHELL_BEND_K * this.profile.bendStiffness * thicknessBend * chord * stiffnessScale,
        yieldAngle,
        breakAngle,
        plasticCreep: this.profile.plasticCreep * (this.sheetSkin ? 4.5 : 1),
      });
    };
    for (let station = 0; station < this.stations; station++) {
      for (let lane = 0; lane < this.lanes; lane++) {
        if (station > 0 && station + 1 < this.stations) {
          add(this.node(station - 1, lane), this.node(station, lane), this.node(station + 1, lane), 1);
        }
        if (lane > 0 && lane + 1 < this.lanes) {
          add(this.node(station, lane - 1), this.node(station, lane), this.node(station, lane + 1), this.profile.anisotropy);
        }
      }
    }
    return result;
  }

  step(dt: number, subSteps: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const requestedSteps = Math.max(1, Math.min(MATERIAL_MAX_SOLVE_SLICES, Math.round(subSteps)));
    // Four microsteps are the material model's bounded stability floor. Apart
    // from preserving the authored reference response, this prevents force
    // integration and projected damage from changing character when a caller
    // selects a lower global soft-body quality. Requests above four still add
    // temporal refinement and remain capped at MATERIAL_MAX_SOLVE_SLICES.
    const steps = Math.max(MATERIAL_REFERENCE_SOLVE_SLICES, requestedSteps);
    const boundedDt = Math.min(dt, 1 / 30);
    const stepDt = boundedDt / steps;
    this.lastStepDt = stepDt;
    const iterations = 5 + this.stress;
    this.updateSolveStiffness(boundedDt, steps, iterations);
    for (let subStep = 0; subStep < steps; subStep++) {
      this.time += stepDt;
      this.updateLoad(stepDt);
      this.updateIndenterPose();
      this.advanceCrackFront(stepDt);
      this.integrateProjectiles(stepDt);
      this.integrateFragments(stepDt);
      this.integrate(stepDt);
      this.refreshLiveDistanceMembers();
      this.collideProjectiles();
      if (this.liveDistanceMembers) this.hingeLambda.fill(0);
      for (let iteration = 0; iteration < iterations; iteration++) this.projectConstraints();
      if (this.liveDistanceMembers) this.projectContacts();
      this.solveBounds();
      // Constitutive response is evaluated from the projected lattice rather
      // than the unconstrained Verlet predictor. Newly failed members are
      // omitted on the next projection pass/substep in deterministic order.
      this.evaluateDamage(stepDt);
      this.formingHold = Math.max(0, this.formingHold - stepDt);
    }
    this.telemetryCountdown--;
    if (this.telemetryCountdown <= 0) this.updateTelemetry(false);
    this.frameVersion++;
  }

  private refreshLiveDistanceMembers(): void {
    this.liveDistanceMembers = false;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] === 0) {
        this.liveDistanceMembers = true;
        return;
      }
    }
  }

  private updateSolveStiffness(dt: number, subSteps: number, iterations: number): void {
    const passCount = Math.max(1, subSteps * iterations);
    const referenceSlices = Math.max(
      0,
      dt * REFERENCE_SIMULATION_HZ * MATERIAL_REFERENCE_SOLVE_SLICES,
    );
    const exponent = referenceSlices / passCount;
    for (let i = 0; i < this.constraintCountValue; i++) {
      // If K is the correction over one authored reference slice,
      // 1-(1-K)^(referenceSlices/passCount) gives every runtime pass an equal
      // share. Total undamaged error retention is therefore independent of
      // caller substeps while preserving the established four-slice response.
      this.solveStiffness[i] = 1 - Math.pow(1 - this.stiffness[i], exponent);
    }
  }

  private updateLoad(dt: number): void {
    const target = this.cycleEnabled
      ? this.loadTarget * (0.20 + 0.80 * (0.5 + 0.5 * Math.sin(this.time * (this.mode === 4 ? 0.72 : 1.25))))
      : this.loadTarget;
    const response = 1 - Math.pow(0.0008, dt);
    this.loadProgress += (target - this.loadProgress) * response;
    const hold = this.recipe?.holdThenUnloadSeconds;
    if (!this.cycleEnabled && hold !== undefined && hold > 0 && this.loadTarget > 0.05) {
      if (this.loadProgress >= this.loadTarget * 0.92) {
        this.holdElapsed += dt;
        if (this.holdElapsed >= hold) this.releaseLoad();
      }
    } else if (this.loadTarget <= 0.05) {
      this.holdElapsed = 0;
    }
  }

  private integrate(dt: number): void {
    const dt2 = dt * dt;
    // Preset damping is normalized as velocity retention at 60 Hz. Exponential
    // scaling makes the total retention depend on elapsed time, not how many
    // integration substeps happened to be requested.
    const damping = Math.pow(this.profile.damping, dt * REFERENCE_SIMULATION_HZ);
    const center = (this.stations - 1) * 0.5;
    const halfBand = Math.max(1.5, this.stations * (this.dentRig ? 0.16 : 0.075));
    const loadAcceleration = this.loadProgress * (38 + this.stress * 8) * (this.recipe?.loadScale ?? 1) /
      Math.max(0.18, this.profile.densityScale) / Math.max(0.08, this.thicknessScale) * (this.compositeRig ? 0.02 : 1);
    const lateralLoad = !this.recipe && !this.compositeRig && this.mode === 4
      ? Math.sin(this.time * 1.1) * this.loadProgress * 5
      : 0;
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
        const freeEndT = station / Math.max(1, this.stations - 1);
        const freeEndWeight = clamp((freeEndT - 0.72) / 0.28, 0, 1);
        const loadWeight = this.recipe
          ? this.loadWeights[index]
          : this.compositeRig
            ? freeEndWeight * freeEndWeight * (3 - 2 * freeEndWeight)
            : this.dentRig
              ? Math.max(spanWeight * 0.16, dentWeight)
              : spanWeight;
        const loadSign = this.recipe ? this.loadSigns[index] || -1 : -1;
        const offset = index * 3;
        const x = this.positions[offset];
        const y = this.positions[offset + 1];
        const z = this.positions[offset + 2];
        const vx = (x - this.previous[offset]) * damping;
        const vy = (y - this.previous[offset + 1]) * damping;
        const vz = (z - this.previous[offset + 2]) * damping;
        const undampedX = x - this.previous[offset];
        const undampedY = y - this.previous[offset + 1];
        const undampedZ = z - this.previous[offset + 2];
        this.dampingWorkValue += (undampedX * undampedX + undampedY * undampedY + undampedZ * undampedZ) * (1 - damping * damping);
        // A planar distance lattice has no first-order out-of-plane bending
        // stiffness. This bounded rest-plane term supplies the reduced-order
        // flexural response needed by the cantilever precheck; it is strongest
        // near the clamp and remains explicitly normalized, not calibrated.
        const compositeFlexuralAcceleration = this.compositeRig
          ? -(y - this.restPositions[offset + 1]) * (24 - freeEndT * 10)
          : 0;
        this.previous[offset] = x;
        this.previous[offset + 1] = y;
        this.previous[offset + 2] = z;
        this.positions[offset] = x + vx + (lateralLoad + (this.recipe?.loadPattern === 'torsion' ? loadSign * loadAcceleration * 0.08 : 0)) * loadWeight * dt2;
        // World Y is up. Literal 9.81 on a 24 m reduced-order sheet overwhelms
        // discrete-shell bending and flops the whole panel onto the floor.
        // Keep a small downward self-weight, same order as the guided sled.
        const gravityY = this.crashRailRig ? 1.25 : this.compositeRig ? 0 : this.sheetSkin ? 1.6 : 9.81;
        this.positions[offset + 1] = y + vy + (compositeFlexuralAcceleration - gravityY) * dt2;
        this.positions[offset + 2] = z + vz;
        if (this.crashRailRig) {
          this.positions[offset] += loadAcceleration * loadWeight * loadSign * 0.92 * dt2;
        } else if (this.verticalRig) {
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
      const plasticStrain = Math.abs(this.rest[i] - this.originalRest[i]) / Math.max(1e-7, this.originalRest[i]);
      const harden = 1 + this.hardeningCoeff * plasticStrain;
      const yieldPoint = (signedStrain >= 0 ? this.tensileYield[i] : this.compressionYield[i]) * harden;
      const breakPoint = signedStrain >= 0 ? this.tensileBreak[i] : this.compressionBreak[i];
      const reportableStrain = Math.min(strain, breakPoint * 1.5);
      if (reportableStrain > maxStrain) maxStrain = reportableStrain;
      // A clamped sheet dent is mostly bending. Membrane strain stays below the
      // tensile yield envelope, so allow a small forming stretch to lock a
      // permanent set without rupturing the panel.
      if (
        this.sheetSkin
        && this.plasticCreep[i] > 0
        && signedStrain > 0.001
        && strain < yieldPoint
        && (this.loadProgress > 0.04 || this.contactAccum.hits > 0 || this.formingHold > 0)
      ) {
        const drift = (length - this.rest[i]) * this.plasticCreep[i] * dt * 14;
        const maxPlastic = this.originalRest[i] * 0.10;
        const next = Math.min(this.originalRest[i] + maxPlastic, this.rest[i] + drift);
        if (next > this.rest[i] + 1e-7) {
          this.plasticWorkValue += (next - this.rest[i]) * strain * this.stiffness[i];
          this.rest[i] = next;
          plasticChanged = true;
        }
      }
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
          this.plasticWorkValue += Math.abs(next - this.rest[i]) * strain * this.stiffness[i];
          this.rest[i] = next;
          plasticChanged = true;
        }
      }
      if ((strain >= breakPoint || this.damage[i] >= 1) && pendingCount < pendingCells.length) {
        const cell = this.cohesiveCell[i];
        const cohesive = cell >= 0 && (this.glassRig || this.concreteRig);
        pendingCells[pendingCount++] = cohesive ? cell : -(i + 1);
      }
      if (this.cohesiveCell[i] >= 0) {
        const cell = this.cohesiveCell[i];
        this.cellDamage[cell] = Math.max(this.cellDamage[cell], this.damage[i], clamp((strain - yieldPoint) / Math.max(1e-6, breakPoint), 0, 1));
      }
    }
    this.evaluateHingePlasticity(dt);
    this.maxStrainValue = maxStrain;
    this.peakDamageValue = peakDamage;
    if (plasticChanged) this.segmentMetadataDirty = true;
    for (let i = 0; i < pendingCount; i++) {
      const value = pendingCells[i];
      if (value >= 0) this.breakCohesiveCell(value);
      else this.breakConstraint(-value - 1);
    }
    if (this.concreteRig) {
      for (let cell = 0; cell < this.cellDamage.length; cell++) {
        if (this.failedCells[cell] !== 0 || this.cellDamage[cell] < 0.92) continue;
        if (!this.cellInPunchingCone(cell)) continue;
        this.breakCohesiveCell(cell);
      }
    }
  }

  private evaluateHingePlasticity(dt: number): void {
    if (!this.liveDistanceMembers || this.hingeCountValue === 0) return;
    for (let i = 0; i < this.hingeCountValue; i++) {
      const a = this.hingeA[i];
      const b = this.hingeB[i];
      const c = this.hingeC[i];
      const theta = polylineBendAngle(
        this.positions[a * 3], this.positions[a * 3 + 1], this.positions[a * 3 + 2],
        this.positions[b * 3], this.positions[b * 3 + 1], this.positions[b * 3 + 2],
        this.positions[c * 3], this.positions[c * 3 + 1], this.positions[c * 3 + 2],
      );
      const delta = theta - this.hingeRest[i];
      const absDelta = Math.abs(delta);
      const plasticAngle = Math.abs(this.hingeRest[i] - this.hingeOriginalRest[i]);
      const yieldPoint = this.hingeYield[i] * (1 + this.hardeningCoeff * plasticAngle);
      if (absDelta <= yieldPoint) continue;
      if (this.hingeYielded[i] === 0) {
        this.hingeYielded[i] = 1;
        this.yieldedCountValue++;
        this.telemetryCountdown = 0;
      }
      if (this.hingePlasticCreep[i] <= 0) continue;
      const normalized = clamp((absDelta - yieldPoint) / Math.max(1e-6, this.hingeBreak[i] - yieldPoint), 0, 2);
      const drift = delta * this.hingePlasticCreep[i] * dt * (0.35 + normalized);
      const maxPlastic = this.hingeBreak[i] * 0.85;
      const next = clamp(this.hingeRest[i] + drift, this.hingeOriginalRest[i] - maxPlastic, this.hingeOriginalRest[i] + maxPlastic);
      if (Math.abs(next - this.hingeRest[i]) > 1e-7) {
        this.plasticWorkValue += Math.abs(next - this.hingeRest[i]) * absDelta * this.hingeStiffness[i] * 1e-4;
        this.hingeRest[i] = next;
      }
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
      const softened = this.solveStiffness[i] * (1 - this.damage[i] * 0.72);
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
    if (!this.liveDistanceMembers) return;
    this.projectHinges(this.lastStepDt);
  }

  private projectHinges(dt: number): void {
    const dt2 = dt * dt;
    for (let i = 0; i < this.hingeCountValue; i++) {
      const k = this.hingeStiffness[i];
      if (!(k > 0)) continue;
      const alphaTilde = 1 / Math.max(1e-8, k * dt2);
      this.hingeLambda[i] = projectXpbdAngle(
        this.positions,
        this.invMass,
        this.hingeA[i],
        this.hingeB[i],
        this.hingeC[i],
        this.hingeRest[i],
        this.hingeLambda[i],
        alphaTilde,
      );
    }
  }

  /**
   * Signed punch standoff along the sheet normal. `loadSign` -1 is into the
   * supports (-Y horizontal, -Z vertical). The striker sits on the visible
   * face and travels with the load; a negative rest-plane offset would put
   * the tool on the exit side so contact normals bulge toward the camera.
   */
  private punchNormalOffset(radius: number, travel: number): number {
    const sign = this.recipe?.loadSign ?? -1;
    const standoff = Math.max(radius * 0.12, radius - Math.max(0, travel));
    return -sign * standoff;
  }

  private updateIndenterPose(): void {
    if (!this.recipe || !this.sheetSkin) {
      this.indenterKind = 'none';
      return;
    }
    if (this.crashRailRig) {
      this.indenterKind = 'none';
      this.platenX = this.span * 0.5 - this.loadProgress * this.span * 0.34;
      return;
    }
    const station = this.targetStation(this.recipe.loadCenter[0]);
    const lane = this.targetLane(this.recipe.loadCenter[1]);
    const rest = this.node(station, lane) * 3;
    const restX = this.restPositions[rest];
    const restY = this.restPositions[rest + 1];
    const restZ = this.restPositions[rest + 2];
    const travel = this.loadProgress * (this.recipe.loadPattern === 'line' ? 0.48 : 0.36)
      * (1 + this.stress * 0.03) / Math.max(0.5, this.thicknessScale);
    switch (this.recipe.loadPattern) {
      case 'line':
        this.indenterKind = 'line';
        this.indenterRadius = clamp(this.span * this.recipe.loadRadius[0] * 0.45, 0.12, 0.28);
        {
          const offset = this.punchNormalOffset(this.indenterRadius, travel);
          this.indenterAx = restX;
          this.indenterBx = restX;
          if (this.verticalRig) {
            this.indenterAy = this.baseY - this.depth * 0.48;
            this.indenterBy = this.baseY + this.depth * 0.48;
            this.indenterAz = restZ + offset;
            this.indenterBz = restZ + offset;
          } else {
            this.indenterAy = restY + offset;
            this.indenterBy = restY + offset;
            this.indenterAz = -this.depth * 0.48;
            this.indenterBz = this.depth * 0.48;
          }
        }
        break;
      case 'center':
      case 'offset':
      case 'pulse':
        if (this.recipe.fixtureStyle !== 'press' && this.recipe.fixtureStyle !== 'drop' && this.recipe.fixtureStyle !== 'ram') {
          this.indenterKind = 'none';
          break;
        }
        this.indenterKind = 'sphere';
        this.indenterRadius = clamp(this.depth * Math.max(this.recipe.loadRadius[0], this.recipe.loadRadius[1]) * 0.10, 0.20, 0.48);
        {
          const offset = this.punchNormalOffset(this.indenterRadius, travel);
          this.indenterX = restX;
          if (this.verticalRig) {
            this.indenterY = restY;
            this.indenterZ = restZ + offset;
          } else {
            this.indenterY = restY + offset;
            this.indenterZ = restZ;
          }
        }
        break;
      case 'dual':
      case 'distributed':
      case 'torsion':
      case 'edge':
        this.indenterKind = 'none';
        break;
      default: {
        const exhaustive: never = this.recipe.loadPattern;
        this.indenterKind = 'none';
        void exhaustive;
        break;
      }
    }
  }

  private projectContacts(): void {
    this.contactAccum.work = 0;
    this.contactAccum.hits = 0;
    if (this.crashRailRig && this.loadProgress > 0.02) {
      this.projectCrashPlaten();
      const lanePitch = this.depth / Math.max(1, this.lanes - 1);
      projectStationSelfContact(
        this.positions,
        this.previous,
        this.invMass,
        this.pinned,
        this.stations,
        this.lanes,
        Math.max(0.08, lanePitch * 0.28),
        this.contactAccum,
      );
    }
    if (this.loadProgress <= 0.02) {
      this.contactWorkValue += this.contactAccum.work / Math.max(1, this.nodeCountValue);
      return;
    }
    switch (this.indenterKind) {
      case 'sphere':
        projectKinematicSphere(
          this.positions, this.previous, this.invMass, this.pinned, this.nodeCountValue,
          this.indenterX, this.indenterY, this.indenterZ, this.indenterRadius,
          clamp(0.76 / Math.max(0.2, this.thicknessScale), 0.18, 0.92),
          this.contactAccum,
        );
        break;
      case 'line':
        projectKinematicCapsule(
          this.positions, this.previous, this.invMass, this.pinned, this.nodeCountValue,
          this.indenterAx, this.indenterAy, this.indenterAz,
          this.indenterBx, this.indenterBy, this.indenterBz,
          this.indenterRadius,
          clamp(0.80 / Math.max(0.2, this.thicknessScale), 0.18, 0.92),
          this.contactAccum,
        );
        break;
      case 'none':
        break;
      default: {
        const exhaustive: never = this.indenterKind;
        void exhaustive;
        break;
      }
    }
    this.contactWorkValue += this.contactAccum.work / Math.max(1, this.nodeCountValue);
  }

  private projectCrashPlaten(): void {
    for (let i = 0; i < this.nodeCountValue; i++) {
      if (this.pinned[i] !== 0 || this.invMass[i] <= 0) continue;
      const station = Math.floor(i / this.lanes);
      if (station < this.stations - 5) continue;
      const offset = i * 3;
      if (this.positions[offset] <= this.platenX) continue;
      const C = this.positions[offset] - this.platenX;
      this.positions[offset] = this.platenX;
      this.previous[offset] = this.platenX;
      this.contactAccum.work += C * C;
      this.contactAccum.hits++;
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
      if (this.crashRailRig) {
        // One-sided bulkhead contact prevents a long-duration normalized load
        // from numerically driving the folded rail through its fixed support.
        // The terminal three stations also inherit the bounded sled stroke;
        // this is the reduced-order equivalent of the physical platen stop.
        const station = Math.floor(i / this.lanes);
        const bulkheadContactX = -this.span * 0.5 + 0.02;
        const sledStopX = station >= this.stations - 3
          ? this.restPositions[offset] - this.span * 0.52
          : bulkheadContactX;
        const lowerX = Math.max(bulkheadContactX, sledStopX);
        if (this.positions[offset] < lowerX) {
          this.positions[offset] = lowerX;
          this.previous[offset] = lowerX;
        }
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

  private cellInPunchingCone(cell: number): boolean {
    if (this.recipe?.crackStyle !== 'cone') return true;
    if (this.fracturedCellCountValue >= PUNCHING_CONE_CELL_CAP) return false;
    const station = Math.floor(cell / this.lanes);
    const lane = cell % this.lanes;
    return Math.hypot(station - this.targetStation(), (lane - this.targetLane()) * 1.12) <= PUNCHING_CONE_CELL_RADIUS;
  }

  private breakCohesiveCell(
    cell: number,
    originStation = this.targetStation(),
    originLane = this.targetLane(),
    crackDepth = 0,
  ): void {
    if (cell < 0 || cell >= this.failedCells.length || this.failedCells[cell] !== 0) return;
    if (this.concreteRig && !this.cellInPunchingCone(cell)) return;
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
    let neighbors: readonly (readonly [number, number])[];
    switch (style) {
      case 'dense':
        neighbors = allNeighbors;
        break;
      case 'diagonal':
        neighbors = crackDepth === 0
          ? [[station - 1, lane - 1], [station + 1, lane + 1], [station - 1, lane + 1], [station + 1, lane - 1]]
          : [[station + (directionStation || 1), lane + (directionLane || 1)]];
        break;
      case 'edge':
        neighbors = crackDepth === 0
          ? [[station + inwardStation, lane + inwardLane], [station + inwardStation, lane - 1], [station + inwardStation, lane + 1]]
          : [...radialNeighbors, [station + directionStation, lane - 1], [station + directionStation, lane + 1]];
        break;
      case 'radial':
      case 'local':
      case 'retained':
      case 'cone':
        neighbors = radialNeighbors;
        break;
      default: {
        const exhaustive: never = style;
        neighbors = radialNeighbors;
        void exhaustive;
        break;
      }
    }
    const ranked = neighbors
      .map((candidate) => {
        const nextCell = candidate[0] * this.lanes + candidate[1];
        return { candidate, strain: this.cellTensileStrain(nextCell) };
      })
      .sort((left, right) => right.strain - left.strain || left.candidate[0] - right.candidate[0] || left.candidate[1] - right.candidate[1]);
    const take = style === 'dense'
      ? ranked.length
      : style === 'retained'
        ? Math.min(2, ranked.length)
        : crackDepth === 0
          ? Math.min(2, ranked.length)
          : 1;
    const orderedNeighbors = ranked.length === 0 || ranked[0].strain <= 1e-8
      ? neighbors
      : ranked.slice(0, Math.max(1, take)).map((entry) => entry.candidate);
    for (const [nextStation, nextLane] of orderedNeighbors) {
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

  private cellTensileStrain(cell: number): number {
    if (cell < 0 || cell >= this.failedCells.length || this.failedCells[cell] !== 0) return 0;
    let peak = 0;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.cohesiveCell[i] !== cell || this.broken[i] !== 0) continue;
      const ao = this.a[i] * 3;
      const bo = this.b[i] * 3;
      const length = Math.hypot(
        this.positions[bo] - this.positions[ao],
        this.positions[bo + 1] - this.positions[ao + 1],
        this.positions[bo + 2] - this.positions[ao + 2],
      );
      const strain = (length - this.rest[i]) / Math.max(1e-7, this.rest[i]);
      if (strain > peak) peak = strain;
    }
    return peak;
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
    if (style === 'cone') {
      const punchStation = this.targetStation();
      const punchLane = this.targetLane();
      if (Math.abs(station - punchStation) > 2 || Math.abs(lane - punchLane) > 2) return;
      if (this.fragments.length >= 8) return;
    }
    const count = kind === 'glass'
      ? style === 'dense' ? 3 : style === 'retained' ? 1 : 4
      : style === 'cone' ? 1 : 3;
    for (let i = 0; i < count && this.fragments.length < MAX_MATERIAL_FRAGMENTS; i++) {
      const outward = kind === 'glass' ? (cell & 1 ? 1 : -1) : this.rng.signed(1);
      const half: Vec3 = kind === 'glass'
        ? [this.rng.range(0.16, 0.42), this.rng.range(0.05, 0.20), this.rng.range(0.010, 0.026)]
        : style === 'cone'
          ? [this.rng.range(0.05, 0.11), this.rng.range(0.04, 0.08), this.rng.range(0.05, 0.11)]
          : [this.rng.range(0.09, 0.31), this.rng.range(0.06, 0.22), this.rng.range(0.08, 0.28)];
      this.fragments.push({
        position: [origin[0] + this.rng.signed(0.16), origin[1] + this.rng.signed(0.12), origin[2] + this.rng.signed(0.10)],
        velocity: kind === 'glass'
          ? style === 'retained'
            ? [this.rng.signed(0.65), this.rng.range(-0.2, 0.65), outward * this.rng.range(0.25, 0.85)]
            : [this.rng.signed(3.2), this.rng.range(-0.5, 3.8), outward * this.rng.range(2.4, 7.0)]
          : style === 'cone'
            ? [this.rng.signed(0.35), this.rng.range(-2.4, -0.55), this.rng.signed(0.35)]
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
    if (!this.liveDistanceMembers) return;
    for (const projectile of this.projectiles) {
      const speed = Math.hypot(projectile.velocity[0], projectile.velocity[1], projectile.velocity[2]);
      const work = collideDynamicSphere(
        this.positions,
        this.previous,
        this.invMass,
        this.pinned,
        this.nodeCountValue,
        projectile,
        this.glassRig ? 0.08 : this.concreteRig ? 0.12 : 0.22,
        this.lastStepDt,
      );
      this.contactWorkValue += work / Math.max(1, this.nodeCountValue);
      if (!(work > 0) || speed < 10) continue;
      let nearestNode = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
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
      if (nearestNode >= 0) this.damageNearNode(nearestNode, clamp(speed * 0.008, 0.05, 0.32));
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
    if (this.compositeRig) {
      const impulse = clamp(strength, 0, 40) * 0.018;
      for (let station = 2; station < this.stations; station++) {
        const t = station / Math.max(1, this.stations - 1);
        const weightT = clamp((t - 0.54) / 0.46, 0, 1);
        const weight = weightT * weightT * (3 - 2 * weightT);
        if (weight <= 0) continue;
        for (let lane = 0; lane < this.lanes; lane++) {
          const index = this.node(station, lane);
          if (this.pinned[index] !== 0) continue;
          // A one-frame change to previous position is a bounded initial
          // velocity, matching an impact-style response test without holding
          // a force or modifying damage. The free-end envelope excites the
          // cantilever's dominant bending response deterministically.
          this.previous[index * 3 + 1] += impulse * weight;
        }
      }
      this.frameVersion++;
      return;
    }
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
    this.holdElapsed = next > 0.05 ? 0 : this.holdElapsed;
    this.telemetry.loadTarget = next;
    this.frameVersion++;
  }

  releaseLoad(): void {
    this.loadTarget = 0;
    this.cycleEnabled = false;
    this.holdElapsed = 0;
    this.telemetry.loadTarget = 0;
    this.frameVersion++;
  }

  cycleLoad(): void {
    this.cycleEnabled = !this.cycleEnabled;
    if (this.loadTarget <= 0.05) this.loadTarget = 1.15;
    this.telemetry.loadTarget = this.loadTarget;
    this.frameVersion++;
  }

  private applyDentStrike(
    centerStation: number,
    centerLane: number,
    strength: number,
    radiusScale: number,
  ): number {
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 1, 0.25, 2);
    if (this.crashRailRig) {
      const stationRadius = Math.max(2, this.stations * (this.recipe?.loadRadius[0] ?? 0.12) * radiusScale);
      const laneRadius = Math.max(2, this.lanes * (this.recipe?.loadRadius[1] ?? 0.92) * radiusScale);
      let totalWeight = 0;
      for (let station = 1; station < this.stations; station++) {
        for (let lane = 0; lane < this.lanes; lane++) {
          if (this.pinned[this.node(station, lane)] !== 0) continue;
          totalWeight += Math.max(0, 1 - Math.hypot(
            (station - centerStation) / stationRadius,
            (lane - centerLane) / laneRadius,
          ));
        }
      }
      const impulseScale = 1 / Math.max(1e-8, totalWeight);
      for (let station = 1; station < this.stations; station++) {
        for (let lane = 0; lane < this.lanes; lane++) {
          const index = this.node(station, lane);
          if (this.pinned[index] !== 0) continue;
          const weight = Math.max(0, 1 - Math.hypot(
            (station - centerStation) / stationRadius,
            (lane - centerLane) / laneRadius,
          )) * impulseScale;
          if (weight <= 0) continue;
          const offset = index * 3;
          // Positive previous-X creates a negative axial Verlet velocity. A
          // tiny alternating transverse component lets the folded section pick
          // a deterministic buckling lobe instead of collapsing perfectly flat.
          this.previous[offset] += weight * (0.28 + safeStrength * 0.46);
          const foldSign = ((station + lane) & 1) === 0 ? 1 : -1;
          this.previous[offset + 1] -= foldSign * weight * safeStrength * 0.035;
          this.previous[offset + 2] += foldSign * weight * safeStrength * 0.024;
        }
      }
      const centerNode = this.node(centerStation, centerLane);
      this.damageNearNode(centerNode, 0.05 + safeStrength * 0.08);
      this.telemetryCountdown = 0;
      this.frameVersion++;
      return centerNode;
    }
    const stationRadius = Math.max(2, this.stations * (this.recipe?.loadRadius[0] ?? 0.13) * radiusScale);
    const laneRadius = Math.max(2, this.lanes * (this.recipe?.loadRadius[1] ?? 0.34) * radiusScale);
    const referenceStationRadius = Math.max(2, this.stations * (this.recipe?.loadRadius[0] ?? 0.13));
    const referenceLaneRadius = Math.max(2, this.lanes * (this.recipe?.loadRadius[1] ?? 0.34));
    const footprintWeight = (station: number, lane: number, radiusU: number, radiusV: number): number => {
      const distance = Math.hypot(
        (station - centerStation) / radiusU,
        (lane - centerLane) / radiusV,
      );
      return Math.max(0, 1 - distance);
    };
    const totalWeight = (radiusU: number, radiusV: number): number => {
      let total = 0;
      for (let station = 1; station < this.stations - 1; station++) {
        for (let lane = 1; lane < this.lanes - 1; lane++) {
          const index = this.node(station, lane);
          if (this.pinned[index] === 0) total += footprintWeight(station, lane, radiusU, radiusV);
        }
      }
      return total;
    };
    const currentWeight = totalWeight(stationRadius, laneRadius);
    const referenceWeight = totalWeight(referenceStationRadius, referenceLaneRadius);
    // Strike strength is total normalized impulse. Radius changes its spatial
    // concentration, not the amount of momentum injected into the specimen.
    // Radius one retains the authored legacy impulse exactly.
    const footprintScale = currentWeight > 1e-8 ? referenceWeight / currentWeight : 1;
    for (let station = 1; station < this.stations - 1; station++) {
      for (let lane = 1; lane < this.lanes - 1; lane++) {
        const index = this.node(station, lane);
        if (this.pinned[index] !== 0) continue;
        const weight = footprintWeight(station, lane, stationRadius, laneRadius) * footprintScale;
        if (weight <= 0) continue;
        const offset = index * 3;
        // Verlet velocity is current minus previous. Move the previous point
        // opposite the authored surface-normal direction to create impact.
        const sign = this.recipe ? this.loadSigns[index] || -1 : -1;
        const thicknessImpulse = 1 / Math.max(0.08, this.thicknessScale);
        const impulse = weight * (0.11 + safeStrength * 0.16) * thicknessImpulse;
        const plastic = this.sheetSkin ? impulse * 1.65 : 0;
        if (this.verticalRig) {
          this.previous[offset + 2] -= sign * impulse;
          this.positions[offset + 2] += sign * plastic;
        } else {
          this.previous[offset + 1] -= sign * impulse;
          this.positions[offset + 1] += sign * plastic;
        }
        this.previous[offset] -= (station - centerStation) * weight * safeStrength * 0.003;
        if (this.verticalRig) this.previous[offset + 1] -= (lane - centerLane) * weight * safeStrength * 0.007;
        else this.previous[offset + 2] -= (lane - centerLane) * weight * safeStrength * 0.007;
      }
    }
    const centerNode = this.node(centerStation, centerLane);
    this.damageNearNode(centerNode, 0.10 + safeStrength * 0.12);
    this.formingHold = Math.max(this.formingHold, 0.55);
    this.telemetryCountdown = 0;
    this.frameVersion++;
    return centerNode;
  }

  private applyMaterialStrikeFootprint(
    centerStation: number,
    centerLane: number,
    safeStrength: number,
    radiusScale: number,
  ): void {
    const extent = Math.ceil(radiusScale);
    const normalImpulse = this.glassRig
      ? 0.28 + safeStrength * 0.42
      : 0.18 + safeStrength * 0.32;
    const damageImpulse = 0.20 + safeStrength * 0.32;
    let totalWeight = 0;
    for (let stationOffset = -extent; stationOffset <= extent; stationOffset++) {
      for (let laneOffset = -extent; laneOffset <= extent; laneOffset++) {
        const distance = Math.hypot(stationOffset / radiusScale, laneOffset / radiusScale);
        const weight = Math.max(0, 1 - distance);
        if (weight <= 0) continue;
        const station = centerStation + stationOffset;
        const lane = centerLane + laneOffset;
        if (station <= 0 || station >= this.stations - 1 || lane <= 0 || lane >= this.lanes - 1) continue;
        if (this.pinned[this.node(station, lane)] === 0) totalWeight += weight;
      }
    }
    const inverseWeight = 1 / Math.max(1e-8, totalWeight);
    for (let stationOffset = -extent; stationOffset <= extent; stationOffset++) {
      for (let laneOffset = -extent; laneOffset <= extent; laneOffset++) {
        const distance = Math.hypot(stationOffset / radiusScale, laneOffset / radiusScale);
        const weight = Math.max(0, 1 - distance) * inverseWeight;
        if (weight <= 0) continue;
        const station = centerStation + stationOffset;
        const lane = centerLane + laneOffset;
        if (station <= 0 || station >= this.stations - 1 || lane <= 0 || lane >= this.lanes - 1) continue;
        const index = this.node(station, lane);
        if (this.pinned[index] !== 0) continue;
        const offset = index * 3;
        const sign = this.recipe ? this.loadSigns[index] || -1 : -1;
        const thicknessImpulse = 1 / Math.max(0.08, this.thicknessScale);
        if (this.verticalRig) this.previous[offset + 2] -= sign * normalImpulse * weight * thicknessImpulse;
        else this.previous[offset + 1] -= sign * normalImpulse * weight * thicknessImpulse;
        if (!this.glassRig) this.damageNearNode(index, damageImpulse * weight);
      }
    }
  }

  private applyMaterialStrike(
    centerStation: number,
    centerLane: number,
    strength: number,
    radiusScale: number,
  ): number {
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 1, 0.25, 2);
    const centerNode = this.node(centerStation, centerLane);
    this.applyMaterialStrikeFootprint(centerStation, centerLane, safeStrength, radiusScale);
    if (this.glassRig) {
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
        if (this.concreteRig && safeStrength >= 0.7) {
        const style = this.recipe?.crackStyle ?? 'local';
        const offsets: [number, number][] = [[0, 0]];
        if (safeStrength >= 1.0 || style !== 'local') {
          if (style === 'diagonal') offsets.push([-1, -1], [1, 1], [-2, -2], [2, 2]);
          else if (style !== 'cone') offsets.push([-1, 0], [1, 0]);
        }
        if (style === 'cone') {
          offsets.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        } else if (safeStrength >= 1.25 || style === 'radial') {
          offsets.push([0, -1], [0, 1], [-2, 0], [2, 0]);
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

  dentStrike(strength: number): number {
    if (!this.dentRig) return -1;
    return this.applyDentStrike(this.targetStation(), this.targetLane(), strength, 1);
  }

  materialStrike(strength: number): number {
    if (this.dentRig) return this.dentStrike(strength);
    const multiHit = this.recipe?.id === 'glass-hail-multi-hit' && this.fracturedCellCountValue > 0;
    const centerStation = this.targetStation(multiHit ? 1 - this.recipe!.strikeCenter[0] : undefined);
    const centerLane = this.targetLane(multiHit ? 1 - this.recipe!.strikeCenter[1] : undefined);
    return this.applyMaterialStrike(centerStation, centerLane, strength, 1);
  }

  materialStrikeAt(u: number, v: number, strength: number, radiusScale = 1): number {
    const centerStation = this.targetStation(normalizedStrikeCoordinate(u));
    const centerLane = this.targetLane(normalizedStrikeCoordinate(v));
    const safeRadiusScale = normalizedStrikeRadiusScale(radiusScale);
    if (this.dentRig) return this.applyDentStrike(centerStation, centerLane, strength, safeRadiusScale);
    return this.applyMaterialStrike(centerStation, centerLane, strength, safeRadiusScale);
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
    let shapeEnergy = 0;
    for (let i = 0; i < this.constraintCountValue; i++) {
      if (this.broken[i] !== 0) continue;
      const ao = this.a[i] * 3;
      const bo = this.b[i] * 3;
      const length = Math.hypot(
        this.positions[bo] - this.positions[ao],
        this.positions[bo + 1] - this.positions[ao + 1],
        this.positions[bo + 2] - this.positions[ao + 2],
      );
      const elasticDelta = length - this.rest[i];
      const shapeDelta = length - this.originalRest[i];
      strainEnergy += elasticDelta * elasticDelta * this.stiffness[i];
      shapeEnergy += shapeDelta * shapeDelta * this.stiffness[i];
    }
    let hingeEnergy = 0;
    let bendEnergy = 0;
    for (let i = 0; i < this.hingeCountValue; i++) {
      const a = this.hingeA[i];
      const b = this.hingeB[i];
      const c = this.hingeC[i];
      const theta = polylineBendAngle(
        this.positions[a * 3], this.positions[a * 3 + 1], this.positions[a * 3 + 2],
        this.positions[b * 3], this.positions[b * 3 + 1], this.positions[b * 3 + 2],
        this.positions[c * 3], this.positions[c * 3 + 1], this.positions[c * 3 + 2],
      );
      const elasticDelta = theta - this.hingeRest[i];
      const shapeDelta = theta - this.hingeOriginalRest[i];
      hingeEnergy += elasticDelta * elasticDelta * this.hingeStiffness[i] * 1e-4;
      bendEnergy += shapeDelta * shapeDelta * this.hingeStiffness[i];
    }
    this.elasticEnergyValue = strainEnergy + hingeEnergy + shapeEnergy + bendEnergy;
    const contactTotal = this.contactWorkValue * Math.max(1, this.nodeCountValue);
    this.energyValue = kinetic + this.elasticEnergyValue + this.plasticWorkValue + this.dampingWorkValue + contactTotal;
    let hash = quantizedHash(this.positions);
    hash = quantizedHash(this.rest, hash);
    hash = quantizedHash(this.hingeRest, hash);
    hash = quantizedHash(this.damage, hash);
    hash = quantizedHash(this.cellDamage, hash);
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
    this.telemetry.elasticEnergy = this.elasticEnergyValue;
    this.telemetry.plasticWork = this.plasticWorkValue;
    this.telemetry.dampingWork = this.dampingWorkValue;
    this.telemetry.contactWork = contactTotal;
    let centerDeflection = 0;
    const centerStation = (this.recipe?.loadCenter[0] ?? 0.5) * (this.stations - 1);
    const centerLane = (this.recipe?.loadCenter[1] ?? 0.5) * (this.lanes - 1);
    const deflectionSign = this.recipe?.loadSign ?? -1;
    for (let station = 0; station < this.stations; station++) {
      if (Math.abs(station - centerStation) > Math.max(1, this.stations * 0.08)) continue;
      for (let lane = 0; lane < this.lanes; lane++) {
        if (Math.abs(lane - centerLane) > Math.max(1, this.lanes * 0.18)) continue;
        const offset = this.node(station, lane) * 3;
        if (this.verticalRig) {
          centerDeflection = Math.max(
            centerDeflection,
            deflectionSign * (this.positions[offset + 2] - this.restPositions[offset + 2]),
          );
        } else {
          centerDeflection = Math.max(
            centerDeflection,
            deflectionSign * (this.positions[offset + 1] - this.restPositions[offset + 1]),
          );
        }
      }
    }
    centerDeflection = Math.max(0, this.verticalRig ? Math.min(centerDeflection, this.depth * 0.5) : centerDeflection);
    if (this.crashRailRig) {
      let shortening = 0;
      let sampleCount = 0;
      for (let station = Math.max(0, this.stations - 3); station < this.stations; station++) {
        for (let lane = 0; lane < this.lanes; lane++) {
          const offset = this.node(station, lane) * 3;
          shortening += Math.max(0, this.restPositions[offset] - this.positions[offset]);
          sampleCount++;
        }
      }
      // The shared telemetry field carries axial terminal shortening for this
      // recipe. Values remain normalized model coordinates, not millimetres.
      centerDeflection = shortening / Math.max(1, sampleCount);
    }
    if (this.compositeRig) {
      let tipResponse = 0;
      let tipSamples = 0;
      for (let station = Math.max(2, this.stations - 2); station < this.stations; station++) {
        for (let lane = 0; lane < this.lanes; lane++) {
          const offset = this.node(station, lane) * 3;
          tipResponse += this.positions[offset + 1] - this.restPositions[offset + 1];
          tipSamples++;
        }
      }
      this.telemetry.probeResponse = tipResponse / Math.max(1, tipSamples);
    }
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

  private sampleLatticeComponent(
    source: Float32Array,
    station: number,
    lane: number,
    component: 0 | 1 | 2,
    cubicStation: boolean,
    cubicLane: boolean,
  ): number {
    const sampleNode = (s: number, l: number): number => {
      const ns = s < 0 ? 0 : s > this.stations - 1 ? this.stations - 1 : s | 0;
      const nl = l < 0 ? 0 : l > this.lanes - 1 ? this.lanes - 1 : l | 0;
      return source[this.node(ns, nl) * 3 + component];
    };
    const sampleAlongStation = (l: number): number => {
      if (!cubicStation) {
        const s0 = Math.min(this.stations - 2, Math.max(0, Math.floor(station)));
        const t = station - s0;
        return sampleNode(s0, l) + (sampleNode(s0 + 1, l) - sampleNode(s0, l)) * t;
      }
      const s = station < 0 ? 0 : station > this.stations - 1 ? this.stations - 1 : station;
      const i = Math.min(this.stations - 2, Math.floor(s));
      const t = s - i;
      return catmullRom(
        sampleNode(i - 1, l),
        sampleNode(i, l),
        sampleNode(i + 1, l),
        sampleNode(i + 2, l),
        t,
      );
    };
    if (!cubicLane) {
      const l0 = Math.min(this.lanes - 2, Math.max(0, Math.floor(lane)));
      const t = lane - l0;
      return sampleAlongStation(l0) + (sampleAlongStation(l0 + 1) - sampleAlongStation(l0)) * t;
    }
    const l = lane < 0 ? 0 : lane > this.lanes - 1 ? this.lanes - 1 : lane;
    const j = Math.min(this.lanes - 2, Math.floor(l));
    const t = l - j;
    return catmullRom(
      sampleAlongStation(j - 1),
      sampleAlongStation(j),
      sampleAlongStation(j + 1),
      sampleAlongStation(j + 2),
      t,
    );
  }

  private sampleLattice(source: Float32Array, station: number, lane: number, cubicStation: boolean, cubicLane: boolean): Vec3 {
    return [
      this.sampleLatticeComponent(source, station, lane, 0, cubicStation, cubicLane),
      this.sampleLatticeComponent(source, station, lane, 1, cubicStation, cubicLane),
      this.sampleLatticeComponent(source, station, lane, 2, cubicStation, cubicLane),
    ];
  }

  private sampleNodeScalar(source: Float32Array, station: number, lane: number, cubicStation: boolean, cubicLane: boolean): number {
    const sampleNode = (s: number, l: number): number => {
      const ns = s < 0 ? 0 : s > this.stations - 1 ? this.stations - 1 : s | 0;
      const nl = l < 0 ? 0 : l > this.lanes - 1 ? this.lanes - 1 : l | 0;
      return source[this.node(ns, nl)];
    };
    const sampleAlongStation = (l: number): number => {
      if (!cubicStation) {
        const s0 = Math.min(this.stations - 2, Math.max(0, Math.floor(station)));
        const t = station - s0;
        return sampleNode(s0, l) + (sampleNode(s0 + 1, l) - sampleNode(s0, l)) * t;
      }
      const s = station < 0 ? 0 : station > this.stations - 1 ? this.stations - 1 : station;
      const i = Math.min(this.stations - 2, Math.floor(s));
      const t = s - i;
      return catmullRom(
        sampleNode(i - 1, l),
        sampleNode(i, l),
        sampleNode(i + 1, l),
        sampleNode(i + 2, l),
        t,
      );
    };
    if (!cubicLane) {
      const l0 = Math.min(this.lanes - 2, Math.max(0, Math.floor(lane)));
      const t = lane - l0;
      return sampleAlongStation(l0) + (sampleAlongStation(l0 + 1) - sampleAlongStation(l0)) * t;
    }
    const l = lane < 0 ? 0 : lane > this.lanes - 1 ? this.lanes - 1 : lane;
    const j = Math.min(this.lanes - 2, Math.floor(l));
    const t = l - j;
    return catmullRom(
      sampleAlongStation(j - 1),
      sampleAlongStation(j),
      sampleAlongStation(j + 1),
      sampleAlongStation(j + 2),
      t,
    );
  }

  private fillNodeDemand(dentPeakDeflection: number): void {
    const yieldStrain = Math.max(1e-5, this.profile.tensileYieldStrain);
    const peak = Math.max(1e-6, dentPeakDeflection);
    for (let station = 0; station < this.stations; station++) {
      for (let lane = 0; lane < this.lanes; lane++) {
        const node = this.node(station, lane);
        const offset = node * 3;
        const deflection = Math.abs(this.positions[offset + 1] - this.restPositions[offset + 1]) / peak;
        let strain = 0;
        const consider = (otherStation: number, otherLane: number): void => {
          if (otherStation < 0 || otherStation >= this.stations || otherLane < 0 || otherLane >= this.lanes) return;
          const other = this.node(otherStation, otherLane) * 3;
          const restLen = Math.hypot(
            this.restPositions[other] - this.restPositions[offset],
            this.restPositions[other + 1] - this.restPositions[offset + 1],
            this.restPositions[other + 2] - this.restPositions[offset + 2],
          );
          if (!(restLen > 1e-6)) return;
          const live = Math.hypot(
            this.positions[other] - this.positions[offset],
            this.positions[other + 1] - this.positions[offset + 1],
            this.positions[other + 2] - this.positions[offset + 2],
          );
          strain = Math.max(strain, Math.abs(live / restLen - 1));
        };
        consider(station - 1, lane);
        consider(station + 1, lane);
        consider(station, lane - 1);
        consider(station, lane + 1);
        const strainRatio = strain / yieldStrain;
        this.nodeDemand[node] = Math.max(clamp((strainRatio - 0.05) / 1.10, 0, 1), clamp(deflection, 0, 1));
      }
    }
  }

  private latticeCellFailed(station: number, lane: number): boolean {
    const cellStation = Math.min(this.stations - 2, Math.max(0, station | 0));
    const cellLane = Math.min(this.lanes - 1, Math.max(0, lane | 0));
    const cell = cellStation * this.lanes + cellLane;
    return cell >= 0 && cell < this.failedCells.length && this.failedCells[cell] !== 0;
  }

  private bakeSheetRestSkin(): void {
    const rest = this.skinRest;
    if (!this.sheetSkin || !rest) return;
    const cubicStation = true;
    const cubicLane = !this.crashRailRig;
    for (let row = 0; row < this.skinRows; row++) {
      const lane = row / this.skinDiv;
      for (let col = 0; col < this.skinCols; col++) {
        const point = this.sampleLattice(this.restPositions, col / this.skinDiv, lane, cubicStation, cubicLane);
        const offset = (row * this.skinCols + col) * 3;
        rest[offset] = point[0];
        rest[offset + 1] = point[1];
        rest[offset + 2] = point[2];
      }
    }
  }

  private writeSheetSkin(): PackedSurfaceFrame | null {
    const vertices = this.skinVertices;
    const indices = this.skinIndices;
    const mid = this.skinMid;
    const rest = this.skinRest;
    const normals = this.skinNormals;
    const surface = this.packedSheetResult;
    if (!this.sheetSkin || !vertices || !indices || !mid || !rest || !normals || !surface) return null;

    const cols = this.skinCols;
    const rows = this.skinRows;
    const div = this.skinDiv;
    const cubicStation = true;
    const cubicLane = !this.crashRailRig;
    const fallbackNormal: Vec3 = this.verticalRig ? [0, 0, 1] : [0, 1, 0];
    const halfThick = this.crashRailRig ? 0.032 : 0.018;
    const base = this.profile.baseColor;

    let dentPeakDeflection = 0;
    if (this.dentRig) {
      for (let node = 0; node < this.nodeCountValue; node++) {
        const offset = node * 3;
        dentPeakDeflection = Math.max(
          dentPeakDeflection,
          Math.abs(this.positions[offset + 1] - this.restPositions[offset + 1]),
        );
      }
    }
    if (this.dentRig && this.loadProgress > 0.04) this.fillNodeDemand(dentPeakDeflection);

    for (let row = 0; row < rows; row++) {
      const lane = row / div;
      for (let col = 0; col < cols; col++) {
        const station = col / div;
        const point = this.sampleLattice(this.positions, station, lane, cubicStation, cubicLane);
        const offset = (row * cols + col) * 3;
        mid[offset] = point[0];
        mid[offset + 1] = point[1];
        mid[offset + 2] = point[2];
      }
    }

    normals.fill(0);
    const accumulate = (ia: number, ib: number, ic: number): void => {
      const ao = ia * 3;
      const bo = ib * 3;
      const co = ic * 3;
      const abx = mid[bo] - mid[ao];
      const aby = mid[bo + 1] - mid[ao + 1];
      const abz = mid[bo + 2] - mid[ao + 2];
      const acx = mid[co] - mid[ao];
      const acy = mid[co + 1] - mid[ao + 1];
      const acz = mid[co + 2] - mid[ao + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      normals[ao] += nx; normals[ao + 1] += ny; normals[ao + 2] += nz;
      normals[bo] += nx; normals[bo + 1] += ny; normals[bo + 2] += nz;
      normals[co] += nx; normals[co + 1] += ny; normals[co + 2] += nz;
    };
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const i0 = row * cols + col;
        const i1 = i0 + 1;
        const i2 = i0 + cols;
        const i3 = i2 + 1;
        accumulate(i0, i2, i1);
        accumulate(i1, i2, i3);
      }
    }

    const midCount = this.skinMidCount;
    for (let i = 0; i < midCount; i++) {
      const o = i * 3;
      const col = i % cols;
      const row = (i / cols) | 0;
      let nx = normals[o];
      let ny = normals[o + 1];
      let nz = normals[o + 2];
      const length = Math.hypot(nx, ny, nz);
      if (length <= 1e-12) {
        nx = fallbackNormal[0];
        ny = fallbackNormal[1];
        nz = fallbackNormal[2];
      } else {
        nx /= length;
        ny /= length;
        nz /= length;
      }

      let overlayR = base[0];
      let overlayG = base[1];
      let overlayB = base[2];
      let overlayA = 0;
      if (this.dentRig && this.loadProgress > 0.04) {
        const demandT = clamp(this.sampleNodeScalar(this.nodeDemand, col / div, row / div, cubicStation, cubicLane), 0, 1);
        const smoothDemand = demandT * demandT * (3 - 2 * demandT);
        const overlay = diagnosticContourColor(smoothDemand);
        overlayR = base[0] * 0.38 + overlay[0] * 0.62;
        overlayG = base[1] * 0.38 + overlay[1] * 0.62;
        overlayB = base[2] * 0.38 + overlay[2] * 0.62;
        overlayA = smoothDemand;
      }

      const u = col / Math.max(1, cols - 1);
      const v = row / Math.max(1, rows - 1);
      writePackedSurfaceVertex(
        vertices, i,
        mid[o] + nx * halfThick, mid[o + 1] + ny * halfThick, mid[o + 2] + nz * halfThick,
        nx, ny, nz,
        overlayR, overlayG, overlayB, overlayA,
        u, v,
      );
      writePackedSurfaceVertex(
        vertices, i + midCount,
        mid[o] - nx * halfThick, mid[o + 1] - ny * halfThick, mid[o + 2] - nz * halfThick,
        -nx, -ny, -nz,
        overlayR, overlayG, overlayB, overlayA,
        u, 1 - v,
      );
    }

    let indexCount = 0;
    let tearSignature = 2166136261 >>> 0;
    const push = (a: number, b: number, c: number): void => {
      indices[indexCount++] = a;
      indices[indexCount++] = b;
      indices[indexCount++] = c;
    };
    const edgeStretch = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      rax: number, ray: number, raz: number,
      rbx: number, rby: number, rbz: number,
    ): number => {
      const rest = Math.hypot(rbx - rax, rby - ray, rbz - raz);
      if (!(rest > 1e-6)) return 0;
      return Math.hypot(bx - ax, by - ay, bz - az) / rest;
    };
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const i0 = row * cols + col;
        const i1 = i0 + 1;
        const i2 = i0 + cols;
        const i3 = i2 + 1;
        const o0 = i0 * 3;
        const o1 = i1 * 3;
        const o2 = i2 * 3;
        const o3 = i3 * 3;
        const rest0 = o0;
        const rest1 = o1;
        const rest2 = o2;
        const rest3 = o3;
        const stationStretch = Math.max(
          edgeStretch(mid[o0], mid[o0 + 1], mid[o0 + 2], mid[o1], mid[o1 + 1], mid[o1 + 2], rest[rest0], rest[rest0 + 1], rest[rest0 + 2], rest[rest1], rest[rest1 + 1], rest[rest1 + 2]),
          edgeStretch(mid[o2], mid[o2 + 1], mid[o2 + 2], mid[o3], mid[o3 + 1], mid[o3 + 2], rest[rest2], rest[rest2 + 1], rest[rest2 + 2], rest[rest3], rest[rest3 + 1], rest[rest3 + 2]),
        );
        const laneStretch = Math.max(
          edgeStretch(mid[o0], mid[o0 + 1], mid[o0 + 2], mid[o2], mid[o2 + 1], mid[o2 + 2], rest[rest0], rest[rest0 + 1], rest[rest0 + 2], rest[rest2], rest[rest2 + 1], rest[rest2 + 2]),
          edgeStretch(mid[o1], mid[o1 + 1], mid[o1 + 2], mid[o3], mid[o3 + 1], mid[o3 + 2], rest[rest1], rest[rest1 + 1], rest[rest1 + 2], rest[rest3], rest[rest3 + 1], rest[rest3 + 2]),
        );
        const stretch = Math.max(stationStretch, laneStretch);
        const failed = this.latticeCellFailed(col / div, row / div);
        const fracStation = col / div - Math.floor(col / div);
        const fracLane = row / div - Math.floor(row / div);
        const halfBin = 0.5 / Math.max(1, div);
        const seamAlongLane = stationStretch >= laneStretch;
        const onSeam = seamAlongLane
          ? Math.abs(fracStation - 0.5) <= halfBin + 1e-6
          : Math.abs(fracLane - 0.5) <= halfBin + 1e-6;
        const notched = Boolean(this.recipe?.notch);
        const tearLimit = notched ? SHEET_NOTCH_TEAR_STRETCH : SHEET_TEAR_STRETCH;
        const failedTearLimit = notched ? SHEET_NOTCH_FAILED_TEAR_STRETCH : SHEET_FAILED_TEAR_STRETCH;
        const openTear = (notched && this.skinQuadOnAuthoredNotch(col, row))
          || stretch > tearLimit
          || (failed && onSeam && stretch > failedTearLimit);
        if (openTear) {
          tearSignature ^= Math.imul(row * cols + col + 1, 16777619);
          continue;
        }
        push(i0, i2, i1);
        push(i1, i2, i3);
        push(i0 + midCount, i1 + midCount, i2 + midCount);
        push(i1 + midCount, i3 + midCount, i2 + midCount);
      }
    }

    const stitch = (a: number, b: number): void => {
      push(a, b, a + midCount);
      push(b, b + midCount, a + midCount);
    };
    for (let col = 0; col < cols - 1; col++) {
      stitch(col, col + 1);
      const rowStart = (rows - 1) * cols;
      stitch(rowStart + col + 1, rowStart + col);
    }
    for (let row = 0; row < rows - 1; row++) {
      stitch((row + 1) * cols, row * cols);
      stitch(row * cols + cols - 1, (row + 1) * cols + cols - 1);
    }

    if (tearSignature !== this.skinTearSignature) {
      this.skinTearSignature = tearSignature;
      this.skinTopologyVersion++;
    }
    surface.vertexCount = midCount * 2;
    surface.indexCount = indexCount;
    surface.topologyVersion = this.skinTopologyVersion;
    surface.frameVersion = this.frameVersion;
    return surface;
  }

  private writePanelSkinTiles(startIndex: number): number {
    if (this.sheetSkin) return startIndex;
    if (!this.sheetRig && !this.concreteRig && !this.glassRig) return startIndex;
    let instanceCount = startIndex;
    let compositePeakDisplacement = 0;
    let dentPeakDeflection = 0;
    if (this.dentRig) {
      for (let node = 0; node < this.nodeCountValue; node++) {
        const offset = node * 3;
        dentPeakDeflection = Math.max(
          dentPeakDeflection,
          Math.abs(this.positions[offset + 1] - this.restPositions[offset + 1]),
        );
      }
    }
    if (this.compositeRig) {
      for (let node = 0; node < this.nodeCountValue; node++) {
        const offset = node * 3;
        compositePeakDisplacement = Math.max(compositePeakDisplacement, Math.hypot(
          this.positions[offset] - this.restPositions[offset],
          this.positions[offset + 1] - this.restPositions[offset + 1],
          this.positions[offset + 2] - this.restPositions[offset + 2],
        ));
      }
    }
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
        const restStationVector: Vec3 = [
          ((this.restPositions[p1] - this.restPositions[p0]) + (this.restPositions[p3] - this.restPositions[p2])) * 0.5,
          ((this.restPositions[p1 + 1] - this.restPositions[p0 + 1]) + (this.restPositions[p3 + 1] - this.restPositions[p2 + 1])) * 0.5,
          ((this.restPositions[p1 + 2] - this.restPositions[p0 + 2]) + (this.restPositions[p3 + 2] - this.restPositions[p2 + 2])) * 0.5,
        ];
        const restLaneVector: Vec3 = [
          ((this.restPositions[p2] - this.restPositions[p0]) + (this.restPositions[p3] - this.restPositions[p1])) * 0.5,
          ((this.restPositions[p2 + 1] - this.restPositions[p0 + 1]) + (this.restPositions[p3 + 1] - this.restPositions[p1 + 1])) * 0.5,
          ((this.restPositions[p2 + 2] - this.restPositions[p0 + 2]) + (this.restPositions[p3 + 2] - this.restPositions[p1 + 2])) * 0.5,
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
          writeBasisModelMatrix(this.matrices, instanceCount * 16, center, xAxis, laneAxis, zAxis, [xHalf, laneHalf, this.glassRig ? 0.007 : this.concreteRig ? 0.11 : this.compositeRig ? 0.09 : 0.018]);
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
            [xHalf, this.concreteRig ? 0.11 : this.compositeRig ? 0.09 : this.crashRailRig ? 0.032 : 0.018, laneHalf],
          );
        }
        let tileColor = color;
        if (this.dentRig && this.loadProgress > 0.04) {
          const stationRestLength = Math.max(1e-6, Math.hypot(...restStationVector));
          const laneRestLength = Math.max(1e-6, Math.hypot(...restLaneVector));
          const stationStrain = Math.abs(Math.hypot(...stationVector) / stationRestLength - 1);
          const laneStrain = Math.abs(Math.hypot(...laneVector) / laneRestLength - 1);
          const strainRatio = Math.max(stationStrain, laneStrain) / Math.max(1e-5, this.profile.tensileYieldStrain);
          let restCenterY = 0;
          for (const node of corners) restCenterY += this.restPositions[node * 3 + 1] * 0.25;
          const deflectionDemand = Math.abs(center[1] - restCenterY) / Math.max(1e-6, dentPeakDeflection);
          const demandT = Math.max(
            clamp((strainRatio - 0.05) / 1.10, 0, 1),
            clamp(deflectionDemand, 0, 1),
          );
          const smoothDemand = demandT * demandT * (3 - 2 * demandT);
          // The contour combines solved local lattice strain with normalized
          // deformed-shape demand. It is a response diagnostic, not calibrated
          // stress; low demand remains blue and the active dent moves to red.
          const overlay = diagnosticContourColor(smoothDemand);
          tileColor = [
            color[0] * 0.22 + overlay[0] * 0.78,
            color[1] * 0.22 + overlay[1] * 0.78,
            color[2] * 0.22 + overlay[2] * 0.78,
            overlay[3],
          ];
        } else if (this.compositeRig && compositePeakDisplacement > 1e-4) {
          const restCenter: Vec3 = [0, 0, 0];
          for (const node of corners) {
            const offset = node * 3;
            restCenter[0] += this.restPositions[offset] * 0.25;
            restCenter[1] += this.restPositions[offset + 1] * 0.25;
            restCenter[2] += this.restPositions[offset + 2] * 0.25;
          }
          const displacement = Math.hypot(
            center[0] - restCenter[0],
            center[1] - restCenter[1],
            center[2] - restCenter[2],
          );
          // This is an exaggerated visualization of the solved normalized
          // response amplitude, not a physical displacement or mode shape.
          tileColor = responseContourColor(displacement / compositePeakDisplacement);
        } else if (this.concreteRig) {
          let damage = 0;
          for (let s = station; s < endStation; s++) {
            for (let l = lane; l < endLane; l++) {
              damage = Math.max(damage, this.cellDamage[s * this.lanes + l] ?? 0);
            }
          }
          if (damage > 0.04) {
            const overlay = diagnosticContourColor(clamp(damage, 0, 1));
            tileColor = [
              color[0] * (1 - damage * 0.72) + overlay[0] * damage * 0.72,
              color[1] * (1 - damage * 0.72) + overlay[1] * damage * 0.72,
              color[2] * (1 - damage * 0.72) + overlay[2] * damage * 0.72,
              color[3],
            ];
          }
        }
        setColor(this.colors, instanceCount++, tileColor);
      }
    }
    return instanceCount;
  }

  private writeFailureAccents(startIndex: number): number {
    let instanceCount = startIndex;
    if (this.dentRig && this.yieldedCountValue > 0 && !this.sheetSkin) {
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

  private sampleLatticePoint(normalized: readonly [number, number], source: Float32Array): Vec3 {
    const station = clamp(Math.round(normalized[0] * (this.stations - 1)), 0, this.stations - 1);
    const lane = clamp(Math.round(normalized[1] * (this.lanes - 1)), 0, this.lanes - 1);
    const offset = this.node(station, lane) * 3;
    return [source[offset], source[offset + 1], source[offset + 2]];
  }

  private currentPoint(normalized: readonly [number, number]): Vec3 {
    return this.sampleLatticePoint(normalized, this.positions);
  }

  private restPoint(normalized: readonly [number, number]): Vec3 {
    return this.sampleLatticePoint(normalized, this.restPositions);
  }

  private blendPoints(rest: Vec3, live: Vec3, blend: number): Vec3 {
    return [
      rest[0] + (live[0] - rest[0]) * blend,
      rest[1] + (live[1] - rest[1]) * blend,
      rest[2] + (live[2] - rest[2]) * blend,
    ];
  }

  private writeRecipeFixtures(startIndex: number): number {
    const recipe = this.recipe;
    if (!recipe || recipe.kind === 'combined') return startIndex;
    let index = startIndex;
    const steel: readonly [number, number, number, number] = [0.48, 0.56, 0.64, -2];
    const darkSteel: readonly [number, number, number, number] = [0.16, 0.20, 0.25, 1];
    const add = (position: Vec3, half: Vec3, tint: readonly [number, number, number, number]): void => {
      if (index >= MAX_FIXTURE_INSTANCES) return;
      writeAxisAlignedModelMatrix(this.matrices, index * 16, position, half[0], half[1], half[2]);
      setColor(this.colors, index++, tint);
    };
    const addVerticalShell = (
      center: Vec3,
      radius: number,
      halfHeight: number,
      tint: readonly [number, number, number, number],
      sides = 10,
    ): void => {
      const tangentHalf = radius * Math.tan(Math.PI / sides) * 1.03;
      const shellHalf = Math.max(0.025, radius * 0.06);
      for (let side = 0; side < sides && index < MAX_FIXTURE_INSTANCES; side++) {
        const angle = side * Math.PI * 2 / sides;
        writeModelMatrixFromEuler(
          this.matrices,
          index * 16,
          [center[0] + Math.cos(angle) * radius, center[1], center[2] + Math.sin(angle) * radius],
          [0, Math.PI * 0.5 - angle, 0],
          [tangentHalf, halfHeight, shellHalf],
        );
        setColor(this.colors, index++, tint);
      }
    };
    const addOriented = (
      position: Vec3,
      rotation: Vec3,
      half: Vec3,
      tint: readonly [number, number, number, number],
    ): void => {
      if (index >= MAX_FIXTURE_INSTANCES) return;
      writeModelMatrixFromEuler(this.matrices, index * 16, position, rotation, half);
      setColor(this.colors, index++, tint);
    };
    const addZShell = (
      center: Vec3,
      radius: number,
      halfLength: number,
      tint: readonly [number, number, number, number],
      sides = 10,
    ): void => {
      const tangentHalf = radius * Math.tan(Math.PI / sides) * 1.03;
      const shellHalf = Math.max(0.025, radius * 0.06);
      for (let side = 0; side < sides && index < MAX_FIXTURE_INSTANCES; side++) {
        const angle = side * Math.PI * 2 / sides;
        writeModelMatrixFromEuler(
          this.matrices,
          index * 16,
          [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius, center[2]],
          [0, 0, angle],
          [shellHalf, tangentHalf, halfLength],
        );
        setColor(this.colors, index++, tint);
      }
    };
    const toolSteel: readonly [number, number, number, number] = [0.62, 0.64, 0.66, -2];
    const polished: readonly [number, number, number, number] = [0.78, 0.80, 0.82, -2];
    const paint: readonly [number, number, number, number] = [0.16, 0.20, 0.17, 1];
    const safety: readonly [number, number, number, number] = [0.82, 0.62, 0.12, 1];

    const halfSpan = this.span * 0.5;
    const halfDepth = this.depth * 0.5;
    if (this.crashRailRig) {
      const fixtureBlack: readonly [number, number, number, number] = [0.035, 0.045, 0.052, 1];
      const aluminum: readonly [number, number, number, number] = [0.58, 0.64, 0.69, -2];
      const bulkheadX = -halfSpan - 0.62;
      let terminalX = 0;
      let terminalY = 0;
      let terminalZ = 0;
      for (let lane = 0; lane < this.lanes; lane++) {
        const offset = this.node(this.stations - 1, lane) * 3;
        terminalX += this.positions[offset] / this.lanes;
        terminalY += this.positions[offset + 1] / this.lanes;
        terminalZ += this.positions[offset + 2] / this.lanes;
      }

      // Fixed bulkhead and clamp stack. These are render-only witnesses of the
      // actual pinned first two lattice stations, not extra collision bodies.
      add([bulkheadX - 0.72, 3.65, 0], [1.05, 3.45, halfDepth + 1.30], darkSteel);
      add([bulkheadX, this.baseY, 0], [0.48, halfDepth * 0.98, halfDepth + 1.02], steel);
      add([-halfSpan + 0.12, this.baseY + 1.30, 0], [0.72, 0.30, halfDepth + 0.42], aluminum);
      add([-halfSpan + 0.12, this.baseY - 1.30, 0], [0.72, 0.30, halfDepth + 0.42], aluminum);
      for (const y of [this.baseY - 1.92, this.baseY + 1.92]) {
        for (const z of [-halfDepth - 0.44, halfDepth + 0.44]) {
          add([bulkheadX + 0.50, y, z], [0.07, 0.19, 0.19], fixtureBlack);
        }
      }

      // The guided platen follows the solved terminal-section centroid. Its
      // motion therefore stays synchronized with real reduced-order shortening
      // while remaining visually distinct from the deformable rail.
      const platenX = terminalX + 0.42;
      add([platenX, terminalY, terminalZ], [0.30, halfDepth * 0.92, halfDepth + 0.72], darkSteel);
      add([platenX - 0.32, terminalY, terminalZ], [0.08, halfDepth * 0.80, halfDepth + 0.52], aluminum);
      add([platenX + 1.12, terminalY, terminalZ], [0.82, 0.46, 0.46], steel);
      add([platenX + 2.04, terminalY, terminalZ], [0.12, 0.62, 0.62], paint);

      // Twin sled rails and their grounded shoes make the axial load path
      // legible in the dark cell without constraining the solver a second time.
      for (const z of [-halfDepth - 1.00, halfDepth + 1.00]) {
        add([0.4, 1.05, z], [halfSpan + 3.1, 0.15, 0.20], steel);
        add([-halfSpan - 0.55, 0.64, z], [1.20, 0.44, 0.56], darkSteel);
        add([halfSpan + 1.75, 0.64, z], [1.20, 0.44, 0.56], darkSteel);
      }
      return index;
    }
    const boundary = recipe.boundary;
    if (this.verticalRig) {
      if (boundary === 'perimeter') {
        add([0, this.baseY - halfDepth - 0.22, 0], [halfSpan + 0.42, 0.18, 0.24], steel);
        add([0, this.baseY + halfDepth + 0.22, 0], [halfSpan + 0.42, 0.18, 0.24], steel);
        add([-halfSpan - 0.22, this.baseY, 0], [0.18, halfDepth + 0.40, 0.24], steel);
        add([halfSpan + 0.22, this.baseY, 0], [0.18, halfDepth + 0.40, 0.24], steel);
      } else if (boundary === 'four-corner') {
        for (const x of [-halfSpan, halfSpan]) for (const y of [this.baseY - halfDepth, this.baseY + halfDepth]) add([x, y, 0], [0.34, 0.34, 0.30], steel);
      } else if (boundary === 'cantilever' || boundary === 'simple-span' || boundary === 'end-clamped') {
        add([-halfSpan - 0.22, this.baseY, 0], [boundary === 'cantilever' ? 0.42 : 0.22, halfDepth + 0.42, 0.30], steel);
        if (boundary !== 'cantilever') add([halfSpan + 0.22, this.baseY, 0], [0.22, halfDepth + 0.42, 0.30], steel);
      } else {
        const exhaustive: never = boundary;
        void exhaustive;
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
    } else if (boundary === 'simple-span' || boundary === 'end-clamped') {
      for (const x of [-halfSpan, halfSpan]) {
        if (recipe.fixtureStyle === 'rollers') {
          const columnHalf = this.baseY * 0.48;
          const inward = x >= 0 ? -1 : 1;
          add([x, 0.14, 0], [0.78, 0.14, 0.62], paint);
          add([x, columnHalf, 0], [0.08, columnHalf, 0.28], paint);
          add([x, columnHalf, -0.34], [0.34, columnHalf, 0.07], paint);
          add([x, columnHalf, 0.34], [0.34, columnHalf, 0.07], paint);
          addOriented(
            [x + inward * 0.42, columnHalf * 0.55, 0],
            [0, 0, inward * 0.48],
            [0.08, columnHalf * 0.62, 0.08],
            paint,
          );
          add([x, this.baseY - 0.22, 0], [0.52, 0.16, halfDepth + 0.18], toolSteel);
          add([x, this.baseY - 0.02, 0], [0.38, 0.05, halfDepth * 0.55], polished);
          add([x, this.baseY + 0.08, -halfDepth * 0.4], [0.08, 0.06, 0.08], polished);
          add([x, this.baseY + 0.08, halfDepth * 0.4], [0.08, 0.06, 0.08], polished);
          add([x, 0.32, -0.55], [0.55, 0.04, 0.05], safety);
        } else {
          add([x, this.baseY - 0.55, 0], [boundary === 'end-clamped' ? 0.58 : 0.72, 0.55, halfDepth + 0.32], steel);
          add([x, this.baseY * 0.48, 0], [0.36, this.baseY * 0.48, 0.36], darkSteel);
        }
      }
    } else {
      const exhaustive: never = boundary;
      void exhaustive;
    }

    const pressBlendRaw = clamp((this.loadProgress - 0.04) / 0.34, 0, 1);
    const pressBlend = pressBlendRaw * pressBlendRaw * (3 - 2 * pressBlendRaw);
    const fixturePoint = (normalized: readonly [number, number]): Vec3 => (
      this.blendPoints(this.restPoint(normalized), this.currentPoint(normalized), pressBlend)
    );
    const strike = fixturePoint(recipe.strikeCenter);
    const mirror: readonly [number, number] = [
      clamp(recipe.loadCenter[0] * 2 - recipe.strikeCenter[0], 0.02, 0.98),
      clamp(recipe.loadCenter[1] * 2 - recipe.strikeCenter[1], 0.02, 0.98),
    ];
    const loadPoints = recipe.loadPattern === 'dual' ? [strike, fixturePoint(mirror)] : [fixturePoint(recipe.loadCenter)];
    const sign = recipe.loadSign ?? -1;
    const stationHalf = recipe.loadPattern === 'line'
      ? Math.max(0.34, this.span * recipe.loadRadius[0] * 0.44)
      : recipe.loadPattern === 'distributed' || recipe.fixtureStyle === 'blast'
        ? Math.max(1.2, this.span * recipe.loadRadius[0] * 0.42)
        : Math.max(0.48, this.span * recipe.loadRadius[0] * 0.30);
    const laneHalf = recipe.loadPattern === 'line'
      ? Math.max(0.72, this.depth * 0.46)
      : Math.max(0.48, this.depth * recipe.loadRadius[1] * 0.30);
    const toolOffset = (-sign) * (2.45 * (1 - pressBlend) + 0.42);

    const skinHydraulicPunch = (point: Vec3): void => {
      const radius = Math.max(this.indenterRadius, 0.26);
      if (this.verticalRig) {
        add([point[0], point[1], point[2] + toolOffset], [radius * 1.12, radius * 1.12, radius * 0.36], toolSteel);
        add([point[0], point[1], point[2] + toolOffset + 0.72], [radius * 0.55, radius * 0.55, 0.62], steel);
        add([point[0], point[1], point[2] + toolOffset + 1.42], [radius * 1.45, radius * 1.45, 0.14], paint);
        return;
      }
      const punchY = point[1] + toolOffset;
      addVerticalShell([point[0], punchY, point[2]], radius * 1.08, 0.22, toolSteel, 12);
      addVerticalShell([point[0], punchY - 0.14, point[2]], radius * 0.78, 0.08, polished, 10);
      addVerticalShell([point[0], punchY + 0.78, point[2]], radius * 0.52, 0.58, steel, 10);
      add([point[0], punchY + 1.42, point[2]], [radius * 0.82, 0.10, radius * 0.82], paint);
      add([point[0], punchY + 1.72, point[2]], [radius * 1.55, 0.14, radius * 1.55], paint);
      for (const dx of [-radius * 1.15, radius * 1.15]) {
        for (const dz of [-radius * 1.15, radius * 1.15]) {
          add([point[0] + dx, punchY + 1.88, point[2] + dz], [0.08, 0.06, 0.08], polished);
        }
      }
    };

    const skinPressBrake = (point: Vec3): void => {
      const punchY = point[1] + toolOffset;
      const bladeR = Math.max(this.indenterRadius, 0.14);
      const bladeHalfZ = Math.max(0.72, halfDepth * 0.48);
      addZShell([point[0], punchY, point[2]], bladeR, bladeHalfZ, toolSteel, 10);
      add([point[0], punchY + bladeR + 0.28, point[2]], [0.12, 0.34, bladeHalfZ], toolSteel);
      add([point[0], punchY + 0.92, point[2]], [0.72, 0.32, halfDepth + 0.42], paint);
      add([point[0], punchY + 1.28, point[2]], [0.18, 0.12, halfDepth + 0.32], steel);
      add([point[0], punchY + 0.92, point[2] - bladeHalfZ * 0.72], [0.76, 0.07, 0.09], safety);
      add([point[0], punchY + 0.92, point[2] + bladeHalfZ * 0.72], [0.76, 0.07, 0.09], safety);
      const dieY = this.baseY - 0.58;
      const opening = Math.max(0.62, bladeR * 3.6);
      add([point[0] - opening * 0.58, dieY + 0.10, point[2]], [0.48, 0.18, bladeHalfZ + 0.14], toolSteel);
      add([point[0] + opening * 0.58, dieY + 0.10, point[2]], [0.48, 0.18, bladeHalfZ + 0.14], toolSteel);
      addOriented(
        [point[0] - opening * 0.28, dieY + 0.18, point[2]],
        [0, 0, 0.46],
        [0.07, 0.32, bladeHalfZ + 0.10],
        polished,
      );
      addOriented(
        [point[0] + opening * 0.28, dieY + 0.18, point[2]],
        [0, 0, -0.46],
        [0.07, 0.32, bladeHalfZ + 0.10],
        polished,
      );
      addZShell([point[0], dieY - 0.02, point[2]], 0.16, bladeHalfZ + 0.10, polished, 8);
      add([point[0], dieY - 0.38, point[2]], [opening + 0.62, 0.30, bladeHalfZ + 0.20], paint);
      add([point[0], dieY - 0.74, point[2]], [opening + 0.92, 0.14, bladeHalfZ + 0.24], paint);
      for (const x of [-halfSpan - 1.35, halfSpan + 1.35]) {
        const inward = x >= 0 ? -1 : 1;
        add([x, this.baseY * 0.52, 0], [0.48, this.baseY * 0.52, 1.05], paint);
        add([x, this.baseY + 1.15, 0], [0.42, 0.55, 0.85], steel);
        add([x, 0.22, 0], [0.72, 0.16, 1.15], paint);
        addOriented(
          [x + inward * 0.55, this.baseY * 0.28, -0.55],
          [0, 0, inward * 0.55],
          [0.10, 1.15, 0.10],
          paint,
        );
      }
    };

    switch (recipe.fixtureStyle) {
      case 'blast': {
        const point = this.currentPoint(recipe.loadCenter);
        if (this.verticalRig) add([point[0], point[1], point[2] + 2.1], [stationHalf, laneHalf, 0.12], [0.10, 0.14, 0.18, 1]);
        else add([point[0], point[1] + 2.1, point[2]], [stationHalf, 0.12, laneHalf], [0.10, 0.14, 0.18, 1]);
        break;
      }
      case 'press':
      case 'ram':
        if (!recipe.notch) {
          for (const point of loadPoints) skinHydraulicPunch(point);
        }
        break;
      case 'rollers':
        if (!this.verticalRig) skinPressBrake(loadPoints[0]);
        else if (!recipe.notch) {
          for (const point of loadPoints) {
            add([point[0], point[1], point[2] + toolOffset], [stationHalf, laneHalf, 0.28], toolSteel);
          }
        }
        break;
      case 'drop':
        if (!recipe.notch) {
          for (const point of loadPoints) {
            if (this.verticalRig) add([point[0], point[1], point[2] + toolOffset], [stationHalf, laneHalf, 0.48], toolSteel);
            else add([point[0], point[1] + toolOffset, point[2]], [stationHalf, 0.48, laneHalf], toolSteel);
          }
        }
        if (this.verticalRig) {
          add([strike[0] - 0.9, strike[1], 1.4], [0.08, halfDepth * 0.72, 0.08], darkSteel);
          add([strike[0] + 0.9, strike[1], 1.4], [0.08, halfDepth * 0.72, 0.08], darkSteel);
        } else {
          add([strike[0] - 0.9, this.baseY + 1.5, strike[2]], [0.08, 1.6, 0.08], darkSteel);
          add([strike[0] + 0.9, this.baseY + 1.5, strike[2]], [0.08, 1.6, 0.08], darkSteel);
        }
        break;
      case 'fatigue': {
        const pulse = 0.18 + 0.10 * Math.sin(this.time * 3.4);
        add([-halfSpan - 0.74, this.baseY, this.verticalRig ? pulse : 0], [0.54, this.verticalRig ? halfDepth * 0.68 : 0.72, this.verticalRig ? 0.42 : halfDepth * 0.62], paint);
        add([halfSpan + 0.74, this.baseY, this.verticalRig ? -pulse : 0], [0.54, this.verticalRig ? halfDepth * 0.68 : 0.72, this.verticalRig ? 0.42 : halfDepth * 0.62], paint);
        break;
      }
      case 'facade':
      case 'reaction-frame':
        break;
      default: {
        const exhaustive: never = recipe.fixtureStyle;
        void exhaustive;
        break;
      }
    }

    if (recipe.id === 'metal-square-punch-forming') {
      const platenPoint = loadPoints[0];
      const movingPlatenTopY = platenPoint[1] + toolOffset + 0.28;
      const barrelBottomY = 9.50;
      const rawHalfHeight = (barrelBottomY - movingPlatenTopY) * 0.5;
      // This narrow render-only sleeve telescopes out of the fixed stage
      // barrel as the solver-driven platen descends. The minimum overlap hides
      // the seam at the home position and guarantees a positive finite cube.
      const halfHeight = Number.isFinite(rawHalfHeight) ? Math.max(0.025, rawHalfHeight) : 0.025;
      addVerticalShell(
        [platenPoint[0], barrelBottomY - halfHeight, platenPoint[2]],
        0.62,
        halfHeight,
        steel,
        10,
      );
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
    } else if (this.compositeRig) {
      const steel: readonly [number, number, number, number] = [0.44, 0.48, 0.52, -2];
      const brightSteel: readonly [number, number, number, number] = [0.66, 0.70, 0.72, -2];
      const darkSteel: readonly [number, number, number, number] = [0.08, 0.095, 0.11, 1];
      const sensor: readonly [number, number, number, number] = [0.16, 0.30, 0.55, -2];
      const fixedX = -this.span * 0.5;
      // A grounded twin-plate clamp makes the cantilever boundary and load
      // path legible without adding bodies to the reduced-order solve.
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 0.4, 0.34, 0], 3.0, 0.34, this.depth * 0.86);
      setColor(this.colors, instanceCount++, [0.18, 0.19, 0.20, -5]);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 1.15, 3.65, 0], 0.46, 3.25, this.depth * 0.72);
      setColor(this.colors, instanceCount++, darkSteel);
      // Rear plate, toe blocks, and diagonal gussets turn the former monolithic
      // pedestal into a recognizable bolted cantilever fixture. They remain
      // render witnesses only; the first two lattice stations own the actual
      // boundary condition.
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 1.78, 3.65, 0], 0.16, 3.10, this.depth * 0.80);
      setColor(this.colors, instanceCount++, steel);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 2.30, 0.78, -this.depth * 0.62], 1.18, 0.18, 0.24);
      setColor(this.colors, instanceCount++, darkSteel);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 2.30, 0.78, this.depth * 0.62], 1.18, 0.18, 0.24);
      setColor(this.colors, instanceCount++, darkSteel);
      for (const z of [-this.depth * 0.58, this.depth * 0.58]) {
        writeModelMatrixFromEuler(
          this.matrices,
          instanceCount * 16,
          [fixedX - 1.72, 2.22, z],
          [0, 0, -0.50],
          [0.14, 1.78, 0.14],
        );
        setColor(this.colors, instanceCount++, darkSteel);
      }
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX - 0.56, this.baseY + 0.58, 0], 0.38, 1.10, this.depth * 0.68);
      setColor(this.colors, instanceCount++, steel);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX + 0.12, this.baseY + 0.48, 0], 0.34, 0.34, this.depth * 0.62);
      setColor(this.colors, instanceCount++, steel);
      writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX + 0.12, this.baseY - 0.42, 0], 0.34, 0.34, this.depth * 0.62);
      setColor(this.colors, instanceCount++, steel);
      // Six visible clamp bolts establish scale and make the load path easy to
      // read from the Field workspace camera.
      for (const y of [this.baseY - 0.88, this.baseY, this.baseY + 0.88]) {
        for (const z of [-this.depth * 0.54, this.depth * 0.54]) {
          writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [fixedX + 0.48, y, z], 0.11, 0.11, 0.11);
          setColor(this.colors, instanceCount++, brightSteel);
        }
      }
      // Five presentation markers follow actual lattice nodes, so they remain
      // visually attached without claiming independent hardware channels.
      const tapStations = [8, 18, 24, 30, 36] as const;
      const tapLane = Math.floor(this.lanes * 0.5);
      for (const station of tapStations) {
        const nodeOffset = this.node(Math.min(this.stations - 2, station), tapLane) * 3;
        const x = this.positions[nodeOffset];
        const y = this.positions[nodeOffset + 1];
        const z = this.positions[nodeOffset + 2];
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, y + 0.20, z], 0.16, 0.11, 0.16);
        setColor(this.colors, instanceCount++, steel);
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, y + 0.32, z], 0.035, 0.10, 0.035);
        setColor(this.colors, instanceCount++, darkSteel);
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, y + 0.44, z], 0.085, 0.055, 0.085);
        setColor(this.colors, instanceCount++, sensor);
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, y + 0.505, z], 0.045, 0.018, 0.045);
        setColor(this.colors, instanceCount++, brightSteel);
        writeAxisAlignedModelMatrix(this.matrices, instanceCount * 16, [x, y + 0.44, z - 0.18], 0.022, 0.022, 0.16);
        setColor(this.colors, instanceCount++, darkSteel);
      }
      const tipOffset = this.node(this.stations - 2, tapLane) * 3;
      writeAxisAlignedModelMatrix(
        this.matrices,
        instanceCount * 16,
        [this.positions[tipOffset], this.positions[tipOffset + 1] + 0.15, this.positions[tipOffset + 2]],
        0.22,
        0.07,
        0.22,
      );
      setColor(this.colors, instanceCount++, [0.76, 0.55, 0.08, -2]);
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
    this.frame.surface = this.writeSheetSkin();
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
    hash = quantizedHash(this.hingeRest, hash);
    hash = quantizedHash(this.damage, hash);
    hash = quantizedHash(this.cellDamage, hash);
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
