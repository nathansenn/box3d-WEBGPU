# BOX3D material studio — Railway release

The frozen material studio is published at **https://box3d.apxlabs.parts/**. The alternate provider URL is https://box3d-web-production.up.railway.app/.

The user authorized the portfolio's public launch and then explicitly chose Railway. This release publishes the product itself. It does not transfer the previously rejected private Browserless fixture. GitHub Pages was inspected only: no branch was pushed, workflow disabled, Pages site created, or GitHub custom-domain setting changed.

## Release identity

| Item | Value |
| --- | --- |
| Railway project | `959bb053-cb19-4d0c-9294-d4cc743f10a1` (`box3d`) |
| Service | `92f5a1b9-de73-4b6d-b704-5f8816e918ce` (`box3d-web`) |
| Production environment | `53a876e5-d3f0-4469-a32a-583b123498da` |
| Successful deployment | `c47f3f70-f0b8-4539-9329-c51755958b5d` |
| Container image digest | `sha256:0cad6ace71753e2955015c69dae389b589a6c50a6ce31b64fd4df926043a9f76` |
| Frozen app artifact commit | `954040819bb9b68c1be59912e7652c61266ce1a9` |
| Railway wrapper artifact commit | `1917fb9f5efcdf543c6a3c9520c0b623d7c7f0d0` |
| HTML SHA256 | `2e1c609831033dabef3e386521911a62ec0888db6f1a6cdff02b5fb535b8b2e8` |
| Module worker SHA256 | `80fd3ffeef713fa62e350bcaf3fe1a22f1c71c5b0436f24c583f978d4e837b58` |
| Upload | 94 files, 118,689,582 bytes; one upload |

The artifact repository is `/private/tmp/box3d-static-release-20260910`. The two artifact commits are local release checkpoints, not commits to the shared source repository. The source checkout remains on `main` at `dfedd9fe9983200f492d686488d27b6a4b11c650`, with the existing concurrent work preserved. The classic engine included here is the earlier tested checkpoint; newer engine work is not implicitly included.

## Hosting and domain

Railway runs one static Caddy container, serving the already built app. Its Dockerfile copies only the product files, assets and license notices into the public directory; no source rebuild or dependency installation was performed locally. Production logs confirm binding to the dedicated container address `10.137.67.18:8080`. The wrapper defaults to `127.0.0.1` outside Railway. Local preview remains loopback-only at port 5186.

The sole DNS owner added only the approved CNAME and ownership TXT under `apxlabs.parts`. Railway domain ID is `690e7c21-1c13-45eb-bbff-53bf0a6e8db5`, target port 8080. Ownership is verified and the certificate is valid. Normal HTTPS requests to the custom domain returned the exact frozen HTML, release identity and module worker.

The domain creation response is in `railway-domain-created.json`; the DNS owner's applied receipt is `/Users/commander/Documents/ChatGPT/domains/changes/2026-09-09T2355-box3d-dns-applied.json`. The app's public `/release-info.json` and `/health` identify this release.

## Verification

- Existing model validation: 56 passing tests, including all 40 complete experiment programs; typecheck and frozen production build passed. The deployment did not change those app bytes.
- Public origin HTTP checks: HTML, dynamic app modules, CSS, worker and release identity match the frozen SHA256 values. Representative image/GLB lengths and MIME types match. `.git/config`, `Dockerfile`, and a missing worker correctly return 404.
- Final hostname: standard TLS verification succeeds and the entry, release identity and worker match the frozen artifacts (`custom-domain-http.json`).
- Public liquid run: actual downloaded JSON contains 15 recorded frames through 0.875 seconds, finite geometry, the selected settings, and `calibrated: false`. Receipt is retained in `public-runtime-review.json`.
- Public worker: creates the plate model, completes 120 ticks / one simulated second, returns 2,871 finite Float32 positions and a checkpoint, then acknowledges disposal (`public-worker-check.json`).
- Rendered public liquid, glass, concrete, elastomer, granular and classic press views have been inspected. Granular also passes the 390 × 844 phone layout with no horizontal overflow. The independent domain-owner check confirms the final custom-host liquid view and worker; `ACCEPTANCE.json` consolidates the completed coverage.

The first multi-scene Browserless session ended at its duration bound after successful liquid/glass checks. Its partial overall result remains marked failed; shorter sessions verify the remaining views. One press check observed the renderer-ready flag before the separately loaded navigation module had finished. Waiting for the complete eight-study selector passed, with no old workbench links or page errors; both receipts are preserved.

Remote rendering uses software WebGL. The press remote view uses the balanced setting. Earlier local checks cover the native browser and ultra classic scenes. These records do not claim physical-device, native-store, or certified engineering acceptance. Material coefficients and fracture/flow behavior remain authored comparative models, not calibrated material-test data.

## Ownership and subsequent releases

This task owns the web release; the engine task owns its ongoing engine changes, and the domain task owns Cloudflare DNS. Railway is deployed from a selected local artifact, so a source `main` push does not update production automatically. Future engine releases must supply a tested integration checkpoint to the app release owner, preserve the current healthy deployment, and verify app identity, worker initialization and exports after deployment. Use Railway's retained successful deployment/image as the rollback baseline.

## Resource and approval receipts

The earlier approval-service usage block cleared after a fresh account-capacity check, and the same original read-only GitHub workflow inspection then succeeded. The separate private Browserless payload rejection remains preserved; no such upload occurred.

During the one Railway upload, a resource-guard subprocess returned nonzero but its caller incorrectly continued to the upload command. The owner reported the fall-through immediately; the upload had already completed when its process was checked. No pending upload remained, no extra build or snapshot followed, and the global coordinator reconciled reservations. Subsequent dependent command calls check exit status explicitly. The retained allocation was reduced to 5 MiB for the final small receipts and captures and is now released; no further allocation remains.
