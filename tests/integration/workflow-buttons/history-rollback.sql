-- Companion runner wraps migrations 60+62 and this fixture in BEGIN/ROLLBACK.
-- Synthetic organization, inactive workflow, no credentials, no sender/legacy claim.

SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $test$
DECLARE
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid();
  instance uuid:=gen_random_uuid(); wf uuid:=gen_random_uuid(); execution uuid:=gen_random_uuid(); q uuid;
  admission_lead uuid:=gen_random_uuid(); admission_execution uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); visit integer:=0; kind text; admitted jsonb; again jsonb; payload jsonb; result jsonb; receipt timestamptz; did_resolve boolean;
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
  UPDATE public.workflow_button_questions SET state='uncertain',send_check_count=12 WHERE id=q;
  INSERT INTO public.leads(id,organization_id,name,phone) VALUES(admission_lead,org,'Synthetic admission recipient','5548999990001');
  INSERT INTO public.workflow_executions(id,workflow_id,organization_id,lead_id,current_node_id,status) VALUES(admission_execution,wf,org,admission_lead,'failure','completed');
  INSERT INTO public.workflow_execution_steps(execution_id,node_id,node_type,status,output_data) VALUES(admission_execution,'ask','question_buttons','success','{"admission_visit":1,"branch":"send_failure","reason":"instance_unavailable"}');
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(reader,'button-rollback-'||reader||'@example.invalid','{}');
  INSERT INTO public.master_users(user_id,permissions) VALUES(reader,'{"all":true}');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reader,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT to_jsonb(h) INTO result FROM public.get_workflow_button_history(execution) h;
  IF result->>'state' IS DISTINCT FROM 'uncertain' OR result->>'send_check_count'<>'12' OR result ?| ARRAY['phone','content','instance_id','outbound_message_id'] THEN RAISE EXCEPTION 'FAIL safe history'; END IF;
  SELECT to_jsonb(h) INTO result FROM public.get_workflow_button_history(admission_execution) h;
  IF result->>'state' IS DISTINCT FROM 'resolved' OR result->>'failure_reason' IS DISTINCT FROM 'instance_unavailable' OR result->>'selected_handle' IS DISTINCT FROM 'send_failure' THEN RAISE EXCEPTION 'FAIL admission failure history'; END IF;
  RESET ROLE;
  UPDATE public.master_users SET permissions='{}' WHERE user_id=reader;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_workflow_button_history(execution);
    RAISE EXCEPTION 'FAIL restricted master read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.master_users SET is_active=false WHERE user_id=reader;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.org_quotas(organization_id,resource_key,plan_base) VALUES(org,'max_users',1) ON CONFLICT(organization_id,resource_key) DO UPDATE SET plan_base=1;
  INSERT INTO public.team_members(user_id,name,role,organization_id,is_active) VALUES(reader,'Synthetic history admin','admin',org,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reader,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.get_workflow_button_history(execution))<>1 THEN RAISE EXCEPTION 'FAIL organization admin history'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_workflow_button_history(execution);
    RAISE EXCEPTION 'FAIL outsider read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('anon','public.get_workflow_button_history(uuid)','EXECUTE') OR has_function_privilege('service_role','public.get_workflow_button_history(uuid)','EXECUTE') OR NOT has_function_privilege('authenticated','public.get_workflow_button_history(uuid)','EXECUTE') THEN RAISE EXCEPTION 'FAIL anon history'; END IF;
END $test$;
RESET ROLE;
SELECT 'PASS safe history, revoked permissions and outsider denial' AS result;
