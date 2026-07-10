#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

printf '\nBox3D WebGPU AAA Physics Lab — environment doctor\n'
printf 'Project root: %s\n\n' "$ROOT_DIR"

failures=0
warnings=0
pass() { printf '  [OK]   %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf '  [FAIL] %s\n' "$1" >&2; failures=$((failures + 1)); }

if [[ -f package.json && -f src/main.ts && -f wasm/CMakeLists.txt ]]; then
  pass "WebGPU project root detected"
else
  fail "Run this command from the AAA package root containing package.json, src/, and wasm/"
fi

if [[ "$ROOT_DIR" == */third_party/box3d || "$(basename "$ROOT_DIR")" == "box3d" && ! -f src/main.ts ]]; then
  fail "This is the upstream C engine folder, not the WebGPU application root"
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if (( NODE_MAJOR >= 20 )); then
    pass "Node.js $(node -v)"
  else
    warn "Node.js $(node -v) found; Node 20+ is recommended (CI uses Node 22)"
  fi
else
  fail "Node.js is missing"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm $(npm -v)"
else
  fail "npm is missing"
fi

if command -v git >/dev/null 2>&1; then
  pass "git $(git --version | awk '{print $3}')"
else
  fail "git is missing; it is required to fetch Box3D and publish the repo"
fi

if command -v cmake >/dev/null 2>&1; then
  pass "CMake $(cmake --version | head -1 | awk '{print $3}')"
else
  warn "CMake is missing; JavaScript preview still works, native WASM build does not"
fi

if command -v emcmake >/dev/null 2>&1 && command -v emcc >/dev/null 2>&1; then
  pass "Emscripten $(emcc --version | head -1)"
else
  warn "Emscripten is not active; the app will use the deterministic JavaScript preview backend"
fi

if [[ -f third_party/box3d/CMakeLists.txt ]]; then
  pass "Box3D source found at third_party/box3d"
else
  warn "Box3D source is absent; run: npm run fetch:box3d"
fi

if [[ -s public/box3d/box3d.js && -s public/box3d/box3d.wasm ]]; then
  pass "Native Box3D browser artifacts are present"
else
  warn "Native browser artifacts are absent; run npm run build:wasm after activating emsdk"
fi

if [[ -d node_modules ]]; then
  pass "npm dependencies are installed"
else
  warn "Dependencies are absent; run: npm install"
fi

cat <<'INFO'

Browser requirement:
  WebGPU must be available. Use current Chrome/Edge on desktop, or a compatible browser.
  Serve through localhost/HTTPS; opening index.html directly is not supported.
INFO

if (( failures > 0 )); then
  printf '\nDoctor result: %d failure(s), %d warning(s).\n' "$failures" "$warnings" >&2
  exit 1
fi

printf '\nDoctor result: ready, with %d optional warning(s).\n' "$warnings"
printf 'Recommended gate: npm install && npm run validate\n'
printf 'Launch: npm run dev\n\n'
