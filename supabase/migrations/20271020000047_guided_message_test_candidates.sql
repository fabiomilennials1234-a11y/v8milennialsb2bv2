-- Personal-test catalogue. SECURITY INVOKER keeps chat RLS authoritative.
BEGIN;
CREATE OR REPLACE FUNCTION public.test_guided_condition_message_candidates(
  p_organization_id uuid,p_lead_id uuid,p_storage text DEFAULT NULL,p_box_id uuid DEFAULT NULL,p_provider text DEFAULT NULL
) RETURNS TABLE(message_id uuid,storage text,box_id uuid,provider text,participant_id text,text_preview text,text_source text,message_type text,message_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  IF p_storage IS NOT NULL AND p_storage NOT IN ('whatsapp_messages','channel_messages') THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH lead_identity AS (
    SELECT public.normalize_brazilian_phone(l.phone) phone FROM public.leads l
    WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL
  ), candidates(id,storage,box_id,provider,participant_id,text_value,text_source,message_type,message_at) AS (
    SELECT m.id,'whatsapp_messages'::text,w.id,COALESCE(NULLIF(w.provider,''),'uazapi'),
      public.normalize_brazilian_phone(m.phone_number),
      COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' END,
      m.message_type,m.timestamp
    FROM public.whatsapp_messages m CROSS JOIN lead_identity l
    JOIN public.whatsapp_instances w ON w.organization_id=p_organization_id
      AND m.instance_id=ANY(public.whatsapp_chip_instance_ids(p_organization_id,w.id))
    WHERE m.organization_id=p_organization_id AND m.deleted_at IS NULL
      AND public.normalize_brazilian_phone(m.phone_number)=l.phone
      AND (p_storage IS NULL OR p_storage='whatsapp_messages') AND (p_box_id IS NULL OR w.id=p_box_id)
      AND (p_provider IS NULL OR lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(p_provider))
    UNION ALL
    SELECT m.id,'channel_messages'::text,COALESCE(m.instance_id,m.messaging_channel_id),COALESCE(w.provider,c.provider),
      COALESCE(m.contact_external_id,public.normalize_brazilian_phone(m.phone_number)),
      COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' END,
      m.message_type,m.timestamp
    FROM public.channel_messages m
    LEFT JOIN public.whatsapp_instances w ON w.id=m.instance_id AND w.organization_id=p_organization_id
    LEFT JOIN public.messaging_channels c ON c.id=m.messaging_channel_id AND c.organization_id=p_organization_id
    WHERE m.organization_id=p_organization_id AND (p_storage IS NULL OR p_storage='channel_messages')
      AND (p_box_id IS NULL OR COALESCE(m.instance_id,m.messaging_channel_id)=p_box_id)
      AND (p_provider IS NULL OR lower(COALESCE(w.provider,c.provider,''))=lower(p_provider))
      AND ((m.instance_id IS NOT NULL AND EXISTS (SELECT 1 FROM lead_identity l WHERE public.normalize_brazilian_phone(m.phone_number)=l.phone))
        OR (m.messaging_channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lead_social_identities i
          WHERE i.organization_id=p_organization_id AND i.lead_id=p_lead_id AND i.messaging_channel_id=m.messaging_channel_id
            AND i.external_user_id=m.contact_external_id)))
  ) SELECT c.id,c.storage,c.box_id,c.provider,c.participant_id,left(c.text_value,120),c.text_source,c.message_type,c.message_at
    FROM candidates c ORDER BY c.message_at DESC,c.id DESC LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_message_candidates(uuid,uuid,text,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
