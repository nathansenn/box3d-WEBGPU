# v1.13 hybrid renderer surface-cache qualification

Date: July 16, 2026

Verdict: **reject the scratch-backed hybrid candidate** (`renderer.ts`
SHA-256 `4902058cb438d15ce0c3ae5b6345344d95025ce028f00da690824ef09d6643cf`).
It preserved the v1.12 `surfaceConfigKey = ''` property slot and reused views
over the cloth/water parameter scratch buffers, but it did not preserve the
retained numeric cache's unchanged-surface performance.

## Method

- Exact production cases 808, 811, 812, 820, 821, 822, 841, and 842.
- 16 balanced AB/BA samples per case and 20,000 paired bootstrap resamples.
- Every timed batch exceeded 25 ms; the scratch repetition cap was 4,096.
- Four trajectory checkpoints plus final captures; every case was exact and
  deterministic.
- Dawn compiled 11 WGSL modules and submitted the real renderer paths with zero
  uncaptured WebGPU errors.

## Hybrid versus retained numeric cache

The retained renderer SHA-256 is
`7c6553969ec5586b5721c5d524d4be74f46608c06adff232aaa2d902bf2a5a9e`.

| ID | Path | Speedup | Paired 95% interval | Minimum batch |
|---:|---|---:|---:|---:|
| 808 | rigid unchanged | 0.9947x | 0.965-1.019x | 42.27 ms |
| 811 | rigid active | 0.9899x | 0.967-1.013x | 47.86 ms |
| 812 | rigid unchanged | 0.9330x | 0.856-1.031x | 28.67 ms |
| 820 | rigid unchanged | 0.9510x | 0.885-1.026x | 30.00 ms |
| 821 | cloth active | 1.2523x | 1.234-1.320x | 51.15 ms |
| 822 | cloth unchanged | **0.4914x** | **0.459-0.536x** | 53.17 ms |
| 841 | water active | 1.0817x | 1.020-1.111x | 44.96 ms |
| 842 | water unchanged | **0.6436x** | **0.567-0.700x** | 32.59 ms |

Geometric means: rigid controls **0.9668x**, active cloth/water **1.1639x**,
unchanged cloth/water **0.5624x**, and all eight cases **0.8844x**. The cloth
and water unchanged regressions each had one-sided regression probability
`1 / 20001` and reproduced in an independent duplicate-current run
(0.5041x and 0.6009x).

## Hybrid versus true v1.12

The frozen v1.12 archive SHA-256 is
`33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67`;
its renderer SHA-256 is
`6354b876cc1c836667b525f1d1e9e25261f8e0d532fb602e85c767e6a0ad2388`.

| ID | Path | Speedup | Paired 95% interval |
|---:|---|---:|---:|
| 808 | rigid unchanged | 1.0120x | 0.935-1.103x |
| 811 | rigid active | 0.9898x | 0.965-1.010x |
| 812 | rigid unchanged | 0.9628x | 0.890-1.057x |
| 820 | rigid unchanged | 0.9388x | 0.883-1.015x |
| 821 | cloth active | 1.9718x | 1.930-2.079x |
| 822 | cloth unchanged | 1.7926x | 1.634-1.811x |
| 841 | water active | 1.2823x | 1.242-1.316x |
| 842 | water unchanged | 1.1029x | 1.087-1.116x |

The hybrid improves on v1.12, but loses decisively to the already-retained
compact `Float64Array` numeric cache on the most important unchanged cloth and
water paths. The workspace therefore retains the numeric cache unchanged.
