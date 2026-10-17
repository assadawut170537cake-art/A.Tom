"""Gateway ระหว่าง watcher กับ blackboard + mirror ขึ้น Supermemory (ถ้าตั้งค่าไว้)

ที่มาของความจริงคือ store (ค่าเริ่มต้น InMemoryTaskStore) เสมอ — ทุก fetch / claim / finish อ่านเขียนที่ store
Supermemory ใช้เป็น mirror แบบ best-effort เท่านั้น เพราะ API ของมันไม่มี conditional update
จึงทำ claim แบบ atomic ข้ามเครื่องผ่าน Supermemory ไม่ได้
"""

import json
import logging
import os
import urllib.request
from typing import Any, Callable, Dict, List, Optional

from memory_bus import InMemoryTaskStore, MemoryTask, TaskStatus

logger = logging.getLogger("SupermemoryGateway")

# (url, body, headers, timeout) → HTTP status · แยกออกมาให้ test ใส่ตัวปลอมได้โดยไม่ยิงเน็ตจริง
HttpPost = Callable[[str, Dict[str, Any], Dict[str, str], float], int]

# TODO(memory-bus): ยังไม่ได้ตรวจกับเอกสาร Supermemory จริง — ยืนยัน path + รูป body ก่อนเปิดใช้
DEFAULT_STORE_PATH = "/v4/memories/store"


def _urllib_post(url: str, body: Dict[str, Any], headers: Dict[str, str], timeout: float) -> int:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status


class SupermemoryGateway:
    def __init__(
        self,
        api_base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        container_tag: str = "atom_core",
        store: Optional[InMemoryTaskStore] = None,
        http_post: HttpPost = _urllib_post,
        store_path: str = DEFAULT_STORE_PATH,
        timeout: float = 5.0,
    ):
        # ไม่มี URL หรือ key = ทำงานในเครื่องอย่างเดียว ไม่แตะเน็ต
        self.api_base_url = api_base_url.rstrip("/") if api_base_url else None
        self._api_key = api_key or os.environ.get("SUPERMEMORY_API_KEY")
        self.container_tag = container_tag
        self.store = store or InMemoryTaskStore()
        self._http_post = http_post
        self._store_path = store_path
        self._timeout = timeout

    @property
    def remote_enabled(self) -> bool:
        return bool(self.api_base_url and self._api_key)

    def push_task(self, task: MemoryTask) -> bool:
        # task ที่ tag ไม่ตรงจะไม่มีใครใน namespace นี้เห็น — บังคับให้ตรงกับ gateway
        task.container_tag = self.container_tag
        self.store.put(task)
        self._mirror(task)
        return True

    def get_task(self, task_id: str) -> Optional[MemoryTask]:
        return self.store.get(task_id)

    def fetch_pending_tasks(self, target_node_id: str) -> List[MemoryTask]:
        return self.store.find_pending(target_node_id, self.container_tag)

    def try_claim_task(self, task_id: str, node_id: str) -> bool:
        claimed = self.store.claim(task_id, node_id)
        if claimed:
            self._mirror_by_id(task_id)
        return claimed

    def complete_task(self, task_id: str, node_id: str, result_data: Dict[str, Any]) -> bool:
        return self._finish(task_id, node_id, TaskStatus.COMPLETED, result_data)

    def fail_task(self, task_id: str, node_id: str, error_data: Dict[str, Any]) -> bool:
        return self._finish(task_id, node_id, TaskStatus.FAILED, error_data)

    def _finish(self, task_id: str, node_id: str, status: TaskStatus, result: Dict[str, Any]) -> bool:
        finished = self.store.finish(task_id, node_id, status, result)
        if finished:
            self._mirror_by_id(task_id)
        else:
            logger.warning("Rejected %s for task %s by %s (not its claim)", status.value, task_id, node_id)
        return finished

    def _mirror_by_id(self, task_id: str) -> None:
        task = self.store.get(task_id)
        if task:
            self._mirror(task)

    def _mirror(self, task: MemoryTask) -> None:
        if not self.remote_enabled:
            return
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        body = {"tag": self.container_tag, "content": task.to_dict()}
        try:
            status = self._http_post(f"{self.api_base_url}{self._store_path}", body, headers, self._timeout)
        except Exception as e:
            # ห้าม log headers — มี API key
            logger.warning("Supermemory mirror failed for %s: %s", task.task_id, type(e).__name__)
            return
        if status not in (200, 201):
            logger.warning("Supermemory mirror rejected %s (HTTP %s)", task.task_id, status)
