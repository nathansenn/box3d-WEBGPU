# Bridge Experiments V5

User intent: make the current bridge studio more useful. Build on Analyze V4 with repeatable one-variable experiments using the existing solver.

The built-in imagegen reference is generated first from the verified V4 runtime screenshot. Preserve the scene, five main tabs and dark inspector; add Inspect / Experiments inside Analyze. Reference data is illustrative only.

Scope: load, strength and crosswind scans; five cases per scan; 15, 30 or 60 model seconds; isolated sequential runs; cancellation and partial-result recovery; response comparison; selecting and loading cases; promotion to the existing baseline; bounded local persistence; CSV and JSON export.

Start from an intact model with frozen controls. Use the existing 120 Hz step / 10 Hz recording cadence, actual samples and rupture events. This does not calibrate physics or assign safe loads. Water appearance remains independent of structural loads.

Ownership: existing checkout is dirty with shared engine changes. Edit only new experiment modules, focused bridge view integration, tests, reference assets and this evidence directory. No Git reset, staging, commit, push, deployment or dependency installation.

Browser exception: one disposable local IAB tab because this is a private loopback-only app with native GPU rendering and solver interactions. Browserless cannot reach it; do not transfer the private build after the prior rejection. Preserve user tabs and authenticated sessions, reset viewport and close the owned tab at cleanup. Keep dev on 127.0.0.1:5173; production QA also binds 127.0.0.1.
