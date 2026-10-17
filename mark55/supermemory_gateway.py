"""Gateway ระหว่าง watcher กับ blackboard — MVP (4.5.5.1) ทำงานแบบ mock: เก็บ task ในหน่วยความจำของโปรเซสนี้

claim เป็น atomic ภายใต้ lock เดียว จึงกันการรันซ้ำระหว่าง thread ในโปรเซสเดียวกันได้
แต่ store นี้มองไม่เห็นจากโปรเซส/เครื่องอื่น — การซิงก์ข้ามเครื่องเป็นงานของ 4.5.5.2 (cloud mode)
"""

from __future__ import annotations

import copy
import logging
import threading
from typing import Any

try:
    from .memory_bus import BROADCAST_TARGET, MemoryTask, TaskStatus
except ImportError:  # รันแบบ `python main.py` ในโฟลเดอร์ mark55 (ไม่มี package แม่)
    from memory_bus import BROADCAST_TARGET, MemoryTask, TaskStatus

# เตรียมไว้ให้ cloud mode (4.5.5.2) — MVP ไม่เรียกใช้ และไม่ต้องติดตั้ง
try:
    import requests  # noqa: F401
except ImportError:
    requests = None

logger = logging.getLogger("mark55.supermemory_gateway")


class SupermemoryGateway:
    """blackboard แบบ mock · ทุก operation ที่แตะ `_mock_store` อยู่ใต้ `_lock`"""

    def __init__(
        self,
        api_base_url: str | None = None,
        api_key: str | None = None,
        container_tag: str = "atom_core",
    ) -> None:
        # เก็บไว้ให้ 4.5.5.2 ใช้ — mock mode ไม่ยิงเน็ต และห้าม log api_key
        self.api_base_url = api_base_url.rstrip("/") if api_base_url else None
        self._api_key = api_key
        self.container_tag = container_tag
        self._mock_store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        if self.api_base_url or self._api_key:
            logger.warning("ตั้งค่า cloud ไว้ แต่ 4.5.5.1 ยังรองรับแค่ mock mode — จะเก็บ task ในเครื่องเท่านั้น")

    def is_mock_mode(self) -> bool:
        """True เสมอใน MVP — 4.5.5.2 จะคืน False เมื่อต่อ cloud ได้"""
        return True

    def push_task(self, task: MemoryTask) -> bool:
        """วาง task ลง blackboard · task_id ซ้ำ = ปฏิเสธ (กันทับงานที่กำลังรันอยู่)"""
        # task ที่ tag ไม่ตรงจะไม่มีใครใน namespace นี้เห็น — บังคับให้ตรงกับ gateway
        task.container_tag = self.container_tag
        with self._lock:
            if task.task_id in self._mock_store:
                logger.warning("ปฏิเสธ task %s — มี task_id นี้อยู่แล้ว", task.task_id)
                return False
            self._mock_store[task.task_id] = task.to_dict()
        logger.info("รับ task %s [%s] จาก %s → %s", task.task_id, task.instruction, task.sender, task.target)
        return True

    def get_task(self, task_id: str) -> MemoryTask | None:
        """อ่าน task ตาม id (สำเนา — แก้ object ที่ได้ไม่กระทบ store)"""
        with self._lock:
            data = self._mock_store.get(task_id)
            return MemoryTask.from_dict(copy.deepcopy(data)) if data else None

    def fetch_pending_tasks(self, target_node_id: str) -> list[MemoryTask]:
        """task ที่ยัง PENDING ของ node นี้หรือ target `ALL` เรียงตามเวลาสร้าง (งานเก่าทำก่อน)"""
        with self._lock:
            matching = [
                MemoryTask.from_dict(copy.deepcopy(data))
                for data in self._mock_store.values()
                if data["target"] in (target_node_id, BROADCAST_TARGET)
                and data["status"] == TaskStatus.PENDING.value
                and data["containerTag"] == self.container_tag
            ]
        return sorted(matching, key=lambda t: t.created_at)

    def try_claim_task(self, task_id: str, node_id: str) -> bool:
        """PENDING → IN_PROGRESS แบบ compare-and-set · ผู้แพ้ได้ False และต้องไม่รันงานนี้"""
        with self._lock:
            data = self._mock_store.get(task_id)
            if data is None or data["status"] != TaskStatus.PENDING.value:
                return False
            data["status"] = TaskStatus.IN_PROGRESS.value
            data["claimed_by"] = node_id
            return True

    def complete_task(self, task_id: str, result_data: dict[str, Any]) -> bool:
        """IN_PROGRESS → COMPLETED พร้อมผลลัพธ์"""
        return self._finish(task_id, TaskStatus.COMPLETED, result_data)

    def fail_task(self, task_id: str, error_data: dict[str, Any]) -> bool:
        """IN_PROGRESS → FAILED พร้อมรายละเอียด error"""
        return self._finish(task_id, TaskStatus.FAILED, error_data)

    def _finish(self, task_id: str, status: TaskStatus, result: dict[str, Any]) -> bool:
        # จบได้เฉพาะงานที่ถูก claim แล้ว — กันการเขียนทับงานที่จบไปแล้วหรือยังไม่มีใครรับ
        with self._lock:
            data = self._mock_store.get(task_id)
            if data is None or data["status"] != TaskStatus.IN_PROGRESS.value:
                current = data["status"] if data else "ไม่พบ task"
                logger.warning("ตั้ง %s ให้ task %s ไม่ได้ (สถานะปัจจุบัน: %s)", status.value, task_id, current)
                return False
            data["status"] = status.value
            data["result"] = result
            return True
