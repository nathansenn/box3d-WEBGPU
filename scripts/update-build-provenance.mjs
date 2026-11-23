import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [root, artifactDir] = process.argv.slice(2);
if (!root || !artifactDir) {
  throw new Error('Usage: node scripts/update-build-provenance.mjs <root> <artifact-dir>');
}

const provenancePath = path.join(artifactDir, 'BUILD_PROVENANCE.json');
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));

const digest = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const bridgePath = path.join(root, provenance.bridge.source);
const bridgeSha256 = digest(bridgePath);
let qualificationChanged = provenance.bridge.sha256 !== bridgeSha256;
provenance.bridge.sha256 = bridgeSha256;
// The exact-checkpoint glue (the one source that reads Box3D's internal structs) is part of the bridge.
const snapshotPath = path.join(root, 'wasm/box3d_snapshot.c');
if (fs.existsSync(snapshotPath)) {
  const snapshotSha256 = digest(snapshotPath);
  if (provenance.bridge.checkpointSha256 !== snapshotSha256) qualificationChanged = true;
  provenance.bridge.checkpointSource = 'wasm/box3d_snapshot.c';
  provenance.bridge.checkpointSha256 = snapshotSha256;
}

// The other inputs of the build (docs/WASM_SIZE.md): the CMake file, the list of Box3D functions compiled for size and the
// header that compiles Box3D's recording hooks out. Recorded only in a manifest that has a `build` section.
if (provenance.build) {
  for (const [key, file] of [['cmakeSha256', 'wasm/CMakeLists.txt'], ['coldFunctionsSha256', 'wasm/box3d_cold_functions.txt'], ['noRecordingSha256', 'wasm/box3d_no_recording.h']]) {
    const filePath = path.join(root, file);
    if (fs.existsSync(filePath)) provenance.build[key] = digest(filePath);
  }
  const coldList = path.join(root, 'wasm/box3d_cold_functions.txt');
  if (fs.existsSync(coldList)) {
    provenance.build.size = {
      recordingHooks: 'compiled out (wasm/box3d_no_recording.h)',
      sizeOptimizedFunctions: fs.readFileSync(coldList, 'utf8').split('\n').filter(line => /^[a-z_]+\.c \w+$/.test(line)).length,
      sizeOptimizedFunctionList: 'wasm/box3d_cold_functions.txt, written by scripts/wasm-cold-functions.mjs',
      bridgeOptimization: '-Oz',
      solverOptimization: '-O3',
      closureCompiler: true,
    };
  }
}

for (const name of ['box3d.js', 'box3d.wasm']) {
  const artifactPath = path.join(artifactDir, name);
  const artifact = {
    bytes: fs.statSync(artifactPath).size,
    sha256: digest(artifactPath),
  };
  if (provenance.artifacts[name]?.sha256 !== artifact.sha256 || provenance.artifacts[name]?.bytes !== artifact.bytes) qualificationChanged = true;
  provenance.artifacts[name] = artifact;
}

// Hashing a new build is not a replay, isolation, GPU or reproducibility test.
// Exact rebuilds may keep the original receipts; changed inputs need fresh proof.
if (qualificationChanged) {
  provenance.bridge.deterministicDoubleBuild = false;
  provenance.validation = { status: 'not_run', reason: 'Native source or artifact changed. Run qualification before adding acceptance evidence.' };
}

fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Updated native build provenance: ${path.relative(root, provenancePath)}`);
