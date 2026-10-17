# Mark 55 — Memory Bus (Phase 4.5.5.1)

## 1. ภาพรวม

Memory Bus คือ blackboard สำหรับส่งงานให้ Mark 55 ทำ โดยไม่ต้องต่อเครื่องกันตรง ๆ
ฝั่งสั่งงาน push `MemoryTask` → watcher บน Mark 55 poll หา task ของตัวเอง → claim (กันรันซ้ำ) → รัน handler → บันทึกผล `COMPLETED` / `FAILED`

```
PENDING ──claim──▶ IN_PROGRESS ──handler สำเร็จ──▶ COMPLETED
   │                     └──handler ล้ม / ไม่มี handler──▶ FAILED
   └── claim แพ้ (node อื่นได้ไปก่อน) → ข้าม ไม่รัน
```

**4.5.5.1 = mock mode:** task เก็บในหน่วยความจำของโปรเซส `main.py` เท่านั้น
watcher รัน/หยุดได้จริง แต่โปรเซสอื่นหรือมือถือยังส่ง task เข้ามาไม่ได้ — การซิงก์ข้ามเครื่องคือ 4.5.5.2

- Python ≥ 3.10 · stdlib เท่านั้น (ไม่ต้อง `pip install`)

## 2. โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `main.py` | entrypoint — argparse · ตั้ง logging · จับ Ctrl+C / SIGTERM แล้วปิดอย่างนุ่มนวล |
| `config.py` | ค่าตั้งต้น (อ่าน env ก่อน) |
| `memory_bus.py` | `TaskStatus` · `MemoryTask` (schema + to/from dict) · `MemoryWatcher` (poll loop) |
| `supermemory_gateway.py` | blackboard แบบ mock · ทุก operation อยู่ใต้ `threading.Lock` · claim แบบ compare-and-set |
| `handlers.py` | `HANDLER_REGISTRY` — instruction → handler ที่ main.py ลงทะเบียน |
| `test_memory_bus.py` | unittest 8 ตัว |
| `__init__.py` | version |
| `requirements.txt` | ว่าง (stdlib only) |

## 3. วิธีรัน

```bash
cd mark55
python main.py
```

รันจาก root ของ repo ได้เหมือนกัน: `python mark55/main.py` หรือ `python -m mark55.main`

```
[INFO] mark55.memory_bus: เริ่ม Memory Bus
[INFO] mark55.memory_bus: Node ID = MARK_55_PC
[INFO] mark55.memory_bus: Container tag = atom_core
[INFO] mark55.memory_bus: Poll interval = 2.0s
[INFO] mark55.memory_bus: Mode = mock (เก็บ task ในโปรเซสนี้)
[INFO] mark55.memory_bus: Handlers = ['EXECUTE_BUILD', 'RUN_DIAGNOSTICS']
[INFO] mark55.memory_bus: Watcher เริ่มทำงานสำหรับ node [MARK_55_PC]
```

หยุด: **Ctrl+C** (หรือ `kill <pid>` = SIGTERM) — งานที่กำลังรันจะรันจนจบก่อน แล้วขึ้น `ปิดระบบเรียบร้อย`

| exit code | ความหมาย |
|---|---|
| 0 | ปิดปกติ |
| 1 | เริ่มระบบไม่ได้ / watcher ล้มกลางทาง (ดู log) |
| 2 | argument ผิด |

Argument (ทับค่าจาก env): `--node-id` · `--poll-interval` · `--log-level` — ดูทั้งหมดด้วย `python main.py --help`

## 4. Environment variables

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `MARK55_NODE_ID` | `MARK_55_PC` | รับ task ที่ `target` ตรงกับค่านี้ หรือ `ALL` |
| `MARK55_CONTAINER_TAG` | `atom_core` | namespace — เห็นเฉพาะ task ใน tag เดียวกัน |
| `MARK55_POLL_INTERVAL` | `2.0` | วินาที · ต้อง > 0 (ค่าผิด → เตือนแล้วใช้ค่าเริ่มต้น) |
| `MARK55_LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` |

```bash
MARK55_NODE_ID=J.A.R.V.I.S. MARK55_LOG_LEVEL=DEBUG python main.py
```

## 5. วิธีเพิ่ม handler

แก้ `handlers.py`:

```python
def handle_my_job(task: MemoryTask) -> dict[str, Any]:
    """MY_JOB — อธิบายว่าทำอะไร"""
    try:
        ...  # อ่านค่าจาก task.payload
        return {"status": "OK", "task_id": task.task_id}
    except Exception as ex:
        logger.exception("MY_JOB ล้มเหลว: task %s", task.task_id)
        return {"status": "ERROR", "task_id": task.task_id, "error": str(ex)}


HANDLER_REGISTRY = {
    ...,
    "MY_JOB": handle_my_job,
}
```

- handler คืน `dict` ที่ serialize เป็น JSON ได้ → เก็บเป็น `result` ของ task (`COMPLETED`)
- จับ error เองแล้วคืนผลที่บอกสถานะ — ถ้า raise หลุดออกมา watcher จะบันทึก `FAILED` + ข้อความ exception แล้วทำงานต่อ
- handler รันใน thread ของ watcher ทีละงาน — งานที่นานจะทำให้งานถัดไปรอ

## 6. วิธีรัน test

จาก **root ของ repo** (ไม่ใช่ในโฟลเดอร์ mark55):

```bash
python -m unittest mark55.test_memory_bus -v
```

## 7. Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `SyntaxError` / `TypeError: 'type' object is not subscriptable` | Python เก่ากว่า 3.10 — เช็ก `python --version` (บน Ubuntu อาจต้องใช้ `python3`) |
| `ModuleNotFoundError: No module named 'mark55'` ตอนรัน test | รัน test จาก root ของ repo ไม่ใช่จากในโฟลเดอร์ `mark55` |
| `ModuleNotFoundError: No module named 'memory_bus'` | รัน `main.py` จากโฟลเดอร์อื่นด้วย path แปลก ๆ — ใช้ `cd mark55 && python main.py` หรือ `python -m mark55.main` จาก root |
| รันแล้วไม่มีงานเข้า | ปกติของ 4.5.5.1 — mock store อยู่ในโปรเซสนี้เท่านั้น (ดูข้อ 1) |
| `ตั้งค่า cloud ไว้ แต่ 4.5.5.1 ยังรองรับแค่ mock mode` | ส่ง `api_base_url` / `api_key` ให้ gateway — ยังไม่มีผล รอ 4.5.5.2 |

## 8. Roadmap (ยังไม่ทำ)

- **4.5.5.2 Cloud sync** — gateway โหมด cloud (Supermemory + Cloud Run) ให้ task ข้ามเครื่องได้ · ต้องมี claim แบบ atomic ฝั่ง server
- **4.5.5.3 Mobile integration** — แอป A.T.O.M. (TypeScript) สร้างและส่ง `MemoryTask`
- **4.5.5.4 U.L.T.R.O.N. governance** — retry limit · watchdog คืนงานที่ค้าง `IN_PROGRESS` · cleanup
