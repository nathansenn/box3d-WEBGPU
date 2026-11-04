"""Single-purpose bounded benchmark handler, never a general command executor."""
import base64
import datetime
import hashlib
import io
import json
import os
import pathlib
import subprocess
import tarfile
import uuid
import runpod

EXPECTED_COMMIT = os.environ["BOX3D_R4_COMMIT"]
BOOTSTRAP = base64.b64decode(os.environ["BOX3D_R4_BOOTSTRAP_B64"], validate=True)


def handler(job):
    if job.get("input", {}) != {"task": "box3d-round4-100", "commit": EXPECTED_COMMIT}:
        return {"ok": False, "error": "Only the pinned Box3D benchmark is accepted"}
    root = pathlib.Path("/workspace") / ("box3d-r4-sl-" + uuid.uuid4().hex)
    log = pathlib.Path("/tmp") / (root.name + ".log")
    script = pathlib.Path("/tmp") / (root.name + ".sh")
    script.write_bytes(BOOTSTRAP)
    env = os.environ.copy()
    env.update({
        "BOX3D_R4_ROOT": str(root), "BOX3D_R4_MODE": "serverless",
        "BOX3D_R4_DEADLINE": (datetime.datetime.now(datetime.timezone.utc) +
                              datetime.timedelta(minutes=30)).isoformat(),
    })
    code, error = None, None
    try:
        with log.open("wb") as output:
            code = subprocess.run(["bash", str(script)], env=env, stdout=output,
                                  stderr=subprocess.STDOUT, timeout=1950,
                                  check=False).returncode
    except Exception as exc:
        error = str(exc)
    results = root / "results"
    results.mkdir(parents=True, exist_ok=True)
    (results / "worker.log").write_bytes(log.read_bytes() if log.exists() else b"")
    report = {"ok": code == 0, "returncode": code, "error": error, "sourceCommit": EXPECTED_COMMIT}
    files = sorted(p for p in results.rglob("*") if p.is_file())
    manifest = {str(p.relative_to(results)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in files if p.name != "SHA256.json"}
    (results / "SHA256.json").write_text(json.dumps(manifest, indent=2) + "\n")
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for p in sorted(results.rglob("*")):
            if p.is_file():
                tar.add(p, arcname=str(p.relative_to(results)), recursive=False)
    data = archive.getvalue()
    if len(data) > 6_000_000:
        return {**report, "ok": False, "error": "Archive exceeds bounded job-output limit", "archiveBytes": len(data)}
    return {**report, "archiveBytes": len(data), "archiveSha256": hashlib.sha256(data).hexdigest(),
            "archiveBase64": base64.b64encode(data).decode("ascii")}


runpod.serverless.start({"handler": handler})
