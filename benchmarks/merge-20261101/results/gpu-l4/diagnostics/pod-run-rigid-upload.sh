#!/usr/bin/env bash
set -uo pipefail
export PATH="/opt/node-v22.23.4-linux-x64/bin:$PATH"
cd /work/repo || exit 50
WEBGPU_DAWN_BACKEND=vulkan WEBGPU_RIGID_STREAM_EVIDENCE=1 timeout 600 node scripts/webgpu-renderer-runtime-test.mjs > /work/out/runtime-rigid-stream.log 2>&1
echo "rigid stream rc=$?"
cp benchmarks/results/native-rigid-upload-vulkan.json /work/out/ 2>/dev/null
nvidia-smi -q > /work/out/nvidia-smi-q-final.txt 2>&1
git log -1 --format='candidate: %H' > /work/out/run5-source.txt
echo done
