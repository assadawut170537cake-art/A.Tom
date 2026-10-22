"""unittest ของ mobile_outbox — ใช้ gateway ปลอม (ไม่ต้องต่อ Supabase)

รัน: `python -m unittest mark55.test_mobile_outbox` (ที่ root ของ repo)
"""

from __future__ import annotations

import unittest

try:
    from .mobile_outbox import DEVICE_TOOL, MAX_TEXT, NOTIFY, SENDER, device_tool, mobile_target, notify_mobile
except ImportError:
    from mobile_outbox import DEVICE_TOOL, MAX_TEXT, NOTIFY, SENDER, device_tool, mobile_target, notify_mobile


class FakeGateway:
    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.pushed = []

    def push_task(self, task) -> bool:
        self.pushed.append(task)
        return self.ok


class MobileOutboxTest(unittest.TestCase):
    def test_target(self) -> None:
        self.assertEqual(mobile_target("boss-phone"), "MOBILE:boss-phone")
        self.assertEqual(mobile_target(None), "MOBILE_ALL")
        self.assertEqual(mobile_target(""), "MOBILE_ALL")

    def test_notify(self) -> None:
        gw = FakeGateway()
        task_id = notify_mobile(gw, "build เสร็จแล้ว")
        task = gw.pushed[0]
        self.assertEqual(task_id, task.task_id)
        self.assertEqual((task.instruction, task.sender, task.target), (NOTIFY, SENDER, "MOBILE:boss-phone"))
        self.assertEqual(task.payload, {"text": "build เสร็จแล้ว", "speak": True})

    def test_notify_truncates_and_silent(self) -> None:
        gw = FakeGateway()
        notify_mobile(gw, "ก" * (MAX_TEXT + 50), device_id=None, speak=False)
        task = gw.pushed[0]
        self.assertEqual(len(task.payload["text"]), MAX_TEXT)
        self.assertFalse(task.payload["speak"])
        self.assertEqual(task.target, "MOBILE_ALL")

    def test_device_tool(self) -> None:
        gw = FakeGateway()
        device_tool(gw, "device.volume", text="30")
        device_tool(gw, "device.launch", text="LINE", args={"timeoutMs": 3000})
        self.assertEqual(gw.pushed[0].instruction, DEVICE_TOOL)
        self.assertEqual(gw.pushed[0].payload, {"tool": "device.volume", "text": "30"})
        self.assertEqual(gw.pushed[1].payload["args"], {"timeoutMs": 3000})

    def test_push_failure_returns_none(self) -> None:
        self.assertIsNone(notify_mobile(FakeGateway(ok=False), "x"))


if __name__ == "__main__":
    unittest.main()
