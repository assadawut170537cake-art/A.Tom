-- Mark 55 Memory Bus — ช่องทางของแอปมือถือ (Phase 4.5.5.3)
-- รันหลัง 001_init.sql · รันซ้ำได้ (IF NOT EXISTS / OR REPLACE / ON CONFLICT)
--
-- ทำไมไม่ใช้ policy บนตาราง memory_tasks:
-- แอปใช้ anon key ซึ่งดึงออกจาก APK ได้ → ถ้าเปิด policy ให้ anon ใครมี key ก็สั่ง Mark 55 ได้
-- จึงให้แอปเรียกได้แค่ RPC 2 ตัวข้างล่าง และทุกครั้งต้องแนบ "token เครื่อง" ที่ Boss ออกให้
--
-- * mobile_devices       เก็บแค่ sha256 ของ token (token จริงอยู่ใน SecureStore ของมือถือเท่านั้น)
-- * mobile_instructions  instruction ที่มือถือสั่งได้ — นอกรายการนี้ RPC ปฏิเสธ
-- * mobile_submit_task   ส่งงาน (ตรวจ token · instruction · payload · target · จำกัด 20 งาน/นาที/เครื่อง)
-- * mobile_get_task      อ่านสถานะ/ผลของงานที่ "เครื่องตัวเอง" ส่งเท่านั้น
-- * mobile_register_device  ออก token ใหม่ — service_role / SQL Editor เท่านั้น
--
-- ตารางทั้งหมดยังเปิด RLS ไม่มี policy + REVOKE จาก anon / authenticated เหมือน 001
-- RPC เป็น SECURITY DEFINER (รันด้วยสิทธิ์เจ้าของ) จึงเข้าตารางได้โดยไม่ต้องเปิดตารางให้ anon

-- ─── ตาราง ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mobile_devices (
  device_id     TEXT PRIMARY KEY CHECK (device_id ~ '^[A-Za-z0-9_.-]{1,64}$'),
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT '',
  container_tag TEXT NOT NULL DEFAULT 'atom_core',
  revoked       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.mobile_instructions (
  instruction TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

-- เริ่มด้วย handler ที่ Mark 55 มีอยู่ (mark55/handlers.py) · เพิ่มคำสั่งใหม่ = INSERT แถวใหม่ + handler ฝั่ง Mark 55
INSERT INTO public.mobile_instructions (instruction, description) VALUES
  ('RUN_DIAGNOSTICS', 'ตรวจสุขภาพเครื่อง'),
  ('EXECUTE_BUILD', 'สั่ง build')
ON CONFLICT (instruction) DO NOTHING;

-- นับงานต่อเครื่องในช่วงสั้น ๆ (rate limit)
CREATE INDEX IF NOT EXISTS idx_memory_tasks_sender_created
  ON public.memory_tasks (sender, created_at);

ALTER TABLE public.mobile_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_instructions ENABLE ROW LEVEL SECURITY;

-- ─── ส่งงาน ──────────────────────────────────────────────────────────
-- error → HTTP: PT403 = token ผิด/ถูกยกเลิก · PT429 = ส่งถี่เกิน · 22023 (400) = ข้อมูลไม่ถูกต้อง

CREATE OR REPLACE FUNCTION public.mobile_submit_task(
  p_token TEXT,
  p_instruction TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_target TEXT DEFAULT 'MARK_55_PC'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device public.mobile_devices%ROWTYPE;
  v_sender TEXT;
  v_task_id UUID;
BEGIN
  IF p_token IS NULL OR length(p_token) > 200 THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  SELECT * INTO v_device FROM public.mobile_devices
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND NOT revoked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mobile_instructions WHERE instruction = p_instruction) THEN
    RAISE EXCEPTION 'มือถือไม่มีสิทธิ์สั่ง instruction นี้: %', left(coalesce(p_instruction, ''), 64)
      USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::TEXT) > 4096 THEN
    RAISE EXCEPTION 'payload ต้องเป็น JSON object ไม่เกิน 4 KB' USING ERRCODE = '22023';
  END IF;
  IF p_target IS NULL OR p_target !~ '^[A-Za-z0-9_.-]{1,64}$' THEN
    RAISE EXCEPTION 'target ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  v_sender := 'MOBILE:' || v_device.device_id;
  IF (SELECT count(*) FROM public.memory_tasks
       WHERE sender = v_sender AND created_at > NOW() - INTERVAL '1 minute') >= 20 THEN
    RAISE EXCEPTION 'ส่งงานถี่เกินไป — รอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;

  INSERT INTO public.memory_tasks (instruction, sender, target, container_tag, payload)
  VALUES (p_instruction, v_sender, p_target, v_device.container_tag, p_payload)
  RETURNING task_id INTO v_task_id;

  UPDATE public.mobile_devices SET last_seen_at = NOW() WHERE device_id = v_device.device_id;
  RETURN v_task_id;
END;
$$;

-- ─── อ่านผล ──────────────────────────────────────────────────────────
-- คืน NULL ถ้าไม่มีงานนั้น หรือเป็นงานของเครื่องอื่น (ไม่บอกว่ามีอยู่จริงไหม)

CREATE OR REPLACE FUNCTION public.mobile_get_task(p_token TEXT, p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device_id TEXT;
  v_task JSONB;
BEGIN
  IF p_token IS NULL OR length(p_token) > 200 THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;
  SELECT device_id INTO v_device_id FROM public.mobile_devices
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') AND NOT revoked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token เครื่องไม่ถูกต้องหรือถูกยกเลิก' USING ERRCODE = 'PT403';
  END IF;

  SELECT jsonb_build_object(
           'task_id', t.task_id,
           'instruction', t.instruction,
           'status', t.status,
           'result', t.result,
           'claimed_by', t.claimed_by,
           'created_at', t.created_at,
           'claimed_at', t.claimed_at,
           'completed_at', t.completed_at)
    INTO v_task
    FROM public.memory_tasks t
   WHERE t.task_id = p_task_id AND t.sender = 'MOBILE:' || v_device_id;
  RETURN v_task;
END;
$$;

-- ─── ออก token (Boss รันใน SQL Editor) ───────────────────────────────
-- SELECT public.mobile_register_device('boss-phone', 'มือถือ Boss');
--   → ได้ token 'atm_…' ครั้งเดียว (เก็บแค่ hash) · คัดลอกไปใส่แอป: ตั้งค่า › Mark 55 Bus
-- เรียกซ้ำด้วย device_id เดิม = ออก token ใหม่ (ตัวเก่าใช้ไม่ได้ทันที)
-- ยกเลิกเครื่อง: UPDATE public.mobile_devices SET revoked = TRUE WHERE device_id = 'boss-phone';

CREATE OR REPLACE FUNCTION public.mobile_register_device(p_device_id TEXT, p_label TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- gen_random_uuid() ใช้ตัวสุ่มที่ปลอดภัยของ Postgres · 2 ตัว = 244 บิต
  v_token TEXT := 'atm_' || replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');
BEGIN
  INSERT INTO public.mobile_devices (device_id, token_hash, label)
  VALUES (p_device_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), coalesce(p_label, ''))
  ON CONFLICT (device_id) DO UPDATE
    SET token_hash = EXCLUDED.token_hash, label = EXCLUDED.label, revoked = FALSE;
  RETURN v_token;
END;
$$;

-- ─── สิทธิ์ ──────────────────────────────────────────────────────────
-- function สร้างใหม่ได้ EXECUTE ให้ PUBLIC เป็นค่าเริ่มต้น → ถอนก่อนแล้วให้เฉพาะที่ตั้งใจ

REVOKE ALL ON TABLE public.mobile_devices, public.mobile_instructions FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.mobile_submit_task(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mobile_get_task(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mobile_register_device(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mobile_submit_task(TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_get_task(TEXT, UUID) TO anon, authenticated;
