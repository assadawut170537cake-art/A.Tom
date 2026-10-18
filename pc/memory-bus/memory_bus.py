"""Reactive Shared Memory Bus — task model, thread-safe store และ watcher daemon ฝั่ง PC (Mark 55)

ทุก node สื่อสารผ่าน blackboard เท่านั้น: มือถือ push MemoryTask · PC poll → claim → ทำงาน → เขียนผลกลับ
"""

import logging
import threading
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("MemoryBus")

BROADCAST_TARGET = "ALL"


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class MemoryTask:
    def __init__(
        self,
        instruction: str,
        sender: str,
        target: str,
        payload: Optional[Dict[str, Any]] = None,
        container_tag: str = "atom_core",
        task_id: Optional[str] = None,
        status: TaskStatus = TaskStatus.PENDING,
        created_at: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
        claimed_by: Optional[str] = None,
    ):
        self.task_id = task_id or f"task_{uuid.uuid4()}"
        self.instruction = instruction
        self.sender = sender
        self.target = target
        self.payload = payload or {}
        self.container_tag = container_tag
        self.status = TaskStatus(status)
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.result = result or {}
        self.claimed_by = claimed_by

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "instruction": self.instruction,
            "sender": self.sender,
            "target": self.target,
            "status": self.status.value,
            "containerTag": self.container_tag,
            "created_at": self.created_at,
            "payload": self.payload,
            "result": self.result,
            "claimed_by": self.claimed_by,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MemoryTask":
        return cls(
            task_id=data.get("task_id"),
            instruction=data.get("instruction", ""),
            sender=data.get("sender", ""),
            target=data.get("target", ""),
            payload=data.get("payload") or {},
            container_tag=data.get("containerTag", "atom_core"),
            status=TaskStatus(data.get("status", TaskStatus.PENDING.value)),
            created_at=data.get("created_at"),
            result=data.get("result") or {},
            claimed_by=data.get("claimed_by"),
        )


class InMemoryTaskStore:
    """Blackboard ในโปรเซสเดียว · ทุก transition ทำภายใต้ lock จึง atomic ระหว่าง thread

    ไม่ atomic ข้ามเครื่อง — ถ้าหลาย PC ต้อง claim งานเดียวกันได้ ต้องใช้ store ที่มี compare-and-set ฝั่ง server
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: Dict[str, Dict[str, Any]] = {}

    def put(self, task: MemoryTask) -> None:
        with self._lock:
            self._tasks[task.task_id] = task.to_dict()

    def get(self, task_id: str) -> Optional[MemoryTask]:
        with self._lock:
            data = self._tasks.get(task_id)
            return MemoryTask.from_dict(data) if data else None

    def find_pending(self, target_node_id: str, container_tag: str) -> List[MemoryTask]:
        with self._lock:
            return [
                MemoryTask.from_dict(data)
                for data in self._tasks.values()
                if data["target"] in (target_node_id, BROADCAST_TARGET)
                and data["status"] == TaskStatus.PENDING.value
                and data["containerTag"] == container_tag
            ]

    def claim(self, task_id: str, node_id: str) -> bool:
        """PENDING → IN_PROGRESS เฉพาะเมื่อยังเป็น PENDING อยู่ (compare-and-set) · ผู้แพ้ได้ False"""
        with self._lock:
            data = self._tasks.get(task_id)
            if data is None or data["status"] != TaskStatus.PENDING.value:
                return False
            data["status"] = TaskStatus.IN_PROGRESS.value
            data["claimed_by"] = node_id
            return True

    def finish(self, task_id: str, node_id: str, status: TaskStatus, result: Dict[str, Any]) -> bool:
        """IN_PROGRESS → COMPLETED/FAILED ได้เฉพาะ node ที่ claim ไว้"""
        with self._lock:
            data = self._tasks.get(task_id)
            if (
                data is None
                or data["status"] != TaskStatus.IN_PROGRESS.value
                or data["claimed_by"] != node_id
            ):
                return False
            data["status"] = status.value
            data["result"] = result
            return True


TaskHandler = Callable[[MemoryTask], Dict[str, Any]]


class MemoryWatcher:
    def __init__(self, gateway_client: Any, target_node_id: str, poll_interval: float = 2.0):
        self.gateway = gateway_client
        self.node_id = target_node_id
        self.poll_interval = poll_interval
        self.handlers: Dict[str, TaskHandler] = {}
        self._stop = threading.Event()

    @property
    def is_running(self) -> bool:
        return not self._stop.is_set()

    def register_handler(self, instruction: str, handler: TaskHandler) -> None:
        self.handlers[instruction] = handler

    def start(self) -> None:
        """วน poll จนกว่าจะเรียก stop() (จาก thread อื่นหรือ signal handler)"""
        self._stop.clear()
        logger.info("MemoryWatcher initialized for target node [%s]", self.node_id)
        while not self._stop.is_set():
            try:
                self._poll_and_process()
            except Exception:
                logger.exception("Error during polling loop")
            self._stop.wait(self.poll_interval)

    def stop(self) -> None:
        self._stop.set()

    def _poll_and_process(self) -> None:
        for task in self.gateway.fetch_pending_tasks(self.node_id):
            # ผู้แพ้การ claim ข้ามไปเลย ไม่รันซ้ำ
            if not self.gateway.try_claim_task(task.task_id, self.node_id):
                continue
            logger.info("Claimed task %s [%s]", task.task_id, task.instruction)
            handler = self.handlers.get(task.instruction)
            if handler is None:
                self.gateway.fail_task(
                    task.task_id, self.node_id, {"error": f"No handler registered for {task.instruction}"}
                )
                continue
            try:
                execution_result = handler(task)
            except Exception as ex:
                logger.exception("Task %s failed", task.task_id)
                self.gateway.fail_task(task.task_id, self.node_id, {"exception": str(ex)})
                continue
            self.gateway.complete_task(task.task_id, self.node_id, execution_result)
