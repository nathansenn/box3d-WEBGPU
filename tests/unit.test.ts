function ok(value: unknown, message = 'assertion failed'): void {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `expected ${String(actual)} to equal ${String(expected)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message ?? `expected ${a} to deepEqual ${b}`);
}

import {
  clamp,
  isFiniteArray,
  mat4Identity,
  mat4LookAt,
  mat4LookAtInto,
  mat4Multiply,
  mat4MultiplyInto,
  mat4Orthographic,
  mat4OrthographicInto,
  mat4Perspective,
  mat4PerspectiveInto,
  vec3Add,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  writeAxisAlignedModelMatrix,
  writeModelMatrixFromEuler,
} from '../src/math';
import { CameraMatrixCache, type CameraShakeInput } from '../src/camera';
import { FrameLineStager } from '../src/frame-lines';
import { CinematicEffects } from '../src/effects';
import { AAA_IMPROVEMENTS, getAAAImprovementsForScene, getAAAStagePrimitives } from '../src/aaa-improvements';
import {
  MATERIAL_DEMO_RECIPES,
  getMaterialDemoRecipe,
  getMaterialDemoStagePrimitives,
  materialDemoCounts,
  sceneForMaterialDemo,
} from '../src/material-demos';
import { FallbackPhysicsBackend } from '../src/physics/fallback';
import { FEATURED_SCENE_IDS, SCENES, SCENE_CATEGORIES, sceneLabel } from '../src/scenes';
import {
  AAA_SHOWCASES,
  AAA_SIGNATURE_SHOWCASES,
  getShowcaseById,
  getShowcaseByOrdinal,
  getShowcaseScene,
  sampleShowcaseCamera,
} from '../src/showcases';
import {
  CLOTH_INSTANCE_BUDGET,
  ROPE_INSTANCE_BUDGET,
  SOFT_INSTANCE_BUDGET,
  SOFT_RENDER_INSTANCE_BUDGET,
  SoftSimulationSuite,
  WATER_INSTANCE_BUDGET,
  type SoftSimulationFrame,
} from '../src/soft/simulations';
import {
  COMBINED_MATERIAL_CPU_INSTANCE_BUDGET,
  COMBINED_MATERIAL_SEGMENT_BUDGET,
} from '../src/soft/combined-material-simulation';
import { MATERIAL_BEHAVIOR_PRESETS, materialPresetForVariant } from '../src/soft/material-presets';
import { PACKED_SURFACE_VERTEX_BYTES } from '../src/soft/packed-surface';
import { TurboQuantCodec, TurboQuantDeltaStream, turboQuantCompressionRatio, turboQuantError } from '../src/compression/turboquant';
import type { CameraRig, DebugLine, DynamicSurfaceFrame } from '../src/types';

function approx(a: number, b: number, eps = 1e-5): void {
  ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}

function surfaceStateFinite(surface: DynamicSurfaceFrame): boolean {
  if (surface.path === 'gpu-cloth') {
    return isFiniteArray(surface.positions) && isFiniteArray(surface.restPositions);
  }
  if (surface.path === 'gpu-water') return isFiniteArray(surface.eta) && isFiniteArray(surface.u) && isFiniteArray(surface.v);
  return isFiniteArray(surface.vertices);
}

function hasTiltedTaggedPanel(
  frame: { matrices: Float32Array; colors: Float32Array; instanceCount: number },
  materialTag: number,
  thinAxis: 1 | 2,
  thinMaximum: number,
): boolean {
  for (let instance = 0; instance < frame.instanceCount; instance++) {
    if (frame.colors[instance * 4 + 3] !== materialTag) continue;
    const matrixOffset = instance * 16;
    const lengths = [0, 0, 0];
    for (let column = 0; column < 3; column++) {
      const offset = matrixOffset + column * 4;
      lengths[column] = Math.hypot(frame.matrices[offset], frame.matrices[offset + 1], frame.matrices[offset + 2]);
    }
    if (lengths[thinAxis] >= thinMaximum) continue;
    const broadAxes = [0, 1, 2].filter((axis) => axis !== thinAxis);
    if (lengths[broadAxes[0]] <= 0.08 || lengths[broadAxes[1]] <= 0.08) continue;
    const thinOffset = matrixOffset + thinAxis * 4;
    const offAxis = thinAxis === 1
      ? Math.abs(frame.matrices[thinOffset]) + Math.abs(frame.matrices[thinOffset + 2])
      : Math.abs(frame.matrices[thinOffset]) + Math.abs(frame.matrices[thinOffset + 1]);
    if (offAxis / Math.max(lengths[thinAxis], 1e-8) > 1e-3) return true;
  }
  return false;
}

function testMath(): void {
  const id = mat4Identity();
  const model = new Float32Array(16);
  writeModelMatrixFromEuler(model, 0, [1, 2, 3], [0, 0, 0], [2, 3, 4]);
  const result = mat4Multiply(id, model);
  for (let i = 0; i < 16; i++) approx(result[i], model[i]);
  approx(model[0], 2);
  approx(model[5], 3);
  approx(model[10], 4);
  approx(model[12], 1);
  approx(model[13], 2);
  approx(model[14], 3);

  const axisAligned = new Float32Array(16);
  writeAxisAlignedModelMatrix(axisAligned, 0, [1, 2, 3], 2, 3, 4);
  deepEqual(
    [...new Uint32Array(axisAligned.buffer)],
    [...new Uint32Array(model.buffer)],
    'axis-aligned matrix specialization must be bit-identical to zero-angle Euler output',
  );

  const perspective = mat4Perspective(Math.PI / 3, 16 / 9, 0.08, 360);
  const orthographic = mat4Orthographic(-50, 50, -30, 30, 0.1, 190);
  ok(isFiniteArray(perspective), 'perspective matrix must be finite');
  ok(isFiniteArray(orthographic), 'orthographic matrix must be finite');
  ok(perspective[0] > 0 && perspective[5] > 0, 'perspective focal terms must be positive');
  ok(orthographic[0] > 0 && orthographic[5] > 0, 'orthographic scale terms must be positive');
}

function testAllocationFreeCameraMatrices(): void {
  const perspective = mat4Perspective(Math.PI / 3, 16 / 9, 0.08, 360);
  const perspectiveOut = new Float32Array(16).fill(99);
  equal(mat4PerspectiveInto(perspectiveOut, Math.PI / 3, 16 / 9, 0.08, 360), perspectiveOut);
  deepEqual([...perspectiveOut], [...perspective], 'perspective into path must remain bit-identical');

  const orthographic = mat4Orthographic(-50, 50, -30, 30, 0.1, 190);
  const orthographicOut = new Float32Array(16).fill(99);
  equal(mat4OrthographicInto(orthographicOut, -50, 50, -30, 30, 0.1, 190), orthographicOut);
  deepEqual([...orthographicOut], [...orthographic], 'orthographic into path must remain bit-identical');

  const eye: [number, number, number] = [13.25, 8.5, -27.75];
  const target: [number, number, number] = [2.5, 1.25, -3.75];
  const up: [number, number, number] = [0, 1, 0];
  const lookAt = mat4LookAt(eye, target, up);
  const lookAtOut = new Float32Array(16).fill(99);
  equal(mat4LookAtInto(lookAtOut, eye, target, up), lookAtOut);
  deepEqual([...lookAtOut], [...lookAt], 'look-at into path must remain bit-identical');

  const multiplied = mat4Multiply(perspective, lookAt);
  const multipliedOut = new Float32Array(16).fill(99);
  equal(mat4MultiplyInto(multipliedOut, perspective, lookAt), multipliedOut);
  deepEqual([...multipliedOut], [...multiplied], 'multiply into path must remain bit-identical');

  const lightDirection = vec3Normalize([0.42, -0.84, 0.34]);
  const cache = new CameraMatrixCache();
  const noShake: CameraShakeInput = { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] };

  function legacyFrame(rig: CameraRig, shake: CameraShakeInput, aspect: number) {
    const frameRig: CameraRig = {
      yaw: rig.yaw + shake.yaw,
      pitch: clamp(rig.pitch + shake.pitch, 0.08, 1.3),
      distance: rig.distance,
      target: vec3Add(rig.target, shake.targetOffset),
    };
    const cp = Math.cos(frameRig.pitch);
    const frameEye: [number, number, number] = [
      frameRig.target[0] + Math.cos(frameRig.yaw) * cp * frameRig.distance,
      frameRig.target[1] + Math.sin(frameRig.pitch) * frameRig.distance,
      frameRig.target[2] + Math.sin(frameRig.yaw) * cp * frameRig.distance,
    ];
    const projection = mat4Perspective((58 * Math.PI) / 180, aspect, 0.08, 360);
    const view = mat4LookAt(frameEye, frameRig.target, [0, 1, 0]);
    const shadowExtent = clamp(frameRig.distance * 1.35, 34, 86);
    const lightEye = vec3Sub(frameRig.target, vec3Scale(lightDirection, 92));
    const lightView = mat4LookAt(lightEye, frameRig.target, [0, 1, 0]);
    const lightProjection = mat4Orthographic(-shadowExtent, shadowExtent, -shadowExtent, shadowExtent, 0.1, 190);
    return {
      viewProjection: mat4Multiply(projection, view),
      lightViewProjection: mat4Multiply(lightProjection, lightView),
      eye: frameEye,
    };
  }

  const cinematic = sampleShowcaseCamera(AAA_SHOWCASES[0], AAA_SHOWCASES[0].duration * 0.47);
  const cases: Array<{ rig: CameraRig; shake: CameraShakeInput; aspect: number }> = [
    { rig: SCENES[0].camera, shake: noShake, aspect: 16 / 9 },
    { rig: { ...SCENES[0].camera, yaw: SCENES[0].camera.yaw + 0.17 }, shake: noShake, aspect: 16 / 9 },
    { rig: { ...SCENES[0].camera, pitch: 1.29 }, shake: { yaw: 0.03, pitch: 0.2, targetOffset: [0, 0, 0] }, aspect: 16 / 9 },
    { rig: { ...SCENES[0].camera, distance: SCENES[0].camera.distance * 0.82 }, shake: noShake, aspect: 16 / 9 },
    { rig: { ...SCENES[0].camera, target: [3.25, 6.5, -2.75] }, shake: noShake, aspect: 16 / 9 },
    { rig: cinematic, shake: { yaw: -0.018, pitch: 0.011, targetOffset: [0.2, -0.1, 0.15] }, aspect: 21 / 9 },
    { rig: cinematic, shake: noShake, aspect: 4 / 3 },
  ];

  let resultIdentity: ReturnType<CameraMatrixCache['resolve']> | null = null;
  for (const entry of cases) {
    const expected = legacyFrame(entry.rig, entry.shake, entry.aspect);
    const actual = cache.resolve(entry.rig, entry.shake, entry.aspect, lightDirection);
    deepEqual([...actual.viewProjection], [...expected.viewProjection], 'camera view-projection must remain bit-identical');
    deepEqual([...actual.lightViewProjection], [...expected.lightViewProjection], 'camera light matrix must remain bit-identical');
    deepEqual(actual.eye, expected.eye, 'camera eye must remain bit-identical');
    if (resultIdentity) equal(actual, resultIdentity, 'camera cache must retain its result object');
    resultIdentity = actual;
  }

  const finalCase = cases[cases.length - 1];
  const stable = cache.resolve(finalCase.rig, finalCase.shake, finalCase.aspect, lightDirection);
  const stableView = stable.viewProjection;
  const stableLight = stable.lightViewProjection;
  const stableEye = stable.eye;
  for (let i = 0; i < 32; i++) {
    const repeated = cache.resolve(finalCase.rig, finalCase.shake, finalCase.aspect, lightDirection);
    equal(repeated, stable, 'unchanged camera must reuse the complete frame');
    equal(repeated.viewProjection, stableView, 'unchanged camera must reuse view-projection storage');
    equal(repeated.lightViewProjection, stableLight, 'unchanged camera must reuse light-matrix storage');
    equal(repeated.eye, stableEye, 'unchanged camera must reuse eye storage');
  }
}

function testSceneCatalog(): void {
  equal(SCENES.length, 800);
  equal(FEATURED_SCENE_IDS.length, 32);
  const ids = new Set(SCENES.map((scene) => scene.id));
  equal(ids.size, SCENES.length);
  deepEqual([...ids].slice(0, 5), [0, 1, 2, 3, 4]);
  deepEqual([...ids].slice(-5), [795, 796, 797, 798, 799]);
  for (const category of SCENE_CATEGORIES) {
    ok(SCENES.some((scene) => scene.category === category), `${category} should have scenes`);
  }
  for (const scene of SCENES) {
    ok(sceneLabel(scene).startsWith(String(scene.id + 1).padStart(3, '0')));
    ok(scene.title.length > 5);
    ok(scene.defaultStress >= 1 && scene.defaultStress <= 5);
    ok(scene.variant >= 0 && scene.variant < 10);
    ok(scene.tags.length >= 4);
    ok(scene.camera.pitch >= 0.08 && scene.camera.pitch <= 1.3, `${scene.title} camera elevation must remain above the scene`);
    const cameraEyeY = scene.camera.target[1] + Math.sin(scene.camera.pitch) * scene.camera.distance;
    ok(cameraEyeY > scene.camera.target[1], `${scene.title} camera eye must be above its target`);
  }
}

function testHeroShowcaseCatalog(): void {
  equal(AAA_SHOWCASES.length, 65);
  equal(AAA_SIGNATURE_SHOWCASES.length, 10);
  const ids = new Set(AAA_SHOWCASES.map((showcase) => showcase.id));
  equal(ids.size, AAA_SHOWCASES.length, 'showcase IDs must be unique');
  equal(AAA_SHOWCASES.filter((showcase) => showcase.materialDemoId !== undefined).length, 31, 'every material recipe must own one cinematic showcase');

  for (let i = 0; i < AAA_SHOWCASES.length; i++) {
    const showcase = AAA_SHOWCASES[i];
    const scene = getShowcaseScene(showcase);
    ok(SCENES.some((candidate) => candidate.id === showcase.sceneId), `${showcase.title} must retain a valid native/fallback scene ID`);
    equal(scene.id, showcase.sceneId, `${showcase.title} derived scene must retain the stable base ID`);
    equal(scene.materialDemoId, showcase.materialDemoId, `${showcase.title} material recipe was not preserved by scene resolution`);
    if (showcase.materialDemoId) {
      const recipe = getMaterialDemoRecipe(showcase.materialDemoId);
      ok(recipe, `${showcase.title} must reference a registered material recipe`);
      equal(scene.title, recipe!.title, `${showcase.title} must resolve the recipe-authored scene title`);
      equal(scene.family, 'fracture', `${showcase.title} must resolve through the fracture simulation family`);
    }
    ok(showcase.title.length > 8);
    ok(showcase.tagline.length > 24);
    ok(showcase.objective.length > 32);
    ok(showcase.duration >= 12);
    ok(showcase.cameraTrack.length >= 5);
    ok(showcase.beats.length >= 6);
    ok(showcase.beats.every((beat, index) => index === 0 || beat.at >= showcase.beats[index - 1].at), `${showcase.title} beats must be sorted`);
    ok(showcase.cameraTrack.every((key, index) => index === 0 || key.at >= showcase.cameraTrack[index - 1].at), `${showcase.title} camera keys must be sorted`);

    for (const time of [0, showcase.duration * 0.25, showcase.duration * 0.5, showcase.duration * 0.75, showcase.duration]) {
      const camera = sampleShowcaseCamera(showcase, time);
      ok(Number.isFinite(camera.yaw + camera.pitch + camera.distance + camera.target[0] + camera.target[1] + camera.target[2]), `${showcase.title} camera must be finite`);
      ok(camera.distance >= 8, `${showcase.title} camera distance must remain usable`);
      ok(camera.pitch >= 0.08 && camera.pitch <= 1.3, `${showcase.title} camera elevation must remain above the scene`);
      const eyeY = camera.target[1] + Math.sin(camera.pitch) * camera.distance;
      ok(eyeY > camera.target[1], `${showcase.title} camera eye must be above its target`);
    }

    equal(getShowcaseById(showcase.id).id, showcase.id);
    equal(getShowcaseByOrdinal(i + AAA_SHOWCASES.length).id, showcase.id);
  }

  const dentHero = getShowcaseById('titan-metal-bend-and-dent');
  equal(dentHero.sceneId, 780, 'metal dent hero must use the Structural Steel Impact Demo recipe');
  ok(dentHero.beats.filter((beat) => beat.action === 'dent-strike').length >= 2, 'metal dent hero requires two instrumented strike beats');
  ok(dentHero.beats.some((beat) => beat.action === 'release-load'), 'metal dent hero must unload for springback inspection');
}

function testMaterialDemoRegistryContracts(): void {
  equal(MATERIAL_DEMO_RECIPES.length, 31, 'material presentation registry must contain exactly thirty laboratories plus one combined finale');
  deepEqual(materialDemoCounts(), { metal: 10, glass: 10, concrete: 10, combined: 1 });
  equal(new Set(MATERIAL_DEMO_RECIPES.map((recipe) => recipe.id)).size, 31, 'material demo IDs must be unique');
  equal(new Set(MATERIAL_DEMO_RECIPES.map((recipe) => recipe.title)).size, 31, 'material demo titles must be unique');

  const materialShowcases = AAA_SHOWCASES.filter((showcase) => showcase.materialDemoId !== undefined);
  deepEqual(
    [...materialShowcases.map((showcase) => showcase.materialDemoId!)].sort(),
    [...MATERIAL_DEMO_RECIPES.map((recipe) => recipe.id)].sort(),
    'every material demo recipe must map one-to-one to a cinematic showcase',
  );

  for (const recipe of MATERIAL_DEMO_RECIPES) {
    equal(getMaterialDemoRecipe(recipe.id), recipe, `${recipe.id} registry lookup must retain object identity`);
    const scene = sceneForMaterialDemo(recipe.id);
    equal(scene.id, recipe.baseSceneId, `${recipe.id} must preserve its stable native/fallback ID`);
    equal(scene.family, 'fracture', `${recipe.id} must use the material fracture simulation family`);
    equal(scene.variant, recipe.profileVariant, `${recipe.id} must select its authored material profile`);
    equal(scene.materialDemoId, recipe.id, `${recipe.id} must survive preset derivation`);
    equal(scene.title, recipe.title, `${recipe.id} must retain its authored presentation title`);
    equal(scene.defaultStress, recipe.recommendedStress, `${recipe.id} stress recommendation changed`);
    ok(scene.tags.includes('material-demo') && scene.tags.includes(recipe.kind), `${recipe.id} must remain searchable by presentation kind`);
    ok(recipe.primaryLoad < recipe.ultimateLoad, `${recipe.id} ultimate load must exceed service load`);
    ok(recipe.primaryStrike < recipe.ultimateStrike, `${recipe.id} ultimate strike must exceed the first strike`);
    ok(recipe.loadCenter.every((value) => value >= 0 && value <= 1), `${recipe.id} load center must be normalized`);
    ok(recipe.strikeCenter.every((value) => value >= 0 && value <= 1), `${recipe.id} strike center must be normalized`);
    ok(recipe.stations <= 48 && recipe.lanes <= 15, `${recipe.id} exceeds the proven material-grid ceiling`);

    const stage = getMaterialDemoStagePrimitives(recipe.id);
    ok(stage.length >= 8, `${recipe.id} must contribute a materially dressed AAA stage`);
    for (const primitive of stage) {
      ok(isFiniteArray(primitive.pos) && isFiniteArray(primitive.half) && isFiniteArray(primitive.rot) && isFiniteArray(primitive.color), `${recipe.id} stage geometry must remain finite`);
      ok(primitive.half.every((value) => value > 0), `${recipe.id} stage geometry must have positive half extents`);
    }
  }

  equal(getMaterialDemoRecipe(undefined), null);
  equal(getMaterialDemoRecipe('not-a-material-demo'), null);
}

function testAAA100ImprovementRegistry(): void {
  equal(AAA_IMPROVEMENTS.length, 100, 'the AAA production pass must ship exactly 100 numbered improvements');
  equal(new Set(AAA_IMPROVEMENTS.map((entry) => entry.id)).size, 100, 'AAA improvement IDs must be unique');
  deepEqual(AAA_IMPROVEMENTS.map((entry) => entry.ordinal), Array.from({ length: 100 }, (_, index) => index + 1));
  deepEqual(
    [...new Set(AAA_IMPROVEMENTS.map((entry) => entry.sceneId))].sort((a, b) => a - b),
    AAA_SIGNATURE_SHOWCASES.map((showcase) => showcase.sceneId).sort((a, b) => a - b),
    'the improvement registry must target exactly the ten signature scene IDs',
  );

  for (const entry of AAA_IMPROVEMENTS) {
    ok(entry.id.trim().length > 0 && entry.label.trim().length > 0, `AAA improvement ${entry.ordinal} must have a stable ID and label`);
    ok(entry.primitives.length > 0, `AAA improvement ${entry.ordinal} must contribute visible runtime geometry`);
    for (const primitive of entry.primitives) {
      ok(isFiniteArray(primitive.pos) && isFiniteArray(primitive.half) && isFiniteArray(primitive.rot) && isFiniteArray(primitive.color), `AAA improvement ${entry.ordinal} stage primitive must be finite`);
      ok(primitive.half[0] > 0 && primitive.half[1] > 0 && primitive.half[2] > 0, `AAA improvement ${entry.ordinal} stage primitive must have positive scale`);
    }
  }

  for (const showcase of AAA_SIGNATURE_SHOWCASES) {
    const improvements = getAAAImprovementsForScene(showcase.sceneId);
    equal(improvements.length, 10, `${showcase.title} must receive exactly ten named improvements`);
    ok(improvements.every((entry) => entry.showcaseId === showcase.id), `${showcase.title} improvement ownership must be exact`);
    const primitives = getAAAStagePrimitives(showcase.sceneId);
    ok(primitives.length >= 10, `${showcase.title} must stage at least one primitive per improvement`);
  }

  equal(AAA_IMPROVEMENTS.filter((entry) => entry.category === 'architecture').length >= 25, true, 'AAA pass must materially deepen stage architecture');
  equal(AAA_IMPROVEMENTS.filter((entry) => entry.category === 'forensics').length >= 15, true, 'AAA pass must add readable engineering evidence');
  equal(AAA_IMPROVEMENTS.filter((entry) => entry.category === 'lighting').length >= 15, true, 'AAA pass must add authored lighting cues');
  equal(AAA_IMPROVEMENTS.filter((entry) => entry.category === 'safety').length >= 15, true, 'AAA pass must add safety and scale cues');

  const plazaLights = AAA_IMPROVEMENTS.find((entry) => entry.id.endsWith('-plaza-light-wells'))!;
  ok(plazaLights.primitives.every((primitive) => primitive.pos[1] - primitive.half[1] > 0.85), 'Twin Spire plaza lights must clear the opaque podium depth surface');
  const skylightRing = AAA_IMPROVEMENTS.find((entry) => entry.id.endsWith('-skylight-ring'))!;
  ok(skylightRing.primitives.every((primitive) => primitive.pos[1] - primitive.half[1] > 9.10), 'Mega Atrium skylight ring must clear the opaque roof depth surface');
}

function testFallbackCanCreateEveryScene(): void {
  const backend = new FallbackPhysicsBackend(4096);
  for (const scene of SCENES) {
    const count = backend.createScene(scene, 1, 0x1234 + scene.id);
    ok(count > 0, `${scene.title} should create bodies`);
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 24) * 16);
    ok(isFiniteArray(matrices), `${scene.title} produced non-finite matrices`);
    ok(backend.replayHash() !== 0, `${scene.title} hash should update`);
  }
}

function testFallbackStaticBodiesRemainImmutable(): void {
  type FallbackBody = {
    dynamic: boolean;
    pos: [number, number, number];
    vel: [number, number, number];
    rot: [number, number, number];
    angVel: [number, number, number];
    half: [number, number, number];
    color: [number, number, number, number];
    mass: number;
    invMass: number;
    friction: number;
    restitution: number;
    heat: number;
  };
  const backend = new FallbackPhysicsBackend(4096);
  const exposed = backend as unknown as { bodies: FallbackBody[] };

  // Mode 4 includes every family's cinematic set dressing. Sampling all ten
  // variants in all fifteen families covers every static-body constructor and
  // then exercises every public operation capable of advancing the backend.
  for (let family = 0; family < 15; family++) {
    for (let variant = 0; variant < 10; variant++) {
      const scene = SCENES[family * 50 + 40 + variant];
      backend.createScene(scene, 1, 0x57a710 + scene.id);
      const colorStart = Number(backend._b3w_colors_ptr()) / 4;
      const snapshots = exposed.bodies
        .map((body, index) => ({
          body,
          index,
          dynamic: body.dynamic,
          pos: [...body.pos],
          vel: [...body.vel],
          rot: [...body.rot],
          angVel: [...body.angVel],
          half: [...body.half],
          color: [...body.color],
          mass: body.mass,
          invMass: body.invMass,
          friction: body.friction,
          restitution: body.restitution,
          heat: body.heat,
          matrix: [...backend.HEAPF32.subarray(index * 16, index * 16 + 16)],
          streamColor: [...backend.HEAPF32.subarray(colorStart + index * 4, colorStart + index * 4 + 4)],
        }))
        .filter((snapshot) => !snapshot.dynamic);
      ok(snapshots.length > 0, `${scene.title} must contain static geometry`);

      backend.kick(14);
      backend.explode(0, 4, 0, 18, 9);
      backend.launchProjectile(-18, 7, 0, 28, 0, 0, 0.6);
      backend.spawnRain(3, 8, 14);
      backend.step(1 / 60, 2);
      backend.syncTransforms();

      for (const snapshot of snapshots) {
        const body = exposed.bodies[snapshot.index];
        equal(body, snapshot.body, `${scene.title} replaced a static body`);
        equal(body.dynamic, false, `${scene.title} made a static body dynamic`);
        deepEqual(body.pos, snapshot.pos, `${scene.title} moved a static body`);
        deepEqual(body.vel, snapshot.vel, `${scene.title} changed static linear velocity`);
        deepEqual(body.rot, snapshot.rot, `${scene.title} rotated a static body`);
        deepEqual(body.angVel, snapshot.angVel, `${scene.title} changed static angular velocity`);
        deepEqual(body.half, snapshot.half, `${scene.title} resized a static body`);
        deepEqual(body.color, snapshot.color, `${scene.title} recolored a static body`);
        equal(body.mass, snapshot.mass);
        equal(body.invMass, snapshot.invMass);
        equal(body.friction, snapshot.friction);
        equal(body.restitution, snapshot.restitution);
        equal(body.heat, snapshot.heat, `${scene.title} heated a static body`);
        deepEqual(
          [...backend.HEAPF32.subarray(snapshot.index * 16, snapshot.index * 16 + 16)],
          snapshot.matrix,
          `${scene.title} rewrote a static matrix differently`,
        );
        deepEqual(
          [...backend.HEAPF32.subarray(colorStart + snapshot.index * 4, colorStart + snapshot.index * 4 + 4)],
          snapshot.streamColor,
          `${scene.title} rewrote a static material differently`,
        );
      }
    }
  }
  backend.destroy();
}

function testAAACinematicSetDressing(): void {
  const baseline = new FallbackPhysicsBackend(4096);
  const cinematic = new FallbackPhysicsBackend(4096);
  const baselineCount = baseline.createScene(SCENES[0], 1, 0x4141);
  const cinematicCount = cinematic.createScene(SCENES[40], 1, 0x4141);
  ok(cinematicCount > baselineCount, `AAA scene should add authored set dressing (${cinematicCount} > ${baselineCount})`);

  for (const showcase of AAA_SHOWCASES) {
    const scene = getShowcaseScene(showcase);
    const count = cinematic.createScene(scene, showcase.recommendedStress, 0x7000 + scene.id);
    ok(count > 10, `${showcase.title} should create a substantial hero scene`);
    cinematic.step(1 / 60, 2);
    const start = Number(cinematic._b3w_matrices_ptr()) / 4;
    ok(isFiniteArray(cinematic.HEAPF32.subarray(start, start + Math.min(48, count) * 16)), `${showcase.title} matrices must remain finite`);
  }

  for (const showcase of AAA_SIGNATURE_SHOWCASES) {
    const scene = getShowcaseScene(showcase);
    const count = cinematic.createScene(scene, showcase.recommendedStress, 0xa000 + scene.id);
    const colorStart = Number(cinematic._b3w_colors_ptr()) / 4;
    let texturedBodies = 0;
    for (let index = 0; index < count; index++) {
      const materialTag = cinematic.HEAPF32[colorStart + index * 4 + 3];
      if (materialTag <= -1 && materialTag >= -5) texturedBodies++;
    }
    ok(texturedBodies >= 2, `${showcase.title} should contain authored atlas/glass materials`);
  }
}

function testFeaturedScenesStep(): void {
  const backend = new FallbackPhysicsBackend(4096);
  for (const id of FEATURED_SCENE_IDS) {
    const scene = SCENES[id];
    ok(scene, `featured scene ${id} should exist`);
    backend.createScene(scene, 1, 0x5000 + id);
    for (let i = 0; i < 3; i++) backend.step(1 / 60, 1);
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + Math.min(backend.bodyCount(), 32) * 16);
    ok(isFiniteArray(matrices), `${scene.title} stepped into invalid matrices`);
  }
}

function testDeterminism(): void {
  const scene = SCENES[40];
  const a = new FallbackPhysicsBackend(4096);
  const b = new FallbackPhysicsBackend(4096);
  a.createScene(scene, 2, 0xbeef);
  b.createScene(scene, 2, 0xbeef);
  for (let i = 0; i < 12; i++) {
    a.step(1 / 60, 2);
    b.step(1 / 60, 2);
  }
  equal(a.replayHash(), b.replayHash(), 'same seed AAA replay hash should match');
}

function testFallbackCoherentBroadphase(): void {
  const scene = SCENES.find((candidate) => candidate.family === 'rain' && candidate.mode === 4 && candidate.variant === 9);
  ok(scene, 'maximum rain scene should exist');
  const a = new FallbackPhysicsBackend(4096);
  const b = new FallbackPhysicsBackend(4096);
  a.createScene(scene!, 5, 0x5a9b00);
  b.createScene(scene!, 5, 0x5a9b00);
  equal(a.spawnRain(180, 28, 34), b.spawnRain(180, 28, 34));
  for (let i = 0; i < 10; i++) {
    a.step(1 / 60, 2);
    b.step(1 / 60, 2);
  }
  equal(a.replayHash(), b.replayHash(), 'coherent broadphase must remain deterministic after body growth');
  equal(a.broadphaseAxis(), b.broadphaseAxis(), 'broadphase axis selection must be deterministic');
  equal(a.broadphaseCandidateCount(), b.broadphaseCandidateCount(), 'candidate discovery must be deterministic');
  const pairLimit = a.bodyCount() > 900 ? 420 : a.bodyCount() > 650 ? 560 : a.bodyCount();
  const bruteForcePairs = pairLimit * (pairLimit - 1) * 0.5;
  ok(a.broadphaseCandidateCount() < bruteForcePairs, 'sweep-and-prune should reject broadphase pairs');
}

function testFallbackContactResolutionReusesBodyVectors(): void {
  type ExposedBody = { dynamic: boolean; pos: [number, number, number]; vel: [number, number, number] };
  const backend = new FallbackPhysicsBackend(4096);
  const exposed = backend as unknown as { bodies: ExposedBody[] };
  backend.createScene(SCENES[49], 5, 0xa110ca7);
  const references = exposed.bodies.map((body) => ({ body, pos: body.pos, vel: body.vel }));
  for (let frame = 0; frame < 8; frame++) backend.step(1 / 60, 4);
  ok(backend.broadphaseCandidateCount() > 0, 'contact-vector regression must exercise resolved broadphase pairs');
  equal(exposed.bodies.length, references.length, 'contact-vector regression must retain the original bodies');
  for (let index = 0; index < references.length; index++) {
    equal(exposed.bodies[index], references[index].body, `body ${index} object identity changed`);
    equal(exposed.bodies[index].pos, references[index].pos, `body ${index} position vector was reallocated`);
    equal(exposed.bodies[index].vel, references[index].vel, `body ${index} velocity vector was reallocated`);
  }
  backend.destroy();
}

function testFallbackCachedCountsStaticStepsAndSceneReset(): void {
  type ExposedBody = { dynamic: boolean };
  const backend = new FallbackPhysicsBackend(4096);
  const exposed = backend as unknown as { bodies: ExposedBody[] };

  // Baseline cloth and rope stages contain immutable rigid scenery only. Their
  // rigid backend must not publish synthetic revisions or touch the streams
  // while the separate soft solver advances.
  const staticStages = SCENES.filter((scene) =>
    (scene.family === 'cloth' || scene.family === 'rope') && scene.mode < 3,
  );
  equal(staticStages.length, 60, 'static-stage regression must cover 30 cloth and 30 rope recipes');
  for (const scene of staticStages) {
    backend.createScene(scene, 2, 0x5a7100 + scene.id);
    equal(backend.dynamicCount(), 0, `${scene.title} rigid stage should be static-only`);
    equal(backend.dynamicCount(), exposed.bodies.filter((body) => body.dynamic).length);
    const count = backend.bodyCount();
    const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
    const colorStart = Number(backend._b3w_colors_ptr()) / 4;
    const matrices = [...backend.HEAPF32.subarray(matrixStart, matrixStart + count * 16)];
    const colors = [...backend.HEAPF32.subarray(colorStart, colorStart + count * 4)];
    const transformVersion = backend.frameVersion();
    const colorVersion = backend.colorVersion();
    const hash = backend.replayHash();
    for (let frame = 0; frame < 120; frame++) backend.step(1 / 60, 4);
    deepEqual([...backend.HEAPF32.subarray(matrixStart, matrixStart + count * 16)], matrices, `${scene.title} static matrices changed`);
    deepEqual([...backend.HEAPF32.subarray(colorStart, colorStart + count * 4)], colors, `${scene.title} static colors changed`);
    equal(backend.frameVersion(), transformVersion, `${scene.title} published a redundant transform revision`);
    equal(backend.colorVersion(), colorVersion, `${scene.title} published a redundant color revision`);
    equal(backend.replayHash(), hash, `${scene.title} replay hash changed while static`);
  }

  // A private scene reset may leave inactive storage untouched, but every
  // active byte must exactly match a fresh backend. Re-expanding the scene must
  // also overwrite the old active range deterministically.
  const largeScene = SCENES[49];
  const smallScene = staticStages[0];
  const referenceLarge = new FallbackPhysicsBackend(4096);
  const referenceSmall = new FallbackPhysicsBackend(4096);
  referenceLarge.createScene(largeScene, 5, 0x1a23b4c5);
  referenceSmall.createScene(smallScene, 2, 0x6d7e8f90);

  backend.createScene(largeScene, 5, 0x1a23b4c5);
  equal(backend.dynamicCount(), exposed.bodies.filter((body) => body.dynamic).length, 'cached dynamic count must match the large scene');
  backend.HEAPF32[backend.HEAPF32.length - 1] = 123.5;
  backend.createScene(smallScene, 2, 0x6d7e8f90);
  equal(backend.HEAPF32[backend.HEAPF32.length - 1], 123.5, 'scene replacement should not clear inactive heap storage');
  equal(backend.bodyCount(), referenceSmall.bodyCount());
  equal(backend.dynamicCount(), referenceSmall.dynamicCount());
  deepEqual(
    [...backend.HEAPF32.subarray(0, backend.bodyCount() * 16)],
    [...referenceSmall.HEAPF32.subarray(0, referenceSmall.bodyCount() * 16)],
    'large-to-small reset changed active matrices',
  );
  const colorStart = Number(backend._b3w_colors_ptr()) / 4;
  deepEqual(
    [...backend.HEAPF32.subarray(colorStart, colorStart + backend.bodyCount() * 4)],
    [...referenceSmall.HEAPF32.subarray(colorStart, colorStart + referenceSmall.bodyCount() * 4)],
    'large-to-small reset changed active colors',
  );
  equal(backend.replayHash(), referenceSmall.replayHash(), 'large-to-small reset changed the active replay hash');

  backend.createScene(largeScene, 5, 0x1a23b4c5);
  equal(backend.bodyCount(), referenceLarge.bodyCount());
  equal(backend.dynamicCount(), referenceLarge.dynamicCount());
  deepEqual(
    [...backend.HEAPF32.subarray(0, backend.bodyCount() * 16)],
    [...referenceLarge.HEAPF32.subarray(0, referenceLarge.bodyCount() * 16)],
    'small-to-large reset changed active matrices',
  );
  deepEqual(
    [...backend.HEAPF32.subarray(colorStart, colorStart + backend.bodyCount() * 4)],
    [...referenceLarge.HEAPF32.subarray(colorStart, colorStart + referenceLarge.bodyCount() * 4)],
    'small-to-large reset changed active colors',
  );
  equal(backend.replayHash(), referenceLarge.replayHash(), 'small-to-large reset changed the active replay hash');
  const dynamicBeforeActions = backend.dynamicCount();
  ok(backend.launchProjectile(-10, 8, 0, 16, 0, 0, 0.5) >= 0);
  equal(backend.spawnRain(3, 4, 12), 3);
  equal(backend.dynamicCount(), dynamicBeforeActions + 4, 'cached dynamic count must include successful action spawns');
  equal(backend.dynamicCount(), exposed.bodies.filter((body) => body.dynamic).length);

  backend.destroy();
  equal(backend.bodyCount(), 0);
  equal(backend.dynamicCount(), 0);
  equal(backend.replayHash(), 0);
  ok(backend.HEAPF32.every((value) => value === 0), 'public destroy must preserve its zeroed-heap contract');
}


function testSoftSimulationCatalog(): void {
  const suite = new SoftSimulationSuite();
  const counts = { cloth: 0, rope: 0, water: 0, fracture: 0 };
  for (const scene of SCENES) {
    if (scene.family !== 'cloth' && scene.family !== 'rope' && scene.family !== 'water' && scene.family !== 'fracture') continue;
    counts[scene.family]++;
    ok(suite.createScene(scene, Math.min(3, scene.defaultStress), 0x810000 + scene.id), `${scene.title} should activate a soft/fluid solver`);
    for (let i = 0; i < 4; i++) suite.step(1 / 60, 2);
    const frame = suite.buildFrame(true);
    equal(frame.kind, scene.family);
    ok(frame.label.length > 10, `${scene.title} must expose solver telemetry`);
    ok(frame.nodeCount > 0, `${scene.title} must have simulation nodes`);
    ok(frame.constraintCount > 0, `${scene.title} must expose constraints/cells`);
    ok(frame.instanceCount <= SOFT_INSTANCE_BUDGET, `${scene.title} exceeded the soft instance budget`);
    ok(isFiniteArray(frame.matrices), `${scene.title} produced non-finite instance matrices`);
    ok(isFiniteArray(frame.colors), `${scene.title} produced non-finite instance colors`);
    ok(Number.isFinite(frame.energy) && frame.energy >= 0, `${scene.title} produced invalid energy telemetry`);
    ok(frame.hash !== 0, `${scene.title} must produce a replay hash`);
    const validation = suite.validate();
    ok(validation.ok, validation.message);

    if (scene.family === 'cloth' || scene.family === 'water') {
      ok(frame.surface, `${scene.title} requires a dynamic indexed surface`);
      if (scene.family === 'water') equal(frame.surface!.path, 'gpu-water', `${scene.title} should use GPU-resident water reconstruction`);
      else if (scene.variant === 6 || (scene.mode >= 3 && scene.variant === 7)) {
        equal(frame.surface!.path, 'packed', `${scene.title} should retain topology-aware packed rendering while tearing`);
      } else {
        equal(frame.surface!.path, 'gpu-cloth', `${scene.title} should use GPU-resident intact-cloth reconstruction`);
      }
      ok(frame.surface!.vertexCount > 0 && frame.surface!.indexCount > 0, `${scene.title} surface must contain topology`);
      if (frame.surface!.path === 'packed') {
        equal(frame.surface!.material, 'cloth', `${scene.title} packed surfaces are reserved for topology-changing cloth`);
      }
      if (scene.family === 'water') {
        equal(frame.surface!.material, 'water', `${scene.title} water must use the GPU-water material path`);
      }
      ok(surfaceStateFinite(frame.surface!), `${scene.title} surface state must be finite`);
      if (frame.surface!.path === 'packed') {
        equal(frame.surface!.vertexStride, PACKED_SURFACE_VERTEX_BYTES);
        equal(frame.surface!.vertices.byteLength, frame.surface!.vertexCount * frame.surface!.vertexStride);
      } else if (frame.surface!.path === 'gpu-cloth') {
        equal(frame.surface!.positions.length, frame.surface!.vertexCount * 3);
        equal(frame.surface!.restPositions.length, frame.surface!.vertexCount * 3);
      } else {
        equal(frame.surface!.eta.length, frame.surface!.vertexCount);
        equal(frame.surface!.u.length, frame.surface!.vertexCount);
        equal(frame.surface!.v.length, frame.surface!.vertexCount);
      }
      ok(frame.surface!.indices instanceof Uint16Array, `${scene.title} surface indices must use uint16`);
      ok(frame.surface!.indices.length >= frame.surface!.indexCount);
      let maxIndex = 0;
      for (let i = 0; i < frame.surface!.indexCount; i++) maxIndex = Math.max(maxIndex, frame.surface!.indices[i]);
      ok(maxIndex < frame.surface!.vertexCount, `${scene.title} surface index ${maxIndex} is out of range`);
      equal(frame.ropeGrid, null, `${scene.title} should not expose a rope grid`);
    } else {
      const presentation = scene.family === 'fracture' ? 'material' : 'rope';
      equal(frame.surface, null, `${scene.title} is rendered as GPU-computed beam segments`);
      ok(frame.ropeGrid, `${scene.title} must expose a GPU segment grid`);
      equal(frame.ropeGrid!.presentation, presentation, `${scene.title} exposed the wrong segment presentation`);
      const skinOnlyRig =
        scene.family === 'fracture' && (
          (scene.mode === 3 && scene.variant <= 2) ||
          (scene.mode === 4 && (scene.variant <= 2 || scene.variant === 6))
        );
      if (skinOnlyRig) equal(frame.ropeGrid!.segmentCount, 0, `${scene.title} must hide its internal solver lattice`);
      else ok(frame.ropeGrid!.segmentCount > 0, `${scene.title} must render active segments`);
      ok(frame.ropeGrid!.segmentCount <= SOFT_INSTANCE_BUDGET, `${scene.title} exceeded the GPU segment budget`);
      ok(isFiniteArray(frame.ropeGrid!.positions), `${scene.title} node positions must remain finite`);
      ok(isFiniteArray(frame.ropeGrid!.segments), `${scene.title} segment metadata must remain finite`);
      equal(frame.ropeGrid!.positions.length, frame.ropeGrid!.nodeCount * 3);
      ok(frame.ropeGrid!.segments.length >= frame.ropeGrid!.segmentCount * 8);
      ok(frame.instanceCount >= 0, `${scene.title} CPU payload instance count must remain valid`);
      if (scene.family === 'fracture') {
        ok(frame.material, `${scene.title} must expose normalized material telemetry`);
        equal(frame.material!.label, materialPresetForVariant(scene.variant).label);
        ok(frame.material!.yieldStrain > 0 && frame.material!.breakStrain > frame.material!.yieldStrain);
        ok(frame.material!.peakDamage >= 0 && frame.material!.peakDamage <= 1);
      }
    }
  }
  deepEqual(counts, { cloth: 50, rope: 50, water: 50, fracture: 50 });
  suite.destroy();
}

function testMaximumSoftRenderCapacity(): void {
  const suite = new SoftSimulationSuite();
  let maximumCombined = 0;
  let maximumScene = '';
  for (const scene of SCENES) {
    if (scene.family !== 'cloth' && scene.family !== 'rope' && scene.family !== 'water' && scene.family !== 'fracture') continue;
    ok(suite.createScene(scene, 5, 0x910000 + scene.id), `${scene.title} should activate at maximum stress`);
    const frame = suite.buildFrame(false);
    const combined = frame.instanceCount + (frame.ropeGrid?.segmentCount ?? 0);
    if (combined > maximumCombined) {
      maximumCombined = combined;
      maximumScene = scene.title;
    }
    ok(combined <= SOFT_RENDER_INSTANCE_BUDGET, `${scene.title} requires ${combined} render instances, above the ${SOFT_RENDER_INSTANCE_BUDGET} reserved capacity`);
  }
  ok(maximumCombined > 900, `${maximumScene} should exercise a substantial combined GPU-segment plus CPU-instance stream`);
  suite.destroy();
}

function testMaterialPresetOrderingAndInvariants(): void {
  const expectedOrder = [
    'structural-steel',
    'aluminum-alloy',
    'copper',
    'oak-timber',
    'cross-laminated-timber',
    'reinforced-concrete',
    'soda-lime-glass',
    'acrylic',
    'elastomer',
    'carbon-fiber',
  ];
  equal(MATERIAL_BEHAVIOR_PRESETS.length, 10, 'material matrix requires exactly ten ordered presets');
  deepEqual(MATERIAL_BEHAVIOR_PRESETS.map((preset) => preset.id), expectedOrder);
  equal(new Set(expectedOrder).size, expectedOrder.length, 'material preset IDs must be unique');

  for (let index = 0; index < MATERIAL_BEHAVIOR_PRESETS.length; index++) {
    const preset = MATERIAL_BEHAVIOR_PRESETS[index];
    equal(materialPresetForVariant(index), preset, `${preset.id} variant mapping changed`);
    equal(materialPresetForVariant(index + MATERIAL_BEHAVIOR_PRESETS.length), preset, `${preset.id} positive wrap changed`);
    equal(materialPresetForVariant(index - MATERIAL_BEHAVIOR_PRESETS.length), preset, `${preset.id} negative wrap changed`);
    ok(preset.label.length >= 3, `${preset.id} label is incomplete`);
    ok(['ductile', 'brittle', 'progressive', 'fiber', 'hyperelastic'].includes(preset.failureMode));
    ok(Number.isFinite(preset.densityScale) && preset.densityScale > 0 && preset.densityScale <= 1.2, `${preset.id} density is invalid`);
    for (const [name, value] of [
      ['axial', preset.axialStiffness],
      ['shear', preset.shearStiffness],
      ['bend', preset.bendStiffness],
      ['damping', preset.damping],
      ['anisotropy', preset.anisotropy],
    ] as const) {
      ok(Number.isFinite(value) && value > 0 && value <= 1, `${preset.id} ${name} coefficient is outside (0, 1]`);
    }
    ok(preset.tensileYieldStrain > 0 && preset.tensileBreakStrain > preset.tensileYieldStrain, `${preset.id} tensile envelope is invalid`);
    ok(preset.compressionYieldStrain > 0 && preset.compressionBreakStrain > preset.compressionYieldStrain, `${preset.id} compression envelope is invalid`);
    ok(preset.plasticCreep >= 0 && preset.damageRate > 0 && preset.fatigueRate >= 0, `${preset.id} damage coefficients are invalid`);
    ok(isFiniteArray(preset.baseColor), `${preset.id} base color is invalid`);
    ok(preset.baseColor.slice(0, 3).every((value) => value >= 0 && value <= 1), `${preset.id} base RGB is invalid`);
    ok(preset.baseColor[3] >= -5 && preset.baseColor[3] <= 4, `${preset.id} material channel is invalid`);
    if (preset.failureMode === 'brittle') {
      ok(preset.plasticCreep <= 0.035, `${preset.id} brittle preset accumulated excessive plastic creep`);
    } else if (preset.failureMode === 'fiber') {
      ok(preset.plasticCreep <= 0.10, `${preset.id} fiber preset accumulated excessive plastic creep`);
    }
  }
}

function testMaterialFractureLoadAndActionDeterminism(): void {
  const phaseOrder = { elastic: 0, yielding: 1, fracturing: 2, failed: 3 } as const;
  let aggregateYielded = 0;
  let aggregateDamaged = 0;
  let aggregateBreaks = 0;

  for (let variant = 0; variant < MATERIAL_BEHAVIOR_PRESETS.length; variant++) {
    const scene = SCENES[750 + variant];
    const seed = (0xf4ac0000 ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
    const a = new SoftSimulationSuite();
    const b = new SoftSimulationSuite();
    ok(a.createScene(scene, 5, seed));
    ok(b.createScene(scene, 5, seed));
    let lastYielded = 0;
    let lastDamaged = 0;
    let lastBroken = 0;
    let lastPeakDamage = 0;
    let lastMaxStrain = 0;
    let lastPhase = 0;

    for (let frameIndex = 0; frameIndex < 180; frameIndex++) {
      if (frameIndex === 0) { a.setLoadTarget(0.42); b.setLoadTarget(0.42); }
      if (frameIndex === 24) { a.setLoadTarget(0.96); b.setLoadTarget(0.96); }
      if (frameIndex === 48) { a.setLoadTarget(1.38); b.setLoadTarget(1.38); }
      if (frameIndex === 72) { a.cycleLoad(); b.cycleLoad(); }
      if (frameIndex === 96) { a.setLoadTarget(2); b.setLoadTarget(2); }
      if (frameIndex === 108) { a.kick(18); b.kick(18); }
      if (frameIndex === 120) {
        equal(a.launchProjectile([-16, 9, 0], [34, -1, 0], 0.8), b.launchProjectile([-16, 9, 0], [34, -1, 0], 0.8));
        equal(a.spawnRain(18, 9, 16), b.spawnRain(18, 9, 16));
      }
      if (frameIndex === 136) { a.explode([0, 6, 0], 30, 12); b.explode([0, 6, 0], 30, 12); }
      if (frameIndex === 160) { a.releaseLoad(); b.releaseLoad(); }
      a.step(1 / 60, 4);
      b.step(1 / 60, 4);
      equal(a.hash(), b.hash(), `${scene.title} replay hash diverged at frame ${frameIndex}`);

      const frameA = a.buildFrame(false);
      const frameB = b.buildFrame(false);
      equal(frameA.brokenCount, frameB.brokenCount, `${scene.title} break count diverged at frame ${frameIndex}`);
      equal(frameA.ropeGrid?.segmentCount, frameB.ropeGrid?.segmentCount, `${scene.title} active topology diverged at frame ${frameIndex}`);
      deepEqual(frameA.material, frameB.material, `${scene.title} material telemetry diverged at frame ${frameIndex}`);
      const material = frameA.material!;
      ok(material.yieldedCount >= lastYielded, `${scene.title} yielded count regressed`);
      ok(material.damagedCount >= lastDamaged, `${scene.title} damaged count regressed`);
      ok(frameA.brokenCount >= lastBroken, `${scene.title} broken count regressed`);
      ok(material.peakDamage + 1e-8 >= lastPeakDamage, `${scene.title} peak damage regressed`);
      ok(material.maxStrain + 1e-8 >= lastMaxStrain, `${scene.title} maximum strain regressed`);
      ok(phaseOrder[material.failurePhase] >= lastPhase, `${scene.title} failure phase regressed`);
      ok(isFiniteArray(frameA.ropeGrid!.positions) && isFiniteArray(frameA.ropeGrid!.segments), `${scene.title} produced a non-finite lattice`);
      lastYielded = material.yieldedCount;
      lastDamaged = material.damagedCount;
      lastBroken = frameA.brokenCount;
      lastPeakDamage = material.peakDamage;
      lastMaxStrain = material.maxStrain;
      lastPhase = phaseOrder[material.failurePhase];
    }

    ok(a.validate().ok && b.validate().ok, `${scene.title} deterministic fracture run failed validation`);
    aggregateYielded += lastYielded;
    aggregateDamaged += lastDamaged;
    aggregateBreaks += lastBroken;
    a.destroy();
    b.destroy();
  }

  ok(aggregateYielded > 0, 'material matrix never crossed a yield threshold');
  ok(aggregateDamaged > 0, 'material matrix never accumulated damage');
  ok(aggregateBreaks > 0, 'material matrix never crossed a fracture threshold');
}

function testMetalBendingAndDentingDemo(): void {
  const scene = SCENES[780];
  equal(scene.family, 'fracture');
  equal(scene.mode, 3);
  equal(scene.variant, 0);
  const a = new SoftSimulationSuite();
  const b = new SoftSimulationSuite();
  ok(a.createScene(scene, 5, 0xd37a110));
  ok(b.createScene(scene, 5, 0xd37a110));

  for (const suite of [a, b]) suite.setLoadTarget(0.84);
  for (let frame = 0; frame < 120; frame++) {
    a.step(1 / 60, 4);
    b.step(1 / 60, 4);
  }
  for (const suite of [a, b]) suite.releaseLoad();
  for (let frame = 0; frame < 120; frame++) {
    a.step(1 / 60, 4);
    b.step(1 / 60, 4);
  }
  equal(a.dentStrike(1), b.dentStrike(1), 'instrumented dent targets must be deterministic');
  for (let frame = 0; frame < 180; frame++) {
    a.step(1 / 60, 4);
    b.step(1 / 60, 4);
    equal(a.hash(), b.hash(), `metal dent replay diverged at frame ${frame}`);
  }

  const frameA = a.buildFrame(false);
  const frameB = b.buildFrame(false);
  deepEqual(frameA.material, frameB.material, 'metal dent telemetry must be deterministic');
  const material = frameA.material!;
  ok(material.testMode.includes('dent'), 'pressure-panel demo must identify its dent load case');
  ok(material.peakDeflection > 0.50, 'instrumented strike must create a readable peak dent');
  ok(material.residualDent > 0.08, 'unloaded panel must retain a measurable permanent set');
  ok(material.residualDent < material.peakDeflection, 'springback must reduce the peak dent before residual inspection');
  ok(material.yieldedCount > 0, 'metal dent must cross the normalized ductile yield envelope');
  equal(frameA.brokenCount, 0, 'controlled dent should yield without rupturing the steel panel');
  equal(frameA.ropeGrid?.segmentCount, 0, 'cinematic metal must hide the internal solver lattice');
  ok(frameA.instanceCount >= 200, 'metal dent presentation must retain a dense continuous skin, press fixtures, and witness bands');
  ok(hasTiltedTaggedPanel(frameA, -2, 1, 0.04), 'metal skin must rotate with the simulated dent curvature');
  ok(!frameA.colors.slice(0, frameA.instanceCount * 4).some((value, index) => index % 4 === 3 && value > 1), 'cold-formed metal must not glow');
  ok(a.validate().ok && b.validate().ok, 'metal dent demo must remain finite and valid');
  a.destroy();
  b.destroy();
}

function testConcreteSpallAndGlassShardDemos(): void {
  const cases = [
    { sceneId: 795, firstLoad: 0.78, firstStrike: 0.92, secondLoad: 1.34, secondStrike: 1.48, material: 'Concrete' },
    { sceneId: 796, firstLoad: 0.18, firstStrike: 0.82, secondLoad: 0, secondStrike: 1.35, material: 'Glass' },
  ] as const;
  for (const config of cases) {
    const scene = SCENES[config.sceneId];
    const a = new SoftSimulationSuite();
    const b = new SoftSimulationSuite();
    ok(a.createScene(scene, 5, 0xa11a000 + config.sceneId));
    ok(b.createScene(scene, 5, 0xa11a000 + config.sceneId));
    for (const suite of [a, b]) suite.setLoadTarget(config.firstLoad);
    for (let frame = 0; frame < 120; frame++) { a.step(1 / 60, 4); b.step(1 / 60, 4); }
    const preStrikeFrame = a.buildFrame(false);
    if (config.material === 'Concrete') {
      ok(hasTiltedTaggedPanel(preStrikeFrame, -1, 1, 0.13), 'concrete cover must follow the loaded slab curvature');
    } else {
      ok(hasTiltedTaggedPanel(preStrikeFrame, -4, 2, 0.03), 'glass pane must follow the pre-impact elastic curvature');
    }
    equal(a.materialStrike(config.firstStrike), b.materialStrike(config.firstStrike), `${config.material} first strike target diverged`);
    for (let frame = 0; frame < 180; frame++) {
      a.step(1 / 60, 4); b.step(1 / 60, 4);
      equal(a.hash(), b.hash(), `${config.material} first fracture phase diverged at frame ${frame}`);
    }
    for (const suite of [a, b]) config.secondLoad > 0 ? suite.setLoadTarget(config.secondLoad) : suite.releaseLoad();
    for (let frame = 0; frame < 90; frame++) { a.step(1 / 60, 4); b.step(1 / 60, 4); }
    equal(a.materialStrike(config.secondStrike), b.materialStrike(config.secondStrike), `${config.material} second strike target diverged`);
    for (let frame = 0; frame < 240; frame++) {
      a.step(1 / 60, 4); b.step(1 / 60, 4);
      equal(a.hash(), b.hash(), `${config.material} final fracture phase diverged at frame ${frame}`);
    }
    const frameA = a.buildFrame(false);
    const frameB = b.buildFrame(false);
    deepEqual(frameA.material, frameB.material, `${config.material} telemetry must be deterministic`);
    const material = frameA.material!;
    ok(material.fracturedCellCount >= 20, `${config.material} must open a readable fracture field`);
    ok(material.fragmentCount >= 20, `${config.material} must retain physical fragments through final inspection`);
    ok(frameA.instanceCount >= 40, `${config.material} must render cover/pane tiles plus debris`);
    if (config.material === 'Concrete') {
      ok(material.reinforcementCount >= 80, 'concrete failure must retain substantial reinforcement bridging');
      equal(frameA.ropeGrid?.segmentCount, material.reinforcementCount, 'concrete must expose reinforcement without its solver lattice');
      for (let i = 0; i < frameA.ropeGrid!.segmentCount; i++) {
        equal(frameA.ropeGrid!.segments[i * 8 + 7], -2, 'visible concrete segments must be reinforcement steel');
      }
      ok(material.fracturedCellCount < 100, 'concrete spall must remain localized rather than deleting the full slab');
      ok(frameA.colors.slice(0, frameA.instanceCount * 4).some((value, index) => index % 4 === 3 && value === -5), 'concrete crater must use the mineral aggregate atlas tile, never woven fabric');
    } else {
      equal(material.reinforcementCount, 0, 'glass pane must not report reinforcement');
      equal(frameA.ropeGrid?.segmentCount, 0, 'glass must hide its internal solver lattice');
      ok(material.fracturedCellCount < 140, 'glass crack front must form rays rather than flood-filling the pane');
      ok(material.peakDeflection <= 4.31, 'glass opening displacement telemetry must stay within the framed display range');
      ok(frameA.colors.slice(0, frameA.instanceCount * 4).some((value, index) => index % 4 === 3 && value > 1 && value < 2), 'glass fracture must retain restrained crack-edge glints');
      ok(frameA.colors.slice(0, frameA.instanceCount * 4).some((value, index) => index % 4 === 3 && value === -4), 'glass shards must retain their transparent material tag');
    }
    ok(a.validate().ok && b.validate().ok, `${config.material} AAA demo must remain finite and valid`);
    a.destroy(); b.destroy();
  }
}

function frameHasMaterialTag(frame: SoftSimulationFrame, tag: number, minX = -Infinity, maxX = Infinity): boolean {
  for (let instance = 0; instance < frame.instanceCount; instance++) {
    if (frame.colors[instance * 4 + 3] !== tag) continue;
    const x = frame.matrices[instance * 16 + 12];
    if (x >= minX && x <= maxX) return true;
  }
  return false;
}

function testMaterialDemoSimulationContracts(): void {
  const suite = new SoftSimulationSuite();
  const individualRecipes = MATERIAL_DEMO_RECIPES.filter((recipe) => recipe.kind !== 'combined');
  equal(individualRecipes.length, 30);

  for (let index = 0; index < individualRecipes.length; index++) {
    const recipe = individualRecipes[index];
    const scene = sceneForMaterialDemo(recipe.id);
    ok(suite.createScene(scene, recipe.recommendedStress, (0x31d3a000 ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0), `${recipe.title} must activate`);
    suite.setLoadTarget(recipe.primaryLoad);
    for (let frameIndex = 0; frameIndex < 4; frameIndex++) suite.step(1 / 60, 3);
    const strike = recipe.kind === 'metal'
      ? suite.dentStrike(recipe.primaryStrike)
      : suite.materialStrike(recipe.primaryStrike);
    ok(strike >= 0, `${recipe.title} must expose its authored strike target`);
    for (let frameIndex = 0; frameIndex < 8; frameIndex++) suite.step(1 / 60, 3);

    const frame = suite.buildFrame(true);
    equal(frame.kind, 'fracture', `${recipe.title} must remain on the fracture simulation path`);
    ok(frame.label.includes(recipe.title), `${recipe.title} frame label lost the presentation identity`);
    equal(frame.surface, null, `${recipe.title} must use the material member/skin stream`);
    ok(frame.material, `${recipe.title} must publish forensic material telemetry`);
    equal(frame.material!.label, recipe.title, `${recipe.title} telemetry label changed`);
    ok(frame.material!.testMode.includes(recipe.fixtureStyle) && frame.material!.testMode.includes(recipe.loadPattern), `${recipe.title} telemetry must identify its authored rig and load case`);
    ok(frame.ropeGrid, `${recipe.title} must publish its material member grid`);
    equal(frame.ropeGrid!.presentation, 'material', `${recipe.title} must use the material GPU presentation`);
    ok(frame.nodeCount > 0 && frame.constraintCount > 0, `${recipe.title} must retain physical solver state`);
    ok(frame.instanceCount > 0 && frame.instanceCount <= SOFT_INSTANCE_BUDGET, `${recipe.title} exceeded the proven CPU proxy cap`);
    ok(isFiniteArray(frame.matrices) && isFiniteArray(frame.colors), `${recipe.title} proxy streams must remain finite`);
    ok(isFiniteArray(frame.ropeGrid!.positions) && isFiniteArray(frame.ropeGrid!.segments), `${recipe.title} material member streams must remain finite`);
    ok(frame.ropeGrid!.positions.length >= frame.ropeGrid!.nodeCount * 3, `${recipe.title} node stream is truncated`);
    ok(frame.ropeGrid!.segments.length >= frame.ropeGrid!.segmentCount * 8, `${recipe.title} segment stream is truncated`);

    if (recipe.kind === 'metal') {
      ok(frameHasMaterialTag(frame, -2), `${recipe.title} must retain the Poliigon metal material tag`);
      equal(frame.ropeGrid!.segmentCount, 0, `${recipe.title} must hide its internal sheet-solver lattice`);
    } else if (recipe.kind === 'glass') {
      ok(frameHasMaterialTag(frame, -4), `${recipe.title} must retain transparent glass tiles or shards`);
      equal(frame.ropeGrid!.segmentCount, 0, `${recipe.title} must hide its internal cohesive lattice`);
      equal(frame.material!.reinforcementCount, 0, `${recipe.title} must never synthesize reinforcement`);
    } else {
      ok(frameHasMaterialTag(frame, -1), `${recipe.title} must retain the Poliigon concrete skin tag`);
      ok(frameHasMaterialTag(frame, -5), `${recipe.title} strike must expose aggregate-rich fracture material`);
      ok(frame.ropeGrid!.segmentCount > 0, `${recipe.title} must expose surviving reinforcement`);
      equal(frame.ropeGrid!.segmentCount, frame.material!.reinforcementCount, `${recipe.title} visible member count must match reinforcement telemetry`);
      for (let segment = 0; segment < frame.ropeGrid!.segmentCount; segment++) {
        equal(frame.ropeGrid!.segments[segment * 8 + 7], -2, `${recipe.title} reinforcement must retain the steel material tag`);
      }
    }
    const validation = suite.validate();
    ok(validation.ok, `${recipe.title}: ${validation.message}`);
  }
  suite.destroy();
}

function testCombinedMaterialDemoTargetingAndDeterminism(): void {
  const recipe = MATERIAL_DEMO_RECIPES.find((candidate) => candidate.kind === 'combined');
  ok(recipe, 'combined AAA material recipe is missing');
  const scene = sceneForMaterialDemo(recipe!.id);
  const a = new SoftSimulationSuite();
  const b = new SoftSimulationSuite();
  const seed = 0xa9e3f17;
  ok(a.createScene(scene, 5, seed), 'combined material proving ground must activate');
  ok(b.createScene(scene, 5, seed), 'combined deterministic peer must activate');

  const advance = (frames: number, phase: string): void => {
    for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
      a.step(1 / 60, 4);
      b.step(1 / 60, 4);
      equal(a.hash(), b.hash(), `combined material replay diverged during ${phase} at frame ${frameIndex}`);
    }
  };

  a.setMaterialLoadTarget('metal', 0.82);
  b.setMaterialLoadTarget('metal', 0.82);
  advance(12, 'metal service forming');
  equal(a.dentStrikeTarget('metal', 0.92), b.dentStrikeTarget('metal', 0.92), 'metal bay strike target diverged');
  advance(16, 'metal dent formation');
  a.releaseMaterialLoad('metal');
  b.releaseMaterialLoad('metal');
  advance(8, 'metal springback');

  a.setMaterialLoadTarget('glass', 0.18);
  b.setMaterialLoadTarget('glass', 0.18);
  advance(8, 'glass preload');
  equal(a.materialStrikeTarget('glass', 1.04), b.materialStrikeTarget('glass', 1.04), 'glass bay strike target diverged');
  advance(20, 'glass fracture propagation');

  a.setMaterialLoadTarget('concrete', 0.78);
  b.setMaterialLoadTarget('concrete', 0.78);
  advance(10, 'concrete service loading');
  equal(a.materialStrikeTarget('concrete', 0.96), b.materialStrikeTarget('concrete', 0.96), 'concrete bay strike target diverged');
  advance(18, 'concrete spall propagation');
  a.setMaterialLoadTarget('concrete', 1.34);
  b.setMaterialLoadTarget('concrete', 1.34);
  advance(10, 'concrete ultimate loading');
  equal(a.materialStrikeTarget('concrete', 1.48), b.materialStrikeTarget('concrete', 1.48), 'concrete bay ultimate strike diverged');
  advance(18, 'combined final inspection');
  a.releaseMaterialLoad('all');
  b.releaseMaterialLoad('all');
  advance(6, 'combined unload');

  const frameA = a.buildFrame(true);
  const frameB = b.buildFrame(true);
  equal(frameA.hash, frameB.hash, 'combined material frame hashes must remain deterministic');
  deepEqual(frameA.material, frameB.material, 'combined material telemetry must remain deterministic');
  equal(frameA.kind, 'fracture');
  ok(frameA.label.includes('Apex Materials Proving Ground'));
  equal(frameA.surface, null, 'combined material finale must merge real child streams rather than replace them with a cosmetic surface');
  ok(frameA.material, 'combined material finale must publish aggregate forensic telemetry');
  ok(frameA.material!.testMode.includes('focus concrete'), 'last targeted bay must remain identifiable in aggregate telemetry');
  ok(frameA.material!.fracturedCellCount > 0, 'combined glass/concrete strikes must produce physical fracture cells');
  ok(frameA.material!.fragmentCount > 0, 'combined glass/concrete strikes must retain physical fragments');
  ok(frameA.material!.reinforcementCount > 0, 'combined concrete bay must retain steel reinforcement');

  ok(frameA.instanceCount > 0 && frameA.instanceCount <= COMBINED_MATERIAL_CPU_INSTANCE_BUDGET, 'combined CPU proxy stream exceeded its fair-allocation cap');
  ok(frameA.matrices.length >= frameA.instanceCount * 16 && frameA.colors.length >= frameA.instanceCount * 4, 'combined CPU proxy streams are truncated');
  ok(isFiniteArray(frameA.matrices) && isFiniteArray(frameA.colors), 'combined CPU proxy streams contain non-finite values');
  ok(frameHasMaterialTag(frameA, -2, -45, -12), 'left metal bay must retain the Poliigon metal tag and world-space offset');
  ok(frameHasMaterialTag(frameA, -4, -13, 13), 'center glass bay must retain transparent shards and pane tiles');
  ok(frameHasMaterialTag(frameA, -1, 12, 45), 'right concrete bay must retain the Poliigon concrete tag and world-space offset');
  ok(frameHasMaterialTag(frameA, -5, 12, 45), 'right concrete bay must expose aggregate-rich fracture debris');

  ok(frameA.ropeGrid, 'combined material finale must publish its merged material member grid');
  equal(frameA.ropeGrid!.presentation, 'material');
  ok(frameA.ropeGrid!.nodeCount > 0 && frameA.ropeGrid!.segmentCount > 0, 'combined material member grid must retain concrete reinforcement');
  ok(frameA.ropeGrid!.segmentCount <= COMBINED_MATERIAL_SEGMENT_BUDGET, 'combined material members exceeded the reserved segment cap');
  ok(frameA.instanceCount + frameA.ropeGrid!.segmentCount <= SOFT_RENDER_INSTANCE_BUDGET, 'combined material presentation exceeded the shared renderer cap');
  ok(frameA.ropeGrid!.positions.length >= frameA.ropeGrid!.nodeCount * 3, 'combined node stream is truncated');
  ok(frameA.ropeGrid!.segments.length >= frameA.ropeGrid!.segmentCount * 8, 'combined segment stream is truncated');
  ok(isFiniteArray(frameA.ropeGrid!.positions) && isFiniteArray(frameA.ropeGrid!.segments), 'combined member streams contain non-finite values');
  for (let segment = 0; segment < frameA.ropeGrid!.segmentCount; segment++) {
    const offset = segment * 8;
    const nodeA = frameA.ropeGrid!.segments[offset];
    const nodeB = frameA.ropeGrid!.segments[offset + 1];
    ok(Number.isInteger(nodeA) && nodeA >= 0 && nodeA < frameA.ropeGrid!.nodeCount, `combined segment ${segment} has an invalid first node`);
    ok(Number.isInteger(nodeB) && nodeB >= 0 && nodeB < frameA.ropeGrid!.nodeCount, `combined segment ${segment} has an invalid second node`);
    equal(frameA.ropeGrid!.segments[offset + 7], -2, `combined segment ${segment} must represent steel reinforcement`);
  }

  const validationA = a.validate();
  const validationB = b.validate();
  ok(validationA.ok, validationA.message);
  ok(validationB.ok, validationB.message);
  a.destroy();
  b.destroy();
}

function testSoftFrameMemoization(): void {
  const suite = new SoftSimulationSuite();
  for (const sceneId of [600, 650, 700, 750]) {
    const scene = SCENES[sceneId];
    ok(suite.createScene(scene, 3, 0xf18e000 + sceneId));
    const first = suite.buildFrame(false);
    const firstVersion = first.frameVersion;
    const repeated = suite.buildFrame(false);
    equal(repeated, first, `${scene.family} should reuse an unchanged frame object`);
    equal(repeated.frameVersion, firstVersion, `${scene.family} unchanged frame version should remain stable`);
    suite.step(1 / 60, 3);
    const advanced = suite.buildFrame(false);
    ok(advanced.frameVersion > firstVersion, `${scene.family} frame version should advance after simulation`);
  }
  suite.destroy();
}

function testSoftRetainedStateAndExactInstanceCaps(): void {
  const suite = new SoftSimulationSuite();

  ok(suite.createScene(SCENES[600], 5, 0x5a7e600));
  const intact = (suite as unknown as { active: {
    strain: Float32Array;
    normals: Float32Array;
    vertices: unknown;
    baseRgb: Float32Array;
    instanceMatrices: Float32Array;
    instanceColors: Float32Array;
  } }).active;
  equal(intact.strain.byteLength, 0, 'intact GPU cloth must not retain CPU strain state');
  equal(intact.normals.byteLength, 0, 'intact GPU cloth must not retain CPU normal state');
  equal(intact.vertices, null, 'intact GPU cloth must not retain a packed surface writer');
  equal(intact.baseRgb.byteLength, 0, 'intact GPU cloth must not retain CPU base-color state');
  ok(!('uvU' in intact) && !('uvV' in intact), 'cloth must not retain dead CPU UV caches');
  equal(intact.instanceMatrices.length, CLOTH_INSTANCE_BUDGET * 16);
  equal(intact.instanceColors.length, CLOTH_INSTANCE_BUDGET * 4);

  ok(suite.createScene(SCENES[606], 5, 0x5a7e606));
  const tearing = (suite as unknown as { active: {
    count: number;
    strain: Float32Array;
    normals: Float32Array;
    vertices: { data: Uint8Array } | null;
    baseRgb: Float32Array;
  } }).active;
  equal(tearing.strain.length, tearing.count, 'tearing cloth must retain strain state');
  equal(tearing.normals.length, tearing.count * 3, 'tearing cloth must retain topology-aware normals');
  equal(tearing.vertices?.data.byteLength, tearing.count * PACKED_SURFACE_VERTEX_BYTES);
  equal(tearing.baseRgb.length, tearing.count * 3, 'tearing cloth must retain packed base colors');

  // Variant 7 supplies the one cloth collider proxy. The projectile pool is
  // hard-capped at 160, so this exercises the exact 161-instance ceiling.
  ok(suite.createScene(SCENES[607], 5, 0x5a7e607));
  ok(suite.launchProjectile([-18, 8, 0], [32, 0, 0], 0.7) >= 0);
  equal(suite.spawnRain(999, 14, 24), 159);
  equal(suite.buildFrame(false).instanceCount, CLOTH_INSTANCE_BUDGET);
  ok(suite.validate().ok, 'saturated cloth instance stream must validate');

  // Every rope recipe owns at most one payload; variant 0 exercises it with
  // the complete 96-projectile pool.
  ok(suite.createScene(SCENES[650], 5, 0x5a7e650));
  ok(suite.launchProjectile([-18, 8, 0], [32, 0, 0], 0.7) >= 0);
  equal(suite.spawnRain(999, 14, 24), 95);
  const rope = (suite as unknown as { active: {
    payloads: unknown[];
    instanceMatrices: Float32Array;
    instanceColors: Float32Array;
  } }).active;
  equal(rope.payloads.length, 1);
  equal(rope.instanceMatrices.length, ROPE_INSTANCE_BUDGET * 16);
  equal(rope.instanceColors.length, ROPE_INSTANCE_BUDGET * 4);
  equal(suite.buildFrame(false).instanceCount, ROPE_INSTANCE_BUDGET);
  ok(suite.validate().ok, 'saturated rope instance stream must validate');

  // Water supports 20 floaters plus 768 droplets. Fill both pools and assert
  // that the right-sized stream reaches, rather than clamps below, that cap.
  ok(suite.createScene(SCENES[700], 5, 0x5a7e700));
  for (let i = 0; i < 20; i++) {
    ok(suite.launchProjectile([-12 + i, 8, 0], [8, 0, 0], 0.7) >= 0);
  }
  equal(suite.launchProjectile([0, 8, 0], [8, 0, 0], 0.7), -1);
  equal(suite.spawnRain(999, 14, 24), 768);
  const water = (suite as unknown as { active: {
    instanceMatrices: Float32Array;
    instanceColors: Float32Array;
  } }).active;
  equal(water.instanceMatrices.length, WATER_INSTANCE_BUDGET * 16);
  equal(water.instanceColors.length, WATER_INSTANCE_BUDGET * 4);
  equal(suite.buildFrame(false).instanceCount, WATER_INSTANCE_BUDGET);
  ok(suite.validate().ok, 'saturated water instance stream must validate');

  suite.destroy();
}

function testSoftSimulationActionsAndDeterminism(): void {
  for (const sceneId of [600, 650, 700]) {
    const scene = SCENES[sceneId];
    const a = new SoftSimulationSuite();
    const b = new SoftSimulationSuite();
    ok(a.createScene(scene, 4, 0x51f700 + sceneId));
    ok(b.createScene(scene, 4, 0x51f700 + sceneId));
    for (let i = 0; i < 18; i++) {
      a.step(1 / 60, 3);
      b.step(1 / 60, 3);
    }
    equal(a.hash(), b.hash(), `${scene.family} must replay deterministically`);

    a.kick(12);
    a.explode([0, Math.max(2, scene.camera.target[1]), 0], 28, 16);
    const projectile = a.launchProjectile([-18, 8, 0], [32, 1, 0], 0.75);
    const rain = a.spawnRain(48, 12, 20);
    ok(projectile >= 0, `${scene.family} projectile coupling should be active`);
    ok(rain > 0, `${scene.family} rain coupling should be active`);
    for (let i = 0; i < 24; i++) a.step(1 / 60, 4);
    const frame = a.buildFrame(true);
    ok(isFiniteArray(frame.matrices) && isFiniteArray(frame.colors), `${scene.family} interactions must remain finite`);
    ok(!frame.surface || surfaceStateFinite(frame.surface), `${scene.family} dynamic surface must remain finite after impacts`);
    ok(
      !frame.ropeGrid || (isFiniteArray(frame.ropeGrid.positions) && isFiniteArray(frame.ropeGrid.segments)),
      `${scene.family} GPU rope state must remain finite after impacts`,
    );
    ok(frame.hash !== 0);
    a.destroy();
    b.destroy();
  }
}

function testFarProjectileBroadRejection(): void {
  for (const sceneId of [600, 650]) {
    const scene = SCENES[sceneId];
    const baseline = new SoftSimulationSuite();
    const rejected = new SoftSimulationSuite();
    ok(baseline.createScene(scene, 4, 0xb04d000 + sceneId));
    ok(rejected.createScene(scene, 4, 0xb04d000 + sceneId));
    ok(rejected.launchProjectile([200, 200, 200], [0, 0, 0], 0.75) >= 0);
    for (let i = 0; i < 24; i++) {
      baseline.step(1 / 60, 3);
      rejected.step(1 / 60, 3);
    }
    equal(rejected.hash(), baseline.hash(), `${scene.family} far projectile must not perturb solver state`);
    baseline.destroy();
    rejected.destroy();
  }
}

function testTurboQuantCodec(): void {
  const length = 4096;
  const source = new Float32Array(length);
  const next = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    source[i] = Math.sin(i * 0.013) * 3 + Math.cos(i * 0.071) * 0.5;
    next[i] = source[i] + Math.sin(i * 0.037) * 0.025;
  }

  const dense = new TurboQuantCodec({ bits: 4, blockSize: 32, rotation: 'dense', centered: true, seed: 0x715517 });
  const densePacket = dense.encode(source);
  const denseDecoded = dense.decode(densePacket);
  const denseError = turboQuantError(source, denseDecoded);
  ok(turboQuantCompressionRatio(densePacket) > 5, 'dense TurboQuant should compress float state by more than 5x');
  ok(denseError.relativeL2 < 0.035, `dense TurboQuant reconstruction error is too high: ${denseError.relativeL2}`);

  const structuredA = new TurboQuantCodec({ bits: 3, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 });
  const structuredB = new TurboQuantCodec({ bits: 3, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 });
  const packetA = structuredA.encode(source);
  const packetB = structuredB.encode(source);
  deepEqual([...packetA.codes], [...packetB.codes], 'TurboQuant code stream must be deterministic');
  deepEqual([...packetA.norms], [...packetB.norms], 'TurboQuant block metadata must be deterministic');

  const encoder = new TurboQuantDeltaStream(length, { bits: 4, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 });
  const decoder = new TurboQuantDeltaStream(length, { bits: 4, blockSize: 64, rotation: 'structured', centered: false, seed: 0x715517 });
  const firstPacket = encoder.encodeFrame(source);
  const firstDecoded = decoder.decodeFrame(firstPacket).slice();
  const secondPacket = encoder.encodeFrame(next);
  const secondDecoded = decoder.decodeFrame(secondPacket).slice();
  const firstError = turboQuantError(source, firstDecoded);
  const secondError = turboQuantError(next, secondDecoded);
  ok(firstError.relativeL2 < 0.12, `TurboQuant keyframe error is too high: ${firstError.relativeL2}`);
  ok(secondError.relativeL2 < 0.02, `TurboQuant predictive error is too high: ${secondError.relativeL2}`);
  for (let i = 0; i < length; i++) approx(encoder.reference[i], decoder.reference[i], 1e-6);
}

function testBreakthroughStormDeterminism(): void {
  for (const sceneId of [649, 699]) {
    const scene = SCENES[sceneId];
    const a = new SoftSimulationSuite();
    const b = new SoftSimulationSuite();
    ok(a.createScene(scene, 5, 0x515500 + sceneId));
    ok(b.createScene(scene, 5, 0x515500 + sceneId));
    const expectedRain = scene.family === 'rope' ? 96 : 150;
    equal(a.spawnRain(expectedRain, 14, 24), expectedRain);
    equal(b.spawnRain(expectedRain, 14, 24), expectedRain);
    for (let frame = 0; frame < 10; frame++) {
      a.step(1 / 60, 4);
      b.step(1 / 60, 4);
    }
    equal(a.hash(), b.hash(), `${scene.family} impact broad rejection must remain deterministic`);
    ok(a.validate().ok && b.validate().ok, `${scene.family} impact storm must remain finite`);

    if (scene.family === 'cloth') {
      const active = (a as unknown as { active: {
        iterations: number;
        fastIterations: number;
        constraintCountValue: number;
        constraintA: Uint16Array;
        constraintB: Uint16Array;
        constraintRest: Float32Array;
        constraintFastScaleA: Float32Array;
        constraintFastScaleB: Float32Array;
      } }).active;
      equal(active.fastIterations, 4, 'maximum membrane cloth must retain the validated four-pass adaptive schedule');
      ok(active.iterations >= active.fastIterations, 'adaptive cloth must never exceed the authoritative iteration count');
      ok(active.constraintCountValue > 0, 'adaptive cloth must retain a non-empty packed constraint stream');
      equal(active.constraintA.length, active.constraintCountValue, 'constraint A stream must cover every packed constraint');
      equal(active.constraintB.length, active.constraintCountValue, 'constraint B stream must cover every packed constraint');
      equal(active.constraintRest.length, active.constraintCountValue, 'constraint rest-length stream must cover every packed constraint');
      equal(active.constraintFastScaleA.length, active.constraintCountValue, 'fast-scale A stream must cover every packed constraint');
      equal(active.constraintFastScaleB.length, active.constraintCountValue, 'fast-scale B stream must cover every packed constraint');
      ok(isFiniteArray(active.constraintFastScaleA), 'adaptive cloth A stiffness compensation must remain finite');
      ok(isFiniteArray(active.constraintFastScaleB), 'adaptive cloth B stiffness compensation must remain finite');
    }
    a.destroy();
    b.destroy();
  }
}

function testCinematicEffects(): void {
  const effects = new CinematicEffects();
  effects.clear(0x515151);
  const stageProps = getAAAStagePrimitives(140);
  effects.setStageProps(stageProps);
  equal(effects.stagePropCount(), stageProps.length, 'signature presentation props must be backend-neutral effect instances');
  effects.spawnExplosion([0, 3, 0], 18, 512);
  effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], 512);
  effects.spawnImpulseDust([0, 0.2, 0], 10, 512);
  effects.spawnRainFlash([0, 16, 0], 512);
  effects.spawnMetalStrike([0, 7, 0], [0, -24, 0], 1.2, 512);
  effects.spawnConcreteSpall([0, 7, 0], 1.1, 512);
  effects.spawnGlassFracture([0, 7.2, 0], 1.0, 512);
  ok(effects.particleCount() >= 100, 'cinematic events should create a meaningful effect field');

  const before = effects.buildFrame(512);
  ok(before.count >= stageProps.length);
  ok(isFiniteArray(before.matrices));
  ok(isFiniteArray(before.colors));
  ok(before.debugLines.length >= 288, 'explosion and three material strikes should create persistent shockwave rings');
  ok(before.debugLines.some((line) => Math.abs(line.az - line.bz) < 1e-6 && Math.abs(line.ay - line.by) > 1e-4), 'glass strike must create a vertical fracture wave');
  ok(before.colors.some((value, index) => index % 4 === 3 && value > 1), 'effects should carry emissive material tags');
  const beforeVersion = before.frameVersion;
  const repeated = effects.buildFrame(512);
  equal(repeated, before, 'unchanged effects should return the cached frame');
  equal(repeated.matrices, before.matrices, 'unchanged effects should reuse matrix storage');
  equal(repeated.colors, before.colors, 'unchanged effects should reuse color storage');

  effects.update(1 / 60);
  const after = effects.buildFrame(256);
  ok(after.frameVersion !== beforeVersion, 'effect simulation changes must advance the upload version');
  ok(after.count <= 256, 'effect frame must honor render budget');
  ok(isFiniteArray(after.matrices));
  const shake = effects.cameraShake();
  ok(Number.isFinite(shake.yaw + shake.pitch + shake.targetOffset[0] + shake.targetOffset[1] + shake.targetOffset[2]));

  for (let i = 0; i < 100; i++) effects.spawnExplosion([0, 3, 0], 18, 1536);
  ok(effects.particleCount() <= 3072, 'paused repeated bursts must retain a bounded transient particle pool');
  const saturated = effects.buildFrame(1536);
  ok(saturated.count <= 1536, 'saturated transient effects must retain the Ultra render budget');
  ok(saturated.debugLines.length <= 32 * 72, 'repeated bursts must retain a bounded shockwave pool');
  ok(isFiniteArray(saturated.matrices) && isFiniteArray(saturated.colors), 'bounded saturated effects must remain finite');

  const materialEffects = new CinematicEffects();
  materialEffects.clear(0x6a55123);
  materialEffects.spawnConcreteSpall([0, 7, 0], 1.1, 512);
  materialEffects.spawnGlassFracture([0, 7.2, 0], 1.0, 512);
  const materialBefore = materialEffects.buildFrame(512);
  ok(materialBefore.colors.some((value, index) => index % 4 === 3 && value === -6), 'concrete spall must include translucent dust material');
  ok(materialBefore.colors.some((value, index) => index % 4 === 3 && value === -4), 'glass fracture must include transparent shards');
  materialEffects.update(1 / 60);
  const materialAfter = materialEffects.buildFrame(512);
  ok(materialAfter.colors.some((value, index) => index % 4 === 3 && value === -6), 'dust material tags must survive effect fading');
  ok(materialAfter.colors.some((value, index) => index % 4 === 3 && value === -4), 'glass material tags must survive effect fading');
}

function testFrameLineStager(): void {
  const stager = new FrameLineStager();
  const line = (value: number): DebugLine => ({
    ax: value, ay: value + 1, az: value + 2,
    bx: value + 3, by: value + 4, bz: value + 5,
    r: 0.2, g: 0.4, b: 0.6, a: 0.8,
  });
  const rigid = [line(1), line(2)];
  const soft = [line(3)];
  const effects = [line(4)];
  let rigidBuilds = 0;
  const buildRigid = (): readonly DebugLine[] => {
    rigidBuilds++;
    return rigid;
  };

  const first = stager.resolve(true, 1, 2, 3, buildRigid, soft, effects);
  equal(first.length, 4, 'enabled diagnostics should combine every line source');
  equal(rigidBuilds, 1, 'first enabled resolve should build rigid diagnostics');
  const repeated = stager.resolve(true, 1, 2, 3, buildRigid, soft, effects);
  equal(repeated, first, 'unchanged line inputs should reuse the combined array');
  equal(rigidBuilds, 1, 'unchanged line inputs should skip rigid reconstruction');

  soft[0] = line(30);
  const changed = stager.resolve(true, 1, 4, 3, buildRigid, soft, effects);
  equal(changed, first, 'changed inputs should refill the stable combined array');
  equal(changed[2], soft[0], 'soft-version changes must refresh in-place line content');
  equal(rigidBuilds, 2, 'a changed debug source should rebuild rigid diagnostics');

  const effectsOnly = stager.resolve(false, 5, 6, 7, buildRigid, soft, effects);
  equal(effectsOnly.length, 1, 'disabled diagnostics should retain effect lines only');
  equal(effectsOnly[0], effects[0]);
  equal(rigidBuilds, 2, 'disabled diagnostics should not build rigid lines');
  const effectsRepeated = stager.resolve(false, 99, 100, 7, buildRigid, [line(90)], effects);
  equal(effectsRepeated, effectsOnly, 'disabled diagnostics should ignore rigid and soft version churn');
  equal(rigidBuilds, 2);
}

function testActions(): void {
  const backend = new FallbackPhysicsBackend(4096);
  backend.createScene(SCENES[40], 1, 0xcafe);
  const before = backend.bodyCount();
  backend.kick(6);
  backend.explode(0, 3, 0, 12, 8);
  const projectile = backend.launchProjectile(-10, 5, 0, 12, 0, 0, 0.5);
  ok(projectile >= 0, 'projectile should spawn');
  const rain = backend.spawnRain(20, 4, 8);
  equal(rain, 20);
  equal(backend.bodyCount(), before + 21);
  backend.step(1 / 60, 2);
  ok(backend.replayHash() !== 0);
}

const tests = [
  testMath,
  testAllocationFreeCameraMatrices,
  testSceneCatalog,
  testHeroShowcaseCatalog,
  testMaterialDemoRegistryContracts,
  testAAA100ImprovementRegistry,
  testFallbackCanCreateEveryScene,
  testFallbackStaticBodiesRemainImmutable,
  testAAACinematicSetDressing,
  testFeaturedScenesStep,
  testDeterminism,
  testFallbackCoherentBroadphase,
  testFallbackContactResolutionReusesBodyVectors,
  testFallbackCachedCountsStaticStepsAndSceneReset,
  testSoftSimulationCatalog,
  testMaximumSoftRenderCapacity,
  testMaterialPresetOrderingAndInvariants,
  testMaterialFractureLoadAndActionDeterminism,
  testMetalBendingAndDentingDemo,
  testConcreteSpallAndGlassShardDemos,
  testMaterialDemoSimulationContracts,
  testCombinedMaterialDemoTargetingAndDeterminism,
  testSoftRetainedStateAndExactInstanceCaps,
  testSoftSimulationActionsAndDeterminism,
  testFarProjectileBroadRejection,
  testSoftFrameMemoization,
  testTurboQuantCodec,
  testBreakthroughStormDeterminism,
  testCinematicEffects,
  testFrameLineStager,
  testActions,
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}

console.log(`All ${tests.length} unit suites passed.`);
