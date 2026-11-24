// Lists the Box3D functions that the WebAssembly build compiles for size: wasm/box3d_cold_functions.txt.
//
//   node scripts/wasm-cold-functions.mjs            write the list from the Box3D source in third_party/box3d
//   node scripts/wasm-cold-functions.mjs --check    fail when the committed list is not what the source gives
//   BOX3D_ROOT=/path/to/box3d node scripts/...      use another checkout
//
// wasm/CMakeLists.txt gives every function in the list the LLVM attribute `minsize` (what -Oz gives a whole file). The
// rest of Box3D keeps -O3. A function is in the list when it is defined in one of Box3D's .c files and cannot be reached,
// in the call graph of the source, from a step, a query, the character mover, the scheduler or a call a game makes every
// frame (the roots below). So the solver, collision, the broad phase, sleeping, ray and shape casts and the per-frame body
// calls are compiled exactly as before; world, body, shape and joint creation and destruction, the hull and mesh builders,
// the joint and world setters, the debug draw and the snapshot are compiled small.
//
// The call graph is read from the text: a function or macro "calls" every function or macro whose name appears in its
// body, which also covers functions passed as callbacks. That can only make the hot set larger than it is, never smaller.
// recording.c is left out: its writers grow when compiled for size (measured 2026-11-23, +46 KiB).
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const box3d = resolve(process.env.BOX3D_ROOT ?? join(root, 'third_party/box3d'));
const listPath = join(root, 'wasm/box3d_cold_functions.txt');

/** Calls that happen while the world runs. Everything they reach stays at -O3. */
const HOT_ROOTS = [
  // the step, queries and the character mover
  /^b3World_(Step|Cast|Overlap|CollideMover|Get(Body|Sensor|Contact|Joint)Events|GetAwakeBodyCount|GetGravity|GetBounds|IsValid)/,
  /^b3(SolvePlanes|ClipVector)$/,
  /^b3(RayCast|ShapeCast|Overlap|Collide|Distance|ShapeDistance|TimeOfImpact|MakeProxy|MakeOffsetProxy|ComputeCosSin|IntegrateRotation)/,
  /^b3Make(Transformed)?BoxHull$/,
  // what a game calls every frame: reads, forces and impulses, kinematic targets, waking
  /^b3Body_(Get|Is|Apply(?!MassFromShapes)|Cast|Overlap|ComputeAABB|Wake|Set(Transform|TargetTransform|LinearVelocity|AngularVelocity|Awake|UserData)$)/,
  /^b3Shape_(Get|Is|RayCast|Are)/,
  /^b3Joint_(Get(Constraint|Body|Type|UserData|World)|IsValid)/,
  // the scheduler, the allocator and the id helpers every path uses
  /^b3(Scheduler|ParallelFor|GetWorld|Alloc|Free|GrowAlloc|Store|Load|IsValid|Yield|GetTicks|GetMilliseconds|ComputeHash)/,
];
/** Files whose functions are never listed. */
const SKIPPED_FILES = new Set(['recording.c', 'recording_replay.c']);

function readSources() {
  const files = [
    ...readdirSync(join(box3d, 'src')).filter(name => /\.(c|h|inl)$/.test(name)).sort().map(name => join('src', name)),
    ...readdirSync(join(box3d, 'include/box3d')).filter(name => name.endsWith('.h')).sort().map(name => join('include/box3d', name)),
  ];
  // name -> [{file, body, kind: 'macro' | 'static' | 'extern'}]
  const nodes = new Map();
  const add = (name, file, body, kind) => { const list = nodes.get(name) ?? []; list.push({file, body, kind}); nodes.set(name, list); };
  // Comments and string literals hold no calls. Lines are kept so that a body still ends at its closing brace in column 0.
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '').replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  for (const file of files) {
    const lines = strip(readFileSync(join(box3d, file), 'utf8').replace(/\r\n/g, '\n')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const macro = /^\s*#\s*define\s+(\w+)/.exec(lines[i]);
      if (macro) {
        let body = lines[i], last = i;
        while (/\\\s*$/.test(lines[last]) && last + 1 < lines.length) body += `\n${lines[++last]}`;
        add(macro[1], file, body.replace(/^\s*#\s*define\s+\w+/, ''), 'macro');
        i = last;
        continue;
      }
      // Box3D's style: the header of a definition starts in column 0, its braces stand alone in column 0.
      if (lines[i] !== '{' || i === 0) continue;
      let start = i - 1;
      while (start > 0 && !/^[A-Za-z_]/.test(lines[start])) start--;
      const header = lines.slice(start, i).join(' ');
      const match = /([A-Za-z_]\w*)\s*\([^;{}]*\)\s*$/.exec(header);
      if (!match) continue;
      let end = i + 1;
      while (end < lines.length && lines[end] !== '}') end++;
      add(match[1], file, lines.slice(i, end + 1).join('\n'), /\bstatic\b/.test(header) ? 'static' : 'extern');
      i = end;
    }
  }
  return nodes;
}

function coldFunctions() {
  const nodes = readSources();
  const edges = new Map();
  for (const [name, definitions] of nodes) {
    const out = new Set();
    for (const definition of definitions) for (const token of definition.body.match(/[A-Za-z_]\w*/g) ?? []) if (token !== name && nodes.has(token)) out.add(token);
    edges.set(name, out);
  }
  const hot = new Set([...nodes.keys()].filter(name => HOT_ROOTS.some(pattern => pattern.test(name))));
  const queue = [...hot];
  while (queue.length) for (const next of edges.get(queue.pop()) ?? []) if (!hot.has(next)) { hot.add(next); queue.push(next); }
  const cold = [];
  for (const [name, definitions] of nodes) {
    if (hot.has(name)) continue;
    const inC = definitions.filter(definition => definition.kind !== 'macro' && /^src\/[^/]+\.c$/.test(definition.file));
    const byFile = new Map();
    for (const definition of inC) byFile.set(definition.file, (byFile.get(definition.file) ?? 0) + 1);
    // A name defined twice in one file is one definition per platform or per build option: left alone, since only one exists
    // in a given build and the compiler reports an attribute for a function that is not there.
    for (const [file, count] of byFile) if (count === 1 && !SKIPPED_FILES.has(file.slice(4))) cold.push({file: file.slice(4), name});
  }
  cold.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {cold, functions: [...nodes.values()].flat().filter(definition => definition.kind !== 'macro' && /^src\/[^/]+\.c$/.test(definition.file)).length};
}

const {cold, functions} = coldFunctions();
const text = `# GENERATED by scripts/wasm-cold-functions.mjs from the Box3D source. Do not edit: run the script.
# Functions of Box3D that no step, query, mover call or per-frame body call reaches. wasm/CMakeLists.txt compiles them
# with the LLVM attribute minsize; the rest of Box3D keeps -O3. One "<file> <function>" per line.
${cold.map(entry => `${entry.file} ${entry.name}`).join('\n')}
`;
if (process.argv.includes('--check')) {
  let committed = null;
  try { committed = readFileSync(listPath, 'utf8'); } catch { /* reported below */ }
  if (committed !== text) {
    console.error('wasm/box3d_cold_functions.txt does not match the Box3D source. Run: node scripts/wasm-cold-functions.mjs');
    process.exit(1);
  }
  console.log(`wasm/box3d_cold_functions.txt matches the Box3D source (${cold.length} of ${functions} functions compiled for size)`);
} else {
  writeFileSync(listPath, text);
  console.log(`wrote wasm/box3d_cold_functions.txt: ${cold.length} of ${functions} functions in ${new Set(cold.map(entry => entry.file)).size} files`);
}
