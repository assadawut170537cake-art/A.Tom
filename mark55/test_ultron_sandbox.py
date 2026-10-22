"""unittest ของ sandbox อัลตรอน

* ชุด fake (ค่าเริ่มต้น) — ใช้ runner ปลอม ไม่ต้องมี Docker
* ชุด docker จริง — รันเมื่อตั้ง `MARK55_TEST_DOCKER=1` (ต้องมี Docker + image python:3.12-slim)

รัน: `python -m unittest mark55.test_ultron_sandbox` (ที่ root ของ repo)
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from .handlers import describe_run, make_ultron_handlers
    from .memory_bus import MemoryTask
    from .ultron_sandbox import MAX_CODE_BYTES, SandboxError, UltronSandbox
except ImportError:
    from handlers import describe_run, make_ultron_handlers
    from memory_bus import MemoryTask
    from ultron_sandbox import MAX_CODE_BYTES, SandboxError, UltronSandbox

SID = "1a2b3c4d"


class FakeDocker:
    """จำคำสั่งที่เรียก · `docker run` เขียนไฟล์ out.txt ลง /work ให้เหมือน container จริง"""

    def __init__(self, returncode: int = 0, stdout: str = "hi\n", timeout: bool = False) -> None:
        self.calls: list[list[str]] = []
        self.returncode, self.stdout, self.timeout = returncode, stdout, timeout

    def __call__(self, cmd, **_kwargs):
        self.calls.append(cmd)
        if cmd[1] == "run":
            if self.timeout:
                raise subprocess.TimeoutExpired(cmd, 1, output=b"partial")
            work = next(cmd[i + 1] for i, a in enumerate(cmd) if a == "-v").rsplit(":/work", 1)[0]
            Path(work, "out.txt").write_text("result", encoding="utf-8")
        return subprocess.CompletedProcess(cmd, self.returncode, self.stdout, "")


class UltronSandboxTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.docker = FakeDocker()
        self.box = UltronSandbox(self.root, runner=self.docker, timeout=30)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_run_isolated_command_and_result(self) -> None:
        result = self.box.run(SID, "print('hi')", task="ทักทาย")
        cmd = self.docker.calls[0]
        for flag in ("--network", "--read-only", "--cap-drop", "--pids-limit", "--memory", "--rm"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--network") + 1], "none")
        self.assertEqual(cmd[-4:], ["timeout", "30", "python", "main.py"])
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["stdout"], "hi\n")
        self.assertEqual(result["files"], ["out.txt"])
        self.assertTrue((self.root / "pending" / SID / "main.py").is_file())
        self.assertEqual(self.box.list_pending()[0]["task"], "ทักทาย")

    def test_rejects_bad_input(self) -> None:
        with self.assertRaises(SandboxError):
            self.box.run("../evil", "print(1)")
        with self.assertRaises(SandboxError):
            self.box.run(SID, "print(1)", language="ruby")
        with self.assertRaises(SandboxError):
            self.box.run(SID, "   ")
        with self.assertRaises(SandboxError):
            self.box.run(SID, "x" * (MAX_CODE_BYTES + 1))
        self.box.run(SID, "print(1)")
        with self.assertRaises(SandboxError):
            self.box.run(SID, "print(2)")  # รหัสซ้ำ

    def test_timeout_kills_container(self) -> None:
        box = UltronSandbox(self.root, runner=FakeDocker(timeout=True))
        result = box.run(SID, "while True: pass")
        self.assertTrue(result["timed_out"])
        self.assertEqual(result["exit_code"], 124)
        self.assertEqual(result["stdout"], "partial")

    def test_release_and_destroy_latest_and_prefix(self) -> None:
        self.box.run("aaaa0001", "print(1)")
        self.box.run("bbbb0002", "print(2)")
        released = self.box.release()  # ล่าสุด = bbbb0002
        self.assertEqual(released["sandbox_id"], "bbbb0002")
        self.assertTrue((self.root / "released" / "bbbb0002" / "out.txt").is_file())
        self.assertEqual(self.box.destroy("aaaa")["sandbox_id"], "aaaa0001")
        self.assertFalse((self.root / "pending" / "aaaa0001").exists())
        self.assertIn(["docker", "rm", "-f", "ultron-aaaa0001"], self.docker.calls)
        with self.assertRaises(SandboxError):
            self.box.destroy()  # ไม่เหลืออะไรรอแล้ว

    def test_resolve_errors(self) -> None:
        self.box.run("abcd0001", "print(1)")
        self.box.run("abcd0002", "print(1)")
        with self.assertRaises(SandboxError):
            self.box.resolve("abcd")  # ตรงสองตัว
        with self.assertRaises(SandboxError):
            self.box.resolve("ffff")
        with self.assertRaises(SandboxError):
            self.box.resolve("../x")

    def test_missing_docker(self) -> None:
        def no_docker(cmd, **_kw):
            raise FileNotFoundError("docker")

        with self.assertRaisesRegex(SandboxError, "Docker"):
            UltronSandbox(self.root, runner=no_docker).run(SID, "print(1)")
        self.assertFalse((self.root / "pending" / SID).exists())


class UltronHandlersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.box = UltronSandbox(self.tmp.name, runner=FakeDocker())
        self.sent: list[tuple[str, str]] = []
        self.handlers = make_ultron_handlers(self.box, lambda device, text: self.sent.append((device, text)))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def task(self, instruction: str, payload: dict, sender: str = "MOBILE:boss-phone") -> MemoryTask:
        return MemoryTask(instruction=instruction, sender=sender, target="MARK_55_PC", payload=payload)

    def test_run_notifies_phone(self) -> None:
        t = self.task("ULTRON_RUN", {"code": "print('hi')", "task": "ทักทาย"})
        result = self.handlers["ULTRON_RUN"](t)
        self.assertEqual(result["status"], "RAN")
        self.assertEqual(result["sandbox_id"], t.task_id.replace("-", "")[:8])
        device, text = self.sent[0]
        self.assertEqual(device, "boss-phone")
        self.assertIn("รันสำเร็จ", text)
        self.assertIn('"ปลด"', text)

    def test_run_error_and_no_notify_for_pc_sender(self) -> None:
        result = self.handlers["ULTRON_RUN"](self.task("ULTRON_RUN", {"code": ""}, sender="MARK_55_PC"))
        self.assertEqual(result["status"], "ULTRON_ERROR")
        self.assertEqual(self.sent, [])

    def test_release_destroy(self) -> None:
        self.handlers["ULTRON_RUN"](self.task("ULTRON_RUN", {"code": "print(1)"}))
        self.handlers["ULTRON_RUN"](self.task("ULTRON_RUN", {"code": "print(2)"}))
        self.assertEqual(self.handlers["ULTRON_RELEASE"](self.task("ULTRON_RELEASE", {}))["status"], "RELEASED")
        self.assertEqual(self.handlers["ULTRON_DESTROY"](self.task("ULTRON_DESTROY", {"sandbox_id": "latest"}))["status"], "DESTROYED")
        self.assertEqual(self.handlers["ULTRON_DESTROY"](self.task("ULTRON_DESTROY", {}))["status"], "ULTRON_ERROR")

    def test_describe_run(self) -> None:
        self.assertIn("เกินเวลา", describe_run({"sandbox_id": SID, "timed_out": True, "exit_code": 124}))
        self.assertIn("exit 1", describe_run({"sandbox_id": SID, "exit_code": 1, "stderr": "Traceback"}))


@unittest.skipUnless(os.getenv("MARK55_TEST_DOCKER") == "1", "ตั้ง MARK55_TEST_DOCKER=1 เพื่อทดสอบกับ Docker จริง")
class RealDockerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.box = UltronSandbox(self.tmp.name, timeout=10)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_runs_and_writes_file(self) -> None:
        r = self.box.run(SID, "open('out.txt','w').write('ok'); print(6*7)")
        self.assertEqual((r["exit_code"], r["stdout"].strip(), r["files"]), (0, "42", ["out.txt"]))

    def test_no_network(self) -> None:
        code = "import socket\ntry:\n socket.create_connection(('1.1.1.1', 53), 3); print('NET')\nexcept OSError: print('BLOCKED')"
        self.assertEqual(self.box.run(SID, code)["stdout"].strip(), "BLOCKED")

    def test_read_only_root(self) -> None:
        code = "try:\n open('/etc/x','w'); print('WROTE')\nexcept OSError: print('RO')"
        self.assertEqual(self.box.run(SID, code)["stdout"].strip(), "RO")

    def test_timeout(self) -> None:
        r = self.box.run(SID, "while True: pass")
        self.assertTrue(r["timed_out"])


if __name__ == "__main__":
    unittest.main()
