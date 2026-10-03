// Records the identity of the pthread artifact (box3d-mt.{js,wasm}) in BUILD_PROVENANCE.json under `threaded`.
// It follows update-build-provenance.mjs: an exact rebuild keeps the qualification attached to those hashes, and any
// change to the threaded sources or artifacts invalidates `threaded.validation` instead of relabelling it.
// The top-level `bridge`, `artifacts` and `validation` of the single-threaded artifact are never touched here.
// usage: node scripts/update-threaded-provenance.mjs <repo-root> <artifact-dir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const root = path.resolve(process.argv[2] ?? '.');
const artifactDir = path.resolve(process.argv[3] ?? path.join(root, 'public/box3d'));
const manifestPath = path.join(artifactDir, 'BUILD_PROVENANCE.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing. Run npm run build:wasm:mt first.`);
  return fs.readFileSync(file);
};

if (!fs.existsSync(manifestPath)) throw new Error(`${manifestPath} is missing. Run npm run build:wasm first.`);
const provenance = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const previous = provenance.threaded ?? {};
const sources = {
  threadsSha256: sha(read(path.join(root, 'wasm/box3d_threads.c'))),
  bridgeSha256: sha(read(path.join(root, provenance.bridge?.source ?? 'wasm/box3d_web.c'))),
  cmakeSha256: sha(read(path.join(root, 'wasm/CMakeLists.txt'))),
};
const artifacts = {};
for (const name of ['box3d-mt.js', 'box3d-mt.wasm']) {
  const bytes = read(path.join(artifactDir, name));
  artifacts[name] = {bytes: bytes.byteLength, sha256: sha(bytes)};
}

const threaded = {
  ...previous,
  source: 'wasm/box3d_threads.c',
  bridge: 'wasm/box3d_web.c compiled unchanged; b3CreateWorld and b3World_Step renamed per source',
  sources,
  artifacts,
  build: {
    configuration: 'Release',
    simd: true,
    pthreads: true,
    sharedMemory: true,
    memoryGrowth: true,
    environment: 'web,worker,node',
    poolSize: "Module['b3wPoolSize'], preloaded",
    poolSizeStrict: 2,
    maxWorkers: 32,
    emscripten: process.env.B3W_EMSCRIPTEN_VERSION ?? previous.build?.emscripten ?? provenance.toolchain?.emscripten,
  },
  execution: 'one shared scheduler; worlds step one at a time on the calling thread, widening past an awake-body threshold',
};

const unchanged = isDeepStrictEqual(previous.sources, sources) && isDeepStrictEqual(previous.artifacts, artifacts);
if (!unchanged || !previous.validation) {
  threaded.validation = {
    status: 'not_run',
    reason: previous.validation
      ? 'Threaded source or artifact changed. Run npm run test:threaded before adding acceptance evidence.'
      : 'No threaded qualification recorded yet. Run npm run test:threaded before adding acceptance evidence.',
  };
}

provenance.threaded = threaded;
fs.writeFileSync(manifestPath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Recorded threaded provenance (${unchanged ? 'unchanged' : 'updated'}; validation ${threaded.validation.status}) in ${manifestPath}`);
