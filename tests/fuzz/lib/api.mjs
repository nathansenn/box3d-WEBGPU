// Reads the kit's public API listing (packages/box3d-kit/api/public-api.txt, generated from the published .d.ts files)
// so that the misuse tables can be checked against what is actually public.
import {readFileSync} from 'node:fs';

const text = readFileSync(new URL('../../../packages/box3d-kit/api/public-api.txt', import.meta.url), 'utf8');
const sections = new Map();
for (const part of text.split(/^\/\/ ==== /m).slice(1)) {
  const end = part.indexOf(' ====');
  sections.set(part.slice(0, end), part.slice(end + 5));
}

/** Declaration files in the listing, e.g. 'world.d.ts' or 'core/cloth.d.ts'. */
export const declarationFiles = () => [...sections.keys()];

/** The body of `export declare class <name>` in one declaration file. */
function classBody(file, name) {
  const source = sections.get(file);
  if (source === undefined) throw new Error(`public-api.txt has no section ${file}`);
  const start = source.search(new RegExp(`^export declare class ${name}\\b[^\\n]*\\{$`, 'm'));
  if (start < 0) throw new Error(`${file} declares no class ${name}`);
  return source.slice(start, source.indexOf('\n}', start));
}

/** Public instance methods of a class (no private, protected, static, accessor or property members). */
export function publicMethods(file, name) {
  const out = [];
  for (const line of classBody(file, name).split('\n')) {
    const match = /^ {4}(?!private |protected |static |get |set |readonly |constructor\()([A-Za-z_$][\w$]*)(?:<[^>(]*>)?\(/.exec(line);
    if (match && !out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

/** Which declaration file declares a class or function, searching the whole listing. */
export function declaringFile(name) {
  for (const [file, source] of sections) if (new RegExp(`^export declare (?:abstract )?(?:class|function) ${name}\\b`, 'm').test(source)) return file;
  return null;
}
