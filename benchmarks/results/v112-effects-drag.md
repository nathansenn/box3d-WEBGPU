# WebPhysics v1.12 — exact cinematic-effect drag-factor benchmark

The immediate control is the current source with only the five-factor drag precomputation mechanically reverted. All other v1.11/v1.12 source is identical.

## Exactness

- Compared frames: **360**
- Compared line/shake scalars: **528,840**
- Float32 matrix/color bits: **exact**
- Debug lines, camera shake, counts, and frame versions: **exact**

## Complete class workloads

| Workload | Control | Candidate | Balanced speedup |
|---|---:|---:|---:|
| mixed-60hz:update-only | 15.528 ms | 10.699 ms | **1.425×** |
| mixed-60hz:update+build | 59.184 ms | 53.663 ms | **1.148×** |
| mixed-120hz:update-only | 19.777 ms | 16.962 ms | **1.084×** |
| mixed-120hz:update+build | 88.331 ms | 86.119 ms | **1.044×** |
| explosion-dense:update-only | 12.779 ms | 9.181 ms | **1.382×** |
| explosion-dense:update+build | 61.894 ms | 58.435 ms | **1.073×** |
| ballistic-and-rain:update-only | 11.484 ms | 7.298 ms | **1.462×** |
| ballistic-and-rain:update+build | 34.403 ms | 31.374 ms | **1.101×** |
| mixed-variable-dt:update-only | 16.285 ms | 12.484 ms | **1.254×** |
| mixed-variable-dt:update+build | 65.964 ms | 61.899 ms | **1.099×** |

Update-only geometric mean: **1.314×**
Update-plus-build geometric mean: **1.093×**

These are complete real CinematicEffects.update and update + buildFrame workloads, not the isolated Math.pow micro-kernel.
