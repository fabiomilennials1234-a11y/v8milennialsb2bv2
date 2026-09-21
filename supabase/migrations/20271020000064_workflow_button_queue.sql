-- FIFO is scoped to tenant, WhatsApp instance and normalized conversation phone.
ALTER TABLE public.workflow_button_questions DROP CONSTRAINT workflow_button_questions_state_check;
ALTER TABLE public.workflow_button_questions ADD CONSTRAINT workflow_button_questions_state_check
  CHECK(state IN ('queued','sending','waiting','uncertain','resolved','cancelled'));
ALTER TABLE public.workflow_button_questions ADD COLUMN content jsonb, ADD COLUMN send_started_at timestamptz;
UPDATE public.workflow_button_questions SET send_started_at=created_at WHERE state IN ('sending','waiting','uncertain');
DROP INDEX public.workflow_button_questions_active_conversation;
CREATE UNIQUE INDEX workflow_button_questions_active_conversation
  ON public.workflow_button_questions(organization_id,instance_id,phone) WHERE state IN ('sending','waiting','uncertain');
CREATE INDEX workflow_button_questions_queue ON public.workflow_button_questions(organization_id,instance_id,phone,created_at,id) WHERE state='queued';
CREATE OR REPLACE FUNCTION public.prepare_workflow_button_question(
  p_execution_id uuid, p_organization_id uuid, p_node_id text, p_visit integer, p_instance_id uuid, p_phone text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE e public.workflow_executions; q public.workflow_button_questions; n jsonb; dest jsonb; actual_phone text; initial_state text;
BEGIN
  SELECT * INTO e FROM public.workflow_executions WHERE id=p_execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.lead_id IS NULL OR e.question_buttons_definition IS NULL THEN RAISE EXCEPTION 'question_execution_unavailable'; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE execution_id=e.id AND node_id=p_node_id
    AND (visit=p_visit OR state IN ('queued','sending','waiting','uncertain')) ORDER BY visit DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('id',q.id,'send',false); END IF;
  IF e.status NOT IN ('running','processing') OR e.current_node_id IS DISTINCT FROM p_node_id THEN RAISE EXCEPTION 'question_execution_not_running'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances WHERE id=p_instance_id AND organization_id=p_organization_id AND status IN ('open','connected')) THEN RAISE EXCEPTION 'question_instance_unavailable'; END IF;
  SELECT regexp_replace(phone,'[^0-9]','','g') INTO actual_phone FROM public.leads WHERE id=e.lead_id AND organization_id=p_organization_id;
  IF actual_phone NOT LIKE '55%' THEN actual_phone := '55'||actual_phone; END IF;
  IF actual_phone IS NULL OR actual_phone<>p_phone THEN RAISE EXCEPTION 'question_recipient_unavailable'; END IF;
  SELECT value->'data' INTO n FROM jsonb_array_elements(e.question_buttons_definition->'nodes') WHERE value->>'id'=p_node_id AND value->>'type'='question_buttons';
  IF n IS NULL OR jsonb_typeof(n->'buttons') <> 'array' OR jsonb_array_length(n->'buttons') NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  SELECT jsonb_object_agg(value->>'sourceHandle',value->>'target') INTO dest
    FROM jsonb_array_elements(e.question_buttons_definition->'edges') WHERE value->>'source'=p_node_id;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
    WHERE ed->>'source'=p_node_id GROUP BY ed->>'sourceHandle' HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
      WHERE ed->>'source'=p_node_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') nd WHERE nd->>'id'=ed->>'target'))
    THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(n->'buttons') b
    WHERE b->>'id' !~ '^[A-Za-z0-9_-]+$' OR nullif(b->>'label','') IS NULL OR b->>'label' ~ '[|\r\n]'
      OR (SELECT count(*) FROM jsonb_array_elements(e.question_buttons_definition->'edges') ed
        WHERE ed->>'source'=p_node_id AND ed->>'sourceHandle'='button:'||(b->>'id')
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.question_buttons_definition->'nodes') nd WHERE nd->>'id'=ed->>'target'))<>1)
    THEN RAISE EXCEPTION 'question_invalid_configuration'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_instance_id::text||':'||p_phone,0));
  initial_state:=CASE WHEN EXISTS(SELECT 1 FROM public.workflow_button_questions w
    WHERE w.organization_id=p_organization_id AND w.instance_id=p_instance_id AND w.phone=p_phone
      AND w.state IN ('queued','sending','waiting','uncertain')) THEN 'queued' ELSE 'sending' END;
  INSERT INTO public.workflow_button_questions(organization_id,execution_id,lead_id,instance_id,node_id,visit,phone,options,destinations,timeout_hours,state,content,send_started_at)
    VALUES(p_organization_id,e.id,e.lead_id,p_instance_id,p_node_id,p_visit,p_phone,n->'buttons',dest,coalesce((n->>'timeoutHours')::numeric,24),initial_state,n,CASE WHEN initial_state='sending' THEN clock_timestamp() END) RETURNING * INTO q;
  UPDATE public.workflow_executions SET status='paused', next_run_at=NULL, updated_at=clock_timestamp(),
    guided_condition_retry_node_id=NULL,guided_condition_retry_count=0,guided_condition_retry_error=NULL WHERE id=e.id AND organization_id=p_organization_id;
  RETURN jsonb_build_object('id',q.id,'send',q.state='sending');
END $$;

CREATE OR REPLACE FUNCTION public.cancel_workflow_button_questions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.question_buttons_definition IS NOT NULL AND NEW.status IN ('cancelled','completed','failed','loop_limit_reached') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.workflow_button_questions SET state='cancelled'
      WHERE execution_id=NEW.id AND organization_id=NEW.organization_id AND state IN ('queued','sending','waiting','uncertain');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.register_workflow_button_ingress(p_organization_id uuid,p_instance_id uuid,p_payload jsonb,p_source text DEFAULT 'webhook')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.workflow_button_questions; previous public.workflow_button_ingress; e public.workflow_executions;
  msg_id text; jid text; recipient_phone text; msg_type text; choice text; occurrence text; selected text; quote text;
  structured boolean; candidate_kind text; matching integer; question_id uuid; received_clock timestamptz;
BEGIN
  msg_id:=coalesce(nullif(p_payload->>'id',''),nullif(p_payload->>'messageid',''),nullif(p_payload#>>'{key,id}',''));
  IF msg_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE id=p_instance_id AND organization_id=p_organization_id) THEN
    RETURN jsonb_build_object('recognized',false);
  END IF;
  SELECT * INTO previous FROM public.workflow_button_ingress
    WHERE organization_id=p_organization_id AND instance_id=p_instance_id AND message_id=msg_id;
  IF FOUND THEN
    RETURN jsonb_build_object('recognized',previous.kind='reply','question_id',previous.question_id,'received_at',previous.received_at);
  END IF;
  -- A replay without an original admission cannot invent a receipt timestamp.
  IF p_source IS DISTINCT FROM 'webhook' OR coalesce(p_payload->>'source','')='history_sync'
    OR coalesce(p_payload->>'received_via','')='history_sync'
    OR coalesce(p_payload->>'fromMe',p_payload->>'fromme','false')<>'false' THEN
    RETURN jsonb_build_object('recognized',false);
  END IF;
  jid:=coalesce(nullif(p_payload->>'_phone_jid',''),nullif(p_payload->>'chatid',''),p_payload->>'remoteJid',p_payload->>'from',p_payload->>'to','');
  IF jid LIKE '%@g.us' OR coalesce(p_payload->>'isGroup','false')='true' THEN RETURN jsonb_build_object('recognized',false); END IF;
  IF jid LIKE '%@lid' THEN jid:=coalesce(p_payload->>'_phone_jid',p_payload->>'sender_pn',p_payload->>'from',''); END IF;
  recipient_phone:=regexp_replace(split_part(jid,'@',1),'[^0-9]','','g');
  IF recipient_phone='' THEN RETURN jsonb_build_object('recognized',false); END IF;
  IF recipient_phone NOT LIKE '55%' THEN recipient_phone:='55'||recipient_phone; END IF;
  msg_type:=lower(coalesce(nullif(p_payload->>'messageType',''),nullif(p_payload->>'mediaType',''),nullif(p_payload->>'type',''),CASE WHEN p_payload ? 'text' THEN 'text' ELSE '' END));
  choice:=nullif(p_payload->>'buttonOrListid',''); quote:=nullif(p_payload->>'quoted','');
  structured:=choice IS NOT NULL OR msg_type ~ '(button|list|interactive)'
    OR nullif(p_payload->>'selectedButtonId','') IS NOT NULL OR nullif(p_payload->>'selectedRowId','') IS NOT NULL
    OR p_payload ?| ARRAY['buttonsResponseMessage','templateButtonReplyMessage','listResponseMessage','interactiveResponseMessage'];
  IF structured THEN
    candidate_kind:='ignored'; occurrence:=split_part(choice,':',1); selected:=split_part(choice,':',2);
    IF occurrence ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND selected ~ '^[A-Za-z0-9_-]+$' AND choice=occurrence||':'||selected THEN
      SELECT * INTO q FROM public.workflow_button_questions WHERE id=occurrence::uuid AND organization_id=p_organization_id
        AND instance_id=p_instance_id AND phone=recipient_phone;
      IF FOUND AND quote IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.options) o WHERE o->>'id'=selected) THEN
        candidate_kind:='reply'; question_id:=q.id;
      END IF;
    END IF;
  ELSE
    candidate_kind:=CASE WHEN msg_type IN ('conversation','text','extendedtextmessage','image','imagemessage','audio','audiomessage',
      'ptt','pttmessage','ptv','ptvmessage','video','videomessage','document','documentmessage','sticker','stickermessage','contact','contactmessage',
      'contactsarraymessage','contact_array','vcard','poll','pollcreationmessage','album','albummessage','location','locationmessage','livelocationmessage','livelocation','media') THEN 'other' ELSE 'ignored' END;
  END IF;
  IF question_id IS NULL THEN
    SELECT count(*),(array_agg(id))[1] INTO matching,question_id FROM public.workflow_button_questions
      WHERE organization_id=p_organization_id AND instance_id=p_instance_id AND phone=recipient_phone
        AND state IN ('sending','waiting','uncertain');
    IF matching<>1 THEN RETURN jsonb_build_object('recognized',false); END IF;
  END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=question_id AND organization_id=p_organization_id;
  SELECT * INTO e FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=question_id AND organization_id=p_organization_id FOR UPDATE;
  IF q.state NOT IN ('sending','waiting','uncertain') OR e.status<>'paused' THEN
    RETURN jsonb_build_object('recognized',structured AND candidate_kind='reply','question_id',q.id);
  END IF;
  -- Clock is read AFTER admission owns the same locks used by timeout. It cannot
  -- backdate an event behind a timeout decision that never had a chance to see it.
  received_clock:=clock_timestamp();
  INSERT INTO public.workflow_button_ingress(organization_id,instance_id,question_id,message_id,kind,option_id,quoted,received_at)
    VALUES(p_organization_id,p_instance_id,q.id,msg_id,candidate_kind,selected,quote,received_clock)
    ON CONFLICT(organization_id,instance_id,message_id) DO NOTHING;
  SELECT * INTO previous FROM public.workflow_button_ingress
    WHERE organization_id=p_organization_id AND instance_id=p_instance_id AND message_id=msg_id;
  RETURN jsonb_build_object('recognized',previous.kind='reply','question_id',previous.question_id,'received_at',previous.received_at);
END $$;

CREATE OR REPLACE FUNCTION public.claim_workflow_button_send_checks(p_limit integer DEFAULT 5)
RETURNS SETOF public.workflow_button_questions LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN QUERY WITH candidates AS (
    SELECT q.id FROM public.workflow_button_questions q
    JOIN public.workflow_executions e ON e.id=q.execution_id AND e.organization_id=q.organization_id
    WHERE q.state IN ('sending','uncertain') AND q.send_check_count<12
      AND q.send_started_at<=clock_timestamp()-interval '2 minutes'
      AND (q.next_send_check_at IS NULL OR q.next_send_check_at<=clock_timestamp())
      AND e.status='paused' AND e.current_node_id=q.node_id
    ORDER BY q.next_send_check_at NULLS FIRST,q.created_at,q.id
    LIMIT least(greatest(coalesce(p_limit,5),1),5) FOR UPDATE OF q SKIP LOCKED
  ) UPDATE public.workflow_button_questions q SET state='uncertain',send_check_count=q.send_check_count+1,
      next_send_check_at=clock_timestamp()+interval '5 minutes',last_send_check='checking'
    FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;
CREATE FUNCTION public.claim_workflow_button_queue(p_limit integer DEFAULT 5)
RETURNS SETOF public.workflow_button_questions LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE candidate record; q public.workflow_button_questions; e public.workflow_executions; claimed integer:=0;
BEGIN
  FOR candidate IN SELECT w.id,w.execution_id,w.organization_id,w.instance_id,w.phone
    FROM public.workflow_button_questions w
    WHERE w.state='queued'
      AND NOT EXISTS(SELECT 1 FROM public.workflow_button_questions a WHERE a.organization_id=w.organization_id
        AND a.instance_id=w.instance_id AND a.phone=w.phone AND a.state IN ('sending','waiting','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM public.workflow_button_questions older WHERE older.organization_id=w.organization_id
        AND older.instance_id=w.instance_id AND older.phone=w.phone AND older.state='queued'
        AND (older.created_at,older.id)<(w.created_at,w.id))
    ORDER BY w.created_at,w.id LIMIT 100
  LOOP
    EXIT WHEN claimed>=least(greatest(coalesce(p_limit,5),1),5);
    SELECT * INTO e FROM public.workflow_executions WHERE id=candidate.execution_id AND organization_id=candidate.organization_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR e.status<>'paused' THEN CONTINUE; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(candidate.organization_id::text||':'||candidate.instance_id::text||':'||candidate.phone,0)) THEN CONTINUE; END IF;
    SELECT * INTO q FROM public.workflow_button_questions WHERE id=candidate.id AND organization_id=candidate.organization_id FOR UPDATE;
    IF q.state<>'queued' OR e.current_node_id<>q.node_id THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM public.workflow_button_questions a WHERE a.organization_id=q.organization_id AND a.instance_id=q.instance_id AND a.phone=q.phone
      AND (a.state IN ('sending','waiting','uncertain') OR (a.state='queued' AND (a.created_at,a.id)<(q.created_at,q.id)))) THEN CONTINUE; END IF;
    UPDATE public.workflow_button_questions SET state='sending',send_started_at=clock_timestamp() WHERE id=q.id RETURNING * INTO q;
    claimed:=claimed+1;
    RETURN NEXT q;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_workflow_button_queue(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_button_queue(integer) TO service_role;
