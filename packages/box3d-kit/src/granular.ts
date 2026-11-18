/**
 * Granular media by the discrete element method (float64, JavaScript):
 * spherical grains of any radii with Hertz or linear normal contact, a
 * damping solved for the restitution asked for, tangential springs capped by
 * Coulomb friction and rolling resistance; planes, boxes, spheres, capsules
 * and shells of revolution (silo, hopper, orifice) as static, moving or
 * dynamic walls; and two-way coupling to the rigid world
 * (`GranularCoupling`). See docs/GRANULAR.md in the repository for the
 * equations, the validation against closed-form answers and the limits.
 */
export * from './core/granular.js';
