-- Run only through the companion rollback runner: schema and fixtures never commit.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
  instance uuid:=gen_random_uuid(); wf uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); disabled_execution uuid:=gen_random_uuid(); disabled_workflow uuid:=gen_random_uuid(); invalid_workflow uuid:=gen_random_uuid(); invalid_execution uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); q uuid; reservation jsonb; reply jsonb; frozen jsonb;
  signature text; accepted timestamptz; blocked boolean;
  definition jsonb:='{"nodes":[{"id":"ask","type":"question_buttons","data":{"type":"question_buttons","text":"Synthetic question","timeoutHours":24,"buttons":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}},{"id":"path-a","type":"end","data":{}},{"id":"path-b","type":"end","data":{}}],"edges":[{"id":"ea","source":"ask","sourceHandle":"button:a","target":"path-a"},{"id":"eb","source":"ask","sourceHandle":"button:b","target":"path-b"},{"id":"eo","source":"ask","sourceHandle":"other_response","target":"path-b"},{"id":"et","source":"ask","sourceHandle":"timeout","target":"path-b"},{"id":"ef","source":"ask","sourceHandle":"send_failure","target":"path-b"}]}';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.freeze_workflow_button_definition(uuid,uuid)',
    'public.prepare_workflow_button_question(uuid,uuid,text,integer,uuid,text)',
    'public.resolve_workflow_button_question(uuid,uuid)',
    'public.accept_workflow_button_question(uuid,uuid,text,timestamptz)',
    'public.receive_workflow_button_reply(uuid,uuid)'
  ] LOOP
    IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE')
       OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL grants: %',signature;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated','public.workflow_button_questions','INSERT,UPDATE,SELECT')
     OR has_table_privilege('anon','public.workflow_button_replies','INSERT,UPDATE,SELECT') THEN
    RAISE EXCEPTION 'FAIL state table grants';
  END IF;
  IF has_function_privilege('anon','public.cancel_workflow_button_questions()','EXECUTE')
     OR has_function_privilege('authenticated','public.cancel_workflow_button_questions()','EXECUTE')
     OR has_function_privilege('anon','public.guard_workflow_button_snapshot()','EXECUTE')
     OR has_function_privilege('authenticated','public.guard_workflow_button_snapshot()','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL guard grants';
  END IF;
  INSERT INTO public.organizations(id,name,slug,is_sandbox,feature_flags)
    VALUES(org,'Workflow button rollback test','button-rollback-'||org,true,'{"workflow_question_buttons":true}'),
          (other_org,'Workflow button isolation test','button-rollback-'||other_org,true,'{}');
  INSERT INTO public.leads(id,organization_id,name,phone) VALUES(lead,org,'Synthetic button recipient','5548999990000');
  INSERT INTO public.org_quotas(organization_id,resource_key,plan_base)
    VALUES(org,'max_whatsapp_instances',1)
    ON CONFLICT(organization_id,resource_key) DO UPDATE SET plan_base=1;
  INSERT INTO public.whatsapp_instances(id,organization_id,instance_name,status,provider)
    VALUES(instance,org,'synthetic-no-credentials','connected','uazapi');
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,definition,is_active,re_enrollment_enabled)
    VALUES(wf,org,'Synthetic rollback workflow','manual',definition,false,true);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(execution,wf,org,lead,'ask','running');
  frozen:=public.freeze_workflow_button_definition(execution,org);
  IF frozen IS DISTINCT FROM definition THEN RAISE EXCEPTION 'FAIL initial snapshot'; END IF;
  blocked:=false;
  BEGIN
    UPDATE public.workflow_executions SET question_buttons_definition='{}' WHERE id=execution;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='question_snapshot_immutable' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL snapshot mutable'; END IF;
  UPDATE public.workflows SET definition='{"nodes":[],"edges":[]}' WHERE id=wf;
  IF public.freeze_workflow_button_definition(execution,org) IS DISTINCT FROM definition THEN RAISE EXCEPTION 'FAIL edit changed snapshot'; END IF;
  blocked:=false;
  BEGIN
    PERFORM public.prepare_workflow_button_question(execution,other_org,'ask',1,instance,'5548999990000');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='question_execution_unavailable' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL cross tenant prepare'; END IF;
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,definition,is_active)
    VALUES(invalid_workflow,org,'Synthetic duplicate edge','manual',
      jsonb_set(definition,'{edges}',(definition->'edges')||'[{"id":"bad","source":"ask","sourceHandle":"button:a","target":"deleted"}]'::jsonb),false);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(invalid_execution,invalid_workflow,org,lead,'ask','running');
  PERFORM public.freeze_workflow_button_definition(invalid_execution,org);
  blocked:=false;
  BEGIN
    PERFORM public.prepare_workflow_button_question(invalid_execution,org,'ask',1,instance,'5548999990000');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='question_invalid_configuration' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL duplicate dangling edge accepted'; END IF;
  reservation:=public.prepare_workflow_button_question(execution,org,'ask',1,instance,'5548999990000');
  q:=(reservation->>'id')::uuid;
  IF reservation->'send' IS DISTINCT FROM 'true'::jsonb OR (SELECT status FROM public.workflow_executions WHERE id=execution) IS DISTINCT FROM 'paused' THEN RAISE EXCEPTION 'FAIL durable reservation'; END IF;
  IF public.prepare_workflow_button_question(execution,org,'ask',1,instance,'5548999990000')->'send' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'FAIL duplicate send'; END IF;
  accepted:=clock_timestamp();
  -- Both messages persist before acceptance. Processing B first must still select A.
  INSERT INTO public.whatsapp_messages(id,organization_id,instance_id,lead_id,message_id,remote_jid,phone_number,direction,message_type,raw_payload,created_at)
    VALUES(a,org,instance,lead,'synthetic-a-'||a,'5548999990000@s.whatsapp.net','5548999990000','incoming','text',
      jsonb_build_object('buttonOrListid',q||':a','quoted','original-wa-id','fromMe',false,'messageType','TemplateButtonReplyMessage'),accepted),
    (b,org,instance,lead,'synthetic-b-'||b,'5548999990000@s.whatsapp.net','5548999990000','incoming','buttons_response',
      jsonb_build_object('buttonOrListid',q||':b','quoted','original-wa-id','fromMe',false),accepted+interval '1 millisecond');
  reply:=public.receive_workflow_button_reply(b,org);
  IF reply->'recognized' IS DISTINCT FROM 'true'::jsonb OR reply->'resolved' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'FAIL early reply'; END IF;
  IF public.accept_workflow_button_question(q,other_org,'original-wa-id',accepted) THEN RAISE EXCEPTION 'FAIL cross tenant accept'; END IF;
  IF NOT public.accept_workflow_button_question(q,org,'original-wa-id',accepted) THEN RAISE EXCEPTION 'FAIL accept'; END IF;
  IF (SELECT current_node_id FROM public.workflow_executions WHERE id=execution) IS DISTINCT FROM 'path-a'
    OR (SELECT selected_option FROM public.workflow_button_questions WHERE id=q) IS DISTINCT FROM 'a' THEN RAISE EXCEPTION 'FAIL first persisted response'; END IF;
  IF (SELECT deadline_at-accepted_at FROM public.workflow_button_questions WHERE id=q)<>interval '24 hours' THEN RAISE EXCEPTION 'FAIL deadline from acceptance'; END IF;
  reply:=public.receive_workflow_button_reply(b,org);
  IF reply->'recognized' IS DISTINCT FROM 'true'::jsonb OR reply->'resolved' IS DISTINCT FROM 'false'::jsonb
    OR (SELECT count(*) FROM public.workflow_execution_steps WHERE execution_id=execution AND node_id='ask')<>1 THEN RAISE EXCEPTION 'FAIL duplicate resolution'; END IF;
  IF public.receive_workflow_button_reply(a,other_org)->'recognized' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'FAIL cross tenant receive'; END IF;
  -- A fresh occurrence releases on cancellation, including acceptance arriving late.
  UPDATE public.workflow_executions SET current_node_id='ask',status='running' WHERE id=execution;
  reservation:=public.prepare_workflow_button_question(execution,org,'ask',2,instance,'5548999990000');
  q:=(reservation->>'id')::uuid;
  UPDATE public.workflow_executions SET status='cancelled' WHERE id=execution;
  IF (SELECT state FROM public.workflow_button_questions WHERE id=q) IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'FAIL cancel release'; END IF;
  IF public.accept_workflow_button_question(q,org,'late-wa-id',clock_timestamp())
    OR (SELECT state FROM public.workflow_button_questions WHERE id=q) IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'FAIL acceptance resurrected cancellation'; END IF;
  UPDATE public.organizations SET feature_flags='{}' WHERE id=org;
  IF public.freeze_workflow_button_definition(execution,org) IS DISTINCT FROM definition THEN RAISE EXCEPTION 'FAIL in-flight snapshot lost when flag disabled'; END IF;
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,definition,is_active)
    VALUES(disabled_workflow,org,'Synthetic disabled workflow','manual',definition,false);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(disabled_execution,disabled_workflow,org,lead,'ask','running');
  blocked:=false;
  BEGIN
    PERFORM public.freeze_workflow_button_definition(disabled_execution,org);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='question_feature_disabled' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL SQL gate default off'; END IF;
END
$test$;
SELECT 'PASS: grants, snapshot, tenant isolation, reservation, early reply, persisted order, duplicate, deadline, cancellation, flag-off, duplicate edge' AS result;
