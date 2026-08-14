import { MATERIAL_DEMO_RECIPES, MATERIAL_LAB_FEATURED_IDS, sceneForMaterialDemo } from '../src/material-demos';
import { ENGINEERING_WORKSPACES, parseEngineeringConceptView, resolveEngineeringConceptFixtureId } from '../src/workbench/engineering-session';
import { failingAaaLessons, gradeAllAaaLessons, listAaaLessons } from '../src/workbench/lesson-quality';
import {
  MATERIAL_LAB_CATALOG_FILTERS,
  MATERIAL_LAB_CROSS_CATALOG,
  WORKBENCH_CONCEPT_VIEW_IDS,
  WORKBENCH_CONCEPT_VIEWS,
  WORKBENCH_DEFAULT_LAB_BY_UI_WORKSPACE,
  WORKBENCH_ISOLATED_LAB_BY_UI_WORKSPACE,
  WORKBENCH_LABS,
  WORKBENCH_LAB_CONCEPT_BINDINGS,
  WORKBENCH_MATERIAL_DEMO_CONCEPT_BINDINGS,
  WORKBENCH_UI_WORKSPACE_IDS,
  WORKSPACE_KINDS,
  conceptViewIdFromWorkspaceKind,
  conceptViewsForUiWorkspace,
  conceptWorkspaceIdFromConceptViewId,
  conceptWorkspaceIdFromKind,
  getDefaultLabForConceptView,
  getMaterialDemoConceptBinding,
  getMaterialLabCatalogLabs,
  getWorkbenchConceptView,
  getWorkbenchLab,
  getWorkbenchLabCapabilities,
  getWorkbenchLabConceptBinding,
  getWorkbenchLabsForConceptView,
  labMatchesCatalogFilter,
  materialLabCatalogCopy,
  materialLabCatalogSearchText,
  parseConceptViewId,
  uiWorkspaceForConceptView,
  workspaceKindFromConceptViewId,
  workspaceKindFromConceptWorkspaceId,
  type WorkbenchConceptViewId,
  type WorkbenchUiWorkspaceId,
  type WorkspaceKind,
} from '../src/workbench/registry';

function ok(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `expected ${a} to deepEqual ${b}`);
}

const MATERIAL_LAB_VIEWS = ['material-lab-desktop', 'material-lab-mobile'] as const;
const PHYSICS_WORKBENCH_VIEWS = ['structural-test', 'correlation-review', 'field-modal'] as const;

function isMaterialLabView(id: WorkbenchConceptViewId): boolean {
  switch (id) {
    case 'material-lab-desktop':
    case 'material-lab-mobile':
      return true;
    case 'structural-test':
    case 'correlation-review':
    case 'field-modal':
      return false;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

function isPhysicsWorkbenchView(id: WorkbenchConceptViewId): boolean {
  return !isMaterialLabView(id);
}

function testFiveConceptScreens(): void {
  deepEqual(
    [...WORKBENCH_CONCEPT_VIEW_IDS],
    ['material-lab-desktop', 'material-lab-mobile', 'structural-test', 'correlation-review', 'field-modal'],
    'schema/workspace ids must include the five concept screens',
  );
  equal(WORKBENCH_CONCEPT_VIEWS.length, 5, 'concept catalog must list exactly the five mockup screens');
  equal(new Set(WORKBENCH_CONCEPT_VIEWS.map((view) => view.id)).size, 5);
  equal(new Set(WORKBENCH_CONCEPT_VIEWS.map((view) => view.conceptImage)).size, 5);

  const expectedAssets: Readonly<Record<WorkbenchConceptViewId, string>> = {
    'material-lab-desktop': 'public/concepts/material-lab-desktop.png',
    'material-lab-mobile': 'public/concepts/material-lab-mobile.png',
    'structural-test': 'public/concepts/physics-workbench-structural-v2.png',
    'correlation-review': 'public/concepts/physics-workbench-correlation-v2.png',
    'field-modal': 'public/concepts/physics-workbench-field-modal-v2.png',
  };

  for (const id of WORKBENCH_CONCEPT_VIEW_IDS) {
    const view = getWorkbenchConceptView(id);
    ok(view, `concept view '${id}' must be registered`);
    equal(view.id, id);
    equal(view.conceptImage, expectedAssets[id], `${id} must point at its mockup asset`);
    ok(view.panels.length >= 4, `${id} must declare the mockup panel set`);
    ok(getWorkbenchLab(view.defaultLabId), `${id} default lab '${view.defaultLabId}' must exist`);
    equal(uiWorkspaceForConceptView(id), view.uiWorkspaceId);
  }

  deepEqual(getWorkbenchConceptView('structural-test')?.qaViewport, { width: 1672, height: 941 });
  deepEqual(getWorkbenchConceptView('correlation-review')?.qaViewport, { width: 1672, height: 941 });
  deepEqual(getWorkbenchConceptView('field-modal')?.qaViewport, { width: 1024, height: 1536 });
  equal(getWorkbenchConceptView('material-lab-desktop')?.layout, 'desktop');
  equal(getWorkbenchConceptView('material-lab-mobile')?.layout, 'mobile');
  equal(getWorkbenchConceptView('field-modal')?.layout, 'portrait-tablet');
  equal(getWorkbenchConceptView('missing-view'), null);
}

function testMaterialLabDemosMapToMaterialLab(): void {
  equal(MATERIAL_DEMO_RECIPES.length, 34);
  equal(WORKBENCH_MATERIAL_DEMO_CONCEPT_BINDINGS.length, MATERIAL_DEMO_RECIPES.length);
  deepEqual(
    [...MATERIAL_LAB_CATALOG_FILTERS],
    ['all', 'structural', 'impact', 'fluid', 'soft-body', 'cloth'],
    'material lab catalog filters must match the mockup ALL / STRUCTURAL / IMPACT / FLUID / SOFT BODY / CLOTH row',
  );

  for (const recipe of MATERIAL_DEMO_RECIPES) {
    const binding = getMaterialDemoConceptBinding(recipe.id);
    ok(binding, `${recipe.id} must have a concept binding`);
    equal(binding.materialDemoId, recipe.id);
    for (const viewId of MATERIAL_LAB_VIEWS) {
      ok(
        binding.viewIds.includes(viewId),
        `${recipe.id} must map to the material lab workspace (${viewId})`,
      );
    }
    if (binding.labId === null) {
      equal(
        binding.primaryViewId,
        'material-lab-desktop',
        `${recipe.id} is material-lab-only and must open the desktop lab screen`,
      );
    } else {
      ok(getWorkbenchLab(binding.labId), `${recipe.id} lab '${binding.labId}' must exist`);
    }
  }

  equal(getMaterialDemoConceptBinding('not-a-material-demo'), null);
}

function testPhysicsWorkbenchDemosMapToPhysicsConcepts(): void {
  equal(WORKBENCH_LABS.length, 35);
  equal(WORKBENCH_LAB_CONCEPT_BINDINGS.length, 35);
  equal(getWorkbenchLabsForConceptView('structural-test').length, 35);
  equal(getWorkbenchLabsForConceptView('correlation-review').length, 35);
  equal(getWorkbenchLabsForConceptView('field-modal').length, 1);
  equal(getWorkbenchLabsForConceptView('field-modal')[0]?.id, 'composite-coupon');

  for (const lab of WORKBENCH_LABS) {
    const binding = getWorkbenchLabConceptBinding(lab.id);
    ok(binding, `${lab.id} must have a concept binding`);
    equal(binding.labId, lab.id);
    ok(
      isPhysicsWorkbenchView(binding.primaryViewId),
      `${lab.id} primary concept must be structural, correlation, or field-modal`,
    );
    ok(PHYSICS_WORKBENCH_VIEWS.includes(binding.primaryViewId as typeof PHYSICS_WORKBENCH_VIEWS[number]));
    ok(binding.viewIds.includes('structural-test'), `${lab.id} must remain available in Structural Test`);
    ok(binding.viewIds.includes('correlation-review'), `${lab.id} must remain correlatable`);
    equal(
      binding.viewIds.includes('field-modal'),
      lab.id === 'composite-coupon',
      `only composite-coupon may expose the field-modal specimen; ${lab.id} was ${binding.viewIds.join(',')}`,
    );

    const capabilities = getWorkbenchLabCapabilities(lab.id);
    ok(capabilities, `${lab.id} must publish workbench capabilities`);
    equal(capabilities.structuralTest, true);
    equal(capabilities.correlation, true);
    equal(capabilities.modalAnalysis, lab.id === 'composite-coupon' ? 'analysis-only-cantilever' : 'none');
    equal(capabilities.renderCheckpointHz, lab.solver === 'box3d-rigid' ? 10 : 30);
  }

  equal(getWorkbenchLabConceptBinding('titan-bend-dent')?.primaryViewId, 'structural-test');
  equal(getWorkbenchLabConceptBinding('crash-rail-axial-fold')?.primaryViewId, 'correlation-review');
  equal(getWorkbenchLabConceptBinding('composite-coupon')?.primaryViewId, 'field-modal');
  equal(getWorkbenchLabConceptBinding('missing-lab'), null);
  equal(getWorkbenchLabCapabilities('missing-lab'), null);
}

function testFlagshipLabsAndUiRouting(): void {
  equal(getDefaultLabForConceptView('structural-test')?.id, 'titan-bend-dent');
  equal(getDefaultLabForConceptView('correlation-review')?.id, 'crash-rail-axial-fold');
  equal(getDefaultLabForConceptView('field-modal')?.id, 'composite-coupon');
  equal(getDefaultLabForConceptView('material-lab-desktop')?.id, 'titan-bend-dent');
  equal(getDefaultLabForConceptView('material-lab-mobile')?.id, 'titan-bend-dent');

  equal(getWorkbenchLabConceptBinding('titan-bend-dent')?.autoPlay, true);
  equal(getWorkbenchLabConceptBinding('titan-bend-dent')?.defaultAction, 'run');
  equal(getWorkbenchLabConceptBinding('crash-rail-axial-fold')?.autoPlay, true);
  equal(getWorkbenchLabConceptBinding('crash-rail-axial-fold')?.defaultAction, 'play');
  equal(getWorkbenchLabConceptBinding('composite-coupon')?.autoPlay, true);
  equal(getWorkbenchLabConceptBinding('composite-coupon')?.defaultAction, 'run');

  deepEqual(
    { ...WORKBENCH_DEFAULT_LAB_BY_UI_WORKSPACE },
    { test: 'titan-bend-dent', correlation: 'crash-rail-axial-fold', field: 'composite-coupon' },
  );
  deepEqual(
    { ...WORKBENCH_ISOLATED_LAB_BY_UI_WORKSPACE },
    { test: null, correlation: 'crash-rail-axial-fold', field: 'composite-coupon' },
  );

  deepEqual([...WORKBENCH_UI_WORKSPACE_IDS], ['test', 'correlation', 'field']);
  deepEqual([...ENGINEERING_WORKSPACES], ['test', 'correlation', 'field']);

  const uiRouting: Readonly<Record<WorkbenchConceptViewId, WorkbenchUiWorkspaceId>> = {
    'material-lab-desktop': 'test',
    'material-lab-mobile': 'test',
    'structural-test': 'test',
    'correlation-review': 'correlation',
    'field-modal': 'field',
  };
  for (const id of WORKBENCH_CONCEPT_VIEW_IDS) {
    equal(uiWorkspaceForConceptView(id), uiRouting[id], `${id} must route to its live shell workspace`);
  }

  deepEqual([...conceptViewsForUiWorkspace('test')], ['structural-test', 'material-lab-desktop', 'material-lab-mobile']);
  deepEqual([...conceptViewsForUiWorkspace('correlation')], ['correlation-review']);
  deepEqual([...conceptViewsForUiWorkspace('field')], ['field-modal']);
}

function testIdVocabularyAdapters(): void {
  const kindToWorkspace: Readonly<Record<WorkspaceKind, string>> = {
    materialLab: 'material-lab',
    physicsStructural: 'structural-test',
    physicsCorrelation: 'correlation-review',
    physicsFieldModal: 'field-modal',
  };
  for (const kind of WORKSPACE_KINDS) {
    equal(conceptWorkspaceIdFromKind(kind), kindToWorkspace[kind], `${kind} must map to ConceptWorkspaceId`);
    equal(workspaceKindFromConceptWorkspaceId(conceptWorkspaceIdFromKind(kind)), kind);
  }

  equal(conceptViewIdFromWorkspaceKind('materialLab', 'desktop'), 'material-lab-desktop');
  equal(conceptViewIdFromWorkspaceKind('materialLab', 'mobile'), 'material-lab-mobile');
  equal(conceptViewIdFromWorkspaceKind('physicsStructural', 'mobile'), 'structural-test');
  equal(conceptViewIdFromWorkspaceKind('physicsCorrelation', 'desktop'), 'correlation-review');
  equal(conceptViewIdFromWorkspaceKind('physicsFieldModal', 'desktop'), 'field-modal');

  equal(workspaceKindFromConceptViewId('material-lab-desktop'), 'materialLab');
  equal(workspaceKindFromConceptViewId('material-lab-mobile'), 'materialLab');
  equal(conceptWorkspaceIdFromConceptViewId('material-lab-desktop'), 'material-lab');
  equal(conceptWorkspaceIdFromConceptViewId('structural-test'), 'structural-test');

  equal(parseConceptViewId('material-lab'), 'material-lab-desktop');
  equal(parseConceptViewId('materialLab'), 'material-lab-desktop');
  equal(parseConceptViewId('structural'), 'structural-test');
  equal(parseConceptViewId('physicsStructural'), 'structural-test');
  equal(parseConceptViewId('correlation'), 'correlation-review');
  equal(parseConceptViewId('compare'), 'correlation-review');
  equal(parseConceptViewId('field'), 'field-modal');
  equal(parseConceptViewId('physicsFieldModal'), 'field-modal');
  equal(parseConceptViewId('material-lab-mobile'), 'material-lab-mobile');
  equal(parseConceptViewId('test'), null);

  equal(parseEngineeringConceptView('material-lab-desktop'), 'materialLab');
  equal(parseEngineeringConceptView('structural-test'), 'physicsStructural');
  equal(parseEngineeringConceptView('correlation-review'), 'physicsCorrelation');
  equal(parseEngineeringConceptView('field-modal'), 'physicsFieldModal');

  equal(resolveEngineeringConceptFixtureId('structural-test'), 'structural');
  equal(resolveEngineeringConceptFixtureId('correlation-review'), 'correlation');
  equal(resolveEngineeringConceptFixtureId('material-lab'), 'material-lab-desktop');
  equal(resolveEngineeringConceptFixtureId('physicsFieldModal'), 'field-modal');
  equal(resolveEngineeringConceptFixtureId('material-lab-mobile'), 'material-lab-mobile');
}

function testFeaturedDemosPublishCameraAndOrientation(): void {
  const expectedOrientation: Readonly<Record<(typeof MATERIAL_LAB_FEATURED_IDS)[number], 'horizontal' | 'vertical'>> = {
    'metal-square-punch-forming': 'horizontal',
    'metal-press-brake-v-bend': 'horizontal',
    'glass-laminated-stone-strike': 'vertical',
    'concrete-flat-slab-punching': 'horizontal',
  };

  for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
    const recipe = MATERIAL_DEMO_RECIPES.find((entry) => entry.id === featuredId);
    ok(recipe, `featured demo ${featuredId} must remain in the recipe catalog`);
    const orientation = recipe.orientation ?? (recipe.kind === 'glass' ? 'vertical' : 'horizontal');
    equal(orientation, expectedOrientation[featuredId], `${featuredId} must keep its authored specimen orientation`);
    ok(recipe.camera, `${featuredId} must export camera metadata`);
    ok(recipe.camera.pitch >= 0.08 && recipe.camera.pitch <= 1.3, `${featuredId} camera must stay above the Y-up stage`);
    ok(recipe.camera.target[1] > 0, `${featuredId} camera target must use Y as up`);

    const scene = sceneForMaterialDemo(featuredId);
    equal(scene.camera.yaw, recipe.camera.yaw);
    equal(scene.camera.pitch, recipe.camera.pitch);
    ok(scene.tags.includes(orientation), `${featuredId} scene tags must publish ${orientation}`);
  }
}

function testMaterialLabCatalogWiresEveryLesson(): void {
  const catalog = getMaterialLabCatalogLabs();
  ok(catalog.length >= 35, 'Material Lab catalog must keep the 35 curated labs and add unbound recipes');
  equal(catalog[0]?.id, 'titan-bend-dent', 'row 01 must stay Ballistic Dent');
  equal(catalog[1]?.id, 'metal-press-brake-v-bend', 'row 02 must stay Metal Fold');
  equal(catalog[2]?.id, 'ballistic-glass', 'row 03 must stay Glass Impact');
  equal(catalog[3]?.id, 'rc-punching-shear', 'row 04 must stay Concrete Shear');
  equal(catalog[4]?.id, MATERIAL_LAB_CROSS_CATALOG[0].labId, 'row 05 must stay Cloth Tear');
  equal(catalog[5]?.id, MATERIAL_LAB_CROSS_CATALOG[1].labId, 'row 06 must stay Fluid Dam-Break');
  equal(catalog[6]?.id, MATERIAL_LAB_CROSS_CATALOG[2].labId, 'row 07 must stay Soft-Body Crush');
  ok(materialLabCatalogSearchText(catalog[0]!).toLowerCase().includes('ballistic dent'), 'search must find Ballistic Dent by lesson title');
  ok(materialLabCatalogSearchText(catalog[2]!).toLowerCase().includes('glass impact'), 'search must find Glass Impact by lesson title');
  equal(materialLabCatalogCopy(catalog[2]!).title, 'Glass Impact');
  equal(materialLabCatalogCopy(catalog[3]!).title, 'Concrete Shear');
  equal(materialLabCatalogCopy(catalog[4]!).title, 'Cloth Tear');

  const glass = getWorkbenchLab('ballistic-glass')!;
  const fold = getWorkbenchLab('metal-press-brake-v-bend')!;
  const shear = getWorkbenchLab('rc-punching-shear')!;
  ok(labMatchesCatalogFilter(glass, 'impact'), 'Glass Impact must appear under IMPACT');
  ok(!labMatchesCatalogFilter(glass, 'structural'), 'Glass Impact must not hide under STRUCTURAL');
  ok(labMatchesCatalogFilter(fold, 'structural'), 'Metal Fold must appear under STRUCTURAL');
  ok(labMatchesCatalogFilter(shear, 'structural'), 'Concrete Shear must appear under STRUCTURAL');
  ok(!labMatchesCatalogFilter(fold, 'impact'), 'Metal Fold must not be dumped into IMPACT');

  const catalogIds = new Set(catalog.map((lab) => lab.id));
  for (const recipe of MATERIAL_DEMO_RECIPES) {
    const labId = getMaterialDemoConceptBinding(recipe.id)?.labId ?? recipe.id;
    ok(catalogIds.has(labId), `${recipe.id} must be openable from the Material Lab catalog`);
  }
  for (const lab of WORKBENCH_LABS) {
    ok(catalogIds.has(lab.id), `${lab.id} must remain in the Material Lab catalog`);
  }
}

function testAaaLessonScorecard(): void {
  const lessons = listAaaLessons();
  ok(lessons.length >= 35, 'AAA scorecard must cover recipes plus non-recipe labs');
  const scores = gradeAllAaaLessons();
  equal(scores.length, lessons.length);
  const failed = failingAaaLessons();
  if (failed.length > 0) {
    throw new Error(`AAA lessons still failing: ${failed.map((score) => `${score.title} (${score.fails.join('; ')})`).join(' | ')}`);
  }
}

const tests: Array<readonly [string, () => void]> = [
  ['five concept screens', testFiveConceptScreens],
  ['material lab demos map to material lab', testMaterialLabDemosMapToMaterialLab],
  ['physics workbench demos map to physics concepts', testPhysicsWorkbenchDemosMapToPhysicsConcepts],
  ['flagship labs and UI routing', testFlagshipLabsAndUiRouting],
  ['id vocabulary adapters', testIdVocabularyAdapters],
  ['featured demos publish camera and orientation', testFeaturedDemosPublishCameraAndOrientation],
  ['material lab catalog wires every lesson', testMaterialLabCatalogWiresEveryLesson],
  ['AAA lesson scorecard', testAaaLessonScorecard],
];

export function runConceptMappingTests(): void {
  for (const [, test] of tests) test();
}

function isDirectRun(filename: string): boolean {
  const argv1 = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[1] ?? '';
  return argv1.includes(filename);
}

if (isDirectRun('concept-mapping.test')) {
  for (const [name, test] of tests) {
    test();
    console.log(`✓ ${name}`);
  }
  console.log(`All ${tests.length} concept-mapping suites passed.`);
}
