import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Explicit files keep the required gate focused and independent of shell globbing.
const files = [
  'tests/engine/contact-cache.test.mjs',
  'tests/engine/contact-force-staging.test.mjs',
  'tests/engine/contact-projection.test.mjs',
  'tests/engine/contact-recovery.test.mjs',
  'tests/engine/convex-contact.test.mjs',
  'tests/engine/friction-covariance.test.mjs',
  'tests/engine/press-contact.test.mjs',
  'tests/engine/surface-contact.test.mjs',
  'tests/engine/surface-topology.test.mjs',
  'tests/engine/worker.test.mjs',
  'tests/engine/gpu-startup.test.mjs',
  'tests/studio/canopy-contact.test.mjs',
  'tests/studio/glass-contact-support.test.mjs',
  'tests/studio/glass-worker.test.mjs',
  'tests/studio/glass-pendulum.test.mjs',
  'tests/studio/glass-recovery.test.mjs',
  'tests/studio/material-collision.test.mjs',
];
const child = spawn(process.execPath, [
  '--import', fileURLToPath(new URL('./register-typescript.mjs', import.meta.url)),
  '--test', '--test-concurrency=1', ...files,
], {cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit'});
child.on('error', error => {console.error(error); process.exitCode = 1;});
child.on('exit', (code, signal) => {
  if (signal) console.error(`Collision tests terminated by ${signal}`);
  process.exitCode = code ?? 1;
});
