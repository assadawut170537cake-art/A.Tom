"""REVERSE_ENGINEER — แกะ APK ด้วย REA แล้วคืน "ทางเข้า" ของแอป (ADR-016)

มือถือสั่ง `REVERSE_ENGINEER { "target": "<ชื่อแอป/พาธ apk>" }` ผ่าน Memory Bus → handler นี้:
  1. หา APK: ถ้า target เป็นพาธไฟล์ที่มีอยู่ ใช้เลย · ไม่งั้น adb (resolve → pull) หาแอปในมือถือ
  2. `rea inspect-android-package <apk> --format json` → อ่าน decoded manifest
  3. ดึง component ที่ exported + intent-filter เป็น "ประตู" (activity/service/receiver + deep link)

REA ไม่ได้อยู่ใน repo นี้ — ต้องลงบนเครื่อง Mark 55 เอง (ดู docs/REA_INTEGRATION.md / สกิล rea-setup)
handler ต้องไม่ raise ออกไป (เหมือน handler อื่น) — จับ error เองคืน dict ที่มี `status`
ผลที่ส่งกลับจะถูกบีบ/redact ก่อนเข้า prompt ของ persona ที่ฝั่งมือถือ (ADR-016 · CLAUDE.md §Security)
"""

from __future__ import annotations

import json
import logging
import os
import subprocess  # noqa: S404 — เรียก rea/adb ที่บอสลงเอง บนเครื่อง Mark 55
import tempfile
import xml.etree.ElementTree as ET
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

logger = logging.getLogger("mark55.reverse_engineer")

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"
EXPORTABLE_TAGS = ("activity", "activity-alias", "service", "receiver")
#: component คืนสูงสุดเท่านี้ (กัน payload บวม — มือถือสรุปต่อ)
MAX_DOORS = 40
#: รอ rea/adb นานสุดต่อคำสั่ง (JADX/apktool ช้า)
DEFAULT_TIMEOUT_S = 180

#: ผลการรันคำสั่งภายนอก (returncode + stdout) — ฉีดของปลอมใน test ได้
Runner = Callable[[Sequence[str], int], "subprocess.CompletedProcess[str]"]


class ReverseEngineerError(Exception):
    """แกะไม่สำเร็จแบบที่รู้สาเหตุ (คืนเป็นข้อความไทยให้บอส)"""


def _default_runner(args: Sequence[str], timeout_s: int) -> "subprocess.CompletedProcess[str]":
    # env เดิม (REA_JADX_MCP_JAR / REA_APKTOOL_COMMAND / REA_ADB_PATH) ส่งต่อให้ rea
    return subprocess.run(  # noqa: S603 — args เป็น list ไม่ผ่าน shell
        list(args),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
        env=os.environ.copy(),
    )


def _run_json(runner: Runner, args: Sequence[str], timeout_s: int) -> Any:
    """เรียก rea แล้ว parse JSON — ล้ม/JSON พัง = ReverseEngineerError"""
    try:
        proc = runner(args, timeout_s)
    except FileNotFoundError as ex:
        raise ReverseEngineerError(f"ไม่พบคำสั่ง {args[0]} บน Mark 55 (ยังไม่ได้ลง REA?)") from ex
    except subprocess.TimeoutExpired as ex:
        raise ReverseEngineerError("แกะนานเกินกำหนด (timeout)") from ex
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-300:]
        raise ReverseEngineerError(f"rea ตอบ error: {detail or f'exit {proc.returncode}'}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as ex:
        raise ReverseEngineerError("rea ไม่ได้คืน JSON ที่อ่านได้") from ex


def _attr(elem: ET.Element, name: str) -> str | None:
    return elem.get(ANDROID_NS + name)


def _deep_link(data: ET.Element) -> str | None:
    """<data scheme host pathPrefix> → ตัวอย่าง URI deep link (ถ้าประกอบได้)"""
    scheme = _attr(data, "scheme")
    if not scheme:
        return None
    host = _attr(data, "host")
    path = _attr(data, "pathPrefix") or _attr(data, "path") or _attr(data, "pathPattern") or ""
    return f"{scheme}://{host}{path}" if host else f"{scheme}://…"


def find_doors(manifest_xml: str, package: str | None = None) -> list[dict[str, Any]]:
    """อ่าน decoded AndroidManifest → รายการ "ทางเข้า" ที่สั่งจากภายนอกได้

    exported = android:exported="true" หรือมี <intent-filter> (ถือว่า exported โดยปริยาย)
    """
    root = ET.fromstring(manifest_xml)  # noqa: S314 — manifest จาก apktool ของเราเอง ไม่ใช่เน็ต
    pkg = package or root.get("package") or ""
    doors: list[dict[str, Any]] = []
    for app in root.iter("application"):
        for comp in app:
            if comp.tag not in EXPORTABLE_TAGS:
                continue
            filters = comp.findall("intent-filter")
            exported_attr = _attr(comp, "exported")
            is_exported = exported_attr == "true" or (exported_attr is None and bool(filters))
            if not is_exported:
                continue
            name = _attr(comp, "name") or "(ไม่ทราบชื่อ)"
            full = f"{pkg}/{name}" if name.startswith(".") else name
            # หา deep link ตัวแรกที่ประกอบได้ · ไม่งั้นเสนอเปิดด้วย component name
            link: str | None = None
            browsable = False
            for filt in filters:
                for cat in filt.findall("category"):
                    if _attr(cat, "name") == "android.intent.category.BROWSABLE":
                        browsable = True
                for data in filt.findall("data"):
                    link = link or _deep_link(data)
            open_hint = link if (link and browsable) else f"am start -n {full}"
            doors.append(
                {
                    "kind": comp.tag,
                    "name": name,
                    "exported": True,
                    "open": open_hint,
                }
            )
            if len(doors) >= MAX_DOORS:
                return doors
    return doors


def _resolve_apk(runner: Runner, target: str, workdir: Path, rea: str, adb_enabled: bool) -> str:
    """target → พาธ APK: ไฟล์ที่มีอยู่ใช้เลย · ไม่งั้นดึงจากมือถือด้วย adb"""
    candidate = Path(target)
    if candidate.suffix.lower() in (".apk", ".apks", ".xapk") and candidate.is_file():
        return str(candidate)
    if not adb_enabled:
        raise ReverseEngineerError(
            f"ไม่พบไฟล์ APK ตามพาธ '{target}' และปิดการดึงจากมือถือ (adb) ไว้"
        )
    matches = _run_json(runner, [rea, "resolve-adb-packages", target, "--format", "json"], 30)
    packages = _packages_of(matches)
    if not packages:
        raise ReverseEngineerError(f"หาแอปชื่อ '{target}' ในมือถือไม่เจอ (ต่อ adb ไว้หรือยัง?)")
    pkg = packages[0]
    out = workdir / "pulled"
    _run_json(runner, [rea, "pull-adb-package", pkg, str(out), "--format", "json"], DEFAULT_TIMEOUT_S)
    apks = sorted(out.rglob("*.apk"))
    base = next((a for a in apks if a.name == "base.apk"), apks[0] if apks else None)
    if base is None:
        raise ReverseEngineerError(f"ดึง APK ของ {pkg} ออกมาไม่ได้ (แอปอาจห้ามดึง)")
    return str(base)


def _packages_of(matches: Any) -> list[str]:
    """ดึงรายชื่อ package จากผล resolve-adb-packages (เผื่อรูปแบบ normalized ต่างกัน)"""
    node = matches.get("normalized_result", matches) if isinstance(matches, dict) else matches
    rows = node.get("packages", node) if isinstance(node, dict) else node
    if not isinstance(rows, list):
        return []
    out: list[str] = []
    for row in rows:
        if isinstance(row, str):
            out.append(row)
        elif isinstance(row, dict):
            name = row.get("package") or row.get("package_name") or row.get("name")
            if isinstance(name, str):
                out.append(name)
    return out


def analyze_target(
    target: str,
    *,
    runner: Runner | None = None,
    rea_command: str = "rea",
    adb_enabled: bool = True,
) -> dict[str, Any]:
    """แกะ target → {package, doors, evidence_id} หรือโยน ReverseEngineerError"""
    run = runner or _default_runner
    with tempfile.TemporaryDirectory(prefix="rea-") as tmp:
        apk = _resolve_apk(run, target, Path(tmp), rea_command, adb_enabled)
        result = _run_json(
            run,
            [rea_command, "inspect-android-package", apk, "--format", "json"],
            DEFAULT_TIMEOUT_S,
        )
    norm = result.get("normalized_result", {}) if isinstance(result, dict) else {}
    manifest = norm.get("manifest", {}) if isinstance(norm, dict) else {}
    text = manifest.get("text") if isinstance(manifest, dict) else None
    package = norm.get("package_name") if isinstance(norm, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise ReverseEngineerError("rea ไม่ได้คืน manifest ที่อ่านได้")
    doors = find_doors(text, package if isinstance(package, str) else None)
    return {
        "package": package,
        "doors": doors,
        "evidence_id": result.get("evidence_id") if isinstance(result, dict) else None,
    }


def make_rea_handler(
    runner: Runner | None = None,
    rea_command: str | None = None,
    adb_enabled: bool = True,
) -> Callable[[Any], dict[str, Any]]:
    """สร้าง handler REVERSE_ENGINEER — ไม่ raise ออกไป (คืน dict เสมอ)"""
    command = rea_command or os.environ.get("REA_COMMAND", "rea")

    def handler(task: Any) -> dict[str, Any]:
        target = str(task.payload.get("target", "")).strip()
        if not target:
            return {"status": "RE_ERROR", "error": "ไม่ได้บอกว่าจะแกะแอปไหน"}
        try:
            logger.info("REVERSE_ENGINEER: task %s target=%s", task.task_id, target)
            out = analyze_target(
                target, runner=runner, rea_command=command, adb_enabled=adb_enabled
            )
            return {"status": "OK", **out}
        except ReverseEngineerError as ex:
            return {"status": "RE_ERROR", "error": str(ex)}
        except Exception as ex:  # กันหลุด — handler ห้าม raise
            logger.exception("REVERSE_ENGINEER ล้มเหลว: task %s", task.task_id)
            return {"status": "RE_ERROR", "error": f"{type(ex).__name__}: {ex}"}

    return handler
