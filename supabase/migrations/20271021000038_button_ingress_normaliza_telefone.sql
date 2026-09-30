-- O ingress da "Pergunta com botões" comparava o telefone da reserva com o do
-- JID do WhatsApp por IGUALDADE DE STRING. No Brasil os dois nem sempre são
-- iguais: o JID costuma vir na forma legada de 8 dígitos (555199540202) e a
-- reserva guarda o celular de 9 (5551999540202). Sem casar, a função devolve
-- `recognized=false` e NEM REGISTRA a entrada — o toque no botão some, a
-- execução fica `paused` até o prazo e o cliente acha que o bot morreu.
--
-- Medido em produção na Riofix (30/09/2026): resposta com
-- `buttonOrListid = <pergunta>:comercial`, `quoted` correto e
-- `messageType = TemplateButtonReplyMessage` — ou seja, o toque chegou íntegro
-- — e mesmo assim `workflow_button_ingress` ficou com ZERO linhas na org.
--
-- `public.normalize_brazilian_phone` já reconcilia as duas formas (é o que
-- `whatsapp_messages.normalized_phone` usa). A igualdade crua fica como
-- caminho rápido, para não perder o índice; o normalizador entra como recuo.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_workflow_button_ingress(p_organization_id uuid, p_instance_id uuid, p_payload jsonb, p_source text DEFAULT 'webhook'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
        AND instance_id=p_instance_id AND (phone=recipient_phone OR public.normalize_brazilian_phone(phone)=public.normalize_brazilian_phone(recipient_phone));
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
      WHERE organization_id=p_organization_id AND instance_id=p_instance_id AND (phone=recipient_phone OR public.normalize_brazilian_phone(phone)=public.normalize_brazilian_phone(recipient_phone))
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
END $function$


COMMIT;
