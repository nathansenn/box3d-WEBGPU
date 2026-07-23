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
provenance.bridge.sha256 = digest(bridgePath);

for (const name of ['box3d.js', 'box3d.wasm']) {
  const artifactPath = path.join(artifactDir, name);
  provenance.artifacts[name] = {
    bytes: fs.statSync(artifactPath).size,
    sha256: digest(artifactPath),
  };
}

fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Updated native build provenance: ${path.relative(root, provenancePath)}`);
