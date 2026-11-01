// Narrow down why the harness page gets no adapter while a plain page does: page options, wait mode, timing.
// usage: node diag2.mjs <playwright-core index.mjs> <chrome executable> <out dir> <args...>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pwPath, chrome, out, ...args] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwPath).href);
const url = 'http://127.0.0.1:4318/benchmarks/rendering/index.html';
const probe = () => navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then((a) => a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, fallback: a.isFallbackAdapter ?? a.info?.isFallbackAdapter } : null).catch((e) => ({ error: String(e) }));
const results = [];
for (const [label, pageOptions, waitUntil] of [
  ['default-load', undefined, 'load'],
  ['default-networkidle', undefined, 'networkidle'],
  ['viewport-load', { viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 }, 'load'],
  ['viewport-networkidle', { viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 }, 'networkidle'],
]) {
  const browser = await chromium.launch({ headless: true, executablePath: chrome, args });
  const consoleLines = [];
  try {
    const page = await browser.newPage(pageOptions);
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    await page.goto(url, { waitUntil, timeout: 30000 });
    await page.waitForFunction(() => typeof window.runBox3dRenderingBenchmark === 'function', null, { timeout: 20000 });
    const first = await page.evaluate(probe);
    const second = await page.evaluate(probe);
    let harness = null;
    if (label === 'viewport-networkidle' || label === 'default-load') {
      const report = await page.evaluate(() => window.runBox3dRenderingBenchmark({ quick: true, parityOnly: true, onlyScenario: 'all-visible-opaque', onlyVariant: 'candidate-default' }));
      harness = { status: report.status, reason: report.reason ?? null, gpu: report.gpu?.status, parity: report.parity?.length };
    }
    results.push({ label, first, second, harness, console: consoleLines.slice(0, 20) });
    console.log(label, JSON.stringify(first), JSON.stringify(second), JSON.stringify(harness));
  } catch (e) {
    results.push({ label, error: String(e), console: consoleLines.slice(0, 20) });
    console.log(label, 'error', String(e));
  } finally {
    await browser.close();
  }
}
fs.writeFileSync(path.join(out, 'webgpu-page-diagnosis.json'), JSON.stringify({ args, results }, null, 2) + '\n');
