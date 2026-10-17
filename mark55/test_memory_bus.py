"""Unit test ของ Memory Bus — รันจาก root ของ repo: `python -m unittest mark55.test_memory_bus -v`"""

from __future__ import annotations

import threading
import unittest
from typing import Any

from mark55.handlers import HANDLER_REGISTRY, register_all_handlers
from mark55.memory_bus import MemoryTask, MemoryWatcher, TaskStatus
from mark55.supermemory_gateway import SupermemoryGateway

NODE = "MARK_55_PC"


def make_task(instruction: str = "RUN_DIAGNOSTICS", target: str = NODE, **kwargs: Any) -> MemoryTask:
    return MemoryTask(instruction=instruction, sender="A.T.O.M._MOBILE", target=target, **kwargs)


class FlakyGateway(SupermemoryGateway):
    """gateway ที่ fetch ล้มตามจำนวนครั้งที่กำหนด แล้วกลับมาทำงานปกติ"""

    def __init__(self, failures: int) -> None:
        super().__init__()
        self.failures_left = failures
        self.fetch_calls = 0

    def fetch_pending_tasks(self, target_node_id: str) -> list[MemoryTask]:
        self.fetch_calls += 1
        if self.failures_left > 0:
            self.failures_left -= 1
            raise ConnectionError("blackboard ล่มชั่วคราว")
        return super().fetch_pending_tasks(target_node_id)


class TestMemoryBus(unittest.TestCase):
    def setUp(self) -> None:
        self.gateway = SupermemoryGateway()
        self.watcher = MemoryWatcher(self.gateway, NODE, poll_interval=0.01)

    def test_task_lifecycle_success(self) -> None:
        """push → fetch → claim → complete ได้สถานะ COMPLETED พร้อมผลลัพธ์"""
        task = make_task(payload={"module": "power_grid"})
        self.assertTrue(self.gateway.push_task(task))

        pending = self.gateway.fetch_pending_tasks(NODE)
        self.assertEqual([t.task_id for t in pending], [task.task_id])

        self.assertTrue(self.gateway.try_claim_task(task.task_id, NODE))
        self.assertEqual(self.gateway.fetch_pending_tasks(NODE), [])
        self.assertTrue(self.gateway.complete_task(task.task_id, {"status": "HEALTHY"}))

        stored = self.gateway.get_task(task.task_id)
        assert stored is not None
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.claimed_by, NODE)
        self.assertEqual(stored.result, {"status": "HEALTHY"})
        # จบแล้วจบเลย — ตั้งสถานะซ้ำไม่ได้
        with self.assertLogs("mark55.supermemory_gateway", "WARNING"):
            self.assertFalse(self.gateway.fail_task(task.task_id, {"error": "late"}))

    def test_race_condition_prevention(self) -> None:
        """หลาย watcher แย่ง claim task เดียวกันพร้อมกัน → ชนะได้ตัวเดียว ที่เหลือได้ False"""
        task = make_task()
        self.gateway.push_task(task)
        self.assertTrue(self.gateway.try_claim_task(task.task_id, NODE))
        self.assertFalse(self.gateway.try_claim_task(task.task_id, "SECONDARY_NODE"))

        contested = make_task()
        self.gateway.push_task(contested)
        winners: list[str] = []
        barrier = threading.Barrier(16)

        def contend(node: str) -> None:
            barrier.wait()
            if self.gateway.try_claim_task(contested.task_id, node):
                winners.append(node)

        threads = [threading.Thread(target=contend, args=(f"NODE_{i}",)) for i in range(16)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(winners), 1)
        stored = self.gateway.get_task(contested.task_id)
        assert stored is not None
        self.assertEqual(stored.claimed_by, winners[0])

    def test_watcher_dispatch(self) -> None:
        """watcher ส่ง task ให้ handler ที่ลงทะเบียน แล้วบันทึก COMPLETED · poll รอบถัดไปไม่รันซ้ำ"""
        executed: list[str] = []

        def handler(task: MemoryTask) -> dict[str, Any]:
            executed.append(task.task_id)
            return {"status": "SUCCESS"}

        self.watcher.register_handler("EXECUTE_BUILD", handler)
        task = make_task("EXECUTE_BUILD")
        self.gateway.push_task(task)

        self.watcher._poll_and_process()
        self.watcher._poll_and_process()

        self.assertEqual(executed, [task.task_id])
        stored = self.gateway.get_task(task.task_id)
        assert stored is not None
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.result, {"status": "SUCCESS"})

    def test_no_handler_fails_task(self) -> None:
        """instruction ที่ไม่มี handler → task เป็น FAILED พร้อมเหตุผล"""
        task = make_task("UNKNOWN_INSTRUCTION")
        self.gateway.push_task(task)
        with self.assertLogs("mark55.memory_bus", "WARNING"):
            self.watcher._poll_and_process()
        stored = self.gateway.get_task(task.task_id)
        assert stored is not None
        self.assertEqual(stored.status, TaskStatus.FAILED)
        self.assertIn("UNKNOWN_INSTRUCTION", stored.result["error"])

    def test_serialization_roundtrip(self) -> None:
        """to_dict → from_dict ได้ค่าเท่าเดิมทุก field · status ที่ไม่รู้จัก → ValueError"""
        task = make_task(payload={"script_path": "/workspace/build.sh", "flags": ["--clean"]})
        data = task.to_dict()
        self.assertEqual(data["containerTag"], "atom_core")
        self.assertEqual(data["status"], "PENDING")
        self.assertTrue(task.task_id.startswith("task_"))
        self.assertEqual(MemoryTask.from_dict(data).to_dict(), data)
        with self.assertRaises(ValueError):
            MemoryTask.from_dict({**data, "status": "DONE"})

    def test_fetch_filters_by_target(self) -> None:
        """fetch คืนเฉพาะ task ของ node นี้และ target ALL — ไม่รวมของ node อื่นหรือ container อื่น"""
        mine = make_task()
        broadcast = make_task(target="ALL")
        other = make_task(target="J.A.R.V.I.S.")
        for t in (mine, broadcast, other):
            self.gateway.push_task(t)
        ids = {t.task_id for t in self.gateway.fetch_pending_tasks(NODE)}
        self.assertEqual(ids, {mine.task_id, broadcast.task_id})

        # task ที่ถูกบังคับ tag เป็นของ gateway ไม่ใช่ tag ที่ผู้ส่งตั้งมา
        tagged = make_task(container_tag="other")
        self.gateway.push_task(tagged)
        self.assertIn(tagged.task_id, {t.task_id for t in self.gateway.fetch_pending_tasks(NODE)})

    def test_handler_exception_fails_task(self) -> None:
        """handler raise → task เป็น FAILED และ watcher ยังรับงานถัดไปได้"""

        def boom(task: MemoryTask) -> dict[str, Any]:
            raise RuntimeError("disk full")

        register_all_handlers(self.watcher)
        with self.assertLogs("mark55.memory_bus", "WARNING"):
            self.watcher.register_handler("EXECUTE_BUILD", boom)  # ทับตัวจาก registry ให้ล้ม
        broken = make_task("EXECUTE_BUILD")
        healthy = make_task("RUN_DIAGNOSTICS")
        self.gateway.push_task(broken)
        self.gateway.push_task(healthy)

        with self.assertLogs("mark55.memory_bus", "ERROR"):
            self.watcher._poll_and_process()

        failed = self.gateway.get_task(broken.task_id)
        done = self.gateway.get_task(healthy.task_id)
        assert failed is not None and done is not None
        self.assertEqual(failed.status, TaskStatus.FAILED)
        self.assertEqual(failed.result, {"exception": "RuntimeError: disk full"})
        self.assertEqual(done.status, TaskStatus.COMPLETED)
        self.assertEqual(done.result, {"status": "HEALTHY", "task_id": healthy.task_id})
        self.assertEqual(sorted(HANDLER_REGISTRY), ["EXECUTE_BUILD", "RUN_DIAGNOSTICS"])

    def test_gateway_exception_continues_polling(self) -> None:
        """gateway raise 2 รอบแรก → loop ไม่ตาย รอบถัดไปรับงานได้ และ stop() หยุด loop ได้"""
        gateway = FlakyGateway(failures=2)
        watcher = MemoryWatcher(gateway, NODE, poll_interval=0.01)
        done = threading.Event()

        def handler(task: MemoryTask) -> dict[str, Any]:
            done.set()
            return {"status": "OK"}

        watcher.register_handler("EXECUTE_BUILD", handler)
        gateway.push_task(make_task("EXECUTE_BUILD"))

        thread = threading.Thread(target=watcher.start)
        with self.assertLogs("mark55.memory_bus", "ERROR") as logs:
            thread.start()
            self.assertTrue(done.wait(2), "watcher ไม่ได้รับงานหลัง gateway กลับมา")
            watcher.stop()
            thread.join(2)

        self.assertFalse(thread.is_alive())
        self.assertFalse(watcher.is_running)
        self.assertGreaterEqual(gateway.fetch_calls, 3)
        self.assertEqual(sum("poll รอบนี้ล้มเหลว" in line for line in logs.output), 2)


if __name__ == "__main__":
    unittest.main()
