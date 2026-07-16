#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CURRENT_FILES="$(mktemp "${TMPDIR:-/tmp}/box3d-webgpu-current-files.XXXXXX")"
MANIFEST_FILES="$(mktemp "${TMPDIR:-/tmp}/box3d-webgpu-manifest-files.XXXXXX")"
trap 'rm -f "$CURRENT_FILES" "$MANIFEST_FILES"' EXIT

if [[ ! -f SOURCE_MANIFEST.sha256 ]]; then
  echo "SOURCE_MANIFEST.sha256 is missing" >&2
  exit 1
fi

bash ./scripts/generate-source-manifest.sh --list > "$CURRENT_FILES"

if ! awk '
  {
    hash = substr($0, 1, 64)
    separator = substr($0, 65, 2)
    path = substr($0, 67)
    if (length($0) < 67 || separator != "  " || hash ~ /[^0-9a-fA-F]/ || path == "") {
      printf "Invalid source-manifest entry at line %d\n", NR > "/dev/stderr"
      exit 1
    }
    print path
  }
' SOURCE_MANIFEST.sha256 | LC_ALL=C sort -u > "$MANIFEST_FILES"; then
  exit 1
fi

manifest_entry_count="$(wc -l < SOURCE_MANIFEST.sha256 | tr -d ' ')"
manifest_path_count="$(wc -l < "$MANIFEST_FILES" | tr -d ' ')"
if [[ "$manifest_entry_count" != "$manifest_path_count" ]]; then
  echo "SOURCE_MANIFEST.sha256 contains duplicate file entries." >&2
  exit 1
fi

if ! cmp -s "$CURRENT_FILES" "$MANIFEST_FILES"; then
  echo "SOURCE_MANIFEST.sha256 does not cover the exact release file set." >&2

  missing="$(LC_ALL=C comm -23 "$CURRENT_FILES" "$MANIFEST_FILES")"
  stale="$(LC_ALL=C comm -13 "$CURRENT_FILES" "$MANIFEST_FILES")"

  if [[ -n "$missing" ]]; then
    echo "Files missing from SOURCE_MANIFEST.sha256:" >&2
    printf '%s\n' "$missing" >&2
  fi
  if [[ -n "$stale" ]]; then
    echo "Manifest entries that are no longer release files:" >&2
    printf '%s\n' "$stale" >&2
  fi
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check SOURCE_MANIFEST.sha256
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 --check SOURCE_MANIFEST.sha256
else
  echo "Neither sha256sum nor shasum is available." >&2
  exit 1
fi
