# v1.11 Main-frame line staging benchmark

Decision: **accepted**.

The main loop now retains its combined rigid/soft/effect line list while all contributing source versions are unchanged. The benchmark exercises the complete staging path with a 280-body diagnostic wireframe, 384 soft diagnostic lines, and 144 shockwave lines.

| Scenario | v1.10 ns/frame | v1.11 ns/frame | Speedup | Paired 95% interval |
|---|---:|---:|---:|---:|
| paused-diagnostics | 16219.0 | 21.6 | **752.549x** | 559.335-800.192x |
| paused-effects | 384.8 | 13.4 | **28.652x** | 28.250-29.224x |
| mixed-60hz | 8115.6 | 3803.6 | **2.134x** | 2.111-2.148x |
| active-diagnostics | 15885.6 | 12495.8 | **1.271x** | 1.256-1.277x |

Exactness: 4,096 mixed active/paused/toggle frames compared, zero line-count or float-field mismatches, 1,812 unchanged-frame identity checks.

The active diagnostics control forces a rebuild every frame. Its lower paired confidence bound must remain at least 0.97x, preventing cached paused frames from hiding an active-frame regression.
