import type {
  AAAStagePrimitive,
  EngineeringStageGroup,
  EngineeringStageGroupRole,
  EngineeringStageOwnership,
} from './aaa-improvements';
import type { Vec3 } from './math';
import { getSceneById, type ScenePreset } from './scenes';
import {
  MATERIAL_LAB_CATEGORIES,
  MATERIAL_LAB_CATEGORY_LABELS,
  materialLabCategoryLabel,
  materialPresetForVariant,
  type MaterialLabCategory,
  type MaterialLabFilter,
} from './soft/material-presets';
import type { CameraRig } from './types';

export type {
  EngineeringStageGroup,
  EngineeringStageGroupRole,
  EngineeringStageOwnership,
} from './aaa-improvements';
export type { MaterialLabFilter };

export type MaterialDemoKind = 'metal' | 'glass' | 'concrete' | 'combined';
export type MaterialBoundary = 'perimeter' | 'simple-span' | 'cantilever' | 'four-corner' | 'end-clamped';
export type MaterialLoadPattern = 'center' | 'offset' | 'dual' | 'line' | 'distributed' | 'torsion' | 'edge' | 'pulse';
export type MaterialCrackStyle = 'local' | 'radial' | 'dense' | 'retained' | 'edge' | 'cone' | 'diagonal';
export type MaterialFixtureStyle = 'press' | 'rollers' | 'ram' | 'blast' | 'drop' | 'fatigue' | 'facade' | 'reaction-frame';

/** Material Lab filter chips. Fluid, soft-body, and cloth rows live in other catalogs. */
export const MATERIAL_LAB_GROUPS = MATERIAL_LAB_CATEGORIES;
export type MaterialLabGroup = MaterialLabCategory;
export const MATERIAL_LAB_GROUP_LABELS = MATERIAL_LAB_CATEGORY_LABELS;

/** Mockup rows 01–04. Rows 05–07 are cloth / fluid / soft-body catalogs. */
export const MATERIAL_LAB_FEATURED_IDS = [
  'metal-square-punch-forming',
  'metal-press-brake-v-bend',
  'glass-laminated-stone-strike',
  'concrete-flat-slab-punching',
] as const;

export type MaterialDemoRecipe = {
  readonly id: string;
  readonly kind: MaterialDemoKind;
  /** Library and mobile header title; featured slots match the Material Lab mockup. */
  readonly title: string;
  /** Second line under the library title, e.g. "Aluminum Panel". */
  readonly specimen: string;
  readonly labGroup: MaterialLabGroup;
  /** MATERIAL dropdown label. Maps onto `profileVariant`, not a certified alloy card. */
  readonly materialLabel: string;
  /** 1-based Material Lab library index. Featured mockup rows occupy 1–4. */
  readonly librarySlot: number;
  readonly tagline: string;
  readonly objective: string;
  /** Stable scene ID used by both native and fallback rigid staging. */
  readonly baseSceneId: number;
  /** Physical material preset index; presentation selection is orthogonal. */
  readonly profileVariant: number;
  readonly boundary: MaterialBoundary;
  readonly loadPattern: MaterialLoadPattern;
  readonly loadCenter: readonly [number, number];
  readonly loadRadius: readonly [number, number];
  readonly strikeCenter: readonly [number, number];
  readonly loadScale: number;
  readonly primaryLoad: number;
  readonly ultimateLoad: number;
  readonly primaryStrike: number;
  readonly ultimateStrike: number;
  readonly crackStyle: MaterialCrackStyle;
  readonly fixtureStyle: MaterialFixtureStyle;
  /** Specimen plane; horizontal loads act on Y, vertical loads act on Z. */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Normal-direction sign. -1 is downward/rearward, +1 is upward/forward. */
  readonly loadSign?: -1 | 1;
  /** World up. Material demos are authored Y-up, right-handed. */
  readonly upAxis?: 'Y';
  /** Specimen yaw about world Y, radians. 0 keeps the span along +X. */
  readonly specimenYaw?: number;
  /**
   * Specimen pitch from the XZ ground plane, radians.
   * 0 = sheet/slab/beam on supports; π/2 = vertical pane, door, or wall.
   */
  readonly specimenPitch?: number;
  readonly span: number;
  readonly depth: number;
  readonly stations: number;
  readonly lanes: number;
  readonly recommendedStress: number;
  readonly duration: number;
  readonly camera: CameraRig;
  /**
   * Authored specimen gauge in millimetres. Drives a *relative* thickness
   * scale against the material preset's lab.thicknessMm. Not a calibrated
   * plate thickness in SI.
   */
  readonly thicknessMm?: number;
  /** Seeded notch in normalized specimen coordinates. */
  readonly notch?: readonly [u: number, v: number, width: number];
  /**
   * After the actuator reaches the current load target, hold this many seconds
   * then unload so elastic recovery is visible. Normalized model time.
   */
  readonly holdThenUnloadSeconds?: number;
};

const camera = (yaw: number, pitch: number, distance: number, target: Vec3): CameraRig => ({ yaw, pitch, distance, target });

export const MATERIAL_DEMO_UP_AXIS = 'Y' as const;

const SHEET_ON_SUPPORTS = {
  orientation: 'horizontal',
  loadSign: -1,
  upAxis: MATERIAL_DEMO_UP_AXIS,
  specimenYaw: 0,
  specimenPitch: 0,
} as const;

const PANE_FACING_LOAD = {
  orientation: 'vertical',
  loadSign: -1,
  upAxis: MATERIAL_DEMO_UP_AXIS,
  specimenYaw: 0,
  specimenPitch: Math.PI / 2,
} as const;

const SLAB_PULL_OUT = {
  orientation: 'horizontal',
  loadSign: 1,
  upAxis: MATERIAL_DEMO_UP_AXIS,
  specimenYaw: 0,
  specimenPitch: 0,
} as const;

export type MaterialDemoSpecimenPose = {
  readonly upAxis: 'Y';
  readonly orientation: 'horizontal' | 'vertical';
  readonly yaw: number;
  readonly pitch: number;
  readonly loadSign: -1 | 1;
};

export function materialDemoResolvedOrientation(recipe: MaterialDemoRecipe): 'horizontal' | 'vertical' {
  const authored = recipe.orientation;
  if (authored) {
    switch (authored) {
      case 'horizontal':
      case 'vertical':
        return authored;
      default: {
        const exhaustive: never = authored;
        throw new Error(`Unhandled specimen orientation: ${exhaustive}`);
      }
    }
  }
  return recipe.kind === 'glass' ? 'vertical' : 'horizontal';
}

export function materialDemoIsVertical(recipe: MaterialDemoRecipe): boolean {
  const orientation = materialDemoResolvedOrientation(recipe);
  switch (orientation) {
    case 'vertical':
      return true;
    case 'horizontal':
      return false;
    default: {
      const exhaustive: never = orientation;
      return exhaustive;
    }
  }
}

export function materialDemoLoadSign(recipe: MaterialDemoRecipe): -1 | 1 {
  const authored = recipe.loadSign;
  if (authored) {
    switch (authored) {
      case -1:
      case 1:
        return authored;
      default: {
        const exhaustive: never = authored;
        throw new Error(`Unhandled load sign: ${exhaustive}`);
      }
    }
  }
  return -1;
}

export function materialDemoSpecimenPose(recipe: MaterialDemoRecipe): MaterialDemoSpecimenPose {
  const orientation = materialDemoResolvedOrientation(recipe);
  return {
    upAxis: recipe.upAxis ?? MATERIAL_DEMO_UP_AXIS,
    orientation,
    yaw: recipe.specimenYaw ?? 0,
    pitch: recipe.specimenPitch ?? (orientation === 'vertical' ? Math.PI / 2 : 0),
    loadSign: materialDemoLoadSign(recipe),
  };
}

const METAL_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'metal-square-punch-forming', kind: 'metal', title: 'Ballistic Dent',
    specimen: 'Aluminum Panel', labGroup: 'impact', materialLabel: 'Aluminum 6061-T6', librarySlot: 1,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A four-edge-clamped aluminum panel forms a controlled ballistic dent beneath a compact punch, then springs back into a measurable permanent set.',
    objective: 'Resolve elastic bending, plastic flow, punch-footprint shoulders, restrained coating scuff, unload springback, and residual dent telemetry.',
    baseSceneId: 780, profileVariant: 1, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.34], strikeCenter: [0.5, 0.5],
    loadScale: 1, primaryLoad: 0.82, ultimateLoad: 1.42, primaryStrike: 0.90, ultimateStrike: 1.48,
    crackStyle: 'local', fixtureStyle: 'press', span: 24, depth: 8.6, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    thicknessMm: 3,
    camera: camera(-1.28, 0.38, 30, [0, 6.85, 0]),
  },
  {
    id: 'metal-aluminum-hailstorm', kind: 'metal', title: 'Hailstorm Dent',
    specimen: 'Aluminum Skin', labGroup: 'impact', materialLabel: 'Aluminum 6061-T6', librarySlot: 5,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A lightweight automotive-grade aluminum skin receives offset compact impacts that accumulate into overlapping shallow dimples.',
    objective: 'Show low-mass response, distributed dent accumulation, local work hardening, oil-canning recovery, and non-emissive surface scuff.',
    baseSceneId: 781, profileVariant: 1, boundary: 'perimeter', loadPattern: 'pulse', loadCenter: [0.38, 0.62], loadRadius: [0.10, 0.22], strikeCenter: [0.36, 0.64],
    loadScale: 0.82, primaryLoad: 0.54, ultimateLoad: 1.05, primaryStrike: 0.72, ultimateStrike: 1.08,
    crackStyle: 'local', fixtureStyle: 'drop', span: 22, depth: 9.2, stations: 46, lanes: 11, recommendedStress: 4, duration: 17,
    camera: camera(-0.88, 0.62, 28, [-1.2, 7.05, 0.6]),
  },
  {
    id: 'metal-copper-deep-draw', kind: 'metal', title: 'Deep-Draw Dome',
    specimen: 'Copper Blank', labGroup: 'structural', materialLabel: 'Copper', librarySlot: 6,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A broad punch pulls a ductile copper blank into a deep permanent dome while the clamped perimeter resists draw-in.',
    objective: 'Demonstrate high plastic stretch, broad curvature, large springback contrast, strain redistribution, and minimal brittle separation.',
    baseSceneId: 782, profileVariant: 2, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.34, 0.72], strikeCenter: [0.5, 0.5],
    loadScale: 0.92, primaryLoad: 0.94, ultimateLoad: 1.72, primaryStrike: 0.68, ultimateStrike: 1.22,
    crackStyle: 'local', fixtureStyle: 'press', span: 21, depth: 9.8, stations: 46, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-0.92, 0.64, 30, [0, 7.05, 0]),
  },
  {
    id: 'metal-door-skin-oblique-dent', kind: 'metal', title: 'Oblique Dent',
    specimen: 'Door Skin', labGroup: 'impact', materialLabel: 'Structural Steel', librarySlot: 7,
    ...PANE_FACING_LOAD,
    tagline: 'An off-center elliptical ram drives an asymmetric crease into a thin steel door skin and releases into a visible oil-canning rebound.',
    objective: 'Show oblique load transfer, directional crease formation, asymmetric springback, residual set, and localized coating witness marks.',
    baseSceneId: 780, profileVariant: 0, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.66, 0.38], loadRadius: [0.12, 0.30], strikeCenter: [0.68, 0.36],
    loadScale: 0.96, primaryLoad: 0.76, ultimateLoad: 1.36, primaryStrike: 0.94, ultimateStrike: 1.40,
    crackStyle: 'local', fixtureStyle: 'ram', span: 23, depth: 10.2, stations: 48, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.42, 0.22, 26, [2.4, 7.2, 0]),
  },
  {
    id: 'metal-press-brake-v-bend', kind: 'metal', title: 'Metal Fold',
    specimen: 'Sheet Metal', labGroup: 'structural', materialLabel: 'Structural Steel', librarySlot: 2,
    ...SHEET_ON_SUPPORTS,
    tagline: 'Twin die shoulders and a narrow line punch create a crisp cold-formed fold with a concentrated plastic hinge.',
    objective: 'Expose line-load curvature, neutral-axis migration, fold localization, unload angle recovery, and retained V-bend geometry.',
    baseSceneId: 780, profileVariant: 0, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.055, 1], strikeCenter: [0.5, 0.5],
    loadScale: 1.08, primaryLoad: 0.88, ultimateLoad: 1.54, primaryStrike: 0.70, ultimateStrike: 1.18,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 24, depth: 5.8, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    thicknessMm: 2.5,
    holdThenUnloadSeconds: 1.2,
    camera: camera(-1.38, 0.36, 28, [0, 6.55, 0]),
  },
  {
    id: 'metal-four-point-bumper-beam', kind: 'metal', title: 'Axial Fold',
    specimen: 'Crash Rail', labGroup: 'impact', materialLabel: 'Aluminum 6061-T6', librarySlot: 8,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A formed aluminum hat rail is fixed to a bulkhead and driven axially by a guided platen, initiating progressive folds from the free end.',
    objective: 'Compare normalized crush demand, section-fold progression, plastic-set localization, bulkhead reaction, and retained shortening against archived test evidence.',
    baseSceneId: 781, profileVariant: 1, boundary: 'cantilever', loadPattern: 'edge', loadCenter: [0.92, 0.5], loadRadius: [0.12, 0.92], strikeCenter: [0.94, 0.5],
    loadScale: 0.28, primaryLoad: 0.68, ultimateLoad: 1.24, primaryStrike: 0.74, ultimateStrike: 1.18,
    crackStyle: 'local', fixtureStyle: 'ram', span: 18, depth: 5.4, stations: 48, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.48, 0.32, 26, [-0.6, 7.15, 0]),
  },
  {
    id: 'metal-cantilever-overbend', kind: 'metal', title: 'Cantilever Overbend',
    specimen: 'Sheet Bracket', labGroup: 'structural', materialLabel: 'Aluminum 6061-T6', librarySlot: 9,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A single fixed edge forces an offset sheet bracket to rotate through a root plastic hinge under a controlled tip load.',
    objective: 'Demonstrate cantilever rotation, root strain concentration, one-sided plasticity, springback, and retained tip displacement.',
    baseSceneId: 781, profileVariant: 1, boundary: 'cantilever', loadPattern: 'edge', loadCenter: [0.86, 0.5], loadRadius: [0.12, 0.82], strikeCenter: [0.88, 0.5],
    loadScale: 0.90, primaryLoad: 0.72, ultimateLoad: 1.34, primaryStrike: 0.78, ultimateStrike: 1.24,
    crackStyle: 'local', fixtureStyle: 'ram', span: 22, depth: 6.2, stations: 46, lanes: 9, recommendedStress: 4, duration: 17,
    camera: camera(-0.38, 0.42, 28, [3.6, 7.0, 0]),
  },
  {
    id: 'metal-tension-field-shear', kind: 'metal', title: 'Tension-Field Shear',
    specimen: 'Steel Web', labGroup: 'structural', materialLabel: 'Structural Steel', librarySlot: 10,
    ...PANE_FACING_LOAD,
    tagline: 'Opposing corner demand drives a clamped steel web into diagonal tension-field wrinkling and an X-shaped yield signature.',
    objective: 'Show shear-dominated deformation, diagonal wrinkle formation, opposite-sign loading, edge reaction, and progressive diagonal damage.',
    baseSceneId: 780, profileVariant: 0, boundary: 'four-corner', loadPattern: 'torsion', loadCenter: [0.5, 0.5], loadRadius: [0.72, 0.72], strikeCenter: [0.62, 0.62],
    loadScale: 0.72, primaryLoad: 0.66, ultimateLoad: 1.24, primaryStrike: 0.64, ultimateStrike: 1.06,
    crackStyle: 'diagonal', fixtureStyle: 'fatigue', span: 20, depth: 10.6, stations: 44, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.46, 0.24, 28, [0, 7.2, 0]),
  },
  {
    id: 'metal-notched-fatigue', kind: 'metal', title: 'Fatigue Notch',
    specimen: 'Notched Coupon', labGroup: 'structural', materialLabel: 'Structural Steel', librarySlot: 11,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A seeded center notch endures deterministic reversing displacement until a narrow ductile ligament progressively loses capacity.',
    objective: 'Reveal cyclic plasticity, fatigue damage accumulation, notch sensitivity, crack growth, stiffness loss, and final residual deformation.',
    baseSceneId: 780, profileVariant: 0, boundary: 'end-clamped', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.07, 0.86], strikeCenter: [0.5, 0.5],
    loadScale: 0.84, primaryLoad: 0.70, ultimateLoad: 1.30, primaryStrike: 0.68, ultimateStrike: 1.12,
    crackStyle: 'local', fixtureStyle: 'fatigue', span: 24, depth: 5.2, stations: 48, lanes: 9, recommendedStress: 5, duration: 20,
    camera: camera(-1.18, 0.38, 30, [0, 7.0, 0]),
  },
  {
    id: 'metal-blast-bulge-armor', kind: 'metal', title: 'Blast Bulge',
    specimen: 'Armor Plate', labGroup: 'impact', materialLabel: 'Structural Steel', librarySlot: 12,
    ...PANE_FACING_LOAD,
    tagline: 'A short distributed pressure pulse drives a perimeter-clamped armor plate into a broad dome with radial yield bands.',
    objective: 'Show impulse-driven membrane action, distributed curvature, radial plasticity, rebound, residual bulge, and possible central plug damage.',
    baseSceneId: 780, profileVariant: 0, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.5, 0.5],
    loadScale: 1.16, primaryLoad: 0.90, ultimateLoad: 1.64, primaryStrike: 1.06, ultimateStrike: 1.62,
    crackStyle: 'radial', fixtureStyle: 'blast', span: 22, depth: 10.4, stations: 48, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.48, 0.26, 30, [0, 7.2, 0]),
  },
  {
    id: 'metal-springback-fold', kind: 'metal', title: 'Springback Fold',
    specimen: 'Thin Aluminum', labGroup: 'structural', materialLabel: 'Aluminum 6061-T6', librarySlot: 32,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A thin aluminum blank takes a press-brake V, then unloads so elastic recovery is visibly larger than the thicker steel fold.',
    objective: 'Compare discrete-shell springback: thin-gauge bending, hinge plasticity, unload angle recovery, and retained V versus the steel Metal Fold.',
    baseSceneId: 780, profileVariant: 1, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.048, 1], strikeCenter: [0.5, 0.5],
    loadScale: 0.86, primaryLoad: 0.64, ultimateLoad: 1.18, primaryStrike: 0.52, ultimateStrike: 0.96,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 24, depth: 5.6, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    thicknessMm: 1.0,
    holdThenUnloadSeconds: 1.35,
    camera: camera(-1.36, 0.36, 28, [0, 6.55, 0]),
  },
  {
    id: 'metal-thick-plate-dent', kind: 'metal', title: 'Thick Plate Dent',
    specimen: 'Thick Aluminum', labGroup: 'impact', materialLabel: 'Aluminum 6061-T6', librarySlot: 33,
    ...SHEET_ON_SUPPORTS,
    tagline: 'The same ballistic punch hits an 8 mm aluminum plate whose area-weighted mass and t³ hinge stiffness resist the dent the 3 mm panel takes easily.',
    objective: 'Show thickness-scaled mass, membrane, and discrete-shell bending: smaller peak dent, less plastic set, and a smoother residual dish.',
    baseSceneId: 780, profileVariant: 1, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.34], strikeCenter: [0.5, 0.5],
    loadScale: 1, primaryLoad: 0.82, ultimateLoad: 1.42, primaryStrike: 0.90, ultimateStrike: 1.48,
    crackStyle: 'local', fixtureStyle: 'press', span: 24, depth: 8.6, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    thicknessMm: 8,
    camera: camera(-0.96, 0.58, 22.0, [0, 7.05, 0]),
  },
  {
    id: 'metal-notch-tear', kind: 'metal', title: 'Notch Tear',
    specimen: 'Notched Sheet', labGroup: 'structural', materialLabel: 'Structural Steel', librarySlot: 34,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A seeded center notch concentrates stretch until a ductile tear runs along the weakened seam instead of a round punch dent.',
    objective: 'Initiate a stretch-based seam tear from a notch, with discrete-shell resistance away from the flaw and welded-skin opening along the ligament.',
    baseSceneId: 780, profileVariant: 0, boundary: 'end-clamped', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.10, 0.22], strikeCenter: [0.5, 0.5],
    loadScale: 1.18, primaryLoad: 0.92, ultimateLoad: 1.52, primaryStrike: 1.02, ultimateStrike: 1.46,
    crackStyle: 'local', fixtureStyle: 'ram', span: 24, depth: 6.4, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    thicknessMm: 2.5,
    notch: [0.5, 0.5, 0.16],
    camera: camera(-1.16, 0.40, 29, [0, 6.80, 0]),
  },
] as const;

const GLASS_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'glass-annealed-pendulum-impact', kind: 'glass', title: 'Pendulum Impact',
    specimen: 'Annealed Pane', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 13,
    ...PANE_FACING_LOAD,
    tagline: 'A framed annealed pane bows under a soft pendulum strike before long radial cracks release large dagger-shaped shards.',
    objective: 'Show narrow elastic capacity, center nucleation, long radial cracking, large transparent fragments, and gravity-separated residual islands.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.32], strikeCenter: [0.5, 0.5],
    loadScale: 0.84, primaryLoad: 0.16, ultimateLoad: 0.36, primaryStrike: 0.82, ultimateStrike: 1.28,
    crackStyle: 'radial', fixtureStyle: 'facade', span: 24, depth: 8.6, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-1.46, 0.22, 30, [0, 7.2, 0]),
  },
  {
    id: 'glass-tempered-safety-punch', kind: 'glass', title: 'Safety Punch',
    specimen: 'Tempered Glass', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 14,
    ...PANE_FACING_LOAD,
    tagline: 'A compact punch releases stored surface compression into a dense pebble-sized fracture mosaic with bounded shard energy.',
    objective: 'Demonstrate dense branching, rapid crack-front multiplication, small transparent fragments, safe breakup, and a retained frame perimeter.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.10, 0.18], strikeCenter: [0.5, 0.5],
    loadScale: 0.68, primaryLoad: 0.12, ultimateLoad: 0.28, primaryStrike: 0.94, ultimateStrike: 1.42,
    crackStyle: 'dense', fixtureStyle: 'facade', span: 22, depth: 9.2, stations: 48, lanes: 15, recommendedStress: 5, duration: 17,
    camera: camera(-1.44, 0.20, 28, [0, 7.2, 0]),
  },
  {
    id: 'glass-laminated-stone-strike', kind: 'glass', title: 'Glass Impact',
    specimen: 'Laminated Glass', labGroup: 'impact', materialLabel: 'Laminated Glass', librarySlot: 3,
    ...PANE_FACING_LOAD,
    tagline: 'A small off-center stone produces a spiderweb crack while the laminated pane retains broken islands instead of ejecting a free shard sheet.',
    objective: 'Show localized impact, intersecting radial rings, retained transparent fragments, interlayer-like sag, and limited opening displacement.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.36, 0.62], loadRadius: [0.12, 0.18], strikeCenter: [0.36, 0.62],
    loadScale: 0.62, primaryLoad: 0.10, ultimateLoad: 0.24, primaryStrike: 0.76, ultimateStrike: 1.12,
    crackStyle: 'retained', fixtureStyle: 'facade', span: 23, depth: 8.4, stations: 48, lanes: 13, recommendedStress: 4, duration: 18,
    camera: camera(-1.40, 0.22, 26, [-2.4, 7.3, 0]),
  },
  {
    id: 'glass-edge-chip-runaway', kind: 'glass', title: 'Edge-Chip Crack',
    specimen: 'Annealed Pane', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 15,
    ...PANE_FACING_LOAD,
    tagline: 'A seeded flaw near the frame edge launches an asymmetric crack fan that races across the pane toward the opposite corner.',
    objective: 'Resolve edge-flaw sensitivity, directional crack propagation, asymmetric fragment release, frame interaction, and surviving pane islands.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'edge', loadCenter: [0.14, 0.56], loadRadius: [0.12, 0.30], strikeCenter: [0.12, 0.56],
    loadScale: 0.76, primaryLoad: 0.14, ultimateLoad: 0.32, primaryStrike: 0.72, ultimateStrike: 1.16,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 24, depth: 9.0, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-1.32, 0.20, 28, [-4.2, 7.3, 0]),
  },
  {
    id: 'glass-four-bolt-facade', kind: 'glass', title: 'Point-Supported Facade',
    specimen: 'Facade Lite', labGroup: 'structural', materialLabel: 'Soda-Lime Glass', librarySlot: 16,
    ...PANE_FACING_LOAD,
    tagline: 'Four corner fasteners concentrate demand until a stressed point support seeds a star crack through the floating glass plate.',
    objective: 'Show point-supported boundary response, fastener stress concentration, corner-origin fracture, transparent shard retention, and hardware load paths.',
    baseSceneId: 796, profileVariant: 6, boundary: 'four-corner', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.18, 0.18],
    loadScale: 0.82, primaryLoad: 0.16, ultimateLoad: 0.38, primaryStrike: 0.80, ultimateStrike: 1.24,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 22, depth: 9.6, stations: 46, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.52, 0.24, 30, [-2.2, 7.2, 0]),
  },
  {
    id: 'glass-curtain-wall-wind', kind: 'glass', title: 'Curtain-Wall Wind',
    specimen: 'Facade Lite', labGroup: 'structural', materialLabel: 'Soda-Lime Glass', librarySlot: 17,
    ...PANE_FACING_LOAD,
    tagline: 'Uniform facade pressure bows an edge-supported lite until a perimeter crack turns into a rapid whole-pane release.',
    objective: 'Demonstrate distributed wind pressure, broad elastic bowing, edge stress, corner crack onset, and outward transparent fragment motion.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.95, 0.95], strikeCenter: [0.78, 0.22],
    loadScale: 0.96, primaryLoad: 0.20, ultimateLoad: 0.46, primaryStrike: 0.72, ultimateStrike: 1.18,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 26, depth: 10.2, stations: 48, lanes: 15, recommendedStress: 5, duration: 19,
    camera: camera(-1.48, 0.20, 32, [0, 7.2, 0]),
  },
  {
    id: 'glass-ballistic-off-center', kind: 'glass', title: 'Ballistic Glass',
    specimen: 'Architectural Lite', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 18,
    ...PANE_FACING_LOAD,
    tagline: 'A compact high-speed projectile punches an off-axis opening and drives a directional cone of thin glass fragments into the capture bay.',
    objective: 'Show localized penetration, asymmetric radial cracking, directional shard velocity, clean transparent edges, and bounded perforation growth.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.68, 0.42], loadRadius: [0.08, 0.14], strikeCenter: [0.70, 0.42],
    loadScale: 0.72, primaryLoad: 0.10, ultimateLoad: 0.22, primaryStrike: 1.04, ultimateStrike: 1.66,
    crackStyle: 'radial', fixtureStyle: 'ram', span: 23, depth: 8.8, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-1.38, 0.18, 26, [3.2, 7.1, 0]),
  },
  {
    id: 'glass-blast-overpressure', kind: 'glass', title: 'Blast Overpressure',
    specimen: 'Framed Pane', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 19,
    ...PANE_FACING_LOAD,
    tagline: 'A broad pressure pulse bows the framed pane as one membrane before a fast branching front releases an outward shard sheet.',
    objective: 'Resolve whole-pane impulse response, distributed tensile demand, rapid branching, outward fragment field, and pressure-release recovery.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'pulse', loadCenter: [0.5, 0.5], loadRadius: [0.92, 0.92], strikeCenter: [0.5, 0.5],
    loadScale: 1.08, primaryLoad: 0.24, ultimateLoad: 0.52, primaryStrike: 1.02, ultimateStrike: 1.58,
    crackStyle: 'dense', fixtureStyle: 'blast', span: 25, depth: 10.0, stations: 48, lanes: 15, recommendedStress: 5, duration: 18,
    camera: camera(-1.50, 0.22, 32, [0, 7.2, 0]),
  },
  {
    id: 'glass-hail-multi-hit', kind: 'glass', title: 'Hail Multi-Hit',
    specimen: 'Architectural Lite', labGroup: 'impact', materialLabel: 'Soda-Lime Glass', librarySlot: 20,
    ...PANE_FACING_LOAD,
    tagline: 'Two deterministic compact impacts seed intersecting fracture stars that compete across a wind-loaded architectural lite.',
    objective: 'Show multi-origin cracks, interacting radial fronts, bounded fragment count, frame retention, and distinct first- versus second-hit damage.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'dual', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.24], strikeCenter: [0.34, 0.62],
    loadScale: 0.70, primaryLoad: 0.12, ultimateLoad: 0.28, primaryStrike: 0.74, ultimateStrike: 1.20,
    crackStyle: 'radial', fixtureStyle: 'drop', span: 24, depth: 9.4, stations: 48, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.42, 0.22, 28, [-1.8, 7.4, 0]),
  },
  {
    id: 'glass-thermal-corner-fracture', kind: 'glass', title: 'Thermal Fracture',
    specimen: 'Facade Lite', labGroup: 'structural', materialLabel: 'Soda-Lime Glass', librarySlot: 21,
    ...PANE_FACING_LOAD,
    tagline: 'A restrained corner flaw under broad facade bowing launches diagonal cracks between cold-edge and warm-center stress zones.',
    objective: 'Demonstrate corner-origin fracture, diagonal crack bias, restrained edge movement, sparse shard release, and a readable forensic crack map.',
    baseSceneId: 796, profileVariant: 6, boundary: 'end-clamped', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.84, 0.82],
    loadScale: 0.78, primaryLoad: 0.15, ultimateLoad: 0.34, primaryStrike: 0.70, ultimateStrike: 1.10,
    crackStyle: 'diagonal', fixtureStyle: 'facade', span: 23, depth: 9.2, stations: 46, lanes: 13, recommendedStress: 4, duration: 18,
    camera: camera(-1.56, 0.24, 28, [3.6, 7.6, 0]),
  },
] as const;

const CONCRETE_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'concrete-three-point-beam', kind: 'concrete', title: 'Three-Point Beam',
    specimen: 'RC Beam', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 22,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A reinforced span develops a center soffit crack, sheds cover as aggregate-rich spall, and transfers residual demand into exposed steel.',
    objective: 'Show flexural cracking, cover loss, physical rubble, translucent dust, rebar bridging, unload residuals, and deterministic fracture telemetry.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.07, 0.82], strikeCenter: [0.5, 0.5],
    loadScale: 1, primaryLoad: 0.78, ultimateLoad: 1.34, primaryStrike: 0.92, ultimateStrike: 1.48,
    crackStyle: 'local', fixtureStyle: 'reaction-frame', span: 24, depth: 6.8, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-1.22, 0.36, 32, [0, 6.9, 0]),
  },
  {
    id: 'concrete-four-point-beam', kind: 'concrete', title: 'Four-Point Beam',
    specimen: 'RC Beam', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 23,
    ...SHEET_ON_SUPPORTS,
    tagline: 'Twin load noses produce a broad constant-moment region where multiple vertical cracks share demand before cover spalls.',
    objective: 'Demonstrate distributed flexural cracking, dual actuator load paths, progressive cover loss, steel bridging, and a wide damaged zone.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'dual', loadCenter: [0.5, 0.5], loadRadius: [0.08, 0.78], strikeCenter: [0.66, 0.5],
    loadScale: 0.96, primaryLoad: 0.72, ultimateLoad: 1.30, primaryStrike: 0.86, ultimateStrike: 1.40,
    crackStyle: 'local', fixtureStyle: 'reaction-frame', span: 27, depth: 6.4, stations: 48, lanes: 9, recommendedStress: 5, duration: 19,
    camera: camera(-1.16, 0.36, 36, [0, 6.9, 0]),
  },
  {
    id: 'concrete-flat-slab-punching', kind: 'concrete', title: 'Concrete Shear',
    specimen: 'Reinforced Slab', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 4,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A central column platen drives a four-corner-supported slab toward an annular punching cone and exposed radial reinforcement.',
    objective: 'Show two-way slab action, concentrated column demand, cone-style breakout, radial cracking, aggregate exposure, and retained bar paths.',
    baseSceneId: 795, profileVariant: 5, boundary: 'four-corner', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.13, 0.28], strikeCenter: [0.5, 0.5],
    loadScale: 1.12, primaryLoad: 0.84, ultimateLoad: 1.48, primaryStrike: 1.02, ultimateStrike: 1.62,
    crackStyle: 'cone', fixtureStyle: 'press', span: 20, depth: 11.2, stations: 46, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-0.98, 0.68, 32, [0, 7.05, 0]),
  },
  {
    id: 'concrete-slab-drop-weight', kind: 'concrete', title: 'Drop-Weight Slab',
    specimen: 'RC Slab', labGroup: 'impact', materialLabel: 'Reinforced Concrete', librarySlot: 24,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A compact falling mass excavates a top crater while radial cracks and back-face spall expose mineral aggregate and steel.',
    objective: 'Resolve impact crater formation, local crushing, radial fracture, back-face spall, physical debris, dust, and reinforcement retention.',
    baseSceneId: 795, profileVariant: 5, boundary: 'end-clamped', loadPattern: 'pulse', loadCenter: [0.58, 0.48], loadRadius: [0.12, 0.26], strikeCenter: [0.58, 0.48],
    loadScale: 1.08, primaryLoad: 0.62, ultimateLoad: 1.22, primaryStrike: 1.10, ultimateStrike: 1.72,
    crackStyle: 'radial', fixtureStyle: 'drop', span: 22, depth: 9.4, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    camera: camera(-0.72, 0.62, 30, [1.2, 7.05, 0]),
  },
  {
    id: 'concrete-bridge-deck-wheel', kind: 'concrete', title: 'Wheel Patch',
    specimen: 'Bridge Deck', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 25,
    ...SHEET_ON_SUPPORTS,
    tagline: 'Twin wheel patches walk across a reinforced deck strip, building flexural cracks and localized punching damage near the loaded lane.',
    objective: 'Show moving load equivalence, dual patch demand, lane-localized damage, aggregate breakout, residual deck curvature, and bar continuity.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'dual', loadCenter: [0.62, 0.34], loadRadius: [0.10, 0.20], strikeCenter: [0.68, 0.34],
    loadScale: 0.88, primaryLoad: 0.70, ultimateLoad: 1.26, primaryStrike: 0.82, ultimateStrike: 1.34,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 28, depth: 9.0, stations: 48, lanes: 11, recommendedStress: 5, duration: 19,
    camera: camera(-0.78, 0.58, 36, [2.4, 7.05, -0.8]),
  },
  {
    id: 'concrete-cantilever-corbel', kind: 'concrete', title: 'Corbel Shear',
    specimen: 'RC Corbel', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 26,
    ...SHEET_ON_SUPPORTS,
    tagline: 'A short reinforced corbel carries an edge load into a single reaction face until diagonal shear cracking exposes its steel tie.',
    objective: 'Demonstrate deep-member action, cantilever root demand, diagonal cracking, compact cover spall, aggregate interlock, and steel tie bridging.',
    baseSceneId: 795, profileVariant: 5, boundary: 'cantilever', loadPattern: 'edge', loadCenter: [0.86, 0.5], loadRadius: [0.11, 0.68], strikeCenter: [0.80, 0.5],
    loadScale: 0.92, primaryLoad: 0.74, ultimateLoad: 1.32, primaryStrike: 0.88, ultimateStrike: 1.42,
    crackStyle: 'diagonal', fixtureStyle: 'ram', span: 20, depth: 7.4, stations: 44, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-0.32, 0.36, 26, [4.0, 7.0, 0]),
  },
  {
    id: 'concrete-barrier-impact', kind: 'concrete', title: 'Barrier Impact',
    specimen: 'Barrier Strip', labGroup: 'impact', materialLabel: 'Reinforced Concrete', librarySlot: 27,
    ...PANE_FACING_LOAD,
    tagline: 'An eccentric lateral-equivalent strike drives a localized front crater, rear scabbing, and visible reinforcement bridging in a barrier strip.',
    objective: 'Show impact localization, asymmetric crack growth, front and back cover loss, dust, aggregate, and residual steel load transfer.',
    baseSceneId: 795, profileVariant: 5, boundary: 'end-clamped', loadPattern: 'offset', loadCenter: [0.66, 0.40], loadRadius: [0.12, 0.28], strikeCenter: [0.68, 0.40],
    loadScale: 0.94, primaryLoad: 0.68, ultimateLoad: 1.28, primaryStrike: 1.06, ultimateStrike: 1.68,
    crackStyle: 'radial', fixtureStyle: 'ram', span: 24, depth: 8.4, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    camera: camera(-1.42, 0.22, 28, [2.8, 7.2, 0]),
  },
  {
    id: 'concrete-blast-wall-spall', kind: 'concrete', title: 'Blast Spall',
    specimen: 'Blast Wall', labGroup: 'impact', materialLabel: 'Reinforced Concrete', librarySlot: 28,
    ...PANE_FACING_LOAD,
    tagline: 'A broad impulse bends the reinforced panel and ejects a shallow rear scab while the steel grid preserves a residual load path.',
    objective: 'Resolve distributed impulse, flexural field response, back-face spall, suspended dust, mineral aggregate, and persistent reinforcement.',
    baseSceneId: 795, profileVariant: 5, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.90, 0.90], strikeCenter: [0.5, 0.5],
    loadScale: 1.10, primaryLoad: 0.82, ultimateLoad: 1.48, primaryStrike: 1.08, ultimateStrike: 1.70,
    crackStyle: 'radial', fixtureStyle: 'blast', span: 23, depth: 10.2, stations: 48, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.48, 0.24, 32, [0, 7.2, 0]),
  },
  {
    id: 'concrete-anchor-pullout', kind: 'concrete', title: 'Anchor Pull-Out',
    specimen: 'RC Slab', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 29,
    ...SLAB_PULL_OUT,
    tagline: 'A localized anchor demand lifts a conical breakout field from a four-corner-supported slab and reveals radial reinforcement.',
    objective: 'Show concentrated pull-out demand, cone-shaped fracture, radial crack spokes, exposed anchor zone, physical rubble, and steel retention.',
    baseSceneId: 795, profileVariant: 5, boundary: 'four-corner', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.10, 0.22], strikeCenter: [0.5, 0.5],
    loadScale: 1.06, primaryLoad: 0.78, ultimateLoad: 1.42, primaryStrike: 0.98, ultimateStrike: 1.56,
    crackStyle: 'cone', fixtureStyle: 'press', span: 20, depth: 10.6, stations: 46, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.02, 0.70, 32, [0, 7.05, 0]),
  },
  {
    id: 'concrete-cyclic-deck-fatigue', kind: 'concrete', title: 'Deck Fatigue',
    specimen: 'Deck Strip', labGroup: 'structural', materialLabel: 'Reinforced Concrete', librarySlot: 30,
    ...SHEET_ON_SUPPORTS,
    tagline: 'Repeated service-level displacement accumulates distributed cracks before a final overload sheds cover and exposes working reinforcement.',
    objective: 'Demonstrate fatigue accumulation, crack multiplication, stiffness loss, final overload spall, residual curvature, and intact bar bridging.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.08, 0.78], strikeCenter: [0.5, 0.5],
    loadScale: 0.78, primaryLoad: 0.62, ultimateLoad: 1.24, primaryStrike: 0.76, ultimateStrike: 1.34,
    crackStyle: 'local', fixtureStyle: 'fatigue', span: 26, depth: 7.2, stations: 48, lanes: 9, recommendedStress: 5, duration: 20,
    camera: camera(-1.12, 0.42, 34, [0, 6.95, 0]),
  },
] as const;

const COMBINED_DEMO: MaterialDemoRecipe = {
  id: 'apex-materials-proving-ground', kind: 'combined', title: 'Apex Materials Proving Ground',
  specimen: 'Mixed Specimens', labGroup: 'structural', materialLabel: 'Mixed Materials', librarySlot: 31,
  ...SHEET_ON_SUPPORTS,
  tagline: 'A single cinematic proving hall runs a metal-forming press, backlit ballistic glass tunnel, and reinforced-concrete reaction frame through one coordinated failure sequence.',
  objective: 'Present simultaneous deterministic metal deformation, glass fracture, concrete spall, transparent shards, physical aggregate, dust, surviving reinforcement, and forensic telemetry in one AAA scene.',
  baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.34], strikeCenter: [0.5, 0.5],
  loadScale: 1, primaryLoad: 0.76, ultimateLoad: 1.42, primaryStrike: 0.92, ultimateStrike: 1.52,
  crackStyle: 'radial', fixtureStyle: 'reaction-frame', span: 24, depth: 8.6, stations: 48, lanes: 13, recommendedStress: 5, duration: 28,
  camera: camera(-0.78, 0.38, 102, [0, 7.0, 0]),
};

export const MATERIAL_DEMO_RECIPES: readonly MaterialDemoRecipe[] = [
  ...METAL_DEMOS,
  ...GLASS_DEMOS,
  ...CONCRETE_DEMOS,
  COMBINED_DEMO,
] as const;

const byId = new Map(MATERIAL_DEMO_RECIPES.map((recipe) => [recipe.id, recipe] as const));

export function getMaterialDemoRecipe(id: string | undefined): MaterialDemoRecipe | null {
  return id ? byId.get(id) ?? null : null;
}

export function materialLabGroupLabel(group: MaterialLabGroup): string {
  return materialLabCategoryLabel(group);
}

export function getMaterialLabLibrary(group: MaterialLabFilter = 'all'): readonly MaterialDemoRecipe[] {
  const ordered = [...MATERIAL_DEMO_RECIPES].sort((a, b) => a.librarySlot - b.librarySlot);
  if (group === 'all') return ordered;
  switch (group) {
    case 'structural':
    case 'impact':
    case 'fluid':
    case 'soft-body':
    case 'cloth':
      return ordered.filter((recipe) => recipe.labGroup === group);
    default: {
      const exhaustive: never = group;
      throw new Error(`Unhandled material lab group filter: ${exhaustive}`);
    }
  }
}

export function materialDemoPreset(recipe: MaterialDemoRecipe) {
  return materialPresetForVariant(recipe.profileVariant);
}

export function materialDemoCounts(): Readonly<Record<MaterialDemoKind, number>> {
  return MATERIAL_DEMO_RECIPES.reduce<Record<MaterialDemoKind, number>>((counts, recipe) => {
    counts[recipe.kind]++;
    return counts;
  }, { metal: 0, glass: 0, concrete: 0, combined: 0 });
}

export function sceneForMaterialDemo(id: string): ScenePreset {
  const recipe = getMaterialDemoRecipe(id);
  if (!recipe) throw new Error(`Unknown material demo recipe: ${id}`);
  const base = getSceneById(recipe.baseSceneId);
  return {
    ...base,
    variant: recipe.profileVariant,
    title: recipe.title,
    subtitle: `${recipe.specimen} · ${materialLabGroupLabel(recipe.labGroup)}`,
    details: recipe.objective,
    defaultStress: recipe.recommendedStress,
    recommendedMaxBodies: Math.max(base.recommendedMaxBodies, recipe.kind === 'combined' ? 2200 : 980),
    camera: { ...recipe.camera, target: [...recipe.camera.target] as Vec3 },
    tags: [
      ...base.tags,
      'material-demo',
      recipe.kind,
      recipe.boundary,
      recipe.loadPattern,
      recipe.crackStyle,
      recipe.fixtureStyle,
      materialDemoResolvedOrientation(recipe),
      recipe.labGroup,
      recipe.specimen.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    ],
    tourSeconds: recipe.duration,
    materialDemoId: recipe.id,
  };
}

const color = (hex: number, alpha: number): readonly [number, number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
  alpha,
];
const box = (pos: Vec3, half: Vec3, shade: readonly [number, number, number, number], rot: Vec3 = [0, 0, 0]): AAAStagePrimitive => ({ pos, half, rot, color: shade });

const STEEL = color(0x8e9cab, -2);
const DARK_STEEL = color(0x273444, 1);
const CONCRETE = color(0x858783, -1);
const STONE = color(0x77766f, -5);
const GLASS = color(0x83d9ee, -4);
const BLACK = color(0x08111d, 1);
const RED = color(0xb63228, 1);
const AMBER = color(0xffb84c, 3.2);
const CYAN = color(0x4bd8ff, 2.8);
const LAB_WALL = color(0x4a5053, 1);
const LAB_FLOOR = color(0x111416, 1);
const LAB_REVEAL = color(0x101416, -2);
const LAB_CEILING = color(0x0d1012, 1);
const MACHINE_PAINT = color(0x2a332c, 1);
const GALVANIZED = color(0x77838a, -2);
const SAFETY_YELLOW = color(0xd99b18, 1);
const WORK_LIGHT = color(0xf2e4c0, 3.2);
const SAFETY_GLASS = color(0x91b9c1, -4);
const WAREHOUSE_FLOOR = color(0x8c887f, -1);
const WAREHOUSE_CMU = color(0x9a948a, -1);
const WAREHOUSE_CORRUGATED = color(0x6a706c, -2);
const WAREHOUSE_CEILING = color(0x3e403c, 1);

const WAREHOUSE_RIBS: readonly AAAStagePrimitive[] = ([-24, -16, -8, 0, 8, 16, 24] as const).map((x) => (
  box([x, 9.0, 11.28], [0.16, 8.4, 0.12], WAREHOUSE_CORRUGATED)
));

const WAREHOUSE_HIGH_BAYS: readonly AAAStagePrimitive[] = ([-12, 0, 12] as const).flatMap((x) => (
  ([-12, -2, 6] as const).flatMap((z) => [
    box([x, 17.88, z], [2.1, 0.12, 2.1], MACHINE_PAINT),
    box([x, 17.68, z], [1.7, 0.05, 1.7], WORK_LIGHT),
  ])
));

// Shared shop-floor shell for metal press demos. Open toward -Z so the
// authored three-quarter camera looks in through the loading bay.
const WAREHOUSE_SHOP: readonly AAAStagePrimitive[] = [
  box([0, 0.18, -4], [40, 0.18, 28], WAREHOUSE_FLOOR),
  box([0, 9.6, 11.6], [40, 9.6, 0.42], WAREHOUSE_CMU),
  box([-39.4, 9.4, -4], [0.40, 9.4, 24], WAREHOUSE_CMU),
  box([39.4, 9.4, -4], [0.40, 9.4, 24], WAREHOUSE_CMU),
  box([0, 18.35, -4], [40, 0.32, 28], WAREHOUSE_CEILING),
  box([0, 2.45, 11.22], [39.0, 2.45, 0.16], WAREHOUSE_CORRUGATED),
  ...WAREHOUSE_RIBS,
  box([0, 17.88, -10.0], [38.0, 0.16, 0.22], GALVANIZED),
  box([0, 17.88, 0.5], [38.0, 0.16, 0.22], GALVANIZED),
  box([0, 17.88, 10.4], [38.0, 0.16, 0.22], GALVANIZED),
  box([-38.0, 9.2, -26.5], [0.46, 9.2, 0.46], GALVANIZED),
  box([38.0, 9.2, -26.5], [0.46, 9.2, 0.46], GALVANIZED),
  box([-38.0, 9.2, 11.0], [0.46, 9.2, 0.46], GALVANIZED),
  box([38.0, 9.2, 11.0], [0.46, 9.2, 0.46], GALVANIZED),
  box([-22.0, 8.2, -26.2], [0.26, 8.2, 0.34], GALVANIZED),
  box([22.0, 8.2, -26.2], [0.26, 8.2, 0.34], GALVANIZED),
  box([0, 16.55, -26.2], [22.3, 0.26, 0.34], GALVANIZED),
  ...WAREHOUSE_HIGH_BAYS,
  box([0, 0.39, -8.4], [18.0, 0.018, 0.08], SAFETY_YELLOW),
  box([-18.0, 0.39, 0.2], [0.08, 0.018, 8.6], SAFETY_YELLOW),
  box([18.0, 0.39, 0.2], [0.08, 0.018, 8.6], SAFETY_YELLOW),
];

const WAREHOUSE_FACILITY_END = 6 + WAREHOUSE_RIBS.length + 3 + 4 + 3;
const WAREHOUSE_LIGHTING_END = WAREHOUSE_FACILITY_END + WAREHOUSE_HIGH_BAYS.length;
const WAREHOUSE_SAFETY_END = WAREHOUSE_LIGHTING_END + 3;

// Press-cell extras sit inside the shared warehouse bay. Presentation-only;
// they carry no physical-unit claims.
const SQUARE_PUNCH_STAGE: readonly AAAStagePrimitive[] = [
  ...WAREHOUSE_SHOP,
  box([0, 0.375, -6.85], [13.4, 0.018, 0.20], MACHINE_PAINT),
  box([0, 0.402, -6.85], [12.8, 0.012, 0.055], GALVANIZED),
  ...[-10.8, -6.5, -2.2, 2.2, 6.5, 10.8].flatMap((x) => [
    box([x, 0.48, -5.78], [0.25, 0.10, 0.25], GALVANIZED),
  ]),
  box([-15.8, 2.25, 0.8], [0.11, 1.80, 5.0], GALVANIZED),
  box([15.8, 2.25, 0.8], [0.11, 1.80, 5.0], GALVANIZED),
  box([-15.65, 2.35, 0.8], [0.035, 1.45, 4.55], SAFETY_GLASS),
  box([15.65, 2.35, 0.8], [0.035, 1.45, 4.55], SAFETY_GLASS),
  box([-15.4, 4.12, 0.8], [0.42, 0.16, 5.10], MACHINE_PAINT),
  box([15.4, 4.12, 0.8], [0.42, 0.16, 5.10], MACHINE_PAINT),
];

// Correlation review benefits from the same low-reflection, enclosed lighting
// context as the reference crash cell. The bulkhead, platen, and rail remain
// solver/frame-owned below; these primitives only provide the test-cell shell.
const CRASH_RAIL_STAGE: readonly AAAStagePrimitive[] = [
  // Enclosed low-reflection crash cell with sealed floor and flush steel sled
  // foundation. The deformable rail, bulkhead, platen, and guide shoes remain
  // authored by the solver's render witnesses.
  box([0, 7.30, 7.90], [22, 7.30, 0.34], LAB_WALL),
  box([-10.8, 7.30, 7.52], [0.09, 6.85, 0.06], LAB_REVEAL),
  box([0, 7.30, 7.52], [0.09, 6.85, 0.06], LAB_REVEAL),
  box([10.8, 7.30, 7.52], [0.09, 6.85, 0.06], LAB_REVEAL),
  box([0, 3.05, 7.50], [21.0, 0.08, 0.07], LAB_REVEAL),
  box([0, 11.10, 7.50], [21.0, 0.08, 0.07], LAB_REVEAL),
  box([0, 0.18, 0], [22, 0.18, 13], LAB_FLOOR),
  box([0, 14.55, 0], [22, 0.20, 13], LAB_CEILING),
  box([0, 0.48, 0], [14.8, 0.10, 5.8], color(0x20262b, -5)),
  box([0, 0.60, -4.95], [14.2, 0.055, 0.08], SAFETY_YELLOW),

  // Overhead high-speed-camera lighting and restrained ceiling beams mirror
  // the hard, even illumination of a physical correlation bay.
  box([-6.8, 14.28, 0.0], [3.6, 0.035, 0.15], WORK_LIGHT),
  box([6.8, 14.28, 0.0], [3.6, 0.035, 0.15], WORK_LIGHT),
  box([-6.8, 14.28, -5.7], [3.6, 0.035, 0.15], WORK_LIGHT),
  box([6.8, 14.28, -5.7], [3.6, 0.035, 0.15], WORK_LIGHT),
  box([0, 13.95, -6.8], [17.8, 0.18, 0.22], MACHINE_PAINT),

  // Tie-down channels, anchor plates, and an outboard observation guard make
  // the sled installation read as bolted equipment instead of a floating prop.
  box([0, 0.68, -3.25], [13.6, 0.08, 0.16], GALVANIZED),
  box([0, 0.68, 3.25], [13.6, 0.08, 0.16], GALVANIZED),
  ...[-11.8, -7.8, -3.8, 0, 3.8, 7.8, 11.8].flatMap((x) => [
    box([x, 0.80, -3.25], [0.20, 0.08, 0.28], GALVANIZED),
    box([x, 0.80, 3.25], [0.20, 0.08, 0.28], GALVANIZED),
  ]),
  box([0, 1.06, -6.05], [13.8, 0.10, 0.10], GALVANIZED),
  ...[-13.8, -9.2, -4.6, 0, 4.6, 9.2, 13.8].flatMap((x) => [
    box([x, 0.74, -6.05], [0.08, 0.64, 0.08], GALVANIZED),
  ]),
  box([-15.9, 2.10, 1.1], [0.10, 1.65, 4.6], GALVANIZED),
  box([-15.75, 2.10, 1.1], [0.025, 1.35, 4.2], SAFETY_GLASS),
  box([-15.5, 3.82, 1.1], [0.38, 0.14, 4.7], MACHINE_PAINT),
];

const METAL_STAGE: readonly AAAStagePrimitive[] = WAREHOUSE_SHOP;

const GLASS_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.20, 0], [15, 0.20, 8], CONCRETE),
  box([0, 7.2, 2.0], [13.4, 5.2, 0.12], BLACK),
  box([-8.4, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN), box([-2.8, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN),
  box([2.8, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN), box([8.4, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN),
  box([0, 0.48, -5.8], [12.8, 0.08, 0.14], AMBER),
  box([-12.8, 1.2, -5.8], [0.14, 1.0, 0.14], RED), box([12.8, 1.2, -5.8], [0.14, 1.0, 0.14], RED),
];

const CONCRETE_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.20, 0], [15, 0.20, 8], STONE),
  box([-13.2, 5.2, -6.8], [0.34, 5.2, 0.34], STEEL), box([13.2, 5.2, -6.8], [0.34, 5.2, 0.34], STEEL),
  box([-13.2, 5.2, 6.8], [0.34, 5.2, 0.34], STEEL), box([13.2, 5.2, 6.8], [0.34, 5.2, 0.34], STEEL),
  box([0, 10.2, -6.8], [13.6, 0.30, 0.30], STEEL), box([0, 10.2, 6.8], [13.6, 0.30, 0.30], STEEL),
  box([-10.5, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER), box([0, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER), box([10.5, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER),
];

const COMBINED_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.18, 0], [45, 0.18, 15], STONE),
  box([0, 0.42, 0], [43, 0.10, 13.5], CONCRETE),
  ...[-42, -14, 14, 42].flatMap((x) => [
    box([x, 7.2, -12.8], [0.36, 7.2, 0.36], DARK_STEEL),
    box([x, 7.2, 12.8], [0.36, 7.2, 0.36], DARK_STEEL),
  ]),
  box([0, 14.2, -12.8], [42.4, 0.34, 0.34], STEEL), box([0, 14.2, 12.8], [42.4, 0.34, 0.34], STEEL),
  box([0, 7.2, 13.0], [10.0, 5.1, 0.12], BLACK),
  box([0, 7.2, 12.78], [9.4, 4.8, 0.04], GLASS),
  box([-39, 0.50, -10.8], [3.5, 0.10, 0.16], AMBER), box([-26, 0.50, -10.8], [3.5, 0.10, 0.16], AMBER),
  box([-7, 0.50, -10.8], [3.5, 0.10, 0.16], CYAN), box([7, 0.50, -10.8], [3.5, 0.10, 0.16], CYAN),
  box([26, 0.50, -10.8], [3.5, 0.10, 0.16], RED), box([39, 0.50, -10.8], [3.5, 0.10, 0.16], RED),
  box([-26, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
  box([0, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
  box([26, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
];

type MaterialStageGroupDefinition = readonly [
  id: string,
  label: string,
  role: EngineeringStageGroupRole,
  start: number,
  end: number,
  ownership?: EngineeringStageOwnership,
];

const EMPTY_MATERIAL_STAGE_GROUPS: readonly EngineeringStageGroup[] = Object.freeze([]);

function defineMaterialStageGroups(
  source: readonly AAAStagePrimitive[],
  definitions: readonly MaterialStageGroupDefinition[],
): readonly EngineeringStageGroup[] {
  return Object.freeze(definitions.map(([id, label, role, start, end, ownership = 'presentation-only']) => Object.freeze({
    id,
    label,
    role,
    ownership,
    primitives: Object.freeze(source.slice(start, end)),
  })));
}

function assertMaterialStageProjection(
  source: readonly AAAStagePrimitive[],
  groups: readonly EngineeringStageGroup[],
  label: string,
): void {
  const ids = new Set<string>();
  let primitiveIndex = 0;
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`${label} contains duplicate engineering stage group '${group.id}'.`);
    ids.add(group.id);
    if (!Object.isFrozen(group) || !Object.isFrozen(group.primitives)) {
      throw new Error(`${label} engineering stage group '${group.id}' must be immutable.`);
    }
    for (const primitive of group.primitives) {
      if (primitive !== source[primitiveIndex]) {
        throw new Error(`${label} engineering stage groups do not preserve flattened primitive order at index ${primitiveIndex}.`);
      }
      primitiveIndex++;
    }
  }
  if (primitiveIndex !== source.length) {
    throw new Error(`${label} engineering stage groups cover ${primitiveIndex} of ${source.length} primitives.`);
  }
}

/** Presentation shell around the Titan bend/dent rig. */
export const TITAN_BEND_DENT_CELL_GROUPS: readonly EngineeringStageGroup[] = defineMaterialStageGroups(
  SQUARE_PUNCH_STAGE,
  [
    ['titan-cell-facility', 'Warehouse shop floor and CMU envelope', 'facility', 0, WAREHOUSE_FACILITY_END],
    ['titan-cell-inspection-lighting', 'High-bay shop lighting', 'instrumentation', WAREHOUSE_FACILITY_END, WAREHOUSE_LIGHTING_END],
    ['titan-cell-safety-envelope', 'Loading-bay safety markings', 'safety', WAREHOUSE_LIGHTING_END, WAREHOUSE_SAFETY_END],
    ['titan-cell-machine-services', 'Service trench and bed datum', 'facility', WAREHOUSE_SAFETY_END, WAREHOUSE_SAFETY_END + 2],
    ['titan-cell-bed-anchors', 'Bed anchor array', 'reaction-frame', WAREHOUSE_SAFETY_END + 2, WAREHOUSE_SAFETY_END + 8],
    ['titan-cell-side-guards', 'Restrained side guards', 'safety', WAREHOUSE_SAFETY_END + 8, WAREHOUSE_SAFETY_END + 14],
  ],
);

/** Presentation shell around the solver-rendered axial-fold rail and platen. */
export const CRASH_RAIL_CELL_GROUPS: readonly EngineeringStageGroup[] = defineMaterialStageGroups(
  CRASH_RAIL_STAGE,
  [
    ['crash-cell-facility', 'Low-reflection correlation cell and sled base', 'facility', 0, 9],
    ['crash-cell-sled-datum', 'Sled safety datum', 'safety', 9, 10],
    ['crash-cell-camera-lighting', 'High-speed-camera lighting grid', 'instrumentation', 10, 15],
    ['crash-cell-reaction-foundation', 'Tie-down channels and anchor plates', 'reaction-frame', 15, 31],
    ['crash-cell-observation-guard', 'Outboard observation guard', 'safety', 31, 42],
  ],
);

const METAL_STAGE_GROUPS = defineMaterialStageGroups(METAL_STAGE, [
  ['metal-stage-foundation', 'Warehouse shop floor and CMU envelope', 'facility', 0, WAREHOUSE_FACILITY_END],
  ['metal-stage-high-bay-lighting', 'High-bay shop lighting', 'instrumentation', WAREHOUSE_FACILITY_END, WAREHOUSE_LIGHTING_END],
  ['metal-stage-safety-datums', 'Loading-bay safety markings', 'safety', WAREHOUSE_LIGHTING_END, WAREHOUSE_SAFETY_END],
]);

const GLASS_STAGE_GROUPS = defineMaterialStageGroups(GLASS_STAGE, [
  ['glass-stage-foundation-and-backdrop', 'Fracture-bay foundation and backdrop', 'facility', 0, 2],
  ['glass-stage-backlighting', 'Fracture backlighting', 'instrumentation', 2, 6],
  ['glass-stage-safety-boundary', 'Shard-zone safety boundary', 'safety', 6, 9],
]);

const CONCRETE_STAGE_GROUPS = defineMaterialStageGroups(CONCRETE_STAGE, [
  ['concrete-stage-foundation', 'Reaction-floor foundation', 'facility', 0, 1],
  ['concrete-stage-reaction-frame', 'Concrete-test reaction frame', 'reaction-frame', 1, 7],
  ['concrete-stage-safety-datums', 'Concrete-test safety datums', 'safety', 7, 10],
]);

const COMBINED_STAGE_GROUPS = defineMaterialStageGroups(COMBINED_STAGE, [
  ['proving-ground-foundation', 'Proving-ground foundation', 'facility', 0, 2],
  ['proving-ground-reaction-frame', 'Shared proving-ground reaction frame', 'reaction-frame', 2, 12],
  ['proving-ground-fracture-bay', 'Backlit fracture bay', 'instrumentation', 12, 14],
  ['proving-ground-safety-datums', 'Cell safety datums', 'safety', 14, 20],
  ['proving-ground-test-decks', 'Isolated material test decks', 'facility', 20, 23],
]);

if (WAREHOUSE_SHOP.length !== WAREHOUSE_SAFETY_END) {
  throw new Error(`Warehouse shop covers ${WAREHOUSE_SHOP.length} primitives, expected ${WAREHOUSE_SAFETY_END}.`);
}
if (SQUARE_PUNCH_STAGE.length !== WAREHOUSE_SAFETY_END + 14) {
  throw new Error(`Square punch stage covers ${SQUARE_PUNCH_STAGE.length} primitives, expected ${WAREHOUSE_SAFETY_END + 14}.`);
}
assertMaterialStageProjection(SQUARE_PUNCH_STAGE, TITAN_BEND_DENT_CELL_GROUPS, 'Titan bend/dent cell');
assertMaterialStageProjection(CRASH_RAIL_STAGE, CRASH_RAIL_CELL_GROUPS, 'Crash rail cell');
assertMaterialStageProjection(METAL_STAGE, METAL_STAGE_GROUPS, 'Metal material stage');
assertMaterialStageProjection(GLASS_STAGE, GLASS_STAGE_GROUPS, 'Glass material stage');
assertMaterialStageProjection(CONCRETE_STAGE, CONCRETE_STAGE_GROUPS, 'Concrete material stage');
assertMaterialStageProjection(COMBINED_STAGE, COMBINED_STAGE_GROUPS, 'Combined material stage');

export function getMaterialDemoStagePrimitives(id: string | undefined): readonly AAAStagePrimitive[] {
  const recipe = getMaterialDemoRecipe(id);
  if (!recipe) return [];
  if (recipe.id === 'metal-square-punch-forming') return SQUARE_PUNCH_STAGE;
  if (recipe.id === 'metal-four-point-bumper-beam') return CRASH_RAIL_STAGE;
  if (recipe.kind === 'metal') return METAL_STAGE;
  if (recipe.kind === 'glass') return GLASS_STAGE;
  if (recipe.kind === 'concrete') return CONCRETE_STAGE;
  return COMBINED_STAGE;
}

export function getMaterialDemoStageGroups(id: string | undefined): readonly EngineeringStageGroup[] {
  const recipe = getMaterialDemoRecipe(id);
  if (!recipe) return EMPTY_MATERIAL_STAGE_GROUPS;
  if (recipe.id === 'metal-square-punch-forming') return TITAN_BEND_DENT_CELL_GROUPS;
  if (recipe.id === 'metal-four-point-bumper-beam') return CRASH_RAIL_CELL_GROUPS;
  if (recipe.kind === 'metal') return METAL_STAGE_GROUPS;
  if (recipe.kind === 'glass') return GLASS_STAGE_GROUPS;
  if (recipe.kind === 'concrete') return CONCRETE_STAGE_GROUPS;
  return COMBINED_STAGE_GROUPS;
}

export const COMBINED_MATERIAL_OFFSETS = {
  metal: [-26, 0, 0] as Vec3,
  glass: [0, 0, 0] as Vec3,
  concrete: [26, 0, 0] as Vec3,
} as const;

export function materialDemoWorldPoint(recipe: MaterialDemoRecipe, target: Exclude<MaterialDemoKind, 'combined'> = recipe.kind as Exclude<MaterialDemoKind, 'combined'>): Vec3 {
  const source = recipe.kind === 'combined'
    ? getMaterialDemoRecipe(target === 'metal' ? 'metal-square-punch-forming' : target === 'glass' ? 'glass-ballistic-off-center' : 'concrete-flat-slab-punching')!
    : recipe;
  const offset = recipe.kind === 'combined' ? COMBINED_MATERIAL_OFFSETS[target] : ([0, 0, 0] as Vec3);
  const x = (source.strikeCenter[0] - 0.5) * source.span + offset[0];
  if (materialDemoIsVertical(source) || target === 'glass') {
    return [x, 7.2 + (source.strikeCenter[1] - 0.5) * source.depth + offset[1], 0.18 + offset[2]];
  }
  return [x, 7.1 + offset[1], (source.strikeCenter[1] - 0.5) * source.depth + offset[2]];
}

const counts = materialDemoCounts();
if (counts.metal !== 13 || counts.glass !== 10 || counts.concrete !== 10 || counts.combined !== 1 || byId.size !== 34) {
  throw new Error(`Material demo registry must contain 13 metal, 10 glass, 10 concrete, and one combined recipe; received ${JSON.stringify(counts)}.`);
}
const librarySlots = new Set(MATERIAL_DEMO_RECIPES.map((recipe) => recipe.librarySlot));
if (librarySlots.size !== 34 || [...librarySlots].some((slot) => slot < 1 || slot > 34)) {
  throw new Error('Material demo librarySlot values must be unique integers from 1 to 34.');
}
for (const [index, featuredId] of MATERIAL_LAB_FEATURED_IDS.entries()) {
  const featured = getMaterialDemoRecipe(featuredId);
  if (!featured || featured.librarySlot !== index + 1) {
    throw new Error(`Material Lab featured slot ${index + 1} must remain '${featuredId}'.`);
  }
}
const featuredTitles = ['Ballistic Dent', 'Metal Fold', 'Glass Impact', 'Concrete Shear'] as const;
const featuredSpecimens = ['Aluminum Panel', 'Sheet Metal', 'Laminated Glass', 'Reinforced Slab'] as const;
for (const [index, featuredId] of MATERIAL_LAB_FEATURED_IDS.entries()) {
  const featured = getMaterialDemoRecipe(featuredId)!;
  if (featured.title !== featuredTitles[index] || featured.specimen !== featuredSpecimens[index]) {
    throw new Error(`Material Lab featured slot ${index + 1} must keep mockup title '${featuredTitles[index]}' (${featuredSpecimens[index]}).`);
  }
}
for (const recipe of MATERIAL_DEMO_RECIPES) {
  if (!recipe.specimen || !recipe.materialLabel) {
    throw new Error(`Material demo '${recipe.id}' is missing Material Lab specimen or material labels.`);
  }
  switch (recipe.labGroup) {
    case 'structural':
    case 'impact':
    case 'fluid':
    case 'soft-body':
    case 'cloth':
      break;
    default: {
      const exhaustive: never = recipe.labGroup;
      throw new Error(`Material demo '${recipe.id}' has an unhandled lab group: ${exhaustive}`);
    }
  }
  const pose = materialDemoSpecimenPose(recipe);
  if (pose.upAxis !== 'Y') {
    throw new Error(`Material demo '${recipe.id}' must stay Y-up.`);
  }
  if (recipe.kind === 'glass' && pose.orientation !== 'vertical') {
    throw new Error(`Material demo '${recipe.id}' must keep the glass pane vertical.`);
  }
  if (
    (recipe.id === 'metal-press-brake-v-bend' || recipe.id === 'metal-springback-fold')
    && (pose.orientation !== 'horizontal' || pose.loadSign !== -1)
  ) {
    throw new Error(`Material demo '${recipe.id}' must fold a horizontal sheet downward into the die.`);
  }
  if (recipe.id === 'metal-four-point-bumper-beam' && pose.orientation !== 'horizontal') {
    throw new Error('Crash rail axial fold must stay a horizontal rail along +X.');
  }
  if (recipe.id === 'concrete-flat-slab-punching' && pose.orientation !== 'horizontal') {
    throw new Error('Concrete slab punching must stay a horizontal slab.');
  }
  if (recipe.camera.pitch < 0.08 || recipe.camera.pitch > 1.3) {
    throw new Error(`Material demo '${recipe.id}' camera pitch must stay in the authored elevation range.`);
  }
  const base = getSceneById(recipe.baseSceneId);
  const finiteValues = [
    ...recipe.loadCenter, ...recipe.loadRadius, ...recipe.strikeCenter,
    recipe.loadScale, recipe.primaryLoad, recipe.ultimateLoad,
    recipe.primaryStrike, recipe.ultimateStrike, recipe.span, recipe.depth,
    recipe.stations, recipe.lanes, recipe.duration,
    recipe.camera.yaw, recipe.camera.pitch, recipe.camera.distance, ...recipe.camera.target,
    pose.yaw, pose.pitch,
  ];
  if (base.id !== recipe.baseSceneId || base.family !== 'fracture') {
    throw new Error(`Material demo '${recipe.id}' must derive from a stable fracture-family scene.`);
  }
  if (!finiteValues.every(Number.isFinite) || recipe.span <= 0 || recipe.depth <= 0 || recipe.stations < 4 || recipe.stations > 48 || recipe.lanes < 3 || recipe.lanes > 15) {
    throw new Error(`Material demo '${recipe.id}' has an invalid finite/capacity contract.`);
  }
  if (recipe.loadRadius.some((value) => value <= 0) || recipe.loadCenter.some((value) => value < 0 || value > 1) || recipe.strikeCenter.some((value) => value < 0 || value > 1)) {
    throw new Error(`Material demo '${recipe.id}' has an invalid normalized load or strike footprint.`);
  }
  if (recipe.ultimateLoad <= recipe.primaryLoad || recipe.ultimateStrike <= recipe.primaryStrike) {
    throw new Error(`Material demo '${recipe.id}' must define an ultimate demand above its primary demand.`);
  }
  if (recipe.holdThenUnloadSeconds !== undefined && (!(recipe.holdThenUnloadSeconds > 0) || recipe.holdThenUnloadSeconds >= recipe.duration)) {
    throw new Error(`Material demo '${recipe.id}' hold-then-unload beat must fit inside the authored duration.`);
  }
}
