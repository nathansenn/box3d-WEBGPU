# GitHub Publish Guide

Target repo:

```text
nathansenn/box3d-WEBGPU
```

That repository already exists and is currently a fork of `erincatto/box3d`, so the safest path is to clone that repo, replace the working tree with this WebGPU lab, commit, and push. This preserves normal Git history and avoids a force push.

## Push to the existing repo

From this project root:

```bash
bash scripts/push-existing-box3d-webgpu.sh
```

The script will:

1. Clone `nathansenn/box3d-WEBGPU` into `~/box3d-WEBGPU` if needed.
2. Check out `main`.
3. Remove the old upstream Box3D root files while preserving `.git`.
4. Copy this WebGPU lab into the repo.
5. Run `npm install`, `npm test`, and `npm run build`.
6. Commit and push to `main`.

## Requirements

```bash
git --version
npm --version
```

For SSH push, your GitHub SSH key must be configured. If SSH fails, the script falls back to HTTPS clone, but pushing over HTTPS may ask for GitHub authentication.

## Manual fallback

```bash
cd ~
git clone git@github.com:nathansenn/box3d-WEBGPU.git
cd box3d-WEBGPU

git checkout main
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

# From another terminal, copy the WebGPU lab package contents into this folder.
# Then:
npm install
npm test
npm run build

git add -A
git commit -m "Replace upstream fork files with Box3D WebGPU Maximum Lab"
git push origin main
```

## GitHub Pages

The included workflow `.github/workflows/pages.yml` deploys the static build from `dist/` to GitHub Pages. It uses relative asset paths, so the WebGPU app works correctly from:

```text
https://nathansenn.github.io/box3d-WEBGPU/
```

The first deploy may require enabling Pages with **Source: GitHub Actions** in the repository settings.
