# Glass contact experiment checkpoint — 2026-09-30

The half-step between the earlier measured best and the rejected paired-contact update improves the full original-law residual from **1.072388237886706e-06 to 1.07156452950856e-06 m/s** (0.07681%). An independent 96-digit oracle verified it. This remains **7.15645% above the 1e-6 m/s target**. No production change, physical application, runtime speedup or current-v5 qualification is claimed; accepted replay remains tick 116.

The full paired update at contacts 5955/5956 was rejected: its full residual is 2.150615280273916e-6 m/s. Only four sliding tail rows changed; 97,197 other rows and the original physical acceptance gates stayed fixed. The paired controls passed (77), as did the damping controls (18). Six new damped points were checked without additional optimization solves. The half-step passes cone, energy, nonnegative normal impulse and momentum side checks, but fails the full accuracy target.

The exact phase certificate excludes the target only in the fixed local model. It does not establish physical nonexistence. The earlier history has one missing, expired browser startup receipt; all 9,469 remaining predecessor pins and all required numerical inputs were verified at freeze. This scoped provenance limitation is recorded in [results.json](results.json).

The final readback rechecked both manifests, all seven terminal child receipts and stopped memory samplers, the accepted measured vector, and unchanged production hashes. The rejected full-step arrays, certificates and logs were removed after their hashes, verdicts and regeneration commands were recorded. Only the 130,592-byte measured-best vector remains in scratch for the next experiment, accompanied by a small state pointer. This cleanup is scoped to this experiment; historical experiments were preserved.

Retained vector: `/Users/commander/.agent-scratch/box3d-WEBGPU/01a08767-778e-7633-9012-95ababc992ac/latest/damping-best-vectors.npz`  
Array: `projected_impulse`, shape `(18069,)`  
SHA256: `d7b7d9f7dbdfc8076dbe19d0af0f277e0933bf06c44fe735b903ccda9b96e7a7`

Reproduction commands, pinned input identities, every damping result, process receipts and the removal inventory are in [results.json](results.json). Reproduction requires an empty output directory; never overwrite the retained best. Source files remain in `/Users/commander/box3d-WEBGPU/benchmarks/experiments/glass-tick117-paired-sliding-update-20260925-01`.

Next: inspect contact 5965 at this measured point before proposing another step. Keep the original model origin, older source candidate and new best as separate inputs.
