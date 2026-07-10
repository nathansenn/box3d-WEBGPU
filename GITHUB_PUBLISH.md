# Publish the AAA Edition to GitHub

Target:

```text
nathansenn/box3d-WEBGPU
```

The destination already contains upstream Box3D history. The included replacement script preserves that Git history, changes the working tree in a normal commit, runs the complete validation gate, and pushes without force-pushing.

## One-command safe publish

Run from the root of this AAA package—the directory containing `package.json`:

```bash
bash scripts/push-existing-box3d-webgpu.sh
```

Default behavior:

1. Clone `git@github.com:nathansenn/box3d-WEBGPU.git` into `~/box3d-WEBGPU`.
2. Fall back to HTTPS clone if SSH clone is unavailable.
3. Refuse to overwrite a target checkout with uncommitted changes.
4. Check out or create `main` from `origin/main`.
5. Remove the old working-tree files while preserving `.git`.
6. Copy the AAA project without `node_modules`, temporary builds, or generated WASM binaries.
7. Run `npm install` and `npm run validate`.
8. Commit as `Upgrade Box3D WebGPU to the AAA Physics Showcase`.
9. Push normally to `origin/main`.

## Recommended Mac sequence

```bash
cd ~/Downloads
unzip -o box3d-WEBGPU-AAA-edition.zip
cd box3d-WEBGPU-AAA

npm run doctor
npm run validate
bash scripts/push-existing-box3d-webgpu.sh
```

Do not paste terminal prompts or prior error output into zsh. Paste only command lines from code blocks.

## Authentication

Test SSH:

```bash
ssh -T git@github.com
```

Or authenticate GitHub CLI and allow HTTPS credentials:

```bash
brew install gh
gh auth login
```

Use a different clean checkout location when necessary:

```bash
TARGET_DIR="$HOME/box3d-WEBGPU-aaa-publish" \
  bash scripts/push-existing-box3d-webgpu.sh
```

Override the commit message:

```bash
COMMIT_MESSAGE="Ship Box3D WebGPU AAA Edition" \
  bash scripts/push-existing-box3d-webgpu.sh
```

## Manual equivalent

```bash
cd ~
rm -rf box3d-WEBGPU
git clone git@github.com:nathansenn/box3d-WEBGPU.git
cd box3d-WEBGPU
git checkout main

find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

# Copy the AAA package contents into this folder, then:
npm install
npm run validate

git add -A
git commit -m "Upgrade Box3D WebGPU to the AAA Physics Showcase"
git push origin main
```

## GitHub Pages

The Pages workflow runs tests, produces a relative-path Vite build, uploads `dist`, and deploys through GitHub Actions. In repository settings, select **Pages → Source → GitHub Actions** when GitHub has not enabled it automatically.

Expected public demo address:

```text
https://nathansenn.github.io/box3d-WEBGPU/
```

WebGPU requires a compatible browser and a secure context; GitHub Pages and localhost satisfy the serving requirement.
