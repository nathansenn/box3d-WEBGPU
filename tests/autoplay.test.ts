import { MATERIAL_LAB_FEATURED_IDS, getMaterialDemoRecipe } from '../src/material-demos';
import { AAA_SHOWCASES } from '../src/showcases';
import {
  WORKBENCH_DEFAULT_ACTIONS,
  WORKBENCH_LABS,
  getDefaultLabForConceptView,
  getMaterialDemoConceptBinding,
  getWorkbenchLab,
  getWorkbenchLabAutoplay,
  getWorkbenchLabConceptBinding,
  type WorkbenchDefaultAction,
} from '../src/workbench/registry';

function ok(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
}

const FLAGSHIP_LABS = [
  { id: 'titan-bend-dent', view: 'structural-test', defaultAction: 'run', materialDemoId: 'metal-square-punch-forming' },
  { id: 'crash-rail-axial-fold', view: 'correlation-review', defaultAction: 'play', materialDemoId: 'metal-four-point-bumper-beam' },
  { id: 'composite-coupon', view: 'field-modal', defaultAction: 'run', materialDemoId: null },
] as const;

function isDefaultAction(value: unknown): value is WorkbenchDefaultAction {
  switch (value) {
    case 'play':
    case 'apply-force':
    case 'run':
      return true;
    default:
      return false;
  }
}

function testFlagshipLabsExportPlaybackMetadata(): void {
  for (const flagship of FLAGSHIP_LABS) {
    const lab = getWorkbenchLab(flagship.id);
    ok(lab, `${flagship.id} must remain a curated lab`);
    const binding = getWorkbenchLabConceptBinding(flagship.id);
    ok(binding, `${flagship.id} must keep a concept binding`);
    equal(binding.primaryViewId, flagship.view, `${flagship.id} must stay the ${flagship.view} flagship`);
    equal(getDefaultLabForConceptView(flagship.view)?.id, flagship.id);

    const playback = getWorkbenchLabAutoplay(flagship.id);
    ok(playback, `${flagship.id} must export autoPlay/defaultAction metadata`);
    equal(playback.autoPlay, true, `${flagship.id} must autoplay when its workspace opens`);
    equal(playback.defaultAction, flagship.defaultAction, `${flagship.id} defaultAction must be ${flagship.defaultAction}`);
    equal(binding.autoPlay, true);
    equal(binding.defaultAction, flagship.defaultAction);
    ok(lab.forceModes.length > 0, `${flagship.id} must keep a default force/action list`);

    if (flagship.materialDemoId) {
      equal(
        'materialDemoId' in lab ? lab.materialDemoId : undefined,
        flagship.materialDemoId,
        `${flagship.id} must keep its flagship material demo`,
      );
      const showcase = AAA_SHOWCASES.find((entry) => entry.materialDemoId === flagship.materialDemoId);
      ok(showcase, `${flagship.materialDemoId} must own a cinematic showcase`);
      ok(
        showcase.beats.some((beat) => beat.action !== 'caption'),
        `${flagship.materialDemoId} showcase must schedule a default action beat`,
      );
    }
  }
}

function testFeaturedDemosHavePlaybackOrLabActions(): void {
  for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
    const recipe = getMaterialDemoRecipe(featuredId);
    ok(recipe, `featured demo ${featuredId} must exist`);
    ok(recipe.duration > 0, `${featuredId} must publish a playable duration`);
    const binding = getMaterialDemoConceptBinding(featuredId);
    ok(binding, `${featuredId} must keep a concept binding`);
    if (!binding.labId) continue;
    const playback = getWorkbenchLabAutoplay(binding.labId);
    ok(playback, `${binding.labId} must export autoPlay/defaultAction for featured demo ${featuredId}`);
    equal(playback.autoPlay, true, `${binding.labId} must autoplay`);
    ok(isDefaultAction(playback.defaultAction), `${binding.labId} defaultAction must be play | apply-force | run`);
  }
}

function testEveryLabPublishesPlaybackMetadata(): void {
  equal(WORKBENCH_DEFAULT_ACTIONS.length, 3);
  for (const lab of WORKBENCH_LABS) {
    const playback = getWorkbenchLabAutoplay(lab.id);
    ok(playback, `${lab.id} must export autoPlay/defaultAction metadata`);
    equal(playback.autoPlay, true, `${lab.id} must autoplay on open`);
    ok(isDefaultAction(playback.defaultAction), `${lab.id} defaultAction must be play | apply-force | run`);
  }
  equal(getWorkbenchLabAutoplay('missing-lab'), null);
}

const tests: Array<readonly [string, () => void]> = [
  ['flagship labs export playback metadata', testFlagshipLabsExportPlaybackMetadata],
  ['featured demos have playback or lab actions', testFeaturedDemosHavePlaybackOrLabActions],
  ['every lab publishes playback metadata', testEveryLabPublishesPlaybackMetadata],
];

export function runAutoplayTests(): void {
  for (const [, test] of tests) test();
}

function isDirectRun(filename: string): boolean {
  const argv1 = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[1] ?? '';
  return argv1.includes(filename);
}

if (isDirectRun('autoplay.test')) {
  for (const [name, test] of tests) {
    test();
    console.log(`✓ ${name}`);
  }
  console.log(`All ${tests.length} autoplay suites passed.`);
}
