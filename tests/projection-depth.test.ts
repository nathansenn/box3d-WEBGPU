import { mat4Orthographic, vec3Normalize, type Mat4 } from '../src/math';
import { CameraMatrixCache } from '../src/camera';

function near(actual: number, expected: number, label: string, tolerance = 2e-6): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function project(matrix: Mat4, x: number, y: number, z: number): number[] {
  const clip = [0, 1, 2, 3].map((row) =>
    matrix[row]! * x + matrix[4 + row]! * y + matrix[8 + row]! * z + matrix[12 + row]!,
  );
  return clip.slice(0, 3).map((value) => value / clip[3]!);
}

// These expectations come from the WebGPU clip-volume endpoints, independently
// of either matrix constructor. Comparing allocating/Into variants alone would
// reproduce the same sign error in both paths.
let fixtures = 0;
for (const [left, right, bottom, top, nearPlane, farPlane] of [
  [-50, 50, -30, 30, 0.1, 190],
  [-2, 7, -4, 3, 0.08, 360],
  [-1, 1, -1, 1, 0, 1],
  [3, 5, -8, -2, -10, 25],
  [-1000, 1000, -500, 500, 1, 10000],
] as const) {
  const matrix = mat4Orthographic(left, right, bottom, top, nearPlane, farPlane);
  for (const fraction of [0, 0.125, 0.5, 0.875, 1]) {
    const depth = nearPlane + fraction * (farPlane - nearPlane);
    const clip = project(matrix, left + fraction * (right - left), bottom + fraction * (top - bottom), -depth);
    near(clip[0]!, fraction * 2 - 1, 'orthographic horizontal endpoint');
    near(clip[1]!, fraction * 2 - 1, 'orthographic vertical endpoint');
    near(clip[2]!, fraction, 'orthographic zero-to-one depth');
    fixtures++;
  }
}

const cache = new CameraMatrixCache();
const lightDirection = vec3Normalize([0.42, -0.84, 0.34]);
for (const target of [[0, 0, 0], [2.5, 1.25, -3.75], [-80, 22, 40]] as [number, number, number][]) {
  const frame = cache.resolve(
    { yaw: 0.6, pitch: 0.4, distance: 40, target },
    { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] },
    16 / 9,
    lightDirection,
  );
  const clip = project(frame.lightViewProjection, ...target);
  // CameraMatrixCache snaps the light origin to whole texels of the coarsest
  // (1024) shadow map to stop shadow shimmer, so the target sits within half a
  // texel (1/1024 in clip units) of the centre rather than exactly on it.
  const halfShadowTexelClip = 1 / 1024;
  near(clip[0]!, 0, 'light keeps target within half a shadow texel horizontally', halfShadowTexelClip + 2e-6);
  near(clip[1]!, 0, 'light keeps target within half a shadow texel vertically', halfShadowTexelClip + 2e-6);
  near(clip[2]!, (92 - 0.1) / (190 - 0.1), 'production light target has valid depth');
  fixtures++;
}

console.log(`Projection depth: ${fixtures} independent clip-volume fixtures passed.`);
