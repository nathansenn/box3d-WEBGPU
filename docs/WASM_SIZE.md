# Size of the WebAssembly artifact and time to the first step

What `public/box3d/box3d.wasm` and its JavaScript weigh, why, what was done about it on 2026-11-23, and how the kit's
start-up time was cut in the same work. Every number was measured on the 4-vCPU build container (Emscripten 4.0.23,
Node 22.23) while other jobs ran on it; the load average is given with each timing.

## Sizes

Bytes; gzip is zlib level 9 (what `packages/box3d-kit/scripts/pack-smoke.mjs` measures), brotli is quality 11.

| File | Before: raw | gzip | brotli | Now: raw | gzip | brotli |
|---|---:|---:|---:|---:|---:|---:|
| `box3d.wasm` | 725,529 | 280,964 | 214,360 | 587,365 | 252,347 | 198,040 |
| `box3d.js` | 24,045 | 6,378 | 5,601 | 8,898 | 3,666 | 3,255 |
| `box3d-mt.wasm` (pthreads) | 733,336 | 288,050 | 219,972 | 598,316 | 258,475 | 203,387 |
| `box3d-mt.js` | 39,333 | 10,499 | 9,295 | 15,541 | 6,573 | 5,909 |

The budgets in `pack-smoke.mjs` (run by `npm run test:pack`, part of the pull-request gate) are now 650 KiB raw and
256 KiB gzip for `box3d.wasm` and 12 KiB for `box3d.js`; 660 KiB, 262 KiB and 19 KiB for the pthread artifact.

## What the bytes were

99 % of the file is code (717,960 of 725,529 bytes; the data segments are 5.4 KiB). By function, in a build that keeps
the names (`--profiling-funcs`):

| Part | Bytes | Share |
|---|---:|---:|
| Box3D functions (solver, collision, queries, creation, recording) | 432,479 | 60 % |
| The bridge `wasm/box3d_web.c` and `box3d_snapshot.c`, with the Box3D API functions that have a single caller inlined into them by the linker | 250,944 | 35 % |
| libc (malloc 10 KiB, printf 9 KiB, math, qsort) | 33,745 | 5 % |

Three things in it never run, or run once:

- **Recording hooks.** Box3D can record every API call of a world for its replay viewer: each public function ends in
  `B3_REC(world, Op, args...)`, which writes a record when `world->recording` is set. The bridge never starts a recording
  (`b3World_StartRecording` is neither called nor exported), but the record writers and the argument marshalling at
  about 140 call sites are in the file.
- **Set-up code compiled for speed.** World, body, shape and joint creation and destruction, the hull and mesh builders,
  the joint and world setters, the debug draw and the snapshot were compiled with `-O3` like the solver.
- **The bridge compiled for speed.** It validates, converts and forwards; `b3w_world_create_joint` alone was 30 KiB.

## What was done

Box3D's sources are not modified, and the code a step, a query or a per-frame call runs keeps `-O3`.

| Step | `box3d.wasm` raw | gzip |
|---|---:|---:|
| Before | 725,529 | 280,964 |
| The bridge with `-Oz` | 696,808 | 275,174 |
| and the cold Box3D functions with `minsize` | 649,196 | 265,141 |
| and the recording hooks compiled out | 587,365 | 252,347 |

1. **`wasm/box3d_no_recording.h`** is force-included before every Box3D source and replaces `B3_REC` and
   `B3_REC_CREATE` by nothing. The recording buffer and geometry registry that the exact checkpoints use
   (`wasm/box3d_snapshot.c`) stay, and so do Box3D's explicit `world->recording != NULL` blocks in the queries and in
   shape creation (17 KiB of writers that the linker cannot prove dead).
2. **`wasm/box3d_cold_functions.txt`** lists 538 of Box3D's 1,593 functions; `wasm/CMakeLists.txt` gives each LLVM's
   `minsize` attribute (what `-Oz` gives a whole file) through one attribute file per source
   (`-mllvm -forceattrs-csv-path`). `scripts/wasm-cold-functions.mjs` writes the list from the source: a function is cold
   when no step, query, character-mover call, scheduler call or per-frame body call reaches it in the call graph (the
   roots are in the script). The graph is read from the text, a function "calls" every function whose name appears in its
   body, which can only make the hot set larger. Both build scripts run the generator with `--check` first, so a list that
   does not match the Box3D checkout stops the build. `recording.c` is left out: its writers grow when compiled for size
   (+46 KiB). The compiler prints "Function in CSV file at line N does not exist" for eight entries that the
   preprocessor removes in this build; that is harmless.
3. **`box3d_web.c` and `box3d_snapshot.c`** are compiled with `-Oz`. `box3d_threads.c`, the scheduler of the pthread
   artifact, keeps `-O3`.
4. **`--closure=1`**: the Closure Compiler that ships with Emscripten minifies the generated JavaScript. Everything the
   loaders read (`_b3w_*`, `_malloc`, `_free`, `HEAPF32`, `HEAPU8`, `ccall`, `cwrap`, `wasmMemory`) is exported by name and
   keeps its name.

`BUILD_PROVENANCE.json` records the hashes of the CMake file, the list and the header under `build`
(`scripts/update-build-provenance.mjs`).

Tried and not kept: link-time `-Os` or `-Oz` (3 KiB, and it would change how the solver is compiled), a second
`wasm-opt` pass or `--merge-similar-functions` (under 2 KiB), full instead of thin LTO (+59 KiB), `emmalloc` (7 KiB;
a different allocator under every world), `-Os` on whole Box3D files (it cannot tell a file's solver code from its set-up
code).

## Same results

- `node scripts/wasm-artifact-compare.mjs <old dir> public/box3d --hash-only`: 34 presets over all 16 scene families at
  stress 5 (six of them at the 4,096-body capacity), 300 ticks each; the replay hash and the SHA-256 of every body's
  transform bytes at ticks 1, 2, 30, 60, 120, 240 and 300 are equal in the old and the new build (238 comparisons, 0
  different), for `box3d` and for `box3d-mt`.
- Through the kit's API, old against new WebAssembly: eleven rigid example scenes of the scene format and a world with all nine joint types,
  hulls, a mesh, a height field, compound bodies, set mass data, a bullet and a kinematic body, 480 to 900 ticks;
  `exactHash()` every 60 ticks and the bytes of `checkpoint()` at the end (Box3D's whole world state) are equal.
  (A one-off script; the old artifact is not in the repository to compare against again.)
- The repository's own hashes and goldens (kit gate, `test:native-wasm`, `test:threaded`, the pull-request gate) pass
  unchanged.

## Same step time

`node scripts/wasm-artifact-compare.mjs <old dir> public/box3d --time-only --runs 11`: both builds in one process step
the same preset in turns of 20 ticks, 240 ticks per run, one warm-up run. Ratio new / old of the time per step, median
over the runs (load average 3.2 to 3.5):

| Preset (stress 5) | Bodies | Old ms/step | New ms/step | Ratio | Runs: min to max |
|---|---:|---:|---:|---:|---|
| 40 | 4,096 | 23.50 | 23.75 | 1.009 | 0.884 to 1.069 |
| 47 | 4,096 | 20.61 | 19.87 | 0.988 | 0.884 to 1.085 |
| 303 | 4,096 | 20.04 | 19.95 | 0.991 | 0.915 to 1.050 |
| 347 | 4,096 | 23.96 | 24.08 | 1.008 | 0.935 to 1.101 |
| 7 | 4,096 | 19.11 | 19.44 | 1.015 | 0.975 to 1.062 |
| 290 | 2,310 | 5.89 | 5.79 | 0.976 | 0.946 to 1.017 |
| 251 | 2,281 | 5.54 | 5.58 | 0.995 | 0.948 to 1.055 |
| 147 (21 runs) | 714 | 3.88 | 3.91 | 1.009 | 0.936 to 1.095 |
| 490 (21 runs) | 695 | 2.72 | 2.66 | 0.997 | 0.920 to 1.057 |
| 599 (21 runs) | 549 | 2.20 | 2.15 | 0.982 | 0.936 to 1.053 |
| 441 (21 runs) | 422 | 0.98 | 0.96 | 0.984 | 0.908 to 1.024 |

No preset moves by more than the spread of its own runs; the largest median is +1.5 %. The pthread artifact on the
calling thread, 7 runs: 1.003 (40), 1.004 (347), 0.996 (290), 1.014 (147).

## What is left, and what removing it would cost

In the new file's 579,402 bytes of code (names build): Box3D's step, collision and query code 359 KiB at `-O3`; the
bridge 143 KiB (debug draw 17, checkpoint restore 11, the preset scenes 14, joint values 11); cold Box3D code 34 KiB;
recording writers still referenced 17 KiB; libc 25 KiB.

- The preset scenes and demo actions of the bridge (`b3w_world_create_scene` and what only it uses): about 14 KiB raw,
  5 KiB gzip. Leaving them out would need a second, slim artifact; the default must keep them.
- The remaining recording writers: a change inside Box3D (a compile-time switch for recording).
- `emmalloc` instead of dlmalloc: 7 KiB raw, 3 KiB gzip, at the price of a different allocator.
- Anything larger means compiling solver, collision or query code for size, which costs step time.

## Time to the first step

Import the kit's main entry, instantiate the WebAssembly, build a small jointed assembly (8 bodies of 3 shapes, 7
joints), step once: `packages/box3d-kit/test/first-step-child.mjs`, each measurement in a fresh Node process, the two
builds alternating. Median of 31 processes, load average 2.2:

| Build | Import | Instantiate | Build | First step | Total (min to max) |
|---|---:|---:|---:|---:|---|
| Kit 0.9.0 as published | 19.8 | 8.8 | 11.0 | 6.8 | 47.7 ms (38.7 to 73.6) |
| Now | 9.5 | 8.2 | 10.3 | 6.9 | 34.8 ms (30.5 to 52.4) |
| Now, with Node's compile cache on (21 processes) | 4.2 | 7.8 | 9.6 | 6.7 | 30.1 ms (25.7 to 65.2) |

Where the time was and is:

- **Import.** `tsc` emits one file per module and the main entry reached 18 of them, 302,742 bytes with their comments.
  A cold Node pays a resolve, a read and a compile per file (0.3 to 0.7 ms each) and parses every byte. The kit's build now
  runs `scripts/bundle-rigid.mjs`: the 15 modules only the rigid world needs become `dist/rigid.js` without comments
  and indentation, one statement per line (names are kept), and each keeps its file as a list of re-exports, so every entry point and deep import
  still shares one `PhysicsWorld` and one module state. The main entry loads 5 files and 210,693 bytes. The import alone,
  median of 41 processes: 18.2 ms before, 8.2 ms now. What remains is V8 parsing about 200 KiB of JavaScript that
  `PhysicsWorld` and the native bridge class need (5 to 6 ms) and Node's module loader (about 1 ms). Mangling names and
  folding the five files into one measured 7.0 ms; it was not done, because the saving is 1 ms and names in stack traces
  are worth more. Going lower needs the two classes split so that rarely used methods load later, which changes the API
  from synchronous to asynchronous for those methods.
- **An application can remove most of the rest**: `NODE_COMPILE_CACHE=<dir>` or `module.enableCompileCache()` (Node
  22.1 and later) at the top of its entry file keeps V8's compiled code between processes; the import is then 4.2 ms.
  The kit cannot turn this on itself: it has to happen before the kit is imported, and it writes to disk.
- **Instantiate** is the compilation of the WebAssembly (3.1 ms for the new file, 3.8 ms for the old one) and the
  Emscripten start-up; it is the same as for other builds of Box3D.
- **Build** is first-call cost: V8 compiles each WebAssembly function when it is first called, and runs the kit's
  argument checks in its interpreter. Smaller bridge functions took the first joint from 2.6 to 1.6 ms. About 7 ms of
  the 10 is JavaScript that V8 has not optimized yet (the checks of every vector, quaternion and option of
  `createBody` and `createJoint`): a three-shape body costs 0.62 ms on average over the first eight calls and 0.018 ms
  after a few thousand.
- **First step** is V8 compiling the solver on its first call, the same in every build.

`packages/box3d-kit/test/v24-first-step.test.mjs` (kit gate) measures 21 fresh processes and fails when the median
import exceeds 16 ms or the median total 64 ms, and checks exactly that the main entry loads those 5 files and at most
230,000 bytes.
