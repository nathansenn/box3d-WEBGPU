// Steps the glass "Radial impact" program and reports model-time progress per wall second.
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){ if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);} return next(s,c); }});
const root=process.argv[2], budgetMs=Number(process.argv[3]||60000);
const {LABS,normalizeSettings}=await import(root+'/src/studio/material-labs/catalog.ts');
const {createModel,DT}=await import(root+'/src/studio/material-labs/models.ts');
const e=LABS.glass.experiments[0];
const settings=normalizeSettings('glass',{...LABS.glass.defaults,...e.settings});
const m=createModel('glass',settings);
console.log('experiment:', e.name, '| DT:', DT, '| pieces at start:', m.pieces?.length);
const t0=performance.now(); let last=t0, steps=0;
while(performance.now()-t0<budgetMs){
  const s0=performance.now(); m.step(DT); const dt=performance.now()-s0; steps++;
  if(dt>2000) console.log(`slow step #${steps}: ${dt.toFixed(0)} ms at model t=${m.frame.time.toFixed(3)} pieces=${m.pieces?.length} phase=${m.frame.phase}`);
  if(performance.now()-last>5000){ last=performance.now(); console.log(`wall ${((last-t0)/1000).toFixed(0)}s: model t=${m.frame.time.toFixed(3)} steps=${steps} pieces=${m.pieces?.length} phase=${m.frame.phase} metrics=${[...m.frame.metrics].map(x=>+x.toFixed(2)).join(',')}`); }
}
console.log(`stopped after ${(budgetMs/1000)}s: model t=${m.frame.time.toFixed(3)}, steps=${steps}`);
