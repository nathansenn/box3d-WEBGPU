#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const booleanFlags = new Set(['--software-gpu', '--quick', '--parity-only', '--quality-only']);
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
const software = args.includes('--software-gpu'), profile = software ? 'software' : 'default', output = resolve(root, value('--out') ?? `benchmarks/rendering/results/${profile}.json`), url = value('--url') ?? 'http://127.0.0.1:4318/benchmarks/rendering/index.html';
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
const executablePath = value('--executable-path') ?? process.env.BOX3D_BROWSER_EXECUTABLE, launchArgs = software ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] : [];
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
    const report = await page.evaluate(options => window.runBox3dRenderingBenchmark(options), { quick: args.includes('--quick'), parityOnly: args.includes('--parity-only'), qualityOnly: args.includes('--quality-only'), onlyScenario: value('--scenario'), onlyVariant: value('--variant') });
    report.provenance.browserVersion = browser.version();
    report.provenance.browserExtraArguments = launchArgs;
    report.provenance.browserLaunchProfile = software ? 'Explicit SwiftShader software fallback' : 'Standard Playwright headless, no added GPU flags';
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
