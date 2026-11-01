import {
  clamp,
  mat4LookAtInto,
  mat4MultiplyInto,
  mat4OrthographicInto,
  mat4PerspectiveInto,
  type Mat4,
  type Vec3,
} from './math';
import type { CameraRig } from './types';

const CAMERA_FOV_RADIANS = (58 * Math.PI) / 180;
const WORLD_UP: Vec3 = [0, 1, 0];
// Coarsest shadow-map size in use (1024 or 2048): snapping to its texel grid also aligns the finer one.
const SHADOW_MAP_SIZE = 1024;

export type CameraShakeInput = {
  yaw: number;
  pitch: number;
  targetOffset: Vec3;
};

export type CameraMatrixFrame = {
  viewProjection: Mat4;
  lightViewProjection: Mat4;
  eye: Vec3;
};

/**
 * Allocation-free camera/light matrix preparation with exact-input memoization.
 *
 * Separate dependency keys keep orbiting from rebuilding the light matrices,
 * resizing from rebuilding either view matrix, and an unchanged frame from
 * doing any matrix work at all.
 */
export class CameraMatrixCache {
  private readonly projection = new Float32Array(16);
  private readonly view = new Float32Array(16);
  private readonly lightProjection = new Float32Array(16);
  private readonly lightView = new Float32Array(16);
  private readonly target: Vec3 = [0, 0, 0];
  private readonly lightEye: Vec3 = [0, 0, 0];
  private readonly result: CameraMatrixFrame = {
    viewProjection: new Float32Array(16),
    lightViewProjection: new Float32Array(16),
    eye: [0, 0, 0],
  };

  private projectionAspect = Number.NaN;
  private viewYaw = Number.NaN;
  private viewPitch = Number.NaN;
  private viewDistance = Number.NaN;
  private viewTargetX = Number.NaN;
  private viewTargetY = Number.NaN;
  private viewTargetZ = Number.NaN;
  private lightDistance = Number.NaN;
  private shadowExtent = 34;
  private readonly snappedEye: Vec3 = [0, 0, 0];
  private readonly snappedTarget: Vec3 = [0, 0, 0];
  private lightTargetX = Number.NaN;
  private lightTargetY = Number.NaN;
  private lightTargetZ = Number.NaN;
  private lightDirectionX = Number.NaN;
  private lightDirectionY = Number.NaN;
  private lightDirectionZ = Number.NaN;

  resolve(rig: CameraRig, shake: CameraShakeInput, aspect: number, lightDirection: Vec3): CameraMatrixFrame {
    const yaw = rig.yaw + shake.yaw;
    const pitch = clamp(rig.pitch + shake.pitch, 0.08, 1.3);
    const distance = rig.distance;
    const targetX = rig.target[0] + shake.targetOffset[0];
    const targetY = rig.target[1] + shake.targetOffset[1];
    const targetZ = rig.target[2] + shake.targetOffset[2];

    const projectionChanged = aspect !== this.projectionAspect;
    if (projectionChanged) {
      mat4PerspectiveInto(this.projection, CAMERA_FOV_RADIANS, aspect, 0.08, 360);
      this.projectionAspect = aspect;
    }

    const viewChanged =
      yaw !== this.viewYaw ||
      pitch !== this.viewPitch ||
      distance !== this.viewDistance ||
      targetX !== this.viewTargetX ||
      targetY !== this.viewTargetY ||
      targetZ !== this.viewTargetZ;
    if (viewChanged) {
      const cp = Math.cos(pitch);
      this.target[0] = targetX;
      this.target[1] = targetY;
      this.target[2] = targetZ;
      this.result.eye[0] = targetX + Math.cos(yaw) * cp * distance;
      this.result.eye[1] = targetY + Math.sin(pitch) * distance;
      this.result.eye[2] = targetZ + Math.sin(yaw) * cp * distance;
      mat4LookAtInto(this.view, this.result.eye, this.target, WORLD_UP);
      this.viewYaw = yaw;
      this.viewPitch = pitch;
      this.viewDistance = distance;
      this.viewTargetX = targetX;
      this.viewTargetY = targetY;
      this.viewTargetZ = targetZ;
    }
    if (projectionChanged || viewChanged) {
      mat4MultiplyInto(this.result.viewProjection, this.projection, this.view);
    }

    const lightProjectionChanged = distance !== this.lightDistance;
    if (lightProjectionChanged) {
      const shadowExtent = clamp(distance * 1.35, 34, 86);
      this.shadowExtent = shadowExtent;
      mat4OrthographicInto(
        this.lightProjection,
        -shadowExtent,
        shadowExtent,
        -shadowExtent,
        shadowExtent,
        0.1,
        190,
      );
      this.lightDistance = distance;
    }

    const lightViewChanged =
      lightProjectionChanged ||
      targetX !== this.lightTargetX ||
      targetY !== this.lightTargetY ||
      targetZ !== this.lightTargetZ ||
      lightDirection[0] !== this.lightDirectionX ||
      lightDirection[1] !== this.lightDirectionY ||
      lightDirection[2] !== this.lightDirectionZ;
    if (lightViewChanged) {
      this.target[0] = targetX;
      this.target[1] = targetY;
      this.target[2] = targetZ;
      this.lightEye[0] = targetX - lightDirection[0] * 92;
      this.lightEye[1] = targetY - lightDirection[1] * 92;
      this.lightEye[2] = targetZ - lightDirection[2] * 92;
      mat4LookAtInto(this.lightView, this.lightEye, this.target, WORLD_UP);
      // Snap the light-space origin to whole shadow-map texels so panning the
      // camera does not make shadow edges shimmer.
      const v = this.lightView;
      const texel = (2 * this.shadowExtent) / SHADOW_MAP_SIZE;
      const lx = targetX * v[0]! + targetY * v[4]! + targetZ * v[8]!;
      const ly = targetX * v[1]! + targetY * v[5]! + targetZ * v[9]!;
      const dx = Math.round(lx / texel) * texel - lx;
      const dy = Math.round(ly / texel) * texel - ly;
      if (dx !== 0 || dy !== 0) {
        for (let i = 0; i < 3; i++) {
          const shift = dx * v[i * 4]! + dy * v[i * 4 + 1]!;
          this.snappedTarget[i] = this.target[i]! + shift;
          this.snappedEye[i] = this.lightEye[i]! + shift;
        }
        mat4LookAtInto(this.lightView, this.snappedEye, this.snappedTarget, WORLD_UP);
      }
      this.lightTargetX = targetX;
      this.lightTargetY = targetY;
      this.lightTargetZ = targetZ;
      this.lightDirectionX = lightDirection[0];
      this.lightDirectionY = lightDirection[1];
      this.lightDirectionZ = lightDirection[2];
    }
    if (lightProjectionChanged || lightViewChanged) {
      mat4MultiplyInto(this.result.lightViewProjection, this.lightProjection, this.lightView);
    }

    return this.result;
  }
}
