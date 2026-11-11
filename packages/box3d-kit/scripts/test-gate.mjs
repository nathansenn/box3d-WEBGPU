// Runs the kit test files that the repository's required gate covers, then removes the build
// outputs whether or not the tests passed. The source manifest check fails on leftover build
// outputs, so cleaning only on success would turn one test failure into a second, misleading one.
// upstream-suites is left to the engine gate: it needs the baseline archives that suite needs.
import {spawnSync} from 'node:child_process';

const FILES = [
  'test/features.test.mjs',
  'test/world.test.mjs',
  'test/v03.test.mjs',
  'test/v04.test.mjs',
  'test/v05.test.mjs',
  'test/v06.test.mjs',
  'test/v07.test.mjs',
  'test/v08.test.mjs',
  'test/v09-coupling.test.mjs',
  'test/v09-heat.test.mjs',
  'test/v10-geometry.test.mjs',
];
const tests = spawnSync(process.execPath, ['--test', ...FILES], {stdio: 'inherit'});
const clean = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'clean'], {stdio: 'inherit'});
process.exit(tests.status !== 0 ? (tests.status ?? 1) : (clean.status ?? 1));
