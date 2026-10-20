-- Mark 55 Memory Bus — REVERSE_ENGINEER (ADR-016) · รันหลัง 002 · รันซ้ำได้
--
-- มือถือสั่งได้เพิ่ม 1 คำสั่ง (handler อยู่ใน mark55/handlers.py → make_rea_handler):
--   REVERSE_ENGINEER  payload { "target": "<ชื่อแอป/พาธ apk>" }
--       → REA แกะ APK แล้วคืน { package, doors[], evidence_id } (ทางเข้า: exported / deep link / intent)
--
-- payload เล็ก (แค่ชื่อเป้าหมาย) จึงไม่ต้องขยายขนาดเหมือน 004 — ใช้ limit ของ 002 ตามเดิม
-- ตารางทั้งหมดยังปิดสำหรับ anon — เพิ่มแค่แถว instruction ที่อนุญาตเท่านั้น

INSERT INTO public.mobile_instructions (instruction, description) VALUES
  ('REVERSE_ENGINEER', 'REA: แกะ APK หาทางเข้าของแอป')
ON CONFLICT (instruction) DO NOTHING;
