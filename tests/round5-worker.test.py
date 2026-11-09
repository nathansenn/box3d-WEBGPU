"""Exercise local export and deadline behavior without a Runpod connection or GPU."""
import base64
import datetime
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import signal
import sys
import tarfile
import tempfile
import time
import types
import unittest
import uuid
from unittest.mock import patch

# Importing the worker would otherwise write benchmarks/round5/__pycache__/, an untracked
# file that fails the source-manifest check, unless the caller remembered PYTHONPYCACHEPREFIX.
sys.dont_write_bytecode = True

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "benchmarks/round5/runpod-serverless.py"
PIN = "0123456789abcdef0123456789abcdef01234567"


class WorkerExportTests(unittest.TestCase):
    def load(self, bootstrap, seconds=600):
        captured = {}
        stub = types.SimpleNamespace(serverless=types.SimpleNamespace(start=lambda value: captured.update(value)))
        env = {"BOX3D_R5_COMMIT": PIN, "BOX3D_R5_BOOTSTRAP_B64": base64.b64encode(bootstrap.encode()).decode(),
               "BOX3D_R5_WALL_DEADLINE": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=seconds)).isoformat()}
        spec = importlib.util.spec_from_file_location("round5_worker_test_target", SOURCE)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, env), patch.dict(sys.modules, {"runpod": stub}):
            spec.loader.exec_module(module)
        self.assertIs(captured["handler"], module.handler)
        module.WORKSPACE_ROOT = pathlib.Path(tempfile.gettempdir())
        return module

    def test_rejects_unpinned_input_and_expired_deadline(self):
        module = self.load("exit 99\n", seconds=30)
        self.assertIn("pinned", module.handler({"input": {"task": "other", "commit": PIN}})["error"])
        self.assertIn("Insufficient time", module.handler({"input": {"task": "box3d-round5-100", "commit": PIN}})["error"])

    def exercise(self, exit_code):
        bootstrap = '''set -eu
mkdir -p "$BOX3D_R5_ROOT/results"
printf '{"value":42}\n' > "$BOX3D_R5_ROOT/results/sample.json"
printf 'BOX3D_R5 {"event":"local-export-test"}\n'
exit ''' + str(exit_code) + "\n"
        module = self.load(bootstrap)
        token = uuid.uuid4().hex
        run_root = module.WORKSPACE_ROOT / ("box3d-r5-sl-" + token)
        self.assertFalse(run_root.exists())
        try:
            with patch.object(module.uuid, "uuid4", return_value=types.SimpleNamespace(hex=token)):
                result = module.handler({"input": {"task": "box3d-round5-100", "commit": PIN}})
            self.assertEqual(result["ok"], exit_code == 0)
            self.assertEqual(result["returncode"], exit_code)
            self.assertEqual(result["archiveFormat"], "tar.xz")
            data = base64.b64decode(result["archiveBase64"], validate=True)
            self.assertEqual(len(data), result["archiveBytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), result["archiveSha256"])
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                files = {entry.name: archive.extractfile(entry).read() for entry in archive.getmembers() if entry.isfile()}
            self.assertEqual(json.loads(files["sample.json"]), {"value": 42})
            self.assertIn(b"local-export-test", files["worker.log"])
            manifest = json.loads(files["SHA256.json"])
            self.assertEqual(set(manifest), set(files) - {"SHA256.json"})
            for name, digest in manifest.items():
                self.assertEqual(hashlib.sha256(files[name]).hexdigest(), digest)
        finally:
            shutil.rmtree(run_root, ignore_errors=True)
            for suffix in [".sh", ".log"]:
                (pathlib.Path("/tmp") / (run_root.name + suffix)).unlink(missing_ok=True)

    def test_success_exports_verifiable_results(self):
        self.exercise(0)

    def test_failure_preserves_partial_results(self):
        self.exercise(7)

    def test_cleans_child_after_bootstrap_leader_exits(self):
        bootstrap = '''set -eu
mkdir -p "$BOX3D_R5_ROOT/results"
timeout --foreground --kill-after=1s 30 python3 - <<'CHILD' &
import os, pathlib, signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
pathlib.Path(os.environ['BOX3D_R5_ROOT'], 'child.pid').write_text(str(os.getpid()))
time.sleep(30)
CHILD
for attempt in {1..200}; do
    if test -f "$BOX3D_R5_ROOT/child.pid"; then exit 0; fi
    sleep .01
done
exit 9
'''
        module = self.load(bootstrap)
        token = uuid.uuid4().hex
        run_root = module.WORKSPACE_ROOT / ("box3d-r5-sl-" + token)
        child_pid = None
        try:
            with patch.object(module.uuid, "uuid4", return_value=types.SimpleNamespace(hex=token)):
                result = module.handler({"input": {"task": "box3d-round5-100", "commit": PIN}})
            self.assertTrue(result["ok"], result.get("error"))
            child_pid = int((run_root / "child.pid").read_text())
            state = pathlib.Path("/proc") / str(child_pid) / "stat"
            for _ in range(100):
                if not state.exists() or state.read_text().rsplit(")", 1)[1].split()[0] == "Z":
                    break
                time.sleep(.01)
            else:
                self.fail("Child survived cleanup after its bootstrap leader exited")
        finally:
            if child_pid is None and (run_root / "child.pid").exists():
                child_pid = int((run_root / "child.pid").read_text())
            if child_pid is not None:
                try:
                    os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            shutil.rmtree(run_root, ignore_errors=True)
            for suffix in [".sh", ".log"]:
                (pathlib.Path("/tmp") / (run_root.name + suffix)).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
