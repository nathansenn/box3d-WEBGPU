#!/usr/bin/env bash
# Fourth pass on the same pod (browser benchmarks only, with the adapter warm-up): fetch the fixed branch head, find the Chrome flags that expose the hardware WebGPU
# adapter on this host, rerun the browser benchmarks with them, and redo the two Dawn steps that failed.
set -uo pipefail
WORK="${WORK:-/work}"
OUT="$WORK/out/run4"
REPO="$WORK/repo"
MAIN="$WORK/main"
BRANCH="${BRANCH:-claude/upbeat-archimedes-k21g6x}"
export PATH="/opt/node-v22.23.4-linux-x64/bin:$PATH"
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

cd "$REPO" || exit 30
git fetch -q origin "$BRANCH" && git checkout -q --detach FETCH_HEAD || { log "fetch failed"; exit 31; }
{ git log -1 --format='candidate: %H %ad %s' --date=iso; git -C "$MAIN" log -1 --format='main: %H %ad %s' --date=iso; } > "$OUT/source.txt"
PW="$WORK/pw/node_modules/playwright-core/index.mjs"
CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux64/chrome | head -1)"
echo "chrome: $CHROME" >> "$OUT/source.txt"

for pid in $(pgrep -f "node benchmarks/(rendering|math-runtime)/serve.mjs"); do kill "$pid"; done
sleep 1
node benchmarks/rendering/serve.mjs > "$WORK/render-serve2.log" 2>&1 &
node benchmarks/math-runtime/serve.mjs > "$WORK/math-serve2.log" 2>&1 &
sleep 2

ARGS="--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --ignore-gpu-blocklist --disable-dawn-features=timestamp_quantization"
echo "$ARGS" > "$OUT/chosen-browser-args.txt"
if [ -n "$ARGS" ]; then
  export BOX3D_HARDWARE_ARGS="$ARGS"
  step rendering-prepare-pinned node benchmarks/rendering/prepare.mjs
  step rendering-pinned timeout 3600 node benchmarks/rendering/run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/rendering/pinned/hardware-vulkan.json"
  step rendering-prepare-control node benchmarks/rendering/prepare.mjs --visual-control
  step rendering-control timeout 3600 node benchmarks/rendering/run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/rendering/control/hardware-vulkan.json"
  step math-browser timeout 3600 node benchmarks/math-runtime/playwright-run.mjs --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/math-runtime/browser-hardware-vulkan.json"
  step math-render-parity timeout 3600 node benchmarks/math-runtime/playwright-run.mjs --render-parity --hardware-vulkan --playwright-path "$PW" --executable-path "$CHROME" --out "$OUT/math-runtime/render-parity-hardware-vulkan.json"
  unset BOX3D_HARDWARE_ARGS
fi

nvidia-smi -q > "$OUT/nvidia-smi-q-after.txt" 2>&1
log "== pack"
tar -czf "$WORK/results4.tgz" -C "$OUT" . && mv "$WORK/results4.tgz" "$WORK/out/results4.tgz"
log "== done"
