// Copies the repository's canonical engine sources and prebuilt WASM into the
// package so the published tarball is self-contained. The app remains the
// single source of truth; this script only rewires the two app-only type
// imports to the package's minimal backend contract, and records build
// provenance (artifact SHA-256, upstream Box3D ref) for runtime verification.
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repo = resolve(pkg, '../..');

export const CORE = [
  {
    from: 'src/engine/native-world.ts',
    rewrites: [
      ["import type { PhysicsBackend } from '../types.ts';", "import type { PhysicsBackend } from '../backend-types.js';"],
      ["import type { ScenePreset } from '../scenes.ts';", "import type { ScenePreset } from '../backend-types.js';"],
    ],
  },
  {from: 'src/engine/contracts.ts', rewrites: []},
  // ./gameplay: the capsule character on Box3D's mover. Imports contracts.ts, checkpoint.ts and types from native-world.ts.
  {from: 'src/engine/character-controller.ts', rewrites: []},
  // ./gameplay: the wheel-joint vehicle. Imports contracts.ts, checkpoint.ts and types from native-world.ts.
  {from: 'src/engine/vehicle.ts', rewrites: []},
  // ./gameplay: the roles of a scene file (character, platform, vehicle, laser). Imports the two above.
  {from: 'src/engine/scene-roles.ts', rewrites: []},
  // Exact checkpoints: state trees, their encoding and the self-checking container. Imports contracts.ts only; the world,
  // the solvers and the Simulation use it.
  {from: 'src/engine/checkpoint.ts', rewrites: []},
  // Optional modules (subpath exports ./cable, ./water, ./coupling, ./frame, ./heat, ./solid). Self-contained apart from contracts.ts
  // and checkpoint.ts.
  {from: 'src/engine/compliant-cable.ts', rewrites: []},
  // The envelope Cholesky used by the cable runtime's Newton solver and the frame runtime's direct solver.
  {from: 'src/engine/envelope-matrix.ts', rewrites: []},
  {from: 'src/engine/linear-water.ts', rewrites: []},
  {from: 'src/engine/closed-water.ts', rewrites: []},
  {from: 'src/engine/water-coupling.ts', rewrites: []},
  {from: 'src/engine/frame-element.ts', rewrites: []},
  {from: 'src/engine/frame-runtime.ts', rewrites: []},
  {from: 'src/engine/heat.ts', rewrites: []},
  {from: 'src/engine/solid-mesh.ts', rewrites: []},
  // The concrete law of the solid (Drucker-Prager and Rankine with crack-band softening). Imports contracts.ts only.
  {from: 'src/engine/concrete-law.ts', rewrites: []},
  // Sparse LDLᵀ factorization: the solid's optional preconditioner (linearSolver: 'ldl'). Self-contained.
  {from: 'src/engine/sparse-ldl.ts', rewrites: []},
  {from: 'src/engine/solid.ts', rewrites: []},
  // ./structure: cables and frames <-> rigid bodies. Imports contracts.ts, checkpoint.ts and only types from the cable and frame modules.
  {from: 'src/engine/structure-coupling.ts', rewrites: []},
  // ./scene and ./geometry: the scene format (validator, canonical form, link codec, builder), its example scenes and
  // the geometry import. The Physics Lab uses the same files. They import only contracts.ts and types from native-world.ts.
  {from: 'src/engine/scene-format.ts', rewrites: []},
  {from: 'src/engine/scene-examples.ts', rewrites: []},
  {from: 'src/engine/geometry.ts', rewrites: []},
  // ./simulation: the one stepping loop, the adapters for the modules above and the builder of coupled scenes.
  // Imports checkpoint.ts, the water, structure, cable, frame, cloth, granular, heat, solid, solid-contact, fracture, fluid and shallow-water
  // modules, scene-format (for a checkpoint's scene) and types from native-world.
  {from: 'src/engine/simulation.ts', rewrites: []},
  // ./robot: URDF and MJCF import. Imports contracts.ts, geometry.ts and types from native-world.ts and scene-format.ts.
  {from: 'src/engine/robot-import.ts', rewrites: []},
  // ./fracture: cohesive and crack-band fracture of tetrahedral solids. Imports contracts.ts, checkpoint.ts, solid-mesh.ts, solid.ts,
  // geometry.ts and heat.ts, and types from simulation.ts.
  {from: 'src/engine/solid-fracture.ts', rewrites: []},
  // ./cloth: the calibrated cloth and its coupling to rigid bodies. Imports contracts.ts, checkpoint.ts, principalMoments from
  // structure-coupling.ts and the Subsystem type from simulation.ts.
  {from: 'src/engine/cloth.ts', rewrites: []},
  // ./granular: discrete-element grains and their coupling to rigid bodies. Imports contracts.ts, checkpoint.ts, principalMoments from
  // structure-coupling.ts, granular-kernels.ts and the Subsystem type from simulation.ts.
  {from: 'src/engine/granular.ts', rewrites: []},
  // The contact kernels of ./granular as functions of a range of grains over typed arrays (granular.ts runs them; the app's
  // granular-parallel.ts runs them on several threads). Imports nothing.
  {from: 'src/engine/granular-kernels.ts', rewrites: []},
  // ./fluid: incompressible flow on a staggered grid and its coupling to rigid bodies. Imports contracts.ts, checkpoint.ts,
  // fluid-multigrid.ts and the Subsystem type from simulation.ts.
  {from: 'src/engine/fluid.ts', rewrites: []},
  // The multigrid preconditioner of ./fluid's pressure solve (pressureSolver: 'multigrid'). Imports nothing.
  {from: 'src/engine/fluid-multigrid.ts', rewrites: []},
  // ./shallow-water: the Saint-Venant equations on terrain, rain, infiltration and coupling to rigid bodies. Imports
  // contracts.ts, checkpoint.ts and the Subsystem type from simulation.ts.
  {from: 'src/engine/shallow-water.ts', rewrites: []},
  // ./solid-contact: contact, friction and welds between a tetrahedral solid and rigid bodies. Imports contracts.ts, checkpoint.ts,
  // solid.ts, principalMoments from structure-coupling.ts and the Subsystem type from simulation.ts.
  {from: 'src/engine/solid-contact.ts', rewrites: []},
  // Contact between deformable solids and self-contact, part of ./solid-contact. Imports contracts.ts, checkpoint.ts, solid.ts and
  // the Subsystem type from simulation.ts.
  {from: 'src/engine/solid-solid-contact.ts', rewrites: []},
  // ./materials: the sourced material library and the helpers that build solver inputs from it. Imports contracts.ts
  // and only types from solid.ts, solid-fracture.ts, heat.ts and granular.ts.
  {from: 'src/engine/materials.ts', rewrites: []},
  // ./gpu: the WebGPU compute backends of the grains, the shallow water and the flow, their float32 CPU references, and
  // the subsystems of scene sections with backend 'gpu' (scene-backends.ts). Kept in core/gpu/ so their '../' imports of
  // the solvers above resolve. They need the WebGPU types (GPUDevice, ...) at compile time: webgpu-minimal.d.ts below,
  // which is not emitted; a TypeScript consumer of ./gpu adds @webgpu/types.
  ...['compute', 'layout', 'wgsl', 'shallow-water-wgsl', 'shallow-water-f32', 'shallow-water-gpu', 'granular-wgsl', 'granular-f32', 'granular-gpu',
    'fluid-kernels', 'fluid-program', 'fluid-f32', 'fluid-gpu', 'scene-backends'].map(name => ({from: `src/engine/gpu/${name}.ts`, to: `gpu/${name}.ts`, rewrites: []})),
  // The WebGPU declarations the app compiles with; ambient, compile-time only (a .d.ts in src is not copied to dist).
  {from: 'src/webgpu-minimal.d.ts', rewrites: []},
];
/** Where an entry of CORE lands under src/core: its `to`, or its file name. */
export const coreTarget = entry => entry.to ?? entry.from.split('/').pop();
// box3d-mt.{js,wasm} is the pthread artifact: loaded only by loadBox3D({threads: 2 or more}).
export const WASM_FILES = ['box3d.js', 'box3d.wasm', 'box3d-mt.js', 'box3d-mt.wasm', 'BUILD_PROVENANCE.json', 'BOX3D_LICENSE.txt'];

/** The exact text the package compiles for one canonical app source. */
export function transformCore({from, rewrites}, text) {
  for (const [before, after] of rewrites) {
    if (!text.includes(before)) throw new Error(`${from}: expected import not found; update scripts/sync-core.mjs.\n  ${before}`);
    text = text.replace(before, after);
  }
  // Published code uses .js specifiers so emitted JS and .d.ts resolve everywhere.
  text = text.replace(/(from\s+'\.{1,2}\/[\w./-]+)\.ts'/g, "$1.js'");
  return `// GENERATED from ${from} by packages/box3d-kit/scripts/sync-core.mjs. Edit the source, not this copy.\n` + text;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function main() {
  mkdirSync(resolve(pkg, 'src/core'), {recursive: true});
  for (const entry of CORE) {
    const target = resolve(pkg, 'src/core', coreTarget(entry));
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, transformCore(entry, readFileSync(resolve(repo, entry.from), 'utf8')));
  }
  mkdirSync(resolve(pkg, 'wasm'), {recursive: true});
  for (const name of WASM_FILES) copyFileSync(resolve(repo, 'public/box3d', name), resolve(pkg, 'wasm', name));
  copyFileSync(resolve(repo, 'LICENSE'), resolve(pkg, 'LICENSE'));
  copyFileSync(resolve(repo, 'THIRD_PARTY_NOTICES.md'), resolve(pkg, 'THIRD_PARTY_NOTICES.md'));

  // Refuse to ship artifacts whose bytes differ from their recorded provenance.
  const provenance = JSON.parse(readFileSync(resolve(pkg, 'wasm/BUILD_PROVENANCE.json'), 'utf8'));
  const wasmSha = sha256(readFileSync(resolve(pkg, 'wasm/box3d.wasm')));
  const glueSha = sha256(readFileSync(resolve(pkg, 'wasm/box3d.js')));
  for (const [name, actual] of [['box3d.wasm', wasmSha], ['box3d.js', glueSha]]) {
    const recorded = provenance.artifacts?.[name]?.sha256;
    if (recorded !== actual) throw new Error(`${name} sha256 ${actual} does not match BUILD_PROVENANCE.json (${recorded}). Rebuild or refresh provenance.`);
  }
  const threadedWasmSha = sha256(readFileSync(resolve(pkg, 'wasm/box3d-mt.wasm')));
  for (const [name, actual] of [['box3d-mt.wasm', threadedWasmSha], ['box3d-mt.js', sha256(readFileSync(resolve(pkg, 'wasm/box3d-mt.js')))]]) {
    const recorded = provenance.threaded?.artifacts?.[name]?.sha256;
    if (recorded !== actual) throw new Error(`${name} sha256 ${actual} does not match BUILD_PROVENANCE.json threaded.artifacts (${recorded}). Rebuild or refresh provenance.`);
  }
  const kitVersion = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8')).version;
  writeFileSync(resolve(pkg, 'src/core/build-info.ts'), `// GENERATED by scripts/sync-core.mjs.
/** The identity of the build this package ships: its version, the Box3D source it was compiled from, the compiler, and the SHA-256 of the WebAssembly and its glue. */
export interface BuildInfo {
  readonly kitVersion: string;
  readonly box3dRef: string | null;
  readonly box3dCommit: string | null;
  readonly emscripten: string | null;
  readonly bridgeSha256: string | null;
  readonly wasmSha256: string;
  readonly wasmBytes: number;
  readonly glueSha256: string;
  /** The pthread artifact (box3d-mt.wasm), loaded by loadBox3D({threads}). */
  readonly threadedWasmSha256: string;
  readonly threadedWasmBytes: number;
}
/** Identity of the WASM this package ships. Compare against bug reports and replay logs. */
export const BUILD_INFO: BuildInfo = {
  kitVersion: ${JSON.stringify(kitVersion)},
  box3dRef: ${JSON.stringify(provenance.box3d?.ref ?? null)},
  box3dCommit: ${JSON.stringify(provenance.box3d?.commit ?? null)},
  emscripten: ${JSON.stringify(provenance.toolchain?.emscripten ?? null)},
  bridgeSha256: ${JSON.stringify(provenance.bridge?.sha256 ?? null)},
  wasmSha256: ${JSON.stringify(wasmSha)},
  wasmBytes: ${readFileSync(resolve(pkg, 'wasm/box3d.wasm')).length},
  glueSha256: ${JSON.stringify(glueSha)},
  threadedWasmSha256: ${JSON.stringify(threadedWasmSha)},
  threadedWasmBytes: ${readFileSync(resolve(pkg, 'wasm/box3d-mt.wasm')).length},
};
`);
  console.log('box3d-kit: synced core sources and wasm artifacts (provenance verified)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
