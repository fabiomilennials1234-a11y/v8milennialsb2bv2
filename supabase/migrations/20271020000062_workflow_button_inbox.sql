-- Authoritative receipt = authenticated durable DB ingress, serialized with timeout.
-- Not the TCP arrival time, provider click timestamp, or later message processing time.
CREATE TABLE public.workflow_button_ingress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.workflow_button_questions(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reply','other','ignored')),
  option_id text, quoted text,
  received_at timestamptz NOT NULL,
  UNIQUE (organization_id,instance_id,message_id)
);
CREATE INDEX workflow_button_ingress_question_receipt ON public.workflow_button_ingress(organization_id,question_id,received_at,id);
ALTER TABLE public.workflow_button_ingress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_button_ingress FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workflow_button_ingress TO service_role;
ALTER TABLE public.workflow_button_questions ADD COLUMN selected_handle text;
CREATE INDEX workflow_button_questions_waiting_deadline ON public.workflow_button_questions(deadline_at,id) WHERE state='waiting';

CREATE OR REPLACE FUNCTION public.resolve_workflow_button_question(p_id uuid,p_organization_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q public.workflow_button_questions; e public.workflow_executions; r public.workflow_button_ingress;
  target text; output_handle text; resolved_clock timestamptz;
BEGIN
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO e FROM public.workflow_executions WHERE id=q.execution_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR e.status<>'paused' OR e.current_node_id<>q.node_id THEN RETURN false; END IF;
  SELECT * INTO q FROM public.workflow_button_questions WHERE id=p_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR q.state<>'waiting' THEN RETURN false; END IF;
  SELECT * INTO r FROM public.workflow_button_ingress
    WHERE question_id=q.id AND organization_id=p_organization_id AND instance_id=q.instance_id
      AND received_at<q.deadline_at AND (
        (kind='other' AND received_at>=q.accepted_at) OR (kind='reply' AND quoted=q.outbound_message_id
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.options) o WHERE o->>'id'=option_id)))
    ORDER BY received_at,id LIMIT 1;
  resolved_clock:=clock_timestamp();
  IF FOUND THEN
    output_handle:=CASE WHEN r.kind='other' THEN 'other_response' ELSE 'button:'||r.option_id END;
  ELSIF q.deadline_at<=resolved_clock THEN
    output_handle:='timeout';
  ELSE
    RETURN false;
  END IF;
  target:=q.destinations->>output_handle;
  IF target IS NULL THEN RAISE EXCEPTION 'question_destination_unavailable'; END IF;
  UPDATE public.workflow_button_questions SET state='resolved',selected_handle=output_handle,
    selected_option=CASE WHEN r.kind='reply' THEN r.option_id ELSE NULL END,resolved_at=resolved_clock WHERE id=q.id;
  INSERT INTO public.workflow_execution_steps(execution_id,node_id,node_type,node_label,status,output_data)
    VALUES(e.id,q.node_id,'question_buttons','Pergunta com botões','success',jsonb_build_object('question_id',q.id,'branch',output_handle));
  UPDATE public.workflow_executions SET status='running',current_node_id=target,next_run_at=resolved_clock,updated_at=resolved_clock
    WHERE id=e.id AND organization_id=p_organization_id;
  RETURN true;
END $$;

CREATE FUNCTION public.register_workflow_button_ingress(p_organization_id uuid,p_instance_id uuid,p_payload jsonb,p_source text DEFAULT 'webhook')
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
  IF q.state IN ('resolved','cancelled') OR e.status<>'paused' THEN
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

CREATE OR REPLACE FUNCTION public.receive_workflow_button_reply(p_message_row_id uuid,p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE m public.whatsapp_messages; r public.workflow_button_ingress;
BEGIN
  SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_row_id AND organization_id=p_organization_id;
  IF NOT FOUND OR m.direction<>'incoming' OR m.is_group THEN RETURN jsonb_build_object('recognized',false,'resolved',false); END IF;
  SELECT * INTO r FROM public.workflow_button_ingress WHERE organization_id=p_organization_id AND instance_id=m.instance_id AND message_id=m.message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('recognized',false,'resolved',false); END IF;
  RETURN jsonb_build_object('recognized',r.kind='reply','resolved',public.resolve_workflow_button_question(r.question_id,p_organization_id));
END $$;

CREATE FUNCTION public.reconcile_workflow_button_questions(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE q record; resolved_count integer:=0; inspected_count integer:=0;
BEGIN
  FOR q IN SELECT w.id,w.organization_id FROM public.workflow_button_questions w
    JOIN public.workflow_executions e ON e.id=w.execution_id AND e.organization_id=w.organization_id AND e.status='paused'
    WHERE w.state='waiting' AND (w.deadline_at<=clock_timestamp() OR EXISTS(
      SELECT 1 FROM public.workflow_button_ingress i WHERE i.question_id=w.id AND i.organization_id=w.organization_id
        AND i.received_at<w.deadline_at AND ((i.kind='other' AND i.received_at>=w.accepted_at) OR (i.kind='reply' AND i.quoted=w.outbound_message_id
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.options) o WHERE o->>'id'=i.option_id)))))
    ORDER BY w.deadline_at,w.id LIMIT least(greatest(coalesce(p_limit,20),1),100)
  LOOP
    inspected_count:=inspected_count+1;
    IF public.resolve_workflow_button_question(q.id,q.organization_id) THEN resolved_count:=resolved_count+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inspected',inspected_count,'resolved',resolved_count);
END $$;

REVOKE ALL ON FUNCTION public.register_workflow_button_ingress(uuid,uuid,jsonb,text),public.reconcile_workflow_button_questions(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_workflow_button_ingress(uuid,uuid,jsonb,text),public.reconcile_workflow_button_questions(integer) TO service_role;
