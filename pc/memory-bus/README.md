# Memory Bus (ฝั่ง PC — Mark 55)

Blackboard สำหรับส่งงานจากมือถือไปให้ PC ทำ โดยไม่ต้องต่อกันตรง ๆ: มือถือ push `MemoryTask` → watcher บน PC poll → claim → รัน handler → เขียนผลกลับ

Python 3.9+ · ใช้แค่ standard library (ไม่มี dependency)

```bash
cd pc/memory-bus
python3 -m unittest -v
```

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `memory_bus.py` | `MemoryTask` (schema) · `InMemoryTaskStore` (claim/finish แบบ compare-and-set ใต้ lock) · `MemoryWatcher` (daemon loop) |
| `supermemory_gateway.py` | API ที่ watcher เรียก · mirror ทุก transition ขึ้น Supermemory แบบ best-effort ถ้าตั้ง URL + key |
| `test_memory_bus.py` | unit test (ไม่ยิงเน็ตจริง — HTTP เป็นตัวปลอม) |

## กติกา

- `PENDING → IN_PROGRESS` ได้ครั้งเดียว (ผู้แพ้ claim ได้ `False` แล้วข้าม) · `IN_PROGRESS → COMPLETED/FAILED` ได้เฉพาะ node ที่ claim
- target `ALL` = ทุก node เห็น แต่มีแค่ node เดียวที่ claim ได้
- ไม่มี URL หรือ key (`SUPERMEMORY_API_KEY`) = ทำงานในเครื่องอย่างเดียว

## ข้อจำกัด (ยังไม่ทำ)

- **claim atomic แค่ในโปรเซสเดียว** — Supermemory ไม่มี conditional update จึงใช้เป็น lock ข้ามเครื่องไม่ได้ ถ้าต้องให้มือถือกับ PC ใช้ blackboard เดียวกันจริง ต้องมี store ฝั่ง server ที่ทำ compare-and-set ได้ (เช่น endpoint บน Mark 55)
- gateway ยังไม่ดึง task จาก Supermemory ลงมา (mirror ขาขึ้นอย่างเดียว) และ path `/v4/memories/store` ยังไม่ได้ตรวจกับเอกสารจริง
- ยังไม่มี retry limit / watchdog คืนงานที่ค้าง `IN_PROGRESS` (Gate 10 — U.L.T.R.O.N.)
- ฝั่งมือถือยังไม่มี client ที่สร้าง `MemoryTask`
