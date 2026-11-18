# BOX3D public SEO release

The update is live at [BOX3D Engineering Studio](https://box3d.apxlabs.parts/). The current public app passes the portfolio's technical and content SEO release gate. This is the completed SEO follow-up to the already accepted material-studio release.

| State | Result |
| --- | --- |
| Source-ready | Yes: source and derived HTML each pass 21 scoped checks |
| Deployed-verified | Yes: final served HTML, 49 HTTP cases and nine rendered checks pass |
| Marketing-ready | Yes for this public app under the SEO release gate; no campaign or outreach was started |
| Public HTML coverage | One logical application page, eight study selectors, 12 route families |
| Canonical domain | `https://box3d.apxlabs.parts/` |
| Frozen artifact commit | `27a6f75ec93a2d0b37d45a34ca1939c10def5ead` |
| Final deployment | `d5c878a4-dec1-4e5a-b325-510375fcc267` — Railway SUCCESS |
| Final entry SHA-256 | `5d91a8b8dff607ec4fc9bd8381b1f6b9c889bc3b05b808e8b5ba5ba4cc98c321` |
| Railway image digest | `sha256:26cd21e341c8bbb18199ae01966e8a957857cbd833412f668782a7644e32b947` |

## Public page and route decisions

The root is a browser application for people exploring comparative material and structural behavior. Study selectors, experiment controls, presentation settings and historical workbench links select states in that application. They remain crawlable and use the root canonical. They do not create separate articles or thin indexable scene pages. Only the root appears in the sitemap.

The historical `workspace=test` and `view=structural-test` contexts have an intentional `noindex, follow` response header. Operational release/health data and license/provenance resources have `noindex`. This is indexing policy, not authentication. No account, checkout, private-review or source-code HTML surface is published; the tested unknown paths return real 404s.

The provider hostname redirects to the custom hostname, and `/index.html` redirects to `/`. Path and query preservation, including encoded query values, passed. HTTP redirects to HTTPS. `www.box3d.apxlabs.parts` is neither provisioned nor advertised; this release added no DNS hostname. The complete audience, intent, canonical, indexability and owner mapping is in `route-inventory.json`.

## Metadata and content

The initial HTML contains a useful application title and description, an absolute canonical, coherent robots metadata, Open Graph and Twitter cards, and applicable `WebSite` / `WebApplication` JSON-LD. The sharing image and browser icon reuse the existing approved liquid-lab image. Alt text and schema captions identify it as a generated design reference. Its actual 1586 × 992 dimensions are recorded.

A visible initial introduction supplies the main heading, eight descriptive study links, workflow guidance, model limits, project information and the shipped code license. It remains usable when JavaScript is disabled. Once the app loads, the active study provides its own heading, controls and model notes; the canonical and structured data remain stable. Browser verification confirmed both states.

The content describes the real app: five material labs with 40 material profiles and 40 prepared experiments, alongside metal press, canopy and bridge studies. It preserves the authored, comparative and uncalibrated model limits. The public project repository was verified, including its disabled issue tracker; the page links project information and licensing without inventing a support channel, organization, ratings, prices or engineering certification.

## Verification and scope

- `source-check.json` and `artifact-check.json`: 21 checks each, including parsed metadata/JSON-LD/XML, meaningful initial HTML, descriptive navigation, current catalog counts and unchanged owned runtime sources.
- `served-check.json`: 49 public HTTP cases covering the canonical page, all eight selectors, parameter and historical variants, diagnostic exclusions, redirects, discovery files, public image, licenses, genuine errors, cache policy and exact entry/worker bytes.
- `rendered-check.json`: the public app starts at 1280 × 800 and 390 × 844, keeps all eight studies, retains its canonical/schema and has no horizontal overflow or browser errors. The 390-pixel no-JavaScript view has useful content and correctly hides its loading message. No screenshots were taken; the shared Browserless lease was released.
- Caddy reported `Valid configuration` during deployment `d2ec6e22-417f-4789-804e-ba89c5f7ee1d`; that configuration is unchanged in the final deployment. Final logs show the server running on its dedicated Railway address, `10.163.157.244:8080`. The startup wrapper still defaults to loopback outside Railway.

The first browser sample found the default `/favicon.ico` request returning 404. Its failed receipt is preserved as `rendered-check-seo-v1.json`, with the exact request in `missing-resource-check.json`. A one-line icon link fixed it using the approved existing image. The second upload contains only that HTML correction and its release identity update; the final browser checks pass. Earlier receipts remain separately named.

Seven small release files differ from the original published wrapper, totaling 10,121 bytes. All 89 other frozen files, including compiled simulation code and media, retain their hashes. No app/physics build, dependency install, new media, full physics-suite rerun, DNS change or source-main staging was performed. The original 56 passing material-model tests remain evidence for the unchanged app, rather than newly run tests. `final-artifact-manifest.json` records the exact scope.

Search-engine indexing, ranking, rich-result eligibility and real-user Core Web Vitals are not established by these checks. Remote browser evidence does not establish physical-device performance or engineering calibration. Those claims are not made by this release.

## Reproduction and ownership

Source changes are in `index.html`, `public/robots.txt`, `public/sitemap.xml` and `deploy/railway/`. The release was derived inside `/private/tmp/box3d-static-release-20260910`, preserving the existing compiled module tag. The source checkout remains on its original HEAD with concurrent engine work preserved; the app runtime was not rebuilt from that shared dirty tree.

The same Railway project/service/environment remains in use. The original wrapper commit `1917fb9f5efcdf543c6a3c9520c0b623d7c7f0d0` and its image are the pre-SEO rollback baseline. Any future engine release needs its own tested application integration checkpoint. This task remains the app release owner; the DNS and engine owners retain their scopes.

The 0.01 GiB local allocation covered only small source/configuration, Git deltas and text receipts, with a fresh full-ledger 50 GiB guard before allocation. Railway uploads used the existing public-release authorization and normal action review. The CLI's [versioned upload implementation](https://github.com/railwayapp/cli/blob/v5.23.3/src/controllers/upload.rs) buffers the archive in memory; no new local release archive or full copy was created. Final retained SEO receipts are under 0.2 MiB. No future allocation is needed for this completed phase.

Primary guidance: [Google title links](https://developers.google.com/search/docs/appearance/title-link), [Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Caddy request matchers](https://caddyserver.com/docs/caddyfile/matchers), [Caddy route ordering](https://caddyserver.com/docs/caddyfile/directives/route) and [Caddy header behavior](https://caddyserver.com/docs/caddyfile/directives/header).
