// Runs every case of the fluid validation domain (validation/domains/fluid.mjs) twice through the built kit: with the
// default MIC(0) pressure preconditioner and with the multigrid one (fluid-multigrid.ts, pressureSolver: 'multigrid'),
// and prints, per case, both measured values, the change, and whether each passes its stated tolerance. Exits 1 when a
// multigrid row misses its tolerance. The free-surface cases do not use this preconditioner and come out the same.
//
//   npm --prefix packages/box3d-kit run build   (once)
//   node scripts/validate-fluid-multigrid.mjs [--json out.json]
import {register} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
register('./typescript-loader.mjs', import.meta.url);
if (!fs.existsSync(path.join(root, 'packages/box3d-kit/dist/fluid.js'))) { console.error('Build the kit first: npm --prefix packages/box3d-kit run build'); process.exit(2); }
const {selectCases} = await import(pathToFileURL(path.join(root, 'validation/registry.mjs')).href);
const report = await import(pathToFileURL(path.join(root, 'validation/report.mjs')).href);
const {clearMemo, kit} = await import(pathToFileURL(path.join(root, 'validation/lib.mjs')).href);
const fluid = await kit('fluid');
const cases = selectCases(['fluid']);
const run = async solver => {
  fluid.setFluidPressureSolverDefault(solver); clearMemo();
  const t = performance.now(), rows = await report.runCases(cases, {}); return {rows, seconds: (performance.now() - t) / 1000};
};
const mic = await run('mic'), mg = await run('multigrid');
fluid.setFluidPressureSolverDefault('mic');
let failed = 0;
const out = [];
for (const row of mg.rows) {
  const before = mic.rows.find(r => r.id === row.id), change = before && typeof row.measured === 'number' ? row.measured - before.measured : NaN;
  out.push({id: row.id, mic: before?.measured, multigrid: row.measured, change, tolerance: report.formatTolerance(row.tolerance), reference: row.reference, passMic: before?.pass, passMultigrid: row.pass});
  if (!row.pass) failed++;
  console.log(`${row.pass ? 'pass' : 'FAIL'}  ${row.id.padEnd(40)} MIC ${String(before?.measured).padEnd(24)} MG ${String(row.measured).padEnd(24)} change ${Number.isFinite(change) ? change.toExponential(2) : '-'}  tol ${report.formatTolerance(row.tolerance)}`);
}
console.log(`${mg.rows.length} cases; multigrid misses ${failed}. Time for the domain: MIC ${mic.seconds.toFixed(1)} s, multigrid ${mg.seconds.toFixed(1)} s (one thread; includes the free-surface cases, which do not change).`);
const json = process.argv.indexOf('--json');
if (json > 0) fs.writeFileSync(process.argv[json + 1], JSON.stringify({rows: out, seconds: {mic: mic.seconds, multigrid: mg.seconds}}, null, 1));
process.exitCode = failed ? 1 : 0;
