"""
Config สำหรับ Mark 55 Memory Bus
- ค่าทั้งหมดอ่านจาก environment variable ก่อน ถ้าไม่มีใช้ default
- แก้ไข default ได้ตามต้องการ
- ค่า env ที่อ่านไม่ได้ (เช่น poll interval ไม่ใช่ตัวเลข) → ใช้ default + เตือน แทนการล้มตอน import
"""

import logging
import os

logger = logging.getLogger("mark55.config")

LOG_LEVELS: tuple[str, ...] = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def _env_float(name: str, default: float) -> float:
    """อ่าน env เป็นตัวเลขบวก · ไม่มี/ผิดรูปแบบ → default"""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("%s=%r ไม่ใช่ตัวเลข — ใช้ค่าเริ่มต้น %s", name, raw, default)
        return default
    if value <= 0:
        logger.warning("%s ต้องมากกว่า 0 (ได้ %s) — ใช้ค่าเริ่มต้น %s", name, value, default)
        return default
    return value


def _env_log_level(name: str, default: str) -> str:
    """อ่าน env เป็นชื่อ log level · ไม่รู้จัก → default"""
    raw = os.getenv(name, default).upper()
    if raw not in LOG_LEVELS:
        logger.warning("%s=%r ไม่รู้จัก — ใช้ค่าเริ่มต้น %s", name, raw, default)
        return default
    return raw


NODE_ID: str = os.getenv("MARK55_NODE_ID", "MARK_55_PC")
CONTAINER_TAG: str = os.getenv("MARK55_CONTAINER_TAG", "atom_core")
POLL_INTERVAL: float = _env_float("MARK55_POLL_INTERVAL", 2.0)
LOG_LEVEL: str = _env_log_level("MARK55_LOG_LEVEL", "INFO")
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
