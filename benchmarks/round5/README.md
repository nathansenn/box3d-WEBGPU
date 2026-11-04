# Round 5: 100 actual-renderer dirty-tracking comparisons

Round 4 found large controlled transfer savings but no qualified mixed-workload
policy improvement. Its native Box3D scene saved no upload bytes. This follow-up
tests five producer bookkeeping strategies against full uploads in the actual
renderer, with one fixed workload per comparison.

The family contains five trackers crossed with twenty workloads, for 100 new
conditions. These are five implementations and twenty workloads, not 100 new
algorithms. The strategies are explicit ranges, a record bitset, a generation-tagged
index list, conservative 32-record tiles, and early full-upload selection for dense
changes. They remain opt-in utilities. No new default is selected by the runner.

Sixteen controlled workloads cross 4,096/16,384 instances, contiguous/clustered/
scattered/dense changes, and matrix-only/matrix-plus-color updates. Native workloads
are scene 0 at stress 1 or stress 4 after twelve presteps, scene 50 (domino) at
stress 1 after twelve presteps, and scene 0 at stress 1 after six hundred presteps.
All exact seeds, mutation counts and settings are recorded before timing begins.
Controlled producers mark records when they mutate
them. Native scenes discover changes by exact scanning; that scan and snapshots
are charged to the candidate. Native scanning is not producer-owned tracking.
The baseline uses the existing full-stream path for changed versions; unchanged
version caches remain active in both arms.

Every condition uses the same sparse-upload planning policy: cost coalescing,
1,024 bytes of estimated cost per call, at most sixteen calls, maximum coverage
one, minimum savings 4,096 bytes, at most 256 planned spans, and gapRecords zero.
This was Round 4's descriptively selected R4-060 configuration, which remained
statistically unresolved. Holding it fixed isolates the tracking representation.

## Measurement and qualification

Each condition has two fresh seeded sets of 32 paired windows, with eight frames
per arm and balanced shuffled baseline/candidate order. Conditions are shuffled
too. The primary interval includes mutation or native stepping, all candidate
bookkeeping, metadata construction, planning, writes, encoding, submission and
GPU completion. Initial upload/reset, compilation, allocations and validation
readbacks are outside the timed interval. Both arms start from the same state.

Qualification requires median baseline/candidate time greater than 1.03 in both
sets, Holm-adjusted directional sign-test p-values at most 0.05 in both sets, and
candidate/baseline p95 at most 1.10 in both sets. Both directions share all 400
planned tests. This is a new follow-up family; Round 4 outcomes are retained with
their original criteria. The runner rejects incomplete families and records all
results, including regressions and unresolved conditions.

Rendering uses the actual Box3D renderer at 1920 by 1080 with 4x MSAA, 2048 shadows
and nine shadow taps. Native Dawn Vulkan must identify one physical NVIDIA GPU
and a non-fallback adapter. Normal validation remains enabled; explicit native
timestamp precision is recorded. The first and last pair of each input set
compare complete final-frame pixels and matrix/color buffers. Last-frame pass
timings are recorded separately. No browser presentation or whole-game FPS is
measured, and final-frame evidence does not capture every intermediate image.

## Reproduce

    npm ci
    npm run typecheck
    npm run test:round5
    npm run bench:round5:prepare
    BOX3D_R5_OUTPUT=/absolute/new/results \
    BOX3D_R5_DEADLINE=<fresh-UTC-ISO-deadline> \
    WEBGPU_PACKAGE_ROOT=/path/to/pinned-webgpu-package \
    node build/round5-bundle/gpu-100.mjs

Use Node 24, pinned webgpu 0.6.2, native Vulkan, and graphics driver capabilities
configured when the container is created. The output directory must be new and
the process deadline at most 45 minutes away. The emitted source manifest records
the Git commit, clean/dirty state and source/compiled artifact hashes.

The dedicated Runpod worker only accepts the pinned task and commit. It relays
bounded progress, captures partial results on failure, enforces a process deadline
and exports a SHA-256-protected tar.xz archive below six compressed megabytes.
An independent provider watcher must delete the exact endpoint after result
retrieval or at its absolute wall deadline. A process timeout or idle setting
alone does not verify billing has stopped. Raw runs remain outside Git under
the repository's AGENTS.md policy.
