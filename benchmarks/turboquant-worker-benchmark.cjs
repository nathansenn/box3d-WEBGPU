#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { performance } = require('perf_hooks');
const { SCENES } = require('../.bench-build/src/scenes.js');
const { SoftSimulationSuite } = require('../.bench-build/src/soft/simulations.js');
const { TurboQuantDeltaStream, turboQuantPacketBytes } = require('../.bench-build/src/compression/turboquant.js');

const FRAME_COUNT = Number(process.env.TQ_WORKER_FRAMES || 48);
const SAMPLES = Number(process.env.TQ_WORKER_SAMPLES || 5);
const OUTPUT = path.join(__dirname, 'results', 'turboquant-worker-benchmark.json');

function median(a){const s=[...a].sort((x,y)=>x-y);const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])/2}
function extract(surface){
  if(surface.path==='gpu-cloth')return surface.positions.slice(0,surface.vertexCount*3);
  if(surface.path==='gpu-water'){
    const count=surface.vertexCount;
    const out=new Float32Array(count*3);
    out.set(surface.eta.subarray(0,count),0);
    out.set(surface.u.subarray(0,count),count);
    out.set(surface.v.subarray(0,count),count*2);
    return out;
  }
  if(surface.path!=='packed')throw new Error(`Unsupported surface path: ${surface.path}`);
  const out=new Float32Array(surface.vertexCount*3);const f=new Float32Array(surface.vertices.buffer,surface.vertices.byteOffset,surface.vertices.byteLength/4);for(let i=0;i<surface.vertexCount;i++){out[i*3]=f[i*6];out[i*3+1]=f[i*6+1];out[i*3+2]=f[i*6+2]}return out;
}
function collect(){const scene=SCENES.find(s=>s.id===749);const suite=new SoftSimulationSuite();suite.createScene(scene,5,0x5eed1234);const frames=[];for(let i=0;i<FRAME_COUNT;i++){if(i===12)suite.kick(13);if(i===25)suite.explode([0,4,0],18,9);suite.step(1/60,4);frames.push(extract(suite.buildFrame(false).surface));}suite.destroy();return {scene,frames}}
function once(worker,message,transfer=[]){return new Promise((resolve,reject)=>{const onMessage=v=>{cleanup();resolve(v)};const onError=e=>{cleanup();reject(e)};const cleanup=()=>{worker.off('message',onMessage);worker.off('error',onError)};worker.once('message',onMessage);worker.once('error',onError);worker.postMessage(message,transfer)})}
async function reset(worker,length,options){await once(worker,{kind:'reset',length,options})}
async function rawSample(worker,frames){const start=performance.now();for(const frame of frames){const copy=frame.slice();await once(worker,{kind:'raw',buffer:copy.buffer},[copy.buffer]);}return performance.now()-start}
async function compressedSample(worker,frames,options){const encoder=new TurboQuantDeltaStream(frames[0].length,options);await reset(worker,frames[0].length,options);let bytes=0;const start=performance.now();for(const frame of frames){const p=encoder.encodeFrame(frame);const codes=p.codes.slice();const norms=p.norms.slice();const means=p.means.slice();bytes+=codes.byteLength+norms.byteLength+means.byteLength;await once(worker,{kind:'compressed',codes:codes.buffer,norms:norms.buffer,means:means.buffer},[codes.buffer,norms.buffer,means.buffer]);}return {ms:performance.now()-start,bytes}}
async function main(){const {scene,frames}=collect();const modulePath=path.resolve(__dirname,'../.bench-build/src/compression/turboquant.js');const worker=new Worker(path.join(__dirname,'turboquant-worker-thread.cjs'),{workerData:{modulePath}});const options={bits:4,blockSize:64,rotation:'structured',centered:false,seed:0x715517};await rawSample(worker,frames.slice(0,8));await compressedSample(worker,frames.slice(0,8),options);const raw=[];const compressed=[];let compressedBytes=0;for(let i=0;i<SAMPLES;i++){raw.push(await rawSample(worker,frames));const c=await compressedSample(worker,frames,options);compressed.push(c.ms);compressedBytes=c.bytes;}await worker.terminate();const rawBytes=frames.reduce((n,f)=>n+f.byteLength,0);const result={generatedAt:new Date().toISOString(),node:process.version,scene:scene.title,frames:frames.length,vectorLength:frames[0].length,options,rawBytes,compressedBytes,compressionRatio:rawBytes/compressedBytes,rawSamplesMs:raw,compressedSamplesMs:compressed,rawMedianMs:median(raw),compressedMedianMs:median(compressed),endToEndSpeedup:median(raw)/median(compressed),rawMsPerFrame:median(raw)/frames.length,compressedMsPerFrame:median(compressed)/frames.length};fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});fs.writeFileSync(OUTPUT,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
main().catch(e=>{console.error(e);process.exitCode=1});
