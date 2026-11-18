/**
 * Shallow water on terrain (float64, JavaScript): the 2D Saint-Venant
 * equations by a well-balanced finite-volume scheme (hydrostatic
 * reconstruction, MUSCL, HLL), wetting and drying, Manning friction, rain,
 * Green-Ampt infiltration, inflow, outflow and stage boundaries, and two-way
 * coupling to the rigid world (`ShallowWaterCoupling`). See
 * docs/SHALLOW_WATER.md in the repository for the equations, the validation
 * against closed forms and benchmarks, and the limits.
 */
export * from './core/shallow-water.js';
