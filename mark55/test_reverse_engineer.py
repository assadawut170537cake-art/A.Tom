"""ทดสอบ reverse_engineer.py — ฉีด runner ปลอม ไม่ต้องมี rea/adb/มือถือจริง

รัน: `python -m unittest mark55.test_reverse_engineer`
"""

from __future__ import annotations

import json
import subprocess
import unittest
from collections.abc import Sequence
from typing import Any

try:
    from .reverse_engineer import (
        ReverseEngineerError,
        analyze_target,
        find_doors,
        make_rea_handler,
    )
except ImportError:
    from reverse_engineer import (  # type: ignore[no-redef]
        ReverseEngineerError,
        analyze_target,
        find_doors,
        make_rea_handler,
    )

MANIFEST = """<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
  <application>
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
    <activity android:name=".ChatActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.VIEW"/>
        <category android:name="android.intent.category.BROWSABLE"/>
        <data android:scheme="exampleapp" android:host="chat" android:pathPrefix="/room"/>
      </intent-filter>
    </activity>
    <activity android:name=".SecretActivity" android:exported="false"/>
    <service android:name=".SyncService" android:exported="true"/>
  </application>
</manifest>"""


def fake_runner(stdout: str, returncode: int = 0):
    def run(args: Sequence[str], timeout_s: int) -> "subprocess.CompletedProcess[str]":
        return subprocess.CompletedProcess(list(args), returncode, stdout=stdout, stderr="")

    return run


class _Task:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.task_id = "1a2b3c4d-0000-4000-8000-000000000000"
        self.payload = payload


class FindDoorsTest(unittest.TestCase):
    def test_exported_components_only(self) -> None:
        doors = find_doors(MANIFEST)
        names = {d["name"] for d in doors}
        self.assertIn(".MainActivity", names)
        self.assertIn(".ChatActivity", names)
        self.assertIn(".SyncService", names)
        self.assertNotIn(".SecretActivity", names)  # exported=false ต้องไม่ติด

    def test_deep_link_hint(self) -> None:
        chat = next(d for d in find_doors(MANIFEST) if d["name"] == ".ChatActivity")
        self.assertEqual(chat["open"], "exampleapp://chat/room")

    def test_am_start_hint_when_no_browsable_link(self) -> None:
        main = next(d for d in find_doors(MANIFEST) if d["name"] == ".MainActivity")
        self.assertEqual(main["open"], "am start -n com.example.app/.MainActivity")


class AnalyzeTargetTest(unittest.TestCase):
    def test_apk_path_is_used_directly(self) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".apk") as apk:
            payload = {
                "evidence_id": "ev_1",
                "normalized_result": {"package_name": "com.example.app", "manifest": {"text": MANIFEST}},
            }
            out = analyze_target(
                apk.name, runner=fake_runner(json.dumps(payload)), adb_enabled=False
            )
        self.assertEqual(out["package"], "com.example.app")
        self.assertEqual(out["evidence_id"], "ev_1")
        self.assertTrue(any(d["name"] == ".ChatActivity" for d in out["doors"]))

    def test_missing_path_without_adb_errors(self) -> None:
        with self.assertRaises(ReverseEngineerError):
            analyze_target("/nope/x.apk", runner=fake_runner("{}"), adb_enabled=False)

    def test_rea_error_surfaces(self) -> None:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".apk") as apk, self.assertRaises(ReverseEngineerError):
            analyze_target(apk.name, runner=fake_runner("boom", returncode=1), adb_enabled=False)


class HandlerTest(unittest.TestCase):
    def test_handler_never_raises_and_reports_status(self) -> None:
        handler = make_rea_handler(runner=fake_runner("not json"), adb_enabled=False)
        result = handler(_Task({"target": "/x.apk"}))
        self.assertEqual(result["status"], "RE_ERROR")

    def test_handler_missing_target(self) -> None:
        handler = make_rea_handler(runner=fake_runner("{}"))
        self.assertEqual(handler(_Task({}))["status"], "RE_ERROR")


if __name__ == "__main__":
    unittest.main()
