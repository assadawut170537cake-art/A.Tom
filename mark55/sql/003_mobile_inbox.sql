-- Mark 55 Memory Bus — PC → มือถือ (inbox ของแอป) · รันหลัง 002_mobile_rpc.sql · รันซ้ำได้
--
-- Mark 55 (service_role) ส่งงานให้มือถือด้วย INSERT memory_tasks ปกติ โดยตั้ง
--   target = 'MOBILE:<device_id>'  (เครื่องเดียว)  หรือ  'MOBILE_ALL'  (เครื่องแรกที่ดึงได้รับไป)
--   instruction ∈ MOBILE_INBOX_INSTRUCTIONS ข้างล่าง (ตัวช่วย: mark55/mobile_outbox.py)
-- watcher บน PC ดึงแค่ target = node ตัวเอง / 'ALL' → ไม่แย่งงานของมือถือ
--
-- มือถือ (anon key + token เครื่อง) เรียกได้ 2 ตัว:
-- * mobile_claim_inbox   รับงานที่รออยู่ (PENDING → IN_PROGRESS · ล็อกแถวด้วย SKIP LOCKED กันรับซ้ำ)
--                        งานที่ค้างเกิน 1 วันถูกปิดเป็น FAILED 'expired' (มือถือปิดไปนาน ไม่ควรเด้งแจ้งเตือนเก่าทีเดียวเป็นกอง)
-- * mobile_finish_task   ส่งผลกลับ เฉพาะงานที่เครื่องตัวเองรับไว้
-- ตารางยังปิดสำหรับ anon เหมือนเดิม — ห้ามเปิด policy

-- instruction ที่ส่งหามือถือได้ (คนละชุดกับ mobile_instructions ซึ่งเป็นสิ่งที่มือถือสั่ง PC ได้)
--   NOTIFY       payload { "text": "...", "speak": true }  → แสดงในแชท + พูด
--   DEVICE_TOOL  payload { "tool": "device.volume", "text": "30", "args": {...} } → DeviceControlBridge
--                (บอสต้องเปิด ตั้งค่า › Marketplace › ควบคุมอุปกรณ์ ไว้ · ปุ่มเสี่ยงยังต้องให้บอสพิมพ์ "ยืนยัน" บนมือถือ)

CREATE OR REPLACE FUNCTION public.mobile_claim_inbox(p_token TEXT, p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device public.mobile_devices%ROWTYPE;
  v_me TEXT;
  v_tasks JSONB;
BEGIN
  IF p_token IS NULL OR length(p_token) > 200 THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO v_device FROM public.mobile_devices
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND NOT revoked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  v_me := 'MOBILE:' || v_device.device_id;

  -- ค้างเกิน 1 วัน = หมดอายุ (PENDING → FAILED ตรง ๆ: trigger ประทับเวลาเฉพาะ IN_PROGRESS → จบ)
  UPDATE public.memory_tasks
     SET status = 'FAILED', completed_at = NOW(), result = '{"error":"expired"}'::jsonb
   WHERE status = 'PENDING'
     AND container_tag = v_device.container_tag
     AND target IN (v_me, 'MOBILE_ALL')
     AND created_at < NOW() - INTERVAL '1 day';

  WITH picked AS (
    SELECT task_id FROM public.memory_tasks
     WHERE status = 'PENDING'
       AND container_tag = v_device.container_tag
       AND target IN (v_me, 'MOBILE_ALL')
       AND instruction IN ('NOTIFY', 'DEVICE_TOOL')
     ORDER BY created_at
     LIMIT least(greatest(coalesce(p_limit, 10), 1), 20)
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.memory_tasks t
       SET status = 'IN_PROGRESS', claimed_by = v_me
      FROM picked
     WHERE t.task_id = picked.task_id
    RETURNING t.task_id, t.instruction, t.sender, t.payload, t.created_at
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'task_id', c.task_id,
           'instruction', c.instruction,
           'sender', c.sender,
           'payload', c.payload,
           'created_at', c.created_at) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_tasks
    FROM claimed c;

  UPDATE public.mobile_devices SET last_seen_at = NOW() WHERE device_id = v_device.device_id;
  RETURN v_tasks;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_finish_task(p_token TEXT, p_task_id UUID, p_ok BOOLEAN, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device_id TEXT;
BEGIN
  IF p_token IS NULL OR length(p_token) > 200 THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  SELECT device_id INTO v_device_id FROM public.mobile_devices
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND NOT revoked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::TEXT) > 4096 THEN
    RAISE EXCEPTION 'result ต้องเป็น JSON object ไม่เกิน 4 KB' USING ERRCODE = '22023';
  END IF;

  UPDATE public.memory_tasks
     SET status = CASE WHEN p_ok THEN 'COMPLETED' ELSE 'FAILED' END, result = p_result
   WHERE task_id = p_task_id AND status = 'IN_PROGRESS' AND claimed_by = 'MOBILE:' || v_device_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_claim_inbox(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mobile_finish_task(TEXT, UUID, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_claim_inbox(TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_finish_task(TEXT, UUID, BOOLEAN, JSONB) TO anon, authenticated;
