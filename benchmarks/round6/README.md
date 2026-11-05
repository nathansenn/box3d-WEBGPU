# Round 6: review-only CPU tracking follow-up

This draft changes no runtime default. It is stacked on PR #12, exact parent `0134200705499d6fdcba56127f1fb9fd1b87ac30`. The new TypeScript module is copied byte-for-byte from the locally verified Round 6 source/evidence package. No prior benchmark or source is replaced.

## Included in this PR

- `src/webgpu/optimized-dirty-record-tracker.ts`: five explicitly selected mechanisms, exhaustive producer marking, bounded range union, locality-controlled full fallback, exact coverage and documented borrowed storage.
- `tests/optimized-dirty-record-tracker.test.mjs` and `tsconfig.round6.json`: the unchanged correctness suite and isolated compiler configuration.
- `docs/ROUND6_CPU_TRACKING.md`: integration contract, not an automatic renderer integration.
- `benchmarks/round6/SUMMARY.json`: original CPU result summary, preserved as historical evidence. Its `publication.githubPushed: false` describes the original measurement handoff, before this PR.

## CPU findings, not GPU or FPS claims

All 100 predeclared comparisons completed: **11 CPU-qualified, 2 CPU regressions, 1 tail rejection, 35 unresolved, 31 below the timing floor, and 20 unchanged-state controls**. The 11 passes belong to range-union and locality-gated compound recipes. Do not enable the bitmap alternatives globally. The reference was the corresponding Round 5 experimental tracker, not the production full-upload default.

Two fresh input sets each used 32 balanced AB/BA pairs of eight-frame windows: 6,400 pairs, 12,800 measured windows and 102,400 changing-or-control iterations. CPU mutation, tracking, planning and TypedArray copies were timed. No GPU uploads, render submissions, native physics stepping, queue completions or displayed frames were timed in this study.

Qualification required both median paired ratios >1.03, global 400-direction Holm correction at 0.05, both p95 candidate/baseline ratios <=1.10, and both arm medians >=0.05 ms per complete window. Controls cannot qualify; regressions and unresolved results remain in the original archive.

## Publication-time checks

Before publishing this PR, all **131 listed archive hashes** were reverified. The **15/15 tests** passed again with **5,647 replay frames, 1,708,610 record assertions, and 70 invalid-input checks**. Independent Python reanalysis of the original raw samples again passed **68,625 checks with zero discrepancies** and reproduced all 100 classifications. This reanalysis did not rerun the timing experiment.

## Reproduce the correctness suite in a checkout

With the repository's TypeScript development dependency already installed:

```bash
./node_modules/.bin/tsc -p tsconfig.round6.json
node --test tests/optimized-dirty-record-tracker.test.mjs
```

Remove the generated `.round6-build` directory before regenerating the repository's release manifest. The emitted JavaScript used by the frozen CPU experiment is retained in the original archive; compile with TypeScript 5.8.3 to reproduce that exact emission.

## Full evidence custody

The complete source, frozen benchmark, reference modules, every raw sample and per-case record, all 100 classifications, independent auditors and SHA-256 manifests remain in the previously delivered conversation attachment:

- Filename: `APEX_Round6_CPU_100_Source_and_Evidence.zip`
- Bytes: `720834`
- SHA-256: `43be4f685587cb16be18c30c31c539d5325c3d33ccae397526521354cb84841a`
- Original raw CPU JSON SHA-256: `6b846dff67530fb0a0129478e8df4aa84376c753faba53ab6fc97949ada81641`
- Candidate TypeScript SHA-256: `153fb8a7b79026cdfedc2658f55f012d5f159390ba57bae664467e4d3b40ea4c`

This PR publishes source, tests and summary evidence, **not the full raw archive**. No complete original phase-1/phase-2 volume export is claimed.

## Merge blockers

This remains a **draft**. The repository-wide `SOURCE_MANIFEST.sha256` must be regenerated after adding these files, then the full application CI must pass. The new test is supplied but is not yet wired into the standard `npm test` command. No application build or new physical-GPU run was performed in this publishing session. Actual renderer integration must be explicit and producer-owned, with fresh bounded GPU qualification before any performance promotion.

No Runpod resource was created, restarted, modified or deleted by this PR publication. No production branch was merged or deployed. The original campaign deadline and preserved volume remain unchanged.
