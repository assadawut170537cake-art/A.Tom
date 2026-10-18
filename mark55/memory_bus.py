"""Memory Bus ของ Mark 55 — โครงสร้าง task และ watcher ที่ poll งานจาก blackboard

ทุก node คุยกันผ่าน blackboard เท่านั้น: ฝั่งสั่งงาน push MemoryTask · watcher บน PC poll → claim → รัน handler → เขียนผลกลับ
"""

from __future__ import annotations

import logging
import re
import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol

logger = logging.getLogger("mark55.memory_bus")

BROADCAST_TARGET = "ALL"


class TaskStatus(str, Enum):
    """สถานะของ task บน blackboard — เปลี่ยนได้ทางเดียว PENDING → IN_PROGRESS → COMPLETED/FAILED"""

    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


def parse_timestamp(value: datetime | str | None) -> datetime | None:
    """แปลง timestamptz จาก Supabase เป็น datetime ที่มี timezone

    Python 3.10 `fromisoformat` อ่าน "Z" และเศษวินาทีที่ไม่ครบ 6 หลักไม่ได้ (Postgres ตัดเลข 0 ท้ายทิ้ง เช่น `.34238`)
    จึงต้องเติมให้ครบก่อน · ไม่มี timezone = ถือว่าเป็น UTC
    """
    if value is None or isinstance(value, datetime):
        parsed = value
    else:
        text = value.strip().replace(" ", "T", 1)
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        match = _FRACTION_RE.search(text)
        if match:
            text = text[: match.start()] + "." + match.group(1).ljust(6, "0")[:6] + text[match.end():]
        text = _SHORT_OFFSET_RE.sub(r"\1:00", text)
        parsed = datetime.fromisoformat(text)
    if parsed is not None and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


_SHORT_OFFSET_RE = re.compile(r"([+-]\d{2})$")
_FRACTION_RE = re.compile(r"\.(\d+)(?=[+-]\d{2}:?\d{2}$|$)")


class MemoryTask:
    """งานหนึ่งชิ้นบน blackboard · field ตรงกับคอลัมน์ของตาราง `memory_tasks` (sql/001_init.sql)"""

    def __init__(
        self,
        instruction: str,
        sender: str,
        target: str,
        payload: dict[str, Any] | None = None,
        container_tag: str = "atom_core",
        task_id: str | uuid.UUID | None = None,
        status: TaskStatus | str = TaskStatus.PENDING,
        created_at: datetime | str | None = None,
        result: dict[str, Any] | None = None,
        claimed_by: str | None = None,
        claimed_at: datetime | str | None = None,
        completed_at: datetime | str | None = None,
    ) -> None:
        # คอลัมน์ task_id เป็น UUID — id ผิดรูปแบบจะ raise ValueError ที่นี่ แทนที่จะไปพังตอน insert
        self.task_id = str(uuid.UUID(str(task_id))) if task_id else str(uuid.uuid4())
        self.instruction = instruction
        self.sender = sender
        self.target = target
        self.payload = payload or {}
        self.container_tag = container_tag
        # รับ str ได้ด้วย เพราะข้อมูลที่อ่านกลับมาจากตารางเป็น str — ค่าที่ไม่รู้จักจะ raise ValueError
        self.status = TaskStatus(status)
        self.created_at = parse_timestamp(created_at) or datetime.now(timezone.utc)
        self.result = result or {}
        self.claimed_by = claimed_by
        self.claimed_at = parse_timestamp(claimed_at)
        self.completed_at = parse_timestamp(completed_at)

    def to_dict(self) -> dict[str, Any]:
        """แปลงเป็น dict ที่ serialize เป็น JSON ได้ · key = ชื่อคอลัมน์ · เวลาเป็น ISO 8601"""
        return {
            "task_id": self.task_id,
            "instruction": self.instruction,
            "sender": self.sender,
            "target": self.target,
            "status": self.status.value,
            "container_tag": self.container_tag,
            "created_at": self.created_at.isoformat(),
            "payload": self.payload,
            "result": self.result,
            "claimed_by": self.claimed_by,
            "claimed_at": self.claimed_at.isoformat() if self.claimed_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryTask:
        """สร้าง task จากแถวของตาราง หรือจาก to_dict()"""
        return cls(
            task_id=data.get("task_id"),
            instruction=data.get("instruction", ""),
            sender=data.get("sender", ""),
            target=data.get("target", ""),
            payload=data.get("payload") or {},
            container_tag=data.get("container_tag", "atom_core"),
            status=data.get("status", TaskStatus.PENDING.value),
            created_at=data.get("created_at"),
            result=data.get("result") or {},
            claimed_by=data.get("claimed_by"),
            claimed_at=data.get("claimed_at"),
            completed_at=data.get("completed_at"),
        )


class GatewayClient(Protocol):
    """สิ่งที่ watcher ต้องการจาก gateway — แยกเป็น Protocol เพื่อสลับ backend (Supabase / ตัวปลอมใน test) ได้โดยไม่แก้ watcher"""

    def fetch_pending_tasks(self, target_node_id: str) -> list[MemoryTask]: ...

    def try_claim_task(self, task_id: str, node_id: str) -> bool: ...

    def complete_task(self, task_id: str, result_data: dict[str, Any]) -> bool: ...

    def fail_task(self, task_id: str, error_data: dict[str, Any]) -> bool: ...


TaskHandler = Callable[[MemoryTask], dict[str, Any]]


class MemoryWatcher:
    """daemon ที่ poll blackboard หา task ของ node นี้ แล้วส่งให้ handler ตาม instruction"""

    def __init__(self, gateway_client: GatewayClient, target_node_id: str, poll_interval: float = 2.0) -> None:
        if poll_interval <= 0:
            raise ValueError(f"poll_interval ต้องมากกว่า 0 (ได้ {poll_interval})")
        self.gateway = gateway_client
        self.node_id = target_node_id
        self.poll_interval = poll_interval
        self.handlers: dict[str, TaskHandler] = {}
        # flag หยุด — ใช้ Event แทน bool + time.sleep เพื่อให้ stop() ปลุก loop ได้ทันที ไม่ต้องรอครบรอบ
        self._stop_event = threading.Event()
        self._running = False

    @property
    def is_running(self) -> bool:
        """True ระหว่างที่ start() กำลังวน loop"""
        return self._running

    def register_handler(self, instruction: str, handler: TaskHandler) -> None:
        """ผูก instruction กับ handler · ลงทะเบียนซ้ำ = ทับตัวเดิม"""
        if instruction in self.handlers:
            logger.warning("ทับ handler เดิมของ %s", instruction)
        self.handlers[instruction] = handler

    def start(self) -> None:
        """วน poll จนกว่าจะเรียก stop() (จาก signal handler หรือ thread อื่น) — block thread ที่เรียก"""
        self._stop_event.clear()
        self._running = True
        logger.info("Watcher เริ่มทำงานสำหรับ node [%s]", self.node_id)
        try:
            while not self._stop_event.is_set():
                try:
                    self._poll_and_process()
                except Exception:
                    # gateway ล่มชั่วคราวต้องไม่ทำให้ daemon ตาย — log แล้วรอรอบถัดไป
                    logger.exception("poll รอบนี้ล้มเหลว — จะลองใหม่ใน %.1f วินาที", self.poll_interval)
                self._stop_event.wait(self.poll_interval)
        finally:
            self._running = False
        logger.info("Watcher หยุดทำงานแล้ว")

    def stop(self) -> None:
        """สั่งหยุด loop · เรียกจาก signal handler ได้ปลอดภัย · task ที่กำลังรันอยู่จะรันจนจบก่อน"""
        self._stop_event.set()

    def _poll_and_process(self) -> None:
        """poll หนึ่งรอบ: ดึง task ที่รอ → claim → รัน handler → บันทึกผล"""
        for task in self.gateway.fetch_pending_tasks(self.node_id):
            if self._stop_event.is_set():
                break
            # ผู้แพ้การ claim ข้ามไปเลย — node อื่นรับงานนี้ไปแล้ว
            if not self.gateway.try_claim_task(task.task_id, self.node_id):
                logger.debug("task %s ถูก node อื่น claim ไปแล้ว", task.task_id)
                continue
            logger.info("รับงาน %s [%s] จาก %s", task.task_id, task.instruction, task.sender)
            self._execute(task)

    def _execute(self, task: MemoryTask) -> None:
        handler = self.handlers.get(task.instruction)
        if handler is None:
            logger.warning("ไม่มี handler สำหรับ %s — task %s = FAILED", task.instruction, task.task_id)
            self.gateway.fail_task(task.task_id, {"error": f"ไม่มี handler สำหรับ {task.instruction}"})
            return
        try:
            execution_result = handler(task)
        except Exception as ex:
            logger.exception("handler ของ %s ล้มเหลว — task %s = FAILED", task.instruction, task.task_id)
            self.gateway.fail_task(task.task_id, {"exception": f"{type(ex).__name__}: {ex}"})
            return
        self.gateway.complete_task(task.task_id, execution_result)
        logger.info("งาน %s เสร็จแล้ว", task.task_id)
