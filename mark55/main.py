"""Entrypoint ของ Memory Bus บน Mark 55 — `python main.py` (ในโฟลเดอร์ mark55) หรือ `python mark55/main.py`

Ctrl+C / SIGTERM → หยุด watcher หลังงานที่กำลังรันจบ แล้วออกด้วย exit code 0
exit code: 0 = ปิดปกติ · 1 = config ไม่ครบ / ต่อ Supabase ไม่ได้ / watcher ล้มกลางทาง · 2 = argument ผิด (argparse)
ค่า Supabase อ่านจาก mark55/.env (config.py โหลดให้) — ดู .env.example
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
from types import FrameType

try:
    from . import config
    from .handlers import register_all_handlers
    from .memory_bus import MemoryWatcher
    from .supabase_gateway import SupabaseGateway
except ImportError:  # รันเป็นสคริปต์ — โฟลเดอร์ของไฟล์นี้อยู่ใน sys.path อยู่แล้ว
    import config
    from handlers import register_all_handlers
    from memory_bus import MemoryWatcher
    from supabase_gateway import SupabaseGateway

# ใช้ชื่อเดียวกับ watcher เพื่อให้ log ตอนเริ่ม/ปิดอยู่ใต้ mark55.memory_bus ตามที่ Boss กำหนด
logger = logging.getLogger("mark55.memory_bus")


def _positive_float(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError:
        raise argparse.ArgumentTypeError(f"ต้องเป็นตัวเลข (ได้ {raw!r})") from None
    if value <= 0:
        raise argparse.ArgumentTypeError(f"ต้องมากกว่า 0 (ได้ {value})")
    return value


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """อ่าน argument · ค่าเริ่มต้นมาจาก config.py (ซึ่งอ่าน env ก่อน)"""
    parser = argparse.ArgumentParser(
        prog="mark55",
        description="Memory Bus watcher ของ Mark 55 — poll task จาก blackboard แล้วรัน handler",
    )
    parser.add_argument("--node-id", default=config.NODE_ID, help=f"ชื่อ node นี้ (ค่าเริ่มต้น: {config.NODE_ID})")
    parser.add_argument(
        "--poll-interval",
        type=_positive_float,
        default=config.POLL_INTERVAL,
        help=f"วินาทีระหว่าง poll แต่ละรอบ (ค่าเริ่มต้น: {config.POLL_INTERVAL})",
    )
    parser.add_argument(
        "--log-level",
        type=str.upper,
        choices=config.LOG_LEVELS,
        default=config.LOG_LEVEL,
        help=f"ระดับ log (ค่าเริ่มต้น: {config.LOG_LEVEL})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """เริ่ม watcher แล้ว block จนกว่าจะได้สัญญาณปิด · คืน exit code"""
    args = parse_args(argv)
    logging.basicConfig(level=args.log_level, format=config.LOG_FORMAT)
    if args.log_level != "DEBUG":
        # httpx log ทุก request ที่ INFO — poll ทุก 2 วินาทีจะท่วม log
        for noisy in ("httpx", "httpcore"):
            logging.getLogger(noisy).setLevel(logging.WARNING)
    logger.info("เริ่ม Memory Bus")

    try:
        url, key = config.require_supabase()
    except ValueError as ex:
        logger.error("%s", ex)
        return 1

    logger.info("เชื่อมต่อ Supabase: %s", url)
    try:
        gateway = SupabaseGateway(url, key, container_tag=config.CONTAINER_TAG)
        gateway.check_connection()
    except ImportError:
        logger.error("ยังไม่ได้ติดตั้ง supabase — รัน `pip install -r requirements.txt`")
        return 1
    except Exception as ex:
        logger.error(
            "ต่อ Supabase ไม่สำเร็จ (%s: %s) — ตรวจ URL / service_role key และว่ารัน sql/001_init.sql แล้ว",
            type(ex).__name__,
            getattr(ex, "message", None) or ex,
        )
        return 1

    try:
        watcher = MemoryWatcher(gateway, args.node_id, poll_interval=args.poll_interval)
        register_all_handlers(watcher)
    except Exception:
        logger.exception("เริ่มระบบไม่สำเร็จ")
        return 1

    def _shutdown(signum: int, _frame: FrameType | None) -> None:
        logger.info("ได้รับสัญญาณปิดระบบ (%s)", signal.Signals(signum).name)
        watcher.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("Node ID = %s", args.node_id)
    logger.info("Container tag = %s", config.CONTAINER_TAG)
    logger.info("Poll interval = %ss", args.poll_interval)
    logger.info("ตาราง = %s", gateway.table)
    logger.info("Handlers = %s", sorted(watcher.handlers))

    try:
        watcher.start()
    except Exception:
        # start() กัน error ของแต่ละรอบไว้แล้ว — มาถึงนี่แปลว่า loop เองพัง
        logger.exception("Watcher หยุดเพราะ error ที่ไม่คาดคิด")
        return 1

    logger.info("ปิดระบบเรียบร้อย")
    return 0


if __name__ == "__main__":
    sys.exit(main())
