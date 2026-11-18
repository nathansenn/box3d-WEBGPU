/**
 * Two-way coupling of rigid bodies with one closed shallow-water basin
 * (float64, JavaScript): Archimedes buoyancy at the centre of buoyancy, a
 * drag model, and the bodies' displaced volume and force reaction fed back
 * into the water. See docs/WATER_COUPLING.md in the repository for the
 * model, what it conserves and its validation.
 */
export * from './core/water-coupling.js';
