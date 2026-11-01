# Railway image

`Dockerfile` builds a Caddy image that serves a staged release. Build it from a directory that contains:

- **From this folder:** `Caddyfile` and `serve-railway.sh`.
- **From `npm run build` (`dist/`):** `index.html`, `robots.txt`, `sitemap.xml`, `assets/` and `studio/`.
- **From the release packaging:** `release-info.json` (also served at `/health`) and `licenses/`.

`serve-railway.sh` starts Caddy on `$PORT` (default 8080), listening on all interfaces unless `BOX3D_BIND` is set. The `Caddyfile` itself defaults to loopback.
