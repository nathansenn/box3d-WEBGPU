/**
 * Heat conduction in solids (float64, SI units): transient and steady
 * temperature fields on a structured grid of cells with per-cell materials
 * and a solid mask, fixed-temperature, flux, convection and radiation
 * boundaries, implicit and explicit time stepping, an energy ledger, and
 * one-way thermal strain, stress and thermal-shock estimates.
 * See docs/HEAT_TRANSFER.md in the repository.
 */
export * from './core/heat.js';
