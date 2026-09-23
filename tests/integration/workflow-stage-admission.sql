SELECT workflow_admission_test.assert_move(0);
INSERT INTO workflow_admission_test.workflows VALUES
 ('00000000-0000-0000-0000-000000000002','stage_changed',true),
 ('00000000-0000-0000-0000-000000000001','stage_changed',false),
 ('00000000-0000-0000-0000-000000000001','lead_created',true);
SELECT workflow_admission_test.assert_move(0);
DO $$ DECLARE kind text; payload jsonb; expected jsonb; p record; BEGIN
 FOREACH kind IN ARRAY ARRAY['stage_changed','deal_won','deal_lost'] LOOP
  TRUNCATE workflow_admission_test.workflows;
  INSERT INTO workflow_admission_test.workflows VALUES('00000000-0000-0000-0000-000000000001',kind,true);
  PERFORM workflow_admission_test.assert_move(1);
  SELECT body INTO payload FROM workflow_admission_test.http_calls;
  IF payload->>'mode'<>'fire_trigger' OR payload->>'trigger_type'<>'stage_changed'
   OR payload->>'organization_id'<>'00000000-0000-0000-0000-000000000001'
   OR payload->>'lead_id'<>'00000000-0000-0000-0000-000000000007' THEN RAISE EXCEPTION 'Top-level payload changed'; END IF;
  SELECT jsonb_build_object('trigger','stage_changed','pipeline_id',pipeline_id,'pipe_type','whatsapp','pipeline_entry_id',id,
    'deal_id',deal_id,'stage_id',stage_id,'stage_key',stage_key,'from_stage',left(stage_key,length(stage_key)-5),
    'from_stage_id',stage_id,'to_stage',stage_key,'changed_by_user_id','00000000-0000-0000-0000-000000000005',
    'changed_by_member_id','00000000-0000-0000-0000-000000000006') INTO expected FROM workflow_admission_test.pipeline_entries;
  IF payload->'context' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Context or actor changed'; END IF;
  IF EXISTS(SELECT 1 FROM workflow_admission_test.http_calls WHERE url<>'https://fixture.example/functions/v1/process-workflow-executions'
   OR headers IS DISTINCT FROM '{"Content-Type":"application/json","x-cron-secret":"test-secret"}'::jsonb) THEN RAISE EXCEPTION 'Transport changed'; END IF;
 END LOOP;
 SELECT * INTO p FROM pg_proc WHERE oid='workflow_admission_test.trigger_workflow_pipeline_stage_changed()'::regprocedure;
 IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=workflow_admission_test, extensions']::text[]
  OR has_function_privilege('anon',p.oid,'EXECUTE')
  OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'Function security changed'; END IF;
END $$;
TRUNCATE workflow_admission_test.http_calls;
UPDATE workflow_admission_test.pipeline_entries SET stage_key=stage_key;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM workflow_admission_test.http_calls) THEN RAISE EXCEPTION 'Unchanged stage dispatched'; END IF; END $$;
UPDATE workflow_admission_test.pipelines SET type='custom';
SELECT workflow_admission_test.assert_move(0);
UPDATE workflow_admission_test.pipelines SET type='system';
TRUNCATE workflow_admission_test.workflows;
SELECT workflow_admission_test.assert_move(0);
INSERT INTO workflow_admission_test.workflows VALUES('00000000-0000-0000-0000-000000000001','stage_changed',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM workflow_admission_test.http_calls) THEN RAISE EXCEPTION 'Enable dispatched retroactively'; END IF; END $$;
SELECT workflow_admission_test.assert_move(1);
