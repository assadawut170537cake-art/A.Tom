-- Mark 55 Memory Bus — อัลตรอน (ADR-015 ขั้น 4) · รันหลัง 002 / 003 · รันซ้ำได้
--
-- มือถือสั่งได้เพิ่ม 3 คำสั่ง (handler อยู่ใน mark55/handlers.py → make_ultron_handlers):
--   ULTRON_RUN      payload { "task": "...", "language": "python"|"bash", "code": "..." } → รันใน Docker sandbox
--   ULTRON_RELEASE  payload { "sandbox_id": "latest" | "<4–8 ตัวแรก>" } → ย้ายผลไป released/ (ไม่รันบนเครื่องจริง)
--   ULTRON_DESTROY  payload เหมือนกัน → ลบ sandbox ทิ้ง
--
-- ขยาย payload ของ mobile_submit_task จาก 4 KB → 16 KB เพราะโค้ดที่ AI เขียนยาวเกิน 4 KB ได้ง่าย
-- (ส่วนอื่นของ function เหมือน 002 ทุกบรรทัด — rate limit 20 งาน/นาที/เครื่อง ยังอยู่)

INSERT INTO public.mobile_instructions (instruction, description) VALUES
  ('ULTRON_RUN', 'อัลตรอน: รันโค้ดใน Docker sandbox'),
  ('ULTRON_RELEASE', 'อัลตรอน: ปลด sandbox (เก็บผล)'),
  ('ULTRON_DESTROY', 'อัลตรอน: ทำลาย sandbox')
ON CONFLICT (instruction) DO NOTHING;

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
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::TEXT) > 16384 THEN
    RAISE EXCEPTION 'payload ต้องเป็น JSON object ไม่เกิน 16 KB' USING ERRCODE = '22023';
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

-- CREATE OR REPLACE คงสิทธิ์เดิมไว้ แต่ประกาศซ้ำให้ชัด (กรณีรันกับฐานที่ถูกแก้สิทธิ์ไปแล้ว)
REVOKE ALL ON FUNCTION public.mobile_submit_task(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_submit_task(TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;
