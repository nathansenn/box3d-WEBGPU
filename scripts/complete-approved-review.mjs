import fs from 'node:fs';
const file='scripts/apply-approved-review.mjs';
let source=fs.readFileSync(file,'utf8');
const guard="  if(y.includes('run: npm run validate:release'))continue;";
if(!source.includes(guard))source=source.replace("  const start=y.indexOf('      - name: Verify source manifest');",guard+"\n  const start=y.indexOf('      - name: Verify source manifest');");
fs.writeFileSync(file,source);
await import('./apply-approved-review.mjs');
