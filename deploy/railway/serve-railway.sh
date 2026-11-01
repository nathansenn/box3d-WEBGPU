#!/bin/sh
# Entry point of the Railway image (see Dockerfile): serve the staged site with Caddy on $PORT.
# Reconstructed on 2026-11-01. The original 603-byte script listed in
# docs/design/material-labs-20260910/release/railway-release-manifest.json was never committed.
set -eu

PORT="${PORT:-8080}"
case "$PORT" in
  '' | *[!0-9]*) echo "serve-box3d: PORT must be a port number, got '$PORT'" >&2; exit 64 ;;
esac
export PORT

# The Caddyfile binds to loopback unless told otherwise. Railway reaches the container from outside it.
export BOX3D_BIND="${BOX3D_BIND:-0.0.0.0}"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
