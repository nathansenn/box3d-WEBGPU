# TurboQuant Simulation-State Benchmark

Generated: 2026-07-14T10:52:34.269Z

## Decision

**Do not enable TurboQuant on the current same-thread physics → WebGPU upload path.** The JavaScript rotation, quantization, packing, unpacking, and reconstruction cost is greater than a local typed-array copy.

**Use the predictive 4-bit transport mode for network snapshots, remote spectators, cloud simulation replication, replay archives, or other bandwidth-limited boundaries.** Once encoded, its payload is much cheaper to copy and transmit, and the measured break-even link rate is reported below.

## Recommended predictive 4-bit result

| Workload | Raw/frame | Packet/frame | Compression | Encode + decode | Relative L2 | Copy-only speedup | Link break-even | 10 MB/s model | 25 MB/s model | 50 MB/s model |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| cloth | 19.92 KiB | 2.81 KiB | 7.08× | 0.3195 ms | 1.258% | 4.62× | 54.8 MB/s | 3.36× | 1.88× | 1.08× |
| rope | 4.02 KiB | 0.60 KiB | 6.73× | 0.0666 ms | 1.090% | 1.69× | 52.6 MB/s | 3.22× | 1.81× | 1.04× |
| water | 75.47 KiB | 10.62 KiB | 7.11× | 1.1109 ms | 1.919% | 6.94× | 59.8 MB/s | 3.52× | 2.00× | 1.16× |

The network model is `raw bytes / link rate` versus `codec time + compressed bytes / link rate`; it excludes protocol overhead and assumes codec work is not overlapped. Lower-bandwidth links favor compression.

## All tested codecs

### Tensioned Membrane Drum — Cinematic

| Codec | Compression | Predictive time/frame | Predictive relative L2 | Local end-to-end | Break-even |
|---|---:|---:|---:|---:|---:|
| TurboQuant blockwise dense 4-bit | 5.31× | 0.6116 ms | 1.016% | 0.0007× | 27.1 MB/s |
| TurboQuant structured 4-bit | 6.38× | 0.3242 ms | 1.086% | 0.0009× | 53.0 MB/s |
| TurboQuant structured 3-bit | 7.97× | 0.2875 ms | 2.101% | 0.0010× | 62.0 MB/s |
| TurboQuant structured 4-bit delta | 7.08× | 0.3195 ms | 1.258% | 0.0011× | 54.8 MB/s |
| TurboQuant structured 3-bit delta | 9.11× | 0.2757 ms | 2.517% | 0.0011× | 65.9 MB/s |

### Rope Net Resonance — Cinematic

| Codec | Compression | Predictive time/frame | Predictive relative L2 | Local end-to-end | Break-even |
|---|---:|---:|---:|---:|---:|
| TurboQuant blockwise dense 4-bit | 5.20× | 0.1312 ms | 0.881% | 0.0007× | 25.3 MB/s |
| TurboQuant structured 4-bit | 6.05× | 0.0709 ms | 0.923% | 0.0015× | 48.5 MB/s |
| TurboQuant structured 3-bit | 7.57× | 0.0583 ms | 1.899% | 0.0015× | 61.3 MB/s |
| TurboQuant structured 4-bit delta | 6.73× | 0.0666 ms | 1.090% | 0.0011× | 52.6 MB/s |
| TurboQuant structured 3-bit delta | 8.65× | 0.0568 ms | 2.235% | 0.0015× | 64.1 MB/s |

### Leviathan Impact Pool — Cinematic

| Codec | Compression | Predictive time/frame | Predictive relative L2 | Local end-to-end | Break-even |
|---|---:|---:|---:|---:|---:|
| TurboQuant blockwise dense 4-bit | 5.33× | 2.2275 ms | 1.484% | 0.0006× | 28.2 MB/s |
| TurboQuant structured 4-bit | 6.40× | 1.1321 ms | 1.743% | 0.0011× | 57.6 MB/s |
| TurboQuant structured 3-bit | 8.00× | 1.0000 ms | 3.819% | 0.0011× | 67.6 MB/s |
| TurboQuant structured 4-bit delta | 7.11× | 1.1109 ms | 1.919% | 0.0009× | 59.8 MB/s |
| TurboQuant structured 3-bit delta | 9.14× | 0.9638 ms | 4.131% | 0.0013× | 71.4 MB/s |

## Worker transport check

A local Node worker transferred 48 water frames. Raw transferable transport took 1.040 ms total; predictive TurboQuant encode + transfer + decode took 55.454 ms. End-to-end speedup was **0.0187×**, meaning TurboQuant was **53.3× slower** for this local worker path.

Transferred bytes fell from 3,709,440 to 521,856 (7.11× smaller), but local memory transfer was already too fast for the JavaScript codec cost to amortize.

## Algorithm mapping and scope

- `dense` is a **blockwise adaptation of TurboQuant-MSE**: normalize each block, apply a deterministic random orthogonal rotation, use Gaussian Lloyd–Max scalar centroids, and inverse-rotate during reconstruction. It is not the paper’s single full-vector dense rotation.
- `structured` replaces the dense rotation with randomized normalized Walsh–Hadamard stages. This is a TurboQuant-style fast transform aligned with the later Fast-TurboQuant direction, not an official Google implementation.
- QJL residual correction is intentionally omitted because this engine reconstructs positions/matrices; it is not estimating attention inner products.
- Predictive mode quantizes the difference from the prior reconstructed frame. Encoder and decoder therefore remain synchronized on the same lossy reference.

## Reproduction

```bash
npm ci
TQ_FRAMES=60 TQ_SAMPLES=5 TQ_WARMUPS=2 TQ_FANOUTS=1,4,16 npm run bench:turboquant:all
```

Runtime: v26.0.0 on darwin/arm64; 60 frames/workload, 5 timed samples, 2 warmups.
