"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LcgRng = exports.EPSILON = void 0;
exports.clamp = clamp;
exports.saturate = saturate;
exports.lerp = lerp;
exports.smoothstep = smoothstep;
exports.easeInOutCubic = easeInOutCubic;
exports.lerpAngle = lerpAngle;
exports.vec3 = vec3;
exports.vec3Add = vec3Add;
exports.vec3Sub = vec3Sub;
exports.vec3Scale = vec3Scale;
exports.vec3Lerp = vec3Lerp;
exports.vec3Dot = vec3Dot;
exports.vec3Cross = vec3Cross;
exports.vec3Length = vec3Length;
exports.vec3Normalize = vec3Normalize;
exports.mat4Identity = mat4Identity;
exports.mat4Perspective = mat4Perspective;
exports.mat4Orthographic = mat4Orthographic;
exports.mat4LookAt = mat4LookAt;
exports.mat4Multiply = mat4Multiply;
exports.writeModelMatrixFromEuler = writeModelMatrixFromEuler;
exports.matrixColumnLength = matrixColumnLength;
exports.isFiniteArray = isFiniteArray;
exports.EPSILON = 1e-6;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function saturate(value) {
    return clamp(value, 0, 1);
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
function smoothstep(edge0, edge1, value) {
    if (Math.abs(edge1 - edge0) < exports.EPSILON)
        return value < edge0 ? 0 : 1;
    const t = saturate((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}
function easeInOutCubic(t) {
    const x = saturate(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
function lerpAngle(a, b, t) {
    const tau = Math.PI * 2;
    let delta = (b - a) % tau;
    if (delta > Math.PI)
        delta -= tau;
    if (delta < -Math.PI)
        delta += tau;
    return a + delta * t;
}
function vec3(x = 0, y = 0, z = 0) {
    return [x, y, z];
}
function vec3Add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function vec3Sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vec3Scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}
function vec3Lerp(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function vec3Dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vec3Cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
function vec3Length(a) {
    return Math.hypot(a[0], a[1], a[2]);
}
function vec3Normalize(a) {
    const len = vec3Length(a);
    if (len < exports.EPSILON)
        return [0, 0, 0];
    return [a[0] / len, a[1] / len, a[2] / len];
}
function mat4Identity() {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
}
/** Right-handed perspective matrix with WebGPU/D3D zero-to-one clip depth. */
function mat4Perspective(fovyRadians, aspect, near, far) {
    const f = 1.0 / Math.tan(fovyRadians * 0.5);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / Math.max(aspect, exports.EPSILON);
    out[5] = f;
    out[10] = far * nf;
    out[11] = -1;
    out[14] = far * near * nf;
    return out;
}
/** Right-handed orthographic matrix with WebGPU/D3D zero-to-one clip depth. */
function mat4Orthographic(left, right, bottom, top, near, far) {
    const lr = 1 / Math.max(exports.EPSILON, right - left);
    const bt = 1 / Math.max(exports.EPSILON, top - bottom);
    const nf = 1 / Math.max(exports.EPSILON, near - far);
    const out = new Float32Array(16);
    out[0] = 2 * lr;
    out[5] = 2 * bt;
    out[10] = nf;
    out[12] = -(right + left) * lr;
    out[13] = -(top + bottom) * bt;
    out[14] = near * nf;
    out[15] = 1;
    return out;
}
function mat4LookAt(eye, target, up) {
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
function mat4Multiply(a, b) {
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
function writeModelMatrixFromEuler(out, offset, position, rotation, halfExtents) {
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
function matrixColumnLength(m, offset, col) {
    const i = offset + col * 4;
    return Math.hypot(m[i + 0], m[i + 1], m[i + 2]);
}
function isFiniteArray(values) {
    for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i]))
            return false;
    }
    return true;
}
class LcgRng {
    state;
    constructor(seed = 0xc0ffee) {
        this.state = seed >>> 0;
    }
    nextUint() {
        this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
        return this.state;
    }
    next01() {
        return ((this.nextUint() >>> 8) & 0x00ffffff) / 0x01000000;
    }
    range(min, max) {
        return min + (max - min) * this.next01();
    }
    signed(scale = 1) {
        return (this.next01() * 2 - 1) * scale;
    }
}
exports.LcgRng = LcgRng;
