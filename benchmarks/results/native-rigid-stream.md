# Native Box3D rigid-stream benchmark

- Exact active/final-sleep/settled stream equivalence: **passed**
- Final sleep captured at frame: **89**
- Dense-active native step (2310 bodies): **0.984×** (paired-bootstrap 95% 0.954–1.013×)
- Sparse-active native step (25 bodies): **1.040×** (paired-bootstrap 95% 1.021–1.056×)
- Settled native step (24 bodies): **113.416×** (paired-bootstrap 95% 110.545–117.342×)
- 4,096-body active rigid upload: **327,680 → 262,144 bytes (20% less)**
- 4,096-body unchanged settled upload: **0 bytes after initial upload**

- Actual Dawn Metal queue-write validation: **passed with zero uncaptured WebGPU errors**
- Rejected move-event subcandidate: **0.979× dense-active** (95% 0.957–1.014×); reverted because it did not prove a win.

Full raw samples, artifact hashes, MADs, correctness gates, and exact byte accounting are in `native-rigid-stream.json`.
