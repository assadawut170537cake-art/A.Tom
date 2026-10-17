import threading
import unittest

from memory_bus import MemoryTask, MemoryWatcher, TaskStatus
from supermemory_gateway import SupermemoryGateway

NODE = "MARK_55_PC"


def make_task(instruction="RUN_DIAGNOSTICS", target=NODE, **kwargs):
    return MemoryTask(instruction=instruction, sender="A.T.O.M._MOBILE", target=target, **kwargs)


class FakeHttp:
    """แทน HTTP จริง — test ห้ามยิงเน็ต"""

    def __init__(self, status=200, error=None):
        self.calls = []
        self.status = status
        self.error = error

    def __call__(self, url, body, headers, timeout):
        self.calls.append((url, body, headers))
        if self.error:
            raise self.error
        return self.status


class TestMemoryTask(unittest.TestCase):
    def test_round_trip(self):
        task = make_task(payload={"flags": ["--clean"]})
        clone = MemoryTask.from_dict(task.to_dict())
        self.assertEqual(clone.to_dict(), task.to_dict())
        self.assertEqual(task.to_dict()["containerTag"], "atom_core")
        self.assertTrue(task.task_id.startswith("task_"))

    def test_rejects_unknown_status(self):
        with self.assertRaises(ValueError):
            MemoryTask.from_dict({"status": "DONE"})


class TestGateway(unittest.TestCase):
    def setUp(self):
        self.gateway = SupermemoryGateway()

    def test_lifecycle_success(self):
        task = make_task(payload={"module": "power_grid"})
        self.gateway.push_task(task)

        pending = self.gateway.fetch_pending_tasks(NODE)
        self.assertEqual([t.task_id for t in pending], [task.task_id])

        self.assertTrue(self.gateway.try_claim_task(task.task_id, NODE))
        self.assertFalse(self.gateway.try_claim_task(task.task_id, "SECONDARY_NODE"))
        self.assertEqual(self.gateway.fetch_pending_tasks(NODE), [])

        self.assertTrue(self.gateway.complete_task(task.task_id, NODE, {"status": "HEALTHY"}))
        stored = self.gateway.get_task(task.task_id)
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.claimed_by, NODE)
        self.assertEqual(stored.result, {"status": "HEALTHY"})

    def test_fetch_filters_target_and_includes_broadcast(self):
        mine, broadcast, other = make_task(), make_task(target="ALL"), make_task(target="J.A.R.V.I.S.")
        for t in (mine, broadcast, other):
            self.gateway.push_task(t)
        ids = {t.task_id for t in self.gateway.fetch_pending_tasks(NODE)}
        self.assertEqual(ids, {mine.task_id, broadcast.task_id})

    def test_fetch_ignores_other_container(self):
        foreign = SupermemoryGateway(container_tag="other", store=self.gateway.store)
        foreign.push_task(make_task())
        self.assertEqual(self.gateway.fetch_pending_tasks(NODE), [])

    def test_only_claimant_can_finish(self):
        task = make_task()
        self.gateway.push_task(task)
        # ยังไม่มีใคร claim → จบงานไม่ได้
        self.assertFalse(self.gateway.complete_task(task.task_id, NODE, {}))
        self.gateway.try_claim_task(task.task_id, NODE)
        self.assertFalse(self.gateway.fail_task(task.task_id, "INTRUDER", {}))
        self.assertTrue(self.gateway.fail_task(task.task_id, NODE, {"error": "x"}))
        # จบแล้วจบเลย ไม่เปลี่ยนสถานะซ้ำ
        self.assertFalse(self.gateway.complete_task(task.task_id, NODE, {}))
        self.assertEqual(self.gateway.get_task(task.task_id).status, TaskStatus.FAILED)

    def test_unknown_task(self):
        self.assertFalse(self.gateway.try_claim_task("task_missing", NODE))
        self.assertIsNone(self.gateway.get_task("task_missing"))

    def test_concurrent_claims_have_one_winner(self):
        task = make_task()
        self.gateway.push_task(task)
        wins = []
        barrier = threading.Barrier(16)

        def contend(i):
            barrier.wait()
            if self.gateway.try_claim_task(task.task_id, f"NODE_{i}"):
                wins.append(i)

        threads = [threading.Thread(target=contend, args=(i,)) for i in range(16)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(wins), 1)
        self.assertEqual(self.gateway.get_task(task.task_id).claimed_by, f"NODE_{wins[0]}")


class TestRemoteMirror(unittest.TestCase):
    def test_local_only_without_config(self):
        http = FakeHttp()
        gateway = SupermemoryGateway(http_post=http)
        gateway.push_task(make_task())
        self.assertFalse(gateway.remote_enabled)
        self.assertEqual(http.calls, [])

    def test_mirrors_each_transition(self):
        http = FakeHttp()
        gateway = SupermemoryGateway("https://example.invalid/", "test_key", http_post=http)
        task = make_task()
        gateway.push_task(task)
        gateway.try_claim_task(task.task_id, NODE)
        gateway.complete_task(task.task_id, NODE, {"ok": True})

        self.assertEqual([body["content"]["status"] for _, body, _ in http.calls],
                         ["PENDING", "IN_PROGRESS", "COMPLETED"])
        url, body, headers = http.calls[0]
        self.assertEqual(url, "https://example.invalid/v4/memories/store")
        self.assertEqual(body["tag"], "atom_core")
        self.assertEqual(headers["Authorization"], "Bearer test_key")

    def test_remote_failure_keeps_local_task(self):
        for http in (FakeHttp(error=OSError("offline")), FakeHttp(status=500)):
            gateway = SupermemoryGateway("https://example.invalid", "test_key", http_post=http)
            task = make_task()
            with self.assertLogs("SupermemoryGateway", "WARNING") as logs:
                self.assertTrue(gateway.push_task(task))
            self.assertNotIn("test_key", "".join(logs.output))
            self.assertEqual([t.task_id for t in gateway.fetch_pending_tasks(NODE)], [task.task_id])


class TestWatcher(unittest.TestCase):
    def setUp(self):
        self.gateway = SupermemoryGateway()
        self.watcher = MemoryWatcher(self.gateway, NODE, poll_interval=0.01)

    def test_dispatch_completes_task(self):
        executed = []

        def handler(task):
            executed.append(task.task_id)
            return {"status": "SUCCESS"}

        self.watcher.register_handler("EXECUTE_BUILD", handler)
        task = make_task("EXECUTE_BUILD")
        self.gateway.push_task(task)
        self.watcher._poll_and_process()

        self.assertEqual(executed, [task.task_id])
        stored = self.gateway.get_task(task.task_id)
        self.assertEqual(stored.status, TaskStatus.COMPLETED)
        self.assertEqual(stored.result, {"status": "SUCCESS"})

        # poll รอบสองต้องไม่รันซ้ำ
        self.watcher._poll_and_process()
        self.assertEqual(executed, [task.task_id])

    def test_missing_handler_fails_task(self):
        task = make_task("UNKNOWN")
        self.gateway.push_task(task)
        self.watcher._poll_and_process()
        stored = self.gateway.get_task(task.task_id)
        self.assertEqual(stored.status, TaskStatus.FAILED)
        self.assertIn("UNKNOWN", stored.result["error"])

    def test_handler_exception_fails_task(self):
        def boom(task):
            raise RuntimeError("disk full")

        self.watcher.register_handler("EXECUTE_BUILD", boom)
        task = make_task("EXECUTE_BUILD")
        self.gateway.push_task(task)
        with self.assertLogs("MemoryBus", "ERROR"):
            self.watcher._poll_and_process()
        stored = self.gateway.get_task(task.task_id)
        self.assertEqual(stored.status, TaskStatus.FAILED)
        self.assertEqual(stored.result, {"exception": "disk full"})

    def test_skips_task_claimed_by_another_node(self):
        executed = []
        self.watcher.register_handler("EXECUTE_BUILD", lambda t: executed.append(t) or {})
        task = make_task("EXECUTE_BUILD")
        self.gateway.push_task(task)
        pending = self.gateway.fetch_pending_tasks(NODE)
        self.gateway.try_claim_task(task.task_id, "OTHER_PC")
        # จำลองว่า watcher อ่านรายการมาก่อนที่อีกเครื่องจะ claim
        self.gateway.fetch_pending_tasks = lambda node: pending
        self.watcher._poll_and_process()
        self.assertEqual(executed, [])
        self.assertEqual(self.gateway.get_task(task.task_id).claimed_by, "OTHER_PC")

    def test_start_runs_until_stop(self):
        done = threading.Event()

        def handler(task):
            done.set()
            return {}

        self.watcher.register_handler("EXECUTE_BUILD", handler)
        self.gateway.push_task(make_task("EXECUTE_BUILD"))
        thread = threading.Thread(target=self.watcher.start)
        thread.start()
        self.assertTrue(done.wait(2))
        self.watcher.stop()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertFalse(self.watcher.is_running)


if __name__ == "__main__":
    unittest.main()
