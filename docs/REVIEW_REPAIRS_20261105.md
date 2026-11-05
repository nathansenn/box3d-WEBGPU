# Approved November 5 integration repairs

Base: `90dbd05929a48a93716d3dfd46a7fd7931baa5a8` (v1.20). Studio stays the default. `lab.html` restores the retained native Physics Capability Lab with its original compatible HTML shell (historical Git blob `46b5b7d59ec45c9efa58067526970e5e7b0e435b`), not an old replacement for current simulation source. Both entries are built and link to each other.

## Release checks

`npm run validate:release` is the shared CI and Pages gate. It includes the retained core tests, packaged WASM checks, dedicated Studio and engine tests, catalog-count checks, native and soft soaks, both builds, production artifact staging, and actual browser route checks. The release-toolchain byte-identical clang rebuild remains separate; portable CI does not pretend to execute it. Browser results record software rendering separately from physical-GPU qualification.

`npm run catalog:sync` regenerates `docs/CATALOG_COUNTS.json` and the marked README table from actual runtime exports. `npm run catalog:check` rejects drift.

## Deployment preparation, not deployment

`npm run stage:railway` assembles both entries and all native/soft artifacts from the production build into an owned directory under `build/`. The Docker image copies native single/threaded artifacts, texture atlases, and soft kernels explicitly. Caddy now configures COOP/COEP. Production deployment and merge are separate actions. GitHub Pages retains the single-thread fallback because it cannot supply these custom response headers.

## Performance boundaries

No numerical solver is modified by this integration. Glass world-wide contact rollback, canopy contact cost, and bit-exact rope batching remain separate optimization tasks with preserved correctness gates. `npm run bench:contact-budget` records bounded per-case completion, simulated time, p50/p95/p99/max step time and deadline failures; it does not label a timeout a pass or infer a speedup from one run.

Do not enable the sparse-upload work in PR #12 globally. Do not replace Studio's finite-volume liquid model with the different fixed-grid GPU-water pilot. Those are independent qualification decisions, not missing switches.
