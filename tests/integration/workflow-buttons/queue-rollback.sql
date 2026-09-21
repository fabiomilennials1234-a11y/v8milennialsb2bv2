-- Companion runner wraps migrations 60+62 and this fixture in BEGIN/ROLLBACK.
-- Synthetic organization, inactive workflow, no credentials, no sender/legacy claim.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
  instance uuid:=gen_random_uuid(); wf uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); q uuid;
  wf2 uuid:=gen_random_uuid(); execution2 uuid:=gen_random_uuid(); lead2 uuid:=gen_random_uuid(); q2 uuid; promoted jsonb; visit integer:=0; kind text; admitted jsonb; again jsonb; payload jsonb; result jsonb; receipt timestamptz; did_resolve boolean;
  definition jsonb:='{"nodes":[{"id":"ask","type":"question_buttons","data":{"text":"Synthetic question","timeoutHours":24,"buttons":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}},{"id":"a","type":"end","data":{}},{"id":"b","type":"end","data":{}},{"id":"other","type":"end","data":{}},{"id":"timeout","type":"end","data":{}},{"id":"failure","type":"end","data":{}}],"edges":[{"source":"ask","sourceHandle":"button:a","target":"a"},{"source":"ask","sourceHandle":"button:b","target":"b"},{"source":"ask","sourceHandle":"other_response","target":"other"},{"source":"ask","sourceHandle":"timeout","target":"timeout"},{"source":"ask","sourceHandle":"send_failure","target":"failure"}]}';
BEGIN
  IF has_function_privilege('authenticated','public.register_workflow_button_ingress(uuid,uuid,jsonb,text)','EXECUTE')
    OR has_function_privilege('anon','public.reconcile_workflow_button_questions(integer)','EXECUTE')
    OR has_table_privilege('authenticated','public.workflow_button_ingress','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'FAIL ingress privileges';
  END IF;
  INSERT INTO public.organizations(id,name,slug,is_sandbox,feature_flags)
    VALUES(org,'Workflow button inbox rollback test','button-rollback-'||org,true,'{"workflow_question_buttons":true}'),
          (other_org,'Workflow button inbox isolation test','button-rollback-'||other_org,true,'{}');
  INSERT INTO public.leads(id,organization_id,name,phone) VALUES(lead,org,'Synthetic inbox recipient','5548999990000');
  INSERT INTO public.org_quotas(organization_id,resource_key,plan_base) VALUES(org,'max_whatsapp_instances',1)
    ON CONFLICT(organization_id,resource_key) DO UPDATE SET plan_base=1;
  INSERT INTO public.whatsapp_instances(id,organization_id,instance_name,status,provider)
    VALUES(instance,org,'synthetic-inbox-no-credentials','connected','uazapi');
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,definition,is_active,re_enrollment_enabled)
    VALUES(wf,org,'Synthetic inbox rollback workflow','manual',definition,false,true);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(execution,wf,org,lead,'ask','running');
  PERFORM public.freeze_workflow_button_definition(execution,org);


  q:=(public.prepare_workflow_button_question(execution,org,'ask',1,instance,'5548999990000')->>'id')::uuid;
  INSERT INTO public.workflows(id,organization_id,name,trigger_type,definition,is_active,re_enrollment_enabled) VALUES(wf2,org,'Second synthetic workflow','manual',definition,false,true);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(execution2,wf2,org,lead,'ask','running');
  PERFORM public.freeze_workflow_button_definition(execution2,org);
  admitted:=public.prepare_workflow_button_question(execution2,org,'ask',1,instance,'5548999990000');
  q2:=(admitted->>'id')::uuid;
  IF admitted->>'send'<>'false' OR (SELECT state FROM public.workflow_button_questions WHERE id=q2)<>'queued' THEN RAISE EXCEPTION 'FAIL second conversation question sent'; END IF;
  IF (SELECT deadline_at FROM public.workflow_button_questions WHERE id=q2) IS NOT NULL THEN RAISE EXCEPTION 'FAIL queued timer'; END IF;
  IF EXISTS(SELECT 1 FROM public.claim_workflow_button_queue(5)) THEN RAISE EXCEPTION 'FAIL promoted while prior active'; END IF;
  PERFORM public.fail_workflow_button_question(q,org,'send_preflight_failed');
  IF (SELECT status FROM public.workflow_executions WHERE id=execution)<>'running' THEN RAISE EXCEPTION 'FAIL prior branch not running'; END IF;
  SELECT to_jsonb(c) INTO promoted FROM public.claim_workflow_button_queue(5) c;
  IF promoted->>'id' IS DISTINCT FROM q2::text THEN RAISE EXCEPTION 'FAIL release waits for downstream branch'; END IF;
  IF promoted#>>'{content,text}' IS DISTINCT FROM 'Synthetic question' THEN RAISE EXCEPTION 'FAIL frozen content'; END IF;
  IF EXISTS(SELECT 1 FROM public.claim_workflow_button_queue(5)) THEN RAISE EXCEPTION 'FAIL duplicate queue claim'; END IF;
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','before-send-'||q2,
    'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType','conversation','text','Before own send'),'webhook');
  PERFORM pg_sleep(0.002);
  PERFORM public.accept_workflow_button_question(q2,org,'queued-out',clock_timestamp());
  IF (SELECT state FROM public.workflow_button_questions WHERE id=q2)<>'waiting' THEN RAISE EXCEPTION 'FAIL consumed free message preceding send'; END IF;
  UPDATE public.workflow_executions SET status='cancelled' WHERE id=execution2;
  IF (SELECT state FROM public.workflow_button_questions WHERE id=q2)<>'cancelled' THEN RAISE EXCEPTION 'FAIL cancel promoted question'; END IF;
END $test$;
RESET ROLE;
SELECT 'PASS same-conversation queue, node-only release and cancellation' AS result;
