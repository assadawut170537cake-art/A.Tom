-- Mark 55 Memory Bus — NotebookLM Enterprise · รันหลัง 004 · รันซ้ำได้
--
-- มือถือสั่งได้เพิ่ม 1 คำสั่ง (handler: mark55/notebooklm.py → make_notebooklm_handlers):
--   NOTEBOOKLM_ADD  payload { "sources": [{"type": "url"|"youtube"|"text", "value": "...", "name": "..."}],
--                             "title": "<ชื่อ notebook ใหม่ — ไม่ใส่ = ใช้ notebook เดิม>" }
-- payload จำกัด 16 KB ตาม mobile_submit_task ของ 004 (ไม่ต้องแก้ function)

INSERT INTO public.mobile_instructions (instruction, description) VALUES
  ('NOTEBOOKLM_ADD', 'ใส่ลิงก์/ข้อความเข้า NotebookLM Enterprise')
ON CONFLICT (instruction) DO NOTHING;
