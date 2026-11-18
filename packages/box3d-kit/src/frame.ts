/**
 * 3D Euler–Bernoulli frame structures (beams and columns, float64): static
 * solutions, midpoint-rule dynamics, reactions and small-kinematics
 * screening. Useful for buildable structures, bridges and props that bend.
 * See docs/FRAME_MECHANICS.md in the repository.
 */
export * from './core/frame-runtime.js';
export {frameElementMatrices, frameTransverseSlope, type FrameElement, type FrameElementMatrices} from './core/frame-element.js';
