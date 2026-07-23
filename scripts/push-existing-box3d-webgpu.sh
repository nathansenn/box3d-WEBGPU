#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-nathansenn}"
REPO="${GITHUB_REPO:-box3d-WEBGPU}"
BRANCH="${GITHUB_BRANCH:-main}"
TARGET_DIR="${TARGET_DIR:-$HOME/box3d-WEBGPU}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-Add 31 AAA material demonstrations}"
REMOTE_SSH="git@github.com:${OWNER}/${REPO}.git"
REMOTE_HTTPS="https://github.com/${OWNER}/${REPO}.git"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "rsync is required" >&2; exit 1; }

if [[ ! -d "$TARGET_DIR/.git" ]]; then
  mkdir -p "$(dirname "$TARGET_DIR")"
  if git clone "$REMOTE_SSH" "$TARGET_DIR"; then
    :
  else
    git clone "$REMOTE_HTTPS" "$TARGET_DIR"
  fi
fi

cd "$TARGET_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  cat >&2 <<WARN
Target repo has uncommitted local changes:
  $TARGET_DIR

Commit/stash those changes or choose another target directory, for example:
  TARGET_DIR="$HOME/box3d-WEBGPU-fresh" bash scripts/push-existing-box3d-webgpu.sh
WARN
  exit 1
fi

git fetch origin "$BRANCH" || true
git checkout "$BRANCH" 2>/dev/null || git checkout -B "$BRANCH" "origin/$BRANCH"

# Remove current root contents while preserving .git. This turns the existing Box3D fork
# into the WebGPU lab in a normal commit, without force-pushing or rewriting history.
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.test-build' \
  --exclude='SOURCE_MANIFEST 2.sha256' \
  --exclude='src/assets/ktx2 2.ts' \
  --exclude='third_party/box3d' \
  "$PROJECT_ROOT/" "$TARGET_DIR/"

npm ci
npm run validate:v1.20

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$COMMIT_MESSAGE"
fi

git push origin "$BRANCH"

cat <<DONE

Pushed to:
  https://github.com/${OWNER}/${REPO}

Next:
  Open GitHub Actions and enable Pages source as GitHub Actions if it is not already enabled.
  Demo target: https://${OWNER}.github.io/${REPO}/
DONE
