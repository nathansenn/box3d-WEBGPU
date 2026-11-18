/**
 * Calibrated cloth (float64, JavaScript): a triangle-mesh membrane and plate
 * given by areal density, Young's modulus, thickness and Poisson's ratio,
 * integrated implicitly by Newton's method, with contact and friction against
 * boxes, spheres, capsules and planes, self-collision, and two-way coupling
 * to the rigid world (`ClothCoupling`) in which a light body on a stiff cloth
 * stays stable. See docs/CLOTH.md in the repository for the equations, the
 * validation against closed-form answers and the limits.
 */
export * from './core/cloth.js';
