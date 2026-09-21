-- Provider acceptance and the chat row commit together. Failure leaves the
-- durable send eligible for read-only recovery; it never authorizes a resend.
CREATE FUNCTION public.mirror_workflow_button_message() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_phone text; canonical_id text; existing_id text; display jsonb;
BEGIN
  IF NEW.accepted_at IS NULL OR NEW.outbound_message_id IS NULL THEN RETURN NEW; END IF;
  SELECT regexp_replace(i.phone_number,'[^0-9]','','g') INTO owner_phone
    FROM public.whatsapp_instances i WHERE i.id=NEW.instance_id AND i.organization_id=NEW.organization_id;
  canonical_id:=CASE WHEN position(':' in NEW.outbound_message_id)>0 OR nullif(owner_phone,'') IS NULL
    THEN NEW.outbound_message_id ELSE owner_phone||':'||NEW.outbound_message_id END;
  -- Preserve a previously persisted echo, including delivery/read receipts.
  SELECT m.message_id INTO existing_id FROM public.whatsapp_messages m
    WHERE m.organization_id=NEW.organization_id AND m.instance_id=NEW.instance_id
      AND m.message_id IN (canonical_id,NEW.outbound_message_id)
    ORDER BY (m.message_id=canonical_id) DESC LIMIT 1;
  display:=jsonb_build_object('type','button','text',NEW.content->>'text',
    'options',(SELECT jsonb_agg(b->>'label' ORDER BY ord) FROM jsonb_array_elements(NEW.options) WITH ORDINALITY AS x(b,ord)),
    'hasImage',jsonb_typeof(NEW.content->'image')='object');
  INSERT INTO public.whatsapp_messages AS m
    (organization_id,instance_id,message_id,remote_jid,phone_number,direction,message_type,content,timestamp,status,sent_by_ai,sent_source,lead_id,raw_payload)
    VALUES(NEW.organization_id,NEW.instance_id,coalesce(existing_id,canonical_id),NEW.phone||'@s.whatsapp.net',NEW.phone,
      'outgoing','button',NEW.content->>'text',NEW.accepted_at,'pending',true,'workflow',NEW.lead_id,
      jsonb_build_object('torqueInteractive',display,'workflowQuestionId',NEW.id,'source','torque_outbound_display'))
    ON CONFLICT(message_id,instance_id) DO UPDATE SET
      sent_by_ai=true,sent_source='workflow',lead_id=coalesce(m.lead_id,EXCLUDED.lead_id),
      content=coalesce(m.content,EXCLUDED.content),
      raw_payload=coalesce(m.raw_payload,'{}'::jsonb)||EXCLUDED.raw_payload
    WHERE m.organization_id=NEW.organization_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mirror_workflow_button_message() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER mirror_workflow_button_message AFTER INSERT OR UPDATE OF accepted_at,outbound_message_id
  ON public.workflow_button_questions FOR EACH ROW EXECUTE FUNCTION public.mirror_workflow_button_message();
