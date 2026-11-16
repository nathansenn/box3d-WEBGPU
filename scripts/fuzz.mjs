// Runs the fuzzers of tests/fuzz (docs/ROBUSTNESS.md).
//   node scripts/fuzz.mjs            the short, deterministic run of the pull-request gate (npm run test:fuzz)
//   node scripts/fuzz.mjs long       many more seeds and steps, and the ten-minute soak (npm run fuzz:long)
//   node scripts/fuzz.mjs soak       the soak alone
// Pass file names after the mode to run a subset: node scripts/fuzz.mjs short tests/fuzz/world-misuse.test.mjs
// FUZZ_SEED=<n> pins one seed; FUZZ_SEEDS=<n> sets how many; FUZZ_TRACE=1 prints each misuse call before it runs.
// The fuzzers that go through PhysicsWorld test the built kit, so this builds it first and removes the build
// afterwards whether or not the tests passed (the source manifest check fails on leftover build outputs).
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';

const mode = ['short', 'long', 'soak'].includes(process.argv[2]) ? process.argv[2] : 'short';
const named = process.argv.slice(process.argv[2] === mode ? 3 : 2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const all = readdirSync('tests/fuzz').filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/fuzz/${name}`);
// The gate's list. 'tests/fuzz/*.test.mjs' is every file here; the soak file runs its ten minutes only in long mode.
const files = named.length ? named : mode === 'soak' ? ['tests/fuzz/soak.test.mjs'] : all;
const env = {...process.env, FUZZ_MODE: mode === 'short' ? 'short' : 'long', ...(mode === 'short' ? {} : {FUZZ_SOAK: '1'})};
delete env.NODE_OPTIONS; // some sandboxes set flags that break child processes of the tests

const build = process.env.FUZZ_NO_BUILD ? {status: 0} : spawnSync(npm, ['--prefix', 'packages/box3d-kit', 'run', 'build'], {stdio: 'inherit', env});
let status = build.status ?? 1;
if (status === 0) {
  // One file at a time in long mode keeps the soak's timing and memory readings free of other suites.
  const timeout = mode === 'short' ? 600000 : 3 * 3600000;
  const tests = spawnSync(process.execPath, ['--expose-gc', '--test', `--test-concurrency=${mode === 'short' ? 2 : 1}`, ...files], {stdio: 'inherit', env, timeout});
  status = tests.status ?? 1;
}
const clean = process.env.FUZZ_NO_BUILD ? {status: 0} : spawnSync(npm, ['--prefix', 'packages/box3d-kit', 'run', 'clean'], {stdio: 'inherit', env});
process.exit(status !== 0 ? status : (clean.status ?? 1));
