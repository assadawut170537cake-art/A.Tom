"""Handler ของ instruction ที่ Mark 55 รองรับ — main.py ลงทะเบียนทุกตัวใน HANDLER_REGISTRY

เพิ่ม handler ใหม่: เขียนฟังก์ชัน `(task) -> dict` แล้วเพิ่มลง HANDLER_REGISTRY
handler ต้องไม่ raise ออกไป — จับ error เองแล้วคืน dict ที่มี `status` บอกผล
(watcher ก็กันไว้อีกชั้น: ถ้าหลุดออกมา task จะเป็น FAILED)
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

try:
    from .memory_bus import MemoryTask, MemoryWatcher
except ImportError:  # รันแบบ `python main.py` ในโฟลเดอร์ mark55
    from memory_bus import MemoryTask, MemoryWatcher

logger = logging.getLogger("mark55.handlers")


def handle_execute_build(task: MemoryTask) -> dict[str, Any]:
    """EXECUTE_BUILD — handler เริ่มต้น: บันทึกคำสั่ง build แล้วตอบ BUILD_OK (Boss จะเปลี่ยนเป็น build จริงภายหลัง)"""
    try:
        logger.info("EXECUTE_BUILD: task %s payload=%s", task.task_id, task.payload)
        return {"status": "BUILD_OK", "task_id": task.task_id}
    except Exception as ex:
        logger.exception("EXECUTE_BUILD ล้มเหลว: task %s", task.task_id)
        return {"status": "BUILD_ERROR", "task_id": task.task_id, "error": str(ex)}


def handle_run_diagnostics(task: MemoryTask) -> dict[str, Any]:
    """RUN_DIAGNOSTICS — handler เริ่มต้น: บันทึกคำขอตรวจระบบแล้วตอบ HEALTHY (Boss จะเพิ่มการตรวจจริงภายหลัง)"""
    try:
        logger.info("RUN_DIAGNOSTICS: task %s payload=%s", task.task_id, task.payload)
        return {"status": "HEALTHY", "task_id": task.task_id}
    except Exception as ex:
        logger.exception("RUN_DIAGNOSTICS ล้มเหลว: task %s", task.task_id)
        return {"status": "DIAGNOSTICS_ERROR", "task_id": task.task_id, "error": str(ex)}


HANDLER_REGISTRY: dict[str, Callable[[MemoryTask], dict[str, Any]]] = {
    "EXECUTE_BUILD": handle_execute_build,
    "RUN_DIAGNOSTICS": handle_run_diagnostics,
}


def register_all_handlers(watcher: MemoryWatcher) -> None:
    """ลงทะเบียนทุก handler ใน HANDLER_REGISTRY ให้ watcher"""
    for instruction, handler in HANDLER_REGISTRY.items():
        watcher.register_handler(instruction, handler)
