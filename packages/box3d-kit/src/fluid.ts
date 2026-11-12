/**
 * Volumetric incompressible flow (float64, JavaScript): the Navier-Stokes
 * equations on a staggered grid with a pressure projection (conjugate
 * gradients with an incomplete-Cholesky preconditioner), second-order
 * central or first-order upwind advection, explicit or implicit viscosity;
 * no-slip, free-slip, inflow, outflow and periodic sides; fixed and moving
 * obstacles; and two-way coupling to the rigid world (`FluidCoupling`). See
 * docs/FLUID.md in the repository for the equations, the validation against
 * closed forms and published data, and the limits.
 */
export * from './core/fluid.js';
