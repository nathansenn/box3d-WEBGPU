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
