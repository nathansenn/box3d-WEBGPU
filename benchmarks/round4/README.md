# Round 4: 100 native GPU upload policies

This continuation repairs the sparse-upload planner and provides a reproducible
GPU experiment. Sparse uploads require exhaustive producer-owned change evidence
for the exact prior and current stream revisions. They remain explicitly opt-in.

The experiment predeclares 100 policies: five per-call cost estimates, five
maximum write counts, and four maximum transfer-coverage fractions. Each policy
uses exact additive-cost range coalescing, a bounded planning budget, and a full
upload fallback. These are 100 configurations, not 100 unrelated algorithms.

Each policy receives two fresh deterministic input sets, 24 paired four-frame
windows per set, and four equally represented producer workloads. AB/BA order
is balanced and shuffled from a recorded seed; policy order is shuffled too.
The primary timer includes mutation, candidate metadata construction, planning,
uploads, render submission, and queue completion. Actual render-pass timestamp
queries are recorded separately. Neither metric is browser presentation latency.

Qualification requires greater than 3% median paired improvement in both sets,
Holm-adjusted directional sign-test p-values at most 0.05, and candidate p95 at
most 1.10 times baseline. Both directions share all 400 planned tests.
Individual workload timings remain in the raw output, including regressions.
One successful mixed-workload label does not establish universal improvement.

Every captured fixture validates non-background rendering, exact full-versus-
sparse pixels, and complete matrix/color GPU readback against the CPU producer.
Device loss, validation errors and missing/invalid timestamps fail the run.

The top three observed policies (selection is explicitly exploratory) and the
default sparse policy then run through the actual Box3D renderer at 1920x1080,
4x MSAA, 2048 shadows and nine shadow taps. Three controlled rigid producers and
the checked-in native Box3D stack scene receive 12 new paired windows each.
Native exact dirty discovery and snapshot costs are timed. Renderer ratios are
descriptive confirmation evidence, not additional 100-case labels.

## Reproduce

    npm ci
    npm run typecheck
    npm run test:round4
    node benchmarks/round4/prepare.mjs
    BOX3D_R4_OUTPUT=/absolute/new/results \
    BOX3D_R4_DEADLINE=<a-fresh-UTC-ISO-deadline> \
    WEBGPU_PACKAGE_ROOT=/workspace/benchmark-tools/webgpu \
    node build/round4-bundle/gpu-100.mjs

Set a fresh deadline at most 45 minutes away and a new output directory.
The GPU runtime requires Linux x64, Node 24, pinned webgpu 0.6.2, one physical
NVIDIA GPU, native Vulkan, timestamp-query support, and graphics driver
capabilities configured when the container is created. Software adapters fail.
The preparation script emits all renderer dependencies and hashes source/native
artifacts, recording the source commit and whether the checkout is modified.

The Runpod bootstrap is for a dedicated task pod on the existing benchmark
volume. It runs a pinned pushed commit and exports a checksum-protected archive
through container logs. Its process timeout does **not** stop GPU billing:
an independent MCP watcher must stop/terminate the exact pod.
Do not run it without that watcher or a separately enforced provider deadline.
Raw benchmark output and captures stay out of Git per repository policy.

The older Round 3 runner now resolves its missing runtime and planner imports.
Published historical Round 3 measurements still belong to their original source
hashes; rerunning that harness on this branch exercises the revised planner.
