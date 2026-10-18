# Mark 55 — Memory Bus (Phase 4.5.5.1)

## 1. ภาพรวม

Memory Bus คือ blackboard บน **Supabase** สำหรับส่งงานให้ Mark 55 ทำ โดยไม่ต้องต่อเครื่องกันตรง ๆ
ฝั่งสั่งงานเพิ่มแถวลงตาราง `memory_tasks` → watcher บน Mark 55 poll หา task ของตัวเอง → claim (กันรันซ้ำ) → รัน handler → บันทึกผล `COMPLETED` / `FAILED`

```
PENDING ──claim──▶ IN_PROGRESS ──handler สำเร็จ──▶ COMPLETED
   │                     └──handler ล้ม / ไม่มี handler──▶ FAILED
   └── claim แพ้ (node อื่นได้ไปก่อน) → ข้าม ไม่รัน
```

- **claim แบบ atomic:** `UPDATE … SET status='IN_PROGRESS' WHERE task_id=? AND status='PENDING'` คำสั่งเดียว — Postgres ล็อกแถวให้ ถ้า 2 เครื่องแย่งกัน ตัวที่สองได้ 0 แถว
- task ค้างอยู่ใน Supabase ระหว่าง Mark 55 ปิดเครื่อง → เปิดมาก็รับต่อได้
- Python ≥ 3.10 · dependency: `supabase`, `python-dotenv`

## 2. โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `main.py` | entrypoint — argparse · ตั้ง logging · ตรวจการเชื่อมต่อ · จับ Ctrl+C / SIGTERM แล้วปิดอย่างนุ่มนวล |
| `config.py` | ค่าตั้งต้น (โหลด `.env` แล้วอ่าน env) · `require_supabase()` ตรวจว่ามี URL + key |
| `memory_bus.py` | `TaskStatus` · `MemoryTask` (field = คอลัมน์ในตาราง) · `MemoryWatcher` (poll loop) |
| `supabase_gateway.py` | อ่าน/เขียนตาราง · ทุก transition เป็น UPDATE แบบมีเงื่อนไข · error → log ไม่ crash |
| `handlers.py` | `HANDLER_REGISTRY` — instruction → handler ที่ main.py ลงทะเบียน |
| `sql/001_init.sql` | schema: ตาราง `memory_tasks` + `memory_tasks_test` · trigger ประทับเวลา · RLS |
| `test_memory_bus.py` | unittest — mock (CI) + live (Supabase จริง, เลือกรัน) |
| `.env.example` | แม่แบบ `.env` |

## 3. ตั้งค่า Supabase (ครั้งแรก)

1. ตาราง: รัน `sql/001_init.sql` ใน Supabase → SQL Editor (โปรเจกต์ของ Boss สร้างไว้แล้ว 2026-10-17 — รันซ้ำได้ ไม่เสียหาย)
2. Key: Supabase → **Settings → API** → คัดลอก Project URL และ **service_role** key
3. สร้าง `.env`:
   ```bash
   cd mark55
   cp .env.example .env     # แล้วแก้ SUPABASE_URL / SUPABASE_KEY
   ```

> ⚠️ **service_role key = สิทธิ์เต็ม** (ข้าม RLS) — ใส่ใน `mark55/.env` บน Mark 55 เท่านั้น
> ห้าม commit (`.env` อยู่ใน `.gitignore`) · ห้ามแปะในแชท · ห้ามใส่ในแอปมือถือ

**ความปลอดภัยของตาราง:** เปิด RLS โดย*ไม่มี policy* + `REVOKE` สิทธิ์จาก `anon` / `authenticated`
→ anon key อ่าน/เขียนตารางไม่ได้เลย (ทดสอบแล้ว: ได้ `42501 permission denied`)
แอปมือถือ (4.5.5.3) ต้องมี policy หรือ RPC เฉพาะของตัวเอง — **ห้ามเปิด allow-all** เพราะ task = คำสั่งที่ Mark 55 รัน

## 4. วิธีรัน

```bash
pip install -r requirements.txt
cd mark55
python main.py
```

รันจาก root ของ repo ได้เหมือนกัน: `python mark55/main.py` หรือ `python -m mark55.main`

```
[INFO] mark55.memory_bus: เริ่ม Memory Bus
[INFO] mark55.memory_bus: เชื่อมต่อ Supabase: https://<project-ref>.supabase.co
[INFO] mark55.memory_bus: Node ID = MARK_55_PC
[INFO] mark55.memory_bus: Container tag = atom_core
[INFO] mark55.memory_bus: Poll interval = 2.0s
[INFO] mark55.memory_bus: ตาราง = memory_tasks
[INFO] mark55.memory_bus: Handlers = ['EXECUTE_BUILD', 'RUN_DIAGNOSTICS']
[INFO] mark55.memory_bus: Watcher เริ่มทำงานสำหรับ node [MARK_55_PC]
```

หยุด: **Ctrl+C** (หรือ `kill <pid>` = SIGTERM) — งานที่กำลังรันจะรันจนจบก่อน แล้วขึ้น `ปิดระบบเรียบร้อย`

| exit code | ความหมาย |
|---|---|
| 0 | ปิดปกติ |
| 1 | ไม่มี URL/key · ต่อ Supabase ไม่ได้ · watcher ล้มกลางทาง (ดู log) |
| 2 | argument ผิด |

ระหว่างทำงาน ถ้า Supabase / เน็ตหลุด → log `ดึง task ที่รออยู่ไม่สำเร็จ` แล้วลองใหม่ทุกรอบ ไม่ต้องรีสตาร์ท

**ลองส่งงานทดสอบ** (Supabase → SQL Editor):
```sql
insert into memory_tasks (instruction, sender, target, payload)
values ('RUN_DIAGNOSTICS', 'BOSS_SQL', 'MARK_55_PC', '{"module": "power_grid"}');

select status, claimed_by, result from memory_tasks order by created_at desc limit 5;
```

## 5. Environment variables

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `SUPABASE_URL` | — (ต้องมี) | `https://<project-ref>.supabase.co` |
| `SUPABASE_KEY` | — (ต้องมี) | **service_role** key |
| `SUPABASE_ANON_KEY` | ว่าง | สำรองไว้ให้แอปมือถือ — Mark 55 ไม่ใช้ |
| `MARK55_NODE_ID` | `MARK_55_PC` | รับ task ที่ `target` ตรงกับค่านี้ หรือ `ALL` |
| `MARK55_CONTAINER_TAG` | `atom_core` | namespace — เห็นเฉพาะ task ใน tag เดียวกัน |
| `MARK55_POLL_INTERVAL` | `2.0` | วินาที · ต้อง > 0 (ค่าผิด → เตือนแล้วใช้ค่าเริ่มต้น) |
| `MARK55_LOG_LEVEL` | `INFO` | `DEBUG` (เห็น HTTP request ทุกตัว) / `INFO` / `WARNING` / `ERROR` / `CRITICAL` |

ตัวแปรที่ตั้งใน shell ชนะค่าใน `.env`

## 6. วิธีเพิ่มความสามารถ

**instruction ใหม่** — แก้ `handlers.py`:

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

- handler คืน `dict` ที่ serialize เป็น JSON ได้ → เก็บในคอลัมน์ `result`
- ถ้า raise หลุดออกมา watcher จะบันทึก `FAILED` + ข้อความ exception แล้วทำงานต่อ
- handler รันทีละงาน — งานที่นานจะทำให้งานถัดไปรอ

**เครื่อง/agent ใหม่** — รัน `main.py` อีกตัวด้วย `MARK55_NODE_ID` ของมันเอง (เช่น `J.A.R.V.I.S.`) · task ที่ `target = 'ALL'` จะมีแค่ตัวเดียวที่ claim ได้

**backend ใหม่** — watcher คุยกับ gateway ผ่าน `GatewayClient` (memory_bus.py) — เขียน gateway ใหม่ที่มี 4 เมธอดเดียวกัน โดยไม่ต้องแก้ watcher / handler

## 7. วิธีรัน test

จาก **root ของ repo**:

```bash
python -m unittest mark55.test_memory_bus -v
```

- ปกติใช้ Supabase ปลอม — ไม่ต้องมีเน็ตหรือ key (เหมาะกับ CI)
- ทดสอบกับ Supabase จริง (ตาราง `memory_tasks_test`, ลบข้อมูลของตัวเองทิ้งหลังจบ):
  ```bash
  MARK55_LIVE_TEST=1 python -m unittest mark55.test_memory_bus -v
  ```
  ใช้ `SUPABASE_URL` / `SUPABASE_KEY` จาก `mark55/.env`

## 8. Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `ยังไม่ได้ตั้ง SUPABASE_URL, SUPABASE_KEY` | ยังไม่มี `mark55/.env` — ดูข้อ 3 |
| `ต่อ Supabase ไม่สำเร็จ (APIError: permission denied …)` | ใช้ anon key แทน service_role — แก้ `SUPABASE_KEY` |
| `ต่อ Supabase ไม่สำเร็จ (… Could not find the table …)` | ยังไม่ได้รัน `sql/001_init.sql` |
| `ต่อ Supabase ไม่สำเร็จ (ConnectError …)` | เน็ตหรือ URL ผิด — เช็ก `SUPABASE_URL` |
| `ยังไม่ได้ติดตั้ง supabase` / `ModuleNotFoundError: dotenv` | `pip install -r requirements.txt` |
| `SyntaxError` / `TypeError: 'type' object is not subscriptable` | Python เก่ากว่า 3.10 — เช็ก `python --version` (บน Ubuntu อาจต้องใช้ `python3`) |
| `ModuleNotFoundError: No module named 'mark55'` ตอนรัน test | รัน test จาก root ของ repo ไม่ใช่ในโฟลเดอร์ `mark55` |
| task ค้าง `IN_PROGRESS` | Mark 55 ดับระหว่างรันงาน — ยังไม่มีตัวคืนงานอัตโนมัติ (4.5.5.4) · คืนเอง: `update memory_tasks set status='PENDING', claimed_by=null where task_id='…'` |

## 9. Roadmap (ยังไม่ทำ)

- **4.5.5.2** — Supabase Realtime แทนการ poll · ทำความสะอาดงานเก่า
- **4.5.5.3 Mobile integration** — แอป A.T.O.M. (TypeScript) สร้าง task ผ่าน RPC / policy ที่จำกัดสิทธิ์
- **4.5.5.4 U.L.T.R.O.N. governance** — retry limit · watchdog คืนงานที่ค้าง `IN_PROGRESS`
