# Checkpoints

A checkpoint is the complete state of a world, or of a simulation with all of its solvers, in one byte array.
Restored, the run continues bit for bit as if it had never stopped.

```js
const saved = world.checkpoint();          // Uint8Array
for (let i = 0; i < 600; i++) world.step();
world.restoreCheckpoint(saved);            // back to the saved step; every later step is identical
```

```js
import {resumeSimulation} from 'box3d-webgpu-kit/simulation';

const bytes = simulation.checkpoint();     // carries the scene it was built from, when there is one
// ... later, in a fresh page:
const {simulation: resumed} = resumeSimulation(freshWorld, bytes);
```

- A checkpoint holds everything a step reads: contacts with their warm-start impulses, joints, islands and sleep
  timers, the broad phase, every solver's fields and histories, clocks and event cursors.
- It is self-checking: a damaged file, one of another format version, or one from another scene is refused with
  `CHECKPOINT_MISMATCH` and changes nothing.
- It is exact on the same build of the WebAssembly (`BUILD_INFO.wasmSha256`). Across builds use a
  [scene file](scene-files.html) of the saved state instead.
- Not while recording.

## Handles after a restore

Body handles keep their meaning when the world was built the same way as the one the checkpoint came from. If a body
was destroyed between the checkpoint and the restore, read handles again with `world.bodyAt(row)`; discard joint
handles made after the checkpoint. The details, and a native defect in this area, are in the
[checkpoints page](../../solvers/checkpoints.html).

## Uses

Save and resume; rollback for networked play (checkpoint, predict, restore, replay inputs); scrubbing a timeline in a
tool; reproducing a bug from the step before it happens.
