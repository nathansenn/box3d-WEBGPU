import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Studio source uses the bundler's extensionless relative TypeScript imports.
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') ||
        /\.[^/]+$/.test(specifier) || !context.parentURL?.endsWith('.ts')) throw error;
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !new URL(url).pathname.endsWith('.ts')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
  });
  return {format: 'module', source: result.outputText, shortCircuit: true};
}
