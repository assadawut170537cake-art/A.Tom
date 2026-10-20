"""NotebookLM Enterprise — มือถือส่งลิงก์/ข้อความเข้า notebook ผ่าน Mark 55 (Boss เลือกทาง A · 2026-10-20)

ทำไมผ่าน PC: API ของ NotebookLM Enterprise ไม่รับ API key — ต้องใช้ OAuth access token (อายุ ~1 ชม.)
PC มี `gcloud auth login` อยู่แล้ว → ขอ token สดทุกครั้งด้วย `gcloud auth print-access-token`
มือถือไม่ต้องเก็บ token / ไม่ต้องเพิ่มไลบรารีล็อกอิน Google

instruction `NOTEBOOKLM_ADD` payload:
    { "sources": [ {"type": "url"|"youtube"|"text", "value": "...", "name": "..."} ],
      "title": "<ชื่อ notebook ใหม่>"  (ไม่ใส่ = ใช้ notebook เดิม/ค่าเริ่มต้น) }

ตั้งค่าใน mark55/.env:
    NOTEBOOKLM_PROJECT   = project id หรือ project number ของ Google Cloud (id → แปลงเป็นเลขด้วย gcloud ให้เอง)
    NOTEBOOKLM_LOCATION  = global | us | eu   (ค่าเริ่มต้น global)
    NOTEBOOKLM_NOTEBOOK_ID = (ไม่บังคับ) notebook ที่จะใส่เป็นค่าเริ่มต้น — ไม่ตั้ง = สร้างใหม่ครั้งแรกแล้วจำไว้

⚠️ API เป็น v1alpha — Google เปลี่ยนชื่อ field ได้ · แก้ที่ `NotebookLM._post()` / body ใน `add()` ที่เดียว
"""

from __future__ import annotations

import json
import logging
import subprocess
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

logger = logging.getLogger("mark55.notebooklm")

LOCATIONS = ("global", "us", "eu")
SOURCE_TYPES = ("url", "youtube", "text")
#: ต่อครั้ง — กันมือถือส่งมารัว ๆ (API ก็จำกัดจำนวน source ต่อ notebook)
MAX_SOURCES = 20
MAX_TEXT_CHARS = 100_000

#: (args) -> stdout — แทนได้ใน test
RunCommand = Callable[[list[str]], str]
#: (method, url, token, body) -> dict
HttpCall = Callable[[str, str, str, dict[str, Any] | None], dict[str, Any]]


class NotebookLMError(Exception):
    """ข้อความไทยที่ส่งกลับมือถือได้ตรง ๆ"""


def _run(args: list[str]) -> str:
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=30, check=True)
    except FileNotFoundError as ex:
        raise NotebookLMError("ไม่พบ gcloud บน PC — ติดตั้ง Google Cloud CLI แล้ว `gcloud auth login`") from ex
    except subprocess.CalledProcessError as ex:
        raise NotebookLMError(f"gcloud ล้ม: {(ex.stderr or '').strip()[:200] or ex}") from ex
    except subprocess.TimeoutExpired as ex:
        raise NotebookLMError("gcloud ไม่ตอบภายใน 30 วินาที") from ex
    return out.stdout.strip()


def _http(method: str, url: str, token: str, body: dict[str, Any] | None) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode() or "{}"
    except urllib.error.HTTPError as ex:
        detail = ex.read().decode(errors="replace")[:300]
        if ex.code in (401, 403):
            raise NotebookLMError(
                f"NotebookLM ไม่ให้สิทธิ์ (HTTP {ex.code}) — เช็กว่าบัญชี gcloud มี role Cloud NotebookLM User "
                f"และเปิด API ในโปรเจกต์แล้ว · {detail}"
            ) from ex
        raise NotebookLMError(f"NotebookLM ตอบ HTTP {ex.code}: {detail}") from ex
    except urllib.error.URLError as ex:
        raise NotebookLMError(f"ต่อ NotebookLM ไม่ได้: {ex.reason}") from ex
    return json.loads(raw)


def to_user_content(source: dict[str, Any]) -> dict[str, Any]:
    """source จากมือถือ → userContents ของ API (หนึ่ง source ต่อหนึ่งรายการ)"""
    kind = source.get("type")
    value = str(source.get("value") or "").strip()
    name = str(source.get("name") or "").strip()
    if kind not in SOURCE_TYPES or not value:
        raise NotebookLMError(f"source ไม่ถูกต้อง: {json.dumps(source, ensure_ascii=False)[:120]}")
    if kind == "youtube":
        return {"videoContent": {"youtubeUrl": value}}
    if kind == "url":
        return {"webContent": {"url": value, "sourceName": name or value[:100]}}
    return {"textContent": {"sourceName": name or value[:40], "content": value[:MAX_TEXT_CHARS]}}


class NotebookLM:
    def __init__(
        self,
        project: str,
        location: str = "global",
        notebook_id: str = "",
        state_file: Path | None = None,
        run: RunCommand = _run,
        http: HttpCall = _http,
    ) -> None:
        if location not in LOCATIONS:
            raise NotebookLMError(f"NOTEBOOKLM_LOCATION ต้องเป็น {'/'.join(LOCATIONS)} (ได้ {location!r})")
        self.project, self.location = project.strip(), location
        self.default_notebook = notebook_id.strip()
        self.state_file = state_file
        self._run, self._http = run, http
        self._project_number = project if project.isdigit() else ""

    # ── การตั้งค่า ──
    def project_number(self) -> str:
        if not self.project:
            raise NotebookLMError("ยังไม่ได้ตั้ง NOTEBOOKLM_PROJECT ใน mark55/.env")
        if not self._project_number:
            # URL ของ API ต้องใช้ project "number" — บอสมักมีแต่ project id
            self._project_number = self._run(
                ["gcloud", "projects", "describe", self.project, "--format=value(projectNumber)"]
            )
            if not self._project_number.isdigit():
                raise NotebookLMError(f"หา project number ของ {self.project} ไม่ได้")
        return self._project_number

    def base_url(self) -> str:
        return (
            f"https://{self.location}-discoveryengine.googleapis.com/v1alpha/"
            f"projects/{self.project_number()}/locations/{self.location}"
        )

    def _token(self) -> str:
        return self._run(["gcloud", "auth", "print-access-token"])

    def _remembered(self) -> str:
        if self.state_file and self.state_file.is_file():
            try:
                return str(json.loads(self.state_file.read_text("utf-8")).get("notebook_id") or "")
            except (OSError, ValueError):
                logger.warning("อ่าน %s ไม่ได้ — สร้าง notebook ใหม่", self.state_file)
        return ""

    def _remember(self, notebook_id: str) -> None:
        if not self.state_file:
            return
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps({"notebook_id": notebook_id}), "utf-8")
        except OSError:
            logger.exception("จำ notebook ไม่ได้: %s", self.state_file)

    # ── งาน ──
    def create(self, token: str, title: str) -> str:
        res = self._http("POST", f"{self.base_url()}/notebooks", token, {"title": title})
        notebook_id = str(res.get("notebookId") or str(res.get("name", "")).rsplit("/", 1)[-1])
        if not notebook_id:
            raise NotebookLMError("สร้าง notebook แล้วแต่ไม่ได้รหัสกลับมา")
        return notebook_id

    def add(self, sources: list[dict[str, Any]], title: str = "") -> dict[str, Any]:
        if not sources:
            raise NotebookLMError("ไม่มีลิงก์หรือข้อความให้ใส่")
        if len(sources) > MAX_SOURCES:
            raise NotebookLMError(f"ใส่ได้ครั้งละไม่เกิน {MAX_SOURCES} รายการ")
        contents = [to_user_content(s) for s in sources]
        token = self._token()
        created = False
        notebook_id = "" if title else (self.default_notebook or self._remembered())
        if not notebook_id:
            notebook_id = self.create(token, title or f"A.T.O.M. — {date.today().isoformat()}")
            created = True
            if not title and not self.default_notebook:
                self._remember(notebook_id)
        res = self._http(
            "POST",
            f"{self.base_url()}/notebooks/{notebook_id}/sources:batchCreate",
            token,
            {"userContents": contents},
        )
        return {"notebook_id": notebook_id, "created": created, "added": len(res.get("sources") or contents)}


def describe_add(result: dict[str, Any]) -> str:
    where = "notebook ใหม่" if result.get("created") else "notebook"
    return f"📒 ใส่ {result['added']} รายการเข้า{where} {result['notebook_id']} แล้วครับ"


def make_notebooklm_handlers(nlm: NotebookLM | None) -> dict[str, Callable[[Any], dict[str, Any]]]:
    """`nlm = None` (ไม่ได้ตั้ง NOTEBOOKLM_PROJECT) → ยังลงทะเบียน แต่ตอบว่ายังไม่ได้ตั้งค่า (มือถือได้ข้อความไทย ไม่ค้าง)"""

    def add(task: Any) -> dict[str, Any]:
        if nlm is None:
            return {"status": "NOTEBOOKLM_ERROR", "error": "ยังไม่ได้ตั้ง NOTEBOOKLM_PROJECT ใน mark55/.env"}
        payload = task.payload or {}
        sources = payload.get("sources")
        try:
            if not isinstance(sources, list):
                raise NotebookLMError("payload.sources ต้องเป็นรายการ")
            result = nlm.add(sources, str(payload.get("title") or ""))
        except NotebookLMError as ex:
            return {"status": "NOTEBOOKLM_ERROR", "error": str(ex)}
        except Exception as ex:  # handler ห้าม raise (ดู handlers.py)
            logger.exception("NOTEBOOKLM_ADD ล้ม: task %s", task.task_id)
            return {"status": "NOTEBOOKLM_ERROR", "error": f"{type(ex).__name__}: {ex}"}
        return {"status": "ADDED", "message": describe_add(result), **result}

    return {"NOTEBOOKLM_ADD": add}
