"""Sandbox ของอัลตรอน (ADR-015 ขั้น 4) — รันโค้ดที่ส่งมาจากมือถือใน Docker แยกจากเครื่องจริง แล้วรอบอส "ปลด" / "ทำลาย"

วงจร:  ULTRON_RUN → pending/<id>/ (main.py + ผลลัพธ์)  ──"ปลด"──▶ released/<id>/   (เก็บไว้ให้บอสเอาไปใช้เอง)
                                                        └─"ทำลาย"─▶ ลบทิ้งทั้งหมด

ทำไมเป็น Docker แบบนี้:
* `--network none` — โค้ดที่ AI เขียนต้องไม่ส่งข้อมูลออก/ดาวน์โหลดอะไรเข้ามาเอง
* `--read-only` + `--cap-drop ALL` + `no-new-privileges` + user nobody — เขียนได้แค่ /work (โฟลเดอร์ sandbox) กับ /tmp
* จำกัด RAM / CPU / จำนวน process / เวลา — loop ไม่รู้จบหรือ fork bomb ไม่ทำให้ PC ค้าง
* `--rm` — container หายเมื่อจบ เหลือแค่ไฟล์ใน /work ให้ตรวจ (ทำลาย = ลบโฟลเดอร์)
"ปลด" ไม่ได้รันโค้ดบนเครื่องจริงให้ — แค่ย้ายผลไปที่ released/ บอสเป็นคนตัดสินใจเอาไปใช้ต่อเอง
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("mark55.ultron")

DEFAULT_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT = 120
#: ขนาดโค้ดสูงสุด — ตรงกับ payload 16 KB ของ mobile_submit_task (sql/004_ultron.sql)
MAX_CODE_BYTES = 12_000
#: stdout / stderr ที่ส่งกลับมือถือ (ท้ายสุด) — result ทั้งก้อนต้องไม่เกิน 4 KB
MAX_OUTPUT_CHARS = 1200
MAX_LISTED_FILES = 20

LANGUAGES: dict[str, tuple[str, list[str]]] = {
    "python": ("main.py", ["python", "main.py"]),
    "bash": ("main.sh", ["sh", "main.sh"]),
}

_ID_RE = re.compile(r"^[0-9a-f]{8}$")
_PREFIX_RE = re.compile(r"^[0-9a-f]{4,8}$")
LATEST = "latest"

Runner = Callable[..., subprocess.CompletedProcess[str]]


class SandboxError(Exception):
    """ข้อผิดพลาดที่บอกบอสได้ตรง ๆ (ภาษาไทย) — handler แปลงเป็นผล FAILED"""


def _tail(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    return text if len(text) <= limit else "…" + text[-limit:]


class UltronSandbox:
    def __init__(
        self,
        root: str | Path,
        image: str = DEFAULT_IMAGE,
        timeout: int = DEFAULT_TIMEOUT,
        memory: str = "512m",
        cpus: str = "1",
        docker: str = "docker",
        runner: Runner = subprocess.run,
    ) -> None:
        self.root = Path(root)
        self.pending = self.root / "pending"
        self.released = self.root / "released"
        self.image = image
        self.timeout = timeout
        self.memory = memory
        self.cpus = cpus
        self.docker = docker
        self._run = runner

    # ─── รัน ────────────────────────────────────────────────────────

    def run(self, sandbox_id: str, code: str, language: str = "python", task: str = "") -> dict[str, Any]:
        """รันโค้ดใน container ใหม่ · คืนผล (exit code, stdout/stderr ท้าย ๆ, ไฟล์ที่เกิดขึ้น)"""
        if not _ID_RE.match(sandbox_id):
            raise SandboxError(f"รหัส sandbox ไม่ถูกต้อง: {sandbox_id!r}")
        if language not in LANGUAGES:
            raise SandboxError(f"ยังไม่รองรับภาษา {language!r} (ได้: {', '.join(LANGUAGES)})")
        if not code.strip():
            raise SandboxError("ไม่มีโค้ดให้รัน")
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            raise SandboxError(f"โค้ดยาวเกิน {MAX_CODE_BYTES // 1000} KB")

        work = self.pending / sandbox_id
        if work.exists() or (self.released / sandbox_id).exists():
            raise SandboxError(f"sandbox {sandbox_id} มีอยู่แล้ว")
        work.mkdir(parents=True)
        # container รันเป็น nobody → ต้องเขียน /work ได้ (Windows ไม่สนบิตนี้ — Docker Desktop จัดการเอง)
        os.chmod(work, 0o777)
        filename, command = LANGUAGES[language]
        (work / filename).write_text(code, encoding="utf-8")
        before = {p.name for p in work.iterdir()}
        meta: dict[str, Any] = {
            "sandbox_id": sandbox_id,
            "task": task[:500],
            "language": language,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "pending",
        }

        name = f"ultron-{sandbox_id}"
        cmd = [
            self.docker, "run", "--rm", "--name", name,
            "--network", "none",
            "--memory", self.memory, "--cpus", self.cpus, "--pids-limit", "128",
            "--read-only", "--tmpfs", "/tmp:size=64m",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--user", "65534:65534",
            "-v", f"{work.resolve()}:/work", "-w", "/work",
            self.image, "timeout", str(self.timeout), *command,
        ]  # fmt: skip
        timed_out = False
        try:
            # เผื่อเวลา pull image / เริ่ม container นอกเหนือจาก timeout ในตัว container
            proc = self._run(cmd, capture_output=True, text=True, timeout=self.timeout + 60)
            exit_code, stdout, stderr = proc.returncode, proc.stdout or "", proc.stderr or ""
        except subprocess.TimeoutExpired as ex:
            timed_out = True
            self._run([self.docker, "rm", "-f", name], capture_output=True, text=True, timeout=30)
            exit_code, stdout, stderr = 124, _as_text(ex.stdout), _as_text(ex.stderr)
        except FileNotFoundError:
            shutil.rmtree(work, ignore_errors=True)
            raise SandboxError("ไม่พบ Docker บน Mark 55 — ติดตั้ง Docker Desktop แล้วเปิดไว้") from None
        # `timeout` ในตัว container คืน 124 เมื่อครบเวลา
        timed_out = timed_out or exit_code == 124

        files = sorted(p.name for p in work.iterdir() if p.name not in before and p.name != "meta.json")
        result: dict[str, Any] = {
            "sandbox_id": sandbox_id,
            "exit_code": exit_code,
            "timed_out": timed_out,
            "stdout": _tail(stdout),
            "stderr": _tail(stderr),
            "files": files[:MAX_LISTED_FILES],
        }
        meta["result"] = result
        self._write_meta(work, meta)
        logger.info("ultron sandbox %s จบ exit=%s timed_out=%s", sandbox_id, exit_code, timed_out)
        return result

    # ─── ปลด / ทำลาย ────────────────────────────────────────────────

    def release(self, ref: str = LATEST) -> dict[str, Any]:
        """ย้ายผลไป released/<id> — ไม่ได้รันอะไรบนเครื่องจริง"""
        sandbox_id = self.resolve(ref)
        target = self.released / sandbox_id
        self.released.mkdir(parents=True, exist_ok=True)
        shutil.move(str(self.pending / sandbox_id), str(target))
        meta = self._read_meta(target)
        meta["status"] = "released"
        meta["released_at"] = datetime.now(timezone.utc).isoformat()
        self._write_meta(target, meta)
        return {"sandbox_id": sandbox_id, "path": str(target.resolve())}

    def destroy(self, ref: str = LATEST) -> dict[str, Any]:
        """ลบ sandbox ทิ้งทั้งหมด (container ที่อาจค้าง + ไฟล์)"""
        sandbox_id = self.resolve(ref)
        try:
            self._run([self.docker, "rm", "-f", f"ultron-{sandbox_id}"], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            logger.warning("ลบ container ultron-%s ไม่สำเร็จ — ลบไฟล์ต่อ", sandbox_id)
        shutil.rmtree(self.pending / sandbox_id)
        return {"sandbox_id": sandbox_id}

    def list_pending(self) -> list[dict[str, Any]]:
        """sandbox ที่รอบอสตัดสิน — ใหม่สุดก่อน"""
        if not self.pending.is_dir():
            return []
        metas = [self._read_meta(p) for p in self.pending.iterdir() if p.is_dir()]
        return sorted(metas, key=lambda m: m.get("created_at", ""), reverse=True)

    def resolve(self, ref: str | None) -> str:
        """"latest"/ว่าง = ตัวล่าสุดที่รออยู่ · รหัสเต็มหรือ 4 ตัวแรกขึ้นไปก็ได้ (พูดรหัสยาวด้วยเสียงลำบาก)"""
        ref = (ref or LATEST).strip().lower()
        pending = self.list_pending()
        if not pending:
            raise SandboxError("ไม่มี sandbox ที่รอให้ปลด/ทำลาย")
        if ref == LATEST:
            return str(pending[0]["sandbox_id"])
        if not _PREFIX_RE.match(ref):
            raise SandboxError(f"รหัส sandbox ไม่ถูกต้อง: {ref!r}")
        matches = [str(m["sandbox_id"]) for m in pending if str(m.get("sandbox_id", "")).startswith(ref)]
        if not matches:
            raise SandboxError(f"ไม่พบ sandbox {ref} ที่รออยู่")
        if len(matches) > 1:
            raise SandboxError(f"รหัส {ref} ตรงหลายตัว ({', '.join(matches)}) — ใส่ให้ยาวขึ้น")
        return matches[0]

    # ─── ไฟล์ meta ──────────────────────────────────────────────────

    @staticmethod
    def _read_meta(work: Path) -> dict[str, Any]:
        try:
            data = json.loads((work / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        data.setdefault("sandbox_id", work.name)
        return data

    @staticmethod
    def _write_meta(work: Path, meta: dict[str, Any]) -> None:
        (work / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _as_text(value: bytes | str | None) -> str:
    if value is None:
        return ""
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else value
