#!/usr/bin/env bash
set -euo pipefail

OWNER="${GITHUB_OWNER:-nathansenn}"
REPO="${GITHUB_REPO:-box3d-WEBGPU}"
VISIBILITY="${GITHUB_VISIBILITY:-public}"
BRANCH="${GITHUB_BRANCH:-main}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-Optimize Box3D WebGPU v1.13 production paths}"
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

npm ci
npm run validate:v1.13

git add -A -- . ':(exclude)SOURCE_MANIFEST 2.sha256'
git rm --cached --ignore-unmatch -- 'SOURCE_MANIFEST 2.sha256' >/dev/null
if git diff --cached --quiet; then
  echo "No staged changes to commit. Continuing."
else
  git commit -m "$COMMIT_MESSAGE"
fi

if gh repo view "${OWNER}/${REPO}" >/dev/null 2>&1; then
  echo "GitHub repo ${OWNER}/${REPO} already exists. Reusing it."
else
  case "$VISIBILITY" in
    public) gh repo create "${OWNER}/${REPO}" --public --description "AAA Box3D + WebGPU physics lab with 750 scenes, 30 cinematic heroes, PBD cloth/rope, and interactive water." ;;
    private) gh repo create "${OWNER}/${REPO}" --private --description "AAA Box3D + WebGPU physics lab with 750 scenes, 30 cinematic heroes, PBD cloth/rope, and interactive water." ;;
    internal) gh repo create "${OWNER}/${REPO}" --internal --description "AAA Box3D + WebGPU physics lab with 750 scenes, 30 cinematic heroes, PBD cloth/rope, and interactive water." ;;
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
