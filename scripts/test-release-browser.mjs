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
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+prefix;
const report={rendering:'software Chromium acceptance; not physical-GPU timing',base,studies:[],assets:[],lab:null,mobile:null};
let browser;
try{
  for(const file of ['lab.html','box3d/box3d.js','box3d/box3d.wasm','box3d/box3d-mt.js','box3d/box3d-mt.wasm','soft-kernels-simd.wasm','soft-kernels-scalar.wasm']){
    const r=await fetch(base+file);assert.equal(r.status,200,file);
    assert.equal(r.headers.get('cross-origin-opener-policy'),'same-origin');assert.equal(r.headers.get('cross-origin-embedder-policy'),'require-corp');
    if(file.endsWith('.wasm')){assert.equal(r.headers.get('content-type'),'application/wasm');const bytes=new Uint8Array(await r.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[0,97,115,109],file);}
    report.assets.push({file,status:r.status,mime:r.headers.get('content-type')});
  }
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  report.browser=browser.version();
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  for(const study of ['liquid','glass','concrete','rubber','granular','plate','canopy','bridge']){
    const page=await context.newPage(),errors=[],warnings=[],badResponses=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)badResponses.push({url:r.url(),status:r.status()});});
    const row={study,status:'running',errors,warnings,badResponses};report.studies.push(row);
    try{
      await page.goto(base+`?studio=${study}&quality=balanced&layout=explore`,{waitUntil:'domcontentloaded'});
      await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:120000});
      assert.equal(await page.locator('vite-error-overlay').count(),0);
      assert.ok((await page.locator('#studio').innerText()).length>200,'Meaningful UI required');
      await page.locator('[data-app-switch="lab"]').waitFor({state:'visible'});
      const run=page.locator('[data-action="run"]:visible').first();
      await run.waitFor();assert.equal(await run.isDisabled(),false);
      await run.click();
      await page.waitForFunction(()=>parseFloat(document.querySelector('#scene-time,#viewport-time')?.textContent||'0')>=.3,{},{timeout:45000});
      await run.click();
      row.advancedTime=await page.locator('#scene-time,#viewport-time').first().innerText();
      const slider=page.locator('#lab-scrub,#scrub').first();
      assert.ok(Number(await slider.getAttribute('max'))>0,'Recorded replay must exist');
      await slider.evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
      row.replayTime=await page.locator('#scene-time,#viewport-time').first().innerText();
      assert.ok(parseFloat(row.replayTime)<=parseFloat(row.advancedTime));
      await page.locator('[data-action="live"]:visible').first().click();
      const [download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.locator('[data-action="export"]:visible').first().click()]);
      const file=path.join(output,study+'-run.json');await download.saveAs(file);JSON.parse(fs.readFileSync(file,'utf8'));row.exported=true;
      await page.locator('[data-action="reset"]:visible').first().click();
      await page.waitForFunction(()=>parseFloat(document.querySelector('#scene-time,#viewport-time')?.textContent||'99')===0,{},{timeout:20000});
      await page.screenshot({path:path.join(output,study+'-desktop.png')});
      row.title=await page.title();row.url=page.url();row.canvasCount=await page.locator('canvas').count();
      assert.ok(row.canvasCount>0);assert.equal(errors.length,0,errors.join('\n'));assert.equal(badResponses.length,0,JSON.stringify(badResponses));
      row.status='passed';
    }catch(error){row.status='failed';row.failure=String(error);await page.screenshot({path:path.join(output,study+'-failure.png')}).catch(()=>{});throw error;}
    finally{await page.close();fs.writeFileSync(path.join(output,'browser-release.json'),JSON.stringify(report,null,2));}
  }
  const lab=await context.newPage(),errors=[];lab.on('pageerror',e=>errors.push(e.message));
  await lab.goto(base+'lab.html?threads=2',{waitUntil:'domcontentloaded'});
  await lab.locator('[data-app-switch="studio"]').waitFor({state:'visible'});
  await lab.waitForFunction(()=>{
    const canvas=document.querySelector('canvas[data-physics-threads]');
    return canvas&&canvas.width>0&&Number(canvas.dataset.physicsThreads)>=1;
  },{},{timeout:120000});
  await lab.waitForTimeout(1500);
  report.lab=await lab.evaluate(()=>({title:document.title,isolated:crossOriginIsolated,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,data:{...c.dataset}})),text:document.body.innerText.slice(-2500)}));
  assert.ok(report.lab.isolated);assert.equal(errors.length,0,errors.join('\n'));
  assert.ok(report.lab.canvases.some(c=>Number(c.data.physicsThreads)===2),'Threaded native backend must start under isolation');
  await lab.screenshot({path:path.join(output,'physics-lab-desktop.png')});
  await lab.locator('[data-app-switch="studio"]').click();await lab.locator('#studio[data-render-ready="true"]').waitFor({timeout:120000});await lab.close();
  const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(base+'?studio=liquid',{waitUntil:'domcontentloaded'});await mobile.locator('#studio[data-render-ready="true"]').waitFor({timeout:120000});
  await mobile.locator('[data-app-switch="lab"]').waitFor({state:'visible'});
  report.mobile=await mobile.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.title}));
  assert.ok(report.mobile.scrollWidth<=report.mobile.width+8,'Mobile horizontal overflow');
  await mobile.screenshot({path:path.join(output,'liquid-mobile.png')});await mobile.close();
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{fs.writeFileSync(path.join(output,'browser-release.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));}
console.log('Browser acceptance passed: eight Studio routes, native threaded Lab, replay/export/reset, and mobile navigation.');
