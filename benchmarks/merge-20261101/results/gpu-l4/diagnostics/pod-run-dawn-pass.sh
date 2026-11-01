#!/usr/bin/env bash
# Second pass on the same pod: fetch the fixed branch head, find the Chrome flags that expose the hardware WebGPU
# adapter on this host, rerun the browser benchmarks with them, and redo the two Dawn steps that failed.
set -uo pipefail
WORK="${WORK:-/work}"
OUT="$WORK/out/run2"
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

step diag node "$WORK/diag.mjs" "$PW" "$CHROME" "$OUT" http://127.0.0.1:4318/benchmarks/rendering/index.html
ARGS="$(node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const order = ["base+no-quantization", "base+developer-features", "base", "merged-feature-switch", "base+use-vulkan-native", "no-angle-vulkan", "webgpu-only"];
const hardware = (a) => a && !a.error && a.isFallbackAdapter !== true && a.featureLevel !== "compatibility" &&
  !/swiftshader|llvmpipe|lavapipe|subzero/i.test([a.vendor, a.architecture, a.device, a.description].join(" "));
for (const k of order) { const p = d[k]?.probe; if (p && hardware(p.highPerformance)) { console.log(d[k].args.join(" ")); process.exit(0); } }
' "$OUT/webgpu-flag-diagnosis.json" 2>/dev/null)"
echo "${ARGS:-NONE}" > "$OUT/chosen-browser-args.txt"
log "chosen browser args: ${ARGS:-NONE}"

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

export WEBGPU_DAWN_BACKEND=vulkan
step startup env RENDERER_BASELINE_ROOT="$MAIN" RENDERER_STARTUP_SAMPLES=21 RENDERER_STARTUP_OUT="$OUT/renderer-startup-vulkan.json" timeout 3600 node scripts/renderer-startup-benchmark.mjs
step runtime-partition-on env WEBGPU_INSTANCE_PARTITION=1 WEBGPU_PARTITION_EVIDENCE="$OUT/partition-on-vulkan.json" timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
step runtime-partition-off env WEBGPU_INSTANCE_PARTITION=0 WEBGPU_PARTITION_EVIDENCE="$OUT/partition-off-vulkan.json" timeout 3600 node scripts/webgpu-renderer-runtime-test.mjs
unset WEBGPU_DAWN_BACKEND

nvidia-smi -q > "$OUT/nvidia-smi-q-after.txt" 2>&1
log "== pack"
tar -czf "$WORK/results2.tgz" -C "$OUT" . && mv "$WORK/results2.tgz" "$WORK/out/results2.tgz"
log "== done"
