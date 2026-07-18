#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/wasm/soft_kernels.c"
OUTPUT_DIR="$ROOT/public"
CC="${CC:-clang}"
VERIFY=0

if [[ "${1:-}" == "--verify" ]]; then
  VERIFY=1
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--verify]" >&2
  exit 2
fi

if ! command -v "$CC" >/dev/null 2>&1; then
  echo "error: clang-compatible compiler not found: $CC" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/box3d-soft-kernels.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH=1

COMMON=(
  --target=wasm32
  -std=c17
  -O3
  -flto
  -nostdlib
  -fvisibility=hidden
  -ffp-contract=off
  -fno-ident
  -Wall
  -Wextra
  -Werror
  -Wl,--no-entry
  -Wl,--export-memory
  -Wl,--initial-memory=4194304
  -Wl,--max-memory=67108864
  -Wl,--strip-all
)

build_variant() {
  local variant="$1"
  local output="$2"
  local simd_flag definition
  if [[ "$variant" == "simd" ]]; then
    simd_flag=-msimd128
    definition=-DSOFT_SIMD=1
  else
    simd_flag=-mno-simd128
    definition=-DSOFT_SIMD=0
  fi
  "$CC" "${COMMON[@]}" "$simd_flag" "$definition" "$SOURCE" -o "$output"
}

for variant in simd scalar; do
  first="$WORK/soft-kernels-$variant.first.wasm"
  build_variant "$variant" "$first"
  if [[ $VERIFY -eq 1 ]]; then
    second="$WORK/soft-kernels-$variant.second.wasm"
    build_variant "$variant" "$second"
    if ! cmp -s "$first" "$second"; then
      echo "error: $variant WebAssembly build is not byte-deterministic" >&2
      exit 1
    fi
    packaged="$OUTPUT_DIR/soft-kernels-$variant.wasm"
    if [[ ! -f "$packaged" ]]; then
      echo "error: packaged $variant WebAssembly module is missing: $packaged" >&2
      exit 1
    fi
    if ! cmp -s "$first" "$packaged"; then
      echo "error: packaged $variant WebAssembly module does not match wasm/soft_kernels.c" >&2
      echo "run npm run build:soft-kernels and commit the rebuilt module" >&2
      exit 1
    fi
  else
    install -m 0644 "$first" "$OUTPUT_DIR/soft-kernels-$variant.wasm"
  fi
done

if [[ $VERIFY -eq 1 ]]; then
  echo "soft kernels: packaged SIMD/scalar modules match byte-deterministic rebuilds"
fi
shasum -a 256 \
  "$OUTPUT_DIR/soft-kernels-simd.wasm" \
  "$OUTPUT_DIR/soft-kernels-scalar.wasm"
