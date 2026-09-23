CREATE FUNCTION public.fixture_assert_call(call_sql text, expected integer, expected_body jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual integer;
BEGIN
 TRUNCATE public.fixture_http_calls;
 EXECUTE 'SELECT public.' || call_sql;
 SELECT count(*) INTO actual FROM public.fixture_http_calls;
 IF actual <> expected THEN RAISE EXCEPTION '% expected % calls, got %',call_sql,expected,actual; END IF;
 IF EXISTS(SELECT 1 FROM public.fixture_http_calls WHERE headers->>'x-cron-secret' IS DISTINCT FROM 'fixture-secret' OR body IS DISTINCT FROM expected_body) THEN
   RAISE EXCEPTION '% authentication/payload mismatch',call_sql;
 END IF;
END $$;

DO $$
DECLARE signature text; kind text; table_name text; call_sql text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['invoke_pipe_rule_dispatch()','invoke_campaign_rule_dispatch()',
  'invoke_process_blast_recipients()','invoke_oraculo_feedback_worker(text)'] LOOP
  IF has_function_privilege('anon','public.'||signature,'EXECUTE')
   OR has_function_privilege('authenticated','public.'||signature,'EXECUTE')
   OR NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN
    RAISE EXCEPTION 'Unsafe grants: %',signature;
  END IF;
 END LOOP;
 FOREACH kind IN ARRAY ARRAY['pipe','campaign'] LOOP
  table_name := 'scheduled_'||kind||'_messages';
  call_sql := 'invoke_'||kind||'_rule_dispatch()';
  PERFORM public.fixture_assert_call(call_sql,0);
  EXECUTE format('INSERT INTO public.%I VALUES (''scheduled'',now()+interval ''1 hour'',NULL),(''waiting_response'',NULL,now()+interval ''1 hour''),(''processing'',now(),NULL),(''sent'',now()-interval ''1 hour'',NULL)',table_name);
  PERFORM public.fixture_assert_call(call_sql,0);
  EXECUTE format('TRUNCATE public.%I; INSERT INTO public.%I VALUES (''scheduled'',now(),NULL)',table_name,table_name);
  PERFORM public.fixture_assert_call(call_sql,1);
  EXECUTE format('TRUNCATE public.%I; INSERT INTO public.%I VALUES (''waiting_response'',NULL,now())',table_name,table_name);
  PERFORM public.fixture_assert_call(call_sql,1);
  EXECUTE format('TRUNCATE public.%I; INSERT INTO public.%I VALUES (''processing'',now()-interval ''3 minutes'',NULL)',table_name,table_name);
  PERFORM public.fixture_assert_call(call_sql,1);
  EXECUTE format('TRUNCATE public.%I',table_name);
 END LOOP;
END $$;
SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''alerts'')',0);
SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''weekly'')',1,'{"mode":"weekly"}');
INSERT INTO public.oraculo_feedback_alerts VALUES ('pending',now()+interval '1 hour',NULL),('processing',NULL,now()+interval '1 hour');
SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''alerts'')',0);
TRUNCATE public.oraculo_feedback_alerts;
INSERT INTO public.oraculo_feedback_alerts VALUES ('processing',NULL,now()-interval '1 second');
SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''alerts'')',1,'{"mode":"alerts"}');
TRUNCATE public.oraculo_feedback_alerts;
INSERT INTO public.oraculo_feedback_alerts VALUES ('pending',now(),NULL);
SELECT public.fixture_assert_call('invoke_oraculo_feedback_worker(''alerts'')',1,'{"mode":"alerts"}');
TRUNCATE public.oraculo_feedback_alerts;
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
INSERT INTO public.whatsapp_instances VALUES (1,'notificame');
INSERT INTO public.blast_plans VALUES (1,1,'active','{}',1);
INSERT INTO public.blast_plan_recipients VALUES (1,'pending',NULL,0);
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',1);
UPDATE public.blast_plans SET status='paused';
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.blast_plans SET status='active',template=NULL;
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.blast_plans SET template='{}',lots_released=0;
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.blast_plans SET lots_released=1;
UPDATE public.whatsapp_instances SET provider='uazapi';
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.whatsapp_instances SET provider='notificame';
UPDATE public.blast_plan_recipients SET status='sent';
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.blast_plan_recipients SET status='pending',claimed_at=now();
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',0);
UPDATE public.blast_plan_recipients SET claimed_at=now()-interval '11 minutes';
SELECT public.fixture_assert_call('invoke_process_blast_recipients()',1);
TRUNCATE public.blast_plan_recipients;
