/**
 * Linear shallow-water height fields on the CPU (float32): an open-boundary
 * reference solver and a closed-basin C-grid solver with conserved volume.
 * Use them for ponds, pools and wave props. See docs/CLOSED_WATER.md in the
 * repository. The WebGPU solver is not packaged yet.
 */
export * from './core/linear-water.js';
export * from './core/closed-water.js';
