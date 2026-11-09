"""Pinned Round 5 worker with live progress, bounded runtime and result export."""
import base64
import datetime
import hashlib
import io
import json
import os
import pathlib
import signal
import subprocess
import tarfile
import threading
import uuid
import runpod

EXPECTED_COMMIT = os.environ["BOX3D_R5_COMMIT"]
BOOTSTRAP = base64.b64decode(os.environ["BOX3D_R5_BOOTSTRAP_B64"], validate=True)
WALL_DEADLINE = datetime.datetime.fromisoformat(os.environ["BOX3D_R5_WALL_DEADLINE"].replace("Z", "+00:00"))
WORKSPACE_ROOT = pathlib.Path("/workspace")


def signal_group(process, signum):
    if process is not None:
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            pass


def handler(job):
    if job.get("input", {}) != {"task": "box3d-round5-100", "commit": EXPECTED_COMMIT}:
        return {"ok": False, "error": "Only the pinned Round 5 benchmark is accepted"}
    now = datetime.datetime.now(datetime.timezone.utc)
    deadline = min(now + datetime.timedelta(minutes=30), WALL_DEADLINE - datetime.timedelta(seconds=180))
    remaining = int((deadline - now).total_seconds())
    if remaining < 120:
        return {"ok": False, "error": "Insufficient time before independent cleanup deadline"}
    root = WORKSPACE_ROOT / ("box3d-r5-sl-" + uuid.uuid4().hex)
    log = pathlib.Path("/tmp") / (root.name + ".log")
    script = pathlib.Path("/tmp") / (root.name + ".sh")
    script.write_bytes(BOOTSTRAP)
    env = os.environ.copy()
    env.update({"BOX3D_R5_ROOT": str(root), "BOX3D_R5_MODE": "serverless", "BOX3D_R5_DEADLINE": deadline.isoformat()})
    code, error, process, reader = None, None, None, None
    try:
        with log.open("wb") as output:
            try:
                process = subprocess.Popen(["bash", str(script)], env=env, stdout=subprocess.PIPE,
                                           stderr=subprocess.STDOUT, start_new_session=True)

                def relay():
                    with process.stdout:
                        for line in iter(process.stdout.readline, b""):
                            output.write(line)
                            output.flush()
                            if line.startswith(b"BOX3D_R5"):
                                print(line[:8192].decode("utf-8", errors="replace").rstrip(), flush=True)

                reader = threading.Thread(target=relay, daemon=True)
                reader.start()
                try:
                    code = process.wait(timeout=remaining + 20)
                except subprocess.TimeoutExpired:
                    error = "Worker exceeded the bounded campaign deadline"
                    signal_group(process, signal.SIGTERM)
                    try:
                        code = process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        pass
            finally:
                # The leader can exit while descendants still hold the output pipe.
                signal_group(process, signal.SIGKILL)
                try:
                    if process is not None and process.poll() is None:
                        code = process.wait(timeout=5)
                finally:
                    if reader is not None:
                        reader.join(timeout=5)
    except Exception as exc:
        error = str(exc)
    results = root / "results"
    results.mkdir(parents=True, exist_ok=True)
    (results / "worker.log").write_bytes(log.read_bytes() if log.exists() else b"")
    report = {"ok": code == 0 and error is None, "returncode": code, "error": error, "sourceCommit": EXPECTED_COMMIT}
    if error:
        (results / "worker-error.json").write_text(json.dumps(report, indent=2) + "\n")
    if datetime.datetime.now(datetime.timezone.utc) >= WALL_DEADLINE - datetime.timedelta(seconds=60):
        return {**report, "ok": False, "error": "Insufficient time to export before independent cleanup deadline"}
    manifest = {str(p.relative_to(results)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(results.rglob("*")) if p.is_file() and p.name != "SHA256.json"}
    (results / "SHA256.json").write_text(json.dumps(manifest, indent=2) + "\n")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:xz", preset=6) as tar:
        for p in sorted(results.rglob("*")):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(results)), recursive=False)
    data = archive.getvalue()
    if len(data) > 6_000_000:
        return {**report, "ok": False, "error": "Compressed evidence exceeds the bounded job-output limit", "archiveBytes": len(data)}
    return {**report, "archiveFormat": "tar.xz", "archiveBytes": len(data),
            "archiveSha256": hashlib.sha256(data).hexdigest(), "archiveBase64": base64.b64encode(data).decode("ascii")}


runpod.serverless.start({"handler": handler})
