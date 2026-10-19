-- ทดสอบ 004_ultron.sql กับ Postgres เปล่า (ห้ามรันบนโปรเจกต์จริง) — รันหลัง 001–004
-- ผลที่ถูก: ultron_ok = t · big_ok = t · NOTICE too big rejected ok · NOTICE unknown rejected ok
\set ON_ERROR_STOP 1
select public.mobile_register_device('boss-phone','มือถือ') as tok \gset
select set_config('atom.tok', :'tok', false) as _tok_set \gset
set role anon;
select public.mobile_submit_task(:'tok', 'ULTRON_RUN', '{"code":"print(1)"}') is not null as ultron_ok;
select public.mobile_submit_task(:'tok', 'ULTRON_RUN', jsonb_build_object('code', repeat('x', 12000))) is not null as big_ok;
do $$ begin perform public.mobile_submit_task(current_setting('atom.tok'), 'ULTRON_RUN', jsonb_build_object('code', repeat('x', 17000)));
  exception when sqlstate '22023' then raise notice 'too big rejected ok'; end $$;
do $$ begin perform public.mobile_submit_task(current_setting('atom.tok'), 'RM_RF', '{}');
  exception when sqlstate '22023' then raise notice 'unknown rejected ok'; end $$;
