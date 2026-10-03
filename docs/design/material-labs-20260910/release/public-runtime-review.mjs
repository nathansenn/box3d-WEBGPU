import { withRemoteBrowser } from '/Users/commander/Documents/ChatGPT/theguardian/browserless/connect.mjs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = process.env.BOX3D_PUBLIC_URL || 'https://box3d-web-production.up.railway.app/';
if (!['https://box3d-web-production.up.railway.app/', 'https://box3d.apxlabs.parts/'].includes(base)) throw new Error('Unexpected review origin');
const output = fileURLToPath(new URL('.', import.meta.url));
const receipt = { at: new Date().toISOString(), provider: 'Browserless', owner: '01a07e7b-23c9-72e1-a62e-b780ac76623f', base, publicDeploymentOnly: true, localBuildTransport: false, studies: [], errors: [], failedRequests: [], httpFailures: [], workers: [] };
try {
  await withRemoteBrowser({ owner: receipt.owner, sessionTimeoutMs: 100000, acquireTimeoutMs: 120000, viewport: { width: 1280, height: 800 } }, async ({ context }) => {
    const page = await context.newPage();
    page.on('pageerror', e => receipt.errors.push(e.message));
    page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) receipt.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }); });
    page.on('response', r => { if (r.status() >= 400) receipt.httpFailures.push({ url: r.url(), status: r.status() }); });
    page.on('worker', w => receipt.workers.push(w.url()));
    for (const id of ['liquid', 'glass', 'concrete', 'rubber', 'granular']) {
      if (id === 'liquid') await page.goto(base + '?studio=liquid', { waitUntil: 'domcontentloaded', timeout: 25000 });
      else await page.getByRole('combobox', { name: 'Study', exact: true }).selectOption(id);
      await page.waitForFunction(id => document.querySelector(`.material-studio[data-study="${id}"][data-render-ready="true"]`), id, { timeout: 25000 });
      if (id === 'liquid') {
        await page.locator('.lab-run').click();
        await page.waitForFunction(() => parseFloat(document.querySelector('#scene-time')?.textContent) >= .5, null, { timeout: 12000 });
        await page.locator('.lab-run').click();
        const downloaded = page.waitForEvent('download', { timeout: 12000 });
        await page.getByRole('button', { name: 'Export run data', exact: true }).click();
        const download = await downloaded;
        const stream = await download.createReadStream();
        if (!stream) throw new Error('Export download has no readable content');
        const chunks = []; let bytes = 0;
        for await (const chunk of stream) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error('Unexpectedly large bounded export'); chunks.push(chunk); }
        const buffer = Buffer.concat(chunks), data = JSON.parse(buffer.toString());
        receipt.export = { filename: download.suggestedFilename(), bytes, sha256: createHash('sha256').update(buffer).digest('hex'), format: data.format, study: data.study, calibrated: data.calibrated, frames: data.frames.length, lastTime: data.frames.at(-1)?.time, settings: data.settings, finitePositions: data.frames.every(f => f.positions.every(Number.isFinite)) };
        if (data.format !== 'box3d-material-study-v1' || data.frames.length < 2 || !receipt.export.finitePositions) throw new Error('Export validation failed');
      }
      const state = await page.evaluate(() => ({ title: document.title, url: location.href, id: document.querySelector('.material-studio')?.dataset.study, ready: document.querySelector('.material-studio')?.dataset.renderReady, phase: document.querySelector('#phase')?.textContent, time: document.querySelector('#scene-time')?.textContent, renderer: document.querySelector('#renderer-status')?.textContent, studies: document.querySelectorAll('select[aria-label="Study"] option').length, experiments: document.querySelectorAll('[data-experiment]').length, canvas: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })), metrics: [0, 1, 2].map(i => document.querySelector('#metric-' + i)?.textContent), overflow: document.documentElement.scrollWidth > innerWidth, legacyLinks: document.querySelectorAll('a[href*="workbench=1"]').length }));
      if (state.studies !== 8 || state.experiments !== 8 || state.legacyLinks || state.overflow || !state.canvas.some(c => c.width > 10)) throw new Error('Study UI verification failed: ' + id);
      receipt.studies.push(state);
      await page.screenshot({ path: output + `public-${id}.jpg`, type: 'jpeg', quality: 65 });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    receipt.mobile = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth, study: document.querySelector('.material-studio')?.dataset.study }));
    await page.screenshot({ path: output + 'public-mobile.jpg', type: 'jpeg', quality: 65 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('combobox', { name: 'Study', exact: true }).selectOption('plate');
    await page.waitForFunction(() => document.querySelector('#phase-label') && !document.querySelector('.run-button')?.disabled && document.querySelector('#engine-label')?.textContent.includes('worker'), null, { timeout: 30000 });
    await page.locator('.run-button').click();
    await page.waitForFunction(() => parseFloat(document.querySelector('#viewport-time')?.textContent) >= .25, null, { timeout: 12000 });
    await page.locator('.run-button').click();
    receipt.classic = await page.evaluate(() => ({ title: document.title, url: location.href, phase: document.querySelector('#phase-label')?.textContent, time: document.querySelector('#viewport-time')?.textContent, engine: document.querySelector('#engine-label')?.textContent, studies: document.querySelectorAll('select[aria-label="Study"] option').length }));
    await page.screenshot({ path: output + 'public-press.jpg', type: 'jpeg', quality: 65 });
  });
  receipt.cleanup = 'Shared helper returned after closing the remote context and browser';
  receipt.pass = receipt.errors.length === 0 && receipt.failedRequests.length === 0 && receipt.httpFailures.length === 0 && !receipt.mobile.overflow && receipt.workers.some(u => u.endsWith('/studio-worker-CiVNd5Bm.js'));
  receipt.nativeLimit = 'Remote software graphics do not establish physical-device or native GPU performance.';
} catch (error) {
  receipt.pass = false;
  receipt.error = String(error.message);
}
await writeFile(output + 'public-runtime-review.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.pass) process.exitCode = 1;
