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
    from .reverse_engineer import make_rea_handler
    from .ultron_sandbox import SandboxError, UltronSandbox
except ImportError:  # รันแบบ `python main.py` ในโฟลเดอร์ mark55
    from memory_bus import MemoryTask, MemoryWatcher
    from reverse_engineer import make_rea_handler
    from ultron_sandbox import SandboxError, UltronSandbox

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
    # REVERSE_ENGINEER (ADR-016) — แกะ APK ด้วย REA (ต้องลง rea บน Mark 55 · ดู reverse_engineer.py)
    "REVERSE_ENGINEER": make_rea_handler(),
}


# ─── อัลตรอน (ADR-015 ขั้น 4) ─────────────────────────────────────────

#: ส่งข้อความหามือถือ (device_id, text) — main.py ใช้ mobile_outbox.notify_mobile ผ่าน gateway
Notify = Callable[[str, str], object]

#: มือถือรอผลแค่ ~8 วินาที — รันนานกว่านั้นผลจะไปทาง NOTIFY (PC → มือถือ) แทน
RUN_DONE_HINT = 'พูดว่า "ปลด" เพื่อเก็บผล หรือ "ทำลาย" เพื่อทิ้ง'


def _device_of(task: MemoryTask) -> str | None:
    """งานจากมือถือ: sender = MOBILE:<device_id>"""
    return task.sender.split(":", 1)[1] if task.sender.startswith("MOBILE:") else None


def describe_run(result: dict[str, Any]) -> str:
    """ผลรัน → ข้อความไทยสั้น ๆ สำหรับแชท/เสียงบนมือถือ"""
    sid = result["sandbox_id"]
    if result.get("timed_out"):
        head = f"🧪 อัลตรอน: sandbox {sid} รันเกินเวลา ถูกหยุดแล้ว"
    elif result.get("exit_code") == 0:
        head = f"🧪 อัลตรอน: sandbox {sid} รันสำเร็จ"
    else:
        head = f"🧪 อัลตรอน: sandbox {sid} รันไม่ผ่าน (exit {result.get('exit_code')})"
    out = (result.get("stdout") or result.get("stderr") or "").strip()
    lines = [head]
    if out:
        lines.append(out[-400:])
    if result.get("files"):
        lines.append("ไฟล์ที่ได้: " + ", ".join(result["files"]))
    lines.append(RUN_DONE_HINT)
    return "\n".join(lines)


def make_ultron_handlers(
    sandbox: UltronSandbox, notify: Notify | None = None
) -> dict[str, Callable[[MemoryTask], dict[str, Any]]]:
    """handler ของอัลตรอน — รันโค้ดใน sandbox (Docker) · ปลด · ทำลาย

    `notify` ไม่ใส่ = ไม่แจ้งมือถือเมื่อรันเสร็จ (ผลยังอยู่ใน result ของ task)
    """

    def tell(task: MemoryTask, text: str) -> None:
        device = _device_of(task)
        if notify is None or device is None:
            return
        try:
            notify(device, text)
        except Exception:
            logger.exception("แจ้งผลอัลตรอนไปมือถือไม่สำเร็จ: task %s", task.task_id)

    def run(task: MemoryTask) -> dict[str, Any]:
        payload = task.payload
        try:
            result = sandbox.run(
                task.task_id.replace("-", "")[:8],
                str(payload.get("code", "")),
                str(payload.get("language", "python")),
                str(payload.get("task", "")),
            )
        except SandboxError as ex:
            tell(task, f"🧪 อัลตรอนรันไม่ได้: {ex}")
            return {"status": "ULTRON_ERROR", "error": str(ex)}
        tell(task, describe_run(result))
        return {"status": "RAN", **result}

    def decide(action: str) -> Callable[[MemoryTask], dict[str, Any]]:
        def handler(task: MemoryTask) -> dict[str, Any]:
            ref = str(task.payload.get("sandbox_id") or "latest")
            try:
                done = sandbox.release(ref) if action == "release" else sandbox.destroy(ref)
            except SandboxError as ex:
                return {"status": "ULTRON_ERROR", "error": str(ex)}
            except OSError as ex:
                logger.exception("ultron %s ล้มเหลว: %s", action, ref)
                return {"status": "ULTRON_ERROR", "error": f"{type(ex).__name__}: {ex}"}
            return {"status": "RELEASED" if action == "release" else "DESTROYED", **done}

        return handler

    return {
        "ULTRON_RUN": run,
        "ULTRON_RELEASE": decide("release"),
        "ULTRON_DESTROY": decide("destroy"),
    }


def register_all_handlers(watcher: MemoryWatcher, extra: dict[str, Callable[[MemoryTask], dict[str, Any]]] | None = None) -> None:
    """ลงทะเบียนทุก handler ใน HANDLER_REGISTRY (+ `extra` เช่นของอัลตรอน) ให้ watcher"""
    for instruction, handler in {**HANDLER_REGISTRY, **(extra or {})}.items():
        watcher.register_handler(instruction, handler)
