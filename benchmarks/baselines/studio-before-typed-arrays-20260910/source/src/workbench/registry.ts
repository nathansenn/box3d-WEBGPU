import {
  getMaterialDemoRecipe,
  MATERIAL_DEMO_RECIPES,
  MATERIAL_LAB_FEATURED_IDS,
  MATERIAL_LAB_GROUPS,
  type MaterialDemoRecipe,
  type MaterialLabGroup,
} from '../material-demos';
import { SCENES } from '../scenes';
import type { ConceptLayoutMode, ConceptWorkspaceId } from '../types';
import {
  WORKBENCH_GROUP_LABELS,
  WORKBENCH_SOLVER_LABELS,
  conceptWorkspaceIdFromKind,
  type WorkbenchGroup,
  type WorkbenchLabDefinition,
  type WorkbenchLabFilter,
  type WorkbenchLiveParameter,
  type WorkspaceKind,
} from './schema';

export * from './schema';
export { MATERIAL_LAB_FEATURED_IDS };

/**
 * Concept mockups the UI routes labs into. `WorkbenchLabDefinition` has no
 * workspace field, so this catalog is the schema-compatible extension point.
 */
export const WORKBENCH_CONCEPT_VIEW_IDS = [
  'material-lab-desktop',
  'material-lab-mobile',
  'structural-test',
  'correlation-review',
  'field-modal',
] as const;

export type WorkbenchConceptViewId = (typeof WORKBENCH_CONCEPT_VIEW_IDS)[number];

/** Live shell ids from `index.html` / `engineering-workspaces.ts`. */
export const WORKBENCH_UI_WORKSPACE_IDS = ['test', 'correlation', 'field'] as const;
export type WorkbenchUiWorkspaceId = (typeof WORKBENCH_UI_WORKSPACE_IDS)[number];

export const MATERIAL_LAB_CATALOG_FILTERS = ['all', ...MATERIAL_LAB_GROUPS] as const;
export type MaterialLabCatalogFilter = (typeof MATERIAL_LAB_CATALOG_FILTERS)[number];

export type WorkbenchConceptPanel = {
  readonly id: string;
  readonly title: string;
};

export type WorkbenchConceptLayout = 'desktop' | 'mobile' | 'portrait-tablet';

export type WorkbenchConceptViewDefinition = {
  readonly id: WorkbenchConceptViewId;
  readonly title: string;
  readonly shortName: string;
  readonly uiWorkspaceId: WorkbenchUiWorkspaceId;
  readonly conceptImage: string;
  readonly layout: WorkbenchConceptLayout;
  readonly qaViewport: { readonly width: number; readonly height: number } | null;
  readonly defaultLabId: string;
  readonly defaultMaterialDemoId?: string;
  readonly libraryMode: 'experiment' | 'labs' | 'none';
  readonly tabs: readonly string[];
  readonly panels: readonly WorkbenchConceptPanel[];
};

export type WorkbenchLabCapabilities = {
  readonly structuralTest: true;
  readonly correlation: boolean;
  readonly pointForce: boolean;
  readonly loadControl: boolean;
  readonly renderCheckpointHz: 10 | 30;
  readonly modalAnalysis: 'none' | 'analysis-only-cantilever';
  readonly materialLab: true;
};

/** Open-on-entry command for UI / `main.ts`. Schema lab records stay unchanged. */
export const WORKBENCH_DEFAULT_ACTIONS = ['play', 'apply-force', 'run'] as const;
export type WorkbenchDefaultAction = (typeof WORKBENCH_DEFAULT_ACTIONS)[number];

export type WorkbenchLabAutoplay = {
  readonly autoPlay: true;
  readonly defaultAction: WorkbenchDefaultAction;
};

export type WorkbenchLabConceptBinding = {
  readonly labId: string;
  readonly primaryViewId: WorkbenchConceptViewId;
  readonly viewIds: readonly WorkbenchConceptViewId[];
  readonly uiWorkspaceId: WorkbenchUiWorkspaceId;
  readonly conceptImage: string;
  readonly catalogFilters: readonly MaterialLabCatalogFilter[];
  readonly capabilities: WorkbenchLabCapabilities;
  readonly autoPlay: true;
  readonly defaultAction: WorkbenchDefaultAction;
};

export type WorkbenchMaterialDemoConceptBinding = {
  readonly materialDemoId: string;
  readonly labId: string | null;
  readonly title: string;
  readonly specimen: string;
  readonly labGroup: MaterialLabGroup;
  readonly librarySlot: number;
  readonly primaryViewId: WorkbenchConceptViewId;
  readonly viewIds: readonly WorkbenchConceptViewId[];
  readonly conceptImage: string;
};

/** Mockup rows 05–07 are workbench labs outside the 31 material-demo library slots. */
export const MATERIAL_LAB_CROSS_CATALOG = [
  {
    mockupRow: 5, title: 'Cloth Tear', specimen: 'Ballistic Fabric',
    labId: 'progressive-fabric-tear', filter: 'cloth',
  },
  {
    mockupRow: 6, title: 'Fluid Dam-Break', specimen: 'Water',
    labId: 'dam-breach-front', filter: 'fluid',
  },
  {
    mockupRow: 7, title: 'Soft-Body Crush', specimen: 'Foam Block',
    labId: 'elastomer-recovery', filter: 'soft-body',
  },
] as const satisfies readonly {
  mockupRow: number;
  title: string;
  specimen: string;
  labId: string;
  filter: MaterialLabGroup;
}[];

const panel = (id: string, title: string): WorkbenchConceptPanel => Object.freeze({ id, title });

const MATERIAL_LAB_TABS = ['lab', 'compare', 'captures'] as const;
const MATERIAL_LAB_PANELS = [
  panel('library-panel', '35 Simulations'),
  panel('lab-browser', 'Catalog'),
  panel('viewport', 'Specimen viewport'),
  panel('inspector-panel-force', 'Force'),
  panel('inspector-panel-material', 'Material'),
  panel('inspector-panel-solver', 'Solver'),
  panel('transport-panel', 'Playback'),
  panel('chart-force', 'Force'),
  panel('chart-energy', 'Energy'),
  panel('chart-stress', 'Max response'),
] as const;

export const WORKBENCH_CONCEPT_VIEWS = [
  {
    id: 'material-lab-desktop',
    title: 'Material Lab',
    shortName: 'Lab',
    uiWorkspaceId: 'test',
    conceptImage: 'public/concepts/material-lab-desktop.png',
    layout: 'desktop',
    qaViewport: null,
    defaultLabId: 'titan-bend-dent',
    defaultMaterialDemoId: 'metal-square-punch-forming',
    libraryMode: 'labs',
    tabs: MATERIAL_LAB_TABS,
    panels: MATERIAL_LAB_PANELS,
  },
  {
    id: 'material-lab-mobile',
    title: 'Material Lab',
    shortName: 'Lab',
    uiWorkspaceId: 'test',
    conceptImage: 'public/concepts/material-lab-mobile.png',
    layout: 'mobile',
    qaViewport: null,
    defaultLabId: 'titan-bend-dent',
    defaultMaterialDemoId: 'metal-square-punch-forming',
    libraryMode: 'labs',
    tabs: MATERIAL_LAB_TABS,
    panels: [
      panel('viewport', 'Specimen viewport'),
      panel('force-tool', 'Orbit / Apply force'),
      panel('inspector-panel-force', 'Force'),
      panel('inspector-panel-material', 'Material'),
      panel('inspector-panel-solver', 'Solver'),
      panel('force-apply', 'Apply force'),
      panel('transport-panel', 'Playback'),
      panel('capture', 'Capture'),
    ],
  },
  {
    id: 'structural-test',
    title: 'Structural Test',
    shortName: 'Test',
    uiWorkspaceId: 'test',
    conceptImage: 'public/concepts/physics-workbench-structural-v2.png',
    layout: 'desktop',
    qaViewport: { width: 1672, height: 941 },
    defaultLabId: 'titan-bend-dent',
    libraryMode: 'experiment',
    tabs: ['test', 'correlation', 'field'],
    panels: [
      panel('experiment-navigator', 'Experiment tree'),
      panel('instrument-panel', 'Sensor channels'),
      panel('revision-panel', 'Revision history'),
      panel('viewport', 'Specimen viewport'),
      panel('inspector-panel-force', 'Load Case'),
      panel('inspector-panel-material', 'Material'),
      panel('inspector-panel-solver', 'Solver'),
      panel('inspector-panel-assembly', 'Assembly'),
      panel('timeline', 'Timeline'),
      panel('chart-force-displacement', 'Force / displacement'),
      panel('chart-energy', 'Strain energy'),
      panel('transport-panel', 'Run transport'),
      panel('simulation-limit-card', 'Simulation limits'),
    ],
  },
  {
    id: 'correlation-review',
    title: 'Correlation Review',
    shortName: 'Correlation',
    uiWorkspaceId: 'correlation',
    conceptImage: 'public/concepts/physics-workbench-correlation-v2.png',
    layout: 'desktop',
    qaViewport: { width: 1672, height: 941 },
    defaultLabId: 'crash-rail-axial-fold',
    libraryMode: 'none',
    tabs: ['test', 'correlation', 'field'],
    panels: [
      panel('case-matrix', 'Case matrix'),
      panel('channels', 'Channels'),
      panel('frame-bookmarks', 'Frame bookmarks'),
      panel('checklist', 'Checklist'),
      panel('split-viewport', 'Reference / work'),
      panel('correlation-transport', 'Shared frame transport'),
      panel('chart-correlation-force', 'Response history'),
      panel('chart-correlation-energy', 'Energy proxy'),
      panel('chart-correlation-residual', 'Residual'),
      panel('alignment', 'Alignment'),
      panel('solver', 'Solver'),
      panel('contact-scope', 'Contact scope'),
      panel('model-definition', 'Model definition'),
      panel('uncertainty', 'Uncertainty'),
      panel('comparison-controls', 'Model comparison'),
      panel('evidence-summary', 'Evidence summary'),
    ],
  },
  {
    id: 'field-modal',
    title: 'Field Response',
    shortName: 'Field',
    uiWorkspaceId: 'field',
    conceptImage: 'public/concepts/physics-workbench-field-modal-v2.png',
    layout: 'portrait-tablet',
    qaViewport: { width: 1024, height: 1536 },
    defaultLabId: 'composite-coupon',
    libraryMode: 'none',
    tabs: ['run', 'channels', 'modes', 'notes'],
    panels: [
      panel('field-viewport', 'Cantilever viewport'),
      panel('model-state', 'Model state'),
      panel('acquisition-settings', 'Input / captures'),
      panel('channel-health', 'Derived response taps'),
      panel('preflight-strip', 'Preflight'),
      panel('arm-abort', 'Arm / abort'),
      panel('chart-field-frequency-response', 'Output response spectrum'),
      panel('chart-field-coherence', 'Relative spectral amplitude'),
      panel('capture-strip', 'Event / capture strip'),
      panel('field-nav', 'Run / Channels / Modes / Notes'),
    ],
  },
] as const satisfies readonly WorkbenchConceptViewDefinition[];

export const WORKBENCH_DEFAULT_LAB_BY_UI_WORKSPACE = {
  test: 'titan-bend-dent',
  correlation: 'crash-rail-axial-fold',
  field: 'composite-coupon',
} as const satisfies Readonly<Record<WorkbenchUiWorkspaceId, string>>;

/** Correlation and Field swap to a dedicated specimen; Test restores the prior lab. */
export const WORKBENCH_ISOLATED_LAB_BY_UI_WORKSPACE = {
  test: null,
  correlation: 'crash-rail-axial-fold',
  field: 'composite-coupon',
} as const satisfies Readonly<Record<WorkbenchUiWorkspaceId, string | null>>;

const conceptViewsById = new Map<WorkbenchConceptViewId, WorkbenchConceptViewDefinition>(
  WORKBENCH_CONCEPT_VIEWS.map((view) => [view.id, view]),
);

export function getWorkbenchConceptView(id: string): WorkbenchConceptViewDefinition | null {
  return conceptViewsById.get(id as WorkbenchConceptViewId) ?? null;
}

export function uiWorkspaceForConceptView(viewId: WorkbenchConceptViewId): WorkbenchUiWorkspaceId {
  switch (viewId) {
    case 'material-lab-desktop':
    case 'material-lab-mobile':
    case 'structural-test':
      return 'test';
    case 'correlation-review':
      return 'correlation';
    case 'field-modal':
      return 'field';
    default: {
      const unexpected: never = viewId;
      throw new Error(`Unhandled concept view: ${unexpected}`);
    }
  }
}

export function workspaceKindFromConceptViewId(viewId: WorkbenchConceptViewId): WorkspaceKind {
  switch (viewId) {
    case 'material-lab-desktop':
    case 'material-lab-mobile':
      return 'materialLab';
    case 'structural-test':
      return 'physicsStructural';
    case 'correlation-review':
      return 'physicsCorrelation';
    case 'field-modal':
      return 'physicsFieldModal';
    default: {
      const unexpected: never = viewId;
      throw new Error(`Unhandled concept view: ${unexpected}`);
    }
  }
}

export function conceptViewIdFromWorkspaceKind(
  kind: WorkspaceKind,
  layout: ConceptLayoutMode = 'desktop',
): WorkbenchConceptViewId {
  switch (kind) {
    case 'materialLab':
      return layout === 'mobile' ? 'material-lab-mobile' : 'material-lab-desktop';
    case 'physicsStructural':
      return 'structural-test';
    case 'physicsCorrelation':
      return 'correlation-review';
    case 'physicsFieldModal':
      return 'field-modal';
    default: {
      const unexpected: never = kind;
      throw new Error(`Unhandled workspace kind: ${unexpected}`);
    }
  }
}

export function conceptWorkspaceIdFromConceptViewId(viewId: WorkbenchConceptViewId): ConceptWorkspaceId {
  return conceptWorkspaceIdFromKind(workspaceKindFromConceptViewId(viewId));
}

export function parseConceptViewId(value: string | null | undefined): WorkbenchConceptViewId | null {
  if (!value) return null;
  const token = value.trim();
  if (conceptViewsById.has(token as WorkbenchConceptViewId)) return token as WorkbenchConceptViewId;
  switch (token) {
    case 'material-lab':
    case 'materialLab':
    case 'lab':
      return 'material-lab-desktop';
    case 'structural':
    case 'physicsStructural':
      return 'structural-test';
    case 'correlation':
    case 'physicsCorrelation':
    case 'compare':
      return 'correlation-review';
    case 'field':
    case 'physicsFieldModal':
    case 'modal':
      return 'field-modal';
    default:
      return null;
  }
}

export function conceptViewsForUiWorkspace(workspace: WorkbenchUiWorkspaceId): readonly WorkbenchConceptViewId[] {
  switch (workspace) {
    case 'test':
      return ['structural-test', 'material-lab-desktop', 'material-lab-mobile'];
    case 'correlation':
      return ['correlation-review'];
    case 'field':
      return ['field-modal'];
    default: {
      const unexpected: never = workspace;
      throw new Error(`Unhandled UI workspace: ${unexpected}`);
    }
  }
}

const parameter = (value: WorkbenchLiveParameter): WorkbenchLiveParameter => Object.freeze(value);

const TIME_SCALE = parameter({
  id: 'time-scale', label: 'Simulation speed', min: 0.05, max: 2, step: 0.05,
  defaultValue: 1, unit: '× real time', valueKind: 'continuous', availability: 'wired',
});
const ACTUATOR_TARGET = parameter({
  id: 'actuator-target', label: 'Actuator target', min: 0, max: 2, step: 0.05,
  defaultValue: 0.8, unit: '× reference load', valueKind: 'continuous', availability: 'wired',
});
const MATERIAL_STRIKE_STRENGTH = parameter({
  id: 'material-strike-strength', label: 'Strike strength', min: 0.25, max: 2, step: 0.05,
  defaultValue: 1, unit: '× authored strike', valueKind: 'continuous', availability: 'wired',
});
const MATERIAL_STRIKE_RADIUS = parameter({
  id: 'material-strike-radius', label: 'Strike footprint', min: 1, max: 4, step: 0.25,
  defaultValue: 1, unit: '× authored footprint', valueKind: 'continuous', availability: 'wired',
});
const IMPULSE_STRENGTH = parameter({
  id: 'impulse-strength', label: 'Impulse strength', min: 0, max: 40, step: 1,
  defaultValue: 10, unit: 'normalized', valueKind: 'continuous', availability: 'wired',
});
const BLAST_STRENGTH = parameter({
  id: 'blast-strength', label: 'Blast strength', min: 0, max: 40, step: 1,
  defaultValue: 22, unit: 'normalized', valueKind: 'continuous', availability: 'wired',
});
const BLAST_RADIUS = parameter({
  id: 'blast-radius', label: 'Blast radius', min: 0.5, max: 24, step: 0.5,
  defaultValue: 18, unit: 'simulation units', valueKind: 'continuous', availability: 'wired',
});
const PROJECTILE_SPEED = parameter({
  id: 'projectile-speed', label: 'Projectile speed', min: 5, max: 60, step: 1,
  defaultValue: 31, unit: 'simulation units/s', valueKind: 'continuous', availability: 'wired',
});
const PROJECTILE_SIZE = parameter({
  id: 'projectile-size', label: 'Projectile half-size', min: 0.12, max: 1.5, step: 0.02,
  defaultValue: 0.88, unit: 'simulation units', valueKind: 'continuous', availability: 'wired',
});
const RAIN_COUNT = parameter({
  id: 'rain-count', label: 'Impact count', min: 1, max: 900, step: 1,
  defaultValue: 180, unit: 'base bodies', valueKind: 'integer', availability: 'wired',
});

const MATERIAL_PARAMETERS = [TIME_SCALE, ACTUATOR_TARGET, MATERIAL_STRIKE_STRENGTH, MATERIAL_STRIKE_RADIUS] as const;
const MATERIAL_PROJECTILE_PARAMETERS = [
  TIME_SCALE, ACTUATOR_TARGET, MATERIAL_STRIKE_STRENGTH, MATERIAL_STRIKE_RADIUS, PROJECTILE_SPEED, PROJECTILE_SIZE,
] as const;
const MATERIAL_BLAST_PARAMETERS = [
  TIME_SCALE, ACTUATOR_TARGET, MATERIAL_STRIKE_STRENGTH, MATERIAL_STRIKE_RADIUS, BLAST_STRENGTH, BLAST_RADIUS,
] as const;
const IMPULSE_PARAMETERS = [TIME_SCALE, IMPULSE_STRENGTH, BLAST_STRENGTH, BLAST_RADIUS] as const;
const PROJECTILE_PARAMETERS = [TIME_SCALE, PROJECTILE_SPEED, PROJECTILE_SIZE, BLAST_STRENGTH] as const;
const IMPACT_PARAMETERS = [TIME_SCALE, PROJECTILE_SPEED, PROJECTILE_SIZE, RAIN_COUNT] as const;
const WATER_PARAMETERS = [TIME_SCALE, IMPULSE_STRENGTH, BLAST_STRENGTH, BLAST_RADIUS] as const;

/**
 * A deliberately small, high-value view over the stable scene and material
 * registries. These records do not create new solver claims or native IDs.
 */
export const WORKBENCH_LABS = [
  {
    id: 'titan-bend-dent', materialDemoId: 'metal-square-punch-forming',
    title: 'Titan Metal Bend & Dent', shortName: 'Bend & Dent', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A clamped aluminum panel yields beneath a press, springs back, and retains a measurable localized dent.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'metal-press-brake-v-bend', materialDemoId: 'metal-press-brake-v-bend',
    title: 'Metal Fold Press-Brake', shortName: 'Metal Fold', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A line punch and discrete-shell hinges form a V-fold that springs back and retains a plastic bend set.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'metal-springback-fold', materialDemoId: 'metal-springback-fold',
    title: 'Thin Aluminum Springback Fold', shortName: 'Springback Fold', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A thin aluminum V-fold unloads with more elastic recovery than the thicker steel press-brake specimen.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'metal-thick-plate-dent', materialDemoId: 'metal-thick-plate-dent',
    title: 'Thick Aluminum Plate Dent', shortName: 'Thick Plate', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'Area-weighted mass and t³ hinge stiffness make an 8 mm plate dent less than the 3 mm ballistic panel.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'metal-notch-tear', materialDemoId: 'metal-notch-tear',
    title: 'Notched Sheet Tear', shortName: 'Notch Tear', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A seeded notch concentrates stretch until a ductile seam tear opens in the welded metal skin.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'crash-rail-axial-fold', materialDemoId: 'metal-four-point-bumper-beam',
    title: 'Aluminum Crash Rail Axial Fold', shortName: 'Crash Rail', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A guided platen shortens a formed aluminum lattice rail against a bulkhead, producing deterministic progressive folds and retained crush.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'notched-low-cycle-fatigue', materialDemoId: 'metal-notched-fatigue',
    title: 'Notched Low-Cycle Fatigue', shortName: 'Fatigue Notch', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'Reversing lattice strain accumulates qualitative fatigue damage around a seeded notch before overload.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'ballistic-glass', materialDemoId: 'glass-laminated-stone-strike',
    title: 'Glass Impact Laminated Pane', shortName: 'Glass Impact', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'An off-center stone strike opens a laminated pane into a retained spiderweb instead of a free shard sheet.',
    forceModes: ['actuator-load', 'material-strike', 'projectile'],
    liveParameters: MATERIAL_PROJECTILE_PARAMETERS,
  },
  {
    id: 'curtain-wall-wind', materialDemoId: 'glass-curtain-wall-wind',
    title: 'Curtain-Wall Wind Failure', shortName: 'Curtain Wall', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'Distributed load bows a framed brittle pane until edge damage releases the qualitative fracture field.',
    forceModes: ['actuator-load', 'release-load', 'material-strike', 'radial-blast'],
    liveParameters: MATERIAL_BLAST_PARAMETERS,
  },
  {
    id: 'rc-punching-shear', materialDemoId: 'concrete-flat-slab-punching',
    title: 'RC Flat-Slab Punching Shear', shortName: 'Punching Shear', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A central actuator breaks concrete cover cells while stronger reinforcement constraints retain a residual path.',
    forceModes: ['actuator-load', 'release-load', 'material-strike', 'radial-blast'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'blast-wall-spall', materialDemoId: 'concrete-blast-wall-spall',
    title: 'Blast-Wall Back-Face Spall', shortName: 'Blast Spall', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A broad impulse damages a reinforced concrete lattice; aggregate, dust, and the pressure history remain qualitative.',
    forceModes: ['actuator-load', 'release-load', 'material-strike', 'radial-blast'],
    liveParameters: MATERIAL_BLAST_PARAMETERS,
  },
  {
    id: 'elastomer-recovery', sceneId: 798,
    title: 'Elastomer Cyclic Recovery', shortName: 'Elastomer', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'A high-strain constraint preset demonstrates reversible flexure and damping without claiming a constitutive rubber model.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
  {
    id: 'composite-coupon', sceneId: 799,
    title: 'Composite Coupon Failure', shortName: 'Composite', group: 'materials',
    solver: 'material-lattice', fidelity: 'Reduced numerical model',
    description: 'An anisotropic lattice coupon contrasts strong fiber-axis response with weaker transverse failure.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike', 'projectile'],
    liveParameters: MATERIAL_PROJECTILE_PARAMETERS,
  },

  {
    id: 'tempest-flag', sceneId: 640,
    title: 'Tempest Flag Wind Tunnel', shortName: 'Tempest Flag', group: 'cloth',
    solver: 'pbd-cloth', fidelity: 'Numerical PBD model',
    description: 'Pinned-edge PBD cloth responds to procedural wind, projectiles, and pressure impulses.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'canopy-load-capture', sceneId: 642,
    title: 'Canopy Load Capture', shortName: 'Canopy', group: 'cloth',
    solver: 'pbd-cloth', fidelity: 'Numerical PBD model',
    description: 'A four-corner PBD canopy carries curved membrane load; aerodynamic inflation remains procedural.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPACT_PARAMETERS,
  },
  {
    id: 'cargo-net-catch', sceneId: 643,
    title: 'Cargo-Net Payload Catch', shortName: 'Cargo Net', group: 'cloth',
    solver: 'pbd-cloth', fidelity: 'Numerical PBD model',
    description: 'A supported PBD net sags and redistributes concentrated projectile and impact loads.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPACT_PARAMETERS,
  },
  {
    id: 'progressive-fabric-tear', sceneId: 646,
    title: 'Progressive Fabric Tear', shortName: 'Fabric Tear', group: 'cloth',
    solver: 'pbd-cloth', fidelity: 'Numerical PBD model',
    description: 'Break-enabled cloth removes failed topology as strain, projectile hits, and pressure open a real solver hole.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: PROJECTILE_PARAMETERS,
  },
  {
    id: 'membrane-shock', sceneId: 649,
    title: 'Tensioned Membrane Shock', shortName: 'Membrane', group: 'cloth',
    solver: 'pbd-cloth', fidelity: 'Numerical PBD model',
    description: 'A perimeter-pinned PBD sheet carries center impulses and resonant waves without simulating the surrounding air.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: IMPULSE_PARAMETERS,
  },

  {
    id: 'sky-crane-cable', sceneId: 690,
    title: 'Sky-Crane Cable Load', shortName: 'Sky Crane', group: 'rope',
    solver: 'pbd-rope', fidelity: 'Numerical PBD model',
    description: 'A PBD cable carries a concentrated payload proxy through swing, impulse, and projectile severing.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: PROJECTILE_PARAMETERS,
  },
  {
    id: 'suspension-cable-resonance', sceneId: 691,
    title: 'Suspension Cable Resonance', shortName: 'Cable Bridge', group: 'rope',
    solver: 'pbd-rope', fidelity: 'Numerical PBD model',
    description: 'Coupled PBD catenaries transmit oscillation and redistribute load after a localized cable strike.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'heavy-pendulum', sceneId: 692,
    title: 'Heavy Pendulum Impact', shortName: 'Pendulum', group: 'rope',
    solver: 'pbd-rope', fidelity: 'Numerical PBD model',
    description: 'A long constrained line and payload proxy expose anchor reaction, damping, and impact-driven swing.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: PROJECTILE_PARAMETERS,
  },
  {
    id: 'four-point-mooring', sceneId: 694,
    title: 'Four-Point Mooring Array', shortName: 'Mooring', group: 'rope',
    solver: 'pbd-rope', fidelity: 'Numerical PBD model',
    description: 'Four PBD lines share a platform-proxy load and expose redistribution after an off-axis impulse.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'rope-net-resonance', sceneId: 699,
    title: 'Rope-Net Resonance', shortName: 'Rope Net', group: 'rope',
    solver: 'pbd-rope', fidelity: 'Numerical PBD model',
    description: 'An interconnected PBD line field carries traveling resonance and progressive projectile damage.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPACT_PARAMETERS,
  },

  {
    id: 'tsunami-flume', sceneId: 741,
    title: 'Tsunami Research Flume', shortName: 'Tsunami', group: 'water',
    solver: 'shallow-water', fidelity: 'Numerical 2.5D model',
    description: 'A linear heightfield wave crosses the basin, reflects at its boundaries, and interferes with live disturbances.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: WATER_PARAMETERS,
  },
  {
    id: 'dam-breach-front', sceneId: 746,
    title: 'Dam-Breach Wave Front', shortName: 'Dam Breach', group: 'water',
    solver: 'shallow-water', fidelity: 'Numerical 2.5D model',
    description: 'An initial height discontinuity evolves through the shallow-water grid; gate and debris mechanics are proxies.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: WATER_PARAMETERS,
  },
  {
    id: 'boat-wake', sceneId: 743,
    title: 'Hydrodynamic Boat Wake', shortName: 'Boat Wake', group: 'water',
    solver: 'shallow-water', fidelity: 'Numerical + proxy coupling',
    description: 'The water field is numerical while the floater buoyancy and authored wake stand in for hull hydrodynamics.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPACT_PARAMETERS,
  },
  {
    id: 'vortex-chamber', sceneId: 747,
    title: 'Vortex Current Chamber', shortName: 'Vortex', group: 'water',
    solver: 'shallow-water', fidelity: 'Numerical 2.5D model',
    description: 'Rotating horizontal velocity and a surface depression evolve in a heightfield, not a volumetric vortex solver.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: WATER_PARAMETERS,
  },
  {
    id: 'leviathan-impact', sceneId: 749,
    title: 'Leviathan Impact Basin', shortName: 'Impact Basin', group: 'water',
    solver: 'shallow-water', fidelity: 'Numerical + proxy coupling',
    description: 'A projectile floater displaces the numerical heightfield; spray, foam, and mist are presentation-scale effects.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPACT_PARAMETERS,
  },

  {
    id: 'aegis-tower-breach', sceneId: 140,
    title: 'Aegis Tower Kinetic Breach', shortName: 'Tower Breach', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'Box3D resolves box-hull contacts and collapse; the tower is not a beam, joint, or structural-analysis model.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: PROJECTILE_PARAMETERS,
  },
  {
    id: 'truss-span-overload', sceneId: 192,
    title: 'Truss Span Overload', shortName: 'Truss Span', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'Rigid contact pieces transfer deck load and collapse, but they do not form a calibrated truss solver.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'citadel-siege', sceneId: 340,
    title: 'Citadel Siege', shortName: 'Citadel', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'Box3D masonry proxies carry projectile penetration, radial impulses, and deterministic rubble contacts.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: PROJECTILE_PARAMETERS,
  },
  {
    id: 'titan-hauler-crash', sceneId: 390,
    title: 'Titan Hauler Crash Range', shortName: 'Hauler Crash', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'Moving box vehicles and cargo collide in Box3D without wheels, suspension, tires, or crushable bodywork.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'high-bay-rack', sceneId: 541,
    title: 'High-Bay Rack Cascade', shortName: 'Rack Cascade', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'Box3D contacts drive aisle-scale rack and parcel collapse while rack connections remain simplified.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: IMPULSE_PARAMETERS,
  },
  {
    id: 'mega-atrium', sceneId: 599,
    title: 'Mega Atrium Progressive Collapse', shortName: 'Mega Atrium', group: 'rigid',
    solver: 'box3d-rigid', fidelity: 'Rigid-body proxy',
    description: 'A large architectural proxy uses real rigid contacts for impact and settling, with visual-only dust and glints.',
    forceModes: ['broad-impulse', 'radial-blast', 'projectile', 'impact-rain'],
    liveParameters: PROJECTILE_PARAMETERS,
  },

  {
    id: 'apex-proving-ground', materialDemoId: 'apex-materials-proving-ground',
    title: 'Apex Materials Proving Ground', shortName: 'Apex', group: 'combined',
    solver: 'combined-material', fidelity: 'Independent numerical rigs',
    description: 'Independent metal, glass, and concrete lattice rigs share a clock and render stream without cross-rig contact coupling.',
    forceModes: ['actuator-load', 'release-load', 'cycle-load', 'material-strike'],
    liveParameters: MATERIAL_PARAMETERS,
  },
] as const satisfies readonly WorkbenchLabDefinition[];

const workbenchLabs: readonly WorkbenchLabDefinition[] = WORKBENCH_LABS;
const sceneIds = new Set(SCENES.map((scene) => scene.id));
const labsById = new Map<string, WorkbenchLabDefinition>();

function assertWorkbenchRegistry(): void {
  if (workbenchLabs.length !== 35) {
    throw new Error(`Workbench registry must contain exactly 35 labs; received ${workbenchLabs.length}.`);
  }

  for (const lab of workbenchLabs) {
    if (labsById.has(lab.id)) throw new Error(`Workbench lab id '${lab.id}' is duplicated.`);
    labsById.set(lab.id, lab);

    const hasScene = 'sceneId' in lab && lab.sceneId !== undefined;
    const hasMaterial = 'materialDemoId' in lab && lab.materialDemoId !== undefined;
    if (hasScene === hasMaterial) {
      throw new Error(`Workbench lab '${lab.id}' must map to exactly one scene or material demo.`);
    }
    if (hasScene && !sceneIds.has(lab.sceneId)) {
      throw new Error(`Workbench lab '${lab.id}' references missing scene ${lab.sceneId}.`);
    }
    if (hasMaterial && !getMaterialDemoRecipe(lab.materialDemoId)) {
      throw new Error(`Workbench lab '${lab.id}' references missing material demo '${lab.materialDemoId}'.`);
    }
    if (lab.forceModes.length === 0 || new Set(lab.forceModes).size !== lab.forceModes.length) {
      throw new Error(`Workbench lab '${lab.id}' must define unique force modes.`);
    }
    if (lab.liveParameters.length === 0 || lab.liveParameters.length > 8) {
      throw new Error(`Workbench lab '${lab.id}' must define between one and eight live parameters.`);
    }

    const parameterIds = new Set<string>();
    for (const spec of lab.liveParameters) {
      if (parameterIds.has(spec.id)) throw new Error(`Workbench lab '${lab.id}' repeats parameter '${spec.id}'.`);
      parameterIds.add(spec.id);
      const values = [spec.min, spec.max, spec.step, spec.defaultValue];
      if (!values.every(Number.isFinite) || spec.step <= 0 || spec.min > spec.defaultValue || spec.defaultValue > spec.max) {
        throw new Error(`Workbench lab '${lab.id}' has an invalid live parameter '${spec.id}'.`);
      }
    }
  }

  if (labsById.size !== 35) {
    throw new Error(`Workbench lab ids must be unique; received ${labsById.size} unique ids.`);
  }
}

assertWorkbenchRegistry();

export function getWorkbenchLab(id: string): WorkbenchLabDefinition | null {
  return labsById.get(id) ?? null;
}

export function filterWorkbenchLabs(filter: WorkbenchLabFilter = {}): readonly WorkbenchLabDefinition[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return workbenchLabs.filter((lab) => {
    if (filter.group && lab.group !== filter.group) return false;
    if (filter.solver && lab.solver !== filter.solver) return false;
    if (filter.fidelity && lab.fidelity !== filter.fidelity) return false;
    if (filter.forceMode && !lab.forceModes.includes(filter.forceMode)) return false;
    if (!query) return true;
    const text = [
      lab.id, lab.title, lab.shortName, lab.description, lab.fidelity,
      WORKBENCH_GROUP_LABELS[lab.group], WORKBENCH_SOLVER_LABELS[lab.solver],
    ].join(' ').toLowerCase();
    return text.includes(query);
  });
}

export function getWorkbenchLabsByGroup(group: WorkbenchLabDefinition['group']): readonly WorkbenchLabDefinition[] {
  return filterWorkbenchLabs({ group });
}

export function getWorkbenchLabsBySolver(solver: WorkbenchLabDefinition['solver']): readonly WorkbenchLabDefinition[] {
  return filterWorkbenchLabs({ solver });
}

const CATALOG_VIEWS = ['material-lab-desktop', 'material-lab-mobile'] as const satisfies readonly WorkbenchConceptViewId[];
const STRUCTURAL_AND_CORRELATION_VIEWS = ['structural-test', 'correlation-review'] as const satisfies readonly WorkbenchConceptViewId[];
const FIELD_MODAL_VIEWS = ['field-modal'] as const satisfies readonly WorkbenchConceptViewId[];

const PRIMARY_VIEW_BY_LAB: Readonly<Record<string, WorkbenchConceptViewId>> = {
  'titan-bend-dent': 'structural-test',
  'crash-rail-axial-fold': 'correlation-review',
  'composite-coupon': 'field-modal',
};

export function catalogFiltersForLab(lab: WorkbenchLabDefinition): readonly MaterialLabCatalogFilter[] {
  const filters: MaterialLabCatalogFilter[] = ['all'];
  if ('materialDemoId' in lab && lab.materialDemoId) {
    const recipe = getMaterialDemoRecipe(lab.materialDemoId);
    if (recipe) {
      filters.push(recipe.labGroup);
      return Object.freeze(filters);
    }
  }
  switch (lab.group) {
    case 'cloth':
      filters.push('cloth');
      break;
    case 'water':
      filters.push('fluid');
      break;
    case 'rope':
      filters.push('soft-body');
      break;
    case 'materials':
    case 'combined':
    case 'rigid':
      filters.push(lab.id === 'elastomer-recovery' ? 'soft-body' : 'structural');
      break;
    default: {
      const unexpected: never = lab.group;
      throw new Error(`Unhandled workbench group: ${unexpected}`);
    }
  }
  return Object.freeze(filters);
}

function capabilitiesForLab(lab: WorkbenchLabDefinition): WorkbenchLabCapabilities {
  return Object.freeze({
    structuralTest: true,
    correlation: true,
    pointForce: lab.forceModes.includes('material-strike'),
    loadControl: lab.forceModes.includes('actuator-load'),
    renderCheckpointHz: lab.solver === 'box3d-rigid' ? 10 : 30,
    modalAnalysis: lab.id === 'composite-coupon' ? 'analysis-only-cantilever' : 'none',
    materialLab: true,
  });
}

function catalogDefaultAction(lab: WorkbenchLabDefinition): WorkbenchDefaultAction {
  if (lab.forceModes.includes('actuator-load') || lab.forceModes.includes('material-strike')) {
    return 'apply-force';
  }
  return 'play';
}

function defaultActionForLab(lab: WorkbenchLabDefinition): WorkbenchDefaultAction {
  const primaryViewId = PRIMARY_VIEW_BY_LAB[lab.id] ?? 'structural-test';
  switch (primaryViewId) {
    case 'correlation-review':
      return 'play';
    case 'field-modal':
      return 'run';
    case 'material-lab-desktop':
    case 'material-lab-mobile':
      return catalogDefaultAction(lab);
    case 'structural-test':
      if (lab.id === 'titan-bend-dent' || lab.group === 'rigid') return 'run';
      return catalogDefaultAction(lab);
    default: {
      const unexpected: never = primaryViewId;
      throw new Error(`Unhandled concept view for autoplay: ${unexpected}`);
    }
  }
}

function autoplayForLab(lab: WorkbenchLabDefinition): WorkbenchLabAutoplay {
  return Object.freeze({
    autoPlay: true,
    defaultAction: defaultActionForLab(lab),
  });
}

function viewIdsForLab(lab: WorkbenchLabDefinition): readonly WorkbenchConceptViewId[] {
  return Object.freeze([
    ...CATALOG_VIEWS,
    ...STRUCTURAL_AND_CORRELATION_VIEWS,
    ...(lab.id === 'composite-coupon' ? FIELD_MODAL_VIEWS : []),
  ]);
}

function bindLab(lab: WorkbenchLabDefinition): WorkbenchLabConceptBinding {
  const primaryViewId = PRIMARY_VIEW_BY_LAB[lab.id] ?? 'structural-test';
  const view = getWorkbenchConceptView(primaryViewId);
  if (!view) throw new Error(`Workbench lab '${lab.id}' maps to missing concept view '${primaryViewId}'.`);
  const autoplay = autoplayForLab(lab);
  return Object.freeze({
    labId: lab.id,
    primaryViewId,
    viewIds: viewIdsForLab(lab),
    uiWorkspaceId: view.uiWorkspaceId,
    conceptImage: view.conceptImage,
    catalogFilters: catalogFiltersForLab(lab),
    capabilities: capabilitiesForLab(lab),
    autoPlay: autoplay.autoPlay,
    defaultAction: autoplay.defaultAction,
  });
}

export const WORKBENCH_LAB_CONCEPT_BINDINGS: readonly WorkbenchLabConceptBinding[] = Object.freeze(
  workbenchLabs.map(bindLab),
);

const labBindingsById = new Map(WORKBENCH_LAB_CONCEPT_BINDINGS.map((binding) => [binding.labId, binding]));
const labIdByMaterialDemoId = new Map<string, string>();
for (const lab of workbenchLabs) {
  if ('materialDemoId' in lab && lab.materialDemoId) {
    const existing = labIdByMaterialDemoId.get(lab.materialDemoId);
    if (existing && existing !== lab.id) {
      throw new Error(`Material demo '${lab.materialDemoId}' is bound to both '${existing}' and '${lab.id}'.`);
    }
    labIdByMaterialDemoId.set(lab.materialDemoId, lab.id);
  }
}

const FEATURED_MATERIAL_DEMO_IDS = new Set<string>(MATERIAL_LAB_FEATURED_IDS);

function bindMaterialDemo(recipe: MaterialDemoRecipe): WorkbenchMaterialDemoConceptBinding {
  const labId = labIdByMaterialDemoId.get(recipe.id) ?? null;
  const labBinding = labId ? labBindingsById.get(labId) ?? null : null;
  if (labId && !labBinding) throw new Error(`Material demo '${recipe.id}' points at unbound lab '${labId}'.`);
  const primaryViewId = FEATURED_MATERIAL_DEMO_IDS.has(recipe.id)
    ? 'material-lab-desktop'
    : labBinding?.primaryViewId ?? 'material-lab-desktop';
  const view = getWorkbenchConceptView(primaryViewId);
  if (!view) throw new Error(`Material demo '${recipe.id}' maps to missing concept view '${primaryViewId}'.`);
  return Object.freeze({
    materialDemoId: recipe.id,
    labId,
    title: recipe.title,
    specimen: recipe.specimen,
    labGroup: recipe.labGroup,
    librarySlot: recipe.librarySlot,
    primaryViewId,
    viewIds: labBinding?.viewIds ?? CATALOG_VIEWS,
    conceptImage: view.conceptImage,
  });
}

export const WORKBENCH_MATERIAL_DEMO_CONCEPT_BINDINGS: readonly WorkbenchMaterialDemoConceptBinding[] = Object.freeze(
  MATERIAL_DEMO_RECIPES.map(bindMaterialDemo),
);

const materialDemoBindingsById = new Map(
  WORKBENCH_MATERIAL_DEMO_CONCEPT_BINDINGS.map((binding) => [binding.materialDemoId, binding]),
);

function assertWorkbenchConceptRegistry(): void {
  if (WORKBENCH_CONCEPT_VIEWS.length !== 5) {
    throw new Error(`Workbench concept catalog must contain 5 views; received ${WORKBENCH_CONCEPT_VIEWS.length}.`);
  }
  if (conceptViewsById.size !== WORKBENCH_CONCEPT_VIEWS.length) {
    throw new Error('Workbench concept view ids must be unique.');
  }
  for (const view of WORKBENCH_CONCEPT_VIEWS) {
    if (!labsById.has(view.defaultLabId)) {
      throw new Error(`Concept view '${view.id}' default lab '${view.defaultLabId}' is missing.`);
    }
    if (view.uiWorkspaceId !== uiWorkspaceForConceptView(view.id)) {
      throw new Error(`Concept view '${view.id}' UI workspace does not match the routing table.`);
    }
    if (
      (view.id === 'material-lab-desktop' || view.id === 'material-lab-mobile')
      && view.defaultMaterialDemoId !== 'metal-square-punch-forming'
    ) {
      throw new Error(`Material Lab view '${view.id}' must default to the Ballistic Dent recipe.`);
    }
  }

  if (WORKBENCH_LAB_CONCEPT_BINDINGS.length !== 35) {
    throw new Error(`Every curated lab must have one concept binding; received ${WORKBENCH_LAB_CONCEPT_BINDINGS.length}.`);
  }
  for (const lab of workbenchLabs) {
    const binding = labBindingsById.get(lab.id);
    if (!binding) throw new Error(`Workbench lab '${lab.id}' is missing a concept binding.`);
    if (!binding.viewIds.includes(binding.primaryViewId)) {
      throw new Error(`Workbench lab '${lab.id}' primary view is not in its view list.`);
    }
    if (binding.capabilities.modalAnalysis === 'analysis-only-cantilever' && lab.id !== 'composite-coupon') {
      throw new Error(`Only composite-coupon may expose the analysis-only field-modal workflow.`);
    }
    if (lab.id === 'composite-coupon' && !binding.viewIds.includes('field-modal')) {
      throw new Error('composite-coupon must map to the field-modal concept view.');
    }
    if (lab.id !== 'composite-coupon' && binding.viewIds.includes('field-modal')) {
      throw new Error(`Lab '${lab.id}' must not claim the analysis-only field-modal specimen.`);
    }
    if (binding.autoPlay !== true) {
      throw new Error(`Workbench lab '${lab.id}' must autoplay on open.`);
    }
    switch (binding.defaultAction) {
      case 'play':
      case 'apply-force':
      case 'run':
        break;
      default: {
        const unexpected: never = binding.defaultAction;
        throw new Error(`Workbench lab '${lab.id}' has an unhandled default action: ${unexpected}`);
      }
    }
  }

  if (labBindingsById.get('titan-bend-dent')?.primaryViewId !== 'structural-test') {
    throw new Error('titan-bend-dent must be the Structural Test flagship specimen.');
  }
  if (labBindingsById.get('crash-rail-axial-fold')?.primaryViewId !== 'correlation-review') {
    throw new Error('crash-rail-axial-fold must be the Correlation Review flagship specimen.');
  }
  if (labBindingsById.get('composite-coupon')?.primaryViewId !== 'field-modal') {
    throw new Error('composite-coupon must be the Field Modal flagship specimen.');
  }
  if (labBindingsById.get('titan-bend-dent')?.defaultAction !== 'run') {
    throw new Error('titan-bend-dent must autoplay with Structural Test run.');
  }
  if (labBindingsById.get('crash-rail-axial-fold')?.defaultAction !== 'play') {
    throw new Error('crash-rail-axial-fold must autoplay with Correlation Review play.');
  }
  if (labBindingsById.get('composite-coupon')?.defaultAction !== 'run') {
    throw new Error('composite-coupon must autoplay with Field Modal run.');
  }

  if (WORKBENCH_MATERIAL_DEMO_CONCEPT_BINDINGS.length !== MATERIAL_DEMO_RECIPES.length) {
    throw new Error('Every material demo recipe must have a concept binding.');
  }
  for (const recipe of MATERIAL_DEMO_RECIPES) {
    if (!getMaterialDemoRecipe(recipe.id) || !materialDemoBindingsById.has(recipe.id)) {
      throw new Error(`Material demo '${recipe.id}' is missing a concept binding.`);
    }
  }
  for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
    const binding = materialDemoBindingsById.get(featuredId);
    if (!binding || !binding.viewIds.includes('material-lab-desktop')) {
      throw new Error(`Featured Material Lab demo '${featuredId}' must map to material-lab-desktop.`);
    }
  }
  for (const row of MATERIAL_LAB_CROSS_CATALOG) {
    const binding = labBindingsById.get(row.labId);
    if (!binding || !binding.viewIds.includes('material-lab-desktop')) {
      throw new Error(`Material Lab cross-catalog row '${row.labId}' must map to material-lab-desktop.`);
    }
    if (!binding.catalogFilters.includes(row.filter)) {
      throw new Error(`Material Lab cross-catalog row '${row.labId}' must include filter '${row.filter}'.`);
    }
  }
}

assertWorkbenchConceptRegistry();

export function getWorkbenchLabConceptBinding(labId: string): WorkbenchLabConceptBinding | null {
  return labBindingsById.get(labId) ?? null;
}

export function getMaterialDemoConceptBinding(materialDemoId: string): WorkbenchMaterialDemoConceptBinding | null {
  return materialDemoBindingsById.get(materialDemoId) ?? null;
}

export function getWorkbenchLabsForConceptView(viewId: WorkbenchConceptViewId): readonly WorkbenchLabDefinition[] {
  return workbenchLabs.filter((lab) => labBindingsById.get(lab.id)?.viewIds.includes(viewId));
}

export function filterWorkbenchLabsByConceptView(
  viewId: WorkbenchConceptViewId,
  filter: WorkbenchLabFilter = {},
): readonly WorkbenchLabDefinition[] {
  const allowed = new Set(getWorkbenchLabsForConceptView(viewId).map((lab) => lab.id));
  return filterWorkbenchLabs(filter).filter((lab) => allowed.has(lab.id));
}

export function getDefaultLabForConceptView(viewId: WorkbenchConceptViewId): WorkbenchLabDefinition | null {
  const view = getWorkbenchConceptView(viewId);
  return view ? getWorkbenchLab(view.defaultLabId) : null;
}

export function getWorkbenchLabCapabilities(labId: string): WorkbenchLabCapabilities | null {
  return labBindingsById.get(labId)?.capabilities ?? null;
}

export function getWorkbenchLabAutoplay(labId: string): WorkbenchLabAutoplay | null {
  const binding = labBindingsById.get(labId);
  if (!binding) return null;
  return Object.freeze({
    autoPlay: binding.autoPlay,
    defaultAction: binding.defaultAction,
  });
}

export function labMatchesCatalogFilter(
  lab: WorkbenchLabDefinition,
  filter: MaterialLabCatalogFilter,
): boolean {
  if (filter === 'all') return true;
  return catalogFiltersForLab(lab).includes(filter);
}

export function materialLabCatalogSearchText(lab: WorkbenchLabDefinition): string {
  const copy = materialLabCatalogCopy(lab);
  return [
    lab.id, lab.title, lab.shortName, lab.description, lab.fidelity,
    copy.title, copy.specimen,
    WORKBENCH_GROUP_LABELS[lab.group], WORKBENCH_SOLVER_LABELS[lab.solver],
  ].join(' ');
}

export function materialLabCatalogCopy(lab: WorkbenchLabDefinition): {
  readonly title: string;
  readonly specimen: string;
} {
  if ('materialDemoId' in lab && lab.materialDemoId) {
    const recipe = getMaterialDemoRecipe(lab.materialDemoId);
    if (recipe) return { title: recipe.title, specimen: recipe.specimen };
  }
  for (const row of MATERIAL_LAB_CROSS_CATALOG) {
    if (row.labId === lab.id) return { title: row.title, specimen: row.specimen };
  }
  return { title: lab.shortName, specimen: WORKBENCH_GROUP_LABELS[lab.group] };
}

export function hostWorkbenchLabForMaterialDemo(demoId: string): WorkbenchLabDefinition | null {
  const boundId = labIdByMaterialDemoId.get(demoId);
  if (boundId) return labsById.get(boundId) ?? null;
  const recipe = getMaterialDemoRecipe(demoId);
  if (!recipe) return null;
  switch (recipe.kind) {
    case 'combined':
      return labsById.get('apex-proving-ground') ?? null;
    case 'glass':
      return labsById.get('ballistic-glass') ?? null;
    case 'concrete':
      return labsById.get('rc-punching-shear') ?? null;
    case 'metal':
      return labsById.get('titan-bend-dent') ?? null;
    default: {
      const exhaustive: never = recipe.kind;
      return exhaustive;
    }
  }
}

function virtualCatalogLabForRecipe(recipe: MaterialDemoRecipe): WorkbenchLabDefinition {
  const host = hostWorkbenchLabForMaterialDemo(recipe.id) ?? workbenchLabs[0];
  return Object.freeze({
    id: recipe.id,
    materialDemoId: recipe.id,
    title: recipe.title,
    shortName: recipe.title,
    group: recipe.kind === 'combined' ? 'combined' : 'materials',
    solver: recipe.kind === 'combined' ? 'combined-material' : 'material-lattice',
    fidelity: host.fidelity,
    description: recipe.tagline,
    forceModes: host.forceModes,
    liveParameters: host.liveParameters,
  });
}

/**
 * Openable Material Lab rows: featured mockup 01–07, then the remaining
 * recipes, then curated labs that are not already represented.
 */
export function getMaterialLabCatalogLabs(): readonly WorkbenchLabDefinition[] {
  const seen = new Set<string>();
  const rows: WorkbenchLabDefinition[] = [];
  const add = (lab: WorkbenchLabDefinition | null | undefined): void => {
    if (!lab || seen.has(lab.id)) return;
    seen.add(lab.id);
    rows.push(lab);
  };

  for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
    add(hostWorkbenchLabForMaterialDemo(featuredId));
  }
  for (const row of MATERIAL_LAB_CROSS_CATALOG) {
    add(labsById.get(row.labId));
  }
  for (const recipe of [...MATERIAL_DEMO_RECIPES].sort((a, b) => a.librarySlot - b.librarySlot)) {
    const boundId = labIdByMaterialDemoId.get(recipe.id);
    if (boundId) add(labsById.get(boundId));
    else add(virtualCatalogLabForRecipe(recipe));
  }
  for (const lab of workbenchLabs) add(lab);
  return Object.freeze(rows);
}

export function catalogFiltersForGroup(group: WorkbenchGroup): readonly MaterialLabCatalogFilter[] {
  switch (group) {
    case 'materials':
    case 'combined':
    case 'rigid':
      return ['all', 'structural'];
    case 'cloth':
      return ['all', 'cloth'];
    case 'rope':
      return ['all', 'soft-body'];
    case 'water':
      return ['all', 'fluid'];
    default: {
      const unexpected: never = group;
      throw new Error(`Unhandled workbench group: ${unexpected}`);
    }
  }
}
