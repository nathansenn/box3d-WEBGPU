#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOX3D_ROOT="${BOX3D_ROOT:-$ROOT_DIR/third_party/box3d}"
BUILD_DIR="${B3W_BUILD_DIR:-$ROOT_DIR/build/box3d-wasm}"
OUT_DIR="${B3W_OUTPUT_DIR:-$ROOT_DIR/public/box3d}"
SIMD="${BOX3D_DISABLE_SIMD:-OFF}"

if ! command -v emcmake >/dev/null 2>&1; then
  cat >&2 <<'MSG'
emcmake was not found.

Install and activate Emscripten, then return to this project root:
  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
  cd ~/emsdk
  ./emsdk install 4.0.23
  ./emsdk activate 4.0.23
  source ./emsdk_env.sh
MSG
  exit 1
fi

printf 'Building with %s\n' "$(emcc --version | head -1)"
printf 'Reproducible release toolchain: Emscripten 4.0.23\n'

if [[ ! -f "$BOX3D_ROOT/CMakeLists.txt" ]]; then
  cat >&2 <<MSG
Box3D source was not found at:
  $BOX3D_ROOT

Fetch the reproducible upstream release first:
  npm run fetch:box3d

Or point at an existing checkout:
  BOX3D_ROOT=/absolute/path/to/box3d npm run build:wasm
MSG
  exit 1
fi

mkdir -p "$BUILD_DIR" "$OUT_DIR"

emcmake cmake \
  -S "$ROOT_DIR/wasm" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBOX3D_ROOT="$BOX3D_ROOT" \
  -DBOX3D_OUTPUT_DIR="$OUT_DIR" \
  -DBOX3D_DISABLE_SIMD="$SIMD"

cmake --build "$BUILD_DIR" --target box3d_web --config Release \
  -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

if [[ ! -s "$OUT_DIR/box3d.js" || ! -s "$OUT_DIR/box3d.wasm" ]]; then
  echo "Build completed but expected artifacts were not found in $OUT_DIR" >&2
  exit 1
fi

printf '\nBuilt native Box3D browser backend:\n  %s\n  %s\n' \
  "$OUT_DIR/box3d.js" "$OUT_DIR/box3d.wasm"
printf 'SIMD disabled: %s\n' "$SIMD"
printf 'Run: npm run dev\n'
