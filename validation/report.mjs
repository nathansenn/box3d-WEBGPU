// Runs validation cases and turns the results into the published report.
// Pure functions apart from runCases(): the same results always give the same text.
import {clearMemo} from './lib.mjs';

export const SCHEMA = 'box3d-validation';
export const SCHEMA_VERSION = 1;
export const REPOSITORY = 'https://github.com/nathansenn/box3d-WEBGPU';
/** Numbers are stored with this many significant digits. */
export const DIGITS = 9;
/** A fresh value may differ from the committed one by this fraction of the case's tolerance band ... */
export const CHECK_BAND_FRACTION = 1e-6;
/** ... or by this relative amount (half a unit in the last stored digit), whichever is larger. */
export const CHECK_RELATIVE = 5e-9;
/** A defect measured against a reference of zero counts as round-off below this fraction of its tolerance. */
export const ROUNDOFF_FRACTION = 1e-3;

/** Rounds to DIGITS significant digits. Non-finite numbers become null so the JSON stays valid. */
export const round = value => Number.isFinite(value) ? Number(value.toPrecision(DIGITS)) : null;

/** The acceptance band of a case in the unit of its quantity. */
export function band(tolerance, reference) {
  return tolerance.kind === 'relative' ? tolerance.value * Math.abs(reference) : tolerance.value;
}
/** True when `measured` meets the tolerance against `reference`. */
export function passes(tolerance, reference, measured) {
  if (!Number.isFinite(measured) || !Number.isFinite(reference)) return false;
  const error = measured - reference;
  if (tolerance.kind === 'relative') return Math.abs(error) <= tolerance.value * Math.abs(reference);
  if (tolerance.kind === 'absolute') return Math.abs(error) <= tolerance.value;
  if (tolerance.kind === 'upper') return error <= tolerance.value;
  if (tolerance.kind === 'lower') return -error <= tolerance.value;
  throw new RangeError(`Unknown tolerance kind ${tolerance.kind}`);
}

/** Runs each case in order and returns one result row per case. A case that throws is a failed row. */
export async function runCases(cases, {onResult} = {}) {
  clearMemo();
  const rows = [];
  for (const one of cases) {
    let measured = NaN, reference = one.reference.value, failure = null;
    try {
      const out = await one.measure();
      if (typeof out === 'number') measured = out;
      else { measured = out.value; reference = out.reference; }
    } catch (error) { failure = String(error?.message ?? error).split('\n')[0]; }
    const row = resultRow(one, reference, measured, failure);
    rows.push(row);
    onResult?.(row);
  }
  clearMemo();
  return rows;
}

export function resultRow(one, reference, measured, failure = null) {
  const pass = failure === null && passes(one.tolerance, reference, measured);
  const error = measured - reference;
  const row = {
    id: one.id, domain: one.domain, title: one.title, quantity: one.quantity, unit: one.unit,
    formula: one.reference.formula, reference: round(reference), measured: round(measured),
    error: round(error), relativeError: reference !== 0 ? round(error / Math.abs(reference)) : null,
    tolerance: {kind: one.tolerance.kind, value: round(one.tolerance.value)}, pass,
    ...(one.note ? {note: one.note} : {}), ...(failure ? {failure} : {}),
    source: {file: one.source.file, test: one.source.test, url: sourceUrl(one.source.file)},
  };
  return {...row, text: rowText(row)};
}
/** The four numbers of a row as the report prints them, so the page and the Markdown cannot format them differently. */
export function rowText(row) {
  return {reference: withUnit(formatNumber(row.reference), row.unit), measured: formatNumber(row.measured), error: formatError(row), tolerance: formatTolerance(row.tolerance)};
}

/** The whole report as data. Nothing in it depends on the date, the machine or the commit. */
export function buildReport(domains, rows) {
  const used = domains.filter(domain => rows.some(row => row.domain === domain.id));
  const summary = used.map(domain => {
    const own = rows.filter(row => row.domain === domain.id);
    return {id: domain.id, cases: own.length, passed: own.filter(row => row.pass).length};
  });
  return {
    schema: SCHEMA, version: SCHEMA_VERSION, repository: REPOSITORY,
    generatedBy: 'node scripts/validation-report.mjs', digits: DIGITS,
    totals: {cases: rows.length, passed: rows.filter(row => row.pass).length, failed: rows.filter(row => !row.pass).length, domains: used.length},
    domains: used.map((domain, i) => ({id: domain.id, title: domain.title, summary: domain.summary, solver: domain.solver, docs: domain.docs, notValidated: domain.notValidated, ...summary[i]})),
    cases: rows,
  };
}

export const renderJson = report => `${JSON.stringify(report, null, 1)}\n`;

// ---- Text ---------------------------------------------------------------------------------------

/** A number as text with `digits` significant digits; plain notation where that stays short. */
export function formatNumber(value, digits = 7) {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e7 || magnitude < 1e-4) {
    const [mantissa, exponent] = value.toExponential(digits - 1).split('e');
    return `${trimZeros(mantissa)}e${Number(exponent)}`;
  }
  return trimZeros(value.toPrecision(digits));
}
const trimZeros = text => text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;

export function formatTolerance(tolerance) {
  const value = formatNumber(tolerance.value, 4);
  if (tolerance.kind === 'relative') return tolerance.value >= 1e-4 ? `±${formatPercent(tolerance.value)}` : `±${value} rel.`;
  if (tolerance.kind === 'absolute') return `±${value}`;
  if (tolerance.kind === 'upper') return tolerance.value === 0 ? 'not above the reference' : `at most ${value} above the reference`;
  return tolerance.value === 0 ? 'not below the reference' : `at most ${value} below the reference`;
}
export const formatPercent = fraction => `${trimZeros((fraction * 100).toPrecision(3))}%`;
/** The error of a row as text: relative where the reference is not zero and the tolerance is relative, else absolute. */
export function formatError(row) {
  if (row.error === null) return 'n/a';
  if (row.tolerance.kind !== 'relative' || row.relativeError === null) return formatSigned(row.error, 3);
  if (row.relativeError === 0) return '0%';
  const sign = row.relativeError > 0 ? '+' : '-', size = Math.abs(row.relativeError);
  return size >= 1e-4 ? `${sign}${formatPercent(size)}` : `${sign}${formatNumber(size, 3)} rel.`;
}
const formatSigned = (value, digits) => value === 0 ? '0' : `${value > 0 ? '+' : ''}${formatNumber(value, digits)}`;
const withUnit = (text, unit) => unit && unit !== '1' ? `${text} ${unit}` : text;
const cell = text => String(text).replace(/\|/g, '\\|');
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const sourceUrl = file => `${REPOSITORY}/blob/main/${file}`;

export function renderMarkdown(report) {
  const out = [];
  const {totals} = report;
  out.push('# Validation: every solver against textbook cases');
  out.push('');
  out.push('<!-- GENERATED by `node scripts/validation-report.mjs`. Do not edit: `npm run validation:check` fails when this file differs from a fresh run. -->');
  out.push('');
  out.push(`${totals.cases} cases in ${totals.domains} domains. ${totals.passed} pass their tolerance${totals.failed ? `, **${totals.failed} fail**` : ''}.`);
  out.push('');
  out.push('Every number in the "measured" column was produced by running the solver, not typed. `node scripts/validation-report.mjs` runs each case in');
  out.push('[`validation/`](../validation) through the public API (the built `box3d-webgpu-kit` for the rigid world and its couplings, `src/engine` for the');
  out.push('other solvers) and writes this file, [`public/validation/validation.json`](../public/validation/validation.json) and the page served at');
  out.push('`<site>/validation/`. `npm run validation:check` runs in the pull-request gate and fails if a case misses its tolerance or if the committed');
  out.push('files no longer match a fresh run.');
  out.push('');
  out.push('How to read a row:');
  out.push('');
  out.push('- **Reference** is the closed-form answer, with the formula it comes from. Where the answer needs a number only the solver knows (a float32 mass), the reference uses that number.');
  out.push('- **Error** is measured minus reference: as a fraction of the reference (a percentage, or "rel." when it is below 0.01%) when the tolerance is relative, otherwise in the unit of the quantity.');
  out.push('- **Tolerance** is the one the linked test asserts for the same quantity (where a note says so, the one its document states). A case passes when the error is inside it.');
  out.push('- A convergence **order** is measured from two or three resolutions of the same problem: `log(e_coarse / e_fine) / log(ratio)`.');
  out.push(`- Numbers are printed with 7 significant digits (errors with 3) and stored with ${report.digits}. The check accepts a fresh value that differs from the committed one by less than`);
  out.push(`  ${formatNumber(CHECK_BAND_FRACTION, 3)} of the case's tolerance band or ${formatNumber(CHECK_RELATIVE, 3)} relative, whichever is larger, and treats two defects against zero as equal when both are under`);
  out.push(`  ${formatNumber(ROUNDOFF_FRACTION, 3)} of their tolerance (that is round-off). On one build two runs give identical files.`);
  out.push('- A pass means the solver reproduces that textbook case to that tolerance. It does not make a scene built with the solver an engineering prediction; the limits are listed under each domain.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Domain | Cases | Pass | Fail |');
  out.push('|---|---:|---:|---:|');
  for (const domain of report.domains) out.push(`| [${cell(domain.title)}](#${slug(domain.title)}) | ${domain.cases} | ${domain.passed} | ${domain.cases - domain.passed} |`);
  out.push(`| **All** | **${totals.cases}** | **${totals.passed}** | **${totals.failed}** |`);
  out.push('');
  for (const domain of report.domains) {
    const rows = report.cases.filter(row => row.domain === domain.id);
    out.push(`## ${domain.title}`);
    out.push('');
    out.push(domain.summary);
    out.push('');
    out.push(`Solver: ${domain.solver}. ${domain.cases} cases, ${domain.passed} pass${domain.cases - domain.passed ? `, **${domain.cases - domain.passed} fail**` : ''}.` +
      (domain.docs.length ? ` Model and limits: ${domain.docs.map(doc => `[${doc.split('/').pop()}](${relativeDoc(doc)})`).join(', ')}.` : ''));
    out.push('');
    out.push('| Case | Reference | Measured | Error | Tolerance | Result |');
    out.push('|---|---|---:|---:|---|---|');
    for (const row of rows) {
      out.push(`| ${cell(row.title)} | \`${cell(row.formula)}\` = ${row.text.reference} | ${row.text.measured} | ${row.text.error} | ${row.text.tolerance} | ${row.pass ? 'pass' : '**FAIL**'} |`);
    }
    out.push('');
    out.push('<details><summary>What each case measures, and the test that asserts it</summary>');
    out.push('');
    for (const row of rows) {
      out.push(`- **${row.title}** (\`${row.id}\`): ${row.quantity}.${row.note ? ` ${row.note}` : ''}${row.failure ? ` Failure: ${row.failure}.` : ''} Test: [\`${row.source.file}\`](${row.source.url}), "${row.source.test}".`);
    }
    out.push('');
    out.push('</details>');
    out.push('');
    out.push(`### What is not validated: ${domain.title.toLowerCase()}`);
    out.push('');
    for (const line of domain.notValidated) out.push(`- ${line}`);
    out.push('');
  }
  return out.join('\n');
}
const relativeDoc = doc => doc.startsWith('docs/') ? `./${doc.slice(5)}` : `../${doc}`;

// ---- Check --------------------------------------------------------------------------------------

/** True when two stored numbers agree within `slack` or within CHECK_RELATIVE of the larger one. null (not finite) only equals null. */
function sameNumber(now, then, slack) {
  if (typeof now !== 'number' || typeof then !== 'number') return now === then && now === null;
  return Math.abs(now - then) <= Math.max(slack, CHECK_RELATIVE * Math.max(Math.abs(now), Math.abs(then)));
}

/** Differences between a committed report and a fresh one, as readable lines. Empty when they agree. */
export function compareReports(committed, fresh) {
  const problems = [];
  if (committed?.schema !== SCHEMA || committed?.version !== SCHEMA_VERSION) return [`committed JSON is not ${SCHEMA} version ${SCHEMA_VERSION}`];
  const strip = report => JSON.stringify({...report, cases: undefined, totals: undefined, domains: report.domains.map(({cases, passed, ...rest}) => rest)});
  if (strip(committed) !== strip(fresh)) problems.push('the domain descriptions or the report header changed');
  const known = new Map(committed.cases.map(row => [row.id, row]));
  for (const row of fresh.cases) {
    const old = known.get(row.id);
    if (!old) { problems.push(`${row.id}: not in the committed report`); continue; }
    known.delete(row.id);
    // `text` and the two errors are derived from measured and reference; the tolerance value is compared as a number.
    const {measured, reference, error, relativeError, text, tolerance, ...rest} = row;
    const {measured: m0, reference: r0, error: e0, relativeError: re0, text: t0, tolerance: tol0, ...rest0} = old;
    if (JSON.stringify(rest) !== JSON.stringify(rest0)) problems.push(`${row.id}: its description, source or result changed`);
    if (tolerance.kind !== tol0?.kind || !sameNumber(tolerance.value, tol0?.value, 0)) problems.push(`${row.id}: its tolerance changed`);
    const width = band(tolerance, reference ?? 0);
    for (const [name, now, then] of [['measured', measured, m0], ['reference', reference, r0]]) {
      // A defect measured against zero that is under ROUNDOFF_FRACTION of its tolerance is round-off: two such values agree.
      const roundoff = name === 'measured' && reference === 0 && r0 === 0 && Math.abs(now ?? Infinity) <= ROUNDOFF_FRACTION * width && Math.abs(then ?? Infinity) <= ROUNDOFF_FRACTION * width;
      if (!roundoff && !sameNumber(now, then, CHECK_BAND_FRACTION * width)) problems.push(`${row.id}: ${name} is ${now}, committed ${then}`);
    }
    if (JSON.stringify(t0) !== JSON.stringify(rowText(old))) problems.push(`${row.id}: the committed text does not match the committed numbers`);
  }
  for (const id of known.keys()) problems.push(`${id}: in the committed report but no longer a case`);
  if (committed.cases.map(row => row.id).join() !== fresh.cases.map(row => row.id).join() && problems.length === 0) problems.push('the order of the cases changed');
  return problems;
}
