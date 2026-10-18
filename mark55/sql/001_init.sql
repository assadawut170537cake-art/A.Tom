-- Mark 55 Memory Bus — schema (Phase 4.5.5.1)
-- รันครั้งเดียวใน Supabase SQL Editor (หรือผ่าน migration) · รันซ้ำได้ (IF NOT EXISTS / OR REPLACE)
--
-- ความปลอดภัย:
-- * เปิด RLS แต่ "ไม่มี policy" → anon / authenticated ทำอะไรกับตารางไม่ได้เลย
-- * Mark 55 ใช้ service_role key ซึ่งข้าม RLS → ใช้งานได้ปกติ
-- * มือถือ (4.5.5.3) จะต้องมี policy / RPC เฉพาะของตัวเอง — ห้ามเปิด allow-all เพราะ task = คำสั่งที่ Mark 55 รัน
--
-- claim ทำด้วย UPDATE ... WHERE status = 'PENDING' คำสั่งเดียว (ผ่าน PostgREST) → Postgres ล็อกแถวให้
-- สอง node แย่งกัน: ตัวที่สองจะเห็น status ไม่ใช่ PENDING แล้วได้ 0 แถว → ไม่ต้องมี RPC

CREATE TABLE IF NOT EXISTS public.memory_tasks (
  task_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction   TEXT NOT NULL,
  sender        TEXT NOT NULL,
  target        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  container_tag TEXT NOT NULL DEFAULT 'atom_core',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at    TIMESTAMPTZ,
  claimed_by    TEXT,
  completed_at  TIMESTAMPTZ,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- fetch pending: WHERE status = 'PENDING' AND container_tag = ? AND target IN (?, 'ALL') ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_memory_tasks_pending
  ON public.memory_tasks (container_tag, target, created_at)
  WHERE status = 'PENDING';

-- ตารางสำหรับ test กับ Supabase จริง — โครงเดียวกัน แยกจากงานจริง
CREATE TABLE IF NOT EXISTS public.memory_tasks_test (LIKE public.memory_tasks INCLUDING ALL);

-- ประทับเวลาฝั่ง server (ไม่เชื่อนาฬิกาของแต่ละเครื่อง)
CREATE OR REPLACE FUNCTION public.memory_tasks_stamp_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'IN_PROGRESS' AND OLD.status = 'PENDING' THEN
    NEW.claimed_at := now();
  END IF;
  IF NEW.status IN ('COMPLETED', 'FAILED') AND OLD.status = 'IN_PROGRESS' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.memory_tasks_stamp_times() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_memory_tasks_stamp_times
  BEFORE UPDATE ON public.memory_tasks
  FOR EACH ROW EXECUTE FUNCTION public.memory_tasks_stamp_times();

CREATE OR REPLACE TRIGGER trg_memory_tasks_test_stamp_times
  BEFORE UPDATE ON public.memory_tasks_test
  FOR EACH ROW EXECUTE FUNCTION public.memory_tasks_stamp_times();

ALTER TABLE public.memory_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_tasks_test ENABLE ROW LEVEL SECURITY;

-- กันไว้อีกชั้น: แม้มีคนเผลอเพิ่ม policy ภายหลัง anon / authenticated ก็ยังไม่มีสิทธิ์ระดับตาราง
REVOKE ALL ON public.memory_tasks FROM anon, authenticated;
REVOKE ALL ON public.memory_tasks_test FROM anon, authenticated;
