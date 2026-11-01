#!/usr/bin/env bash
# CPU benchmark suite for the merge, run in sequence so no two measurements share the machine.
# Single-threaded measurements are pinned to one logical CPU ($CPU); the threaded engine and the build use all of them.
# Inputs (environment):
#   MAIN_TREE      checkout of the baseline commit with node_modules installed (build-size)
#   MAIN_BUILD     baseline `tsc -p tsconfig.test.json` output with {"type":"commonjs"} package.json (soft-ab)
#   MERGED_BUILD   the same for the candidate tree
#   NATIVE_MAIN    directory holding the baseline public/box3d/box3d.{js,wasm}
#   OUT            result directory (default benchmarks/merge-20261101/results)
#   CPU            logical CPU for pinned runs (default 3)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="${OUT:-$ROOT/benchmarks/merge-20261101/results}"
CPU="${CPU:-3}"
BENCH="$ROOT/benchmarks/merge-20261101"
mkdir -p "$OUT/logs"
: > "$OUT/logs/steps.txt"
step() {
  local name="$1"; shift
  local start=$(date +%s)
  echo "[$(date -u +%H:%M:%S)] start $name"
  "$@" > "$OUT/logs/$name.log" 2>&1
  local rc=$?
  printf '%-20s rc=%-3s %6ss  load %s\n' "$name" "$rc" "$(( $(date +%s) - start ))" "$(cut -d' ' -f1-3 /proc/loadavg)" >> "$OUT/logs/steps.txt"
  echo "[$(date -u +%H:%M:%S)] done  $name rc=$rc"
}

step native-ab node "$BENCH/native-ab.mjs" --baseline "$NATIVE_MAIN" --candidate "$ROOT/public/box3d" --scenes-build "$MERGED_BUILD" \
  --per-family 4 --rounds 7 --warmup 30 --frames 120 --stress 5 --cpu "$CPU" --out "$OUT/native-ab.json"
step soft-ab-simd node "$BENCH/soft-ab.mjs" --baseline "$MAIN_BUILD" --candidate "$MERGED_BUILD" --scenes sample \
  --rounds 7 --warmup 30 --frames 120 --stress 5 --kernel simd --cpu "$CPU" --out "$OUT/soft-ab-simd.json"
step soft-ab-js node "$BENCH/soft-ab.mjs" --baseline "$MAIN_BUILD" --candidate "$MERGED_BUILD" --scenes sample \
  --rounds 5 --warmup 30 --frames 120 --stress 5 --kernel javascript --cpu "$CPU" --out "$OUT/soft-ab-javascript.json"
step studio node "$BENCH/studio-bench.mjs" --suite studio --rounds 7 --cpu "$CPU" --out "$OUT/studio-bench.json"
step labs node "$BENCH/studio-bench.mjs" --suite labs --budget-s 60 --cpu "$CPU" --out "$OUT/labs-bench.json"
step math-runtime taskset -c "$CPU" node benchmarks/math-runtime/run.mjs --out "$OUT/math-runtime-node-cpu.json"
step threaded node scripts/threaded-benchmark.mjs --bodies=1024,4096,16384 --configs=st,mt1,mt2,mt4 --reps=3 --out="$OUT/threaded.json"
step build-size node "$BENCH/build-size.mjs" --baseline "$MAIN_TREE" --candidate "$ROOT" --rounds 3 --out "$OUT/build-size.json"
echo "[$(date -u +%H:%M:%S)] all steps finished"
