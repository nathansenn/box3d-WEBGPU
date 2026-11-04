#!/usr/bin/env bash
# Dedicated task pod only. An external MCP watcher MUST stop the exact pod.
# A process timeout does not stop Runpod billing.
set -euo pipefail
test -n "$BOX3D_R4_COMMIT"
test -n "$BOX3D_R4_BRANCH"
test -n "$BOX3D_R4_ROOT"
test -n "$BOX3D_R4_DEADLINE"
export DEBIAN_FRONTEND=noninteractive
export XDG_RUNTIME_DIR=/tmp/box3d-r4-runtime
mkdir -m 700 -p "$XDG_RUNTIME_DIR"
test ! -e "$BOX3D_R4_ROOT"
mkdir -m 700 "$BOX3D_R4_ROOT"
export BOX3D_R4_OUTPUT="$BOX3D_R4_ROOT/results"
echo "BOX3D_R4_BOOT preparing"
timeout 180 bash -c 'apt-get update -qq >/tmp/box3d-r4-apt.log 2>&1 && apt-get install -y -qq --no-install-recommends git curl xz-utils ca-certificates libvulkan1 libgl1 libegl1 libx11-6 libxext6 libxcb1 libxrandr2 libxfixes3 libxrender1 libdrm2 libgbm1 libudev1 >>/tmp/box3d-r4-apt.log 2>&1'
if test -x /workspace/benchmark-tools/node-v24.22.1-linux-x64/bin/node; then
 export PATH=/workspace/benchmark-tools/node-v24.22.1-linux-x64/bin:$PATH
 export WEBGPU_PACKAGE_ROOT=/workspace/benchmark-tools/webgpu
else
 mkdir -p /opt/box3d-tools
 cd /opt/box3d-tools
 timeout 180 curl --fail --silent --show-error --location https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz -o node.tar.xz
 timeout 30 curl --fail --silent --show-error --location https://nodejs.org/dist/v24.22.1/SHASUMS256.txt -o SHASUMS256.txt
 python3 - <<'PYHASH'
import hashlib,pathlib
expected=next(line.split()[0] for line in pathlib.Path('SHASUMS256.txt').read_text().splitlines() if line.endswith('  node-v24.22.1-linux-x64.tar.xz'))
assert hashlib.sha256(pathlib.Path('node.tar.xz').read_bytes()).hexdigest()==expected
PYHASH
 tar -xf node.tar.xz
 export PATH=/opt/box3d-tools/node-v24.22.1-linux-x64/bin:$PATH
 export WEBGPU_PACKAGE_ROOT=/opt/box3d-tools/webgpu
 mkdir -p "$WEBGPU_PACKAGE_ROOT"
 cd "$WEBGPU_PACKAGE_ROOT"
 npm init -y >/dev/null
 timeout 180 npm install --save-exact --no-audit --no-fund webgpu@0.6.2
fi
test -f "$WEBGPU_PACKAGE_ROOT/node_modules/webgpu/package.json"
timeout 180 git clone --depth 1 --branch "$BOX3D_R4_BRANCH" https://github.com/nathansenn/box3d-WEBGPU.git "$BOX3D_R4_ROOT/source"
cd "$BOX3D_R4_ROOT/source"
test "$(git rev-parse HEAD)" = "$BOX3D_R4_COMMIT"
timeout 180 npm ci --no-audit --no-fund
node benchmarks/round4/prepare.mjs
remain=$(( $(date -d "$BOX3D_R4_DEADLINE" +%s) - $(date +%s) ))
if (( remain < 1 || remain > 2700 )); then echo 'BOX3D_R4_BOOT invalid-deadline'; exit 2; fi
set +e
timeout --signal=TERM --kill-after=15s "$remain" node build/round4-bundle/gpu-100.mjs
status=$?
set -e
echo "BOX3D_R4_WORKER_EXIT $status"
# Results remain on the preserved volume as an independent recovery copy.
python3 - <<'PY'
import os, pathlib, tarfile, io, hashlib, base64, json, time
root=pathlib.Path(os.environ['BOX3D_R4_OUTPUT'])
if root.exists():
    files=sorted(p for p in root.rglob('*') if p.is_file())
    manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    (root/'SHA256.json').write_text(json.dumps(manifest,indent=2)+'\n')
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for p in sorted(root.rglob('*')):
            if p.is_file(): archive.add(p,arcname=str(p.relative_to(root)),recursive=False)
    data=stream.getvalue()
    (root.parent/'box3d-round4-evidence.tar.gz').write_bytes(data)
    encoded=base64.b64encode(data).decode()
    chunks=[encoded[i:i+12000] for i in range(0,len(encoded),12000)]
    meta={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'chunks':len(chunks)}
    print('BOX3D_R4_ARCHIVE '+json.dumps(meta),flush=True)
    if os.environ.get('BOX3D_R4_MODE') != 'serverless':
        for i,chunk in enumerate(chunks):
            print('BOX3D_R4_CHUNK '+json.dumps({'index':i,'sha256':hashlib.sha256(chunk.encode()).hexdigest(),'data':chunk}),flush=True)
            time.sleep(.08)
    print('BOX3D_R4_EXPORT_DONE '+json.dumps(meta),flush=True)
PY
echo "BOX3D_R4_READY_TO_STOP $status"
if [ "$(printenv BOX3D_R4_MODE || true)" = serverless ]; then exit "$status"; fi
# Root and independent watcher call provider stop/terminate after evidence capture.
while true; do sleep 30; done
