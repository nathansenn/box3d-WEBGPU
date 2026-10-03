import fs from 'node:fs/promises';
import { withRemoteBrowser, leaseStatus } from '/Users/commander/Documents/ChatGPT/theguardian/browserless/connect.mjs';

const origin = 'https://box3d.apxlabs.parts/';
const owner = '01a07e7b-23c9-72e1-a62e-b780ac76623f';
const output = new URL('./rendered-check.json', import.meta.url);
const expectedStudies = ['liquid', 'glass', 'concrete', 'rubber', 'granular', 'plate', 'canopy', 'bridge'];
let report = { at: new Date().toISOString(), provider: 'Existing Browserless shared lease helper', owner, url: origin, captures: 0, scope: 'Public rendered SEO and responsive DOM sample; no physics suite, private fixture or native performance claim.' };

try {
  report.rendered = await withRemoteBrowser({ owner, sessionTimeoutMs: 90000, acquireTimeoutMs: 120000, viewport: { width: 1280, height: 800 } }, async ({ context }) => {
    const page = await context.newPage();
    const pageErrors = [], failedRequests = [], consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
    page.on('requestfailed', request => { if (request.url().startsWith(origin)) failedRequests.push({ url: request.url(), error: request.failure()?.errorText }); });
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-render-ready="true"]', { timeout: 45000 });
    await page.waitForSelector('select[aria-label="Study"] option[value="bridge"]', { state: 'attached', timeout: 10000 });
    const describe = () => page.evaluate(() => ({
      title: document.title,
      canonical: [...document.querySelectorAll('link[rel="canonical"]')].map(node => node.href),
      description: document.querySelector('meta[name="description"]')?.content,
      robots: document.querySelector('meta[name="robots"]')?.content,
      ogUrl: document.querySelector('meta[property="og:url"]')?.content,
      schemaTypes: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'].map(node => node['@type']),
      h1: [...document.querySelectorAll('h1')].map(node => node.textContent.trim()),
      studies: [...document.querySelectorAll('select[aria-label="Study"] option')].map(node => node.value),
      study: document.querySelector('#studio')?.dataset.study,
      renderReady: document.querySelector('#studio')?.dataset.renderReady,
      runEnabled: !document.querySelector('[data-action="run"]')?.disabled,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: [...document.querySelectorAll('canvas')].map(node => ({ width: node.width, height: node.height })),
      modelNotice: document.querySelector('.model-note')?.textContent,
      studyLinks: [...document.querySelectorAll('.other-studies a')].map(node => node.getAttribute('href')),
    }));
    const desktop = await describe();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => innerWidth === 390 && document.documentElement.scrollWidth <= 390, undefined, { timeout: 10000 });
    const mobile = await describe();

    const noScriptContext = await context.browser().newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    let initial;
    try {
      const noScript = await noScriptContext.newPage();
      await noScript.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20000 });
      initial = await noScript.evaluate(() => ({
        h1: [...document.querySelectorAll('h1')].map(node => node.textContent.trim()),
        text: document.querySelector('main')?.innerText,
        studyLinks: [...document.querySelectorAll('a[href^="/?studio="]')].map(node => node.getAttribute('href')),
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        loadingMessageHidden: getComputedStyle(document.getElementById('boot-status')).display === 'none',
        image: [...document.querySelectorAll('img')].map(node => ({ alt: node.alt, width: node.width, height: node.height })),
      }));
    } finally {
      await noScriptContext.close();
    }
    const checks = {
      successfulPage: response.status() === 200,
      runtimeReady: [desktop, mobile].every(view => view.renderReady === 'true' && view.study === 'liquid' && view.runEnabled && view.canvas.some(canvas => canvas.width > 0 && canvas.height > 0)),
      stableCanonicalAndSchema: [desktop, mobile].every(view => view.canonical.length === 1 && view.canonical[0] === origin && view.ogUrl === origin && view.schemaTypes.join(',') === 'WebSite,WebApplication'),
      usefulRenderedTitleAndHeading: [desktop, mobile].every(view => view.title === 'BOX3D — Liquid dynamics' && view.h1.length === 1 && view.h1[0] === 'Liquid dynamics'),
      navigationCoverage: [desktop, mobile].every(view => JSON.stringify([...view.studies].sort()) === JSON.stringify([...expectedStudies].sort()) && view.studyLinks.length === 7),
      noHorizontalOverflow: [desktop, mobile, initial].every(view => view.scrollWidth <= view.width),
      actualNoScriptContent: initial.h1.join('') === 'BOX3D Engineering Studio' && initial.studyLinks.length === 8 && initial.text.includes('Enable JavaScript') && initial.text.includes('uncalibrated') && initial.loadingMessageHidden,
      modelLimitsVisible: desktop.modelNotice.includes('not calibrated material-test data'),
      noRuntimeErrors: pageErrors.length === 0 && failedRequests.length === 0 && consoleErrors.length === 0,
    };
    return { pass: Object.values(checks).every(Boolean), checks, desktop, mobile, noScript: initial, pageErrors, failedRequests, consoleErrors };
  });
  report.pass = report.rendered.pass;
} catch (error) {
  report.pass = false;
  report.error = String(error.message || error);
}
report.cleanup = { helperReturned: true, ownLeaseRemaining: leaseStatus().leases.filter(lease => lease.owner === owner).length };
report.pass &&= report.cleanup.ownLeaseRemaining === 0;
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: report.pass, checks: report.rendered?.checks, error: report.error, cleanup: report.cleanup, output: output.pathname }, null, 2));
process.exitCode = report.pass ? 0 : 1;
