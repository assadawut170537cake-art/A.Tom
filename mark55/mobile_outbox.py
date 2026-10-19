"""ส่งงานจาก Mark 55 ไปหาแอปมือถือ (PC → มือถือ) — ต้องรัน sql/003_mobile_inbox.sql ก่อน

ใช้จากโค้ด (เช่นใน handler หลัง build เสร็จ):
    from mark55.mobile_outbox import notify_mobile, device_tool
    notify_mobile(gateway, "build เสร็จแล้วครับบอส")                       # → เครื่อง boss-phone
    device_tool(gateway, "device.volume", text="20", device_id="boss-phone")

ใช้จาก command line:
    python mobile_outbox.py notify "build เสร็จแล้ว"
    python mobile_outbox.py notify "เตือนประชุม" --device boss-phone --silent
    python mobile_outbox.py device device.flashlight --text on

แอปดึง inbox ทุก ~15 วินาทีตอนเปิดแอปอยู่ (รวมตอนเปิดโหมดเฝ้าแล้วสลับไปแอปอื่น) · งานค้างเกิน 1 วัน = หมดอายุ
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

try:
    from .memory_bus import MemoryTask
except ImportError:  # รันแบบ `python mobile_outbox.py` ในโฟลเดอร์ mark55
    from memory_bus import MemoryTask

logger = logging.getLogger("mark55.mobile_outbox")

DEFAULT_DEVICE = "boss-phone"
SENDER = "MARK_55_PC"
#: ตรงกับ instruction ที่ mobile_claim_inbox ยอมส่งให้มือถือ (sql/003_mobile_inbox.sql)
NOTIFY = "NOTIFY"
DEVICE_TOOL = "DEVICE_TOOL"
#: payload ทั้งก้อนต้องไม่เกิน 4 KB ฝั่งแอป — ตัดข้อความไว้ก่อน
MAX_TEXT = 1000


def mobile_target(device_id: str | None) -> str:
    """None / "" = เครื่องแรกที่ดึงได้ (MOBILE_ALL)"""
    return f"MOBILE:{device_id}" if device_id else "MOBILE_ALL"


def notify_mobile(gateway: Any, text: str, device_id: str | None = DEFAULT_DEVICE, speak: bool = True) -> str | None:
    """แสดงข้อความในแชทของแอป (+ พูดถ้า `speak` และแอปไม่ได้ฟัง/พูดอยู่) · คืน task_id หรือ None ถ้าส่งไม่สำเร็จ"""
    task = MemoryTask(
        instruction=NOTIFY,
        sender=SENDER,
        target=mobile_target(device_id),
        payload={"text": text[:MAX_TEXT], "speak": speak},
    )
    return task.task_id if gateway.push_task(task) else None


def device_tool(
    gateway: Any,
    tool: str,
    text: str = "",
    args: dict[str, Any] | None = None,
    device_id: str | None = DEFAULT_DEVICE,
) -> str | None:
    """สั่ง DeviceControlBridge บนมือถือ (เช่น device.volume / device.launch)

    บอสต้องเปิด ตั้งค่า › Marketplace › ควบคุมอุปกรณ์ ไว้ · ปุ่มเสี่ยงยังต้องให้บอสพิมพ์ "ยืนยัน" บนมือถือเสมอ
    (แอปตัด `confirmed` ที่ส่งมาทิ้ง — PC ยืนยันแทนบอสไม่ได้)
    """
    payload: dict[str, Any] = {"tool": tool, "text": text[:MAX_TEXT]}
    if args:
        payload["args"] = args
    task = MemoryTask(instruction=DEVICE_TOOL, sender=SENDER, target=mobile_target(device_id), payload=payload)
    return task.task_id if gateway.push_task(task) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mobile_outbox", description="ส่งข้อความ/คำสั่งไปหาแอป A.T.O.M. บนมือถือ")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help=f"device_id (ค่าเริ่มต้น {DEFAULT_DEVICE}) · '' = เครื่องไหนก็ได้")
    sub = parser.add_subparsers(dest="command", required=True)
    n = sub.add_parser("notify", help="แสดงข้อความในแชท + พูด")
    n.add_argument("text")
    n.add_argument("--silent", action="store_true", help="ไม่พูด แสดงอย่างเดียว")
    d = sub.add_parser("device", help="สั่ง tool ของ DeviceControlBridge")
    d.add_argument("tool", help="เช่น device.volume · device.flashlight · device.launch")
    d.add_argument("--text", default="")
    args = parser.parse_args(argv)

    try:
        from . import config
        from .supabase_gateway import SupabaseGateway
    except ImportError:
        import config
        from supabase_gateway import SupabaseGateway

    logging.basicConfig(level=logging.INFO, format=config.LOG_FORMAT)
    try:
        url, key = config.require_supabase()
    except ValueError as ex:
        logger.error("%s", ex)
        return 1
    gateway = SupabaseGateway(url, key, container_tag=config.CONTAINER_TAG)
    device = args.device or None
    if args.command == "notify":
        task_id = notify_mobile(gateway, args.text, device, speak=not args.silent)
    else:
        task_id = device_tool(gateway, args.tool, args.text, device_id=device)
    if task_id is None:
        return 1
    logger.info("ส่งแล้ว: task %s → %s", task_id, mobile_target(device))
    return 0


if __name__ == "__main__":
    sys.exit(main())
