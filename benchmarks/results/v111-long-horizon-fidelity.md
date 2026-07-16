# v1.11 Long-Horizon Cloth/Rope Fidelity Audit

Generated: 2026-07-15T10:04:14.561Z

Exact baseline: `dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5` (`box3d-webgpu-v1.10.0-source.tar.gz`)

Candidate source fingerprint: `8e2ca3c2172f767f6751a856b482095380ccecaaa3826f6ec2c19bc907cf3aaa`

Each of the 50 cloth and 50 rope recipes ran 360 frames at stress 5 with identical seeds, four simulation substeps, deterministic kicks/explosions, and an independent repeat of both versions. Cross-version state/render comparisons were sampled every 12 frames. Projectile/rain actions were intentionally excluded so the qualified fused paths remained active; the action schedule still exercises sustained wind, impulses, collision boundaries, and radial disturbance. Rope batch projection is already present in v1.10, so rope `fused-integration` rows measure only the new integration-kernel path layered on that existing projection architecture.

## Result

| Gate | Result |
|---|---:|
| Candidate source stable during run | Passed |
| Recipes | 100 (50 cloth + 50 rope) |
| Qualified fast paths | 5 |
| Conservative paths | 95 |
| Passed | 100 / 100 |
| Exact deterministic repeats | Passed |
| Finite state/render streams | Passed |
| Exact counts and break metadata | Passed |
| Exact surface/rope topology | Passed |
| Maximum state relative L2 | 7.873664e-4 (scene 649) |
| Maximum render relative L2 | 5.534935e-4 (scene 619) |

## Path classes

| Class | Count | Passed | Max state L2 | Max render L2 | Deterministic | Counts/topology |
|---|---:|---:|---:|---:|---:|---:|
| cloth-conservative | 45 | 45 | 0.000000e+0 | 0.000000e+0 | yes | exact |
| cloth-fused-step | 5 | 5 | 7.873664e-4 | 5.534935e-4 | yes | exact |
| rope-conservative | 50 | 50 | 0.000000e+0 | 0.000000e+0 | yes | exact |

## Per-recipe evidence

| ID | Domain/path | Scene | Max state L2 | Max render L2 | Breaks/counts | Deterministic | Pass |
|---:|---|---|---:|---:|---:|---:|---:|
| 600 | cloth/conservative | Tempest Standard — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 601 | cloth/conservative | Royal Banner Wind Tunnel — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 602 | cloth/conservative | Parachute Canopy Deployment — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 603 | cloth/conservative | Cargo Net Load Catch — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 604 | cloth/conservative | Suspended Hammock Dynamics — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 605 | cloth/conservative | Racing Sail Aerodynamics — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 606 | cloth/conservative | Progressive Fabric Tear Lab — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 607 | cloth/conservative | Drape Over Collider — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 608 | cloth/conservative | Grand Theater Curtain — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 609 | cloth/fused-step | Tensioned Membrane Drum — Baseline | 7.056587e-4 | 5.112382e-4 | exact | exact | PASS |
| 610 | cloth/conservative | Tempest Standard — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 611 | cloth/conservative | Royal Banner Wind Tunnel — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 612 | cloth/conservative | Parachute Canopy Deployment — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 613 | cloth/conservative | Cargo Net Load Catch — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 614 | cloth/conservative | Suspended Hammock Dynamics — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 615 | cloth/conservative | Racing Sail Aerodynamics — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 616 | cloth/conservative | Progressive Fabric Tear Lab — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 617 | cloth/conservative | Drape Over Collider — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 618 | cloth/conservative | Grand Theater Curtain — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 619 | cloth/fused-step | Tensioned Membrane Drum — High Stress | 7.769793e-4 | 5.534935e-4 | exact | exact | PASS |
| 620 | cloth/conservative | Tempest Standard — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 621 | cloth/conservative | Royal Banner Wind Tunnel — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 622 | cloth/conservative | Parachute Canopy Deployment — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 623 | cloth/conservative | Cargo Net Load Catch — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 624 | cloth/conservative | Suspended Hammock Dynamics — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 625 | cloth/conservative | Racing Sail Aerodynamics — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 626 | cloth/conservative | Progressive Fabric Tear Lab — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 627 | cloth/conservative | Drape Over Collider — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 628 | cloth/conservative | Grand Theater Curtain — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 629 | cloth/fused-step | Tensioned Membrane Drum — Precision | 7.245233e-4 | 4.998937e-4 | exact | exact | PASS |
| 630 | cloth/conservative | Tempest Standard — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 631 | cloth/conservative | Royal Banner Wind Tunnel — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 632 | cloth/conservative | Parachute Canopy Deployment — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 633 | cloth/conservative | Cargo Net Load Catch — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 634 | cloth/conservative | Suspended Hammock Dynamics — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 635 | cloth/conservative | Racing Sail Aerodynamics — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 636 | cloth/conservative | Progressive Fabric Tear Lab — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 637 | cloth/conservative | Drape Over Collider — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 638 | cloth/conservative | Grand Theater Curtain — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 639 | cloth/fused-step | Tensioned Membrane Drum — Impact Demo | 5.801240e-4 | 3.847201e-4 | exact | exact | PASS |
| 640 | cloth/conservative | Tempest Standard — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 641 | cloth/conservative | Royal Banner Wind Tunnel — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 642 | cloth/conservative | Parachute Canopy Deployment — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 643 | cloth/conservative | Cargo Net Load Catch — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 644 | cloth/conservative | Suspended Hammock Dynamics — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 645 | cloth/conservative | Racing Sail Aerodynamics — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 646 | cloth/conservative | Progressive Fabric Tear Lab — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 647 | cloth/conservative | Drape Over Collider — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 648 | cloth/conservative | Grand Theater Curtain — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 649 | cloth/fused-step | Tensioned Membrane Drum — Cinematic | 7.873664e-4 | 5.282008e-4 | exact | exact | PASS |
| 650 | rope/conservative | Sky Crane Cable Load — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 651 | rope/conservative | Suspension Cable Bridge — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 652 | rope/conservative | Heavy Pendulum Strike — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 653 | rope/conservative | Industrial Rope Ladder — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 654 | rope/conservative | Four-Point Mooring Array — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 655 | rope/conservative | Cable Curtain Failure — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 656 | rope/conservative | High-Speed Zipline — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 657 | rope/conservative | Grappling Line Tension — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 658 | rope/conservative | Multi-Sling Rigging Test — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 659 | rope/conservative | Rope Net Resonance — Baseline | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 660 | rope/conservative | Sky Crane Cable Load — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 661 | rope/conservative | Suspension Cable Bridge — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 662 | rope/conservative | Heavy Pendulum Strike — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 663 | rope/conservative | Industrial Rope Ladder — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 664 | rope/conservative | Four-Point Mooring Array — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 665 | rope/conservative | Cable Curtain Failure — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 666 | rope/conservative | High-Speed Zipline — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 667 | rope/conservative | Grappling Line Tension — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 668 | rope/conservative | Multi-Sling Rigging Test — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 669 | rope/conservative | Rope Net Resonance — High Stress | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 670 | rope/conservative | Sky Crane Cable Load — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 671 | rope/conservative | Suspension Cable Bridge — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 672 | rope/conservative | Heavy Pendulum Strike — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 673 | rope/conservative | Industrial Rope Ladder — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 674 | rope/conservative | Four-Point Mooring Array — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 675 | rope/conservative | Cable Curtain Failure — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 676 | rope/conservative | High-Speed Zipline — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 677 | rope/conservative | Grappling Line Tension — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 678 | rope/conservative | Multi-Sling Rigging Test — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 679 | rope/conservative | Rope Net Resonance — Precision | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 680 | rope/conservative | Sky Crane Cable Load — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 681 | rope/conservative | Suspension Cable Bridge — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 682 | rope/conservative | Heavy Pendulum Strike — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 683 | rope/conservative | Industrial Rope Ladder — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 684 | rope/conservative | Four-Point Mooring Array — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 685 | rope/conservative | Cable Curtain Failure — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 686 | rope/conservative | High-Speed Zipline — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 687 | rope/conservative | Grappling Line Tension — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 688 | rope/conservative | Multi-Sling Rigging Test — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 689 | rope/conservative | Rope Net Resonance — Impact Demo | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 690 | rope/conservative | Sky Crane Cable Load — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 691 | rope/conservative | Suspension Cable Bridge — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 692 | rope/conservative | Heavy Pendulum Strike — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 693 | rope/conservative | Industrial Rope Ladder — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 694 | rope/conservative | Four-Point Mooring Array — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 695 | rope/conservative | Cable Curtain Failure — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 696 | rope/conservative | High-Speed Zipline — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 697 | rope/conservative | Grappling Line Tension — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 698 | rope/conservative | Multi-Sling Rigging Test — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |
| 699 | rope/conservative | Rope Net Resonance — Cinematic | 0.000000e+0 | 0.000000e+0 | exact | exact | PASS |

## Gates

- Qualified cloth paths: state and render relative L2 must remain at or below 0.2%.
- Qualified rope paths: state and render relative L2 must remain at or below 0.05%.
- Conservative paths: relative L2 must remain at or below 1e-7.
- All paths require finite streams, exact repeated-run fingerprints, exact node/constraint/break/instance counts, exact topology, and successful suite validation.
