import { mat4Perspective, mat4LookAt, mat4Multiply } from '/compiled/candidate/src/math.mjs';
export function orthographic(left, right, bottom, top, near, far) {
    const result = new Float32Array(16);
    result[0] = 2 / (right - left);
    result[5] = 2 / (top - bottom);
    result[10] = 1 / (near - far);
    result[12] = -(right + left) / (right - left);
    result[13] = -(top + bottom) / (top - bottom);
    result[14] = near / (near - far);
    result[15] = 1;
    return result;
}
export function box(x, y, z, sx, sy, sz, ry = 0, rz = 0, shear = 0) {
    const cy = Math.cos(ry), ay = Math.sin(ry), cz = Math.cos(rz), az = Math.sin(rz);
    return new Float32Array([sx * cz * cy, sx * az * cy, -sx * ay, 0, sy * (-az + shear * cz * cy), sy * (cz + shear * az * cy), -sy * shear * ay, 0, sz * cz * ay, sz * az * ay, sz * cy, 0, x, y, z, 1]);
}
export function uniforms({ sampleCount = 1, shadowTapCount = 1, shadowStrength = .82, angle = 0 } = {}) {
    const eye = [29 * Math.cos(angle), 23, 29 * Math.sin(angle) + 30], target = [0, 2, 0], lightEye = [22, 38, 17];
    return { viewProjection: mat4Multiply(mat4Perspective(Math.PI / 3.1, 4 / 3, .1, 250), mat4LookAt(eye, target, [0, 1, 0])), lightViewProjection: mat4Multiply(orthographic(-27, 27, -27, 27, .1, 130), mat4LookAt(lightEye, [0, 0, 0], [0, 1, 0])), cameraPosition: eye, timeSeconds: 1.25, lightDirection: [-.467, -.807, -.361], fogColor: [.05, .08, .12], studioMode: false, quality: { id: 'balanced', label: 'Fixed renderer comparison', exposure: 1, bloomStrength: .08, fogDensity: 0, shadowStrength, effectBudget: 1, resolutionScale: 1, sampleCount, shadowMapSize: 1024, shadowTapCount } };
}
export function topology(cols, rows) { const out = new Uint16Array((cols - 1) * (rows - 1) * 6); let n = 0; for (let z = 0; z < rows - 1; z++)
    for (let x = 0; x < cols - 1; x++) {
        const a = z * cols + x;
        out.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], n);
        n += 6;
    } return out; }
function water() { const cols = 24, rows = 20, n = cols * rows, eta = new Float32Array(n), u = new Float32Array(n), v = new Float32Array(n); for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
        const i = z * cols + x;
        eta[i] = .12 * Math.cos(x * .4) * Math.sin(z * .35);
        u[i] = .02 * Math.sin(x);
        v[i] = .01 * Math.cos(z);
    } const indices = topology(cols, rows); return { path: 'gpu-water', material: 'water', cols, rows, width: 32, depth: 26, baseY: .05, eta, u, v, indices, indexCount: indices.length, vertexCount: n, topologyVersion: 1, frameVersion: 1 }; }
function cloth() { const cols = 18, rows = 14, n = cols * rows, positions = new Float32Array(n * 3), restPositions = new Float32Array(n * 3); for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
        const i = (z * cols + x) * 3, px = (x / (cols - 1) - .5) * 17, pz = (z / (rows - 1) - .5) * 13;
        positions.set([px, 3 + .8 * Math.cos(x * .32) * Math.sin(z * .3), pz], i);
        restPositions.set([px, 3, pz], i);
    } const indices = topology(cols, rows); return { path: 'gpu-cloth', material: 'cloth', cols, rows, positions, restPositions, indices, indexCount: indices.length, vertexCount: n, topologyVersion: 1, frameVersion: 1, baseColorA: [.5, .12, .08, 1], baseColorB: [.1, .2, .45, 1] }; }
function sheet() { const cols = 10, rows = 8, n = cols * rows, vertices = new Uint8Array(n * 24), view = new DataView(vertices.buffer); for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
        const i = (z * cols + x) * 24;
        view.setFloat32(i, (x / (cols - 1) - .5) * 16, true);
        view.setFloat32(i + 4, 2 + .2 * Math.cos(x * .5), true);
        view.setFloat32(i + 8, (z / (rows - 1) - .5) * 12, true);
        view.setInt16(i + 12, 0, true);
        view.setInt16(i + 14, 32767, true);
        vertices.set([150, 170, 190, 255], i + 16);
        view.setUint16(i + 20, Math.round(x / (cols - 1) * 65535), true);
        view.setUint16(i + 22, Math.round(z / (rows - 1) * 65535), true);
    } const indices = topology(cols, rows); return { path: 'packed', material: 'sheet', vertices, indices, vertexStride: 24, vertexCount: n, indexCount: indices.length, topologyVersion: 1, frameVersion: 1 }; }
function rope() { const nodeCount = 65, segmentCount = 64, positions = new Float32Array(nodeCount * 3), segments = new Float32Array(segmentCount * 8); for (let i = 0; i < nodeCount; i++)
    positions.set([-14 + i * 28 / 64, 7 - 3 * Math.sin(i / 64 * Math.PI), Math.sin(i * .14) * 3], i * 3); for (let i = 0; i < segmentCount; i++)
    segments.set([i, i + 1, 2, .18, .65, .34, .12, i % 7 === 0 ? -4 : -2], i * 8); return { presentation: 'material', positions, segments, nodeCount, segmentCount, topologyVersion: 1, frameVersion: 1 }; }
export const SCENARIOS = [
    { id: 'all-visible-opaque', count: 512, benchmark: true },
    { id: 'mostly-offscreen', count: 4096, benchmark: true },
    { id: 'mixed-materials', count: 640, benchmark: true },
    { id: 'paused-orbit', count: 384, benchmark: true, animation: 'orbit' },
    { id: 'moving-rigids', count: 384, benchmark: true, animation: 'rigid' },
    { id: 'quality-4x-nine-taps', count: 192, benchmark: true, highQuality: true },
    { id: 'clip-boundaries', count: 33 },
    { id: 'offcamera-shadow', count: 3 },
    { id: 'gpu-rope', count: 65, rope: true },
    { id: 'gpu-cloth', count: 9, surface: 'cloth' },
    { id: 'packed-sheet', count: 9, surface: 'sheet' },
    { id: 'cpu-water', count: 9, surface: 'water' },
    { id: 'resident-water', count: 9, surface: 'water', resident: true },
    { id: 'zero-instances', count: 0 },
    { id: 'single-instance', count: 1 },
    { id: 'partial-group-63', count: 63 },
    { id: 'full-group-64', count: 64 },
    { id: 'partial-group-65', count: 65 },
    { id: 'prefix-4097', count: 4097 },
    { id: 'prefix-8193', count: 8193 },
    { id: 'large-cancellation', count: 33 },
];
export function fixture(def) {
    const count = def.count, heap = new Float32Array(count * 20), matrices = heap.subarray(0, count * 16), colors = heap.subarray(count * 16), u = uniforms(def.highQuality ? { sampleCount: 4, shadowTapCount: 9 } : {});
    let version = 0, colorVersion = 0;
    const source = { HEAPF32: heap, frameVersion: () => version, colorVersion: () => colorVersion, _b3w_matrices_ptr: () => 0, _b3w_colors_ptr: () => count * 16 * 4, _b3w_body_count: () => count, _b3w_max_bodies: () => count };
    if (count) {
        matrices.set(box(0, -.6, 0, 18, .6, 17));
        colors.set([.32, .36, .39, -5]);
    }
    for (let i = 1; i < count; i++) {
        const j = i - 1, layer = Math.floor(j / 144), x = (j % 12 - 5.5) * 1.45, z = (Math.floor(j / 12) % 12 - 5.5) * 1.45, y = .7 + layer * 1.5;
        const outside = (def.id === 'mostly-offscreen' || def.id.startsWith('prefix-')) && i > 32;
        matrices.set(box(outside ? 600 + (i % 80) * 3 : x, y, outside ? 500 + Math.floor(i / 80) * 3 : z, .52, .65, .52, i * .13, i % 9 === 0 ? .19 : 0), i * 16);
        let material = [-1, -2, -3, -5][i % 4];
        if (def.id === 'mixed-materials' || def.highQuality)
            material = [-4, -2, -6, -3, -5, 2, -4, -1][i % 8];
        colors.set([.18 + ((i * 17) % 71) / 100, .12 + ((i * 29) % 60) / 100, .12 + ((i * 13) % 65) / 100, material], i * 4);
    }
    if (def.id === 'clip-boundaries') {
        u.viewProjection = new Float32Array([1 / 12, 0, 0, 0, 0, 1 / 12, 0, 0, 0, 0, -1 / 30, 0, 0, 0, .5, 1]);
        u.cameraPosition = [0, 0, 30];
        for (let i = 1; i < count; i++) {
            const side = (i - 1) % 8, sideJitter = ((i % 3) - 1) * .00001;
            const centers = [[12 + sideJitter, 0, 0], [-12 + sideJitter, 0, 0], [0, 12 + sideJitter, 0], [0, -12 + sideJitter, 0], [0, 0, 15 + sideJitter], [0, 0, -15 + sideJitter], [10, 10, 0], [-10, -10, 0]];
            matrices.set(box(...centers[side], 1.2, .025, .4, i * .29, i * .31, .25), i * 16);
            colors[i * 4 + 3] = i % 3 === 0 ? -4 : -2;
        }
    }
    if (def.id === 'offcamera-shadow') {
        u.viewProjection = mat4Multiply(orthographic(-7, 7, -5.25, 5.25, .1, 100), mat4LookAt([0, 18, 22], [0, 0, 0], [0, 1, 0]));
        u.cameraPosition = [0, 18, 22];
        matrices.set(box(9, 8, 6, 1.5, 2, 1.5, .2), 16);
        matrices.set(box(0, .5, 0, .8, .5, .8), 32);
        colors.set([.6, .2, .1, -2], 4);
    }
    if (def.id === 'large-cancellation') {
        u.viewProjection = new Float32Array([1 / 32, 0, 0, 0, 0, 1 / 32, 0, 0, 0, 0, -1 / 64, 0, -1e8 / 32, 0, .5, 1]);
        u.cameraPosition = [1e8, 0, 40];
        u.lightViewProjection = u.viewProjection.slice();
        for (let i = 0; i < count; i++)
            matrices.set(box(1e8 + (i % 9 - 4) * 8, Math.floor(i / 9) * 8 - 12, 0, 3, .8, 3, i * .3), i * 16);
    }
    if (def.rope) {
        for (let i = 1; i < count; i++)
            matrices.set(box(0, -1000, 0, .01, .01, .01), i * 16);
    }
    const f = { ...def, count, heap, matrices, colors, source, uniforms: u, surface: def.surface === 'water' ? water() : def.surface === 'cloth' ? cloth() : def.surface === 'sheet' ? sheet() : null, rope: def.rope ? rope() : null, baseMatrices: matrices.slice(), setVersion: v => { version = v; }, setColorVersion: v => { colorVersion = v; } };
    return f;
}
export function update(f, step) {
    if (f.animation === 'orbit') {
        const fresh = uniforms({ angle: .12 * Math.sin(step * .11) });
        f.uniforms.viewProjection = fresh.viewProjection;
        f.uniforms.cameraPosition = fresh.cameraPosition;
    }
    if (f.animation === 'rigid') {
        f.matrices.set(f.baseMatrices);
        for (let i = 1; i < f.count; i++)
            f.matrices[i * 16 + 13] += .12 * Math.sin(i * .1 + step * .13);
        f.setVersion(step + 1);
    }
}
/** Independent reference: transform all eight corners, then test homogeneous planes. */
export function oracleVisible(matrix, viewProjection) {
    const corners = [];
    for (const x of [-1, 1])
        for (const y of [-1, 1])
            for (const z of [-1, 1]) {
                const world = [0, 0, 0, 0];
                for (let row = 0; row < 4; row++)
                    world[row] = matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row];
                const clip = [0, 0, 0, 0];
                for (let row = 0; row < 4; row++)
                    for (let col = 0; col < 4; col++)
                        clip[row] += viewProjection[col * 4 + row] * world[col];
                if (clip.some(v => !Number.isFinite(v)))
                    return true;
                corners.push(clip);
            }
    const tests = [v => v[3] + v[0], v => v[3] - v[0], v => v[3] + v[1], v => v[3] - v[1], v => v[2], v => v[3] - v[2]];
    return tests.every(test => corners.some(v => test(v) >= 0));
}
