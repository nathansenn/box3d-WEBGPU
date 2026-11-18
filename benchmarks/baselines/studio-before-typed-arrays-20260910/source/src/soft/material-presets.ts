export type MaterialFailureMode = 'ductile' | 'brittle' | 'progressive' | 'fiber' | 'hyperelastic' | 'fluid';

/** Lattice catalog ids. Order is the scene-variant mapping and must stay stable. */
export const MATERIAL_BEHAVIOR_PRESET_IDS = [
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
] as const;

export type MaterialBehaviorPresetId = (typeof MATERIAL_BEHAVIOR_PRESET_IDS)[number];

/** Extra Material Lab dropdown entries shown in the concept boards but not in the 10-variant lattice. */
export const MATERIAL_LAB_EXTRA_PRESET_IDS = [
  'laminated-glass',
  'ballistic-fabric',
  'polymer-foam',
  'water',
] as const;

export type MaterialLabExtraPresetId = (typeof MATERIAL_LAB_EXTRA_PRESET_IDS)[number];
export type MaterialLabPresetId = MaterialBehaviorPresetId | MaterialLabExtraPresetId;

export const MATERIAL_LAB_PRESET_IDS = [
  ...MATERIAL_BEHAVIOR_PRESET_IDS,
  ...MATERIAL_LAB_EXTRA_PRESET_IDS,
] as const;

/** Left-rail filter chips on material-lab-desktop.png: ALL + these five. */
export const MATERIAL_LAB_CATEGORIES = [
  'structural',
  'impact',
  'fluid',
  'soft-body',
  'cloth',
] as const;

export type MaterialLabCategory = (typeof MATERIAL_LAB_CATEGORIES)[number];
export const MATERIAL_LAB_FILTERS = ['all', ...MATERIAL_LAB_CATEGORIES] as const;
export type MaterialLabFilter = (typeof MATERIAL_LAB_FILTERS)[number];

export const MATERIAL_LAB_CATEGORY_LABELS: Readonly<Record<MaterialLabCategory, string>> = {
  structural: 'STRUCTURAL',
  impact: 'IMPACT',
  fluid: 'FLUID',
  'soft-body': 'SOFT BODY',
  cloth: 'CLOTH',
};

/**
 * Right-rail MATERIAL / FORCE slider ranges from the desktop board.
 * Mobile uses the same MATERIAL fields; FORCE radius/impulse read the mobile defaults.
 */
export const MATERIAL_LAB_CONTROL_RANGES = {
  yieldStrengthMPa: { label: 'Yield Strength', min: 0, max: 600, unit: 'MPa' },
  hardening: { label: 'Hardening', min: 0, max: 1, unit: '' },
  thicknessMm: { label: 'Thickness', min: 0.1, max: 20, unit: 'mm' },
  forceMagnitudeKN: { label: 'Magnitude', min: 0, max: 200, unit: 'kN' },
  forceRadiusMm: { label: 'Radius', min: 1, max: 20, unit: 'mm' },
  impulseKNs: { label: 'Impulse', min: 0, max: 20, unit: 'kN·s' },
} as const;

export const MATERIAL_LAB_SOLVER_DEFAULTS = {
  substeps: 4,
  substepChoices: [1, 2, 4, 8, 16] as const,
  iterations: 32,
  collision: true,
  adaptiveTimeStep: true,
} as const;

export type MaterialLabControls = {
  readonly yieldStrengthMPa: number;
  readonly hardening: number;
  readonly thicknessMm: number;
  readonly forceMagnitudeKN: number;
  readonly forceRadiusMm: number;
  readonly forceRadiusMobileMm: number;
  readonly impulseKNs: number;
  readonly impulseDurationMs: number;
};

/**
 * Normalized comparative material profile used by the beam-lattice lab.
 *
 * Lattice coefficients are deliberately dimensionless and tuned for visible,
 * deterministic comparisons. They are not Young's modulus, yield stress, or
 * certified design allowables. `lab` values are the Material Lab slider defaults
 * from the concept boards and stay internally consistent with each other; they
 * do not drive the reduced-order solve.
 */
export type MaterialBehaviorPreset = {
  id: MaterialLabPresetId;
  label: string;
  /** Specimen subtitle in the left-rail library (e.g. Aluminum Panel). */
  specimenLabel: string;
  category: MaterialLabCategory;
  failureMode: MaterialFailureMode;
  densityScale: number;
  axialStiffness: number;
  shearStiffness: number;
  bendStiffness: number;
  /** Velocity retained over one 1/60-second reference step. */
  damping: number;
  tensileYieldStrain: number;
  tensileBreakStrain: number;
  compressionYieldStrain: number;
  compressionBreakStrain: number;
  plasticCreep: number;
  damageRate: number;
  fatigueRate: number;
  anisotropy: number;
  baseColor: readonly [number, number, number, number];
  lab: MaterialLabControls;
};

const lab = (
  yieldStrengthMPa: number,
  hardening: number,
  thicknessMm: number,
  forceMagnitudeKN: number,
  forceRadiusMm: number,
  forceRadiusMobileMm: number,
  impulseKNs: number,
  impulseDurationMs: number,
): MaterialLabControls => ({
  yieldStrengthMPa,
  hardening,
  thicknessMm,
  forceMagnitudeKN,
  forceRadiusMm,
  forceRadiusMobileMm,
  impulseKNs,
  impulseDurationMs,
});

export const MATERIAL_BEHAVIOR_PRESETS: readonly MaterialBehaviorPreset[] = [
  {
    id: 'structural-steel', label: 'Structural Steel', specimenLabel: 'Sheet Metal',
    category: 'structural', failureMode: 'ductile',
    densityScale: 1, axialStiffness: 0.985, shearStiffness: 0.91, bendStiffness: 0.96, damping: 0.974,
    tensileYieldStrain: 0.026, tensileBreakStrain: 0.135,
    compressionYieldStrain: 0.029, compressionBreakStrain: 0.15,
    plasticCreep: 0.18, damageRate: 0.72, fatigueRate: 0.12, anisotropy: 1,
    baseColor: [0.40, 0.53, 0.64, -2],
    lab: lab(345, 0.42, 2.50, 56.6, 6.0, 18.0, 2.83, 1.00),
  },
  {
    id: 'aluminum-alloy', label: 'Aluminum 6061-T6', specimenLabel: 'Aluminum Panel',
    category: 'impact', failureMode: 'ductile',
    densityScale: 0.46, axialStiffness: 0.91, shearStiffness: 0.82, bendStiffness: 0.90, damping: 0.970,
    tensileYieldStrain: 0.032, tensileBreakStrain: 0.115,
    compressionYieldStrain: 0.036, compressionBreakStrain: 0.13,
    plasticCreep: 0.24, damageRate: 0.84, fatigueRate: 0.16, anisotropy: 1,
    baseColor: [0.63, 0.71, 0.78, -2],
    lab: lab(276, 0.52, 3.00, 75.0, 5.0, 25.0, 3.75, 1.00),
  },
  {
    id: 'copper', label: 'Copper', specimenLabel: 'Copper Blank',
    category: 'structural', failureMode: 'ductile',
    densityScale: 1.08, axialStiffness: 0.90, shearStiffness: 0.80, bendStiffness: 0.84, damping: 0.964,
    tensileYieldStrain: 0.038, tensileBreakStrain: 0.19,
    compressionYieldStrain: 0.042, compressionBreakStrain: 0.21,
    plasticCreep: 0.34, damageRate: 0.60, fatigueRate: 0.13, anisotropy: 1,
    baseColor: [0.78, 0.31, 0.12, -2],
    lab: lab(70, 0.70, 1.50, 9.5, 8.0, 20.0, 0.48, 1.00),
  },
  {
    id: 'oak-timber', label: 'Oak Timber', specimenLabel: 'Oak Beam',
    category: 'structural', failureMode: 'fiber',
    densityScale: 0.19, axialStiffness: 0.88, shearStiffness: 0.54, bendStiffness: 0.61, damping: 0.982,
    tensileYieldStrain: 0.022, tensileBreakStrain: 0.070,
    compressionYieldStrain: 0.038, compressionBreakStrain: 0.12,
    plasticCreep: 0.10, damageRate: 0.92, fatigueRate: 0.20, anisotropy: 0.46,
    baseColor: [0.48, 0.25, 0.09, 1],
    lab: lab(45, 0.05, 20.00, 81.5, 12.0, 20.0, 4.08, 1.00),
  },
  {
    id: 'cross-laminated-timber', label: 'Cross-Laminated Timber', specimenLabel: 'CLT Panel',
    category: 'structural', failureMode: 'progressive',
    densityScale: 0.17, axialStiffness: 0.83, shearStiffness: 0.69, bendStiffness: 0.68, damping: 0.984,
    tensileYieldStrain: 0.025, tensileBreakStrain: 0.085,
    compressionYieldStrain: 0.043, compressionBreakStrain: 0.14,
    plasticCreep: 0.08, damageRate: 0.78, fatigueRate: 0.18, anisotropy: 0.68,
    baseColor: [0.68, 0.42, 0.17, 1],
    lab: lab(24, 0.04, 20.00, 43.5, 12.0, 20.0, 2.18, 1.00),
  },
  {
    id: 'reinforced-concrete', label: 'Reinforced Concrete', specimenLabel: 'Reinforced Slab',
    category: 'structural', failureMode: 'progressive',
    densityScale: 0.42, axialStiffness: 0.94, shearStiffness: 0.72, bendStiffness: 0.66, damping: 0.978,
    tensileYieldStrain: 0.009, tensileBreakStrain: 0.022,
    compressionYieldStrain: 0.035, compressionBreakStrain: 0.095,
    plasticCreep: 0.025, damageRate: 1.45, fatigueRate: 0.24, anisotropy: 0.82,
    baseColor: [0.43, 0.43, 0.41, -1],
    lab: lab(40, 0.02, 20.00, 72.5, 10.0, 20.0, 3.63, 1.00),
  },
  {
    id: 'soda-lime-glass', label: 'Soda-Lime Glass', specimenLabel: 'Annealed Pane',
    category: 'impact', failureMode: 'brittle',
    densityScale: 0.37, axialStiffness: 0.96, shearStiffness: 0.84, bendStiffness: 0.76, damping: 0.996,
    tensileYieldStrain: 0.007, tensileBreakStrain: 0.012,
    compressionYieldStrain: 0.030, compressionBreakStrain: 0.070,
    plasticCreep: 0, damageRate: 3.4, fatigueRate: 0.08, anisotropy: 1,
    baseColor: [0.30, 0.72, 0.83, -4],
    lab: lab(50, 0, 6.00, 27.2, 4.0, 12.0, 1.36, 1.00),
  },
  {
    id: 'acrylic', label: 'Acrylic', specimenLabel: 'Acrylic Pane',
    category: 'impact', failureMode: 'brittle',
    densityScale: 0.22, axialStiffness: 0.73, shearStiffness: 0.61, bendStiffness: 0.45, damping: 0.986,
    tensileYieldStrain: 0.035, tensileBreakStrain: 0.075,
    compressionYieldStrain: 0.050, compressionBreakStrain: 0.11,
    plasticCreep: 0.035, damageRate: 1.65, fatigueRate: 0.25, anisotropy: 1,
    baseColor: [0.32, 0.48, 0.92, -4],
    lab: lab(70, 0.10, 8.00, 50.7, 6.0, 16.0, 2.54, 1.00),
  },
  {
    id: 'elastomer', label: 'Elastomer', specimenLabel: 'Elastomer Block',
    category: 'soft-body', failureMode: 'hyperelastic',
    densityScale: 0.16, axialStiffness: 0.34, shearStiffness: 0.27, bendStiffness: 0.12, damping: 0.955,
    tensileYieldStrain: 0.24, tensileBreakStrain: 0.72,
    compressionYieldStrain: 0.30, compressionBreakStrain: 0.82,
    plasticCreep: 0.015, damageRate: 0.32, fatigueRate: 0.10, anisotropy: 1,
    baseColor: [0.10, 0.16, 0.21, 1],
    lab: lab(12, 0.05, 12.00, 13.0, 14.0, 20.0, 0.65, 1.00),
  },
  {
    id: 'carbon-fiber', label: 'Carbon-Fiber Laminate', specimenLabel: 'Composite Coupon',
    category: 'structural', failureMode: 'fiber',
    densityScale: 0.27, axialStiffness: 0.995, shearStiffness: 0.60, bendStiffness: 0.82, damping: 0.994,
    tensileYieldStrain: 0.010, tensileBreakStrain: 0.019,
    compressionYieldStrain: 0.016, compressionBreakStrain: 0.033,
    plasticCreep: 0, damageRate: 2.4, fatigueRate: 0.18, anisotropy: 0.34,
    baseColor: [0.08, 0.09, 0.11, -7],
    lab: lab(600, 0, 2.00, 108.7, 4.0, 12.0, 5.44, 1.00),
  },
] as const;

export const MATERIAL_LAB_EXTRA_PRESETS: readonly MaterialBehaviorPreset[] = [
  {
    id: 'laminated-glass', label: 'Laminated Glass', specimenLabel: 'Laminated Glass',
    category: 'impact', failureMode: 'progressive',
    densityScale: 0.36, axialStiffness: 0.90, shearStiffness: 0.78, bendStiffness: 0.70, damping: 0.990,
    tensileYieldStrain: 0.008, tensileBreakStrain: 0.038,
    compressionYieldStrain: 0.028, compressionBreakStrain: 0.080,
    plasticCreep: 0.02, damageRate: 1.85, fatigueRate: 0.10, anisotropy: 1,
    baseColor: [0.34, 0.70, 0.78, -4],
    lab: lab(50, 0.02, 6.00, 27.2, 4.0, 12.0, 1.36, 1.00),
  },
  {
    id: 'ballistic-fabric', label: 'Ballistic Fabric', specimenLabel: 'Ballistic Fabric',
    category: 'cloth', failureMode: 'fiber',
    densityScale: 0.18, axialStiffness: 0.92, shearStiffness: 0.38, bendStiffness: 0.16, damping: 0.974,
    tensileYieldStrain: 0.028, tensileBreakStrain: 0.085,
    compressionYieldStrain: 0.012, compressionBreakStrain: 0.040,
    plasticCreep: 0.04, damageRate: 1.15, fatigueRate: 0.22, anisotropy: 0.28,
    baseColor: [0.22, 0.20, 0.16, 1],
    lab: lab(580, 0.08, 2.00, 8.0, 12.0, 20.0, 0.40, 1.00),
  },
  {
    id: 'polymer-foam', label: 'Polymer Foam', specimenLabel: 'Foam Block',
    category: 'soft-body', failureMode: 'hyperelastic',
    densityScale: 0.05, axialStiffness: 0.18, shearStiffness: 0.14, bendStiffness: 0.08, damping: 0.938,
    tensileYieldStrain: 0.18, tensileBreakStrain: 0.55,
    compressionYieldStrain: 0.22, compressionBreakStrain: 0.70,
    plasticCreep: 0.06, damageRate: 0.48, fatigueRate: 0.14, anisotropy: 1,
    baseColor: [0.82, 0.74, 0.42, 1],
    lab: lab(0.8, 0.05, 20.00, 1.5, 16.0, 20.0, 0.08, 1.00),
  },
  {
    id: 'water', label: 'Water', specimenLabel: 'Water',
    category: 'fluid', failureMode: 'fluid',
    densityScale: 0.13, axialStiffness: 0.08, shearStiffness: 0.06, bendStiffness: 0.02, damping: 0.910,
    tensileYieldStrain: 0.05, tensileBreakStrain: 0.90,
    compressionYieldStrain: 0.08, compressionBreakStrain: 0.95,
    plasticCreep: 0, damageRate: 0.20, fatigueRate: 0, anisotropy: 1,
    baseColor: [0.18, 0.42, 0.72, -4],
    lab: lab(0, 0, 10.00, 12.0, 20.0, 20.0, 0.60, 1.00),
  },
] as const;

export const MATERIAL_LAB_PRESETS: readonly MaterialBehaviorPreset[] = [
  ...MATERIAL_BEHAVIOR_PRESETS,
  ...MATERIAL_LAB_EXTRA_PRESETS,
];

/** Visible left-rail rows on material-lab-desktop.png (01–07). */
export const MATERIAL_LAB_LIBRARY_SLOTS = [
  { index: 1, title: 'Ballistic Dent', specimenLabel: 'Aluminum Panel', presetId: 'aluminum-alloy', category: 'impact' },
  { index: 2, title: 'Metal Fold', specimenLabel: 'Sheet Metal', presetId: 'structural-steel', category: 'structural' },
  { index: 3, title: 'Glass Impact', specimenLabel: 'Laminated Glass', presetId: 'laminated-glass', category: 'impact' },
  { index: 4, title: 'Concrete Shear', specimenLabel: 'Reinforced Slab', presetId: 'reinforced-concrete', category: 'structural' },
  { index: 5, title: 'Cloth Tear', specimenLabel: 'Ballistic Fabric', presetId: 'ballistic-fabric', category: 'cloth' },
  { index: 6, title: 'Fluid Dam-Break', specimenLabel: 'Water', presetId: 'water', category: 'fluid' },
  { index: 7, title: 'Soft-Body Crush', specimenLabel: 'Foam Block', presetId: 'polymer-foam', category: 'soft-body' },
] as const;

export type MaterialLabLibrarySlot = (typeof MATERIAL_LAB_LIBRARY_SLOTS)[number];

export const MATERIAL_LAB_SELECTED_PRESET_ID: MaterialLabPresetId = 'aluminum-alloy';

const MATERIAL_LAB_PRESET_BY_ID = Object.freeze(
  Object.fromEntries(MATERIAL_LAB_PRESETS.map((preset) => [preset.id, preset])),
) as Readonly<Record<MaterialLabPresetId, MaterialBehaviorPreset>>;

export function materialLabCategoryLabel(category: MaterialLabCategory): string {
  switch (category) {
    case 'structural': return MATERIAL_LAB_CATEGORY_LABELS.structural;
    case 'impact': return MATERIAL_LAB_CATEGORY_LABELS.impact;
    case 'fluid': return MATERIAL_LAB_CATEGORY_LABELS.fluid;
    case 'soft-body': return MATERIAL_LAB_CATEGORY_LABELS['soft-body'];
    case 'cloth': return MATERIAL_LAB_CATEGORY_LABELS.cloth;
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

export function materialLabFilterLabel(filter: MaterialLabFilter): string {
  switch (filter) {
    case 'all': return 'ALL';
    case 'structural':
    case 'impact':
    case 'fluid':
    case 'soft-body':
    case 'cloth':
      return materialLabCategoryLabel(filter);
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

export function isLatticeMaterialPresetId(id: MaterialLabPresetId): id is MaterialBehaviorPresetId {
  switch (id) {
    case 'structural-steel':
    case 'aluminum-alloy':
    case 'copper':
    case 'oak-timber':
    case 'cross-laminated-timber':
    case 'reinforced-concrete':
    case 'soda-lime-glass':
    case 'acrylic':
    case 'elastomer':
    case 'carbon-fiber':
      return true;
    case 'laminated-glass':
    case 'ballistic-fabric':
    case 'polymer-foam':
    case 'water':
      return false;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export function materialFailureModeLabel(mode: MaterialFailureMode): string {
  switch (mode) {
    case 'ductile': return 'ductile yield → plastic set → rupture';
    case 'brittle': return 'elastic response → rapid brittle fracture';
    case 'progressive': return 'progressive cracking and load redistribution';
    case 'fiber': return 'anisotropic fiber loading → progressive split';
    case 'hyperelastic': return 'large reversible flexure → damage';
    case 'fluid': return 'free-surface flow → inertial runout';
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function isMaterialLabPresetId(id: string): id is MaterialLabPresetId {
  return (MATERIAL_LAB_PRESET_IDS as readonly string[]).includes(id);
}

export function materialPresetById(id: MaterialLabPresetId): MaterialBehaviorPreset {
  return MATERIAL_LAB_PRESET_BY_ID[id];
}

export function materialPresetsForLabFilter(filter: MaterialLabFilter): readonly MaterialBehaviorPreset[] {
  switch (filter) {
    case 'all':
      return MATERIAL_LAB_PRESETS;
    case 'structural':
    case 'impact':
    case 'fluid':
    case 'soft-body':
    case 'cloth':
      return MATERIAL_LAB_PRESETS.filter((preset) => preset.category === filter);
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

export function materialPresetForVariant(variant: number): MaterialBehaviorPreset {
  const index = ((Math.trunc(variant) % MATERIAL_BEHAVIOR_PRESETS.length) + MATERIAL_BEHAVIOR_PRESETS.length) % MATERIAL_BEHAVIOR_PRESETS.length;
  return MATERIAL_BEHAVIOR_PRESETS[index];
}
