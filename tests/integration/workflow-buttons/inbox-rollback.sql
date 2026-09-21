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

  FOREACH kind IN ARRAY ARRAY['conversation','audioMessage','imageMessage','documentMessage','stickerMessage','videoMessage','contactMessage','locationMessage','PttMessage','PtvMessage','PollCreationMessage','AlbumMessage','vcard'] LOOP
    visit:=visit+1;
    UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
    q:=(public.prepare_workflow_button_question(execution,org,'ask',visit,instance,'5548999990000')->>'id')::uuid;
    PERFORM public.accept_workflow_button_question(q,org,'outbound-'||q,clock_timestamp());
    payload:=jsonb_build_object('messageid','free-'||q,'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType',kind,'text','Synthetic content');
    admitted:=public.register_workflow_button_ingress(org,instance,payload,'webhook');
    IF admitted->>'question_id' IS DISTINCT FROM q::text THEN RAISE EXCEPTION 'FAIL media admission %',kind; END IF;
    did_resolve:=public.resolve_workflow_button_question(q,org);
    IF NOT did_resolve
      OR (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'other_response'
      OR (SELECT current_node_id FROM public.workflow_executions WHERE id=execution)<>'other' THEN
      RAISE EXCEPTION 'FAIL Outra resposta %',kind;
    END IF;
  END LOOP;

  -- Delivery can beat persistence of the HTTP acceptance; the timer has not started yet.
  visit:=visit+1;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',visit,instance,'5548999990000')->>'id')::uuid;
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','early-'||q,
    'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType','ButtonsResponseMessage','buttonOrListid',q||':a','quoted','outbound-'||q),'webhook');
  did_resolve:=public.resolve_workflow_button_question(q,org);
  IF (SELECT deadline_at FROM public.workflow_button_questions WHERE id=q) IS NOT NULL OR did_resolve THEN
    RAISE EXCEPTION 'FAIL timer/route started before acceptance';
  END IF;
  PERFORM public.accept_workflow_button_question(q,org,'outbound-'||q,clock_timestamp());
  IF (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'button:a'
    OR (SELECT deadline_at-accepted_at FROM public.workflow_button_questions WHERE id=q)<>interval '24 hours' THEN
    RAISE EXCEPTION 'FAIL early receipt or acceptance-based timer';
  END IF;

  -- A durably admitted reply wins even without any whatsapp_messages persistence.
  visit:=visit+1;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',visit,instance,'5548999990000')->>'id')::uuid;
  PERFORM public.accept_workflow_button_question(q,org,'outbound-'||q,clock_timestamp());
  payload:=jsonb_build_object('messageid','first-'||q,'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType','ButtonsResponseMessage','buttonOrListid',q||':a','quoted','outbound-'||q);
  admitted:=public.register_workflow_button_ingress(org,instance,payload,'webhook');
  again:=public.register_workflow_button_ingress(org,instance,payload,'dlq_replay');
  IF admitted->>'received_at' IS DISTINCT FROM again->>'received_at' THEN RAISE EXCEPTION 'FAIL replay rebased receipt'; END IF;
  PERFORM public.register_workflow_button_ingress(org,instance,payload||jsonb_build_object('messageid','second-'||q,'buttonOrListid',q||':b'),'webhook');
  SELECT max(received_at) INTO receipt FROM public.workflow_button_ingress WHERE question_id=q;
  -- Deterministic clock fixture: processing happens after the deadline, receipt before it.
  UPDATE public.workflow_button_questions SET deadline_at=receipt+interval '1 microsecond' WHERE id=q;
  PERFORM pg_sleep(0.002);
  result:=public.reconcile_workflow_button_questions(20);
  IF (result->>'resolved')::int<>1 OR (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'button:a' THEN
    RAISE EXCEPTION 'FAIL delayed processing lost first durable admission';
  END IF;
  IF public.resolve_workflow_button_question(q,org) THEN RAISE EXCEPTION 'FAIL replay advanced twice'; END IF;

  -- Invalid/old selections, receipts, reactions, own messages and history never become free text.
  visit:=visit+1;
  UPDATE public.workflow_executions SET status='running',current_node_id='ask' WHERE id=execution;
  q:=(public.prepare_workflow_button_question(execution,org,'ask',visit,instance,'5548999990000')->>'id')::uuid;
  PERFORM public.accept_workflow_button_question(q,org,'outbound-'||q,clock_timestamp());
  FOREACH kind IN ARRAY ARRAY['ReactionMessage','read','receipt','ButtonsResponseMessage','TemplateButtonReplyMessage','protocolMessage'] LOOP
    PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','ignored-'||q||kind,'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType',kind,'text','A')
      ||CASE WHEN kind IN ('ButtonsResponseMessage','TemplateButtonReplyMessage') THEN '{"buttonOrListid":"stale-option"}'::jsonb ELSE '{}'::jsonb END,'webhook');
  END LOOP;
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','own-'||q,'chatid','5548999990000@s.whatsapp.net','fromMe',true,'messageType','conversation','text','Own'),'webhook');
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','history-'||q,'chatid','5548999990000@s.whatsapp.net','fromMe',false,'messageType','conversation','text','Old'),'history_sync');
  PERFORM public.register_workflow_button_ingress(org,instance,payload,'webhook'); -- old valid click from previous occurrence
  IF public.resolve_workflow_button_question(q,org) THEN RAISE EXCEPTION 'FAIL ignored event resolved active question'; END IF;
  UPDATE public.workflow_button_questions SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=q;
  did_resolve:=public.resolve_workflow_button_question(q,org);
  IF NOT did_resolve OR (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'timeout' THEN
    RAISE EXCEPTION 'FAIL timeout without eligible receipt';
  END IF;
  PERFORM public.register_workflow_button_ingress(org,instance,jsonb_build_object('messageid','late-'||q,'chatid','5548999990000@s.whatsapp.net','fromMe',false,
    'messageType','ButtonsResponseMessage','buttonOrListid',q||':a','quoted','outbound-'||q,'messageTimestamp',1),'webhook');
  IF (SELECT selected_handle FROM public.workflow_button_questions WHERE id=q)<>'timeout' THEN RAISE EXCEPTION 'FAIL old client timestamp reopened timeout'; END IF;
  IF public.register_workflow_button_ingress(other_org,instance,payload,'webhook')->'recognized' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'FAIL cross organization admission';
  END IF;
END $test$;
RESET ROLE;
SELECT 'PASS ingress ordering, replay, media, timeout, restart recovery and isolation; concurrency not proven' AS result;
