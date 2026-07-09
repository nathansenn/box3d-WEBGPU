#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOX3D_ROOT="${BOX3D_ROOT:-$ROOT_DIR/third_party/box3d}"
BUILD_DIR="$ROOT_DIR/build/box3d-wasm"
OUT_DIR="$ROOT_DIR/public/box3d"
BRIDGE_C="$ROOT_DIR/wasm/box3d_web.c"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake was not found. Install and activate Emscripten first:" >&2
  echo "  git clone https://github.com/emscripten-core/emsdk.git" >&2
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest" >&2
  echo "  source ./emsdk_env.sh" >&2
  exit 1
fi

if [[ ! -f "$BOX3D_ROOT/CMakeLists.txt" ]]; then
  echo "Box3D source not found at: $BOX3D_ROOT" >&2
  echo "Either clone it there:" >&2
  echo "  git clone https://github.com/erincatto/box3d.git '$BOX3D_ROOT'" >&2
  echo "or run with BOX3D_ROOT=/path/to/box3d npm run build:wasm" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$OUT_DIR"

emcmake cmake \
  -S "$BOX3D_ROOT" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBOX3D_SAMPLES=OFF \
  -DBOX3D_UNIT_TESTS=OFF \
  -DBOX3D_BENCHMARKS=OFF \
  -DBOX3D_DOCS=OFF \
  -DBOX3D_PROFILE=OFF \
  -DBOX3D_VALIDATE=OFF \
  -DBOX3D_DISABLE_SIMD=ON

cmake --build "$BUILD_DIR" --target box3d --config Release -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

LIB_BOX3D="$(find "$BUILD_DIR" -name 'libbox3d.a' -o -name 'box3d.lib' | head -n 1)"
if [[ -z "$LIB_BOX3D" ]]; then
  echo "Could not locate built Box3D library under $BUILD_DIR" >&2
  exit 1
fi

emcc "$BRIDGE_C" "$LIB_BOX3D" \
  -I"$BOX3D_ROOT/include" \
  -O3 \
  -flto \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s WASM_BIGINT=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_b3w_create_demo","_b3w_create_scene","_b3w_destroy","_b3w_body_count","_b3w_dynamic_count","_b3w_matrices_ptr","_b3w_colors_ptr","_b3w_max_bodies","_b3w_sync_transforms","_b3w_step","_b3w_apply_impulse","_b3w_kick_stack","_b3w_explode","_b3w_launch_projectile","_b3w_spawn_rain","_b3w_replay_hash"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPU8","ccall","cwrap"]' \
  -o "$OUT_DIR/box3d.js"

echo "Built $OUT_DIR/box3d.js and $OUT_DIR/box3d.wasm"
