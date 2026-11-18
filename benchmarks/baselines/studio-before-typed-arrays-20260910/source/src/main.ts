import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@phosphor-icons/web/regular';

import {
  clamp,
  isFiniteArray,
  matrixColumnLength,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  type Vec3,
} from './math';
import { CameraMatrixCache } from './camera';
import { StageTimings } from './perf/frame-clock';
import { FrameBudgetGovernor } from './perf/runtime';
import { createWorkbenchRuntime, type WorkbenchRuntime } from './engine/workbench-runtime';
import { FrameLineStager } from './frame-lines';
import {
  SCENES,
  clampStress,
  getSceneById,
  sceneLabel,
  type ScenePreset,
} from './scenes';
import {
  AAA_SHOWCASES,
  AAA_SIGNATURE_SHOWCASES,
  getShowcaseById,
  getShowcaseByOrdinal,
  getShowcaseScene,
  sampleShowcaseCamera,
  sampleShowcaseCameraInto,
  type AAAShowcase,
  type ShowcaseBeat,
} from './showcases';
import { CinematicEffects } from './effects';
import {
  AAA_IMPROVEMENTS,
  getAAAImprovementsForScene,
  getAAAStagePrimitives,
  getEngineeringStageGroups,
  getEngineeringStagePrimitives,
} from './aaa-improvements';
import {
  COMBINED_MATERIAL_OFFSETS,
  MATERIAL_DEMO_RECIPES,
  getMaterialDemoRecipe,
  getMaterialDemoStageGroups,
  getMaterialDemoStagePrimitives,
  materialDemoWorldPoint,
  sceneForMaterialDemo,
  type MaterialDemoKind,
} from './material-demos';
import {
  WORKBENCH_GROUP_LABELS,
  WORKBENCH_GROUPS,
  WORKBENCH_LABS,
  WORKBENCH_SOLVER_LABELS,
  conceptViewIdFromWorkspaceKind,
  filterWorkbenchLabs,
  getWorkbenchLab,
  getWorkbenchLabAutoplay,
  getMaterialDemoConceptBinding,
  hostWorkbenchLabForMaterialDemo,
  materialLabCatalogCopy,
  parseConceptViewId,
  workspaceKindFromConceptViewId,
  type WorkbenchGroup,
  type WorkbenchForceMode,
  type WorkbenchLabDefinition,
  type WorkbenchLiveParameter,
  type WorkbenchParameterId,
} from './workbench/registry';
import { loadBestPhysicsBackend } from './physics/wasm';
import { WebGPURenderer } from './webgpu/renderer';
import { SOFT_RENDER_INSTANCE_BUDGET, SoftSimulationSuite, type SoftSimulationFrame } from './soft/simulations';
import { initializeSoftKernelRuntime } from './soft/kernels';
import {
  ENGINEERING_WORKSPACES_MOUNT_ID,
  type CameraRig,
  type DebugLine,
  type DynamicSurfaceFrame,
  type PhysicsBackend,
  type RenderQuality,
  type RenderQualityId,
} from './types';
import { isMaterialLabPresetId } from './soft/material-presets';
import {
  EngineeringRunRecorder,
  EngineeringSession,
  engineeringProvenanceForSolver,
  parseEngineeringConceptView,
  type EngineeringPreflightCheck,
  type EngineeringRunEventKind,
  type EngineeringRunState,
} from './workbench/engineering-session';
import {
  correlateEngineeringSeries,
  estimateReducedModalResponse,
} from './workbench/engineering-analysis';
import {
  RUN_RECORD_SCHEMA_V1,
  createEngineeringEvidenceV1,
  parseTestDatasetCsv,
  parseTestDatasetV1Json,
  type CsvChannelSpec,
  type RunRecordV1,
  type TestDatasetV1,
} from './workbench/engineering-evidence';
import {
  createEngineeringWorkspaces,
  demoIntentFromSearch,
  ENGINEERING_CONCEPT_VIEWS,
  type EngineeringChartUpdate,
  type EngineeringConceptViewId,
  type EngineeringModalCapture,
  type EngineeringRunCommandRequest,
  type EngineeringWorkspaceId,
  type EngineeringWorkspacesController,
} from './ui/engineering-workspaces';
import {
  MATERIAL_LAB_MOBILE_BREAKPOINT_PX,
  isMaterialLabMobileViewport,
} from './ui/material-lab-mobile';
import type { MaterialLabDesktopControlChange } from './ui/material-lab-desktop';
import {
  getEngineeringModelForLab,
  type EngineeringAssemblyComponent,
  type EngineeringBounds,
  type EngineeringModelManifest,
} from './workbench/engineering-model';
import {
  createEngineeringInspection,
  type EngineeringInspectionController,
  type EngineeringViewId,
} from './ui/engineering-inspection';

const MAX_EFFECT_INSTANCES = 1536;
const LIGHT_DIRECTION: Vec3 = vec3Normalize([0.42, -0.84, 0.34]);
const FOG_COLOR: Vec3 = [0.055, 0.085, 0.14];
const STUDIO_FOG_COLOR: Vec3 = [0.016, 0.014, 0.011];
const rigidDebugLines: DebugLine[] = [];
const rigidDebugLinePool: DebugLine[] = [];
const frameLineStager = new FrameLineStager();
const MODAL_ELIGIBLE_LAB_IDS = new Set([
  'composite-coupon',
  'elastomer-recovery',
  'membrane-shock',
  'suspension-cable-resonance',
  'rope-net-resonance',
]);
const MATERIAL_LAB_DEMO_IDS: ReadonlySet<string> = new Set(MATERIAL_DEMO_RECIPES.map((recipe) => recipe.id));
const BOX_CORNER_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
] as const;
const BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;

function stableStringHash(value: string | undefined): number {
  let hash = 2166136261 >>> 0;
  if (!value) return 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function seedForScene(scene: ScenePreset, base = 0xc0ffee): number {
  return (base + scene.id * 0x9e3779b9 + scene.variant * 0x45d9f3b ^ stableStringHash(scene.materialDemoId)) >>> 0;
}

function stagePrimitivesForScene(scene: ScenePreset) {
  return [
    ...getAAAStagePrimitives(scene.id),
    ...getMaterialDemoStagePrimitives(scene.materialDemoId),
    ...getEngineeringStagePrimitives(scene.id, scene.materialDemoId),
  ];
}

const QUALITY_PROFILES: Record<RenderQualityId, RenderQuality> = {
  performance: {
    id: 'performance', label: 'Performance', exposure: 1.0, bloomStrength: 0.08,
    fogDensity: 0.0035, shadowStrength: 0, effectBudget: 256, resolutionScale: 0.70,
    sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1,
  },
  balanced: {
    id: 'balanced', label: 'Balanced', exposure: 1.05, bloomStrength: 0.28,
    fogDensity: 0.0055, shadowStrength: 0.68, effectBudget: 512, resolutionScale: 0.85,
    sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1,
  },
  cinematic: {
    id: 'cinematic', label: 'Cinematic', exposure: 1.12, bloomStrength: 0.62,
    fogDensity: 0.0075, shadowStrength: 1, effectBudget: 1024, resolutionScale: 1.0,
    sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9,
  },
  ultra: {
    id: 'ultra', label: 'Ultra', exposure: 1.18, bloomStrength: 0.9,
    fogDensity: 0.009, shadowStrength: 1, effectBudget: 1536, resolutionScale: 1.15,
    sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9,
  },
};

type Ui = {
  app: HTMLElement;
  canvas: HTMLCanvasElement;
  libraryPanel: HTMLElement;
  inspectorPanel: HTMLElement;
  experimentNavigator: HTMLElement;
  labBrowser: HTMLElement;
  browseLabs: HTMLButtonElement;
  experimentTitle: HTMLElement;
  experimentModel: HTMLElement;
  treeModelName: HTMLElement;
  experimentChannelInput: HTMLOutputElement;
  experimentChannelResponse: HTMLOutputElement;
  experimentChannelDamage: HTMLOutputElement;
  experimentRevisions: HTMLElement;
  sceneButtons: HTMLElement;
  sceneTitle: HTMLElement;
  sceneSubtitle: HTMLElement;
  sceneDetails: HTMLElement;
  sceneSearch: HTMLInputElement;
  categoryFilter: HTMLSelectElement;
  sceneSelect: HTMLSelectElement;
  sceneCount: HTMLElement;
  prevScene: HTMLButtonElement;
  nextScene: HTMLButtonElement;
  randomScene: HTMLButtonElement;
  maxTour: HTMLButtonElement;
  showcaseSelect: HTMLSelectElement;
  showcasePlay: HTMLButtonElement;
  showcaseRestart: HTMLButtonElement;
  showcaseNext: HTMLButtonElement;
  showcaseTitle: HTMLElement;
  showcaseTagline: HTMLElement;
  showcaseObjective: HTMLElement;
  cinematicStatus: HTMLElement;
  cinematicBeat: HTMLElement;
  cinematicProgress: HTMLElement;
  cinematicProgressBar: HTMLElement;
  bodyCount: HTMLElement;
  dynamicCount: HTMLElement;
  effectCount: HTMLElement;
  softSystem: HTMLElement;
  softNodes: HTMLElement;
  softConstraints: HTMLElement;
  softBreaks: HTMLElement;
  softEnergy: HTMLElement;
  materialRig: HTMLDetailsElement;
  materialName: HTMLElement;
  materialTest: HTMLElement;
  materialLoadTarget: HTMLInputElement;
  materialLoadValue: HTMLElement;
  materialApply: HTMLButtonElement;
  materialRelease: HTMLButtonElement;
  materialCycle: HTMLButtonElement;
  materialDent: HTMLButtonElement;
  materialLoad: HTMLElement;
  materialStrain: HTMLElement;
  materialThresholds: HTMLElement;
  materialDamage: HTMLElement;
  materialDentDepth: HTMLElement;
  materialResidualDent: HTMLElement;
  materialFragments: HTMLElement;
  materialFailure: HTMLElement;
  fps: HTMLElement;
  simMs: HTMLElement;
  renderMs: HTMLElement;
  upload: HTMLElement;
  backend: HTMLElement;
  runtimeSeed: HTMLElement;
  runtimeSolver: HTMLElement;
  runtimeFidelity: HTMLElement;
  hash: HTMLElement;
  qualityStat: HTMLElement;
  warning: HTMLElement;
  log: HTMLElement;
  stress: HTMLInputElement;
  stressValue: HTMLElement;
  quality: HTMLSelectElement;
  speed: HTMLSelectElement;
  pause: HTMLButtonElement;
  step: HTMLButtonElement;
  reset: HTMLButtonElement;
  kick: HTMLButtonElement;
  explode: HTMLButtonElement;
  projectile: HTMLButtonElement;
  rain: HTMLButtonElement;
  debug: HTMLButtonElement;
  runTests: HTMLButtonElement;
  runTurboQuant: HTMLButtonElement;
  forceMagnitude: HTMLInputElement;
  forceMagnitudeValue: HTMLElement;
  forceRadiusLabel: HTMLLabelElement;
  forceRadius: HTMLInputElement;
  forceRadiusValue: HTMLElement;
  forceApply: HTMLButtonElement;
  liveParameterControls: HTMLElement;
  runPhase: HTMLElement;
  runId: HTMLElement;
  simulationLimitCard: HTMLElement;
  simulationLimitState: HTMLElement;
  simulationLimitDetail: HTMLElement;
  runPreflight: HTMLButtonElement;
  runArm: HTMLButtonElement;
  runStart: HTMLButtonElement;
  runAbort: HTMLButtonElement;
  runEventList: HTMLElement;
  loadControlMode: HTMLSelectElement;
  loadCaseName: HTMLOutputElement;
  loadCaseTarget: HTMLOutputElement;
  loadCaseRate: HTMLOutputElement;
  loadCaseLimit: HTMLOutputElement;
  forceTool: HTMLButtonElement;
  forceReticle: HTMLElement;
  viewportInstructions: HTMLElement;
  viewportToolLabel: HTMLElement;
  viewportHudTitle: HTMLElement;
  labFilterCount: HTMLElement;
  solverSubsteps: HTMLSelectElement;
  assemblyModel: HTMLElement;
  assemblyRevision: HTMLElement;
  assemblyCoordinateSystem: HTMLElement;
  assemblyUnits: HTMLElement;
  assemblyProvenance: HTMLElement;
  assemblyViewControls: HTMLElement;
  assemblySelection: HTMLElement;
  assemblyClearSelection: HTMLButtonElement;
  assemblyComponentList: HTMLElement;
  assemblyDimensionList: HTMLElement;
  assemblyLimitList: HTMLElement;
  mobileLibraryToggle: HTMLButtonElement;
  mobileInspectorToggle: HTMLButtonElement;
  captureFrame: HTMLButtonElement;
  forceChart: HTMLCanvasElement;
  energyChart: HTMLCanvasElement;
  stressChart: HTMLCanvasElement;
  viewportProbeOutputs: readonly HTMLOutputElement[];
};

const ui = getUi();
const effects = new CinematicEffects();
const cameraMatrixCache = new CameraMatrixCache();
let soft: SoftSimulationSuite;
let backend: PhysicsBackend;
let renderer: WebGPURenderer;
let engineRuntime:WorkbenchRuntime;
const engineTimings=new StageTimings(['step','staging','renderCpu','frame']);
const renderGovernor=new FrameBudgetGovernor();
const adaptiveRendering=new URLSearchParams(location.search).get('adaptive')==='1';
let simulationLagSeconds=0;
let rendererRecovering=false;
let rendererFailed=false;
let frameDisposed=false;
let frameRequest=0;
let lastGovernorSample=-1;
let stopRendererLoss:()=>void=()=>{};
let currentLab: WorkbenchLabDefinition = WORKBENCH_LABS[0];
let currentScene: ScenePreset = resolveWorkbenchLabScene(currentLab);
let camera: CameraRig = cloneRig(currentScene.camera);
let paused = false;
let debugEnabled = false;
let isDragging = false;
let forceDragging = false;
let forceToolEnabled = false;
let forceTargetU = 0.5;
let forceTargetV = 0.5;
let lastPointerX = 0;
let lastPointerY = 0;
let seed = 0xc0ffee;
let quality: RenderQuality = QUALITY_PROFILES.cinematic;
let manualSpeed = 1;
let cinematicSpeed = 1;
let activeShowcase: AAAShowcase = AAA_SHOWCASES[0];
let cinematicPlaying = false;
let cinematicTime = 0;
let cinematicNextBeat = 0;
let maxTourEnabled = false;
let showcaseOrdinal = 0;
let globalTime = 0;
let simulationAccumulator = 0;
let solverSubSteps = 4;
let lastForceSignal = 0;
const labParameterValues = new Map<string, Map<WorkbenchParameterId, number>>();
let engineeringRun: EngineeringRunRecorder | null = null;
let engineeringRunOrdinal = 0;
let engineeringSimStep = 0;
let modalPulseReleaseStep = -1;
let engineeringInputSignal = 0;
let lastPreflightChecks: readonly EngineeringPreflightCheck[] = [];
let engineeringWorkspaces: EngineeringWorkspacesController | null = null;
let engineeringSession: EngineeringSession | null = null;
let syncingEngineeringSession = false;
let previousEngineeringWorkspace: EngineeringWorkspaceId = 'test';
let testWorkspaceLabId = currentLab.id;
let currentConceptScreen: EngineeringConceptViewId = 'structural-test';
let applyingConceptScreen = false;
let autoplayingLoadedSimulation = false;
let importedCorrelationDataset: TestDatasetV1 | null = null;
const completedRunRecords: RunRecordV1[] = [];
const completedRunFrameUrls = new Map<string, string>();
const correlationCaseRunIds = new Map<string, string>();
let activeCorrelationRunId: string | null = null;
type ModalCaptureRecord = EngineeringModalCapture & { readonly labId: string };
const modalCaptureRecords: ModalCaptureRecord[] = [];
let completedReferenceUrl: string | null = null;
let activeEngineeringModel: EngineeringModelManifest | null = null;
let engineeringInspection: EngineeringInspectionController;
const engineeringInspectionLines: DebugLine[] = [];
let engineeringInspectionVersion = 1;

const TELEMETRY_HISTORY_LENGTH = 72;
const forceHistory: number[] = [];
const energyHistory: number[] = [];
const stressHistory: number[] = [];

function workbenchMaterialId(lab: WorkbenchLabDefinition): string | null {
  const value = 'materialDemoId' in lab ? lab.materialDemoId : undefined;
  return typeof value === 'string' ? value : null;
}

function resolveWorkbenchLabScene(lab: WorkbenchLabDefinition): ScenePreset {
  const materialDemoId = workbenchMaterialId(lab);
  if (materialDemoId) return sceneForMaterialDemo(materialDemoId);
  const sceneId = 'sceneId' in lab ? lab.sceneId : undefined;
  if (typeof sceneId !== 'number') throw new Error(`Workbench lab '${lab.id}' has no scene target.`);
  return getSceneById(sceneId);
}

function materialLabLayout(): Extract<EngineeringConceptViewId, 'material-lab-desktop' | 'material-lab-mobile'> {
  return isMaterialLabMobileViewport() ? 'material-lab-mobile' : 'material-lab-desktop';
}

function parseWorkspaceParam(value: string | null): EngineeringWorkspaceId | null {
  switch (value) {
    case 'test':
    case 'structural':
    case 'structural-test':
      return 'test';
    case 'correlation':
    case 'correlation-review':
      return 'correlation';
    case 'field':
    case 'field-modal':
      return 'field';
    default:
      return null;
  }
}

function parseConceptViewParam(value: string | null): EngineeringConceptViewId | null {
  if (!value) return null;
  const token = value.trim();
  if (token === 'material-lab-desktop' || token === 'material-lab-mobile') return token;
  const kind = parseEngineeringConceptView(token);
  if (kind) {
    const layout = kind === 'materialLab' && isMaterialLabMobileViewport() ? 'mobile' : 'desktop';
    return conceptViewIdFromWorkspaceKind(kind, layout);
  }
  return parseConceptViewId(token);
}

type WorkbenchConceptRoute = 'correlation' | 'field-modal' | 'structural';

function workbenchConceptRoute(labId: string): WorkbenchConceptRoute {
  switch (labId) {
    case 'crash-rail-axial-fold':
      return 'correlation';
    case 'composite-coupon':
      return 'field-modal';
    default:
      return 'structural';
  }
}

function conceptScreenForWorkbenchLab(lab: WorkbenchLabDefinition): EngineeringConceptViewId {
  const route = workbenchConceptRoute(lab.id);
  switch (route) {
    case 'correlation':
      return 'correlation-review';
    case 'field-modal':
      return 'field-modal';
    case 'structural':
      return 'structural-test';
    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

function conceptScreenForMaterialDemo(demoId: string): EngineeringConceptViewId {
  return MATERIAL_LAB_DEMO_IDS.has(demoId) ? materialLabLayout() : 'structural-test';
}

function conceptScreenForEngineeringWorkspace(workspace: EngineeringWorkspaceId): EngineeringConceptViewId {
  switch (workspace) {
    case 'test':
      return currentConceptScreen === 'material-lab-desktop' || currentConceptScreen === 'material-lab-mobile'
        ? currentConceptScreen
        : 'structural-test';
    case 'correlation':
      return 'correlation-review';
    case 'field':
      return 'field-modal';
    default: {
      const exhaustive: never = workspace;
      return exhaustive;
    }
  }
}

function loadMaterialDemoInLab(demoId: string): void {
  const scene = sceneForMaterialDemo(demoId);
  currentLab = findWorkbenchLabForScene(scene) ?? hostWorkbenchLabForMaterialDemo(demoId) ?? currentLab;
  loadScene(scene);
}

function materialLabChromeId(): string {
  const demoId = currentScene.materialDemoId;
  if (!demoId) return currentLab.id;
  return getMaterialDemoConceptBinding(demoId)?.labId ?? demoId;
}

function materialLabChromeTitle(): string {
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  if (recipe) return recipe.title;
  return materialLabCatalogCopy(currentLab).title;
}

function syncActiveLabChrome(): void {
  engineeringWorkspaces?.setActiveLab(materialLabChromeId(), materialLabChromeTitle());
  if (!engineeringSession) return;
  if (!getWorkbenchLab(currentLab.id)) return;
  if (engineeringSession.view === 'physicsFieldModal' && currentLab.id !== 'composite-coupon') return;
  if (engineeringSession.labId !== currentLab.id) engineeringSession.selectLab(currentLab.id);
}

/** Stay on Material Lab when the catalog picks a recipe or lab. Do not route flagships away. */
function loadMaterialLabSelection(id: string): void {
  const recipe = getMaterialDemoRecipe(id);
  if (recipe) {
    loadMaterialDemoInLab(id);
    syncActiveLabChrome();
    return;
  }
  const lab = getWorkbenchLab(id);
  if (!lab) return;
  currentLab = lab;
  if (ENGINEERING_CONCEPT_VIEWS[currentConceptScreen].workspace === 'test') testWorkspaceLabId = lab.id;
  const url = new URL(window.location.href);
  url.searchParams.set('lab', lab.id);
  window.history.replaceState(null, '', url);
  loadScene(resolveWorkbenchLabScene(lab));
  syncActiveLabChrome();
}

function applyMaterialLabControlChange(change: MaterialLabDesktopControlChange): void {
  const numeric = typeof change.value === 'number' ? change.value : Number(change.value);
  if (change.parameterId && Number.isFinite(numeric)) {
    const parameter = currentLab.liveParameters.find((candidate) => candidate.id === change.parameterId);
    if (parameter) {
      parameterValuesForLab(currentLab).set(parameter.id, clamp(numeric, parameter.min, parameter.max));
    }
  }
  switch (change.control) {
    case 'magnitude':
      if (Number.isFinite(numeric)) {
        ui.forceMagnitude.value = String(numeric);
        const parameterId = ui.forceMagnitude.dataset.parameterId as WorkbenchParameterId | undefined;
        if (parameterId) parameterValuesForLab(currentLab).set(parameterId, Number(ui.forceMagnitude.value));
        updateForceControlLabels();
      }
      break;
    case 'radius':
      if (Number.isFinite(numeric)) {
        ui.forceRadius.value = String(numeric);
        const parameterId = ui.forceRadius.dataset.parameterId as WorkbenchParameterId | undefined;
        if (parameterId) parameterValuesForLab(currentLab).set(parameterId, Number(ui.forceRadius.value));
        updateForceControlLabels();
      }
      break;
    case 'impulse':
      break;
    case 'time-scale':
      if (Number.isFinite(numeric)) {
        manualSpeed = clamp(numeric, 0.05, 2);
        ui.speed.value = String(manualSpeed);
        parameterValuesForLab(currentLab).set('time-scale', manualSpeed);
      }
      break;
    case 'substeps':
      if (Number.isFinite(numeric)) {
        solverSubSteps = clamp(Math.round(numeric), 1, 8);
        ui.solverSubsteps.value = String(solverSubSteps);
      }
      break;
    case 'yield-strain':
    case 'hardening':
    case 'depth':
    case 'iterations':
    case 'collision':
    case 'adaptive-step':
    case 'material-preset':
      break;
    default: {
      const exhaustive: never = change.control;
      void exhaustive;
    }
  }
}

function applyConceptLibraryMode(screen: EngineeringConceptViewId): void {
  switch (screen) {
    case 'material-lab-desktop':
    case 'material-lab-mobile':
      setLibraryMode('labs');
      break;
    case 'structural-test':
      setLibraryMode('experiment');
      break;
    case 'correlation-review':
    case 'field-modal':
      break;
    default: {
      const exhaustive: never = screen;
      void exhaustive;
    }
  }
}

function syncEngineeringSessionFromScreen(screen: EngineeringConceptViewId): void {
  if (!engineeringSession || syncingEngineeringSession) return;
  const kind = workspaceKindFromConceptViewId(screen);
  syncingEngineeringSession = true;
  try {
    if (engineeringSession.view !== kind) engineeringSession.setView(kind);
  } finally {
    syncingEngineeringSession = false;
  }
}

function conceptViewIdForSession(): EngineeringConceptViewId | null {
  if (!engineeringSession) return null;
  const layout = engineeringSession.view === 'materialLab' && isMaterialLabMobileViewport()
    ? 'mobile'
    : engineeringSession.layout;
  return conceptViewIdFromWorkspaceKind(engineeringSession.view, layout);
}

function syncConceptScreenDataset(screen: EngineeringConceptViewId): void {
  ui.app.dataset.conceptScreen = screen;
  document.body.dataset.conceptScreen = screen;
  if (engineeringWorkspaces) engineeringWorkspaces.root.dataset.conceptScreen = screen;
}

function syncConceptScreenUrl(screen: EngineeringConceptViewId): void {
  const url = new URL(window.location.href);
  url.searchParams.set('workspace', ENGINEERING_CONCEPT_VIEWS[screen].workspace);
  url.searchParams.set('view', screen);
  url.searchParams.set('lab', currentLab.id);
  if (screen === 'material-lab-desktop' || screen === 'material-lab-mobile') {
    const demoId = currentScene.materialDemoId;
    if (demoId) url.searchParams.set('demo', demoId);
    else url.searchParams.delete('demo');
  } else {
    url.searchParams.delete('demo');
  }
  window.history.replaceState(null, '', url);
}

function workspaceSwitchBlocked(next: EngineeringWorkspaceId): boolean {
  const current = engineeringWorkspaces?.getWorkspace() ?? previousEngineeringWorkspace;
  const runOwnsLiveState = engineeringRun !== null
    && ['preflight', 'armed', 'running', 'paused'].includes(engineeringRun.state);
  if (next === current || !runOwnsLiveState || !engineeringRun) return false;
  const blockedMessage = `Complete or abort ${engineeringRun.descriptor.id} before leaving ${current}. Solver state preserved.`;
  appendLog(blockedMessage);
  engineeringWorkspaces?.updateRunLifecycle({
    state: engineeringRun.state === 'draft' ? 'idle' : engineeringRun.state,
    elapsedSeconds: engineeringRun.samples.at(-1)?.time ?? 0,
    step: engineeringRun.samples.at(-1)?.step ?? 0,
    frame: engineeringSimStep,
    message: blockedMessage,
  });
  return true;
}

function applyConceptScreen(screen: EngineeringConceptViewId, options: { focus?: boolean } = {}): void {
  const workspace = ENGINEERING_CONCEPT_VIEWS[screen].workspace;
  currentConceptScreen = screen;
  syncConceptScreenDataset(screen);
  applyingConceptScreen = true;
  try {
    engineeringWorkspaces?.setConceptView(screen, { focus: options.focus });
    engineeringWorkspaces?.moveViewport(workspace);
    applyConceptLibraryMode(screen);
    ui.app.dataset.workspace = workspace;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')) {
      const active = candidate.dataset.workbenchTab === workspace;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    }
    syncConceptScreenUrl(screen);
    syncEngineeringSessionFromScreen(screen);
    if (screen === 'material-lab-desktop' || screen === 'material-lab-mobile') {
      if (!ui.forceTool.disabled) toggleForceTool(true);
    } else if (forceToolEnabled) {
      toggleForceTool(false);
    }
  } finally {
    applyingConceptScreen = false;
  }
}

function conceptScreenForOpenedShowcase(showcase: AAAShowcase): EngineeringConceptViewId {
  if (showcase.materialDemoId) return conceptScreenForMaterialDemo(showcase.materialDemoId);
  const lab = findWorkbenchLabForScene(getShowcaseScene(showcase));
  return lab ? conceptScreenForWorkbenchLab(lab) : 'structural-test';
}

function resolveBootConcept(): {
  lab: WorkbenchLabDefinition;
  scene: ScenePreset;
  screen: EngineeringConceptViewId;
  workspace: EngineeringWorkspaceId;
} {
  const url = new URL(window.location.href);
  const viewParam = parseConceptViewParam(url.searchParams.get('view'));
  const demo = getMaterialDemoRecipe(url.searchParams.get('demo') ?? undefined);
  const requestedLab = getWorkbenchLab(url.searchParams.get('lab') ?? '');
  const workspaceParam = parseWorkspaceParam(url.searchParams.get('workspace'));
  if (viewParam) {
    const spec = ENGINEERING_CONCEPT_VIEWS[viewParam];
    if (demo) {
      const scene = sceneForMaterialDemo(demo.id);
      return { lab: findWorkbenchLabForScene(scene) ?? requestedLab ?? WORKBENCH_LABS[0], scene, screen: viewParam, workspace: spec.workspace };
    }
    if (requestedLab) {
      return { lab: requestedLab, scene: resolveWorkbenchLabScene(requestedLab), screen: viewParam, workspace: spec.workspace };
    }
    if (spec.workspace !== 'test') {
      const isolatedId = spec.workspace === 'field' ? 'composite-coupon' : 'crash-rail-axial-fold';
      const lab = getWorkbenchLab(isolatedId) ?? WORKBENCH_LABS[0];
      return { lab, scene: resolveWorkbenchLabScene(lab), screen: viewParam, workspace: spec.workspace };
    }
    const lab = requestedLab ?? WORKBENCH_LABS[0];
    return { lab, scene: resolveWorkbenchLabScene(lab), screen: viewParam, workspace: spec.workspace };
  }
  if (demo) {
    const scene = sceneForMaterialDemo(demo.id);
    const lab = findWorkbenchLabForScene(scene) ?? WORKBENCH_LABS[0];
    const screen = workspaceParam && workspaceParam !== 'test'
      ? conceptScreenForEngineeringWorkspace(workspaceParam)
      : materialLabLayout();
    return { lab, scene, screen, workspace: ENGINEERING_CONCEPT_VIEWS[screen].workspace };
  }
  if (requestedLab) {
    const scene = resolveWorkbenchLabScene(requestedLab);
    const screen = workspaceParam
      ? conceptScreenForEngineeringWorkspace(workspaceParam)
      : conceptScreenForWorkbenchLab(requestedLab);
    return { lab: requestedLab, scene, screen, workspace: ENGINEERING_CONCEPT_VIEWS[screen].workspace };
  }
  if (workspaceParam && workspaceParam !== 'test') {
    const isolatedId = workspaceParam === 'field' ? 'composite-coupon' : 'crash-rail-axial-fold';
    const lab = getWorkbenchLab(isolatedId) ?? WORKBENCH_LABS[0];
    const screen = conceptScreenForEngineeringWorkspace(workspaceParam);
    return { lab, scene: resolveWorkbenchLabScene(lab), screen, workspace: workspaceParam };
  }
  const lab = WORKBENCH_LABS[0];
  return {
    lab,
    scene: resolveWorkbenchLabScene(lab),
    screen: 'structural-test',
    workspace: 'test',
  };
}


function getUi(): Ui {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id) as T | null;
    if (!element) throw new Error(`Missing #${id}`);
    return element;
  };
  return {
    app: byId('app'),
    canvas: byId<HTMLCanvasElement>('gpu-canvas'),
    libraryPanel: byId('library-panel'),
    inspectorPanel: byId('inspector-panel'),
    experimentNavigator: byId('experiment-navigator'),
    labBrowser: byId('lab-browser'),
    browseLabs: byId<HTMLButtonElement>('browse-labs'),
    experimentTitle: byId('experiment-title'),
    experimentModel: byId('experiment-model'),
    treeModelName: byId('tree-model-name'),
    experimentChannelInput: byId<HTMLOutputElement>('experiment-channel-input'),
    experimentChannelResponse: byId<HTMLOutputElement>('experiment-channel-response'),
    experimentChannelDamage: byId<HTMLOutputElement>('experiment-channel-damage'),
    experimentRevisions: byId('experiment-revisions'),
    sceneButtons: byId('lab-catalog'),
    sceneTitle: byId('scene-title'),
    sceneSubtitle: byId('scene-subtitle'),
    sceneDetails: byId('scene-details'),
    sceneSearch: byId<HTMLInputElement>('scene-search'),
    categoryFilter: byId<HTMLSelectElement>('category-filter'),
    sceneSelect: byId<HTMLSelectElement>('scene-select'),
    sceneCount: byId('scene-count'),
    prevScene: byId<HTMLButtonElement>('prev-scene'),
    nextScene: byId<HTMLButtonElement>('next-scene'),
    randomScene: byId<HTMLButtonElement>('random-scene'),
    maxTour: byId<HTMLButtonElement>('max-tour'),
    showcaseSelect: byId<HTMLSelectElement>('showcase-select'),
    showcasePlay: byId<HTMLButtonElement>('showcase-play'),
    showcaseRestart: byId<HTMLButtonElement>('showcase-restart'),
    showcaseNext: byId<HTMLButtonElement>('showcase-next'),
    showcaseTitle: byId('showcase-title'),
    showcaseTagline: byId('showcase-tagline'),
    showcaseObjective: byId('showcase-objective'),
    cinematicStatus: byId('cinematic-status'),
    cinematicBeat: byId('cinematic-beat'),
    cinematicProgress: byId('cinematic-progress'),
    cinematicProgressBar: byId('cinematic-progress-bar'),
    bodyCount: byId('body-count'),
    dynamicCount: byId('dynamic-count'),
    effectCount: byId('effect-count'),
    softSystem: byId('soft-system'),
    softNodes: byId('soft-nodes'),
    softConstraints: byId('soft-constraints'),
    softBreaks: byId('soft-breaks'),
    softEnergy: byId('soft-energy'),
    materialRig: byId<HTMLDetailsElement>('material-rig'),
    materialName: byId('material-name'),
    materialTest: byId('material-test'),
    materialLoadTarget: byId<HTMLInputElement>('material-load-target'),
    materialLoadValue: byId('material-load-value'),
    materialApply: byId<HTMLButtonElement>('material-apply'),
    materialRelease: byId<HTMLButtonElement>('material-release'),
    materialCycle: byId<HTMLButtonElement>('material-cycle'),
    materialDent: byId<HTMLButtonElement>('material-dent'),
    materialLoad: byId('material-load'),
    materialStrain: byId('material-strain'),
    materialThresholds: byId('material-thresholds'),
    materialDamage: byId('material-damage'),
    materialDentDepth: byId('material-dent-depth'),
    materialResidualDent: byId('material-residual-dent'),
    materialFragments: byId('material-fragments'),
    materialFailure: byId('material-failure'),
    fps: byId('fps'),
    simMs: byId('sim-ms'),
    renderMs: byId('render-ms'),
    upload: byId('upload'),
    backend: byId('backend'),
    runtimeSeed: byId('runtime-seed'),
    runtimeSolver: byId('runtime-solver'),
    runtimeFidelity: byId('runtime-fidelity'),
    hash: byId('hash'),
    qualityStat: byId('quality-stat'),
    warning: byId('warning'),
    log: byId('test-log'),
    stress: byId<HTMLInputElement>('stress'),
    stressValue: byId('stress-value'),
    quality: byId<HTMLSelectElement>('quality'),
    speed: byId<HTMLSelectElement>('speed'),
    pause: byId<HTMLButtonElement>('pause'),
    step: byId<HTMLButtonElement>('step'),
    reset: byId<HTMLButtonElement>('reset'),
    kick: byId<HTMLButtonElement>('kick'),
    explode: byId<HTMLButtonElement>('explode'),
    projectile: byId<HTMLButtonElement>('projectile'),
    rain: byId<HTMLButtonElement>('rain'),
    debug: byId<HTMLButtonElement>('debug'),
    runTests: byId<HTMLButtonElement>('run-tests'),
    runTurboQuant: byId<HTMLButtonElement>('run-turboquant'),
    forceMagnitude: byId<HTMLInputElement>('force-magnitude'),
    forceMagnitudeValue: byId('force-magnitude-value'),
    forceRadiusLabel: byId<HTMLLabelElement>('force-radius-label'),
    forceRadius: byId<HTMLInputElement>('force-radius'),
    forceRadiusValue: byId('force-radius-value'),
    forceApply: byId<HTMLButtonElement>('force-apply'),
    liveParameterControls: byId('live-parameter-controls'),
    runPhase: byId('run-phase'),
    runId: byId('run-id'),
    simulationLimitCard: byId('simulation-limit-card'),
    simulationLimitState: byId('simulation-limit-state'),
    simulationLimitDetail: byId('simulation-limit-detail'),
    runPreflight: byId<HTMLButtonElement>('run-preflight'),
    runArm: byId<HTMLButtonElement>('run-arm'),
    runStart: byId<HTMLButtonElement>('run-start'),
    runAbort: byId<HTMLButtonElement>('run-abort'),
    runEventList: byId('run-event-list'),
    loadControlMode: byId<HTMLSelectElement>('load-control-mode'),
    loadCaseName: byId<HTMLOutputElement>('load-case-name'),
    loadCaseTarget: byId<HTMLOutputElement>('load-case-target'),
    loadCaseRate: byId<HTMLOutputElement>('load-case-rate'),
    loadCaseLimit: byId<HTMLOutputElement>('load-case-limit'),
    forceTool: byId<HTMLButtonElement>('force-tool'),
    forceReticle: byId('force-reticle'),
    viewportInstructions: byId('viewport-instructions'),
    viewportToolLabel: byId('viewport-tool-label'),
    viewportHudTitle: byId('viewport-hud-title'),
    labFilterCount: byId('lab-filter-count'),
    solverSubsteps: byId<HTMLSelectElement>('solver-substeps'),
    assemblyModel: byId('assembly-model'),
    assemblyRevision: byId('assembly-revision'),
    assemblyCoordinateSystem: byId('assembly-coordinate-system'),
    assemblyUnits: byId('assembly-units'),
    assemblyProvenance: byId('assembly-provenance'),
    assemblyViewControls: byId('assembly-view-controls'),
    assemblySelection: byId('assembly-selection'),
    assemblyClearSelection: byId<HTMLButtonElement>('assembly-clear-selection'),
    assemblyComponentList: byId('assembly-component-list'),
    assemblyDimensionList: byId('assembly-dimension-list'),
    assemblyLimitList: byId('assembly-limit-list'),
    mobileLibraryToggle: byId<HTMLButtonElement>('mobile-library-toggle'),
    mobileInspectorToggle: byId<HTMLButtonElement>('mobile-inspector-toggle'),
    captureFrame: byId<HTMLButtonElement>('capture-frame'),
    forceChart: byId<HTMLCanvasElement>('force-chart'),
    energyChart: byId<HTMLCanvasElement>('energy-chart'),
    stressChart: byId<HTMLCanvasElement>('stress-chart'),
    viewportProbeOutputs: [1, 2, 3, 4, 5].map((index) => byId<HTMLOutputElement>(`viewport-probe-p${index}`)),
  };
}

function cloneRig(value: CameraRig): CameraRig {
  return { yaw: value.yaw, pitch: value.pitch, distance: value.distance, target: [...value.target] as Vec3 };
}

function frameCameraForWorkspace(workspace: EngineeringWorkspaceId = engineeringWorkspaces?.getWorkspace() ?? 'test'): void {
  camera = cloneRig(currentScene.camera);
  if (workspace === 'test' && currentScene.materialDemoId === 'metal-square-punch-forming') {
    // Preserve the authored low three-quarter view: it exposes the press bed
    // and centered crosshead without crowding the specimen perimeter.
    return;
  }
  if (workspace !== 'correlation' && currentScene.id === 649) {
    // The membrane is horizontal at y=5.8. A higher oblique view keeps every
    // perimeter clamp and the grounded reaction legs in the same composition.
    camera.yaw = -1.10;
    camera.pitch = 0.38;
    camera.distance = 20.5;
    camera.target = [0, 5.65, 0];
    return;
  }
  if (currentLab.id === 'composite-coupon') {
    // The cantilever cell's acoustic wall is authored behind the +Z view.
    // Keep this inspection composition in every workspace so the wall cannot
    // sit between the camera and the coupon when Assembly is opened in Test.
    // The fixed clamp remains screen-left and the free-end input screen-right.
    camera.yaw = 1.42;
    camera.pitch = 0.25;
    camera.distance = 19;
    camera.target = [-1, 6, 0];
  } else if (workspace === 'correlation' && currentScene.materialDemoId === 'metal-four-point-bumper-beam') {
    // The crash-rail recipe owns a side-on test-cell composition that keeps
    // the bulkhead, progressive fold zone, and guided platen visible.
    return;
  } else if (workspace === 'correlation') {
    camera.yaw = -1.04;
    camera.pitch = 0.34;
    camera.distance = 24;
    camera.target = [0, 7, 0];
  } else if (workspace === 'test') {
    camera.yaw = -1.04;
    camera.pitch = 0.28;
    camera.distance = 20;
    camera.target = [0, 7, 0];
  }
}

function inspectionBoundsCenter(value: EngineeringBounds): Vec3 {
  return [
    (value.min[0] + value.max[0]) * 0.5,
    (value.min[1] + value.max[1]) * 0.5,
    (value.min[2] + value.max[2]) * 0.5,
  ];
}

function addEngineeringInspectionLine(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number, g: number, b: number, a = 0.92,
): void {
  engineeringInspectionLines.push({ ax, ay, az, bx, by, bz, r, g, b, a });
}

function rebuildEngineeringInspectionLines(component: EngineeringAssemblyComponent | null): void {
  engineeringInspectionLines.length = 0;
  const value = component?.bounds;
  if (!value) {
    engineeringInspectionVersion++;
    return;
  }
  const center = inspectionBoundsCenter(value);
  const half: Vec3 = [
    (value.max[0] - value.min[0]) * 0.5,
    (value.max[1] - value.min[1]) * 0.5,
    (value.max[2] - value.min[2]) * 0.5,
  ];
  for (const [a, b] of BOX_EDGES) {
    const p = BOX_CORNER_SIGNS[a];
    const q = BOX_CORNER_SIGNS[b];
    addEngineeringInspectionLine(
      center[0] + p[0] * half[0], center[1] + p[1] * half[1], center[2] + p[2] * half[2],
      center[0] + q[0] * half[0], center[1] + q[1] * half[1], center[2] + q[2] * half[2],
      1, 0.48, 0.08,
    );
  }

  // Three restrained witness dimensions make the selected scope readable as
  // engineering geometry without implying arbitrary mesh picking.
  const pad = Math.max(0.25, Math.max(half[0], half[1], half[2]) * 0.08);
  const tick = Math.max(0.12, pad * 0.42);
  const xY = value.max[1] + pad;
  const xZ = value.max[2] + pad;
  addEngineeringInspectionLine(value.min[0], xY, xZ, value.max[0], xY, xZ, 0.96, 0.68, 0.18);
  addEngineeringInspectionLine(value.min[0], xY - tick, xZ, value.min[0], xY + tick, xZ, 0.96, 0.68, 0.18);
  addEngineeringInspectionLine(value.max[0], xY - tick, xZ, value.max[0], xY + tick, xZ, 0.96, 0.68, 0.18);
  const yX = value.max[0] + pad;
  addEngineeringInspectionLine(yX, value.min[1], xZ, yX, value.max[1], xZ, 0.30, 0.90, 0.54);
  addEngineeringInspectionLine(yX - tick, value.min[1], xZ, yX + tick, value.min[1], xZ, 0.30, 0.90, 0.54);
  addEngineeringInspectionLine(yX - tick, value.max[1], xZ, yX + tick, value.max[1], xZ, 0.30, 0.90, 0.54);
  const zY = value.max[1] + pad;
  addEngineeringInspectionLine(yX, zY, value.min[2], yX, zY, value.max[2], 0.18, 0.70, 1);
  addEngineeringInspectionLine(yX, zY - tick, value.min[2], yX, zY + tick, value.min[2], 0.18, 0.70, 1);
  addEngineeringInspectionLine(yX, zY - tick, value.max[2], yX, zY + tick, value.max[2], 0.18, 0.70, 1);
  engineeringInspectionVersion++;
}

function setEngineeringInspectionComponent(component: EngineeringAssemblyComponent | null): void {
  rebuildEngineeringInspectionLines(component);
  if (component) {
    appendLog(`${component.label} selected · ${component.note}`);
  }
}

function applyEngineeringViewPreset(view: EngineeringViewId): void {
  stopCinematic(false);
  if (view === 'authored') {
    frameCameraForWorkspace();
    appendLog('Authored engineering camera restored.');
    return;
  }
  const selectedBounds = engineeringInspection.getSelectedComponent()?.bounds;
  const value = selectedBounds ?? activeEngineeringModel?.focusBounds;
  if (!value) {
    frameCameraForWorkspace();
    if (view === 'side') camera.yaw += Math.PI * 0.5;
    else if (view === 'front') camera.pitch = 0.10;
    else if (view === 'plan') camera.pitch = 1.22;
    appendLog(`${view} camera preset applied to the authored scene frame.`);
    return;
  }
  const center = inspectionBoundsCenter(value);
  const extent = Math.max(
    value.max[0] - value.min[0],
    value.max[1] - value.min[1],
    value.max[2] - value.min[2],
  );
  const distance = clamp(extent * 1.42, 7, 120);
  // Inspection views share the same unobstructed authored side as the live
  // composite workflow; using scene 799's catalog yaw would place the rear
  // acoustic wall in front of the coupon in Front/Fit views.
  const authoredYaw = currentLab.id === 'composite-coupon' ? 1.42 : currentScene.camera.yaw;
  camera.target = center;
  camera.distance = distance;
  if (view === 'front') {
    camera.yaw = authoredYaw;
    camera.pitch = 0.10;
  } else if (view === 'side') {
    camera.yaw = authoredYaw + Math.PI * 0.5;
    camera.pitch = 0.10;
  } else if (view === 'plan') {
    camera.yaw = authoredYaw;
    camera.pitch = 1.22;
    camera.distance = clamp(distance * 1.08, 7, 120);
  } else {
    camera.yaw = authoredYaw;
    camera.pitch = currentScene.camera.pitch;
  }
  appendLog(`${view} camera preset framed ${engineeringInspection.getSelectedComponent()?.label ?? activeEngineeringModel?.title ?? 'the active model'}.`);
}

function renderEngineeringInspection(): void {
  const manifest = getEngineeringModelForLab(currentLab.id);
  if (!manifest) throw new Error(`Missing engineering model manifest for '${currentLab.id}'.`);
  activeEngineeringModel = manifest;
  engineeringInspection.render(manifest);
  const stagedGroups = getEngineeringStageGroups(currentScene.id, currentScene.materialDemoId).length
    + getMaterialDemoStageGroups(currentScene.materialDemoId).length;
  if (stagedGroups > 0) {
    ui.assemblyProvenance.textContent += ` · ${stagedGroups} named presentation group${stagedGroups === 1 ? '' : 's'} indexed.`;
  }
}

function initializeEngineeringInspection(): void {
  engineeringInspection = createEngineeringInspection({
    model: ui.assemblyModel,
    revision: ui.assemblyRevision,
    coordinateSystem: ui.assemblyCoordinateSystem,
    units: ui.assemblyUnits,
    provenance: ui.assemblyProvenance,
    viewControls: ui.assemblyViewControls,
    selection: ui.assemblySelection,
    clearSelection: ui.assemblyClearSelection,
    componentList: ui.assemblyComponentList,
    dimensionList: ui.assemblyDimensionList,
    limitList: ui.assemblyLimitList,
  }, {
    onSelect: setEngineeringInspectionComponent,
    onView: applyEngineeringViewPreset,
  });
}

function setLibraryMode(mode: 'experiment' | 'labs', focus = false): void {
  const experimentActive = mode === 'experiment';
  ui.experimentNavigator.hidden = !experimentActive;
  ui.labBrowser.hidden = experimentActive;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-library-mode]')) {
    const active = button.dataset.libraryMode === mode;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus({ preventScroll: true });
  }
}

function showFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<main class="fatal"><div><p class="eyebrow">Startup fault</p><h1>Box3D WebGPU AAA Lab did not start</h1><p>${escapeHtml(message)}</p></div></main>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setLog(message: string): void {
  ui.log.textContent = message;
}

function appendLog(message: string): void {
  const next = `${ui.log.textContent}\n${message}`.trim().split('\n').slice(-36).join('\n');
  ui.log.textContent = next;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function visibleWorkbenchLabs(): readonly WorkbenchLabDefinition[] {
  const query = ui.sceneSearch.value.trim().toLowerCase();
  const group = ui.categoryFilter.value === 'all'
    ? undefined
    : ui.categoryFilter.value as WorkbenchGroup;
  return filterWorkbenchLabs({
    group,
    query,
  });
}

function buildSceneBrowser(): void {
  ui.categoryFilter.innerHTML = '<option value="all">All systems</option>';
  for (const category of WORKBENCH_GROUPS) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = WORKBENCH_GROUP_LABELS[category];
    ui.categoryFilter.appendChild(option);
  }
  renderSceneBrowser();
}

function renderSceneBrowser(): void {
  const labs = visibleWorkbenchLabs();
  ui.sceneButtons.setAttribute('aria-busy', 'false');
  ui.sceneSelect.innerHTML = '';
  ui.sceneSelect.disabled = labs.length === 0;
  for (const lab of labs) {
    const option = document.createElement('option');
    option.value = lab.id;
    option.textContent = `${String(WORKBENCH_LABS.indexOf(lab as typeof WORKBENCH_LABS[number]) + 1).padStart(2, '0')} · ${lab.title}`;
    option.selected = lab.id === currentLab.id;
    ui.sceneSelect.appendChild(option);
  }

  ui.sceneButtons.innerHTML = '';
  const groupBadge: Record<WorkbenchGroup, string> = {
    materials: 'MAT', cloth: 'CLOTH', rope: 'ROPE', water: 'WATER', rigid: 'RIGID', combined: 'APEX',
  };
  for (const lab of labs) {
    const ordinal = WORKBENCH_LABS.indexOf(lab as typeof WORKBENCH_LABS[number]) + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.labId = lab.id;
    button.dataset.labCategory = lab.group;
    button.title = `${lab.description} ${lab.fidelity}.`;
    button.className = lab.id === currentLab.id ? 'lab-card active' : 'lab-card';
    button.setAttribute('aria-pressed', String(lab.id === currentLab.id));
    button.innerHTML = `
      <span class="lab-index">${String(ordinal).padStart(2, '0')}</span>
      <span class="lab-copy"><strong>${escapeHtml(lab.shortName)}</strong><span>${escapeHtml(WORKBENCH_SOLVER_LABELS[lab.solver])}</span></span>
      <span class="lab-kind">${groupBadge[lab.group]}</span>`;
    button.addEventListener('click', () => loadWorkbenchLab(lab));
    ui.sceneButtons.appendChild(button);
  }
  if (labs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'catalog-empty';
    empty.textContent = 'No laboratories match this filter. Clear search or choose another system.';
    ui.sceneButtons.appendChild(empty);
  }
  ui.sceneCount.textContent = `${labs.length}/${WORKBENCH_LABS.length}`;
  ui.labFilterCount.textContent = `${labs.length} shown`;
}

function buildShowcaseBrowser(): void {
  ui.showcaseSelect.innerHTML = '';
  for (const showcase of AAA_SHOWCASES) {
    const option = document.createElement('option');
    option.value = showcase.id;
    const signature = AAA_SIGNATURE_SHOWCASES.includes(showcase) ? '★ ' : '';
    option.textContent = `${signature}${String(AAA_SHOWCASES.indexOf(showcase) + 1).padStart(2, '0')} · ${showcase.title}`;
    ui.showcaseSelect.appendChild(option);
  }
  selectShowcase(activeShowcase, false);
}

function selectShowcase(showcase: AAAShowcase, load = false): void {
  activeShowcase = showcase;
  showcaseOrdinal = Math.max(0, AAA_SHOWCASES.indexOf(showcase));
  ui.showcaseSelect.value = showcase.id;
  ui.showcaseTitle.textContent = showcase.title;
  ui.showcaseTagline.textContent = showcase.tagline;
  ui.showcaseObjective.textContent = showcase.objective;
  ui.cinematicProgress.textContent = `0.0 / ${showcase.duration.toFixed(1)} s`;
  ui.cinematicProgressBar.style.width = '0%';
  ui.cinematicBeat.textContent = 'Ready for director playback.';
  if (load) startShowcase(showcase);
}

function updateSceneText(): void {
  const matchedLab = findWorkbenchLabForScene(currentScene);
  ui.sceneTitle.textContent = matchedLab?.title ?? currentScene.title;
  ui.sceneSubtitle.textContent = matchedLab?.description ?? currentScene.subtitle;
  ui.sceneDetails.textContent = matchedLab
    ? `${WORKBENCH_SOLVER_LABELS[matchedLab.solver]} · ${matchedLab.fidelity}`
    : currentScene.details;
  ui.viewportHudTitle.textContent = matchedLab?.shortName ?? currentScene.title;
  ui.stressValue.textContent = `${ui.stress.value}×`;
  for (const child of Array.from(ui.sceneButtons.children)) {
    const button = child as HTMLButtonElement;
    const active = button.dataset.labId === matchedLab?.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  ui.sceneSelect.value = matchedLab?.id ?? '';
  if (matchedLab) {
    ui.experimentTitle.textContent = matchedLab.shortName;
    ui.experimentModel.textContent = `${matchedLab.fidelity} · deterministic ${WORKBENCH_SOLVER_LABELS[matchedLab.solver].toLowerCase()}`;
    ui.treeModelName.textContent = WORKBENCH_SOLVER_LABELS[matchedLab.solver];
    ui.runtimeSeed.textContent = `0x${seed.toString(16)}`;
    ui.runtimeSolver.textContent = WORKBENCH_SOLVER_LABELS[matchedLab.solver];
    ui.runtimeFidelity.textContent = matchedLab.fidelity;
    ui.loadCaseName.value = `${matchedLab.id.replaceAll('-', '_').toUpperCase()}-R${Math.max(1, engineeringRunOrdinal)}`;
    const modes = matchedLab.forceModes;
    ui.loadControlMode.value = modes.includes('actuator-load')
      ? 'actuator'
      : modes.includes('material-strike') || modes.includes('radial-blast')
        ? 'point'
        : modes.includes('broad-impulse')
          ? 'impulse'
          : 'projectile';
  }
  syncLabCapabilities(matchedLab);
}

function labSupports(mode: WorkbenchForceMode, lab: WorkbenchLabDefinition | null = currentLab): boolean {
  return lab?.forceModes.includes(mode) ?? false;
}

function syncLabCapabilities(lab: WorkbenchLabDefinition | null): void {
  const supports = (mode: WorkbenchForceMode): boolean => labSupports(mode, lab);
  const supportsPointForce = supports('material-strike') || supports('radial-blast');
  const commandsEnabled = engineeringRun?.state === 'armed'
    || engineeringRun?.state === 'running'
    || engineeringRun?.state === 'paused';
  ui.materialApply.disabled = !supports('actuator-load') || !commandsEnabled;
  ui.materialRelease.disabled = !supports('release-load') || !commandsEnabled;
  ui.materialCycle.disabled = !supports('cycle-load') || !commandsEnabled;
  ui.materialDent.disabled = !supportsPointForce || !commandsEnabled;
  ui.kick.disabled = !supports('broad-impulse') || !commandsEnabled;
  ui.explode.disabled = !supports('radial-blast') || !commandsEnabled;
  ui.projectile.disabled = !supports('projectile') || !commandsEnabled;
  ui.rain.disabled = !supports('impact-rain') || !commandsEnabled;
  ui.forceApply.disabled = !supportsPointForce || !commandsEnabled;
  ui.forceTool.disabled = !supportsPointForce;
  ui.forceApply.textContent = lab?.solver === 'material-lattice' || lab?.solver === 'combined-material'
    ? 'Apply point strike'
    : 'Apply radial force';
  ui.forceTool.title = !supportsPointForce
    ? 'This lab uses authored broad or projectile forces rather than a point-force target.'
    : 'Place a point-force target in the viewport.';
  if (!supportsPointForce && forceToolEnabled) toggleForceTool(false);
  engineeringWorkspaces?.setForceAvailable(supportsPointForce);
  if (lab) {
    configureLiveParameterControls(lab);
    configureForceControls(lab);
  }
}

function parameterValuesForLab(lab: WorkbenchLabDefinition): Map<WorkbenchParameterId, number> {
  let values = labParameterValues.get(lab.id);
  if (!values) {
    values = new Map(lab.liveParameters.map((parameter) => [parameter.id, parameter.defaultValue]));
    labParameterValues.set(lab.id, values);
  }
  return values;
}

function activeParameterValue(id: WorkbenchParameterId, fallback: number): number {
  const parameter = currentLab.liveParameters.find((candidate) => candidate.id === id);
  const value = parameterValuesForLab(currentLab).get(id);
  return Number.isFinite(value) ? clamp(value as number, parameter?.min ?? value as number, parameter?.max ?? value as number) : fallback;
}

function formatLiveParameter(parameter: WorkbenchLiveParameter, value: number): string {
  const digits = parameter.valueKind === 'integer' ? 0 : parameter.step < 0.1 ? 2 : 1;
  return `${value.toFixed(digits)} ${parameter.unit}`.trim();
}

function configureLiveParameterControls(lab: WorkbenchLabDefinition): void {
  const values = parameterValuesForLab(lab);
  const representedElsewhere = new Set<WorkbenchParameterId>([
    'actuator-target',
    'material-strike-strength',
    'material-strike-radius',
  ]);
  const parameters = lab.liveParameters.filter((parameter) => !representedElsewhere.has(parameter.id));
  ui.liveParameterControls.innerHTML = parameters.map((parameter) => {
    const value = values.get(parameter.id) ?? parameter.defaultValue;
    const inputId = `live-parameter-${parameter.id}`;
    return `<div class="parameter-card">
      <header><label for="${inputId}">${escapeHtml(parameter.label)}</label><output data-live-parameter-output="${parameter.id}">${escapeHtml(formatLiveParameter(parameter, value))}</output></header>
      <input id="${inputId}" type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${value}" data-live-parameter="${parameter.id}" aria-label="${escapeHtml(parameter.label)}" />
      <small>${escapeHtml(parameter.availability === 'wired' ? 'Live control' : 'Solver argument · now routed live')}</small>
    </div>`;
  }).join('');
  ui.liveParameterControls.hidden = parameters.length === 0;

  const timeScale = values.get('time-scale');
  if (Number.isFinite(timeScale)) {
    manualSpeed = clamp(timeScale as number, 0.05, 2);
    ui.speed.value = String(manualSpeed);
  }
  const actuator = values.get('actuator-target');
  if (Number.isFinite(actuator)) {
    ui.materialLoadTarget.value = String(actuator);
    ui.materialLoadValue.textContent = `${Math.round((actuator as number) * 100)}%`;
  }
}

function configureForceControls(lab: WorkbenchLabDefinition): void {
  if (ui.forceMagnitude.dataset.labId === lab.id) return;
  const material = lab.solver === 'material-lattice' || lab.solver === 'combined-material';
  const magnitude = lab.liveParameters.find((parameter) =>
    parameter.id === (material ? 'material-strike-strength' : 'blast-strength'),
  ) ?? lab.liveParameters.find((parameter) => parameter.id === 'impulse-strength');
  const radius = lab.liveParameters.find((parameter) =>
    parameter.id === (material ? 'material-strike-radius' : 'blast-radius'),
  );

  ui.forceMagnitude.min = String(magnitude?.min ?? (material ? 0.25 : 0));
  ui.forceMagnitude.max = String(magnitude?.max ?? (material ? 2 : 40));
  ui.forceMagnitude.step = String(magnitude?.step ?? (material ? 0.05 : 1));
  const values = parameterValuesForLab(lab);
  ui.forceMagnitude.value = String(magnitude ? values.get(magnitude.id) ?? magnitude.defaultValue : material ? 1 : 22);
  ui.forceMagnitude.dataset.unit = material ? '×' : ' normalized';
  ui.forceMagnitude.dataset.labId = lab.id;
  ui.forceMagnitude.dataset.parameterId = magnitude?.id ?? '';

  ui.forceRadius.min = String(radius?.min ?? (material ? 1 : 0.5));
  ui.forceRadius.max = String(radius?.max ?? (material ? 4 : 24));
  ui.forceRadius.step = String(radius?.step ?? (material ? 0.25 : 0.5));
  ui.forceRadius.value = String(radius ? values.get(radius.id) ?? radius.defaultValue : material ? 1 : 18);
  ui.forceRadius.dataset.unit = material ? '×' : ' sim units';
  ui.forceRadius.dataset.parameterId = radius?.id ?? '';
  ui.forceRadiusLabel.textContent = material ? 'Normalized footprint' : 'Force radius (simulation units)';
  updateForceControlLabels();
}

function updateForceControlLabels(): void {
  const magnitude = Number(ui.forceMagnitude.value);
  const radius = Number(ui.forceRadius.value);
  const magnitudeText = `${magnitude.toFixed(magnitude < 10 ? 2 : 1)}${ui.forceMagnitude.dataset.unit ?? '×'}`;
  const radiusText = `${radius.toFixed(radius < 10 ? 2 : 1)}${ui.forceRadius.dataset.unit ?? '×'}`;
  ui.forceMagnitudeValue.textContent = magnitudeText;
  ui.forceRadiusValue.textContent = radiusText;
  ui.forceMagnitude.setAttribute('aria-valuenow', String(magnitude));
  ui.forceMagnitude.setAttribute('aria-valuetext', magnitudeText);
  ui.forceRadius.setAttribute('aria-valuenow', String(radius));
  ui.forceRadius.setAttribute('aria-valuetext', radiusText);
  ui.loadCaseTarget.value = ui.loadControlMode.value === 'actuator'
    ? `${Math.round(Number(ui.materialLoadTarget.value) * 100)}% reference load`
    : magnitudeText;
  ui.loadCaseRate.value = `${manualSpeed.toFixed(2)} × model time`;
}

function findWorkbenchLabForScene(scene: ScenePreset): WorkbenchLabDefinition | null {
  if (scene.materialDemoId) {
    const boundLabId = getMaterialDemoConceptBinding(scene.materialDemoId)?.labId;
    const boundLab = boundLabId ? getWorkbenchLab(boundLabId) : null;
    if (boundLab) return boundLab;
    return WORKBENCH_LABS.find((lab) => workbenchMaterialId(lab) === scene.materialDemoId) ?? null;
  }
  return WORKBENCH_LABS.find((lab) => {
    const sceneId = 'sceneId' in lab ? lab.sceneId : undefined;
    return sceneId === scene.id;
  }) ?? null;
}

function loadWorkbenchLab(lab: WorkbenchLabDefinition): void {
  const screen = conceptScreenForWorkbenchLab(lab);
  if (workspaceSwitchBlocked(ENGINEERING_CONCEPT_VIEWS[screen].workspace)) return;
  currentLab = lab;
  if (ENGINEERING_CONCEPT_VIEWS[screen].workspace === 'test') testWorkspaceLabId = lab.id;
  const url = new URL(window.location.href);
  url.searchParams.set('lab', lab.id);
  window.history.replaceState(null, '', url);
  const recipe = getMaterialDemoRecipe(workbenchMaterialId(lab) ?? undefined);
  forceTargetU = recipe?.strikeCenter[0] ?? 0.5;
  forceTargetV = recipe ? 1 - recipe.strikeCenter[1] : 0.5;
  updateForceReticle();
  loadScene(resolveWorkbenchLabScene(lab));
  applyConceptScreen(screen);
  frameCameraForWorkspace(ENGINEERING_CONCEPT_VIEWS[screen].workspace);
  engineeringWorkspaces?.setProvenance('solver', `${lab.fidelity} · normalized model`);
  syncActiveLabChrome();
  if (engineeringWorkspaces) {
    for (const label of engineeringWorkspaces.root.querySelectorAll<HTMLElement>('[data-eng-test]')) {
      label.textContent = lab.shortName.toUpperCase();
    }
    refreshModalCaptureUi();
  }
  ui.libraryPanel.classList.remove('mobile-open');
  ui.mobileLibraryToggle.setAttribute('aria-expanded', 'false');
}

function resetTelemetryTraces(): void {
  forceHistory.length = 0;
  energyHistory.length = 0;
  stressHistory.length = 0;
  lastForceSignal = 0;
}

function beginEngineeringRun(stress: number): void {
  engineeringRunOrdinal++;
  engineeringSimStep = 0;
  modalPulseReleaseStep = -1;
  engineeringInputSignal = 0;
  lastPreflightChecks = [];
  engineeringRun = new EngineeringRunRecorder({
    id: `RUN-${String(engineeringRunOrdinal).padStart(3, '0')}`,
    title: currentLab.title,
    labId: currentLab.id,
    sceneId: currentScene.id,
    solver: currentLab.solver,
    fidelity: currentLab.fidelity,
    backend: backend.name,
    seed,
    stressPreset: stress,
    fixedStep: 1 / 60,
    createdAt: new Date().toISOString(),
    provenance: engineeringProvenanceForSolver(
      `${currentLab.fidelity}; normalized deterministic values from ${WORKBENCH_SOLVER_LABELS[currentLab.solver]}.`,
    ),
  });
  paused = true;
  ui.pause.textContent = 'Resume';
  updateEngineeringRunUi();
}

function engineeringPreflightChecks(): readonly EngineeringPreflightCheck[] {
  const values = parameterValuesForLab(currentLab);
  const parametersFinite = currentLab.liveParameters.every((parameter) => {
    const value = values.get(parameter.id);
    return Number.isFinite(value) && (value as number) >= parameter.min && (value as number) <= parameter.max;
  });
  const validation = soft.validate();
  return Object.freeze([
    Object.freeze({
      id: 'runtime', label: 'Runtime initialized', status: backend.bodyCount() > 0 ? 'pass' : 'fail',
      detail: backend.bodyCount() > 0 ? `${backend.name}; ${backend.bodyCount()} staged bodies.` : 'No simulation bodies are staged.',
    }),
    Object.freeze({
      id: 'parameters', label: 'Parameter envelope', status: parametersFinite ? 'pass' : 'fail',
      detail: parametersFinite ? `${currentLab.liveParameters.length} values are finite and in range.` : 'One or more live parameters are outside the declared range.',
    }),
    Object.freeze({
      id: 'solver', label: 'Solver state', status: validation.ok ? 'pass' : 'fail', detail: validation.message,
    }),
    Object.freeze({
      id: 'backend', label: 'Rigid backend provenance', status: backend.isWasm ? 'pass' : 'warning',
      detail: backend.isWasm ? 'Native Box3D WASM is active.' : 'Deterministic preview backend is active; rigid results are proxy fidelity.',
    }),
    Object.freeze({
      id: 'claims', label: 'Claim boundary', status: 'pass',
      detail: 'Results remain normalized/reduced-order until an explicit calibration or imported dataset is attached.',
    }),
  ] as EngineeringPreflightCheck[]);
}

function runPreflight(): boolean {
  if (!engineeringRun || engineeringRun.state !== 'draft') return false;
  reloadSceneWithCurrentStress();
  if (!engineeringRun || !engineeringRun.canTransition('preflight')) return false;
  lastPreflightChecks = engineeringPreflightChecks();
  engineeringRun.transition('preflight');
  engineeringRun.mark('preflight', 'Numerical preflight completed.', lastPreflightChecks.some((check) => check.status === 'fail') ? 'danger' : 'pass');
  updateEngineeringRunUi();
  return !lastPreflightChecks.some((check) => check.status === 'fail');
}

function armEngineeringRun(): void {
  if (!engineeringRun) return;
  if (engineeringRun.state === 'draft' && !runPreflight()) return;
  if (engineeringRun.state !== 'preflight') return;
  if (lastPreflightChecks.some((check) => check.status === 'fail')) return;
  engineeringRun.transition('armed');
  engineeringRun.mark('armed', 'Simulation run armed.', 'warning');
  paused = true;
  ui.pause.textContent = 'Resume';
  updateEngineeringRunUi();
}

function startEngineeringRun(): void {
  if (!engineeringRun) return;
  if (engineeringRun.state === 'running') {
    completeEngineeringRun(false);
    return;
  }
  if (engineeringRun.state !== 'armed' && engineeringRun.state !== 'paused') {
    appendLog('Run must pass preflight and be armed before starting.');
    return;
  }
  engineeringRun.transition('running');
  engineeringRun.mark('load-step', 'Run started.', 'info');
  if (engineeringRun.samples.length === 0) recordEngineeringInitialState();
  paused = false;
  ui.pause.textContent = 'Pause';
  updateEngineeringRunUi();
}

function ensureEngineeringRunArmed(): boolean {
  if (!engineeringRun) return false;
  const initial = engineeringRun.state;
  switch (initial) {
    case 'running':
    case 'paused':
    case 'armed':
      return true;
    case 'complete':
    case 'aborted':
      reloadSceneWithCurrentStress();
      break;
    case 'draft':
    case 'preflight':
      break;
    default: {
      const exhaustive: never = initial;
      throw new Error(`Unhandled engineering run state: ${String(exhaustive)}`);
    }
  }
  if (!engineeringRun) return false;
  if (engineeringRun.state === 'draft' && !runPreflight()) return false;
  if (!engineeringRun) return false;
  if (engineeringRun.state === 'preflight') armEngineeringRun();
  const state = engineeringRun?.state;
  return state === 'armed' || state === 'paused' || state === 'running';
}

function ensureEngineeringRunPlaying(): boolean {
  if (!ensureEngineeringRunArmed() || !engineeringRun) return false;
  const before = engineeringRun.state;
  if (before === 'running') return true;
  if (before === 'armed' || before === 'paused') startEngineeringRun();
  return engineeringRun !== null && engineeringRun.state === 'running';
}

function refreshRunArchiveUi(preferLatest = true): void {
  const visible = completedRunRecords.slice(-5).reverse();
  const latest = completedRunRecords.at(-1);
  const matrixRecords = completedRunRecords.slice(-5);
  correlationCaseRunIds.clear();
  matrixRecords.forEach((record, index) => correlationCaseRunIds.set(String(index + 1).padStart(2, '0'), record.runId));
  const activeStillVisible = activeCorrelationRunId
    ? matrixRecords.some((record) => record.runId === activeCorrelationRunId)
    : false;
  if (preferLatest || !activeStillVisible) activeCorrelationRunId = latest?.runId ?? null;
  const activeCaseId = Array.from(correlationCaseRunIds).find(([, runId]) => runId === activeCorrelationRunId)?.[0];
  ui.experimentRevisions.innerHTML = visible.length > 0
    ? visible.map((record, index) => `<div class="revision-row"><span>R${completedRunRecords.length - index}</span><strong>${escapeHtml(record.runId)} · ${record.samples.timeS.length} samples</strong></div>`).join('')
    : '<div class="revision-row"><span>R1</span><strong>Active definition</strong></div><div class="revision-row"><span>—</span><strong>No completed run yet</strong></div>';
  engineeringWorkspaces?.setCorrelationCases(
    matrixRecords.map((record, index) => ({
      id: String(index + 1).padStart(2, '0'),
      speed: Number(record.parameters['actuator-target'] ?? record.parameters['material-strike-strength'] ?? 1),
      angle: 0,
      status: 'pending',
      note: `${record.runId} · ${record.lab.title} · unreviewed reduced-model run`,
    })),
    activeCaseId,
  );
  for (const title of document.querySelectorAll<HTMLElement>('[data-eng-correlation-title]')) {
    title.textContent = latest ? `${latest.runId} · ${latest.lab.title}` : 'NO ARCHIVED RUN';
  }
  refreshCorrelationAnalysis();
  syncCorrelationWorkSnapshot();
}

function refreshModalCaptureUi(): void {
  engineeringWorkspaces?.updateModalCaptures(
    modalCaptureRecords.filter((capture) => capture.labId === currentLab.id).slice(-6),
  );
}

function archiveCompletedRunFrame(record: RunRecordV1): void {
  ui.canvas.toBlob((blob) => {
    if (!blob) return;
    const previous = completedRunFrameUrls.get(record.runId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(blob);
    if (!completedRunRecords.some((candidate) => candidate.runId === record.runId)) {
      URL.revokeObjectURL(url);
      return;
    }
    completedRunFrameUrls.set(record.runId, url);
    if (completedRunRecords[0]?.runId === record.runId) {
      if (completedReferenceUrl && completedReferenceUrl !== url) URL.revokeObjectURL(completedReferenceUrl);
      completedReferenceUrl = url;
      engineeringWorkspaces?.setCorrelationReference({
        kind: 'image',
        src: url,
        label: `${record.runId} deterministic solver checkpoint`,
        provenance: 'deterministic',
      });
    }
    syncCorrelationWorkSnapshot();
  }, 'image/png');
}

function syncCorrelationWorkSnapshot(): void {
  if (!engineeringWorkspaces) return;
  const baselineId = completedRunRecords[0]?.runId;
  const work = completedRunRecords.find((record) => record.runId === activeCorrelationRunId);
  const url = work && work.runId !== baselineId ? completedRunFrameUrls.get(work.runId) : undefined;
  engineeringWorkspaces.setCorrelationWorkSnapshot(url && work ? {
    kind: 'image',
    src: url,
    label: `${work.runId} immutable solver checkpoint`,
    provenance: 'deterministic',
  } : null);
}

function modalCaptureQuality(record: RunRecordV1): { readonly accepted: boolean; readonly reason: string } {
  const load = record.samples.values.load ?? [];
  const response = record.samples.values.response ?? [];
  const breaks = record.samples.values['broken-count'] ?? [];
  if (record.samples.timeS.length < 64) return { accepted: false, reason: 'fewer than 64 fixed-step samples' };
  if (![...record.samples.timeS, ...load, ...response, ...breaks].every((value) => value === null || Number.isFinite(value))) {
    return { accepted: false, reason: 'non-finite sample detected' };
  }
  if (Math.max(0, ...load.map((value) => value ?? 0)) < 0.01) return { accepted: false, reason: 'normalized input was too weak' };
  const finiteResponse = response.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finiteResponse.length < 64 || Math.max(...finiteResponse) - Math.min(...finiteResponse) < 1e-8) {
    return { accepted: false, reason: 'response did not clear the numerical noise floor' };
  }
  const baselineBreaks = breaks[0] ?? 0;
  if (Math.max(baselineBreaks, ...breaks.map((value) => value ?? baselineBreaks)) > baselineBreaks) {
    return { accepted: false, reason: 'new damage or broken constraints detected' };
  }
  return { accepted: true, reason: 'length, finite-sample, excitation, response, and no-damage checks passed' };
}

function completeEngineeringRun(reviewModalCapture = false): void {
  if (!engineeringRun || !engineeringRun.canTransition('complete')) return;
  engineeringRun.mark('complete', 'Run completed and frozen for comparison.', 'pass');
  engineeringRun.transition('complete');
  paused = true;
  toggleForceTool(false);
  ui.pause.textContent = 'Resume';
  const record = runRecordV1();
  if (record) {
    completedRunRecords.push(record);
    if (completedRunRecords.length > 12) {
      const removed = completedRunRecords.splice(1, 1)[0];
      const removedUrl = removed ? completedRunFrameUrls.get(removed.runId) : undefined;
      if (removedUrl) URL.revokeObjectURL(removedUrl);
      if (removed) completedRunFrameUrls.delete(removed.runId);
    }
    archiveCompletedRunFrame(record);
    refreshRunArchiveUi(!reviewModalCapture);
    if (reviewModalCapture && MODAL_ELIGIBLE_LAB_IDS.has(currentLab.id)) {
      const qualityResult = modalCaptureQuality(record);
      modalCaptureRecords.push({
        id: record.runId,
        labId: currentLab.id,
        label: `${record.runId} · ${qualityResult.reason}`,
        sampleCount: record.samples.timeS.length,
        status: qualityResult.accepted ? 'accepted' : 'rejected',
      });
      if (modalCaptureRecords.length > 36) modalCaptureRecords.shift();
      refreshModalCaptureUi();
    }
  }
  updateEngineeringRunUi();
  appendLog(`${engineeringRun.descriptor.id} completed with ${engineeringRun.samples.length} recorded samples and frozen for deterministic comparison.`);
}

function abortEngineeringRun(): void {
  if (!engineeringRun || !engineeringRun.canTransition('aborted')) return;
  if (MODAL_ELIGIBLE_LAB_IDS.has(currentLab.id)) {
    modalCaptureRecords.push({
      id: engineeringRun.descriptor.id,
      labId: currentLab.id,
      label: `${engineeringRun.descriptor.id} · operator rejected`,
      sampleCount: engineeringRun.samples.length,
      status: 'rejected',
    });
    if (modalCaptureRecords.length > 36) modalCaptureRecords.shift();
    refreshModalCaptureUi();
  }
  engineeringRun.mark('abort', 'Operator abort.', 'danger');
  engineeringRun.transition('aborted');
  paused = true;
  toggleForceTool(false);
  ui.pause.textContent = 'Resume';
  updateEngineeringRunUi();
}

function markEngineeringEvent(kind: EngineeringRunEventKind, label: string, severity: 'info' | 'pass' | 'warning' | 'danger' = 'info'): void {
  if (!engineeringRun || !['armed', 'running', 'paused'].includes(engineeringRun.state)) return;
  engineeringRun.mark(kind, label, severity);
  updateEngineeringRunUi();
}

function updateEngineeringWorkflowStrip(state: EngineeringRunState): void {
  type StageState = 'not-run' | 'active' | 'complete' | 'blocked' | 'unavailable';
  const stageStates: Record<string, StageState> = {
    define: state === 'draft' ? 'active' : 'complete',
    preflight: 'not-run',
    execute: 'not-run',
    check: 'not-run',
    compare: 'unavailable',
    archive: 'not-run',
  };
  if (state === 'preflight') stageStates.preflight = 'active';
  if (state === 'armed' || state === 'running' || state === 'paused') {
    stageStates.preflight = 'complete';
    stageStates.execute = 'active';
  }
  if (state === 'complete') {
    stageStates.preflight = 'complete';
    stageStates.execute = 'complete';
    stageStates.check = 'complete';
    const comparableRuns = completedRunRecords.filter((record) => record.lab.id === currentLab.id);
    stageStates.compare = comparableRuns.length >= 2 ? 'complete' : 'unavailable';
    stageStates.archive = engineeringRun && completedRunRecords.some((record) => record.runId === engineeringRun?.descriptor.id)
      ? 'complete'
      : 'active';
  }
  if (state === 'aborted') {
    stageStates.preflight = lastPreflightChecks.length > 0 ? 'complete' : 'not-run';
    stageStates.execute = 'blocked';
    stageStates.check = 'unavailable';
    stageStates.compare = 'unavailable';
    stageStates.archive = 'unavailable';
  }
  for (const item of document.querySelectorAll<HTMLElement>('[data-run-stage]')) {
    const stage = item.dataset.runStage ?? '';
    const value = stageStates[stage] ?? 'unavailable';
    item.dataset.state = value;
    if (value === 'active') item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.setAttribute('aria-label', `${item.textContent?.trim() ?? stage}: ${value.replace('-', ' ')}`);
  }
}

function updateEngineeringRunUi(): void {
  if (!engineeringRun) return;
  const state = engineeringRun.state;
  updateEngineeringWorkflowStrip(state);
  ui.runPhase.textContent = state;
  ui.runId.textContent = engineeringRun.descriptor.id;
  ui.runPreflight.disabled = state !== 'draft';
  ui.runArm.disabled = state !== 'draft' && state !== 'preflight';
  ui.runStart.disabled = state !== 'armed' && state !== 'paused' && state !== 'running';
  ui.runStart.innerHTML = state === 'running'
    ? '<i class="ph ph-check-square" aria-hidden="true"></i> Complete'
    : state === 'paused'
    ? '<i class="ph ph-play" aria-hidden="true"></i> Resume'
    : '<i class="ph ph-play" aria-hidden="true"></i> Run';
  ui.runAbort.disabled = !engineeringRun.canTransition('aborted');
  ui.pause.disabled = state !== 'running' && state !== 'paused';
  ui.step.disabled = state !== 'paused';
  const failed = lastPreflightChecks.filter((check) => check.status === 'fail');
  const warnings = lastPreflightChecks.filter((check) => check.status === 'warning');
  ui.simulationLimitCard.classList.toggle('danger', failed.length > 0 || state === 'aborted');
  ui.simulationLimitCard.classList.toggle('warning', failed.length === 0 && (warnings.length > 0 || state === 'armed'));
  if (state === 'aborted') {
    ui.simulationLimitState.textContent = 'Simulation aborted';
    ui.simulationLimitDetail.textContent = 'The model clock is paused. Reset to create a clean run record.';
  } else if (failed.length > 0) {
    ui.simulationLimitState.textContent = `${failed.length} preflight failure${failed.length === 1 ? '' : 's'}`;
    ui.simulationLimitDetail.textContent = failed.map((check) => check.label).join(' · ');
  } else if (lastPreflightChecks.length > 0) {
    ui.simulationLimitState.textContent = warnings.length > 0 ? 'Ready with provenance warning' : 'Within model limits';
    ui.simulationLimitDetail.textContent = warnings[0]?.detail ?? 'All numerical checks passed; this is not a hardware safety interlock.';
  } else {
    ui.simulationLimitState.textContent = 'Model limits ready';
    ui.simulationLimitDetail.textContent = 'Run preflight before arming the reduced-order simulation.';
  }
  ui.loadCaseLimit.value = failed.length > 0
    ? `${failed.length} unresolved`
    : state === 'complete'
      ? 'Completed · frozen'
      : lastPreflightChecks.length > 0
        ? 'Within model envelope'
        : 'Preflight required';
  ui.loadCaseLimit.classList.toggle('model-limit', failed.length === 0);
  const solutionHeader = ui.experimentNavigator.querySelector<HTMLElement>('.tree-group:last-of-type > header');
  if (solutionHeader) {
    const label = solutionHeader.querySelector<HTMLElement>('span');
    const icon = solutionHeader.querySelector<HTMLElement>('.tree-state');
    if (label) label.textContent = state === 'complete' ? 'Results' : state === 'running' ? 'Solution · running' : 'Solution';
    if (icon) {
      icon.className = `ph ${state === 'complete' ? 'ph-check-circle' : state === 'running' ? 'ph-spinner-gap' : state === 'aborted' ? 'ph-x-circle' : 'ph-circle-dashed'} tree-state`;
      icon.setAttribute('aria-label', state === 'complete' ? 'Complete' : state);
    }
  }
  const events = engineeringRun.events.slice(-6).reverse();
  ui.runEventList.innerHTML = events.length > 0
    ? events.map((event) => `<span>${event.time.toFixed(3)}s · ${escapeHtml(event.label)}</span>`).join('')
    : '<span>Waiting for preflight.</span>';
  const lifecycleState = state === 'draft' ? 'idle' : state === 'complete' ? 'complete' : state;
  engineeringWorkspaces?.updateRunLifecycle({
    state: lifecycleState,
    elapsedSeconds: engineeringRun.samples.at(-1)?.time ?? 0,
    step: engineeringRun.samples.at(-1)?.step ?? 0,
    frame: engineeringSimStep,
    message: state === 'armed'
      ? 'Ready for reduced-model input'
      : state === 'aborted'
        ? 'Simulation aborted; reset for a clean run'
        : `${currentLab.shortName} · ${currentLab.fidelity}`,
  });
  syncLabCapabilities(currentLab);
}

function setCorrelationScoreStatus(status: string, score?: number): void {
  if (!engineeringWorkspaces) return;
  for (const node of engineeringWorkspaces.root.querySelectorAll<HTMLElement>('[data-eng-score-status]')) node.textContent = status;
  for (const node of engineeringWorkspaces.root.querySelectorAll<HTMLElement>('[data-eng-value="correlation"]')) {
    node.textContent = score === undefined ? '—' : score.toFixed(1);
  }
}

function refreshCorrelationAnalysis(): void {
  if (!engineeringWorkspaces) return;
  const baseline = completedRunRecords[0];
  const work = completedRunRecords.find((record) => record.runId === activeCorrelationRunId);
  if (!baseline || !work || work.runId === baseline.runId) {
    setCorrelationScoreStatus(baseline ? 'SELECT A WORK REVISION' : 'WORK RUN REQUIRED');
    return;
  }
  const baselineChannel = baseline.channels.find((channel) => channel.id === 'response');
  const workChannel = work.channels.find((channel) => channel.id === 'response');
  if (
    baseline.lab.id !== work.lab.id
    || baseline.lab.solver !== work.lab.solver
    || !baselineChannel
    || !workChannel
    || baselineChannel.quantity !== workChannel.quantity
    || baselineChannel.unit !== workChannel.unit
  ) {
    setCorrelationScoreStatus('INCOMPATIBLE MODEL CHANNELS');
    return;
  }
  const reference = baseline.samples.values.response?.filter((value): value is number => value !== null && Number.isFinite(value)) ?? [];
  const candidate = work.samples.values.response?.filter((value): value is number => value !== null && Number.isFinite(value)) ?? [];
  if (reference.length < 3 || candidate.length < 3) {
    setCorrelationScoreStatus('INSUFFICIENT MODEL SAMPLES');
    return;
  }
  const result = correlateEngineeringSeries(reference, candidate, {
    maximumShiftSamples: Math.min(24, Math.floor(Math.min(reference.length, candidate.length) * 0.1)),
    smoothingWindow: 5,
    weighting: 'uniform',
  });
  const x = result.reference.map((_, index) => index);
  engineeringWorkspaces.updateChart('correlation-force', {
    x,
    xLabel: 'aligned fixed-step sample',
    yLabel: `${baselineChannel.quantity} (${baselineChannel.unit})`,
    series: [
      { id: 'reference', label: `${baseline.runId} immutable baseline`, values: result.reference, color: '#20c8f4' },
      { id: 'candidate', label: `${work.runId} work revision`, values: result.candidate, color: '#9b55f5' },
    ],
  });
  engineeringWorkspaces.updateChart('correlation-residual', {
    x,
    xLabel: 'aligned fixed-step sample',
    yLabel: 'work − reference',
    series: [{ id: 'residual', label: 'Model residual', values: result.residual, color: '#f1f3f2' }],
  });
  const energy = work.samples.values.energy ?? work.samples.values.response;
  engineeringWorkspaces.updateChart('correlation-energy', {
    x: work.samples.timeS,
    xLabel: 'model time (s)',
    yLabel: work.samples.values.energy ? 'normalized energy proxy' : `${workChannel.quantity} (${workChannel.unit})`,
    series: [{ id: 'energy', label: work.samples.values.energy ? 'Work energy proxy' : 'Work response', values: energy.map((value) => value ?? 0), color: '#9b55f5' }],
  });
  for (const title of engineeringWorkspaces.root.querySelectorAll<HTMLElement>('[data-eng-correlation-title]')) {
    title.textContent = `${work.runId} · ${work.lab.title}`;
  }
  setCorrelationScoreStatus('MODEL-TO-MODEL · UNREVIEWED', result.score);
}

function updateEngineeringWorkspaceTelemetry(softFrame: SoftSimulationFrame, combinedHash: number, fps?: number): void {
  if (!engineeringWorkspaces) return;
  const material = softFrame.material;
  const latest = engineeringRun?.samples.at(-1);
  const inputValue = currentLab.id === 'composite-coupon'
    ? latest?.load ?? 0
    : material?.loadProgress ?? clamp(lastForceSignal / 100, 0, 1);
  const responseValue = material?.probeResponse ?? material?.centerDeflection ?? latest?.response ?? 0;
  const damageValue = material?.maxStrain ?? softFrame.brokenCount;
  ui.experimentChannelInput.value = `${inputValue.toFixed(3)} normalized`;
  ui.experimentChannelResponse.value = `${responseValue.toFixed(3)} model units`;
  ui.experimentChannelDamage.value = material
    ? `${damageValue.toFixed(4)} strain`
    : `${softFrame.brokenCount.toLocaleString()} breaks`;
  ui.viewportProbeOutputs.forEach((output, index) => {
    const shape = 0.64 + index * 0.09;
    output.value = (responseValue * shape).toFixed(3);
  });
  engineeringWorkspaces.updateTelemetry({
    timeSeconds: latest?.time ?? engineeringSimStep / 60,
    step: latest?.step ?? engineeringSimStep,
    frame: engineeringSimStep,
    force: { value: inputValue, unit: 'normalized', precision: 3 },
    displacement: { value: responseValue, unit: 'model units', precision: 3 },
    strainX: { value: material?.maxStrain ?? 0, unit: 'strain', precision: 4 },
    strainY: { value: material?.peakDamage ?? 0, unit: 'damage', precision: 3 },
    strainXY: { value: softFrame.brokenCount, unit: 'breaks', precision: 0 },
    energy: { value: softFrame.energy, unit: 'normalized', precision: 3 },
    residual: { value: material?.residualDent ?? 0, unit: 'sim units', precision: 3 },
    backend: backend.name,
    seed: `0x${seed.toString(16)}`,
    convergence: `hash ${combinedHash.toString(16).padStart(8, '0')}`,
    ...(fps !== undefined && Number.isFinite(fps) ? { fps } : {}),
    channels: [
      { id: 'force-sim', value: inputValue, unit: 'normalized', status: 'nominal' },
      { id: 'displacement', value: responseValue.toFixed(3), unit: 'model units', status: 'nominal' },
      { id: 'energy', value: softFrame.energy.toFixed(3), unit: 'normalized', status: 'nominal' },
      { id: 'elastic-energy', value: (material?.elasticEnergy ?? 0).toFixed(3), unit: 'normalized', status: 'nominal' },
      { id: 'plastic-work', value: (material?.plasticWork ?? 0).toFixed(3), unit: 'normalized', status: 'nominal' },
      { id: 'damping-work', value: (material?.dampingWork ?? 0).toFixed(3), unit: 'normalized', status: 'nominal' },
      { id: 'contact-work', value: (material?.contactWork ?? 0).toFixed(3), unit: 'normalized', status: 'nominal' },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `a${index + 1}`,
        value: `${((latest?.response ?? softFrame.energy) * (0.72 + index * 0.07)).toFixed(2)}×`,
      })),
    ],
  });

  const samples = engineeringRun?.samples ?? [];
  if (samples.length >= 64) {
    const modal = estimateReducedModalResponse(samples, engineeringProvenanceForSolver('Reduced response spectrum from the active deterministic run.'));
    if (modal) {
      const modalChart: EngineeringChartUpdate = {
        x: modal.bins.map((bin) => bin.frequency),
        xLabel: 'model Hz',
        yLabel: 'relative amplitude (dB)',
        cursorX: modal.dominantFrequency,
        series: [{ id: 'response', label: 'Single-channel output spectrum', values: modal.bins.map((bin) => bin.amplitudeDb), color: '#20c8f4' }],
      };
      engineeringWorkspaces.updateChart('field-frequency-response', modalChart);
      engineeringWorkspaces.updateChart('field-coherence', {
        x: modal.bins.map((bin) => bin.frequency),
        xLabel: 'model Hz',
        yLabel: 'relative spectral amplitude',
        yDomain: [0, 1],
        series: [{ id: 'relative-amplitude', label: 'Relative spectral amplitude', values: modal.bins.map((bin) => bin.relativePower), color: '#20c8f4' }],
      });
      engineeringWorkspaces.updateTelemetry({
        frequencyHz: modal.dominantFrequency,
        dampingPercent: modal.dampingRatio * 100,
        coherence: modal.spectralConfidence,
      });
    }
  }
}

function isImpactStyleMaterialRecipe(
  recipe: NonNullable<ReturnType<typeof getMaterialDemoRecipe>>,
): boolean {
  switch (recipe.labGroup) {
    case 'impact':
      return true;
    case 'structural':
    case 'fluid':
    case 'soft-body':
    case 'cloth':
      return false;
    default: {
      const exhaustive: never = recipe.labGroup;
      return exhaustive;
    }
  }
}

function recipeUsesActuatorAutoplay(
  recipe: NonNullable<ReturnType<typeof getMaterialDemoRecipe>>,
): boolean {
  if (recipe.kind === 'combined') return false;
  if (recipe.holdThenUnloadSeconds !== undefined && recipe.holdThenUnloadSeconds > 0) return true;
  return !isImpactStyleMaterialRecipe(recipe);
}

function applyDefaultImpactExcitation(): void {
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  if (!recipe || !isImpactStyleMaterialRecipe(recipe)) return;
  forceTargetU = recipe.strikeCenter[0];
  forceTargetV = 1 - recipe.strikeCenter[1];
  updateForceReticle();
  if (labSupports('actuator-load')) {
    ui.materialLoadTarget.value = String(clamp(recipe.primaryLoad, 0, 2));
    applyMaterialLoad();
  }
  if (labSupports('material-strike')) {
    const target = recipe.kind === 'combined' ? undefined : recipe.kind;
    applyMaterialStrike(recipe.primaryStrike, target);
  }
}

function applyDefaultActuatorExcitation(): void {
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  if (!recipe) return;
  forceTargetU = recipe.strikeCenter[0];
  forceTargetV = 1 - recipe.strikeCenter[1];
  updateForceReticle();
  if (!labSupports('actuator-load')) return;
  ui.materialLoadTarget.value = String(clamp(recipe.primaryLoad, 0, 2));
  applyMaterialLoad();
}

function engineeringRunIsPlaying(): boolean {
  return engineeringRun?.state === 'running';
}

function startAutoplayPlayback(workspace: EngineeringWorkspaceId): boolean {
  if (engineeringRunIsPlaying()) return true;
  if (engineeringWorkspaces) handleEngineeringRunCommand({ workspace, command: 'run' });
  else ensureEngineeringRunPlaying();
  return engineeringRunIsPlaying();
}

function autoplayLoadedSimulation(): boolean {
  if (cinematicPlaying || autoplayingLoadedSimulation) return engineeringRunIsPlaying();
  if (!demoIntentFromSearch(window.location.search).autoplay) return false;
  if (engineeringSession && !engineeringSession.consumeAutoplayOnOpen()) {
    return engineeringRunIsPlaying();
  }
  autoplayingLoadedSimulation = true;
  try {
    const workspace = engineeringWorkspaces?.getWorkspace()
      ?? ENGINEERING_CONCEPT_VIEWS[currentConceptScreen].workspace;
    const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
    const autoplay = getWorkbenchLabAutoplay(currentLab.id);
    const action = autoplay?.defaultAction ?? 'play';
    if (recipe) {
      forceTargetU = recipe.strikeCenter[0];
      forceTargetV = 1 - recipe.strikeCenter[1];
      updateForceReticle();
    }
    switch (action) {
      case 'play':
      case 'run':
      case 'apply-force':
        break;
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
    if (!startAutoplayPlayback(workspace)) return false;
    if (workspace !== 'field') {
      if (recipe?.kind === 'combined' || (recipe && isImpactStyleMaterialRecipe(recipe))) {
        applyDefaultImpactExcitation();
      } else if (recipe && recipeUsesActuatorAutoplay(recipe)) {
        applyDefaultActuatorExcitation();
      } else if (action === 'apply-force') {
        applyWorkbenchForce();
      }
    }
    if (engineeringWorkspaces && 'setPlaybackStarted' in engineeringWorkspaces) {
      engineeringWorkspaces.setPlaybackStarted(true);
    }
    return engineeringRunIsPlaying();
  } finally {
    autoplayingLoadedSimulation = false;
  }
}

function scheduleAutoplayLoadedSimulation(): void {
  if (cinematicPlaying || autoplayingLoadedSimulation) return;
  queueMicrotask(() => {
    if (cinematicPlaying || autoplayingLoadedSimulation) return;
    autoplayLoadedSimulation();
  });
}

function loadScene(scene: ScenePreset, stressOverride?: number, keepCinematic = false): void {
  currentScene = scene;
  const matchingLab = findWorkbenchLabForScene(scene);
  if (matchingLab) currentLab = matchingLab;
  camera = cloneRig(scene.camera);
  simulationAccumulator = 0;simulationLagSeconds=0;engineTimings.reset();engineRuntime?.resetClock();
  resetTelemetryTraces();
  const stress = clampStress(stressOverride ?? scene.defaultStress);
  ui.stress.value = String(stress);
  seed = seedForScene(scene);
  effects.clear(seed ^ 0xa11ce);
  effects.setStageProps(stagePrimitivesForScene(scene));
  const count = backend.createScene(scene, stress, seed);
  soft.createScene(scene, stress, seed);
  renderer.invalidateDynamicCaches();
  renderer.uploadInstances(backend, count);
  const softFrame = soft.buildFrame(false);
  renderer.uploadRopeGrid(softFrame.ropeGrid, count);
  renderer.uploadSurface(softFrame.surface);
  beginEngineeringRun(stress);
  if (!keepCinematic) stopCinematic(false);
  renderSceneBrowser();
  updateSceneText();
  renderEngineeringInspection();
  frameCameraForWorkspace();
  updateStats(0, 0, 0, 0, 0, softFrame);
  setLog(`Loaded ${sceneLabel(scene)} · ${scene.category} · ${scene.family}/${scene.variant} · seed 0x${seed.toString(16)}.`);
  if (!keepCinematic) {
    engineeringSession?.setAutoplayOnOpen(true);
    scheduleAutoplayLoadedSimulation();
  }
}

function reloadSceneWithCurrentStress(): void {
  simulationAccumulator = 0;simulationLagSeconds=0;engineTimings.reset();engineRuntime?.resetClock();
  resetTelemetryTraces();
  effects.clear(seed ^ 0xa11ce);
  effects.setStageProps(stagePrimitivesForScene(currentScene));
  const stress = clampStress(Number(ui.stress.value));
  const count = backend.createScene(currentScene, stress, seed);
  soft.createScene(currentScene, stress, seed);
  renderer.invalidateDynamicCaches();
  renderer.uploadInstances(backend, count);
  const softFrame = soft.buildFrame(false);
  renderer.uploadRopeGrid(softFrame.ropeGrid, count);
  renderer.uploadSurface(softFrame.surface);
  beginEngineeringRun(stress);
  stopCinematic(false);
  updateSceneText();
  setLog(`Reloaded ${sceneLabel(currentScene)} at stress ${ui.stress.value}, seed 0x${seed.toString(16)}.`);
  if (!autoplayingLoadedSimulation) {
    engineeringSession?.setAutoplayOnOpen(true);
    scheduleAutoplayLoadedSimulation();
  }
}

function loadRelativeScene(delta: number): void {
  const visible = visibleWorkbenchLabs();
  if (visible.length === 0) return;
  const found = visible.findIndex((lab) => lab.id === currentLab.id);
  const currentIndex = found >= 0 ? found : (delta < 0 ? 0 : -1);
  const nextIndex = (currentIndex + delta + visible.length) % visible.length;
  loadWorkbenchLab(visible[nextIndex]);
}

function loadRandomScene(): void {
  const visible = visibleWorkbenchLabs();
  if (visible.length === 0) {
    appendLog('No matching laboratory is available for Random. Clear the current search or filter.');
    return;
  }
  const next = visible[Math.floor(Math.random() * visible.length)];
  loadWorkbenchLab(next);
}

function startShowcase(showcase: AAAShowcase): void {
  const screen = conceptScreenForOpenedShowcase(showcase);
  if (workspaceSwitchBlocked(ENGINEERING_CONCEPT_VIEWS[screen].workspace)) return;
  selectShowcase(showcase, false);
  loadScene(getShowcaseScene(showcase), showcase.recommendedStress, true);
  applyConceptScreen(screen);
  cinematicPlaying = true;
  cinematicTime = 0;
  cinematicNextBeat = 0;
  cinematicSpeed = 1;
  paused = false;
  ui.pause.textContent = 'Pause';
  ui.cinematicStatus.textContent = maxTourEnabled ? 'DIRECTOR TOUR' : 'PLAYING';
  ui.cinematicStatus.classList.add('live');
  ui.showcasePlay.textContent = 'Pause Sequence';
  appendLog(`🎬 Director playback started: ${showcase.title}.`);
}

function stopCinematic(writeLog = true): void {
  const wasPlaying = cinematicPlaying;
  cinematicPlaying = false;
  cinematicSpeed = 1;
  ui.cinematicStatus.textContent = 'READY';
  ui.cinematicStatus.classList.remove('live');
  ui.showcasePlay.textContent = 'Play Sequence';
  if (writeLog && wasPlaying) appendLog('Director playback stopped; manual camera and controls restored.');
}

function toggleShowcasePlayback(): void {
  if (paused) {
    paused = false;
    ui.pause.textContent = 'Pause';
    if (cinematicPlaying) {
      ui.cinematicStatus.textContent = maxTourEnabled ? 'DIRECTOR TOUR' : 'PLAYING';
      ui.cinematicStatus.classList.add('live');
      ui.showcasePlay.textContent = 'Pause Sequence';
      return;
    }
  }
  if (!cinematicPlaying) {
    if (cinematicTime >= activeShowcase.duration - 0.01) startShowcase(activeShowcase);
    else {
      cinematicPlaying = true;
      ui.cinematicStatus.textContent = 'PLAYING';
      ui.cinematicStatus.classList.add('live');
      ui.showcasePlay.textContent = 'Pause Sequence';
    }
  } else {
    cinematicPlaying = false;
    ui.cinematicStatus.textContent = 'PAUSED';
    ui.cinematicStatus.classList.remove('live');
    ui.showcasePlay.textContent = 'Resume Sequence';
  }
}

function toggleMaxTour(): void {
  maxTourEnabled = !maxTourEnabled;
  ui.maxTour.textContent = maxTourEnabled ? 'AAA Tour: On' : 'AAA Tour';
  ui.maxTour.classList.toggle('armed', maxTourEnabled);
  if (maxTourEnabled) {
    startShowcase(activeShowcase);
    appendLog(`🚀 AAA Director Tour enabled: all ${AAA_SHOWCASES.length} hero sequences will play automatically.`);
  }
}

function advanceShowcase(): void {
  selectShowcase(getShowcaseByOrdinal(showcaseOrdinal + 1), false);
  startShowcase(activeShowcase);
}

function executeBeat(beat: ShowcaseBeat): void {
  ui.cinematicBeat.innerHTML = `<strong>${escapeHtml(beat.label)}</strong><span>${escapeHtml(beat.detail)}</span>`;
  appendLog(`[${beat.at.toFixed(1)}s] ${beat.label}: ${beat.detail}`);
  const effectBudget = quality.effectBudget;
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  const authoredTarget = beat.target ?? (recipe && recipe.kind !== 'combined' ? recipe.kind : undefined);
  const center = beat.center ?? (recipe && authoredTarget
    ? materialDemoWorldPoint(recipe, authoredTarget)
    : [0, Math.max(2.5, camera.target[1]), 0]);

  switch (beat.action) {
    case 'kick': {
      const strength = beat.strength ?? 9;
      backend.kick(strength);
      soft.kick(strength);
      effects.spawnImpulseDust([0, 0.15, 0], strength, effectBudget);
      break;
    }
    case 'explode': {
      const strength = beat.strength ?? 18;
      const radius = beat.radius ?? 9;
      backend.explode(center[0], center[1], center[2], strength, radius);
      soft.explode(center, strength, radius);
      effects.spawnExplosion(center, strength, effectBudget);
      break;
    }
    case 'projectile':
      fireProjectile();
      break;
    case 'dent-strike':
      applyDentStrike(beat.strength ?? 1, authoredTarget ?? 'metal');
      break;
    case 'material-strike':
      applyMaterialStrike(beat.strength ?? 1, authoredTarget);
      break;
    case 'rain': {
      const count = beat.count ?? 420;
      const added = backend.spawnRain(count, 19, 26);
      const softAdded = soft.spawnRain(count, 19, 26);
      effects.spawnRainFlash([0, 16, 0], effectBudget);
      appendLog(`Storm beat added ${added}/${count} rigid bodies and ${softAdded} soft/fluid impacts.`);
      break;
    }
    case 'set-load': {
      const target = clamp(beat.strength ?? 1, 0, 2);
      if (authoredTarget) soft.setMaterialLoadTarget(authoredTarget, target);
      else soft.setLoadTarget(target);
      ui.materialLoadTarget.value = String(target);
      ui.materialLoadValue.textContent = `${Math.round(target * 100)}%`;
      break;
    }
    case 'release-load':
      if (authoredTarget) soft.releaseMaterialLoad(authoredTarget);
      else soft.releaseLoad();
      ui.materialLoadTarget.value = '0';
      ui.materialLoadValue.textContent = '0%';
      break;
    case 'slowmo':
      cinematicSpeed = 0.22;
      effects.addCameraShake(0.08);
      break;
    case 'normal-speed':
      cinematicSpeed = 1;
      break;
    case 'caption':
      break;
  }
}

function updateCinematic(deltaSeconds: number): void {
  if (!cinematicPlaying) return;
  cinematicTime += deltaSeconds;
  sampleShowcaseCameraInto(activeShowcase, cinematicTime, camera);

  while (cinematicNextBeat < activeShowcase.beats.length && activeShowcase.beats[cinematicNextBeat].at <= cinematicTime) {
    executeBeat(activeShowcase.beats[cinematicNextBeat]);
    cinematicNextBeat++;
  }

  const progress = clamp(cinematicTime / activeShowcase.duration, 0, 1);
  ui.cinematicProgress.textContent = `${Math.min(cinematicTime, activeShowcase.duration).toFixed(1)} / ${activeShowcase.duration.toFixed(1)} s`;
  ui.cinematicProgressBar.style.width = `${(progress * 100).toFixed(2)}%`;

  if (cinematicTime >= activeShowcase.duration) {
    cinematicTime = activeShowcase.duration;
    cinematicPlaying = false;
    cinematicSpeed = 1;
    ui.cinematicStatus.textContent = 'COMPLETE';
    ui.cinematicStatus.classList.remove('live');
    ui.showcasePlay.textContent = 'Replay Sequence';
    appendLog(`✅ Hero sequence complete: ${activeShowcase.title}.`);
    if (maxTourEnabled) advanceShowcase();
  }
}

function updateForceReticle(): void {
  ui.forceReticle.style.left = `${(clamp(forceTargetU, 0, 1) * 100).toFixed(3)}%`;
  ui.forceReticle.style.top = `${(clamp(forceTargetV, 0, 1) * 100).toFixed(3)}%`;
  ui.forceReticle.classList.toggle('visible', forceToolEnabled);
}

function updateForceTargetFromPointer(event: PointerEvent): void {
  const host = ui.forceReticle.parentElement ?? ui.canvas;
  const bounds = host.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  forceTargetU = clamp((event.clientX - bounds.left) / bounds.width, 0.025, 0.975);
  forceTargetV = clamp((event.clientY - bounds.top) / bounds.height, 0.025, 0.975);
  updateForceReticle();
}

function toggleForceTool(force?: boolean): void {
  const requested = force ?? !forceToolEnabled;
  forceToolEnabled = requested && !ui.forceTool.disabled;
  ui.forceTool.classList.toggle('active', forceToolEnabled);
  ui.forceTool.setAttribute('aria-pressed', String(forceToolEnabled));
  ui.forceTool.textContent = forceToolEnabled ? 'Force tool active' : 'Orbit tool active';
  ui.canvas.classList.toggle('force-tool-active', forceToolEnabled);
  ui.forceReticle.hidden = !forceToolEnabled;
  ui.viewportToolLabel.textContent = forceToolEnabled ? 'Drag to target force' : 'Drag to orbit';
  ui.viewportInstructions.textContent = forceToolEnabled
    ? 'Drag to place the normalized force target, use the mouse wheel to zoom, or switch to the orbit tool to rotate the camera.'
    : 'Drag to orbit, use the mouse wheel to zoom, or switch to the force tool to place an adjustable normalized target.';
  engineeringWorkspaces?.setPointerMode(forceToolEnabled ? 'force' : 'orbit');
  updateForceReticle();
}

function forceRayWorldPoint(): Vec3 {
  const cp = Math.cos(camera.pitch);
  const eye: Vec3 = [
    camera.target[0] + Math.cos(camera.yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(camera.pitch) * camera.distance,
    camera.target[2] + Math.sin(camera.yaw) * cp * camera.distance,
  ];
  const forward = vec3Normalize(vec3Sub(camera.target, eye));
  const right = vec3Normalize(vec3Cross(forward, [0, 1, 0]));
  const up = vec3Normalize(vec3Cross(right, forward));
  const aspect = ui.canvas.width / Math.max(1, ui.canvas.height);
  const halfFov = Math.tan((58 * Math.PI / 180) * 0.5);
  const x = (forceTargetU * 2 - 1) * aspect * halfFov;
  const y = (1 - forceTargetV * 2) * halfFov;
  const direction = vec3Normalize(vec3Add(forward, vec3Add(vec3Scale(right, x), vec3Scale(up, y))));
  const denominator = vec3Dot(direction, forward);
  const distance = denominator > 1e-5
    ? vec3Dot(vec3Sub(camera.target, eye), forward) / denominator
    : camera.distance;
  return vec3Add(eye, vec3Scale(direction, Math.max(0.5, distance)));
}

function materialTargetForPointer(recipeKind: MaterialDemoKind | null): Exclude<MaterialDemoKind, 'combined'> {
  if (recipeKind !== 'combined') {
    if (recipeKind === 'glass' || recipeKind === 'concrete') return recipeKind;
    return 'metal';
  }
  if (forceTargetU < 1 / 3) return 'metal';
  if (forceTargetU < 2 / 3) return 'glass';
  return 'concrete';
}

function materialForceWorldPoint(
  recipeKind: MaterialDemoKind | null,
  recipe = getMaterialDemoRecipe(currentScene.materialDemoId),
  target = materialTargetForPointer(recipeKind),
): Vec3 {
  const latticeV = 1 - forceTargetV;
  if (recipe?.kind === 'combined') {
    const source = getMaterialDemoRecipe(
      target === 'metal'
        ? 'metal-square-punch-forming'
        : target === 'glass'
          ? 'glass-ballistic-off-center'
          : 'concrete-flat-slab-punching',
    );
    if (source) {
      const offset = COMBINED_MATERIAL_OFFSETS[target];
      const localU = clamp(forceTargetU * 3 - (target === 'metal' ? 0 : target === 'glass' ? 1 : 2), 0, 1);
      const x = (localU - 0.5) * source.span + offset[0];
      if (target === 'glass') return [x, 7.2 + (latticeV - 0.5) * source.depth + offset[1], 0.18 + offset[2]];
      return [x, 7.1 + offset[1], (latticeV - 0.5) * source.depth + offset[2]];
    }
  }
  if (recipe) {
    const x = (forceTargetU - 0.5) * recipe.span;
    if (recipe.kind === 'glass' || recipe.orientation === 'vertical') {
      return [x, 7.2 + (latticeV - 0.5) * recipe.depth, 0.18];
    }
    return [x, 7.1, (latticeV - 0.5) * recipe.depth];
  }
  return forceRayWorldPoint();
}

function applyWorkbenchForce(): void {
  if (!ensureNumericalActionAllowed('point force')) return;
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  if (recipe && recipeUsesActuatorAutoplay(recipe) && labSupports('actuator-load')) {
    ui.materialLoadTarget.value = String(clamp(recipe.primaryLoad, 0, 2));
    applyMaterialLoad();
    return;
  }
  const supportsPointForce = labSupports('material-strike') || labSupports('radial-blast');
  if (!supportsPointForce) {
    appendLog('This lab exposes broad impulse or projectile actions instead of a targetable point force.');
    return;
  }
  if (cinematicPlaying) stopCinematic();
  const rawMagnitude = Number(ui.forceMagnitude.value);
  const rawRadius = Number(ui.forceRadius.value);

  if (soft.kind() === 'fracture') {
    const magnitude = clamp(rawMagnitude, 0.25, 2);
    const radiusScale = clamp(rawRadius, 1, 4);
    const target = materialTargetForPointer(recipe?.kind ?? null);
    const latticeU = recipe?.kind === 'combined'
      ? clamp(forceTargetU * 3 - (target === 'metal' ? 0 : target === 'glass' ? 1 : 2), 0, 1)
      : forceTargetU;
    const result = recipe?.kind === 'combined'
      ? soft.materialStrikeAtTarget(target, latticeU, 1 - forceTargetV, magnitude, radiusScale)
      : soft.materialStrikeAt(latticeU, 1 - forceTargetV, magnitude, radiusScale);
    if (result < 0) {
      appendLog('The active reduced-order material model does not expose a point strike.');
      return;
    }
    lastForceSignal = magnitude * 50;
    const impact = materialForceWorldPoint(recipe?.kind ?? null, recipe, target);
    const vertical = target === 'glass' || (recipe?.kind !== 'combined' && recipe?.orientation === 'vertical');
    const sign = recipe?.kind !== 'combined' ? recipe?.loadSign ?? -1 : -1;
    const velocity: Vec3 = vertical
      ? [0, 0, 30 * sign * magnitude]
      : [0, 30 * sign * magnitude, 0];
    if (target === 'glass') effects.spawnGlassFracture(impact, magnitude, quality.effectBudget);
    else if (target === 'concrete') effects.spawnConcreteSpall(impact, magnitude, quality.effectBudget);
    else effects.spawnMetalStrike(impact, velocity, magnitude, quality.effectBudget);
    markEngineeringEvent('impact', `Point strike · u ${latticeU.toFixed(2)} / v ${(1 - forceTargetV).toFixed(2)} / ${magnitude.toFixed(2)}×.`);
    appendLog(`Point strike applied at u=${latticeU.toFixed(2)}, v=${(1 - forceTargetV).toFixed(2)} · ${magnitude.toFixed(2)}× strength · ${radiusScale.toFixed(2)}× radius.`);
    return;
  }

  const point = forceRayWorldPoint();
  const strength = clamp(rawMagnitude, 0, 40);
  const radius = clamp(rawRadius, 0.5, 24);
  backend.explode(point[0], point[1], point[2], strength, radius);
  soft.explode(point, strength, radius);
  effects.spawnExplosion(point, strength, quality.effectBudget);
  lastForceSignal = strength / 40 * 100;
  markEngineeringEvent('impact', `Targeted radial force · ${strength.toFixed(1)} / radius ${radius.toFixed(1)}.`);
  appendLog(`Viewport force applied at [${point.map((value) => value.toFixed(1)).join(', ')}] · strength ${strength.toFixed(1)} normalized · radius ${radius.toFixed(1)} simulation units.`);
}

function applyModalExcitation(): void {
  let actuatorExcitation = false;
  const cantileverImpulse = currentLab.id === 'composite-coupon';
  if (cantileverImpulse) {
    soft.kick(1);
    engineeringInputSignal = 1;
  } else if (soft.kind() === 'fracture') {
    soft.setLoadTarget(0.08);
    modalPulseReleaseStep = engineeringSimStep + 6;
    actuatorExcitation = true;
  }
  if (!cantileverImpulse && !actuatorExcitation) soft.kick(1);
  lastForceSignal = actuatorExcitation ? 8 : 12.5;
  markEngineeringEvent(
    'impact',
    cantileverImpulse
      ? 'Cantilever response input · 1.00 normalized free-end velocity impulse.'
      : actuatorExcitation
      ? 'Bounded response input · 0.08× normalized actuator pulse over 6 fixed steps.'
      : 'Low-amplitude modal input · 1.00 normalized broad impulse.',
  );
  appendLog('Applied the dedicated bounded normalized input for this reduced response capture.');
}

function ensureNumericalActionAllowed(action: string): boolean {
  if (cinematicPlaying) return true;
  if (engineeringRun?.state === 'running' || engineeringRun?.state === 'paused' || engineeringRun?.state === 'armed') return true;
  if (ensureEngineeringRunArmed()) return true;
  appendLog(`Start an armed engineering run before applying ${action}.`);
  return false;
}

function captureCurrentFrame(): void {
  ui.canvas.toBlob((blob) => {
    if (!blob) {
      appendLog('Frame capture is unavailable on this WebGPU surface.');
      return;
    }
    const activeLab = findWorkbenchLabForScene(currentScene);
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.download = `box3d-${activeLab?.id ?? `scene-${currentScene.id}`}-${Date.now()}.png`;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    appendLog(`Captured ${activeLab?.title ?? currentScene.title} as a PNG frame.`);
  }, 'image/png');
}

function runRecordV1(): RunRecordV1 | null {
  if (!engineeringRun) return null;
  const snapshot = engineeringRun.snapshot();
  const parameterEntries = currentLab.liveParameters.map((parameter) => [
    parameter.id,
    parameterValuesForLab(currentLab).get(parameter.id) ?? parameter.defaultValue,
  ] as const);
  const parameters = Object.fromEntries(parameterEntries);
  const samples = snapshot.samples;
  const materialDemoId = workbenchMaterialId(currentLab);
  const materialResponse = currentLab.solver === 'material-lattice' || currentLab.solver === 'combined-material';
  const rigidResponse = currentLab.solver === 'box3d-rigid';
  const responseChannel = materialResponse
    ? { id: 'response', label: 'Reduced-model deflection', quantity: 'displacement' as const, unit: 'simulation-unit' as const, provenance: 'solver-native' as const, sampleRateHz: 60 }
    : rigidResponse
      ? { id: 'response', label: 'Dynamic body count response', quantity: 'count' as const, unit: 'count' as const, provenance: 'solver-native' as const, sampleRateHz: 60 }
      : { id: 'response', label: 'Normalized response energy proxy', quantity: 'energy' as const, unit: 'normalized-energy' as const, provenance: 'solver-native' as const, sampleRateHz: 60 };
  const channels = [
    { id: 'load', label: 'Normalized input load', quantity: 'load' as const, unit: 'normalized' as const, provenance: 'solver-native' as const, sampleRateHz: 60 },
    responseChannel,
    ...(!rigidResponse ? [{ id: 'energy', label: 'Normalized energy proxy', quantity: 'energy' as const, unit: 'normalized-energy' as const, provenance: 'derived' as const, sampleRateHz: 60, sourceChannelIds: ['response'] }] : []),
    ...(materialResponse ? [{ id: 'damage', label: 'Material damage diagnostic', quantity: 'damage' as const, unit: 'normalized' as const, provenance: 'solver-native' as const, sampleRateHz: 60 }] : []),
    ...(!rigidResponse ? [{ id: 'broken-count', label: 'Broken constraints', quantity: 'count' as const, unit: 'count' as const, provenance: 'solver-native' as const, sampleRateHz: 60 }] : []),
    { id: 'replay-hash', label: 'Combined deterministic replay hash', quantity: 'hash' as const, unit: 'hash' as const, provenance: 'solver-native' as const, sampleRateHz: 60 },
  ];
  const values = {
    load: samples.map((sample) => sample.load),
    response: samples.map((sample) => sample.response),
    ...(!rigidResponse ? { energy: samples.map((sample) => sample.energy) } : {}),
    ...(materialResponse ? { damage: samples.map((sample) => sample.damage) } : {}),
    ...(!rigidResponse ? { 'broken-count': samples.map((sample) => sample.brokenCount) } : {}),
    'replay-hash': samples.map((sample) => sample.hash),
  };
  return {
    schema: RUN_RECORD_SCHEMA_V1,
    runId: snapshot.id,
    createdAt: snapshot.createdAt,
    ...(['complete', 'aborted'].includes(snapshot.state) ? { completedAt: new Date().toISOString() } : {}),
    claimLevel: 'reduced-order',
    lab: {
      id: currentLab.id,
      title: currentLab.title,
      sceneId: currentScene.id,
      ...(materialDemoId ? { materialDemoId } : {}),
      solver: currentLab.solver,
      fidelity: currentLab.fidelity,
    },
    engine: {
      backend: backend.name,
      isWasm: backend.isWasm,
      buildVersion: '1.20.0',
      seed,
      fixedStepS: 1 / 60,
      substeps: solverSubSteps,
    },
    parameters,
    events: snapshot.events.map((event) => ({
      id: event.id,
      timeS: event.time,
      step: event.step,
      kind: event.kind,
      label: event.label,
    })),
    channels,
    samples: {
      timeS: samples.map((sample) => sample.time),
      values,
    },
    final: {
      backendHash: backend.replayHash(),
      softHash: soft.buildFrame(false).hash,
      warnings: [
        'Normalized comparative/reduced-order output; not calibrated FEA or certification.',
        ...(!backend.isWasm ? ['Deterministic preview rigid backend was active.'] : []),
      ],
    },
  };
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportEngineeringEvidence(): Promise<void> {
  const currentRunId = activeCorrelationRunId ?? engineeringRun?.descriptor.id;
  const record = completedRunRecords.find((candidate) => candidate.runId === currentRunId)
    ?? completedRunRecords.at(-1)
    ?? null;
  if (!record) {
    appendLog('Complete a run before exporting immutable engineering evidence.');
    return;
  }
  const result = await createEngineeringEvidenceV1(record);
  if (!result.ok) {
    appendLog(`Evidence export blocked: ${result.errors.map((issue) => issue.message).join(' ')}`);
    return;
  }
  downloadJson(result.value, `${record.runId.toLowerCase()}-${record.lab.id}.box3d-evidence.json`);
  appendLog(`Exported SHA-256 simulation evidence for ${record.runId}. This package is reproducibility evidence, not certification.`);
}

function inferCsvChannel(header: string, index: number): CsvChannelSpec {
  const normalized = header.trim().toLowerCase();
  const quantity: CsvChannelSpec['quantity'] = normalized.includes('force')
    ? 'force'
    : normalized.includes('load')
      ? 'load'
      : normalized.includes('disp')
        ? 'displacement'
        : normalized.includes('strain')
          ? 'strain'
          : normalized.includes('energy')
            ? 'energy'
            : normalized.includes('accel')
              ? 'acceleration'
              : 'other';
  return {
    column: header,
    id: `import-${String(index + 1).padStart(2, '0')}-${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel'}`,
    label: header.trim() || `Imported channel ${index + 1}`,
    quantity,
    unit: 'normalized',
    provenance: 'synthetic-demo',
  };
}

async function importCorrelationFile(file: File): Promise<void> {
  const text = await file.text();
  const json = file.name.toLowerCase().endsWith('.json');
  const result = json
    ? parseTestDatasetV1Json(text)
    : (() => {
        const header = text.split(/\r?\n/, 1)[0]?.split(',').map((value) => value.trim()) ?? [];
        const timeColumn = header.find((value) => value.toLowerCase() === 'time_s') ?? 'time_s';
        const channels = header.filter((value) => value !== timeColumn).map(inferCsvChannel);
        return parseTestDatasetCsv(text, {
          datasetId: `import-${Date.now()}`,
          title: file.name,
          timeColumn,
          channels,
          source: { kind: 'synthetic-demo', fileName: file.name, notes: 'Unverified CSV import; excluded from scoring until explicitly mapped.' },
        });
      })();
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.message).join(' '));
  importedCorrelationDataset = result.value;
  setCorrelationScoreStatus('DATASET IMPORTED · MAPPING REQUIRED');
  appendLog(`Imported ${result.value.title} with ${result.value.channels.length} channel(s). It is stored but excluded from scoring until quantity, unit, timebase, and provenance mapping are explicitly confirmed.`);
}

function handleEngineeringRunCommand(request: EngineeringRunCommandRequest): void {
  switch (request.command) {
    case 'arm':
      ensureEngineeringRunArmed();
      break;
    case 'run': {
      if (engineeringRun?.state === 'running') {
        togglePause();
        break;
      }
      const shouldExcite = request.workspace === 'field';
      const started = ensureEngineeringRunPlaying();
      if (shouldExcite && started) applyModalExcitation();
      break;
    }
    case 'pause':
      togglePause();
      break;
    case 'complete':
      if (request.workspace === 'field' && (engineeringRun?.samples.length ?? 0) < 64) {
        appendLog('Capture acceptance requires at least 64 fixed-step samples.');
        updateEngineeringRunUi();
        return;
      }
      completeEngineeringRun(true);
      break;
    case 'reset':
    case 'replay':
      reloadSceneWithCurrentStress();
      break;
    case 'abort':
      abortEngineeringRun();
      break;
    default: {
      const exhaustive: never = request.command;
      return exhaustive;
    }
  }
}

function setEngineeringWorkspace(workspace: EngineeringWorkspaceId, focus = false): void {
  engineeringWorkspaces?.setWorkspace(workspace, { focus });
  ui.app.dataset.workspace = workspace;
  for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')) {
    const active = candidate.dataset.workbenchTab === workspace;
    candidate.classList.toggle('active', active);
    candidate.setAttribute('aria-pressed', String(active));
  }
}

function initializeEngineeringWorkspaceShell(initialWorkspace: EngineeringWorkspaceId): void {
  const viewport = document.querySelector<HTMLElement>('.viewport');
  if (!viewport) throw new Error('The live simulation viewport is unavailable.');
  previousEngineeringWorkspace = initialWorkspace;
  const mount = document.getElementById(ENGINEERING_WORKSPACES_MOUNT_ID) ?? document.body;
  const sessionView = workspaceKindFromConceptViewId(currentConceptScreen);
  const sessionLabId = sessionView === 'physicsFieldModal' && currentLab.id !== 'composite-coupon'
    ? undefined
    : currentLab.id;
  const demoIntent = demoIntentFromSearch(window.location.search);
  engineeringSession = new EngineeringSession({
    view: sessionView,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    autoplayOnOpen: demoIntent.autoplay,
    ...(sessionLabId ? { labId: sessionLabId } : {}),
  });
  engineeringSession.subscribe(() => {
    if (applyingConceptScreen || syncingEngineeringSession) return;
    const viewId = conceptViewIdForSession();
    if (viewId && viewId !== currentConceptScreen) applyConceptScreen(viewId);
  });
  engineeringWorkspaces = createEngineeringWorkspaces({
    mount,
    testWorkspace: ui.app,
    viewport,
    initialWorkspace,
    initialConceptView: currentConceptScreen,
    initialLabId: currentLab.id,
    projectLabel: 'BOX3D-WEBGPU',
    testLabel: currentLab.shortName.toUpperCase(),
    autoplay: demoIntent.autoplay,
    simpleUi: demoIntent.simpleUi,
    callbacks: {
      onConceptViewChange: (view) => {
        if (applyingConceptScreen) return;
        currentConceptScreen = view;
        syncConceptScreenDataset(view);
        syncConceptScreenUrl(view);
        applyConceptLibraryMode(view);
        syncEngineeringSessionFromScreen(view);
      },
      onWorkspaceChange: (workspace) => {
        if (applyingConceptScreen) {
          previousEngineeringWorkspace = workspace;
          frameCameraForWorkspace(workspace);
          if (workspace === 'correlation') {
            refreshCorrelationAnalysis();
            syncCorrelationWorkSnapshot();
          }
          return;
        }
        const runOwnsLiveState = engineeringRun !== null
          && ['preflight', 'armed', 'running', 'paused'].includes(engineeringRun.state);
        if (workspace !== previousEngineeringWorkspace && runOwnsLiveState) {
          const retainedWorkspace = previousEngineeringWorkspace;
          const blockedMessage = `Complete or abort ${engineeringRun?.descriptor.id ?? 'the active run'} before leaving ${retainedWorkspace}. Solver state preserved.`;
          appendLog(blockedMessage);
          engineeringWorkspaces?.updateRunLifecycle({
            state: engineeringRun?.state === 'draft' ? 'idle' : engineeringRun?.state ?? 'error',
            elapsedSeconds: engineeringRun?.samples.at(-1)?.time ?? 0,
            step: engineeringRun?.samples.at(-1)?.step ?? 0,
            frame: engineeringSimStep,
            message: blockedMessage,
          });
          window.setTimeout(() => setEngineeringWorkspace(retainedWorkspace, true), 0);
          return;
        }
        if (workspace !== previousEngineeringWorkspace) {
          if (previousEngineeringWorkspace === 'test') testWorkspaceLabId = currentLab.id;
          const workspaceLabId = workspace === 'field'
            ? 'composite-coupon'
            : workspace === 'correlation'
              ? 'crash-rail-axial-fold'
              : testWorkspaceLabId;
          previousEngineeringWorkspace = workspace;
          if (currentLab.id !== workspaceLabId) {
            const workspaceLab = getWorkbenchLab(workspaceLabId);
            if (workspaceLab) {
              loadWorkbenchLab(workspaceLab);
              frameCameraForWorkspace(workspace);
              if (workspace === 'correlation') {
                refreshCorrelationAnalysis();
                syncCorrelationWorkSnapshot();
              }
              return;
            }
          }
          applyConceptScreen(conceptScreenForEngineeringWorkspace(workspace));
        }
        frameCameraForWorkspace(workspace);
        if (workspace === 'correlation') {
          refreshCorrelationAnalysis();
          syncCorrelationWorkSnapshot();
        }
      },
      onRunCommand: handleEngineeringRunCommand,
      onPlay: (detail) => {
        if (detail.alreadyStarted || engineeringRun?.state === 'running') return;
        handleEngineeringRunCommand({
          workspace: engineeringWorkspaces?.getWorkspace() ?? 'test',
          command: 'run',
        });
      },
      onCaseChange: (caseId) => {
        activeCorrelationRunId = correlationCaseRunIds.get(caseId) ?? activeCorrelationRunId;
        refreshCorrelationAnalysis();
        syncCorrelationWorkSnapshot();
        appendLog(`Correlation work revision ${activeCorrelationRunId ?? caseId} selected; the immutable baseline remains ${completedRunRecords[0]?.runId ?? 'unavailable'}.`);
      },
      onFrameSeek: (frame) => appendLog(`Correlation data cursor moved to recorded sample ${frame}; the reference image remains a final checkpoint.`),
      onFileImport: async (request) => {
        if (request.kind === 'correlation-data') await importCorrelationFile(request.file);
      },
      onEvidenceExport: exportEngineeringEvidence,
      onLabChange: (labId) => {
        loadMaterialLabSelection(labId);
      },
      onControlChange: applyMaterialLabControlChange,
      onMaterialPresetChange: (presetId) => {
        if (!isMaterialLabPresetId(presetId) || !engineeringSession) return;
        if (engineeringSession.materialPresetId !== presetId) engineeringSession.selectMaterialPreset(presetId);
      },
    },
  });
  engineeringWorkspaces.root.addEventListener('engineering-capture-request', captureCurrentFrame);
  engineeringWorkspaces.root.addEventListener('engineering-correlation-refresh', refreshCorrelationAnalysis);
  engineeringWorkspaces.root.addEventListener('engineering-orbit-request', () => frameCameraForWorkspace('field'));
  engineeringWorkspaces.root.addEventListener('engineering-apply-force', () => {
    applyWorkbenchForce();
  });
  engineeringWorkspaces.root.addEventListener('engineering-pointer-mode', (event) => {
    const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
    if (mode === 'force') toggleForceTool(true);
    else if (mode === 'orbit') toggleForceTool(false);
  });
  engineeringWorkspaces.root.addEventListener('engineering-annotation-request', () => {
    markEngineeringEvent('bookmark', `Annotation marker at model step ${engineeringSimStep}.`);
    appendLog(`Presentation annotation marker added at model step ${engineeringSimStep}.`);
  });
  for (const label of engineeringWorkspaces.root.querySelectorAll<HTMLElement>('[data-eng-test]')) {
    label.textContent = currentLab.shortName.toUpperCase();
  }
  engineeringWorkspaces.setProvenance('solver', `${currentLab.fidelity} · normalized model`);
  syncCorrelationWorkSnapshot();
  const materialLabQuery = window.matchMedia(`(max-width: ${MATERIAL_LAB_MOBILE_BREAKPOINT_PX}px)`);
  const syncMaterialLabLayout = (): void => {
    engineeringSession?.setViewportSize(window.innerWidth, window.innerHeight);
    if (currentConceptScreen !== 'material-lab-desktop' && currentConceptScreen !== 'material-lab-mobile') return;
    applyConceptScreen(materialLabLayout());
  };
  if (typeof materialLabQuery.addEventListener === 'function') {
    materialLabQuery.addEventListener('change', syncMaterialLabLayout);
  } else {
    materialLabQuery.addListener(syncMaterialLabLayout);
  }
}

function bindControls(): void {
  ui.canvas.addEventListener('pointerdown', (event) => {
    if (cinematicPlaying) stopCinematic();
    if (forceToolEnabled && event.button === 0) {
      forceDragging = true;
      updateForceTargetFromPointer(event);
      ui.canvas.setPointerCapture(event.pointerId);
      return;
    }
    isDragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    ui.canvas.setPointerCapture(event.pointerId);
  });

  ui.canvas.addEventListener('pointermove', (event) => {
    if (forceDragging) {
      updateForceTargetFromPointer(event);
      return;
    }
    if (!isDragging) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    camera.yaw -= dx * 0.006;
    camera.pitch = clamp(camera.pitch - dy * 0.0045, 0.08, 1.3);
  });

  const releasePointer = (event: PointerEvent): void => {
    isDragging = false;
    forceDragging = false;
    try { ui.canvas.releasePointerCapture(event.pointerId); } catch { /* ignored */ }
  };
  ui.canvas.addEventListener('pointerup', releasePointer);
  ui.canvas.addEventListener('pointercancel', releasePointer);

  ui.canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (cinematicPlaying) stopCinematic();
    camera.distance = clamp(camera.distance + event.deltaY * 0.018, 7, 120);
  }, { passive: false });

  const filterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lab-filter]'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-library-mode]')) {
    button.addEventListener('click', () => setLibraryMode(button.dataset.libraryMode === 'labs' ? 'labs' : 'experiment'));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'ArrowRight' || event.key === 'End' ? 'labs' : 'experiment';
      setLibraryMode(next, true);
    });
  }
  ui.browseLabs.addEventListener('click', () => setLibraryMode('labs', true));
  for (const node of document.querySelectorAll<HTMLButtonElement>('[data-experiment-node]')) {
    node.addEventListener('click', () => {
      for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-experiment-node]')) {
        candidate.setAttribute('aria-current', String(candidate === node));
      }
      const nodeId = node.dataset.experimentNode;
      const tabId = nodeId === 'solver'
        ? 'inspector-tab-solver'
        : nodeId === 'model' || nodeId === 'specimen' || nodeId === 'fixtures' || nodeId === 'provenance'
          ? 'inspector-tab-assembly'
        : nodeId === 'response' || nodeId === 'energy' || nodeId === 'damage'
          ? 'inspector-tab-material'
          : 'inspector-tab-force';
      document.getElementById(tabId)?.click();
      if (tabId === 'inspector-tab-assembly' && activeEngineeringModel) {
        const kind = nodeId === 'model'
          ? 'assembly'
          : nodeId === 'specimen'
            ? 'specimen'
            : nodeId === 'fixtures'
              ? 'fixture'
              : null;
        const component = kind
          ? activeEngineeringModel.components.find((candidate) => candidate.kind === kind) ?? null
          : null;
        engineeringInspection.selectComponent(component?.id ?? null);
      }
    });
  }
  for (const probe of document.querySelectorAll<HTMLButtonElement>('[data-probe-u][data-probe-v]')) {
    probe.addEventListener('click', () => {
      forceTargetU = clamp(Number(probe.dataset.probeU), 0, 1);
      forceTargetV = clamp(Number(probe.dataset.probeV), 0, 1);
      updateForceReticle();
      if (!forceToolEnabled && !ui.forceTool.disabled) toggleForceTool(true);
      appendLog(`${probe.getAttribute('aria-label') ?? 'Virtual probe'} selected as the normalized input target.`);
    });
  }
  const syncFilterButtons = (): void => {
    for (const button of filterButtons) {
      const active = button.dataset.labFilter === ui.categoryFilter.value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  ui.sceneSearch.addEventListener('input', renderSceneBrowser);
  ui.categoryFilter.addEventListener('change', () => {
    renderSceneBrowser();
    syncFilterButtons();
  });
  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      ui.categoryFilter.value = button.dataset.labFilter ?? 'all';
      renderSceneBrowser();
      syncFilterButtons();
    });
  }
  ui.sceneSelect.addEventListener('change', () => {
    const lab = getWorkbenchLab(ui.sceneSelect.value);
    if (lab) loadWorkbenchLab(lab);
  });
  ui.prevScene.addEventListener('click', () => loadRelativeScene(-1));
  ui.nextScene.addEventListener('click', () => loadRelativeScene(1));
  ui.randomScene.addEventListener('click', loadRandomScene);
  ui.maxTour.addEventListener('click', toggleMaxTour);

  ui.showcaseSelect.addEventListener('change', () => selectShowcase(getShowcaseById(ui.showcaseSelect.value), false));
  ui.showcasePlay.addEventListener('click', toggleShowcasePlayback);
  ui.showcaseRestart.addEventListener('click', () => startShowcase(activeShowcase));
  ui.showcaseNext.addEventListener('click', advanceShowcase);

  ui.stress.addEventListener('input', () => { ui.stressValue.textContent = `${ui.stress.value}×`; });
  ui.stress.addEventListener('change', reloadSceneWithCurrentStress);
  ui.quality.addEventListener('change', () => {
    quality = QUALITY_PROFILES[ui.quality.value as RenderQualityId] ?? QUALITY_PROFILES.cinematic;
    ui.qualityStat.textContent = quality.label;
    appendLog(`Render profile changed to ${quality.label}: exposure ${quality.exposure}, bloom ${quality.bloomStrength}, effects ${quality.effectBudget}.`);
  });
  ui.speed.addEventListener('change', () => {
    manualSpeed = clamp(Number(ui.speed.value), 0.05, 2);
    parameterValuesForLab(currentLab).set('time-scale', manualSpeed);
    const input = ui.liveParameterControls.querySelector<HTMLInputElement>('[data-live-parameter="time-scale"]');
    const output = ui.liveParameterControls.querySelector<HTMLOutputElement>('[data-live-parameter-output="time-scale"]');
    const parameter = currentLab.liveParameters.find((candidate) => candidate.id === 'time-scale');
    if (input) input.value = String(manualSpeed);
    if (output && parameter) output.value = formatLiveParameter(parameter, manualSpeed);
    updateForceControlLabels();
  });
  ui.solverSubsteps.addEventListener('change', () => {
    solverSubSteps = clamp(Math.round(Number(ui.solverSubsteps.value)), 1, 8);
    appendLog(`Solver substeps set to ${solverSubSteps}; deterministic seed is unchanged.`);
  });
  ui.forceMagnitude.addEventListener('input', () => {
    const parameterId = ui.forceMagnitude.dataset.parameterId as WorkbenchParameterId | undefined;
    if (parameterId) parameterValuesForLab(currentLab).set(parameterId, Number(ui.forceMagnitude.value));
    updateForceControlLabels();
  });
  ui.forceRadius.addEventListener('input', () => {
    const parameterId = ui.forceRadius.dataset.parameterId as WorkbenchParameterId | undefined;
    if (parameterId) parameterValuesForLab(currentLab).set(parameterId, Number(ui.forceRadius.value));
    updateForceControlLabels();
  });
  ui.loadControlMode.addEventListener('change', updateForceControlLabels);
  ui.liveParameterControls.addEventListener('input', (event) => {
    const input = event.target instanceof HTMLInputElement
      ? event.target.closest<HTMLInputElement>('[data-live-parameter]')
      : null;
    if (!input) return;
    const parameterId = input.dataset.liveParameter as WorkbenchParameterId;
    const parameter = currentLab.liveParameters.find((candidate) => candidate.id === parameterId);
    if (!parameter) return;
    const value = clamp(Number(input.value), parameter.min, parameter.max);
    parameterValuesForLab(currentLab).set(parameterId, value);
    const output = ui.liveParameterControls.querySelector<HTMLOutputElement>(`[data-live-parameter-output="${parameterId}"]`);
    if (output) output.value = formatLiveParameter(parameter, value);
    if (parameterId === 'time-scale') {
      manualSpeed = value;
      ui.speed.value = String(value);
    }
  });
  ui.forceApply.addEventListener('click', applyWorkbenchForce);
  ui.runPreflight.addEventListener('click', runPreflight);
  ui.runArm.addEventListener('click', armEngineeringRun);
  ui.runStart.addEventListener('click', startEngineeringRun);
  ui.runAbort.addEventListener('click', abortEngineeringRun);
  ui.forceTool.addEventListener('click', () => toggleForceTool());
  ui.mobileLibraryToggle.addEventListener('click', () => {
    const open = !ui.libraryPanel.classList.contains('mobile-open');
    ui.libraryPanel.classList.toggle('mobile-open', open);
    ui.inspectorPanel.classList.remove('mobile-open');
    ui.mobileLibraryToggle.setAttribute('aria-expanded', String(open));
    ui.mobileInspectorToggle.setAttribute('aria-expanded', 'false');
  });
  ui.mobileInspectorToggle.addEventListener('click', () => {
    const open = !ui.inspectorPanel.classList.contains('mobile-open');
    ui.inspectorPanel.classList.toggle('mobile-open', open);
    ui.libraryPanel.classList.remove('mobile-open');
    ui.mobileInspectorToggle.setAttribute('aria-expanded', String(open));
    ui.mobileLibraryToggle.setAttribute('aria-expanded', 'false');
  });

  const inspectorTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#inspector-tabs [role="tab"]'));
  const activateInspectorTab = (tab: HTMLButtonElement): void => {
    const targetId = tab.getAttribute('aria-controls');
    for (const candidate of inspectorTabs) {
      const active = candidate === tab;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.inspector-section')) {
      const active = panel.id === targetId;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    }
    ui.inspectorPanel.classList.add('mobile-open');
    ui.mobileInspectorToggle.setAttribute('aria-expanded', 'true');
  };
  for (const tab of inspectorTabs) {
    tab.addEventListener('click', () => activateInspectorTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = inspectorTabs.indexOf(tab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? inspectorTabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + inspectorTabs.length) % inspectorTabs.length;
      const next = inspectorTabs[nextIndex];
      activateInspectorTab(next);
      next.focus();
    });
  }

  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')) {
    tab.addEventListener('click', () => {
      const value = tab.dataset.workbenchTab as EngineeringWorkspaceId | undefined;
      if (value === 'test' || value === 'correlation' || value === 'field') setEngineeringWorkspace(value, true);
    });
  }

  ui.reset.addEventListener('click', reloadSceneWithCurrentStress);
  ui.pause.addEventListener('click', togglePause);
  ui.step.addEventListener('click', stepOnce);
  ui.kick.addEventListener('click', applyImpulse);
  ui.explode.addEventListener('click', applyExplosion);
  ui.projectile.addEventListener('click', fireProjectile);
  ui.rain.addEventListener('click', applyRain);
  ui.materialLoadTarget.addEventListener('input', () => {
    const value = Number(ui.materialLoadTarget.value);
    parameterValuesForLab(currentLab).set('actuator-target', value);
    ui.materialLoadValue.textContent = `${Math.round(value * 100)}%`;
    updateForceControlLabels();
  });
  ui.materialLoadTarget.addEventListener('change', applyMaterialLoad);
  ui.materialApply.addEventListener('click', applyMaterialLoad);
  ui.materialRelease.addEventListener('click', releaseMaterialLoad);
  ui.materialCycle.addEventListener('click', cycleMaterialLoad);
  ui.materialDent.addEventListener('click', applyWorkbenchForce);
  ui.debug.addEventListener('click', toggleDebug);
  ui.runTests.addEventListener('click', runStateTests);
  ui.runTurboQuant.addEventListener('click', runTurboQuantBrowserProbe);
  ui.captureFrame.addEventListener('click', captureCurrentFrame);

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
      (target instanceof Element && target.closest(
        'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="slider"]',
      ))
    ) return;
    const key = event.key.toLowerCase();
    if (event.code === 'Space') {
      event.preventDefault();
      if (engineeringWorkspaces) {
        if (engineeringRun?.state === 'running' || engineeringRun?.state === 'paused') togglePause();
        else ensureEngineeringRunPlaying();
      } else if (!ui.kick.disabled) {
        applyImpulse();
      }
      return;
    }
    if (key === 'r') {
      if (engineeringWorkspaces) {
        reloadSceneWithCurrentStress();
        return;
      }
      loadRandomScene();
      return;
    }
    if (key === 'p') togglePause();
    if (key === 'n') stepOnce();
    if (key === 'e' && !ui.explode.disabled) applyExplosion();
    if (key === 'f' && !ui.projectile.disabled) fireProjectile();
    if (key === 't') toggleMaxTour();
    if (key === 'c') toggleShowcasePlayback();
    if (key === 'd') toggleDebug();
    if (key === 'l' && !ui.materialApply.disabled) applyMaterialLoad();
    if (key === 'u' && !ui.materialRelease.disabled) releaseMaterialLoad();
    if (key === 'i' && !ui.forceApply.disabled) applyWorkbenchForce();
    if (key === 'm' && !ui.forceTool.disabled) toggleForceTool();
    if (event.key === 'Escape') {
      ui.libraryPanel.classList.remove('mobile-open');
      ui.inspectorPanel.classList.remove('mobile-open');
      ui.mobileLibraryToggle.setAttribute('aria-expanded', 'false');
      ui.mobileInspectorToggle.setAttribute('aria-expanded', 'false');
    }
    if (event.key === 'ArrowLeft') loadRelativeScene(-1);
    if (event.key === 'ArrowRight') loadRelativeScene(1);
    const number = Number.parseInt(event.key, 10);
    if (Number.isInteger(number) && number >= 1 && number <= 9) loadWorkbenchLab(WORKBENCH_LABS[number - 1]);
  });

  window.addEventListener('pagehide', () => { backend.destroy(); soft.destroy(); });
}

function togglePause(): void {
  if (!engineeringRun || (engineeringRun.state !== 'running' && engineeringRun.state !== 'paused')) {
    paused = true;
    ui.pause.textContent = 'Resume';
    appendLog('Run preflight and arm the model before advancing its deterministic clock.');
    return;
  }
  paused = !paused;
  ui.pause.textContent = paused ? 'Resume' : 'Pause';
  if (engineeringRun?.state === 'running' && paused) {
    engineeringRun.transition('paused');
    engineeringRun.mark('hold', 'Run paused.', 'info');
    updateEngineeringRunUi();
  } else if (engineeringRun?.state === 'paused' && !paused) {
    engineeringRun.transition('running');
    engineeringRun.mark('load-step', 'Run resumed.', 'info');
    updateEngineeringRunUi();
  }
  if (cinematicPlaying) {
    ui.cinematicStatus.textContent = paused ? 'SIMULATION PAUSED' : (maxTourEnabled ? 'DIRECTOR TOUR' : 'PLAYING');
    ui.cinematicStatus.classList.toggle('live', !paused);
    ui.showcasePlay.textContent = paused ? 'Resume Sequence' : 'Pause Sequence';
  }
}

function recordEngineeringInitialState(): void {
  if (!engineeringRun || engineeringRun.state !== 'running' || engineeringRun.samples.length > 0) return;
  const softFrame = soft.readTelemetry();
  const material = softFrame.material;
  const combinedHash = (backend.replayHash() ^ Math.imul(softFrame.hash >>> 0, 0x9e3779b1)) >>> 0;
  engineeringRun.record({
    time: 0,
    step: 0,
    load: material?.loadProgress ?? clamp(lastForceSignal / 100, 0, 1),
    response: material?.probeResponse ?? material?.centerDeflection ?? (softFrame.kind === 'none' ? backend.dynamicCount() : softFrame.energy),
    energy: softFrame.energy,
    damage: material?.peakDamage ?? 0,
    brokenCount: softFrame.brokenCount,
    hash: combinedHash,
  });
}

function recordEngineeringFixedStep(allowPaused = false): void {
  if (!engineeringRun || (engineeringRun.state !== 'running' && !(allowPaused && engineeringRun.state === 'paused'))) return;
  engineeringSimStep++;
  const softFrame = soft.readTelemetry();
  const material = softFrame.material;
  const combinedHash = (backend.replayHash() ^ Math.imul(softFrame.hash >>> 0, 0x9e3779b1)) >>> 0;
  engineeringRun.record({
    time: engineeringSimStep / 60,
    step: engineeringSimStep,
    load: currentLab.id === 'composite-coupon'
      ? engineeringInputSignal
      : material?.loadProgress ?? clamp(lastForceSignal / 100, 0, 1),
    response: material?.probeResponse ?? material?.centerDeflection ?? (softFrame.kind === 'none' ? backend.dynamicCount() : softFrame.energy),
    energy: softFrame.energy,
    damage: material?.peakDamage ?? 0,
    brokenCount: softFrame.brokenCount,
    hash: combinedHash,
  });
  if (currentLab.id === 'composite-coupon') engineeringInputSignal = 0;
  if (modalPulseReleaseStep >= 0 && engineeringSimStep >= modalPulseReleaseStep) {
    soft.releaseLoad();
    modalPulseReleaseStep = -1;
    markEngineeringEvent('hold', 'Normalized response pulse released after 6 fixed steps.');
  }
}

function stepOnce(): void {
  if (!paused || engineeringRun?.state !== 'paused') {
    appendLog('Pause an active engineering run before advancing one deterministic fixed step.');
    return;
  }
  const start = performance.now();
  engineRuntime.step({ticks:1,subSteps:solverSubSteps,captureTelemetry:false});
  recordEngineeringFixedStep(true);
  effects.update(1 / 60);
  updateStats(0, performance.now() - start, 0, renderer.uploadedMegabytes(), 1, soft.buildFrame(debugEnabled));
}

function applyImpulse(): void {
  if (!ensureNumericalActionAllowed('a broad impulse')) return;
  const strength = activeParameterValue('impulse-strength', 10);
  backend.kick(strength);
  soft.kick(strength);
  effects.spawnImpulseDust([0, 0.15, 0], strength, quality.effectBudget);
  lastForceSignal = clamp(strength / 40 * 100, 0, 100);
  markEngineeringEvent('impact', `Broad impulse · ${strength.toFixed(1)} normalized.`);
  appendLog(`Applied a broad structural impulse at ${strength.toFixed(1)} normalized strength.`);
}

function applyExplosion(): void {
  if (!ensureNumericalActionAllowed('a radial blast')) return;
  const center: Vec3 = [camera.target[0], Math.max(2.8, camera.target[1] * 0.72), camera.target[2]];
  const strength = activeParameterValue('blast-strength', 22);
  const radius = activeParameterValue('blast-radius', 18);
  backend.explode(center[0], center[1], center[2], strength, radius);
  soft.explode(center, strength, radius);
  effects.spawnExplosion(center, strength, quality.effectBudget);
  lastForceSignal = clamp(strength / 40 * 100, 0, 100);
  markEngineeringEvent('impact', `Radial blast · ${strength.toFixed(1)} / radius ${radius.toFixed(1)}.`);
  appendLog(`Applied a controlled radial blast at ${strength.toFixed(1)} strength and ${radius.toFixed(1)} simulation-unit radius.`);
}

function fireProjectile(): void {
  if (!ensureNumericalActionAllowed('a projectile')) return;
  const target: Vec3 = [camera.target[0], Math.max(3.5, camera.target[1]), camera.target[2]];
  const speed = activeParameterValue('projectile-speed', 31);
  const size = activeParameterValue('projectile-size', 0.88);
  const start: Vec3 = [
    target[0] - Math.cos(camera.yaw) * speed,
    target[1] + 2.4,
    target[2] - Math.sin(camera.yaw) * speed,
  ];
  const direction = vec3Normalize(vec3Sub(target, start));
  const velocity = vec3Scale(direction, speed);
  velocity[1] += 1.8;
  const index = backend.launchProjectile(start[0], start[1], start[2], velocity[0], velocity[1], velocity[2], size);
  const softIndex = soft.launchProjectile(start, velocity, size);
  effects.spawnProjectileMuzzle(start, velocity, quality.effectBudget);
  lastForceSignal = clamp(speed / 60 * 100, 0, 100);
  markEngineeringEvent('impact', `Projectile · speed ${speed.toFixed(1)} / size ${size.toFixed(2)}.`);
  appendLog(index >= 0 || softIndex >= 0
    ? `Projectile launched at ${speed.toFixed(1)} simulation units/s with ${size.toFixed(2)} half-size · rigid #${index >= 0 ? index : 'n/a'} · ${soft.kind()} interaction ${softIndex >= 0 ? `#${softIndex}` : 'inactive'}.`
    : 'Projectile failed: body capacity reached or no interactive simulation is active.');
}

function applyRain(): void {
  if (!ensureNumericalActionAllowed('impact rain')) return;
  const requested = Math.round(activeParameterValue('rain-count', 180) * clampStress(Number(ui.stress.value)));
  const added = backend.spawnRain(requested, 20, 27);
  const softAdded = soft.spawnRain(requested, 20, 27);
  effects.spawnRainFlash([0, 16, 0], quality.effectBudget);
  lastForceSignal = 65;
  markEngineeringEvent('impact', `Impact rain · ${requested} requested bodies.`);
  appendLog(`Spawned ${added}/${requested} rigid stress bodies plus ${softAdded} soft/material/fluid impact particles.`);
}

function applyMaterialLoad(): void {
  if (!ensureNumericalActionAllowed('the actuator load')) return;
  if (soft.kind() !== 'fracture') {
    appendLog('Material load rig is available in the Material Failure scene family.');
    return;
  }
  const target = clamp(Number(ui.materialLoadTarget.value), 0, 2);
  parameterValuesForLab(currentLab).set('actuator-target', target);
  soft.setLoadTarget(target);
  markEngineeringEvent('load-step', `Actuator target · ${Math.round(target * 100)}%.`);
  ui.materialLoadValue.textContent = `${Math.round(target * 100)}%`;
  appendLog(`Material actuator target set to ${Math.round(target * 100)}%.`);
}

function releaseMaterialLoad(): void {
  if (!ensureNumericalActionAllowed('actuator release')) return;
  if (soft.kind() !== 'fracture') return;
  soft.releaseLoad();
  markEngineeringEvent('hold', 'Actuator released.');
  ui.materialLoadTarget.value = '0';
  ui.materialLoadValue.textContent = '0%';
  appendLog('Material actuator released for elastic recovery and permanent-set inspection.');
}

function cycleMaterialLoad(): void {
  if (!ensureNumericalActionAllowed('an actuator cycle')) return;
  if (soft.kind() !== 'fracture') {
    appendLog('Material load cycling is available in the Material Failure scene family.');
    return;
  }
  soft.cycleLoad();
  markEngineeringEvent('load-step', 'Deterministic load cycle armed.');
  appendLog('Material fatigue cycle armed: the actuator will load, unload, and repeat deterministically.');
}

function applyDentStrike(strength = 1, target: Exclude<MaterialDemoKind, 'combined'> = 'metal'): void {
  if (!ensureNumericalActionAllowed('a dent strike')) return;
  if (soft.kind() !== 'fracture') {
    appendLog('The instrumented dent strike is available in metal Impact Demo scenes.');
    return;
  }
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  const result = recipe?.kind === 'combined'
    ? soft.dentStrikeTarget(target, strength)
    : soft.dentStrike(strength);
  if (result < 0) {
    appendLog('Select Structural Steel, Aluminum Alloy, or Copper in Impact Demo mode to use the pressure-panel dent rig.');
    return;
  }
  const impact = recipe ? materialDemoWorldPoint(recipe, target) : ([0, 7.1, 0] as Vec3);
  const vertical = recipe?.kind !== 'combined' && recipe?.orientation === 'vertical';
  const sign = recipe?.kind !== 'combined' ? recipe?.loadSign ?? -1 : -1;
  const strikeVelocity: Vec3 = vertical
    ? [0, 0, 30 * sign * clamp(strength, 0.25, 2)]
    : [0, 30 * sign * clamp(strength, 0.25, 2), 0];
  effects.spawnMetalStrike(impact, strikeVelocity, strength, quality.effectBudget);
  appendLog(`Instrumented metal dent strike applied at ${Math.round(clamp(strength, 0.25, 2) * 100)}% intensity.`);
}

function applyMaterialStrike(strength = 1, target?: Exclude<MaterialDemoKind, 'combined'>): void {
  if (soft.kind() !== 'fracture') {
    appendLog('The instrumented material strike is available in Material Failure scenes.');
    return;
  }
  const frame = soft.buildFrame(false);
  const recipe = getMaterialDemoRecipe(currentScene.materialDemoId);
  const isCombined = recipe?.kind === 'combined';
  const result = isCombined
    ? soft.materialStrikeTarget(target ?? 'all', strength)
    : soft.materialStrike(strength);
  if (result < 0) {
    appendLog('The active material rig does not expose a localized strike target.');
    return;
  }
  let targets: readonly Exclude<MaterialDemoKind, 'combined'>[];
  if (isCombined) targets = target ? [target] : ['metal', 'glass', 'concrete'];
  else if (recipe?.kind === 'metal' || recipe?.kind === 'glass' || recipe?.kind === 'concrete') targets = [recipe.kind];
  else {
    const label = frame.material?.label ?? '';
    targets = label.includes('Glass') ? ['glass'] : label.includes('Concrete') ? ['concrete'] : ['metal'];
  }
  for (const materialTarget of targets) {
    const impact = recipe ? materialDemoWorldPoint(recipe, materialTarget) : materialTarget === 'glass' ? ([0, 7.2, 0.15] as Vec3) : ([0, 7.0, 0] as Vec3);
    const vertical = materialTarget === 'glass' || (!isCombined && recipe?.orientation === 'vertical');
    const sign = !isCombined ? recipe?.loadSign ?? -1 : -1;
    const strikeVelocity: Vec3 = vertical
      ? [0, 0, 30 * sign * clamp(strength, 0.25, 2)]
      : [0, 30 * sign * clamp(strength, 0.25, 2), 0];
    if (materialTarget === 'glass') effects.spawnGlassFracture(impact, strength, quality.effectBudget);
    else if (materialTarget === 'concrete') {
      const cone = recipe?.crackStyle === 'cone';
      effects.spawnConcreteSpall(impact, cone ? strength * 0.28 : strength, cone ? Math.min(28, quality.effectBudget * 0.12) : quality.effectBudget);
    } else effects.spawnMetalStrike(impact, strikeVelocity, strength, quality.effectBudget);
  }
  appendLog(`${frame.material?.label ?? 'Material'} strike applied at ${Math.round(clamp(strength, 0.25, 2) * 100)}% intensity.`);
}

function toggleDebug(): void {
  debugEnabled = !debugEnabled;
  ui.debug.textContent = debugEnabled ? 'Diagnostics: On' : 'Diagnostics: Off';
  ui.debug.classList.toggle('armed', debugEnabled);
}

function updateStats(
  fps: number,
  simMs: number,
  renderMs: number,
  uploadMb: number,
  steps: number,
  softFrame: SoftSimulationFrame,
): void {
  ui.bodyCount.textContent = String(backend.bodyCount());
  ui.dynamicCount.textContent = String(backend.dynamicCount());
  ui.effectCount.textContent = String(effects.particleCount() + effects.stagePropCount());
  ui.softSystem.textContent = softFrame.kind === 'none' ? 'Rigid only' : softFrame.kind.toUpperCase();
  ui.softNodes.textContent = softFrame.nodeCount.toLocaleString();
  ui.softConstraints.textContent = softFrame.constraintCount.toLocaleString();
  ui.softBreaks.textContent = softFrame.brokenCount.toLocaleString();
  ui.softEnergy.textContent = softFrame.energy.toFixed(2);
  updateMaterialRig(softFrame);
  if (fps > 0) ui.fps.textContent = String(Math.round(fps));
  ui.simMs.textContent = `${simMs.toFixed(2)} ms`;
  ui.renderMs.textContent = `${renderMs.toFixed(2)} ms`;
  const gpuTiming=renderer.gpuTimingInfo();
  ui.renderMs.title=`CPU command encoding and submission. GPU: ${gpuTiming.latest?gpuTiming.latest.totalPassMs.toFixed(3)+' ms across measured passes':gpuTiming.status==='ready'?'waiting for sample':gpuTiming.status}.`;
  ui.canvas.dataset.gpuTiming=JSON.stringify(gpuTiming);
  ui.canvas.dataset.shadowCache=JSON.stringify(renderer.shadowCacheInfo());
  ui.canvas.dataset.engineTimings=JSON.stringify(engineTimings.inspect());
  ui.canvas.dataset.engineCapabilities=JSON.stringify(engineRuntime.capabilities);
  ui.canvas.dataset.simulationLag=simulationLagSeconds.toFixed(3);
  ui.upload.textContent = `${uploadMb.toFixed(2)} MB`;
  ui.backend.textContent = softFrame.kind === 'none' ? backend.name : `${backend.name} + ${softFrame.label}`;
  const combinedHash = (backend.replayHash() ^ Math.imul(softFrame.hash >>> 0, 0x9e3779b1)) >>> 0;
  ui.hash.textContent = `0x${combinedHash.toString(16).padStart(8, '0')}`;
  ui.qualityStat.textContent = quality.label;
  if (steps > 0) ui.simMs.title = `${steps} fixed simulation step(s) in this sample; ${simulationLagSeconds.toFixed(3)} s behind wall time. No solver ticks skipped.`;

  const material = softFrame.material;
  const forceSample = material ? Math.max(material.loadProgress * 100, lastForceSignal) : lastForceSignal;
  const stressSample = material ? material.maxStrain * 100 : softFrame.brokenCount;
  if (!material) {
    ui.materialLoad.textContent = `${Math.round(forceSample)}%`;
    ui.materialStrain.textContent = `${softFrame.brokenCount.toLocaleString()} breaks`;
  }
  pushTelemetrySample(forceHistory, forceSample);
  pushTelemetrySample(energyHistory, softFrame.energy);
  pushTelemetrySample(stressHistory, stressSample);
  updateEngineeringWorkspaceTelemetry(softFrame, combinedHash, fps);
  drawTelemetryChart(ui.forceChart, forceHistory, '#ff7a00');
  drawTelemetryChart(ui.energyChart, energyHistory, '#25b9ef');
  drawTelemetryChart(ui.stressChart, stressHistory, '#56d5e8');
  if (steps > 0) lastForceSignal *= 0.82;
}

function pushTelemetrySample(history: number[], value: number): void {
  history.push(Number.isFinite(value) ? value : 0);
  if (history.length > TELEMETRY_HISTORY_LENGTH) history.splice(0, history.length - TELEMETRY_HISTORY_LENGTH);
}

function drawTelemetryChart(canvas: HTMLCanvasElement, history: readonly number[], color: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.strokeStyle = 'rgba(132, 142, 148, 0.16)';
  context.lineWidth = 1;
  for (let row = 1; row <= 2; row++) {
    const y = bounds.height * row / 3;
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(bounds.width, y + 0.5);
    context.stroke();
  }
  if (history.length < 2) return;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of history) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (Math.abs(max - min) < 1e-6) {
    min -= 0.5;
    max += 0.5;
  }
  const range = max - min;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.beginPath();
  for (let index = 0; index < history.length; index++) {
    const x = index / Math.max(1, TELEMETRY_HISTORY_LENGTH - 1) * bounds.width;
    const y = bounds.height - 4 - (history[index] - min) / range * Math.max(1, bounds.height - 8);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function updateMaterialRig(softFrame: SoftSimulationFrame): void {
  const material = softFrame.material;
  ui.materialRig.hidden = !material;
  if (!material) {
    ui.materialName.textContent = 'Inactive';
    ui.materialTest.textContent = 'Select a Material Failure scene';
    ui.materialLoad.textContent = '0%';
    ui.materialStrain.textContent = '0.00%';
    ui.materialThresholds.textContent = '—';
    ui.materialDamage.textContent = '0%';
    ui.materialDentDepth.textContent = '0.00 / 0.00 simulation units';
    ui.materialResidualDent.textContent = '0.00 simulation units';
    ui.materialFragments.textContent = '0 cells · 0 fragments · 0 rebar';
    ui.materialFailure.textContent = 'inactive';
    return;
  }

  ui.materialName.textContent = material.label;
  ui.materialTest.textContent = material.testMode;
  ui.materialLoad.textContent = `${Math.round(material.loadProgress * 100)}% / ${Math.round(material.loadTarget * 100)}%`;
  ui.materialStrain.textContent = `${(material.maxStrain * 100).toFixed(2)}%`;
  ui.materialThresholds.textContent = `${(material.yieldStrain * 100).toFixed(2)}% / ${(material.breakStrain * 100).toFixed(2)}%`;
  ui.materialDamage.textContent = `${Math.round(material.peakDamage * 100)}% · ${material.yieldedCount} yielded · ${material.damagedCount} damaged`;
  ui.materialDentDepth.textContent = `${material.centerDeflection.toFixed(2)} / ${material.peakDeflection.toFixed(2)} simulation units`;
  ui.materialResidualDent.textContent = `${material.residualDent.toFixed(2)} simulation units`;
  ui.materialFragments.textContent = `${material.fracturedCellCount} cells · ${material.fragmentCount} fragments · ${material.reinforcementCount} rebar`;
  ui.materialFailure.textContent = material.failurePhase;

  if (document.activeElement !== ui.materialLoadTarget) {
    ui.materialLoadTarget.value = String(clamp(material.loadTarget, 0, 2));
    ui.materialLoadValue.textContent = `${Math.round(material.loadTarget * 100)}%`;
  }
}

function buildDebugLines(): DebugLine[] {
  const lines = rigidDebugLines;
  lines.length = 0;
  if (!debugEnabled) return lines;
  const gridExtent = 44;
  for (let i = -gridExtent; i <= gridExtent; i += 2) {
    const major = i % 10 === 0;
    const alpha = major ? 0.42 : 0.17;
    appendRigidDebugLine(lines, -gridExtent, 0.018, i, gridExtent, 0.018, i, 0.22, 0.48, 0.68, alpha);
    appendRigidDebugLine(lines, i, 0.018, -gridExtent, i, 0.018, gridExtent, 0.22, 0.48, 0.68, alpha);
  }
  appendRigidDebugLine(lines, -10, 0.05, 0, 10, 0.05, 0, 1, 0.12, 0.14, 0.95);
  appendRigidDebugLine(lines, 0, 0.05, -10, 0, 0.05, 10, 0.1, 0.72, 1, 0.95);
  appendRigidDebugLine(lines, 0, 0.05, 0, 0, 10, 0, 0.25, 1, 0.35, 0.95);

  const count = Math.min(backend.bodyCount(), 280);
  const heap = backend.HEAPF32;
  const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
  const stride = count > 150 ? 7 : count > 80 ? 4 : 2;
  for (let i = 0; i < count; i += stride) {
    const offset = matrixStart + i * 16;
    const cx = heap[offset + 12];
    const cy = heap[offset + 13];
    const cz = heap[offset + 14];
    const hx = matrixColumnLength(heap, offset, 0);
    const hy = matrixColumnLength(heap, offset, 1);
    const hz = matrixColumnLength(heap, offset, 2);
    if (!Number.isFinite(cx + cy + cz + hx + hy + hz)) continue;
    addBoxWire(lines, cx, cy, cz, hx, hy, hz);
  }
  return lines;
}

function appendRigidDebugLine(
  lines: DebugLine[], ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  r: number, g: number, b: number, a: number,
): void {
  const index = lines.length;
  let line = rigidDebugLinePool[index];
  if (!line) {
    line = { ax, ay, az, bx, by, bz, r, g, b, a };
    rigidDebugLinePool[index] = line;
  } else {
    line.ax = ax; line.ay = ay; line.az = az;
    line.bx = bx; line.by = by; line.bz = bz;
    line.r = r; line.g = g; line.b = b; line.a = a;
  }
  lines[index] = line;
}

function addBoxWire(lines: DebugLine[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
  for (const [a, b] of BOX_EDGES) {
    const p = BOX_CORNER_SIGNS[a];
    const q = BOX_CORNER_SIGNS[b];
    appendRigidDebugLine(
      lines,
      cx + p[0] * hx, cy + p[1] * hy, cz + p[2] * hz,
      cx + q[0] * hx, cy + q[1] * hy, cz + q[2] * hz,
      0.42, 0.82, 1, 0.25,
    );
  }
}


function extractSurfaceState(surface: DynamicSurfaceFrame): Float32Array {
  switch (surface.path) {
    case 'gpu-cloth':
      return surface.positions.slice(0, surface.vertexCount * 3);
    case 'gpu-water': {
      const output = new Float32Array(surface.vertexCount * 3);
      output.set(surface.eta.subarray(0, surface.vertexCount), 0);
      output.set(surface.u.subarray(0, surface.vertexCount), surface.vertexCount);
      output.set(surface.v.subarray(0, surface.vertexCount), surface.vertexCount * 2);
      return output;
    }
    case 'packed': {
      const packed = new Float32Array(surface.vertexCount * 3);
      const view = new DataView(surface.vertices.buffer, surface.vertices.byteOffset, surface.vertices.byteLength);
      for (let i = 0; i < surface.vertexCount; i++) {
        const source = i * surface.vertexStride;
        const target = i * 3;
        packed[target] = view.getFloat32(source, true);
        packed[target + 1] = view.getFloat32(source + 4, true);
        packed[target + 2] = view.getFloat32(source + 8, true);
      }
      return packed;
    }
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

function surfaceStateIsFinite(surface: DynamicSurfaceFrame): boolean {
  switch (surface.path) {
    case 'gpu-cloth':
      return isFiniteArray(surface.positions) && isFiniteArray(surface.restPositions);
    case 'gpu-water':
      return isFiniteArray(surface.eta) && isFiniteArray(surface.u) && isFiniteArray(surface.v);
    case 'packed':
      return isFiniteArray(surface.vertices);
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

function medianSample(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

async function runTurboQuantBrowserProbe(): Promise<void> {
  ui.runTurboQuant.disabled = true;
  const originalText = ui.runTurboQuant.textContent;
  ui.runTurboQuant.textContent = 'Measuring…';
  setLog('TurboQuant target-device probe: collecting a deterministic simulation stream…');
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    const { TurboQuantDeltaStream, turboQuantError, turboQuantPacketBytes } = await import('./compression/turboquant');
    const probe = new SoftSimulationSuite();
    const probeSeed = (seed ^ 0x715517) >>> 0;
    const created = probe.createScene(currentScene, Number(ui.stress.value), probeSeed);
    const frames: Float32Array[] = [];
    let sourceLabel = 'deterministic synthetic state';

    if (created) {
      for (let frameIndex = 0; frameIndex < 48; frameIndex++) {
        if (frameIndex === 12) probe.kick(11);
        if (frameIndex === 24) probe.launchProjectile([-10, 8, 0], [22, -1.5, 1], 0.5);
        if (frameIndex === 36) probe.explode([0, 4, 0], 15, 8);
        probe.step(1 / 60, 4);
        const frame = probe.buildFrame(false);
        const vector = frame.surface
          ? extractSurfaceState(frame.surface)
          : frame.matrices.slice(0, frame.instanceCount * 16);
        if (vector.length > 0 && (frames.length === 0 || vector.length === frames[0].length)) frames.push(vector);
        if ((frameIndex & 15) === 15) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      sourceLabel = `${currentScene.title} ${probe.buildFrame(false).kind} state`;
      probe.destroy();
    }

    if (frames.length < 8) {
      probe.destroy();
      const length = 19_320;
      for (let frameIndex = 0; frameIndex < 48; frameIndex++) {
        const vector = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          vector[i] = Math.sin(i * 0.007 + frameIndex * 0.031) * 3 + Math.cos(i * 0.0017 - frameIndex * 0.013);
        }
        frames.push(vector);
      }
    }

    const length = frames[0].length;
    const options = { bits: 4 as const, blockSize: 64, rotation: 'structured' as const, centered: false, seed: 0x715517 };
    const sampleCount = 5;
    const rawSamples: number[] = [];
    const turboSamples: number[] = [];
    const rawTarget = new Float32Array(length);

    const runRaw = (): void => {
      for (const frame of frames) rawTarget.set(frame);
    };
    const runTurbo = (): void => {
      const encoder = new TurboQuantDeltaStream(length, options);
      const decoder = new TurboQuantDeltaStream(length, options);
      for (const frame of frames) decoder.decodeFrame(encoder.encodeFrame(frame));
    };

    runRaw();
    runTurbo();
    for (let sample = 0; sample < sampleCount; sample++) {
      let start = performance.now();
      runRaw();
      rawSamples.push(performance.now() - start);
      start = performance.now();
      runTurbo();
      turboSamples.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const encoder = new TurboQuantDeltaStream(length, options);
    const decoder = new TurboQuantDeltaStream(length, options);
    let error2 = 0;
    let reference2 = 0;
    let packetBytes = 0;
    for (const frame of frames) {
      const packet = encoder.encodeFrame(frame);
      const reconstructed = decoder.decodeFrame(packet);
      packetBytes = turboQuantPacketBytes(packet);
      const error = turboQuantError(frame, reconstructed);
      error2 += error.mse * frame.length;
      for (let i = 0; i < frame.length; i++) reference2 += frame[i] * frame[i];
    }
    const relativeL2 = Math.sqrt(error2 / Math.max(1e-30, reference2));
    const rawBytes = length * 4;
    const rawMsPerFrame = medianSample(rawSamples) / frames.length;
    const turboMsPerFrame = medianSample(turboSamples) / frames.length;
    const localSpeedup = rawMsPerFrame / turboMsPerFrame;
    const bytesSaved = rawBytes - packetBytes;
    const breakEvenMbPerSecond = bytesSaved > 0 ? (bytesSaved / (turboMsPerFrame / 1000)) / 1_000_000 : 0;
    const decision = localSpeedup >= 1
      ? 'This device measured a local win; verify visually before enabling a lossy path.'
      : 'Raw local transfer wins. Keep TurboQuant for slower network/storage boundaries.';

    setLog([
      'TurboQuant predictive 4-bit target-device probe',
      `Source: ${sourceLabel}`,
      `Vector: ${length.toLocaleString()} floats · ${frames.length} frames`,
      `Payload: ${(rawBytes / 1024).toFixed(2)} KiB → ${(packetBytes / 1024).toFixed(2)} KiB (${(rawBytes / packetBytes).toFixed(2)}× smaller)`,
      `Raw copy: ${rawMsPerFrame.toFixed(4)} ms/frame`,
      `TurboQuant encode + decode: ${turboMsPerFrame.toFixed(4)} ms/frame`,
      `Local end-to-end speed: ${localSpeedup.toFixed(4)}×`,
      `Predictive relative L2 error: ${(relativeL2 * 100).toFixed(3)}%`,
      `Modeled link break-even: ${breakEvenMbPerSecond.toFixed(1)} MB/s`,
      `Decision: ${decision}`,
    ].join('\n'));
  } catch (error) {
    setLog(`TurboQuant probe failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    ui.runTurboQuant.disabled = false;
    ui.runTurboQuant.textContent = originalText;
  }
}

async function runStateTests(): Promise<void> {
  const restoreScene = currentScene;
  const restoreStress = Number(ui.stress.value);
  const restoreShowcase = activeShowcase;
  stopCinematic(false);
  setLog(`AAA state validation starting across ${SCENES.length} physics recipes and ${AAA_SHOWCASES.length} hero sequences...`);
  let scenePassed = 0;
  let showcasePassed = 0;
  let materialDemoPassed = 0;
  let aaaImprovementPassed = 0;

  for (const scene of SCENES) {
    const testSeed = (0xabc000 + scene.id) >>> 0;
    backend.createScene(scene, 1, testSeed);
    soft.createScene(scene, 1, testSeed);
    const sceneImprovements = getAAAImprovementsForScene(scene.id);
    const stageProps = stagePrimitivesForScene(scene);
    effects.clear(testSeed ^ 0xa11ce);
    effects.setStageProps(stageProps);
    for (let i = 0; i < 3; i++) { backend.step(1 / 60, 1); soft.step(1 / 60, 1); }
    const count = backend.bodyCount();
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(count, 32) * 16);
    const softFrame = soft.buildFrame(false);
    const softValidation = soft.validate();
    const surfaceFinite = !softFrame.surface || (surfaceStateIsFinite(softFrame.surface) && softFrame.surface.indexCount > 0);
    const ropeFinite = !softFrame.ropeGrid || (
      softFrame.ropeGrid.nodeCount > 0 &&
      softFrame.ropeGrid.segmentCount >= 0 &&
      softFrame.ropeGrid.positions.length >= softFrame.ropeGrid.nodeCount * 3 &&
      softFrame.ropeGrid.segments.length >= softFrame.ropeGrid.segmentCount * 8 &&
      isFiniteArray(softFrame.ropeGrid.positions) &&
      isFiniteArray(softFrame.ropeGrid.segments)
    );
    const stageFrame = effects.buildFrame(quality.effectBudget);
    const stageFinite = effects.stagePropCount() === stageProps.length &&
      stageFrame.count === stageProps.length &&
      isFiniteArray(stageFrame.matrices) && isFiniteArray(stageFrame.colors);
    if (stageFinite) aaaImprovementPassed += sceneImprovements.length;
    if (count > 0 && isFiniteArray(matrices) && backend.replayHash() !== 0 && softValidation.ok && surfaceFinite && ropeFinite && stageFinite) scenePassed++;
    else appendLog(`❌ ${sceneLabel(scene)} invalid: rigid=${count > 0 && isFiniteArray(matrices)}, soft=${softValidation.message}, AAA stage=${stageFinite}.`);
    if (scene.id % 25 === 24) {
      appendLog(`Physics recipes: ${scenePassed}/${scene.id + 1} passed.`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  for (const showcase of AAA_SHOWCASES) {
    const samples = [0, showcase.duration * 0.25, showcase.duration * 0.5, showcase.duration * 0.75, showcase.duration];
    const camerasFinite = samples.every((time) => {
      const sampled = sampleShowcaseCamera(showcase, time);
      return Number.isFinite(sampled.yaw + sampled.pitch + sampled.distance + sampled.target[0] + sampled.target[1] + sampled.target[2]);
    });
    const beatsSorted = showcase.beats.every((beat, index) => index === 0 || beat.at >= showcase.beats[index - 1].at);
    let materialExecutionValid = true;
    if (showcase.materialDemoId) {
      const scene = getShowcaseScene(showcase);
      const recipe = getMaterialDemoRecipe(showcase.materialDemoId);
      const testSeed = seedForScene(scene, 0xdef000);
      backend.createScene(scene, scene.defaultStress, testSeed);
      soft.createScene(scene, scene.defaultStress, testSeed);
      effects.clear(testSeed ^ 0xa11ce);
      const stageProps = stagePrimitivesForScene(scene);
      effects.setStageProps(stageProps);
      if (recipe?.kind === 'combined') {
        soft.setMaterialLoadTarget('metal', 0.64);
        soft.materialStrikeTarget('glass', 0.86);
        soft.setMaterialLoadTarget('concrete', 0.72);
      } else if (recipe) {
        soft.setMaterialLoadTarget(recipe.kind, recipe.primaryLoad);
        soft.materialStrikeTarget(recipe.kind, recipe.primaryStrike);
      }
      for (let i = 0; i < 6; i++) { backend.step(1 / 60, 1); soft.step(1 / 60, 2); }
      const frame = soft.buildFrame(false);
      const validation = soft.validate();
      const stageFrame = effects.buildFrame(quality.effectBudget);
      materialExecutionValid = recipe !== null && validation.ok && frame.kind === 'fracture' && frame.hash !== 0 &&
        frame.instanceCount >= 0 && frame.instanceCount <= 3072 && isFiniteArray(frame.matrices) && isFiniteArray(frame.colors) &&
        effects.stagePropCount() === stageProps.length && stageFrame.count === stageProps.length &&
        isFiniteArray(stageFrame.matrices) && isFiniteArray(stageFrame.colors);
      if (materialExecutionValid) materialDemoPassed++;
      else appendLog(`❌ ${showcase.title} material execution failed: ${validation.message}.`);
    }
    if (camerasFinite && beatsSorted && showcase.beats.length >= 6 && materialExecutionValid) showcasePassed++;
    else appendLog(`❌ ${showcase.title} has invalid camera, beat, or material execution data.`);
  }

  effects.clear(0x515151);
  effects.spawnExplosion([0, 3, 0], 18, quality.effectBudget);
  effects.update(1 / 60);
  const effectFrame = effects.buildFrame(quality.effectBudget);
  const effectsFinite = effectFrame.count > 0 && isFiniteArray(effectFrame.matrices) && isFiniteArray(effectFrame.colors);

  backend.createScene(restoreScene, restoreStress, seed);
  soft.createScene(restoreScene, restoreStress, seed);
  renderer.invalidateDynamicCaches();
  currentScene = restoreScene;
  selectShowcase(restoreShowcase, false);
  camera = cloneRig(restoreScene.camera);
  effects.clear(seed ^ 0xa11ce);
  effects.setStageProps(stagePrimitivesForScene(restoreScene));
  updateSceneText();
  appendLog(`✅ State validation complete: ${scenePassed}/${SCENES.length} scenes, ${showcasePassed}/${AAA_SHOWCASES.length} hero sequences, ${materialDemoPassed}/${MATERIAL_DEMO_RECIPES.length} material programs, AAA improvements ${aaaImprovementPassed}/${AAA_IMPROVEMENTS.length}, effects ${effectsFinite ? 'passed' : 'failed'}.`);
}

async function main(): Promise<void> {
  const startupProgress = (stage: string): void => {
    ui.canvas.dataset.startupStage = stage;
    ui.warning.textContent = `${stage}…`;
  };
  startupProgress('Loading physics and soft kernels');
  const physicsPromise = loadBestPhysicsBackend();
  const softRuntimePromise = initializeSoftKernelRuntime();
  const rendererPromise = physicsPromise.then(({ backend: selectedBackend }) =>
    WebGPURenderer.create(ui.canvas, selectedBackend.maxBodies + SOFT_RENDER_INSTANCE_BUDGET + MAX_EFFECT_INSTANCES, {onStartupProgress:startupProgress}));
  const [loaded, softRuntime, loadedRenderer] = await Promise.all([
    physicsPromise,
    softRuntimePromise,
    rendererPromise,
  ]);
  backend = loaded.backend;
  soft = new SoftSimulationSuite(softRuntime.module);
  engineRuntime=createWorkbenchRuntime({backend,soft,softKernelVariant:softRuntime.available?softRuntime.variant:'javascript'});
  renderer = loadedRenderer;
  function watchRendererLoss():void {
    stopRendererLoss();stopRendererLoss=renderer.onDeviceLost(info=>{
      if(rendererRecovering||frameDisposed)return;rendererRecovering=true;rendererFailed=false;
      ui.warning.textContent=`Graphics device lost: ${info.message||info.reason}. Recreating graphics from the current CPU simulation state.`;
      renderer.dispose();
      void WebGPURenderer.create(ui.canvas,backend.maxBodies+SOFT_RENDER_INSTANCE_BUDGET+MAX_EFFECT_INSTANCES).then(replacement=>{
        if(frameDisposed){replacement.dispose();return;}renderer=replacement;renderer.invalidateDynamicCaches();rendererRecovering=false;simulationAccumulator=0;watchRendererLoss();
        ui.warning.textContent='Graphics recovered. Simulation state and recorded results were preserved.';
      }).catch(error=>{rendererRecovering=false;rendererFailed=true;paused=true;ui.warning.textContent=`Graphics recovery failed: ${error instanceof Error?error.message:String(error)}. Reload to initialize a new graphics device.`;});
    });
  }
  watchRendererLoss();
  const softBackend = softRuntime.available ? `${softRuntime.variant.toUpperCase()} soft kernels` : 'JavaScript soft fallback';
  ui.warning.textContent = loaded.warning
    ? `Preview backend active: ${loaded.warning} ${softBackend}; GPU surface reconstruction, compute-expanded rope rendering, and deterministic material fracture are active. Build Box3D WASM for native rigid-body fidelity.`
    : `Native Box3D WASM rigid-body backend loaded with ${softBackend}, GPU surface reconstruction, compute-expanded rope rendering, and deterministic material fracture.`;
  ui.warning.classList.toggle('native', !loaded.warning);

  const boot = resolveBootConcept();
  currentLab = boot.lab;
  currentScene = boot.scene;
  camera = cloneRig(currentScene.camera);
  currentConceptScreen = boot.screen;
  testWorkspaceLabId = ENGINEERING_CONCEPT_VIEWS[boot.screen].workspace === 'test' ? currentLab.id : WORKBENCH_LABS[0].id;
  buildSceneBrowser();
  buildShowcaseBrowser();
  initializeEngineeringInspection();
  bindControls();
  ui.quality.value = quality.id;
  ui.speed.value = '1';
  initializeEngineeringWorkspaceShell(boot.workspace);
  loadScene(currentScene);
  applyConceptScreen(boot.screen);
  ui.solverSubsteps.value = String(solverSubSteps);
  updateForceControlLabels();

  const fixedStep = 1 / 60;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsLast = last;
  let fps = 0;
  let statsLast = 0;
  let statsFrames = 0;
  let statsSteps = 0;
  let statsSimMs = 0;
  let statsRenderMs = 0;
  let statsUploadedBytes = 0;

  function frame(now: number): void {
    if(frameDisposed)return;
    if(rendererRecovering||rendererFailed){last=now;frameRequest=requestAnimationFrame(frame);return;}
    const frameStart=performance.now();
    const wallDeltaSeconds=Math.max(0,(now-last)/1000);
    const deltaSeconds = Math.min(0.1,wallDeltaSeconds);
    last = now;
    // Paused engineering frames must be visually reproducible as well as
    // numerically frozen; water normals and post dither use this clock.
    if (!paused) globalTime += deltaSeconds;
    if (!paused) updateCinematic(deltaSeconds);

    const effectiveSpeed = manualSpeed * cinematicSpeed;
    if(!paused)simulationLagSeconds+=(wallDeltaSeconds-deltaSeconds)*effectiveSpeed;
    let steps = 0;
    const simStart = performance.now();
    if (!paused) {
      simulationAccumulator += deltaSeconds * effectiveSpeed;
      if(simulationAccumulator>fixedStep*8){
        const lost=simulationAccumulator-fixedStep*8;simulationLagSeconds+=lost;simulationAccumulator=fixedStep*8;
        if(simulationLagSeconds-lost<.25&&simulationLagSeconds>=.25){appendLog('Simulation is behind wall time. Fixed ticks remain contiguous; catch-up work is bounded.');markEngineeringEvent('hold','Simulation fell behind wall time; fixed simulation ticks remain contiguous.');}
      }
      while (simulationAccumulator >= fixedStep && steps < 8) {
        engineRuntime.step({ticks:1,subSteps:solverSubSteps,captureTelemetry:false});
        recordEngineeringFixedStep();
        simulationAccumulator -= fixedStep;
        steps++;
      }
      effects.update(deltaSeconds * effectiveSpeed);
    }
    const simMs = performance.now() - simStart;
    engineTimings.sample('step',simMs);
    const stagingStart=performance.now();

    const matrices = cameraMatrixCache.resolve(
      camera,
      effects.cameraShake(),
      ui.canvas.width / Math.max(1, ui.canvas.height),
      LIGHT_DIRECTION,
    );
    const activeWorkspace = engineeringWorkspaces?.getWorkspace();
    const studioMode = activeWorkspace === 'correlation'
      || activeWorkspace === 'field'
      || engineeringWorkspaces?.getLayout() === 'material-lab'
      || activeEngineeringModel?.detailLevel === 'flagship';
    renderer.writeSceneUniforms({
      viewProjection: matrices.viewProjection,
      lightViewProjection: matrices.lightViewProjection,
      cameraPosition: matrices.eye,
      timeSeconds: globalTime,
      lightDirection: LIGHT_DIRECTION,
      quality,
      fogColor: studioMode ? STUDIO_FOG_COLOR : FOG_COLOR,
      studioMode,
    });

    const softFrame = soft.buildFrame(debugEnabled);
    // Engineering soft-body workspaces use an isolated specimen cell. The
    // backend's combinatorial rigid recipe still advances for deterministic
    // provenance, but its unrelated preview props are not composited over the
    // press, crash rail, or cantilever fixture.
    const isolateReducedOrderSpecimen = studioMode && softFrame.kind !== 'none';
    const rigidCount = isolateReducedOrderSpecimen ? 0 : backend.bodyCount();
    let uploadedBytes = renderer.uploadInstances(backend, rigidCount);
    const ropeCount = softFrame.ropeGrid?.segmentCount ?? 0;
    uploadedBytes += renderer.uploadRopeGrid(softFrame.ropeGrid, rigidCount);
    const softCpuBase = rigidCount + ropeCount;
    uploadedBytes += renderer.uploadSoftInstances(
      softFrame.matrices,
      softFrame.colors,
      softCpuBase,
      softFrame.instanceCount,
      softFrame.frameVersion,
    );
    const effectFrame = effects.buildFrame(quality.effectBudget);
    const effectBase = softCpuBase + softFrame.instanceCount;
    uploadedBytes += renderer.uploadEffects(
      effectFrame.matrices,
      effectFrame.colors,
      effectBase,
      effectFrame.count,
      effectFrame.frameVersion,
    );
    uploadedBytes += renderer.uploadSurface(softFrame.surface);
    const backendFrameVersion = backend.frameVersion();
    const combinedFrameLines = frameLineStager.resolve(
      debugEnabled,
      backendFrameVersion,
      softFrame.frameVersion,
      effectFrame.frameVersion,
      buildDebugLines,
      softFrame.debugLines,
      effectFrame.debugLines,
      engineeringInspectionLines,
      engineeringInspectionVersion,
    );
    const inspectionLineVersion = Math.imul(engineeringInspectionVersion, 0x27d4eb2d);
    const lineFrameVersion = debugEnabled
      ? (Math.imul(backendFrameVersion, 0x9e3779b1) ^ Math.imul(softFrame.frameVersion, 0x85ebca6b) ^ effectFrame.frameVersion ^ inspectionLineVersion ^ 0x80000000) >>> 0
      : (effectFrame.frameVersion ^ inspectionLineVersion) >>> 0;
    engineTimings.sample('staging',performance.now()-stagingStart);
    const renderMs = renderer.render(effectBase + effectFrame.count, combinedFrameLines, lineFrameVersion);
    engineTimings.sample('renderCpu',renderMs);engineTimings.sample('frame',performance.now()-frameStart);
    if(adaptiveRendering&&engineeringRun?.state!=='running'){
      const timing=renderer.gpuTimingInfo(),fresh=timing.latest?.frameId!==lastGovernorSample;
      if(!timing.latest||fresh){
        if(timing.latest)lastGovernorSample=timing.latest.frameId;
        const direction=renderGovernor.sample(timing.latest?.totalPassMs??(performance.now()-frameStart));
        if(direction){const scale=clamp(quality.resolutionScale+direction*.05,.5,QUALITY_PROFILES[quality.id].resolutionScale);if(scale!==quality.resolutionScale)quality={...quality,resolutionScale:scale};}
      }
    }
    statsFrames++;
    statsSteps += steps;
    statsSimMs += simMs;
    statsRenderMs += renderMs;
    statsUploadedBytes += uploadedBytes;

    fpsFrames++;
    const fpsElapsed = now - fpsLast;
    if (fpsElapsed >= 200 || (fps === 0 && fpsFrames >= 3 && fpsElapsed >= 50)) {
      fps = (fpsFrames * 1000) / Math.max(1, fpsElapsed);
      fpsFrames = 0;
      fpsLast = now;
    }
    if (now - statsLast >= 200) {
      const divisor = Math.max(1, statsFrames);
      if (fps <= 0 && statsFrames > 0) fps = (statsFrames * 1000) / Math.max(1, now - statsLast);
      updateStats(
        fps,
        statsSimMs / divisor,
        statsRenderMs / divisor,
        statsUploadedBytes / divisor / (1024 * 1024),
        statsSteps,
        softFrame,
      );
      statsFrames = 0;
      statsSteps = 0;
      statsSimMs = 0;
      statsRenderMs = 0;
      statsUploadedBytes = 0;
      statsLast = now;
    }
    frameRequest=requestAnimationFrame(frame);
  }

  frameRequest=requestAnimationFrame(frame);
  window.addEventListener('pagehide',event=>{if(event.persisted)return;frameDisposed=true;cancelAnimationFrame(frameRequest);stopRendererLoss();engineRuntime.destroy();renderer.dispose();soft.destroy();backend.destroy();},{once:true});
}

main().catch(showFatal);
