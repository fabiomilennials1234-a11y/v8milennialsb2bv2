-- Companion runner wraps migrations 60+62 and this fixture in BEGIN/ROLLBACK.
-- Synthetic organization, inactive workflow, no credentials, no sender/legacy claim.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
  instance uuid:=gen_random_uuid(); wf uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); q uuid;
  visit integer:=0; kind text; admitted jsonb; again jsonb; payload jsonb; result jsonb; receipt timestamptz; did_resolve boolean;
  graph jsonb:='{"nodes":[{"id":"ask","type":"question_buttons","data":{"text":"Synthetic question","timeoutHours":24,"buttons":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}},{"id":"a","type":"end","data":{}},{"id":"b","type":"end","data":{}},{"id":"other","type":"end","data":{}},{"id":"timeout","type":"end","data":{}},{"id":"failure","type":"end","data":{}}],"edges":[{"source":"ask","sourceHandle":"button:a","target":"a"},{"source":"ask","sourceHandle":"button:b","target":"b"},{"source":"ask","sourceHandle":"other_response","target":"other"},{"source":"ask","sourceHandle":"timeout","target":"timeout"},{"source":"ask","sourceHandle":"send_failure","target":"failure"}]}';
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
    VALUES(wf,org,'Synthetic inbox rollback workflow','manual',graph,false,true);
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status)
    VALUES(execution,wf,org,lead,'ask','running');
  PERFORM public.freeze_workflow_button_definition(execution,org);


  UPDATE public.workflows SET definition=jsonb_set(workflows.definition,'{edges}','[]') WHERE id=wf;
  BEGIN
    UPDATE public.workflows SET is_active=true WHERE id=wf;
    RAISE EXCEPTION 'FAIL activated missing branches';
  EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE public.workflows SET definition=jsonb_set(graph,'{nodes,0,data,instanceId}',to_jsonb(instance::text)) WHERE id=wf;
  UPDATE public.workflows SET is_active=true WHERE id=wf;
  BEGIN
    UPDATE public.workflows SET definition=jsonb_set(workflows.definition,'{nodes,0,data,instanceId}',to_jsonb(gen_random_uuid()::text)) WHERE id=wf;
    RAISE EXCEPTION 'FAIL active edit accepted missing instance';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.workflows SET is_active=false WHERE id=wf;
  UPDATE public.workflows SET definition=jsonb_set(graph,'{nodes,0,data,image}',jsonb_build_object('bucket','workflow-question-images','path',other_org||'/'||gen_random_uuid()||'.png','mimeType','image/png','sizeBytes',512)) WHERE id=wf;
  BEGIN
    UPDATE public.workflows SET is_active=true WHERE id=wf;
    RAISE EXCEPTION 'FAIL activated foreign image';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.workflows SET definition=jsonb_set(graph,'{nodes,0,data,image}',jsonb_build_object('bucket','workflow-question-images','path',org||'/'||gen_random_uuid()||'.png','mimeType','image/png','sizeBytes',512)) WHERE id=wf;
  BEGIN
    UPDATE public.workflows SET is_active=true WHERE id=wf;
    RAISE EXCEPTION 'FAIL activated missing image';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.workflows SET definition=graph WHERE id=wf;
  IF has_function_privilege('anon','public.guard_workflow_button_activation()','EXECUTE') OR has_function_privilege('authenticated','public.guard_workflow_button_activation()','EXECUTE') OR has_function_privilege('service_role','public.guard_workflow_button_activation()','EXECUTE') THEN RAISE EXCEPTION 'FAIL activation trigger grants'; END IF;
  UPDATE public.organizations SET feature_flags='{}' WHERE id=org;
  BEGIN
    UPDATE public.workflows SET is_active=true WHERE id=wf;
    RAISE EXCEPTION 'FAIL activated gate off';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'PASS activation validation' AS result;
