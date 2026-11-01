#!/usr/bin/env node
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const softwareVulkan=args.includes('--software-vulkan'),software=args.includes('--software-gpu')||softwareVulkan,hardwareVulkan=!software&&args.includes('--hardware-vulkan'),renderParity=args.includes('--render-parity');
const profile=softwareVulkan?'software-vulkan':software?'software':hardwareVulkan?'hardware-vulkan':'default';
const output=resolve(root,value('--out')??'benchmarks/math-runtime/results/'+(renderParity?'render-parity-offscreen':'browser')+'-'+profile+'.json');
const url=value('--url')??'http://127.0.0.1:4317/benchmarks/math-runtime/'+(renderParity?'render-parity':'index')+'.html';
let playwright;
if(value('--playwright-path'))playwright=await import(pathToFileURL(resolve(value('--playwright-path'))).href);
else try{playwright=await import('playwright');}catch(e){if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw e;playwright=await import(pathToFileURL(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const executablePath=value('--executable-path')??process.env.BOX3D_BROWSER_EXECUTABLE;
// --hardware-vulkan: headless Linux with a physical GPU through Dawn's Vulkan backend; developer features remove timestamp quantization.
// BOX3D_HARDWARE_ARGS (space-separated) replaces that flag list when a host needs different flags.
const launchArgs=softwareVulkan?['--enable-unsafe-webgpu','--use-angle=vulkan','--use-vulkan=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface']:software?['--enable-unsafe-webgpu','--use-angle=swiftshader']:hardwareVulkan?(process.env.BOX3D_HARDWARE_ARGS?process.env.BOX3D_HARDWARE_ARGS.split(/\s+/).filter(Boolean):['--enable-unsafe-webgpu','--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist','--enable-webgpu-developer-features']):[];
const browser=await playwright.chromium.launch({headless:true,args:launchArgs,...(executablePath?{executablePath}:{channel:'chromium'})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),pageErrors=[],consoleErrors=[];
 page.on('pageerror',e=>{pageErrors.push(e.message);console.error(e.message);});
 page.on('console',e=>{if(e.type()==='error'){consoleErrors.push(e.text());console.error(e.text());}});
 await page.goto(url,{waitUntil:'networkidle',timeout:30000});
 const entry=renderParity?'runBox3dRenderParity':'runBox3dMathBenchmark';
 await page.waitForFunction(n=>typeof window[n]==='function',entry,{timeout:15000});
 const report=await page.evaluate(async({entry,quick})=>window[entry]({quick}),{entry,quick:args.includes('--quick')});
 report.provenance.browserVersion=browser.version();report.provenance.browserExtraArguments=launchArgs;
 report.provenance.browserLaunchProfile=softwareVulkan?'Explicit SwiftShader Vulkan software profile':software?'Explicit software fallback profile':hardwareVulkan?'Explicit hardware Vulkan profile (headless Linux, unquantized timestamps)':'Playwright standard headless profile; no additional GPU flags';
 report.provenance.browserExecutable=executablePath??'Playwright Chromium channel';
 report.provenance.recoveryNote='Fresh run after workspace reset. Earlier raw sample files were lost; this rerun supersedes them.';
 try{const session=await browser.newBrowserCDPSession();report.provenance.browserFullArguments=(await session.send('Browser.getBrowserCommandLine')).arguments;await session.detach();}catch(e){report.provenance.browserCommandLineUnavailable=e.message;}
 report.provenance.automation={url,viewport:{width:1440,height:1000},deviceScaleFactor:1,pageErrors,consoleErrors};
 if(pageErrors.length)report.status='FAILED';
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 if(value('--screenshot'))await page.screenshot({path:resolve(root,value('--screenshot')),fullPage:false});
 console.log(JSON.stringify({output,status:report.status,gpu:report.gpu,coverage:report.comparisonCoverage,gpuQualification:report.gpuQualification,reason:report.reason,pageErrors,consoleErrors,cases:report.cases.map(c=>({id:c.id??'steps-'+c.steps,status:c.status,pixels:c.pixels,waterCoveragePixels:c.waterCoveragePixels,timings:Object.fromEntries(Object.entries(c.timings??{}).map(([n,t])=>[n,{status:t.status,p50:t.completion?.p50??t.wallCompletion?.p50,gpuP50:t.gpuTimestamp?.p50}]))})),uploadOverhead:report.uploadOverhead?.cases.map(c=>({id:c.id,status:c.status,baselineP50:c.baseline.p50,currentP50:c.current.p50}))},null,2));
 if(report.status==='FAILED')process.exitCode=1;
}finally{await browser.close();}

