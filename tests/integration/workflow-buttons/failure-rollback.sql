-- Companion runner wraps migrations 60+62 and this fixture in BEGIN/ROLLBACK.
-- Synthetic organization, inactive workflow, no credentials, no sender/legacy claim.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
  instance uuid:=gen_random_uuid(); wf uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); q uuid;
  visit integer:=0; kind text; admitted jsonb; again jsonb; payload jsonb; result jsonb; receipt timestamptz; did_resolve boolean;
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
  did_resolve:=public.fail_workflow_button_question(q,org,'provider_rejected');
  IF NOT did_resolve OR (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'send_failure'
    OR (SELECT current_node_id FROM public.workflow_executions WHERE id=execution)<>'failure' THEN RAISE EXCEPTION 'FAIL explicit failure routing'; END IF;
  IF public.fail_workflow_button_question(q,org,'provider_rejected') THEN RAISE EXCEPTION 'FAIL duplicate failure'; END IF;
  IF public.accept_workflow_button_question(q,org,'late-accept',clock_timestamp()) THEN RAISE EXCEPTION 'FAIL accept after failure'; END IF;
  IF (SELECT count(*) FROM public.workflow_execution_steps WHERE execution_id=execution)<>1 THEN RAISE EXCEPTION 'FAIL duplicate step'; END IF;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',2,instance,'5548999990000')->>'id')::uuid;
  IF EXISTS(SELECT 1 FROM public.claim_workflow_button_send_checks(5)) THEN RAISE EXCEPTION 'FAIL checking live send'; END IF;
  UPDATE public.workflow_button_questions SET created_at=clock_timestamp()-interval '3 minutes' WHERE id=q;
  IF (SELECT count(*) FROM public.claim_workflow_button_send_checks(5))<>1 THEN RAISE EXCEPTION 'FAIL lost HTTP check'; END IF;
  IF EXISTS(SELECT 1 FROM public.claim_workflow_button_send_checks(5)) THEN RAISE EXCEPTION 'FAIL duplicate check claim'; END IF;
  IF (SELECT deadline_at FROM public.workflow_button_questions WHERE id=q) IS NOT NULL THEN RAISE EXCEPTION 'FAIL clock starts while uncertain'; END IF;
  PERFORM public.accept_workflow_button_question(q,org,'recovered-id',clock_timestamp()-interval '1 hour');
  IF (SELECT deadline_at-accepted_at FROM public.workflow_button_questions WHERE id=q)<>interval '24 hours' THEN RAISE EXCEPTION 'FAIL recovered deadline'; END IF;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  UPDATE public.workflow_button_questions SET state='resolved' WHERE id=q;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',3,instance,'5548999990000')->>'id')::uuid;
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','early-failed-'||q,
    'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType','ButtonsResponseMessage','buttonOrListid',q||':a','quoted','failed-out-'||q),'webhook');
  did_resolve:=public.fail_workflow_button_question(q,org,'provider_rejected','failed-out-'||q,clock_timestamp());
  IF NOT did_resolve OR (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'button:a' THEN RAISE EXCEPTION 'FAIL valid reply lost to late failure'; END IF;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',4,instance,'5548999990000')->>'id')::uuid;
  UPDATE public.workflow_button_questions SET state='uncertain',created_at=clock_timestamp()-interval '2 hours',send_check_count=12,next_send_check_at=clock_timestamp()-interval '1 hour' WHERE id=q;
  IF EXISTS(SELECT 1 FROM public.claim_workflow_button_send_checks(5)) THEN RAISE EXCEPTION 'FAIL exhausted check budget'; END IF;
  IF (SELECT state FROM public.workflow_button_questions WHERE id=q)<>'uncertain' THEN RAISE EXCEPTION 'FAIL budget exhaustion finalized unknown send'; END IF;
  IF public.fail_workflow_button_question(q,other_org,'provider_rejected') THEN RAISE EXCEPTION 'FAIL cross organization failure'; END IF;
  UPDATE public.workflow_executions SET status='cancelled' WHERE id=execution;
  IF public.fail_workflow_button_question(q,org,'provider_rejected') THEN RAISE EXCEPTION 'FAIL failure reopened cancellation'; END IF;
  IF has_function_privilege('authenticated','public.claim_workflow_button_send_checks(integer)','EXECUTE')
    OR has_function_privilege('anon','public.fail_workflow_button_question(uuid,uuid,text,text,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'FAIL recovery grants'; END IF;
END $test$;
RESET ROLE;
SELECT 'PASS failure routing, recovery claims, acceptance clock, replay, late failure and grants' AS result;
