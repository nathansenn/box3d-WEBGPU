# v1.13 soft-kernel compiler-mode qualification

Date: July 16, 2026

Verdict: **retain `-O3` for both packaged soft-kernel modules**. The historical
v1.6 single-scene result favoring SIMD `-O2` and scalar `-Os` does not survive
current-source, complete-workload testing.

## Why this was reopened

The v1.6 compiler-mode search measured one maximum cloth scene with three
samples. It reported SIMD `-O2` about 1.068x ahead of SIMD `-O3` and scalar
`-Os` about 1.063x ahead of scalar `-O3`. A later build script briefly shipped
the mixed modes, but v1.10-v1.12 and current source standardized both modules on
`-O3`. The original historical-gap audit omitted this family, so v1.13 retested
it instead of assuming either result remained valid.

## Current-source method

- Apple clang 21.0.0, wasm32, current `wasm/soft_kernels.c`.
- Every compiler/linker option matched production except `-O3` versus the
  candidate optimization mode.
- 12 balanced AB/BA samples per workload and 20,000 stratified bootstrap
  resamples.
- Every timed batch exceeded 25 ms.
- 12 complete active `step + buildFrame` workloads: four cloth, four rope, and
  four water scenes, plus two tearing/no-kernel controls.
- 240-frame full state/render comparisons.
- All 28 comparisons were bit-exact (`relative L2 = 0`).

## Artifacts

| Module | SHA-256 | Bytes | Difference |
|---|---|---:|---:|
| SIMD `-O3` production | `8744df67b629cca4f15e9ff375723d9b6b2d5411df664c42642ec461c2e10c31` | 6,216 | baseline |
| SIMD `-O2` candidate | `438a7964e6409f7e547a13a36af6748cf67945e266d01a890e1b372ad5e23b3b` | 5,973 | -243 B |
| Scalar `-O3` production | `99893fdaf3c94214ef952cd1e0d592242f2b06618480741c00630495854286b6` | 3,926 | baseline |
| Scalar `-Os` candidate | `93690dfdd2d4f7dcadcfa9993beab1ab91829cf7a2430cc419e4d08d6775f907` | 3,695 | -231 B |

## Results

| Comparison | Active GM | Median | Cloth GM | Rope GM | Water GM | Controls GM |
|---|---:|---:|---:|---:|---:|---:|
| SIMD `-O2` / `-O3` | **0.99480x** | 0.99909x | 0.98423x | 1.00108x | 0.99919x | 1.00556x |
| Scalar `-Os` / `-O3` | **0.99476x** | 0.99992x | 0.97989x | 1.00141x | 1.00315x | 0.99391x |

The maximum tensioned-membrane workload was the decisive regression:

- SIMD `-O2`: **0.94647x**, paired 95% interval **0.92740-0.97277x**.
- Scalar `-Os`: **0.94105x**, paired 95% interval **0.91965-0.97210x**.

The candidates save a few hundred bytes but do not improve the active workload
geometric mean and materially regress the maximum membrane. Production remains
on `-O3` for SIMD and scalar modules.

Raw qualification JSON SHA-256:
`25eab62b3c38e63512027927f233ac91ffa18b8f6f701a9a5f86ef151fd5b674`.
