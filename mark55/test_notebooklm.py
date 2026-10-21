"""unittest ของ NotebookLM — gcloud / HTTP ปลอมทั้งหมด (ไม่ยิงเน็ต)

รัน: `python -m unittest mark55.test_notebooklm` (ที่ root ของ repo)
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

try:
    from .memory_bus import MemoryTask
    from .notebooklm import NotebookLM, NotebookLMError, make_notebooklm_handlers, to_user_content
except ImportError:
    from memory_bus import MemoryTask
    from notebooklm import NotebookLM, NotebookLMError, make_notebooklm_handlers, to_user_content


def fake_run(args: list[str]) -> str:
    if args[:3] == ["gcloud", "projects", "describe"]:
        return "123456789"
    if args[:3] == ["gcloud", "auth", "print-access-token"]:
        return "tok"
    raise AssertionError(args)


class FakeHttp:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, token, body):
        assert token == "tok"
        self.calls.append((method, url, body))
        if url.endswith("/notebooks"):
            return {"notebookId": "nb1", "name": "projects/123456789/locations/global/notebooks/nb1"}
        return {"sources": [{"sourceId": {"id": "s"}} for _ in body["userContents"]]}


class NotebookLMTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "nlm.json"
        self.http = FakeHttp()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def nlm(self, notebook_id: str = "") -> NotebookLM:
        return NotebookLM("gen-lang-client-0240578036", "global", notebook_id, self.state, fake_run, self.http)

    def test_url_ใช้_project_number_และ_host_ตาม_location(self) -> None:
        self.assertEqual(
            self.nlm().base_url(),
            "https://global-discoveryengine.googleapis.com/v1alpha/projects/123456789/locations/global",
        )

    def test_ครั้งแรกสร้าง_notebook_แล้วจำ_ครั้งต่อไปใช้เดิม(self) -> None:
        first = self.nlm().add([{"type": "url", "value": "https://example.com"}])
        self.assertEqual(first, {"notebook_id": "nb1", "created": True, "added": 1})
        second = self.nlm().add([{"type": "text", "value": "โน้ต"}])
        self.assertFalse(second["created"])
        self.assertTrue(self.http.calls[-1][1].endswith("/notebooks/nb1/sources:batchCreate"))
        self.assertEqual(sum(1 for c in self.http.calls if c[1].endswith("/notebooks")), 1)

    def test_ใส่ชื่อ_title_สร้างใหม่เสมอ_ไม่ทับที่จำไว้(self) -> None:
        self.nlm("fixed").add([{"type": "url", "value": "https://a.b"}], title="วิจัย AI")
        self.assertEqual(self.http.calls[0][2], {"title": "วิจัย AI"})
        self.assertFalse(self.state.exists())

    def test_แปลง_source_ทุกชนิด(self) -> None:
        self.assertEqual(to_user_content({"type": "youtube", "value": "https://youtu.be/x"}),
                         {"videoContent": {"youtubeUrl": "https://youtu.be/x"}})
        self.assertIn("webContent", to_user_content({"type": "url", "value": "https://a.b"}))
        self.assertEqual(to_user_content({"type": "text", "value": "abc", "name": "n"}),
                         {"textContent": {"sourceName": "n", "content": "abc"}})
        with self.assertRaises(NotebookLMError):
            to_user_content({"type": "file", "value": "x"})

    def test_handler_ไม่ตั้งค่า_หรือ_payload_ผิด_ตอบไทย_ไม่_raise(self) -> None:
        task = MemoryTask("NOTEBOOKLM_ADD", "MOBILE:p", "MARK_55_PC", {"sources": "x"})
        self.assertEqual(make_notebooklm_handlers(None)["NOTEBOOKLM_ADD"](task)["status"], "NOTEBOOKLM_ERROR")
        self.assertEqual(make_notebooklm_handlers(self.nlm())["NOTEBOOKLM_ADD"](task)["status"], "NOTEBOOKLM_ERROR")
        ok = MemoryTask("NOTEBOOKLM_ADD", "MOBILE:p", "MARK_55_PC", {"sources": [{"type": "url", "value": "https://a.b"}]})
        res = make_notebooklm_handlers(self.nlm())["NOTEBOOKLM_ADD"](ok)
        self.assertEqual(res["status"], "ADDED")
        self.assertIn("📒", res["message"])

    def test_location_ผิด(self) -> None:
        with self.assertRaises(NotebookLMError):
            NotebookLM("1", "asia")


if __name__ == "__main__":
    unittest.main()
