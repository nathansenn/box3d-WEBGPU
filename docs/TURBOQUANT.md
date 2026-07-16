# TurboQuant Simulation-State Transport

## Purpose

The local physics/render loop already uses compact packed fallback surfaces and GPU-resident cloth/water state streams. TurboQuant is therefore **not** inserted between the simulation and the local GPU. Instead, this edition keeps it as an opt-in codec for boundaries where byte volume can dominate:

- remote simulation snapshots;
- multiplayer spectators and replication;
- cloud-render or server-authoritative state transport;
- replay archives and checkpoints;
- cross-process streams on genuinely bandwidth-constrained systems.

The default local frame path remains lossless and unquantized.

## Research basis

This is an independent TypeScript implementation based on:

- Amir Zandieh, Majid Daliri, Majid Hadian, and Vahab Mirrokni, **“TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate,”** arXiv:2504.19874.
- Pedro M. R. Pereira, Felipe A. P. de Figueiredo, and Rausley A. A. de Souza, **“Fast-TurboQuant: A Multiplier-Free Online Vector Quantization Approach,”** arXiv:2606.21448.

No Google or third-party implementation code is copied into this repository.

## Implemented paths

### Blockwise dense TurboQuant-MSE adaptation

For each fixed-size simulation block:

1. optionally subtract one stored block mean;
2. store the block norm;
3. normalize the vector;
4. multiply by a deterministic random orthogonal matrix;
5. quantize every rotated coordinate with an MSE-oriented Gaussian Lloyd–Max codebook;
6. bit-pack 2-, 3-, or 4-bit codes;
7. reconstruct with the centroids and inverse rotation.

The original paper describes one rotation over the full high-dimensional vector. This engine deliberately uses blocks so browser setup, memory, and O(d²) dense rotation cost remain bounded. It is therefore a practical adaptation, not a claim of bit-for-bit equivalence with the paper’s global transform.

### Structured fast transform

The fast path uses deterministic Rademacher signs, normalized Walsh–Hadamard transforms, and a permutation instead of a dense matrix. Its asymptotic transform cost is O(d log d), and it follows the structured-transform direction described by Fast-TurboQuant. It remains an independent engine-specific implementation.

### Predictive simulation stream

`TurboQuantDeltaStream` quantizes each frame relative to the previous **reconstructed** frame. Encoder and decoder maintain the same lossy reference, avoiding drift caused by predicting from information the receiver never received.

This predictive path is the recommended mode for moving simulation state. Absolute-frame results have materially higher error on cloth, rope matrices, and water surfaces.

## Why QJL is omitted

TurboQuant’s QJL residual stage targets unbiased inner-product estimation, particularly attention and vector-search calculations. This project needs reconstructed positions and transforms rather than an unbiased dot-product estimator, so the codec uses the MSE reconstruction path only.

## Recommended configuration

```ts
import { TurboQuantDeltaStream } from './compression/turboquant';

const encoder = new TurboQuantDeltaStream(vectorLength, {
  bits: 4,
  blockSize: 64,
  rotation: 'structured',
  centered: false,
  seed: 0x715517,
});

const decoder = new TurboQuantDeltaStream(vectorLength, {
  bits: 4,
  blockSize: 64,
  rotation: 'structured',
  centered: false,
  seed: 0x715517,
});

const packet = encoder.encodeFrame(state);
// Copy/serialize packet.codes, packet.norms, and packet.means before the next
// encodeFrame call because the encoder reuses its packet storage.
const reconstructed = decoder.decodeFrame(packet);
```

Use periodic keyframes or a stream reset in unreliable networks. Packet framing, sequencing, retransmission, and authentication are transport-layer responsibilities and are not provided by this codec.

## Performance decision

Run the reproducible benchmark:

```bash
TQ_FRAMES=60 TQ_SAMPLES=5 TQ_WARMUPS=2 TQ_FANOUTS=1,4,16 npm run bench:turboquant:all
```

Outputs:

```text
benchmarks/results/turboquant-benchmark.json
benchmarks/results/turboquant-worker-benchmark.json
benchmarks/results/turboquant-summary.json
benchmarks/results/TURBOQUANT_BENCHMARK.md
```

The benchmark uses actual maximum-detail cloth, rope, and water streams. It separately measures:

- absolute encode/decode;
- predictive encode/decode;
- reconstruction error;
- packet size;
- raw and compressed copy cost;
- local Worker end-to-end transfer;
- modeled link-speed break-even.

The expected decision is workload-dependent, not universal:

- **local same-thread/WebGPU:** raw packed streams win;
- **local Worker on ordinary desktop memory:** raw transfer generally wins;
- **network/storage below the measured break-even rate:** predictive TurboQuant can reduce end-to-end latency and storage substantially;
- **many consumers after one encoding:** the smaller encoded payload increasingly helps, but every consumer that needs floats still pays decode cost.

## Browser probe

The command deck contains **Run TurboQuant Probe**. It dynamically loads the codec, measures predictive 4-bit encode/decode against raw typed-array copying on the current device, reports compression and error, and states whether the local path wins. The codec is dynamically imported and remains out of the initial application bundle.

## Correctness boundaries

TurboQuant is lossy. Do not use quantized state as the authoritative physics state or feed it back into the solver unless the resulting divergence is explicitly acceptable. Recommended use is rendering/replication/replay at a boundary where the authoritative simulator retains full precision.
