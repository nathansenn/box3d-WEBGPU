// Records chrome://gpu and the WebGPU adapter that the --hardware-vulkan benchmark profile exposes.
// usage: node gpuinfo.mjs <playwright-core index.mjs> <chrome executable> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pwPath, chrome, out] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwPath).href);
const args = ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features'];
const browser = await chromium.launch({ headless: true, executablePath: chrome, args });
try {
  const page = await browser.newPage();
  await page.goto('chrome://gpu', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const text = await page.evaluate(() => {
    const host = document.querySelector('info-view');
    return (host?.shadowRoot ?? document).textContent ?? document.body.innerText;
  });
  fs.writeFileSync(path.join(out, 'chrome-gpu.txt'), text);
  await page.goto('about:blank');
  const adapter = await page.evaluate(async () => {
    if (!navigator.gpu) return { error: 'navigator.gpu missing' };
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { error: 'requestAdapter returned null' };
    const info = a.info ?? {};
    return {
      info: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'driver', 'backend', 'type', 'isFallbackAdapter'].map((k) => [k, info[k] ?? null])),
      features: [...a.features].sort(),
      limits: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(a.limits))).filter(([, d]) => d.get).map(([k]) => [k, a.limits[k]])),
    };
  });
  fs.writeFileSync(path.join(out, 'webgpu-adapter.json'), JSON.stringify({ browserVersion: browser.version(), args, adapter }, null, 2) + '\n');
  console.log(JSON.stringify(adapter.info ?? adapter));
} finally {
  await browser.close();
}
