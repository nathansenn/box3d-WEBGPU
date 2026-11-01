#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$ROOT/SOURCE_MANIFEST.sha256"
TMP="$(mktemp "${TMPDIR:-/tmp}/box3d-webgpu-manifest.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

list_source_files() {
  find . -type f \
    ! -path './.git/*' \
    ! -path './.anchor/*' \
    ! -path './node_modules/*' \
    ! -path './dist/*' \
    ! -path './build/*' \
    ! -path './third_party/*' \
    ! -path './.test-build/*' \
    ! -path './.bench-build/*' \
    ! -path './benchmarks/results/logs/*' \
    ! -path './public/box3d/box3d.worker.js' \
    ! -path './VALIDATION_REPORT 2.md' \
    ! -path './VALIDATION_REPORT 3.md' \
    ! -path './VALIDATION_REPORT 4.md' \
    ! -path './benchmarks/build-report 2.mjs' \
    ! -path './docs/RENDERING_PIPELINE 2.md' \
    ! -path './docs/SOFT_BODY_AND_WATER 2.md' \
    ! -path './public/soft-kernels-scalar 2.wasm' \
    ! -path './public/soft-kernels-simd 2.wasm' \
    ! -path './src/assets/ktx2 2.ts' \
    ! -name '.DS_Store' \
    ! -name 'SOURCE_MANIFEST.sha256' \
    ! -name 'SOURCE_MANIFEST 2.sha256' \
    -print0 | LC_ALL=C sort -z
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

cd "$ROOT"

if [[ "${1:-}" == "--list" ]]; then
  while IFS= read -r -d '' file; do
    printf '%s\n' "${file#./}"
  done < <(list_source_files)
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--list]" >&2
  exit 2
fi

while IFS= read -r -d '' file; do
  relative="${file#./}"
  printf '%s  %s\n' "$(hash_file "$relative")" "$relative" >> "$TMP"
done < <(list_source_files)

mv "$TMP" "$OUTPUT"
trap - EXIT
printf 'Generated SOURCE_MANIFEST.sha256 with %s entries.\n' "$(wc -l < "$OUTPUT" | tr -d ' ')"
