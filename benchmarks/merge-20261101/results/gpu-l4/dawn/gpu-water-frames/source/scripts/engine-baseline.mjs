#!/usr/bin/env node
/** Immutable, bounded source capture. No builds, servers, asset copies, or legacy writes. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MANIFEST_SCHEMA = 'box3d.engine-capture/1';
export const LIMITS = Object.freeze({ sourceBytes: 64 * 1024 ** 2, assetBytes: 512 * 1024 ** 2, files: 10000 });
export const unavailable = reason => ({ status: 'unavailable', reason });
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hashValue = value => createHash('sha256').update(canonical(value)).digest('hex');
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function parseArgs(argv, allowed) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') { options.help = true; continue; }
    if (!allowed.includes(key) || options[key] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid or duplicate option: ${key}`);
    options[key] = argv[++i];
  }
  return options;
}
export async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
export async function reserveRunDirectory(output, protectedRoots = []) {
  const requested = path.resolve(output);
  // Canonicalize existing ancestors; /tmp -> /private/tmp is harmless. Never reuse a leaf.
  await fs.mkdir(path.dirname(requested), { recursive: true });
  const parent = await fs.realpath(path.dirname(requested));
  const resolved = path.join(parent, path.basename(requested));
  for (const root of protectedRoots) {
    const real = await fs.realpath(root);
    if (resolved === real || ['src', 'wasm', 'public', 'node_modules', '.git'].some(dir => {
      const protectedPath = path.join(real, dir);
      return resolved === protectedPath || resolved.startsWith(`${protectedPath}${path.sep}`);
    })) throw new Error(`Output collides with protected input: ${resolved}`);
  }
  try { await fs.mkdir(resolved); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists; refusing to overwrite: ${resolved}`);
    throw error;
  }
  return resolved;
}

export async function inventory(root, inputs, maxBytes) {
  const files = [];
  let totalBytes = 0;
  async function visit(relative) {
    const absolute = path.join(root, relative);
    let stat;
    try { stat = await fs.lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not a frozen file: ${absolute}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      if (path.basename(relative) === '.DS_Store') return;
      totalBytes += stat.size;
      if (totalBytes > maxBytes || files.length >= LIMITS.files) throw new Error(`Inventory limit exceeded at ${absolute}`);
      const sha256 = await hashFile(absolute);
      const after = await fs.stat(absolute);
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ino !== after.ino) throw new Error(`Input changed while hashing: ${absolute}`);
      files.push({ path: relative.split(path.sep).join('/'), bytes: stat.size, sha256 });
    } else throw new Error(`Unsupported file type: ${absolute}`);
  }
  for (const input of inputs) await visit(input);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { status: 'measured', files, bytes: totalBytes, sha256: hashValue(files) };
}

let runtimeCache;
export async function observeEnvironment() {
  if (!runtimeCache) runtimeCache = (async () => {
    const cpu = os.cpus();
    const runtime = { status: 'measured', name: 'node', version: process.version, versions: process.versions,
      executableSha256: await hashFile(process.execPath), execArgv: process.execArgv.filter(a => !a.startsWith('--test')),
      nodeOptionsSha256: hashValue(process.env.NODE_OPTIONS || ''), nodeOptionsPresent: Boolean(process.env.NODE_OPTIONS),
      platform: process.platform, arch: process.arch, typescript: 'node-native-type-stripping' };
    const hardware = { status: 'measured', osType: os.type(), osRelease: os.release(), arch: os.arch(),
      logicalCpus: cpu.length, cpuModels: [...new Set(cpu.map(c => c.model))].sort(), totalMemoryBytes: os.totalmem(),
      physicalGpu: unavailable('No GPU queried by this CPU-only process'),
      thermalState: unavailable('No thermal sensor collected'), powerMode: unavailable('No power mode collected') };
    return { runtime, hardware, browser: unavailable('No browser launched'),
      gpu: unavailable('No GPU device, timestamps, or frame measurements'),
      renderer: unavailable('No renderer executed') };
  })();
  return runtimeCache;
}

export function manifestIdentity(manifest) {
  return { sourceSha256: manifest.source.sha256, artifactSha256: manifest.artifacts.sha256,
    assetSha256: manifest.assets.status === 'measured' ? manifest.assets.sha256 : null,
    runtimeSha256: hashValue(manifest.environment.runtime), hardwareSha256: hashValue(manifest.environment.hardware) };
}
export function verifyManifestStructure(manifest) {
  const issues = [];
  if (manifest?.schema !== MANIFEST_SCHEMA) return ['Unknown capture schema'];
  for (const group of ['source', 'artifacts', 'assets']) {
    const item = manifest[group];
    if (item?.status !== 'measured') { if (group !== 'assets') issues.push(`Missing measured ${group}`); continue; }
    if (!Array.isArray(item.files) || item.sha256 !== hashValue(item.files)) issues.push(`${group} inventory hash mismatch`);
    else {
      const paths = new Set();
      for (const file of item.files) {
        if (!file || typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..') || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) issues.push(`${group} invalid file identity`);
        paths.add(file?.path);
      }
    }
  }
  if (manifest.source?.files?.length === 0 || manifest.artifacts?.files?.length === 0) issues.push('Empty source/artifact inventory');
  try { if (canonical(manifest.identity) !== canonical(manifestIdentity(manifest))) issues.push('Manifest identity mismatch'); } catch { issues.push('Malformed identity'); }
  const { contentSha256, ...body } = manifest;
  if (contentSha256 !== hashValue(body)) issues.push('Manifest content hash mismatch');
  return issues;
}

export async function captureBaseline({ root, out, assetsRoot, reserved = false }) {
  root = await fs.realpath(root);
  out = reserved ? out : await reserveRunDirectory(out, [root]);
  const configs = (await fs.readdir(root)).filter(f => /^(?:tsconfig.*\.json|vite\.config\.[cm]?[jt]s|index\.html|package(?:-lock)?\.json)$/.test(f));
  const source = await inventory(root, ['src', 'wasm', ...configs], LIMITS.sourceBytes);
  if (!source.files.some(f => f.path === 'src/studio/physics.ts')) throw new Error('Source root must contain src/studio/physics.ts');
  const snapshotRoot = path.join(out, 'source');
  await fs.mkdir(snapshotRoot);
  for (const file of source.files) {
    const destination = path.join(snapshotRoot, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Exclusive creation plus byte verification catches concurrent edits during copy.
    const input = await fs.readFile(path.join(root, file.path));
    if (createHash('sha256').update(input).digest('hex') !== file.sha256) throw new Error(`Source changed during capture: ${file.path}`);
    await fs.writeFile(destination, input, { flag: 'wx' });
  }
  const stableSource = await inventory(root, ['src', 'wasm', ...configs], LIMITS.sourceBytes);
  if (stableSource.sha256 !== source.sha256) throw new Error('Source root changed during capture; retain this partial directory and use a new run');
  let assets;
  let assetPath = path.resolve(assetsRoot ?? path.join(root, 'public'));
  try { assetPath = await fs.realpath(assetPath); assets = await inventory(assetPath, ['.'], LIMITS.assetBytes); }
  catch (error) { if (!assetsRoot && error.code === 'ENOENT') assets = unavailable('public/ absent from this source-only checkout'); else throw error; }
  const artifactFiles = source.files.filter(f => f.path.startsWith('src/') && /\.[cm]?ts$/.test(f.path));
  const artifacts = { status: 'measured', kind: 'typescript-source-inputs', files: artifactFiles,
    bytes: artifactFiles.reduce((n, f) => n + f.bytes, 0), sha256: hashValue(artifactFiles),
    build: unavailable('Node strips types in memory; no bundled JS, WASM, or browser artifact was executed') };
  let git;
  try { git = { status: 'measured', head: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() }; }
  catch { git = unavailable('Source root has no accessible Git HEAD; content hashes are authoritative'); }
  const body = { schema: MANIFEST_SCHEMA, capturedAt: new Date().toISOString(), originalRoot: root,
    snapshotRoot: 'source', assetsRoot: assets.status === 'measured' ? assetPath : null,
    scope: 'Studio CPU reduced model; asset inventory is provenance only and is not loaded by the benchmark',
    source, artifacts, assets, git, environment: await observeEnvironment() };
  body.identity = manifestIdentity(body);
  const manifest = { ...body, contentSha256: hashValue(body) };
  await writeJsonExclusive(path.join(out, 'manifest.json'), manifest);
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), ['--root', '--out', '--assets-root']);
  if (options.help) { console.log('node scripts/engine-baseline.mjs --root SOURCE_ROOT --out NEW_DIRECTORY [--assets-root SHARED_PUBLIC]'); return; }
  if (!options['--root'] || !options['--out']) throw new Error('--root and --out are required; output must not exist');
  const manifest = await captureBaseline({ root: options['--root'], out: options['--out'], assetsRoot: options['--assets-root'] });
  console.log(JSON.stringify({ manifest: path.resolve(options['--out'], 'manifest.json'), identity: manifest.identity }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
