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


  UPDATE public.whatsapp_instances SET phone_number='5551999990000' WHERE id=instance;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',1,instance,'5548999990000')->>'id')::uuid;
  receipt:=clock_timestamp();
  PERFORM public.accept_workflow_button_question(q,org,'original-wa-id',receipt);
  SELECT to_jsonb(m) INTO result FROM public.whatsapp_messages m WHERE instance_id=instance AND message_id='5551999990000:original-wa-id';
  IF result IS NULL OR result->>'sent_source' IS DISTINCT FROM 'workflow' OR result->>'lead_id' IS DISTINCT FROM lead::text OR result->>'content' IS DISTINCT FROM 'Synthetic question' OR result#>'{raw_payload,torqueInteractive,options}' IS DISTINCT FROM '["A","B"]'::jsonb OR (result->>'timestamp')::timestamptz IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'FAIL accepted question missing from chat'; END IF;
  UPDATE public.whatsapp_messages SET status='read' WHERE instance_id=instance AND message_id='5551999990000:original-wa-id';
  UPDATE public.workflow_button_questions SET accepted_at=accepted_at WHERE id=q;
  PERFORM public.accept_workflow_button_question(q,org,'original-wa-id',clock_timestamp());
  IF (SELECT count(*) FROM public.whatsapp_messages WHERE instance_id=instance AND message_id='5551999990000:original-wa-id')<>1 OR (SELECT status FROM public.whatsapp_messages WHERE instance_id=instance AND message_id='5551999990000:original-wa-id')<>'read' THEN RAISE EXCEPTION 'FAIL duplicate or receipt downgrade'; END IF;
END $test$;
RESET ROLE;
SELECT 'PASS accepted question visible in chat, labels, original time, replay and receipt preservation' AS result;
