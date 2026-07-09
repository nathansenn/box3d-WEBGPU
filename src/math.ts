export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Mat4 = Float32Array;

export const EPSILON = 1e-6;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vec3Normalize(a: Vec3): Vec3 {
  const len = vec3Length(a);
  if (len < EPSILON) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function mat4Identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Perspective(fovyRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fovyRadians * 0.5);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = vec3Normalize(vec3Sub(eye, target));
  const x = vec3Normalize(vec3Cross(up, z));
  const y = vec3Cross(z, x);

  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -vec3Dot(x, eye);
  out[13] = -vec3Dot(y, eye);
  out[14] = -vec3Dot(z, eye);
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function writeModelMatrixFromEuler(
  out: Float32Array,
  offset: number,
  position: Vec3,
  rotation: Vec3,
  halfExtents: Vec3,
): void {
  const [rx, ry, rz] = rotation;
  const sx = Math.sin(rx);
  const cx = Math.cos(rx);
  const sy = Math.sin(ry);
  const cy = Math.cos(ry);
  const sz = Math.sin(rz);
  const cz = Math.cos(rz);

  // R = Rz * Ry * Rx, column-major.
  const r00 = cz * cy;
  const r01 = cz * sy * sx - sz * cx;
  const r02 = cz * sy * cx + sz * sx;

  const r10 = sz * cy;
  const r11 = sz * sy * sx + cz * cx;
  const r12 = sz * sy * cx - cz * sx;

  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  out[offset + 0] = r00 * halfExtents[0];
  out[offset + 1] = r10 * halfExtents[0];
  out[offset + 2] = r20 * halfExtents[0];
  out[offset + 3] = 0;

  out[offset + 4] = r01 * halfExtents[1];
  out[offset + 5] = r11 * halfExtents[1];
  out[offset + 6] = r21 * halfExtents[1];
  out[offset + 7] = 0;

  out[offset + 8] = r02 * halfExtents[2];
  out[offset + 9] = r12 * halfExtents[2];
  out[offset + 10] = r22 * halfExtents[2];
  out[offset + 11] = 0;

  out[offset + 12] = position[0];
  out[offset + 13] = position[1];
  out[offset + 14] = position[2];
  out[offset + 15] = 1;
}

export function matrixColumnLength(m: Float32Array, offset: number, col: number): number {
  const i = offset + col * 4;
  return Math.hypot(m[i + 0], m[i + 1], m[i + 2]);
}

export function isFiniteArray(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

export class LcgRng {
  private state: number;

  constructor(seed = 0xc0ffee) {
    this.state = seed >>> 0;
  }

  nextUint(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state;
  }

  next01(): number {
    return ((this.nextUint() >>> 8) & 0x00ffffff) / 0x01000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next01();
  }

  signed(scale = 1): number {
    return (this.next01() * 2 - 1) * scale;
  }
}
