// The lifetime of Dawn GPU objects in Node (scripts/dawn-gpu.mjs). dawn.node 0.4.0 frees its instance when the
// JS GPU object is collected, while queued ProcessEvents callbacks still hold a raw pointer to it: the crash of
// CI run 43942495498 (segmentation fault after the pipeline test's success line). The pinned GPU objects of
// scripts/dawn-gpu.mjs must survive a collection at that moment; the unpinned control shows that the upstream
// defect is still there (when it stops crashing, dawn.node owns its instance and the pin can go).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const child = fileURLToPath(new URL('./fixtures/dawn-lifetime-child.mjs', import.meta.url));
const env = {...process.env};
delete env.NODE_OPTIONS;
const run = mode => spawnSync(process.execPath, ['--expose-gc', child, mode], {encoding: 'utf8', timeout: 30000, env});
const outcome = r => r.error ? `error ${r.error.code}` : r.signal ? `signal ${r.signal}` : `exit ${r.status}`;

test('a pinned Dawn GPU object survives garbage collection with ProcessEvents queued', () => {
  for (let i = 0; i < 6; i++) {
    const r = run('pinned');
    assert.equal(outcome(r), 'exit 0', `run ${i}: ${r.stderr}`);
    assert.match(r.stdout, /dawn lifetime pinned: exited cleanly/);
  }
});

test('control: an unpinned Dawn GPU object collected with ProcessEvents queued still crashes upstream', () => {
  const outcomes = [];
  for (let i = 0; i < 4; i++) outcomes.push(outcome(run('unpinned')));
  console.log(`unpinned outcomes: ${outcomes.join(', ')}`);
  assert.ok(outcomes.some(o => o !== 'exit 0'),
    'dawn.node no longer crashes when its GPU object is collected early: check the upstream fix and retire the pin in scripts/dawn-gpu.mjs');
});
