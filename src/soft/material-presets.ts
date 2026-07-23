export type MaterialFailureMode = 'ductile' | 'brittle' | 'progressive' | 'fiber' | 'hyperelastic';

/**
 * Normalized comparative material profile used by the beam-lattice lab.
 *
 * These coefficients are deliberately dimensionless and tuned for visible,
 * deterministic comparisons. They are not Young's modulus, yield stress, or
 * certified design allowables. A real engineering workflow must calibrate the
 * lattice, specimen geometry, boundary conditions, and units against test data.
 */
export type MaterialBehaviorPreset = {
  id: string;
  label: string;
  failureMode: MaterialFailureMode;
  densityScale: number;
  axialStiffness: number;
  shearStiffness: number;
  bendStiffness: number;
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
};

export const MATERIAL_BEHAVIOR_PRESETS: readonly MaterialBehaviorPreset[] = [
  {
    id: 'structural-steel', label: 'Structural Steel', failureMode: 'ductile',
    densityScale: 1, axialStiffness: 0.985, shearStiffness: 0.91, bendStiffness: 0.78, damping: 0.992,
    tensileYieldStrain: 0.018, tensileBreakStrain: 0.135,
    compressionYieldStrain: 0.020, compressionBreakStrain: 0.15,
    plasticCreep: 0.18, damageRate: 0.72, fatigueRate: 0.12, anisotropy: 1,
    baseColor: [0.40, 0.53, 0.64, -2],
  },
  {
    id: 'aluminum-alloy', label: 'Aluminum Alloy', failureMode: 'ductile',
    densityScale: 0.46, axialStiffness: 0.91, shearStiffness: 0.82, bendStiffness: 0.65, damping: 0.989,
    tensileYieldStrain: 0.024, tensileBreakStrain: 0.115,
    compressionYieldStrain: 0.027, compressionBreakStrain: 0.13,
    plasticCreep: 0.24, damageRate: 0.84, fatigueRate: 0.16, anisotropy: 1,
    baseColor: [0.63, 0.71, 0.78, -2],
  },
  {
    id: 'copper', label: 'Copper', failureMode: 'ductile',
    densityScale: 1.08, axialStiffness: 0.90, shearStiffness: 0.80, bendStiffness: 0.60, damping: 0.987,
    tensileYieldStrain: 0.030, tensileBreakStrain: 0.19,
    compressionYieldStrain: 0.033, compressionBreakStrain: 0.21,
    plasticCreep: 0.34, damageRate: 0.60, fatigueRate: 0.13, anisotropy: 1,
    baseColor: [0.78, 0.31, 0.12, -2],
  },
  {
    id: 'oak-timber', label: 'Oak Timber', failureMode: 'fiber',
    densityScale: 0.19, axialStiffness: 0.88, shearStiffness: 0.54, bendStiffness: 0.61, damping: 0.982,
    tensileYieldStrain: 0.022, tensileBreakStrain: 0.070,
    compressionYieldStrain: 0.038, compressionBreakStrain: 0.12,
    plasticCreep: 0.10, damageRate: 0.92, fatigueRate: 0.20, anisotropy: 0.46,
    baseColor: [0.48, 0.25, 0.09, 1],
  },
  {
    id: 'cross-laminated-timber', label: 'Cross-Laminated Timber', failureMode: 'progressive',
    densityScale: 0.17, axialStiffness: 0.83, shearStiffness: 0.69, bendStiffness: 0.68, damping: 0.984,
    tensileYieldStrain: 0.025, tensileBreakStrain: 0.085,
    compressionYieldStrain: 0.043, compressionBreakStrain: 0.14,
    plasticCreep: 0.08, damageRate: 0.78, fatigueRate: 0.18, anisotropy: 0.68,
    baseColor: [0.68, 0.42, 0.17, 1],
  },
  {
    id: 'reinforced-concrete', label: 'Reinforced Concrete', failureMode: 'progressive',
    densityScale: 0.42, axialStiffness: 0.94, shearStiffness: 0.72, bendStiffness: 0.66, damping: 0.978,
    tensileYieldStrain: 0.009, tensileBreakStrain: 0.022,
    compressionYieldStrain: 0.035, compressionBreakStrain: 0.095,
    plasticCreep: 0.025, damageRate: 1.45, fatigueRate: 0.24, anisotropy: 0.82,
    baseColor: [0.43, 0.43, 0.41, -1],
  },
  {
    id: 'soda-lime-glass', label: 'Soda-Lime Glass', failureMode: 'brittle',
    densityScale: 0.37, axialStiffness: 0.96, shearStiffness: 0.84, bendStiffness: 0.76, damping: 0.996,
    tensileYieldStrain: 0.007, tensileBreakStrain: 0.012,
    compressionYieldStrain: 0.030, compressionBreakStrain: 0.070,
    plasticCreep: 0, damageRate: 3.4, fatigueRate: 0.08, anisotropy: 1,
    baseColor: [0.30, 0.72, 0.83, -4],
  },
  {
    id: 'acrylic', label: 'Acrylic', failureMode: 'brittle',
    densityScale: 0.22, axialStiffness: 0.73, shearStiffness: 0.61, bendStiffness: 0.45, damping: 0.986,
    tensileYieldStrain: 0.035, tensileBreakStrain: 0.075,
    compressionYieldStrain: 0.050, compressionBreakStrain: 0.11,
    plasticCreep: 0.035, damageRate: 1.65, fatigueRate: 0.25, anisotropy: 1,
    baseColor: [0.32, 0.48, 0.92, -4],
  },
  {
    id: 'elastomer', label: 'Elastomer', failureMode: 'hyperelastic',
    densityScale: 0.16, axialStiffness: 0.34, shearStiffness: 0.27, bendStiffness: 0.12, damping: 0.955,
    tensileYieldStrain: 0.24, tensileBreakStrain: 0.72,
    compressionYieldStrain: 0.30, compressionBreakStrain: 0.82,
    plasticCreep: 0.015, damageRate: 0.32, fatigueRate: 0.10, anisotropy: 1,
    baseColor: [0.10, 0.16, 0.21, 1],
  },
  {
    id: 'carbon-fiber', label: 'Carbon-Fiber Laminate', failureMode: 'fiber',
    densityScale: 0.27, axialStiffness: 0.995, shearStiffness: 0.60, bendStiffness: 0.82, damping: 0.994,
    tensileYieldStrain: 0.010, tensileBreakStrain: 0.019,
    compressionYieldStrain: 0.016, compressionBreakStrain: 0.033,
    plasticCreep: 0, damageRate: 2.4, fatigueRate: 0.18, anisotropy: 0.34,
    baseColor: [0.08, 0.09, 0.11, -2],
  },
] as const;

export function materialPresetForVariant(variant: number): MaterialBehaviorPreset {
  const index = ((Math.trunc(variant) % MATERIAL_BEHAVIOR_PRESETS.length) + MATERIAL_BEHAVIOR_PRESETS.length) % MATERIAL_BEHAVIOR_PRESETS.length;
  return MATERIAL_BEHAVIOR_PRESETS[index];
}
