#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
// Headless Linux with a physical GPU: WebGPU through Dawn's Vulkan backend. Developer features remove the 100 us
// timestamp quantization so per-pass GPU spans keep their resolution. The adapter is still classified from its own info.
// BOX3D_HARDWARE_ARGS (space-separated) replaces the list when a host needs different flags; the report records the
// browser's full command line either way.
const HARDWARE_VULKAN_ARGS = process.env.BOX3D_HARDWARE_ARGS ? process.env.BOX3D_HARDWARE_ARGS.split(/\s+/).filter(Boolean)
    : ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const booleanFlags = new Set(['--software-gpu', '--hardware-vulkan', '--quick', '--parity-only', '--quality-only']);
const valueFlags = new Set(['--out', '--url', '--playwright-path', '--executable-path', '--screenshot', '--scenario', '--variant']);
const seenFlags = new Set();
for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seenFlags.has(flag)) throw new Error('Duplicate benchmark option: ' + flag);
    seenFlags.add(flag);
    if (booleanFlags.has(flag)) continue;
    if (!valueFlags.has(flag)) throw new Error('Unknown benchmark option: ' + flag);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + flag);
    i++;
}
const software = args.includes('--software-gpu'), hardwareVulkan = args.includes('--hardware-vulkan'), profile = software ? 'software' : hardwareVulkan ? 'hardware-vulkan' : 'default', output = resolve(root, value('--out') ?? `benchmarks/rendering/results/${profile}.json`), url = value('--url') ?? 'http://127.0.0.1:4318/benchmarks/rendering/index.html';
let playwright;
if (value('--playwright-path'))
    playwright = await import(pathToFileURL(resolve(value('--playwright-path'))).href);
else
    try {
        playwright = await import('playwright');
    }
    catch (e) {
        if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)
            throw e;
        playwright = await import(pathToFileURL(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href);
    }
const executablePath = value('--executable-path') ?? process.env.BOX3D_BROWSER_EXECUTABLE, launchArgs = software ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : hardwareVulkan ? HARDWARE_VULKAN_ARGS : [];
const browser = await playwright.chromium.launch({ headless: true, args: launchArgs, ...(executablePath ? { executablePath } : { channel: 'chromium' }) });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 }), pageErrors = [], consoleErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); console.error(e.message); });
    page.on('console', e => { if (e.type() === 'error') {
        consoleErrors.push(e.text());
        console.error(e.text());
    }
    else if (e.text().startsWith('[render-benchmark]'))
        console.log(e.text()); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => typeof window.runBox3dRenderingBenchmark === 'function', null, { timeout: 20000 });
    // Some headless Linux GPU hosts answer the first adapter request in a fresh browser with null while Dawn is still
    // enumerating its Vulkan adapters; later requests succeed. Retry before measuring and record what happened.
    const adapterWarmup = await page.evaluate(async () => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })) return { attempts: attempt, obtained: true };
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        return { attempts: 10, obtained: false };
    });
    const report = await page.evaluate(options => window.runBox3dRenderingBenchmark(options), { quick: args.includes('--quick'), parityOnly: args.includes('--parity-only'), qualityOnly: args.includes('--quality-only'), onlyScenario: value('--scenario'), onlyVariant: value('--variant') });
    report.provenance.browserVersion = browser.version();
    report.provenance.adapterWarmup = adapterWarmup;
    report.provenance.browserExtraArguments = launchArgs;
    report.provenance.browserLaunchProfile = software ? 'Explicit SwiftShader software fallback' : hardwareVulkan ? 'Explicit hardware Vulkan profile (headless Linux, unquantized timestamps)' : 'Standard Playwright headless, no added GPU flags';
    report.provenance.browserExecutable = executablePath ?? 'Playwright Chromium';
    report.provenance.host = { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length };
    try {
        const session = await browser.newBrowserCDPSession();
        report.provenance.browserFullArguments = (await session.send('Browser.getBrowserCommandLine')).arguments;
        await session.detach();
    }
    catch (e) {
        report.provenance.browserCommandLineUnavailable = e.message;
    }
    report.provenance.automation = { url, viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, pageErrors, consoleErrors };
    if (pageErrors.length)
        report.status = 'FAILED';
    await mkdir(dirname(output), { recursive: true });
    for (const item of await page.evaluate(() => window.__BOX3D_RENDER_IMAGES__ ?? [])) {
        const file = join(dirname(output), item.name + '.png');
        await writeFile(file, Buffer.from(item.dataUrl.split(',')[1], 'base64'));
    }
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    if (value('--screenshot'))
        await page.screenshot({ path: resolve(root, value('--screenshot')), fullPage: false });
    console.log(JSON.stringify({ output, status: report.status, reason: report.reason, gpu: { classification: report.gpu.classification, timestamps: report.gpu.timestampStatus }, parity: { total: report.parity.length, failed: report.parity.filter(c => c.status !== 'PASSED').map(c => ({ id: c.id, variant: c.variant, pixels: c.pixels })) }, visibility: { total: report.visibility.length, failed: report.visibility.filter(c => c.status === 'FAILED') }, qualityCorrections: report.qualityCorrections.map(c => ({ id: c.id, status: c.status, changedPixels: (c.staleDifference ?? c.previousDifference ?? c.boundaryDifference)?.differingPixels })), cacheInvalidation: { total: report.cacheInvalidation.length, failed: report.cacheInvalidation.filter(c => c.status !== 'PASSED') }, timings: report.timings.map(t => ({ id: t.id, variant: t.variant, baselineWallP50: t.baseline.wallCompletion.p50, candidateWallP50: t.candidate.wallCompletion.p50, wallRatio: t.wallSpeedRatio, baselineGpuP50: t.baseline.gpuFrameSpan.p50, candidateGpuP50: t.candidate.gpuFrameSpan.p50 })), gpuValidationErrors: report.gpuValidationErrors }, null, 2));
    if (report.status === 'FAILED')
        process.exitCode = 1;
}
finally {
    await browser.close();
}
