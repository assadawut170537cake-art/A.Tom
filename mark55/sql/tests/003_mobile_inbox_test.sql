-- ทดสอบ 003_mobile_inbox.sql กับ Postgres เปล่า (ไม่ใช่ Supabase จริง — ห้ามรันบนโปรเจกต์จริง เพราะสร้าง device/งานปลอม)
--   createdb atom_test && psql -d atom_test -c "create role anon nologin; create role authenticated nologin;"
--   psql -d atom_test -f mark55/sql/001_init.sql -f mark55/sql/002_mobile_rpc.sql -f mark55/sql/003_mobile_inbox.sql \
--        -f mark55/sql/tests/003_mobile_inbox_test.sql
-- ผลที่ถูก: claimed_first=2 · claimed_again=0 · other_gets=ของอีกเครื่อง · other_can_finish=f · finish_ok=t ·
--          finish_twice=f · NOTICE table closed ok · NOTICE bad token rejected ok · งานเก่า = FAILED expired
\set ON_ERROR_STOP 1
select public.mobile_register_device('boss-phone','มือถือ') as tok \gset
select public.mobile_register_device('other-phone','') as tok2 \gset
insert into public.memory_tasks (instruction,sender,target,payload) values
 ('NOTIFY','MARK_55_PC','MOBILE:boss-phone','{"text":"build เสร็จแล้ว"}'),
 ('DEVICE_TOOL','MARK_55_PC','MOBILE_ALL','{"tool":"device.volume","text":"30"}'),
 ('NOTIFY','MARK_55_PC','MOBILE:other-phone','{"text":"ของอีกเครื่อง"}'),
 ('RUN_DIAGNOSTICS','MARK_55_PC','MOBILE:boss-phone','{}'),
 ('NOTIFY','MARK_55_PC','MOBILE:boss-phone','{"text":"เก่า"}');
update public.memory_tasks set created_at = now() - interval '2 days' where payload->>'text' = 'เก่า';
set role anon;
select jsonb_array_length(public.mobile_claim_inbox(:'tok')) as claimed_first;
select jsonb_array_length(public.mobile_claim_inbox(:'tok')) as claimed_again;
select public.mobile_claim_inbox(:'tok2')->0->'payload'->>'text' as other_gets;
-- anon cannot touch table directly
do $$ begin perform 1 from public.memory_tasks; raise exception 'TABLE OPEN TO ANON'; exception when insufficient_privilege then raise notice 'table closed ok'; end $$;
reset role;
select task_id as tid from public.memory_tasks where payload->>'text'='build เสร็จแล้ว' \gset
set role anon;
select public.mobile_finish_task(:'tok2', :'tid', true, '{}') as other_can_finish;
select public.mobile_finish_task(:'tok', :'tid', true, '{"shown":true}') as finish_ok;
select public.mobile_finish_task(:'tok', :'tid', true, '{}') as finish_twice;
do $$ begin perform public.mobile_claim_inbox('atm_bad'); exception when sqlstate 'PT403' then raise notice 'bad token rejected ok'; end $$;
reset role;
select instruction, target, status, claimed_by, result, claimed_at is not null as claimed_stamp, completed_at is not null as done_stamp from public.memory_tasks order by created_at, instruction;
