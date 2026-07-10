#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${BOX3D_ROOT:-$ROOT_DIR/third_party/box3d}"
REF="${BOX3D_REF:-v0.1.0}"

if [[ -f "$TARGET/CMakeLists.txt" ]]; then
  echo "Box3D already exists at $TARGET"
  git -C "$TARGET" status --short --branch 2>/dev/null || true
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git was not found." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
echo "Cloning Box3D $REF into $TARGET"
git clone --depth 1 --branch "$REF" https://github.com/erincatto/box3d.git "$TARGET"
echo "Box3D is ready. Next: npm run build:wasm"
