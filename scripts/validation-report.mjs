// Runs the validation registry (validation/) and publishes the measured numbers.
//
//   node scripts/validation-report.mjs            run every case; write docs/VALIDATION.md and public/validation/validation.json
//   node scripts/validation-report.mjs --check    run every case; fail if one misses its tolerance, or if the committed files
//                                                 differ from this run beyond the stated rounding (npm run validation:check)
//   --only heat,solid      run only these domains (the written files then hold only these; for development and tests)
//   --docs <path>          the Markdown file to write or check (default docs/VALIDATION.md)
//   --json <path>          the JSON file to write or check (default public/validation/validation.json)
//   --registry <path>      another registry module (exports DOMAINS, selectCases, needsKit); used by tests/validation
//
// Cases of the rigid world and its couplings run through the built kit. The kit's build outputs are git-ignored and
// the source manifest check fails on leftovers, so this script builds the kit and removes the outputs again in a
// finally block (as packages/box3d-kit/scripts/test-gate.mjs does), unless a build was already there.
// Nothing here measures or asserts wall-clock time.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
register('./typescript-loader.mjs', import.meta.url);

function parse(argv) {
  const options = {check: false, only: [], docs: path.join(root, 'docs/VALIDATION.md'), json: path.join(root, 'public/validation/validation.json')};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], value = () => { if (i + 1 >= argv.length) throw new RangeError(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--check') options.check = true;
    else if (arg === '--only') options.only = value().split(',').map(id => id.trim()).filter(Boolean);
    else if (arg === '--docs') options.docs = path.resolve(value());
    else if (arg === '--json') options.json = path.resolve(value());
    else if (arg === '--registry') options.registry = path.resolve(value());
    else throw new RangeError(`Unknown argument ${arg}`);
  }
  return options;
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const kitDir = path.join(root, 'packages/box3d-kit');
function kitScript(name) {
  const result = spawnSync(npm, ['--prefix', kitDir, 'run', name], {encoding: 'utf8'});
  if (result.error || result.status !== 0) throw new Error(`box3d-kit "${name}" failed:\n${result.stdout ?? ''}${result.stderr ?? result.error?.message ?? ''}`);
}

async function main() {
  const options = parse(process.argv.slice(2));
  const {DOMAINS, selectCases, needsKit} = await import(options.registry ? pathToFileURL(options.registry).href : '../validation/registry.mjs');
  const report = await import('../validation/report.mjs');
  const cases = selectCases(options.only);

  const buildKit = needsKit(cases), hadBuild = fs.existsSync(path.join(kitDir, 'dist'));
  let rows;
  try {
    if (buildKit) { console.log('Building box3d-webgpu-kit for the rigid-world cases...'); kitScript('build'); }
    rows = await report.runCases(cases, {onResult: row => { if (!row.pass) console.log(`FAIL ${row.id}: measured ${row.measured}, reference ${row.reference}, tolerance ${report.formatTolerance(row.tolerance)}${row.failure ? ` (${row.failure})` : ''}`); }});
  } finally {
    if (buildKit && !hadBuild) kitScript('clean');
  }

  const fresh = report.buildReport(DOMAINS, rows), json = report.renderJson(fresh), markdown = report.renderMarkdown(fresh);
  for (const domain of fresh.domains) console.log(`${String(domain.passed).padStart(3)} / ${String(domain.cases).padEnd(3)} ${domain.title}`);
  console.log(`${fresh.totals.passed} of ${fresh.totals.cases} cases pass.`);
  const relative = file => path.relative(root, file) || file;
  let ok = fresh.totals.failed === 0;

  if (options.check) {
    const problems = [];
    for (const file of [options.json, options.docs]) if (!fs.existsSync(file)) problems.push(`${relative(file)} is missing`);
    if (problems.length === 0) {
      const committedText = fs.readFileSync(options.json, 'utf8');
      let committed = null;
      try { committed = JSON.parse(committedText); } catch (error) { problems.push(`${relative(options.json)} is not valid JSON: ${error.message}`); }
      if (committed) {
        problems.push(...report.compareReports(committed, fresh).map(line => `${relative(options.json)}: ${line}`));
        // The Markdown must be exactly what the committed JSON renders to, so the two published files cannot disagree.
        let rendered = null;
        try { rendered = report.renderMarkdown(committed); } catch { problems.push(`${relative(options.json)} cannot be rendered`); }
        if (rendered !== null && rendered !== fs.readFileSync(options.docs, 'utf8')) problems.push(`${relative(options.docs)} is not what ${relative(options.json)} renders to`);
        if (problems.length === 0 && committedText !== json) console.log('Note: the committed JSON differs from this run within the stated rounding (a different machine or Node build).');
      }
    }
    if (problems.length) {
      ok = false;
      console.error(`\nThe published validation numbers are stale or were edited (${problems.length} problem${problems.length > 1 ? 's' : ''}):`);
      for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
      if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
      console.error('Run `node scripts/validation-report.mjs` and commit docs/VALIDATION.md and public/validation/validation.json.');
    } else console.log('The committed validation report matches this run.');
  } else {
    for (const [file, text] of [[options.json, json], [options.docs, markdown]]) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); console.log(`Wrote ${relative(file)}`); }
  }
  if (!ok) process.exitCode = 1;
}

main().catch(error => { console.error(error?.stack ?? error); process.exitCode = 1; });
