// Public API report: the published .d.ts files, minus comments and blank
// lines, concatenated in a stable order. `--check` fails when the API changed
// without the report being regenerated, so API changes show up in review.
//   node scripts/api-report.mjs          # regenerate api/public-api.txt
//   node scripts/api-report.mjs --check  # verify (used by tests)
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(pkg, 'dist'), reportPath = join(pkg, 'api/public-api.txt');

export function renderReport() {
  const files = readdirSync(dist, {recursive: true}).map(String).filter(f => f.endsWith('.d.ts')).sort();
  const sections = files.map(file => {
    const body = readFileSync(join(dist, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(line => line.replace(/\/\/.*$/, '').trimEnd()).filter(line => line.trim() && !line.startsWith('//# sourceMappingURL'))
      .join('\n');
    return `// ==== ${file.split('\\').join('/')} ====\n${body}\n`;
  });
  return sections.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = renderReport();
  if (process.argv.includes('--check')) {
    const committed = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
    if (committed !== report) {
      console.error('Public API changed. Review the diff, then run: node scripts/api-report.mjs');
      process.exit(1);
    }
    console.log('public API matches api/public-api.txt');
  } else {
    mkdirSync(dirname(reportPath), {recursive: true});
    writeFileSync(reportPath, report);
    console.log(`wrote ${reportPath} (${report.split('\n').length} lines)`);
  }
}
