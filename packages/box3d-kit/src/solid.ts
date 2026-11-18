/**
 * Deformable solids from tetrahedral finite elements (float64, JavaScript):
 * linear, corotational and compressible Neo-Hookean materials given by
 * Young's modulus, Poisson's ratio and density; statics, implicit and
 * explicit dynamics; stresses, reactions and strength checks. See
 * docs/SOLID_MECHANICS.md in the repository for the formulation, the
 * validation against closed-form answers and the limits.
 */
export * from './core/solid.js';
