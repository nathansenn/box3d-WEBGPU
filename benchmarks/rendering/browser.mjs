import { WebGPURenderer as BaselineRenderer } from '/compiled/baseline/src/webgpu/renderer.mjs';
import { WebGPURenderer as CandidateRenderer } from '/compiled/candidate/src/webgpu/renderer.mjs';
import * as oldMath from '/compiled/baseline/src/math.mjs';
import * as newMath from '/compiled/candidate/src/math.mjs';
import { SCENARIOS, fixture, update, box, orthographic, oracleVisible } from './fixtures.mjs';
import { timeout, idle, sha256, distribution, comparePixels, capture, createProfiledRenderer, frameProfiler } from './timing.mjs';
const status = document.querySelector('#status'), resultView = document.querySelector('#result'), button = document.querySelector('#run');
const OFF = { vertexMaterialRejection: false, shadowPcfFetch: false, shadowCache: false, computeVisibility: false };
const VARIANTS = [{ id: 'material-filter', flags: { ...OFF, vertexMaterialRejection: true, shadowPcfFetch: true } }, { id: 'shadow-cache', flags: { ...OFF, vertexMaterialRejection: true, shadowPcfFetch: true, shadowCache: true } }, { id: 'stable-visibility', flags: { vertexMaterialRejection: true, shadowPcfFetch: true, shadowCache: true, computeVisibility: true } }];
const CACHE_CHECK_IDS = ['initial-content', 'reused-unchanged', 'rigid-transform', 'caster-material-change',
    'light-matrix-change', 'effect-upload', 'soft-upload', 'external-encode-callback', 'quality-4x-nine-taps',
    'shadow-map-recreation', 'resolution-scale', 'restored-quality', 'cloth-introduced', 'cloth-deformation',
    'sheet-introduced', 'sheet-deformation', 'surface-caster-removed', 'water-introduced', 'water-only-update',
    'shadows-disabled', 'changed-while-shadows-disabled', 'shadows-reenabled-after-change', 'rope-introduced',
    'rope-deformation', 'rope-disabled'];
const QUALITY_CHECK_IDS = ['empty-caster-shadow-clear', 'orthographic-signed-depth', 'material-rounding-boundary'];

function validateSelection({ onlyScenario, onlyVariant, qualityOnly }) {
    if (onlyScenario !== undefined && !SCENARIOS.some(s => s.id === onlyScenario))
        throw new Error('Unknown rendering scenario: ' + String(onlyScenario));
    if (onlyVariant !== undefined && !['candidate-default', ...VARIANTS.map(v => v.id)].includes(onlyVariant))
        throw new Error('Unknown rendering variant: ' + String(onlyVariant));
    if (qualityOnly && (onlyScenario !== undefined || onlyVariant !== undefined))
        throw new Error('Quality-only mode cannot be combined with scenario or variant selectors.');
}
function classifyAdapter(info) {
    if (!info) return 'UNAVAILABLE';
    return info.isFallbackAdapter === true || /swiftshader|llvmpipe|software|lavapipe/i.test(Object.values(info).join(' '))
        ? 'SOFTWARE_GPU' : 'HARDWARE_UNVERIFIED';
}
function compareTimedAdapters(a, b) {
    if (!a || !b) throw new Error('Actual renderer adapter identity is missing.');
    const fieldsCompared = [], mismatches = [];
    for (const key of ['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']) {
        if (a[key] === undefined || a[key] === null || a[key] === '' || b[key] === undefined || b[key] === null || b[key] === '') continue;
        fieldsCompared.push(key);
        if (a[key] !== b[key]) mismatches.push({ key, baseline: a[key], candidate: b[key] });
    }
    if (classifyAdapter(a) !== classifyAdapter(b)) mismatches.push({ key: 'classification', baseline: classifyAdapter(a), candidate: classifyAdapter(b) });
    return { status: mismatches.length ? 'FAILED' : 'PASSED', fieldsCompared, mismatches,
        limitation: 'Only exposed identity fields can be compared; redacted physical device IDs remain unverified.' };
}
function coverageGate(report, expected) {
    const actual = Object.fromEntries(['parity', 'visibility', 'timings', 'cacheInvalidation', 'qualityCorrections'].map(k => [k, report[k].length]));
    const countsMatch = Object.keys(actual).every(k => actual[k] === expected[k]);
    const idsMatch = (rows, ids) => rows.length === ids.length && new Set(rows.map(c => c.id)).size === ids.length && ids.every(id => rows.some(c => c.id === id));
    const uniqueComparisons = ['parity', 'visibility', 'timings'].every(k => new Set(report[k].map(c => c.id + '/' + c.variant)).size === report[k].length);
    const namedChecksMatch = idsMatch(report.cacheInvalidation, expected.cacheIds) && idsMatch(report.qualityCorrections, expected.qualityIds);
    const nonempty = expected.parity > 0 || expected.qualityCorrections > 0;
    const completeSamples = report.timings.every(t => t.pairs.length === report.settings.samples &&
        t.baseline.wallCompletion.n === report.settings.samples && t.candidate.wallCompletion.n === report.settings.samples &&
        t.pairs.every(p => ['baseline', 'candidate'].every(k => Number.isFinite(p[k].wallCompletionMs) && p[k].wallCompletionMs > 0)));
    return { status: countsMatch && uniqueComparisons && namedChecksMatch && nonempty && completeSamples ? 'PASSED' : 'FAILED',
        actual, expected, countsMatch, uniqueComparisons, namedChecksMatch, nonempty, completeSamples };
}
const resources = new WeakMap(), savedImages = [];
function message(e) { return e instanceof Error ? e.message : String(e); }
function progress(text) { status.textContent = text; window.__BOX3D_RENDER_PROGRESS__ = text; console.log('[render-benchmark] ' + text); }
function outputFor(renderer) {
    let data = resources.get(renderer);
    if (!data) {
        data = { water: new Map() };
        resources.set(renderer, data);
    }
    const [width, height] = renderer.viewport();
    if (!data.output || data.width !== width || data.height !== height) {
        data.output?.destroy();
        data.output = renderer.device.createTexture({ label: 'Production renderer A/B output', size: [width, height], format: renderer.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        data.view = data.output.createView();
        data.width = width;
        data.height = height;
    }
    return data;
}
function resident(renderer, f) { const r = outputFor(renderer); if (!r.water.has(f)) {
    const buffers = { device: renderer.device };
    for (const field of ['eta', 'u', 'v']) {
        const a = f.surface[field], buffer = renderer.device.createBuffer({ label: 'A/B resident water ' + field, size: a.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        renderer.device.queue.writeBuffer(buffer, 0, a);
        buffers[field] = buffer;
    }
    r.water.set(f, buffers);
} return r.water.get(f); }
function apply(renderer, f, step, { count = f.count, source = 'rigid' } = {}) {
    update(f, step);
    renderer.writeSceneUniforms(f.uniforms);
    let bytes = source === 'effects' ? renderer.uploadEffects(f.matrices, f.colors, 0, count, step + 1) : source === 'soft' ? renderer.uploadSoftInstances(f.matrices, f.colors, 0, count, step + 1) : renderer.uploadInstances(f.source, count);
    if (f.resident)
        bytes += renderer.uploadResidentWater(f.surface, resident(renderer, f));
    else
        bytes += renderer.uploadSurface(f.surface);
    bytes += renderer.uploadRopeGrid(f.rope, 1);
    return bytes;
}
async function renderState(renderer, f, step = 0, options = {}) { apply(renderer, f, step, options); const out = outputFor(renderer); renderer.render(options.count ?? f.count, [], 0, options.callback, out.view); await idle(renderer.device); return capture(renderer, out.output); }
function saveImage(name, label, pixels, renderer) {
    const canvas = document.createElement('canvas'), [width, height] = renderer.viewport();
    canvas.width = width;
    canvas.height = height;
    const rgba = new Uint8ClampedArray(pixels);
    if (renderer.format.startsWith('bgra'))
        for (let i = 0; i < rgba.length; i += 4) {
            const b = rgba[i];
            rgba[i] = rgba[i + 2];
            rgba[i + 2] = b;
        }
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent = label;
    figure.append(canvas, caption);
    document.querySelector('#gallery').append(figure);
    savedImages.push({ name, label, dataUrl: canvas.toDataURL('image/png'), width, height });
}
function oracleMaterial(alpha) { const magnitude = Math.max(-alpha, 0), low = Math.floor(magnitude), material = magnitude - low === .5 ? low + (low % 2) : Math.floor(magnitude + .5), transparent = material === 4 || material === 6, margin = 8 * 2 ** -23 * Math.max(1, Math.abs(alpha)), boundary = [3.5, 4.5, 5.5, 6.5].some(v => Math.abs(magnitude - v) <= margin); return { transparent, boundary, shadow: !transparent && alpha <= Math.fround(1.001), shadowAllowance: alpha <= Math.fround(1.001) + margin }; }
function oracleCounts(f, gpu) {
    if (!gpu)
        return { status: 'FAILED', reason: 'Compute visibility was enabled but no diagnostic snapshot was returned.' };
    const validShape = Number.isInteger(gpu.inputCount) && gpu.inputCount === f.count &&
        Number.isInteger(gpu.capacity) && gpu.capacity >= f.count;
    if (!validShape)
        return { status: 'FAILED', reason: 'Visibility input count or capacity does not match the submitted fixture.', expectedInputCount: f.count, inputCount: gpu.inputCount, capacity: gpu.capacity };
    if (f.rope)
        return { status: 'PIXEL_PARITY_ONLY', inputCount: gpu.inputCount, capacity: gpu.capacity, reason: 'Rope matrices are expanded on GPU; CPU fixture intentionally contains inert placeholders.' };
    const expected = { opaque: [], transparent: [], shadow: [] };
    for (let i = 0; i < f.count; i++) {
        const matrix = f.matrices.subarray(i * 16, (i + 1) * 16), material = oracleMaterial(f.colors[i * 4 + 3]);
        if (oracleVisible(matrix, f.uniforms.viewProjection))
            expected[material.transparent ? 'transparent' : 'opaque'].push(i);
        if (material.shadow && oracleVisible(matrix, f.uniforms.lightViewProjection))
            expected.shadow.push(i);
    }
    let pass = true;
    const lists = {};
    for (const kind of ['opaque', 'transparent', 'shadow']) {
        const actual = Array.from(gpu[kind].ids), set = new Set(actual), missing = expected[kind].filter(id => !set.has(id)), strictlyOrdered = actual.every((id, i) => Number.isInteger(id) && id >= 0 && id < f.count && (i === 0 || id > actual[i - 1]));
        const eligible = actual.every(id => { const m = oracleMaterial(f.colors[id * 4 + 3]); return kind === 'opaque' ? m.boundary || !m.transparent : kind === 'transparent' ? m.boundary || m.transparent : (m.boundary || !m.transparent) && m.shadowAllowance; });
        const ok = !missing.length && strictlyOrdered && eligible && actual.length === gpu[kind].count;
        pass &&= ok;
        lists[kind] = { pass: ok, count: actual.length, oracleVisible: expected[kind].length, conservativeExtras: actual.length - expected[kind].length, missing: missing.slice(0, 16), strictlyOrdered, eligible, firstIds: actual.slice(0, 12), lastIds: actual.slice(-12) };
    }
    return { status: pass ? 'PASSED' : 'FAILED', method: 'Independent float64 eight-corner clip-plane oracle. GPU conservative supersets allowed; missing eligible visible instances forbidden.', inputCount: gpu.inputCount, capacity: gpu.capacity, lists };
}
function totals(samples) { const labels = [...new Set(samples.flatMap(s => s.gpu?.passes.map(p => p.label) ?? []))]; return { cpuFramePreparation: distribution(samples.map(s => s.cpuFramePreparationMs)), cpuEncodeAndSubmit: distribution(samples.map(s => s.cpuEncodeAndSubmitMs)), cpuTotal: distribution(samples.map(s => s.cpuTotalMs)), wallCompletion: distribution(samples.map(s => s.wallCompletionMs)), gpuFrameSpan: distribution(samples.flatMap(s => s.gpu ? [s.gpu.frameSpanMs] : [])), gpuPassSum: distribution(samples.flatMap(s => s.gpu ? [s.gpu.passSumMs] : [])), gpuPasses: Object.fromEntries(labels.map(label => [label, distribution(samples.map(s => s.gpu?.passes.filter(p => p.label === label).reduce((sum, p) => sum + p.milliseconds, 0) ?? 0))])), inputStreamUploadedBytesPerFrame: distribution(samples.map(s => s.inputStreamUploadedBytes)) }; }
function confidence(pairs) { const ratios = pairs.map(p => p.baseline.wallCompletionMs / p.candidate.wallCompletionMs), n = ratios.length; if (!n)
    return null; let state = 1707; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; }, boot = []; for (let b = 0; b < 1000; b++) {
    const sample = [];
    for (let i = 0; i < n; i++)
        sample.push(ratios[Math.floor(random() * n)]);
    boot.push(distribution(sample).p50);
} boot.sort((a, b) => a - b); return { pairedRatioMedian: distribution(ratios).p50, bootstrap95PercentInterval: [boot[24], boot[974]], method: '1000 deterministic paired bootstrap resamples; descriptive uncertainty for this run, not cross-device generalization.' }; }
async function timed(renderer, profiler, f, step) { await idle(renderer.device); profiler.begin(); const start = performance.now(), inputStreamUploadedBytes = apply(renderer, f, step), prepared = performance.now(), out = outputFor(renderer); const cpuEncodeAndSubmitMs = renderer.render(f.count, [], 0, undefined, out.view), submitted = performance.now(); profiler.end(); await idle(renderer.device); const completed = performance.now(), gpu = await profiler.read(); return { step, inputStreamUploadedBytes, cpuFramePreparationMs: prepared - start, cpuEncodeAndSubmitMs, cpuTotalMs: submitted - start, wallCompletionMs: completed - start, gpu }; }
async function benchmarkPair(baseline, candidate, profilers, f, variant, settings) {
    await candidate.setRenderingOptimizations(variant.flags);
    baseline.invalidateDynamicCaches();
    candidate.invalidateDynamicCaches();
    await renderState(baseline, f, 0);
    await renderState(candidate, f, 0);
    for (let i = 0; i < settings.warmup; i++) {
        await timed(baseline, profilers.baseline, f, 100 + i);
        await timed(candidate, profilers.candidate, f, 100 + i);
    }
    candidate.resetRenderingDiagnostics?.();
    const pairs = [];
    for (let i = 0; i < settings.samples; i++) {
        const step = 200 + i, pair = { index: i, order: i % 2 ? 'candidate-first' : 'baseline-first' };
        if (i % 2) {
            pair.candidate = await timed(candidate, profilers.candidate, f, step);
            pair.baseline = await timed(baseline, profilers.baseline, f, step);
        }
        else {
            pair.baseline = await timed(baseline, profilers.baseline, f, step);
            pair.candidate = await timed(candidate, profilers.candidate, f, step);
        }
        pairs.push(pair);
    }
    const a = totals(pairs.map(p => p.baseline)), b = totals(pairs.map(p => p.candidate));
    return { id: f.id, variant: variant.id, flags: variant.flags, status: 'MEASURED', count: f.count, quality: f.uniforms.quality, baseline: a, candidate: b, wallSpeedRatio: a.wallCompletion.p50 / b.wallCompletion.p50, gpuSpanSpeedRatio: a.gpuFrameSpan.p50 && b.gpuFrameSpan.p50 ? a.gpuFrameSpan.p50 / b.gpuFrameSpan.p50 : null, uncertainty: confidence(pairs), candidateDiagnostics: candidate.renderingDiagnostics?.(), pairs };
}
async function qualityCorrections(baseline, candidate) {
    await candidate.setRenderingOptimizations(VARIANTS[1].flags);
    baseline.invalidateDynamicCaches();
    candidate.invalidateDynamicCaches();
    const f = fixture({ id: 'stale-shadow-water', count: 2, surface: 'water' });
    f.matrices.set(box(0, 5, -6, 3, 3, 3, .3), 16);
    f.colors.set([.5, .2, .1, -2], 4);
    f.surface.eta.fill(0);
    f.surface.u.fill(0);
    f.surface.v.fill(0);
    f.uniforms.cameraPosition = [0, 22, 30];
    f.uniforms.viewProjection = newMath.mat4Multiply(newMath.mat4Perspective(Math.PI / 3.1, 4 / 3, .1, 250), newMath.mat4LookAt([0, 22, 30], [0, 0, 0], [0, 1, 0]));
    const lightNorm = Math.hypot(22, 30);
    f.uniforms.lightDirection = [0, -22 / lightNorm, 30 / lightNorm];
    f.uniforms.lightViewProjection = newMath.mat4Multiply(orthographic(-27, 27, -27, 27, .1, 130), newMath.mat4LookAt([0, 22, -30], [0, 0, 0], [0, 1, 0]));
    await renderState(baseline, f);
    await renderState(candidate, f);
    const stale = await renderState(baseline, f, 0, { count: 0 }), corrected = await renderState(candidate, f, 0, { count: 0 });
    // Explicit empty clear in the old renderer: an excluded off-camera caster.
    f.matrices.set(box(1000, 1000, 1000, .01, .01, .01));
    f.colors.set([0, 0, 0, 2]);
    f.setVersion(2);
    f.setColorVersion(2);
    await renderState(baseline, f, 0, { count: 1 });
    const fresh = await renderState(baseline, f, 0, { count: 0 });
    const staleDifference = comparePixels(stale, fresh), clearedParity = comparePixels(fresh, corrected);
    saveImage('stale-shadow-before', 'Previous renderer: stale shadow after caster removal', stale, baseline);
    saveImage('stale-shadow-fixed', 'Candidate: shadow map cleared after caster removal', corrected, candidate);
    const results = [{ id: 'empty-caster-shadow-clear', status: clearedParity.pass && staleDifference.differingPixels > 0 ? 'PASSED' : 'FAILED', correctReference: 'Pinned baseline after an explicit empty depth clear; same water, camera and shading.', staleDifference, clearedParity, candidateDiagnostics: candidate.renderingDiagnostics?.() }];
    const q = fixture({ id: 'orthographic-shadow', count: 5 });
    q.matrices.set(box(0, 3, 0, 2, 3, 2, .3), 16);
    q.matrices.set(box(-6, 2, 4, 1.4, 2, 1.4), 32);
    q.matrices.set(box(6, 2, -4, 1.5, 2, 1.5), 48);
    const lightView = newMath.mat4LookAt([22, 38, 17], [0, 0, 0], [0, 1, 0]), correct = newMath.mat4Multiply(orthographic(-27, 27, -27, 27, .1, 130), lightView);
    q.uniforms.lightViewProjection = oldMath.mat4Multiply(oldMath.mat4Orthographic(-27, 27, -27, 27, .1, 130), lightView);
    baseline.invalidateDynamicCaches();
    const old = await renderState(baseline, q);
    q.uniforms.lightViewProjection = correct;
    const analytic = await renderState(baseline, q);
    q.uniforms.lightViewProjection = newMath.mat4Multiply(newMath.mat4Orthographic(-27, 27, -27, 27, .1, 130), lightView);
    candidate.invalidateDynamicCaches();
    const fixed = await renderState(candidate, q);
    const analyticParity = comparePixels(analytic, fixed), previousDifference = comparePixels(old, analytic), matrixMaxError = Math.max(...correct.map((v, i) => Math.abs(v - q.uniforms.lightViewProjection[i])));
    saveImage('orthographic-before', 'Previous depth projection: incorrect shadow volume', old, baseline);
    saveImage('orthographic-fixed', 'Corrected depth projection: valid shadow volume', fixed, candidate);
    results.push({ id: 'orthographic-signed-depth', status: analyticParity.pass && previousDifference.differingPixels > 0 && matrixMaxError < 1e-6 ? 'PASSED' : 'FAILED', analyticParity, previousDifference, matrixMaxError, scope: 'Separate quality correction. Performance comparisons supply the same correct light matrix to both renderers.' });
    const edge = fixture({ id: 'material-boundary', count: 4 });
    edge.matrices.set(box(-3, 3, 0, 2, 3, 2, .2), 16);
    edge.matrices.set(box(3, 3, 0, 2, 3, 2, -.2), 32);
    edge.colors.set([.18, .55, .82, -4.5], 4);
    edge.colors.set([.6, .48, .32, -6.5], 8);
    edge.matrices.set(box(1000, 1000, 1000, .01, .01, .01), 48);
    edge.colors.set([0, 0, 0, -4], 12);
    baseline.invalidateDynamicCaches();
    const missing = await renderState(baseline, edge, 0, { count: 3 });
    const forced = await renderState(baseline, edge, 0, { count: 4 }), boundaryDifference = comparePixels(missing, forced), checks = [];
    for (const variant of [VARIANTS[1], VARIANTS[2]]) {
        await candidate.setRenderingOptimizations(variant.flags);
        candidate.invalidateDynamicCaches();
        const actual = await renderState(candidate, edge, 0, { count: 3 });
        checks.push({ variant: variant.id, pixels: comparePixels(forced, actual), ...(variant.flags.computeVisibility ? { visibility: oracleCounts({ ...edge, count: 3 }, await candidate.readRenderingVisibilityCounts()) } : {}) });
        if (variant.id === 'shadow-cache')
            saveImage('material-boundary-fixed', 'Boundary material tags remain visible', actual, candidate);
    }
    results.push({ id: 'material-rounding-boundary', status: checks.every(c => c.pixels.pass && (c.variant !== 'stable-visibility' || c.visibility?.status === 'PASSED')) && boundaryDifference.differingPixels > 0 ? 'PASSED' : 'FAILED', reference: 'Pinned direct renderer forced to issue its transparent draw with an offscreen glass sentinel; the target material values and shaders are unchanged.', boundaryDifference, checks });
    return results;
}
async function cacheInvalidationChecks(baseline, candidate) {
    let f = fixture({ id: 'cache-invalidation', count: 9 });
    await candidate.setRenderingOptimizations(VARIANTS[1].flags);
    baseline.invalidateDynamicCaches();
    candidate.invalidateDynamicCaches();
    const results = [];
    const check = async (id, step = 0, options = {}) => {
        const { expectedShadowReuse = false, expectedShadowPass = true, ...renderOptions } = options;
        const before = candidate.renderingDiagnostics();
        const a = await renderState(baseline, f, step, renderOptions);
        const b = await renderState(candidate, f, step, renderOptions);
        const pixels = comparePixels(a, b), after = candidate.renderingDiagnostics();
        const shadowPassDelta = after.shadowPasses - before.shadowPasses;
        const shadowCacheHitDelta = after.shadowCacheHits - before.shadowCacheHits;
        const behaviorPass = after.lastShadowReused === expectedShadowReuse &&
            shadowPassDelta === Number(expectedShadowPass) &&
            shadowCacheHitDelta === Number(expectedShadowReuse);
        results.push({ id, status: pixels.pass && behaviorPass ? 'PASSED' : 'FAILED', pixels,
            expectedShadowReuse, expectedShadowPass, behaviorPass, shadowPassDelta, shadowCacheHitDelta,
            candidateDiagnostics: after });
    };
    await check('initial-content');
    await check('reused-unchanged', 0, { expectedShadowReuse: true, expectedShadowPass: false });
    f.matrices[28] += 2;
    f.setVersion(1);
    await check('rigid-transform');
    f.colors[7] = -4;
    f.setColorVersion(1);
    await check('caster-material-change');
    f.uniforms.lightViewProjection = f.uniforms.lightViewProjection.slice();
    f.uniforms.lightViewProjection[12] += .15;
    await check('light-matrix-change');
    f.matrices[44] += 3;
    f.setVersion(2);
    await check('effect-upload', 2, { source: 'effects' });
    f.matrices[60] -= 3;
    f.setVersion(3);
    await check('soft-upload', 3, { source: 'soft' });
    // Settle the switch back to the rigid source before testing the callback alone.
    await renderState(baseline, f, 3);
    await renderState(candidate, f, 3);
    await check('external-encode-callback', 4, { callback: () => { } });
    f.uniforms.quality = { ...f.uniforms.quality, sampleCount: 4, shadowTapCount: 9 };
    await check('quality-4x-nine-taps', 5, { expectedShadowReuse: true, expectedShadowPass: false });
    f.uniforms.quality = { ...f.uniforms.quality, shadowMapSize: 2048 };
    await check('shadow-map-recreation', 6);
    f.uniforms.quality = { ...f.uniforms.quality, resolutionScale: .75 };
    await check('resolution-scale', 7, { expectedShadowReuse: true, expectedShadowPass: false });
    f.uniforms.quality = { ...f.uniforms.quality, resolutionScale: 1, sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1 };
    await check('restored-quality', 8);
    f.surface = fixture({ id: 'cloth-transition', count: 1, surface: 'cloth' }).surface;
    await check('cloth-introduced', 9);
    f.surface.positions[3 * 110 + 1] += 2;
    f.surface.frameVersion++;
    await check('cloth-deformation', 10);
    f.surface = fixture({ id: 'sheet-transition', count: 1, surface: 'sheet' }).surface;
    await check('sheet-introduced', 11);
    const sheetView = new DataView(f.surface.vertices.buffer);
    sheetView.setFloat32(24 * 44 + 4, 5, true);
    f.surface.frameVersion++;
    await check('sheet-deformation', 12);
    f.surface = null;
    await check('surface-caster-removed', 13);
    f.surface = fixture({ id: 'water-transition', count: 1, surface: 'water' }).surface;
    await check('water-introduced', 14, { expectedShadowReuse: true, expectedShadowPass: false });
    f.surface.eta[100] += .5;
    f.surface.frameVersion++;
    await check('water-only-update', 15, { expectedShadowReuse: true, expectedShadowPass: false });
    f.uniforms.quality = { ...f.uniforms.quality, shadowStrength: 0 };
    await check('shadows-disabled', 16, { expectedShadowPass: false });
    f.matrices[28] -= 3;
    f.setVersion(4);
    await check('changed-while-shadows-disabled', 17, { expectedShadowPass: false });
    f.uniforms.quality = { ...f.uniforms.quality, shadowStrength: .82 };
    await check('shadows-reenabled-after-change', 18);
    f = fixture({ id: 'rope-cache', count: 65, rope: true });
    baseline.invalidateDynamicCaches();
    candidate.invalidateDynamicCaches();
    await check('rope-introduced', 19);
    f.rope.positions[32 * 3 + 1] += 2;
    f.rope.frameVersion++;
    await check('rope-deformation', 20);
    f.rope = null;
    await check('rope-disabled', 21, { count: 1 });
    return results;
}
function showSummary(report) {
    document.querySelector('#adapter').textContent = `${report.gpu.classification ?? 'Unavailable'} · ${report.gpu.adapterInfo?.description ?? ''} · ${report.status}`;
    if (report.timings.length) {
        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Scene / candidate</th><th>Baseline wall p50</th><th>Candidate wall p50</th><th>Ratio</th></tr></thead>';
        const tbody = document.createElement('tbody');
        for (const t of report.timings) {
            const tr = document.createElement('tr');
            for (const value of [`${t.id} / ${t.variant}`, `${t.baseline.wallCompletion.p50.toFixed(3)} ms`, `${t.candidate.wallCompletion.p50.toFixed(3)} ms`, `${t.wallSpeedRatio.toFixed(2)}×`]) {
                const td = document.createElement('td');
                td.textContent = value;
                tr.append(td);
            }
            tbody.append(tr);
        }
        table.append(tbody);
        document.querySelector('#summary').append(table);
    }
    resultView.textContent = JSON.stringify(report, null, 2);
}
export async function runRenderingBenchmark({ quick = false, parityOnly = false, onlyScenario, onlyVariant, qualityOnly = false } = {}) {
    button.disabled = true;
    document.querySelector('#gallery').replaceChildren();
    document.querySelector('#summary').replaceChildren();
    savedImages.length = 0;
    const report = { schemaVersion: 'box3d-production-rendering/1', createdAt: new Date().toISOString(), status: 'RUNNING', scope: 'Pinned production renderer A/B; identical frozen geometry and rendering quality. Offscreen output, no canvas-presentation/FPS qualification.', settings: { width: 320, height: 240, devicePixelRatio, warmup: quick ? 2 : 4, samples: quick ? 6 : 20, order: 'Alternating baseline-first and candidate-first paired single frames; queues drained before each frame.', percentiles: 'Linear interpolation over sorted samples.', timingIncludes: 'Scene uniforms/uploads, command encoding, submission and queue completion. Optional GPU timestamps cover real passes; timestamp resolution/readback excluded from wall timer.', timingExcludes: 'Simulation stepping, initial resource allocation/compilation, screenshot readback, browser presentation.' }, provenance: { userAgent: navigator.userAgent, secureContext: isSecureContext, crossOriginIsolated }, gpu: { status: 'BLOCKED' }, parity: [], visibility: [], qualityCorrections: [], cacheInvalidation: [], timings: [], gpuValidationErrors: [] };
    let baseline, candidate, profilers = {}, tearingDown = false;
    try {
        validateSelection({ onlyScenario, onlyVariant, qualityOnly });
        report.settings.selection = { onlyScenario: onlyScenario ?? null, onlyVariant: onlyVariant ?? null, qualityOnly, parityOnly, quick };
        report.settings.inputStreamUploadAccounting = 'inputStreamUploadedBytes excludes scene uniforms and visibility parameters; their CPU and queue-completed costs remain inside frame timing.';
        report.provenance.sources = await (await fetch('/provenance.json')).json();
        if (!navigator.gpu) {
            report.status = 'BLOCKED';
            report.reason = 'navigator.gpu unavailable';
            return report;
        }
        const preflight = await timeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 15000, 'Adapter request');
        if (!preflight) {
            report.status = 'BLOCKED';
            report.reason = 'requestAdapter returned null';
            return report;
        }
        const info = preflight.info ?? {}, adapterInfo = Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(k => [k, info[k] ?? '']));
        adapterInfo.isFallbackAdapter = preflight.isFallbackAdapter ?? info.isFallbackAdapter ?? null;
        report.gpu = { status: 'AVAILABLE', preflightAdapterInfo: adapterInfo, preflightAdapterFeatures: [...preflight.features] };
        progress('Creating independent production renderers');
        const a = await createProfiledRenderer(BaselineRenderer, document.querySelector('#baseline'), 10000);
        baseline = a.renderer;
        const b = await createProfiledRenderer(CandidateRenderer, document.querySelector('#candidate'), 10000);
        candidate = b.renderer;
        report.gpu.timedAdapters = {
            baseline: { adapterInfo: a.adapterInfo, adapterFeatures: a.adapterFeatures, classification: classifyAdapter(a.adapterInfo) },
            candidate: { adapterInfo: b.adapterInfo, adapterFeatures: b.adapterFeatures, classification: classifyAdapter(b.adapterInfo) },
        };
        report.gpu.timedAdapterIdentityComparison = compareTimedAdapters(a.adapterInfo, b.adapterInfo);
        report.gpu.classification = classifyAdapter(a.adapterInfo);
        report.gpu.adapterInfo = a.adapterInfo;
        report.gpu.hardwareQualification = report.gpu.classification === 'SOFTWARE_GPU'
            ? 'NOT_QUALIFIED_SOFTWARE_ADAPTER' : 'UNVERIFIED_ADAPTER_REQUIRES_HARDWARE_CONFIRMATION';
        if (report.gpu.timedAdapterIdentityComparison.status !== 'PASSED')
            throw new Error('Baseline and candidate actual renderer adapters do not match.');
        report.gpu.baselineDeviceFeatures = [...baseline.device.features];
        report.gpu.candidateDeviceFeatures = [...candidate.device.features];
        report.gpu.timestampQueryRequestedByHarness = a.profilingFeatureRequested && b.profilingFeatureRequested;
        for (const [id, renderer] of [['baseline', baseline], ['candidate', candidate]]) {
            renderer.device.addEventListener('uncapturederror', event => report.gpuValidationErrors.push({ renderer: id, message: event.error.message }));
            void renderer.device.lost.then(info => { if (!tearingDown)
                report.gpuValidationErrors.push({ renderer: id, deviceLost: info }); });
        }
        profilers = { baseline: frameProfiler(baseline.device), candidate: frameProfiler(candidate.device) };
        report.gpu.timestampStatus = profilers.baseline.supported && profilers.candidate.supported ? 'AVAILABLE' : 'UNAVAILABLE';
        report.materials = { baseline: { noise: baseline.materialTextureInfo(), atlas: baseline.materialAtlasTextureInfo() }, candidate: { noise: candidate.materialTextureInfo(), atlas: candidate.materialAtlasTextureInfo() } };
        if (Object.values(report.materials).some(m => m.noise.source.startsWith('procedural') || m.atlas.source.startsWith('procedural')))
            throw new Error('Canonical KTX2 assets did not load; fallback assets cannot qualify this benchmark.');
        const initialFlags = candidate.renderingDiagnostics().optimizations, variants = [{ id: 'candidate-default', flags: initialFlags }, ...VARIANTS].filter(v => onlyVariant === undefined || v.id === onlyVariant);
        report.candidateDefaultFlags = initialFlags;
        const scenarios = SCENARIOS.filter(s => !qualityOnly && (onlyScenario === undefined || s.id === onlyScenario));
        const expectedCoverage = {
            parity: scenarios.length * variants.length,
            visibility: scenarios.length * variants.filter(v => v.flags.computeVisibility).length,
            timings: parityOnly ? 0 : scenarios.filter(s => s.benchmark).length * variants.length,
            cacheInvalidation: onlyScenario === undefined && !qualityOnly ? CACHE_CHECK_IDS.length : 0,
            qualityCorrections: onlyScenario === undefined ? QUALITY_CHECK_IDS.length : 0,
            cacheIds: onlyScenario === undefined && !qualityOnly ? CACHE_CHECK_IDS : [],
            qualityIds: onlyScenario === undefined ? QUALITY_CHECK_IDS : [],
        };
        for (const def of scenarios) {
            const f = fixture(def);
            baseline.invalidateDynamicCaches();
            candidate.invalidateDynamicCaches();
            const reference = await renderState(baseline, f, 0), fixtureHash = await sha256(f.heap);
            const savedSurface = f.surface, savedResident = f.resident;
            f.surface = null;
            f.resident = false;
            const background = await renderState(baseline, f, 0, { count: 0 });
            f.surface = savedSurface;
            f.resident = savedResident;
            const sceneCoveragePixels = comparePixels(background, reference).differingPixels;
            for (const variant of variants) {
                progress(`Pixel parity: ${f.id} / ${variant.id}`);
                await candidate.setRenderingOptimizations(variant.flags);
                candidate.invalidateDynamicCaches();
                const actual = await renderState(candidate, f, 0), pixels = comparePixels(reference, actual);
                report.parity.push({ id: f.id, variant: variant.id, status: pixels.pass && ((f.count === 0 && !f.surface) || sceneCoveragePixels > 0) ? 'PASSED' : 'FAILED', count: f.count, quality: f.uniforms.quality, fixtureSha256: fixtureHash, sceneCoveragePixels, pixels, baselinePixelSha256: await sha256(reference), candidatePixelSha256: await sha256(actual), candidateDiagnostics: candidate.renderingDiagnostics?.() });
                if (variant.flags.computeVisibility) {
                    const gpu = await candidate.readRenderingVisibilityCounts();
                    report.visibility.push({ id: f.id, variant: variant.id, ...oracleCounts(f, gpu) });
                }
                if (f.id === 'mixed-materials' && variant.id === 'stable-visibility') {
                    saveImage('mixed-baseline', 'Pinned baseline · mixed opaque/glass/dust', reference, baseline);
                    saveImage('mixed-candidate', 'Stable GPU visibility · same frozen scene', actual, candidate);
                }
            }
            if (def.benchmark && !parityOnly)
                for (const variant of variants) {
                    progress(`Timing: ${f.id} / ${variant.id}`);
                    report.timings.push(await benchmarkPair(baseline, candidate, profilers, f, variant, report.settings));
                }
        }
        if (!onlyScenario) {
            if (!qualityOnly) {
                progress('Checking shadow cache invalidation');
                report.cacheInvalidation = await cacheInvalidationChecks(baseline, candidate);
            }
            progress('Verifying visual correctness fixes');
            report.qualityCorrections = await qualityCorrections(baseline, candidate);
        }
        await idle(baseline.device);
        await idle(candidate.device);
        report.coverage = coverageGate(report, expectedCoverage);
        const pass = report.coverage.status === 'PASSED' && report.parity.every(c => c.status === 'PASSED') &&
            report.visibility.every(c => c.status === 'PASSED' || (c.id === 'gpu-rope' && c.status === 'PIXEL_PARITY_ONLY')) &&
            report.cacheInvalidation.every(c => c.status === 'PASSED') && report.qualityCorrections.every(c => c.status === 'PASSED') && !report.gpuValidationErrors.length;
        report.status = pass ? 'PASSED' : 'FAILED';
        report.images = savedImages.map(({ dataUrl, ...metadata }) => metadata);
    }
    catch (e) {
        report.status = 'FAILED';
        report.reason = message(e);
        report.stack = e?.stack;
    }
    finally {
        tearingDown = true;
        profilers.baseline?.destroy();
        profilers.candidate?.destroy();
        for (const renderer of [baseline, candidate])
            if (renderer) {
                const data = resources.get(renderer);
                data?.output?.destroy();
                for (const buffers of data?.water.values() ?? [])
                    for (const key of ['eta', 'u', 'v'])
                        buffers[key].destroy();
                renderer.device.destroy();
            }
        window.__BOX3D_RENDER_IMAGES__ = savedImages;
        window.__BOX3D_RENDER_RESULT__ = report;
        progress(report.status);
        showSummary(report);
        button.disabled = false;
    }
    return report;
}
window.runBox3dRenderingBenchmark = runRenderingBenchmark;
button.onclick = () => runRenderingBenchmark();
