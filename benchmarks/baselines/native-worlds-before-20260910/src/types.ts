import type { Mat4, Vec3 } from './math';
import type { ScenePreset } from './scenes';

export type InstanceBufferSource = {
  readonly HEAPF32: Float32Array;
  /** Monotonically increasing version of the transform stream. */
  frameVersion(): number;
  /** Monotonically increasing version of the material/color stream. */
  colorVersion(): number;
  _b3w_matrices_ptr(): number | bigint;
  _b3w_colors_ptr(): number | bigint;
  _b3w_body_count(): number;
  _b3w_max_bodies(): number;
};

export type PhysicsBackend = InstanceBufferSource & {
  readonly name: string;
  readonly isWasm: boolean;
  readonly maxBodies: number;
  createScene(scene: ScenePreset, stressScale: number, seed: number): number;
  step(dt: number, subSteps: number): void;
  syncTransforms(): void;
  kick(strength: number): void;
  explode(centerX: number, centerY: number, centerZ: number, strength: number, radius: number): void;
  launchProjectile(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): number;
  spawnRain(count: number, spread: number, height: number): number;
  bodyCount(): number;
  dynamicCount(): number;
  replayHash(): number;
  destroy(): void;
};


/** CPU fallback: position3/f32, normal2/snorm16, color4/unorm8, uv2/unorm16. */
export type PackedSurfaceFrame = {
  path: 'packed';
  /** Water is always represented by GpuWaterSurfaceFrame. Packed surfaces cover
   * topology-changing cloth and interpolated metal/sheet skins whose solver
   * remains a reduced-order lattice. */
  material: 'cloth' | 'sheet';
  vertices: Uint8Array;
  indices: Uint16Array;
  vertexStride: number;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
};

/** Intact cloth stays in solver-native arrays; WebGPU reconstructs its render surface. */
export type GpuClothSurfaceFrame = {
  path: 'gpu-cloth';
  material: 'cloth';
  positions: Float32Array;
  /** Immutable rest-pose positions. WebGPU can derive visual strain from the
   * current/rest distance field instead of requiring a per-frame CPU stream. */
  restPositions: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
  cols: number;
  rows: number;
  baseColorA: readonly [number, number, number, number];
  baseColorB: readonly [number, number, number, number];
};

/** GPU-resident line-member render stream. Dynamic node positions are paired
 * with compact segment metadata; a renderer can expand this into shared
 * instance matrices and materials without rebuilding every member on CPU. */
export type GpuSegmentGridFrame = {
  presentation: 'rope' | 'material';
  positions: Float32Array;
  /** Eight float32 words per active render segment:
   * [nodeA, nodeB, inverseRestLength, radius, colorR, colorG, colorB, colorA]. */
  segments: Float32Array;
  nodeCount: number;
  segmentCount: number;
  topologyVersion: number;
  frameVersion: number;
};

/** Backward-compatible name retained for the original cable path. */
export type RopeGridFrame = GpuSegmentGridFrame;

/** Comparative, normalized material-failure telemetry. These values describe
 * the deterministic lattice model; they are not certified engineering data. */
export type MaterialFailureTelemetry = {
  label: string;
  testMode: string;
  loadTarget: number;
  loadProgress: number;
  maxStrain: number;
  yieldStrain: number;
  breakStrain: number;
  yieldedCount: number;
  damagedCount: number;
  peakDamage: number;
  /** Current centerline displacement below the undeformed specimen plane. */
  centerDeflection: number;
  /** Signed normalized response at the active solver probe, when available. */
  probeResponse?: number;
  /** Largest centerline displacement observed during this run. */
  peakDeflection: number;
  /** Current unloaded centerline displacement retained after springback. */
  residualDent: number;
  /** Cohesive surface cells that have separated during this run. */
  fracturedCellCount: number;
  /** Live concrete-spall or glass-shard presentation bodies. */
  fragmentCount: number;
  /** Intact reinforcement members still bridging a concrete failure zone. */
  reinforcementCount: number;
  /**
   * Normalized membrane + hinge strain-energy proxy for the live lattice. Not joules.
   * Omitted by solvers that do not partition energy.
   */
  elasticEnergy?: number;
  /** Accumulated rest-length / hinge-angle plastic drift proxy. Not joules. */
  plasticWork?: number;
  /** Accumulated Verlet damping dissipation proxy. Not joules. */
  dampingWork?: number;
  /** Accumulated contact-gap work proxy. Not joules. */
  contactWork?: number;
  failurePhase: 'elastic' | 'yielding' | 'fracturing' | 'failed';
};

/** Shallow-water state stays as eta/u/v fields; WebGPU reconstructs geometry and foam. */
export type GpuWaterSurfaceFrame = {
  path: 'gpu-water';
  material: 'water';
  eta: Float32Array;
  u: Float32Array;
  v: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
  topologyVersion: number;
  frameVersion: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  baseY: number;
};

export type DynamicSurfaceFrame = PackedSurfaceFrame | GpuClothSurfaceFrame | GpuWaterSurfaceFrame;

export type DebugLine = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

export type CameraRig = {
  yaw: number;
  pitch: number;
  distance: number;
  target: Vec3;
};

export type FrameMetrics = {
  fps: number;
  simMs: number;
  renderSubmitMs: number;
  uploadMb: number;
  steps: number;
  hash: number;
};

export type RenderQualityId = 'performance' | 'balanced' | 'cinematic' | 'ultra';

export type RenderQuality = {
  id: RenderQualityId;
  label: string;
  exposure: number;
  bloomStrength: number;
  fogDensity: number;
  shadowStrength: number;
  effectBudget: number;
  resolutionScale: number;
  /** WebGPU core guarantees 1x; this renderer also validates the optional 4x path. */
  sampleCount: 1 | 4;
  shadowMapSize: 1024 | 2048;
  shadowTapCount: 1 | 9;
};

export type SceneUniformState = {
  viewProjection: Mat4;
  lightViewProjection: Mat4;
  cameraPosition: Vec3;
  timeSeconds: number;
  lightDirection: Vec3;
  quality: RenderQuality;
  fogColor: Vec3;
  /** Indoor warehouse / shop-floor IBL used by the engineering workspaces. */
  studioMode?: boolean;
};

export type EffectFrame = {
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
  frameVersion: number;
  debugLines: readonly DebugLine[];
};

export type RendererFrameResult = {
  uploadedBytes: number;
  renderSubmitMs: number;
};

/** Product shells from `public/concepts/*.png`. */
export const CONCEPT_PRODUCT_IDS = ['material-lab', 'physics-workbench'] as const;
export type ConceptProductId = (typeof CONCEPT_PRODUCT_IDS)[number];

/**
 * Named concept workspaces. `material-lab` is the LAB/COMPARE/CAPTURES shell;
 * the remaining ids are Physics Testing Workbench surfaces (structural, correlation, field).
 */
export const CONCEPT_WORKSPACE_IDS = [
  'material-lab',
  'structural-test',
  'correlation-review',
  'field-modal',
] as const;
export type ConceptWorkspaceId = (typeof CONCEPT_WORKSPACE_IDS)[number];

export const CONCEPT_LAYOUT_MODES = ['desktop', 'mobile'] as const;
export type ConceptLayoutMode = (typeof CONCEPT_LAYOUT_MODES)[number];

/** Live HTML `data-workbench-tab` / engineering-shell surface ids. */
export const PHYSICS_WORKBENCH_SURFACE_IDS = ['test', 'correlation', 'field'] as const;
export type PhysicsWorkbenchSurfaceId = (typeof PHYSICS_WORKBENCH_SURFACE_IDS)[number];

/** Matches the existing `#app` inspector-drawer mobile breakpoint. */
export const CONCEPT_MOBILE_LAYOUT_MAX_PX = 760;

export const CONCEPT_WORKSPACE_PRODUCT = {
  'material-lab': 'material-lab',
  'structural-test': 'physics-workbench',
  'correlation-review': 'physics-workbench',
  'field-modal': 'physics-workbench',
} as const satisfies Record<ConceptWorkspaceId, ConceptProductId>;

export const CONCEPT_WORKSPACE_PREFERRED_LAYOUT = {
  'material-lab': 'desktop',
  'structural-test': 'desktop',
  'correlation-review': 'desktop',
  'field-modal': 'mobile',
} as const satisfies Record<ConceptWorkspaceId, ConceptLayoutMode>;

export const PHYSICS_SURFACE_TO_CONCEPT_WORKSPACE = {
  test: 'structural-test',
  correlation: 'correlation-review',
  field: 'field-modal',
} as const satisfies Record<PhysicsWorkbenchSurfaceId, ConceptWorkspaceId>;

export const CONCEPT_WORKSPACE_TO_PHYSICS_SURFACE = {
  'material-lab': 'test',
  'structural-test': 'test',
  'correlation-review': 'correlation',
  'field-modal': 'field',
} as const satisfies Record<ConceptWorkspaceId, PhysicsWorkbenchSurfaceId>;

export type ConceptWorkspaceLayoutRef = {
  readonly [K in ConceptWorkspaceId]: {
    readonly workspace: K;
    readonly layout: ConceptLayoutMode;
    readonly product: (typeof CONCEPT_WORKSPACE_PRODUCT)[K];
  };
}[ConceptWorkspaceId];

export type LabDemoRef = {
  readonly kind: 'lab';
  readonly labId: string;
  readonly materialDemoId?: never;
  readonly sceneId?: never;
};

export type MaterialDemoRef = {
  readonly kind: 'material-demo';
  readonly materialDemoId: string;
  readonly labId?: never;
  readonly sceneId?: never;
};

export type SceneDemoRef = {
  readonly kind: 'scene';
  readonly sceneId: number;
  readonly labId?: never;
  readonly materialDemoId?: never;
};

export type DemoRef = LabDemoRef | MaterialDemoRef | SceneDemoRef;

/** Demo identity plus the concept workspace it should open. Switch on `kind` and `workspace`. */
export type DemoWorkspaceMapping = DemoRef & ConceptWorkspaceLayoutRef;

export type ConceptWorkspaceDemoDefaults = {
  readonly [K in ConceptWorkspaceId]: DemoWorkspaceMapping & { readonly workspace: K };
};

export const CONCEPT_WORKSPACE_DEFAULT_DEMOS: ConceptWorkspaceDemoDefaults = {
  'material-lab': {
    kind: 'lab',
    labId: 'titan-bend-dent',
    workspace: 'material-lab',
    layout: 'desktop',
    product: 'material-lab',
  },
  'structural-test': {
    kind: 'lab',
    labId: 'titan-bend-dent',
    workspace: 'structural-test',
    layout: 'desktop',
    product: 'physics-workbench',
  },
  'correlation-review': {
    kind: 'lab',
    labId: 'crash-rail-axial-fold',
    workspace: 'correlation-review',
    layout: 'desktop',
    product: 'physics-workbench',
  },
  'field-modal': {
    kind: 'lab',
    labId: 'composite-coupon',
    workspace: 'field-modal',
    layout: 'mobile',
    product: 'physics-workbench',
  },
};

export const FLAGSHIP_DEMO_WORKSPACE_MAPPINGS = [
  {
    kind: 'material-demo',
    materialDemoId: 'metal-square-punch-forming',
    workspace: 'material-lab',
    layout: 'desktop',
    product: 'material-lab',
  },
  {
    kind: 'material-demo',
    materialDemoId: 'metal-square-punch-forming',
    workspace: 'structural-test',
    layout: 'desktop',
    product: 'physics-workbench',
  },
  {
    kind: 'material-demo',
    materialDemoId: 'metal-four-point-bumper-beam',
    workspace: 'correlation-review',
    layout: 'desktop',
    product: 'physics-workbench',
  },
  {
    kind: 'scene',
    sceneId: 799,
    workspace: 'field-modal',
    layout: 'mobile',
    product: 'physics-workbench',
  },
] as const satisfies readonly DemoWorkspaceMapping[];

export const CONCEPT_REGION_IDS = [
  'topbar',
  'library',
  'viewport',
  'inspector',
  'console',
  'drawer',
  'transport',
  'charts',
  'timeline',
  'gizmo',
  'scale-bar',
  'legend',
  'channel-legend',
  'overlay-host',
  'viewport-tools',
  'capture-strip',
  'field-nav',
  'correlation-reference',
  'correlation-simulation',
  'specimen-status',
  'engineering-mount',
  'compare',
  'captures',
] as const;
export type ConceptRegionId = (typeof CONCEPT_REGION_IDS)[number];

export const ENGINEERING_WORKSPACES_MOUNT_ID = 'engineering-workspaces-mount';
export const CONCEPT_LAYOUT_ROOTS_ID = 'concept-layout-roots';

/**
 * Live `#app` is the structural-test chrome (desktop and mobile via CSS).
 * Other concept layouts have dedicated hidden roots for agents to fill.
 */
export const CONCEPT_LAYOUT_ROOT_IDS = {
  'material-lab': { desktop: 'material-lab-desktop', mobile: 'material-lab-mobile' },
  'structural-test': { desktop: 'app', mobile: 'app' },
  'correlation-review': { desktop: 'correlation-review-desktop', mobile: 'correlation-review-mobile' },
  'field-modal': { desktop: 'field-modal-desktop', mobile: 'field-modal-mobile' },
} as const satisfies Record<ConceptWorkspaceId, Record<ConceptLayoutMode, string>>;

export type ConceptLayoutRootId =
  (typeof CONCEPT_LAYOUT_ROOT_IDS)[ConceptWorkspaceId][ConceptLayoutMode];

export const CONCEPT_VIEWPORT_SLOT_IDS = {
  gizmo: 'viewport-gizmo',
  scaleBar: 'viewport-scale-bar',
  channelLegend: 'viewport-channel-legend',
  overlayHost: 'viewport-overlay-host',
} as const;

export type ConceptDataset = {
  readonly conceptProduct: ConceptProductId;
  readonly conceptWorkspace: ConceptWorkspaceId;
  readonly conceptLayout: ConceptLayoutMode;
};

/** Whether a demo, lab, or recipe starts when its workspace opens. */
export const DEMO_AUTOPLAY_MODES = ['off', 'on-open'] as const;
export type DemoAutoplayMode = (typeof DEMO_AUTOPLAY_MODES)[number];

/**
 * Shared one-click transport/force ids. Material Lab uses play/pause/reset/apply-force;
 * Structural Test uses run (no hidden Arm) plus pause/reset.
 */
export const IMMEDIATE_ACTION_IDS = ['play', 'pause', 'reset', 'apply-force', 'run'] as const;
export type ImmediateActionId = (typeof IMMEDIATE_ACTION_IDS)[number];

/** Immediate actions autoplay may fire after the sim is ready. Pause and reset stay user-driven. */
export const DEMO_AUTOPLAY_ACTION_IDS = ['play', 'apply-force', 'run'] as const satisfies readonly ImmediateActionId[];
export type DemoAutoplayActionId = (typeof DEMO_AUTOPLAY_ACTION_IDS)[number];

/** Ordered first-run overlay steps. Switch on the id; UI copy lives with the guide. */
export const FIRST_RUN_GUIDE_STEPS = [
  'pick-specimen',
  'watch-or-play',
  'orbit-or-force',
] as const;
export type FirstRunGuideStep = (typeof FIRST_RUN_GUIDE_STEPS)[number];

