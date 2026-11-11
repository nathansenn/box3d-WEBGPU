/**
 * Two-way coupling of rigid bodies with cables and frames (float64,
 * JavaScript): a cable end or a frame node attached to a point on a body, a
 * tether between two bodies, a cable holding a frame. Each attachment is
 * solved with the effective mass of both sides, so light bodies on stiff
 * structures stay stable. Use it with `box3d-webgpu-kit/cable` and
 * `box3d-webgpu-kit/frame`. See docs/STRUCTURE_COUPLING.md in the repository
 * for the scheme, its measured limits and its validation.
 */
export * from './core/structure-coupling.js';
