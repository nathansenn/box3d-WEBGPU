export function timeout(promise, ms, label) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]).finally(() => clearTimeout(timer)); }
export const idle = device => timeout(device.queue.onSubmittedWorkDone(), 30000, 'GPU completion');
export async function sha256(input) { const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input; return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); }
export function distribution(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    if (!sorted.length)
        return { n: 0, p50: null, p95: null, p99: null, min: null, max: null, mean: null };
    const percentile = p => { const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x); return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo); };
    return { n: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), min: sorted[0], max: sorted.at(-1), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
}
export function comparePixels(a, b) { let differingPixels = 0, differingChannels = 0, maxAbsolute = 0, squared = 0; if (a.length !== b.length)
    throw new Error('Pixel length mismatch'); for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
        const delta = Math.abs(a[i + c] - b[i + c]);
        if (delta) {
            changed = true;
            differingChannels++;
        }
        maxAbsolute = Math.max(maxAbsolute, delta);
        squared += delta * delta;
    }
    if (changed)
        differingPixels++;
} return { pass: differingChannels === 0, pixels: a.length / 4, differingPixels, differingChannels, maxAbsolute, rmsChannelError: Math.sqrt(squared / a.length) }; }
export async function capture(renderer, texture) {
    const [width, height] = renderer.viewport(), bytesPerRow = Math.ceil(width * 4 / 256) * 256, device = renderer.device;
    const buffer = device.createBuffer({ label: 'Rendering comparison pixel readback', size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow, rowsPerImage: height }, [width, height]);
        device.queue.submit([encoder.finish()]);
        await timeout(buffer.mapAsync(GPUMapMode.READ), 30000, 'Pixel map');
        const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++)
            pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
        buffer.unmap();
        return pixels;
    }
    finally {
        buffer.destroy();
    }
}
/** Optional profiling feature is requested identically for the unmodified baseline
 * and candidate. Shader text and existing descriptors are not substituted. */
export async function createProfiledRenderer(Renderer, canvas, capacity, options) {
    const original = navigator.gpu.requestAdapter, nativeRequest = original.bind(navigator.gpu);
    let profilingFeatureRequested = false, adapterInfo = null, adapterFeatures = [];
    navigator.gpu.requestAdapter = async (descriptor) => {
        const adapter = await nativeRequest(descriptor);
        if (!adapter)
            return adapter;
        const info = adapter.info ?? {};
        adapterInfo = Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(k => [k, info[k] ?? '']));
        adapterInfo.isFallbackAdapter = adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null;
        adapterFeatures = [...adapter.features];
        const request = adapter.requestDevice.bind(adapter);
        adapter.requestDevice = descriptor => { const features = [...(descriptor?.requiredFeatures ?? [])]; if (adapter.features.has('timestamp-query')) {
            features.push('timestamp-query');
            profilingFeatureRequested = true;
        } return request({ ...descriptor, requiredFeatures: [...new Set(features)] }); };
        return adapter;
    };
    try {
        const renderer = await timeout(Renderer.create(canvas, capacity, options), 90000, 'Renderer setup');
        return { renderer, adapterInfo, adapterFeatures, profilingFeatureRequested };
    }
    finally {
        navigator.gpu.requestAdapter = original;
    }
}
/** Timestamp writes are attached to the real render/compute passes. Query resolve
 * and readback occur after measured frame completion, never inside wall timing. */
export function frameProfiler(device) {
    const supported = device.features.has('timestamp-query');
    if (!supported)
        return { supported: false, begin() { }, end() { }, async read() { return null; }, destroy() { } };
    const querySet = device.createQuerySet({ type: 'timestamp', count: 128 }), resolve = device.createBuffer({ size: 1024, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }), read = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const create = device.createCommandEncoder.bind(device);
    let active = false, passes = [];
    device.createCommandEncoder = (descriptor) => {
        const encoder = create(descriptor);
        if (!active)
            return encoder;
        for (const [method, kind] of [['beginRenderPass', 'render'], ['beginComputePass', 'compute']]) {
            const begin = encoder[method].bind(encoder);
            encoder[method] = (descriptor = {}) => {
                if (passes.length >= 64)
                    throw new Error('Timestamp instrumentation capacity exceeded');
                if (descriptor.timestampWrites)
                    throw new Error('Renderer supplied timestamps; harness must not overwrite them');
                const index = passes.length * 2;
                passes.push({ label: descriptor.label ?? kind, kind, index });
                return begin({ ...descriptor, timestampWrites: { querySet, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1 } });
            };
        }
        return encoder;
    };
    return { supported: true, begin() { passes = []; active = true; }, end() { active = false; }, async read() {
            if (!passes.length)
                return null;
            const encoder = create(), bytes = passes.length * 16;
            encoder.resolveQuerySet(querySet, 0, passes.length * 2, resolve, 0);
            encoder.copyBufferToBuffer(resolve, 0, read, 0, bytes);
            device.queue.submit([encoder.finish()]);
            await timeout(read.mapAsync(GPUMapMode.READ), 30000, 'Timestamp map');
            try {
                const values = new BigUint64Array(read.getMappedRange()), out = passes.map(p => { const a = values[p.index], b = values[p.index + 1]; if (b < a)
                    throw new Error('Non-monotonic timestamp'); return { label: p.label, kind: p.kind, milliseconds: Number(b - a) / 1e6 }; });
                const span = values[passes.length * 2 - 1] - values[0];
                return { frameSpanMs: Number(span) / 1e6, passSumMs: out.reduce((s, p) => s + p.milliseconds, 0), passes: out };
            }
            finally {
                read.unmap();
            }
        }, destroy() { active = false; device.createCommandEncoder = create; querySet.destroy(); resolve.destroy(); read.destroy(); } };
}
