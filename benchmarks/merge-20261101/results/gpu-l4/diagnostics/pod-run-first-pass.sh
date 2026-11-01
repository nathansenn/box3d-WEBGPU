#!/usr/bin/env bash
# GPU benchmarks for the merge, on one short-lived pod. Every step writes into $OUT and records its exit status;
# a failing step does not stop the others. The last step packs $OUT into results.tgz for download.
set -uo pipefail
WORK="${WORK:-/work}"
OUT="$WORK/out"
REPO="$WORK/repo"
MAIN="$WORK/main"
BRANCH="${BRANCH:-claude/upbeat-archimedes-k21g6x}"
NODE_VERSION="${NODE_VERSION:-v22.23.4}"
mkdir -p "$OUT"
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
step() {
  local name="$1"; shift
  log "== $name"
  local start=$(date +%s)
  "$@" > "$OUT/$name.log" 2>&1
  local rc=$?
  echo "$name rc=$rc $(( $(date +%s) - start ))s" >> "$OUT/steps.txt"
  log "$name rc=$rc ($(( $(date +%s) - start ))s)"
  return 0
}

log "== gpu setup"
nvidia-smi > "$OUT/nvidia-smi.txt" 2>&1
nvidia-smi -q > "$OUT/nvidia-smi-q-before.txt" 2>&1
if ! ls /etc/vulkan/icd.d/nvidia_icd.json /usr/share/vulkan/icd.d/nvidia_icd.json >/dev/null 2>&1 && ldconfig -p | grep -q libGLX_nvidia.so.0; then
  mkdir -p /etc/vulkan/icd.d
  printf '{"file_format_version":"1.0.0","ICD":{"library_path":"libGLX_nvidia.so.0","api_version":"1.3.0"}}\n' > /etc/vulkan/icd.d/nvidia_icd.json
fi
if ! ls /usr/share/glvnd/egl_vendor.d/*nvidia*.json >/dev/null 2>&1 && ldconfig -p | grep -q libEGL_nvidia.so.0; then
  mkdir -p /usr/share/glvnd/egl_vendor.d
  printf '{"file_format_version":"1.0.0","ICD":{"library_path":"libEGL_nvidia.so.0"}}\n' > /usr/share/glvnd/egl_vendor.d/10_nvidia.json
fi
if [ ! -f "$WORK/.apt-done" ]; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git libvulkan1 vulkan-tools xz-utils > "$WORK/apt.log" 2>&1 && touch "$WORK/.apt-done"
fi
vulkaninfo --summary > "$OUT/vulkaninfo.txt" 2>&1

if [ ! -x "/opt/node-$NODE_VERSION-linux-x64/bin/node" ]; then
  log "== node $NODE_VERSION"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" | tar -xJ -C /opt || { log "node download failed"; exit 20; }
fi
export PATH="/opt/node-$NODE_VERSION-linux-x64/bin:$PATH"
node --version > "$OUT/node-version.txt"

if [ ! -f "$WORK/.repo-done" ]; then
  log "== clone"
  rm -rf "$REPO" "$MAIN"
  git clone -q --filter=blob:none https://github.com/nathansenn/box3d-WEBGPU "$REPO" || { log "clone failed"; exit 21; }
  cd "$REPO" && git checkout -q --detach "origin/$BRANCH" || { log "checkout failed"; exit 22; }
  git -C "$REPO" worktree add -q --detach "$MAIN" origin/main || { log "main worktree failed"; exit 23; }
  ( cd "$REPO" && npm ci --no-audit --no-fund --loglevel=error ) > "$WORK/npm.log" 2>&1 || { log "npm ci failed"; tail -20 "$WORK/npm.log"; exit 24; }
  touch "$WORK/.repo-done"
fi
cd "$REPO" || exit 25
{ git log -1 --format='candidate: %H %ad %s' --date=iso; git -C "$MAIN" log -1 --format='main: %H %ad %s' --date=iso; } > "$OUT/source.txt"

if [ ! -d "$WORK/pw/node_modules/playwright-core" ]; then
  log "== playwright-core"
  mkdir -p "$WORK/pw" && ( cd "$WORK/pw" && npm init -y > /dev/null && npm i --no-audit --no-fund --loglevel=error playwright-core@1.63.0 ) > "$WORK/pw.log" 2>&1 || { log "playwright-core install failed"; exit 26; }
fi
PW="$WORK/pw/node_modules/playwright-core/index.mjs"
CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux64/chrome | head -1)"
echo "chrome: $CHROME" >> "$OUT/source.txt"

# Browser GPU report and the WebGPU adapter the hardware profile exposes.
step chrome-gpu node "$WORK/gpuinfo.mjs" "$PW" "$CHROME" "$OUT"

# Production renderer A/B in the browser: pinned baseline, then the colour-pipeline control baseline.
node benchmarks/rendering/serve.mjs > "$WORK/render-serve.log" 2>&1 &
node benchmarks/math-runtime/serve.mjs > "$WORK/math-serve.log" 2>&1 &
sleep 2
step rendering-prepare-pinned node benchmarks/rendering/prepare.mjs
step rendering-pinned timeout 3600 node benchmarks/rendering/run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/rendering/pinned/hardware-vulkan.json"
step rendering-prepare-control node benchmarks/rendering/prepare.mjs --visual-control
step rendering-control timeout 3600 node benchmarks/rendering/run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/rendering/control/hardware-vulkan.json"

# Water solver (JS, original scalar/SIMD WASM, WebGPU) and resident-water render parity plus upload overhead.
step math-browser timeout 3600 node benchmarks/math-runtime/playwright-run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/math-runtime/browser-hardware-vulkan.json"
step math-render-parity timeout 3600 node benchmarks/math-runtime/playwright-run.mjs --render-parity --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/math-runtime/render-parity-hardware-vulkan.json"

# Dawn (Node) on Vulkan: renderer startup main vs merged, the full renderer runtime test with evidence, partition
# on/off timing, resident water, rigid upload volume, and the paired CPU-vs-GPU water frame benchmark.
export WEBGPU_DAWN_BACKEND=vulkan
step startup env RENDERER_BASELINE_ROOT="$MAIN" RENDERER_STARTUP_SAMPLES=21 RENDERER_STARTUP_OUT="$OUT/renderer-startup-vulkan.json" timeout 3600 node scripts/renderer-startup-benchmark.mjs
step runtime-partition-on env WEBGPU_INSTANCE_PARTITION=1 WEBGPU_PARTITION_EVIDENCE="$OUT/partition-on-vulkan.json" WEBGPU_RIGID_STREAM_EVIDENCE=1 timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
cp benchmarks/results/native-rigid-upload-vulkan.json "$OUT/" 2>/dev/null
step runtime-partition-off env WEBGPU_INSTANCE_PARTITION=0 WEBGPU_PARTITION_EVIDENCE="$OUT/partition-off-vulkan.json" timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
step runtime-water env WEBGPU_WATER_EVIDENCE="$OUT/resident-water-vulkan.json" timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
step runtime-upload-cache env WEBGPU_BENCH_UPLOAD_CACHE=1 timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
cp benchmarks/results/upload-cache-vulkan.json "$OUT/" 2>/dev/null
step gpu-water-frames timeout 5400 node scripts/gpu-water-benchmark.mjs --out "$OUT/gpu-water-frames"
unset WEBGPU_DAWN_BACKEND

nvidia-smi -q > "$OUT/nvidia-smi-q-after.txt" 2>&1
log "== pack"
( cd "$OUT" && tar --exclude=results.tgz -czf results.tgz . )
log "== done"
