/**
 * Contact between deformable solids and rigid bodies (float64, JavaScript):
 * node-against-body contact of a tetrahedral `SolidBody` with boxes, spheres,
 * capsules and planes, Coulomb friction, welds of solid nodes to a body, and
 * two-way coupling to the rigid world (`SolidCoupling`) in which the bodies are
 * unknowns of the solid's implicit step, so a light body on a stiff solid and
 * a heavy body on a soft one both stay stable. See docs/SOLID_CONTACT.md in
 * the repository for the equations, the validation against closed-form
 * answers and the limits.
 */
export * from './core/solid-contact.js';
