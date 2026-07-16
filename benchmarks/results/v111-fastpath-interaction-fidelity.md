# v1.11 Fast-Path Interaction Fidelity Audit

Generated: 2026-07-15T10:04:37.323Z

Exact v1.10 baseline SHA-256: `dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5`

Candidate source fingerprint: `8e2ca3c2172f767f6751a856b482095380ccecaaa3826f6ec2c19bc907cf3aaa`

The eight qualified fast scenes ran for 360 frames at stress 5 with duplicate runs of the exact v1.10 baseline, current source, and a benchmark-only dynamic interaction guard. The schedule includes two projectiles, two rain waves, kicks, and an explosion. Rope batch projection is existing v1.10 behavior; the measured rope change is only the new fused integration kernel.

## Summary

| Gate | Current fast path | Contact-time guard | Pre-armed interaction guard |
|---|---:|---:|---:|
| Passed scenes | 8 / 8 | 8 / 8 | 8 / 8 |
| Deterministic | yes | yes | yes |
| Finite | yes | yes | yes |
| Maximum state relative L2 | 3.361793e-4 (scene 649) | 3.361793e-4 (scene 649) | 0.000000e+0 (scene 609) |
| Maximum render relative L2 | 2.289873e-4 (scene 649) | 2.289873e-4 (scene 649) | 0.000000e+0 (scene 609) |
| Failed IDs | none | none | none |

**Recommendation:** No additional dynamic fallback is required by this interaction schedule.

## Per-scene evidence

| ID | Domain | Scene | Limit | Actual state/render | Actual | Contact guard state/render | Contact guard | Pre-armed state/render | Pre-armed |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 609 | cloth | Tensioned Membrane Drum — Baseline | 2.000000e-3 | 1.086519e-4 / 7.596474e-5 | PASS | 1.086519e-4 / 7.596474e-5 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 619 | cloth | Tensioned Membrane Drum — High Stress | 2.000000e-3 | 2.462103e-4 / 1.709148e-4 | PASS | 2.462103e-4 / 1.709148e-4 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 629 | cloth | Tensioned Membrane Drum — Precision | 2.000000e-3 | 1.886828e-4 / 1.313183e-4 | PASS | 1.886828e-4 / 1.313183e-4 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 639 | cloth | Tensioned Membrane Drum — Impact Demo | 2.000000e-3 | 2.406420e-4 / 1.662956e-4 | PASS | 2.406420e-4 / 1.639728e-4 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 649 | cloth | Tensioned Membrane Drum — Cinematic | 2.000000e-3 | 3.361793e-4 / 2.289873e-4 | PASS | 3.361793e-4 / 2.289873e-4 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 655 | rope | Cable Curtain Failure — Baseline | 5.000000e-4 | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 665 | rope | Cable Curtain Failure — High Stress | 5.000000e-4 | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |
| 675 | rope | Cable Curtain Failure — Precision | 5.000000e-4 | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS | 0.000000e+0 / 0.000000e+0 | PASS |

## Deterministic action schedule

- Frame 36: structural kick.
- Frame 72: direct projectile crossing the cloth membrane or rope curtain.
- Frame 120: first rain wave.
- Frame 180: centered explosion.
- Frame 225: opposing projectile.
- Frame 270: second rain wave.
- Frame 330: final kick.

The contact-time guard is evaluated as `qualifiedFastPath && projectiles.length === 0` immediately before each step. The pre-armed guard uses conservative integration from scene creation, modeling `qualifiedFastPath && !interactionArmed`. Both are benchmark-only evidence; this script does not edit simulation source.
