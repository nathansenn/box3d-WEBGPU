// Generates api/API.md: every public export of every entry point, with its
// declared signature and doc comment, using the TypeScript compiler over the
// published .d.ts files. `--check` fails when API.md is out of date.
import {createRequire} from 'node:module';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(pkg, '../../package.json'));
const ts = require('typescript');
const ENTRIES = [
  ['box3d-webgpu-kit', 'dist/index.d.ts'],
  ['box3d-webgpu-kit/three', 'dist/three.d.ts'],
  ['box3d-webgpu-kit/babylon', 'dist/babylon.d.ts'],
  ['box3d-webgpu-kit/worker', 'dist/worker.d.ts'],
  ['box3d-webgpu-kit/cable', 'dist/cable.d.ts'],
  ['box3d-webgpu-kit/water', 'dist/water.d.ts'],
  ['box3d-webgpu-kit/frame', 'dist/frame.d.ts'],
  ['box3d-webgpu-kit/gameplay', 'dist/gameplay.d.ts'],
];

function kindOf(decl) {
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isFunctionDeclaration(decl)) return 'function';
  if (ts.isVariableDeclaration(decl)) return 'const';
  return 'export';
}

function declarationText(decl, sourceText) {
  if (ts.isClassDeclaration(decl)) {
    const members = decl.members
      .filter(m => !(ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Private) && m.name?.getText?.() !== undefined && !String(m.name.getText()).startsWith('#'))
      .map(m => '  ' + m.getText().replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').replace(/\s+/g, ' ').trim());
    const head = sourceText.slice(decl.getStart(), decl.members.pos).replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').trim();
    return `${head}\n${members.join('\n')}\n}`;
  }
  const node = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
  return node.getText().replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').trim();
}

export function renderDocs() {
  const program = ts.createProgram(ENTRIES.map(([, f]) => join(pkg, f)), {strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true});
  const checker = program.getTypeChecker();
  const out = ['# box3d-webgpu-kit API reference', '', 'Generated from the published type declarations by `scripts/api-docs.mjs`. See the README for guides.', ''];
  for (const [specifier, file] of ENTRIES) {
    const source = program.getSourceFile(join(pkg, file));
    const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(source)).sort((a, b) => a.name.localeCompare(b.name));
    out.push(`## \`${specifier}\``, '');
    for (const exported of symbols) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const decl = symbol.declarations?.[0];
      if (!decl) continue;
      const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      out.push(`### ${exported.name} · ${kindOf(decl)}`, '');
      if (doc) out.push(doc, '');
      out.push('```ts', declarationText(decl, decl.getSourceFile().text), '```', '');
    }
  }
  return out.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = join(pkg, 'api/API.md'), docs = renderDocs();
  if (process.argv.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== docs) { console.error('api/API.md is out of date: run node scripts/api-docs.mjs'); process.exit(1); }
    console.log('api/API.md is current');
  } else {
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, docs);
    console.log(`wrote ${target} (${docs.split('\n').length} lines)`);
  }
}
