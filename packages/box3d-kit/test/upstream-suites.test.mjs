// Runs the application's own test suites for the optional modules against the
// *packaged* copies: every import of the app source is rewritten to the
// package subpath. Passing proves packaging preserved each model's behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const repo = resolve(pkg, '../..');
const MAP = {
  '../../src/engine/compliant-cable.ts': 'box3d-webgpu-kit/cable',
  '../../src/engine/linear-water.ts': 'box3d-webgpu-kit/water',
  '../../src/engine/closed-water.ts': 'box3d-webgpu-kit/water',
  '../../src/engine/frame-runtime.ts': 'box3d-webgpu-kit/frame',
  '../../src/engine/frame-element.ts': 'box3d-webgpu-kit/frame',
};
const SUITES = ['compliant-cable', 'proximal-cable', 'linear-water', 'closed-water', 'frame'];
const counts = {};
test.after(() => { if (Object.keys(counts).length) console.log(`app suites passing against the package: ${JSON.stringify(counts)}`); });

for (const suite of SUITES) {
  test(`app suite tests/engine/${suite}.test.mjs passes against the packaged module`, () => {
    let text = readFileSync(join(repo, 'tests/engine', `${suite}.test.mjs`), 'utf8');
    const specifiers = [...text.matchAll(/from\s+'(\.\.\/\.\.\/[^']+)'/g)].map(m => m[1]);
    for (const spec of new Set(specifiers)) {
      if (MAP[spec]) text = text.replaceAll(`'${spec}'`, `'${MAP[spec]}'`);
      else if (spec.startsWith('../../scripts/')) text = text.replaceAll(`'${spec}'`, `'${pathToFileURL(join(repo, spec.slice(6))).href}'`);
      else assert.fail(`${suite}: unmapped import ${spec}`);
    }
    assert.ok(Object.values(MAP).some(target => text.includes(`'${target}'`)), 'the suite now imports the package');
    const dir = join(pkg, 'test/.generated');
    mkdirSync(dir, {recursive: true});
    const file = join(dir, `${suite}.test.mjs`);
    writeFileSync(file, text);
    try {
      // A nested `node --test` must not inherit the parent runner's context. The app's suites read fixtures relative to the repository root; package resolution follows the test file's location.
      const {NODE_TEST_CONTEXT, ...env} = process.env;
      const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', file], {cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000});
      const pass = Number(/# pass (\d+)/.exec(out)?.[1] ?? 0), fail = Number(/# fail (\d+)/.exec(out)?.[1] ?? 1);
      assert.equal(fail, 0);
      assert.ok(pass > 0, 'the suite ran tests');
      counts[suite] = pass;
    } catch (error) {
      assert.fail(`${suite} failed against the package:\n${String(error.stdout ?? error).split('\n').filter(l => /not ok|Error|expected|actual/.test(l)).slice(0, 12).join('\n')}`);
    } finally {
      rmSync(file, {force: true});
    }
  });
}
