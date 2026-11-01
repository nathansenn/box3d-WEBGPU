#!/usr/bin/env bash
# Builds the optional pthread artifact public/box3d/box3d-mt.{js,wasm}. The single-threaded
# box3d.{js,wasm} produced by scripts/build-wasm.sh is left untouched. See docs/THREADED_ENGINE.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOX3D_ROOT="${BOX3D_ROOT:-$ROOT_DIR/third_party/box3d}"
BUILD_DIR="${B3W_BUILD_DIR:-$ROOT_DIR/build/box3d-wasm-mt}"
OUT_DIR="${B3W_OUTPUT_DIR:-$ROOT_DIR/public/box3d}"
SIMD="${BOX3D_DISABLE_SIMD:-OFF}"
JOBS="${B3W_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

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

printf 'Building the pthread artifact with %s\n' "$(emcc --version | head -1)"
printf 'Reproducible release toolchain: Emscripten 4.0.23\n'

if [[ ! -f "$BOX3D_ROOT/CMakeLists.txt" ]]; then
  cat >&2 <<MSG
Box3D source was not found at:
  $BOX3D_ROOT

Fetch the reproducible upstream release first:
  npm run fetch:box3d

Or point at an existing checkout:
  BOX3D_ROOT=/absolute/path/to/box3d npm run build:wasm:mt
MSG
  exit 1
fi

if [[ ! -f "$OUT_DIR/BUILD_PROVENANCE.json" ]]; then
  echo "$OUT_DIR/BUILD_PROVENANCE.json is missing. Run npm run build:wasm first." >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$OUT_DIR"

emcmake cmake \
  -S "$ROOT_DIR/wasm" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBOX3D_ROOT="$BOX3D_ROOT" \
  -DBOX3D_OUTPUT_DIR="$OUT_DIR" \
  -DBOX3D_DISABLE_SIMD="$SIMD" \
  -DB3W_THREADS=ON

cmake --build "$BUILD_DIR" --target box3d_web --config Release -j"$JOBS"

if [[ ! -s "$OUT_DIR/box3d-mt.js" || ! -s "$OUT_DIR/box3d-mt.wasm" ]]; then
  echo "Build completed but expected artifacts were not found in $OUT_DIR" >&2
  exit 1
fi

B3W_EMSCRIPTEN_VERSION="$(emcc --version | head -1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" \
  node "$ROOT_DIR/scripts/update-threaded-provenance.mjs" "$ROOT_DIR" "$OUT_DIR"

printf '\nBuilt pthread Box3D artifact:\n  %s\n  %s\n' \
  "$OUT_DIR/box3d-mt.js" "$OUT_DIR/box3d-mt.wasm"
printf 'SIMD disabled: %s\n' "$SIMD"
printf 'Browsers need a cross-origin-isolated page to use it; see docs/THREADED_ENGINE.md.\n'
printf 'Run: npm run test:threaded\n'
