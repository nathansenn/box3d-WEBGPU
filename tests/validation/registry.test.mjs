// Tests of the validation registry (validation/) and its report generator (scripts/validation-report.mjs).
// The numbers themselves are checked by `npm run validation:check`; this file checks the machinery:
// the registry is well formed, every case names a test that exists, the generator is deterministic,
// and --check catches a tampered or stale number. Nothing here asserts on wall-clock time.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DOMAINS, CASES, selectCases, needsKit} from '../../validation/registry.mjs';
import * as report from '../../validation/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/validation-report.mjs'), ...args], {cwd: root, encoding: 'utf8'});
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-validation-'));

test('the registry is well formed: unique ids, complete cases, known domains', () => {
  assert.ok(CASES.length >= 60, `the report covers at least 60 cases (has ${CASES.length})`);
  const ids = new Set(), domains = new Map(DOMAINS.map(domain => [domain.id, domain]));
  assert.equal(domains.size, DOMAINS.length, 'domain ids are unique');
  for (const one of CASES) {
    assert.match(one.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, `${one.id}: ids are lower-case words joined by dots and hyphens`);
    assert.ok(!ids.has(one.id), `${one.id}: duplicate id`);
    ids.add(one.id);
    assert.ok(domains.has(one.domain), `${one.id}: unknown domain ${one.domain}`);
    for (const key of ['title', 'quantity', 'unit']) assert.ok(typeof one[key] === 'string' && one[key].trim().length > 0, `${one.id}: ${key}`);
    assert.ok(typeof one.reference.formula === 'string' && one.reference.formula.length > 2, `${one.id}: the reference formula is text`);
    // null means "computed from a number the solver reports"; measure() then returns {value, reference}.
    assert.ok(one.reference.value === null || Number.isFinite(one.reference.value), `${one.id}: the reference value is a number or null`);
    assert.ok(['relative', 'absolute', 'upper', 'lower'].includes(one.tolerance.kind), `${one.id}: tolerance kind`);
    assert.ok(Number.isFinite(one.tolerance.value) && one.tolerance.value >= 0, `${one.id}: tolerance value`);
    if (one.tolerance.kind === 'relative') assert.notEqual(one.reference.value, 0, `${one.id}: a relative tolerance needs a reference that is not zero`);
    assert.equal(typeof one.measure, 'function', `${one.id}: measure()`);
    if (one.note !== undefined) assert.ok(typeof one.note === 'string' && one.note.length > 10, `${one.id}: note`);
    assert.doesNotMatch([one.title, one.quantity, one.reference.formula, one.note ?? ''].join(' '), /[\n`]/, `${one.id}: text must fit a table cell`);
  }
  for (const domain of DOMAINS) {
    const own = CASES.filter(one => one.domain === domain.id);
    assert.ok(own.length >= 3, `${domain.id}: has cases`);
    for (const key of ['title', 'summary', 'solver']) assert.ok(typeof domain[key] === 'string' && domain[key].length > 5, `${domain.id}: ${key}`);
    assert.ok(domain.notValidated.length >= 3 && domain.notValidated.every(line => typeof line === 'string' && line.length > 20), `${domain.id}: says what is not validated`);
    assert.ok(domain.docs.length >= 1, `${domain.id}: names its document`);
    for (const doc of domain.docs) assert.ok(fs.existsSync(path.join(root, doc)), `${domain.id}: ${doc} exists`);
    assert.equal(typeof domain.needsKit, 'boolean');
  }
  // Cases are grouped by domain in the order of DOMAINS, which is the order of the report.
  assert.deepEqual([...new Set(CASES.map(one => one.domain))], DOMAINS.map(domain => domain.id));
  assert.deepEqual(selectCases(['heat']).map(one => one.domain).filter(id => id !== 'heat'), []);
  assert.equal(needsKit(selectCases(['heat', 'solid', 'frame', 'cable', 'closed-water'])), false, 'the engine domains need no kit build');
  assert.equal(needsKit(selectCases(['rigid'])), true);
  assert.throws(() => selectCases(['nope']), /Unknown domain/);
});

test('every case names a test file that exists and a test in it', () => {
  const texts = new Map();
  for (const one of CASES) {
    const {file, test: name} = one.source;
    assert.ok(/^(tests|packages\/box3d-kit\/test)\/[\w./-]+\.test\.mjs$/.test(file), `${one.id}: ${file} is a test file`);
    if (!texts.has(file)) { assert.ok(fs.existsSync(path.join(root, file)), `${one.id}: ${file} exists`); texts.set(file, read(file)); }
    const declared = ["'", '"', '`'].some(quote => texts.get(file).includes(`test(${quote}${name}${quote}`));
    assert.ok(declared, `${one.id}: ${file} has no test named "${name}"`);
  }
  // The files the registry draws on run in a gate (the kit files through the kit's own gate list).
  const kitGate = read('packages/box3d-kit/scripts/test-gate.mjs'), scripts = JSON.parse(read('package.json')).scripts;
  for (const file of texts.keys()) {
    if (file.startsWith('packages/box3d-kit/')) assert.ok(kitGate.includes(`'${file.replace('packages/box3d-kit/', '')}'`), `${file} runs in the kit gate`);
    else assert.ok(Object.values(scripts).some(command => command.includes(file) || command.includes('tests/engine/*.test.mjs')), `${file} runs from an npm script`);
  }
});

test('tolerances, rounding and number formatting', () => {
  const {passes, round, formatNumber, formatTolerance, formatError} = report;
  assert.equal(passes({kind: 'relative', value: 0.01}, 100, 100.99), true);
  assert.equal(passes({kind: 'relative', value: 0.01}, 100, 101.01), false);
  assert.equal(passes({kind: 'relative', value: 0.01}, -100, -99.5), true);
  assert.equal(passes({kind: 'absolute', value: 0.5}, 2, 1.5), true);
  assert.equal(passes({kind: 'absolute', value: 0.5}, 2, 2.51), false);
  assert.equal(passes({kind: 'absolute', value: 0}, 0, 0), true);
  assert.equal(passes({kind: 'upper', value: 0}, 0, -3), true, 'upper: below the reference always passes');
  assert.equal(passes({kind: 'upper', value: 0}, 0, 1e-300), false);
  assert.equal(passes({kind: 'upper', value: 1e-3}, 0, 9e-4), true);
  assert.equal(passes({kind: 'lower', value: 0.25}, 2, 1.76), true);
  assert.equal(passes({kind: 'lower', value: 0.25}, 2, 1.74), false);
  assert.equal(passes({kind: 'lower', value: 0.25}, 2, 9), true, 'lower: above the reference always passes');
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(passes({kind: 'absolute', value: 1e9}, 0, bad), false, 'a non-finite measurement never passes');
  assert.throws(() => passes({kind: 'about', value: 1}, 0, 0), RangeError);
  assert.equal(round(Math.PI), 3.14159265);
  assert.equal(round(-1 / 3e9), -3.33333333e-10);
  assert.equal(round(NaN), null);
  assert.equal(formatNumber(2.8401988723), '2.840199');
  assert.equal(formatNumber(25000), '25000');
  assert.equal(formatNumber(-1.2e8), '-1.2e8');
  assert.equal(formatNumber(5.684342e-14), '5.684342e-14');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(null), 'n/a');
  assert.equal(formatTolerance({kind: 'relative', value: 0.01}), '±1%');
  assert.equal(formatTolerance({kind: 'relative', value: 1e-5}), '±1e-5 rel.');
  assert.equal(formatTolerance({kind: 'absolute', value: 0.006}), '±0.006');
  assert.equal(formatTolerance({kind: 'upper', value: 0}), 'not above the reference');
  assert.equal(formatTolerance({kind: 'lower', value: 0.25}), 'at most 0.25 below the reference');
  assert.equal(formatError({tolerance: {kind: 'relative'}, error: -0.28, relativeError: -0.0028}), '-0.28%');
  assert.equal(formatError({tolerance: {kind: 'relative'}, error: 1e-6, relativeError: 5.67e-7}), '+5.67e-7 rel.');
  assert.equal(formatError({tolerance: {kind: 'absolute'}, error: -0.0102, relativeError: -1e-4}), '-0.0102');
  assert.equal(formatError({tolerance: {kind: 'absolute'}, error: null, relativeError: null}), 'n/a');
});

// Synthetic cases: one that passes, one that misses its tolerance, one that throws, one with a solver-supplied reference.
const domain = {id: 'demo', title: 'Demo', summary: 'Synthetic cases.', solver: '`none`', docs: ['README.md'], notValidated: ['Everything: these are synthetic.'], needsKit: false};
const synthetic = (overrides = {}) => [
  {id: 'demo.pass', domain: 'demo', title: 'Passes', quantity: 'a number', unit: 'm', reference: {formula: 'x = 1', value: 1}, tolerance: {kind: 'relative', value: 0.01}, measure: () => 1.001, source: {file: 'tests/validation/registry.test.mjs', test: 'x'}, ...overrides.pass},
  {id: 'demo.miss', domain: 'demo', title: 'Misses', quantity: 'a number', unit: '1', reference: {formula: 'x = 0', value: 0}, tolerance: {kind: 'absolute', value: 0.5}, measure: async () => 0.75, note: 'A note that is long enough.', source: {file: 'tests/validation/registry.test.mjs', test: 'x'}},
  {id: 'demo.throws', domain: 'demo', title: 'Throws', quantity: 'a number', unit: 'N', reference: {formula: 'x = 2', value: 2}, tolerance: {kind: 'absolute', value: 1}, measure: () => { throw new Error('solver failed\nsecond line'); }, source: {file: 'tests/validation/registry.test.mjs', test: 'x'}},
  {id: 'demo.solver-reference', domain: 'demo', title: 'Reference from the solver', quantity: 'a number', unit: 'kg', reference: {formula: 'm = m_reported', value: null}, tolerance: {kind: 'relative', value: 1e-6}, measure: () => ({value: 65.4498469, reference: 65.4498444}), source: {file: 'tests/validation/registry.test.mjs', test: 'x'}},
];

test('running cases: pass, miss, exception and solver-supplied reference; the report is a pure function of the rows', async () => {
  const rows = await report.runCases(synthetic());
  assert.deepEqual(rows.map(row => row.pass), [true, false, false, true]);
  assert.equal(rows[0].relativeError, 0.001);
  assert.equal(rows[1].relativeError, null, 'no relative error against zero');
  assert.equal(rows[2].measured, null);
  assert.equal(rows[2].failure, 'solver failed', 'the first line of the error is kept');
  assert.equal(rows[3].reference, 65.4498444, 'the reference the solver supplied is the one reported');
  const built = report.buildReport([domain, {...domain, id: 'unused'}], rows);
  assert.deepEqual(built.totals, {cases: 4, passed: 2, failed: 2, domains: 1});
  assert.deepEqual(built.domains.map(d => [d.id, d.cases, d.passed]), [['demo', 4, 2]]);
  assert.equal(built.schema, report.SCHEMA);
  assert.equal(built.version, report.SCHEMA_VERSION);
  const json = report.renderJson(built), markdown = report.renderMarkdown(built);
  assert.equal(report.renderJson(report.buildReport([domain], await report.runCases(synthetic()))), json, 'the same cases give the same JSON');
  assert.equal(report.renderMarkdown(JSON.parse(json)), markdown, 'the Markdown is a function of the JSON alone');
  assert.match(markdown, /4 cases in 1 domains\. 2 pass their tolerance, \*\*2 fail\*\*\./);
  assert.match(markdown, /\| Misses \| `x = 0` = 0 \| 0\.75 \| \+0\.75 \| ±0\.5 \| \*\*FAIL\*\* \|/);
  assert.match(markdown, /### What is not validated: demo/);
  assert.doesNotMatch(json + markdown, /\d{4}-\d{2}-\d{2}T|\b(linux|darwin|win32|x64|arm64)\b/, 'no timestamp, platform or machine name');
  assert.deepEqual(report.compareReports(JSON.parse(json), built), []);
});

test('comparing a committed report with a fresh one: rounding slack, and every kind of tampering', async () => {
  const fresh = report.buildReport([domain], await report.runCases(synthetic()));
  const committed = () => JSON.parse(report.renderJson(fresh));
  const problems = change => { const old = committed(); change(old); return report.compareReports(old, fresh); };
  const retext = row => { row.text = report.rowText(row); };
  assert.deepEqual(problems(() => {}), []);
  // Inside the stated rounding: 5e-9 relative.
  assert.deepEqual(problems(old => { old.cases[0].measured = 1.001 * (1 + 2e-9); retext(old.cases[0]); }), []);
  // Outside it.
  assert.match(problems(old => { old.cases[0].measured = 1.0011; retext(old.cases[0]); }).join('\n'), /demo\.pass: measured is 1\.001, committed 1\.0011/);
  assert.match(problems(old => { old.cases[3].reference = 65.45; retext(old.cases[3]); }).join('\n'), /demo\.solver-reference: reference/);
  assert.match(problems(old => { old.cases[1].pass = true; }).join('\n'), /demo\.miss: its description, source or result changed/);
  assert.match(problems(old => { old.cases[1].tolerance.value = 1; }).join('\n'), /demo\.miss: its tolerance changed/);
  assert.match(problems(old => { old.cases[0].tolerance.kind = 'absolute'; }).join('\n'), /demo\.pass: its tolerance changed/);
  assert.match(problems(old => { old.cases[0].text.measured = '1'; }).join('\n'), /demo\.pass: the committed text does not match the committed numbers/);
  assert.match(problems(old => { old.cases[0].source.test = 'other'; }).join('\n'), /demo\.pass: its description, source or result changed/);
  assert.match(problems(old => { old.cases.pop(); }).join('\n'), /demo\.solver-reference: not in the committed report/);
  assert.match(problems(old => { old.cases.push({...old.cases[0], id: 'demo.gone'}); }).join('\n'), /demo\.gone: in the committed report but no longer a case/);
  assert.match(problems(old => { old.cases.reverse(); }).join('\n'), /order of the cases changed/);
  assert.match(problems(old => { old.domains[0].notValidated.push('edited'); }).join('\n'), /domain descriptions or the report header changed/);
  assert.match(problems(old => { old.version = 99; }).join('\n'), /not box3d-validation version 1/);
  assert.match(report.compareReports(null, fresh).join('\n'), /not box3d-validation version 1/);

  // Round-off rule: a defect against zero that is under a thousandth of its tolerance may differ between machines.
  const defect = value => report.buildReport([domain], [report.resultRow({...synthetic()[1], tolerance: {kind: 'upper', value: 1e-9}}, 0, value)]);
  assert.deepEqual(report.compareReports(JSON.parse(report.renderJson(defect(2.3e-16))), defect(3.4e-16)), [], 'two round-off defects agree');
  assert.match(report.compareReports(JSON.parse(report.renderJson(defect(2.3e-16))), defect(3.4e-11)).join('\n'), /measured is 3\.4e-11, committed 2\.3e-16/);
  assert.match(report.compareReports(JSON.parse(report.renderJson(defect(2e-10))), defect(2.1e-10)).join('\n'), /measured/, 'a defect that is a real share of the tolerance must reproduce');
});

test('the committed report lists the registry\'s cases, and the Markdown is what the JSON renders to', () => {
  const committed = JSON.parse(read('public/validation/validation.json'));
  assert.equal(committed.schema, report.SCHEMA);
  assert.equal(committed.version, report.SCHEMA_VERSION);
  assert.deepEqual(committed.cases.map(row => row.id), CASES.map(one => one.id), 'run node scripts/validation-report.mjs after adding or removing a case');
  assert.deepEqual(committed.totals, {cases: CASES.length, passed: committed.cases.filter(row => row.pass).length, failed: committed.cases.filter(row => !row.pass).length, domains: DOMAINS.length});
  assert.equal(committed.totals.failed, 0, 'no published case fails its tolerance');
  assert.equal(read('docs/VALIDATION.md'), report.renderMarkdown(committed));
  for (const row of committed.cases) {
    assert.equal(row.source.url, `https://github.com/nathansenn/box3d-WEBGPU/blob/main/${row.source.file}`, `${row.id}: links to its test on GitHub`);
    assert.deepEqual(row.text, report.rowText(row), `${row.id}: printed numbers`);
    assert.equal(row.pass, report.passes(row.tolerance, row.reference, row.measured), `${row.id}: the published verdict follows from the published numbers`);
  }
});

test('the generator is deterministic, and --check detects a failing case, a tampered number and a stale document', () => {
  const dir = scratch(), json = path.join(dir, 'validation.json'), docs = path.join(dir, 'VALIDATION.md'), again = path.join(dir, 'again');
  const kitBuilt = () => fs.existsSync(path.join(root, 'packages/box3d-kit/dist')), builtBefore = kitBuilt();
  try {
    // The engine-only domains need no kit build, so this runs real solvers without touching packages/box3d-kit.
    const only = ['--only', 'heat,frame'], files = ['--json', json, '--docs', docs];
    const first = cli(...only, ...files);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const second = cli(...only, '--json', path.join(again, 'validation.json'), '--docs', path.join(again, 'VALIDATION.md'));
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.equal(fs.readFileSync(path.join(again, 'validation.json'), 'utf8'), fs.readFileSync(json, 'utf8'), 'two runs write identical JSON');
    assert.equal(fs.readFileSync(path.join(again, 'VALIDATION.md'), 'utf8'), fs.readFileSync(docs, 'utf8'), 'two runs write identical Markdown');
    const written = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.deepEqual(written.domains.map(d => d.id), ['heat', 'frame']);
    assert.equal(written.cases.length, selectCases(['heat', 'frame']).length);

    const check = () => cli('--check', ...only, ...files);
    const clean = check();
    assert.equal(clean.status, 0, clean.stderr + clean.stdout);
    assert.match(clean.stdout, /The committed validation report matches this run\./);
    const before = fs.readFileSync(json, 'utf8'), markdown = fs.readFileSync(docs, 'utf8');

    // A number edited in the JSON (and its printed text with it): the erfc order 2.000849 becomes 2.5.
    const edited = JSON.parse(before), target = edited.cases.find(row => row.id === 'heat.erfc.order.crank-nicolson');
    assert.ok(Math.abs(target.measured - 2) < 0.05, 'the measured order is near 2');
    target.measured = 2.5; target.error = 0.5; target.relativeError = 0.25; target.text = report.rowText(target);
    fs.writeFileSync(json, report.renderJson(edited)); fs.writeFileSync(docs, report.renderMarkdown(edited));
    const tampered = check();
    assert.equal(tampered.status, 1, 'a tampered number fails the check');
    assert.match(tampered.stderr, /heat\.erfc\.order\.crank-nicolson: measured is 2\.0\d+, committed 2\.5/);
    assert.match(tampered.stderr, /stale or were edited/);

    // The Markdown edited by hand while the JSON is right.
    fs.writeFileSync(json, before); fs.writeFileSync(docs, markdown.replace('| pass |', '| pass (trust me) |'));
    const stale = check();
    assert.equal(stale.status, 1, 'a document that is not what the JSON renders to fails the check');
    assert.match(stale.stderr, /VALIDATION\.md is not what .*validation\.json renders to/);

    // A published file that is missing, and one that is not JSON.
    fs.rmSync(docs);
    assert.equal(check().status, 1);
    fs.writeFileSync(docs, markdown); fs.writeFileSync(json, '{');
    const broken = check();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /not valid JSON/);
    fs.writeFileSync(json, before);
    assert.equal(check().status, 0, 'restored files pass again');

    // A case that misses its tolerance fails both modes, even when the committed files agree with the run.
    const registry = path.join(dir, 'registry.mjs');
    fs.writeFileSync(registry, `
      const source = {file: 'tests/validation/registry.test.mjs', test: 'x'};
      export const DOMAINS = [{id: 'demo', title: 'Demo', summary: 'Synthetic.', solver: 'none', docs: [], notValidated: ['Everything.'], needsKit: false}];
      const CASES = [{id: 'demo.miss', domain: 'demo', title: 'Misses', quantity: 'a number', unit: '1', reference: {formula: 'x = 0', value: 0}, tolerance: {kind: 'absolute', value: 0.5}, measure: () => 0.75, source}];
      export const selectCases = () => CASES;
      export const needsKit = () => false;
    `);
    const failing = cli('--registry', registry, ...files);
    assert.equal(failing.status, 1, 'a failing case fails the run');
    assert.match(failing.stdout, /FAIL demo\.miss: measured 0\.75, reference 0, tolerance ±0\.5/);
    assert.match(failing.stdout, /0 of 1 cases pass\./);
    const failingCheck = cli('--check', '--registry', registry, ...files);
    assert.equal(failingCheck.status, 1, 'a failing case fails the check although the files match');
    assert.match(failingCheck.stdout, /The committed validation report matches this run\./);

    assert.equal(cli('--only', 'nope').status, 1);
    assert.equal(cli('--bogus').status, 1);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  assert.equal(kitBuilt(), builtBefore, 'runs of the engine-only domains neither build nor clean the kit');
});

test('the page is static, self-contained and reads the JSON next to it', () => {
  const html = read('public/validation/index.html'), script = read('public/validation/validation.js'), css = read('public/validation/validation.css');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/, 'no inline or evaluated script');
  assert.match(policy, /style-src 'self'(;|$)/, 'no inline style');
  assert.doesNotMatch(policy, /unsafe|\*|https?:/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc="\.\/validation\.js")|<style|\sstyle=|\son[a-z]+=/, 'no inline script, style or handler');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(/^(\.\.?\/|#)/.test(url) || url.startsWith('https://github.com/nathansenn/box3d-WEBGPU'), `${url}: relative, or a link to the repository`);
  }
  for (const text of [script, css]) assert.doesNotMatch(text, /https?:\/\/(?!github\.com\/nathansenn\/box3d-WEBGPU)|@import|url\(/, 'no request to another origin');
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, 'the JSON is drawn as text nodes');
  assert.match(script, /new URL\('\.\/validation\.json', import\.meta\.url\)/);
  assert.match(script, new RegExp(`SCHEMA = '${report.SCHEMA}', VERSION = ${report.SCHEMA_VERSION}\\b`), 'the page reads the schema version the generator writes');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(script, /scope: 'col'/); assert.match(script, /scope: 'row'/); assert.match(script, /el\('caption'/);
  // The applications link to it.
  assert.match(read('lab.html'), /<a href="\.\/validation\/">Validation<\/a>/);
  assert.match(read('index.html'), /<a href="\.\/validation\/">validation report<\/a>/);
  assert.match(read('README.md'), /docs\/VALIDATION\.md/);
});
