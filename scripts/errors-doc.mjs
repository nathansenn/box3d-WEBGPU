// Writes the tables of docs/ERRORS.md from the code: the error taxonomy (ENGINE_ERRORS in src/engine/contracts.ts) and
// the accepted ranges of the rigid world (RIGID_LIMITS). `--check` fails when the file is out of date, so the page
// cannot drift from what the engine throws. tests/fuzz/error-taxonomy.test.mjs runs the check in the gate.
import {readFileSync, writeFileSync} from 'node:fs';
import {ENGINE_ERRORS, RIGID_LIMITS} from '../src/engine/contracts.ts';

const file = new URL('../docs/ERRORS.md', import.meta.url);
const GROUPS = [
  ['What you passed', ['INVALID_PAYLOAD', 'INVALID_STATE']],
  ['What the object you called still is', ['DISPOSED', 'STALE_BODY', 'STALE_JOINT', 'STALE_QUERY', 'STALE_GENERATION', 'STALE_REQUEST', 'STALE_SNAPSHOT']],
  ['Limits', ['WORLD_CAPACITY', 'ALLOCATION_FAILED', 'WORK_LIMIT', 'QUERY_VERSION_EXHAUSTED', 'SEQUENCE_EXHAUSTED', 'BACKPRESSURE', 'BUSY']],
  ['What the platform or the build can do', ['UNSUPPORTED_BACKEND', 'UNSUPPORTED_JOINT', 'INVALID_BACKEND', 'WASM_UNAVAILABLE', 'GPU_UNAVAILABLE', 'GPU_DEVICE_LOST', 'GPU_OUT_OF_MEMORY', 'GPU_VALIDATION', 'GPU_SHADER', 'GPU_LAYOUT', 'GPU_CAPACITY', 'INTEGRITY_MISMATCH', 'SHARED_UNAVAILABLE']],
  ['Files and saved state', ['INCOMPATIBLE_SAVE', 'CHECKPOINT_MISMATCH', 'MODEL_MISMATCH']],
  ['Numerics', ['UNSTABLE_TIME_STEP', 'NUMERICAL_FAILURE', 'SOLVER_NOT_CONVERGED', 'SOLVER_BREAKDOWN', 'SINGULAR_STEADY']],
  ['Workers', ['NOT_RUNNING', 'NOT_CREATED', 'RESET', 'INVALID_RESPONSE', 'INVALID_LOAN', 'WORKER_ERROR', 'WORKER_MESSAGE_ERROR', 'WORKER_SEND_ERROR', 'WORKER_TIMEOUT', 'WORKER_RECYCLE_ERROR', 'RUNTIME_ERROR']],
  ['Bugs', ['INTERNAL']],
];
const grouped = new Set(GROUPS.flatMap(([, codes]) => codes));
for (const code of Object.keys(ENGINE_ERRORS)) if (!grouped.has(code)) throw new Error(`scripts/errors-doc.mjs: ${code} is in ENGINE_ERRORS but in no group here`);
for (const code of grouped) if (!(code in ENGINE_ERRORS)) throw new Error(`scripts/errors-doc.mjs: ${code} is grouped here but not in ENGINE_ERRORS`);

const codes = GROUPS.map(([title, list]) => `### ${title}\n\n| Code | What it means | What to do |\n| --- | --- | --- |\n${list.map(code => `| \`${code}\` | ${ENGINE_ERRORS[code].meaning} | ${ENGINE_ERRORS[code].fix} |`).join('\n')}`).join('\n\n');
const R = RIGID_LIMITS;
const ranges = `| Quantity | Accepted | Unit |
| --- | --- | --- |
| Positions, static geometry (mesh vertices, height fields), joint lengths | within ${R.extent} of the origin | m |
| Half extents, radii and hull points of a dynamic body's convex shapes; a frame's distance from its body | at most ${R.shape} (at least 0.0001; capsule half length at least 0.0025); a static or kinematic body's convex shapes within ${R.extent}, and such a body cannot be made dynamic | m |
| Linear and angular velocity | at most ${R.speed} | m/s, rad/s |
| Gravity; a body's gravity scale | at most ${R.gravity} | m/s^2 |
| Forces, torques, impulses, motor forces, explosion strength | at most ${R.force} | N, N m, N s |
| Density | 0, or ${R.densityMin} to ${R.density} | kg/m^3 |
| Explicit mass | ${R.massMin} to ${R.massMax} | kg |
| Explicit inertia (each moment, for a mass m) | m x 1e-10 to m x ${R.extent ** 2} (a radius of gyration of 1e-5 to ${R.extent} m) | kg m^2 |
| Joint spring and stiffness frequency, damping ratios, damping coefficients | at most ${R.hertz} | Hz, 1/s |
| Joint limits and spring targets | within 1e6 | rad or m |
| Friction, restitution | 0 to 1e6 | - |`;

const BEGIN = name => `<!-- generated:${name} by scripts/errors-doc.mjs: edit src/engine/contracts.ts, then run node scripts/errors-doc.mjs -->`, END = name => `<!-- /generated:${name} -->`;
let text = readFileSync(file, 'utf8');
for (const [name, body] of [['codes', codes], ['ranges', ranges]]) {
  const a = text.indexOf(BEGIN(name)), b = text.indexOf(END(name));
  if (a < 0 || b < a) throw new Error(`docs/ERRORS.md has no generated block "${name}"`);
  text = `${text.slice(0, a)}${BEGIN(name)}\n${body}\n${text.slice(b)}`;
}
if (process.argv.includes('--check')) {
  if (text !== readFileSync(file, 'utf8')) { console.error('docs/ERRORS.md is out of date: run node scripts/errors-doc.mjs'); process.exit(1); }
  console.log(`docs/ERRORS.md is current (${Object.keys(ENGINE_ERRORS).length} codes)`);
} else { writeFileSync(file, text); console.log(`wrote docs/ERRORS.md (${Object.keys(ENGINE_ERRORS).length} codes)`); }
