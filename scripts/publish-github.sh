#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-nathansenn}"
REPO="${GITHUB_REPO:-box3d-WEBGPU}"
VISIBILITY="${GITHUB_VISIBILITY:-public}"
BRANCH="${GITHUB_BRANCH:-main}"
REMOTE_URL="git@github.com:${OWNER}/${REPO}.git"
HTTPS_REMOTE="https://github.com/${OWNER}/${REPO}.git"
PAGES_URL="https://${OWNER}.github.io/${REPO}/"

if [[ "$VISIBILITY" != "public" && "$VISIBILITY" != "private" && "$VISIBILITY" != "internal" ]]; then
  echo "GITHUB_VISIBILITY must be public, private, or internal" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<HELP
GitHub CLI is required to create the remote repo.
Install it from https://cli.github.com/, then run:
  gh auth login
  bash scripts/publish-github.sh
HELP
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  gh auth login
fi

if [[ ! -d .git ]]; then
  git init
fi

git checkout -B "$BRANCH"

git add .
if git diff --cached --quiet; then
  echo "No staged changes to commit. Continuing."
else
  git commit -m "Publish Box3D WebGPU AAA Physics Showcase"
fi

if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "GitHub repo ${OWNER}/${REPO} already exists. Reusing it."
else
  case "$VISIBILITY" in
    public) gh repo create "${OWNER}/${REPO}" --public --description "AAA Box3D + WebGPU physics showcase with 600 deterministic recipes and 24 cinematic hero demos." ;;
    private) gh repo create "${OWNER}/${REPO}" --private --description "AAA Box3D + WebGPU physics showcase with 600 deterministic recipes and 24 cinematic hero demos." ;;
    internal) gh repo create "${OWNER}/${REPO}" --internal --description "AAA Box3D + WebGPU physics showcase with 600 deterministic recipes and 24 cinematic hero demos." ;;
  esac
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL" || git remote set-url origin "$HTTPS_REMOTE"
else
  git remote add origin "$REMOTE_URL"
fi

git push -u origin "$BRANCH"

gh repo edit "${OWNER}/${REPO}" --homepage "$PAGES_URL" || true

cat <<DONE

Published source to:
  https://github.com/${OWNER}/${REPO}

GitHub Actions will build and deploy the static demo to:
  ${PAGES_URL}

Open the Actions tab if Pages needs one manual approval the first time.
DONE
