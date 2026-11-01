#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), port = Number(process.env.BOX3D_RENDER_PORT ?? 4318);
createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://127.0.0.1:' + port), pathname = decodeURIComponent(url.pathname);
        if (pathname === '/favicon.ico') {
            response.writeHead(204);
            response.end();
            return;
        }
        if (pathname === '/') {
            response.writeHead(302, { Location: '/benchmarks/rendering/index.html' });
            response.end();
            return;
        }
        let relative;
        if (/^\/benchmarks\/rendering\/[a-z0-9-]+\.(?:mjs|html|json)$/.test(pathname))
            relative = pathname.slice(1);
        else if (/^\/compiled\/(?:baseline|candidate)\/src\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.mjs$/.test(pathname))
            relative = '.bench-build/rendering/' + pathname.slice('/compiled/'.length);
        else if (pathname === '/provenance.json')
            relative = '.bench-build/rendering/provenance.json';
        else if (/^\/textures\/[a-z0-9-]+\.ktx2$/.test(pathname))
            relative = 'public' + pathname;
        else {
            response.writeHead(404);
            response.end('Not a rendering benchmark resource');
            return;
        }
        const bytes = await readFile(resolve(root, relative));
        response.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.ktx2': 'image/ktx2' }[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
        response.end(bytes);
    }
    catch (e) {
        response.writeHead(e.code === 'ENOENT' ? 404 : 500);
        response.end(e.message);
    }
}).listen(port, '127.0.0.1', () => console.log('Rendering benchmark http://127.0.0.1:' + port));
