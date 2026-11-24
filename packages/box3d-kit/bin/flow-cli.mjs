#!/usr/bin/env node
// Runs a flow study (box3d-flow-study/1) and writes its result (box3d-flow-result/1). See docs/FLOW.md.
//
//   box3d-flow study.json --out result.json [--quiet] [--setup]
//
//   --out <file>   where the result goes (standard output without it)
//   --quiet        no progress lines
//   --setup        print the set-up (grid, time step, Reynolds number, run lengths) as JSON and stop
//
// Meshes given by "file" in the study are read relative to the study file: .stl (binary or ASCII), .obj, or .json
// with {positions, indices}. Progress goes to standard error. Exit codes: 0 converged, 2 ran to its step limit without
// converging (the result is still written), 1 on an invalid study, a missing file or a diverged run.
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The built package, or, in the repository before a build, the TypeScript sources (Node 22.18 and later strip the types). */
async function load(name, source) {
  const built = resolve(here, '../dist', `${name}.js`);
  if (existsSync(built)) return import(pathToFileURL(built).href);
  const sources = source.map(file => resolve(here, '../../../src/engine', file));
  if (sources.every(existsSync)) {
    const modules = await Promise.all(sources.map(file => import(pathToFileURL(file).href)));
    return Object.assign({}, ...modules);
  }
  throw new Error(`box3d-flow: ${built} is missing; build the package first (npm run build).`);
}

function packageVersion() {
  try { return JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version ?? null; } catch { return null; }
}
/** The commit of the repository the command runs from, read from .git without running git; null when there is none. */
function gitCommit() {
  try {
    let dir = resolve(here, '../../..'), git = resolve(dir, '.git');
    if (!existsSync(git)) return null;
    if (!statSync(git).isDirectory()) { const m = /gitdir: (.*)/.exec(readFileSync(git, 'utf8')); if (!m) return null; git = resolve(dir, m[1].trim()); }
    const head = readFileSync(resolve(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5), loose = resolve(git, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    // a worktree keeps its refs in the common directory
    const common = existsSync(resolve(git, 'commondir')) ? resolve(git, readFileSync(resolve(git, 'commondir'), 'utf8').trim()) : git;
    if (existsSync(resolve(common, ref))) return readFileSync(resolve(common, ref), 'utf8').trim();
    const packed = existsSync(resolve(common, 'packed-refs')) ? readFileSync(resolve(common, 'packed-refs'), 'utf8') : '';
    const line = packed.split('\n').find(l => l.endsWith(' ' + ref));
    return line ? line.split(' ')[0] : null;
  } catch { return null; }
}

function usage(code) {
  console.error('box3d-flow <study.json> [--out result.json] [--quiet] [--setup]');
  process.exit(code);
}

const args = process.argv.slice(2);
let studyFile = null, outFile = null, quiet = false, setupOnly = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--out') { outFile = args[++i]; if (!outFile) usage(1); }
  else if (arg === '--quiet') quiet = true;
  else if (arg === '--setup') setupOnly = true;
  else if (arg === '--help' || arg === '-h') usage(0);
  else if (arg.startsWith('--')) { console.error(`box3d-flow: unknown option ${arg}`); usage(1); }
  else if (studyFile === null) studyFile = arg;
  else usage(1);
}
if (studyFile === null) usage(1);

try {
  const flow = await load('flow', ['flow-study.ts', 'flow.ts']);
  const study = JSON.parse(readFileSync(studyFile, 'utf8'));
  const base = dirname(resolve(studyFile));
  const loadMesh = file => {
    const path = resolve(base, file), ext = extname(path).toLowerCase();
    if (ext === '.json') {
      const mesh = JSON.parse(readFileSync(path, 'utf8'));
      if (!mesh || !Array.isArray(mesh.positions)) throw new Error(`${file}: a .json mesh holds {positions, indices}.`);
      return {positions: mesh.positions, indices: mesh.indices};
    }
    if (ext !== '.stl' && ext !== '.obj') throw new Error(`${file}: meshes are read from .stl, .obj and .json files.`);
    return loadGeometry(path, ext);
  };
  let geometryModule = null;
  const merge = meshes => {
    // several meshes of one file become one list of triangles
    const positions = [], indices = [];
    for (const mesh of meshes) {
      const base = positions.length / 3, p = mesh.positions ?? mesh.vertices;
      for (let i = 0; i < p.length; i++) positions.push(p[i]);
      for (let i = 0; i < mesh.indices.length; i++) indices.push(base + mesh.indices[i]);
    }
    return {positions, indices};
  };
  const loadGeometry = (path, ext) => {
    if (!geometryModule) throw new Error('internal: the geometry module is not loaded.');
    return ext === '.stl' ? merge([geometryModule.parseSTL(readFileSync(path))]) : merge(geometryModule.parseOBJ(readFileSync(path, 'utf8')));
  };
  if (Array.isArray(study?.geometry) && study.geometry.some(item => item && typeof item.file === 'string' && !item.file.toLowerCase().endsWith('.json'))) {
    geometryModule = await load('geometry', ['geometry.ts']);
  }
  const loadDocument = file => JSON.parse(readFileSync(resolve(base, file), 'utf8'));
  // where the solver came from: the package version, the build's source commit when it was recorded, this file's path
  const provenance = {cli: 'box3d-flow', solverVersion: flow.FLOW_SOLVER_VERSION ?? null, package: packageVersion(), sourceCommit: flow.FLOW_SOURCE_COMMIT ?? gitCommit()};
  const options = {loadMesh, loadDocument, provenance};
  const setup = flow.flowStudySetup(study, options);
  const g = setup.grid;
  const summary = {
    name: setup.name, mode: setup.mode, cell: g.cell, cells: [g.nx, g.ny, g.nz], total: (g.nx + 2) * (g.ny + 2) * (g.nz + 2),
    referenceSpeed: setup.referenceSpeed, referenceLength: setup.referenceLength, reynolds: setup.reynolds,
    transitTime: setup.transitTime, run: setup.run, warnings: setup.warnings,
  };
  if (setupOnly) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
  if (!quiet) {
    console.error(`box3d-flow: ${setup.mode} study${setup.name ? ` "${setup.name}"` : ''}: ${g.nx} x ${g.ny} x ${g.nz} cells of ${g.cell.toPrecision(4)} m, Re ${setup.reynolds.toExponential(2)}, at most ${setup.run.maxSteps} steps`);
    for (const warning of setup.warnings) console.error(`  warning: ${warning}`);
  }
  let last = 0;
  const started = Date.now();
  const result = flow.runFlowStudy(study, {
    ...options,
    onProgress: quiet ? undefined : p => {
      const now = Date.now();
      if (now - last < 1000 && p.step < p.maxSteps) return;
      last = now;
      const tail = p.coefficients ? `Cd ${p.coefficients.cd.toFixed(4)} Cl ${p.coefficients.cl.toFixed(4)} Cs ${p.coefficients.cs.toFixed(4)}` : `mass balance ${p.massBalance.toExponential(2)}`;
      console.error(`  step ${String(p.step).padStart(7)} / ${p.maxSteps}  ${(100 * p.fraction).toFixed(0).padStart(3)}%  ${p.phase.padEnd(9)} window ${p.window}  residual ${p.residual.toExponential(2)}  ${tail}  ${((now - started) / 1000).toFixed(0)} s`);
    },
  });
  const text = JSON.stringify(result);
  if (outFile) writeFileSync(outFile, text); else process.stdout.write(text + '\n');
  if (!quiet) {
    const r = result.run, c = result.forces.coefficients;
    console.error(`box3d-flow: ${r.steps} steps in ${r.wallTime.toFixed(1)} s (${(r.cellUpdatesPerSecond / 1e6).toFixed(1)} million cell updates per second), ${r.converged ? 'converged' : 'NOT converged'} (${r.reason})`);
    if (c) console.error(`  Cd ${c.cd.toFixed(4)}  Cl ${c.cl.toFixed(4)}  Cs ${c.cs.toFixed(4)}  reference area ${c.referenceArea.toPrecision(4)} m^2`);
    else console.error(`  inflow ${result.flow.inflow.toPrecision(5)} m^3/s, outflow ${result.flow.outflow.toPrecision(5)} m^3/s, mass balance ${result.flow.massBalance.toExponential(2)}`);
    for (const warning of result.warnings) console.error(`  warning: ${warning}`);
    if (outFile) console.error(`  wrote ${outFile} (${(text.length / 1024).toFixed(0)} KiB)`);
  }
  process.exit(result.run.converged ? 0 : 2);
} catch (error) {
  console.error(`box3d-flow: ${error?.message ?? error}`);
  process.exit(1);
}
