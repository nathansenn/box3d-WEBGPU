// Runs the same deterministic session under every JavaScript runtime found on
// this machine and checks they agree bit-for-bit. Missing runtimes are
// reported as skipped, never installed.
//   node scripts/runtime-matrix.mjs            # prints a JSON summary; exit 1 on disagreement
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = `
import {createWorld, BUILD_INFO} from './dist/index.js';
const world = await createWorld({seed: 77});
for (let i = 0; i < 30; i++) world.spawnBox({position: [(i % 6) - 2.5, 0.5 + Math.floor(i / 6) * 1.05, 0], halfSize: 0.48});
world.spawnBox({position: [-10, 2, 0], impulse: [120, 10, 0], halfSize: 0.5});
for (let t = 0; t < 240; t++) { if (t === 120) world.explode([0, 0, 0], 12, 6); world.step(); }
console.log(JSON.stringify({hash: world.exactHash(), bodies: world.bodyCount(), wasm: BUILD_INFO.wasmSha256.slice(0, 12)}));
world.dispose();
`;

const candidates = [
  ['node (current)', process.execPath, ['--input-type=module', '-e', probe]],
  ['node 22', '/opt/homebrew/opt/node@22/bin/node', ['--input-type=module', '-e', probe]],
  ['node 20', '/opt/homebrew/opt/node@20/bin/node', ['--input-type=module', '-e', probe]],
  ['bun', join(homedir(), '.bun/bin/bun'), ['-e', probe]],
  ['deno', join(homedir(), '.deno/bin/deno'), ['eval', '--ext=js', probe]],
];

export function runMatrix() {
  const results = [];
  for (const [name, bin, args] of candidates) {
    if (!existsSync(bin)) { results.push({runtime: name, skipped: 'not installed'}); continue; }
    try {
      const version = execFileSync(bin, ['--version'], {encoding: 'utf8'}).trim().split('\n')[0];
      const out = execFileSync(bin, args, {cwd: pkg, encoding: 'utf8', timeout: 60000}).trim().split('\n').at(-1);
      results.push({runtime: name, version, ...JSON.parse(out)});
    } catch (error) {
      results.push({runtime: name, error: String(error.stderr || error.message).slice(0, 300)});
    }
  }
  const ran = results.filter(r => 'hash' in r);
  return {results, agree: ran.length > 0 && ran.every(r => r.hash === ran[0].hash && r.bodies === ran[0].bodies)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = runMatrix();
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.agree || summary.results.some(r => r.error)) process.exit(1);
}
