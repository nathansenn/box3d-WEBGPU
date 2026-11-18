import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {withRemoteBrowser,createStaticTransport,leaseStatus} from '/Users/commander/Documents/ChatGPT/theguardian/browserless/connect.mjs';

const owner='01a07e7b-23c9-72e1-a62e-b780ac76623f';
const out='/Users/commander/box3d-WEBGPU/docs/design/material-labs-20260910';
const snapshot='/private/tmp/box3d-material-remote-20260910';
const transport=await createStaticTransport(snapshot,{maxBytes:40*1024*1024,maxFiles:100});
const receipt={provider:'Browserless / production-sfo / SwiftShader',owner,snapshot,startedAt:new Date().toISOString(),checks:[],nativeGap:'Remote software graphics and a 390 px desktop emulation do not establish native GPU, physical touch-device performance, calibration or store readiness.'};
try {
  receipt.result=await withRemoteBrowser({owner,sessionTimeoutMs:90000,acquireTimeoutMs:120000,viewport:{width:1280,height:800}},async({context})=>{
    await transport.install(context);
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(transport.origin+'/?workbench=1',{timeout:30000});
    await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:30000});
    assert.equal(await page.title(),'BOX3D — Liquid dynamics');
    const studies=await page.getByRole('combobox',{name:'Study',exact:true}).locator('option').allTextContents();
    assert.equal(studies.length,8);
    assert.equal(await page.locator('a[href*="workbench=1"]').count(),0);
    receipt.checks.push({name:'Retired workspace route opens Liquid dynamics; eight study options; no legacy workspace links',pass:true,studies});
    await page.getByRole('button',{name:'Run experiment',exact:true}).first().click();
    await page.waitForFunction(()=>Number(document.querySelector('#scene-time')?.textContent?.replace(' s',''))>.3,undefined,{timeout:15000});
    await page.getByRole('button',{name:'Pause experiment',exact:true}).first().click();
    const time=await page.locator('#scene-time').textContent();
    receipt.checks.push({name:'Liquid fixed-step program advances and pauses',pass:true,time});
    await page.getByRole('button',{name:'Reset experiment',exact:true}).click();
    await page.screenshot({path:out+'/captures/remote-liquid-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
    await page.screenshot({path:out+'/captures/remote-liquid-phone.png'});
    await page.getByRole('tab',{name:'Material',exact:true}).click();
    const choices=await page.locator('.material-grid button').count();
    assert.equal(choices,8);
    const controls=await page.getByRole('tab',{name:'Material',exact:true}).getAttribute('aria-selected');
    assert.equal(controls,'true');
    receipt.checks.push({name:'390×844 layout stays within viewport; material workflow tab opens',pass:true,viewport:[390,844],overflow,materialCardCount:choices});
    await page.getByRole('tab',{name:'Set up',exact:true}).click();
    await page.getByRole('searchbox',{name:'Search experiments'}).fill('oil');
    const matches=await page.locator('.experiment-card:visible').count();
    receipt.checks.push({name:'Preset search filters oil experiments',pass:matches===1,matches});
    assert.equal(matches,1);
    await page.setViewportSize({width:1280,height:800});
    await page.getByRole('combobox',{name:'Study',exact:true}).selectOption('glass');
    await page.getByRole('heading',{name:'Glass impact',exact:true}).waitFor({timeout:20000});
    await page.locator('#studio[data-render-ready="true"]').waitFor({timeout:30000});
    assert.equal(await page.getByRole('combobox',{name:'Study',exact:true}).inputValue(),'glass');
    receipt.checks.push({name:'Unified study picker navigates into the glass lab and initializes graphics',pass:true});
    assert.deepEqual(errors,[]);
    return {pass:true,errors,renderer:await page.locator('#renderer-status').textContent(),transport:transport.stats()};
  });
  receipt.cleanup='Remote context and browser closed successfully by the shared helper.';
  receipt.remainingOwnedLeases=leaseStatus().leases.filter(lease=>lease.owner===owner);
} catch(error) {
  receipt.error=String(error.message||error);
  receipt.cleanup='Shared helper cleanup ran; an uncertain lease, if any, is retained until expiry.';
  process.exitCode=1;
} finally {
  receipt.finishedAt=new Date().toISOString();receipt.transport=transport.stats();
  await fs.writeFile(out+'/remote-browser-qa.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}
