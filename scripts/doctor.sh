#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Box3D WebGPU Maximum Lab doctor"
echo "Project root: $ROOT_DIR"

if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found. You are not in the WebGPU lab project root." >&2
  echo "Run this from the folder that contains package.json, not inside third_party/box3d." >&2
  exit 1
fi

if [[ "$(basename "$PWD")" == "box3d" ]]; then
  echo "ERROR: You appear to be inside the upstream Box3D source folder." >&2
  echo "Go back to the WebGPU lab folder, then run npm commands there." >&2
  exit 1
fi

node -v || { echo "ERROR: Node.js is required." >&2; exit 1; }
npm -v || { echo "ERROR: npm is required." >&2; exit 1; }

if command -v emcmake >/dev/null 2>&1; then
  echo "Emscripten: found"
else
  echo "Emscripten: not active. The app will still run with the JS fallback backend."
  echo "To build real Box3D WASM, install emsdk and source emsdk_env.sh."
fi

if [[ -f third_party/box3d/CMakeLists.txt ]]; then
  echo "Box3D source: found at third_party/box3d"
else
  echo "Box3D source: not found yet. Clone it with:"
  echo "  mkdir -p third_party && git clone https://github.com/erincatto/box3d.git third_party/box3d"
fi

echo "Doctor complete. Run: npm install && npm run dev"
