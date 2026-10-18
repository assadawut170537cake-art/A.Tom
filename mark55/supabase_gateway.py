"""Gateway ระหว่าง watcher กับ blackboard บน Supabase (ตาราง `memory_tasks` — ดู sql/001_init.sql)

ทุก transition เป็น UPDATE คำสั่งเดียวที่มีเงื่อนไขสถานะเดิม (compare-and-set) → Postgres ล็อกแถวให้
หลาย node แย่ง claim task เดียวกัน: ได้แถวกลับมา = ชนะ · 0 แถว = node อื่นได้ไปแล้ว

error จาก Supabase / เครือข่าย → log แล้วคืน False หรือ [] — watcher จะลองใหม่รอบถัดไป ไม่ crash
"""

from __future__ import annotations

import logging
from typing import Any

try:
    from .memory_bus import BROADCAST_TARGET, MemoryTask, TaskStatus
except ImportError:  # รันแบบ `python main.py` ในโฟลเดอร์ mark55 (ไม่มี package แม่)
    from memory_bus import BROADCAST_TARGET, MemoryTask, TaskStatus

logger = logging.getLogger("mark55.supabase_gateway")

DEFAULT_TABLE = "memory_tasks"

# คอลัมน์ที่ server เป็นคนตั้ง (DEFAULT / trigger) — ไม่ส่งตอน insert
_SERVER_COLUMNS = ("created_at", "claimed_at", "claimed_by", "completed_at")


class SupabaseGateway:
    """blackboard บน Supabase · Mark 55 ใช้ service_role key (ข้าม RLS) — ห้ามใช้ key นี้ในแอปมือถือ"""

    def __init__(
        self,
        url: str,
        key: str,
        container_tag: str = "atom_core",
        table: str = DEFAULT_TABLE,
        client: Any | None = None,
    ) -> None:
        """`client` ใส่ตัวปลอมได้ใน test · ไม่ใส่ = สร้างด้วย `supabase.create_client(url, key)`

        `table` ให้ test กับ Supabase จริงชี้ไป `memory_tasks_test` ได้โดยไม่ปนกับงานจริง
        """
        if client is None:
            from supabase import create_client  # import ตอนใช้ — test ที่ใช้ตัวปลอมไม่ต้องติดตั้ง supabase

            client = create_client(url, key)
        self._client = client
        self.url = url
        self.container_tag = container_tag
        self.table = table

    def _table(self) -> Any:
        return self._client.table(self.table)

    def check_connection(self) -> None:
        """ลองอ่านตาราง 1 แถว · ต่อไม่ได้ / key ผิด / ยังไม่ได้สร้างตาราง → raise ให้ main.py ออกด้วย exit 1"""
        self._table().select("task_id").limit(1).execute()

    def push_task(self, task: MemoryTask) -> bool:
        """เพิ่ม task ใหม่ (PENDING) · task_id ซ้ำหรือ insert ไม่สำเร็จ → False"""
        task.container_tag = self.container_tag
        row = {k: v for k, v in task.to_dict().items() if k not in _SERVER_COLUMNS}
        row["status"] = TaskStatus.PENDING.value
        try:
            response = self._table().insert(row).execute()
        except Exception as ex:
            logger.error("push task %s ไม่สำเร็จ: %s", task.task_id, _describe(ex))
            return False
        if not response.data:
            logger.error("push task %s ไม่สำเร็จ: Supabase ไม่คืนแถวที่เพิ่ม", task.task_id)
            return False
        logger.info("เพิ่ม task %s [%s] จาก %s → %s", task.task_id, task.instruction, task.sender, task.target)
        return True

    def get_task(self, task_id: str) -> MemoryTask | None:
        """อ่าน task ตาม id · ไม่พบหรืออ่านไม่ได้ → None"""
        try:
            response = self._table().select("*").eq("task_id", task_id).limit(1).execute()
        except Exception as ex:
            logger.error("อ่าน task %s ไม่สำเร็จ: %s", task_id, _describe(ex))
            return None
        return MemoryTask.from_dict(response.data[0]) if response.data else None

    def fetch_pending_tasks(self, target_node_id: str) -> list[MemoryTask]:
        """task ที่ยัง PENDING ของ node นี้หรือ target `ALL` ใน container เดียวกัน เรียงเก่า → ใหม่"""
        try:
            response = (
                self._table()
                .select("*")
                .eq("status", TaskStatus.PENDING.value)
                .eq("container_tag", self.container_tag)
                .in_("target", [target_node_id, BROADCAST_TARGET])
                .order("created_at")
                .execute()
            )
        except Exception as ex:
            logger.error("ดึง task ที่รออยู่ไม่สำเร็จ: %s", _describe(ex))
            return []
        tasks: list[MemoryTask] = []
        for row in response.data or []:
            try:
                tasks.append(MemoryTask.from_dict(row))
            except (ValueError, TypeError) as ex:
                # แถวเสียแถวเดียวต้องไม่ทำให้งานอื่นค้าง — ข้ามแล้วเตือน
                logger.warning("ข้าม task ที่อ่านไม่ได้ %s: %s", row.get("task_id"), ex)
        return tasks

    def try_claim_task(self, task_id: str, node_id: str) -> bool:
        """PENDING → IN_PROGRESS แบบ atomic · ได้แถวกลับ = ชนะ · 0 แถว = node อื่นได้ไปแล้ว"""
        try:
            response = (
                self._table()
                .update({"status": TaskStatus.IN_PROGRESS.value, "claimed_by": node_id})
                .eq("task_id", task_id)
                .eq("status", TaskStatus.PENDING.value)
                .execute()
            )
        except Exception as ex:
            logger.error("claim task %s ไม่สำเร็จ: %s", task_id, _describe(ex))
            return False
        return bool(response.data)

    def complete_task(self, task_id: str, result_data: dict[str, Any]) -> bool:
        """IN_PROGRESS → COMPLETED พร้อมผลลัพธ์"""
        return self._finish(task_id, TaskStatus.COMPLETED, result_data)

    def fail_task(self, task_id: str, error_data: dict[str, Any]) -> bool:
        """IN_PROGRESS → FAILED พร้อมรายละเอียด error"""
        return self._finish(task_id, TaskStatus.FAILED, error_data)

    def _finish(self, task_id: str, status: TaskStatus, result: dict[str, Any]) -> bool:
        # จบได้เฉพาะงานที่ถูก claim แล้ว — กันเขียนทับงานที่จบไปแล้วหรือยังไม่มีใครรับ
        try:
            response = (
                self._table()
                .update({"status": status.value, "result": result})
                .eq("task_id", task_id)
                .eq("status", TaskStatus.IN_PROGRESS.value)
                .execute()
            )
        except Exception as ex:
            logger.error("ตั้ง %s ให้ task %s ไม่สำเร็จ: %s", status.value, task_id, _describe(ex))
            return False
        if not response.data:
            logger.warning("ตั้ง %s ให้ task %s ไม่ได้ — task ไม่อยู่ในสถานะ IN_PROGRESS", status.value, task_id)
            return False
        return True


def _describe(ex: Exception) -> str:
    """ข้อความ error สั้น ๆ สำหรับ log — ไม่ใส่ request headers (มี API key)"""
    message = getattr(ex, "message", None) or str(ex)
    return f"{type(ex).__name__}: {message}"
