import { clamp, easeInOutCubic, lerp, lerpAngle, type Vec3 } from './math';
import {
  MATERIAL_DEMO_RECIPES,
  getMaterialDemoRecipe,
  materialDemoWorldPoint,
  sceneForMaterialDemo,
  type MaterialDemoKind,
  type MaterialDemoRecipe,
} from './material-demos';
import { getSceneById, type ScenePreset } from './scenes';
import type { CameraRig } from './types';

export type ShowcaseActionKind =
  | 'caption'
  | 'kick'
  | 'explode'
  | 'projectile'
  | 'rain'
  | 'dent-strike'
  | 'material-strike'
  | 'set-load'
  | 'release-load'
  | 'slowmo'
  | 'normal-speed';

export type ShowcaseBeat = {
  at: number;
  label: string;
  detail: string;
  action: ShowcaseActionKind;
  center?: Vec3;
  strength?: number;
  radius?: number;
  count?: number;
  /** Optional material bay addressed by a beat in the combined proving ground. */
  target?: Exclude<MaterialDemoKind, 'combined'>;
};

export type CameraKeyframe = {
  at: number;
  rig: CameraRig;
};

export type AAAShowcase = {
  id: string;
  sceneId: number;
  title: string;
  category: string;
  tagline: string;
  objective: string;
  duration: number;
  recommendedStress: number;
  /** Recipe-backed presentation layered over a stable native/fallback scene ID. */
  materialDemoId?: string;
  cameraTrack: readonly CameraKeyframe[];
  beats: readonly ShowcaseBeat[];
};

type ShowcaseDefinition = Omit<AAAShowcase, 'cameraTrack' | 'beats'> & {
  action: 'collapse' | 'impact' | 'storm' | 'cascade';
  focalHeight?: number;
  softSystem?: 'cloth' | 'rope' | 'water' | 'fracture';
  dentSequence?: boolean;
  materialSequence?: 'ductile' | 'concrete' | 'glass';
};

function sceneId(familyIndex: number, variant: number): number {
  return familyIndex * 50 + 40 + variant;
}

function modeSceneId(familyIndex: number, mode: number, variant: number): number {
  return familyIndex * 50 + mode * 10 + variant;
}

function rig(base: CameraRig, yawOffset: number, pitchOffset: number, distanceScale: number, targetOffset: Vec3): CameraRig {
  return {
    yaw: base.yaw + yawOffset,
    pitch: clamp(base.pitch + pitchOffset, 0.08, 1.28),
    distance: Math.max(8, base.distance * distanceScale),
    target: [
      base.target[0] + targetOffset[0],
      base.target[1] + targetOffset[1],
      base.target[2] + targetOffset[2],
    ],
  };
}

function getDefinitionRecipe(def: ShowcaseDefinition): MaterialDemoRecipe | null {
  return getMaterialDemoRecipe(def.materialDemoId);
}

function getDefinitionScene(def: ShowcaseDefinition): ScenePreset {
  return def.materialDemoId ? sceneForMaterialDemo(def.materialDemoId) : getSceneById(def.sceneId);
}

function materialCameraTrack(recipe: MaterialDemoRecipe): readonly CameraKeyframe[] {
  const base = recipe.camera;
  if (recipe.kind === 'combined') {
    // One uninterrupted master shot moves through the three independently
    // simulated bays before returning to the complete proving hall.
    return [
      { at: 0, rig: { yaw: -0.78, pitch: 0.42, distance: 102, target: [0, 7.0, 0] } },
      { at: 3.6, rig: { yaw: -1.18, pitch: 0.45, distance: 34, target: [-26, 7.0, 0] } },
      { at: 7.0, rig: { yaw: -0.42, pitch: 0.34, distance: 30, target: [-26, 7.0, 0] } },
      { at: 10.0, rig: { yaw: -0.98, pitch: 0.30, distance: 30, target: [0, 7.6, 0] } },
      { at: 14.0, rig: { yaw: -0.32, pitch: 0.40, distance: 31, target: [0, 7.4, 0] } },
      { at: 17.2, rig: { yaw: -1.18, pitch: 0.47, distance: 34, target: [26, 7.0, 0] } },
      { at: 21.8, rig: { yaw: -0.44, pitch: 0.36, distance: 31, target: [26, 7.0, 0] } },
      { at: 24.6, rig: { yaw: 0.08, pitch: 0.50, distance: 78, target: [0, 7.1, 0] } },
      { at: recipe.duration, rig: { yaw: 0.64, pitch: 0.40, distance: 104, target: [0, 6.8, 0] } },
    ];
  }

  const index = MATERIAL_DEMO_RECIPES.findIndex((candidate) => candidate.id === recipe.id);
  const presentation = index < 0 ? 0 : index % 10;
  const orbitSign = presentation % 2 === 0 ? 1 : -1;
  const yawRange = 0.50 + (presentation % 4) * 0.055;
  const closeScale = recipe.kind === 'glass' ? 0.68 : recipe.kind === 'concrete' ? 0.72 : 0.66;
  const strikeX = (recipe.strikeCenter[0] - 0.5) * recipe.span;
  const strikeTarget: Vec3 = recipe.kind === 'glass'
    ? [strikeX, 7.2 + (recipe.strikeCenter[1] - 0.5) * recipe.depth, 0]
    : [strikeX, 7.0, (recipe.strikeCenter[1] - 0.5) * recipe.depth];
  const targetOffset: Vec3 = [
    strikeTarget[0] - base.target[0],
    strikeTarget[1] - base.target[1],
    strikeTarget[2] - base.target[2],
  ];

  return [
    { at: 0, rig: rig(base, -orbitSign * yawRange, 0.05, 1.10, [0, 0, 0]) },
    { at: recipe.duration * 0.26, rig: rig(base, -orbitSign * yawRange * 0.34, -0.05, 0.80, [targetOffset[0] * 0.45, targetOffset[1] * 0.45, targetOffset[2] * 0.45]) },
    { at: recipe.duration * 0.48, rig: rig(base, orbitSign * yawRange * 0.18, 0.01, closeScale, targetOffset) },
    { at: recipe.duration * 0.72, rig: rig(base, orbitSign * yawRange * 0.78, -0.07, closeScale * 1.08, [targetOffset[0] * 0.72, targetOffset[1] * 0.72, targetOffset[2] * 0.72]) },
    { at: recipe.duration, rig: rig(base, orbitSign * yawRange * 1.28, 0.03, 1.02, [0, -0.2, 0]) },
  ];
}

function buildCameraTrack(def: ShowcaseDefinition): readonly CameraKeyframe[] {
  const recipe = getDefinitionRecipe(def);
  if (recipe) return materialCameraTrack(recipe);
  const base = getDefinitionScene(def).camera;
  const h = def.focalHeight ?? base.target[1];
  const targetLift = h - base.target[1];
  if (def.materialSequence === 'glass') {
    return [
      { at: 0, rig: rig(base, -0.68, 0.03, 1.05, [0, targetLift, 0]) },
      { at: 4.4, rig: rig(base, -0.82, -0.04, 0.76, [0, targetLift, 0]) },
      { at: 7.1, rig: rig(base, -0.44, 0.02, 0.72, [0, targetLift, 0]) },
      { at: 10.2, rig: rig(base, -0.98, 0.10, 0.86, [0, targetLift * 0.94, 0]) },
      { at: def.duration, rig: rig(base, -0.62, 0.02, 1.02, [0, targetLift * 0.86, 0]) },
    ];
  }
  if (def.materialSequence === 'concrete') {
    return [
      { at: 0, rig: rig(base, -0.62, -0.02, 1.06, [0, targetLift * 0.82, 0]) },
      { at: 4.4, rig: rig(base, -0.16, -0.10, 0.78, [0, targetLift, 0]) },
      { at: 7.3, rig: rig(base, 0.42, -0.14, 0.64, [0, targetLift * 0.98, 0]) },
      { at: 11.1, rig: rig(base, 1.02, 0.02, 0.68, [0, targetLift * 0.92, 0]) },
      { at: def.duration, rig: rig(base, 1.46, -0.08, 0.86, [0, targetLift * 0.84, 0]) },
    ];
  }
  if (def.dentSequence) {
    return [
      { at: 0, rig: rig(base, -0.72, 0.12, 1.02, [0, targetLift * 0.78, 0]) },
      { at: 4.2, rig: rig(base, -0.28, 0.20, 0.72, [0, targetLift, 0]) },
      { at: 7.9, rig: rig(base, 0.18, 0.26, 0.62, [0, targetLift * 0.98, 0]) },
      { at: 12.0, rig: rig(base, 0.72, 0.10, 0.66, [0, targetLift * 0.90, 0]) },
      { at: def.duration, rig: rig(base, 1.18, 0.18, 0.82, [0, targetLift * 0.82, 0]) },
    ];
  }
  if (def.materialSequence === 'ductile') {
    return [
      { at: 0, rig: rig(base, -0.52, -0.04, 1.10, [0, targetLift * 0.72, 0]) },
      { at: 4.5, rig: rig(base, -0.08, -0.08, 0.78, [0, targetLift, 0]) },
      { at: 8.0, rig: rig(base, 0.38, 0.01, 0.68, [0, targetLift * 0.94, 0]) },
      { at: 11.3, rig: rig(base, 0.96, -0.06, 0.64, [0, targetLift * 0.90, 0]) },
      { at: def.duration, rig: rig(base, 1.42, -0.10, 0.90, [0, targetLift * 0.80, 0]) },
    ];
  }
  return [
    { at: 0, rig: rig(base, -0.58, -0.05, 1.22, [0, targetLift * 0.35, 0]) },
    { at: 3.2, rig: rig(base, -0.10, 0.03, 0.98, [0, targetLift * 0.65, 0]) },
    { at: 7.0, rig: rig(base, 0.62, 0.06, 0.78, [0, targetLift, 0]) },
    { at: 11.5, rig: rig(base, 1.42, -0.02, 0.68, [0, targetLift * 0.82, 0]) },
    { at: def.duration, rig: rig(base, 2.22, -0.08, 1.08, [0, targetLift * 0.45, 0]) },
  ];
}

function materialLabel(value: string): string {
  return value.split('-').map((token) => `${token[0]?.toUpperCase() ?? ''}${token.slice(1)}`).join(' ');
}

function buildIndividualMaterialBeats(recipe: MaterialDemoRecipe): readonly ShowcaseBeat[] {
  const target = recipe.kind as Exclude<MaterialDemoKind, 'combined'>;
  const center = materialDemoWorldPoint(recipe, target);
  const loadDetail = `${materialLabel(recipe.boundary)} restraint, ${materialLabel(recipe.fixtureStyle)} hardware, and a ${materialLabel(recipe.loadPattern)} demand field are instrumented.`;
  const result: ShowcaseBeat[] = [
    { at: 0.2, label: recipe.title, detail: recipe.tagline, action: 'caption' },
    { at: 2.2, label: 'Test article armed', detail: loadDetail, action: 'caption', target },
    { at: 3.2, label: 'Service demand', detail: `The rig advances to the measured service envelope (${recipe.primaryLoad.toFixed(2)} normalized demand) while strain and displacement telemetry establish the baseline response.`, action: 'set-load', strength: recipe.primaryLoad, target, center },
    { at: recipe.duration * 0.27, label: 'High-speed inspection', detail: 'Time dilation isolates the load path, localized strain field, support reaction, and first irreversible material response.', action: 'slowmo', target, center },
  ];

  if (recipe.kind === 'metal') {
    result.push(
      { at: recipe.duration * 0.34, label: 'Localized forming event', detail: `${materialLabel(recipe.crackStyle)} damage is seeded at the configured strike location as the sheet enters a controlled plastic-deformation regime.`, action: 'dent-strike', strength: recipe.primaryStrike, target, center },
      { at: recipe.duration * 0.46, label: 'First springback', detail: 'The actuator retracts so recoverable curvature separates cleanly from retained plastic set and work-hardened surface witness marks.', action: 'release-load', target, center },
      { at: recipe.duration * 0.57, label: 'Ultimate forming stroke', detail: `The ${materialLabel(recipe.fixtureStyle)} advances to the ultimate ${recipe.loadPattern} load and drives a second, wider yield field through the article.`, action: 'set-load', strength: recipe.ultimateLoad, target, center },
      { at: recipe.duration * 0.68, label: 'Severe dent / hinge', detail: 'A final instrumented impulse tests the already-worked zone for strain redistribution, thinning, permanent curvature, and late rupture.', action: 'dent-strike', strength: recipe.ultimateStrike, target, center },
      { at: recipe.duration * 0.79, label: 'Residual-shape release', detail: 'Full unloading exposes the final dent depth, bend angle, yielded-member field, and any separated ligament without resetting history.', action: 'release-load', target, center },
    );
  } else if (recipe.kind === 'glass') {
    result.push(
      { at: recipe.duration * 0.34, label: 'Primary flaw activation', detail: `The first precision impact launches the ${materialLabel(recipe.crackStyle)} crack program from the recipe-specific flaw location.`, action: 'material-strike', strength: recipe.primaryStrike, target, center },
      { at: recipe.duration * 0.44, label: 'Crack-front propagation', detail: 'Cohesive cells separate in deterministic waves while transparent islands, polished edges, and fragment momentum remain physically legible.', action: 'caption', target, center },
      { at: recipe.duration * 0.54, label: 'Ultimate transverse demand', detail: `The framed lite enters its ultimate ${materialLabel(recipe.loadPattern)} pressure state, loading every surviving path around the opened fracture.`, action: 'set-load', strength: recipe.ultimateLoad, target, center },
      { at: recipe.duration * 0.64, label: 'Secondary fracture event', detail: 'A second calibrated strike intersects the weakened field and differentiates retained, radial, edge-biased, and dense safety-glass behavior.', action: 'material-strike', strength: recipe.ultimateStrike, target, center },
      { at: recipe.duration * 0.77, label: 'Frame release', detail: 'Pressure is removed while surviving islands and airborne shards continue under inertia and gravity inside the capture bay.', action: 'release-load', target, center },
    );
  } else {
    result.push(
      { at: recipe.duration * 0.35, label: 'First concrete distress', detail: `The ${materialLabel(recipe.loadPattern)} demand opens the first tensile crack and begins transferring residual force toward the reinforcement cage.`, action: 'set-load', strength: recipe.ultimateLoad * 0.72, target, center },
      { at: recipe.duration * 0.44, label: 'Cover-fracture impact', detail: `A calibrated strike seeds the ${materialLabel(recipe.crackStyle)} failure zone, ejecting aggregate-rich cover, translucent dust, and bounded rubble.`, action: 'material-strike', strength: recipe.primaryStrike, target, center },
      { at: recipe.duration * 0.56, label: 'Ultimate structural demand', detail: `The ${materialLabel(recipe.fixtureStyle)} drives through the ultimate envelope while surviving steel bridges the widening concrete fracture field.`, action: 'set-load', strength: recipe.ultimateLoad, target, center },
      { at: recipe.duration * 0.67, label: 'Progressive spall / breakout', detail: 'The severe strike grows the crater, exposes reinforcement, and preserves a readable distinction between missing cover, aggregate, and live load paths.', action: 'material-strike', strength: recipe.ultimateStrike, target, center },
      { at: recipe.duration * 0.80, label: 'Unload and bridge', detail: 'The actuator retracts for forensic inspection of residual deflection, cracked cover, settled debris, and intact steel reinforcement.', action: 'release-load', target, center },
    );
  }

  result.push(
    { at: recipe.duration * 0.86, label: 'Full-rate material recovery', detail: recipe.objective, action: 'normal-speed', target, center },
    { at: recipe.duration - 1.0, label: 'Forensic telemetry lock', detail: 'Peak strain, permanent set, fractured cells, live fragments, broken members, and deterministic replay state are captured.', action: 'caption', target, center },
  );
  return result.sort((a, b) => a.at - b.at);
}

function buildCombinedMaterialBeats(recipe: MaterialDemoRecipe): readonly ShowcaseBeat[] {
  const metal = materialDemoWorldPoint(recipe, 'metal');
  const glass = materialDemoWorldPoint(recipe, 'glass');
  const concrete = materialDemoWorldPoint(recipe, 'concrete');
  return [
    { at: 0.2, label: recipe.title, detail: recipe.tagline, action: 'caption' },
    { at: 2.0, label: 'Three bays online', detail: 'The metal press, backlit glass tunnel, and reinforced-concrete reaction frame share one deterministic clock, HDR stage, and forensic telemetry deck.', action: 'caption' },
    { at: 3.0, label: 'Metal service stroke', detail: 'The left-bay hydraulic punch establishes elastic curvature and support reaction across its perimeter-clamped galvanized sheet.', action: 'set-load', strength: 0.82, target: 'metal', center: metal },
    { at: 4.3, label: 'Metal yield inspection', detail: 'Time dilation follows the advancing yield front before localized cold-forming begins.', action: 'slowmo', target: 'metal', center: metal },
    { at: 5.0, label: 'Permanent steel dent', detail: 'A controlled square-footprint strike forms a retained bowl with restrained sparks, coating flakes, and measurable plastic set.', action: 'dent-strike', strength: 1.02, target: 'metal', center: metal },
    { at: 6.4, label: 'Metal springback', detail: 'The punch retracts, leaving the plastically formed profile under raking industrial light.', action: 'release-load', target: 'metal', center: metal },
    { at: 7.4, label: 'Glass optical preload', detail: 'The center-bay architectural lite enters a narrow elastic pressure envelope against its backlit capture wall.', action: 'set-load', strength: 0.18, target: 'glass', center: glass },
    { at: 8.8, label: 'Ballistic glass trigger', detail: 'An off-axis precision strike nucleates radial cracks and ejects a directional cone of transparent edge-lit fragments.', action: 'material-strike', strength: 1.06, target: 'glass', center: glass },
    { at: 10.3, label: 'Glass crack-front race', detail: 'The weakened pane receives ultimate pressure while surviving islands redistribute demand around the opening.', action: 'set-load', strength: 0.34, target: 'glass', center: glass },
    { at: 11.3, label: 'Secondary glass release', detail: 'A second strike intersects the crack field and releases rotating shards into the bounded catch zone.', action: 'material-strike', strength: 1.52, target: 'glass', center: glass },
    { at: 12.6, label: 'Glass pressure release', detail: 'Pressure drops while the frame, airborne shards, and retained perimeter remain visible as distinct systems.', action: 'release-load', target: 'glass', center: glass },
    { at: 13.6, label: 'Concrete service proof', detail: 'The right-bay slab settles into its supports and shares demand between aggregate cover and embedded reinforcement.', action: 'set-load', strength: 0.78, target: 'concrete', center: concrete },
    { at: 15.1, label: 'Concrete crack onset', detail: 'A first calibrated strike opens the tensile face and ejects physical cover fragments through a translucent dust plume.', action: 'material-strike', strength: 0.96, target: 'concrete', center: concrete },
    { at: 16.8, label: 'Concrete ultimate demand', detail: 'The reaction frame advances through the fracture envelope while exposed rebar bridges the separated cover.', action: 'set-load', strength: 1.48, target: 'concrete', center: concrete },
    { at: 18.3, label: 'Punching and spall event', detail: 'A severe center impulse expands the breakout cone, exposes aggregate and steel, and sends bounded rubble into the catch floor.', action: 'material-strike', strength: 1.62, target: 'concrete', center: concrete },
    { at: 20.0, label: 'Concrete residual inspection', detail: 'The actuator retracts without removing damage, revealing the surviving reinforcement load path.', action: 'release-load', target: 'concrete', center: concrete },
    { at: 21.2, label: 'Synchronized overload finale', detail: 'All bays retain their accumulated damage while the metal press begins one final ultimate forming stroke.', action: 'set-load', strength: 1.42, target: 'metal', center: metal },
    { at: 22.2, label: 'Final metal hinge', detail: 'A severe strike challenges the worked sheet as glass and concrete debris continue settling in adjacent bays.', action: 'dent-strike', strength: 1.48, target: 'metal', center: metal },
    { at: 23.5, label: 'All-material wide shot', detail: 'The director returns to a full-hall view with ductile set, brittle shards, concrete spall, dust, aggregate, and reinforcement visible together.', action: 'normal-speed' },
    { at: 26.8, label: 'Apex forensic lock', detail: recipe.objective, action: 'caption' },
  ];
}

function buildBeats(def: ShowcaseDefinition): readonly ShowcaseBeat[] {
  const recipe = getDefinitionRecipe(def);
  if (recipe) return recipe.kind === 'combined' ? buildCombinedMaterialBeats(recipe) : buildIndividualMaterialBeats(recipe);
  const center: Vec3 = [0, Math.max(2.5, def.focalHeight ?? 4), 0];
  const common: ShowcaseBeat[] = [
    { at: 0.2, label: 'Establishing shot', detail: def.tagline, action: 'caption' },
    { at: 2.6, label: 'Systems armed', detail: def.softSystem
      ? `${def.softSystem === 'water' ? 'Shallow-water' : def.softSystem === 'fracture' ? 'Material-failure beam-lattice' : 'Position-based'} constraints, Box3D stage bodies, WebGPU presentation, HDR lighting, and replay telemetry are live.`
      : 'Solver, continuous collision, WebGPU shadow pass, HDR lighting, and replay telemetry are live.', action: 'caption' },
  ];

  if (def.dentSequence) {
    common.push(
      { at: 3.1, label: 'Panel preload', detail: 'The perimeter-clamped steel panel takes a low forming load while the dense lattice establishes its global bend field.', action: 'set-load', strength: 0.38 },
      { at: 4.5, label: 'Forming inspection', detail: 'Time dilation exposes radial load transfer from the square press head into the supported panel edge.', action: 'slowmo' },
      { at: 5.0, label: 'Controlled bend', detail: 'The indenter advances through the comparative yield envelope and forms a stable center bowl.', action: 'set-load', strength: 0.84 },
      { at: 6.6, label: 'First springback', detail: 'The actuator unloads so elastic recovery can be separated from retained plastic set.', action: 'release-load' },
      { at: 7.8, label: 'Instrumented dent strike', detail: 'A localized cold-forming impulse concentrates curvature at the center of the loaded panel while restrained contact flash and coating flakes reveal the true footprint.', action: 'dent-strike', strength: 1.0 },
      { at: 9.4, label: 'Real-time recovery', detail: 'The panel returns to full rate while center, peak, and residual dent telemetry settle.', action: 'normal-speed' },
      { at: 10.2, label: 'Secondary overload', detail: 'A higher press load tests strain redistribution around the permanent dent.', action: 'set-load', strength: 1.30 },
      { at: 12.1, label: 'Residual-set inspection', detail: 'A second unload leaves the plastically formed profile visible against the undeformed perimeter.', action: 'release-load' },
      { at: 13.4, label: 'Severe dent', detail: 'The final centered strike drives the panel toward tearing while preserving the measured deformation history.', action: 'dent-strike', strength: 1.55 },
      { at: 15.2, label: 'Damage review', detail: 'Full-rate damping reveals permanent set, yielded members, localized damage, and any rupture around the impact bowl.', action: 'normal-speed' },
    );
  } else if (def.materialSequence === 'concrete') {
    common.push(
      { at: 3.1, label: 'Service preload', detail: 'The reinforced slab settles onto twin supports while concrete cover and embedded steel share the initial demand.', action: 'set-load', strength: 0.32 },
      { at: 4.6, label: 'Flexural crack onset', detail: 'Slow motion isolates the tensile face as the first concrete cells cross the brittle damage envelope.', action: 'slowmo' },
      { at: 5.2, label: 'Cover distress', detail: 'The actuator advances and transfers demand toward the two longitudinal reinforcement lines.', action: 'set-load', strength: 0.78 },
      { at: 7.0, label: 'Instrumented impact', detail: 'A localized strike ejects physical cover fragments, exposed aggregate, dust, and brief rebar sparks from the center failure zone.', action: 'material-strike', strength: 0.92 },
      { at: 8.6, label: 'Progressive spall', detail: 'A second displacement plateau opens the crack field while intact rebar bridges the separated cover.', action: 'set-load', strength: 1.34 },
      { at: 10.6, label: 'Punch-through pulse', detail: 'A severe center strike expands the spall crater and exposes more reinforcement without erasing the residual load path.', action: 'material-strike', strength: 1.48 },
      { at: 12.8, label: 'Unload and bridge', detail: 'The press retracts for a clear view of missing cover tiles, settled rubble, and surviving steel.', action: 'release-load' },
      { at: 14.2, label: 'Residual inspection', detail: 'Real time resumes with fragment, fractured-cell, and reinforcement telemetry locked on screen.', action: 'normal-speed' },
    );
  } else if (def.materialSequence === 'glass') {
    common.push(
      { at: 3.0, label: 'Optical preload', detail: 'The framed pane takes a low transverse pressure while reflective skin tiles reveal its narrow elastic envelope.', action: 'set-load', strength: 0.18 },
      { at: 4.5, label: 'Flaw inspection', detail: 'Time dilation isolates the central flaw before the first cohesive cell separates.', action: 'slowmo' },
      { at: 5.5, label: 'Center-punch trigger', detail: 'A deterministic impact nucleates the primary crack, launches the radial crack front, and throws a bright field of edge glints and micro-shards.', action: 'material-strike', strength: 0.82 },
      { at: 7.0, label: 'Crack-front race', detail: 'Neighboring cohesive cells separate in timed waves as reflective tiles vanish from the damaged path.', action: 'caption' },
      { at: 8.2, label: 'Pressure release', detail: 'The frame unloads while surviving islands and airborne glass shards retain their momentum.', action: 'release-load' },
      { at: 9.4, label: 'Secondary fracture', detail: 'A second impact finishes the weakened center and sends thin rotating shards into the catch zone.', action: 'material-strike', strength: 1.35 },
      { at: 11.4, label: 'Shard field', detail: 'Full-rate gravity separates falling fragments from the intact framed perimeter.', action: 'normal-speed' },
      { at: 14.0, label: 'Forensic hold', detail: 'The final view locks fractured-cell, live-shard, and peak-strain telemetry against the opened pane.', action: 'caption' },
    );
  } else if (def.materialSequence === 'ductile') {
    common.push(
      { at: 3.2, label: 'Elastic proof load', detail: 'The steel coupon enters a stable, fully recoverable bend under displacement control.', action: 'set-load', strength: 0.38 },
      { at: 4.8, label: 'Yield-front inspection', detail: 'Time dilation reveals strain heat advancing from the center toward the supports.', action: 'slowmo' },
      { at: 5.5, label: 'Plastic hinge formation', detail: 'The actuator crosses yield and the segmented metal skin retains visible curvature.', action: 'set-load', strength: 0.98 },
      { at: 7.8, label: 'Permanent-set check', detail: 'Unloading separates springback from the remaining ductile deformation.', action: 'release-load' },
      { at: 9.1, label: 'Notch strike', detail: 'A localized material strike seeds damage inside the already-worked hinge zone.', action: 'material-strike', strength: 0.72 },
      { at: 10.4, label: 'Ultimate displacement', detail: 'The press drives the damaged coupon into necking and progressive member rupture.', action: 'set-load', strength: 1.72 },
      { at: 13.2, label: 'Final unload', detail: 'The fixture retracts to expose permanent curvature and the separated ligament.', action: 'release-load' },
      { at: 14.4, label: 'Ductile failure review', detail: 'Real time resumes for residual-set, yielded-member, and fracture telemetry.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'fracture') {
    common.push(
      { at: 3.4, label: 'Elastic preload', detail: 'The displacement-controlled rig begins below the material yield point.', action: 'set-load', strength: 0.42 },
      { at: 5.0, label: 'Yield inspection', detail: 'Time dilation exposes elastic bending, strain concentration, and the first permanent set.', action: 'slowmo' },
      { at: 5.6, label: 'Yield threshold', detail: 'The actuator crosses the tuned yield envelope while the lattice redistributes load.', action: 'set-load', strength: 0.96 },
      { at: 7.5, label: 'Plastic hinge', detail: 'Continued displacement accumulates damage and reveals the difference between ductile and brittle response.', action: 'set-load', strength: 1.38 },
      { at: 9.2, label: 'Controlled flaw', detail: 'A ballistic strike introduces a localized defect at peak bending demand.', action: 'projectile' },
      { at: 10.8, label: 'Ultimate load', detail: 'The rig advances to the configured fracture envelope and captures the final break pattern.', action: 'set-load', strength: 2.0 },
      { at: 13.2, label: 'Unload and inspect', detail: 'The actuator releases so elastic recovery, permanent set, damage, and separated members remain visible.', action: 'release-load' },
      { at: 14.0, label: 'Failure review', detail: 'Full-rate simulation resumes for the final material telemetry lock.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'cloth') {
    common.push(
      { at: 3.6, label: 'Wind front', detail: 'A directional pressure pulse travels across pinned fabric and exposes the constraint network.', action: 'kick', strength: 11 },
      { at: 5.0, label: 'Fiber inspection', detail: 'Time dilation reveals structural, shear, and bend constraints redistributing strain.', action: 'slowmo' },
      { at: 6.4, label: 'Ballistic puncture', detail: 'A high-speed body drives local deformation and can open topology in break-enabled fabric.', action: 'projectile' },
      { at: 8.2, label: 'Pressure shock', detail: 'A radial air-blast creates a second moving deformation front.', action: 'explode', center, strength: 18, radius: 10 },
      { at: 10.1, label: 'Recovery', detail: 'The fabric returns to real time for damping, draping, and final tension telemetry.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'rope') {
    common.push(
      { at: 3.8, label: 'Load swing', detail: 'A broad impulse excites the cable system and transfers energy through every tension member.', action: 'kick', strength: 10 },
      { at: 5.2, label: 'Tension slow motion', detail: 'Time dilation exposes catenary motion, payload inertia, and anchor reaction.', action: 'slowmo' },
      { at: 6.8, label: 'Cable strike', detail: 'A projectile intersects the line field and may sever the closest overloaded segment.', action: 'projectile' },
      { at: 8.5, label: 'Secondary load pulse', detail: 'A radial impulse challenges load sharing after the initial cable event.', action: 'explode', center, strength: 17, radius: 11 },
      { at: 10.4, label: 'Residual oscillation', detail: 'Full-rate simulation resumes for damping, broken-line count, and payload settling.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'water') {
    common.push(
      { at: 3.5, label: 'Surface forcing', detail: 'A directional wave enters the basin and begins reflecting from the containment boundary.', action: 'kick', strength: 10 },
      { at: 5.0, label: 'Rain field', detail: 'Hundreds of droplets inject localized momentum and high-frequency ripples.', action: 'rain', count: 360 },
      { at: 6.2, label: 'Hydrodynamic inspection', detail: 'Time dilation reveals interference, current vectors, foam generation, and buoyancy response.', action: 'slowmo' },
      { at: 7.6, label: 'Leviathan entry', detail: 'A ballistic body enters the surface and couples into the floating-object solver.', action: 'projectile' },
      { at: 9.0, label: 'Impact crown', detail: 'A controlled radial disturbance produces a large splash crown and reflected wave train.', action: 'explode', center: [0, 1.5, 0], strength: 21, radius: 12 },
      { at: 11.0, label: 'Basin recovery', detail: 'The surface returns to real time for boundary reflections, damping, and energy telemetry.', action: 'normal-speed' },
    );
  } else if (def.action === 'impact') {
    common.push(
      { at: 4.1, label: 'Kinetic launch', detail: 'A high-density projectile enters the structure at camera-relative velocity.', action: 'projectile' },
      { at: 5.3, label: 'Impact time dilation', detail: 'Simulation speed drops to expose contact propagation and secondary failures.', action: 'slowmo' },
      { at: 6.0, label: 'Primary breach', detail: 'A localized impulse visualizes the breach zone and accelerating debris field.', action: 'explode', center, strength: 19, radius: 8 },
      { at: 8.3, label: 'Real-time recovery', detail: 'Normal simulation speed resumes as the structure finds its new load path.', action: 'normal-speed' },
    );
  } else if (def.action === 'storm') {
    common.push(
      { at: 3.8, label: 'Storm front', detail: 'A deterministic high-altitude body field begins streaming into the arena.', action: 'rain', count: 520 },
      { at: 6.0, label: 'Maximum density', detail: 'A second wave saturates collision pairs and transform uploads.', action: 'rain', count: 760 },
      { at: 7.2, label: 'Throughput slow motion', detail: 'The camera closes in while the simulation exposes settling and rebound behavior.', action: 'slowmo' },
      { at: 9.4, label: 'Full-rate stress', detail: 'The lab returns to real time for the final accumulation phase.', action: 'normal-speed' },
    );
  } else if (def.action === 'cascade') {
    common.push(
      { at: 4.0, label: 'Cascade trigger', detail: 'A directional impulse starts the designed chain reaction.', action: 'kick', strength: 8.5 },
      { at: 5.8, label: 'Propagation study', detail: 'Time dilation reveals the traveling contact wave and delayed secondary motion.', action: 'slowmo' },
      { at: 8.2, label: 'Secondary pulse', detail: 'A controlled radial impulse tests whether the cascade remains numerically stable.', action: 'explode', center, strength: 12, radius: 10 },
      { at: 10.0, label: 'Resolution', detail: 'The system returns to full rate for settling, sleeping, and replay hashing.', action: 'normal-speed' },
    );
  } else {
    common.push(
      { at: 4.0, label: 'Load-path disruption', detail: 'A broad impulse challenges stacked contacts and structural redundancy.', action: 'kick', strength: 10.5 },
      { at: 5.2, label: 'Collapse slow motion', detail: 'Time dilation highlights buckling, toppling, and collision ordering.', action: 'slowmo' },
      { at: 7.4, label: 'Controlled shockwave', detail: 'A localized blast creates a second failure front without resetting the simulation.', action: 'explode', center, strength: 15, radius: 9 },
      { at: 9.6, label: 'Final settling', detail: 'Full-rate simulation resumes for debris settling and stability telemetry.', action: 'normal-speed' },
    );
  }

  common.push({ at: def.duration - 1.4, label: 'Telemetry lock', detail: 'Final body/node count, constraint state, frame cost, transform bandwidth, and replay hash are captured.', action: 'caption' });
  return common.sort((a, b) => a.at - b.at);
}

const CORE_DEFINITIONS: readonly ShowcaseDefinition[] = [
  {
    id: 'titan-foundry-stackfall', sceneId: sceneId(0, 0), title: 'Titan Foundry Stackfall', category: 'Structural Stability',
    tagline: 'A multi-layer industrial block foundry transitions from perfect balance into a controlled avalanche.',
    objective: 'Demonstrate dense stacked contacts, solver stability, HDR material separation, shadow fidelity, and cinematic collapse framing.',
    duration: 14, recommendedStress: 4, action: 'collapse', focalHeight: 9,
  },
  {
    id: 'masonry-shear-cathedral', sceneId: sceneId(0, 7), title: 'Masonry Shear Cathedral', category: 'Structural Stability',
    tagline: 'Offset masonry towers and cantilevered shelves reveal progressive shear failure across thousands of contacts.',
    objective: 'Expose micro-offset settling, load transfer, toppling order, and deterministic replay behavior under a second shock front.',
    duration: 15, recommendedStress: 5, action: 'collapse', focalHeight: 11,
  },
  {
    id: 'cathedral-of-motion', sceneId: sceneId(1, 0), title: 'Cathedral of Motion', category: 'Chain Reactions',
    tagline: 'A ceremonial field of thin bodies carries one precise impulse through a monumental radial composition.',
    objective: 'Show thin-body stability, contact-wave timing, cinematic orbit tracking, and high-contrast motion readability.',
    duration: 14, recommendedStress: 3, action: 'cascade', focalHeight: 3,
  },
  {
    id: 'helix-relay-protocol', sceneId: sceneId(1, 2), title: 'Helix Relay Protocol', category: 'Chain Reactions',
    tagline: 'Twin contact waves travel through interlocked helical paths before colliding at the center stage.',
    objective: 'Stress synchronized propagation, branching contact order, slow-motion inspection, and replay consistency.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'aegis-tower-kinetic-breach', sceneId: sceneId(2, 0), title: 'Aegis Tower: Kinetic Breach', category: 'High-Rise Destruction',
    tagline: 'A core-and-shell tower absorbs a high-density strike before its damaged load path redistributes floor by floor.',
    objective: 'Present continuous collision, high-rise contact density, cinematic impact timing, shadowed debris, and structural collapse.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 14,
  },
  {
    id: 'twin-spire-progressive-collapse', sceneId: sceneId(2, 7), title: 'Twin Spire Progressive Collapse', category: 'High-Rise Destruction',
    tagline: 'Two towers linked by a skybridge enter a coupled failure state after a single lateral strike.',
    objective: 'Demonstrate coupled structures, elevated connectors, asymmetric collapse, camera shake, and high body-count rendering.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 16,
  },
  {
    id: 'truss-span-failure', sceneId: sceneId(3, 2), title: 'Truss Span Failure', category: 'Infrastructure',
    tagline: 'A triangular truss corridor carries a concentrated load until a lateral strike breaks its repeating support path.',
    objective: 'Visualize truss contact transfer, brace loss, mid-span impact, progressive deck failure, and debris settling across a wide frame.',
    duration: 16, recommendedStress: 5, action: 'impact', focalHeight: 5,
  },
  {
    id: 'viaduct-shockwave', sceneId: sceneId(3, 9), title: 'Viaduct Shockwave', category: 'Infrastructure',
    tagline: 'A multi-pier transport span is tested by a traveling impulse and a secondary centerline shockwave.',
    objective: 'Show long-span failure propagation, repeated supports, broad camera choreography, and stable high-volume transforms.',
    duration: 16, recommendedStress: 5, action: 'cascade', focalHeight: 6,
  },
  {
    id: 'hypermaterial-gauntlet', sceneId: sceneId(4, 0), title: 'Hypermaterial Gauntlet', category: 'Materials',
    tagline: 'Multiple lanes compare friction, restitution, mass, damping, and surface response in a single cinematic experiment.',
    objective: 'Make material differences immediately visible through synchronized bodies, lane lighting, bounce height, and settling time.',
    duration: 14, recommendedStress: 3, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'restitution-reactor', sceneId: sceneId(4, 3), title: 'Restitution Reactor', category: 'Materials',
    tagline: 'A staircase of tuned surfaces turns identical impacts into dramatically different energy-retention signatures.',
    objective: 'Compare restitution and friction while validating fixed-step determinism and high-frequency contact rendering.',
    duration: 14, recommendedStress: 4, action: 'cascade', focalHeight: 5,
  },
  {
    id: 'orbital-cargo-storm', sceneId: sceneId(5, 0), title: 'Orbital Cargo Storm', category: 'Maximum Stress',
    tagline: 'Thousands of cargo modules enter a fortified receiving arena in two escalating orbital drop waves.',
    objective: 'Push body creation, collision throughput, matrix streaming, HDR color separation, and browser responsiveness.',
    duration: 16, recommendedStress: 5, action: 'storm', focalHeight: 16,
  },
  {
    id: 'debris-cyclone-chamber', sceneId: sceneId(5, 2), title: 'Debris Cyclone Chamber', category: 'Maximum Stress',
    tagline: 'A deterministic debris cloud saturates a narrow collision column before spreading across the containment floor.',
    objective: 'Measure transform upload bandwidth, collision saturation, stable camera motion, and finite-matrix guarantees.',
    duration: 17, recommendedStress: 5, action: 'storm', focalHeight: 18,
  },
  {
    id: 'citadel-siege', sceneId: sceneId(6, 0), title: 'Citadel Siege', category: 'Destruction',
    tagline: 'Layered defensive walls, towers, and barricades meet a cinematic projectile strike and secondary breach charge.',
    objective: 'Show localized penetration, rubble generation, progressive wall failure, emissive impact effects, and camera shake.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 6,
  },
  {
    id: 'core-breach-theater', sceneId: sceneId(6, 7), title: 'Core Breach Theater', category: 'Destruction',
    tagline: 'A dense structural core is removed from within, forcing the surrounding shell into a delayed collapse sequence.',
    objective: 'Reveal radial impulse falloff, delayed failure, secondary contacts, and dramatic close-range collapse coverage.',
    duration: 16, recommendedStress: 5, action: 'collapse', focalHeight: 8,
  },
  {
    id: 'titan-hauler-crash-range', sceneId: sceneId(7, 0), title: 'Titan Hauler Crash Range', category: 'Machines',
    tagline: 'Heavy haulers cross an obstacle field with shifting cargo before striking a reinforced barrier line.',
    objective: 'Demonstrate moving masses, carried cargo, barrier contacts, rollover proxies, and low-angle tracking shots.',
    duration: 15, recommendedStress: 4, action: 'impact', focalHeight: 3,
  },
  {
    id: 'container-convoy-rollover', sceneId: sceneId(7, 9), title: 'Container Convoy Rollover', category: 'Machines',
    tagline: 'A synchronized convoy experiences asymmetric load shift, lane interference, and cascading cargo loss.',
    objective: 'Stress moving-body contact chains, cargo stability, multi-lane occupancy, and cinematic motion continuity.',
    duration: 16, recommendedStress: 5, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'chronos-gravity-foundry', sceneId: sceneId(8, 0), title: 'Chronos Gravity Foundry', category: 'Kinetic Machines',
    tagline: 'A monumental gravity course guides hundreds of small bodies through ramps, gates, pegs, and sorting lanes.',
    objective: 'Show small-body throughput, repeated impacts, visually readable motion trails, and detailed set-piece lighting.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 6,
  },
  {
    id: 'pinball-reactor', sceneId: sceneId(8, 1), title: 'Pinball Reactor', category: 'Kinetic Machines',
    tagline: 'A dense bumper field turns one release event into a sustained reactor of rebounds and redirected momentum.',
    objective: 'Demonstrate restitution, repeated collisions, high-frequency transform updates, and stable post-processing.',
    duration: 15, recommendedStress: 5, action: 'cascade', focalHeight: 5,
  },
  {
    id: 'sky-crane-load-failure', sceneId: sceneId(9, 0), title: 'Sky Crane Load Failure', category: 'Construction',
    tagline: 'A tower crane load enters an active steel frame and produces a cascading jobsite failure.',
    objective: 'Present long members, falling loads, floor-pack impacts, construction geometry, and a wide-to-close cinematic path.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 10,
  },
  {
    id: 'modular-megaframe-assembly', sceneId: sceneId(9, 5), title: 'Modular Megaframe Assembly', category: 'Construction',
    tagline: 'Volumetric building modules settle into a partially completed frame before a controlled alignment failure.',
    objective: 'Show module mass, broad face contacts, support loss, structural alignment, and final settling quality.',
    duration: 15, recommendedStress: 4, action: 'collapse', focalHeight: 8,
  },
  {
    id: 'high-bay-cascade', sceneId: sceneId(10, 1), title: 'High-Bay Cascade', category: 'Logistics',
    tagline: 'Loaded storage racks fail aisle by aisle, releasing pallets into a dense warehouse-wide cascade.',
    objective: 'Stress tall narrow supports, shelves, parcels, progressive collapse, and deep-scene shadow readability.',
    duration: 17, recommendedStress: 5, action: 'collapse', focalHeight: 7,
  },
  {
    id: 'automated-sorter-blackout', sceneId: sceneId(10, 0), title: 'Automated Sorter Blackout', category: 'Logistics',
    tagline: 'Four parcel streams collide when routing lanes lose synchronization and the merge zone saturates.',
    objective: 'Demonstrate many small bodies, lane merging, blockage growth, deterministic randomness, and throughput telemetry.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'colonnade-resonance', sceneId: sceneId(11, 0), title: 'Colonnade Resonance', category: 'Architecture',
    tagline: 'A monumental ring of columns and layered roof plates responds to a traveling structural pulse.',
    objective: 'Show repeated architectural elements, roof-load transfer, radial collapse, and sweeping cinematic orbit coverage.',
    duration: 16, recommendedStress: 4, action: 'cascade', focalHeight: 9,
  },
  {
    id: 'mega-atrium-collapse', sceneId: sceneId(11, 9), title: 'Mega Atrium Collapse', category: 'Architecture',
    tagline: 'A large mixed-use atrium, facade field, and elevated roof system enter progressive failure after a kinetic breach.',
    objective: 'Deliver the final all-systems showcase: impact, architecture, debris, shadows, bloom, fog, effects, and telemetry.',
    duration: 18, recommendedStress: 5, action: 'impact', focalHeight: 11,
  },

  {
    id: 'tempest-standard-protocol', sceneId: sceneId(12, 0), title: 'Tempest Standard Protocol', category: 'Soft-Body Cloth',
    tagline: 'A monumental fabric standard enters a staged wind front, ballistic puncture, and pressure-wave recovery sequence.',
    objective: 'Demonstrate pinned-edge cloth, structural/shear/bend constraints, turbulent forcing, topology separation, dynamic normals, and two-sided WebGPU shading.',
    duration: 16, recommendedStress: 4, action: 'cascade', focalHeight: 7, softSystem: 'cloth',
  },
  {
    id: 'parachute-canopy-failure', sceneId: sceneId(12, 6), title: 'Parachute Canopy Failure', category: 'Soft-Body Cloth',
    tagline: 'A tensioned canopy catches air, deforms around an impact body, and opens a progressive constraint failure under load.',
    objective: 'Show four-corner loading, curved membrane response, collision coupling, strain visualization, tearing, and deterministic recovery.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 10, softSystem: 'cloth',
  },
  {
    id: 'sky-crane-cable-failure', sceneId: sceneId(13, 0), title: 'Sky Crane Cable Failure', category: 'Rope and Rigging',
    tagline: 'A long crane cable carries a heavy industrial payload through swing, impact, line failure, and residual oscillation.',
    objective: 'Demonstrate cable tension, bend constraints, concentrated mass, projectile severing, payload inertia, and anchor stability.',
    duration: 17, recommendedStress: 5, action: 'collapse', focalHeight: 9, softSystem: 'rope',
  },
  {
    id: 'suspension-cable-resonance', sceneId: sceneId(13, 1), title: 'Suspension Cable Resonance', category: 'Rope and Rigging',
    tagline: 'Twin catenary cables and cross-planks carry a traveling oscillation before a localized cable strike changes the load path.',
    objective: 'Show coupled ropes, catenary geometry, cross constraints, resonance propagation, line tension coloring, and partial failure.',
    duration: 17, recommendedStress: 4, action: 'cascade', focalHeight: 7, softSystem: 'rope',
  },
  {
    id: 'tsunami-research-array', sceneId: sceneId(14, 1), title: 'Tsunami Research Array', category: 'Interactive Water',
    tagline: 'A large wave front crosses a cinematic research basin, reflects from its boundaries, and collides with secondary forcing.',
    objective: 'Demonstrate linear shallow-water propagation, boundary reflection, interference, foam, current telemetry, and HDR water shading.',
    duration: 18, recommendedStress: 5, action: 'cascade', focalHeight: 2, softSystem: 'water',
  },
  {
    id: 'leviathan-impact-basin', sceneId: sceneId(14, 9), title: 'Leviathan Impact Basin', category: 'Interactive Water',
    tagline: 'Rain, traveling waves, a ballistic entry body, and a massive splash crown converge in the lab’s fluid finale.',
    objective: 'Show wave interference, droplet coupling, buoyancy proxies, impact displacement, splash particles, current vectors, and post-processed water highlights.',
    duration: 19, recommendedStress: 5, action: 'impact', focalHeight: 2, softSystem: 'water',
  },
  {
    id: 'steel-yield-to-rupture', sceneId: sceneId(15, 0), title: 'Steel Yield-to-Rupture', category: 'Material Failure',
    tagline: 'A structural-steel specimen progresses from elastic bend through plastic-hinge formation and final ductile rupture.',
    objective: 'Show displacement-controlled loading, yield onset, permanent set, damage accumulation, fracture separation, and exact breakpoint telemetry.',
    duration: 17, recommendedStress: 4, action: 'collapse', focalHeight: 7.0, softSystem: 'fracture',
    materialSequence: 'ductile',
  },
  {
    id: 'titan-metal-bend-and-dent', sceneId: modeSceneId(15, 3, 0), title: 'Titan Metal Bend & Dent', category: 'Material Failure',
    tagline: 'A perimeter-clamped galvanized steel panel is bent under a square press, unloaded for springback, and struck twice to retain a measurable permanent dent.',
    objective: 'Demonstrate two-axis panel bending, concentrated indentation, ductile yielding, springback, residual set, localized damage, and deterministic deformation telemetry.',
    duration: 18, recommendedStress: 5, action: 'impact', focalHeight: 7.0, softSystem: 'fracture', dentSequence: true,
  },
  {
    id: 'concrete-spall-and-rebar', sceneId: sceneId(15, 5), title: 'Concrete Spall & Rebar Exposure', category: 'Material Failure',
    tagline: 'A reinforced-concrete specimen cracks in tension, sheds its cover as physical spall, and transfers demand into exposed steel reinforcement.',
    objective: 'Show progressive concrete damage, brittle cover loss, compression crushing, residual reinforcement bridging, textured debris, and deterministic fracture telemetry.',
    duration: 18, recommendedStress: 5, action: 'collapse', focalHeight: 7.0, softSystem: 'fracture',
    materialSequence: 'concrete',
  },
  {
    id: 'glass-catastrophic-fracture', sceneId: sceneId(15, 6), title: 'Glass Catastrophic Fracture', category: 'Material Failure',
    tagline: 'A soda-lime glass plate carries a precise preload before a localized flaw triggers a sudden brittle fracture front.',
    objective: 'Contrast a narrow elastic envelope with negligible plastic set, rapid damage localization, abrupt member loss, and deterministic crack progression.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 7.2, softSystem: 'fracture',
    materialSequence: 'glass',
  },
] as const;

const MATERIAL_DEMO_DEFINITIONS: readonly ShowcaseDefinition[] = MATERIAL_DEMO_RECIPES.map((recipe) => ({
  id: recipe.id,
  sceneId: recipe.baseSceneId,
  title: recipe.title,
  category: recipe.kind === 'metal'
    ? 'Ductile Metal Laboratory'
    : recipe.kind === 'glass'
      ? 'Architectural Glass Laboratory'
      : recipe.kind === 'concrete'
        ? 'Concrete Fracture Laboratory'
        : 'AAA Materials Finale',
  tagline: recipe.tagline,
  objective: recipe.objective,
  duration: recipe.duration,
  recommendedStress: recipe.recommendedStress,
  action: recipe.kind === 'concrete' ? 'collapse' : 'impact',
  focalHeight: recipe.camera.target[1],
  softSystem: 'fracture',
  materialDemoId: recipe.id,
}));

const DEFINITIONS: readonly ShowcaseDefinition[] = [
  ...CORE_DEFINITIONS,
  ...MATERIAL_DEMO_DEFINITIONS,
];

export const AAA_SHOWCASES: readonly AAAShowcase[] = DEFINITIONS.map((def) => ({
  id: def.id,
  sceneId: def.sceneId,
  title: def.title,
  category: def.category,
  tagline: def.tagline,
  objective: def.objective,
  duration: def.duration,
  recommendedStress: def.recommendedStress,
  materialDemoId: def.materialDemoId,
  cameraTrack: buildCameraTrack(def),
  beats: buildBeats(def),
}));

export const AAA_SIGNATURE_SHOWCASE_IDS = [
  'aegis-tower-kinetic-breach',
  'twin-spire-progressive-collapse',
  'truss-span-failure',
  'citadel-siege',
  'mega-atrium-collapse',
  'tempest-standard-protocol',
  'sky-crane-cable-failure',
  'tsunami-research-array',
  'concrete-spall-and-rebar',
  'glass-catastrophic-fracture',
] as const;

/** The ten hand-authored, material-rich showcase scenes used for hero capture. */
export const AAA_SIGNATURE_SHOWCASES: readonly AAAShowcase[] = AAA_SIGNATURE_SHOWCASE_IDS.map((id) => {
  const showcase = AAA_SHOWCASES.find((candidate) => candidate.id === id);
  if (!showcase) throw new Error(`Missing AAA signature showcase: ${id}`);
  return showcase;
});

export function getShowcaseById(id: string): AAAShowcase {
  return AAA_SHOWCASES.find((showcase) => showcase.id === id) ?? AAA_SHOWCASES[0];
}

export function getShowcaseByOrdinal(index: number): AAAShowcase {
  const wrapped = ((Math.round(index) % AAA_SHOWCASES.length) + AAA_SHOWCASES.length) % AAA_SHOWCASES.length;
  return AAA_SHOWCASES[wrapped];
}

/** Resolve the recipe-enhanced preset without expanding the stable 800-scene/native-ID catalog. */
export function getShowcaseScene(showcase: Pick<AAAShowcase, 'sceneId' | 'materialDemoId'>): ScenePreset {
  return showcase.materialDemoId ? sceneForMaterialDemo(showcase.materialDemoId) : getSceneById(showcase.sceneId);
}

export function sampleShowcaseCamera(showcase: AAAShowcase, timeSeconds: number): CameraRig {
  if (showcase.cameraTrack.length === 0) return getShowcaseScene(showcase).camera;
  return sampleShowcaseCameraInto(showcase, timeSeconds, { yaw: 0, pitch: 0, distance: 0, target: [0, 0, 0] });
}

/** Allocation-free camera-track sampling for the per-frame director path. */
export function sampleShowcaseCameraInto(showcase: AAAShowcase, timeSeconds: number, out: CameraRig): CameraRig {
  const track = showcase.cameraTrack;
  if (track.length === 0) return cloneRigInto(out, getShowcaseScene(showcase).camera);
  if (timeSeconds <= track[0].at) return cloneRigInto(out, track[0].rig);
  if (timeSeconds >= track[track.length - 1].at) return cloneRigInto(out, track[track.length - 1].rig);

  // Every built-in director track has five keys. Select its segment directly
  // while retaining the generic path for external/custom showcase data.
  if (track.length === 5) {
    const index = timeSeconds <= track[1].at ? 0
      : timeSeconds <= track[2].at ? 1
      : timeSeconds <= track[3].at ? 2
      : 3;
    const a = track[index];
    const b = track[index + 1];
    const t = easeInOutCubic((timeSeconds - a.at) / Math.max(0.001, b.at - a.at));
    out.yaw = lerpAngle(a.rig.yaw, b.rig.yaw, t);
    out.pitch = lerp(a.rig.pitch, b.rig.pitch, t);
    out.distance = lerp(a.rig.distance, b.rig.distance, t);
    out.target[0] = lerp(a.rig.target[0], b.rig.target[0], t);
    out.target[1] = lerp(a.rig.target[1], b.rig.target[1], t);
    out.target[2] = lerp(a.rig.target[2], b.rig.target[2], t);
    return out;
  }

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (timeSeconds < a.at || timeSeconds > b.at) continue;
    const t = easeInOutCubic((timeSeconds - a.at) / Math.max(0.001, b.at - a.at));
    out.yaw = lerpAngle(a.rig.yaw, b.rig.yaw, t);
    out.pitch = lerp(a.rig.pitch, b.rig.pitch, t);
    out.distance = lerp(a.rig.distance, b.rig.distance, t);
    out.target[0] = lerp(a.rig.target[0], b.rig.target[0], t);
    out.target[1] = lerp(a.rig.target[1], b.rig.target[1], t);
    out.target[2] = lerp(a.rig.target[2], b.rig.target[2], t);
    return out;
  }

  return cloneRigInto(out, track[track.length - 1].rig);
}

function cloneRigInto(out: CameraRig, value: CameraRig): CameraRig {
  out.yaw = value.yaw;
  out.pitch = value.pitch;
  out.distance = value.distance;
  out.target[0] = value.target[0];
  out.target[1] = value.target[1];
  out.target[2] = value.target[2];
  return out;
}
