import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Emit Node ESM after type erasure. Entry/override keys are relative to sourceRoot.
 * Archive callers must select their archive root, never silently use current src.
 * Package imports are preserved; local runtime modules become explicit .mjs files. */
export function emitTypeScriptModuleTree({ sourceRoot, outputRoot, entry, sourceOverrides = {} }) {
  const sourceBase = path.resolve(sourceRoot);
  const outputBase = path.resolve(outputRoot);
  const overrides = new Map(Object.entries(sourceOverrides).map(([name, text]) => [
    path.resolve(sourceBase, name), text,
  ]));
  const emitted = new Map();
  const localExtension = /\.(?:[cm]?[jt]s|tsx|jsx)$/i;

  function relativeSource(sourcePath) {
    const relative = path.relative(sourceBase, sourcePath);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Runtime module is outside its selected sourceRoot: ' + sourcePath);
    }
    return relative;
  }
  function resolveLocal(parent, specifier) {
    if (specifier.includes('?') || specifier.includes('#')) {
      throw new Error('Runtime emitter does not support local query/fragment imports: ' + specifier);
    }
    const base = path.resolve(path.dirname(parent), specifier);
    const candidates = path.extname(base)
      ? [base, base.replace(/\.js$/i, '.ts'), base.replace(/\.mjs$/i, '.mts'), base.replace(/\.cjs$/i, '.cts')]
      : [base + '.ts', base + '.js', path.join(base, 'index.ts'), path.join(base, 'index.js')];
    for (const candidate of new Set(candidates)) {
      relativeSource(candidate);
      if (localExtension.test(candidate) &&
          (overrides.has(candidate) || (fs.existsSync(candidate) && fs.statSync(candidate).isFile()))) return candidate;
    }
    throw new Error('Cannot resolve runtime import ' + specifier + ' from ' + parent);
  }

  function emit(sourcePath) {
    sourcePath = path.resolve(sourcePath);
    if (emitted.has(sourcePath)) return emitted.get(sourcePath);
    const relative = relativeSource(sourcePath);
    if (!localExtension.test(relative)) throw new Error('Unsupported runtime module extension: ' + sourcePath);
    const outputPath = path.join(outputBase, relative.replace(localExtension, '.mjs'));
    // Register before following imports so dependency cycles terminate.
    emitted.set(sourcePath, outputPath);
    const source = overrides.has(sourcePath) ? overrides.get(sourcePath) : fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      fileName: sourcePath,
      reportDiagnostics: true,
    });
    const errors = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error('Cannot transpile ' + sourcePath + ': ' +
      errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    const parsed = ts.createSourceFile(outputPath, compiled.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const replacements = [];
    function rewriteLiteral(literal) {
      const specifier = literal.text;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
      const dependency = emit(resolveLocal(sourcePath, specifier));
      let replacement = path.relative(path.dirname(outputPath), dependency).split(path.sep).join('/');
      if (!replacement.startsWith('.')) replacement = './' + replacement;
      replacements.push({ start: literal.getStart(parsed), end: literal.getEnd(), text: JSON.stringify(replacement) });
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        rewriteLiteral(node.moduleSpecifier);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
        rewriteLiteral(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    let text = compiled.outputText;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, text);
    return outputPath;
  }
  const entryPath = emit(path.resolve(sourceBase, entry));
  return { entryPath, files: [...emitted].map(([sourcePath, outputPath]) => ({ sourcePath, outputPath })) };
}
