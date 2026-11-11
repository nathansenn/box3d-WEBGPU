/**
 * Fracture of deformable solids (float64, JavaScript): a tetrahedral
 * small-strain solid that cracks along element faces by a cohesive-zone
 * law (strength sigma_c, fracture energy G_c, linear softening, mixed
 * mode, irreversible damage, contact penalty), with nodes duplicated
 * where a face opens; a crack-band (Rankine) element model for
 * comparison; fragments with mass, momentum and inertia; a one-way
 * hand-off of a fragment to a rigid world as a hull body; a `Subsystem`
 * adapter with crack events; and a thermal-shock example driven by the
 * heat solver. See docs/SOLID_FRACTURE.md in the repository for the laws,
 * the validation against closed-form fracture mechanics and the limits
 * (cracks follow element faces, so crack paths depend on the mesh).
 */
export * from './core/solid-fracture.js';
