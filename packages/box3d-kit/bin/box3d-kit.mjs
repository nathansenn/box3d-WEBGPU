#!/usr/bin/env node
// box3d-kit command line.
//   npx box3d-kit init my-game [--template node|three|single]   start a project
//   npx box3d-kit info                                          capabilities of this build and runtime
import {cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = {
  node: 'Headless Node game loop (servers, tests, simulations).',
  three: 'Vite + three.js browser game with instanced rendering.',
  single: 'Zero-install static page: one self-contained module, no build step.',
};
const [command, ...args] = process.argv.slice(2);

function usage(code = 0) {
  console.log(`box3d-kit init <dir> [--template ${Object.keys(TEMPLATES).join('|')}]\nbox3d-kit info\n\nTemplates:\n${Object.entries(TEMPLATES).map(([k, v]) => `  ${k.padEnd(7)} ${v}`).join('\n')}`);
  process.exit(code);
}

function walk(dir) {
  return readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)).map(f => join(name, f)) : [name]);
}

if (command === 'init') {
  const dir = args.find(a => !a.startsWith('--'));
  const flag = args.indexOf('--template');
  const template = flag >= 0 ? args[flag + 1] : 'three';
  if (!dir || !TEMPLATES[template]) usage(1);
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length > 0) { console.error(`${target} is not empty; choose a new directory.`); process.exit(1); }
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  const name = basename(target).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'box3d-game';
  const source = join(pkg, 'templates', template);
  mkdirSync(target, {recursive: true});
  for (const file of walk(source)) {
    mkdirSync(dirname(join(target, file)), {recursive: true});
    const text = readFileSync(join(source, file), 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{NAME}}', name);
    writeFileSync(join(target, file), text);
  }
  if (template === 'single') copyFileSync(join(pkg, 'dist/single.js'), join(target, 'box3d-kit.single.js'));
  const next = template === 'single' ? 'serve the folder from any static host (e.g. python3 -m http.server 8080 --bind 127.0.0.1)'
    : template === 'node' ? 'npm install && npm start' : 'npm install && npm run dev';
  console.log(`Created ${template} project in ${target}\nNext: cd ${dir} && ${next}`);
} else if (command === 'info') {
  const {capabilities} = await import('../dist/index.js');
  console.log(JSON.stringify(capabilities(), null, 2));
} else {
  usage(command ? 1 : 0);
}
