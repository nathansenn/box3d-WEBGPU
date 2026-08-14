import {
  MATERIAL_DEMO_RECIPES,
  MATERIAL_LAB_FEATURED_IDS,
  getMaterialDemoRecipe,
  sceneForMaterialDemo,
  type MaterialDemoRecipe,
} from '../src/material-demos';
import {
  AAA_SHOWCASES,
  getShowcaseScene,
  sampleShowcaseCamera,
} from '../src/showcases';
import {
  ENGINEERING_MODELS,
  getEngineeringModelForLab,
} from '../src/workbench/engineering-model';
import { WORKBENCH_LABS } from '../src/workbench/registry';

function ok(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
}

type DemoAxisMeta = {
  readonly upAxis?: unknown;
  readonly worldUp?: unknown;
  readonly coordinateFrame?: { readonly upAxis?: unknown };
};

function recipeOrientation(recipe: MaterialDemoRecipe): 'horizontal' | 'vertical' {
  if (recipe.orientation === 'vertical' || recipe.orientation === 'horizontal') return recipe.orientation;
  return recipe.kind === 'glass' ? 'vertical' : 'horizontal';
}

function recipeUpAxis(recipe: MaterialDemoRecipe): string | null {
  const meta = recipe as MaterialDemoRecipe & DemoAxisMeta;
  const axis = meta.upAxis ?? meta.worldUp ?? meta.coordinateFrame?.upAxis;
  return typeof axis === 'string' ? axis : null;
}

function assertCameraIsYUp(
  camera: { yaw: number; pitch: number; distance: number; target: readonly number[] },
  label: string,
): void {
  ok(Number.isFinite(camera.yaw + camera.pitch + camera.distance), `${label} camera must be finite`);
  ok(camera.distance >= 8, `${label} camera distance must remain usable`);
  ok(camera.pitch >= 0.08 && camera.pitch <= 1.3, `${label} camera elevation must stay above the scene`);
  ok(camera.target.length === 3 && camera.target.every(Number.isFinite), `${label} camera target must be a finite vec3`);
  ok(camera.target[1] > 0, `${label} camera target must use Y as the up axis`);
  const eyeY = camera.target[1] + Math.sin(camera.pitch) * camera.distance;
  ok(eyeY > camera.target[1], `${label} camera eye must sit above its target on Y`);
}

function testEngineeringModelsAreYUp(): void {
  ok(ENGINEERING_MODELS.length === WORKBENCH_LABS.length, 'every lab must publish a Y-up engineering model');
  for (const model of ENGINEERING_MODELS) {
    equal(model.coordinateFrame.upAxis, 'Y', `${model.labId} must declare Y-up`);
    equal(model.coordinateFrame.handedness, 'right-handed', `${model.labId} must stay right-handed`);
    equal(model.coordinateFrame.units, 'normalized simulation units');
  }
  for (const id of ['titan-bend-dent', 'crash-rail-axial-fold', 'composite-coupon'] as const) {
    const model = getEngineeringModelForLab(id);
    ok(model, `${id} must resolve an engineering model`);
    equal(model.coordinateFrame.upAxis, 'Y', `${id} flagship model must stay Y-up`);
  }
}

function testMaterialDemoCamerasAndOrientation(): void {
  for (const recipe of MATERIAL_DEMO_RECIPES) {
    const orientation = recipeOrientation(recipe);
    ok(orientation === 'horizontal' || orientation === 'vertical', `${recipe.id} orientation must be horizontal or vertical`);
    assertCameraIsYUp(recipe.camera, recipe.id);

    const axis = recipeUpAxis(recipe);
    if (axis !== null) equal(axis.toUpperCase(), 'Y', `${recipe.id} up-axis metadata must be Y`);

    const scene = sceneForMaterialDemo(recipe.id);
    equal(scene.camera.yaw, recipe.camera.yaw, `${recipe.id} scene camera yaw must match the recipe`);
    equal(scene.camera.pitch, recipe.camera.pitch, `${recipe.id} scene camera pitch must match the recipe`);
    equal(scene.camera.distance, recipe.camera.distance, `${recipe.id} scene camera distance must match the recipe`);
    equal(scene.camera.target[0], recipe.camera.target[0]);
    equal(scene.camera.target[1], recipe.camera.target[1]);
    equal(scene.camera.target[2], recipe.camera.target[2]);
    ok(scene.tags.includes(orientation), `${recipe.id} scene tags must include ${orientation}`);
    assertCameraIsYUp(scene.camera, `${recipe.id} scene`);

    if (recipe.kind === 'metal' && orientation === 'horizontal') {
      ok(recipe.loadSign !== 1, `${recipe.id} horizontal metal must not load toward +Y / the camera`);
    }
  }
}

function testFlagshipDemoOrientationContracts(): void {
  const expected: Readonly<Record<string, 'horizontal' | 'vertical'>> = {
    'metal-square-punch-forming': 'horizontal',
    'metal-press-brake-v-bend': 'horizontal',
    'metal-four-point-bumper-beam': 'horizontal',
    'glass-laminated-stone-strike': 'vertical',
    'concrete-flat-slab-punching': 'horizontal',
  };

  for (const [id, orientation] of Object.entries(expected)) {
    const recipe = getMaterialDemoRecipe(id);
    ok(recipe, `${id} must remain registered`);
    equal(recipeOrientation(recipe), orientation, `${id} must stay ${orientation} in Y-up scene space`);
    assertCameraIsYUp(recipe.camera, id);
  }

  for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
    const recipe = getMaterialDemoRecipe(featuredId);
    ok(recipe, `featured demo ${featuredId} must exist`);
    assertCameraIsYUp(recipe.camera, featuredId);
  }
}

function testShowcaseCamerasStayYUp(): void {
  for (const recipe of MATERIAL_DEMO_RECIPES) {
    const showcase = AAA_SHOWCASES.find((entry) => entry.materialDemoId === recipe.id);
    if (!showcase) continue;
    const scene = getShowcaseScene(showcase);
    equal(scene.camera.yaw, recipe.camera.yaw, `${showcase.id} must keep the recipe camera yaw`);
    equal(scene.camera.pitch, recipe.camera.pitch, `${showcase.id} must keep the recipe camera pitch`);
    assertCameraIsYUp(scene.camera, showcase.id);
    for (const time of [0, showcase.duration * 0.5, showcase.duration]) {
      assertCameraIsYUp(sampleShowcaseCamera(showcase, time), `${showcase.id} @ ${time.toFixed(1)}s`);
    }
  }
}

const tests: Array<readonly [string, () => void]> = [
  ['engineering models are Y-up', testEngineeringModelsAreYUp],
  ['material demo cameras and orientation', testMaterialDemoCamerasAndOrientation],
  ['flagship demo orientation contracts', testFlagshipDemoOrientationContracts],
  ['showcase cameras stay Y-up', testShowcaseCamerasStayYUp],
];

export function runDemoOrientationTests(): void {
  for (const [, test] of tests) test();
}

function isDirectRun(filename: string): boolean {
  const argv1 = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[1] ?? '';
  return argv1.includes(filename);
}

if (isDirectRun('demo-orientation.test')) {
  for (const [name, test] of tests) {
    test();
    console.log(`✓ ${name}`);
  }
  console.log(`All ${tests.length} demo-orientation suites passed.`);
}
