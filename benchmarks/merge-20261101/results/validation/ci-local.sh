#!/usr/bin/env bash
# Runs the steps of .github/workflows/ci.yml in order, continuing after failures,
# and records status and duration for each. Usage: ci-local.sh <repo> <outdir>
REPO="$1"; OUT="$2"
mkdir -p "$OUT"; : > "$OUT/summary.txt"
cd "$REPO" || exit 1
TESTBUILD_PKG="node -e \"require('fs').mkdirSync('.test-build', {recursive:true}); require('fs').writeFileSync('.test-build/package.json', '{\\\"type\\\":\\\"commonjs\\\"}')\""
steps=(
  "verify-source|npm run verify:source"
  "typecheck|npm run typecheck"
  "test-build|rm -rf .test-build && npx tsc -p tsconfig.test.json && $TESTBUILD_PKG"
  "unit|node .test-build/tests/unit.test.js"
  "engineering-evidence|node .test-build/tests/engineering-evidence.test.js"
  "execution-graph|node .test-build/tests/execution-graph.test.js"
  "water-reference|node .test-build/tests/water-reference.test.js"
  "water-surface-plan|node .test-build/tests/water-surface-plan.test.js"
  "projection-depth|node .test-build/tests/projection-depth.test.js"
  "instance-visibility|node .test-build/tests/instance-visibility.test.js"
  "self-test|node scripts/self-test.mjs"
  "cbridge|npm run test:cbridge"
  "soft-kernel|node scripts/soft-kernel-test.mjs"
  "test-build-2|rm -rf .test-build && npx tsc -p tsconfig.test.json && $TESTBUILD_PKG"
  "soft-kernel-integration|node scripts/soft-kernel-integration-test.cjs"
  "webgpu|npm run test:webgpu"
  "collision|npm run test:collision"
  "assets|npm run test:assets"
  "soft-soak-all|npm run test:soft-soak:all"
  "rope-batching|npm run test:rope-batching"
  "native-wasm|npm run test:native-wasm"
  "material-100|npm run test:material:100"
  "build|npm run build"
  "build-pages|npm run build:pages"
  "audit|npm audit --audit-level=moderate"
)
for entry in "${steps[@]}"; do
  name="${entry%%|*}"; cmd="${entry#*|}"
  start=$(date +%s)
  timeout 3600 bash -c "$cmd" > "$OUT/$name.log" 2>&1
  rc=$?
  printf "%-26s rc=%-3s %5ss\n" "$name" "$rc" "$(( $(date +%s) - start ))" >> "$OUT/summary.txt"
done
echo DONE >> "$OUT/summary.txt"
