# WebPhysics v1.13 exact 1,000-case release tournament

Generated: 2026-07-16T21:52:54.483Z

Candidate source: `9baae5ee1004276a5937b66a1eae13f3c2776f3d198edd2a5637f231b1286cbe`

Registry: `ac38d476ee69c222ce9fb7380d9d53eb30b101e0dd34a1e13be9334fe0c9c032`

## Summary

- Cases: **1000**
- Accepted confidence- and multiplicity-bounded wins: **165**
- Borderline: **353**
- Controls: **360**
- Timer-floor cases excluded from performance aggregates: **85**
- Correctness failures: **0**
- Material control regressions screened for fresh-process confirmation: **0**
- Material control regressions confirmed by the Bonferroni familywise upper bound: **0**
- Eligible changed-path geometric mean: **1.0544×**
- Eligible control geometric mean: **1.0041×**

## Groups

| Group | Cases | Eligible GM | Controls | Accepted |
|---|---:|---:|---:|---:|
| native-create-active | 100 | 1.1784× | 0 | 62 |
| native-actions-sync | 100 | 0.9984× | 75 | 0 |
| fallback-create-actions | 100 | 0.9983× | 0 | 9 |
| cloth | 100 | 1.0078× | 0 | 10 |
| rope | 100 | 1.0030× | 0 | 1 |
| water | 100 | 1.0512× | 0 | 38 |
| mixed-unchanged | 100 | 0.9980× | 50 | 8 |
| frame-prep-wasm-wrapper | 100 | 1.1640× | 75 | 19 |
| renderer-cpu-webgpu | 100 | 1.0703× | 60 | 18 |
| controls | 100 | 1.0282× | 100 | 0 |

Raw AB/BA samples, checkpoint captures, source/artifact hashes, p-values, BH q-values, and final decisions are retained in the merged JSON.
