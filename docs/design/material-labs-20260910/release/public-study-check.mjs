import { withRemoteBrowser } from '/Users/commander/Documents/ChatGPT/theguardian/browserless/connect.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const study = process.argv[2] || 'worker';
if (!['worker', 'concrete', 'rubber', 'granular', 'plate'].includes(study)) throw new Error('Unexpected study');
const base = process.env.BOX3D_PUBLIC_URL || 'https://box3d-web-production.up.railway.app/';
if (!['https://box3d-web-production.up.railway.app/', 'https://box3d.apxlabs.parts/'].includes(base)) throw new Error('Unexpected public origin');
const output = fileURLToPath(new URL('.', import.meta.url));
const receipt = { at: new Date().toISOString(), provider: 'Browserless', owner: '01a07e7b-23c9-72e1-a62e-b780ac76623f', study, base, publicDeploymentOnly: true, privateTransport: false, errors: [], workers: [] };
try {
  await withRemoteBrowser({ owner: receipt.owner, sessionTimeoutMs: 80000, acquireTimeoutMs: 120000, viewport: { width: 1180, height: 760 } }, async ({ context }) => {
    const page = await context.newPage();
    page.on('pageerror', error => receipt.errors.push(error.message));
    page.on('worker', worker => receipt.workers.push(worker.url()));
    if (study === 'worker') {
      await page.goto(base + 'health', { waitUntil: 'domcontentloaded', timeout: 20000 });
      receipt.result = await page.evaluate(async () => {
        const worker = new Worker('/assets/studio-worker-CiVNd5Bm.js', { type: 'module' });
        let id = 0;
        const ask = body => new Promise((resolve, reject) => {
          const request = { v: 1, id: ++id, generation: 1, ...body };
          const timer = setTimeout(() => reject(new Error('Worker response timed out')), 10000);
          worker.onmessage = ({ data }) => { if (data.id !== request.id) return; clearTimeout(timer); data.type === 'error' ? reject(new Error(data.message)) : resolve(data); };
          worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          worker.postMessage(request);
        });
        try {
          const ready = await ask({ type: 'create', options: { study: 'plate', controls: { targetLoad: 4, strength: 1 } } });
          const snapshot = await ask({ type: 'step', request: { ticks: 120, commands: [] } });
          const checkpoint = await ask({ type: 'checkpoint' });
          const result = { readyType: ready.type, model: ready.capabilities.models[0], tick: snapshot.data.tick, completedTicks: snapshot.data.completedTicks, time: snapshot.data.liveSnapshot.response.time, phase: snapshot.data.liveSnapshot.response.phase, positions: snapshot.data.liveSnapshot.positions.length, typedArray: snapshot.data.liveSnapshot.positions instanceof Float32Array, finite: snapshot.data.liveSnapshot.positions.every(Number.isFinite), checkpointType: checkpoint.type };
          const disposed = await ask({ type: 'dispose' }); result.disposed = disposed.type;
          return result;
        } finally { worker.terminate(); }
      });
      if (receipt.result.tick !== 120 || !receipt.result.finite || !receipt.result.typedArray || receipt.result.disposed !== 'disposed') throw new Error('Public worker verification failed');
    } else {
      await page.goto(base + '?studio=' + study + (study === 'plate' ? '&quality=balanced' : ''), { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForFunction(study => study === 'plate' ? document.querySelector('[data-render-ready="true"][data-simulation-mode="worker"]') && document.querySelectorAll('select[aria-label="Study"] option').length === 8 : document.querySelector(`.material-studio[data-study="${study}"][data-render-ready="true"]`), study, { timeout: 40000 });
      receipt.result = await page.evaluate(() => ({ title: document.title, url: location.href, ready: document.querySelector('[data-render-ready]')?.dataset.renderReady, renderer: (document.querySelector('#renderer-status') || document.querySelector('#engine-label'))?.textContent, simulationMode: document.querySelector('[data-simulation-mode]')?.dataset.simulationMode, phase: (document.querySelector('#phase') || document.querySelector('#phase-label'))?.textContent, studies: document.querySelectorAll('select[aria-label="Study"] option').length, experiments: document.querySelectorAll('[data-experiment]').length, canvas: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })), overflow: document.documentElement.scrollWidth > innerWidth, legacyLinks: document.querySelectorAll('a[href*="workbench=1"]').length }));
      if (receipt.result.studies !== 8 || receipt.result.overflow || receipt.result.legacyLinks || !receipt.result.canvas.length) throw new Error('Public study verification failed');
      await page.screenshot({ path: output + `public-${study}.jpg`, type: 'jpeg', quality: 65 });
      if (study === 'granular') {
        await page.setViewportSize({ width: 390, height: 844 });
        receipt.mobile = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
        if (receipt.mobile.overflow) throw new Error('Phone viewport overflows');
        await page.screenshot({ path: output + 'public-mobile.jpg', type: 'jpeg', quality: 65 });
      }
    }
  });
  receipt.cleanup = 'Shared helper returned after closing the remote context and browser';
  receipt.pass = receipt.errors.length === 0;
} catch (error) { receipt.pass = false; receipt.error = error.message; }
await writeFile(output + `public-${study}-check.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.pass) process.exitCode = 1;
