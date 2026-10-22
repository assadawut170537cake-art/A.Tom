"""Unit test ของ Memory Bus — รันจาก root ของ repo: `python -m unittest mark55.test_memory_bus -v`

* `TestMemoryBus` — ใช้ Supabase client ปลอม (ไม่ต้องมีเน็ต / key) → รันใน CI ได้
* `TestSupabaseLive` — ยิง Supabase จริงที่ตาราง `memory_tasks_test` · ข้ามอัตโนมัติ เว้นแต่ตั้ง
  `MARK55_LIVE_TEST=1` + `SUPABASE_URL` + `SUPABASE_KEY` (หรือมีใน mark55/.env)
"""

from __future__ import annotations

import os
import threading
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from mark55.handlers import HANDLER_REGISTRY, register_all_handlers
from mark55.memory_bus import MemoryTask, MemoryWatcher, TaskStatus, parse_timestamp
from mark55.supabase_gateway import SupabaseGateway

NODE = "MARK_55_PC"


def make_task(instruction: str = "RUN_DIAGNOSTICS", target: str = NODE, **kwargs: Any) -> MemoryTask:
    return MemoryTask(instruction=instruction, sender="A.T.O.M._MOBILE", target=target, **kwargs)


class FakeSupabase:
    """Supabase client ปลอม — รองรับเฉพาะ chain ที่ gateway ใช้ และจำลองกติกาของตารางจริง

    * UPDATE ทำทั้งก้อนใต้ lock เดียว (เหมือน Postgres ล็อกแถว) → ทดสอบการแย่ง claim ได้
    * ประทับ claimed_at / completed_at เหมือน trigger ใน sql/001_init.sql
    * `fail_next` = จำนวนครั้งถัดไปที่ execute() จะ raise (จำลองเน็ตหลุด)
    """

    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.lock = threading.Lock()
        self.fail_next = 0
        self.executed = 0

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, self.tables.setdefault(name, []))


class _FakeQuery:
    def __init__(self, db: FakeSupabase, rows: list[dict[str, Any]]) -> None:
        self._db = db
        self._rows = rows
        self._op = "select"
        self._data: dict[str, Any] = {}
        self._filters: list[tuple[str, Any]] = []
        self._order: str | None = None
        self._limit: int | None = None

    def select(self, *_columns: str) -> _FakeQuery:
        self._op = "select"
        return self

    def insert(self, row: dict[str, Any]) -> _FakeQuery:
        self._op, self._data = "insert", dict(row)
        return self

    def update(self, data: dict[str, Any]) -> _FakeQuery:
        self._op, self._data = "update", dict(data)
        return self

    def delete(self) -> _FakeQuery:
        self._op = "delete"
        return self

    def eq(self, column: str, value: Any) -> _FakeQuery:
        self._filters.append((column, lambda v, want=value: v == want))
        return self

    def in_(self, column: str, values: list[Any]) -> _FakeQuery:
        self._filters.append((column, lambda v, want=tuple(values): v in want))
        return self

    def order(self, column: str) -> _FakeQuery:
        self._order = column
        return self

    def limit(self, n: int) -> _FakeQuery:
        self._limit = n
        return self

    def _match(self, row: dict[str, Any]) -> bool:
        return all(test(row.get(column)) for column, test in self._filters)

    def execute(self) -> SimpleNamespace:
        with self._db.lock:
            self._db.executed += 1
            if self._db.fail_next > 0:
                self._db.fail_next -= 1
                raise ConnectionError("Supabase ไม่ตอบ (จำลอง)")
            return SimpleNamespace(data=getattr(self, f"_{self._op}")())

    def _select(self) -> list[dict[str, Any]]:
        found = [dict(r) for r in self._rows if self._match(r)]
        if self._order:
            found.sort(key=lambda r: r[self._order])
        return found[: self._limit] if self._limit is not None else found

    def _insert(self) -> list[dict[str, Any]]:
        if any(r["task_id"] == self._data["task_id"] for r in self._rows):
            raise ValueError("duplicate key value violates unique constraint (จำลอง)")
        row = {"created_at": datetime.now(timezone.utc).isoformat(), "claimed_by": None,
               "claimed_at": None, "completed_at": None, **self._data}
        self._rows.append(row)
        return [dict(row)]

    def _update(self) -> list[dict[str, Any]]:
        changed = []
        now = datetime.now(timezone.utc).isoformat()
        for row in self._rows:
            if self._match(row):
                old = row["status"]
                row.update(self._data)
                if old == "PENDING" and row["status"] == "IN_PROGRESS":
                    row["claimed_at"] = now
                if old == "IN_PROGRESS" and row["status"] in ("COMPLETED", "FAILED"):
                    row["completed_at"] = now
                changed.append(dict(row))
        return changed

    def _delete(self) -> list[dict[str, Any]]:
        gone = [r for r in self._rows if self._match(r)]
        self._rows[:] = [r for r in self._rows if not self._match(r)]
        return gone


class TestMemoryBus(unittest.TestCase):
    def setUp(self) -> None:
        self.db = FakeSupabase()
        self.gateway = SupabaseGateway("https://fake.supabase.co", "fake-key", client=self.db)
        self.watcher = MemoryWatcher(self.gateway, NODE, poll_interval=0.01)

    def stored(self, task: MemoryTask) -> MemoryTask:
        found = self.gateway.get_task(task.task_id)
        assert found is not None
        return found

    def test_task_lifecycle_success(self) -> None:
        """push → fetch → claim → complete ได้ COMPLETED พร้อมผลลัพธ์และเวลาที่ server ประทับ"""
        task = make_task(payload={"module": "power_grid"})
        self.assertTrue(self.gateway.push_task(task))

        pending = self.gateway.fetch_pending_tasks(NODE)
        self.assertEqual([t.task_id for t in pending], [task.task_id])

        self.assertTrue(self.gateway.try_claim_task(task.task_id, NODE))
        self.assertEqual(self.gateway.fetch_pending_tasks(NODE), [])
        self.assertTrue(self.gateway.complete_task(task.task_id, {"status": "HEALTHY"}))

        stored = self.stored(task)
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.claimed_by, NODE)
        self.assertEqual(stored.result, {"status": "HEALTHY"})
        self.assertIsNotNone(stored.claimed_at)
        self.assertIsNotNone(stored.completed_at)
        # จบแล้วจบเลย — ตั้งสถานะซ้ำไม่ได้
        with self.assertLogs("mark55.supabase_gateway", "WARNING"):
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
        self.assertEqual(self.stored(contested).claimed_by, winners[0])

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
        stored = self.stored(task)
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.result, {"status": "SUCCESS"})

    def test_no_handler_fails_task(self) -> None:
        """instruction ที่ไม่มี handler → task เป็น FAILED พร้อมเหตุผล"""
        task = make_task("UNKNOWN_INSTRUCTION")
        self.gateway.push_task(task)
        with self.assertLogs("mark55.memory_bus", "WARNING"):
            self.watcher._poll_and_process()
        stored = self.stored(task)
        self.assertEqual(stored.status, TaskStatus.FAILED)
        self.assertIn("UNKNOWN_INSTRUCTION", stored.result["error"])

    def test_serialization_roundtrip(self) -> None:
        """to_dict → from_dict ได้ค่าเท่าเดิม · task_id เป็น UUID · เวลาแบบ Postgres อ่านได้ · ค่าเสีย → ValueError"""
        task = make_task(payload={"script_path": "/workspace/build.sh", "flags": ["--clean"]})
        data = task.to_dict()
        self.assertEqual(str(uuid.UUID(data["task_id"])), data["task_id"])
        self.assertEqual(data["container_tag"], "atom_core")
        self.assertEqual(data["status"], "PENDING")
        self.assertEqual(MemoryTask.from_dict(data).to_dict(), data)

        # Postgres ตัดเลข 0 ท้ายเศษวินาที — Python 3.10 fromisoformat อ่านตรง ๆ ไม่ได้
        self.assertEqual(
            parse_timestamp("2026-10-17T22:55:45.34238+00:00"),
            datetime(2026, 10, 17, 22, 55, 45, 342380, tzinfo=timezone.utc),
        )
        self.assertEqual(parse_timestamp("2026-10-17T22:55:45Z"), datetime(2026, 10, 17, 22, 55, 45, tzinfo=timezone.utc))
        with self.assertRaises(ValueError):
            MemoryTask.from_dict({**data, "status": "DONE"})
        with self.assertRaises(ValueError):
            MemoryTask.from_dict({**data, "task_id": "task_not-a-uuid"})

    def test_fetch_filters_by_target(self) -> None:
        """fetch คืนเฉพาะ task ของ node นี้และ target ALL ใน container เดียวกัน เรียงเก่า → ใหม่"""
        mine = make_task()
        broadcast = make_task(target="ALL")
        other = make_task(target="J.A.R.V.I.S.")
        for t in (mine, broadcast, other):
            self.gateway.push_task(t)
        foreign = SupabaseGateway("https://fake.supabase.co", "fake-key", container_tag="other", client=self.db)
        foreign.push_task(make_task())

        self.assertEqual([t.task_id for t in self.gateway.fetch_pending_tasks(NODE)], [mine.task_id, broadcast.task_id])

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

        failed, done = self.stored(broken), self.stored(healthy)
        self.assertEqual(failed.status, TaskStatus.FAILED)
        self.assertEqual(failed.result, {"exception": "RuntimeError: disk full"})
        self.assertEqual(done.status, TaskStatus.COMPLETED)
        self.assertEqual(done.result["status"], "HEALTHY")
        self.assertEqual(done.result["task_id"], healthy.task_id)
        self.assertIn("summary", done.result)
        self.assertIn("telemetry", done.result)
        self.assertEqual(sorted(HANDLER_REGISTRY), ["EXECUTE_BUILD", "RUN_DIAGNOSTICS"])

    def test_gateway_exception_continues_polling(self) -> None:
        """Supabase ล่ม 2 รอบแรก → gateway log แล้วคืน [] · loop ไม่ตาย รอบถัดไปรับงานได้ และ stop() หยุดได้"""
        done = threading.Event()

        def handler(task: MemoryTask) -> dict[str, Any]:
            done.set()
            return {"status": "OK"}

        self.watcher.register_handler("EXECUTE_BUILD", handler)
        self.gateway.push_task(make_task("EXECUTE_BUILD"))
        self.db.fail_next = 2

        thread = threading.Thread(target=self.watcher.start)
        with self.assertLogs("mark55.supabase_gateway", "ERROR") as logs:
            thread.start()
            self.assertTrue(done.wait(2), "watcher ไม่ได้รับงานหลัง Supabase กลับมา")
            self.watcher.stop()
            thread.join(2)

        self.assertFalse(thread.is_alive())
        self.assertFalse(self.watcher.is_running)
        self.assertEqual(sum("ดึง task ที่รออยู่ไม่สำเร็จ" in line for line in logs.output), 2)

    def test_push_failure_returns_false(self) -> None:
        """insert ล้ม (เน็ตหลุด / task_id ซ้ำ) → push คืน False ไม่ raise"""
        task = make_task()
        self.assertTrue(self.gateway.push_task(task))
        with self.assertLogs("mark55.supabase_gateway", "ERROR"):
            self.assertFalse(self.gateway.push_task(task))
        self.db.fail_next = 1
        with self.assertLogs("mark55.supabase_gateway", "ERROR"):
            self.assertFalse(self.gateway.push_task(make_task()))


def _live_settings() -> tuple[str, str] | None:
    if os.getenv("MARK55_LIVE_TEST") != "1":
        return None
    from mark55 import config

    return (config.SUPABASE_URL, config.SUPABASE_KEY) if config.SUPABASE_URL and config.SUPABASE_KEY else None


@unittest.skipUnless(_live_settings(), "ข้าม: ตั้ง MARK55_LIVE_TEST=1 + SUPABASE_URL/SUPABASE_KEY เพื่อทดสอบกับ Supabase จริง")
class TestSupabaseLive(unittest.TestCase):
    """ทดสอบกับ Supabase จริง (ตาราง memory_tasks_test) · ใช้ container_tag สุ่มต่อรอบ แล้วลบทิ้งตอนจบ"""

    def setUp(self) -> None:
        settings = _live_settings()
        assert settings is not None
        self.tag = f"live_test_{uuid.uuid4().hex[:8]}"
        self.gateway = SupabaseGateway(*settings, container_tag=self.tag, table="memory_tasks_test")

    def tearDown(self) -> None:
        self.gateway._table().delete().eq("container_tag", self.tag).execute()

    def test_live_lifecycle_and_race(self) -> None:
        """push → watcher รับงาน → COMPLETED · claim ซ้ำแพ้ · เวลาประทับจาก trigger"""
        self.gateway.check_connection()
        raced = make_task()
        self.assertTrue(self.gateway.push_task(raced))
        self.assertTrue(self.gateway.try_claim_task(raced.task_id, NODE))
        self.assertFalse(self.gateway.try_claim_task(raced.task_id, "SECONDARY_NODE"))
        self.assertTrue(self.gateway.complete_task(raced.task_id, {"ok": True}))

        watcher = MemoryWatcher(self.gateway, NODE, poll_interval=0.05)
        register_all_handlers(watcher)
        task = make_task("RUN_DIAGNOSTICS", target="ALL")
        self.assertTrue(self.gateway.push_task(task))
        watcher._poll_and_process()

        stored = self.gateway.get_task(task.task_id)
        assert stored is not None
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.result["status"], "HEALTHY")
        self.assertIsNotNone(stored.claimed_at)
        self.assertIsNotNone(stored.completed_at)


if __name__ == "__main__":
    unittest.main()
