#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),port=Number(process.env.BOX3D_BENCH_PORT??4317);
// The renderer's runtime import graph (scripts/emit-typescript-module-tree.mjs lists it) must stay inside this allowlist.
const allowed=/^(?:benchmarks\/math-runtime\/[a-z0-9-]+\.(?:mjs|html|json)|src\/(?:soft\/water-reference|webgpu\/(?:water-compute|water-surface-plan|renderer|instance-visibility|instance-partition|gpu-timing|resident-water-surface|startup-budget)|runtime\/execution-graph|math|assets\/ktx2)(?:\.(?:ts|js))?|soft-kernels-(?:scalar|simd)\.wasm|textures\/[a-z0-9-]+\.ktx2)$/;
createServer(async(request,response)=>{
 try{
  const url=new URL(request.url,'http://127.0.0.1:'+port);if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(url.pathname==='/'){response.writeHead(302,{Location:'/benchmarks/math-runtime/index.html'});response.end();return;}
  let path=decodeURIComponent(url.pathname).replace(/^\//,'');if(!allowed.test(path)){response.writeHead(404);response.end('Not a benchmark resource');return;}
  if(path.startsWith('src/'))path=path.endsWith('.js')?path.slice(0,-3)+'.ts':path.endsWith('.ts')?path:path+'.ts';
  const file=resolve(root,path.endsWith('.wasm')||path.startsWith('textures/')?'public/'+path:path),bytes=await readFile(file);
  let body=bytes,type={'.html':'text/html','.mjs':'text/javascript','.ts':'text/javascript','.json':'application/json','.wasm':'application/wasm'}[extname(file)]??'application/octet-stream';
  if(url.searchParams.has('raw')){body='export default '+JSON.stringify(bytes.toString('utf8'))+';\n';type='text/javascript';}
  else if(file.endsWith('.ts'))body=stripTypeScriptTypes(bytes.toString('utf8'),{mode:'transform'});
  response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});response.end(body);
 }catch(e){response.writeHead(e.code==='ENOENT'?404:500);response.end(e.message);}
}).listen(port,'127.0.0.1',()=>console.log('Benchmark server http://127.0.0.1:'+port));

