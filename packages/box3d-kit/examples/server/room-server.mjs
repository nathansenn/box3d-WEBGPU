// Authoritative room server: simulates at 60 Hz in Node, streams compact
// snapshots to every client over Server-Sent Events, and accepts "throw"
// commands. Clients only decode and draw (see index.html).
//
//   npm run build && node examples/server/room-server.mjs   # prints the URL
//
// Binds to 127.0.0.1 only. No dependencies beyond Node.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorld, SnapshotEncoder, BodyRing} from '../../dist/index.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.map': 'application/json'};

export async function startRoomServer({port = 0, sendHz = 30, seed = 2026} = {}) {
  const world = await createWorld({seed});
  for (let i = 0; i < 48; i++) world.spawnBox({position: [(i % 8) - 3.5, 0.5 + Math.floor(i / 8) * 1.05, 0], halfSize: 0.48});
  const projectiles = new BodyRing(world, 40);
  const clients = new Set();
  let throws = 0;

  const sim = setInterval(() => world.step(), 1000 / 60);
  const send = setInterval(() => {
    for (const client of clients) {
      const bytes = client.encoder.encode(world);
      client.res.write(`data: ${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}\n\n`);
    }
  }, 1000 / sendHz);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/stream') {
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
      const client = {res, encoder: new SnapshotEncoder()}; // new encoder: first frame is a keyframe
      clients.add(client);
      req.on('close', () => clients.delete(client));
      return;
    }
    if (url.pathname === '/throw' && req.method === 'POST') {
      const x = (throws++ % 7) - 3;
      projectiles.spawn({position: [x, 6, 12], halfSize: 0.35, impulse: [0, 4, -35]});
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/stats') {
      res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({...world.stats(), clients: clients.size, hash: world.exactHash()}));
      return;
    }
    // Static files from the package root only (for the browser client and dist/).
    const path = normalize(join(ROOT, url.pathname === '/' ? 'examples/server/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, {'content-type': TYPES[extname(path)] ?? 'application/octet-stream'}).end(body);
    } catch { res.writeHead(404).end(); }
  });

  await new Promise(done => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    world,
    async close() {
      clearInterval(sim); clearInterval(send);
      for (const client of clients) client.res.end();
      await new Promise(done => server.close(done));
      world.dispose();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const room = await startRoomServer({port: Number(process.env.PORT ?? 8787)});
  console.log(`room server on ${room.url} (open it in a browser; POST ${room.url}throw to throw a box)`);
}
