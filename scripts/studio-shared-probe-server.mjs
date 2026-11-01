#!/usr/bin/env node
/** Development-only isolated origin; never changes production or the main dev server. */
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:4402,strictPort:true,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}}});
await server.listen();console.log('Shared snapshot development probe: http://127.0.0.1:4402/benchmarks/experiments/studio-shared-probe.html');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void server.close().finally(()=>process.exit(0)));
