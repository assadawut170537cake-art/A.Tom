"""
Config สำหรับ Mark 55 Memory Bus
- ค่าทั้งหมดอ่านจาก environment variable ก่อน ถ้าไม่มีใช้ default
- แก้ไข default ได้ตามต้องการ
- ค่า env ที่อ่านไม่ได้ (เช่น poll interval ไม่ใช่ตัวเลข) → ใช้ default + เตือน แทนการล้มตอน import
- โหลด `mark55/.env` ก่อนอ่านค่า (ถ้ามี) · ตัวแปรที่ตั้งไว้ใน shell แล้วชนะค่าใน .env
"""

import logging
import os
from pathlib import Path

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


ENV_FILE: Path = Path(__file__).resolve().parent / ".env"


def _load_env_file() -> bool:
    """โหลด .env ข้างไฟล์นี้ · คืน True ถ้าโหลดได้ (ไม่มีไฟล์ = False)"""
    if not ENV_FILE.is_file():
        return False
    try:
        from dotenv import load_dotenv
    except ImportError:
        logger.warning("พบ %s แต่ยังไม่ได้ติดตั้ง python-dotenv — รัน `pip install -r requirements.txt`", ENV_FILE)
        return False
    return load_dotenv(ENV_FILE, override=False)


ENV_FILE_LOADED: bool = _load_env_file()

NODE_ID: str = os.getenv("MARK55_NODE_ID", "MARK_55_PC")
CONTAINER_TAG: str = os.getenv("MARK55_CONTAINER_TAG", "atom_core")
POLL_INTERVAL: float = _env_float("MARK55_POLL_INTERVAL", 2.0)
LOG_LEVEL: str = _env_log_level("MARK55_LOG_LEVEL", "INFO")
LOG_FORMAT: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

# Supabase — Mark 55 ใช้ service_role key (ข้าม RLS) · ห้ามใส่ใน git / แชท / แอปมือถือ
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "").strip()
# สำรองไว้ให้แอปมือถือ (4.5.5.3) — Mark 55 ไม่ใช้
SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "").strip()


def require_supabase() -> tuple[str, str]:
    """คืน (url, key) · ขาดตัวใดตัวหนึ่ง → ValueError พร้อมวิธีแก้"""
    missing = [name for name, value in (("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_KEY", SUPABASE_KEY)) if not value]
    if missing:
        raise ValueError(
            f"ยังไม่ได้ตั้ง {', '.join(missing)} — คัดลอก mark55/.env.example เป็น mark55/.env "
            "แล้วใส่ Project URL และ service_role key จาก Supabase (Settings → API)"
        )
    if not SUPABASE_URL.startswith("https://"):
        raise ValueError(f"SUPABASE_URL ต้องขึ้นต้นด้วย https:// (ได้ {SUPABASE_URL!r})")
    return SUPABASE_URL, SUPABASE_KEY
