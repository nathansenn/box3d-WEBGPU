/**
 * Flow around and through geometry (float64, JavaScript, deterministic): a
 * virtual wind or water tunnel around a body, or the flow through a cavity
 * with named inlets and outlets, from oriented primitives and triangle meshes
 * in SI units. A lattice-Boltzmann solver (D3Q19, regularised collision,
 * Smagorinsky sub-grid model, interpolated bounce-back walls); above a cell
 * Reynolds number of about 10 an under-resolved large-eddy simulation: an
 * engineering estimate, not certified CFD. `runFlowStudy` takes a
 * `box3d-flow-study/1` document and returns a `box3d-flow-result/1` document
 * with forces and coefficients, flow rates and pressure drops, streamlines,
 * slices and surface pressure. See docs/FLOW.md in the repository for both
 * formats, the validation against published data, and the limits.
 */
export * from './core/flow-lattice.js';
export * from './core/flow-geometry.js';
export * from './core/flow.js';
export * from './core/flow-post.js';
export * from './core/flow-study.js';
