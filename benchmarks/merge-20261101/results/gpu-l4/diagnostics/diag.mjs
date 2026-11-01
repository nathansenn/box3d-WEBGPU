// Which Chrome flag set exposes a hardware WebGPU adapter on this host? Probes a secure (127.0.0.1) page.
// usage: node diag.mjs <playwright-core index.mjs> <chrome executable> <out dir> <url>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pwPath, chrome, out, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(pwPath).href);
const base = ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist'];
const variants = {
  'base': base,
  'base+developer-features': [...base, '--enable-webgpu-developer-features'],
  'base+use-vulkan-native': [...base, '--use-vulkan=native'],
  'base+no-quantization': [...base, '--disable-dawn-features=timestamp_quantization'],
  'merged-feature-switch': ['--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan,CDPScreenshotNewSurface', '--disable-vulkan-surface', '--ignore-gpu-blocklist'],
  'no-angle-vulkan': ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  'webgpu-only': ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
};
const results = {};
for (const [name, args] of Object.entries(variants)) {
  const browser = await chromium.launch({ headless: true, executablePath: chrome, args });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const probe = await page.evaluate(async () => {
      const describe = async (options) => {
        try {
          const a = await navigator.gpu?.requestAdapter(options);
          if (!a) return null;
          const info = a.info ?? {};
          return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter, featureLevel: a.featureLevel ?? null, timestampQuery: a.features.has('timestamp-query') };
        } catch (e) { return { error: String(e) }; }
      };
      return {
        secure: window.isSecureContext, hasGpu: !!navigator.gpu,
        default: await describe(undefined),
        highPerformance: await describe({ powerPreference: 'high-performance' }),
        compatibility: await describe({ featureLevel: 'compatibility' }),
      };
    });
    await page.goto('chrome://gpu', { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    const text = await page.evaluate(() => (document.querySelector('info-view')?.shadowRoot ?? document).textContent ?? '');
    const dawn = text.slice(text.indexOf('Dawn Info'), text.indexOf('Dawn Info') + 200000).split(/(?=<[A-Za-z ]+>\s+[A-Za-z]+ backend - )/).slice(1).map((s) => s.slice(0, 160));
    results[name] = { args, probe, dawnAdapters: dawn };
    console.log(name, JSON.stringify(probe.highPerformance ?? probe.default), dawn.length);
  } catch (e) {
    results[name] = { args, error: String(e) };
    console.log(name, 'error', String(e));
  } finally {
    await browser.close();
  }
}
fs.writeFileSync(path.join(out, 'webgpu-flag-diagnosis.json'), JSON.stringify(results, null, 2) + '\n');
