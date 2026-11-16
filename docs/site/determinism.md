# Determinism

The same build, the same calls in the same order, the same bits: on every machine that runs the same WebAssembly.

- **Rigid world.** The kit ships the single-threaded build of Box3D, which steps deterministically.
  `world.exactHash()` is a hash of the exact bits of every transform; `world.replayHash()` one of transforms rounded
  to a millimetre.
- **TypeScript solvers.** Plain IEEE-754 double arithmetic in a fixed order, no `Math.random`, no dependence on
  timing. Elementary functions (`Math.sin`, `Math.exp`) are the one thing the language does not pin down across
  engines; the solvers' results are bit-identical within one engine and agree to rounding across engines.
- **Seeds.** Anything random takes a seed (`createWorld({seed})`, `clothGrid({seed})`, `granularLattice({seed})`).

## Record and replay

```js
world.startRecording({world: {ground: true, gravity: [0, -9.81, 0]}});
// ... createBody, createJoint, forces, steps ...
const log = world.stopRecording();                  // plain JSON

const report = world.replayDetailed(log);           // or in another world, another page, another machine
report.matches;                                     // true when every recorded hash and the final state agree
report.divergence;                                  // {from, to}: the ticks between which it first differed
```

`saveSession(log)` adds the build's identity; `loadSession` refuses a session from another build with
`INCOMPATIBLE_SAVE`, because exactness holds per build.

## What breaks it

- A different WebAssembly build (a new Box3D, another compiler): compare `BUILD_INFO`.
- Calls made in a different order, including creation order: handles and solver order follow it.
- Reading the clock, or anything else from outside, inside the simulation.

The fuzzers check all of this on every pull request: the same seed in two WebAssembly instances, a world beside a
busy neighbour world, a recording replayed in a second world, and a checkpoint resumed at a random step
([robustness](../../reference/robustness.html)).
