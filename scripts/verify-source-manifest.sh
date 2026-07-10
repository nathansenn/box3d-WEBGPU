#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f SOURCE_MANIFEST.sha256 ]]; then
  echo "SOURCE_MANIFEST.sha256 is missing" >&2
  exit 1
fi

sha256sum --check SOURCE_MANIFEST.sha256
