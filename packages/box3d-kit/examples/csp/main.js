import {createWorld, BUILD_INFO} from '../../dist/index.js';
import {connectWorld} from '../../dist/worker.js';

const out = document.getElementById('out');
try {
  const world = await createWorld({integrity: true});
  world.spawnBox({position: [0, 3, 0]});
  for (let i = 0; i < 180; i++) world.step();
  const local = world.exactHash();
  world.dispose();
  const remote = await connectWorld(new Worker(new URL('../worker/physics.worker.js', import.meta.url), {type: 'module'}));
  await remote.spawnBox({position: [0, 3, 0]});
  for (let i = 0; i < 180; i++) await remote.stepOnce();
  const workerHash = await remote.exactHash();
  await remote.dispose();
  document.title = `csp-ok ${local} ${workerHash}`;
  out.textContent = `Loaded under strict CSP with integrity check (wasm ${BUILD_INFO.wasmSha256.slice(0, 12)}…). main=${local} worker=${workerHash}`;
} catch (error) {
  document.title = `csp-fail ${error.code ?? ''} ${error.message}`;
  out.textContent = String(error.stack ?? error);
}
