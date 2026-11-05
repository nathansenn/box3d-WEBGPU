import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const output=path.resolve(process.env.BOX3D_QA_OUTPUT||path.join(os.tmpdir(),'box3d-release-qa'));
fs.mkdirSync(output,{recursive:true});
const root=path.resolve('dist'),prefix='/box3d-WEBGPU/';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.ktx2':'image/ktx2','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
  let relative;try{relative=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}${prefix}`;
const report={rendering:'full Chromium with SwiftShader; software acceptance, not physical-GPU timing',base,studies:[],assets:[],lab:null,mobile:null};
let browser;
const save=()=>fs.writeFileSync(path.join(output,'browser-release.json'),JSON.stringify(report,null,2));
function observe(page,row){
  page.on('pageerror',e=>row.errors.push({phase:row.phase,message:e.message,stack:e.stack}));
  page.on('console',m=>{if(m.type()==='error')row.errors.push({phase:row.phase,message:m.text()});if(m.type()==='warning')row.warnings.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)row.badResponses.push({url:r.url(),status:r.status()});});
  page.on('crash',()=>row.errors.push({phase:row.phase,message:'Browser page process crashed'}));
}
function verifyErrors(row){assert.equal(row.errors.length,0,JSON.stringify(row.errors));assert.equal(row.badResponses.length,0,JSON.stringify(row.badResponses));}
try{
  for(const file of ['lab.html','licenses/project.txt','licenses/third-party.txt','box3d/box3d.js','box3d/box3d.wasm','box3d/box3d-mt.js','box3d/box3d-mt.wasm','soft-kernels-simd.wasm','soft-kernels-scalar.wasm']){
    const r=await fetch(base+file);assert.equal(r.status,200,file);
    assert.equal(r.headers.get('cross-origin-opener-policy'),'same-origin');assert.equal(r.headers.get('cross-origin-embedder-policy'),'require-corp');
    if(file.endsWith('.wasm')){assert.equal(r.headers.get('content-type'),'application/wasm');const bytes=new Uint8Array(await r.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[0,97,115,109],file);}
    report.assets.push({file,status:r.status,mime:r.headers.get('content-type')});
  }
  browser=await chromium.launch({channel:'chromium',headless:true,args:['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  report.browser=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  for(const study of ['liquid','glass','concrete','rubber','granular','plate','canopy','bridge']){
    const page=await context.newPage(),row={study,status:'running',phase:'boot',errors:[],warnings:[],badResponses:[],checkpoints:[]};report.studies.push(row);observe(page,row);
    const checkpoint=async phase=>{row.phase=phase;row.checkpoints.push({phase,time:await page.locator('#scene-time,#viewport-time').first().innerText(),errors:row.errors.length});save();};
    try{
      await page.goto(base+`?studio=${study}&quality=balanced&layout=explore`,{waitUntil:'domcontentloaded'});
      await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:90000});
      assert.equal(await page.locator('vite-error-overlay').count(),0);
      assert.ok((await page.locator('#studio').innerText()).length>200,'Meaningful UI required');
      await page.locator('[data-app-switch="lab"]').waitFor({state:'visible'});
      const run=page.locator('[data-action="run"]:visible').first();
      await run.waitFor();assert.equal(await run.isDisabled(),false);
      await checkpoint('run');await run.click();
      await page.waitForFunction(()=>parseFloat(document.querySelector('#scene-time,#viewport-time')?.textContent||'0')>=.3,{},{timeout:45000});
      await run.click();row.advancedTime=await page.locator('#scene-time,#viewport-time').first().innerText();
      await checkpoint('replay');
      const slider=page.locator('#lab-scrub,#scrub').first();
      assert.ok(Number(await slider.getAttribute('max'))>0,'Recorded replay must exist');
      await slider.evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
      row.replayTime=await page.locator('#scene-time,#viewport-time').first().innerText();assert.ok(parseFloat(row.replayTime)<=parseFloat(row.advancedTime));
      await checkpoint('live');await page.locator('[data-action="live"]:visible').first().click();
      await checkpoint('export');
      const [download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.locator('[data-action="export"]:visible').first().click()]);
      const file=path.join(output,study+'-run.json');await download.saveAs(file);JSON.parse(fs.readFileSync(file,'utf8'));row.exported=true;
      await checkpoint('reset');await page.locator('[data-action="reset"]:visible').first().click();
      await page.waitForFunction(()=>parseFloat(document.querySelector('#scene-time,#viewport-time')?.textContent||'99')===0,{},{timeout:20000});
      await checkpoint('post-reset');await page.waitForTimeout(500);
      await page.screenshot({path:path.join(output,study+'-desktop.png'),timeout:15000});
      row.title=await page.title();row.url=page.url();row.canvasCount=await page.locator('canvas').count();row.backend=await page.locator('#renderer-status').textContent().catch(()=>null);
      assert.ok(row.canvasCount>0);verifyErrors(row);row.status='passed';
    }catch(error){row.status='failed';row.failure=String(error);row.pageText=await page.locator('body').innerText({timeout:3000}).catch(()=>null);await page.screenshot({path:path.join(output,study+'-failure.png'),timeout:5000}).catch(()=>{});}
    finally{console.log(JSON.stringify({study,status:row.status,phase:row.phase,errors:row.errors.length,failure:row.failure}));await page.close();save();}
  }
  {
    const page=await context.newPage(),row={status:'running',phase:'lab-boot',errors:[],warnings:[],badResponses:[]};report.lab=row;observe(page,row);
    try{
      await page.goto(base+'lab.html?threads=2',{waitUntil:'domcontentloaded'});
      await page.locator('[data-app-switch="studio"]').waitFor({state:'visible'});
      await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-physics-threads]');return c&&c.width>0&&Number(c.dataset.physicsThreads)>=1;},{},{timeout:90000});
      await page.waitForTimeout(1500);
      Object.assign(row,await page.evaluate(()=>({title:document.title,isolated:crossOriginIsolated,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,data:{...c.dataset}})),text:document.body.innerText.slice(-2500)})));
      assert.ok(row.isolated);verifyErrors(row);assert.ok(row.canvases.some(c=>Number(c.data.physicsThreads)===2),'Threaded native backend must start under isolation');
      await page.screenshot({path:path.join(output,'physics-lab-desktop.png'),timeout:15000});
      row.phase='return-to-studio';await page.locator('[data-app-switch="studio"]').click();await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:90000});verifyErrors(row);row.status='passed';
    }catch(error){row.status='failed';row.failure=String(error);row.pageText=await page.locator('body').innerText({timeout:3000}).catch(()=>null);await page.screenshot({path:path.join(output,'physics-lab-failure.png'),timeout:5000}).catch(()=>{});}
    finally{console.log(JSON.stringify({study:'physics-lab',status:row.status,failure:row.failure}));await page.close();save();}
  }
  {
    const page=await context.newPage(),row={status:'running',phase:'mobile-boot',errors:[],warnings:[],badResponses:[]};report.mobile=row;observe(page,row);
    try{
      await page.setViewportSize({width:390,height:844});await page.goto(base+'?studio=liquid',{waitUntil:'domcontentloaded'});
      await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:90000});await page.locator('[data-app-switch="lab"]').waitFor({state:'visible'});
      Object.assign(row,await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.title})));
      assert.ok(row.scrollWidth<=row.width+8,'Mobile horizontal overflow');verifyErrors(row);await page.screenshot({path:path.join(output,'liquid-mobile.png'),timeout:15000});row.status='passed';
    }catch(error){row.status='failed';row.failure=String(error);await page.screenshot({path:path.join(output,'mobile-failure.png'),timeout:5000}).catch(()=>{});}
    finally{await page.close();save();}
  }
  const failed=[...report.studies,report.lab,report.mobile].filter(r=>r.status!=='passed');
  assert.equal(failed.length,0,failed.map(r=>`${r.study||r.phase}: ${r.failure}`).join('\n'));report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{save();await browser?.close();await new Promise(resolve=>server.close(resolve));}
console.log('Browser acceptance passed: eight Studio routes, native threaded Lab, replay/export/reset, and mobile navigation.');
